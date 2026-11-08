/**
 * 🏆 „Alle Ranglisten“: full view of the leaderboards. Wide screens: a non-modal panel *beside* the
 * open „Orte“ / „Werkzeuge“ drawer (it fills the rest of the view, so a picked place's card stays
 * visible next to the table and its row is highlighted); keys typed inside it never reach the flight
 * keys, Esc / U / ✕ close it and focus returns to the opener. Phones (≤ 600 px): full screen and modal
 * (focus trapped); picking a place closes it and opens the card in the „Orte“ sheet. Tabs:
 *  - Tabelle: places × disciplines, one line per cell (rank pill or medal + value with one number of
 *    decimals per column + a thin bar), sticky head and place column, sortable, Alle / Städte / Dörfer;
 *  - Medaillenspiegel: olympic medal count, no weighted total (ADR 0050);
 *  - Vergleichen: 2–3 places side by side with bars, the difference in words and „So kommt … nach oben“.
 * S1 (ADR 0051): with several levels a switch Gemeinden / Ortsteile on every tab; one level at a time
 * (the panel loads the other level and hands it in with `setData`), never mixed in one ranking.
 * Pure logic: compare.ts. Wired from PlacesPanel.ts (board buttons, 🏆 map button, key U, place card).
 */
import { el, ICONS } from '../shell/dom';
import { copyText } from '../ui/clipboard';
import { isTyping } from '../ui/keys';
import { isolateModalKeys } from '../ui/modalKeys';
import {
  barFraction,
  buildMatrix,
  categoryOptions,
  dativePlural,
  climbFor,
  columnDecimals,
  columnHead,
  fmtFixed,
  headToHead,
  medalDisciplines,
  medalTable,
  panelLeft,
  sortRows,
  withCompareParam,
} from './compare';
import type { CategoryFilter, Cell, ClimbSummary, Matrix } from './compare';
import { ORTSPATE_URL, fmtValue, otherFlight, otherFlightNote, pendingText, placeTitle } from './placesData';
import type { Discipline, Goal, Place, PlacesData, StatsLevel } from './placesData';

export type OverlayTab = 'tabelle' | 'medaillen' | 'vergleich';

export interface OverlayDeps {
  data: PlacesData;
  /** Layer the view is mounted in (the feature's overlay layer inside the shell). */
  host: HTMLElement;
  /** The drawers the wide view sits beside (hidden ones are ignored). */
  drawers: () => HTMLElement[];
  /** Open the place's card in the panel (and fly there). `modal`: the view was closed first (phones). */
  onPick: (p: Place, modal: boolean) => void;
  /** The place currently selected in the panel (row highlight). */
  selectedId: () => string | null;
  onClose?: () => void;
  /** S1: the levels of the switch (≥ 2), display order; absent → no switch. */
  levels?: Array<{ level: StatsLevel; label_de: string }>;
  /** The user picked another level: the panel loads it and calls `setData` (or keeps the old one). */
  onLevel?: (level: StatsLevel) => void;
}

export interface LeaderboardHandle {
  readonly root: HTMLElement;
  isOpen(): boolean;
  close(): void;
  /** Switch tab / comparison of the open view. */
  show(o: OverlayOptions): void;
  /** The panel's selection changed: move the row highlight. */
  setSelected(id: string | null): void;
  /** Another level's data (level switch): filter, sort and comparison start fresh. */
  setData(data: PlacesData, o?: OverlayOptions): void;
}

export interface OverlayOptions {
  tab?: OverlayTab;
  /** 2–3 place ids for „Vergleichen“. */
  compare?: string[];
  /** Initial sort column (discipline id). */
  sortBy?: string | null;
}

const MEDALS = ['🥇', '🥈', '🥉'];
const rankText = (rank: number) => MEDALS[rank - 1] ?? `${rank}.`;
const dName = (d: Discipline) => `${d.emoji ?? '🏅'} ${d.name_de}`;
const ARTEN_NOTE = 'Artenvielfalt ist nur ein grober Hinweis: der Wert hängt davon ab, wer wo beobachtet und meldet.';

/** „So kommt <Ort> nach oben“ list (overlay compare tab and the place card). null: nothing to show. */
export function climbList(data: PlacesData, place: Place, onGoal?: (g: Goal) => void): HTMLElement | null {
  const s = climbFor(data, buildMatrix(data), place.id);
  if (!s) return null;
  return renderClimb(s, onGoal);
}

