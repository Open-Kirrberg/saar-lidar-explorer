/**
 * V2.9 first-flight tutorial (ADR 0038, 🟢 Standard): a small non-modal card in `shell.slots.tutorial`
 * that walks a new visitor from the start view to the castle: umschauen → fliegen → finden → hinfliegen
 * → betreten. Each step completes when the user did it (steps.ts), every step can be skipped, × ends it.
 * Shown once per profile (`shell.firstRun()`), restart from *Steuerung* or *Einstellungen*.
 */
import type { AppContext } from '../main';
import { wgs84ToUtm } from '../geo';
import { el, ICONS } from '../shell/dom';
import type { ShellAnchor } from '../shell/types';
import { onZonePortals } from '../zones/runtime/feature';
import type { ZonePortalInfo } from '../zones/runtime/feature';
import { advance, skip, start, stepText, visibleSteps } from './steps';
import type { Snapshot, Target, TutState } from './steps';
import './tutorial.css';

/** Zone id of the castle (V2.7 zone package). */
export const CASTLE_ZONE = 'schloss-karlsberg';
/** Fallback target without a castle zone: the palace ruins (public POI r03-01, WGS84). */
export const CASTLE_SITE = { lat: 49.3362, lon: 7.3784, radius_m: 250 };

export interface TutorialApi {
  start(): void;
  stop(): void;
  /** Stop and drop the portal subscription (feature unmount). */
  dispose(): void;
  readonly active: boolean;
  /** Debug / walkthrough: current step id. */
  step(): string | null;
}

export function pickTarget(portals: readonly ZonePortalInfo[], inAoi: (E: number, N: number) => boolean): Target {
  const p = portals.find((x) => x.zoneId === CASTLE_ZONE);
  if (p) return { E: p.E, N: p.N, radius_m: p.radius_m, kind: 'portal', inAoi: inAoi(p.E, p.N) };
  const { E, N } = wgs84ToUtm(CASTLE_SITE.lat, CASTLE_SITE.lon);
  return { E, N, radius_m: CASTLE_SITE.radius_m, kind: 'site', inAoi: inAoi(E, N) };
}

