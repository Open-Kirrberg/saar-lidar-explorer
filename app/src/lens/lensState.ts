/**
 * Relikt-Blick lens (V2.5, ADR 0035) — pure transition state machine and blend curve.
 *
 * One progress value `p` (0 = off, 1 = on) runs toward the target at 1 / duration per second.
 * Three staggered channels hang off it: trees fade first, then the relief blends in, then the
 * candidates glow. Turning the lens off plays the same curve backwards (glow goes first).
 */

/** Length of a full off → on transition (s). */
export const LENS_DURATION_S = 0.5;

export interface LensState {
  /** Target: lens wanted on. */
  on: boolean;
  /** Transition progress 0–1. */
  p: number;
}

export type LensPhase = 'off' | 'entering' | 'on' | 'leaving';

export const LENS_OFF: LensState = Object.freeze({ on: false, p: 0 });

export const setLensOn = (s: LensState, on: boolean): LensState => (s.on === on ? s : { on, p: s.p });

export const toggleLens = (s: LensState): LensState => ({ on: !s.on, p: s.p });

/** Advance by `dt` seconds; `duration ≤ 0` jumps to the target. Returns `s` itself when settled. */
export function advanceLens(s: LensState, dt: number, duration = LENS_DURATION_S): LensState {
  const target = s.on ? 1 : 0;
  if (s.p === target) return s;
  const step = duration > 0 ? Math.max(0, Number.isFinite(dt) ? dt : 0) / duration : 1;
  const p = s.on ? Math.min(1, s.p + step) : Math.max(0, s.p - step);
  return { on: s.on, p };
}

export function lensPhase(s: LensState): LensPhase {
  if (s.on) return s.p >= 1 ? 'on' : 'entering';
  return s.p <= 0 ? 'off' : 'leaving';
}

const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);

/** Smoothstep ease (0 → 0, 1 → 1, zero slope at both ends). */
export const ease = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** `ease` of `p` mapped from the window [a, b] to [0, 1]. */
export const windowed = (p: number, a: number, b: number): number => ease((p - a) / (b - a));

export interface LensMix {
  /** Tree fade: 0 = trees shown, 1 = hidden. */
  trees: number;
  /** Relief channel over the aerial ground (scaled by the variant strength in the shader). */
  relief: number;
  /** Candidate glow. */
  glow: number;
}

/** Channel windows on the progress axis: trees [0, 0.6], relief [0.15, 0.85], glow [0.5, 1]. */
export function lensMix(p: number): LensMix {
  return { trees: windowed(p, 0, 0.6), relief: windowed(p, 0.15, 0.85), glow: windowed(p, 0.5, 1) };
}

export const sameMix = (a: LensMix, b: LensMix): boolean => a.trees === b.trees && a.relief === b.relief && a.glow === b.glow;
