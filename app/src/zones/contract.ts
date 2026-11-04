/**
 * V2.6: zone contract v1 (docs/zone-contract.md) — parse + validate `zone.json` and `zones/index.json`.
 * Pure: no three, no DOM. The tolerant parser drops what it can (app rule); `validateZoneStrict`
 * reports every deviation (producer rule, mirrored by pipeline/zones.py).
 */
import { normaliseRing, ringIsSimple } from './geometry';

export const ZONE_FORMAT = 'sle-zone-v1';
export const ZONE_INDEX_FORMAT = 'sle-zones-v1';

export type ZoneKind = 'reconstructed' | 'captured';
export type Confidence = 'high' | 'med' | 'low';
export type MoveMode = 'gehen' | 'fliegen';
export type EN = [number, number];
export type Vec3 = [number, number, number];

/** Camera pose, same conventions as the explorer URL hash: true height, grid heading clockwise, pitch < 0 = down. */
export interface Pose {
  E: number;
  N: number;
  h: number;
  heading_deg: number;
  pitch_deg: number;
  mode: MoveMode;
}

export interface Portal {
  id: string;
  label_de: string;
  E: number;
  N: number;
  /** True height, or null = on the overworld terrain. */
  h: number | null;
  radius_m: number;
  facing_deg: number;
  spawn: string;
}

export interface ZoneLod {
  path: string;
  /** Max camera distance (m) to the asset bbox for this level; null = ∞ (last level). */
  until_m: number | null;
  bytes?: number;
  triangles?: number;
}

export interface ZoneAsset {
  id: string;
  role: 'scene' | 'collider';
  bboxLocal?: [Vec3, Vec3];
  lods: ZoneLod[];
}

export type ZoneRuntime = { kind: 'gltf' } | { kind: 'module'; module: string };

export interface ZonePreset {
  look: 'kino' | 'dokumentation' | 'natur';
  sky: 'shared' | 'none';
  trees: 'shared' | 'none';
  timeOfDay: 'now' | { date: string; time: string };
  exposure?: number;
}

export interface ZoneEvidence {
  kind: 'hypothesis' | 'capture';
  confidence: Confidence;
  perPart: '_CONF' | 'extras' | 'none';
  sources_de: string[];
  disclaimer_de: string;
}

export interface ZoneCapture {
  date: string;
  method: 'photogrammetry-mesh';
  georef: { method: string; controlPoints: number; rmsError_m: number };
  privacy: string;
}

export interface ZoneBudget {
  downloadBytes: number;
  totalBytes: number;
  triangles: number;
  textureBytesGpu: number;
}

export interface ZoneManifest {
  format: typeof ZONE_FORMAT;
  id: string;
  kind: ZoneKind;
  name_de: string;
  summary_de: string;
  crs: 'EPSG:25832';
  heightDatum: string;
  origin: { E0: number; N0: number };
  /** Normalised: CCW, no closing vertex. */
  footprint: EN[];
  portals: Portal[];
  spawns: Record<string, Pose>;
  exit: { rule: 'restore' };
  runtime: ZoneRuntime;
  assets: ZoneAsset[];
  preset: ZonePreset;
  attribution: string[];
  evidence: ZoneEvidence;
  capture: ZoneCapture | null;
  budget: ZoneBudget | null;
}

export interface ZoneIndexEntry {
  id: string;
  bboxEN: [EN, EN];
}

export interface ParseResult<T> {
  value: T | null;
  warnings: string[];
}

/** Limits from the contract's budget table (phone proxy). */
export const ZONE_BUDGET_LIMITS: Readonly<ZoneBudget> = {
  downloadBytes: 30_000_000,
  totalBytes: 120_000_000,
  triangles: 1_500_000,
  textureBytesGpu: 128_000_000,
};