export function createTutorial(ctx: AppContext): TutorialApi {
  const { shell, manifest } = ctx;
  const { origin, size } = manifest;
  const inAoi = (E: number, N: number) => E >= origin.E0 && E <= origin.E0 + size.width && N >= origin.N0 && N <= origin.N0 + size.height;
  let portals: readonly ZonePortalInfo[] = [];
  const offPortals = onZonePortals((p) => (portals = p));

  let teardown: (() => void) | null = null;
  let state: TutState | null = null;

  const touch = () => document.documentElement.classList.contains('sle-touch');
  const target = () => pickTarget(portals, inAoi);

  const snapshot = (): Snapshot => {
    const s = ctx.store.get();
    const zs = ctx.zones?.flow?.state();
    const inCastle = !!zs && zs.phase !== 'overworld' && zs.zoneId === CASTLE_ZONE;
    const promptEl = shell.slots.overlay.querySelector<HTMLElement>('.sle-prompt');
    const castlePortal = portals.find((p) => p.zoneId === CASTLE_ZONE);
    const zonePrompt = !!promptEl && !!castlePortal && (promptEl.textContent ?? '').includes(castlePortal.name_de);
    const reconBtn = document.querySelector<HTMLElement>('.sle-recon-enter:not([hidden])');
    return {
      E: s.E,
      N: s.N,
      heading: s.heading,
      pitch: s.pitch,
      placesOpen: !!document.querySelector('#sle-drawer-places:not([hidden])'),
      mapOpen: shell.slots.minimap.classList.contains('gmm-full') || !!shell.slots.minimap.querySelector('.gmm-full'),
      enterOffered: zonePrompt || !!reconBtn,
      inCastle,
    };
  };

  const stop = () => {
    teardown?.();
    teardown = null;
    state = null;
  };

  const startTut = () => {
    stop();
    teardown = shell.mountTutorial((layer) => {
      const progress = el('ol', { class: 'sle-tut-dots', 'aria-hidden': 'true' });
      const icon = el('span', { class: 'sle-tut-icon', 'aria-hidden': 'true' });
      const count = el('span', { class: 'sle-tut-count' });
      const title = el('h2', { class: 'sle-tut-title', id: 'sle-tut-title' });
      const body = el('p', { class: 'sle-tut-body' });
      const skipBtn = el('button', { type: 'button', class: 'sle-btn sle-tut-skip', 'data-tut': 'skip' });
      const close = el('button', { type: 'button', class: 'sle-tut-x', 'data-tut': 'close', 'aria-label': 'Einführung beenden', title: 'Einführung beenden', html: ICONS.close });
      const card = el(
        'section',
        { class: 'sle-tut-card', role: 'region', 'aria-labelledby': 'sle-tut-title', 'data-step': '' },
        el('header', { class: 'sle-tut-head' }, icon, el('div', { class: 'sle-tut-hgroup' }, count, title), close),
        el('div', { 'aria-live': 'polite' }, body),
        el('footer', { class: 'sle-tut-foot' }, progress, skipBtn),
      );
      layer.append(card);

      let lit: HTMLElement[] = [];
      let lastKey = '';
      let lastAnnounce = '';
      const render = () => {
        if (!state) return;
        const snap = snapshot();
        const t = target();
        const txt = stepText(state, { touch: touch(), target: t, enterOffered: snap.enterOffered });
        card.classList.toggle('sheet', snap.placesOpen); // phones: the Orte sheet takes the lower half
        const key = `${state.step}|${txt.title}|${txt.body}`;
        if (key === lastKey) return;
        lastKey = key;
        const steps = visibleSteps(t);
        const i = steps.indexOf(state.step);
        card.dataset.step = state.step;
        icon.textContent = txt.icon;
        count.textContent = i >= 0 ? `Einführung · ${i + 1}/${steps.length}` : 'Einführung';
        title.textContent = txt.title;
        if (txt.body !== lastAnnounce) body.textContent = lastAnnounce = txt.body;
        progress.replaceChildren(...steps.map((_s, k) => el('li', { class: k < i || state!.step === 'done' ? 'on' : k === i ? 'cur' : '' })));
        const last = state.step === 'done' || (state.step === 'enter' && t.kind === 'site' && !snap.enterOffered);
        skipBtn.textContent = last ? 'Fertig' : 'Überspringen';
        for (const a of lit) a.classList.remove('sle-tut-lit');
        lit = txt.anchors.map((a) => shell.anchor(a as ShellAnchor)).filter((x): x is HTMLElement => !!x);
        for (const a of lit) a.classList.add('sle-tut-lit');
      };

      const tick = () => {
        if (!state) return;
        const next = advance(state, snapshot(), target());
        if (next !== state) {
          state = next;
          // Reaching the castle (or the end) counts as done: no second run on the next visit.
          if (state.step === 'enter' || state.step === 'done') shell.markTutorialDone();
        }
        render();
      };

      skipBtn.addEventListener('click', () => {
        if (!state) return;
        if (state.step === 'done') return void stop();
        state = skip(state, ctx.store.get(), target());
        if (state.step === 'done') shell.markTutorialDone();
        render();
      });
      close.addEventListener('click', () => {
        shell.markTutorialDone();
        stop();
      });

      state = start(ctx.store.get());
      render();
      const offFrame = ctx.onFrame(tick);
      // Zones own the frame loop (no onFrame) and hidden tabs pause rAF: also tick on a timer + sle.step().
      const iv = window.setInterval(tick, 400);
      window.addEventListener('sle:step', tick);
      return () => {
        offFrame();
        window.clearInterval(iv);
        window.removeEventListener('sle:step', tick);
        for (const a of lit) a.classList.remove('sle-tut-lit');
      };
    });
  };

  return {
    start: startTut,
    stop,
    get active() {
      return !!teardown;
    },
    step: () => state?.step ?? null,
    dispose() {
      stop();
      offPortals();
    },
  };
}

/** Register the 🟢 Standard feature `tutorial` (main.ts): settings button, *Steuerung* button, first-run start. */
export function installTutorial(ctx: AppContext): () => void {
  let tut: TutorialApi | null = null;
  return ctx.shell.registerFeature({
    id: 'tutorial',
    tier: 'standard',
    label: 'Einführung',
    mount(h) {
      tut = createTutorial(ctx);
      const restart = () => {
        document.getElementById('sle-settings')?.dispatchEvent(new Event('sle:close')); // close the dialog it came from
        tut?.start();
      };
      const btn = el('button', { type: 'button', class: 'sle-btn', 'data-tut': 'restart', text: 'Einführung starten' });
      btn.addEventListener('click', restart);
      h.settings.append(
        el('h3', { text: 'Einführung' }),
        el('p', { class: 'sle-row' }, btn),
        el('p', { class: 'sle-dim sle-small', text: 'Zeigt in fünf kurzen Schritten, wie du zum Schloss Karlsberg kommst.' }),
      );
      const offStarter = h.shell.setTutorialStart(restart);
      const begin = () => {
        if (h.shell.firstRun() && !new URLSearchParams(location.search).has('notutorial')) tut?.start();
      };
      if (ctx.ready) begin();
      else window.addEventListener('sle:ready', begin, { once: true });
      (window as unknown as { sleTutorial?: TutorialApi }).sleTutorial = tut;
      return () => {
        window.removeEventListener('sle:ready', begin);
        offStarter();
        tut?.dispose();
        tut = null;
      };
    },
  });
}
