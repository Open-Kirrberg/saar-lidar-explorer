#!/usr/bin/env node
// Reproducible screenshots + GPU timings of the castle viewer at the standard poses of docs/visual-audit.md §2.
// Drives a headless Chrome over CDP on the real GPU (ANGLE/Metal), so it works when the Chrome extension is not
// connected and rAF would be paused anyway. Needs a running viewer (pnpm run dev → http://localhost:5260/).
//
//   node .claude/skills/skb-improve/scripts/shots.mjs --out docs/shots/KB-I05-before
//   node .claude/skills/skb-improve/scripts/shots.mjs --out <dir> --poses 01,03,08 --bench
//   node .claude/skills/skb-improve/scripts/shots.mjs --list
//
// Options: --out <dir> (required unless --list) · --poses <ids|all> (default all) · --bench (gpuBench at 1920×1080
// and 3024×1964 per pose → bench.json + a markdown table on stdout) · --url <viewer url> (default
// http://localhost:5260/) · --eval "<js>" (run once after load, e.g. a runtime A/B toggle) · --quality <0-100>.
// Env: CHROME_BIN overrides the Chrome path. Exit code 1 on page exceptions or a missing viewer.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Same poses (ids, hours, cameras) as docs/visual-audit.md §2, so before/after shots compare 1:1.
// G = palace anchor (lookAt of view-east); gr(x, z) = terrain height; pose() sets an exact camera.
const POSES = [
  ['01-aerial-west', 'Übersicht West, 10:30', `skb.set('hour', 10.5); skb.goto('view-west'); skb.step(60)`],
  ['02-aerial-east', 'Übersicht Ost, 10:30', `skb.set('hour', 10.5); skb.goto('view-east'); skb.step(60)`],
  ['03-ehrenhof-eye', 'Ehrenhof Augenhöhe, 10:30', `skb.set('hour', 10.5); skb.goto('view-ehrenhof'); skb.step(60)`],
  ['04-garden-front', 'Gartenseite CdL, Augenhöhe 95 m E, 10:30', `skb.set('hour', 10.5); (() => { const x = G.x + 95, z = G.z - 14; pose(x, gr(x, z) + 1.65, z, G.x, 351, G.z, 'walk'); })()`],
  ['05-orangerie-slope', 'Orangerie von W, 25 m über Grund, 10:30', `skb.set('hour', 10.5); (() => { const c = skb.entries.get('KB-B10').centre; const x = c.x - 120, z = c.z + 25; pose(x, gr(x, z) + 25, z, c.x, c.y + 6, c.z); })()`],
  ['06-festsaal-day', 'Festsaal, 10:30', `skb.set('hour', 10.5); skb.goto('KB-B01/B01.2.og-festsaal'); skb.step(60)`],
  ['07-festsaal-night', 'Festsaal, 22:00', `skb.set('hour', 22); skb.goto('KB-B01/B01.2.og-festsaal'); skb.step(60)`],
  ['08-golden-hour-aerial', 'Übersicht West, 19:12', `skb.set('hour', 19.2); skb.goto('view-west'); skb.step(60)`],
  ['09-golden-hour-ehrenhof', 'Ehrenhof, 19:12', `skb.set('hour', 19.2); skb.goto('view-ehrenhof'); skb.step(60)`],
  ['10-dusk-exterior', 'Ehrenhof, 21:00', `skb.set('hour', 21.0); skb.goto('view-ehrenhof'); skb.step(60)`],
  ['11-low-flight-forest', 'Tiefflug über den W-Wald, 10:30', `skb.set('hour', 10.5); (() => { const x = G.x - 420, z = G.z + 160; pose(x, gr(x, z) + 35, z, G.x, 350, G.z); })()`],
  // Added by skb-improve (not in the audit). Append new poses with the next number; never renumber or change one,
  // or before/after pairs stop matching.
  ['12-karlslust', 'Karlslust Talblick, 10:30', `skb.set('hour', 10.5); skb.goto('view-karlslust'); skb.step(60)`],
  ['13-galerie-garden', 'Galerie + Ostende von SO, 60 m über Grund, 17:30', `skb.set('hour', 17.5); (() => { const c = skb.entries.get('KB-B06').centre; const x = c.x + 110, z = c.z + 90; pose(x, gr(x, z) + 60, z, c.x, c.y + 4, c.z); })()`],
  ['14-ehrenhof-hero', 'Ehrenhof Augenhöhe, 17:30 (Heldenstunde)', `skb.set('hour', 17.5); skb.goto('view-ehrenhof'); skb.step(60)`],
  // Pose 04's camera at the garden front's hero hour (07:00, sun 25° from 85°, visual-audit §2 sun table).
  ['15-garden-hero', 'Gartenseite CdL, Augenhöhe 95 m E, 07:00 (Morgen)', `skb.set('hour', 7.0); (() => { const x = G.x + 95, z = G.z - 14; pose(x, gr(x, z) + 1.65, z, G.x, 351, G.z, 'walk'); })()`],
  // Wave-2 review (garden): the Petri view across the lawn, basin jet in the middle ground, clump HG-10 framing the
  // right, the garden front behind. Palace grid eye u 150 / v +25 at 1.7 m, target u 60 / v +18 (local x/z below).
  ['16-garden-basin', 'Herzogsgarten: Blick über das Bassin zur Gartenfront, Augenhöhe, 10:30', `skb.set('hour', 10.5); (() => { const x = 1369.8, z = -1169.4; pose(x, gr(x, z) + 1.7, z, 1282.2, 349.8, -1147.7, 'walk'); })()`],
  ['17-garden-basin-hero', 'Herzogsgarten: Blick über das Bassin zur Gartenfront, Augenhöhe, 07:00 (Morgen)', `skb.set('hour', 7.0); (() => { const x = 1369.8, z = -1169.4; pose(x, gr(x, z) + 1.7, z, 1282.2, 349.8, -1147.7, 'walk'); })()`],
  // KB-I24/I25 (research/10): the gallery's garden end and the moved halls. Pose 18 stands 26 m E of the rotunda on
  // the portico axis (palace grid +u = local (0.986, -0.165)), 8 m to the N (+v = local (-0.165, -0.986)), morning sun.
  ['18-tempelzimmer-garden', 'Tempelzimmer / Rotunde vom Garten, Augenhöhe, 08:00', `skb.set('hour', 8.0); (() => { const c = skb.entries.get('KB-B07').centre; const x = c.x + 0.986 * 26 - 0.165 * 8, z = c.z - 0.165 * 26 - 0.986 * 8; pose(x, gr(x, z) + 1.7, z, c.x, gr(c.x, c.z) + 4, c.z, 'walk'); })()`],
  ['19-tempelzimmer-inside', 'Tempelzimmer innen, 08:00', `skb.set('hour', 8.0); skb.goto('KB-B07/B07.1.tempelzimmer'); skb.step(60)`],
  ['20-speisesaal-b05', 'Großer Speisesaal (Küchenbau OG), 10:30', `skb.set('hour', 10.5); skb.goto('KB-B05/B05.2.og-speisesaal'); skb.step(60)`],
  ['21-hofbibliothek-b04', 'Hofbibliothek (Sammlungsflügel EG), 10:30', `skb.set('hour', 10.5); skb.goto('KB-B04/B04.1.eg-bibliothek'); skb.step(60)`],
  ['22-bildersaal-b03', 'Großer Bildersaal (Nordflügel OG), 10:30', `skb.set('hour', 10.5); skb.goto('KB-B03/B03.2.og-grosser-bildersaal'); skb.step(60)`],
  ['23-tanzsaal-b03', 'Tanzsaal (Nordflügel OG), 10:30', `skb.set('hour', 10.5); skb.goto('KB-B03/B03.2.og-tanzsaal'); skb.step(60)`],
  ['24-naturalien-b04', 'Naturalienkabinett (Sammlungsflügel OG), 10:30', `skb.set('hour', 10.5); skb.goto('KB-B04/B04.2.og-naturalienkabinett'); skb.step(60)`],
  // Fix wave 4 (KB-I25 review): the Speisesaal's S end wall with both O4 stove niches, eye 9.5 m in front of it on
  // the hall axis (B05 s = -12.75, t = 0), looking S at the wall centre (s = -22.25).
  ['25-speisesaal-ofennischen', 'Großer Speisesaal: Südwand mit den zwei Ofennischen, 10:30', `skb.set('hour', 10.5); skb.pose(1244.59, 353.05, -1174.62, 1246.15, 352.9, -1165.25, 'walk'); skb.step(60)`],
  // KB-I43 (night): the Ehrenhof and the court fronts from the W mouth, 30 m above the ground, at 22:00 (sun −13.7°):
  // seeded lit windows and the portal lanterns (hypothesis). Eye 120 m W of the palace anchor G on the court axis.
  ['26-night-exterior', 'Ehrenhof von W, 30 m über Grund, 22:00 (Nacht)', `skb.set('hour', 22); (() => { const x = G.x - 120, z = G.z + 8; pose(x, gr(x, z) + 30, z, G.x + 30, 350, G.z - 4); })()`],
  // KB-I26/I27 (state-room finishes): yellow silk in gilt Tapetenleisten, the green-damask Bildergalerie (20 chandeliers,
  // 104 curule chairs, room POI camera) and the duke's crimson Antichambre; 27 and 29 have no room POI, so their eye
  // stands 0.9 m inside one wall on the room's long axis (B01 t / B03 s), looking across to the opposite wall.
  ['27-gelber-salon', 'Gelber Salon (Corps de Logis EG), 10:30', `skb.set('hour', 10.5); skb.pose(1270.76, 347.85, -1120.92, 1261.98, 348.1, -1119.45, 'walk'); skb.step(60)`],
  ['28-bildergalerie-b06', 'Bildergalerie (Galeriebau), 10:30', `skb.set('hour', 10.5); skb.goto('KB-B06/B06.1.bildergalerie'); skb.step(60)`],
  ['29-rotes-vorzimmer-b03', 'Antichambre des Herzogs (Rotes Vorzimmer, Nordflügel OG), 10:30', `skb.set('hour', 10.5); skb.pose(1247.56, 353.05, -1149.25, 1239.28, 353.3, -1147.87, 'walk'); skb.step(60)`],
  // KB-I63 (garden detail, wave-5 review fix): the garden implementer's views, reproducible. TF-08 parterre à l'angloise
  // with its treillage at eye level, TF-15 with the citrus tubs from 9 m, the kitchen garden KG-01 with the lean-to
  // glasshouses from 12 m over the W wall, the Flora herm and a bench at eye level, and the Rundpavillon KB-B87 with
  // its stepped dome, entrance steps, spur walk and planting from the belt walk.
  ['30-tf08-parterre-eye', 'Parterre TF-08 mit Treillage, Augenhöhe, 10:30', `skb.set('hour', 10.5); pose(1265.16, gr(1265.16, -1067.75) + 1.7, -1067.75, 1213.21, gr(1213.21, -1075.28) + 1.2, -1075.28, 'walk')`],
  ['31-tf15-orangerie-9m', 'Orangerieparterre TF-15 mit Kübeln, 9 m über Grund, 10:30', `skb.set('hour', 10.5); pose(1312.4, gr(1312.4, -979.33) + 9, -979.33, 1267.03, gr(1267.03, -971.74), -971.74)`],
  ['32-kitchen-garden-12m', 'Küchengarten mit Treibhäusern, 12 m über Grund, 10:30', `skb.set('hour', 10.5); pose(1149.28, gr(1149.28, -1287.64) + 12, -1287.64, 1221.28, gr(1221.28, -1299.69), -1299.69)`],
  ['33-herm-bench-eye', 'Flora-Herme und Bank, Augenhöhe, 10:30', `skb.set('hour', 10.5); pose(1323.62, gr(1323.62, -1166.75) + 1.7, -1166.75, 1329.5, gr(1329.5, -1180.11) + 1.4, -1180.11, 'walk')`],
  ['34-rundpavillon-eye', 'Rundpavillon KB-B87 vom Gürtelweg, Augenhöhe, 10:30 (Hypothese)', `skb.set('hour', 10.5); pose(1315.6, gr(1315.6, -1102.35) + 1.7, -1102.35, 1304.3, gr(1304.3, -1076.3) + 3.2, -1076.3, 'walk')`],
  // Wave 6 (architecture). 35: KB-I28 the Orangerie court between the side wings, 45 m E of the main range on the court
  // axis (grid az 77.7 = local (0.977, -0.213)), 6 m above ground, white joinery and the shutterless hall tier.
  ['35-orangerie-court', 'Orangeriehof zwischen den Flügeln, 6 m über Grund, 10:30', `skb.set('hour', 10.5); (() => { const c = skb.entries.get('KB-B10').centre; const x = c.x + 0.977 * 45, z = c.z - 0.213 * 45; pose(x, gr(x, z) + 6, z, c.x, c.y + 8, c.z); })()`],
  // 36: KB-I29 the menagerie ring KL-B40 (19 slate-roofed houses round the moat) with the terrace rows KL-B43 behind,
  // from the WSW, 40 m above ground.
  ['36-menagerie', 'Menagerie: Tierhäuser-Rund und Terrassenreihen, 40 m über Grund, 10:30', `skb.set('hour', 10.5); (() => { const x = 1868, z = 160; pose(x, gr(x, z) + 40, z, 1975, gr(1975, 115) + 2, 115); })()`],
  // 37: KB-I28 the Komödienhaus KB-B12a (hypothesis) on the S face of the Orangerie S wing, 35 m S, 8 m above ground.
  ['37-komoedienhaus', 'Komödienhaus am Orangerie-Südflügel von S, 8 m über Grund, 10:30 (Hypothese)', `skb.set('hour', 10.5); (() => { const c = skb.entries.get('KB-B12a').centre; const x = c.x + 0.213 * 35, z = c.z + 0.977 * 35; pose(x, gr(x, z) + 8, z, c.x, c.y + 4, c.z); })()`],
  // 38: wave-6 review fix (KB-I29 / KB-I67) the KL-B43 terrace rows from the lower end of the watercourse, 11 m above ground, looking up the
  // terraces (house fronts, runs, terrace walls, watercourse) with the beech wood round and between the rows.
  ['38-menagerie-terrassen', 'Menagerie-Terrassen im Buchenwald, Wasserlauf von S, 11 m über Grund, 10:30', `skb.set('hour', 10.5); (() => { const x = 2079, z = 255; pose(x, gr(x, z) + 11, z, 2035, gr(2035, 160) + 1, 160); })()`],
  // Wave 7 (garden, 39-41). 39: KB-I37 the Karlsbergweiher from its E bank at eye height, 17:30 (bank, reflections).
  ['39-karlsbergweiher-ufer', 'Karlsbergweiher: Ufer auf Augenhöhe, Spiegelung, 17:30', `skb.set('hour', 17.5); pose(965, gr(965, -865) + 1.7, -865, 850, 276.5, -880)`],
  // 40: KB-I35 the vineyard LP06 30 in 3D (stakes, leaf columns, a contour walk), 2.2 m above the rows.
  ['40-weinberg-nah', 'Weinberg: Rebzeilen an Pfählen, 2 m über Grund, 10:30', `skb.set('hour', 10.5); pose(970, gr(970, -1030) + 2.2, -1030, 952, gr(952, -998) + 0.6, -998)`],
  // 41: KB-I35 the vineyard from 15 m (3D rows near, the painted rows beyond VINEYARD.near, the parcel edge).
  ['41-weinberg-15m', 'Weinberg von oben, 15 m über Grund, 10:30', `skb.set('hour', 10.5); pose(1005, gr(1005, -1060) + 15, -1060, 950, gr(950, -1005), -1005)`],
  // Wave 7 (architecture, 42-45). 42: KB-I31 the S-wing Altan KB-B02a (hypothesis) over the garden Durchfahrt, from the
  // terrace garden TF-08 28 m SSE, 6 m above ground.
  ['42-altan-suedfluegel', 'Altan am Südflügel vom Terrassengarten, 6 m über Grund, 10:30 (Hypothese)', `skb.set('hour', 10.5); (() => { const c = skb.entries.get('KB-B02a').centre; const x = c.x + 0.165 * 28, z = c.z + 0.986 * 28; pose(x, gr(x, z) + 6, z, c.x, c.y + 3, c.z); })()`],
  // 43: KB-I39 the Karlslust staffage zone W/NW of the amphitheatre (Türkisches Zelt KL-B51, Volierenpavillon KL-B53,
  // Heuwagen KL-B52; hypotheses) from the NW, 35 m above ground.
  ['43-karlslust-staffage', 'Karlslust: Zelt, Voliere und Heuwagen (Hypothesen), 35 m über Grund, 10:30', `skb.set('hour', 10.5); (() => { const x = 1815, z = -45; pose(x, gr(x, z) + 35, z, 1885, gr(1885, 55) + 2, 55); })()`],
  // 44: KB-I39 the Chinese pavilion KL-B50 (hypothesis) S of the Schwanenweiher, from the N bank, 12 m above ground.
  ['44-chinesischer-pavillon', 'Chinesischer Pavillon S der Schwanenweiher, 12 m über Grund, 10:30 (Hypothese)', `skb.set('hour', 10.5); (() => { const c = skb.entries.get('KL-B50').centre; const x = c.x - 20, z = c.z - 26; pose(x, gr(x, z) + 12, z, c.x, c.y + 3, c.z); })()`],
  // 45: KB-I30 the Monopteros KB-B89 (hypothesis) at the W end of the Karlsbergweiher, from the E over the pond, 10 m above ground.
  ['45-monopteros', 'Monopteros am Westende des Karlsbergweihers, 10 m über Grund, 10:30 (Hypothese)', `skb.set('hour', 10.5); (() => { const c = skb.entries.get('KB-B89').centre; const x = c.x + 40, z = c.z + 14; pose(x, gr(x, z) + 10, z, c.x, c.y + 2, c.z); })()`],
  // Wave 8 (architecture, 49-51). 49: KB-I52 the foot of the TF-08 retaining wall (S face) and the W portico of the S
  // wing KB-B02 beyond, from the SSW below the terrace, 4 m above ground.
  ['49-tf08-mauerfuss', 'Terrassengarten TF-08: Fuß der Stützmauer und Südflügel-Portikus von SSW, 4 m über Grund, 10:30', `skb.set('hour', 10.5); pose(1190, gr(1190, -1035) + 4, -1035, 1222, 344.5, -1068)`],
  // 50: KB-I32 the Pavillon zu Carlsberg KB-B28 with its E apse KB-B28a (hypothesis) in
  // its forest clearing, from the SE, 20 m above ground (the clearing is tight at eye level).
  ['50-pavillon-carlsberg', 'Pavillon zu Carlsberg mit Ostapsis von SO, 20 m über Grund, 10:30 (Hypothese)', `skb.set('hour', 10.5); (() => { const c = skb.entries.get('KB-B28').centre; const x = c.x + 16, z = c.z + 14; pose(x, gr(x, z) + 20, z, c.x, c.y + 2, c.z); })()`],
  // Wave 8 (look, 52-55). KB-I48 Festbeleuchtung (hypothesis): 52 the night aerial from view-west at 22:00, 53 the
  // Orangerie court (pose 35's camera) at 22:00. Both switch the mode on and leave it on: every later pose must set
  // `skb.set('festival', false)` if it is a night pose.
  ['52-fest-aerial', 'Festbeleuchtung: Übersicht West, 22:00 (Anordnung Hypothese)', `skb.set('festival', true); skb.set('hour', 22); skb.goto('view-west'); skb.step(60)`],
  ['53-fest-orangeriehof', 'Festbeleuchtung: Orangeriehof, 6 m über Grund, 22:00 (Anordnung Hypothese)', `skb.set('festival', true); skb.set('hour', 22); (() => { const c = skb.entries.get('KB-B10').centre; const x = c.x + 0.977 * 45, z = c.z - 0.213 * 45; pose(x, gr(x, z) + 6, z, c.x, c.y + 8, c.z); })()`],
  // Wave 8 (garden, 46-48), last in the list so their state changes touch no other pose; each switches the festival
  // off first. 46: KB-I68 the barrière KB-F2 between the valley-entrance guard houses KB-B63/64 at eye level, 25 m W.
  // 47: KB-I68 the post-and-rail KB-F1 in front of the court-mouth guard houses KB-B37/38 and the sand forecourt KB-V1,
  // eye level from the W field, 17:30. 48: KB-I71 the W end of the Karlsbergweiher (Monopteros KB-B89, Dammweg KB-W5,
  // Felsenpfad KB-W8) with low-confidence buildings translucent (leaves `lowConfidence: 'translucent'` set).
  ['46-barriere-eye', 'Barrière zwischen den Wachhäusern am Taleingang, Augenhöhe, 10:30 (Lage Hypothese)', `skb.set('festival', false); skb.set('lowConfidence', 'show'); skb.set('hour', 10.5); pose(472, gr(472, -897) + 1.7, -897, 497, gr(497, -899) + 1.2, -899, 'walk')`],
  ['47-ehrenhofmuendung-zaun', 'Lattenzaun und Vorplatz an der Ehrenhofmündung, Augenhöhe, 17:30', `skb.set('festival', false); skb.set('lowConfidence', 'show'); skb.set('hour', 17.5); pose(1150, gr(1150, -1104) + 1.7, -1104, 1178, gr(1178, -1113) + 1.6, -1113, 'walk')`],
  ['48-karlsbergweiher-transluzent', 'Karlsbergweiher West: Monopteros und Felsenpfad, Hypothesen transluzent, 40 m über Grund, 10:30', `skb.set('festival', false); skb.set('lowConfidence', 'translucent'); skb.set('hour', 10.5); pose(905, gr(905, -800) + 40, -800, 858, gr(858, -880), -880)`],
];

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? dflt : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);
if (flag('list')) {
  for (const [id, label] of POSES) console.log(`${id}  ${label}`);
  process.exit(0);
}
const outArg = opt('out');
if (!outArg) {
  console.error('usage: shots.mjs --out <dir> [--poses 01,03|all] [--bench] [--url URL] [--eval JS] [--quality 85]');
  process.exit(2);
}
const OUT = resolve(outArg);
const URL_ = opt('url', 'http://localhost:5260/');
const want = opt('poses', 'all');
const poses = want === 'all' ? POSES : POSES.filter(([id]) => want.split(',').some((w) => id.startsWith(w.trim())));
const quality = Number(opt('quality', '85'));
const extraEval = opt('eval');
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const r = await fetch(URL_);
  if (!r.ok) throw new Error(String(r.status));
} catch (e) {
  console.error(`viewer not reachable at ${URL_} (${e.message}). Start it: pnpm run dev (port 5260).`);
  process.exit(1);
}

