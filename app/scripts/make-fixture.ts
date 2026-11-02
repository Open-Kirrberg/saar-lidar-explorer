/**
 * Writes app/public/data/fixture/ per docs/data-contract.md (v2):
 * 2×2 chunks of 500 m, Terrarium DTM with 1-cell apron, u8 relief layers, overview levels 1–3
 * (2/4/8 m: DTM + vat + hillshade, block means, F9), synthetic vectors (OSM ways + parcel grid,
 * F10/F12), DSM (canopy + house roofs) with the `bldg` building mask (R0.7), synthetic `rgb` image
 * layers `ortho` (0.5 m) and `hist_1840` (1 m) on every level (F13/F14), synthetic relict candidates
 * (F15, `candidates/candidates.geojson`), synthetic point clouds (F16, `pointclouds/<id>/{tx}_{ty}.bin`,
 * sle-pts-v1), manifest.json.
 * Run: pnpm fixture
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { boxBlur } from '../src/data/boxBlur.ts';
import { blockMean } from '../src/data/pyramid.ts';
import { encodeTerrarium } from '../src/data/terrarium.ts';
import { utmToWgs84 } from '../src/geo.ts';
import { FEATURES, FIXTURE, fixtureCanopy, fixtureHeight, fixtureRaster } from './fixture-terrain.ts';
import { bldgMask, histColor, houseRoofAt, orthoColor, renderPlanes } from './fixture-imagery.ts';
import { FIXTURE_HOUSES, buildingMesh, encodeGlb, houseChunk } from './fixture-buildings.ts';
import { FIXTURE_POINT_AREAS, POINT_TILE, fixturePointTiles } from './fixture-points.ts';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../public/data/fixture');

if (process.argv.includes('--if-missing') && existsSync(join(OUT, 'manifest.json'))) {
  console.log('fixture: already present, skipping (run "pnpm fixture" to regenerate)');
  process.exit(0);
}

const { width: W, height: H, chunkSize: CS, E0, N0 } = FIXTURE;
const nx = Math.ceil(W / CS);
const ny = Math.ceil(H / CS);

function writePng(path: string, width: number, height: number, data: Uint8Array, colorType: 0 | 2): void {
  mkdirSync(dirname(path), { recursive: true });
  const buf = PNG.sync.write(
    { width, height, data: Buffer.from(data.buffer, data.byteOffset, data.byteLength) } as PNG,
    { colorType, inputColorType: colorType, bitDepth: 8 },
  );
  writeFileSync(path, buf);
}

const at = (a: Float32Array, c: number, r: number) =>
  a[Math.min(Math.max(r, 0), H - 1) * W + Math.min(Math.max(c, 0), W - 1)];

console.log(`fixture: ${W}×${H} cells → ${OUT}`);
const dtm = fixtureRaster(W, H);

// --- Derived layers on the full mosaic -------------------------------------------
const hill = new Float32Array(W * H);
const slope = new Float32Array(W * H);
const deg = Math.PI / 180;
const elev = 35 * deg;
const dirs = [225, 270, 315, 360].map((d) => d * deg);
for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    // Horn gradient; +x east, +y north.
    const z = (dc: number, dr: number) => at(dtm, c + dc, r + dr);
    const dzdx = (z(1, -1) + 2 * z(1, 0) + z(1, 1) - (z(-1, -1) + 2 * z(-1, 0) + z(-1, 1))) / 8;
    const dzdy = (z(-1, -1) + 2 * z(0, -1) + z(1, -1) - (z(-1, 1) + 2 * z(0, 1) + z(1, 1))) / 8;
    const g = Math.hypot(dzdx, dzdy);
    slope[r * W + c] = Math.atan(g) / deg;
    // Normal (−dzdx, −dzdy, 1)/|·|, sun (cos e sin a, cos e cos a, sin e).
    const inv = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
    let s = 0;
    for (const a of dirs) {
      s += Math.max(0, (-dzdx * Math.cos(elev) * Math.sin(a) - dzdy * Math.cos(elev) * Math.cos(a) + Math.sin(elev)) * inv);
    }
    hill[r * W + c] = s / dirs.length;
  }
}
const low = boxBlur(dtm, W, H, 15);
const slrm = dtm.map((h, k) => h - low[k]);
const vat = new Float32Array(W * H);
for (let k = 0; k < W * H; k++) {
  const s = 1 - Math.min(slope[k] / 45, 1);
  const lr = 0.5 + 0.5 * Math.max(-1, Math.min(1, slrm[k] / 0.8));
  vat[k] = 0.45 * hill[k] + 0.25 * s + 0.3 * lr;
}
const chm = new Float32Array(W * H);
const mask = new Float32Array(W * H);
for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    const u = c + 0.5;
    const v = H - r - 0.5;
    chm[r * W + c] = fixtureCanopy(u, v);
    mask[r * W + c] = u > 940 && v > 900 ? 1 : 0; // a small "filled" corner
  }
}
// R0.7: DSM = terrain + canopy, house roofs on top; building mask (centre in footprint, dilated 1 m).
const bldg = bldgMask(W, H);
const dsm = new Float32Array(W * H);
for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    const k = r * W + c;
    const roof = houseRoofAt(c + 0.5, H - r - 0.5);
    dsm[k] = Number.isNaN(roof) ? dtm[k] + chm[k] : Math.max(roof, dtm[k] + chm[k]);
  }
}

interface LayerDef {
  key: string;
  data: Float32Array;
  min: number;
  max: number;
  unit?: string;
  label_de: string;
  description: string;
}
const layers: LayerDef[] = [
  { key: 'hillshade', data: hill, min: 0, max: 1, label_de: 'Schummerung (multidirektional)', description: '4 directions, elev 35°' },
  { key: 'slope', data: slope, min: 0, max: 60, unit: 'deg', label_de: 'Hangneigung', description: 'Horn slope' },
  { key: 'slrm', data: slrm, min: -1.5, max: 1.5, unit: 'm', label_de: 'Lokales Relief', description: 'h − box(15 m)' },
  { key: 'vat', data: vat, min: 0, max: 1, label_de: 'VAT (Fixture-Näherung)', description: 'stand-in blend: hillshade/slope/slrm' },
  { key: 'chm', data: chm, min: 0, max: 40, unit: 'm', label_de: 'Vegetationshöhe', description: 'fake canopy' },
  { key: 'mask', data: mask, min: 0, max: 1, label_de: 'Ergänzte Daten (RLP/Lücke)', description: 'fake fill mask' },
  { key: 'bldg', data: bldg, min: 0, max: 1, label_de: 'Gebäudemaske', description: 'fixture houses, centre in footprint, dilated 1 m' },
];

// --- Chunks -----------------------------------------------------------------------
const S = CS + 2;
for (let j = 0; j < ny; j++) {
  for (let i = 0; i < nx; i++) {
    const rgb = new Uint8Array(S * S * 3);
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const [R, G, B] = encodeTerrarium(at(dtm, i * CS - 1 + px, j * CS - 1 + py)); // edge-clamped apron
        const o = (py * S + px) * 3;
        rgb[o] = R;
        rgb[o + 1] = G;
        rgb[o + 2] = B;
      }
    }
    writePng(join(OUT, `dtm/${i}_${j}.png`), S, S, rgb, 2);
    const drgb = new Uint8Array(S * S * 3);
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const [R, G, B] = encodeTerrarium(at(dsm, i * CS - 1 + px, j * CS - 1 + py));
        const o = (py * S + px) * 3;
        drgb[o] = R;
        drgb[o + 1] = G;
        drgb[o + 2] = B;
      }
    }
    writePng(join(OUT, `dsm/${i}_${j}.png`), S, S, drgb, 2);

    for (const L of layers) {
      const g = new Uint8Array(CS * CS);
      for (let py = 0; py < CS; py++) {
        for (let px = 0; px < CS; px++) {
          const val = at(L.data, i * CS + px, j * CS + py);
          const t = (val - L.min) / (L.max - L.min);
          g[py * CS + px] = Math.round(255 * Math.min(1, Math.max(0, t)));
        }
      }
      writePng(join(OUT, `relief/${L.key}/${i}_${j}.png`), CS, CS, g, 0);
    }
  }
}

// --- Overview levels (F9, docs/data-contract.md "Levels (v2)") ----------------------------
// Level k: 2^k m cells (block means, edge-padded), same 500-cell chunks anchored at the NW corner;
// images always full size, edge-clamped beyond the level raster. Coarse levels: dtm, vat, hillshade.
const LEVEL_COUNT = 3; // 1000 m AOI: level 1 = 1 chunk (500 cells), 2 = 250 cells, 3 = 125 cells
const LEVEL_LAYERS = layers.filter((L) => L.key === 'vat' || L.key === 'hillshade');
const levelEntries: unknown[] = [];
for (let k = 1; k <= LEVEL_COUNT; k++) {
  const f = 2 ** k;
  const lh = blockMean(dtm, W, H, f);
  const LW = lh.width;
  const LH = lh.height;
  const lnx = Math.ceil(LW / CS);
  const lny = Math.ceil(LH / CS);
  const lat = (a: Float32Array, c: number, r: number) => a[Math.min(Math.max(r, 0), LH - 1) * LW + Math.min(Math.max(c, 0), LW - 1)];
  const lls = LEVEL_LAYERS.map((L) => ({ L, data: blockMean(L.data, W, H, f).data }));
  for (let j = 0; j < lny; j++) {
    for (let i = 0; i < lnx; i++) {
      const rgb = new Uint8Array(S * S * 3);
      for (let py = 0; py < S; py++) {
        for (let px = 0; px < S; px++) {
          const [R, G, B] = encodeTerrarium(lat(lh.data, i * CS - 1 + px, j * CS - 1 + py));
          const o = (py * S + px) * 3;
          rgb[o] = R;
          rgb[o + 1] = G;
          rgb[o + 2] = B;
        }
      }
      writePng(join(OUT, `levels/${k}/dtm/${i}_${j}.png`), S, S, rgb, 2);
      for (const { L, data } of lls) {
        const g = new Uint8Array(CS * CS);
        for (let py = 0; py < CS; py++) {
          for (let px = 0; px < CS; px++) {
            const t = (lat(data, i * CS + px, j * CS + py) - L.min) / (L.max - L.min);
            g[py * CS + px] = Math.round(255 * Math.min(1, Math.max(0, t)));
          }
        }
        writePng(join(OUT, `levels/${k}/${L.key}/${i}_${j}.png`), CS, CS, g, 0);
      }
    }
  }
  levelEntries.push({
    level: k,
    cellSize: f,
    chunkSize: CS,
    size: { width: LW, height: LH },
    chunks: { nx: lnx, ny: lny },
    height: { dtm: { path: `levels/${k}/dtm/{i}_{j}.png`, encoding: 'terrarium', apron: 1 } },
    layers: Object.fromEntries(
      LEVEL_LAYERS.map((L) => [
        L.key,
        { path: `levels/${k}/${L.key}/{i}_{j}.png`, encoding: 'u8', min: L.min, max: L.max, ...(L.unit ? { unit: L.unit } : {}), label_de: L.label_de },
      ]),
    ),
  });
}

// --- Image layers (F13/F14, docs/data-contract.md "Image layers") --------------------------
// Rendered once as 0.5 m (ortho) / 1 m (hist) mosaics, cut into chunk images (row 0 = north, no
// apron); coarse levels are block means at 500 px per chunk, edge-clamped beyond the raster.
// PNG (contract tolerates it; the pipeline writes WebP/JPEG).
interface ImageDef { key: string; label_de: string; mpp0: number; planes: Float32Array[]; PW: number; PH: number }
const images: ImageDef[] = [
  { key: 'ortho', label_de: 'Luftbild (DOP20)', mpp0: 0.5, planes: [], PW: 2 * W, PH: 2 * H },
  { key: 'hist_1840', label_de: 'Karte 1836–41 (Bayer. Positionsblätter)', mpp0: 1, planes: [], PW: W, PH: H },
];
images[0].planes = renderPlanes(images[0].PW, images[0].PH, 0.5, H, orthoColor);
images[1].planes = renderPlanes(images[1].PW, images[1].PH, 1, H, histColor);
function writeRgbChunks(planes: Float32Array[], PW: number, PH: number, ppc: number, dir: string, cnx: number, cny: number): void {
  for (let j = 0; j < cny; j++) {
    for (let i = 0; i < cnx; i++) {
      const out = new Uint8Array(ppc * ppc * 3);
      for (let py = 0; py < ppc; py++) {
        const sy = Math.min(j * ppc + py, PH - 1);
        for (let px = 0; px < ppc; px++) {
          const sx = Math.min(i * ppc + px, PW - 1);
          for (let ch = 0; ch < 3; ch++) out[(py * ppc + px) * 3 + ch] = Math.round(255 * Math.min(1, Math.max(0, planes[ch][sy * PW + sx])));
        }
      }
      writePng(join(OUT, dir, `${i}_${j}.png`), ppc, ppc, out, 2);
    }
  }
}
const imageEntry = (img: ImageDef, path: string, ppc: number) => ({
  path,
  encoding: 'rgb',
  format: 'png',
  pixelsPerChunk: ppc,
  kind: 'image',
  label_de: img.label_de,
  source: 'Synthetisch (Fixture)',
});
const imageTop: Record<string, unknown> = {};
for (const img of images) {
  const ppc0 = CS / img.mpp0; // 1000 / 500 px per 500 m chunk
  writeRgbChunks(img.planes, img.PW, img.PH, ppc0, img.key, nx, ny);
  imageTop[img.key] = imageEntry(img, `${img.key}/{i}_{j}.png`, ppc0);
  for (let k = 1; k <= LEVEL_COUNT; k++) {
    const f = 2 ** k / img.mpp0; // source px per level-k cell
    const ds = img.planes.map((pl) => blockMean(pl, img.PW, img.PH, f));
    const lv = levelEntries[k - 1] as { chunks: { nx: number; ny: number }; layers: Record<string, unknown> };
    writeRgbChunks(ds.map((d) => d.data), ds[0].width, ds[0].height, CS, `levels/${k}/${img.key}`, lv.chunks.nx, lv.chunks.ny);
    lv.layers[img.key] = imageEntry(img, `levels/${k}/${img.key}/{i}_{j}.png`, CS);
  }
}

// --- Vectors (F10/F12, docs/data-contract.md "Vectors") -------------------------------
// Synthetic OSM ways and a 100 m parcel grid in EPSG:25832, densified to ≤ 2 m, placed on the
// fixture features (hollow way, foundation, ring, pit row) so drape/visibility can be checked.
type Pt = [number, number];
const r2 = (x: number) => Math.round(x * 100) / 100;
const utm = (u: number, v: number): Pt => [E0 + u, N0 + v];
function densifyLine(pts: Pt[], maxSeg = 1.98): Pt[] { // < 2 m so cm rounding stays ≤ 2 m
  const out: Pt[] = [pts[0]];
  for (let k = 1; k < pts.length; k++) {
    const [ax, ay] = pts[k - 1];
    const [bx, by] = pts[k];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / maxSeg - 1e-9));
    for (let s = 1; s <= n; s++) out.push([ax + ((bx - ax) * s) / n, ay + ((by - ay) * s) / n]);
  }
  return out.map(([x, y]) => [r2(x), r2(y)] as Pt);
}
const circle = (u: number, v: number, radius: number, n = 96): Pt[] =>
  Array.from({ length: n + 1 }, (_, k) => utm(u + radius * Math.cos((2 * Math.PI * k) / n), v + radius * Math.sin((2 * Math.PI * k) / n)));
const line = (coords: Pt[]) => ({ type: 'LineString', coordinates: densifyLine(coords) });
const uv = (...p: Array<[number, number]>) => p.map(([u, v]) => utm(u, v));
const hw = FEATURES.hollowWay;
const osmFeatures = [
  { props: { kind: 'path', name: 'Hohlweg (Fixture)', highway: 'path' }, geometry: line(uv([hw.u0, hw.v0], [hw.u1, hw.v1])) },
  { props: { kind: 'road', name: 'Fixture-Straße', highway: 'secondary' }, geometry: line(uv([0, 120], [300, 180], [620, 160], [W, 240])) },
  { props: { kind: 'track', highway: 'track', tracktype: 'grade2' }, geometry: line(uv([620, 160], [600, 400], [640, 700], [700, H])) },
  { props: { kind: 'water', name: 'Fixturebach' }, geometry: line(uv([0, 820], [200, 760], [420, 800], [700, 760], [W, 820])) },
  { props: { kind: 'barrier' }, geometry: { type: 'LineString', coordinates: densifyLine(circle(FEATURES.foundation.u, FEATURES.foundation.v, 28)) } },
  { props: { kind: 'rail' }, geometry: line(uv([0, 960], [W, 900])) },
  {
    props: { kind: 'path', highway: 'footway' },
    geometry: {
      type: 'MultiLineString',
      coordinates: [densifyLine(circle(FEATURES.ring.u, FEATURES.ring.v, 30)), densifyLine(uv([520, 640], [580, 665]))],
    },
  },
].map((f, k) => ({ type: 'Feature', properties: { ...f.props, osm_id: `way/${k + 1}` }, geometry: f.geometry }));

const parcelLines: Array<{ type: string; properties: { kind: string }; geometry: unknown }> = [];
for (let k = 0; k <= 10; k++) {
  for (const seg of [uv([k * 100, 0], [k * 100, H]), uv([0, k * 100], [W, k * 100])]) {
    parcelLines.push({ type: 'Feature', properties: { kind: 'parcel' }, geometry: line(seg) });
  }
}
const parcelLabels: unknown[] = [];
for (let ix = 0; ix < W / 100; ix++) {
  for (let iy = 0; iy < H / 100; iy++) {
    const n = 100 + ix * 10 + iy;
    parcelLabels.push({
      type: 'Feature',
      properties: { text: iy % 3 === 0 ? `${n}/${iy + 1}` : `${n}`, flstkennz: `FIX${n}`, gemarkung: 'Fixturedorf', flur: ix < 5 ? 'Flur 1' : 'Flur 2', lage: 'Testgelände' },
      geometry: { type: 'Point', coordinates: utm(ix * 100 + 50, iy * 100 + 50) },
    });
  }
}
const writeFc = (name: string, features: unknown[]) => {
  mkdirSync(join(OUT, 'vectors'), { recursive: true });
  writeFileSync(join(OUT, 'vectors', name), JSON.stringify({ type: 'FeatureCollection', features }));
};
writeFc('osm.geojson', osmFeatures);
// Parcel polygons (contract `flurstuecke.polygons`, POLISH): one square per 100 m cell with the same
// properties as its label, 2D [E, N], ALKIS-like ring order (no densification). Cell (3, 3) has a
// 20 m hole that is its own parcel ("Insel", appended last) — exercises holes + file order.
const HOLE = { u0: 310, v0: 310, u1: 330, v1: 330 };
const sq = (u0: number, v0: number, u1: number, v1: number): Pt[] => uv([u0, v0], [u1, v0], [u1, v1], [u0, v1], [u0, v0]).map(([e, n]) => [r2(e), r2(n)] as Pt);
const parcelPolygons: unknown[] = [];
for (let ix = 0; ix < W / 100; ix++) {
  for (let iy = 0; iy < H / 100; iy++) {
    const n = 100 + ix * 10 + iy;
    const nen = iy % 3 === 0 ? String(iy + 1) : '';
    const holed = ix === 3 && iy === 3;
    const outer = sq(ix * 100, iy * 100, ix * 100 + 100, iy * 100 + 100);
    parcelPolygons.push({
      type: 'Feature',
      properties: {
        flstkennz: `FIX${n}`, gemarkung: 'Fixturedorf', flur: ix < 5 ? 'Flur 1' : 'Flur 2', zae: String(n), ...(nen ? { nen } : {}),
        text: nen ? `${n}/${nen}` : `${n}`, lage: 'Testgelände', flaeche_m2: holed ? 9600 : 10000,
      },
      geometry: { type: 'Polygon', coordinates: holed ? [outer, sq(HOLE.u0, HOLE.v0, HOLE.u1, HOLE.v1).reverse()] : [outer] },
    });
  }
}
parcelPolygons.push({
  type: 'Feature',
  properties: { flstkennz: 'FIX999', gemarkung: 'Fixturedorf', flur: 'Flur 1', zae: '999', text: '999', lage: 'Insel (Fixture)', flaeche_m2: 400 },
  geometry: { type: 'MultiPolygon', coordinates: [[sq(HOLE.u0, HOLE.v0, HOLE.u1, HOLE.v1)]] },
});
parcelLines.push({ type: 'Feature', properties: { kind: 'parcel' }, geometry: line(sq(HOLE.u0, HOLE.v0, HOLE.u1, HOLE.v1)) });
parcelLabels.push({
  type: 'Feature',
  properties: { text: '999', flstkennz: 'FIX999', gemarkung: 'Fixturedorf', flur: 'Flur 1', lage: 'Insel (Fixture)' },
  geometry: { type: 'Point', coordinates: utm((HOLE.u0 + HOLE.u1) / 2, (HOLE.v0 + HOLE.v1) / 2) },
});
writeFc('flurstuecke.geojson', parcelLines);
writeFc('flurstuecke_labels.geojson', parcelLabels);
writeFc('flurstuecke_polygons.geojson', parcelPolygons);
const vectors = {
  osm: { path: 'vectors/osm.geojson', crs: 'EPSG:25832', featureCount: osmFeatures.length, label_de: 'Wege & Straßen (OSM)', source: 'Synthetisch (Fixture)' },
  flurstuecke: {
    path: 'vectors/flurstuecke.geojson',
    labels: 'vectors/flurstuecke_labels.geojson',
    polygons: 'vectors/flurstuecke_polygons.geojson',
    crs: 'EPSG:25832',
    featureCount: parcelLines.length,
    label_de: 'Flurstücke',
    source: 'Synthetisch (Fixture)',
  },
};

// --- Buildings (F11): gabled houses as glb per level-0 chunk (contract "Models") -------------
const housesByChunk = new Map<string, typeof FIXTURE_HOUSES>();
for (const h of FIXTURE_HOUSES) {
  const key = houseChunk(h).join('_');
  housesByChunk.set(key, [...(housesByChunk.get(key) ?? []), h]);
}
mkdirSync(join(OUT, 'models/buildings'), { recursive: true });
for (const [key, hs] of housesByChunk) writeFileSync(join(OUT, `models/buildings/${key}.glb`), encodeGlb(buildingMesh(hs)));
const models = {
  buildings: {
    path: 'models/buildings/{i}_{j}.glb',
    chunks: [...housesByChunk.keys()].map((k) => k.split('_').map(Number)),
    frame: 'local',
    featureCount: FIXTURE_HOUSES.length,
    label_de: 'Gebäude (LoD2)',
    source: 'Synthetisch (Fixture)',
  },
};

// --- Relict candidates (F15, docs/data-contract.md "Candidates") ---------------------------
// Synthetic detector output on the fixture features (pits, ring ditch + inner mound, foundation,
// hollow way under the OSM path) plus two low-score decoys, heights baked from the analytic DTM.
type Pt3 = [number, number, number];
const bake = (u: number, v: number): Pt3 => [r2(E0 + u), r2(N0 + v), r2(fixtureHeight(u, v))];
const ringUV = (u: number, v: number, radius: number, n: number): Pt3[] =>
  Array.from({ length: n + 1 }, (_, k) => bake(u + radius * Math.cos((2 * Math.PI * (k % n)) / n), v + radius * Math.sin((2 * Math.PI * (k % n)) / n)));
const ringN = (radius: number) => Math.max(12, Math.ceil((2 * Math.PI * radius) / 1.9));
const fnd = FEATURES.foundation;
const fndRing = (): Pt3[] => {
  const a = (fnd.rotDeg * Math.PI) / 180;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([sx, sy]) => {
    const lx = (sx * fnd.w) / 2;
    const ly = (sy * fnd.h) / 2;
    return [fnd.u + lx * Math.cos(a) - ly * Math.sin(a), fnd.v + lx * Math.sin(a) + ly * Math.cos(a)];
  });
  const out: Pt3[] = [];
  for (let k = 1; k < corners.length; k++) {
    const [x0, y0] = corners[k - 1];
    const [x1, y1] = corners[k];
    const m = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 1.9);
    for (let s = k === 1 ? 0 : 1; s <= m; s++) out.push(bake(x0 + ((x1 - x0) * s) / m, y0 + ((y1 - y0) * s) / m));
  }
  return out;
};
const hwLine = (): Pt3[] => {
  const m = Math.ceil(Math.hypot(hw.u1 - hw.u0, hw.v1 - hw.v0) / 1.9);
  return Array.from({ length: m + 1 }, (_, s) => bake(hw.u0 + ((hw.u1 - hw.u0) * s) / m, hw.v0 + ((hw.v1 - hw.v0) * s) / m));
};
interface FixtureCandidate { cls: string; u: number; v: number; score: number; metrics: Record<string, number>; reasons: string[]; near_path?: boolean; along_path?: boolean; near_known?: string | null; outline?: { type: string; coordinates: Pt3[] | Pt3[][] } }
const ring = FEATURES.ring;
const candList: FixtureCandidate[] = [
  ...FEATURES.pits.map((p, k) => ({
    cls: 'pit', u: p.u, v: p.v, score: r2(0.86 - k * 0.07),
    metrics: { depth_m: p.depth, diameter_m: p.d, area_m2: r2(Math.PI * (p.d / 2) ** 2), circularity: 0.93, rim_m: 0.15 },
    reasons: [`rund, ${p.d} m Ø, ${p.depth.toLocaleString('de-DE')} m tief`, 'mit Randwall', ...(k < 4 ? ['Teil einer Reihe'] : [])],
    near_path: k === 0,
    outline: { type: 'Polygon', coordinates: [ringUV(p.u, p.v, p.d / 2, ringN(p.d / 2))] },
  })),
  {
    cls: 'linear', u: ring.u + ring.radius, v: ring.v, score: 0.81,
    metrics: { length_m: r2(2 * Math.PI * ring.radius), width_m: ring.width, depth_m: ring.depth, orientation_deg: 0 },
    reasons: ['geschlossener Ringgraben', '1 m tief'], near_known: null,
    outline: { type: 'LineString', coordinates: ringUV(ring.u, ring.v, ring.radius, ringN(ring.radius)) },
  },
  {
    cls: 'mound', u: ring.u, v: ring.v, score: 0.58,
    metrics: { height_m: ring.moundHeight, diameter_m: 2 * (ring.radius - 4), circularity: 0.97 },
    reasons: ['flache Kuppe im Ringgraben'],
    // no outline: the app draws a circle of diameter_m
  },
  {
    cls: 'rect', u: fnd.u, v: fnd.v, score: 0.9,
    metrics: { area_m2: fnd.w * fnd.h, rectangularity: 0.96, length_m: fnd.w, width_m: fnd.h, orientation_deg: 90 - fnd.rotDeg, height_m: fnd.height },
    reasons: ['rechteckig, 30 × 20 m', 'gerade Kanten, Innenwand'],
    outline: { type: 'Polygon', coordinates: [fndRing()] },
  },
  {
    cls: 'linear', u: (hw.u0 + hw.u1) / 2, v: (hw.v0 + hw.v1) / 2, score: 0.74,
    metrics: { length_m: r2(Math.hypot(hw.u1 - hw.u0, hw.v1 - hw.v0)), width_m: hw.width, depth_m: hw.depth, orientation_deg: r2((Math.atan2(hw.u1 - hw.u0, hw.v1 - hw.v0) * 180) / Math.PI) },
    reasons: ['Hohlweg, 0,6 m tief', 'gerade über 500 m'], near_path: true, along_path: true,
    outline: { type: 'LineString', coordinates: hwLine() },
  },
  {
    cls: 'platform', u: 300, v: 700, score: 0.24,
    metrics: { diameter_m: 12, area_m2: 113, circularity: 0.8, slope_in_deg: 2.1 },
    reasons: ['flach, 12 m Ø', 'Testfall: niedriger Score'],
  },
  {
    cls: 'pit', u: 820, v: 180, score: 0.12,
    metrics: { depth_m: 0.31, diameter_m: 3, area_m2: 7.07, circularity: 0.6 },
    reasons: ['schwach, 0,3 m tief', 'Testfall: niedriger Score'],
  },
];
const candIds = new Map<string, number>();
const candFeatures = candList
  .sort((a, b) => b.score - a.score)
  .map((c) => {
    const [E, N, z] = bake(c.u, c.v);
    let id = `${c.cls}-${Math.round(E)}-${Math.round(N)}`;
    const n = (candIds.get(id) ?? 0) + 1;
    candIds.set(id, n);
    if (n > 1) id = `${id}-${n}`;
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [E, N, z] },
      properties: {
        id, class: c.cls, score: c.score, metrics: c.metrics, reasons: c.reasons,
        forest: fixtureCanopy(c.u, c.v) >= 3, near_path: c.near_path ?? false, along_path: c.along_path ?? false, near_known: c.near_known ?? null,
        ...(c.outline ? { outline: c.outline } : {}),
      },
    };
  });
mkdirSync(join(OUT, 'candidates'), { recursive: true });
writeFileSync(join(OUT, 'candidates/candidates.geojson'), JSON.stringify({ type: 'FeatureCollection', features: candFeatures }));
const candCounts: Record<string, number> = {};
for (const f of candFeatures) candCounts[f.properties.class] = (candCounts[f.properties.class] ?? 0) + 1;
const candidates = {
  path: 'candidates/candidates.geojson',
  crs: 'EPSG:25832',
  featureCount: candFeatures.length,
  heights: 'baked',
  counts: candCounts,
  method: 'fixture',
  version: 1,
  generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  params: { note: 'synthetisch, keine Erkennung' },
  label_de: 'Verdachtsflächen',
};

// --- Point clouds (F16, docs/data-contract.md "Point clouds") ----------------------------------
const pcAreas = FIXTURE_POINT_AREAS.map((a) => {
  const tiles = fixturePointTiles(a, dtm);
  const dir = join(OUT, 'pointclouds', a.id);
  mkdirSync(dir, { recursive: true });
  const classCounts: Record<string, number> = {};
  let hMin = Infinity;
  let hMax = -Infinity;
  for (const t of tiles) {
    writeFileSync(join(dir, `${t.tx}_${t.ty}.bin`), new Uint8Array(t.buf));
    for (const [k, n] of Object.entries(t.classCounts)) classCounts[k] = (classCounts[k] ?? 0) + n;
    hMin = Math.min(hMin, t.hMin);
    hMax = Math.max(hMax, t.hMax);
  }
  const pointCount = tiles.reduce((s, t) => s + t.count, 0);
  const bbox = [E0 + a.u0, N0 + a.v0, E0 + a.u1, N0 + a.v1];
  return {
    id: a.id,
    name_de: a.name_de,
    bbox,
    tiles: tiles.map((t) => [t.tx, t.ty, t.count]),
    path: `pointclouds/${a.id}/{tx}_{ty}.bin`,
    pointCount,
    density_per_m2: Math.round((pointCount / ((a.u1 - a.u0) * (a.v1 - a.v0))) * 100) / 100,
    classCounts,
    heightRange: { min: Math.round(hMin * 100) / 100, max: Math.round(hMax * 100) / 100 },
    intensityMax: 255,
    source: ['synthetic'],
  };
});
const pointclouds = {
  format: 'sle-pts-v1',
  tileSize: POINT_TILE,
  crs: 'EPSG:25832',
  areas: pcAreas,
  classes: { '1': 'Unklassifiziert', '2': 'Boden', '6': 'Gebäude', '20': 'Sonstige', '30': 'Füllpunkte (synthetisch)' },
};
console.log(`fixture: point clouds ${pcAreas.map((a) => `${a.id} ${a.tiles.length} tiles / ${a.pointCount} pts`).join(', ')}`);

// --- Manifest -----------------------------------------------------------------------
let hmin = Infinity;
let hmax = -Infinity;
for (const h of dtm) {
  if (h < hmin) hmin = h;
  if (h > hmax) hmax = h;
}
const sw = utmToWgs84(E0, N0);
const ne = utmToWgs84(E0 + W, N0 + H);
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
const topLayers = Object.fromEntries(
  layers.map((L) => [
    L.key,
    {
      path: `relief/${L.key}/{i}_{j}.png`,
      encoding: 'u8',
      min: L.min,
      max: L.max,
      ...(L.unit ? { unit: L.unit } : {}),
      label_de: L.label_de,
      description: L.description,
    },
  ]),
);
Object.assign(topLayers, imageTop);
const dtmSource = { path: 'dtm/{i}_{j}.png', encoding: 'terrarium', apron: 1 };
const dsmSource = { path: 'dsm/{i}_{j}.png', encoding: 'terrarium', apron: 1 };
const manifest = {
  version: 2,
  aoi: 'fixture',
  name: 'Synthetisches Testgelände',
  crs: 'EPSG:25832',
  origin: { E0, N0 },
  size: { width: W, height: H },
  cellSize: 1,
  chunkSize: CS,
  chunks: { nx, ny },
  heightRange: { min: round(hmin, 2), max: round(hmax, 2) },
  wgs84Bounds: [
    [round(sw.lat, 5), round(sw.lon, 5)],
    [round(ne.lat, 5), round(ne.lon, 5)],
  ],
  height: { dtm: dtmSource, dsm: dsmSource },
  layers: topLayers,
  vectors,
  models,
  candidates,
  pointclouds,
  levels: [
    { level: 0, cellSize: 1, chunkSize: CS, size: { width: W, height: H }, chunks: { nx, ny }, height: { dtm: dtmSource }, layers: topLayers },
    ...levelEntries,
  ],
  sources: [{ tile: 'synthetic', provider: 'make-fixture.ts', year: 2026, product: 'procedural' }],
  attribution: 'Synthetische Testdaten (make-fixture.ts) — keine echten Geodaten',
  fixtureFeatures: FEATURES,
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`fixture: ${nx * ny} chunks + ${LEVEL_COUNT} overview levels, ${layers.length} layers, h ${hmin.toFixed(1)}–${hmax.toFixed(1)} m`);
