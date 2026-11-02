/**
 * Near-tree leaf cards (wave 6, "tree look near the camera", follow-up of KB-I44). At eye level the clump crowns read
 * as faceted polyhedra; within LEAF_CARD_FAR m every crown gets a fringe of camera-facing leaf-cluster cards scattered
 * over its outer clump surface (visual-audit §5.6 V1/V2; skb-visual-wow materials-vegetation-water.md §5 "leaf-card
 * crowns ... normals pointing out from the crown centre so the crown shades as one mass").
 *
 * - Geometry (`leafCardGeometry`): per crown geometry, `count` anchors sampled on its outer leaf triangles (area ×
 *   outer weight), each a quad of four vertices at the anchor with a `card` attribute (corner, size, rotation), the
 *   anchor's normal and its interpolated `crown` attribute, so the foliage shading (occlusion, per-clump colour, wind,
 *   back-light) applies unchanged. The quad is expanded in view space in the vertex shader (foliage.ts `FOL_CARD`) and
 *   shrinks to nothing between 0.78 and 1 × LEAF_CARD_FAR.
 * - Texture: the procedural leaf atlas (leafAtlas.ts; our own output, no licence to record), alpha to coverage with
 *   MSAA (three's sharpened alpha test), mip-level alpha compensation so far cards do not thin out.
 * - Draw cost: opaque crowns first, the cards after them (renderOrder CARD_ORDER, before the terrain), no shadow
 *   casting. Apple GPUs cannot drop hidden alpha-tested fragments before shading, so the cards are capped per crown
 *   mesh (nearest first) and switched off beyond LEAF_CARD_FAR.
 *
 * Sources: the site trees (`registerStatic`: CPU selection of the nearest instances whenever the camera moved
 * CARD_STEP m) and the forest's hero tier (`registerShared`: the card mesh shares the hero mesh's instance buffers,
 * which the forest already sorts nearest first).
 */
import * as THREE from 'three';
import { hashString, mulberry32 } from '@model/layout/geom.ts';
import { ATLAS_TILES, NEEDLE_TILE, rasterFineLeafAtlas, rasterLeafAtlas } from './leafAtlas.ts';

/**
 * Distance (m) beyond which no card is drawn on a site tree; they shrink away from 0.78 × this. At 100-150 m the clump
 * shells of the garden trees still read as hexagons at 1080p (review shots 33/34), and a card there is 6-10 px.
 */
export const LEAF_CARD_FAR = 140;
/** The same for the forest's hero and close tiers (crowns of 10-20 m) [I]. */
export const FOREST_CARD_FAR = 300;
/** Camera travel (m) before the static selection is redone. */
const CARD_STEP = 3;
/** Render order: after the opaque scene (0), before the terrain (atmosphere.ts RENDER_ORDER.terrain = 1). */
export const CARD_ORDER = 0.5;

export interface CardOptions {
  /** number of cards */
  count: number;
  /** card edge length in the crown geometry's object units */
  size: number;
  seed: number;
  /** atlas tiles to pick from (0-2 broadleaf, 3 needles) */
  tiles?: readonly number[];
  /** outward push of the card centre along the anchor normal (× size) */
  push?: number;
  /** distance (m) where the cards have shrunk away (default LEAF_CARD_FAR); stored in the `card` corner magnitude */
  far?: number;
  /** glossy leaves (citrus): the card material keeps a specular lobe at a lower roughness */
  gloss?: boolean;
}

/** Smoothstep. */
const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Leaf cards for a crown geometry (non-indexed triangle soup with `position`, `normal` and `crown`; site/trees.ts and
 * the forest tier crowns). Deterministic per seed. Only leaf triangles (crown.w ≥ 0) take cards, weighted by area and
 * by how far out in the crown envelope they lie (inner core and limbs get none).
 */
