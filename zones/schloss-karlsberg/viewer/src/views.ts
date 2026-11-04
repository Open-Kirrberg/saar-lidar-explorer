/**
 * Overview POIs („Ansichten“) computed from the catalogue (palace grid origin, Ehrenhof TF-01 level). Pure (no three,
 * no DOM). Moved out of main.ts for the V2.7 highlights.
 */
import type { Poi } from '@model/context.ts';
import { E0, N0 } from '@model/frame.ts';
import type { SiteSpec } from '@model/spec.ts';

/** Eye height above the floor (m); the same as controls.ts EYE. */
const EYE = 1.65;

/** Palace anchor (local x, z): the palace grid origin. */
export function palaceAnchor(spec: Pick<SiteSpec, 'palace_grid'>): { x: number; z: number } {
  const pg = spec.palace_grid;
  return { x: pg.origin_EN[0] - E0, z: -(pg.origin_EN[1] - N0) };
}

export function viewPois(spec: Pick<SiteSpec, 'palace_grid' | 'terrain_features'>): Poi[] {
  const { x: gx, z: gz } = palaceAnchor(spec);
  const ehrenhof = spec.terrain_features.find((f) => f.id === 'TF-01');
  return [
    { id: 'view-west', name_de: 'Übersicht von Westen (Ehrenhof)', kind: 'view', position: { x: gx - 230, y: 345 + 105, z: gz + 45 }, lookAt: { x: gx + 25, y: 348, z: gz - 5 } },
    { id: 'view-east', name_de: 'Übersicht von Osten (Gartenseite)', kind: 'view', position: { x: gx + 260, y: 348 + 100, z: gz - 70 }, lookAt: { x: gx, y: 350, z: gz } },
    { id: 'view-ehrenhof', name_de: 'Ehrenhof (Augenhöhe)', kind: 'view', position: { x: gx - 28, y: (ehrenhof?.level ?? 344.8) + EYE, z: gz + 6 }, lookAt: { x: gx + 30, y: 352, z: gz } },
    { id: 'view-karlslust', name_de: 'Karlslust (Talblick)', kind: 'view', position: { x: 1700, y: 420, z: -500 }, lookAt: { x: 1800, y: 280, z: -1000 } },
  ];
}

/**
 * Preferred hour per overview (KB-I08, visual-audit §2 sun table): the court (west) front at 17:30, the garden
 * (east) front at 07:00. Applied when the user picks the view in „Gehe zu“, not by the test hook `skb.goto`.
 */
export const VIEW_HOURS: Readonly<Record<string, number>> = { 'view-west': 17.5, 'view-ehrenhof': 17.5, 'view-east': 7.0 };

/** POIs that start in walk mode. */
export function poiWalks(p: Pick<Poi, 'id' | 'kind'>): boolean {
  return p.kind === 'entrance' || p.kind === 'room' || p.id === 'view-ehrenhof';
}
