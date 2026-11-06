import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BufferAttribute, BufferGeometry, Matrix4, Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  CASTLE_ZONE_ID,
  CONF_COLORS,
  DEFAULT_EXPLORER_URL,
  DEFAULT_RECON_PREFS,
  DEFAULT_VIEWER_URL,
  attributionEntries,
  backTargetUrl,
  buildViewerUrl,
  confFromCode,
  aoiExtentInModel,
  footprintCentre,
  footprintShownOnAoi,
  handoverHidden,
  isLocalHttpUrl,
  isSafeRelativePath,
  modelOffset,
  parseFootprints,
  parseReconIndex,
  parseReconPrefs,
  partShownOnAoi,
  reconFooterText,
  reconOverlapsAoi,
  roundHeading,
  trueHeightFromDisplay,
  withinEnterRadius,
} from '../src/reconstruction/recon';
import type { ReconIndex } from '../src/reconstruction/recon';
import { ReconLayer, prepareGeometry } from '../src/reconstruction/ReconLayer';
import { createSharedUniforms } from '../src/terrain/TerrainMaterial';
import type { Terrain } from '../src/terrain/Terrain';
import { formatHash, parseHash } from '../src/state';

const FIXTURE = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'recon', 'index.json'), 'utf8')) as Record<string, unknown>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const index = (): ReconIndex => parseReconIndex(FIXTURE).value!;

describe('F19 sle-recon-v1 index.json', () => {
  it('parses the fixture, ignores unknown keys, skips malformed building entries', () => {
    const r = parseReconIndex(FIXTURE);
    const ix = r.value!;
    expect(ix).not.toBeNull();
    expect(ix.id).toBe('karlsberg1789');
    expect(ix.origin).toEqual({ E0: 381000, N0: 5465000 });
    expect(ix.anchor).toEqual({ E: 381500, N: 5466200, enterRadius_m: 300 });
    expect(ix.files).toEqual({ model: 'buildings.glb', footprints: 'footprints.geojson' });
    expect(ix.viewer.url).toBe('http://localhost:5260/');
    expect('futureKey' in ix).toBe(false);
    // KB-B01, KB-B02, KB-B03 (invalid confidence → low); no-id, duplicate and non-object skipped.
    expect(ix.buildings.map((b) => b.id)).toEqual(['KB-B01', 'KB-B02', 'KB-B03']);
    expect(ix.buildings[2].confidence).toBe('low');
    expect(ix.buildings[2].name_de).toBe('KB-B03');
    expect(ix.buildings[0].sources_de).toHaveLength(3);
    expect(ix.buildings[0].ridge_h).toBe(362.7);
    expect(ix.buildings[0].bbox_local).toEqual([[500, 340, -1210], [560, 362.7, -1190]]);
    expect('extra' in ix.buildings[0]).toBe(false);
    expect(r.warnings.length).toBeGreaterThanOrEqual(4);
  });

  it('treats the dataset as absent on wrong format/crs/origin/anchor/bbox/model', () => {
    const bad: Array<(x: Record<string, unknown>) => void> = [
      (x) => (x.format = 'sle-recon-v2'),
      (x) => (x.crs = 'EPSG:4326'),
      (x) => (x.origin = { E0: 'a', N0: 1 }),
      (x) => delete x.anchor,
      (x) => (x.bboxEN = [[381700, 5466000], [381300, 5466400]]),
      (x) => (x.bboxEN = [[1, 2]]),
      (x) => (x.files = { model: '../../etc/passwd' }),
      (x) => (x.files = { model: 'http://evil.example/x.glb' }),
      (x) => (x.files = { model: '/abs.glb' }),
      (x) => (x.files = {}),
      (x) => (x.id = 'bad id!'),
    ];
    for (const mut of bad) {
      const x = clone(FIXTURE);
      mut(x);
      expect(parseReconIndex(x).value).toBeNull();
    }
    expect(parseReconIndex(null).value).toBeNull();
    expect(parseReconIndex([]).value).toBeNull();
  });

  it('defaults optional fields and rejects non-local viewer URLs', () => {
    const x = clone(FIXTURE);
    delete x.label_de;
    delete x.name_de;
    delete x.attribution;
    delete x.disclaimer_de;
    (x.anchor as Record<string, unknown>).enterRadius_m = -5;
    (x.files as Record<string, unknown>).footprints = '../x.geojson';
    x.viewer = { url: 'javascript:alert(1)' };
    const r = parseReconIndex(x);
    const ix = r.value!;
    expect(ix.label_de).toBe('Rekonstruktion (Hypothese)');
    expect(ix.name_de).toBe(ix.label_de);
    expect(ix.attribution).toBe('');
    expect(ix.disclaimer_de).toMatch(/Schauen, nicht graben/);
    expect(ix.anchor.enterRadius_m).toBe(300);
    expect(ix.files.footprints).toBeUndefined();
    expect(ix.viewer.url).toBe(DEFAULT_VIEWER_URL);
  });

  it('validates local URLs and relative paths', () => {
    for (const ok of ['http://localhost:5260/', 'https://127.0.0.1/x', 'http://[::1]:5260/', 'http://schloss.localhost/', 'http://castle.test:8080/'])
      expect(isLocalHttpUrl(ok)).toBe(true);
    for (const no of ['javascript:alert(1)', 'http://evil.example/', 'http://localhost.evil.com/', 'ftp://localhost/', 'http://user:pw@localhost/', '', 'nope', 42])
      expect(isLocalHttpUrl(no)).toBe(false);
    expect(isSafeRelativePath('buildings.glb')).toBe(true);
    expect(isSafeRelativePath('sub/dir/f.geojson')).toBe(true);
    for (const no of ['', '../x', 'a/../b', '/x', 'a//b', 'http://x', 'a b', 5]) expect(isSafeRelativePath(no)).toBe(false);
  });

  it('splits the attribution string', () => {
    expect(attributionEntries('A; B ;; C')).toEqual(['A', 'B', 'C']);
    expect(attributionEntries('')).toEqual([]);
  });
});

