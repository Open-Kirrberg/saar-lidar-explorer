/**
 * Flurstücksuche — pure part: parse what people type („Kirrberg 100/2“, „Hassel Flur 6 1405/1“,
 * „Gemarkung Rohrbach, Flst. 12“, a Flurstückskennzeichen, a street name) and rank parcel records.
 * No DOM / three.js — unit-tested in tests/parcelSearch.test.ts.
 *
 * Records come from the parcel label points (contract `vectors.flurstuecke.labels`: text,
 * flstkennz, gemarkung, flur, lage; one point inside each parcel) or from the ALKIS WFS 414.
 */
import type { ParcelLabelProps } from '../data/manifest';

export interface ParcelRecord {
  /** A point inside the parcel (label point), EPSG:25832. */
  E: number;
  N: number;
  props: ParcelLabelProps;
  /** Catalog place id ('' in single-AOI mode, 'wfs' for an online hit). */
  source: string;
  /** Only for online hits: the parcel outline rings ([E, N]). */
  rings?: Array<Array<[number, number]>>;
  /** Only for online hits: amtliche Fläche in m². */
  flaeche_m2?: number;
}

export interface ParcelQuery {
  /** Flurstückskennzeichen prefix (digits and `_`, as in ALKIS `flstkennz`), trailing `_` removed. */
  kennz?: string;
  /** Normalised words that are not numbers / keywords: a Gemarkung or a Lage (street, Gewann). */
  words?: string;
  flur?: number;
  zae?: string;
  nen?: string;
}

/** Lower case, umlauts folded, „Sankt“ → „st“, punctuation → space, single spaces. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\bsankt\b/g, 'st')
    .replace(/[^a-z0-9/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const KEYWORDS = new Set(['gemarkung', 'gmk', 'gem', 'flurstueck', 'flurstuecke', 'flst', 'fl', 'nr', 'nummer', 'no', 'flurstucksnummer', 'flurstuecksnummer']);

/** Parse a search text. Empty / unusable text → {}. */
export function parseParcelQuery(input: string): ParcelQuery {
  const raw = input.trim();
  if (!raw) return {};
  // Flurstückskennzeichen: ≥ 10 characters of digits / '_' (spaces and dashes ignored).
  const compact = raw.replace(/[\s-]+/g, '');
  if (/^\d[\d_]{9,}$/.test(compact)) {
    const k = compact.replace(/_+$/, '');
    return k ? { kennz: k } : {};
  }
  let s = norm(raw).replace(/\s*\/\s*/g, '/');
  const q: ParcelQuery = {};
  // Explicit „Flur 3“.
  const fm = /\bflur (\d+)\b/.exec(s);
  if (fm) {
    q.flur = Number(fm[1]);
    s = (s.slice(0, fm.index) + ' ' + s.slice(fm.index + fm[0].length)).trim();
  }
  const tokens = s.split(' ').filter((t) => t && !KEYWORDS.has(t));
  const words: string[] = [];
  const nums: string[] = [];
  for (const t of tokens) {
    if (/^\d+(\/\d+)?$/.test(t)) nums.push(t);
    else if (/^\d+\/$/.test(t)) nums.push(t.slice(0, -1));
    else if (!/^[\d/]+$/.test(t)) words.push(t);
  }
  if (nums.length) {
    const last = nums[nums.length - 1];
    const [zae, nen] = last.split('/');
    q.zae = String(Number(zae));
    if (nen) q.nen = String(Number(nen));
    // „Kirrberg 3 100/2“: a plain number before the parcel number is the Flur.
    if (q.flur === undefined && nums.length >= 2 && /^\d+$/.test(nums[nums.length - 2])) q.flur = Number(nums[nums.length - 2]);
  }
  if (words.length) q.words = words.join(' ');
  return q;
}

/** True when the query can match anything (a number, a Kennzeichen or at least 3 letters). */
export function isUsableQuery(q: ParcelQuery): boolean {
  return !!(q.kennz || q.zae || (q.words && q.words.replace(/ /g, '').length >= 3));
}

