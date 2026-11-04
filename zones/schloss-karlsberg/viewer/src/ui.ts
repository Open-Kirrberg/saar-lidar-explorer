/** German UI panels: mode, POI teleport list, toggles, time of day, info panel, attribution. */
import type { Poi } from '@model/context.ts';
import type { Building } from '@model/spec.ts';
import { parseEvidenceTags } from '@model/spec.ts';
import type { Mode } from './controls.ts';
import { footerParts } from './photoMath.ts';
import { QUALITY, type QualityPreset } from './quality.ts';
import type { CloudMode } from './clouds.ts';

/** Display look: Dokumentation (Neutral tone mapping, catalogue colours as authored) or Kino (AgX). */
export type Look = 'doku' | 'kino';

export interface UiState {
  hour: number;
  shadows: boolean;
  confidenceColours: boolean;
  lowConfidence: 'show' | 'translucent' | 'hide';
  roofs: boolean;
  interiors: boolean;
  epoch: '1789' | '2025';
  quality: QualityPreset;
  autoScale: boolean;
  look: Look;
  haze: boolean;
  /** Chandeliers lit at night (a celebration; ordinary evenings light candelabra and sconces only). */
  fest: boolean;
  /**
   * KB-I48 Festbeleuchtung: illumination lamps on cornices, sills, the Ehrenhof, parterres and the basin (the dense
   * rotunda rings only on the 1785 fête rotunda in a 1785 scene),
   * every window of the lit buildings candle-lit and the chandeliers burning (arrangement a hypothesis; night only).
   */
  festival: boolean;
  /**
   * Wave 10 (night sky): show the full-moon night nearest 15 Jul 1789 (6 Jul 1789, ephemeris.ts) instead of the
   * documented date, whose moon (waning, 46 %) rises only at 23:09.
   */
  fullMoon: boolean;
  /**
   * Wave 10: fair-weather cumulus and their shadows (weather of the day U). Wave-10 review fix: 'air' (default) only
   * from the air and in the Rundflug's aerial shots, 'on' always, 'off' a cloudless sky (clouds.ts `CloudMode`).
   */
  clouds: CloudMode;
}

/**
 * Time-of-day presets for 15 Jul 1789 (KB-I08; skb-visual-wow look-and-period.md §3, sun from viewer/src/sun.ts):
 * 07:00 sun 25° from 85° (garden front), 17:30 22° from 278° (court front, hero hour), 19:00 7.9°, 20:30 −4.4°
 * (civil twilight), 22:00 −13.7°.
 */
export const TIME_PRESETS: { label_de: string; hour: number }[] = [
  { label_de: 'Morgen', hour: 7 },
  { label_de: 'Nachmittag', hour: 17.5 },
  { label_de: 'Goldene Stunde', hour: 19 },
  { label_de: 'Dämmerung', hour: 20.5 },
  { label_de: 'Nacht', hour: 22 },
];

export interface UiOptions {
  pois: Poi[];
  state: UiState;
  onGoto(id: string): void;
  onMode(m: Mode): void;
  onChange(key: keyof UiState): void;
  /** "Zurück zur Karte": hand the current pose back to the explorer (key M). */
  onBack(): void;
  /** Tooltip of the back button (says where it goes). */
  backTitle: string;
  attribution: string;
  /** KB-I46: start the Rundflug. */
  onTour?(): void;
  /** KB-I47: take a still with the panel's photo options. */
  onPhoto?(): void;
  /** Wave 10: date label and moon note for the time panel (ephemeris.ts). */
  skyNote?(): { date: string; moon: string };
}

/** Photo options from the panel (KB-I47). */
export interface PhotoUiOptions {
  scale: number;
  dof: boolean;
}

