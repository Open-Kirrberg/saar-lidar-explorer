/**
 * V2.6b: overworld ↔ zone flow. Drives the pure session reducer (../session.ts) and owns the side
 * effects through injected ports, so the whole round trip runs in vitest without three or a DOM:
 *
 *   enter: save pose + snapshot → freeze overworld → loading screen → import() module → mountZone
 *          → close loading → chrome → handle.resize + enter(spawn) → host renders handle.frame
 *   exit:  stop frames → handle.exit + dispose → restore pose + snapshot → unfreeze
 *   cancel / load error / frame error: dispose what exists → restore → (German message)
 */
import type { Pose, ZoneManifest } from '../contract';
import { findPortal, updatePortalFocus } from '../portal';
import type { PortalFocus } from '../portal';
import { initialZoneSession, zoneSession } from '../session';
import type { ZoneSessionState } from '../session';
import type { ZoneHandle, ZoneModule, ZoneMountContext } from './api';

export const MSG_FRAME_FAILED = 'Der Ort wurde wegen eines Fehlers verlassen.';
export const MSG_NO_RUNTIME = 'Für diesen Ort fehlt die Darstellung in dieser Version.';

/** Overworld side: pose in/out and input/streaming freeze. */
export interface OverworldPort<S> {
  pose(): Pose;
  snapshot(): S;
  /** Put the camera back exactly (pose + snapshot from enter). */
  restore(pose: Pose, snapshot: S | null): void;
  /** true: overworld input off, streaming paused (frames owned by the zone). false: back on. */
  freeze(on: boolean): void;
}

export interface LoadingUi {
  progress(p: number | null, text?: string): void;
  close(): void;
}

export interface ZoneFlowDeps<S> {
  overworld: OverworldPort<S>;
  /** Resolve the zone's module (registry + `import()`); reject = load failure. */
  loadModule(zone: ZoneManifest): Promise<ZoneModule>;
  /** Host parts of the mount context (container, renderer, baseUrl …). */
  mountContext(zone: ZoneManifest): Omit<ZoneMountContext, 'onExit' | 'onProgress' | 'signal'> & { release?(): void };
  /** Loading screen with an *Abbrechen* action. */
  loading(zone: ZoneManifest, onCancel: () => void): LoadingUi;
  /** In-zone chrome (*Verlassen*, title, attribution); null when the module draws its own. */
  chrome(zone: ZoneManifest, onExit: () => void): { close(): void } | null;
  /** Frame ownership: a callback renders instead of the overworld; null = overworld again. */
  ownFrames(fn: ((dt: number) => void) | null): void;
  /** View size in CSS pixels. */
  viewSize(): [number, number];
  message(text: string): void;
  warn?(m: string, err?: unknown): void;
}

export interface ZoneFlow<S> {
  state(): ZoneSessionState<S>;
  /** The mounted handle (phase `zone`), for tests and debugging. */
  handle(): ZoneHandle | null;
  /** Enter the portal's zone; resolves once the zone shows or the flow is back in the overworld. */
  enter(zone: ZoneManifest, portalId: string): Promise<void>;
  cancel(): void;
  exit(): void;
}

interface Active {
  zone: ZoneManifest;
  ac: AbortController;
  loading: LoadingUi | null;
  chrome: { close(): void } | null;
  handle: ZoneHandle | null;
  release?: () => void;
  size: [number, number];
}

const isAbort = (err: unknown) => err instanceof Error && err.name === 'AbortError';

