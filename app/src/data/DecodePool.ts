import type { DecodeKind, WorkerRequest, WorkerResponse } from './protocol';

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void };

/** Small round-robin pool of decode workers with promise-based requests. */
export class DecodePool {
  private readonly workers: Worker[] = [];
  private readonly busy: number[] = [];
  private readonly pending = new Map<number, Pending & { worker: number }>();
  private nextId = 1;

  constructor(size = Math.min(4, Math.max(1, (navigator.hardwareConcurrency ?? 4) - 1))) {
    for (let k = 0; k < size; k++) {
      const w = new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onMessage(ev.data);
      w.onerror = (ev) => console.error('[decode worker]', ev.message);
      this.workers.push(w);
      this.busy.push(0);
    }
  }

  private onMessage(msg: WorkerResponse): void {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    this.busy[p.worker]--;
    if (msg.type === 'error') p.reject(new Error(msg.message));
    else p.resolve(msg);
  }

  private post(req: WorkerRequest, transfer: Transferable[] = []): Promise<WorkerResponse> {
    // Least-busy worker.
    let wi = 0;
    for (let k = 1; k < this.workers.length; k++) if (this.busy[k] < this.busy[wi]) wi = k;
    this.busy[wi]++;
    return new Promise((resolve, reject) => {
      this.pending.set(req.id, { resolve, reject, worker: wi });
      this.workers[wi].postMessage(req, transfer);
    });
  }

  async decodeHeights(url: string): Promise<{ width: number; height: number; data: Float32Array }> {
    const r = await this.post({ type: 'decode', id: this.nextId++, url, kind: 'terrarium' });
    if (r.type !== 'decoded' || r.kind !== 'terrarium') throw new Error('unexpected worker reply');
    return r;
  }

  async decodeU8(url: string): Promise<{ width: number; height: number; data: Uint8Array }> {
    const r = await this.post({ type: 'decode', id: this.nextId++, url, kind: 'u8' as DecodeKind });
    if (r.type !== 'decoded' || r.kind !== 'u8') throw new Error('unexpected worker reply');
    return r;
  }

  private avif: Promise<boolean> | null = null;

  /**
   * Can this browser decode AVIF? Probed once in a decode worker (contract "Slim formats"); without
   * AVIF every `.avif` layer counts as absent (`stripAvif`).
   */
  avifSupported(): Promise<boolean> {
    this.avif ??= this.post({ type: 'probe-avif', id: this.nextId++ })
      .then((r) => r.type === 'probed' && r.avif)
      .catch(() => false);
    return this.avif;
  }

  /**
   * Box-blur `data` off the main thread. `data` is transferred (unusable afterwards). With
   * `crop` = [x, y, w, h] only that window of the result is returned.
   */
  async boxBlur(
    data: Float32Array,
    width: number,
    height: number,
    radius: number,
    crop?: [number, number, number, number],
  ): Promise<Float32Array> {
    const r = await this.post(
      { type: 'boxblur', id: this.nextId++, data, width, height, radius, ...(crop ? { crop } : {}) },
      [data.buffer],
    );
    if (r.type !== 'blurred') throw new Error('unexpected worker reply');
    return r.data;
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    for (const p of this.pending.values()) p.reject(new Error('DecodePool disposed'));
    this.pending.clear();
  }
}
