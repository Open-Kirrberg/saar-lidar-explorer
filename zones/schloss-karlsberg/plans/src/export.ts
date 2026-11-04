/**
 * SVG -> PDF and PNG preview via headless Google Chrome (no npm dependency).
 * PDF: the SVG is inlined into an HTML page with `@page { size: W mm H mm; margin: 0 }` and
 * printed with --print-to-pdf (vector output, fonts embedded by Chrome).
 * PNG: the same page at a CSS width of `previewPx` pixels, captured with --screenshot.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const CHROME_CANDIDATES = [
  process.env.CHROME_BIN ?? '',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

export function findChrome(): string | null {
  return CHROME_CANDIDATES.find((p) => existsSync(p)) ?? null;
}

function sizeOf(svg: string): [number, number] {
  const m = /width="([\d.]+)mm" height="([\d.]+)mm"/.exec(svg);
  if (!m) throw new Error('export: SVG without mm size');
  return [Number(m[1]), Number(m[2])];
}

function stripHeader(svg: string): string {
  return svg.replace(/^<\?xml[^>]*>\s*/, '').replace(/^<!--[\s\S]*?-->\s*/, '');
}

export interface ExportResult {
  pdf?: string;
  png?: string;
}

export async function exportSheet(svgPath: string, pdfPath: string | null, pngPath: string | null, previewPx = 1600): Promise<ExportResult> {
  const chrome = findChrome();
  if (!chrome) throw new Error('export: no Chrome/Chromium found (set CHROME_BIN)');
  const svg = readFileSync(svgPath, 'utf8');
  const [w, h] = sizeOf(svg);
  const work = mkdtempSync(join(tmpdir(), 'karlsberg-plans-'));
  const profile = join(work, 'profile');
  const common = ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', `--user-data-dir=${profile}`];
  const res: ExportResult = {};
  try {
    if (pdfPath) {
      const html = join(work, 'print.html');
      writeFileSync(
        html,
        `<!doctype html><html><head><meta charset="utf-8"><title>${basename(svgPath)}</title><style>@page{size:${w}mm ${h}mm;margin:0}html,body{margin:0;padding:0}svg{display:block;width:${w}mm;height:${h}mm}</style></head><body>${stripHeader(svg)}</body></html>`,
      );
      await run(chrome, [...common, '--no-pdf-header-footer', '--print-to-pdf-no-header', `--print-to-pdf=${pdfPath}`, `file://${html}`], { timeout: 120000 });
      if (!existsSync(pdfPath) || statSync(pdfPath).size < 1000) throw new Error(`export: PDF not written for ${svgPath}`);
      res.pdf = pdfPath;
    }
    if (pngPath) {
      const html = join(work, 'preview.html');
      const ph = Math.round((previewPx * h) / w);
      writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff}svg{display:block;width:${previewPx}px;height:${ph}px}</style></head><body>${stripHeader(svg)}</body></html>`);
      await run(chrome, [...common, '--force-device-scale-factor=1', `--window-size=${previewPx},${ph}`, `--screenshot=${pngPath}`, `file://${html}`], { timeout: 120000 });
      if (!existsSync(pngPath)) throw new Error(`export: PNG not written for ${svgPath}`);
      res.png = pngPath;
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return res;
}

/** Minimal PDF sanity check: header, EOF marker and page count (for tests / the CLI summary). */
export function pdfInfo(path: string): { ok: boolean; pages: number; bytes: number } {
  const buf = readFileSync(path);
  const head = buf.subarray(0, 8).toString('latin1');
  const tail = buf.subarray(Math.max(0, buf.length - 1024)).toString('latin1');
  const body = buf.toString('latin1');
  const pages = (body.match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
  return { ok: head.startsWith('%PDF-') && tail.includes('%%EOF') && pages > 0, pages, bytes: buf.length };
}
