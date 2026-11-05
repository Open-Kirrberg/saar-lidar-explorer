/**
 * Built twins (ADR 0042, docs/style.md „Interaction look“): hover / click / tap on clickable objects → highlight,
 * info card, „entdeckt x / y“. Wired by gltfZone.ts when the package has `twin.catalogue` (a `*.json` file).
 *
 * Input:
 * - Mouse: hover highlights (pointer cursor, name tip); click opens the card; a click on nothing closes an
 *   open card, else locks the pointer as before (walk mode).
 * - Pointer lock: centre crosshair; click or E opens the card of the target under it.
 * - Touch: a tap highlights and opens the card at once; a tap on nothing closes it.
 * - E (walking, not while typing or in a dialog) opens / closes; Esc closes (host asks `escape()` first).
 * Picks run at most once per frame and only when the pointer or the camera moved.
 */
import { Raycaster, Vector2 } from 'three';
import type { Camera, Object3D, WebGLRenderer } from 'three';
import type { DroneController } from '../../controls/DroneController';
import { isTyping } from '../../ui/keys';
import { modalOpen } from '../../ui/modalKeys';
import { cardFor, DiscoveryStore } from '../catalogue';
import type { CardData, DiscoveryKV, PickTarget, ZoneCatalogue } from '../catalogue';
import { TwinHighlight, TwinTargets } from './twinPick';
import type { PickHit } from './twinPick';
import { TwinUi } from './twinUi';

const TAP_MS = 500;
const TAP_PX_MOUSE = 5;
const TAP_PX_TOUCH = 12;

export interface TwinInteractionOptions {
  renderer: WebGLRenderer;
  camera: Camera;
  container: HTMLElement;
  zoneId: string;
  catalogue: ZoneCatalogue;
  /** Drawn twin (the scale transform); indexed again after LOD changes. */
  root: Object3D;
  storage: DiscoveryKV | null;
  /** Walking (E picks) vs. floating (E = up). */
  walking(): boolean;
}

export class TwinInteraction {
  readonly targets: TwinTargets;
  readonly highlight: TwinHighlight;
  readonly store: DiscoveryStore;
  readonly ui: TwinUi;
  private controls: DroneController | null = null;
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly centre = new Vector2(0, 0);
  private mouse: { x: number; y: number; nx: number; ny: number } | null = null;
  private dirty = true;
  private readonly last = { x: NaN, y: NaN, z: NaN, h: NaN, p: NaN, locked: false };
  private hover: PickHit | null = null;
  private selected: PickTarget | null = null;
  private down: { id: number; x: number; y: number; t: number; moved: number; type: string; button: number } | null = null;
  private readonly cards = new Map<string, CardData | null>();
  private readonly off: (() => void)[] = [];
  private cursor = '';

  constructor(private readonly o: TwinInteractionOptions) {
    this.targets = new TwinTargets(o.catalogue);
    this.highlight = new TwinHighlight(o.renderer);
    this.store = new DiscoveryStore(o.storage, o.zoneId, o.catalogue.discoverable);
    this.ui = new TwinUi(o.container, {
      counter: this.store.total > 0,
      onClose: () => this.close(),
      onReset: () => {
        this.store.reset();
        this.ui.setCounter(0, this.store.total);
        this.ui.toast('Entdeckt zurückgesetzt');
      },
    });
    this.ui.setCounter(this.store.found, this.store.total);
    this.reindex();
  }

  /** Rebuild the pick index from what is drawn now (after a LOD switch). */
  reindex(): void {
    this.highlight.clear();
    this.o.root.updateMatrixWorld(true);
    this.targets.index(this.o.root);
    this.hover = null;
    this.dirty = true;
  }

