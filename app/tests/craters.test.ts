/**
 * F22: UXO indicator classes `crater` / `crater_field` from saar-lidar-detect (contract
 * "Candidates" → UXO classes): manifest + feature parsing, tolerance, the public-build drop,
 * filters, metrics, markers, review decisions and export.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  candidateLabel,
  candidateRadius,
  decisionFor,
  defaultCraterMinScore,
  defaultFilter,
  filterCandidates,
  flyDistance,
  formatMetrics,
  markerCategoryFor,
  markerTextFor,
  outlinePositions,
  parseCandidateCollection,
  sanitizeFilter,
} from '../src/candidates/candidateData';
import type { Candidate } from '../src/candidates/candidateData';
import { CLASS_COLORS, candidateColor } from '../src/candidates/colors';
import { loadCandidatePrefs } from '../src/candidates/prefs';
import { emptyReviewStore, exportDecisions, loadReviews, reattachDecisions, saveReviews } from '../src/candidates/reviewStore';
import type { KV } from '../src/candidates/reviewStore';
import {
  CANDIDATE_CLASSES,
  CANDIDATE_CLASS_LABELS_DE,
  UXO_NOTE_DE,
  isAllowedCandidateClass,
  isUxoClass,
  parseCandidates,
} from '../src/data/manifest';
import { isPublicBuild, uxoClassesAllowed } from '../src/data/publicBuild';
import { MARKER_CATEGORIES } from '../src/markers/markerStore';
import { MAX_STYLES } from '../src/vectors/styles';

const grid = { nx: 12, ny: 16 };

/** Manifest `candidates` as written by `sld run` (relicts + craters), trimmed. */
const sldMeta = {
  path: 'candidates/candidates.geojson',
  crs: 'EPSG:25832',
  featureCount: 5930,
  heights: 'baked',
  counts: { pit: 441, mound: 850, linear: 1477, rect: 15, platform: 462, crater: 2664, crater_field: 21 },
  classes: {
    pit: 'Grube/Trichter',
    crater: 'Bombentrichter (Hypothese)',
    crater_field: 'Trichterfeld (Hypothese)',
  },
  method: 'lrm-rules',
  version: 2,
  params: { min_score: 0.3, crater_threshold: 0.55 },
  mask: { path: 'candidates/mask/{i}_{j}.png', encoding: 'class8', minScore: 0.4, chunks: [[0, 0], [11, 15]] },
  label_de: 'Verdachtsflächen',
  generator: 'saar-lidar-detect 0.1.0',
  method_version: 'lrm-rules/2+sld.0.1.0',
  method_versions: ['crater-rules/1+sld.0.1.0', 'lrm-rules/2+sld.0.1.0'],
  detectors: ['relicts', 'craters'],
  data_dates: ['2022', '2025'],
  disclaimer_de: 'Hypothesen, keine Befunde. Keine Aussage über Kampfmittel.',
  tiling: { size_m: 1000 },
};

const feat = (props: Record<string, unknown>, coords: unknown = [300002.5, 5500055.5, 290.1]) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: coords },
  properties: props,
});

/** Closed CCW ring around (300100, 5500000), radius 100 m, 2 m segments, baked z. */
function fieldRing(): number[][] {
  const n = 315;
  const ring: number[][] = [];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    ring.push([Math.round((300100 + 100 * Math.cos(a)) * 100) / 100, Math.round((5500000 + 100 * Math.sin(a)) * 100) / 100, 288]);
  }
  ring.push([...ring[0]]);
  return ring;
}

const crater = feat({
  id: 'crater-300003-5500056',
  class: 'crater',
  score: 0.91,
  metrics: { diameter_m: 7.95, rim_diameter_m: 11, depth_m: 1.05, rim_m: 0.27, rim_frac: 0.75, circularity: 0.86, n_50m: 5 },
  reasons: ['Runde Senke, Ø 8 m, 1,1 m tief, Ringwall zu 75 % geschlossen', 'sehr regelmäßige Kreisform'],
  forest: true,
  near_path: false,
  along_path: true, // contract: always false for craters; the app reads it for linear only
  near_known: null,
  method_version: 'crater-rules/1+sld.0.1.0',
  data_date: '2025',
});
const field = feat(
  {
    id: 'crater_field-300100-5500000',
    class: 'crater_field',
    score: 1,
    metrics: { n_craters: 39, area_ha: 3.52, density_per_ha: 11.09, diam_median_m: 5.7, nn_median_m: 14.87, crater_score_mean: 0.89 },
    reasons: ['Trichterfeld: 39 Trichterverdachte auf 3,5 ha (11,1 je ha)'],
    forest: true,
    near_path: false,
    along_path: false,
    near_known: null,
    outline: { type: 'Polygon', coordinates: [fieldRing()] },
    member_ids: ['crater-300003-5500056', 7, '', 'crater-300004-5499968'],
    method_version: 'crater-rules/1+sld.0.1.0',
    data_date: '2025',
  },
  [300100, 5500000, 288.48],
);
const pit = feat({ id: 'pit-1', class: 'pit', score: 0.6, member_ids: ['x'] }, [382000, 5466000]);

