import { describe, expect, it, vi } from 'vitest';
import { validateManifest } from '../src/data/manifest';
import {
  CROWN_SCALE_MAX,
  TREE_LODS,
  bandRange,
  crownScale,
  displayY,
  lodBand,
  lodKeeps,
  lodParams,
  prefixCount,
  rankThreshold,
  treeAnchor,
  treeDensity,
  treeFalloff,
  treeVisibility,
} from '../src/trees/lod';
import {
  TREE_FILL_FLAG,
  TREE_STRIDE,
  TreeKind,
  buildInstanceRows,
  decodeTrees,
  encodeTrees,
  fmix32,
  gatherRows,
  isFillTree,
  parseTrees,
  rowBounds,
  treeChunkRef,
  treeId,
  treeKind,
  treeRank,
} from '../src/trees/treeData';
import type { TreeRecordIn } from '../src/trees/treeData';
import { TREE_SHAPES, latheArrays } from '../src/trees/treeShapes';

/** Overall-like grid: origin 378000/5460000, 6000 × 8000 m, 500 m chunks. */
const GRID = { origin: { E0: 378000, N0: 5460000 }, size: { width: 6000, height: 8000 }, chunkSize: 500, cellSize: 1 };

/** Deterministic pseudo-random trees at cell centres of chunk (i, j). */
function makeTrees(i: number, j: number, n: number, seed = 1): TreeRecordIn[] {
  const ref = treeChunkRef(GRID, i, j);
  const out: TreeRecordIn[] = [];
  const used = new Set<string>();
  let s = seed;
  const rnd = () => ((s = fmix32(s + 0x9e3779b9)) / 4294967296);
  while (out.length < n) {
    const c = Math.floor(rnd() * 500);
    const r = Math.floor(rnd() * 500);
    if (used.has(`${c}/${r}`)) continue;
    used.add(`${c}/${r}`);
    out.push({
      E: ref.west + c + 0.5,
      N: ref.south + r + 0.5,
      ground: 300 + rnd() * 80,
      height: 3 + rnd() * 40,
      radius: 0.6 + rnd() * 10,
      type: Math.floor(rnd() * 3) | (rnd() < 0.1 ? TREE_FILL_FLAG : 0),
    });
  }
  return out;
}

describe('trees: ids, hash, decode (contract sle-trees-v1)', () => {
  it('fmix32 matches MurmurHash3 fmix32', () => {
    expect(fmix32(0)).toBe(0);
    expect(fmix32(1)).toBe(0x514e28b7);
    expect(fmix32(0x12345678)).toBe(0xe37cd1bc);
  });

  it('id = (Ec mod 65536) << 16 | (Nc mod 65536) from the top-cell corner', () => {
    expect(treeId(382556.5, 5465632.5)).toBe((((382556 % 65536) << 16) | (5465632 % 65536)) >>> 0);
    expect(treeRank(treeId(382556.5, 5465632.5))).toBeGreaterThanOrEqual(0);
    expect(treeRank(treeId(382556.5, 5465632.5))).toBeLessThan(1);
  });

  it('chunk edges: E = E0 + i·500, N = N0 + height − (j+1)·500', () => {
    expect(treeChunkRef(GRID, 3, 4)).toEqual({ i: 3, j: 4, west: 379500, south: 5465500 });
  });

  it('encode → decode round trip, records sorted by fmix32(id)', () => {
    const recs = makeTrees(3, 4, 400);
    const ref = treeChunkRef(GRID, 3, 4);
    const buf = encodeTrees(recs, ref);
    expect(buf.byteLength).toBe(16 + 10 * 400);
    const t = decodeTrees(buf, ref);
    expect(t.count).toBe(400);
    for (let k = 1; k < t.count; k++) expect(fmix32(t.id[k])).toBeGreaterThanOrEqual(fmix32(t.id[k - 1]));
    for (let k = 1; k < t.count; k++) expect(t.rank[k]).toBeGreaterThanOrEqual(t.rank[k - 1]);
    const byId = new Map(recs.map((r) => [treeId(r.E, r.N), r]));
    for (let k = 0; k < t.count; k++) {
      const r = byId.get(t.id[k])!;
      expect(t.E[k]).toBeCloseTo(r.E, 6);
      expect(t.N[k]).toBeCloseTo(r.N, 6);
      expect(t.ground[k]).toBeCloseTo(r.ground, 1);
      expect(Math.abs(t.height[k] - r.height)).toBeLessThanOrEqual(0.005 + 1e-6);
      expect(Math.abs(t.radius[k] - r.radius)).toBeLessThanOrEqual(0.05 + 1e-6);
      expect(t.type[k]).toBe(r.type);
      // positions on the grid: x, y ≡ 5 (mod 10) dm
      expect(((t.E[k] - ref.west) * 10) % 10).toBeCloseTo(5, 6);
    }
  });

  it('type: base kind + fill flag; unknown codes read as unknown', () => {
    expect(treeKind(1)).toBe(TreeKind.Conifer);
    expect(treeKind(2 | TREE_FILL_FLAG)).toBe(TreeKind.Broadleaf);
    expect(treeKind(5)).toBe(TreeKind.Unknown);
    expect(isFillTree(1 | TREE_FILL_FLAG)).toBe(true);
    expect(isFillTree(1)).toBe(false);
  });

  it('header checks: magic, version, size', () => {
    const ref = treeChunkRef(GRID, 0, 0);
    const good = encodeTrees(makeTrees(0, 0, 3), ref);
    const bad = (mut: (dv: DataView) => void, len = good.byteLength) => {
      const b = good.slice(0, len);
      mut(new DataView(b));
      return () => decodeTrees(b, ref);
    };
    expect(bad((dv) => dv.setUint8(0, 0x41))).toThrow(/magic/);
    expect(bad((dv) => dv.setUint16(4, 2, true))).toThrow(/version/);
    expect(bad(() => {}, good.byteLength - 1)).toThrow(/size/);
    expect(bad(() => {}, 10)).toThrow(/header/);
  });
});

