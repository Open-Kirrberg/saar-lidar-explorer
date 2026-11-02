/**
 * KB-I42 interior mapping: a cheap parallax room behind every LOD2 window seen from outside (after J. van Dongen,
 * "Interior Mapping: a new technique for rendering realistic buildings", CGI 2008,
 * https://www.proun-game.com/Oogst3D/CODING/InteriorMapping/InteriorMapping.pdf). No DOM; the constants come from the
 * model's GLASS_LOOK (one truth with the GLSL).
 *
 * Per window (night.ts groups the panes): a box room in the window's own frame (x along the facade, y up from the
 * window bottom, z out of the facade, so the room lies at z < 0) with a floor below the sill, a ceiling above the head,
 * side walls and a back wall, plus half-drawn curtains just behind the glass.
 *
 * Wave-7 review fix: the room is the **catalogue room behind the window** (`catalogueRooms` + `windowRoomAt`): its clear
 * polygon gives the depth to the far wall and the side walls (so every window of a long hall looks into the same
 * space), its storey the floor and ceiling, its finish the wall colour (silk hue or wall material; darkened by the
 * gain). Curtains hang in about a third of the rooms [I], per room, in white or cream muslin [N summer muslin I] or the
 * room's own silk [N research/02 materials table]. Service rooms, roof windows (dormers, oculi) and windows with no
 * room behind them show a dark neutral cavity. Buildings without a room programme get the generated single hall
 * (interior/model.ts); buildings drawn without an interior keep the flat proxy. Which furnishing stood behind which
 * window is unknown [U]; the mapped room is a generic period room of the documented finish [I].
 */
import { hashString, mulberry32 } from '@model/layout/geom.ts';
import { GLASS_LOOK, MATERIAL_BASE } from '@model/materials/index.ts';
import type { Building } from '@model/spec.ts';
import type { MaterialName } from '@model/context.ts';
import type { BuildingLayout } from '@model/layout/building.ts';
import { generatedRooms } from '@model/interior/model.ts';
import { classifyRoom, gradeOf, type Grade, type RoomType } from '@model/interior/programme.ts';
import { silkHue } from '@model/interior/finish.ts';

export type RGB = [number, number, number];
type XZ = [number, number];

/** What the shader draws behind a window (aRoom.y). */
export const ROOM_MODE = { room: 1, pictures: 2, cavity: 3 } as const;
/** Curtain colour (packed in aRoom.w): white muslin, cream muslin, the room's silk. */
export const CURTAIN_KIND = { muslin: 0, cream: 1, silk: 2 } as const;

/** A catalogue room as the window mapping needs it, in the level-local frame of the building (x = s, z = −t). */
export interface RoomInfo {
  id: string;
  type: RoomType;
  grade: Grade;
  /** clear polygon in level-local [x, z] */
  ring: XZ[];
  floor_h: number;
  ceiling_h: number;
  /** wall colour '#RRGGBB' (silk hue or the wall material) */
  wall: string;
  silk: boolean;
}

/** Seeded room behind one window (metres, window frame). */
export interface WindowRoom {
  mode: number;
  /** distance from the glass to the back wall */
  depth: number;
  /** side walls at x = −left and x = +right from the window axis */
  left: number;
  right: number;
  /** floor below the window bottom, ceiling above it */
  sill: number;
  ceil: number;
  /** open share of the window between the curtains (0.35–0.8 of its half width); 1 = no curtains */
  open: number;
  /** wall colour (sRGB hex) and curtain kind (CURTAIN_KIND) */
  wall: string;
  curtain: number;
}

const FALLBACK_WALL = GLASS_LOOK.interior.fallbackWall;

