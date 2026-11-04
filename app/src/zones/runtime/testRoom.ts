/**
 * V2.6b: built-in procedural zone „Testraum“ (runtime `module: "testraum"`, manifest in builtin.ts). A 16 × 16 m
 * hut with a door in the south wall, a lamp, a table and a slowly turning test object. Own scene + camera on the
 * explorer's shared renderer, DroneController for input (WASD / mouse / drag-look), walking with wall collision.
 * Lazy chunk: imported only on *Betreten*. Debug: `?zoneDelay=<ms>` stretches loading (loading-screen checks).
 */
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  CanvasTexture,
  DirectionalLight,
  Color,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  SRGBColorSpace,
  Scene,
  Shape,
  ShapeGeometry,
  SphereGeometry,
} from 'three';
import type { BufferGeometry, Material, ToneMapping } from 'three';
import { DroneController } from '../../controls/DroneController';
import type { ZoneHandle, ZoneModule, ZoneMountContext, ZonePose } from './api';
import { collideCircle, localToEN, poseToLocal } from './collide';
import type { BoxXZ } from './collide';
import { TESTRAUM_FLOOR_H } from './builtin';

const EYE = 1.7;
const HALF = 8; // room half size (m)
const WALL = 0.3; // wall thickness
const WALL_H = 3.6;
const DOOR_W = 2.4;
const DOOR_H = 2.6;
const BODY_R = 0.35;

const abortError = () => new DOMException('Zone mount aborted', 'AbortError');
const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), reject(abortError())), { once: true });
  });

/** Wall boxes in room-local x/z (origin = room centre, floor y = 0); the south wall (z = +HALF) has the door. */
export function testRoomWalls(): BoxXZ[] {
  const h = HALF;
  const t = WALL / 2;
  const d = DOOR_W / 2;
  return [
    { x0: -h - t, z0: -h - t, x1: h + t, z1: -h + t }, // north
    { x0: -h - t, z0: -h - t, x1: -h + t, z1: h + t }, // west
    { x0: h - t, z0: -h - t, x1: h + t, z1: h + t }, // east
    { x0: -h - t, z0: h - t, x1: -d, z1: h + t }, // south, left of the door
    { x0: d, z0: h - t, x1: h + t, z1: h + t }, // south, right of the door
    { x0: -1.4, z0: -3.4, x1: 1.4, z1: -1.6 }, // table
    { x0: -0.6, z0: -6.6, x1: 0.6, z1: -5.4 }, // pedestal
  ];
}

function signTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#2b1d12';
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = '#d9a441';
  g.lineWidth = 10;
  g.strokeRect(14, 14, 484, 228);
  g.fillStyle = '#f3dfb0';
  g.textAlign = 'center';
  g.font = 'bold 76px system-ui, sans-serif';
  g.fillText('Testraum', 256, 120);
  g.font = '32px system-ui, sans-serif';
  g.fillText('Zone · V2.6 · synthetisch', 256, 186);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

class TestRoom implements ZoneHandle {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(70, 1, 0.1, 400);
  private readonly root = new Group();
  private readonly spinner: Mesh;
  private readonly walls = testRoomWalls();
  private controls: DroneController | null = null;
  private walk = true;
  private t = 0;
  private saved: { toneMapping: ToneMapping; exposure: number; clear: Color; alpha: number } | null = null;
  private readonly hold = { fwd: 0 };
  private readonly origin: { E0: number; N0: number };
  private readonly disposables: Array<BufferGeometry | Material | CanvasTexture> = [];
  private readonly ui: HTMLElement;

  constructor(private readonly ctx: ZoneMountContext) {
    this.origin = ctx.manifest.origin;
    this.scene.background = new Color('#5a6f8f');
    this.scene.fog = new Fog('#5a6f8f', 40, 160);
    this.scene.add(this.root);
    this.root.position.y = TESTRAUM_FLOOR_H; // room-local y 0 = floor
    this.spinner = this.build();
    this.ui = this.buildTouchUi();
  }

  private mat(m: Material): Material {
    this.disposables.push(m);
    return m;
  }

  private box(w: number, h: number, d: number, x: number, y: number, z: number, m: Material): Mesh {
    const g = new BoxGeometry(w, h, d);
    this.disposables.push(g);
    const mesh = new Mesh(g, m);
    mesh.position.set(x, y, z);
    this.root.add(mesh);
    return mesh;
  }

