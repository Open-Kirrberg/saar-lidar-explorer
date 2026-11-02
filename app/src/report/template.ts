/**
 * F18 report HTML (pure): one self-contained, printable HTML document for ONE marker — inline CSS,
 * images only as data: URLs, no scripts, a CSP that blocks every network load. Every user- or
 * data-provided string goes through escapeHtml. Unit-tested in app/tests/report.test.ts.
 */
import {
  escapeHtml,
  escapeMultiline,
  formatDateDe,
  formatDms,
  formatHeight,
  formatLatLonPlain,
  formatUtm,
  formatWgs84Decimal,
  isInlineImage,
  parseParcelLabel,
} from './format';

export interface ReportMarker {
  id: string;
  title: string;
  note: string;
  category: string;
  /** ISO 8601. */
  created: string;
  E: number;
  N: number;
  h: number | null;
}

export interface ReportImage {
  /** data:image/(png|jpeg|webp);base64,… — anything else is dropped. */
  image: string;
  caption: string;
}

export interface ReportView3D extends ReportImage {
  /** Lines describing the view (direction, exaggeration, display mode …). */
  details: string[];
}

export interface ReportData {
  marker: ReportMarker;
  lat: number;
  lon: number;
  /** ISO timestamp of report creation. */
  generated: string;
  aoiName: string;
  parcel: string | null;
  /** Where the parcel came from, e.g. "ALKIS (lokale Daten)". */
  parcelSource?: string;
  view3d: ReportView3D | null;
  maps: ReportImage[];
  /** Data sources + licences (one per line). */
  sources: string[];
  /** Optional notes about what is missing (e.g. "Kein Kartenausschnitt verfügbar"). */
  notices?: string[];
  /** Time zone for dates (tests); default = the browser's. */
  timeZone?: string;
}

export const REPORT_TITLE = 'Hinweis auf eine mögliche Geländestruktur';
export const LDA_SAARLAND = 'Landesdenkmalamt Saarland';
export const LDA_WEB = 'www.saarland.de/lda';
/** Bodendenkmalpflege page of the LDA as cited in research/03 (§ Legal notes); no address/phone is on file. */
export const LDA_BODEN_WEB = 'www.saarland.de/lda/DE/themen-aufgaben/Bodendenkmalpflege';

/**
 * "Zuständige Stelle" lines — only what research/03 states (no invented postal address / phone):
 * the LDA Saarland with its Bodendenkmalpflege page, and the GDKE for parcels in Rheinland-Pfalz.
 */
export const AUTHORITY_LINES_DE: readonly string[] = [
  `${LDA_SAARLAND}, Bodendenkmalpflege – ${LDA_BODEN_WEB} (Meldepflicht für Funde nach § 16 SDschG).`,
  'Für Stellen in Rheinland-Pfalz: GDKE Rheinland-Pfalz (DSchG RLP).',
  'Postanschrift, Telefon und E-Mail bitte auf der Website der Behörde nachsehen – sie sind in dieser Anwendung nicht hinterlegt.',
];

/** Heritage note, wording from research/03 §Legal notes (SDschG Saarland 2018). No digging guidance. */
export const DISCLAIMER_DE = [
  '<strong>Schauen, nicht graben.</strong> Die beschriebene Struktur ist eine <em>Hypothese</em> aus Geländedaten ' +
    '(Laserscanning-Geländemodell) und kann natürlichen oder neuzeitlichen Ursprungs sein.',
  'Bodendenkmäler sind im Saarland gesetzlich geschützt (SDschG §§ 3, 8) – auch unbekannte. Gezielte Suche mit ' +
    'Sonden/Werkzeugen ist genehmigungspflichtig (§ 8); Funde sind unverzüglich dem Landesdenkmalamt Saarland zu melden (§ 16). ' +
    'In Rheinland-Pfalz gilt das DSchG RLP (GDKE).',
  '<strong>Kampfmittelgefahr an Bunkern/Kratern – nichts berühren.</strong>',
  'Genaue Lageangaben bitte nur an die zuständige Fachbehörde weitergeben und nicht veröffentlichen.',
];