describe('F19 placement in an AOI', () => {
  it('offers the layer only for AOIs its bbox intersects', () => {
    const ix = index();
    expect(reconOverlapsAoi(ix, { origin: { E0: 381000, N0: 5465000 }, width: 3000, height: 3000 })).toBe(true); // karlsberg
    expect(reconOverlapsAoi(ix, { origin: { E0: 378000, N0: 5460000 }, width: 6000, height: 8000 })).toBe(true); // overall
    expect(reconOverlapsAoi(ix, { origin: { E0: 300000, N0: 5400000 }, width: 1000, height: 1000 })).toBe(false);
    expect(reconOverlapsAoi(ix, { origin: { E0: 381700, N0: 5466000 }, width: 500, height: 500 })).toBe(false); // touching edge only
  });

  it('translates the model frame into the AOI frame (karlsberg and overall line up)', () => {
    const model = { E0: 381000, N0: 5465000 };
    expect(modelOffset(model, { E0: 381000, N0: 5465000 })).toEqual({ x: 0, y: 0, z: -0 });
    const off = modelOffset(model, { E0: 378000, N0: 5460000 });
    expect(off).toEqual({ x: 3000, y: 0, z: -5000 });
    // A model vertex at E = 381512, N = 5466170 lands at the overall AOI's world x/z of that E/N.
    const mx = 381512 - model.E0;
    const mz = -(5466170 - model.N0);
    expect(mx + off.x).toBe(381512 - 378000);
    expect(mz + off.z).toBe(-(5466170 - 5460000));
  });

  it('checks the enter radius horizontally', () => {
    const a = index().anchor;
    expect(withinEnterRadius(381500, 5466200, a)).toBe(true);
    expect(withinEnterRadius(381500 + 299.9, 5466200, a)).toBe(true);
    expect(withinEnterRadius(381500 + 212.2, 5466200 + 212.2, a)).toBe(false); // 300.09 m
    expect(withinEnterRadius(NaN, 5466200, a)).toBe(false);
  });

  it('maps _CONF codes and keeps three distinct colours', () => {
    expect([0, 1, 2, 3, -1, 1.4].map(confFromCode)).toEqual(['low', 'med', 'high', 'high', 'low', 'med']);
    expect(new Set(Object.values(CONF_COLORS)).size).toBe(3);
  });
});