export function leafCardGeometry(crown: THREE.BufferGeometry, o: CardOptions): THREE.BufferGeometry {
  const pos = crown.getAttribute('position') as THREE.BufferAttribute;
  const nrm = crown.getAttribute('normal') as THREE.BufferAttribute;
  const cw = crown.getAttribute('crown') as THREE.BufferAttribute | undefined;
  const col = crown.getAttribute('color') as THREE.BufferAttribute | undefined;
  const idx = crown.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const vi = (t: number, k: number) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
  // cumulative weights
  const cum = new Float64Array(triCount);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let total = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = vi(t, 0);
    const i1 = vi(t, 1);
    const i2 = vi(t, 2);
    let w = 1;
    if (cw) {
      if (cw.getW(i0) < 0 || cw.getW(i1) < 0 || cw.getW(i2) < 0) w = 0;
      else {
        const r = (Math.hypot(cw.getX(i0), cw.getY(i0), cw.getZ(i0)) + Math.hypot(cw.getX(i1), cw.getY(i1), cw.getZ(i1)) + Math.hypot(cw.getX(i2), cw.getY(i2), cw.getZ(i2))) / 3;
        w = 0.08 + ss(0.5, 0.92, r);
      }
    }
    if (w > 0) {
      a.fromBufferAttribute(pos, i0);
      b.fromBufferAttribute(pos, i1);
      c.fromBufferAttribute(pos, i2);
      w *= b.sub(a).cross(c.sub(a)).length() / 2;
    }
    total += w;
    cum[t] = total;
  }
  const rnd = mulberry32(o.seed ^ 0xca2d);
  const tiles = o.tiles ?? [0, 1, 2];
  // the shader reads the fade distance from the corner magnitude: card.xy = ±far / 100
  const kFar = (o.far ?? LEAF_CARD_FAR) / 100;
  const push = o.push ?? 0.12;
  const N = total > 0 ? Math.max(0, Math.floor(o.count)) : 0;
  const P = new Float32Array(N * 4 * 3);
  const Nn = new Float32Array(N * 4 * 3);
  const Cr = new Float32Array(N * 4 * 4);
  const Cd = new Float32Array(N * 4 * 4);
  const Uv = new Float32Array(N * 4 * 2);
  const Co = col ? new Float32Array(N * 4 * 3) : null;
  const index: number[] = [];
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  for (let k = 0; k < N; k++) {
    // pick a triangle by weight (binary search)
    const x = rnd() * total;
    let lo = 0;
    let hi = triCount - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (cum[m] < x) lo = m + 1;
      else hi = m;
    }
    const t = lo;
    let u = rnd();
    let v = rnd();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const w0 = 1 - u - v;
    const ids = [vi(t, 0), vi(t, 1), vi(t, 2)];
    const bw = [w0, u, v];
    p.set(0, 0, 0);
    n.set(0, 0, 0);
    const cr = [0, 0, 0, 0];
    const cc = [0, 0, 0];
    for (let j = 0; j < 3; j++) {
      p.addScaledVector(tmp.fromBufferAttribute(pos, ids[j]), bw[j]);
      n.addScaledVector(tmp.fromBufferAttribute(nrm, ids[j]), bw[j]);
      if (cw) for (let q = 0; q < 3; q++) cr[q] += cw.getComponent(ids[j], q) * bw[j];
      if (col) for (let q = 0; q < 3; q++) cc[q] += col.getComponent(ids[j], q) * bw[j];
    }
    cr[3] = cw ? cw.getW(ids[0]) : 0.5;
    n.normalize();
    // size jitter 0.75-1.25, cards a little smaller toward the crown base
    const size = o.size * (0.75 + 0.5 * rnd()) * (0.85 + 0.15 * ss(-1, 0.6, cr[1]));
    p.addScaledVector(n, push * size);
    const rot = rnd() * Math.PI * 2;
    const tile = tiles[Math.floor(rnd() * tiles.length)];
    const tx = tile % ATLAS_TILES;
    const ty = Math.floor(tile / ATLAS_TILES);
    // per-card brightness in the clump random (crown.w is the clump's; a small offset keeps the wind phase close)
    for (let j = 0; j < 4; j++) {
      const q = k * 4 + j;
      P.set([p.x, p.y, p.z], q * 3);
      Nn.set([n.x, n.y, n.z], q * 3);
      Cr.set(cr, q * 4);
      Cd.set([corners[j][0] * kFar, corners[j][1] * kFar, size, rot], q * 4);
      Uv.set([(tx + (corners[j][0] * 0.5 + 0.5)) / ATLAS_TILES, (ty + (corners[j][1] * 0.5 + 0.5)) / ATLAS_TILES], q * 2);
      if (Co) Co.set(cc, q * 3);
    }
    const b0 = k * 4;
    index.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
  g.setAttribute('crown', new THREE.BufferAttribute(Cr, 4));
  g.setAttribute('card', new THREE.BufferAttribute(Cd, 4));
  g.setAttribute('uv', new THREE.BufferAttribute(Uv, 2));
  if (Co) g.setAttribute('color', new THREE.BufferAttribute(Co, 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  if (g.boundingSphere) g.boundingSphere.radius += o.size;
  return g;
}

/** Thomsen's approximation of an ellipsoid's surface (radii a, a, c). */
export function ellipsoidArea(a: number, c: number): number {
  const p = 1.6;
  return 4 * Math.PI * ((a ** (2 * p) + 2 * (a * c) ** p) / 3) ** (1 / p);
}

/**
 * Card size and count for a crown of radius R and half-height Hh (object units): size ≈ 0.3 R within [minSize,
 * maxSize]; count covers the envelope ~1.5× (the cards' alpha covers about half their area), within [16, maxCount].
 */
export function cardBudget(R: number, Hh: number, opts: { minSize?: number; maxSize?: number; maxCount?: number; density?: number } = {}): { size: number; count: number } {
  const size = Math.min(opts.maxSize ?? 1.5, Math.max(opts.minSize ?? 0.26, 0.3 * R));
  const count = Math.round(Math.min(opts.maxCount ?? 220, Math.max(16, ((opts.density ?? 1.5) * ellipsoidArea(R, Hh)) / (size * size))));
  return { size, count };
}

/**
 * Site species with a clipped (shorn) surface [N d'Argenville]: yew cones and citrus heads take many small cards close to
 * the surface (a fine leafy skin, KB-I66 / wave-6 review), not loose sprays standing out of the crown.
 */
const CLIPPED: Record<string, { size: number; density: number; push: number; max: number; tiles: readonly number[] }> = {
  taxus_cone: { size: 0.1, density: 1.6, push: 0, max: 110, tiles: [NEEDLE_TILE] },
  citrus: { size: 0.17, density: 1.6, push: 0.05, max: 150, tiles: [0, 1, 2] },
};

/**
 * Card options for a site-tree crown mesh (model site/trees.ts `treeMeshes`), or null: only 'vegetation.leaf' crowns
 * with the `crown` attribute; size and count from the crown's bounding box (cardBudget); conifers take the needle tile,
 * clipped species (CLIPPED) a fine skin; `gloss` follows the crown material (citrus).
 */
export function siteCardOptions(im: THREE.InstancedMesh): CardOptions | null {
  const mat = im.material as THREE.Material;
  if (Array.isArray(mat) || mat.name !== 'vegetation.leaf' || !im.geometry.getAttribute('crown')) return null;
  const species = String(im.userData.species ?? '');
  if (!im.geometry.boundingBox) im.geometry.computeBoundingBox();
  const bb = im.geometry.boundingBox!;
  const R = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2;
  const Hh = (bb.max.y - bb.min.y) / 2;
  const seed = hashString(im.name);
  const gloss = !!mat.userData.gloss;
  const clip = CLIPPED[species];
  if (clip) {
    const { size, count } = cardBudget(R, Hh, { minSize: clip.size, maxSize: clip.size, maxCount: clip.max, density: clip.density });
    return { count, size, seed, tiles: clip.tiles, push: clip.push, gloss };
  }
  const small = R < 0.6; // rose heads: a few small cards
  // conifers: the flat whorls need denser needle sprays to close [I]
  const { size, count } = cardBudget(R, Hh, { minSize: small ? 0.2 : 0.3, maxSize: 1.5, maxCount: species === 'beech_old' ? 280 : 220, density: species === 'conifer' ? 2.4 : 1.6 });
  return { count, size, seed, tiles: species === 'conifer' ? [NEEDLE_TILE] : [0, 1, 2], push: species === 'populus_italica' ? 0.05 : 0.12, gloss };
}

/**
 * Forest tier cards (unit crowns: mean silhouette radius 1, height 2) [I sizes]: hero (detail-1, < 100 m) and close
 * (detail-0, 100-250 m; fewer, larger cards, it is seen smaller).
 */
export const FOREST_CARDS = {
  hero: { tree: { count: 300, size: 0.27, push: 0.2 }, shrub: { count: 140, size: 0.3, push: 0.2 } },
  close: { tree: { count: 64, size: 0.44, push: 0.3 }, shrub: { count: 56, size: 0.4, push: 0.3 } },
} as const;

/**
 * Forest crowns per tier mesh (variant) that carry cards, nearest first (KB-I66). The forest's close tier takes no more
 * crowns than this per variant either (forest.ts), so a close crown always has its cards: bare detail-0 clumps read as
 * hexagons at 150-300 m (tour Anflug); beyond the cap the lumpy mid dome takes over.
 */
export const FOREST_CARD_CAP = { hero: 240, close: 400 } as const;

/**
 * KB-I66 residual (wave 7): silhouette fringe of the mid forest domes (the tile crowns beyond the carded close tier).
 * Cards on the dome surface that only open where the dome turns away from the camera (foliage.ts FOL_FRINGE), so the
 * smooth dome outline breaks into leaf clusters at 150-450 m, at a fraction of the close tier's card cost (the cards on
 * the dome's face stay degenerate) [I counts and sizes]. Unit dome: mean silhouette radius 1.
 */
export const FOREST_FRINGE = { count: 40, size: 0.5, push: 0.3, far: 460 } as const;

const fringeMats: THREE.MeshStandardMaterial[] = [];
/** Fringe card material: the card material plus FOL_FRINGE (silhouette-only cards); named 'vegetation.leaf'. */
export function fringeMaterial(): THREE.MeshStandardMaterial {
  if (!fringeMats.length) {
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, map: leafAtlasTexture(), alphaTest: 0.5, alphaToCoverage: true });
    m.name = 'vegetation.leaf';
    m.defines = { FOL_CARD: '', FOL_FRINGE: '' };
    m.userData.leafCard = true;
    fringeMats.push(m);
  }
  return fringeMats[0];
}

