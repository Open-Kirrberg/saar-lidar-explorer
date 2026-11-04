#!/usr/bin/env node
// Zone asset packer (tools/capture stage `package`, zone contract "Assets"): one export GLB in, one contract GLB out.
//
//   node pack.mjs --in <export.glb> --out <zone asset.glb> [--texture <masked.jpg>] [--quality 160] [--double-sided]
//
// Geometry: normals dropped (unlit), weld, KHR_mesh_quantization (position 16 bit, UV 14 bit), EXT_meshopt_compression.
// Texture: optional replacement (the privacy-masked atlas from Python), then KTX2 / ETC1S (KHR_texture_basisu) with
// mipmaps, sRGB. Material: KHR_materials_unlit (light is baked into the photos). Prints one JSON line with stats.
// Inputs are our own export GLBs (data/work, untrusted data): parsed, never executed.
import { readFileSync, writeFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, quantize, weld } from '@gltf-transform/functions';
import jpeg from 'jpeg-js';
import { ktx2 } from 'ktx2-encoder/gltf-transform';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const IN = opt('in');
const OUT = opt('out');
const TEXTURE = opt('texture');
const QUALITY = Number(opt('quality', '160'));
const DOUBLE_SIDED = args.includes('--double-sided');
if (!IN || !OUT) {
  console.error('usage: node pack.mjs --in <glb> --out <glb> [--texture <jpg>] [--quality 1-255] [--double-sided]');
  process.exit(2);
}

/** JPEG → RGBA for the Basis encoder (the atlases are JPEG; PNG input is not used here). */
async function imageDecoder(buf) {
  const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024, maxResolutionInMP: 100 });
  return { width: img.width, height: img.height, data: new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength) };
}

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const t0 = Date.now();
const doc = await io.readBinary(new Uint8Array(readFileSync(IN)));
const root = doc.getRoot();

// Unlit material, no normals: the photo texture already carries the light.
const unlit = doc.createExtension(KHRMaterialsUnlit);
for (const m of root.listMaterials()) {
  m.setExtension('KHR_materials_unlit', unlit.createUnlit());
  m.setMetallicFactor(0).setRoughnessFactor(1).setDoubleSided(DOUBLE_SIDED);
  m.setNormalTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null);
}
let triangles = 0;
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    prim.setAttribute('NORMAL', null);
    for (const s of prim.listSemantics()) if (s !== 'POSITION' && s !== 'TEXCOORD_0') prim.setAttribute(s, null);
    const idx = prim.getIndices();
    triangles += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
  }
}

// Privacy-masked atlas from the Python stage replaces the base colour image.
const textures = root.listTextures();
if (TEXTURE) {
  if (textures.length !== 1) throw new Error(`--texture needs exactly one texture, found ${textures.length}`);
  textures[0].setImage(new Uint8Array(readFileSync(TEXTURE))).setMimeType('image/jpeg');
}
const texSize = textures.map((t) => t.getSize());

await doc.transform(
  weld(),
  dedup(),
  prune(),
  quantize({ quantizePosition: 16, quantizeTexcoord: 14 }),
  ktx2({ isUASTC: false, qualityLevel: QUALITY, compressionLevel: 2, generateMipmap: true, isSetKTX2SRGBTransferFunc: true, imageDecoder }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);

// The contract allows only KTX2 above 1024²; the wasm encoder logs and skips on failure, so check here.
const notKtx2 = root.listTextures().filter((t) => t.getMimeType() !== 'image/ktx2');
if (notKtx2.length) {
  console.error(`pack: ${notKtx2.length} texture(s) not KTX2 after encoding (wasm Basis encoder limit ~12 Mpix, e.g. 3072² max)`);
  process.exit(1);
}
const glb = await io.writeBinary(doc);
writeFileSync(OUT, glb);
const ext = root.listExtensionsUsed().map((e) => e.extensionName).sort();
const required = root.listExtensionsRequired().map((e) => e.extensionName).sort();
console.log(JSON.stringify({ out: OUT, bytes: glb.byteLength, triangles, textures: texSize, extensionsUsed: ext, extensionsRequired: required, seconds: (Date.now() - t0) / 1000 }));
