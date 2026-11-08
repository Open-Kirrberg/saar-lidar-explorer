/**
 * Messen (F17): Strecke, Fläche, Höhenprofil, Punkt.
 *
 * - `L` (or the toolbar / card button) toggles measuring; while active the canvas doesn't grab
 *   the pointer (controller.opts.lockOnClick = false), dragging still looks around.
 * - Click (≤ 4 px, < 600 ms) adds a vertex via `ctx.pickAt`; double-click / Enter finishes,
 *   Backspace removes the last vertex, Esc discards the drawing (a second Esc ends the mode).
 *   Punkt: every click is one finished measurement.
 * - Metrics: horizontal lengths/areas in the UTM grid, 3D length / height stats / profile from the
 *   1 m DTM sampled every 0.5 m (`MeasureHeights` loads level 0 along the line, else warns).
 * - Measurements are kept per AOI in localStorage `sle.measure.v1.<aoi>` (no profiles; rebuilt on
 *   selection) and can be exported as GeoJSON (WGS84 + E/N/h + metrics).
 */
import { seedFromLegacy } from '../catalog/session';
import { deployedAois } from '../data/urls';
import type { Scene } from 'three';
import { utmToWgs84 } from '../geo';
import type { AppContext } from '../main';
import { lookupParcel } from '../markers/parcel';
import { flyToSiteExag } from '../candidates/flyToSite';
import type { Labels3D } from '../ui/Labels3D';
import { isTyping } from '../ui/keys';
import { createPanelSection, openPanelSection } from '../ui/panelSection';
import type { PanelSection } from '../ui/panelSection';
import { centroidOfVertices, polylineLength } from './geometry';
import { MeasureHeights } from './heights';
import { MeasureOverlay } from './MeasureOverlay';
import type { OverlayShape } from './MeasureOverlay';
import {
  MEASURE_KINDS,
  MEASURE_LABELS_DE,
  PROFILE_STEP,
  computeMetrics,
  fmtArea,
  fmtLength,
  fmtNum,
  fmtSigned,
  measurementsToGeoJSON,
  minVertices,
  newMeasureId,
  summary,
} from './model';
import type { MeasureKind, MeasureMetrics, Measurement, Vertex } from './model';
import { ProfileChart } from './ProfileChart';
import { chunkKeysAlong, samplePolyline } from './profile';
import './measure.css';

/** Another click mode (Markieren) that must not run at the same time. */
export interface ExclusiveMode {
  readonly active: boolean;
  setActive(on: boolean): void;
  onModeChange(fn: (on: boolean) => void): void;
}

interface Stored {
  version: 1;
  kind?: MeasureKind;
  measurements: Array<Omit<Measurement, 'profile'>>;
}

const KIND_SHORT: Record<MeasureKind, string> = { distance: 'Strecke', area: 'Fläche', profile: 'Profil', point: 'Punkt' };
const CLICK_PX = 4;
const CLICK_MS = 600;
const DBL_MS = 400;

export class MeasureTool {
  active = false;
  kind: MeasureKind = 'distance';
  readonly heights: MeasureHeights;
  readonly overlay: MeasureOverlay;
  list: Measurement[] = [];
  selected: string | null = null;
  draft: Vertex[] = [];
  private draftMetrics: MeasureMetrics | null = null;
  private readonly chart: ProfileChart;
  private readonly sec: PanelSection;
  private readonly hint: HTMLElement;
  private readonly modeListeners = new Set<(on: boolean) => void>();
  private toolbarBtn: HTMLButtonElement | null = null;
  private prevLock = true;
  private yieldedLock: boolean | null = null;
  private beforeActivate: (() => void) | null = null;
  private down: { x: number; y: number; t: number } | null = null;
  private lastClick: { x: number; y: number; t: number } | null = null;
  private cursor: { x: number; y: number } | null = null;
  private cursorDirty = false;
  private cursorLen: number | null = null;
  private draftGen = 0;
  private readonly loading = new Set<string>();
  private readonly storageKey: string;

