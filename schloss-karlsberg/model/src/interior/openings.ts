/**
 * Openings as the interiors see them (pure, no three.js).
 *
 * Two sources, one representation:
 *  - facade openings from `layoutBuilding()` (the SAME list the exterior cuts its holes from),
 *    referenced to the outer wall face via `sidePoint(frame, side, a, 0)`;
 *  - catalogue openings `Building.openings` (interior doors on partition centre lines,
 *    passages through end walls), referenced to their wall line.
 * A room edge picks up every opening whose wall line is parallel to it, lies outside the room
 * within `maxDepth`, overlaps the edge along its length and overlaps the room's height range.
 */
import type { BuildingLayout } from '../layout/building.ts';
import { sidePoint } from '../layout/footprint.ts';
import { cullBuriedOpenings } from '../layout/facade.ts';
import type { Building, HeadForm, OpeningKind, Room, ST } from '../spec.ts';
import { type Hole, revealSplay } from './wall.ts';

export interface IOpening {
  id: string;
  kind: OpeningKind;
  source: 'facade' | 'catalogue' | 'interior';
  storey: number;
  /** Centre on the reference line (outer face for facade openings, wall centre line otherwise). */
  centre: ST;
  /** Unit vector along the wall. */
  dir: ST;
  width: number;
  bottom_h: number;
  top_h: number;
  head: HeadForm;
  rooms?: [string, string];
  /** On the outer facade (glass, exterior reveal) - the exterior owns the outer half. */
  facade: boolean;
  tag: string;
}

/** Kinds a person can walk through (doors, passages, portals). */
export const WALK_KINDS: ReadonlySet<OpeningKind> = new Set<OpeningKind>(['door', 'double_door', 'jib_door', 'passage', 'portal', 'durchfahrt', 'carriage_gate']);

/** Door leaves drawn by the interiors (portals / gates belong to the exterior). */
export const LEAF_KINDS: ReadonlySet<OpeningKind> = new Set<OpeningKind>(['door', 'double_door', 'jib_door']);

const norm = (v: ST): ST => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};

/**
 * All openings of a building in [s, t] with absolute heights. With `groundAt(E, N)` the facade openings are culled
 * exactly as the exterior culls them (cullBuriedOpenings), so every interior reveal has an exterior hole.
 */
export function collectOpenings(b: Building, layout: BuildingLayout, groundAt?: (E: number, N: number) => number): IOpening[] {
  const out: IOpening[] = [];
  const { frame, stack } = layout;
  const facadeOps = groundAt ? cullBuriedOpenings(layout.openings, frame, groundAt) : layout.openings;
  facadeOps.forEach((o) => {
    const i = layout.openings.indexOf(o);
    if (o.kind === 'cellar_window') return;
    const sd = frame.sides[o.side];
    out.push({
      id: `facade-${o.side}-${o.storey}-${o.axis}-${i}`,
      kind: o.kind,
      source: 'facade',
      storey: o.storey,
      centre: sidePoint(frame, o.side, o.a, 0),
      dir: sd.tangent,
      width: o.width,
      bottom_h: o.bottom_h,
      top_h: o.top_h,
      head: o.head,
      facade: true,
      tag: o.tag,
    });
  });
  (b.openings ?? []).forEach((o, i) => {
    const level = stack.levels[o.storey];
    if (!level) return;
    let centre: ST;
    let dir: ST;
    let rooms: [string, string] | undefined;
    let facade = false;
    if (o.wall.kind === 'segment') {
      dir = norm([o.wall.p1[0] - o.wall.p0[0], o.wall.p1[1] - o.wall.p0[1]]);
      centre = [o.wall.p0[0] + dir[0] * o.a, o.wall.p0[1] + dir[1] * o.a];
      rooms = o.wall.rooms;
    } else if (o.wall.kind === 'side') {
      const sd = frame.sides[o.wall.side];
      dir = sd.tangent;
      centre = sidePoint(frame, o.wall.side, o.a, 0);
      facade = true;
    } else {
      const wall = o.wall;
      const room = b.rooms?.find((r) => r.id === wall.room);
      if (!room) return;
      const p0 = room.polygon[wall.edge % room.polygon.length];
      const p1 = room.polygon[(wall.edge + 1) % room.polygon.length];
      dir = norm([p1[0] - p0[0], p1[1] - p0[1]]);
      centre = [p0[0] + dir[0] * o.a, p0[1] + dir[1] * o.a];
    }
    const bottom = level.floor_h + o.sill;
    out.push({
      id: o.id ?? `opening-${i}`,
      kind: o.kind,
      source: 'catalogue',
      storey: o.storey,
      centre,
      dir,
      width: o.width,
      bottom_h: bottom,
      top_h: bottom + o.height,
      head: o.head ?? (o.kind === 'passage' ? 'round' : 'straight'),
      rooms,
      facade,
      tag: o.tag,
    });
  });
  return out;
}

