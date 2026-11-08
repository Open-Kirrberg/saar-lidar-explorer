/**
 * 🏆 „Orte im Vergleich“ card in the Standard „Orte“ drawer (plan §8 Phase 0 + 1, ADR 0049):
 * discipline chooser → one leaderboard per discipline (generic from `disciplines`, with its caveat
 * `note_de`), tap → fly to the Gemarkung, outline it in 3D + on the minimap and open the place card.
 * „Sonnenstärkster Ort“ is a municipality board (MaStR only per Gemeinde). Riesenbaum pins while that
 * discipline is on.
 *
 * Phase 1 (contract „Place statistics“, UI rules G7): the place card shows the *Riesen* (top 10, tap →
 * fly to the tree and mark it in 3D / on the minimap), the species mix of the forest part, forest age
 * classes and the 1935 forest share (a snapshot, never „seit“), observed biodiversity (GBIF counts,
 * „gemeldete Beobachtungen“), roof PV potential plus the municipality's used share, land use when
 * known, and the example goals with baseline/target bars (no progress bar while `progress` is null).
 * Local collecting („Riesen entdeckt x/y“, „Orte besucht x/9“): collect.ts, only in this browser.
 */
import { gridBearing } from '../pois/PoiPanel';
import { obliqueView } from '../pois/pois';
import { utmToWorld } from '../geo';
import { el } from '../shell/dom';
import type { FeatureHost } from '../shell/types';
import { epochSpan, placeIdAt } from '../trees/treeFacts';
import { modalOpen } from '../ui/modalKeys';
import { createPanelSection, openPanelSection } from '../ui/panelSection';
import {
  VISIT_MAX_AGL_M,
  armCollectGate,
  clearCollect,
  collectGate,
  collectProgress,
  isDiscovered,
  loadCollect,
  markPlace,
  markRiese,
  newCollectGate,
  riesenNear,
  saveCollect,
} from './collect';
import type { KV } from './collect';
import { buildMatrix, parseCompareParam, rivalFor, withCompareParam } from './compare';
import { climbList, climbSummaryText, openLeaderboard } from './LeaderboardOverlay';
import type { OverlayOptions } from './LeaderboardOverlay';
import { PlaceLayer } from './PlaceLayer';
import {
  AGE_COLORS,
  NUTZUNG_COLORS,
  PLACE_OPEN_EVENT,
  SPECIES_COLORS,
  TREE_CARD_OPEN_EVENT,
  aoiRect,
  approx,
  boardFor,
  fmtGoalValue,
  fmtNum,
  fmtRange,
  fmtShare,
  fmtValue,
  frameBox,
  framedPose,
  goalBar,
  inAoiRect,
  insideFocus,
  labelOf,
  otherFlightNote,
  outsideNote,
  parseOutlines,
  parsePlacesFile,
  placeBadges,
  placeTitle,
  riesenInAoi,
  rieseSpeciesText,
  unionBox,
} from './placesData';
import type { Board, Discipline, Goal, ManifestStats, Municipality, Outlines, Place, PlacesData, Riese } from './placesData';
import './places.css';

const PREFS_KEY = 'sle.placesCmp.v1';
const GIANT_ID = 'riesenbaum';
const MEDALS = ['🥇', '🥈', '🥉'];
/** Collecting check interval (ms): cheap, but no need to run it every frame. */
const COLLECT_EVERY_MS = 500;

function loadPref(): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { discipline?: unknown };
    return typeof v.discipline === 'string' ? v.discipline : null;
  } catch {
    return null;
  }
}

function savePref(discipline: string): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ discipline }));
  } catch {
    /* ignore */
  }
}

/** localStorage, or null where the accessor throws (private mode, blocked site data). */
function storage(): KV | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown | null> {
  const res = await fetch(url, { cache: 'no-cache', signal });
  if (!res.ok) return null;
  const text = await res.text();
  // Vite answers unknown paths with index.html (200): guard on content.
  return text.trimStart().startsWith('{') ? (JSON.parse(text) as unknown) : null;
}

type Selection = { kind: 'place'; place: Place } | { kind: 'municipality'; mun: Municipality } | null;

