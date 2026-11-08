/**
 * 🏆 Orte im Vergleich — full view („Alle Ranglisten“), pure side (no DOM): the places × disciplines
 * matrix (with a Stadt/Dorf filter), the Medaillenspiegel, head-to-head comparisons of 2–3 places and
 * „So kommt <Ort> nach oben“ (gap to the next-better rank, turned into a community action where the
 * data allows). Ranks come from `rankBoard` (placesData.ts), so the fairness rules stay one rule:
 * incomplete / suppressed / null values are unranked, ties share a rank, PV is a municipality value.
 *
 * Decisions (plan docs/plans/orte-im-vergleich.md §5 „Vollansicht“, ADR 0050): no weighted total score,
 * only an olympic medal count over the place-scope disciplines; conversions are whole-Gemarkung sums
 * (ADR 0049: never parcels, buildings or owners).
 */
import { disciplineAvailability, fmtNum, isStatsLevel, levelNoun, otherFlightNote, placeLevel, rankBoard } from './placesData';
import type { Board, Discipline, Goal, Municipality, Place, PlacesData, StatsLevel } from './placesData';

/** 'alle' or a size class of the level (`categories_de` keys: stadt/dorf, or stadt/gemeinde on the Gemeinde level). */
export type CategoryFilter = string;

/** Ortsteile-level labels (kept for old callers; per level use `categoryOptions`). */
export const CATEGORY_LABELS: Record<string, string> = { alle: 'Alle', stadt: 'Städte', dorf: 'Dörfer' };

/** Filter choices of a level: „Alle“ plus its size classes (Städte / Dörfer, or Städte / Gemeinden). */
export function categoryOptions(data: Pick<PlacesData, 'categories'>): Array<[CategoryFilter, string]> {
  return [['alle', 'Alle'], ...Object.entries(data.categories)];
}

/** Dative plural for „Ränge nur unter den …“ (Städten, Dörfern, Gemeinden). */
export const dativePlural = (label: string): string => (/[ns]$/.test(label) ? label : `${label}n`);

/** One place in one discipline. */
export interface Cell {
  value: number | null;
  /** null = unranked (`reason` says why). */
  rank: number | null;
  /** Ranked entries on this board (filtered places, or all municipalities for a municipality discipline). */
  of: number;
  reason: string | null;
  /** Municipality-scope discipline: the Gemeinde whose value the place shows (shared by its places). */
  municipality: Municipality | null;
}

export interface MatrixRow {
  place: Place;
  cells: Record<string, Cell>;
}

export interface Matrix {
  filter: CategoryFilter;
  /** The level of the file (one matrix = one level, ADR 0051). */
  level: StatsLevel;
  /** Ready disciplines with a measure, file order. */
  disciplines: Discipline[];
  /** Disciplines still being computed on this level (no column, no ranking: „wird berechnet“). */
  pending: Discipline[];
  /** Places of the filter, by name. */
  rows: MatrixRow[];
  /** The boards behind the cells (places of the filter / all municipalities). */
  boards: Record<string, Board<Place> | Board<Municipality>>;
  /** Range of the ranked values per discipline (bars). */
  extent: Record<string, { min: number; max: number }>;
}

const collator = new Intl.Collator('de');
const byName = (a: { name_de: string }, b: { name_de: string }) => collator.compare(a.name_de, b.name_de);

/** Is `path` (or a parent of it) in the place's `suppressed` list (fewer than `min_count`)? */
export function isSuppressed(p: Pick<Place, 'suppressed'>, path: string): boolean {
  return p.suppressed.some((s) => s === path || path.startsWith(`${s}.`));
}

