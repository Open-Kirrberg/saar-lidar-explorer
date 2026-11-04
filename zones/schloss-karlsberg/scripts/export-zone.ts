/**
 * Zone package of Schloss Karlsberg (docs/zone-contract.md, sle-zone-v1; roadmap V2.7):
 *
 *   pnpm run export:zone                          # -> ../../app/public/data/zones/schloss-karlsberg/ + zones/index.json
 *   pnpm run export:zone -- --out <dataRoot>      # another data root (the folder that holds zones/)
 *   pnpm run export:zone -- --update-source       # write footprint, portal, spawn and budget back into zone.json
 *     --module-bytes <n>   gzip size of the castle's lazy zone chunk (default 1 500 000 = the contract's cap)
 *     --triangles <n>      max triangles in view (default DECLARED_TRIANGLES = 1 400 000: skb.inView() max 1.36 M over the
 *                          Rundflug in the phone-proxy viewport, rounded up; ADR 0040, no waiver)
 *     --sips               downscale textures with macOS sips instead of the pipeline's Pillow
 *
 * Source of truth is zones/schloss-karlsberg/zone.json (committed). Footprint, portal and spawn are recomputed from
 * the catalogue (scripts/zone/castle.ts); if they differ from the source the export fails unless --update-source.
 * Output (git-ignored, regenerable, deterministic apart from `generated`):
 *
 *   zones/schloss-karlsberg/zone.json              source + budget + generated
 *   zones/schloss-karlsberg/terrain/meta.json      viewer terrain meta, 1789 only, `encoding.dtm1789`
 *   zones/schloss-karlsberg/terrain/dtm1789.u16.deflate  1789 DTM, uint16 cm steps above floor(h_min) (≤ 5 mm error),
 *                                                  gradient residuals, deflated
 *   zones/schloss-karlsberg/terrain/ground.u8.deflate    1789 ground classes, deflated
 *   zones/schloss-karlsberg/textures/<set>/{diff,nor_gl,arm}.jpg   Poly Haven CC0, 1024² / 1024² / 512²
 *   zones/index.json                               merged: other zones kept
 *
 * Inputs (read only): model/catalogue.json, viewer/public/terrain/ (scripts/prepare-terrain.py),
 * viewer/public/textures/ (pnpm run textures). Never writes through a symlink.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { loadSite } from '../model/src/index.ts';
import { DEFAULT_BUILD_OPTIONS, makeLayoutFn } from '../model/src/context.ts';
import { CASTLE_CROP, PORTAL_RADIUS_M, WALK_EYE_M, castleEntry, castleFootprint, round1 } from './zone/castle.ts';
import { type EN, pointInRing, ringIsSimple } from './zone/footprint.ts';
import {
  type PackageFile,
  type ZoneBudget,
  budgetProblems,
  computeBudget,
  decodeU16,
  encodeU16,
  f32FromLE,
  finiteRange,
  gradientResidual,
  mergeZoneIndex,
  packageTerrainMeta,
  PACKAGE_TERRAIN_FILES,
  DECLARED_TRIANGLES,
  u16LE,
  zoneBbox,
} from './zone/package.ts';

const ROOT = resolve(import.meta.dirname, '..');
const ZONE_ID = 'schloss-karlsberg';
const SOURCE = resolve(ROOT, 'zone.json');
const TERRAIN_IN = resolve(ROOT, 'viewer/public/terrain');
const TEXTURES_IN = resolve(ROOT, 'viewer/public/textures');
const PIPELINE = resolve(ROOT, '../../pipeline');
const RESIZE_PY = resolve(ROOT, 'scripts/zone/resize-textures.py');
/** Texture edge per map (px) and JPEG settings; normal / ARM maps keep full chroma. */
const TEXTURE_SIZE: Record<string, { size: number; subsampling: '4:2:0' | '4:4:4' }> = {
  diff: { size: 1024, subsampling: '4:2:0' },
  nor_gl: { size: 1024, subsampling: '4:4:4' },
  arm: { size: 512, subsampling: '4:4:4' },
};
const JPEG_QUALITY = 85;

const fail = (msg: string): never => {
  console.error(`[export:zone] ${msg}`);
  process.exit(1);
};
const log = (msg: string): void => console.log(`[export:zone] ${msg}`);

