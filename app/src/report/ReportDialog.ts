/**
 * F18 "Meldung erstellen": dialog for ONE marker → optional fly to an oblique view → 3D snapshot +
 * relief map snippets + coordinates + Flurstück + sources + heritage note → a single self-contained
 * HTML file offered as a download (Blob + a[download]). Nothing is ever sent anywhere.
 */
import type { XyzSource } from '../data/manifest';
import { utmToWgs84 } from '../geo';
import type { AppContext } from '../main';
import { isImageXyz, xyzOverlay } from '../map/overlays';
import type { Marker } from '../markers/markerStore';
import { PARCEL_ATTRIBUTION, lookupParcelLocal, lookupParcelWfs } from '../markers/parcel';
import { flyToSiteExag } from '../candidates/flyToSite';
import { terrainPending } from '../ui/streaming';
import { attributionLines, escapeHtml, formatDistance, reportFileName } from './format';
import { renderMapSnippet } from './mapSnippet';
import { captureView } from './snapshot';
import { buildReportHtml } from './template';
import type { ReportData, ReportImage, ReportView3D } from './template';
import './report.css';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, sleep(ms).then(() => fallback)]);
}

/** Wait until no terrain chunks are pending (or `maxMs`); polls with timers, not rAF. */
async function waitForTerrain(ctx: AppContext, maxMs: number): Promise<void> {
  const t0 = performance.now();
  let calm = 0;
  while (performance.now() - t0 < maxMs) {
    await sleep(150);
    const p = terrainPending(ctx.terrain);
    calm = p === 0 || p === null ? calm + 1 : 0;
    if (calm >= 2) return;
  }
}

/** Relief XYZ entries first (VAT preferred), historic maps after. */
export function reportMapSources(ctx: AppContext): Array<{ key: string; name: string; src: XyzSource }> {
  const xyz = ctx.manifest.xyz ?? {};
  return Object.entries(xyz)
    .map(([key, src]) => ({ key, src, name: xyzOverlay(key, src, ctx.manifest.layers, ctx.manifest.imageLayers).name, image: isImageXyz(key, src) }))
    .sort((a, b) => Number(a.image) - Number(b.image) || Number(b.key === 'vat') - Number(a.key === 'vat'))
    .map(({ key, name, src }) => ({ key, name, src }));
}

export interface BuildOptions {
  flyFirst: boolean;
  mapKey: string | null;
  /** Opt-in: if no stored/local parcel, ask the public ALKIS WFS (sends only a 1 m bbox). */
  parcelOnline?: boolean;
  onStatus?: (msg: string) => void;
}

export interface BuiltReport {
  html: string;
  fileName: string;
  data: ReportData;
}

