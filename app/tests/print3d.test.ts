import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRINT_PREFS,
  KNOWN_PRINT_SERIES,
  TILE_ID_RE,
  blockCount,
  cellCommand,
  cellOfCorner,
  displayCells,
  formatGrams,
  formatKm,
  formatScale,
  generateCommand,
  LABEL_LINE_PX,
  LABEL_PAD_PX,
  labelWidthPx,
  tileLabel,
  tileLabelMode,
  gridCells,
  outlineRuns,
  parsePrintIndex,
  parsePrintPrefs,
  parseSeriesList,
  parseTileId,
  printTotals,
  safeRelPath,
  setKeys,
  sharedEdges,
  tileId,
} from '../src/print/printData';

const G2 = { tile_m: 2000, origin: [0, 0] as [number, number] };

function tile(id: string, tile_m = 2000, typical = 400, zmax = 30) {
  const p = parseTileId(id)!;
  return {
    id,
    grid: { col: p.E0 / tile_m, row: p.N0 / tile_m },
    bboxUTM: [p.E0, p.N0, p.E0 + tile_m, p.N0 + tile_m],
    files: { '3mf': `${id}.3mf`, png: `${id}.png`, stl: `${id}.stl` },
    z_mm: { min: 15, max: zmax, mean: 20 },
    h_m: { min: 230, max: 300, mean: 250 },
    filament_g: { solid: typical * 4, typical },
    watertight: true,
    extraKey: 'ignored',
  };
}

function index(over: Record<string, unknown> = {}, tiles: unknown[] = [tile('E380_N5460'), tile('E378_N5462')]) {
  return {
    format: 'sle-print3d-v1',
    series: {
      key: 'saarpfalz-8400',
      name_de: 'Saarpfalz 1:8400',
      scale: 8400,
      tile_m: 2000,
      tile_mm: 238.095,
      exag: 2,
      datum_m: 180,
      base_mm: 4,
      origin: [0, 0],
      connectors: { enabled: true, positions: [0.25, 0.75], key: 'keys/bowtie_key.stl' },
    },
    printerProfile: { name: 'P1S', file: 'printer/p.json' },
    layout: 'layout.png',
    sets: { explorer: ['E378_N5460', 'E380_N5460', 'bogus'] },
    keysNeeded: 36,
    attribution: 'a; b',
    disclaimer_de: 'Schauen, nicht graben.',
    tiles,
    ...over,
  };
}

describe('tile ids', () => {
  it('formats km with decimals only when needed', () => {
    expect(formatKm(380000)).toBe('380');
    expect(formatKm(382500)).toBe('382.5');
    expect(formatKm(5465250)).toBe('5465.25');
    expect(tileId(382500, 5465500)).toBe('E382.5_N5465.5');
    expect(tileId(376000, 5462000)).toBe('E376_N5462');
  });

  it('parses ids per the contract regex', () => {
    expect(parseTileId('E376_N5462')).toEqual({ E0: 376000, N0: 5462000 });
    expect(parseTileId('E382.5_N5465.5')).toEqual({ E0: 382500, N0: 5465500 });
    expect(parseTileId('E381.125_N5463')).toEqual({ E0: 381125, N0: 5463000 });
    for (const bad of ['E376N5462', 'E376_N5462.1234', 'e376_n5462', 'E-1_N5', 'E376_N5462 ', '']) expect(parseTileId(bad)).toBeNull();
    expect(TILE_ID_RE.test('E380_N5460')).toBe(true);
  });

  it('round-trips id ↔ corner', () => {
    for (const [E, N] of [
      [378000, 5466000],
      [381500, 5463500],
      [382250, 5465750],
    ])
      expect(parseTileId(tileId(E, N))).toEqual({ E0: E, N0: N });
  });
});

