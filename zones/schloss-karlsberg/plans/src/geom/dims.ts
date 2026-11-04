/**
 * Dimension chains (Maßketten), pure layout + SVG rendering.
 *
 * A chain is a list of model positions (m) along a line; consecutive positions give segments
 * labelled with their length in German notation (2,65). Labels that do not fit between the
 * ticks are moved to a second row so they never overlap.
 */
import { type P2, de, g, line, text, textWidth } from '../svg.ts';

export interface DimSegment {
  a0: number;
  a1: number;
  length: number;
  label: string;
  /** 0 = on the line, 1 = staggered outwards (did not fit). */
  row: 0 | 1;
}

export interface DimChainLayout {
  positions: number[];
  segments: DimSegment[];
  total: number;
}

/** Sort, de-duplicate (tolerance 1 cm) and label a chain. `k` = mm per m, `size` = text mm. */
export function dimChain(positions: readonly number[], k: number, size = 2.0, digits = 2): DimChainLayout {
  const p = [...positions].sort((a, b) => a - b).filter((x, i, arr) => i === 0 || x - arr[i - 1] > 0.01);
  const segments: DimSegment[] = [];
  let prevStaggered = false;
  for (let i = 1; i < p.length; i++) {
    const len = p[i] - p[i - 1];
    const label = de(len, digits);
    const fits = textWidth(label, size) + 0.8 <= len * k;
    const row: 0 | 1 = fits ? 0 : prevStaggered ? 0 : 1;
    // two neighbouring non-fitting labels alternate between row 1 and an outside-left shift (row 0 kept)
    segments.push({ a0: p[i - 1], a1: p[i], length: len, label, row });
    prevStaggered = !fits && row === 1;
  }
  return { positions: p, segments, total: p.length > 1 ? p[p.length - 1] - p[0] : 0 };
}

export interface DimDrawOptions {
  /** Paper point of model position 0 on the dimension line. */
  origin: P2;
  /** Paper unit vector of increasing model position. */
  dir: P2;
  /** Paper unit vector pointing away from the object (labels go on this side). */
  out: P2;
  k: number;
  size?: number;
  /** Extension lines back towards the object (mm). */
  ext?: number;
  cls?: string;
}

/** Render a chain: dimension line, oblique ticks, extension lines, labels. */
export function drawDimChain(ch: DimChainLayout, o: DimDrawOptions): string {
  const size = o.size ?? 2.0;
  const ext = o.ext ?? 2.0;
  const at = (a: number, off = 0): P2 => [o.origin[0] + o.dir[0] * a * o.k + o.out[0] * off, o.origin[1] + o.dir[1] * a * o.k + o.out[1] * off];
  const parts: string[] = [];
  if (ch.positions.length < 2) return '';
  const first = ch.positions[0];
  const last = ch.positions[ch.positions.length - 1];
  parts.push(line(at(first), at(last), { class: 'pen-xs' }));
  // angle of the text: along dir, kept readable (never upside down)
  let ang = (Math.atan2(o.dir[1], o.dir[0]) * 180) / Math.PI;
  if (ang > 90.01) ang -= 180;
  if (ang < -90.01) ang += 180;
  const t1: P2 = [(o.dir[0] + o.out[0]) * 0.9, (o.dir[1] + o.out[1]) * 0.9];
  for (const p of ch.positions) {
    const q = at(p);
    parts.push(line(at(p, -ext), at(p, 1.0), { class: 'pen-xs' }));
    parts.push(line([q[0] - t1[0], q[1] - t1[1]], [q[0] + t1[0], q[1] + t1[1]], { class: 'pen-s' }));
  }
  // text baseline offset: labels on the `out` side of the line
  const flip = textSideSign(o.dir, o.out);
  for (const s of ch.segments) {
    const mid = (s.a0 + s.a1) / 2;
    const off = s.row === 0 ? 0.7 : 0.7 + size * 1.25;
    const p = at(mid, flip > 0 ? off : off + size * 0.75);
    parts.push(text(p, s.label, { size, anchor: 'middle', rotate: ang, class: 'dim' }));
  }
  return g({ class: o.cls ?? 'dims' }, ...parts);
}

/** +1 if the rotated text's "up" points to `out`, else −1 (then the baseline needs extra offset). */
function textSideSign(dir: P2, out: P2): number {
  let ang = Math.atan2(dir[1], dir[0]);
  if (ang > Math.PI / 2 + 1e-4) ang -= Math.PI;
  if (ang < -Math.PI / 2 - 1e-4) ang += Math.PI;
  // text up vector in paper coordinates (y down) = (sin a, −cos a)
  const up: P2 = [Math.sin(ang), -Math.cos(ang)];
  return up[0] * out[0] + up[1] * out[1] >= 0 ? 1 : -1;
}
