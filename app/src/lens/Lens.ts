/**
 * Relikt-Blick lens (V2.5, ADR 0035): one big toggle in the action bar (key F). On → trees fade
 * out, the relief blends in over the aerial ground and nearby public candidates glow; tap a glow →
 * card with hypothesis wording and *Merken* (private marker + note, ADR 0009). Smooth ~0.5 s.
 *
 * The terrain side is a third shader channel (slot C, `Terrain.setLens`) mixed over base +
 * overlay; the relief lab's base/overlay, the store and the URL hash are never touched.
 */
import './lens.css';
import type { Candidate } from '../candidates/candidateData';
import { parseCandidateCollection } from '../candidates/candidateData';
import { loadReviews } from '../candidates/reviewStore';
import type { AppContext } from '../main';
import { lookupParcelLocal } from '../markers/parcel';
import { el } from '../shell/dom';
import { tierAllows } from '../shell/tiers';
import type { FeatureHost } from '../shell/types';
import { GLOW_MAX } from '../terrain/TerrainMaterial';
import { isTyping } from '../ui/keys';
import { clearOf } from '../shell/layout';
import { GLOW_MIN_SCORE, glowBound, glowCentre, glowPool, packGlow, pickGlow, selectGlow } from './glow';
import { LENS_DURATION_S, LENS_OFF, advanceLens, lensMix, sameMix, setLensOn } from './lensState';
import type { LensMix, LensState } from './lensState';
import { cardText, existingLensMarker, lensMarkerTag, merkenMarker, userNoteOf, withNote } from './merken';
import { createLensTargets } from './targets';
import type { LensTarget } from './targets';
import { isVariantId, pickVariant, resolveVariants } from './variants';
import type { LensVariantId, ResolvedVariant } from './variants';

export const LENS_PREFS_KEY = 'sle.lens.v1';

export interface LensApi {
  isOn(): boolean;
  setOn(on: boolean): void;
  toggle(): void;
  /** Transition progress 0–1 and the channel mix. */
  progress(): number;
  mix(): LensMix;
  variant(): LensVariantId | null;
  setVariant(id: LensVariantId): void;
  variants(): readonly ResolvedVariant[];
  /** Things the lens fades out (trees, props): `setLensFade(0 … 1)`. */
  registerLensTarget(t: LensTarget): () => void;
  /** Ids of the candidates glowing right now (public F15 data). */
  glowing(): string[];
  /** Open the card of a glowing candidate (verification hook); false if not glowing. */
  open(id: string): boolean;
  onChange(fn: () => void): () => void;
}

const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10" cy="10" r="6.2"/><path d="M14.6 14.6 20.5 20.5"/><path d="M10 6.8v6.4M6.8 10h6.4" stroke-width="1.6"/></svg>';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function loadPrefs(kv: Storage | null): { variant: LensVariantId | null } {
  try {
    const v = JSON.parse(kv?.getItem(LENS_PREFS_KEY) ?? 'null')?.variant;
    return { variant: isVariantId(v) ? v : null };
  } catch {
    return { variant: null };
  }
}

/** Typed view of the V2.4b trees module (`window.sleTrees`), looked up at call time. */
const treesTarget = (): LensTarget[] => {
  const t = (window as unknown as { sleTrees?: Partial<LensTarget> }).sleTrees;
  return t && typeof t.setLensFade === 'function' ? [t as LensTarget] : [];
};

export interface LensController {
  api: LensApi;
  mountLens(h: FeatureHost): () => void;
  mountVariants(h: FeatureHost): () => void;
}

