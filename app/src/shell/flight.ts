/**
 * Fliegen / Gehen (ADR 0019 Standard): walking keeps the eye at a fixed height over the displayed
 * DTM (flying passes through the canopy, walking collides with the ground; ADR 0020), with level
 * view and walking pace. Pure helpers; the shell applies them after DroneController.update().
 */

export type MoveMode = 'fly' | 'walk';
export const MOVE_LABELS: Record<MoveMode, string> = { fly: 'Fliegen', walk: 'Gehen' };

/** Eye height over ground while walking (display metres). */
export const WALK_EYE = 1.7;
/** Speed multiplier while walking: the drone scales speed with AGL (clamped ≥ 0.2 · base). */
export const WALK_SPEED = 1;
/** Pitch on entering walk mode (look ahead, slightly down). */
export const WALK_PITCH = -5;

/** Camera y while walking: ground + eye; unknown ground (NaN) keeps the current y. */
export function walkY(ground: number, currentY: number, eye = WALK_EYE): number {
  return Number.isFinite(ground) ? ground + eye : currentY;
}

/** Speed multiplier steps for the „Tempo“ buttons (same range as the wheel: 0.05–50). */
export const SPEED_STEPS: readonly number[] = [0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32];

/** Next speed step up (+1) or down (−1) from `current` (snaps to the nearest step first). */
export function stepSpeed(current: number, dir: 1 | -1): number {
  let i = 0;
  let best = Infinity;
  SPEED_STEPS.forEach((s, k) => {
    const d = Math.abs(Math.log(s) - Math.log(Math.max(current, 1e-3)));
    if (d < best) {
      best = d;
      i = k;
    }
  });
  const exact = Math.abs(SPEED_STEPS[i] - current) < 1e-6;
  // Off-grid values: one press lands on the neighbouring step in that direction.
  if (!exact && Math.sign(SPEED_STEPS[i] - current) === dir) return SPEED_STEPS[i];
  return SPEED_STEPS[Math.min(SPEED_STEPS.length - 1, Math.max(0, i + dir))];
}

export const fmtSpeedMult = (m: number): string =>
  `×${m.toLocaleString('de-DE', { maximumFractionDigits: m < 1 ? 2 : 1 })}`;