  constructor(
    private readonly ctx: AppContext,
    panel: HTMLElement,
    labels: Labels3D,
  ) {
    this.storageKey = `sle.measure.v1.${ctx.manifest.aoi}`;
    // Catalog mode (`katalog`): seeded once from the deployment's single-AOI store (UTM vertices).
    if (ctx.catalog) {
      try {
        seedFromLegacy(localStorage, this.storageKey, (deployedAois() ?? ['overall']).map((a) => `sle.measure.v1.${a}`));
      } catch {
        /* no storage */
      }
    }
    this.heights = new MeasureHeights(ctx.terrain);
    this.overlay = new MeasureOverlay(ctx.terrain, labels, ctx.manifest.origin);
    ctx.scene.add(this.overlay);
    this.chart = new ProfileChart((i) => this.onProbe(i));
    this.sec = createPanelSection(panel, 'measure', 'Messen', false);
    this.hint = document.createElement('div');
    this.hint.className = 'sle-mode-hint sle-measure-hint';
    this.hint.hidden = true;
    document.querySelector('#app')!.appendChild(this.hint);
    this.load();
    this.buildSection();
    this.bindCanvas();
    this.bindKeys();
    this.hookFrame(ctx.scene);
    this.syncOverlay();
    this.renderAll();
  }

  // ---- mode -------------------------------------------------------------------------------------

  onModeChange(fn: (on: boolean) => void): void {
    this.modeListeners.add(fn);
  }

  /**
   * Make Messen and another click mode mutually exclusive. Whichever starts second ends the other;
   * the pointer-lock setting found before the first mode started is restored at the very end.
   */
  exclusiveWith(other: ExclusiveMode): void {
    this.beforeActivate = () => {
      if (other.active) other.setActive(false);
    };
    other.onModeChange((on) => {
      if (on && this.active) this.setActive(false, true);
      else if (!on && this.yieldedLock !== null) {
        // The other mode saved *our* "off" as its previous value; put back the original.
        if (!this.active) this.ctx.controller.opts.lockOnClick = this.yieldedLock;
        this.yieldedLock = null;
      }
    });
  }

  setActive(on: boolean, yielding = false): void {
    if (on === this.active) return;
    const { controller } = this.ctx;
    if (on) {
      this.beforeActivate?.();
      this.active = true;
      this.prevLock = controller.opts.lockOnClick;
      controller.opts.lockOnClick = false;
      if (controller.locked) document.exitPointerLock();
    } else {
      this.active = false;
      this.cancelDraft();
      if (yielding) this.yieldedLock = this.prevLock;
      else controller.opts.lockOnClick = this.prevLock;
      this.cursor = null;
      this.overlay.setCursor(null);
    }
    document.querySelector('#app')!.classList.toggle('measure-mode', on);
    this.hint.hidden = !on;
    this.toolbarBtn?.classList.toggle('on', on);
    this.renderHint();
    this.renderModes();
    if (on) openPanelSection(this.sec);
    for (const fn of this.modeListeners) fn(on);
  }

  setKind(kind: MeasureKind): void {
    if (kind !== this.kind) {
      this.cancelDraft();
      this.kind = kind;
      this.save();
    }
    if (!this.active) this.setActive(true);
    this.renderModes();
    this.renderHint();
  }

  /** Add a toolbar button (next to Markieren). */
  attachToolbar(bar: HTMLElement): void {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.act = 'measure';
    b.title = 'Messen: Strecke, Fläche, Höhenprofil, Punkt (Taste L)';
    b.innerHTML = 'Messen <kbd>L</kbd>';
    b.addEventListener('click', () => this.setActive(!this.active));
    bar.appendChild(b);
    this.toolbarBtn = b;
  }

  // ---- drawing ----------------------------------------------------------------------------------

  /** Add a vertex at UTM E/N (height from the DTM). Also the debug entry point (`sleMeasure`). */
  addVertexUtm(E: number, N: number, h?: number): void {
    const x = E - this.ctx.manifest.origin.E0;
    const z = -(N - this.ctx.manifest.origin.N0);
    const hh = h ?? this.heights.dtmAt(x, z).h;
    const v: Vertex = { E: Math.round(E * 100) / 100, N: Math.round(N * 100) / 100, h: Number.isFinite(hh) ? Math.round(hh * 100) / 100 : null };
    if (this.kind === 'point') {
      this.commit([v]);
      return;
    }
    this.draft.push(v);
    this.draftChanged();
  }

  undo(): void {
    if (!this.draft.length) return;
    this.draft.pop();
    this.draftChanged();
  }

  cancelDraft(): void {
    if (!this.draft.length && !this.draftMetrics) return;
    this.draft = [];
    this.draftChanged();
  }

