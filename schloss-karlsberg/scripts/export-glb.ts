/**
 * Export one glb per building and LOD (+ site features) into model/out/ in the explorer local frame
 * (x = E − 381000, y = h true DHHN2016, z = −(N − 5465000)), plus model/out/index.json (docs/architecture.md §6).
 *
 *   pnpm run export            # all placed buildings
 *   pnpm run export -- KB-B01  # selected ids
 *
 * Runs three's GLTFExporter in Node (FileReader polyfill below) and checks every file with a GLTFLoader parse
 * round-trip (mesh and triangle counts must match). Terrain heights for plinths come from
 * viewer/public/terrain/dtm1789.f32 when present (run scripts/prepare-terrain.py first), else NaN (plinth to base_h).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { E0, N0, isPlaced, loadSite } from '../model/src/index.ts';
import { type BuildContext, DEFAULT_BUILD_OPTIONS, makeLayoutFn } from '../model/src/context.ts';
import { createMaterials } from '../model/src/materials/index.ts';
import { buildExterior } from '../model/src/exterior/index.ts';
import { siteBuildings, sitePois } from '../model/src/site/index.ts';
import { buildFeatures } from '../model/src/site/features.ts';

// ---------------------------------------------------------------- Node polyfills for GLTFExporter
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  onload: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((b) => {
      this.result = b;
      this.onload?.();
      this.onloadend?.();
    });
  }
  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then((b) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`;
      this.onload?.();
      this.onloadend?.();
    });
  }
}
(globalThis as unknown as { FileReader: unknown }).FileReader ??= NodeFileReader;

const warn = console.warn;
console.warn = (...a: unknown[]) => {
  if (typeof a[0] === 'string' && a[0].includes('normalized normal attribute')) return;
  warn(...a);
};

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'model/out');
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- catalogue + terrain
const raw = JSON.parse(readFileSync(resolve(ROOT, 'model/catalogue.json'), 'utf8')) as unknown;
const { spec } = loadSite(raw);

function terrainSampler(): (x: number, z: number) => number {
  const dir = resolve(ROOT, 'viewer/public/terrain');
  if (!existsSync(resolve(dir, 'meta.json'))) {
    console.warn('[export] no viewer/public/terrain - plinths stop at base_h');
    return () => NaN;
  }
  const meta = JSON.parse(readFileSync(resolve(dir, 'meta.json'), 'utf8'));
  const buf = readFileSync(resolve(dir, meta.files.dtm1789));
  const h = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const g = meta.grid;
  return (x, z) => {
    const c = (x + E0 - g.west) / g.cell - 0.5;
    const r = (g.north - (N0 - z)) / g.cell - 0.5;
    if (c < 0 || r < 0 || c > g.cols - 1 || r > g.rows - 1) return NaN;
    const c0 = Math.min(g.cols - 2, Math.floor(c));
    const r0 = Math.min(g.rows - 2, Math.floor(r));
    const fc = c - c0;
    const fr = r - r0;
    const i = r0 * g.cols + c0;
    const a = h[i] + (h[i + 1] - h[i]) * fc;
    const b = h[i + g.cols] + (h[i + g.cols + 1] - h[i + g.cols]) * fc;
    return a + (b - a) * fr;
  };
}

const materials = createMaterials(); // no textures in Node: material names + PBR values only
const base = {
  spec,
  materials,
  terrain: terrainSampler(),
  options: { ...DEFAULT_BUILD_OPTIONS },
  layout: makeLayoutFn(spec, { roofVariant: DEFAULT_BUILD_OPTIONS.roofVariant }),
};
const ctx = (lod: 0 | 1 | 2): BuildContext => ({ ...base, lod });

// ---------------------------------------------------------------- export helpers
const exporter = new GLTFExporter();
const loader = new GLTFLoader();

function stats(o: THREE.Object3D): { meshes: number; triangles: number } {
  let meshes = 0;
  let triangles = 0;
  o.traverseVisible((x) => {
    const m = x as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const g = m.geometry;
    const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    triangles += n * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1);
  });
  return { meshes, triangles };
}

async function writeGlb(obj: THREE.Object3D, file: string): Promise<{ bytes: number; meshes: number; triangles: number }> {
  const scene = new THREE.Scene();
  scene.add(obj);
  scene.updateMatrixWorld(true);
  const before = stats(scene);
  const glb = (await exporter.parseAsync(scene, { binary: true, onlyVisible: true })) as ArrayBuffer;
  writeFileSync(resolve(OUT, file), Buffer.from(glb));
  // round trip
  const gltf = await loader.parseAsync(glb.slice(0), '');
  const after = stats(gltf.scene);
  if (after.meshes !== before.meshes || Math.abs(after.triangles - before.triangles) > 0.5) {
    throw new Error(`${file}: round trip mismatch (meshes ${before.meshes} -> ${after.meshes}, triangles ${before.triangles} -> ${after.triangles})`);
  }
  return { bytes: glb.byteLength, ...after };
}

// ---------------------------------------------------------------- main
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const buildings = siteBuildings(spec, base).filter((b) => !only.length || only.includes(b.id));
console.log(`[export] catalogue v${spec.version}: ${spec.buildings.filter(isPlaced).length} placed, scene year ${base.options.year} (epoch filter), exporting ${buildings.length}`);

interface IndexEntry {
  id: string;
  name_de: string;
  cls: string;
  confidence: string;
  placement: string;
  lods: Record<string, string>;
  bbox_local: [[number, number, number], [number, number, number]];
  eaves_h: number;
  ridge_h: number;
  interior: string;
  sources: string[];
  triangles: Record<string, number>;
}
const index: IndexEntry[] = [];
let total = 0;
for (const b of buildings) {
  const lods: Record<string, string> = {};
  const tris: Record<string, number> = {};
  let bbox: THREE.Box3 | null = null;
  const want: (0 | 1 | 2)[] = b.interior !== 'none' || b.priority <= 1 ? [0, 1, 2] : [0, 1];
  for (const lod of want) {
    const g = buildExterior(b, ctx(lod));
    if (lod === 0) bbox = new THREE.Box3().setFromObject(g);
    const file = `${b.id}.lod${lod}.glb`;
    const r = await writeGlb(g, file);
    lods[String(lod)] = file;
    tris[String(lod)] = r.triangles;
    total += r.bytes;
  }
  const L = base.layout(b);
  const bb = bbox ?? new THREE.Box3();
  const rnd = (v: number) => Math.round(v * 100) / 100;
  index.push({
    id: b.id,
    name_de: b.name_de,
    cls: b.cls,
    confidence: b.confidence,
    placement: b.placement,
    lods,
    bbox_local: [
      [rnd(bb.min.x), rnd(bb.min.y), rnd(bb.min.z)],
      [rnd(bb.max.x), rnd(bb.max.y), rnd(bb.max.z)],
    ],
    eaves_h: rnd(L.stack.eaves_h),
    ridge_h: rnd(L.roof.ridge_h),
    interior: b.interior,
    sources: b.sources ?? [],
    triangles: tris,
  });
  process.stdout.write(`  ${b.id} ${Object.keys(lods).map((k) => `lod${k} ${tris[k]}`).join(' · ')}\n`);
}

const siteLods: Record<string, string> = {};
if (!only.length) {
  for (const lod of [0, 1] as const) {
    const f = buildFeatures(spec, ctx(lod));
    f.group.name = 'site';
    const file = `site.lod${lod}.glb`;
    const r = await writeGlb(f.group, file);
    siteLods[String(lod)] = file;
    total += r.bytes;
    console.log(`  site lod${lod}: ${r.meshes} meshes, ${Math.round(r.triangles)} triangles`);
  }
}

const pois = sitePois(spec, ctx(1)).map((p) => ({ id: p.id, name_de: p.name_de, kind: p.kind, position: [p.position.x, p.position.y, p.position.z].map((v) => Math.round(v * 100) / 100), buildingId: p.buildingId }));
const out = {
  version: 1,
  generated: new Date().toISOString(),
  frame: { crs: 'EPSG:25832', E0, N0, height_datum: 'DHHN2016', local: 'x = E - E0, y = h, z = -(N - N0)' },
  time_slice: 'summer 1789',
  catalogue_version: spec.version,
  buildings: index,
  site: { lods: siteLods },
  pois,
  attribution: [
    'Rekonstruktion (Hypothese): Schloss-Karlsberg-Teilprojekt (research/01-08, model/catalogue.json v2)',
    'Texturen: Poly Haven (CC0) - nicht eingebettet, Materialnamen nach docs/architecture.md §3.6',
    'Gelände: GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (Sockelhöhen aus dem DGM1)',
  ],
};
if (only.length && existsSync(resolve(OUT, 'index.json'))) {
  // merge into an existing index
  const prev = JSON.parse(readFileSync(resolve(OUT, 'index.json'), 'utf8'));
  const keep = (prev.buildings as IndexEntry[]).filter((e) => !only.includes(e.id));
  out.buildings = [...keep, ...index];
  out.site = prev.site;
}
writeFileSync(resolve(OUT, 'index.json'), JSON.stringify(out, null, 1));
console.log(`[export] ${index.length} buildings, ${(total / 1e6).toFixed(1)} MB -> model/out/ (round trip OK)`);
