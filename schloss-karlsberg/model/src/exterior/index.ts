/**
 * Exterior generator (exterior + viewer package): buildExterior(b, ctx) -> THREE.Group in the building-group
 * convention (position = frame.originLocal, rotation.y = frame.rotationY, children in (s, h, −t)).
 *
 * LOD0: massing - plinth, wall prism (+ risalit blocks), roof volume, raised centre roof + turret.
 * LOD1: facades with real openings (wall pieces around holes, reveals), surrounds, sills, cornices, string
 *       courses, corner strips, dormers, oculi, chimneys (facade.ts).
 * LOD2: + glazing bars, shutters, door leaves, Freitreppen, portal details, and the interior (buildInterior).
 */
import * as THREE from 'three';
import type { BuildExteriorFn } from '../api.ts';
import type { BuildContext } from '../context.ts';
import { E0, N0 } from '../frame.ts';
import type { BuildingLayout } from '../layout/building.ts';
import { enToST, stToEN } from '../layout/footprint.ts';
import { pointAlong } from '../layout/geom.ts';
import { wallFreeSpans } from '../layout/walls.ts';
import { raisedRoofs } from '../layout/raised.ts';
import { isPlaced } from '../spec.ts';
import { inEpoch } from '../layout/epoch.ts';
import type { Building, ST } from '../spec.ts';
import { normaliseColour } from '../materials/index.ts';
import { buildInterior } from '../interior/index.ts';
import { GeoBuilder, type MatKey, type P3, matKey } from './builder.ts';
import { domeSection, rectRoof, roundRoof } from './roof.ts';
import { buildingLum, limewashColour, roofTint } from './shade.ts';
import { buildFacades, buildRoundFacades } from './facade.ts';
import { buildRotunda } from './rotunda.ts'; // KB-I24 round temple pavilion (programme owner)
import { vaneAt } from './hardware.ts';
import { COURT_FURNITURE, GARDEN_DETAIL } from '../layout/grammar.ts';
import { gardenWall } from '../site/gardenWall.ts'; // wave 5: stepped garden walls (garden owner)
import { buildGlasshouse } from './glasshouse.ts'; // wave-5 fix: lean-to forcing houses (garden owner)
import { buildMenagerie } from './menagerie.ts'; // KB-I29 menagerie houses (architecture)
import { buildFolly } from './folly.ts'; // KB-I31 / KB-I39 / KB-I30 follies (architecture)

export interface ExteriorPalette {
  wall: MatKey;
  members: MatKey;
  /** KB-I15: exposed sandstone dressings at portals, Durchfahrten, porticos and gate piers. */
  stone: MatKey;
  plinth: MatKey;
  roof: MatKey;
  deck: MatKey;
  colours: { wall: string; members: string; plinth: string; stone: string };
}

/** Classes whose members default to dressed sandstone (service / farm buildings, N); all others get painted render. */
const STONE_MEMBER_CLASSES = new Set(['FARM', 'FARM_GROUP', 'RIDE', 'STABLE']);

