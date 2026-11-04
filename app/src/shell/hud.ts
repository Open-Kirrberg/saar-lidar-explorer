/**
 * Game HUD (top-left): one compact line — height over ground, speed, heading — plus the streaming
 * indicator. Labor mounts the full readout (`hud-full` feature) into the extra slot below.
 */
import type { AppState, Store } from '../state';
import { pendingText } from '../ui/streaming';
import { el } from './dom';

export const fmtNum = (v: number, d = 0): string =>
  Number.isFinite(v) ? v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–';

export const COMPASS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'] as const;
export const compass = (deg: number): string => COMPASS[((Math.round(deg / 45) % 8) + 8) % 8];

export interface HudDeps {
  store: Store<AppState>;
  pending(): number;
  /** Extra HUD slot (feature wrappers go here). */
  extra: HTMLElement;
}

export function createHud(root: HTMLElement, d: HudDeps): () => void {
  const agl = el('span', { class: 'hud-v' });
  const speed = el('span', { class: 'hud-v' });
  const dir = el('span', { class: 'hud-v' });
  const stream = el('div', { class: 'hud-stream', role: 'status' });
  stream.hidden = true;
  root.append(
    el(
      'div',
      { class: 'hud-line' },
      el('span', { class: 'hud-k', text: 'über Grund ' }),
      agl,
      el('span', { class: 'hud-sep', 'aria-hidden': 'true', text: '·' }),
      speed,
      el('span', { class: 'hud-sep', 'aria-hidden': 'true', text: '·' }),
      dir,
    ),
    stream,
    d.extra,
  );
  const render = () => {
    const s = d.store.get();
    agl.textContent = `${fmtNum(s.agl)} m`;
    speed.textContent = `${fmtNum(s.speed * 3.6)} km/h`;
    dir.textContent = `${compass(s.heading)} ${fmtNum(s.heading)}°`;
    const t = pendingText(d.pending());
    if (stream.textContent !== t) stream.textContent = t;
    stream.hidden = !t;
  };
  render();
  const id = setInterval(render, 125);
  window.addEventListener('sle:step', render);
  return () => {
    clearInterval(id);
    window.removeEventListener('sle:step', render);
  };
}
