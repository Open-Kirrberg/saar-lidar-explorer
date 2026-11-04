import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { envelopeAxis, minEnvelope } from '../src/terrain.ts';
import { freezeSceneRoot, freezeStatic } from '../src/staticMatrices.ts';

/** Height of a grid surface triangulated like TerrainMesh (cell split along the (col+1, row) – (col, row+1) diagonal). */
function evalGrid(rowsIdx: number[], colsIdx: number[], z: (i: number, j: number) => number, r: number, c: number): number {
  let i = 0;
  while (i < rowsIdx.length - 2 && rowsIdx[i + 1] <= r) i++;
  let j = 0;
  while (j < colsIdx.length - 2 && colsIdx[j + 1] <= c) j++;
  const v = (r - rowsIdx[i]) / (rowsIdx[i + 1] - rowsIdx[i]);
  const u = (c - colsIdx[j]) / (colsIdx[j + 1] - colsIdx[j]);
  const a = z(i, j);
  const b = z(i, j + 1);
  const cc = z(i + 1, j);
  const e = z(i + 1, j + 1);
  return u + v <= 1 ? a + (b - a) * u + (cc - a) * v : e + (cc - e) * (1 - u) + (b - e) * (1 - v);
}

/** Vertex rows / cols of one TerrainMesh LOD: per chunk r0, r0 + step, …, then the chunk's last row. */
function lodAxis(n: number, chunk: number, step: number): number[] {
  const out = new Set<number>();
  for (let r0 = 0; r0 < n - 1; r0 += chunk) {
    const r1 = Math.min(n - 1, r0 + chunk);
    for (let r = r0; r < r1; r += step) out.add(r);
    out.add(r1);
  }
  return [...out].sort((a, b) => a - b);
}

describe('terrain depth pre-pass envelope (KB-I59 wave-4 review)', () => {
  const cols = 75;
  const rows = 58; // neither ends on a multiple of 8
  const h = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      h[r * cols + c] = 300 + 12 * Math.sin(c * 0.21) * Math.cos(r * 0.17) + 4 * Math.sin(c * 1.7 + r * 2.3) + (((r * 7919 + c * 104729) % 97) / 97) * 1.5;

  it('envelopeAxis: multiples of the step and the last index', () => {
    expect(envelopeAxis(17, 8)).toEqual([0, 8, 16]);
    expect(envelopeAxis(18, 8)).toEqual([0, 8, 16, 17]);
    expect(envelopeAxis(2, 8)).toEqual([0, 1]);
  });

  it('is exact on crests and tighter than the plain min envelope', () => {
    // a dome (concave): every chord lies below the surface, so the vertices keep their height
    const n = 33;
    const dome = new Float32Array(n * n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) dome[r * n + c] = 400 - 0.02 * ((r - 16) ** 2 + (c - 16) ** 2);
    const d = minEnvelope(dome, n, n, 8, 0.1);
    for (let i = 0; i < d.rowsIdx.length; i++)
      for (let j = 0; j < d.colsIdx.length; j++) expect(d.z[i * d.colsIdx.length + j]).toBeCloseTo(dome[d.rowsIdx[i] * n + d.colsIdx[j]] - 0.101, 4);
    // the rough field: on average above the minimum over each vertex's support (the plain min envelope)
    let sum = 0;
    const env = minEnvelope(h, cols, rows, 8, 0);
    const nc = env.colsIdx.length;
    for (let i = 0; i < env.rowsIdx.length; i++)
      for (let j = 0; j < nc; j++) {
        let m = Infinity;
        for (let r = env.rowsIdx[Math.max(0, i - 1)]; r <= env.rowsIdx[Math.min(env.rowsIdx.length - 1, i + 1)]; r++)
          for (let c = env.colsIdx[Math.max(0, j - 1)]; c <= env.colsIdx[Math.min(nc - 1, j + 1)]; c++) m = Math.min(m, h[r * cols + c]);
        sum += env.z[i * nc + j] - m;
      }
    expect(sum / env.z.length).toBeGreaterThan(1);
  });

  it('lies below every LOD of the colour terrain (steps 1, 2, 4, 8), everywhere', () => {
    const env = minEnvelope(h, cols, rows, 8, 0);
    const nc = env.colsIdx.length;
    const coarse = (i: number, j: number) => env.z[i * nc + j];
    const fine = (rIdx: number[], cIdx: number[]) => (i: number, j: number) => h[rIdx[i] * cols + cIdx[j]];
    let worst = -Infinity;
    for (const step of [1, 2, 4, 8]) {
      const rIdx = lodAxis(rows, 16, step);
      const cIdx = lodAxis(cols, 16, step);
      const zf = fine(rIdx, cIdx);
      for (let r = 0; r <= rows - 1; r += 0.25)
        for (let c = 0; c <= cols - 1; c += 0.25) {
          const d = evalGrid(env.rowsIdx, env.colsIdx, coarse, r, c) - evalGrid(rIdx, cIdx, zf, r, c);
          worst = Math.max(worst, d);
        }
    }
    expect(worst).toBeLessThanOrEqual(1e-4);
    // and it is not trivially low: within the local relief of the field
    expect(Math.min(...env.z)).toBeGreaterThan(270);
  });

  it('ignores non-finite samples', () => {
    const g = new Float32Array(9 * 9).fill(100);
    g[4 * 9 + 4] = NaN;
    g[0] = 90;
    const env = minEnvelope(g, 9, 9, 4, 0);
    expect(env.z.every(Number.isFinite)).toBe(true);
    expect(env.z[0]).toBeCloseTo(90 - 1e-3, 4);
    expect(env.z[4]).toBeCloseTo(90 - 1e-3, 4); // the NaN vertex takes the minimum of its cells
    expect(env.z[8]).toBeCloseTo(100 - 1e-3, 4);

  });
});

describe('static scene matrices (wave-4 review, CPU)', () => {
  it('freezes static objects with correct world matrices, keeps self-updating ones live', () => {
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    root.position.set(10, 0, 0);
    const child = new THREE.Mesh();
    child.position.set(0, 5, 0);
    const jet = new THREE.Mesh();
    jet.onBeforeRender = () => {};
    root.add(child, jet);
    scene.add(root);
    expect(freezeStatic(root)).toBe(2);
    expect(jet.matrixAutoUpdate).toBe(true);
    freezeSceneRoot(scene);
    scene.updateMatrixWorld();
    expect(new THREE.Vector3().setFromMatrixPosition(child.matrixWorld).toArray()).toEqual([10, 5, 0]);
    // an object added later keeps three's default and still follows its own transform
    const late = new THREE.Mesh();
    root.add(late);
    late.position.set(1, 2, 3);
    scene.updateMatrixWorld();
    expect(new THREE.Vector3().setFromMatrixPosition(late.matrixWorld).toArray()).toEqual([11, 2, 3]);
    jet.scale.set(3, 1, 3);
    scene.updateMatrixWorld();
    expect(jet.matrixWorld.elements[0]).toBe(3);
    // frozen: no per-frame recompose, the scene root no longer forces the tree
    child.matrixWorld.elements[13] = -1;
    scene.updateMatrixWorld();
    expect(child.matrixWorld.elements[13]).toBe(-1);
  });
});
