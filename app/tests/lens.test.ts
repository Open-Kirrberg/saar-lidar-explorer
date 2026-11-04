import { describe, expect, it, vi } from 'vitest';
import type { Candidate } from '../src/candidates/candidateData';
import { markerTextFor } from '../src/candidates/candidateData';
import { GLOW_MIN_SCORE, GLOW_R_MAX, GLOW_R_MIN, glowBound, glowCentre, glowPool, glowStrength, packGlow, pickGlow, selectGlow } from '../src/lens/glow';
import { LENS_DURATION_S, LENS_OFF, advanceLens, ease, lensMix, lensPhase, setLensOn, toggleLens } from '../src/lens/lensState';
import type { LensState } from '../src/lens/lensState';
import { gameLookActive, gameLookKey } from '../src/lens/look';
import { cardText, existingLensMarker, hypothesisTitle, merkenMarker, userNoteOf, withNote } from '../src/lens/merken';
import { clearOf } from '../src/lens/layout';
import { createLensTargets } from '../src/lens/targets';
import { LENS_VARIANTS, pickVariant, resolveVariants } from '../src/lens/variants';
import { loadMarkers, saveMarkers } from '../src/markers/markerStore';

const cand = (p: Partial<Candidate> & { id: string }): Candidate => ({
  cls: 'pit',
  score: 0.7,
  E: 382500,
  N: 5465600,
  z: 360.5,
  metrics: { diameter_m: 8, depth_m: 1.2 },
  reasons: [],
  forest: true,
  nearPath: false,
  alongPath: false,
  nearKnown: null,
  ...p,
});

/** Run the state machine for `seconds` in 60 Hz steps. */
const run = (s: LensState, seconds: number): LensState => {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) s = advanceLens(s, 1 / 60);
  return s;
};

describe('lens state machine', () => {
  it('off → on takes ~0.5 s, then settles (same object)', () => {
    let s = setLensOn(LENS_OFF, true);
    expect(lensPhase(s)).toBe('entering');
    s = run(s, LENS_DURATION_S * 0.5);
    expect(s.p).toBeGreaterThan(0.45);
    expect(s.p).toBeLessThan(0.55);
    s = run(s, LENS_DURATION_S * 0.6);
    expect(s.p).toBe(1);
    expect(lensPhase(s)).toBe('on');
    expect(advanceLens(s, 1 / 60)).toBe(s);
  });

  it('toggling mid-way reverses from the current progress', () => {
    const half = run(setLensOn(LENS_OFF, true), 0.25);
    const back = toggleLens(half);
    expect(back.on).toBe(false);
    expect(back.p).toBe(half.p);
    expect(lensPhase(back)).toBe('leaving');
    expect(run(back, 0.3).p).toBe(0);
    expect(lensPhase(run(back, 0.3))).toBe('off');
  });

  it('duration 0 jumps; bad dt is ignored; setLensOn is idempotent', () => {
    expect(advanceLens(setLensOn(LENS_OFF, true), 0.001, 0).p).toBe(1);
    expect(advanceLens(setLensOn(LENS_OFF, true), Number.NaN).p).toBe(0);
    expect(advanceLens(setLensOn(LENS_OFF, true), -1).p).toBe(0);
    expect(setLensOn(LENS_OFF, false)).toBe(LENS_OFF);
  });
});

describe('lens blend curve', () => {
  it('ease is a clamped smoothstep', () => {
    expect(ease(-1)).toBe(0);
    expect(ease(0)).toBe(0);
    expect(ease(0.5)).toBe(0.5);
    expect(ease(1)).toBe(1);
    expect(ease(2)).toBe(1);
    expect(ease(0.1)).toBeLessThan(0.1); // slow start
  });

  it('channels are 0 when off, 1 when on, and monotonic', () => {
    expect(lensMix(0)).toEqual({ trees: 0, relief: 0, glow: 0 });
    expect(lensMix(1)).toEqual({ trees: 1, relief: 1, glow: 1 });
    let prev = lensMix(0);
    for (let p = 0.05; p <= 1.0001; p += 0.05) {
      const m = lensMix(p);
      expect(m.trees).toBeGreaterThanOrEqual(prev.trees);
      expect(m.relief).toBeGreaterThanOrEqual(prev.relief);
      expect(m.glow).toBeGreaterThanOrEqual(prev.glow);
      prev = m;
    }
  });

  it('staggered: trees go first, relief next, glow last (reverse when leaving)', () => {
    const early = lensMix(0.3);
    expect(early.trees).toBeGreaterThan(early.relief);
    expect(early.glow).toBe(0);
    const late = lensMix(0.8);
    expect(late.trees).toBe(1);
    expect(late.relief).toBeGreaterThan(late.glow);
    expect(late.glow).toBeGreaterThan(0);
  });
});

