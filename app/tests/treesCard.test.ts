import { describe, expect, it, vi } from 'vitest';
import { lodParams } from '../src/trees/lod';
import { TREE_STRIDE, treeId } from '../src/trees/treeData';
import {
  fmtDbh,
  fmtMassRange,
  forestPixel,
  forestSummary,
  parseForestHist,
  placeIdAt,
  pointInRings,
  roundSig,
  treeAllometry,
  treeFromRow,
  treeTypeLabel,
  validForestValues,
} from '../src/trees/treeFacts';
import { pickTreeRows, rayCylinder, rayHitsBox } from '../src/trees/treePick';
import type { PickOptions, PickRay } from '../src/trees/treePick';

describe('treeAllometry (crown-allometry-v2, twin of pipeline/stats.py)', () => {
  // Reference numbers from pipeline/stats.py `agb_kg` + `biomass_range_t` (2026-11-08):
  //   uv run python -c "from stats import agb_kg, biomass_range_t; ..."
  const cases = [
    { h: 25.3, r: 4.2, conifer: false, d: 42.53257135051606, agbT: [0.7230543735382033, 1.4461087470764067, 2.8922174941528134], co2T: [1.301497872368766, 2.602995744737532, 5.205991489475064] },
    { h: 38.71, r: 3.0, conifer: true, d: 45.701294562392484, agbT: [0.8895538174223766, 1.7791076348447532, 3.5582152696895064], co2T: [1.601196871360278, 3.202393742720556, 6.404787485441112] },
    { h: 12.0, r: 1.5, conifer: false, d: 10.113556809156794, agbT: [0.021150178332953393, 0.042300356665906785, 0.08460071333181357], co2T: [0.03807032099931611, 0.07614064199863221, 0.15228128399726443] },
  ];
  for (const c of cases) {
    it(`matches Python for h=${c.h} r=${c.r} ${c.conifer ? 'conifer' : 'broadleaf'}`, () => {
      const a = treeAllometry(c.h, c.r, c.conifer);
      expect(a.dbhCm).toBeCloseTo(c.d, 9);
      a.agbKg.forEach((v, i) => expect(v / 1000).toBeCloseTo(c.agbT[i], 10));
      a.co2Kg.forEach((v, i) => expect(v / 1000).toBeCloseTo(c.co2T[i], 10));
    });
  }

  it('ranges are ordered lo ≤ mid ≤ hi and CO₂ = 1.8 × biomass', () => {
    const a = treeAllometry(30, 5, false);
    expect(a.agbKg[0]).toBeLessThan(a.agbKg[1]);
    expect(a.agbKg[1]).toBeLessThan(a.agbKg[2]);
    expect(a.co2Kg[1]).toBeCloseTo(a.agbKg[1] * 1.8, 9);
    expect(treeAllometry(0, 5, false).agbKg[1]).toBe(0);
  });

  it('formats ranges in kg or t with 2 significant digits', () => {
    expect(roundSig(1446.1087, 2)).toBe(1400);
    expect(roundSig(0.0423, 2)).toBe(0.042);
    expect(fmtMassRange([723.05, 1446.1, 2892.2])).toBe('0,72–2,9 t');
    expect(fmtMassRange([21.15, 42.3, 84.6])).toBe('21–85 kg');
    expect(fmtDbh(42.53)).toBe('≈ 43 cm');
    expect(fmtDbh(123.4)).toBe('≈ 120 cm');
  });

  it('labels the base types like the contract', () => {
    expect([0, 1, 2, 5].map(treeTypeLabel)).toEqual(['Baum', 'Nadelbaum', 'Laubbaum', 'Baum']);
  });
});

const FH = {
  format: 'sle-forest-hist-v1',
  path: 'forest_hist/forest_hist.png',
  encoding: 'u8-bits',
  cellSize: 5,
  size: { width: 1200, height: 1600 },
  nodata: 255,
  epochs: [
    { year: 1935, bit: 1, noMapBit: 3, key: 'hist_1935', label_de: 'Wald 1935–40', map_de: 'TK25, Ausgaben 1935–40', classified: true, note_de: 'Baumsignaturen' },
    { year: 1840, bit: 0, noMapBit: 2, key: 'hist_1840', label_de: 'Wald 1836–41', map_de: 'Bayer. Positionsblätter', classified: false, note_de: 'Karte ohne Waldsignatur' },
  ],
  label_de: 'Historischer Wald (Schätzung)',
  attribution: '© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet (Historische Karten)',
};

