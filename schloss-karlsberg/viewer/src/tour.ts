/**
 * Rundflug (backlog KB-I46, visual-audit §5.11 / P13): a deterministic scripted fly-around in six shots. Pure: no
 * three.js, no DOM, so the camera path, easing, fades and captions are unit-tested (viewer/tests/tour.test.ts).
 *
 * - Each shot has camera and look-at control points. Both run on a centripetal Catmull-Rom spline (no cusps or
 *   overshoot on uneven spacing; Yuksel, Schaefer & Keyser 2011, "Parameterization and applications of Catmull-Rom
 *   curves", https://doi.org/10.1016/j.cad.2010.08.008) that is re-parameterised by arc length, so the speed follows
 *   only the easing profile: accelerate, glide at constant speed, decelerate (`easeRamp`, C1 continuous).
 * - Shots are joined by a short fade through black; the hour (15 Jul 1789) changes only while the frame is black.
 * - Control points are given relative to building centres (`TourAnchors`) with the measured centres of 2026-11-02 as
 *   fallback, and heights either absolute or above the terrain (`agl`), so a re-placed building keeps its shot.
 * - Captions are German; the note carries the catalogue confidence of the shot's subjects and "Hypothese".
 *
 * The camera choice per shot is art direction [I]. Hours follow the sun table of look-and-period.md §3: the garden
 * (east) fronts in morning light, the Ehrenhof (west) at the 17:30 hero hour, the closing aerial at the golden hour.
 */

import { clamp } from '@model/layout/geom.ts';

export type V3 = [number, number, number];

/** A control point: local x / z (x = E − 381000, z = −(N − 5465000)) and a height, absolute (`h`) or above ground (`agl`). */
export interface TourPoint {
  x: number;
  z: number;
  h?: number;
  agl?: number;
}

export interface TourShotSpec {
  id: string;
  /** German title shown as the caption. */
  title_de: string;
  /** Catalogue ids (buildings or terrain features) whose confidence the caption names, first = main subject. */
  subjects: string[];
  /** Short German caption names for the subjects (else the catalogue name, shortened). */
  labels?: Record<string, string>;
  /** Extra German evidence note (short); the confidence line is added from the catalogue. */
  note_de?: string;
  /** Hour on 15 Jul 1789 (local mean time, viewer/src/sun.ts). */
  hour: number;
  /** Seconds. */
  duration: number;
  cam: TourPoint[];
  look: TourPoint[];
  /** Share of the shot spent accelerating / decelerating (0…0.5). */
  ramp?: number;
}

export interface TourSpec {
  id: string;
  name_de: string;
  shots: TourShotSpec[];
  /** Seconds of fade through black at each cut (half out, half in). */
  fade: number;
}

/** Building / feature centres the shots are placed around (local metres). */
export type TourAnchors = Record<string, { x: number; y: number; z: number }>;

/** Centres measured in the viewer on 2026-11-02 (skb.entries … centre); used when an anchor is missing. */
export const FALLBACK_ANCHORS: TourAnchors = {
  'KB-B01': { x: 1262.7, y: 344.8, z: -1126.3 },
  'KB-B06': { x: 1230.1, y: 347.6, z: -1220.0 },
  'KB-B07': { x: 1279.6, y: 349.1, z: -1228.3 },
  'KB-B10': { x: 1241.9, y: 335.3, z: -967.1 },
};

// ---------------------------------------------------------------- maths


/**
 * Easing with a trapezoidal speed profile: constant acceleration over the first `ramp` of the time, constant speed,
 * constant deceleration over the last `ramp`. Monotone, f(0) = 0, f(1) = 1, f' continuous; ramp 0.5 = ease in-out.
 */
export function easeRamp(t: number, ramp = 0.25): number {
  const r = clamp(ramp, 1e-6, 0.5);
  const x = clamp(t, 0, 1);
  const v = 1 / (1 - r); // cruise speed so that the area under the speed profile is 1
  if (x < r) return (v * x * x) / (2 * r);
  if (x > 1 - r) {
    const y = 1 - x;
    return 1 - (v * y * y) / (2 * r);
  }
  return v * (x - r / 2);
}

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dist(a: V3, b: V3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
function lerp3(a: V3, b: V3, wa: number, wb: number): V3 {
  return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb];
}

