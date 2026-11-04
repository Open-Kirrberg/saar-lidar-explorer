/**
 * Roof solids in building-local (s, t, h) built from layout RoofSection + RoofPlan (pure).
 * Used by elevations (visible faces), sections (heightfield along a cut) and the mansard plan
 * (level set of the roof surface at the cut height).
 *
 * A raised section (layout/raised.ts) sits on top of the main roof, which runs the full length
 * (as the 3D exterior builds it): the combined surface is the maximum of both [I, see raised.ts].
 */
import type { BuildingLayout } from '../../../model/src/layout/building.ts';
import { type RaisedRoof, raisedRoofs } from '../../../model/src/layout/raised.ts';
import type { RoofSection } from '../../../model/src/layout/roof.ts';

export type V3 = [number, number, number];

export interface Face {
  pts: V3[];
  kind: 'roof' | 'deck' | 'gable';
}

export interface RoofSolid {
  faces: Face[];
  /** Height of the roof surface at (s, t), NaN outside the eaves rectangle / where no roof. */
  heightAt(s: number, t: number): number;
  /** Extent along s (centre-relative). */
  s0: number;
  s1: number;
}

/** Faces of one roof over a rectangle length × depth centred at (sMid, 0). */
export function roofSolid(sec: RoofSection, length: number, sMid = 0, hipped = true): RoofSolid {
  const a = length / 2;
  const b = sec.depth / 2;
  const e = sec.eaves_h;
  const H = sec.ridge_h;
  const P = (s: number, t: number, h: number): V3 => [sMid + s, t, h];
  const faces: Face[] = [];
  const E1 = P(-a, -b, e);
  const E2 = P(a, -b, e);
  const E3 = P(a, b, e);
  const E4 = P(-a, b, e);
  const hip = (lo: [V3, V3, V3, V3], aa: number, bb: number, h0: number, top: number) => {
    // hipped roof from rectangle lo (garden, end_b, court, end_a corners) to a ridge on t = 0
    const r = Math.max(0, aa - bb);
    const R1 = P(-r, 0, top);
    const R2 = P(r, 0, top);
    void h0;
    faces.push({ pts: [lo[0], lo[1], R2, R1], kind: 'roof' });
    faces.push({ pts: [lo[1], lo[2], R2], kind: 'roof' });
    faces.push({ pts: [lo[2], lo[3], R1, R2], kind: 'roof' });
    faces.push({ pts: [lo[3], lo[0], R1], kind: 'roof' });
  };
  switch (sec.type) {
    case 'hip':
    case 'pavilion':
      hip([E1, E2, E3, E4], a, b, e, H);
      break;
    case 'gable': {
      const R1 = P(-a, 0, H);
      const R2 = P(a, 0, H);
      faces.push({ pts: [E1, E2, R2, R1], kind: 'roof' });
      faces.push({ pts: [E3, E4, R1, R2], kind: 'roof' });
      faces.push({ pts: [E2, E3, R2], kind: 'gable' });
      faces.push({ pts: [E4, E1, R1], kind: 'gable' });
      break;
    }
    case 'mansard': {
      const bi = sec.break_inset ?? 0;
      const hb = sec.break_h ?? e;
      const ai = hipped ? a - bi : a;
      const B1 = P(-ai, -(b - bi), hb);
      const B2 = P(ai, -(b - bi), hb);
      const B3 = P(ai, b - bi, hb);
      const B4 = P(-ai, b - bi, hb);
      faces.push({ pts: [E1, E2, B2, B1], kind: 'roof' });
      faces.push({ pts: [E3, E4, B4, B3], kind: 'roof' });
      if (hipped) {
        faces.push({ pts: [E2, E3, B3, B2], kind: 'roof' });
        faces.push({ pts: [E4, E1, B1, B4], kind: 'roof' });
      }
      if (sec.deck_width > 0) faces.push({ pts: [B1, B2, B3, B4], kind: 'deck' });
      else if (hipped) hip([B1, B2, B3, B4], ai, b - bi, hb, H);
      else {
        const R1 = P(-a, 0, H);
        const R2 = P(a, 0, H);
        faces.push({ pts: [B1, B2, R2, R1], kind: 'roof' });
        faces.push({ pts: [B3, B4, R1, R2], kind: 'roof' });
        faces.push({ pts: [E2, E3, B3, R2, B2], kind: 'gable' });
        faces.push({ pts: [E4, E1, B1, R1, B4], kind: 'gable' });
      }
      break;
    }
    case 'cone':
    case 'dome': {
      const nSeg = 24;
      const rings = sec.type === 'cone' ? 1 : 6;
      const prof = (k: number): [number, number] => {
        // radius fraction and height at ring k (0 = eaves, rings = top)
        const f = k / rings;
        if (sec.type === 'cone') return [1 - f, e + f * (H - e)];
        const ang = (f * Math.PI) / 2;
        return [Math.cos(ang), e + Math.sin(ang) * (H - e)];
      };
      for (let k = 0; k < rings; k++) {
        const [r0, h0] = prof(k);
        const [r1, h1] = prof(k + 1);
        for (let i = 0; i < nSeg; i++) {
          const a0 = (i / nSeg) * 2 * Math.PI;
          const a1 = ((i + 1) / nSeg) * 2 * Math.PI;
          const q = (r: number, an: number, h: number): V3 => P(Math.cos(an) * r * a, Math.sin(an) * r * b, h);
          faces.push({ pts: r1 > 1e-6 ? [q(r0, a0, h0), q(r0, a1, h0), q(r1, a1, h1), q(r1, a0, h1)] : [q(r0, a0, h0), q(r0, a1, h0), q(0, 0, h1)], kind: 'roof' });
        }
      }
      break;
    }
    case 'flat':
      faces.push({ pts: [E1, E2, E3, E4], kind: 'deck' });
      break;
    default:
      break;
  }
  const planes = faces.filter((f) => f.kind !== 'gable').map(planeOf).filter((p): p is Plane => p !== null);
  const heightAt = (s: number, t: number): number => {
    const ls = s - sMid;
    if (Math.abs(ls) > a + 1e-6 || Math.abs(t) > b + 1e-6) return NaN;
    if (sec.type === 'dome' || sec.type === 'cone') {
      const q = Math.hypot(ls / a, t / b);
      if (q > 1) return NaN;
      return sec.type === 'cone' ? e + (1 - q) * (H - e) : e + Math.sqrt(Math.max(0, 1 - q * q)) * (H - e);
    }
    if (!planes.length) return sec.type === 'none' || sec.type === 'mound' ? NaN : e;
    let h = Infinity;
    for (const p of planes) h = Math.min(h, p.a * s + p.b * t + p.c);
    return Math.max(e, h);
  };
  return { faces, heightAt, s0: sMid - a, s1: sMid + a };
}

