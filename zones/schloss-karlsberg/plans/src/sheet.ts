/**
 * Plan sheet: paper size, frame, title block (Schriftfeld, German), legend, scale bar, north
 * arrow, sources/licence block. Everything in paper millimetres.
 *
 * Pen weights (ISO 128 series): xs 0.13 · s 0.18 · m 0.25 · l 0.35 · xl 0.50 · xxl 0.70 mm.
 * Line types: solid = visible/cut, dashed `.hid` = hidden / above the cut plane,
 * dotted `.hyp` = hypothetical outline, dash-dot `.axis` = axes and section lines.
 */
import { gridConvergenceDeg } from '../../model/src/frame.ts';
import { type P2, circle, de, el, esc, g, line, path, rect, text, textWidth } from './svg.ts';
import { scaleBarSteps } from './geom/transform.ts';

export const STAND = '2026-11-01';
export const PROJECT_TITLE = 'Schloss Karlsberg um 1789 — Rekonstruktionshypothese';

export type SheetSize = 'A3' | 'A2' | 'A2-hoch' | 'A3-hoch';
export const SHEET_MM: Record<SheetSize, [number, number]> = {
  A3: [420, 297],
  'A3-hoch': [297, 420],
  A2: [594, 420],
  'A2-hoch': [420, 594],
};

/** Frame margins: 20 mm binding margin left (DIN 824), 10 mm elsewhere. */
export const MARGIN = { left: 20, right: 10, top: 10, bottom: 10 };
export const TITLE_W = 185;
export const TITLE_H = 64;

export const STYLE = `
.pen-xs{stroke:#000;stroke-width:.13;fill:none}
.pen-s{stroke:#000;stroke-width:.18;fill:none}
.pen-m{stroke:#000;stroke-width:.25;fill:none}
.pen-l{stroke:#000;stroke-width:.35;fill:none}
.pen-xl{stroke:#000;stroke-width:.5;fill:none}
.pen-xxl{stroke:#000;stroke-width:.7;fill:none}
.hid{stroke-dasharray:1.2 .8}
.hyp{stroke-dasharray:.5 .7}
.axis{stroke-dasharray:5 1 .6 1}
.grey{stroke:#777}
.red{stroke:#b3261e}
.blue{stroke:#2c5d8a}
text{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;fill:#111}
.halo{paint-order:stroke;stroke:#fff;stroke-width:.55;stroke-linejoin:round}
.halo-l{paint-order:stroke;stroke:#fff;stroke-width:1.1;stroke-linejoin:round}
.b{font-weight:700}
.i{font-style:italic}
.dim{fill:#111}
.muted{fill:#555}
.poche-d{fill:#1d1d1d;stroke:none}
.poche-i{fill:url(#hatch-i);stroke:none}
.void{fill:url(#hatch-u);stroke:none}
`;

export const DEFS = `
<pattern id="hatch-i" patternUnits="userSpaceOnUse" width="0.9" height="0.9" patternTransform="rotate(45)"><rect width="0.9" height="0.9" fill="#d9d9d9"/><line x1="0" y1="0" x2="0" y2="0.9" stroke="#444" stroke-width="0.22"/></pattern>
<pattern id="hatch-u" patternUnits="userSpaceOnUse" width="1.6" height="1.6"><rect width="1.6" height="1.6" fill="#fff"/><circle cx="0.8" cy="0.8" r="0.12" fill="#888"/></pattern>
<pattern id="hatch-earth" patternUnits="userSpaceOnUse" width="1.4" height="1.4" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="1.4" stroke="#6b5a45" stroke-width="0.15"/></pattern>
<pattern id="hatch-low" patternUnits="userSpaceOnUse" width="1.2" height="1.2" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="1.2" stroke="#9a4a2a" stroke-width="0.18"/></pattern>
<pattern id="hatch-roof" patternUnits="userSpaceOnUse" width="1.0" height="1.0" patternTransform="rotate(90)"><line x1="0" y1="0" x2="0" y2="1" stroke="#8a8f96" stroke-width="0.1"/></pattern>
<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="2.6" markerHeight="2.6" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L10 5L0 10z" fill="#000"/></marker>
`;

export interface LegendItem {
  /** SVG snippet drawn into a 10 x 4 mm swatch with origin at its top-left. */
  swatch: (x: number, y: number) => string;
  label: string;
}

