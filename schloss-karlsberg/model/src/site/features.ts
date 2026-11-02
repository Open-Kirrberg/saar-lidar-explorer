/**
 * Terrain features of the residence (catalogue terrain_features): retaining walls of terraces and scarps,
 * avenues (instanced trees via layout avenueTrees), parterre hedges and summer orange tubs, ponds / basins /
 * moats with water at their level, the Große Kaskade, wells, and the Ehrenhof furniture (court.ts, KB-I23). Ground surfaces (gravel, cobbles, lawn) come from
 * the terrain splat (scripts/prepare-terrain.py ground classes), so no extra planes are needed for courts.
 *
 * All geometry in the local frame (x = E − E0, y = h, z = −(N − N0)).
 */
import * as THREE from 'three';
import type { BuildContext } from '../context.ts';
import { E0, N0, gridFrame } from '../frame.ts';
import { type P2, hashString, pointInPolygon, polylineLength, pointAlong } from '../layout/geom.ts';
import { avenueBlockers, basinOrnaments, clumpPlants, distanceToLine, edgePieces, singleTrees, treeBlocked, walkRibbon } from '../layout/garden.ts';
import { ARTICULATION, COURT_FURNITURE, FENCE, GARDEN } from '../layout/grammar.ts';
import { stToEN } from '../layout/footprint.ts';
import { avenueTrees } from '../layout/site.ts';
import type { EN, GeoJsonGeometry, SiteSpec, TerrainFeature } from '../spec.ts';
import { GeoBuilder, matKey } from '../exterior/builder.ts';
import { SPECIES, speciesFor, treeMeshes, type TreeInstance } from './trees.ts';
import { type GapStair, type WallPiece, siteBuildings, siteEntrances, siteFeatures, siteWalls } from './access.ts';
import { buildCourtFurniture } from './court.ts';
import { type GardenDetailEnv, buildAngloise, buildBeds, buildFurniture, buildTreillage, extrudeHedge } from './gardenDetail.ts';
import { hedgeProfile } from './hedgeProfile.ts';
import { barriereLayout, postRailLayout } from './fence.ts';
import { edgeStonePlan, isTroddenPath, outcropPlan, outcropShape, pathWidthFactor, smoothNoise1 } from './rockPath.ts';
import { waterPatch } from '../materials/index.ts';
import { jetSpray, wetBank } from './water.ts';
import { SHORE, type ShoreMesh, naturalShore, shoreWater } from './shore.ts';
import { type DriveWall, clipOutsideDrives, driveCoords, driveFrame, driveWalls, isDrapedWay, isDrive } from './drive.ts';

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

/**
 * Wave-9 review fix: a flanking wall piece of a graded drive (drive.ts): body and coping slope with the drive, so the
 * pieces join without steps. Box [0, len] × [−thick/2, thick/2] with a sloping top (top0 → top1).
 */
