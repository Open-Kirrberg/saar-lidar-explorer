/**
 * Built twins (ADR 0042, zone contract „twin.catalogue“): the zone's info-card catalogue `sle-zone-catalogue-v1`
 * and the pure parts of picking and discovery. No three.js, no DOM: the runtime (`runtime/twinPick.ts`,
 * `runtime/twinUi.ts`) wires it into the glTF zone.
 *
 * - `parseZoneCatalogue`: tolerant parse (bad rows dropped, strings are text, never HTML).
 * - `resolveTarget` / `groupTarget`: glTF node chain → clickable target (a product slot, or the nearest catalogue
 *   object by node ancestors and id prefixes), grouped while the visitor is far away.
 * - `formatPriceEur`, `saleUnitDe`, `categoryDe`, `firstSentences`: card text.
 * - `DiscoveryStore`: „entdeckt x / y“, stored on this device only (ADR 0022), every storage access guarded.
 * - Fills (zone contract „Fills“): switchable shop states (*Morgens* / *Feierabend*): `fillShows` (which nodes are
 *   drawn in a state) and `discoverableIn` (what counts there).
 * - Tour (zone contract „Tour“): the optional guided tour, parsed by `tour.ts` `parseTour`.
 */
import { parseTour } from './tour';
import type { ZoneTour } from './tour';

export const CATALOGUE_FORMAT = 'sle-zone-catalogue-v1';

export interface CatalogueObject {
  name_de: string;
  info_de: string;
  /** Picked together with this object (the target while the visitor is farther than `GROUP_NEAR_M`). */
  group?: string;
}

export interface CatalogueProduct {
  name_de: string;
  short_de: string;
  info_de: string;
  category: string;
  /** null when the package has no price consent or the source has no price. */
  price_eur: number | null;
  sale_unit: string | null;
}

/** One switchable shop state (a product fill). */
export interface ZoneFill {
  id: string;
  /** Toggle label. */
  name_de: string;
  /** Tooltip ('' = none). */
  info_de: string;
  /** Known product ids placed in this state. */
  products: ReadonlySet<string>;
}

export interface ZoneCatalogue {
  consent: { prices: boolean };
  objects: Map<string, CatalogueObject>;
  products: Map<string, CatalogueProduct>;
  /** What counts for „entdeckt x / y“: catalogue object ids and product ids (deduplicated, all known; all fills). */
  discoverable: string[];
  /** Switchable fills (≥ 2 valid states), else null: no toggle, every node drawn. */
  fills: { default: string; states: ZoneFill[] } | null;
  /** The guided tour (≥ 2 valid stops), else null / missing: no tour button. */
  tour?: ZoneTour | null;
}

/** Catalogue / slot id: lower-case segments joined by `/` (catalogue README). */
const ID_RE = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const isCatalogueId = (v: unknown): v is string => typeof v === 'string' && v.length <= 160 && ID_RE.test(v);

