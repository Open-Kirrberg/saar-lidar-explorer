/**
 * Tiny observable store + URL-hash sync for bookmarks.
 *
 * Subscribers (e.g. the Leaflet minimap) can listen to a subset of keys:
 *   const off = store.subscribe((s, changed, source) => …, ['E', 'N', 'heading']);
 * `source` tells who changed it ('camera', 'gui', 'hash', 'map', …) to avoid feedback loops.
 */

export interface AppState {
  /** Camera position, EPSG:25832 metres. */
  E: number;
  N: number;
  /** Camera height above sea level (m ü. NN, true scale). */
  h: number;
  /** Camera height above ground (true scale). */
  agl: number;
  /** Degrees clockwise from grid north. */
  heading: number;
  /** Degrees, negative = looking down. */
  pitch: number;
  /** Ground speed m/s. */
  speed: number;
  /** Display key: 'live-hillshade' | 'live-slope' | 'live-lrm' | manifest layer key. */
  layer: string;
  colormap: 'auto' | 'gray' | 'diverging' | 'viridis';
  exaggeration: number;
  /** Degrees clockwise from north. */
  sunAzimuth: number;
  /** Degrees above horizon. */
  sunElevation: number;
  /** 1 = single light, >1 = multi-directional hillshade. */
  sunDirections: number;
  /** Overlay display key ('' = no overlay). Mirrors Terrain.getOverlay().key. */
  overlay: string;
  /** Overlay opacity 0–1. Mirrors Terrain.getOverlay().opacity. */
  overlayOpacity: number;
  /** Forest (canopy) display. Mirrors Terrain.forest.mode. */
  forest: ForestMode;
  /**
   * Active blend preset id ('' = none). Written by the relief panel; a preset carries the overlay
   * blend/colormap/stretch/shade and the live-LRM radius, which have no store fields of their own.
   */
  preset: string;
}

/** Same values as Terrain's ForestMode (kept here so state.ts stays free of three imports). */
export type ForestMode = 'off' | 'transparent' | 'full';
export const FOREST_MODES: readonly ForestMode[] = ['off', 'transparent', 'full'];

export type StateKey = keyof AppState;
export type Listener<S> = (state: Readonly<S>, changed: ReadonlySet<keyof S>, source: string) => void;

export class Store<S extends object> {
  private state: S;
  private readonly listeners = new Set<{ fn: Listener<S>; keys?: ReadonlySet<keyof S> }>();

  constructor(initial: S) {
    this.state = { ...initial };
  }

  get(): Readonly<S> {
    return this.state;
  }

  /** Shallow-merge `patch`; listeners fire only for keys whose value actually changed. */
  set(patch: Partial<S>, source = 'app'): void {
    const changed = new Set<keyof S>();
    for (const k of Object.keys(patch) as Array<keyof S>) {
      const v = patch[k];
      if (v !== undefined && !Object.is(this.state[k], v)) changed.add(k);
    }
    if (changed.size === 0) return;
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) {
      if (!l.keys || [...changed].some((k) => l.keys!.has(k))) l.fn(this.state, changed, source);
    }
  }

  subscribe(fn: Listener<S>, keys?: Array<keyof S>): () => void {
    const entry = { fn, keys: keys ? new Set(keys) : undefined };
    this.listeners.add(entry);
    return () => this.listeners.delete(entry);
  }
}

export const CAMERA_KEYS: StateKey[] = ['E', 'N', 'h', 'agl', 'heading', 'pitch', 'speed'];

export function createStore(initial?: Partial<AppState>): Store<AppState> {
  return new Store<AppState>({
    E: 0,
    N: 0,
    h: 0,
    agl: 0,
    heading: 0,
    pitch: -25,
    speed: 0,
    layer: 'live-hillshade',
    colormap: 'auto',
    exaggeration: 1,
    sunAzimuth: 315,
    sunElevation: 35,
    sunDirections: 1,
    overlay: '',
    overlayOpacity: 0.5,
    forest: 'off',
    preset: '',
    ...initial,
  });
}

// ---- URL hash ------------------------------------------------------------------------------
//
//   #E,N,h,heading,pitch,layer,overlay,overlayOpacity,forest,exaggeration,sunAzimuth,sunElevation,sunDirections,preset
//
// Fields 6–14 are optional trailing fields: older bookmarks (5, 6, 9 or 13 fields) still parse, and
// the missing fields simply leave the current state alone. An empty overlay field means "no overlay".
// Fields 10–13 (final polish, "Ansicht teilen") carry the vertical exaggeration and the sun.
// Field 14 is the active blend preset id (written only when one is active): the preset restores the
// overlay blend/colormap/stretch/shade and the LRM radius; fields 6–13 are applied on top of it.
// With fields 10–13 present, a missing field 14 means "no preset".
// Markers, candidates and measurements are never part of the hash (heritage privacy, docs/adr/0009).

