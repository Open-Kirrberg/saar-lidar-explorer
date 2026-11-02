/**
 * Room shell: floor, ceiling (flat with a cove cornice, or groin vault), walls with the holes
 * of every opening on the edge (facade windows from the shared layout, catalogue doors),
 * reveals, arched heads, skirting, chair rail, Louis-seize boiserie panels, door surrounds and
 * open door leaves - plus the walk colliders (floor + walls with doorways open).
 */
import * as THREE from 'three';
import { MATERIAL_NAMES, type MaterialLibrary, type MaterialName } from '../context.ts';
import type { Room, ST } from '../spec.ts';
import { STATE_ROOM } from '../layout/grammar.ts';
import { hashString } from '../layout/geom.ts';
import { borderColour, borderRects, canvasGrid, corniceHeight, damaskFigureOf, silkFields, silkHue, splitField, srgbToLinear, supraportePanels } from './finish.ts';
import { type Accumulator, type Bucket, type ColliderBucket, O, type PartInfo, type V3, beadProfile, mouldFrame, placeMatrix } from './mesh.ts';
import { type Tints, damaskMaterial, interiorMaterial } from './materials.ts';
import { type IOpening, LEAF_KINDS, WALK_KINDS } from './openings.ts';
import type { Grade, RoomType, RoomWall } from './programme.ts';
import type { RectST } from './stairPlan.ts';
import { DEFAULT_BOISERIE, type Hole, archPoints, archRise, boiseriePanels, freeAlong, solidRects } from './wall.ts';

export interface ShellInput {
  buildingId: string;
  room: Room;
  type: RoomType;
  grade: Grade;
  walls: RoomWall[];
  floor_h: number;
  ceiling_h: number;
  /** Walls run up to here (>= ceiling_h; stair halls of stacked storeys fill the build-up). */
  wall_top: number;
  /** Floor as rectangles (stair landings) instead of the polygon. */
  floorRects?: RectST[];
  /** Ceiling as rectangles (the upper floor exists only there). */
  ceilingRects?: RectST[];
  /** No ceiling at all (open to the floor above). */
  noCeiling?: boolean;
  vault: boolean;
  evidence: string;
  acc: Accumulator;
  lib: MaterialLibrary;
  tints: Tints;
  col: ColliderBucket;
  /** Door leaves already drawn (shared between the two rooms of a door). */
  leavesDone: Set<string>;
  /** KB-I26: plan positions of the room's chandeliers; each gets a stucco ceiling rosette (none without one). */
  rosettes?: ST[];
}

const FACADE_INSET = 0.012;