/**
 * Point on a centripetal Catmull-Rom spline (alpha 0.5) through `pts` at u ∈ [0, 1] (uniform in segments). The ends
 * are extended by mirrored phantom points so the curve starts and ends on the first and last point.
 */
export function catmullRom(pts: readonly V3[], u: number): V3 {
  const n = pts.length;
  if (n === 0) throw new Error('catmullRom: no points');
  if (n === 1) return [...pts[0]] as V3;
  const segs = n - 1;
  const s = clamp(u, 0, 1) * segs;
  const i = Math.min(segs - 1, Math.floor(s));
  const t = s - i;
  const p1 = pts[i];
  const p2 = pts[i + 1];
  const p0 = i > 0 ? pts[i - 1] : sub([2 * p1[0], 2 * p1[1], 2 * p1[2]], p2);
  const p3 = i + 2 < n ? pts[i + 2] : sub([2 * p2[0], 2 * p2[1], 2 * p2[2]], p1);
  // knot spacing |Δ|^0.5 (centripetal); tiny epsilon keeps coincident points finite
  const k = (a: V3, b: V3) => Math.max(1e-4, Math.sqrt(dist(a, b)));
  const t0 = 0;
  const t1 = t0 + k(p0, p1);
  const t2 = t1 + k(p1, p2);
  const t3 = t2 + k(p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const a1 = lerp3(p0, p1, (t1 - tt) / (t1 - t0), (tt - t0) / (t1 - t0));
  const a2 = lerp3(p1, p2, (t2 - tt) / (t2 - t1), (tt - t1) / (t2 - t1));
  const a3 = lerp3(p2, p3, (t3 - tt) / (t3 - t2), (tt - t2) / (t3 - t2));
  const b1 = lerp3(a1, a2, (t2 - tt) / (t2 - t0), (tt - t0) / (t2 - t0));
  const b2 = lerp3(a2, a3, (t3 - tt) / (t3 - t1), (tt - t1) / (t3 - t1));
  return lerp3(b1, b2, (t2 - tt) / (t2 - t1), (tt - t1) / (t2 - t1));
}

/** Arc-length table of a spline: cumulative length at `samples + 1` uniform parameters. */
export interface ArcTable {
  pts: V3[];
  cum: number[];
  length: number;
}

export function arcTable(pts: readonly V3[], samples = 256): ArcTable {
  const cum = [0];
  let prev = catmullRom(pts, 0);
  for (let i = 1; i <= samples; i++) {
    const p = catmullRom(pts, i / samples);
    cum.push(cum[i - 1] + dist(prev, p));
    prev = p;
  }
  return { pts: [...pts], cum, length: cum[samples] };
}

/** Point at arc-length fraction f ∈ [0, 1] (constant speed along the curve). */
export function atArcFraction(tab: ArcTable, f: number): V3 {
  const n = tab.cum.length - 1;
  if (!(tab.length > 1e-9)) return catmullRom(tab.pts, 0);
  const target = clamp(f, 0, 1) * tab.length;
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tab.cum[mid] <= target) lo = mid;
    else hi = mid;
  }
  const seg = tab.cum[hi] - tab.cum[lo];
  const w = seg > 0 ? (target - tab.cum[lo]) / seg : 0;
  return catmullRom(tab.pts, (lo + w) / n);
}

// ---------------------------------------------------------------- the Rundflug

/** Offset from an anchor (falls back to FALLBACK_ANCHORS, then to the origin of the CdL). */
function at(anchors: TourAnchors, id: string, dx: number, dz: number, height: { h?: number; agl?: number; dy?: number }): TourPoint {
  const a = anchors[id] ?? FALLBACK_ANCHORS[id] ?? FALLBACK_ANCHORS['KB-B01'];
  const p: TourPoint = { x: a.x + dx, z: a.z + dz };
  if (height.dy !== undefined) p.h = a.y + height.dy;
  else if (height.h !== undefined) p.h = height.h;
  else p.agl = height.agl ?? 2;
  return p;
}

/** Points on a horizontal arc around an anchor: angles in degrees (0 = +x east, 90 = +z south), radius in m. */
function arc(anchors: TourAnchors, id: string, r: number, degs: number[], hs: { h?: number; agl?: number }[], ): TourPoint[] {
  return degs.map((d, i) => at(anchors, id, r * Math.cos((d * Math.PI) / 180), r * Math.sin((d * Math.PI) / 180), hs[Math.min(i, hs.length - 1)]));
}