describe('forest_hist (sle-forest-hist-v1)', () => {
  it('parses the manifest key and sorts epochs oldest first', () => {
    const fh = parseForestHist(FH)!;
    expect(fh.cellSize).toBe(5);
    expect(fh.epochs.map((e) => e.year)).toEqual([1840, 1935]);
    expect(fh.epochs[0].classified).toBe(false);
  });

  it('ignores bad keys (contract „App tolerance“)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseForestHist(undefined)).toBeUndefined();
    expect(parseForestHist([])).toBeUndefined();
    expect(parseForestHist({ ...FH, format: 'x' })).toBeUndefined();
    expect(parseForestHist({ ...FH, path: 3 })).toBeUndefined();
    expect(parseForestHist({ ...FH, cellSize: 0 })).toBeUndefined();
    expect(parseForestHist({ ...FH, size: { width: 1.5, height: 2 } })).toBeUndefined();
    const fh = parseForestHist({ ...FH, epochs: [{ year: 1935, bit: 'x', noMapBit: 3, classified: true }, 'junk'] })!;
    expect(fh.epochs).toHaveLength(1);
    expect(fh.epochs[0].bit).toBeNull();
    warn.mockRestore();
  });

  it('looks up the 5 m pixel by the contract grid (row 0 = north)', () => {
    const fh = parseForestHist(FH)!;
    const aoi = { E0: 378000, N0: 5460000, heightM: 8000 };
    expect(forestPixel(fh, aoi, 378000.1, 5467999.9)).toBe(0); // north-west corner
    expect(forestPixel(fh, aoi, 378007.5, 5467999.9)).toBe(1);
    expect(forestPixel(fh, aoi, 378002.5, 5467992.5)).toBe(1200); // second row
    expect(forestPixel(fh, aoi, 383999.9, 5460000.1)).toBe(1600 * 1200 - 1); // south-east corner
    expect(forestPixel(fh, aoi, 377999.9, 5464000)).toBe(-1);
    expect(forestPixel(fh, aoi, 380000, 5468000.5)).toBe(-1); // north of the AOI
  });

  it('words the estimate and never claims 1840 while it is unclassified', () => {
    const fh = parseForestHist(FH)!;
    const forest35 = forestSummary(0b0010, fh)!;
    expect(forest35.headline).toBe('laut Karte 1935–40 wahrscheinlich Wald'); // one snapshot: no „seit“
    expect(forest35.headline).not.toMatch(/seit/);
    expect(forest35.forest).toBe(true);
    expect(forest35.lines[0]).toMatch(/^1836–41: nicht auswertbar/);
    expect(forest35.maps).toEqual(['TK25, Ausgaben 1935–40']);
    // the 1840 forest bit is ignored while unclassified
    expect(forestSummary(0b0011, fh)!.headline).toBe('laut Karte 1935–40 wahrscheinlich Wald');
    const none = forestSummary(0, fh)!;
    expect(none.headline).toBe('1935–40: auf der Karte kein Wald erkannt');
    expect(none.forest).toBe(false);
    expect(forestSummary(0b1000, fh)!.headline).toBe('Historische Karten hier nicht auswertbar'); // no 1935 map here
    expect(forestSummary(255, fh)).toBeNull();
    expect(forestSummary(null, fh)).toBeNull();
  });

  it('reads both epochs once 1840 is classified', () => {
    const fh = parseForestHist({ ...FH, epochs: FH.epochs.map((e) => ({ ...e, classified: true })) })!;
    expect(forestSummary(0b0011, fh)!.headline).toBe('laut Karten seit mindestens 1836–41 wahrscheinlich Wald'); // two epochs agree
    expect(forestSummary(0b0010, fh)!.headline).toBe('laut Karte 1935–40 wahrscheinlich Wald (1836–41: kein Wald erkannt)');
    expect(forestSummary(0b0001, fh)!.headline).toBe('1935–40: auf der Karte kein Wald erkannt');
    expect(forestSummary(0b0110, fh)!.headline).toBe('laut Karte 1935–40 wahrscheinlich Wald'); // no 1840 map here: one snapshot
    expect(forestSummary(0b1001, fh)!.headline).toBe('laut Karte 1836–41 wahrscheinlich Wald'); // no 1935 map here
    expect(forestSummary(0b1100, fh)!.headline).toBe('Historische Karten hier nicht auswertbar'); // no map in either epoch
    // three epochs: forest in the two newest → „seit“ the older of those, with the non-forest epoch named
    const fh3 = parseForestHist({
      ...FH,
      epochs: [
        { year: 1800, bit: 4, noMapBit: 5, label_de: 'Wald 1800', classified: true },
        ...FH.epochs.map((e) => ({ ...e, classified: true })),
      ],
    })!;
    expect(forestSummary(0b000011, fh3)!.headline).toBe('laut Karten seit 1836–41 wahrscheinlich Wald (1800: kein Wald erkannt)');
  });

  it('validates decoded values', () => {
    expect(validForestValues(new Uint8Array([0, 2, 10, 15, 255]))).toBe(true);
    expect(validForestValues(new Uint8Array([0, 16]))).toBe(false); // e.g. a colour-managed decode
  });
});

