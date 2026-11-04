/**
 * V2.6b: zone modules in this build (ADR 0029: same bundle, lazy chunks, selected by name only).
 * `runtime: { kind: "module", module: <name> }` in a zone.json must name an entry here, else the zone is
 * absent. Add a zone with one line: `'<name>': () => import('<path>')` (module exports `mountZone`).
 */
import type { ZoneModuleLoader } from './api';

export const ZONE_MODULES: Readonly<Record<string, ZoneModuleLoader>> = {
  // Built-in procedural test room (no data needed): exercises portal → loading → zone → exit.
  testraum: () => import('./testRoom'),
};

export const zoneModuleNames = (): ReadonlySet<string> => new Set(Object.keys(ZONE_MODULES));