/** Collect everything for one marker and return the report HTML (no download). */
export async function buildMarkerReport(ctx: AppContext, marker: Marker, opts: BuildOptions): Promise<BuiltReport> {
  const status = opts.onStatus ?? (() => {});
  const { manifest } = ctx;
  const notices: string[] = [];

  if (opts.flyFirst) {
    status('Fliege zum Marker …');
    const ok = await flyToSiteExag(ctx, marker.E, marker.N, 160, 70, marker.h);
    if (!ok) notices.push('Der Anflug wurde unterbrochen; die 3D-Ansicht zeigt den Blick zum Zeitpunkt der Erstellung.');
  }
  status('Warte auf Geländedetails …');
  await waitForTerrain(ctx, 6000);

  status('3D-Ansicht wird aufgenommen …');
  const shot = captureView(ctx, marker.E, marker.N, marker.h, { label: marker.title });
  const s = ctx.store.get();
  const exag = ctx.terrain.uniforms.uExag.value;
  const details = [
    `Blickrichtung ${Math.round(((s.heading % 360) + 360) % 360)}° (Gitternord), Neigung ${Math.round(s.pitch)}°, Entfernung zum Marker ca. ${formatDistance(Math.round(shot.distance))}`,
    `Darstellung: ${ctx.terrain.labelFor(s.layer)}${exag !== 1 ? ` · Höhen ${String(exag).replace('.', ',')}-fach überhöht` : ' · nicht überhöht'}`,
  ];
  if (!shot.markerInView) details.push('Der Marker liegt außerhalb dieses Bildausschnitts.');
  else if (shot.markerOccluded) details.push('Der Marker ist aus diesem Blickwinkel durch Gelände verdeckt (gestrichelt).');
  const view3d: ReportView3D = {
    image: shot.image,
    caption: `3D-Ansicht aus dem Geländemodell (DGM1) mit Marker „${marker.title}“`,
    details,
  };

  const { lat, lon } = utmToWgs84(marker.E, marker.N);
  const maps: ReportImage[] = [];
  const sourceKey = opts.mapKey;
  const mapSrc = reportMapSources(ctx).find((x) => x.key === sourceKey);
  if (mapSrc) {
    status('Kartenausschnitt wird erstellt …');
    const detailZ = Math.min(mapSrc.src.maxZoom, 18);
    const overviewZ = Math.max(mapSrc.src.minZoom, detailZ - 3);
    for (const [z, label] of [
      [detailZ, 'Detail'],
      [overviewZ, 'Übersicht'],
    ] as const) {
      if (label === 'Übersicht' && z === detailZ) continue;
      const snip = await renderMapSnippet(ctx.terrain.baseUrl, mapSrc.src, lat, lon, { zoom: z, width: 720, height: 560 });
      if (snip.tilesDrawn === 0) {
        notices.push(`${label}: keine Kartenkacheln für diese Stelle vorhanden.`);
        continue;
      }
      maps.push({
        image: snip.image,
        caption: `${label}: ${mapSrc.name} (Zoom ${snip.zoom}, ca. ${String(Math.round(snip.metersPerPixel * 100) / 100).replace('.', ',')} m/Pixel), Norden oben, Marker in der Mitte`,
      });
      if (snip.tilesMissing) notices.push(`${label}: ${snip.tilesMissing} Kartenkachel(n) fehlen (Rand des Datengebiets).`);
    }
  } else notices.push('Kein Kartenausschnitt: für dieses Gebiet sind keine Kartenkacheln vorhanden.');

  status('Flurstück wird ermittelt …');
  let parcel: string | null = marker.parcel ?? null;
  let parcelSource = parcel ? 'ALKIS, beim Setzen des Markers abgefragt' : '';
  if (!parcel) {
    parcel = await withTimeout(lookupParcelLocal(marker.E, marker.N), 15000, null);
    if (parcel) parcelSource = 'ALKIS (lokale Flurstücksdaten)';
  }
  if (!parcel && opts.parcelOnline) {
    parcel = await lookupParcelWfs(marker.E, marker.N, 20000);
    if (parcel) parcelSource = 'ALKIS-WFS Saarland, bei Erstellung abgefragt';
  }

  const sources = attributionLines(
    manifest.attribution,
    parcel ? PARCEL_ATTRIBUTION.replace(/^Flurstücke:\s*/, '') + ' (Flurstücke)' : '',
    mapSrc?.src.attribution,
  );
  sources.push(
    'Reliefdarstellungen und 3D-Ansicht: eigene Berechnung aus dem Geländemodell (Saar LiDAR Explorer); keine Online-Kartendienste im Bericht.',
    'Lizenz dl-de/by-2-0: https://www.govdata.de/dl-de/by-2-0 · ODbL: https://opendatacommons.org/licenses/odbl/',
  );

  const generated = new Date();
  const data: ReportData = {
    marker: { id: marker.id, title: marker.title, note: marker.note, category: marker.category, created: marker.created, E: marker.E, N: marker.N, h: marker.h },
    lat,
    lon,
    generated: generated.toISOString(),
    aoiName: manifest.name,
    parcel,
    ...(parcelSource ? { parcelSource } : {}),
    view3d,
    maps,
    sources,
    notices,
  };
  return { html: buildReportHtml(data), fileName: reportFileName(marker.title, generated), data };
}

