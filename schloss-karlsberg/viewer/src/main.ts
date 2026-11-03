/**
 * Schloss Karlsberg 1789 - standalone viewer (fly + walk). German UI, English code.
 * Loads catalogue v2, the terrain crop (viewer/public/terrain) and builds the site with the exterior/site
 * generators (LOD0 far, LOD1 near, LOD2 + interiors very near). window.skb exposes hooks for automated tests.
 */
import * as THREE from 'three';
import catalogue from '../../model/catalogue.json';
import textureManifest from '../textures.json';
import { loadSite } from '@model/catalogue.ts';
import { isPlaced } from '@model/spec.ts';
import { type BuildContext, type Poi, DEFAULT_BUILD_OPTIONS, makeLayoutFn } from '@model/context.ts';
import type { Building, Confidence } from '@model/spec.ts';
import { E0, N0, gridConvergenceDeg, gridFrame } from '@model/frame.ts';
import { createMaterials } from '@model/materials/index.ts';
import { buildExterior } from '@model/exterior/index.ts';
import { siteBuildings, sitePois } from '@model/site/index.ts';
import { buildFeatures } from '@model/site/features.ts';
import { isDrapedWay } from '@model/site/drive.ts';
import { TerrainMesh, loadTerrain, terrainMaterial } from './terrain.ts';
import { freezeSceneRoot, freezeStatic } from './staticMatrices.ts';
import { Controls, EYE, type Mode, isTyping } from './controls.ts';
import { EXPLORER_DEFAULT_URL, backTarget, headingToYaw, liftAboveGround, parseHandover, pickWalkStart, pitchToRad, poseFromCamera, poseToLocal, walkFallbackYaw } from './handover.ts';
import { KARLSBERG_LAT, KARLSBERG_LON, dayOfYear, sunPosition } from './sun.ts';
import { dateLabelDe, fullMoonEvening, gmst, jdLocal, moonIlluminance, moonLabelDe, moonState } from './ephemeris.ts';
import { NightSky } from './nightSky.ts';
import { cloudAloft, cloudData, cloudMode, cloudsShown } from './clouds.ts';
import { type Look, type UiState, buildUi } from './ui.ts';
import { Forest } from './forest.ts';
import { Vines } from './vines.ts';
import { GrassBlades, type GrassWalk } from './grassBlades.ts';
import { lawnZoneInput } from './lawnZones.ts';
import { siteFeatures } from '@model/site/access.ts';
import { foliageUniforms, tickFoliage, useFoliage } from './foliage.ts';
import { LeafCards, siteCardOptions } from './leafCards.ts';
import { Atmosphere, InteriorLook, type LightState, RENDER_ORDER, installHeightFog, installShadowTaps, useSkyShDiffuse, useTerrainVertexLight } from './atmosphere.ts';
import { addCandleFlames, addMantelCandelabra, addPortalLanterns, addTableCandles, lanternLights, prepareLitWindows, setCandles, setWindowFest, setWindowGlow } from './night.ts';
import { CandleLights, installCandleFalloff } from './candleLight.ts';
import { INDOOR_NIGHT_VISION } from './candleMath.ts';
import { setNightVision } from './grade.ts';
import { Festival } from './festival.ts';
import { festivalOn } from './festivalMath.ts';
import { festivalLamps } from '@model/layout/festival.ts';
import { FarShadow, installFarShadowChunk } from './shadowsFar.ts';
import { farShadowBox } from './shadowsFarMath.ts';
import { nearShadowBias } from './shadowsNearMath.ts';
import { catalogueRooms } from './windowRooms.ts';
import { windowCandleColour, windowGlow } from './nightlights.ts';
import { CANDLE_AMBIENT_LUX, easeEv, kelvinLinear, whiteBalance } from './light.ts';
import { type TourFrame, TourPlayer, captionFor, resolveTour, rundflugSpec, shortName, shotAt, tourAt } from './tour.ts';
import { downloadPng, photoBusy, takePhoto } from './photo.ts';
import { type PhotoOptions, photoFileName } from './photoMath.ts';
import { AdaptiveScale, PHOTO_DPR, QUALITY, type QualityPreset, effectiveDpr, isPreset } from './quality.ts';
import { PostChain } from './post.ts';
import { glassView } from '@model/materials/index.ts';
import { windowTransmittance } from './interiorGrade.ts';
import { RoomMirrors } from './mirrors.ts';
import { mirrorKey } from './mirrorsMath.ts';
import { ReviewClock } from './clock.ts';
import { countsAsIndoor, interiorMode, lightOnStorey, ringDistance, roomLightOn, shellLiftEv } from './indoor.ts';
import { applyInteriorMode } from './interiorView.ts';
import { pointInPolygon } from '@model/layout/geom.ts';

// height fog (KB-I07) replaces three's fog chunks; must run before any material compiles
installHeightFog();
installShadowTaps();
// KB-I50: the sun reads a static far shadow map beyond its near map (shadowsFar.ts); also before any compile
installFarShadowChunk();
// wave 11: candle clusters are sphere lights (candleLight.ts); also before any compile
installCandleFalloff();

const { spec } = loadSite(catalogue);
/** Camera handover from the explorer (?src=explorer&E=…&N=…&h=…&heading=…&pitch=…&mode=…&back=…), or null. */
const handover = parseHandover(location.search);

// ---------------------------------------------------------------- renderer / scene
const app = document.getElementById('app')!;
// preserveDrawingBuffer off (KB-I05): it costs bandwidth on tile GPUs; CDP screenshots and skb.capture() don't need it
// KB-I41: the scene renders into the post chain's half-float 4× MSAA target, so the canvas itself needs no MSAA
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false, logarithmicDepthBuffer: false });
renderer.setSize(innerWidth, innerHeight);
// tone mapping runs once, at the end of the post chain (post.ts): "Dokumentation" = Khronos PBR Neutral (catalogue
// colours 1:1 below the highlight shoulder, KB-I06), "Kino" = AgX + look; materials render untone-mapped HDR
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1;
const post = new PostChain(renderer, QUALITY.hoch.post);
renderer.shadowMap.enabled = true;
// r187 removed PCFSoftShadowMap; PCF softness comes from shadow.radius (KB-I04)
renderer.shadowMap.type = THREE.PCFShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.3, 12000);

const sun = new THREE.DirectionalLight('#ffffff', 1);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
// KB-I99: the depth bias is set in metres per fitted frustum (shadowsNearMath.ts; was −0.0004 ≈ 1.16 m)
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
sun.shadow.radius = 3;
// shadow caching (KB-I04): every caster is static, so the map is redrawn only when the sun, the fitted frustum,
// the casters (display toggles, LOD switches) or the map size change
sun.shadow.autoUpdate = false;
sun.shadow.needsUpdate = true;
scene.add(sun, sun.target);
// KB-I50: static far shadow map over the whole residence, a second (lightless) directional light added after the sun,
// so it is directional shadow 1 (shadowsFar.ts); redrawn only when the sun or the casters change
const farShadow = new FarShadow();
let farShadowOn = true;
scene.add(farShadow.light, farShadow.light.target);

const atmosphere = new Atmosphere(renderer, scene, sun);
post.sky = atmosphere.sky; // KB-I65: shaded at reduced resolution as the scene's background (post.ts)
const interiorLook = new InteriorLook();
// KB-I75: real reflections in the pier glasses and trumeaux of the visitor's room (one static cube per room)
const mirrors = new RoomMirrors(renderer, scene);
/** KB-I75 window pull A/B switch (`skb.windowPull.enabled = false`). */
const windowPull = { enabled: true };
/** KB-I43: candle light of a lit window as the night-adapted eye outside sees it (amber, 1850 K). */
const WINDOW_RGB = windowCandleColour(kelvinLinear, whiteBalance);

const state: UiState & { doy: number } = {
  // hero hour (KB-I08): the Ehrenhof front faces west, raking sun at 17:30 (22° from 278°)
  hour: 17.5,
  doy: dayOfYear(1789, 7, 15),
  shadows: true,
  confidenceColours: false,
  lowConfidence: 'show',
  roofs: true,
  interiors: true,
  epoch: '1789',
  quality: 'hoch',
  autoScale: true,
  look: 'doku',
  haze: true,
  fest: false,
  festival: false,
  fullMoon: false,
  // wave-10 review fix: the cumulus only from the air by default (clouds.ts CloudMode)
  clouds: 'air',
};
/** Wave-10 review fix: the camera is aloft (clouds.ts cloudAloft), and the Rundflug shot's own wish (null = no tour). */
let cloudsAloft = false;
let tourClouds: boolean | null = null;
/** Wave 10 (night sky): the documented date and the full-moon night nearest it (6 Jul 1789, ephemeris.ts). */
const BASE_DATE = { year: 1789, month: 7, day: 15 };
const FULL_MOON_DATE = fullMoonEvening(BASE_DATE, KARLSBERG_LON);
const skyDate = () => (state.fullMoon ? FULL_MOON_DATE : BASE_DATE);
/** Stars and the moon disc (night only; the moonlight is the sun's light turned to the moon, atmosphere.ts). */
const nightSky = new NightSky();
scene.add(nightSky.group);
/** Wave 11: the candles of the visitor's room light it after dusk (candleLight.ts; hidden by day and outdoors). */
const candles = new CandleLights();
scene.add(candles.group);
let candlesOn = false;
let candleAmbient = 0;
/** KB-I48 Festbeleuchtung (built after the buildings; off by default, night only). */
let festival: Festival | null = null;

/** Adapted exposure (EV100) that eases toward the target of the current place (outside / inside a room). */
let adaptEv = NaN;
/** Camera inside a building footprint (exposure and candle ambient follow it). */
let inside = false;
let snapExposure = true;
let shadowDirty = true;

