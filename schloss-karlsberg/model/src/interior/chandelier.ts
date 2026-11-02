/**
 * Wave-6 interior residual (chandeliers read as a sparse brass armature): plan of a glass-dressed Louis-seize
 * chandelier ("lustre à pendeloques"), pure (no three) so its counts and envelope are unit-tested.
 *
 * Evidence: the gallery's "20 crystal chandeliers" (T1 pp. 374 f., T5) and Knigge's chandeliers in the state rooms
 * [D]; the form is a period norm [N research/09 §4.2 "crystal chandeliers"]: a gilt stem and two rings of candle arms
 * hidden under glass - a crown with small glass spears, a cage of bead chains from the crown down to the arm ring,
 * double festoons of beads between the arm ends, an almond drop (pendeloque) under every arm and between them, glass
 * balusters on the stem and a basket of chains down to a large finial drop.
 *
 * Wave-6 review fix (look): the drops read as a cloud of loose shards (07, the Fest still). Now every glass piece hangs
 * from something: the chains are strings of elongated diamond links end to end (the period chains of cut beads joined
 * by brass pins [N]) that run from fixing point to fixing point, an almond drop hangs at each arm tip right under its
 * nozzle and one from the low point of each outer festoon; the free drops round the crown and the arm ring are gone
 * (42 → 22 pendeloques, all attached).
 *
 * Prototype frame as in furniture.ts: Y up, origin at the bottom of the finial, total height `CHANDELIER.height`
 * (the suspension rod starts there, interior/index.ts), radius ≤ `CHANDELIER.radius`. All sizes in metres [N].
 */

export type P3 = [number, number, number];

/** One glass piece: a chain link (bead), a pendeloque (flat almond drop), a spear (pointing up) or the finial drop. */
export interface GlassPiece {
  kind: 'bead' | 'pendeloque' | 'spear' | 'finial';
  at: P3;
  /** Half sizes along x, y, z of the octahedron (spear: base radius, height, base radius; link: y along `dir`). */
  size: P3;
  /** Chain links: unit direction of the link (its local y axis); absent = upright. */
  dir?: P3;
}

export interface ChandelierPlan {
  /** Candle arms: tier radius, arm height, count (candles stand on the arm ends). */
  tiers: { r: number; y: number; n: number }[];
  /** The gilt ring the lower arms and the cage chains spring from. */
  ring: { r: number; y: number };
  /** The crown under the canopy. */
  crown: { r: number; y: number };
  glass: GlassPiece[];
}

export const CHANDELIER = {
  /** Height of the prototype (bottom of the finial drop to the canopy), m [N]. */
  height: 1.05,
  /** Largest radius (arm ends plus their drip pans), m [N]. */
  radius: 0.62,
  /** Cage chains from the crown to the arm ring, links per chain [N]. */
  cage: { chains: 8, beads: 7 },
  /** Basket chains from the arm ring to the finial, links per chain [N]. */
  basket: { chains: 8, beads: 5 },
  /** Chain links end to end: share of the gap between link centres a link fills (the rest is the pin) [N]. */
  linkFill: 0.92,
  tag: 'D crystal chandeliers (T1 pp. 374 f.; T5; Knigge 1792); form and sizes N (research/09 §4.2)',
} as const;

const ring = (r: number, y: number, a: number): P3 => [Math.sin(a) * r, y, Math.cos(a) * r];

/** Point at t ∈ [0, 1] of a chain from a to e sagging by `sag` at the middle and bulging out by `bulge`. */
export function chainPoint(a: P3, e: P3, t: number, sag: number, bulge = 0): P3 {
  const s = 4 * t * (1 - t);
  let x = a[0] + (e[0] - a[0]) * t;
  let z = a[2] + (e[2] - a[2]) * t;
  if (bulge) {
    const l = Math.hypot(x, z) || 1;
    x += (x / l) * bulge * s;
    z += (z / l) * bulge * s;
  }
  return [x, a[1] + (e[1] - a[1]) * t - sag * s, z];
}

