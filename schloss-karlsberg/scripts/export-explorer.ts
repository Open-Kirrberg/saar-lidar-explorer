/**
 * Light reconstruction layer for the Saar LiDAR Explorer (format sle-recon-v1, docs/explorer-integration.md):
 *
 *   pnpm run export:explorer                 # -> ../app/public/data/shared/karlsberg1789/
 *   pnpm run export:explorer -- --out <dir>
 *
 * Writes buildings.glb (one node + mesh per building, node.name = building id, plus one `site:<featureId>` node per stone site feature; identity
 * transforms; positions in the explorer local frame x = E − 381000, y = h true DHHN2016, z = −(N − 5465000);
 * LOD1 exteriors without window frames / ironwork; vertex colours COLOR_0 (linear) baked from the material colours,
 * NORMAL, per-vertex u8 `_CONF` (0 low, 1 med, 2 high); EXT_meshopt_compression + KHR_mesh_quantization for
 * normals/colours, float positions), footprints.geojson (EPSG:25832) and index.json.
 *
 * Base skirts: the explorer shows the 2025 terrain (with ruin pits). Every building gets vertical walls from its
 * plinth down to min(2025 DTM under/around the footprint) − 0.5 m (viewer/public/terrain/dtm2025.f32).
 * The file is checked by a round trip through three's GLTFLoader + MeshoptDecoder (node names, triangles,
 * attributes, identity transforms, bounding boxes).
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder as ThreeMeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { Document, NodeIO, type Accessor } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { quantize, reorder, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { loadSite } from '../model/src/index.ts';
import { type BuildContext, DEFAULT_BUILD_OPTIONS, makeLayoutFn } from '../model/src/context.ts';
import { createMaterials } from '../model/src/materials/index.ts';
import { buildExterior, offsetRing, palette } from '../model/src/exterior/index.ts';
import { siteBuildings } from '../model/src/site/index.ts';
import { buildFeatures } from '../model/src/site/features.ts';
import { stToLocal } from '../model/src/layout/footprint.ts';
import type { BuildingLayout } from '../model/src/layout/building.ts';
import type { ST } from '../model/src/spec.ts';
import {
  type ReconBuildingEntry,
  buildReconIndex,
  confCode,
  footprintsGeoJson,
  gridSampler,
  minSampler,
  minUnderRing,
  round,
  shortSources,
  skirtBottom,
  skirtWalls,
} from '../model/src/explorer/export.ts';

const warn = console.warn;
console.warn = (...a: unknown[]) => {
  if (typeof a[0] === 'string' && a[0].includes('normalized normal attribute')) return;
  warn(...a);
};

const ROOT = resolve(import.meta.dirname, '..');
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 && process.argv[outArg + 1] ? resolve(process.argv[outArg + 1]) : resolve(ROOT, '../app/public/data/shared/karlsberg1789');

/** Materials left out of the light model (thin detail; ~300 k of 645 k LOD1 triangles are window frames). */
const DROP_MATERIALS = new Set(['wood.frame', 'metal.iron']);
/** How far the skirt reaches up into the plinth (hidden behind the 0.08 m plinth projection). */
const SKIRT_OVERLAP = 0.3;
const SKIRT_INSET = 0.06;

// ---------------------------------------------------------------- catalogue + terrain
const { spec } = loadSite(JSON.parse(readFileSync(resolve(ROOT, 'model/catalogue.json'), 'utf8')) as unknown);
const tdir = resolve(ROOT, 'viewer/public/terrain');
if (!existsSync(resolve(tdir, 'meta.json'))) {
  console.error('[export:explorer] viewer/public/terrain/meta.json missing - run scripts/prepare-terrain.py first (README)');
  process.exit(1);
}
const meta = JSON.parse(readFileSync(resolve(tdir, 'meta.json'), 'utf8'));
const f32 = (name: string) => {
  const b = readFileSync(resolve(tdir, name));
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};
const t1789 = gridSampler(meta.grid, f32(meta.files.dtm1789));
const t2025 = gridSampler(meta.grid, f32(meta.files.dtm2025));

const base = {
  spec,
  materials: createMaterials(),
  terrain: t1789,
  options: { ...DEFAULT_BUILD_OPTIONS },
  layout: makeLayoutFn(spec, { roofVariant: DEFAULT_BUILD_OPTIONS.roofVariant }),
};
const ctx = (lod: 0 | 1 | 2, terrain = t1789): BuildContext => ({ ...base, terrain, lod });

