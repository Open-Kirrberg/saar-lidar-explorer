/**
 * KB-I21: rendered Fachwerk (research/09 §2.3, §6.1 G4, §6.5 C1). A building or storey flagged `facade.fachwerk` has a
 * 0.30 m outer wall and a shallow 0.12-0.15 m reveal (grammar FACHWERK) and the same lime render outside, so from
 * outside the only tell is the shallow window reveal. The one place that decides wall thickness and reveal per storey
 * for the exterior (facade.ts), the interiors (programme outer walls, generated halls) and the plan sheets. Pure.
 */
import type { Building } from '../spec.ts';
import { FACHWERK, WALL_THICKNESS } from './grammar.ts';

/** Storey indices that are timber-framed (none without `facade.fachwerk`). */
export function fachwerkStoreys(b: Pick<Building, 'facade' | 'storeys'>): number[] {
  const fw = b.facade?.fachwerk;
  if (!fw) return [];
  if (fw.storeys) return [...fw.storeys].sort((x, y) => x - y);
  return b.storeys.map((s, i) => ({ s, i })).filter(({ s }) => s.kind !== 'plinth' && s.kind !== 'basement' && s.kind !== 'mound').map(({ i }) => i);
}

export function isFachwerk(b: Pick<Building, 'facade' | 'storeys'>, storey: number): boolean {
  return fachwerkStoreys(b).includes(storey);
}

export interface OuterWall {
  /** Outer wall thickness (m). */
  thickness: number;
  /** Depth of the window / door frame plane behind the wall face (m). */
  reveal: number;
  fachwerk: boolean;
}

/**
 * Outer wall of `storey` (undefined = the main / ground-floor wall: Fachwerk only when every walled storey is). Masonry
 * walls keep the class thickness (grammar WALL_THICKNESS) and the masonry frame plane.
 */
export function outerWall(b: Pick<Building, 'facade' | 'storeys' | 'cls'>, storey?: number): OuterWall {
  const fw = fachwerkStoreys(b);
  const all = b.storeys.filter((s) => s.kind !== 'plinth' && s.kind !== 'basement' && s.kind !== 'mound').length;
  const on = storey === undefined ? fw.length > 0 && fw.length >= all : fw.includes(storey);
  if (on) return { thickness: FACHWERK.wall, reveal: FACHWERK.reveal, fachwerk: true };
  return { thickness: WALL_THICKNESS[b.cls] ?? 0.6, reveal: FACHWERK.masonryReveal, fachwerk: false };
}