/**
 * KB-I76: the coarse atlas (left half) and its fine twin (right half) side by side in one 2:1 texture. The card uvs
 * stay in 0..1 of one atlas; foliage.ts FOL_CARD maps them into the left or right half per card.
 */
export function combinedLeafAtlas(size: number): Uint8Array {
  const a = rasterLeafAtlas(size);
  const f = rasterFineLeafAtlas(size);
  const out = new Uint8Array(size * size * 8);
  for (let y = 0; y < size; y++) {
    out.set(a.subarray(y * size * 4, (y + 1) * size * 4), y * size * 8);
    out.set(f.subarray(y * size * 4, (y + 1) * size * 4), y * size * 8 + size * 4);
  }
  return out;
}

let atlasTex: THREE.DataTexture | null = null;
/** The shared leaf atlas texture (sRGB colour, straight alpha, mipmapped; coarse | fine, 2048 × 1024). */
export function leafAtlasTexture(): THREE.DataTexture {
  if (!atlasTex) {
    const size = 1024;
    atlasTex = new THREE.DataTexture(combinedLeafAtlas(size), size * 2, size, THREE.RGBAFormat);
    atlasTex.colorSpace = THREE.SRGBColorSpace;
    atlasTex.generateMipmaps = true;
    atlasTex.minFilter = THREE.LinearMipmapLinearFilter;
    atlasTex.magFilter = THREE.LinearFilter;
    atlasTex.anisotropy = 4;
    atlasTex.name = 'leaf-atlas (procedural)';
    atlasTex.needsUpdate = true;
  }
  return atlasTex;
}

