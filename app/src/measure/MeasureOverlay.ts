/**
 * 3D drawing of measurements (F17): lines/outlines as draped ribbons (the vectors' DrapedLines —
 * true heights per ≤ 2 m vertex, exaggeration in the shader), vertex dots + value tags as DOM
 * labels (Labels3D follows the displayed terrain), and a straight rubber band from the last vertex
 * to the cursor (CPU, re-placed every frame with the exaggeration formula via `surfaceY`).
 */
import { BufferGeometry, Float32BufferAttribute, Group, Line, LineBasicMaterial } from 'three';
import type { Vector3 } from 'three';
import type { Camera, WebGLRenderer } from 'three';
import type { Origin } from '../geo';
import type { Terrain } from '../terrain/Terrain';
import type { Labels3D } from '../ui/Labels3D';
import { DrapedLines } from '../vectors/DrapedLines';
import { densifyLine } from '../vectors/drape';
import type { LocalLine } from '../vectors/drape';
import type { PointEN } from './geometry';

export const LABEL_GROUP = 'measure';
/** Ribbon styles of this layer (own colour table on its material). */
const STYLE_DONE = 0;
const STYLE_SELECTED = 1;
const STYLE_DRAFT = 2;
const COLORS: Array<[number, number, number]> = [
  [0.22, 0.85, 1.0], // finished: cyan
  [1.0, 0.88, 0.29], // selected: yellow
  [1.0, 1.0, 1.0], // draft: white
];
const WIDTHS = [2.6, 3.4, 2.6];

export interface OverlayShape {
  id: string;
  points: PointEN[];
  closed: boolean;
  selected: boolean;
  /** Tag text at `tagAt` (null = none). */
  tag: string | null;
  tagAt: PointEN | null;
  /** Show vertex dots (always for points / the draft). */
  dots: boolean;
}

export class MeasureOverlay extends Group {
  private done: DrapedLines | null = null;
  private draft: DrapedLines | null = null;
  private readonly band: Line<BufferGeometry, LineBasicMaterial>;
  private bandFrom: PointEN | null = null;
  private bandTo: { x: number; z: number } | null = null;
  private readonly bandPos = new Float32Array(6);

