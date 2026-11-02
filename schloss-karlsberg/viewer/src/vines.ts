/**
 * KB-I35 (wave 7): the vineyard LP06 30 in 3D near the camera. One vine per stake (model site/vines.ts `vinePlants`,
 * on the rows and plant phase the ground shader paints, VINE_GLSL), drawn only within VINEYARD.near m of the camera:
 *
 * - three instanced tiers selected nearest first whenever the camera has moved STEP m: close (< CLOSE_DETAIL m) four
 *   once-subdivided icosahedral clumps (no facets next to the camera), near (< NEAR_DETAIL m) four icosahedral leaf
 *   clumps round a square stake (88 triangles), far two octahedral clumps and the stake (24); leaf cards on the close
 *   and near plants within VINE_CARDS.far m (own instance buffer) and VINE_CARDS_CLOSE more on the close ones;
 * - the plants shrink away over the last VINEYARD.fade m of VINEYARD.near (foliage.ts FOL_FADE / FOL_FADE_W), and the
 *   terrain shader turns the painted leaf wall into the hoed ground under them and, beyond, paints their far look (the
 *   view-dependent leaf cover of VINE_GLSL vineCover / vineCanopy) over the same band (terrain.ts uVinePlants), so the
 *   3D rows and the painted parcel read as one material (wave-7 review fix);
 * - foliage shading (crown occlusion, wrap, back-light, wind) through the 'vegetation.leaf' material; the stake is the
 *   bark path of that shader (crown.w = −1). No shadow casting: the set follows the camera, and the cached shadow map
 *   is not redrawn for it (the ground shader's soil shade beside the rows stays).
 *
 * Only in the 1789 epoch (the vineyard is a 1789 land cover); not drawn while the camera is inside a building.
 */
import * as THREE from 'three';
import { mulberry32 } from '@model/layout/geom.ts';
import { VINEYARD } from '@model/layout/grammar.ts';
import { vineGeometry, vinePlants } from '@model/site/vines.ts';
import { GROUND_CLASS } from './landcover.ts';
import { CARD_ORDER, cardMaterial, leafCardGeometry } from './leafCards.ts';
import type { TerrainData } from './terrain.ts';

/** Distance (m) within which the plants take the subdivided clumps. */
export const CLOSE_DETAIL = 7;
/** Distance (m) within which the plants take the detailed tier. */
export const NEAR_DETAIL = 45;
/** Instance caps of the close, near and far tier and of the cards (nearest first). */
export const VINE_CAP = { close: 400, near: 2600, far: 12000, cards: 1600 } as const;
/**
 * Leaf cards on the close and near plants (vine leaves are broadleaf atlas tiles), gone by VINE_CARDS.far m. Wave-7
 * review fix: 12 larger cards per plant instead of 28 (pose 40 was +0.95…1.45 ms, over the +1 ms item budget).
 */
export const VINE_CARDS = { count: 12, size: 0.38, push: 0.3, far: 20, tiles: [0, 1, 2] } as const;
/** Extra cards on the close plants only (≤ CLOSE_DETAIL m: their smooth clumps fill much of the screen). */
export const VINE_CARDS_CLOSE = { count: 16, size: 0.3, push: 0.3, far: CLOSE_DETAIL + 4, tiles: [0, 1, 2] } as const;
/** Camera travel (m) before the selection is redone. */
const STEP = 4;
/** Camera turn (cos of the angle, ~15°) before the selection is redone. */
const TURN = 0.966;

/** July vine leaf (linear): VINE_GLSL vineLeaf() of GROUND_COLOURS.vine #7A9C4C at the rows' mean shade 0.88 [I]. */
export function vineLeafColour(): THREE.Color {
  const v = new THREE.Color('#7A9C4C');
  const l = 0.2126 * v.r + 0.7152 * v.g + 0.0722 * v.b;
  return new THREE.Color(v.r + (l - v.r) * 0.28, v.g + (l - v.g) * 0.28, v.b + (l * 0.68 - v.b) * 0.28).multiplyScalar(1.06 * 0.88);
}

export class Vines {
  readonly group = new THREE.Group();
  readonly close: THREE.InstancedMesh;
  readonly near: THREE.InstancedMesh;
  readonly far: THREE.InstancedMesh;
  /** leaf cards of the close and near tiers */
  readonly cards: THREE.InstancedMesh;
  /** extra leaf cards of the close tier (shares its instance buffers) */
  readonly cardsClose: THREE.InstancedMesh;
  /** per plant: x, y, z, yaw, scale, lean azimuth, lean, colour jitter */
  private plants = new Float32Array(0);
  private count = 0;
  private at = new THREE.Vector3(1e9, 1e9, 1e9);
  private look = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private order = new Uint32Array(0);
  private dist = new Float32Array(0);
  /** set by the viewer each frame: no plants while the camera is inside a building */
  indoor = false;
  /** master switch (A/B: `skb.vines.setEnabled(false)`) */
  enabled = true;