export interface TitleInfo {
  sheetNo: string;
  title: string;
  subtitle?: string;
  scale: string;
  /** Free lines below the title (confidence, datum ...). */
  info?: string[];
}

export class Sheet {
  readonly w: number;
  readonly h: number;
  private layers: string[] = [];
  private extraDefs: string[] = [];
  constructor(
    readonly size: SheetSize,
    readonly id: string,
  ) {
    [this.w, this.h] = SHEET_MM[size];
  }

  /** Inner drawing area (inside the frame). */
  get area() {
    return { x0: MARGIN.left, y0: MARGIN.top, x1: this.w - MARGIN.right, y1: this.h - MARGIN.bottom };
  }

  /** Title block rectangle (bottom right). */
  get titleBox() {
    const a = this.area;
    return { x0: a.x1 - TITLE_W, y0: a.y1 - TITLE_H, x1: a.x1, y1: a.y1 };
  }

  add(svg: string): void {
    this.layers.push(svg);
  }

  defs(svg: string): void {
    this.extraDefs.push(svg);
  }

  frame(): void {
    const a = this.area;
    this.add(rect(a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0, { class: 'pen-xl' }));
    // folding / cut marks at the paper corners
    this.add(rect(0.5, 0.5, this.w - 1, this.h - 1, { class: 'pen-xs grey' }));
  }

  titleBlock(t: TitleInfo): void {
    const b = this.titleBox;
    const x = b.x0;
    const y = b.y0;
    const p: string[] = [];
    p.push(rect(x, y, TITLE_W, TITLE_H, { fill: '#fff', class: 'pen-l' }));
    p.push(text([x + 3, y + 6], PROJECT_TITLE, { size: 3.4, class: 'b' }));
    p.push(text([x + 3, y + 10.2], 'Residenz Herzog Karls II. August von Pfalz-Zweibrücken, Homburg (Saar) · erbaut 1778–1788, zerstört 1793', { size: 1.75, class: 'muted' }));
    p.push(line([x, y + 12.5], [x + TITLE_W, y + 12.5], { class: 'pen-m' }));
    p.push(text([x + 3, y + 18.5], t.title, { size: 4.2, class: 'b' }));
    if (t.subtitle) p.push(text([x + 3, y + 23.2], t.subtitle, { size: 2.2 }));
    let yy = y + 27.5;
    for (const ln of t.info ?? []) {
      p.push(text([x + 3, yy], ln, { size: 1.8 }));
      yy += 2.5;
    }
    // cells
    const cy = y + TITLE_H - 22;
    p.push(line([x, cy], [x + TITLE_W, cy], { class: 'pen-m' }));
    const cells: [string, string][] = [
      ['Maßstab', t.scale],
      ['Blatt', t.sheetNo],
      ['Format', this.size.replace('-hoch', ' hoch')],
      ['Stand', STAND],
    ];
    const cw = TITLE_W / cells.length;
    cells.forEach(([k, v], i) => {
      const cx = x + i * cw;
      if (i) p.push(line([cx, cy], [cx, cy + 10], { class: 'pen-s' }));
      p.push(text([cx + 2, cy + 3.2], k, { size: 1.6, class: 'muted' }));
      p.push(text([cx + 2, cy + 8.3], v, { size: 3.2, class: 'b' }));
    });
    p.push(line([x, cy + 10], [x + TITLE_W, cy + 10], { class: 'pen-s' }));
    p.push(text([x + 3, cy + 13.6], 'Lagebezug ETRS89 / UTM 32N (EPSG:25832) · Höhen DHHN2016 in m ü. NHN (wahre Höhen, keine Überhöhung)', { size: 1.65 }));
    p.push(text([x + 3, cy + 16.4], 'Grundlage: Katalog v2 (model/catalogue.json) + gemeinsames Layout (model/src/layout) · erzeugt mit plans/src', { size: 1.65 }));
    p.push(text([x + 3, cy + 20.0], `HYPOTHESE – Stand ${STAND} · kein Aufmaß · Schauen, nicht graben (Bodendenkmal, SDschG)`, { size: 1.9, class: 'b' }));
    this.add(g({ id: 'titleblock' }, ...p));
  }

