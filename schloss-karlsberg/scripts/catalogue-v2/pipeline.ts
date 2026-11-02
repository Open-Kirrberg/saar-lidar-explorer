/**
 * Catalogue v1 -> v2 transformation (pure apart from reading the committed inputs).
 * build.ts runs it and writes model/catalogue.json; tests reuse the checks.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { upgradeBuilding, upgradeV1 } from '../../model/src/catalogue.ts';
import { gridFrame } from '../../model/src/frame.ts';
import { centroid, openRing } from '../../model/src/layout/geom.ts';
import type { Building, EN, SiteSpec } from '../../model/src/spec.ts';
import { applyEdits, carlsbergerHofRanges, grilleBuilding, newBuildings, REMOVED_V1, type BuildCtx } from './buildings.ts';
import { loadDtmSamples, loadLidarFeatures, loadLp06, r2, ringArea, ringHash, ROOT, type DtmSample } from './common.ts';
import { applyProgrammes } from './programme.ts';
import { applyTerrain, LEVEL_FROM_DTM } from './terrain.ts';

/** Buildings whose base_h is the DTM median under the (new) footprint. */
const BASE_FROM_DTM = new Set(['KB-B23', 'KB-B24', 'KB-B25', 'KB-B26', 'KB-B30', 'KB-B30b', 'KB-B30c', 'KB-B30d']);

export interface PrepareResult {
  spec: SiteSpec;
  dtmUsed: number;
  dtmMissing: string[];
}

export function readV1(): SiteSpec {
  return JSON.parse(readFileSync(resolve(ROOT, 'model/catalogue.v1.json'), 'utf8')) as SiteSpec;
}

/** Remove the fields upgradeV1 derives from free text so they are re-derived from the v2 text. */
function resetDerived(b: Building): void {
  const f = b.facade;
  delete f.sides;
  delete f.risalits;
  delete f.portals;
  if (b.roof.raised?.every((r) => (r.tag ?? '').startsWith('I (upgradeV1'))) delete b.roof.raised;
}

export function buildV2(opts: { dtm?: Map<string, DtmSample> } = {}): PrepareResult {
  const v1 = readV1();
  const spec = upgradeV1(v1);
  const grid = gridFrame(spec.palace_grid);
  const lp06 = loadLp06();
  const lidar = loadLidarFeatures();
  const dtm = opts.dtm ?? loadDtmSamples();

  spec.terrain_features = applyTerrain(spec.terrain_features, { grid, lidar });

  const b10 = spec.buildings.find((b) => b.id === 'KB-B10')!;
  const ctx: BuildCtx = { grid, lp06, b10c: centroid(openRing(b10.footprint!)) as EN };
  const v1Ids = new Set(spec.buildings.map((b) => b.id));
  let buildings = applyEdits(spec.buildings, ctx);
  buildings.push(grilleBuilding(ctx), ...newBuildings(ctx), ...carlsbergerHofRanges(ctx));
  const order = (id: string) => (id.startsWith('KB') ? 0 : id.startsWith('KL') ? 1 : 2);
  buildings.sort((a, b) => order(a.id) - order(b.id) || a.id.localeCompare(b.id, 'en', { numeric: true }));
  spec.buildings = buildings;

  // re-derive v2 structure from the (edited) v1 fields
  buildings = buildings.map((b) => {
    if (b.placement === 'unplaced') return b;
    if (v1Ids.has(b.id)) resetDerived(b);
    return upgradeBuilding(b, spec);
  });
  spec.buildings = buildings;

  // ---- DTM: ground statistics, base levels from the DTM, eaves/ridge consistency
  let dtmUsed = 0;
  const dtmMissing: string[] = [];
  for (const b of buildings) {
    if (b.placement === 'unplaced') continue;
    const geomHash = b.footprint ? ringHash(b.footprint) : b.line ? ringHash(b.line) : null;
    const s = dtm.get(b.id);
    if (s && geomHash && s.hash === geomHash) {
      b.ground_dtm = { min: s.min, median: s.median, max: s.max, n_cells: s.n_cells };
      dtmUsed++;
    } else {
      // keep v1 statistics only when the geometry is unchanged
      const v1b = v1.buildings.find((x) => x.id === b.id);
      const same = !!v1b && JSON.stringify(v1b.footprint ?? v1b.line) === JSON.stringify(b.footprint ?? b.line);
      if (!same) b.ground_dtm = null;
      if (!same) dtmMissing.push(b.id);
    }
    const isNew = !v1Ids.has(b.id);
    const fromDtm = BASE_FROM_DTM.has(b.id) || (isNew && (b.base_h_note ?? '').startsWith('DTM median'));
    if (fromDtm && b.ground_dtm) b.base_h = r2(b.ground_dtm.median);
    if (b.footprint) b.footprint_area_m2 = Math.round(ringArea(b.footprint));
    else delete b.footprint_area_m2;
    syncRoofHeights(b);
  }
  for (const t of spec.terrain_features) {
    if (LEVEL_FROM_DTM[t.id] === undefined) continue;
    const s = dtm.get(t.id);
    if (t.geometry.type === 'Polygon' && s && s.hash === ringHash(t.geometry.coordinates[0])) t.level = r2(s.median);
  }

  // ---- room programmes (needs final heights and terrain)
  applyProgrammes(spec);

  // ---- site-level fields
  spec.version = 2;
  spec.status =
    'catalogue v2 (2026-11-01): built by scripts/catalogue-v2/build.ts from model/catalogue.v1.json + research/07 (LP06, LC 1790, PV 1791) + research/08 (HMS measurements). A hypothesis, not a survey.';
  spec.conventions = {
    ...spec.conventions,
    placement: 'lidar | lidar+hms | map+lidar | map (LP06 only, research/07) | existing | relative | hypothetical | unplaced',
    rooms: 'rooms[].polygon in building-local [s,t] m (layout/footprint.ts), CCW, open; storey = index into storeys; floor_h/ceiling_h absolute m DHHN2016',
    openings: 'interior openings only (facade openings come from facade.sides/portals via layoutBuilding); wall = segment in [s,t] or exterior side',
    conflict_rule: 'documented period sources > LP06 research plan > LiDAR positions > HMS heights/massing > comparables/norms (research/07 §3)',
  };
  spec.defaults = {
    ...spec.defaults,
    time_slice: 'summer 1789',
    roofs: 'palace group slate-blue (slate), service buildings red tile [D PV 1791]',
    eaves_palace: 356.0,
  };
  spec.open_questions = OPEN_QUESTIONS;
  return { spec, dtmUsed, dtmMissing };
}

