/**
 * Low-poly instanced trees (avenue limes, apple trees, chestnuts, forest beech/oak, orange tubs).
 * One InstancedMesh for trunks and one for crowns per species; crowns are jittered icosahedra with per-instance
 * colour variation; deterministic (mulberry32).
 */
import * as THREE from 'three';
import { mulberry32 } from '../layout/geom.ts';

export interface TreeSpecies {
  key: string;
  /** Total height and crown radius (m). */
  height: number;
  crown: number;
  /** Crown vertical stretch (1 = sphere). */
  stretch: number;
  /** Clear trunk height as a fraction of the height. */
  trunkFrac: number;
  leaf: string;
  bark: string;
  detail: 0 | 1;
}

export const SPECIES: Record<string, TreeSpecies> = {
  tilia: { key: 'tilia', height: 6, crown: 2.0, stretch: 1.25, trunkFrac: 0.35, leaf: '#5A7A34', bark: '#4A3F33', detail: 1 },
  malus: { key: 'malus', height: 4, crown: 1.9, stretch: 0.85, trunkFrac: 0.3, leaf: '#66803A', bark: '#4D4034', detail: 1 },
  aesculus: { key: 'aesculus', height: 7, crown: 2.6, stretch: 1.15, trunkFrac: 0.3, leaf: '#4A6B2E', bark: '#463B30', detail: 1 },
  forest: { key: 'forest', height: 24, crown: 6.8, stretch: 1.25, trunkFrac: 0.3, leaf: '#3F5C2E', bark: '#4B4238', detail: 0 },
  citrus: { key: 'citrus', height: 2.2, crown: 0.75, stretch: 1.0, trunkFrac: 0.45, leaf: '#3D5F2A', bark: '#5A4A3A', detail: 0 },
};

/** Species key from a catalogue text such as "Tilia (N)" or "Malus domestica". */
export function speciesFor(text: string | undefined): TreeSpecies {
  const t = (text ?? '').toLowerCase();
  if (t.includes('malus') || t.includes('apfel')) return SPECIES.malus;
  if (t.includes('aesculus') || t.includes('kastanie') || t.includes('chestnut')) return SPECIES.aesculus;
  return SPECIES.tilia;
}

export interface TreeInstance {
  x: number;
  y: number;
  z: number;
  /** Height scale factor. */
  scale?: number;
}

const leafMats = new Map<string, THREE.MeshStandardMaterial>();
function leafMaterial(): THREE.MeshStandardMaterial {
  let m = leafMats.get('leaf');
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92 });
    m.name = 'vegetation.leaf';
    leafMats.set('leaf', m);
  }
  return m;
}
function barkMaterial(): THREE.MeshStandardMaterial {
  let m = leafMats.get('bark');
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 });
    m.name = 'vegetation.bark';
    leafMats.set('bark', m);
  }
  return m;
}

/**
 * Lobed crown (fix round 1: single icosahedra read toy-like): `lobes` jittered icosahedra clustered around the
 * centre, normals blended between lobe and crown centre so the crown shades soft and round. Unit size (radius ~1).
 */
function crownGeometry(sp: TreeSpecies, seed: number): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const lobes = sp.detail ? 5 : 2;
  const pos: number[] = [];
  const nrm: number[] = [];
  for (let l = 0; l < lobes; l++) {
    const ang = (l / lobes) * Math.PI * 2 + rnd() * 0.8;
    const off = l === 0 ? 0 : 0.42 + rnd() * 0.12;
    const c = new THREE.Vector3(Math.cos(ang) * off, (rnd() - 0.4) * 0.35 + (l === 0 ? 0.15 : 0), Math.sin(ang) * off);
    const r = l === 0 ? 0.72 : 0.5 + rnd() * 0.16;
    const g = new THREE.IcosahedronGeometry(r, sp.detail);
    const p = g.attributes.position;
    const jit = new Map<string, number>();
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      if (!jit.has(k)) jit.set(k, 0.86 + rnd() * 0.24);
      const f = jit.get(k)!;
      v.set(p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f).add(c);
      pos.push(v.x, v.y * sp.stretch, v.z);
      const n1 = v.clone().sub(c).normalize();
      const n2 = v.clone().normalize();
      const n = n1.multiplyScalar(0.55).add(n2.multiplyScalar(0.45)).normalize();
      nrm.push(n.x, n.y, n.z);
    }
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return geo;
}