describe('trees: manifest tolerance', () => {
  const grid = { nx: 12, ny: 16 };
  const ok = { format: 'sle-trees-v1', path: 'trees/{i}_{j}.bin', chunks: [[0, 0, 5], [11, 15, 1]], count: 6, fill: 1, fillFlag: 128 };

  it('parses a valid key', () => {
    const t = parseTrees(ok, grid)!;
    expect(t.chunks).toEqual([[0, 0, 5], [11, 15, 1]]);
    expect(t.count).toBe(6);
  });

  it('missing / wrong format / bad path → absent; bad chunks skipped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseTrees(undefined, grid)).toBeUndefined();
    expect(parseTrees('x', grid)).toBeUndefined();
    expect(parseTrees({ ...ok, format: 'sle-trees-v2' }, grid)).toBeUndefined();
    expect(parseTrees({ ...ok, path: 'trees/x.bin' }, grid)).toBeUndefined();
    const t = parseTrees({ ...ok, chunks: [[0, 0, 5], [12, 0, 3], [1, 1, 0], [1.5, 2, 3], 'x', [2, 2]] }, grid)!;
    expect(t.chunks).toEqual([[0, 0, 5]]);
    warn.mockRestore();
  });

  it('validateManifest keeps a valid `trees` and drops an invalid one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const base = {
      version: 1, aoi: 'x', name: 'x', crs: 'EPSG:25832', origin: { E0: 0, N0: 0 }, size: { width: 1000, height: 1000 },
      cellSize: 1, chunkSize: 500, chunks: { nx: 2, ny: 2 }, heightRange: { min: 0, max: 1 },
      height: { dtm: { path: 'dtm/{i}_{j}.png', encoding: 'terrarium', apron: 1 } }, layers: {},
    };
    expect(validateManifest({ ...base, trees: { ...ok, chunks: [[1, 1, 2]] } }).trees?.chunks).toEqual([[1, 1, 2]]);
    expect(validateManifest({ ...base, trees: { ...ok, format: 'nope' } }).trees).toBeUndefined();
    expect(validateManifest(base).trees).toBeUndefined();
    warn.mockRestore();
  });
});