describe('F22 manifest: crater classes', () => {
  it('keeps crater counts, labels and the additive sld keys', () => {
    const c = parseCandidates(sldMeta, grid, true)!;
    expect(c.counts).toMatchObject({ crater: 2664, crater_field: 21, pit: 441 });
    expect(c.featureCount).toBe(5930);
    expect(c.classes.crater).toBe('Bombentrichter (Hypothese)');
    expect(c.classes.crater_field).toBe('Trichterfeld (Hypothese)');
    expect(c.classes.mound).toBe(CANDIDATE_CLASS_LABELS_DE.mound);
    expect(c.params.crater_threshold).toBe(0.55);
    expect(c.method_versions).toEqual(['crater-rules/1+sld.0.1.0', 'lrm-rules/2+sld.0.1.0']);
    expect(c.detectors).toEqual(['relicts', 'craters']);
    expect(c.data_dates).toEqual(['2022', '2025']);
    expect(c.generator).toBe('saar-lidar-detect 0.1.0');
    expect(c.disclaimer_de).toContain('Kampfmittel');
  });

  it('defaults the labels when the manifest has none and tolerates junk in the additive keys', () => {
    const c = parseCandidates(
      { ...sldMeta, classes: undefined, method_versions: 'x', detectors: [1, 'craters', null], data_dates: {}, disclaimer_de: '', generator: 5 },
      grid,
      true,
    )!;
    expect(c.classes.crater).toBe('Bombentrichter (Hypothese)');
    expect(c.classes.crater_field).toBe('Trichterfeld (Hypothese)');
    expect(c.method_versions).toBeUndefined();
    expect(c.detectors).toEqual(['craters']);
    expect(c.data_dates).toBeUndefined();
    expect(c.disclaimer_de).toBeUndefined();
    expect(c.generator).toBeUndefined();
  });

  it('loads an old relict-only manifest exactly as before (no additive keys appear)', () => {
    const old = { path: 'candidates/candidates.geojson', crs: 'EPSG:25832', featureCount: 3, counts: { pit: 3 }, method: 'lrm-rules', version: 2, params: { min_score: 0.3 } };
    const c = parseCandidates(old, grid, true)!;
    expect(c.counts).toEqual({ pit: 3 });
    expect(c.featureCount).toBe(3);
    for (const k of ['generator', 'method_version', 'method_versions', 'detectors', 'data_dates', 'disclaimer_de']) expect(k in c).toBe(false);
  });

  it('public build: drops crater counts/labels/threshold/versions and subtracts them from featureCount', () => {
    const c = parseCandidates(sldMeta, grid, false)!;
    expect(c.counts).toEqual({ pit: 441, mound: 850, linear: 1477, rect: 15, platform: 462 });
    expect(c.featureCount).toBe(5930 - 2664 - 21);
    expect(c.params.crater_threshold).toBeUndefined();
    expect(c.params.min_score).toBe(0.3);
    expect(c.method_versions).toEqual(['lrm-rules/2+sld.0.1.0']);
    expect(c.detectors).toEqual(['relicts']);
    expect(c.classes.pit).toBe('Grube/Trichter');
    expect(sldMeta.params.crater_threshold).toBe(0.55); // input untouched
  });

  it('class guards', () => {
    expect(CANDIDATE_CLASSES).toEqual(['pit', 'mound', 'linear', 'rect', 'platform', 'crater', 'crater_field']);
    expect(isUxoClass('crater')).toBe(true);
    expect(isUxoClass('crater_field')).toBe(true);
    expect(isUxoClass('pit')).toBe(false);
    expect(isAllowedCandidateClass('crater', true)).toBe(true);
    expect(isAllowedCandidateClass('crater', false)).toBe(false);
    expect(isAllowedCandidateClass('pit', false)).toBe(true);
    expect(isAllowedCandidateClass('bomb', true)).toBe(false);
  });

  it('public-build flag comes only from VITE_SLE_PUBLIC=1', () => {
    expect(isPublicBuild({ VITE_SLE_PUBLIC: '1' })).toBe(true);
    expect(uxoClassesAllowed({ VITE_SLE_PUBLIC: '1' })).toBe(false);
    expect(uxoClassesAllowed({})).toBe(true);
    expect(uxoClassesAllowed({ VITE_SLE_PUBLIC: '0' })).toBe(true);
    // default env: local runs are not public; the Pages workflow runs the tests with SLE_PUBLIC=1 (vite.config.ts forces the flag)
    expect(uxoClassesAllowed()).toBe(process.env.SLE_PUBLIC !== '1');
  });
});