// ---------------------------------------------------------------- arguments
const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    out: { type: 'string', default: resolve(ROOT, '../../app/public/data/') },
    'module-bytes': { type: 'string', default: '1500000' },
    triangles: { type: 'string', default: String(DECLARED_TRIANGLES) },
    'update-source': { type: 'boolean', default: false },
    sips: { type: 'boolean', default: false },
  },
});
const intArg = (name: string, v: string): number => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : fail(`--${name} must be a non-negative integer, got ${v}`);
};
const moduleBytes = intArg('module-bytes', args['module-bytes']!);
const triangles = intArg('triangles', args.triangles!);
const OUT = resolve(args.out!);
const ZONES_DIR = join(OUT, 'zones');
const ZONE_DIR = join(ZONES_DIR, ZONE_ID);

/** Refuse to write through a symlink (the worktree's app/public/data children point into the main checkout). */
function assertNoSymlink(p: string): void {
  for (let q = p; q !== dirname(q) && q.startsWith(OUT); q = dirname(q)) {
    if (existsSync(q) && lstatSync(q).isSymbolicLink()) fail(`${q} is a symlink; refusing to write through it`);
  }
}

// ---------------------------------------------------------------- formatting
/** JSON with 2-space indent, arrays of numbers / short strings on one line. */
function formatJson(v: unknown): string {
  return `${JSON.stringify(v, null, 2).replace(/\[\s+((?:-?[\d.e+-]+|null|"[^"\n]{0,24}")(?:,\s+(?:-?[\d.e+-]+|null|"[^"\n]{0,24}"))*)\s+\]/g, (_m, inner: string) => `[${inner.split(/,\s+/).join(', ')}]`)}\n`;
}

// ---------------------------------------------------------------- geometry from the catalogue
const { spec } = loadSite(JSON.parse(readFileSync(resolve(ROOT, 'model/catalogue.json'), 'utf8')) as unknown);
const layout = makeLayoutFn(spec, { roofVariant: DEFAULT_BUILD_OPTIONS.roofVariant });
const fp = castleFootprint(spec, layout);
const footprint: EN[] = fp.ring.map(([E, N]) => [round1(E), round1(N)]);
if (!ringIsSimple(footprint)) fail('footprint is not simple after rounding to 0.1 m');
const entry = castleEntry(spec, WALK_EYE_M, footprint);
if (!pointInRing([entry.spawn.E, entry.spawn.N], footprint)) fail('spawn is outside the footprint');
if (pointInRing([entry.portal.E, entry.portal.N], footprint)) fail('portal is inside the footprint');
const spawnDist = Math.hypot(entry.portal.E - entry.spawn.E, entry.portal.N - entry.spawn.N);
if (spawnDist > PORTAL_RADIUS_M) fail(`spawn ${spawnDist.toFixed(1)} m from the portal > radius ${PORTAL_RADIUS_M} m`);
log(`footprint ${footprint.length} vertices, min clearance ${fp.minClearance.toFixed(1)} m, ${fp.bridges.length} corridor(s)`);
log(`portal ${entry.portalOffset.toFixed(1)} m west of the gate, spawn ${spawnDist.toFixed(1)} m from it`);

type Json = Record<string, unknown>;
const source = JSON.parse(readFileSync(SOURCE, 'utf8')) as Json;
if (source.id !== ZONE_ID) fail(`zone.json id ${String(source.id)} != ${ZONE_ID}`);
const srcPortal = ((source.portals as Json[] | undefined) ?? [])[0] ?? {};
const portalId = typeof srcPortal.id === 'string' ? srcPortal.id : 'ehrenhof';
const spawnId = typeof srcPortal.spawn === 'string' ? srcPortal.spawn : portalId;
const computed: Json = {
  footprint,
  portals: [
    {
      id: portalId,
      label_de: srcPortal.label_de ?? 'Schloss betreten',
      E: entry.portal.E,
      N: entry.portal.N,
      h: null,
      radius_m: PORTAL_RADIUS_M,
      facing_deg: entry.portal.facing_deg,
      spawn: spawnId,
    },
  ],
  spawns: { [spawnId]: { ...entry.spawn, mode: 'gehen' } },
};
const stale = Object.keys(computed).filter((k) => JSON.stringify(source[k]) !== JSON.stringify(computed[k]));
if (stale.length && !args['update-source']) {
  fail(`zone.json is stale (${stale.join(', ')} differ from the catalogue); run pnpm run export:zone -- --update-source and review the diff`);
}
const manifest: Json = { ...source, ...computed };

