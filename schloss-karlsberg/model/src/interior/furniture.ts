/**
 * Instanced furniture: low-poly period prototypes (Louis-seize forms after the Jacob / Dugourc
 * seating of research/01 §3.2 - shapes are period norm N, not copies of surviving pieces).
 * One InstancedMesh per prototype part and material; instance i carries
 * `userData.instances[i] = { roomId, name_de, evidence, tag }` for the info panel (mesh-level
 * roomId is "*" when the instances span several rooms).
 *
 * Local prototype frame: X = width, Y = up, Z = depth with the front at +Z, origin at the
 * centre of the footprint on the floor (hung pieces: at their bottom).
 */
import * as THREE from 'three';
import type { MaterialLibrary } from '../context.ts';
import { Bucket } from './mesh.ts';
import { interiorMaterial, type Tints } from './materials.ts';
import type { InstancedKind } from './programme.ts';

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Instance colour applies (upholstery). */
  colourable?: boolean;
  label: string;
}

type PartSpec = { mat: THREE.Material; colourable?: boolean; label: string; build: (b: Bucket) => void };

const cyl = (r0: number, r1: number, h: number, seg = 8) => new THREE.CylinderGeometry(r1, r0, h, seg, 1, false);
const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);

function legs(b: Bucket, w: number, d: number, h: number, t = 0.045, inset = 0.03): void {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.geometry(cyl(t * 0.55, t * 0.75, h, 6), T(sx * (w / 2 - inset - t / 2), h / 2, sz * (d / 2 - inset - t / 2)));
}

function seat(gilt: THREE.Material, silk: THREE.Material, w: number, d: number, arms: boolean, backH: number): PartSpec[] {
  return [
    {
      mat: gilt,
      label: 'Gestell (vergoldet)',
      build: (b) => {
        legs(b, w, d, 0.4);
        b.box([-w / 2, 0.38, -d / 2], [w / 2, 0.44, d / 2]);
        b.box([-w / 2 + 0.02, 0.44, -d / 2], [w / 2 - 0.02, 0.44 + backH, -d / 2 + 0.05]);
        if (arms) {
          for (const sx of [-1, 1]) {
            b.box([sx * (w / 2) - 0.025, 0.62, -d / 2 + 0.05], [sx * (w / 2) + 0.025, 0.66, d / 2 - 0.08]);
            b.box([sx * (w / 2) - 0.02, 0.44, d / 2 - 0.12], [sx * (w / 2) + 0.02, 0.64, d / 2 - 0.08]);
          }
        }
      },
    },
    {
      mat: silk,
      colourable: true,
      label: 'Bezug (Seide)',
      build: (b) => {
        b.box([-w / 2 + 0.03, 0.44, -d / 2 + 0.05], [w / 2 - 0.03, 0.5, d / 2 - 0.02], undefined, ['-y']);
        b.box([-w / 2 + 0.07, 0.52, -d / 2 + 0.05], [w / 2 - 0.07, 0.44 + backH - 0.06, -d / 2 + 0.07], undefined, ['-z']);
      },
    },
  ];
}

