/** V2.6b: walk collision for simple zones — a circle (the visitor) against axis-aligned wall boxes in x/z. Pure. */

export interface BoxXZ {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Push (x, z) out of every box it overlaps by less than `r` (two passes settle corners). */
export function collideCircle(x: number, z: number, r: number, boxes: readonly BoxXZ[]): { x: number; z: number } {
  for (let pass = 0; pass < 2; pass++) {
    for (const b of boxes) {
      const cx = Math.min(Math.max(x, b.x0), b.x1);
      const cz = Math.min(Math.max(z, b.z0), b.z1);
      const dx = x - cx;
      const dz = z - cz;
      const d = Math.hypot(dx, dz);
      if (d >= r) continue;
      if (d > 1e-9) {
        x = cx + (dx / d) * r;
        z = cz + (dz / d) * r;
      } else {
        // Centre inside the box: leave along the shallowest side.
        const out = [x - b.x0 + r, b.x1 - x + r, z - b.z0 + r, b.z1 - z + r];
        const i = out.indexOf(Math.min(...out));
        if (i === 0) x = b.x0 - r;
        else if (i === 1) x = b.x1 + r;
        else if (i === 2) z = b.z0 - r;
        else z = b.z1 + r;
      }
    }
  }
  return { x, z };
}

/** Zone frame ↔ pose (contract: x = E − E0, y = h, z = −(N − N0)). */
export const poseToLocal = (E: number, N: number, o: { E0: number; N0: number }) => ({ x: E - o.E0, z: -(N - o.N0) });
export const localToEN = (x: number, z: number, o: { E0: number; N0: number }) => ({ E: x + o.E0, N: o.N0 - z });
