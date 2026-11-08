/**
 * 🏆 „Alle Ranglisten“: full view of the leaderboards (shell dialog: Esc / ✕ closes, focus trapped and
 * restored, full screen on phones). Tabs:
 *  - Tabelle: places × disciplines (value + rank, „–“ with the reason), sortable columns, Alle / Städte /
 *    Dörfer (ranks within the filter), sticky place column, the table scrolls sideways inside its box;
 *  - Medaillenspiegel: olympic medal count, no weighted total (ADR 0050);
 *  - Vergleichen: 2–3 places side by side with bars, the difference in words and „So kommt … nach oben“.
 * Pure logic: compare.ts. Wired from PlacesPanel.ts (buttons in the board, the place card section).
 */
import { el } from '../shell/dom';
import type { DialogHandle, DialogOptions } from '../shell/dialog';
import { copyText } from '../ui/clipboard';
import {
  CATEGORY_LABELS,
  buildMatrix,
  climbFor,
  headToHead,
  medalDisciplines,
  medalTable,
  sortRows,
  withCompareParam,
} from './compare';
import type { CategoryFilter, Cell, ClimbSummary, Matrix } from './compare';
import { fmtNum, fmtValue, otherFlight, otherFlightNote } from './placesData';
import type { Discipline, Goal, Place, PlacesData } from './placesData';

export type OverlayTab = 'tabelle' | 'medaillen' | 'vergleich';

export interface OverlayDeps {
  data: PlacesData;
  openDialog: (o: DialogOptions) => DialogHandle;
  /** Open the place's card in the panel (and fly there); the overlay is closed first. */
  onPick: (p: Place) => void;
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
/** Short units stay in the table cells („45,1 %“, „47,9 m“); longer ones go to the column head. */
const unitInCell = (unit: string) => unit.length <= 2;
const cellValue = (v: number | null, unit: string) => (v === null ? '–' : unitInCell(unit) ? fmtValue(v, unit) : fmtNum(v));
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
      text: 'Abstand zum nächstbesseren Platz, grob umgerechnet auf die ganze Gemarkung (bei ☀️ die Gemeinde) – keine einzelnen Grundstücke oder Gebäude. Gemessen wird erst mit der nächsten Befliegung.',
    }),
  );
  return root;
}

