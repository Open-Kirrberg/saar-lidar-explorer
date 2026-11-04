/**
 * Consistency checks of catalogue v2 (pure): room programme vs facade (no wall may meet a
 * window, every window lights a room), rooms inside the footprint and not overlapping,
 * doors inside their walls, building texts that name rooms the programme lacks (`functionIssues`), and
 * footprint overlaps between buildings.
 * Used by build.ts (fails the build) and model/tests/catalogue-v2.test.ts.
 */
import { layoutBuilding } from '../../model/src/layout/building.ts';
import { openRing, pointInPolygon, signedArea, type P2 } from '../../model/src/layout/geom.ts';
import type { Building, SiteSpec } from '../../model/src/spec.ts';
import { isPlaced } from '../../model/src/spec.ts';

const WINDOW_KINDS = new Set(['window', 'porte_fenetre', 'portal', 'durchfahrt', 'door', 'carriage_gate', 'stall_window']);
/** Clear pier between a window reveal and a meeting interior wall (m) [N]. */
export const PIER_MARGIN = 0.1;

export interface ProgrammeIssue {
  building: string;
  message: string;
}

/** Room present on a storey (rooms rising through the next storey count there too). */
function roomsOn(b: Building, storey: number, floorH: number) {
  return (b.rooms ?? []).filter((r) => r.storey === storey || (r.storey < storey && (r.ceiling_h ?? -Infinity) > floorH + 1.0));
}

