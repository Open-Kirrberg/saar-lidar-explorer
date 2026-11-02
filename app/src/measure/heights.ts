/**
 * 1 m heights for measuring (F17). The terrain streams level 0 only near the camera, but a
 * profile drawn from far above must still use the 1 m DTM: this cache takes the level-0 (and DSM)
 * chunks along a line from the terrain when resident, else fetches + decodes them itself (one
 * lazy decode worker). Anything still missing falls back to the terrain's finest resident level,
 * reported per sample as its level so the UI can warn.
 */
import { chunkUrl } from '../data/manifest';
import { DecodePool } from '../data/DecodePool';
import { heightImageSize } from '../data/grid';
import { HeightQuery } from '../terrain/HeightQuery';
import { runLimited } from './limit';
import type { Terrain } from '../terrain/Terrain';
import type { LevelHeight } from './profile';

/** Keep at most this many fetched chunks per kind (≈ 1 MB each) beyond what one line needs. */
const KEEP = 32;

export class MeasureHeights {
  private readonly dtm: HeightQuery;
  private readonly dsm: HeightQuery | null;
  private readonly failedDtm = new Set<string>();
  private readonly failedDsm = new Set<string>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly lru: string[] = [];
  private pool: DecodePool | null = null;

  constructor(private readonly terrain: Terrain) {
    const m = terrain.manifest;
    this.dtm = new HeightQuery(terrain.grid, m.chunks.nx, m.chunks.ny);
    this.dsm = m.height.dsm ? new HeightQuery(terrain.grid, m.chunks.nx, m.chunks.ny) : null;
  }

  get hasDsm(): boolean {
    return !!this.dsm;
  }

  /** Level-0 chunk key used at world (x, z) (edge-clamped like the terrain). */
  keyAt = (x: number, z: number): string => this.dtm.chunkKeyAt(x, z);

  /** True DTM height: own/terrain level 0 first, else the terrain's finest resident level. */
  dtmAt(x: number, z: number): LevelHeight {
    if (!this.terrain.heights.contains(x, z)) return { h: NaN, level: -1 };
    let h = this.dtm.heightAt(x, z);
    if (!Number.isNaN(h)) return { h, level: 0 };
    h = this.terrain.heights.levels[0].heightAt(x, z);
    if (!Number.isNaN(h)) return { h, level: 0 };
    const level = this.terrain.heights.levelAt(x, z);
    return { h: level >= 0 ? this.terrain.heights.heightAt(x, z) : NaN, level };
  }

  /** True DSM height (NaN where no DSM chunk is available). */
  dsmAt(x: number, z: number): number {
    if (!this.dsm || !this.terrain.heights.contains(x, z)) return NaN;
    const h = this.dsm.heightAt(x, z);
    return Number.isNaN(h) ? this.terrain.canopyHeightAt(x, z) : h;
  }

  /** Are all level-0 DTM chunks of these keys available (or known to be missing)? */
  ready(keys: readonly string[], withDsm: boolean): boolean {
    const ok = keys.every((k) => this.hasDtm(k) && (!withDsm || !this.dsm || this.hasDsm_(k)));
    // Adopted terrain chunks enter the LRU (hasDtm/hasDsm_) — keep the KEEP bound.
    this.trim(keys.length);
    return ok;
  }

  /**
   * Make the level-0 DTM (and optionally DSM) chunks of `keys` available. Resolves with the number
   * of DTM chunks that could not be loaded (those samples use a coarser level).
   */
  async ensure(keys: readonly string[], withDsm: boolean): Promise<{ failedDtm: number; failedDsm: number }> {
    const jobs: (() => Promise<void>)[] = [];
    for (const key of keys) {
      const [i, j] = key.split('_').map(Number);
      // fetches start lazily in the queue (re-checked then: the terrain may have streamed it meanwhile)
      if (!this.hasDtm(key)) jobs.push(() => (this.hasDtm(key) ? Promise.resolve() : this.load('dtm', i, j)));
      if (withDsm && this.dsm && !this.hasDsm_(key)) jobs.push(() => (this.hasDsm_(key) ? Promise.resolve() : this.load('dsm', i, j)));
      this.touch(key);
    }
    // ≤ 3 started per call (the terrain's own streaming keeps its share of the network).
    await runLimited(jobs, 3);
    this.trim(keys.length);
    return {
      failedDtm: keys.filter((k) => this.failedDtm.has(k)).length,
      failedDsm: withDsm && this.dsm ? keys.filter((k) => this.failedDsm.has(k)).length : 0,
    };
  }

  private hasDtm(key: string): boolean {
    const [i, j] = key.split('_').map(Number);
    if (this.dtm.has(i, j) || this.failedDtm.has(key)) return true;
    const resident = this.terrain.heights.levels[0].chunk(i, j);
    if (resident) {
      this.dtm.add(i, j, resident); // shared reference, no copy
      this.touch(key); // tracked by the LRU so trim() can release it after the terrain evicts it
      return true;
    }
    return false;
  }

  private hasDsm_(key: string): boolean {
    if (!this.dsm) return true;
    const [i, j] = key.split('_').map(Number);
    if (this.dsm.has(i, j) || this.failedDsm.has(key)) return true;
    const resident = this.terrain.canopyHeights.chunk(i, j);
    if (resident) {
      this.dsm.add(i, j, resident);
      this.touch(key);
      return true;
    }
    return false;
  }

  private load(kind: 'dtm' | 'dsm', i: number, j: number): Promise<void> {
    const id = `${kind}:${i}_${j}`;
    const running = this.loading.get(id);
    if (running) return running;
    const m = this.terrain.manifest;
    const src = kind === 'dtm' ? m.height.dtm : m.height.dsm!;
    const q = kind === 'dtm' ? this.dtm : this.dsm!;
    const failed = kind === 'dtm' ? this.failedDtm : this.failedDsm;
    const p = (async () => {
      try {
        this.pool ??= new DecodePool(1);
        const { data, width } = await this.pool.decodeHeights(chunkUrl(this.terrain.baseUrl, src.path, i, j));
        if (width !== heightImageSize(this.terrain.grid)) throw new Error(`${width}px`);
        q.add(i, j, data);
      } catch (err) {
        failed.add(`${i}_${j}`);
        console.warn(`[measure] ${kind} ${i}_${j}: ${String(err)}`);
      } finally {
        this.loading.delete(id);
      }
    })();
    this.loading.set(id, p);
    return p;
  }

  private touch(key: string): void {
    const k = this.lru.indexOf(key);
    if (k >= 0) this.lru.splice(k, 1);
    this.lru.push(key);
  }

  /** Drop the least recently used chunks beyond KEEP (+ the current line's need). */
  private trim(need: number): void {
    const max = Math.max(KEEP, need);
    while (this.lru.length > max) {
      const key = this.lru.shift()!;
      const [i, j] = key.split('_').map(Number);
      this.dtm.remove(i, j);
      this.dsm?.remove(i, j);
    }
  }

  dispose(): void {
    this.pool?.dispose();
    this.pool = null;
  }
}