/**
 * The six shots of the Rundflug. Anchors are building centres in the local frame (`skb.entries.get(id).centre`).
 * Shot order and content: approach over the Karlslust valley, Ehrenhof, garden front and basin, gallery and rotunda,
 * Orangerie slope, golden-hour aerial (backlog KB-I46).
 */
export function rundflugSpec(anchors: TourAnchors = {}): TourSpec {
  const C = 'KB-B01';
  return {
    id: 'rundflug',
    name_de: 'Rundflug',
    fade: 1.2,
    shots: [
      {
        id: 'anflug',
        title_de: 'Anflug über den Herzogsgarten',
        subjects: [],
        note_de: 'Landschaft 1789: Hypothese (Karten um 1790, Generator-Regeln)',
        hour: 7.25,
        duration: 12,
        ramp: 0.3,
        // wave 8 (look-and-period §6 "open ridge, not a forest clearing"): the shot opens high over the E end of the
        // open garden lawn, where the forest edge already lies behind and below the camera, with the palace on its ridge
        // in view from the first frame; it glides W and down the garden axis (grid az 80.5°: z −0.165 m per m E) toward the
        // garden front, drifting from just S of the axis onto it. The old start over the valley E of the ridge opened on a
        // closed canopy. Ends where the wave-6 path ended (the cut to the Ehrenhof is unchanged).
        cam: [at(anchors, C, 520, -50, { h: 468 }), at(anchors, C, 430, -50, { h: 452 }), at(anchors, C, 340, -47, { h: 437 }), at(anchors, C, 245, -42, { h: 425 })],
        // the eye rests on the garden front and the basin (not on the crowns below)
        look: [at(anchors, C, 70, -12, { h: 340 }), at(anchors, C, 45, -8, { h: 341 }), at(anchors, C, 20, -3, { dy: -2 }), at(anchors, C, 0, 0, { dy: 2 })],
      },
      {
        id: 'ehrenhof',
        title_de: 'Ehrenhof mit Corps de logis und Flügeln',
        subjects: [C, 'KB-B02', 'KB-B03'],
        labels: { 'KB-B02': 'Südflügel', 'KB-B03': 'Nordflügel' },
        hour: 17.5,
        duration: 11,
        ramp: 0.25,
        // gliding in from the W over the Ehrenhofgitter down into the court, toward the portal
        cam: [at(anchors, C, -152, 13, { h: 364 }), at(anchors, C, -112, 9, { h: 358 }), at(anchors, C, -78, 7, { h: 352.5 }), at(anchors, C, -54, 6, { h: 348.2 })],
        look: [at(anchors, C, 0, 0, { dy: 4 }), at(anchors, C, 0, 0, { dy: 5 }), at(anchors, C, 0, 0, { dy: 6.5 }), at(anchors, C, 0, 0, { dy: 8 })],
      },
      {
        id: 'garten',
        title_de: 'Gartenfront und Bassin am Morgen',
        subjects: ['HG-04', C],
        labels: { 'HG-04': 'Bassin' },
        note_de: 'Garten nach dem Petri-Plan um 1788 (Lesart Schneider)',
        hour: 7.0,
        duration: 11,
        ramp: 0.3,
        // wave-6 review: on the garden axis (grid az 80.5°: 0.165 m N per m E), a slow push up to the basin's E rim
        // (basin centre ≈ 74 m E of the CdL centre, r ≈ 7 m) rising from eye level, so the jet and the two stag heads
        // stand in front of the garden front instead of an empty lawn foreground
        cam: [at(anchors, C, 118, -19.5, { agl: 1.9 }), at(anchors, C, 104, -17.2, { agl: 2.6 }), at(anchors, C, 92, -15.2, { agl: 3.6 }), at(anchors, C, 85, -14, { agl: 4.8 })],
        look: [at(anchors, C, 20, -3.3, { dy: 6.5 }), at(anchors, C, 16, -2.6, { dy: 7 }), at(anchors, C, 12, -2, { dy: 7.5 }), at(anchors, C, 10, -1.6, { dy: 8 })],
      },
      {
        id: 'galerie',
        title_de: 'Galerieflügel und Rotunde (Tempelzimmer)',
        subjects: ['KB-B07', 'KB-B06'],
        labels: { 'KB-B07': 'Rotunde', 'KB-B06': 'Galerie' },
        hour: 8.5,
        duration: 12,
        ramp: 0.25,
        // a slow arc around the rotunda from the SE toward the S above the garden lawn, then the eye follows the gallery
        // west; the grove N of the rotunda stays out of the right edge (wave-5 review: a near crown blocked a third of
        // the frame from the old E start; viewer/tests/tour-occlusion.test.ts)
        cam: arc(anchors, 'KB-B07', 62, [44, 54, 64, 74], [{ agl: 32 }, { agl: 30 }, { agl: 29 }, { agl: 30 }]),
        look: [at(anchors, 'KB-B07', -8, 6, { dy: 4 }), at(anchors, 'KB-B07', -12, 6, { dy: 4 }), at(anchors, 'KB-B07', -18, 5, { dy: 3.5 }), at(anchors, 'KB-B06', 10, 0, { dy: 3 })],
      },
      {
        id: 'orangerie',
        title_de: 'Orangerie am Hang',
        subjects: ['KB-B10', 'KB-B11', 'KB-B12'],
        labels: { 'KB-B10': 'Hauptflügel', 'KB-B11': 'Nordflügel', 'KB-B12': 'Südflügel' },
        hour: 17.75,
        duration: 11,
        ramp: 0.25,
        // wave-6 review (a flat frontal elevation over an empty meadow): an oblique arc from the SW, level with the
        // roofs, with the low WNW sun grazing the high basement of the main range; the S wing and the Komödienhaus
        // KB-B12a (hypothesis) close the right of the frame, the N court wing recedes on the left
        cam: [at(anchors, 'KB-B10', -50, 78, { dy: 19 }), at(anchors, 'KB-B10', -66, 58, { dy: 18 }), at(anchors, 'KB-B10', -78, 36, { dy: 18 }), at(anchors, 'KB-B10', -84, 14, { dy: 19 })],
        look: [at(anchors, 'KB-B10', 12, 8, { dy: 9 }), at(anchors, 'KB-B10', 9, 5, { dy: 9 }), at(anchors, 'KB-B10', 6, 1, { dy: 9 }), at(anchors, 'KB-B10', 4, -5, { dy: 9 })],
      },
      {
        id: 'goldene-stunde',
        title_de: 'Die Residenz in der Abendsonne',
        subjects: [],
        note_de: 'Gesamtanlage um 1789 – Konfidenz je Gebäude im Infofeld',
        hour: 18.75,
        duration: 14,
        ramp: 0.3,
        // a high arc W of the residence, from the SW round toward the W, with the low sun (≈ 10°, WNW) behind the right
        // shoulder: warm, front-lit court fronts with long shadows reaching east across the Ehrenhof and the meadows
        // (wave-5 review: from the N the sun came side-on and the shot read as grey haze; pose 08 is the reference)
        cam: arc(anchors, C, 230, [148, 160, 172, 184], [{ h: 404 }, { h: 410 }, { h: 417 }, { h: 425 }]),
        look: [at(anchors, C, -40, 10, { dy: 0 }), at(anchors, C, -30, 10, { dy: 0 }), at(anchors, C, -20, 5, { dy: 0 }), at(anchors, C, -10, 0, { dy: 0 })],
      },
    ],
  };
}

