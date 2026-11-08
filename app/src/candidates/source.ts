/**
 * F15 candidate data for both session modes — one source shared by the review card (Candidates.ts,
 * Labor) and the Relikt-Blick lens (lens/Lens.ts).
 *
 * - **Single-AOI:** `ctx.manifest.candidates`, one file relative to the AOI (as before).
 * - **Catalog (S2):** every ready place whose manifest has `candidates` and whose catalog entry does
 *   not opt out (`options.relict_candidates === false`, ADR 0053) contributes its file
 *   (`<data_url><path>`). Candidates carry absolute EPSG:25832 coordinates, so the session frame
 *   (`ctx.manifest.origin`) places them; no per-place offset is stored. Contract rule 6: a place's
 *   candidates belong to its present, owned tiles — anything else (a stale file, a border run) is
 *   dropped, and ids are kept once, so no candidate is drawn twice at a border. Places that load later
 *   add their candidates (onChange); candidates of places dropped by distance stay (small, N/P keeps
 *   working across places, a fly-to loads the place again).
 *
 * Review decisions and filter prefs live under `storageId` (`sle.candidates.v1.<id>`): the AOI, or
 * `katalog` in catalog mode (seeded once from the deployed single-AOI stores, reviewStore.ts).
 */
import type { CatalogPlace } from '../data/catalog';
import { chunkPresent, tileIdAt, TILE_M } from '../data/globalGrid';
import { CANDIDATE_CLASS_LABELS_DE, CANDIDATE_CLASSES } from '../data/manifest';
import type { CandidateClass, CandidateReviewStore, Manifest, ManifestCandidates } from '../data/manifest';
import type { AppContext } from '../main';
import { deployedAois } from '../data/urls';
import { parseCandidateCollection } from './candidateData';
import type { Candidate } from './candidateData';
import { loadReviews, loadReviewsSeeded } from './reviewStore';
import type { KV } from './reviewStore';

export interface CandidateSource {
  readonly mode: 'aoi' | 'catalog';
  /** Storage id of prefs + review decisions: the AOI id, or 'katalog'. */
  readonly storageId: string;
  /** Can this session show candidates at all (feature availability)? */
  readonly available: boolean;
  /** Current metadata (catalog: merged over the loaded places; defaults until one loaded). */
  meta(): ManifestCandidates;
  /** Load (idempotent). True when the data (single) / at least one place file (catalog) loaded. */
  load(): Promise<boolean>;
  /** All loaded candidates, score-descending (null before the first successful load). */
  all(): Candidate[] | null;
  /** Fires when more candidates arrived (catalog: a place became ready after load()). */
  onChange(fn: () => void): () => void;
  /**
   * Is (E, N) in the area whose candidates are loaded? Single-AOI: always. Catalog: the tile's
   * owner is a place whose candidate file loaded (review re-attachment is scoped to it).
   */
  loadedAt(E: number, N: number): boolean;
  /** German note for the place at (E, N) when it shows no candidates; '' otherwise / single-AOI. */
  noteAt(E: number, N: number): string;
}

/** Metadata used until a place with candidates loaded (labels, default min score 0.3). */
export function defaultCandidateMeta(): ManifestCandidates {
  return {
    path: '',
    crs: 'EPSG:25832',
    featureCount: 0,
    counts: {},
    classes: { ...CANDIDATE_CLASS_LABELS_DE },
    method: '',
    version: 0,
    params: {},
    label_de: 'Verdachtsflächen',
  };
}

/** Catalog: may this ready place show its candidates (manifest has them, catalog does not opt out)? */
export function placeCandidatesAllowed(place: Pick<CatalogPlace, 'options'>, m: Pick<Manifest, 'candidates'>): boolean {
  return !!m.candidates && place.options?.relict_candidates !== false;
}

/** Could any catalog place ever show candidates (a 3D place not opted out)? */
export function catalogMayHaveCandidates(places: readonly Pick<CatalogPlace, 'status' | 'options'>[]): boolean {
  return places.some((p) => p.status !== 'stats' && p.options?.relict_candidates !== false);
}

/**
 * Contract rule 6: keep the candidates whose point lies in a tile owned by `placeId` (catalog
 * `owners`) and present in the place manifest (`presence`, level-1 = tile bit).
 */