const CONF_DE: Record<string, string> = { high: 'hoch', med: 'mittel', low: 'niedrig' };
const CONF_COL: Record<string, string> = { high: '#3f9b4f', med: '#e0a526', low: '#c8452f' };
const TAG_DE: Record<string, string> = { D: 'belegt', 'D->': 'abgeleitet', I: 'erschlossen', N: 'Epochennorm', U: 'unbekannt', HMS: 'HMS-Modell 2022' };

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export function buildUi(o: UiOptions) {
  const s = o.state;
  const panel = document.getElementById('panel')!;
  const groups: Record<string, Poi[]> = { Ansichten: [], Gebäude: [], Eingänge: [], Räume: [] };
  for (const p of o.pois) (p.kind === 'view' ? groups.Ansichten : p.kind === 'entrance' ? groups.Eingänge : p.kind === 'room' ? groups.Räume : groups.Gebäude).push(p);
  const opts = Object.entries(groups)
    .filter(([, l]) => l.length)
    .map(([g, l]) => `<optgroup label="${g}">${l.map((p) => `<option value="${esc(p.id)}">${esc(p.name_de)}</option>`).join('')}</optgroup>`)
    .join('');
  panel.innerHTML = `
    <h1>Schloss Karlsberg <span>um 1789</span></h1>
    <div class="note">Rekonstruktion = Hypothese · Schauen, nicht graben</div>
    <button id="back" class="back" type="button" title="${esc(o.backTitle)}" aria-keyshortcuts="M">← Zurück zur Karte <kbd>M</kbd></button>
    <div class="row modes">
      <button data-mode="fly" title="Taste F">Fliegen</button>
      <button data-mode="walk" title="Taste G">Gehen</button>
    </div>
    <label class="block">Gehe zu
      <select id="poi"><option value="">– Ort wählen –</option>${opts}</select>
    </label>
    <label class="block">Tageszeit <span id="hourv"></span>
      <input id="hour" type="range" min="4" max="23" step="0.25" />
    </label>
    <div id="moonv" class="note"></div>
    <div class="row presets">${TIME_PRESETS.map((t) => `<button type="button" data-hour="${t.hour}" title="${String(Math.floor(t.hour)).padStart(2, '0')}:${String(Math.round((t.hour % 1) * 60)).padStart(2, '0')} Uhr">${t.label_de}</button>`).join('')}</div>
    <div class="row tourphoto">
      <button id="tourBtn" type="button" title="Automatischer Flug in sechs Einstellungen (Rekonstruktion = Hypothese); Esc oder jede Eingabe beendet ihn">▶ Rundflug</button>
      <button id="photoBtn" type="button" title="Standbild mit Kantenglättung, Quellenangabe und Hinweis „Rekonstruktion – Hypothese“ als PNG speichern (Taste P)" aria-keyshortcuts="P">Foto <kbd>P</kbd></button>
    </div>
    <div class="row photoopts">
      <label title="Auflösung des Fotos gegenüber dem Bildschirm">Foto <select id="photoScale"><option value="2">2×</option><option value="3">3×</option></select></label>
      <label title="Leichte Tiefenunschärfe, scharf in der Bildmitte"><input type="checkbox" id="photoDof" /> Tiefenunschärfe</label>
    </div>
    <label><input type="checkbox" id="shadows" /> Schatten</label>
    <label><input type="checkbox" id="haze" /> Dunst</label>
    <label class="block" title="Schönwetter-Cumulus mit Wolkenschatten (Sommernorm; das Wetter des Tages ist unbekannt). „Aus der Luft“: nur im Flug ab etwa 80 m über Grund und in den Luftbildern des Rundflugs; in Augenhöhe bleibt der Himmel wolkenlos zur Dokumentation">Wolken (Schönwetter, Hypothese)
      <select id="clouds"><option value="air">aus der Luft</option><option value="on">immer</option><option value="off">aus</option></select>
    </label>
    <label title="Der Mond am 15. Juli 1789 nimmt ab (46 %) und geht erst um 23:09 Uhr auf. Diese Option zeigt die nächste Vollmondnacht, den 6. Juli 1789 (Mondstand nach Meeus berechnet)"><input type="checkbox" id="fullMoon" /> Vollmondnacht (6. Juli 1789)</label>
    <label title="Abends brennen gewöhnlich nur Leuchter auf dem Kamin und Wandleuchter; Kronleuchter wurden zu Festen angezündet (Anlass Hypothese)"><input type="checkbox" id="fest" /> Fest: Kronleuchter brennen</label>
    <label title="Illumination nach dem Muster der Hochzeit 1785 (Fürstenwärther 1786) auf den Bau von 1789 übertragen: Lampions auf Gesimsen und Fensterbänken, Feuertöpfe im Ehrenhof, Lichter an Parterres und Bassin; alle Fenster erleuchtet. Die dichten Lichterkränze der Festrotunde von 1785 gehören nur zum Festjahr 1785. Anordnung Hypothese. Nur bei Dunkelheit sichtbar."><input type="checkbox" id="festival" /> Festbeleuchtung (Muster 1785, auf 1789 übertragen; Hypothese)</label>
    <label><input type="checkbox" id="confidenceColours" /> Konfidenz-Farben</label>
    <label><input type="checkbox" id="roofs" /> Dächer zeigen</label>
    <label><input type="checkbox" id="interiors" /> Innenräume</label>
    <label class="block">Hypothesen (niedrige Konfidenz)
      <select id="lowConfidence"><option value="show">zeigen</option><option value="translucent">transluzent</option><option value="hide">ausblenden</option></select>
    </label>
    <label class="block">Gelände
      <select id="epoch"><option value="1789">1789 (Hypothese)</option><option value="2025">heute (LiDAR 2025)</option></select>
    </label>
    <div class="row pair">
      <label class="block">Qualität
        <select id="quality">${(Object.keys(QUALITY) as QualityPreset[]).map((k) => `<option value="${k}">${QUALITY[k].label_de}</option>`).join('')}</select>
      </label>
      <label class="block">Darstellung
        <select id="look"><option value="doku">Dokumentation</option><option value="kino">Kino</option></select>
      </label>
    </div>
    <label title="Senkt die Auflösung, wenn die Grafikkarte das Bild nicht in 14 ms schafft"><input type="checkbox" id="autoScale" /> Auflösung automatisch anpassen</label>
    <div id="legend" class="legend"><span style="background:${CONF_COL.high}"></span>hoch <span style="background:${CONF_COL.med}"></span>mittel <span style="background:${CONF_COL.low}"></span>niedrig</div>
    <details class="help"><summary>Steuerung</summary>
      WASD bewegen · Q/E runter/hoch · Umschalt schnell · Maus ziehen = umsehen · Doppelklick = Maus fangen (Esc löst) · Klick = Info · G Gehen · F Fliegen · Leertaste springen · P Foto speichern · Rundflug: Esc oder jede Eingabe beendet ihn · M zurück zur Karte (Explorer, gleiche Stelle)
    </details>`;
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const sync = () => {
    $<HTMLInputElement>('hour').value = String(s.hour);
    const hh = Math.floor(s.hour);
    const note = o.skyNote?.();
    $('hourv').textContent = `${hh}:${String(Math.round((s.hour - hh) * 60)).padStart(2, '0')} Uhr (${note?.date ?? '15. Juli 1789'})`;
    $('moonv').textContent = note?.moon ?? '';
    $<HTMLSelectElement>('clouds').value = s.clouds;
    $<HTMLInputElement>('fullMoon').checked = s.fullMoon;
    $<HTMLInputElement>('shadows').checked = s.shadows;
    $<HTMLInputElement>('haze').checked = s.haze;
    $<HTMLInputElement>('fest').checked = s.fest;
    $<HTMLInputElement>('festival').checked = s.festival;
    $<HTMLInputElement>('autoScale').checked = s.autoScale;
    $<HTMLSelectElement>('quality').value = s.quality;
    $<HTMLSelectElement>('look').value = s.look;
    panel.querySelectorAll<HTMLButtonElement>('button[data-hour]').forEach((b) => b.classList.toggle('on', Number(b.dataset.hour) === s.hour));
    $<HTMLInputElement>('confidenceColours').checked = s.confidenceColours;
    $<HTMLInputElement>('roofs').checked = s.roofs;
    $<HTMLInputElement>('interiors').checked = s.interiors;
    $<HTMLSelectElement>('lowConfidence').value = s.lowConfidence;
    $<HTMLSelectElement>('epoch').value = s.epoch;
    $('legend').style.display = s.confidenceColours ? '' : 'none';
  };
  sync();
  $<HTMLInputElement>('hour').addEventListener('input', (e) => {
    s.hour = Number((e.target as HTMLInputElement).value);
    sync();
    o.onChange('hour');
  });
  panel.querySelectorAll<HTMLButtonElement>('button[data-hour]').forEach((b) =>
    b.addEventListener('click', () => {
      s.hour = Number(b.dataset.hour);
      sync();
      o.onChange('hour');
      b.blur();
    }),
  );
  $<HTMLSelectElement>('quality').addEventListener('change', (e) => {
    s.quality = (e.target as HTMLSelectElement).value as QualityPreset;
    (e.target as HTMLSelectElement).blur();
    o.onChange('quality');
  });
  $<HTMLSelectElement>('look').addEventListener('change', (e) => {
    s.look = (e.target as HTMLSelectElement).value as Look;
    (e.target as HTMLSelectElement).blur();
    o.onChange('look');
  });
  $<HTMLSelectElement>('clouds').addEventListener('change', (e) => {
    s.clouds = (e.target as HTMLSelectElement).value as CloudMode;
    (e.target as HTMLSelectElement).blur();
    o.onChange('clouds');
  });
  for (const k of ['shadows', 'confidenceColours', 'roofs', 'interiors', 'haze', 'fest', 'festival', 'autoScale', 'fullMoon'] as const) {
    $<HTMLInputElement>(k).addEventListener('change', (e) => {
      s[k] = (e.target as HTMLInputElement).checked;
      sync();
      o.onChange(k);
    });
  }
  $<HTMLSelectElement>('lowConfidence').addEventListener('change', (e) => {
    s.lowConfidence = (e.target as HTMLSelectElement).value as UiState['lowConfidence'];
    o.onChange('lowConfidence');
  });
  $<HTMLSelectElement>('epoch').addEventListener('change', (e) => {
    s.epoch = (e.target as HTMLSelectElement).value as UiState['epoch'];
    o.onChange('epoch');
  });
  $<HTMLSelectElement>('poi').addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    if (v) o.onGoto(v);
    (e.target as HTMLSelectElement).blur();
  });
  $<HTMLButtonElement>('back').addEventListener('click', () => o.onBack());
  $<HTMLButtonElement>('tourBtn').addEventListener('click', (e) => {
    (e.currentTarget as HTMLButtonElement).blur();
    o.onTour?.();
  });
  $<HTMLButtonElement>('photoBtn').addEventListener('click', (e) => {
    (e.currentTarget as HTMLButtonElement).blur();
    o.onPhoto?.();
  });
  $<HTMLSelectElement>('photoScale').addEventListener('change', (e) => (e.target as HTMLSelectElement).blur());
  panel.querySelectorAll<HTMLButtonElement>('button[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      o.onMode(b.dataset.mode as Mode);
      b.blur();
    }),
  );
  const setMode = (m: Mode) => panel.querySelectorAll<HTMLButtonElement>('button[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  setMode('fly');

  const info = $('infobox');
  /** German labels of the building classes (the catalogue prose itself is English, labelled as such). */
  const CLASS_DE: Record<string, string> = {
    CDL: 'Hauptbau (Corps de logis)',
    WING2: 'Flügelbau, zweigeschossig',
    RANGE1: 'Flügel / Galerie, eingeschossig',
    PAV: 'Pavillon',
    STABLE: 'Stall / Marstall',
    RIDE: 'Reithalle',
    ORANG: 'Orangerie',
    FARM: 'Wirtschafts- / Nebengebäude',
    FARM_GROUP: 'Gebäudegruppe (Umriss)',
    GARD: 'Garten / Einfriedung',
    WALL: 'Mauer / Gitter',
    '?': 'unbekannt',
  };
  const showInfo = (b: Building | null, room?: { id: string; name?: string }) => {
    if (!b) {
      info.style.display = 'none';
      return;
    }
    const tags = parseEvidenceTags([b.base_h_note, b.facade.tags, b.roof.tags, b.notes].filter(Boolean).join(' '));
    info.style.display = 'block';
    info.innerHTML = `<button class="close" title="Schließen">×</button>
      <h2>${esc(b.name_de)}</h2>
      ${room ? `<div class="room">Raum: <b>${esc(room.name ?? room.id)}</b></div>` : ''}
      <dl>
        <dt>Bautyp</dt><dd>${esc(CLASS_DE[b.cls] ?? b.cls)}</dd>
        <dt>Funktion</dt><dd><span class="lang">Katalogtext (engl.)</span><span lang="en">${esc(b.function)}</span></dd>
        <dt>Erbaut</dt><dd>${esc(b.built)}</dd>
        <dt>Konfidenz</dt><dd><span class="dot" style="background:${CONF_COL[b.confidence]}"></span>${CONF_DE[b.confidence]} · Verortung: ${esc(b.placement)}</dd>
        <dt>Höhen</dt><dd>Sockel ${b.base_h?.toFixed(2)} m ü. NHN${b.roof.eaves_h ? ` · Traufe ${b.roof.eaves_h.toFixed(1)}` : ''}${b.roof.ridge_h ? ` · First ${b.roof.ridge_h.toFixed(1)}` : ''}</dd>
        <dt>Evidenz</dt><dd>${tags.map((t) => `<span class="tag" title="${TAG_DE[t] ?? t}">${esc(t)}</span>`).join(' ') || '–'} ${b.notes ? `<div class="notes"><span class="lang">Katalognotiz (engl.)</span><span lang="en">${esc(b.notes.slice(0, 420))}${b.notes.length > 420 ? ' …' : ''}</span></div>` : ''}</dd>
        <dt>Quellen</dt><dd>${(b.sources ?? []).map((x) => `<div>${esc(x)}</div>`).join('') || '–'}</dd>
      </dl>
      <div class="id">${esc(b.id)} · ${esc(b.cls)}</div>`;
    info.querySelector('.close')?.addEventListener('click', () => (info.style.display = 'none'));
  };

  // the same credit line is burned into photos (photoMath.ts footerParts)
  const credit = footerParts(o.attribution);
  $('attribution').innerHTML = `${credit.slice(0, -1).map(esc).join(' · ')} · <b>${esc(credit[credit.length - 1])}</b>`;
  const stats = $('stats');

  // ---------------------------------------------------------------- KB-I46 Rundflug overlay, KB-I47 photo toast
  const cine = $('cine');
  const cut = $('cut');
  const cap = $('tourcap');
  const capT = cap.querySelector<HTMLElement>('.t')!;
  const capN = cap.querySelector<HTMLElement>('.n')!;
  const toastEl = $('toast');
  let panelDisplay = '';
  /** Cinema mode: letterbox, caption and cut overlay on; the panel, info box and stats off. */
  const setCinema = (on: boolean) => {
    if (on && cine.style.display !== 'block') panelDisplay = panel.style.display;
    document.body.classList.toggle('cinema', on);
    cine.style.display = on ? 'block' : 'none';
    cut.style.display = on ? 'block' : 'none';
    cap.style.display = on ? 'block' : 'none';
    panel.style.display = on ? 'none' : panelDisplay;
    stats.style.visibility = on ? 'hidden' : '';
    if (on) info.style.display = 'none';
    if (!on) {
      cut.style.opacity = '0';
      cap.style.opacity = '0';
    }
  };
  const setCaption = (title: string, note: string, alpha: number, fade: number) => {
    if (capT.textContent !== title) capT.textContent = title;
    if (capN.textContent !== note) capN.textContent = note;
    cap.style.opacity = alpha.toFixed(3);
    cut.style.opacity = fade.toFixed(3);
  };
  /** Small status line (photo progress); null hides it. */
  const toast = (text: string | null) => {
    toastEl.textContent = text ?? '';
    toastEl.style.display = text ? 'block' : 'none';
  };
  const photoOptions = (): PhotoUiOptions => ({ scale: Number($<HTMLSelectElement>('photoScale').value) || 2, dof: $<HTMLInputElement>('photoDof').checked });
  const setTourActive = (on: boolean) => {
    const b = $<HTMLButtonElement>('tourBtn');
    b.classList.toggle('on', on);
    b.textContent = on ? '■ Rundflug beenden' : '▶ Rundflug';
  };
  return {
    setMode,
    showInfo,
    sync,
    setStats: (t: string) => (stats.textContent = t),
    setCinema,
    setCaption,
    setTourActive,
    toast,
    photoOptions,
  };
}
