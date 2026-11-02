/** Pure helpers for Flurstück label points (vectors.flurstuecke.labels). */
import type { ParcelLabelProps } from '../data/manifest';
import { toLocal } from './drape';
import type { Origin } from './drape';

export interface ParcelPoint {
  x: number;
  z: number;
  /** Baked TRUE height (z of [E, N, z], contract `heights: 'baked'`); NaN if absent. */
  h: number;
  props: ParcelLabelProps;
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

/** Parse the label FeatureCollection (Point features); bad features are skipped. */
export function parseParcelPoints(fc: unknown, origin: Origin): ParcelPoint[] {
  const feats = (fc as { features?: unknown })?.features;
  if (!Array.isArray(feats)) return [];
  const out: ParcelPoint[] = [];
  for (const f of feats as Array<{ geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> | null }>) {
    const g = f?.geometry;
    const c = g?.coordinates as unknown[] | undefined;
    if (g?.type !== 'Point' || !Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    const p = f.properties ?? {};
    const text = str(p.text);
    if (!text) continue;
    const { x, z } = toLocal(c[0] as number, c[1] as number, origin);
    const lage = str(p.lage);
    const h = c.length >= 3 && Number.isFinite(c[2]) ? (c[2] as number) : NaN;
    out.push({
      x,
      z,
      h,
      props: { text, flstkennz: str(p.flstkennz), gemarkung: str(p.gemarkung), flur: str(p.flur), ...(lage ? { lage } : {}) },
    });
  }
  return out;
}

/** "Flur 0" / "0" / "000" carry no Flur (RLP parcels have none) — treat as absent. */
const NO_FLUR = /^(flur\s*)?0+$/i;

/** "Gemarkung, Flur 3, Flurstück 12/4 („Lage“)" — same shape as the WFS-based `parcelLabel`. */
export function formatParcel(p: ParcelLabelProps): string {
  const raw = p.flur && !NO_FLUR.test(p.flur.trim()) ? p.flur : '';
  const flur = raw && /^\d+$/.test(raw) ? `Flur ${Number(raw)}` : raw;
  const parts = [p.gemarkung, flur, p.text ? `Flurstück ${p.text}` : ''].filter(Boolean);
  return parts.join(', ') + (p.lage ? ` („${p.lage}“)` : '');
}