describe('F19 camera handover', () => {
  it('converts a displayed y back to the true height', () => {
    expect(trueHeightFromDisplay(200 + (300 - 200) * 3, 200, 3)).toBeCloseTo(300, 9);
    expect(trueHeightFromDisplay(345.6, 200, 1)).toBe(345.6);
    expect(trueHeightFromDisplay(345.6, 200, 0)).toBe(345.6); // degenerate exag guarded
  });

  it('rounds heading into [0, 360)', () => {
    expect(roundHeading(-0.04)).toBe(0);
    expect(roundHeading(359.96)).toBe(0);
    expect(roundHeading(-90)).toBe(270);
    expect(roundHeading(725.06)).toBe(5.1);
  });

  it('builds the explorer → viewer URL per contract', () => {
    const back = 'http://localhost:5240/?aoi=karlsberg#381512.0,5466170.0,412.3,45,-20,vat,,0.5,off,2,315,35,1';
    const url = buildViewerUrl('http://localhost:5260/', { E: 381512.04, N: 5466170.06, h: 412.349, heading: 45.04, pitch: -20.06 }, 'fliegen', back);
    expect(url).toBe(
      'http://localhost:5260/?src=explorer&E=381512&N=5466170.1&h=412.3&heading=45&pitch=-20.1&mode=fliegen&back=' + encodeURIComponent(back),
    );
    const u = new URL(url);
    expect(u.searchParams.get('back')).toBe(back);
    expect(u.searchParams.get('mode')).toBe('fliegen');
  });

  it('keeps the viewer URL query, drops its hash, replaces our params, falls back on unsafe URLs', () => {
    const pose = { E: 1, N: 2, h: 3, heading: 4, pitch: -5 };
    const u = new URL(buildViewerUrl('http://127.0.0.1:5260/app/?lang=de&E=9#x', pose, 'gehen', 'http://localhost:5240/'));
    expect(u.pathname).toBe('/app/');
    expect(u.hash).toBe('');
    expect(u.searchParams.get('lang')).toBe('de');
    expect(u.searchParams.getAll('E')).toEqual(['1']);
    expect(u.searchParams.get('mode')).toBe('gehen');
    expect(buildViewerUrl('javascript:alert(1)', pose, 'fliegen', '').startsWith(DEFAULT_VIEWER_URL + '?src=explorer')).toBe(true);
    expect(() => buildViewerUrl(DEFAULT_VIEWER_URL, { ...pose, h: NaN }, 'fliegen', '')).toThrow();
  });

  it('viewer → explorer: replaces the first five hash fields, keeps the rest (and stays parseable)', () => {
    const state = {
      E: 381000.5, N: 5465000.5, h: 300, heading: 10, pitch: -30, layer: 'vat', overlay: '', overlayOpacity: 0.5,
      forest: 'off' as const, exaggeration: 2, sunAzimuth: 315, sunElevation: 35, sunDirections: 1, preset: '',
    };
    const back = `http://localhost:5240/?aoi=overall${formatHash(state)}`;
    const target = backTargetUrl(back, { E: 381512.04, N: 5466170.06, h: 371.26, heading: 359.97, pitch: -12.34 });
    const t = new URL(target);
    expect(t.search).toBe('?aoi=overall');
    expect(t.hash.split(',').slice(0, 5)).toEqual(['#381512', '5466170.1', '371.3', '0', '-12.3']);
    expect(t.hash.split(',').slice(5)).toEqual(formatHash(state).split(',').slice(5));
    const p = parseHash(t.hash)!;
    expect(p).toMatchObject({ E: 381512, N: 5466170.1, h: 371.3, heading: 0, pitch: -12.3, layer: 'vat', exaggeration: 2 });
    // No hash → just the five fields; unsafe back → explorer default.
    expect(new URL(backTargetUrl('http://localhost:5240/', { E: 1, N: 2, h: 3, heading: 4, pitch: 5 })).hash).toBe('#1,2,3,4,5');
    expect(backTargetUrl('https://evil.example/#1,2,3,4,5', { E: 1, N: 2, h: 3, heading: 4, pitch: 5 })).toBe(`${DEFAULT_EXPLORER_URL}#1,2,3,4,5`);
    expect(backTargetUrl(null, { E: 1, N: 2, h: 3, heading: 4, pitch: 5 })).toBe(`${DEFAULT_EXPLORER_URL}#1,2,3,4,5`);
  });

  it('ADR 0048: the castle zone portal replaces the handover; without it the handover is the fallback', () => {
    const bakery = { zoneId: 'baeckerei-heusser' };
    const castle = { zoneId: CASTLE_ZONE_ID };
    expect(CASTLE_ZONE_ID).toBe('schloss-karlsberg');
    expect(handoverHidden(false, [])).toBe(false); // no zone index / zone absent → handover stays
    expect(handoverHidden(false, [bakery])).toBe(false); // other zones do not matter
    expect(handoverHidden(false, [bakery, castle])).toBe(true); // castle zone offered → portal only
    expect(handoverHidden(true, [])).toBe(true); // VITE_VIEWER_URL=off
  });
});

