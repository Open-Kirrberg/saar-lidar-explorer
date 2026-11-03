/**
 * Sized fixtures and furniture (merged into the room buckets): chimneypieces with trumeaux,
 * stoves (Kachelofen; O4 altar stoves in niches), pier-glasses, the Paradebett alcove, beds, tables, bookcases, vitrines, racks,
 * pictures (plain colour fields - NO artwork), kitchen hearth / potager / oven, columns.
 * Local frame as in furniture.ts (X width along the wall, Y up, Z depth, front +Z).
 */
import * as THREE from 'three';
import type { MaterialLibrary, MaterialName } from '../context.ts';
import { HEARTH, ROOM_ORDER, STATE_ROOM } from '../layout/grammar.ts';
import { type HearthKit, chimneypiece, faienceStove } from './hearth.ts';
import { type RGB, canvasGrid, meanderRects, mirrorGrid, srgbToLinear } from './finish.ts';
import { canvasParams, hangOf } from './painting.ts';
import { type Accumulator, type Bucket, type MouldProfile, type PartInfo, type V3, T, beadProfile, carvedHead, cyl, mouldFrame, placeMatrix } from './mesh.ts';
import { type InteriorExtra, type Tints, interiorMaterial, marbleMaterial } from './materials.ts';
import type { Item, SizedKind } from './programme.ts';
import { mulberry32, hashString } from '../layout/geom.ts';

export interface FixtureCtx {
  acc: Accumulator;
  lib: MaterialLibrary;
  tints: Tints;
  buildingId: string;
  roomId: string;
  floor_h: number;
  ceiling_h: number;
  /** Upholstery / silk colour of the room. */
  colour: string;
  /** Grade 'state' gets gilt mouldings. */
  state: boolean;
  /** sRGB colour of the room's walls above the dado (silk hue, boiserie white): what its mirrors reflect. */
  wall?: string;
}

const LEATHER = ['#5a2a1e', '#6e4a2a', '#3d3b2a', '#7a5a34', '#4a2c34'];

