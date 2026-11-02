/**
 * Garden enclosure wall (GARD buildings, e.g. KB-B27 Holländische Gärtnerei; wave-5 residual (c), GARDEN_DETAIL.wall):
 * rendered rubble in bays that step with the ground (layout/garden.ts steppedWallTops), a sandstone saddle coping that
 * projects on both faces, piers every few bays, and a baked shade: a lime-wash variation per bay and a darker, damp
 * foot (AO) that fades over `footFade` m. Replaces the flat-topped perimeter slab whose top stood level over a falling
 * slope (pose 18: "blank beige slabs").
 *
 * Building space [s, t, h] as the exterior builder (the ring is the building outline; the wall body lies on the inner
 * side of each edge, d ∈ [−thickness, 0] along the edge's outward normal [tan.t, −tan.s], as perimeterWall did).
 */
import { type GeoBuilder, type MatKey, type P3 } from '../exterior/builder.ts';
import type { Shade } from '../exterior/shade.ts';
import { hashString, mulberry32, smoothstep } from '../layout/geom.ts';
import { steppedWallTops } from '../layout/garden.ts';
import { GARDEN_DETAIL } from '../layout/grammar.ts';
import type { ST } from '../spec.ts';

export interface GardenWallOptions {
  /** ground height at a building-space plan point (NaN outside the terrain) */
  ground: (s: number, t: number) => number;
  /** wall height over the ground (catalogue wall height) */
  height: number;
  /** fallback ground (plinth top) where the terrain has no value */
  fallback: number;
  thickness?: number;
  wall: MatKey;
  coping: MatKey;
  /** seed for the lime-wash variation */
  id: string;
  /** level of detail: < 2 (viewer mid range, explorer light layer) drops the foot row, the coping bed course and the
   * pier caps (about 18 instead of 42 triangles per bay; the layer budget is 6 MB) */
  lod?: number;
}

export function gardenWall(g: GeoBuilder, ring: readonly ST[], o: GardenWallOptions): void {
  const W = GARDEN_DETAIL.wall;
  const th = o.thickness ?? 0.6;
  const lean = (o.lod ?? 2) < 2;
  const gr = (s: number, t: number) => {
    const y = o.ground(s, t);
    return Number.isFinite(y) ? y : o.fallback;
  };
  const rnd = mulberry32(hashString(o.id));
  // lime-wash variation: one albedo factor per bay (and pier), set while that bay is drawn [I strength]
  let wash = 1;
  const shade = (p: P3, ny: number, out: Shade) => {
    const dh = p[2] - gr(p[0], p[1]);
    const f = smoothstep(0, 1, dh / W.footFade);
    // damp, splashed foot: darker and a little browner, fading out over footFade m
    out[0] *= wash * (0.86 + 0.14 * f);
    out[1] *= wash * (0.85 + 0.15 * f);
    out[2] *= wash * (0.8 + 0.2 * f);
    out[3] = Math.min(out[3], ny < -0.5 ? out[3] : W.footAO + (1 - W.footAO) * f);
  };
  g.withShade(shade, () => {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % n];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 0.05) continue;
      const tan: ST = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
      const nrm: ST = [tan[1], -tan[0]];
      const at = (a: number, d: number): ST => [p[0] + tan[0] * a + nrm[0] * d, p[1] + tan[1] * a + nrm[1] * d];
      const nb = Math.max(1, Math.round(len / W.bay));
      const bl = len / nb;
      const bays = Array.from({ length: nb }, (_, k) => {
        const hs: number[] = [];
        for (const a of [k * bl, (k + 0.5) * bl, (k + 1) * bl]) for (const d of [0.05, -th - 0.05]) hs.push(gr(...at(a, d)));
        return { lo: Math.min(...hs), hi: Math.max(...hs) };
      });
      const tops = steppedWallTops(bays, o.height, W.minHeight, W.step);
      for (let k = 0; k < nb; k++) {
        wash = 1 + (rnd() * 2 - 1) * W.washJitter;
        const a0 = k * bl;
        const a1 = (k + 1) * bl;
        const top = tops[k];
        const body = top - W.copingHeight;
        const foot = bays[k].lo - 0.3;
        const mid = Math.min(body, bays[k].lo + W.footFade);
        const ov = lean ? 0 : W.copingOverhang;
        const bed = lean ? body : body + 0.07;
        if (lean) {
          // one body box (the foot shade interpolates over the full height), saddle straight on the wall head
          g.orientedBox(o.wall, p, tan, nrm, a0, a1, -th, 0, foot, body, false, 'caps');
        } else {
          // body in two storeys so the foot shade has its own vertex row
          if (mid > foot + 0.05) g.orientedBox(o.wall, p, tan, nrm, a0, a1, -th, 0, foot, mid, false, 'caps');
          g.orientedBox(o.wall, p, tan, nrm, a0, a1, -th, 0, Math.max(foot, mid), body, false, mid > foot + 0.05 ? 'caps' : 'none');
          // saddle coping: a projecting bed course and a ridge over the wall centre (the box end faces close the steps)
          g.orientedBox(o.coping, p, tan, nrm, a0 - 0.02, a1 + 0.02, -th - ov, ov, body, bed);
        }
        const P = (a: number, d: number, h: number): P3 => [at(a, d)[0], at(a, d)[1], h];
        const dc = -th / 2;
        g.quadFacing(o.coping, P(a0 - 0.02, ov, bed), P(a1 + 0.02, ov, bed), P(a1 + 0.02, dc, top), P(a0 - 0.02, dc, top), [nrm[0], nrm[1], 1]);
        g.quadFacing(o.coping, P(a1 + 0.02, -th - ov, bed), P(a0 - 0.02, -th - ov, bed), P(a0 - 0.02, dc, top), P(a1 + 0.02, dc, top), [-nrm[0], -nrm[1], 1]);
        // gable ends of the saddle (visible at the steps)
        for (const [a, dir] of [
          [a0 - 0.02, -1],
          [a1 + 0.02, 1],
        ] as const) {
          g.polygonFacing(o.coping, [P(a, ov, bed), P(a, dc, top), P(a, -th - ov, bed)], [tan[0] * dir, tan[1] * dir, 0]);
        }
        // pier at every `pierEvery`-th bay joint (and the edge start): slightly proud on both faces, its own cap
        if (k % W.pierEvery === 0) {
          const pw = W.pierWidth / 2;
          const pp = W.pierProjection;
          const ptop = top + 0.12;
          wash = 1 + (rnd() * 2 - 1) * W.washJitter;
          if (lean) {
            g.orientedBox(o.wall, p, tan, nrm, a0 - pw, a0 + pw, -th - pp, pp, foot, ptop);
          } else {
            g.orientedBox(o.wall, p, tan, nrm, a0 - pw, a0 + pw, -th - pp, pp, foot, ptop - 0.12);
            g.orientedBox(o.coping, p, tan, nrm, a0 - pw - 0.05, a0 + pw + 0.05, -th - pp - 0.05, pp + 0.05, ptop - 0.12, ptop);
          }
        }
      }
    }
  });
}
