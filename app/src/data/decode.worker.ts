/**
 * Fetch + decode worker. Heights are decoded without any colour management:
 * createImageBitmap(..., { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
 * then read back through an OffscreenCanvas. Results are posted as transferables.
 */
import { boxBlur, cropRaster } from './boxBlur';
import type { WorkerRequest, WorkerResponse } from './protocol';
import { decodeTerrarium } from './terrarium';

interface WorkerScope {
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(msg: WorkerResponse, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

function readPixels(bmp: ImageBitmap): ImageData {
  if (!canvas || canvas.width !== bmp.width || canvas.height !== bmp.height) {
    canvas = new OffscreenCanvas(bmp.width, bmp.height);
    ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
  }
  if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height, { colorSpace: 'srgb' });
}

async function decode(url: string, kind: 'terrarium' | 'u8'): Promise<WorkerResponse & { type: 'decoded' }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const blob = await res.blob();
  if (!blob.type.startsWith('image/') && blob.type !== 'application/octet-stream' && blob.type !== '') {
    throw new Error(`Not an image (${blob.type}): ${url}`);
  }
  const bmp = await createImageBitmap(blob, {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  const { width, height } = bmp;
  const img = readPixels(bmp);
  bmp.close();
  const n = width * height;
  if (kind === 'terrarium') {
    return { type: 'decoded', id: 0, kind, width, height, data: decodeTerrarium(img.data, n, 4) };
  }
  const data = new Uint8Array(n);
  for (let k = 0; k < n; k++) data[k] = img.data[k * 4]; // grayscale → R channel
  return { type: 'decoded', id: 0, kind, width, height, data };
}

scope.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'decode') {
      const out = await decode(msg.url, msg.kind);
      out.id = msg.id;
      scope.postMessage(out, [out.data.buffer]);
    } else if (msg.type === 'boxblur') {
      const full = boxBlur(msg.data, msg.width, msg.height, msg.radius);
      const data = msg.crop ? cropRaster(full, msg.width, ...msg.crop) : full;
      const out: WorkerResponse = { type: 'blurred', id: msg.id, data };
      scope.postMessage(out, [data.buffer]);
    }
  } catch (err) {
    const out: WorkerResponse = { type: 'error', id: msg.id, message: String(err) };
    scope.postMessage(out);
  }
};
