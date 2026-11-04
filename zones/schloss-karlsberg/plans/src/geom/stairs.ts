/**
 * Stairs for the plans = the interiors' stair planner (model/src/interior/stairPlan.ts, pure),
 * called with the same inputs the 3D interior uses (hall polygon, rise between the storey
 * floors, walk-through openings at the hall), so drawn flights and modelled flights agree.
 * This adapter is the only place the plans touch stair geometry.
 */
import type { BuildingLayout } from '../../../model/src/layout/building.ts';
import { WALK_KINDS, collectOpenings } from '../../../model/src/interior/openings.ts';
import { interiorModel } from '../../../model/src/interior/model.ts';
import { type Flight, type StairDoor, type StairPlan, flightGoing, hallRect, planKey, planStair } from '../../../model/src/interior/stairPlan.ts';
import type { Building, ST, Stair } from '../../../model/src/spec.ts';

export type { Flight, StairPlan };

const cache = new WeakMap<Building, Map<string, StairPlan>>();

/** Plans of all stairs of a building (memoised per Building object). */
export function stairPlans(b: Building, L: BuildingLayout): Map<string, StairPlan> {
  const hit = cache.get(b);
  if (hit) return hit;
  const out = new Map<string, StairPlan>();
  const ops = collectOpenings(b, L).filter((o) => WALK_KINDS.has(o.kind));
  const sorted = [...(b.stairs ?? [])].sort((x, y) => x.storey_from - y.storey_from);
  for (const st of sorted) {
    const h0 = L.stack.levels[st.storey_from].floor_h;
    const h1 = L.stack.levels[st.storey_to].floor_h;
    const hall = hallRect(st.polygon);
    const doors: StairDoor[] = ops
      .filter((o) => o.storey >= st.storey_from && o.storey <= st.storey_to)
      .filter((o) => o.centre[0] >= hall.s0 - 1.2 && o.centre[0] <= hall.s1 + 1.2 && o.centre[1] >= hall.t0 - 1.2 && o.centre[1] <= hall.t1 + 1.2)
      .map((o) => ({ id: o.id, centre: o.centre, width: o.width, bottom_h: o.bottom_h }));
    // a stair stacked on the same hall reuses the configuration of the one below
    const below = sorted.find((x) => x.storey_to === st.storey_from && sameHall(x, st));
    const prefer = below ? planKey(out.get(below.id)!) : undefined;
    out.set(st.id, planStair({ stair: st, h0, h1, doors, prefer }));
  }
  cache.set(b, out);
  return out;
}

function sameHall(a: Stair, b: Stair): boolean {
  const p = hallRect(a.polygon);
  const q = hallRect(b.polygon);
  return Math.abs(p.s0 - q.s0) + Math.abs(p.s1 - q.s1) + Math.abs(p.t0 - q.t0) + Math.abs(p.t1 - q.t1) < 0.05;
}

/** Nosing lines of a flight, bottom to top (one per riser). */
export function nosings(f: Flight): [ST, ST][] {
  const n: ST = [-f.dir[1], f.dir[0]];
  const out: [ST, ST][] = [];
  for (let i = 0; i < f.risers; i++) {
    const c: ST = [f.start[0] + f.dir[0] * i * f.tread, f.start[1] + f.dir[1] * i * f.tread];
    out.push([
      [c[0] + (n[0] * f.width) / 2, c[1] + (n[1] * f.width) / 2],
      [c[0] - (n[0] * f.width) / 2, c[1] - (n[1] * f.width) / 2],
    ]);
  }
  return out;
}

/** Plan outline of a flight (4 corners). */
export function flightPoly(f: Flight): ST[] {
  const L = flightGoing(f.risers, f.tread);
  const n: ST = [-f.dir[1], f.dir[0]];
  const w = f.width / 2;
  const p = (x: number, k: number): ST => [f.start[0] + f.dir[0] * x + n[0] * k * w, f.start[1] + f.dir[1] * x + n[1] * k * w];
  return [p(0, 1), p(0, -1), p(L, -1), p(L, 1)];
}

/** Walk line of a flight (centre, first to last nosing). */
export function flightWalk(f: Flight): [ST, ST] {
  const L = flightGoing(f.risers, f.tread);
  return [f.start, [f.start[0] + f.dir[0] * L, f.start[1] + f.dir[1] * L]];
}

const colCache = new WeakMap<Building, Map<number, ST[]>>();

/**
 * Free-standing columns per storey, read from the interiors' room programme (interiorModel, pure) so that the
 * plan shows exactly the columns the 3D vestibule has (fix round 1, review-1 #19).
 */
export function columnsOf(b: Building, L: BuildingLayout, storey: number): ST[] {
  let m = colCache.get(b);
  if (!m) {
    m = new Map();
    for (const r of interiorModel(b, L).rooms) {
      for (const it of r.items) {
        if (it.kind !== 'column') continue;
        const s = r.room.storey;
        if (!m.has(s)) m.set(s, []);
        m.get(s)!.push(it.pos);
      }
    }
    colCache.set(b, m);
  }
  return m.get(storey) ?? [];
}
