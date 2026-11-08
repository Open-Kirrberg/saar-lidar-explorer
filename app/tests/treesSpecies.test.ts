import { describe, expect, it, vi } from 'vitest';
import {
  treeGroup,
  SPECIES_PROB_DEFAULTS,
  ageGroup,
  contradicts,
  parseSpecies,
  probabilityPct,
  roundHalfEven,
  speciesAt,
  speciesPixel,
  speciesWording,
  treeAge,
} from '../src/trees/treeSpecies';
import type { ManifestSpecies } from '../src/trees/treeSpecies';

// The manifest `species` key as the pipeline writes it for `overall` (classes / F1 from Wegler et al. 2025).
const CLASSES = [
  [0, 'pine', 'Kiefer', 'conifer', 0.98],
  [1, 'spruce', 'Fichte', 'conifer', 0.94],
  [2, 'douglas_fir', 'Douglasie', 'conifer', 0.91],
  [3, 'larch', 'Lärche', 'conifer', 0.96],
  [4, 'fir', 'Tanne', 'conifer', 0.88],
  [5, 'beech', 'Buche', 'broadleaf', 0.95],
  [6, 'oak', 'Eiche', 'broadleaf', 0.76],
  [7, 'birch', 'Birke', 'broadleaf', 0.9],
  [8, 'alder', 'Erle', 'broadleaf', 0.89],
  [9, 'other_broadleaf', 'andere Laubbäume', 'broadleaf', 0.76],
] as const;
const RAW = {
  format: 'sle-species-v1',
  path: 'species/species.png',
  encoding: 'u8-class',
  cellSize: 10,
  size: { width: 600, height: 800 },
  nodata: 255,
  year: 2022,
  classes: [
    ...CLASSES.map(([code, key, label_de, group, f1]) => ({ code, key, label_de, group, species: true, f1 })),
    { code: 10, key: 'canopy_loss', label_de: 'Kronendachverlust (keine Art)', group: 'none', species: false },
  ],
  probability: { method: 'species-dlr-neighbourhood-v1', contradictionDivisor: 2, minPct: 10, maxPct: 90, likelyPct: 50, contradiction: 'type-conifer-in-broadleaf-class' },
  accuracy: { overallF1: 0.89, note_de: 'Genauigkeit für Reinbestände' },
  label_de: 'Baumart (Schätzung, 10-m-Raster)',
  attribution: 'Baumarten: DLR, Tree Species Germany 2022 (Wegler et al. 2025), CC BY 4.0',
};
const SP = parseSpecies(RAW)!;
const AOI = { E0: 378000, N0: 5460000, heightM: 8000 };

describe('parseSpecies (contract „Tree species“ app tolerance)', () => {
  it('parses the pipeline key', () => {
    expect(SP.format).toBe('sle-species-v1');
    expect(SP.classes.size).toBe(11);
    expect(SP.classes.get(5)).toMatchObject({ key: 'beech', label_de: 'Buche', group: 'broadleaf', species: true, f1: 0.95 });
    expect(SP.classes.get(10)).toMatchObject({ species: false, f1: null, group: 'none' });
    expect(SP.probability).toEqual(SPECIES_PROB_DEFAULTS);
    expect(SP.year).toBe(2022);
    expect(SP.accuracyNote).toBe('Genauigkeit für Reinbestände');
  });

  it('rejects bad keys and skips bad classes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseSpecies(undefined)).toBeUndefined();
    expect(parseSpecies('x')).toBeUndefined();
    expect(parseSpecies({ ...RAW, format: 'sle-species-v2' })).toBeUndefined();
    expect(parseSpecies({ ...RAW, path: 3 })).toBeUndefined();
    expect(parseSpecies({ ...RAW, cellSize: 0 })).toBeUndefined();
    expect(parseSpecies({ ...RAW, size: { width: 600 } })).toBeUndefined();
    expect(parseSpecies({ ...RAW, classes: {} })).toBeUndefined();
    const p = parseSpecies({ ...RAW, probability: undefined, classes: [{ code: 'x' }, { code: 1, species: true }, { code: 2, species: true, f1: 1.4 }, { code: 3, species: true, f1: 0.5, key: 'larch', group: 'conifer' }] })!;
    expect([...p.classes.keys()]).toEqual([3]);
    expect(p.probability).toEqual(SPECIES_PROB_DEFAULTS);
    warn.mockRestore();
  });
});

