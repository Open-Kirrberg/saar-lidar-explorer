/**
 * Pure wall helpers for the interiors (no three.js).
 *
 * A wall is described in its own 2D coordinates: u = metres along the room edge (0 … length),
 * v = metres above the room floor (0 … height). Openings are holes [u0, u1] × [v0, v1].
 * These helpers give the solid rectangles of a wall face, the free intervals at a height
 * (skirting, chair rail) and the Louis-seize panel layout of a boiserie (02 §2.12 [N]).
 */
import type { HeadForm } from '../spec.ts';

export interface Hole {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  head?: HeadForm;
  id?: string;
  /**
   * Splay (ébrasement) of a deep facade reveal at the room face, m per side (fix round 1): the jambs open
   * towards the room so the glass stays visible at oblique views through 1.0-1.5 m walls. 0/undefined = square.
   */
  splay?: number;
}

/** Splay for a facade reveal of `depth` m (straight heads only): 0.25 x depth, max 0.22 m per side [N]. */
export function revealSplay(depth: number, head: HeadForm | undefined): number {
  if (head && head !== 'straight') return 0;
  if (depth < 0.45) return 0;
  return Math.min(0.22, 0.25 * depth);
}

export interface WallRect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

const EPS = 1e-6;

/** Clip a hole to the wall; null when nothing remains. */
export function clipHole(h: Hole, length: number, height: number): Hole | null {
  const u0 = Math.max(0, h.u0);
  const u1 = Math.min(length, h.u1);
  const v0 = Math.max(0, h.v0);
  const v1 = Math.min(height, h.v1);
  if (u1 - u0 < 1e-4 || v1 - v0 < 1e-4) return null;
  return { ...h, u0, u1, v0, v1 };
}

function mergeIntervals(iv: [number, number][]): [number, number][] {
  const s = iv.slice().sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + EPS) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Complement of intervals within [lo, hi]. */
export function freeIntervals(lo: number, hi: number, taken: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let x = lo;
  for (const [a, b] of mergeIntervals(taken)) {
    if (b <= lo || a >= hi) continue;
    if (a > x + EPS) out.push([x, Math.min(a, hi)]);
    x = Math.max(x, b);
  }
  if (hi > x + EPS) out.push([x, hi]);
  return out;
}

/**
 * Solid rectangles of the wall [0, length] × [0, height] minus the holes. Columns are cut at
 * every hole edge; vertically identical neighbouring columns are merged again.
 */
export function solidRects(length: number, height: number, holes: Hole[]): WallRect[] {
  const hs = holes.map((h) => clipHole(h, length, height)).filter((h): h is Hole => h !== null);
  const xs = [...new Set([0, length, ...hs.flatMap((h) => [h.u0, h.u1])])].sort((a, b) => a - b);
  const cols: { u0: number; u1: number; spans: [number, number][] }[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i];
    const b = xs[i + 1];
    if (b - a < EPS) continue;
    const cover = hs.filter((h) => h.u0 <= a + EPS && h.u1 >= b - EPS).map((h) => [h.v0, h.v1] as [number, number]);
    cols.push({ u0: a, u1: b, spans: freeIntervals(0, height, cover) });
  }
  const out: WallRect[] = [];
  const open = new Map<string, WallRect>();
  for (const c of cols) {
    const next = new Map<string, WallRect>();
    for (const [v0, v1] of c.spans) {
      const key = `${v0.toFixed(5)}:${v1.toFixed(5)}`;
      const prev = open.get(key);
      if (prev && Math.abs(prev.u1 - c.u0) < EPS) {
        prev.u1 = c.u1;
        next.set(key, prev);
      } else {
        const r = { u0: c.u0, u1: c.u1, v0, v1 };
        out.push(r);
        next.set(key, r);
      }
    }
    open.clear();
    for (const [k, v] of next) open.set(k, v);
  }
  return out;
}

/** Intervals of u where no hole covers the height band [va, vb] (va == vb: a single height). */
export function freeAlong(length: number, holes: Hole[], va: number, vb = va): [number, number][] {
  const taken = holes.filter((h) => h.v0 < vb + EPS && h.v1 > va - EPS).map((h) => [h.u0, h.u1] as [number, number]);
  return freeIntervals(0, length, taken);
}

/** Total area of rectangles (tests / budgets). */
export function rectsArea(rs: WallRect[]): number {
  return rs.reduce((s, r) => s + (r.u1 - r.u0) * (r.v1 - r.v0), 0);
}

// ---------------------------------------------------------------------------------------------
// Boiserie panel layout (Louis-seize: rectangular fields, dado, overdoors) [N] 02 §2.12
// ---------------------------------------------------------------------------------------------

export type PanelKind = 'dado' | 'upper' | 'overdoor' | 'allege';

export interface Panel extends WallRect {
  kind: PanelKind;
}

