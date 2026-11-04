/**
 * Castle HUD (V2.7, replaces ui.ts): German, tiered (ADR 0019), built inside the zone container with class-scoped CSS
 * (prefix `skb-`, one injected <style>), so it can sit in the explorer's page. No page-level ids.
 *
 * - Standard: title, hypothesis note, „Verlassen“ (zone) / „Zurück zur Karte“ (standalone), Fliegen/Gehen, „Gehe zu“
 *   with the eight highlights, ▶ Rundflug, the info card and the short attribution.
 * - Entdecker adds the time of day (slider + 5 presets), Foto (P) and the „Gewissheit“ select with its legend.
 * - Labor adds Kino/Dokumentation, Dächer, „Alle Orte“ (all POIs in optgroups), the photo options and the stats line.
 * - Phone (≤ 600 px): a compact bar that folds the panel, ≥ 44 px targets; on coarse pointers hold-to-move ▲/▼.
 * The Rundflug letterbox, caption and cut and the photo toast are here too.
 */
import type { Poi } from '@model/context.ts';
import type { Building } from '@model/spec.ts';
import { parseEvidenceTags } from '@model/spec.ts';
import type { Mode } from './controls.ts';
import { footerParts } from './photoMath.ts';
import type { QualityPreset } from './quality.ts';
import type { CloudMode } from './clouds.ts';
import { GEWISSHEIT_OPTIONS, gewissheit, gewissheitOf, isGewissheit } from './gewissheit.ts';
import type { Highlight } from './highlights.ts';
import type { ZoneTier } from './zone/api.ts';

/** Display look: Dokumentation (Neutral tone mapping, catalogue colours as authored) or Kino (AgX). */
export type Look = 'doku' | 'kino';

/**
 * Renderer state behind the HUD and `skb.set`. Since V2.7 (ADR 0020) only hour, look, roofs and the two confidence
 * keys have controls; shadows, clouds follow the quality preset; haze, interiors and autoScale stay on (the keys remain
 * for review drivers); fest / festival are frozen (no control, code kept).
 */
