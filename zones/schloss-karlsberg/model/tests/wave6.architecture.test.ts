// Wave 6 (architecture): KB-I21 Fachwerk, KB-I28 Orangerie, KB-I29 menagerie, interior residuals (chimneypieces,
// faience stove, glass-dressed chandelier).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import { DEFAULT_BUILD_OPTIONS, type BuildContext, makeLayoutFn } from '../src/context.ts';
import { buildExterior } from '../src/exterior/index.ts';
import { CHANDELIER, chandelierPlan } from '../src/interior/chandelier.ts';
import { type HearthKit, chimneypiece, consoleProfile, faienceStove, flutedSection } from '../src/interior/hearth.ts';
import { Bucket } from '../src/interior/mesh.ts';
import { classifyRoom } from '../src/interior/programme.ts';
import { fachwerkStoreys, isFachwerk, outerWall } from '../src/layout/fachwerk.ts';
import { FACHWERK, MENAGERIE, WALL_THICKNESS } from '../src/layout/grammar.ts';
import { distToPolyline, menagerieLayout } from '../src/layout/menagerie.ts';
import { createMaterials } from '../src/materials/index.ts';
import type { EN, MenagerieSpec } from '../src/spec.ts';

const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8'));
const { spec } = loadSite(raw);
const byId = (id: string) => spec.buildings.find((b) => b.id === id)!;
const base = { spec, materials: createMaterials(), terrain: () => NaN, options: { ...DEFAULT_BUILD_OPTIONS, showHypothetical: true }, layout: makeLayoutFn(spec) };
const ctx = (lod: 0 | 1 | 2): BuildContext => ({ ...base, lod });

function meshes(g: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  g.updateMatrixWorld(true);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}
const tris = (ms: THREE.Mesh[]) => ms.reduce((s, m) => s + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0);

describe('KB-I21 Fachwerk', () => {
  it('flags the gallery, the four Wachhäuser and the service upper storeys; masonry elsewhere', () => {
    expect(fachwerkStoreys(byId('KB-B06'))).toEqual([1]);
    for (const id of ['KB-B37', 'KB-B38', 'KB-B63', 'KB-B64']) expect(fachwerkStoreys(byId(id))).toEqual([1]);
    for (const id of ['KB-B24', 'KB-B40', 'KB-B41']) {
      expect(isFachwerk(byId(id), 2)).toBe(true);
      expect(isFachwerk(byId(id), 1)).toBe(false);
    }
    expect(fachwerkStoreys(byId('KB-B01'))).toEqual([]);
    expect(fachwerkStoreys(byId('KB-B10'))).toEqual([]); // the Orangerie stays masonry (research/09 C1)
    for (const b of spec.buildings) if (b.facade?.fachwerk) expect(b.facade.fachwerk.tag).toMatch(/\b(D|I|N)\b/);
  });

  it('outer wall: 0.30 m and a 0.12-0.15 m reveal on Fachwerk storeys, the class wall otherwise', () => {
    const g = outerWall(byId('KB-B06'), 1);
    expect(g).toEqual({ thickness: FACHWERK.wall, reveal: FACHWERK.reveal, fachwerk: true });
    expect(FACHWERK.reveal).toBeGreaterThanOrEqual(0.12);
    expect(FACHWERK.reveal).toBeLessThanOrEqual(0.15);
    expect(outerWall(byId('KB-B06')).fachwerk).toBe(true); // every walled storey is Fachwerk
    const j = byId('KB-B24');
    expect(outerWall(j, 1).thickness).toBe(WALL_THICKNESS[j.cls]);
    expect(outerWall(j, 2).thickness).toBe(0.3);
    expect(outerWall(j).fachwerk).toBe(false); // mixed: the ground-floor wall is masonry
  });

  it('the Orangerie Dachreiter is flagged as a timber frame', () => {
    const t = byId('KB-B10').roof.raised?.[0].turret;
    expect(t?.fachwerk).toBe(true);
  });

  it('the gallery programme uses the 0.30 m wall', () => {
    const rooms = byId('KB-B06').rooms ?? [];
    const L = base.layout(byId('KB-B06'));
    const hall = rooms.find((r) => /bildergalerie/.test(r.id))!;
    const ts = hall.polygon.map((p) => p[1]);
    expect(Math.max(...ts) - Math.min(...ts)).toBeCloseTo(L.frame.width - 2 * FACHWERK.wall, 1);
  });
});