/** Build one sized item into the accumulator. */
export function buildFixture(it: Item, fc: FixtureCtx): void {
  const kind = it.kind as SizedKind;
  const info: PartInfo = { buildingId: fc.buildingId, roomId: fc.roomId, name_de: it.name_de, evidence: it.evidence, tag: it.tag, element: kind };
  const M = (m: MaterialName | InteriorExtra | THREE.Material): Bucket => {
    const mat = m instanceof THREE.Material ? m : m.startsWith('interior.') ? interiorMaterial(fc.lib, m as InteriorExtra) : fc.lib.get(m as MaterialName);
    return fc.acc.get(mat, info);
  };
  const tint = (m: MaterialName, c: string) => M(fc.tints.get(m, c));
  const [w, d, h] = it.size ?? [1, 0.5, 1];
  const base = fc.floor_h + (it.z ?? 0);
  const m = placeMatrix(it.pos, base, it.facing);
  const box = (b: Bucket, min: V3, max: V3, skip: string[] = []) => b.box(min, max, m, skip);
  const geo = (b: Bucket, g: THREE.BufferGeometry, local: THREE.Matrix4) => b.geometry(g, m.clone().multiply(local));
  const gilt = M('metal.gilt');
  const moulding = fc.state ? gilt : M('wall.boiserie');

  /** Moulded frame (KB-I26) in the local XY plane, standing on depth z0, profile `prof`. */
  const mould = (b: Bucket, x0: number, y0: number, x1: number, y1: number, prof: MouldProfile, z0 = 0) => {
    const F = (x: number, y: number, z: number): V3 => {
      const v = new THREE.Vector3(x, y, z0 + z).applyMatrix4(m);
      return [v.x, v.y, v.z];
    };
    const N = (x: number, y: number, z: number): V3 => {
      const v = new THREE.Vector3(x, y, z).transformDirection(m);
      return [v.x, v.y, v.z];
    };
    mouldFrame(b, F, N, x0, y0, x1, y1, prof);
  };
  /** Colour grid (canvas, mirror glass) on the local XY plane at depth z, sRGB colours in. */
  const grid = (b: Bucket, x0: number, y0: number, x1: number, y1: number, z: number, g: { nx: number; ny: number; colours: RGB[] }, canvas?: [number, number, number, number]) => {
    const P = (x: number, y: number): V3 => {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(m);
      return [v.x, v.y, v.z];
    };
    const nv = new THREE.Vector3(0, 0, 1).transformDirection(m);
    b.colourGrid(P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1), [nv.x, nv.y, nv.z], g.nx, g.ny, (i, j) => {
      const c = g.colours[j * g.nx + i];
      return [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
    }, canvas);
  };
  const seed = hashString(`${fc.roomId}|${it.kind}|${it.pos[0].toFixed(2)}|${it.pos[1].toFixed(2)}|${(it.z ?? 0).toFixed(2)}`);

  /** Rectangular frame of four bars in the XY plane at depth z0..z1. */
  const frame = (b: Bucket, x0: number, y0: number, x1: number, y1: number, bw: number, z0: number, z1: number) => {
    box(b, [x0, y0, z0], [x0 + bw, y1, z1]);
    box(b, [x1 - bw, y0, z0], [x1, y1, z1]);
    box(b, [x0 + bw, y0, z0], [x1 - bw, y0 + bw, z1]);
    box(b, [x0 + bw, y1 - bw, z0], [x1 - bw, y1, z1]);
  };

  switch (kind) {
    case 'fireplace':
    case 'stove': {
      // Wave-6 residuals (wave-5 review: plain white boxes with box andirons; a stove that read as a snowman): a
      // Louis-seize cheminée with console jambs, inlaid frieze, gilt-bronze mounts, cast-iron fireback and chenets, and a
      // faience column stove with tile joints, a blue-grey band and brass rings (interior/hearth.ts, grammar HEARTH) [N].
      const kit: HearthKit = {
        marble: (body, vein) => M(marbleMaterial(fc.lib, body, vein)),
        tint: (c) => tint('stone.marble', c),
        iron: tint('metal.iron', HEARTH.ironColour),
        gilt,
        box: (b, min, max, skip = []) => box(b, min, max, skip),
        geo,
      };
      if (kind === 'fireplace') chimneypiece(kit, w, d, h, fc.state);
      else faienceStove(kit, w, d, h);
      break;
    }
    case 'altar_stove': {
      // O4 (T26 Ottomeyer; T1 p. 341): altar-shaped stove of enamelled copper with gilt mounts, crowned by a bronze
      // figure (Ceres / Diana-Hebe). Proportions after the size [w, d, h] (body 0.9 x 0.6 x 1.4 m, figure 0.7 m) N;
      // enamel colour N (dark blue-grey); the figure is a plain draped silhouette, no likeness.
      const enamel = tint('stone.marble', '#27343d');
      const stone = tint('stone.marble', '#5b5650');
      const bronze = tint('metal.gilt', '#A07E46');
      const hw = w / 2;
      const hd = d / 2;
      // pedestal (stone), base moulding (gilt), die (enamel)
      box(stone, [-hw - 0.05, 0, -hd - 0.05], [hw + 0.05, 0.22, hd + 0.05], ['-y']);
      box(gilt, [-hw - 0.02, 0.22, -hd - 0.02], [hw + 0.02, 0.28, hd + 0.02], ['-y']);
      box(enamel, [-hw, 0.28, -hd], [hw, 1.68, hd], ['-y']);
      // gilt mounts: front panel frame, medallion, corner rosettes, garland swag of beads
      frame(gilt, -hw + 0.1, 0.45, hw - 0.1, 1.48, 0.03, hd, hd + 0.015);
      geo(gilt, cyl(0.13, 0.13, 0.025, 16), T(0, 0.98, hd + 0.0125).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
      for (const sx of [-1, 1]) {
        geo(gilt, new THREE.SphereGeometry(0.045, 8, 6), T(sx * (hw - 0.06), 1.6, hd + 0.01));
        for (let k = 1; k < 6; k++) {
          const x = sx * (hw - 0.06) * (1 - k / 6);
          geo(gilt, new THREE.SphereGeometry(0.022, 6, 4), T(x, 1.6 - 0.12 * Math.sin((Math.PI * k) / 6), hd + 0.01));
        }
      }
      // cornice: gilt band, enamel top slab, then the figure's plinth (bronze)
      box(gilt, [-hw - 0.03, 1.68, -hd - 0.03], [hw + 0.03, 1.74, hd + 0.03]);
      box(enamel, [-hw - 0.06, 1.74, -hd - 0.06], [hw + 0.06, 1.84, hd + 0.06]);
      geo(bronze, cyl(0.17, 0.15, 0.1, 14), T(0, 1.89, 0));
      // figure ≈ 0.75 m (h - 1.94), a draped standing goddess as a smooth silhouette (wave-5 review: the stacked
      // cylinders read as a crude toy): a lathed robe falling in a flared hem, a high-waisted bodice, shoulders under a
      // mantle, a small head with a chignon; the right arm raised with a torch, the left lowered with a sheaf [N form;
      // no likeness]. Gilt-bronze tone, one material with the plinth [N].
      const k = Math.max(0.5, h - 1.94) / 0.76;
      const y0 = 1.94;
      const fig = bronze;
      const L = (pts: [number, number][], seg: number, m: THREE.Matrix4) => geo(fig, new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x * k, y * k)), seg), m);
      const flat = (x: number, y: number, z: number, sz: number) => T(x * k, y0 + y * k, z * k).multiply(new THREE.Matrix4().makeScale(1, 1, sz));
      L([[0.001, 0], [0.135, 0], [0.14, 0.03], [0.12, 0.12], [0.1, 0.26], [0.085, 0.38], [0.072, 0.46], [0.08, 0.5], [0.088, 0.55], [0.1, 0.6], [0.06, 0.635], [0.025, 0.65], [0.001, 0.655]], 18, flat(0, 0, 0, 0.72));
      // mantle swag across the body
      geo(fig, new THREE.TorusGeometry(0.1 * k, 0.018 * k, 6, 14, Math.PI), flat(0, 0.36, 0.01, 0.6).multiply(new THREE.Matrix4().makeRotationZ(Math.PI + 0.35)));
      geo(fig, new THREE.SphereGeometry(0.052 * k, 14, 10), T(0, y0 + 0.705 * k, 0.005 * k).multiply(new THREE.Matrix4().makeScale(0.92, 1.08, 0.95)));
      geo(fig, new THREE.SphereGeometry(0.03 * k, 10, 8), T(0, y0 + 0.73 * k, -0.04 * k));
      geo(fig, cyl(0.022 * k, 0.02 * k, 0.05 * k, 8), T(0, y0 + 0.655 * k, 0));
      // right arm raised (upper arm out, forearm up) holding a torch with a flame
      const limb = (ax: number, ay: number, bx: number, by: number, r0: number, r1: number) => {
        const len = Math.hypot(bx - ax, by - ay) * k;
        const ang = Math.atan2(bx - ax, by - ay);
        geo(fig, cyl(r0 * k, r1 * k, len, 8), T(((ax + bx) / 2) * k, y0 + ((ay + by) / 2) * k, 0.01 * k).multiply(new THREE.Matrix4().makeRotationZ(-ang)));
      };
      limb(0.085, 0.61, 0.17, 0.66, 0.024, 0.02);
      limb(0.17, 0.66, 0.19, 0.8, 0.02, 0.016);
      geo(fig, cyl(0.012 * k, 0.016 * k, 0.32 * k, 8), T(0.19 * k, y0 + 0.82 * k, 0.01 * k));
      geo(fig, cyl(0.035 * k, 0.0, 0.08 * k, 8), T(0.19 * k, y0 + 1.02 * k, 0.01 * k));
      // left arm lowered along the robe, a sheaf of corn in the hand
      limb(-0.085, 0.61, -0.12, 0.45, 0.024, 0.02);
      limb(-0.12, 0.45, -0.13, 0.33, 0.02, 0.016);
      geo(fig, cyl(0.045 * k, 0.018 * k, 0.2 * k, 10), T(-0.13 * k, y0 + 0.25 * k, 0.03 * k));
      break;
    }
    case 'trumeau':
    case 'pier_glass': {
      // KB-I26 review: the glass carries a soft reflected room (finish.ts mirrorGrid) so it reads as a mirror; moulded
      // gilt frame and a cresting [N]
      const fw = Math.min(0.1, 0.06 + w * 0.02);
      grid(M('interior.mirror'), -w / 2 + fw * 0.8, fw * 0.8, w / 2 - fw * 0.8, h - fw * 0.8, 0.012, mirrorGrid(seed, w, h, { wall: fc.wall ?? '#E2DDD0' }));
      box(M('wall.boiserie'), [-w / 2, 0, 0], [w / 2, h, 0.01], ['-z']);
      mould(gilt, -w / 2, 0, w / 2, h, beadProfile(fw, 0.045), 0.01);
      // wave 11 (audit #9): the crest is a carved head - a laurel swag from a bow knot over a low tablet, draped in
      // front of the frame's top rail (was a plain half disc) [N research/09 §4.2; sizes I, ROOM_ORDER.carved]
      const C = ROOM_ORDER.carved;
      box(gilt, [-w * 0.18, h - 0.01, 0], [w * 0.18, h + 0.14, 0.03], ['-z']);
      // wave-11 review fix: the bows sit just outside the frame's top corners, so the ribbon ends and the laurel drops
      // hang beside the frame against the boiserie (the pier keeps ≥ 0.25 m beside the glass, programme.ts)
      carvedHead(gilt, m.clone().multiply(T(0, h + 0.09, 0.06)), Math.min(C.glassMax, w + 0.1), C.bead, C.sag);
      break;
    }
    case 'alcove': {
      // dais, balustrade with a central gate, pilasters and architrave framing the alcove
      const depth = d;
      const H = Math.min(fc.ceiling_h - fc.floor_h - 0.6, 3.6);
      box(M('floor.parquet'), [-w / 2, 0, -depth / 2], [w / 2, 0.15, depth / 2]);
      const zf = depth / 2 - 0.06;
      const balA = gilt;
      for (const [a, b] of [
        [-w / 2 + 0.35, -0.6],
        [0.6, w / 2 - 0.35],
      ] as [number, number][]) {
        if (b - a < 0.3) continue;
        box(balA, [a, 0.15, zf - 0.06], [b, 0.25, zf + 0.06]);
        box(balA, [a, 0.95, zf - 0.07], [b, 1.02, zf + 0.07]);
        box(balA, [a - 0.06, 0.15, zf - 0.07], [a + 0.06, 1.08, zf + 0.07]);
        box(balA, [b - 0.06, 0.15, zf - 0.07], [b + 0.06, 1.08, zf + 0.07]);
        const n = Math.floor((b - a) / 0.16);
        for (let k = 1; k < n; k++) geo(balA, cyl(0.03, 0.022, 0.7, 6), T(a + (k * (b - a)) / n, 0.6, zf));
      }
      const wb = M('wall.boiserie');
      for (const sx of [-1, 1]) box(wb, [sx * (w / 2) - (sx > 0 ? 0.4 : 0), 0.15, zf - 0.12], [sx * (w / 2) + (sx < 0 ? 0.4 : 0), H, zf + 0.06]);
      box(wb, [-w / 2, H, zf - 0.12], [w / 2, H + 0.45, zf + 0.06]);
      box(gilt, [-w / 2, H + 0.02, zf + 0.06], [w / 2, H + 0.06, zf + 0.08]);
      break;
    }
    case 'bed_romaine': {
      // two equal scrolled ends, placed long side to the wall (lit à la romaine)
      const L = w;
      box(gilt, [-L / 2, 0.08, -d / 2], [L / 2, 0.45, d / 2]);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) geo(gilt, cyl(0.04, 0.05, 0.12, 8), T(sx * (L / 2 - 0.08), 0.04, sz * (d / 2 - 0.08)));
      const silk = tint('wall.silk.crimson', fc.colour);
      box(silk, [-L / 2 + 0.1, 0.45, -d / 2 + 0.05], [L / 2 - 0.1, 0.72, d / 2 - 0.05], ['-y']);
      for (const sx of [-1, 1]) {
        box(gilt, [sx * (L / 2) - 0.06, 0.45, -d / 2], [sx * (L / 2) + 0.06, h - 0.1, d / 2]);
        geo(gilt, cyl(0.12, 0.12, d, 10), T(sx * (L / 2 - 0.02), h - 0.1, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
        geo(silk, cyl(0.13, 0.13, d - 0.2, 10), T(sx * (L / 2 - 0.25), 0.84, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
      }
      box(silk, [-L / 2 + 0.1, 0.62, -d / 2 - 0.02], [L / 2 - 0.1, 0.7, d / 2 + 0.02]);
      break;
    }
    case 'bed': {
      const wood = tint('wood.door', '#7a5534');
      box(wood, [-w / 2, 0, -d / 2], [w / 2, 0.45, d / 2]);
      box(tint('ceiling.stucco', '#f4f1ea'), [-w / 2 + 0.05, 0.45, -d / 2 + 0.05], [w / 2 - 0.05, 0.65, d / 2 - 0.05], ['-y']);
      box(tint('wall.silk.crimson', fc.colour), [-w / 2 + 0.02, 0.6, -d / 2 + 0.6], [w / 2 - 0.02, 0.68, d / 2 - 0.02]);
      box(wood, [-w / 2, 0, -d / 2], [w / 2, h, -d / 2 + 0.08], ['-z']);
      break;
    }
    case 'dais': {
      box(M('floor.parquet'), [-w / 2, 0, -d / 2], [w / 2, h, d / 2], ['-y', '-z']);
      box(tint('wall.silk.crimson', fc.colour), [-w / 2 + 0.1, h, -d / 2], [w / 2 - 0.1, h + 0.01, d / 2 - 0.1], ['-y']);
      break;
    }
    case 'baldachin': {
      // hung from the wall: canopy box with valances, side curtains down to the floor
      const silk = tint('wall.silk.crimson', fc.colour);
      box(gilt, [-w / 2, h - 0.12, 0], [w / 2, h, d], ['-z']);
      box(silk, [-w / 2 + 0.02, 0, d - 0.03], [w / 2 - 0.02, h - 0.12, d]);
      box(silk, [-w / 2, 0, 0.02], [-w / 2 + 0.03, h - 0.12, d]);
      box(silk, [w / 2 - 0.03, 0, 0.02], [w / 2, h - 0.12, d]);
      box(silk, [-w / 2 + 0.03, 0, 0], [w / 2 - 0.03, h, 0.02], ['-z']);
      const drop = it.z ?? 2;
      for (const sx of [-1, 1]) box(silk, [sx * (w / 2 - 0.12) - 0.14, -drop + 0.25, 0.03], [sx * (w / 2 - 0.12) + 0.14, 0, 0.2]);
      geo(gilt, new THREE.SphereGeometry(0.12, 8, 6), T(0, h + 0.1, d / 2));
      break;
    }
    case 'desk': {
      box(tint('wood.door', '#4e2e1a'), [-w / 2, h - 0.12, -d / 2], [w / 2, h - 0.03, d / 2]);
      box(tint('wall.silk.green', '#2f4a2c'), [-w / 2 + 0.06, h - 0.03, -d / 2 + 0.06], [w / 2 - 0.06, h, d / 2 - 0.06], ['-y']);
      box(gilt, [-w / 2, h - 0.03, -d / 2], [w / 2, h, -d / 2 + 0.06], ['-y']);
      box(gilt, [-w / 2, h - 0.03, d / 2 - 0.06], [w / 2, h, d / 2], ['-y']);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) geo(gilt, cyl(0.022, 0.035, h - 0.12, 6), T(sx * (w / 2 - 0.06), (h - 0.12) / 2, sz * (d / 2 - 0.06)));
      break;
    }
    case 'table': {
      const cloth = /Tafel/.test(it.name_de);
      const top = cloth ? tint('ceiling.stucco', '#f7f4ec') : tint('wood.door', /Arbeit|Hack/.test(it.name_de) ? '#a88a62' : '#5a3a22');
      box(top, [-w / 2, h - 0.05, -d / 2], [w / 2, h, d / 2]);
      if (cloth) {
        box(top, [-w / 2 - 0.02, h - 0.35, -d / 2 - 0.02], [w / 2 + 0.02, h - 0.05, -d / 2], []);
        box(top, [-w / 2 - 0.02, h - 0.35, d / 2], [w / 2 + 0.02, h - 0.05, d / 2 + 0.02], []);
      }
      const legs = tint('wood.door', '#5a3a22');
      const nx = Math.max(2, Math.round(w / 2.2) + 1);
      for (let k = 0; k < nx; k++) for (const sz of [-1, 1]) geo(legs, cyl(0.03, 0.045, h - 0.05, 6), T(-w / 2 + 0.1 + (k * (w - 0.2)) / (nx - 1), (h - 0.05) / 2, sz * (d / 2 - 0.1)));
      break;
    }
    case 'bookcase':
    case 'shelf':
    case 'wardrobe':
    case 'chest':
    case 'vitrine':
    case 'weapon_rack': {
      const st = it.style ?? {};
      const L = STATE_ROOM.library;
      // KB-I27: oak library cases and white-painted cabinets (T5) from the item style; otherwise as before
      const case_ = st.white ? tint('wall.boiserie', STATE_ROOM.cabinet.white) : st.oak ? tint('wood.door', L.oak) : kind === 'bookcase' && fc.state ? M('wall.boiserie') : tint('wood.door', kind === 'weapon_rack' ? '#6b4b2e' : '#7a5534');
      const z0 = -d / 2;
      if (kind === 'vitrine' && st.white) {
        whiteCabinet(it, fc, M, tint, case_, seed);
        break;
      }
      if (kind === 'bookcase' && st.oak) {
        oakBookcase(it, fc, M, tint, case_, seed);
        break;
      }
      if (kind === 'chest' || kind === 'wardrobe') {
        box(case_, [-w / 2, 0, z0], [w / 2, h, d / 2], ['-y', '-z']);
        if (kind === 'chest' && /Buffet/.test(it.name_de)) box(M('stone.marble'), [-w / 2 - 0.02, h, z0], [w / 2 + 0.02, h + 0.04, d / 2 + 0.03], ['-z']);
        const n = Math.max(1, Math.round(w / 0.7));
        for (let k = 1; k < n; k++) box(moulding, [-w / 2 + (k * w) / n - 0.01, 0.1, d / 2], [-w / 2 + (k * w) / n + 0.01, h - 0.08, d / 2 + 0.015]);
        break;
      }
      // carcass: back, sides, top, plinth
      box(case_, [-w / 2, 0, z0], [w / 2, h, z0 + 0.03], ['-z']);
      box(case_, [-w / 2, 0, z0], [-w / 2 + 0.04, h, d / 2], ['-z']);
      box(case_, [w / 2 - 0.04, 0, z0], [w / 2, h, d / 2], ['-z']);
      box(case_, [-w / 2, h - 0.1, z0], [w / 2, h, d / 2 + 0.03], ['-z']);
      box(case_, [-w / 2, 0, z0], [w / 2, 0.1, d / 2]);
      if (kind === 'vitrine') {
        box(M('glass.crown'), [-w / 2 + 0.04, Math.min(0.9, h * 0.45), d / 2 - 0.01], [w / 2 - 0.04, h - 0.1, d / 2]);
        box(case_, [-w / 2 + 0.04, Math.min(0.9, h * 0.45) - 0.05, z0], [w / 2 - 0.04, Math.min(0.9, h * 0.45), d / 2]);
        box(case_, [-w / 2 + 0.04, 0.1, d / 2 - 0.02], [w / 2 - 0.04, Math.min(0.9, h * 0.45) - 0.05, d / 2]);
        const rnd = mulberry32(hashString(`${fc.roomId}${it.pos[0]}${it.pos[1]}`));
        const obj = tint('stone.yellow', '#d8cdb4');
        for (let k = 0; k < Math.floor(w / 0.35); k++) {
          const x = -w / 2 + 0.2 + k * 0.35;
          const y = Math.min(0.9, h * 0.45) + 0.02;
          if (rnd() < 0.5) geo(obj, new THREE.SphereGeometry(0.06 + rnd() * 0.05, 8, 6), T(x, y + 0.08, 0));
          else box(obj, [x - 0.05, y, -0.05], [x + 0.05, y + 0.12 + rnd() * 0.2, 0.05]);
        }
        break;
      }
      if (kind === 'weapon_rack') {
        const iron = M('metal.iron');
        for (const y of [0.9, 1.9]) box(case_, [-w / 2, y, z0], [w / 2, y + 0.06, z0 + 0.14]);
        for (let x = -w / 2 + 0.12; x < w / 2 - 0.08; x += 0.14) box(iron, [x - 0.012, 0.12, z0 + 0.06], [x + 0.012, 1.95, z0 + 0.1]);
        break;
      }
      // shelves and contents
      const rnd = mulberry32(hashString(`${fc.roomId}|${it.pos[0].toFixed(2)}|${it.pos[1].toFixed(2)}`));
      const shelfGap = kind === 'shelf' ? 0.55 : 0.33;
      for (let y = 0.1; y < h - 0.25; y += shelfGap) {
        box(case_, [-w / 2 + 0.04, y, z0 + 0.03], [w / 2 - 0.04, y + 0.025, d / 2 - 0.01]);
        if (kind === 'bookcase') {
          let x = -w / 2 + 0.05;
          while (x < w / 2 - 0.1) {
            const run = Math.min(w / 2 - 0.05 - x, 0.25 + rnd() * 0.35);
            const bh = Math.min(shelfGap - 0.05, 0.2 + rnd() * 0.09);
            box(tint('wood.door', LEATHER[Math.floor(rnd() * LEATHER.length)]), [x, y + 0.025, z0 + 0.06], [x + run - 0.005, y + 0.025 + bh, z0 + 0.06 + 0.24]);
            x += run;
          }
        } else if (kind === 'shelf') {
          // copper pans (wave-10 review: a gilt-named copper tint was taken for the table candelabra by the viewer's
          // night.ts, which looks for the first `metal.gilt`; copper as a tinted metal of its own base)
          const cu = tint('metal.iron', '#b87333');
          for (let x = -w / 2 + 0.25; x < w / 2 - 0.2; x += 0.45) {
            const r = 0.09 + rnd() * 0.07;
            geo(cu, cyl(r, r * 1.05, 0.14 + rnd() * 0.1, 10), T(x, y + 0.025 + 0.1, 0));
          }
        }
      }
      if (kind === 'bookcase') for (let k = 1; k < Math.round(w / 0.8); k++) box(case_, [-w / 2 + (k * w) / Math.round(w / 0.8) - 0.02, 0.1, z0], [-w / 2 + (k * w) / Math.round(w / 0.8) + 0.02, h - 0.1, d / 2]);
      break;
    }
    case 'picture': {
      // KB-I27 review: a varnished canvas with tonal variation (finish.ts canvasGrid; placeholder, no artwork) in a
      // moulded gilt frame; frame width grows with the picture [N]
      const fw = Math.min(0.12, 0.05 + 0.03 * Math.max(w, h));
      {
        // wave 10: a composition of the canvas atlas (painting.ts / paintingArt.ts), dealt per wall so none repeats
        // before all of its genre hang there (the wall = room, facing and wall line); the grid stays the fallback
        const cg = canvasGrid(seed, w - 1.7 * fw, h - 1.7 * fw);
        const wallKey = `${fc.roomId}|${it.facing[0].toFixed(2)},${it.facing[1].toFixed(2)}|${Math.round(it.pos[0] * it.facing[0] + it.pos[1] * it.facing[1])}`;
        const pk = hangOf(fc.acc).pick(wallKey, cg.kind, seed);
        grid(M('interior.canvas'), -w / 2 + fw * 0.85, fw * 0.85, w / 2 - fw * 0.85, h - fw * 0.85, 0.018, cg, canvasParams(cg.kind, pk.tile, pk.mirror, w - 1.7 * fw, h - 1.7 * fw));
      }
      box(tint('wood.door', '#2a2018'), [-w / 2 + 0.02, 0.02, 0], [w / 2 - 0.02, h - 0.02, 0.016], ['-z']);
      mould(gilt, -w / 2, 0, w / 2, h, beadProfile(fw, 0.05), 0.0);
      break;
    }
    case 'sconce': {
      // KB-I26: bras de lumière, two arms with bobèches and candles on a gilt-bronze backplate [N research/09 I7]
      // wave 11 (budget for the carved heads): lighter backplate, finial and arms, same silhouette
      const iy = 0.0;
      geo(gilt, new THREE.SphereGeometry(1, 8, 6), T(0, iy + 0.18, 0.02).multiply(new THREE.Matrix4().makeScale(0.07, 0.17, 0.025)));
      geo(gilt, new THREE.SphereGeometry(0.035, 6, 4), T(0, iy + 0.36, 0.03));
      const candle = M('interior.candle');
      for (const sx of [-1, 1]) {
        geo(gilt, new THREE.TorusGeometry(0.1, 0.012, 4, 10, Math.PI), T(sx * 0.1, iy + 0.12, 0.09).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)).multiply(new THREE.Matrix4().makeRotationZ(sx > 0 ? Math.PI : 0)));
        geo(gilt, cyl(0.045, 0.03, 0.03, 8), T(sx * 0.2, iy + 0.22, 0.17));
        geo(candle, cyl(0.011, 0.011, 0.16, 6), T(sx * 0.2, iy + 0.315, 0.17));
      }
      break;
    }
    case 'candelabrum': {
      // KB-I27: six-arm gilt-bronze candelabrum on the gallery side tables (T1 pp. 374 f.) [D; form N]
      geo(gilt, cyl(0.12, 0.09, 0.05, 14), T(0, 0.025, 0));
      geo(gilt, cyl(0.03, 0.022, 0.45, 8), T(0, 0.27, 0));
      geo(gilt, new THREE.SphereGeometry(0.05, 10, 6), T(0, 0.3, 0));
      const candle = M('interior.candle');
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const r = 0.2;
        const rot = new THREE.Matrix4().makeRotationY(a);
        geo(gilt, cyl(0.009, 0.009, r, 5), T(0, 0.5, 0).multiply(rot).multiply(T(0, 0, r / 2)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
        geo(gilt, cyl(0.03, 0.02, 0.025, 8), T(Math.sin(a) * r, 0.52, Math.cos(a) * r));
        geo(candle, cyl(0.01, 0.01, 0.14, 6), T(Math.sin(a) * r, 0.6, Math.cos(a) * r));
      }
      geo(candle, cyl(0.011, 0.011, 0.16, 6), T(0, 0.62, 0));
      break;
    }
    case 'hearth':
    case 'oven': {
      const stone = M('stone.red');
      if (kind === 'oven') {
        box(M('floor.brick'), [-w / 2, 0, -d / 2], [w / 2, 1.6, d / 2], ['-y', '-z']);
        geo(M('floor.brick'), new THREE.SphereGeometry(Math.min(w, d) / 2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), T(0, 1.6, 0));
        box(M('interior.embers'), [-0.3, 0.7, d / 2 - 0.02], [0.3, 1.1, d / 2 + 0.005]);
        break;
      }
      box(stone, [-w / 2, 0, -d / 2], [w / 2, 0.45, d / 2], ['-y', '-z']);
      box(M('interior.embers'), [-w / 4, 0.45, -d / 4], [w / 4, 0.52, d / 6], ['-y']);
      const iron = M('metal.iron');
      for (const sx of [-w / 3, w / 3]) box(iron, [sx - 0.02, 0.45, -d / 3], [sx + 0.02, 0.95, d / 3]);
      box(iron, [-w / 2 + 0.2, 1.0, -0.02], [w / 2 - 0.2, 1.03, 0.02]);
      // hood (Rauchfang): mantle beam on posts, frustum up to the ceiling
      const y0 = 2.0;
      const top = Math.max(y0 + 0.6, h);
      for (const sx of [-1, 1]) box(stone, [sx * (w / 2) - 0.12, 0.45, d / 2 - 0.12], [sx * (w / 2) + 0.12, y0, d / 2 + 0.12], ['-y']);
      box(stone, [-w / 2 - 0.15, y0, -d / 2], [w / 2 + 0.15, y0 + 0.25, d / 2 + 0.15], ['-z']);
      const hood = M('render.lime');
      const b0: [number, number, number, number] = [-w / 2 - 0.1, w / 2 + 0.1, -d / 2, d / 2 + 0.1];
      const b1: [number, number, number, number] = [-w / 4, w / 4, -d / 2, -d / 2 + d * 0.45];
      const P = (x: number, y: number, z: number): V3 => {
        const v = new THREE.Vector3(x, y, z).applyMatrix4(m);
        return [v.x, v.y, v.z];
      };
      const nrm = (x: number, y: number, z: number): V3 => {
        const v = new THREE.Vector3(x, y, z).transformDirection(m);
        return [v.x, v.y, v.z];
      };
      const ya = y0 + 0.25;
      hood.quad(P(b0[0], ya, b0[3]), P(b0[1], ya, b0[3]), P(b1[1], top, b1[3]), P(b1[0], top, b1[3]), nrm(0, 0.4, 1));
      hood.quad(P(b0[0], ya, b0[2]), P(b0[0], ya, b0[3]), P(b1[0], top, b1[3]), P(b1[0], top, b1[2]), nrm(-1, 0.3, 0));
      hood.quad(P(b0[1], ya, b0[3]), P(b0[1], ya, b0[2]), P(b1[1], top, b1[2]), P(b1[1], top, b1[3]), nrm(1, 0.3, 0));
      hood.quad(P(b0[0], ya, b0[2]), P(b0[1], ya, b0[2]), P(b0[1], ya, b0[3]), P(b0[0], ya, b0[3]), nrm(0, -1, 0));
      break;
    }
    case 'potager': {
      box(M('render.lime'), [-w / 2, 0, -d / 2], [w / 2, h - 0.08, d / 2], ['-y', '-z']);
      box(M('stone.grey'), [-w / 2 - 0.03, h - 0.08, -d / 2], [w / 2 + 0.03, h, d / 2 + 0.04], ['-z']);
      const n = Math.max(2, Math.floor(w / 0.6));
      for (let k = 0; k < n; k++) {
        const x = -w / 2 + (w / n) * (k + 0.5);
        box(k % 3 === 0 ? M('interior.embers') : tint('stone.rubble', '#2b2622'), [x - 0.13, h, -0.13], [x + 0.13, h + 0.006, 0.13], ['-y']);
        box(tint('stone.rubble', '#2b2622'), [x - 0.16, h * 0.45, d / 2], [x + 0.16, h * 0.7, d / 2 + 0.005]);
      }
      break;
    }
    case 'column': {
      const st = M('stone.grey');
      const H = h;
      box(st, [-0.38, 0, -0.38], [0.38, 0.16, 0.38], ['-y']);
      geo(st, cyl(0.36, 0.34, 0.12, 16), T(0, 0.22, 0));
      const shaftH = H - 0.16 - 0.12 - 0.5;
      geo(st, cyl(0.31, 0.265, shaftH, 16), T(0, 0.28 + shaftH / 2, 0));
      geo(st, cyl(0.27, 0.35, 0.2, 16), T(0, 0.28 + shaftH + 0.1, 0));
      box(st, [-0.4, 0.28 + shaftH + 0.2, -0.4], [0.4, H, 0.4], ['+y']);
      break;
    }
    case 'instrument': {
      const brass = tint('metal.gilt', '#b08d3a');
      geo(M('glass.crown'), new THREE.SphereGeometry(0.16, 12, 8), T(-0.4, 0.3, 0));
      geo(brass, cyl(0.12, 0.12, 0.05, 12), T(-0.4, 0.03, 0));
      geo(brass, cyl(0.04, 0.04, 0.5, 8), T(0.3, 0.25, 0));
      geo(M('glass.crown'), cyl(0.25, 0.25, 0.04, 16), T(0.3, 0.5, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
      break;
    }
  }
}

type MFn = (m: MaterialName | InteriorExtra | THREE.Material) => Bucket;
type TintFn = (m: MaterialName, c: string) => Bucket;

/**
 * KB-I27 Hofbibliothek case (T5, research/10 §c.3): oak, floor to the cove cornice, a closed cupboard base, open
 * adjustable shelves of leather and vellum bindings, a Greek-key frieze ≈ 12 cm under a moulded cornice; in the room
 * so described, brass-wire doors backed with crimson taffeta instead of open shelves [D; hues and mesh pitch N/I].
 */
function oakBookcase(it: Item, fc: FixtureCtx, M: MFn, tint: TintFn, oak: Bucket, seed: number): void {
  const [w, d, h] = it.size ?? [2, 0.46, 3];
  const L = STATE_ROOM.library;
  const st = it.style ?? {};
  const m = placeMatrix(it.pos, fc.floor_h + (it.z ?? 0), it.facing);
  const box = (b: Bucket, a: V3, c: V3, skip: string[] = []) => b.box(a, c, m, skip);
  const z0 = -d / 2;
  const zf = d / 2;
  const corn = L.cornice;
  const fr = st.frieze ? L.frieze : 0;
  const top = h - corn - fr; // top of the shelf zone
  const base = 0.78; // closed cupboard base [N]
  // carcass: back, sides, plinth, base cupboard with two panelled doors and a moulded top
  box(oak, [-w / 2, 0, z0], [w / 2, h, z0 + 0.03], ['-z']);
  box(oak, [-w / 2, 0, z0], [-w / 2 + 0.05, h - corn, zf], ['-z']);
  box(oak, [w / 2 - 0.05, 0, z0], [w / 2, h - corn, zf], ['-z']);
  box(oak, [-w / 2, 0, z0], [w / 2, 0.1, zf + 0.02]);
  box(oak, [-w / 2 + 0.05, 0.1, z0], [w / 2 - 0.05, base, zf - 0.02], ['-z']);
  box(oak, [-w / 2 - 0.01, base, z0], [w / 2 + 0.01, base + 0.04, zf + 0.04], ['-z']);
  const dark = tint('wood.door', L.oakDark);
  for (const sx of [-1, 1]) box(dark, [sx > 0 ? 0.04 : -w / 2 + 0.12, 0.2, zf - 0.02], [sx > 0 ? w / 2 - 0.12 : -0.04, base - 0.1, zf - 0.01]);
  // frieze and cornice
  if (fr > 0) {
    box(dark, [-w / 2, top, z0], [w / 2, top + fr, zf + 0.005], ['-z']);
    const light = tint('wood.door', L.oakLight);
    const P = (u: number, v: number, zz: number): V3 => {
      const p = new THREE.Vector3(-w / 2 + u, top + v, zz).applyMatrix4(m);
      return [p.x, p.y, p.z];
    };
    const nv = new THREE.Vector3(0, 0, 1).transformDirection(m);
    const n: V3 = [nv.x, nv.y, nv.z];
    for (const r of meanderRects(w, fr)) light.quad(P(r.u0, r.v0, zf + 0.012), P(r.u1, r.v0, zf + 0.012), P(r.u1, r.v1, zf + 0.012), P(r.u0, r.v1, zf + 0.012), n);
  }
  box(oak, [-w / 2 - 0.02, h - corn, z0], [w / 2 + 0.02, h - corn * 0.45, zf + 0.04], ['-z']);
  box(oak, [-w / 2 - 0.04, h - corn * 0.45, z0], [w / 2 + 0.04, h, zf + 0.07], ['-z']);
  // bays: uprights every ≈ 0.8 m
  const bays = Math.max(1, Math.round(w / 0.8));
  for (let k = 1; k < bays; k++) {
    const x = -w / 2 + (k * w) / bays;
    box(oak, [x - 0.022, base, z0], [x + 0.022, top, zf]);
  }
  // open shelves with leather and vellum bindings (books of the rescued library, now Bamberg [D research/01]); behind
  // the wire doors as well (wave 10: they show where a door stands open)
  const rnd = mulberry32(seed >>> 0);
  const gap = 0.31;
  const shelves = () => {
    for (let y = base + 0.04; y < top - 0.2; y += gap) {
      box(oak, [-w / 2 + 0.05, y, z0 + 0.03], [w / 2 - 0.05, y + 0.025, zf - 0.08]);
      let x = -w / 2 + 0.06;
      while (x < w / 2 - 0.1) {
        const run = Math.min(w / 2 - 0.06 - x, 0.2 + rnd() * 0.4);
        const bh = Math.min(gap - 0.05, 0.19 + rnd() * 0.08);
        const c = rnd() < 0.18 ? '#CDBE98' : BOOKS[Math.floor(rnd() * BOOKS.length)];
        box(tint('wood.door', c), [x, y + 0.025, z0 + 0.06], [x + run - 0.006, y + 0.025 + bh, z0 + 0.06 + 0.25]);
        x += run;
      }
    }
  };
  if (st.wireDoors) {
    // brass-wire doors on crimson taffeta [D T5; N form]. Wave 10 (review leftover, pose 21: the cases read as flat red
    // gingham): each bay is a framed door; the taffeta hangs gathered in folds 5 cm behind a lozenge brass-wire lattice
    // [N grillage en losange]; one door in about four stands open with its curtain drawn, so the book backs show [I]
    shelves();
    const taffeta = tint('wall.silk.crimson', L.taffeta);
    const fold = tint('wall.silk.crimson', L.taffetaFold);
    const brass = M('metal.gilt');
    const nv = new THREE.Vector3(0, 0, 1).transformDirection(m);
    const n: V3 = [nv.x, nv.y, nv.z];
    const P = (x: number, y: number, zz: number): V3 => {
      const p = new THREE.Vector3(x, y, zz).applyMatrix4(m);
      return [p.x, p.y, p.z];
    };
    const fw = L.doorFrame;
    const y0 = base + 0.04;
    const y1 = top - 0.06;
    const openRnd = mulberry32((seed ^ 0x51ed27) >>> 0);
    for (let k = 0; k < bays; k++) {
      const x0 = -w / 2 + (k * w) / bays + (k === 0 ? 0.05 : 0.022);
      const x1 = -w / 2 + ((k + 1) * w) / bays - (k === bays - 1 ? 0.05 : 0.022);
      const open = openRnd() < L.openShare;
      if (open) {
        // the door leaf stands open at right angles on its hinge side: frame, a strip of lattice and taffeta seen edge-on
        const hx = k % 2 ? x1 : x0;
        const sx = k % 2 ? -1 : 1;
        const lw = x1 - x0;
        box(oak, [hx - sx * 0.01 - 0.012, y0, zf], [hx - sx * 0.01 + 0.012, y1, zf + lw]);
        box(taffeta, [hx - sx * 0.01 - 0.008, y0 + fw, zf + fw], [hx - sx * 0.01 + 0.008, y1 - fw, zf + lw - fw]);
        continue;
      }
      // gathered taffeta: alternating light and shaded folds, a little deeper in the fold
      const nf = Math.max(4, Math.round((x1 - x0) / 0.07));
      for (let i = 0; i < nf; i++) {
        const a = x0 + fw + ((x1 - x0 - 2 * fw) * i) / nf;
        const b = x0 + fw + ((x1 - x0 - 2 * fw) * (i + 1)) / nf;
        const zz = zf - (i % 2 ? 0.07 : 0.05);
        (i % 2 ? fold : taffeta).quad(P(a, y0 + fw, zz), P(b, y0 + fw, zz), P(b, y1 - fw, zz), P(a, y1 - fw, zz), n);
      }
      // lozenge brass wire (diagonals both ways), clipped to the door's glazing field
      const ax0 = x0 + fw;
      const ax1 = x1 - fw;
      const ay0 = y0 + fw;
      const ay1 = y1 - fw;
      const t = 0.0025;
      const zw = zf - 0.012;
      for (const dir of [1, -1]) {
        // lines y = dir·x + c across the field
        const cs = dir > 0 ? [ay0 - ax1, ay1 - ax0] : [ay0 + ax0, ay1 + ax1];
        for (let c = Math.ceil(cs[0] / L.mesh) * L.mesh; c <= cs[1]; c += L.mesh) {
          // clip x so that y stays inside [ay0, ay1]
          const xa = dir > 0 ? Math.max(ax0, ay0 - c) : Math.max(ax0, c - ay1);
          const xb = dir > 0 ? Math.min(ax1, ay1 - c) : Math.min(ax1, c - ay0);
          if (xb - xa < 0.01) continue;
          const ya = dir * xa + c;
          const yb = dir * xb + c;
          // thickness across the wire (perpendicular to the diagonal)
          const ox = t * 0.7071;
          const oy = -dir * t * 0.7071;
          brass.quad(P(xa - ox, ya - oy, zw), P(xb - ox, yb - oy, zw), P(xb + ox, yb + oy, zw), P(xa + ox, ya + oy, zw), n);
        }
      }
      // the door frame: stiles and rails standing proud of the lattice
      box(oak, [x0, y0, zf - 0.02], [x0 + fw, y1, zf + 0.02]);
      box(oak, [x1 - fw, y0, zf - 0.02], [x1, y1, zf + 0.02]);
      box(oak, [x0 + fw, y0, zf - 0.02], [x1 - fw, y0 + fw, zf + 0.02]);
      box(oak, [x0 + fw, y1 - fw, zf - 0.02], [x1 - fw, y1, zf + 0.02]);
    }
    box(oak, [-w / 2, top - 0.06, zf - 0.005], [w / 2, top, zf + 0.02]);
    return;
  }
  shelves();
}

/** Calf and morocco bindings under candle-dark varnish [N]. */
const BOOKS = ['#5a2a1e', '#6e4a2a', '#4a3423', '#7a5a34', '#4a2c34', '#3a3226', '#6b3a22'];

/**
 * KB-I27 Naturalienkabinett (T5, research/10 §c.3): white-painted glass cabinets (tall: closed base, glazed upper
 * case with shelves of spirit jars, mounted birds, shells and minerals) and display tables with glass tops (h < 1.3 m).
 * Contents are generic shapes [N]; the glass is the clear interior.vitrine.
 */
function whiteCabinet(it: Item, fc: FixtureCtx, M: MFn, tint: TintFn, white: Bucket, seed: number): void {
  const [w, d, h] = it.size ?? [2, 0.6, 2.4];
  const m = placeMatrix(it.pos, fc.floor_h + (it.z ?? 0), it.facing);
  const box = (b: Bucket, a: V3, c: V3, skip: string[] = []) => b.box(a, c, m, skip);
  const geo = (b: Bucket, g: THREE.BufferGeometry, x: number, y: number, z: number) => b.geometry(g, m.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z)));
  const glass = M('interior.vitrine');
  const rnd = mulberry32((seed ^ 0x2545f491) >>> 0);
  const jar = tint('stone.marble', '#CFC48E');
  const bird = tint('wood.door', '#6E5A44');
  const shell = tint('stone.marble', '#E3D7C3');
  const mineral = tint('stone.marble', '#8E8A86');
  const gilt = M('metal.gilt');
  const objects = (y: number, x0: number, x1: number, zc: number, depth: number) => {
    let x = x0 + 0.08;
    while (x < x1 - 0.08) {
      const r = rnd();
      if (r < 0.35) geo(jar, new THREE.CylinderGeometry(0.045, 0.05, 0.2 + rnd() * 0.08, 8), x, y + 0.12, zc);
      else if (r < 0.6) {
        geo(bird, new THREE.SphereGeometry(1, 7, 5).scale(0.05, 0.07, 0.04), x, y + 0.1, zc);
        geo(bird, new THREE.SphereGeometry(0.028, 6, 4), x, y + 0.19, zc + 0.01);
        geo(white, new THREE.CylinderGeometry(0.04, 0.05, 0.03, 8), x, y + 0.015, zc);
      } else if (r < 0.8) geo(shell, new THREE.SphereGeometry(1, 7, 4).scale(0.06, 0.035, depth * 0.12), x, y + 0.03, zc);
      else geo(mineral, new THREE.IcosahedronGeometry(0.045 + rnd() * 0.03, 0), x, y + 0.05, zc);
      x += 0.16 + rnd() * 0.12;
    }
  };
  if (h < 1.3) {
    // display table: tapered legs, a shallow white case, glass top
    const ct = h - 0.06;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) geo(white, new THREE.CylinderGeometry(0.035, 0.025, ct - 0.12, 6), sx * (w / 2 - 0.08), (ct - 0.12) / 2, sz * (d / 2 - 0.08));
    box(white, [-w / 2, ct - 0.14, -d / 2], [w / 2, ct - 0.1, d / 2]);
    for (const [a, b] of [[-w / 2, -w / 2 + 0.04], [w / 2 - 0.04, w / 2]] as [number, number][]) box(white, [a, ct - 0.1, -d / 2], [b, ct, d / 2]);
    for (const [a, b] of [[-d / 2, -d / 2 + 0.04], [d / 2 - 0.04, d / 2]] as [number, number][]) box(white, [-w / 2, ct - 0.1, a], [w / 2, ct, b]);
    box(gilt, [-w / 2, ct, -d / 2], [w / 2, ct + 0.012, -d / 2 + 0.02]);
    box(glass, [-w / 2 + 0.04, ct, -d / 2 + 0.04], [w / 2 - 0.04, ct + 0.006, d / 2 - 0.04]);
    for (const zc of [-d / 4, d / 4]) {
      let x = -w / 2 + 0.12;
      while (x < w / 2 - 0.12) {
        const r = rnd();
        geo(r < 0.5 ? shell : mineral, new THREE.SphereGeometry(1, 6, 4).scale(0.05, 0.025, 0.04), x, ct - 0.08, zc);
        x += 0.13 + rnd() * 0.1;
      }
    }
    return;
  }
  const z0 = -d / 2;
  const base = 0.85;
  box(white, [-w / 2, 0, z0], [w / 2, h, z0 + 0.03], ['-z']);
  box(white, [-w / 2, 0, z0], [-w / 2 + 0.045, h, d / 2], ['-z']);
  box(white, [w / 2 - 0.045, 0, z0], [w / 2, h, d / 2], ['-z']);
  box(white, [-w / 2, 0, z0], [w / 2, base, d / 2], ['-z']);
  box(white, [-w / 2 - 0.02, base, z0], [w / 2 + 0.02, base + 0.04, d / 2 + 0.03], ['-z']);
  box(white, [-w / 2 - 0.03, h - 0.12, z0], [w / 2 + 0.03, h, d / 2 + 0.05], ['-z']);
  box(gilt, [-w / 2 - 0.03, h - 0.13, d / 2 + 0.04], [w / 2 + 0.03, h - 0.12, d / 2 + 0.05]);
  for (const sx of [-1, 1]) box(tint('wall.boiserie', '#E2DED4'), [sx > 0 ? 0.04 : -w / 2 + 0.1, 0.12, d / 2], [sx > 0 ? w / 2 - 0.1 : -0.04, base - 0.1, d / 2 + 0.012]);
  // glazed upper case: shelves, glazing bars (two doors), glass
  const shelves = Math.max(2, Math.floor((h - base - 0.2) / 0.5));
  const step = (h - 0.12 - base - 0.04) / shelves;
  for (let k = 0; k < shelves; k++) {
    const y = base + 0.04 + k * step;
    if (k > 0) box(white, [-w / 2 + 0.045, y, z0 + 0.03], [w / 2 - 0.045, y + 0.02, d / 2 - 0.03]);
    objects(y + 0.02, -w / 2 + 0.05, w / 2 - 0.05, -0.02, d);
  }
  for (const x of [-w / 2 + 0.03, 0, w / 2 - 0.03]) box(white, [x - 0.025, base + 0.04, d / 2 - 0.02], [x + 0.025, h - 0.12, d / 2 + 0.01]);
  box(glass, [-w / 2 + 0.04, base + 0.04, d / 2 - 0.006], [w / 2 - 0.04, h - 0.12, d / 2 - 0.002]);
}
