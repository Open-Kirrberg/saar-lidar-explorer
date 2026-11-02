/**
 * F21 "3D-Druck" planner: panel card (series selector, tile table with heights, filament, preview
 * and downloads, totals, connector keys), the global print grid on the minimap (AOI cells + one
 * ring of extension cells, generated tiles highlighted and labelled; a click on a generated tile
 * selects it and flies there, on a missing one shows the `print3d.py` command with a copy button)
 * and the selected tile's outline draped on the terrain.
 *
 * Data: `<printRoot><series>/index.json` (contract "3D print tiles", sle-print3d-v1; root =
 * `VITE_PRINT_URL` or `<dataRoot>print/`, see data/urls.ts), not part of any manifest. Absent / invalid → no card at all. Strings from the files are untrusted
 * (textContent only); file links are validated relative paths. No keyboard shortcuts.
 */
import L from 'leaflet';
import type { Scene } from 'three';
import { flyToSiteExag } from '../candidates/flyToSite';
import { printRootUrl } from '../data/urls';
import { utmToWgs84 } from '../geo';
import type { AppContext } from '../main';
import { bboxRing } from '../map/aois';
import type { Minimap } from '../map/Minimap';
import { copyText } from '../ui/clipboard';
import { createPanelSection, openPanelSection } from '../ui/panelSection';
import type { PanelSection } from '../ui/panelSection';
import {
  DEFAULT_PRINT_PREFS,
  KNOWN_PRINT_SERIES,
  PRINT_PREFS_KEY,
  PRINT_SERIES_LIST,
  bboxOverlap,
  displayCells,
  formatGrams,
  formatNum,
  formatScale,
  cellCommand,
  parsePrintIndex,
  parsePrintPrefs,
  parseSeriesList,
  printTotals,
  setKeys,
  tileDatum,
  tileLabel,
} from './printData';
import type { Bbox, DisplayCell, PrintIndex, PrintPrefs, PrintTile } from './printData';
import { PrintOutline } from './PrintOutline';
import './print.css';

declare global {
  interface Window {
    slePrint?: PrintApi;
  }
}

export interface PrintApi {
  /** Loaded series (key → index). */
  series: Map<string, PrintIndex>;
  readonly current: PrintIndex;
  setSeries(key: string): boolean;
  /** Select a cell by id (generated or not); `fly` = also fly there. */
  select(id: string | null, fly?: boolean): void;
  readonly selected: string | null;
  /** Cells currently drawn on the minimap. */
  cells(): DisplayCell[];
  outline: PrintOutline;
  /** Minimap grid layer (debug/verification handle; on the map only while shown). */
  mapLayer: L.LayerGroup;
}

const FEATURES_EVENT = 'sle:features';

function readPrefs(): PrintPrefs {
  try {
    return parsePrintPrefs(JSON.parse(localStorage.getItem(PRINT_PREFS_KEY) ?? '{}'));
  } catch {
    return { ...DEFAULT_PRINT_PREFS };
  }
}

