/**
 * Interiors (LOD2): walkable Louis-seize rooms of summer 1789 from the catalogue v2 room
 * programme - see docs/architecture.md §5.
 *
 * buildInterior(b, ctx) returns the building group (position = frame.originLocal,
 * rotation.y = frame.rotationY, children in (s, h, −t)), named `<id>/interior`, with
 *   userData.colliders : THREE.Mesh[]  invisible walk colliders (floors, walls with open doorways,
 *                                      one inclined ramp per stair flight, landing tops, rail fences)
 *   userData.lights    : THREE.PointLight[] (few: at most 4 per building; candles are emissive)
 *   userData.pois      : Poi[] (room walk-start points in the local frame)
 *   userData.stats     : { triangles, meshes, instances }
 *   userData.warnings  : string[]
 * Every mesh carries { buildingId, part, lod, roomId, name_de, evidence, tag }; instanced
 * furniture carries userData.instances[instanceId] = { roomId, name_de, evidence, tag }.
 * Empty group for interior 'none', unplaced buildings, hidden hypothetical ones and lod < 2.
 */
import * as THREE from 'three';
import type { BuildInteriorFn } from '../api.ts';
import { isPlaced } from '../spec.ts';
import { buildFixture } from './fixtures.ts';
import { InstanceRegistry } from './furniture.ts';
import { Tints } from './materials.ts';
import { Accumulator, ColliderBucket, O, type PartInfo, placeMatrix } from './mesh.ts';
import { interiorModel } from './model.ts';
import { INSTANCED_KINDS, type InstancedKind } from './programme.ts';
import { buildShell } from './shell.ts';
import { buildStair } from './stairs3d.ts';

