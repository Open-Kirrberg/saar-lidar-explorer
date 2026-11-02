/**
 * F18 map snippet: compose the AOI's own relief XYZ tiles (same origin, no online map services)
 * around one point on a canvas, then draw the marker, a scale bar and a north arrow.
 * Web Mercator is north-up (true north); the scale is exact at the snippet centre.
 */
import type { XyzSource } from '../data/manifest';
import { resolveDataPath } from '../data/urls';
import { formatDistance, metersPerPixel, niceScaleLength, tileIntersectsBounds, tilesForView } from './format';

export interface MapSnippet {
  image: string;
  zoom: number;
  metersPerPixel: number;
  tilesDrawn: number;
  tilesMissing: number;
}

export interface MapSnippetOptions {
  width?: number;
  height?: number;
  zoom: number;
  /** Max tiles fetched in parallel (polite even to the local dev server). */
  parallel?: number;
}

async function loadTile(url: string): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (type && !type.startsWith('image/')) return null; // dev servers answer HTML for missing files
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}

export async function renderMapSnippet(
  baseUrl: string,
  xyz: XyzSource,
  lat: number,
  lon: number,
  opts: MapSnippetOptions,
): Promise<MapSnippet> {
  const width = opts.width ?? 800;
  const height = opts.height ?? 600;
  const z = Math.max(xyz.minZoom, Math.min(xyz.maxZoom, Math.round(opts.zoom)));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#d9dcde';
  g.fillRect(0, 0, width, height);

  const tiles = tilesForView(lat, lon, z, width, height).filter((t) => tileIntersectsBounds(t.x, t.y, t.z, xyz.bounds));
  let drawn = 0;
  let missing = 0;
  const queue = [...tiles];
  const worker = async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      const url = resolveDataPath(baseUrl, xyz.url.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y)));
      const bmp = await loadTile(url);
      if (bmp) {
        g.drawImage(bmp, t.dx, t.dy);
        bmp.close();
        drawn++;
      } else missing++;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.parallel ?? 4) }, worker));

  const mpp = metersPerPixel(lat, z);
  drawMarker(g, width / 2, height / 2);
  drawScaleBar(g, mpp, 14, height - 14);
  drawNorthArrow(g, width - 40, 44);
  return { image: canvas.toDataURL('image/jpeg', 0.9), zoom: z, metersPerPixel: mpp, tilesDrawn: drawn, tilesMissing: missing };
}

function drawMarker(g: CanvasRenderingContext2D, x: number, y: number): void {
  g.save();
  g.lineWidth = 4;
  g.strokeStyle = '#fff';
  g.beginPath();
  g.arc(x, y, 16, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2.5;
  g.strokeStyle = '#e4572e';
  g.beginPath();
  g.arc(x, y, 16, 0, Math.PI * 2);
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    g.moveTo(x + dx * 22, y + dy * 22);
    g.lineTo(x + dx * 32, y + dy * 32);
  }
  g.stroke();
  g.fillStyle = '#e4572e';
  g.beginPath();
  g.arc(x, y, 2.5, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function drawScaleBar(g: CanvasRenderingContext2D, mpp: number, x: number, y: number): void {
  const maxPx = Math.min(260, g.canvas.width * 0.38);
  const len = niceScaleLength(maxPx * mpp);
  if (!len) return;
  const px = len / mpp;
  const label = formatDistance(len);
  g.save();
  g.font = '600 22px "Helvetica Neue", Arial, sans-serif';
  const tw = g.measureText(label).width;
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillRect(x - 8, y - 42, Math.max(px, tw) + 16, 50);
  g.fillStyle = '#1d2124';
  g.fillRect(x, y - 10, px / 2, 8);
  g.fillStyle = '#fff';
  g.fillRect(x + px / 2, y - 10, px / 2, 8);
  g.strokeStyle = '#1d2124';
  g.lineWidth = 1.5;
  g.strokeRect(x, y - 10, px, 8);
  g.fillStyle = '#1d2124';
  g.textBaseline = 'bottom';
  g.fillText(label, x, y - 14);
  g.restore();
}

function drawNorthArrow(g: CanvasRenderingContext2D, x: number, y: number): void {
  g.save();
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath();
  g.arc(x, y + 6, 34, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1d2124';
  g.beginPath();
  g.moveTo(x, y - 20);
  g.lineTo(x + 11, y + 10);
  g.lineTo(x, y + 4);
  g.lineTo(x - 11, y + 10);
  g.closePath();
  g.fill();
  g.font = '700 18px "Helvetica Neue", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'top';
  g.fillText('N', x, y + 13);
  g.restore();
}
