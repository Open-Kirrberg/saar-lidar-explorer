/**
 * What counts as "inside" for the viewer's exposure and culling (KB-I60), and which room lights are worth drawing
 * (KB-I65). Pure: no three.js, no DOM.
 *
 * Inside a building footprint the viewer switches to the indoor EV (KB-I06: ≈ 5 EV below the outdoor EV by day), the candle ambient and the
 * warm room environment, and culls the exterior vegetation (the windows are over-exposed for the indoor EV). That is
 * right only where a room model is drawn: the room environment and the walls then darken the view. Elsewhere:
 * - open garden enclosures (`cls` GARD: walls round a kitchen garden, no roof) are outside (walking the beds raised the
 *   exposure and hid the trees);
 * - buildings without rooms (`interior: 'none'`, no `rooms`) are shells the camera can only clip into: outside;
 * - a room shell without an interior model (`interior: 'none'` with `rooms`, built by the exterior builder: the glazed
 *   Tempelzimmer KB-B07) is lit by the open sky through its glass doors like a shaded wall outside, so it keeps the
 *   outdoor EV, the vegetation and no candle ambient; the eye adapts a little to the shaded room: a lift of
 *   `SHELL_LIFT_BASE_EV` + `SHELL_LIFT_EV` × (1 − glazed share of the bays) (KB-B07: 5 glass doors of 8 bays →
 *   +1.05 EV) [I];
 * - rooms that are not drawn (interiors hidden by the user, LOD2 not built yet) are outside.
 */
export interface IndoorBuilding {
  cls: string;
  interior: 'detailed' | 'simple' | 'none';
  rooms?: readonly unknown[];
  facade?: { rotunda?: { bays: readonly string[] } };
}

/** Most a closed room shell (no glazing) lifts the outdoor exposure, in EV [I: a shaded wall is ≈ 2 EV below sunlit ground]. */
export const SHELL_LIFT_EV = 2;
/**
 * Lift of any roofed room shell on top of that, glazed or not (wave-7 review: the Tempelzimmer read grey and unfinished
 * at +0.75 EV; under its dome the eye still adapts to the shade) [I].
 */
export const SHELL_LIFT_BASE_EV = 0.3;

/** True when the full indoor look applies (indoor EV, candle ambient, room lights, vegetation culling). */
export function countsAsIndoor(b: IndoorBuilding, roomsDrawn: boolean): boolean {
  if (b.cls === 'GARD' || b.interior === 'none') return false;
  return roomsDrawn;
}

/**
 * Exposure lift (EV, ≥ 0; subtracted from the outdoor EV) for a camera inside a room shell without an interior model:
 * `SHELL_LIFT_BASE_EV` + `SHELL_LIFT_EV` × (1 − glazed share of its bays); half of the latter without a bay list. 0 for
 * every other building.
 */
export function shellLiftEv(b: IndoorBuilding, roomsDrawn: boolean): number {
  if (b.cls === 'GARD' || b.interior !== 'none' || !b.rooms?.length || !roomsDrawn) return 0;
  const bays = b.facade?.rotunda?.bays;
  if (!bays?.length) return SHELL_LIFT_BASE_EV + SHELL_LIFT_EV / 2;
  const glazed = bays.filter((k) => k === 'door').length;
  return SHELL_LIFT_BASE_EV + SHELL_LIFT_EV * (1 - glazed / bays.length);
}

/**
 * Whether a room point light is drawn (KB-I65). three.js shades every light in every lit material, so a light at zero
 * intensity still costs a loop iteration per pixel of the whole frame (pose 21 at 3024×1964: six candelabra at 0 cd by
 * day, ≈ 3–4 ms). Only the nearest room within 20 m, while the visitor is inside, and only lights that burn.
 */
export function roomLightOn(nearestRoom: boolean, inside: boolean, intensity: number): boolean {
  return nearestRoom && inside && intensity > 0;
}

/**
 * How much of a building's real interior is drawn (KB-I42 / KB-I65). From outside every LOD2 window shows its mapped
 * room (GLASS_LOOK.interior), so the ≈ 900 interior draw calls of the palace wings at pose 03 need not be submitted:
 * - 'full': a visitor inside this building or a neighbour within `INTERIOR_NEIGHBOUR_M` (enfilades and doors across
 *   building joints);
 * - 'shell': from outside: only floor, walls, reveals, ceiling, doors and stairs of the rooms at ground level, so an
 *   open portal or passage still shows its vestibule instead of the garden through the building;
 * - 'off': beyond the viewer's interior budget (main.ts INTERIOR_DIST, decided by the caller).
 * `footprintDistance` is the camera's plan distance to the building (0 inside).
 */
export type InteriorMode = 'full' | 'shell' | 'off';
export const INTERIOR_NEIGHBOUR_M = 6;
export function interiorMode(visitorInside: boolean, footprintDistance: number): InteriorMode {
  return visitorInside && footprintDistance <= INTERIOR_NEIGHBOUR_M ? 'full' : 'shell';
}

/**
 * Interior parts kept in the 'shell' mode (model part names): floor, wall, reveal, ceiling, door frames and leaves (a
 * glazed garden door closes the CdL vestibule at pose 03), stairs and landings.
 */
export const SHELL_PARTS: readonly string[] = [
  'interior/boden',
  'interior/wand',
  'interior/laibung',
  'interior/decke',
  'interior/tuer',
  'interior/tuerblatt',
  'interior/treppe',
  'interior/treppe-unterseite',
  'interior/podest',
];

/** True when an interior mesh (part, storey of its room) is drawn in the 'shell' mode: ground-level rooms only. */
export function inShell(part: string | undefined, storey: number | undefined): boolean {
  return !!part && SHELL_PARTS.includes(part) && storey !== undefined && storey <= 1;
}

/** Plan distance (m) from point (x, z) to a closed polygon ring of [x, z] (0 inside). */
export function ringDistance(x: number, z: number, ring: readonly (readonly [number, number])[]): number {
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    const ex = xi - xj;
    const ez = zi - zj;
    const l2 = ex * ex + ez * ez;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - xj) * ex + (z - zj) * ez) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - (xj + t * ex), z - (zj + t * ez)));
  }
  return inside ? 0 : best;
}