  /** Legend box with a heading; returns its height. Anchored at its bottom-left. */
  legend(x: number, yBottom: number, width: number, heading: string, items: LegendItem[], cols = 1): number {
    const rowH = 4.6;
    const rows = Math.ceil(items.length / cols);
    const h = 7 + rows * rowH + 1.5;
    const y = yBottom - h;
    const p: string[] = [rect(x, y, width, h, { fill: '#fff', class: 'pen-m' }), text([x + 2.5, y + 4.6], heading, { size: 2.4, class: 'b' })];
    const colW = width / cols;
    items.forEach((it, i) => {
      const c = Math.floor(i / rows);
      const r = i % rows;
      const sx = x + 2.5 + c * colW;
      const sy = y + 7 + r * rowH;
      p.push(it.swatch(sx, sy));
      p.push(text([sx + 12.5, sy + 3.1], it.label, { size: 1.85 }));
    });
    this.add(g({ class: 'legend' }, ...p));
    return h;
  }

  /** Free text block (sources, notes) anchored bottom-left; returns its height. */
  note(x: number, yBottom: number, width: number, heading: string, lines: string[], size = 1.6): number {
    const wrapped = lines.flatMap((l) => wrap(l, width - 5, size));
    const h = 6.5 + wrapped.length * size * 1.3 + 1.5;
    const y = yBottom - h;
    this.add(
      g(
        { class: 'note' },
        rect(x, y, width, h, { fill: '#fff', class: 'pen-m' }),
        text([x + 2.5, y + 4.3], heading, { size: 2.2, class: 'b' }),
        ...wrapped.map((l, i) => text([x + 2.5, y + 7.8 + i * size * 1.3], l, { size })),
      ),
    );
    return h;
  }

  /** Top of the bottom band (title block, legend, notes); drawings stay above it. */
  get bandTop(): number {
    return this.area.y1 - TITLE_H;
  }

  /**
   * Standard bottom band: [info column: lines + scale bar] [legend over notes] [title block].
   * `infoW` = width of the info column (0 = none).
   */
  band(o: { title: TitleInfo; legend: LegendItem[]; legendCols?: number; notes: string[]; info?: string[]; scale?: number; infoW?: number; noteSize?: number }): void {
    const a = this.area;
    const top = this.bandTop;
    this.add(line([a.x0, top], [this.titleBox.x0, top], { class: 'pen-m' }));
    const infoW = o.infoW ?? (o.info || o.scale ? 64 : 0);
    if (infoW) {
      const p: string[] = [];
      (o.info ?? []).forEach((l, i) => p.push(text([a.x0 + 3, top + 6 + i * 4], l, { size: i === 0 ? 2.6 : 1.8, class: i === 0 ? 'b' : undefined })));
      if (o.scale) p.push(scaleBar([a.x0 + 4, a.y1 - 11], o.scale, infoW - 14));
      this.add(g({ class: 'info' }, ...p));
      this.add(line([a.x0 + infoW, top], [a.x0 + infoW, a.y1], { class: 'pen-s' }));
    }
    const x0 = a.x0 + infoW + 2;
    const w = this.titleBox.x0 - x0 - 2;
    const lh = this.legend(x0, top + 2 + legendHeight(o.legend.length, o.legendCols ?? 2), w, 'Legende', o.legend, o.legendCols ?? 2);
    const noteBottom = a.y1 - 1;
    const room = noteBottom - (top + 2 + lh + 1.5);
    let size = o.noteSize ?? 1.5;
    while (size > 1.05 && noteHeight(o.notes, w, size) > room) size -= 0.05;
    this.note(x0, noteBottom, w, 'Belege, Quellen, Lizenzen', o.notes, size);
    this.titleBlock(o.title);
  }