export const DEFAULT_PRESET: Readonly<ZonePreset> = { look: 'kino', sky: 'shared', trees: 'shared', timeOfDay: 'now' };
export const DEFAULT_ZONE_DISCLAIMER = 'Schauen, nicht graben.';
export const PORTAL_RADIUS_MIN = 1;
export const PORTAL_RADIUS_MAX = 2000;

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PATH_RE = /^[A-Za-z0-9_./-]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max = 500): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;

export const isZoneId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v);

/** Plain relative path: no scheme, no `..`, no empty segment, no leading `/`. */
export function isSafeRelativePath(p: unknown): p is string {
  return (
    typeof p === 'string' &&
    p.length > 0 &&
    p.length <= 200 &&
    PATH_RE.test(p) &&
    !p.startsWith('/') &&
    !p.split('/').some((seg) => seg === '..' || seg === '' || seg === '.')
  );
}

/** EPSG:25832 plausibility (same window as the sle-recon-v1 footprints). */
export const isUtmEN = (E: unknown, N: unknown): boolean =>
  fin(E) && fin(N) && E > 100_000 && E < 900_000 && N > 1_000_000 && N < 9_500_000;

export const normHeading = (deg: number): number => ((deg % 360) + 360) % 360;

export function parsePose(raw: unknown): Pose | null {
  if (!isObj(raw)) return null;
  const { E, N, h, heading_deg, pitch_deg } = raw;
  if (!isUtmEN(E, N) || !fin(h) || !fin(heading_deg) || !fin(pitch_deg)) return null;
  if (pitch_deg < -90 || pitch_deg > 90) return null;
  const mode = oneOf(raw.mode, ['gehen', 'fliegen'] as const);
  if (!mode) return null;
  return { E: E as number, N: N as number, h, heading_deg: normHeading(heading_deg), pitch_deg, mode };
}

function parsePortal(raw: unknown, i: number, seen: Set<string>, spawns: Record<string, Pose>, warn: (m: string) => void): Portal | null {
  const at = `portals[${i}]`;
  if (!isObj(raw)) return warn(`${at}: not an object`), null;
  if (!isZoneId(raw.id)) return warn(`${at}: invalid id`), null;
  if (seen.has(raw.id)) return warn(`${at}: duplicate id ${raw.id}`), null;
  if (!isUtmEN(raw.E, raw.N)) return warn(`${at}: invalid E/N`), null;
  if (raw.h !== null && raw.h !== undefined && !fin(raw.h)) return warn(`${at}: invalid h`), null;
  if (!fin(raw.radius_m) || raw.radius_m <= 0) return warn(`${at}: invalid radius_m`), null;
  if (typeof raw.spawn !== 'string' || !spawns[raw.spawn]) return warn(`${at}: unknown spawn`), null;
  if (raw.radius_m < PORTAL_RADIUS_MIN || raw.radius_m > PORTAL_RADIUS_MAX) warn(`${at}: radius_m clamped to ${PORTAL_RADIUS_MIN}–${PORTAL_RADIUS_MAX}`);
  if (raw.facing_deg !== undefined && !fin(raw.facing_deg)) warn(`${at}: invalid facing_deg → 0`);
  const label = str(raw.label_de, 40);
  if (!label) warn(`${at}: missing label_de`);
  seen.add(raw.id);
  return {
    id: raw.id,
    label_de: label ?? 'Betreten',
    E: raw.E as number,
    N: raw.N as number,
    h: fin(raw.h) ? raw.h : null,
    radius_m: Math.min(PORTAL_RADIUS_MAX, Math.max(PORTAL_RADIUS_MIN, raw.radius_m)),
    facing_deg: fin(raw.facing_deg) ? normHeading(raw.facing_deg) : 0,
    spawn: raw.spawn,
  };
}

function parseVec3(v: unknown): Vec3 | null {
  return Array.isArray(v) && v.length === 3 && v.every(fin) ? (v as Vec3) : null;
}