// ---------------------------------------------------------------- geometry collection
class Buf {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  conf: number[] = [];
  idx: number[] = [];
  get vertices(): number {
    return this.pos.length / 3;
  }
  add(position: ArrayLike<number>, normal: ArrayLike<number>, index: ArrayLike<number> | null, colour: THREE.Color, conf: number): void {
    const v0 = this.vertices;
    const n = position.length / 3;
    for (let i = 0; i < n * 3; i++) {
      this.pos.push(position[i]);
      this.nrm.push(normal[i]);
    }
    for (let i = 0; i < n; i++) {
      this.col.push(colour.r, colour.g, colour.b);
      this.conf.push(conf);
    }
    if (index) for (let i = 0; i < index.length; i++) this.idx.push(v0 + index[i]);
    else for (let i = 0; i < n; i++) this.idx.push(v0 + i);
  }
  addMesh(m: THREE.Mesh, colour: THREE.Color, conf: number): void {
    const g = m.geometry;
    const p = g.attributes.position;
    if (!g.attributes.normal) g.computeVertexNormals();
    const nAttr = g.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(m.matrixWorld);
    const v = new THREE.Vector3();
    const pos = new Float32Array(p.count * 3);
    const nrm = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      pos.set([v.x, v.y, v.z], i * 3);
      v.fromBufferAttribute(nAttr, i).applyMatrix3(nm).normalize();
      nrm.set([v.x, v.y, v.z], i * 3);
    }
    this.add(pos, nrm, g.index ? g.index.array : null, colour, conf);
  }
  box(): [[number, number, number], [number, number, number]] {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.pos.length; i += 3)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], this.pos[i + k]);
        hi[k] = Math.max(hi[k], this.pos[i + k]);
      }
    return [lo.map((x) => round(x, 2)) as [number, number, number], hi.map((x) => round(x, 2)) as [number, number, number]];
  }
}

function meshColour(m: THREE.Mesh): { name: string; colour: THREE.Color } {
  const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
  // three's Color holds linear (working colour space) values: exactly what COLOR_0 wants
  return { name: (m.userData.material as string | undefined) ?? mat.name, colour: mat.color?.clone() ?? new THREE.Color(1, 1, 1) };
}

/** Plan outline the exterior walls follow (same rule as exterior/index.ts outline()). */
function outlineST(L: BuildingLayout): ST[] {
  const f = L.frame;
  if (f.shape === 'rect') {
    const l = f.length / 2;
    const w = f.width / 2;
    return [
      [-l, -w],
      [l, -w],
      [l, w],
      [-l, w],
    ];
  }
  if (f.shape === 'round') {
    const r = f.radius ?? f.width / 2;
    return Array.from({ length: 32 }, (_, i): ST => [r * Math.cos((i / 32) * Math.PI * 2), r * Math.sin((i / 32) * Math.PI * 2)]);
  }
  const r = f.ringST.slice();
  const a = r[0];
  const b = r[r.length - 1];
  if (r.length > 1 && a[0] === b[0] && a[1] === b[1]) r.pop();
  return r;
}

// ---------------------------------------------------------------- build
const buildings = siteBuildings(spec, base);
console.log(`[export:explorer] catalogue v${spec.version}: ${buildings.length} buildings -> ${OUT}`);
const nodes: { name: string; buf: Buf; extras: Record<string, string> }[] = [];
const entries: ReconBuildingEntry[] = [];
const footprints: Parameters<typeof footprintsGeoJson>[0] = [];
const dropped = new Map<string, number>();
const notes: string[] = [];
let skirtCount = 0;
let skirtDeepest = { id: '', depth: 0 };

for (const b of buildings) {
  const L = base.layout(b);
  let g: THREE.Group;
  let lod: 0 | 1 = 1;
  try {
    g = buildExterior(b, ctx(1));
  } catch (e) {
    notes.push(`${b.id}: LOD1 failed (${String(e)}), LOD0 used`);
    g = buildExterior(b, ctx(0));
    lod = 0;
  }
  const root = new THREE.Group();
  root.add(g);
  root.updateMatrixWorld(true);
  const buf = new Buf();
  const conf = confCode(b.confidence);
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const { name, colour } = meshColour(m);
    if (DROP_MATERIALS.has(name)) {
      const g2 = m.geometry;
      dropped.set(name, (dropped.get(name) ?? 0) + (g2.index ? g2.index.count : g2.attributes.position.count) / 3);
      return;
    }
    buf.addMesh(m, colour, conf);
  });
  if (!buf.vertices) {
    notes.push(`${b.id}: no geometry`);
    continue;
  }
  // base skirt down to the 2025 terrain
  let plinthBottom = Infinity;
  for (let i = 1; i < buf.pos.length; i += 3) plinthBottom = Math.min(plinthBottom, buf.pos[i]);
  let bottom = skirtBottom(minUnderRing(L.ring, t2025));
  if (!Number.isFinite(bottom)) {
    bottom = skirtBottom(minUnderRing(L.ring, t1789));
    notes.push(`${b.id}: no 2025 DTM under the footprint, skirt to the 1789 terrain`);
  }
  if (Number.isFinite(bottom) && bottom < plinthBottom) {
    const ring = offsetRing(outlineST(L), -SKIRT_INSET).map(([s, t]): [number, number] => {
      const p = stToLocal(L.frame, s, t, 0);
      return [p.x, p.z];
    });
    const sk = skirtWalls(ring, bottom, plinthBottom + SKIRT_OVERLAP);
    buf.add(sk.position, sk.normal, null, new THREE.Color(palette(b, ctx(1)).colours.plinth), conf);
    skirtCount++;
    if (plinthBottom - bottom > skirtDeepest.depth) skirtDeepest = { id: b.id, depth: plinthBottom - bottom };
  }
  nodes.push({ name: b.id, buf, extras: { id: b.id, kind: "building", confidence: b.confidence } });
  entries.push({
    id: b.id,
    name_de: b.name_de,
    cls: b.cls,
    confidence: b.confidence,
    eaves_h: round(L.stack.eaves_h, 2),
    ridge_h: round(L.roof.ridge_h, 2),
    bbox_local: buf.box(),
    sources_de: shortSources(b.sources),
  });
  footprints.push({ id: b.id, name_de: b.name_de, confidence: b.confidence, ring: L.ring });
  if (lod !== 1) notes.push(`${b.id}: LOD${lod}`);
}

