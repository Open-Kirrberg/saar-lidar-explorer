/**
 * V2.6b: built-in zones (no package on the data host). Only the procedural *Testraum*: it lets the
 * portal → loading → zone → exit flow run in the real app without generated data. It lives inside both
 * the `fixture` AOI and `overall`, and shows in dev builds, with `?aoi=fixture`, or with `?testraum`.
 * Parsed by the same tolerant parser as fetched packages, so it cannot drift from the contract.
 */
import type { ZoneManifest } from '../contract';
import { parseZoneManifest } from '../contract';

export const TESTRAUM_ID = 'testraum';

/** Room frame: origin at the room centre (integers, contract rule), floor at true height 300 m. */
export const TESTRAUM_ORIGIN = { E0: 382450, N0: 5466270 } as const;
export const TESTRAUM_FLOOR_H = 300;

export const TESTRAUM_JSON = {
  format: 'sle-zone-v1',
  id: TESTRAUM_ID,
  kind: 'reconstructed',
  name_de: 'Testraum',
  summary_de: 'Ein kleiner, erfundener Raum zum Ausprobieren: Portal, Ladebildschirm, Betreten und Verlassen.',
  crs: 'EPSG:25832',
  heightDatum: 'DHHN2016',
  origin: TESTRAUM_ORIGIN,
  // 16 × 16 m hut around the origin; the door is in the south wall.
  footprint: [
    [382442, 5466262],
    [382458, 5466262],
    [382458, 5466278],
    [382442, 5466278],
  ],
  portals: [
    { id: 'tuer', label_de: 'Testraum betreten', E: 382450, N: 5466254, h: null, radius_m: 40, facing_deg: 180, spawn: 'eingang' },
  ],
  spawns: {
    eingang: { E: 382450, N: 5466257, h: TESTRAUM_FLOOR_H + 1.7, heading_deg: 0, pitch_deg: -2, mode: 'gehen' },
  },
  exit: { rule: 'restore' },
  runtime: { kind: 'module', module: TESTRAUM_ID },
  preset: { look: 'dokumentation', sky: 'none', trees: 'none', timeOfDay: 'now' },
  attribution: ['Testraum, eigenes Werk (synthetisch)'],
  evidence: {
    kind: 'hypothesis',
    confidence: 'low',
    perPart: 'none',
    sources_de: ['keine (Testraum)'],
    disclaimer_de: 'Testraum, kein Befund. Schauen, nicht graben.',
  },
  capture: null,
  budget: { downloadBytes: 20000, totalBytes: 20000, triangles: 5000, textureBytesGpu: 1048576 },
  generator: 'app/src/zones/runtime/builtin.ts',
};

export function builtinZones(): ZoneManifest[] {
  const r = parseZoneManifest(TESTRAUM_JSON);
  return r.value ? [r.value] : [];
}

/** Built-ins are dev/test aids: dev builds, the fixture AOI, or an explicit `?testraum`. */
export function builtinZonesEnabled(opts: { dev: boolean; aoi: string; search: string }): boolean {
  return opts.dev || opts.aoi === 'fixture' || new URLSearchParams(opts.search).has('testraum');
}
