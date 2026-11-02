import { describe, expect, it } from 'vitest';
import {
  byScore,
  candidateLabel,
  candidateRadius,
  countByClass,
  decisionFor,
  defaultFilter,
  defaultMinScore,
  existingCandidateMarkerId,
  filterCandidates,
  formatMetrics,
  markerCategoryFor,
  markerTextFor,
  outlinePositions,
  parseCandidateCollection,
  sanitizeFilter,
  stepCandidate,
} from '../src/candidates/candidateData';
import type { Candidate } from '../src/candidates/candidateData';
import { candidateColor, CLASS_COLORS, KNOWN_PATH_COLOR } from '../src/candidates/colors';
import { emptyReviewStore, exportDecisions, loadReviews, reattachDecisions, saveReviews } from '../src/candidates/reviewStore';
import type { KV } from '../src/candidates/reviewStore';
import { MARKER_CATEGORIES } from '../src/markers/markerStore';

const feat = (props: Record<string, unknown>, coords: unknown = [382500, 5466500, 300], type = 'Point') => ({
  type: 'Feature',
  geometry: { type, coordinates: coords },
  properties: props,
});

const cand = (p: Partial<Candidate> & Pick<Candidate, 'id'>): Candidate => ({
  cls: 'pit',
  score: 0.5,
  E: 382500,
  N: 5466500,
  z: NaN,
  metrics: {},
  reasons: [],
  forest: false,
  nearPath: false,
  alongPath: false,
  nearKnown: null,
  ...p,
});

function memKV(init: Record<string, string> = {}): KV & { data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

describe('parseCandidateCollection', () => {
  it('parses valid features, applies defaults and sorts by score', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        feat({ id: 'pit-1', class: 'pit', score: 0.4, metrics: { depth_m: 0.8, bogus: 'x' }, reasons: ['rund', 3] }),
        feat({ id: 'rect-1', class: 'rect', score: 0.9, forest: true, near_path: true, near_known: 'poi/7' }, [382600.5, 5466400.25]),
      ],
    };
    const { candidates, skipped } = parseCandidateCollection(fc);
    expect(skipped).toBe(0);
    expect(candidates.map((c) => c.id)).toEqual(['rect-1', 'pit-1']);
    const [r, p] = candidates;
    expect(r).toMatchObject({ cls: 'rect', E: 382600.5, N: 5466400.25, forest: true, nearPath: true, nearKnown: 'poi/7' });
    expect(Number.isNaN(r.z)).toBe(true);
    expect(p.z).toBe(300);
    expect(p.metrics).toEqual({ depth_m: 0.8 });
    expect(p.reasons).toEqual(['rund']);
    expect(p).toMatchObject({ forest: false, nearPath: false, alongPath: false, nearKnown: null });
  });

  it('reads along_path for linear candidates only (missing → false)', () => {
    const { candidates } = parseCandidateCollection({
      type: 'FeatureCollection',
      features: [
        feat({ id: 'l1', class: 'linear', score: 0.9, near_path: true, along_path: true }),
        feat({ id: 'l2', class: 'linear', score: 0.8, near_path: true }),
        feat({ id: 'p1', class: 'pit', score: 0.7, near_path: true, along_path: true }),
      ],
    });
    expect(candidates.map((c) => [c.id, c.nearPath, c.alongPath])).toEqual([
      ['l1', true, true],
      ['l2', true, false],
      ['p1', true, false],
    ]);
  });

  it('skips unknown classes, non-point geometry and non-finite scores', () => {
    const fc = {
      features: [
        feat({ id: 'a', class: 'castle', score: 0.5 }),
        feat({ id: 'b', class: 'pit', score: 0.5 }, [[1, 2], [3, 4]], 'LineString'),
        feat({ id: 'c', class: 'pit', score: 'high' }),
        feat({ id: 'd', class: 'pit', score: NaN }),
        feat({ id: 'e', class: 'pit', score: 0.5 }, [Number.NaN, 1]),
        null,
        feat({ id: 'ok', class: 'mound', score: 0.3 }),
      ],
    };
    const r = parseCandidateCollection(fc);
    expect(r.candidates.map((c) => c.id)).toEqual(['ok']);
    expect(r.skipped).toBe(6);
    expect(parseCandidateCollection(null)).toEqual({ candidates: [], skipped: 0 });
  });

  it('derives missing ids and de-duplicates collisions', () => {
    const fc = {
      features: [
        feat({ class: 'pit', score: 0.5 }, [382412.4, 5466731.6]),
        feat({ class: 'pit', score: 0.4 }, [382412.3, 5466731.7]),
        feat({ id: 'x', class: 'pit', score: 0.3 }),
        feat({ id: 'x', class: 'pit', score: 0.2 }),
      ],
    };
    expect(parseCandidateCollection(fc).candidates.map((c) => c.id)).toEqual([
      'pit-382412-5466732',
      'pit-382412-5466732-2',
      'x',
      'x-2',
    ]);
  });

  it('keeps Polygon exterior rings and LineStrings as outlines, drops invalid ones', () => {
    const ring = [[0, 0, 1], [10, 0, 2], [10, 10, 3], [0, 0, 1]];
    const fc = {
      features: [
        feat({ id: 'p', class: 'rect', score: 0.5, outline: { type: 'Polygon', coordinates: [ring, [[1, 1], [2, 2], [1, 1]]] } }),
        feat({ id: 'l', class: 'linear', score: 0.4, outline: { type: 'LineString', coordinates: [[0, 0], [5, 0], ['x', 1]] } }),
        feat({ id: 'm', class: 'mound', score: 0.3, outline: { type: 'Point', coordinates: [0, 0] } }),
      ],
    };
    const [p, l, m] = parseCandidateCollection(fc).candidates;
    expect(p.outline).toEqual({ type: 'Polygon', coords: ring });
    expect(l.outline).toEqual({ type: 'LineString', coords: [[0, 0], [5, 0]] });
    expect(m.outline).toBeUndefined();
  });
});