export function palette(b: Building, ctx: BuildContext): ExteriorPalette {
  const d = ctx.spec.defaults ?? {};
  const dd = d as Record<string, unknown>;
  const farm = b.cls === 'FARM' || b.cls === 'FARM_GROUP' || b.cls === 'RIDE';
  const wallName = farm ? 'render.farm' : 'render.lime';
  // KB-I19: court limewash moves warm (older 1778-82 work) or cool (fresh 1785-88 work) by the facade finish year
  // [research/09 §1.3.6, §3.7, M3; D dates; I split]
  const baseWallC = normaliseColour(b.facade.colour) ?? normaliseColour(String(dd.render ?? '')) ?? '#ECE8DF';
  const wallC = farm ? baseWallC : limewashColour(baseWallC, b.facade.build_year);
  const membersC = normaliseColour(b.facade.members_colour) ?? normaliseColour(String(dd.members ?? '')) ?? '#BDBAB2';
  const plinthC = normaliseColour(b.facade.plinth_colour) ?? normaliseColour(String(dd.plinth ?? '')) ?? '#A65E4A';
  const cover = b.roof.cover ?? 'slate';
  const roofName = cover === 'tile' ? 'roof.tile' : cover === 'copper' ? 'roof.copper' : cover === 'lead' ? 'roof.lead' : cover === 'thatch' ? 'roof.thatch' : cover === 'earth' ? 'roof.earth' : 'roof.slate';
  const roofC = roofName === 'roof.tile' ? normaliseColour(String(dd.tile ?? '')) : roofName === 'roof.slate' ? normaliseColour(String(dd.slate ?? '')) : null;
  // members (KB-I15, research/09 E7): painted render (render.member) on court buildings; dressed sandstone on service
  // buildings or when the catalogue says 'stone'. A red hex still means red ashlar (stone.red), chosen on purpose.
  const memberMat = b.facade.members_material ?? (STONE_MEMBER_CLASSES.has(b.cls) ? 'stone' : 'render');
  const membersName = /^#(A|9|8)/.test(membersC) ? 'stone.red' : memberMat === 'render' ? 'render.member' : 'stone.grey';
  // exposed sandstone only at portals, Durchfahrten, porticos and gate piers (steps and plinths use the plinth stone)
  const stoneC = normaliseColour(b.facade.portal_colour) ?? membersC;
  const stoneName = /^#(A|9|8)/.test(stoneC) ? 'stone.red' : 'stone.grey';
  return {
    wall: matKey(wallName, farm ? (normaliseColour(b.facade.colour) ?? '#E8DFC8') : wallC),
    members: matKey(membersName, membersC),
    stone: matKey(stoneName, stoneC),
    plinth: matKey('stone.red', plinthC),
    roof: matKey(roofName, roofC),
    deck: matKey('roof.lead'),
    colours: { wall: wallC, members: membersC, plinth: plinthC, stone: stoneC },
  };
}

/** Lowest terrain height under/around the footprint (local sampler), NaN if unknown. */
export function terrainMinUnder(L: BuildingLayout, ctx: BuildContext): number {
  let m = Infinity;
  const f = L.frame;
  const pts: ST[] = [...f.ringST];
  for (const sd of Object.values(f.sides)) {
    for (let k = 0; k <= 8; k++) {
      const a = (k / 8) * sd.length;
      pts.push([sd.p0[0] + sd.tangent[0] * a + sd.normal[0] * 0.5, sd.p0[1] + sd.tangent[1] * a + sd.normal[1] * 0.5]);
    }
  }
  for (const p of pts) {
    const [E, N] = stToEN(f, p);
    const h = ctx.terrain(E - E0, -(N - N0));
    if (Number.isFinite(h)) m = Math.min(m, h);
  }
  return Number.isFinite(m) ? m : NaN;
}

export interface ExteriorInfo {
  plinthBottom: number;
  plinthTop: number;
  eaves: number;
}

/** Rectangle corners of the frame (CCW) - walls of 'rect' buildings align with the roof rectangle. */
function outline(L: BuildingLayout): ST[] {
  const f = L.frame;
  if (f.shape === 'rect') {
    const l = f.length / 2;
    const w = f.width / 2;
    return [
      [-l, -w],
      [l, -w],
      [l, w],
      [-l, w],
    ];
  }
  if (f.shape === 'round') {
    const r = f.radius ?? f.width / 2;
    const n = 32;
    return Array.from({ length: n }, (_, i): ST => [r * Math.cos((i / n) * Math.PI * 2), r * Math.sin((i / n) * Math.PI * 2)]);
  }
  return f.ringST;
}

/** Vertical prism faces along a CCW plan ring. */
export function prism(g: GeoBuilder, k: MatKey, ring: ST[], h0: number, h1: number, cap?: MatKey): void {
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    g.quad(k, [p[0], p[1], h0], [q[0], q[1], h0], [q[0], q[1], h1], [p[0], p[1], h1]);
  }
  if (cap) g.polygonFacing(cap, ring.map((p): P3 => [p[0], p[1], h1]), [0, 0, 1]);
}