function updateSun(): void {
  const d = skyDate();
  state.doy = dayOfYear(d.year, d.month, d.day);
  atmosphere.clouds = cloudsShown(state.clouds, tourClouds ?? cloudsAloft);
  const { elevation, azimuth } = sunPosition(state.doy, state.hour);
  // azimuth is from TRUE north; local −z is GRID north: grid az = true az − convergence
  const gamma = gridConvergenceDeg(382226, 5466120);
  atmosphere.hour = state.hour;
  // wave 10: the moon of that night (Meeus); its light takes over the directional light after sunset
  const jd = jdLocal(d.year, d.month, d.day, state.hour, KARLSBERG_LON);
  const moon = moonState(jd, KARLSBERG_LAT, KARLSBERG_LON);
  const maz = ((moon.az - gamma) * Math.PI) / 180;
  const mel = (moon.alt * Math.PI) / 180;
  const moonDir = new THREE.Vector3(Math.sin(maz) * Math.cos(mel), Math.sin(mel), -Math.cos(maz) * Math.cos(mel));
  const ls = atmosphere.update(elevation, azimuth - gamma, { dir: [moonDir.x, moonDir.y, moonDir.z], lux: moonIlluminance(moon) });
  const sunLocal = ls.dir;
  const mc = sun.color;
  const ml = Math.max(1e-6, 0.2126 * mc.r + 0.7152 * mc.g + 0.0722 * mc.b);
  nightSky.update({ jd, lst: gmst(jd) + KARLSBERG_LON, lat: KARLSBERG_LAT, gamma, night: ls.night, pre: ls.pre, moon, moonDir, sunDir: sunLocal, colour: ls.moonLux > 0 ? [mc.r / ml, mc.g / ml, mc.b / ml] : [1, 0.96, 0.9] });
  // KB-I48: the Festbeleuchtung is a celebration: the chandeliers burn too
  interiorLook.fest = state.fest || state.festival;
  updateCandles(true);
  interiorLook.update(roomLevel(ls), ls.pre, ls.night);
  setWindowGlow(inside ? 0 : windowGlow(ls.elevation), ls.pre, WINDOW_RGB);
  // wave-5 review fix: candles burn at night, the chandeliers only for a celebration (night.ts, nightlights.ts)
  setCandles(ls.night, state.fest || state.festival);
  const festOn = festivalOn(state.festival, ls.elevation);
  festival?.update(festOn, ls.pre);
  setWindowFest(festOn);
  updateInteriorBudget(); // KB-I65: room lights follow their new intensity (zero-intensity lights are not drawn)
  post.night = ls.night;
  post.pre = ls.pre;
  post.sunDir.copy(ls.dir);
  snapExposure = true;
  shadowDirty = true;
  // KB-I50: the far light shares the sun's visibility (one program variant by day, one by night)
  farShadow.light.visible = sun.visible && farShadowOn;
  if (sun.userData.dir) farShadow.setSun(sun.userData.dir as THREE.Vector3);
}

function applyLook(): void {
  post.look = state.look;
  // the white balance adapts less in the 'kino' look (warmer low sun, bluer dusk)
  if (atmosphere.look !== state.look) {
    atmosphere.look = state.look;
    if (atmosphere.state) updateSun();
  }
}

// ---------------------------------------------------------------- world
const materials = createMaterials({ textureBase: './textures/', sets: textureManifest.sets as unknown as { name: string; real_size_m: [number, number] }[], anisotropy: renderer.capabilities.getMaxAnisotropy() });
const status = document.getElementById('status')!;
status.textContent = 'Lade Gelände …';
const terrain = await loadTerrain('./terrain/');
/**
 * Courts drawn as light court sand (#C9B48E, raked) instead of Buntsandstein grit: the Ehrenhof TF-01 [I; D Le Clerc
 * 1790 shows a bare light forecourt; look-and-period.md §6, research/11 S15; wave-1 review]. Paths and drives keep the
 * grit.
 */
function sandCourtRings(): [number, number][][] {
  const out: [number, number][][] = [];
  for (const f of spec.terrain_features) {
    const g = f.geometry as { type?: string; coordinates?: number[][][] } | undefined;
    if (f.id !== 'TF-01' || g?.type !== 'Polygon' || !g.coordinates?.[0]) continue;
    out.push(g.coordinates[0].map(([E, N]) => [E - E0, -(N - N0)] as [number, number]));
  }
  return out;
}
const gridU = gridFrame(spec.palace_grid).uDir; // field strips and kitchen-garden beds follow the palace grid
// vineyard outlines of the 1789 land cover: the bake draws the staked-out edge exactly where the raster has the class
// (wave-3 review fix)
const vineyards = (spec.landcover ?? []).filter((a) => a.cover === 'vineyard').map((a) => a.geometry.coordinates[0].map(([E, N]) => [E - E0, -(N - N0)] as [number, number]));
// wave 10 (garden, audit #1): Petri's lawn is close-mown only near the house and along the walks (lawnZones.ts)
const lawnZones = lawnZoneInput(siteFeatures(spec, DEFAULT_BUILD_OPTIONS.year)) ?? undefined;
const tmat = terrainMaterial(terrain, { textureBase: './textures/', sandCourts: sandCourtRings(), gridU: [gridU[0], -gridU[1]], renderer, vineyards, lawnZones });
// terrain and vegetation take their diffuse sky light from the SH probe, not the PMREM (wave-1 review: fill rate); the
// terrain evaluates its smooth light terms per vertex and is drawn after the other opaque objects (KB-I59)
useTerrainVertexLight(tmat);
const terrainMesh = new TerrainMesh(terrain, tmat, RENDER_ORDER.terrain, true);
scene.add(terrainMesh.group);

const ctxBase = {
  spec,
  materials,
  terrain: terrain.sample,
  options: { ...DEFAULT_BUILD_OPTIONS },
  layout: makeLayoutFn(spec, { roofVariant: DEFAULT_BUILD_OPTIONS.roofVariant }),
};
const ctx = (lod: 0 | 1 | 2): BuildContext => ({ ...ctxBase, lod });

interface BuildingEntry {
  b: Building;
  lod: THREE.LOD;
  levels: (THREE.Group | null)[];
  centre: THREE.Vector3;
  radius: number;
  /** footprint as local [x, z] and the height band of the building (for the inside/outside exposure) */
  ring: [number, number][] | null;
  bottom: number;
  top: number;
}
const buildingsRoot = new THREE.Group();
buildingsRoot.name = 'buildings';
scene.add(buildingsRoot);
const entries = new Map<string, BuildingEntry>();
const LOD1_DIST = 650;
const LOD2_DIST = 140;

status.textContent = 'Erzeuge Gebäude …';
const t0 = performance.now();
for (const b of siteBuildings(spec, ctxBase)) {
  try {
    const g0 = buildExterior(b, ctx(0));
    const g1 = buildExterior(b, ctx(1));
    const lod = new THREE.LOD();
    lod.name = `${b.id}/lod`;
    lod.userData = { buildingId: b.id, confidence: b.confidence };
    // the LOD object carries the building transform; levels sit at identity
    // LOD distances are 3D: lift the LOD origin to the building's base height, children compensate
    const baseY = ctxBase.layout(b).stack.base_h;
    lod.position.set(g0.position.x, baseY, g0.position.z);
    lod.rotation.copy(g0.rotation);
    for (const g of [g0, g1]) {
      g.position.set(0, -baseY, 0);
      g.rotation.set(0, 0, 0);
    }
    lod.addLevel(g1, 0);
    lod.addLevel(g0, LOD1_DIST);
    // night: seeded lit windows (wave-1 review; KB-I43 window part)
    for (const g of [g0, g1]) prepareLitWindows(g, b.id, b.cls);
    buildingsRoot.add(lod);
    const L = ctxBase.layout(b);
    const ring = b.footprint ? b.footprint.map(([E, N]) => [E - E0, -(N - N0)] as [number, number]) : null;
    const top = b.roof.ridge_h ?? (b.roof.eaves_h !== undefined ? b.roof.eaves_h + 6 : L.stack.base_h + 15);
    entries.set(b.id, { b, lod, levels: [g0, g1, null], centre: new THREE.Vector3(lod.position.x, L.stack.base_h, lod.position.z), radius: Math.hypot(L.frame.length, L.frame.width) / 2, ring, bottom: L.stack.base_h - 3, top });
  } catch (e) {
    console.warn(`[viewer] ${b.id}`, e);
  }
}
const features = buildFeatures(spec, ctx(1));
scene.add(features.group);
// forest of the terrain epoch (KB-I09 1789 land cover / today's canopy), tiled with near/far levels (KB-I10)
const cdl = entries.get('KB-B01')?.centre;
// KB-I44 hinterland: hedgerows on the land-cover parcel edges, fruit-tree meadows at farmsteads and the hamlet
const farmsteads = [...entries.values()]
  .filter((e) => (e.b.cls === 'FARM' || e.b.cls === 'FARM_GROUP') && /farm|cense|sheep|bergerie|village|hameau|barn/i.test(String((e.b as { function?: string }).function ?? '')))
  .map((e) => ({ id: e.b.id, x: e.centre.x, z: e.centre.z }));
