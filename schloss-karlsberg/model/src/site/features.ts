/**
 * Terrain features of the residence (catalogue terrain_features): retaining walls of terraces and scarps,
 * avenues (instanced trees via layout avenueTrees), parterre hedges and summer orange tubs, ponds / basins /
 * moats with water at their level, the Große Kaskade, wells. Ground surfaces (gravel, cobbles, lawn) come from
 * the terrain splat (scripts/prepare-terrain.py ground classes), so no extra planes are needed for courts.
 *
 * All geometry in the local frame (x = E − E0, y = h, z = −(N − N0)).
 */
import * as THREE from 'three';
import type { BuildContext } from '../context.ts';
import { E0, N0, gridFrame } from '../frame.ts';
import { hashString, pointInPolygon, polylineLength, pointAlong } from '../layout/geom.ts';
import { avenueTrees } from '../layout/site.ts';
import type { EN, GeoJsonGeometry, SiteSpec, TerrainFeature } from '../spec.ts';
import { GeoBuilder, matKey } from '../exterior/builder.ts';
import { SPECIES, speciesFor, treeMeshes, type TreeInstance } from './trees.ts';
import { type GapStair, type WallPiece, siteEntrances, siteWalls } from './access.ts';

// GeoBuilder works in [s, t, h] with object = (s, h, −t); here s = x and t = −z, so object space = local frame.

function rings(g: GeoJsonGeometry): EN[][] {
  if (g.type === 'Polygon') return [g.coordinates[0] as EN[]];
  return [];
}
function lineOf(g: GeoJsonGeometry): EN[] | null {
  if (g.type === 'LineString') return g.coordinates as EN[];
  return null;
}

/** One retaining-wall piece (access.ts siteWalls): stone body plus a 0.18 m cap. */
function renderPiece(gb: GeoBuilder, p: WallPiece, key: ReturnType<typeof matKey>, cap: ReturnType<typeof matKey>): void {
  const tx = p.x1 - p.x0;
  const tz = p.z1 - p.z0;
  const tl = Math.hypot(tx, tz);
  if (tl < 1e-6) return;
  // oriented box in plan: centre line from (x0, z0) to (x1, z1); GeoBuilder plan coords (s, t) = (x, −z)
  const p0: [number, number] = [p.x0, -p.z0];
  const tan: [number, number] = [tx / tl, -tz / tl];
  const nrm: [number, number] = [tan[1], -tan[0]];
  gb.orientedBox(key, p0, tan, nrm, -0.02, tl + 0.02, -p.thick / 2, p.thick / 2, p.foot, p.top - 0.18);
  gb.orientedBox(cap, p0, tan, nrm, -0.02, tl + 0.02, -p.thick / 2 - 0.06, p.thick / 2 + 0.06, p.top - 0.18, p.top);
}

/** Steps in a terrace-wall gap: a landing where the wall stood, then `steps − 1` treads down to the ground. */
function renderGapStair(gb: GeoBuilder, s: GapStair, key: ReturnType<typeof matKey>): void {
  const p0: [number, number] = [s.x, -s.z];
  const tan: [number, number] = [s.dir[0], -s.dir[1]];
  const nrm: [number, number] = [tan[1], -tan[0]];
  const bottom = s.ground - 0.3;
  gb.orientedBox(key, p0, tan, nrm, -0.4, 0, -s.width / 2, s.width / 2, bottom, s.top);
  for (let k = 1; k < s.steps; k++) gb.orientedBox(key, p0, tan, nrm, (k - 1) * s.tread, k * s.tread, -s.width / 2, s.width / 2, bottom, s.top - k * s.riser);
}

function ringLocal(r: EN[]): [number, number][] {
  return r.map(([E, N]) => [E - E0, -(N - N0)]);
}

