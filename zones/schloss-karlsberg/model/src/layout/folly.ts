/**
 * KB-I31 / KB-I39 / KB-I30: pure geometry rules for the follies (`facade.folly`, exterior/folly.ts). No three.js.
 * Sizes come from grammar FOLLY [N]; these helpers only place parts so the builder does not re-derive them.
 */
import { FOLLY } from './grammar.ts';

type ST = [number, number];

/** Regular n-gon of circumradius r around (0, 0), CCW; `phase` in radians (0 = first vertex on +s). */
export function polygonRing(n: number, r: number, phase = 0): ST[] {
  return Array.from({ length: n }, (_, i): ST => {
    const a = phase + (i / n) * Math.PI * 2;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
}

/**
 * Altan pier centres along the open front (offsets from the front's middle, ascending): end piers flush with the
 * footprint ends, two piers flanking a centred gate of `gate` m (if any, its mouth stays clear), and evenly spaced
 * extra piers so that no clear span exceeds `maxSpan`. Symmetric about 0. A front too narrow for separate jamb piers
 * (wave-7 review fix: the 2-axis Altan KB-B02a) gets only its two end piers, which then flank the gate.
 */
export function altanPiers(width: number, gate = 0, pier: number = FOLLY.altan.pier, maxSpan: number = FOLLY.altan.maxSpan): number[] {
  const end = width / 2 - pier / 2;
  if (end <= 0) return [0];
  const jamb = gate / 2 + pier / 2;
  // bays between two pier centres `span` apart so that the clear span (span / bays − pier) stays ≤ maxSpan
  const fill = (a: number, b: number) => {
    const bays = Math.max(1, Math.ceil((b - a) / (maxSpan + pier) - 1e-6));
    return Array.from({ length: bays + 1 }, (_, i) => a + ((b - a) * i) / bays);
  };
  if (gate > 0 && jamb <= end - pier) {
    const half = fill(jamb, end);
    return [...half.map((x) => -x).reverse(), ...half];
  }
  // a front too narrow for separate jamb piers: the end piers flank the gate (never a pier in the gate mouth)
  if (gate > 0 && end >= jamb) return [-end, end];
  return fill(-end, end);
}

/**
 * Concave (Chinese) tent-roof profile: `n` + 1 rings from the eave (k = 0) to the apex (k = n) as [radius, height]
 * over the eave line. The curve sags below the straight eave-apex line (concave) and the eave lifts by `upturn`.
 */
export function concaveRoofProfile(r: number, rise: number, upturn: number, n = 4): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k <= n; k++) {
    const u = k / n; // 0 eave .. 1 apex
    const rad = r * (1 - u);
    // concave: height grows slowly near the eave and fast near the apex (power 1.8), plus the eave upturn fading out
    const h = rise * Math.pow(u, 1.8) + upturn * (1 - u) * (1 - u);
    out.push([rad, h]);
  }
  return out;
}

/** Centres of the skeps on one apiary shelf of length `len` (offsets from the shelf middle, ascending). */
export function skepCentres(len: number, spacing: number = FOLLY.apiary.spacing, skep: number = FOLLY.apiary.skep): number[] {
  const n = Math.max(1, Math.floor((len - skep) / spacing) + 1);
  const w = (n - 1) * spacing;
  return Array.from({ length: n }, (_, i) => -w / 2 + i * spacing);
}

/**
 * Point on one sector of an up-swept polygonal (Chinese) roof (wave-8 audit rank 11). The sector runs between the eave
 * corners `a` and `b` (plan, measured from the roof axis) at parameter `t` ∈ [0, 1] along the eave and `u` ∈ [0, 1] from
 * the eave (0) to the top ring (1), whose plan scale is `top` (0 = apex). Height over the eave line is the concave
 * profile `rise · u^1.8 + upturn · (1 − u)²`; the hips (t = 0, 1) lift by `cornerLift` and reach out by `cornerOut`,
 * both ∝ c² (1 − u)² with c = |2t − 1|, so the side midpoints and the top ring stay unchanged. Returns [s, t, h].
 */
export function upsweptRoofPoint(
  a: ST,
  b: ST,
  t: number,
  u: number,
  o: { top: number; rise: number; upturn: number; cornerLift: number; cornerOut: number },
): [number, number, number] {
  const c = Math.abs(2 * t - 1);
  const w = c * c * (1 - u) * (1 - u);
  const k = 1 - u * (1 - o.top);
  const x = (a[0] + (b[0] - a[0]) * t) * k;
  const y = (a[1] + (b[1] - a[1]) * t) * k;
  const r = Math.hypot(x, y) || 1;
  const out = o.cornerOut * w;
  const h = o.rise * Math.pow(u, 1.8) + o.upturn * (1 - u) * (1 - u) + o.cornerLift * w;
  return [x + (x / r) * out, y + (y / r) * out, h];
}