export function prototypeParts(kind: InstancedKind, lib: MaterialLibrary, tints: Tints): PartSpec[] {
  const gilt = lib.get('metal.gilt');
  const silk = tints.get('wall.silk.crimson', '#ffffff');
  const marble = lib.get('stone.marble');
  const wood = tints.get('wood.door', '#6b4126');
  const glass = lib.get('glass.crown');
  const candle = interiorMaterial(lib, 'interior.candle');
  switch (kind) {
    case 'fauteuil':
      return seat(gilt, silk, 0.64, 0.58, true, 0.58);
    case 'chaise':
      return seat(gilt, silk, 0.48, 0.48, false, 0.5);
    case 'canape':
      return seat(gilt, silk, 1.9, 0.72, true, 0.6);
    case 'tabouret':
      return [
        { mat: gilt, label: 'Gestell', build: (b) => legs(b, 0.5, 0.4, 0.4) },
        { mat: silk, colourable: true, label: 'Bezug', build: (b) => b.box([-0.25, 0.38, -0.2], [0.25, 0.48, 0.2], undefined, ['-y']) },
      ];
    case 'bench':
      return [
        {
          mat: gilt,
          label: 'Gestell',
          build: (b) => {
            legs(b, 1.6, 0.48, 0.36, 0.05);
            b.geometry(cyl(0.025, 0.035, 0.36, 6), T(0, 0.18, 0.2));
            b.geometry(cyl(0.025, 0.035, 0.36, 6), T(0, 0.18, -0.2));
            b.box([-0.8, 0.34, -0.24], [0.8, 0.4, 0.24]);
          },
        },
        { mat: silk, colourable: true, label: 'Polster', build: (b) => b.box([-0.78, 0.4, -0.22], [0.78, 0.5, 0.22], undefined, ['-y']) },
      ];
    case 'stool':
      return [
        {
          mat: tints.get('wood.door', '#8a6a44'),
          label: 'Schemel',
          build: (b) => {
            legs(b, 0.36, 0.36, 0.44, 0.04);
            b.box([-0.19, 0.44, -0.19], [0.19, 0.48, 0.19]);
          },
        },
      ];
    case 'console':
      return [
        {
          mat: gilt,
          label: 'Gestell (vergoldet)',
          build: (b) => {
            for (const sx of [-1, 1]) b.geometry(cyl(0.025, 0.045, 0.78, 6), T(sx * 0.5, 0.39, 0.12));
            b.box([-0.58, 0.72, -0.22], [0.58, 0.84, 0.22]);
            b.box([-0.5, 0.06, -0.2], [0.5, 0.1, 0.16]);
          },
        },
        { mat: marble, label: 'Marmorplatte', build: (b) => b.box([-0.62, 0.84, -0.25], [0.62, 0.885, 0.25]) },
      ];
    case 'gueridon':
      return [
        {
          mat: gilt,
          label: 'Fuß',
          build: (b) => {
            b.geometry(cyl(0.03, 0.05, 0.7, 8), T(0, 0.38, 0));
            for (let k = 0; k < 3; k++) {
              const a = (k * Math.PI * 2) / 3;
              b.box([-0.025, 0, 0], [0.025, 0.06, 0.28], new THREE.Matrix4().makeRotationY(a));
            }
          },
        },
        { mat: marble, label: 'Platte', build: (b) => b.geometry(cyl(0.36, 0.36, 0.04, 16), T(0, 0.74, 0)) },
      ];
    case 'globe':
      return [
        {
          mat: wood,
          label: 'Gestell',
          build: (b) => {
            legs(b, 0.6, 0.6, 0.62, 0.05);
            b.geometry(new THREE.TorusGeometry(0.33, 0.025, 4, 16).rotateX(Math.PI / 2), T(0, 0.64, 0));
          },
        },
        { mat: tints.get('ceiling.stucco', '#c9b98a'), label: 'Globus', build: (b) => b.geometry(new THREE.SphereGeometry(0.3, 14, 10), T(0, 0.82, 0)) },
      ];
    case 'orange_tub':
      return [
        {
          mat: tints.get('wood.shutter', '#3f5d3a'),
          label: 'Kübel (caisse de Versailles)',
          build: (b) => {
            b.box([-0.36, 0, -0.36], [0.36, 0.7, 0.36], undefined, ['-y']);
            for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box([sx * 0.36 - 0.05, 0, sz * 0.36 - 0.05], [sx * 0.36 + 0.05, 0.82, sz * 0.36 + 0.05]);
          },
        },
        { mat: tints.get('wood.door', '#5a4630'), label: 'Stamm', build: (b) => b.geometry(cyl(0.05, 0.04, 1.1, 6), T(0, 1.2, 0)) },
        { mat: tints.get('ground.grass', '#3d5a2a'), label: 'Krone', build: (b) => b.geometry(new THREE.IcosahedronGeometry(0.62, 1), T(0, 2.1, 0)) },
      ];
    case 'chandelier':
      return [
        {
          mat: gilt,
          label: 'Gestell (vergoldet)',
          build: (b) => {
            b.geometry(cyl(0.05, 0.05, 1.0, 8), T(0, 0.55, 0));
            b.geometry(new THREE.SphereGeometry(0.11, 10, 6), T(0, 0.25, 0));
            for (const [r, y, n] of [
              [0.46, 0.38, 8],
              [0.28, 0.72, 6],
            ] as [number, number, number][]) {
              for (let k = 0; k < n; k++) {
                const a = (k * Math.PI * 2) / n;
                const m = new THREE.Matrix4().makeRotationY(a).multiply(T(0, y, 0));
                b.box([-0.012, -0.012, 0], [0.012, 0.012, r], m);
                b.geometry(cyl(0.035, 0.03, 0.03, 6), new THREE.Matrix4().makeRotationY(a).multiply(T(0, y + 0.02, r)));
              }
            }
          },
        },
        {
          mat: candle,
          label: 'Kerzen',
          build: (b) => {
            for (const [r, y, n] of [
              [0.46, 0.38, 8],
              [0.28, 0.72, 6],
            ] as [number, number, number][]) {
              for (let k = 0; k < n; k++) {
                const a = (k * Math.PI * 2) / n;
                b.geometry(cyl(0.013, 0.013, 0.13, 5), new THREE.Matrix4().makeRotationY(a).multiply(T(0, y + 0.1, r)));
              }
            }
          },
        },
        {
          mat: glass,
          label: 'Behang (Bergkristall)',
          build: (b) => {
            for (let k = 0; k < 16; k++) {
              const a = (k * Math.PI * 2) / 16;
              b.geometry(new THREE.OctahedronGeometry(0.03, 0), new THREE.Matrix4().makeRotationY(a).multiply(T(0, 0.3 - (k % 2) * 0.05, 0.4)));
            }
            b.geometry(new THREE.OctahedronGeometry(0.07, 0), T(0, 0.08, 0));
          },
        },
      ];
    case 'lantern':
      return [
        {
          mat: gilt,
          label: 'Laternengestell',
          build: (b) => {
            for (let k = 0; k < 6; k++) {
              const a = (k * Math.PI) / 3;
              b.box([-0.015, 0.1, 0.33], [0.015, 0.95, 0.36], new THREE.Matrix4().makeRotationY(a));
            }
            b.geometry(cyl(0.38, 0.38, 0.06, 6), T(0, 0.98, 0));
            b.geometry(cyl(0.38, 0.06, 0.25, 6), T(0, 1.13, 0));
            b.geometry(cyl(0.3, 0.38, 0.06, 6), T(0, 0.08, 0));
            b.geometry(cyl(0.02, 0.02, 1.2, 6), T(0, 1.8, 0));
          },
        },
        { mat: glass, label: 'Glas', build: (b) => b.geometry(cyl(0.34, 0.34, 0.85, 6, ), T(0, 0.53, 0)) },
        { mat: candle, label: 'Kerzen', build: (b) => b.geometry(cyl(0.03, 0.03, 0.3, 6), T(0, 0.3, 0)) },
      ];
  }
}