describe('point in Gemarkung', () => {
  const outer: Array<[number, number]> = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const hole: Array<[number, number]> = [[40, 40], [60, 40], [60, 60], [40, 60]];
  it('even-odd over outer rings and holes', () => {
    expect(pointInRings([outer, hole], 10, 10)).toBe(true);
    expect(pointInRings([outer, hole], 50, 50)).toBe(false);
    expect(pointInRings([outer, hole], 150, 50)).toBe(false);
  });
  it('finds the place id', () => {
    const m = new Map([
      ['a', [outer]],
      ['b', [outer.map(([x, y]) => [x + 200, y] as [number, number])]],
    ]);
    expect(placeIdAt(m, 250, 50)).toBe('b');
    expect(placeIdAt(m, 50, 50)).toBe('a');
    expect(placeIdAt(m, 150, 50)).toBeNull();
  });
});

/** Rows: [x, g, z, h, r, rank, seed, kind]. */
function rows(...trees: Array<Partial<{ x: number; g: number; z: number; h: number; r: number; rank: number; kind: number }>>): Float32Array {
  const a = new Float32Array(trees.length * TREE_STRIDE);
  trees.forEach((t, k) => a.set([t.x ?? 0, t.g ?? 0, t.z ?? 0, t.h ?? 20, t.r ?? 3, t.rank ?? 0.1, 0.5, t.kind ?? 2], k * TREE_STRIDE));
  return a;
}

const horizontal = (oy: number): PickRay => ({ ox: -100, oy, oz: 0, dx: 1, dy: 0, dz: 0 });
const OPTS: PickOptions = { hRef: 0, exag: 1, params: lodParams(1500), lensFade: 0, slackPerM: 0, minApparent: 0, maxDistance: 1500 };

