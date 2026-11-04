/**
 * Tier-gated feature registry (ADR 0019 / 0024 / 0032): feature id → tier → mount / unmount.
 *
 * A feature is *mounted* only while the current tier allows it and its data is available; below
 * its tier it is unmounted (its DOM removed, its teardown run), never hidden by CSS. Features
 * without a teardown (v1 modules that bind global keys / 3D layers for good) still get their host
 * DOM removed; the registry then asks for a reload (`onReloadNeeded`) so nothing keeps running.
 *
 * DOM-free and generic over the host object (see host.ts), so it is unit-tested with fakes.
 */
import type { Shortcut } from '../ui/shortcuts';
import { tierAllows } from './tiers';
import type { Tier } from './tiers';

export type Unmount = () => void;

export interface FeatureDef<H> {
  /** Stable id (`minimap`, `lens`, `relief-lab` …). Registering an existing id throws unless `replaces` names it. */
  id: string;
  /** Lowest tier that mounts the feature. */
  tier: Tier;
  /** German name (settings / keybind dialog). */
  label: string;
  /**
   * From which tier the feature's *panel* content (drawer cards, tool buttons) is attached
   * (default `tier`). Lets a Standard 3D layer keep its settings card in Labor.
   */
  panelTier?: Tier;
  /** False → never mounted (e.g. the AOI lacks the data). Evaluated on every tier change. */
  available?: () => boolean;
  /** Key rows for the keybind dialog (shown while the feature is mounted). */
  shortcuts?: readonly Shortcut[];
  /** Id of an earlier registration this one replaces (it is unmounted first). */
  replaces?: string;
  /** Mount into the host; return a teardown. No teardown = a reload is needed to unmount. */
  mount(host: H): void | Unmount | Promise<void | Unmount>;
}

export interface HostHandle<H> {
  host: H;
  /** Tier changed while mounted: attach / detach panel content (see FeatureDef.panelTier). */
  retier(tier: Tier): void;
  /** Remove every DOM node the host created for this feature. */
  release(): void;
}

export interface RegistryOptions<H> {
  tier: Tier;
  makeHost(def: FeatureDef<H>, tier: Tier): HostHandle<H>;
  /** Features without teardown were unmounted (ids); the shell reloads to drop their listeners. */
  onReloadNeeded?(ids: string[]): void;
  onError?(id: string, err: unknown): void;
}

type State = 'idle' | 'mounting' | 'mounted';

interface Entry<H> {
  def: FeatureDef<H>;
  state: State;
  handle: HostHandle<H> | null;
  unmount: Unmount | null;
  /** Bumped on every mount/unmount so a late async mount result can tell it is stale. */
  epoch: number;
}

export interface FeatureRegistry<H> {
  tier(): Tier;
  /** Mount everything eligible (registrations before start are queued). */
  start(): void;
  setTier(t: Tier): void;
  register(def: FeatureDef<H>): () => void;
  isMounted(id: string): boolean;
  /** Mounted feature ids in registration order. */
  mounted(): string[];
  defs(): FeatureDef<H>[];
  /** Called after any mount/unmount/tier change. Returns an unsubscribe. */
  onChange(cb: () => void): () => void;
}

export function createFeatureRegistry<H>(opts: RegistryOptions<H>): FeatureRegistry<H> {
  let tier = opts.tier;
  let started = false;
  const entries = new Map<string, Entry<H>>();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const cb of listeners) cb();
  };

  const eligible = (d: FeatureDef<H>) => {
    if (!tierAllows(tier, d.tier)) return false;
    try {
      return d.available?.() ?? true;
    } catch {
      return false;
    }
  };

  const fail = (e: Entry<H>, err: unknown) => {
    e.handle?.release();
    e.handle = null;
    e.state = 'idle';
    if (opts.onError) opts.onError(e.def.id, err);
    else console.error(`[shell] feature "${e.def.id}" failed to mount`, err);
  };

  const mount = (e: Entry<H>) => {
    if (e.state !== 'idle') return;
    const epoch = ++e.epoch;
    e.handle = opts.makeHost(e.def, tier);
    e.state = 'mounting';
    let res: ReturnType<FeatureDef<H>['mount']>;
    try {
      res = e.def.mount(e.handle.host);
    } catch (err) {
      fail(e, err);
      return;
    }
    const done = (un: void | Unmount) => {
      if (e.epoch !== epoch) {
        // Unmounted (tier lowered) while mounting: tear the late result down right away.
        if (typeof un === 'function') un();
        return;
      }
      e.unmount = typeof un === 'function' ? un : null;
      e.state = 'mounted';
      emit();
    };
    if (res && typeof (res as Promise<unknown>).then === 'function') {
      (res as Promise<void | Unmount>).then(done, (err) => {
        if (e.epoch === epoch) fail(e, err);
      });
    } else done(res as void | Unmount);
  };

  /** Returns true when the feature had no teardown (a reload is needed). */
  const unmount = (e: Entry<H>): boolean => {
    if (e.state === 'idle') return false;
    e.epoch++;
    const un = e.unmount;
    e.unmount = null;
    e.state = 'idle';
    try {
      un?.();
    } catch (err) {
      console.error(`[shell] feature "${e.def.id}" failed to unmount`, err);
    }
    e.handle?.release();
    e.handle = null;
    // A feature still mounting has run its side effects already: without teardown it needs a reload too.
    return !un;
  };

  const reconcile = () => {
    const stale: string[] = [];
    for (const e of entries.values()) {
      if (eligible(e.def)) {
        if (e.state === 'idle') mount(e);
        else e.handle?.retier(tier);
      } else if (e.state !== 'idle' && unmount(e)) stale.push(e.def.id);
    }
    if (stale.length) opts.onReloadNeeded?.(stale);
    emit();
  };

  return {
    tier: () => tier,
    start() {
      if (started) return;
      started = true;
      reconcile();
    },
    setTier(t) {
      if (t === tier) return;
      tier = t;
      if (started) reconcile();
    },
    register(def) {
      if (def.replaces && entries.has(def.replaces)) {
        const old = entries.get(def.replaces)!;
        if (unmount(old)) opts.onReloadNeeded?.([old.def.id]);
        entries.delete(def.replaces);
      }
      if (entries.has(def.id)) throw new Error(`[shell] feature "${def.id}" is already registered (use replaces)`);
      const e: Entry<H> = { def, state: 'idle', handle: null, unmount: null, epoch: 0 };
      entries.set(def.id, e);
      if (started && eligible(def)) mount(e);
      emit();
      return () => {
        if (entries.get(def.id) !== e) return;
        if (unmount(e)) opts.onReloadNeeded?.([def.id]);
        entries.delete(def.id);
        emit();
      };
    },
    isMounted: (id) => entries.get(id)?.state === 'mounted',
    mounted: () => [...entries.values()].filter((e) => e.state === 'mounted').map((e) => e.def.id),
    defs: () => [...entries.values()].map((e) => e.def),
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