describe('F19 footprints + prefs', () => {
  const ring = (E: number, N: number, s = 10) => [[E, N], [E + s, N], [E + s, N + s], [E, N + s], [E, N]];

  it('parses EPSG:25832 polygons, skips lon/lat and id-less features', () => {
    const fc = {
      type: 'FeatureCollection',
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::25832' } },
      features: [
        { type: 'Feature', properties: { id: 'KB-B01', name_de: 'Hauptschloss', confidence: 'high' }, geometry: { type: 'Polygon', coordinates: [ring(381500, 5466200)] } },
        { type: 'Feature', properties: { id: 'KB-B02' }, geometry: { type: 'MultiPolygon', coordinates: [[ring(381400, 5466100)], [ring(381420, 5466100)]] } },
        { type: 'Feature', properties: { id: 'LL' }, geometry: { type: 'Polygon', coordinates: [ring(7.38, 49.34, 0.001)] } },
        { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring(381500, 5466200)] } },
        { type: 'Feature', properties: { id: 'tri' }, geometry: { type: 'Polygon', coordinates: [[[381500, 5466200], [381510, 5466200], [381500, 5466200]]] } },
      ],
    };
    const f = parseFootprints(fc, index().buildings);
    expect(f.map((x) => x.id)).toEqual(['KB-B01', 'KB-B02']);
    expect(f[1].confidence).toBe('med'); // from index.json
    expect(f[1].name_de).toBe('Marstall');
    expect(f[1].polygons).toHaveLength(2);
    expect(footprintCentre(f[0])).toEqual({ E: 381505, N: 5466205 });
    expect(parseFootprints({ type: 'nope' })).toEqual([]);
  });

  it('minimap draws only footprints whose building is shown on the AOI terrain', () => {
    const karlsberg = { origin: { E0: 381000, N0: 5465000 }, width: 3000, height: 3000 };
    const overall = { origin: { E0: 378000, N0: 5460000 }, width: 6000, height: 8000 };
    const fp = (id: string, E: number, N: number) => ({ id, name_de: id, confidence: 'low' as const, polygons: [[ring(E, N) as [number, number][]]] });
    const inside = fp('KB-B01', 381500, 5466200);
    const south = fp('KL-B40', 382900, 5464990); // Karlslust pavilion straddling the S edge of AOI karlsberg
    expect(footprintShownOnAoi(inside, karlsberg)).toBe(true);
    expect(footprintShownOnAoi(south, karlsberg)).toBe(false);
    expect(footprintShownOnAoi(south, overall)).toBe(true);
    // once the glb is loaded the layer's own decision wins (it uses the mesh bbox, incl. eaves and skirts)
    expect(footprintShownOnAoi(inside, karlsberg, false)).toBe(false);
    expect(footprintShownOnAoi(south, karlsberg, true)).toBe(true);
    expect(footprintShownOnAoi(south, karlsberg, null)).toBe(false);
  });

  it('applies the AOI placement rule in the model frame (buildings fully inside, site nodes overlapping)', () => {
    const e = aoiExtentInModel({ E0: 381000, N0: 5465000 }, { origin: { E0: 378000, N0: 5460000 }, width: 6000, height: 8000 });
    expect(e).toEqual({ x0: -3000, x1: 3000, z0: -3000, z1: 5000 });
    const k = aoiExtentInModel({ E0: 381000, N0: 5465000 }, { origin: { E0: 381000, N0: 5465000 }, width: 3000, height: 3000 });
    expect(Object.values(k).map((v) => v + 0)).toEqual([0, 3000, -3000, 0]); // x0, x1, z0, z1
    const straddle = { x0: 1900, x1: 1910, z0: -5, z1: 5 }; // crosses the S edge z = 0
    expect(partShownOnAoi('KL-B40', straddle, k)).toBe(false);
    expect(partShownOnAoi('site:TF-30', straddle, k)).toBe(true);
    expect(partShownOnAoi('site:TF-30', { x0: 1900, x1: 1910, z0: 1, z1: 5 }, k)).toBe(false);
    expect(partShownOnAoi('KB-B01', { x0: 500, x1: 600, z0: -1300, z1: -1100 }, k)).toBe(true);
  });

  it('footer credit does not repeat the reconstruction label', () => {
    const exported = attributionEntries(
      'Rekonstruktion Schloss Karlsberg 1789 (Hypothese): Teilprojekt schloss-karlsberg; Grundrisse teils nach Lageplan 2006 (CC BY-SA 2.0 DE)',
    );
    const t = reconFooterText(exported);
    expect(t).toBe('Rekonstruktion Schloss Karlsberg 1789 (Hypothese): Teilprojekt schloss-karlsberg, Grundrisse teils nach Lageplan 2006 (CC BY-SA 2.0 DE)');
    expect(t.match(/Rekonstruktion/g)).toHaveLength(1);
    expect(reconFooterText(['Katalog v2', 'DGM1'])).toBe('Rekonstruktion 1789 (Hypothese): Katalog v2, DGM1');
    expect(reconFooterText([])).toBe('Rekonstruktion 1789 (Hypothese)');
  });

  it('parses stored prefs with defaults (layer default OFF)', () => {
    expect(parseReconPrefs(null)).toEqual(DEFAULT_RECON_PREFS);
    expect(DEFAULT_RECON_PREFS.on).toBe(false);
    expect(parseReconPrefs({ on: true, mode: 'confidence', opacity: 0.01 })).toEqual({ on: true, mode: 'confidence', opacity: 0.15 });
    expect(parseReconPrefs({ on: 'yes', mode: 'x', opacity: 'a' })).toEqual(DEFAULT_RECON_PREFS);
  });
});

