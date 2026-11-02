/**
 * Room shell: floor, ceiling (flat with a cove cornice, or groin vault), walls with the holes
 * of every opening on the edge (facade windows from the shared layout, catalogue doors),
 * reveals, arched heads, skirting, chair rail, Louis-seize boiserie panels, door surrounds and
 * open door leaves - plus the walk colliders (floor + walls with doorways open).
 */
import * as THREE from 'three';
import { MATERIAL_NAMES, type MaterialLibrary, type MaterialName } from '../context.ts';
import type { Room, ST } from '../spec.ts';
import { type Accumulator, type Bucket, type ColliderBucket, O, type PartInfo, type V3, placeMatrix } from './mesh.ts';
import type { Tints } from './materials.ts';
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
  const wallMat = lib.get(wallName);
  const dadoMat = lib.get('wall.boiserie');
  // the cornice must clear every opening head below the ceiling
  let maxHoleTop = 0;
  for (const w of walls) for (const h of w.holes) if (h.v1 < clear - 0.02) maxHoleTop = Math.max(maxHoleTop, h.v1);
  const corniceH = inp.vault ? 0 : Math.max(0.08, Math.min(fancy ? Math.min(0.75, clear * 0.12) : 0.16, clear - maxHoleTop - 0.04));

  for (const w of walls) {
    const ext = w.exterior;
    const inset = ext ? FACADE_INSET : 0;
    // facade holes are narrowed 1 cm so the interior reveal sits inside the exterior's one
    const holes: Hole[] = w.hits.map((h) => (h.opening.facade ? { ...h.hole, u0: h.hole.u0 + 0.01, u1: h.hole.u1 - 0.01, v0: h.hole.v0 + (h.hole.v0 > 0.05 ? 0.01 : 0), v1: h.hole.v1 - 0.01 } : h.hole));
    // splayed facade reveals (ébrasement): the wall face opens `splay` m wider per side than the window
    const faceHoles: Hole[] = holes.map((h) => (h.splay ? { ...h, u0: Math.max(0, h.u0 - h.splay), u1: Math.min(w.len, h.u1 + h.splay) } : h));
    const P = (u: number, v: number, off = 0): V3 => {
      const s = w.p0[0] + w.d[0] * u + w.nIn[0] * (inset + off);
      const t = w.p0[1] + w.d[1] * u + w.nIn[1] * (inset + off);
      return O(s, t, inp.floor_h + v);
    };
    const nIn: V3 = [w.nIn[0], 0, -w.nIn[1]];
    const along: V3 = [w.d[0], 0, -w.d[1]];
    const wb = acc.get(wallMat, shellInfo('wand', `${room.name_de} – Wand`));
    const db = silk ? acc.get(dadoMat, shellInfo('lambris', `${room.name_de} – Lambris (Boiserie)`)) : wb;
    // wall face (silk rooms: boiserie dado below the chair rail)
    for (const r of solidRects(w.len, H, faceHoles)) {
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

    // skirting, broken at doors
    const skirtMat = fancy ? lib.get('wall.boiserie') : materialOr(fin?.floor, 'floor.planks') === 'floor.flags' ? lib.get('stone.grey') : lib.get('wood.door');
    const sb = acc.get(skirtMat, shellInfo('sockelleiste', `${room.name_de} – Sockelleiste`, 'N', 'N skirting'));
    for (const [a, b] of freeAlong(w.len, holes, 0.02)) {
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
      for (const [a, b] of freeAlong(w.len, holes, dado - 0.03, dado + 0.03)) {
        if (b - a < 0.1) continue;
        profileStrip(cr, P, a, b, [
          [0, dado - 0.035],
          [0.02, dado - 0.02],
          [0.03, dado],
          [0.02, dado + 0.02],
          [0, dado + 0.03],
        ]);
      }
      // panels: moulding frames (gilt in state rooms), fielded dado panels
      const frameB = acc.get(gilt ? lib.get('metal.gilt') : lib.get('wall.boiserie'), shellInfo('boiserie', `${room.name_de} – Boiserie (Felder)`, 'D N', 'D Louis-Seize boiseries (Georges Jacob, 05 §e); panel layout N 02 §2.12'));
      const panelB = acc.get(lib.get('wall.boiserie'), shellInfo('boiserie-felder', `${room.name_de} – Boiserie`, 'D N', 'D Louis-Seize boiseries; layout N'));
      for (const p of boiseriePanels(w.len, holes, { ...DEFAULT_BOISERIE, top: clear - corniceH })) {
        const bw = p.kind === 'dado' ? 0.035 : 0.045;
        if (p.kind === 'dado' || p.kind === 'allege' || !silk) {
          const z = p.kind === 'upper' && !silk ? 0.006 : 0.012;
          panelQuad(panelB, P, p.u0 + bw, p.v0 + bw, p.u1 - bw, p.v1 - bw, z, nIn);
        }
        frameBars(frameB, P, p.u0, p.v0, p.u1, p.v1, bw, 0.022, nIn, along);
        if (p.kind === 'overdoor' && gilt) {
          // dessus-de-porte: plain colour field, no artwork
          const pb = acc.get(inp.tints.get('ceiling.stucco', '#8b7a62'), shellInfo('supraporte', `${room.name_de} – Supraporte (Farbfeld)`, 'N', 'N Supraporte (02 §2.4); plain colour placeholder'));
          panelQuad(pb, P, p.u0 + bw + 0.04, p.v0 + bw + 0.04, p.u1 - bw - 0.04, p.v1 - bw - 0.04, 0.016, nIn);
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
        frameBars(sur, P, h.u0 - bw, h.v0, h.u1 + bw, h.v1 + bw, bw, 0.035, nIn, along, true);
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
        const fr = acc.get(gilt ? lib.get('metal.gilt') : ceilMat, shellInfo('decke', `${room.name_de} – Deckenspiegel`, 'N', 'N stucco frame and rosette 02 §2.12'));
        const y = ch - 0.03;
        const bars: [number, number, number, number][] = [
          [s0 + m, s1 - m, t0 + m, t0 + m + 0.06],
          [s0 + m, s1 - m, t1 - m - 0.06, t1 - m],
          [s0 + m, s0 + m + 0.06, t0 + m, t1 - m],
          [s1 - m - 0.06, s1 - m, t0 + m, t1 - m],
        ];
        for (const [a, b, c, d] of bars) fr.box([a, y, -d], [b, ch, -c], undefined, ['+y']);
        const ro = new THREE.CylinderGeometry(0.45, 0.6, 0.06, 20);
        fr.geometry(ro, new THREE.Matrix4().makeTranslation((s0 + s1) / 2, ch - 0.03, -(t0 + t1) / 2));
      }
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