export interface InstanceInfo {
  roomId: string;
  name_de: string;
  evidence: string;
  tag: string;
}

/** Collects instances per prototype, builds InstancedMeshes at the end. */
export class InstanceRegistry {
  private items = new Map<InstancedKind, { m: THREE.Matrix4; colour?: string; info: InstanceInfo }[]>();
  constructor(
    private buildingId: string,
    private lib: MaterialLibrary,
    private tints: Tints,
  ) {}

  add(kind: InstancedKind, m: THREE.Matrix4, info: InstanceInfo, colour?: string): void {
    const arr = this.items.get(kind) ?? [];
    arr.push({ m, colour, info });
    this.items.set(kind, arr);
  }

  count(): number {
    let n = 0;
    for (const v of this.items.values()) n += v.length;
    return n;
  }

  meshes(): THREE.InstancedMesh[] {
    const out: THREE.InstancedMesh[] = [];
    for (const [kind, list] of this.items) {
      const parts: Part[] = prototypeParts(kind, this.lib, this.tints).map((p) => {
        const b = new Bucket();
        p.build(b);
        return { geometry: b.toGeometry(), material: p.mat, colourable: p.colourable, label: p.label };
      });
      for (const part of parts) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        im.name = `${this.buildingId}/interior/furniture/${kind}/${part.label}`;
        list.forEach((it, i) => {
          im.setMatrixAt(i, it.m);
          if (part.colourable) im.setColorAt(i, new THREE.Color(it.colour ?? '#c9b27c'));
        });
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.computeBoundingBox();
        im.computeBoundingSphere();
        const first = list[0].info;
        im.userData = {
          buildingId: this.buildingId,
          part: 'interior/furniture',
          lod: 2,
          collider: false,
          kind,
          name_de: first.name_de,
          evidence: first.evidence,
          tag: first.tag,
          // several rooms share one InstancedMesh: '*' = see instances[instanceId].roomId
          roomId: list.every((x) => x.info.roomId === first.roomId) ? first.roomId : '*',
          instances: list.map((x) => x.info),
        };
        out.push(im);
      }
    }
    return out;
  }
}