/** Offset a CCW ring outwards by `d` (miter; fine for rectangles and gentle polygons). */
export function offsetRing(ring: ST[], d: number): ST[] {
  const n = ring.length;
  return ring.map((p, i) => {
    const a = ring[(i - 1 + n) % n];
    const b = ring[(i + 1) % n];
    const e1 = norm([p[0] - a[0], p[1] - a[1]]);
    const e2 = norm([b[0] - p[0], b[1] - p[1]]);
    const n1: ST = [e1[1], -e1[0]];
    const n2: ST = [e2[1], -e2[0]];
    const m = norm([n1[0] + n2[0], n1[1] + n2[1]]);
    const c = Math.max(0.3, m[0] * n1[0] + m[1] * n1[1]);
    return [p[0] + (m[0] * d) / c, p[1] + (m[1] * d) / c];
  });
}

function norm(v: ST): ST {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

/** Roof (main + raised sections + turret) for any LOD. Returns nothing; adds to g. */
export function buildRoof(g: GeoBuilder, L: BuildingLayout, pal: ExteriorPalette, lod: 0 | 1 | 2): void {
  const f = L.frame;
  const sec = L.roof;
  const type = sec.type;
  if (type === 'none') return;
  const farm = L.building.cls === 'FARM' || L.building.cls === 'RIDE';
  const overhang = farm && type !== 'flat' ? 0.4 : 0;
  if (f.shape === 'round' || type === 'dome' || type === 'cone' || type === 'mound') {
    const r = f.shape === 'round' ? (f.radius ?? f.width / 2) : Math.min(f.length, f.width) / 2;
    // smooth revolved roofs: 48 segments and 12 profile steps from LOD1 (wave-4 review, lead dome of KB-B07)
    const s = type === 'dome' || type === 'mound' ? domeSection({ ...sec, type: 'dome' }, lod >= 1 ? 12 : 8) : sec;
    roundRoof(g, s, r, pal.roof, 0, 0, lod >= 1 ? 48 : 32);
    if (f.shape !== 'round') {
      // dome over a rectangle: close the corners with a flat lead deck at the eaves
      const l = f.length / 2;
      const w = f.width / 2;
      g.quad(pal.deck, [-l, -w, sec.eaves_h], [l, -w, sec.eaves_h], [l, w, sec.eaves_h], [-l, w, sec.eaves_h]);
    }
    return;
  }
  if (f.shape === 'polygon') {
    // irregular footprint: flat lead roof with a low parapet edge (roof form U for these)
    const ring = f.ringST;
    g.polygonFacing(pal.deck, ring.map((p): P3 => [p[0], p[1], sec.eaves_h + 0.3]), [0, 0, 1]);
    prism(g, pal.members, ring, sec.eaves_h, sec.eaves_h + 0.3);
    return;
  }
  rectRoof(g, sec, {
    length: f.length,
    depth: f.width,
    hipped: L.roofPlan.hippedEnds,
    overhang,
    roofKey: pal.roof,
    gableKey: pal.wall,
    deckKey: pal.deck,
  });
  for (const rr of raisedRoofs(L)) {
    rectRoof(g, rr.section, { sMid: rr.sMid, length: rr.length, depth: f.width, hipped: true, roofKey: pal.roof, gableKey: pal.wall, deckKey: pal.deck });
    if (rr.turret) {
      turret(g, rr.sMid, 0, rr.turret.base_h, rr.turret.top_h, rr.turret.width, pal, lod);
      // KB-I22: weather vane on the Dachreiter spire [HMS 06 §3.2; research/09 E5]
      if (lod >= 1) vaneAt(g, L, rr.sMid, 0, rr.turret.top_h + 0.9);
    }
  }
}

/** Dachreiter / lantern: octagonal drum, small onion-ish cap and spire. */
export function turret(g: GeoBuilder, s: number, t: number, base: number, top: number, w: number, pal: ExteriorPalette, lod: number): void {
  const n = 8;
  const r = w / 2 / Math.cos(Math.PI / n);
  const drumTop = base + (top - base) * 0.55;
  const ring: ST[] = Array.from({ length: n }, (_, i): ST => [s + r * Math.cos(((i + 0.5) / n) * Math.PI * 2), t + r * Math.sin(((i + 0.5) / n) * Math.PI * 2)]);
  prism(g, pal.wall, ring, base - 1.5, drumTop);
  if (lod >= 1) {
    // openings suggested by dark louvre panels on alternate faces
    for (let i = 0; i < n; i += 2) {
      const p = ring[i];
      const q = ring[(i + 1) % n];
      const c: ST = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const tan = norm([q[0] - p[0], q[1] - p[1]]);
      const nrm: ST = [tan[1], -tan[0]];
      const half = Math.hypot(q[0] - p[0], q[1] - p[1]) * 0.3;
      g.orientedBox(matKey('wood.shutter', '#3B3F44'), c, tan, nrm, -half, half, 0, 0.02, base + 0.4, drumTop - 0.4);
    }
  }
  // cornice ring
  prism(g, pal.members, offsetRing(ring, 0.12), drumTop, drumTop + 0.25, pal.members);
  // cap (revolved bell) + spire
  const capH = (top - drumTop) * 0.55;
  const prof: [number, number][] = [
    [r * 1.05, drumTop + 0.25],
    [r * 0.95, drumTop + 0.25 + capH * 0.35],
    [r * 0.55, drumTop + 0.25 + capH * 0.75],
    [r * 0.12, drumTop + 0.25 + capH],
  ];
  const k = matKey('roof.copper');
  for (let j = 0; j < 16; j++) {
    const a0 = (j / 16) * Math.PI * 2;
    const a1 = ((j + 1) / 16) * Math.PI * 2;
    for (let i = 1; i < prof.length; i++) {
      const [r0, h0] = prof[i - 1];
      const [r1, h1] = prof[i];
      g.quad(k, [s + r0 * Math.cos(a0), t + r0 * Math.sin(a0), h0], [s + r0 * Math.cos(a1), t + r0 * Math.sin(a1), h0], [s + r1 * Math.cos(a1), t + r1 * Math.sin(a1), h1], [s + r1 * Math.cos(a0), t + r1 * Math.sin(a0), h1]);
    }
  }
  const sp0 = drumTop + 0.25 + capH;
  for (let j = 0; j < 6; j++) {
    const a0 = (j / 6) * Math.PI * 2;
    const a1 = ((j + 1) / 6) * Math.PI * 2;
    g.tri(matKey('metal.gilt'), [s + 0.12 * Math.cos(a0), t + 0.12 * Math.sin(a0), sp0], [s + 0.12 * Math.cos(a1), t + 0.12 * Math.sin(a1), sp0], [s, t, top + 1.2]);
  }
}

/** LOD0 massing body (plinth, walls, risalit blocks) - also used for buildings without facades at LOD1. */
export function massing(g: GeoBuilder, L: BuildingLayout, pal: ExteriorPalette, info: ExteriorInfo, spans?: [number, number][], lod = 0, ground?: (s: number, t: number) => number): void {
  const b = L.building;
  const ring = outline(L);
  if (b.cls === 'GARD' && ground) {
    // wave 5: bays stepping with the ground, saddle coping, piers, lime-wash variation and a damp foot (site/gardenWall.ts)
    gardenWall(g, ring, { ground, height: L.stack.wallHeight || 2.5, fallback: info.plinthTop, wall: pal.wall, coping: matKey('stone.yellow', GARDEN_DETAIL.wall.copingColour), id: b.id, lod });
    return;
  }
  if (b.cls === 'GARD') {
    // enclosure (garden, kennel, amphitheatre): perimeter wall, open inside
    const h = info.plinthTop + (L.stack.wallHeight || 2.5);
    perimeterWall(g, ring, info.plinthBottom, h, 0.6, pal.wall, pal.members);
    return;
  }
  if (b.cls === 'WALL' && /gitter|grille/i.test(`${b.name_de} ${b.facade.material ?? ''}`)) {
    grille(g, L, pal, info, lod);
    return;
  }
  if (b.cls === 'FARM_GROUP') {
    prism(g, matKey('hypothesis'), ring, info.plinthBottom, info.eaves, matKey('hypothesis'));
    return;
  }
  if (b.cls === 'WALL' && spans) {
    // free-standing wall: only the parts that are not a building's own face (KB-B14 = KB-B10 basement front)
    const w = L.frame.width / 2;
    for (const [s0, s1] of spans) {
      prism(g, pal.wall, [[s0, -w], [s1, -w], [s1, w], [s0, w]], info.plinthBottom, info.eaves - 0.25);
      prism(g, pal.members, [[s0 - 0.05, -w - 0.08], [s1 + 0.05, -w - 0.08], [s1 + 0.05, w + 0.08], [s0 - 0.05, w + 0.08]], info.eaves - 0.25, info.eaves, pal.members);
    }
    return;
  }
  const proj = 0.08;
  prism(g, pal.plinth, offsetRing(ring, proj), info.plinthBottom, info.plinthTop, pal.plinth);
  prism(g, pal.wall, ring, info.plinthTop, info.eaves);
  if (L.roof.type === 'none' || L.roof.type === 'flat') {
    g.polygonFacing(pal.deck, ring.map((p): P3 => [p[0], p[1], info.eaves]), [0, 0, 1]);
  }
  // risalit blocks
  if (L.frame.shape === 'rect') {
    for (const sd of Object.values(L.sides)) {
      const side = L.frame.sides[sd.side];
      for (const r of sd.risalits) {
        const p = r.risalit.projection ?? 0.5;
        g.orientedBox(pal.wall, side.p0, side.tangent, side.normal, r.a0, r.a1, -0.05, p, info.plinthTop, info.eaves, true);
        g.orientedBox(pal.plinth, side.p0, side.tangent, side.normal, r.a0 - proj, r.a1 + proj, -0.05, p + proj, info.plinthBottom, info.plinthTop, true);
      }
    }
  }
}

/**
 * Wrought-iron court grille on a low sandstone base, piers with vases, open double gate in the middle [D LC/PL; N dims].
 * KB-I23 (LOD1+): spear tips on every bar, gilt on the gate leaves only, iron on the fence [D-> Schwetzingen gate
 * "teilvergoldet"; LC dark; research/09 §3.5, COURT_FURNITURE.grilleTip].
 */
export function grille(g: GeoBuilder, L: BuildingLayout, pal: ExteriorPalette, info: ExteriorInfo, lod = 0): void {
  const len = L.frame.length;
  const base = L.stack.base_h;
  const top = base + (L.building.facade.height_m ?? 3.6) * 0.75;
  const iron = matKey('metal.iron');
  const pier = pal.stone; // sandstone gate piers [D LC/PL] (KB-I15: exposed stone only at portals, piers, steps)
  const gate = 4.0;
  const piers: number[] = [];
  const nHalf = Math.max(1, Math.round((len / 2 - gate / 2 - 0.5) / 4));
  for (let i = 0; i <= nHalf; i++) {
    const s = gate / 2 + 0.5 + ((len / 2 - gate / 2 - 0.5 - 0.35) * i) / nHalf;
    piers.push(s, -s);
  }
  // base wall left and right of the gate
  for (const sgn of [-1, 1]) {
    const s0 = sgn * (gate / 2 + 0.5);
    const s1 = sgn * (len / 2);
    g.box(pal.plinth, Math.min(s0, s1), Math.max(s0, s1), -0.3, 0.3, info.plinthBottom, base + 0.55);
    g.box(pier, Math.min(s0, s1), Math.max(s0, s1), -0.36, 0.36, base + 0.55, base + 0.65);
    // bars
    for (let s = Math.min(s0, s1) + 0.1; s < Math.max(s0, s1) - 0.05; s += 0.13) {
      g.box(iron, s - 0.014, s + 0.014, -0.014, 0.014, base + 0.65, top - 0.1);
      if (lod >= 1) spearTip(g, iron, s, 0, top - 0.06);
    }
    g.box(iron, Math.min(s0, s1), Math.max(s0, s1), -0.025, 0.025, top - 0.12, top - 0.06);
    g.box(iron, Math.min(s0, s1), Math.max(s0, s1), -0.025, 0.025, base + 0.9, base + 0.95);
  }
  for (const s of piers) {
    const big = Math.abs(s) < gate / 2 + 0.6;
    const w = big ? 0.55 : 0.32;
    const h = big ? top + 1.2 : top + 0.2;
    g.box(pier, s - w, s + w, -w, w, info.plinthBottom, h);
    g.box(pier, s - w - 0.08, s + w + 0.08, -w - 0.08, w + 0.08, h, h + 0.15);
    // vase
    g.box(pier, s - w * 0.4, s + w * 0.4, -w * 0.4, w * 0.4, h + 0.15, h + 0.35);
    g.box(pier, s - w * 0.55, s + w * 0.55, -w * 0.55, w * 0.55, h + 0.35, h + 0.75);
    g.box(pier, s - w * 0.3, s + w * 0.3, -w * 0.3, w * 0.3, h + 0.75, h + 0.95);
  }
  // open gate leaves (turned inwards, towards the court = +t)
  for (const sgn of [-1, 1]) {
    const s = sgn * (gate / 2 - 0.05);
    for (let t = 0.1; t < gate / 2 - 0.05; t += 0.13) {
      g.box(iron, s - 0.014, s + 0.014, t - 0.014, t + 0.014, base + 0.05, top + 0.3);
      if (lod >= 1) spearTip(g, matKey('metal.gilt'), s, t, top + 0.3);
    }
    g.box(iron, s - 0.025, s + 0.025, 0, gate / 2, top + 0.2, top + 0.3);
    g.box(iron, s - 0.025, s + 0.025, 0, gate / 2, base + 0.05, base + 0.15);
  }
}

/** Square spear tip of a grille bar standing at (s, t) from height h (COURT_FURNITURE.grilleTip). */
function spearTip(g: GeoBuilder, k: MatKey, s: number, t: number, h: number): void {
  const T = COURT_FURNITURE.grilleTip;
  const w = T.base;
  const c: P3[] = [
    [s - w, t - w, h],
    [s + w, t - w, h],
    [s + w, t + w, h],
    [s - w, t + w, h],
  ];
  const apex: P3 = [s, t, h + T.height];
  for (let i = 0; i < 4; i++) {
    const p = c[i];
    const q = c[(i + 1) % 4];
    g.polygonFacing(k, [p, q, apex], [(p[0] + q[0]) / 2 - s, (p[1] + q[1]) / 2 - t, 0]);
  }
}

export function perimeterWall(g: GeoBuilder, ring: ST[], h0: number, h1: number, th: number, wall: MatKey, cap: MatKey): void {
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < 0.05) continue;
    const tan: ST = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
    const nrm: ST = [tan[1], -tan[0]];
    g.orientedBox(wall, p, tan, nrm, 0, len, -th, 0, h0, h1 - 0.12);
    g.orientedBox(cap, p, tan, nrm, -0.03, len + 0.03, -th - 0.05, 0.05, h1 - 0.12, h1);
  }
}