describe('lens variants', () => {
  it('Standard always gets the relief variant; Entdecker may pick others', () => {
    const all = resolveVariants(() => true);
    expect(all.map((v) => v.id)).toEqual(['relief', 'lrm', 'slope', 'hist_1840', 'hist_1935']);
    expect(pickVariant(all, 'lrm', false)?.id).toBe('relief');
    expect(pickVariant(all, 'lrm', true)?.id).toBe('lrm');
    expect(pickVariant(all, 'hist_1935', true)?.key).toBe('hist_1935');
    expect(pickVariant(all, 'nonsense', true)?.id).toBe('relief');
  });

  it('falls back to live keys and drops variants without data (no Zeitreise without maps)', () => {
    const live = resolveVariants((k) => k.startsWith('live-'));
    expect(live.map((v) => [v.id, v.key])).toEqual([
      ['relief', 'live-hillshade'],
      ['lrm', 'live-lrm'],
      ['slope', 'live-slope'],
    ]);
    expect(resolveVariants((k) => k === 'vat')[0].key).toBe('vat');
    expect(pickVariant([], 'relief', true)).toBeNull();
  });

  it('every variant blends below 1 so a hint of the aerial ground remains', () => {
    for (const v of LENS_VARIANTS) {
      expect(v.strength).toBeGreaterThan(0.5);
      expect(v.strength).toBeLessThan(1);
    }
  });
});

