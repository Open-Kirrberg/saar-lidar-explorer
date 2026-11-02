/**
 * Furnishing programme of a room (pure, no three.js): what stands where.
 *
 * The room types and their contents follow research/02 §2.11-2.12 (Louis-seize period norms,
 * tag N) and research/05 §e (Karlsberg room programme, tags I/D). Placements are in building
 * [s, t] with a `facing` unit vector (the direction the front of the piece looks). Furniture
 * stands against solid wall spans only, never in a door's approach zone and never in front of a
 * window (except low pieces under a sill), as was period practice (chairs lined along the walls).
 *
 * Everything here is a hypothesis: furnishing carries evidence 'N' (period norm) or 'I'
 * (inferred); only the type of the lit à la romaine is documented (D, research/01 §3.1).
 */
import type { Room, ST } from '../spec.ts';
import { type EdgeHit, type IOpening, WALK_KINDS, holesForEdge, roomEdges } from './openings.ts';
import { type Hole, freeAlong } from './wall.ts';

export type RoomType =
  | 'vestibule'
  | 'stairhall'
  | 'gardesaal'
  | 'festsaal'
  | 'antichambre'
  | 'audience'
  | 'statebed'
  | 'bedroom'
  | 'cabinet'
  | 'salon'
  | 'dining'
  | 'library'
  | 'collection'
  | 'physics'
  | 'prints'
  | 'armoury'
  | 'gallery'
  | 'kitchen'
  | 'bakery'
  | 'scullery'
  | 'orangery'
  | 'garderobe'
  | 'corridor'
  | 'durchfahrt'
  | 'cellar'
  | 'chamber'
  | 'office'
  | 'guard'
  | 'silver'
  | 'pantry'
  | 'workshop'
  | 'hall';

export type Grade = 'state' | 'private' | 'service';

const RULES: [RegExp, RoomType][] = [
  [/vestib/i, 'vestibule'],
  [/treppe|stiege/i, 'stairhall'],
  [/gardesaal|vorsaal/i, 'gardesaal'],
  [/festsaal|kopfsalon/i, 'festsaal'],
  [/paradeschlaf/i, 'statebed'],
  [/schlafzimmer/i, 'bedroom'],
  [/audienz/i, 'audience'],
  [/antichambre|wartezimmer/i, 'antichambre'],
  [/speisesaal/i, 'dining'],
  [/bibliothek/i, 'library'],
  [/naturalien/i, 'collection'],
  [/physik/i, 'physics'],
  [/kupferstich/i, 'prints'],
  [/waffen/i, 'armoury'],
  [/galerie|bildergalerie/i, 'gallery'],
  [/hofkueche|hofküche/i, 'kitchen'],
  [/baeckerei|bäckerei|konditorei/i, 'bakery'],
  [/spuelkueche|spülküche/i, 'scullery'],
  [/pfeilersaal|orangerie/i, 'orangery'],
  [/kabinett|wintergarten|tempel/i, 'cabinet'],
  [/salon/i, 'salon'],
  [/garderobe|alkoven/i, 'garderobe'],
  [/korridor|durchgang/i, 'corridor'],
  [/durchfahrt/i, 'durchfahrt'],
  [/keller|sommellerie/i, 'cellar'],
  [/silber/i, 'silver'],
  [/anrichte|buffet/i, 'pantry'],
  [/büchsenmacher|buechsenmacher|werkstatt/i, 'workshop'],
  [/wach/i, 'guard'],
  [/kanzlei|registratur|schreiber|offizier/i, 'office'],
  [/kammer|diener|gesinde|kavalier|mundkoch|logis|gärtner|gaertner/i, 'chamber'],
];

/** Room type from id + German name (first matching rule; 'hall' for the rest). */
export function classifyRoom(r: Pick<Room, 'id' | 'name_de'>): RoomType {
  const text = `${r.id} ${r.name_de}`;
  // the Kabinett of a picture gallery is a picture room
  if (/galerie/i.test(r.id) && /kabinett/i.test(r.name_de)) return 'gallery';
  if (/vorraum/i.test(text)) return 'antichambre';
  for (const [re, t] of RULES) if (re.test(text)) return t;
  return 'hall';
}

export function gradeOf(t: RoomType, r?: Pick<Room, 'finish'>): Grade {
  if (['vestibule', 'gardesaal', 'festsaal', 'antichambre', 'audience', 'statebed', 'dining', 'gallery', 'library', 'orangery'].includes(t)) return 'state';
  if (['bedroom', 'cabinet', 'salon', 'collection', 'physics', 'prints'].includes(t)) return 'private';
  if (t === 'stairhall' && r?.finish?.floor === 'floor.flags') return 'state';
  if (t === 'chamber' && r?.finish?.walls === 'wall.boiserie') return 'private';
  return 'service';
}

// ---------------------------------------------------------------------------------------------
// Room walls
// ---------------------------------------------------------------------------------------------

export interface RoomWall {
  index: number;
  p0: ST;
  p1: ST;
  len: number;
  /** Unit along the wall and inward normal. */
  d: ST;
  nIn: ST;
  hits: EdgeHit[];
  holes: Hole[];
  /** Number of facade windows / portes-fenêtres in the wall. */
  windows: number;
  /** Outer wall (lies on the building's outer wall zone). */
  exterior: boolean;
}

