/**
 * F20 "Mein Standort": browser geolocation → EPSG:25832 → world frame; inside the AOI fly there
 * and show "Sie sind hier" (3D + minimap), outside say how far away it is and offer the nearest
 * point. "Folgen" keeps watching the position; "Kompass" adds a heading arrow from
 * DeviceOrientation (iOS asks for permission on the button tap).
 *
 * PRIVACY: the position is kept in memory only — never written to localStorage, the store/URL
 * hash, reports, the console or any request. `LocateState` deliberately carries no coordinates.
 * The camera pose itself would give the position away (the locate flight is deterministic), so
 * `revealsPosition(pose)` tells the URL-hash writer and "Ansicht teilen" to hold back while a
 * locate flight runs or the camera / view centre is within `PRIVACY_RADIUS_M` of the last fix —
 * also after "Ausblenden", until the camera has left that zone once.
 *
 * API for other UIs (mobile toolbar): `getLocate()` after `initLocate()`, or the return value.
 */
import type { Scene } from 'three';
import { gridConvergenceDeg, utmToWgs84, wgs84ToUtm } from '../geo';
import type { AppContext } from '../main';
import type { Minimap } from '../map/Minimap';
import type { Labels3D } from '../ui/Labels3D';
import { LocateLayer } from './LocateLayer';
import type { LocateFix } from './LocateLayer';
import {
  aoiRect,
  compassHeading,
  distanceToRect,
  errorKindFromCode,
  errorMessageDe,
  formatAccuracyDe,
  insideRect,
  nearestPointInRect,
  outsideMessageDe,
  poseRevealsPoint,
  shouldRecenter,
  trueToGridHeading,
} from './locateMath';
import type { LocateErrorKind, OrientationLike, PoseLike } from './locateMath';

export type LocateStatus = 'idle' | 'locating' | 'inside' | 'outside' | 'error';
export type CompassStatus = 'off' | 'waiting' | 'on' | 'unavailable' | 'denied';

/** UI state (no coordinates on purpose). */
export interface LocateState {
  status: LocateStatus;
  /** German status line for the UI. */
  message: string;
  follow: boolean;
  compass: CompassStatus;
  /** Accuracy radius (m) of the last fix. */
  accuracy?: number;
  /** Distance to the AOI (m) when outside. */
  distanceM?: number;
  error?: LocateErrorKind;
  /** Is DeviceOrientation present at all (show a compass button)? */
  compassSupported: boolean;
}

export interface LocateApi {
  /** One-shot fix; flies there when inside the AOI. Call from a user gesture. */
  locateMe(): Promise<LocateState>;
  /** Start/stop following (watchPosition + camera recentring). Returns the new follow state. */
  toggleFollow(on?: boolean): boolean;
  /** Start/stop the compass arrow (iOS: must be called from a user gesture). */
  toggleCompass(on?: boolean): Promise<CompassStatus>;
  /** When outside: fly to the nearest point inside the AOI, looking towards the user. */
  flyToNearest(): Promise<boolean>;
  /** Hide the marker, stop following/compass and forget the position. */
  clear(): void;
  /**
   * Would publishing this camera pose (URL hash, share link) reveal the user's position? True
   * during a locate flight and while the camera or view centre is near the last fix.
   */
  revealsPosition(pose: PoseLike): boolean;
  getState(): Readonly<LocateState>;
  /** Subscribe to state changes (called immediately). Returns an unsubscribe function. */
  onState(cb: (s: Readonly<LocateState>) => void): () => void;
}

export interface LocateDeps {
  minimap?: Minimap | null;
  labels: Labels3D;
}

const TIMEOUT_MS = 15000;
const FLY_AGL = 150; // true metres above ground
const FLY_PITCH = -45;
const NEAREST_INSET = 150;
const COMPASS_WAIT_MS = 3000;

let instance: LocateApi | null = null;

/** The app-wide instance (null before initLocate). */
export function getLocate(): LocateApi | null {
  return instance;
}