describe('labels, colours, marker mapping', () => {
  it('shows only linear candidates running along a way (along_path) as "Weg (bekannt)"', () => {
    expect(candidateLabel({ cls: 'linear', alongPath: true })).toBe('Weg (bekannt)');
    expect(candidateLabel({ cls: 'linear', alongPath: false })).toBe('Graben/Wall/Weg');
    expect(candidateLabel(cand({ id: 'x', cls: 'linear', nearPath: true }))).toBe('Graben/Wall/Weg'); // merely crosses
    expect(candidateLabel({ cls: 'pit', alongPath: true })).toBe('Grube/Trichter');
    expect(candidateColor({ cls: 'linear', alongPath: true })).toBe(KNOWN_PATH_COLOR);
    expect(candidateColor({ cls: 'linear', alongPath: false })).toBe(CLASS_COLORS.linear);
    expect(candidateColor({ cls: 'mound', alongPath: false })).toBe(CLASS_COLORS.mound);
  });

  it('maps every class to a valid marker category', () => {
    for (const cls of ['pit', 'mound', 'linear', 'rect', 'platform'] as const) {
      for (const alongPath of [false, true]) {
        expect(MARKER_CATEGORIES).toContain(markerCategoryFor({ cls, alongPath }));
      }
    }
    expect(markerCategoryFor({ cls: 'linear', alongPath: true })).toBe('Weg');
    expect(markerCategoryFor({ cls: 'linear', alongPath: false })).toBe('Graben');
    expect(markerCategoryFor({ cls: 'pit', alongPath: false })).toBe('Grube/Trichter');
  });

  it('finds the marker of a confirmed candidate again (confirm → reset → confirm makes no duplicate)', () => {
    const c = cand({ id: 'pit-1', reasons: ['rund'] });
    const note = markerTextFor(c, 'Grube/Trichter').note;
    const markers = [
      { id: 'm-other', note: markerTextFor(cand({ id: 'pit-1-2' }), 'Grube/Trichter').note },
      { id: 'm-1', note },
    ];
    // confirmed: decision carries markerId
    expect(existingCandidateMarkerId('pit-1', 'm-1', markers)).toBe('m-1');
    // reset deleted the decision (no markerId) → found by the note tag, not the "-2" sibling
    expect(existingCandidateMarkerId('pit-1', undefined, markers)).toBe('m-1');
    expect(existingCandidateMarkerId('pit-1-2', undefined, markers)).toBe('m-other');
    // stale markerId (marker deleted by the user) and no tagged marker → a new one is created
    expect(existingCandidateMarkerId('pit-1', 'gone', [markers[0]])).toBeUndefined();
    expect(existingCandidateMarkerId('pit-9', undefined, markers)).toBeUndefined();
  });

  it('defaults the min-score filter to the detector write threshold', () => {
    expect(defaultMinScore({ min_score: 0.3 })).toBe(0.3);
    expect(defaultMinScore({ min_score: 0.25 })).toBe(0.25);
    expect(defaultMinScore({ min_score: '0.5' })).toBe(0.3);
    expect(defaultMinScore({})).toBe(0.3);
    expect(defaultMinScore(undefined)).toBe(0.3);
  });

  it('puts reasons, metrics and the disclaimer into the marker note', () => {
    const c = cand({ id: 'pit-1', score: 0.82, reasons: ['rund, 0,8 m tief', 'mit Randwall'], metrics: { depth_m: 0.8, diameter_m: 6 }, nearKnown: 'poi/3' });
    const t = markerTextFor(c, 'Grube/Trichter', { method: 'lrm-rules', version: 2 });
    expect(t.title).toBe('Grube/Trichter (Kandidat)');
    expect(t.note).toContain('Score 0,82');
    expect(t.note).toContain('rund, 0,8 m tief; mit Randwall');
    expect(t.note).toContain('Tiefe 0,80 m');
    expect(t.note).toContain('poi/3');
    expect(t.note).toContain('lrm-rules v2');
    expect(t.note).toContain('Schauen, nicht graben');
  });

  it('formats known metrics in German in a fixed order', () => {
    expect(formatMetrics({ area_m2: 28.3, depth_m: 1, circularity: 0.931, foo: 3 })).toEqual([
      ['Tiefe', '1,00 m'],
      ['Fläche', '28 m²'],
      ['Rundheit', '0,93'],
    ]);
  });
});

