#!/usr/bin/env node
// V2.9 H8: scripted first-run walkthrough (replaces the human hallway test, ADR 0038).
//
//   pnpm dev --port 5244 --strictPort &
//   pnpm run first-run -- [--url http://127.0.0.1:5244/?aoi=overall] [--profiles phone,desktop] [--headed]
//
// A fresh browser profile per run (temp user-data dir, so `firstRun()` is true). The script acts like a
// new visitor: it reads only the tutorial card on screen (`data-step` + text) and does what the card says,
// with real input events (mouse drag, keys, touch swipes, clicks/taps on visible controls; hit-tested by
// the browser). It never calls `sle.flyTo`, `sle.zones.enter` or other shortcuts. `sle.step(n)` only
// advances the frame clock (automated tabs may pause rAF). Pass = the castle's „Betreten“ prompt is on
// screen or the castle zone is entered; without a castle zone (before V2.7) the tutorial's arrival card
// at the palace counts (fallback end state). Screenshots → docs/shots/v29/ (git-ignored).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SHOTS = join(ROOT, 'docs', 'shots', 'v29');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const URL_ = opt('url', 'http://127.0.0.1:5244/?aoi=overall');
const PROFILE_IDS = opt('profiles', 'phone,desktop').split(',');
const HEADLESS = !args.includes('--headed');
const CHROME = opt('chrome', process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const MAX_ACTIONS = Number(opt('max-actions', 40));

const PROFILES = {
  phone: { width: 390, height: 844, dpr: 2, mobile: true },
  desktop: { width: 1440, height: 900, dpr: 1, mobile: false },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Advance frames (the frame clock only; same as waiting with rAF running). */
const frames = (page, n = 30) => page.evaluate((k) => window.sle.step(k), n);

/** What a visitor sees on the tutorial card. */
const card = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('.sle-tut-card');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { step: c.dataset.step, title: c.querySelector('.sle-tut-title')?.textContent ?? '', body: c.querySelector('.sle-tut-body')?.textContent ?? '', visible: r.width > 0 && r.bottom > 0 && r.top < innerHeight };
  });

/** The „Betreten“ prompt button, if on screen (zone portal prompt or the v1 „Schloss betreten“ button). */
const enterButton = async (page) => {
  for (const sel of ['.sle-prompt .sle-btn', '.sle-recon-enter:not([hidden]) button']) {
    const h = await page.$(sel);
    if (h && (await h.isIntersectingViewport()) && /betreten/i.test(await h.evaluate((b) => b.closest('.sle-prompt, .sle-recon-enter')?.textContent ?? ''))) return h;
  }
  return null;
};

async function press(page, p, handle) {
  if (p.mobile) await handle.tap();
  else await handle.click();
}

/** Click a visible button by its text (what a visitor reads). */
async function clickText(page, p, selector, re) {
  const hs = await page.$$(selector);
  for (const h of hs) {
    const t = await h.evaluate((b) => b.textContent ?? '');
    if (re.test(t) && (await h.isIntersectingViewport())) {
      await h.scrollIntoView();
      await press(page, p, h);
      return true;
    }
  }
  return false;
}

async function dragCanvas(page, p, dx, dy) {
  const { width: w, height: h } = p;
  const x0 = w / 2, y0 = h * 0.55;
  if (p.mobile) {
    await page.touchscreen.touchStart(x0, y0);
    for (let i = 1; i <= 10; i++) {
      await page.touchscreen.touchMove(x0 + (dx * i) / 10, y0 + (dy * i) / 10);
      await frames(page, 2);
    }
    await page.touchscreen.touchEnd();
  } else {
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(x0 + (dx * i) / 10, y0 + (dy * i) / 10);
      await frames(page, 2);
    }
    await page.mouse.up();
  }
  await frames(page, 20);
}