function norm3(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function materialOr(name: string | undefined, fallback: MaterialName): MaterialName {
  return name && (MATERIAL_NAMES as readonly string[]).includes(name) ? (name as MaterialName) : fallback;
}

export function buildShell(inp: ShellInput): void {
  const { room, acc, lib, walls } = inp;
  const shellInfo = (element: string, name_de = inp.room.name_de, evidence = inp.evidence, tag = room.tag): PartInfo => ({
    buildingId: inp.buildingId,
    roomId: room.id,
    name_de,
    evidence,
    tag,
    element,
  });
  const fin = room.finish;
  const floorMat = lib.get(materialOr(fin?.floor, 'floor.planks'));
  const wallName = materialOr(fin?.walls, 'wall.limewash');
  const ceilMat = lib.get(materialOr(fin?.ceiling, 'ceiling.stucco'));
  const fancy = wallName === 'wall.boiserie' || wallName.startsWith('wall.silk');
  const silk = wallName.startsWith('wall.silk');
  const gilt = inp.grade === 'state';
  // KB-I26: silk hue (catalogue finish.colour or the material's own), the damask border and the Tapetenleisten
  const hue = silk ? silkHue(fin) : null;
  const border = hue ? (fin?.border ?? borderColour(hue)) : null;
  const giltLeiste = inp.grade !== 'service';
  const H = inp.wall_top - inp.floor_h;
  const clear = inp.ceiling_h - inp.floor_h;

  // ---- floor ---------------------------------------------------------------------------------
  const fb = acc.get(floorMat, shellInfo('boden', `${room.name_de} – Boden`));
  const fh = inp.floor_h;
  if (inp.floorRects) {
    for (const r of inp.floorRects) {
      const q: V3[] = [O(r.s0, r.t0, fh), O(r.s1, r.t0, fh), O(r.s1, r.t1, fh), O(r.s0, r.t1, fh)];
      fb.quad(q[0], q[1], q[2], q[3], [0, 1, 0]);
      inp.col.quad(q[0], q[1], q[2], q[3]);
    }
  } else {
    polygonFace(fb, room.polygon, fh, [0, 1, 0]);
    polygonCollider(inp.col, room.polygon, fh);
  }

  // ---- walls -----------------------------------------------------------------------------------
  const dado = DEFAULT_BOISERIE.dado;
  // wave-5 review: the Bildergalerie's documented arabesques (T1 / T5), a lobed palmette elsewhere [N]
  const figure = damaskFigureOf(room.function);
  const wallMat = silk && hue ? damaskMaterial(lib, wallName, hue, figure) : lib.get(wallName);
  const dadoMat = lib.get('wall.boiserie');
  // the cornice must clear every opening head below the ceiling
  const corniceH = corniceHeight(walls.flatMap((w) => [...w.holes, ...(w.niches ?? [])]), clear, fancy, inp.vault);

  for (const w of walls) {
    const ext = w.exterior;
    const inset = ext ? FACADE_INSET : 0;
    // facade holes are narrowed 1 cm so the interior reveal sits inside the exterior's one
    const holes: Hole[] = w.hits.map((h) => (h.opening.facade ? { ...h.hole, u0: h.hole.u0 + 0.01, u1: h.hole.u1 - 0.01, v0: h.hole.v0 + (h.hole.v0 > 0.05 ? 0.01 : 0), v1: h.hole.v1 - 0.01 } : h.hole));
    // splayed facade reveals (ébrasement): the wall face opens `splay` m wider per side than the window
    const faceHoles: Hole[] = holes.map((h) => (h.splay ? { ...h, u0: Math.max(0, h.u0 - h.splay), u1: Math.min(w.len, h.u1 + h.splay) } : h));
    // wall niches (stove niches): holes in the room face only, lined below (fix wave 4)
    const nicheHoles: Hole[] = (w.niches ?? []).map((n) => ({ u0: n.u0, u1: n.u1, v0: 0, v1: n.v1, head: n.head }));
    const decorHoles = nicheHoles.length ? [...holes, ...nicheHoles] : holes;
    const P = (u: number, v: number, off = 0): V3 => {
      const s = w.p0[0] + w.d[0] * u + w.nIn[0] * (inset + off);
      const t = w.p0[1] + w.d[1] * u + w.nIn[1] * (inset + off);
      return O(s, t, inp.floor_h + v);
    };
    const nIn: V3 = [w.nIn[0], 0, -w.nIn[1]];
    const along: V3 = [w.d[0], 0, -w.d[1]];
    /** wall-plane direction (x along, y up, z into the room) -> object-space normal */
    const Nw = (x: number, y: number, z: number): V3 => norm3([along[0] * x + nIn[0] * z, y, along[2] * x + nIn[2] * z]);
    const wb = acc.get(wallMat, shellInfo('wand', `${room.name_de} – Wand`));
    const db = silk ? acc.get(dadoMat, shellInfo('lambris', `${room.name_de} – Lambris (Boiserie)`)) : wb;
    // wall face (silk rooms: boiserie dado below the chair rail)
    for (const r of solidRects(w.len, H, nicheHoles.length ? [...faceHoles, ...nicheHoles] : faceHoles)) {
      if (silk && r.v0 < dado) {
        const cut = Math.min(dado, r.v1);
        db.quad(P(r.u0, r.v0), P(r.u1, r.v0), P(r.u1, cut), P(r.u0, cut), nIn);
        if (r.v1 > dado) wb.quad(P(r.u0, dado), P(r.u1, dado), P(r.u1, r.v1), P(r.u0, r.v1), nIn);
      } else wb.quad(P(r.u0, r.v0), P(r.u1, r.v0), P(r.u1, r.v1), P(r.u0, r.v1), nIn);
    }
    // collider: wall with only the walkable openings open
    const walkHoles = w.hits.filter((h) => WALK_KINDS.has(h.opening.kind) || (h.opening.kind === 'porte_fenetre' && !h.opening.facade)).map((h) => h.hole);
    for (const r of solidRects(w.len, Math.min(H, 3.2), walkHoles)) inp.col.quad(P(r.u0, r.v0), P(r.u1, r.v0), P(r.u1, r.v1), P(r.u0, r.v1));

    // reveals (jambs, head / arch, sill)
    w.hits.forEach((hit, i) => {
      const h = holes[i];
      const o = hit.opening;
      const depth = o.facade ? Math.max(0.05, hit.depth - inset - 0.12) : hit.depth - inset;
      if (depth <= 0.01) return;
      const rb = acc.get(lib.get(fancy ? 'wall.boiserie' : wallName), shellInfo('laibung', `${room.name_de} – Laibung`));
      const rise = Math.min(archRise(h.head, h.u1 - h.u0), h.v1 - h.v0);
      const spring = h.v1 - rise;
      const out = -depth;
      const sp = rise > 0.01 ? 0 : (faceHoles[i].u0 < h.u0 ? h.u0 - faceHoles[i].u0 : 0);
      const sq = rise > 0.01 ? 0 : (faceHoles[i].u1 > h.u1 ? faceHoles[i].u1 - h.u1 : 0);
      if (sp > 0 || sq > 0) {
        // splayed jambs, sill and head: room face at u0 - sp / u1 + sq, glass side at u0 / u1
        const nL = norm3([along[0] * depth + nIn[0] * sp, 0, along[2] * depth + nIn[2] * sp]);
        const nR = norm3([-along[0] * depth + nIn[0] * sq, 0, -along[2] * depth + nIn[2] * sq]);
        rb.quad(P(h.u0 - sp, h.v0), P(h.u0, h.v0, out), P(h.u0, h.v1, out), P(h.u0 - sp, h.v1), nL);
        rb.quad(P(h.u1 + sq, h.v0), P(h.u1, h.v0, out), P(h.u1, h.v1, out), P(h.u1 + sq, h.v1), nR);
        if (h.v0 > 0.02) rb.quad(P(h.u0 - sp, h.v0), P(h.u1 + sq, h.v0), P(h.u1, h.v0, out), P(h.u0, h.v0, out), [0, 1, 0]);
        rb.quad(P(h.u0 - sp, h.v1), P(h.u1 + sq, h.v1), P(h.u1, h.v1, out), P(h.u0, h.v1, out), [0, -1, 0]);
        return;
      }
      rb.quad(P(h.u0, h.v0), P(h.u0, h.v0, out), P(h.u0, spring, out), P(h.u0, spring), along);
      rb.quad(P(h.u1, h.v0), P(h.u1, h.v0, out), P(h.u1, spring, out), P(h.u1, spring), [-along[0], 0, -along[2]]);
      if (h.v0 > 0.02) rb.quad(P(h.u0, h.v0), P(h.u1, h.v0), P(h.u1, h.v0, out), P(h.u0, h.v0, out), [0, 1, 0]);
      else if (!o.facade) {
        // threshold of interior doors: floor strip through the wall
        const tb = acc.get(lib.get(materialOr(fin?.floor, 'floor.planks')), shellInfo('boden', `${room.name_de} – Boden`));
        tb.quad(P(h.u0, 0.001), P(h.u1, 0.001), P(h.u1, 0.001, out), P(h.u0, 0.001, out), [0, 1, 0]);
        inp.col.quad(P(h.u0, 0), P(h.u1, 0), P(h.u1, 0, out), P(h.u0, 0, out));
      }
      if (rise > 0.01) {
        const pts = archPoints(h.head, h.u1 - h.u0, h.v1, 10).map(([u, v]) => [h.u0 + u, v] as [number, number]);
        // soffit of the arch: normals point to the arch centre
        const half = (h.u1 - h.u0) / 2;
        const R = (rise * rise + half * half) / (2 * rise);
        const cu = h.u0 + half;
        const cv = h.v1 - R;
        for (let k = 0; k < pts.length - 1; k++) {
          const [ua, va] = pts[k];
          const [ub, vb] = pts[k + 1];
          const nu = cu - (ua + ub) / 2;
          const nv = cv - (va + vb) / 2;
          const ln = Math.hypot(nu, nv) || 1;
          const n: V3 = [(nu / ln) * along[0], nv / ln, (nu / ln) * along[2]];
          rb.quad(P(ua, va), P(ub, vb), P(ub, vb, out), P(ua, va, out), n);
        }
        // spandrels on the wall face between the arch and the rectangle top
        const mid = Math.floor(pts.length / 2);
        for (let k = 0; k < mid; k++) wb.tri(P(h.u0, h.v1), P(pts[k][0], pts[k][1]), P(pts[k + 1][0], pts[k + 1][1]), nIn);
        for (let k = mid; k < pts.length - 1; k++) wb.tri(P(h.u1, h.v1), P(pts[k][0], pts[k][1]), P(pts[k + 1][0], pts[k + 1][1]), nIn);
      } else {
        rb.quad(P(h.u0, h.v1), P(h.u1, h.v1), P(h.u1, h.v1, out), P(h.u0, h.v1, out), [0, -1, 0]);
      }
    });

    // niches: semi-elliptic plan, quarter-ellipsoid hood, round head on the face, moulded surround
    for (const n of w.niches ?? []) {
      const lining = acc.get(lib.get('ceiling.stucco'), shellInfo('nische', `${room.name_de} – Wandnische`, 'D N', n.tag));
      const a = (n.u1 - n.u0) / 2;
      const b = n.depth;
      const cu = n.u0 + a;
      const spring = n.v1 - a;
      const SEG = 14;
      const RING = 6;
      const fl = acc.get(lib.get(materialOr(fin?.floor, 'floor.planks')), shellInfo('boden', `${room.name_de} – Boden`));
      const up: V3 = [0, 1, 0];
      // point on the niche surface: plan angle phi (0 = left face edge, PI = right), elevation theta (0 = spring)
      const Q = (phi: number, theta: number, v?: number): V3 => P(cu - a * Math.cos(phi) * Math.cos(theta), v ?? spring + a * Math.sin(theta), -b * Math.sin(phi) * Math.cos(theta));
      const inward = (phi: number, theta: number): V3 => {
        const du = -a * Math.cos(phi) * Math.cos(theta);
        const dd = b * Math.sin(phi) * Math.cos(theta);
        const dv = a * Math.sin(theta);
        return norm3([along[0] * (-du / (a * a)) + nIn[0] * (dd / (b * b)), -dv / (a * a), along[2] * (-du / (a * a)) + nIn[2] * (dd / (b * b))]);
      };
      for (let k = 0; k < SEG; k++) {
        const p0 = (Math.PI * k) / SEG;
        const p1 = (Math.PI * (k + 1)) / SEG;
        const pm = (p0 + p1) / 2;
        // back wall up to the springing
        lining.quad(Q(p0, 0, 0), Q(p1, 0, 0), Q(p1, 0, spring), Q(p0, 0, spring), inward(pm, 0));
        // floor of the niche (fan from the face centre)
        fl.tri(P(cu, 0.001), Q(p0, 0, 0.001), Q(p1, 0, 0.001), up);
        // hood (concha)
        for (let j = 0; j < RING; j++) {
          const t0 = ((Math.PI / 2) * j) / RING;
          const t1 = ((Math.PI / 2) * (j + 1)) / RING;
          const n0 = inward(pm, (t0 + t1) / 2);
          if (j === RING - 1) lining.tri(Q(p0, t0), Q(p1, t0), Q(pm, t1), n0);
          else lining.quad(Q(p0, t0), Q(p1, t0), Q(p1, t1), Q(p0, t1), n0);
        }
      }
      // spandrels on the wall face between the arch and the rectangle top
      const pts = archPoints('round', 2 * a, n.v1, SEG).map(([u, v]) => [n.u0 + u, v] as [number, number]);
      const mid = Math.floor(pts.length / 2);
      for (let k = 0; k < mid; k++) wb.tri(P(n.u0, n.v1), P(pts[k][0], pts[k][1]), P(pts[k + 1][0], pts[k + 1][1]), nIn);
      for (let k = mid; k < pts.length - 1; k++) wb.tri(P(n.u1, n.v1), P(pts[k][0], pts[k][1]), P(pts[k + 1][0], pts[k + 1][1]), nIn);
      // moulded surround: jamb strips above the skirting and an archivolt (gilt in state rooms)
      const sur = acc.get(gilt ? lib.get('metal.gilt') : lib.get('wall.boiserie'), shellInfo('nische', `${room.name_de} – Nischenrahmen`, 'N', 'N moulded niche surround (Louis-seize)'));
      const bw = 0.07;
      const z = 0.025;
      for (const [u0, u1] of [
        [n.u0 - bw, n.u0],
        [n.u1, n.u1 + bw],
      ] as [number, number][]) {
        sur.quad(P(u0, 0.17, z), P(u1, 0.17, z), P(u1, spring, z), P(u0, spring, z), nIn);
        sur.quad(P(u0, 0.17, 0), P(u0, 0.17, z), P(u0, spring, z), P(u0, spring, 0), [-along[0], 0, -along[2]]);
        sur.quad(P(u1, 0.17, 0), P(u1, 0.17, z), P(u1, spring, z), P(u1, spring, 0), along);
      }
      for (let k = 0; k < SEG; k++) {
        const q0 = (Math.PI * k) / SEG;
        const q1 = (Math.PI * (k + 1)) / SEG;
        const R = (r: number, q: number, off: number) => P(cu - r * Math.cos(q), spring + r * Math.sin(q), off);
        sur.quad(R(a, q0, z), R(a, q1, z), R(a + bw, q1, z), R(a + bw, q0, z), nIn);
        const qm = (q0 + q1) / 2;
        sur.quad(R(a + bw, q0, 0), R(a + bw, q1, 0), R(a + bw, q1, z), R(a + bw, q0, z), norm3([-Math.cos(qm) * along[0], Math.sin(qm), -Math.cos(qm) * along[2]]));
      }
    }

    // skirting, broken at doors
    const skirtMat = fancy ? lib.get('wall.boiserie') : materialOr(fin?.floor, 'floor.planks') === 'floor.flags' ? lib.get('stone.grey') : lib.get('wood.door');
    const sb = acc.get(skirtMat, shellInfo('sockelleiste', `${room.name_de} – Sockelleiste`, 'N', 'N skirting'));
    for (const [a, b] of freeAlong(w.len, decorHoles, 0.02)) {
      if (b - a < 0.05) continue;
      profileStrip(sb, P, a, b, [
        [0.0, 0],
        [0.022, 0],
        [0.022, 0.13],
        [0.012, 0.16],
        [0, 0.17],
      ]);
    }
    if (fancy && clear > 2.8) {
      // chair rail
      const cr = acc.get(gilt ? lib.get('metal.gilt') : lib.get('wall.boiserie'), shellInfo('lambris', `${room.name_de} – Lambris (Boiserie)`, 'N', 'N Louis-seize dado and panels; D boiseries by Georges Jacob (research/01 §3.2)'));
      for (const [a, b] of freeAlong(w.len, decorHoles, dado - 0.03, dado + 0.03)) {
        if (b - a < 0.1) continue;
        profileStrip(cr, P, a, b, [
          [0, dado - 0.035],
          [0.02, dado - 0.02],
          [0.03, dado],
          [0.02, dado + 0.02],
          [0, dado + 0.03],
        ]);
      }
      // panels: moulding frames (gilt in state rooms, moulded so the gilding catches highlights - KB-I26), fielded
      // dado panels. Silk rooms keep the dado panels only: above the rail the silk fields take their place.
      const frameB = acc.get(gilt ? lib.get('metal.gilt') : lib.get('wall.boiserie'), shellInfo('boiserie', `${room.name_de} – Boiserie (Felder)`, 'D N', 'D Louis-Seize boiseries (Georges Jacob, 05 §e); panel layout N 02 §2.12'));
      const panelB = acc.get(lib.get('wall.boiserie'), shellInfo('boiserie-felder', `${room.name_de} – Boiserie`, 'D N', 'D Louis-Seize boiseries; layout N'));
      const canvasB = acc.get(interiorMaterial(lib, 'interior.canvas'), shellInfo('supraporte', `${room.name_de} – Supraporte (Gemälde, Platzhalter)`, 'N', 'N Supraporte: painted overdoor over the enfilade doors of state rooms (research/09 I3); the canvas is a tonal placeholder, no artwork'));
      const supra: Hole[] = [];
      // the painted overdoors, the same rule the programme's picture hang keeps clear of (finish.ts supraportePanels)
      const paintedAt = supraportePanels(w.len, decorHoles, clear, corniceH, { state: gilt, fancy });
      for (const p of boiseriePanels(w.len, decorHoles, { ...DEFAULT_BOISERIE, top: clear - corniceH })) {
        if (silk && p.kind === 'upper') continue;
        const bw = p.kind === 'dado' ? 0.035 : 0.045;
        const painted = p.kind === 'overdoor' && paintedAt.some((q) => Math.abs(q.u0 - p.u0) < 1e-6 && Math.abs(q.v0 - p.v0) < 1e-6);
        if (silk && p.kind === 'overdoor' && !painted) continue;
        if (!painted && (p.kind === 'dado' || p.kind === 'allege' || !silk)) {
          const z = p.kind === 'upper' && !silk ? 0.006 : 0.012;
          panelQuad(panelB, P, p.u0 + bw, p.v0 + bw, p.u1 - bw, p.v1 - bw, z, nIn);
        }
        if (gilt) mouldFrame(frameB, P, Nw, p.u0, p.v0, p.u1, p.v1, beadProfile(bw, 0.024));
        else frameBars(frameB, P, p.u0, p.v0, p.u1, p.v1, bw, 0.022, nIn, along);
        if (painted) {
          // dessus-de-porte (KB-I26): a varnished canvas in the gilt frame; the picture is a tonal placeholder
          canvasQuad(canvasB, P, nIn, p.u0 + bw, p.v0 + bw, p.u1 - bw, p.v1 - bw, 0.008, hashString(`${room.id}|${w.index}|${p.u0.toFixed(2)}`));
          supra.push({ u0: p.u0 - 0.02, u1: p.u1 + 0.02, v0: p.v0 - 0.02, v1: p.v1 + 0.02 });
        }
      }
      // silk walls (KB-I26): every field above the dado rail is stretched damask framed by a gilt Tapetenleiste, with
      // the broad contrasting border just inside it and a gold embroidered line along its inner edge (Mannlich's rule,
      // T1 p. 365 [D]; sizes STATE_ROOM [N])
      if (silk && hue && border) {
        const lb = acc.get(giltLeiste ? lib.get('metal.gilt') : lib.get('wall.boiserie'), shellInfo('tapetenleiste', `${room.name_de} – Tapetenleisten (vergoldet)`, 'D N', 'D Tapetenleisten by Georges Jacob (research/09 §4.1); gilt fillet 0.045 m N (I1)'));
        const bb = acc.get(damaskMaterial(lib, wallName, border, figure), shellInfo('bordure', `${room.name_de} – Bordüre (Damast)`, 'D N', 'D damask in contrasting colours with broad borders (Mannlich T1 p. 365 / T5); colour and width N'));
        const gb = acc.get(lib.get('metal.gilt'), shellInfo('bordure', `${room.name_de} – Goldstickerei der Bordüre`, 'D N', 'D gold-embroidered borders (Mannlich T1 p. 365); width N'));
        const L = STATE_ROOM.leiste;
        const B = STATE_ROOM.border;
        for (const f of silkFields(w.len, [...faceHoles, ...nicheHoles, ...supra], dado + 0.03, clear - corniceH).flatMap((x) => splitField(x))) {
          mouldFrame(lb, P, Nw, f.u0, f.v0, f.u1, f.v1, beadProfile(L.width, L.depth));
          const rs = borderRects(f, L.width + B.gap, B.width);
          for (const r of rs) panelQuad(bb, P, r.u0, r.v0, r.u1, r.v1, 0.002, nIn);
          if (rs.length) {
            const g = B.borderGold;
            const a = L.width + B.gap + B.width;
            const ix0 = f.u0 + a;
            const ix1 = f.u1 - a;
            const iy0 = f.v0 + a;
            const iy1 = f.v1 - a;
            panelQuad(gb, P, ix0 - g, iy0 - g, ix1 + g, iy0, 0.003, nIn);
            panelQuad(gb, P, ix0 - g, iy1, ix1 + g, iy1 + g, 0.003, nIn);
            panelQuad(gb, P, ix0 - g, iy0, ix0, iy1, 0.003, nIn);
            panelQuad(gb, P, ix1, iy0, ix1 + g, iy1, 0.003, nIn);
            // a second, finer gold line just inside the Leiste: the border reads as a band between two gold lines
            const o0 = L.width + B.gap + 0.025;
            const t = g * 0.6;
            panelQuad(gb, P, f.u0 + o0, f.v0 + o0, f.u1 - o0, f.v0 + o0 + t, 0.003, nIn);
            panelQuad(gb, P, f.u0 + o0, f.v1 - o0 - t, f.u1 - o0, f.v1 - o0, 0.003, nIn);
            panelQuad(gb, P, f.u0 + o0, f.v0 + o0 + t, f.u0 + o0 + t, f.v1 - o0 - t, 0.003, nIn);
            panelQuad(gb, P, f.u1 - o0 - t, f.v0 + o0 + t, f.u1 - o0, f.v1 - o0 - t, 0.003, nIn);
          }
        }
      }
    }

    // door surrounds + leaves
    for (const hit of w.hits) {
      const o = hit.opening;
      if (o.facade || !LEAF_KINDS.has(o.kind) && o.kind !== 'passage') continue;
      const h = hit.hole;
      const sur = acc.get(fancy ? (gilt ? lib.get('metal.gilt') : lib.get('wall.boiserie')) : lib.get('wood.door'), shellInfo('tuer', `${room.name_de} – Türgewände`, 'N', 'N door surround (chambranle)'));
      const bw = 0.11;
      const rise = archRise(h.head, h.u1 - h.u0);
      if (rise < 0.01) {
        if (fancy && gilt) mouldFrame(sur, P, Nw, h.u0 - bw, h.v0, h.u1 + bw, h.v1 + bw, beadProfile(bw, 0.035), true);
        else frameBars(sur, P, h.u0 - bw, h.v0, h.u1 + bw, h.v1 + bw, bw, 0.035, nIn, along, true);
      }
      if (!LEAF_KINDS.has(o.kind) || inp.leavesDone.has(o.id)) continue;
      inp.leavesDone.add(o.id);
      doorLeaves(acc.get(fancy ? lib.get('wood.door') : inp.tints.get('wood.door', '#d9d2c2'), shellInfo('tuerblatt', o.kind === 'double_door' ? 'Flügeltür' : 'Tür', 'N', o.tag)), gilt ? acc.get(lib.get('metal.gilt'), shellInfo('tuerblatt', 'Flügeltür', 'N', o.tag)) : null, w, h, o, inp.floor_h, inset);
    }
  }

  // ---- cornice -------------------------------------------------------------------------------
  const ch = inp.ceiling_h;
  if (!inp.vault && !inp.noCeiling) {
    const cb = acc.get(ceilMat, shellInfo('gesims', `${room.name_de} – Deckenkehle / Gesims`, fancy ? 'N' : 'N', 'N stucco cove (Voute) 02 §2.12'));
    const c = corniceH;
    const prof: [number, number][] = fancy
      ? [
          [0, ch - c],
          [0.03, ch - c],
          [0.035, ch - c + 0.05],
          [0.06, ch - c + 0.07],
          ...Array.from({ length: 6 }, (_, k) => {
            const a = ((k + 1) / 7) * (Math.PI / 2);
            return [0.06 + (c * 0.9 - 0.06) * (1 - Math.cos(a)), ch - c + 0.07 + (c - 0.07) * Math.sin(a)] as [number, number];
          }),
          [c * 0.95, ch],
        ]
      : [
          [0, ch - c],
          [0.02, ch - c],
          [c * 0.8, ch],
        ];
    // a partial ceiling (stair well below the floor above) gets no cornice
    if (!inp.ceilingRects) cb.profileLoop(room.polygon, prof);
    if (fancy && clear > 3) {
      const gb = acc.get(gilt ? lib.get('metal.gilt') : ceilMat, shellInfo('gesims', `${room.name_de} – Deckenkehle / Gesims`, 'N', 'N'));
      if (!inp.ceilingRects) gb.profileLoop(room.polygon, [
        [c * 0.95, ch - 0.004],
        [c * 0.95 + 0.04, ch - 0.03],
        [c * 0.95 + 0.08, ch - 0.004],
      ]);
    }
  }

  // ---- ceiling -------------------------------------------------------------------------------
  if (inp.noCeiling) return;
  const cbk = acc.get(ceilMat, shellInfo('decke', `${room.name_de} – Decke`));
  if (inp.vault) {
    groinVault(cbk, inp, walls);
  } else if (inp.ceilingRects) {
    for (const r of inp.ceilingRects) cbk.quad(O(r.s0, r.t0, ch), O(r.s1, r.t0, ch), O(r.s1, r.t1, ch), O(r.s0, r.t1, ch), [0, -1, 0]);
  } else {
    polygonFace(cbk, room.polygon, ch, [0, -1, 0]);
    if (fancy && clear > 3) {
      // stucco frame and rosette (Louis-seize sobriety: few painted ceilings)
      const [s0, s1, t0, t1] = bbox(room.polygon);
      const m = corniceH + 0.45;
      if (s1 - s0 > 2 * m + 1 && t1 - t0 > 2 * m + 1) {
        // Deckenspiegel: a moulded stucco frame (gilt bead in state rooms) on the ceiling plane [N 02 §2.12]
        const fr = acc.get(gilt ? lib.get('metal.gilt') : ceilMat, shellInfo('decke', `${room.name_de} – Deckenspiegel`, 'N', 'N stucco frame and rosette 02 §2.12'));
        const Fc = (x: number, y: number, z: number): V3 => O(x, y, ch - z);
        const Nc = (x: number, y: number, z: number): V3 => norm3([x, -z, -y]);
        mouldFrame(fr, Fc, Nc, s0 + m, t0 + m, s1 - m, t1 - m, beadProfile(0.07, 0.035));
      }
      // KB-I26 review: a rosette only where a chandelier hangs (a flat gilt disc without one read as a hole)
      for (const c of inp.rosettes ?? []) rosette(acc.get(ceilMat, shellInfo('rosette', `${room.name_de} – Deckenrosette (Stuck)`, 'N', 'N stucco ceiling rosette under the chandelier (research/09 §4.2)')), gilt ? acc.get(lib.get('metal.gilt'), shellInfo('rosette', `${room.name_de} – Deckenrosette`, 'N', 'N gilt ring of the rosette')) : null, c, ch);
    }
  }
}

function bbox(p: ST[]): [number, number, number, number] {
  return [Math.min(...p.map((x) => x[0])), Math.max(...p.map((x) => x[0])), Math.min(...p.map((x) => x[1])), Math.max(...p.map((x) => x[1]))];
}

/** Polygon face (triangulated) at height h. */
export function polygonFace(b: Bucket, poly: ST[], h: number, normal: V3): void {
  const contour = poly.map((p) => new THREE.Vector2(p[0], p[1]));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const [a, c, d] of tris) b.tri(O(poly[a][0], poly[a][1], h), O(poly[c][0], poly[c][1], h), O(poly[d][0], poly[d][1], h), normal);
}