const forestLod = new Forest(terrain, {
  gridU: [gridU[0], -gridU[1]],
  centre: cdl ? [cdl.x, cdl.z] : undefined,
  parcels: (spec as unknown as { landcover?: import('./hinterland.ts').LandcoverParcel[] }).landcover ?? [],
  farms: farmsteads,
});
const forest = forestLod.group;
scene.add(forest);
for (const root of [forest, features.group]) {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!m || Array.isArray(m) || !m.isMeshStandardMaterial) return;
    if (m.name === 'vegetation.leaf') {
      useSkyShDiffuse(m, { leaf: true });
      useFoliage(m); // KB-I44: crown occlusion, wrap and back-light, leaf clusters, wind
    } else if (m.name === 'vegetation.bark') useSkyShDiffuse(m);
    // KB-I23 court lanes (materials/cobbles.ts): lit like the terrain they lie in (SH sky diffuse, no PMREM)
    else if (m.userData.groundLit) useSkyShDiffuse(m);
  });
}
// KB-I44 review: exterior vegetation is culled while the camera is inside a building (the windows are over-exposed
// for the indoor EV); the forest does this itself (`forestLod.indoor`), the site trees are listed here
const siteVegetation: THREE.Object3D[] = [];
features.group.traverse((o) => {
  if ((o as THREE.InstancedMesh).isInstancedMesh && o.userData.part === 'vegetation') siteVegetation.push(o);
});
let vegetationIndoor = false;
// wave 6 (tree look near the camera): camera-facing leaf-cluster cards on the crowns within 90 m (leafCards.ts)
const leafCards = new LeafCards((m) => {
  useSkyShDiffuse(m, { leaf: true });
  useFoliage(m);
});
features.group.updateMatrixWorld(true);
features.group.traverse((o) => {
  const im = o as THREE.InstancedMesh;
  if (!im.isInstancedMesh || o.userData.part !== 'vegetation') return;
  const co = siteCardOptions(im);
  if (co) leafCards.registerStatic(im, co);
});
leafCards.attachForest(forestLod);
scene.add(leafCards.group);
// KB-I35 (wave 7): the vineyard's plants in 3D within VINEYARD.near m of the camera, on the painted rows (vines.ts)
const vineU = tmat.userData.uniforms as { uVineAcross: { value: THREE.Vector2 }; uVinePlants: { value: number } };
const vines = new Vines(
  terrain,
  vineyards,
  [vineU.uVineAcross.value.x, vineU.uVineAcross.value.y],
  (m) => {
    useSkyShDiffuse(m, { leaf: true });
    useFoliage(m);
  },
  vineU.uVinePlants,
);
scene.add(vines.group);
// wave 9 (garden, audit #1): short grass-blade cards on the lawn and meadows within ~22 m of the camera (grassBlades.ts);
// they keep off the draped walks (features.ts walkMesh: walks ≤ 4 m, the forecourt strip and the drive, isDrapedWay)
const grassWalks: GrassWalk[] = siteFeatures(spec, ctxBase.options.year)
  .filter((f) => isDrapedWay(f) && (f.placement !== 'hypothetical' || ctxBase.options.showHypothetical))
  .map((f) => ({ line: (f.geometry.coordinates as [number, number][]).map(([E, N]) => [E - E0, -(N - N0)] as [number, number]), width: f.width! }));
const grass = new GrassBlades(terrain, {
  land: tmat.userData.uniforms,
  walks: grassWalks,
  // the ground's own per-vertex light (sun, sky SH and its grazing sheen), so the blades are lit like the turf they stand in
  patch: (m) => useTerrainVertexLight(m),
});
scene.add(grass.mesh);
console.info(`[viewer] ${entries.size} buildings built in ${(performance.now() - t0).toFixed(0)} ms`);
// wave-4 review (CPU): everything built so far is static; compose its matrices once (staticMatrices.ts)
// KB-I43: lanterns at the Ehrenhof portals (night only, hypothesis; night.ts)
const nightRoot = new THREE.Group();
nightRoot.name = 'night';
scene.add(nightRoot);
addPortalLanterns(nightRoot, [...entries.values()].map((e) => ctxBase.layout(e.b)), sandCourtRings(), pointInPolygon);
// KB-I48: Festbeleuchtung lamps (pure placement in model/src/layout/festival.ts; 4 draw calls, night + toggle only)
festival = new Festival(festivalLamps(spec, [...entries.values()].map((e) => ctxBase.layout(e.b)), { year: ctxBase.options.year }));
nightRoot.add(festival.group);
// KB-I50: the far map covers the placed buildings (palace to Karlslust) plus a margin for the trees around them
{
  const box = farShadowBox([...entries.values()].map((e) => [e.centre.x, e.centre.z] as const));
  const g = terrain.sample(box.cx, box.cz);
  farShadow.setBox(box, Number.isFinite(g) ? g : 345);
}
// KB-I41/I43: the lanterns light reveals and gravel through the post chain (screen-space, night only)
post.setLamps([...lanternLights()]);
post.lampColour.setRGB(WINDOW_RGB[0], WINDOW_RGB[1], WINDOW_RGB[2], THREE.LinearSRGBColorSpace);
/** The post chain's lamps are the portal lanterns outside; indoors the candles are point lights (wave 11, candleLight.ts). */
let lampsIndoor = false;
function syncLamps(): void {
  lampsIndoor = inside;
  post.setLamps(inside ? [] : [...lanternLights()]);
}

/**
 * Wave 11: room ambient for the interior look. Outdoors the daylight share only; indoors the candle share follows the
 * candles of the visitor's room (candleLight.ts: bounce + far clusters) instead of the fixed CANDLE_AMBIENT_LUX.
 */
function roomLevel(ls: LightState): number {
  if (!inside) return ls.room;
  if (!candles.room) return ls.roomCandles;
  return ls.room + (ls.roomCandles - ls.room) * (candles.ambientLux / CANDLE_AMBIENT_LUX);
}
const candleDir = new THREE.Vector3();
/** Wave 11: place the candle pool for the eye; switch the rooms' own lights and the room ambient when it changes. */
function updateCandles(inSun = false): void {
  const ls = atmosphere.state;
  if (!ls) return;
  // wave-11 review fix: the view direction picks the cluster that casts the candle shadow (candleMath.shadowClusterIndex)
  const on = candles.update({ eye: camera.position, dir: camera.getWorldDirection(candleDir), night: ls.night, fest: state.fest || state.festival, pre: ls.pre, colour: interiorLook.candleColour, inside: inside && state.interiors }, CANDLE_AMBIENT_LUX);
  // the eye adapted to the candles keeps their colour (candleMath.INDOOR_NIGHT_VISION); outdoors the full night grade
  setNightVision(ls.night * atmosphere.nightVision * (inside ? INDOOR_NIGHT_VISION : 1), ls.pre);
  const ambientChanged = Math.abs(candles.ambientLux - candleAmbient) > 0.002 * Math.max(candleAmbient, CANDLE_AMBIENT_LUX);
  candleAmbient = candles.ambientLux;
  if (on !== candlesOn) {
    candlesOn = on;
    if (!inSun) updateInteriorBudget();
  }
  if (ambientChanged && !inSun) interiorLook.update(roomLevel(ls), ls.pre, ls.night);
}
for (const root of [buildingsRoot, features.group, forest, terrainMesh.group, nightRoot]) freezeStatic(root);
freezeSceneRoot(scene);

/**
 * Interior budget: interiors are drawn only within INTERIOR_DIST of the camera (you cannot see into rooms from
 * further away), and point lights burn only in the nearest interior. Interior shadow flags are set by the model.
 */
const INTERIOR_DIST = 45;
/** Storey index of every catalogue room (KB-I42 shell mode: ground-level rooms). */
const roomStorey = new Map<string, number>(spec.buildings.flatMap((b) => (b.rooms ?? []).map((r) => [r.id, r.storey] as [string, number])));
function updateInteriorBudget(): void {
  const p = camera.position;
  let nearest: BuildingEntry | null = null;
  let nd = Infinity;
  for (const e of entries.values()) {
    const g2 = e.levels[2];
    if (!g2) continue;
    const d = Math.hypot(p.x - e.centre.x, p.z - e.centre.z) - e.radius;
    const inner = g2.getObjectByName(`${e.b.id}/interior`);
    if (!inner) continue;
    // shadow flags (only ceilings, cornices and room walls cast) come from the model: interiorShadows()
    // KB-I42 / KB-I65: from outside the windows show mapped rooms; the full interior is drawn around a visitor inside,
    // only the ground-level room shells (open portals) from outside (indoor.ts interiorMode)
    const fd = e.ring ? ringDistance(p.x, p.z, e.ring) : Math.max(0, d);
    const mode = state.interiors && d < INTERIOR_DIST ? interiorMode(inside, fd) : 'off';
    // KB-I64: the interior ceilings shade the floors from the sun (the exterior's single-sided roofs drop out of the
    // shadow pass); a map drawn before they showed lit a room floor in full sun (pose 21, 1 of 8 runs)
    if (applyInteriorMode(inner, mode, (id) => roomStorey.get(id))) shadowDirty = true;
    if (mode === 'full' && d < nd) {
      nd = d;
      nearest = e;
    }
  }
  for (const e of entries.values()) {
    const inner = e.levels[2]?.getObjectByName(`${e.b.id}/interior`);
    if (!inner) continue;
    // room lights only while the visitor is inside: point lights cast no shadows, and through the walls they lit the
    // Ehrenhof gravel warm at dusk (wave-1 fix, pose 10)
    // KB-I65: a light at zero intensity (candelabra by day, chandeliers on an ordinary night) is not drawn at all
    const lights = (inner.userData.lights ?? []) as THREE.Light[];
    // wave-10 review fix (07): no light through a floor from another storey (indoor.ts lightOnStorey)
    let storey: number | undefined;
    let near = Infinity;
    const lp = new THREE.Vector3();
    if (e === nearest && inside)
      for (const l of lights) {
        const d = l.getWorldPosition(lp).distanceTo(p);
        if (l.intensity > 0 && d < near) {
          near = d;
          storey = roomStorey.get(l.userData.roomId as string);
        }
      }
    // wave 11: while the candle pool lights the visitor's room, the rooms' own lights stay off (candleLight.ts)
    for (const l of lights) l.visible = !candlesOn && roomLightOn(e === nearest && nd < 20, inside, l.intensity) && lightOnStorey(roomStorey.get(l.userData.roomId as string), storey, l.getWorldPosition(lp).distanceTo(p));
  }
}

