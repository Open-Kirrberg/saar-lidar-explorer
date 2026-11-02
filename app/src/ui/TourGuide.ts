/**
 * Guided "Tour" (final polish): flies through ~6 known sites with a recommended relief preset per
 * stop and a short German text (hypothesis framing). Weiter/Zurück buttons, Esc ends. Honors
 * `prefers-reduced-motion` (near-instant jumps instead of flights).
 */
import { dataRootUrl } from '../data/manifest';
import { wgs84ToUtm } from '../geo';
import type { AppContext } from '../main';
import { gridBearing } from '../pois/PoiPanel';
import { obliqueView, parsePois } from '../pois/pois';
import { PRESETS } from '../terrain/relief';
import { resolveTour, tourFlyDuration, tourStep } from './tour';
import type { TourStop } from './tour';
import { modalOpen } from './modalKeys';

export interface TourDeps {
  applyPreset(id: string): boolean;
}

export interface TourGuide {
  readonly stops: TourStop[];
  readonly active: boolean;
  start(index?: number): void;
  stop(): void;
  go(delta: number): void;
}

declare global {
  interface Window {
    sleTour?: TourGuide;
  }
}

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/** Loads pois.geojson and resolves the stops inside this AOI (empty when none / no file). */
export async function createTourGuide(ctx: AppContext, deps: TourDeps): Promise<TourGuide> {
  let stops: TourStop[] = [];
  try {
    const res = await fetch(`${dataRootUrl()}pois.geojson`, { cache: 'no-cache' });
    if (res.ok) {
      const { origin, size } = ctx.manifest;
      stops = resolveTour(
        parsePois(await res.json()),
        (lat, lon) => wgs84ToUtm(lat, lon),
        (E, N) => E >= origin.E0 && E <= origin.E0 + size.width && N >= origin.N0 && N <= origin.N0 + size.height,
      );
    }
  } catch (err) {
    console.warn('[tour] could not load pois.geojson', err);
  }

  let index = -1;
  const box = document.createElement('div');
  box.id = 'sle-tour';
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', 'Tour');
  box.hidden = true;
  box.innerHTML = `
    <div class="sle-tour-head">
      <span class="sle-tour-count" aria-live="polite"></span>
      <button type="button" class="sle-icon" data-act="end" title="Tour beenden (Esc)" aria-label="Tour beenden (Esc)">✕</button>
    </div>
    <h3 class="sle-tour-title"></h3>
    <p class="sle-tour-text"></p>
    <p class="sle-tour-preset sle-dim"></p>
    <div class="sle-actions">
      <button type="button" class="sle-btn" data-act="prev">‹ Zurück</button>
      <span class="sle-spacer"></span>
      <button type="button" class="primary" data-act="next">Weiter ›</button>
    </div>`;
  (document.querySelector('#app') ?? document.body).appendChild(box);
  const q = <T extends HTMLElement>(s: string) => box.querySelector<T>(s)!;
  const prevBtn = q<HTMLButtonElement>('[data-act=prev]');
  const nextBtn = q<HTMLButtonElement>('[data-act=next]');

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || index < 0) return;
    // An open dialog/form (intro, disclaimer, marker form, report) gets its own Escape first.
    if (modalOpen(e.target)) return;
    e.stopPropagation(); // Esc ends the tour only (not marker/measure modes)
    api.stop();
  };

  const show = (i: number) => {
    index = i;
    const s = stops[i];
    q('.sle-tour-count').textContent = `Tour ${i + 1} / ${stops.length}`;
    q('.sle-tour-title').textContent = s.title;
    q('.sle-tour-text').textContent = s.text;
    const ok = deps.applyPreset(s.preset);
    const label = PRESETS.find((p) => p.id === s.preset)?.label;
    q('.sle-tour-preset').textContent = ok && label ? `Darstellung: „${label}“ (Umschalt + Zahl wechselt)` : '';
    prevBtn.disabled = i === 0;
    nextBtn.textContent = i === stops.length - 1 ? 'Tour beenden' : 'Weiter ›';
    const st = ctx.store.get();
    const far = Math.hypot(s.E - st.E, s.N - st.N) > s.dist * 1.5;
    // Exaggeration-aware: scale the height, keep the horizontal distance (pitch gets steeper).
    const exag = ctx.terrain.uniforms.uExag.value;
    const v = obliqueView(s.dist, s.agl * exag, far ? gridBearing(st.E, st.N, s.E, s.N) : st.heading);
    void ctx.flyTo(s.E, s.N, { agl: v.agl, heading: v.heading, pitch: v.pitch, lookAt: true, duration: tourFlyDuration(reducedMotion()) });
  };

  const api: TourGuide = {
    stops,
    get active() {
      return index >= 0;
    },
    start(i = 0) {
      if (!stops.length) return;
      box.hidden = false;
      if (index < 0) window.addEventListener('keydown', onKey, true);
      show(Math.max(0, Math.min(stops.length - 1, i)));
      nextBtn.focus({ preventScroll: true });
    },
    stop() {
      if (index < 0) return;
      index = -1;
      box.hidden = true;
      window.removeEventListener('keydown', onKey, true);
    },
    go(delta) {
      if (index < 0) return;
      const n = tourStep(index, delta, stops.length);
      if (n < 0) {
        if (delta > 0) api.stop();
        return;
      }
      show(n);
    },
  };
  prevBtn.addEventListener('click', () => api.go(-1));
  nextBtn.addEventListener('click', () => api.go(1));
  q('[data-act=end]').addEventListener('click', () => api.stop());
  window.sleTour = api;
  return api;
}