function polygonCollider(col: ColliderBucket, poly: ST[], h: number): void {
  const contour = poly.map((p) => new THREE.Vector2(p[0], p[1]));
  for (const [a, c, d] of THREE.ShapeUtils.triangulateShape(contour, [])) col.b.tri(O(poly[a][0], poly[a][1], h), O(poly[c][0], poly[c][1], h), O(poly[d][0], poly[d][1], h), [0, 1, 0]);
}

type PFn = (u: number, v: number, off?: number) => V3;

/** Straight profile strip along a wall from u = a to b; profile [offset, v]. */
function profileStrip(b: Bucket, P: PFn, a: number, bEnd: number, prof: [number, number][]): void {
  for (let k = 0; k < prof.length - 1; k++) {
    const [oa, va] = prof[k];
    const [ob, vb] = prof[k + 1];
    const p0 = P(a, va, oa);
    const p1 = P(bEnd, va, oa);
    const p2 = P(bEnd, vb, ob);
    const p3 = P(a, vb, ob);
    // normal: in the (inward, up) plane perpendicular to the segment, pointing to the room
    const wallN = sub3(P(a, va, 1), P(a, va, 0));
    const dO = ob - oa;
    const dV = vb - va;
    const n: V3 = [wallN[0] * dV, -dO, wallN[2] * dV];
    b.quad(p0, p1, p2, p3, n);
  }
  // end caps
  const capN = sub3(P(a, 0), P(a + 1, 0));
  const capA = prof.map(([o, v]) => P(a, v, o));
  const capB = prof.map(([o, v]) => P(bEnd, v, o));
  for (let k = 1; k < prof.length - 1; k++) {
    b.tri(capA[0], capA[k], capA[k + 1], capN);
    b.tri(capB[0], capB[k], capB[k + 1], [-capN[0], -capN[1], -capN[2]]);
  }
}

