/**
 * Wave 10 (audit rank 7): fair-weather cumulus and their shadows (viewer/src/clouds.ts). The GLSL mirrors the TS field
 * with an integer hash, so these tests see the clouds the GPU draws.
 */
import { describe, expect, it } from 'vitest';
import { CLOUD, CLOUD_PARS_GLSL, CLOUD_SUN_PARS_GLSL, CLOUD_TEX, cloudData, cloudHash, cloudGrid, cloudNoise, cloudOffset, cloudTop, cumulusAmount, setClouds } from '../src/clouds.ts';
import { dayOfYear, sunPosition } from '../src/sun.ts';

/** Clearing centre the viewer uses (view-east lookAt, main.ts). */
const C: [number, number] = [1226, -1120];
const GAMMA = -1.23;

function sunDir(h: number): [number, number, number] {
  const { elevation, azimuth } = sunPosition(dayOfYear(1789, 7, 15), h);
  const az = ((azimuth - GAMMA) * Math.PI) / 180;
  const e = (elevation * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(e), Math.sin(e), -Math.cos(az) * Math.cos(e)];
}

/** Share of direct sun removed at ground point (x, z) at hour h (mirrors GLSL skbCloudSun at y = ground). */
function shade(x: number, z: number, h: number): number {
  const s = sunDir(h);
  const a = cumulusAmount(h);
  if (a <= 0 || s[1] <= 0) return 0;
  return cloudTop(x, z, a, C[0], C[1]);
}

// standard poses (camera x, z, hour) of docs/visual-audit.md §2 that stand outdoors or look out of a window
const POSES: [string, number, number, number][] = [
  ['03', 1198, -1114, 10.5], ['04', 1321, -1134, 10.5], ['05', 1121.9, -942.1, 10.5], ['06', 1266.3, -1123.8, 10.5], ['09', 1198, -1114, 19.2],
  ['11', 806, -960, 10.5], ['12', 1700, -500, 10.5], ['14', 1198, -1114, 17.5], ['15', 1321, -1134, 7.0], ['16', 1369.8, -1169.4, 10.5],
  ['17', 1369.8, -1169.4, 7.0], ['18', 1303.9, -1240.5, 8.0], ['20', 1245.3, -1170.3, 10.5], ['21', 1184, -1205.1, 10.5], ['25', 1244.6, -1174.6, 10.5],
  ['27', 1270.8, -1120.9, 10.5], ['28', 1236, -1221, 10.5], ['30', 1265.2, -1067.8, 10.5], ['31', 1312.4, -979.3, 10.5], ['32', 1149.3, -1287.6, 10.5],
  ['33', 1323.6, -1166.8, 10.5], ['34', 1315.6, -1102.3, 10.5], ['35', 1285.9, -976.7, 10.5], ['36', 1868, 160, 10.5], ['37', 1283.9, -891.7, 10.5],
  ['38', 2079, 255, 10.5], ['39', 965, -865, 17.5], ['40', 970, -1030, 10.5], ['41', 1005, -1060, 10.5], ['42', 1240.2, -1054, 10.5],
  ['43', 1815, -45, 10.5], ['44', 1925, 326, 10.5], ['45', 872, -900, 10.5], ['46', 472, -897, 10.5], ['47', 1150, -1104, 17.5],
  ['48', 905, -800, 10.5], ['49', 1190, -1035, 10.5], ['50', 1524, -1282, 10.5],
];