/** Lazily build LOD2 (detail + interior) for buildings near the camera. */
function updateLod2(all = false, at?: THREE.Vector3): void {
  const p = at ?? camera.position; // KB-I46: the Rundflug builds ahead of the camera
  let built = false;
  for (const e of entries.values()) {
    const d = Math.hypot(p.x - e.centre.x, p.z - e.centre.z) - e.radius;
    if (d < LOD2_DIST && !e.levels[2] && !built) {
      built = true;
      const g2 = buildExterior(e.b, ctx(2));
      // interiors: warm room environment instead of the sky, lights and candles on the light budget (KB-I06)
      const inner = g2.getObjectByName(`${e.b.id}/interior`);
      if (inner) {
        addMantelCandelabra(inner, e.b.id, interiorLook.candleColour);
        addCandleFlames(inner, e.b.id);
        addTableCandles(inner, e.b.id);
        candles.register(inner);
        interiorLook.adopt(inner);
        mirrors.register(inner);
      }
      // KB-I42 (wave-7 review): the mapped room behind each window is the catalogue room
      prepareLitWindows(g2, e.b.id, e.b.cls, catalogueRooms(e.b, ctxBase.layout(e.b)));
      g2.position.set(0, -e.lod.position.y, 0);
      g2.rotation.set(0, 0, 0);
      freezeStatic(g2); // static like LOD0/1 (wave-4 review, CPU)
      e.levels[2] = g2;
      // rebuild level list: lod2 near, lod1 mid, lod0 far
      const l = e.lod;
      l.levels.length = 0;
      l.children.length = 0;
      for (const [obj, dist] of [
        [g2, 0],
        [e.levels[1]!, LOD2_DIST + e.radius],
        [e.levels[0]!, LOD1_DIST],
      ] as [THREE.Object3D, number][]) {
        obj.parent = null;
        l.addLevel(obj, dist);
      }
      shadowDirty = true;
      applyDisplay();
      if (all) built = false;
    }
  }
}

// ---------------------------------------------------------------- display toggles
const confMat: Record<Confidence, THREE.MeshStandardMaterial> = {
  high: new THREE.MeshStandardMaterial({ color: '#3f9b4f', roughness: 0.8 }),
  med: new THREE.MeshStandardMaterial({ color: '#e0a526', roughness: 0.8 }),
  low: new THREE.MeshStandardMaterial({ color: '#c8452f', roughness: 0.8 }),
};
const translucent = new THREE.MeshStandardMaterial({ color: '#e8dcc0', roughness: 0.9, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });

function applyDisplay(): void {
  for (const e of entries.values()) {
    const conf = e.b.confidence;
    e.lod.visible = !(state.lowConfidence === 'hide' && conf === 'low');
    e.lod.traverse((o) => {
      const ud = o.userData as { part?: string; origMat?: THREE.Material | THREE.Material[]; origCast?: boolean };
      if (o.name.endsWith('/interior')) o.visible = state.interiors;
      if (!(o as THREE.Mesh).isMesh) return;
      const m = o as THREE.Mesh;
      if (!ud.origMat) ud.origMat = m.material;
      // interiors keep the builder's shadow flag as the upper bound (interiorShadows: only room walls and ceilings cast)
      if (ud.origCast === undefined) ud.origCast = ud.part?.startsWith('interior') ? m.castShadow : true;
      if (ud.part === 'roof') m.visible = state.roofs;
      if (state.confidenceColours) m.material = confMat[conf];
      else if (state.lowConfidence === 'translucent' && conf === 'low') m.material = translucent;
      else m.material = ud.origMat;
      m.castShadow = ud.origCast && m.material !== translucent && !(m.material as THREE.Material).transparent;
    });
  }
  // KB-I12: trees of hypothetical site features (e.g. TF-11 Ostachse) follow the low-confidence select
  for (const o of features.group.children) if (o.userData.placement === 'hypothetical') o.visible = state.lowConfidence !== 'hide';
  shadowDirty = true;
  farShadow.invalidate();
  updateInteriorBudget();
}

// ---------------------------------------------------------------- POIs
const pois: Poi[] = sitePois(spec, ctx(1));
const ehrenhof = spec.terrain_features.find((f) => f.id === 'TF-01');
const pg = spec.palace_grid;
const gx = pg.origin_EN[0] - E0;
const gz = -(pg.origin_EN[1] - N0);
const views: Poi[] = [
  { id: 'view-west', name_de: 'Übersicht von Westen (Ehrenhof)', kind: 'view', position: { x: gx - 230, y: 345 + 105, z: gz + 45 }, lookAt: { x: gx + 25, y: 348, z: gz - 5 } },
  { id: 'view-east', name_de: 'Übersicht von Osten (Gartenseite)', kind: 'view', position: { x: gx + 260, y: 348 + 100, z: gz - 70 }, lookAt: { x: gx, y: 350, z: gz } },
  { id: 'view-ehrenhof', name_de: 'Ehrenhof (Augenhöhe)', kind: 'view', position: { x: gx - 28, y: (ehrenhof?.level ?? 344.8) + EYE, z: gz + 6 }, lookAt: { x: gx + 30, y: 352, z: gz } },
  { id: 'view-karlslust', name_de: 'Karlslust (Talblick)', kind: 'view', position: { x: 1700, y: 420, z: -500 }, lookAt: { x: 1800, y: 280, z: -1000 } },
];
pois.unshift(...views);

/**
 * Preferred hour per overview (KB-I08, visual-audit §2 sun table): the court (west) front at 17:30, the garden
 * (east) front at 07:00. Applied when the user picks the view in "Gehe zu", not by the test hook `skb.goto`.
 */
const VIEW_HOURS: Record<string, number> = { 'view-west': 17.5, 'view-ehrenhof': 17.5, 'view-east': 7.0 };

function goto(id: string, applyHour = false): boolean {
  const p = pois.find((x) => x.id === id || x.buildingId === id);
  if (!p) return false;
  endTour();
  if (applyHour && VIEW_HOURS[p.id] !== undefined && state.hour !== VIEW_HOURS[p.id]) {
    state.hour = VIEW_HOURS[p.id];
    ui?.sync();
    updateSun();
  }
  snapExposure = true;
  const walk = p.kind === 'entrance' || p.kind === 'room' || id === 'view-ehrenhof';
  placeCamera(p.position.x, p.position.y, p.position.z, walk);
  if (p.lookAt) controls.lookAt(new THREE.Vector3(p.lookAt.x, p.lookAt.y, p.lookAt.z));
  return true;
}

/**
 * Put the camera at (x, y, z) in fly mode, build the LOD2 detail and the walk colliders there, and only then switch
 * to walk (which drops to the floor below): dropping before the colliders existed put the first visit of an upper-
 * floor room on the terrain under it.
 */
function placeCamera(x: number, y: number, z: number, walk: boolean): void {
  controls.setMode('fly');
  camera.position.set(x, y, z);
  updateLod2(true);
  if (walk) {
    refreshColliders(true, true);
    controls.setMode('walk');
  }
  refreshColliders(true);
  // KB-I64: settle the light state of the new place now (inside/outside, interior visibility, shadow map, animation
  // clocks), not a few frames later, so a capture never depends on how many frames ran before it
  syncInside(true);
  updateInteriorBudget();
  shadowDirty = true;
  post.resetTime();
  foliageUniforms.uFolTime.value = 0;
}

// ---------------------------------------------------------------- controls + walk colliders
const controls = new Controls(camera, renderer.domElement);
controls.ground = terrain.sample;
let colliderCentre = new THREE.Vector3(1e9, 0, 0);
function refreshColliders(force = false, anyMode = false): void {
  if (controls.mode !== 'walk' && !anyMode) return;
  const p = camera.position;
  if (!force && Math.hypot(p.x - colliderCentre.x, p.z - colliderCentre.z) < 60) return;
  colliderCentre = p.clone();
  const meshes: THREE.Mesh[] = terrainMesh.colliderAround(p.x, p.z, 130);
  for (const e of entries.values()) {
    if (Math.hypot(p.x - e.centre.x, p.z - e.centre.z) - e.radius > 130) continue;
    const g = e.levels[2] ?? e.levels[1];
    if (!g) continue;
    e.lod.updateMatrixWorld(true);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const ud = m.userData as { collider?: boolean; material?: string; part?: string };
      const mat = ud.material ?? '';
      // interiors: only their explicit (invisible) colliders - floors, walls with open doorways, stair ramps
      let inInterior = false;
      for (let q: THREE.Object3D | null = m; q && q !== g; q = q.parent) if (q.name.endsWith('/interior')) inInterior = true;
      if (inInterior) {
        if (ud.collider !== true) return;
      } else if (ud.collider === false || ud.part === 'roof' || /glass|wood\.frame|metal\.|wood\.shutter|wood\.door/.test(mat)) return;
      const c = new THREE.Mesh(m.geometry);
      c.matrixAutoUpdate = false;
      c.matrixWorld.copy(m.matrixWorld);
      c.updateWorldMatrix = () => {};
      meshes.push(c);
    });
  }
  for (const m of features.colliders) meshes.push(m);
  controls.setColliders(meshes);
}
controls.onModeChange = (m: Mode) => {
  ui.setMode(m);
  if (m === 'walk') refreshColliders(true);
};

// ---------------------------------------------------------------- picking / info panel
const raycaster = new THREE.Raycaster();
let downAt: [number, number] | null = null;
renderer.domElement.addEventListener('mousedown', (e) => (downAt = [e.clientX, e.clientY]));
renderer.domElement.addEventListener('mouseup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
  const locked = document.pointerLockElement === renderer.domElement;
  const ndc = locked ? new THREE.Vector2(0, 0) : new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(buildingsRoot, true).find((h) => h.object.visible);
  if (!hit) {
    ui.showInfo(null);
    return;
  }
  let o: THREE.Object3D | null = hit.object;
  let roomId: string | undefined;
  let roomName: string | undefined;
  while (o && !o.userData.buildingId) o = o.parent;
  for (let q: THREE.Object3D | null = hit.object; q; q = q.parent) {
    if (q.userData.roomId && !roomId) {
      roomId = q.userData.roomId;
      roomName = q.userData.name_de;
    }
  }
  const id = o?.userData.buildingId as string | undefined;
  const b = id ? spec.buildings.find((x) => x.id === id) : undefined;
  ui.showInfo(b ?? null, roomId ? { id: roomId, name: roomName } : undefined);
});