const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function panelQuad(b: Bucket, P: PFn, u0: number, v0: number, u1: number, v1: number, z: number, n: V3): void {
  if (u1 - u0 < 0.02 || v1 - v0 < 0.02) return;
  b.quad(P(u0, v0, z), P(u1, v0, z), P(u1, v1, z), P(u0, v1, z), n);
}

/** Moulding frame of four bars (depth z) on the wall; `open` omits the bottom bar (doors). */
function frameBars(b: Bucket, P: PFn, u0: number, v0: number, u1: number, v1: number, bw: number, z: number, nIn: V3, along: V3, open = false): void {
  const bar = (a0: number, b0: number, a1: number, b1: number) => {
    // a small box: front face + 4 sides
    const f = [P(a0, b0, z), P(a1, b0, z), P(a1, b1, z), P(a0, b1, z)];
    b.quad(f[0], f[1], f[2], f[3], nIn);
    b.quad(P(a0, b1, 0), P(a1, b1, 0), P(a1, b1, z), P(a0, b1, z), [0, 1, 0]);
    b.quad(P(a0, b0, 0), P(a1, b0, 0), P(a1, b0, z), P(a0, b0, z), [0, -1, 0]);
    b.quad(P(a0, b0, 0), P(a0, b1, 0), P(a0, b1, z), P(a0, b0, z), [-along[0], 0, -along[2]]);
    b.quad(P(a1, b0, 0), P(a1, b1, 0), P(a1, b1, z), P(a1, b0, z), along);
  };
  bar(u0, v0, u0 + bw, v1);
  bar(u1 - bw, v0, u1, v1);
  bar(u0 + bw, v1 - bw, u1 - bw, v1);
  if (!open) bar(u0 + bw, v0, u1 - bw, v0 + bw);
}