export interface HashPose {
  E: number;
  N: number;
  h: number;
  heading: number;
  pitch: number;
  layer?: string;
  /** '' = overlay explicitly off; undefined = not in the hash. */
  overlay?: string;
  overlayOpacity?: number;
  forest?: ForestMode;
  exaggeration?: number;
  sunAzimuth?: number;
  sunElevation?: number;
  sunDirections?: number;
  /** '' = no preset; undefined = not in the hash (pre-13-field bookmarks). */
  preset?: string;
}

/** Hash fields 10–13. Optional in `HashState` so callers without them still format 9-field hashes. */
export type HashViewState = Partial<Pick<AppState, 'exaggeration' | 'sunAzimuth' | 'sunElevation' | 'sunDirections' | 'preset'>>;

export type HashState = Pick<
  AppState,
  'E' | 'N' | 'h' | 'heading' | 'pitch' | 'layer' | 'overlay' | 'overlayOpacity' | 'forest'
> &
  HashViewState;

/** Store keys that are written to the URL hash. */
export const HASH_KEYS: StateKey[] = [
  'E', 'N', 'h', 'heading', 'pitch', 'layer', 'overlay', 'overlayOpacity', 'forest',
  'exaggeration', 'sunAzimuth', 'sunElevation', 'sunDirections', 'preset',
];

/** Preset ids as they may appear in the hash. */
const PRESET_ID = /^[\w-]{1,40}$/;

/** Valid ranges of the view fields (same as the panel sliders). */
export const EXAG_RANGE = { min: 1, max: 5 } as const;
export const SUN_ELEVATION_RANGE = { min: 1, max: 90 } as const;
export const SUN_DIRECTIONS_RANGE = { min: 1, max: 16 } as const;

export const clampExaggeration = (v: number) => clamp(v, EXAG_RANGE.min, EXAG_RANGE.max);
export const clampSunElevation = (v: number) => clamp(v, SUN_ELEVATION_RANGE.min, SUN_ELEVATION_RANGE.max);
export const clampSunDirections = (v: number) => Math.round(clamp(v, SUN_DIRECTIONS_RANGE.min, SUN_DIRECTIONS_RANGE.max));

export function formatHash(s: HashState): string {
  const r = (v: number, d: number) => String(Math.round(v * 10 ** d) / 10 ** d);
  let out =
    `#${r(s.E, 1)},${r(s.N, 1)},${r(s.h, 1)},${r(normDeg(s.heading), 1)},${r(s.pitch, 1)},${encodeURIComponent(s.layer)}` +
    `,${encodeURIComponent(s.overlay)},${r(clamp01(s.overlayOpacity), 2)},${s.forest}`;
  const { exaggeration: ex, sunAzimuth: az, sunElevation: el, sunDirections: dirs } = s;
  if (ex !== undefined && az !== undefined && el !== undefined && dirs !== undefined) {
    out += `,${r(clampExaggeration(ex), 2)},${r(normDeg(az), 1)},${r(clampSunElevation(el), 1)},${clampSunDirections(dirs)}`;
    if (s.preset && PRESET_ID.test(s.preset)) out += `,${s.preset}`;
  }
  return out;
}

/** decodeURIComponent that returns null instead of throwing on malformed escapes ("%E0%A4%A"). */
export function safeDecode(v: string): string | null {
  try {
    return decodeURIComponent(v);
  } catch {
    return null;
  }
}

/** Strict number parse: '' / whitespace / non-numeric → NaN (unlike Number('') === 0). */
function num(v: string | undefined): number {
  return v === undefined || v.trim() === '' ? NaN : Number(v);
}