function renderDriveWall(gb: GeoBuilder, w: DriveWall, key: ReturnType<typeof matKey>, cap: ReturnType<typeof matKey>): void {
  const tx = w.x1 - w.x0;
  const tz = w.z1 - w.z0;
  const tl = Math.hypot(tx, tz);
  if (tl < 1e-6) return;
  const tan: [number, number] = [tx / tl, -tz / tl];
  const nrm: [number, number] = [tan[1], -tan[0]];
  const box = (k: ReturnType<typeof matKey>, d0: number, d1: number, lo0: number, lo1: number, hi0: number, hi1: number, a0 = -0.02, a1 = tl + 0.02) => {
    const P = (a: number, d: number, h: number): P3 => [w.x0 + tan[0] * a + nrm[0] * d, -w.z0 + tan[1] * a + nrm[1] * d, h];
    const lo = (a: number) => lo0 + ((lo1 - lo0) * (a - a0)) / (a1 - a0);
    const hi = (a: number) => hi0 + ((hi1 - hi0) * (a - a0)) / (a1 - a0);
    const out: P3 = [nrm[0], nrm[1], 0];
    const inn: P3 = [-nrm[0], -nrm[1], 0];
    gb.quadFacing(k, P(a0, d1, lo(a0)), P(a1, d1, lo(a1)), P(a1, d1, hi(a1)), P(a0, d1, hi(a0)), out);
    gb.quadFacing(k, P(a0, d0, lo(a0)), P(a1, d0, lo(a1)), P(a1, d0, hi(a1)), P(a0, d0, hi(a0)), inn);
    gb.quadFacing(k, P(a0, d0, hi(a0)), P(a1, d0, hi(a1)), P(a1, d1, hi(a1)), P(a0, d1, hi(a0)), [0, 0, 1]);
    gb.quadFacing(k, P(a0, d0, lo(a0)), P(a0, d1, lo(a0)), P(a0, d1, hi(a0)), P(a0, d0, hi(a0)), [-tan[0], -tan[1], 0]);
    gb.quadFacing(k, P(a1, d0, lo(a1)), P(a1, d1, lo(a1)), P(a1, d1, hi(a1)), P(a1, d0, hi(a1)), [tan[0], tan[1], 0]);
  };
  box(key, -w.thick / 2, w.thick / 2, w.foot, w.foot, w.top0 - 0.18, w.top1 - 0.18);
  box(cap, -w.thick / 2 - 0.06, w.thick / 2 + 0.06, w.top0 - 0.18, w.top1 - 0.18, w.top0, w.top1);
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
  // trees grouped by species + stakes + confidence group (hypothetical features' trees go to a 'low' group the viewer
  // can hide with its low-confidence select, KB-I12)
  const trees = new Map<string, { key: string; stakes: number; low: boolean; list: TreeInstance[] }>();
  const addTree = (key: string, x: number, z: number, scale = 1, stakes = 0, low = false, yAt?: number) => {
    const y = yAt ?? terr(x, z);
    if (!Number.isFinite(y)) return;
    const k = `${key}|${stakes}|${low ? 1 : 0}`;
    let e = trees.get(k);
    if (!e) trees.set(k, (e = { key, stakes, low, list: [] }));
    e.list.push({ x, y, z, scale });
  };

  // only what stands in the scene year (KB-I03): an absent 1785 rotunda blocks nothing; hypothetical features
  // (KB-I12) only when the option shows them
  const year = ctx.options.year;
  const feats = siteFeatures(spec, year).filter((f) => f.placement !== 'hypothetical' || ctx.options.showHypothetical);
  // avenue trees stop at courts, terraces, parterres, ponds and buildings (+3 m); hypothetical avenues also at lawns
  const blockersFor = (f: TerrainFeature) => avenueBlockers(spec, f, year);

  const walls = siteWalls(spec, terr, siteEntrances(spec, ctx), year);
  // wave 5 garden detail (gardenDetail.ts): parterres à l'angloise, treillage, tubs, furniture, kitchen beds
  // own builder, so the wave-5 garden detail is its own set of meshes (site/garden-detail/<material>: toggle, budget)
  const gbDetail = new GeoBuilder();
  const detail: GardenDetailEnv = {
    gb: gbDetail,
    spec,
    ctx,
    terr,
    addTree: (key, x, z, scale = 1, y) => addTree(key, x, z, scale, 0, false, y),
    buildingRings: siteBuildings(spec, ctx)
      .map((b) => b.footprint)
      .filter((r): r is EN[] => !!r && r.length > 3),
  };
  for (const f of feats) {
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
        // gravel terrace with a stone kerb (TF-09): crisp surface and edge, broad perron at its doors (wave-2 review)
        if (f.kind === 'terrace' && f.coping && f.level !== undefined) {
          gravelTerrace(f);
          perrons(f);
        }
        if (f.parterre) buildAngloise(detail, f);
        if (f.fence) buildTreillage(detail, f);
        return;
      }
      case 'avenue': {
        const line = lineOf(f.geometry);
        if (!line || !f.trees) return;
        const sp = speciesFor(f.trees.species);
        const h = f.trees.height ?? sp.height;
        // young avenue trees (planted 1778-88, <= 8 m) stand on stakes, drawn at LOD <= 1 only (KB-I11, GARDEN.stake)
        const stakes = h <= GARDEN.youngTree[1] && ctx.lod <= 1 ? GARDEN.stake.perTree : 0;
        const blockers = blockersFor(f);
        for (const p of avenueTrees(line, f.trees, { seed: hashString(f.id) ^ ctx.options.seed })) {
          if (treeBlocked(p.E, p.N, blockers)) continue;
          addTree(sp.key, p.E - E0, -(p.N - N0), h / sp.height, stakes, f.placement === 'hypothetical');
        }
        return;
      }
      case 'clump': {
        // KB-I12: Petri's clumps (Point + radius) and single trees (MultiPoint), composition from the catalogue `mix`
        if (!f.mix?.length) return;
        const seed = hashString(f.id) ^ ctx.options.seed;
        const plants =
          f.geometry.type === 'Point' && f.radius
            ? clumpPlants(f.geometry.coordinates, f.radius, f.mix, { seed })
            : f.geometry.type === 'MultiPoint'
              ? singleTrees(f.geometry.coordinates, f.mix, seed)
              : [];
        for (const p of plants) {
          const sp = speciesFor(p.species);
          addTree(sp.key, p.E - E0, -(p.N - N0), p.height / sp.height, 0, f.placement === 'hypothetical');
        }
        return;
      }
      case 'path': {
        // wave-9 review fix: a walled graded drive (KB-V2, drive.ts) gets its flanking walls; the drive and the
        // forecourt strip KB-V1 are gravel ribbons like the walks (isDrapedWay: they are not painted into the ground
        // classes, so no seeded tree moves)
        if (isDrive(f)) for (const w of driveWalls(f, terr)) renderDriveWall(gb, w, wallK, capK);
        // KB-I12: garden walks (≤ 4 m) as a gravel ribbon draped on the terrain; other wide paths stay a splat class only
        const line = lineOf(f.geometry);
        if (!line || !f.width || !isDrapedWay(f)) return;
        // wave-8 review fix (KB-W8): a trodden earth footpath is a soft earth ribbon of breathing width, with low
        // Buntsandstein outcrops beside it (rockPath.ts)
        const soft = isTroddenPath(f);
        // a drive's ribbon lies on its graded plane (its edges sit on the walls' run-out ramp, which the walk camber
        // would follow under the ground)
        let plane: ((x: number, z: number) => number) | undefined;
        if (isDrive(f)) {
          const d = driveFrame(f);
          plane = (x, z) => d.at(driveCoords(d, x, z)[0]);
        }
        group.add(walkMesh(line, f.width, f.id, soft, plane));
        if (soft && /outcrop/i.test(f.surface ?? '')) buildOutcrops(f, line);
        return;
      }
      case 'furniture':
        buildFurniture(detail, f);
        return;
      case 'beds':
        buildBeds(detail, f);
        return;
      case 'parterre': {
        // KB-I34: a parterre à l'angloise replaces the generic hedge boxes
        if (f.parterre) {
          buildAngloise(detail, f);
          if (f.fence) buildTreillage(detail, f);
          return;
        }
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
            // KB-I45 (wave 7): battered with a bevelled, rounded shoulder (visual-audit §5.6 item 6)
            extrudeHedge(gb, hedge, [x0, -z0], tan, [tan[1], -tan[0]], 0, tl, hedgeProfile(-0.22, 0.22, y - 0.1, y + 0.45, 0.06));
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
        if (f.coping && f.water_level !== undefined) {
          buildBasin(f);
          return;
        }
        for (const r of rings(f.geometry)) {
          let h = f.water_level;
          if (h === undefined) {
            // lowest terrain inside + 0.4 m
            let m = Infinity;
            for (const [x, z] of ringLocal(r)) m = Math.min(m, terr(x, z));
            h = Number.isFinite(m) ? m + 0.4 : undefined;
          }
          if (h === undefined) continue;
          if (naturalShore(f)) {
            // wave 9: the graded terrain contour is the shore (shore.ts; prepare-terrain.py natural_shores); no wet band
            const wm = shoreWater(ringLocal(r), h, terr);
            if (wm) group.add(shoreMeshOf(wm, shoreWaterMat(water), `feature/${f.id}`, { part: 'water' }));
          } else {
            group.add(waterPlane(r, h, water, `feature/${f.id}`));
            // KB-I37: wet bank above the waterline (natural banks only; basins with a coping are handled above)
            const bank = wetBank(ringLocal(r), h, terr, `feature/${f.id}/bank`);
            if (bank) group.add(bank);
          }
          // a fountain jet in a plain pond (research/11 S12: "the fountain in the Schwanenweihern" [D presence]);
          // the height is a catalogue fact (`fountain_h`), the position the pond's centroid [I]
          if (f.fountain_h) {
            const loc = ringLocal(r);
            const open = loc.length > 1 && loc[0][0] === loc[loc.length - 1][0] && loc[0][1] === loc[loc.length - 1][1] ? loc.slice(0, -1) : loc;
            const cx = open.reduce((a, p) => a + p[0], 0) / open.length;
            const cz = open.reduce((a, p) => a + p[1], 0) / open.length;
            group.add(jetMesh(cx, h, cz, f.fountain_h, f.id));
          }
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
          // wave 8 (audit #8): a med/high well gets a period well-head, a low parapet of Buntsandstein with a grey
          // dressed coping [N well-heads of the region; height 0.75 m I]; a low-confidence shaft (a LiDAR pit whose
          // function is U, or a hypothesis) only a flush kerb with a stone cover, so an unsure well does not stand out
          const low = f.confidence === 'low';
          const top = low ? 0.2 : 0.75;
          const n = 12;
          for (let k = 0; k < n; k++) {
            const a0 = (k / n) * Math.PI * 2;
            const a1 = ((k + 1) / n) * Math.PI * 2;
            const r = 1.0;
            const p0: [number, number] = [x + r * Math.cos(a0), -z + r * Math.sin(a0)];
            const tl = 2 * r * Math.sin(Math.PI / n);
            const tan: [number, number] = [Math.cos((a0 + a1) / 2 + Math.PI / 2), Math.sin((a0 + a1) / 2 + Math.PI / 2)];
            const nrm: [number, number] = [tan[1], -tan[0]];
            gb.orientedBox(low ? capK : wallK, p0, tan, nrm, 0, tl, -0.25, 0.05, y - 0.3, y + top);
            if (low) gb.orientedBox(capK, p0, tan, nrm, 0, tl, -1.0, -0.2, y + top - 0.08, y + top - 0.02);
            else {
              gb.orientedBox(capK, p0, tan, nrm, -0.01, tl + 0.01, -0.3, 0.1, y + top, y + top + 0.09);
              gb.orientedBox(matKey('stone.grey', '#22282B'), p0, tan, nrm, 0, tl, -1.0, -0.2, y + top - 0.6, y + top - 0.55); // the dark shaft below the rim
            }
          }
        }
        return;
      }
      case 'fence': {
        // KB-I68: post-and-rail runs and the barrière (site/fence.ts layout, grammar FENCE)
        const line = lineOf(f.geometry);
        if (!line || !f.fence_line) return;
        // wave-9 review fix: a post-and-rail line stops at the walls of a drive through it (KB-F1 at KB-V2)
        const drives = feats.filter(isDrive);
        if (f.fence_line.type === 'post_rail' && drives.length) {
          const runs = clipOutsideDrives(line.map(([E, N]) => [E - E0, -(N - N0)] as [number, number]), drives);
          for (const run of runs) buildFence(f, run.map(([x, z]) => [x + E0, N0 - z] as EN));
          return;
        }
        buildFence(f, line);
        return;
      }
      default:
        return;
    }
  }

  /** KB-I68: draw a `fence` feature on the terrain (timber posts and rails; the barrière's beam in sentry colours). */
  function buildFence(f: TerrainFeature, line: EN[]): void {
    const fl = f.fence_line!;
    const pts: P2[] = line.map(([E, N]) => [E - E0, N - N0]);
    const seed = (hashString(f.id) ^ ctx.options.seed) >>> 0;
    const opts = { spacing: fl.post_spacing, rails: fl.rails, seed };
    const lay = fl.type === 'barriere' ? barriereLayout(pts[0], pts[pts.length - 1], fl.height, opts) : postRailLayout(pts, fl.height, opts);
    const g = (p: P2) => terr(p[0], -p[1]);
    const timber = matKey('wood.door', FENCE.postRail.colour);
    for (const q of lay.posts) {
      const y = g(q.p);
      if (!Number.isFinite(y)) continue;
      strut(gb, timber, [q.p[0], q.p[1], y - 0.3], [q.p[0] + q.lean[0], q.p[1] + q.lean[1], y + q.h], q.size, q.size * 0.9);
    }
    const [rw] = FENCE.postRail.rail;
    for (const r of lay.rails) {
      const ya = g(r.a);
      const yb = g(r.b);
      if (!Number.isFinite(ya) || !Number.isFinite(yb)) continue;
      const m: P2 = [(r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2];
      const ym = (ya + yb) / 2 + r.z - r.sag;
      strut(gb, timber, [r.a[0], r.a[1], ya + r.z], [m[0], m[1], ym], rw);
      strut(gb, timber, [m[0], m[1], ym], [r.b[0], r.b[1], yb + r.z], rw);
    }
    const bm = lay.beam;
    if (!bm) return;
    const B = FENCE.barriere;
    const blue = matKey('wood.shutter', COURT_FURNITURE.sentry.blue);
    const white = matKey('wood.shutter', COURT_FURNITURE.sentry.white);
    const yP = g(bm.pivot);
    const yR = g(bm.rest);
    if (!Number.isFinite(yP) || !Number.isFinite(yR)) return;
    const nrm: P2 = [-bm.dir[1], bm.dir[0]];
    // pivot post (a squared oak post with an iron pin at beam height) and the forked rest post
    gb.orientedBox(timber, bm.pivot, bm.dir, nrm, -B.post / 2, B.post / 2, -B.post / 2, B.post / 2, yP - 0.3, yP + B.pivotH + 0.25);
    for (const s of [-1, 1]) {
      const o = add2(bm.rest, nrm, s * 0.11);
      gb.orientedBox(timber, o, bm.dir, nrm, -0.07, 0.07, -0.05, 0.05, yR - 0.3, yR + B.restH + 0.12);
    }
    // the beam from the heel over the pivot to the tip, closed (horizontal), painted in bands
    const hP = yP + B.pivotH;
    const hT = Math.max(yR + B.restH, hP - 0.6);
    const total = bm.length + B.counter;
    const bands = Math.max(2, Math.round(total / B.stripe));
    const [bw] = B.beamSize;
    for (let i = 0; i < bands; i++) {
      const t0 = i / bands;
      const t1 = (i + 1) / bands;
      const at = (t: number): P3 => {
        const d = -B.counter + t * total;
        const p = add2(bm.pivot, bm.dir, d);
        const h = d <= 0 ? hP : hP + (hT - hP) * (d / bm.length);
        return [p[0], p[1], h];
      };
      const w = (t: number) => bw + (B.tip - bw) * Math.max(0, (t * total - B.counter) / bm.length);
      strut(gb, i % 2 ? white : blue, at(t0), at(t1), w(t0), w(t1));
    }
    // counterweight box under the heel
    const [wx, wy, wz] = B.weight;
    const heel = add2(bm.pivot, bm.dir, -B.counter + wx / 2 + 0.05);
    gb.orientedBox(timber, heel, bm.dir, nrm, -wx / 2, wx / 2, -wy / 2, wy / 2, hP - wz - 0.05, hP - 0.05);
  }

  /**
   * Gravel terrace with a kerb (wave-2 review, GARDEN.terraceKerb): a flat gravel surface just above the levelled
   * polygon and, on every edge that does not run against a building or another levelled feature, a gravel strip
   * `edgeOut` m wide (it covers the ragged 2 m ground-class edge) closed by a pale sandstone kerb `coping.width` wide.
   * Where the ground outside rises above the terrace the kerb sits right at the edge and holds the lawn; where a walk
   * leaves the terrace the kerb is flush and one step takes up the fall.
   */
  function gravelTerrace(f: TerrainFeature): void {
    const r = rings(f.geometry)[0];
    if (!r || f.level === undefined || !f.coping) return;
    const K = GARDEN.terraceKerb;
    const level = f.level;
    const kw = f.coping.width;
    const lift = 0.04;
    const gravel = matKey('ground.gravel', '#B79A84');
    const kerb = matKey('stone.grey', GARDEN.basinLook.coping);
    // plan (s, t) = (x, −z) = (E − E0, N − N0)
    const plan: P2[] = r.map(([E, N]) => [E - E0, N - N0]);
    const open = plan.slice(0, -1);
    let a2 = 0;
    for (let i = 0; i < open.length; i++) a2 += open[i][0] * open[(i + 1) % open.length][1] - open[(i + 1) % open.length][0] * open[i][1];
    gb.polygon(gravel, (a2 > 0 ? open : [...open].reverse()).map(([x, t]) => [x, t, level + lift] as [number, number, number]));
    const others = avenueBlockers(spec, null, year).filter((x) => x !== r);
    const blocked = (p: P2) => others.some((o) => pointInPolygon([p[0] + E0, p[1] + N0], o));
    const walksHere = feats
      .filter((x) => x.kind === 'path' && x.geometry.type === 'LineString')
      .map((x) => ({ line: (x.geometry.coordinates as EN[]).map(([E, N]) => [E - E0, N - N0] as P2), half: (x.width ?? 3) / 2 }));
    const g = (p: P2) => {
      const y = terr(p[0], -p[1]);
      return Number.isFinite(y) ? y : level;
    };
    const at = (m: P2, n: P2, d: number): P2 => [m[0] + n[0] * d, m[1] + n[1] * d];
    const o = K.edgeOut;
    const ki = o - kw; // inner face of the kerb = outer edge of the gravel strip
    // per piece: free edge?, strip outer height (never below the ground it covers), kerb top and foot, walk crossing
    type Pc = ReturnType<typeof edgePieces>[number] & { free: boolean; strip: number; top: number; foot: number; walk: boolean; low: number };
    const pcs: Pc[] = edgePieces(plan, 1).map((pc) => {
      const mid: P2 = [(pc.a[0] + pc.b[0]) / 2, (pc.a[1] + pc.b[1]) / 2];
      const free = !blocked(at(mid, pc.out, o + 0.6));
      const strip = Math.max(level + lift, ...[0.3, ki / 2, ki].map((d) => g(at(mid, pc.out, d)) + 0.03));
      const outside = [g(at(mid, pc.out, o + 0.15)), g(at(mid, pc.out, o + 0.5))];
      const walk = walksHere.some((w) => distanceToLine(w.line, at(mid, pc.out, o - kw / 2)) < w.half + 0.3);
      const low = Math.min(...outside);
      const top = walk ? Math.max(level + 0.01, strip) : Math.max(level + K.proud, strip + 0.02, Math.max(...outside) + 0.02);
      return { ...pc, free, strip, top, foot: Math.min(low, level) - K.footDepth, walk, low };
    });
    // runs of free pieces along one edge -> continuous strip and kerb (heights shared at the piece joints, no steps)
    const runs: Pc[][] = [];
    for (const pc of pcs) {
      const last = runs[runs.length - 1];
      if (!pc.free) continue;
      if (last && last[last.length - 1].edge === pc.edge && !pc.first && last[last.length - 1].free) last.push(pc);
      else runs.push([pc]);
    }
    for (const run of runs) {
      const tan = run[0].tan;
      const out = run[0].out;
      const B: P2[] = [run[0].a, ...run.map((pc) => pc.b)];
      // corner ends run out to the outer corner so neighbouring edges close
      if (run[0].first) B[0] = at(B[0], tan, -o);
      if (run[run.length - 1].last) B[B.length - 1] = at(B[B.length - 1], tan, o);
      const joint = (k: number, f: (x: Pc) => number, pick: (a: number, b: number) => number) =>
        k === 0 ? f(run[0]) : k === run.length ? f(run[run.length - 1]) : pick(f(run[k - 1]), f(run[k]));
      const V = B.map((_, k) => ({
        strip: joint(k, (x) => x.strip, Math.max),
        top: joint(k, (x) => x.top, (x, y) => (x + y) / 2),
        foot: joint(k, (x) => x.foot, Math.min),
      }));
      const P = (k: number, d: number, h: number): [number, number, number] => [B[k][0] + out[0] * d, B[k][1] + out[1] * d, h];
      const up: [number, number, number] = [0, 0, 1];
      const fo: [number, number, number] = [out[0], out[1], 0];
      const fi: [number, number, number] = [-out[0], -out[1], 0];
      for (let k = 0; k < run.length; k++) {
        const a = V[k];
        const b = V[k + 1];
        gb.quadFacing(gravel, P(k, 0, level + lift), P(k + 1, 0, level + lift), P(k + 1, ki, b.strip), P(k, ki, a.strip), up);
        gb.quadFacing(kerb, P(k, ki, a.top), P(k + 1, ki, b.top), P(k + 1, o, b.top), P(k, o, a.top), up);
        gb.quadFacing(kerb, P(k, o, a.foot), P(k + 1, o, b.foot), P(k + 1, o, b.top), P(k, o, a.top), fo);
        gb.quadFacing(kerb, P(k, ki, a.strip - 0.05), P(k + 1, ki, b.strip - 0.05), P(k + 1, ki, b.top), P(k, ki, a.top), fi);
        // a walk drops more than walkStepMin below the terrace: one step half way down
        const pc = run[k];
        if (pc.walk && level - pc.low > K.walkStepMin) {
          const right = pc.tan[1] * pc.out[0] - pc.tan[0] * pc.out[1] > 0;
          const len = Math.hypot(pc.b[0] - pc.a[0], pc.b[1] - pc.a[1]);
          gb.orientedBox(kerb, right ? pc.a : pc.b, right ? pc.tan : [-pc.tan[0], -pc.tan[1]], pc.out, 0, len, o, o + GARDEN.perron.tread, pc.low - K.footDepth, (level + pc.low) / 2);
        }
      }
      // end caps of the kerb
      for (const [k, dir] of [
        [0, -1],
        [run.length, 1],
      ] as const) {
        const v = V[k];
        gb.quadFacing(kerb, P(k, ki, v.foot), P(k, o, v.foot), P(k, o, v.top), P(k, ki, v.top), [tan[0] * dir, tan[1] * dir, 0]);
      }
    }
  }

  /**
   * Garden perron (GARDEN.perron) at every door with steps whose grade is this terrace's level: two broad steps of red
   * Buntsandstein, `axes` window axes wide, in front of the facade's own narrow flight (exterior/facade.ts), which it
   * covers; the landing ends `overThreshold` above the door sill so the two never share a face.
   */
  function perrons(f: TerrainFeature): void {
    const r = rings(f.geometry)[0];
    if (!r || f.level === undefined) return;
    const P = GARDEN.perron;
    for (const b of siteBuildings(spec, ctx)) {
      let L;
      try {
        L = ctx.layout(b);
      } catch {
        continue;
      }
      for (const o of L.openings) {
        if ((o.kind !== 'door' && o.kind !== 'portal') || !o.steps || o.portico || o.grade_h === undefined || Math.abs(o.grade_h - f.level) > 0.05) continue;
        const sd = L.frame.sides[o.side];
        const pIn: [number, number] = [sd.p0[0] + sd.tangent[0] * o.a, sd.p0[1] + sd.tangent[1] * o.a];
        const [Ed, Nd] = stToEN(L.frame, pIn);
        const [Eo, No] = stToEN(L.frame, [pIn[0] + sd.normal[0], pIn[1] + sd.normal[1]]);
        const [Et, Nt] = stToEN(L.frame, [pIn[0] + sd.tangent[0], pIn[1] + sd.tangent[1]]);
        const out: P2 = [Eo - Ed, No - Nd];
        if (!pointInPolygon([Ed + out[0] * 3, Nd + out[1] * 3], r)) continue;
        let tan: P2 = [Et - Ed, Nt - Nd];
        if (tan[1] * out[0] - tan[0] * out[1] < 0) tan = [-tan[0], -tan[1]];
        const lay = L.sides[o.side];
        const span = lay.risalits.find((x) => o.a >= x.a0 && o.a <= x.a1);
        const d0 = (span ? (span.risalit.projection ?? ARTICULATION.risalitProjection) : 0) + ARTICULATION.plinthProjection;
        const W = P.axes * lay.spacing;
        const top2 = o.bottom_h + P.overThreshold;
        const top1 = f.level + (top2 - f.level) / 2;
        const org: P2 = [Ed - E0, Nd - N0];
        gb.orientedBox(wallK, org, tan, out, -W / 2, W / 2, -0.3, d0 + P.depth, f.level - 0.3, top2);
        gb.orientedBox(wallK, org, tan, out, -W / 2 - P.tread, W / 2 + P.tread, -0.3, d0 + P.depth + P.tread, f.level - 0.3, top1);
      }
    }
  }

  /**
   * Wave-8 review fix (KB-W8): low Buntsandstein outcrops beside a rock path (rockPath.ts outcropPlan), weathered
   * red-brown, sunk ~35 % into the slope; their own meshes so they follow the low-confidence select.
   */
  function buildOutcrops(f: TerrainFeature, line: EN[]): void {
    const loc: P2[] = line.map(([E, N]) => [E - E0, -(N - N0)]);
    const seed = (hashString(f.id) ^ ctx.options.seed) >>> 0;
    const water = feats.filter((x) => x.kind === 'pond' || x.kind === 'moat').flatMap((x) => rings(x.geometry)).map(ringLocal);
    const plan = outcropPlan(loc, seed, {
      width: f.width ?? 1.4,
      height: (x, z) => terr(x, z),
      avoid: (x, z) => water.some((r) => pointInPolygon([x, z], r) || distanceToLine(r, [x, z]) < 2),
    });
    // wave 9: loose stones and rock heads along both edges of the tread (rockPath.ts edgeStonePlan), following its breathing width
    const edges = edgeStonePlan(loc, seed, {
      width: f.width ?? 1.4,
      widthAt: pathWidthFactor(seed, polylineLength(loc)),
      avoid: (x, z) => water.some((r) => pointInPolygon([x, z], r) || distanceToLine(r, [x, z]) < 0.8),
    });
    const gbR = new GeoBuilder();
    const stone = matKey('stone.red', ROCK_PATH_STONE);
    const loose = matKey('stone.red', ROCK_PATH_LOOSE);
    const nOut = plan.length;
    plan.push(...edges);
    for (let k = 0; k < plan.length; k++) {
      const o = plan[k];
      const y0 = terr(o.x, o.z);
      if (!Number.isFinite(y0)) continue;
      const { v, f: faces } = outcropShape(seed + k * 7919);
      const c = Math.cos(o.yaw);
      const sn = Math.sin(o.yaw);
      // local (a along, up, b across) -> plan (s, t, h) = (x, −z, y); sunk so about half the height shows (the
      // ground sample is at the centre: on the slope the uphill side sinks deeper, as a bedded outcrop does)
      const sx = o.len * 0.5;
      const sz = o.wid * 0.5;
      const P = v.map(([a, up, b]): [number, number, number] => {
        const lx = a * sx;
        const lz = b * sz;
        const x = o.x + lx * c - lz * sn;
        const z = o.z + lx * sn + lz * c;
        return [x, -z, y0 + (up + 0.1) * o.h];
      });
      // smooth normals of the ellipsoid (weathered, rounded edges), in the local frame (= the builder's object space)
      const N = v.map(([a, up, b]) => {
        const nx = a / sx;
        const nz = b / sz;
        return new THREE.Vector3(nx * c - nz * sn, up / o.h, nx * sn + nz * c).normalize();
      });
      // P is (x, −z, y), so the builder's object space is the local frame again: the icosahedron's outward winding holds
      for (const [i0, i1, i2] of faces) gbR.tri(k < nOut ? stone : loose, P[i0], P[i1], P[i2], [N[i0], N[i1], N[i2]]);
    }
    for (const m of gbR.toMeshes(ctx.materials, `feature/${f.id}/outcrops`, { part: 'feature', lod: ctx.lod, featureId: f.id, confidence: 'low', placement: f.placement })) {
      m.castShadow = true;
      group.add(m);
    }
  }

  /**
   * Gravel walk ribbon on the terrain (+GARDEN.ribbonLift), one mesh per walk, not a collider. Five vertices per
   * section: a worn verge `GARDEN.walkVerge` m wide on each side fades the gravel into the lawn (attribute `aEdge`
   * 0 → 1, walkMaterial), so the walk has no razor edge (wave-2 review).
   */
  function walkMesh(line: EN[], width: number, id: string, soft = false, plane?: (x: number, z: number) => number): THREE.Mesh {
    const loc = line.map(([E, N]) => [E - E0, -(N - N0)] as [number, number]);
    const rb = walkRibbon(loc, width);
    // a trodden path frays into the grass over a wider verge (0.33-0.77 m; wave 9: narrower) and breathes in width (rockPath.ts)
    const verge = soft ? 0.55 : GARDEN.walkVerge;
    const ro = walkRibbon(loc, width + 2 * verge);
    if (soft) {
      const seed = (hashString(id) ^ ctx.options.seed) >>> 0;
      const wf = pathWidthFactor(seed, polylineLength(rb.centre));
      const vf = smoothNoise1(seed ^ 0x91, 4.3);
      let s = 0;
      for (let i = 0; i < rb.centre.length; i++) {
        if (i > 0) s += Math.hypot(rb.centre[i][0] - rb.centre[i - 1][0], rb.centre[i][1] - rb.centre[i - 1][1]);
        const c = rb.centre[i];
        const k = wf(s);
        const kv = (width / 2) * k + verge * (0.6 + 0.8 * vf(s));
        const sc = (p: [number, number], f: number): [number, number] => [c[0] + (p[0] - c[0]) * f, c[1] + (p[1] - c[1]) * f];
        rb.left[i] = sc(rb.left[i], k);
        rb.right[i] = sc(rb.right[i], k);
        ro.left[i] = sc(ro.left[i], kv / (width / 2 + verge));
        ro.right[i] = sc(ro.right[i], kv / (width / 2 + verge));
      }
    }
    const pos: number[] = [];
    const edge: number[] = [];
    const idx: number[] = [];
    const lift = GARDEN.ribbonLift;
    const hAt = (x: number, z: number, fb: number) => {
      const y = plane ? plane(x, z) : terr(x, z);
      return Number.isFinite(y) ? y : fb;
    };
    let last = 0;
    const W = 5;
    for (let i = 0; i < rb.centre.length; i++) {
      const yc = (last = hAt(rb.centre[i][0], rb.centre[i][1], last));
      // the edges take the higher of edge and centre ground minus a little camber, so the ribbon never dives under
      const yl = Math.max(hAt(rb.left[i][0], rb.left[i][1], yc), yc - 0.25);
      const yr = Math.max(hAt(rb.right[i][0], rb.right[i][1], yc), yc - 0.25);
      const ylo = Math.max(hAt(ro.left[i][0], ro.left[i][1], yl), yl - 0.15);
      const yro = Math.max(hAt(ro.right[i][0], ro.right[i][1], yr), yr - 0.15);
      pos.push(
        ro.left[i][0], ylo + lift, ro.left[i][1],
        rb.left[i][0], yl + lift, rb.left[i][1],
        rb.centre[i][0], yc + lift + 0.03, rb.centre[i][1],
        rb.right[i][0], yr + lift, rb.right[i][1],
        ro.right[i][0], yro + lift, ro.right[i][1],
      );
      edge.push(0, 1, 1, 1, 0);
      if (i > 0) {
        const a = (i - 1) * W;
        const b = i * W;
        // winding: up-facing in the local frame (x right, z toward the viewer)
        for (let k = 0; k < W - 1; k++) idx.push(a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // make sure the normals point up whatever the line direction
    const n = geo.attributes.normal;
    let up = 0;
    for (let i = 0; i < n.count; i++) up += n.getY(i);
    if (up < 0) {
      for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
      geo.setIndex(idx);
      geo.computeVertexNormals();
    }
    // planar uv in metres (as GeoBuilder) for the gravel texture
    const uv: number[] = [];
    for (let i = 0; i < pos.length; i += 3) uv.push(pos[i], -pos[i + 2]);
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const m = new THREE.Mesh(geo, soft ? earthWalkMaterial(ctx.materials) : walkMaterial(ctx.materials));
    m.name = `feature/${id}/walk`;
    m.receiveShadow = true;
    m.renderOrder = 1;
    m.userData = { part: 'walk', featureId: id };
    return m;
  }

  /**
   * KB-I13 formal basin: water disc at `water_level`, a stone coping ring (GARDEN.basin) whose wall reaches down to
   * the lowest ground under it, a fountain jet and rim sculpture (two stag heads facing `ornaments.facing`).
   */
  function buildBasin(f: TerrainFeature): void {
    const r = rings(f.geometry)[0];
    if (!r || f.water_level === undefined || !f.coping) return;
    const wl = f.water_level;
    const loc = ringLocal(r).map(([x, z]) => [x, -z] as [number, number]); // plan (s, t)
    let cs = 0;
    let ct = 0;
    const open = loc.slice(0, -1);
    for (const [s, t] of open) {
      cs += s;
      ct += t;
    }
    cs /= open.length;
    ct /= open.length;
    const R = open.reduce((a, [s, t]) => a + Math.hypot(s - cs, t - ct), 0) / open.length;
    const cw = f.coping.width;
    const top = wl + GARDEN.basin.freeboard;
    const stoneK = matKey('stone.grey', GARDEN.basinLook.coping);
    const n = GARDEN.basin.segments;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2;
      const a1 = ((k + 1) / n) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const tl = 2 * (R + cw) * Math.sin(Math.PI / n) + 0.02;
      const tan: [number, number] = [-Math.sin(am), Math.cos(am)];
      const nrm: [number, number] = [Math.cos(am), Math.sin(am)];
      const mid: [number, number] = [cs + Math.cos(am) * R, ct + Math.sin(am) * R];
      const o: [number, number] = [mid[0] - tan[0] * (tl / 2), mid[1] - tan[1] * (tl / 2)];
      // lowest ground below the outer coping edge -> wall foot
      const ox = cs + Math.cos(am) * (R + cw);
      const ot = ct + Math.sin(am) * (R + cw);
      const g = terr(ox, -ot);
      const foot = Math.min(Number.isFinite(g) ? g : top - 0.6, wl - 0.5) - 0.1;
      gb.orientedBox(stoneK, o, tan, nrm, 0, tl, -0.02, cw, top - f.coping.height, top);
      gb.orientedBox(stoneK, o, tan, nrm, 0, tl, 0.02, cw - 0.04, foot, top - f.coping.height);
    }
    // raked gravel band round the coping (GARDEN.basinLook.surround) so the ring reads from the air [I]
    const sw = GARDEN.basinLook.surround;
    if (sw > 0) {
      const gk = matKey('ground.gravel', '#B79A84');
      const r0 = R + cw - 0.02;
      const r1 = R + cw + sw;
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2;
        const a1 = ((k + 1) / n) * Math.PI * 2;
        const h = (a: number, rr: number) => {
          const y = terr(cs + Math.cos(a) * rr, -(ct + Math.sin(a) * rr));
          return (Number.isFinite(y) ? y : wl - 0.3) + 0.04;
        };
        const p = (a: number, rr: number): [number, number, number] => [cs + Math.cos(a) * rr, ct + Math.sin(a) * rr, h(a, rr)];
        gb.quadFacing(gk, p(a0, r0), p(a0, r1), p(a1, r1), p(a1, r0), [0, 0, 1]);
      }
    }
    // water disc (slightly inside the coping): dark, deep, reflecting the sky at grazing angles (basinWater)
    const disc = new THREE.CircleGeometry(R + 0.02, 48);
    disc.rotateX(-Math.PI / 2);
    disc.translate(cs, wl, -ct);
    const wm = new THREE.Mesh(disc, basinWater(water));
    wm.name = `feature/${f.id}`;
    wm.receiveShadow = true;
    wm.userData = { part: 'water' };
    group.add(wm);
    // fountain jet: a slim rising column and a translucent falling crown (static; animation is viewer work)
    if (f.fountain_h) group.add(jetMesh(cs, wl, -ct, f.fountain_h, f.id));
    // rim sculpture
    const orn = f.ornaments;
    if (orn?.kind === 'stag_head' && orn.count > 0) {
      let toward: [number, number] = [cs - 1, ct];
      if (Array.isArray(orn.facing)) toward = [orn.facing[0] - E0, orn.facing[1] - N0];
      else if (typeof orn.facing === 'string') {
        const b = spec.buildings.find((x) => x.id === orn.facing);
        if (b?.footprint) {
          const c = centroidEN(b.footprint);
          toward = [c[0] - E0, c[1] - N0];
        }
      }
      for (const o of basinOrnaments([cs, ct], R + cw / 2, orn.count, toward)) stagHead(gb, stoneK, o.p, o.facing, top);
    }
  }

  // KB-I23: Ehrenhof furniture (sentry boxes, Prellsteine, cobbled lanes, gutters) when the court is in this build
  if (feats.some((f) => f.kind === 'court')) {
    const court = buildCourtFurniture({ ...ctx, spec: { ...spec, terrain_features: feats } });
    if (court) {
      group.add(court.group);
      court.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.userData.collider = true;
        colliders.push(m);
      });
    }
  }

  const meshes = [
    ...gb.toMeshes(ctx.materials, 'site/features', { part: 'feature', lod: ctx.lod }),
    ...gbDetail.toMeshes(ctx.materials, 'site/garden-detail', { part: 'feature', detail: 'garden', lod: ctx.lod }),
  ];
  for (const m of meshes) {
    group.add(m);
    if (!/water|grass/.test(m.name)) {
      m.userData.collider = true;
      colliders.push(m);
    }
  }
  for (const { key, stakes, low, list } of trees.values()) {
    const sp = SPECIES[key];
    if (!sp) continue;
    const name = low ? 'site/trees-hypothetical' : 'site/trees';
    const g = treeMeshes(sp, list, hashString(key) ^ ctx.options.seed ^ (stakes ? 0x51 : 0) ^ (low ? 0xa3 : 0), name, { stakes });
    if (low) g.userData = { ...g.userData, confidence: 'low', placement: 'hypothetical' };
    group.add(g);
  }
  return { group, colliders };
}