export interface UiState {
  hour: number;
  shadows: boolean;
  confidenceColours: boolean;
  lowConfidence: 'show' | 'translucent' | 'hide';
  roofs: boolean;
  interiors: boolean;
  quality: QualityPreset;
  autoScale: boolean;
  look: Look;
  haze: boolean;
  /** Chandeliers lit at night (a celebration; ordinary evenings light candelabra and sconces only). Frozen. */
  fest: boolean;
  /** KB-I48 Festbeleuchtung (pattern of 1785 on the 1789 buildings; hypothesis; night only). Frozen. */
  festival: boolean;
  /** Fair-weather cumulus (clouds.ts CloudMode); set by the quality preset. */
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

export interface HudOptions {
  container: HTMLElement;
  tier: ZoneTier;
  /** zone mode: „Verlassen“ instead of „Zurück zur Karte“ */
  zone: boolean;
  state: UiState;
  highlights: readonly Highlight[];
  /** every POI („Alle Orte“, Labor) */
  pois: readonly Poi[];
  attribution: string;
  backTitle: string;
  onGoto(id: string): void;
  onMode(m: Mode): void;
  onChange(key: keyof UiState): void;
  onBack(): void;
  onTour(): void;
  onPhoto(): void;
  /** hold-to-move buttons: +1 forward, −1 back, 0 stop */
  onMove(fwd: number): void;
  /** date label and moon note for the time panel (ephemeris.ts) */
  skyNote?(): { date: string; moon: string };
}

/** Photo options from the panel (KB-I47). */
export interface PhotoUiOptions {
  scale: number;
  dof: boolean;
}

export type Hud = ReturnType<typeof buildHud>;

const CONF_DE: Record<string, string> = { high: 'hoch', med: 'mittel', low: 'niedrig' };
const CONF_COL: Record<string, string> = { high: '#3f9b4f', med: '#e0a526', low: '#c8452f' };
const TAG_DE: Record<string, string> = { D: 'belegt', 'D->': 'abgeleitet', I: 'erschlossen', N: 'Epochennorm', U: 'unbekannt', HMS: 'HMS-Modell 2022' };
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

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const hhmm = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

const STYLE_ID = 'skb-hud-style';
const CSS = `
.skb-root { position: absolute; inset: 0; pointer-events: none; color: #e8e4dc; font: 13px/1.35 system-ui, sans-serif; overflow: hidden; z-index: 1; }
.skb-root * { box-sizing: border-box; }
.skb-root :focus-visible { outline: 2px solid #e7c27a; outline-offset: 2px; }
.skb-glass { background: rgba(24, 27, 31, 0.78); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; }
.skb-panel { position: absolute; left: 12px; top: 12px; width: 260px; max-height: calc(100% - 48px); overflow: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; pointer-events: auto; }
.skb-head { display: flex; align-items: center; gap: 6px; }
.skb-title { font: 600 16px/1.2 Georgia, serif; margin: 0; letter-spacing: 0.02em; flex: 1; }
.skb-title span { font-weight: 400; opacity: 0.75; }
.skb-fold { display: none; }
.skb-note { font-size: 11px; color: #e7c27a; }
.skb-body { display: flex; flex-direction: column; gap: 6px; }
.skb-root label { display: flex; gap: 6px; align-items: center; }
.skb-root label.skb-block { flex-direction: column; align-items: stretch; gap: 2px; }
.skb-root select, .skb-root input[type=range] { width: 100%; }
.skb-root select { background: #2b3036; color: inherit; border: 1px solid #444; border-radius: 4px; padding: 3px; font: inherit; }
.skb-btn { background: #2b3036; color: inherit; border: 1px solid #444; border-radius: 4px; padding: 5px 8px; cursor: pointer; font: inherit; }
.skb-btn:hover { border-color: #c7a35a; }
.skb-btn.skb-on, .skb-btn[aria-pressed=true] { background: #c7a35a; color: #1d2126; border-color: #c7a35a; font-weight: 600; }
.skb-back { border-color: #c7a35a; text-align: left; }
.skb-back:hover, .skb-back:focus-visible { background: #c7a35a; color: #1d2126; }
.skb-root kbd { font: 10px ui-monospace, monospace; opacity: 0.75; border: 1px solid currentColor; border-radius: 3px; padding: 0 3px; }
.skb-back kbd { float: right; }
.skb-row { display: flex; gap: 6px; }
.skb-row > * { flex: 1; min-width: 0; }
.skb-presets { display: flex; flex-wrap: wrap; gap: 4px; }
.skb-presets .skb-btn { flex: 1 1 auto; padding: 3px 5px; font-size: 11px; }
.skb-legend span { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin: 0 3px 0 6px; }
.skb-small { font-size: 11px; opacity: 0.8; }
.skb-root[data-tier=standard] .skb-t2, .skb-root[data-tier=standard] .skb-t3, .skb-root[data-tier=entdecker] .skb-t3 { display: none !important; }
.skb-info { position: absolute; right: 12px; top: 12px; width: 330px; max-height: calc(100% - 80px); overflow: auto; overflow-x: hidden; padding: 10px 12px; display: none; pointer-events: auto; }
.skb-info h2 { font: 600 15px Georgia, serif; margin: 0 26px 6px 0; }
.skb-info dl { margin: 0; display: grid; grid-template-columns: 74px minmax(0, 1fr); gap: 4px 8px; }
.skb-info dt { opacity: 0.6; }
.skb-info dd { margin: 0; min-width: 0; overflow-wrap: anywhere; hyphens: auto; }
.skb-info .skb-lang { display: block; font-size: 10px; opacity: 0.55; text-transform: uppercase; letter-spacing: 0.04em; }
.skb-info .skb-notes { font-size: 11px; opacity: 0.8; margin-top: 4px; }
.skb-info .skb-tag { display: inline-block; padding: 0 5px; border-radius: 3px; background: #3a4048; font-size: 11px; }
.skb-info .skb-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; }
.skb-info .skb-close { position: absolute; right: 6px; top: 4px; background: none; color: inherit; border: 0; font-size: 18px; cursor: pointer; min-width: 32px; min-height: 32px; }
.skb-info .skb-id { margin-top: 8px; font-size: 11px; opacity: 0.5; }
.skb-info .skb-room { margin-bottom: 6px; }
.skb-footer { position: absolute; left: 12px; right: 12px; bottom: 8px; display: flex; justify-content: space-between; gap: 12px; font-size: 11px; pointer-events: none; z-index: 3; }
.skb-attr { opacity: 0.8; text-shadow: 0 1px 2px #000; pointer-events: auto; min-width: 0; }
.skb-attr summary { cursor: pointer; list-style: none; }
.skb-attr summary::-webkit-details-marker { display: none; }
.skb-attr[open] { opacity: 1; background: rgba(24, 27, 31, 0.85); border-radius: 6px; padding: 4px 8px; max-width: 520px; }
.skb-attr .skb-credits { margin-top: 4px; line-height: 1.4; }
.skb-stats { opacity: 0.7; text-shadow: 0 1px 2px #000; white-space: nowrap; }
.skb-status { position: absolute; left: 50%; top: 45%; transform: translate(-50%, -50%); font-size: 16px; text-shadow: 0 1px 3px #000; }
.skb-status:empty { display: none; }
.skb-cine { display: none; position: absolute; inset: 0; pointer-events: none; z-index: 1; }
.skb-cine .skb-bar { position: absolute; left: 0; right: 0; height: 0; background: #000; }
.skb-cine .skb-bar.skb-top { top: 0; }
.skb-cine .skb-bar.skb-bottom { bottom: 0; }
.skb-cut { display: none; position: absolute; inset: 0; background: #000; opacity: 0; pointer-events: none; z-index: 2; }
.skb-cap { display: none; position: absolute; left: 8px; right: 8px; bottom: 30px; text-align: center; opacity: 0; pointer-events: none; text-shadow: 0 1px 3px #000; z-index: 3; }
.skb-cap .skb-cap-t { font: 400 24px/1.25 Georgia, serif; letter-spacing: 0.02em; color: #f4efe6; }
.skb-cap .skb-cap-n { margin-top: 4px; font-size: 12px; color: #e7c27a; }
.skb-toast { display: none; z-index: 4; position: absolute; left: 50%; top: 18px; transform: translateX(-50%); padding: 6px 12px; font-size: 12px; pointer-events: none; max-width: calc(100% - 24px); }
.skb-move { display: none; position: absolute; right: 14px; bottom: 44px; flex-direction: column; gap: 10px; pointer-events: auto; z-index: 2; }
.skb-move .skb-btn { width: 56px; height: 56px; font-size: 22px; border-radius: 50%; touch-action: none; user-select: none; -webkit-user-select: none; background: rgba(24, 27, 31, 0.7); }
.skb-root.skb-coarse .skb-move { display: flex; }
.skb-root.skb-cinema .skb-panel, .skb-root.skb-cinema .skb-info, .skb-root.skb-cinema .skb-move { display: none !important; }
.skb-root.skb-cinema .skb-stats { visibility: hidden; }
.skb-root.skb-coarse .skb-btn, .skb-root.skb-coarse select { min-height: 44px; }
.skb-root.skb-coarse .skb-presets .skb-btn { min-height: 44px; }
.skb-root.skb-phone .skb-panel { left: 8px; right: 8px; top: 8px; width: auto; max-height: calc(100% - 140px); padding: 6px 10px; }
.skb-root.skb-phone .skb-fold { display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; }
.skb-root.skb-phone .skb-title { font-size: 15px; }
.skb-root.skb-phone .skb-folded .skb-body, .skb-root.skb-phone .skb-folded .skb-note { display: none; }
.skb-root.skb-phone .skb-btn, .skb-root.skb-phone select { min-height: 44px; }
.skb-root.skb-phone .skb-info { left: 8px; right: 8px; top: auto; bottom: 28px; width: auto; max-height: 45%; }
.skb-root.skb-phone .skb-footer { left: 8px; right: 84px; font-size: 10px; }
.skb-root.skb-phone .skb-attr summary { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.skb-root.skb-phone .skb-cap .skb-cap-t { font-size: 18px; }
.skb-root.skb-phone .skb-cap .skb-cap-n { font-size: 11px; }
`;

function injectStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const st = doc.createElement('style');
  st.id = STYLE_ID;
  st.textContent = CSS;
  doc.head.appendChild(st);
}

