/**
 * 🌳 Baum-Steckbrief (plan „Orte im Vergleich“ §4, §8 Phase 0): tap / click a tree in 3D → card.
 *
 * - Picking: CPU ray against the resident instance rows (`TreeLayer.pick`, treePick.ts), checked
 *   against the terrain hit so trees behind a ridge are not picked. Mouse: a click (≤ 5 px, < 600 ms)
 *   on a tree opens the card instead of capturing the mouse; while the mouse is captured (pointer
 *   lock) a click picks the tree under the crosshair. Touch: a tap (≤ 12 px) after the double-tap
 *   window (a double tap still zooms). Far forest (crown < ≈ 2.5 px) is never picked, so a click
 *   there still captures the mouse. Off while Markieren / Messen own taps and inside zones.
 * - Card (German): type (Nadel- / Laubbaum by tree-group-v1: a „wahrscheinlich“ species class beats the DOP
 *   colour type; „Baum“ when an unsure class and the colour disagree), height, crown, trunk / biomass / CO₂ as ranges labelled „Schätzung“
 *   (crown-allometry-v2, treeFacts.ts), species from the DLR grid `species` („wahrscheinlich Buche
 *   (70 %)“, species-dlr-neighbourhood-v1) and the height-based age class (tree-age-height-v2, both
 *   treeSpecies.ts), historic forest from `forest_hist` (estimate wording of the contract), Gemarkung
 *   by point in `stats/places.geojson` with a link to its „Orte im Vergleich“ card, Riesenbaum /
 *   Riese note, tree id. No parcel or owner data (G3).
 * - Opening a card dispatches `TREE_CARD_OPEN_EVENT` (`{ id, E, N }`): the places panel counts a
 *   Riese as discovered (local collecting, places/collect.ts).
 * - The selected tree gets a small pin above its crown (Labels3D, same exaggeration rule).
 */
import { Raycaster, Vector2 } from 'three';
import { el } from '../shell/dom';
import { clearOf } from '../shell/layout';
import type { FeatureHost } from '../shell/types';
import { isTyping } from '../ui/keys';
import { PLACE_OPEN_EVENT, TREE_CARD_OPEN_EVENT, parseOutlines, parsePlacesFile, placeTitle } from '../places/placesData';
import type { Outlines, PlacesData } from '../places/placesData';
import {
  fmtDbh,
  fmtMassRange,
  forestPixel,
  forestSummary,
  placeIdAt,
  treeAllometry,
  treeFromRow,
  treeTypeLabel,
  validForestValues,
} from './treeFacts';
import type { ManifestForestHist, PickedTree } from './treeFacts';
import { ageGroup, speciesAt, speciesPixel, speciesWording, treeAge, treeGroup } from './treeSpecies';
import type { ManifestSpecies } from './treeSpecies';
import type { TreeLayer } from './TreeLayer';
import type { Manifest } from '../data/manifest';
import type { ManifestStats } from '../places/placesData';
import './treeCard.css';

const SEL_GROUP = 'tree-card';
const SEL_ID = 'tree-card:sel';
const PICK_MAX_M = 1500;
const DOUBLE_TAP_MS = 300;

/** German names of the yield tables (tree-age-height-v2). */
const TABLE_DE: Record<string, string> = { beech: 'Buche', oak: 'Eiche', spruce: 'Fichte', pine: 'Kiefer', douglas: 'Douglasie' };

interface ForestMask {
  fh: ManifestForestHist;
  values: Uint8Array;
}

async function fetchJson(url: string): Promise<unknown | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const text = await res.text();
  return text.trimStart().startsWith('{') ? (JSON.parse(text) as unknown) : null; // Vite answers 404s with index.html
}

/** Decode an 8-bit greyscale data PNG (contract: no colour management) into one value per pixel. */
async function loadU8Png(url: string, size: { width: number; height: number }): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  if (!blob.type.startsWith('image/')) throw new Error(`not an image (${blob.type})`);
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const { width, height } = size;
  if (bmp.width !== width || bmp.height !== height) throw new Error(`size ${bmp.width}×${bmp.height} ≠ ${width}×${height}`);
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
  const g = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!g) throw new Error('no 2D context');
  g.drawImage(bmp, 0, 0);
  bmp.close();
  const rgba = g.getImageData(0, 0, width, height).data;
  const values = new Uint8Array(width * height);
  for (let i = 0; i < values.length; i++) values[i] = rgba[4 * i];
  return values;
}