/** Weathered Buntsandstein of the rock-path outcrops (paler and greyer than dressed `stone.red`: weathered, lichen) [I hue]. */
const ROCK_PATH_STONE = '#A88A7A';
/** Loose edge stones of the rock path: a little paler and greyer still (dry, dusty, scuffed) [I hue]. */
const ROCK_PATH_LOOSE = '#B6A292';

/**
 * Trodden earth of the rock path (wave 9, audit #1: `#8F7766` read as a pink ruled line at 39-41 / 48): the walks'
 * Buntsandstein grit `#B79A84` worn darker and duller by feet and damp, so it belongs to the same family [I hue].
 */
const ROCK_PATH_EARTH = '#A08A78';

const earthMats = new WeakMap<object, THREE.Material>();
/**
 * Wave-8 review fix (KB-W8): trodden earth of a footpath on Buntsandstein (`ROCK_PATH_EARTH`, wave 9: the walks' grit
 * worn darker) [I hue], with a ragged verge and grass patches showing through (the alpha follows two texture octaves),
 * and (wave 9) tufts of turf left standing in the tread, so it reads as a worn path, not a ruled overlay.
 */
function earthWalkMaterial(lib: { tinted(name: 'ground.gravel', colour: string): THREE.Material }): THREE.Material {
  let m = earthMats.get(lib);
  if (!m) {
    const base = lib.tinted('ground.gravel', ROCK_PATH_EARTH) as THREE.MeshStandardMaterial;
    const w = base.clone();
    const prev = base.onBeforeCompile;
    const prevKey = base.customProgramCacheKey?.bind(base);
    w.onBeforeCompile = (shader, renderer) => {
      prev?.call(base, shader, renderer);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aEdge;\nvarying float vEdge;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = aEdge;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vEdge;').replace(
        '#include <alphatest_fragment>',
        `#ifdef USE_MAP
  float lo = dot(texture2D(map, vMapUv * 0.061, 6.0).rgb, vec3(0.333));
  float n1 = dot(texture2D(map, vMapUv * 0.23).rgb, vec3(0.333)) / max(dot(texture2D(map, vMapUv * 0.23, 8.0).rgb, vec3(0.333)), 0.05);
  float n2 = lo / max(dot(texture2D(map, vMapUv * 0.061, 9.0).rgb, vec3(0.333)), 0.05);
#else
  float n1 = 1.0;
  float n2 = 1.0;
#endif
  // grass creeping in from the verge, a darker, damper centre line where most feet go [I]
  diffuseColor.rgb *= mix(vec3(0.8, 0.86, 0.66), vec3(1.0), smoothstep(0.3, 0.9, vEdge)) * mix(1.0, 0.9, smoothstep(0.85, 1.0, vEdge));
  // wave 9: tufts of turf left standing in the tread, so it reads as a worn line through the grass, not a ruled strip
  float tuft = smoothstep(1.06, 1.2, n1 * 0.55 + n2 * 0.45) * smoothstep(0.7, 0.95, vEdge);
  diffuseColor.a *= clamp(vEdge * 1.35 - 0.2 + (n1 - 1.0) * 1.4 + (n2 - 1.0) * 1.2, 0.0, 0.92) * (1.0 - 0.55 * tuft);
#include <alphatest_fragment>`,
      );
    };
    w.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|earthWalk`;
    w.transparent = true;
    w.depthWrite = false;
    w.name = 'ground.gravel';
    m = w;
    earthMats.set(lib, m);
  }
  return m;
}

const walkMats = new WeakMap<object, THREE.Material>();
/**
 * Walk gravel: the library gravel tinted to the splat's Buntsandstein grit #B79A84 (KB-I14, research/11 S15
 * [N d'Argenville red sand; I local hue]) so a draped walk and the ground class under it read as one surface. Built
 * from the library's tinted material so its texture only modulates luminance around that colour (a plain clone lost
 * the patch and the raw texture made the walk a dark red-brown, wave-2 review). Its verge (attribute aEdge, walkMesh)
 * fades out with a ragged, texture-driven edge and a slightly worn tint: a transparent overlay without depth writes.
 */
function walkMaterial(lib: { tinted(name: 'ground.gravel', colour: string): THREE.Material }): THREE.Material {
  let m = walkMats.get(lib);
  if (!m) {
    const base = lib.tinted('ground.gravel', '#B79A84') as THREE.MeshStandardMaterial;
    const w = base.clone();
    const prev = base.onBeforeCompile;
    const prevKey = base.customProgramCacheKey?.bind(base);
    w.onBeforeCompile = (shader, renderer) => {
      prev?.call(base, shader, renderer);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aEdge;\nvarying float vEdge;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = aEdge;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vEdge;').replace(
        '#include <alphatest_fragment>',
        `#ifdef USE_MAP
  float vergeN = dot(texture2D(map, vMapUv * 0.29).rgb, vec3(0.333)) / max(dot(texture2D(map, vMapUv * 0.29, 8.0).rgb, vec3(0.333)), 0.05);
#else
  float vergeN = 1.0;
#endif
  diffuseColor.rgb *= mix(vec3(0.86, 0.9, 0.78), vec3(1.0), smoothstep(0.35, 0.95, vEdge));
  diffuseColor.a *= clamp(vEdge * 1.7 - 0.25 + (vergeN - 1.0) * 0.9, 0.0, 1.0);
#include <alphatest_fragment>`,
      );
    };
    w.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|walkVerge`;
    w.transparent = true;
    w.depthWrite = false;
    w.name = 'ground.gravel';
    m = w;
    walkMats.set(lib, m);
  }
  return m;
}

const basinMats = new WeakMap<THREE.Material, THREE.Material>();
/**
 * Formal basin water (GARDEN.basinLook.water): the library water made darker and glassier, so it reads as a deep
 * basin that mirrors the sky at grazing angles (Fresnel of the physical material, ior 1.33) instead of a flat
 * steel-blue disc (wave-2 review).
 */
function basinWater(base: THREE.Material): THREE.Material {
  let m = basinMats.get(base);
  if (!m) {
    m = base.clone();
    const sm = m as THREE.MeshPhysicalMaterial;
    if (sm.color) sm.color.set(GARDEN.basinLook.water);
    if ('roughness' in sm) sm.roughness = 0.03;
    if ('envMapIntensity' in sm) sm.envMapIntensity = 1.4;
    m.name = 'water';
    // the clone loses the library hooks: ripples and the post chain's water marker again (KB-I37)
    waterPatch(m);
    basinMats.set(base, m);
  }
  return m;
}

/** Mesh of a shore grid (shore.ts) with its vertex colours. */
function shoreMeshOf(sm: ShoreMesh, mat: THREE.Material, name: string, userData: Record<string, unknown>): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(sm.positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(sm.colors, 3));
  geo.setAttribute('aDepth', new THREE.BufferAttribute(sm.depths, 1));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(sm.positions.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(new THREE.BufferAttribute(sm.index, 1));
  geo.computeBoundingSphere();
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.receiveShadow = true;
  m.userData = userData;
  return m;
}

const shoreMats = new WeakMap<THREE.Material, THREE.Material>();
/** Natural-shore water (shore.ts): the library water with the per-vertex shallow tint (vertex colours), ripples and the post chain's water marker again (the clone loses the hooks). */
function shoreWaterMat(base: THREE.Material): THREE.Material {
  let m = shoreMats.get(base);
  if (!m) {
    m = base.clone();
    (m as THREE.MeshStandardMaterial).vertexColors = true;
    m.name = 'water';
    waterPatch(m);
    // wave-9 review fix: fade in over the first SHORE.fade m of depth (shore.ts shoreFade, per fragment from the
    // interpolated, unclamped depth: 0 exactly on the waterline). Colour blends over the bank; the scene alpha (the
    // post chain's water marker, < 0.25 = water) becomes dst · (1 − fade), so the SSR only runs where the water is
    // nearly opaque.
    const sw = m;
    const prev = sw.onBeforeCompile;
    const prevKey = sw.customProgramCacheKey.bind(sw);
    sw.onBeforeCompile = (sh, r) => {
      prev.call(sw, sh, r);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aDepth;\nvarying float vShoreDepth;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vShoreDepth = aDepth;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vShoreDepth;')
        .replace('#include <alphatest_fragment>', `diffuseColor.a *= clamp( vShoreDepth / ${SHORE.fade.toFixed(3)}, 0.0, 1.0 );\n#include <alphatest_fragment>`)
        .replace('gl_FragColor.a = 0.0;', '');
    };
    sw.customProgramCacheKey = () => `${prevKey()}|shoreFade`;
    sw.transparent = true;
    sw.blending = THREE.CustomBlending;
    sw.blendEquation = THREE.AddEquation;
    sw.blendSrc = THREE.SrcAlphaFactor;
    sw.blendDst = THREE.OneMinusSrcAlphaFactor;
    sw.blendSrcAlpha = THREE.ZeroFactor;
    sw.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    shoreMats.set(base, m);
  }
  return m;
}