// ---------------------------------------------------------------- package folder
assertNoSymlink(ZONE_DIR);
if (existsSync(ZONE_DIR)) rmSync(ZONE_DIR, { recursive: true });
mkdirSync(join(ZONE_DIR, 'terrain'), { recursive: true });
const files: PackageFile[] = [];
const writeFile = (rel: string, data: string | Uint8Array, texture?: PackageFile['texture']): void => {
  const p = join(ZONE_DIR, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
  files.push({ path: rel, bytes: statSync(p).size, firstView: true, texture });
};

// ---------------------------------------------------------------- terrain (1789 only)
if (!existsSync(join(TERRAIN_IN, 'meta.json'))) fail('viewer/public/terrain/meta.json missing - run scripts/prepare-terrain.py (CLAUDE.md)');
const devMeta = JSON.parse(readFileSync(join(TERRAIN_IN, 'meta.json'), 'utf8')) as Json & {
  grid: { west: number; south: number; east: number; north: number; cols: number; rows: number };
  ground: { cols: number; rows: number };
  files: { dtm1789: string; ground: string };
};
const g = devMeta.grid;
if (g.west !== CASTLE_CROP.west || g.east !== CASTLE_CROP.east || g.south !== CASTLE_CROP.south || g.north !== CASTLE_CROP.north) {
  fail(`terrain grid ${JSON.stringify(g)} != CASTLE_CROP (scripts/zone/castle.ts)`);
}
const h1789 = f32FromLE(readFileSync(join(TERRAIN_IN, devMeta.files.dtm1789)));
if (h1789.length !== g.cols * g.rows) fail(`dtm1789: ${h1789.length} cells, expected ${g.cols * g.rows}`);
const ground = readFileSync(join(TERRAIN_IN, devMeta.files.ground));
if (ground.length !== devMeta.ground.cols * devMeta.ground.rows) fail('ground: size does not match meta.ground');
const { data: u16, enc } = encodeU16(h1789);
const back = decodeU16(u16, enc);
let maxErr = 0;
for (let i = 0; i < h1789.length; i++) if (!Number.isNaN(h1789[i]!)) maxErr = Math.max(maxErr, Math.abs(back[i]! - h1789[i]!));
if (maxErr > 0.0051) fail(`u16 round trip error ${maxErr} m > 5 mm`);
const hRange = finiteRange(h1789);
// gradient residuals + deflate (level 9: ≈ 5 s here, 11.4 → ≈ 2.5 MB; the phone's 4G download is the cold-enter cost)
const dtmZ = deflateSync(u16LE(gradientResidual(u16, g.cols, g.rows)), { level: 9 });
const groundZ = deflateSync(ground, { level: 9 });
if (!inflateSync(groundZ).equals(ground)) fail('ground deflate round trip differs');
writeFile(`terrain/${PACKAGE_TERRAIN_FILES.dtm1789}`, dtmZ);
writeFile(`terrain/${PACKAGE_TERRAIN_FILES.ground}`, groundZ);
writeFile('terrain/meta.json', `${JSON.stringify(packageTerrainMeta(devMeta, enc, hRange, { dtm1789: dtmZ.length, ground: groundZ.length }))}\n`);
log(
  `terrain: u16 offset ${enc.offset} m, scale ${enc.scale} m, round trip ≤ ${(maxErr * 1000).toFixed(2)} mm; ` +
    `deflated dtm ${(dtmZ.length / 1e6).toFixed(2)} MB (raw ${((u16.length * 2) / 1e6).toFixed(2)}), ground ${(groundZ.length / 1e6).toFixed(2)} MB`,
);

// ---------------------------------------------------------------- textures
const manifestTex = JSON.parse(readFileSync(resolve(ROOT, 'viewer/textures.json'), 'utf8')) as {
  sets: { name: string; files: { map: string; file: string }[] }[];
};
interface Job {
  src: string;
  dst: string;
  size: number;
  quality: number;
  subsampling: string;
}
const jobs: Job[] = [];
for (const s of manifestTex.sets) {
  for (const f of s.files) {
    const t = TEXTURE_SIZE[f.map] ?? fail(`textures.json ${s.name}: unknown map ${f.map}`);
    const src = join(TEXTURES_IN, s.name, f.file);
    if (!existsSync(src)) fail(`${relative(ROOT, src)} missing - run pnpm run textures`);
    jobs.push({ src, dst: join(ZONE_DIR, 'textures', s.name, f.file), size: t.size, quality: JPEG_QUALITY, subsampling: t.subsampling });
  }
}
const resized = args.sips ? null : resizePillow(jobs);
const results = resized ?? resizeSips(jobs);
for (const r of results) {
  const rel = relative(ZONE_DIR, r.dst);
  files.push({ path: rel, bytes: statSync(r.dst).size, firstView: true, texture: { w: r.w, h: r.h } });
}
log(`textures: ${results.length} files via ${resized ? 'Pillow' : 'sips'}`);

function resizePillow(js: Job[]): { dst: string; w: number; h: number }[] | null {
  const r = spawnSync('uv', ['run', '--frozen', 'python', '-I', RESIZE_PY], { cwd: PIPELINE, input: JSON.stringify(js), encoding: 'utf8', maxBuffer: 1 << 24 });
  if (r.status !== 0) {
    console.warn(`[export:zone] Pillow resize failed (${r.error?.message ?? r.stderr.trim().split('\n').pop()}); falling back to sips`);
    return null;
  }
  return JSON.parse(r.stdout) as { dst: string; w: number; h: number }[];
}

function resizeSips(js: Job[]): { dst: string; w: number; h: number }[] {
  return js.map((j) => {
    mkdirSync(dirname(j.dst), { recursive: true });
    const r = spawnSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(j.quality), '-z', String(j.size), String(j.size), j.src, '--out', j.dst], { encoding: 'utf8' });
    if (r.status !== 0) fail(`sips failed on ${j.src}: ${r.stderr || r.error?.message}`);
    return { dst: j.dst, w: j.size, h: j.size };
  });
}