export function roomWalls(room: Pick<Room, 'polygon'>, floor_h: number, top_h: number, openings: IOpening[], dims?: { L: number; W: number }): RoomWall[] {
  return roomEdges(room).map(([p0, p1], index) => {
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const d: ST = [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len];
    const hits = holesForEdge({ p0, p1, floor_h, top_h }, openings);
    const windows = hits.filter((h) => h.opening.facade && !WALK_KINDS.has(h.opening.kind)).length + hits.filter((h) => h.opening.kind === 'porte_fenetre').length;
    const mid: ST = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
    const exterior = hits.some((h) => h.opening.facade) || (!!dims && (Math.abs(Math.abs(mid[0]) - dims.L / 2) < 1.6 || Math.abs(Math.abs(mid[1]) - dims.W / 2) < 1.6));
    // furniture sees the splayed (room-face) width of facade reveals
    const holes = hits.map((h) => (h.hole.splay ? { ...h.hole, u0: Math.max(0, h.hole.u0 - h.hole.splay), u1: Math.min(len, h.hole.u1 + h.hole.splay) } : h.hole));
    return { index, p0, p1, len, d, nIn: [-d[1], d[0]], hits, holes, windows, exterior };
  });
}

/** The wall with the most windows (null if none). */
export function windowWall(walls: RoomWall[]): RoomWall | null {
  const w = walls.filter((x) => x.windows > 0).sort((a, b) => b.windows - a.windows || b.len - a.len)[0];
  return w ?? null;
}

/** The wall facing a given wall (parallel, farthest away). */
export function oppositeWall(walls: RoomWall[], w: RoomWall): RoomWall | null {
  let best: RoomWall | null = null;
  let bestD = -1;
  for (const x of walls) {
    if (x === w || Math.abs(x.d[0] * w.d[1] - x.d[1] * w.d[0]) > 0.02) continue;
    const dist = Math.abs((x.p0[0] - w.p0[0]) * w.nIn[0] + (x.p0[1] - w.p0[1]) * w.nIn[1]);
    if (dist > bestD) {
      bestD = dist;
      best = x;
    }
  }
  return best;
}

/** Free spans of a wall for furniture of height `h` (no hole in [0, h]), shrunk by `clear`. */
export function furnitureSpans(w: RoomWall, h: number, clear = 0.35): [number, number][] {
  const holes = w.holes.map((x) => ({ ...x, u0: x.u0 - clear, u1: x.u1 + clear }));
  return freeAlong(w.len, holes, 0.02, h)
    .map(([a, b]) => [Math.max(a, 0.3), Math.min(b, w.len - 0.3)] as [number, number])
    .filter(([a, b]) => b - a > 0.3);
}

export function wallPoint(w: RoomWall, u: number, inset: number): ST {
  return [w.p0[0] + w.d[0] * u + w.nIn[0] * inset, w.p0[1] + w.d[1] * u + w.nIn[1] * inset];
}

// ---------------------------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------------------------

/** Instanced pieces (one prototype each). */
export type InstancedKind = 'fauteuil' | 'chaise' | 'tabouret' | 'canape' | 'console' | 'chandelier' | 'lantern' | 'bench' | 'orange_tub' | 'gueridon' | 'globe' | 'stool';

/** Sized, merged pieces (geometry built per item). */
export type SizedKind =
  | 'fireplace'
  | 'stove'
  | 'trumeau'
  | 'pier_glass'
  | 'bed_romaine'
  | 'bed'
  | 'alcove'
  | 'dais'
  | 'baldachin'
  | 'desk'
  | 'table'
  | 'bookcase'
  | 'vitrine'
  | 'chest'
  | 'weapon_rack'
  | 'picture'
  | 'hearth'
  | 'potager'
  | 'oven'
  | 'shelf'
  | 'wardrobe'
  | 'column'
  | 'instrument';

export type ItemKind = InstancedKind | SizedKind;

export interface Item {
  kind: ItemKind;
  /** Floor position of the piece's centre (wall pieces: centre of the back face line + depth/2). */
  pos: ST;
  /** Unit vector the front faces. */
  facing: ST;
  /** [width along the wall, depth, height] for sized pieces. */
  size?: [number, number, number];
  /** Height above the room floor of the piece's base (hung pieces: bottom). */
  z?: number;
  /** Colour hint (pictures, upholstery). */
  colour?: string;
  name_de: string;
  evidence: 'D' | 'I' | 'N';
  tag: string;
}

export const INSTANCED_KINDS: ReadonlySet<ItemKind> = new Set<ItemKind>(['fauteuil', 'chaise', 'tabouret', 'canape', 'console', 'chandelier', 'lantern', 'bench', 'orange_tub', 'gueridon', 'globe', 'stool']);

/** Footprint depth of the instanced pieces (for wall placement and door checks). */
const DEPTH: Partial<Record<ItemKind, [number, number]>> = {
  fauteuil: [0.66, 0.62],
  chaise: [0.5, 0.52],
  canape: [1.9, 0.75],
  console: [1.2, 0.5],
  bench: [1.6, 0.5],
  tabouret: [0.5, 0.42],
  orange_tub: [0.9, 0.9],
  gueridon: [0.7, 0.7],
  globe: [0.7, 0.7],
  stool: [0.4, 0.4],
};