function writePrefs(p: PrintPrefs): void {
  try {
    localStorage.setItem(PRINT_PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/** JSON or null (404, HTML fallback page, network error). */
async function fetchJsonOrNull(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

/** Series list file, else the known keys; every index that validates. */
export async function loadPrintSeries(root = printRootUrl()): Promise<Map<string, PrintIndex>> {
  const listed = parseSeriesList(await fetchJsonOrNull(`${root}${PRINT_SERIES_LIST}`));
  const keys = listed.length ? listed : [...KNOWN_PRINT_SERIES];
  const out = new Map<string, PrintIndex>();
  const results = await Promise.all(
    keys.map(async (k) => {
      const raw = await fetchJsonOrNull(`${root}${encodeURIComponent(k)}/index.json`);
      if (raw === null) return null;
      try {
        const r = parsePrintIndex(raw);
        for (const w of r.warnings) console.warn(`[print] ${w}`);
        if (r.value.series.key !== k) console.warn(`[print] ${k}/index.json declares series ${r.value.series.key}`);
        return [k, r.value] as const;
      } catch (err) {
        console.warn(`[print] ${k}/index.json invalid: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    }),
  );
  for (const r of results) if (r) out.set(r[0], r[1]);
  return out;
}

export interface PrintDeps {
  minimap?: Minimap;
}

/**
 * Adds a hidden card right away (stable panel order), then loads the series; resolves to null
 * (card removed) when no series is available.
 */
export async function initPrint(ctx: AppContext, panel: HTMLElement, deps: PrintDeps = {}): Promise<PrintApi | null> {
  const sec = createPanelSection(panel, 'print', '3D-Druck', false);
  sec.root.hidden = true;
  const root = printRootUrl();
  const series = await loadPrintSeries(root);
  if (!series.size) {
    console.info('[print] no 3D print series found – card absent');
    sec.root.remove();
    return null;
  }
  const api = setup(ctx, series, root, sec, deps);
  window.slePrint = api;
  window.dispatchEvent(new Event(FEATURES_EVENT));
  return api;
}

const ll = (E: number, N: number): L.LatLngTuple => {
  const p = utmToWgs84(E, N);
  return [p.lat, p.lon];
};

function setup(ctx: AppContext, series: Map<string, PrintIndex>, root: string, sec: PanelSection, deps: PrintDeps): PrintApi {
  const { scene, camera, renderer, terrain, manifest } = ctx;
  const origin = manifest.origin;
  const aoi: Bbox = [origin.E0, origin.N0, origin.E0 + manifest.size.width * manifest.cellSize, origin.N0 + manifest.size.height * manifest.cellSize];
  const prefs = readPrefs();
  let current: PrintIndex = series.get(prefs.series ?? '') ?? series.values().next().value!;
  let cells: DisplayCell[] = [];
  let selected: string | null = null;

  const outline = new PrintOutline(terrain, origin, aoi);
  scene.add(outline);
  const prevHook = scene.onBeforeRender.bind(scene);
  (scene as Scene).onBeforeRender = (...args: Parameters<Scene['onBeforeRender']>) => {
    prevHook(...args);
    if (args[2] === camera) outline.update(camera, renderer);
  };

  // ---- panel ----------------------------------------------------------------------------------
  sec.body.innerHTML = `
    <p class="sle-print-warn" data-k="disclaimer"></p>
    <div class="sle-row">
      <label for="sle-print-series">Serie</label>
      <select id="sle-print-series" data-k="series"></select>
    </div>
    <p class="sle-dim sle-small" data-k="spec"></p>
    <div class="sle-row">
      <label title="Globales Druckraster in der Übersichtskarte (solange diese Karte offen ist)"><input type="checkbox" data-k="grid"> Raster in der Karte</label>
      <label title="Umriss der gewählten Kachel auf dem 3D-Gelände"><input type="checkbox" data-k="outline"> Umriss in 3D</label>
    </div>
    <p class="sle-print-totals" data-k="totals" aria-live="polite"></p>
    <div class="sle-print-tablewrap"><table class="sle-print-table">
      <thead><tr><th scope="col"><span class="sle-sr">Vorschau</span></th><th scope="col">Kachel</th><th scope="col" title="Modellhöhe über der Druckplatte">Höhe mm</th><th scope="col" title="geschätztes Filament (mit den empfohlenen Slicer-Einstellungen, falls angegeben; ±10 %)">≈ g</th><th scope="col">Datei</th></tr></thead>
      <tbody data-k="rows"></tbody>
    </table></div>
    <div class="sle-print-detail" data-k="detail" hidden></div>
    <div class="sle-print-files" data-k="files"></div>
    <p class="sle-small sle-print-slicer" data-k="slicer" hidden></p>
    <p class="sle-dim sle-small" data-k="printer"></p>
    <p class="sle-dim sle-small" data-k="attr"></p>`;
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => sec.body.querySelector<T>(sel)!;
  const sel = q<HTMLSelectElement>('[data-k=series]');
  const cbGrid = q<HTMLInputElement>('[data-k=grid]');
  const cbOutline = q<HTMLInputElement>('[data-k=outline]');
  const rows = q('[data-k=rows]');
  const detail = q('[data-k=detail]');
  for (const [k, ix] of series) {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = `${ix.series.name_de} (${formatScale(ix.series.scale)}, ${ix.tiles.length} Kachel${ix.tiles.length === 1 ? '' : 'n'})`;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => setSeries(sel.value));
  cbGrid.addEventListener('change', () => {
    prefs.grid = cbGrid.checked;
    writePrefs(prefs);
    syncMapLayer();
  });
  cbOutline.addEventListener('change', () => {
    prefs.outline = cbOutline.checked;
    writePrefs(prefs);
    outline.visible = prefs.outline;
  });
  sec.root.hidden = false;

  const fileUrl = (name: string) => `${root}${encodeURIComponent(current.series.key)}/${name.split('/').map(encodeURIComponent).join('/')}`;
  const link = (name: string, label: string, title: string, download = true) => {
    const a = document.createElement('a');
    a.href = fileUrl(name);
    a.textContent = label;
    a.title = title;
    if (download) a.setAttribute('download', name.split('/').pop()!);
    else {
      a.target = '_blank';
      a.rel = 'noopener';
    }
    a.addEventListener('click', (e) => e.stopPropagation());
    return a;
  };

  // ---- minimap ----------------------------------------------------------------------------------
  const mapLayer = L.layerGroup();
  const polys = new Map<string, L.Polygon>();
  const styleOf = (c: DisplayCell): L.PathOptions => {
    const on = c.id === selected;
    if (c.tile) return { color: on ? '#ff5a00' : '#ff9f1a', opacity: 1, weight: on ? 4 : 2, fillColor: '#ffb347', fillOpacity: on ? 0.35 : 0.14, dashArray: undefined };
    if (c.sets.length) return { color: '#e0a100', opacity: 1, weight: on ? 3 : 1.4, fillColor: '#ffd27a', fillOpacity: on ? 0.2 : 0.04, dashArray: '6 4' };
    // Missing cells: dark dashed lines read over OSM, OpenTopoMap and the relief overlays alike.
    return { color: on ? '#1f6feb' : '#2c3640', opacity: on ? 1 : 0.75, weight: on ? 3 : 1.2, fillColor: on ? '#1f6feb' : '#ffffff', fillOpacity: on ? 0.15 : 0.02, dashArray: on ? undefined : '4 4' };
  };

  function buildMapLayer(): void {
    mapLayer.clearLayers();
    polys.clear();
    for (const c of cells) {
      // Densified UTM ring, not L.rectangle: the grid square is rotated ≈ 1.2° against lat/lon.
      const ring = bboxRing(c.bbox, 8).map(([E, N]) => ll(E, N));
      const p = L.polygon(ring, { ...styleOf(c), bubblingMouseEvents: false });
      if (c.tile) {
        p.on('click', () => select(c.id, true));
      } else {
        p.bindTooltip(`${c.id} – noch nicht erzeugt${c.sets.length ? ` (Set ${c.sets.join(', ')})` : ''}`, { sticky: true });
        p.on('click', (e: L.LeafletMouseEvent) => {
          select(c.id, false);
          L.popup({ className: 'sle-print-popup', maxWidth: 300, autoPan: true }).setLatLng(e.latlng).setContent(commandBox(c.id)).openOn(deps.minimap!.map);
        });
      }
      polys.set(c.id, p);
      mapLayer.addLayer(p);
    }
    labelKeys.clear();
    syncLabels();
  }

  /** On-screen width (px) of one tile square at the minimap's current zoom (0 without a map). */
  function tilePx(): number {
    const map = deps.minimap?.map;
    const c = cells[0];
    if (!map || !c) return 0;
    const a = map.project(ll(c.bbox[0], c.bbox[1]));
    const b = map.project(ll(c.bbox[2], c.bbox[1]));
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  /**
   * Generated tiles: permanent labels sized to the tile on screen (full id → stacked grid numbers →
   * none, one style per series, see `tileLabelMode`); without a permanent label the id is a hover tooltip. Re-run on zoomend.
   */
  const labelKeys = new Map<string, string>();
  function syncLabels(): void {
    const px = tilePx();
    const ids = cells.filter((c) => c.tile).map((c) => c.id);
    for (const c of cells) {
      const p = polys.get(c.id);
      if (!c.tile || !p) continue;
      const lab = tileLabel(c.id, px, ids);
      const key = `${lab.mode}:${lab.lines.join('/')}`;
      if (labelKeys.get(c.id) === key) continue;
      labelKeys.set(c.id, key);
      p.unbindTooltip();
      if (lab.mode === 'none') {
        p.bindTooltip(c.id, { sticky: true, className: 'sle-print-hover' });
        continue;
      }
      const el = document.createElement('span');
      lab.lines.forEach((t, i) => {
        if (i) el.appendChild(document.createElement('br'));
        el.appendChild(document.createTextNode(t));
      });
      p.bindTooltip(el, { permanent: true, direction: 'center', className: `sle-print-label sle-print-label-${lab.mode}`, interactive: false });
    }
  }
  deps.minimap?.map.on('zoomend', syncLabels);

  function restyle(): void {
    for (const c of cells) {
      const p = polys.get(c.id);
      if (!p) continue;
      p.setStyle(styleOf(c));
      if (c.id === selected) p.bringToFront();
    }
  }

  const cardOpen = () => sec.root.classList.contains('open');
  function syncMapLayer(): void {
    const mm = deps.minimap;
    if (!mm) return;
    const show = prefs.grid && cardOpen();
    if (show && !mm.map.hasLayer(mapLayer)) mapLayer.addTo(mm.map);
    else if (!show && mm.map.hasLayer(mapLayer)) {
      mm.map.closePopup();
      mapLayer.remove();
    }
  }
  new MutationObserver(syncMapLayer).observe(sec.root, { attributes: true, attributeFilter: ['class'] });

  /** Command + copy button for a missing tile (popup and panel detail). */
  function commandBox(id: string): HTMLElement {
    const box = document.createElement('div');
    box.className = 'sle-print-cmd';
    const t = document.createElement('div');
    t.innerHTML = '<strong></strong> ist noch nicht erzeugt. Im Ordner <code>pipeline/</code> ausführen:';
    t.querySelector('strong')!.textContent = id;
    const code = document.createElement('code');
    code.className = 'sle-print-code';
    const { cmd, note_de } = cellCommand(current, id);
    code.textContent = cmd;
    const row = document.createElement('div');
    row.className = 'sle-row';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sle-btn';
    btn.textContent = 'Befehl kopieren';
    const st = document.createElement('span');
    st.className = 'sle-dim';
    st.setAttribute('role', 'status');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      btn.disabled = true;
      void copyText(cmd).then((ok) => {
        btn.disabled = false;
        st.textContent = ok ? 'kopiert ✓' : 'Kopieren nicht möglich – bitte markieren';
        if (!ok) {
          const r = document.createRange();
          r.selectNodeContents(code);
          const s = window.getSelection();
          s?.removeAllRanges();
          s?.addRange(r);
        }
      });
    });
    row.append(btn, st);
    box.append(t, code, row);
    if (note_de) {
      const n = document.createElement('div');
      n.className = 'sle-dim';
      n.textContent = note_de;
      box.appendChild(n);
    }
    return box;
  }

  // ---- rendering ----------------------------------------------------------------------------------
  function renderSeries(): void {
    const s = current.series;
    sel.value = s.key;
    q('[data-k=disclaimer]').textContent = current.disclaimer_de;
    q('[data-k=spec]').textContent =
      `${formatScale(s.scale)} · Kachel ${formatNum(s.tile_mm, s.tile_mm % 1 ? 1 : 0)} mm = ${formatNum(s.tile_m / 1000, s.tile_m % 1000 ? 1 : 0)} km · ` +
      `${formatNum(s.exag, s.exag % 1 ? 1 : 0)}× überhöht · ` +
      (s.datumMode === 'set' || s.datum_m === null ? `Bezugshöhe je Set + ${formatNum(s.base_mm, 0)} mm` : `Basis ${formatNum(s.datum_m, 0)} m NHN + ${formatNum(s.base_mm, 0)} mm`);
    const tt = printTotals(s, current.tiles);
    const totals = q('[data-k=totals]');
    const mat = current.filament?.material ?? 'PLA';
    totals.textContent = tt.tiles
      ? `${tt.tiles} Kachel${tt.tiles === 1 ? '' : 'n'} · ` +
        (tt.gramsRecommended !== null
          ? `≈ ${formatGrams(tt.gramsRecommended)} Filament (${mat}, empfohlene Einstellungen; Standardprozess ≈ ${formatGrams(tt.gramsTypical)}; ±10 %) · `
          : `≈ ${formatGrams(tt.gramsTypical)} Filament (${mat}, typisch ±10 %) · `) +
        `zusammengesetzt ${formatNum(tt.widthCm)} × ${formatNum(tt.heightCm)} cm${tt.blocks > 1 ? ` (umschließendes Rechteck, ${tt.blocks} Teile)` : ''}` +
        (tt.datums.length > 1 ? ` · ${tt.datums.length} Bezugshöhen (${tt.datums.map((d) => formatNum(d, 0)).join(', ')} m) – passen nur innerhalb gleicher Höhe zusammen` : '') +
        (s.connectors.enabled ? ` · ${tt.keys} Verbinder` : '')
      : 'Noch keine Kachel erzeugt – ein Feld in der Karte anklicken, um den Befehl zu sehen.';
    totals.title = tt.tiles ? `massiv gedruckt ≈ ${formatGrams(tt.gramsSolid)}; höchste Kachel ${formatNum(tt.maxZmm)} mm` : '';
    sec.setCount(tt.tiles ? `${tt.tiles}` : '');

    rows.replaceChildren();
    for (const t of current.tiles) rows.appendChild(tileRow(t));
    if (!current.tiles.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="5" class="sle-dim">keine Kacheln</td>';
      rows.appendChild(tr);
    }

    const files = q('[data-k=files]');
    files.replaceChildren();
    const add = (el: HTMLElement | string) => {
      const p = document.createElement('p');
      p.className = 'sle-small';
      p.append(el);
      files.appendChild(p);
      return p;
    };
    if (s.connectors.enabled && s.connectors.key) {
      const p = add(link(s.connectors.key, 'Verbinder-Schlüssel (.stl)', 'Schwalbenschwanz-Schlüssel („Bowtie“), verbindet zwei Kacheln an der Unterseite'));
      const all = setKeys(current);
      p.append(` · ${tt.keys} Stück für die erzeugten Kacheln${Object.keys(current.sets).length && all !== tt.keys ? `, ${all} für alle Sets komplett` : ''}`);
    }
    if (current.printerProfile?.file) {
      const p = add(link(current.printerProfile.file, 'Druckerprofil (Bambu Studio)', current.printerProfile.note_de ?? ''));
      if (current.printerProfile.name) p.append(` · „${current.printerProfile.name}“`);
    }
    if (current.layout) add(link(current.layout, 'Übersicht (layout.png)', 'Alle Kacheln der Serie, nach Norden ausgerichtet', false));
    const sets = Object.entries(current.sets);
    if (sets.length) {
      const have = new Set(current.tiles.map((t) => t.id));
      add(
        `Sets: ${sets
          .map(([name, ids]) => `${name} ${ids.filter((i) => have.has(i)).length}/${ids.length}${current.setDatum_m[name] !== undefined ? ` (${formatNum(current.setDatum_m[name], 0)} m)` : ''}`)
          .join(' · ')}`,
      ).classList.add('sle-dim');
    }
    const slicer = q('[data-k=slicer]');
    slicer.textContent = current.slicer?.note_de ?? '';
    slicer.hidden = !current.slicer;
    q('[data-k=printer]').textContent = [current.printer ? `Drucker: ${current.printer}.` : '', current.printerProfile?.note_de ?? ''].filter(Boolean).join(' ');
    q('[data-k=attr]').textContent = current.attribution ? `Quellen: ${current.attribution.split(';').map((x) => x.trim()).filter(Boolean).join(' · ')}` : '';

    cells = displayCells(current, aoi, 1);
    buildMapLayer();
    syncMapLayer();
    renderDetail();
  }

  function tileRow(t: PrintTile): HTMLTableRowElement {
    const tr = document.createElement('tr');
    tr.dataset.id = t.id;
    tr.tabIndex = 0;
    tr.title = 'Auswählen und hinfliegen';
    const tdImg = document.createElement('td');
    if (t.files.png) {
      const img = document.createElement('img');
      img.src = fileUrl(t.files.png);
      img.alt = `Reliefvorschau ${t.id}`;
      img.loading = 'lazy';
      img.width = 36;
      img.height = 36;
      const a = link(t.files.png, '', 'Vorschau groß öffnen', false);
      a.appendChild(img);
      tdImg.appendChild(a);
    }
    const tdId = document.createElement('td');
    tdId.innerHTML = '<span class="sle-print-id"></span><br><span class="sle-dim"></span>';
    tdId.querySelector('.sle-print-id')!.textContent = t.id;
    tdId.querySelector('.sle-dim')!.textContent = formatScale(current.series.scale);
    const tdZ = document.createElement('td');
    tdZ.className = 'num';
    tdZ.textContent = `${formatNum(t.z_mm.min)}–${formatNum(t.z_mm.max)}`;
    if (t.h_m) tdZ.title = `Gelände ${formatNum(t.h_m.min)}–${formatNum(t.h_m.max)} m NHN`;
    const tdG = document.createElement('td');
    tdG.className = 'num';
    tdG.textContent = Math.round(t.filament_g.recommended ?? t.filament_g.typical).toLocaleString('de-DE');
    tdG.title = filamentText(t);
    const tdF = document.createElement('td');
    tdF.className = 'sle-print-dl';
    const pl = current.printerProfile?.placement_mm;
    tdF.appendChild(link(t.files['3mf'], '.3mf', `${t.id}.3mf – Bambu Studio${pl ? ` (einfach öffnen: Bambu Studio legt die Kachel in die Plattenmitte, X ${formatNum(pl[0])}–${formatNum(pl[0] + current.series.tile_mm)} mm)` : ''}`));
    if (t.files.stl) tdF.appendChild(link(t.files.stl, '.stl', `${t.id}.stl`));
    tr.append(tdImg, tdId, tdZ, tdG, tdF);
    tr.addEventListener('click', () => select(t.id, true));
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select(t.id, true);
      }
    });
    return tr;
  }

  function filamentText(t: PrintTile): string {
    const f = t.filament_g;
    return f.recommended !== undefined
      ? `≈ ${formatGrams(f.recommended)} mit empfohlenen Einstellungen (Standardprozess ≈ ${formatGrams(f.typical)}, massiv ${formatGrams(f.solid)})`
      : `≈ ${formatGrams(f.typical)} (massiv ${formatGrams(f.solid)})`;
  }

  function renderDetail(): void {
    for (const tr of rows.querySelectorAll<HTMLElement>('tr[data-id]')) tr.classList.toggle('on', tr.dataset.id === selected);
    const c = cells.find((x) => x.id === selected) ?? null;
    detail.replaceChildren();
    detail.hidden = !c;
    if (!c) return;
    if (c.tile) {
      const t = c.tile;
      const p = document.createElement('p');
      p.className = 'sle-small';
      p.textContent =
        `${t.id}: Modell ${formatNum(t.z_mm.min)}–${formatNum(t.z_mm.max)} mm hoch` +
        (t.h_m ? `, Gelände ${formatNum(t.h_m.min, 0)}–${formatNum(t.h_m.max, 0)} m NHN` : '') +
        (tileDatum(current.series, t) !== null ? `, Bezugshöhe ${formatNum(tileDatum(current.series, t)!, 0)} m` : '') +
        `, ${filamentText(t)}` +
        (t.clampedVertices ? `, ${t.clampedVertices} Punkte unter der Basis angehoben` : '') +
        (t.watertight === false ? ' – Achtung: Netz nicht geschlossen' : '');
      detail.appendChild(p);
    } else {
      detail.appendChild(commandBox(c.id));
    }
    if (!bboxOverlap(c.bbox, aoi)) {
      const p = document.createElement('p');
      p.className = 'sle-dim sle-small';
      p.textContent = 'Liegt außerhalb des geladenen Gebiets – in 3D nicht sichtbar.';
      detail.appendChild(p);
    }
  }

  // ---- actions -----------------------------------------------------------------------------------
  function select(id: string | null, fly = false): void {
    const c = id ? (cells.find((x) => x.id === id) ?? null) : null;
    selected = c ? c.id : null;
    restyle();
    renderDetail();
    outline.setTile(c ? c.bbox : null);
    outline.visible = prefs.outline;
    if (c) {
      openPanelSection(sec);
      rows.querySelector<HTMLElement>(`tr[data-id="${CSS.escape(c.id)}"]`)?.scrollIntoView({ block: 'nearest' });
    }
    if (c && fly) flyToCell(c);
  }

  function flyToCell(c: DisplayCell): void {
    const inside = bboxOverlap(c.bbox, aoi);
    if (!inside) {
      deps.minimap?.map.panTo(ll((c.bbox[0] + c.bbox[2]) / 2, (c.bbox[1] + c.bbox[3]) / 2));
      return;
    }
    // Centre of the part inside the AOI, oblique overview of the whole tile.
    const E = (inside[0] + inside[2]) / 2;
    const N = (inside[1] + inside[3]) / 2;
    const span = current.series.tile_m;
    void flyToSiteExag(ctx, E, N, span * 0.95, span * 0.75, c.tile?.h_m?.mean ?? null);
  }

  function setSeries(key: string): boolean {
    const ix = series.get(key);
    if (!ix) return false;
    current = ix;
    prefs.series = key;
    writePrefs(prefs);
    deps.minimap?.map.closePopup();
    selected = null;
    outline.setTile(null);
    renderSeries();
    return true;
  }

  cbGrid.checked = prefs.grid;
  cbOutline.checked = prefs.outline;
  outline.visible = prefs.outline;
  renderSeries();

  return {
    series,
    get current() {
      return current;
    },
    setSeries,
    select,
    get selected() {
      return selected;
    },
    cells: () => cells,
    outline,
    mapLayer,
  };
}