  constructor(
    private terrain: TerrainData,
    private rings: [number, number][][],
    private across: [number, number],
    patch?: (m: THREE.MeshStandardMaterial) => void,
    /** terrain-material uniform `uVinePlants` (the ground under the plants follows the 3D range) */
    private groundUniform?: { value: number },
  ) {
    this.group.name = 'vineyard';
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 });
    mat.name = 'vegetation.leaf';
    mat.defines = { FOL_FADE: VINEYARD.near.toFixed(1), FOL_FADE_W: VINEYARD.fade.toFixed(1) };
    patch?.(mat);
    const mk = (geo: THREE.BufferGeometry, cap: number, name: string) => {
      const im = new THREE.InstancedMesh(geo, mat, cap);
      im.count = 0;
      im.name = name;
      im.castShadow = false;
      im.receiveShadow = true;
      im.frustumCulled = false; // the set follows the camera
      im.userData = { part: 'vegetation', species: 'vitis', lod: name.slice(name.lastIndexOf('-') + 1) };
      im.setColorAt(0, new THREE.Color());
      this.group.add(im);
      return im;
    };
    this.close = mk(vineGeometry(1789, 2, 4, true), VINE_CAP.close, 'vineyard/plants-close');
    this.near = mk(vineGeometry(1789, 1, 4, true), VINE_CAP.near, 'vineyard/plants-near');
    this.far = mk(vineGeometry(1789, 0, 2, true, 1.3), VINE_CAP.far, 'vineyard/plants-far');
    // leaf cards break the clumps' polygon outlines near the camera (wave-6 leaf-card material, alpha to coverage);
    // the close and near clumps share one layout (vineGeometry), so one card set fits both
    const nearGeo = this.near.geometry;
    this.cards = new THREE.InstancedMesh(leafCardGeometry(nearGeo, { ...VINE_CARDS, seed: 0x71e5 }), cardMaterial(false, patch), VINE_CAP.cards);
    this.cards.setColorAt(0, new THREE.Color());
    this.cards.count = 0;
    this.cards.name = 'vineyard/cards';
    this.cards.castShadow = false;
    this.cards.receiveShadow = true;
    this.cards.frustumCulled = false;
    this.cards.renderOrder = CARD_ORDER;
    this.cards.userData = { part: 'vegetation', species: 'vitis', lod: 'cards' };
    this.group.add(this.cards);
    this.cardsClose = new THREE.InstancedMesh(leafCardGeometry(nearGeo, { ...VINE_CARDS_CLOSE, seed: 0x71e6 }), this.cards.material, 1);
    this.cardsClose.instanceMatrix = this.close.instanceMatrix;
    this.cardsClose.instanceColor = this.close.instanceColor;
    this.cardsClose.count = 0;
    this.cardsClose.name = 'vineyard/cards-close';
    this.cardsClose.castShadow = false;
    this.cardsClose.receiveShadow = true;
    this.cardsClose.frustumCulled = false;
    this.cardsClose.renderOrder = CARD_ORDER;
    this.cardsClose.userData = { part: 'vegetation', species: 'vitis', lod: 'cards-close' };
    this.group.add(this.cardsClose);
    this.rebuild();
  }

  /** (Re)place the plants for the terrain's current epoch (1789 only). */
  rebuild(): void {
    this.at.set(1e9, 1e9, 1e9);
    this.close.count = 0;
    this.near.count = 0;
    this.far.count = 0;
    this.cards.count = 0;
    this.cardsClose.count = 0;
    const t = this.terrain;
    if (t.epoch !== '1789' || !this.rings.length) {
      this.count = 0;
      if (this.groundUniform) this.groundUniform.value = 0;
      return;
    }
    const gm = t.meta.ground;
    const ox = t.meta.grid.west - 381000;
    const oz = -(t.meta.grid.north - 5465000);
    const ground = t.ground1789;
    const accept = (x: number, z: number) => {
      const c = Math.floor((x - ox) / gm.cell);
      const r = Math.floor((z - oz) / gm.cell);
      return c >= 0 && r >= 0 && c < gm.cols && r < gm.rows && ground[r * gm.cols + c] === GROUND_CLASS.vineyard;
    };
    const xz = vinePlants(this.rings, this.across, { accept });
    const n = xz.length / 2;
    const P = new Float32Array(n * 8);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const x = xz[i * 2];
      const z = xz[i * 2 + 1];
      const y = t.sample(x, z);
      if (!Number.isFinite(y)) continue;
      // deterministic per stake position
      const rnd = mulberry32((Math.round(x * 10) * 73856093) ^ (Math.round(z * 10) * 19349663) ^ 0x5eed);
      P.set([x, y, z, rnd() * Math.PI * 2, 0.85 + rnd() * 0.3, rnd() * Math.PI * 2, rnd() * 0.07, rnd()], k * 8);
      k++;
    }
    this.plants = P.subarray(0, k * 8);
    this.count = k;
    this.order = new Uint32Array(k);
    this.dist = new Float32Array(k);
    if (this.groundUniform) this.groundUniform.value = k ? VINEYARD.near : 0;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.at.set(1e9, 1e9, 1e9);
    if (this.groundUniform) this.groundUniform.value = on && this.count ? VINEYARD.near : 0;
  }

  /** Per frame: redo the nearest-first selection when the camera moved STEP m. */
  update(camera: THREE.Camera): void {
    this.group.visible = this.enabled && !this.indoor && this.count > 0;
    if (!this.group.visible) return;
    const p = camera.position;
    const f = camera.getWorldDirection(this.fwd);
    if (p.distanceToSquared(this.at) < STEP * STEP && f.dot(this.look) > TURN) return;
    this.at.copy(p);
    this.look.copy(f);
    const R = VINEYARD.near + STEP;
    const R2 = R * R;
    const P = this.plants;
    let m = 0;
    for (let i = 0; i < this.count; i++) {
      const dx = P[i * 8] - p.x;
      const dy = P[i * 8 + 1] - p.y;
      const dz = P[i * 8 + 2] - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      // only plants in a wide cone round the view direction (≥ 110° half angle, more than any view frustum plus the
      // turn and travel margins); the rest stay unselected until the camera turns
      const ahead = dx * f.x + dy * f.y + dz * f.z;
      if (d2 < R2 && ahead > -0.35 * Math.sqrt(d2) - STEP - 2) {
        this.order[m] = i;
        this.dist[i] = d2;
        m++;
      }
    }
    const sel = this.order.subarray(0, m).sort((a, b) => this.dist[a] - this.dist[b]);
    const nearR2 = NEAR_DETAIL * NEAR_DETAIL;
    const closeR2 = CLOSE_DETAIL * CLOSE_DETAIL;
    const cardR2 = (VINE_CARDS.far + STEP) ** 2;
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const ql = new THREE.Quaternion();
    const ax = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const base = vineLeafColour();
    const c = new THREE.Color();
    let nk = 0;
    let nn = 0;
    let nf = 0;
    let nc = 0;
    for (const i of sel) {
      const close = this.dist[i] < closeR2 && nk < VINE_CAP.close;
      const near = !close && this.dist[i] < nearR2 && nn < VINE_CAP.near;
      if (!close && !near && nf >= VINE_CAP.far) break;
      const o = i * 8;
      q.setFromAxisAngle(up, P[o + 3]);
      // a slight lean of the stake (≤ 4°) [I]
      ql.setFromAxisAngle(ax.set(Math.cos(P[o + 5]), 0, Math.sin(P[o + 5])), P[o + 6]);
      q.premultiply(ql);
      mat.compose(pos.set(P[o], P[o + 1], P[o + 2]), q, scl.setScalar(P[o + 4]));
      c.copy(base).offsetHSL((P[o + 7] - 0.5) * 0.04, (P[o + 7] - 0.5) * 0.1, (((P[o + 7] * 7.13) % 1) - 0.5) * 0.06);
      const im = close ? this.close : near ? this.near : this.far;
      const j = close ? nk++ : near ? nn++ : nf++;
      im.setMatrixAt(j, mat);
      im.setColorAt(j, c);
      if ((close || near) && this.dist[i] < cardR2 && nc < VINE_CAP.cards) {
        this.cards.setMatrixAt(nc, mat);
        this.cards.setColorAt(nc, c);
        nc++;
      }
    }
    for (const [im, n] of [
      [this.close, nk],
      [this.near, nn],
      [this.far, nf],
      [this.cards, nc],
    ] as const) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    this.cardsClose.count = nk;
  }

  stats(): { plants: number; close: number; near: number; far: number; cards: number; triangles: number } {
    const tri = (im: THREE.InstancedMesh) => ((im.geometry.index?.count ?? im.geometry.attributes.position.count) / 3) * im.count;
    return {
      plants: this.count,
      close: this.close.count,
      near: this.near.count,
      far: this.far.count,
      cards: this.cards.count + this.cardsClose.count,
      triangles: this.group.visible ? tri(this.close) + tri(this.near) + tri(this.far) + tri(this.cards) + tri(this.cardsClose) : 0,
    };
  }
}