describe('F22 features: crater + crater_field', () => {
  const parsed = parseCandidateCollection({ features: [pit, crater, field] }, true);
  const byId = new Map(parsed.candidates.map((c) => [c.id, c]));
  const cr = byId.get('crater-300003-5500056')!;
  const cf = byId.get('crater_field-300100-5500000')!;

  it('parses both classes with metrics, reasons, extras and score order', () => {
    expect(parsed.skipped).toBe(0);
    expect(parsed.candidates.map((c) => c.cls)).toEqual(['crater_field', 'crater', 'pit']);
    expect(cr).toMatchObject({ cls: 'crater', score: 0.91, forest: true, nearPath: false, alongPath: false, nearKnown: null, dataDate: '2025', methodVersion: 'crater-rules/1+sld.0.1.0' });
    expect(cr.z).toBeCloseTo(290.1);
    expect(cr.outline).toBeUndefined();
    expect(cr.memberIds).toBeUndefined();
    expect(cr.reasons).toHaveLength(2);
    expect(cf.outline?.type).toBe('Polygon');
    expect(cf.memberIds).toEqual(['crater-300003-5500056', 'crater-300004-5499968']); // junk entries dropped
    expect(byId.get('pit-1')!.memberIds).toBeUndefined(); // member_ids only for crater_field
  });

  it('crater_field without member_ids → []', () => {
    const f = feat({ id: 'crater_field-1', class: 'crater_field', score: 0.8 });
    expect(parseCandidateCollection({ features: [f] }, true).candidates[0].memberIds).toEqual([]);
  });

  it('public build / UXO disallowed: crater classes are skipped like unknown classes', () => {
    const r = parseCandidateCollection({ features: [pit, crater, field] }, false);
    expect(r.candidates.map((c) => c.id)).toEqual(['pit-1']);
    expect(r.skipped).toBe(2);
  });

  it('labels, colours (distinct) and marker categories', () => {
    expect(candidateLabel(cr)).toBe('Bombentrichter (Hypothese)');
    expect(candidateLabel(cf)).toBe('Trichterfeld (Hypothese)');
    const colours = Object.values(CLASS_COLORS);
    expect(new Set(colours).size).toBe(colours.length);
    expect(candidateColor(cr)).toBe(CLASS_COLORS.crater);
    expect(candidateColor(cf)).toBe(CLASS_COLORS.crater_field);
    expect(MARKER_CATEGORIES).toContain(markerCategoryFor(cr));
    expect(MARKER_CATEGORIES).toContain(markerCategoryFor(cf));
    expect(markerCategoryFor(cr)).toBe('Grube/Trichter');
    // 3D style slots: every class + known path + selected fit into the DrapedLines uniforms
    expect(CANDIDATE_CLASSES.length + 2).toBeLessThanOrEqual(MAX_STYLES);
  });

  it('geometry: crater = circle of diameter_m, field = its outline; radius and fly distance', () => {
    const circle = outlinePositions(cr);
    const r = Math.hypot(circle[0][0] - cr.E, circle[0][1] - cr.N);
    expect(r).toBeCloseTo(7.95 / 2, 5);
    expect(candidateRadius(cr)).toBeCloseTo(3.975);
    const ring = outlinePositions(cf);
    expect(ring.length).toBeGreaterThan(300);
    expect(ring[0][2]).toBe(288);
    expect(candidateRadius(cf)).toBeCloseTo(100, 0);
    expect(flyDistance(cf)).toBeGreaterThanOrEqual(240);
    expect(flyDistance(cf)).toBeLessThanOrEqual(900);
    expect(flyDistance(cr)).toBe(45);
    // a field without outline falls back to its area in hectares
    const bare: Candidate = { ...cf, outline: undefined };
    expect(candidateRadius(bare)).toBeCloseTo(Math.sqrt(35200 / Math.PI), 3);
  });

  it('formats crater and field metrics in German', () => {
    const m = formatMetrics(cr.metrics);
    expect(m).toContainEqual(['Durchmesser Randwall', '11,0 m']);
    expect(m).toContainEqual(['Randwall geschlossen', '75 %']);
    expect(m).toContainEqual(['weitere Trichter ≤ 50 m', '5']);
    const f = formatMetrics(cf.metrics);
    expect(f).toContainEqual(['Trichterverdachte', '39']);
    expect(f).toContainEqual(['Fläche', '3,52 ha']);
    expect(f).toContainEqual(['Dichte', '11,1 je ha']);
  });

  it('marker note carries the UXO wording for craters only', () => {
    const t = markerTextFor(cr, candidateLabel(cr), { method: 'lrm-rules', version: 2 });
    expect(t.title).toBe('Bombentrichter (Hypothese) (Kandidat)');
    expect(t.note).toContain(UXO_NOTE_DE);
    expect(t.note).toContain('Schauen, nicht graben');
    expect(t.note).toContain('crater-rules/1+sld.0.1.0');
    expect(markerTextFor(cf, candidateLabel(cf)).note).toContain('Trichterfeld aus 2 Trichterverdachten');
    expect(markerTextFor(byId.get('pit-1')!, 'Grube/Trichter').note).not.toContain('Kampfmittel');
  });
});