// ---- geometry + layer (three in node, synthetic glb) ----------------------------------------------

describe('F19 geometry preparation', () => {
  it('bakes a node transform into float positions, fills colour and _conf', () => {
    const g = new BufferGeometry();
    // Quantized positions (normalised int16) as gltf-transform writes them, + dequantization matrix.
    g.setAttribute('position', new BufferAttribute(new Int16Array([0, 0, 0, 32767, 0, 0, 0, 32767, 0]), 3, true));
    const m = new Matrix4().makeScale(10, 10, 10).setPosition(5, 300, -5);
    prepareGeometry(g, m, 2);
    const p = g.getAttribute('position');
    expect(p.array).toBeInstanceOf(Float32Array);
    expect([p.getX(1), p.getY(1), p.getZ(1)].map((v) => Math.round(v * 1000) / 1000)).toEqual([15, 300, -5]);
    expect([p.getX(2), p.getY(2)].map((v) => Math.round(v * 1000) / 1000)).toEqual([5, 310]);
    expect(g.getAttribute('color').count).toBe(3);
    expect(Array.from(g.getAttribute('_conf').array)).toEqual([2, 2, 2]);
    expect(g.getAttribute('normal')).toBeTruthy();
    expect(g.boundingSphere).toBeTruthy();
  });

  it('keeps an existing _conf as class ids (not normalised)', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
    g.setAttribute('_conf', new BufferAttribute(new Uint8Array([1, 1, 1]), 1, true));
    prepareGeometry(g, new Matrix4(), 0);
    expect(g.getAttribute('_conf').normalized).toBe(false);
    expect(g.getAttribute('_conf').getX(0)).toBe(1);
  });
});