/** Summary line of a place's climb list („2× vorn · 4 mit Luft nach oben“). */
export function climbSummaryText(data: PlacesData, place: Place): string | null {
  const s = climbFor(data, buildMatrix(data), place.id);
  if (!s || (!s.leads.length && !s.climbs.length)) return null;
  const parts: string[] = [];
  if (s.leads.length) parts.push(`${s.leads.length}× vorn`);
  if (s.climbs.length) parts.push(`${s.climbs.length}× Luft nach oben`);
  return parts.join(' · ');
}

function renderClimb(s: ClimbSummary, onGoal?: (g: Goal) => void): HTMLElement {
  const root = el('div', { class: 'sle-cmpx-climb' });
  if (s.leads.length) root.append(el('p', { class: 'sle-cmpx-leads' }, '🥇 Schon vorn: ', s.leads.map(dName).join(', ')));
  if (!s.climbs.length && !s.leads.length) root.append(el('p', { class: 'sle-dim sle-small', text: 'Noch keine Rangplätze.' }));
  const ul = el('ul', { class: 'sle-cmpx-climbs' });
  for (const c of s.climbs) {
    const li = el(
      'li',
      {},
      el('div', { class: 'sle-cmpx-climb-head' }, el('span', { text: dName(c.discipline) }), el('span', { class: 'sle-cmpx-climb-rank', text: `Platz ${c.rank} von ${c.of}` })),
      el('div', { class: 'sle-small', text: c.gapText }),
      c.action ? el('div', { class: 'sle-cmpx-action', text: `→ ${c.action}` }) : null,
      c.hint ? el('div', { class: 'sle-cmpx-hint sle-small', text: c.hint }) : null,
      c.flightNote ? el('div', { class: 'sle-cmpx-flight sle-small', text: c.flightNote }) : null,
    );
    if (c.goal) {
      const g = c.goal;
      if (onGoal) {
        const b = el('button', { type: 'button', class: 'sle-cmpx-goal', text: `🎯 Passendes Ziel: ${g.title_de}`, title: 'Ziel in der Karte des Orts ansehen' });
        b.addEventListener('click', () => onGoal(g));
        li.append(b);
      } else li.append(el('div', { class: 'sle-cmpx-goal-txt sle-small', text: `🎯 Passendes Ziel: ${g.title_de}` }));
    }
    ul.append(li);
  }
  if (s.climbs.length) root.append(ul);
  if (s.unranked.length) {
    root.append(el('p', { class: 'sle-dim sle-small', text: `Ohne Rang: ${s.unranked.map((u) => `${dName(u.discipline)} (${u.reason})`).join(', ')}.` }));
  }
  root.append(
    el('p', {
      class: 'sle-cmpx-fine sle-small',
      text:
        s.place.kind === 'gemeinde'
          ? 'Abstand zum nächstbesseren Platz, grob umgerechnet auf die ganze Gemeinde – keine einzelnen Grundstücke oder Gebäude. Gemessen wird erst mit der nächsten Befliegung oder Karte.'
          : 'Abstand zum nächstbesseren Platz, grob umgerechnet auf die ganze Gemarkung (bei ☀️ die Gemeinde) – keine einzelnen Grundstücke oder Gebäude. Gemessen wird erst mit der nächsten Befliegung.',
    }),
  );
  return root;
}