export function createZoneFlow<S>(deps: ZoneFlowDeps<S>): ZoneFlow<S> {
  const warn = deps.warn ?? ((m, err) => console.warn(`[zones] ${m}`, err ?? ''));
  let s: ZoneSessionState<S> = initialZoneSession<S>();
  let active: Active | null = null;

  const teardown = (a: Active) => {
    deps.ownFrames(null);
    a.loading?.close();
    a.chrome?.close();
    const h = a.handle;
    a.handle = null;
    if (h) {
      try {
        h.exit();
      } catch (err) {
        warn('zone exit() failed', err);
      }
      try {
        h.dispose();
      } catch (err) {
        warn('zone dispose() failed', err);
      }
    }
    try {
      a.release?.();
    } catch (err) {
      warn('zone container release failed', err);
    }
  };

  /** `s` is the overworld state with restorePose; finish the way back. */
  const backToOverworld = (a: Active) => {
    if (active === a) active = null;
    teardown(a);
    if (s.phase === 'overworld') {
      if (s.restorePose) deps.overworld.restore(s.restorePose, s.restoreSnapshot);
      deps.overworld.freeze(false);
      if (s.message) deps.message(s.message);
      s = zoneSession(s, { type: 'restored' });
    }
  };

  const fail = (a: Active, message: string, err?: unknown) => {
    if (active !== a) return;
    warn(`zone ${a.zone.id}: ${message}`, err);
    s = zoneSession(s, { type: 'failed', zoneId: a.zone.id, message });
    backToOverworld(a);
  };

  const flow: ZoneFlow<S> = {
    state: () => s,
    handle: () => active?.handle ?? null,

    async enter(zone, portalId) {
      if (s.phase !== 'overworld' || active) return;
      const portal = findPortal(zone, portalId);
      if (!portal) return;
      const next = zoneSession(s, { type: 'enter', zone, portalId, pose: deps.overworld.pose(), snapshot: deps.overworld.snapshot() });
      if (next.phase !== 'loading') return;
      s = next;
      const spawn = next.spawn;
      const a: Active = { zone, ac: new AbortController(), loading: null, chrome: null, handle: null, size: [0, 0] };
      active = a;
      deps.overworld.freeze(true);
      deps.ownFrames(() => {}); // hold the last overworld frame under the loading screen
      a.loading = deps.loading(zone, () => flow.cancel());
      a.loading.progress(0, 'Lade Programm …');

      let handle: ZoneHandle;
      try {
        const mod = await deps.loadModule(zone);
        if (active !== a || a.ac.signal.aborted) return;
        a.loading.progress(0.1, 'Lade Ort …');
        const { release, ...host } = deps.mountContext(zone);
        a.release = release;
        handle = await mod.mountZone({
          ...host,
          signal: a.ac.signal,
          onExit: () => {
            if (active === a) flow.exit();
          },
          onProgress: (label, f) => {
            if (active === a && s.phase === 'loading') a.loading?.progress(0.1 + 0.9 * Math.min(1, Math.max(0, f)), label);
          },
        });
        if (active !== a || a.ac.signal.aborted) {
          try {
            handle.dispose(); // resolved after cancel
          } catch (err) {
            warn('late zone dispose() failed', err);
          }
          return;
        }
        a.handle = handle;
        if (mod.hostChrome !== false) a.chrome = deps.chrome(zone, () => flow.exit());
      } catch (err) {
        if (active !== a || isAbort(err)) return;
        return fail(a, (err as { userMessage?: string })?.userMessage ?? 'Der Ort konnte nicht geladen werden.', err);
      }

      s = zoneSession(s, { type: 'loaded', zoneId: zone.id });
      a.loading.close();
      a.loading = null;
      try {
        a.size = deps.viewSize();
        handle.resize(a.size[0], a.size[1]);
        handle.enter(spawn);
      } catch (err) {
        return fail2(a, err);
      }
      deps.ownFrames((dt) => {
        if (active !== a || !a.handle) return;
        try {
          const size = deps.viewSize();
          if (size[0] !== a.size[0] || size[1] !== a.size[1]) {
            a.size = size;
            a.handle.resize(size[0], size[1]);
          }
          a.handle.frame(dt);
        } catch (err) {
          fail2(a, err);
        }
      });
    },

    cancel() {
      const a = active;
      if (!a || s.phase !== 'loading') return;
      a.ac.abort();
      s = zoneSession(s, { type: 'cancel' });
      backToOverworld(a);
    },

    exit() {
      const a = active;
      if (!a) return;
      if (s.phase === 'loading') return flow.cancel();
      if (s.phase !== 'zone') return;
      s = zoneSession(s, { type: 'exit' });
      backToOverworld(a);
    },
  };

  /** Failure after the zone was shown (enter / frame threw): leave with a message. */
  function fail2(a: Active, err: unknown) {
    if (active !== a) return;
    warn(`zone ${a.zone.id} crashed`, err);
    s = zoneSession(s, { type: 'exit' });
    if (s.phase === 'overworld') s = { ...s, message: MSG_FRAME_FAILED };
    backToOverworld(a);
  }

  return flow;
}

/** Portal prompt with hysteresis (contract): opens on a new focus, closes beyond `radius · 1.1`. */
export interface PortalPrompter {
  /** Feed the camera position; returns the current focus. */
  update(E: number, N: number): PortalFocus | null;
  focus(): PortalFocus | null;
  /** Hide now (entering, unmount); the next `update` may offer again. */
  close(): void;
}

export function createPortalPrompter(
  zones: () => readonly ZoneManifest[],
  show: (f: PortalFocus) => { close(): void },
): PortalPrompter {
  let focus: PortalFocus | null = null;
  let open: { close(): void } | null = null;
  const close = () => {
    open?.close();
    open = null;
  };
  return {
    update(E, N) {
      const next = updatePortalFocus(focus, zones(), E, N);
      const changed = (next?.zoneId ?? '') + '/' + (next?.portalId ?? '') !== (focus?.zoneId ?? '') + '/' + (focus?.portalId ?? '');
      focus = next;
      if (changed || (next && !open)) {
        close();
        if (next) open = show(next);
      }
      return focus;
    },
    focus: () => focus,
    close() {
      close();
      focus = null;
    },
  };
}
