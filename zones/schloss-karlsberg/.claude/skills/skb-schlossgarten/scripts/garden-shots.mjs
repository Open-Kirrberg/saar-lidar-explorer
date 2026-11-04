#!/usr/bin/env node
// Garden / landscape before-after shots + vegetation stats for the Schloss Karlsberg viewer.
//
// Drives a headless Chrome over CDP (Node >= 22: global fetch + WebSocket, no npm deps) against a RUNNING viewer
// dev server (pnpm run dev -> http://localhost:5260/). Uses only the window.skb test hooks and frames advanced with
// skb.step(n) (headless / hidden tabs pause rAF). Writes <out>/<pose>.jpg and <out>/stats.json.
//
//   node .claude/skills/skb-schlossgarten/scripts/garden-shots.mjs --out docs/garden/before [--hour 17.5]
//        [--bench] [--only 03-herzogsgarten-eye,06-paradestrasse] [--url http://localhost:5260/] [--ui]
//
// Run from the zones/schloss-karlsberg/ folder (it reads model/catalogue.json for the palace grid). Chrome binary:
// $CHROME_BIN or the macOS default. GPU timings in headless Chrome are noisy (+-50 %): compare before/after
// within one run on the same machine, never across runs.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i < 0 ? d : args[i + 1];
};
const flag = (k) => args.includes(`--${k}`);
const OUT = opt('out');
if (!OUT) {
  console.error('usage: garden-shots.mjs --out <dir> [--hour 10.5] [--bench] [--only a,b] [--url ...] [--ui]');
  process.exit(2);
}
const URL_ = opt('url', 'http://localhost:5260/');
const HOUR = Number(opt('hour', '10.5'));
const ONLY = opt('only', '')
  .split(',')
  .filter(Boolean);
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9300 + Math.floor(Math.random() * 600);

// palace grid (u along the Ehrenhof / CdL axis toward the E, v toward N) -> local frame x = E - E0, z = -(N - N0)
const cat = JSON.parse(readFileSync('model/catalogue.json', 'utf8'));
const pg = cat.palace_grid;
const az = (pg.u_azimuth_grid_deg * Math.PI) / 180;
const uEN = [Math.sin(az), Math.cos(az)];
const vEN = [-Math.cos(az), Math.sin(az)];
const E0 = 381000;
const N0 = 5465000;
const uv = (u, v) => {
  const E = pg.origin_EN[0] + u * uEN[0] + v * vEN[0];
  const N = pg.origin_EN[1] + u * uEN[1] + v * vEN[1];
  return [E - E0, -(N - N0)];
};
const en = (E, N) => [E - E0, -(N - N0)];
const tf = (id) => cat.terrain_features.find((f) => f.id === id);

// Poses: either a viewer POI id, or eye/target in local [x, z] with heights above the ground (m).
// Keep these stable: before/after pairs are only comparable at identical poses.
const p10 = tf('TF-10')?.geometry.coordinates ?? [[382175.7, 5466362.9], [382182, 5466848]];
const POSES = [
  { id: '01-aerial-west', poi: 'view-west' },
  { id: '02-aerial-east', poi: 'view-east' },
  { id: '03-herzogsgarten-eye', eye: uv(130, 8), eyeH: 1.8, at: uv(40, 0), atH: 8 },
  { id: '04-herzogsgarten-low', eye: uv(230, -70), eyeH: 35, at: uv(70, 0), atH: 2 },
  { id: '05-orangerie-terrace', eye: uv(-70, -240), eyeH: 40, at: uv(10, -120), atH: 0 },
  { id: '06-paradestrasse', eye: en(...p10[1]), eyeH: 2.5, at: en(...p10[p10.length - 1]), atH: 4 },
  { id: '07-karlslust', poi: 'view-karlslust' },
  { id: '08-forest-edge-west', eye: uv(-380, -60), eyeH: 70, at: uv(0, 0), atH: 0 },
].filter((p) => !ONLY.length || ONLY.includes(p.id));

const VEG_STATS = `(() => {
  const out = {};
  skb.scene.traverse((o) => {
    if (!o.isInstancedMesh) return;
    const key = o.name.split('/').slice(0, 3).join('/');
    const tris = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    const r = (out[key] ??= { meshes: 0, instances: 0, tris: 0, maxBoundingRadius: 0, castShadow: false });
    r.meshes++; r.instances += o.count; r.tris += tris * o.count; r.castShadow ||= o.castShadow;
    r.maxBoundingRadius = Math.max(r.maxBoundingRadius, Math.round(o.boundingSphere?.radius ?? 0));
  });
  return out;
})()`;

const profile = mkdtempSync(join(tmpdir(), 'skb-garden-'));
const chrome = spawn(CHROME, ['--headless=new', '--use-angle=metal', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1920,1080', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let target;
  for (let k = 0; k < 60 && !target; k++) {
    try {
      target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${URL_}`, { method: 'PUT' })).json();
    } catch {
      await sleep(500);
    }
  }
  if (!target) throw new Error('Chrome DevTools endpoint did not come up');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pend = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)(m);
      pend.delete(m.id);
    }
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++seq;
      pend.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const ev = async (expression) => {
    const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (m.result?.exceptionDetails) throw new Error(`${expression.slice(0, 80)}: ${m.result.exceptionDetails.exception?.description}`);
    return m.result?.result?.value;
  };
  let ready = false;
  for (let k = 0; k < 180 && !ready; k++) {
    ready = await ev('!!window.skb').catch(() => false);
    if (!ready) await sleep(1000);
  }
  if (!ready) throw new Error(`window.skb did not appear at ${URL_} (is pnpm run dev running?)`);
  await ev(`skb.set('epoch', '1789'); skb.set('hour', ${HOUR}); skb.step(2)`);
  if (!flag('ui')) await ev(`document.getElementById('panel') && (document.getElementById('panel').style.display = 'none')`);
  mkdirSync(OUT, { recursive: true });
  const stats = { url: URL_, hour: HOUR, date: new Date().toISOString(), vegetation: await ev(VEG_STATS), poses: {} };
  for (const p of POSES) {
    if (p.poi) {
      if (!(await ev(`skb.goto(${JSON.stringify(p.poi)})`))) {
        console.warn(`skip ${p.id}: POI ${p.poi} not found`);
        continue;
      }
    } else {
      await ev(`(() => {
        const g = skb.controls.ground;
        const ey = g(${p.eye[0]}, ${p.eye[1]}) + ${p.eyeH};
        const ty = g(${p.at[0]}, ${p.at[1]}) + ${p.atH};
        skb.setMode('fly');
        skb.camera.position.set(${p.eye[0]}, ey, ${p.eye[1]});
        skb.controls.lookAt(skb.camera.position.clone().set(${p.at[0]}, ty, ${p.at[1]}));
      })()`);
    }
    await ev('skb.step(6)');
    const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
    writeFileSync(join(OUT, `${p.id}.jpg`), Buffer.from(shot.result.data, 'base64'));
    const entry = { camera: await ev('skb.camera.position.toArray().map((v) => +v.toFixed(1))'), triangles: await ev('skb.triangles()') };
    if (flag('bench')) entry.gpuBench1080 = await ev('skb.gpuBench(20, [1920, 1080])');
    stats.poses[p.id] = entry;
    console.log(`${p.id}: ${JSON.stringify(entry)}`);
  }
  writeFileSync(join(OUT, 'stats.json'), JSON.stringify(stats, null, 1));
  console.log(`wrote ${POSES.length} shots + stats.json to ${resolve(OUT)}`);
  ws.close();
} finally {
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