/** eaves_h = base_h + Σ storeys; the ridge moves with it (same section). */
function syncRoofHeights(b: Building): void {
  if (b.base_h === null || !b.storeys.length) return;
  const eaves = r2(b.base_h + b.storeys.reduce((s, x) => s + x.height, 0));
  const r = b.roof;
  if (r.eaves_h === undefined) return;
  const d = eaves - r.eaves_h;
  if (Math.abs(d) < 0.005) return;
  r.eaves_h = eaves;
  if (r.ridge_h !== undefined) r.ridge_h = r2(r.ridge_h + d);
}

export const OPEN_QUESTIONS = [
  'CdL extent (P1, medium-low): 41 m block between the arms (v2, LP06 + HMS) or the v1 78 m range over the arm ends? Needs the 1804/1825 plans or Schwan 2010/2012 figures.',
  'Room programme of every wing is inferred (I/N): only room names (Weber ToC, room-guide snippets) are documented, not their positions. Which wing held which apartment: LP06 (N = Duke, S = Duchess) vs HMS (S = Duke).',
  'Axis counts: HMS counts (CdL 15, arms 3.15 m spacing, Orangerie 25) need hi-res LC 1790 / PV scans; ±2 axes.',
  'Gallery level and form (P10): 8 m range on the KB-07 scarp at 347.6 with a square end pavilion (LP06) vs a low HMS range ending in a rotunda.',
  'Mansard on the Sammlungsflügel and Küchenbau (not depicted in LC/PL) and the CdL centre pavilion height (HMS 366.2 + lantern).',
  'Ehrenhof grille position (court mouth u -34 or nearer the CdL) and the forecourt (LDA 2006 report).',
  'Orangerie upper tier: courtiers\' rooms (PV b.) over the end bays vs a fully double-height hall; KB-B13 rotunda not in LP06 (temporary 1785?).',
  'Unplaced: Bienenhaus, Ananashaus, Chinoiserie, Lusthaus des Prinzen, Lustgarten der Herzogin, Monbijou, Kirchturm, Kapelle/Ballhaus/Apotheke; the chestnut avenue (PV u.).',
  'Großes/Kleines Bassin = KL-13/KL-11 (low); Carlsbergweiher larger in LP06 than today.',
  'Karlslust lies S of N 5465000, outside the explorer karlsberg AOI: extend the AOI south to ~5464550 (the cascade geometry is kept regardless).',
];

export { REMOVED_V1 };