describe('KB-I28 Orangerie', () => {
  it('white joinery on the three wings and the Komödienhaus; no louvred shutters on any Orangerie front (one rule)', () => {
    for (const id of ['KB-B10', 'KB-B11', 'KB-B12', 'KB-B12a']) {
      expect(byId(id).facade.joinery_colour).toBe('#F2F0EA');
      const f = byId(id).facade;
      expect(f.shutter_type ?? (f.shutters ? 'louvred' : 'none')).toBe('none');
    }
  });

  it('KB-B10: portes-fenêtres only on the Saalgeschoss, sill windows on the upper tier of every front', () => {
    const L = base.layout(byId('KB-B10'));
    for (const side of ['garden', 'court', 'end_a', 'end_b'] as const) {
      const up = L.openings.filter((o) => o.side === side && o.storey === 2);
      expect(up.length).toBeGreaterThan(0);
      for (const o of up) expect(o.kind).toBe('window');
    }
    expect(L.openings.filter((o) => o.side === 'court' && o.storey === 1).every((o) => o.kind === 'porte_fenetre')).toBe(true);
  });

  it('LOD2: KB-B10 has no window shutters (only the Dachreiter louvres above the eaves); white window frames', () => {
    const b = byId('KB-B10');
    const ms = meshes(buildExterior(b, ctx(2)));
    const box = new THREE.Box3();
    for (const m of ms.filter((m) => m.userData.material === 'wood.shutter')) box.expandByObject(m);
    if (!box.isEmpty()) expect(box.min.y).toBeGreaterThan(base.layout(b).roof.eaves_h);
    const frames = ms.filter((m) => m.userData.material === 'wood.frame');
    expect(frames.length).toBeGreaterThan(0);
    const c = (frames[0].material as THREE.MeshStandardMaterial).color;
    expect(c.getHexString(THREE.SRGBColorSpace)).toBe('f2f0ea');
  });

  it('Komödienhaus: hypothetical, low confidence, attached to the S wing with a blind N side and a W door', () => {
    const b = byId('KB-B12a');
    expect(b.placement).toBe('hypothetical');
    expect(b.confidence).toBe('low');
    expect(b.court_toward).toBe('KB-B12');
    const L = base.layout(b);
    expect(L.openings.filter((o) => o.side === 'court')).toHaveLength(0);
    expect(L.frame.sides.end_a.normalAzimuth).toBeCloseTo(257.7, 0);
    expect(L.openings.some((o) => o.side === 'end_a' && o.kind === 'door')).toBe(true);
    // sits on the S face of KB-B12 (its N edge within 0.2 m of the wing's S wall line)
    const w = base.layout(byId('KB-B12')).frame.sides.garden;
    const n: EN = [Math.sin((w.normalAzimuth * Math.PI) / 180), Math.cos((w.normalAzimuth * Math.PI) / 180)];
    const wallE = byId('KB-B12').footprint!;
    const distOut = (p: EN) => Math.min(...wallE.map((q) => (p[0] - q[0]) * n[0] + (p[1] - q[1]) * n[1]).filter((x) => x > -0.5));
    const north = b.footprint!.slice(0, 4).map(distOut);
    expect(Math.min(...north)).toBeLessThan(0.2);
  });

  it('the N wing holds the gunsmith and clockmaker workshops next to a plant hall', () => {
    const rooms = byId('KB-B11').rooms ?? [];
    const names = rooms.map((r) => r.name_de);
    expect(names).toContain('Werkstatt des Büchsenmachers');
    expect(names).toContain('Werkstatt des Hofuhrmachers');
    expect(rooms.filter((r) => classifyRoom(r) === 'workshop')).toHaveLength(2);
    expect(rooms.some((r) => classifyRoom(r) === 'orangery')).toBe(true);
  });
});

