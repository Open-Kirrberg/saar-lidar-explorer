/**
 * Room-programme helpers (pure): piles across the depth, enfilades along the length,
 * aligned enfilade doors. All coordinates in building-local [s, t] metres.
 *
 * Typical use (CdL Beletage, research/05 §e.1):
 *   const piles = pileBands(frame.width, { outerWall: 1.0, spineWall: 0.6, courtPileClear: 6 });
 *   const garden = piles.find(p => p.name === 'garden')!;
 *   const widths = widthsBetweenAxes(axisS, [2, 2, 3, 2, 1], s0, s1);   // partitions on piers
 *   const { rooms, partitions } = enfiladeRooms({ storey: 2, s0, direction: 1, band: garden,
 *                                                 items: programme.map((r, i) => ({ ...r, width: widths[i] })) });
 *   const doors = enfiladeDoors(partitions, { storey: 2, windowWallT: garden.t0, into: +1 });
 */
import type { Finish, Opening, PolygonST, Room } from '../spec.ts';
import { INTERIOR_DOOR, PARTITION_WALL, SPINE_WALL } from './grammar.ts';

export interface PileBand {
  name: 'court' | 'garden' | 'corridor' | 'single';
  /** Clear interior range along t (t0 < t1). */
  t0: number;
  t1: number;
}

export interface PileOptions {
  outerWall: number;
  /** Spine (bearing) wall thickness; default grammar SPINE_WALL. */
  spineWall?: number;
  layout?: 'single' | 'double' | 'double_corridor';
  /** Clear depth of the court pile (double / double_corridor). Default: half of the clear depth. */
  courtPileClear?: number;
  /** Corridor clear width (double_corridor). Default 2.2 m [N]. */
  corridorClear?: number;
}

/**
 * Split the building depth (t from −W/2 garden to +W/2 court) into clear pile bands.
 * Returned bands are ordered garden -> court.
 */
export function pileBands(width: number, o: PileOptions): PileBand[] {
  const tg = -width / 2 + o.outerWall; // inner face of the garden wall
  const tc = width / 2 - o.outerWall; // inner face of the court wall
  const spine = o.spineWall ?? SPINE_WALL;
  const layout = o.layout ?? 'double';
  if (layout === 'single') return [{ name: 'single', t0: tg, t1: tc }];
  const clear = tc - tg;
  if (layout === 'double') {
    const court = o.courtPileClear ?? (clear - spine) / 2;
    const garden = clear - spine - court;
    if (garden <= 0) throw new Error('pileBands: court pile too deep');
    return [
      { name: 'garden', t0: tg, t1: tg + garden },
      { name: 'court', t0: tc - court, t1: tc },
    ];
  }
  const corridor = o.corridorClear ?? 2.2;
  const rest = clear - corridor - 2 * spine;
  const court = o.courtPileClear ?? rest / 2;
  const garden = rest - court;
  if (garden <= 0) throw new Error('pileBands: piles do not fit');
  return [
    { name: 'garden', t0: tg, t1: tg + garden },
    { name: 'corridor', t0: tg + garden + spine, t1: tg + garden + spine + corridor },
    { name: 'court', t0: tc - court, t1: tc },
  ];
}

export interface ProgrammeItem {
  id: string;
  name_de: string;
  function?: string;
  /** Clear width along s (m). */
  width: number;
  finish?: Finish;
  tag: string;
}

export interface Partition {
  /** Wall centre line along s. */
  s: number;
  t0: number;
  t1: number;
  thickness: number;
  between: [string, string];
}

export interface EnfiladeInput {
  storey: number;
  /** Start of the first room (inner wall face), along s. */
  s0: number;
  /** +1: rooms follow towards +s; −1 towards −s. */
  direction: 1 | -1;
  band: Pick<PileBand, 't0' | 't1'>;
  items: ProgrammeItem[];
  /** Partition thickness (default grammar PARTITION_WALL; use SPINE_WALL for bearing cross walls). */
  partition?: number;
  floor_h?: number;
  ceiling_h?: number;
}