  /** Finish the drawing (needs 2 vertices for lines, 3 for areas). */
  finish(): boolean {
    if (this.kind === 'point' || this.draft.length === 0) return false;
    const need = minVertices(this.kind);
    if (this.draft.length < need) {
      this.toast(`${MEASURE_LABELS_DE[this.kind]}: mindestens ${need} Punkte setzen.`, true);
      return false;
    }
    const v = this.draft;
    this.draft = [];
    this.draftChanged();
    this.commit(v);
    return true;
  }

  private commit(vertices: Vertex[]): void {
    const m: Measurement = {
      id: newMeasureId(),
      kind: this.kind,
      created: new Date().toISOString(),
      vertices,
      metrics: { grid_scale_factor: 1, ground_factor: 1, coarse_fraction: 1 },
    };
    this.recompute(m);
    this.list.push(m);
    this.selected = m.id;
    this.changed();
    void this.refine(m);
    if (m.kind === 'point') void this.queryParcel(m);
  }

  private draftChanged(): void {
    const gen = ++this.draftGen;
    if (this.draft.length === 0) {
      this.draftMetrics = null;
    } else {
      this.draftMetrics = computeMetrics(this.kind, this.draft, this.ctx.manifest.origin, this.heightProvider(false)).metrics;
      // Prefetch the 1 m DTM along the draft, then refresh its numbers.
      const keys = this.keysFor(this.kind, this.draft);
      if (!this.heights.ready(keys, false)) {
        void this.heights.ensure(keys, false).then(() => {
          if (gen !== this.draftGen || !this.draft.length) return;
          this.draftMetrics = computeMetrics(this.kind, this.draft, this.ctx.manifest.origin, this.heightProvider(false)).metrics;
          this.renderDraft();
        });
      }
    }
    this.renderDraft();
  }

  private renderDraft(): void {
    const tag = this.draftMetrics && this.draft.length >= 2 ? summary({ kind: this.kind, metrics: this.draftMetrics, vertices: this.draft }) : null;
    this.overlay.setDraft(this.draft, this.kind === 'area', tag);
    this.renderHint();
    this.renderDetail();
  }

  // ---- metrics ----------------------------------------------------------------------------------

  private heightProvider(withDsm: boolean) {
    return {
      dtmAt: (x: number, z: number) => this.heights.dtmAt(x, z),
      ...(withDsm && this.heights.hasDsm ? { dsmAt: (x: number, z: number) => this.heights.dsmAt(x, z) } : {}),
    };
  }

  private keysFor(kind: MeasureKind, vertices: readonly Vertex[]): string[] {
    const o = this.ctx.manifest.origin;
    const pts = vertices.map((v) => ({ x: v.E - o.E0, z: -(v.N - o.N0) }));
    if (kind === 'point' || kind === 'area') return chunkKeysAlong(pts.map((p) => p.x), pts.map((p) => p.z), this.heights.keyAt);
    const s = samplePolyline(pts, PROFILE_STEP);
    return chunkKeysAlong(s.x, s.z, this.heights.keyAt);
  }

  private recompute(m: Measurement): void {
    // Vertex heights from the 1 m DTM when available — first, because the area metrics
    // (corner min/max, ground factor) are computed from v.h.
    const o = this.ctx.manifest.origin;
    for (const v of m.vertices) {
      const r0 = this.heights.dtmAt(v.E - o.E0, -(v.N - o.N0));
      if (r0.level === 0 && Number.isFinite(r0.h)) v.h = Math.round(r0.h * 100) / 100;
    }
    const r = computeMetrics(m.kind, m.vertices, this.ctx.manifest.origin, this.heightProvider(m.kind === 'profile' || m.kind === 'point'));
    m.metrics = r.metrics;
    if (r.profile) m.profile = r.profile;
  }

  /** Load level 0 (+ DSM for profiles/points) along the measurement, then recompute. */
  private async refine(m: Measurement): Promise<void> {
    const withDsm = m.kind === 'profile' || m.kind === 'point';
    const keys = this.keysFor(m.kind, m.vertices);
    if (!this.heights.ready(keys, withDsm)) {
      this.loading.add(m.id);
      this.renderAll();
      try {
        await this.heights.ensure(keys, withDsm);
      } finally {
        this.loading.delete(m.id);
      }
    }
    if (!this.list.includes(m)) return;
    this.recompute(m);
    this.changed();
  }