/** Minimal glb: box `KB-B01` (COLOR_0 + _CONF, model x 0–10, y 300–310, z −10–0) and a translated `site:wall` triangle pair. */
function makeGlb(): ArrayBuffer {
  // Box as 12 triangles, non-indexed.
  const [x0, x1, y0, y1, z0, z1] = [0, 10, 300, 310, -10, 0];
  const c = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const quads = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]];
  const pos: number[] = [];
  for (const [a, b, cc, d] of quads) for (const k of [a, b, cc, a, cc, d]) pos.push(...c[k]);
  const nBox = pos.length / 3;
  const col: number[] = [];
  for (let k = 0; k < nBox; k++) col.push(0.8, 0.7, 0.6);
  // site:wall: unit quad in x/y at z = 0, node translation (100, 0, 0) and scale (5, 300, 1).
  const wall = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0];
  const f32 = (a: number[]) => new Uint8Array(new Float32Array(a).buffer);
  const conf = new Uint8Array(nBox * 4); // byteStride 4 (glTF vertex alignment)
  for (let k = 0; k < nBox; k++) conf[k * 4] = 2;
  const chunks = [f32(pos), f32(col), conf, f32(wall)];
  const offsets: number[] = [];
  let len = 0;
  for (const ch of chunks) {
    offsets.push(len);
    len += Math.ceil(ch.length / 4) * 4;
  }
  const bin = new Uint8Array(len);
  chunks.forEach((ch, i) => bin.set(ch, offsets[i]));
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: 'KB-B01', mesh: 0 },
      { name: 'site:wall', mesh: 1, translation: [100, 0, 0], scale: [5, 300, 1] },
    ],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0, COLOR_0: 1, _CONF: 2 } }] },
      { primitives: [{ attributes: { POSITION: 3 } }] },
    ],
    buffers: [{ byteLength: len }],
    bufferViews: [
      { buffer: 0, byteOffset: offsets[0], byteLength: chunks[0].length },
      { buffer: 0, byteOffset: offsets[1], byteLength: chunks[1].length },
      { buffer: 0, byteOffset: offsets[2], byteLength: chunks[2].length, byteStride: 4 },
      { buffer: 0, byteOffset: offsets[3], byteLength: chunks[3].length },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: nBox, type: 'VEC3', min: [x0, y0, z0], max: [x1, y1, z1] },
      { bufferView: 1, componentType: 5126, count: nBox, type: 'VEC3' },
      { bufferView: 2, componentType: 5121, count: nBox, type: 'SCALAR' },
      { bufferView: 3, componentType: 5126, count: 6, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
    ],
  };
  let js = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (js.length % 4)) % 4;
  js = new Uint8Array([...js, ...new Array(pad).fill(0x20)]);
  const total = 12 + 8 + js.length + 8 + bin.length;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, js.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(out, 20, js.length).set(js);
  dv.setUint32(20 + js.length, bin.length, true);
  dv.setUint32(24 + js.length, 0x004e4942, true);
  new Uint8Array(out, 28 + js.length, bin.length).set(bin);
  return out;
}

