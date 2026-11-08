/**
 * 🏆 „Orte im Vergleich“ card in the Standard „Orte“ drawer (plan §8 Phase 0, ADR 0049):
 * discipline chooser → one leaderboard per discipline (generic from `disciplines`), tap → fly to
 * the Gemarkung, outline it in 3D + on the minimap and open the place card. „Sonnenstärkster Ort“
 * is a municipality board (MaStR only per Gemeinde). Riesenbaum pins while that discipline is on.
 */
import { gridBearing } from '../pois/PoiPanel';
import { obliqueView } from '../pois/pois';
import { utmToWorld } from '../geo';
import { el } from '../shell/dom';
import type { FeatureHost } from '../shell/types';
import { createPanelSection, openPanelSection } from '../ui/panelSection';
import { PlaceLayer } from './PlaceLayer';
import {
  PLACE_OPEN_EVENT,
  aoiRect,
  approx,
  boardFor,
  fmtNum,
  fmtRange,
  fmtValue,
  frameBox,
  framedPose,
  inAoiRect,
  insideFocus,
  otherFlightNote,
  parseOutlines,
  parsePlacesFile,
  placeBadges,
  placeTitle,
  unionBox,
} from './placesData';
import type { Board, Discipline, ManifestStats, Municipality, Outlines, Place, PlacesData } from './placesData';
import './places.css';

