#!/usr/bin/env node
// Performance baseline on the low-end phone proxy (ADR 0028) and on desktop.
//
//   pnpm run build && pnpm exec vite preview --port 5241 --strictPort &   # serves dist + public/data
//   pnpm run perf -- [--url http://127.0.0.1:5241/?aoi=overall] [--profiles phone,desktop] [--headed]
//                    [--lens off|on|both]   # V2.5: also measure with the Relikt-Blick lens on (view id +lens)
//
// Drives the system Chrome (puppeteer-core, no browser download) headless by default, so no window
// opens on the desktop; `--headed` (V2.0 method) shows the page. Per profile: cold load (cache disabled)
// → `sle:ready` (first rendered terrain), then 3 fixed views via `window.sle.flyTo` (duration 0): wait
// until streaming settles, count rAF frames for SAMPLE_MS, time synchronous `sle.step(1)` + 1-pixel
// readback, read memory. Writes JSON + screenshots to the git-ignored docs/shots/ and prints a
// Markdown table. Never part of the production bundle (scripts/ is not imported by src/).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SHOTS = join(ROOT, 'docs', 'shots');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const URL_ = opt('url', 'http://127.0.0.1:5241/?aoi=overall');
const PROFILE_IDS = opt('profiles', 'phone,desktop').split(',');
const HEADLESS = !args.includes('--headed'); // headless by default: never pop up Chrome windows on the user's desktop
const CHROME = opt('chrome', process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const UNCAPPED = args.includes('--uncapped'); // no vsync: rAF fps = headroom above the display rate
const SAMPLE_MS = Number(opt('sample-ms', 5000));
const LENS = { off: [false], on: [true], both: [false, true] }[opt('lens', 'off')] ?? [false];

/** Low-end phone proxy (ADR 0028): Chrome emulation, 4× CPU throttle, target 30 fps. */
const PROFILES = {
  phone: { label: 'Phone proxy (390×844 @3×, 4× CPU, 4G 9 Mbit/s 150 ms)', width: 390, height: 844, dpr: 3, mobile: true, cpu: 4, net: { latency: 150, downloadThroughput: (9e6 / 8), uploadThroughput: (1.5e6 / 8) } },
  desktop: { label: 'Desktop (1440×900 @2×, no throttle)', width: 1440, height: 900, dpr: 2, mobile: false, cpu: 1, net: null },
};

/** Fixed views (EPSG:25832). Keep stable so later items compare against this baseline. */
const VIEWS = [
  { id: 'kirrberg', label: 'Kirrberg village (church)', E: 381455, N: 5462119, agl: 150, pitch: -30, heading: 0 },
  { id: 'forest', label: 'Forest over the Karlsberg plateau', E: 382556, N: 5465632, agl: 60, pitch: -15, heading: 300 },
  { id: 'castle', label: 'Schloss Karlsberg (main palace)', E: 382195, N: 5466095, agl: 120, pitch: -35, heading: 0 },
];

const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitSettled(page, timeoutMs) {
  const t0 = Date.now();
  let quiet = 0;
  while (Date.now() - t0 < timeoutMs) {
    // V2.4: trees stream separately (window.sleTrees); count them as pending too.
    const pending = await page.evaluate(() => {
      const t = window.sleTrees?.stats?.();
      return window.sle.terrainStats().pending + (t ? t.pending + t.loading : 0);
    });
    quiet = pending === 0 ? quiet + 1 : 0;
    if (quiet >= 3) return Date.now() - t0;
    await sleep(100);
  }
  return null; // did not settle
}

/** First-run dialogs (disclaimer, intro) cover the 3D view on a fresh profile: dismiss them. */
async function dismissDialogs(page) {
  await page.evaluate(() => document.querySelectorAll('[data-act="ok"]').forEach((b) => b.offsetParent && b.click()));
  await page.keyboard.press('Escape');
}

async function runProfile(browser, id) {
  const p = PROFILES[id];
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.emulate({
    viewport: { width: p.width, height: p.height, deviceScaleFactor: p.dpr, isMobile: p.mobile, hasTouch: p.mobile },
    userAgent: p.mobile
      ? 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36'
      : await browser.userAgent(),
  });
  if (p.net) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...p.net });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
  await page.bringToFront();
  // Fresh profile per run (puppeteer temp user-data-dir): no stored settings, intro may show; skip it.
  await page.evaluateOnNewDocument(() => {
    window.__perf = { ready: null };
    addEventListener('sle:ready', () => (window.__perf.ready = performance.now()), { once: true });
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${new URL(r.url()).pathname}`));

  await page.goto(URL_, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForFunction(() => window.__perf.ready != null, { timeout: 180_000, polling: 200 });
  const readyMs = await page.evaluate(() => window.__perf.ready);
  const settleMs = await waitSettled(page, 120_000);

  const env = await page.evaluate(() => {
    const gl = window.sle.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      glRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      visibility: document.visibilityState,
      drawingBuffer: `${gl.drawingBufferWidth}×${gl.drawingBufferHeight}`,
      pixelRatio: window.sle.renderer.getPixelRatio(),
    };
  });
  const software = /swiftshader|llvmpipe|software/i.test(env.glRenderer);

  const views = [];
  const ceilingFps = await page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const blank = document.createElement('div');
        blank.style.cssText = 'position:fixed;inset:0;background:#000;z-index:99999';
        document.body.append(blank);
        window.sle.renderer.setAnimationLoop(null); // idle page: only the browser's frame clock
        let n = 0;
        const t0 = performance.now();
        const tick = (t) => (t - t0 < ms ? (n++, requestAnimationFrame(tick)) : (blank.remove(), resolve((n * 1000) / (t - t0))));
        requestAnimationFrame(tick);
      }),
    2000,
  );
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__perf.ready != null, { timeout: 180_000, polling: 200 });
  await waitSettled(page, 120_000);
  await dismissDialogs(page);
  for (const v0 of VIEWS) for (const lens of LENS) {
    const v = { ...v0, id: v0.id + (lens ? '+lens' : '') };
    const t0 = Date.now();
    await page.evaluate((v) => {
      void window.sle.flyTo(v.E, v.N, { agl: v.agl, pitch: v.pitch, heading: v.heading, duration: 0 });
    }, v);
    // Lens on/off (V2.5): 40 steps of 1/60 s finish the ~0.5 s transition even in a hidden tab.
    await page.evaluate((on) => {
      window.sleLens?.setOn(on);
      window.sle.step(40);
    }, lens);
    await sleep(300); // let a few frames run so the LOD queue reflects the new view
    const settled = await waitSettled(page, 120_000);
    const viewSettleMs = settled == null ? null : Date.now() - t0;
    // Real rAF frame rate (only meaningful when the tab is visible).
    const raf = await page.evaluate(
      (ms) =>
        new Promise((resolve) => {
          if (document.visibilityState !== 'visible') return resolve(null);
          const dts = [];
          let last = performance.now();
          const t0 = last;
          const tick = (t) => {
            dts.push(t - last);
            last = t;
            if (t - t0 < ms) requestAnimationFrame(tick);
            else {
              dts.shift();
              const s = [...dts].sort((a, b) => a - b);
              resolve({ fps: (dts.length * 1000) / (t - t0), p50: s[Math.floor(s.length * 0.5)], p95: s[Math.floor(s.length * 0.95)] });
            }
          };
          requestAnimationFrame(tick);
        }),
      SAMPLE_MS,
    );
    // Synchronous frame cost (controller + LOD + render + GPU finish via 1-pixel readback).
    const stepMs = await page.evaluate(() => {
      const s = window.sle;
      const gl = s.renderer.getContext();
      const px = new Uint8Array(4);
      s.step(5);
      const t0 = performance.now();
      for (let i = 0; i < 30; i++) {
        s.step(1);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      }
      return (performance.now() - t0) / 30;
    });
    const mem = await page.evaluate(() => {
      const s = window.sle;
      const info = s.renderer.info;
      const st = s.terrainStats();
      const pm = performance.memory;
      return {
        heapMB: pm ? pm.usedJSHeapSize / 2 ** 20 : null,
        triangles: info.render.triangles,
        calls: info.render.calls,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        terrainGpuMB: st.gpuMB,
        chunks: st.levels.reduce((a, l) => a + l.resident, 0),
        trees: (() => {
          const t = window.sleTrees?.stats?.();
          return t ? { resident: t.trees, chunks: t.resident, instances: t.instances, meshes: t.meshes, triangles: t.triangles, gpuMB: t.gpuBytes / 2 ** 20, maxDistance: t.params.max } : null;
        })(),
      };
    });
    const shot = join(SHOTS, `perf-${id}-${v.id}.jpg`);
    await page.screenshot({ path: shot, type: 'jpeg', quality: 70 });
    views.push({ view: v.id, settleMs: viewSettleMs, raf, stepMs, ...mem, shot });
  }
  await page.close();
  return { profile: id, ...p, ceilingFps, uncapped: UNCAPPED, readyMs, settleMs, env, software, views, errors };
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: HEADLESS,
  defaultViewport: null,
  args: ['--enable-precise-memory-info', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--window-size=1500,1000', '--no-first-run', ...(UNCAPPED ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])],
});
mkdirSync(SHOTS, { recursive: true });
const results = [];
try {
  for (const id of PROFILE_IDS) results.push(await runProfile(browser, id));
} finally {
  await browser.close();
}

const out = join(SHOTS, `perf-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`);
writeFileSync(out, JSON.stringify({ url: URL_, date: new Date().toISOString(), results }, null, 2));

console.log(`\n| Profile | View | rAF fps (p95 ms) | step ms | JS heap MB | terrain GPU MB | triangles | calls | view settle s | trees (near/mid/far inst.) |`);
console.log(`|---|---|---|---|---|---|---|---|---|---|`);
for (const r of results) {
  for (const v of r.views) {
    const fps = v.raf ? `${r1(v.raf.fps)} (${r1(v.raf.p95)})` : 'n/a (hidden)';
    console.log(`| ${r.profile} | ${v.view} | ${fps} | ${r1(v.stepMs)} | ${r1(v.heapMB)} | ${r1(v.terrainGpuMB)} | ${(v.triangles / 1e6).toFixed(2)} M | ${v.calls} | ${v.settleMs == null ? 'timeout' : r1(v.settleMs / 1000)} | ${v.trees ? `${v.trees.instances.near}/${v.trees.instances.mid}/${v.trees.instances.far} · ${v.trees.meshes} meshes · ${r1(v.trees.gpuMB)} MB` : '–'} |`);
  }
}
for (const r of results) {
  console.log(`\n${r.label}: idle rAF ceiling ${r1(r.ceilingFps)} fps${r.uncapped ? ' (vsync off)' : ''}; ready ${r1(r.readyMs / 1000)} s, settled +${r.settleMs == null ? 'timeout' : r1(r.settleMs / 1000) + ' s'}; GL "${r.env.glRenderer}"${r.software ? ' ⚠️ SOFTWARE (fps invalid)' : ''}; ${r.env.visibility}; buffer ${r.env.drawingBuffer} (pixelRatio ${r.env.pixelRatio}); errors ${r.errors.length}`);
  for (const e of r.errors.slice(0, 5)) console.log(`  ! ${e.slice(0, 200)}`);
}
console.log(`\nJSON: ${out}`);