describe('grid', () => {
  it('cells of the overall AOI: 3 × 4 at 2 km, N descending / E ascending', () => {
    const c = gridCells([378000, 5460000, 384000, 5468000], G2);
    expect(c.map((x) => x.id)).toEqual([
      'E378_N5466', 'E380_N5466', 'E382_N5466',
      'E378_N5464', 'E380_N5464', 'E382_N5464',
      'E378_N5462', 'E380_N5462', 'E382_N5462',
      'E378_N5460', 'E380_N5460', 'E382_N5460',
    ]);
    expect(c[0].bbox).toEqual([378000, 5466000, 380000, 5468000]);
    expect(c[0].col).toBe(189);
    expect(c[0].row).toBe(2733);
  });

  it('extends by one ring of extension cells', () => {
    const c = gridCells([378000, 5460000, 384000, 5468000], G2, 1);
    expect(c.length).toBe(5 * 6);
    expect(c[0].id).toBe('E376_N5468');
    expect(c.at(-1)!.id).toBe('E384_N5458');
  });

  it('partial overlaps count, edge contact does not', () => {
    // Karlsberg 381000–384000 × 5465000–5468000 → cols 380, 382; rows 5464, 5466
    expect(gridCells([381000, 5465000, 384000, 5468000], G2).map((x) => x.id)).toEqual(['E380_N5466', 'E382_N5466', 'E380_N5464', 'E382_N5464']);
    expect(gridCells([380000, 5460000, 382000, 5462000], G2).length).toBe(1);
    expect(gridCells([1, 1, 1, 2], G2)).toEqual([]);
  });

  it('honours a grid origin and 500 m detail tiles', () => {
    const g = { tile_m: 500, origin: [250, 0] as [number, number] };
    expect(gridCells([381300, 5463100, 381800, 5463400], g).map((x) => x.id)).toEqual(['E381.25_N5463', 'E381.75_N5463']);
    expect(cellOfCorner(381250, 5463000, g)?.id).toBe('E381.25_N5463');
    expect(cellOfCorner(381300, 5463000, g)).toBeNull();
  });
});

describe('parsePrintIndex', () => {
  it('accepts the contract shape, ignores unknown keys, sorts tiles N↓ E↑', () => {
    const { value, warnings } = parsePrintIndex(index());
    expect(warnings).toEqual([]);
    expect(value.series.key).toBe('saarpfalz-8400');
    expect(value.series.connectors).toEqual({ enabled: true, positions: [0.25, 0.75], key: 'keys/bowtie_key.stl' });
    expect(value.tiles.map((t) => t.id)).toEqual(['E378_N5462', 'E380_N5460']);
    expect(value.tiles[0].files).toEqual({ '3mf': 'E378_N5462.3mf', png: 'E378_N5462.png', stl: 'E378_N5462.stl' });
    expect(value.sets.explorer).toEqual(['E378_N5460', 'E380_N5460']);
    expect(value.printerProfile?.file).toBe('printer/p.json');
    const stock = parsePrintIndex(index({ printerProfile: { mode: 'stock', file: null, placement_mm: [19.4, 17.1], note_de: 'n' } })).value;
    expect(stock.printerProfile).toEqual({ mode: 'stock', file: null, placement_mm: [19.4, 17.1], note_de: 'n' });
    expect(value.layout).toBe('layout.png');
  });

  it('rejects a wrong format or series block', () => {
    expect(() => parsePrintIndex(index({ format: 'sle-print3d-v2' }))).toThrow();
    expect(() => parsePrintIndex(null)).toThrow();
    expect(() => parsePrintIndex(index({ series: { key: 'x' } }))).toThrow(/scale/);
    expect(() => parsePrintIndex(index({ series: { ...index().series, key: '../x' } }))).toThrow(/key/);
  });

  it('skips invalid tiles with warnings', () => {
    const bad = [
      { ...tile('E380_N5460'), id: 'nope' },
      { ...tile('E380_N5460'), bboxUTM: [380000, 5460000, 381000, 5461000] }, // wrong size
      { ...tile('E381_N5460'), bboxUTM: [381000, 5460000, 383000, 5462000] }, // off-grid
      { ...tile('E382_N5460'), files: { '3mf': '../../etc/passwd' } },
      { ...tile('E382_N5462'), filament_g: {} },
      tile('E384_N5460'),
      tile('E384_N5460'),
    ];
    const { value, warnings } = parsePrintIndex(index({}, bad));
    expect(value.tiles.map((t) => t.id)).toEqual(['E384_N5460']);
    expect(warnings.length).toBe(6);
  });

  it('drops unsafe optional file names and missing connectors', () => {
    const t = { ...tile('E380_N5460'), files: { '3mf': 'a.3mf', png: 'https://evil/x.png', stl: '/abs.stl' } };
    const { value } = parsePrintIndex(index({ series: { ...index().series, connectors: { enabled: false } } }, [t]));
    expect(value.tiles[0].files).toEqual({ '3mf': 'a.3mf' });
    expect(value.series.connectors).toEqual({ enabled: false, positions: [], key: null });
  });
});