const jetMats = new Map<string, THREE.MeshStandardMaterial>();
function jetMaterial(opacity: number): THREE.MeshStandardMaterial {
  const k = opacity.toFixed(2);
  let m = jetMats.get(k);
  if (!m) {
    // white aerated water scatters light: a little self-light keeps it white in shade [I render]
    m = new THREE.MeshStandardMaterial({ color: '#F6FAFA', emissive: '#DDE6E8', emissiveIntensity: 0.18, roughness: 0.5, transparent: true, opacity, depthWrite: false });
    m.name = 'water.jet';
    jetMats.set(k, m);
  }
  return m;
}

/**
 * Keep a thin vertical mesh at least `minPx` pixels wide on screen (the jet column read as nothing from the standard
 * aerials, wave-2 review): before each draw its horizontal scale grows with the camera distance. Shadow passes and
 * orthographic cameras are left alone.
 */
export function keepMinScreenWidth(mesh: THREE.Mesh, radius: number, minPx: number): void {
  const wp = new THREE.Vector3();
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    const cam = camera as THREE.PerspectiveCamera;
    if (!cam.isPerspectiveCamera) return;
    mesh.getWorldPosition(wp);
    const d = wp.distanceTo(cam.position);
    const hPx = renderer.getContext().drawingBufferHeight || 1080;
    const worldPerPx = (2 * d * Math.tan((cam.fov * Math.PI) / 360)) / (cam.zoom * hPx);
    const k = Math.max(1, (minPx * worldPerPx) / (2 * radius));
    if (Math.abs(mesh.scale.x - k) > 1e-3) {
      mesh.scale.set(k, 1, k);
      mesh.updateMatrixWorld();
    }
  };
}