/** Open door leaves (double: two leaves at ~95°) hinged at the jambs on this room's face. */
function doorLeaves(b: Bucket, giltB: Bucket | null, w: RoomWall, h: Hole, o: IOpening, floor_h: number, inset: number): void {
  const width = h.u1 - h.u0;
  const height = h.v1 - h.v0;
  const leaves = o.kind === 'double_door' ? 2 : 1;
  const lw = width / leaves;
  const th = 0.05;
  for (let k = 0; k < leaves; k++) {
    const hingeU = k === 0 ? h.u0 : h.u1;
    const sign = k === 0 ? 1 : -1;
    const hinge: ST = [w.p0[0] + w.d[0] * hingeU + w.nIn[0] * (inset + 0.02), w.p0[1] + w.d[1] * hingeU + w.nIn[1] * (inset + 0.02)];
    // leaf direction: from the hinge, rotated ~95° from the closed position into the room
    const ang = (95 * Math.PI) / 180;
    const cd: ST = [w.d[0] * sign, w.d[1] * sign];
    const dir: ST = [cd[0] * Math.cos(ang) + w.nIn[0] * Math.sin(ang), cd[1] * Math.cos(ang) + w.nIn[1] * Math.sin(ang)];
    const centre: ST = [hinge[0] + (dir[0] * lw) / 2, hinge[1] + (dir[1] * lw) / 2];
    // facing = leaf normal (perpendicular to dir)
    const facing: ST = [-dir[1], dir[0]];
    const m = placeMatrix(centre, floor_h + h.v0, facing);
    b.box([-lw / 2, 0.005, -th / 2], [lw / 2, height - 0.005, th / 2], m);
    // raised panels both sides (2 per leaf)
    const pb = giltB ?? b;
    for (const z of [th / 2, -th / 2 - 0.012]) {
      const ph = (height - 0.5) / 2;
      for (let j = 0; j < 2; j++) {
        const y0 = 0.2 + j * (ph + 0.1);
        pb.box([-lw / 2 + 0.1, y0, z], [lw / 2 - 0.1, y0 + ph - 0.05, z + 0.012], m);
      }
    }
  }
}