describe('slicer recommendation', () => {
  it('parses the optional slicer block and recommended grams; totals only when every tile has one', () => {
    const rec = (id: string, g: number) => ({ ...tile(id), filament_g: { solid: 1600, typical: 400, recommended: g } });
    const slicer = { note_de: 'Filament sparen: Füllmuster „Blitz“ …', savingPct: [27, 55], settings: { wall_loops: 3 } };
    const { value } = parsePrintIndex(index({ slicer }, [rec('E380_N5460', 250), rec('E378_N5462', 200)]));
    expect(value.slicer).toEqual({ note_de: slicer.note_de, savingPct: [27, 55] });
    expect(value.tiles.map((t) => t.filament_g.recommended)).toEqual([200, 250]);
    const tt = printTotals(value.series, value.tiles);
    expect([tt.gramsTypical, tt.gramsRecommended]).toEqual([800, 450]);
    const mixed = parsePrintIndex(index({}, [rec('E380_N5460', 250), tile('E378_N5462')])).value;
    expect(mixed.slicer).toBeUndefined();
    expect(printTotals(mixed.series, mixed.tiles).gramsRecommended).toBeNull();
    expect(printTotals(mixed.series, []).gramsRecommended).toBeNull();
    for (const bad of [{ note_de: '' }, { note_de: 3 }, 'x', { savingPct: [1, 2] }])
      expect(parsePrintIndex(index({ slicer: bad })).value.slicer).toBeUndefined();
    expect(parsePrintIndex(index({ slicer: { note_de: 'n', savingPct: [1] } })).value.slicer).toEqual({ note_de: 'n' });
  });
});

describe('safeRelPath', () => {
  it('allows plain relative paths only', () => {
    for (const ok of ['a.3mf', 'keys/bowtie_key.stl', 'printer/sle-p1s-0.4-250mm.json', 'E382.5_N5465.5.png']) expect(safeRelPath(ok)).toBe(true);
    for (const bad of ['', '../x', 'a/../b', '/abs', 'https://x/y', 'a b', 'a\\b', './a', null, 3]) expect(safeRelPath(bad)).toBe(false);
  });
});

