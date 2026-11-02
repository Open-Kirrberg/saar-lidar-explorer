/**
 * Schloss Karlsberg 1789 - standalone viewer (fly + walk). German UI, English code.
 * Loads catalogue v2, the terrain crop (viewer/public/terrain) and builds the site with the exterior/site
 * generators (LOD0 far, LOD1 near, LOD2 + interiors very near). window.skb exposes hooks for automated tests.
 */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import catalogue from '../../model/catalogue.json';
import textureManifest from '../textures.json';
import { loadSite } from '@model/catalogue.ts';
import { isPlaced } from '@model/spec.ts';
import { type BuildContext, type Poi, DEFAULT_BUILD_OPTIONS, makeLayoutFn } from '@model/context.ts';
import type { Building, Confidence } from '@model/spec.ts';
import { E0, N0, gridConvergenceDeg } from '@model/frame.ts';
import { createMaterials } from '@model/materials/index.ts';
import { buildExterior } from '@model/exterior/index.ts';
import { siteBuildings, sitePois } from '@model/site/index.ts';
import { buildFeatures } from '@model/site/features.ts';
import { TerrainMesh, loadTerrain, terrainMaterial } from './terrain.ts';
import { Controls, EYE, type Mode, isTyping } from './controls.ts';
import { EXPLORER_DEFAULT_URL, backTarget, headingToYaw, liftAboveGround, parseHandover, pickWalkStart, pitchToRad, poseFromCamera, poseToLocal, walkFallbackYaw } from './handover.ts';
import { dayOfYear, sunPosition } from './sun.ts';
import { buildUi } from './ui.ts';
import { buildForest } from './forest.ts';

const { spec } = loadSite(catalogue);
/** Camera handover from the explorer (?src=explorer&E=…&N=…&h=…&heading=…&pitch=…&mode=…&back=…), or null. */
const handover = parseHandover(location.search);

// ---------------------------------------------------------------- renderer / scene
const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true, logarithmicDepthBuffer: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.3, 12000);
scene.fog = new THREE.FogExp2('#c9d6e0', 0.00016);

const sky = new Sky();
sky.scale.setScalar(20000);
const su = sky.material.uniforms;
su.turbidity.value = 2;
su.rayleigh.value = 1;
su.mieCoefficient.value = 0.003;
su.mieDirectionalG.value = 0.8;
// the analytic sky is very bright against ACES at our exposure: scale its radiance down (visible sky only)
sky.material.fragmentShader = sky.material.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * 0.3, 1.0 );');
if (su.cloudCoverage) su.cloudCoverage.value = 0.25;
scene.add(sky);

// warm-neutral sky tint (fix round 1: the cool #e8ecf0 turned the #ECE8DF render blue-grey)
const hemi = new THREE.HemisphereLight('#f1ede4', '#8a7a5c', 0.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff3df', 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);

const pmrem = new THREE.PMREMGenerator(renderer);
let envRT: THREE.WebGLRenderTarget | null = null;
const envScene = new THREE.Scene();
const envSky = new Sky();
envSky.scale.setScalar(1000);
envScene.add(envSky);

const state = {
  hour: 10.5,
  doy: dayOfYear(1789, 7, 15),
  shadows: true,
  confidenceColours: false,
  lowConfidence: 'show' as 'show' | 'translucent' | 'hide',
  roofs: true,
  interiors: true,
  epoch: '1789' as '1789' | '2025',
};

function updateSun(): void {
  const { elevation, azimuth } = sunPosition(state.doy, state.hour);
  // azimuth is from TRUE north; local −z is GRID north: grid az = true az − convergence
  const gamma = gridConvergenceDeg(382226, 5466120);
  const azGrid = ((azimuth - gamma) * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  const dir = new THREE.Vector3(Math.sin(azGrid) * Math.cos(el), Math.sin(el), -Math.cos(azGrid) * Math.cos(el));
  su.sunPosition.value.copy(dir);
  envSky.material.uniforms.sunPosition.value.copy(dir);
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'] as const) envSky.material.uniforms[k].value = su[k].value;
  sun.userData.dir = dir;
  const day = Math.max(0, Math.min(1, (elevation + 2) / 12));
  sun.intensity = 3.2 * day;
  sun.color.setHSL(0.09, 0.6, 0.55 + 0.4 * Math.min(1, elevation / 30));
  hemi.intensity = 0.2 + 0.9 * day;
  renderer.toneMappingExposure = 0.45 + 0.3 * day;
  if (envRT) envRT.dispose();
  envRT = pmrem.fromScene(envScene, 0.02);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.02 + 0.05 * day;
  (scene.fog as THREE.FogExp2).color.setHSL(0.58, 0.25, 0.35 + 0.45 * day);
}

// ---------------------------------------------------------------- world
const materials = createMaterials({ textureBase: './textures/', sets: textureManifest.sets as unknown as { name: string; real_size_m: [number, number] }[], anisotropy: renderer.capabilities.getMaxAnisotropy() });
const status = document.getElementById('status')!;
status.textContent = 'Lade Gelände …';
const terrain = await loadTerrain('./terrain/');
const tmat = terrainMaterial(terrain, { textureBase: './textures/' });
const terrainMesh = new TerrainMesh(terrain, tmat);
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
    buildingsRoot.add(lod);
    const L = ctxBase.layout(b);
    entries.set(b.id, { b, lod, levels: [g0, g1, null], centre: new THREE.Vector3(lod.position.x, L.stack.base_h, lod.position.z), radius: Math.hypot(L.frame.length, L.frame.width) / 2 });
  } catch (e) {
    console.warn(`[viewer] ${b.id}`, e);
  }
}
const features = buildFeatures(spec, ctx(1));
scene.add(features.group);
const forest = buildForest(terrain);
scene.add(forest);
console.info(`[viewer] ${entries.size} buildings built in ${(performance.now() - t0).toFixed(0)} ms`);