function parseAsset(raw: unknown, i: number, seen: Set<string>, warn: (m: string) => void): ZoneAsset | null {
  const at = `assets[${i}]`;
  if (!isObj(raw)) return warn(`${at}: not an object`), null;
  if (typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(raw.id)) return warn(`${at}: invalid id`), null;
  if (seen.has(raw.id)) return warn(`${at}: duplicate id ${raw.id}`), null;
  const role = oneOf(raw.role, ['scene', 'collider'] as const);
  if (!role) return warn(`${at}: unknown role, skipped`), null;
  if (!Array.isArray(raw.lods) || raw.lods.length === 0) return warn(`${at}: no lods`), null;
  const lods: ZoneLod[] = [];
  let prev = -Infinity;
  for (const [k, l] of raw.lods.entries()) {
    const last = k === raw.lods.length - 1;
    if (!isObj(l) || !isSafeRelativePath(l.path) || !l.path.endsWith('.glb')) return warn(`${at}.lods[${k}]: invalid path`), null;
    if (last ? l.until_m !== null : !fin(l.until_m) || l.until_m <= prev) {
      return warn(`${at}.lods[${k}]: until_m must increase and be null on the last level`), null;
    }
    if (!last) prev = l.until_m as number;
    const lod: ZoneLod = { path: l.path, until_m: last ? null : (l.until_m as number) };
    if (fin(l.bytes) && l.bytes >= 0) lod.bytes = l.bytes;
    if (fin(l.triangles) && l.triangles >= 0) lod.triangles = l.triangles;
    lods.push(lod);
  }
  const asset: ZoneAsset = { id: raw.id, role, lods };
  if (raw.bboxLocal !== undefined) {
    const b = Array.isArray(raw.bboxLocal) ? raw.bboxLocal.map(parseVec3) : [];
    if (b.length === 2 && b[0] && b[1] && b[0].every((v, a) => v < b[1]![a]!)) asset.bboxLocal = [b[0], b[1]];
    else warn(`${at}: invalid bboxLocal ignored`);
  }
  seen.add(raw.id);
  return asset;
}

function parsePreset(raw: unknown, warn: (m: string) => void): ZonePreset {
  if (raw === undefined) return { ...DEFAULT_PRESET };
  if (!isObj(raw)) return warn('preset: not an object → default'), { ...DEFAULT_PRESET };
  const p: ZonePreset = {
    look: oneOf(raw.look, ['kino', 'dokumentation', 'natur'] as const) ?? (warn('preset.look invalid → kino'), 'kino'),
    sky: oneOf(raw.sky, ['shared', 'none'] as const) ?? (warn('preset.sky invalid → shared'), 'shared'),
    trees: oneOf(raw.trees, ['shared', 'none'] as const) ?? (warn('preset.trees invalid → shared'), 'shared'),
    timeOfDay: 'now',
  };
  const t = raw.timeOfDay;
  if (isObj(t) && typeof t.date === 'string' && DATE_RE.test(t.date) && typeof t.time === 'string' && TIME_RE.test(t.time)) {
    p.timeOfDay = { date: t.date, time: t.time };
  } else if (t !== undefined && t !== 'now') warn('preset.timeOfDay invalid → now');
  if (raw.exposure !== undefined) {
    if (fin(raw.exposure) && raw.exposure >= 0.25 && raw.exposure <= 4) p.exposure = raw.exposure;
    else warn('preset.exposure out of 0.25–4, ignored');
  }
  return p;
}