/** Rooms of one building (catalogue rooms, else the generated hall; none for `interior: 'none'` without rooms). */
export function catalogueRooms(b: Building, layout: BuildingLayout): RoomInfo[] {
  const rooms = b.rooms?.length ? b.rooms : b.interior !== 'none' ? generatedRooms(b, layout) : [];
  const { stack } = layout;
  return rooms.map((room) => {
    const type = classifyRoom(room);
    const level = stack.levels[room.storey];
    const silk = silkHue(room.finish);
    const wallMat = room.finish?.walls as MaterialName | undefined;
    const wall = silk ?? (wallMat && MATERIAL_BASE[wallMat]?.color) ?? FALLBACK_WALL;
    return {
      id: room.id,
      type,
      grade: gradeOf(type, room),
      ring: room.polygon.map(([s, t]) => [s, -t] as XZ),
      floor_h: room.floor_h ?? level?.floor_h ?? stack.base_h,
      ceiling_h: room.ceiling_h ?? level?.ceiling_h ?? stack.eaves_h,
      wall,
      silk: !!silk,
    };
  });
}

function inside(p: XZ, ring: readonly XZ[]): boolean {
  let r = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) r = !r;
  }
  return r;
}

/** Distance from p (inside the ring) along the unit direction d to the ring's boundary. */
function exitDistance(p: XZ, d: XZ, ring: readonly XZ[]): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0];
    const az = ring[j][1];
    const ex = ring[i][0] - ax;
    const ez = ring[i][1] - az;
    const den = d[0] * ez - d[1] * ex;
    if (Math.abs(den) < 1e-9) continue;
    const wx = ax - p[0];
    const wz = az - p[1];
    const t = (wx * ez - wz * ex) / den;
    const u = (wx * d[1] - wz * d[0]) / den;
    if (t > 1e-6 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
  }
  return best;
}

/** Most the mapped room reaches (m): deeper or wider halls are clipped [I]. */
export const ROOM_MAX = { depth: 25, side: 30 } as const;
/** Share of the rooms with drawn curtains [I: reviewer's 30–40 %]. */
export const CURTAIN_SHARE = GLASS_LOOK.interior.curtainShare;

/**
 * The room behind a window: centre `c` (level-local x, y, z), outward unit normal `n` (x, z), window bottom `y0`,
 * height `h` and half width `halfW`. `roof` marks dormers and roof oculi. Deterministic per room id / window key.
 */
export function windowRoomAt(rooms: readonly RoomInfo[], c: readonly [number, number, number], n: XZ, y0: number, h: number, halfW: number, key: string, roof = false, seed = 1789): WindowRoom {
  const cavity: WindowRoom = { mode: ROOM_MODE.cavity, depth: 2.5, left: Math.max(1, halfW * 2), right: Math.max(1, halfW * 2), sill: 0.6, ceil: h + 0.5, open: 1, wall: GLASS_LOOK.interior.cavity, curtain: 0 };
  if (roof) return cavity;
  const t: XZ = [n[1], -n[0]];
  // walk inward from the glass through the wall into the room on the window's storey
  let room: RoomInfo | null = null;
  let sIn = 0;
  for (const r of rooms) {
    if (c[1] < r.floor_h - 0.3 || c[1] > r.ceiling_h + 0.3) continue;
    for (let s = 0.05; s <= 3; s += 0.1) {
      if (inside([c[0] - n[0] * s, c[2] - n[1] * s], r.ring)) {
        if (!room || s < sIn) {
          room = r;
          sIn = s;
        }
        break;
      }
    }
  }
  if (!room) {
    // a facade window with no catalogue room behind it (stair or roof space): generic, uncurtained, neutral
    if (rooms.length) return cavity;
    return { mode: ROOM_MODE.room, depth: 5, left: 2.5, right: 2.5, sill: h >= GLASS_LOOK.interior.frenchWindow ? GLASS_LOOK.interior.frenchSill : GLASS_LOOK.interior.sill, ceil: h + GLASS_LOOK.interior.lintel, open: 1, wall: FALLBACK_WALL, curtain: 0 };
  }
  const q: XZ = [c[0] - n[0] * (sIn + 0.15), c[2] - n[1] * (sIn + 0.15)];
  const depth = Math.min(ROOM_MAX.depth, sIn + 0.15 + exitDistance(q, [-n[0], -n[1]], room.ring));
  const right = Math.min(ROOM_MAX.side, Math.max(halfW + 0.2, exitDistance(q, t, room.ring)));
  const left = Math.min(ROOM_MAX.side, Math.max(halfW + 0.2, exitDistance(q, [-t[0], -t[1]], room.ring)));
  const sill = Math.max(0.05, y0 - room.floor_h);
  const ceil = Math.max(h + 0.1, room.ceiling_h - y0);
  if (room.grade === 'service') return { ...cavity, depth, left, right, sill, ceil };
  // per room: curtains (one choice for all its windows), pictures; per window: how far the curtains are drawn
  const rr = mulberry32(hashString(`room|${room.id}`) ^ seed);
  const curtained = rr() < CURTAIN_SHARE;
  const kind = room.silk && rr() < 0.5 ? CURTAIN_KIND.silk : rr() < 0.7 ? CURTAIN_KIND.muslin : CURTAIN_KIND.cream;
  const pictures = room.type === 'gallery' || room.type === 'prints' || ((room.grade === 'state' || room.grade === 'private') && rr() < 0.5);
  const rw = mulberry32(hashString(`win|${key}`) ^ seed);
  const open = curtained ? 0.45 + 0.35 * rw() : 1;
  return { mode: pictures ? ROOM_MODE.pictures : ROOM_MODE.room, depth, left, right, sill, ceil, open, wall: room.wall, curtain: kind };
}