describe('candidate glow selection', () => {
  const pool = [
    cand({ id: 'a', E: 382500, N: 5465600 }),
    cand({ id: 'weak', score: GLOW_MIN_SCORE - 0.01 }),
    cand({ id: 'path', cls: 'linear', alongPath: true }),
    cand({ id: 'ditch', cls: 'linear', alongPath: false, E: 382520 }),
    cand({ id: 'rej', E: 382510 }),
    cand({ id: 'odd', cls: 'unlisted' as Candidate['cls'] }),
    cand({ id: 'nan', E: Number.NaN }),
  ];

  it('only allow-listed, unrejected, strong, non-path candidates may glow', () => {
    const ids = glowPool(pool, { statusOf: (id) => (id === 'rej' ? 'rejected' : undefined) }).map((c) => c.id);
    expect(ids).toEqual(['a', 'ditch']);
    expect(glowPool(pool, { minScore: 0 }).map((c) => c.id)).toContain('weak');
  });

  it('centre lies ahead of the camera along the heading', () => {
    const north = glowCentre(0, 0, 0, -45, 100);
    expect(north.E).toBeCloseTo(0, 6);
    expect(north.N).toBeCloseTo(100, 6);
    const east = glowCentre(0, 0, 90, -45, 100);
    expect(east.E).toBeCloseTo(100, 6);
    expect(glowCentre(0, 0, 0, 0, 100).N).toBe(350); // level view: capped
    expect(glowCentre(0, 0, 0, -5, 500, 200).N).toBe(200);
  });

  it('selects the nearest up to max within the radius', () => {
    const many = Array.from({ length: 40 }, (_, i) => cand({ id: `c${i}`, E: i * 20, N: 0 }));
    const sel = selectGlow(many, { E: 0, N: 0 }, 5, 1000);
    expect(sel.map((c) => c.id)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4']);
    expect(selectGlow(many, { E: 0, N: 0 }, 99, 50).length).toBe(3);
    expect(selectGlow(many, { E: 0, N: 0 }, 0)).toEqual([]);
  });

  it('packs world xz (x = E − E0, z = −(N − N0)), clamped radius, brighter selection', () => {
    const c = cand({ id: 'p', E: 1100, N: 2300, metrics: { diameter_m: 500 } });
    const [g] = packGlow([c], { E0: 1000, N0: 2000 });
    expect(g[0]).toBe(100);
    expect(g[1]).toBe(-300);
    expect(g[2]).toBe(GLOW_R_MAX);
    const tiny = packGlow([cand({ id: 't', metrics: { diameter_m: 1 } })], { E0: 0, N0: 0 })[0];
    expect(tiny[2]).toBe(GLOW_R_MIN);
    const sel = packGlow([c], { E0: 1000, N0: 2000 }, 'p')[0];
    expect(sel[3]).toBeCloseTo(g[3] * 1.8, 6);
    expect(glowStrength({ score: GLOW_MIN_SCORE })).toBeCloseTo(0.55, 6);
    expect(glowStrength({ score: 1 })).toBeCloseTo(1, 6);
  });

  it('picks the glow under a ground point, nearest first', () => {
    const a = cand({ id: 'a', E: 0, N: 0, metrics: { diameter_m: 10 } });
    const b = cand({ id: 'b', E: 12, N: 0, metrics: { diameter_m: 10 } });
    expect(pickGlow([a, b], 1, 0)?.id).toBe('a');
    expect(pickGlow([a, b], 11, 0)?.id).toBe('b');
    expect(pickGlow([a, b], 0, 30)).toBeNull();
    expect(pickGlow([a], 0, 30, 30)?.id).toBe('a'); // generous slack when far away
  });
});

describe('Merken → private marker', () => {
  const c = cand({ id: 'pit-7', score: 0.62, nearKnown: 'Schloss Karlsberg' });

  it('card speaks in hypotheses and carries the heritage line', () => {
    const t = cardText(c);
    expect(t.title).toBe('Mögliche Grube?');
    expect(t.lead).toContain('Hypothese, kein Fund');
    expect(t.caution).toContain('Schauen, nicht graben');
    expect(t.facts).toContainEqual(['Score der Analyse', '0,62']);
    expect(t.facts).toContainEqual(['Nahe', 'Schloss Karlsberg']);
    for (const cls of ['pit', 'mound', 'linear', 'rect', 'platform'] as const) expect(hypothesisTitle({ cls })).toMatch(/^Möglich/);
  });

  it('maps to a marker with category, position, height and the user note', () => {
    const now = new Date('2026-11-04T10:00:00Z');
    const m = merkenMarker(c, '  unter Buchen gesehen ', now, 'm1');
    expect(m).toMatchObject({ id: 'm1', title: 'Mögliche Grube (Relikt-Blick)', category: 'Grube/Trichter', E: c.E, N: c.N, h: 360.5, created: now.toISOString() });
    expect(m.note.split('\n')).toEqual([
      'Relikt-Blick pit-7 – Mögliche Grube, Score 0,62.',
      'unter Buchen gesehen',
      'Hypothese aus automatischer Reliefanalyse – Schauen, nicht graben.',
    ]);
    expect(userNoteOf(m)).toBe('unter Buchen gesehen');
    expect(merkenMarker(cand({ id: 'x', z: Number.NaN }), '').h).toBeNull();
    expect(merkenMarker(cand({ id: 'l', cls: 'linear' }), '').category).toBe('Graben');
  });

  it('survives a reload through the marker store (sle.markers.v1)', () => {
    const mem = new Map<string, string>();
    const kv = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const m = merkenMarker(c, 'Notiz', new Date('2026-11-04T10:00:00Z'), 'm2');
    expect(saveMarkers(kv, [m])).toBe(true);
    expect(loadMarkers(kv)).toEqual([m]);
  });

  it('finds an existing marker (own or from the F15 review) and edits only the note', () => {
    const own = merkenMarker(c, 'alt', new Date(), 'own');
    expect(existingLensMarker('pit-7', [own])?.id).toBe('own');
    const edited = withNote(own, c, 'neu');
    expect(edited.id).toBe('own');
    expect(edited.created).toBe(own.created);
    expect(userNoteOf(edited)).toBe('neu');
    const confirmed = { id: 'rev', note: markerTextFor(c, 'Grube').note };
    expect(existingLensMarker('pit-7', [confirmed])?.id).toBe('rev');
    expect(existingLensMarker('other', [own, confirmed])).toBeUndefined();
    expect(userNoteOf({ note: 'frei geschrieben' })).toBe('');
  });
});

describe('lens targets (trees, canopy, props)', () => {
  it('pushes the fade on change, to late arrivals on sync, and resets on unregister', () => {
    const a = { setLensFade: vi.fn() };
    let extra: Array<{ setLensFade: (f: number) => void }> = [];
    const t = createLensTargets(() => extra);
    const off = t.register(a);
    expect(a.setLensFade).toHaveBeenLastCalledWith(0);
    t.apply(0.4);
    t.apply(0.4);
    expect(a.setLensFade).toHaveBeenCalledTimes(2);
    const trees = { setLensFade: vi.fn() };
    extra = [trees];
    t.sync();
    expect(trees.setLensFade).toHaveBeenLastCalledWith(0.4);
    t.sync();
    expect(trees.setLensFade).toHaveBeenCalledTimes(1);
    t.apply(2);
    expect(trees.setLensFade).toHaveBeenLastCalledWith(1);
    off();
    expect(a.setLensFade).toHaveBeenLastCalledWith(0);
    expect(t.current()).toBe(1);
  });

  it('a throwing target does not stop the others', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = { setLensFade: () => { throw new Error('x'); } };
    const good = { setLensFade: vi.fn() };
    const t = createLensTargets();
    t.register(bad);
    t.register(good);
    t.apply(1);
    expect(good.setLensFade).toHaveBeenLastCalledWith(1);
    warn.mockRestore();
  });
});

