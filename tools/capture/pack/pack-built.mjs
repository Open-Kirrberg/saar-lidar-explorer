#!/usr/bin/env node
// Packer for built (generated) zone assets, e.g. the Bäckerei Heusser twin (zones/baeckerei-heusser/build/):
// one raw GLB in (float32, unlit, COLOR_0 = baked light, NORMAL kept), one contract GLB out.
//
//   node pack-built.mjs --in <raw.glb> --out <zone asset.glb>
//
// Geometry: weld, dedup, prune, KHR_mesh_quantization (position 16 bit, normal 10 bit, colour 8 bit),
// EXT_meshopt_compression. Unlike pack.mjs it keeps NORMAL and COLOR_0 (the baked light) and touches no material:
// the generator already writes KHR_materials_unlit + alpha modes. Node names and extras pass through unchanged.
// Prints one JSON line with stats. Inputs are our own generator's output: parsed, never executed.
import { readFileSync, writeFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, quantize, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const IN = opt('in');
const OUT = opt('out');
if (!IN || !OUT) {
  console.error('usage: node pack-built.mjs --in <raw.glb> --out <glb>');
  process.exit(2);
}

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const t0 = Date.now();
const doc = await io.readBinary(new Uint8Array(readFileSync(IN)));
const root = doc.getRoot();
if (root.listTextures().length) throw new Error('pack-built: built assets carry no textures (style.md)');

let triangles = 0;
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices();
    triangles += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
  }
}
const names = root.listNodes().map((n) => n.getName());

await doc.transform(
  weld(),
  dedup(),
  prune({ keepAttributes: true, keepLeaves: false }),
  quantize({ quantizePosition: 16, quantizeNormal: 10, quantizeColor: 8 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);

const after = root.listNodes().map((n) => n.getName());
const lost = names.filter((n) => !after.includes(n));
if (lost.length) throw new Error(`pack-built: nodes lost while packing: ${lost.join(', ')}`);
const glb = await io.writeBinary(doc);
writeFileSync(OUT, glb);
const ext = root.listExtensionsUsed().map((e) => e.extensionName).sort();
const required = root.listExtensionsRequired().map((e) => e.extensionName).sort();
console.log(JSON.stringify({ out: OUT, bytes: glb.byteLength, triangles, nodes: after.length, extensionsUsed: ext, extensionsRequired: required, seconds: (Date.now() - t0) / 1000 }));