/** German reason why a place has no rank in a place-scope discipline. */
export function unrankedReason(p: Place, d: Discipline, value: number | null): string {
  const st = p.discipline_state[d.id];
  if (value === null && st === 'pending') return 'wird noch berechnet';
  if (value === null && st === 'none') return 'keine Quelle für diesen Ort';
  if (value !== null && !p.complete) return `unvollständig: ${levelNoun(p)} nicht ganz erfasst`;
  if (isSuppressed(p, d.measure)) return 'nicht veröffentlicht (zu wenige)';
  if (d.measure.startsWith('biodiversity.') && p.biodiversity?.few_records) return 'zu wenige Meldungen (unter 500)';
  return 'keine Daten';
}

/**
 * The matrix of `data.places` (filtered by category) × ready disciplines. Place disciplines are
 * ranked within the filter (Städte against Städte); a municipality discipline keeps the ranking of
 * all municipalities, shown on each of their places.
 */
export function buildMatrix(data: PlacesData, filter: CategoryFilter = 'alle'): Matrix {
  // Level guard: a place of another level (wrong `kind` in the file) never enters this ranking.
  const places = data.places.filter((p) => placeLevel(p) === data.level && (filter === 'alle' || p.category === filter)).sort(byName);
  const disciplines = data.disciplines.filter((d) => d.ready && !!d.measure);
  const pending = data.disciplines.filter((d) => disciplineAvailability(data, d) === 'pending');
  const boards: Matrix['boards'] = {};
  const extent: Matrix['extent'] = {};
  const rows: MatrixRow[] = places.map((place) => ({ place, cells: {} }));
  for (const d of disciplines) {
    if (d.scope === 'municipality') {
      const board = rankBoard(d, data.municipalities);
      boards[d.id] = board;
      for (const row of rows) {
        const m = data.municipalities.find((x) => x.id === row.place.municipality) ?? null;
        const r = m ? board.ranked.find((e) => e.item.id === m.id) : undefined;
        const v = m ? (board.incomplete.concat(board.noData).find((e) => e.item.id === m.id)?.value ?? null) : null;
        const st = row.place.discipline_state[d.id];
        const why = st === 'pending' ? 'wird noch berechnet' : m ? 'keine Gemeindedaten' : 'keine Gemeinde zugeordnet';
        row.cells[d.id] = r
          ? { value: r.value, rank: r.rank, of: board.ranked.length, reason: null, municipality: m }
          : { value: v, rank: null, of: board.ranked.length, reason: why, municipality: m };
      }
      setExtent(extent, d.id, board.ranked);
      continue;
    }
    const board = rankBoard(d, places);
    boards[d.id] = board;
    for (const row of rows) {
      const r = board.ranked.find((e) => e.item.id === row.place.id);
      if (r) {
        row.cells[d.id] = { value: r.value, rank: r.rank, of: board.ranked.length, reason: null, municipality: null };
        continue;
      }
      const v = board.incomplete.find((e) => e.item.id === row.place.id)?.value ?? null;
      row.cells[d.id] = { value: v, rank: null, of: board.ranked.length, reason: unrankedReason(row.place, d, v), municipality: null };
    }
    setExtent(extent, d.id, board.ranked);
  }
  return { filter, level: data.level, disciplines, pending, rows, boards, extent };
}

function setExtent(extent: Matrix['extent'], id: string, ranked: ReadonlyArray<{ value: number }>): void {
  if (!ranked.length) return;
  const vs = ranked.map((e) => e.value);
  extent[id] = { min: Math.min(...vs), max: Math.max(...vs) };
}

/** Rows sorted by a discipline (ranked by rank, then unranked; names break ties) or by name. */
export function sortRows(m: Matrix, by: string | null): MatrixRow[] {
  const rows = [...m.rows];
  if (!by || !m.disciplines.some((d) => d.id === by)) return rows.sort((a, b) => byName(a.place, b.place));
  return rows.sort((a, b) => {
    const ra = a.cells[by]?.rank ?? Infinity;
    const rb = b.cells[by]?.rank ?? Infinity;
    return ra === rb ? byName(a.place, b.place) : ra - rb;
  });
}