export function checkProgramme(spec: SiteSpec, b: Building): ProgrammeIssue[] {
  const out: ProgrammeIssue[] = [];
  const bad = (message: string) => out.push({ building: b.id, message });
  if (!b.rooms?.length) return out;
  const lay = layoutBuilding(b, spec);
  const { length: L, width: W } = lay.frame;

  const storeys = [...new Set(b.rooms.map((r) => r.storey))];
  for (const st of storeys) {
    const own = b.rooms.filter((r) => r.storey === st);
    const pts = own.flatMap((r) => r.polygon);
    const tg = Math.min(...pts.map((p) => p[1]));
    const tc = Math.max(...pts.map((p) => p[1]));
    const sA = Math.min(...pts.map((p) => p[0]));
    const sB = Math.max(...pts.map((p) => p[0]));
    const near = (x: number, y: number) => Math.abs(x - y) < 0.02;
    const corner = (p: P2) => (near(p[0], sA) || near(p[0], sB)) && (near(p[1], tg) || near(p[1], tc));

    // rooms inside the footprint, no overlaps
    for (const r of own) {
      for (const p of r.polygon) if (Math.abs(p[0]) > L / 2 + 1e-6 || Math.abs(p[1]) > W / 2 + 1e-6) bad(`room ${r.id} outside the footprint`);
      if (signedArea(r.polygon) <= 0) bad(`room ${r.id} polygon not CCW / empty`);
    }
    for (let i = 0; i < own.length; i++)
      for (let j = i + 1; j < own.length; j++) {
        const ov = rectOverlap(own[i].polygon, own[j].polygon);
        if (ov > 0.01) bad(`rooms ${own[i].id} and ${own[j].id} overlap by ${ov.toFixed(2)} m²`);
      }

    // interior wall ends on the outer wall faces
    const ends = { garden: [] as number[], court: [] as number[], end_a: [] as number[], end_b: [] as number[] };
    for (const r of own)
      for (const p of r.polygon) {
        if (corner(p)) continue;
        if (near(p[1], tg)) ends.garden.push(p[0]);
        if (near(p[1], tc)) ends.court.push(p[0]);
        if (near(p[0], sA)) ends.end_a.push(p[1]);
        if (near(p[0], sB)) ends.end_b.push(p[1]);
      }

    const level = lay.stack.levels[st];
    const present = roomsOn(b, st, level.floor_h);
    for (const o of lay.openings) {
      if (o.storey !== st || !WINDOW_KINDS.has(o.kind)) continue;
      const sd = lay.frame.sides[o.side];
      // centre on the wall line (outer face) and its coordinate along the wall
      const x = sd.p0[0] + sd.tangent[0] * o.a;
      const y = sd.p0[1] + sd.tangent[1] * o.a;
      const along = o.side === 'garden' || o.side === 'court' ? x : y;
      for (const w of ends[o.side])
        if (Math.abs(w - along) < o.width / 2 + PIER_MARGIN) bad(`storey ${st} ${o.side} axis ${o.axis} (${o.kind} at ${along.toFixed(2)}) meets an interior wall at ${w.toFixed(2)}`);
      // the opening must light / open into a room: probe 0.3 m inside the inner face
      const inner: P2 =
        o.side === 'garden' ? [x, tg + 0.3] : o.side === 'court' ? [x, tc - 0.3] : o.side === 'end_a' ? [sA + 0.3, y] : [sB - 0.3, y];
      if (!present.some((r) => pointInPolygon(inner, r.polygon))) bad(`storey ${st} ${o.side} axis ${o.axis} (${o.kind}) opens into no room`);
    }
  }

  // interior openings inside their walls; rooms exist
  const ids = new Set(b.rooms.map((r) => r.id));
  for (const o of b.openings ?? []) {
    if (o.wall.kind === 'segment') {
      const len = Math.hypot(o.wall.p1[0] - o.wall.p0[0], o.wall.p1[1] - o.wall.p0[1]);
      if (o.a - o.width / 2 < -1e-6 || o.a + o.width / 2 > len + 1e-6) bad(`opening ${o.id} (${o.width} m) does not fit its wall (${len.toFixed(2)} m)`);
      for (const r of o.wall.rooms ?? []) if (!ids.has(r)) bad(`opening ${o.id}: unknown room ${r}`);
    } else if (o.wall.kind === 'side') {
      const sd = lay.frame.sides[o.wall.side];
      if (o.a - o.width / 2 < 0 || o.a + o.width / 2 > sd.length) bad(`passage ${o.id} outside side ${o.wall.side}`);
      // must not cut a facade window on the same storey
      for (const f of lay.openings)
        if (f.side === o.wall.side && f.storey === o.storey && Math.abs(f.a - o.a) < (f.width + o.width) / 2 + 0.1) bad(`passage ${o.id} collides with a facade opening`);
      const top = lay.stack.levels[o.storey].floor_h + o.sill + o.height;
      if (top > lay.stack.eaves_h) bad(`passage ${o.id} above the eaves`);
    }
  }
  for (const s of b.stairs ?? []) {
    if (!ids.has(s.id.replace(/^stair-/, ''))) bad(`stair ${s.id} has no stair-hall room`);
    if (s.storey_to <= s.storey_from) bad(`stair ${s.id} goes nowhere`);
  }
  out.push(...functionIssues(b));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Building texts vs rooms (fix wave 4, review of KB-I25)
// ---------------------------------------------------------------------------------------------

/**
 * Room kinds a building `function` text (English) or a storey name (German, in parentheses) may name, with the
 * room names that must then exist. Keeps the info-panel texts in step with the room programme.
 */
export const ROOM_TERMS: { term: string; en: RegExp; de: RegExp; room: RegExp }[] = [
  { term: 'silver chamber', en: /\bsilver\b|Silberkammer/i, de: /Silber/i, room: /Silber/i },
  { term: 'dining room', en: /\bdining\b|Speisesa/i, de: /Speise/i, room: /Speise/i },
  { term: 'buffet', en: /\bbuffet\b|Anrichte/i, de: /Anrichte|Buffet/i, room: /Anrichte|Buffet/i },
  { term: 'library', en: /\blibrary\b|Bibliothek/i, de: /Bibliothek/i, room: /Bibliothek/i },
  { term: 'armoury', en: /\barmou?ry\b|Waffensammlung/i, de: /Waffen/i, room: /Waffen/i },
  { term: 'natural-history cabinet', en: /natural-history|Naturalien/i, de: /Naturalien/i, room: /Naturalien/i },
  { term: 'picture room', en: /picture room|Bildersa/i, de: /Bilders[aä]/i, room: /Bildersaal/i },
  { term: 'dance hall', en: /dance hall|Tanzsaal/i, de: /Tanzsaal/i, room: /Tanzsaal/i },
  { term: 'guard room', en: /\bguard\b|Wach(t)?stube/i, de: /Wach/i, room: /Wach/i },
  { term: 'guest apartment', en: /guest apartment/i, de: /Gäste/i, room: /Gäste/i },
  { term: "cooks' lodgings", en: /cooks' lodgings|cooks' rooms/i, de: /Küchenbedienstete|Köche/i, room: /Koch|Köche/i },
];

/** Index of the n-th walkable floor storey (0 = EG, 1 = OG). */
function floorStorey(b: Building, n: number): number | undefined {
  return b.storeys.map((s, i) => [s, i] as const).filter(([s]) => s.kind === 'floor' || s.kind === undefined)[n]?.[1];
}

/**
 * Terms of the building `function` and storey names without a matching room. A clause "EG: …" / "OG: …" or a phrase
 * ending "… on the EG" / "… on the OG" binds its terms to that floor; other terms need the room on any storey.
 */
export function functionIssues(b: Building): ProgrammeIssue[] {
  const out: ProgrammeIssue[] = [];
  if (!b.rooms?.length) return out;
  const roomsAt = (storey?: number) => b.rooms!.filter((r) => storey === undefined || r.storey === storey);
  const need = (text: string, storey: number | undefined, where: string, key: 'en' | 'de') => {
    for (const t of ROOM_TERMS)
      if (t[key].test(text) && !roomsAt(storey).some((r) => t.room.test(r.name_de)))
        out.push({ building: b.id, message: `${where} names a ${t.term}${storey === undefined ? '' : ` on storey ${storey}`} but no room matches` });
  };
  // a word right before a building id names that other building ("the Bibliothekspavillon KB-B06a")
  const fn = (b.function ?? '').replace(/\S+\s+K[BL]-B\d+[a-z]?/g, '');
  const st = (m: string) => floorStorey(b, m === 'EG' ? 0 : 1);
  for (const clause of fn.split(';')) {
    const head = /^\s*(EG|OG)\s*:/.exec(clause);
    if (head) {
      need(clause, st(head[1]), `function "${head[1]}:" clause`, 'en');
      continue;
    }
    let rest = clause;
    for (const m of clause.matchAll(/([^:]*?)\bon the (EG|OG)\b/g)) {
      need(m[1], st(m[2]), `function "… on the ${m[2]}"`, 'en');
      rest = rest.replace(m[0], '');
    }
    need(rest, undefined, 'function', 'en');
  }
  b.storeys.forEach((s, i) => {
    const par = /\(([^)]*)\)/.exec(s.name)?.[1];
    if (par && (s.kind === 'floor' || s.kind === undefined)) need(par, i, `storey name "${s.name}"`, 'de');
  });
  return out;
}

