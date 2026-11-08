/**
 * Which source serves a chunk (data contract "Which source serves a chunk (catalog mode)"). Pure:
 * no three, no DOM, no fetch.
 *
 * Terrain nodes (k, i, j) are relative to the terrain rectangle (single-AOI: the manifest's; catalog
 * mode: the session rectangle on the global grid). A resolver maps a node to the source that
 * publishes it — the manifest (single-AOI), the owning place's v3 manifest (catalog, k ∈ {0, 1}) or
 * the central overview (catalog, k ≥ 2) — with the source-relative chunk indices and paths, or to
 * `none` (no source: never requested, never an error, never a hole) or `pending` (owner's manifest
 * still loading / not wanted yet: stops refinement).
 */
import type { CatalogPlace, Catalog } from '../data/catalog';
import type { Rect } from '../data/globalGrid';
import { bitAt, chunkPresent, chunkSide, GRID_E, GRID_N_TOP, tileOfChunk, toGlobal, toLocal } from '../data/globalGrid';
import type { DerivedMode, HeightSource, ImageLayerSource, LayerSource, Manifest } from '../data/manifest';
import type { Overview } from '../data/overview';

/** Paths and layers of one level of one source. */
export interface SourceLevel {
  height: { dtm: HeightSource; dsm?: HeightSource };
  layers: Record<string, LayerSource>;
  imageLayers?: Record<string, ImageLayerSource>;
}

export interface ChunkSource {
  /** 'aoi' (single-AOI), a catalog place id, or 'overview'. */
  id: string;
  /** Base URL (ending in '/') the level paths resolve against. */
  baseUrl: string;
  level: SourceLevel;
  /** Chunk indices relative to the source's own rectangle (its `{i}_{j}` in paths). */
  i: number;
  j: number;
  /** Level-0 derived relief modes of the source (v3), if any. */
  derived?: Record<string, DerivedMode>;
  /** v3 source (CHM-derived canopy; no dsm). */
  v3: boolean;
}

export type Resolved = ChunkSource | 'none' | 'pending';

export interface SourceResolver {
  /** Changes whenever a resolution may change (a place manifest arrived, failed or was dropped). */
  readonly version: number;
  resolve(level: number, i: number, j: number): Resolved;
}

const key = (k: number, i: number, j: number) => `${k}/${i}_${j}`;

/** Single-AOI mode: every chunk from the one manifest; a v3 manifest's absent tiles are `none`. */
export class AoiResolver implements SourceResolver {
  readonly version = 0;
  private readonly cache = new Map<string, Resolved>();

  constructor(
    private readonly manifest: Manifest,
    private readonly baseUrl: string,
  ) {}

  resolve(k: number, i: number, j: number): Resolved {
    const id = key(k, i, j);
    let r = this.cache.get(id);
    if (r === undefined) {
      const m = this.manifest;
      const lv = m.levels[k];
      if (!lv || (m.version === 3 && !chunkPresent(m.presence, k, i, j))) r = 'none';
      else r = { id: 'aoi', baseUrl: this.baseUrl, level: lv, i, j, ...(k === 0 && m.derived ? { derived: m.derived } : {}), v3: m.version === 3 };
      this.cache.set(id, r);
    }
    return r;
  }
}

/** State of one catalog place's manifest. */
export type PlaceLoad =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'failed'; reason: string }
  | { state: 'ready'; manifest: Manifest; baseUrl: string };

/** Rectangle (SW corner + size, metres) of a manifest. */
export function manifestRect(m: Manifest): Rect {
  const cs = m.cellSize ?? 1;
  return { E0: m.origin.E0, N0: m.origin.N0, W: m.size.width * cs, H: m.size.height * cs };
}

/**
 * Can a place manifest serve 3D in catalog mode? v3, valid grid on a 1 km aligned rectangle, valid
 * presence, `place.id` = the catalog id. Returns the reason when not.
 */
export function placeManifestProblem(m: Manifest, place: CatalogPlace): string | null {
  if (m.version !== 3) return `manifest version ${m.version} (not v3) → treated as 'stats'`;
  if (!m.gridOk) return 'grid missing/invalid or rectangle not aligned at 1 km';
  if (m.presenceInvalid) return 'presence invalid';
  if (!m.place || m.place.id !== place.id) return `place id ${m.place?.id ?? '(none)'} ≠ ${place.id}`;
  if (m.place.ags !== place.ags) return `place ags ${m.place.ags} ≠ ${place.ags}`;
  return null;
}

/**
 * Catalog mode: k ≥ 2 from the overview (presence bit), k ∈ {0, 1} from the owner of the tile
 * (catalog `tiles`), if its manifest is ready, valid and has the presence bit.
 */
export class CatalogResolver implements SourceResolver {
  version = 0;
  private readonly cache = new Map<string, Resolved>();
  private readonly loads = new Map<string, PlaceLoad>();
  private readonly ovRect: Rect | null;

