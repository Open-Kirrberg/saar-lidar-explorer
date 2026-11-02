#!/usr/bin/env node
/**
 * Fixed-pose screenshots + GPU timings of the castle viewer, for before/after visual reviews.
 * Zero dependencies: launches headless Chrome (Metal via ANGLE) and talks CDP over Node's built-in WebSocket.
 *
 *   node .claude/skills/skb-visual-wow/scripts/shots.mjs --out docs/visual/2026-11-02-before
 *   node .claude/skills/skb-visual-wow/scripts/shots.mjs --out <dir> --bench --retina --only 01,03,08
 *   node .claude/skills/skb-visual-wow/scripts/shots.mjs --list
 *
 * Options:
 *   --url <u>        viewer URL (default http://localhost:5260/ - use localhost, Vite binds [::1] on macOS)
 *   --out <dir>      output dir (created); writes <pose>.jpg, report.json, report.md
 *   --size WxH       screenshot size at DPR 1 (default 1920x1080)
 *   --only a,b       pose ids or numeric prefixes (default: all)
 *   --bench          also run skb.gpuBench(20, [1920,1080]) per pose
 *   --retina         with --bench, also measure at 3024x1964 (MacBook DPR 2)
 *   --setup '<js>'   JS run once in the page after load (runtime A/B, e.g. hide the forest)
 *   --ui             keep the panel/footer visible (default: hidden for clean shots)
 *   --chrome <path>  Chrome binary (default $CHROME_BIN or the macOS app path)
 *   --headful        show the window (default headless=new)
 *   --list           print the poses and exit
 *
 * Pose geometry is relative to building centres (skb.entries) and named POIs (skb.pois), so it survives
 * catalogue changes. Poses 04, 05 and 11 approximate the 2026-11-02 audit shots (its pose helper was not kept).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// ------------------------------------------------------------------ poses
// Each `js` runs in the page with `skb` and helper `P` in scope (see PAGE_HELPERS) and may be async.
export const POSES = [
  { id: '01-aerial-west', hour: 10.5, js: `P.goto('view-west')`, note: 'POI view-west (Ehrenhof from W, 105 m up)' },
  { id: '02-aerial-east', hour: 10.5, js: `P.goto('view-east')`, note: 'POI view-east (garden side)' },
  { id: '03-ehrenhof-eye', hour: 10.5, js: `P.goto('view-ehrenhof')`, note: 'POI view-ehrenhof (walk, eye level)' },
  { id: '04-garden-front', hour: 10.5, js: `P.axis('KB-B01', 62, 0, 'walk', 4)`, note: 'eye level ~62 m E of the CdL centre (in the TF-09 parterre) on the palace axis, looking back' },
  { id: '05-orangerie-slope', hour: 10.5, js: `P.offset('KB-B10', -120, 0, 25, 0)`, note: '120 m W of B10, 25 m above ground' },
  { id: '06-festsaal-day', hour: 10.5, js: `P.room(/Festsaal/)`, note: 'room POI Festsaal' },
  { id: '07-festsaal-night', hour: 22, js: `P.room(/Festsaal/)`, note: 'room POI Festsaal, 22:00 (sun -13.7 deg)' },
  { id: '08-golden-hour-aerial', hour: 19.2, js: `P.goto('view-west')`, note: '19:12, sun 6 deg' },
  { id: '09-golden-hour-ehrenhof', hour: 19.2, js: `P.goto('view-ehrenhof')`, note: '19:12, sun 6 deg' },
  { id: '10-dusk-exterior', hour: 21, js: `P.goto('view-ehrenhof')`, note: '21:00, sun -7.9 deg (civil/nautical twilight)' },
  { id: '11-low-flight-forest', hour: 10.5, js: `P.offset('KB-B01', -650, 120, 35, 10)`, note: 'low flight W of the palace, 35 m above ground, looking at the CdL' },
  { id: '12-hero-court-1730', hour: 17.5, js: `P.goto('view-ehrenhof')`, note: 'hero hour: sun 22 deg from 278 deg rakes the W court front' },
  { id: '13-hero-garden-0700', hour: 7, js: `P.axis('KB-B01', 62, 0, 'walk', 4)`, note: 'garden front at 07:00, sun 25 deg from 85 deg' },
];

const PAGE_HELPERS = `
const V = skb.camera.position.constructor;
const P = {
  centre(id) { const e = skb.entries.get(id); if (!e) throw new Error('no building ' + id); return e.centre; },
  ground(x, z) { const g = skb.controls.ground(x, z); return Number.isFinite(g) ? g : 345; },
  place(x, y, z, lx, ly, lz, mode) {
    skb.setMode('fly');
    skb.camera.position.set(x, y, z);
    if (mode === 'walk') skb.setMode('walk');
    skb.controls.lookAt(new V(lx, ly, lz));
  },
  goto(id) { if (!skb.goto(id)) throw new Error('no POI ' + id); },
  room(re) { const p = skb.pois.find((q) => q.kind === 'room' && re.test(q.name_de)); if (!p) throw new Error('no room ' + re); skb.goto(p.id); },
  /** d metres along the palace axis (80.5 deg grid; + = garden/E) from building id, lateral offset s, look back at it. */
  axis(id, d, s, mode, lookUp) {
    const c = P.centre(id); const a = 80.5 * Math.PI / 180;
    const ux = Math.sin(a), uz = -Math.cos(a);
    const x = c.x + ux * d - uz * s, z = c.z + uz * d + ux * s;
    P.place(x, P.ground(x, z) + 1.65, z, c.x, c.y + (lookUp ?? 6), c.z, mode);
  },
  /** offset (dx, dz) in local metres from building id, h metres above ground, look at its centre + lookUp. */
  offset(id, dx, dz, h, lookUp) {
    const c = P.centre(id); const x = c.x + dx, z = c.z + dz;
    P.place(x, P.ground(x, z) + h, z, c.x, c.y + (lookUp ?? 0), c.z, 'fly');
  },
};
`;

// ------------------------------------------------------------------ args
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const flag = (k) => argv.includes(k);
process.stdout.on('error', () => {}); // ignore EPIPE when piped into head/tail
if (flag('--list')) {
  for (const p of POSES) console.log(`${p.id.padEnd(26)} hour ${String(p.hour).padEnd(5)} ${p.note}`);
  process.exit(0);
}
const url = opt('--url', 'http://localhost:5260/');
const outDir = opt('--out');
if (!outDir) {
  console.error('missing --out <dir> (see header for usage)');
  process.exit(2);
}
const [W, H] = opt('--size', '1920x1080').split('x').map(Number);
const only = opt('--only', '')
  .split(',')
  .filter(Boolean);
const poses = only.length ? POSES.filter((p) => only.some((o) => p.id === o || p.id.startsWith(o + '-') || p.id.startsWith(o))) : POSES;
const chromeBin =
  opt('--chrome') ??
  process.env.CHROME_BIN ??
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
if (!chromeBin) {
  console.error('no Chrome found (set CHROME_BIN or --chrome)');
  process.exit(2);
}

// ------------------------------------------------------------------ chrome + CDP
const profile = mkdtempSync(join(tmpdir(), 'skb-shots-'));
const chrome = spawn(
  chromeBin,
  [
    flag('--headful') ? '' : '--headless=new',
    '--use-angle=metal',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--window-size=${W},${H}`,
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    'about:blank',
  ].filter(Boolean),
  { stdio: 'ignore' },
);
const cleanup = () => {
  try {
    chrome.kill();
  } catch {}
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
};
process.on('exit', cleanup);

