/**
 * V2.4 trees — low-poly lathe shapes (pure). One geometry per LOD serves all three tree kinds:
 * the vertex shader looks up each vertex's profile point per kind (`uProf`), so conifer /
 * broadleaf / unknown cost one draw call per mesh.
 *
 * Profile = sequence bottom-centre → rings → apex, each point [heightFrac of h, radiusFrac of r].
 * Bands between consecutive points are shaded flat along the profile (faceted low-poly look),
 * smooth around the axis.
 */
import type { TreeLod } from './lod';

/** [heightFrac, radiusFrac] points, bottom centre first, apex last. */
export type Profile = ReadonlyArray<readonly [number, number]>;

export interface TreeShape {
  sides: number;
  /** 0 = no trunk. */
  trunkSides: number;
  /** Profile per kind: [unknown, conifer, broadleaf] (TreeKind order). */
  profiles: readonly [Profile, Profile, Profile];
  /** far: the bottom-centre point is pulled to the ground (no visible gap without a trunk). */
  bottomToGround: boolean;
}

export const TREE_SHAPES: Record<TreeLod, TreeShape> = {
  near: {
    sides: 7,
    trunkSides: 5,
    bottomToGround: false,
    profiles: [
      // unknown: generic ovoid
      [[0.32, 0], [0.31, 0.5], [0.39, 0.82], [0.49, 0.97], [0.59, 1], [0.69, 0.92], [0.79, 0.75], [0.88, 0.52], [0.95, 0.26], [1, 0]],
      // conifer: four tiers (outer edge low, inner top high)
      [[0.2, 0], [0.17, 1], [0.36, 0.52], [0.33, 0.8], [0.53, 0.4], [0.5, 0.62], [0.7, 0.28], [0.67, 0.44], [0.86, 0.15], [1, 0]],
      // broadleaf: round crown on a long trunk
      [[0.4, 0], [0.4, 0.55], [0.47, 0.86], [0.56, 0.98], [0.65, 1], [0.74, 0.93], [0.83, 0.78], [0.91, 0.55], [0.97, 0.27], [1, 0]],
    ],
  },
  mid: {
    sides: 5,
    trunkSides: 3,
    bottomToGround: false,
    profiles: [
      [[0.32, 0], [0.36, 0.78], [0.57, 1], [0.81, 0.72], [1, 0]],
      [[0.2, 0], [0.17, 1], [0.48, 0.45], [0.45, 0.66], [1, 0]],
      [[0.4, 0], [0.45, 0.82], [0.64, 1], [0.86, 0.72], [1, 0]],
    ],
  },
  far: {
    sides: 5,
    trunkSides: 0,
    bottomToGround: true,
    profiles: [
      [[0, 0], [0.33, 0.72], [0.58, 1], [1, 0]],
      [[0, 0], [0.17, 1], [0.55, 0.54], [1, 0]],
      [[0, 0], [0.4, 0.7], [0.66, 1], [1, 0]],
    ],
  },
};

export interface LatheArrays {
  /** (cosθ, seq, sinθ) per vertex; seq = profile index, −1 trunk bottom, −2 trunk top. */
  position: Float32Array;
  /** Band (profile segment) per vertex for the facet normal; −1 trunk. */
  band: Float32Array;
  index: Uint16Array;
  triangles: number;
}

/**
 * Lathe with `seq` profile points around `sides` angles, plus an optional open trunk cylinder.
 * Every band has its own two vertex rows (flat facets along the profile); fan bands at the
 * bottom centre / apex drop their degenerate half. Winding is CCW from outside.
 */
export function latheArrays(sides: number, seq: number, trunkSides: number): LatheArrays {
  const pos: number[] = [];
  const band: number[] = [];
  const idx: number[] = [];
  const ring = (s: number, b: number, n: number, phase = 0) => {
    const base = pos.length / 3;
    for (let a = 0; a < n; a++) {
      const th = ((a + phase) / n) * Math.PI * 2;
      pos.push(Math.cos(th), s, Math.sin(th));
      band.push(b);
    }
    return base;
  };
  for (let b = 0; b < seq - 1; b++) {
    const lowerIsCentre = b === 0;
    const upperIsCentre = b === seq - 2;
    // Centre rows sit at the half-angle so the fan triangle's normal faces its own side.
    const a0 = ring(b, b, sides, lowerIsCentre ? 0.5 : 0);
    const b0 = ring(b + 1, b, sides, upperIsCentre ? 0.5 : 0);
    for (let s = 0; s < sides; s++) {
      const s1 = (s + 1) % sides;
      if (lowerIsCentre) {
        idx.push(b0 + s, b0 + s1, a0 + s); // centre vertex between s and s+1
      } else if (upperIsCentre) {
        idx.push(a0 + s, b0 + s, a0 + s1);
      } else {
        idx.push(a0 + s, b0 + s, a0 + s1, b0 + s, b0 + s1, a0 + s1);
      }
    }
  }
  if (trunkSides > 0) {
    const t0 = ring(-1, -1, trunkSides);
    const t1 = ring(-2, -1, trunkSides);
    for (let s = 0; s < trunkSides; s++) {
      const s1 = (s + 1) % trunkSides;
      idx.push(t0 + s, t1 + s, t0 + s1, t1 + s, t1 + s1, t0 + s1);
    }
  }
  return { position: new Float32Array(pos), band: new Float32Array(band), index: new Uint16Array(idx), triangles: idx.length / 3 };
}

/** Flattened `uProf` uniform (3 kinds × seq points) for a shape. */
export function profileUniform(shape: TreeShape): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const p of shape.profiles) for (const q of p) out.push([q[0], q[1]]);
  return out;
}