// ---------------------------------------------------------------- explorer handover (docs/explorer-integration.md)
/** Start at the explorer's pose: fliegen = exact pose (lifted to 1789 ground + 1.5 m), gehen = nearest entrance. */
function startFromHandover(): boolean {
  if (!handover) return false;
  const { pose, mode } = handover;
  const l = poseToLocal(pose);
  if (mode === 'gehen') {
    const p = pickWalkStart(pois, l.x, l.z, 200);
    controls.setMode('fly');
    if (p) camera.position.set(p.position.x, p.position.y, p.position.z);
    else {
      const g = terrain.sample(l.x, l.z);
      camera.position.set(l.x, Number.isFinite(g) ? g + EYE : pose.h, l.z);
    }
    controls.setMode('walk');
    if (p?.lookAt) {
      controls.lookAt(new THREE.Vector3(p.lookAt.x, p.lookAt.y, p.lookAt.z));
      controls.pitch = Math.max(-0.35, Math.min(0.35, controls.pitch));
    } else {
      // no POI in range: face the nearest building centre (else the palace anchor) horizontally, not the map heading
      const centres = [...entries.values()].filter((e) => e.lod.visible).map((e) => e.centre);
      controls.yaw = walkFallbackYaw(camera.position.x, camera.position.z, centres, { x: gx, z: gz }) ?? headingToYaw(pose.heading);
      controls.pitch = 0;
    }
    console.info(`[viewer] handover gehen at ${p ? p.id : 'ground'}`);
  } else {
    controls.setMode('fly');
    camera.position.set(l.x, liftAboveGround(pose.h, terrain.sample(l.x, l.z), 1.5), l.z);
    controls.yaw = headingToYaw(pose.heading);
    controls.pitch = pitchToRad(pose.pitch);
  }
  controls.applyRotation();
  updateLod2(true);
  refreshColliders(true);
  return true;
}

/** Explorer URL for the current pose (validated `back`, else the explorer default). */
function backUrl(): string {
  return backTarget(handover?.back ?? null, poseFromCamera(camera.position, controls.yaw, controls.pitch));
}
function backToMap(): void {
  location.assign(backUrl());
}
addEventListener('keydown', (e) => {
  if (e.code !== 'KeyM' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping()) return;
  e.preventDefault();
  backToMap();
});

// ---------------------------------------------------------------- UI
/** Apply a changed state key (UI and skb.set share this). */
function onStateChange(key: keyof UiState): void {
  if (key === 'hour' || key === 'fest' || key === 'festival' || key === 'fullMoon' || key === 'clouds') updateSun();
  if (key === 'quality' || key === 'autoScale') {
    if (!state.autoScale) adaptive.reset();
    applyQuality();
  }
  if (key === 'look') applyLook();
  if (key === 'haze') atmosphere.setFog(state.haze);
  renderer.shadowMap.enabled = state.shadows;
  if (key === 'epoch') {
    terrain.epoch = state.epoch;
    terrainMesh.rebuild();
    (tmat.userData.refreshGround as () => void)();
    forestLod.rebuild();
    forestLod.update(camera);
    vines.rebuild();
    shadowDirty = true;
  }
  applyDisplay();
}

const ui = buildUi({
  pois,
  state,
  onGoto: (id) => goto(id, true),
  onMode: (m) => controls.setMode(m),
  onChange: onStateChange,
  onBack: backToMap,
  backTitle: handover?.back
    ? 'Zurück zum Explorer – an diese Stelle und Blickrichtung (Taste M)'
    : `Explorer an dieser Stelle öffnen (${new URL(EXPLORER_DEFAULT_URL).host}, Taste M)`,
  attribution: terrain.meta.attribution,
  onTour: () => startTour(),
  onPhoto: () => void savePhoto(),
  skyNote: () => ({ date: dateLabelDe(skyDate()), moon: moonLabelDe(skyDate(), state.hour, KARLSBERG_LAT, KARLSBERG_LON) }),
});
status.textContent = '';


// ---------------------------------------------------------------- shadows (KB-I04)
/** Extent and snapped centre of the last rendered shadow map, and a signature of the LOD levels it saw. */
let shadowExt = 0;
const shadowCentre = new THREE.Vector3(NaN, 0, NaN);
let lodSignature = 0;
let shadowRedraws = 0;

function lodLevels(): number {
  let h = 0;
  for (const e of entries.values()) h = (h * 31 + e.lod.getCurrentLevel() + 1) | 0;
  return h;
}

/**
 * Fit the sun's shadow frustum ahead of the camera and redraw the map only when needed: the centre snaps to an
 * ext/8 grid (small moves don't redraw), the extent changes by > 10 %, or something marked the casters dirty.
 */
function updateShadowFrustum(): void {
  const dir = (sun.userData.dir as THREE.Vector3) ?? new THREE.Vector3(0, 1, 0);
  const walk = controls.mode === 'walk';
  const agl = controls.agl();
  const want = walk ? 60 : Math.min(700, Math.max(120, agl * 2.2));
  const extChanged = !(shadowExt > 0) || Math.abs(want - shadowExt) / shadowExt > 0.1;
  const ext = extChanged ? want : shadowExt;
  // shadow centre: point on the ground ahead of the camera, snapped to a coarse grid
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  fwd.normalize();
  const c = camera.position.clone().addScaledVector(fwd, ext * 0.5);
  const grid = ext / 8;
  c.x = Math.round(c.x / grid) * grid;
  c.z = Math.round(c.z / grid) * grid;
  if (!extChanged && !shadowDirty && c.x === shadowCentre.x && c.z === shadowCentre.z) return;
  const g = terrain.sample(c.x, c.z);
  c.y = Number.isFinite(g) ? g : camera.position.y - agl;
  shadowExt = ext;
  shadowCentre.copy(c);
  shadowDirty = false;
  sun.target.position.copy(c);
  sun.position.copy(c).addScaledVector(dir, 1500);
  const cam = sun.shadow.camera;
  cam.left = -ext;
  cam.right = ext;
  cam.top = ext;
  cam.bottom = -ext;
  cam.near = 100;
  cam.far = 3000;
  cam.updateProjectionMatrix();
  sun.shadow.normalBias = walk ? 0.03 : Math.min(1.0, ext / 300);
  sun.shadow.bias = nearShadowBias(ext, sun.shadow.mapSize.x, cam.near, cam.far);
  sun.shadow.needsUpdate = true;
  shadowRedraws++;
}

/**
 * KB-I50: switch shadow casting of the far forest impostors (forest.ts `forest/<chunk>/impostors`, no casters in the
 * near map) for the one frame the static far map is drawn. Found by name, so an epoch rebuild needs no bookkeeping.
 */
const farCasterList: THREE.Object3D[] = [];
function farCasters(on: boolean): void {
  if (on) {
    farCasterList.length = 0;
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !o.castShadow && o.name.startsWith('forest/') && o.name.endsWith('/impostors')) farCasterList.push(o);
    });
  }
  for (const o of farCasterList) o.castShadow = on;
}

// ---------------------------------------------------------------- exposure (KB-I06)
/** KB-I60: exposure lift (EV) inside a room shell without an interior model (the glazed Tempelzimmer), else 0. */
let shellLift = 0;

/**
 * True when the camera stands inside a building footprint, within its height band, where a room model is drawn
 * (KB-I60: not the glazed Tempelzimmer shell, not an open garden enclosure; indoor.ts). Sets `shellLift`.
 */
function cameraInside(): boolean {
  const p = camera.position;
  shellLift = 0;
  for (const e of entries.values()) {
    if (!e.ring || !e.lod.visible) continue;
    if (Math.hypot(p.x - e.centre.x, p.z - e.centre.z) > e.radius + 2) continue;
    if (p.y < e.bottom || p.y > e.top) continue;
    // rooms are drawn once LOD2 is built (interior group, or the room shell of the exterior builder) and shown
    const rooms = state.interiors && !!e.levels[2];
    const full = countsAsIndoor(e.b, rooms);
    const lift = full ? 0 : shellLiftEv(e.b, rooms);
    if ((!full && lift <= 0) || !pointInPolygon([p.x, p.z], e.ring)) continue;
    if (full) return true;
    shellLift = Math.max(shellLift, lift);
  }
  return false;
}

/** Re-check whether the camera is inside a building (every 4th frame, or now with `force`). */
function syncInside(force = false): void {
  const ls = atmosphere.state;
  if (!ls || !(force || frames % 4 === 0 || snapExposure)) return;
  const now = cameraInside();
  if (now === inside) return;
  inside = now;
  // the candle ambient burns only in the rooms around the visitor (lit windows are KB-I43)
  updateCandles(true);
  interiorLook.update(roomLevel(ls), ls.pre, ls.night);
  // lit windows are seen from outside only
  setWindowGlow(inside ? 0 : windowGlow(ls.elevation), ls.pre, WINDOW_RGB);
  updateInteriorBudget();
}

function updateExposure(dt: number): void {
  const ls = atmosphere.state;
  if (!ls) return;
  syncInside();
  const target = inside ? ls.evIn : ls.evOut - shellLift - ls.kinoEv;
  adaptEv = snapExposure ? target : easeEv(adaptEv, target, dt);
  snapExposure = false;
  // lights are pre-exposed for the outdoor EV; the tone-mapping exposure carries only the adaptation on top
  renderer.toneMappingExposure = Math.pow(2, ls.evOut - adaptEv);
  // KB-I75: window pull, the view through the panes seen from inside a lit room (1 = off outdoors)
  glassView.value = inside && windowPull.enabled ? windowTransmittance(ls.evOut - adaptEv) : 1;
}

// ---------------------------------------------------------------- render scale (KB-I05)
const adaptive = new AdaptiveScale();
let photoMode = false;
let benchActive = false;