interface Plane {
  a: number;
  b: number;
  c: number;
}

/** h = a·s + b·t + c through a face (null for vertical faces). */
export function planeOf(f: Face): Plane | null {
  const [p, q, r] = f.pts;
  const u: V3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const v: V3 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
  const nx = u[1] * v[2] - u[2] * v[1];
  const ny = u[2] * v[0] - u[0] * v[2];
  const nz = u[0] * v[1] - u[1] * v[0];
  if (Math.abs(nz) < 1e-9) return null;
  const a = -nx / nz;
  const b = -ny / nz;
  return { a, b, c: p[2] - a * p[0] - b * p[1] };
}

export interface BuildingRoof {
  main: RoofSolid;
  raised: { rr: RaisedRoof; solid: RoofSolid }[];
  /** Combined height: maximum of the main roof and the raised roofs over their s-range. */
  heightAt(s: number, t: number): number;
  /** Lantern / turret boxes (s-range, t half-width, base, top). */
  turrets: { s0: number; s1: number; tw: number; base: number; top: number }[];
}

export function buildingRoof(L: BuildingLayout): BuildingRoof {
  const hipped = L.roofSpec.type === 'mansard' ? (L.roofSpec.hipped_ends ?? true) : true;
  const main = roofSolid(L.roof, L.frame.length, 0, hipped);
  const raised = raisedRoofs(L).map((rr) => ({ rr, solid: roofSolid(rr.section, rr.length, rr.sMid, true) }));
  const turrets = raised
    .filter((r) => r.rr.turret)
    .map((r) => ({ s0: r.rr.sMid - r.rr.turret!.width / 2, s1: r.rr.sMid + r.rr.turret!.width / 2, tw: r.rr.turret!.width / 2, base: r.rr.turret!.base_h, top: r.rr.turret!.top_h }));
  return {
    main,
    raised,
    turrets,
    heightAt(s, t) {
      let h = main.heightAt(s, t);
      for (const r of raised) {
        if (s < r.solid.s0 - 1e-9 || s > r.solid.s1 + 1e-9) continue;
        const hr = r.solid.heightAt(s, t);
        if (Number.isFinite(hr) && !(hr <= h)) h = hr;
      }
      return h;
    },
  };
}

/**
 * Level set {(s,t) : roof height >= h} of a planar roof, clipped to [sLo, sHi]: convex polygon
 * (Sutherland–Hodgman of the eaves rectangle against every roof plane).
 */
export function roofLevelSet(solid: RoofSolid, sec: RoofSection, length: number, sMid: number, h: number, sLo = -Infinity, sHi = Infinity): [number, number][] {
  const a = length / 2;
  const b = sec.depth / 2;
  let poly: [number, number][] = [
    [Math.max(sMid - a, sLo), -b],
    [Math.min(sMid + a, sHi), -b],
    [Math.min(sMid + a, sHi), b],
    [Math.max(sMid - a, sLo), b],
  ];
  if (poly[1][0] <= poly[0][0]) return [];
  const planes = solid.faces.filter((f) => f.kind === 'roof').map(planeOf).filter((p): p is Plane => p !== null);
  for (const p of planes) {
    const f = (q: [number, number]) => p.a * q[0] + p.b * q[1] + p.c - h;
    const out: [number, number][] = [];
    for (let i = 0; i < poly.length; i++) {
      const A = poly[i];
      const B = poly[(i + 1) % poly.length];
      const fa = f(A);
      const fb = f(B);
      if (fa >= 0) out.push(A);
      if (fa >= 0 !== fb >= 0) {
        const t = fa / (fa - fb);
        out.push([A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])]);
      }
    }
    poly = out;
    if (!poly.length) break;
  }
  return poly;
}