  /** Bind input (on `enter`); the controller must not lock on click itself (gltfZone passes `lockOnClick: false`). */
  attach(controls: DroneController): void {
    this.detach();
    this.controls = controls;
    const dom = this.o.renderer.domElement;
    const on = <K extends keyof WindowEventMap>(t: EventTarget, type: K | string, fn: (e: never) => void, opt?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opt);
      this.off.push(() => t.removeEventListener(type, fn as EventListener, opt));
    };
    on(dom, 'pointermove', (e: PointerEvent) => {
      if (this.down && e.pointerId === this.down.id) this.down.moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
      if (e.pointerType !== 'mouse') return;
      const r = dom.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      this.mouse = { x, y, nx: (x / Math.max(1, r.width)) * 2 - 1, ny: -(y / Math.max(1, r.height)) * 2 + 1 };
      this.dirty = true;
    });
    on(dom, 'pointerleave', (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      this.mouse = null;
      this.dirty = true;
    });
    on(dom, 'pointerdown', (e: PointerEvent) => {
      this.down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, type: e.pointerType, button: e.button };
    });
    on(dom, 'pointercancel', () => (this.down = null));
    on(dom, 'pointerup', (e: PointerEvent) => {
      const d = this.down;
      this.down = null;
      if (!d || d.id !== e.pointerId || d.button !== 0) return;
      const moved = Math.max(d.moved, Math.hypot(e.clientX - d.x, e.clientY - d.y));
      if (performance.now() - d.t > TAP_MS || moved > (d.type === 'touch' ? TAP_PX_TOUCH : TAP_PX_MOUSE)) return;
      this.tap(e);
    });
    on(window, 'keydown', (e: KeyboardEvent) => this.onKey(e), { capture: true });
    this.off.push(controls.onLockChange(() => (this.dirty = true)));
  }

  detach(): void {
    for (const f of this.off.splice(0)) f();
    this.controls = null;
    this.down = null;
    this.mouse = null;
    this.setCursor('');
    this.ui.setTip(null);
    this.ui.setCross(false, null);
  }

  /** Esc inside the zone: closes the card (true = used, the host does not leave). */
  escape(): boolean {
    if (!this.ui.cardKey) return false;
    this.close();
    return true;
  }

  /** Open the card of `t` (marks it discovered). */
  open(t: PickTarget): void {
    const card = this.card(t);
    if (!card) return;
    const fresh = this.store.mark(card.discovery);
    this.selected = t;
    this.ui.showCard(card, fresh);
    this.ui.setCounter(this.store.found, this.store.total);
    if (fresh) this.ui.discovered(card.title, this.store.found, this.store.total);
    this.applyHighlight();
  }

  close(): void {
    this.selected = null;
    this.ui.hideCard();
    this.applyHighlight();
  }

  /** Per frame (before render): pick when something moved, ease the highlight. */
  frame(dt: number): void {
    const c = this.controls;
    if (!c) return;
    const cam = this.o.camera;
    const p = cam.position;
    const L = this.last;
    const moved = p.x !== L.x || p.y !== L.y || p.z !== L.z || c.heading !== L.h || c.pitch !== L.p || c.locked !== L.locked;
    if (moved) {
      L.x = p.x;
      L.y = p.y;
      L.z = p.z;
      L.h = c.heading;
      L.p = c.pitch;
      L.locked = c.locked;
    }
    if (moved || this.dirty) {
      this.dirty = false;
      const prev = this.hover?.target.key ?? null;
      if (c.locked) this.hover = this.pickAt(this.centre);
      else if (this.mouse && !this.down) this.hover = this.pickAt(this.ndc.set(this.mouse.nx, this.mouse.ny));
      else if (!this.mouse) this.hover = null;
      if ((this.hover?.target.key ?? null) !== prev) this.applyHighlight();
      const name = this.hover ? (this.card(this.hover.target)?.title ?? null) : null;
      this.ui.setCross(c.locked, name);
      this.ui.setTip(!c.locked && this.mouse ? name : null, this.mouse?.x, this.mouse?.y);
      this.setCursor(!c.locked && this.hover ? 'pointer' : '');
    }
    this.highlight.update(dt);
  }

  /** Debug / headless checks (`sle.zones.flow.handle().twin`). */
  state(): { targets: number; hover: string | null; card: string | null; found: number; total: number; missing: string[] } {
    return {
      targets: this.targets.size,
      hover: this.hover?.target.key ?? null,
      card: this.ui.cardKey,
      found: this.store.found,
      total: this.store.total,
      missing: this.targets.missing(),
    };
  }

  /** Pick at CSS pixel `x, y` of the canvas (headless checks), without opening anything. */
  pickPx(x: number, y: number): PickHit | null {
    const r = this.o.renderer.domElement.getBoundingClientRect();
    return this.pickAt(this.ndc.set((x / Math.max(1, r.width)) * 2 - 1, -(y / Math.max(1, r.height)) * 2 + 1));
  }

  dispose(): void {
    this.detach();
    this.highlight.dispose();
    this.targets.dispose();
    this.ui.dispose();
  }

  // ---- internals -------------------------------------------------------------------------------------------
  private pickAt(ndc: Vector2): PickHit | null {
    this.o.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, this.o.camera);
    return this.targets.pick(this.raycaster.ray);
  }

  private card(t: PickTarget): CardData | null {
    const k = `${t.kind}:${t.key}`;
    if (!this.cards.has(k)) this.cards.set(k, cardFor(t, this.o.catalogue));
    return this.cards.get(k)!;
  }

  private applyHighlight(): void {
    const t = this.hover?.target ?? this.selected;
    this.highlight.set(t?.key ?? null, t ? this.targets.look(t) : null);
  }

  private tap(e: PointerEvent): void {
    const c = this.controls;
    if (!c) return;
    let hit: PickHit | null;
    if (c.locked) hit = this.hover;
    else {
      const r = this.o.renderer.domElement.getBoundingClientRect();
      hit = this.pickAt(this.ndc.set(((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -((e.clientY - r.top) / Math.max(1, r.height)) * 2 + 1));
    }
    if (hit) this.open(hit.target);
    else if (this.ui.cardKey) this.close();
    else if (e.pointerType === 'mouse' && !c.locked) c.requestLock();
    this.dirty = true;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.code !== 'KeyE' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || modalOpen(e.target)) return;
    if (this.ui.cardKey) this.close();
    else if (this.o.walking() && this.hover) this.open(this.hover.target);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  private setCursor(c: string): void {
    if (c === this.cursor) return;
    this.cursor = c;
    this.o.renderer.domElement.style.cursor = c;
  }
}