/**
 * Bar length 0–1 of a value on the min..max of the ranked values, direction-aware: the best value is
 * 1, the worst 0 (the UI gives 0 a small stub). One value only / all equal → 1. null without data.
 */
export function barFraction(d: Pick<Discipline, 'higher_is_better'>, value: number | null, ext: { min: number; max: number } | undefined): number | null {
  if (value === null || !ext) return null;
  const span = ext.max - ext.min;
  if (!(span > 0)) return 1;
  const f = d.higher_is_better ? (value - ext.min) / span : (ext.max - value) / span;
  return Math.min(1, Math.max(0, f));
}

// ---- Medaillenspiegel ---------------------------------------------------------------------------------

export interface MedalRow {
  place: Place;
  gold: number;
  silver: number;
  bronze: number;
  /** Medals by discipline, file order. */
  won: Array<{ discipline: Discipline; rank: 1 | 2 | 3 }>;
  /** Olympic position (equal medal counts share it). */
  position: number;
}

/** Disciplines that count for medals: place scope only (a municipality value is shared by several places). */
export const medalDisciplines = (m: Matrix): Discipline[] => m.disciplines.filter((d) => d.scope === 'place');

/**
 * Olympic medal table over the ranked place-scope disciplines (no weighted total): gold, then silver,
 * then bronze, then name. Tied ranks give the same medal (two golds at 1, 1 → next is bronze at 3).
 */
export function medalTable(m: Matrix): MedalRow[] {
  const ds = medalDisciplines(m);
  const rows: MedalRow[] = m.rows.map(({ place, cells }) => {
    const won: MedalRow['won'] = [];
    for (const d of ds) {
      const r = cells[d.id]?.rank;
      if (r === 1 || r === 2 || r === 3) won.push({ discipline: d, rank: r });
    }
    const count = (k: number) => won.filter((w) => w.rank === k).length;
    return { place, gold: count(1), silver: count(2), bronze: count(3), won, position: 0 };
  });
  const key = (r: MedalRow) => [r.gold, r.silver, r.bronze];
  rows.sort((a, b) => b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze || byName(a.place, b.place));
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.position = prev && key(prev).every((v, k) => v === key(r)[k]) ? prev.position : i + 1;
  });
  return rows;
}

// ---- wording ---------------------------------------------------------------------------------------------

/** Round a gap for display: 0.01 below 10, 0.1 above (fmtNum shows up to 2 / 1 decimals). */
const roundGap = (v: number) => (Math.abs(v) < 10 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10);

/** „1,4 Prozentpunkte“, „1 Prozentpunkt“, „4,3 m“, „0,21 kWp/Einw.“ */
export function fmtGap(gap: number, unit: string): string {
  const g = roundGap(Math.abs(gap));
  if (unit === '%') return `${fmtNum(g)} ${g === 1 ? 'Prozentpunkt' : 'Prozentpunkte'}`;
  return unit ? `${fmtNum(g)} ${unit}` : fmtNum(g);
}

/** Two significant digits from 100 on (4.272 → 4.300, 26.692 → 27.000); smaller numbers whole. */
export function roundNice(n: number): number {
  const a = Math.abs(n);
  if (a < 100) return Math.round(n);
  const p = 10 ** (Math.floor(Math.log10(a)) - 1);
  return Math.round(n / p) * p;
}

/** An area in m² as „4.300 m²“ below 1 ha, else „2,3 ha“ / „160 ha“. */
export function fmtArea(m2: number): string {
  if (m2 < 10_000) return `${fmtNum(roundNice(Math.max(1, m2)))} m²`;
  const ha = m2 / 10_000;
  return ha < 10 ? `${fmtNum(Math.round(ha * 10) / 10)} ha` : `${fmtNum(roundNice(ha))} ha`;
}

