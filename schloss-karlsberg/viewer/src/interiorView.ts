/**
 * Applies an interior draw mode (indoor.ts `interiorMode`: full / shell / off) to a built interior group (KB-I42,
 * KB-I65). The children's visibility is recomputed only when the mode changes; the group's own flag every time (the
 * display toggles reset it).
 */
import type * as THREE from 'three';
import { type InteriorMode, inShell } from './indoor.ts';

/**
 * Set the mode; `storeyOf` maps a room id to its storey index (plinth included, as the catalogue). Returns true when
 * anything drawn changed (the shadow map then needs a redraw).
 */
export function applyInteriorMode(inner: THREE.Object3D, mode: InteriorMode, storeyOf: (roomId: string) => number | undefined): boolean {
  const vis = mode !== 'off';
  let changed = inner.visible !== vis;
  inner.visible = vis;
  if (inner.userData.viewMode !== mode) {
    inner.userData.viewMode = mode;
    changed = true;
    if (vis) {
      for (const o of inner.children) {
        const ud = o.userData as { part?: string; roomId?: string; skbBaseVisible?: boolean };
        // children built invisible (the walk colliders) stay so
        ud.skbBaseVisible ??= o.visible;
        o.visible = ud.skbBaseVisible && (mode === 'full' || inShell(ud.part, ud.roomId ? storeyOf(ud.roomId) : undefined));
      }
    }
  }
  return changed;
}