// ---------------------------------------------------------------- resolved tour and frames

export interface ResolvedShot {
  spec: TourShotSpec;
  start: number;
  cam: ArcTable;
  look: ArcTable;
}

export interface Tour {
  spec: TourSpec;
  shots: ResolvedShot[];
  duration: number;
}

/** Height of a control point (absolute, or terrain + agl; NaN terrain → agl over 345 m, the court level). */
export function resolvePoint(p: TourPoint, ground: (x: number, z: number) => number): V3 {
  if (p.h !== undefined) return [p.x, p.h, p.z];
  const g = ground(p.x, p.z);
  return [p.x, (Number.isFinite(g) ? g : 345) + (p.agl ?? 2), p.z];
}

export function resolveTour(spec: TourSpec, ground: (x: number, z: number) => number): Tour {
  let t = 0;
  const shots = spec.shots.map((s) => {
    const r: ResolvedShot = { spec: s, start: t, cam: arcTable(s.cam.map((p) => resolvePoint(p, ground))), look: arcTable(s.look.map((p) => resolvePoint(p, ground))) };
    t += s.duration;
    return r;
  });
  return { spec, shots, duration: t };
}

export interface TourFrame {
  index: number;
  shot: TourShotSpec;
  /** 0…1 within the shot (time). */
  u: number;
  /** Seconds since the start of the tour. */
  t: number;
  pos: V3;
  look: V3;
  /** Opacity of the black cut overlay (0 clear … 1 black). */
  fade: number;
  /** Opacity of the caption (0…1). */
  caption: number;
  hour: number;
}