/** sRGB hex → 5-6-5 integer (the shader decodes it; 16 bits of a float's exact integer range). */
export function packRgb565(hex: string): number {
  const v = parseInt(hex.replace('#', ''), 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  return (Math.round((r / 255) * 31) << 11) | (Math.round((g / 255) * 63) << 5) | Math.round((b / 255) * 31);
}

/** Inverse of packRgb565 (0…1 sRGB). */
export function unpackRgb565(p: number): RGB {
  return [((p >> 11) & 31) / 31, ((p >> 5) & 63) / 63, (p & 31) / 31];
}

/** The room as the vertex attributes `aRoom` (depth, mode, open share, rgb565 + 65536 · curtain) and `aRoom2` (left, right, sill, ceil). */
export function roomAttributes(r: WindowRoom): { aRoom: [number, number, number, number]; aRoom2: [number, number, number, number] } {
  return { aRoom: [r.depth, r.mode, r.open, packRgb565(r.wall) + 65536 * r.curtain], aRoom2: [r.left, r.right, r.sill, r.ceil] };
}

/** Distance of the curtains behind the glass (m). */
export const CURTAIN_GAP = GLASS_LOOK.interior.curtainGap;

export type RoomSurface = 'back' | 'side' | 'floor' | 'ceiling' | 'curtain';

/**
 * CPU twin of the GLSL ray cast: from the point `p` on the glass (window frame: x along the facade, y from the window
 * bottom, z = 0) along the view direction `d` (d.z < 0, into the room) to the first room surface. `halfW` and `height`
 * are the window's.
 */
export function roomHit(p: readonly [number, number], d: readonly [number, number, number], room: WindowRoom, halfW: number, height: number): { surface: RoomSurface; t: number; at: RGB } {
  const dz = Math.min(d[2], -1e-4);
  // curtains: a plane just behind the glass, outside the open middle of the window
  if (room.open < 1) {
    const tc = CURTAIN_GAP / -dz;
    const xc = p[0] + d[0] * tc;
    const yc = p[1] + d[1] * tc;
    if (Math.abs(xc) > room.open * halfW && yc > -0.2 && yc < height + 0.3) return { surface: 'curtain', t: tc, at: [xc, yc, -CURTAIN_GAP] };
  }
  const tb = room.depth / -dz;
  const tx = Math.abs(d[0]) > 1e-6 ? ((d[0] > 0 ? room.right : -room.left) - p[0]) / d[0] : Infinity;
  const ty = Math.abs(d[1]) > 1e-6 ? (d[1] > 0 ? room.ceil - p[1] : -room.sill - p[1]) / d[1] : Infinity;
  const t = Math.min(tb, tx, ty);
  const at: RGB = [p[0] + d[0] * t, p[1] + d[1] * t, d[2] * t];
  const surface: RoomSurface = t === tb ? 'back' : t === tx ? 'side' : d[1] > 0 ? 'ceiling' : 'floor';
  return { surface, t, at };
}