/** Plan footprint of a floor item as [s0, s1, t0, t1] (approximate, axis-aligned). */
export function itemFootprint(it: Item): [number, number, number, number] | null {
  if (it.kind === 'chandelier' || it.kind === 'lantern' || it.kind === 'picture' || it.kind === 'pier_glass' || it.kind === 'trumeau' || it.kind === 'baldachin') return null;
  const wd = it.size ? [it.size[0], it.size[1]] : DEPTH[it.kind];
  if (!wd) return null;
  const [w, d] = wd;
  const a = Math.abs(it.facing[0]);
  // facing ~ along s: depth along s; width along t
  const ext: [number, number] = a > 0.7 ? [d / 2, w / 2] : [w / 2, d / 2];
  return [it.pos[0] - ext[0], it.pos[0] + ext[0], it.pos[1] - ext[1], it.pos[1] + ext[1]];
}

/** Approach zone (1.0 m deep, door width + 0.3) in front of every walk opening of the room. */
export function doorZones(walls: RoomWall[]): [number, number, number, number][] {
  const zones: [number, number, number, number][] = [];
  for (const w of walls) {
    for (const h of w.hits) {
      if (!WALK_KINDS.has(h.opening.kind) && h.opening.kind !== 'porte_fenetre') continue;
      if (h.hole.v0 > 0.4) continue;
      const pts = [wallPoint(w, h.hole.u0 - 0.15, 0), wallPoint(w, h.hole.u1 + 0.15, 0), wallPoint(w, h.hole.u0 - 0.15, 1.0), wallPoint(w, h.hole.u1 + 0.15, 1.0)];
      zones.push([Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))]);
    }
  }
  return zones;
}

const overlap = (a: [number, number, number, number], b: [number, number, number, number]) => a[0] < b[1] && b[0] < a[1] && a[2] < b[3] && b[2] < a[3];

/** True when a floor item stands in a door approach zone. */
export function blocksDoor(it: Item, zones: [number, number, number, number][]): boolean {
  const f = itemFootprint(it);
  return !!f && zones.some((z) => overlap(f, z));
}

// ---------------------------------------------------------------------------------------------
// Programme
// ---------------------------------------------------------------------------------------------

export interface ProgrammeInput {
  room: Room;
  type: RoomType;
  grade: Grade;
  walls: RoomWall[];
  floor_h: number;
  ceiling_h: number;
  /** Silk / upholstery colour of the room. */
  colour: string;
  /** Deterministic random in [0, 1). */
  rnd: () => number;
  /** Rect of a stair in the room (keep free). */
  keepOut?: [number, number, number, number][];
}

const N_TAG = 'N furnishing (research/02 §2.12, period norm); placement I';
const PICTURE_COLOURS = ['#6b4f3a', '#3f4a3c', '#7a5c3e', '#4b3f52', '#8a6a48', '#384856', '#5e3b33', '#6d6142'];

function bbox(r: Room): [number, number, number, number] {
  const ss = r.polygon.map((p) => p[0]);
  const ts = r.polygon.map((p) => p[1]);
  return [Math.min(...ss), Math.max(...ss), Math.min(...ts), Math.max(...ts)];
}

/** Items along a wall span, evenly spaced. */
function alongSpan(w: RoomWall, a: number, b: number, kind: ItemKind, width: number, gap: number, max: number, base: Omit<Item, 'kind' | 'pos' | 'facing'>, depth: number): Item[] {
  const n = Math.min(max, Math.floor((b - a + gap) / (width + gap)));
  if (n <= 0) return [];
  const used = n * width + (n - 1) * gap;
  const start = (a + b) / 2 - used / 2 + width / 2;
  return Array.from({ length: n }, (_, i) => ({ ...base, kind, pos: wallPoint(w, start + i * (width + gap), depth / 2 + 0.05), facing: w.nIn }));
}

function longestSpan(walls: RoomWall[], h: number, filter: (w: RoomWall) => boolean, clear = 0.35): { w: RoomWall; a: number; b: number } | null {
  let best: { w: RoomWall; a: number; b: number } | null = null;
  for (const w of walls) {
    if (!filter(w)) continue;
    for (const [a, b] of furnitureSpans(w, h, clear)) if (!best || b - a > best.b - best.a) best = { w, a, b };
  }
  return best;
}

