/** German UI panels: mode, POI teleport list, toggles, time of day, info panel, attribution. */
import type { Poi } from '@model/context.ts';
import type { Building } from '@model/spec.ts';
import { parseEvidenceTags } from '@model/spec.ts';
import type { Mode } from './controls.ts';

export interface UiState {
  hour: number;
  shadows: boolean;
  confidenceColours: boolean;
  lowConfidence: 'show' | 'translucent' | 'hide';
  roofs: boolean;
  interiors: boolean;
  epoch: '1789' | '2025';
}

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
      <input id="hour" type="range" min="4.5" max="21" step="0.25" />
    </label>
    <label><input type="checkbox" id="shadows" /> Schatten</label>
    <label><input type="checkbox" id="confidenceColours" /> Konfidenz-Farben</label>
    <label><input type="checkbox" id="roofs" /> Dächer zeigen</label>
    <label><input type="checkbox" id="interiors" /> Innenräume</label>
    <label class="block">Hypothesen (niedrige Konfidenz)
      <select id="lowConfidence"><option value="show">zeigen</option><option value="translucent">transluzent</option><option value="hide">ausblenden</option></select>
    </label>
    <label class="block">Gelände
      <select id="epoch"><option value="1789">1789 (Hypothese)</option><option value="2025">heute (LiDAR 2025)</option></select>
    </label>
    <div id="legend" class="legend"><span style="background:${CONF_COL.high}"></span>hoch <span style="background:${CONF_COL.med}"></span>mittel <span style="background:${CONF_COL.low}"></span>niedrig</div>
    <details class="help"><summary>Steuerung</summary>
      WASD bewegen · Q/E runter/hoch · Umschalt schnell · Maus ziehen = umsehen · Doppelklick = Maus fangen (Esc löst) · Klick = Info · G Gehen · F Fliegen · Leertaste springen · M zurück zur Karte (Explorer, gleiche Stelle)
    </details>`;
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const sync = () => {
    $<HTMLInputElement>('hour').value = String(s.hour);
    const hh = Math.floor(s.hour);
    $('hourv').textContent = `${hh}:${String(Math.round((s.hour - hh) * 60)).padStart(2, '0')} Uhr (15. Juli 1789)`;
    $<HTMLInputElement>('shadows').checked = s.shadows;
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
  for (const k of ['shadows', 'confidenceColours', 'roofs', 'interiors'] as const) {
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

  $('attribution').innerHTML = `${esc(o.attribution)} · Texturen CC0 (Poly Haven, ambientCG) · Rekonstruktion: Hypothese nach research/01–08 (Teilprojekt Schloss Karlsberg) · <b>Schauen, nicht graben</b>`;
  const stats = $('stats');
  return {
    setMode,
    showInfo,
    sync,
    setStats: (t: string) => (stats.textContent = t),
  };
}
