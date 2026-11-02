/**
 * Static scene matrices (wave-4 review, CPU). three recomposes every object's local matrix and multiplies every world
 * matrix each frame: the Scene's own `matrixAutoUpdate` marks it dirty, which forces the whole tree (~5 400 objects,
 * ≈ 1 ms CPU per frame on the review machine). The buildings, site features, forest and terrain never move after they
 * are built, so their matrices are composed once and frozen here. Objects added later keep three's default
 * (`matrixAutoUpdate` true) and stay correct: an auto object still recomposes and forces its own subtree.
 *
 * Not frozen: objects with their own `onBeforeRender` (the fountain jets rescale themselves per draw, model/src/site/
 * features.ts `keepMinScreenWidth`), and everything outside the given roots (camera, sun and its target, sky dome).
 */
import * as THREE from 'three';

const DEFAULT_BEFORE_RENDER = THREE.Object3D.prototype.onBeforeRender;

/** Freeze the local matrices under `root` (including root); returns the number of objects frozen. */
export function freezeStatic(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if (!o.matrixAutoUpdate || o.onBeforeRender !== DEFAULT_BEFORE_RENDER) return;
    o.updateMatrix(); // also marks the world matrix dirty, so the next scene update computes it once
    o.matrixAutoUpdate = false;
    n++;
  });
  return n;
}

/** Stop the scene root from forcing a world-matrix update of the whole tree every frame. */
export function freezeSceneRoot(scene: THREE.Scene): void {
  scene.updateMatrix();
  scene.matrixAutoUpdate = false;
  scene.updateMatrixWorld(true);
}