function parseEvidence(raw: unknown, kind: ZoneKind, warn: (m: string) => void): ZoneEvidence {
  const fallbackKind = kind === 'captured' ? 'capture' : 'hypothesis';
  if (!isObj(raw)) {
    warn('evidence: missing');
    return { kind: fallbackKind, confidence: 'low', perPart: 'none', sources_de: [], disclaimer_de: DEFAULT_ZONE_DISCLAIMER };
  }
  const ek = oneOf(raw.kind, ['hypothesis', 'capture'] as const);
  if (!ek) warn('evidence.kind invalid');
  else if (ek !== fallbackKind) warn(`evidence.kind ${ek} does not match zone kind ${kind}`);
  const confidence = oneOf(raw.confidence, ['high', 'med', 'low'] as const);
  if (!confidence) warn('evidence.confidence invalid → low');
  const perPart = raw.perPart === undefined ? 'none' : oneOf(raw.perPart, ['_CONF', 'extras', 'none'] as const);
  if (!perPart) warn('evidence.perPart invalid → none');
  const sources = Array.isArray(raw.sources_de) ? raw.sources_de.map((s) => str(s, 200)).filter((s): s is string => !!s) : [];
  if (sources.length > 10) warn('evidence.sources_de: more than 10, truncated');
  return {
    kind: ek ?? fallbackKind,
    confidence: confidence ?? 'low',
    perPart: perPart ?? 'none',
    sources_de: sources.slice(0, 10),
    disclaimer_de: str(raw.disclaimer_de, 300) ?? DEFAULT_ZONE_DISCLAIMER,
  };
}

function parseCapture(raw: unknown, kind: ZoneKind, warn: (m: string) => void): ZoneCapture | null {
  if (kind !== 'captured') {
    if (raw !== undefined && raw !== null) warn('capture: only for captured zones, ignored');
    return null;
  }
  if (!isObj(raw)) return warn('capture: missing for a captured zone'), null;
  const g = raw.georef;
  const ok =
    typeof raw.date === 'string' && DATE_RE.test(raw.date) &&
    raw.method === 'photogrammetry-mesh' &&
    isObj(g) && str(g.method) && fin(g.controlPoints) && g.controlPoints >= 0 && fin(g.rmsError_m) && g.rmsError_m >= 0 &&
    str(raw.privacy);
  if (!ok) return warn('capture: invalid (date, method, georef{method, controlPoints, rmsError_m}, privacy)'), null;
  return {
    date: raw.date as string,
    method: 'photogrammetry-mesh',
    georef: { method: str((g as Record<string, unknown>).method)!, controlPoints: (g as { controlPoints: number }).controlPoints, rmsError_m: (g as { rmsError_m: number }).rmsError_m },
    privacy: str(raw.privacy, 300)!,
  };
}

function parseBudget(raw: unknown, warn: (m: string) => void): ZoneBudget | null {
  if (raw === undefined || raw === null) return null;
  const keys = Object.keys(ZONE_BUDGET_LIMITS) as (keyof ZoneBudget)[];
  if (!isObj(raw) || !keys.every((k) => fin(raw[k]) && (raw[k] as number) >= 0)) return warn('budget: invalid, ignored'), null;
  return Object.fromEntries(keys.map((k) => [k, raw[k] as number])) as unknown as ZoneBudget;
}

export interface ParseZoneOptions {
  /** Names of zone modules registered in this build (runtime kind "module"). Undefined = accept any. */
  modules?: ReadonlySet<string>;
}

/**
 * Tolerant parse of an (untrusted) `zone.json`. `value === null` means "zone absent"; warnings list
 * everything dropped or defaulted.
 */
