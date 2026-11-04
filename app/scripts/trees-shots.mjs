#!/usr/bin/env node
// V2.4 trees: browser check — fixed views, screenshots + stats via window.sle.step() (works in hidden tabs).
//   node scripts/trees-shots.mjs --url http://127.0.0.1:5245/?aoi=overall --out ../docs/shots/v24b [--views forest,p1] [--dpr 1]
// Not part of the bundle (scripts/ is not imported by src/).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const URL_ = opt('url', 'http://127.0.0.1:5245/?aoi=overall');
const OUT = resolve(opt('out', '../docs/shots/v24b'));
const DPR = Number(opt('dpr', '1'));
const W = Number(opt('w', '1440'));
const H = Number(opt('h', '900'));
const CHROME = opt('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');

/** E/N EPSG:25832. layer: display key; trees: on/off; exag. */
const ALL = {
  forest: { E: 382556, N: 5465632, agl: 60, pitch: -15, heading: 300 },
  ground: { E: 382556, N: 5465632, agl: 2, pitch: 2, heading: 300 },
  kirrberg: { E: 381455, N: 5462119, agl: 150, pitch: -30, heading: 0 },
  castle: { E: 382195, N: 5466095, agl: 120, pitch: -35, heading: 0 },
  high: { E: 382000, N: 5463500, agl: 700, pitch: -25, heading: 20 },
  // H7 plots (pipeline/README "Trees"): plot centres, straight down over the orthophoto
  p1: { E: 383335, N: 5465635, agl: 220, pitch: -89.9, heading: 0, layer: 'ortho', top: true },
  p2: { E: 382465, N: 5465565, agl: 110, pitch: -89.9, heading: 0, layer: 'ortho', top: true },
  p3: { E: 381795, N: 5460425, agl: 110, pitch: -89.9, heading: 0, layer: 'ortho', top: true },
};
const VIEW_IDS = opt('views', Object.keys(ALL).join(',')).split(',');
const EXAG = Number(opt('exag', '1'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new', // never a visible window on the user's desktop
  args: ['--enable-precise-memory-info', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', `--window-size=${W},${H}`],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${t}`);
});
await page.goto(URL_, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.sle && window.sle.terrainStats, { timeout: 120000, polling: 200 });
await page.evaluate(() => new Promise((r) => (document.querySelector('#loading')?.hidden ? r() : addEventListener('sle:ready', r, { once: true }))));
await page.evaluate(() => document.querySelectorAll('[data-act="ok"]').forEach((b) => b.offsetParent && b.click()));
await page.keyboard.press('Escape');
const env = await page.evaluate(() => {
  const gl = window.sle.renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return { gl: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '?', vis: document.visibilityState };
});
console.log('GL', env.gl, env.vis);

const results = {};
for (const id of VIEW_IDS) {
  const v = ALL[id];
  if (!v) continue;
  await page.evaluate((v, exag) => {
    const s = window.sle;
    s.store.set({ exaggeration: exag }, 'gui');
    if (v.layer) s.store.set({ layer: v.layer }, 'gui');
    void s.flyTo(v.E, v.N, { agl: v.agl, pitch: v.pitch, heading: v.heading, duration: 0 });
  }, v, EXAG);
  // settle: terrain + trees streaming
  for (let k = 0; k < 400; k++) {
    const st = await page.evaluate(() => {
      window.sle.step(2);
      const t = window.sleTrees?.stats();
      return { p: window.sle.terrainStats().pending, t: t ? t.pending + t.loading : 0 };
    });
    if (st.p === 0 && st.t === 0 && k > 10) break;
    await sleep(60);
  }
  const shots = {};
  for (const mode of v.top ? ['trees', 'notrees'] : ['trees']) {
    const stats = await page.evaluate((mode) => {
      const s = window.sle;
      window.sleTrees?.setVisible(mode === 'trees');
      s.step(3);
      const info = s.renderer.info.render;
      return { calls: info.calls, triangles: info.triangles, trees: window.sleTrees?.stats(), terrain: s.terrainStats().gpuMB, pose: s.store.get() };
    }, mode);
    const file = join(OUT, `trees-${id}${mode === 'notrees' ? '-off' : ''}${EXAG !== 1 ? `-x${EXAG}` : ''}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 82 });
    shots[mode] = { file, ...stats, pose: { E: stats.pose.E, N: stats.pose.N, h: stats.pose.h, agl: stats.pose.agl } };
  }
  await page.evaluate(() => window.sleTrees?.setVisible(true));
  if (v.layer) await page.evaluate(() => window.sle.store.set({ layer: 'vat' }, 'gui'));
  results[id] = shots;
  const t = shots.trees.trees;
  console.log(`${id}: calls ${shots.trees.calls}, tris ${(shots.trees.triangles / 1e6).toFixed(2)} M, trees resident ${t?.trees} in ${t?.resident} chunks, inst near/mid/far ${t?.instances.near}/${t?.instances.mid}/${t?.instances.far}, meshes ${t?.meshes}`);
}
writeFileSync(join(OUT, 'trees-shots.json'), JSON.stringify({ url: URL_, env, results, errors }, null, 2));
console.log('errors', errors.length);
for (const e of errors.slice(0, 12)) console.log('  !', e.slice(0, 220));
await browser.close();