export function openLeaderboard(deps: OverlayDeps, opts: OverlayOptions = {}): DialogHandle {
  const { data } = deps;
  let tab: OverlayTab = opts.tab ?? 'tabelle';
  let filter: CategoryFilter = 'alle';
  let sortBy: string | null = opts.sortBy ?? null;
  const byName = [...data.places].sort((a, b) => a.name_de.localeCompare(b.name_de, 'de'));
  let ids: string[] = (opts.compare ?? []).filter((id) => data.places.some((p) => p.id === id)).slice(0, 3);
  if (ids.length < 2) ids = [...new Set([...ids, ...byName.map((p) => p.id)])].slice(0, 2);

  const body = el('div', { class: 'sle-cmpx' });
  const tabs = el('div', { class: 'sle-seg sle-cmpx-tabs', role: 'group', 'aria-label': 'Ansicht' });
  const view = el('div', { class: 'sle-cmpx-view' });
  body.append(tabs, view);
  let dlg: DialogHandle | null = null;

  const pick = (p: Place) => {
    dlg?.close();
    deps.onPick(p);
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

  const filterRow = () =>
    el(
      'div',
      { class: 'sle-cmpx-tools' },
      seg<CategoryFilter>('Größenklasse', (['alle', 'stadt', 'dorf'] as const).map((k) => [k, CATEGORY_LABELS[k]]), filter, (v) => {
        filter = v;
        render();
      }),
      filter !== 'alle' ? el('span', { class: 'sle-dim sle-small', text: `Ränge nur unter den ${CATEGORY_LABELS[filter]}n` }) : null,
    );

  const placeBtn = (p: Place) => {
    const b = el('button', { type: 'button', class: 'sle-cmpx-place', title: `Gemarkung ${p.name_de}: Karte öffnen und hinfliegen` }, p.name_de);
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
  const cellEl = (d: Discipline, c: Cell | undefined) => {
    const td = el('td', {});
    if (!c) return td;
    const mun = d.scope === 'municipality' && c.municipality ? `Gemeinde ${c.municipality.name_de} (gilt für alle ihre Gemarkungen)` : '';
    if (c.rank !== null) {
      td.append(el('span', { class: 'sle-cmpx-v', text: cellValue(c.value, d.unit) }), el('span', { class: 'sle-cmpx-r', text: rankText(c.rank), 'aria-label': `Platz ${c.rank} von ${c.of}` }));
      if (c.rank === 1) td.classList.add('first');
      if (mun) td.title = mun;
    } else {
      td.classList.add('unranked');
      td.title = `ohne Rang: ${c.reason ?? 'keine Daten'}`;
      td.append(
        el('span', { class: 'sle-cmpx-v', text: cellValue(c.value, d.unit) }),
        el('span', { class: 'sle-cmpx-r', text: '–', 'aria-hidden': 'true' }),
        el('span', { class: 'sle-sr', text: `ohne Rang: ${c.reason ?? 'keine Daten'}` }),
      );
    }
    if (d.scope === 'municipality') td.classList.add('mun');
    return td;
  };

  const renderTable = (m: Matrix) => {
    const head = el('tr', {});
    const nameTh = el('th', { scope: 'col', class: 'sticky', 'aria-sort': sortBy ? 'none' : 'ascending' });
    const nameBtn = el('button', { type: 'button', class: 'sle-cmpx-sort', text: 'Ort', title: 'Nach Namen sortieren', 'data-k': 'sort:' });
    nameBtn.addEventListener('click', () => {
      sortBy = null;
      render();
    });
    nameTh.append(nameBtn);
    head.append(nameTh);
    for (const d of m.disciplines) {
      const on = sortBy === d.id;
      const th = el('th', { scope: 'col', 'aria-sort': on ? 'ascending' : 'none', class: on ? 'on' : undefined });
      const b = el(
        'button',
        { type: 'button', class: 'sle-cmpx-sort', title: `${d.description_de} – nach Rang sortieren`, 'data-k': `sort:${d.id}` },
        el('span', { class: 'sle-cmpx-emoji', 'aria-hidden': 'true', text: d.emoji ?? '🏅' }),
        el('span', { text: d.name_de }),
        d.unit && !unitInCell(d.unit) ? el('span', { class: 'sle-cmpx-sub', text: `in ${d.unit}` }) : null,
        d.scope === 'municipality' ? el('span', { class: 'sle-cmpx-sub', text: 'Gemeindewert' }) : null,
        d.note_de ? el('span', { class: 'sle-cmpx-sub', text: 'grober Hinweis' }) : null,
        on ? el('span', { class: 'sle-cmpx-sub', text: '▼ nach Rang' }) : null,
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
      const th = el(
        'th',
        { scope: 'row', class: 'sticky' },
        placeBtn(r.place),
        el('span', { class: 'sle-cmpx-row-sub' }, r.place.category ? el('span', { class: 'sle-cmpx-tag', text: r.place.category === 'stadt' ? 'Stadt' : 'Dorf' }) : null, flightTag(r.place), r.place.complete ? null : el('span', { class: 'sle-cmpx-tag inc', text: 'unvollständig' })),
      );
      const tr = el('tr', {}, th);
      for (const d of m.disciplines) tr.append(cellEl(d, r.cells[d.id]));
      tbody.append(tr);
    }
    const table = el(
      'table',
      { class: 'sle-cmpx-table' },
      el('caption', { class: 'sle-sr', text: `Alle Ranglisten: ${CATEGORY_LABELS[filter]}, Wert und Platz je Disziplin` }),
      el('thead', {}, head),
      tbody,
    );
    const scroll = el('div', { class: 'sle-cmpx-scroll', role: 'region', 'aria-label': 'Tabelle (seitlich scrollbar)', tabindex: '0' }, table);
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
    const notes = el(
      'ul',
      { class: 'sle-cmpx-notes sle-small' },
      el('li', { text: '🥇🥈🥉 = Platz 1–3, sonst „4.“ usw.; gleiche Werte teilen sich den Platz. Spaltenkopf antippen: nach dieser Disziplin sortieren, Ortsname antippen: Karte des Orts öffnen.' }),
      ...[...reasons].map(([k, names]) => el('li', { text: `„–“ ${k} – ${names.join(', ')}` })),
      el('li', { text: '☀️ Sonnenstärkster Ort ist ein Gemeindewert: Gemarkungen einer Gemeinde teilen sich Wert und Platz.' }),
      data.places.some((p) => p.flags.includes('other-flight')) ? el('li', { text: `✈ = andere Befliegung (RLP 2022)${data.rlpTreeRatio && data.rlpTreeRatio > 1 ? `: dort ≈ ${Math.round((data.rlpTreeRatio - 1) * 100)} % mehr Bäume gezählt` : ''}.` }) : null,
    );
    return [filterRow(), scroll, notes];
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
          { class: r.gold ? 'gold' : undefined },
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
      filterRow(),
      el('p', { class: 'sle-cmpx-why', text: 'Keine Gesamtpunktzahl: Jede Gewichtung der Disziplinen wäre willkürlich (zählt Beton doppelt so viel wie Bäume?). Deshalb zählen wir Medaillen wie bei Olympia – erst Gold, dann Silber, dann Bronze.' }),
      ol,
      el(
        'ul',
        { class: 'sle-cmpx-notes sle-small' },
        el('li', { text: `Gezählt: ${ds.map(dName).join(', ')}. Gleiche Werte teilen sich die Medaille; unvollständige Orte und Orte ohne Daten bekommen dort keine.` }),
        m.disciplines.some((d) => d.scope === 'municipality') ? el('li', { text: '☀️ Sonnenstärkster Ort zählt nicht mit: ein Gemeindewert, den sich mehrere Gemarkungen teilen.' }) : null,
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
      const sel = el('select', { 'aria-label': `Ort ${slot + 1}`, 'data-k': `sel:${slot}` });
      if (slot === 2) sel.append(el('option', { value: '', text: '– kein dritter Ort –' }));
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
      pickers.append(el('label', { class: 'sle-cmpx-picker' }, el('span', { class: 'sle-small sle-dim', text: `Ort ${slot + 1}` }), sel));
    }
    const duels = headToHead(m, ids, data.rlpTreeRatio);
    const list = el('div', { class: 'sle-cmpx-duels' });
    for (const duel of duels) {
      const d = duel.discipline;
      const sec = el(
        'section',
        { class: 'sle-cmpx-duel' },
        el('h3', {}, dName(d), d.scope === 'municipality' ? el('span', { class: 'sle-cmpx-sub', text: ' Gemeindewert' }) : null, d.note_de ? el('span', { class: 'sle-cmpx-sub', text: ' grober Hinweis' }) : null),
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
      const url = `${location.origin}${location.pathname}${withCompareParam(location.search, ids)}${location.hash}`;
      void copyText(url).then((ok) => {
        linkStatus.textContent = ok ? 'Link kopiert.' : `Kopieren nicht möglich: ${url}`;
      });
    });
    return [
      pickers,
      el('p', { class: 'sle-dim sle-small', text: 'Balken: von schlechtestem bis bestem Ort der ganzen Rangliste – länger ist besser (auch bei „Wenigsten Beton“). ★ = vorn in diesem Vergleich.' }),
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
      const b = el('button', { type: 'button', class: id === tab ? 'on' : '', 'aria-pressed': String(id === tab), text, 'data-k': `tab:${id}` });
      b.addEventListener('click', () => {
        tab = id;
        render();
      });
      tabs.append(b);
    }
    const m = tab === 'vergleich' ? null : buildMatrix(data, filter);
    view.replaceChildren(...(tab === 'tabelle' ? renderTable(m!) : tab === 'medaillen' ? renderMedals(m!) : renderCompare()));
    view.dataset.tab = tab;
    // Re-rendering replaces the buttons: keep keyboard focus on the same control.
    if (keep) body.querySelector<HTMLElement>(`[data-k="${keep}"]`)?.focus({ preventScroll: true });
  };
  render();
  dlg = deps.openDialog({ id: 'sle-cmp-full', title: '🏆 Alle Ranglisten', body, wide: true });
  dlg.root.classList.add('sle-cmpx-dlg');
  return dlg;
}

/** The stable key (`data-k`) of a control across re-renders (tabs, filter, sort buttons, selects), or null. */
function focusKey(e: Element): string | null {
  return e.getAttribute('data-k');
}