export function clipToPlace(
  cands: readonly Candidate[],
  placeId: string,
  owners: ReadonlyMap<string, string>,
  m: Pick<Manifest, 'origin' | 'size' | 'cellSize' | 'presence'>,
): Candidate[] {
  const cs = m.cellSize > 0 ? m.cellSize : 1;
  const nTop = m.origin.N0 + m.size.height * cs;
  return cands.filter((c) => {
    if (owners.get(tileIdAt(c.E, c.N)) !== placeId) return false;
    const col = Math.floor((c.E - m.origin.E0) / TILE_M);
    const row = Math.floor((nTop - c.N) / TILE_M);
    if (col < 0 || row < 0 || col * TILE_M >= m.size.width * cs || row * TILE_M >= m.size.height * cs) return false;
    return chunkPresent(m.presence, 1, col, row);
  });
}

/** Add `list` to `byId` (first id wins). Returns the number added. */
export function addCandidates(byId: Map<string, Candidate>, list: readonly Candidate[]): number {
  let n = 0;
  for (const c of list) {
    if (byId.has(c.id)) continue;
    byId.set(c.id, c);
    n++;
  }
  return n;
}

/** Score-descending order (ties by id), as the single-AOI file is sorted. */
export function sortCandidates(list: Candidate[]): Candidate[] {
  return list.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Session metadata over the loaded places: the first place's labels, params and method; counts and
 * featureCount over the clipped candidates; every method version once; the latest `generated`.
 */
export function mergeCandidateMeta(metas: readonly ManifestCandidates[], cands: readonly Candidate[]): ManifestCandidates {
  if (!metas.length) return defaultCandidateMeta();
  const base = metas[0];
  const counts: Partial<Record<CandidateClass, number>> = {};
  for (const c of cands) counts[c.cls] = (counts[c.cls] ?? 0) + 1;
  const versions: string[] = [];
  for (const m of metas) {
    const vs = m.method_versions?.length ? m.method_versions : [`${m.method || 'unbekannt'}${m.version ? ` v${m.version}` : ''}`];
    for (const v of vs) if (!versions.includes(v)) versions.push(v);
  }
  const generated = metas.map((m) => m.generated).filter((g): g is string => !!g).sort().pop();
  const classes = { ...base.classes };
  for (const k of CANDIDATE_CLASSES) classes[k] ??= CANDIDATE_CLASS_LABELS_DE[k];
  return {
    ...base,
    path: '',
    featureCount: cands.length,
    counts,
    classes,
    method_versions: versions,
    ...(generated ? { generated } : {}),
  };
}

function safeFetch(url: string): Promise<unknown> {
  return fetch(url, { mode: 'cors', credentials: 'omit' }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<unknown>;
  });
}

/** Review decisions of the session (catalog: `katalog`, seeded once from the deployed AOI stores). */
export function loadSourceReviews(src: Pick<CandidateSource, 'mode' | 'storageId'>, kv: KV | null | undefined): CandidateReviewStore {
  return src.mode === 'catalog' ? loadReviewsSeeded(kv, src.storageId, deployedAois() ?? ['overall']) : loadReviews(kv, src.storageId);
}

const cache = new WeakMap<AppContext, CandidateSource>();

/** The session's candidate source (one per app context). */
export function getCandidateSource(ctx: AppContext): CandidateSource {
  let s = cache.get(ctx);
  if (!s) {
    s = ctx.catalog ? catalogSource(ctx) : aoiSource(ctx);
    cache.set(ctx, s);
  }
  return s;
}

function aoiSource(ctx: AppContext): CandidateSource {
  const meta = ctx.manifest.candidates;
  let all: Candidate[] | null = null;
  let loading: Promise<boolean> | null = null;
  return {
    mode: 'aoi',
    storageId: ctx.manifest.aoi,
    available: !!meta,
    meta: () => meta ?? defaultCandidateMeta(),
    all: () => all,
    load() {
      if (!meta) return Promise.resolve(false);
      if (all) return Promise.resolve(true);
      loading ??= safeFetch(ctx.terrain.baseUrl + meta.path)
        .then((raw) => {
          const parsed = parseCandidateCollection(raw);
          if (parsed.skipped) console.warn(`[candidates] ${parsed.skipped} features skipped (class/geometry/score)`);
          all = parsed.candidates;
          return true;
        })
        .catch((err: unknown) => {
          console.warn('[candidates] could not load', meta.path, err);
          loading = null; // allow a retry
          return false;
        });
      return loading;
    },
    onChange: () => () => {},
    loadedAt: () => true,
    noteAt: () => '',
  };
}