  private build(): Mesh {
    const wallM = this.mat(new MeshStandardMaterial({ color: '#c9b79a', roughness: 0.9 }));
    const woodM = this.mat(new MeshStandardMaterial({ color: '#7a5233', roughness: 0.7 }));
    const floorM = this.mat(new MeshStandardMaterial({ color: '#5d4330', roughness: 0.85 }));
    const groundM = this.mat(new MeshStandardMaterial({ color: '#4f6a3f', roughness: 1 }));
    const roofM = this.mat(new MeshStandardMaterial({ color: '#7d3b2a', roughness: 0.8, side: DoubleSide }));

    const ground = new PlaneGeometry(120, 120);
    this.disposables.push(ground);
    const g = new Mesh(ground, groundM);
    g.rotation.x = -Math.PI / 2;
    g.position.y = -0.02;
    this.root.add(g);
    this.box(2 * HALF, 0.05, 2 * HALF, 0, 0.01, 0, floorM);

    for (const w of this.walls.slice(0, 5)) {
      this.box(w.x1 - w.x0, WALL_H, w.z1 - w.z0, (w.x0 + w.x1) / 2, WALL_H / 2, (w.z0 + w.z1) / 2, wallM);
    }
    // Lintel over the door.
    this.box(DOOR_W, WALL_H - DOOR_H, WALL, 0, (WALL_H + DOOR_H) / 2, HALF, wallM);
    // Door frame (wood).
    this.box(0.15, DOOR_H, WALL + 0.1, -DOOR_W / 2, DOOR_H / 2, HALF, woodM);
    this.box(0.15, DOOR_H, WALL + 0.1, DOOR_W / 2, DOOR_H / 2, HALF, woodM);
    this.box(DOOR_W + 0.15, 0.15, WALL + 0.1, 0, DOOR_H, HALF, woodM);
    // Roof: two slopes (ridge along z) + triangular gables.
    const roofW = HALF * Math.SQRT2 + 0.8;
    for (const sgn of [-1, 1]) {
      const geo = new PlaneGeometry(roofW, 2 * HALF + 1.2);
      this.disposables.push(geo);
      const tilt = new Group();
      tilt.rotation.z = -sgn * (Math.PI / 4);
      tilt.position.set(sgn * (HALF / 2), WALL_H + HALF / 2, 0);
      const slope = new Mesh(geo, roofM);
      slope.rotation.x = -Math.PI / 2;
      tilt.add(slope);
      this.root.add(tilt);
    }
    const gable = new Shape();
    gable.moveTo(-HALF, 0);
    gable.lineTo(HALF, 0);
    gable.lineTo(0, HALF);
    gable.closePath();
    const gableG = new ShapeGeometry(gable);
    this.disposables.push(gableG);
    const gableM = this.mat(new MeshStandardMaterial({ color: '#c9b79a', roughness: 0.9, side: DoubleSide }));
    for (const z of [-HALF, HALF]) {
      const m = new Mesh(gableG, gableM);
      m.position.set(0, WALL_H, z);
      this.root.add(m);
    }
    // Table.
    this.box(2.6, 0.08, 1.6, 0, 0.78, -2.5, woodM);
    for (const [x, z] of [[-1.2, -3.2], [1.2, -3.2], [-1.2, -1.8], [1.2, -1.8]] as const) this.box(0.08, 0.76, 0.08, x, 0.38, z, woodM);
    // Pedestal + turning test object.
    this.box(1, 1, 1, 0, 0.5, -6, woodM);
    const icoG = new IcosahedronGeometry(0.45, 0);
    this.disposables.push(icoG);
    const ico = new Mesh(icoG, this.mat(new MeshStandardMaterial({ color: '#58c4dd', emissive: '#1d6f86', emissiveIntensity: 0.9, flatShading: true })));
    ico.position.set(0, 1.55, -6);
    this.root.add(ico);
    // Sign on the north wall.
    const tex = signTexture();
    if (tex) {
      this.disposables.push(tex);
      const sg = new PlaneGeometry(3, 1.5);
      this.disposables.push(sg);
      const sign = new Mesh(sg, this.mat(new MeshBasicMaterial({ map: tex })));
      sign.position.set(0, 2.3, -HALF + WALL / 2 + 0.02);
      this.root.add(sign);
    }
    // Lamp.
    const bulbG = new SphereGeometry(0.18, 16, 12);
    this.disposables.push(bulbG);
    const bulb = new Mesh(bulbG, this.mat(new MeshBasicMaterial({ color: '#ffe2a8' })));
    bulb.position.set(0, WALL_H - 0.5, -2.5);
    this.root.add(bulb);
    const lamp = new PointLight('#ffd59a', 30, 22, 1.6);
    lamp.position.copy(bulb.position);
    this.root.add(lamp);
    this.root.add(new HemisphereLight('#b8c8e6', '#3a2e22', 1.3));
    const sun = new DirectionalLight('#ffe6c0', 2.2); // evening light from the south-west, lights the door side
    sun.position.set(-25, 30, 35);
    this.root.add(sun, sun.target);
    return ico;
  }

