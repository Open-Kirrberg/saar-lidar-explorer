/**
 * Lean-to forcing house (Treibhaus) of the Holländische Gärtnerei (wave-5 fix, KB-I36; research/11 §1.2, G12, S11):
 * a solid, rendered back wall on the N side, solid end walls, a low dwarf wall on the S side and glazing sloped to the
 * S between them, with a short tiled lean-to strip over the back [D Petri via Schneider "greenhouses facing due S";
 * D-> BSB 25r serres; N form; I proportions (GARDEN_DETAIL.glasshouse)].
 *
 * Built from the layout's frame (object space plan [s, t], h absolute): the glazed side is the frame side whose outward
 * normal is closest to grid azimuth 180°; the back wall stands on the opposite side. The catalogue roof is `none`.
 */
import type { BuildContext } from '../context.ts';
import type { BuildingLayout } from '../layout/building.ts';
import * as THREE from 'three';
import { hashString, mulberry32 } from '../layout/geom.ts';
import { GARDEN_DETAIL, GLASSHOUSE } from '../layout/grammar.ts';
import type { SideName } from '../spec.ts';
import { type GeoBuilder, type MatKey, type P3, matKey } from './builder.ts';
import type { ExteriorPalette } from './index.ts';

type ST = [number, number];

/** The frame side whose outward normal is closest to grid azimuth `az` (default due S). */
export function sideFacing(L: BuildingLayout, az = 180): SideName {
  let best: SideName = 'garden';
  let bd = Infinity;
  for (const k of ['garden', 'end_b', 'court', 'end_a'] as const) {
    const d = Math.abs((((L.frame.sides[k].normalAzimuth - az) % 360) + 540) % 360 - 180);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return best;
}

export function buildGlasshouse(g: GeoBuilder, gr: GeoBuilder, L: BuildingLayout, pal: ExteriorPalette, ctx: BuildContext): void {
  const G = GARDEN_DETAIL.glasshouse;
  const sd = L.frame.sides[sideFacing(L)];
  const len = sd.length;
  const depth = sd.name === 'garden' || sd.name === 'court' ? L.frame.width : L.frame.length;
  const tan = sd.tangent;
  const inn: ST = [-sd.normal[0], -sd.normal[1]];
  // a, d (inward from the glazed face), h -> object plan point
  const P = (a: number, d: number, h: number): P3 => [sd.p0[0] + tan[0] * a + inn[0] * d, sd.p0[1] + tan[1] * a + inn[1] * d, h];
  const base = L.stack.base_h;
  const foot = Math.min(base, L.stack.plinth.bottom_h) - 0.1;
  const eaves = L.stack.eaves_h;
  const sill = base + G.dwarfWall;
  const backTop = eaves + G.backRise;
  const dGlass = depth * G.glassDepth; // where the glazing meets the tiled back strip
  const hGlass = eaves - 0.05;
  const wallK = pal.wall;
  const tileK = pal.roof.startsWith('roof.tile') ? pal.roof : matKey('roof.tile');
  const plinthK = pal.plinth;
  const woodK = matKey('wood.frame', G.frameColour);
  const glassK = matKey('glass.crown');
  const plantK = matKey('ground.grass', '#3F5A2E');
  const soilK = matKey('ground.gravel', '#5E4A3A');
  const tw = G.wall;

  // box between plan ranges a0..a1, d0..d1, h0..h1 (the face's local frame)
  const box = (k: MatKey, a0: number, a1: number, d0: number, d1: number, h0: number, h1: number) => {
    g.orientedBox(k, sd.p0, tan, inn, a0, a1, d0, d1, h0, h1);
  };
  // back (N) wall: solid, full height, with a coping
  box(wallK, 0, len, depth - G.backWall, depth, foot, backTop);
  box(plinthK, -0.03, len + 0.03, depth - G.backWall - 0.03, depth + 0.03, foot, base + 0.3);
  // dwarf (S) wall under the glazing, sandstone plinth course
  box(plinthK, 0, len, 0, tw, foot, sill);
  // end walls: the section polygon extruded tw along the face (solid, rendered)
  const section: [number, number][] = [
    [0, foot],
    [0, sill],
    [dGlass, hGlass],
    [depth, backTop],
    [depth, foot],
  ];
  for (const [a0, a1] of [
    [0, tw],
    [len - tw, len],
  ] as const) {
    const outer = a0 === 0 ? a0 : a1;
    const inner = a0 === 0 ? a1 : a0;
    const out: P3 = a0 === 0 ? [-tan[0], -tan[1], 0] : [tan[0], tan[1], 0];
    g.polygonFacing(wallK, section.map(([d, h]) => P(outer, d, h)), out);
    g.polygonFacing(wallK, section.map(([d, h]) => P(inner, d, h)), [-out[0], -out[1], 0]);
    // top edges between the two faces
    for (let i = 1; i < section.length - 1; i++) {
      const [d0, h0] = section[i];
      const [d1, h1] = section[i + 1];
      const nrm: P3 = [inn[0] * -(h1 - h0), inn[1] * -(h1 - h0), d1 - d0];
      g.quadFacing(wallK, P(outer, d0, h0), P(inner, d0, h0), P(inner, d1, h1), P(outer, d1, h1), nrm);
    }
  }
  // sloped glazing. Wave-7 review fix (it read as a photovoltaic array): small lapped panes of crown glass with a
  // per-pane normal jitter (LOD2; per sash at LOD1), dark oiled timber rafters, sash bars and sash rails, lap lines,
  // rolled straw night-mats along the top and Kanalheizung chimneys on the back wall [GLASSHOUSE, N]
  const X = GLASSHOUSE;
  const slopeN: P3 = [-inn[0] * (hGlass - sill), -inn[1] * (hGlass - sill), dGlass];
  const a0 = tw;
  const a1 = len - tw;
  const barK = matKey('wood.frame', X.barColour);
  // a point on the glass slope: a along the face, u 0..1 up the slope, `off` m proud of the glass
  const slopeLen = Math.hypot(dGlass - 0.05, hGlass - sill);
  const nd = -(hGlass - sill) / slopeLen;
  const nh = (dGlass - 0.05) / slopeLen;
  const S = (a: number, u: number, off = 0): P3 => P(a, 0.05 + (dGlass - 0.05) * u + nd * off, sill + (hGlass - sill) * u + nh * off);
  // The panes face INTO the house (winding and normals): `glass.crown` shows its opaque room proxy only to a camera on
  // the side its normals point to (a palace window seen from the street). A forcing house has no dark room behind the
  // glass but sunlit plants, so seen from outside its panes must read as clear green-grey crown glass with the soil,
  // staging and plants showing through [I]. (From inside the house the panes then show the proxy; nobody walks in.)
  const nR = Math.max(2, Math.round((a1 - a0) / G.rafter));
  const sl = Math.hypot(...slopeN);
  const nU: P3 = [slopeN[0] / sl, slopeN[1] / sl, slopeN[2] / sl];
  const upU: P3 = [inn[0] * (dGlass - 0.05) / slopeLen, inn[1] * (dGlass - 0.05) / slopeLen, (hGlass - sill) / slopeLen];
  const id = L.building.id;
  // pane quad with one jittered normal (three.js space for GeoBuilder.tri), wound and lit facing in
  const pane = (q: [P3, P3, P3, P3], key: string) => {
    const rnd = mulberry32(hashString(`${id}|${key}`) ^ ctx.options.seed);
    const j1 = (rnd() * 2 - 1) * X.jitter;
    const j2 = (rnd() * 2 - 1) * X.jitter;
    const n: P3 = [nU[0] + tan[0] * j1 + upU[0] * j2, nU[1] + tan[1] * j1 + upU[1] * j2, nU[2] + upU[2] * j2];
    const v = new THREE.Vector3(-n[0], -n[2], n[1]).normalize(); // inward (see above)
    const e1: P3 = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]];
    const e2: P3 = [q[2][0] - q[0][0], q[2][1] - q[0][1], q[2][2] - q[0][2]];
    const c: P3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const [p0, p1, p2, p3] = c[0] * nU[0] + c[1] * nU[1] + c[2] * nU[2] <= 0 ? q : [q[3], q[2], q[1], q[0]];
    g.tri(glassK, p0, p1, p2, [v, v, v]);
    g.tri(glassK, p0, p2, p3, [v, v, v]);
  };
  const bayW = (a1 - a0) / nR;
  if (ctx.lod >= 1) {
    const cols = ctx.lod >= 2 ? X.panesPerBay : 1;
    const rows = ctx.lod >= 2 ? Math.max(2, Math.round(slopeLen / X.pane[1])) : X.sashes;
    for (let i = 0; i < nR; i++)
      for (let c = 0; c < cols; c++) {
        const pa0 = a0 + bayW * i + (bayW * c) / cols;
        const pa1 = a0 + bayW * i + (bayW * (c + 1)) / cols;
        for (let r = 0; r < rows; r++) {
          // lapped: each pane's lower edge rests on the pane below (a few mm proud), so it tilts like a scale
          pane([S(pa0, r / rows, X.lap), S(pa1, r / rows, X.lap), S(pa1, (r + 1) / rows, 0), S(pa0, (r + 1) / rows, 0)], `${i}|${c}|${r}`);
        }
      }
  } else g.quadFacing(glassK, P(a0, 0.05, sill), P(a1, 0.05, sill), P(a1, dGlass, hGlass), P(a0, dGlass, hGlass), [-slopeN[0], -slopeN[1], -slopeN[2]]);
  // a bar lying on the slope from (a, u0) to (a, u1) (w wide, `proud` m high): top face and two sides
  const barUp = (k: MatKey, a: number, w: number, proud: number, u0 = 0, u1 = 1) => {
    g.quadFacing(k, S(a - w / 2, u0, proud), S(a + w / 2, u0, proud), S(a + w / 2, u1, proud), S(a - w / 2, u1, proud), slopeN);
    g.quadFacing(k, S(a - w / 2, u0, 0), S(a - w / 2, u0, proud), S(a - w / 2, u1, proud), S(a - w / 2, u1, 0), [-tan[0], -tan[1], 0]);
    g.quadFacing(k, S(a + w / 2, u0, proud), S(a + w / 2, u0, 0), S(a + w / 2, u1, 0), S(a + w / 2, u1, proud), [tan[0], tan[1], 0]);
  };
  // a bar across the slope at u (w along the slope)
  const barAcross = (k: MatKey, u: number, w: number, proud: number) => {
    const du = w / 2 / slopeLen;
    g.quadFacing(k, S(a0, u - du, proud), S(a1, u - du, proud), S(a1, u + du, proud), S(a0, u + du, proud), slopeN);
    g.quadFacing(k, S(a0, u - du, 0), S(a1, u - du, 0), S(a1, u - du, proud), S(a0, u - du, proud), [-upU[0], -upU[1], -upU[2]]);
  };
  for (let i = 0; i <= nR; i++) {
    const a = Math.min(a1 - X.rafter.width / 2, Math.max(a0 + X.rafter.width / 2, a0 + bayW * i));
    barUp(barK, a, X.rafter.width, X.rafter.proud);
  }
  if (ctx.lod >= 1) {
    // sash rails where one sash overlaps the next, and the sash bars between the panes (LOD2)
    for (let j = 1; j < X.sashes; j++) barAcross(barK, j / X.sashes, X.rail.width, X.rail.proud);
    if (ctx.lod >= 2) {
      for (let i = 0; i < nR; i++) for (let c = 1; c < X.panesPerBay; c++) barUp(barK, a0 + bayW * i + (bayW * c) / X.panesPerBay, X.sashBar.width, X.sashBar.proud);
      const rows = Math.max(2, Math.round(slopeLen / X.pane[1]));
      for (let r = 1; r < rows; r++) barAcross(barK, r / rows, 0.012, X.lap + 0.002);
    }
  }
  // sill plate on the dwarf wall and the head rail where the glass meets the tiled strip
  box(barK, a0, a1, -0.04, 0.2, sill - 0.02, sill + 0.1);
  box(barK, a0, a1, dGlass - 0.12, dGlass + 0.1, hGlass - 0.08, hGlass + 0.06);
  // rolled straw night-mats lying on the top of the glazing (summer: rolled up) [N]
  if (ctx.lod >= 1) {
    const r = X.nightMat.radius;
    const matK = matKey('roof.thatch', X.nightMat.colour);
    const nSeg = ctx.lod >= 2 ? 8 : 6;
    const cu = 1 - (r + 0.12) / slopeLen;
    const ring = (a: number) =>
      Array.from({ length: nSeg }, (_, k): P3 => {
        const th = (k / nSeg) * Math.PI * 2;
        const q = S(a, cu + (Math.cos(th) * r) / slopeLen, r + X.rafter.proud + Math.sin(th) * r);
        return q;
      });
    const ra = ring(a0 + 0.1);
    const rb = ring(a1 - 0.1);
    const cA = S(a0 + 0.1, cu, r + X.rafter.proud);
    for (let k = 0; k < nSeg; k++) {
      const k2 = (k + 1) % nSeg;
      const mid: P3 = [(ra[k][0] + ra[k2][0]) / 2 - cA[0], (ra[k][1] + ra[k2][1]) / 2 - cA[1], (ra[k][2] + ra[k2][2]) / 2 - cA[2]];
      gr.quadFacing(matK, ra[k], ra[k2], rb[k2], rb[k], mid);
    }
    gr.polygonFacing(matK, ra, [-tan[0], -tan[1], 0]);
    gr.polygonFacing(matK, rb, [tan[0], tan[1], 0]);
  }
  // Kanalheizung: two flue chimneys on the back wall, rendered, with a stone cap [N]
  const C = X.chimney;
  for (const ca of [C.inset, len - C.inset]) {
    const d0 = depth - G.backWall / 2 - C.depth / 2;
    box(wallK, ca - C.width / 2, ca + C.width / 2, d0, d0 + C.depth, backTop - 0.3, backTop + C.height);
    box(plinthK, ca - C.width / 2 - 0.05, ca + C.width / 2 + 0.05, d0 - 0.05, d0 + C.depth + 0.05, backTop + C.height, backTop + C.height + 0.1);
  }
  // tiled lean-to strip over the back (shed), from the head rail up to the back wall coping, with eaves overhang
  const tileN: P3 = [-inn[0] * (backTop - hGlass), -inn[1] * (backTop - hGlass), depth - dGlass];
  gr.quadFacing(tileK, P(-0.15, dGlass - 0.2, hGlass), P(len + 0.15, dGlass - 0.2, hGlass), P(len + 0.15, depth + 0.15, backTop + 0.08), P(-0.15, depth + 0.15, backTop + 0.08), tileN);
  gr.quadFacing(tileK, P(-0.15, dGlass - 0.2, hGlass - 0.06), P(-0.15, depth + 0.15, backTop + 0.02), P(len + 0.15, depth + 0.15, backTop + 0.02), P(len + 0.15, dGlass - 0.2, hGlass - 0.06), [-tileN[0], -tileN[1], -tileN[2]]);
  // inside: a soil floor and staging with potted plants behind the glass (reads through the panes) [N]
  g.polygonFacing(soilK, [P(tw, tw, base + 0.02), P(len - tw, tw, base + 0.02), P(len - tw, depth - G.backWall, base + 0.02), P(tw, depth - G.backWall, base + 0.02)], [0, 0, 1]);
  if (ctx.lod >= 1) {
    // staging where the slope leaves head room (wave-7 review fix: the plants poked through the low front glazing)
    const glassH = (d: number) => sill + ((hGlass - sill) * (d - 0.05)) / (dGlass - 0.05);
    const sd0 = Math.min(2.0, dGlass * 0.3);
    const stTop = Math.min(base + 0.82, glassH(sd0) - 0.5);
    box(woodK, tw + 0.2, len - tw - 0.2, sd0, sd0 + 1.0, stTop - 0.07, stTop);
    const n = Math.floor((len - 2 * tw - 0.6) / 0.7);
    for (let i = 0; i < n; i++) {
      const a = tw + 0.5 + i * 0.7;
      box(plantK, a - 0.22, a + 0.22, sd0 + 0.2, sd0 + 0.8, stTop, Math.min(stTop + 0.33 + ((i * 37) % 5) * 0.06, glassH(sd0 + 0.2) - 0.12));
    }
    // a raised tan bed (Lohbeet) along the back for pineapples [D-> BSB 25r "serres pour les ananas"; N]
    box(soilK, tw + 0.2, len - tw - 0.2, dGlass - 1.6, depth - G.backWall - 0.1, base, base + 0.6);
    for (let i = 0; i < n; i++) {
      const a = tw + 0.5 + i * 0.7;
      box(plantK, a - 0.2, a + 0.2, dGlass - 1.3, dGlass - 0.5, base + 0.6, base + 0.95);
    }
  }
}