const CSS = `
:root{--ink:#1d2124;--dim:#5b646b;--line:#c9cfd3;--accent:#8a3b12;--bg:#fff}
*{box-sizing:border-box}
html{background:#e9ecee}
body{margin:0 auto;max-width:210mm;background:var(--bg);color:var(--ink);font:10.5pt/1.4 "Helvetica Neue",Arial,sans-serif;padding:12mm 14mm}
h1{font-size:16pt;margin:0 0 1mm}
h2{font-size:11.5pt;margin:5mm 0 2mm;padding-bottom:1mm;border-bottom:1px solid var(--line)}
.sub{color:var(--dim);margin:0 0 4mm}
.head{display:flex;justify-content:space-between;gap:6mm;align-items:flex-start;border-bottom:2px solid var(--ink);padding-bottom:3mm;margin-bottom:3mm}
.head .to{font-size:9.5pt;text-align:right;color:var(--dim);white-space:nowrap}
.head .to b{color:var(--ink)}
table.kv{border-collapse:collapse;width:100%}
table.kv th{text-align:left;font-weight:600;color:var(--dim);width:36%;padding:1.2mm 3mm 1.2mm 0;vertical-align:top;font-size:9.5pt}
table.kv td{padding:1.2mm 0;vertical-align:top}
table.kv tr+tr th,table.kv tr+tr td{border-top:1px solid #eef0f2}
.mono{font-family:"SF Mono",Menlo,Consolas,monospace;font-size:9.5pt}
.note{white-space:normal;border-left:3px solid var(--line);padding:1mm 0 1mm 3mm;margin:1mm 0}
.empty{color:var(--dim);font-style:italic}
figure{margin:2mm 0;break-inside:avoid;page-break-inside:avoid}
figure img{display:block;width:100%;height:auto;border:1px solid var(--line)}
figcaption{font-size:8.5pt;color:var(--dim);margin-top:1mm}
.maps{display:grid;grid-template-columns:1fr 1fr;gap:4mm}
.maps.one{grid-template-columns:1fr}
.view-details{font-size:8.5pt;color:var(--dim);margin:0;padding-left:4mm}
.disclaimer{border:1.5px solid var(--accent);border-radius:2mm;padding:2.5mm 3.5mm;margin-top:4mm;font-size:9.5pt;break-inside:avoid;page-break-inside:avoid}
.disclaimer p{margin:0 0 1.5mm}
.disclaimer p:last-child{margin:0}
.sources{font-size:8.5pt;color:var(--dim);margin:0;padding-left:4mm}
.notice{font-size:9pt;color:var(--accent)}
.fill{display:grid;grid-template-columns:auto 1fr;gap:2mm 3mm;font-size:9.5pt;margin-top:2mm}
.fill span:nth-child(even){border-bottom:1px solid var(--line);min-height:6mm}
.foot{margin-top:4mm;font-size:8pt;color:var(--dim);border-top:1px solid var(--line);padding-top:2mm}
.small{font-size:8.5pt;color:var(--dim)}
@page{size:A4;margin:12mm 13mm}
@media print{
  html{background:none}
  body{max-width:none;padding:0;font-size:9.5pt}
  h1{font-size:14pt}
  h2{margin:3mm 0 1.5mm}
  table.kv th,table.kv td{padding-top:.7mm;padding-bottom:.7mm}
  figure.view img{max-height:92mm;width:auto;max-width:100%;margin:0 auto}
  .maps figure img{max-height:64mm;width:auto;max-width:100%;margin:0 auto}
  .disclaimer{font-size:8.5pt;padding:2mm 3mm;margin-top:2mm}
  .sources{font-size:7.5pt}
  .fill{margin-top:1.5mm}
  body.compact figure.view img{max-height:62mm}
  body.compact .maps figure img{max-height:46mm}
  body.compact .sources{columns:2;column-gap:6mm}
}
@media screen and (max-width:700px){body{padding:5mm}.maps{grid-template-columns:1fr}.head{flex-direction:column}.head .to{text-align:left}}
`;

function row(label: string, valueHtml: string): string {
  return `<tr><th>${escapeHtml(label)}</th><td>${valueHtml}</td></tr>`;
}

function figure(img: ReportImage, cls: string, extra = ''): string {
  if (!isInlineImage(img.image)) return '';
  return `<figure class="${cls}"><img src="${img.image}" alt="${escapeHtml(img.caption)}"><figcaption>${escapeHtml(img.caption)}</figcaption>${extra}</figure>`;
}