export function createLocate(ctx: AppContext, deps: LocateDeps): LocateApi {
  const { manifest, terrain, scene, camera, renderer, controller, store } = ctx;
  const origin = manifest.origin;
  const rect = aoiRect(manifest);
  const layer = new LocateLayer(terrain, deps.labels, origin, deps.minimap?.map ?? null);
  scene.add(layer);
  hookFrame(scene);

  const geo: Geolocation | undefined = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
  const compassSupported = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  let state: LocateState = { status: 'idle', message: '', follow: false, compass: 'off', compassSupported };
  const subs = new Set<(s: Readonly<LocateState>) => void>();
  const setState = (patch: Partial<LocateState>) => {
    state = { ...state, ...patch };
    for (const cb of subs) cb(state);
  };

  // Memory only (see PRIVACY above).
  let fix: LocateFix | null = null;
  let lastFlown: { E: number; N: number } | null = null;
  let watchId: number | null = null;
  let requestGen = 0;
  // Privacy zone for the URL hash / share link (memory only): outlives clear() until the camera
  // has left it, so "Ausblenden" does not publish the pose next to the user.
  let zone: { E: number; N: number; groundH: number } | null = null;
  let flightsInProgress = 0;

  function setZone(E: number, N: number): void {
    const w = { x: E - origin.E0, z: -(N - origin.N0) };
    const g = terrain.heightAt(w.x, w.z);
    zone = { E, N, groundH: Number.isFinite(g) ? g : store.get().h - store.get().agl };
  }

  /** Track a locate-triggered flight: its path converges on (or points at) the user. */
  function guardFlight(p: Promise<boolean>): Promise<boolean> {
    flightsInProgress++;
    return p.finally(() => flightsInProgress--);
  }

  function revealsPosition(pose: PoseLike): boolean {
    if (flightsInProgress > 0) return true;
    if (!zone) return false;
    if (poseRevealsPoint(pose, zone.E, zone.N, zone.groundH)) return true;
    if (!fix) zone = null; // left the zone after "Ausblenden": nothing to protect any more
    return false;
  }

  function precheck(): LocateErrorKind | null {
    if (!geo) return 'unsupported';
    if (typeof window !== 'undefined' && window.isSecureContext === false) return 'insecure';
    return null;
  }

  function fail(kind: LocateErrorKind): LocateState {
    setState({ status: 'error', error: kind, message: errorMessageDe(kind) });
    return state;
  }

  function flyToFix(f: LocateFix, follow: boolean): void {
    lastFlown = { E: f.E, N: f.N };
    const exag = terrain.uniforms.uExag.value;
    if (follow) {
      // Keep the user's current view (height, pitch), just move along.
      const pitch = Math.min(Math.max(store.get().pitch, -89), -20);
      void guardFlight(ctx.flyTo(f.E, f.N, { agl: Math.max(controller.agl, 20), pitch, lookAt: true, duration: 1.2 }));
    } else {
      void guardFlight(ctx.flyTo(f.E, f.N, { agl: FLY_AGL * exag, pitch: FLY_PITCH, lookAt: true }));
    }
  }

  function applyPosition(p: GeolocationPosition, mode: 'once' | 'watch'): LocateState {
    const { E, N } = wgs84ToUtm(p.coords.latitude, p.coords.longitude);
    const accuracy = Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : NaN;
    fix = { E, N, accuracy };
    setZone(E, N);
    const inside = insideRect(rect, E, N);
    layer.setFix(fix, inside);
    if (state.compass === 'on') applyHeading(); // re-evaluate convergence at the new position
    if (inside) {
      if (mode === 'once') {
        deps.minimap?.endTemporaryView(); // an earlier "outside" overview no longer applies
        flyToFix(fix, false);
      }
      else if (shouldRecenter(lastFlown, E, N)) flyToFix(fix, lastFlown !== null);
      setState({
        status: 'inside',
        error: undefined,
        accuracy,
        distanceM: 0,
        message: `Sie sind hier (Genauigkeit ${formatAccuracyDe(accuracy)}).`,
      });
    } else {
      const d = distanceToRect(rect, E, N);
      if (mode === 'once') fitMinimap();
      setState({ status: 'outside', error: undefined, accuracy, distanceM: d, message: outsideMessageDe(d) });
    }
    return state;
  }

  function fitMinimap(): void {
    const mm = deps.minimap;
    const ll = layer.mapLatLng();
    if (!mm || !ll) return;
    // The minimap follows the camera by default; show both the AOI and the user instead. Nothing
    // is persisted, and while the map is hidden (mobile sheet) the fit waits until it is shown.
    const sw = utmToWgs84(rect.Emin, rect.Nmin);
    const ne = utmToWgs84(rect.Emax, rect.Nmax);
    mm.showBounds([[sw.lat, sw.lon], [ne.lat, ne.lon], [ll.lat, ll.lng]]);
  }

  function onGeoError(err: GeolocationPositionError): void {
    const kind = errorKindFromCode(err.code);
    if (kind === 'denied') stopWatch();
    fail(kind);
  }

  const options: PositionOptions = { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: 5000 };

  function locateMe(): Promise<LocateState> {
    const pre = precheck();
    if (pre) return Promise.resolve(fail(pre));
    const gen = ++requestGen;
    setState({ status: 'locating', error: undefined, message: 'Standort wird bestimmt …' });
    return new Promise<LocateState>((resolve) => {
      geo!.getCurrentPosition(
        (p) => resolve(gen === requestGen ? applyPosition(p, 'once') : state),
        (e) => {
          if (gen === requestGen) onGeoError(e);
          resolve(state);
        },
        options,
      );
    });
  }

  function stopWatch(): void {
    if (watchId !== null && geo) geo.clearWatch(watchId);
    watchId = null;
    if (state.follow) setState({ follow: false });
  }

  function toggleFollow(on = !state.follow): boolean {
    if (!on) {
      stopWatch();
      return false;
    }
    const pre = precheck();
    if (pre) {
      fail(pre);
      return false;
    }
    if (watchId === null) {
      lastFlown = null; // first watch fix flies there like "Mein Standort"
      if (state.status !== 'inside' && state.status !== 'outside')
        setState({ status: 'locating', error: undefined, message: 'Standort wird bestimmt …' });
      watchId = geo!.watchPosition(
        (p) => {
          requestGen++; // a pending one-shot answer is superseded
          applyPosition(p, lastFlown === null && state.status !== 'outside' ? 'once' : 'watch');
        },
        onGeoError,
        options,
      );
    }
    setState({ follow: true });
    return true;
  }

  async function flyToNearest(): Promise<boolean> {
    if (!fix) return false;
    const t = nearestPointInRect(rect, fix.E, fix.N, NEAREST_INSET);
    // Look from the AOI towards the user (grid heading).
    const heading = ((Math.atan2(fix.E - t.E, fix.N - t.N) * 180) / Math.PI + 360) % 360;
    deps.minimap?.endTemporaryView();
    return guardFlight(ctx.flyTo(t.E, t.N, { agl: FLY_AGL * terrain.uniforms.uExag.value, pitch: -30, heading, lookAt: true }));
  }

  // ---- compass --------------------------------------------------------------------------------
  let lastTrueHeading: number | null = null;
  let compassTimer: ReturnType<typeof setTimeout> | null = null;
  const orientationEvent =
    typeof window !== 'undefined' && 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';

  function screenAngle(): number {
    const so = typeof screen !== 'undefined' ? screen.orientation : undefined;
    if (so && typeof so.angle === 'number') return so.angle;
    const wo = (window as unknown as { orientation?: number }).orientation;
    return typeof wo === 'number' ? wo : 0;
  }

  function applyHeading(): void {
    if (lastTrueHeading === null || !fix) {
      layer.setHeading(lastTrueHeading, lastTrueHeading);
      return;
    }
    layer.setHeading(lastTrueHeading, trueToGridHeading(lastTrueHeading, gridConvergenceDeg(fix.E, fix.N)));
  }

  const onOrientation = (e: Event) => {
    const h = compassHeading(e as unknown as OrientationLike, screenAngle());
    if (h === null) return;
    lastTrueHeading = h;
    if (state.compass !== 'on') setState({ compass: 'on' });
    if (compassTimer) clearTimeout(compassTimer);
    compassTimer = null;
    applyHeading();
  };

  function stopCompass(status: CompassStatus = 'off'): CompassStatus {
    window.removeEventListener(orientationEvent, onOrientation);
    if (compassTimer) clearTimeout(compassTimer);
    compassTimer = null;
    lastTrueHeading = null;
    layer.setHeading(null, null);
    setState({ compass: status });
    return status;
  }

  async function toggleCompass(on = state.compass === 'off' || state.compass === 'unavailable' || state.compass === 'denied'): Promise<CompassStatus> {
    if (!on) return stopCompass();
    if (!compassSupported) return stopCompass('unavailable');
    const DOE = (window as unknown as { DeviceOrientationEvent: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    if (typeof DOE.requestPermission === 'function') {
      try {
        if ((await DOE.requestPermission()) !== 'granted') return stopCompass('denied');
      } catch {
        return stopCompass('denied'); // not called from a user gesture, or blocked
      }
    }
    window.addEventListener(orientationEvent, onOrientation);
    setState({ compass: 'waiting' });
    if (compassTimer) clearTimeout(compassTimer);
    compassTimer = setTimeout(() => {
      if (state.compass === 'waiting') stopCompass('unavailable');
    }, COMPASS_WAIT_MS);
    return state.compass;
  }

  function clear(): void {
    requestGen++;
    stopWatch();
    if (state.compass !== 'off') stopCompass();
    fix = null;
    lastFlown = null;
    layer.setFix(null, false);
    deps.minimap?.endTemporaryView();
    setState({ status: 'idle', message: '', accuracy: undefined, distanceM: undefined, error: undefined, follow: false });
  }

  function hookFrame(sc: Scene): void {
    const prev = sc.onBeforeRender.bind(sc);
    sc.onBeforeRender = (...args: Parameters<Scene['onBeforeRender']>) => {
      prev(...args);
      if (args[2] !== camera) return;
      layer.update(camera, renderer);
    };
  }

  const api: LocateApi = {
    locateMe,
    toggleFollow,
    toggleCompass,
    flyToNearest,
    clear,
    revealsPosition,
    getState: () => state,
    onState(cb) {
      subs.add(cb);
      cb(state);
      return () => subs.delete(cb);
    },
  };
  instance = api;
  return api;
}
