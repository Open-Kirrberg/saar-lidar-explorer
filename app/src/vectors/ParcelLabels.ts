import { Frustum, Matrix4, Raycaster, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { Terrain } from '../terrain/Terrain';
import { PointIndex, declutter } from './spatial';
import type { ScreenBox } from './spatial';

/**
 * Flurnummer labels with LOD: only the nearest `max` label points within `radius` (3D distance,
 * so labels vanish when the camera climbs high) of the camera and inside the view frustum get one of a pool of DOM elements. Positions use the
 * displayed terrain height (`terrain.surfaceY` = same exaggeration formula) and are projected by
 * hand (no CSS2DRenderer scene for thousands of points). Occlusion is tested round-robin against
 * the height field and dims a label. Labels whose screen boxes overlap a nearer label are skipped
 * (greedy decluttering, nearest first). Baked heights (`h`, contract `heights: 'baked'`) are used
 * when finite, else the loaded terrain.
 */
export interface ParcelLabelPoint {
  x: number;
  z: number;
  /** TRUE height if baked in the file (NaN/undefined → terrain.heightAt). */
  h?: number;
  text: string;
  title: string;
}

/** Approximate label box in CSS px for 600 11px system-ui with 3 px padding (see vectors.css). */
export function labelBoxSize(text: string): { w: number; h: number } {
  return { w: 6.6 * text.length + 6, h: 13 };
}

const _m = new Matrix4();
const _f = new Frustum();
const _p = new Vector3();

export class ParcelLabels {
  readonly el = document.createElement('div');
  private readonly index: PointIndex;
  private readonly pool: HTMLElement[] = [];
  private readonly occluded = new Map<number, boolean>();
  private readonly ray = new Raycaster();
  private occlCursor = 0;
  private last = 0;
  private shown: number[] = [];
  /** Candidates dropped by decluttering in the last update (for checks). */
  hiddenByDeclutter = 0;
  visible = false;

  constructor(
    container: HTMLElement,
    private readonly points: ParcelLabelPoint[],
    private readonly camera: PerspectiveCamera,
    private readonly terrain: Terrain,
    private readonly opts = { radius: 300, max: 200, lift: 1.2, intervalMs: 90, declutterPad: 2 },
  ) {
    this.el.className = 'sle-parcel-labels';
    container.appendChild(this.el);
    this.index = new PointIndex(
      Float64Array.from(points, (p) => p.x),
      Float64Array.from(points, (p) => p.z),
      100,
    );
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.el.hidden = !v;
    if (v) this.update(true);
  }

  /** Call per frame; throttled unless `force` (window.sle.step / visibility change). */
  update(force = false): void {
    if (!this.visible) return;
    const now = performance.now();
    if (!force && now - this.last < this.opts.intervalMs) return;
    this.last = now;

    const cam = this.camera;
    cam.updateMatrixWorld();
    _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _f.setFromProjectionMatrix(_m);
    const ys = new Map<number, number>();
    const yAt = (k: number) => {
      let y = ys.get(k);
      if (y === undefined) {
        const p = this.points[k];
        y = (p.h !== undefined && Number.isFinite(p.h) ? this.terrain.toDisplayY(p.h) : this.terrain.surfaceY(p.x, p.z)) + this.opts.lift;
        ys.set(k, y);
      }
      return y;
    };
    // 3D distance (not horizontal): from high above, the labels below are farther than `radius`
    // and disappear instead of piling up into an unreadable cluster.
    const c = cam.position;
    const cand = this.index.nearest3d(c.x, c.y, c.z, this.opts.radius, yAt, this.opts.max, (k) =>
      _f.containsPoint(_p.set(this.points[k].x, yAt(k), this.points[k].z)),
    );
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    // Project once; declutter nearest-first in screen space.
    const boxes: ScreenBox[] = cand.map((k) => {
      const p = this.points[k];
      _p.set(p.x, yAt(k), p.z).project(cam);
      return { x: ((_p.x + 1) / 2) * w, y: ((1 - _p.y) / 2) * h, ...labelBoxSize(p.text) };
    });
    const keep = declutter(boxes, this.opts.declutterPad);
    const ids: number[] = [];
    const pos: ScreenBox[] = [];
    cand.forEach((k, n) => {
      if (!keep[n]) return;
      ids.push(k);
      pos.push(boxes[n]);
    });
    this.hiddenByDeclutter = cand.length - ids.length;

    // Occlusion: a few height-field ray tests per update (round robin over the shown labels).
    const budget = Math.min(ids.length, 12);
    for (let n = 0; n < budget; n++) {
      const k = ids[(this.occlCursor + n) % ids.length];
      this.occluded.set(k, this.isOccluded(k, yAt(k)));
    }
    if (ids.length) this.occlCursor = (this.occlCursor + budget) % ids.length;
    if (this.occluded.size > 4000) this.occluded.clear();

    while (this.pool.length < ids.length) {
      const d = document.createElement('div');
      d.className = 'sle-parcel-label';
      this.el.appendChild(d);
      this.pool.push(d);
    }
    for (let n = 0; n < this.pool.length; n++) {
      const d = this.pool[n];
      if (n >= ids.length) {
        if (!d.hidden) d.hidden = true;
        continue;
      }
      const k = ids[n];
      const p = this.points[k];
      const dist = Math.hypot(p.x - cam.position.x, yAt(k) - cam.position.y, p.z - cam.position.z);
      d.hidden = false;
      if (d.textContent !== p.text) d.textContent = p.text;
      if (d.title !== p.title) d.title = p.title;
      d.style.transform = `translate(-50%, -50%) translate(${pos[n].x}px, ${pos[n].y}px)`;
      d.style.opacity = String(1 - 0.55 * Math.min(1, Math.max(0, (dist - this.opts.radius * 0.5) / (this.opts.radius * 0.5))));
      d.classList.toggle('occluded', this.occluded.get(k) === true);
    }
    this.shown = ids;
  }

  /** Number of labels currently placed (for checks). */
  get shownCount(): number {
    return this.visible ? this.shown.length : 0;
  }

  private isOccluded(k: number, y: number): boolean {
    const p = this.points[k];
    const o = this.camera.position;
    const target = _p.set(p.x, y + 0.5, p.z);
    const dist = o.distanceTo(target);
    if (dist < 5) return false;
    this.ray.ray.origin.copy(o);
    this.ray.ray.direction.copy(target).sub(o).normalize();
    return this.terrain.intersectRay(this.ray.ray, dist - 3) !== null;
  }

  dispose(): void {
    this.el.remove();
  }
}
