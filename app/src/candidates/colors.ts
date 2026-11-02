/**
 * Candidate class colours (pure). Display-space sRGB, picked to stay distinct from each other,
 * from the OSM line styles and readable over grey VAT and the blue–white–red local relief.
 */
import type { CandidateClass } from '../data/manifest';

export const CLASS_COLORS: Readonly<Record<CandidateClass, number>> = {
  pit: 0x00e5ff, // cyan
  mound: 0xffb000, // amber
  linear: 0xb4ff39, // lime
  rect: 0xff4fd8, // pink
  platform: 0xa98bff, // violet
  // F22 UXO indicators: one red family (a field is a cluster of craters), apart from the relict hues.
  crater: 0xff2e2e, // signal red
  crater_field: 0xff9a8a, // light coral (field outline)
};
/** Known path: `linear` + `along_path` ("Weg (bekannt)"). */
export const KNOWN_PATH_COLOR = 0xc9c9c9;
export const SELECTED_COLOR = 0xffffff;

export const hexCss = (h: number): string => `#${h.toString(16).padStart(6, '0')}`;
export const hexRgb = (h: number): [number, number, number] => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

export function candidateColor(c: { cls: CandidateClass; alongPath: boolean }): number {
  return c.cls === 'linear' && c.alongPath ? KNOWN_PATH_COLOR : CLASS_COLORS[c.cls];
}