export function createLens(ctx: AppContext): LensController {
  const { terrain, manifest } = ctx;
  const u = terrain.uniforms;
  const kv = storage();
  const prefs = loadPrefs(kv);
  const targets = createLensTargets(treesTarget);
  targets.register({ setLensFade: (f) => terrain.setCanopyLensFade(f) }); // relief lab DSM canopy (F5)
  const resolved = resolveVariants((k) => terrain.isValidDisplay(k));
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((fn) => fn());

  let state: LensState = LENS_OFF;
  let mix: LensMix = lensMix(0);
  let variant: ResolvedVariant | null = null;
  let all: Candidate[] | null = null;
  let pool: Candidate[] = [];
  let sel: Candidate[] = [];
  let selected: Candidate | null = null;
  let loading: Promise<void> | null = null;
  let dirty = true;
  let clock = 0;
  let last = { t: -1, E: NaN, N: NaN, heading: NaN };
  let busy: (b: boolean) => void = () => {};
  let closeCard: () => void = () => {};
  let openCard: (c: Candidate) => void = () => {};

  const pushMix = () => {
    u.uLensMix.value = mix.relief * (variant?.strength ?? 0.9);
    u.uGlowMix.value = mix.glow;
    targets.apply(mix.trees);
  };

  const bindVariant = () => {
    variant = pickVariant(resolved, prefs.variant, tierAllows(ctx.shell.tier(), 'entdecker'));
    if (!state.on && state.p === 0) return; // bound when the lens turns on
    if (!variant) terrain.setLens(null);
    else if (terrain.getLens() !== variant.key) terrain.setLens({ key: variant.key, tint: [...variant.tint] });
    pushMix();
  };

  const refreshPool = () => {
    if (!all) return;
    const reviews = loadReviews(kv, manifest.aoi);
    pool = glowPool(all, { minScore: GLOW_MIN_SCORE, statusOf: (id) => reviews.decisions[id]?.status });
    dirty = true;
  };

  const ensureCandidates = (): Promise<void> => {
    const meta = manifest.candidates;
    if (!meta) return Promise.resolve();
    if (all) {
      refreshPool();
      return Promise.resolve();
    }
    loading ??= (async () => {
      const shared = window.sleCandidates?.all() ?? null; // Labor's review module may have them already
      if (shared) all = shared;
      else {
        busy(true);
        try {
          const res = await fetch(terrain.baseUrl + meta.path);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          all = parseCandidateCollection(await res.json()).candidates;
        } catch (err) {
          console.warn('[lens] candidates not loaded', err);
          ctx.shell.toast('Verdachtsflächen konnten nicht geladen werden.', true);
          loading = null;
          return;
        } finally {
          busy(false);
        }
      }
      refreshPool();
    })();
    return loading;
  };

  const setOn = (on: boolean) => {
    if (on === state.on) return;
    state = setLensOn(state, on);
    if (on) {
      bindVariant();
      void ensureCandidates();
    } else closeCard();
    notify();
  };

  /** Metres per CSS pixel at 1 m distance. */
  const pxPerM = () => (2 * Math.tan((ctx.camera.fov * Math.PI) / 360)) / Math.max(1, ctx.renderer.domElement.clientHeight);

  const reselect = () => {
    const s = ctx.store.get();
    const moved = Math.hypot(s.E - last.E, s.N - last.N);
    const turned = Math.abs(((s.heading - last.heading + 540) % 360) - 180);
    if (!dirty && clock - last.t < 0.25) return;
    if (!dirty && moved < 8 && !(turned > 4) && clock - last.t < 2) return;
    last = { t: clock, E: s.E, N: s.N, heading: s.heading };
    dirty = false;
    sel = selectGlow(pool, glowCentre(s.E, s.N, s.heading, s.pitch, s.agl), GLOW_MAX);
    if (selected && !sel.includes(selected)) sel = [selected, ...sel.slice(0, GLOW_MAX - 1)];
    const packed = packGlow(sel, manifest.origin, selected?.id ?? null, GLOW_MIN_SCORE);
    packed.forEach((g, i) => u.uGlow.value[i].set(g[0], g[1], g[2], g[3]));
    u.uGlowCount.value = packed.length;
    u.uGlowBound.value.set(...glowBound(packed));
  };

  const frame = (dt: number) => {
    clock += dt;
    const next = advanceLens(state, dt, reduced ? 0.15 : LENS_DURATION_S);
    const moving = next !== state;
    state = next;
    const m = lensMix(state.p);
    if (!sameMix(m, mix)) {
      mix = m;
      pushMix();
    }
    if (mix.trees > 0) targets.sync(); // trees that loaded after the lens turned on
    if (!state.on && state.p === 0 && terrain.getLens()) {
      terrain.setLens(null); // stop streaming the lens layer
      u.uGlowCount.value = 0;
      u.uGlowBound.value.set(0, 0, -1);
      sel = [];
      dirty = true;
    }
    if (mix.glow > 0) {
      u.uGlowTime.value = clock;
      u.uGlowPx.value = pxPerM();
      reselect();
    }
    if (moving && (state.p === 0 || state.p === 1)) notify();
  };

  const api: LensApi = {
    isOn: () => state.on,
    setOn,
    toggle: () => setOn(!state.on),
    progress: () => state.p,
    mix: () => ({ ...mix }),
    variant: () => variant?.id ?? pickVariant(resolved, prefs.variant, tierAllows(ctx.shell.tier(), 'entdecker'))?.id ?? null,
    setVariant(id) {
      prefs.variant = id;
      try {
        kv?.setItem(LENS_PREFS_KEY, JSON.stringify({ variant: id }));
      } catch {
        /* private mode: the choice lasts for this visit */
      }
      bindVariant();
      notify();
    },
    variants: () => resolved,
    registerLensTarget: (t) => targets.register(t),
    glowing: () => sel.map((c) => c.id),
    open(id) {
      const c = sel.find((x) => x.id === id);
      if (!c || mix.glow <= 0) return false;
      openCard(c);
      return true;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  // ---- 🟢 lens toggle, picking and card ---------------------------------------------------------
  function mountLens(h: FeatureHost): () => void {
    const btn = el('button', {
      type: 'button',
      class: 'sle-bar-btn sle-lens-btn',
      'aria-pressed': 'false',
      'aria-label': 'Relikt-Blick',
      title: 'Relikt-Blick: Bäume ausblenden, Relief und mögliche Relikte zeigen (F)',
      html: `${ICON}<span class="sle-bar-label">Relikt-Blick</span>`,
    });
    btn.addEventListener('click', () => api.toggle());
    h.shell.slots.lens.append(btn);
    busy = (b) => btn.classList.toggle('busy', b);
    const sync = () => btn.setAttribute('aria-pressed', String(state.on));
    const offChange = api.onChange(sync);

    const card = el('section', { class: 'sle-lens-card', role: 'dialog', 'aria-label': 'Mögliches Relikt' });
    card.hidden = true;
    h.overlay.append(card);
    // Keep clear of the splash + „© Quellen“ corner (ADR 0026: never covered); re-place when it changes.
    const corner = h.shell.anchor('sources')?.parentElement ?? null;
    const place = () => {
      card.style.bottom = card.style.maxHeight = card.style.overflow = '';
      if (card.hidden || !corner) return;
      const r = clearOf(card.getBoundingClientRect(), corner.getBoundingClientRect(), window.innerHeight);
      if (!r) return;
      card.style.bottom = `${r.bottom}px`;
      card.style.maxHeight = `${r.maxHeight}px`;
      card.style.overflow = 'auto';
    };
    const watch = corner ? new MutationObserver(() => place()) : null;
    watch?.observe(corner as HTMLElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', place);
    closeCard = () => {
      card.hidden = true;
      card.replaceChildren();
      place();
      if (selected) dirty = true;
      selected = null;
    };
    openCard = (c: Candidate) => {
      selected = c;
      dirty = true;
      renderCard(c);
      card.hidden = false;
      place();
    };
    const renderCard = (c: Candidate) => {
      const t = cardText(c);
      const markers = h.services.markers;
      const existing = markers ? existingLensMarker(c.id, markers.list()) : undefined;
      const own = existing?.note.startsWith(lensMarkerTag(c.id));
      const close = el('button', { type: 'button', class: 'sle-lens-x', 'aria-label': 'Karte schließen', title: 'Schließen (Esc)', text: '×' });
      close.addEventListener('click', () => closeCard());
      const dl = el('dl');
      for (const [k, v] of t.facts) dl.append(el('dt', { text: k }), el('dd', { text: v }));
      const noteId = `sle-lens-note-${c.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
      const ta = el('textarea', { id: noteId, maxlength: '2000', placeholder: 'z. B. „Am Hang unter Buchen gesehen“' });
      if (own && existing) ta.value = userNoteOf(existing);
      const merken = el('button', { type: 'button', class: 'sle-lens-merken', text: existing ? 'Notiz speichern' : 'Merken' });
      const stateEl = el('span', { class: 'sle-lens-state', 'aria-live': 'polite', text: existing ? '✓ Gemerkt' : '' });
      merken.addEventListener('click', () => {
        if (!markers) {
          ctx.shell.toast('Merken ist gerade nicht möglich.', true);
          return;
        }
        const ex = existingLensMarker(c.id, markers.list());
        const note = ta.value;
        const m = !ex
          ? merkenMarker(c, note)
          : ex.note.startsWith(lensMarkerTag(c.id))
            ? withNote(ex, c, note)
            : { ...ex, note: note.trim() ? `${ex.note}\n${note.trim()}` : ex.note };
        markers.add(m);
        if (!ex) void lookupParcelLocal(m.E, m.N).then((p) => p && markers.setParcel(m.id, p));
        merken.textContent = 'Notiz speichern';
        stateEl.textContent = '✓ Gemerkt';
        ctx.shell.toast(ex ? 'Notiz gespeichert – nur in diesem Browser.' : 'Gemerkt – nur in diesem Browser gespeichert.');
      });
      card.replaceChildren(
        el('header', {}, el('h2', { text: t.title }), close),
        el('p', { text: t.lead }),
        dl,
        el('label', { for: noteId, class: 'sle-dim sle-small', text: 'Deine Notiz (bleibt nur in diesem Browser)' }),
        ta,
        el('div', { class: 'sle-lens-actions' }, merken, stateEl),
        el('p', { class: 'sle-lens-caution', html: '<b>Schauen, nicht graben.</b> Funde dem Landesdenkmalamt melden.' }),
      );
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && !card.hidden) {
        closeCard();
        return;
      }
      if (e.code !== 'KeyF' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      e.preventDefault();
      api.toggle();
    };
    window.addEventListener('keydown', onKey);

    // Tap / click on a glow opens its card (and must not grab the pointer lock).
    const canvas = ctx.renderer.domElement;
    const app = document.getElementById('app');
    let down: { id: number; x: number; y: number; t: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = null;
      const tapTool = app?.classList.contains('marker-mode') || app?.classList.contains('measure-mode');
      if (e.target !== canvas || e.button !== 0 || mix.glow < 0.5 || !sel.length || document.pointerLockElement || tapTool) return;
      down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    };
    const onUp = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || e.pointerId !== d.id) return;
      const tol = e.pointerType === 'touch' ? 12 : 5;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > tol || performance.now() - d.t > 600) return;
      const hit = ctx.pickAt(e.clientX, e.clientY);
      if (!hit) return;
      const slack = Math.max(4, ctx.camera.position.distanceTo(hit.point) * pxPerM() * 14); // ≈ 14 px
      const c = pickGlow(sel, hit.E, hit.N, slack);
      if (!c) return;
      const opts = ctx.controller.opts;
      const lock = opts.lockOnClick;
      opts.lockOnClick = false; // the controller's own pointerup runs next
      setTimeout(() => (opts.lockOnClick = lock), 0);
      openCard(c);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);

    const offFrame = ctx.onFrame(frame);
    const offTier = h.shell.onTier(() => bindVariant());
    sync();
    return () => {
      offFrame();
      offTier();
      offChange();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      closeCard();
      watch?.disconnect();
      window.removeEventListener('resize', place);
      card.remove();
      state = LENS_OFF;
      mix = lensMix(0);
      pushMix();
      terrain.setLens(null);
      u.uGlowCount.value = 0;
      u.uGlowBound.value.set(0, 0, -1);
      btn.remove();
      busy = () => {};
      openCard = () => {};
      closeCard = () => {};
    };
  }

  // ---- 🟡 Entdecker: variant chips (3 relief variants + Zeitreise) in the tool row ------------------
  function mountVariants(h: FeatureHost): () => void {
    if (resolved.length < 2) return () => {};
    const row = el('div', { class: 'sle-lens-chips', role: 'group', 'aria-label': 'Relikt-Blick: Ansicht' });
    let zeit = false;
    const buttons = new Map<LensVariantId, HTMLButtonElement>();
    for (const v of resolved) {
      if (v.group === 'zeitreise' && !zeit) {
        row.append(el('span', { class: 'sle-lens-sep', text: 'Zeitreise' }));
        zeit = true;
      }
      const b = el('button', { type: 'button', 'aria-pressed': 'false', title: v.title, text: v.label });
      b.addEventListener('click', () => api.setVariant(v.id));
      buttons.set(v.id, b);
      row.append(b);
    }
    h.tools.append(row);
    const sync = () => {
      row.hidden = !state.on;
      const cur = api.variant();
      for (const [id, b] of buttons) b.setAttribute('aria-pressed', String(id === cur));
    };
    const off = api.onChange(sync);
    const offTier = h.shell.onTier(sync);
    sync();
    return () => {
      off();
      offTier();
      row.remove();
    };
  }

  return { api, mountLens, mountVariants };
}
