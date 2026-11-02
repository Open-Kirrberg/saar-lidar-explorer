/**
 * Loads vector layers through `vectors.worker.ts` (one worker, created on first use) so the large
 * overall-AOI GeoJSON (~25 MB parcels) is parsed off the main thread. Falls back to the main
 * thread if the worker cannot be created or crashes.
 */
import { fetchText, handleVectorRequest } from './vectorData';
import type { LineLayerData, LineStyleKind, PointLayerData, Timings, VectorRequest, VectorResponse } from './vectorData';
import type { Origin } from './drape';
import type { ParcelPolygonData } from './parcelPolygons';

type Pending = (r: VectorResponse) => void;

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./vectors.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<VectorResponse>) => {
      const p = pending.get(ev.data.id);
      pending.delete(ev.data.id);
      p?.(ev.data);
    };
    worker.onerror = (ev) => {
      console.warn('[vectors] worker error, falling back to main thread', ev.message);
      workerBroken = true;
      worker?.terminate();
      worker = null;
      for (const [id, p] of pending) p({ id, ok: false, error: 'worker-crashed' });
      pending.clear();
    };
    return worker;
  } catch (err) {
    console.warn('[vectors] no worker, parsing on the main thread', err);
    workerBroken = true;
    return null;
  }
}

type NoId<T> = T extends unknown ? Omit<T, 'id'> : never;

async function request(req: NoId<VectorRequest>): Promise<VectorResponse> {
  const full = { ...req, id: nextId++ } as VectorRequest;
  const w = getWorker();
  if (w) {
    const res = await new Promise<VectorResponse>((resolve) => {
      pending.set(full.id, resolve);
      w.postMessage(full);
    });
    if (res.ok || res.error !== 'worker-crashed') return res;
  }
  return (await handleVectorRequest(full, fetchText)).res;
}

const abs = (url: string) => new URL(url, location.href).href;

const logTimings = (what: string, t: Timings, bytes: number) =>
  console.info(
    `[vectors] ${what}: ${(bytes / 1e6).toFixed(1)} MB, fetch ${t.fetchMs.toFixed(0)} ms, parse ${t.parseMs.toFixed(0)} ms, build ${t.buildMs.toFixed(0)} ms (off main thread: ${!workerBroken})`,
  );

export async function loadLineLayer(
  url: string,
  origin: Origin,
  style: LineStyleKind,
  bucketSize: number,
  fallbackH: number,
): Promise<LineLayerData> {
  const res = await request({ kind: 'lines', url: abs(url), origin: { E0: origin.E0, N0: origin.N0 }, style, bucketSize, fallbackH });
  if (!res.ok) throw new Error(res.error);
  if (res.kind !== 'lines') throw new Error('unexpected response');
  logTimings(`${style} lines`, res.timings, res.bytes);
  return res.data;
}

export async function loadPointLayer(url: string, origin: Origin): Promise<PointLayerData> {
  const res = await request({ kind: 'points', url: abs(url), origin: { E0: origin.E0, N0: origin.N0 } });
  if (!res.ok) throw new Error(res.error);
  if (res.kind !== 'points') throw new Error('unexpected response');
  logTimings('labels', res.timings, res.bytes);
  return res.data;
}

/** `vectors.flurstuecke.polygons` → packed polygons (parsed in the worker). Throws on 404 / bad file. */
export async function loadParcelPolygons(url: string): Promise<ParcelPolygonData> {
  const res = await request({ kind: 'polygons', url: abs(url) });
  if (!res.ok) throw new Error(res.error);
  if (res.kind !== 'polygons') throw new Error('unexpected response');
  logTimings('parcel polygons', res.timings, res.bytes);
  if (res.data.skipped) console.warn(`[vectors] parcel polygons: ${res.data.skipped} features skipped`);
  return res.data;
}