// ---------------------------------------------------------------- zone.json + budget (fixed point: zone.json counts too)
let budget: ZoneBudget = computeBudget(files, moduleBytes, triangles);
let text = '';
for (let i = 0; i < 4; i++) {
  text = formatJson({ ...manifest, budget, generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z') });
  const next = computeBudget([...files, { path: 'zone.json', bytes: Buffer.byteLength(text), firstView: true }], moduleBytes, triangles);
  if (JSON.stringify(next) === JSON.stringify(budget)) break;
  budget = next;
}
const problems = budgetProblems(budget, moduleBytes);
if (problems.length) fail(`over budget (docs/zone-contract.md): ${problems.join('; ')}`);
writeFileSync(join(ZONE_DIR, 'zone.json'), text);

// ---------------------------------------------------------------- index
const indexPath = join(ZONES_DIR, 'index.json');
assertNoSymlink(indexPath);
const existing = existsSync(indexPath) ? (JSON.parse(readFileSync(indexPath, 'utf8')) as unknown) : null;
const bboxEN = zoneBbox(footprint, (manifest.portals as { E: number; N: number }[]) ?? []);
writeFileSync(indexPath, formatJson(mergeZoneIndex(existing, { id: ZONE_ID, bboxEN })));

// ---------------------------------------------------------------- source update
const srcBudgetStale = JSON.stringify(source.budget) !== JSON.stringify(budget);
if (args['update-source'] && (stale.length || srcBudgetStale)) {
  const updated: Json = {};
  for (const [k, v] of Object.entries(source)) updated[k] = k in computed ? computed[k] : k === 'budget' ? budget : v;
  if (!('budget' in updated)) updated.budget = budget;
  delete updated.generated;
  writeFileSync(SOURCE, formatJson(updated));
  log(`zone.json updated (${[...stale, ...(srcBudgetStale ? ['budget'] : [])].join(', ')})`);
} else if (srcBudgetStale) {
  console.warn('[export:zone] zone.json budget differs from the package; run with --update-source to record it');
}

const mb = (b: number): string => `${(b / 1e6).toFixed(2)} MB`;
log(`wrote ${relative(process.cwd(), ZONE_DIR)}/ (${files.length + 1} files) and zones/index.json, bbox ${JSON.stringify(bboxEN)}`);
log(
  `budget: download ${mb(budget.downloadBytes)} / 30, total ${mb(budget.totalBytes)} / 120, GPU textures ${mb(budget.textureBytesGpu)} / 128, ` +
    `triangles ${budget.triangles} / 1 500 000 (declared, phone viewport), module ${mb(moduleBytes)} gzip (declared)`,
);