export function parseZoneManifest(json: unknown, opts: ParseZoneOptions = {}): ParseResult<ZoneManifest> {
  const warnings: string[] = [];
  const warn = (m: string) => void warnings.push(m);
  const absent = (m: string): ParseResult<ZoneManifest> => (warn(m), { value: null, warnings });

  if (!isObj(json)) return absent('zone.json: not an object');
  if (json.format !== ZONE_FORMAT) return absent(`format must be ${ZONE_FORMAT}`);
  if (json.crs !== 'EPSG:25832') return absent('crs must be EPSG:25832');
  if (!isZoneId(json.id)) return absent('invalid id');
  const kind = oneOf(json.kind, ['reconstructed', 'captured'] as const);
  if (!kind) return absent('invalid kind');
  const o = json.origin;
  if (!isObj(o) || !Number.isInteger(o.E0) || !Number.isInteger(o.N0) || !isUtmEN(o.E0, o.N0)) return absent('invalid origin');

  if (!Array.isArray(json.footprint) || !json.footprint.every((p) => Array.isArray(p) && p.length === 2 && isUtmEN(p[0], p[1]))) {
    return absent('invalid footprint');
  }
  const footprint = normaliseRing(json.footprint as EN[]);
  if (!footprint) return absent('footprint: < 3 distinct vertices or zero area');
  if (!ringIsSimple(footprint)) return absent('footprint: self-intersecting');

  const spawns: Record<string, Pose> = {};
  if (isObj(json.spawns)) {
    for (const [k, v] of Object.entries(json.spawns)) {
      const p = parsePose(v);
      if (p && isZoneId(k)) spawns[k] = p;
      else warn(`spawns.${k}: invalid pose, dropped`);
    }
  }
  if (Object.keys(spawns).length === 0) return absent('no valid spawn');

  const portals: Portal[] = [];
  const seenPortals = new Set<string>();
  (Array.isArray(json.portals) ? json.portals : []).forEach((p, i) => {
    const portal = parsePortal(p, i, seenPortals, spawns, warn);
    if (portal) portals.push(portal);
  });
  if (portals.length === 0) return absent('no valid portal');

  if (json.exit !== undefined && !(isObj(json.exit) && json.exit.rule === 'restore')) warn('exit: only rule "restore" is known → restore');

  const rt = json.runtime;
  let runtime: ZoneRuntime;
  if (isObj(rt) && rt.kind === 'gltf') runtime = { kind: 'gltf' };
  else if (isObj(rt) && rt.kind === 'module' && isZoneId(rt.module)) {
    if (opts.modules && !opts.modules.has(rt.module)) return absent(`zone module ${rt.module} not registered`);
    runtime = { kind: 'module', module: rt.module };
  } else return absent('invalid runtime');

  const assets: ZoneAsset[] = [];
  const seenAssets = new Set<string>();
  (Array.isArray(json.assets) ? json.assets : []).forEach((a, i) => {
    const asset = parseAsset(a, i, seenAssets, warn);
    if (asset) assets.push(asset);
  });
  if (runtime.kind === 'gltf' && !assets.some((a) => a.role === 'scene')) return absent('gltf runtime needs a scene asset');

  const attribution = Array.isArray(json.attribution)
    ? json.attribution.map((s) => str(s, 300)).filter((s): s is string => !!s && !s.includes(';'))
    : [];
  if (attribution.length === 0) warn('attribution: missing (≥ 1 entry, no ";")');

  const summary = typeof json.summary_de === 'string' ? json.summary_de.trim() : '';
  if (summary.length > 300) warn('summary_de: > 300 chars, truncated');

  return {
    value: {
      format: ZONE_FORMAT,
      id: json.id,
      kind,
      name_de: str(json.name_de, 120) ?? json.id,
      summary_de: summary.slice(0, 300),
      crs: 'EPSG:25832',
      heightDatum: str(json.heightDatum, 40) ?? 'DHHN2016',
      origin: { E0: o.E0 as number, N0: o.N0 as number },
      footprint,
      portals,
      spawns,
      exit: { rule: 'restore' },
      runtime,
      assets,
      preset: parsePreset(json.preset, warn),
      attribution,
      evidence: parseEvidence(json.evidence, kind, warn),
      capture: parseCapture(json.capture, kind, warn),
      budget: parseBudget(json.budget, warn),
    },
    warnings,
  };
}

/** Budget violations against {@link ZONE_BUDGET_LIMITS} (and declared LOD bytes vs. the declared first-view size). */
export function budgetViolations(m: ZoneManifest): string[] {
  const out: string[] = [];
  if (!m.budget) return ['budget: missing'];
  for (const k of Object.keys(ZONE_BUDGET_LIMITS) as (keyof ZoneBudget)[]) {
    if (m.budget[k] > ZONE_BUDGET_LIMITS[k]) out.push(`budget.${k} ${m.budget[k]} > ${ZONE_BUDGET_LIMITS[k]}`);
  }
  const firstView = m.assets.filter((a) => a.role === 'scene').reduce((s, a) => s + (a.lods[a.lods.length - 1]!.bytes ?? 0), 0);
  if (firstView > m.budget.downloadBytes) out.push(`coarsest LODs (${firstView} B) exceed budget.downloadBytes`);
  return out;
}

