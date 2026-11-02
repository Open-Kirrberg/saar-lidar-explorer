/**
 * Sized fixtures and furniture (merged into the room buckets): chimneypieces with trumeaux,
 * stoves, pier-glasses, the Paradebett alcove, beds, tables, bookcases, vitrines, racks,
 * pictures (plain colour fields - NO artwork), kitchen hearth / potager / oven, columns.
 * Local frame as in furniture.ts (X width along the wall, Y up, Z depth, front +Z).
 */
import * as THREE from 'three';
import type { MaterialLibrary, MaterialName } from '../context.ts';
import type { ST } from '../spec.ts';
import { type Accumulator, type Bucket, type PartInfo, type V3, placeMatrix } from './mesh.ts';
import { type InteriorExtra, type Tints, interiorMaterial } from './materials.ts';
import { type Item, type SizedKind, wallPoint, type RoomWall } from './programme.ts';
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
}

const LEATHER = ['#5a2a1e', '#6e4a2a', '#3d3b2a', '#7a5a34', '#4a2c34'];
const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
const cyl = (rBottom: number, rTop: number, h: number, seg = 8) => new THREE.CylinderGeometry(rTop, rBottom, h, seg);

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

  /** Rectangular frame of four bars in the XY plane at depth z0..z1. */
  const frame = (b: Bucket, x0: number, y0: number, x1: number, y1: number, bw: number, z0: number, z1: number) => {
    box(b, [x0, y0, z0], [x0 + bw, y1, z1]);
    box(b, [x1 - bw, y0, z0], [x1, y1, z1]);
    box(b, [x0 + bw, y0, z0], [x1 - bw, y0 + bw, z1]);
    box(b, [x0 + bw, y1 - bw, z0], [x1 - bw, y1, z1]);
  };

  switch (kind) {
    case 'fireplace': {
      const mb = M('stone.marble');
      const zb = -d / 2;
      box(mb, [-w / 2, 0, zb], [-w / 2 + 0.24, 1.0, d / 2], ['-y', '-z']);
      box(mb, [w / 2 - 0.24, 0, zb], [w / 2, 1.0, d / 2], ['-y', '-z']);
      box(mb, [-w / 2 + 0.24, 0.84, zb], [w / 2 - 0.24, 1.0, d / 2 - 0.02], ['-z']);
      box(mb, [-w / 2 - 0.06, 1.0, zb], [w / 2 + 0.06, h, d / 2 + 0.05], ['-z']);
      box(mb, [-w / 2 - 0.12, 0, zb], [w / 2 + 0.12, 0.03, d / 2 + 0.4], ['-y']);
      box(tint('stone.rubble', '#2b2622'), [-w / 2 + 0.24, 0.03, zb], [w / 2 - 0.24, 0.84, zb + 0.06], ['-y']);
      box(gilt, [-0.18, 0.88, d / 2 - 0.02], [0.18, 0.96, d / 2 + 0.005]);
      // andirons and logs - summer 1789: the fire is not lit
      const iron = M('metal.iron');
      for (const sx of [-0.28, 0.28]) box(iron, [sx - 0.02, 0.03, zb + 0.12], [sx + 0.02, 0.32, d / 2 - 0.02]);
      geo(tint('wood.door', '#5a3a22'), cyl(0.06, 0.06, 0.7, 6), T(0, 0.12, zb + 0.18).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
      break;
    }
    case 'stove': {
      const fa = tint('stone.marble', '#f3f0e8');
      box(fa, [-w / 2, 0, -d / 2], [w / 2, 0.3, d / 2], ['-y', '-z']);
      box(fa, [-w / 2 + 0.05, 0.3, -d / 2], [w / 2 - 0.05, 1.5, d / 2 - 0.05], ['-z']);
      box(fa, [-w / 2, 1.5, -d / 2], [w / 2, 1.6, d / 2], ['-z']);
      geo(fa, cyl(0.36, 0.3, Math.max(0.4, h - 1.9), 12), T(0, 1.6 + Math.max(0.4, h - 1.9) / 2, 0));
      geo(fa, new THREE.SphereGeometry(0.18, 10, 6), T(0, h - 0.15, 0));
      break;
    }
    case 'trumeau':
    case 'pier_glass': {
      box(M('interior.mirror'), [-w / 2 + 0.06, 0.06, 0], [w / 2 - 0.06, h - 0.06, 0.015], ['-z']);
      frame(gilt, -w / 2, 0, w / 2, h, 0.075, 0, 0.045);
      box(gilt, [-w / 4, h, 0], [w / 4, h + 0.22, 0.04]);
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
      const case_ = kind === 'bookcase' && fc.state ? M('wall.boiserie') : tint('wood.door', kind === 'weapon_rack' ? '#6b4b2e' : '#7a5534');
      const z0 = -d / 2;
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
          const cu = tint('metal.gilt', '#b87333');
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
      box(tint('ceiling.stucco', it.colour ?? '#6b4f3a'), [-w / 2 + 0.06, 0.06, 0], [w / 2 - 0.06, h - 0.06, 0.02], ['-z']);
      frame(gilt, -w / 2, 0, w / 2, h, 0.07, 0, 0.05);
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

/** Point on a wall at height h (object space). */
export function wallPointO(w: RoomWall, u: number, inset: number, h: number): V3 {
  const p: ST = wallPoint(w, u, inset);
  return [p[0], h, -p[1]];
}
