/**
 * F15 review decisions (bestätigt / verworfen / unsicher) — localStorage only, key
 * `sle.candidates.v1.<aoi>` (docs/data-contract.md "Review decisions"). Never written into data
 * files, never uploaded. Pure apart from the injected key-value storage; unit-tested.
 */
import { candidatesStorageKey, isCandidateClass } from '../data/manifest';
import type { CandidateClass, CandidateDecision, CandidateReviewStatus, CandidateReviewStore } from '../data/manifest';
import type { Candidate } from './candidateData';

/** Minimal Storage subset (localStorage-compatible), injectable for tests. */
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STATUSES: readonly CandidateReviewStatus[] = ['confirmed', 'rejected', 'unsure'];
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Re-attach radius (m) for decisions whose candidate id vanished after a detector re-run. */
export const REATTACH_RADIUS_M = 3;

export function sanitizeDecision(x: unknown): CandidateDecision | null {
  const d = x as Record<string, unknown> | null;
  if (!d || typeof d !== 'object') return null;
  if (!STATUSES.includes(d.status as CandidateReviewStatus) || !isCandidateClass(d.class)) return null;
  if (!finite(d.E) || !finite(d.N)) return null;
  const at = typeof d.at === 'string' && !Number.isNaN(Date.parse(d.at)) ? d.at : new Date(0).toISOString();
  return {
    status: d.status as CandidateReviewStatus,
    at,
    class: d.class,
    E: d.E,
    N: d.N,
    score: finite(d.score) ? d.score : 0,
    ...(typeof d.markerId === 'string' && d.markerId ? { markerId: d.markerId.slice(0, 64) } : {}),
  };
}

export function emptyReviewStore(): CandidateReviewStore {
  return { version: 1, decisions: {} };
}

export function loadReviews(kv: KV | null | undefined, aoi: string): CandidateReviewStore {
  const out = emptyReviewStore();
  try {
    const raw = kv?.getItem(candidatesStorageKey(aoi));
    if (!raw) return out;
    const data = JSON.parse(raw) as { version?: unknown; decisions?: unknown };
    if (data?.version !== 1 || !data.decisions || typeof data.decisions !== 'object') return out;
    for (const [id, d] of Object.entries(data.decisions as Record<string, unknown>)) {
      const s = sanitizeDecision(d);
      if (s && id) out.decisions[id] = s;
    }
  } catch (err) {
    console.warn('[candidates] could not load review decisions', err);
  }
  return out;
}

/** Returns false if storage is unavailable/full. */
export function saveReviews(kv: KV | null | undefined, aoi: string, store: CandidateReviewStore): boolean {
  try {
    if (!kv) return false;
    kv.setItem(candidatesStorageKey(aoi), JSON.stringify(store));
    return true;
  } catch (err) {
    console.warn('[candidates] could not save review decisions', err);
    return false;
  }
}

/**
 * Move decisions whose id is no longer among `candidates` to the nearest same-class candidate
 * within `radius` m that has no decision yet (nearest pairs first). Decisions that find no
 * partner are kept unchanged (the candidate may come back in a later run). Returns a new store
 * and the number of moved decisions.
 */
export function reattachDecisions(
  store: CandidateReviewStore,
  candidates: readonly Candidate[],
  radius = REATTACH_RADIUS_M,
): { store: CandidateReviewStore; moved: number } {
  const ids = new Set(candidates.map((c) => c.id));
  const decisions: Record<string, CandidateDecision> = { ...store.decisions };
  const orphans = Object.entries(decisions).filter(([id]) => !ids.has(id));
  if (!orphans.length) return { store: { version: 1, decisions }, moved: 0 };
  const pairs: Array<{ d2: number; from: string; to: string }> = [];
  const r2 = radius * radius;
  for (const [from, d] of orphans) {
    for (const c of candidates) {
      if (c.cls !== d.class || decisions[c.id]) continue;
      const d2 = (c.E - d.E) ** 2 + (c.N - d.N) ** 2;
      if (d2 <= r2) pairs.push({ d2, from, to: c.id });
    }
  }
  pairs.sort((a, b) => a.d2 - b.d2 || (a.from < b.from ? -1 : 1));
  const usedFrom = new Set<string>();
  const usedTo = new Set<string>();
  let moved = 0;
  for (const p of pairs) {
    if (usedFrom.has(p.from) || usedTo.has(p.to)) continue;
    usedFrom.add(p.from);
    usedTo.add(p.to);
    const c = candidates.find((x) => x.id === p.to)!;
    decisions[p.to] = { ...decisions[p.from], E: Math.round(c.E * 100) / 100, N: Math.round(c.N * 100) / 100, score: c.score };
    delete decisions[p.from];
    moved++;
  }
  return { store: { version: 1, decisions }, moved };
}

export interface DecisionExport {
  type: 'sle-candidate-decisions';
  aoi: string;
  exported: string;
  detector: { method: string; version: number };
  note: string;
  counts: Record<CandidateReviewStatus, number>;
  /** Decisions per class, e.g. `{ pit: 3, mound: 1 }`. */
  classes: Partial<Record<CandidateClass, number>>;
  version: 1;
  decisions: Record<string, CandidateDecision>;
}

/** JSON document for the user-triggered local export of decisions. */
export function exportDecisions(store: CandidateReviewStore, aoi: string, detector: { method: string; version: number }, now = new Date()): DecisionExport {
  const counts: Record<CandidateReviewStatus, number> = { confirmed: 0, rejected: 0, unsure: 0 };
  const classes: Partial<Record<CandidateClass, number>> = {};
  for (const d of Object.values(store.decisions)) {
    counts[d.status]++;
    classes[d.class] = (classes[d.class] ?? 0) + 1;
  }
  return {
    type: 'sle-candidate-decisions',
    aoi,
    exported: now.toISOString(),
    detector,
    note: 'Private Prüfentscheidungen zu automatisch erkannten Verdachtsflächen (Hypothesen). Nicht veröffentlichen – Schauen, nicht graben.',
    counts,
    classes,
    version: 1,
    decisions: store.decisions,
  };
}