function applyQuality(): void {
  const q = QUALITY[state.quality];
  post.settings = { ...q.post };
  const dpr = photoMode ? Math.min(devicePixelRatio, PHOTO_DPR) : effectiveDpr(devicePixelRatio, q.dprCap, state.autoScale ? adaptive.scale : 1);
  if (renderer.getPixelRatio() !== dpr) {
    renderer.setPixelRatio(dpr);
    renderer.setSize(innerWidth, innerHeight);
  }
  if (sun.shadow.mapSize.x !== q.shadowMapSize) {
    sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    shadowDirty = true;
  }
  farShadow.setMapSize(q.shadowMapSize);
}

/** Asynchronous GPU timer for the adaptive scale (EXT_disjoint_timer_query_webgl2; absent → no adaptation). */
const gl2 = renderer.getContext() as WebGL2RenderingContext;
const timerExt = gl2.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
const pendingQueries: WebGLQuery[] = [];
function pollGpuTimer(): void {
  if (!timerExt) return;
  while (pendingQueries.length && gl2.getQueryParameter(pendingQueries[0], gl2.QUERY_RESULT_AVAILABLE)) {
    const q = pendingQueries.shift()!;
    const disjoint = gl2.getParameter(timerExt.GPU_DISJOINT_EXT);
    const ms = gl2.getQueryParameter(q, gl2.QUERY_RESULT) / 1e6;
    gl2.deleteQuery(q);
    if (disjoint || !state.autoScale || photoMode) continue;
    const before = adaptive.scale;
    if (adaptive.update(ms) !== before) applyQuality();
  }
}

// ---------------------------------------------------------------- Rundflug (KB-I46) and photo mode (KB-I47)
const tour = resolveTour(rundflugSpec(Object.fromEntries([...entries].map(([id, e]) => [id, { x: e.centre.x, y: e.centre.y, z: e.centre.z }]))), terrain.sample);
const tourPlayer = new TourPlayer(tour);
/** The user's hour and look while a tour (or an `skb.tour` capture) runs, restored afterwards. */
let tourSaved: { hour: number; look: Look } | null = null;
/** Where the Rundflug will be in 2.5 s: LOD2 detail is built there before the camera arrives. */
let tourProbe: THREE.Vector3 | null = null;
let photoPaused = false;

function captionInfo(id: string): { name: string; confidence?: string } | undefined {
  const b = spec.buildings.find((x) => x.id === id);
  if (b) return { name: shortName(b.name_de), confidence: b.confidence };
  const f = spec.terrain_features.find((x) => x.id === id);
  return f ? { name: shortName(f.name), confidence: f.confidence } : undefined;
}

/** Enter the tour look (Kino, hour of the shot) and the letterbox, remembering the user's settings. */
function beginTourLook(): void {
  if (!tourSaved) tourSaved = { hour: state.hour, look: state.look };
  if (state.look !== 'kino') setKey('look', 'kino');
  ui.setCinema(true);
}

function applyTourFrame(f: TourFrame, newShot: boolean): void {
  // the hour changes only at a cut, while the frame is black
  // wave-10 review fix: the aerial shots ask for the cumulus (TourShotSpec.clouds), at the same black frame
  const wantClouds = f.shot.clouds ?? false;
  if (state.hour !== f.hour || tourClouds !== wantClouds) {
    state.hour = f.hour;
    tourClouds = wantClouds;
    updateSun();
  }
  if (newShot) snapExposure = true;
  camera.position.set(f.pos[0], f.pos[1], f.pos[2]);
  controls.lookAt(new THREE.Vector3(f.look[0], f.look[1], f.look[2]));
  const c = captionFor(f.shot, captionInfo);
  ui.setCaption(c.title, c.note, f.caption, f.fade);
}

/** Advance a running Rundflug by dt (called at the start of every frame; nothing happens when no tour runs). */
function tourStep(dt: number): void {
  if (!tourPlayer.playing) return;
  const r = tourPlayer.update(dt, terrain.sample);
  if (!r) {
    endTour();
    return;
  }
  applyTourFrame(r.frame, r.newShot);
  if (frames % 4 === 1) {
    const ahead = tourAt(tour, tourPlayer.t + 2.5, terrain.sample).pos;
    tourProbe = (tourProbe ?? new THREE.Vector3()).set(ahead[0], ahead[1], ahead[2]);
  }
}

function startTour(): void {
  if (tourPlayer.playing) {
    endTour();
    return;
  }
  if (photoBusy()) return;
  if (document.pointerLockElement) document.exitPointerLock();
  controls.setMode('fly');
  beginTourLook();
  ui.setTourActive(true);
  tourPlayer.start();
}

/** Stop the Rundflug (or leave an `skb.tour` capture): restore the user's hour and look; the camera stays. */
function endTour(): void {
  tourPlayer.stop();
  tourProbe = null;
  if (tourClouds !== null) {
    tourClouds = null;
    updateSun();
  }
  if (!tourSaved) return;
  const s = tourSaved;
  tourSaved = null;
  ui.setCinema(false);
  ui.setTourActive(false);
  if (state.look !== s.look) setKey('look', s.look);
  if (state.hour !== s.hour) {
    state.hour = s.hour;
    ui.sync();
    updateSun();
  }
}

// any input stops the Rundflug (capture phase, so the key does nothing else)
const stopTourOnInput = (e: Event): void => {
  if (!tourPlayer.playing) return;
  if (e.type === 'keydown' && isTyping()) return;
  endTour();
  if (e.type === 'keydown') {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
};
addEventListener('keydown', stopTourOnInput, true);
renderer.domElement.addEventListener('pointerdown', stopTourOnInput);
renderer.domElement.addEventListener('wheel', stopTourOnInput, { passive: true });
renderer.domElement.addEventListener('touchstart', stopTourOnInput, { passive: true });

/** Distance (m) to what the screen centre shows: buildings (visible levels) or the terrain; 300 m if nothing. */
function focusDistance(): number {
  camera.updateMatrixWorld();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  let best = Infinity;
  for (const h of raycaster.intersectObject(buildingsRoot, true)) {
    let vis = true;
    for (let q: THREE.Object3D | null = h.object; q && vis; q = q.parent) vis = q.visible;
    if (vis && (h.object as THREE.Mesh).material && !String(((h.object as THREE.Mesh).material as THREE.Material).name).startsWith('glass')) {
      best = h.distance;
      break;
    }
  }
  const o = raycaster.ray.origin;
  const d = raycaster.ray.direction;
  for (let t = 1; t < Math.min(best, 4000); t *= 1.02) {
    const g = terrain.sample(o.x + d.x * t, o.z + d.z * t);
    if (Number.isFinite(g) && o.y + d.y * t <= g) {
      best = Math.min(best, t);
      break;
    }
  }
  return Number.isFinite(best) ? best : 300;
}

const photoHost = {
  renderer,
  scene,
  camera,
  prepare: () => frame(0, true),
  focus: focusDistance,
  setBusy: (on: boolean) => (photoPaused = on),
  restoreScale: () => applyQuality(),
  // KB-I41: stills go through the post chain too (no SMAA / MSAA: the accumulation antialiases)
  render: () => post.render(scene, camera),
  setStill: (on: boolean) => (post.still = on),
  hour: () => state.hour,
  attribution: terrain.meta.attribution,
};

/** Expose and (optionally) download a still; the toast shows the progress. */
async function savePhoto(opts: PhotoOptions = ui.photoOptions(), download = true, look: Look = 'kino'): Promise<Awaited<ReturnType<typeof takePhoto>> | null> {
  if (photoBusy()) return null;
  endTour();
  // KB-I41 decision: stills are exposed in the Kino look (like the Rundflug); the user's look comes back afterwards
  const userLook = state.look;
  if (look !== userLook) setKey('look', look);
  try {
    ui.toast('Foto wird belichtet …');
    const r = await takePhoto(photoHost, opts, (k, n) => ui.toast(`Foto wird belichtet … ${k}/${n}`));
    if (download) {
      ui.toast('PNG wird gespeichert …');
      await downloadPng(r.canvas, photoFileName(state.hour, new Date()));
    }
    ui.toast(null);
    return r;
  } catch (e) {
    console.warn('[viewer] photo', e);
    ui.toast('Foto fehlgeschlagen');
    setTimeout(() => ui.toast(null), 3000);
    return null;
  } finally {
    if (state.look !== userLook) setKey('look', userLook);
  }
}
addEventListener('keydown', (e) => {
  if (e.code !== 'KeyP' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping()) return;
  e.preventDefault();
  void savePhoto();
});

// ---------------------------------------------------------------- frame loop
/** KB-I64: test hooks own the frames until the next real user input (clock.ts). */
const reviewClock = new ReviewClock();
/** Camera position after the last `skb.step` (KB-I64). */
const stepEnd = new THREE.Vector3(NaN, NaN, NaN);
/** A review driver re-set the scene (`skb.setMode`, `skb.set`): the next `skb.step` restarts the animation clocks. */
let clockReset = false;
for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) addEventListener(type, () => reviewClock.input(), { capture: true, passive: true });
let last = performance.now();
let frames = 0;
let fpsT = last;
const festView = new THREE.Vector2();
function frame(dt: number, snap = false): void {
  tourStep(dt);
  controls.update(dt);
  terrainMesh.update(camera);
  forestLod.indoor = inside; // KB-I44 review: no exterior vegetation while the camera is inside a building
  if (inside !== vegetationIndoor) {
    vegetationIndoor = inside;
    for (const o of siteVegetation) o.visible = !inside;
    shadowDirty = true;
  }
  if (forestLod.update(camera)) shadowDirty = true;
  leafCards.group.visible = !inside;
  leafCards.update(camera);
  vines.indoor = inside;
  vines.update(camera);
  grass.indoor = inside;
  grass.update(camera);
  tickFoliage(dt);
  if (frames % 4 === 0) updateLod2();
  else if (frames % 4 === 2 && tourProbe) updateLod2(false, tourProbe);
  if (frames % 8 === 0) updateInteriorBudget();
  if (frames % 8 === 4) updateCandles();
  if (frames % 8 === 4) {
    // wave-10 review fix: 'Wolken: aus der Luft' follows the height above the ground (with hysteresis)
    const aloft = cloudAloft(cloudsAloft, camera.position.y - terrain.sample(camera.position.x, camera.position.z), controls.mode === 'walk');
    if (aloft !== cloudsAloft) {
      cloudsAloft = aloft;
      if (state.clouds === 'air' && tourClouds === null) updateSun();
    }
  }
  if (frames % 4 === 0) {
    const sig = lodLevels();
    if (sig !== lodSignature) {
      lodSignature = sig;
      shadowDirty = true;
    }
  }
  if (controls.mode === 'walk') refreshColliders();
  updateShadowFrustum();
  // KB-I50: the far forest impostors cast into the static far map only (in the near map they cost every redraw)
  const farDraw = farShadow.tick(sun.shadow.needsUpdate) && farShadow.light.visible && renderer.shadowMap.enabled;
  if (farDraw) farCasters(true);
  if (snap) snapExposure = true;
  updateExposure(dt);
  atmosphere.sky.position.copy(camera.position);
  // KB-I41 post chain; the portal lanterns light their surroundings in screen space (KB-I43 review fix)
  post.tick(dt);
  post.indoor = inside;
  post.lampLevel = !atmosphere.state ? 0 : inside ? atmosphere.state.night : windowGlow(atmosphere.state.elevation);
  // indoors the candles are point lights (wave 11); the screen-space lamps are the portal lanterns outside
  if (inside !== lampsIndoor) syncLamps();
  if (festival?.group.visible) festival.setView(renderer.getDrawingBufferSize(festView).y, camera.fov);
  // KB-I75: at most one mirror cube face per frame, only after entering a room or a light change
  mirrors.update(camera, inside, inside ? mirrorKey('', state.hour, state.look, state.fest || state.festival) : '', frames);
  if (nightSky.group.visible) nightSky.setView(renderer.getDrawingBufferSize(festView).y, camera.fov);
  post.render(scene, camera);
  if (farDraw) farCasters(false);
  frames++;
}
function loop(): void {
  const now = performance.now();
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  // KB-I47: while a still is exposed, photo.ts draws; the viewer's own frames pause (no blocking, no extra cost).
  // KB-I64: while test hooks drive the frames (skb.step …), the canvas keeps the frame they rendered
  if (photoPaused || !reviewClock.wallFrame()) {
    requestAnimationFrame(loop);
    return;
  }
  const timed = timerExt && !benchActive && state.autoScale && pendingQueries.length < 4;
  let q: WebGLQuery | null = null;
  if (timed) {
    q = gl2.createQuery();
    if (q) gl2.beginQuery(timerExt!.TIME_ELAPSED_EXT, q);
  }
  frame(dt);
  if (q) {
    gl2.endQuery(timerExt!.TIME_ELAPSED_EXT);
    pendingQueries.push(q);
  }
  pollGpuTimer();
  if (now - fpsT > 500) {
    updateStats();
    fpsT = now;
  }
  requestAnimationFrame(loop);
}
function updateStats(): void {
  const scale = renderer.getPixelRatio();
  ui.setStats(`${renderer.info.render.calls} Draw-Calls · ${(renderer.info.render.triangles / 1e6).toFixed(2)} Mio. Dreiecke · Auflösung ×${scale.toFixed(2)} · ${controls.mode === 'walk' ? 'Gehen' : 'Fliegen'} · ${camera.position.y.toFixed(1)} m ü. NHN`);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

applyQuality();
applyLook();
{
  // wave 10: the cloud field's sunny clearing and the sky's march origin sit on the palace anchor (view-east target)
  const ve = pois.find((p) => p.id === 'view-east');
  if (ve?.lookAt) atmosphere.cloudCentre = [ve.lookAt.x, ve.lookAt.z];
}
updateSun();
applyDisplay();
if (!startFromHandover()) goto('view-west');
requestAnimationFrame(loop);

// ---------------------------------------------------------------- test hooks
function triangles(): { buildings: number; terrain: number; rendered: number } {
  let t = 0;
  for (const e of entries.values()) {
    const lvl = e.lod.getCurrentLevel();
    const obj = e.lod.levels[lvl]?.object;
    obj?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.visible) t += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    });
  }
  return { buildings: t, terrain: terrainMesh.triangles, rendered: renderer.info.render.triangles };
}