const PREFS_KEY = 'sle.placesCmp.v1';
const GIANT_ID = 'riesenbaum';
const MEDALS = ['🥇', '🥈', '🥉'];

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
  const aoi = aoiRect(manifest); // metres: manifest.size is in cells

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
  const offFrame = ctx.onFrame(() => {
    layer.syncMap();
    layer.update(ctx.camera, ctx.renderer);
  });

  // ---- DOM skeleton ------------------------------------------------------------------------------
  const chips = el('div', { class: 'sle-cmp-chips', role: 'radiogroup', 'aria-label': 'Disziplin wählen' });
  const desc = el('p', { class: 'sle-cmp-desc sle-small' });
  const note = el('p', { class: 'sle-cmp-note sle-small' });
  const list = el('ol', { class: 'sle-cmp-list' });
  const extra = el('div', { class: 'sle-cmp-extra' });
  const boardView = el('div', { class: 'sle-cmp-board' }, chips, desc, note, list, extra);
  const cardView = el('div', { class: 'sle-cmp-card' });
  cardView.hidden = true;
  const disclaimer = el('p', { class: 'sle-cmp-disclaimer sle-small' });
  const sources = el('details', { class: 'sle-cmp-sources sle-small' });

  // ---- helpers ------------------------------------------------------------------------------------
  const inAoi = (E: number, N: number) => inAoiRect(aoi, E, N);

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
   * the part inside the AOI and say so; nothing inside: no flight, the outline opens on the map.
   */
  const flyToArea = (title: string, rings: Array<Array<[number, number]>>, box: Place['bbox'], label: Place['label'], sharePct: number | null) => {
    const labelIn = label ? inAoi(label[0], label[1]) : box ? inAoi((box[0] + box[2]) / 2, (box[1] + box[3]) / 2) : false;
    if (rings.length && ((sharePct ?? 100) < 50 || !labelIn)) {
      const f = insideFocus(rings, aoi);
      if (!f) {
        services.toast(`${title} liegt außerhalb des 3D-Gebiets – der Umriss steht nur auf der Karte.`, false, 5000);
        layer.showOnMap();
        return;
      }
      const pct = sharePct ?? f.share * 100;
      if (pct < 50) {
        services.toast(`Nur ${fmtNum(Math.round(pct))} % der ${title} liegen im 3D-Gebiet: Flug zu diesem Teil, der ganze Umriss steht auf der Karte.`, false, 5000);
      }
      const fr = frameBox(f.bbox, [f.E, f.N]);
      if (fr) flyFramed(fr.E, fr.N, fr.dist, fr.agl);
      return;
    }
    const fr = frameBox(box, label);
    if (fr) flyFramed(fr.E, fr.N, fr.dist, fr.agl);
  };

  const flyToPlace = (p: Place) => flyToArea(placeTitle(p), outlines.get(p.id) ?? [], p.bbox, p.label, p.aoi_share_pct);
  const flyToGiant = (p: Place) => {
    const t = p.tallest;
    if (!t) return;
    if (!inAoi(t.E, t.N)) {
      services.toast(`Riesenbaum ${p.name_de} liegt außerhalb des 3D-Gebiets – nur auf der Karte.`, false, 4000);
      flyToPlace(p);
      return;
    }
    // Frame the crown top (pin tip), so its pin stays in view also with the steeper phone framing.
    const dist = Math.max(160, t.h * 5);
    flyFramed(t.E, t.N, dist, dist * 0.45, t.h);
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
    const b = el(
      'button',
      { type: 'button', class: 'sle-cmp-row', title: `${placeTitle(p)}: Karte öffnen und hinfliegen` },
      rank ? rankLabel(rank) : el('span', { class: 'sle-cmp-rank dim', text: '–' }),
      el('span', { class: 'sle-cmp-name' }, el('span', { text: placeTitle(p) }), el('span', { class: 'sle-cmp-badges' }, ...badgeEls(p))),
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
    note.hidden = true;
    const board = boardFor(data, d);
    if (!board) {
      list.append(el('li', { class: 'sle-dim', text: 'Kommt bald.' }));
      return;
    }
    if (d.scope === 'municipality') {
      note.hidden = false;
      note.textContent =
        'Gemeinde-Ansicht, keine Rangliste der Gemarkungen: Das Marktstammdatenregister (MaStR) nennt kleine Anlagen unter 30 kW nur pro Gemeinde, ohne Adresse – Kirrberg, Homburg und Bruchhof teilen sich eine Postleitzahl.';
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
  const estimate = (text: string) => el('span', {}, `${text} `, el('span', { class: 'sle-cmp-est', text: 'Schätzung' }));
  const cut = (p: Place, path: string, v: string) =>
    p.suppressed.includes(path) || p.suppressed.some((s) => path.startsWith(`${s}.`)) ? 'nicht veröffentlicht (zu wenige)' : v;

  const cardHead = (title: string, badges: Node[]) => {
    const back = el('button', { type: 'button', class: 'sle-btn sle-cmp-back', text: '← Rangliste' });
    back.addEventListener('click', () => {
      cardView.hidden = true;
      boardView.hidden = false;
      renderBoard();
    });
    const clear = el('button', { type: 'button', class: 'sle-btn sle-cmp-clear', text: 'Auswahl aufheben', title: 'Umriss ausblenden' });
    clear.addEventListener('click', () => {
      select(null);
      cardView.hidden = true;
      boardView.hidden = false;
      renderBoard();
    });
    return [el('div', { class: 'sle-cmp-card-nav' }, back, clear), el('h4', { class: 'sle-cmp-card-title', text: title }), el('div', { class: 'sle-cmp-badges' }, ...badges)];
  };

  const placeCard = (p: Place) => {
    const d = discipline;
    const out: Node[] = cardHead(placeTitle(p), badgeEls(p));
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
      kv('Im 3D-Gebiet', p.aoi_share_pct === null ? '–' : `${fmtNum(p.aoi_share_pct)} % der Fläche`),
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
    out.push(actions);
    if (p.aoi_share_pct !== null && p.aoi_share_pct < 50) {
      out.push(el('p', { class: 'sle-dim sle-small', text: `Nur ${fmtNum(p.aoi_share_pct)} % dieser Gemarkung liegen im 3D-Gebiet; der ganze Umriss steht auf der Karte.` }));
    }
    return out;
  };

  const munCard = (m: Municipality) => {
    const out: Node[] = cardHead(`Gemeinde ${m.name_de}`, [el('span', { class: 'sle-cmp-badge b-mun', text: 'Gemeinde-Ansicht' })]);
    const pv = m.pv;
    out.push(
      el(
        'dl',
        { class: 'sle-cmp-kvs' },
        kv('Einwohner', m.inhabitants === null ? 'keine Daten' : fmtNum(m.inhabitants), 'Zensus 2022, amtliche Gemeindezahl'),
        kv('PV-Anlagen', pv ? fmtNum(pv.systems) : 'keine Daten', 'in Betrieb, Balkonkraftwerke eingeschlossen'),
        kv('davon unter 30 kW', pv ? fmtNum(pv.small_systems) : '–', 'ohne Adresse im Register'),
        kv('Leistung', pv ? `${fmtNum(pv.kwp)} kWp` : '–', 'Bruttoleistung laut Register'),
        kv('je Einwohner', pv ? `${fmtNum(pv.kwp_per_inhabitant)} kWp` : '–'),
        kv('Stand', pv?.as_of ?? '–'),
      ),
      el('p', { class: 'sle-cmp-note sle-small', text: 'MaStR nur pro Gemeinde: kleine Anlagen haben keine Adresse, deshalb gibt es keine PV-Zahl pro Gemarkung.' }),
    );
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
    selection = s;
    if (!data) return;
    if (!s) {
      layer.setOutline([], outlines);
      return;
    }
    layer.setOutline(s.kind === 'place' ? [s.place.id] : s.mun.places, outlines);
    cardView.replaceChildren(...(s.kind === 'place' ? placeCard(s.place) : munCard(s.mun)));
    cardView.hidden = false;
    boardView.hidden = true;
    cardView.scrollIntoView?.({ block: 'nearest' });
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
      sources.replaceChildren(el('summary', { text: 'Quellen und Methode' }), el('p', { text: data.attribution }), el('p', { class: 'sle-dim', text: `Stand der Auswertung: ${data.generated.slice(0, 10)}` }));
      status.remove();
      sec.body.append(boardView, cardView, disclaimer, sources);
      renderChips();
      renderBoard();
      syncGiants();
      if (pendingOpen) openPlace(pendingOpen);
      pendingOpen = null;
    } catch (err) {
      if (abort.signal.aborted) return;
      console.warn('[places] stats not loaded: panel hidden', err);
      sec.root.hidden = true;
    }
  })();

  return () => {
    abort.abort();
    window.removeEventListener(PLACE_OPEN_EVENT, onOpenEvent);
    offFrame();
    layer.dispose();
    sec.root.remove();
  };
}
