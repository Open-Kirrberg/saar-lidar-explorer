/**
 * Stair geometry from a StairPlan: solid stone steps with a sloped soffit, landings and upper
 * slabs, balustrades (stone balusters for the Prunktreppe, iron bars for the others), and the
 * walk colliders: one inclined ramp per flight (smooth climbing), landing tops and a 1 m fence
 * along every rail so walk mode cannot fall into the well.
 */
import * as THREE from 'three';
import type { MaterialLibrary } from '../context.ts';
import type { ST } from '../spec.ts';
import { type Accumulator, type Bucket, type ColliderBucket, O, type PartInfo, type V3 } from './mesh.ts';
import type { Tints } from './materials.ts';
import { type Flight, type StairPlan, rampLine } from './stairPlan.ts';

export interface StairBuildInput {
  buildingId: string;
  roomId: string;
  name_de: string;
  plan: StairPlan;
  evidence: string;
  tag: string;
  prunk: boolean;
  /** Upper slabs are drawn by the room above (stacked storeys). */
  upperByRoom: boolean;
  acc: Accumulator;
  lib: MaterialLibrary;
  tints: Tints;
  col: ColliderBucket;
}

export const SLAB = 0.45;
const MID_SLAB = 0.35;

export function buildStair(inp: StairBuildInput): void {
  const { plan, acc, lib } = inp;
  const info = (element: string, name_de: string): PartInfo => ({ buildingId: inp.buildingId, roomId: inp.roomId, name_de, evidence: inp.evidence, tag: `${inp.tag}; ${plan.notes.join('; ')}`, element });
  const stepMat = inp.prunk ? lib.get('stone.grey') : inp.tints.get('floor.planks', '#8f7150');
  const steps = acc.get(stepMat, info('treppe', `${inp.name_de} – Stufen`));
  const under = acc.get(lib.get('ceiling.stucco'), info('treppe-unterseite', `${inp.name_de} – Untersicht`));
  for (const f of plan.flights) flight(steps, under, f, inp.prunk ? 0.32 : 0.2, inp.col);

  const landTop = acc.get(inp.prunk ? lib.get('floor.flags') : inp.tints.get('floor.planks', '#8f7150'), info('podest', `${inp.name_de} – Podest`));
  const landSide = acc.get(inp.prunk ? lib.get('stone.grey') : lib.get('wall.limewash'), info('podest', `${inp.name_de} – Podest`));
  for (const l of plan.landings) {
    const upper = l.kind !== 'mid';
    const t = upper ? SLAB : MID_SLAB;
    const r = l.rect;
    if (!(upper && inp.upperByRoom)) {
      landTop.quad(O(r.s0, r.t0, l.h), O(r.s1, r.t0, l.h), O(r.s1, r.t1, l.h), O(r.s0, r.t1, l.h), [0, 1, 0]);
      under.quad(O(r.s0, r.t0, l.h - t), O(r.s1, r.t0, l.h - t), O(r.s1, r.t1, l.h - t), O(r.s0, r.t1, l.h - t), [0, -1, 0]);
      inp.col.quad(O(r.s0, r.t0, l.h), O(r.s1, r.t0, l.h), O(r.s1, r.t1, l.h), O(r.s0, r.t1, l.h));
    }
    // edge faces (also for slabs drawn by the room above: the well edges)
    const e: [ST, ST, V3][] = [
      [[r.s0, r.t0], [r.s1, r.t0], [0, 0, 1]],
      [[r.s1, r.t0], [r.s1, r.t1], [1, 0, 0]],
      [[r.s1, r.t1], [r.s0, r.t1], [0, 0, -1]],
      [[r.s0, r.t1], [r.s0, r.t0], [-1, 0, 0]],
    ];
    for (const [p, q, n] of e) landSide.quad(O(p[0], p[1], l.h - t), O(q[0], q[1], l.h - t), O(q[0], q[1], l.h), O(p[0], p[1], l.h), n);
  }

  // balustrades
  const rail = acc.get(inp.prunk ? lib.get('stone.grey') : lib.get('metal.iron'), info('gelaender', `${inp.name_de} – Balustrade`));
  const top = acc.get(inp.prunk ? lib.get('stone.grey') : inp.tints.get('wood.door', '#5a3a22'), info('gelaender', `${inp.name_de} – Handlauf`));
  for (const r of plan.rails) balustrade(rail, top, r.p0, r.p1, r.h0, r.h1, inp.prunk, inp.col);
}

