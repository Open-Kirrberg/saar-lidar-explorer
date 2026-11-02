/**
 * Exaggeration-aware oblique framing of a site (N/P candidate stepping, marker / measurement /
 * report fly-to). The look-at target is the site's DISPLAYED position
 * `y = hRef + (h − hRef) · exag` (h = true height), so the site sits in the screen centre at any
 * exaggeration. The camera stands `dist` m horizontally back along `heading` and at least `agl` m
 * above the target; where the (displayed) terrain between camera and target would block the line
 * of sight, the camera is raised and the pitch recomputed so the target stays centred.
 * Pure (no three.js / DOM) — unit-tested in tests/framing.test.ts.
 */

export interface SiteFrame {
  /** Camera position in the world frame (x = E − E0, y = display metres, z = −(N − N0)). */
  x: number;
  y: number;
  z: number;
  /** Grid heading (deg, clockwise from grid north) and pitch (deg, negative = down). */
  heading: number;
  pitch: number;
  /** Camera height above the target actually used (≥ agl). */
  rise: number;
}

/** Displayed height of a true height h (`y = hRef + (h − hRef) · exag`). */
export const displayY = (h: number, hRef: number, exag: number): number => hRef + (h - hRef) * exag;

/**
 * Camera pose looking at the displayed target (tx, ty, tz).
 * @param groundY displayed terrain height at (x, z); NaN where unknown (ignored).
 * @param clearance metres the sight line keeps above the terrain near the camera (tapers to 0 at the target).
 */
export function frameSite(
  tx: number,
  ty: number,
  tz: number,
  dist: number,
  agl: number,
  heading: number,
  groundY: (x: number, z: number) => number,
  clearance = 6,
  samples = 16,
): SiteFrame {
  const d = Math.max(1, dist);
  const hr = (heading * Math.PI) / 180;
  const cx = tx - Math.sin(hr) * d;
  const cz = tz + Math.cos(hr) * d;
  let rise = Math.max(1, agl);
  // Sight line y(t) = ty + t · rise for t ∈ (0, 1] from target (t = 0) to camera (t = 1).
  for (let k = 1; k <= samples; k++) {
    const t = k / samples;
    if (t < 0.1) continue; // right at the target the line meets the ground by construction
    const g = groundY(tx + (cx - tx) * t, tz + (cz - tz) * t);
    if (!Number.isFinite(g)) continue;
    const need = (g + clearance * t - ty) / t;
    if (need > rise) rise = need;
  }
  const pitch = -(Math.atan2(rise, d) * 180) / Math.PI;
  return { x: cx, y: ty + rise, z: cz, heading, pitch, rise };
}