describe('totals', () => {
  const series = parsePrintIndex(index()).value.series;
  const ids = ['E378_N5460', 'E380_N5460', 'E382_N5460', 'E378_N5462', 'E380_N5462', 'E382_N5462', 'E378_N5464', 'E380_N5464', 'E382_N5464', 'E378_N5466', 'E380_N5466', 'E382_N5466'];

  it('3 × 4 explorer block: 17 shared edges → 34 keys, 1 piece, size in cm', () => {
    const tiles = parsePrintIndex(index({}, ids.map((i) => tile(i, 2000, 500, 40)))).value.tiles;
    const t = printTotals(series, tiles);
    expect(t.tiles).toBe(12);
    expect(t.gramsTypical).toBe(6000);
    expect(t.gramsSolid).toBe(24000);
    expect(t.blocks).toBe(1);
    expect(t.keys).toBe(17 * 2);
    expect(t.widthCm).toBeCloseTo(3 * 23.8095, 3);
    expect(t.heightCm).toBeCloseTo(4 * 23.8095, 3);
    expect(t.maxZmm).toBe(40);
  });

  it('separate pieces and bounding rectangle', () => {
    const tiles = parsePrintIndex(index({}, [tile('E376_N5462'), tile('E380_N5462'), tile('E380_N5464')])).value.tiles;
    const t = printTotals(series, tiles);
    expect(t.blocks).toBe(2);
    expect(t.keys).toBe(2);
    expect(t.widthCm).toBeCloseTo(3 * 23.8095, 3);
    expect(t.heightCm).toBeCloseTo(2 * 23.8095, 3);
    expect(printTotals({ ...series, connectors: { enabled: false, positions: [], key: null } }, tiles).keys).toBe(0);
  });

  it('empty series', () => {
    expect(printTotals(series, [])).toMatchObject({ tiles: 0, gramsTypical: 0, widthCm: 0, heightCm: 0, blocks: 0, keys: 0 });
  });

  it('tiles with different datums neither join nor need keys (datumMode "set")', () => {
    const a = { ...tile('E380_N5460'), datum_m: 200 };
    const b = { ...tile('E382_N5460'), datum_m: 200 };
    const c = { ...tile('E382_N5462'), datum_m: 270 };
    const ix = parsePrintIndex(index({ series: { ...index().series, datumMode: 'set' } }, [a, b, c])).value;
    expect(ix.series.datumMode).toBe('set');
    expect(ix.tiles.find((t) => t.id === 'E382_N5462')!.datum_m).toBe(270);
    const t = printTotals(ix.series, ix.tiles);
    expect(t.keys).toBe(2); // only a–b
    expect(t.blocks).toBe(2);
    expect(t.datums).toEqual([200, 270]);
    // without per-tile datum: series datum for all → 2 shared edges
    expect(printTotals(series, parsePrintIndex(index({}, [tile('E380_N5460'), tile('E382_N5460'), tile('E382_N5462')])).value.tiles).keys).toBe(4);
    expect(parsePrintIndex(index()).value.series.datumMode).toBe('series');
  });

  it('shared edges / blocks on raw cells', () => {
    const sq = [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 0, row: 1 },
      { col: 1, row: 1 },
    ];
    expect(sharedEdges(sq)).toBe(4);
    expect(blockCount(sq)).toBe(1);
    expect(blockCount([{ col: 0, row: 0 }, { col: 1, row: 1 }])).toBe(2); // diagonal only
    expect(sharedEdges([{ col: 0, row: 0, group: 1 }, { col: 1, row: 0, group: 2 }])).toBe(0);
  });
});

describe('displayCells', () => {
  it('AOI cells + ring, generated tiles and set members anywhere', () => {
    const ix = parsePrintIndex(index({ sets: { far: ['E370_N5450'] } }, [tile('E380_N5460'), tile('E372_N5462')])).value;
    const cells = displayCells(ix, [381000, 5465000, 384000, 5468000], 1);
    const ids = cells.map((c) => c.id);
    expect(ids.length).toBe(16 + 3);
    expect(ids).toContain('E378_N5462'); // ring
    expect(ids).toContain('E384_N5468'); // ring
    expect(ids).toContain('E372_N5462'); // generated, outside
    expect(ids).toContain('E370_N5450'); // set member
    expect(cells.find((c) => c.id === 'E380_N5460')!.tile?.id).toBe('E380_N5460');
    expect(cells.find((c) => c.id === 'E380_N5462')!.tile).toBeNull();
    expect(cells.find((c) => c.id === 'E370_N5450')!.sets).toEqual(['far']);
    // N descending, E ascending
    for (let i = 1; i < cells.length; i++) {
      const a = cells[i - 1];
      const b = cells[i];
      expect(a.row > b.row || (a.row === b.row && a.col < b.col)).toBe(true);
    }
  });
});

