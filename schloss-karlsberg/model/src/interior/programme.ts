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
import { STATE_ROOM } from '../layout/grammar.ts';
import { corniceHeight, countIn, supraportePanels } from './finish.ts';
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
  // KB-I25: the N wing's picture rooms hang like the gallery; the Tanzsaal is a festive hall
  [/bildersaal/i, 'gallery'],
  [/tanzsaal/i, 'festsaal'],
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
  /** Round-headed wall niches cut into the room face (set by interiorModel from the items' `niche`). */
  niches?: Niche[];
}

/** A wall niche: [u0, u1] along the wall, from the floor to the crown v1, `depth` m into the wall. */
export interface Niche {
  u0: number;
  u1: number;
  v1: number;
  depth: number;
  head: 'round';
  tag: string;
}

/**
 * Stove niches of a dining hall (KB-I25 fix wave 4): two round-headed niches placed symmetrically on one blind
 * outer wall (thick enough for a 0.4 m niche), at a quarter of the wall from its middle. Size N: 1.3 m wide,
 * 0.4 m deep, crown 3.4 m (or clear height - 0.7). Null when no blind outer wall gives both niches room.
 */
export function stoveNichePlan(walls: RoomWall[], clearH: number): { wall: RoomWall; us: [number, number]; niche: Omit<Niche, 'u0' | 'u1'>; width: number } | null {
  const width = STOVE_NICHE.width;
  const v1 = Math.min(STOVE_NICHE.crown, clearH - 0.7);
  if (v1 < 2.9) return null;
  const cands = walls.filter((w) => w.exterior && w.windows === 0 && w.len >= 4 * width).sort((a, b) => b.len - a.len);
  for (const w of cands) {
    const off = Math.max(width, w.len / 4);
    const us: [number, number] = [w.len / 2 - off, w.len / 2 + off];
    const spans = furnitureSpans(w, v1, 0.15);
    if (us.every((u) => spans.some(([a, b]) => u - width / 2 >= a && u + width / 2 <= b)))
      return { wall: w, us, width, niche: { v1, depth: STOVE_NICHE.depth, head: 'round', tag: STOVE_NICHE.tag } };
  }
  return null;
}

/** Niche and stove sizes [N] for the O4 stoves (T1 p. 341 "two niches"; T26 altar form). */
export const STOVE_NICHE = {
  width: 1.3,
  depth: 0.4,
  crown: 3.4,
  /** Altar body 0.9 x 0.6 x 1.4 on a pedestal, bronze figure ≈ 0.7 m: total height. */
  stove: [0.9, 0.6, 2.7] as [number, number, number],
  tag: 'D T1 p. 341 two stove niches in the Speisesaal; round head, 1.3 x 0.4 m and position N/I',
} as const;

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
export type InstancedKind = 'fauteuil' | 'chaise' | 'tabouret' | 'canape' | 'console' | 'chandelier' | 'lantern' | 'bench' | 'orange_tub' | 'gueridon' | 'globe' | 'stool' | 'bergere' | 'curule';

/** Sized, merged pieces (geometry built per item). */
export type SizedKind =
  | 'fireplace'
  | 'stove'
  | 'altar_stove'
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
  | 'instrument'
  | 'sconce'
  | 'candelabrum';

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
  /** Wall niche the piece stands in (index into the room's walls); interiorModel cuts it into that wall. */
  niche?: Niche & { wall: number };
  /**
   * KB-I27: documented fittings read from the room's `function` text: oak cases, a Greek-key frieze, brass-wire doors
   * on crimson taffeta (Hofbibliothek), white-painted cases (Naturalienkabinett) [D T5].
   */
  style?: { oak?: boolean; frieze?: boolean; wireDoors?: boolean; white?: boolean };
  name_de: string;
  evidence: 'D' | 'I' | 'N';
  tag: string;
}

export const INSTANCED_KINDS: ReadonlySet<ItemKind> = new Set<ItemKind>(['fauteuil', 'chaise', 'tabouret', 'canape', 'console', 'chandelier', 'lantern', 'bench', 'orange_tub', 'gueridon', 'globe', 'stool', 'bergere', 'curule']);

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
  bergere: [0.76, 0.72],
  curule: [0.62, 0.5],
};