/** Keep the camera `clear` metres above the terrain (smoothly: never lower than the clearance, unchanged above it). */
export function clampClearance(p: V3, ground: (x: number, z: number) => number, clear = 1.6): V3 {
  const g = ground(p[0], p[2]);
  return Number.isFinite(g) && p[1] < g + clear ? [p[0], g + clear, p[2]] : p;
}

/** Fade-through-black opacity at time `s` into a shot of `dur` seconds, fading `half` s at each end. */
export function cutFade(s: number, dur: number, half: number, first: boolean, last: boolean): number {
  const hIn = first ? half * 1.5 : half;
  const hOut = last ? half * 1.5 : half;
  const fin = hIn > 0 ? clamp(1 - s / hIn, 0, 1) : 0;
  const fout = hOut > 0 ? clamp(1 - (dur - s) / hOut, 0, 1) : 0;
  const f = Math.max(fin, fout);
  return f * f * (3 - 2 * f);
}

/** Caption opacity: fades in 1.0–1.8 s into the shot and out 1.4 s before its end. */
export function captionAlpha(s: number, dur: number): number {
  const a = clamp((s - 1.0) / 0.8, 0, 1);
  const b = clamp((dur - 1.4 - s) / 0.6, 0, 1);
  return Math.min(a, b);
}

/** Frame of the tour at `t` seconds (clamped to [0, duration]). */
export function tourAt(tour: Tour, t: number, ground: (x: number, z: number) => number = () => NaN): TourFrame {
  const tt = clamp(t, 0, tour.duration);
  let i = tour.shots.length - 1;
  while (i > 0 && tour.shots[i].start > tt) i--;
  const r = tour.shots[i];
  const s = tt - r.start;
  const dur = r.spec.duration;
  const u = clamp(s / dur, 0, 1);
  const e = easeRamp(u, r.spec.ramp ?? 0.25);
  const pos = clampClearance(atArcFraction(r.cam, e), ground);
  const look = atArcFraction(r.look, e);
  return {
    index: i,
    shot: r.spec,
    u,
    t: tt,
    pos,
    look,
    fade: cutFade(s, dur, tour.spec.fade / 2, i === 0, i === tour.shots.length - 1),
    caption: captionAlpha(s, dur),
    hour: r.spec.hour,
  };
}

/** Frame of one shot at u ∈ [0, 1] of its time (for `skb.tour(shotId, u)`); null for an unknown id. */
export function shotAt(tour: Tour, id: string, u: number, ground?: (x: number, z: number) => number): TourFrame | null {
  const r = tour.shots.find((x) => x.spec.id === id);
  if (!r) return null;
  // u = 1 is the shot's last instant, not the next shot's first
  return tourAt(tour, r.start + clamp(u, 0, 1) * r.spec.duration * (1 - 1e-9), ground);
}

// ---------------------------------------------------------------- near occluders (wave-5 review)

/** A crown as a sphere (local metres). */
export interface Sphere {
  x: number;
  y: number;
  z: number;
  r: number;
}

/** View of a tour frame: vertical field of view of the 16:9 canvas and the 2.2:1 letterbox the tour shows. */
export const TOUR_VIEW = { fovDeg: 55, canvasAspect: 16 / 9, letterbox: 2.2 };

/**
 * Share (0…1) of a coarse ray grid through the visible (letterboxed) frame whose first hit is a crown sphere within
 * `maxDist` metres of the camera (wave-5 review: the Rundflug opened skimming tree crowns, and a near crown blocked
 * a third of the Galerie shot). Rays at the centres of `cols` × `rows` cells.
 */