async function runProfile(browser, id) {
  const p = PROFILES[id];
  const ctx = await browser.createBrowserContext(); // fresh storage: first visit
  const page = await ctx.newPage();
  await page.emulate({
    viewport: { width: p.width, height: p.height, deviceScaleFactor: p.dpr, isMobile: p.mobile, hasTouch: p.mobile },
    userAgent: p.mobile ? 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36' : await browser.userAgent(),
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const t0 = Date.now();
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.sle?.ready === true, { timeout: 90000 });
  const tReady = Date.now();
  // A first-visit dialog (disclaimer) with an OK button: the visitor reads and confirms it.
  await clickText(page, p, '.sle-overlay button, [data-act="ok"]', /^(OK|Verstanden|Los geht)/i);
  await frames(page, 5);

  const log = [];
  let end = null;
  let actions = 0;
  let last = '';
  const shot = async (name) => page.screenshot({ path: join(SHOTS, `${id}-${String(log.length).padStart(2, '0')}-${name}.png`) });
  for (; actions < MAX_ACTIONS && !end; actions++) {
    const c = await card(page);
    if (!c) {
      end = 'no-card';
      break;
    }
    if (c.step !== last) {
      log.push({ step: c.step, title: c.title, body: c.body, t_s: Math.round((Date.now() - tReady) / 100) / 10, actions });
      await shot(c.step);
      last = c.step;
    }
    const enter = await enterButton(page);
    switch (c.step) {
      case 'look':
        await dragCanvas(page, p, p.width * 0.25, 0);
        break;
      case 'fly':
        if (p.mobile) await dragCanvas(page, p, 0, p.height * 0.3);
        else {
          await page.keyboard.down('KeyW');
          await frames(page, 120);
          await page.keyboard.up('KeyW');
          await frames(page, 10);
        }
        break;
      case 'find':
      case 'approach': {
        // „Tippe auf „Orte“ und dann auf „Schloss Karlsberg – Hauptschloss““
        const open = await page.$('#sle-drawer-places:not([hidden])');
        if (!open) await press(page, p, await page.$('[data-shell-anchor="places"]'));
        await frames(page, 5);
        if (c.step === 'approach' || (await card(page)).step === 'approach') {
          const ok = await clickText(page, p, '#sle-drawer-places .sle-item', /Schloss Karlsberg – Hauptschloss/);
          if (!ok) log.push({ note: 'castle entry not found in Orte' });
          for (let i = 0; i < 40 && (await card(page)).step === 'approach'; i++) {
            await frames(page, 30);
            await sleep(50);
          }
        }
        break;
      }
      case 'enter':
        if (enter) {
          await shot('prompt');
          end = 'prompt';
          await press(page, p, enter);
          await frames(page, 30);
          await sleep(500);
          await frames(page, 30);
          const inZone = await page.evaluate(() => window.sle.zones?.state?.() ?? 'overworld');
          if (inZone !== 'overworld') end = 'castle';
        } else if (/Du bist am Schloss Karlsberg/.test(c.title)) {
          end = 'arrived (fallback: no castle zone on this base)';
        } else {
          await frames(page, 30); // „Flieg noch etwas näher“: let the flight settle
        }
        break;
      case 'done':
        end = /Willkommen im Schloss/.test(c.title) ? 'castle' : 'done (no castle)';
        break;
    }
  }
  const c = await card(page);
  if (c) log.push({ step: c.step, title: c.title, t_s: Math.round((Date.now() - tReady) / 100) / 10, actions });
  await shot('end');
  const pos = await page.evaluate(() => ({ E: window.sle.store.get().E, N: window.sle.store.get().N })); // report only
  await ctx.close();
  return { profile: id, ok: !!end && /^(prompt|castle|arrived)/.test(end), end, actions, load_s: (tReady - t0) / 1000, walk_s: (Date.now() - tReady) / 1000, pos, log, errors };
}

mkdirSync(SHOTS, { recursive: true });
const userDataDir = mkdtempSync(join(tmpdir(), 'sle-first-run-'));
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: HEADLESS,
  userDataDir,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check'],
});
const results = [];
try {
  for (const id of PROFILE_IDS) results.push(await runProfile(browser, id));
} finally {
  await browser.close();
  rmSync(userDataDir, { recursive: true, force: true });
}
writeFileSync(join(SHOTS, 'first-run.json'), JSON.stringify(results, null, 2));
for (const r of results) {
  console.log(`\n## ${r.profile}: ${r.ok ? 'PASS' : 'FAIL'} — ${r.end} · ${r.actions} actions · load ${r.load_s} s · walkthrough ${r.walk_s} s`);
  for (const l of r.log) console.log(l.note ? `  ! ${l.note}` : `  ${String(l.t_s).padStart(5)} s  #${l.actions}  ${l.step.padEnd(8)} ${l.title}`);
  if (r.errors.length) console.log('  page errors:', r.errors.slice(0, 3));
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