/** Groin vault over bays aligned on the window axes (lunettes over the windows). */
function groinVault(b: Bucket, inp: ShellInput, walls: RoomWall[]): void {
  const [s0, s1, t0, t1] = bbox(inp.room.polygon);
  const alongS = s1 - s0 >= t1 - t0;
  const L = alongS ? s1 - s0 : t1 - t0;
  const W = alongS ? t1 - t0 : s1 - s0;
  const a0 = alongS ? s0 : t0;
  // window centres along the long axis -> bay boundaries on the piers
  const ww = walls.filter((w) => w.windows > 0 && Math.abs(alongS ? w.d[0] : w.d[1]) > 0.9);
  const cs = [...new Set(ww.flatMap((w) => w.hits.filter((h) => h.opening.facade).map((h) => {
    const u = (h.hole.u0 + h.hole.u1) / 2;
    const p = [w.p0[0] + w.d[0] * u, w.p0[1] + w.d[1] * u];
    return Math.round((alongS ? p[0] : p[1]) * 100) / 100;
  })))].sort((x, y) => x - y);
  const cuts = [a0];
  for (let i = 0; i < cs.length - 1; i++) if (cs[i + 1] - cs[i] > 1.5) cuts.push((cs[i] + cs[i + 1]) / 2);
  cuts.push(a0 + L);
  if (cuts.length === 2) {
    const n = Math.max(1, Math.round(L / 4));
    cuts.splice(1, 0, ...Array.from({ length: n - 1 }, (_, i) => a0 + ((i + 1) * L) / n));
  }
  const crown = inp.ceiling_h;
  const rise = Math.min(W / 2 * 0.55, 2.2, crown - inp.floor_h - 2.6);
  const spring = crown - rise;
  const nx = 10;
  const ny = 10;
  for (let k = 0; k < cuts.length - 1; k++) {
    const x0 = cuts[k];
    const x1 = cuts[k + 1];
    const B = x1 - x0;
    const g = new THREE.BufferGeometry();
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= ny; j++) {
        const x = x0 + (B * i) / nx;
        const y = -W / 2 + (W * j) / ny;
        const h1 = spring + rise * Math.sqrt(Math.max(0, 1 - (y / (W / 2)) ** 2));
        const h2 = spring + rise * Math.sqrt(Math.max(0, 1 - ((x - (x0 + x1) / 2) / (B / 2)) ** 2));
        const h = Math.max(h1, h2);
        const yc = (alongS ? (t0 + t1) / 2 : (s0 + s1) / 2) + y;
        const s = alongS ? x : yc;
        const t = alongS ? yc : x;
        pos.push(s, h, -t);
      }
    }
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const a = i * (ny + 1) + j;
        const c = a + ny + 1;
        idx.push(a, a + 1, c, a + 1, c + 1, c);
      }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // make normals face down (into the room)
    const n = g.getAttribute('normal');
    let sumY = 0;
    for (let i = 0; i < n.count; i++) sumY += n.getY(i);
    if (sumY > 0) {
      for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
      const ix = g.getIndex()!;
      for (let i = 0; i < ix.count; i += 3) {
        const t = ix.getX(i + 1);
        ix.setX(i + 1, ix.getX(i + 2));
        ix.setX(i + 2, t);
      }
    }
    b.geometry(g);
  }
}