  /** Coarse pointers (phones) get a hold-to-walk button; drag on the canvas looks around. */
  private buildTouchUi(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'sle-zone-walkpad';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sle-btn';
    btn.textContent = '▲ Vor';
    btn.setAttribute('aria-label', 'Vorwärts gehen (gedrückt halten)');
    const on = (e: Event) => (e.preventDefault(), (this.hold.fwd = 1));
    const off = () => (this.hold.fwd = 0);
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('pointerleave', off);
    wrap.appendChild(btn);
    this.ctx.container.appendChild(wrap);
    return wrap;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  enter(spawn: ZonePose): void {
    const r = this.ctx.renderer;
    this.saved = { toneMapping: r.toneMapping, exposure: r.toneMappingExposure, clear: r.getClearColor(new Color()), alpha: r.getClearAlpha() };
    r.toneMapping = ACESFilmicToneMapping;
    r.toneMappingExposure = 1;
    const floor = TESTRAUM_FLOOR_H;
    this.controls = new DroneController(this.camera, r.domElement, { surfaceY: () => floor }, this.origin, {
      fallbackGround: floor,
      minClearance: EYE,
      baseSpeed: 12,
    });
    this.walk = spawn.mode === 'gehen';
    const { x, z } = poseToLocal(spawn.E, spawn.N, this.origin);
    this.controls.setPose({ x, z, y: this.walk ? floor + EYE : spawn.h, heading: spawn.heading_deg, pitch: spawn.pitch_deg });
  }

  pose(): ZonePose {
    const p = this.camera.position;
    const { E, N } = localToEN(p.x, p.z, this.origin);
    return { E, N, h: p.y, heading_deg: this.controls?.heading ?? 0, pitch_deg: this.controls?.pitch ?? 0, mode: this.walk ? 'gehen' : 'fliegen' };
  }

  frame(dt: number): void {
    const c = this.controls;
    if (!c) return;
    const p = this.camera.position;
    c.update(dt);
    if (this.hold.fwd) {
      const hr = (c.heading * Math.PI) / 180;
      p.x += Math.sin(hr) * 2.2 * Math.min(dt, 0.1);
      p.z -= Math.cos(hr) * 2.2 * Math.min(dt, 0.1);
    }
    if (this.walk) {
      p.y = TESTRAUM_FLOOR_H + EYE;
      // Walls in room-local coordinates (the room centre is the zone origin).
      const q = collideCircle(p.x, p.z, BODY_R, this.walls);
      p.x = Math.min(Math.max(q.x, -55), 55);
      p.z = Math.min(Math.max(q.z, -55), 55);
    }
    this.t += dt;
    this.spinner.rotation.y = this.t * 0.6;
    this.spinner.position.y = 1.55 + Math.sin(this.t * 1.3) * 0.06;
    this.ctx.renderer.render(this.scene, this.camera);
  }

  exit(): ZonePose {
    const pose = this.pose();
    this.controls?.dispose();
    this.controls = null;
    const r = this.ctx.renderer;
    if (this.saved) {
      r.toneMapping = this.saved.toneMapping;
      r.toneMappingExposure = this.saved.exposure;
      r.setClearColor(this.saved.clear, this.saved.alpha);
      this.saved = null;
    }
    return pose;
  }

  dispose(): void {
    if (this.controls) this.exit();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.ui.remove();
    this.scene.clear();
  }
}

export async function mountZone(ctx: ZoneMountContext): Promise<ZoneHandle> {
  const delay = Number(new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('zoneDelay')) || 0;
  const steps = 4;
  for (let i = 1; i <= steps; i++) {
    ctx.onProgress(['Wände', 'Dach', 'Möbel', 'Licht'][i - 1]!, i / steps);
    await wait(delay / steps, ctx.signal);
  }
  if (ctx.signal.aborted) throw abortError();
  return new TestRoom(ctx);
}

const mod: ZoneModule = { mountZone, hostChrome: true };
export default mod;