  toSVG(): string {
    const head = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${esc(PROJECT_TITLE)} · ${this.id} · generated by plans/src (deterministic) -->\n`;
    return (
      head +
      el(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          'xmlns:xlink': 'http://www.w3.org/1999/xlink',
          width: `${this.w}mm`,
          height: `${this.h}mm`,
          viewBox: `0 0 ${this.w} ${this.h}`,
        },
        el('title', {}, esc(`${this.id} – ${PROJECT_TITLE}`)),
        `<style>${STYLE}</style>`,
        `<defs>${DEFS}${this.extraDefs.join('')}</defs>`,
        rect(0, 0, this.w, this.h, { fill: '#fff' }),
        ...this.layers,
      )
    );
  }
}

export function legendHeight(items: number, cols: number): number {
  return 7 + Math.ceil(items / cols) * 4.6 + 1.5;
}

export function noteHeight(lines: string[], width: number, size: number): number {
  const wrapped = lines.flatMap((l) => wrap(l, width - 5, size));
  return 6.5 + wrapped.length * size * 1.3 + 1.5;
}

/** Greedy word wrap by estimated text width. */
export function wrap(s: string, widthMm: number, size: number): string[] {
  const words = s.split(/\s+/);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (textWidth(t, size) > widthMm && cur) {
      out.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) out.push(cur);
  return out;
}

/** Scale bar with alternating blocks; `origin` = left end of the bar (paper). */
export function scaleBar(origin: P2, scale: number, maxLengthMm = 80): string {
  const [step, count] = scaleBarSteps(scale, maxLengthMm);
  const k = 1000 / scale;
  const p: string[] = [];
  const h = 1.4;
  for (let i = 0; i < count; i++) {
    p.push(rect(origin[0] + i * step * k, origin[1], step * k, h, { fill: i % 2 ? '#fff' : '#000', class: 'pen-xs' }));
  }
  for (let i = 0; i <= count; i++) {
    p.push(text([origin[0] + i * step * k, origin[1] - 1.0], de(i * step, 0), { size: 1.8, anchor: 'middle' }));
  }
  p.push(text([origin[0] + count * step * k + 2.5, origin[1] + h], 'm', { size: 1.8 }));
  p.push(text([origin[0], origin[1] + h + 3.2], `Maßstab 1:${scale.toLocaleString('de-DE')} (bei Druck im Format ohne Skalierung)`, { size: 1.6, class: 'muted' }));
  return g({ class: 'scalebar' }, ...p);
}

/**
 * North arrow with grid north (Gitternord, GN) and true north (geographisch Nord, N).
 * `upAzimuth` = grid azimuth pointing up on the paper; γ (grid convergence) at E/N:
 * true azimuth = grid + γ, so true north has grid azimuth −γ.
 */
export function northArrow(c: P2, upAzimuth: number, E: number, N: number, r = 9): string {
  const gamma = gridConvergenceDeg(E, N);
  const dirOf = (az: number): P2 => {
    const b = ((az - upAzimuth) * Math.PI) / 180;
    return [Math.sin(b), -Math.cos(b)];
  };
  const gn = dirOf(0);
  const tn = dirOf(-gamma);
  const perp: P2 = [-tn[1], tn[0]];
  const tip: P2 = [c[0] + tn[0] * r, c[1] + tn[1] * r];
  const tail: P2 = [c[0] - tn[0] * r * 0.55, c[1] - tn[1] * r * 0.55];
  const left: P2 = [c[0] + perp[0] * r * 0.32, c[1] + perp[1] * r * 0.32];
  const right: P2 = [c[0] - perp[0] * r * 0.32, c[1] - perp[1] * r * 0.32];
  const p: string[] = [];
  p.push(circle(c, r * 0.72, { class: 'pen-s', fill: '#fff' }));
  p.push(path([tip, left, tail, right], true, { fill: '#fff', class: 'pen-m' }));
  p.push(path([tip, left, tail], true, { fill: '#000', stroke: 'none' }));
  // grid north: thin line with "GN"
  const gtip: P2 = [c[0] + gn[0] * r * 1.05, c[1] + gn[1] * r * 1.05];
  p.push(line([c[0] - gn[0] * r * 0.72, c[1] - gn[1] * r * 0.72], gtip, { class: 'pen-xs blue' }));
  p.push(text([c[0] + tn[0] * (r + 3.2), c[1] + tn[1] * (r + 3.2) + 1], 'N', { size: 3.2, anchor: 'middle', class: 'b' }));
  p.push(text([gtip[0] + 1.6, gtip[1] + 0.4], 'GN', { size: 1.6, class: 'muted' }));
  p.push(
    text([c[0], c[1] + r + 3.6], `Gitternord GN · Meridiankonvergenz γ = ${de(gamma, 2)}°`, { size: 1.45, anchor: 'middle', class: 'muted' }),
  );
  return g({ class: 'north' }, ...p);
}
