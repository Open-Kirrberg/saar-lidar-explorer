/**
 * Crown proportions of the 1789 forest trees (wave-3 review of KB-I44). Pure, no three.js; unit-tested in
 * viewer/tests/crown.test.ts.
 *
 * The beech / oak / hornbeam wood (research/11 §5, §6.3: beech 70 %, oak 20 %, hornbeam 10 %) has broad domed crowns:
 * width : height of the crown about 0.9–1.2, crown depth about half the tree height in a closed stand [N forest
 * mensuration; I values]. Wave 3 had stretched the edge crowns vertically (crown base near the ground, crown height
 * 2.5–3 × the width), which read as a wall of Lombardy poplars. Now:
 *
 * - interior trees: crown depth FOREST_DEPTH (± 0.04) of the height, width = aspect × crown height;
 * - the outer EDGE_BAND m: the crown comes down to EDGE_DEPTH of the height (sunny side, branched lower), is up to
 *   EDGE_WIDEN wider and leans toward the open land (≤ EDGE_LEAN_DEG, shifted out by ≤ EDGE_SHIFT of its radius) —
 *   an asymmetric mantle, not a vertical stretch; the aspect stays ≥ 0.8;
 * - only Populus italica keeps a column (model site/trees.ts).
 */

/** Crown width : crown height per forest species [N habit; I values]. */
export const FOREST_ASPECT: Record<string, number> = {
  fagus: 1.1, // beech: broad dome
  quercus: 1.2, // oak: broadest, irregular
  carpinus: 1.05, // hornbeam: rounder, a little narrower
};
/** Crown depth (fraction of the tree height) inside the stand and at the edge [N; I]. */
export const FOREST_DEPTH = 0.55;
export const EDGE_DEPTH = 0.8;
export const EDGE_WIDEN = 0.28;
/** Open-grown standards out in the meadow (Überhälter): crown depth [N open-grown beech; I]. */
export const OPEN_DEPTH = 0.76;
/** Band (m from the forest edge) over which the edge form fades in, and where it is full (EDGE_FULL m). */
export const EDGE_BAND = 26;
export const EDGE_FULL = 8;
export const EDGE_LEAN_DEG = 12;
export const EDGE_SHIFT = 0.18;

export interface CrownForm {
  /** clear trunk fraction of the height (1 − crown depth) */
  trunkFrac: number;
  /** crown height (m) */
  crownH: number;
  /** crown radius (m) */
  radius: number;
  /** outward lean of the crown (rad) toward open land (0 inside the stand) */
  lean: number;
  /** outward shift of the crown centre (m) */
  shift: number;
}

/** 0 in the stand, 1 at the forest edge (smooth). */
export function edgeWeight(edge: number): number {
  const t = Math.min(1, Math.max(0, (edge - EDGE_FULL) / (EDGE_BAND - EDGE_FULL)));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Crown form of a forest tree of `species` with total height `h` (m) at `edge` m from the forest edge; `u1`, `u2` are
 * the tree's randoms in [0, 1). `open` = whether an outward direction to open land is known (no lean without it);
 * `openGrown` = a solitary standard out in the meadow (OPEN_DEPTH, no lean).
 */
export function forestCrownForm(species: string, h: number, edge: number, u1: number, u2: number, open = true, openGrown = false): CrownForm {
  if (openGrown) {
    // a solitary beech / oak in the meadow: branched low all round, no lean
    const crownH = (OPEN_DEPTH + (u1 - 0.5) * 0.08) * h;
    const radius = 0.5 * (FOREST_ASPECT[species] ?? 1.05) * (0.93 + 0.14 * u2) * crownH;
    return { trunkFrac: 1 - crownH / h, crownH, radius, lean: 0, shift: 0 };
  }
  const k = edgeWeight(edge);
  const inner = FOREST_DEPTH + (u1 - 0.5) * 0.08;
  const crownH = (inner + (EDGE_DEPTH - FOREST_DEPTH) * k) * h;
  const aspect = (FOREST_ASPECT[species] ?? 1.05) * (0.93 + 0.14 * u2);
  const radius = 0.5 * aspect * inner * h * (1 + EDGE_WIDEN * k);
  const lean = open ? (k * EDGE_LEAN_DEG * Math.PI) / 180 : 0;
  return { trunkFrac: 1 - crownH / h, crownH, radius, lean, shift: open ? k * EDGE_SHIFT * radius : 0 };
}

/** Is this a forest-stand species whose crown follows `forestCrownForm`? */
export function isForestStandSpecies(species: string): boolean {
  return species in FOREST_ASPECT;
}