/** Steps of one flight: treads, risers, side faces down to a sloped soffit. */
function flight(b: Bucket, under: Bucket, f: Flight, thick: number, col: ColliderBucket): void {
  const n: ST = [-f.dir[1], f.dir[0]];
  const half = f.width / 2;
  const P = (x: number, y: number, h: number): V3 => O(f.start[0] + f.dir[0] * x + n[0] * y, f.start[1] + f.dir[1] * x + n[1] * y, h);
  const fwd: V3 = [f.dir[0], 0, -f.dir[1]];
  const side: V3 = [n[0], 0, -n[1]];
  const slope = f.riser / f.tread;
  const cosA = 1 / Math.sqrt(1 + slope * slope);
  const soffit = (x: number) => Math.max(f.h0, f.h0 + f.riser + x * slope - thick / cosA);
  for (let k = 1; k <= f.risers; k++) {
    const xa = (k - 1) * f.tread;
    const xb = k < f.risers ? k * f.tread : xa; // the last riser lands on the landing
    const hTop = f.h0 + k * f.riser;
    const hBot = f.h0 + (k - 1) * f.riser;
    // riser
    b.quad(P(xa, -half, hBot), P(xa, half, hBot), P(xa, half, hTop), P(xa, -half, hTop), [-fwd[0], 0, -fwd[2]]);
    if (k === f.risers) break;
    // tread (2 cm nosing)
    b.quad(P(xa - 0.02, -half, hTop), P(xb, -half, hTop), P(xb, half, hTop), P(xa - 0.02, half, hTop), [0, 1, 0]);
    b.quad(P(xa - 0.02, -half, hTop - 0.04), P(xa - 0.02, half, hTop - 0.04), P(xa - 0.02, half, hTop), P(xa - 0.02, -half, hTop), [-fwd[0], 0, -fwd[2]]);
    // sides down to the soffit
    const sa = soffit(xa);
    const sb = soffit(xb);
    for (const k2 of [-1, 1]) {
      const y = k2 * half;
      const sn: V3 = [side[0] * k2, 0, side[2] * k2];
      b.quad(P(xa, y, sa), P(xb, y, sb), P(xb, y, hTop), P(xa, y, hTop), sn);
    }
    if (sb > f.h0 + 0.01 || sa > f.h0 + 0.01) under.quad(P(xa, -half, sa), P(xb, -half, sb), P(xb, half, sb), P(xa, half, sa), [-slope * fwd[0], -1, -slope * fwd[2]]);
  }
  // ramp collider through the nosings
  const [[x0, h0], [x1, h1]] = rampLine(f);
  col.quad(P(x0, -half, h0), P(x1, -half, h1), P(x1, half, h1), P(x0, half, h0));
}

/** Balustrade from p0 to p1; walking surface h0 -> h1 (sloped on flights). */
function balustrade(b: Bucket, top: Bucket, p0: ST, p1: ST, h0: number, h1: number, stone: boolean, col: ColliderBucket): void {
  const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  if (L < 0.2) return;
  const d: ST = [(p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L];
  const n: ST = [-d[1], d[0]];
  const H = 0.95;
  const pw = stone ? 0.11 : 0.025;
  const P = (x: number, y: number, dh: number): V3 => {
    const h = h0 + ((h1 - h0) * x) / L + dh;
    return O(p0[0] + d[0] * x + n[0] * y, p0[1] + d[1] * x + n[1] * y, h);
  };
  const sideN = (k: number): V3 => [n[0] * k, 0, -n[1] * k];
  // plinth and handrail as sloped prisms
  const prism = (bk: Bucket, y0: number, y1: number, z0: number, z1: number) => {
    bk.quad(P(0, y1, z0), P(L, y1, z0), P(L, y1, z1), P(0, y1, z1), sideN(1));
    bk.quad(P(0, y0, z0), P(L, y0, z0), P(L, y0, z1), P(0, y0, z1), sideN(-1));
    bk.quad(P(0, y0, z1), P(L, y0, z1), P(L, y1, z1), P(0, y1, z1), [0, 1, 0]);
    bk.quad(P(0, y0, z0), P(L, y0, z0), P(L, y1, z0), P(0, y1, z0), [0, -1, 0]);
  };
  if (stone) prism(b, -pw, pw, 0, 0.14);
  prism(top, -pw - 0.02, pw + 0.02, H - 0.08, H);
  // balusters / bars
  const spacing = stone ? 0.24 : 0.13;
  const cnt = Math.max(1, Math.floor(L / spacing));
  const bal = stone ? new THREE.LatheGeometry(
    [
      [0.06, 0],
      [0.07, 0.04],
      [0.045, 0.1],
      [0.075, 0.3],
      [0.04, 0.55],
      [0.05, 0.62],
      [0.065, 0.66],
    ].map(([r, y]) => new THREE.Vector2(r, y)),
    6,
  ) : new THREE.BoxGeometry(0.018, 1, 0.018).translate(0, 0.5, 0);
  for (let k = 0; k < cnt; k++) {
    const x = (k + 0.5) * (L / cnt);
    const base = P(x, 0, stone ? 0.14 : 0);
    const len = stone ? 1 : H - 0.08;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(base[0], base[1], base[2]), new THREE.Quaternion(), new THREE.Vector3(1, stone ? (H - 0.08 - 0.14) / 0.66 : len, 1));
    b.geometry(bal, m);
  }
  // posts at the ends
  for (const x of [0, L]) {
    const c = P(x, 0, 0);
    b.box([c[0] - pw * 1.3, c[1], c[2] - pw * 1.3], [c[0] + pw * 1.3, c[1] + H + 0.05, c[2] + pw * 1.3]);
  }
  // fence collider
  col.quad(P(0, 0, 0), P(L, 0, 0), P(L, 0, 1.05), P(0, 0, 1.05));
}
