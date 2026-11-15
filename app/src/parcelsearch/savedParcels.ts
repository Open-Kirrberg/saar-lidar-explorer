/**
 * Merkliste der Flurstücksuche: parcels the user saved, kept only in this browser (localStorage
 * `sle.parcels.saved.v1`). Pure apart from the injected storage — unit-tested in
 * tests/savedParcels.test.ts.
 *
 * Stored per parcel: what `show()` needs to come back without a new search (label point E/N,
 * label props, source, amtliche Fläche). Outline rings only for online hits (`source: 'wfs'`,
 * rounded to 0.01 m); local hits re-derive their outline from the place's polygons file.
 * Stored JSON is untrusted: every entry is validated, bad ones are dropped.
 */
import type { ParcelLabelProps } from '../data/manifest';
import { toFiniteNumber } from '../markers/markerStore';
import type { KV } from '../markers/markerStore';
import type { ParcelRecord } from './query';

export const SAVED_PARCELS_KEY = 'sle.parcels.saved.v1';
export const SAVED_PARCELS_MAX = 200;
export const NOTE_MAX = 200;
/** More outline points than this (all rings) → the rings are not stored (fly to the point only). */
const MAX_RING_POINTS = 4000;

type Ring = Array<[number, number]>;

export interface SavedParcel {
  /** Dedupe key: Flurstückskennzeichen, else Gemarkung | Flur | Nummer. */
  key: string;
  E: number;
  N: number;
  props: ParcelLabelProps;
  /** Catalog place id, '' (single-AOI mode) or 'wfs' (online hit). */
  source: string;
  flaeche_m2?: number;
  /** Online hits only. */
  rings?: Ring[];
  /** ISO 8601. */
  savedAt: string;
  note?: string;
}

/** 'quota': storage full (the change was undone); 'unavailable': no storage (kept in memory only). */
export type WriteResult = 'ok' | 'quota' | 'unavailable';

