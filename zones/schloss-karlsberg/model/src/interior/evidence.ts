/** Small pure helpers shared by the interior modules (no three.js). */
import { EVIDENCE_TAGS, type EvidenceTag, parseEvidenceTags } from '../spec.ts';

/** Evidence letters of free-text tags ("I 05 §e.1 ...; N" -> "I N"); 'I' when none found. */
export function evidenceLetters(tags: string[]): string {
  const found = new Set<EvidenceTag>(tags.flatMap((t) => parseEvidenceTags(t)));
  return EVIDENCE_TAGS.filter((x) => found.has(x)).join(' ') || 'I';
}

/**
 * Upholstery / silk colour per wall finish (02 §2.12 [N]). Silk-hung rooms take their wall silk. White-and-gold
 * boiserie rooms take crimson damask, the period-normal state-room covering with gilt frames (research/02 §3 finish
 * table: silk damask crimson #8E1F2A [N]; research/09 §3: Lyon silks and multicoloured damasks for Karlsberg's covers
 * [D de.wikipedia], colour per room U). Festsaal review (wave 2): the former tan #c9b27c sat next to the gilt
 * (#D4AF6A), so chairs and sofa read as solid gold blocks.
 */
export const BOISERIE_SILK = '#8E1F2A';
/**
 * Wave-5 review (Gelber Salon, pose 27): a seat suite covered in the wall yellow on gilt frames merged with the walls
 * into one mustard tone, against Mannlich's rule of contrasting colours (T1 p. 365 [D]). Light silk grounds (yellow,
 * grey) therefore get a pearl-white silk cover, the period's "meuble" in a contrasting ground [N; hue I].
 */
export const PEARL_COVER = '#E8E0CC';
const lum = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export function silkColour(walls: string | undefined, colour?: string): string {
  // KB-I27: a named room colour (catalogue finish.colour) covers the seats in the same damask (gallery: T1 pp. 374 f.)
  const hue = colour && walls?.startsWith('wall.silk') ? colour : walls === 'wall.silk.yellow' ? '#C9A94E' : walls === 'wall.silk.grey' ? '#9EA19B' : null;
  if (hue) return lum(hue) > 0.3 ? PEARL_COVER : hue;
  if (walls === 'wall.silk.crimson') return '#9a2433';
  if (walls === 'wall.silk.blue') return '#46679a';
  if (walls === 'wall.silk.green') return '#6a8a5c';
  return BOISERIE_SILK;
}