function rectOverlap(a: P2[], b: P2[]): number {
  const ax = a.map((p) => p[0]);
  const ay = a.map((p) => p[1]);
  const bx = b.map((p) => p[0]);
  const by = b.map((p) => p[1]);
  const w = Math.min(Math.max(...ax), Math.max(...bx)) - Math.max(Math.min(...ax), Math.min(...bx));
  const h = Math.min(Math.max(...ay), Math.max(...by)) - Math.max(Math.min(...ay), Math.min(...by));
  return w > 0 && h > 0 ? w * h : 0;
}

// ---------------------------------------------------------------------------------------------
// Footprint overlaps (convex rings; Sutherland-Hodgman)
// ---------------------------------------------------------------------------------------------

function clip(subject: P2[], clipper: P2[]): P2[] {
  let out = subject;
  for (let i = 0; i < clipper.length; i++) {
    const a = clipper[i];
    const b = clipper[(i + 1) % clipper.length];
    const inside = (p: P2) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-9;
    const inter = (p: P2, q: P2): P2 => {
      const a1 = b[1] - a[1];
      const b1 = a[0] - b[0];
      const c1 = a1 * a[0] + b1 * a[1];
      const a2 = q[1] - p[1];
      const b2 = p[0] - q[0];
      const c2 = a2 * p[0] + b2 * p[1];
      const d = a1 * b2 - a2 * b1;
      return [(c1 * b2 - c2 * b1) / d, (a1 * c2 - a2 * c1) / d];
    };
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      if (inside(q)) {
        if (!inside(p)) out.push(inter(p, q));
        out.push(q);
      } else if (inside(p)) out.push(inter(p, q));
    }
    if (!out.length) break;
  }
  return out;
}

function isConvex(pts: P2[]): boolean {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const c = pts[(i + 2) % pts.length];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(z);
    else if (Math.sign(z) !== sign) return false;
  }
  return true;
}

export interface Overlap {
  a: string;
  b: string;
  area: number;
}

/** Intended overlaps: an annex drawn as its own volume that reaches into its main building (KB-I32 apse). */
export const ATTACHED: readonly (readonly [string, string])[] = [['KB-B28', 'KB-B28a']];

/** Pairwise footprint overlaps of placed buildings (walls, gardens and envelopes excluded). */
export function footprintOverlaps(spec: SiteSpec, minArea = 0.5): Overlap[] {
  const items = spec.buildings
    .filter((b) => isPlaced(b) && b.footprint && !['GARD', 'WALL', 'FARM_GROUP'].includes(b.cls))
    .map((b) => {
      const pts = openRing(b.footprint!);
      const ref = pts[0];
      const rel = pts.map((p) => [p[0] - ref[0], p[1] - ref[1]] as P2);
      return { id: b.id, ref, rel, convex: isConvex(rel) };
    });
  const out: Overlap[] = [];
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const A = items[i];
      const B = items[j];
      if (!A.convex || !B.convex) continue;
      if (ATTACHED.some(([x, y]) => (x === A.id && y === B.id) || (x === B.id && y === A.id))) continue;
      const dx = B.ref[0] - A.ref[0];
      const dy = B.ref[1] - A.ref[1];
      if (Math.hypot(dx, dy) > 400) continue;
      const bRel = B.rel.map((p) => [p[0] + dx, p[1] + dy] as P2);
      const c = clip(A.rel, bRel);
      const area = c.length >= 3 ? Math.abs(signedArea(c)) : 0;
      if (area > minArea) out.push({ a: A.id, b: B.id, area: Math.round(area * 10) / 10 });
    }
  return out;
}