describe('KB-I29 menagerie layout', () => {
  const ring: MenagerieSpec = { kind: 'ring', ring: { centre: [0, 0], radius: 24.8, houses: 19, loge_azimuth: 0, roof: 'pyramid', cover: 'slate' }, tag: 'test' };

  it('ring: 19 square houses + 1 loge evenly on the circle, each facing the centre, no overlaps', () => {
    const L = menagerieLayout(ring);
    expect(L.houses.filter((h) => h.kind === 'house')).toHaveLength(19);
    expect(L.houses.filter((h) => h.kind === 'loge')).toHaveLength(1);
    for (const h of L.houses) {
      expect(Math.hypot(...h.centre)).toBeCloseTo(24.8, 6);
      // front points at the centre
      expect(h.front[0] * -h.centre[0] + h.front[1] * -h.centre[1]).toBeCloseTo(24.8, 6);
      if (h.kind === 'house') {
        expect(h.width).toBe(h.depth); // square [D T20]
        expect(h.roof).toBe('pyramid');
      }
    }
    const loge = L.houses.find((h) => h.kind === 'loge')!;
    expect(loge.centre[1]).toBeCloseTo(24.8, 6); // azimuth 0 = N
    // neighbours are separated (chord between centres > the larger width)
    for (let i = 0; i < L.houses.length; i++) {
      const a = L.houses[i];
      const b = L.houses[(i + 1) % L.houses.length];
      expect(Math.hypot(a.centre[0] - b.centre[0], a.centre[1] - b.centre[1])).toBeGreaterThan(Math.max(a.width, b.width) + 1);
    }
    // 20 radial partitions + 2 closures behind each yard (wave-6 review: closed yards)
    expect(L.grilles.filter((g) => g.radial)).toHaveLength(20);
    expect(L.grilles).toHaveLength(60);
  });

  it('ring yards are closed: every radial grille meets two closures at its outer end, which end on house back corners', () => {
    const L = menagerieLayout({ ...ring, ring: { ...ring.ring!, moat_radius: 22 } });
    const key = (p: EN) => p.map((v) => v.toFixed(3)).join(',');
    const ends = new Map<string, number>();
    for (const g of L.grilles.filter((g) => !g.radial)) for (const p of [g.a, g.b]) ends.set(key(p), (ends.get(key(p)) ?? 0) + 1);
    for (const g of L.grilles.filter((g) => g.radial)) {
      expect(ends.get(key(g.a))).toBe(2);
      expect(Math.hypot(...g.b)).toBeCloseTo(22, 6); // inner end on the moat edge
    }
    // closure ends that are not grille ends lie on house back corners (distance from the centre r + D/2 at the corner)
    const H = MENAGERIE.ringHouse;
    const cornerR = Math.hypot(24.8 + H.depth / 2, H.width / 2);
    const logeR = Math.hypot(24.8 + MENAGERIE.loge.depth / 2, MENAGERIE.loge.width / 2);
    for (const g of L.grilles.filter((g) => !g.radial)) {
      const r = Math.min(Math.hypot(...g.a), Math.hypot(...g.b));
      expect(Math.min(Math.abs(r - cornerR), Math.abs(r - logeR), Math.abs(r - (24.8 + H.depth / 2)))).toBeLessThan(1e-6);
    }
  });

  it('rows: seeded irregular spacing, never touching; one terrace wall per row on its back line', () => {
    const m: MenagerieSpec = { kind: 'rows', rows: [{ p0: [0, 0], p1: [60, 0], houses: 10 }, { p0: [0, -17], p1: [60, -17], houses: 10 }], front_azimuth: 180, run_depth: 9, tag: 'test' };
    const a = menagerieLayout(m, 7);
    const b = menagerieLayout(m, 7);
    const c = menagerieLayout(m, 8);
    expect(a.houses.map((h) => h.centre)).toEqual(b.houses.map((h) => h.centre)); // deterministic
    expect(a.houses.map((h) => h.centre[0].toFixed(3))).not.toEqual(c.houses.map((h) => h.centre[0].toFixed(3)));
    expect(new Set(a.houses.map((h) => h.width.toFixed(3))).size).toBeGreaterThan(3); // not all identical
    for (const row of [0, -1.5, -18.5]) {
      const hs = a.houses.filter((h) => Math.abs(h.centre[1] - row) < 0.1).sort((p, q) => p.centre[0] - q.centre[0]);
      for (let i = 1; i < hs.length; i++) expect(hs[i].centre[0] - hs[i].width / 2 - (hs[i - 1].centre[0] + hs[i - 1].width / 2)).toBeGreaterThan(0.25);
      for (const h of hs) expect(Math.abs(h.centre[0] - 6 * Math.floor(h.centre[0] / 6) - 3)).toBeLessThanOrEqual(MENAGERIE.rowJitter.shift + 1e-9);
    }
    expect(a.terraces).toHaveLength(2);
    for (const t of a.terraces) expect(t.back[1]).toBeCloseTo(1, 6); // the upper terrace lies behind (N of) a row fronting S
  });

  it('rows: houses front towards front_azimuth, slots on the watercourse stay open, runs and posts in front', () => {
    const m: MenagerieSpec = { kind: 'rows', rows: [{ p0: [0, 0], p1: [60, 0], houses: 10 }], front_azimuth: 180, run_depth: 9, channel: [[30, 20], [30, -30]], tag: 'test' };
    const L = menagerieLayout(m);
    expect(L.houses.length).toBe(8); // the channel runs on the 30 m slot boundary: both slots beside it stay open
    for (const h of L.houses) {
      expect(h.front[1]).toBeCloseTo(-1, 6);
      expect(h.centre[1]).toBeCloseTo(-MENAGERIE.rowHouse.depth / 2, 6);
      expect(distToPolyline(h.centre, m.channel!)).toBeGreaterThan(MENAGERIE.channel.width / 2);
      expect(h.width).toBeLessThanOrEqual(MENAGERIE.rowHouse.width);
    }
    expect(L.runs).toHaveLength(L.houses.length);
    for (const r of L.runs) for (const p of r.ring) expect(p[1]).toBeLessThanOrEqual(-MENAGERIE.rowHouse.depth + 1e-9);
    expect(L.posts.length).toBeGreaterThan(0);
    // shared slot boundaries are kept once
    const keys = L.grilles.map((g) => [g.a, g.b].map((p) => p.map((v) => v.toFixed(2)).join(',')).sort().join('|'));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('island (KL-B41) shows only the documented quay, foundations and stair; the superstructure is the low hypothesis KL-B41a', () => {
    const i = byId('KL-B41');
    expect(i.facade.menagerie?.kind).toBe('island');
    expect(i.roof.type).toBe('none');
    const ms = meshes(buildExterior(i, ctx(2)));
    const box = new THREE.Box3();
    for (const m of ms) box.expandByObject(m);
    const top = i.facade.menagerie!.island!.top_h;
    expect(box.max.y).toBeLessThan(top + MENAGERIE.island.foundationH + MENAGERIE.island.stairRise + 0.5); // no house on it
    expect(box.max.x - box.min.x).toBeGreaterThan(9.9); // the 10 m island, wider than the 8 m foundations
    const a = byId('KL-B41a');
    expect(a.placement).toBe('hypothetical');
    expect(a.confidence).toBe('low');
    expect(a.name_de).toMatch(/Hypothese/);
    expect(a.footprint).toEqual(i.footprint);
    const ma = meshes(buildExterior(a, ctx(1)));
    expect(ma.some((m) => m.userData.material === 'roof.slate')).toBe(true);
    expect(ma.some((m) => m.userData.material === 'render.lime')).toBe(false); // open: no walls
    const hidden = meshes(buildExterior(a, { ...ctx(1), options: { ...base.options, showHypothetical: false } }));
    expect(hidden).toHaveLength(0);
  });

  it('catalogue: KL-B40 is the 19-house slate ring of T20 (H12), KL-B43 rows on the terraces, never Cor-Ten', () => {
    const a = byId('KL-B40');
    expect(a.name_de).not.toMatch(/halbrund/i);
    expect(a.facade.menagerie?.ring?.houses).toBe(19);
    expect(a.facade.menagerie?.ring?.cover).toBe('slate');
    expect((a.sources ?? []).join(' ')).toMatch(/T20/);
    const t = byId('KL-B43');
    expect(t.facade.menagerie?.kind).toBe('rows');
    expect(t.facade.menagerie?.rows?.length).toBeGreaterThanOrEqual(5);
    for (const id of ['KL-B40', 'KL-B41', 'KL-B43']) {
      const f = byId(id).facade;
      expect(`${f.material ?? ''} ${f.content ?? ''} ${f.colour ?? ''}`).not.toMatch(/cor-?ten|rost|rust/i); // modern consolidation stays out
    }
  });

  it('exterior: the ring and the rows replace the enclosure walls, lean at LOD1, finite', () => {
    for (const id of ['KL-B40', 'KL-B43']) {
      const b = byId(id);
      const ms1 = meshes(buildExterior(b, ctx(1)));
      const light = ms1.filter((m) => m.userData.material !== 'metal.iron');
      const L = menagerieLayout(b.facade.menagerie!);
      // block + plinth sleeve + roof per house; LOD1 terrace walls (6 m segments, face + coping) and run ground, channel
      expect(tris(light)).toBeLessThanOrEqual(L.houses.length * 30 + L.runs.length * 4 + L.terraces.length * 70 + 400);
      expect(ms1.some((m) => m.userData.material === 'roof.slate')).toBe(true);
      expect(ms1.some((m) => m.userData.material === 'roof.tile')).toBe(false); // slate rows (wave-6 review)
      for (const m of meshes(buildExterior(b, ctx(2)))) {
        const p = m.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) expect(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))).toBe(true);
      }
    }
  });
});

