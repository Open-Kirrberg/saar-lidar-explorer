#!/usr/bin/env node
// Flurstücksuche: scripted browser check (local labels search, online WFS search, fly + outline).
//
//   VITE_CATALOG_URL=https://open-kirrberg.github.io/orte-katalog/catalog.json pnpm dev --port 5248 --strictPort &
//   node scripts/parcel-search-check.mjs [--url http://127.0.0.1:5248/] [--headed] [--no-online]
//
// Types into the real search field (keyboard events), clicks hits, advances frames with `sle.step`
// (automated tabs may pause rAF). Screenshots → docs/shots/parcel-search/ (git-ignored).
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SHOTS = join(ROOT, 'docs', 'shots', 'parcel-search');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const URL_ = opt('url', 'http://127.0.0.1:5248/');
const CHROME = opt('chrome', process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const ONLINE = !args.includes('--no-online');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(SHOTS, { recursive: true });
const userDataDir = mkdtempSync(join(tmpdir(), 'sle-ps-'));
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: !args.includes('--headed'),
  userDataDir,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check'],
});
const errors = [];
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Advance frames until a flight started and ended (or nothing flew for a while), then let streaming settle. */
async function settle(page, maxRounds = 150) {
  let flew = false;
  let calm = 0;
  for (let i = 0; i < maxRounds; i++) {
    const flying = await page.evaluate(() => {
      window.sle.step(20);
      return window.sle.controller.flying;
    });
    await sleep(150);
    if (flying) {
      flew = true;
      calm = 0;
    } else if (++calm >= (flew ? 5 : 40)) break;
  }
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.sle.step(10));
    await sleep(150);
  }
}

async function typeQuery(page, text) {
  await page.evaluate(() => {
    const i = document.querySelector('#sle-parcel-search input[type=search]');
    i.value = '';
    i.scrollIntoView({ block: 'center' });
    i.focus();
  });
  await page.keyboard.type(text, { delay: 15 });
  await sleep(400); // debounce + index load
  await page.waitForFunction(() => !/Lade Flurstücke/.test(document.querySelector('#sle-parcel-search .sle-ps-status')?.textContent ?? ''), { timeout: 60000 });
  await sleep(100);
  return page.evaluate(() => ({
    status: document.querySelector('#sle-parcel-search .sle-ps-status').textContent,
    hits: [...document.querySelectorAll('#sle-parcel-search .sle-ps-item')].map((b) => b.textContent),
    online: !document.querySelector('#sle-parcel-search .sle-ps-online').hidden,
    value: document.querySelector('#sle-parcel-search input[type=search]').value,
  }));
}

async function pickFirst(page, shot) {
  await page.click('#sle-parcel-search .sle-ps-item');
  await settle(page);
  const sel = await page.evaluate(() => ({
    title: document.querySelector('#sle-parcel-search .sle-ps-sel-title')?.textContent ?? '',
    meta: document.querySelector('#sle-parcel-search .sle-ps-sel-meta')?.textContent ?? '',
    outline3d: window.sle.scene.children.some((o) => o.name === 'DrapedLines' && o.material?.uniforms?.uColors?.value?.[0]?.x === 1),
    pose: { E: window.sle.store.get().E, N: window.sle.store.get().N },
  }));
  sel.near = (E, N, m = 2500) => Math.hypot(sel.pose.E - E, sel.pose.N - N) < m;
  await page.screenshot({ path: join(SHOTS, shot) });
  return sel;
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.sle?.ready === true, { timeout: 120000, polling: 500 });
  // Skip the first-run tutorial if it is up, open the „Orte“ drawer.
  await page.evaluate(() => {
    window.sle.shell.markTutorialDone?.();
    document.querySelector('[data-shell-anchor=places]')?.click();
  });
  await page.waitForSelector('#sle-parcel-search input[type=search]', { visible: true, timeout: 20000 });
  check('search card in „Orte“', true);

  // 1) St. Ingbert (local labels + polygons)
  let r = await typeQuery(page, 'Hassel Flur 6 1405/1');
  check('local: Hassel Flur 6 1405/1', r.hits.length === 1 && /Hassel, Flur 6, Flurstück 1405\/1/.test(r.hits[0]), `${r.status} | ${r.hits[0] ?? ''}`);
  let sel = await pickFirst(page, '1-hassel.png');
  check('fly + outline (St. Ingbert)', sel.outline3d && Math.hypot(sel.pose.E - 366909, sel.pose.N - 5458831) < 2000, `${sel.title} | ${sel.meta} | camera ${sel.pose.E},${sel.pose.N}`);

  // 2) Number only → list, sorted
  r = await typeQuery(page, '100');
  check('local: number only lists several', r.hits.length > 1, `[${r.value}] ${r.status} | first ${r.hits[0] ?? ''}`);

  // 3) Zweibrücken (RLP, no Flur)
  r = await typeQuery(page, 'Moersbach 200');
  check('local: RLP Gemarkung', r.hits.length >= 1, `${r.status} | ${r.hits[0] ?? ''}`);
  if (r.hits.length) {
    sel = await pickFirst(page, '2-moersbach.png');
    check('fly + outline (Zweibrücken)', sel.outline3d && sel.near(383360, 5462210), `${sel.title} | ${sel.meta} | camera ${sel.pose.E},${sel.pose.N}`);
  }

  // 4) Kirrberg (Homburg has no parcels published yet) → online
  r = await typeQuery(page, 'Kirrberg 100');
  check('local: Kirrberg → offers online search', r.online, `${r.status} | hits ${r.hits.length}`);
  if (ONLINE && r.online) {
    await page.click('#sle-parcel-search .sle-ps-online-btn');
    await page.waitForFunction(() => !/Frage das Geoportal/.test(document.querySelector('#sle-parcel-search .sle-ps-status').textContent), { timeout: 60000 });
    const o = await page.evaluate(() => ({
      status: document.querySelector('#sle-parcel-search .sle-ps-status').textContent,
      hits: [...document.querySelectorAll('#sle-parcel-search .sle-ps-item')].map((b) => b.textContent),
    }));
    check('online: Kirrberg 100', o.hits.length >= 1, `${o.status} | ${o.hits.join(' ; ')}`);
    if (o.hits.length) {
      sel = await pickFirst(page, '3-kirrberg-online.png');
      check('fly + outline (online)', sel.outline3d && sel.near(378600, 5460300, 4000), `${sel.title} | ${sel.meta} | camera ${sel.pose.E},${sel.pose.N}`);
    }
  }

  // 5) Clear
  await page.evaluate(() => document.querySelector('#sle-parcel-search [data-a=clear]')?.click());
  const cleared = await page.evaluate(() => !window.sle.scene.children.some((o) => o.name === 'DrapedLines' && o.material?.uniforms?.uColors?.value?.[0]?.x === 1));
  check('Markierung aus', cleared);
} finally {
  await browser.close();
  rmSync(userDataDir, { recursive: true, force: true });
}
const relevant = errors.filter((e) => !/favicon/.test(e));
check('no console errors', relevant.length === 0, relevant.slice(0, 5).join(' | '));
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