/**
 * Grey-card probe (light-sky-post.md §3.2): renders two albedo-0.5 cards lit by the current sun and sky environment,
 * one facing the sun and one vertical card facing away from it (a façade in shade), plus one facing up, into a float
 * target without tone mapping. Returns their luminance in cd/m² and the sun:shade ratio.
 */
function lightProbe(): { sunCard: number; shadeCard: number; upCard: number; ratio: number; ev: number; elevation: number } | null {
  const ls = atmosphere.state;
  if (!ls) return null;
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.FloatType });
  const ps = new THREE.Scene();
  ps.environment = scene.environment;
  const l = new THREE.DirectionalLight(sun.color, sun.visible ? sun.intensity : 0);
  l.position.copy(ls.dir);
  ps.add(l, l.target);
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  mat.color.setRGB(0.5, 0.5, 0.5, THREE.LinearSRGBColorSpace);
  const card = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  ps.add(card);
  const cam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
  const read = (n: THREE.Vector3): number => {
    card.lookAt(n); // PlaneGeometry faces +z: lookAt points +z toward n
    cam.position.copy(n).multiplyScalar(2);
    cam.lookAt(0, 0, 0);
    renderer.setRenderTarget(rt);
    renderer.render(ps, cam);
    const px = new Float32Array(4);
    renderer.readRenderTargetPixels(rt, 2, 2, 1, 1, px);
    renderer.setRenderTarget(null);
    return (0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]) / ls.pre;
  };
  const toward = ls.dir.clone().normalize();
  const away = new THREE.Vector3(-ls.dir.x, 0, -ls.dir.z).normalize();
  const sunCard = read(toward);
  const shadeCard = read(away);
  const upCard = read(new THREE.Vector3(0, 1, 0));
  rt.dispose();
  mat.dispose();
  card.geometry.dispose();
  return { sunCard, shadeCard, upCard, ratio: sunCard / shadeCard, ev: ls.evOut, elevation: ls.elevation };
}

function setKey(key: keyof UiState, value: unknown): void {
  if (key === 'quality' && !isPreset(value)) throw new Error(`unknown quality ${String(value)}`);
  // wave-10 review fix: 'clouds' is a mode now; true / false (older poses, A/B evals) mean 'on' / 'off'
  if (key === 'clouds') value = cloudMode(value);
  (state as unknown as Record<string, unknown>)[key] = value;
  ui.sync();
  onStateChange(key);
}