describe('filtering and navigation', () => {
  const list = [
    cand({ id: 'a', cls: 'pit', score: 0.9 }),
    cand({ id: 'b', cls: 'linear', score: 0.8, nearPath: true, alongPath: true }),
    cand({ id: 'c', cls: 'mound', score: 0.6 }),
    cand({ id: 'd', cls: 'pit', score: 0.4 }),
    cand({ id: 'e', cls: 'rect', score: 0.2 }),
  ];

  it('filters by class, known paths, min score and decisions', () => {
    const f = defaultFilter(0.3);
    expect(filterCandidates(list, f).map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(filterCandidates(list, { ...f, minScore: 0 }).map((c) => c.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(filterCandidates(list, { ...f, knownPaths: false }).map((c) => c.id)).toEqual(['a', 'c', 'd']);
    // a linear that only crosses/touches a way (near_path, not along_path) stays a ditch candidate
    const crossing = cand({ id: 'f', cls: 'linear', score: 0.5, nearPath: true });
    expect(filterCandidates([crossing], { ...f, knownPaths: false })).toHaveLength(1);
    expect(countByClass([crossing]).known).toBe(0);
    expect(filterCandidates(list, { ...f, classes: { ...f.classes, pit: false } }).map((c) => c.id)).toEqual(['b', 'c']);
    const st = (id: string) => (id === 'a' ? 'rejected' : id === 'c' ? 'unsure' : undefined);
    expect(filterCandidates(list, f, st).map((c) => c.id)).toEqual(['b', 'c', 'd']); // rejected hidden by default
    expect(filterCandidates(list, { ...f, showRejected: true }, st).map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(filterCandidates(list, { ...f, onlyOpen: true, showRejected: true }, st).map((c) => c.id)).toEqual(['b', 'd']);
    // Score at the threshold passes (no float surprises from the 0.05 slider steps).
    expect(filterCandidates([cand({ id: 'x', score: 0.3 })], { ...f, minScore: 0.1 + 0.2 })).toHaveLength(1);
  });

  it('counts per class including known paths', () => {
    expect(countByClass(list)).toEqual({ pit: 2, mound: 1, linear: 1, rect: 1, platform: 0, crater: 0, crater_field: 0, known: 1 });
  });

  it('steps forward/backward with wrap-around', () => {
    const order = filterCandidates(list, defaultFilter(0));
    expect(stepCandidate(order, null, 1)).toBe('a');
    expect(stepCandidate(order, null, -1)).toBe('e');
    expect(stepCandidate(order, 'a', 1)).toBe('b');
    expect(stepCandidate(order, 'e', 1)).toBe('a');
    expect(stepCandidate(order, 'a', -1)).toBe('e');
    expect(stepCandidate([], 'a', 1)).toBeNull();
  });

  it('continues from a current candidate that was just filtered out (e.g. rejected)', () => {
    const order = filterCandidates(list, defaultFilter(0)).filter((c) => c.id !== 'c');
    const c = list.find((x) => x.id === 'c')!;
    expect(stepCandidate(order, 'c', 1, c)).toBe('d');
    expect(stepCandidate(order, 'c', -1, c)).toBe('b');
    const last = list.find((x) => x.id === 'e')!;
    expect(stepCandidate(order.slice(0, -1), 'e', 1, last)).toBe('a'); // wraps
  });

  it('sorts ties deterministically by id', () => {
    const t = [cand({ id: 'z', score: 0.5 }), cand({ id: 'm', score: 0.5 }), cand({ id: 'q', score: 0.7 })].sort(byScore);
    expect(t.map((c) => c.id)).toEqual(['q', 'm', 'z']);
  });

  it('sanitizes stored filters', () => {
    const f = sanitizeFilter({ classes: { pit: false, castle: true }, minScore: 7, showRejected: 'yes', onlyOpen: true });
    expect(f.classes.pit).toBe(false);
    expect(f.classes.mound).toBe(true);
    expect(f.minScore).toBe(1);
    expect(f.showRejected).toBe(false);
    expect(f.onlyOpen).toBe(true);
    expect(sanitizeFilter(null, defaultFilter(0.45)).minScore).toBe(0.45);
  });
});

describe('outline geometry', () => {
  it('draws a closed circle of diameter_m (≤ 2 m segments) without an outline', () => {
    const c = cand({ id: 'm', cls: 'mound', E: 100, N: 200, metrics: { diameter_m: 20 } });
    const pts = outlinePositions(c);
    expect(pts[0][0]).toBeCloseTo(pts[pts.length - 1][0], 9);
    expect(pts[0][1]).toBeCloseTo(pts[pts.length - 1][1], 9);
    for (const p of pts) expect(Math.hypot(p[0] - 100, p[1] - 200)).toBeCloseTo(10, 9);
    for (let k = 1; k < pts.length; k++) expect(Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])).toBeLessThanOrEqual(2);
    expect(pts.every((p) => Number.isNaN(p[2]))).toBe(true);
  });

  it('falls back to a 5 m circle', () => {
    const pts = outlinePositions(cand({ id: 'x', E: 0, N: 0 }));
    expect(Math.hypot(pts[3][0], pts[3][1])).toBeCloseTo(2.5, 9);
    expect(pts.length).toBeGreaterThanOrEqual(13);
  });

  it('densifies outlines with baked z and closes polygon rings', () => {
    const c = cand({ id: 'r', cls: 'rect', outline: { type: 'Polygon', coords: [[0, 0, 10], [10, 0, 20], [10, 4, 20]] } });
    const pts = outlinePositions(c);
    expect(pts[pts.length - 1]).toEqual([0, 0, 10]);
    const mid = pts.find((p) => p[0] === 2 && p[1] === 0)!;
    expect(mid[2]).toBeCloseTo(12, 9);
    for (let k = 1; k < pts.length; k++) expect(Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])).toBeLessThanOrEqual(2 + 1e-9);
    const l = outlinePositions(cand({ id: 'l', cls: 'linear', outline: { type: 'LineString', coords: [[0, 0], [3, 0]] } }));
    expect(l).toHaveLength(3);
    expect(l[2][0]).toBe(3);
    expect(Number.isNaN(l[1][2])).toBe(true);
  });

  it('estimates a radius from diameter, length or area', () => {
    expect(candidateRadius(cand({ id: 'a', metrics: { diameter_m: 8 } }))).toBe(4);
    expect(candidateRadius(cand({ id: 'b', metrics: { length_m: 100 } }))).toBe(50);
    expect(candidateRadius(cand({ id: 'c', metrics: { area_m2: Math.PI * 9 } }))).toBeCloseTo(3, 9);
    expect(candidateRadius(cand({ id: 'd' }))).toBe(2.5);
  });
});