describe('F22 filter', () => {
  const list = parseCandidateCollection(
    {
      features: [
        feat({ id: 'crater-a', class: 'crater', score: 0.9 }),
        feat({ id: 'crater-b', class: 'crater', score: 0.45 }),
        feat({ id: 'crater_field-c', class: 'crater_field', score: 0.5 }),
        feat({ id: 'pit-d', class: 'pit', score: 0.45 }),
      ],
    },
    true,
  ).candidates;

  it('craters use their own min score (default params.crater_threshold), other classes the general one', () => {
    expect(defaultCraterMinScore({ crater_threshold: 0.55 })).toBe(0.55);
    expect(defaultCraterMinScore({ crater_threshold: 0.4 })).toBe(0.4);
    expect(defaultCraterMinScore({ crater_threshold: 7 })).toBe(0.55);
    expect(defaultCraterMinScore({ crater_threshold: '0.4' })).toBe(0.55);
    expect(defaultCraterMinScore(undefined)).toBe(0.55);
    const f = defaultFilter(0.3, 0.55);
    expect(filterCandidates(list, f).map((c) => c.id)).toEqual(['crater-a', 'crater_field-c', 'pit-d']);
    expect(filterCandidates(list, { ...f, craterMinScore: 0.3 }).map((c) => c.id)).toEqual(['crater-a', 'crater_field-c', 'crater-b', 'pit-d']);
    expect(filterCandidates(list, { ...f, minScore: 0.6 }).map((c) => c.id)).toEqual(['crater-a']);
    expect(filterCandidates(list, { ...f, classes: { ...f.classes, crater: false, crater_field: false } }).map((c) => c.id)).toEqual(['pit-d']);
  });

  it('old stored filters (5 classes, no craterMinScore) get the crater defaults', () => {
    const stored = { classes: { pit: false, mound: true, linear: true, rect: true, platform: true }, knownPaths: true, minScore: 0.4 };
    const s = sanitizeFilter(stored, defaultFilter(0.3, 0.55));
    expect(s.classes).toMatchObject({ pit: false, crater: true, crater_field: true });
    expect(s.minScore).toBe(0.4);
    expect(s.craterMinScore).toBe(0.55);
    expect(sanitizeFilter({ craterMinScore: 3 }).craterMinScore).toBe(1);
  });

  it('per-AOI prefs from an older app version load with craters on', () => {
    const data: Record<string, string> = { 'sle.candidates.prefs.v1.overall': JSON.stringify({ on: true, filter: { classes: { pit: true }, minScore: 0.5 } }) };
    const kv = { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
    const { prefs } = loadCandidatePrefs(kv, 'overall', 0.3, 0.55);
    expect(prefs.on).toBe(true);
    expect(prefs.filter.classes.crater).toBe(true);
    expect(prefs.filter.craterMinScore).toBe(0.55);
    expect(prefs.filter.minScore).toBe(0.5);
  });
});

describe('F22 review decisions for craters', () => {
  const now = new Date('2026-11-02T10:00:00Z');
  const memKV = (): KV & { data: Record<string, string> } => {
    const data: Record<string, string> = {};
    return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
  };
  const [cf, cr] = parseCandidateCollection({ features: [crater, field] }, true).candidates;

  it('round-trips crater and crater_field decisions through localStorage', () => {
    const kv = memKV();
    const s = emptyReviewStore();
    s.decisions[cr.id] = decisionFor(cr, 'confirmed', now, 'm-1');
    s.decisions[cf.id] = decisionFor(cf, 'unsure', now);
    expect(saveReviews(kv, 'overall', s)).toBe(true);
    const back = loadReviews(kv, 'overall');
    expect(back.decisions[cr.id]).toMatchObject({ status: 'confirmed', class: 'crater', markerId: 'm-1', score: 0.91 });
    expect(back.decisions[cf.id]).toMatchObject({ status: 'unsure', class: 'crater_field' });
  });

  it('re-attaches a crater decision only to a crater (not to a pit at the same spot)', () => {
    const s = emptyReviewStore();
    s.decisions['crater-old'] = { status: 'rejected', at: now.toISOString(), class: 'crater', E: cr.E + 1, N: cr.N, score: 0.6 };
    const samePlacePit: Candidate = { ...cr, id: 'pit-x', cls: 'pit' };
    const r1 = reattachDecisions(s, [samePlacePit]);
    expect(r1.moved).toBe(0);
    const r2 = reattachDecisions(s, [samePlacePit, cr]);
    expect(r2.moved).toBe(1);
    expect(r2.store.decisions[cr.id]).toMatchObject({ status: 'rejected', class: 'crater' });
  });

  it('exports sle-candidate-decisions with per-class counts and the UXO note', () => {
    const s = emptyReviewStore();
    s.decisions[cr.id] = decisionFor(cr, 'confirmed', now);
    s.decisions[cf.id] = decisionFor(cf, 'rejected', now);
    s.decisions.p = { status: 'unsure', at: now.toISOString(), class: 'pit', E: 1, N: 2, score: 0.4 };
    const e = exportDecisions(s, 'overall', { method: 'lrm-rules', version: 2 }, now);
    expect(e.type).toBe('sle-candidate-decisions');
    expect(e.version).toBe(1);
    expect(e.counts).toEqual({ confirmed: 1, rejected: 1, unsure: 1 });
    expect(e.classes).toEqual({ crater: 1, crater_field: 1, pit: 1 });
    expect(e.note).toContain('Schauen, nicht graben');
    expect(e.note).toContain(UXO_NOTE_DE);
    // relict-only exports keep the old note
    const r = emptyReviewStore();
    r.decisions.p = s.decisions.p;
    expect(exportDecisions(r, 'overall', { method: 'lrm-rules', version: 2 }, now).note).not.toContain('Kampfmittel');
  });

  it('decisions keep working when the manifest is public (class guard is storage-agnostic)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kv = memKV();
    kv.data['sle.candidates.v1.overall'] = JSON.stringify({ version: 1, decisions: { [cr.id]: { status: 'confirmed', at: now.toISOString(), class: 'crater', E: cr.E, N: cr.N, score: 0.9 }, bad: { status: 'confirmed', class: 'bomb', E: 1, N: 1 } } });
    const back = loadReviews(kv, 'overall');
    expect(Object.keys(back.decisions)).toEqual([cr.id]);
    warn.mockRestore();
  });
});

describe('disclaimer crater note (Q-29)', () => {
  it('mentions craters only where crater classes are allowed', async () => {
    const { craterDisclaimer } = await import('../src/ui/disclaimer');
    expect(craterDisclaimer(true)).toContain('Bombentrichter');
    expect(craterDisclaimer(false)).toBe('');
  });
});