describe('game look', () => {
  it('aerial ground when the AOI has it, Labor keeps the relief lab', () => {
    expect(gameLookKey((k) => k === 'ortho')).toBe('ortho');
    expect(gameLookKey(() => false)).toBeNull();
    expect(gameLookActive('standard')).toBe(true);
    expect(gameLookActive('entdecker')).toBe(true);
    expect(gameLookActive('labor')).toBe(false);
  });
});

describe('glow bounding circle (shader early-out)', () => {
  it('is empty without rings', () => {
    expect(glowBound([])[2]).toBeLessThan(0);
  });
  it('contains every ring centre plus 3 × its radius', () => {
    const packed: Array<[number, number, number, number]> = [
      [10, -20, 5, 1],
      [-140, 60, 30, 0.6],
      [220, 310, 3, 1.8],
      [0, 0, 12, 0.9],
    ];
    const [cx, cz, R] = glowBound(packed);
    for (const [x, z, r] of packed) {
      expect(Math.hypot(x - cx, z - cz) + 3 * r).toBeLessThanOrEqual(R + 1e-9);
      // the shader's per-fragment reach is 3·max(r, 8 px) + 24 px ≤ 3·r + 48 px: probe points at that reach stay inside R + 48 px
      for (const px of [0.05, 1, 4]) {
        const reach = 3 * Math.max(r, 8 * px) + 24 * px;
        for (let a = 0; a < 8; a++) {
          const qx = x + reach * Math.cos((a * Math.PI) / 4);
          const qz = z + reach * Math.sin((a * Math.PI) / 4);
          expect(Math.hypot(qx - cx, qz - cz)).toBeLessThanOrEqual(R + 48 * px + 1e-9);
        }
      }
    }
  });
  it('is tight for a single ring', () => {
    expect(glowBound([[5, 7, 10, 1]])).toEqual([5, 7, 30]);
  });
});

describe('card layout: clear of the splash + sources corner', () => {
  // 390 × 844 phone: card from the gap to the gap, ending at 709; splash 590–700 right, „© Quellen“ 713–755
  const card = { left: 10, right: 380, top: 230, bottom: 709 };
  it('lifts the card above an overlapping splash and caps its height', () => {
    const r = clearOf(card, { left: 10, right: 380, top: 590, bottom: 755 }, 844);
    expect(r).toEqual({ bottom: 844 - 590 + 8, maxHeight: 590 - 8 - 8 });
  });
  it('leaves the card alone when only the button is left (no overlap)', () => {
    expect(clearOf(card, { left: 270, right: 380, top: 713, bottom: 755 }, 844)).toBeNull();
  });
  it('ignores a corner beside the card (wide desktop)', () => {
    expect(clearOf({ left: 530, right: 910, top: 500, bottom: 820 }, { left: 964, right: 1424, top: 700, bottom: 884 }, 900)).toBeNull();
  });
  it('keeps a usable minimum height', () => {
    expect(clearOf(card, { left: 0, right: 390, top: 60, bottom: 755 }, 844)?.maxHeight).toBe(120);
  });
});