describe('outlineRuns', () => {
  const origin = { E0: 381000, N0: 5465000 };
  it('closed, densified ring in the local frame', () => {
    const runs = outlineRuns([382000, 5466000, 382500, 5466500], origin, null, 2);
    expect(runs.length).toBe(1);
    const r = runs[0];
    expect(r.length / 2).toBe(4 * 250 + 1);
    expect(r.slice(0, 2)).toEqual([1000, -1000]);
    expect(r.slice(-2)).toEqual([1000, -1000]);
    for (let k = 2; k < r.length; k += 2) expect(Math.hypot(r[k] - r[k - 2], r[k + 1] - r[k - 1])).toBeLessThanOrEqual(2 + 1e-9);
    // NE corner = (+1500, −1500)
    expect(r.some((_, k) => k % 2 === 0 && r[k] === 1500 && r[k + 1] === -1500)).toBe(true);
  });

  it('clips to the AOI and joins the run through the start corner', () => {
    // Tile 380000–382000 × 5464000–5466000 vs AOI 381000–384000 × 5465000–5468000: only the NE quarter
    // of the ring (N edge east half + E edge north half) is inside, as ONE run through the NE corner.
    const runs = outlineRuns([380000, 5464000, 382000, 5466000], origin, [381000, 5465000, 384000, 5468000], 2);
    expect(runs.length).toBe(1);
    const r = runs[0];
    for (let k = 0; k < r.length; k += 2) {
      const E = r[k] + origin.E0;
      const N = origin.N0 - r[k + 1];
      expect(E).toBeGreaterThanOrEqual(381000);
      expect(N).toBeGreaterThanOrEqual(5465000);
    }
    // start-corner case: clip leaves out only the middle of the S edge
    const runs2 = outlineRuns([381000, 5465000, 381100, 5465100], origin, [381000, 5465000, 381100, 5465100], 2);
    expect(runs2.length).toBe(1);
    const cut = outlineRuns([381000, 5465000, 381100, 5465100], { E0: 0, N0: 0 }, [381000, 5465000, 381100, 5465100].map((v, i) => (i === 1 ? v + 1 : v)) as [number, number, number, number], 2);
    expect(cut.length).toBe(1); // S edge removed; W, N, E edges in one run
    expect(cut[0].length / 2).toBe(3 * 50 - 1);
    expect(outlineRuns([370000, 5450000, 372000, 5452000], origin, [381000, 5465000, 384000, 5468000])).toEqual([]);
  });
});

describe('misc', () => {
  it('series list file shapes', () => {
    expect(parseSeriesList(['saarpfalz-8400', 'detail-2100', 'saarpfalz-8400'])).toEqual(['saarpfalz-8400', 'detail-2100']);
    expect(parseSeriesList({ series: [{ key: 'a' }, 'b', { nope: 1 }, '../x'] })).toEqual(['a', 'b']);
    expect(parseSeriesList(null)).toEqual([]);
    expect(KNOWN_PRINT_SERIES).toContain('saarpfalz-8500');
    // pipeline catalog (print/series.json, sle-print3d-series-v1)
    const catalog = {
      format: 'sle-print3d-series-v1',
      series: [
        { key: 'saarpfalz-8500', role: 'main', scale: 8500, index: 'saarpfalz-8500/index.json', tiles: 7 },
        { key: 'detail-2125', role: 'detail', scale: 2125, index: 'detail-2125/index.json', tiles: 0 },
      ],
    };
    expect(parseSeriesList(catalog)).toEqual(['saarpfalz-8500', 'detail-2125']);
  });

  it('CLI command', () => {
    expect(generateCommand('saarpfalz-8400', ['E376_N5462'])).toBe('uv run python print3d.py --series saarpfalz-8400 --tiles E376_N5462');
    expect(generateCommand('detail-2100', ['E382_N5466', 'E382_N5465.5'])).toBe('uv run python print3d.py --series detail-2100 --tiles E382_N5466 E382_N5465.5');
  });

  it('formatting', () => {
    expect(formatScale(8400)).toBe('1:8.400');
    expect(formatGrams(435.4)).toBe('435 g');
    expect(formatGrams(5240)).toBe('5,2 kg');
  });

  it('prefs', () => {
    expect(parsePrintPrefs(null)).toEqual(DEFAULT_PRINT_PREFS);
    expect(parsePrintPrefs({ series: 'detail-2100', grid: false, outline: false })).toEqual({ series: 'detail-2100', grid: false, outline: false });
    expect(parsePrintPrefs({ series: '<x>', grid: 'yes' })).toEqual(DEFAULT_PRINT_PREFS);
  });
});

