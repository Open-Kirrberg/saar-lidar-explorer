/**
 * Line styles per vector kind (pure). Colours are display-space sRGB (custom shaders write
 * display colours), chosen to stay readable over grey VAT and the blue–white–red local relief;
 * each line gets a dark casing so it also reads over bright relief.
 */
import type { OsmKind } from '../data/manifest';

export interface LineStyle {
  key: string;
  label_de: string;
  color: [number, number, number]; // 0–1, display space
  width: number; // core width in CSS px (near the camera)
}

const hex = (h: number): [number, number, number] => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

/** Style index = position in this list; used as the per-segment `style` attribute. */
export const STYLES: LineStyle[] = [
  { key: 'road', label_de: 'Straße', color: hex(0xffd23a), width: 3.2 },
  { key: 'track', label_de: 'Wirtschaftsweg', color: hex(0xff8a1f), width: 2.4 },
  { key: 'path', label_de: 'Pfad / Fußweg', color: hex(0xff5ad8), width: 1.9 },
  { key: 'rail', label_de: 'Bahn', color: hex(0xd8dde3), width: 2.4 },
  { key: 'water', label_de: 'Gewässer', color: hex(0x35b6ff), width: 2.2 },
  { key: 'barrier', label_de: 'Mauer / Graben', color: hex(0x7dff6a), width: 1.5 },
  { key: 'parcel', label_de: 'Flurstücksgrenze', color: hex(0xfff3a8), width: 1.2 },
];

/** Uniform slots per DrapedLines material (OSM: 7; candidates: 7 classes + known path + selected). */
export const MAX_STYLES = 12;

const OSM_KINDS: readonly OsmKind[] = ['road', 'track', 'path', 'rail', 'water', 'barrier'];
export const PARCEL_STYLE = STYLES.findIndex((s) => s.key === 'parcel');

/** Style index for an OSM feature's properties; unknown kinds → -1 (skipped). */
export function osmStyleOf(props: Record<string, unknown>): number {
  const k = props.kind;
  return typeof k === 'string' && (OSM_KINDS as readonly string[]).includes(k) ? STYLES.findIndex((s) => s.key === k) : -1;
}

/** Parcel boundaries: every line feature gets the parcel style. */
export function parcelStyleOf(): number {
  return PARCEL_STYLE;
}