describe('probabilityPct (species-dlr-neighbourhood-v1, contract test vectors)', () => {
  const vectors: Array<[k: number, n: number, f: number, x: boolean, pct: number]> = [
    [9, 9, 95, false, 90],
    [6, 9, 95, false, 60],
    [1, 2, 90, false, 50],
    [3, 4, 76, false, 60],
    [9, 9, 76, true, 40],
    [1, 9, 76, true, 10],
  ];
  for (const [k, n, f, x, pct] of vectors) {
    it(`k=${k} n=${n} f=${f} x=${x} → ${pct}`, () => expect(probabilityPct(k, n, f, x)).toBe(pct));
  }
  it('refuses k or n below 1', () => {
    expect(() => probabilityPct(0, 9, 95, false)).toThrow();
    expect(() => probabilityPct(1, 0, 95, false)).toThrow();
  });
  it('the contradiction is one-sided: only a conifer-coloured crown in a broadleaf class', () => {
    expect(contradicts({ group: 'broadleaf' }, 1)).toBe(true);
    expect(contradicts({ group: 'broadleaf' }, 1 | 0x80)).toBe(true); // fill trees included
    expect(contradicts({ group: 'conifer' }, 2)).toBe(false);
    expect(contradicts({ group: 'broadleaf' }, 2)).toBe(false);
    expect(contradicts({ group: 'broadleaf' }, 0)).toBe(false);
  });
  it('wording', () => {
    expect(speciesWording('Buche', 70, true)).toBe('wahrscheinlich Buche (70 %)');
    expect(speciesWording('Eiche', 30, false)).toBe('Eiche? unsicher (30 %)');
  });
});

/**
 * Three points on the real `overall` grid, computed with the pipeline code (2026-11-08):
 *   cd pipeline && uv run python -I <scratchpad>/ref_vectors.py   (species.tree_species, species.neighbourhood,
 *   species.certainty, forest_age.tree_age with the DLR group)
 * The 3 × 3 patch around each point is copied from app/public/data/overall/species/species.png; the rest of
 * the grid is no data, which does not change the result (only the 3 × 3 block counts, 255 counts as inside).
 */
const PY = [
  { E: 382526.0, N: 5460401.8, type: 2, px: 452, py: 759, patch: [[255, 255, 255], [5, 5, 5], [5, 6, 5]], code: 5, k: 5, n: 9, pct: 50, contra: false, likely: true, h: 27.4, group: 'beech', age: { lo: 75, mid: 90, hi: 120, open_hi: false, class: 'old', label_de: 'etwa 75–120 Jahre' } },
  { E: 382497.2, N: 5464537.2, type: 0, px: 449, py: 346, patch: [[2, 0, 8], [0, 2, 2], [2, 2, 2]], code: 2, k: 6, n: 9, pct: 60, contra: false, likely: true, h: 38.2, group: 'douglas', age: { lo: 75, mid: 95, hi: 100, open_hi: true, class: 'old', label_de: 'etwa 75–100+ Jahre' } },
  { E: 382143.4, N: 5462122.0, type: 1, px: 414, py: 587, patch: [[6, 6, 6], [6, 6, 6], [6, 9, 9]], code: 6, k: 7, n: 9, pct: 30, contra: true, likely: false, h: 21.0, group: 'oak', age: { lo: 60, mid: 80, hi: 100, open_hi: false, class: 'old', label_de: 'etwa 60–100 Jahre' } },
];

function gridWith(patches: Array<{ px: number; py: number; patch: number[][] }>, w = 600, h = 800): Uint8Array {
  const v = new Uint8Array(w * h).fill(255);
  for (const { px, py, patch } of patches) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) v[(py + dy) * w + px + dx] = patch[dy + 1][dx + 1];
  }
  return v;
}

describe('speciesAt matches pipeline/species.py on the overall grid', () => {
  const values = gridWith(PY);
  for (const p of PY) {
    it(`E ${p.E} N ${p.N} type ${p.type}`, () => {
      expect(speciesPixel(SP, AOI, p.E, p.N)).toEqual({ px: p.px, py: p.py });
      const s = speciesAt(SP, values, AOI, p.E, p.N, p.type)!;
      expect(s).not.toBeNull();
      expect({ code: s.code, k: s.k, n: s.n, pct: s.pct, contra: s.contra, likely: s.likely }).toEqual({ code: p.code, k: p.k, n: p.n, pct: p.pct, contra: p.contra, likely: p.likely });
      expect(ageGroup(s.key, p.type)).toBe(p.group);
      expect(treeAge(p.h, ageGroup(s.key, p.type))).toMatchObject(p.age);
    });
  }

  it('no species outside the grid, on no data and on canopy loss', () => {
    const v = gridWith([{ px: 1, py: 1, patch: [[10, 10, 10], [10, 10, 10], [10, 10, 10]] }]);
    expect(speciesAt(SP, v, AOI, AOI.E0 - 1, 5464000, 2)).toBeNull();
    expect(speciesAt(SP, v, AOI, 380000, 5464000, 2)).toBeNull(); // 255
    expect(speciesAt(SP, v, AOI, AOI.E0 + 15, AOI.N0 + AOI.heightM - 15, 2)).toBeNull(); // 10 = canopy loss
  });

  it('counts only cells inside the raster at edges and corners (n = 6 / 4)', () => {
    const w = 600;
    const v = new Uint8Array(w * 800).fill(5);
    const corner = speciesAt(SP, v, AOI, AOI.E0 + 5, AOI.N0 + AOI.heightM - 5, 2)!; // px 0, py 0
    expect([corner.k, corner.n, corner.pct]).toEqual([4, 4, 90]);
    const edge = speciesAt(SP, v, AOI, AOI.E0 + 55, AOI.N0 + AOI.heightM - 5, 2)!; // px 5, py 0
    expect([edge.k, edge.n]).toEqual([6, 6]);
  });
});