  private async queryParcel(m: Measurement): Promise<void> {
    const v = m.vertices[0];
    m.parcel = undefined;
    const label = await lookupParcel(v.E, v.N);
    m.parcel = label ?? null;
    if (this.list.includes(m)) this.changed();
  }

  // ---- list ------------------------------------------------------------------------------------

  select(id: string | null): void {
    this.selected = id;
    const m = this.current();
    if (m && m.kind === 'profile' && !m.profile) void this.refine(m);
    this.syncOverlay();
    this.renderAll();
  }

  remove(id: string): void {
    this.list = this.list.filter((m) => m.id !== id);
    if (this.selected === id) this.selected = this.list.length ? this.list[this.list.length - 1].id : null;
    this.changed();
  }

  clear(): void {
    this.list = [];
    this.selected = null;
    this.changed();
  }

  private current(): Measurement | undefined {
    return this.list.find((m) => m.id === this.selected);
  }

  private changed(): void {
    this.save();
    this.syncOverlay();
    this.renderAll();
  }

  private syncOverlay(): void {
    const shapes: OverlayShape[] = this.list.map((m) => {
      const sel = m.id === this.selected;
      const tagAt = m.kind === 'area' ? centroidOfVertices(m.vertices) : m.vertices[m.vertices.length - 1];
      return {
        id: m.id,
        points: m.vertices,
        closed: m.kind === 'area',
        selected: sel,
        tag: summary(m),
        tagAt: tagAt ?? null,
        dots: m.kind === 'point',
      };
    });
    this.overlay.setShapes(shapes);
  }

  flyTo(m: Measurement): void {
    const c = centroidOfVertices(m.vertices);
    let r = 0;
    for (const v of m.vertices) r = Math.max(r, Math.hypot(v.E - c.E, v.N - c.N));
    const dist = Math.min(Math.max(r * 2.2, 80), 3000);
    void flyToSiteExag(this.ctx, c.E, c.N, dist, dist * 0.6);
  }