function catalogSource(ctx: AppContext): CandidateSource {
  const cat = ctx.catalog!;
  const byId = new Map<string, Candidate>();
  /** Place id → its meta once its file loaded; failed places are not retried until reload. */
  const done = new Map<string, ManifestCandidates>();
  const failed = new Set<string>();
  const inFlight = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  let all: Candidate[] | null = null;
  let meta = defaultCandidateMeta();
  let active = false;

  const rebuild = () => {
    all = sortCandidates([...byId.values()]);
    meta = mergeCandidateMeta([...done.values()], all);
  };

  const loadPlace = (place: CatalogPlace, m: Manifest, baseUrl: string): Promise<void> => {
    let p = inFlight.get(place.id);
    if (p) return p;
    const cm = m.candidates!;
    p = safeFetch(baseUrl + cm.path)
      .then((raw) => {
        const parsed = parseCandidateCollection(raw);
        const kept = clipToPlace(parsed.candidates, place.id, cat.catalog.owners, m);
        const dropped = parsed.candidates.length - kept.length;
        if (parsed.skipped || dropped) console.info(`[candidates] ${place.id}: ${parsed.skipped} skipped, ${dropped} outside its tiles`);
        addCandidates(byId, kept);
        done.set(place.id, cm);
        rebuild();
      })
      .catch((err: unknown) => {
        console.warn(`[candidates] ${place.id}: could not load`, cm.path, err);
        failed.add(place.id);
      })
      .finally(() => inFlight.delete(place.id));
    inFlight.set(place.id, p);
    return p;
  };

  /** Load every ready, allowed place not loaded yet; resolves when those settled. */
  const sync = async (): Promise<boolean> => {
    const jobs: Promise<void>[] = [];
    for (const r of cat.places.ready()) {
      const id = r.place.id;
      if (done.has(id) || failed.has(id)) continue;
      if (!placeCandidatesAllowed(r.place, r.manifest)) continue;
      jobs.push(loadPlace(r.place, r.manifest, r.baseUrl));
    }
    if (!jobs.length) return false;
    await Promise.all(jobs);
    return true;
  };

  cat.places.onChange(() => {
    if (!active) return;
    void sync().then((added) => {
      if (added) for (const fn of listeners) fn();
    });
  });

  const ownerAt = (E: number, N: number): CatalogPlace | undefined => {
    const id = cat.catalog.owners.get(tileIdAt(E, N));
    return id ? cat.catalog.byId.get(id) : undefined;
  };

  return {
    mode: 'catalog',
    storageId: ctx.manifest.aoi,
    available: catalogMayHaveCandidates(cat.catalog.places),
    meta: () => meta,
    all: () => all,
    async load() {
      active = true;
      await sync();
      all ??= []; // nothing near yet (or the files failed): an empty list; places that load later add theirs
      return true;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    loadedAt: (E, N) => {
      const p = ownerAt(E, N);
      return !!p && done.has(p.id);
    },
    noteAt(E, N) {
      const p = ownerAt(E, N);
      if (!p) return '';
      if (done.has(p.id)) return '';
      if (p.status === 'stats') return `${p.name_de}: noch kein Detail-3D, daher keine Verdachtsflächen.`;
      if (p.options?.relict_candidates === false) {
        return `${p.name_de}: Verdachtsflächen sind hier nicht freigeschaltet – die Ortspatin oder der Ortspate kann sie einschalten.`;
      }
      const l = cat.resolver.placeLoad(p.id);
      if (l.state === 'ready' && !l.manifest.candidates) return `${p.name_de}: keine Verdachtsflächen veröffentlicht.`;
      if (failed.has(p.id)) return `${p.name_de}: Verdachtsflächen konnten nicht geladen werden.`;
      return `${p.name_de}: Verdachtsflächen laden …`;
    },
  };
}