/** Trimmed text of at most `max` chars, or '' (control characters dropped). */
function text(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const t = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export const MAX_PRICE_EUR = 10_000;

/**
 * Tolerant parse of `built/catalogue.json`. Wrong `schema` or not an object → null (the zone then has no cards).
 * A row without `name_de` is dropped; an object needs `info_de`; a `group` must name another object.
 * Prices are kept only with `consent.prices === true` (ADR 0044).
 */
export function parseZoneCatalogue(raw: unknown, warn: (m: string) => void = () => {}): ZoneCatalogue | null {
  if (!isObj(raw) || raw.schema !== CATALOGUE_FORMAT) {
    warn(`catalogue: schema must be "${CATALOGUE_FORMAT}", ignored`);
    return null;
  }
  const prices = isObj(raw.consent) && raw.consent.prices === true;
  const objects = new Map<string, CatalogueObject>();
  const products = new Map<string, CatalogueProduct>();
  let dropped = 0;
  if (isObj(raw.objects)) {
    for (const [id, r] of Object.entries(raw.objects)) {
      const name_de = isObj(r) ? text(r.name_de, 80) : '';
      const info_de = isObj(r) ? text(r.info_de, 400) : '';
      if (!isCatalogueId(id) || !name_de || !info_de) {
        dropped++;
        continue;
      }
      const o: CatalogueObject = { name_de, info_de };
      if (isObj(r) && isCatalogueId(r.group) && r.group !== id) o.group = r.group;
      objects.set(id, o);
    }
  }
  for (const [id, o] of objects) if (o.group && !objects.has(o.group)) delete objects.get(id)!.group;
  if (isObj(raw.products)) {
    for (const [id, r] of Object.entries(raw.products)) {
      const name_de = isObj(r) ? text(r.name_de, 80) : '';
      if (!isCatalogueId(id) || !isObj(r) || !name_de) {
        dropped++;
        continue;
      }
      const p = r.price_eur;
      const price = prices && typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= MAX_PRICE_EUR ? p : null;
      products.set(id, {
        name_de,
        short_de: text(r.short_de, 200),
        info_de: text(r.info_de, 400),
        category: text(r.category, 40),
        price_eur: price,
        sale_unit: text(r.sale_unit, 40) || null,
      });
    }
  }
  if (dropped) warn(`catalogue: ${dropped} invalid row(s) dropped`);
  const seen = new Set<string>();
  const discoverable: string[] = [];
  if (Array.isArray(raw.discoverable)) {
    for (const id of raw.discoverable) {
      if (typeof id !== 'string' || seen.has(id) || !(objects.has(id) || products.has(id))) continue;
      seen.add(id);
      discoverable.push(id);
    }
  }
  return { consent: { prices }, objects, products, discoverable, fills: parseFills(raw.fills, products, warn), tour: parseTour(raw.tour, objects, warn) };
}

const FILL_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** `fills` of the catalogue: ≥ 2 valid, unique states, else null. Unknown products are dropped. */
function parseFills(raw: unknown, products: ReadonlyMap<string, CatalogueProduct>, warn: (m: string) => void): ZoneCatalogue['fills'] {
  if (raw === undefined || raw === null) return null;
  const states: ZoneFill[] = [];
  if (isObj(raw) && Array.isArray(raw.states)) {
    for (const r of raw.states) {
      const id = isObj(r) && typeof r.id === 'string' && FILL_ID_RE.test(r.id) ? r.id : '';
      const name_de = isObj(r) ? text(r.name_de, 40) : '';
      if (!id || !name_de || states.some((s) => s.id === id)) continue;
      const list = isObj(r) && Array.isArray(r.products) ? r.products : [];
      const ps = new Set<string>();
      for (const p of list) if (typeof p === 'string' && products.has(p)) ps.add(p);
      states.push({ id, name_de, info_de: isObj(r) ? text(r.info_de, 300) : '', products: ps });
    }
  }
  if (states.length < 2) {
    warn('catalogue: fills need at least 2 valid states, no toggle');
    return null;
  }
  const d = isObj(raw) ? raw.default : undefined;
  return { default: states.some((s) => s.id === d) ? (d as string) : states[0]!.id, states };
}

/**
 * Is a node with these extras drawn in fill state `fill`? Nodes without a `fills` list (everything but the
 * products) are always drawn; so is everything when the catalogue has no fills (`fill` null).
 */
export function fillShows(fills: unknown, fill: string | null): boolean {
  if (fill === null || !Array.isArray(fills)) return true;
  return fills.includes(fill);
}

/** What counts for „entdeckt x / y“ in fill state `fill`: the objects + the products placed in that state. */
export function discoverableIn(cat: Pick<ZoneCatalogue, 'discoverable' | 'fills' | 'products'>, fill: string | null): string[] {
  const st = fill === null ? undefined : cat.fills?.states.find((s) => s.id === fill);
  if (!st) return cat.discoverable;
  return cat.discoverable.filter((id) => !cat.products.has(id) || st.products.has(id));
}

// ---- picking ---------------------------------------------------------------------------------------------

/** What a glTF node carries (its `extras`, three's `userData`), nearest node first. */
export interface NodeExtras {
  id?: unknown;
  product?: unknown;
}

export type PickTarget =
  /** `key` = the slot id (one target per slot / basket), `product` = the product id. */
  | { kind: 'product'; key: string; product: string }
  /** `key` = the catalogue object id. */
  | { kind: 'object'; key: string };

/** `a/b/c` → `a/b` → `a` → ''. */
export const parentId = (id: string): string => {
  const i = id.lastIndexOf('/');
  return i < 0 ? '' : id.slice(0, i);
};

/**
 * Resolve a node chain (the hit mesh first, then its ancestors) to a target: the nearest node with a known
 * `product` is a product slot; otherwise the nearest `id`, or its nearest prefix (`theke/faecher` → `theke`),
 * that is a catalogue object. null = not clickable.
 */
export function resolveTarget(chain: readonly NodeExtras[], cat: Pick<ZoneCatalogue, 'objects' | 'products'>): PickTarget | null {
  for (const n of chain) {
    if (typeof n.product === 'string' && cat.products.has(n.product)) {
      return { kind: 'product', key: isCatalogueId(n.id) ? n.id : `produkt:${n.product}`, product: n.product };
    }
  }
  for (const n of chain) {
    if (!isCatalogueId(n.id)) continue;
    for (let id = n.id; id; id = parentId(id)) if (cat.objects.has(id)) return { kind: 'object', key: id };
  }
  return null;
}

/** Below this distance (m) a grouped object is its own target; farther away its group is (style.md: 44 px targets). */
export const GROUP_NEAR_M = 2.5;

/** The target actually used at `distance` m: an object with a `group` is picked as that group while far away. */
export function groupTarget(t: PickTarget, distance: number, cat: Pick<ZoneCatalogue, 'objects'>): PickTarget {
  if (t.kind !== 'object' || distance <= GROUP_NEAR_M) return t;
  const g = cat.objects.get(t.key)?.group;
  return g && cat.objects.has(g) ? { kind: 'object', key: g } : t;
}

/** The id that counts for discovery: the product for a slot, the object id otherwise. */
export const discoveryId = (t: PickTarget): string => (t.kind === 'product' ? t.product : t.key);

/**
 * Enclosing targets (a room, a facade, the terrain) are never highlighted: their box is wider than
 * `ENCLOSING_M` both ways and taller than `ENCLOSING_H_M`, or longer than `HUGE_M`. They still block picks.
 */
export const ENCLOSING_M = 3;
export const ENCLOSING_H_M = 1.5;
export const HUGE_M = 12;
export const isEnclosing = (sx: number, sy: number, sz: number): boolean => (sx > ENCLOSING_M && sz > ENCLOSING_M && sy > ENCLOSING_H_M) || Math.max(sx, sz) > HUGE_M;

// ---- card text -------------------------------------------------------------------------------------------

/** 1.2 → "1,20 €" (de-DE, thousands with ".", no-break space before €). */
export function formatPriceEur(eur: number): string {
  const cents = Math.round(eur * 100);
  const int = Math.floor(Math.abs(cents) / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const frac = String(Math.abs(cents) % 100).padStart(2, '0');
  return `${cents < 0 ? '−' : ''}${int},${frac} €`;
}

/** Sale unit as shown under the price: "Laib" → "pro Laib", "1/4" → "pro Viertel", "ganzer Kuchen" stays. */
export function saleUnitDe(unit: string | null): string {
  if (!unit) return '';
  if (unit === '1/4') return 'pro Viertel';
  if (/^ganze[rs]?\s/i.test(unit)) return unit;
  return `pro ${unit}`;
}

const CATEGORY_DE: Record<string, string> = {
  brot: 'Brot',
  baguette: 'Baguette',
  broetchen: 'Brötchen',
  snacks: 'Snacks',
  teilchen: 'Teilchen',
  kuchen: 'Kuchen',
  torten: 'Torten',
};

/** Category id → chip label (unknown ids: first letter upper case). */
export const categoryDe = (c: string): string => CATEGORY_DE[c] ?? (c ? c[0]!.toUpperCase() + c.slice(1) : '');

/** At most `n` sentences of `t` (cut after ". ", "! ", "? "). */
export function firstSentences(t: string, n: number): string {
  const re = /[.!?…](?=\s+\S)/g;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) if (++count === n) return t.slice(0, m.index + 1);
  return t;
}

export interface CardData {
  key: string;
  discovery: string;
  title: string;
  /** 1–3 short sentences (products: the short text + one sentence). */
  text: string;
  /** Products only. */
  chip?: string;
  price?: string;
  unit?: string;
}

/** What the info card shows for a target (null: unknown id). */
export function cardFor(t: PickTarget, cat: ZoneCatalogue): CardData | null {
  if (t.kind === 'product') {
    const p = cat.products.get(t.product);
    if (!p) return null;
    const lead = p.short_de || firstSentences(p.info_de, 1);
    const rest = p.short_de ? firstSentences(p.info_de, 1) : firstSentences(p.info_de.slice(lead.length).trim(), 1);
    const card: CardData = { key: t.key, discovery: t.product, title: p.name_de, text: [lead, rest].filter(Boolean).join(' ') };
    if (p.category) card.chip = categoryDe(p.category);
    if (p.price_eur !== null) {
      card.price = formatPriceEur(p.price_eur);
      const u = saleUnitDe(p.sale_unit);
      if (u) card.unit = u;
    }
    return card;
  }
  const o = cat.objects.get(t.key);
  return o ? { key: t.key, discovery: t.key, title: o.name_de, text: firstSentences(o.info_de, 3) } : null;
}

// ---- discovery („entdeckt x / y“, ADR 0022: this device only) ---------------------------------------------

/** Minimal Storage subset (localStorage-compatible), injectable for tests. */
export interface DiscoveryKV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export const DISCOVERY_KEY_PREFIX = 'sle.zones.entdeckt.v1.';
export const discoveryStorageKey = (zoneId: string): string => `${DISCOVERY_KEY_PREFIX}${zoneId}`;

export class DiscoveryStore {
  private readonly ids = new Set<string>();
  private wanted: ReadonlySet<string>;
  private readonly key: string;

  constructor(
    private readonly kv: DiscoveryKV | null,
    zoneId: string,
    discoverable: readonly string[],
  ) {
    this.key = discoveryStorageKey(zoneId);
    this.wanted = new Set(discoverable);
    try {
      const raw = kv?.getItem(this.key);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      const list = isObj(parsed) && Array.isArray(parsed.ids) ? parsed.ids : [];
      for (const id of list) if (typeof id === 'string' && id.length <= 160) this.ids.add(id);
    } catch {
      /* blocked storage or broken JSON: start empty */
    }
  }

  get total(): number {
    return this.wanted.size;
  }

  /** What counts from now on (a fill switch); found ids are kept and count again once they are wanted. */
  setDiscoverable(discoverable: readonly string[]): void {
    this.wanted = new Set(discoverable);
  }

  /** Found ids that still count (ids no longer discoverable stay stored but do not count). */
  get found(): number {
    let n = 0;
    for (const id of this.wanted) if (this.ids.has(id)) n++;
    return n;
  }

  counts(id: string): boolean {
    return this.wanted.has(id);
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  /** Mark `id` as opened; true when it counts and is new. Storage failure keeps it in memory for this visit. */
  mark(id: string): boolean {
    if (!this.wanted.has(id) || this.ids.has(id)) return false;
    this.ids.add(id);
    this.save();
    return true;
  }

  reset(): void {
    this.ids.clear();
    try {
      if (this.kv?.removeItem) this.kv.removeItem(this.key);
      else this.kv?.setItem(this.key, JSON.stringify({ v: 1, ids: [] }));
    } catch {
      /* in memory only */
    }
  }

  private save(): void {
    try {
      this.kv?.setItem(this.key, JSON.stringify({ v: 1, ids: [...this.ids].sort() }));
    } catch {
      /* in memory only */
    }
  }
}