const cardMats = new Map<string, THREE.MeshStandardMaterial>();
/**
 * Card material (named 'vegetation.leaf' like the crowns); `vc` = with the bloom vertex colours, `gloss` = glossy leaves
 * (citrus: roughness 0.6 and the GGX lobe kept, define FOL_GLOSS): small glints on single leaves.
 */
export function cardMaterial(vc: boolean, patch?: (m: THREE.MeshStandardMaterial) => void, gloss = false): THREE.MeshStandardMaterial {
  const k = `${vc ? 'vc' : 'plain'}${gloss ? '-gloss' : ''}`;
  let m = cardMats.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: gloss ? 0.6 : 0.9, vertexColors: vc, map: leafAtlasTexture(), alphaTest: 0.5, alphaToCoverage: true });
    m.name = 'vegetation.leaf';
    m.defines = { ...(m.defines ?? {}), FOL_CARD: '', ...(gloss ? { FOL_GLOSS: '' } : {}) };
    m.userData.leafCard = true;
    patch?.(m);
    cardMats.set(k, m);
  }
  return m;
}

interface StaticSource {
  src: THREE.InstancedMesh;
  cards: THREE.InstancedMesh;
  /** instance centres (world) and a reach (m) added to the distance test */
  centres: Float32Array;
  reach: number;
}
interface SharedSource {
  src: THREE.InstancedMesh;
  cards: THREE.InstancedMesh;
  cap: number;
}

