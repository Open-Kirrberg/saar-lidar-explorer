/**
 * F20 mobile mode — pure logic (no DOM, unit-tested in tests/mobileMode.test.ts):
 * layout mode detection, automatic "Mobil" quality, the "Relief" button cycle, bottom-sheet state
 * and swipe-to-close, and the touch-gesture help shown instead of keyboard shortcuts.
 */
import type { QualityLevel, Settings, UiModePref } from './settings';

/** Viewports narrower than this use the simple layout in 'auto' mode. */
export const SIMPLE_MAX_WIDTH = 820;

export interface DeviceEnv {
  /** `matchMedia('(pointer: coarse)')` — primary input is a finger. */
  coarse: boolean;
  /** CSS viewport size. */
  width: number;
  height: number;
}

export type UiMode = 'simple' | 'full';

/** Simple layout: forced by the preference, else on touch-first devices or narrow viewports. */
export function resolveUiMode(pref: UiModePref | undefined, env: DeviceEnv): UiMode {
  if (pref === 'simple' || pref === 'full') return pref;
  return env.coarse || env.width < SIMPLE_MAX_WIDTH ? 'simple' : 'full';
}

/** Phone or small tablet: touch-first and the short side below the simple-layout width. */
export function isPhoneLike(env: DeviceEnv): boolean {
  return env.coarse && Math.min(env.width, env.height) < SIMPLE_MAX_WIDTH;
}

/**
 * Quality preset to start with. A preset the user picked always wins; settings saved before F20
 * have no `qualityPicked` flag, so any non-default level counts as picked too. Otherwise phones
 * get 'mobil' (the result is applied, not saved — a later desktop visit still starts on 'hoch').
 */
export function autoQuality(s: Pick<Settings, 'quality' | 'qualityPicked'>, env: DeviceEnv): { level: QualityLevel; auto: boolean } {
  if (s.qualityPicked || s.quality !== 'hoch') return { level: s.quality, auto: false };
  return isPhoneLike(env) ? { level: 'mobil', auto: true } : { level: s.quality, auto: false };
}

// ---- "Relief" button cycle ----------------------------------------------------------------------

export interface ReliefStep {
  id: string;
  /** 'mode' = a single relief layer without overlay; 'preset' = a blend preset (reliefPanel PRESETS). */
  kind: 'mode' | 'preset';
  /** Layer key (mode) or preset id (preset). */
  ref: string;
  label: string;
}

/** The best looks for a phone, in button order. Steps whose data the AOI lacks are skipped. */
export const RELIEF_CYCLE: readonly ReliefStep[] = [
  { id: 'vat', kind: 'mode', ref: 'vat', label: 'VAT' },
  { id: 'slrm', kind: 'mode', ref: 'slrm', label: 'Lokales Relief' },
  { id: 'luftbild-relief', kind: 'preset', ref: 'luftbild-relief', label: 'Luftbild × Relief' },
  { id: 'karte-relief', kind: 'preset', ref: 'karte-relief', label: 'Karte 1840' },
];

export interface ReliefLook {
  layer: string;
  overlay: string;
  /** Active blend preset id ('' = none). */
  preset: string;
}

/** Index of the cycle step matching the current look, or -1 (a look the user set in the panel). */
export function currentReliefStep(steps: readonly ReliefStep[], look: ReliefLook): number {
  return steps.findIndex((st) =>
    st.kind === 'preset' ? look.preset === st.ref : !look.preset && !look.overlay && look.layer === st.ref,
  );
}

/** Next step after the current look (unknown look → first step); -1 when no step is available. */
export function nextReliefStep(steps: readonly ReliefStep[], look: ReliefLook): number {
  if (!steps.length) return -1;
  const i = currentReliefStep(steps, look);
  return (i + 1) % steps.length;
}

// ---- bottom sheets --------------------------------------------------------------------------------

export type SheetId = 'layers' | 'map' | 'more';

/** One sheet at a time: tapping the open sheet's button closes it, another button switches. */
export function toggleSheet(open: SheetId | null, id: SheetId): SheetId | null {
  return open === id ? null : id;
}

/**
 * Swipe-down-to-close decision for a drag on the sheet handle: far enough (a quarter of the
 * sheet, at most 120 px) or a quick flick (> 0.5 px/ms over at least 24 px).
 */
export function swipeCloses(dy: number, dtMs: number, sheetHeight: number): boolean {
  if (!(dy > 0)) return false;
  if (dy >= Math.min(120, Math.max(48, sheetHeight * 0.25))) return true;
  return dy >= 24 && dtMs > 0 && dy / dtMs > 0.5;
}

// ---- touch help ------------------------------------------------------------------------------------

export interface TouchGesture {
  gesture: string;
  label: string;
}

/** What the touch controls do (HUD help + introduction on touch devices). */
export const TOUCH_GESTURES: readonly TouchGesture[] = [
  { gesture: '1 Finger ziehen', label: 'Gelände verschieben' },
  { gesture: '2 Finger auseinander/zusammen', label: 'näher / weiter weg' },
  { gesture: '2 Finger drehen', label: 'Blickrichtung drehen' },
  { gesture: '2 Finger hoch/runter schieben', label: 'neigen' },
  { gesture: 'doppelt tippen', label: 'heranzoomen' },
  { gesture: 'lange drücken', label: 'Fundmarker setzen (beim Messen: Punkt)' },
  { gesture: 'Karte antippen', label: 'dorthin fliegen' },
];

const escapeHtml = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** HTML rows in the same shape as `shortcutsHtml` (`.sle-keys-row`, gesture in a chip). */
export function touchHelpHtml(rows: readonly TouchGesture[] = TOUCH_GESTURES, tag: 'div' | 'li' = 'div'): string {
  return rows
    .map((r) => `<${tag} class="sle-keys-row sle-touch-row"><span class="sle-gesture">${escapeHtml(r.gesture)}</span> <span>${escapeHtml(r.label)}</span></${tag}>`)
    .join('');
}