// three's FileLoader reports progress with the DOM ProgressEvent (absent in node).
const g = globalThis as { ProgressEvent?: unknown };
g.ProgressEvent ??= class ProgressEvent extends Event {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;
  constructor(type: string, init: { lengthComputable?: boolean; loaded?: number; total?: number } = {}) {
    super(type);
    this.lengthComputable = !!init.lengthComputable;
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
};

describe('F19 ReconLayer (synthetic glb, overall AOI)', () => {
  const hRef = 200;
  const makeLayer = (aoi = { E0: 378000, N0: 5460000, width: 6000, height: 8000 }) => {
    const uniforms = createSharedUniforms(hRef, 500);
    const manifest = { origin: { E0: aoi.E0, N0: aoi.N0 }, size: { width: aoi.width, height: aoi.height }, cellSize: 1 };
    const terrain = { uniforms, manifest } as unknown as Terrain;
    const ix: ReconIndex = { ...index(), files: { model: `data:model/gltf-binary;base64,${Buffer.from(makeGlb()).toString('base64')}` } };
    return { layer: new ReconLayer(ix, terrain, ''), uniforms };
  };

  it('loads one part per node, places it in the AOI and picks through the exaggeration', async () => {
    const { layer, uniforms } = makeLayer();
    await layer.load();
    expect(layer.state).toBe('ready');
    expect(layer.stats).toEqual({ parts: 2, triangles: 14 });
    expect(layer.position.toArray()).toEqual([3000, 0, -5000]);
    const box = layer.children.find((o) => o.name === 'KB-B01')!;
    expect(box).toBeTruthy();
    layer.updateMatrixWorld(true);

    const down = (x: number, z: number) => new Ray(new Vector3(x, 1000, z), new Vector3(0, -1, 0));
    // exag 1: roof at true 310.
    let hit = layer.pick(down(3005, -5005))!;
    expect(hit.id).toBe('KB-B01');
    expect(hit.building?.name_de).toBe('Hauptschloss');
    expect(hit.point.y).toBeCloseTo(310, 4);
    // exag 3: roof displayed at hRef + (310 − hRef)·3 = 530; distance measured in display space.
    uniforms.uExag.value = 3;
    layer.update(null as never);
    hit = layer.pick(down(3005, -5005))!;
    expect(hit.point.y).toBeCloseTo(530, 4);
    expect(hit.distance).toBeCloseTo(470, 3);
    // Horizontal ray at exag 3 hits the displayed wall (x = 3000 face, displayed 500–530) at
    // y 515 (true 305); at y 450 (true ≈ 283, below the box) it misses.
    expect(layer.pick(new Ray(new Vector3(2990, 450, -5005), new Vector3(1, 0, 0)))).toBeNull();
    const o = new Vector3(2990, 515, -5005);
    const target = new Vector3(3000, 515, -5005);
    hit = layer.pick(new Ray(o, target.sub(o).normalize()))!;
    expect(hit.id).toBe('KB-B01');
    expect(hit.point.x).toBeCloseTo(3000, 4);
    expect(hit.point.y).toBeCloseTo(515, 3);
    // Above the displayed roof → miss.
    expect(layer.pick(new Ray(new Vector3(2990, 560, -5005), new Vector3(1, 0, 0)))).toBeNull();
    // site:wall: node transform baked (x 3100–3105, true y 0–300), no index entry.
    uniforms.uExag.value = 1;
    layer.update(null as never);
    const w = layer.pick(new Ray(new Vector3(3102, 150, 50), new Vector3(0, 0, -1)))!;
    expect(w.id).toBe('site:wall');
    expect(w.building).toBeNull();
    expect(w.point.z).toBeCloseTo(-5000, 4);
  });

  it('hides (and does not pick) buildings that leave the AOI terrain; site features only need to touch it', async () => {
    // AOI starting 5 m east of the box's west face: KB-B01 (model x 0–10) sticks out → hidden.
    const { layer } = makeLayer({ E0: 381005, N0: 5464990, width: 3000, height: 3000 });
    await layer.load();
    layer.updateMatrixWorld(true);
    const box = layer.children.find((o) => o.name === 'KB-B01')!;
    expect(box.visible).toBe(false);
    expect(layer.pick(new Ray(new Vector3(0, 1000, -15), new Vector3(0, -1, 0)))).toBeNull(); // box shown at x −5–5, z −20–−10
    layer.setOpacity(0.5);
    expect(layer.children.find((o) => o.name === 'KB-B01 (depth)')!.visible).toBe(false);
    expect(layer.children.find((o) => o.name === 'site:wall')!.visible).toBe(true);
    expect(layer.children.find((o) => o.name === 'site:wall (depth)')!.visible).toBe(true);
  });

  it('switches ghost mode (depth pre-pass) and selection material; unload frees parts', async () => {
    const { layer } = makeLayer();
    await layer.load();
    expect(layer.ghost).toBe(false);
    layer.setOpacity(0.5);
    expect(layer.ghost).toBe(true);
    expect(layer.material.transparent).toBe(true);
    expect(layer.children.filter((o) => o.name.endsWith('(depth)')).every((o) => o.visible)).toBe(true);
    layer.setOpacity(1);
    expect(layer.children.filter((o) => o.name.endsWith('(depth)')).every((o) => !o.visible)).toBe(true);
    layer.select('KB-B01');
    const box = layer.children.find((o) => o.name === 'KB-B01') as unknown as { material: unknown };
    expect(box.material).toBe(layer.selectedMaterial);
    layer.setColorMode('confidence');
    expect(layer.uniforms.uMode.value).toBe(1);
    layer.unload();
    expect(layer.stats.parts).toBe(0);
    expect(layer.children).toHaveLength(0);
    expect(layer.state).toBe('idle');
  });
});