  constructor(
    readonly catalog: Catalog,
    readonly overview: Overview | null,
    /** The terrain rectangle (session rectangle). */
    readonly rect: Rect,
  ) {
    const b = overview?.bbox;
    this.ovRect = b ? { E0: b[0], N0: b[1], W: b[2] - b[0], H: b[3] - b[1] } : null;
  }

  /** Current load state of place `id` (idle when unknown). */
  placeLoad(id: string): PlaceLoad {
    return this.loads.get(id) ?? { state: 'idle' };
  }

  /** Update a place's load state (invalidates the resolution cache). */
  setPlace(id: string, load: PlaceLoad): void {
    this.loads.set(id, load);
    this.cache.clear();
    this.version++;
  }

  /** Ready place manifests (id → manifest + base URL). */
  readyPlaces(): Array<{ id: string; manifest: Manifest; baseUrl: string }> {
    const out: Array<{ id: string; manifest: Manifest; baseUrl: string }> = [];
    for (const [id, l] of this.loads) if (l.state === 'ready') out.push({ id, manifest: l.manifest, baseUrl: l.baseUrl });
    return out;
  }

  resolve(k: number, i: number, j: number): Resolved {
    const id = key(k, i, j);
    let r = this.cache.get(id);
    if (r === undefined) {
      r = this.compute(k, i, j);
      this.cache.set(id, r);
    }
    return r;
  }

  private compute(k: number, i: number, j: number): Resolved {
    const { I, J } = toGlobal(k, i, j, this.rect);
    if (k >= 2) {
      const ov = this.overview;
      const lv = ov?.levels[k - 2];
      if (!ov || !lv || !this.ovRect) return 'none';
      const l = toLocal(k, I, J, this.ovRect);
      if (!bitAt(lv.presence, l.i, l.j)) return 'none';
      return { id: 'overview', baseUrl: ov.baseUrl, level: lv, i: l.i, j: l.j, v3: true };
    }
    const tile = tileOfChunk(k, I, J);
    const owner = tile ? this.catalog.owners.get(tile) : undefined;
    const place = owner ? this.catalog.byId.get(owner) : undefined;
    if (!place || place.status === 'stats') return 'none';
    const load = this.placeLoad(place.id);
    if (load.state === 'idle' || load.state === 'loading') return 'pending';
    if (load.state === 'failed') return 'none';
    const m = load.manifest;
    const lv = m.levels[k];
    if (!lv) return 'none';
    const l = toLocal(k, I, J, manifestRect(m));
    if (l.i < 0 || l.j < 0 || l.i >= lv.chunks.nx || l.j >= lv.chunks.ny) return 'none';
    if (!chunkPresent(m.presence, k, l.i, l.j)) return 'none';
    return { id: place.id, baseUrl: load.baseUrl, level: lv, i: l.i, j: l.j, ...(k === 0 && m.derived ? { derived: m.derived } : {}), v3: true };
  }
}

/**
 * The session rectangle of catalog mode: the overview bbox united with every 3D place's bbox,
 * snapped outward to S_K (K = coarsest level). Aligned at S_K, so every level 0…K has integer
 * global offsets.
 */
export function sessionRect(cat: Catalog, overview: Overview | null): { rect: Rect; topLevel: number } {
  const topLevel = overview && overview.levels.length ? overview.levels[overview.levels.length - 1].level : 1;
  const S = chunkSide(topLevel);
  let e0 = Infinity;
  let n0 = Infinity;
  let e1 = -Infinity;
  let n1 = -Infinity;
  const add = (b: readonly number[]) => {
    e0 = Math.min(e0, b[0]);
    n0 = Math.min(n0, b[1]);
    e1 = Math.max(e1, b[2]);
    n1 = Math.max(n1, b[3]);
  };
  if (overview) add(overview.bbox);
  for (const p of cat.places) if (p.status !== 'stats') add(p.bbox);
  if (!Number.isFinite(e0)) for (const p of cat.places) add(p.bbox);
  if (!Number.isFinite(e0)) throw new Error('catalog: no places');
  const snapDown = (v: number, o: number) => o + Math.floor((v - o) / S) * S;
  const snapUp = (v: number, o: number) => o + Math.ceil((v - o) / S) * S;
  const E0 = snapDown(e0, GRID_E);
  const E1 = snapUp(e1, GRID_E);
  // Snap from the north edge of the grid (alignment from the south and north is the same).
  const N1 = GRID_N_TOP - Math.floor((GRID_N_TOP - n1) / S) * S;
  const N0 = GRID_N_TOP - Math.ceil((GRID_N_TOP - n0) / S) * S;
  return { rect: { E0, N0, W: E1 - E0, H: N1 - N0 }, topLevel };
}

