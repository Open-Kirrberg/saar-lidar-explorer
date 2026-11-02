/**
 * KB-I48 Festbeleuchtung: deterministic placement of the illumination lamps (pure, no three.js).
 *
 * Evidence: the 1785 wedding festivities had illuminations (Fürstenwärther 1786; research/01 §4.2) and the 1785
 * rotunda section marks lampions round the archivolts and along the cornice (research/10 §c.4) [D for the event and
 * the kind of light]. Period garden fêtes used thousands of small glass lamps along cornices, window sills, parterre
 * borders and basin rims (SPSG keeps 280 of them; look-and-period §5) [D->]. Which lines were lit at the Karlsberg and
 * how densely is not known: the arrangement here is a hypothesis [I] (UI label "Festbeleuchtung (Muster
 * 1785, auf 1789 übertragen; Hypothese)"). The dense rotunda rings stay with the 1785 fête rotunda KB-B13 in a 1785
 * scene (`festRotundaRings`). Spacings, heights and the colour range live in `FESTIVAL` (grammar.ts).
 *
 * Output is in the local frame (x = E − E0, y = h, z = −(N − N0)) with true heights (no exaggeration). Every lamp
 * carries the outward normal of the surface it stands on (a wall's horizontal normal, or +y on the ground), so the
 * viewer can throw a small light pool on that surface.
 */
import { enToLocal } from '../frame.ts';
import { type EN, isPlaced, type SiteSpec, type TerrainFeature } from '../spec.ts';
import type { BuildingLayout } from './building.ts';
import { inEpoch, SCENE_YEAR } from './epoch.ts';
import { sidePoint, stToLocal } from './footprint.ts';
import { hashString, mulberry32, pointInPolygon } from './geom.ts';
import { ARTICULATION, FESTIVAL } from './grammar.ts';
import { rotundaLayout } from './rotunda.ts';

export type FestLampKind = 'lampion' | 'pot';
/** Which line of the arrangement a lamp belongs to (for counts, tests and per-group A/B). */
export type FestLampGroup = 'cornice' | 'sill' | 'rotunda' | 'court' | 'parterre' | 'rim';

export interface FestLamp {
  /** Local position (m), the flame / glass centre. */
  p: [number, number, number];
  /** Outward unit normal of the surface the lamp stands on (wall: horizontal; ground / cornice top: +y). */
  n: [number, number, number];
  /** Unit normal of the nearest wall behind the lamp (for a pool on the facade), or null on open ground. */
  wall: [number, number, number] | null;
  kind: FestLampKind;
  group: FestLampGroup;
  /** Flame colour temperature (K), deterministic jitter within FESTIVAL.kelvin. */
  kelvin: number;
  /** Catalogue id of the building or feature it belongs to. */
  src: string;
}

export interface FestivalOptions {
  /** Scene year for `inEpoch` (KB-I03); a 1785 scene adds the 1785 rotunda KB-B13 when it is in the list. */
  year?: number;
  seed?: number;
}

type P2 = [number, number];

/** Signed area of a ring (shoelace), > 0 = counter-clockwise in the given axes. */
function signedArea(ring: readonly P2[]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
}

/** Open (drop the duplicate closing point) and return as P2. */
function openRing(ring: readonly (readonly number[])[]): P2[] {
  const r = ring.map((p) => [p[0], p[1]] as P2);
  if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  return r;
}

/** Distance from a point to a closed ring's boundary (EN). */
export function distanceToRing(p: P2, ring: readonly P2[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return best;
}

/**
 * Points every `spacing` m along a closed ring (EN), each with the ring's outward unit normal (EN), offset by `offset`
 * m along that normal (negative = inward). Corners get a lamp each; the spacing is stretched per edge so both ends of
 * an edge carry a lamp (a lit cornice reads as a continuous line that turns the corner).
 */
export function ringPoints(ring: readonly P2[], spacing: number, offset: number): { p: P2; n: P2 }[] {
  const r = openRing(ring);
  if (r.length < 3) return [];
  const ccw = signedArea([...r, r[0]]) > 0;
  const out: { p: P2; n: P2 }[] = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const n: P2 = ccw ? [dy / len, -dx / len] : [-dy / len, dx / len];
    const k = Math.max(1, Math.round(len / spacing));
    for (let j = 0; j < k; j++) {
      const t = j / k;
      out.push({ p: [a[0] + dx * t + n[0] * offset, a[1] + dy * t + n[1] * offset], n });
    }
  }
  return out;
}