/** Instanced trees of one species at the given positions (local frame, y = ground height). */
export function treeMeshes(sp: TreeSpecies, trees: TreeInstance[], seed = 1789, name = 'trees'): THREE.Group {
  const group = new THREE.Group();
  group.name = `${name}/${sp.key}`;
  if (!trees.length) return group;
  const crownH = sp.height * (1 - sp.trunkFrac);
  const trunkGeo = new THREE.CylinderGeometry(0.12 * (sp.height / 6) ** 0.7, 0.18 * (sp.height / 6) ** 0.7, 1, 6, 1, true);
  trunkGeo.translate(0, 0.5, 0);
  // three crown variants per species, each an InstancedMesh; trees pick one at random
  const VARIANTS = 3;
  const crownGeos = Array.from({ length: VARIANTS }, (_, v) => crownGeometry(sp, seed + v * 7919));
  const pick = mulberry32(seed ^ 0x2545f491);
  const which = trees.map(() => Math.floor(pick() * VARIANTS));
  const trunks = new THREE.InstancedMesh(trunkGeo, barkMaterial(), trees.length);
  const crownsV = crownGeos.map((g, v) => {
    const n = which.filter((w) => w === v).length;
    const im = new THREE.InstancedMesh(g, leafMaterial(), Math.max(1, n));
    im.count = n;
    im.name = `${name}/${sp.key}/crowns${v ? `-${v}` : ''}`;
    return im;
  });
  const fill = crownsV.map(() => 0);
  trunks.name = `${name}/${sp.key}/trunks`;
  const rnd = mulberry32(seed ^ 0x5bd1e995);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  const leaf = new THREE.Color(sp.leaf);
  const bark = new THREE.Color(sp.bark);
  trees.forEach((t, i) => {
    const s = (t.scale ?? 1) * (0.8 + rnd() * 0.4);
    const h = sp.height * s;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
    const trunkTop = h * sp.trunkFrac + crownH * s * 0.25;
    m.compose(new THREE.Vector3(t.x, t.y - 0.2, t.z), q, new THREE.Vector3(s, trunkTop + 0.2, s));
    trunks.setMatrixAt(i, m);
    const cr = sp.crown * s * (0.85 + rnd() * 0.3);
    const cy = t.y + h - (crownH * s) / 2;
    m.compose(new THREE.Vector3(t.x, cy, t.z), q, new THREE.Vector3(cr, (crownH * s) / 2 / sp.stretch, cr));
    const im = crownsV[which[i]];
    const j = fill[which[i]]++;
    im.setMatrixAt(j, m);
    // hue / saturation / lightness variation (fix round 1: uniform dark crowns)
    c.copy(leaf).offsetHSL((rnd() - 0.5) * 0.07, (rnd() - 0.5) * 0.18, (rnd() - 0.35) * 0.14);
    im.setColorAt(j, c);
    trunks.setColorAt(i, bark);
  });
  const crowns = crownsV[0];
  void crowns;
  trunks.castShadow = true;
  trunks.receiveShadow = true;
  trunks.computeBoundingSphere();
  trunks.userData = { part: 'vegetation', species: sp.key };
  group.add(trunks);
  for (const im of crownsV) {
    if (!im.count) continue;
    im.castShadow = im.receiveShadow = true;
    im.computeBoundingSphere();
    im.userData = { part: 'vegetation', species: sp.key };
    group.add(im);
  }
  return group;
}
