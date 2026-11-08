/**
 * Catalog `sle-catalog-v1` (data contract "Catalog"): parse + tolerance rules, URL resolution,
 * tile → owner lookup and the load/drop rule for places around the camera. Pure (no DOM, no three);
 * `loadCatalog` is the only function that fetches.
 */
import type { Bitmap } from './globalGrid';
import { decodeBitmap, distanceToBbox, isGlobalGrid, tileId, TILE_M } from './globalGrid';

export const CATALOG_FORMAT = 'sle-catalog-v1';

export type PlaceStatus = '3d' | 'building' | 'stats';

export interface CatalogPlace {
  id: string;
  name_de: string;
  ags: string;
  state: 'SL' | 'RP' | string;
  status: PlaceStatus;
  repo?: string;
  /** Absolute URL ending in '/', present for '3d' / 'building'. */
  dataUrl?: string;
  /** [Emin, Nmin, Emax, Nmax] of the owned tiles (multiples of 1000). */
  bbox: [number, number, number, number];
  tiles: Bitmap;
  options?: { relict_candidates?: boolean };
}

export interface Catalog {
  format: typeof CATALOG_FORMAT;
  url: string;
  generated: string;
  height_ref_m: number;
  ownership?: { rule: string; outlines: string; attribution: string };
  /** Absolute URL of the overview file. */
  overviewUrl?: string;
  /** Absolute URL of the stats-only leaderboard manifest. */
  leaderboardUrl?: string;
  attribution: string;
  places: CatalogPlace[];
  /** tileId → place id (first place in file order wins a doubly claimed tile). */
  owners: Map<string, string>;
  byId: Map<string, CatalogPlace>;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const AGS_RE = /^\d{8}$/;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Hosts for which plain http is allowed (dev). */
function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost');
}

/**
 * Resolve a catalog URL (`data_url`, `overview`, `leaderboard`) against the catalog URL. Allowed:
 * https, and http only for localhost / 127.0.0.1 / [::1] / *.localhost. `dir` adds a trailing '/'.
 * Returns null for anything else (or an unparsable URL).
 */
export function resolveCatalogUrl(value: unknown, catalogUrl: string, dir = false): string | null {
  if (typeof value !== 'string' || !value) return null;
  let u: URL;
  try {
    u = new URL(value, catalogUrl);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocalHost(u.hostname))) return null;
  let href = u.href;
  if (dir && !href.endsWith('/')) href += '/';
  return href;
}

function parseBbox(v: unknown): [number, number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 4 || !v.every(isNum)) return null;
  const [a, b, c, d] = v as number[];
  if (!(a < c) || !(b < d) || [a, b, c, d].some((x) => x % TILE_M !== 0)) return null;
  return [a, b, c, d];
}

/** Parse one place; null = skipped (invalid id/ags/bbox/tiles). `warn` receives the reason. */
export function parseCatalogPlace(v: unknown, catalogUrl: string, warn: (m: string) => void): CatalogPlace | null {
  if (!isObj(v)) {
    warn('place: not an object, skipped');
    return null;
  }
  const id = v.id;
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    warn(`place ${JSON.stringify(id)}: invalid id, skipped`);
    return null;
  }
  if (typeof v.ags !== 'string' || !AGS_RE.test(v.ags)) {
    warn(`place ${id}: invalid ags, skipped`);
    return null;
  }
  const bbox = parseBbox(v.bbox);
  if (!bbox) {
    warn(`place ${id}: invalid bbox, skipped`);
    return null;
  }
  const w = (bbox[2] - bbox[0]) / TILE_M;
  const h = (bbox[3] - bbox[1]) / TILE_M;
  const tiles = decodeBitmap(v.tiles, { w, h }, (m) => warn(`place ${id}: tiles ${m}, skipped`));
  if (!tiles) return null;
  let status: PlaceStatus = v.status === '3d' || v.status === 'building' || v.status === 'stats' ? v.status : 'stats';
  if (status !== v.status) warn(`place ${id}: unknown status ${JSON.stringify(v.status)} → 'stats'`);
  let dataUrl: string | undefined;
  if (status !== 'stats') {
    dataUrl = resolveCatalogUrl(v.data_url, catalogUrl, true) ?? undefined;
    if (!dataUrl) {
      warn(`place ${id}: data_url missing or not allowed → 'stats'`);
      status = 'stats';
    }
  }
  const opts = isObj(v.options) && typeof v.options.relict_candidates === 'boolean' ? { relict_candidates: v.options.relict_candidates } : undefined;
  return {
    id,
    name_de: typeof v.name_de === 'string' && v.name_de ? v.name_de : id,
    ags: v.ags,
    state: typeof v.state === 'string' ? v.state : '',
    status,
    ...(typeof v.repo === 'string' ? { repo: v.repo } : {}),
    ...(dataUrl ? { dataUrl } : {}),
    bbox,
    tiles,
    ...(opts ? { options: opts } : {}),
  };
}

/**
 * Parse a catalog. Invalid `format`, `grid` or a non-object → throws (no catalog mode). Places with
 * an invalid id/ags/bbox/tiles or a duplicate id/ags are skipped (their tiles have no owner).
 */