export interface BoiserieOptions {
  /** Top of the skirting (m above floor). */
  skirting: number;
  /** Chair-rail height = top of the dado (lambris d'appui), ≈ 0.85-0.95 m [N]. */
  dado: number;
  /** Top of the panelled zone (under the cornice). */
  top: number;
  /** Panel margins from pier edges and between panels (m). */
  margin: number;
  /** Maximum width of one upper field before a pier is split (m). */
  maxUpper: number;
  maxDado: number;
}

export const DEFAULT_BOISERIE: Omit<BoiserieOptions, 'top'> = {
  skirting: 0.16,
  dado: 0.9,
  margin: 0.14,
  maxUpper: 1.7,
  maxDado: 1.5,
};

function splitInterval(a: number, b: number, margin: number, maxW: number, minW: number): [number, number][] {
  const w = b - a - 2 * margin;
  if (w < minW) return [];
  const n = Math.max(1, Math.ceil((w + margin) / (maxW + margin) - 1e-9));
  const pw = (w - (n - 1) * margin) / n;
  return Array.from({ length: n }, (_, i) => [a + margin + i * (pw + margin), a + margin + i * (pw + margin) + pw] as [number, number]);
}

/** Panel fields of one boiserie wall. All panels lie inside the wall and outside every hole. */
export function boiseriePanels(length: number, holes: Hole[], o: BoiserieOptions): Panel[] {
  const out: Panel[] = [];
  const m = o.margin;
  // upper fields on piers free over the whole upper band
  const upperA = o.dado + 0.3;
  const upperB = o.top - 0.22;
  if (upperB - upperA > 0.6) {
    for (const [a, b] of freeAlong(length, holes, upperA, upperB)) {
      for (const [u0, u1] of splitInterval(a, b, m, o.maxUpper, 0.3)) out.push({ kind: 'upper', u0, u1, v0: upperA, v1: upperB });
    }
  }
  // dado fields
  const dA = o.skirting + 0.08;
  const dB = o.dado - 0.08;
  if (dB - dA > 0.25) {
    // windows interrupt the dado too (their allège panel sits below them)
    const cols = holes.map((h) => ({ ...h, v0: Math.min(h.v0, dA) }));
    for (const [a, b] of freeAlong(length, cols, dA, dB)) {
      for (const [u0, u1] of splitInterval(a, b, m * 0.7, o.maxDado, 0.25)) out.push({ kind: 'dado', u0, u1, v0: dA, v1: dB });
    }
  }
  for (const h of holes) {
    const w = h.u1 - h.u0;
    // overdoor (dessus-de-porte) above doors
    if (h.v0 < 0.05 && o.top - 0.15 - (h.v1 + 0.22) > 0.45 && w > 0.5) {
      out.push({ kind: 'overdoor', u0: h.u0 + 0.04, u1: h.u1 - 0.04, v0: h.v1 + 0.22, v1: o.top - 0.15 });
    }
    // allège under windows
    if (h.v0 > 0.45 && w > 0.5) {
      const v1 = h.v0 - 0.1;
      const v0 = Math.min(o.skirting + 0.08, v1);
      if (v1 - v0 > 0.25) out.push({ kind: 'allege', u0: h.u0 + 0.08, u1: h.u1 - 0.08, v0, v1 });
    }
  }
  return out.filter((p) => p.u0 >= -EPS && p.u1 <= length + EPS && p.u1 - p.u0 > 0.2);
}

/** True when two rectangles overlap with positive area. */
export function rectsOverlap(a: WallRect, b: WallRect, eps = 1e-6): boolean {
  return a.u0 < b.u1 - eps && b.u0 < a.u1 - eps && a.v0 < b.v1 - eps && b.v0 < a.v1 - eps;
}

// ---------------------------------------------------------------------------------------------
// Arched heads
// ---------------------------------------------------------------------------------------------

/**
 * Points of an arched head (left to right) for a hole of width w with its crown at v1:
 * round = semicircle (rise w/2), segmental = arc with rise w/6 [N]. Straight -> [].
 * Returned as [u, v] relative to the hole's left edge; the spring line is v1 − rise.
 */
export function archPoints(head: HeadForm | undefined, w: number, v1: number, segments = 10): [number, number][] {
  if (head !== 'round' && head !== 'segmental') return [];
  const rise = head === 'round' ? w / 2 : w / 6;
  const R = (rise * rise + (w / 2) * (w / 2)) / (2 * rise);
  const cy = v1 - R;
  const half = Math.asin(Math.min(1, w / 2 / R));
  const pts: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const a = -half + (2 * half * i) / segments; // from left (−) to right (+) measured from vertical
    pts.push([w / 2 + R * Math.sin(a), cy + R * Math.cos(a)]);
  }
  return pts;
}

export function archRise(head: HeadForm | undefined, w: number): number {
  return head === 'round' ? w / 2 : head === 'segmental' ? w / 6 : 0;
}