export function exteriorInfo(L: BuildingLayout, ctx: BuildContext): ExteriorInfo {
  const st = L.stack;
  const tmin = terrainMinUnder(L, ctx);
  const plinthBottom = Math.min(st.plinth.bottom_h, Number.isFinite(tmin) ? tmin - 0.3 : st.plinth.bottom_h);
  const first = st.levels[0];
  // a high basement storey is the building's ashlar base (Orangerie W front, HMS windowed ashlar basement)
  const plinthTop = first && (first.kind === 'plinth' || first.kind === 'basement') ? first.top_h : st.base_h + 0.3;
  return { plinthBottom, plinthTop: Math.min(plinthTop, st.eaves_h), eaves: st.eaves_h };
}

/**
 * s-intervals of a WALL that do not coincide with another placed building's footprint (layout/walls.ts).
 * Returns undefined for walls without a centre line (use the plain massing).
 */
export function wallSpansS(L: BuildingLayout, ctx: BuildContext): [number, number][] | undefined {
  const b = L.building;
  if (!b.line || b.line.length < 2) return undefined;
  const rings = ctx.spec.buildings.filter((o) => o.id !== b.id && o.footprint && isPlaced(o) && inEpoch(o.epoch, ctx.options.year) && o.cls !== 'WALL').map((o) => o.footprint!);
  return wallFreeSpans(b.line, rings).map(([d0, d1]) => {
    const a = enToST(L.frame, pointAlong(b.line!, d0).p as [number, number])[0];
    const c = enToST(L.frame, pointAlong(b.line!, d1).p as [number, number])[0];
    return [Math.min(a, c), Math.max(a, c)] as [number, number];
  });
}