describe('trees: instance rows (world frame)', () => {
  it('x = E − E0, z = −(N − N0), g true ground, kind + 4·fill', () => {
    const ref = treeChunkRef(GRID, 5, 2);
    const t = decodeTrees(encodeTrees(makeTrees(5, 2, 50), ref), ref);
    const rows = buildInstanceRows(t, GRID.origin);
    expect(rows.length).toBe(50 * TREE_STRIDE);
    for (let k = 0; k < t.count; k++) {
      const o = k * TREE_STRIDE;
      expect(rows[o]).toBeCloseTo(t.E[k] - 378000, 3);
      expect(rows[o + 2]).toBeCloseTo(-(t.N[k] - 5460000), 3);
      expect(rows[o + 1]).toBe(t.ground[k]);
      expect(rows[o + 5]).toBe(t.rank[k]);
      expect(rows[o + 7]).toBe(treeKind(t.type[k]) + (isFillTree(t.type[k]) ? 4 : 0));
    }
    const b = rowBounds(rows);
    expect(b.xMin).toBeGreaterThanOrEqual(2500);
    expect(b.xMax).toBeLessThanOrEqual(3000);
    expect(b.zMax).toBeLessThanOrEqual(-6500);
    expect(b.zMin).toBeGreaterThanOrEqual(-7000);
  });
});

describe('trees: LOD by stable id — no popping', () => {
  const ref = treeChunkRef(GRID, 4, 6);
  const t = decodeTrees(encodeTrees(makeTrees(4, 6, 2000, 7), ref), ref);
  const rows = buildInstanceRows(t, GRID.origin);

  for (const veg of [700, 1000, 1500, 2000]) {
    const p = lodParams(veg);
    it(`params for vegetation ${veg} m: bands ordered, no overlap`, () => {
      expect(p.near[0]).toBeLessThan(p.near[1]);
      expect(p.near[1]).toBeLessThan(p.mid[0]);
      expect(p.mid[0]).toBeLessThan(p.mid[1]);
      expect(p.mid[1]).toBeLessThan(p.max);
      expect(p.full).toBeGreaterThanOrEqual(p.mid[1]); // existence fade never overlaps a shape cross-fade
    });

    it(`density non-increasing, 1 up to full, 0 at max (veg ${veg})`, () => {
      let prev = Infinity;
      for (let d = 0; d <= p.max + 100; d += 7) {
        const D = treeDensity(d, p);
        expect(D).toBeLessThanOrEqual(prev + 1e-12);
        prev = D;
        if (d <= p.full) expect(D).toBeCloseTo(1, 12);
      }
      expect(treeDensity(p.max, p)).toBe(0);
    });

    it(`visibility: monotone when approaching; every rank fully visible at D = 1 (veg ${veg})`, () => {
      for (let k = 0; k < t.count; k += 37) {
        let prev = -1;
        for (let d = p.max + 50; d >= 0; d -= 11) {
          const v = treeVisibility(t.rank[k], d, p);
          expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
          prev = v;
        }
        expect(treeVisibility(t.rank[k], 0, p)).toBe(1);
      }
    });

    it(`drawRange prefix is conservative and nested (veg ${veg})`, () => {
      let prevN = Infinity;
      for (let dMin = 0; dMin <= p.max + 50; dMin += 23) {
        const n = prefixCount(t.rank, rankThreshold(treeDensity(dMin, p), p));
        expect(n).toBeLessThanOrEqual(prevN); // farther chunk → a prefix of the nearer one
        prevN = n;
        // Any tree at distance ≥ dMin with visibility > 0 lies inside the prefix.
        for (let k = n; k < t.count; k++) expect(treeVisibility(t.rank[k], dMin, p)).toBe(0);
      }
    });

    it(`crown scale: 1 where shapes cross-fade, continuous, keeps cover until the cap (veg ${veg})`, () => {
      let prev = 1;
      for (let d = 0; d <= p.max; d += 5) {
        const s = crownScale(d, p);
        if (d <= p.mid[1]) expect(s).toBe(1);
        expect(s).toBeGreaterThanOrEqual(prev - 1e-12); // non-decreasing
        expect(s - prev).toBeLessThan(0.02); // no jump
        expect(s).toBeLessThanOrEqual(CROWN_SCALE_MAX);
        if (s < CROWN_SCALE_MAX) expect(treeFalloff(d, p) * s * s).toBeCloseTo(1, 9);
        prev = s;
      }
    });

    it(`cross-fade: exactly one mesh keeps each pixel at every distance (veg ${veg})`, () => {
      const bands = TREE_LODS.map((l) => lodBand(l, p));
      for (let d = 0; d <= p.max; d += 3.7) {
        for (let tt = 0; tt < 1; tt += 1 / 64) {
          const keeps = bands.filter((b) => lodKeeps(b, d, tt)).length;
          expect(keeps).toBe(1);
        }
      }
      for (const l of TREE_LODS) {
        const [a, b] = bandRange(lodBand(l, p), p);
        expect(a).toBeLessThan(b);
      }
    });
  }

  it('a tree has the same anchor in every LOD mesh and at every exaggeration step', () => {
    const near = gatherRows([rows], 2250, -6750, 1e6, new Float32Array(16));
    expect(near.count).toBe(t.count);
    for (let k = 0; k < t.count; k += 13) {
      const o = k * TREE_STRIDE;
      // The near mesh reads a verbatim copy of the chunk row; mid/far read the chunk row itself.
      const id = t.id[k];
      const nearK = [...Array(near.count).keys()].find((q) => near.rows[q * TREE_STRIDE + 5] === rows[o + 5] && near.rows[q * TREE_STRIDE] === rows[o])!;
      expect(Array.from(near.rows.subarray(nearK * TREE_STRIDE, nearK * TREE_STRIDE + TREE_STRIDE))).toEqual(Array.from(rows.subarray(o, o + TREE_STRIDE)));
      for (const exag of [1, 2.5, 5]) {
        const a = treeAnchor(rows, o, 330, exag);
        const b = treeAnchor(near.rows, nearK * TREE_STRIDE, 330, exag);
        expect(a).toEqual(b);
        expect(a[1]).toBeCloseTo(displayY(t.ground[k], 330, exag), 4);
      }
      expect(treeId(t.E[k], t.N[k])).toBe(id);
    }
  });

  it('gather: only rows within the radius, copied verbatim, buffer grows', () => {
    const cx = rows[0];
    const cz = rows[2];
    const res = gatherRows([rows], cx, cz, 60, new Float32Array(TREE_STRIDE));
    for (let q = 0; q < res.count; q++) {
      const dx = res.rows[q * TREE_STRIDE] - cx;
      const dz = res.rows[q * TREE_STRIDE + 2] - cz;
      expect(dx * dx + dz * dz).toBeLessThanOrEqual(3600);
    }
    let expected = 0;
    for (let o = 0; o < rows.length; o += TREE_STRIDE) if ((rows[o] - cx) ** 2 + (rows[o + 2] - cz) ** 2 <= 3600) expected++;
    expect(res.count).toBe(expected);
    expect(res.count).toBeGreaterThan(0);
  });
});