export const buildInterior: BuildInteriorFn = (b, ctx) => {
  const g = new THREE.Group();
  g.name = `${b.id}/interior`;
  g.userData = { buildingId: b.id, part: 'interior', lod: ctx.lod, colliders: [], lights: [], pois: [], warnings: [], stats: { triangles: 0, meshes: 0, instances: 0 } };
  if (b.interior === 'none' || !isPlaced(b) || ctx.lod < 2) return g;
  if (b.placement === 'hypothetical' && !ctx.options.showHypothetical) return g;
  if (b.cls === 'WALL' || b.cls === 'FARM_GROUP' || b.cls === 'GARD') return g;

  const layout = ctx.layout(b);
  g.position.set(layout.frame.originLocal.x, 0, layout.frame.originLocal.z);
  g.rotation.y = layout.frame.rotationY;

  // same terrain cull of facade openings as the exterior (exterior/facade.ts) - one hole list for both
  const model = interiorModel(b, layout, ctx.options.seed, (E, N) => ctx.terrain(E - 381000, 5465000 - N));
  const lib = ctx.materials;
  const tints = new Tints(lib);
  const acc = new Accumulator();
  const col = new ColliderBucket();
  const inst = new InstanceRegistry(b.id, lib, tints);
  const leavesDone = new Set<string>();

  for (const r of model.rooms) {
    buildShell({
      buildingId: b.id,
      room: r.room,
      type: r.type,
      grade: r.grade,
      walls: r.walls,
      floor_h: r.floor_h,
      ceiling_h: r.ceiling_h,
      wall_top: r.wall_top,
      floorRects: r.floorRects,
      ceilingRects: r.ceilingRects,
      vault: r.vault,
      evidence: r.evidence,
      acc,
      lib,
      tints,
      col,
      leavesDone,
    });

    // furnishing
    const columns: [number, number][] = [];
    for (const it of r.items) {
      const info = { roomId: r.room.id, name_de: it.name_de, evidence: it.evidence, tag: it.tag };
      if (INSTANCED_KINDS.has(it.kind)) {
        const k = it.kind as InstancedKind;
        const sc = it.size && (k === 'chandelier' || k === 'lantern') ? it.size[0] : 1;
        inst.add(k, placeMatrix(it.pos, r.floor_h + (it.z ?? 0), it.facing, [sc, sc, sc]), info, r.colour);
        if (k === 'chandelier' || k === 'lantern') {
          // suspension rod to the ceiling
          const topH = r.floor_h + (it.z ?? 0) + (k === 'lantern' ? 2.4 : 1.05) * sc;
          if (r.ceiling_h - topH > 0.05) {
            const rod = acc.get(lib.get('metal.gilt'), { buildingId: b.id, roomId: r.room.id, name_de: it.name_de, evidence: it.evidence, tag: it.tag, element: 'leuchter' });
            rod.geometry(new THREE.CylinderGeometry(0.012, 0.012, r.ceiling_h - topH, 5), new THREE.Matrix4().makeTranslation(it.pos[0], (topH + r.ceiling_h) / 2, -it.pos[1]));
          }
        }
      } else {
        buildFixture(it, { acc, lib, tints, buildingId: b.id, roomId: r.room.id, floor_h: r.floor_h, ceiling_h: r.ceiling_h, colour: r.colour, state: r.grade === 'state' });
        if (it.kind === 'column') {
          columns.push(it.pos);
          col.box([it.pos[0] - 0.36, r.floor_h, -it.pos[1] - 0.36], [it.pos[0] + 0.36, r.floor_h + 2.5, -it.pos[1] + 0.36]);
        }
      }
    }
    // architraves over the column rows of the vestibule
    if (columns.length) {
      const info: PartInfo = { buildingId: b.id, roomId: r.room.id, name_de: 'Architrav über den Säulen', evidence: 'I N', tag: 'I 05 §e.1 columned vestibule; architrave N', element: 'column' };
      const ab = acc.get(lib.get('stone.grey'), info);
      const ss = r.room.polygon.map((p) => p[0]);
      const ts = r.room.polygon.map((p) => p[1]);
      const rowsS = [...new Set(columns.map((c) => c[0].toFixed(2)))];
      const rowsT = [...new Set(columns.map((c) => c[1].toFixed(2)))];
      const h1 = r.ceiling_h;
      const h0 = h1 - 0.45;
      if (rowsS.length <= rowsT.length) {
        // rows run along t (one per distinct s)
        for (const sv of rowsS) {
          const centreS = columns.filter((c) => c[0].toFixed(2) === sv).reduce((a, c) => a + c[0], 0) / columns.filter((c) => c[0].toFixed(2) === sv).length;
          ab.box([centreS - 0.36, h0, -Math.max(...ts)], [centreS + 0.36, h1, -Math.min(...ts)], undefined, ['+y']);
        }
      } else {
        for (const tv of rowsT) {
          const t = Number(tv);
          ab.box([Math.min(...ss), h0, -t - 0.36], [Math.max(...ss), h1, -t + 0.36], undefined, ['+y']);
        }
      }
    }
  }

  for (const s of model.stairs) {
    buildStair({ buildingId: b.id, roomId: s.roomId, name_de: s.name_de, plan: s.plan, evidence: s.evidence, tag: s.tag, prunk: s.prunk, upperByRoom: s.upperByRoom, acc, lib, tints, col });
  }
  for (const st of model.stoops) {
    const plan = { id: st.flight.id, kind: 'dogleg' as const, riser: st.flight.riser, tread: st.flight.tread, risers: st.flight.risers, h0: st.flight.h0, h1: st.h, flights: [st.flight], landings: [{ rect: st.landing, h: st.h, kind: 'mid' as const }], rails: [], well: st.landing, blocked: [], notes: ['I stoop in front of a door above the lowered floor'], score: 0 };
    buildStair({ buildingId: b.id, roomId: st.roomId, name_de: st.name_de, plan, evidence: 'I', tag: 'I interiors: steps from the court-level Durchfahrt up to the EG door', prunk: true, upperByRoom: false, acc, lib, tints, col });
    // landing block down to the floor
    const r = st.landing;
    const sb = acc.get(lib.get('stone.grey'), { buildingId: b.id, roomId: st.roomId, name_de: st.name_de, evidence: 'I', tag: 'I', element: 'podest' });
    sb.box([r.s0, st.flight.h0, -r.t1], [r.s1, st.h - 0.35, -r.t0], undefined, ['-y']);
  }

  // ---- finalize --------------------------------------------------------------------------------
  let triangles = 0;
  const meshes = acc.meshes(2);
  for (const m of meshes) {
    triangles += (m.geometry.getIndex()?.count ?? 0) / 3;
    g.add(m);
  }
  const ims = inst.meshes();
  for (const im of ims) {
    triangles += ((im.geometry.getIndex()?.count ?? im.geometry.getAttribute('position').count) / 3) * im.count;
    g.add(im);
  }
  const colMesh = col.mesh(b.id, 'colliders', 'interior/collider');
  if (colMesh) {
    g.add(colMesh);
    g.userData.colliders = [colMesh];
  }
  const lights: THREE.PointLight[] = [];
  for (const l of model.lights) {
    const pl = new THREE.PointLight(l.colour, l.intensity, l.distance, 2);
    const p = O(l.position[0], l.position[1], l.position[2]);
    pl.position.set(p[0], p[1], p[2]);
    pl.name = `${b.id}/interior/${l.roomId}/light`;
    pl.userData = { buildingId: b.id, part: 'interior/light', lod: 2, roomId: l.roomId, interiorLight: true };
    g.add(pl);
    lights.push(pl);
  }
  g.userData.lights = lights;
  g.userData.pois = model.pois;
  g.userData.warnings = model.warnings;
  g.userData.stats = { triangles: Math.round(triangles), meshes: meshes.length + ims.length, instances: inst.count() };
  return g;
};

export { interiorModel } from './model.ts';
export { createFallbackMaterials } from './materials.ts';
