/**
 * Roof geometry from the pure roof section (layout/roof.ts).
 *
 * Every roof over a rectangle is generated with one rule: a point of the roof at horizontal distance `d` from
 * the nearest eaves line has height profile(d), where profile is the first half of `section.profile`. So the
 * roof is a stack of "inset rings": hipped roofs inset in s and t, gable roofs only in t (their ends are gable
 * walls following the profile). Mansards (with or without deck), hip, gable, pavilion and flat roofs all fall
 * out of this; round footprints revolve the same half profile (dome, cone).
 */
import * as THREE from 'three';
import type { RoofSection } from '../layout/roof.ts';
import { ROOF_COVER } from '../layout/grammar.ts';
import type { GeoBuilder, MatKey, P3 } from './builder.ts';

/**
 * KB-I18: a mansard whose upper slope (Terrasson) is flatter than ROOF_COVER.leadDeckMaxPitch is a lead flat
 * (Plattform), not slate or tile [HMS flat light deck; research/09 §2.6, E9]. True for the profile segment starting at
 * distance `d0` from the eaves line.
 */
export function isLeadDeckSegment(section: RoofSection, d0: number): boolean {
  if (section.type !== 'mansard' || section.break_inset === undefined) return false;
  return section.pitch_upper < ROOF_COVER.leadDeckMaxPitch && d0 >= section.break_inset - 1e-6;
}

/** First half of the section profile as [d, h] with d = distance from the eaves line (0 … ≤ depth/2). */
export function halfProfile(section: RoofSection, overhang = 0): [number, number][] {
  const half = section.depth / 2;
  const pts: [number, number][] = [];
  for (const [t, h] of section.profile) {
    if (t <= 1e-6) pts.push([t + half, h]);
    else break;
  }
  if (pts.length === 1) pts.push([half, section.ridge_h]);
  if (overhang > 0 && pts.length >= 2) {
    const [d0, h0] = pts[0];
    const [d1, h1] = pts[1];
    const slope = d1 - d0 > 1e-6 ? (h1 - h0) / (d1 - d0) : 0;
    pts.unshift([-overhang, h0 - overhang * slope]);
  }
  return pts;
}

export interface RectRoofOptions {
  /** Centre of the roof rectangle along s (raised centre sections). */
  sMid?: number;
  /** Length along s and depth along t (eaves line). */
  length: number;
  depth: number;
  hipped: boolean;
  /** Rafter overhang beyond the eaves line (farm buildings). */
  overhang?: number;
  roofKey: MatKey;
  /** Gable wall material (gable roofs). */
  gableKey: MatKey;
  /** Deck / flat top material (mansard deck, flat roofs). */
  deckKey?: MatKey;
}

/** Roof over a rectangle centred at (sMid, 0). Returns the top height. */
export function rectRoof(g: GeoBuilder, section: RoofSection, o: RectRoofOptions): number {
  const sm = o.sMid ?? 0;
  const ov = o.overhang ?? 0;
  const prof = halfProfile(section, ov);
  const L2 = o.length / 2;
  const D2 = o.depth / 2;
  const Ls = (d: number) => (o.hipped ? Math.max(0, L2 - d) : L2 + ov);
  const Dt = (d: number) => Math.max(0, D2 - d);
  for (let i = 1; i < prof.length; i++) {
    const [d0, h0] = prof[i - 1];
    const [d1, h1] = prof[i];
    const k = isLeadDeckSegment(section, d0) ? (o.deckKey ?? o.roofKey) : o.roofKey;
    const a0 = Ls(d0);
    const a1 = Ls(d1);
    const b0 = Dt(d0);
    const b1 = Dt(d1);
    const P = (s: number, t: number, h: number): P3 => [sm + s, t, h];
    // garden (−t), court (+t)
    g.quad(k, P(-a0, -b0, h0), P(a0, -b0, h0), P(a1, -b1, h1), P(-a1, -b1, h1));
    g.quad(k, P(a0, b0, h0), P(-a0, b0, h0), P(-a1, b1, h1), P(a1, b1, h1));
    if (o.hipped) {
      g.quad(k, P(a0, -b0, h0), P(a0, b0, h0), P(a1, b1, h1), P(a1, -b1, h1));
      g.quad(k, P(-a0, b0, h0), P(-a0, -b0, h0), P(-a1, -b1, h1), P(-a1, b1, h1));
    }
    if (d0 < 0) {
      // soffit under the overhang (seen from below)
      g.quad(k, P(-a1, -b1, h1 - 0.02), P(a1, -b1, h1 - 0.02), P(a0, -b0, h0 - 0.02), P(-a0, -b0, h0 - 0.02));
      g.quad(k, P(a1, b1, h1 - 0.02), P(-a1, b1, h1 - 0.02), P(-a0, b0, h0 - 0.02), P(a0, b0, h0 - 0.02));
    }
  }
  const [dTop, hTop] = prof[prof.length - 1];
  const at = Ls(dTop);
  const bt = Dt(dTop);
  if (bt > 0.01 && at > 0.01) {
    const P = (s: number, t: number): P3 => [sm + s, t, hTop];
    g.quad(o.deckKey ?? o.roofKey, P(-at, -bt), P(at, -bt), P(at, bt), P(-at, bt));
  }
  if (!o.hipped) {
    // gable walls (profile without the overhang), facing ±s
    const full = halfProfile(section, 0);
    const pts = (s: number): P3[] => {
      const left = full.map(([d, h]): P3 => [sm + s, -D2 + d, h]);
      const right = full
        .slice()
        .reverse()
        .map(([d, h]): P3 => [sm + s, D2 - d, h]);
      // drop duplicated apex
      if (right.length && left.length && Math.abs(right[0][1] - left[left.length - 1][1]) < 1e-6) right.shift();
      return [...left, ...right];
    };
    g.polygonFacing(o.gableKey, pts(L2), [1, 0, 0]);
    g.polygonFacing(o.gableKey, pts(-L2), [-1, 0, 0]);
  }
  return hTop;
}