/** Producer rule: no warnings, a budget within limits. Returns all problems (empty = valid). */
export function validateZoneStrict(json: unknown, opts: ParseZoneOptions = {}): string[] {
  const r = parseZoneManifest(json, opts);
  return r.value ? [...r.warnings, ...budgetViolations(r.value)] : r.warnings;
}

/** Tolerant parse of `zones/index.json`. Invalid/duplicate entries are dropped. */
export function parseZoneIndex(json: unknown): ParseResult<ZoneIndexEntry[]> {
  const warnings: string[] = [];
  if (!isObj(json) || json.format !== ZONE_INDEX_FORMAT || !Array.isArray(json.zones)) {
    return { value: null, warnings: [`zones/index.json: format must be ${ZONE_INDEX_FORMAT} with a zones array`] };
  }
  const seen = new Set<string>();
  const value: ZoneIndexEntry[] = [];
  json.zones.forEach((z, i) => {
    const b = isObj(z) ? z.bboxEN : undefined;
    const ok =
      isObj(z) && isZoneId(z.id) && !seen.has(z.id) && Array.isArray(b) && b.length === 2 &&
      b.every((p) => Array.isArray(p) && p.length === 2 && isUtmEN(p[0], p[1])) &&
      b[0][0] < b[1][0] && b[0][1] < b[1][1];
    if (!ok) return void warnings.push(`zones[${i}]: invalid or duplicate, dropped`);
    seen.add(z.id as string);
    value.push({ id: z.id as string, bboxEN: [[b[0][0], b[0][1]], [b[1][0], b[1][1]]] });
  });
  return { value, warnings };
}

export const bboxIntersects = (a: [EN, EN], b: [EN, EN]): boolean =>
  a[0][0] < b[1][0] && b[0][0] < a[1][0] && a[0][1] < b[1][1] && b[0][1] < a[1][1];

export interface LoadedZone {
  /** URL path of the zone folder relative to the data root, with trailing slash (`zones/<id>/`). */
  base: string;
  manifest: ZoneManifest;
}

/**
 * Load all zones that touch `aoiBboxEN`: index → filter by bbox → each `zone.json`. `fetchJson`
 * resolves a path relative to the data root and rejects on 404 / invalid JSON. Never throws;
 * problems go to `warn` (one line each).
 */
export async function loadZones(
  fetchJson: (path: string) => Promise<unknown>,
  aoiBboxEN: [EN, EN],
  opts: ParseZoneOptions & { warn?: (m: string) => void } = {},
): Promise<LoadedZone[]> {
  const warn = opts.warn ?? (() => {});
  let idx: ParseResult<ZoneIndexEntry[]>;
  try {
    idx = parseZoneIndex(await fetchJson('zones/index.json'));
  } catch {
    return [];
  }
  idx.warnings.forEach((w) => warn(w));
  const wanted = (idx.value ?? []).filter((z) => bboxIntersects(z.bboxEN, aoiBboxEN));
  const out = await Promise.all(
    wanted.map(async (z): Promise<LoadedZone | null> => {
      const base = `zones/${z.id}/`;
      try {
        const r = parseZoneManifest(await fetchJson(`${base}zone.json`), opts);
        r.warnings.forEach((w) => warn(`[zone ${z.id}] ${w}`));
        if (r.value && r.value.id !== z.id) return warn(`[zone ${z.id}] id does not match its folder`), null;
        return r.value ? { base, manifest: r.value } : null;
      } catch (err) {
        warn(`[zone ${z.id}] zone.json not loaded: ${String(err)}`);
        return null;
      }
    }),
  );
  return out.filter((z): z is LoadedZone => z !== null);
}