/**
 * A chain of `n` links from a to e (both fixing points included), sagging by `sag` and bulging by `bulge`: each link is
 * a diamond bead between two consecutive points of the curve, `linkFill` of their distance long, so the string reads
 * continuous from fixing point to fixing point.
 */
function chain(out: GlassPiece[], a: P3, e: P3, n: number, sag: number, r = 0.0055, bulge = 0): void {
  let p = chainPoint(a, e, 0, sag, bulge);
  for (let k = 1; k <= n; k++) {
    const q = chainPoint(a, e, k / n, sag, bulge);
    const d: P3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    out.push({ kind: 'bead', at: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], size: [r, (len / 2) * CHANDELIER.linkFill, r], dir: [d[0] / len, d[1] / len, d[2] / len] });
    p = q;
  }
}

/** The glass-dressed chandelier: candle tiers and every glass piece. Deterministic. */
export function chandelierPlan(): ChandelierPlan {
  const tiers = [
    { r: 0.5, y: 0.4, n: 8 },
    { r: 0.27, y: 0.74, n: 6 },
  ];
  const armRing = { r: 0.33, y: 0.43 };
  const crown = { r: 0.15, y: 0.97 };
  const glass: GlassPiece[] = [];
  const C = CHANDELIER;
  // crown: small glass spears standing on the crown ring
  for (let k = 0; k < 8; k++) glass.push({ kind: 'spear', at: ring(crown.r, crown.y, (k * Math.PI * 2) / 8), size: [0.012, 0.07, 0.012] });
  // cage: chains from the crown out and down to the arm ring, bulging outwards
  for (let k = 0; k < C.cage.chains; k++) {
    const a = (k * Math.PI * 2) / C.cage.chains;
    chain(glass, ring(crown.r, crown.y, a), ring(armRing.r, armRing.y, a), C.cage.beads, 0, 0.0055, 0.07);
  }
  for (const [ti, t] of tiers.entries()) {
    const step = (Math.PI * 2) / t.n;
    for (let k = 0; k < t.n; k++) {
      const a = k * step;
      const p = ring(t.r, t.y, a);
      // almond drop hanging right under the nozzle of every arm (its top touches the arm end)
      const dh = ti === 0 ? 0.05 : 0.04;
      glass.push({ kind: 'pendeloque', at: [p[0], t.y - 0.012 - dh, p[2]], size: ti === 0 ? [0.02, dh, 0.008] : [0.016, dh, 0.007] });
      // double festoon to the next arm, hooked at the arm ends: an upper swag and a deeper outer one
      const q = ring(t.r, t.y, a + step);
      chain(glass, [p[0], t.y - 0.01, p[2]], [q[0], t.y - 0.01, q[2]], ti === 0 ? 6 : 4, ti === 0 ? 0.09 : 0.06);
      if (ti === 0) {
        const p2 = ring(t.r, t.y - 0.02, a);
        const q2 = ring(t.r, t.y - 0.02, a + step);
        chain(glass, p2, q2, 8, 0.17, 0.006, 0.03); // even: a link end at the low point
        // a drop hanging from the outer festoon's low point
        const low = chainPoint(p2, q2, 0.5, 0.17, 0.03);
        glass.push({ kind: 'pendeloque', at: [low[0], low[1] - 0.006 - 0.045, low[2]], size: [0.018, 0.045, 0.007] });
      }
    }
  }
  // basket: chains from the arm ring down to the top of the finial, bowed outwards
  for (let k = 0; k < C.basket.chains; k++) {
    const a = ((k + 0.5) * Math.PI * 2) / C.basket.chains;
    chain(glass, ring(armRing.r, armRing.y - 0.01, a), [0, 0.12, 0], C.basket.beads, 0.02, 0.0055, 0.05);
  }
  glass.push({ kind: 'finial', at: [0, 0.06, 0], size: [0.03, 0.06, 0.03] });
  return { tiers, ring: armRing, crown, glass };
}
