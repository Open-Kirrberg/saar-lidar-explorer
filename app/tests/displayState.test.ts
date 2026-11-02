import { describe, expect, it } from 'vitest';
import { createStore } from '../src/state';
import type { ForestMode } from '../src/state';
import { bindDisplayState } from '../src/ui/displayState';
import type { DisplayTerrain } from '../src/ui/displayState';

/** Minimal stand-in for Terrain's overlay/forest API (validates keys, emits on change). */
class FakeTerrain implements DisplayTerrain {
  overlay = { key: '', opacity: 0.5 };
  forest = { mode: 'off' as ForestMode };
  calls = 0;
  private fns = new Set<() => void>();
  constructor(
    private valid = new Set(['slrm', 'live-lrm']),
    private dsm = true,
  ) {}
  getOverlay() {
    return this.overlay;
  }
  setOverlay(p: { key?: string; opacity?: number }) {
    this.calls++;
    this.overlay = { ...this.overlay, ...p };
    if (this.overlay.key && !this.valid.has(this.overlay.key)) this.overlay.key = '';
    this.emit();
  }
  setForest(p: { mode: ForestMode }) {
    this.calls++;
    this.forest = { ...this.forest, ...p };
    this.emit();
  }
  hasCanopyData() {
    return this.dsm;
  }
  onChange(fn: () => void) {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  emit() {
    for (const f of this.fns) f();
  }
}

describe('bindDisplayState (R0.6)', () => {
  it('applies hash/gui writes to the terrain', () => {
    const store = createStore();
    const t = new FakeTerrain();
    bindDisplayState(store, t);
    store.set({ overlay: 'slrm', overlayOpacity: 0.8, forest: 'transparent' }, 'hash');
    expect(t.overlay).toEqual({ key: 'slrm', opacity: 0.8 });
    expect(t.forest.mode).toBe('transparent');
  });

  it('mirrors terrain changes (panel, presets, keys) into the store with source "terrain"', () => {
    const store = createStore();
    const t = new FakeTerrain();
    bindDisplayState(store, t);
    const sources: string[] = [];
    store.subscribe((_s, _c, src) => sources.push(src), ['overlay', 'overlayOpacity', 'forest']);
    t.setOverlay({ key: 'live-lrm', opacity: 0.3 });
    t.setForest({ mode: 'full' });
    expect(store.get()).toMatchObject({ overlay: 'live-lrm', overlayOpacity: 0.3, forest: 'full' });
    expect(sources).toEqual(['terrain', 'terrain']);
  });

  it('writes back values the terrain rejected, without looping', () => {
    const store = createStore();
    const t = new FakeTerrain(new Set(['slrm']), false);
    bindDisplayState(store, t);
    t.calls = 0;
    store.set({ overlay: 'bogus', forest: 'full' }, 'hash');
    expect(store.get().overlay).toBe('');
    expect(store.get().forest).toBe('off'); // no DSM → forest stays off
    expect(t.calls).toBe(1); // one setOverlay, no setForest, no ping-pong
  });

  it('an unrelated terrain emit during the same store write does not clobber pending values', () => {
    // main.ts: applyRender (subscribed before the bridge) calls terrain.setDisplay on a layer
    // change, which emits onChange before the bridge listener has pushed overlay/forest.
    const store = createStore();
    const t = new FakeTerrain();
    store.subscribe(() => t.emit(), ['layer']);
    bindDisplayState(store, t);
    store.set({ layer: 'live-slope', overlay: 'slrm', overlayOpacity: 0.7, forest: 'transparent' }, 'hash');
    expect(t.overlay).toEqual({ key: 'slrm', opacity: 0.7 });
    expect(t.forest.mode).toBe('transparent');
    expect(store.get()).toMatchObject({ overlay: 'slrm', overlayOpacity: 0.7, forest: 'transparent' });
  });

  it('initialises the store from the terrain and unbinds cleanly', () => {
    const store = createStore();
    const t = new FakeTerrain();
    t.overlay = { key: 'slrm', opacity: 0.4 };
    const off = bindDisplayState(store, t);
    expect(store.get()).toMatchObject({ overlay: 'slrm', overlayOpacity: 0.4 });
    off();
    t.setOverlay({ key: 'live-lrm' });
    expect(store.get().overlay).toBe('slrm');
  });
});