export function parcelKey(props: Pick<ParcelLabelProps, 'flstkennz' | 'gemarkung' | 'flur' | 'text'>): string {
  const k = props.flstkennz.trim().replace(/_+$/, '');
  return k ? `k:${k}` : `g:${props.gemarkung.trim()}|${props.flur.trim()}|${props.text.trim()}`;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Validate rings ([[E, N], …] per ring, ≥ 3 points, finite numbers); null if unusable or too large. */
function cleanRings(x: unknown): Ring[] | null {
  if (!Array.isArray(x) || !x.length) return null;
  const out: Ring[] = [];
  let points = 0;
  for (const ring of x) {
    if (!Array.isArray(ring) || ring.length < 3) return null;
    const r: Ring = [];
    for (const p of ring) {
      if (!Array.isArray(p)) return null;
      const E = toFiniteNumber(p[0]);
      const N = toFiniteNumber(p[1]);
      if (!Number.isFinite(E) || !Number.isFinite(N)) return null;
      r.push([r2(E), r2(N)]);
    }
    points += r.length;
    if (points > MAX_RING_POINTS) return null;
    out.push(r);
  }
  return out;
}

/** Plausible EPSG:25832 position for Saarland / Rheinland-Pfalz (rejects 0/0 and swapped axes). */
const plausible = (E: number, N: number) => E > 200000 && E < 900000 && N > 5000000 && N < 6200000;

/** Normalise an untrusted object into a SavedParcel, or null. */
export function sanitizeSaved(x: unknown): SavedParcel | null {
  const o = x as Record<string, unknown>;
  if (!o || typeof o !== 'object') return null;
  const E = toFiniteNumber(o.E);
  const N = toFiniteNumber(o.N);
  if (!plausible(E, N)) return null;
  const p = o.props as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object') return null;
  const props: ParcelLabelProps = {
    text: str(p.text, 40).trim(),
    flstkennz: str(p.flstkennz, 40),
    gemarkung: str(p.gemarkung),
    flur: str(p.flur, 40),
    ...(typeof p.lage === 'string' && p.lage ? { lage: str(p.lage) } : {}),
  };
  if (!props.text) return null;
  const source = str(o.source, 80);
  const area = toFiniteNumber(o.flaeche_m2);
  const rings = source === 'wfs' ? cleanRings(o.rings) : null;
  const savedAt = typeof o.savedAt === 'string' && !Number.isNaN(Date.parse(o.savedAt)) ? o.savedAt : new Date(0).toISOString();
  const note = str(o.note, NOTE_MAX).trim();
  return {
    key: parcelKey(props),
    E: r2(E),
    N: r2(N),
    props,
    source,
    ...(Number.isFinite(area) && area > 0 ? { flaeche_m2: r2(area) } : {}),
    ...(rings ? { rings } : {}),
    savedAt,
    ...(note ? { note } : {}),
  };
}

/** A search record → entry to store (rings only for online hits). */
export function toSaved(rec: ParcelRecord, now: Date, note = ''): SavedParcel | null {
  return sanitizeSaved({ ...rec, rings: rec.source === 'wfs' ? rec.rings : undefined, savedAt: now.toISOString(), note });
}

/** Entry → record for `show()`. */
export function savedToRecord(s: SavedParcel): ParcelRecord {
  return {
    E: s.E,
    N: s.N,
    props: { ...s.props },
    source: s.source,
    ...(s.rings ? { rings: s.rings.map((r) => r.map(([E, N]) => [E, N] as [number, number])) } : {}),
    ...(s.flaeche_m2 !== undefined ? { flaeche_m2: s.flaeche_m2 } : {}),
  };
}

/** Newest first, one entry per key (the newer wins), at most `max`. */
export function normalizeList(items: SavedParcel[], max = SAVED_PARCELS_MAX): SavedParcel[] {
  const sorted = [...items].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const seen = new Set<string>();
  const out: SavedParcel[] = [];
  for (const s of sorted) {
    if (seen.has(s.key)) continue;
    seen.add(s.key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export function parseSaved(raw: string | null | undefined): SavedParcel[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    const arr = Array.isArray((data as { parcels?: unknown })?.parcels) ? (data as { parcels: unknown[] }).parcels : [];
    return normalizeList(arr.map(sanitizeSaved).filter((s): s is SavedParcel => s !== null));
  } catch {
    return [];
  }
}

export function isQuotaError(err: unknown): boolean {
  const e = err as { name?: string; code?: number } | null;
  return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
}

/** `window.localStorage` if it can be used (access itself throws in some private modes), else null. */
export function browserStorage(): KV | null {
  try {
    const s = globalThis.localStorage;
    s.getItem(SAVED_PARCELS_KEY);
    return s;
  } catch {
    return null;
  }
}

/** The Merkliste: in-memory list mirrored to storage on every change. */
export class SavedParcels {
  private items: SavedParcel[] = [];
  /** False when storage could not be read or written: the list lives until reload only. */
  persistent: boolean;

  constructor(
    private readonly kv: KV | null,
    private readonly now: () => Date = () => new Date(),
    readonly max = SAVED_PARCELS_MAX,
  ) {
    this.persistent = !!kv;
    this.reload();
  }

  /** Re-read storage (e.g. after a change in another tab). Unreadable storage keeps the current list. */
  reload(): void {
    if (!this.kv) return;
    try {
      this.items = normalizeList(parseSaved(this.kv.getItem(SAVED_PARCELS_KEY)), this.max);
    } catch {
      this.persistent = false;
    }
  }

  list(): readonly SavedParcel[] {
    return this.items;
  }

  get(key: string): SavedParcel | undefined {
    return this.items.find((s) => s.key === key);
  }

  has(rec: ParcelRecord): boolean {
    return !!this.get(parcelKey(rec.props));
  }

  /** Save (or move to the top, keeping its note). `dropped`: oldest entries removed by the cap. */
  add(rec: ParcelRecord): { result: WriteResult; dropped: number } {
    const key = parcelKey(rec.props);
    const s = toSaved(rec, this.now(), this.get(key)?.note);
    if (!s) return { result: 'ok', dropped: 0 };
    const rest = this.items.filter((x) => x.key !== key);
    const dropped = Math.max(0, rest.length + 1 - this.max);
    return { result: this.commit([s, ...rest].slice(0, this.max)), dropped };
  }

  remove(key: string): WriteResult {
    if (!this.get(key)) return 'ok';
    return this.commit(this.items.filter((s) => s.key !== key));
  }

  setNote(key: string, note: string): WriteResult {
    const s = this.get(key);
    if (!s) return 'ok';
    const n = note.trim().slice(0, NOTE_MAX);
    if ((s.note ?? '') === n) return 'ok';
    const edited: SavedParcel = { ...s };
    delete edited.note;
    if (n) edited.note = n;
    return this.commit(this.items.map((x) => (x === s ? edited : x)));
  }

  /** Write `next`; on a full storage the change is undone (the stored list stays as it was). */
  private commit(next: SavedParcel[]): WriteResult {
    if (!this.kv) {
      this.items = next;
      return 'unavailable';
    }
    try {
      this.kv.setItem(SAVED_PARCELS_KEY, JSON.stringify({ version: 1, parcels: next }));
      this.items = next;
      this.persistent = true;
      return 'ok';
    } catch (err) {
      if (isQuotaError(err)) return 'quota';
      this.items = next;
      this.persistent = false;
      return 'unavailable';
    }
  }
}