/** Lay rooms side by side along s within a pile band. */
export function enfiladeRooms(inp: EnfiladeInput): { rooms: Room[]; partitions: Partition[]; end: number } {
  const wall = inp.partition ?? PARTITION_WALL;
  const rooms: Room[] = [];
  const partitions: Partition[] = [];
  let s = inp.s0;
  inp.items.forEach((it, i) => {
    const a = s;
    const b = s + inp.direction * it.width;
    const s0 = Math.min(a, b);
    const s1 = Math.max(a, b);
    const polygon: PolygonST = [
      [s0, inp.band.t0],
      [s1, inp.band.t0],
      [s1, inp.band.t1],
      [s0, inp.band.t1],
    ];
    rooms.push({
      id: it.id,
      name_de: it.name_de,
      function: it.function,
      storey: inp.storey,
      polygon,
      floor_h: inp.floor_h,
      ceiling_h: inp.ceiling_h,
      finish: it.finish,
      tag: it.tag,
    });
    s = b;
    if (i < inp.items.length - 1) {
      partitions.push({
        s: s + (inp.direction * wall) / 2,
        t0: inp.band.t0,
        t1: inp.band.t1,
        thickness: wall,
        between: [it.id, inp.items[i + 1].id],
      });
      s += inp.direction * wall;
    }
  });
  return { rooms, partitions, end: s };
}

export interface EnfiladeDoorOptions {
  storey: number;
  /** t of the inner face of the window wall. */
  windowWallT: number;
  /** Direction from the window wall into the rooms along t: +1 or −1. */
  into: 1 | -1;
  /** Distance from the window wall to the near jamb (default 1.25 m [N] 02 §2.11). */
  offset?: number;
  width?: number;
  height?: number;
  tag?: string;
}

/**
 * Doors of an enfilade: one per partition, all on ONE line parallel to the window wall
 * (`offset` + width/2 from it). Wall ref = the partition segment, `a` from its p0 (t0 end).
 */
export function enfiladeDoors(partitions: Partition[], o: EnfiladeDoorOptions): Opening[] {
  const width = o.width ?? INTERIOR_DOOR.enfilade.width;
  const height = o.height ?? INTERIOR_DOOR.enfilade.height;
  const lineT = o.windowWallT + o.into * ((o.offset ?? INTERIOR_DOOR.offsetFromWindowWall) + width / 2);
  return partitions.map((p, i) => ({
    id: `door-${p.between[0]}-${p.between[1]}`,
    kind: 'double_door',
    storey: o.storey,
    wall: { kind: 'segment', p0: [p.s, p.t0], p1: [p.s, p.t1], rooms: p.between },
    a: lineT - p.t0,
    width,
    height,
    sill: 0,
    head: 'straight',
    tag: o.tag ?? `${INTERIOR_DOOR.enfilade.tag}; enfilade line (door ${i + 1})`,
  }));
}

/**
 * Room widths so that partitions fall on the pier centres between window axes.
 * `axisS` = s-coordinates of the axes (ascending), `counts` = axes per room (sum = axisS.length),
 * s0/s1 = inner faces of the end walls. Partition thickness is subtracted from the clear widths.
 */
export function widthsBetweenAxes(axisS: number[], counts: number[], s0: number, s1: number, partition = PARTITION_WALL): number[] {
  const n = counts.reduce((s, c) => s + c, 0);
  if (n !== axisS.length) throw new Error(`widthsBetweenAxes: counts sum ${n} != axes ${axisS.length}`);
  const cuts: number[] = [s0];
  let k = 0;
  for (let i = 0; i < counts.length - 1; i++) {
    k += counts[i];
    cuts.push((axisS[k - 1] + axisS[k]) / 2);
  }
  cuts.push(s1);
  return counts.map((_, i) => {
    const left = i === 0 ? cuts[0] : cuts[i] + partition / 2;
    const right = i === counts.length - 1 ? cuts[i + 1] : cuts[i + 1] - partition / 2;
    return right - left;
  });
}

/** Axis s-coordinates of a facade side (garden runs +s, court runs −s) sorted ascending. */
export function axisSCoordinates(bayAs: number[], side: 'garden' | 'court', length: number): number[] {
  const s = bayAs.map((a) => (side === 'garden' ? -length / 2 + a : length / 2 - a));
  return s.sort((x, y) => x - y);
}

/** Rectangle polygon helper (CCW) in [s, t]. */
export function rectST(s0: number, s1: number, t0: number, t1: number): PolygonST {
  return [
    [Math.min(s0, s1), Math.min(t0, t1)],
    [Math.max(s0, s1), Math.min(t0, t1)],
    [Math.max(s0, s1), Math.max(t0, t1)],
    [Math.min(s0, s1), Math.max(t0, t1)],
  ];
}

/** Clear area of a room polygon (m²). */
export function roomArea(r: Pick<Room, 'polygon'>): number {
  const p = r.polygon;
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % p.length];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a / 2);
}
