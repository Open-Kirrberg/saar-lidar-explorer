/**
 * Game HUD (top-left): a compass tape over one compact row — height over ground (icon + mini bar),
 * speed, heading — plus the streaming indicator. In Gehen the height cell shows the walker instead.
 * Labor mounts the full readout (`hud-full` feature) into the extra slot below.
 */
import type { AppState, Store } from '../state';
import { pendingText } from '../ui/streaming';
import { ICONS, el } from './dom';
import type { MoveMode } from './flight';

export const fmtNum = (v: number, d = 0): string =>
  Number.isFinite(v) ? v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–';

export const COMPASS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'] as const;
export const compass = (deg: number): string => COMPASS[((Math.round(deg / 45) % 8) + 8) % 8];

/** Compass tape: px per degree; the strip spans −360°…+720° so any heading sits mid-strip. */
export const TAPE_PX_PER_DEG = 1.4;
const TAPE_FROM = -360;
const TAPE_TO = 720;
export const normDeg = (deg: number): number => (Number.isFinite(deg) ? ((deg % 360) + 360) % 360 : 0);
/** translateX of the strip so `heading` sits under the centre caret. */
export const tapeOffset = (heading: number, k = TAPE_PX_PER_DEG): number => -(normDeg(heading) - TAPE_FROM) * k;
/** Mini height bar fill 0…1: log scale, 1 m → ~0.1, 30 m → 0.5, 1000 m → 1. */
export const aglFill = (agl: number): number => (agl > 0 && Number.isFinite(agl) ? Math.min(1, Math.log10(agl + 1) / 3) : 0);

export interface HudDeps {
  store: Store<AppState>;
  pending(): number;
  /** Current move mode (Gehen shows the walker instead of height over ground). */
  mode?(): MoveMode;
  /** Extra HUD slot (feature wrappers go here). */
  extra: HTMLElement;
}

const sr = (text: string) => el('span', { class: 'sle-sr', text });

function tapeStrip(): HTMLElement {
  const strip = el('div', { class: 'hud-tape-strip' });
  strip.style.width = `${(TAPE_TO - TAPE_FROM) * TAPE_PX_PER_DEG}px`;
  for (let d = TAPE_FROM; d <= TAPE_TO; d += 45) {
    const name = COMPASS[((d / 45) % 8 + 8) % 8];
    const lab = el('span', { class: `hud-tape-l${name.length === 1 ? ' card' : ''}${name === 'N' ? ' north' : ''}`, text: name });
    lab.style.left = `${(d - TAPE_FROM) * TAPE_PX_PER_DEG}px`;
    strip.append(lab);
  }
  return strip;
}

export function createHud(root: HTMLElement, d: HudDeps): () => void {
  const strip = tapeStrip();
  const tape = el('div', { class: 'hud-tape', 'aria-hidden': 'true' }, strip);
  const altIcon = el('span', { class: 'hud-i', 'aria-hidden': 'true', html: ICONS.agl });
  const altLabel = sr('über Grund ');
  const agl = el('span', { class: 'hud-v' });
  const barFill = el('span', { class: 'hud-bar-fill' });
  const bar = el('span', { class: 'hud-bar', 'aria-hidden': 'true' }, barFill);
  const speed = el('span', { class: 'hud-v' });
  const dir = el('span', { class: 'hud-v hud-dir' });
  const stream = el('div', { class: 'hud-stream', role: 'status' });
  stream.hidden = true;
  const altCell = el('span', { class: 'hud-cell hud-alt', title: 'Höhe über Grund' }, altIcon, altLabel, agl, bar);
  root.append(
    el(
      'div',
      { class: 'hud-game' },
      tape,
      el(
        'div',
        { class: 'hud-row' },
        altCell,
        el('span', { class: 'hud-cell', title: 'Geschwindigkeit' }, el('span', { class: 'hud-i', 'aria-hidden': 'true', html: ICONS.gauge }), sr('Tempo '), speed),
        el('span', { class: 'hud-cell', title: 'Kurs' }, sr('Kurs '), dir),
      ),
    ),
    stream,
    d.extra,
  );
  let lastMode: MoveMode | null = null;
  const renderTape = () => {
    strip.style.transform = `translateX(${tapeOffset(d.store.get().heading).toFixed(1)}px)`;
  };
  const render = () => {
    const s = d.store.get();
    const mode = d.mode?.() ?? 'fly';
    if (mode !== lastMode) {
      lastMode = mode;
      const walk = mode === 'walk';
      altCell.classList.toggle('walk', walk);
      altIcon.innerHTML = walk ? ICONS.walk : ICONS.agl;
      altLabel.textContent = walk ? '' : 'über Grund ';
      altCell.title = walk ? 'Gehen (Augenhöhe)' : 'Höhe über Grund';
    }
    agl.textContent = mode === 'walk' ? 'Gehen' : `${fmtNum(s.agl)} m`;
    barFill.style.height = `${Math.round(aglFill(s.agl) * 100)}%`;
    speed.textContent = `${fmtNum(s.speed * 3.6)} km/h`;
    const h = normDeg(s.heading);
    dir.textContent = `${fmtNum(Math.round(h) % 360)}°`;
    const t = pendingText(d.pending());
    if (stream.textContent !== t) stream.textContent = t;
    stream.hidden = !t;
    renderTape();
  };
  render();
  // Text at 8 Hz; the tape follows every frame so turning reads smoothly.
  const id = setInterval(render, 125);
  let raf = 0;
  const loop = () => {
    renderTape();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  window.addEventListener('sle:step', render);
  return () => {
    clearInterval(id);
    cancelAnimationFrame(raf);
    window.removeEventListener('sle:step', render);
  };
}
