/**
 * Site builder (exterior + viewer package): buildSite(spec, ctx) -> { group, colliders, pois }.
 * Buildings (buildExterior at ctx.lod) + terrain features (features.ts) + POIs (German labels).
 */
import * as THREE from 'three';
import type { BuildSiteFn } from '../api.ts';
import type { BuildContext, Poi } from '../context.ts';
import { E0, N0 } from '../frame.ts';
import { stToEN } from '../layout/footprint.ts';
import type { SiteSpec } from '../spec.ts';
import { buildExterior } from '../exterior/index.ts';
import { buildFeatures } from './features.ts';
import { ENTRANCE_POI_DIST, entranceWalkable, siteBuildings, siteEntrances, siteWalls } from './access.ts';

export { siteBuildings };

const ROOM_POI = /Vestib|Prunktreppe|Festsaal|Speisesaal|Bibliothek|Bildergalerie|Pfeilersaal|Hofküche|Paradeschlaf|Audienzzimmer$|Waffensammlung/;

/**
 * POIs: one per placed building (view from the court side), one per portal / Durchfahrt (entrance, with `walkable`
 * from access.ts: can a walker get from the POI to the threshold past the generated walls?), plus named views.
 */
export function sitePois(spec: SiteSpec, ctx: BuildContext): Poi[] {
  const pois: Poi[] = [];
  const entrances = new Map(siteEntrances(spec, ctx).map((e) => [e.id, e]));
  const walls = siteWalls(spec, ctx.terrain, [...entrances.values()]);
  for (const b of siteBuildings(spec, ctx)) {
    let L;
    try {
      L = ctx.layout(b);
    } catch {
      continue;
    }
    const f = L.frame;
    const dist = Math.max(25, f.length * 0.9);
    const [Ec, Nc] = stToEN(f, [0, 0]);
    const [Ev, Nv] = stToEN(f, [0, f.width / 2 + dist]);
    const look = { x: Ec - E0, y: (L.stack.base_h + L.stack.eaves_h) / 2, z: -(Nc - N0) };
    const gx = Ev - E0;
    const gz = -(Nv - N0);
    const gh = ctx.terrain(gx, gz);
    pois.push({
      id: b.id,
      name_de: b.name_de.split(/[(–]/)[0].trim(),
      kind: 'building',
      position: { x: gx, y: (Number.isFinite(gh) ? gh : L.stack.base_h) + Math.max(12, (L.stack.eaves_h - L.stack.base_h) * 1.4), z: gz },
      lookAt: look,
      buildingId: b.id,
      confidence: b.confidence,
      text_de: b.function,
    });
    // state rooms / halls as walk-in POIs (room centre, eye height above the room floor)
    for (const r of b.rooms ?? []) {
      if (!ROOM_POI.test(r.name_de) || /Austritt|Dienertreppe/.test(r.name_de)) continue;
      const lvl = L.stack.levels[r.storey];
      if (!lvl) continue;
      const n = r.polygon.length;
      const cs = r.polygon.reduce((a, p) => a + p[0], 0) / n;
      const ct = r.polygon.reduce((a, p) => a + p[1], 0) / n;
      const ext = Math.max(...r.polygon.map((p) => p[0])) - Math.min(...r.polygon.map((p) => p[0]));
      const p0 = stToEN(f, [cs - Math.min(ext / 2 - 0.8, 6), ct]);
      const p1 = stToEN(f, [cs + 10, ct]);
      const fh = r.floor_h ?? lvl.floor_h;
      pois.push({
        id: `${b.id}/${r.id}`,
        name_de: `${r.name_de.split(' (')[0]} (${b.name_de.split(/[(–]/)[0].trim()})`,
        kind: 'room',
        position: { x: p0[0] - E0, y: fh + 1.65, z: -(p0[1] - N0) },
        lookAt: { x: p1[0] - E0, y: fh + 1.9, z: -(p1[1] - N0) },
        buildingId: b.id,
        roomId: r.id,
        confidence: b.confidence,
        tags: r.tag,
      });
    }
    for (const o of L.openings) {
      if (o.kind !== 'portal' && o.kind !== 'durchfahrt') continue;
      const sd = f.sides[o.side];
      const pIn = [sd.p0[0] + sd.tangent[0] * o.a, sd.p0[1] + sd.tangent[1] * o.a];
      const [Eo, No] = stToEN(f, [pIn[0] + sd.normal[0] * ENTRANCE_POI_DIST, pIn[1] + sd.normal[1] * ENTRANCE_POI_DIST]);
      const [Ei, Ni] = stToEN(f, [pIn[0] - sd.normal[0] * 4, pIn[1] - sd.normal[1] * 4]);
      const x = Eo - E0;
      const z = -(No - N0);
      const gh2 = ctx.terrain(x, z);
      const id = `${b.id}/${o.kind}-${o.side}-${o.axis}`;
      const ent = entrances.get(id);
      pois.push({
        id,
        name_de: `${b.name_de.split(/[(–]/)[0].trim()} – ${o.kind === 'portal' ? 'Portal' : 'Durchfahrt'} (${o.side === 'court' ? 'Hofseite' : o.side === 'garden' ? 'Gartenseite' : 'Stirnseite'})`,
        kind: 'entrance',
        position: { x, y: (Number.isFinite(gh2) ? gh2 : L.stack.base_h) + 1.65, z },
        lookAt: { x: Ei - E0, y: o.bottom_h + 1.6, z: -(Ni - N0) },
        buildingId: b.id,
        confidence: b.confidence,
        walkable: ent ? entranceWalkable(ent, [x, z], walls, ctx.terrain) : undefined,
      });
    }
  }
  return pois;
}

export const buildSite: BuildSiteFn = (spec, ctx) => {
  const group = new THREE.Group();
  group.name = 'site';
  group.userData = { part: 'site', lod: ctx.lod };
  const colliders: THREE.Mesh[] = [];
  const buildings = new THREE.Group();
  buildings.name = 'site/buildings';
  group.add(buildings);
  for (const b of siteBuildings(spec, ctx)) {
    try {
      const g = buildExterior(b, ctx);
      buildings.add(g);
    } catch (e) {
      console.warn(`[site] ${b.id}:`, e);
    }
  }
  const feat = buildFeatures(spec, ctx);
  group.add(feat.group);
  colliders.push(...feat.colliders);
  return { group, colliders, pois: sitePois(spec, ctx) };
};