const skb = {
  scene,
  camera,
  renderer,
  controls,
  state,
  pois,
  entries,
  atmosphere,
  /** KB-I41 post chain: A/B with e.g. `skb.post.settings.ao = false`, `skb.post.aoStrength = 0`. */
  post,
  /** Wave 10: the cumulus block `uCloud` (clouds.ts: 0 amount, 1–2 offset, 3 shadow, …); A/B via `skb.set('clouds', false)`. */
  cloudData,
  /** Wave 10: stars and moon disc (`skb.nightSky.group.visible`); moon of the current date and hour. */
  nightSky,
  moon: () => {
    const d = skyDate();
    return { date: d, ...moonState(jdLocal(d.year, d.month, d.day, state.hour, KARLSBERG_LON), KARLSBERG_LAT, KARLSBERG_LON), lux: atmosphere.state?.moonLux ?? 0 };
  },
  /** Wave 11 candle pool: `skb.candles.stats()` (room, clusters, ambient lux); A/B with `skb.candles.enabled = false`. */
  candles,
  /** KB-I75 room mirrors: `skb.mirrors.enabled = false` for an A/B, `.captures` (cube faces rendered). */
  mirrors,
  /** KB-I75 window pull: `skb.windowPull.enabled = false` for an A/B (the shoulder: `skb.post.indoorShoulder`). */
  windowPull,
  /** Forest tiles (KB-I10): `skb.forest.stats()`; A/B with `skb.forest.nearDistance = 1e9` (all tiles near). */
  forest: forestLod,
  /** Foliage shading (KB-I44): `skb.foliage.uFolOn.value = 0` for an A/B, `uFolWind` 0 = calm. */
  foliage: foliageUniforms,
  /** Near-tree leaf cards (wave 6): `skb.leafCards.setEnabled(false)` for an A/B, `.stats()`, `.far` (m). */
  leafCards,
  /** Vineyard plants in 3D (KB-I35): `skb.vines.setEnabled(false)` for an A/B, `.stats()`. */
  vines,
  /** Grass-blade cards near the camera (wave 9): `skb.grass.setEnabled(false)` for an A/B, `.stats()`, `.uniforms`. */
  grass,
  /** KB-I48 Festbeleuchtung: `skb.set('festival', true)`; `.stats()` (lamp count, visible, festival factor). */
  festival: { stats: () => festival?.stats() ?? null, get group() { return festival?.group ?? null; } },
  /** Advance n frames with a fixed dt (automated tabs are often hidden, rAF paused); exposure snaps (deterministic). */
  step(n = 1, dt = 1 / 60): void {
    reviewClock.hook();
    // KB-I64: a camera set directly (review drivers move skb.camera) is a new place: restart the animation clocks, so a
    // pose renders the same frame whatever ran before it
    if (clockReset || stepEnd.distanceToSquared(camera.position) > 0.25) {
      clockReset = false;
      post.resetTime();
      foliageUniforms.uFolTime.value = 0;
    }
    for (let i = 0; i < n; i++) frame(dt, true);
    stepEnd.copy(camera.position);
    updateStats(); // the rAF loop is held, so the HUD line follows the stepped frame
  },
  /** As the "Gehe zu" list, without its preferred hour; the review clock holds the frame (KB-I64). */
  goto(id: string, applyHour = false): boolean {
    reviewClock.hook();
    return goto(id, applyHour);
  },
  /**
   * Exact camera pose for reproducible reviews (visual-audit §7): position (x, y, z) and look-at point (lx, ly, lz)
   * in the local frame, mode 'fly' | 'walk'. Runs the same LOD2 and collider update as `goto`; renders nothing.
   */
  pose(x: number, y: number, z: number, lx: number, ly: number, lz: number, mode: Mode = 'fly'): void {
    reviewClock.hook();
    endTour();
    snapExposure = true;
    placeCamera(x, y, z, mode === 'walk');
    controls.lookAt(new THREE.Vector3(lx, ly, lz));
  },
  /** Display look: 'doku' (Neutral tone mapping, catalogue colours) or 'kino' (AgX). */
  look(name?: Look): Look {
    if (name) setKey('look', name);
    return state.look;
  },
  /** Quality preset 'hoch' | 'mittel' | 'mobil' (DPR cap 1.5 / 1.25 / 1.0); returns the effective pixel ratio. */
  quality(preset?: QualityPreset): { preset: QualityPreset; dpr: number; adaptiveScale: number } {
    if (preset) setKey('quality', preset);
    return { preset: state.quality, dpr: renderer.getPixelRatio(), adaptiveScale: adaptive.scale };
  },
  /** Photo mode render scale (DPR up to 2, adaptive scale off) for stills. */
  photo(on: boolean): void {
    photoMode = on;
    applyQuality();
  },
  /** Render one frame and return it as a JPEG data URL (works without preserveDrawingBuffer: same task). */
  capture(quality = 0.9): string {
    frame(0, true);
    return renderer.domElement.toDataURL('image/jpeg', quality);
  },
  setMode(m: Mode): void {
    reviewClock.hook();
    clockReset = true; // KB-I64: a review pose starts here (shots.mjs pose()), even at the same place as before
    controls.setMode(m);
  },
  set(key: keyof UiState, value: unknown): void {
    reviewClock.hook();
    clockReset = true;
    setKey(key, value);
  },
  lightProbe,
  /** Light state of the current hour: EV outside / inside, pre-exposure, sun and sky illuminance, adaptation. */
  light() {
    const ls = atmosphere.state;
    return ls ? { elevation: ls.elevation, evOut: ls.evOut, evIn: ls.evIn, adaptedEv: adaptEv, inside, exposure: renderer.toneMappingExposure, sunLux: ls.sunLux, skyLux: ls.skyLux, fog: atmosphere.fogUniforms() } : null;
  },
  /** Shadow-map redraws so far (KB-I04 cache check). */
  shadowRedraws: () => shadowRedraws,
  /** KB-I50 static far shadow map: `.renders()` (maps drawn), `.setEnabled(false)` for an A/B, `.light`. */
  farShadow: {
    renders: () => farShadow.renders,
    light: farShadow.light,
    setEnabled(on: boolean): void {
      farShadowOn = on;
      farShadow.light.visible = sun.visible && on;
      farShadow.invalidate();
    },
  },
  /** Mean GPU-synced frame time over n frames (ms). */
  bench(n = 30): { ms: number; triangles: ReturnType<typeof triangles>; calls: number } {
    const gl = renderer.getContext();
    const px = new Uint8Array(4);
    frame(0);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t = performance.now();
    for (let i = 0; i < n; i++) {
      frame(0);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    return { ms: (performance.now() - t) / n, triangles: triangles(), calls: renderer.info.render.calls };
  },
  /**
   * GPU time per frame (ms) via EXT_disjoint_timer_query_webgl2 (readPixels sync is vsync-capped in visible tabs),
   * plus the CPU time of frame() (scene update + command submission). Optional size, e.g. [1920, 1080] at DPR 1.
   * `moveM` > 0 flies the camera forward by that many metres per frame (shadow cache in flight), then puts it back.
   */
  async gpuBench(n = 20, size?: [number, number], moveM = 0): Promise<{ gpuMs: number; cpuMs: number; calls: number; triangles: number; shadowRedraws: number } | null> {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    if (!ext) return null;
    benchActive = true;
    const prev = { dpr: renderer.getPixelRatio(), w: innerWidth, h: innerHeight };
    const startPos = camera.position.clone();
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    if (size) {
      renderer.setPixelRatio(1);
      renderer.setSize(size[0], size[1], false);
      camera.aspect = size[0] / size[1];
      camera.updateProjectionMatrix();
    }
    frame(0);
    const redraws0 = shadowRedraws;
    const queries: WebGLQuery[] = [];
    let cpu = 0;
    for (let i = 0; i < n; i++) {
      if (moveM) camera.position.addScaledVector(fwd, moveM);
      const q = gl.createQuery()!;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      const t = performance.now();
      frame(0);
      cpu += performance.now() - t;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      queries.push(q);
    }
    const calls = renderer.info.render.calls;
    const tris = renderer.info.render.triangles;
    const redraws = shadowRedraws - redraws0;
    let total = 0;
    let got = 0;
    for (const q of queries) {
      for (let k = 0; k < 200 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await new Promise((r) => setTimeout(r, 5));
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) continue;
      total += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
      got++;
      gl.deleteQuery(q);
    }
    if (moveM) {
      camera.position.copy(startPos);
      frame(0);
    }
    if (size) {
      renderer.setPixelRatio(prev.dpr);
      renderer.setSize(prev.w, prev.h);
      camera.aspect = prev.w / prev.h;
      camera.updateProjectionMatrix();
    }
    benchActive = false;
    return { gpuMs: got ? total / got : NaN, cpuMs: cpu / n, calls, triangles: tris, shadowRedraws: redraws };
  },
  triangles,
  /**
   * KB-I46 capture hook: show the Rundflug at a deterministic frame. `id` = 'rundflug' with `t` in seconds of the whole
   * tour, or a shot id ('anflug', 'ehrenhof', 'garten', 'galerie', 'orangerie', 'goldene-stunde') with `t` 0…1 of that
   * shot. Sets the shot's hour and the Kino look, the letterbox and caption, places the camera (LOD2 and colliders as
   * `goto`) and returns the frame; render with `skb.step(n)`. `skb.tour(null)` leaves it and restores hour and look.
   */
  tour(id: string | null = 'rundflug', t = 0): { id: string; index: number; t: number; u: number; hour: number; fade: number; caption: { title: string; note: string; alpha: number }; pos: number[]; look: number[] } | null {
    if (id === null) {
      endTour();
      return null;
    }
    reviewClock.hook();
    tourPlayer.stop();
    const f = id === tour.spec.id ? tourAt(tour, t, terrain.sample) : shotAt(tour, id, t, terrain.sample);
    if (!f) throw new Error(`unknown tour or shot ${id}; shots: ${tour.shots.map((x) => x.spec.id).join(', ')}`);
    beginTourLook();
    if (state.hour !== f.hour) {
      state.hour = f.hour;
      ui.sync();
      updateSun();
    }
    snapExposure = true;
    placeCamera(f.pos[0], f.pos[1], f.pos[2], false);
    applyTourFrame(f, true);
    const c = captionFor(f.shot, captionInfo);
    return { id: f.shot.id, index: f.index, t: f.t, u: f.u, hour: f.hour, fade: f.fade, caption: { ...c, alpha: f.caption }, pos: f.pos, look: f.look };
  },
  /** KB-I46: a shot's frame at u (0…1) without applying it (camera path checks). */
  tourFrame: (id: string, u: number) => shotAt(tour, id, u, terrain.sample),
  /** KB-I46: the Rundflug's shots (id, German title, start and duration in s). */
  tourShots: () => tour.shots.map((x) => ({ id: x.spec.id, title: x.spec.title_de, start: x.start, duration: x.spec.duration, hour: x.spec.hour })),
  /** KB-I46: start / stop the real-time Rundflug (as the "Rundflug" button). */
  tourPlay: (on = true) => {
    reviewClock.input(); // the real-time tour runs on wall-clock frames
    return on ? (tourPlayer.playing ? undefined : startTour()) : endTour();
  },
  /**
   * KB-I47: expose a still ({ scale 2|3, dof, samples? }); returns its size, samples, focus (m), aperture (m) and time,
   * plus a data URL when `dataUrl` is 'image/png' or 'image/jpeg' (no download then).
   */
  async takePhoto(opts: Partial<PhotoOptions> & { dataUrl?: 'image/png' | 'image/jpeg'; quality?: number; look?: Look } = {}) {
    const r = await savePhoto({ scale: opts.scale ?? 2, dof: opts.dof ?? false, samples: opts.samples }, !opts.dataUrl, opts.look ?? 'kino');
    if (!r) return null;
    return { width: r.width, height: r.height, samples: r.samples, focus: r.focus, aperture: r.aperture, ms: r.ms, dataUrl: opts.dataUrl ? r.canvas.toDataURL(opts.dataUrl, opts.quality ?? 0.92) : undefined };
  },
  /** KB-I43: lit windows per building class (LOD1 level, the same windows as LOD0/LOD2) and the night colour;
   *  `lanterns` = false hides the portal lanterns (bench A/B). */
  night(showLanterns?: boolean) {
    if (showLanterns !== undefined) nightRoot.visible = showLanterns;
    const byCls: Record<string, { lit: number; windows: number }> = {};
    for (const e of entries.values()) {
      const g = e.levels[1];
      if (!g) continue;
      const x = (byCls[e.b.cls] ??= { lit: 0, windows: 0 });
      x.lit += (g.userData.litWindows as number) ?? 0;
      x.windows += (g.userData.windows as number) ?? 0;
    }
    let lanterns = 0;
    nightRoot.traverse((o) => {
      if ((o as THREE.Sprite).isSprite) lanterns++;
    });
    return { byCls, lanterns, windowRgb: WINDOW_RGB };
  },
  /** Parsed explorer handover (null without query params). */
  handover,
  /** Return URL "Zurück zur Karte" would navigate to now (no navigation). */
  backUrl,
  placed: spec.buildings.filter(isPlaced).length,
};
(window as unknown as { skb: typeof skb }).skb = skb;