export function nearOcclusion(pos: V3, look: V3, crowns: readonly Sphere[], opts: { maxDist?: number; cols?: number; rows?: number } = {}): number {
  const maxDist = opts.maxDist ?? 30;
  const cols = opts.cols ?? 16;
  const rows = opts.rows ?? 7;
  const f = sub(look, pos);
  const fl = Math.hypot(...f) || 1;
  const fw: V3 = [f[0] / fl, f[1] / fl, f[2] / fl];
  // right = forward × up(0, 1, 0), up' = right × forward
  let rt: V3 = [-fw[2], 0, fw[0]];
  const rl = Math.hypot(...rt) || 1;
  rt = [rt[0] / rl, 0, rt[2] / rl];
  const up: V3 = [rt[1] * fw[2] - rt[2] * fw[1], rt[2] * fw[0] - rt[0] * fw[2], rt[0] * fw[1] - rt[1] * fw[0]];
  const tanV = Math.tan((TOUR_VIEW.fovDeg * Math.PI) / 360);
  const tanH = tanV * TOUR_VIEW.canvasAspect;
  const tanVis = (tanV * TOUR_VIEW.canvasAspect) / TOUR_VIEW.letterbox;
  const near = crowns.filter((c) => Math.hypot(c.x - pos[0], c.y - pos[1], c.z - pos[2]) < maxDist + c.r);
  let hit = 0;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const u = ((i + 0.5) / cols) * 2 - 1;
      const v = ((j + 0.5) / rows) * 2 - 1;
      const d: V3 = [0, 1, 2].map((k) => fw[k] + rt[k] * u * tanH + up[k] * v * tanVis) as V3;
      const dl = Math.hypot(...d);
      const dn: V3 = [d[0] / dl, d[1] / dl, d[2] / dl];
      for (const c of near) {
        const oc: V3 = [pos[0] - c.x, pos[1] - c.y, pos[2] - c.z];
        const b = oc[0] * dn[0] + oc[1] * dn[1] + oc[2] * dn[2];
        const q = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - c.r * c.r;
        const disc = b * b - q;
        if (disc < 0) continue;
        const t = q < 0 ? 0 : -b - Math.sqrt(disc);
        if (t >= 0 && t <= maxDist) {
          hit++;
          break;
        }
      }
    }
  return hit / (cols * rows);
}

// ---------------------------------------------------------------- captions

const CONF_DE: Record<string, string> = { high: 'hoch', med: 'mittel', low: 'niedrig' };

/**
 * Caption text of a shot: the title, and a note "Konfidenz: <name> <level> · … · Rekonstruktion = Hypothese" from the
 * catalogue (`info(id)` → German short name and confidence; unknown ids are skipped).
 */
export function captionFor(shot: TourShotSpec, info: (id: string) => { name: string; confidence?: string } | undefined): { title: string; note: string } {
  const parts: string[] = [];
  for (const id of shot.subjects) {
    const x = info(id);
    if (!x?.confidence) continue;
    parts.push(`${shot.labels?.[id] ?? x.name}: ${CONF_DE[x.confidence] ?? x.confidence}`);
  }
  const conf = parts.length ? `Konfidenz ${parts.join(', ')}` : '';
  const note = [shot.note_de, conf, 'Rekonstruktion = Hypothese'].filter(Boolean).join(' · ');
  return { title: shot.title_de, note };
}

/** Short German name for a caption: the part before " (", " –" or ":" of a catalogue name. */
export function shortName(name: string): string {
  const cut = name.split(/ \(| – |: /)[0];
  return cut.length > 38 ? `${cut.slice(0, 36)}…` : cut;
}

// ---------------------------------------------------------------- player

/**
 * Real-time player: advances by the frame dt, reports a new shot (so the caller can change the hour while the frame is
 * black) and ends after the last shot. Pure state; the viewer applies the frames.
 */
export class TourPlayer {
  t = 0;
  playing = false;
  private lastShot = -1;
  constructor(public tour: Tour) {}

  start(): void {
    this.t = 0;
    this.lastShot = -1;
    this.playing = true;
  }

  stop(): void {
    this.playing = false;
  }

  /** Advance `dt` seconds; returns the frame and whether a new shot began, or null once the tour has ended. */
  update(dt: number, ground?: (x: number, z: number) => number): { frame: TourFrame; newShot: boolean } | null {
    if (!this.playing) return null;
    if (this.t > this.tour.duration) {
      this.playing = false;
      return null;
    }
    const frame = tourAt(this.tour, this.t, ground);
    const newShot = frame.index !== this.lastShot;
    this.lastShot = frame.index;
    this.t += Math.max(0, Math.min(dt, 0.1));
    return { frame, newShot };
  }
}