describe('per-set datum series (detail)', () => {
  const detailSeries = {
    ...index().series,
    key: 'detail-2125',
    scale: 2125,
    tile_m: 500,
    tile_mm: 235.294,
    datum_m: null,
    datumMode: 'set',
  };
  const t = (id: string, datum: number) => ({ ...tile(id, 500), datum_m: datum });
  const raw = index(
    {
      series: detailSeries,
      sets: { karlsberg: ['E382_N5465.5', 'E382_N5466'], merburg: ['E381.5_N5463', 'E382_N5463'] },
      setDatum_m: { karlsberg: 274, merburg: 238, bad: 'x' },
    },
    [t('E382_N5466', 274), t('E382_N5465.5', 274), t('E381.5_N5463', 238)],
  );

  it('accepts datum_m null only with datumMode "set"', () => {
    const { value } = parsePrintIndex(raw);
    expect(value.series.datum_m).toBeNull();
    expect(value.setDatum_m).toEqual({ karlsberg: 274, merburg: 238 });
    expect(() => parsePrintIndex(index({ series: { ...index().series, datum_m: null } }))).toThrow(/datum_m/);
    const tt = printTotals(value.series, value.tiles);
    expect(tt.datums).toEqual([238, 274]);
    expect(tt.blocks).toBe(2);
    expect(tt.keys).toBe(2); // karlsberg pair only
  });

  it('command: set members plain, others with the nearest datum', () => {
    const ix = parsePrintIndex(raw).value;
    expect(cellCommand(ix, 'E382_N5463')).toEqual({ cmd: 'uv run python print3d.py --series detail-2125 --tiles E382_N5463', note_de: '' });
    const near = cellCommand(ix, 'E382.5_N5466');
    expect(near.cmd).toBe('uv run python print3d.py --series detail-2125 --tiles E382.5_N5466 --datum 274');
    expect(near.note_de).toMatch(/E382_N5466/);
    expect(cellCommand(ix, 'E381_N5462.5').cmd).toMatch(/--datum 238$/);
    const empty = parsePrintIndex(index({ series: detailSeries, sets: {} }, [])).value;
    const none = cellCommand(empty, 'E380_N5460');
    expect(none.cmd).not.toMatch(/--datum/);
    expect(none.note_de).toMatch(/--datum/);
    // series datum: never --datum
    expect(cellCommand(parsePrintIndex(index()).value, 'E390_N5470').cmd).toBe('uv run python print3d.py --series saarpfalz-8400 --tiles E390_N5470');
  });

  it('setKeys counts every set member, generated or not, joined per set datum', () => {
    const full = {
      karlsberg: ['E382_N5465.5', 'E382_N5466'],
      merburg: ['E381.5_N5463', 'E382_N5463', 'E381.5_N5463.5', 'E382_N5463.5'],
    };
    // only the Karlsberg pair generated: generated-tile keys 2, complete sets 1 + 4 edges × 2 = 10
    const ix = parsePrintIndex(index({ series: detailSeries, sets: full, setDatum_m: { karlsberg: 274 } }, [t('E382_N5466', 274), t('E382_N5465.5', 274)])).value;
    expect(printTotals(ix.series, ix.tiles).keys).toBe(2);
    expect(setKeys(ix)).toBe(10);
    // adjacent sets with different datums don't join
    const adj = parsePrintIndex(index({ series: detailSeries, sets: { a: ['E380_N5460'], b: ['E380.5_N5460'] }, setDatum_m: { a: 200, b: 260 } }, [])).value;
    expect(setKeys(adj)).toBe(0);
    // series datum: sets join each other; duplicates count once; bad ids ignored
    expect(setKeys(parsePrintIndex(index({ sets: { a: ['E378_N5460', 'E380_N5460', 'bogus'], b: ['E380_N5460', 'E382_N5460'] } })).value)).toBe(4);
    expect(setKeys(parsePrintIndex(index({ series: { ...index().series, connectors: { enabled: false, positions: [], key: null } } })).value)).toBe(0);
  });
});

