/**
 * Catalog mode (S2): keeps the v3 manifests of the 3D places around the camera (≤ 8 km load,
 * > 12 km drop, nearest first, ≤ 3 in flight) and hands their state to the CatalogResolver. Fetches
 * with CORS and without credentials; a failed / non-v3 / mismatching manifest makes the place
 * `failed` (= 'stats' for 3D, logged).
 */
import type { Catalog, CatalogPlace } from '../data/catalog';
import { planPlaces } from '../data/catalog';
import type { Manifest } from '../data/manifest';
import { stripAvif, validateManifest } from '../data/manifest';
import type { CatalogResolver } from '../terrain/sources';
import { placeManifestProblem } from '../terrain/sources';

const MAX_PARALLEL = 3;

export interface PlaceManagerOptions {
  /** AVIF decodable (else `.avif` layers are stripped from every place manifest). */
  avif: boolean;
  fetchFn?: typeof fetch;
  /** Called once when a manifest lost layers because the browser has no AVIF. */
  onAvifMissing?: () => void;
}

export class PlaceManager {
  private readonly active = new Set<string>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly queue: string[] = [];
  private readonly listeners = new Set<() => void>();
  private first: string | undefined;

  constructor(
    readonly catalog: Catalog,
    readonly resolver: CatalogResolver,
    private readonly opts: PlaceManagerOptions,
  ) {}

  /** Called when a place became ready / failed / dropped. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Ready places with their manifests (minimap tiles, attribution). */
  ready(): Array<{ place: CatalogPlace; manifest: Manifest; baseUrl: string }> {
    const out: Array<{ place: CatalogPlace; manifest: Manifest; baseUrl: string }> = [];
    for (const r of this.resolver.readyPlaces()) {
      const place = this.catalog.byId.get(r.id);
      if (place) out.push({ place, manifest: r.manifest, baseUrl: r.baseUrl });
    }
    return out;
  }

  /** Re-plan for the camera ground point (E, N): start loads, drop far places. Cheap; call ~2×/s. */
  update(E: number, N: number): void {
    const { load, drop } = planPlaces(this.catalog.places, E, N, this.active, this.first);
    for (const id of drop) {
      this.active.delete(id);
      const i = this.queue.indexOf(id);
      if (i >= 0) this.queue.splice(i, 1);
      if (!this.inFlight.has(id)) this.resolver.setPlace(id, { state: 'idle' }); // chunks leave through the LRU
      this.emit();
    }
    for (const id of load) {
      if (this.active.has(id)) continue;
      this.active.add(id);
      this.queue.push(id);
    }
    this.pump();
  }

  /** Load place `id` first (fly-to target / start place); resolves when it settled. */
  ensure(id: string): Promise<void> {
    this.first = id;
    if (!this.active.has(id)) {
      this.active.add(id);
      this.queue.unshift(id);
    } else {
      const i = this.queue.indexOf(id);
      if (i > 0) {
        this.queue.splice(i, 1);
        this.queue.unshift(id);
      }
    }
    this.pump();
    return this.inFlight.get(id) ?? Promise.resolve();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private pump(): void {
    while (this.inFlight.size < MAX_PARALLEL && this.queue.length) {
      const id = this.queue.shift()!;
      const st = this.resolver.placeLoad(id).state;
      if (st === 'ready' || st === 'failed' || this.inFlight.has(id)) continue;
      const p = this.load(id).finally(() => {
        this.inFlight.delete(id);
        if (!this.active.has(id)) this.resolver.setPlace(id, { state: 'idle' });
        this.emit();
        this.pump();
      });
      this.inFlight.set(id, p);
    }
  }

  private async load(id: string): Promise<void> {
    const place = this.catalog.byId.get(id);
    if (!place?.dataUrl) return;
    this.resolver.setPlace(id, { state: 'loading' });
    const fetchFn = this.opts.fetchFn ?? fetch;
    try {
      const res = await fetchFn(`${place.dataUrl}manifest.json`, { cache: 'no-cache', mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.trimStart().startsWith('{')) throw new Error('not JSON');
      const m = validateManifest(JSON.parse(text));
      const problem = placeManifestProblem(m, place);
      if (problem) throw new Error(problem);
      if (!this.opts.avif && stripAvif(m) > 0) this.opts.onAvifMissing?.();
      this.resolver.setPlace(id, { state: 'ready', manifest: m, baseUrl: place.dataUrl });
    } catch (err) {
      console.warn(`[catalog] place ${id}: ${String(err)} → no 3D (treated as 'stats')`);
      this.resolver.setPlace(id, { state: 'failed', reason: String(err) });
    }
  }
}
