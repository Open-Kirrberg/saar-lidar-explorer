/**
 * Forest from the terrain ground classes (class 6 = today's canopy > 8 m away from the residence features;
 * an assumption for 1789, tag U). Jittered grid of instanced low-poly trees.
 */
import type * as THREE from 'three';
import { mulberry32 } from '@model/layout/geom.ts';
import { SPECIES, treeMeshes, type TreeInstance } from '@model/site/trees.ts';
import type { TerrainData } from './terrain.ts';

export function buildForest(t: TerrainData, spacing = 12, seed = 1789): THREE.Group {
  const g = t.meta.ground;
  const grid = t.meta.grid;
  const rnd = mulberry32(seed);
  const trees: TreeInstance[] = [];
  const width = g.cols * g.cell;
  const height = g.rows * g.cell;
  for (let y = spacing / 2; y < height; y += spacing) {
    for (let x = spacing / 2; x < width; x += spacing) {
      const jx = x + (rnd() - 0.5) * spacing * 0.8;
      const jy = y + (rnd() - 0.5) * spacing * 0.8;
      const c = Math.floor(jx / g.cell);
      const r = Math.floor(jy / g.cell);
      if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) continue;
      if (t.ground[r * g.cols + c] !== 6) continue;
      const lx = grid.west + jx - 381000;
      const lz = -(grid.north - jy - 5465000);
      const h = t.sample(lx, lz);
      if (!Number.isFinite(h)) continue;
      trees.push({ x: lx, y: h, z: lz, scale: 0.7 + rnd() * 0.45 });
    }
  }
  const grp = treeMeshes(SPECIES.forest, trees, seed, 'forest');
  grp.name = 'forest';
  grp.userData.count = trees.length;
  return grp;
}