/** Letterbox bar height (px) for a 2.2:1 frame; on a portrait phone at most 12 % of the height (caption stays big). */
export function letterboxBar(w: number, h: number): number {
  const bar = Math.max(0, (h - w / 2.2) / 2);
  return h > w ? Math.min(bar, h * 0.12) : bar;
}

export function buildHud(o: HudOptions) {
  const s = o.state;
  injectStyle(o.container.ownerDocument);
  const root = document.createElement('div');
  root.className = 'skb-root';
  root.dataset.tier = o.tier;
  const allGroups: Record<string, Poi[]> = { Ansichten: [], Gebäude: [], Eingänge: [], Räume: [] };
  for (const p of o.pois) (p.kind === 'view' ? allGroups.Ansichten : p.kind === 'entrance' ? allGroups.Eingänge : p.kind === 'room' ? allGroups.Räume : allGroups.Gebäude).push(p);
  const allOpts = Object.entries(allGroups)
    .filter(([, l]) => l.length)
    .map(([g, l]) => `<optgroup label="${g}">${l.map((p) => `<option value="${esc(p.id)}">${esc(p.name_de)}</option>`).join('')}</optgroup>`)
    .join('');
  const backLabel = o.zone ? '← Verlassen' : '← Zurück zur Karte';
  root.innerHTML = `
    <section class="skb-panel skb-glass" aria-label="Schloss Karlsberg">
      <div class="skb-head">
        <h1 class="skb-title">Schloss Karlsberg <span>· Sommer 1789</span></h1>
        <button type="button" class="skb-btn skb-fold" aria-expanded="true" aria-label="Menü ein- oder ausklappen">▾</button>
      </div>
      <div class="skb-note">Rekonstruktion = Hypothese · Schauen, nicht graben</div>
      <div class="skb-body">
        <button type="button" class="skb-btn skb-back" title="${esc(o.backTitle)}" aria-keyshortcuts="M">${backLabel} <kbd>M</kbd></button>
        <div class="skb-row" role="group" aria-label="Bewegung">
          <button type="button" class="skb-btn" data-mode="fly" title="Taste F" aria-pressed="false">Fliegen</button>
          <button type="button" class="skb-btn" data-mode="walk" title="Taste G" aria-pressed="false">Gehen</button>
        </div>
        <label class="skb-block">Gehe zu
          <select class="skb-goto"><option value="">– Ort wählen –</option>${o.highlights.map((h) => `<option value="${esc(h.id)}">${esc(h.label_de)}</option>`).join('')}</select>
        </label>
        <label class="skb-block skb-t3">Alle Orte
          <select class="skb-all"><option value="">– Ort wählen –</option>${allOpts}</select>
        </label>
        <div class="skb-row">
          <button type="button" class="skb-btn skb-tour" title="Automatischer Flug in sechs Einstellungen (Rekonstruktion = Hypothese); Esc oder jede Eingabe beendet ihn">▶ Rundflug</button>
          <button type="button" class="skb-btn skb-photo skb-t2" title="Standbild mit Kantenglättung, Quellenangabe und Hinweis „Rekonstruktion – Hypothese“ als PNG speichern (Taste P)" aria-keyshortcuts="P">Foto <kbd>P</kbd></button>
        </div>
        <label class="skb-block skb-t2">Tageszeit <span class="skb-hourv"></span>
          <input class="skb-hour" type="range" min="4" max="23" step="0.25" aria-label="Tageszeit" />
        </label>
        <div class="skb-note skb-moonv skb-t2"></div>
        <div class="skb-presets skb-t2" role="group" aria-label="Tageszeit-Vorgaben">${TIME_PRESETS.map((t) => `<button type="button" class="skb-btn" data-hour="${t.hour}" title="${hhmm(t.hour)} Uhr">${t.label_de}</button>`).join('')}</div>
        <label class="skb-block skb-t2" title="Färbt oder blendet Bauten nach der Gewissheit der Rekonstruktion (Konfidenz im Katalog)">Gewissheit
          <select class="skb-gewissheit">${GEWISSHEIT_OPTIONS.map((g) => `<option value="${g.value}">${esc(g.label_de)}</option>`).join('')}</select>
        </label>
        <div class="skb-legend skb-small skb-t2"><span style="background:${CONF_COL.high}"></span>gesichert <span style="background:${CONF_COL.med}"></span>wahrscheinlich <span style="background:${CONF_COL.low}"></span>unsicher</div>
        <div class="skb-row skb-t3">
          <label class="skb-block">Darstellung
            <select class="skb-look"><option value="kino">Kino</option><option value="doku">Dokumentation</option></select>
          </label>
          <label class="skb-block">Foto
            <select class="skb-photo-scale" aria-label="Foto-Auflösung"><option value="2">2×</option><option value="3">3×</option></select>
          </label>
        </div>
        <label class="skb-t3"><input type="checkbox" class="skb-roofs" /> Dächer zeigen</label>
        <label class="skb-t3" title="Leichte Tiefenunschärfe, scharf in der Bildmitte"><input type="checkbox" class="skb-photo-dof" /> Foto mit Tiefenunschärfe</label>
        <details class="skb-small"><summary>Steuerung</summary>
          WASD bewegen · Q/E runter/hoch · Umschalt schnell · Maus ziehen = umsehen · Doppelklick = Maus fangen (Esc löst) · Klick = Info · G Gehen · F Fliegen · Leertaste springen · P Foto · Rundflug: jede Eingabe beendet ihn · M ${o.zone ? 'Verlassen' : 'zurück zur Karte'} · Touch: ein Finger = umsehen, ▲/▼ halten = gehen
        </details>
      </div>
    </section>
    <aside class="skb-info skb-glass" aria-live="polite"></aside>
    <div class="skb-move" role="group" aria-label="Bewegen">
      <button type="button" class="skb-btn" data-move="1" aria-label="Vorwärts (halten)">▲</button>
      <button type="button" class="skb-btn" data-move="-1" aria-label="Rückwärts (halten)">▼</button>
    </div>
    <div class="skb-cine" aria-hidden="true"><div class="skb-bar skb-top"></div><div class="skb-bar skb-bottom"></div></div>
    <div class="skb-cut" aria-hidden="true"></div>
    <div class="skb-cap" role="status" aria-live="polite"><div class="skb-cap-t"></div><div class="skb-cap-n"></div></div>
    <div class="skb-toast skb-glass" role="status" aria-live="polite"></div>
    <div class="skb-status" role="status"></div>
    <div class="skb-footer"><details class="skb-attr"><summary></summary><div class="skb-credits"></div></details><div class="skb-stats skb-t3"></div></div>`;
  o.container.appendChild(root);
  const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const panel = q<HTMLElement>('.skb-panel');
  const info = q<HTMLElement>('.skb-info');
  const stats = q<HTMLElement>('.skb-stats');
  const hourInput = q<HTMLInputElement>('.skb-hour');
  const gew = q<HTMLSelectElement>('.skb-gewissheit');
  const look = q<HTMLSelectElement>('.skb-look');
  const roofs = q<HTMLInputElement>('.skb-roofs');
  const legend = q<HTMLElement>('.skb-legend');

  const sync = () => {
    hourInput.value = String(s.hour);
    const note = o.skyNote?.();
    q('.skb-hourv').textContent = `${hhmm(s.hour)} Uhr (${note?.date ?? '15. Juli 1789'})`;
    q('.skb-moonv').textContent = note?.moon ?? '';
    root.querySelectorAll<HTMLButtonElement>('button[data-hour]').forEach((b) => {
      const on = Number(b.dataset.hour) === s.hour;
      b.classList.toggle('skb-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    gew.value = gewissheitOf(s);
    legend.style.display = s.confidenceColours ? '' : 'none';
    look.value = s.look;
    roofs.checked = s.roofs;
  };
  sync();

  const blurAfter = (el: HTMLElement) => el.blur(); // keyboard shortcuts work again (controls.ts isTyping)
  hourInput.addEventListener('input', () => {
    s.hour = Number(hourInput.value);
    sync();
    o.onChange('hour');
  });
  root.querySelectorAll<HTMLButtonElement>('button[data-hour]').forEach((b) =>
    b.addEventListener('click', () => {
      s.hour = Number(b.dataset.hour);
      sync();
      o.onChange('hour');
      blurAfter(b);
    }),
  );
  gew.addEventListener('change', () => {
    const v = gew.value;
    if (!isGewissheit(v)) return;
    const g = gewissheit(v);
    s.confidenceColours = g.confidenceColours;
    s.lowConfidence = g.lowConfidence;
    sync();
    o.onChange('confidenceColours');
    blurAfter(gew);
  });
  look.addEventListener('change', () => {
    s.look = look.value === 'doku' ? 'doku' : 'kino';
    o.onChange('look');
    blurAfter(look);
  });
  roofs.addEventListener('change', () => {
    s.roofs = roofs.checked;
    o.onChange('roofs');
  });
  for (const sel of ['.skb-goto', '.skb-all']) {
    const el = q<HTMLSelectElement>(sel);
    el.addEventListener('change', () => {
      if (el.value) o.onGoto(el.value);
      blurAfter(el);
    });
  }
  q<HTMLButtonElement>('.skb-back').addEventListener('click', () => o.onBack());
  q<HTMLButtonElement>('.skb-tour').addEventListener('click', (e) => {
    blurAfter(e.currentTarget as HTMLElement);
    o.onTour();
  });
  q<HTMLButtonElement>('.skb-photo').addEventListener('click', (e) => {
    blurAfter(e.currentTarget as HTMLElement);
    o.onPhoto();
  });
  q<HTMLSelectElement>('.skb-photo-scale').addEventListener('change', (e) => blurAfter(e.currentTarget as HTMLElement));
  root.querySelectorAll<HTMLButtonElement>('button[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      o.onMode(b.dataset.mode as Mode);
      blurAfter(b);
    }),
  );
  const fold = q<HTMLButtonElement>('.skb-fold');
  const setFolded = (on: boolean) => {
    panel.classList.toggle('skb-folded', on);
    fold.setAttribute('aria-expanded', String(!on));
    fold.textContent = on ? '▸' : '▾';
  };
  fold.addEventListener('click', () => setFolded(!panel.classList.contains('skb-folded')));
  // hold-to-move (coarse pointers): pointer capture, so a finger sliding off the button still ends the move
  root.querySelectorAll<HTMLButtonElement>('button[data-move]').forEach((b) => {
    const v = Number(b.dataset.move);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture?.(e.pointerId);
      o.onMove(v);
    });
    const stop = () => o.onMove(0);
    b.addEventListener('pointerup', stop);
    b.addEventListener('pointercancel', stop);
    b.addEventListener('lostpointercapture', stop);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  });
  const setMode = (m: Mode) =>
    root.querySelectorAll<HTMLButtonElement>('button[data-mode]').forEach((b) => {
      const on = b.dataset.mode === m;
      b.classList.toggle('skb-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  setMode('fly');

  const showInfo = (b: Building | null, room?: { id: string; name?: string }) => {
    if (!b) {
      info.style.display = 'none';
      return;
    }
    const tags = parseEvidenceTags([b.base_h_note, b.facade.tags, b.roof.tags, b.notes].filter(Boolean).join(' '));
    info.style.display = 'block';
    info.innerHTML = `<button type="button" class="skb-close" aria-label="Schließen">×</button>
      <h2>${esc(b.name_de)}</h2>
      ${room ? `<div class="skb-room">Raum: <b>${esc(room.name ?? room.id)}</b></div>` : ''}
      <dl>
        <dt>Bautyp</dt><dd>${esc(CLASS_DE[b.cls] ?? b.cls)}</dd>
        <dt>Funktion</dt><dd><span class="skb-lang">Katalogtext (engl.)</span><span lang="en">${esc(b.function)}</span></dd>
        <dt>Erbaut</dt><dd>${esc(b.built)}</dd>
        <dt>Gewissheit</dt><dd><span class="skb-dot" style="background:${CONF_COL[b.confidence]}"></span>${CONF_DE[b.confidence]} · Verortung: ${esc(b.placement)}</dd>
        <dt>Höhen</dt><dd>Sockel ${b.base_h?.toFixed(2)} m ü. NHN${b.roof.eaves_h ? ` · Traufe ${b.roof.eaves_h.toFixed(1)}` : ''}${b.roof.ridge_h ? ` · First ${b.roof.ridge_h.toFixed(1)}` : ''}</dd>
        <dt>Evidenz</dt><dd>${tags.map((t) => `<span class="skb-tag" title="${TAG_DE[t] ?? t}">${esc(t)}</span>`).join(' ') || '–'} ${b.notes ? `<div class="skb-notes"><span class="skb-lang">Katalognotiz (engl.)</span><span lang="en">${esc(b.notes.slice(0, 420))}${b.notes.length > 420 ? ' …' : ''}</span></div>` : ''}</dd>
        <dt>Quellen</dt><dd>${(b.sources ?? []).map((x) => `<div>${esc(x)}</div>`).join('') || '–'}</dd>
      </dl>
      <div class="skb-id">${esc(b.id)} · ${esc(b.cls)}</div>`;
    info.querySelector('.skb-close')?.addEventListener('click', () => (info.style.display = 'none'));
  };

  // short attribution (the full credit line is burned into photos, photoMath.ts footerParts)
  const credit = footerParts(o.attribution);
  // ADR 0026: collapsed attribution; the full list opens on click / tap
  const attr = q<HTMLElement>('.skb-attr');
  q<HTMLElement>('.skb-attr summary').innerHTML = `${esc(credit[0])} · <b>${esc(credit[credit.length - 1])}</b> ▸`;
  q<HTMLElement>('.skb-credits').innerHTML = credit.map((c) => `<div>${esc(c)}</div>`).join('');
  attr.title = 'Quellen und Lizenzen';

  // ---------------------------------------------------------------- KB-I46 Rundflug overlay, KB-I47 photo toast
  const cine = q<HTMLElement>('.skb-cine');
  const bars = root.querySelectorAll<HTMLElement>('.skb-bar');
  const cut = q<HTMLElement>('.skb-cut');
  const cap = q<HTMLElement>('.skb-cap');
  const capT = q<HTMLElement>('.skb-cap-t');
  const capN = q<HTMLElement>('.skb-cap-n');
  const toastEl = q<HTMLElement>('.skb-toast');
  const statusEl = q<HTMLElement>('.skb-status');
  let view: [number, number] = [o.container.clientWidth || 1, o.container.clientHeight || 1];
  const layoutBars = () => {
    const bar = letterboxBar(view[0], view[1]);
    bars.forEach((b) => (b.style.height = `${bar.toFixed(0)}px`));
    cap.style.bottom = `${Math.max(30, bar - 58).toFixed(0)}px`;
  };
  /** Cinema mode: letterbox, caption and cut overlay on; the panel, info box and stats off. */
  const setCinema = (on: boolean) => {
    root.classList.toggle('skb-cinema', on);
    cine.style.display = on ? 'block' : 'none';
    cut.style.display = on ? 'block' : 'none';
    cap.style.display = on ? 'block' : 'none';
    if (on) {
      info.style.display = 'none';
      layoutBars();
    } else {
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
  const photoOptions = (): PhotoUiOptions => ({ scale: Number(q<HTMLSelectElement>('.skb-photo-scale').value) || 2, dof: q<HTMLInputElement>('.skb-photo-dof').checked });
  const setTourActive = (on: boolean) => {
    const b = q<HTMLButtonElement>('.skb-tour');
    b.classList.toggle('skb-on', on);
    b.textContent = on ? '■ Rundflug beenden' : '▶ Rundflug';
  };
  /** View size (CSS px): phone layout ≤ 600 px, letterbox. */
  const resize = (w: number, h: number) => {
    view = [w, h];
    const phone = w <= 600;
    if (phone && !root.classList.contains('skb-phone')) setFolded(true);
    if (!phone && root.classList.contains('skb-phone')) setFolded(false);
    root.classList.toggle('skb-phone', phone);
    layoutBars();
  };
  const coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
  const syncCoarse = () => root.classList.toggle('skb-coarse', !!coarse?.matches);
  syncCoarse();
  coarse?.addEventListener?.('change', syncCoarse);
  return {
    root,
    setMode,
    showInfo,
    sync,
    setStats: (t: string) => (stats.textContent = t),
    setCinema,
    setCaption,
    setTourActive,
    toast,
    photoOptions,
    resize,
    setTier: (t: ZoneTier) => (root.dataset.tier = t),
    setStatus: (t: string | null) => (statusEl.textContent = t ?? ''),
    dispose(): void {
      coarse?.removeEventListener?.('change', syncCoarse);
      root.remove();
      // the style stays while another castle HUD is mounted in the document
      if (!o.container.ownerDocument.querySelector('.skb-root')) o.container.ownerDocument.getElementById(STYLE_ID)?.remove();
    },
  };
}