/** The programme of one room (deterministic). */
export function furnishRoom(inp: ProgrammeInput): Item[] {
  const { room, type, grade, walls } = inp;
  const items: Item[] = [];
  const [s0, s1, t0, t1] = bbox(room);
  const centre: ST = [(s0 + s1) / 2, (t0 + t1) / 2];
  const clearH = inp.ceiling_h - inp.floor_h;
  const ww = windowWall(walls);
  const back = ww ? oppositeWall(walls, ww) : null;
  const longAxisS = s1 - s0 >= t1 - t0;
  const base = (name_de: string, evidence: Item['evidence'] = 'N', tag = N_TAG) => ({ name_de, evidence, tag });
  const reserved: [number, number, number, number][] = [...(inp.keepOut ?? [])];
  const push = (it: Item) => {
    items.push(it);
    const f = itemFootprint(it);
    if (f) reserved.push(f);
  };
  /** Free spans of a wall, also cut where a piece already stands within 1 m of the wall. */
  const free = (w: RoomWall, h: number, clear = 0.35) =>
    furnitureSpans(w, h, clear).flatMap(([a, b]) => {
      let parts: [number, number][] = [[a, b]];
      for (const r of reserved) {
        const corners: ST[] = [
          [r[0], r[2]],
          [r[1], r[2]],
          [r[0], r[3]],
          [r[1], r[3]],
        ];
        const dist = Math.min(...corners.map(([s, t]) => (s - w.p0[0]) * w.nIn[0] + (t - w.p0[1]) * w.nIn[1]));
        if (dist > 1.0) continue;
        const us = corners.map(([s, t]) => (s - w.p0[0]) * w.d[0] + (t - w.p0[1]) * w.d[1]);
        const c0 = Math.min(...us) - 0.25;
        const c1 = Math.max(...us) + 0.25;
        parts = parts.flatMap(([x0, x1]): [number, number][] => (c1 <= x0 || c0 >= x1 ? [[x0, x1]] : ([[x0, c0], [c1, x1]] as [number, number][]).filter(([p, q]) => q - p > 0.4)));
      }
      return parts;
    });

  const isState = grade === 'state';
  const hasFire = ['festsaal', 'salon', 'audience', 'statebed', 'bedroom', 'cabinet', 'dining', 'library', 'antichambre', 'gardesaal'].includes(type) || (type === 'chamber' && grade === 'private');

  // ---- fireplace (or stove) on the best solid interior wall, mirror (trumeau) above ----------
  let fireWall: RoomWall | null = null;
  if (hasFire && clearH > 3) {
    const stove = type === 'antichambre' || type === 'gardesaal';
    const span = longestSpan(walls, 1.3, (w) => w.windows === 0 && w !== back && w.len > 2.5, 0.4) ?? longestSpan(walls, 1.3, (w) => w.windows === 0 && w.len > 2.5, 0.4);
    if (span && span.b - span.a >= 2.0) {
      fireWall = span.w;
      // centre of the wall if free, else centre of the span
      const mid = span.w.len / 2;
      const u = mid - 1.0 >= span.a && mid + 1.0 <= span.b ? mid : (span.a + span.b) / 2;
      if (stove) {
        push({ kind: 'stove', pos: wallPoint(span.w, u, 0.4), facing: span.w.nIn, size: [1.0, 0.75, Math.min(2.8, clearH - 0.6)], ...base('Kachelofen (Fayence, weiß)', 'N', 'N 02 §2.12 Kachelofen in antechambers, stoked from the corridor') });
      } else {
        const w = isState ? 1.75 : 1.45;
        push({ kind: 'fireplace', pos: wallPoint(span.w, u, 0.22), facing: span.w.nIn, size: [w, 0.42, 1.12], ...base('Kamin (Marmor, cheminée à la française)', 'N', 'N 02 §2.12 marble chimneypiece, opening 1.2 x 0.95, mantel 1.1 m') });
        const top = Math.min(clearH - 0.45, 1.12 + 2.6);
        if (top - 1.2 > 0.8) push({ kind: 'trumeau', pos: wallPoint(span.w, u, 0.03), facing: span.w.nIn, size: [w * 0.9, 0.06, top - 1.2], z: 1.2, ...base('Trumeau (Spiegel über dem Kamin)', 'N', 'N 02 §2.12 mirror (trumeau) above the chimneypiece; D gilding and mirrors (Knigge)') });
      }
    }
  }

  // ---- pier glasses + consoles between the windows (state / private) -------------------------
  if ((isState || grade === 'private') && ww && type !== 'gallery' && type !== 'library' && type !== 'orangery' && type !== 'stairhall' && type !== 'vestibule') {
    const piers = freeAlong(ww.len, ww.holes, 0.9, 3.0).filter(([a, b]) => b - a >= 0.8 && a > 0.05 && b < ww.len - 0.05);
    for (const [a, b] of piers) {
      const w = Math.min(1.1, b - a - 0.25);
      const u = (a + b) / 2;
      const glassTop = Math.min(clearH - 0.5, 3.9);
      push({ kind: 'console', pos: wallPoint(ww, u, 0.27), facing: ww.nIn, ...base('Konsoltisch (vergoldet, Marmorplatte)') });
      if (glassTop - 1.0 > 1.0) push({ kind: 'pier_glass', pos: wallPoint(ww, u, 0.03), facing: ww.nIn, size: [w, 0.05, glassTop - 1.0], z: 1.0, ...base('Pfeilerspiegel', 'N', 'N 02 §2.12 pier-glasses between windows; D mirrors (Knigge)') });
    }
  }

  // ---- room-specific pieces --------------------------------------------------------------------
  const chandelier = (pos: ST, scale = 1) => push({ kind: 'chandelier', pos, facing: [0, 1], z: Math.max(2.6, clearH - 0.55 - 1.1 * scale), size: [scale, scale, scale], ...base('Kronleuchter (Bergkristall, vergoldet)', 'N', 'N 02 §2.12 crystal chandeliers; D chandeliers (Knigge)') });

  switch (type) {
    case 'vestibule': {
      // four pairs of columns in two rows, architraves on top (05 §e.1)
      const rows = longAxisS ? [t0 + (t1 - t0) * 0.3, t0 + (t1 - t0) * 0.7] : [s0 + (s1 - s0) * 0.3, s0 + (s1 - s0) * 0.7];
      const lenA = longAxisS ? s1 - s0 : t1 - t0;
      const a0 = longAxisS ? s0 : t0;
      const pairs = [a0 + lenA * 0.25, a0 + lenA * 0.75];
      for (const r of rows) {
        for (const p of pairs) {
          for (const k of [-0.42, 0.42]) {
            const pos: ST = longAxisS ? [p + k, r] : [r, p + k];
            push({ kind: 'column', pos, facing: [0, 1], size: [0.62, 0.62, clearH], ...base('Säule (toskanisch, Sandstein)', 'I', 'I 05 §e.1 four pairs of columns; order and size N') });
          }
        }
      }
      for (const w of walls) {
        if (w.windows > 0) continue;
        for (const [a, b] of free(w, 1.0)) items.push(...alongSpan(w, a, b, 'bench', 1.6, 0.8, 2, base('Banquette (gepolsterte Bank)'), 0.5));
      }
      push({ kind: 'lantern', pos: centre, facing: [0, 1], z: clearH - 1.6, size: [1, 1, 1], ...base('Laterne (Vestibül)', 'N', 'N hall lantern') });
      break;
    }
    case 'stairhall': {
      if (grade === 'state' || (s1 - s0) * (t1 - t0) > 150) push({ kind: 'lantern', pos: centre, facing: [0, 1], z: Math.max(clearH - 2.6, 5.5), size: [1.5, 1.5, 1.5], ...base('Treppenhauslaterne', 'N', 'N lantern of the stair hall') });
      break;
    }
    case 'gardesaal':
    case 'antichambre': {
      chandelier(centre, type === 'gardesaal' ? 1.2 : 1);
      for (const w of walls) {
        if (w === ww) continue;
        for (const [a, b] of free(w, 1.0)) items.push(...alongSpan(w, a, b, type === 'gardesaal' ? 'bench' : 'chaise', type === 'gardesaal' ? 1.6 : 0.5, type === 'gardesaal' ? 0.6 : 0.35, 4, base(type === 'gardesaal' ? 'Banquette' : 'Stuhl (chaise à la reine)'), 0.55));
      }
      break;
    }
    case 'festsaal':
    case 'salon': {
      const big = Math.max(s1 - s0, t1 - t0) > 10;
      if (big) {
        const off = (Math.max(s1 - s0, t1 - t0) / 4) * 1;
        chandelier(longAxisS ? [centre[0] - off, centre[1]] : [centre[0], centre[1] - off], 1.3);
        chandelier(longAxisS ? [centre[0] + off, centre[1]] : [centre[0], centre[1] + off], 1.3);
      } else chandelier(centre, type === 'festsaal' ? 1.35 : 1.1);
      const opp = fireWall ? oppositeWall(walls, fireWall) : back;
      if (opp) {
        const sp = free(opp, 1.0).sort((x, y) => y[1] - y[0] - (x[1] - x[0]))[0];
        if (sp && sp[1] - sp[0] > 2.4) push({ kind: 'canape', pos: wallPoint(opp, (sp[0] + sp[1]) / 2, 0.45), facing: opp.nIn, ...base('Kanapee (Georges Jacob-Typ)', 'N', 'N; D seating by Georges Jacob (research/01 §3.2), form N') });
      }
      for (const w of walls) {
        if (w === ww) continue;
        for (const [a, b] of free(w, 1.0)) items.push(...alongSpan(w, a, b, 'fauteuil', 0.66, 0.5, 6, base('Fauteuil à la reine (vergoldet)', 'N', 'N; D carved and gilded seating by Georges Jacob'), 0.62));
      }
      if (!big) push({ kind: 'gueridon', pos: centre, facing: [0, 1], ...base('Guéridon') });
      break;
    }
    case 'audience': {
      chandelier(centre, 1.1);
      const span = (back && free(back, 3.0).find(([a, b]) => b - a > 2.4 && (a + b) / 2 > 1)) ? back : null;
      const wall = span ?? longestSpan(walls, 3, (w) => w.windows === 0 && w !== fireWall)?.w ?? null;
      if (wall) {
        const sp = free(wall, 3.0).sort((x, y) => y[1] - y[0] - (x[1] - x[0]))[0];
        if (sp && sp[1] - sp[0] > 2.0) {
          const u = (sp[0] + sp[1]) / 2;
          push({ kind: 'dais', pos: wallPoint(wall, u, 0.9), facing: wall.nIn, size: [2.4, 1.8, 0.2], ...base('Estrade (Thronpodest)', 'N', 'N audience chamber dais and canopy (Paradeappartement norm)') });
          push({ kind: 'baldachin', pos: wallPoint(wall, u, 0.05), facing: wall.nIn, size: [2.4, 1.2, 0.5], z: Math.min(clearH - 0.6, 3.6), ...base('Thronbaldachin', 'N', 'N canopy of state') });
          push({ kind: 'fauteuil', pos: wallPoint(wall, u, 0.7), facing: wall.nIn, z: 0.2, ...base('Thronsessel', 'N', 'N armchair of state') });
        }
      }
      for (const w of walls) {
        if (w === ww || w === wall) continue;
        for (const [a, b] of free(w, 1.0)) items.push(...alongSpan(w, a, b, 'fauteuil', 0.66, 0.6, 3, base('Fauteuil à la reine'), 0.62));
      }
      break;
    }
    case 'statebed':
    case 'bedroom': {
      chandelier(centre, 1);
      const wall = back;
      if (wall) {
        const u = wall.len / 2;
        const depth = Math.min(3.0, (longAxisS ? s1 - s0 : t1 - t0) * 0.35);
        if (type === 'statebed') {
          push({ kind: 'alcove', pos: wallPoint(wall, u, depth / 2), facing: wall.nIn, size: [wall.len, depth, 0.15], ...base('Alkoven mit Balustrade', 'D', 'D Paradeschlafzimmer with alcove (05 §e.1, research/01 §3.1); balustrade and dais form N') });
          push({ kind: 'bed_romaine', pos: wallPoint(wall, u, 1.0 + 0.7), facing: wall.nIn, size: [2.2, 1.4, 1.3], z: 0.15, ...base('Paradebett à la romaine', 'D', 'D lit à la romaine in the Paradeschlafzimmer (de/en.wikipedia, research/01 §3.1); form after Jacob/Dugourc N') });
          push({ kind: 'baldachin', pos: wallPoint(wall, u, 0.05), facing: wall.nIn, size: [2.6, 1.8, 0.6], z: Math.min(clearH - 0.5, 3.7), ...base('Bettkrone (Baldachin)', 'N', 'N couronne de lit') });
        } else {
          push({ kind: 'bed', pos: wallPoint(wall, u, 1.1), facing: wall.nIn, size: [1.6, 2.1, 1.2], ...base('Bett (lit à la polonaise)', 'N') });
          push({ kind: 'baldachin', pos: wallPoint(wall, u, 0.05), facing: wall.nIn, size: [1.8, 1.4, 0.5], z: Math.min(clearH - 0.5, 3.4), ...base('Bettkrone', 'N') });
        }
      }
      for (const w of walls) {
        if (w === ww || w === wall) continue;
        for (const [a, b] of free(w, 1.0)) items.push(...alongSpan(w, a, b, 'fauteuil', 0.66, 0.6, 2, base('Fauteuil à la reine'), 0.62));
      }
      break;
    }
    case 'cabinet': {
      if (clearH > 3) chandelier(centre, 0.8);
      if (ww) {
        const u = ww.len / 2;
        push({ kind: 'desk', pos: wallPoint(ww, u, 1.6), facing: [-ww.nIn[0], -ww.nIn[1]], size: [1.5, 0.8, 0.76], ...base('Schreibtisch (bureau plat)', 'N', 'N; D Schreibkabinett with Paris furniture c. 1781 (room guide, research/01 §3.1)') });
        push({ kind: 'fauteuil', pos: wallPoint(ww, u, 2.35), facing: [ww.nIn[0], ww.nIn[1]], ...base('Schreibsessel') });
      }
      const sp = longestSpan(walls, 2.4, (w) => w.windows === 0 && w !== fireWall);
      if (sp && sp.b - sp.a > 1.4) push({ kind: 'bookcase', pos: wallPoint(sp.w, (sp.a + sp.b) / 2, 0.22), facing: sp.w.nIn, size: [Math.min(2.4, sp.b - sp.a), 0.42, 2.3], ...base('Bücherschrank') });
      break;
    }
    case 'dining': {
      const len = longAxisS ? s1 - s0 : t1 - t0;
      const wid = longAxisS ? t1 - t0 : s1 - s0;
      const tl = Math.min(len - 3.4, 9);
      const tw = Math.min(1.4, wid - 3);
      if (tl > 1.5 && tw > 0.8) {
        const dir: ST = longAxisS ? [1, 0] : [0, 1];
        const side: ST = longAxisS ? [0, 1] : [1, 0];
        push({ kind: 'table', pos: centre, facing: side, size: [tl, tw, 0.76], ...base('Tafel (Speisetisch, gedeckt mit Tischtuch)') });
        const n = Math.floor(tl / 0.7);
        for (let i = 0; i < n; i++) {
          const x = -tl / 2 + 0.35 + i * 0.7 + (tl - n * 0.7) / 2;
          for (const k of [-1, 1]) {
            const p: ST = [centre[0] + dir[0] * x + side[0] * k * (tw / 2 + 0.35), centre[1] + dir[1] * x + side[1] * k * (tw / 2 + 0.35)];
            items.push({ kind: 'chaise', pos: p, facing: [-side[0] * k, -side[1] * k], ...base('Stuhl (Speisesaal)') });
          }
        }
        const off = tl / 4;
        chandelier([centre[0] - dir[0] * off, centre[1] - dir[1] * off], 1.15);
        chandelier([centre[0] + dir[0] * off, centre[1] + dir[1] * off], 1.15);
      } else chandelier(centre, 1);
      for (const w of walls) {
        if (w === ww || w === fireWall) continue;
        for (const [a, b] of free(w, 1.0)) if (b - a > 1.6) push({ kind: 'chest', pos: wallPoint(w, (a + b) / 2, 0.3), facing: w.nIn, size: [Math.min(2.2, b - a - 0.2), 0.55, 0.95], ...base('Buffet / Anrichtetisch') });
      }
      break;
    }
    case 'library': {
      // Full-height wall cases on every solid span and pier. research/02 §2.11 / 05 §e.2 suggest a
      // gallery at 2.5-3 m, but with 4.1 m clear height, windows on both long walls and 2.35 m
      // doors it cannot be built here [I].
      const caseH = Math.min(clearH - 0.45, 3.6);
      for (const w of walls) {
        for (const [a, b] of free(w, caseH, w.windows > 0 ? 0.12 : 0.3)) {
          if (b - a < 0.8) continue;
          let u = a;
          while (u + 0.8 <= b + 1e-6) {
            const wdt = Math.min(2.4, b - u);
            push({ kind: 'bookcase', pos: wallPoint(w, u + wdt / 2, 0.24), facing: w.nIn, size: [wdt - 0.04, 0.46, caseH], ...base('Bücherschrank (Wandschrank der Hofbibliothek)', 'N', 'N wall-height cases (02 §2.11); D library rescued 1793, now Staatsbibliothek Bamberg (research/01)') });
            u += wdt;
          }
        }
      }
      const len = longAxisS ? s1 - s0 : t1 - t0;
      const dir: ST = longAxisS ? [1, 0] : [0, 1];
      const n = Math.max(1, Math.floor(len / 7));
      for (let i = 0; i < n; i++) {
        const x = -len / 2 + (len / n) * (i + 0.5);
        const p: ST = [centre[0] + dir[0] * x, centre[1] + dir[1] * x];
        push({ kind: 'table', pos: p, facing: longAxisS ? [0, 1] : [1, 0], size: [2.4, 1.1, 0.78], ...base('Lesetisch') });
        for (const k of [-1, 1]) items.push({ kind: 'chaise', pos: [p[0] + (longAxisS ? 0 : k * 0.9), p[1] + (longAxisS ? k * 0.9 : 0)], facing: longAxisS ? [0, -k] : [-k, 0], ...base('Stuhl') });
      }
      if (len > 10) push({ kind: 'globe', pos: [centre[0] + dir[0] * (len / 2 - 2.2), centre[1] + dir[1] * (len / 2 - 2.2)], facing: [0, 1], ...base('Globus') });
      chandelier(centre, 1);
      break;
    }
    case 'collection':
    case 'physics':
    case 'prints':
    case 'armoury': {
      const kind: ItemKind = type === 'armoury' ? 'weapon_rack' : type === 'prints' ? 'chest' : 'vitrine';
      const h = type === 'armoury' ? 2.4 : type === 'prints' ? 1.0 : 2.2;
      for (const w of walls) {
        if (w.windows > 0 && kind !== 'chest') continue;
        for (const [a, b] of free(w, h + 0.1)) {
          let u = a;
          while (u + 1.2 <= b) {
            const wdt = Math.min(2.2, b - u);
            push({ kind, pos: wallPoint(w, u + wdt / 2, 0.32), facing: w.nIn, size: [wdt - 0.1, 0.6, h], ...base(kind === 'vitrine' ? 'Vitrine (Sammlungsschrank)' : kind === 'chest' ? 'Graphikschrank' : 'Waffengestell', 'N', 'N; D collections (Naturalienkabinett, physikalisches Kabinett, Waffensammlung: research/01 §3.2) - cases N') });
            u += wdt;
          }
        }
      }
      if (type === 'physics' || type === 'prints') {
        push({ kind: 'table', pos: centre, facing: [0, 1], size: [Math.min(3, (s1 - s0) * 0.4), Math.min(1.2, (t1 - t0) * 0.3), 0.8], ...base(type === 'physics' ? 'Experimentiertisch' : 'Betrachtungstisch') });
        if (type === 'physics') push({ kind: 'instrument', pos: centre, facing: [0, 1], size: [0.5, 0.5, 0.5], z: 0.8, ...base('Physikalische Instrumente (Elektrisiermaschine, Luftpumpe)', 'N') });
      }
      if (type === 'collection') push({ kind: 'vitrine', pos: centre, facing: [0, 1], size: [Math.min(3, (s1 - s0) * 0.4), 0.9, 1.1], ...base('Pultvitrine') });
      if (clearH > 3 && type !== 'armoury') chandelier(centre, 0.9);
      break;
    }
    case 'gallery': {
      // picture hang on every wall without windows (02 §2.11: N wall for hanging)
      for (const w of walls) {
        if (w.windows > 0) continue;
        for (const [a, b] of freeAlong(w.len, w.holes, 0.9, clearH - 0.8)) {
          if (b - a < 1.2) continue;
          const rows = clearH > 5 ? 3 : 2;
          const rowH = (clearH - 1.6) / rows;
          for (let r = 0; r < rows; r++) {
            let u = a + 0.3;
            while (u < b - 0.9) {
              const wd = Math.min(b - 0.3 - u, 0.9 + inp.rnd() * 1.4 * (r === 0 ? 1.2 : 0.8));
              if (wd < 0.6) break;
              const ht = Math.min(rowH - 0.25, 0.7 + inp.rnd() * rowH * 0.6);
              const z = 1.0 + r * rowH + (rowH - ht) / 2;
              items.push({
                kind: 'picture',
                pos: wallPoint(w, u + wd / 2, 0.04),
                facing: w.nIn,
                size: [wd, 0.06, ht],
                z,
                colour: PICTURE_COLOURS[Math.floor(inp.rnd() * PICTURE_COLOURS.length)],
                ...base('Gemälde (Platzhalter: Farbfeld, keine Bildvorlage)', 'N', 'N dense 18th-c. hang; D picture collection (now Alte Pinakothek); fields are plain colour placeholders'),
              });
              u += wd + 0.25 + inp.rnd() * 0.3;
            }
          }
        }
      }
      const len = longAxisS ? s1 - s0 : t1 - t0;
      const n = Math.max(1, Math.floor(len / 9));
      for (let i = 0; i < n; i++) {
        const x = -len / 2 + (len / n) * (i + 0.5);
        items.push({ kind: 'bench', pos: longAxisS ? [centre[0] + x, centre[1]] : [centre[0], centre[1] + x], facing: longAxisS ? [0, 1] : [1, 0], ...base('Banquette (Galerie)') });
      }
      break;
    }
    case 'kitchen':
    case 'bakery':
    case 'scullery': {
      const end = longestSpan(walls, 3, (w) => w.windows === 0, 0.3);
      if (end && end.b - end.a > 2.2) {
        const wdt = Math.min(type === 'kitchen' ? 4.2 : 2.6, end.b - end.a - 0.2);
        push({ kind: type === 'bakery' ? 'oven' : 'hearth', pos: wallPoint(end.w, (end.a + end.b) / 2, 0.9), facing: end.w.nIn, size: [wdt, 1.7, Math.min(clearH - 0.3, 4.2)], ...base(type === 'bakery' ? 'Backofen' : 'Herd mit Rauchfang (offene Feuerstelle)', 'N', 'N 02 §2.11 kitchen with big hearth stack; 05 §e.2 open hearth') });
      }
      if (type === 'kitchen' && ww) {
        const sp = freeAlong(ww.len, ww.holes, 0.0, 0.85).sort((x, y) => y[1] - y[0] - (x[1] - x[0]))[0];
        if (sp && sp[1] - sp[0] > 2) push({ kind: 'potager', pos: wallPoint(ww, (sp[0] + sp[1]) / 2, 0.4), facing: ww.nIn, size: [Math.min(5, sp[1] - sp[0] - 0.4), 0.75, 0.85], ...base('Potager (Kochherd mit Glutlöchern)', 'N', 'N 05 §e.2 Potager ranges') });
      }
      const len = longAxisS ? s1 - s0 : t1 - t0;
      push({ kind: 'table', pos: centre, facing: longAxisS ? [0, 1] : [1, 0], size: [Math.min(4, len * 0.35), 1.0, 0.85], ...base('Arbeitstisch (Hackbank)') });
      for (const w of walls) {
        if (w.windows > 0) continue;
        for (const [a, b] of free(w, 2.2)) if (b - a > 1.6) push({ kind: 'shelf', pos: wallPoint(w, (a + b) / 2, 0.22), facing: w.nIn, size: [Math.min(3.2, b - a - 0.2), 0.4, 2.1], ...base('Geschirrbord mit Kupfergeschirr') });
      }
      break;
    }
    case 'orangery': {
      const len = longAxisS ? s1 - s0 : t1 - t0;
      const dir: ST = longAxisS ? [1, 0] : [0, 1];
      for (const k of [-1, 0, 1]) chandelier([centre[0] + dir[0] * k * (len / 3), centre[1] + dir[1] * k * (len / 3)], 1.4);
      for (const k of [-1, 1]) {
        for (const j of [0, 1]) {
          const x = k * (len / 2 - 1.5 - j * 2.2);
          items.push({ kind: 'orange_tub', pos: [centre[0] + dir[0] * x, centre[1] + dir[1] * x], facing: [0, 1], ...base('Orangenbaum im Kübel (Sommer: die meisten stehen im Freien)', 'N', 'N summer 1789: citrus trees stand outside; a few kept in the hall') });
        }
      }
      for (const w of walls) {
        if (w.windows > 0) continue;
        for (const [a, b] of free(w, 1.0)) items.push(...alongSpan(w, a, b, 'bench', 1.6, 1.0, 4, base('Banquette'), 0.5));
      }
      break;
    }
    case 'chamber':
    case 'office':
    case 'guard':
    case 'silver':
    case 'pantry':
    case 'workshop':
    case 'garderobe': {
      const sp = longestSpan(walls, 2.2, (w) => w.windows === 0 && w !== fireWall);
      if (sp && sp.b - sp.a > 1.3) {
        const k: ItemKind = type === 'chamber' ? 'bed' : type === 'office' ? 'bookcase' : type === 'guard' ? 'weapon_rack' : 'wardrobe';
        const size: [number, number, number] = k === 'bed' ? [1.2, 2.0, 1.0] : [Math.min(2.2, sp.b - sp.a - 0.2), 0.55, 2.1];
        push({ kind: k, pos: wallPoint(sp.w, (sp.a + sp.b) / 2, k === 'bed' ? 1.05 : 0.3), facing: sp.w.nIn, size, ...base(k === 'bed' ? 'Bett' : k === 'bookcase' ? 'Aktenregal' : k === 'weapon_rack' ? 'Gewehrständer' : 'Schrank') });
      }
      if (type !== 'garderobe') {
        const tw = Math.min(1.6, Math.min(s1 - s0, t1 - t0) - 2);
        if (tw > 0.7) {
          push({ kind: 'table', pos: centre, facing: [0, 1], size: [tw, Math.min(0.9, tw), 0.76], ...base('Tisch') });
          for (const k of [-1, 1]) items.push({ kind: 'stool', pos: [centre[0] + k * (tw / 2 + 0.35), centre[1]], facing: [-k, 0], ...base('Schemel') });
        }
      }
      break;
    }
    default:
      break;
  }
  const zones = doorZones(walls);
  return items.filter((it) => !blocksDoor(it, zones) || it.kind === 'column' || it.kind === 'alcove');
}