/** Flat water surface over a polygon at height h. */
function waterPlane(r: EN[], h: number, mat: THREE.Material, name: string): THREE.Mesh {
  const pts = ringLocal(r).map(([x, z]) => new THREE.Vector2(x, -z));
  const shape = new THREE.Shape(pts);
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2); // (x, y) -> (x, 0, -y): -y = z
  geo.translate(0, h, 0);
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.receiveShadow = true;
  m.userData = { part: 'water' };
  return m;
}

export function buildFeatures(spec: SiteSpec, ctx: BuildContext): { group: THREE.Group; colliders: THREE.Mesh[] } {
  const group = new THREE.Group();
  group.name = 'site/features';
  const colliders: THREE.Mesh[] = [];
  const gb = new GeoBuilder();
  const terr = ctx.terrain;
  const wallK = matKey('stone.red', '#A65E4A');
  const capK = matKey('stone.grey', '#BDBAB2');
  const water = ctx.materials.get('water');
  const trees: Record<string, TreeInstance[]> = {};
  const addTree = (key: string, x: number, z: number, scale = 1) => {
    const y = terr(x, z);
    if (!Number.isFinite(y)) return;
    (trees[key] ??= []).push({ x, y, z, scale });
  };

  // avenue trees stop at courts, terraces, parterres and buildings (+3 m)
  const blockers: EN[][] = [];
  for (const f of spec.terrain_features) if (f.kind === 'court' || f.kind === 'terrace' || f.kind === 'parterre') blockers.push(...rings(f.geometry));
  for (const b of spec.buildings) if (b.footprint && b.base_h !== null) blockers.push(b.footprint);
  const blocked = (E: number, N: number) =>
    blockers.some((r) => [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]].some(([dx, dy]) => pointInPolygon([E + dx, N + dy], r)));

  const walls = siteWalls(spec, terr, siteEntrances(spec, ctx));
  for (const f of spec.terrain_features) {
    try {
      buildFeature(f);
    } catch (e) {
      console.warn(`[features] ${f.id}`, e);
    }
  }

  function buildFeature(f: TerrainFeature): void {
    switch (f.kind) {
      case 'terrace':
      case 'scarp': {
        // retaining walls (+ gap stairs at Durchfahrten) come from access.ts so walk starts see the same walls
        for (const p of walls.pieces) if (p.featureId === f.id) renderPiece(gb, p, wallK, capK);
        for (const st of walls.stairs) if (st.featureId === f.id) renderGapStair(gb, st, capK);
        return;
      }
      case 'avenue': {
        const line = lineOf(f.geometry);
        if (!line || !f.trees) return;
        const sp = speciesFor(f.trees.species);
        const h = f.trees.height ?? sp.height;
        for (const p of avenueTrees(line, f.trees, { seed: hashString(f.id) ^ ctx.options.seed })) {
          if (blocked(p.E, p.N)) continue;
          addTree(sp.key, p.E - E0, -(p.N - N0), h / sp.height);
        }
        return;
      }
      case 'parterre': {
        // fix round 1: compartments laid out in the palace grid (u along the Ehrenhof / CdL axis), centred on the
        // axis v = 0 when the parterre spans it, hedges clipped to the polygon [pattern I/U, research/05]
        const grid = gridFrame(spec.palace_grid);
        const hedge = matKey('ground.grass', '#3E5A2A');
        for (const r of rings(f.geometry)) {
          const uv = r.map(([E, N]) => grid.toUV(E, N));
          const u0 = Math.min(...uv.map((p) => p[0]));
          const u1 = Math.max(...uv.map((p) => p[0]));
          const v0 = Math.min(...uv.map((p) => p[1]));
          const v1 = Math.max(...uv.map((p) => p[1]));
          const vAxis = v0 < -5 && v1 > 5 ? 0 : (v0 + v1) / 2;
          const uMid = (u0 + u1) / 2;
          const walk = 2.5; // half width of the axis walks [N]
          const border = 1.2; // perimeter walk [N]
          const inside = (u: number, v: number) => {
            const [E, N] = grid.toEN(u, v);
            return pointInPolygon([E, N], r);
          };
          const compartments: [number, number, number, number][] = [
            [u0 + border, uMid - walk, v0 + border, vAxis - walk],
            [u0 + border, uMid - walk, vAxis + walk, v1 - border],
            [uMid + walk, u1 - border, v0 + border, vAxis - walk],
            [uMid + walk, u1 - border, vAxis + walk, v1 - border],
          ];
          const tubs: [number, number][] = [];
          for (const [a0, a1, b0, b1] of compartments) {
            if (a1 - a0 < 2 || b1 - b0 < 2) continue;
            const corners: [number, number][] = [[a0, b0], [a1, b0], [a1, b1], [a0, b1], [a0, b0]];
            for (let i = 1; i < corners.length; i++) {
              const [ua, va] = corners[i - 1];
              const [ub, vb] = corners[i];
              const len = Math.hypot(ub - ua, vb - va);
              const n = Math.max(1, Math.ceil(len / 3));
              for (let k = 0; k < n; k++) {
                const pa: [number, number] = [ua + ((ub - ua) * k) / n, va + ((vb - va) * k) / n];
                const pb: [number, number] = [ua + ((ub - ua) * (k + 1)) / n, va + ((vb - va) * (k + 1)) / n];
                if (!inside(pa[0], pa[1]) || !inside(pb[0], pb[1])) continue; // clip to the polygon
                const [Ea, Na] = grid.toEN(pa[0], pa[1]);
                const [Eb, Nb] = grid.toEN(pb[0], pb[1]);
                hedgeSeg(Ea - E0, -(Na - N0), Eb - E0, -(Nb - N0), f.level);
              }
              // tubs along the inner walks, every 5 m
              for (let k = 1; k < Math.floor(len / 5); k++) tubs.push([ua + ((ub - ua) * k * 5) / len, va + ((vb - va) * k * 5) / len]);
            }
          }
          function hedgeSeg(x0: number, z0: number, x1: number, z1: number, level?: number) {
            const tx = x1 - x0;
            const tz = z1 - z0;
            const tl = Math.hypot(tx, tz);
            if (tl < 0.05) return;
            const ty = terr((x0 + x1) / 2, (z0 + z1) / 2);
            const y = Number.isFinite(ty) ? ty : level;
            if (y === undefined || !Number.isFinite(y)) return;
            const tan: [number, number] = [tx / tl, -tz / tl];
            gb.orientedBox(hedge, [x0, -z0], tan, [tan[1], -tan[0]], 0, tl, -0.22, 0.22, y - 0.1, y + 0.45);
          }
          // summer orange tubs on the Orangerie parterre [D "Kübelpflanzen im Sommer"]
          if (/kübel|orang/i.test(f.name + ' ' + (f.surface ?? ''))) {
            const tub = matKey('wood.shutter', '#2F4F3A');
            for (const [u, v] of tubs) {
              if (!inside(u, v)) continue;
              const [E, N] = grid.toEN(u, v);
              const x = E - E0;
              const z = -(N - N0);
              const y = terr(x, z);
              if (!Number.isFinite(y)) continue;
              gb.box(tub, x - 0.35, x + 0.35, -z - 0.35, -z + 0.35, y - 0.05, y + 0.6);
              addTree('citrus', x, z);
            }
          }
        }
        return;
      }
      case 'pond':
      case 'moat': {
        for (const r of rings(f.geometry)) {
          let h = f.water_level;
          if (h === undefined) {
            // lowest terrain inside + 0.4 m
            let m = Infinity;
            for (const [x, z] of ringLocal(r)) m = Math.min(m, terr(x, z));
            h = Number.isFinite(m) ? m + 0.4 : undefined;
          }
          if (h === undefined) continue;
          group.add(waterPlane(r, h, water, `feature/${f.id}`));
        }
        return;
      }
      case 'cascade': {
        const line = lineOf(f.geometry);
        if (!line || f.top === undefined || f.foot === undefined) return;
        const n = f.steps?.count ?? 10;
        const w = f.width ?? 10;
        const len = polylineLength(line);
        // line runs foot -> top or top -> foot: orient by terrain
        const pA = line[0];
        const pB = line[line.length - 1];
        const hA = terr(pA[0] - E0, -(pA[1] - N0));
        const hB = terr(pB[0] - E0, -(pB[1] - N0));
        const fromFoot = !(hA > hB);
        const stone = matKey('stone.grey', '#B9B2A4');
        for (let i = 0; i < n; i++) {
          const d0 = (len * i) / n;
          const d1 = (len * (i + 1)) / n;
          const { p, dir } = pointAlong(line, (d0 + d1) / 2);
          const along = fromFoot ? i : n - 1 - i;
          const top = f.foot + ((f.top - f.foot) * (along + 1)) / n;
          const x = p[0] - E0;
          const z = -(p[1] - N0);
          const tan: [number, number] = [dir[0], dir[1]];
          const nrm: [number, number] = [tan[1], -tan[0]];
          const half = (d1 - d0) / 2;
          gb.orientedBox(stone, [x - tan[0] * half, -z - tan[1] * half], tan, nrm, 0, 2 * half, -w / 2 - 0.6, w / 2 + 0.6, top - (f.top - f.foot) / n - 1.5, top - 0.25);
          // side walls
          gb.orientedBox(stone, [x - tan[0] * half, -z - tan[1] * half], tan, nrm, 0, 2 * half, -w / 2 - 0.6, -w / 2, top - 0.25, top + 0.5);
          gb.orientedBox(stone, [x - tan[0] * half, -z - tan[1] * half], tan, nrm, 0, 2 * half, w / 2, w / 2 + 0.6, top - 0.25, top + 0.5);
          // water sheet on the tread
          gb.orientedBox(matKey('water'), [x - tan[0] * half, -z - tan[1] * half], tan, nrm, 0.02, 2 * half - 0.02, -w / 2, w / 2, top - 0.25, top - 0.17);
        }
        return;
      }
      case 'well': {
        const pts: EN[] = f.geometry.type === 'MultiPoint' ? (f.geometry.coordinates as EN[]) : f.geometry.type === 'Point' ? [f.geometry.coordinates as EN] : rings(f.geometry).map(centroidEN);
        for (const [E, N] of pts) {
          const x = E - E0;
          const z = -(N - N0);
          const y = terr(x, z);
          if (!Number.isFinite(y)) continue;
          const n = 10;
          for (let k = 0; k < n; k++) {
            const a0 = (k / n) * Math.PI * 2;
            const a1 = ((k + 1) / n) * Math.PI * 2;
            const r = 1.0;
            const p0: [number, number] = [x + r * Math.cos(a0), -z + r * Math.sin(a0)];
            const tl = 2 * r * Math.sin(Math.PI / n);
            const tan: [number, number] = [Math.cos((a0 + a1) / 2 + Math.PI / 2), Math.sin((a0 + a1) / 2 + Math.PI / 2)];
            gb.orientedBox(wallK, p0, tan, [tan[1], -tan[0]], 0, tl, -0.25, 0.05, y - 0.3, y + 0.8);
          }
        }
        return;
      }
      default:
        return;
    }
  }

  const meshes = gb.toMeshes(ctx.materials, 'site/features', { part: 'feature', lod: ctx.lod });
  for (const m of meshes) {
    group.add(m);
    if (!/water|grass/.test(m.name)) {
      m.userData.collider = true;
      colliders.push(m);
    }
  }
  for (const [key, list] of Object.entries(trees)) {
    const sp = SPECIES[key];
    if (sp) group.add(treeMeshes(sp, list, hashString(key) ^ ctx.options.seed, 'site/trees'));
  }
  return { group, colliders };
}

function centroidEN(r: EN[]): EN {
  let x = 0;
  let y = 0;
  for (const p of r) {
    x += p[0];
    y += p[1];
  }
  return [x / r.length, y / r.length];
}