describe('treeAge (tree-age-height-v2, twin of pipeline/forest_age.py tree_age)', () => {
  // uv run python -c "from forest_age import tree_age; …" (2026-11-08, v2: no age beyond the class-II table end)
  const B = { lo: null, mid: null, hi: null, open_hi: true, beyond: true, class: 'beyond', label_de: 'nicht schätzbar: höher als die Ertragstafel' };
  const cases: Array<[h: number, group: string, age: null | Record<string, unknown>]> = [
    [22.0, 'beech', { lo: 55, mid: 65, hi: 85, open_hi: false, beyond: false, class: 'middle', label_de: 'etwa 55–85 Jahre' }],
    [60.9, 'douglas', B],
    [8.0, 'unknown', { lo: 15, mid: 20, hi: 30, open_hi: false, beyond: false, class: 'young', label_de: 'etwa 15–30 Jahre' }],
    [7.9, 'beech', null],
    [45.0, 'conifer', B],
    [33.3, 'oak', B],
    [40.7, 'oak', B], // the Beeden-Schwarzenbach Riese: v1 said „über 200 Jahre“
    [32.5, 'oak', { lo: 145, mid: 200, hi: 200, open_hi: true, beyond: false, class: 'very_old', label_de: 'etwa 145–200+ Jahre' }],
    [30.0, 'broadleaf', { lo: 85, mid: 130, hi: 200, open_hi: true, beyond: false, class: 'very_old', label_de: 'etwa 85–200+ Jahre' }],
    [40.0, 'larch', B],
    [12.5, 'pine', { lo: 30, mid: 35, hi: 45, open_hi: false, beyond: false, class: 'young', label_de: 'etwa 30–45 Jahre' }],
    [36.0, 'beech', B],
    [33.0, 'beech', { lo: 105, mid: 140, hi: 160, open_hi: true, beyond: false, class: 'very_old', label_de: 'etwa 105–160+ Jahre' }],
  ];
  for (const [h, g, age] of cases) {
    it(`${h} m ${g}`, () => {
      const a = treeAge(h, g);
      if (age === null) expect(a).toBeNull();
      else expect(a).toMatchObject(age);
    });
  }
  it('contract example: a 22 m beech → 55 / 65 / 85 years, middle', () => {
    expect(treeAge(22, 'beech')).toMatchObject({ lo: 55, mid: 65, hi: 85, class: 'middle' });
  });
  it('rounds to 5 years half-to-even like Python', () => {
    expect([roundHalfEven(2.5), roundHalfEven(3.5), roundHalfEven(2.4), roundHalfEven(2.6), roundHalfEven(5.5)]).toEqual([2, 4, 2, 3, 6]);
  });
  it('group from the species key, else the tree type', () => {
    expect(ageGroup('douglas_fir', 2)).toBe('douglas');
    expect(ageGroup('other_broadleaf', 1)).toBe('other');
    expect(ageGroup('beech', 1)).toBe('beech');
    expect(ageGroup(null, 1)).toBe('conifer');
    expect(ageGroup(null, 2 | 0x80)).toBe('broadleaf');
    expect(ageGroup('canopy_loss', 0)).toBe('unknown');
    expect(treeAge(Number.NaN)).toBeNull();
  });
});

// Keep the type import used (ManifestSpecies is the parse result).
const _typed: ManifestSpecies = SP;
void _typed;

describe('treeGroup (tree-group-v1, twin of pipeline/species.py tree_group: same cases)', () => {
  const sp = (group: 'conifer' | 'broadleaf', pct: number, contra = false) => ({ group, likely: !contra && pct >= 50 });
  it('lets a „wahrscheinlich“ class beat the colour type and gives no group when unsure sources disagree', () => {
    const cases: Array<[ReturnType<typeof sp> | null, number, number]> = [
      [sp('conifer', 90), 2, 1], // likely pine over a „broadleaf“ colour (the review's pine stands)
      [sp('conifer', 40), 2, 0], // unsure pine vs broadleaf colour
      [sp('broadleaf', 80), 2, 2],
      [sp('broadleaf', 80, true), 1, 0], // conifer colour in a beech class: contradiction → unsure → disagree
      [sp('conifer', 40), 1, 1],
      [sp('conifer', 40), 0, 0],
      [null, 1, 1], // no class: colour type
      [null, 2, 2],
      [null, 2, 2], // canopy loss (speciesAt → null)
      [sp('broadleaf', 40), 2, 2],
      [sp('broadleaf', 30, true), 0x81, 0], // fill bit ignored
      [sp('conifer', 50), 0, 1],
      [null, 7, 0], // unknown type code
    ];
    for (const [s, t, want] of cases) expect(treeGroup(s, t)).toBe(want);
  });
});