  exportGeoJSON(): void {
    if (!this.list.length) {
      this.toast('Keine Messungen zum Exportieren.', true);
      return;
    }
    const fc = measurementsToGeoJSON(this.list);
    const blob = new Blob([JSON.stringify(fc, null, 1)], { type: 'application/geo+json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `messungen-${new Date().toISOString().slice(0, 10)}.geojson`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---- persistence ------------------------------------------------------------------------------

  private load(): void {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const s = JSON.parse(raw) as Stored;
      if (s?.version !== 1 || !Array.isArray(s.measurements)) return;
      if (s.kind && MEASURE_KINDS.includes(s.kind)) this.kind = s.kind;
      this.list = s.measurements.filter(
        (m) =>
          m &&
          typeof m.id === 'string' &&
          MEASURE_KINDS.includes(m.kind) &&
          Array.isArray(m.vertices) &&
          m.vertices.length >= minVertices(m.kind) &&
          m.vertices.every((v) => Number.isFinite(v?.E) && Number.isFinite(v?.N)) &&
          m.metrics &&
          typeof m.metrics === 'object',
      );
    } catch {
      /* ignore broken storage */
    }
  }

  private save(): void {
    try {
      const s: Stored = { version: 1, kind: this.kind, measurements: this.list.map(({ profile: _p, ...m }) => m) };
      localStorage.setItem(this.storageKey, JSON.stringify(s));
    } catch {
      /* private mode / quota: measurements stay for this session */
    }
  }

  // ---- input ------------------------------------------------------------------------------------

  private bindCanvas(): void {
    const dom = this.ctx.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => {
      if (this.active && e.button === 0) this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    dom.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!this.active || !d || e.button !== 0) return;
      const now = performance.now();
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_PX || now - d.t > CLICK_MS) return;
      // Second click of a double-click: no extra vertex (dblclick finishes).
      const lc = this.lastClick;
      if (this.kind !== 'point' && lc && now - lc.t < DBL_MS && Math.hypot(e.clientX - lc.x, e.clientY - lc.y) <= 6) {
        this.lastClick = null;
        return;
      }
      this.lastClick = { x: e.clientX, y: e.clientY, t: now };
      const hit = this.ctx.pickAt(e.clientX, e.clientY);
      if (!hit) {
        this.toast('Kein Gelände getroffen.', true);
        return;
      }
      this.addVertexUtm(hit.E, hit.N);
    });
    dom.addEventListener('dblclick', (e) => {
      if (!this.active || this.kind === 'point') return;
      e.preventDefault();
      this.finish();
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.active || this.kind === 'point' || !this.draft.length || e.buttons !== 0) return;
      this.cursor = { x: e.clientX, y: e.clientY };
      this.cursorDirty = true;
    });
    dom.addEventListener('pointerleave', () => {
      this.cursor = null;
      this.cursorDirty = true;
    });
  }

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'KeyL') {
        if (!e.repeat) this.setActive(!this.active);
        return;
      }
      if (!this.active) return;
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        if (this.finish()) e.preventDefault();
      } else if (e.code === 'Backspace') {
        e.preventDefault();
        this.undo();
      } else if (e.code === 'Escape') {
        if (this.draft.length) this.cancelDraft();
        else this.setActive(false);
      }
    });
  }

  private hookFrame(scene: Scene): void {
    const { camera, renderer } = this.ctx;
    const prev = scene.onBeforeRender.bind(scene);
    scene.onBeforeRender = (...args: Parameters<Scene['onBeforeRender']>) => {
      prev(...args);
      if (args[2] !== camera) return;
      if (this.cursorDirty) {
        this.cursorDirty = false;
        this.updateCursor();
      }
      this.overlay.update(camera, renderer);
    };
  }

  private updateCursor(): void {
    const c = this.cursor;
    const last = this.draft[this.draft.length - 1];
    const hit = c && last && this.active ? this.ctx.pickAt(c.x, c.y) : null;
    this.overlay.setCursor(hit ? { x: hit.point.x, z: hit.point.z } : null);
    const len = hit ? polylineLength([...this.draft, { E: hit.E, N: hit.N }]) : null;
    if (len !== this.cursorLen) {
      this.cursorLen = len;
      this.renderHint();
    }
  }

  private onProbe(i: number | null): void {
    const m = this.current();
    const p = m?.profile;
    if (i === null || !p || i >= p.d.length) {
      this.overlay.setProbe(null);
      return;
    }
    const o = this.ctx.manifest.origin;
    this.overlay.setProbe({ E: p.x[i] + o.E0, N: o.N0 - p.z[i] });
  }

  // ---- UI ---------------------------------------------------------------------------------------

  private buildSection(): void {
    const b = this.sec.body;
    b.innerHTML = `
      <div class="sle-row sle-measure-modes" role="group" aria-label="Messart">
        ${MEASURE_KINDS.map((k) => `<button type="button" class="sle-btn" data-kind="${k}">${KIND_SHORT[k]}</button>`).join('')}
      </div>
      <div class="sle-row">
        <button type="button" class="sle-btn" data-act="toggle" title="Messen ein/aus (Taste L)">Messen <kbd>L</kbd></button>
        <span class="sle-spacer"></span>
        <button type="button" class="sle-btn" data-act="undo" title="Letzten Punkt entfernen (Rücktaste)">⌫</button>
        <button type="button" class="sle-btn" data-act="finish" title="Abschließen (Doppelklick / Enter)">Fertig</button>
      </div>
      <div data-k="detail"></div>
      <div data-k="chart"></div>
      <p class="sle-small sle-measure-warn" data-k="warn" hidden></p>
      <div class="sle-list" data-k="list"></div>
      <div class="sle-row">
        <button type="button" class="sle-btn" data-act="export" title="Messungen als GeoJSON (WGS84) speichern">Export</button>
        <span class="sle-spacer"></span>
        <button type="button" class="sle-btn" data-act="clear">Alle löschen</button>
      </div>
      <p class="sle-dim sle-small">Längen und Flächen horizontal im UTM-Gitter (Naturmaß hier ≈ +0,03 %). 3D-Länge, Höhen und Profil aus dem 1-m-DGM, alle 0,5 m abgetastet. Messungen bleiben lokal in diesem Browser.</p>`;
    const q = <T extends HTMLElement>(s: string) => b.querySelector<T>(s)!;
    for (const btn of b.querySelectorAll<HTMLButtonElement>('[data-kind]')) {
      btn.addEventListener('click', () => this.setKind(btn.dataset.kind as MeasureKind));
    }
    q('[data-act=toggle]').addEventListener('click', () => this.setActive(!this.active));
    q('[data-act=undo]').addEventListener('click', () => this.undo());
    q('[data-act=finish]').addEventListener('click', () => this.finish());
    q('[data-act=export]').addEventListener('click', () => this.exportGeoJSON());
    const clearBtn = q<HTMLButtonElement>('[data-act=clear]');
    let armed = 0;
    clearBtn.addEventListener('click', () => {
      if (!this.list.length) return;
      if (!armed) {
        clearBtn.textContent = 'Wirklich alle löschen?';
        clearBtn.classList.add('danger');
        armed = window.setTimeout(() => {
          armed = 0;
          clearBtn.textContent = 'Alle löschen';
          clearBtn.classList.remove('danger');
        }, 3000);
        return;
      }
      clearTimeout(armed);
      armed = 0;
      clearBtn.textContent = 'Alle löschen';
      clearBtn.classList.remove('danger');
      this.clear();
    });
    q('[data-k=chart]').appendChild(this.chart.root);
    this.chart.set(null);
  }

  private renderAll(): void {
    this.renderModes();
    this.renderDetail();
    this.renderList();
    this.renderHint();
    this.sec.setCount(this.list.length ? this.list.length : '');
  }

  private renderModes(): void {
    for (const btn of this.sec.body.querySelectorAll<HTMLButtonElement>('[data-kind]')) {
      btn.classList.toggle('on', this.active && btn.dataset.kind === this.kind);
      btn.classList.toggle('sel', btn.dataset.kind === this.kind);
    }
    this.sec.body.querySelector('[data-act=toggle]')!.classList.toggle('on', this.active);
  }

  private renderHint(): void {
    if (!this.active) return;
    const k = this.kind;
    const label = MEASURE_LABELS_DE[k];
    let live = '';
    if (k !== 'point' && this.draft.length) {
      const len = this.cursorLen ?? polylineLength(this.draft);
      live = ` · <b>${fmtLength(len)}</b>`;
      if (k === 'area' && this.draftMetrics?.area_m2 !== undefined && this.draft.length >= 3) live += ` · ${fmtArea(this.draftMetrics.area_m2)}`;
    }
    this.hint.innerHTML =
      k === 'point'
        ? `<b>Messen: ${label}</b> · Klick ins Gelände misst einen Punkt · <kbd>L</kbd>/<kbd>Esc</kbd> beendet`
        : `<b>Messen: ${label}</b> · Klick setzt Punkte · Doppelklick/<kbd>Enter</kbd> fertig · <kbd>⌫</kbd> zurück · <kbd>Esc</kbd> verwerfen${live}`;
  }

  private renderDetail(): void {
    const host = this.sec.body.querySelector<HTMLElement>('[data-k=detail]')!;
    const warn = this.sec.body.querySelector<HTMLElement>('[data-k=warn]')!;
    const drafting = this.active && this.draft.length > 0 && this.draftMetrics;
    const m = drafting ? null : this.current();
    const kind = drafting ? this.kind : m?.kind;
    const x = drafting ? this.draftMetrics! : m?.metrics;
    const verts = drafting ? this.draft : (m?.vertices ?? []);
    if (!kind || !x) {
      host.innerHTML = `<p class="sle-dim sle-small">${this.active ? 'Ins Gelände klicken, um zu messen.' : 'Messart wählen oder <kbd>L</kbd> drücken.'}</p>`;
      warn.hidden = true;
      this.chart.set(null);
      return;
    }
    const rows: Array<[string, string]> = [];
    const title = `${MEASURE_LABELS_DE[kind]}${drafting ? ' (wird gezeichnet)' : ''}`;
    const k = `k = ${fmtNum(x.grid_scale_factor, 5)}`;
    if (kind === 'distance' || kind === 'profile') {
      rows.push(['Länge (horizontal)', fmtLength(x.length_m)]);
      rows.push(['Länge 3D (Gelände)', x.length_3d_m !== undefined ? fmtLength(x.length_3d_m) : '–']);
      rows.push(['Naturmaß', `${fmtLength(x.ground_length_m)} <span class="sle-dim">(${k})</span>`]);
      rows.push(['Höhenunterschied', fmtSigned(x.dh_m)]);
      rows.push(['Anstieg / Abstieg', `${fmtNum(x.ascent_m, 1)} / ${fmtNum(x.descent_m, 1)} m`]);
      rows.push(['Höhe min / max', `${fmtNum(x.h_min_m, 2)} / ${fmtNum(x.h_max_m, 2)} m`]);
      rows.push(['Höhe Ø', `${fmtNum(x.h_avg_m, 2)} m`]);
      rows.push(['Neigung Ø / max', `${fmtNum(x.slope_avg_deg, 1)}° / ${fmtNum(x.slope_max_deg, 1)}°`]);
      if (kind === 'profile' && x.dsm_fraction !== undefined)
        rows.push(['DOM', this.heights.hasDsm ? `${fmtNum(x.dsm_fraction * 100, 0)} % der Strecke` : 'nicht vorhanden']);
    } else if (kind === 'area') {
      rows.push(['Fläche (horizontal)', fmtArea(x.area_m2)]);
      rows.push(['Umfang', fmtLength(x.perimeter_m)]);
      rows.push(['Naturmaß Umfang', `${fmtLength(x.ground_length_m)} <span class="sle-dim">(${k})</span>`]);
      if (x.h_min_m !== undefined) rows.push(['Höhe Ecken min / max', `${fmtNum(x.h_min_m, 2)} / ${fmtNum(x.h_max_m, 2)} m`]);
    } else {
      const v = verts[0];
      const { lat, lon } = utmToWgs84(v.E, v.N);
      rows.push(['E / N (UTM 32)', `${fmtNum(v.E, 2)} / ${fmtNum(v.N, 2)}`]);
      rows.push(['Höhe (DGM)', `${fmtNum(x.h_avg_m, 2)} m ü. NN`]);
      if (x.dsm_h_m !== undefined) rows.push(['Oberfläche (DOM)', `${fmtNum(x.dsm_h_m, 2)} m · ${fmtNum(x.above_ground_m, 1)} m über Grund`]);
      rows.push(['WGS84', `${lat.toFixed(6)}, ${lon.toFixed(6)}`]);
      rows.push(['Flurstück', m?.parcel === undefined ? 'wird abgefragt …' : m.parcel === null ? 'nicht verfügbar' : esc(m.parcel)]);
    }
    if (kind !== 'point') rows.push(['Punkte', String(verts.length)]);
    const busy = m && this.loading.has(m.id);
    host.innerHTML = `<div class="sle-measure-title">${title}${busy ? ' <span class="sle-dim">· lädt 1-m-DGM …</span>' : ''}</div>
      <dl class="sle-meta">${rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>`;

    const warns: string[] = [];
    if (x.coarse_fraction > 0.001 && !busy) {
      warns.push(
        `${fmtNum(x.coarse_fraction * 100, x.coarse_fraction < 0.1 ? 1 : 0)} % der Höhenwerte nicht aus dem 1-m-DGM (gröbere Stufe oder fehlend) – Werte ungenauer.`,
      );
    }
    if (x.self_intersecting) warns.push('Die Fläche überschneidet sich selbst – Flächenwert nicht sinnvoll.');
    warn.hidden = warns.length === 0;
    warn.textContent = warns.join(' ');
    this.chart.set(!drafting && m?.kind === 'profile' && m.profile ? m.profile : null);
  }

  private renderList(): void {
    const host = this.sec.body.querySelector<HTMLElement>('[data-k=list]')!;
    host.replaceChildren();
    const counts: Partial<Record<MeasureKind, number>> = {};
    for (const m of this.list) {
      const n = (counts[m.kind] = (counts[m.kind] ?? 0) + 1);
      const row = document.createElement('div');
      row.className = 'sle-marker-row';
      row.innerHTML = `
        <button type="button" class="sle-item" data-act="sel"><span class="sle-conf c-measure"></span><span class="sle-item-name"></span></button>
        <button type="button" class="sle-icon" data-act="fly" title="Hinfliegen">➚</button>
        <button type="button" class="sle-icon" data-act="del" title="Löschen">✕</button>`;
      const sel = row.querySelector<HTMLButtonElement>('[data-act=sel]')!;
      sel.classList.toggle('active', m.id === this.selected);
      row.querySelector('.sle-item-name')!.textContent = `${KIND_SHORT[m.kind]} ${n}: ${summary(m)}`;
      sel.addEventListener('click', () => this.select(m.id === this.selected ? null : m.id));
      row.querySelector('[data-act=fly]')!.addEventListener('click', () => {
        this.select(m.id);
        this.flyTo(m);
      });
      row.querySelector('[data-act=del]')!.addEventListener('click', () => this.remove(m.id));
      host.appendChild(row);
    }
  }

  private toast(msg: string, warn = false): void {
    const t = document.createElement('div');
    t.className = `sle-toast${warn ? ' warn' : ''}`;
    t.textContent = msg;
    document.querySelector('#app')!.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
