#!/usr/bin/env node
// V2.8b: U3 walkthrough + performance of a `runtime.kind: "gltf"` zone (bakery) on the phone proxy (ADR 0028)
// and desktop. Overworld at the portal → *Betreten* (prompt button, cold: cache off, 4G on the phone) → loading
// screen → walk street → shop → courtyard (route planned on the collider toward the capture camera's shop and
// courtyard points) with the real input (W key on desktop,
// the ▲ hold button on the phone; the script turns the heading like a drag-look) → *Verlassen* → overworld pose.
//
//   pnpm run build && pnpm exec vite preview --port 5262 --strictPort &   # serves dist + public/data
//   pnpm run perf:gltf -- [--url 'http://127.0.0.1:5262/?aoi=overall'] [--zone bakery]
//                         [--path ../data/work/zones/bakery/package/package.json] [--profiles phone,desktop]
//
// The route is `walkPath` from the capture tool's package summary (JSON, read only). Headless Chrome only
// (puppeteer-core + system Chrome): never a visible window. Headless frame pacing is a proxy, not a phone; the
// GL renderer is printed so a software fallback is obvious. JSON + JPEGs go to the git-ignored docs/shots/v2.8b/.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SHOTS = join(ROOT, 'docs', 'shots', 'v2.8b');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const URL_ = opt('url', 'http://127.0.0.1:5262/?aoi=overall');
const ZONE = opt('zone', 'bakery');
const PATH_JSON = resolve(opt('path', join(ROOT, 'data', 'work', 'zones', ZONE, 'package', 'package.json')));
const PROFILE_IDS = opt('profiles', 'phone,desktop').split(',');
const CHROME = opt('chrome', process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');

/** Same device profiles as perf-proxy.mjs / perf-zone.mjs (ADR 0028). */
const PROFILES = {
  phone: { label: 'Phone proxy (390×844 @3×, 4× CPU, 4G 9 Mbit/s 150 ms)', width: 390, height: 844, dpr: 3, mobile: true, cpu: 4, net: { latency: 150, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 } },
  desktop: { label: 'Desktop (1440×900 @2×, no throttle)', width: 1440, height: 900, dpr: 2, mobile: false, cpu: 1, net: null },
};

const walkPath = JSON.parse(readFileSync(PATH_JSON, 'utf8')).walkPath;
if (!Array.isArray(walkPath) || walkPath.length < 2) throw new Error(`no walkPath in ${PATH_JSON}`);
// Targets from the capture route: the shop (highest camera point) and the courtyard (end). The handheld camera
// reached over counters, so the route itself is not walkable by a body: plan one on the collider (plan()).
const shopIdx = walkPath.reduce((b, p, i) => (p[1] > walkPath[b][1] ? i : b), 0);
const TARGETS = [
  { name: 'shop', at: walkPath[shopIdx] },
  { name: 'courtyard', at: walkPath.at(-1) },
];

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

/**
 * Steer along waypoints [from, to] in-page on rAF (heading toward the next point, like a drag-look), while the
 * caller holds the walk input. Records frame times. Resolves at the end or when stuck for 4 s.
 */
const steer = (page, pts, from, to) =>
  page.evaluate(
    (pts, from, to) =>
      new Promise((resolve) => {
        const h = window.sle.zones.flow.handle();
        const cam = h.camera.position;
        const dts = [];
        let i = from + 1;
        let last = performance.now();
        const t0 = last;
        let best = Infinity;
        let bestT = t0;
        const skipped = [];
        let walked = 0;
        let px = cam.x;
        let pz = cam.z;
        const tick = (t) => {
          dts.push(t - last);
          last = t;
          walked += Math.hypot(cam.x - px, cam.z - pz);
          px = cam.x;
          pz = cam.z;
          const [wx, , wz] = pts[i];
          const d = Math.hypot(wx - cam.x, wz - cam.z);
          if (d < best - 0.05) ((best = d), (bestT = t));
          if (d < 0.35 || t - bestT > 4000) {
            if (d >= 0.35) skipped.push({ i, d: Math.round(d * 100) / 100 });
            i++;
            best = Infinity;
            bestT = t;
          }
          if (i > to || t - t0 > 90_000) {
            dts.shift();
            const s = [...dts].sort((a, b) => a - b);
            const [ex, , ez] = pts[to];
            return resolve({
              fps: (dts.length * 1000) / (t - t0),
              p50: s[Math.floor(s.length * 0.5)],
              p95: s[Math.floor(s.length * 0.95)],
              max: s.at(-1) ?? null,
              seconds: (t - t0) / 1000,
              walkedM: walked,
              skipped,
              endDistM: Math.hypot(ex - cam.x, ez - cam.z),
              debug: h.debug(),
            });
          }
          // heading clockwise from grid north: x east, z south
          const want = (Math.atan2(wx - cam.x, -(wz - cam.z)) * 180) / Math.PI;
          h.controls.heading = (want + 360) % 360;
          h.controls.pitch = -8;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    pts,
    from,
    to,
  );

/**
 * Grid BFS (0.2 m) on the zone's walker, same rules (Walker.floorAt + wall band): holes keep the height, steps
 * ≤ STEP_UP up / STEP_DOWN down. Returns [x, y, z] waypoints ~0.6 m apart from the
 * camera to the reachable cell nearest `to`, and how far from `to` it ends.
 */
const plan = (page, to) =>
  page.evaluate((to) => {
    const h = window.sle.zones.flow.handle();
    const w = h.walker;
    const bb = h.ctx.manifest.assets.find((a) => a.role === 'scene').bboxLocal;
    const st = 0.2;
    const x0 = bb[0][0] - 1;
    const z0 = bb[0][2] - 1;
    const NX = Math.ceil((bb[1][0] - bb[0][0] + 2) / st);
    const NZ = Math.ceil((bb[1][2] - bb[0][2] + 2) / st);
    const cam = h.camera.position;
    // probed lazily from the parent cell's floor, like the walker (a ray from the knees, never from the roof)
    const G = new Float32Array(NX * NZ).fill(NaN);
    const B = new Int8Array(NX * NZ).fill(-1);
    const probe = (n, from) => {
      const x = x0 + (n % NX) * st;
      const z = z0 + ((n / NX) | 0) * st;
      const g = w.floorAt(x, z, from);
      G[n] = g;
      B[n] = w.pushOut(x, z, Number.isNaN(g) ? from : g) ? 1 : 0;
    };
    const ix = (x, z) => Math.round((z - z0) / st) * NX + Math.round((x - x0) / st);
    const a = ix(cam.x, cam.z);
    const bi = Math.round((to[0] - x0) / st);
    const bj = Math.round((to[2] - z0) / st);
    const H = new Float32Array(NX * NZ).fill(NaN);
    const prev = new Int32Array(NX * NZ).fill(-1);
    H[a] = w.groundY;
    prev[a] = a;
    const q = [a];
    let best = a;
    let bd = Infinity;
    for (let k = 0; k < q.length; k++) {
      const c = q[k];
      const ci = c % NX;
      const cj = (c / NX) | 0;
      const d = Math.hypot(ci - bi, cj - bj);
      if (d < bd) ((bd = d), (best = c));
      if (d < 1) break;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= NX || nj >= NZ) continue;
        const n = nj * NX + ni;
        if (prev[n] >= 0) continue;
        probe(n, H[c]);
        if (B[n] === 1) continue;
        const g = Number.isNaN(G[n]) ? H[c] : G[n];
        if (g - H[c] > 0.5) continue;
        H[n] = g;
        prev[n] = c;
        q.push(n);
      }
    }
    const path = [];
    for (let c = best; ; c = prev[c]) {
      path.push(c);
      if (prev[c] === c) break;
    }
    path.reverse();
    const pts = path.filter((_, i) => i > 0 && (i % 3 === 0 || i === path.length - 1)).map((c) => [x0 + (c % NX) * st, H[c], z0 + ((c / NX) | 0) * st]);
    return { pts, missM: bd * st, cells: q.length };
  }, to);

const counters = (page) =>
  page.evaluate(() => {
    const s = window.sle;
    const pm = performance.memory;
    // synchronous frame cost (update + render + 1-px readback): headroom under the vsync cap
    const gl = s.renderer.getContext();
    const px = new Uint8Array(4);
    s.step(3);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      s.step(1);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    const stepMs = (performance.now() - t0) / 20;
    return {
      stepMs,
      heapMB: pm ? pm.usedJSHeapSize / 2 ** 20 : null,
      triangles: s.renderer.info.render.triangles,
      calls: s.renderer.info.render.calls,
      textures: s.renderer.info.memory.textures,
      geometries: s.renderer.info.memory.geometries,
    };
  });

async function runProfile(browser, id) {
  const p = PROFILES[id];
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  await page.emulate({
    viewport: { width: p.width, height: p.height, deviceScaleFactor: p.dpr, isMobile: p.mobile, hasTouch: p.mobile },
    userAgent: p.mobile
      ? 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36'
      : await browser.userAgent(),
  });
  await page.evaluateOnNewDocument(() => {
    window.__perf = { ready: null };
    addEventListener('sle:ready', () => (window.__perf.ready = performance.now()), { once: true });
  });
  const errors = [];
  const zoneBytes = { n: 0, bytes: 0 };
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${new URL(r.url()).pathname}`));

  // Overworld: load, settle, hover 28 m in front of the portal and 24 m up, looking down at it (lower, the camera sits in the house across the street).
  await page.goto(URL_, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForFunction(() => window.__perf.ready != null, { timeout: 180_000, polling: 200 });
  await page.waitForFunction((z) => window.sle.zones?.portals().some((q) => q.zoneId === z), { timeout: 60_000, polling: 200 }, ZONE);
  await page.evaluate(() => document.querySelectorAll('[data-act="ok"]').forEach((b) => b.offsetParent && b.click()));
  // the first-flight tutorial (V2.9) would cover the shots: skip it like a returning visitor
  const closeTutorial = () => page.evaluate(() => document.querySelectorAll('[data-tut="close"]').forEach((b) => b.click()));
  await closeTutorial();
  await page.keyboard.press('Escape');
  const portal = await page.evaluate((z) => window.sle.zones.portals().find((q) => q.zoneId === z), ZONE);
  await page.evaluate(async (q) => {
    const f = (q.facing_deg * Math.PI) / 180;
    await window.sle.flyTo(q.E + 28 * Math.sin(f), q.N + 28 * Math.cos(f), { agl: 24, heading: (q.facing_deg + 180) % 360, pitch: -38, lookAt: false, duration: 0.3 });
  }, portal);
  await waitSettled(page, 120_000);
  await closeTutorial();
  await page.waitForSelector('.sle-prompt button', { timeout: 10_000 }).catch(() => null);
  const env = await page.evaluate(() => {
    const gl = window.sle.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { glRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), visibility: document.visibilityState, drawingBuffer: `${gl.drawingBufferWidth}×${gl.drawingBufferHeight}`, quality: window.sle.shell.quality?.() };
  });
  const software = /swiftshader|llvmpipe|software/i.test(env.glRenderer);
  const prompt = await page.evaluate(() => document.querySelector('.sle-prompt')?.textContent?.trim() ?? null);
  await page.screenshot({ path: join(SHOTS, `u3-${id}-1-portal.jpg`), type: 'jpeg', quality: 72 });
  const before = await page.evaluate(() => {
    const c = window.sle.camera;
    return { p: c.position.toArray(), heading: window.sle.controller.heading, pitch: window.sle.controller.pitch };
  });

  // Cold enter: cache off, phone network on from here (the overworld is already loaded).
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (p.net) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...p.net });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
  page.on('response', (r) => {
    const u = new URL(r.url()).pathname;
    if (u.includes(`/zones/${ZONE}/`) || /gltfZone|MeshBVH|basis_transcoder/.test(u)) {
      zoneBytes.n++;
      zoneBytes.bytes += Number(r.headers()['content-length'] ?? 0);
    }
  });
  const t0 = Date.now();
  if (prompt) await page.click('.sle-prompt button');
  else await page.evaluate((z) => void window.sle.zones.enter(z), ZONE);
  await sleep(p.net ? 600 : 150);
  await page.screenshot({ path: join(SHOTS, `u3-${id}-2-loading.jpg`), type: 'jpeg', quality: 72 });
  await page.waitForFunction(() => window.sle.zones.state() === 'zone', { timeout: 120_000, polling: 50 });
  const enterMs = Date.now() - t0;
  await page.waitForFunction(() => window.sle.zones.flow.handle()?.debug().lods.scene === 0, { timeout: 120_000, polling: 100 }).catch(() => null);
  const fineMs = Date.now() - t0;
  await sleep(300);
  await page.screenshot({ path: join(SHOTS, `u3-${id}-3-street.jpg`), type: 'jpeg', quality: 72 });
  const spawn = await page.evaluate(() => window.sle.zones.flow.handle().debug());

  // Walk the route with the real input.
  const holdOn = async () => {
    if (p.mobile) {
      const b = await page.$('.sle-zone-walkpad button');
      const box = await b.boundingBox();
      await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2);
    } else await page.keyboard.down('KeyW');
  };
  const holdOff = async () => (p.mobile ? page.touchscreen.touchEnd() : page.keyboard.up('KeyW'));
  const legs = [];
  for (const [k, t] of TARGETS.entries()) {
    const route = await plan(page, t.at);
    const pts = [[0, 0, 0], ...route.pts]; // steer() starts at index 1
    await holdOn();
    const r = await steer(page, pts, 0, pts.length - 1);
    await holdOff();
    // look where the capture camera looked there (the shot shows the place, not the last waypoint)
    await page.evaluate((hd) => {
      const c = window.sle.zones.flow.handle().controls;
      c.heading = hd;
      c.pitch = -5;
    }, t.at[3]);
    await sleep(400);
    await page.screenshot({ path: join(SHOTS, `u3-${id}-${4 + k}-${t.name}.jpg`), type: 'jpeg', quality: 72 });
    const end = await page.evaluate((to) => {
      const c = window.sle.zones.flow.handle().camera.position;
      return Math.hypot(to[0] - c.x, to[2] - c.z);
    }, t.at);
    legs.push({ leg: t.name, planMissM: route.missM, planPoints: route.pts.length, ...r, toTargetM: end, ...(await counters(page)) });
  }

  // Leave with the host's *Verlassen* button; the overworld pose must come back.
  await page.click('.sle-zone-leave');
  await page.waitForFunction(() => window.sle.zones.state() === 'overworld', { timeout: 10_000, polling: 50 });
  await sleep(300);
  const after = await page.evaluate(() => {
    const c = window.sle.camera;
    return { p: c.position.toArray(), heading: window.sle.controller.heading, pitch: window.sle.controller.pitch };
  });
  await page.screenshot({ path: join(SHOTS, `u3-${id}-6-back.jpg`), type: 'jpeg', quality: 72 });
  const poseBackM = Math.hypot(...after.p.map((v, i) => v - before.p[i]));
  await page.close();
  return { profile: id, ...p, env, software, prompt, enterMs, fineMs, zoneBytes, spawn, legs, poseBackM, headingBack: after.heading - before.heading, errors };
}

mkdirSync(SHOTS, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true, // never a visible Chrome window on the user's desktop
  defaultViewport: null,
  args: ['--enable-precise-memory-info', '--no-first-run'],
});
const results = [];
try {
  for (const id of PROFILE_IDS) results.push(await runProfile(browser, id));
} finally {
  await browser.close();
}
const out = join(SHOTS, `perf-gltf-${ZONE}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`);
writeFileSync(out, JSON.stringify({ url: URL_, zone: ZONE, date: new Date().toISOString(), walkPathPoints: walkPath.length, results }, null, 2));

console.log(`\n| Profile | Leg | rAF fps (p50 / p95 / max ms) | step ms | walked m | s | skipped wp | to target m (plan miss) | LOD | triangles | calls | heap MB |`);
console.log(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
for (const r of results) {
  for (const l of r.legs) {
    console.log(`| ${r.profile} | ${l.leg} | ${r1(l.fps)} (${r1(l.p50)} / ${r1(l.p95)} / ${r1(l.max)}) | ${r1(l.stepMs)} | ${r1(l.walkedM)} | ${r1(l.seconds)} | ${l.skipped.length} | ${r1(l.toTargetM)} (${r1(l.planMissM)}) | ${JSON.stringify(l.debug.lods)} | ${l.triangles} | ${l.calls} | ${r1(l.heapMB)} |`);
  }
}
for (const r of results) {
  console.log(`\n${r.label}: prompt "${r.prompt}"; cold enter ${r1(r.enterMs / 1000)} s (fine LOD at ${r1(r.fineMs / 1000)} s; ${r.zoneBytes.n} zone requests, ${r1(r.zoneBytes.bytes / 1e6)} MB); spawn h ${r1(r.spawn.pose.h)} ${r.spawn.pose.mode}; back in overworld: pose Δ ${r1(r.poseBackM)} m, heading Δ ${r1(r.headingBack)}°; GL "${r.env.glRenderer}"${r.software ? ' ⚠️ SOFTWARE (fps invalid)' : ''}; quality ${r.env.quality}; ${r.env.visibility}; buffer ${r.env.drawingBuffer}; errors ${r.errors.length}`);
  for (const e of r.errors.slice(0, 5)) console.log(`  ! ${e.slice(0, 200)}`);
  for (const l of r.legs) if (l.skipped.length) console.log(`  ${l.leg}: skipped waypoints ${JSON.stringify(l.skipped)}`);
}
console.log(`\nJSON: ${out}`);
