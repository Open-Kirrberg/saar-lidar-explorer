/**
 * V2.6: zone session state machine (contract "Enter and exit"):
 *
 *   overworld ──enter──▶ loading ──loaded──▶ zone ──exit──▶ overworld (restorePose = saved pose)
 *                           └──failed / cancel / exit──▶ overworld (restorePose = saved pose, message)
 *
 * Pure reducer: `zoneSession(state, event)` returns the next state, or the same object for an event
 * that does not apply (callers can compare by identity). The shell owns side effects: it pauses the
 * overworld on `loading`, mounts the zone on `zone`, applies `restorePose` (+ `restoreSnapshot`) on
 * `overworld` and then sends `restored`.
 */
import type { Pose, ZoneManifest } from './contract';
import { fallbackExitPose, findPortal } from './portal';

export type ZoneSessionState<S = unknown> =
  | { phase: 'overworld'; restorePose: Pose | null; restoreSnapshot: S | null; message: string | null }
  | { phase: 'loading' | 'zone'; zoneId: string; portalId: string; spawn: Pose; exitPose: Pose; snapshot: S | null };

export type ZoneEvent<S = unknown> =
  | {
      type: 'enter';
      zone: ZoneManifest;
      portalId: string;
      /** Current overworld camera pose; null for a deep link straight into the zone. */
      pose: Pose | null;
      /** Opaque overworld state to give back on exit (layers, tier, …). */
      snapshot?: S;
      /** Overworld terrain height at the portal (for the fallback exit pose). */
      groundH?: number;
    }
  | { type: 'loaded'; zoneId: string }
  | { type: 'failed'; zoneId: string; message?: string }
  | { type: 'cancel' }
  | { type: 'exit' }
  | { type: 'restored' };

export const MSG_LOAD_FAILED = 'Der Ort konnte nicht geladen werden.';

export function initialZoneSession<S = unknown>(): ZoneSessionState<S> {
  return { phase: 'overworld', restorePose: null, restoreSnapshot: null, message: null };
}

const back = <S>(s: Extract<ZoneSessionState<S>, { phase: 'loading' | 'zone' }>, message: string | null): ZoneSessionState<S> => ({
  phase: 'overworld',
  restorePose: { ...s.exitPose },
  restoreSnapshot: s.snapshot,
  message,
});

export function zoneSession<S = unknown>(state: ZoneSessionState<S>, ev: ZoneEvent<S>): ZoneSessionState<S> {
  switch (ev.type) {
    case 'enter': {
      if (state.phase !== 'overworld') return state;
      const portal = findPortal(ev.zone, ev.portalId);
      const spawn = portal && ev.zone.spawns[portal.spawn];
      if (!portal || !spawn) return state;
      return {
        phase: 'loading',
        zoneId: ev.zone.id,
        portalId: portal.id,
        spawn: { ...spawn },
        exitPose: ev.pose ? { ...ev.pose } : fallbackExitPose(ev.zone, portal, ev.groundH),
        snapshot: ev.snapshot ?? null,
      };
    }
    case 'loaded':
      return state.phase === 'loading' && state.zoneId === ev.zoneId ? { ...state, phase: 'zone' } : state;
    case 'failed':
      return state.phase === 'loading' && state.zoneId === ev.zoneId ? back(state, ev.message ?? MSG_LOAD_FAILED) : state;
    case 'cancel':
      return state.phase === 'loading' ? back(state, null) : state;
    case 'exit':
      return state.phase === 'zone' || state.phase === 'loading' ? back(state, null) : state;
    case 'restored':
      return state.phase === 'overworld' && (state.restorePose || state.message || state.restoreSnapshot !== null)
        ? initialZoneSession<S>()
        : state;
  }
}