/** Flur number of a record ('Flur 6' → 6); RLP „Flur 0“ / missing → null. */
export function flurNumber(flur: string): number | null {
  const m = /(\d+)\s*$/.exec(flur.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

/** Per-record normalised fields, computed once per index. */
export interface IndexedRecord {
  rec: ParcelRecord;
  gem: string;
  lage: string;
  flur: number | null;
  zae: string;
  nen: string;
  kennz: string;
}

export function indexRecord(rec: ParcelRecord): IndexedRecord {
  const [zae, nen] = rec.props.text.split('/');
  return {
    rec,
    gem: norm(rec.props.gemarkung),
    lage: norm(rec.props.lage ?? ''),
    flur: flurNumber(rec.props.flur),
    zae: String(Number(zae) || zae.trim()),
    nen: nen ? String(Number(nen) || nen.trim()) : '',
    kennz: rec.props.flstkennz.replace(/_+$/, ''),
  };
}

/** How well `words` names this record: Gemarkung exact/prefix/contains, else Lage. 0 = no match. */
function wordScore(words: string, r: IndexedRecord, allowLage: boolean): number {
  if (r.gem === words) return 40;
  if (r.gem.startsWith(words)) return 30;
  if (r.gem.includes(words)) return 20;
  if (allowLage && r.lage) {
    if (r.lage === words) return 18;
    if (r.lage.startsWith(words)) return 14;
    if (r.lage.includes(words)) return 10;
  }
  return 0;
}

export interface ParcelHit {
  rec: ParcelRecord;
  score: number;
}

/**
 * Rank the records for a query. Number given: the Flurnummer must match (ZAE exact; with NEN
 * exact, without NEN also every „ZAE/…“ sub-parcel, ranked lower); words narrow to a Gemarkung
 * (or, without a number, a Lage). Sorted by score, then Gemarkung, Flur, number. At most `limit`.
 */
export function searchParcels(index: readonly IndexedRecord[], q: ParcelQuery, limit = 50): { hits: ParcelHit[]; total: number } {
  if (!isUsableQuery(q)) return { hits: [], total: 0 };
  const out: ParcelHit[] = [];
  for (const r of index) {
    let score = 0;
    if (q.kennz) {
      if (!r.kennz.startsWith(q.kennz)) continue;
      score = r.kennz === q.kennz ? 100 : 50;
    } else {
      if (q.zae) {
        if (r.zae !== q.zae) continue;
        if (q.nen !== undefined) {
          if (r.nen !== q.nen) continue;
          score += 10;
        } else score += r.nen ? 4 : 10;
      }
      if (q.flur !== undefined) {
        // A record without Flur (RLP) still matches, lower.
        if (r.flur !== null && r.flur !== q.flur) continue;
        score += r.flur === q.flur ? 5 : 0;
      }
      if (q.words) {
        const w = wordScore(q.words, r, !q.zae);
        if (!w) continue;
        score += w;
      }
    }
    out.push({ rec: r.rec, score });
  }
  out.sort(
    (a, b) =>
      b.score - a.score ||
      a.rec.props.gemarkung.localeCompare(b.rec.props.gemarkung, 'de') ||
      (flurNumber(a.rec.props.flur) ?? 0) - (flurNumber(b.rec.props.flur) ?? 0) ||
      a.rec.props.text.localeCompare(b.rec.props.text, 'de', { numeric: true }),
  );
  return { hits: out.slice(0, limit), total: out.length };
}

/** Parse a label FeatureCollection (contract `flurstuecke.labels`) into records; bad features skipped. */
export function parseLabelRecords(fc: unknown, source: string): ParcelRecord[] {
  const feats = (fc as { features?: unknown })?.features;
  if (!Array.isArray(feats)) return [];
  const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
  const out: ParcelRecord[] = [];
  for (const f of feats as Array<{ geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> | null }>) {
    const c = f?.geometry?.coordinates as unknown[] | undefined;
    if (f?.geometry?.type !== 'Point' || !Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    const p = f.properties ?? {};
    const text = str(p.text);
    if (!text) continue;
    const lage = str(p.lage);
    out.push({
      E: c[0] as number,
      N: c[1] as number,
      source,
      props: { text, flstkennz: str(p.flstkennz), gemarkung: str(p.gemarkung), flur: str(p.flur), ...(lage ? { lage } : {}) },
    });
  }
  return out;
}

// ---- online: ALKIS Saarland WFS 414 (CORS *, dl-de/by-2-0, no owner data) ---------------------------

const WFS_414 = 'https://geoportal.saarland.de/registry/wfs/414';

const xmlEsc = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
const fesEq = (prop: string, v: string) =>
  `<fes:PropertyIsEqualTo><fes:ValueReference>${prop}</fes:ValueReference><fes:Literal>${xmlEsc(v)}</fes:Literal></fes:PropertyIsEqualTo>`;
const fesFilter = (parts: string[]) =>
  `<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0">${parts.length > 1 ? `<fes:And>${parts.join('')}</fes:And>` : parts[0]}</fes:Filter>`;

function wfsUrl(params: Record<string, string>): string {
  return `${WFS_414}?${new URLSearchParams({ SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature', OUTPUTFORMAT: 'GEOJSON', ...params }).toString()}`;
}

/** A Saarland Gemarkung (ALKIS Katasterbezirk, ART „Gemarkung“). */
export interface Gemarkung {
  name: string;
  /** Gemarkungsschlüssel, e.g. „102100“ (= Flurstueck GEMASCHL). */
  key: string;
  gemeinde: string;
}

/**
 * All Saarland Gemarkungen, names only (no geometry, ≈ 80 KB). The service only answers exact
 * comparisons (PropertyIsLike → 403), so free text is mapped to a Gemarkungsschlüssel first.
 */
export function gemarkungListUrl(): string {
  return wfsUrl({
    TYPENAMES: 'ALKIS_ALKIS_WFS_ohne_Eig:Katasterbezirk',
    COUNT: '2000',
    PROPERTYNAME: 'NAME,SCHLUESSEL,GEMEINDE,ART',
    FILTER: fesFilter([fesEq('ART', 'Gemarkung')]),
  });
}

/**
 * Parse the Gemarkung list. Without geometry the service writes `"geometry":{"type":"MultiPolygon",}`
 * (invalid JSON), so trailing commas before `}` / `]` are removed first. Deduplicated by key, sorted.
 */
export function parseGemarkungList(text: string): Gemarkung[] {
  const fc = JSON.parse(text.replace(/,\s*([}\]])/g, '$1')) as { features?: Array<{ properties?: Record<string, unknown> }> };
  const byKey = new Map<string, Gemarkung>();
  for (const f of fc.features ?? []) {
    const p = f?.properties ?? {};
    const name = String(p.NAME ?? '').trim();
    const key = String(p.SCHLUESSEL ?? '').trim();
    if (!name || !/^\d{6}$/.test(key) || (p.ART !== undefined && p.ART !== 'Gemarkung')) continue;
    if (!byKey.has(key)) byKey.set(key, { name, key, gemeinde: String(p.GEMEINDE ?? '').trim() });
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** Gemarkungen named by `words` (normalised): exact names, else prefixes, else substrings; at most `max`. */
export function matchGemarkungen(list: readonly Gemarkung[], words: string, max = 5): Gemarkung[] {
  const w = norm(words);
  if (w.length < 3) return [];
  for (const test of [(n: string) => n === w, (n: string) => n.startsWith(w), (n: string) => n.includes(w)]) {
    const hit = list.filter((g) => test(norm(g.name)));
    if (hit.length) return hit.slice(0, max);
  }
  return [];
}

/** Can the online search run for this query? (Kennzeichen, or Gemarkung words plus a number.) */
export function canSearchOnline(q: ParcelQuery): boolean {
  return !!(q.kennz && q.kennz.length >= 14) || !!(q.zae && q.words && q.words.replace(/ /g, '').length >= 3);
}

/**
 * GetFeature URL for the parcels of a query in the given Gemarkungen (exact comparisons only), or
 * null. Kennzeichen: padded with `_` to the 20 ALKIS characters. At most `count` features.
 */
export function wfsSearchUrl(q: ParcelQuery, gemarkungen: readonly Gemarkung[], count = 30): string | null {
  let filter: string;
  if (q.kennz) {
    if (q.kennz.length < 14 || q.kennz.length > 20) return null;
    filter = fesFilter([fesEq('FLSTKENNZ', q.kennz.padEnd(20, '_'))]);
  } else {
    if (!q.zae || !gemarkungen.length) return null;
    const gem = gemarkungen.map((g) => fesEq('GEMASCHL', g.key));
    const parts = [gem.length > 1 ? `<fes:Or>${gem.join('')}</fes:Or>` : gem[0], fesEq('FLSTNRZAE', q.zae)];
    if (q.nen !== undefined) parts.push(fesEq('FLSTNRNEN', q.nen));
    if (q.flur !== undefined) parts.push(fesEq('FLUR', `Flur ${q.flur}`));
    filter = fesFilter(parts);
  }
  return wfsUrl({
    TYPENAMES: 'ALKIS_ALKIS_WFS_ohne_Eig:Flurstueck',
    SRSNAME: 'urn:ogc:def:crs:EPSG::25832',
    COUNT: String(count),
    FILTER: filter,
  });
}

type Ring = Array<[number, number]>;

/** Rings of a (Multi)Polygon geometry ([E, N] only); unusable geometry → []. */
export function geometryRings(g: { type?: string; coordinates?: unknown } | null | undefined): Ring[] {
  const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? (g.coordinates as unknown[]) : [];
  const out: Ring[] = [];
  for (const poly of polys ?? []) {
    if (!Array.isArray(poly)) continue;
    for (const ring of poly) {
      if (!Array.isArray(ring)) continue;
      const r: Ring = [];
      for (const c of ring) if (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])) r.push([c[0], c[1]]);
      if (r.length >= 3) out.push(r);
    }
  }
  return out;
}

/** A point inside the outer ring of the largest polygon (bbox centre if inside, else the vertex mean, else the first vertex). */
export function pointInside(rings: Ring[]): [number, number] | null {
  if (!rings.length) return null;
  const area = (r: Ring) => Math.abs(r.reduce((s, [x, y], i) => { const [x2, y2] = r[(i + 1) % r.length]; return s + x * y2 - x2 * y; }, 0)) / 2;
  const outer = rings.reduce((a, b) => (area(b) > area(a) ? b : a));
  const inRing = (x: number, y: number) => {
    let inside = false;
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
      const [xi, yi] = outer[i];
      const [xj, yj] = outer[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const xs = outer.map((c) => c[0]);
  const ys = outer.map((c) => c[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  if (inRing(cx, cy)) return [cx, cy];
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  if (inRing(mx, my)) return [mx, my];
  // Scan the bbox's middle row for an inside point.
  for (let k = 1; k < 20; k++) {
    const x = Math.min(...xs) + ((Math.max(...xs) - Math.min(...xs)) * k) / 20;
    if (inRing(x, cy)) return [x, cy];
  }
  return outer[0];
}

/** WFS 414 GeoJSON → records (with rings and Fläche). FLSTNRNEN may be the string 'null'. */
export function parseWfsRecords(fc: unknown): ParcelRecord[] {
  const feats = (fc as { features?: unknown })?.features;
  if (!Array.isArray(feats)) return [];
  const str = (v: unknown) => {
    const t = v === null || v === undefined ? '' : String(v).trim();
    return t === 'null' ? '' : t;
  };
  const out: ParcelRecord[] = [];
  for (const f of feats as Array<{ geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> | null }>) {
    const p = f?.properties ?? {};
    const zae = str(p.FLSTNRZAE);
    if (!zae) continue;
    const nen = str(p.FLSTNRNEN);
    const rings = geometryRings(f?.geometry);
    const pt = pointInside(rings);
    if (!pt) continue;
    const lage = str(p.LAGEBEZTXT);
    const fl = Number(p.FLAECHE);
    out.push({
      E: pt[0],
      N: pt[1],
      source: 'wfs',
      rings,
      ...(Number.isFinite(fl) && fl > 0 ? { flaeche_m2: fl } : {}),
      props: {
        text: nen ? `${zae}/${nen}` : zae,
        flstkennz: str(p.FLSTKENNZ),
        gemarkung: str(p.GEMARKUNG),
        flur: str(p.FLUR),
        ...(lage ? { lage } : {}),
      },
    });
  }
  return out;
}

/** Bounding box [minE, minN, maxE, maxN] of rings, or null. */
export function ringsBbox(rings: Ring[]): [number, number, number, number] | null {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const r of rings) for (const [E, N] of r) { if (E < a) a = E; if (N < b) b = N; if (E > c) c = E; if (N > d) d = N; }
  return Number.isFinite(a) ? [a, b, c, d] : null;
}

/** „830 m²“ / „1,25 ha“. */
export function fmtArea(m2: number): string {
  if (m2 >= 10000) return `${(m2 / 10000).toLocaleString('de-DE', { maximumFractionDigits: 2 })} ha`;
  return `${Math.round(m2).toLocaleString('de-DE')} m²`;
}
