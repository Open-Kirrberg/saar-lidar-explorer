// Dev diagnostic: rays from 3 m inside through every facade opening of one side; reports what blocks them.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { loadSite } from '../../model/src/catalogue.ts';
import { DEFAULT_BUILD_OPTIONS, makeLayoutFn, type BuildContext } from '../../model/src/context.ts';
import { createFallbackMaterials } from '../../model/src/interior/index.ts';
import { buildExterior } from '../../model/src/exterior/index.ts';
function terrainSampler(): (x: number, z: number) => number {
  const meta = JSON.parse(readFileSync(new URL('../../viewer/public/terrain/meta.json', import.meta.url), 'utf8')).grid;
  const buf = readFileSync(new URL('../../viewer/public/terrain/dtm1789.f32', import.meta.url));
  const h = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return (x, z) => {
    const c = (x + 381000 - meta.west) / meta.cell - 0.5;
    const r = (meta.north - (5465000 - z)) / meta.cell - 0.5;
    if (c < 0 || r < 0 || c > meta.cols - 1 || r > meta.rows - 1) return NaN;
    const c0 = Math.min(meta.cols - 2, Math.floor(c)), r0 = Math.min(meta.rows - 2, Math.floor(r));
    const fc = c - c0, fr = r - r0, i = r0 * meta.cols + c0;
    const a = h[i] + (h[i + 1] - h[i]) * fc, b = h[i + meta.cols] + (h[i + meta.cols + 1] - h[i + meta.cols]) * fc;
    return a + (b - a) * fr;
  };
}
const { spec } = loadSite(JSON.parse(readFileSync(new URL('../../model/catalogue.json', import.meta.url), 'utf8')));
const ctx: BuildContext = { spec, lod: 2, materials: createFallbackMaterials(), terrain: terrainSampler(), options: { ...DEFAULT_BUILD_OPTIONS }, layout: makeLayoutFn(spec) };
const b = spec.buildings.find((x) => x.id === (process.argv[2] ?? 'KB-B01'))!;
const L = ctx.layout(b);
const g = buildExterior(b, ctx);
g.position.set(0, 0, 0);
g.rotation.set(0, 0, 0);
g.updateMatrixWorld(true);
const rc = new THREE.Raycaster();
const side = (process.argv[3] ?? 'court') as 'court';
const sd = L.frame.sides[side];
for (const o of L.openings.filter((x) => x.side === side && x.kind !== 'cellar_window')) {
  const sC = sd.p0[0] + sd.tangent[0] * o.a;
  if (process.argv[4] && (sC < +process.argv[4] || sC > +process.argv[5])) continue;
  const bad: string[] = [];
  for (const fa of [-0.4, -0.2, 0.2, 0.4]) for (const fh of [0.1, 0.3, 0.5, 0.7]) {
    const a = o.a + fa * o.width;
    const h = o.bottom_h + fh * (o.top_h - o.bottom_h);
    const s = sd.p0[0] + sd.tangent[0] * a - sd.normal[0] * 3;
    const t = sd.p0[1] + sd.tangent[1] * a - sd.normal[1] * 3;
    rc.set(new THREE.Vector3(s, h, -t), new THREE.Vector3(sd.normal[0], 0, -sd.normal[1]));
    rc.far = 6;
    const hit = rc.intersectObject(g, true).find((x) => (x.object as THREE.Mesh).userData.collider !== true && !/glass|wood\.frame|wood\.door|metal|shutter|colliders/.test(x.object.name));
    if (hit) bad.push(`${fa}/${fh}:${hit.object.name.split('/').slice(-1)}@${hit.distance.toFixed(2)}`);
  }
  console.log(o.storey, o.kind, 'axis', o.axis, 's', sC.toFixed(2), bad.length ? 'BLOCKED ' + bad.join(' ') : 'ok');
}