/** Is `o` and every ancestor visible? */
function visibleDeep(o: THREE.Object3D | null): boolean {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}

export class LeafCards {
  readonly group = new THREE.Group();
  /** cards beyond this distance (m) are not drawn */
  far = LEAF_CARD_FAR;
  /** master switch (A/B: `skb.leafCards.setEnabled(false)`) */
  enabled = true;
  private statics: StaticSource[] = [];
  private shared: SharedSource[] = [];
  private at = new THREE.Vector3(1e9, 1e9, 1e9);
  private geoCache = new Map<string, THREE.BufferGeometry>();

  constructor(private patch?: (m: THREE.MeshStandardMaterial) => void) {
    this.group.name = 'leaf-cards';
  }

  private mesh(src: THREE.InstancedMesh, geo: THREE.BufferGeometry, cap: number, gloss = false): THREE.InstancedMesh {
    const im = new THREE.InstancedMesh(geo, cardMaterial(!!geo.getAttribute('color'), this.patch, gloss), Math.max(1, cap));
    im.count = 0;
    im.name = `${src.name}/cards`;
    im.castShadow = false;
    im.receiveShadow = true;
    im.frustumCulled = false; // the set follows the camera
    im.renderOrder = CARD_ORDER;
    im.userData = { part: 'vegetation', species: src.userData.species, lod: 'cards' };
    im.visible = false;
    // same frame as the source mesh (the card group sits at the identity)
    src.updateWorldMatrix(true, false);
    im.matrixAutoUpdate = false;
    im.matrix.copy(src.matrixWorld);
    im.matrixWorldNeedsUpdate = true;
    this.group.add(im);
    return im;
  }

  /** Cards for a static instanced crown mesh (site trees): `opts` per its geometry, `cap` nearest instances. */
  registerStatic(src: THREE.InstancedMesh, opts: CardOptions, cap = 160): void {
    const key = `${src.geometry.uuid}|${opts.count}|${opts.size}|${opts.seed}`;
    let geo = this.geoCache.get(key);
    if (!geo) this.geoCache.set(key, (geo = leafCardGeometry(src.geometry, opts)));
    const cards = this.mesh(src, geo, Math.min(cap, src.count), !!opts.gloss);
    src.updateWorldMatrix(true, false);
    const centres = new Float32Array(src.count * 3);
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    for (let i = 0; i < src.count; i++) {
      src.getMatrixAt(i, m);
      v.setFromMatrixPosition(m).applyMatrix4(src.matrixWorld);
      centres.set([v.x, v.y, v.z], i * 3);
    }
    if (!src.geometry.boundingSphere) src.geometry.computeBoundingSphere();
    this.statics.push({ src, cards, centres, reach: (src.geometry.boundingSphere?.radius ?? 2) * 1.5 });
  }