export function openLeaderboard(deps: OverlayDeps, opts: OverlayOptions = {}): LeaderboardHandle {
  let data = deps.data;
  let tab: OverlayTab = opts.tab ?? 'tabelle';
  let filter: CategoryFilter = 'alle';
  let sortBy: string | null = opts.sortBy ?? null;
  let selected = deps.selectedId();
  const sortedByName = () => [...data.places].sort((a, b) => a.name_de.localeCompare(b.name_de, 'de'));
  let byName = sortedByName();
  const gemeindeLevel = () => data.level === 'gemeinde';
  /** „Ort“ / „Gemeinde“ in pickers and headings. */
  const unitWord = () => (gemeindeLevel() ? 'Gemeinde' : 'Ort');
  const pickIds = (want: readonly string[] | undefined) => {
    let out = (want ?? []).filter((id) => data.places.some((p) => p.id === id)).slice(0, 3);
    if (out.length < 2) out = [...new Set([...out, ...byName.map((p) => p.id)])].slice(0, 2);
    return out;
  };
  let ids = pickIds(opts.compare);

  const modal = window.matchMedia?.('(max-width: 600px)').matches ?? false;
  const opener = document.activeElement as HTMLElement | null;
  const titleId = 'sle-cmpx-title';
  const closeBtn = el('button', { type: 'button', class: 'sle-dlg-close', 'aria-label': 'Alle Ranglisten schließen', title: 'Schließen (Esc)', html: ICONS.close });
  const tabs = el('div', { class: 'sle-seg sle-cmpx-tabs', role: 'group', 'aria-label': 'Ansicht' });
  const view = el('div', { class: 'sle-cmpx-view' });
  const body = el(
    'section',
    {
      id: 'sle-cmp-full',
      class: `sle-cmpx-panel${modal ? ' modal' : ''}`,
      role: 'dialog',
      'aria-modal': String(modal),
      'aria-labelledby': titleId,
      tabindex: '-1',
    },
    el('header', { class: 'sle-cmpx-head' }, el('h2', { id: titleId, text: '🏆 Alle Ranglisten' }), tabs, closeBtn),
    view,
  );
  let open = true;

  const pick = (p: Place) => {
    if (modal) {
      close();
      deps.onPick(p, true);
      return;
    }
    deps.onPick(p, false);
    setSelected(p.id);
  };

  const seg = <T extends string>(label: string, items: Array<[T, string]>, current: T, set: (v: T) => void) => {
    const g = el('div', { class: 'sle-seg sle-cmpx-seg', role: 'group', 'aria-label': label });
    for (const [v, text] of items) {
      const b = el('button', { type: 'button', class: v === current ? 'on' : '', 'aria-pressed': String(v === current), text, 'data-k': `${label}:${v}` });
      b.addEventListener('click', () => set(v));
      g.append(b);
    }
    return g;
  };

  /** S1: level switch (Gemeinden / Ortsteile) on every tab; the panel loads the level. */
  const levelRow = () => {
    const lv = deps.levels;
    if (!lv || lv.length < 2) return null;
    return el(
      'div',
      { class: 'sle-cmpx-tools sle-cmpx-levels' },
      seg<StatsLevel>('Ebene', lv.map((l) => [l.level, l.label_de]), data.level, (v) => {
        if (v !== data.level) deps.onLevel?.(v);
      }),
      el('span', { class: 'sle-dim sle-small', text: gemeindeLevel() ? 'Gemeinden mit Gemeinden verglichen' : 'Ortsteile mit Ortsteilen verglichen' }),
    );
  };

  const filterRow = () => {
    const opts = categoryOptions(data);
    const label = opts.find(([k]) => k === filter)?.[1] ?? filter;
    return el(
      'div',
      { class: 'sle-cmpx-tools' },
      seg<CategoryFilter>('Größenklasse', opts, filter, (v) => {
        filter = v;
        render();
      }),
      filter !== 'alle' ? el('span', { class: 'sle-dim sle-small', text: `Ränge nur unter den ${dativePlural(label)}` }) : null,
    );
  };

  /** Disciplines still being computed on this level: one line, no column and no ranking. */
  const pendingRow = (m: Matrix) =>
    m.pending.length
      ? el('p', { class: 'sle-cmpx-pending sle-small', role: 'note' }, `⏳ ${m.pending.map(dName).join(', ')}: ${pendingText(data)} – noch ohne Rangliste.`)
      : null;

  /** Status marker of a Gemeinde (S1): 🙋 Ortspate gesucht (link to the org) / 🏗 3D im Aufbau. */
  const statusTag = (p: Place) => {
    if (p.status === 'stats') {
      const t = `Ortspate gesucht: ${p.name_de} hat noch kein 3D-Modell – mitmachen bei Open-Kirrberg auf GitHub`;
      return el('a', { class: 'sle-cmpx-tag pate', href: ORTSPATE_URL, target: '_blank', rel: 'noopener noreferrer', title: t, 'aria-label': t, text: '🙋' });
    }
    if (p.status === 'building') return el('span', { class: 'sle-cmpx-tag build', title: '3D im Aufbau', 'aria-label': '3D im Aufbau', text: '🏗' });
    return null;
  };

  const placeBtn = (p: Place) => {
    const b = el('button', { type: 'button', class: 'sle-cmpx-place', title: `${placeTitle(p)}: Karte öffnen und hinfliegen` }, p.name_de);
    b.addEventListener('click', () => pick(p));
    return b;
  };

  const flightTag = (p: Place) => {
    if (!p.flags.includes('other-flight')) return null;
    const { year } = otherFlight(p);
    const note = `andere Befliegung: ${otherFlightNote(p, data.rlpTreeRatio)}`;
    return el('span', { class: 'sle-cmpx-tag flight', text: `✈ ${year ?? ''}`.trim(), title: note, 'aria-label': note });
  };

  // ---- Tabelle -----------------------------------------------------------------------------------
  const cellEl = (d: Discipline, c: Cell | undefined, digits: number, ext: Matrix['extent'][string] | undefined) => {
    const td = el('td', {});
    if (!c) return td;
    if (d.scope === 'municipality' && !gemeindeLevel()) td.classList.add('mun');
    const val = el('span', { class: 'sle-cmpx-v', text: fmtFixed(c.value, digits) });
    if (c.rank !== null) {
      const rk = el('span', { class: `sle-cmpx-rk${c.rank <= 3 ? ` m m${c.rank}` : ''}`, text: c.rank <= 3 ? MEDALS[c.rank - 1] : String(c.rank), 'aria-label': `Platz ${c.rank} von ${c.of}:` });
      if (c.rank <= 3) td.classList.add(`r${c.rank}`);
      td.append(el('span', { class: 'sle-cmpx-cell' }, rk, val));
      const f = barFraction(d, c.value, ext);
      if (f !== null) {
        const bar = el('span', { class: 'sle-cmpx-cbar', 'aria-hidden': 'true' });
        bar.style.width = `${Math.max(3, f * 100)}%`;
        td.append(bar);
      }
      td.title = `${d.name_de}: ${fmtValue(c.value, d.unit)}, Platz ${c.rank} von ${c.of}${d.scope === 'municipality' && c.municipality && !gemeindeLevel() ? ` (Gemeinde ${c.municipality.name_de}, gilt für alle ihre Gemarkungen)` : ''}`;
    } else {
      td.classList.add('unranked');
      td.title = `${d.name_de}: ohne Rang – ${c.reason ?? 'keine Daten'}`;
      td.append(el('span', { class: 'sle-cmpx-cell' }, el('span', { class: 'sle-cmpx-rk none', text: '–', 'aria-label': `ohne Rang (${c.reason ?? 'keine Daten'}):` }), val));
    }
    return td;
  };

  const renderTable = (m: Matrix) => {
    const head = el('tr', {});
    const nameTh = el('th', { scope: 'col', class: `sticky${sortBy ? '' : ' on'}`, 'aria-sort': sortBy ? 'none' : 'ascending' });
    const nameBtn = el('button', { type: 'button', class: 'sle-cmpx-sort', title: 'Nach Namen sortieren', 'data-k': 'sort:' }, el('span', { class: 'sle-cmpx-h1', text: `${unitWord()}${sortBy ? '' : ' ▾'}` }), el('span', { class: 'sle-cmpx-h2', text: 'A–Z' }));
    nameBtn.addEventListener('click', () => {
      sortBy = null;
      render();
    });
    nameTh.append(nameBtn);
    head.append(nameTh);
    const digits: Record<string, number> = {};
    for (const d of m.disciplines) {
      digits[d.id] = columnDecimals(m.rows.map((r) => r.cells[d.id]?.value ?? null));
      const on = sortBy === d.id;
      const h = columnHead(d, data.level);
      const th = el('th', { scope: 'col', 'aria-sort': on ? 'ascending' : 'none', class: `${on ? 'on' : ''}${d.scope === 'municipality' && !gemeindeLevel() ? ' mun' : ''}`.trim() || undefined });
      const b = el(
        'button',
        { type: 'button', class: 'sle-cmpx-sort', title: `${d.name_de} (${d.unit}): ${d.description_de}${d.note_de ? ` – ${d.note_de}` : ''} · antippen: nach Rang sortieren`, 'data-k': `sort:${d.id}` },
        el('span', { class: 'sle-cmpx-h1' }, el('span', { 'aria-hidden': 'true', text: `${d.emoji ?? '🏅'} ` }), h.short, on ? el('span', { class: 'sle-cmpx-arrow', 'aria-hidden': 'true', text: ' ▾' }) : null),
        el('span', { class: 'sle-cmpx-h2', text: h.sub }),
        ...h.notes.map((n) => el('span', { class: 'sle-cmpx-h2 note', text: n })),
        el('span', { class: 'sle-sr', text: d.name_de }),
      );
      b.addEventListener('click', () => {
        sortBy = d.id;
        render();
      });
      th.append(b);
      head.append(th);
    }
    const tbody = el('tbody', {});
    for (const r of sortRows(m, sortBy)) {
      const p = r.place;
      const tags = [p.category === 'stadt' ? 'Stadt' : p.category === 'dorf' ? 'Dorf' : null, p.complete ? null : 'unvollständig'].filter(Boolean).join(' · ');
      const ft = flightTag(p);
      const st = statusTag(p);
      const th = el(
        'th',
        { scope: 'row', class: 'sticky' },
        placeBtn(p),
        tags || ft || st ? el('span', { class: 'sle-cmpx-ptags' }, tags, ft ? ' ' : null, ft, st ? ' ' : null, st) : null,
      );
      const tr = el('tr', { 'data-id': p.id, class: p.id === selected ? 'sel' : undefined }, th);
      for (const d of m.disciplines) tr.append(cellEl(d, r.cells[d.id], digits[d.id], m.extent[d.id]));
      tbody.append(tr);
    }
    const table = el(
      'table',
      { class: 'sle-cmpx-table' },
      el('caption', { class: 'sle-sr', text: `Alle Ranglisten (${gemeindeLevel() ? 'Gemeinden' : 'Ortsteile'}, ${categoryOptions(data).find(([k]) => k === filter)?.[1] ?? filter}): Platz und Wert je Disziplin; Einheiten im Spaltenkopf` }),
      el('thead', {}, head),
      tbody,
    );
    const scroll = el('div', { class: 'sle-cmpx-scroll', role: 'region', 'aria-label': 'Tabelle, in beide Richtungen scrollbar', tabindex: '0' }, table);
    // Reasons for „–“ as text (tooltips do not work on touch screens).
    const reasons = new Map<string, string[]>();
    for (const r of m.rows) {
      for (const d of m.disciplines) {
        const c = r.cells[d.id];
        if (!c || c.rank !== null) continue;
        const k = `${dName(d)}: ${c.reason ?? 'keine Daten'}`;
        reasons.set(k, [...(reasons.get(k) ?? []), r.place.name_de]);
      }
    }
    const legend = el(
      'details',
      { class: 'sle-cmpx-legend sle-small' },
      el('summary', { text: `Erklärung${reasons.size ? ' und Orte ohne Rang' : ''}` }),
      el(
        'ul',
        { class: 'sle-cmpx-notes' },
        el('li', { text: '🥇🥈🥉 / Zahl = Platz, daneben der Wert (Einheit im Spaltenkopf). Der dünne Balken zeigt, wo der Wert zwischen schlechtestem und bestem Ort liegt – länger ist besser. Gleiche Werte teilen sich den Platz.' }),
        el('li', { text: 'Spaltenkopf antippen: nach dieser Disziplin sortieren. Ortsname antippen: Karte des Orts öffnen und hinfliegen.' }),
        ...[...reasons].map(([k, names]) => el('li', { text: `„–“ ${k} – ${names.length > 12 ? `${names.slice(0, 12).join(', ')} und ${names.length - 12} weitere` : names.join(', ')}` })),
        m.disciplines.some((d) => d.scope === 'municipality') && !gemeindeLevel()
          ? el('li', { text: '☀️ Sonne ist ein Gemeindewert (Marktstammdatenregister nur pro Gemeinde): Gemarkungen einer Gemeinde teilen sich Wert und Platz; die Spalte ist leicht getönt.' })
          : null,
        data.places.some((p) => p.status === 'stats')
          ? el('li', {}, '🙋 = Ortspate gesucht: noch kein 3D-Modell. Wer seine Gemeinde in 3D bringen möchte, startet bei ', el('a', { href: ORTSPATE_URL, target: '_blank', rel: 'noopener noreferrer', text: 'Open-Kirrberg auf GitHub' }), '. 🏗 = 3D im Aufbau.')
          : null,
        data.places.some((p) => p.flags.includes('other-flight')) ? el('li', { text: `✈ = andere Befliegung (RLP 2022)${data.rlpTreeRatio && data.rlpTreeRatio > 1 ? `: dort ≈ ${Math.round((data.rlpTreeRatio - 1) * 100)} % mehr Bäume gezählt` : ''}.` }) : null,
      ),
    );
    return [levelRow(), filterRow(), pendingRow(m), scroll, legend];
  };

  // ---- Medaillenspiegel ----------------------------------------------------------------------------
  const renderMedals = (m: Matrix) => {
    const rows = medalTable(m);
    const ds = medalDisciplines(m);
    const ol = el('ol', { class: 'sle-cmpx-medals' });
    for (const r of rows) {
      const won = el('span', { class: 'sle-cmpx-won' });
      for (const w of r.won) won.append(el('span', { class: 'sle-cmpx-won-i', title: `${MEDALS[w.rank - 1]} ${w.discipline.name_de}`, text: `${MEDALS[w.rank - 1]}${w.discipline.emoji ?? ''}` }));
      ol.append(
        el(
          'li',
          { class: `${r.gold ? 'gold' : ''}${r.place.id === selected ? ' sel' : ''}`.trim() || undefined, 'data-id': r.place.id },
          el('span', { class: 'sle-cmpx-pos', text: `${r.position}.` }),
          el('span', { class: 'sle-cmpx-medal-name' }, placeBtn(r.place), flightTag(r.place), r.won.length ? won : el('span', { class: 'sle-dim sle-small', text: 'noch keine Medaille' })),
          el(
            'span',
            { class: 'sle-cmpx-count', 'aria-label': `${r.gold} Gold, ${r.silver} Silber, ${r.bronze} Bronze` },
            el('span', { 'aria-hidden': 'true', text: `🥇 ${r.gold}` }),
            el('span', { 'aria-hidden': 'true', text: `🥈 ${r.silver}` }),
            el('span', { 'aria-hidden': 'true', text: `🥉 ${r.bronze}` }),
          ),
        ),
      );
    }
    const arten = ds.find((d) => d.note_de);
    return [
      levelRow(),
      filterRow(),
      pendingRow(m),
      el('p', { class: 'sle-cmpx-why', text: 'Keine Gesamtpunktzahl: Jede Gewichtung der Disziplinen wäre willkürlich (zählt Beton doppelt so viel wie Bäume?). Deshalb zählen wir Medaillen wie bei Olympia – erst Gold, dann Silber, dann Bronze.' }),
      ol,
      el(
        'ul',
        { class: 'sle-cmpx-notes sle-small' },
        el('li', { text: `Gezählt: ${ds.map(dName).join(', ')}. Gleiche Werte teilen sich die Medaille; unvollständige Orte und Orte ohne Daten bekommen dort keine.` }),
        m.disciplines.some((d) => d.scope === 'municipality')
          ? el('li', {
              text: gemeindeLevel()
                ? `${m.disciplines.filter((d) => d.scope === 'municipality').map(dName).join(', ')} zählt nicht mit: Werte aus dem Marktstammdatenregister bleiben wie bei den Ortsteilen außerhalb des Medaillenspiegels.`
                : '☀️ Sonnenstärkster Ort zählt nicht mit: ein Gemeindewert, den sich mehrere Gemarkungen teilen.',
            })
          : null,
        arten ? el('li', { text: `${dName(arten)} zählt mit, ist aber nur ein grober Hinweis – der Wert hängt davon ab, wer wo beobachtet und meldet. Orte mit zu wenigen Meldungen bekommen dort keine Medaille.` }) : null,
      ),
    ];
  };

  // ---- Vergleichen ------------------------------------------------------------------------------------
  const linkStatus = el('span', { class: 'sle-cmpx-status sle-small', role: 'status', 'aria-live': 'polite' });

  const renderCompare = () => {
    const m = buildMatrix(data); // all places: the panel's ranks
    const pickers = el('div', { class: 'sle-cmpx-pickers' });
    for (let slot = 0; slot < 3; slot++) {
      const sel = el('select', { 'aria-label': `${unitWord()} ${slot + 1}`, 'data-k': `sel:${slot}` });
      if (slot === 2) sel.append(el('option', { value: '', text: gemeindeLevel() ? '– keine dritte Gemeinde –' : '– kein dritter Ort –' }));
      for (const p of byName) sel.append(el('option', { value: p.id, text: p.name_de }));
      sel.value = ids[slot] ?? '';
      sel.addEventListener('change', () => {
        const v = sel.value;
        const next = [...ids];
        const other = next.indexOf(v);
        if (v && other >= 0 && other !== slot) next[other] = ids[slot] ?? ''; // picked twice: swap
        next[slot] = v;
        ids = next.filter((x, i) => !!x && next.indexOf(x) === i);
        if (ids.length < 2) ids = [...new Set([...ids, ...byName.map((p) => p.id)])].slice(0, 2);
        render();
      });
      pickers.append(el('label', { class: 'sle-cmpx-picker' }, el('span', { class: 'sle-small sle-dim', text: `${unitWord()} ${slot + 1}` }), sel));
    }
    const duels = headToHead(m, ids, data.rlpTreeRatio);
    const list = el('div', { class: 'sle-cmpx-duels' });
    for (const duel of duels) {
      const d = duel.discipline;
      const sec = el(
        'section',
        { class: 'sle-cmpx-duel' },
        el('h3', {}, dName(d), d.scope === 'municipality' && !gemeindeLevel() ? el('span', { class: 'sle-cmpx-sub', text: ' Gemeindewert' }) : null, d.note_de ? el('span', { class: 'sle-cmpx-sub', text: ' grober Hinweis' }) : null),
      );
      for (const e of duel.entries) {
        const bar = el('span', { class: 'sle-cmpx-bar', 'aria-hidden': 'true' });
        if (e.bar !== null) {
          const fill = el('span', { class: `sle-cmpx-fill${e.best ? ' best' : ''}` });
          fill.style.width = `${Math.max(4, e.bar * 100)}%`;
          bar.append(fill);
        }
        const val = e.cell.value === null ? '–' : fmtValue(e.cell.value, d.unit);
        sec.append(
          el(
            'div',
            { class: `sle-cmpx-duel-row${e.best ? ' best' : ''}${e.cell.rank === null ? ' unranked' : ''}` },
            el('span', { class: 'sle-cmpx-duel-name' }, e.best ? el('span', { class: 'sle-cmpx-star', text: '★ ', 'aria-label': 'vorn: ' }) : null, e.place.name_de),
            el(
              'span',
              { class: 'sle-cmpx-duel-val' },
              e.cell.rank !== null ? el('span', { class: 'sle-cmpx-duel-rank', text: rankText(e.cell.rank), 'aria-label': `Platz ${e.cell.rank} von ${e.cell.of}` }) : null,
              val,
            ),
            bar,
            e.cell.rank === null ? el('span', { class: 'sle-cmpx-duel-why', text: `ohne Rang: ${e.cell.reason ?? 'keine Daten'}` }) : null,
          ),
        );
      }
      sec.append(el('p', { class: 'sle-cmpx-diff sle-small', text: duel.text }));
      if (duel.flightNote) sec.append(el('p', { class: 'sle-cmpx-flight sle-small', text: duel.flightNote }));
      list.append(sec);
    }
    const climbs = el('div', { class: 'sle-cmpx-climbs-wrap' });
    for (const id of ids) {
      const p = data.places.find((x) => x.id === id);
      const s = p ? climbFor(data, m, id) : null;
      if (!p || !s) continue;
      const det = el('details', { class: 'sle-cmpx-climb-sec' }, el('summary', { text: `🚀 So kommt ${p.name_de} nach oben` }), renderClimb(s));
      (det as HTMLDetailsElement).open = ids.length <= 2 || id === ids[0];
      climbs.append(det);
    }
    const copy = el('button', { type: 'button', class: 'sle-btn', text: '🔗 Link zu diesem Vergleich kopieren' });
    copy.addEventListener('click', () => {
      // With levels the link names its level (`ebene=`), so it opens the same board later.
      const url = `${location.origin}${location.pathname}${withCompareParam(location.search, ids, deps.levels && deps.levels.length > 1 ? data.level : null)}${location.hash}`;
      void copyText(url).then((ok) => {
        linkStatus.textContent = ok ? 'Link kopiert.' : `Kopieren nicht möglich: ${url}`;
      });
    });
    return [
      levelRow(),
      pickers,
      el('p', { class: 'sle-dim sle-small', text: `Balken: von schlechtestem bis bestem ${gemeindeLevel() ? 'Wert aller Gemeinden' : 'Ort der ganzen Rangliste'} – länger ist besser${gemeindeLevel() ? '' : ' (auch bei „Wenigsten Beton“)'}. ★ = vorn in diesem Vergleich.` }),
      pendingRow(m),
      list,
      climbs,
      el('div', { class: 'sle-cmpx-actions' }, copy, linkStatus),
      el('p', { class: 'sle-cmpx-fine sle-small', text: ARTEN_NOTE }),
    ];
  };

  // ---- tabs ------------------------------------------------------------------------------------------
  const TABS: Array<[OverlayTab, string]> = [
    ['tabelle', '📋 Tabelle'],
    ['medaillen', '🏅 Medaillen'],
    ['vergleich', '⚖️ Vergleichen'],
  ];
  const render = () => {
    const keep = document.activeElement instanceof HTMLElement && body.contains(document.activeElement) ? focusKey(document.activeElement) : null;
    tabs.replaceChildren();
    for (const [id, text] of TABS) {
      const b = el('button', { type: 'button', class: id === tab ? 'on' : '', 'aria-pressed': String(id === tab), text, 'data-k': `tab:${id}`, title: id === 'medaillen' ? 'Medaillenspiegel' : undefined });
      b.addEventListener('click', () => {
        tab = id;
        render();
      });
      tabs.append(b);
    }
    const m = tab === 'vergleich' ? null : buildMatrix(data, filter);
    const parts: Array<Node | null> = tab === 'tabelle' ? renderTable(m!) : tab === 'medaillen' ? renderMedals(m!) : renderCompare();
    view.replaceChildren(...parts.filter((n): n is Node => !!n));
    view.dataset.tab = tab;
    // Re-rendering replaces the buttons: keep keyboard focus on the same control.
    if (keep) body.querySelector<HTMLElement>(`[data-k="${keep}"]`)?.focus({ preventScroll: true });
  };

  function setSelected(id: string | null): void {
    selected = id;
    for (const r of body.querySelectorAll<HTMLElement>('[data-id]')) r.classList.toggle('sel', r.dataset.id === id);
  }

  // ---- layout: beside the open drawer (wide screens) -------------------------------------------------------
  const layout = () => {
    if (!open || modal) return;
    const gap = parseFloat(getComputedStyle(body).getPropertyValue('--gap')) || 12;
    const rects = deps
      .drawers()
      .filter((d) => !d.hidden && d.offsetParent !== null)
      .map((d) => d.getBoundingClientRect());
    body.style.left = `${panelLeft(rects, window.innerWidth, gap)}px`;
  };
  const mo = new MutationObserver(layout);
  for (const d of deps.drawers()) mo.observe(d, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(layout) : null;
  for (const d of deps.drawers()) ro?.observe(d);
  window.addEventListener('resize', layout);

  // ---- keys + close ------------------------------------------------------------------------------------------
  const closeKey = (e: KeyboardEvent) =>
    e.key === 'Escape' || (e.code === 'KeyU' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target));
  let uninstallKeys: (() => void) | null = null;
  const onPanelKey = (e: KeyboardEvent) => {
    if (closeKey(e)) {
      e.preventDefault();
      close();
    }
    e.stopPropagation(); // typing inside the view never flies the drone or switches layers
  };
  if (modal) {
    uninstallKeys = isolateModalKeys(body, (e) => {
      if (!closeKey(e)) return false;
      close();
      return true;
    });
  } else body.addEventListener('keydown', onPanelKey);

  function close(): void {
    if (!open) return;
    open = false;
    uninstallKeys?.();
    body.removeEventListener('keydown', onPanelKey);
    mo.disconnect();
    ro?.disconnect();
    window.removeEventListener('resize', layout);
    body.remove();
    deps.onClose?.();
    if (opener?.isConnected && opener.offsetParent !== null) opener.focus({ preventScroll: true });
  }
  closeBtn.addEventListener('click', close);

  render();
  deps.host.append(body);
  layout();
  body.focus({ preventScroll: true });

  return {
    root: body,
    isOpen: () => open,
    close,
    setSelected,
    setData(next: PlacesData, o: OverlayOptions = {}) {
      data = next;
      byName = sortedByName();
      filter = 'alle';
      sortBy = o.sortBy !== undefined ? o.sortBy : sortBy && data.disciplines.some((d) => d.id === sortBy) ? sortBy : null;
      ids = pickIds(o.compare);
      if (o.tab) tab = o.tab;
      selected = deps.selectedId();
      render();
    },
    show(o: OverlayOptions) {
      if (o.tab) tab = o.tab;
      if (o.compare) ids = pickIds(o.compare);
      if (o.sortBy !== undefined && o.tab === 'tabelle') sortBy = o.sortBy;
      render();
      body.focus({ preventScroll: true });
    },
  };
}

/** The stable key (`data-k`) of a control across re-renders (tabs, filter, sort buttons, selects), or null. */
function focusKey(e: Element): string | null {
  return e.getAttribute('data-k');
}
