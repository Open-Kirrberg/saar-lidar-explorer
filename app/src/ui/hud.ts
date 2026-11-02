import type { AppState, Store } from '../state';
import { isTyping } from './keys';
import { availableShortcuts, shortcutsHtml } from './shortcuts';
import type { ShortcutFeature } from './shortcuts';
import { pendingText } from './streaming';
import { touchHelpHtml } from './mobileMode';

const fmt = (v: number, d = 0) =>
  Number.isFinite(v) ? v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–';

const COMPASS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];

export interface HudExtras {
  speedMultiplier: () => number;
  fps: () => number;
  showFps: () => boolean;
  /** Terrain pieces still loading (F9 streaming); shows "Lade Details … n" while > 0. */
  pending?: () => number;
  /** Which optional layers exist in this AOI (rows for missing ones are hidden). */
  hasFeature?: (f: ShortcutFeature) => boolean;
  /** Initial visibility of the "Steuerung" block and a callback when H toggles it (settings). */
  helpVisible?: boolean;
  onHelpToggle?: (visible: boolean) => void;
}

/** Small read-only heads-up display (German labels), refreshed at ~8 Hz. */
export function createHud(el: HTMLElement, store: Store<AppState>, extras: HudExtras): () => void {
  el.innerHTML = `
    <table>
      <tr data-row="h"><td>Höhe ü. NN</td><td data-k="h"></td></tr>
      <tr data-row="agl"><td>Höhe über Grund</td><td data-k="agl"></td></tr>
      <tr data-row="speed"><td>Geschwindigkeit</td><td data-k="speed"></td></tr>
      <tr data-row="dir"><td>Kurs / Neigung</td><td data-k="dir"></td></tr>
      <tr data-row="en"><td>E / N (UTM 32)</td><td data-k="en"></td></tr>
      <tr data-row="fps"><td>Bildrate</td><td data-k="fps"></td></tr>
    </table>
    <div class="hud-stream" role="status" hidden></div>
    <button type="button" class="hud-help-btn" aria-controls="sle-hud-help">Gesten</button>
    <div class="help" id="sle-hud-help">
      <span class="help-keys"><b>Steuerung</b> <span class="help-dim">(H: ein/aus · ? alle Kürzel)</span></span>
      <div class="help-rows"></div>
      <div class="help-touch">${touchHelpHtml()}</div>
    </div>`;
  const cell = (k: string) => el.querySelector<HTMLElement>(`[data-k="${k}"]`)!;
  const cells = { h: cell('h'), agl: cell('agl'), speed: cell('speed'), dir: cell('dir'), en: cell('en'), fps: cell('fps') };
  const fpsRow = el.querySelector<HTMLElement>('[data-row="fps"]')!;
  const help = el.querySelector<HTMLElement>('.help')!;
  const stream = el.querySelector<HTMLElement>('.hud-stream')!;
  const renderHelp = () => {
    help.querySelector<HTMLElement>('.help-rows')!.innerHTML = shortcutsHtml(
      availableShortcuts(extras.hasFeature ?? (() => true), true),
      { short: true },
    );
  };
  renderHelp();
  // Optional layers found after start-up (F19 shared reconstruction dataset) add their rows.
  window.addEventListener('sle:features', renderHelp);
  // F20: on touch devices (html.sle-touch) the block shows gestures, toggled by the "Gesten" chip.
  const helpBtn = el.querySelector<HTMLButtonElement>('.hud-help-btn')!;
  const setHelp = (visible: boolean, persist: boolean) => {
    help.classList.toggle('collapsed', !visible);
    helpBtn.setAttribute('aria-expanded', String(visible));
    helpBtn.classList.toggle('on', visible);
    if (persist) extras.onHelpToggle?.(visible);
  };
  // Touch devices start collapsed (the introduction shows the gestures; the chip reopens them).
  let coarse = false;
  try {
    coarse = window.matchMedia('(pointer: coarse)').matches;
  } catch {
    /* ignore */
  }
  setHelp(!coarse && extras.helpVisible !== false, false);
  helpBtn.addEventListener('click', () => setHelp(help.classList.contains('collapsed'), true));

  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyH' || e.repeat || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    setHelp(help.classList.contains('collapsed'), true);
  };
  window.addEventListener('keydown', onKey);

  const render = () => {
    const s = store.get();
    cells.h.textContent = `${fmt(s.h, 1)} m`;
    cells.agl.textContent = `${fmt(s.agl, 1)} m`;
    cells.speed.textContent = `${fmt(s.speed * 3.6)} km/h  (×${fmt(extras.speedMultiplier(), 2)})`;
    const dir = COMPASS[Math.round(s.heading / 45) % 8];
    cells.dir.textContent = `${fmt(s.heading)}° ${dir} / ${fmt(s.pitch)}°`;
    cells.en.textContent = `${fmt(s.E)} / ${fmt(s.N)}`;
    fpsRow.style.display = extras.showFps() ? '' : 'none';
    cells.fps.textContent = `${fmt(extras.fps())} fps`;
    const t = pendingText(extras.pending?.() ?? 0);
    if (stream.textContent !== t) stream.textContent = t;
    stream.hidden = !t;
  };
  render();
  const id = setInterval(render, 125);
  return () => {
    clearInterval(id);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('sle:features', renderHelp);
  };
}
