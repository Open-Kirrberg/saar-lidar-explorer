/**
 * KB-I45 (wave 7): the cross-section of a clipped hedge or box edging (visual-audit §5.6 item 6: "bevel the top edges
 * slightly so a light edge catches the sun"). Clipped box and hornbeam are cut with a slight batter (narrower at the
 * top, so the foot keeps its light) and a rounded shoulder [N d'Argenville 1747, tondeur's batter; I numbers]:
 *
 *   side battered in by `batter` × half width, a shoulder bevel of height `bevel`, a flat crown 0.5 × the base width.
 *
 * Pure (no three): points (d across, h up) from the d0 side to the d1 side, with smooth unit normals (nd, nh) per
 * point, so a builder draws the five faces with shared normals and the shoulder reads round.
 */

export interface HedgeProfilePoint {
  d: number;
  h: number;
  /** smooth unit normal across (d) and up (h) */
  nd: number;
  nh: number;
}

/** Number of faces of `hedgeProfile` (two sides, two shoulders, the crown). */
export const HEDGE_PROFILE_FACES = 5;

export function hedgeProfile(d0: number, d1: number, base: number, top: number, bevel: number, batter = 0.14): HedgeProfilePoint[] {
  const w = (d1 - d0) / 2;
  const c = (d0 + d1) / 2;
  const H = top - base;
  const bv = Math.min(bevel, H * 0.45);
  const ws = w * (1 - batter); // half width at the shoulder
  const wc = Math.max(w * 0.15, Math.min(ws - bv * 0.9, w * 0.5)); // half width of the flat crown
  const crownH = top;
  // face normals (outward, d side −1 first)
  const nrm = (dd: number, dh: number) => {
    const l = Math.hypot(dd, dh);
    return [dd / l, dh / l] as const;
  };
  const side = nrm(H - bv, w - ws); // battered side: outward + a little up
  const sh = nrm(crownH - (top - bv), ws - wc); // shoulder bevel
  const avg = (a: readonly [number, number], b: readonly [number, number]) => nrm(a[0] + b[0], a[1] + b[1]);
  const mid = avg(sh, [0, 1]);
  const shoulder = avg(side, sh);
  const L = (p: number, h: number, n: readonly [number, number]): HedgeProfilePoint => ({ d: c - p, h, nd: -n[0], nh: n[1] });
  const R = (p: number, h: number, n: readonly [number, number]): HedgeProfilePoint => ({ d: c + p, h, nd: n[0], nh: n[1] });
  return [L(w, base, side), L(ws, top - bv, shoulder), L(wc, crownH, mid), R(wc, crownH, mid), R(ws, top - bv, shoulder), R(w, base, side)];
}
