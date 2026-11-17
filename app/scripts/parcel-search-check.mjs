#!/usr/bin/env node
// Flurstücksuche: scripted browser check (local labels search, online WFS search, fly + outline,
// Merkliste: save, reload, fly from the list, all on the map, remove; phone viewport).
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
    hits: [...document.querySelectorAll('#sle-parcel-search .sle-ps-list .sle-ps-item')].map((b) => b.textContent),
    online: !document.querySelector('#sle-parcel-search .sle-ps-online').hidden,
    value: document.querySelector('#sle-parcel-search input[type=search]').value,
  }));
}

async function pickFirst(page, shot) {
  await page.click('#sle-parcel-search .sle-ps-list .sle-ps-item');
  await settle(page);
  // The outline follows the place's polygons file (a few MB) — may land after the flight on a slow network.
  await page
    .waitForFunction(() => window.sle.scene.children.some((o) => o.name === 'DrapedLines' && o.material?.uniforms?.uColors?.value?.[0]?.x === 1), { timeout: 60000, polling: 500 })
    .catch(() => {});
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

let navigating = false;
async function openApp(page) {
  navigating = true; // a reload aborts the old page's chunk fetches („Failed to fetch“): not an app error
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  navigating = false;
  await page.waitForFunction(() => window.sle?.ready === true, { timeout: 120000, polling: 500 });
  // Skip the first-run tutorial if it is up, open the „Orte“ drawer.
  await page.evaluate(() => {
    window.sle.shell.markTutorialDone?.();
  });
  await sleep(500);
  // The drawer may already be open after a reload (state is remembered): click only when hidden.
  const visible = await page.evaluate(() => {
    const i = document.querySelector('#sle-parcel-search input[type=search]');
    return !!i && i.getClientRects().length > 0;
  });
  if (!visible) await page.evaluate(() => document.querySelector('[data-shell-anchor=places]')?.click());
  await page.waitForSelector('#sle-parcel-search input[type=search]', { visible: true, timeout: 20000 });
}

const savedState = (page) =>
  page.evaluate(() => ({
    visible: !document.querySelector('#sle-parcel-search .sle-ps-saved').hidden,
    title: document.querySelector('#sle-parcel-search .sle-ps-saved-title').textContent,
    rows: [...document.querySelectorAll('#sle-parcel-search .sle-ps-saved-list .sle-ps-item')].map((b) => b.textContent),
    stored: (() => {
      try {
        return JSON.parse(localStorage.getItem('sle.parcels.saved.v1') ?? 'null')?.parcels?.length ?? 0;
      } catch {
        return -1;
      }
    })(),
    msg: document.querySelector('#sle-parcel-search .sle-ps-saved-msg').textContent,
  }));

/** Screenshot of the card only (scrolled into view). */
async function cardShot(page, file) {
  const el = await page.$('#sle-parcel-search');
  await el.evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await sleep(150);
  await el.screenshot({ path: join(SHOTS, file) });
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('console', (m) => {
    if (m.type() === 'error' && !(navigating && /Failed to fetch/.test(m.text()))) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await openApp(page);
  const order = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.sle-feat-places')].map((w) => w.getAttribute('data-feature'));
    return cards;
  });
  check(
    'search card in „Orte“, above „Nachbauten zum Betreten“',
    order[0] === 'parcel-search' && (!order.includes('zone-portals') || order.indexOf('zone-portals') > 0),
    order.join(' > '),
  );

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
      hits: [...document.querySelectorAll('#sle-parcel-search .sle-ps-list .sle-ps-item')].map((b) => b.textContent),
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

  // 6) Merkliste: save from the selection box (+ note) and from a hit row's star
  let s = await savedState(page);
  check('Merkliste empty at first', !s.visible && s.stored === 0, JSON.stringify(s));
  await typeQuery(page, 'Hassel Flur 6 1405/1');
  await pickFirst(page, '6-hassel-again.png');
  await page.click('#sle-parcel-search [data-a=save]');
  await page.type('#sle-parcel-search .sle-ps-note', 'Testnotiz Hohlweg');
  await page.keyboard.press('Enter');
  const btnText = await page.$eval('#sle-parcel-search [data-a=save]', (b) => b.textContent);
  s = await savedState(page);
  check('Merken (selection box)', btnText === '★ Gemerkt' && s.rows.length === 1 && s.stored === 1, `${btnText} | ${JSON.stringify(s)}`);
  r = await typeQuery(page, 'Moersbach 200');
  if (r.hits.length) await page.click('#sle-parcel-search .sle-ps-list .sle-ps-star');
  s = await savedState(page);
  const star = await page.$eval('#sle-parcel-search .sle-ps-list .sle-ps-star', (b) => ({ t: b.textContent, p: b.getAttribute('aria-pressed') })).catch(() => null);
  check('Merken (star on a hit)', s.rows.length === 2 && /Mörsbach|Moersbach/.test(s.rows[0]) && star?.t === '★' && star?.p === 'true', JSON.stringify({ s, star }));
  await page.focus('#sle-parcel-search input[type=search]');
  await page.keyboard.press('Escape');
  await sleep(300);
  await cardShot(page, '7-merkliste-desktop.png');

  // 7) Reload: the list is still there; picking an entry flies + outlines
  await openApp(page);
  s = await savedState(page);
  check('Merkliste after reload', s.visible && s.rows.length === 2 && /Testnotiz Hohlweg/.test(s.rows[1]) && /\(2\)/.test(s.title), JSON.stringify(s));
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#sle-parcel-search .sle-ps-saved-list .sle-ps-item')];
    rows.find((b) => /Hassel/.test(b.textContent))?.click();
  });
  await settle(page);
  sel = await page.evaluate(() => ({
    title: document.querySelector('#sle-parcel-search .sle-ps-sel-title')?.textContent ?? '',
    save: document.querySelector('#sle-parcel-search [data-a=save]')?.textContent ?? '',
    note: document.querySelector('#sle-parcel-search .sle-ps-note')?.value ?? '',
    outline3d: window.sle.scene.children.some((o) => o.name === 'DrapedLines' && o.material?.uniforms?.uColors?.value?.[0]?.x === 1),
    pose: { E: window.sle.store.get().E, N: window.sle.store.get().N },
    active: document.querySelector('#sle-parcel-search .sle-ps-saved-list .sle-ps-item.active')?.textContent ?? '',
  }));
  await page.screenshot({ path: join(SHOTS, '8-from-merkliste.png') });
  check(
    'fly + outline from the Merkliste',
    sel.outline3d && Math.hypot(sel.pose.E - 366909, sel.pose.N - 5458831) < 2000 && sel.save === '★ Gemerkt' && sel.note === 'Testnotiz Hohlweg' && /Hassel/.test(sel.active),
    JSON.stringify(sel),
  );

  // 8) All saved parcels on the map
  await page.click('#sle-parcel-search .sle-ps-saved-map');
  await page.waitForFunction(() => document.querySelectorAll('#minimap .leaflet-overlay-pane path.leaflet-interactive[stroke="#ffd02e"]').length >= 4, { timeout: 60000 }).catch(() => {});
  await sleep(2500); // tiles
  const onMap = await page.evaluate(() => document.querySelectorAll('#minimap .leaflet-overlay-pane path.leaflet-interactive[stroke="#ffd02e"]').length);
  await page.screenshot({ path: join(SHOTS, '9-merkliste-map.png') });
  check('Alle auf der Karte zeigen', onMap >= 4, `${onMap} amber paths (dot + outline per parcel)`);
  await page.evaluate(() => document.querySelector('#sle-parcel-search .sle-ps-saved-map').click());
  await sleep(300);

  // 9) Remove
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#sle-parcel-search .sle-ps-saved-list .sle-ps-row')];
    rows.find((r) => /Mörsbach|Moersbach/.test(r.textContent))?.querySelector('.sle-ps-del')?.click();
  });
  s = await savedState(page);
  const delLabel = await page.$eval('#sle-parcel-search .sle-ps-del', (b) => b.getAttribute('aria-label')).catch(() => '');
  check('remove (×)', s.rows.length === 1 && s.stored === 1 && /Hassel/.test(s.rows[0]) && /entfernen/.test(delLabel), `${JSON.stringify(s)} | ${delLabel}`);

  // 10) Phone viewport
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await openApp(page);
  s = await savedState(page);
  await page.screenshot({ path: join(SHOTS, '10-phone.png') });
  await cardShot(page, '11-phone-card.png');
  const overflow = await page.evaluate(() => {
    const card = document.querySelector('#sle-parcel-search');
    return [...card.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > card.getBoundingClientRect().right + 1).map((e) => e.className);
  });
  check('phone: Merkliste visible, nothing overflows the card', s.visible && s.rows.length === 1 && overflow.length === 0, `${JSON.stringify(s)} | overflow ${overflow.join(',')}`);
  await page.evaluate(() => document.querySelector('#sle-parcel-search .sle-ps-del').click());
  s = await savedState(page);
  check('last entry removed → list hidden', !s.visible && s.stored === 0, JSON.stringify(s));
} finally {
  await browser.close();
  rmSync(userDataDir, { recursive: true, force: true });
}
const relevant = errors.filter((e) => !/favicon/.test(e));
check('no console errors', relevant.length === 0, relevant.slice(0, 5).join(' | '));
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