/**
 * Whether a building carries the dense rotunda rings of the 1785 fête (wave-8 review): only the buildings named in
 * `FESTIVAL.rotunda.event`, only in a scene of the event's year, and only when their epoch contains that year. Every
 * other lit rotunda (the 1789 Tempelzimmer KB-B07) gets the ordinary cornice line and door lampions.
 */
export function festRotundaRings(b: { id: string; epoch?: { from?: number; to?: number } | null }, year: number = SCENE_YEAR): boolean {
  const ev = FESTIVAL.rotunda.event;
  return year === ev.year && ev.buildings.includes(b.id) && inEpoch(b.epoch, ev.year);
}

/** Local-frame vector of an EN direction (z = −N). */
const nLocal = (n: P2): [number, number, number] => [n[0], 0, -n[1]];

/**
 * The lamps of the Festbeleuchtung: cornice lines and window sills of the buildings in `FESTIVAL.buildings`, rings on
 * the 1785 rotunda's entablature and attic and round its openings (1785 scene only, `festRotundaRings`), pots-à-feu round the court(s), lampions on the parterre
 * borders and the basin rim. Unplaced buildings, hypothetical ones and anything outside the scene year are skipped.
 */
export function festivalLamps(spec: SiteSpec, layouts: readonly BuildingLayout[], opts: FestivalOptions = {}): FestLamp[] {
  const year = opts.year ?? SCENE_YEAR;
  const seed = opts.seed ?? 1785;
  const F = FESTIVAL;
  const lamps: FestLamp[] = [];
  const kelvinOf = (rnd: () => number) => F.kelvin[0] + (F.kelvin[1] - F.kelvin[0]) * rnd();
  const byId = new Map(layouts.map((L) => [L.id, L]));
  const lit = F.buildings
    .map((id) => byId.get(id))
    .filter((L): L is BuildingLayout => !!L && isPlaced(L.building) && L.building.placement !== 'hypothetical' && inEpoch(L.building.epoch, year));
  // every building footprint of the scene (EN rings): lamps falling inside one (a junction, a lean-to) are dropped
  // (hypothetical ones too: the viewer may show them)
  const rings: { id: string; ring: P2[] }[] = layouts
    .filter((L) => inEpoch(L.building.epoch, year))
    .map((L) => ({ id: L.id, ring: openRing(L.ring) }));
  const blocked = (p: P2, own: string | null, clear = 0): boolean =>
    rings.some((r) => r.id !== own && (pointInPolygon(p, r.ring) || (clear > 0 && distanceToRing(p, r.ring) < clear)));
  const push = (pEN: P2, h: number, n: [number, number, number], wall: [number, number, number] | null, kind: FestLampKind, group: FestLampGroup, src: string, rnd: () => number) => {
    const l = enToLocal(pEN[0], pEN[1], h);
    lamps.push({ p: [l.x, l.y, l.z], n, wall, kind, group, kelvin: kelvinOf(rnd), src });
  };

  for (const L of lit) {
    const rnd = mulberry32(hashString(`fest:${L.id}`) ^ seed);
    const ro = rotundaLayout(L);
    if (ro && !festRotundaRings(L.building, year)) {
      // a rotunda outside the 1785 fête: one cornice line on the attic top (the eaves) and a pair of lampions at the
      // foot of each glazed door, as the sills of the other buildings [I]
      const f = L.frame;
      const o = stToLocal(f, 0, 0, 0);
      const own = openRing(L.ring);
      const hC = L.stack.eaves_h + F.cornice.lift;
      const rC = ro.radius + F.rotunda.out * 0.5;
      const k = Math.max(8, Math.round((2 * Math.PI * rC) / F.cornice.spacing));
      for (let j = 0; j < k; j++) {
        const a = (2 * Math.PI * j) / k;
        const p = stToLocal(f, rC * Math.cos(a), rC * Math.sin(a), hC);
        const en: P2 = [p.x + 381000, -p.z + 5465000];
        if (pointInPolygon(en, own) || blocked(en, L.id, 0.3)) continue;
        const nn = stToLocal(f, Math.cos(a), Math.sin(a), 0);
        lamps.push({ p: [p.x, p.y, p.z], n: [0, 1, 0], wall: [nn.x - o.x, 0, nn.z - o.z], kind: 'lampion', group: 'cornice', kelvin: kelvinOf(rnd), src: L.id });
      }
      for (const bay of ro.bays) {
        const op = bay.opening;
        if (bay.kind !== 'door' || !(op.top_h > op.bottom_h)) continue;
        const c: P2 = [Math.cos(bay.angle), Math.sin(bay.angle)];
        const tg: P2 = [-c[1], c[0]];
        const r = ro.radius + F.sill.out;
        const nn = stToLocal(f, c[0], c[1], 0);
        const nw: [number, number, number] = [nn.x - o.x, 0, nn.z - o.z];
        for (const side of [-1, 1]) {
          const u = side * op.width * F.sill.across;
          const p = stToLocal(f, c[0] * r + tg[0] * u, c[1] * r + tg[1] * u, op.bottom_h + F.sill.lift);
          const en: P2 = [p.x + 381000, -p.z + 5465000];
          if (blocked(en, L.id)) continue;
          lamps.push({ p: [p.x, p.y, p.z], n: [0, 1, 0], wall: nw, kind: 'lampion', group: 'sill', kelvin: kelvinOf(rnd), src: L.id });
        }
      }
      continue;
    }
    if (ro) {
      // the rotunda: rings on the entablature and on the attic top, and round each bay's opening (archivolt + jambs)
      const f = L.frame;
      const ring = (r: number, h: number, step: number) => {
        const k = Math.max(8, Math.round((2 * Math.PI * r) / step));
        for (let j = 0; j < k; j++) {
          const a = (2 * Math.PI * j) / k;
          const [s, t] = [r * Math.cos(a), r * Math.sin(a)];
          const p = stToLocal(f, s, t, h);
          const nn = stToLocal(f, Math.cos(a), Math.sin(a), 0);
          const o = stToLocal(f, 0, 0, 0);
          const nx = nn.x - o.x;
          const nz = nn.z - o.z;
          lamps.push({ p: [p.x, p.y, p.z], n: [0, 1, 0], wall: [nx, 0, nz], kind: 'lampion', group: 'rotunda', kelvin: kelvinOf(rnd), src: L.id });
        }
      };
      ring(ro.radius + F.rotunda.out, ro.order.entablature[1] + F.cornice.lift, F.rotunda.spacing);
      ring(ro.radius + F.rotunda.out * 0.5, ro.attic[1] + F.cornice.lift, F.rotunda.spacing);
      for (const bay of ro.bays) {
        const op = bay.opening;
        if (!(op.top_h > op.bottom_h)) continue;
        const r = ro.radius + F.rotunda.out;
        const halfW = op.width / 2 + F.rotunda.reveal;
        // jambs (bottom + 1 m up to the head) and a semicircular line over the head
        const pts: [number, number][] = []; // [offset along the tangent (m), height]
        for (let h = op.bottom_h + 1; h < op.top_h - 0.2; h += F.rotunda.spacing) pts.push([-halfW, h], [halfW, h]);
        const k = Math.max(4, Math.round((Math.PI * halfW) / F.rotunda.spacing));
        for (let j = 0; j <= k; j++) {
          const a = Math.PI * (j / k);
          pts.push([-halfW * Math.cos(a), op.top_h + halfW * 0.35 * Math.sin(a)]);
        }
        const c = [Math.cos(bay.angle), Math.sin(bay.angle)];
        const tg = [-c[1], c[0]];
        for (const [u, h] of pts) {
          const s = c[0] * r + tg[0] * u;
          const t = c[1] * r + tg[1] * u;
          const p = stToLocal(f, s, t, h);
          const nn = stToLocal(f, c[0], c[1], 0);
          const o = stToLocal(f, 0, 0, 0);
          lamps.push({ p: [p.x, p.y, p.z], n: [nn.x - o.x, 0, nn.z - o.z], wall: [nn.x - o.x, 0, nn.z - o.z], kind: 'lampion', group: 'rotunda', kelvin: kelvinOf(rnd), src: L.id });
        }
      }
      continue;
    }
    // cornice line: on the top of the main cornice, along the real footprint (risalits included)
    const corn = L.members.cornice;
    const h = L.stack.eaves_h + F.cornice.lift;
    // the 1785 event rotunda without a modelled order (KB-B13: footprint and dome only) keeps its dense ring on the cornice
    const evRing = festRotundaRings(L.building, year);
    for (const { p, n } of ringPoints(openRing(L.ring), evRing ? F.rotunda.spacing : F.cornice.spacing, Math.max(0.1, corn.projection - F.cornice.inset))) {
      if (blocked(p, L.id, 0.3)) continue;
      push(p, h, [0, 1, 0], nLocal(n), 'lampion', evRing ? 'rotunda' : 'cornice', L.id, rnd);
    }
    // window sills: two lampions on every main-storey window and porte-fenêtre (not the plinth, attic or roof)
    if (L.frame.shape === 'round') continue;
    const o0 = stToLocal(L.frame, 0, 0, 0);
    for (const o of L.openings) {
      if (o.kind !== 'window' && o.kind !== 'porte_fenetre') continue;
      if (!o.row) continue;
      const sd = L.frame.sides[o.side];
      const ris = L.sides[o.side]?.risalits.find((r) => o.a >= r.a0 && o.a <= r.a1);
      const wallOut = ris ? (ris.risalit.projection ?? ARTICULATION.risalitProjection) : 0;
      const n1 = stToLocal(L.frame, sd.normal[0], sd.normal[1], 0);
      const nw: [number, number, number] = [n1.x - o0.x, 0, n1.z - o0.z];
      for (const side of [-1, 1]) {
        const [s, t] = sidePoint(L.frame, o.side, o.a + side * o.width * F.sill.across, -(wallOut + F.sill.out));
        const pl = stToLocal(L.frame, s, t, o.bottom_h + F.sill.lift);
        const en: P2 = [pl.x + 381000, -pl.z + 5465000];
        if (blocked(en, L.id)) continue;
        lamps.push({ p: [pl.x, pl.y, pl.z], n: [0, 1, 0], wall: nw, kind: 'lampion', group: 'sill', kelvin: kelvinOf(rnd), src: L.id });
      }
    }
  }

  const feature = (id: string): TerrainFeature | undefined => spec.terrain_features.find((t) => t.id === id);
  const polygonOf = (t: TerrainFeature | undefined): P2[] | null => (t && t.geometry.type === 'Polygon' ? openRing(t.geometry.coordinates[0] as EN[]) : null);
  const featureOk = (t: TerrainFeature | undefined): t is TerrainFeature => !!t && t.placement !== 'hypothetical' && inEpoch(t.epoch, year);
  // pots-à-feu on posts round the court, kept clear of the building faces
  for (const id of F.court.features) {
    const t = feature(id);
    const ring = polygonOf(t);
    if (!featureOk(t) || !ring || typeof t.level !== 'number') continue;
    const rnd = mulberry32(hashString(`fest:${id}`) ^ seed);
    for (const { p } of ringPoints(ring, F.court.spacing, -F.court.inset)) {
      if (blocked(p, null, F.court.clear)) continue;
      push(p, t.level + F.court.height, [0, 1, 0], null, 'pot', 'court', id, rnd);
    }
  }
  // lampions on the ground along the parterre borders
  for (const id of F.parterre.features) {
    const t = feature(id);
    const ring = polygonOf(t);
    if (!featureOk(t) || !ring || typeof t.level !== 'number') continue;
    const rnd = mulberry32(hashString(`fest:${id}`) ^ seed);
    for (const { p } of ringPoints(ring, F.parterre.spacing, -F.parterre.inset)) {
      if (blocked(p, null, F.parterre.clear)) continue;
      push(p, t.level + F.parterre.height, [0, 1, 0], null, 'lampion', 'parterre', id, rnd);
    }
  }
  // lampions on the basin coping
  for (const id of F.rim.features) {
    const t = feature(id);
    const ring = polygonOf(t);
    const level = t?.water_level ?? t?.level;
    if (!featureOk(t) || !ring || typeof level !== 'number') continue;
    const rnd = mulberry32(hashString(`fest:${id}`) ^ seed);
    for (const { p } of ringPoints(ring, F.rim.spacing, F.rim.out)) push(p, level + F.rim.lift, [0, 1, 0], null, 'lampion', 'rim', id, rnd);
  }
  return lamps;
}

/** Lamps per group (status line, tests). */
export function festivalCounts(lamps: readonly FestLamp[]): Record<FestLampGroup, number> {
  const c: Record<FestLampGroup, number> = { cornice: 0, sill: 0, rotunda: 0, court: 0, parterre: 0, rim: 0 };
  for (const l of lamps) c[l.group]++;
  return c;
}
