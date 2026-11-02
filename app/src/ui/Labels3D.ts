import { Raycaster, Scene, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { utmToWorld } from '../geo';
import type { Origin } from '../geo';
import type { Terrain } from '../terrain/Terrain';

export interface LabelOptions {
  /** Metres above the (displayed) ground. */
  lift?: number;
  /** Hide beyond this horizontal distance (m). */
  maxDistance?: number;
}

interface Entry {
  obj: CSS2DObject;
  x: number;
  z: number;
  lift: number;
  maxDistance: number;
  group: string;
  occluded: boolean;
}

/**
 * DOM labels/pins anchored to UTM positions on the terrain (three.js CSS2DRenderer in its own
 * scene and rAF loop, so main.ts's frame loop doesn't need to know about it).
 * - y follows the displayed terrain (exaggeration changes, late-loaded chunks)
 * - distance culling, cheap throttled occlusion test against the height field (occluded → dimmed)
 */
export class Labels3D {
  readonly renderer = new CSS2DRenderer();
  private readonly scene = new Scene();
  private readonly entries = new Map<string, Entry>();
  private readonly hiddenGroups = new Set<string>();
  private occlusionCursor = 0;
  /** Factor on every label's max distance (quality presets: 1 / 0.75 / 0.5). */
  distanceScale = 1;
  private raf = 0;
  private readonly ray = new Raycaster();
  private readonly tmp = new Vector3();

  constructor(
    container: HTMLElement,
    private readonly camera: PerspectiveCamera,
    private readonly terrain: Terrain,
    private readonly origin: Origin,
  ) {
    const el = this.renderer.domElement;
    el.classList.add('sle-labels3d');
    container.appendChild(el);
    const resize = () => this.renderer.setSize(container.clientWidth, container.clientHeight);
    new ResizeObserver(resize).observe(container);
    resize();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.update();
    };
    this.raf = requestAnimationFrame(loop);
    window.addEventListener('sle:step', () => this.update()); // window.sle.step() while rAF is paused
  }

  set(id: string, group: string, E: number, N: number, element: HTMLElement, opts: LabelOptions = {}): void {
    this.remove(id);
    const { x, z } = utmToWorld(E, N, this.origin);
    const obj = new CSS2DObject(element);
    obj.center.set(0.5, 1); // anchor bottom-centre (pin tip)
    this.scene.add(obj);
    this.entries.set(id, { obj, x, z, lift: opts.lift ?? 0, maxDistance: opts.maxDistance ?? 4000, group, occluded: false });
  }

  remove(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.scene.remove(e.obj);
    e.obj.element.remove();
    this.entries.delete(id);
  }

  clearGroup(group: string): void {
    for (const [id, e] of this.entries) if (e.group === group) this.remove(id);
  }

  setGroupVisible(group: string, visible: boolean): void {
    if (visible) this.hiddenGroups.delete(group);
    else this.hiddenGroups.add(group);
  }

  isGroupVisible(group: string): boolean {
    return !this.hiddenGroups.has(group);
  }

  private update(): void {
    const cam = this.camera.position;
    const list = [...this.entries.values()];
    // Occlusion: test a few labels per frame (round robin).
    const budget = Math.min(list.length, 6);
    for (let k = 0; k < budget; k++) {
      const e = list[(this.occlusionCursor + k) % list.length];
      if (e.obj.visible) e.occluded = this.isOccluded(e);
    }
    if (list.length) this.occlusionCursor = (this.occlusionCursor + budget) % list.length;

    for (const e of list) {
      const gy = this.terrain.surfaceY(e.x, e.z);
      const dist = Math.hypot(e.x - cam.x, e.z - cam.z);
      const maxD = e.maxDistance * this.distanceScale;
      const visible = !this.hiddenGroups.has(e.group) && !Number.isNaN(gy) && dist <= maxD;
      e.obj.visible = visible;
      if (!visible) continue;
      e.obj.position.set(e.x, gy + e.lift, e.z);
      e.obj.element.classList.toggle('occluded', e.occluded);
      e.obj.element.classList.toggle('far', dist > maxD * 0.6);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private isOccluded(e: Entry): boolean {
    const gy = this.terrain.surfaceY(e.x, e.z);
    if (Number.isNaN(gy)) return false;
    const target = this.tmp.set(e.x, gy + e.lift + 1, e.z);
    const o = this.camera.position;
    const dist = o.distanceTo(target);
    if (dist < 5) return false;
    this.ray.ray.origin.copy(o);
    this.ray.ray.direction.copy(target).sub(o).normalize();
    return this.terrain.intersectRay(this.ray.ray, dist - 3) !== null;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.renderer.domElement.remove();
  }
}
