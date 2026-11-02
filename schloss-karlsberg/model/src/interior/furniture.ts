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
import { Bucket, T, cyl } from './mesh.ts';
import { damaskMaterial, interiorMaterial, type Tints } from './materials.ts';
import type { InstancedKind } from './programme.ts';
import { type GlassPiece, chandelierPlan } from './chandelier.ts';

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Instance colour applies (upholstery). */
  colourable?: boolean;
  label: string;
}

type PartSpec = { mat: THREE.Material; colourable?: boolean; label: string; build: (b: Bucket) => void };


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
  const crystal = interiorMaterial(lib, 'interior.crystal');
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
    case 'bergere':
      // KB-I26: Louis-seize bergère (Jacob suite 1782, Antichambre Nr. 8): wide, deep seat with closed upholstered
      // sides, a loose cushion and a rounded back [D existence Redding / Langer 1995 no. 46; form N]
      return [
        {
          mat: gilt,
          label: 'Gestell (vergoldet)',
          build: (b) => {
            legs(b, 0.74, 0.7, 0.36, 0.05);
            b.box([-0.37, 0.34, -0.35], [0.37, 0.42, 0.35]);
            b.box([-0.35, 0.42, -0.35], [0.35, 1.02, -0.3]);
            for (const sx of [-1, 1]) b.box([sx * 0.37 - 0.03, 0.42, -0.3], [sx * 0.37 + 0.03, 0.7, 0.3]);
            for (const sx of [-1, 1]) b.geometry(cyl(0.025, 0.025, 0.08, 6), T(sx * 0.37, 0.72, 0.28));
          },
        },
        {
          mat: silk,
          colourable: true,
          label: 'Bezug (Seide)',
          build: (b) => {
            b.box([-0.33, 0.42, -0.3], [0.33, 0.55, 0.33], undefined, ['-y']);
            b.box([-0.31, 0.55, -0.3], [0.31, 0.97, -0.24]);
            for (const sx of [-1, 1]) b.box([sx * 0.35 - 0.025, 0.47, -0.28], [sx * 0.35 + 0.025, 0.67, 0.26]);
          },
        },
      ];
    case 'curule': {
      // KB-I27, wave-5 review (the X frame with a sling seat read as a modern director's chair): a gilt curule armchair
      // of the Bildergalerie (104, T1 pp. 374 f.): carved, curved X legs front and back crossing at a rosette, lion-paw
      // feet on turned side stretchers, a stuffed seat cushion and a low padded back panel in the gallery's green
      // arabesque damask with a gold fringe at the seat edge [D chairs, damask, fringes; form N after the antique sella
      // curulis]. The back stays under the 0.8 m sills.
      const cover = damaskMaterial(lib, 'wall.silk.crimson', '#ffffff', 'arabesque');
      const W = 0.27; // half width at the seat rail
      const D = 0.2; // half depth (front / back X)
      const leg = (b: Bucket, sz: number, dir: number) => {
        // quadratic curve from the floor foot (x = -dir·W) up to the opposite seat corner, bowed towards the floor
        const P = (t: number): [number, number] => {
          const a: [number, number] = [-dir * W, 0.04];
          const c: [number, number] = [dir * 0.06, 0.1];
          const e: [number, number] = [dir * W, 0.41];
          const u = 1 - t;
          return [u * u * a[0] + 2 * u * t * c[0] + t * t * e[0], u * u * a[1] + 2 * u * t * c[1] + t * t * e[1]];
        };
        const n = 4;
        for (let k = 0; k < n; k++) {
          const [x0, y0] = P(k / n);
          const [x1, y1] = P((k + 1) / n);
          const len = Math.hypot(x1 - x0, y1 - y0) + 0.01;
          const ang = Math.atan2(x1 - x0, y1 - y0);
          const th = 0.026 - 0.006 * (k / n);
          b.box([-th, -len / 2, -0.018], [th, len / 2, 0.018], T((x0 + x1) / 2, (y0 + y1) / 2, sz).multiply(new THREE.Matrix4().makeRotationZ(-ang)));
        }
      };
      return [
        {
          mat: gilt,
          label: 'Gestell (vergoldet, geschnitzt)',
          build: (b) => {
            for (const sz of [-D, D]) {
              leg(b, sz, 1);
              leg(b, sz, -1);
              // rosette at the crossing, paw feet
              b.geometry(cyl(0.035, 0.035, 0.05, 6), T(0, 0.17, sz).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
              for (const sx of [-1, 1]) b.box([sx * W - 0.03, 0, sz - 0.03], [sx * W + 0.03, 0.05, sz + 0.03]);
              // seat rail front / back
              b.box([-W - 0.02, 0.39, sz - 0.022], [W + 0.02, 0.44, sz + 0.022]);
            }
            // turned side stretchers between the feet and the side seat rails
            for (const sx of [-1, 1]) {
              b.geometry(cyl(0.016, 0.016, 2 * D, 5), T(sx * W, 0.05, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
              b.box([sx * W - 0.02, 0.39, -D], [sx * W + 0.02, 0.44, D]);
              // arm: baluster support at the front, a rounded rest back to the back posts
              b.geometry(cyl(0.017, 0.022, 0.2, 6), T(sx * W, 0.53, D - 0.02));
              b.geometry(new THREE.OctahedronGeometry(0.028, 0), T(sx * W, 0.65, D - 0.02));
              b.geometry(cyl(0.016, 0.016, 2 * D - 0.02, 5), T(sx * W, 0.64, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
              // back posts with finials
              b.geometry(cyl(0.02, 0.02, 0.34, 6), T(sx * (W - 0.01), 0.59, -D - 0.005));
              b.geometry(new THREE.OctahedronGeometry(0.02, 0), T(sx * (W - 0.01), 0.778, -D - 0.005));
            }
            // back frame: top rail and a lower rail round the padded panel
            b.box([-W + 0.01, 0.745, -D - 0.025], [W - 0.01, 0.775, -D + 0.015]);
            b.box([-W + 0.01, 0.5, -D - 0.02], [W - 0.01, 0.52, -D + 0.01]);
          },
        },
        {
          mat: cover,
          colourable: true,
          label: 'Bezug (Damast mit Arabesken)',
          build: (b) => {
            // stuffed seat: a squab on the rails, domed on top
            b.box([-W + 0.005, 0.44, -D + 0.005], [W - 0.005, 0.49, D + 0.005], undefined, ['-y']);
            b.geometry(new THREE.SphereGeometry(1, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2), T(0, 0.488, 0.0).multiply(new THREE.Matrix4().makeScale(W - 0.02, 0.035, D - 0.01)));
            // padded back panel between the posts and rails
            b.box([-W + 0.03, 0.52, -D - 0.02], [W - 0.03, 0.745, -D + 0.035]);
          },
        },
        {
          mat: gilt,
          label: 'Goldfransen',
          // fringe round the front and sides of the seat, hanging over the rails
          build: (b) => {
            b.box([-W - 0.02, 0.36, D + 0.012], [W + 0.02, 0.45, D + 0.028]);
            for (const sx of [-1, 1]) b.box([sx * (W + 0.012) - 0.008, 0.36, -D], [sx * (W + 0.012) + 0.008, 0.45, D + 0.028]);
          },
        },
      ];
    }
    case 'chandelier': {
      // Wave-6 interior residual (the wave-5 crown still read as a sparse brass armature): a glass-dressed Louis-seize
      // chandelier after the gallery's documented "20 crystal chandeliers" (T1 pp. 374 f.) and Knigge's chandeliers
      // [D]; form N (interior/chandelier.ts: crown with glass spears, a cage of bead chains, double festoons, almond
      // drops, glass balusters on the stem, a basket down to the finial). The gilt armature is thin and mostly hidden;
      // all glass is one part (no extra draw); wave-6 review fix: the chains are links end to end (stretched
      // tetrahedra along the chain) and every drop hangs from an arm end or a festoon (≈ 270 pieces, ≤ 2,500 triangles in all).
      const plan = chandelierPlan();
      const oct = new THREE.OctahedronGeometry(1, 0);
      // chain beads are ~2 cm: a tetrahedron (4 triangles) reads the same as an octahedron at any walking distance
      const tet = new THREE.TetrahedronGeometry(1, 0);
      const glassPiece = (b: Bucket, g: GlassPiece) => {
        const [x, y, z] = g.at;
        const [sx, sy, sz] = g.size;
        if (g.kind === 'spear') b.geometry(oct, T(x, y + sy / 2, z).multiply(new THREE.Matrix4().makeScale(sx, sy / 2, sz)));
        else if (g.kind === 'pendeloque') b.geometry(oct, T(x, y, z).multiply(new THREE.Matrix4().makeRotationY(Math.atan2(x, z))).multiply(new THREE.Matrix4().makeScale(sx, sy, sz)));
        else if (g.dir) {
          // wave-6 review fix: a chain link, its long axis along the chain (links end to end, chandelier.ts)
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...g.dir));
          // a stretched tetrahedron (a disphenoid: four facets, two crossed ridges) reads as a cut bead at any distance
          b.geometry(tet, T(x, y, z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(q)).multiply(new THREE.Matrix4().makeScale(sx * 1.3, sy, sz * 1.3)));
        } else b.geometry(g.kind === 'bead' ? tet : oct, T(x, y, z).multiply(new THREE.Matrix4().makeScale(sx, sy, sz)));
      };
      const ringGeo = (b: Bucket, r: number, y: number, tube: number) => b.geometry(new THREE.TorusGeometry(r, tube, 3, 12), T(0, y, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
      return [
        {
          mat: gilt,
          label: 'Gestell (vergoldet)',
          build: (b) => {
            b.geometry(cyl(0.014, 0.012, 0.98, 6), T(0, 0.56, 0)); // stem
            b.geometry(cyl(0.1, 0.05, 0.05, 12), T(0, 1.03, 0)); // canopy cup
            ringGeo(b, plan.crown.r, plan.crown.y, 0.008);
            ringGeo(b, plan.ring.r, plan.ring.y, 0.012);
            b.geometry(cyl(0.05, 0.03, 0.04, 10), T(0, plan.ring.y, 0)); // hub of the arm ring
            for (const t of plan.tiers) {
              for (let k = 0; k < t.n; k++) {
                const a = (k * Math.PI * 2) / t.n;
                const R = new THREE.Matrix4().makeRotationY(a);
                // a thin arm from the hub (lower tier: from the arm ring) to a candle nozzle
                const r0 = t === plan.tiers[0] ? plan.ring.r : 0;
                b.box([-0.006, -0.006, r0], [0.006, 0.006, t.r], R.clone().multiply(T(0, t.y, 0)));
                b.geometry(cyl(0.022, 0.018, 0.04, 4), R.clone().multiply(T(0, t.y + 0.025, t.r)));
              }
            }
          },
        },
        {
          mat: candle,
          label: 'Kerzen',
          build: (b) => {
            for (const t of plan.tiers) {
              for (let k = 0; k < t.n; k++) {
                const a = (k * Math.PI * 2) / t.n;
                b.geometry(cyl(0.012, 0.012, 0.13, 4), new THREE.Matrix4().makeRotationY(a).multiply(T(0, t.y + 0.11, t.r)));
              }
            }
          },
        },
        {
          mat: crystal,
          label: 'Behang (Bergkristall, Glas)',
          build: (b) => {
            // glass balusters on the stem (a vase and a ball) and glass drip pans (bobèches)
            b.geometry(new THREE.LatheGeometry([[0.001, 0], [0.04, 0.02], [0.075, 0.09], [0.06, 0.15], [0.025, 0.2], [0.035, 0.24], [0.001, 0.26]].map(([x, y]) => new THREE.Vector2(x, y)), 6), T(0, 0.6, 0));
            b.geometry(oct, T(0, 0.24, 0).multiply(new THREE.Matrix4().makeScale(0.06, 0.07, 0.06)));
            for (const t of plan.tiers) {
              for (let k = 0; k < t.n; k++) {
                const p = [Math.sin((k * Math.PI * 2) / t.n) * t.r, t.y, Math.cos((k * Math.PI * 2) / t.n) * t.r];
                b.geometry(cyl(0.05, 0.04, 0.008, 4), T(p[0], t.y + 0.045, p[2]).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 4)));
              }
            }
            for (const g of plan.glass) glassPiece(b, g);
          },
        },
      ];
    }
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

