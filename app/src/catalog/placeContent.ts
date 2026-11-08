/**
 * Catalog mode (S2): per-place content in 3D — CHM trees and LoD2 buildings of every ready place.
 * Each place's layers live in a Group at the place's offset from the session origin
 * (`(E0 − Es, 0, −(N0 − Ns))`, contract "Multi-origin"); their buffers stay local to the place's own
 * origin. Content belongs to exactly one tile of one place (contract rule 6), so neighbours never
 * draw an object twice. The layers stream around a per-place proxy camera (camera − offset).
 */
import { Group, PerspectiveCamera } from 'three';
import type { Camera } from 'three';
import { BuildingLayer } from '../buildings/BuildingLayer';
import { utmToWorld } from '../geo';
import type { AppContext } from '../main';
import { TreeLayer } from '../trees/TreeLayer';

interface PlaceEntry {
  group: Group;
  cam: PerspectiveCamera;
  trees: TreeLayer | null;
  buildings: BuildingLayer | null;
}

export interface PlaceContentApi {
  /** Place id → its content layers (verification handle). */
  readonly places: ReadonlyMap<string, { trees: TreeLayer | null; buildings: BuildingLayer | null; offset: { x: number; z: number } }>;
  treeCount(): number;
}

export function installPlaceContent(ctx: AppContext): PlaceContentApi | null {
  const cat = ctx.catalog;
  if (!cat) return null;
  const entries = new Map<string, PlaceEntry>();
  const root = new Group();
  root.name = 'PlaceContent';
  ctx.scene.add(root);
  const forestOff = () => ctx.store.get().forest === 'off';
  // The single-AOI switches (Bäume / Gebäude) only exist when the session manifest has the layer;
  // in catalog mode their stored preference is honoured (read once).
  const treesOn = pref('sle.trees.v1');
  const bldgOn = pref('sle.buildings.v1');

  const sync = () => {
    const ready = new Map(cat.places.ready().map((r) => [r.place.id, r] as const));
    for (const [id, e] of entries) {
      if (ready.has(id)) continue;
      e.trees?.dispose();
      e.buildings?.dispose();
      root.remove(e.group);
      entries.delete(id);
    }
    for (const [id, r] of ready) {
      if (entries.has(id)) continue;
      const m = r.manifest;
      const o = utmToWorld(m.origin.E0, m.origin.N0, ctx.manifest.origin);
      const group = new Group();
      group.name = `place ${id}`;
      group.position.set(o.x, 0, o.z);
      group.updateMatrix();
      const view = { manifest: m, baseUrl: r.baseUrl, uniforms: ctx.terrain.uniforms, streaming: ctx.terrain.streaming };
      const trees = m.trees && m.trees.chunks.length ? new TreeLayer(m.trees, view) : null;
      const bm = m.models?.buildings;
      const buildings = bm && bm.chunks.length ? new BuildingLayer(bm, view, r.baseUrl) : null;
      if (trees) group.add(trees);
      if (buildings) group.add(buildings);
      root.add(group);
      entries.set(id, { group, cam: new PerspectiveCamera(), trees, buildings });
    }
  };
  cat.places.onChange(sync);
  sync();

  const proxy = (e: PlaceEntry, camera: Camera): PerspectiveCamera => {
    e.cam.position.copy(camera.position).sub(e.group.position);
    e.cam.quaternion.copy(camera.quaternion);
    return e.cam;
  };
  ctx.onFrame((dt) => {
    const showTrees = treesOn && forestOff();
    for (const e of entries.values()) {
      const cam = proxy(e, ctx.camera);
      if (e.trees) {
        e.trees.visible = showTrees;
        e.trees.update(cam, dt);
      }
      if (e.buildings) {
        e.buildings.visible = bldgOn;
        if (bldgOn) e.buildings.update(cam);
      }
    }
  });

  const api: PlaceContentApi = {
    get places() {
      const out = new Map<string, { trees: TreeLayer | null; buildings: BuildingLayer | null; offset: { x: number; z: number } }>();
      for (const [id, e] of entries) out.set(id, { trees: e.trees, buildings: e.buildings, offset: { x: e.group.position.x, z: e.group.position.z } });
      return out;
    },
    treeCount: () => [...entries.values()].reduce((a, e) => a + (e.trees?.stats().trees ?? 0), 0),
  };
  (window as unknown as { slePlaces?: PlaceContentApi }).slePlaces = api;
  return api;
}

function pref(key: string): boolean {
  try {
    const p = JSON.parse(localStorage.getItem(key) ?? '{}') as { on?: unknown };
    return typeof p.on === 'boolean' ? p.on : true;
  } catch {
    return true;
  }
}
