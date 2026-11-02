/**
 * Minimal string-based SVG builder (no DOM). All drawing coordinates are paper millimetres
 * (the sheet's viewBox is in mm), so pen widths and text sizes are real print sizes.
 */
export type P2 = [number, number];
export type AttrValue = string | number | undefined | null | false;
export type Attrs = Record<string, AttrValue>;

/** Format a number for SVG output (max 3 decimals, no trailing zeros). */
export function n(x: number, digits = 3): string {
  if (!Number.isFinite(x)) return '0';
  const s = x.toFixed(digits);
  return s.includes('.') ? s.replace(/\.?0+$/, '') || '0' : s;
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function attrs(a: Attrs): string {
  let out = '';
  for (const [k, v] of Object.entries(a)) {
    if (v === undefined || v === null || v === false) continue;
    out += ` ${k}="${typeof v === 'number' ? n(v) : esc(v)}"`;
  }
  return out;
}

export function el(tag: string, a: Attrs = {}, ...children: (string | undefined | null | false)[]): string {
  // `fill` as inline style: the pen classes set fill:none and CSS beats presentation attributes
  if (a.fill !== undefined && a.fill !== null && a.fill !== false) {
    const { fill, style, ...rest } = a;
    a = { ...rest, style: `fill:${fill};${style ?? ''}` };
  }
  const body = children.filter((c): c is string => typeof c === 'string' && c.length > 0).join('');
  return body ? `<${tag}${attrs(a)}>${body}</${tag}>` : `<${tag}${attrs(a)}/>`;
}

export function g(a: Attrs, ...children: (string | undefined | null | false)[]): string {
  return el('g', a, ...children);
}

/** Path data of a polyline / polygon. */
export function d(pts: readonly P2[], closed = false): string {
  if (!pts.length) return '';
  return pts.map((p, i) => `${i ? 'L' : 'M'}${n(p[0])} ${n(p[1])}`).join('') + (closed ? 'Z' : '');
}

export function path(pts: readonly P2[], closed: boolean, a: Attrs = {}): string {
  return el('path', { d: d(pts, closed), ...a });
}

export function line(p: P2, q: P2, a: Attrs = {}): string {
  return el('line', { x1: p[0], y1: p[1], x2: q[0], y2: q[1], ...a });
}

export function rect(x: number, y: number, w: number, h: number, a: Attrs = {}): string {
  return el('rect', { x, y, width: w, height: h, ...a });
}

export function circle(c: P2, r: number, a: Attrs = {}): string {
  return el('circle', { cx: c[0], cy: c[1], r, ...a });
}

/** Text at a point; `size` in mm. Multi-line text with '\n'. */
export function text(p: P2, s: string, a: Attrs & { size?: number; anchor?: 'start' | 'middle' | 'end'; rotate?: number; lh?: number } = {}): string {
  const { size = 2.5, anchor = 'start', rotate, lh = 1.25, ...rest } = a;
  const lines = s.split('\n');
  const tr = rotate ? `rotate(${n(rotate)} ${n(p[0])} ${n(p[1])})` : undefined;
  const body = lines.length === 1 ? esc(s) : lines.map((ln, i) => `<tspan x="${n(p[0])}" dy="${i ? n(size * lh) : 0}">${esc(ln)}</tspan>`).join('');
  return `<text${attrs({ x: p[0], y: p[1], 'font-size': size, 'text-anchor': anchor, transform: tr, ...rest })}>${body}</text>`;
}

/** Rough text width estimate for Helvetica-like fonts (mm). */
export function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) {
    if ('il.,:;|!\'’'.includes(ch)) w += 0.28;
    else if ('ftjrI()[] '.includes(ch)) w += 0.36;
    else if ('mwMWÄÖÜ'.includes(ch)) w += 0.85;
    else if (ch >= 'A' && ch <= 'Z') w += 0.68;
    else w += 0.56;
  }
  return w * size;
}

/** German number format: 2,65 / 1.234,50. */
export function de(x: number, digits = 2): string {
  const neg = x < 0;
  const s = Math.abs(x).toFixed(digits);
  const [i, f] = s.split('.');
  const ig = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '−' : '') + ig + (f ? ',' + f : '');
}

/** Height relative to a datum: "±0,00", "+5,20", "−1,40". */
export function rel(h: number, datum: number): string {
  const r = Math.round((h - datum) * 100) / 100;
  if (Math.abs(r) < 0.005) return '±0,00';
  return (r > 0 ? '+' : '−') + de(Math.abs(r));
}