/**
 * Interior budget: interiors are drawn only within INTERIOR_DIST of the camera (you cannot see into rooms from
 * further away), interior meshes never cast sun shadows, and point lights burn only in the nearest interior.
 */
const INTERIOR_DIST = 45;
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
    if (!inner.userData.budgeted) {
      inner.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = false;
      });
      inner.userData.budgeted = true;
    }
    inner.visible = state.interiors && d < INTERIOR_DIST;
    if (inner.visible && d < nd) {
      nd = d;
      nearest = e;
    }
  }
  for (const e of entries.values()) {
    const inner = e.levels[2]?.getObjectByName(`${e.b.id}/interior`);
    if (!inner) continue;
    const on = e === nearest && nd < 20;
    for (const l of (inner.userData.lights ?? []) as THREE.Light[]) l.visible = on;
  }
}

/** Lazily build LOD2 (detail + interior) for buildings near the camera. */
function updateLod2(all = false): void {
  const p = camera.position;
  let built = false;
  for (const e of entries.values()) {
    const d = Math.hypot(p.x - e.centre.x, p.z - e.centre.z) - e.radius;
    if (d < LOD2_DIST && !e.levels[2] && !built) {
      built = true;
      const g2 = buildExterior(e.b, ctx(2));
      g2.position.set(0, -e.lod.position.y, 0);
      g2.rotation.set(0, 0, 0);
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
      const ud = o.userData as { part?: string; origMat?: THREE.Material | THREE.Material[] };
      if (o.name.endsWith('/interior')) o.visible = state.interiors;
      if (!(o as THREE.Mesh).isMesh) return;
      const m = o as THREE.Mesh;
      if (!ud.origMat) ud.origMat = m.material;
      if (ud.part === 'roof') m.visible = state.roofs;
      if (state.confidenceColours) m.material = confMat[conf];
      else if (state.lowConfidence === 'translucent' && conf === 'low') m.material = translucent;
      else m.material = ud.origMat;
      m.castShadow = m.material !== translucent && !(m.material as THREE.Material).transparent;
    });
    const inner = e.levels[2]?.getObjectByName(`${e.b.id}/interior`);
    if (inner) inner.userData.budgeted = false;
  }
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

function goto(id: string): boolean {
  const p = pois.find((x) => x.id === id || x.buildingId === id);
  if (!p) return false;
  camera.position.set(p.position.x, p.position.y, p.position.z);
  if (p.kind === 'entrance' || p.kind === 'room' || id === 'view-ehrenhof') controls.setMode('walk');
  else controls.setMode('fly');
  if (p.lookAt) controls.lookAt(new THREE.Vector3(p.lookAt.x, p.lookAt.y, p.lookAt.z));
  updateLod2(true);
  refreshColliders(true);
  return true;
}

