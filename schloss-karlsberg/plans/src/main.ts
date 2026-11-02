/**
 * CLI for `pnpm run plans`: catalogue v2 -> plans/out/*.svg + *.pdf, previews in
 * docs/plans-preview/*.png (<= 1600 px). Options:
 *   --only <text>   only sheets whose file name contains <text> (repeatable)
 *   --no-pdf        skip PDF export      --no-png   skip PNG previews
 * Terrain products (contours, hillshade, DTM profiles) come from plans/scripts/terrain.py.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadSite } from '../../model/src/index.ts';
import { exportSheet, findChrome, pdfInfo } from './export.ts';
import { sheetList } from './index.ts';
import { loadDtm } from './terrain.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = resolve(ROOT, 'plans/out');
const PREVIEW = resolve(ROOT, 'docs/plans-preview');

const args = process.argv.slice(2);
const only: string[] = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--only') only.push(args[++i]);
const doPdf = !args.includes('--no-pdf');
const doPng = !args.includes('--no-png');

const raw = JSON.parse(readFileSync(resolve(ROOT, 'model/catalogue.json'), 'utf8')) as unknown;
const { spec } = loadSite(raw);
if (!loadDtm()) console.warn('[plans] plans/data missing: run plans/scripts/terrain.py (see plans/README.md); sheets render without terrain');
mkdirSync(OUT, { recursive: true });
mkdirSync(PREVIEW, { recursive: true });
const sheets = sheetList(spec).filter((s) => !only.length || only.some((o) => s.file.includes(o)));
const chrome = findChrome();
if ((doPdf || doPng) && !chrome) console.warn('[plans] no Chrome found: only SVG written');
const t0 = Date.now();
const queue = sheets.map((s) => async () => {
  const svgPath = join(OUT, `${s.file}.svg`);
  writeFileSync(svgPath, s.build().toSVG());
  let info = '';
  if (chrome && (doPdf || doPng)) {
    const r = await exportSheet(svgPath, doPdf ? join(OUT, `${s.file}.pdf`) : null, doPng ? join(PREVIEW, `${s.file}.png`) : null);
    if (r.pdf) {
      const pi = pdfInfo(r.pdf);
      info = ` pdf ${pi.ok ? 'ok' : 'BROKEN'} ${pi.pages}p ${(pi.bytes / 1024).toFixed(0)} KiB`;
    }
  }
  console.log(`[plans] ${s.file}${info}`);
});
// at most 3 Chrome processes at a time
const workers = Array.from({ length: 3 }, async () => {
  while (queue.length) await queue.shift()!();
});
await Promise.all(workers);
console.log(`[plans] ${sheets.length} sheets in ${((Date.now() - t0) / 1000).toFixed(1)} s -> plans/out/, previews -> docs/plans-preview/`);
