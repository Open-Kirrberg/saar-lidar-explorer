/**
 * Relikt-Blick lens (V2.5) — which candidates glow, and tap picking. Pure (no three.js / DOM).
 *
 * Only public F15 candidates of the allow-listed relict classes glow (ADR 0009). Classes outside
 * the allow-list never reach this module (the parser drops them, ADR 0010) and are filtered here
 * again. Known paths, rejected reviews and weak scores do not glow.
 */
import { candidateRadius, isKnownPath } from '../candidates/candidateData';
import type { Candidate } from '../candidates/candidateData';
import { isCandidateClass } from '../data/manifest';
import type { CandidateReviewStatus } from '../data/manifest';

/** Score a candidate needs to glow (stricter than the review list: the lens is for everyone). */
export const GLOW_MIN_SCORE = 0.5;
/** Search radius (m) around the glow centre. */
export const GLOW_RADIUS_M = 450;
/** Ring radius bounds (m). */
export const GLOW_R_MIN = 3;
export const GLOW_R_MAX = 30;

export interface GlowPoolOptions {
  minScore?: number;
  statusOf?: (id: string) => CandidateReviewStatus | undefined;
}

/** Candidates that may glow at all (filtered once per load / review change). */
export function glowPool(list: readonly Candidate[], o: GlowPoolOptions = {}): Candidate[] {
  const min = o.minScore ?? GLOW_MIN_SCORE;
  return list.filter(
    (c) =>
      isCandidateClass(c.cls) &&
      !isKnownPath(c) &&
      Number.isFinite(c.E) &&
      Number.isFinite(c.N) &&
      Number.isFinite(c.score) &&
      c.score >= min &&
      o.statusOf?.(c.id) !== 'rejected',
  );
}

/**
 * Point the glow is centred on: ahead of the camera where the view meets the ground (heading in
 * degrees clockwise from grid north, pitch negative = down), at most `maxAhead` metres.
 */
export function glowCentre(E: number, N: number, headingDeg: number, pitchDeg: number, agl: number, maxAhead = 350): { E: number; N: number } {
  const down = (-pitchDeg * Math.PI) / 180;
  const ahead = down > 0.02 ? Math.min(maxAhead, Math.max(0, agl) / Math.tan(down)) : maxAhead;
  const h = (headingDeg * Math.PI) / 180;
  return { E: E + Math.sin(h) * ahead, N: N + Math.cos(h) * ahead };
}

/** Up to `max` pool entries within `radius` of `centre`, nearest first. */
export function selectGlow(pool: readonly Candidate[], centre: { E: number; N: number }, max: number, radius = GLOW_RADIUS_M): Candidate[] {
  const r2 = radius * radius;
  const near: Array<[number, Candidate]> = [];
  for (const c of pool) {
    const d2 = (c.E - centre.E) ** 2 + (c.N - centre.N) ** 2;
    if (d2 <= r2) near.push([d2, c]);
  }
  near.sort((a, b) => a[0] - b[0] || (a[1].id < b[1].id ? -1 : 1));
  return near.slice(0, Math.max(0, max)).map(([, c]) => c);
}

export const glowRadius = (c: Candidate): number => Math.min(GLOW_R_MAX, Math.max(GLOW_R_MIN, candidateRadius(c)));

/** 0.55–1 by score above the threshold. */
export function glowStrength(c: Pick<Candidate, 'score'>, minScore = GLOW_MIN_SCORE): number {
  const t = minScore >= 1 ? 1 : (c.score - minScore) / (1 - minScore);
  return 0.55 + 0.45 * Math.min(1, Math.max(0, t));
}

/**
 * Shader entries [world x, world z, radius m, strength] (x = E − E0, z = −(N − N0)); the selected
 * candidate glows brighter.
 */
export function packGlow(
  sel: readonly Candidate[],
  origin: { E0: number; N0: number },
  selectedId: string | null = null,
  minScore = GLOW_MIN_SCORE,
): Array<[number, number, number, number]> {
  return sel.map((c) => [c.E - origin.E0, -(c.N - origin.N0), glowRadius(c), glowStrength(c, minScore) * (c.id === selectedId ? 1.8 : 1)]);
}

/**
 * Bounding circle of packed rings for the shader's early-out: (x, z, R) with every ring centre plus
 * 3 × its radius inside R of (x, z). The shader adds the pixel-based reach (≤ 48 px) itself.
 * Empty → R = −1.
 */
export function glowBound(packed: ReadonlyArray<readonly [number, number, number, number]>): [number, number, number] {
  if (!packed.length) return [0, 0, -1];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of packed) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  let R = 0;
  for (const [x, z, r] of packed) R = Math.max(R, Math.hypot(x - cx, z - cz) + 3 * r);
  return [cx, cz, R];
}

/** The glowing candidate under a ground point (E, N), if any: nearest within its ring + `slack` m. */
export function pickGlow(sel: readonly Candidate[], E: number, N: number, slack = 4): Candidate | null {
  let best: Candidate | null = null;
  let bestD = Infinity;
  for (const c of sel) {
    const d = Math.hypot(c.E - E, c.N - N);
    if (d <= glowRadius(c) * 1.25 + slack && d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}