  /** Cards for an instanced crown mesh whose instances are already sorted nearest first (forest hero tier). */
  registerShared(src: THREE.InstancedMesh, opts: CardOptions, cap = 240): void {
    const geo = leafCardGeometry(src.geometry, opts);
    const cards = this.mesh(src, geo, 1);
    cards.instanceMatrix = src.instanceMatrix;
    if (!src.instanceColor) src.setColorAt(0, new THREE.Color(1, 1, 1));
    cards.instanceColor = src.instanceColor;
    this.shared.push({ src, cards, cap });
  }

  /** Drop the shared sources (the forest rebuilt its tiers). */
  clearShared(): void {
    for (const s of this.shared) {
      this.group.remove(s.cards);
      s.cards.geometry.dispose();
    }
    this.shared = [];
  }

  /**
   * Follow a forest's hero tier (forest.ts `onTiers`): cards for its crown and shrub meshes, sharing their instance
   * buffers (nearest first, so the cap keeps the nearest crowns).
   */
  attachForest(forest: { onTiers: ((tiers: { crowns: THREE.InstancedMesh[]; shrubs: THREE.InstancedMesh[] }[]) => void) | null }, cap: { hero: number; close: number } = FOREST_CARD_CAP): void {
    forest.onTiers = (tiers) => {
      this.clearShared();
      (['close', 'hero'] as const).forEach((k, t) => {
        const tier = tiers[t];
        if (!tier) return;
        const o = FOREST_CARDS[k];
        tier.crowns.forEach((im, v) => this.registerShared(im, { ...o.tree, far: FOREST_CARD_FAR, seed: 0x7ee + t * 31 + v * 7919 }, cap[k]));
        tier.shrubs.forEach((im, v) => this.registerShared(im, { ...o.shrub, far: FOREST_CARD_FAR, seed: 0x5b + t * 31 + v * 7919 }, cap[k]));
      });
    };
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.at.set(1e9, 1e9, 1e9);
  }

  /** Per frame: follow the shared sources, and redo the static selection when the camera moved CARD_STEP m. */
  update(camera: THREE.Camera): void {
    const p = camera.position;
    for (const s of this.shared) {
      const n = this.enabled && this.group.visible ? Math.min(s.cap, s.src.count) : 0;
      s.cards.count = n;
      s.cards.visible = n > 0 && visibleDeep(s.src);
    }
    if (p.distanceToSquared(this.at) < CARD_STEP * CARD_STEP) {
      for (const s of this.statics) s.cards.visible = s.cards.count > 0 && visibleDeep(s.src);
      return;
    }
    this.at.copy(p);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const list: { i: number; d2: number }[] = [];
    for (const s of this.statics) {
      list.length = 0;
      const cap = s.cards.instanceMatrix.count;
      if (this.enabled && visibleDeep(s.src)) {
        const r = this.far + s.reach;
        const r2 = r * r;
        const C = s.centres;
        for (let i = 0; i < s.src.count; i++) {
          const dx = C[i * 3] - p.x;
          const dy = C[i * 3 + 1] - p.y;
          const dz = C[i * 3 + 2] - p.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < r2) list.push({ i, d2 });
        }
        list.sort((x, y) => x.d2 - y.d2);
      }
      const n = Math.min(cap, list.length);
      for (let k = 0; k < n; k++) {
        s.src.getMatrixAt(list[k].i, m);
        s.cards.setMatrixAt(k, m);
        if (s.src.instanceColor) {
          s.src.getColorAt(list[k].i, c);
          s.cards.setColorAt(k, c);
        }
      }
      s.cards.count = n;
      s.cards.instanceMatrix.needsUpdate = true;
      if (s.cards.instanceColor) s.cards.instanceColor.needsUpdate = true;
      s.cards.visible = n > 0;
    }
  }

  stats(): { meshes: number; drawn: number; cards: number; triangles: number } {
    let drawn = 0;
    let cards = 0;
    let tris = 0;
    for (const s of [...this.statics, ...this.shared]) {
      if (!s.cards.visible || !s.cards.count) continue;
      drawn++;
      const per = (s.cards.geometry.index?.count ?? 0) / 6;
      cards += per * s.cards.count;
      tris += per * 2 * s.cards.count;
    }
    return { meshes: this.statics.length + this.shared.length, drawn, cards, triangles: tris };
  }
}