describe('minimap tile labels (size-aware, never wider than the cell)', () => {
  // Web Mercator at 49.3° N: ≈ 99.7 m/px at zoom 10, halving per zoom level.
  const px = (tile_m: number, zoom: number) => tile_m / (102070 / 2 ** zoom);

  it('2 km series: none at zoom 10, stacked grid numbers at 11, full id from 12', () => {
    expect(tileLabel('E382_N5466', px(2000, 10))).toEqual({ mode: 'none', lines: [] });
    expect(tileLabel('E382_N5466', px(2000, 11))).toEqual({ mode: 'compact', lines: ['382', '5466'] });
    expect(tileLabel('E382_N5466', px(2000, 12))).toEqual({ mode: 'full', lines: ['E382_N5466'] });
  });

  it('500 m detail series with decimal ids: stacked from zoom 14, full from 15', () => {
    expect(tileLabel('E381.5_N5463.5', px(500, 13)).mode).toBe('none');
    expect(tileLabel('E381.5_N5463.5', px(500, 14))).toEqual({ mode: 'compact', lines: ['381.5', '5463.5'] });
    expect(tileLabel('E381.5_N5463.5', px(500, 15)).mode).toBe('full');
  });

  it('every shown label fits inside its own square (so neighbours cannot collide)', () => {
    for (const id of ['E382_N5466', 'E381.5_N5463.5', 'E376_N5462']) {
      for (let s = 0; s <= 400; s += 3) {
        const l = tileLabel(id, s);
        if (l.mode === 'none') continue;
        expect(Math.max(...l.lines.map(labelWidthPx))).toBeLessThanOrEqual(s);
        expect(l.lines.length * LABEL_LINE_PX + LABEL_PAD_PX).toBeLessThanOrEqual(s);
      }
    }
  });

  it('one style per series: the widest id decides (no mix of full and stacked labels)', () => {
    const ids = ['E382_N5463', 'E381.5_N5463.5'];
    expect(tileLabel('E382_N5463', px(500, 13))).toEqual({ mode: 'compact', lines: ['382', '5463'] }); // alone it would fit
    expect(tileLabelMode(ids, px(500, 13))).toBe('none');
    expect(tileLabel('E382_N5463', px(500, 14), ids)).toEqual({ mode: 'compact', lines: ['382', '5463'] });
    expect(tileLabelMode(ids, px(500, 15))).toBe('full');
    expect(tileLabelMode([], 500)).toBe('none');
  });

  it('degenerate sizes and non-contract ids', () => {
    expect(tileLabel('E382_N5466', 0).mode).toBe('none');
    expect(tileLabel('E382_N5466', Number.NaN).mode).toBe('none');
    expect(tileLabel('x', 30)).toEqual({ mode: 'full', lines: ['x'] });
    expect(tileLabel('not-a-tile-id-at-all', 60)).toEqual({ mode: 'none', lines: [] });
  });
});