describe('trees: lathe shapes', () => {
  for (const lod of TREE_LODS) {
    it(`${lod}: one profile length for all kinds, indices in range, CCW from outside`, () => {
      const s = TREE_SHAPES[lod];
      const seq = s.profiles[0].length;
      for (const p of s.profiles) {
        expect(p.length).toBe(seq);
        expect(p[0][1]).toBe(0); // bottom centre
        expect(p[seq - 1]).toEqual([1, 0]); // apex at the top
      }
      const a = latheArrays(s.sides, seq, s.trunkSides);
      const nv = a.position.length / 3;
      expect(nv).toBeLessThan(65536);
      for (const i of a.index) expect(i).toBeLessThan(nv);
      expect(a.triangles).toBe(a.index.length / 3);
      // Outward winding for a straight cylinder band (profile [0,1]→[1,1]) evaluated with radius = 1.
      const cyl = latheArrays(8, 4, 0);
      const P = [[0.0, 0], [0.0, 1], [1.0, 1], [1, 0]];
      const pos = (v: number) => {
        const [h, r] = P[cyl.position[v * 3 + 1]];
        return [cyl.position[v * 3] * r, h, cyl.position[v * 3 + 2] * r];
      };
      for (let k = 0; k < cyl.index.length; k += 3) {
        const [A, B, C] = [pos(cyl.index[k]), pos(cyl.index[k + 1]), pos(cyl.index[k + 2])];
        const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
        const v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const c = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
        const out = [c[0], c[1] - 0.5, c[2]]; // from the solid's centre outwards
        expect(n[0] * out[0] + n[1] * out[1] + n[2] * out[2]).toBeGreaterThan(0);
      }
    });
  }

  it('triangle budget per tree: near ≤ 140, mid ≤ 50, far ≤ 20', () => {
    const tri = (l: 'near' | 'mid' | 'far') => latheArrays(TREE_SHAPES[l].sides, TREE_SHAPES[l].profiles[0].length, TREE_SHAPES[l].trunkSides).triangles;
    expect(tri('near')).toBeLessThanOrEqual(140);
    expect(tri('mid')).toBeLessThanOrEqual(50);
    expect(tri('far')).toBeLessThanOrEqual(20);
  });
});
