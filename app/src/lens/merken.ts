/**
 * Relikt-Blick lens (V2.5) — candidate card text and *Merken* → private marker (ADR 0009: the
 * marker and the note stay in this browser). Pure; unit-tested in tests/lens.test.ts.
 *
 * Wording is always a hypothesis („mögliche …“), never a find; no directions, no "go there".
 */
import { existingCandidateMarkerId, formatMetrics, formatScore, markerCategoryFor } from '../candidates/candidateData';
import type { Candidate } from '../candidates/candidateData';
import type { CandidateClass } from '../data/manifest';
import { newMarkerId } from '../markers/markerStore';
import type { Marker } from '../markers/markerStore';

const HYPOTHESIS_DE: Readonly<Record<CandidateClass, string>> = {
  pit: 'Mögliche Grube',
  mound: 'Möglicher Hügel',
  linear: 'Möglicher Graben oder Wall',
  rect: 'Mögliche Rechteckstruktur',
  platform: 'Mögliche Plattform',
};

const DETAIL_DE: Readonly<Record<CandidateClass, string>> = {
  pit: 'eine runde Senke',
  mound: 'eine kleine Erhebung',
  linear: 'eine lange, schmale Struktur',
  rect: 'eine eckige Form',
  platform: 'eine ebene Fläche am Hang',
};

export const CAUTION_DE = 'Schauen, nicht graben. Funde dem Landesdenkmalamt melden.';
const HYPOTHESIS_LINE = 'Hypothese aus automatischer Reliefanalyse – Schauen, nicht graben.';

/** Title of the card / marker, e.g. „Mögliche Grube“. */
export const hypothesisTitle = (c: Pick<Candidate, 'cls'>): string => HYPOTHESIS_DE[c.cls] ?? 'Mögliche Struktur';

export interface CardText {
  title: string;
  lead: string;
  facts: Array<[string, string]>;
  caution: string;
}

export function cardText(c: Candidate): CardText {
  const facts: Array<[string, string]> = formatMetrics(c.metrics).slice(0, 3);
  facts.push(['Score der Analyse', formatScore(c.score)]);
  if (c.forest) facts.push(['Lage', 'unter Wald']);
  if (c.nearKnown) facts.push(['Nahe', c.nearKnown]);
  return {
    title: `${hypothesisTitle(c)}?`,
    lead: `Die Reliefanalyse sieht hier ${DETAIL_DE[c.cls] ?? 'eine auffällige Form'} – eine Hypothese, kein Fund.`,
    facts,
    caution: CAUTION_DE,
  };
}

/** First words of the note of a marker made by *Merken* for candidate `id`. */
export const lensMarkerTag = (id: string): string => `Relikt-Blick ${id} –`;

function noteFor(c: Candidate, userNote: string): string {
  const own = userNote.trim();
  return [`${lensMarkerTag(c.id)} ${hypothesisTitle(c)}, Score ${formatScore(c.score)}.`, ...(own ? [own] : []), HYPOTHESIS_LINE].join('\n');
}

/** The private marker *Merken* stores (category from the class, the user's note in the middle). */
export function merkenMarker(c: Candidate, userNote: string, now = new Date(), id = newMarkerId(now.getTime())): Marker {
  return {
    id,
    title: `${hypothesisTitle(c)} (Relikt-Blick)`,
    note: noteFor(c, userNote),
    category: markerCategoryFor(c),
    created: now.toISOString(),
    E: c.E,
    N: c.N,
    h: Number.isFinite(c.z) ? c.z : null,
  };
}

/** Same marker with a new user note (id, created, parcel kept). */
export const withNote = (m: Marker, c: Candidate, userNote: string): Marker => ({ ...m, note: noteFor(c, userNote) });

/** The user's own note inside a marker made by *Merken* ('' if none or not such a marker). */
export function userNoteOf(m: Pick<Marker, 'note'>): string {
  const lines = m.note.split('\n');
  if (lines.length < 3 || !lines[0].startsWith('Relikt-Blick ') || lines[lines.length - 1] !== HYPOTHESIS_LINE) return '';
  return lines.slice(1, -1).join('\n');
}

/** Marker already stored for candidate `id`: one from *Merken*, else one from „bestätigen“ (F15 review). */
export function existingLensMarker<M extends { id: string; note: string }>(id: string, markers: readonly M[]): M | undefined {
  const tag = lensMarkerTag(id);
  const own = markers.find((m) => typeof m.note === 'string' && m.note.startsWith(tag));
  if (own) return own;
  const confirmed = existingCandidateMarkerId(id, undefined, markers);
  return confirmed ? markers.find((m) => m.id === confirmed) : undefined;
}