export const buildExterior: BuildExteriorFn = (b, ctx) => {
  const group = new THREE.Group();
  group.name = `${b.id}/exterior`;
  group.userData = { buildingId: b.id, part: 'exterior', lod: ctx.lod, confidence: b.confidence };
  if (!isPlaced(b)) return group;
  if (b.placement === 'hypothetical' && !ctx.options.showHypothetical) return group;
  if (!inEpoch(b.epoch, ctx.options.year)) return group; // KB-I03: not standing in the scene year
  const L = ctx.layout(b);
  const f = L.frame;
  group.position.set(f.originLocal.x, 0, f.originLocal.z);
  group.rotation.y = f.rotationY;
  const pal = palette(b, ctx);
  const info = exteriorInfo(L, ctx);
  // KB-I19/I20: bake per-vertex shade (AO + finish variation); per-building limewash luminance and roof-cover jitter
  const g = new GeoBuilder({ bake: true });
  const gr = new GeoBuilder({ bake: true });
  const lum = buildingLum(b.id, ctx.options.seed);
  const roofJ = roofTint(b.id, b.roof.cover ?? 'slate', ctx.options.seed);
  for (const gb of [g, gr]) {
    for (const n of ['render.lime', 'render.farm']) gb.tints.set(n, [lum, lum, lum]);
    for (const n of ['roof.slate', 'roof.tile']) gb.tints.set(n, roofJ);
  }
  const facades = ctx.lod >= 1 && f.shape === 'rect' && b.cls !== 'GARD' && b.cls !== 'FARM_GROUP' && b.cls !== 'WALL';
  const round = ctx.lod >= 1 && f.shape === 'round' && b.cls !== 'GARD' && b.cls !== 'FARM_GROUP' && b.cls !== 'WALL' && L.stack.wallHeight > 2;
  if (b.facade.menagerie) buildMenagerie(g, gr, L, pal, ctx); // KB-I29: menagerie houses instead of the GARD wall
  else if (b.facade.folly) buildFolly(g, gr, L, pal, ctx); // KB-I31 / KB-I39 / KB-I30: Altan and follies (roof none)
  else if (b.facade.glasshouse && f.shape === 'rect') buildGlasshouse(g, gr, L, pal, ctx); // wave 5: lean-to Treibhaus (garden owner)
  else if (facades) buildFacades(g, L, pal, info, ctx, gr);
  else if (round) (b.facade.rotunda ? buildRotunda : buildRoundFacades)(g, L, pal, info, ctx);
  else {
    const ground = b.cls === 'GARD' ? (s: number, t: number) => {
      const [E, N] = stToEN(f, [s, t]);
      return ctx.terrain(E - E0, -(N - N0));
    } : undefined;
    massing(g, L, pal, info, b.cls === 'WALL' ? wallSpansS(L, ctx) : undefined, ctx.lod, ground);
  }
  if (b.cls !== 'GARD' && b.cls !== 'FARM_GROUP') buildRoof(gr, L, pal, ctx.lod);
  const ud = { buildingId: b.id, part: 'exterior', lod: ctx.lod, confidence: b.confidence };
  for (const m of g.toMeshes(ctx.materials, `${b.id}/exterior`, ud)) group.add(m);
  for (const m of gr.toMeshes(ctx.materials, `${b.id}/roof`, { ...ud, part: 'roof' })) group.add(m);
  group.userData.triangles = g.triangleCount() + gr.triangleCount();
  if (ctx.lod >= 2 && b.interior !== 'none') {
    try {
      const inner = buildInterior(b, ctx);
      // interiors use the same building-group convention: re-parent their children under our transform
      inner.position.set(0, 0, 0);
      inner.rotation.set(0, 0, 0);
      inner.updateMatrix();
      group.add(inner);
    } catch (e) {
      console.warn(`[exterior] buildInterior(${b.id}) failed:`, e);
    }
  }
  return group;
};