const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9300 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'skb-shots-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--window-size=1920,1080', '--enable-gpu', '--use-angle=metal',
    '--ignore-gpu-blocklist', 'about:blank',
  ],
  { stdio: 'ignore' },
);
let ws;
let failed = false;
const logs = [];
const cleanup = async () => {
  try { ws?.close(); } catch { /* closed */ }
  const exited = new Promise((r) => chrome.once('exit', r));
  chrome.kill();
  await Promise.race([exited, sleep(5000)]);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp profile, best effort */ }
};
try {
  let targets;
  for (let i = 0; i < 75 && !targets; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); }
  }
  if (!targets) throw new Error(`Chrome did not start (${CHROME}); set CHROME_BIN`);
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning'))
      logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (m.method === 'Runtime.exceptionThrown') { failed = true; logs.push(`EXCEPTION: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`); }
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 120000 });
    if (r.result?.exceptionDetails) throw new Error(`eval failed: ${expression.slice(0, 80)} → ${JSON.stringify(r.result.exceptionDetails).slice(0, 400)}`);
    return r.result?.result?.value;
  };
  const shot = async (path) => {
    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality });
    writeFileSync(path, Buffer.from(r.result.data, 'base64'));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_ });
  let ready = false;
  for (let i = 0; i < 180 && !ready; i++) {
    await sleep(1000);
    try { ready = await ev(`!!window.skb && document.getElementById('status')?.textContent === ''`); } catch { /* navigating */ }
  }
  if (!ready) throw new Error('window.skb not ready after 180 s');
  const info = await ev(`(() => {
    for (const id of ['panel', 'infobox', 'crosshair']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
    const ve = skb.pois.find((p) => p.id === 'view-east'); window.G = { x: ve.lookAt.x, z: ve.lookAt.z };
    window.pose = (x, y, z, lx, ly, lz, mode = 'fly') => { skb.setMode('fly'); skb.camera.position.set(x, y, z);
      skb.controls.lookAt(new skb.camera.position.constructor(lx, ly, lz)); if (mode === 'walk') skb.setMode('walk'); skb.step(40); };
    window.gr = (x, z) => skb.controls.ground(x, z);
    const gl = skb.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info');
    return { gpu: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?', placed: skb.placed };
  })()`);
  console.log(`viewer ready: ${info.placed} placed buildings, GPU ${info.gpu}`);
  if (extraEval) console.log('eval →', JSON.stringify(await ev(extraEval)));
  await ev(`skb.goto('view-west'); skb.step(30)`);
  await sleep(6000); // textures stream in
  const bench = {};
  for (const [pid, label, js] of poses) {
    await ev(js);
    await sleep(1500);
    await ev('skb.step(20)');
    await shot(join(OUT, `${pid}.jpg`));
    let line = `${pid}.jpg  (${label})`;
    if (flag('bench')) {
      const fhd = await ev(`skb.gpuBench(20, [1920, 1080])`);
      const retina = await ev(`skb.gpuBench(20, [3024, 1964])`);
      bench[pid] = { label, fhd, retina, camera: await ev(`skb.camera.position.toArray().map((v) => +v.toFixed(1))`) };
      line += `  1080p ${fhd?.gpuMs?.toFixed(1)} ms · retina ${retina?.gpuMs?.toFixed(1)} ms · ${fhd?.calls} calls · ${(fhd?.triangles / 1e6).toFixed(2)} M tris`;
    }
    console.log(line);
  }
  if (flag('bench')) {
    writeFileSync(join(OUT, 'bench.json'), JSON.stringify({ url: URL_, gpu: info.gpu, date: new Date().toISOString(), poses: bench }, null, 1) + '\n');
    console.log('\n| Pose | 1080p GPU ms | 3024×1964 GPU ms | CPU ms | Calls | Triangles |\n|---|---|---|---|---|---|');
    for (const [pid, b] of Object.entries(bench))
      console.log(`| ${pid} | ${b.fhd?.gpuMs?.toFixed(1)} | ${b.retina?.gpuMs?.toFixed(1)} | ${b.fhd?.cpuMs?.toFixed(1)} | ${b.fhd?.calls} | ${(b.fhd?.triangles / 1e6).toFixed(2)} M |`);
    console.log('(headless GPU timings are noisy: ±50 %; compare only within one run)');
  }
} catch (e) {
  failed = true;
  console.error('ERROR', e.message);
} finally {
  if (logs.length) console.log(`--- console errors/warnings (${logs.length}) ---\n${[...new Set(logs)].slice(-30).join('\n')}`);
  await cleanup();
}
process.exit(failed ? 1 : 0);