export function downloadHtml(html: string, fileName: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

let open: HTMLElement | null = null;

/** Modal: options + "HTML herunterladen". */
export function openReportDialog(ctx: AppContext, marker: Marker): void {
  open?.remove();
  const sources = reportMapSources(ctx);
  const wrap = document.createElement('div');
  wrap.id = 'sle-report';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-labelledby', 'sle-report-title');
  wrap.innerHTML = `
    <form class="sle-modal sle-report-modal">
      <h2 id="sle-report-title">Meldung erstellen</h2>
      <p>Erstellt eine einzelne HTML-Datei (druckbar, 1–2 A4-Seiten) für den Marker <b data-k="title"></b>:
      3D-Ansicht, Kartenausschnitt, Koordinaten, Flurstück, Notiz, Datenquellen und Hinweise.
      Andere Marker und Kandidaten sind nicht enthalten.</p>
      <label><input type="checkbox" name="fly" checked> Vorher zum Marker fliegen (Schrägansicht)</label>
      ${marker.parcel ? '' : '<label><input type="checkbox" name="parcelOnline"> Flurstück online nachschlagen, falls lokal nicht gefunden (ALKIS-WFS Saarland; übermittelt nur die Koordinate)</label>'}
      <label class="sle-report-row">Karte <select name="map" class="sle-input">${
        sources.length
          ? sources.map((x) => `<option value="${escapeHtml(x.key)}">${escapeHtml(x.name)}</option>`).join('') + '<option value="">ohne Karte</option>'
          : '<option value="">keine Kartenkacheln vorhanden</option>'
      }</select></label>
      <p class="sle-dim sle-small">Die Datei wird nur heruntergeladen – nichts wird versendet. Ob und an wen du sie weitergibst
      (z. B. an das Landesdenkmalamt Saarland), entscheidest du. Genaue Lagen bitte nicht veröffentlichen.</p>
      ${marker.note.length > 1000 ? '<p class="sle-dim sle-small">Lange Notiz: der Ausdruck kann eine dritte Seite brauchen.</p>' : ''}
      <p class="sle-report-status" aria-live="polite"></p>
      <div class="sle-actions">
        <span class="sle-spacer"></span>
        <button type="button" data-act="cancel">Abbrechen</button>
        <button type="submit" class="primary">HTML herunterladen</button>
      </div>
    </form>`;
  wrap.querySelector('[data-k=title]')!.textContent = `„${marker.title}“`;
  const form = wrap.querySelector('form')!;
  const statusEl = wrap.querySelector<HTMLElement>('.sle-report-status')!;
  const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  let busy = false;
  const close = () => {
    if (busy) return;
    wrap.remove();
    if (open === wrap) open = null;
  };
  form.addEventListener('keydown', (e) => {
    e.stopPropagation(); // keep app shortcuts out of the dialog
    if (e.key === 'Escape') close();
  });
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close();
  });
  form.querySelector('[data-act=cancel]')!.addEventListener('click', close);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    submit.disabled = true;
    const flyFirst = (form.elements.namedItem('fly') as HTMLInputElement).checked;
    const mapKey = (form.elements.namedItem('map') as HTMLSelectElement).value || null;
    const parcelOnline = !!(form.elements.namedItem('parcelOnline') as HTMLInputElement | null)?.checked;
    // Fly-to needs the 3D view unobstructed; the dialog shrinks to a status line meanwhile.
    wrap.classList.add('working');
    void buildMarkerReport(ctx, marker, { flyFirst, mapKey, parcelOnline, onStatus: (m) => (statusEl.textContent = m) })
      .then((r) => {
        downloadHtml(r.html, r.fileName);
        statusEl.textContent = `Gespeichert: ${r.fileName} (${Math.round(r.html.length / 1024)} KB).`;
        busy = false;
        setTimeout(close, 1800);
      })
      .catch((err: unknown) => {
        console.error('[report]', err);
        statusEl.textContent = `Fehler: ${err instanceof Error ? err.message : String(err)}`;
        busy = false;
        submit.disabled = false;
        wrap.classList.remove('working');
      });
  });
  document.body.appendChild(wrap);
  open = wrap;
  submit.focus();
}