  constructor(
    private readonly terrain: Terrain,
    private readonly labels: Labels3D,
    private readonly origin: Origin,
  ) {
    super();
    this.name = 'MeasureOverlay';
    this.userData.reportHide = true; // private measurements never go into an F18 report image
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.bandPos, 3));
    this.band = new Line(g, new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }));
    this.band.frustumCulled = false;
    this.band.renderOrder = 12;
    this.band.visible = false;
    this.band.raycast = () => {};
    this.add(this.band);
  }

  private toLine(points: PointEN[], closed: boolean, style: number): LocalLine | null {
    if (points.length < 2) return null;
    const xz: number[] = [];
    for (const p of points) xz.push(p.E - this.origin.E0, -(p.N - this.origin.N0));
    if (closed && points.length > 2) xz.push(xz[0], xz[1]);
    return { xz: Float64Array.from(densifyLine(xz, 2)), style };
  }

  private makeLines(lines: LocalLine[]): DrapedLines | null {
    if (lines.length === 0) return null;
    const dl = new DrapedLines({ lines }, this.terrain, {
      fade: [7000, 10000],
      lift: 0.35,
      renderOrder: 7,
      perFrameBudget: 64,
      casingAlpha: 0.85,
    });
    const u = dl.material.uniforms;
    COLORS.forEach((c, k) => (u.uColors.value[k] as Vector3).set(c[0], c[1], c[2]));
    WIDTHS.forEach((w, k) => (u.uWidths.value[k] = w));
    this.add(dl);
    return dl;
  }

  private replace(old: DrapedLines | null, next: DrapedLines | null): DrapedLines | null {
    if (old) {
      this.remove(old);
      old.dispose();
    }
    return next;
  }

  /** Finished measurements (ribbons + dots + tags). */
  setShapes(shapes: readonly OverlayShape[]): void {
    const lines = shapes
      .map((s) => this.toLine(s.points, s.closed, s.selected ? STYLE_SELECTED : STYLE_DONE))
      .filter((l): l is LocalLine => !!l);
    this.done = this.replace(this.done, this.makeLines(lines));
    this.labels.clearGroup(LABEL_GROUP);
    for (const s of shapes) {
      if (s.dots || s.selected) s.points.forEach((p, k) => this.dot(`measure:${s.id}:${k}`, p, s.selected ? 'sel' : 'done'));
      if (s.tag && s.tagAt) this.tag(`measure:${s.id}:tag`, s.tagAt, s.tag, s.selected);
    }
    this.drawDraftLabels();
  }

  private draftPts: PointEN[] = [];
  private draftTag: string | null = null;
  private draftDots = 0;

  /** The measurement being drawn (white), with dots and a live tag at its last vertex. */
  setDraft(points: PointEN[], closed: boolean, tag: string | null): void {
    this.draftPts = points;
    this.draftTag = tag;
    const line = this.toLine(points, closed, STYLE_DRAFT);
    this.draft = this.replace(this.draft, this.makeLines(line ? [line] : []));
    this.bandFrom = points.length ? points[points.length - 1] : null;
    this.drawDraftLabels();
  }

  private drawDraftLabels(): void {
    for (let k = 0; k < this.draftDots; k++) this.labels.remove(`measure:draft:${k}`);
    this.labels.remove('measure:draft:tag');
    this.draftPts.forEach((p, k) => this.dot(`measure:draft:${k}`, p, 'draft'));
    this.draftDots = this.draftPts.length;
    const last = this.draftPts[this.draftPts.length - 1];
    if (this.draftTag && last) this.tag('measure:draft:tag', last, this.draftTag, true);
  }

  /** Rubber band end (world x/z of the cursor hit), or null to hide. */
  setCursor(xz: { x: number; z: number } | null): void {
    this.bandTo = xz;
  }

  /** Profile hover cursor in 3D (UTM), or null. */
  setProbe(p: PointEN | null): void {
    if (!p) {
      this.labels.remove('measure:probe');
      return;
    }
    const el = document.createElement('div');
    el.className = 'sle-mdot probe';
    this.labels.set('measure:probe', LABEL_GROUP, p.E, p.N, el, { lift: 0, maxDistance: 10000 });
  }

  private dot(id: string, p: PointEN, cls: string): void {
    const el = document.createElement('div');
    el.className = `sle-mdot ${cls}`;
    this.labels.set(id, LABEL_GROUP, p.E, p.N, el, { lift: 0, maxDistance: 10000 });
  }

  private tag(id: string, p: PointEN, text: string, strong: boolean): void {
    const el = document.createElement('div');
    el.className = `sle-mtag${strong ? ' strong' : ''}`;
    const s = document.createElement('span');
    s.textContent = text;
    el.appendChild(s);
    this.labels.set(id, LABEL_GROUP, p.E, p.N, el, { lift: 0, maxDistance: 10000 });
  }

  /** Per frame (scene.onBeforeRender): ribbons + rubber band. */
  update(camera: Camera, renderer: WebGLRenderer): void {
    this.done?.update(camera, renderer);
    this.draft?.update(camera, renderer);
    const from = this.bandFrom;
    const to = this.bandTo;
    let show = false;
    if (from && to) {
      const fx = from.E - this.origin.E0;
      const fz = -(from.N - this.origin.N0);
      const lift = 0.35 * Math.max(this.terrain.uniforms.uExag.value, 1);
      const fy = this.terrain.surfaceY(fx, fz);
      const ty = this.terrain.surfaceY(to.x, to.z);
      if (Number.isFinite(fy) && Number.isFinite(ty)) {
        const b = this.bandPos;
        b[0] = fx;
        b[1] = fy + lift;
        b[2] = fz;
        b[3] = to.x;
        b[4] = ty + lift;
        b[5] = to.z;
        this.band.geometry.attributes.position.needsUpdate = true;
        show = true;
      }
    }
    this.band.visible = show;
  }

  dispose(): void {
    this.done = this.replace(this.done, null);
    this.draft = this.replace(this.draft, null);
    this.band.geometry.dispose();
    this.band.material.dispose();
    this.labels.clearGroup(LABEL_GROUP);
  }
}