/** Build the complete report document. Contains exactly one marker: `data.marker`. */
export function buildReportHtml(data: ReportData): string {
  const m = data.marker;
  const tz = data.timeZone;
  const utm = formatUtm(m.E, m.N);
  const parcel = parseParcelLabel(data.parcel);
  let parcelRows = row('Flurstück', '<span class="empty">nicht ermittelt</span>');
  if (parcel) {
    const parts = [
      parcel.gemarkung ? `Gemarkung <b>${escapeHtml(parcel.gemarkung)}</b>` : '',
      parcel.flur ? `Flur <b>${escapeHtml(parcel.flur)}</b>` : '',
      parcel.flurstueck ? `Flurstück <b>${escapeHtml(parcel.flurstueck)}</b>` : '',
    ].filter(Boolean);
    const main = parts.length ? parts.join(' · ') : escapeHtml(parcel.raw);
    const extra = [parcel.lage ? `Lage: ${escapeHtml(parcel.lage)}` : '', data.parcelSource ? `Quelle: ${escapeHtml(data.parcelSource)}` : '']
      .filter(Boolean)
      .join(' · ');
    parcelRows = row('Flurstück (Gemarkung / Flur / Nr.)', main + (extra ? `<br><span class="small">${extra}</span>` : ''));
  }

  const view = data.view3d && isInlineImage(data.view3d.image)
    ? figure(
        data.view3d,
        'view',
        data.view3d.details.length ? `<ul class="view-details">${data.view3d.details.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>` : '',
      )
    : '<p class="empty">Keine 3D-Ansicht enthalten.</p>';
  const maps = data.maps.filter((x) => isInlineImage(x.image));
  const mapsHtml = maps.length
    ? `<div class="maps${maps.length === 1 ? ' one' : ''}">${maps.map((x) => figure(x, 'map')).join('')}</div>`
    : '<p class="empty">Kein Kartenausschnitt enthalten.</p>';
  const notices = (data.notices ?? []).map((n) => `<p class="notice">${escapeHtml(n)}</p>`).join('');

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<meta name="generator" content="Saar LiDAR Explorer (lokal)">
<title>${escapeHtml(`${REPORT_TITLE}: ${m.title}`)}</title>
<style>${CSS}</style>
</head>
<body${m.note.length > 500 || m.note.split('\n').length > 8 ? ' class="compact"' : ''}>
<header class="head">
  <div>
    <h1>${escapeHtml(REPORT_TITLE)}</h1>
    <p class="sub">Beobachtung aus Laserscan-Geländedaten (Hypothese) · ${escapeHtml(data.aoiName)}</p>
  </div>
  <div class="to">zur Weitergabe an das<br><b>${escapeHtml(LDA_SAARLAND)}</b><br>${escapeHtml(LDA_WEB)}</div>
</header>

<h2>Beobachtung</h2>
<table class="kv">
${row('Titel', `<strong>${escapeHtml(m.title)}</strong>`)}
${row('Kategorie (eigene Einschätzung)', escapeHtml(m.category))}
${row('Erfasst am', escapeHtml(formatDateDe(m.created, tz)))}
${row('Notiz', m.note.trim() ? `<div class="note">${escapeMultiline(m.note)}</div>` : '<span class="empty">keine</span>')}
</table>

<h2>Lage</h2>
<table class="kv">
${row('UTM (ETRS89 / UTM 32N, EPSG:25832)', `<span class="mono">E ${escapeHtml(utm.E)} · N ${escapeHtml(utm.N)}</span>`)}
${row('WGS84 (dezimal)', `<span class="mono">${escapeHtml(formatWgs84Decimal(data.lat, data.lon))}</span> <span class="small">(${escapeHtml(formatLatLonPlain(data.lat, data.lon))})</span>`)}
${row('WGS84 (Grad, Min., Sek.)', `<span class="mono">${escapeHtml(formatDms(data.lat, 'lat'))}, ${escapeHtml(formatDms(data.lon, 'lon'))}</span>`)}
${row('Geländehöhe (DGM1)', escapeHtml(formatHeight(m.h)))}
${parcelRows}
</table>

<h2>3D-Ansicht</h2>
${view}

<section>
<h2>Kartenausschnitt</h2>
${mapsHtml}
${notices}

<h2>Hinweise</h2>
<div class="disclaimer">${DISCLAIMER_DE.map((p) => `<p>${p}</p>`).join('')}</div>

<p class="small authority"><b>Zuständige Stelle:</b> ${AUTHORITY_LINES_DE.map(escapeHtml).join(' ')}</p>

<div class="fill"><span>Gemeldet von (Name, Kontakt):</span><span></span><span>Datum, Unterschrift:</span><span></span></div>

<h2>Datenquellen und Lizenzen</h2>
<ul class="sources">${data.sources.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>

<p class="foot">Erstellt am ${escapeHtml(formatDateDe(data.generated, tz))} mit Saar LiDAR Explorer (lokale Anwendung; nichts wurde automatisch versendet).
Koordinaten aus dem DGM1 im Bezugssystem ETRS89/UTM 32N, Höhen DHHN2016. Marker-ID ${escapeHtml(m.id)}.</p>
</section>
</body>
</html>
`;
}