export function parseHash(hash: string): HashPose | null {
  const parts = hash.replace(/^#/, '').split(',');
  if (parts.length < 5) return null;
  const [E, N, h, heading, pitch] = parts.slice(0, 5).map(num);
  if (![E, N, h, heading, pitch].every(Number.isFinite)) return null;
  const pose: HashPose = { E, N, h, heading: normDeg(heading), pitch: Math.max(-89, Math.min(89, pitch)) };
  const layer = parts[5] ? safeDecode(parts[5]) : null;
  if (layer) pose.layer = layer;
  if (parts.length > 6) {
    const overlay = safeDecode(parts[6]);
    if (overlay !== null) pose.overlay = overlay;
  }
  const op = num(parts[7]);
  if (Number.isFinite(op)) pose.overlayOpacity = clamp01(op);
  const forest = parts[8] as ForestMode | undefined;
  if (forest && FOREST_MODES.includes(forest)) pose.forest = forest;
  // Fields 10–13: each one independently; invalid values are dropped (state left alone).
  const ex = num(parts[9]);
  if (Number.isFinite(ex) && ex > 0) pose.exaggeration = clampExaggeration(ex);
  const az = num(parts[10]);
  if (Number.isFinite(az)) pose.sunAzimuth = normDeg(az);
  const el = num(parts[11]);
  if (Number.isFinite(el)) pose.sunElevation = clampSunElevation(el);
  const dirs = num(parts[12]);
  if (Number.isFinite(dirs)) pose.sunDirections = clampSunDirections(dirs);
  // Field 14: only meaningful in a hash that has the view fields (13+ fields).
  if (parts.length >= 13) {
    const pr = parts[13] ?? '';
    pose.preset = PRESET_ID.test(pr) ? pr : '';
  }
  return pose;
}

export interface HashValidators {
  /** Accepts a display key (base layer / overlay), e.g. `terrain.isValidDisplay`. */
  isValidLayer?: (key: string) => boolean;
}

/**
 * The display part of a parsed hash as a store patch, dropping layers the validator rejects
 * (pose fields are not included). Unknown overlay keys turn into "no overlay".
 */
export function hashDisplayPatch(p: HashPose, v: HashValidators = {}): Partial<AppState> {
  const ok = v.isValidLayer ?? (() => true);
  const patch: Partial<AppState> = {};
  if (p.layer && ok(p.layer)) patch.layer = p.layer;
  if (p.overlay !== undefined) patch.overlay = p.overlay === '' || ok(p.overlay) ? p.overlay : '';
  if (p.overlayOpacity !== undefined) patch.overlayOpacity = p.overlayOpacity;
  if (p.forest !== undefined) patch.forest = p.forest;
  if (p.exaggeration !== undefined) patch.exaggeration = p.exaggeration;
  if (p.sunAzimuth !== undefined) patch.sunAzimuth = p.sunAzimuth;
  if (p.sunElevation !== undefined) patch.sunElevation = p.sunElevation;
  if (p.sunDirections !== undefined) patch.sunDirections = p.sunDirections;
  if (p.preset !== undefined) patch.preset = p.preset;
  return patch;
}

/** Display fields a link sets on top of its preset (the preset itself would overwrite them). */
export const PRESET_OVERRIDE_KEYS = [
  'layer', 'overlay', 'overlayOpacity', 'sunAzimuth', 'sunElevation', 'sunDirections',
] as const satisfies readonly StateKey[];

export function presetOverrides(s: Readonly<AppState>): Partial<AppState> {
  const out: Partial<AppState> = {};
  for (const k of PRESET_OVERRIDE_KEYS) (out as Record<string, unknown>)[k] = s[k];
  return out;
}

/** Full store patch (pose + validated display fields) for a parsed hash. */
export function hashPatch(p: HashPose, v: HashValidators = {}): Partial<AppState> {
  return { E: p.E, N: p.N, h: p.h, heading: p.heading, pitch: p.pitch, ...hashDisplayPatch(p, v) };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * URL to share the current view ("Ansicht teilen"): the page URL with the hash rebuilt from the
 * store (pose, display, exaggeration, sun, blend preset) — never markers, candidates or measurements.
 */
export function shareUrl(loc: { origin: string; pathname: string; search: string }, s: HashState): string {
  return `${loc.origin}${loc.pathname}${loc.search}${formatHash(s)}`;
}

export function normDeg(d: number): number {
  // Not ((d % 360) + 360) % 360: that turns 123.4 into 123.39999999999998 (hash round trips).
  const r = d % 360;
  return r < 0 ? r + 360 : r + 0; // + 0 turns -0 into 0
}

/**
 * Keep location.hash in sync with the store (throttled, replaceState → no history spam),
 * and push manual hash edits back into the store with source 'hash'.
 * `suspend(state)` → true holds writes back (the address keeps its last value) and re-checks every
 * `intervalMs` until it turns false (F20: the pose would reveal the user's position).
 */
export function bindHash(
  store: Store<AppState>,
  opts: HashValidators & { intervalMs?: number; suspend?: (s: AppState) => boolean } = {},
): () => void {
  const intervalMs = opts.intervalMs ?? 400;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = '';
  const write = () => {
    timer = null;
    if (opts.suspend?.(store.get())) {
      timer = setTimeout(write, intervalMs);
      return;
    }
    const next = formatHash(store.get());
    if (next !== last && next !== location.hash) {
      last = next;
      history.replaceState(null, '', next);
    }
  };
  const off = store.subscribe(
    (_s, _c, source) => {
      if (source === 'hash') return;
      if (!timer) timer = setTimeout(write, intervalMs);
    },
    HASH_KEYS,
  );
  const onHash = () => {
    if (location.hash === last) return;
    const p = parseHash(location.hash);
    if (!p) return;
    last = location.hash;
    store.set(hashPatch(p, opts), 'hash');
    // Rewrite the hash if values were rejected/normalised (unknown layer, clamped opacity …).
    if (!timer) timer = setTimeout(write, intervalMs);
  };
  window.addEventListener('hashchange', onHash);
  return () => {
    off();
    window.removeEventListener('hashchange', onHash);
    if (timer) clearTimeout(timer);
  };
}