/** The forest mask; null on any mismatch (the card then shows no historic forest). */
async function loadForestMask(baseUrl: string, fh: ManifestForestHist): Promise<ForestMask | null> {
  try {
    const values = await loadU8Png(baseUrl + fh.path, fh.size);
    if (!validForestValues(values, fh.nodata)) throw new Error('values outside 0–15 / nodata');
    return { fh, values };
  } catch (err) {
    console.warn('[trees] forest_hist not loaded (card shows no historic forest):', err instanceof Error ? err.message : err);
    return null;
  }
}

interface SpeciesGrid {
  sp: ManifestSpecies;
  values: Uint8Array;
}

/** The DLR species grid; null on a 404 / decode error / size mismatch (contract tolerance: no species row). */
async function loadSpeciesGrid(baseUrl: string, sp: ManifestSpecies): Promise<SpeciesGrid | null> {
  try {
    return { sp, values: await loadU8Png(baseUrl + sp.path, sp.size) };
  } catch (err) {
    console.warn('[trees] species not loaded (card shows no species):', err instanceof Error ? err.message : err);
    return null;
  }
}

export interface TreeCardApi {
  /** Open the card for the tree under a screen point (verification hook); false if none. */
  pickAt(clientX: number, clientY: number): boolean;
  close(): void;
  readonly open: boolean;
}

declare global {
  interface Window {
    sleTreeCard?: TreeCardApi;
  }
}

/**
 * One pickable tree layer with its data context: single-AOI = the AOI (offset 0); catalog mode = a
 * place (its v3 manifest, base URL and the offset of its Group from the session origin).
 */
export interface TreeCardSource {
  layer: TreeLayer;
  manifest: Manifest;
  baseUrl: string;
  /** World position of the layer's parent (place Group), x / z in the session frame. */
  offset: { x: number; z: number };
}

/** Where the Gemarkung row comes from (stats-only manifest key + its base URL). */
export interface TreeCardStats {
  meta: ManifestStats;
  baseUrl: string;
  /** Row label (default „Gemarkung“; catalog mode: „Gemeinde“). */
  rowLabel?: string;
}

/** Single-AOI: the AOI's one tree layer and its own `stats`. */
export function mountTreeCard(h: FeatureHost, layer: TreeLayer): () => void {
  const { manifest, terrain } = h.ctx;
  const src: TreeCardSource[] = [{ layer, manifest, baseUrl: terrain.baseUrl, offset: { x: 0, z: 0 } }];
  return mountTreeCardFor(h, () => src, manifest.stats ? { meta: manifest.stats, baseUrl: terrain.baseUrl } : null);
}

type CardCtx = { places: { data: PlacesData; outlines: Outlines } | null; forest: ForestMask | null; species: SpeciesGrid | null };