/** Plan footprint of a floor item as [s0, s1, t0, t1] (approximate, axis-aligned). */
export function itemFootprint(it: Item): [number, number, number, number] | null {
  if (it.kind === 'chandelier' || it.kind === 'lantern' || it.kind === 'picture' || it.kind === 'pier_glass' || it.kind === 'trumeau' || it.kind === 'baldachin' || it.kind === 'sconce' || it.kind === 'candelabrum') return null;
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
  // KB-I25: a dining hall whose function names stove niches (B05 Großer Speisesaal, T1 p. 341) gets two niche stoves
  const niches = type === 'dining' && /stove niche/i.test(room.function ?? '');
  const plan = hasFire && clearH > 3 && niches ? stoveNichePlan(walls, clearH) : null;
  if (plan) {
    // two altar stoves in round-headed niches, symmetric on one blind outer wall (fix wave 4)
    const [sw, sd, sh] = STOVE_NICHE.stove;
    for (const u of plan.us)
      push({
        kind: 'altar_stove',
        // back of the pedestal 0.03 m before the niche back; the body stands half in the niche
        pos: wallPoint(plan.wall, u, -plan.niche.depth + 0.03 + (sd + 0.1) / 2),
        facing: plan.wall.nIn,
        size: [sw, sd, sh],
        niche: { ...plan.niche, u0: u - plan.width / 2, u1: u + plan.width / 2, wall: plan.wall.index },
        ...base('Ofen in der Wandnische (Altarform, emaillierter Kupfer, Bronzefigur)', 'D', 'D T1 p. 341 two stove niches in the Speisesaal; T26 Ottomeyer (O4) altar-shaped enamelled-copper stoves crowned by bronze Ceres and Diana/Hebe; body 0.9 x 0.6 x 1.4 m, figure 0.7 m and enamel colour N; placement I'),
      });
    fireWall = plan.wall;
  } else if (hasFire && clearH > 3 && niches) {
    const spans = walls
      .filter((w) => w.windows === 0 && w.len > 2.5)
      .flatMap((w) => furnitureSpans(w, 1.3, 0.4).map(([a, b]) => ({ w, a, b })))
      .filter((x) => x.b - x.a >= 1.6)
      .sort((x, y) => y.b - y.a - (x.b - x.a));
    const picks: { w: RoomWall; u: number }[] = [];
    for (const sp of spans) {
      if (picks.length >= 2) break;
      if (picks.some((p) => p.w === sp.w)) continue;
      const mid = sp.w.len / 2;
      picks.push({ w: sp.w, u: mid - 0.7 >= sp.a && mid + 0.7 <= sp.b ? mid : (sp.a + sp.b) / 2 });
    }
    // only one solid wall: both niches on it at a third and two thirds of the span
    if (picks.length === 1 && spans[0].b - spans[0].a >= 4) picks.splice(0, 1, { w: spans[0].w, u: spans[0].a + (spans[0].b - spans[0].a) / 3 }, { w: spans[0].w, u: spans[0].a + (2 * (spans[0].b - spans[0].a)) / 3 });
    for (const pk of picks)
      push({ kind: 'stove', pos: wallPoint(pk.w, pk.u, 0.4), facing: pk.w.nIn, size: [1.0, 0.75, Math.min(3.2, clearH - 0.6)], ...base('Ofen in der Wandnische (Altarform, emaillierter Kupfer, Bronzefigur)', 'D', 'D T1 p. 341 two stove niches in the Speisesaal; T26 Ottomeyer (O4) altar-shaped enamelled-copper stoves with bronze Ceres and Diana/Hebe; form here N, placement I') });
    if (picks.length) fireWall = picks[0].w;
  } else if (hasFire && clearH > 3) {
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
        // KB-I26: a pair of gilt-bronze wall lights (bras de lumière) beside the trumeau, candle-lit only
        if (isState || grade === 'private') {
          const sz = STATE_ROOM.sconce.height;
          const freeAt = freeAlong(span.w.len, span.w.holes, sz - 0.1, sz + 0.7);
          for (const k of [-1, 1]) {
            const us = u + k * ((w * 0.9) / 2 + STATE_ROOM.sconce.offset);
            if (freeAt.some(([a, b]) => us - 0.3 >= a && us + 0.3 <= b))
              push({ kind: 'sconce', pos: wallPoint(span.w, us, 0.02), facing: span.w.nIn, size: [0.5, 0.32, 0.62], z: sz, ...base('Wandleuchter (bras de lumière, vergoldete Bronze, Kerzen)', 'N', 'N bras de lumière beside the trumeau, candle-lit (research/09 §4.2, I7); D Knigge gilding, mirrors, chandeliers') });
          }
        }
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
      // KB-I26: Antichambre Nr. 8 (Redding citing Langer 1995 no. 46): two bergères of the Jacob suite delivered
      // 5 March 1782 beside a canapé of the same set; arrangement and the rest of the set N/I
      const nBerg = /berg[eè]re/i.test(room.function ?? '') ? (countIn(room.function, /berg[eè]res?/) ?? 2) : 0;
      if (nBerg) {
        const jacob = 'D Redding citing Langer 1995 no. 46: bergères of the Jacob suite (5 March 1782) in "antichambre no. 8"; form N (Louis-seize bergère), placement I';
        const sp = longestSpan(walls, 1.1, (w) => w !== ww && w !== fireWall, 0.4);
        let placed = 0;
        if (sp && sp.b - sp.a >= 2.1) {
          const u = (sp.a + sp.b) / 2;
          push({ kind: 'canape', pos: wallPoint(sp.w, u, 0.45), facing: sp.w.nIn, ...base('Kanapee (Garnitur Georges Jacob, 1782)', 'N', 'N; D seating set by Georges Jacob delivered 5 March 1782 (Redding / Langer 1995 no. 46); form N') });
          // a large room: the bergères flank the canapé, turned slightly towards it
          if (sp.b - sp.a > 2.4 + nBerg * 0.9) {
            for (; placed < nBerg; placed++) {
              const k = placed % 2 === 0 ? -1 : 1;
              const off = 1.35 + Math.floor(placed / 2) * 0.9;
              push({ kind: 'bergere', pos: wallPoint(sp.w, u + k * off, 0.75), facing: [sp.w.nIn[0] * 0.94 - k * sp.w.d[0] * 0.34, sp.w.nIn[1] * 0.94 - k * sp.w.d[1] * 0.34], ...base('Bergère (Georges Jacob, 1782)', 'D', jacob) });
            }
          }
        }
        // a small room (Nr. 8 is ≈ 5 × 6 m): the bergères stand on the other free wall spans, against the wall
        for (const w of walls) {
          if (placed >= nBerg || w === ww) continue;
          for (const [a, b] of free(w, 1.1, 0.3)) {
            if (placed >= nBerg) break;
            const its = alongSpan(w, a, b, 'bergere', 0.76, 0.4, nBerg - placed, base('Bergère (Georges Jacob, 1782)', 'D', jacob), 0.72);
            for (const it of its) push(it);
            placed += its.length;
          }
        }
      }
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
      // Wall cases on every solid span and pier. research/02 §2.11 / 05 §e.2 suggest a gallery at 2.5-3 m, but with
      // 4.1 m clear height, windows on both long walls and 2.35 m doors it cannot be built here [I].
      // KB-I27: the Hofbibliothek's documented fittings come from the catalogue function text (T5, research/10 §c.3):
      // oak cases floor to ceiling (up to the cove cornice), a Greek-key frieze under their cornice, and in one room
      // brass-wire doors backed with crimson taffeta.
      const fn = room.function ?? '';
      const style = { oak: /\boak\b/i.test(fn), frieze: /greek[- ]key|grecque|a la gr[eè]ce/i.test(fn), wireDoors: /wire|taffeta/i.test(fn) };
      const cornice = Math.min(0.75, clearH * 0.12);
      const caseH = style.oak ? clearH - cornice - 0.03 : Math.min(clearH - 0.45, 3.6);
      const caseTag = style.oak
        ? `D T5 (LA Speyer B3 2584 Bl. 191) oak cases floor to ceiling, adjustable shelves${style.frieze ? ', Greek-key frieze ≈ 12 cm under a cornice' : ''}${style.wireDoors ? ', brass-wire doors backed with crimson taffeta' : ''}; oak hue and taffeta #9E1B32 N; case widths I`
        : 'N wall-height cases (02 §2.11); D library rescued 1793, now Staatsbibliothek Bamberg (research/01)';
      const caseName = style.wireDoors ? 'Bücherschrank (Eiche, Messingdrahtgitter mit karmesinrotem Taft)' : style.oak ? 'Bücherschrank (Eiche, raumhoch, Mäanderfries)' : 'Bücherschrank (Wandschrank der Hofbibliothek)';
      for (const w of walls) {
        for (const [a, b] of free(w, caseH, w.windows > 0 ? 0.12 : 0.3)) {
          if (b - a < 0.8) continue;
          let u = a;
          while (u + 0.8 <= b + 1e-6) {
            const wdt = Math.min(2.4, b - u);
            push({ kind: 'bookcase', pos: wallPoint(w, u + wdt / 2, 0.24), facing: w.nIn, size: [wdt - 0.04, 0.46, caseH], style: style.oak ? style : undefined, ...base(caseName, style.oak ? 'D' : 'N', caseTag) });
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
      const fn = room.function ?? '';
      // KB-I27 (T5, research/10 §c.3): the Naturalienkabinett's white-painted glass cabinets and glass-topped display
      // tables; the Waffensammlung's mirror doors and inlaid table with green cloth
      const white = /white[- ]painted glass cabinets?/i.test(fn);
      const kind: ItemKind = type === 'armoury' ? 'weapon_rack' : type === 'prints' ? 'chest' : 'vitrine';
      const h = type === 'armoury' ? 2.4 : type === 'prints' ? 1.0 : white ? Math.min(2.8, clearH - 1.0) : 2.2;
      const mirrorDoors = type === 'armoury' ? (countIn(fn, /(?:large )?mirror doors?/) ?? 0) : 0;
      if (mirrorDoors) {
        // three large mirror doors (T5, T7 no. 2) on the longest blind wall, mirror glass in gilt frames [D; size N]
        const sp = longestSpan(walls, 3.0, (w) => w.windows === 0, 0.3);
        if (sp) {
          const dw = 1.2;
          const n = Math.min(mirrorDoors, Math.floor((sp.b - sp.a + 0.6) / (dw + 0.6)));
          const used = n * dw + (n - 1) * 0.6;
          for (let i = 0; i < n; i++) push({ kind: 'pier_glass', pos: wallPoint(sp.w, (sp.a + sp.b) / 2 - used / 2 + dw / 2 + i * (dw + 0.6), 0.03), facing: sp.w.nIn, size: [dw, 0.05, Math.min(2.9, clearH - 0.9)], z: 0.12, ...base('Spiegeltür', 'D', 'D T5 (T7 no. 2; LA Speyer B3 2609 Bl. 251) three large mirror doors in the Waffensammlung; size and wall I') });
        }
      }
      for (const w of walls) {
        if (w.windows > 0 && kind !== 'chest') continue;
        for (const [a, b] of free(w, h + 0.1)) {
          let u = a;
          while (u + 1.2 <= b) {
            const wdt = Math.min(2.2, b - u);
            push({ kind, pos: wallPoint(w, u + wdt / 2, 0.32), facing: w.nIn, size: [wdt - 0.1, 0.6, h], style: white ? { white } : undefined, ...base(kind === 'vitrine' ? (white ? 'Glasschrank (weiß gefasst)' : 'Vitrine (Sammlungsschrank)') : kind === 'chest' ? 'Graphikschrank' : 'Waffengestell', white ? 'D' : 'N', white ? 'D T5 white-painted glass cabinets in the Naturalienkabinett (research/10 §c.3); sizes and placement N/I' : 'N; D collections (Naturalienkabinett, physikalisches Kabinett, Waffensammlung: research/01 §3.2) - cases N') });
            u += wdt;
          }
        }
      }
      if (white && /display tables?/i.test(fn)) {
        // a row of glass-topped display tables down the room [D T5; number and spacing I]
        const len = longAxisS ? s1 - s0 : t1 - t0;
        const dir: ST = longAxisS ? [1, 0] : [0, 1];
        const n = Math.max(1, Math.floor((len - 3) / 3.2));
        for (let i = 0; i < n; i++) {
          const x = -len / 2 + 1.5 + ((len - 3) / n) * (i + 0.5);
          push({ kind: 'vitrine', pos: [centre[0] + dir[0] * x, centre[1] + dir[1] * x], facing: longAxisS ? [0, 1] : [1, 0], size: [1.8, 0.85, 0.95], style: { white }, ...base('Schautisch mit Glasplatte', 'D', 'D T5 display tables with glass tops (research/10 §c.3); size and row I') });
        }
      }
      if (type === 'armoury' && /green cloth/i.test(fn)) push({ kind: 'desk', pos: centre, facing: [0, 1], size: [2.0, 1.1, 0.78], ...base('Eingelegter Tisch mit grünem Tuch', 'D', 'D T5 inlaid table covered in green cloth (research/10 §c.3); size N') });
      if (type === 'physics' || type === 'prints') {
        push({ kind: 'table', pos: centre, facing: [0, 1], size: [Math.min(3, (s1 - s0) * 0.4), Math.min(1.2, (t1 - t0) * 0.3), 0.8], ...base(type === 'physics' ? 'Experimentiertisch' : 'Betrachtungstisch') });
        if (type === 'physics') push({ kind: 'instrument', pos: centre, facing: [0, 1], size: [0.5, 0.5, 0.5], z: 0.8, ...base('Physikalische Instrumente (Elektrisiermaschine, Luftpumpe)', 'N') });
      }
      if (type === 'collection' && !white) push({ kind: 'vitrine', pos: centre, facing: [0, 1], size: [Math.min(3, (s1 - s0) * 0.4), 0.9, 1.1], ...base('Pultvitrine') });
      if (clearH > 3 && type !== 'armoury') chandelier(centre, 0.9);
      break;
    }
    case 'gallery': {
      // KB-I27: the picture rooms. A dense 18th-c. hang (rooms "so full of paintings that a chair-height rail was
      // fitted", T5) from just above the dado rail up to the cornice, on every wall without windows and on the window
      // piers; canvases are tonal placeholders (finish.ts canvasGrid), no artwork [N hang; D collection].
      // The Bildergalerie KB-B06 (T1 pp. 374 f., 394; T5): 20 crystal chandeliers, gilt-bronze side tables with
      // six-arm candelabra on the piers, 104 gilt curule armchairs in the damask; counts from the function text.
      const fn = room.function ?? '';
      const sideTables = /side tables?/i.test(fn);
      const nChand = countIn(fn, /crystal chandeliers?/);
      const nChairs = countIn(fn, /(?:gilt )?curule (?:arm)?chairs?/) ?? 0;
      const cornice = Math.min(0.75, clearH * 0.12);
      const top = clearH - cornice - 0.12;
      const low = STATE_ROOM.dado + 0.22;
      const hangTag = 'N dense 18th-c. hang; D picture collection (now Alte Pinakothek), D T5 picture rooms hung densely; canvases are tonal placeholders (no artwork)';
      // wave-5 review: the painted overdoors (supraportes, drawn by the shell) are part of the hang; the canvases keep
      // clear of them (two gilt frames collided over a door in the Großer Bildersaal, pose 22)
      const walls_ = room.finish?.walls ?? '';
      const fancy = walls_ === 'wall.boiserie' || walls_.startsWith('wall.silk');
      const corniceH = corniceHeight(walls.flatMap((w) => w.holes), clearH, fancy, false);
      const supra = new Map(walls.map((w) => [w.index, supraportePanels(w.len, w.holes, clearH, corniceH, { state: isState, fancy })] as const));
      const picture = (w: RoomWall, u: number, wd: number, ht: number, z: number) => {
        const r = { u0: u - wd / 2, u1: u + wd / 2, v0: z, v1: z + ht };
        if ((supra.get(w.index) ?? []).some((q) => r.u0 < q.u1 + 0.06 && q.u0 - 0.06 < r.u1 && r.v0 < q.v1 + 0.06 && q.v0 - 0.06 < r.v1)) return;
        items.push({ kind: 'picture', pos: wallPoint(w, u, 0.04), facing: w.nIn, size: [wd, 0.07, ht], z, ...base('Gemälde (Platzhalter, keine Bildvorlage)', 'N', hangTag) });
      };
      // hang one free band [a, b] x [v0, v1] of a wall with rows of canvases of varied size
      const hang = (w: RoomWall, a: number, b: number, v0: number, v1: number) => {
        const avail = v1 - v0;
        const rows = Math.max(1, Math.round(avail / 1.05));
        const rowH = avail / rows;
        for (let r = 0; r < rows; r++) {
          let u = a + 0.12;
          while (u < b - 0.5) {
            const big = r === 0 || (r === 1 && rows > 2);
            const wd = Math.min(b - 0.12 - u, 0.55 + inp.rnd() * (big ? 1.25 : 0.8));
            if (wd < 0.45) break;
            const ht = Math.min(rowH - 0.14, 0.5 + inp.rnd() * rowH * 0.55);
            const z = v0 + r * rowH + (rowH - ht) / 2;
            picture(w, u + wd / 2, wd, ht, z);
            u += wd + 0.12 + inp.rnd() * 0.16;
          }
        }
      };
      for (const w of walls) {
        if (w.windows > 0) continue;
        for (const [a, b] of freeAlong(w.len, w.holes, low, top)) if (b - a >= 0.8) hang(w, a, b, low, top);
        // over the doors: the band between the door head and the cornice
        for (const ho of w.holes) if (ho.v0 < 0.05 && top - (ho.v1 + 0.25) > 0.5) hang(w, ho.u0 - 0.1, ho.u1 + 0.1, ho.v1 + 0.25, top);
      }
      // window piers of every window wall (KB-B06 has windows on both long sides, some only at the ends): side tables
      // with candelabra (KB-B06) or a stack of canvases (the Bildersäle)
      for (const ww of walls.filter((x) => x.windows > 0)) {
        const piers = freeAlong(ww.len, ww.holes, 0.9, top).filter(([a, b]) => b - a >= 0.7);
        for (const [a, b] of piers) {
          const u = (a + b) / 2;
          if (sideTables && b - a >= 1.3 && b - a <= 4) {
            push({ kind: 'console', pos: wallPoint(ww, u, 0.27), facing: ww.nIn, ...base('Beistelltisch (vergoldete Bronze)', 'D', 'D T1 pp. 374 f. / T5 gilt-bronze side tables between the windows; form N') });
            push({ kind: 'candelabrum', pos: wallPoint(ww, u, 0.27), facing: ww.nIn, size: [0.6, 0.6, 0.75], z: 0.885, ...base('Kandelaber (sechsarmig)', 'D', 'D T1 pp. 374 f. six-arm candelabra on the side tables; form N') });
            hang(ww, a, b, 1.95, top);
          } else hang(ww, a, b, low, top);
        }
      }
      const len = longAxisS ? s1 - s0 : t1 - t0;
      const dir: ST = longAxisS ? [1, 0] : [0, 1];
      // chandeliers on the room axis: the documented count, else one per ≈ 6 m
      const nc = Math.max(1, Math.min(nChand ?? Math.round(len / 6), Math.floor(len / 2.6)));
      for (let i = 0; i < nc; i++) {
        const x = -len / 2 + (len / nc) * (i + 0.5);
        chandelier([centre[0] + dir[0] * x, centre[1] + dir[1] * x], nChand ? 0.95 : 1.05);
      }
      if (nChairs > 0) {
        // curule armchairs lined along both long walls (period practice), up to the documented number
        let left = nChairs;
        const chairTag = 'D T1 pp. 374 f. / T5 104 gilt curule armchairs in the green damask with gold fringes; form N, placement I';
        for (const w of [...walls].sort((p, q) => q.len - p.len)) {
          if (left <= 0) break;
          for (const [a, b] of free(w, 0.78)) {
            if (left <= 0) break;
            const its = alongSpan(w, a, b, 'curule', 0.6, 0.2, left, base('Kurulischer Armlehnstuhl (vergoldet, Damastbezug)', 'D', chairTag), 0.5);
            items.push(...its);
            left -= its.length;
          }
        }
      } else {
        const n = Math.max(1, Math.floor(len / 9));
        for (let i = 0; i < n; i++) {
          const x = -len / 2 + (len / n) * (i + 0.5);
          items.push({ kind: 'bench', pos: longAxisS ? [centre[0] + x, centre[1]] : [centre[0], centre[1] + x], facing: longAxisS ? [0, 1] : [1, 0], ...base('Banquette (Galerie)') });
        }
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
        push({ kind: k, pos: wallPoint(sp.w, (sp.a + sp.b) / 2, k === 'bed' ? 1.05 : 0.3), facing: sp.w.nIn, size, ...base(k === 'bed' ? 'Bett' : k === 'bookcase' ? 'Aktenregal' : k === 'weapon_rack' ? 'Gewehrständer' : type === 'workshop' ? 'Werkzeugschrank' : 'Schrank') });
      }
      if (type !== 'garderobe') {
        const tw = Math.min(1.6, Math.min(s1 - s0, t1 - t0) - 2);
        if (tw > 0.7) {
          push({ kind: 'table', pos: centre, facing: [0, 1], size: [tw, Math.min(0.9, tw), 0.76], ...base(type === 'workshop' ? 'Werkbank' : 'Tisch') });
          for (const k of [-1, 1]) items.push({ kind: 'stool', pos: [centre[0] + k * (tw / 2 + 0.35), centre[1]], facing: [-k, 0], ...base('Schemel') });
        }
      }
      break;
    }
    default:
      break;
  }
  const zones = doorZones(walls);
  return fitSconces(items.filter((it) => !blocksDoor(it, zones) || it.kind === 'column' || it.kind === 'alcove'));
}

/** Pieces a wall light must not overlap: tall cases and hung frames on the same wall. */
const WALL_TALL: ReadonlySet<ItemKind> = new Set<ItemKind>(['bookcase', 'shelf', 'wardrobe', 'vitrine', 'weapon_rack', 'pier_glass', 'picture', 'trumeau']);

/** Extent of a wall piece along its wall ([u0, u1] on the axis perpendicular to `facing`), height and plane offset. */
function wallExtent(it: Item): { u0: number; u1: number; v0: number; v1: number; plane: number; along: ST } {
  const along: ST = [-it.facing[1], it.facing[0]];
  const u = it.pos[0] * along[0] + it.pos[1] * along[1];
  const [w, d, h] = it.size ?? [0.5, 0.3, 0.5];
  return { u0: u - w / 2, u1: u + w / 2, v0: it.z ?? 0, v1: (it.z ?? 0) + h, plane: it.pos[0] * it.facing[0] + it.pos[1] * it.facing[1] - d / 2, along };
}

/** True when two wall pieces share a wall (same facing, planes within `tol`) and their wall rectangles overlap. */
export function wallOverlap(a: Item, b: Item, tol = 0.6): boolean {
  if (Math.abs(a.facing[0] - b.facing[0]) + Math.abs(a.facing[1] - b.facing[1]) > 1e-3) return false;
  const A = wallExtent(a);
  const B = wallExtent(b);
  if (Math.abs(A.plane - B.plane) > tol) return false;
  return A.u0 < B.u1 && B.u0 < A.u1 && A.v0 < B.v1 && B.v0 < A.v1;
}

/**
 * Wave-5 review (Hofbibliothek, pose 21: sconce candles inside the oak cases): wall lights are placed beside the
 * trumeau before the cases fill the wall. A sconce that overlaps a case or a hung frame moves onto the trumeau's own
 * frame (bras de lumière fixed to the mirror frame, a period practice [N]); when that also collides, it is dropped.
 */
export function fitSconces(items: Item[]): Item[] {
  const others = items.filter((it) => WALL_TALL.has(it.kind));
  const clash = (sc: Item) => others.some((o) => o.kind !== 'trumeau' && wallOverlap(sc, o));
  const out: Item[] = [];
  for (const it of items) {
    if (it.kind !== 'sconce' || !clash(it)) {
      out.push(it);
      continue;
    }
    const tr = others.find((o) => o.kind === 'trumeau' && Math.abs(o.facing[0] - it.facing[0]) + Math.abs(o.facing[1] - it.facing[1]) < 1e-3 && Math.hypot(o.pos[0] - it.pos[0], o.pos[1] - it.pos[1]) < 2.5);
    if (!tr) continue;
    const E = wallExtent(tr);
    const u = it.pos[0] * E.along[0] + it.pos[1] * E.along[1];
    const side = u < (E.u0 + E.u1) / 2 ? -1 : 1;
    // the backplate on the frame, 4 cm inside its outer edge; the arms reach over the glass and just past the frame
    const target = (side < 0 ? E.u0 : E.u1) - side * 0.04;
    // 6 cm out from the wall, so the backplate sits on the face of the frame's moulding
    const moved: Item = { ...it, pos: [it.pos[0] + E.along[0] * (target - u) + it.facing[0] * 0.06, it.pos[1] + E.along[1] * (target - u) + it.facing[1] * 0.06], name_de: 'Spiegelarm (bras de lumière am Trumeau, Kerzen)', tag: `${it.tag}; wave-5: on the trumeau frame, the cases fill the pier (N)` };
    if (!clash(moved)) out.push(moved);
  }
  return out;
}