/** Canvas (KB-I26/I27): a colour grid of a varnished picture on the wall plane, `seed` picks the composition. */
export function canvasQuad(b: Bucket, P: PFn, nIn: V3, u0: number, v0: number, u1: number, v1: number, z: number, seed: number): void {
  if (u1 - u0 < 0.05 || v1 - v0 < 0.05) return;
  const g = canvasGrid(seed, u1 - u0, v1 - v0);
  const lin = (c: [number, number, number]): V3 => [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
  b.colourGrid(P(u0, v0, z), P(u1, v0, z), P(u1, v1, z), P(u0, v1, z), nIn, g.nx, g.ny, (i, j) => lin(g.colours[j * g.nx + i]));
}

/**
 * Stucco ceiling rosette (KB-I26) of radius STATE_ROOM.rosette.radius at plan point c: a lathed boss with a ring of
 * acanthus leaves; `gilt` gets a thin gilt ring at the rim (state rooms) [N].
 */
function rosette(b: Bucket, gilt: Bucket | null, c: ST, ch: number): void {
  const R = STATE_ROOM.rosette.radius;
  const prof: [number, number][] = [
    [0.001, 0.1],
    [0.05, 0.095],
    [0.08, 0.075],
    [0.1, 0.05],
    [0.15, 0.045],
    [0.2, 0.055],
    [0.26, 0.04],
    [0.33, 0.035],
    [0.38, 0.02],
    [R, 0.0],
  ].map(([r, d]) => [r * (R / 0.42), d] as [number, number]);
  const lathe = new THREE.LatheGeometry(prof.map(([r, d]) => new THREE.Vector2(r, -d)), 24);
  b.geometry(lathe, new THREE.Matrix4().makeTranslation(c[0], ch - 0.001, -c[1]));
  // acanthus leaves: flattened ellipsoids on the ring
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const leaf = new THREE.SphereGeometry(1, 6, 4);
    const m = new THREE.Matrix4()
      .makeTranslation(c[0] + Math.cos(a) * R * 0.55, ch - 0.035, -c[1] + Math.sin(a) * R * 0.55)
      .multiply(new THREE.Matrix4().makeRotationY(-a))
      .multiply(new THREE.Matrix4().makeScale(R * 0.22, 0.03, R * 0.09));
    b.geometry(leaf, m);
  }
  if (gilt) gilt.geometry(new THREE.TorusGeometry(R * 0.92, 0.012, 4, 32).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(c[0], ch - 0.012, -c[1]));
}