// site: retaining / terrace walls, scarps, cascade, wells (stone only; no hedges, water, tubs or trees). Built on
// min(1789, 2025) terrain so wall feet reach the lower of both grounds. One node per feature (`site:<featureId>`,
// the feature's own confidence) so the explorer can hide features that lie past its AOI edge (e.g. Karlslust).
{
  const siteCtx = ctx(1, minSampler(t1789, t2025));
  for (const f of spec.terrain_features) {
    const feat = buildFeatures({ ...spec, terrain_features: [f] }, siteCtx);
    feat.group.updateMatrixWorld(true);
    const buf = new Buf();
    const conf = confCode(f.confidence);
    feat.group.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh) return;
      const { name, colour } = meshColour(m);
      if (!name.startsWith('stone.')) return;
      buf.addMesh(m, colour, conf);
    });
    const id = `site:${f.id}`;
    if (buf.vertices) nodes.push({ name: id, buf, extras: { id, kind: 'site', confidence: f.confidence } });
  }
}

// ---------------------------------------------------------------- glTF document
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const doc = new Document();
doc.getRoot().getAsset().generator = 'schloss-karlsberg scripts/export-explorer.ts (glTF-Transform)';
const buffer = doc.createBuffer();
const scene = doc.createScene('karlsberg1789');
doc.getRoot().setDefaultScene(scene);
const material = doc.createMaterial('karlsberg1789/vertex-colour').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.9).setMetallicFactor(0);
const acc = (name: string, type: 'SCALAR' | 'VEC3', array: Float32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint32Array<ArrayBuffer>): Accessor => doc.createAccessor(name).setType(type).setArray(array).setBuffer(buffer);
let trianglesIn = 0;
for (const { name, buf, extras } of nodes) {
  trianglesIn += buf.idx.length / 3;
  const prim = doc
    .createPrimitive()
    .setMaterial(material)
    .setAttribute('POSITION', acc(`${name}/position`, 'VEC3', Float32Array.from(buf.pos)))
    .setAttribute('NORMAL', acc(`${name}/normal`, 'VEC3', Float32Array.from(buf.nrm)))
    .setAttribute('COLOR_0', acc(`${name}/color`, 'VEC3', Float32Array.from(buf.col)))
    .setAttribute('_CONF', acc(`${name}/conf`, 'SCALAR', Uint8Array.from(buf.conf)))
    .setIndices(acc(`${name}/indices`, 'SCALAR', Uint32Array.from(buf.idx)));
  const mesh = doc.createMesh(name).addPrimitive(prim);
  // three.js strips ":" from node names (PropertyBinding.sanitizeNodeName): the id is also in extras -> userData
  scene.addChild(doc.createNode(name).setMesh(mesh).setExtras(extras));
}
await doc.transform(
  weld(),
  reorder({ encoder: MeshoptEncoder, target: 'size' }),
  // positions stay float32 so node transforms stay identity and heights exact (no dequantisation matrix)
  quantize({ pattern: /^(NORMAL|COLOR_0)$/, quantizeNormal: 8, quantizeColor: 8 }),
);
// normalized int8 NORMAL needs KHR_mesh_quantization (quantize() only declares it when POSITION is quantized)
doc.createExtension(KHRMeshQuantization).setRequired(true);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const glb = await io.writeBinary(doc);