/** Baum-Steckbrief over any number of tree layers (catalog mode: one per place). */
export function mountTreeCardFor(h: FeatureHost, sources: () => readonly TreeCardSource[], stats: TreeCardStats | null): () => void {
  const { ctx, services } = h;
  const { terrain, camera, renderer } = ctx;
  const canvas = renderer.domElement;
  const app = document.getElementById('app');
  const rowLabel = stats?.rowLabel ?? 'Gemarkung';

  // ---- lazily loaded context data -------------------------------------------------------------------
  let placesP: Promise<{ data: PlacesData; outlines: Outlines } | null> | null = null;
  const places = () =>
    (placesP ??= (async () => {
      const st = stats?.meta;
      if (!st) return null;
      try {
        const data = parsePlacesFile(await fetchJson(stats!.baseUrl + st.url));
        if (!data) return null;
        const outlines = st.geometry ? parseOutlines(await fetchJson(stats!.baseUrl + st.geometry)) : new Map();
        return { data, outlines };
      } catch (err) {
        console.warn('[trees] places not loaded (card shows no Gemarkung):', err);
        return null;
      }
    })());
  /** Per source (base URL): forest mask + species grid, loaded once. */
  const perSource = new Map<string, { forest: Promise<ForestMask | null>; species: Promise<SpeciesGrid | null>; loaded: CardCtx | null }>();
  const sourceData = (s: TreeCardSource) => {
    let d = perSource.get(s.baseUrl);
    if (!d) {
      const m = s.manifest;
      d = {
        forest: m.forest_hist ? loadForestMask(s.baseUrl, m.forest_hist) : Promise.resolve(null),
        species: m.species ? loadSpeciesGrid(s.baseUrl, m.species) : Promise.resolve(null),
        loaded: null,
      };
      perSource.set(s.baseUrl, d);
    }
    return d;
  };

  // ---- card -------------------------------------------------------------------------------------------
  const card = el('section', { class: 'sle-tree-card', role: 'dialog', 'aria-label': 'Baum-Steckbrief' });
  card.hidden = true;
  h.overlay.append(card);
  const corner = h.shell.anchor('sources')?.parentElement ?? null;
  /**
   * Desktop: the card sits at the side away from the picked tree (right by default, left when the
   * tree is on the right and no drawer is open on the left, else centred); phones: bottom sheet (CSS).
   */
  let pickX = NaN;
  const side = () => {
    const w = window.innerWidth;
    const cardW = 360 + 40;
    let s: 'right' | 'left' | 'center' = 'right';
    if (Number.isFinite(pickX) && pickX > w - cardW) {
      const drawerOpen = [...document.querySelectorAll<HTMLElement>('.sle-drawer')].some((d) => !d.hidden);
      s = drawerOpen ? 'center' : 'left';
    }
    card.dataset.side = s;
  };
  const place = () => {
    side();
    card.style.bottom = card.style.maxHeight = '';
    if (card.hidden) return;
    const r = corner ? clearOf(card.getBoundingClientRect(), corner.getBoundingClientRect(), window.innerHeight) : null;
    if (r) {
      card.style.bottom = `${r.bottom}px`;
      card.style.maxHeight = `${r.maxHeight}px`;
    }
    // Keep the minimap and the system buttons (top right) uncovered: the card scrolls instead.
    const c = card.getBoundingClientRect();
    let top = 8;
    for (const sel of ['#minimap', '.sle-sys']) {
      const b = document.querySelector(sel)?.getBoundingClientRect();
      if (b && b.width && b.left < c.right && c.left < b.right && b.bottom < c.bottom) top = Math.max(top, b.bottom + 8);
    }
    if (c.top < top) card.style.maxHeight = `${Math.max(120, c.bottom - top)}px`;
  };
  const watch = corner ? new MutationObserver(() => place()) : null;
  watch?.observe(corner as HTMLElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', place);

  let current: PickedTree | null = null;
  let curSrc: TreeCardSource | null = null;
  let renderSeq = 0;

  const close = () => {
    current = null;
    curSrc = null;
    renderSeq++;
    card.hidden = true;
    card.replaceChildren();
    services.labels.remove(SEL_ID);
    place();
  };

  const est = () => el('span', { class: 'sle-tree-est', text: 'Schätzung' });
  const row = (label: string, value: Node | string, hint?: string, ...extra: Array<Node | string>) =>
    el('div', { class: 'sle-tree-kv' }, el('dt', { text: label, title: hint }), el('dd', {}, value, ...extra));

  const render = (t: PickedTree, source: TreeCardSource, ctxData: CardCtx | null) => {
    const { manifest } = source;
    const origin = manifest.origin;
    const aoiFrame = { E0: origin.E0, N0: origin.N0, heightM: manifest.size.height * manifest.cellSize };
    // Species first: the tree group (title, wood density) follows a „wahrscheinlich“ class, not the DOP colour
    // type alone, which reads most conifers as broadleaf (tree-group-v1, review 2026-11-08).
    const sg = ctxData?.species ?? null;
    const ts = sg ? speciesAt(sg.sp, sg.values, aoiFrame, t.E, t.N, t.kind) : null;
    const speciesPending = !!manifest.species && !ctxData;
    const group = speciesPending ? 0 : treeGroup(ts, t.kind);
    const groupFromSpecies = !!ts && ts.likely;
    const a = treeAllometry(t.h, t.r, group === 1);
    const xBtn = el('button', { type: 'button', class: 'sle-tree-x', 'aria-label': 'Steckbrief schließen', title: 'Schließen (Esc)', text: '×' });
    xBtn.addEventListener('click', close);
    const chips = el('div', { class: 'sle-tree-chips' });
    if (t.fill) chips.append(el('span', { class: 'sle-tree-chip fill', text: 'geschätzte Position', title: 'Zusammengewachsene Nadelbaumkronen wurden rechnerisch aufgeteilt: kein Beleg für genau diesen Einzelbaum' }));
    const out: Node[] = [
      el(
        'header',
        {},
        el('h2', {
          text: `${group === 1 ? '🌲' : '🌳'} ${treeTypeLabel(group)}`,
          title: groupFromSpecies ? 'Nach der Baumart-Karte (Schätzung)' : group ? 'Nach der Luftbildfarbe – oft unsicher' : 'Nadel- oder Laubbaum: unsicher',
        }),
        xBtn,
      ),
      chips,
    ];
    // Gemarkung + Riesenbaum
    const pd = ctxData?.places ?? null;
    const placeId = pd ? placeIdAt(pd.outlines, t.E, t.N) : null;
    const pl = placeId ? (pd!.data.places.find((p) => p.id === placeId) ?? null) : null;
    const giantOf = pd?.data.places.find((p) => p.tallest && p.tallest.id === t.id) ?? null;
    const rieseOf = giantOf ? null : (pd?.data.places.find((p) => p.riesen.some((r) => r.id === t.id)) ?? null);
    if (giantOf) {
      chips.append(el('span', { class: 'sle-tree-chip giant', text: '🏆 Riesenbaum' }));
      out.push(el('p', { class: 'sle-tree-giant', text: `Riesenbaum der ${placeTitle(giantOf)}: der höchste geprüfte Baum dieser Gemarkung (LiDAR-Höhe, nicht vor Ort gemessen).` }));
    } else if (rieseOf) {
      const r = rieseOf.riesen.find((x) => x.id === t.id)!;
      chips.append(el('span', { class: 'sle-tree-chip giant', text: `🌲 Riese Nr. ${r.rank}` }));
      out.push(el('p', { class: 'sle-tree-giant', text: `Einer der ${rieseOf.riesen.length} Riesen der ${placeTitle(rieseOf)} (Platz ${r.rank}, LiDAR-Höhe, nicht vor Ort gemessen).` }));
    }
    // Opening the card counts the Riese as discovered (places panel, only on this device).
    if (giantOf || rieseOf) out.push(el('p', { class: 'sle-tree-note', text: '✓ Bei „Riesen entdeckt“ gezählt (nur auf diesem Gerät).' }));
    if (!chips.childElementCount) chips.remove();

    const dl = el('dl', { class: 'sle-tree-kvs' });
    dl.append(
      row('Höhe', `${t.h.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m ± 0,5 m`, 'Kronenspitze über Gelände aus dem LiDAR-Kronenhöhenmodell, nicht vor Ort gemessen'),
      row('Kronendurchmesser', `${(2 * t.r).toLocaleString('de-DE', { maximumFractionDigits: 1 })} m`, 'Aus der erkannten Krone (Kronenhöhenmodell)'),
      row('Stammdurchmesser', fmtDbh(a.dbhCm), 'Aus Höhe × Kronendurchmesser geschätzt: D ≈ 0,557 · (H · Krone)^0,809', ' ', est()),
      row('Biomasse', fmtMassRange(a.agbKg), 'Oberirdische Trockenmasse, grob (Faktor 2 nach unten und oben)', ' ', est()),
      row('CO₂', fmtMassRange(a.co2Kg), 'CO₂-Äquivalent ≈ 1,8 × Biomasse', ' ', est()),
    );
    // Species (DLR grid) and the height-based age (both estimates, G7)
    let speciesSrc: string | null = null;
    let speciesKey: string | null = null;
    let inForestMap: boolean | null = null; // null: no species layer → unknown whether the tree stands in forest
    if (manifest.species) {
      if (!ctxData) dl.append(row('Baumart', el('span', { class: 'sle-dim', text: 'lädt …' })));
      else if (sg) {
        const year = sg.sp.year ? ` ${sg.sp.year}` : '';
        const at = speciesPixel(sg.sp, aoiFrame, t.E, t.N);
        const raw = at ? sg.values[at.py * sg.sp.size.width + at.px] : sg.sp.nodata;
        inForestMap = raw !== sg.sp.nodata && sg.sp.classes.has(raw);
        if (ts) {
          speciesKey = ts.key;
          const sub: string[] = [`Satellitenkarte${year}, 10-m-Raster: Bestand um den Baum, nicht dieser eine Baum`];
          if (ts.contra) sub.push('die Kronenfarbe wirkt eher wie ein Nadelbaum');
          if (ts.key === 'alder' || ts.key === 'other_broadleaf') sub.push('diese Klasse ist hier oft unsicher');
          dl.append(
            row(
              'Baumart',
              el('span', { text: speciesWording(ts.label_de, ts.pct, ts.likely) }),
              `${sg.sp.label_de}: Anteil gleicher Zellen im 3 × 3-Umfeld × Klassengüte (F1), höchstens 90 %`,
              ' ',
              est(),
              el('span', { class: 'sle-tree-sub' }, sub.join(' · ')),
            ),
          );
        } else {
          const cls = sg.sp.classes.get(raw);
          const why = cls && !cls.species ? `Waldkarte${year}: Kronendachverlust` : 'außerhalb der Waldkarte';
          dl.append(row('Baumart', el('span', { class: 'sle-dim', text: `keine Angabe (${why})` }), 'Die Satellitenkarte kennt nur Waldflächen; Gärten, Straßen und Einzelbäume im Ort haben keine Art'));
        }
        speciesSrc = `Baumart: ${sg.sp.attribution || 'DLR, Tree Species Germany, CC BY 4.0'}.${sg.sp.accuracyNote ? ` ${sg.sp.accuracyNote}.` : ''} Wahrscheinlichkeit: Umfeld × Klassengüte, keine geeichte Wahrscheinlichkeit.`;
      }
    }
    const age = treeAge(t.h, ageGroup(speciesKey, t.kind));
    if (age && (ctxData || !manifest.species)) {
      const tables = age.tables.map((x) => TABLE_DE[x] ?? x).join(', ');
      const tip = 'tree-age-height-v2: Höhe − 2 m, abgelesen an Ertragstafeln (Bonität I–III); nur eine grobe Klasse, keine Jahreszahl';
      if (age.beyond) {
        // Taller than the yield table reaches: no age (the table's last age would only be a clamp).
        const sub = [`der Baum ist höher, als die Ertragstafel (${tables}) reicht – sehr guter Standort oder sehr alt, aus der Höhe allein nicht zu trennen`];
        dl.append(row('Alter', el('span', { class: 'sle-dim', text: age.label_de }), tip, el('span', { class: 'sle-tree-sub' }, sub.join(' · '))));
      } else {
        const sub = [`aus der Baumhöhe geschätzt (Ertragstafel ${tables})`];
        if (inForestMap !== true) sub.push('gilt für Waldbäume; frei stehende Bäume sind meist älter');
        dl.append(row('Alter', el('span', { text: age.label_de }), tip, ' ', est(), el('span', { class: 'sle-tree-sub' }, sub.join(' · '))));
      }
    }
    // Historic forest
    const fm = ctxData?.forest ?? null;
    let forestSrc: string | null = null;
    if (manifest.forest_hist) {
      if (!ctxData) dl.append(row('Historischer Wald', el('span', { class: 'sle-dim', text: 'lädt …' })));
      else if (fm) {
        const idx = forestPixel(fm.fh, { E0: origin.E0, N0: origin.N0, heightM: manifest.size.height * manifest.cellSize }, t.E, t.N);
        const s = forestSummary(idx >= 0 ? fm.values[idx] : null, fm.fh);
        if (s) {
          const box = el('span', { class: 'sle-tree-forest' }, el('span', { text: s.headline }), s.forest ? ' ' : null, s.forest ? est() : null);
          const why = fm.fh.epochs.filter((e) => !e.classified && e.note_de).map((e) => `${e.label_de}: ${e.note_de}`);
          const sub = el('span', { class: 'sle-tree-sub', title: why.join('\n') || undefined }, s.lines.join(' · '));
          dl.append(row('Historischer Wald', box, `${fm.fh.label_de}: aus Kartensignaturen erkannt, keine Aussage zum Grundstück`, sub));
          if (s.maps.length) forestSrc = `Historische Karte: ${s.maps.join(', ')}${fm.fh.attribution ? ` · ${fm.fh.attribution}` : ''}`;
        }
      }
    }
    // Gemarkung
    if (stats) {
      if (!ctxData) dl.append(row(rowLabel, el('span', { class: 'sle-dim', text: 'lädt …' })));
      else if (pl) {
        const link = el('button', { type: 'button', class: 'sle-tree-link', text: 'Orte im Vergleich ›', title: `${placeTitle(pl)} in „Orte im Vergleich“ öffnen` });
        link.addEventListener('click', () => {
          window.dispatchEvent(new CustomEvent(PLACE_OPEN_EVENT, { detail: { id: pl.id } }));
          if (window.innerWidth <= 600) close(); // phones: the place card opens in the bottom sheet
        });
        dl.append(row(rowLabel, el('span', { text: placeTitle(pl) }), 'Umriss vereinfacht (10 m)', el('br'), link));
      } else if (pd) {
        dl.append(row(rowLabel, el('span', { class: 'sle-dim', text: 'nicht im Vergleich' }), 'Keine der verglichenen Gemarkungen'));
      }
    }
    dl.append(row('Baum-Nr.', String(t.id), 'Aus der Lage der Kronenspitze (1-m-Zelle); kann sich bei einer neuen Befliegung ändern'));
    out.push(dl);
    const notes = [
      'Höhe und Krone aus LiDAR (Kronenhöhenmodell), nicht vor Ort gemessen. Nadel- oder Laubbaum aus der Baumart-Karte, wenn sie die Art für wahrscheinlich hält, sonst aus der Luftbildfarbe (oft unsicher); widersprechen sich beide, steht nur „Baum“.',
      'Stamm, Biomasse und CO₂ grob aus Höhe und Krone geschätzt (Holzdichte nach Nadel- oder Laubbaum).',
    ];
    if (t.fill) out.push(el('p', { class: 'sle-tree-note warn', text: 'Position geschätzt: zusammengewachsene Nadelbaumkronen wurden rechnerisch aufgeteilt – nicht als Beleg für genau diesen Baum verwenden.' }));
    const src = el('details', { class: 'sle-tree-src' }, el('summary', { text: 'Quellen und Methode' }), el('p', { text: notes.join(' ') }));
    src.addEventListener('toggle', () => place());
    if (speciesSrc) src.append(el('p', { text: speciesSrc }));
    if (age) src.append(el('p', { text: 'Alter: Höhe − 2 m an Ertragstafeln abgelesen (Schober 1967, Jüttner 1955, Wiedemann 1936/42 und 1943, Bergel 1985; gerundete Werte), Spanne über die Bonitäten I–III. Höher als die Tafel (Bonität II) reicht: kein Alter.' }));
    if (forestSrc) src.append(el('p', { text: forestSrc }));
    out.push(src);
    card.replaceChildren(...out);
  };

  const openTree = (t: PickedTree, source: TreeCardSource, screenX = NaN) => {
    current = t;
    curSrc = source;
    pickX = screenX;
    const seq = ++renderSeq;
    const sd = sourceData(source);
    render(t, source, sd.loaded); // context data already in from an earlier card: no „lädt …“ flash
    card.hidden = false;
    card.scrollTop = 0;
    place();
    const pin = el('div', { class: 'sle-tree-sel', 'aria-hidden': 'true' }, el('span', { text: '▼' }));
    services.labels.set(SEL_ID, SEL_GROUP, t.E, t.N, pin, { lift: t.h + 0.5, maxDistance: 3000 });
    window.dispatchEvent(new CustomEvent(TREE_CARD_OPEN_EVENT, { detail: { id: t.id, E: t.E, N: t.N } }));
    if (sd.loaded) return;
    void Promise.all([places(), sd.forest, sd.species]).then(([p, f, sg]) => {
      sd.loaded = { places: p, forest: f, species: sg };
      if (seq !== renderSeq || current !== t) return;
      render(t, source, sd.loaded);
      place();
    });
  };

  // ---- picking ------------------------------------------------------------------------------------------
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const pickTree = (clientX: number, clientY: number, slackPx: number): { tree: PickedTree; source: TreeCardSource } | null => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const ray = raycaster.ray;
    const mPerPx = (2 * Math.tan(((camera as { fov?: number }).fov ?? 60) * (Math.PI / 360))) / r.height;
    // Nearest hit over all visible layers; each layer is picked in its own (place-local) frame.
    let best: { hit: NonNullable<ReturnType<TreeLayer['pick']>>; source: TreeCardSource } | null = null;
    for (const source of sources()) {
      if (!source.layer.visible) continue;
      const hit = source.layer.pick(
        { ox: ray.origin.x - source.offset.x, oy: ray.origin.y, oz: ray.origin.z - source.offset.z, dx: ray.direction.x, dy: ray.direction.y, dz: ray.direction.z },
        { slackPerM: slackPx * mPerPx, minApparent: 2.5 / slackPx, maxDistance: PICK_MAX_M },
      );
      if (hit && (!best || hit.t < best.hit.t)) best = { hit, source };
    }
    if (!best) return null;
    const { hit, source } = best;
    const ground = terrain.intersectRay(ray, hit.t + 50);
    if (ground && ground.distanceTo(ray.origin) < hit.t - 3) return null; // behind a ridge / the ground
    return { tree: treeFromRow(hit.rows, hit.index, source.manifest.origin), source };
  };

  const blocked = () =>
    !sources().some((x) => x.layer.visible) ||
    !!app?.classList.contains('marker-mode') ||
    !!app?.classList.contains('measure-mode') ||
    !!app?.classList.contains('sle-zone-active');

  let down: { id: number; x: number; y: number; t: number; touch: boolean } | null = null;
  let tapTimer: ReturnType<typeof setTimeout> | undefined;
  const onDown = (e: PointerEvent) => {
    down = null;
    if (e.target !== canvas || e.button !== 0 || blocked()) return;
    if (tapTimer !== undefined) {
      clearTimeout(tapTimer); // second tap of a double tap: zoom, no card
      tapTimer = undefined;
      return;
    }
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), touch: e.pointerType === 'touch' };
  };
  const onUp = (e: PointerEvent) => {
    const d = down;
    down = null;
    if (!d || e.pointerId !== d.id || e.button !== 0) return;
    const locked = document.pointerLockElement === canvas;
    if (!locked) {
      const tol = d.touch ? 12 : 5;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > tol || performance.now() - d.t > 600) return;
    }
    const r = canvas.getBoundingClientRect();
    const x = locked ? r.left + r.width / 2 : e.clientX; // captured mouse: the crosshair
    const y = locked ? r.top + r.height / 2 : e.clientY;
    if (d.touch) {
      // Wait out the double-tap window (TouchController zooms on a double tap).
      tapTimer = setTimeout(() => {
        tapTimer = undefined;
        const t = pickTree(x, y, 14);
        if (t) openTree(t.tree, t.source, x);
        else if (current) close();
      }, DOUBLE_TAP_MS);
      return;
    }
    const t = pickTree(x, y, 6);
    if (!t) {
      if (current && !locked) close(); // a click elsewhere closes the card (and captures the mouse as before)
      return;
    }
    if (!locked) {
      const opts = ctx.controller.opts;
      const lock = opts.lockOnClick;
      opts.lockOnClick = false; // the controller's own pointerup runs next: no pointer lock for this click
      setTimeout(() => (opts.lockOnClick = lock), 0);
    }
    openTree(t.tree, t.source, x);
  };
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointerup', onUp, true);

  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Escape' || card.hidden || isTyping(e.target)) return;
    close();
  };
  window.addEventListener('keydown', onKey);
  const offFrame = ctx.onFrame(() => {
    // „Bäume“ off, Relikt-Blick or relief-lab canopy on, or (catalog mode) the place was dropped
    if (current && (!curSrc || !curSrc.layer.visible || !sources().includes(curSrc))) close();
  });

  const api: TreeCardApi = {
    pickAt(x, y) {
      const t = pickTree(x, y, 6);
      if (t) openTree(t.tree, t.source, x);
      return !!t;
    },
    close,
    get open() {
      return !card.hidden;
    },
  };
  window.sleTreeCard = api;

  return () => {
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', place);
    if (tapTimer !== undefined) clearTimeout(tapTimer);
    offFrame();
    watch?.disconnect();
    close();
    card.remove();
    if (window.sleTreeCard === api) delete window.sleTreeCard;
  };
}