describe('interior residuals', () => {
  it('chandelier plan: glass-dressed (spears, cage, festoons, drops, basket, finial) inside its envelope', () => {
    const p = chandelierPlan();
    const kinds = new Set(p.glass.map((g) => g.kind));
    expect([...kinds].sort()).toEqual(['bead', 'finial', 'pendeloque', 'spear']);
    expect(p.glass.filter((g) => g.kind === 'pendeloque').length).toBeGreaterThanOrEqual(p.tiers.reduce((s, t) => s + t.n, 0));
    for (const g of p.glass) {
      expect(Math.hypot(g.at[0], g.at[2])).toBeLessThanOrEqual(CHANDELIER.radius);
      expect(g.at[1]).toBeGreaterThanOrEqual(0);
      expect(g.at[1]).toBeLessThanOrEqual(CHANDELIER.height);
    }
    expect(JSON.stringify(chandelierPlan())).toBe(JSON.stringify(p)); // deterministic
  });

  const kit = () => {
    const all: Bucket[] = [];
    const nb = () => {
      const b = new Bucket();
      all.push(b);
      return b;
    };
    const k: HearthKit = {
      marble: () => nb(),
      tint: () => nb(),
      iron: nb(),
      gilt: nb(),
      box: (b, min, max, skip) => b.box(min, max, undefined, skip),
      geo: (b, g, m) => b.geometry(g, m),
    };
    const box = () => {
      const bb = new THREE.Box3();
      for (const b of all) for (let i = 0; i < b.pos.length; i += 3) bb.expandByPoint(new THREE.Vector3(b.pos[i], b.pos[i + 1], b.pos[i + 2]));
      return bb;
    };
    return { k, box, all };
  };

  it('chimneypiece: console jambs, iron fireback and chenets, inside its footprint', () => {
    for (const state of [true, false]) {
      const { k, box } = kit();
      chimneypiece(k, 1.6, 0.4, 1.15, state);
      const bb = box();
      expect(bb.max.y).toBeLessThanOrEqual(1.15 + 0.06);
      expect(bb.min.y).toBeGreaterThanOrEqual(-0.01);
      expect(bb.max.x - bb.min.x).toBeLessThanOrEqual(1.6 + 0.3);
      expect(k.iron.idx.length).toBeGreaterThan(0); // cast-iron fireback
      expect(k.gilt.idx.length).toBeGreaterThan(0); // gilt-bronze mounts and chenets
    }
    const prof = consoleProfile(0, 1, 0.12);
    expect(prof[0][1]).toBe(0);
    expect(prof[prof.length - 1][1]).toBeCloseTo(1, 6);
    expect(Math.max(...prof.map((p) => p[0]))).toBeLessThanOrEqual(0.12 * 1.08 + 1e-9); // the volute block overhangs 8 %
  });

  it('faience column stove: fluted column on a tiled fire box, inside its envelope', () => {
    const { k, box, all } = kit();
    faienceStove(k, 0.9, 0.6, 2.6);
    const bb = box();
    expect(bb.max.y).toBeLessThanOrEqual(2.6 + 0.05);
    expect(bb.max.y).toBeGreaterThan(2.3);
    expect(bb.max.x - bb.min.x).toBeLessThanOrEqual(0.9 + 0.15); // the fire-box cornice projects 7 cm
    expect(all.reduce((s, b) => s + b.idx.length / 3, 0)).toBeLessThan(6000);
    const f = flutedSection(0.2, 16, 0.02);
    expect(f.length).toBeGreaterThan(16 * 2);
    for (const [x, z] of f) expect(Math.hypot(x, z)).toBeLessThanOrEqual(0.2 + 1e-9);
  });
});