describe('cumulus (wave 10)', () => {
  it('form with the morning thermals, thin in the evening and are gone at night [N]', () => {
    expect(cumulusAmount(6)).toBe(0);
    expect(cumulusAmount(8)).toBe(0);
    expect(cumulusAmount(10.5)).toBe(1);
    expect(cumulusAmount(15)).toBe(1);
    expect(cumulusAmount(19.2)).toBeGreaterThan(0.5);
    expect(cumulusAmount(19.2)).toBeLessThan(0.8);
    expect(cumulusAmount(21)).toBe(0);
    expect(cumulusAmount(23)).toBe(0);
    // switched off, or the sun below the horizon: amount 0 (the night sky stays clear for the stars)
    expect(setClouds(false, 12, sunDir(12), C)).toBe(0);
    expect(setClouds(true, 23, [0, -0.2, 1], C)).toBe(0);
    expect(cloudData[0]).toBe(0);
    expect(setClouds(true, 12, sunDir(12), C)).toBe(1);
    expect(cloudData[4]).toBe(CLOUD.ground + CLOUD.base);
  });

  it('the hash is an exact 32-bit integer hash in [0, 1) (identical in float32 GLSL and JS doubles)', () => {
    for (const [x, y] of [[0, 0], [-7, 3], [123456, -98765], [-1, -1]]) {
      const v = cloudHash(x, y);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(Number.isInteger(v * 4294967296)).toBe(true);
    }
    expect(cloudHash(3, 4)).not.toBe(cloudHash(4, 3));
    expect(CLOUD_PARS_GLSL).toContain('374761393u');
    expect(CLOUD_PARS_GLSL).toContain('1274126177u');
  });

  it('cover about 1–2/8 of the open plateau at full amount (12–25 % in shade)', () => {
    let n = 0;
    let shaded = 0;
    for (let x = -6000; x <= 6000; x += 60)
      for (let z = -6000; z <= 6000; z += 60) {
        if (Math.hypot(x - C[0], z - C[1]) < 1200) continue;
        n++;
        if (cloudTop(x, z, 1, C[0], C[1]) > 0.05) shaded++;
      }
    const share = shaded / n;
    expect(share).toBeGreaterThan(0.12);
    expect(share).toBeLessThan(0.25);
  });

  it('the residence keeps its sunny clearing', () => {
    for (let a = 0; a < Math.PI * 2; a += 0.3) for (const r of [0, 200, CLOUD.clear.r0 - 1]) expect(cloudTop(C[0] + r * Math.cos(a), C[1] + r * Math.sin(a), 1, C[0], C[1])).toBe(0);
  });

  it('no standard pose stands in a cloud shadow at its hour (within 200 m of the camera)', () => {
    for (const [id, x, z, h] of POSES)
      for (let r = 0; r <= 200; r += 50)
        for (let k = 0; k < (r ? 8 : 1); k++) {
          const s = shade(x + r * Math.cos((k * Math.PI) / 4), z + r * Math.sin((k * Math.PI) / 4), h);
          expect(s, `pose ${id} r ${r}`).toBeLessThanOrEqual(0.02);
        }
  });

  it('the sky field moves with the sun so each cloud sits above its shadow', () => {
    const s = sunDir(10.5);
    const off = cloudOffset(s);
    const hMid = CLOUD.base + CLOUD.thickness / 2;
    // a cloud at mid height above sky point p shades ground point p − hMid · sun.xz / sun.y; the sky reads g = p − off
    expect(off[0]).toBeCloseTo((hMid * s[0]) / s[1], 6);
    expect(off[1]).toBeCloseTo((hMid * s[2]) / s[1], 6);
    // low sun: the offset stops growing at CLOUD.minSunDeg
    const low = cloudOffset([Math.cos(0.01), Math.sin(0.01), 0]);
    expect(Math.abs(low[0])).toBeLessThan(hMid / Math.sin((CLOUD.minSunDeg * Math.PI) / 180) + 1);
  });

  it('the shadows read the same field from a baked RG texture (texel centres, row = +z), one fetch per pixel', () => {
    const n = 16;
    const ext = 4000;
    const g = cloudGrid(C[0], C[1], n, ext);
    const step = ext / n;
    for (const [i, j] of [[0, 0], [5, 9], [15, 15], [8, 2], [8, 8]]) {
      const x = C[0] - ext / 2 + (i + 0.5) * step;
      const z = C[1] - ext / 2 + (j + 0.5) * step;
      const k = (j * n + i) * 2;
      expect(Math.abs(g[k] / 255 - cloudNoise(x, z))).toBeLessThanOrEqual(0.5 / 255 + 1e-9);
      // R ramp × G = cloudTop (inside the edge fade)
      const ramp = Math.min(1, Math.max(0, ((g[k] / 255) - CLOUD.threshold) / CLOUD.soft));
      if (i > 2 && i < 13 && j > 2 && j < 13) expect(Math.abs(ramp * (g[k + 1] / 255) - cloudTop(x, z, 1, C[0], C[1]))).toBeLessThan(0.05);
    }
    // the grid fades to no shadow at its rim
    expect(g[1]).toBeLessThan(64);
    expect(cloudGrid(C[0], C[1], 512, ext)[1]).toBe(0);
    // the uniform block: texture corner and scale, the sun's parallax and the cover ramp
    const s = sunDir(12);
    setClouds(true, 12, s, C);
    expect(cloudData[12]).toBe(C[0] - CLOUD_TEX.extent / 2);
    expect(cloudData[13]).toBe(C[1] - CLOUD_TEX.extent / 2);
    expect(cloudData[14]).toBe(Math.fround(1 / CLOUD_TEX.extent));
    expect(cloudData[15]).toBeCloseTo(s[0] / s[1], 5);
    expect(cloudData[16]).toBeCloseTo(s[2] / s[1], 5);
    expect(cloudData[17]).toBeCloseTo(1 / CLOUD.soft, 4);
    expect(cloudData[18]).toBeCloseTo(-CLOUD.threshold / CLOUD.soft, 4);
    expect(CLOUD_SUN_PARS_GLSL).toContain('texture2D( uCloudTex');
    // 48 m texels: well below the cloud edge's ≈ 150 m softness
    expect(CLOUD_TEX.extent / CLOUD_TEX.size).toBeLessThan(60);
  });
});
