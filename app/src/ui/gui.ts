import GUI from 'lil-gui';
import type { WebGLRenderer } from 'three';
import type { DroneController } from '../controls/DroneController';
import type { AppState, Store } from '../state';
import type { Terrain } from '../terrain/Terrain';

export interface GuiContext {
  container: HTMLElement;
  store: Store<AppState>;
  terrain: Terrain;
  controller: DroneController;
  renderer: WebGLRenderer;
  debug: { showFps: boolean };
  /** Persist flight prefs (final polish settings). */
  onFlightChange?: (patch: { baseSpeed?: number; minClearance?: number }) => void;
}

/** lil-gui panel (German labels). Bound to the store for shared state, to uniforms for local tuning. */
export function createGui(ctx: GuiContext): GUI {
  const { terrain, controller } = ctx;
  const u = terrain.uniforms;
  const gui = new GUI({ container: ctx.container, title: 'Flug & Technik' });

  // Relief modes, sun, exaggeration, forest: see reliefPanel.ts ("Darstellung").
  const p = {
    baseSpeed: controller.opts.baseSpeed,
    minClearance: controller.opts.minClearance,
    get speedMultiplier() {
      return controller.speedMultiplier;
    },
    set speedMultiplier(v: number) {
      controller.speedMultiplier = v;
    },
    // Getters/setters + listen(): quality presets change the distances from outside.
    get lod0() {
      return terrain.lod.distances[0];
    },
    set lod0(v: number) {
      terrain.lod.distances[0] = v;
    },
    get lod1() {
      return terrain.lod.distances[1];
    },
    set lod1(v: number) {
      terrain.lod.distances[1] = v;
    },
    get lod2() {
      return terrain.lod.distances[2];
    },
    set lod2(v: number) {
      terrain.lod.distances[2] = v;
    },
    wireframe: false,
    lodTint: false,
    showFps: ctx.debug.showFps,
    info: '',
  };

  // ---- Flug ------------------------------------------------------------------------------
  const fFly = gui.addFolder('Flug');
  fFly.add(p, 'baseSpeed', 2, 60, 1).name('Grundtempo (m/s)').onChange((v: number) => {
    controller.opts.baseSpeed = v;
    ctx.onFlightChange?.({ baseSpeed: v });
  });
  fFly.add(p, 'speedMultiplier', 0.05, 50, 0.01).name('Tempo-Faktor').listen();
  fFly.add(p, 'minClearance', 0.5, 50, 0.5).name('Mindesthöhe ü. Grund (m)').onChange((v: number) => {
    controller.opts.minClearance = v;
    ctx.onFlightChange?.({ minClearance: v });
  });

  // ---- LOD / Debug -------------------------------------------------------------------------
  const fDbg = gui.addFolder('LOD / Debug');
  const sp = terrain.lod.spacings;
  if (sp.length > 1) fDbg.add(p, 'lod0', 20, 3000, 10).name(`${sp[0]} m bis (m)`).listen();
  if (sp.length > 2) fDbg.add(p, 'lod1', 50, 5000, 10).name(`${sp[1]} m bis (m)`).listen();
  if (sp.length > 3) fDbg.add(p, 'lod2', 100, 8000, 10).name(`${sp[2]} m bis (m)`).listen();
  fDbg.add(p, 'wireframe').name('Drahtgitter').onChange((v: boolean) => {
    for (const c of terrain.chunks.values()) {
      c.mesh.material.wireframe = v;
      if (c.canopy) c.canopy.mesh.material.wireframe = v;
    }
  });
  fDbg.add(p, 'lodTint').name('LOD-Farben').onChange((v: boolean) => (u.uLodTint.value = v ? 0.6 : 0));
  fDbg.add(p, 'showFps').name('Bildrate anzeigen').onChange((v: boolean) => (ctx.debug.showFps = v));
  fDbg.add(p, 'info').name('Info').disable().listen();
  setInterval(() => {
    const info = ctx.renderer.info.render;
    p.info = `${terrain.stats.visible}+${terrain.stats.canopyVisible} Kacheln · ${(info.triangles / 1e6).toFixed(2)} M Dreiecke · ${info.calls} Draw Calls`;
  }, 500);
  fDbg.close();
  fFly.close();

  return gui;
}
