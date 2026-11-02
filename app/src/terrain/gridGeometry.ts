import { BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three';

/**
 * Regular grid in height-image pixel space with skirts. Interior vertices sit on texel centres
 * apron + k·spacing; the outer ring sits on the chunk's cell *edges* (apron − 0.5 and
 * apron + chunkSize − 0.5), so every chunk of every level covers exactly its nominal square
 * [i·cs·s, (i+1)·cs·s) and neighbours of different levels meet on the same line (F9).
 * The vertex shader samples heights bilinearly (edge vertices lie between two texels, which
 * both neighbours share through the apron).
 * position = (px, flag, py) where flag −1 marks skirt vertices (dropped in the vertex shader).
 * Shared by all chunks with the same LOD spacing.
 */
export function createGridGeometry(chunkSize: number, spacing: number, apron = 1): BufferGeometry {
  if (chunkSize % spacing !== 0) throw new Error(`spacing ${spacing} must divide chunkSize ${chunkSize}`);
  const n = chunkSize / spacing + 1;
  const skirtVerts = 4 * n;
  const pos = new Float32Array((n * n + skirtVerts) * 3);
  let v = 0;
  const coord = (k: number) => (k === 0 ? apron - 0.5 : k === n - 1 ? apron + chunkSize - 0.5 : apron + k * spacing);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      pos[v++] = coord(ix);
      pos[v++] = 0;
      pos[v++] = coord(iz);
    }
  }
  const surf = (ix: number, iz: number) => iz * n + ix;
  // Skirt rings: north (iz=0), south (iz=n−1), west (ix=0), east (ix=n−1).
  const edges: Array<(k: number) => number> = [
    (k) => surf(k, 0),
    (k) => surf(k, n - 1),
    (k) => surf(0, k),
    (k) => surf(n - 1, k),
  ];
  const skirtBase = n * n;
  for (let e = 0; e < 4; e++) {
    for (let k = 0; k < n; k++) {
      const s = edges[e](k) * 3;
      pos[v++] = pos[s];
      pos[v++] = -1;
      pos[v++] = pos[s + 2];
    }
  }

  const quads = (n - 1) * (n - 1) + 4 * (n - 1) * 2; // skirts double-sided
  const index = new Uint32Array(quads * 6);
  let t = 0;
  const quad = (a: number, b: number, c: number, d: number) => {
    // a=(x,z) b=(x,z+1) c=(x+1,z) d=(x+1,z+1) → CCW seen from +y
    index[t++] = a;
    index[t++] = b;
    index[t++] = c;
    index[t++] = c;
    index[t++] = b;
    index[t++] = d;
  };
  for (let iz = 0; iz < n - 1; iz++) {
    for (let ix = 0; ix < n - 1; ix++) quad(surf(ix, iz), surf(ix, iz + 1), surf(ix + 1, iz), surf(ix + 1, iz + 1));
  }
  for (let e = 0; e < 4; e++) {
    for (let k = 0; k < n - 1; k++) {
      const a = edges[e](k);
      const c = edges[e](k + 1);
      const b = skirtBase + e * n + k;
      const d = skirtBase + e * n + k + 1;
      // Both windings (cheap, avoids per-edge orientation logic).
      quad(a, b, c, d);
      index.set([a, c, b, c, d, b], t);
      t += 6;
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setIndex(new BufferAttribute(index, 1));
  // Displacement happens on the GPU; culling is done per chunk by Terrain, so bounds are nominal.
  const c = apron + chunkSize / 2;
  geo.boundingSphere = new Sphere(new Vector3(c, 0, c), chunkSize);
  return geo;
}