describe('review store', () => {
  const now = new Date('2026-11-01T12:00:00Z');

  it('round-trips through storage under sle.candidates.v1.<aoi>', () => {
    const kv = memKV();
    const s = emptyReviewStore();
    s.decisions['pit-1'] = decisionFor(cand({ id: 'pit-1', E: 1.234, N: 5.678, score: 0.7 }), 'confirmed', now, 'm-1');
    expect(saveReviews(kv, 'karlsberg', s)).toBe(true);
    expect(Object.keys(kv.data)).toEqual(['sle.candidates.v1.karlsberg']);
    const back = loadReviews(kv, 'karlsberg');
    expect(back).toEqual({ version: 1, decisions: { 'pit-1': { status: 'confirmed', at: now.toISOString(), class: 'pit', E: 1.23, N: 5.68, score: 0.7, markerId: 'm-1' } } });
    expect(loadReviews(kv, 'other')).toEqual(emptyReviewStore());
  });

  it('drops invalid decisions and survives garbage', () => {
    const kv = memKV({
      'sle.candidates.v1.a': JSON.stringify({
        version: 1,
        decisions: {
          ok: { status: 'rejected', at: 'nope', class: 'mound', E: 1, N: 2, score: 0.1 },
          bad1: { status: 'maybe', class: 'pit', E: 1, N: 2 },
          bad2: { status: 'unsure', class: 'pit', E: null, N: 2 },
          bad3: { status: 'unsure', class: 'castle', E: 1, N: 2 },
        },
      }),
      'sle.candidates.v1.b': '{not json',
      'sle.candidates.v1.c': JSON.stringify({ version: 2, decisions: { x: {} } }),
    });
    const a = loadReviews(kv, 'a');
    expect(Object.keys(a.decisions)).toEqual(['ok']);
    expect(a.decisions.ok.at).toBe(new Date(0).toISOString());
    expect(loadReviews(kv, 'b')).toEqual(emptyReviewStore());
    expect(loadReviews(kv, 'c')).toEqual(emptyReviewStore());
    expect(loadReviews(null, 'a')).toEqual(emptyReviewStore());
    expect(saveReviews(null, 'a', a)).toBe(false);
  });

  it('re-attaches orphaned decisions to the nearest same-class candidate within 3 m', () => {
    const s = emptyReviewStore();
    s.decisions['pit-old'] = { status: 'confirmed', at: now.toISOString(), class: 'pit', E: 100, N: 100, score: 0.5, markerId: 'm-9' };
    s.decisions['mound-old'] = { status: 'rejected', at: now.toISOString(), class: 'mound', E: 200, N: 200, score: 0.5 };
    s.decisions['pit-gone'] = { status: 'unsure', at: now.toISOString(), class: 'pit', E: 500, N: 500, score: 0.5 };
    s.decisions['kept'] = { status: 'unsure', at: now.toISOString(), class: 'rect', E: 0, N: 0, score: 0.5 };
    const cands = [
      cand({ id: 'kept', cls: 'rect', E: 0, N: 0 }),
      cand({ id: 'pit-far', cls: 'pit', E: 102.5, N: 100 }),
      cand({ id: 'pit-near', cls: 'pit', E: 101, N: 100.5, score: 0.66 }),
      cand({ id: 'pit-at-mound', cls: 'pit', E: 200, N: 200 }), // wrong class for mound-old
      cand({ id: 'pit-out', cls: 'pit', E: 503.1, N: 500 }), // > 3 m from pit-gone
    ];
    const r = reattachDecisions(s, cands);
    expect(r.moved).toBe(1);
    expect(Object.keys(r.store.decisions).sort()).toEqual(['kept', 'mound-old', 'pit-gone', 'pit-near']);
    expect(r.store.decisions['pit-near']).toMatchObject({ status: 'confirmed', markerId: 'm-9', E: 101, N: 100.5, score: 0.66 });
    expect(s.decisions['pit-old']).toBeDefined(); // input untouched
  });

  it('does not re-attach onto a candidate that already has a decision', () => {
    const s = emptyReviewStore();
    s.decisions.old = { status: 'rejected', at: now.toISOString(), class: 'pit', E: 0, N: 0, score: 0.1 };
    s.decisions.taken = { status: 'confirmed', at: now.toISOString(), class: 'pit', E: 1, N: 0, score: 0.9 };
    const r = reattachDecisions(s, [cand({ id: 'taken', E: 1, N: 0 })]);
    expect(r.moved).toBe(0);
    expect(r.store.decisions.taken.status).toBe('confirmed');
  });

  it('exports decisions with counts, detector and the privacy note', () => {
    const s = emptyReviewStore();
    s.decisions.a = decisionFor(cand({ id: 'a' }), 'confirmed', now);
    s.decisions.b = decisionFor(cand({ id: 'b' }), 'rejected', now);
    s.decisions.c = decisionFor(cand({ id: 'c' }), 'rejected', now);
    const e = exportDecisions(s, 'fixture', { method: 'lrm-rules', version: 1 }, now);
    expect(e).toMatchObject({ type: 'sle-candidate-decisions', aoi: 'fixture', exported: now.toISOString(), version: 1, counts: { confirmed: 1, rejected: 2, unsure: 0 } });
    expect(e.note).toContain('Schauen, nicht graben');
    expect(Object.keys(e.decisions)).toEqual(['a', 'b', 'c']);
    expect(e.decisions.a.markerId).toBeUndefined();
  });
});
