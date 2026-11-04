#!/usr/bin/env node
// Zone performance on the low-end phone proxy (ADR 0028) and on desktop: enter a module zone through the
// V2.6b runtime (`sle.zones.enter`), sample its Rundflug, the spawn, then a walk from a highlight.
//
//   pnpm run build && pnpm exec vite preview --port 5242 --strictPort &   # serves dist + public/data
//   pnpm run perf:zone -- [--url 'http://127.0.0.1:5242/?aoi=karlsberg'] [--zone schloss-karlsberg]
//                         [--goto KB-B01/B01.2.og-festsaal] [--profiles phone,desktop] [--sample-ms 5000] [--profile]
//                         [--runs 3] [--shots-dir perf-pass] [--sweep-s 70]
//
// Perf pass additions: `--runs N` repeats the whole cold run and prints medians; the Rundflug is swept in 0.5 s steps
// (`--sweep-s`) for the peak triangles in view; after the goto, frames > 50 / > 100 ms are counted (first-visit hitch);
// bytes fetched during the cold enter are summed (CDP encodedDataLength); the host's load average goes with every run.
//
// Headless Chrome only (puppeteer-core + system Chrome): never a visible window on the desktop. Headless
// frame pacing is not a phone's — the numbers are a proxy, and the GL renderer is printed so a software
// fallback is obvious. Writes JSON + JPEGs to the git-ignored docs/shots/ and prints a Markdown table.
// Never part of the production bundle (scripts/ is not imported by src/).
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(import.meta.dirname, '..', '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const SHOTS = join(ROOT, 'docs', 'shots');
const SHOT_DIR = opt('shots-dir', 'v2.7');
const RUNS = Number(opt('runs', 1));
const SWEEP_S = Number(opt('sweep-s', 70));
const load = () => loadavg().map((x) => Math.round(x * 100) / 100);
const median = (xs) => {
  const s = xs.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};
const URL_ = opt('url', 'http://127.0.0.1:5242/?aoi=karlsberg');
const ZONE = opt('zone', 'schloss-karlsberg');
const GOTO = opt('goto', 'KB-B01/B01.2.og-festsaal');
const PROFILE_IDS = opt('profiles', 'phone,desktop').split(',');
const CHROME = opt('chrome', process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const SAMPLE_MS = Number(opt('sample-ms', 5000));
const PROFILE = args.includes('--profile'); // CPU profile of goto + the first seconds there: top self-time functions

/** Same profiles as perf-proxy.mjs (ADR 0028): 4× CPU throttle, 30 fps target on the phone proxy. */
const PROFILES = {
  phone: { label: 'Phone proxy (390×844 @3×, 4× CPU, 4G 9 Mbit/s 150 ms)', width: 390, height: 844, dpr: 3, mobile: true, cpu: 4, net: { latency: 150, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 } },
  desktop: { label: 'Desktop (1440×900 @2×, no throttle)', width: 1440, height: 900, dpr: 2, mobile: false, cpu: 1, net: null },
};

const r1 = (v) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10) / 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitSettled(page, timeoutMs) {
  const t0 = Date.now();
  let quiet = 0;
  while (Date.now() - t0 < timeoutMs) {
    const pending = await page.evaluate(() => window.sle.terrainStats().pending);
    quiet = pending === 0 ? quiet + 1 : 0;
    if (quiet >= 3) return Date.now() - t0;
    await sleep(100);
  }
  return null;
}

/** rAF frame rate over `ms` (headless Chrome runs rAF; a hidden tab would not). */
const rafSample = (page, ms) =>
  page.evaluate(
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
            resolve({ fps: (dts.length * 1000) / (t - t0), p50: s[Math.floor(s.length * 0.5)], p95: s[Math.floor(s.length * 0.95)], max: s.at(-1) ?? null, long50: dts.filter((d) => d > 50).length, long100: dts.filter((d) => d > 100).length });
          }
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );

/**
 * The castle's review clock (KB-I64, clock.ts): after `step`/`goto` hooks the zone holds its frames until the next user
 * input, so a later rAF window would time an idle canvas. A synthetic keydown with no key hands the frames back.
 */
const release = (page) => page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified' })));

/** Synchronous frame cost via the frame owner (`sle.step` drives the zone) + 1-pixel readback; then counters. */
const frameStats = (page) =>
  page.evaluate(() => {
    const s = window.sle;
    const h = s.zones.flow.handle();
    const gl = s.renderer.getContext();
    const px = new Uint8Array(4);
    s.step(3);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      s.step(1);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    const stepMs = (performance.now() - t0) / 20;
    const hooks = h?.hooks ?? {};
    const tris = typeof hooks.triangles === 'function' ? hooks.triangles() : null;
    const q = typeof hooks.quality === 'function' ? hooks.quality() : null;
    const pm = performance.memory;
    return {
      stepMs,
      heapMB: pm ? pm.usedJSHeapSize / 2 ** 20 : null,
      triangles: tris?.rendered ?? s.renderer.info.render.triangles,
      calls: s.renderer.info.render.calls,
      geometries: s.renderer.info.memory.geometries,
      textures: s.renderer.info.memory.textures,
      quality: q ? `${q.preset} dpr ${q.dpr} scale ${q.adaptiveScale?.toFixed?.(2) ?? q.adaptiveScale}` : null,
      pose: typeof hooks.zonePose === 'function' ? hooks.zonePose() : null,
    };
  });