export function parseCatalog(raw: unknown, catalogUrl: string, warn: (m: string) => void = (m) => console.warn(`[catalog] ${m}`)): Catalog {
  if (!isObj(raw)) throw new Error('catalog: not an object');
  if (raw.format !== CATALOG_FORMAT) throw new Error(`catalog: format ${String(raw.format)} ≠ ${CATALOG_FORMAT}`);
  if (!isGlobalGrid(raw.grid)) throw new Error('catalog: grid is not sle-grid-25832-v1');
  if (!isNum(raw.height_ref_m)) throw new Error('catalog: height_ref_m missing');
  const places: CatalogPlace[] = [];
  const byId = new Map<string, CatalogPlace>();
  const agsSeen = new Set<string>();
  for (const pv of Array.isArray(raw.places) ? raw.places : []) {
    const p = parseCatalogPlace(pv, catalogUrl, warn);
    if (!p) continue;
    if (byId.has(p.id) || agsSeen.has(p.ags)) {
      warn(`place ${p.id}: duplicate id or ags, skipped`);
      continue;
    }
    byId.set(p.id, p);
    agsSeen.add(p.ags);
    places.push(p);
  }
  const owners = buildOwners(places, warn);
  const own = raw.ownership;
  const overviewUrl = raw.overview !== undefined ? resolveCatalogUrl(raw.overview, catalogUrl) : null;
  if (raw.overview !== undefined && !overviewUrl) warn('overview URL not allowed, ignored');
  const leaderboardUrl = raw.leaderboard !== undefined ? resolveCatalogUrl(raw.leaderboard, catalogUrl) : null;
  return {
    format: CATALOG_FORMAT,
    url: catalogUrl,
    generated: typeof raw.generated === 'string' ? raw.generated : '',
    height_ref_m: raw.height_ref_m,
    ...(isObj(own) && typeof own.rule === 'string'
      ? { ownership: { rule: own.rule, outlines: String(own.outlines ?? ''), attribution: String(own.attribution ?? '') } }
      : {}),
    ...(overviewUrl ? { overviewUrl } : {}),
    ...(leaderboardUrl ? { leaderboardUrl } : {}),
    attribution: typeof raw.attribution === 'string' ? raw.attribution : '',
    places,
    owners,
    byId,
  };
}

/** tileId → place id from all `tiles` bitmaps; a tile claimed twice → first place in file order (logged). */
export function buildOwners(places: readonly CatalogPlace[], warn: (m: string) => void = () => {}): Map<string, string> {
  const owners = new Map<string, string>();
  for (const p of places) {
    const { w, h, cells } = p.tiles;
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        if (!cells[row * w + col]) continue;
        const id = tileId(p.bbox[0] + col * TILE_M, p.bbox[3] - (row + 1) * TILE_M);
        const prev = owners.get(id);
        if (prev !== undefined) {
          warn(`tile ${id} claimed by ${prev} and ${p.id}; ${prev} keeps it`);
          continue;
        }
        owners.set(id, p.id);
      }
    }
  }
  return owners;
}

/** Load radius / drop radius (m) around the camera's ground point (contract: 8 km / 12 km). */
export const PLACE_LOAD_M = 8000;
export const PLACE_DROP_M = 12000;

/**
 * Which places to load and which to drop for camera ground point (E, N): `load` = 3D places
 * ('3d' / 'building') within 8 km that are not `active` yet, nearest first (the `first` id, e.g. a
 * fly-to target, goes in front); `drop` = active places beyond 12 km (hysteresis in between).
 */
export function planPlaces(
  places: readonly CatalogPlace[],
  E: number,
  N: number,
  active: ReadonlySet<string>,
  first?: string,
): { load: string[]; drop: string[] } {
  const near: Array<{ id: string; d: number }> = [];
  const drop: string[] = [];
  for (const p of places) {
    if (p.status === 'stats') continue;
    const d = distanceToBbox(E, N, p.bbox);
    if (active.has(p.id)) {
      if (d > PLACE_DROP_M && p.id !== first) drop.push(p.id);
    } else if (d <= PLACE_LOAD_M || p.id === first) {
      near.push({ id: p.id, d: p.id === first ? -1 : d });
    }
  }
  near.sort((a, b) => a.d - b.d);
  return { load: near.map((x) => x.id), drop };
}

/** Place under / nearest to (E, N) by owned tile, else by bbox distance (3D places preferred). */
export function placeAt(cat: Catalog, E: number, N: number): CatalogPlace | undefined {
  const owner = cat.owners.get(tileId(Math.floor(E / TILE_M) * TILE_M, Math.floor(N / TILE_M) * TILE_M));
  if (owner) return cat.byId.get(owner);
  return undefined;
}

/**
 * Fetch + parse the catalog (`cache: 'no-cache'`, CORS without credentials). Throws on any failure
 * (the caller falls back to single-AOI mode).
 */
export async function loadCatalog(url: string, fetchFn: typeof fetch = fetch): Promise<Catalog> {
  const res = await fetchFn(url, { cache: 'no-cache', mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`catalog: HTTP ${res.status}`);
  const text = await res.text();
  if (!text.trimStart().startsWith('{')) throw new Error('catalog: not JSON');
  return parseCatalog(JSON.parse(text), res.url || url);
}
