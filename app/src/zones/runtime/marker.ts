/**
 * V2.6b: portal marker in the overworld — a pulsing glow ring on the ground, a light beam you can see from
 * far away and two gate posts across the portal's facing. Exaggeration-safe: y follows the displayed ground
 * (`terrain.surfaceY`, or `toDisplayY(portal.h)` for a fixed height) every frame. Scales up with distance so
 * the beam stays readable from a few km.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  ShaderMaterial,
} from 'three';
import type { Camera } from 'three';
import { utmToWorld } from '../../geo';
import type { Origin } from '../../geo';
import type { Portal } from '../contract';

export interface MarkerTerrain {
  surfaceY(x: number, z: number): number;
  toDisplayY(h: number): number;
}

const GOLD = '#ffcf5a';
const BEAM_H = 60;

/** Marker scale for a camera distance (m): 1 up close, grows linearly beyond 250 m, capped at 8. */
export const markerScale = (dist: number): number => Math.min(8, Math.max(1, dist / 250));

/** Display y of the portal ground; NaN while the terrain there is unknown. */
export function portalDisplayY(p: Pick<Portal, 'h'>, x: number, z: number, t: MarkerTerrain): number {
  return p.h !== null ? t.toDisplayY(p.h) : t.surfaceY(x, z);
}

const beamMaterial = () =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying float vH;
      void main() { vH = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying float vH;
      void main() {
        float a = pow(1.0 - vH, 1.6) * (0.55 + 0.15 * sin(uTime * 2.0 - vH * 9.0));
        gl_FragColor = vec4(vec3(1.0, 0.82, 0.38) * a, a);
      }`,
  });

export class PortalMarker {
  readonly group = new Group();
  private readonly ring: Mesh<RingGeometry, MeshBasicMaterial>;
  private readonly beam: Mesh<CylinderGeometry, ShaderMaterial>;
  private readonly x: number;
  private readonly z: number;
  private t = Math.random() * 10;

  constructor(
    readonly portal: Portal,
    origin: Origin,
  ) {
    const w = utmToWorld(portal.E, portal.N, origin);
    this.x = w.x;
    this.z = w.z;
    this.group.name = `zone-portal:${portal.id}`;
    this.group.position.set(w.x, 0, w.z);
    // Grid heading → world yaw (heading 0 = north = −z).
    this.group.rotation.y = (-portal.facing_deg * Math.PI) / 180;

    this.ring = new Mesh(
      new RingGeometry(3.2, 4.2, 64),
      new MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.85, depthWrite: false, blending: AdditiveBlending, side: DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.4;
    this.ring.renderOrder = 5;

    const beamG = new CylinderGeometry(2.6, 3.2, BEAM_H, 32, 1, true);
    beamG.translate(0, BEAM_H / 2, 0);
    this.beam = new Mesh(beamG, beamMaterial());
    this.beam.renderOrder = 6;

    const postG = new BoxGeometry(0.5, 6, 0.5);
    postG.translate(0, 3, 0);
    const postM = new MeshBasicMaterial({ color: '#ffe3a0' });
    const lintelG = new BoxGeometry(9.4, 0.5, 0.5);
    lintelG.translate(0, 6.2, 0);
    // Gate across the facing: posts left/right of the visitor's approach line.
    const gate = new Group();
    for (const s of [-1, 1]) {
      const post = new Mesh(postG, postM);
      post.position.x = s * 4.6;
      gate.add(post);
    }
    gate.add(new Mesh(lintelG, postM));

    this.group.add(this.ring, this.beam, gate);
    this.group.traverse((o) => (o.frustumCulled = false));
  }

  /** Per frame: follow the displayed ground (exaggeration, late chunks), pulse, scale with distance. */
  update(dt: number, camera: Camera, terrain: MarkerTerrain): void {
    const y = portalDisplayY(this.portal, this.x, this.z, terrain);
    this.group.visible = Number.isFinite(y);
    if (!this.group.visible) return;
    this.t += dt;
    this.group.position.y = y;
    const d = Math.hypot(camera.position.x - this.x, camera.position.z - this.z);
    this.group.scale.setScalar(markerScale(d));
    this.ring.material.opacity = 0.6 + 0.3 * Math.sin(this.t * 2.4);
    this.beam.material.uniforms.uTime!.value = this.t;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose();
      (m.material as { dispose?: () => void } | undefined)?.dispose?.();
    });
  }
}