/** Top self-time functions of a CDP CPU profile (ms), with file:line. */
function topSelf(profile, n = 15) {
  const dt = new Map();
  profile.samples.forEach((id, k) => dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas[k] ?? 0) / 1000));
  const by = new Map();
  for (const node of profile.nodes) {
    const f = node.callFrame;
    const key = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}`;
    by.set(key, (by.get(key) ?? 0) + (dt.get(node.id) ?? 0));
  }
  return [...by].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, ms]) => `${Math.round(ms)} ms  ${k}`);
}

async function runProfile(browser, id, run = 0) {
  const p = PROFILES[id];
  const loadBefore = load();
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  let bytes = 0; // encoded bytes over the wire, all requests of this page
  cdp.on('Network.loadingFinished', (e) => (bytes += e.encodedDataLength ?? 0));
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.emulate({
    viewport: { width: p.width, height: p.height, deviceScaleFactor: p.dpr, isMobile: p.mobile, hasTouch: p.mobile },
    userAgent: p.mobile
      ? 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36'
      : await browser.userAgent(),
  });
  if (p.net) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...p.net });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
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
  await waitSettled(page, 120_000);
  await page.evaluate(() => document.querySelectorAll('[data-act="ok"]').forEach((b) => b.offsetParent && b.click()));
  await page.keyboard.press('Escape');
  const env = await page.evaluate(() => {
    const gl = window.sle.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      glRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      visibility: document.visibilityState,
      drawingBuffer: `${gl.drawingBufferWidth}×${gl.drawingBufferHeight}`,
    };
  });
  const software = /swiftshader|llvmpipe|software/i.test(env.glRenderer);

  // Enter through the runtime (portal flow without the walk to the portal): cold, cache disabled.
  const t0 = Date.now();
  const bytes0 = bytes;
  await page.evaluate((zone) => window.sle.zones.enter(zone), ZONE);
  const enterMs = Date.now() - t0;
  const enterMB = (bytes - bytes0) / 1e6;
  const views = [];
  const sample = async (view, walk = false) => {
    if (walk) await page.keyboard.down('KeyW');
    const raf = await rafSample(page, SAMPLE_MS);
    if (walk) await page.keyboard.up('KeyW');
    const stats = await frameStats(page);
    if (view !== 'rundflug') await release(page); // any key ends the Rundflug: keep it playing for the sweep
    const shot = join(SHOTS, SHOT_DIR, `perf-zone-${id}-${view}${RUNS > 1 ? `-r${run}` : ''}.jpg`);
    await page.screenshot({ path: shot, type: 'jpeg', quality: 70 });
    views.push({ view, raf, ...stats, shot });
  };

  await sample('rundflug');
  // Peak triangles in view over the rest of the Rundflug: fixed 0.5 s steps (the tour ends at the spawn by itself).
  const sweep = await page.evaluate((seconds) => {
    const h = window.sle.zones.flow.handle();
    // ADR 0033 / export-zone measure: `inView()` = submitted triangles of visible meshes in the camera frustum (no shadow
    // pass); `rendered` (renderer.info) also counts the shadow and post passes of that frame.
    const inView = h.hooks.inView;
    let max = 0;
    let maxRendered = 0;
    let maxCalls = 0;
    let at = 0;
    const t0 = performance.now();
    let worstStep = 0;
    for (let i = 0; i < seconds * 2; i++) {
      const ts = performance.now();
      h.step(1, 0.5);
      worstStep = Math.max(worstStep, performance.now() - ts);
      const t = typeof inView === 'function' ? inView().triangles : window.sle.renderer.info.render.triangles;
      if (t > max) {
        max = t;
        at = i / 2;
      }
      maxRendered = Math.max(maxRendered, window.sle.renderer.info.render.triangles);
      maxCalls = Math.max(maxCalls, window.sle.renderer.info.render.calls);
    }
    return { maxTriangles: max, maxRendered, atS: at, maxCalls, worstStepMs: worstStep, sweepMs: performance.now() - t0 };
  }, SWEEP_S);
  await release(page);
  await page.keyboard.press('KeyW'); // any input ends the Rundflug and lands at the spawn
  await sleep(500);
  await sample('spawn');
  // goto builds LOD2 + interiors + walk colliders synchronously; the first frames there compile shaders and upload
  // textures. Both are one-off costs of the first visit: report them apart from the steady walk.
  if (PROFILE) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
    await cdp.send('Profiler.start');
  }
  const tg = Date.now();
  const gotoOk = await page.evaluate((target) => window.sle.zones.flow.handle().goto(target), GOTO);
  const gotoMs = Date.now() - tg;
  const firstFrameMs = await page.evaluate(() => {
    const t = performance.now();
    window.sle.step(1);
    window.sle.renderer.getContext().readPixels(0, 0, 1, 1, 0x1908, 0x1401, new Uint8Array(4));
    return performance.now() - t;
  });
  await release(page); // goto + step hold the frames: the 3 s after the goto must be real wall-clock frames
  const settle = await rafSample(page, 3000);
  const hot = PROFILE ? topSelf((await cdp.send('Profiler.stop')).profile) : null;
  const walkFrom = await page.evaluate(() => window.sle.zones.flow.handle().hooks.zonePose());
  await sample('walk', true);
  const walkTo = views.at(-1).pose;
  const walkedM = walkFrom && walkTo ? Math.hypot(walkTo.E - walkFrom.E, walkTo.N - walkFrom.N) : null;

  await page.evaluate(() => window.sle.zones.exit());
  await sleep(300);
  const after = await page.evaluate(() => window.sle.zones.state());
  await page.close();
  return { profile: id, run, ...p, loadBefore, loadAfter: load(), env, software, enterMs, enterMB, gotoOk, gotoMs, firstFrameMs, settle, sweep, hot, walkedM, stateAfterExit: after, views, errors };
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true, // never a visible Chrome window on the user's desktop
  defaultViewport: null,
  args: ['--enable-precise-memory-info', '--no-first-run'],
});
mkdirSync(join(SHOTS, SHOT_DIR), { recursive: true });
const results = [];
try {
  for (let run = 0; run < RUNS; run++) for (const id of PROFILE_IDS) results.push(await runProfile(browser, id, run));
} finally {
  await browser.close();
}

const out = join(SHOTS, SHOT_DIR, `perf-zone-${ZONE}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`);
writeFileSync(out, JSON.stringify({ url: URL_, zone: ZONE, goto: GOTO, date: new Date().toISOString(), results }, null, 2));

console.log(`\n| Profile | View | rAF fps (p95, max ms) | step ms | JS heap MB | triangles | calls | quality |`);
console.log(`|---|---|---|---|---|---|---|---|`);
for (const r of results) {
  for (const v of r.views) {
    const fps = v.raf ? `${r1(v.raf.fps)} (${r1(v.raf.p95)}, max ${r1(v.raf.max)})` : 'n/a (hidden)';
    console.log(`| ${r.profile} | ${v.view} | ${fps} | ${r1(v.stepMs)} | ${r1(v.heapMB)} | ${(v.triangles / 1e6).toFixed(2)} M | ${v.calls} | ${v.quality ?? '–'} |`);
  }
}
for (const r of results) {
  console.log(`\n${r.label} run ${r.run} (load ${r.loadBefore.join(' ')} → ${r.loadAfter.join(' ')}): enter ${r1(r.enterMs / 1000)} s / ${r1(r.enterMB)} MB; Rundflug sweep peak ${(r.sweep.maxTriangles / 1e6).toFixed(2)} M tris in view at +${r.sweep.atS} s (rendered incl. shadow ≤ ${(r.sweep.maxRendered / 1e6).toFixed(2)} M), ≤ ${r.sweep.maxCalls} calls, worst step ${r1(r.sweep.worstStepMs)} ms; after goto: ${r.settle?.long50 ?? '?'} frames > 50 ms, ${r.settle?.long100 ?? '?'} > 100 ms; goto ${GOTO} ${r.gotoOk ? 'ok' : 'FAILED'} in ${r1(r.gotoMs / 1000)} s, first frame there ${r1(r.firstFrameMs)} ms, next 3 s ${r1(r.settle?.fps)} fps (max ${r1(r.settle?.max)} ms); walked ${r1(r.walkedM)} m; after exit: ${r.stateAfterExit}; GL "${r.env.glRenderer}"${r.software ? ' ⚠️ SOFTWARE (fps invalid)' : ''}; ${r.env.visibility}; buffer ${r.env.drawingBuffer}; errors ${r.errors.length}`);
  for (const e of r.errors.slice(0, 5)) console.log(`  ! ${e.slice(0, 200)}`);
  if (r.hot) console.log(`  hot (goto + 3 s):\n    ${r.hot.join('\n    ')}`);
}
if (RUNS > 1) {
  console.log(`\n**Medians over ${RUNS} runs**\n\n| Profile | View | rAF fps | p95 ms | max ms | step ms | triangles | calls |\n|---|---|---|---|---|---|---|---|`);
  for (const id of PROFILE_IDS) {
    const rs = results.filter((r) => r.profile === id);
    for (const view of rs[0].views.map((v) => v.view)) {
      const vs = rs.map((r) => r.views.find((v) => v.view === view));
      console.log(`| ${id} | ${view} | ${r1(median(vs.map((v) => v.raf?.fps)))} | ${r1(median(vs.map((v) => v.raf?.p95)))} | ${r1(median(vs.map((v) => v.raf?.max)))} | ${r1(median(vs.map((v) => v.stepMs)))} | ${(median(vs.map((v) => v.triangles)) / 1e6).toFixed(2)} M | ${median(vs.map((v) => v.calls))} |`);
    }
    const m = (f) => r1(median(rs.map(f)));
    console.log(`| ${id} | enter s / MB · goto s · first frame ms · after-goto max ms, >50, >100 · sweep peak M tris | ${m((r) => r.enterMs / 1000)} / ${m((r) => r.enterMB)} · ${m((r) => r.gotoMs / 1000)} · ${m((r) => r.firstFrameMs)} · ${m((r) => r.settle?.max)}, ${m((r) => r.settle?.long50)}, ${m((r) => r.settle?.long100)} · ${(median(rs.map((r) => r.sweep.maxTriangles)) / 1e6).toFixed(2)} | load ${rs.map((r) => r.loadBefore[0]).join(', ')} | | | | | |`);
  }
}
console.log(`\nJSON: ${out}`);