const nameList = (names: string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`);

/** Disciplines whose values depend on the LiDAR flight (the RLP 2022 / SL 2025 offset applies). */
export const flightDependent = (d: Pick<Discipline, 'scope' | 'measure'>): boolean =>
  d.scope === 'place' && !d.measure.startsWith('biodiversity.') && d.measure !== 'forest_pct'; // forest_pct: DLR satellite map

/** Measures that count trees: the measured RLP/SL tree-count offset (≈ 20 %) applies to them. */
const TREE_COUNT_MEASURES = ['trees_per_inhabitant', 'trees'];

/**
 * Fairness note when only some of the places come from the other flight (none, or all: comparable).
 * The tree-count offset is named only for measures that count trees (the badge's note, otherFlightNote).
 */
export function flightNote(d: Discipline, places: readonly Place[], rlpTreeRatio: number | null): string | null {
  if (!flightDependent(d)) return null;
  const other = places.filter((p) => p.flags.includes('other-flight'));
  if (!other.length || other.length === places.length) return null;
  const ratio = TREE_COUNT_MEASURES.includes(d.measure) ? rlpTreeRatio : null;
  return `ⓘ Andere Befliegung: ${other.map((p) => `${p.name_de} (${otherFlightNote(p, ratio)})`).join('; ')} – Abstand mit Vorsicht lesen.`;
}

// ---- head-to-head ------------------------------------------------------------------------------------------

export interface DuelEntry {
  place: Place;
  cell: Cell;
  bar: number | null;
  /** Best ranked value among the compared places (all ties marked; none when all equal). */
  best: boolean;
}

export interface Duel {
  discipline: Discipline;
  entries: DuelEntry[];
  /** Plain German difference („Kirrberg vorn: 21,3 Prozentpunkte weniger als Homburg.“). */
  text: string;
  flightNote: string | null;
}

/** Who leads in one discipline and by how much, in plain German. */
export function duelText(d: Discipline, entries: ReadonlyArray<{ place: Place; cell: Cell }>): string {
  const ranked = entries.filter((e) => e.cell.rank !== null && e.cell.value !== null);
  if (ranked.length < 2) {
    const un = entries.filter((e) => e.cell.rank === null).map((e) => `${e.place.name_de}: ${e.cell.reason ?? 'ohne Rang'}`);
    return `Kein Vergleich möglich – ${un.join('; ')}.`;
  }
  // Municipality values: compare the Gemeinden, once each.
  const groups = new Map<string, { label: string; value: number }>();
  for (const e of ranked) {
    const m = d.scope === 'municipality' && e.place.kind !== 'gemeinde' ? e.cell.municipality : null; // Gemeinde level: place = Gemeinde
    const key = m ? `m:${m.id}` : `p:${e.place.id}`;
    if (!groups.has(key)) groups.set(key, { label: m ? `Gemeinde ${m.name_de}` : e.place.name_de, value: e.cell.value! });
  }
  const gs = [...groups.values()];
  if (gs.length === 1) return d.scope === 'municipality' ? `Gleicher Gemeindewert (${gs[0].label}).` : 'Gleichauf.';
  const better = (a: number, b: number) => (d.higher_is_better ? a > b : a < b);
  const bestVal = gs.reduce((acc, g) => (better(g.value, acc) ? g.value : acc), gs[0].value);
  const best = gs.filter((g) => g.value === bestVal);
  const rest = gs.filter((g) => g.value !== bestVal);
  if (!rest.length) return 'Gleichauf.';
  const dir = d.higher_is_better ? 'mehr' : 'weniger';
  const tie = best.length > 1 ? ' (gleichauf)' : '';
  return `${nameList(best.map((g) => g.label))} vorn${tie}: ${rest.map((g) => `${fmtGap(bestVal - g.value, d.unit)} ${dir} als ${g.label}`).join(', ')}.`;
}

/** Side-by-side of 2–3 places over all ready disciplines (bars on the min..max of the whole board). */
export function headToHead(m: Matrix, ids: readonly string[], rlpTreeRatio: number | null = null): Duel[] {
  const rows = ids.map((id) => m.rows.find((r) => r.place.id === id)).filter((r): r is MatrixRow => !!r);
  return m.disciplines.map((d) => {
    const base = rows.map((r) => ({ place: r.place, cell: r.cells[d.id] }));
    const ranked = base.filter((e) => e.cell.rank !== null);
    const bestRank = ranked.length ? Math.min(...ranked.map((e) => e.cell.rank!)) : null;
    const allEqual = ranked.length > 1 && ranked.every((e) => e.cell.value === ranked[0].cell.value);
    const entries: DuelEntry[] = base.map((e) => ({
      ...e,
      bar: e.cell.rank !== null ? barFraction(d, e.cell.value, m.extent[d.id]) : null,
      best: ranked.length > 1 && !allEqual && e.cell.rank === bestRank,
    }));
    return { discipline: d, entries, text: duelText(d, base), flightNote: flightNote(d, ranked.map((e) => e.place), rlpTreeRatio) };
  });
}

// ---- „So kommt <Ort> nach oben“ -------------------------------------------------------------------------------

/** Example goals (`goals[].id`) a discipline's measure helps with (besides a goal with the same `metric`). */
export const GOAL_LINKS: Record<string, string[]> = {
  'ortslage.sealed_pct': ['entsiegeln'],
  'ortslage.green_pct': ['kronen-ortslage', 'hecke'],
  'ortslage.canopy_pct': ['kronen-ortslage'],
  trees_per_inhabitant: ['kronen-ortslage'],
  crown_pct: ['hecke'],
  'tallest.h': ['riesen-bestimmt'],
};

export function matchingGoal(p: Pick<Place, 'goals'>, d: Pick<Discipline, 'measure'>): Goal | null {
  return p.goals.find((g) => g.metric === d.measure) ?? (GOAL_LINKS[d.measure] ?? []).map((id) => p.goals.find((g) => g.id === id)).find((g) => !!g) ?? null;
}

export interface Climb {
  discipline: Discipline;
  rank: number;
  of: number;
  value: number;
  /** The next-better rank (all entries holding it). */
  target: { names: string[]; rank: number; value: number };
  gap: number;
  /** „1,4 Prozentpunkte hinter Einöd (Platz 2)“ */
  gapText: string;
  /** Concrete community action from the data („≈ 4.300 m² entsiegeln“), or null. */
  action: string | null;
  /** One sentence how the value can move (or why it hardly can). */
  hint: string;
  goal: Goal | null;
  flightNote: string | null;
}

export interface ClimbSummary {
  place: Place;
  /** Disciplines where the place already is 1st. */
  leads: Discipline[];
  climbs: Climb[];
  unranked: Array<{ discipline: Discipline; reason: string }>;
}

/** The action for closing `gap` in `d` (whole-Gemarkung / Gemeinde sums), when the needed fields exist. */
export function climbAction(d: Discipline, gap: number, p: Place, mun: Municipality | null): { action: string | null; hint: string } {
  const g = Math.abs(gap);
  const ortsHa = p.ortslage?.area_ha ?? null;
  switch (d.measure) {
    case 'ortslage.sealed_pct':
      return {
        action: ortsHa !== null && ortsHa > 0 ? `≈ ${fmtArea((g / 100) * ortsHa * 10_000)} entsiegeln` : null,
        hint: 'Höfe, Parkplätze und Wege öffnen (Rasengitter, Kies, Beete): zählt im Anteil der ganzen Ortslage.',
      };
    case 'ortslage.green_pct':
    case 'ortslage.canopy_pct':
      return {
        action: ortsHa !== null && ortsHa > 0 ? `≈ ${fmtArea((g / 100) * ortsHa * 10_000)} mehr ${d.measure === 'ortslage.canopy_pct' ? 'Baumkrone' : 'Grün'} in der Ortslage` : null,
        hint: 'Bäume, Hecken, Wiesen und Beete statt Pflaster oder Schotter.',
      };
    case 'crown_pct':
      return {
        action: p.area_ha !== null && p.area_ha > 0 ? `≈ ${fmtArea((g / 100) * p.area_ha * 10_000)} mehr Kronenfläche in der ${levelNoun(p)}` : null,
        hint: 'Feldgehölze, Hecken und Baumreihen pflanzen, Wald wachsen lassen – Kronen brauchen Jahre.',
      };
    case 'trees_per_inhabitant':
      return {
        action: p.inhabitants !== null && p.inhabitants > 0 ? `≈ ${fmtNum(roundNice(Math.max(1, g * p.inhabitants)))} Bäume pflanzen` : null,
        hint: 'Neue Bäume zählen erst, wenn ihre Krone in einer Befliegung erkennbar ist (einige Jahre).',
      };
    case 'tallest.h':
      return { action: null, hint: 'Höhe lässt sich nicht pflanzen: die höchsten Bäume erhalten – und die Riesen der Gemarkung bestimmen.' };
    case 'pv.kwp_per_inhabitant':
      return {
        action: mun && mun.inhabitants !== null && mun.inhabitants > 0 ? `≈ ${fmtNum(roundNice(Math.max(1, g * mun.inhabitants)))} kWp mehr Photovoltaik in der Gemeinde ${mun.name_de}` : null,
        hint:
          p.kind === 'gemeinde'
            ? 'Mehr Photovoltaik auf Dächern, Balkonen und Freiflächen der Gemeinde (Marktstammdatenregister).'
            : 'Gemeindewert: zählt für alle Gemarkungen der Gemeinde (Marktstammdatenregister nur pro Gemeinde).',
      };
    case 'forest_pct':
      return {
        action: p.area_ha !== null && p.area_ha > 0 ? `≈ ${fmtArea((g / 100) * p.area_ha * 10_000)} mehr Wald in der ${levelNoun(p)}` : null,
        hint: 'Aufforsten und Wald wachsen lassen; der Wert kommt aus der Satellitenkarte 2022 und ändert sich erst mit einer neuen Karte.',
      };
    case 'ortslage_canopy_pct': {
      const ha = p.ortslage_area_ha;
      return {
        action: ha !== null && ha > 0 ? `≈ ${fmtArea((g / 100) * ha * 10_000)} mehr Baumkrone in der Ortslage` : null,
        hint: 'Straßenbäume, Hof- und Gartenbäume pflanzen und erhalten – Kronen brauchen Jahre.',
      };
    }
    case 'pv.used_pct_mid':
      return { action: null, hint: 'Mehr Photovoltaik auf geeigneten Dächern: zählt im Anteil des ganzen Dachpotenzials der Gemeinde.' };
    case 'biodiversity.rarefied_500':
      return { action: null, hint: 'Mehr verschiedene Arten beobachten und melden (z. B. iNaturalist): der Wert misst Meldungen, nicht die Natur selbst.' };
    default:
      return { action: null, hint: '' };
  }
}

/**
 * For each ready discipline where the place is ranked but not 1st: the gap to the next-better rank
 * and what it would take (matrix over all places, i.e. the panel's boards).
 */
export function climbFor(data: PlacesData, m: Matrix, placeId: string): ClimbSummary | null {
  const row = m.rows.find((r) => r.place.id === placeId);
  if (!row) return null;
  const p = row.place;
  const out: ClimbSummary = { place: p, leads: [], climbs: [], unranked: [] };
  for (const d of m.disciplines) {
    const cell = row.cells[d.id];
    if (!cell) continue;
    if (cell.rank === null || cell.value === null) {
      out.unranked.push({ discipline: d, reason: cell.reason ?? 'keine Daten' });
      continue;
    }
    if (cell.rank === 1) {
      out.leads.push(d);
      continue;
    }
    const board = m.boards[d.id] as Board<Place | Municipality>;
    const better = board.ranked.filter((e) => e.rank < cell.rank!);
    if (!better.length) continue;
    const targetRank = Math.max(...better.map((e) => e.rank));
    const at = better.filter((e) => e.rank === targetRank);
    const isMun = d.scope === 'municipality';
    // Gemeinde level: every row is a Gemeinde, the name alone reads better („hinter Kirkel“).
    const names = at.map((e) => (isMun && m.level !== 'gemeinde' ? `Gemeinde ${e.item.name_de}` : e.item.name_de));
    const gap = Math.abs(at[0].value - cell.value);
    const { action, hint } = climbAction(d, gap, p, cell.municipality);
    const targets = isMun ? [] : (at.map((e) => e.item) as Place[]);
    out.climbs.push({
      discipline: d,
      rank: cell.rank,
      of: cell.of,
      value: cell.value,
      target: { names, rank: targetRank, value: at[0].value },
      gap,
      gapText: `${fmtGap(gap, d.unit)} hinter ${nameList(names)} (Platz ${targetRank})`,
      action,
      hint,
      goal: matchingGoal(p, d),
      flightNote: isMun ? null : flightNote(d, [p, ...targets], data.rlpTreeRatio),
    });
  }
  return out;
}

/** The natural rival for a comparison: the place right above in `disciplineId` (or right below when 1st). */
export function rivalFor(m: Matrix, placeId: string, disciplineId: string | null): string | null {
  const d = m.disciplines.find((x) => x.id === disciplineId && x.scope === 'place') ?? m.disciplines.find((x) => x.scope === 'place');
  const others = m.rows.filter((r) => r.place.id !== placeId);
  if (!others.length) return null;
  const own = m.rows.find((r) => r.place.id === placeId)?.cells[d?.id ?? '']?.rank ?? null;
  if (!d || own === null) return others[0].place.id;
  const ranked = others.filter((r) => r.cells[d.id]?.rank !== null).sort((a, b) => a.cells[d.id].rank! - b.cells[d.id].rank!);
  const above = ranked.filter((r) => r.cells[d.id].rank! <= own);
  if (above.length) return above[above.length - 1].place.id;
  return ranked[0]?.place.id ?? others[0].place.id;
}

// ---- deep link (?vergleich=a,b[,c]) ------------------------------------------------------------------------------

export const COMPARE_PARAM = 'vergleich';
/** Level of the comparison (`?vergleich=a,b&ebene=gemeinde`); absent = the AOI's own level (old links). */
export const LEVEL_PARAM = 'ebene';

/** The level in `?ebene=`, if it is one of `valid`, else null. */
export function parseLevelParam(search: string, valid: readonly StatsLevel[]): StatsLevel | null {
  const v = new URLSearchParams(search).get(LEVEL_PARAM);
  return isStatsLevel(v) && valid.includes(v) ? v : null;
}

/** 2–3 distinct known place ids from `?vergleich=`, else null (unknown ids dropped). */
export function parseCompareParam(search: string, validIds: readonly string[]): string[] | null {
  const raw = new URLSearchParams(search).get(COMPARE_PARAM);
  if (!raw) return null;
  const ids = [...new Set(raw.split(',').map((s) => s.trim()))].filter((id) => validIds.includes(id)).slice(0, 3);
  return ids.length >= 2 ? ids : null;
}

/**
 * `search` with `?vergleich=` set to `ids` (empty → removed, with `ebene`); `level` given → `ebene=`
 * set, else removed (an old-style link: the AOI's own level). Other params kept.
 */
export function withCompareParam(search: string, ids: readonly string[], level: StatsLevel | null = null): string {
  const q = new URLSearchParams(search);
  if (ids.length) q.set(COMPARE_PARAM, ids.join(','));
  else q.delete(COMPARE_PARAM);
  if (ids.length && level) q.set(LEVEL_PARAM, level);
  else q.delete(LEVEL_PARAM);
  const s = q.toString().replace(/%2C/gi, ',');
  return s ? `?${s}` : '';
}

// ---- table formatting (round 2) ----------------------------------------------------------------------------

/**
 * One number of decimals per table column: the most any value needs (at 0.01 precision), at most 2
 * when some value is below 10, else at most 1 („1,10 · 1,00 · 0,89“, „36,0 · 36,8“, „227 · 316“).
 */
export function columnDecimals(values: ReadonlyArray<number | null>): number {
  const vs = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (!vs.length) return 0;
  const cap = vs.some((v) => Math.abs(v) < 10) ? 2 : 1;
  let need = 0;
  for (const v of vs) {
    const r = Math.round(v * 100) / 100;
    const frac = Math.abs(r) % 1;
    const d = frac < 1e-9 ? 0 : Math.abs(Math.round(r * 10) / 10 - r) < 1e-9 ? 1 : 2;
    need = Math.max(need, d);
  }
  return Math.min(need, cap);
}

const fixedFormats = new Map<number, Intl.NumberFormat>();
/** German number with exactly `digits` decimals („1,10“, „36,0“, „1.234“). */
export function fmtFixed(v: number | null, digits: number): string {
  if (v === null || !Number.isFinite(v)) return '–';
  let f = fixedFormats.get(digits);
  if (!f) fixedFormats.set(digits, (f = new Intl.NumberFormat('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })));
  return f.format(v);
}

/** Compact column head: short name + a second line with the unit (and caveats); full text in the title. */
const COLUMN_HEADS: Record<string, { short: string; sub: string }> = {
  'ortslage.green_pct': { short: 'Grün', sub: '% der Ortslage' },
  'ortslage.sealed_pct': { short: 'Beton', sub: '% versiegelt' },
  trees_per_inhabitant: { short: 'Bäume', sub: 'je Einwohner' },
  crown_pct: { short: 'Wald', sub: '% Krone' },
  'tallest.h': { short: 'Riesenbaum', sub: 'Höhe in m' },
  'pv.kwp_per_inhabitant': { short: 'Sonne', sub: 'kWp/Einw.' },
  'biodiversity.rarefied_500': { short: 'Arten', sub: 'je 500 Meldungen' },
  forest_pct: { short: 'Wald', sub: '% laut Karte' },
  ortslage_canopy_pct: { short: 'Ortskronen', sub: '% der Ortslage' },
  'pv.used_pct_mid': { short: 'Dach-PV', sub: '% genutzt' },
};

export function columnHead(
  d: Pick<Discipline, 'measure' | 'name_de' | 'unit' | 'higher_is_better' | 'scope' | 'note_de'>,
  level: StatsLevel = 'ortsteil',
): { short: string; sub: string; notes: string[] } {
  const h = COLUMN_HEADS[d.measure] ?? { short: d.name_de, sub: d.unit };
  const notes: string[] = [];
  if (!d.higher_is_better) notes.push('weniger ist besser');
  // On the Gemeinde level every row is a Gemeinde: „Gemeindewert“ would say nothing.
  if (d.scope === 'municipality' && level !== 'gemeinde') notes.push('Gemeindewert');
  if (d.note_de) notes.push('grober Hinweis');
  return { short: h.short, sub: h.sub, notes };
}

/**
 * Left edge (px) of the full view on wide screens: right of the open drawers (`rects` of the visible
 * ones) plus a gap, or `gap` when none is open. Keeps at least `minWidth` px of table: a drawer
 * that leaves less than that is covered instead (the view starts at `gap`).
 */
export function panelLeft(rects: ReadonlyArray<{ left: number; right: number }>, viewportW: number, gap: number, minWidth = 480): number {
  const right = rects.reduce((m, r) => Math.max(m, r.right), 0);
  if (!(right > 0)) return gap;
  const left = right + gap;
  return viewportW - left - gap >= minWidth ? left : gap;
}