/**
 * Revolved roof (dome, cone, round pavilion) over a circle of `radius` at (sc, tc). Normals are smooth round the
 * circle (wave-4 review: the faceted lead dome read as polished metal) and, for domes (`smoothProfile`), also along the
 * profile; a cone keeps its straight slope normal.
 */
export function roundRoof(g: GeoBuilder, section: RoofSection, radius: number, key: MatKey, sc = 0, tc = 0, segments = 32, smoothProfile = section.type === 'dome', gores?: { count: number; keys: readonly MatKey[] }): void {
  // wave-10 review: optional gores (sheet-lead panels between roll seams at angles (j + 0.5) / count): segment j takes
  // gore key floor((j / perGore) + 0.5) - `segments` must be a multiple of 2 · count for the edges to meet the seams
  const perGore = gores ? segments / gores.count : 0;
  const keyOf = (j: number): MatKey => (gores && perGore >= 2 ? gores.keys[Math.floor(j / perGore + 0.5) % gores.keys.length] : key);
  const prof = halfProfile(section).map(([d, h]): [number, number] => [radius * (1 - d / (section.depth / 2)), h]);
  // outward profile normals (radial, vertical) per segment, then per ring
  const segN = prof.slice(1).map(([r1, h1], i): [number, number] => {
    const [r0, h0] = prof[i];
    const l = Math.hypot(r1 - r0, h1 - h0) || 1;
    return [(h1 - h0) / l, -(r1 - r0) / l];
  });
  const ringN = (i: number, seg: number): [number, number] => {
    if (!smoothProfile) return segN[seg];
    const a = segN[Math.max(0, i - 1)];
    const b = segN[Math.min(segN.length - 1, i)];
    // a sharp corner (stepped dome: cornice, ledge, lantern) keeps the segment's own normal [wave-5 fix]
    if (a[0] * b[0] + a[1] * b[1] < 0.8) return segN[seg];
    const n: [number, number] = [a[0] + b[0], a[1] + b[1]];
    const l = Math.hypot(n[0], n[1]) || 1;
    return [n[0] / l, n[1] / l];
  };
  const nrm = (n: [number, number], c: number, s: number) => new THREE.Vector3(n[0] * c, n[1], -n[0] * s); // object (s, h, −t)
  for (let j = 0; j < segments; j++) {
    const a0 = (j / segments) * Math.PI * 2;
    const a1 = ((j + 1) / segments) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    for (let i = 1; i < prof.length; i++) {
      const [r0, h0] = prof[i - 1];
      const [r1, h1] = prof[i];
      const P = (r: number, c: number, s: number, h: number): P3 => [sc + r * c, tc + r * s, h];
      const nb = ringN(i - 1, i - 1);
      const nt = ringN(i, i - 1);
      // CCW seen from outside: going around counter-clockwise in plan
      const p00 = P(r0, c0, s0, h0);
      const p10 = P(r0, c1, s1, h0);
      const p11 = P(r1, c1, s1, h1);
      const p01 = P(r1, c0, s0, h1);
      const k = keyOf(j);
      g.tri(k, p00, p10, p11, [nrm(nb, c0, s0), nrm(nb, c1, s1), nrm(nt, c1, s1)]);
      g.tri(k, p00, p11, p01, [nrm(nb, c0, s0), nrm(nt, c1, s1), nrm(nt, c0, s0)]);
    }
  }
}

/** A smooth dome profile (for domes the section profile is a polyline; give it more points). */
export function domeSection(section: RoofSection, steps = 8): RoofSection {
  // a stepped dome's profile is final (layout/roof.ts steppedDomeSection)
  if (section.type !== 'dome' || (section.tiers ?? 1) >= 2) return section;
  const half = section.depth / 2;
  const prof: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    prof.push([-half * Math.cos(a), section.eaves_h + section.rise * Math.sin(a)]);
  }
  for (let i = steps - 1; i >= 0; i--) {
    const a = (i / steps) * (Math.PI / 2);
    prof.push([half * Math.cos(a), section.eaves_h + section.rise * Math.sin(a)]);
  }
  return { ...section, profile: prof };
}