/**
 * Fountain jet of height h on a basin at (x, y = water level, z), static (animation is viewer work): a white rising
 * column (at least GARDEN.basinLook.jetMinPx wide on screen), a spray crown where it breaks, a falling sheath and a
 * faint spray haze reaching ~0.25 h out, and a foam ring on the water.
 */
function jetMesh(x: number, y: number, z: number, h: number, id: string): THREE.Group {
  const g = new THREE.Group();
  g.name = `feature/${id}/jet`;
  const rCol = 0.16;
  const col = new THREE.CylinderGeometry(0.08, rCol, h, 10, 1, true);
  col.translate(0, h / 2, 0);
  // spray crown where the jet breaks and falls back
  const crown = new THREE.IcosahedronGeometry(0.32, 1);
  crown.scale(1, 1.8, 1);
  crown.translate(0, h - 0.35, 0);
  // falling sheath: narrow at the top, bowed outward, reaching ~0.15 h at the water
  const sh = new THREE.CylinderGeometry(0.3, 0.15 * h, h * 0.95, 16, 4, true);
  const ps = sh.attributes.position;
  for (let i = 0; i < ps.count; i++) {
    const t = (ps.getY(i) + (h * 0.95) / 2) / (h * 0.95); // 0 bottom .. 1 top
    const k = 1 + 0.25 * Math.sin(Math.PI * t);
    ps.setX(i, ps.getX(i) * k);
    ps.setZ(i, ps.getZ(i) * k);
  }
  sh.translate(0, (h * 0.95) / 2, 0);
  sh.computeVertexNormals();
  // spray haze: a wider, very faint dome of drift
  const haze = new THREE.SphereGeometry(0.25 * h, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  haze.scale(1, 1.1, 1);
  const foam = new THREE.RingGeometry(0.1, 0.24 * h, 28, 1);
  foam.rotateX(-Math.PI / 2);
  foam.translate(0, 0.02, 0);
  for (const [geo, nm, op] of [
    [col, 'column', 0.92],
    [crown, 'crown', 0.3],
    [sh, 'sheath', 0.24],
    [haze, 'haze', 0.08],
    [foam, 'foam', 0.62],
  ] as const) {
    const m = new THREE.Mesh(geo, jetMaterial(op));
    m.name = `feature/${id}/jet-${nm}`;
    m.renderOrder = 2;
    m.userData = { part: 'water' };
    if (nm === 'column') keepMinScreenWidth(m, rCol, GARDEN.basinLook.jetMinPx);
    g.add(m);
  }
  // KB-I37: animated droplets falling from the crown (water.ts)
  g.add(jetSpray(h, id));
  g.position.set(x, y, z);
  return g;
}

type P3 = [number, number, number];
const add2 = (a: P2, d: P2, s: number): P2 => [a[0] + d[0] * s, a[1] + d[1] * s];

/** Square-section strut of width w from A to B ([s, t, h] plan + height), all faces outward. */
function strut(gb: GeoBuilder, key: ReturnType<typeof matKey>, A: P3, B: P3, w: number, w2 = w): void {
  const d: P3 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const L = Math.hypot(...d);
  if (L < 1e-6) return;
  const u: P3 = [d[0] / L, d[1] / L, d[2] / L];
  // a vector not parallel to u
  const ref: P3 = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let e1: P3 = [u[1] * ref[2] - u[2] * ref[1], u[2] * ref[0] - u[0] * ref[2], u[0] * ref[1] - u[1] * ref[0]];
  const l1 = Math.hypot(...e1);
  e1 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
  const e2: P3 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
  const c = (P: P3, a: number, b: number, hw: number): P3 => [P[0] + (e1[0] * a + e2[0] * b) * hw, P[1] + (e1[1] * a + e2[1] * b) * hw, P[2] + (e1[2] * a + e2[2] * b) * hw];
  const sq: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const a0 = sq.map(([a, b]) => c(A, a, b, w / 2));
  const b0 = sq.map(([a, b]) => c(B, a, b, w2 / 2));
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const mid = sq[i].map((x, k) => (x + sq[j][k]) / 2);
    const out: P3 = [e1[0] * mid[0] + e2[0] * mid[1], e1[1] * mid[0] + e2[1] * mid[1], e1[2] * mid[0] + e2[2] * mid[1]];
    gb.quadFacing(key, a0[i], a0[j], b0[j], b0[i], out);
  }
  gb.quadFacing(key, b0[0], b0[1], b0[2], b0[3], u);
  gb.quadFacing(key, a0[0], a0[1], a0[2], a0[3], [-u[0], -u[1], -u[2]]);
}

