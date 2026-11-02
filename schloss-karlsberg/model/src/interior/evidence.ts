/** Small pure helpers shared by the interior modules (no three.js). */
import { EVIDENCE_TAGS, type EvidenceTag, parseEvidenceTags } from '../spec.ts';

/** Evidence letters of free-text tags ("I 05 §e.1 ...; N" -> "I N"); 'I' when none found. */
export function evidenceLetters(tags: string[]): string {
  const found = new Set<EvidenceTag>(tags.flatMap((t) => parseEvidenceTags(t)));
  return EVIDENCE_TAGS.filter((x) => found.has(x)).join(' ') || 'I';
}

/** Upholstery / silk colour per wall finish (02 §2.12 [N]). */
export function silkColour(walls: string | undefined): string {
  if (walls === 'wall.silk.crimson') return '#9a2433';
  if (walls === 'wall.silk.blue') return '#46679a';
  if (walls === 'wall.silk.green') return '#6a8a5c';
  return '#c9b27c';
}
