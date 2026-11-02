/**
 * Section definitions shared by the floor plans (markers) and the section sheets, so a marker
 * A–A in the Grundriss and the drawing "Schnitt A–A" are the same cut by construction.
 */
import type { BuildingLayout } from '../../model/src/layout/building.ts';
import { stToEN } from '../../model/src/layout/footprint.ts';
import type { EN, SiteSpec } from '../../model/src/spec.ts';

export interface SectionDef {
  id: 'A' | 'B';
  title: string;
  /** Building whose rooms are cut. */
  building: string;
  /** Cut line in building-local coordinates: along t at s = at, or along s at t = at. */
  along: 's' | 't';
  at: number;
  /** Range along the cut (building-local) shown as the section; site parts extend beyond. */
  from: number;
  to: number;
  /** Grid azimuth the viewer looks towards. */
  lookAz: number;
  /** Extent of the drawing along the cut line beyond the building (m, local coordinate). */
  siteFrom: number;
  siteTo: number;
}

export function sectionDefs(spec: SiteSpec): SectionDef[] {
  const u = spec.palace_grid.u_azimuth_grid_deg;
  return [
    {
      id: 'A',
      title: 'Längsschnitt A–A in der Hauptachse (Ehrenhof – Vestibül – Festsaal – Ostallee), Blick nach Norden',
      building: 'KB-B01',
      along: 't',
      at: 0,
      from: -9,
      to: 9,
      lookAz: (u + 270) % 360,
      // t points to the court (west): +t = Ehrenhof, −t = garden / east avenue
      siteFrom: -16,
      siteTo: 76,
    },
    {
      id: 'B',
      title: 'Querschnitt B–B durch Vestibül und Prunktreppe (Kaiserstiege), Blick nach Westen',
      building: 'KB-B01',
      along: 's',
      at: 0,
      from: -20.45,
      to: 20.45,
      lookAz: (u + 180) % 360,
      siteFrom: -20.45,
      siteTo: 20.45,
    },
  ];
}

/** EN end points of a section line (building-local range r0..r1 along the cut). */
export function sectionLineEN(L: BuildingLayout, d: SectionDef, r0: number, r1: number): [EN, EN] {
  const pt = (r: number): EN => stToEN(L.frame, d.along === 't' ? [d.at, r] : [r, d.at]);
  return [pt(r0), pt(r1)];
}