/**
 * A stag head on a basin rim (KB-I13, GARDEN.stagHead): plinth block, a forward-leaning neck, head and muzzle, ears
 * and two branching antlers (beam with three forward tines), looking along `facing` (plan direction).
 * Form [I]; presence [D LA Speyer via Schneider].
 */
function stagHead(gb: GeoBuilder, key: ReturnType<typeof matKey>, p: [number, number], facing: [number, number], top: number): void {
  const S = GARDEN.stagHead;
  const tan: [number, number] = [facing[0], facing[1]];
  const nrm: [number, number] = [tan[1], -tan[0]];
  // local (a forward, d sideways, h up) -> [s, t, h]
  const P = (a: number, d: number, h: number): P3 => [p[0] + tan[0] * a + nrm[0] * d, p[1] + tan[1] * a + nrm[1] * d, h];
  const b = S.block;
  gb.orientedBox(key, p, tan, nrm, -b / 2, b / 2, -b / 2, b / 2, top, top + 0.45); // plinth block on the coping
  gb.orientedBox(key, p, tan, nrm, -b / 2 - 0.05, b / 2 + 0.05, -b / 2 - 0.05, b / 2 + 0.05, top + 0.45, top + 0.53); // cap
  const z = top + 0.53;
  const H = S.head; // overall head height scale
  strut(gb, key, P(-0.12, 0, z), P(0.02, 0, z + 0.45 * H), 0.34, 0.26); // neck, leaning forward
  strut(gb, key, P(-0.02, 0, z + 0.48 * H), P(0.28, 0, z + 0.4 * H), 0.26, 0.17); // head tapering to the muzzle
  strut(gb, key, P(0.26, 0, z + 0.41 * H), P(0.44, 0, z + 0.33 * H), 0.15, 0.11); // muzzle
  const A = S.antler;
  for (const sd of [-1, 1]) {
    strut(gb, key, P(-0.04, sd * 0.1, z + 0.56 * H), P(-0.08, sd * 0.32, z + 0.62 * H), 0.07, 0.04); // ear
    // beam: up and outward, curving forward at the top
    const pts: P3[] = [
      P(-0.02, sd * 0.08, z + 0.6 * H),
      P(-0.1, sd * 0.24 * A, z + 0.9 * H),
      P(-0.12, sd * 0.42 * A, z + 1.25 * H),
      P(-0.06, sd * 0.52 * A, z + 1.6 * H),
      P(0.06, sd * 0.5 * A, z + 1.85 * H),
    ];
    for (let i = 1; i < pts.length; i++) strut(gb, key, pts[i - 1], pts[i], 0.06 - i * 0.006);
    // forward tines (brow, bez, trez)
    for (const [i, len] of [
      [0.25, 0.24],
      [0.55, 0.2],
      [0.8, 0.16],
    ] as const) {
      const k = Math.min(pts.length - 2, Math.floor(i * (pts.length - 1)));
      const f = i * (pts.length - 1) - k;
      const q: P3 = [pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * f, pts[k][2] + (pts[k + 1][2] - pts[k][2]) * f];
      const tip: P3 = [q[0] + tan[0] * len, q[1] + tan[1] * len, q[2] + len * 0.45];
      strut(gb, key, q, tip, 0.035, 0.02);
    }
  }
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