export interface EdgeHit {
  opening: IOpening;
  hole: Hole;
  /** Perpendicular distance from the room edge to the opening's reference line (outwards). */
  depth: number;
}

export interface EdgeQuery {
  p0: ST;
  p1: ST;
  floor_h: number;
  top_h: number;
  /** Max distance from the edge to the opening line (outer wall ≈ 1.0-1.2 m). */
  maxDepth?: number;
}

/** Openings on one room edge (polygon CCW: the room lies to the left of p0 -> p1). */
export function holesForEdge(q: EdgeQuery, openings: IOpening[]): EdgeHit[] {
  const dx = q.p1[0] - q.p0[0];
  const dy = q.p1[1] - q.p0[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return [];
  const d: ST = [dx / len, dy / len];
  const nOut: ST = [d[1], -d[0]];
  const maxDepth = q.maxDepth ?? 1.45;
  const hits: EdgeHit[] = [];
  for (const o of openings) {
    const cross = Math.abs(o.dir[0] * d[1] - o.dir[1] * d[0]);
    if (cross > 0.02) continue;
    const rel: ST = [o.centre[0] - q.p0[0], o.centre[1] - q.p0[1]];
    const depth = rel[0] * nOut[0] + rel[1] * nOut[1];
    if (depth < -0.02 || depth > maxDepth) continue;
    const u = rel[0] * d[0] + rel[1] * d[1];
    const u0 = u - o.width / 2;
    const u1 = u + o.width / 2;
    if (u1 <= 0.05 || u0 >= len - 0.05) continue;
    if (o.top_h <= q.floor_h + 0.05 || o.bottom_h >= q.top_h - 0.05) continue;
    hits.push({
      opening: o,
      depth: Math.max(0, depth),
      hole: {
        u0: Math.max(0, u0),
        u1: Math.min(len, u1),
        v0: Math.max(0, o.bottom_h - q.floor_h),
        v1: Math.min(q.top_h, o.top_h) - q.floor_h,
        head: o.head,
        id: o.id,
        splay: o.facade && !WALK_KINDS.has(o.kind) ? revealSplay(Math.max(0, depth), o.head) : 0,
      },
    });
  }
  return hits;
}

/** Room edges as [p0, p1] pairs (CCW polygon). */
export function roomEdges(r: Pick<Room, 'polygon'>): [ST, ST][] {
  const p = r.polygon;
  return p.map((a, i) => [a, p[(i + 1) % p.length]] as [ST, ST]);
}

/**
 * Enfilade check: double doors of one storey that share a window-wall offset must lie on one
 * line. Returns, per storey and line (rounded t), the spread of their positions (m) - 0 = aligned.
 */
export function enfiladeSpread(openings: IOpening[], storey: number): { line: number; doors: number; spread: number }[] {
  const doors = openings.filter((o) => o.kind === 'double_door' && o.storey === storey && Math.abs(o.dir[0]) < 0.02);
  const groups = new Map<number, number[]>();
  for (const o of doors) {
    const key = Math.round(o.centre[1] * 2) / 2;
    const arr = groups.get(key) ?? [];
    arr.push(o.centre[1]);
    groups.set(key, arr);
  }
  return [...groups.entries()].map(([line, ts]) => ({ line, doors: ts.length, spread: Math.max(...ts) - Math.min(...ts) }));
}