describe('tree picking (CPU ray vs. instance rows)', () => {
  it('ray–cylinder entry and exit', () => {
    expect(rayCylinder(horizontal(10), 0, 0, 0, 20, 3)).toEqual([97, 103]);
    expect(rayCylinder(horizontal(25), 0, 0, 0, 20, 3)).toBeNull(); // above the crown
    expect(rayCylinder({ ox: 1, oy: 100, oz: 0, dx: 0, dy: -1, dz: 0 }, 0, 0, 0, 20, 3)).toEqual([80, 100]); // straight down
    expect(rayCylinder({ ox: 5, oy: 100, oz: 0, dx: 0, dy: -1, dz: 0 }, 0, 0, 0, 20, 3)).toBeNull();
    expect(rayCylinder({ ox: 200, oy: 10, oz: 0, dx: 1, dy: 0, dz: 0 }, 0, 0, 0, 20, 3)).toBeNull(); // behind
  });

  it('ray–box slab test', () => {
    const box = { xMin: -5, xMax: 5, yMin: 0, yMax: 20, zMin: -5, zMax: 5 };
    expect(rayHitsBox(horizontal(10), box)).toBe(true);
    expect(rayHitsBox(horizontal(10), box, 50)).toBe(false);
    expect(rayHitsBox(horizontal(30), box)).toBe(false);
  });

  it('picks the nearest tree along the ray', () => {
    const r = rows({ x: 50 }, { x: 0 }, { x: 20, z: 30 });
    const hit = pickTreeRows(r, horizontal(10), OPTS)!;
    expect(hit.index).toBe(1);
    expect(hit.exact).toBe(true);
    expect(hit.t).toBeCloseTo(100 - 3 * 1.1, 4);
  });

  it('places the cylinder on the exaggerated ground, the tree itself unscaled', () => {
    const r = rows({ x: 0, g: 100, h: 20 });
    const o = { ...OPTS, hRef: 50, exag: 2 }; // base y = 50 + 50·2 = 150, top 170
    expect(pickTreeRows(r, horizontal(160), o)?.index).toBe(0);
    expect(pickTreeRows(r, horizontal(110), o)).toBeNull();
    expect(pickTreeRows(r, horizontal(175), o)).toBeNull();
  });

  it('exact hits beat near misses; slack catches small misses', () => {
    const r = rows({ x: 0, z: 4 }, { x: 40, z: 0 }); // first passes 4 m beside the ray (R = 3.3)
    const o = { ...OPTS, slackPerM: 0.02 }; // 2 m slack at 100 m
    const hit = pickTreeRows(r, horizontal(10), o)!;
    expect(hit.index).toBe(1);
    expect(hit.exact).toBe(true);
    const only = pickTreeRows(rows({ x: 0, z: 4 }), horizontal(10), o)!;
    expect(only.exact).toBe(false);
    expect(only.index).toBe(0);
  });

  it('skips trees the shader does not draw (rank thinning, lens fade, distance, tiny crowns)', () => {
    const p = lodParams(1500); // full 900 m
    const far = rows({ x: 1200, rank: 0.9 }); // density at 1.3 km ≈ 0.48 → rank 0.9 is not drawn
    expect(pickTreeRows(far, { ...horizontal(10), ox: 0 - 100 }, { ...OPTS, params: p })).toBeNull();
    const near = rows({ x: 0 });
    expect(pickTreeRows(near, horizontal(10), { ...OPTS, lensFade: 1 })).toBeNull();
    expect(pickTreeRows(near, horizontal(10), { ...OPTS, maxDistance: 50 })).toBeNull();
    // crown 3.3 m at 100 m with 0.01 m/m slack (1 m) and minApparent 4 → needs ≥ 4 m: skipped
    expect(pickTreeRows(near, horizontal(10), { ...OPTS, slackPerM: 0.01, minApparent: 4 })).toBeNull();
    expect(pickTreeRows(near, horizontal(10), { ...OPTS, slackPerM: 0.01, minApparent: 2 })?.index).toBe(0);
  });

  it('carries the best hit across several row arrays', () => {
    const a = rows({ x: 50 });
    const b = rows({ x: 10 });
    const first = pickTreeRows(a, horizontal(10), OPTS);
    const best = pickTreeRows(b, horizontal(10), OPTS, first)!;
    expect(best.rows).toBe(b);
  });

  it('turns a row into tree facts with the stable id', () => {
    const origin = { E0: 378000, N0: 5460000 };
    const r = rows({ x: 969.5, g: 250.25, z: -1138.5, h: 40.7, r: 4.5, kind: 2 }, { x: 10.5, z: -20.5, kind: 1 + 4 });
    const t = treeFromRow(r, 0, origin);
    expect(t.E).toBe(378969.5);
    expect(t.N).toBe(5461138.5);
    expect(t.id).toBe(3361297554); // = places.json tallest.id of Beeden-Schwarzenbach (contract id rule)
    expect(t.id).toBe(treeId(378969.5, 5461138.5));
    expect(t.kind).toBe(2);
    expect(t.fill).toBe(false);
    expect(t.h).toBeCloseTo(40.7, 4);
    const f = treeFromRow(r, 1, origin);
    expect(f.kind).toBe(1);
    expect(f.fill).toBe(true);
  });
});