// ---------------------------------------------------------------- round trip (three GLTFLoader + MeshoptDecoder)
await ThreeMeshoptDecoder.ready;
const loader = new GLTFLoader().setMeshoptDecoder(ThreeMeshoptDecoder);
const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
const gltf = await loader.parseAsync(ab, '');
const byName = new Map<string, THREE.Mesh>();
let trianglesOut = 0;
let vertsOut = 0;
gltf.scene.updateMatrixWorld(true);
gltf.scene.traverse((o) => {
  const m = o as THREE.Mesh;
  if (!m.isMesh) return;
  let id: string | undefined;
  for (let q: THREE.Object3D | null = m; q && !id; q = q.parent) id = q.userData.id as string | undefined;
  if (!id) throw new Error(`round trip: ${m.name} has no userData.id`);
  byName.set(id, m);
  for (let q: THREE.Object3D | null = m; q && q !== gltf.scene; q = q.parent) {
    if (!q.position.equals(new THREE.Vector3()) || !q.scale.equals(new THREE.Vector3(1, 1, 1)) || Math.abs(q.quaternion.w) !== 1)
      throw new Error(`round trip: ${q.name} has a non-identity transform`);
  }
  const g = m.geometry;
  for (const a of ['position', 'normal', 'color', '_conf']) if (!g.attributes[a]) throw new Error(`round trip: ${m.name} lacks ${a}`);
  trianglesOut += (g.index ? g.index.count : g.attributes.position.count) / 3;
  vertsOut += g.attributes.position.count;
});
for (const { name, buf } of nodes) {
  const m = byName.get(name);
  if (m && m.name !== THREE.PropertyBinding.sanitizeNodeName(name) && m.parent?.name !== THREE.PropertyBinding.sanitizeNodeName(name)) throw new Error(`round trip: ${name} named ${m.name}`);
  if (!m) throw new Error(`round trip: node ${name} missing (three names: ${[...byName.keys()].slice(0, 5).join(', ')} …)`);
  const bb = new THREE.Box3().setFromBufferAttribute(m.geometry.attributes.position as THREE.BufferAttribute);
  const want = buf.box();
  const err = Math.max(...[bb.min.x - want[0][0], bb.min.y - want[0][1], bb.min.z - want[0][2], bb.max.x - want[1][0], bb.max.y - want[1][1], bb.max.z - want[1][2]].map(Math.abs));
  if (err > 0.011) throw new Error(`round trip: ${name} bbox differs by ${err.toFixed(3)} m`);
  const conf = m.geometry.attributes._conf;
  const want0 = buf.conf[0];
  if (conf.getX(0) !== want0) throw new Error(`round trip: ${name} _CONF ${conf.getX(0)} != ${want0}`);
}
if (Math.abs(trianglesOut - trianglesIn) > 0.5) throw new Error(`round trip: triangles ${trianglesIn} -> ${trianglesOut}`);
{
  const j = gltf.parser.json as { extensionsUsed?: string[]; extensionsRequired?: string[] };
  for (const e of ["EXT_meshopt_compression", "KHR_mesh_quantization"]) if (!j.extensionsRequired?.includes(e)) throw new Error(`round trip: ${e} not required`);
}

// ---------------------------------------------------------------- write
mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'buildings.glb'), glb);
writeFileSync(resolve(OUT, 'footprints.geojson'), JSON.stringify(footprintsGeoJson(footprints)));
const cdl = buildings.find((b) => b.id === 'KB-B01');
const anchor = cdl ? base.layout(cdl).frame.centreEN : spec.palace_grid.origin_EN;
const index = buildReconIndex({
  anchorEN: anchor,
  buildings: entries,
  boxes: nodes.map((n) => n.buf.box()),
  generated: new Date().toISOString(),
  catalogueVersion: spec.version,
});
writeFileSync(resolve(OUT, 'index.json'), JSON.stringify(index, null, 1));

const mb = (f: string) => (statSync(resolve(OUT, f)).size / 1e6).toFixed(2);
console.log(`  nodes ${nodes.length} (${entries.length} buildings + ${nodes.length - entries.length} site), triangles ${trianglesOut}, vertices ${vertsOut}`);
console.log(`  skirts ${skirtCount}, deepest ${skirtDeepest.id} ${skirtDeepest.depth.toFixed(2)} m below the plinth`);
console.log(`  dropped: ${[...dropped].map(([k, v]) => `${k} ${v} tris`).join(', ') || '-'}`);
for (const n of notes) console.log(`  note: ${n}`);
console.log(`  anchor E ${index.anchor.E} N ${index.anchor.N}, bboxEN ${JSON.stringify(index.bboxEN)}`);
console.log(`[export:explorer] buildings.glb ${mb('buildings.glb')} MB · footprints.geojson ${mb('footprints.geojson')} MB · index.json ${mb('index.json')} MB (round trip OK)`);
