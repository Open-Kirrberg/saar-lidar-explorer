/**
 * QR code matrix + SVG (no DOM, no three). Encoding by `qrcode-generator` (MIT, Kazuhiko Arase),
 * error correction level M, byte mode, smallest fitting version. Fully offline.
 */
import qrcode from 'qrcode-generator';

export interface QrMatrix {
  /** Modules per side (21 + 4·(version − 1)). */
  size: number;
  /** Row-major, 1 = dark module. */
  dark: Uint8Array;
}

/** Quiet zone in modules (the QR spec asks for 4). */
export const QR_QUIET = 4;

export function qrMatrix(text: string, ecl: 'L' | 'M' | 'Q' | 'H' = 'M'): QrMatrix {
  const q = qrcode(0, ecl);
  q.addData(text, 'Byte');
  q.make();
  const size = q.getModuleCount();
  const dark = new Uint8Array(size * size);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark[r * size + c] = q.isDark(r, c) ? 1 : 0;
  return { size, dark };
}

/**
 * Inline SVG: white background with a quiet zone, one path of dark unit squares (merged per row
 * run), `crispEdges` so it stays sharp at any CSS size. `label` becomes the accessible name.
 */
export function qrSvg(m: QrMatrix, opts: { quiet?: number; label?: string } = {}): string {
  const quiet = opts.quiet ?? QR_QUIET;
  const n = m.size + 2 * quiet;
  let d = '';
  for (let r = 0; r < m.size; r++) {
    let c = 0;
    while (c < m.size) {
      if (!m.dark[r * m.size + c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < m.size && m.dark[r * m.size + c]) c++;
      d += `M${start + quiet} ${r + quiet}h${c - start}v1h${start - c}z`;
    }
  }
  const label = opts.label ? `<title>${escapeXml(opts.label)}</title>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img">` +
    `${label}<rect width="${n}" height="${n}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`
  );
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}
