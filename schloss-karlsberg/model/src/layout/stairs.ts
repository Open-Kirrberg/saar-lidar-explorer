/** Stair sizing from Blondel's rule 2R + T ≈ 0.65 m (research/02 §2.10) - pure. */
import { STAIR } from './grammar.ts';

export type StairClass = 'prunk' | 'secondary' | 'service' | 'freitreppe';

export interface StairRun {
  risers: number;
  riser: number;
  tread: number;
  /** Treads = risers − 1 (the upper floor is the last step). */
  treads: number;
  /** Horizontal length of all flights without landings. */
  going: number;
  /** Intermediate landings (one every STAIR.landingEvery risers). */
  landings: number;
  /** 2R + T (≈ 0.65). */
  blondel: number;
}

export function stairRun(rise: number, cls: StairClass): StairRun {
  if (rise <= 0) return { risers: 0, riser: 0, tread: 0, treads: 0, going: 0, landings: 0, blondel: 0 };
  const nominal = STAIR[cls].riser;
  const risers = Math.max(1, Math.ceil(rise / nominal - 1e-9));
  const riser = rise / risers;
  const tread = STAIR.blondel - 2 * riser;
  const treads = risers - 1;
  const landings = cls === 'freitreppe' ? 0 : Math.max(0, Math.ceil(risers / STAIR.landingEvery) - 1);
  return { risers, riser, tread, treads, going: treads * tread, landings, blondel: 2 * riser + tread };
}