async function devtoolsPort() {
  const f = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 200; i++) {
    if (existsSync(f)) {
      const port = readFileSync(f, 'utf8').split('\n')[0];
      if (port) return port;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Chrome did not start (no DevToolsActivePort)');
}

let ws;
let seq = 0;
const pending = new Map();
const events = [];
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej, method }));
}
async function evaluate(expr, timeoutMs = 120000) {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate timeout: ' + expr.slice(0, 80))), timeoutMs)),
  ]);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

const port = await devtoolsPort();
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.onopen = r;
  ws.onerror = j;
});
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.rej(new Error(`${p.method}: ${msg.error.message}`));
    else p.res(msg.result);
  } else if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
    events.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    events.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  }
};
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });

// wait for the viewer (terrain + 90-odd buildings take a few seconds)
const t0 = Date.now();
for (;;) {
  const ok = await evaluate(`!!(window.skb && window.skb.placed > 0 && window.skb.entries.size > 0)`).catch(() => false);
  if (ok) break;
  if (Date.now() - t0 > 180000) throw new Error(`viewer not ready at ${url} after 180 s - is \`pnpm run dev\` running?`);
  await new Promise((r) => setTimeout(r, 500));
}
const gpu = await evaluate(`(() => { const gl = skb.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; })()`);
console.error(`[shots] viewer ready in ${((Date.now() - t0) / 1000).toFixed(1)} s on ${gpu}`);
await evaluate(`${PAGE_HELPERS}; window.__P = P; true`);
if (!flag('--ui')) await evaluate(`for (const id of ['panel','infobox','footer','status','crosshair']) { const el = document.getElementById(id); if (el) el.style.visibility = 'hidden'; } true`);
const setup = opt('--setup');
if (setup) await evaluate(`(async () => { ${setup}; })().then(() => true)`);