export function mountPlaceStats(h: FeatureHost, meta: ManifestStats): () => void {
  const { ctx, services } = h;
  const { terrain, manifest } = ctx;
  const abort = new AbortController();

  // Place the card right below „Nachbauten zum Betreten“ (zones, seq 0) and above „Bekannte Orte“.
  h.places.dataset.seq = '0';
  const parent = h.places.parentElement;
  if (parent) {
    const next = [...parent.children].find((c) => c !== h.places && Number((c as HTMLElement).dataset.seq ?? 0) > 0) ?? null;
    parent.insertBefore(h.places, next);
  }

  const sec = createPanelSection(h.places, 'places-cmp', `🏆 ${meta.label_de}`, true);
  sec.root.classList.add('sle-cmp');
  const status = el('p', { class: 'sle-dim sle-small', text: 'Lade Vergleich …' });
  sec.body.append(status);

  let data: PlacesData | null = null;
  let outlines: Outlines = new Map();
  let discipline: Discipline | null = null;
  let selection: Selection = null;
  let activeRiese: Riese | null = null;
  const aoi = aoiRect(manifest); // metres: manifest.size is in cells

  // ---- local collecting (ADR 0022: only in this browser) ---------------------------------------------
  let collected = loadCollect(storage());
  let riesenAll: Array<{ place: string; riese: Riese }> = [];

  const layer = new PlaceLayer({
    terrain,
    origin: manifest.origin,
    aoi,
    labels: services.labels,
    scene: ctx.scene,
    minimap: () => services.minimap,
    onPinClick: (p) => {
      select({ kind: 'place', place: p });
      flyToGiant(p);
    },
  });
  let lastCollect = 0;
  const gate = newCollectGate();
  const offFrame = ctx.onFrame(() => {
    layer.syncMap();
    layer.update(ctx.camera, ctx.renderer);
    if (ctx.controller.flying) gate.flew = true; // every frame: a short fly-to may end between two ticks
    const now = performance.now();
    if (now - lastCollect >= COLLECT_EVERY_MS) {
      lastCollect = now;
      collectTick();
    }
  });

  // ---- DOM skeleton ------------------------------------------------------------------------------
  const progress = el('div', { class: 'sle-cmp-progress', role: 'status', 'aria-live': 'polite' });
  const chips = el('div', { class: 'sle-cmp-chips', role: 'radiogroup', 'aria-label': 'Disziplin wählen' });
  const desc = el('p', { class: 'sle-cmp-desc sle-small' });
  const note = el('p', { class: 'sle-cmp-note sle-small' });
  const list = el('ol', { class: 'sle-cmp-list' });
  const extra = el('div', { class: 'sle-cmp-extra' });
  // Full view („Alle Ranglisten“ overlay, LeaderboardOverlay.ts): table, Medaillenspiegel, Vergleichen.
  const fullBtn = el('button', { type: 'button', class: 'sle-btn', text: '⛶ Alle Ranglisten', title: 'Alle Disziplinen in einer Tabelle, Medaillenspiegel' });
  const cmpBtn = el('button', { type: 'button', class: 'sle-btn', text: '⚖️ Vergleichen', title: 'Zwei oder drei Orte nebeneinander' });
  fullBtn.addEventListener('click', () => openLb({ tab: 'tabelle', sortBy: discipline?.id ?? null }));
  cmpBtn.addEventListener('click', () => {
    const p = selection?.kind === 'place' ? selection.place : null;
    openLb({ tab: 'vergleich', compare: p ? compareWith(p) : undefined });
  });
  const fullRow = el('div', { class: 'sle-cmp-actions sle-cmp-full' }, fullBtn, cmpBtn);
  const boardView = el('div', { class: 'sle-cmp-board' }, chips, fullRow, desc, note, list, extra);
  const cardView = el('div', { class: 'sle-cmp-card' });
  cardView.hidden = true;
  const disclaimer = el('p', { class: 'sle-cmp-disclaimer sle-small' });
  const sources = el('details', { class: 'sle-cmp-sources sle-small' });
  /** Notice line at the top of the open card (replaces the toast that covered card rows on phones). */
  let cardNotice: HTMLElement | null = null;
  /** Card sections the user opened or closed (kept while switching places). */
  const secOpen = new Map<string, boolean>();

  // ---- helpers ------------------------------------------------------------------------------------
  const inAoi = (E: number, N: number) => inAoiRect(aoi, E, N);

  /** Phones: the „Orte“ drawer is a bottom sheet over the lower part of the view. */
  const sheetOpen = () => {
    const drawer = h.places.closest<HTMLElement>('.sle-drawer');
    if (!drawer || drawer.hidden) return false;
    const r = drawer.getBoundingClientRect();
    return r.width >= window.innerWidth * 0.9 && r.top > window.innerHeight * 0.25;
  };

  /**
   * A message about the open card goes into the card itself (top line, highlighted), so it neither
   * covers card rows on phones nor disagrees with them; without an open card it is a toast.
   */
  const say = (text: string, ms = 5000) => {
    if (cardNotice && !cardView.hidden && cardNotice.isConnected) {
      cardNotice.textContent = `ⓘ ${text}`;
      cardNotice.hidden = false;
      cardNotice.classList.remove('flash');
      void cardNotice.offsetWidth; // restart the highlight
      cardNotice.classList.add('flash');
      return;
    }
    services.toast(text, false, ms);
  };

  /**
   * Oblique fly-to like the POI list (`flyToSite`), but on phones the target is framed above the
   * bottom sheet (which stays open so the place card is readable while flying): the camera keeps
   * its pose near the target and looks down more steeply (framedPose). The camera pose is flown to
   * directly (not via a look-at point, which could fall outside the terrain at the AOI edge).
   */
  const flyFramed = (E: number, N: number, dist: number, agl: number, lift = 0) => {
    const s = ctx.store.get();
    const heading = Math.hypot(E - s.E, N - s.N) > dist * 1.5 ? gridBearing(s.E, s.N, E, N) : s.heading;
    const drawer = h.places.closest<HTMLElement>('.sle-drawer');
    const r = drawer && !drawer.hidden ? drawer.getBoundingClientRect() : null;
    const sheet = r && r.width >= window.innerWidth * 0.9 && r.top > window.innerHeight * 0.25;
    const cover = sheet ? (window.innerHeight - r.top) / window.innerHeight : 0;
    const k = sheet ? 0.75 : 1; // phones: a little closer (narrow view)
    const exag = terrain.uniforms.uExag.value;
    // `lift` (a crown top) is not exaggerated (trees keep their true height, see trees/TreeMaterial).
    const pose = framedPose(E, N, heading, dist * k * exag, agl * k * exag, cover, ctx.camera.fov, lift);
    const t = utmToWorld(E, N, manifest.origin);
    const g = terrain.surfaceY(t.x, t.z);
    if (!Number.isFinite(g)) {
      // Target ground unknown (outside the loaded terrain): oblique look-at fly-to, as before.
      const v = obliqueView(dist * k, agl * k, heading);
      void ctx.flyTo(E, N, { agl: v.agl * exag + lift, heading: v.heading, pitch: v.pitch, lookAt: true });
      return;
    }
    const c = utmToWorld(pose.E, pose.N, manifest.origin);
    const gc = terrain.surfaceY(c.x, c.z);
    const y = Math.max(g + pose.height, Number.isFinite(gc) ? gc + 30 : -Infinity);
    void ctx.flyTo(pose.E, pose.N, { y, heading, pitch: pose.pitchDeg, lookAt: false });
  };

  /**
   * Fly to an area (place / municipality). Mostly outside the 3D area (or its label outside): aim at
   * the part inside the AOI and say so (in the card, same rounding as the card); nothing inside: no
   * flight, the outline opens on the map.
   */
  const flyToArea = (title: string, rings: Array<Array<[number, number]>>, box: Place['bbox'], label: Place['label'], sharePct: number | null) => {
    const labelIn = label ? inAoi(label[0], label[1]) : box ? inAoi((box[0] + box[2]) / 2, (box[1] + box[3]) / 2) : false;
    if (rings.length && ((sharePct ?? 100) < 50 || !labelIn)) {
      const f = insideFocus(rings, aoi);
      if (!f) {
        say(`${title} liegt außerhalb des 3D-Gebiets – der Umriss steht nur auf der Karte.`);
        layer.showOnMap();
        return;
      }
      const pct = sharePct ?? f.share * 100;
      if (pct < 50) say(outsideNote(title, pct));
      const fr = frameBox(f.bbox, [f.E, f.N]);
      if (fr) flyFramed(fr.E, fr.N, fr.dist, fr.agl);
      return;
    }
    const fr = frameBox(box, label);
    if (fr) flyFramed(fr.E, fr.N, fr.dist, fr.agl);
  };

  const flyToPlace = (p: Place) => flyToArea(placeTitle(p), outlines.get(p.id) ?? [], p.bbox, p.label, p.aoi_share_pct);
  /** Fly to a tree top (Riesenbaum or one of the Riesen): frame the crown top (pin tip). */
  const flyToTree = (E: number, N: number, hTree: number, what: string, p: Place): boolean => {
    if (!inAoi(E, N)) {
      say(`${what} liegt außerhalb des 3D-Gebiets – nur auf der Karte.`, 4000);
      flyToPlace(p);
      return false;
    }
    const dist = Math.max(160, hTree * 5);
    flyFramed(E, N, dist, dist * 0.45, hTree);
    return true;
  };
  const flyToGiant = (p: Place) => {
    const t = p.tallest;
    if (t) flyToTree(t.E, t.N, t.h, `Riesenbaum ${p.name_de}`, p);
  };
  const flyToMunicipality = (m: Municipality) => {
    const ps = (data?.places ?? []).filter((p) => m.places.includes(p.id));
    const rings = ps.flatMap((p) => outlines.get(p.id) ?? []);
    flyToArea(`Gemeinde ${m.name_de}`, rings, unionBox(ps.map((p) => p.bbox)), null, null);
  };
  /** „Auf der Karte“: the whole outline on the full-screen map (closing it returns to the 3D view). */
  const mapButton = () => {
    const b = el('button', { type: 'button', class: 'sle-btn', text: '🗺 Auf der Karte', title: 'Ganzen Umriss auf der großen Karte zeigen' });
    b.addEventListener('click', () => {
      if (!layer.showOnMap()) services.toast('Karte nicht verfügbar.', false, 2500);
    });
    return b;
  };

  const badgeEls = (p: Place) =>
    placeBadges(p, data?.rlpTreeRatio ?? null).map((b) => el('span', { class: `sle-cmp-badge b-${b.key}`, text: b.text, title: b.title }));

  const syncGiants = () => {
    const on = !!data && discipline?.id === GIANT_ID && !sec.root.hidden;
    layer.setGiants(on ? data!.places : []);
  };

  const syncRiesen = () => {
    const p = selection?.kind === 'place' ? selection.place : null;
    const active = p && activeRiese && p.riesen.includes(activeRiese) ? activeRiese : null;
    layer.setRiesen(
      p,
      active,
      (r) => isDiscovered(collected, r.id),
      (r) => {
        if (p) openRiese(p, r);
      },
    );
  };

  // ---- local collecting ---------------------------------------------------------------------------------
  const resetBtn = el('button', { type: 'button', class: 'sle-cmp-reset', text: 'Zurücksetzen', title: 'Entdeckte Riesen und besuchte Orte auf diesem Gerät löschen' });
  let resetArmed: ReturnType<typeof setTimeout> | undefined;
  const disarm = () => {
    if (resetArmed !== undefined) clearTimeout(resetArmed);
    resetArmed = undefined;
    resetBtn.textContent = 'Zurücksetzen';
    resetBtn.classList.remove('armed');
  };
  resetBtn.addEventListener('click', () => {
    if (resetArmed === undefined) {
      resetBtn.textContent = 'Wirklich löschen?';
      resetBtn.classList.add('armed');
      resetArmed = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    collected = clearCollect(storage());
    armCollectGate(gate); // the place under the camera does not count again right away
    refreshCollected();
  });

  const riesenIds = () => riesenAll.map((x) => x.riese.id!);

  const renderProgress = () => {
    if (!data) return;
    const pr = collectProgress(
      collected,
      riesenIds(),
      data.places.map((p) => p.id),
    );
    const parts: Node[] = [
      el(
        'span',
        { class: 'sle-cmp-prog', title: 'Ein Riese zählt, wenn du bis auf etwa 150 m herangeflogen bist oder seinen Baum-Steckbrief geöffnet hast. Nur Riesen im 3D-Gebiet.' },
        '🌲 Riesen entdeckt ',
        el('b', { text: `${pr.riesen[0]}/${pr.riesen[1]}` }),
      ),
      el('span', { class: 'sle-cmp-prog', title: 'Ein Ort zählt, wenn du selbst über seine Gemarkung geflogen bist (nicht der Startpunkt, kein automatisches Hinfliegen).' }, '📍 Orte besucht ', el('b', { text: `${pr.places[0]}/${pr.places[1]}` })),
    ];
    if (pr.riesen[0] || pr.places[0]) parts.push(resetBtn);
    parts.push(el('span', { class: 'sle-cmp-prog-note', text: 'Nur auf diesem Gerät gespeichert, nichts wird übertragen.' }));
    progress.replaceChildren(...parts);
  };

  /** After a change: progress row, board checkmarks, the open card's Riesen list and the minimap dots. */
  const refreshCollected = () => {
    renderProgress();
    if (!boardView.hidden) renderBoard();
    else if (selection?.kind === 'place') refreshRiesenList();
    syncRiesen();
  };

  const celebrate = (text: string, quiet = false) => {
    progress.classList.remove('flash');
    void progress.offsetWidth;
    progress.classList.add('flash');
    // Phones: the sheet shows the progress row, and the Baum-Steckbrief is a bottom card too; a toast
    // there would cover card rows. `quiet`: the open Baum-Steckbrief already names the Riese.
    const treeCardOpen = !!document.querySelector('.sle-tree-card:not([hidden])');
    if (quiet || sheetOpen() || (treeCardOpen && window.innerWidth <= 600)) return;
    services.toast(text, false, 3500);
  };

  const discover = (ids: number[], quiet = false) => {
    const fresh = riesenAll.filter((x) => ids.includes(x.riese.id!) && markRiese(collected, x.riese.id!));
    if (!fresh.length) return;
    saveCollect(storage(), collected);
    refreshCollected();
    const f = fresh[0];
    const p = data?.places.find((x) => x.id === f.place);
    const pr = collectProgress(collected, riesenIds(), []);
    celebrate(`🌲 Riese entdeckt: Nr. ${f.riese.rank} von ${p?.name_de ?? '?'} (${fmtNum(f.riese.h, 1)} m) · ${pr.riesen[0]}/${pr.riesen[1]}`, quiet);
  };

  const collectTick = () => {
    if (!data) return;
    const s = ctx.store.get();
    // Automatic fly-tos pass over other places / Riesen and end in a framed pose that may hover over the
    // neighbouring Gemarkung: they do not collect (collect.ts collectGate).
    const ok = collectGate(gate, ctx.controller.flying, s);
    if (!ok.riesen) return;
    const near = riesenNear(
      riesenAll.map((x) => x.riese),
      { E: s.E, N: s.N, agl: s.agl },
    );
    if (near.length) discover(near.map((r) => r.id!));
    if (ok.places && Number.isFinite(s.agl) && s.agl <= VISIT_MAX_AGL_M && outlines.size) {
      const pid = placeIdAt(outlines, s.E, s.N);
      const p = pid ? data.places.find((x) => x.id === pid) : undefined;
      if (p && markPlace(collected, p.id)) {
        saveCollect(storage(), collected);
        refreshCollected();
        const pr = collectProgress(
          collected,
          [],
          data.places.map((x) => x.id),
        );
        celebrate(`📍 ${placeTitle(p)} besucht · ${pr.places[0]}/${pr.places[1]}`);
      }
    }
  };

  const onTreeCard = (e: Event) => {
    const id = (e as CustomEvent<{ id?: unknown }>).detail?.id;
    if (typeof id === 'number' && riesenAll.some((x) => x.riese.id === id)) discover([id], window.innerWidth <= 600);
  };
  window.addEventListener(TREE_CARD_OPEN_EVENT, onTreeCard);

  // ---- discipline chooser ---------------------------------------------------------------------------
  const renderChips = () => {
    chips.replaceChildren();
    for (const d of data!.disciplines) {
      const on = d.id === discipline?.id;
      const b = el(
        'button',
        {
          type: 'button',
          class: `sle-cmp-chip${on ? ' on' : ''}${d.ready ? '' : ' soon'}`,
          role: 'radio',
          'aria-checked': String(on),
          'data-id': d.id,
          title: d.ready ? d.description_de : `${d.name_de}: bald (${d.description_de})`,
          disabled: !d.ready,
        },
        el('span', { class: 'sle-cmp-emoji', 'aria-hidden': 'true', text: d.emoji ?? '🏅' }),
        el('span', { text: d.name_de }),
        d.ready ? null : el('span', { class: 'sle-cmp-soon', text: 'bald' }),
      );
      b.addEventListener('click', () => setDiscipline(d));
      chips.append(b);
    }
    // Keep the active chip in view (the row scrolls sideways on narrow drawers).
    const on = chips.querySelector<HTMLElement>('.sle-cmp-chip.on');
    if (on) {
      const l = on.offsetLeft - chips.offsetLeft;
      if (l < chips.scrollLeft || l + on.offsetWidth > chips.scrollLeft + chips.clientWidth) chips.scrollLeft = Math.max(0, l - 8);
    }
  };

  const setDiscipline = (d: Discipline) => {
    discipline = d;
    savePref(d.id);
    renderChips();
    renderBoard();
    syncGiants();
  };

  // ---- board ----------------------------------------------------------------------------------------
  const rankLabel = (rank: number) => el('span', { class: 'sle-cmp-rank', text: MEDALS[rank - 1] ?? `${rank}.`, 'aria-label': `Platz ${rank}` });

  const placeRow = (p: Place, value: number | null, rank: number | null, d: Discipline) => {
    const visited = !!collected.places[p.id];
    const b = el(
      'button',
      { type: 'button', class: 'sle-cmp-row', title: `${placeTitle(p)}: Karte öffnen und hinfliegen` },
      rank ? rankLabel(rank) : el('span', { class: 'sle-cmp-rank dim', text: '–' }),
      el(
        'span',
        { class: 'sle-cmp-name' },
        el('span', {}, placeTitle(p), visited ? el('span', { class: 'sle-cmp-visited', text: ' ✓', title: 'besucht (auf diesem Gerät)', 'aria-label': 'besucht' }) : null),
        el('span', { class: 'sle-cmp-badges' }, ...badgeEls(p)),
      ),
      el('span', { class: 'sle-cmp-val', text: fmtValue(value, d.unit) }),
    );
    if (selection?.kind === 'place' && selection.place.id === p.id) b.classList.add('active');
    b.addEventListener('click', () => {
      select({ kind: 'place', place: p });
      if (d.id === GIANT_ID && p.tallest && inAoi(p.tallest.E, p.tallest.N)) flyToGiant(p);
      else flyToPlace(p);
    });
    return el('li', {}, b);
  };

  const munRow = (m: Municipality, value: number | null, rank: number | null, d: Discipline) => {
    const pv = m.pv;
    const b = el(
      'button',
      { type: 'button', class: 'sle-cmp-row', title: `Gemeinde ${m.name_de}: Karte öffnen und hinfliegen` },
      rank ? rankLabel(rank) : el('span', { class: 'sle-cmp-rank dim', text: '–' }),
      el(
        'span',
        { class: 'sle-cmp-name' },
        el('span', { text: `Gemeinde ${m.name_de}` }),
        pv ? el('span', { class: 'sle-cmp-sub', text: `${fmtNum(pv.systems)} Anlagen · ${fmtNum(pv.kwp)} kWp` }) : null,
      ),
      el('span', { class: 'sle-cmp-val', text: fmtValue(value, d.unit) }),
    );
    if (selection?.kind === 'municipality' && selection.mun.id === m.id) b.classList.add('active');
    b.addEventListener('click', () => {
      select({ kind: 'municipality', mun: m });
      flyToMunicipality(m);
    });
    return el('li', {}, b);
  };

  const renderBoard = () => {
    list.replaceChildren();
    extra.replaceChildren();
    const d = discipline;
    if (!d || !data) return;
    desc.textContent = d.description_de;
    const notes: string[] = [];
    if (d.scope === 'municipality') {
      notes.push(
        'Gemeinde-Ansicht, keine Rangliste der Gemarkungen: Das Marktstammdatenregister (MaStR) nennt kleine Anlagen unter 30 kW nur pro Gemeinde, ohne Adresse – Kirrberg, Homburg und Bruchhof teilen sich eine Postleitzahl.',
      );
    }
    if (d.note_de) notes.push(d.note_de);
    note.hidden = !notes.length;
    note.textContent = notes.join(' ');
    const board = boardFor(data, d);
    if (!board) {
      list.append(el('li', { class: 'sle-dim', text: 'Kommt bald.' }));
      return;
    }
    const row = (e: { item: Place | Municipality; value: number | null }, rank: number | null) =>
      d.scope === 'municipality' ? munRow(e.item as Municipality, e.value, rank, d) : placeRow(e.item as Place, e.value, rank, d);
    if (!board.ranked.length) list.append(el('li', { class: 'sle-dim', text: 'keine Daten' }));
    for (const e of (board as Board<Place | Municipality>).ranked) list.append(row(e, e.rank));
    const rest = (title: string, entries: Array<{ item: Place | Municipality; value: number | null }>) => {
      if (!entries.length) return;
      const ol = el('ol', { class: 'sle-cmp-list' });
      for (const e of entries) ol.append(row(e, null));
      extra.append(el('p', { class: 'sle-cmp-rest sle-small', text: title }), ol);
    };
    rest('Unvollständig (ohne Rang)', (board as Board<Place | Municipality>).incomplete);
    rest('Keine Daten (ohne Rang)', (board as Board<Place | Municipality>).noData);
    if (d.id === GIANT_ID) extra.append(el('p', { class: 'sle-dim sle-small', text: '🌲 Riesenbäume sind in 3D und auf der Karte markiert (Höhe aus LiDAR, nicht vor Ort gemessen).' }));
  };

  // ---- place / municipality card ------------------------------------------------------------------------
  const kv = (label: string, value: string | Node, hint?: string) =>
    el('div', { class: 'sle-cmp-kv' }, el('dt', { text: label, title: hint }), el('dd', {}, value));
  const estChip = () => el('span', { class: 'sle-cmp-est', text: 'Schätzung' });
  const estimate = (text: string) => el('span', {}, `${text} `, estChip());
  const cut = (p: Place, path: string, v: string) =>
    p.suppressed.includes(path) || p.suppressed.some((s) => path.startsWith(`${s}.`)) ? 'nicht veröffentlicht (zu wenige)' : v;
  const small = (text: string) => el('p', { class: 'sle-cmp-fine sle-small', text });

  /** A collapsible card section; its open state is remembered while the panel lives. */
  const section = (id: string, title: string, summary: string | null, openByDefault: boolean, ...body: Array<Node | null>) => {
    const d = el(
      'details',
      { class: 'sle-cmp-sec', 'data-sec': id },
      el('summary', {}, el('span', { class: 'sle-cmp-sec-title', text: title }), summary ? el('span', { class: 'sle-cmp-sec-sum', text: summary }) : null),
      ...body,
    ) as HTMLDetailsElement;
    d.open = secOpen.get(id) ?? openByDefault;
    d.addEventListener('toggle', () => secOpen.set(id, d.open));
    return d;
  };

  /** Stacked share bar + legend (the legend text carries the meaning; colours are a second channel). */
  /** `weak` parts are unsure (hatched, „?“ and „unsicher“ in the label). */
  const stackBar = (aria: string, parts: Array<{ key: string; label: string; pct: number; color: string; weak?: boolean }>) => {
    const name = (x: { label: string; weak?: boolean }) => (x.weak ? `${x.label}? (unsicher)` : x.label);
    const bar = el('div', { class: 'sle-cmp-bar', role: 'img', 'aria-label': `${aria}: ${parts.map((x) => `${name(x)} ${fmtNum(x.pct)} %`).join(', ')}` });
    const legend = el('ul', { class: 'sle-cmp-legend' });
    for (const x of parts) {
      const seg = el('span', { class: `sle-cmp-seg${x.weak ? ' weak' : ''}`, title: `${name(x)}: ${fmtNum(x.pct)} %` });
      seg.style.width = `${Math.max(0, x.pct)}%`;
      seg.style.backgroundColor = x.color;
      bar.append(seg);
      const sw = el('span', { class: `sle-cmp-swatch${x.weak ? ' weak' : ''}`, 'aria-hidden': 'true' });
      sw.style.backgroundColor = x.color;
      legend.append(
        el(
          'li',
          { class: x.weak ? 'weak' : undefined },
          sw,
          el('span', { text: x.weak ? `${x.label}?` : x.label, title: x.weak ? 'unsicher: diese Klasse erkennt die Karte hier schlecht' : undefined }),
          el('span', { class: 'sle-cmp-legend-v', text: `${fmtNum(x.pct)} %` }),
        ),
      );
    }
    return [bar, legend];
  };

  const cardHead = (title: string, badges: Node[]) => {
    const back = el('button', { type: 'button', class: 'sle-btn sle-cmp-back', text: '← Rangliste' });
    back.addEventListener('click', () => {
      cardView.hidden = true;
      boardView.hidden = false;
      activeRiese = null;
      syncRiesen();
      renderBoard();
    });
    const clear = el('button', { type: 'button', class: 'sle-btn sle-cmp-clear', text: 'Auswahl aufheben', title: 'Umriss ausblenden' });
    clear.addEventListener('click', () => {
      select(null);
      cardView.hidden = true;
      boardView.hidden = false;
      renderBoard();
    });
    cardNotice = el('p', { class: 'sle-cmp-notice sle-small', role: 'status' });
    cardNotice.hidden = true;
    return [el('div', { class: 'sle-cmp-card-nav' }, back, clear), el('h4', { class: 'sle-cmp-card-title', text: title }), el('div', { class: 'sle-cmp-badges' }, ...badges), cardNotice];
  };

  // -- Riesen ------------------------------------------------------------------------------------------
  let riesenList: HTMLElement | null = null;
  let riesenFor: Place | null = null;

  const openRiese = (p: Place, r: Riese) => {
    activeRiese = r;
    refreshRiesenList();
    syncRiesen();
    const flown = flyToTree(r.E, r.N, r.h, `Riese Nr. ${r.rank} von ${p.name_de}`, p);
    // The framed pose stays ≥ 160 m away and fly-tos do not collect (collect.ts): say how it counts.
    if (flown && !isDiscovered(collected, r.id)) say(`Riese Nr. ${r.rank}: zum Entdecken näher als etwa 150 m heranfliegen oder den Baum antippen.`, 5000);
  };

  const riesenItems = (p: Place) =>
    p.riesen.map((r) => {
      const found = isDiscovered(collected, r.id);
      const out = !inAoi(r.E, r.N);
      const tags: Node[] = [];
      if (found) tags.push(el('span', { class: 'sle-cmp-tag found', text: '✓ entdeckt' }));
      if (out) tags.push(el('span', { class: 'sle-cmp-tag', text: 'nur auf der Karte', title: 'Außerhalb des 3D-Gebiets' }));
      const b = el(
        'button',
        {
          type: 'button',
          class: `sle-cmp-riese${activeRiese === r ? ' active' : ''}`,
          title: `Riese Nr. ${r.rank}: ${out ? 'auf der Karte zeigen' : 'hinfliegen und markieren'}`,
        },
        el('span', { class: 'sle-cmp-rank', text: `${r.rank}.` }),
        el('span', { class: 'sle-cmp-riese-h', text: `${fmtNum(r.h, 1)} m` }),
        el(
          'span',
          { class: 'sle-cmp-riese-sp' },
          r.species ? el('span', {}, rieseSpeciesText(data!.labels, r.species), ' ', estChip()) : el('span', { class: 'sle-dim', text: 'Art: keine Angabe' }),
          tags.length ? el('span', { class: 'sle-cmp-tags' }, ...tags) : null,
        ),
      );
      b.addEventListener('click', () => openRiese(p, r));
      return el('li', {}, b);
    });

  const refreshRiesenList = () => {
    if (riesenList && riesenFor && riesenList.isConnected) riesenList.replaceChildren(...riesenItems(riesenFor));
  };

  const riesenSection = (p: Place) => {
    if (!p.riesen.length) return null;
    riesenFor = p;
    riesenList = el('ol', { class: 'sle-cmp-riesen' }, ...riesenItems(p));
    return section(
      'riesen',
      `🌲 Riesen von ${p.name_de}`,
      `${p.riesen.length} · bis ${fmtNum(p.riesen[0].h, 1)} m`,
      true,
      riesenList,
      small(
        'Die höchsten geprüften Bäume außerhalb der Ortslage, mindestens 20 m voneinander entfernt. Höhe aus LiDAR, nicht vor Ort gemessen. Baumart aus der Satellitenkarte (Schätzung); Erle und „andere Laubbäume“ werden nicht genannt, weil diese Klassen hier sehr unsicher sind. Entdeckt ist ein Riese, wenn du näher als etwa 150 m heranfliegst oder ihn antippst – das Hinfliegen aus der Liste allein zählt nicht.',
      ),
    );
  };

  // -- species, age, biodiversity, roofs, land use, goals ------------------------------------------------
  const speciesSection = (p: Place) => {
    const s = p.species;
    if (!s) return null;
    const L = data!.labels.species;
    const parts = s.mix.map((m) => ({ key: m.key, label: labelOf(L, m.key), pct: m.share_pct, color: SPECIES_COLORS[m.key] ?? '#777', weak: m.weak }));
    const dom = s.mix[0];
    const weak = s.mix.filter((m) => m.weak);
    const weakPct = weak.reduce((acc, m) => acc + m.share_pct, 0);
    return section(
      'species',
      '🌳 Baumarten im Wald',
      `meist ${labelOf(L, s.dominant ?? dom.key)} (${fmtNum(dom.share_pct)} %)`,
      true,
      ...stackBar('Baumarten nach Kronenfläche', parts),
      el(
        'p',
        { class: 'sle-cmp-fine sle-small' },
        `Anteile an der Kronenfläche mit bekannter Art. Gilt nur für den Waldteil: ${s.coverage_pct !== null ? `${fmtNum(s.coverage_pct)} %` : 'ein Teil'} der Kronenfläche liegen in der Waldkarte, Gärten und Ortsbäume fehlen.${s.conifer_pct !== null ? ` Nadelbäume: ${fmtNum(s.conifer_pct)} %.` : ''} Satellitenkarte (DLR 2022, 10-m-Raster) `,
        estChip(),
      ),
      weak.length
        ? el(
            'p',
            { class: 'sle-cmp-fine sle-small' },
            `Schraffiert mit „?“ (${weak.map((m) => labelOf(L, m.key)).join(', ')}, zusammen ${fmtNum(Math.round(weakPct * 10) / 10)} %): diese Klassen erkennt die Karte hier schlecht. Eine zweite Karte (Thünen-Institut) bestätigt sie nur für weniger als jede zehnte Fläche; meist steht dort Eiche, Buche oder Douglasie.`,
          )
        : null,
    );
  };

  const forestEpochLabel = (year: number) => {
    const e = manifest.forest_hist?.epochs.find((x) => x.year === year);
    return e ? epochSpan(e) : String(year);
  };

  /** tree-age-height-v2: trees taller than the yield table have no age (grey share in the bar). */
  const beyondNote = (a: NonNullable<Place['forest_age']>) => {
    const b = a.classes_pct.find(([k]) => k === 'beyond')?.[1] ?? null;
    if (b === null || b <= 0) return '';
    return `${fmtNum(b)} % der Kronenfläche${a.trees_beyond !== null ? ` (${fmtNum(a.trees_beyond)} Bäume)` : ''} sind höher, als die Ertragstafel reicht: ohne Alter (sehr guter Standort oder sehr alt), nicht im Mittelwert. `;
  };

  const ageSection = (p: Place) => {
    const a = p.forest_age;
    const fc = p.forest_continuity;
    const fcp = p.forest_continuity_pct;
    if (!a && fcp === null && !fc) return null;
    const body: Array<Node | null> = [];
    if (a && a.classes_pct.length) {
      const AL = data!.labels.age_classes;
      body.push(...stackBar('Altersklassen nach Kronenfläche', a.classes_pct.map(([k, pct]) => ({ key: k, label: labelOf(AL, k), pct, color: AGE_COLORS[k] ?? '#777' }))));
    }
    if (a) {
      body.push(
        el(
          'p',
          { class: 'sle-cmp-fine sle-small' },
          `${a.median_y !== null ? `Mittleres Alter etwa ${fmtNum(a.median_y)} Jahre. ` : ''}Aus der Baumhöhe geschätzt (Ertragstafeln), Bäume ab 8 m${a.trees !== null ? ` (${fmtNum(a.trees)})` : ''}, nach Kronenfläche; gilt für Waldbäume. ${beyondNote(a)}`,
          estChip(),
        ),
      );
    }
    if (fc || fcp !== null) {
      const span = (fc?.epochs.length ? fc.epochs : [1935]).map(forestEpochLabel).join(', ');
      // One classified map is a snapshot: „laut Karte … Wald“, never „seit“ (contract UI rule).
      const text =
        fcp !== null
          ? `Laut Karte ${span}: ${fmtNum(fcp)} % der heutigen Kronenfläche stehen auf damaligem Wald. Eine Karte ist eine Momentaufnahme, kein „seit“.`
          : `Wald laut Karte ${span}: keine Angabe, die Karte deckt nur ${fmtNum(fc?.covered_pct ?? 0)} % der Kronenfläche ab.`;
      body.push(el('p', { class: 'sle-cmp-fine sle-small' }, text, ' ', fcp !== null ? estChip() : null));
    }
    const sum = a && a.median_y !== null ? `Mitte etwa ${fmtNum(a.median_y)} Jahre` : fcp !== null ? `${fmtNum(fcp)} % auf altem Wald` : null;
    return section('age', '⏳ Waldalter und alter Wald', sum, false, ...body);
  };

  const bioSection = (p: Place) => {
    const b = p.biodiversity;
    if (!b) return null;
    const dl = el('dl', { class: 'sle-cmp-kvs' });
    if (b.rarefied_500 !== null) {
      dl.append(
        kv(
          'Arten je 500 Meldungen',
          estimate(`${fmtNum(b.rarefied_500)}${b.rarefied_500_range ? ` (${fmtRange(b.rarefied_500_range)})` : ''}`),
          'Erwartete Artenzahl in 500 zufällig gezogenen Meldungen (Rarefaction): macht Orte mit vielen und wenigen Meldungen vergleichbar',
        ),
      );
    } else {
      dl.append(kv('Arten je 500 Meldungen', el('span', { class: 'sle-dim', text: 'zu wenige Meldungen (unter 500)' })));
      if (b.rarefied_150_range) dl.append(kv('Arten je 150 Meldungen', estimate(`${fmtNum(b.rarefied_150_range[1])} (${fmtRange(b.rarefied_150_range)})`), 'Kleinere Stichprobe, trennt Orte weniger gut'));
    }
    dl.append(kv('Gemeldete Arten', fmtNum(b.species)), kv('Meldungen', `${fmtNum(b.occurrences)}${b.years ? ` (${b.years[0]}–${b.years[1]})` : ''}`));
    if (b.inat_share_pct !== null) dl.append(kv('davon iNaturalist', `${fmtNum(b.inat_share_pct)} %`));
    return section(
      'bio',
      '🦋 Gemeldete Artenvielfalt',
      b.rarefied_500 !== null ? `${fmtNum(b.rarefied_500)} Arten je 500 Meldungen` : `${fmtNum(b.species)} Arten gemeldet`,
      false,
      dl,
      small('Gemeldete Beobachtungen (GBIF, u. a. iNaturalist), keine Bewertung der Natur: Der Wert hängt davon ab, wer wo was beobachtet. Nur Zahlen pro Gemarkung, keine Fundorte.'),
    );
  };

  const usedLine = (m: Municipality) => {
    const pv = m.pv;
    if (!pv) return null;
    if (pv.used_pct) return el('span', {}, `${fmtNum(pv.used_pct[0])}–${fmtNum(pv.used_pct[2])} % genutzt `, estChip());
    return pv.used_pct_reason_de ? el('span', { class: 'sle-dim', text: `keine Angabe: ${pv.used_pct_reason_de}` }) : null;
  };

  const roofSection = (p: Place, mun: Municipality | undefined) => {
    const r = p.roof_potential;
    const suppressed = p.suppressed.includes('roof_potential');
    if (!r && !suppressed) return null;
    const dl = el('dl', { class: 'sle-cmp-kvs' });
    if (r) {
      // The area next to the kWp is the usable one (review 2026-11-08): the suitable planes before the factors read as
      // inflated (67–80 % of all roof area) next to a kWp range that rests on ≈ 40 %.
      if (r.usable_m2 !== null) {
        const sub = r.suitable_m2 !== null ? el('span', { class: 'sle-cmp-kv-sub' }, `von ≈ ${fmtNum(r.suitable_m2)} m² geeigneten Dachflächen`) : null;
        dl.append(kv('Nutzbare Dachfläche', el('span', {}, estimate(`≈ ${fmtNum(r.usable_m2)} m²`), sub ? el('br') : null, sub), 'Geeignete Dachflächen (ab 10 m², bis 60° Neigung, flach oder nach Osten bis Westen), davon nutzbar: Schrägdächer 70 %, Flachdächer 40 % (Abstände, Aufbauten); ohne Verschattung'));
      } else if (r.suitable_m2 !== null) {
        dl.append(kv('Geeignete Dachfläche', `≈ ${fmtNum(r.suitable_m2)} m²`, 'Vor Abzügen: Dachflächen ab 10 m², bis 60° Neigung, flach oder nach Osten bis Westen; ohne Verschattung'));
      }
      if (r.kwp) dl.append(kv('Mögliche Leistung', estimate(fmtRange(r.kwp, 'kWp')), 'Nutzbare Dachfläche × 0,15–0,20 kWp/m²'));
      if (r.buildings !== null) dl.append(kv('Gebäude (LoD2)', fmtNum(r.buildings)));
    } else dl.append(kv('Dachpotenzial', 'nicht veröffentlicht (zu wenige)'));
    if (mun?.pv) {
      dl.append(kv(`Gemeinde ${mun.name_de}`, `${fmtNum(mun.pv.kwp)} kWp installiert (MaStR)`, 'Marktstammdatenregister: nur pro Gemeinde'));
      const u = usedLine(mun);
      if (u) dl.append(kv('Anteil genutzt', u, 'MaStR-Leistung auf Gebäuden ÷ Dachpotenzial der ganzen Gemeinde'));
    }
    return section(
      'roof',
      '☀️ Dächer und Sonne',
      r?.kwp ? `${fmtRange(r.kwp, 'kWp')} möglich` : null,
      false,
      dl,
      small('Grobe Schätzung aus den 3D-Gebäuden (LoD2), ohne Verschattung und Statik. Nur Summen pro Gemarkung, keine einzelnen Dächer; installierte Anlagen gibt es nur pro Gemeinde.'),
    );
  };

  const nutzungSection = (p: Place) => {
    const n = p.nutzung;
    if (!n) return null;
    const NL = data!.labels.nutzung;
    const parts = [...n].sort((a, b) => b[1] - a[1]).map(([k, pct]) => ({ key: k, label: labelOf(NL, k), pct, color: NUTZUNG_COLORS[k] ?? '#777' }));
    return section('nutzung', '🗺 Nutzung laut Kataster', `meist ${parts[0].label} (${fmtNum(parts[0].pct)} %)`, false, ...stackBar('Tatsächliche Nutzung', parts), small('ALKIS „tatsächliche Nutzung“, Anteile an der amtlichen Fläche.'));
  };

  const goalEl = (g: Goal) => {
    const bar = goalBar(g);
    const nodes: Array<Node | null> = [el('div', { class: 'sle-cmp-goal-title', text: g.title_de })];
    if (bar) {
      const track = el('div', { class: 'sle-cmp-goal-bar', role: 'img', 'aria-label': `Ausgangswert ${fmtGoalValue(g.baseline, g.unit)}, Ziel ${fmtGoalValue(g.target, g.unit)}` });
      const fill = el('span', { class: 'sle-cmp-goal-base' });
      fill.style.width = `${bar.base * 100}%`;
      const tick = el('span', { class: 'sle-cmp-goal-target', title: `Ziel ${fmtGoalValue(g.target, g.unit)}` });
      tick.style.left = `${bar.target * 100}%`;
      track.append(fill, tick);
      nodes.push(track);
    }
    const base = g.baseline === null ? 'Ausgangswert noch nicht messbar' : `Ausgangswert ${fmtGoalValue(g.baseline, g.unit)}${g.baseline_year ? ` (${g.baseline_year})` : ''}`;
    const target = g.target !== null ? ` → Ziel ${fmtGoalValue(g.target, g.unit)}${g.target_year ? ` (${g.target_year})` : ''}` : '';
    nodes.push(el('div', { class: 'sle-cmp-goal-vals sle-small', text: `${base}${target}` }));
    if (g.note_de) nodes.push(el('div', { class: 'sle-cmp-goal-note sle-small', text: g.note_de }));
    const prog =
      g.progress !== null
        ? `Fortschritt: ${fmtNum(Math.round(g.progress * 100))} %`
        : g.measured_by === 'lidar'
          ? 'Fortschritt: ab der nächsten Befliegung'
          : 'Fortschritt: sobald Meldungen vor Ort möglich sind';
    nodes.push(el('div', { class: 'sle-cmp-goal-prog sle-small', text: prog }));
    return el('li', { class: 'sle-cmp-goal' }, ...nodes);
  };

  const goalsSection = (p: Place) => {
    if (!p.goals.length) return null;
    const years = [...new Set(p.goals.map((g) => g.target_year).filter((y): y is number => y !== null))];
    return section(
      'goals',
      `🎯 Ziele${years.length === 1 ? ` bis ${years[0]}` : ''}`,
      `${p.goals.length} Beispielziele`,
      false,
      el('ul', { class: 'sle-cmp-goals' }, ...p.goals.map(goalEl)),
      small('Beispielziele, kein Wettbewerb: Der Balken zeigt den Ausgangswert, der Strich das Ziel. Fortschritt erst mit einer neuen Befliegung oder mit Meldungen vor Ort (später).'),
    );
  };

  // -- „So kommt <Ort> nach oben“ + full view (compare.ts / LeaderboardOverlay.ts) ----------------------------
  const openLb = (o: OverlayOptions) => {
    if (!data) return;
    openLeaderboard(
      {
        data,
        openDialog: (dl) => h.shell.openDialog(dl),
        onPick: (p) => {
          openPlace(p.id);
          flyToPlace(p);
          cardView.querySelector<HTMLElement>('.sle-cmp-back')?.focus({ preventScroll: true });
        },
      },
      o,
    );
  };
  /** This place and its natural rival in the current discipline (right above, or right below when 1st). */
  const compareWith = (p: Place): string[] => {
    const rival = data ? rivalFor(buildMatrix(data), p.id, discipline?.id ?? null) : null;
    return rival ? [p.id, rival] : [p.id];
  };
  const climbSection = (p: Place) => {
    const body = climbList(data!, p, () => {
      const g = cardView.querySelector<HTMLDetailsElement>('details[data-sec="goals"]');
      if (!g) return;
      g.open = true;
      secOpen.set('goals', true);
      g.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      g.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
    });
    if (!body) return null;
    return section('climb', `🚀 So kommt ${p.name_de} nach oben`, climbSummaryText(data!, p), true, body);
  };

  const placeCard = (p: Place) => {
    const d = discipline;
    const out: Node[] = cardHead(placeTitle(p), badgeEls(p));
    if (p.aoi_share_pct !== null && p.aoi_share_pct < 50) {
      // Persistent, same rounding as the published value; a fly-to message replaces it (say()).
      cardNotice!.textContent = `ⓘ Nur ${fmtShare(p.aoi_share_pct)} dieser Gemarkung liegen im 3D-Gebiet; der ganze Umriss steht auf der Karte.`;
      cardNotice!.hidden = false;
    }
    if (p.flags.includes('other-flight')) {
      const share = p.lidar_epochs.length >= 2 ? ` Anteile: ${p.lidar_epochs.map(([y, pct]) => `${fmtNum(Math.round(pct))} % ${y}`).join(' · ')}.` : '';
      out.push(el('p', { class: 'sle-cmp-flight sle-small', text: `ⓘ Andere Befliegung als im Saarland (2025): ${otherFlightNote(p, data!.rlpTreeRatio)}.${share}` }));
    }
    if (d && d.scope === 'place' && d.ready) {
      const board = boardFor(data!, d) as Board<Place> | null;
      const r = board?.ranked.find((e) => e.item.id === p.id);
      if (board && r) out.push(el('p', { class: 'sle-cmp-placing', text: `Platz ${r.rank} von ${board.ranked.length} · ${d.emoji ?? ''} ${d.name_de}: ${fmtValue(r.value, d.unit)}` }));
    }
    const o = p.ortslage;
    const a = approx(p);
    const mun = data!.municipalities.find((m) => m.id === p.municipality);
    const dl = el(
      'dl',
      { class: 'sle-cmp-kvs' },
      kv('Fläche', `${a}${fmtNum(p.area_ha)} ha`),
      kv('Flurstücke', `${a}${fmtNum(p.parcels)}`),
      kv('Bäume (LiDAR)', `${a}${fmtNum(p.trees)}`, 'Erkannte Baumkronen; Unterholz fehlt'),
      kv('Kronenanteil', p.crown_pct === null ? 'keine Daten' : `${fmtNum(p.crown_pct)} %${p.crown_ha !== null ? ` (${fmtNum(p.crown_ha)} ha)` : ''}`),
      kv(
        'Ortslage',
        cut(p, 'ortslage', o ? `${fmtNum(o.area_ha)} ha: ${fmtNum(o.green_pct)} % grün, ${fmtNum(o.sealed_pct)} % versiegelt` : 'keine Daten'),
        'Gebäude plus 50 m, auch Gewerbe und Industrie',
      ),
      kv('Einwohner', p.inhabitants === null ? 'keine Daten' : `≈ ${fmtNum(p.inhabitants)}`, 'Zensus 2022, 100-m-Gitter, anteilig – keine Stadtteilzahl'),
      kv('Bäume pro Einwohner', fmtNum(p.trees_per_inhabitant)),
      kv('Riesenbaum', p.tallest ? `${fmtNum(p.tallest.h, 1)} m` : 'keine Daten', 'LiDAR-Kronenhöhe, außerhalb der Ortslage, nicht vor Ort gemessen'),
      kv('Biomasse', p.agb_t ? estimate(fmtRange(p.agb_t, 't')) : 'keine Daten', 'Oberirdische Trockenmasse, grob (Faktor 2)'),
      kv('CO₂', p.co2_t ? estimate(fmtRange(p.co2_t, 't')) : 'keine Daten', 'CO₂-Äquivalent ≈ 1,8 × Biomasse'),
      kv(
        'Photovoltaik',
        mun?.pv
          ? `Gemeinde ${mun.name_de}: ${fmtNum(mun.pv.kwp_per_inhabitant)} kWp/Einw. (MaStR, nur pro Gemeinde)`
          : p.flags.includes('pv-municipality-only')
            ? 'nur pro Gemeinde (MaStR)'
            : 'keine Daten',
      ),
      kv('LiDAR', p.lidar_epochs.length ? p.lidar_epochs.map(([y, pct]) => `${y} (${fmtNum(Math.round(pct))} %)`).join(', ') : String(p.lidar_epoch ?? '–')),
      kv('Im 3D-Gebiet', p.aoi_share_pct === null ? '–' : `${fmtShare(p.aoi_share_pct)} der Fläche`),
    );
    if (o) dl.insertBefore(kv('Baumkronen in der Ortslage', cut(p, 'ortslage', `${fmtNum(o.canopy_pct)} %`)), dl.children[5]);
    out.push(dl);
    const fly = el('button', { type: 'button', class: 'sle-btn primary', text: 'Hinfliegen' });
    fly.addEventListener('click', () => flyToPlace(p));
    const actions = el('div', { class: 'sle-cmp-actions wrap' }, fly, services.minimap ? mapButton() : null);
    if (p.tallest) {
      const g = el('button', { type: 'button', class: 'sle-btn', text: '🌲 Zum Riesenbaum' });
      g.addEventListener('click', () => {
        if (discipline?.id !== GIANT_ID) {
          const gd = data!.disciplines.find((x) => x.id === GIANT_ID && x.ready);
          if (gd) {
            discipline = gd;
            savePref(gd.id);
            renderChips();
            syncGiants();
          }
        }
        flyToGiant(p);
      });
      actions.append(g);
    }
    const cmp = el('button', { type: 'button', class: 'sle-btn', text: '⚖️ Vergleichen', title: `${p.name_de} mit dem nächstbesseren Ort vergleichen` });
    cmp.addEventListener('click', () => openLb({ tab: 'vergleich', compare: compareWith(p) }));
    actions.append(cmp);
    out.push(actions);
    riesenList = null;
    riesenFor = null;
    for (const s of [climbSection(p), riesenSection(p), speciesSection(p), ageSection(p), bioSection(p), roofSection(p, mun), nutzungSection(p), goalsSection(p)]) if (s) out.push(s);
    return out;
  };

  const munCard = (m: Municipality) => {
    const out: Node[] = cardHead(`Gemeinde ${m.name_de}`, [el('span', { class: 'sle-cmp-badge b-mun', text: 'Gemeinde-Ansicht' })]);
    const pv = m.pv;
    const dl = el(
      'dl',
      { class: 'sle-cmp-kvs' },
      kv('Einwohner', m.inhabitants === null ? 'keine Daten' : fmtNum(m.inhabitants), 'Zensus 2022, amtliche Gemeindezahl'),
      kv('PV-Anlagen', pv ? fmtNum(pv.systems) : 'keine Daten', 'in Betrieb, Balkonkraftwerke eingeschlossen'),
      kv('davon unter 30 kW', pv ? fmtNum(pv.small_systems) : '–', 'ohne Adresse im Register'),
      kv('Leistung', pv ? `${fmtNum(pv.kwp)} kWp` : '–', 'Bruttoleistung laut Register'),
      kv('je Einwohner', pv ? `${fmtNum(pv.kwp_per_inhabitant)} kWp` : '–'),
      kv('Stand', pv?.as_of ?? '–'),
    );
    const rp = m.roof_potential;
    if (rp?.kwp) {
      const names = rp.places.map((id) => data!.places.find((p) => p.id === id)?.name_de ?? id).join(', ');
      dl.append(kv('Dachpotenzial', estimate(fmtRange(rp.kwp, 'kWp')), `Summe der erfassten Gemarkungen: ${names}${rp.complete ? '' : ' (nicht alle Gemarkungen der Gemeinde)'}`));
    }
    const u = usedLine(m);
    if (u) dl.append(kv('Anteil genutzt', u, 'MaStR-Leistung auf Gebäuden ÷ Dachpotenzial der ganzen Gemeinde'));
    out.push(dl, el('p', { class: 'sle-cmp-note sle-small', text: 'MaStR nur pro Gemeinde: kleine Anlagen haben keine Adresse, deshalb gibt es keine PV-Zahl pro Gemarkung.' }));
    const ps = data!.places.filter((p) => m.places.includes(p.id));
    if (ps.length) {
      const row = el('div', { class: 'sle-cmp-actions wrap' });
      for (const p of ps) {
        const b = el('button', { type: 'button', class: 'sle-btn', text: p.name_de, title: `${placeTitle(p)} öffnen` });
        b.addEventListener('click', () => {
          select({ kind: 'place', place: p });
          flyToPlace(p);
        });
        row.append(b);
      }
      out.push(el('p', { class: 'sle-small sle-dim', text: 'Gemarkungen dieser Gemeinde im Vergleich:' }), row);
    }
    if (services.minimap) out.push(el('div', { class: 'sle-cmp-actions' }, mapButton()));
    return out;
  };

  const select = (s: Selection) => {
    if (s?.kind !== 'place' || selection?.kind !== 'place' || selection.place.id !== s.place.id) activeRiese = null;
    selection = s;
    if (!data) return;
    if (!s) {
      cardNotice = null;
      layer.setOutline([], outlines);
      syncRiesen();
      return;
    }
    layer.setOutline(s.kind === 'place' ? [s.place.id] : s.mun.places, outlines);
    cardView.replaceChildren(...(s.kind === 'place' ? placeCard(s.place) : munCard(s.mun)));
    cardView.hidden = false;
    boardView.hidden = true;
    cardView.scrollIntoView?.({ block: 'nearest' });
    syncRiesen();
  };

  // ---- open a place from outside (Baum-Steckbrief link „Orte im Vergleich“) ------------------------------
  let pendingOpen: string | null = null;
  const openPlace = (id: string) => {
    const p = data?.places.find((x) => x.id === id);
    if (!p) {
      if (!data) pendingOpen = id; // still loading: open once the data is in
      return;
    }
    if (h.places.closest<HTMLElement>('.sle-drawer')?.hidden) h.shell.anchor('places')?.click();
    openPanelSection(sec);
    select({ kind: 'place', place: p });
  };
  const onOpenEvent = (e: Event) => {
    const id = (e as CustomEvent<{ id?: unknown }>).detail?.id;
    if (typeof id === 'string') openPlace(id);
  };
  window.addEventListener(PLACE_OPEN_EVENT, onOpenEvent);

  // ---- deep link ?vergleich=a,b[,c] (the pose hash stays the view's; the param is dropped once used) ---------
  let deepTimer: ReturnType<typeof setTimeout> | undefined;
  const openDeepLink = () => {
    const ids = data ? parseCompareParam(location.search, data.places.map((p) => p.id)) : null;
    if (!ids) return;
    history.replaceState(history.state, '', `${location.pathname}${withCompareParam(location.search, [])}${location.hash}`);
    let tries = 0;
    const tryOpen = () => {
      // Wait while the disclaimer / intro or another dialog is open (≤ 2 min), then show the comparison.
      if (modalOpen() && ++tries < 240) {
        deepTimer = setTimeout(tryOpen, 500);
        return;
      }
      openLb({ tab: 'vergleich', compare: ids });
    };
    tryOpen();
  };

  // ---- load ----------------------------------------------------------------------------------------------
  const base = terrain.baseUrl;
  void (async () => {
    try {
      const raw = await fetchJson(base + meta.url, abort.signal);
      const parsed = parsePlacesFile(raw);
      if (!parsed || !parsed.places.length) {
        console.warn('[places] stats/places.json missing or not sle-stats-v1: panel hidden');
        sec.root.hidden = true;
        return;
      }
      data = parsed;
      riesenAll = riesenInAoi(data.places, aoi);
      if (meta.geometry) {
        try {
          outlines = parseOutlines(await fetchJson(base + meta.geometry, abort.signal));
        } catch (err) {
          if (!abort.signal.aborted) console.warn('[places] outlines not loaded (fly-to uses label/bbox)', err);
        }
      }
      const ready = data.disciplines.filter((d) => d.ready);
      const pref = loadPref();
      discipline = ready.find((d) => d.id === pref) ?? ready[0] ?? null;
      sec.setCount(data.places.length);
      disclaimer.textContent = data.disclaimer_de;
      sources.replaceChildren(
        el('summary', { text: 'Quellen und Methode' }),
        el('p', { text: data.attribution }),
        ...data.inputNotes.map((n) => el('p', { text: `Hinweis: ${n}` })),
        el('p', { class: 'sle-dim', text: `Stand der Auswertung: ${data.generated.slice(0, 10)}` }),
      );
      status.remove();
      sec.body.append(progress, boardView, cardView, disclaimer, sources);
      renderProgress();
      renderChips();
      renderBoard();
      syncGiants();
      if (pendingOpen) openPlace(pendingOpen);
      pendingOpen = null;
      openDeepLink();
    } catch (err) {
      if (abort.signal.aborted) return;
      console.warn('[places] stats not loaded: panel hidden', err);
      sec.root.hidden = true;
    }
  })();

  return () => {
    abort.abort();
    if (deepTimer !== undefined) clearTimeout(deepTimer);
    document.getElementById('sle-cmp-full')?.dispatchEvent(new Event('sle:close'));
    window.removeEventListener(PLACE_OPEN_EVENT, onOpenEvent);
    window.removeEventListener(TREE_CARD_OPEN_EVENT, onTreeCard);
    disarm();
    offFrame();
    layer.dispose();
    sec.root.remove();
  };
}