// ---------------------------------------------------------------- controls + walk colliders
const controls = new Controls(camera, renderer.domElement);
controls.ground = terrain.sample;
let colliderCentre = new THREE.Vector3(1e9, 0, 0);
function refreshColliders(force = false): void {
  if (controls.mode !== 'walk') return;
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
const ui = buildUi({
  pois,
  state,
  onGoto: (id) => goto(id),
  onMode: (m) => controls.setMode(m),
  onChange: (key) => {
    if (key === 'hour') updateSun();
    if (key === 'shadows') renderer.shadowMap.enabled = state.shadows;
    if (key === 'epoch') {
      terrain.epoch = state.epoch;
      terrainMesh.rebuild();
    }
    applyDisplay();
  },
  onBack: backToMap,
  backTitle: handover?.back
    ? 'Zurück zum Explorer – an diese Stelle und Blickrichtung (Taste M)'
    : `Explorer an dieser Stelle öffnen (${new URL(EXPLORER_DEFAULT_URL).host}, Taste M)`,
  attribution: terrain.meta.attribution,
});
status.textContent = '';

// ---------------------------------------------------------------- frame loop
function updateShadowFrustum(): void {
  const dir = (sun.userData.dir as THREE.Vector3) ?? new THREE.Vector3(0, 1, 0);
  const walk = controls.mode === 'walk';
  const agl = controls.agl();
  const ext = walk ? 60 : Math.min(700, Math.max(120, agl * 2.2));
  // shadow centre: point on the ground ahead of the camera
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  fwd.normalize();
  const c = camera.position.clone().addScaledVector(fwd, ext * 0.5);
  const g = terrain.sample(c.x, c.z);
  c.y = Number.isFinite(g) ? g : camera.position.y - agl;
  // snap to texel grid against shimmering
  const texel = (2 * ext) / sun.shadow.mapSize.x;
  c.x = Math.round(c.x / texel) * texel;
  c.z = Math.round(c.z / texel) * texel;
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
}

let last = performance.now();
let frames = 0;
let fpsT = last;
function frame(dt: number): void {
  controls.update(dt);
  terrainMesh.update(camera);
  if (frames % 4 === 0) updateLod2();
  if (frames % 8 === 0) updateInteriorBudget();
  if (controls.mode === 'walk') refreshColliders();
  updateShadowFrustum();
  sky.position.copy(camera.position);
  renderer.render(scene, camera);
  frames++;
}
function loop(): void {
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;
  frame(dt);
  if (now - fpsT > 500) {
    ui.setStats(`${renderer.info.render.calls} Draw-Calls · ${(renderer.info.render.triangles / 1e6).toFixed(2)} Mio. Dreiecke · ${controls.mode === 'walk' ? 'Gehen' : 'Fliegen'} · ${camera.position.y.toFixed(1)} m ü. NHN`);
    fpsT = now;
  }
  requestAnimationFrame(loop);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

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
const skb = {
  scene,
  camera,
  renderer,
  controls,
  state,
  pois,
  entries,
  /** Advance n frames with a fixed dt (automated tabs are often hidden, rAF paused). */
  step(n = 1, dt = 1 / 60): void {
    for (let i = 0; i < n; i++) frame(dt);
  },
  goto,
  setMode(m: Mode): void {
    controls.setMode(m);
  },
  set(key: keyof typeof state, value: unknown): void {
    (state as Record<string, unknown>)[key] = value;
    ui.sync();
    if (key === 'hour') updateSun();
    if (key === 'epoch') {
      terrain.epoch = state.epoch;
      terrainMesh.rebuild();
    }
    renderer.shadowMap.enabled = state.shadows;
    applyDisplay();
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
   */
  async gpuBench(n = 20, size?: [number, number]): Promise<{ gpuMs: number; cpuMs: number; calls: number; triangles: number } | null> {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    if (!ext) return null;
    const prev = { dpr: renderer.getPixelRatio(), w: innerWidth, h: innerHeight };
    if (size) {
      renderer.setPixelRatio(1);
      renderer.setSize(size[0], size[1], false);
      camera.aspect = size[0] / size[1];
      camera.updateProjectionMatrix();
    }
    frame(0);
    const queries: WebGLQuery[] = [];
    let cpu = 0;
    for (let i = 0; i < n; i++) {
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
    let total = 0;
    let got = 0;
    for (const q of queries) {
      for (let k = 0; k < 200 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await new Promise((r) => setTimeout(r, 5));
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) continue;
      total += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
      got++;
      gl.deleteQuery(q);
    }
    if (size) {
      renderer.setPixelRatio(prev.dpr);
      renderer.setSize(prev.w, prev.h);
      camera.aspect = prev.w / prev.h;
      camera.updateProjectionMatrix();
    }
    return { gpuMs: got ? total / got : NaN, cpuMs: cpu / n, calls, triangles: tris };
  },
  triangles,
  /** Parsed explorer handover (null without query params). */
  handover,
  /** Return URL "Zurück zur Karte" would navigate to now (no navigation). */
  backUrl,
  placed: spec.buildings.filter(isPlaced).length,
};
(window as unknown as { skb: typeof skb }).skb = skb;