// ------------------------------------------------------------------ shoot
const out = resolve(outDir);
mkdirSync(out, { recursive: true });
const rows = [];
for (const p of poses) {
  const evBefore = events.length;
  await evaluate(`(async () => { const P = window.__P; skb.set('hour', ${p.hour}); await (async () => { ${p.js}; })(); skb.step(90); })().then(() => true)`);
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85, captureBeyondViewport: false });
  writeFileSync(join(out, `${p.id}.jpg`), Buffer.from(shot.data, 'base64'));
  const info = await evaluate(
    `(() => { const c = skb.camera.position; const i = skb.renderer.info; return { cam: [c.x, c.y, c.z].map((v) => +v.toFixed(2)), yaw: +skb.controls.yaw.toFixed(4), pitch: +skb.controls.pitch.toFixed(4), mode: skb.controls.mode, calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? null }; })()`,
  );
  const row = { id: p.id, hour: p.hour, note: p.note, ...info };
  if (flag('--bench')) {
    row.gpu1080 = await evaluate(`skb.gpuBench(20, [1920, 1080])`);
    if (flag('--retina')) row.gpuRetina = await evaluate(`skb.gpuBench(20, [3024, 1964])`);
  }
  row.console = events.slice(evBefore);
  rows.push(row);
  const ms = row.gpu1080 ? ` gpu ${row.gpu1080.gpuMs.toFixed(1)} ms` + (row.gpuRetina ? ` / retina ${row.gpuRetina.gpuMs.toFixed(1)} ms` : '') : '';
  console.error(`[shots] ${p.id}: ${row.calls} calls, ${(row.triangles / 1e6).toFixed(2)} M tris${ms}`);
}

const fmt = (b) => (b && Number.isFinite(b.gpuMs) ? b.gpuMs.toFixed(1) : '-');
const md = [
  `# Shots ${new Date().toISOString().slice(0, 16)} (${gpu})`,
  '',
  `URL ${url}, ${W}x${H} DPR 1${setup ? `, setup: \`${setup}\`` : ''}. GPU ms from skb.gpuBench(20): noisy, compare only within one run (+-50 %).`,
  '',
  '| Pose | Hour | GPU 1080p ms | GPU 3024x1964 ms | CPU ms | Calls | Tris (M) | Console |',
  '|---|---|---|---|---|---|---|---|',
  ...rows.map(
    (r) =>
      `| [${r.id}](${r.id}.jpg) | ${r.hour} | ${fmt(r.gpu1080)} | ${fmt(r.gpuRetina)} | ${r.gpu1080 ? r.gpu1080.cpuMs.toFixed(1) : '-'} | ${r.calls} | ${(r.triangles / 1e6).toFixed(2)} | ${r.console.length ? r.console.length + ' msg' : ''} |`,
  ),
  '',
  `Load-time console messages: ${events.length - rows.reduce((n, r) => n + r.console.length, 0)}.`,
  '',
];
writeFileSync(join(out, 'report.json'), JSON.stringify({ url, size: [W, H], gpu, setup: setup ?? null, events, rows }, null, 2));
writeFileSync(join(out, 'report.md'), md.join('\n'));
console.log(md.join('\n'));
ws.close();
cleanup();
process.exit(0);
