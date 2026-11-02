/**
 * Room environment (Festsaal review, wave 2): the daylight room env is contrasty (bright window band, darker dado
 * and floor) so gilding reads as metal, but the ceiling still gets enough bounce to stay light.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ROOM_WINDOW_COLUMNS, roomEnvIrradiance, roomEnvironment, roomEnvironmentGrid } from '../src/interior/materials.ts';

const lum = (c: ArrayLike<number>) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const texel = (g: ReturnType<typeof roomEnvironmentGrid>, x: number, y: number) => g.rgb.subarray((y * g.w + x) * 3, (y * g.w + x) * 3 + 3);

describe('room environment (day)', () => {
  const g = roomEnvironmentGrid('day');

  it('has a bright window band and a darker lower room', () => {
    const win = lum(texel(g, ROOM_WINDOW_COLUMNS[0], 3));
    const pier = lum(texel(g, 3, 3));
    const dado = lum(texel(g, 3, 5));
    const ceiling = lum(texel(g, 3, 0));
    expect(win / dado).toBeGreaterThan(8);
    expect(win / pier).toBeGreaterThan(8);
    expect(ceiling).toBeGreaterThan(dado * 1.5);
  });

  it('keeps the ceiling light: down-facing irradiance ≥ 0.5 of the floor, near neutral', () => {
    const up = roomEnvIrradiance(g, [0, 1, 0]);
    const down = roomEnvIrradiance(g, [0, -1, 0]);
    expect(lum(down) / lum(up)).toBeGreaterThan(0.5);
    expect(down[0] / down[2]).toBeLessThan(1.3); // no brown ceiling
    // the floor (parquet bounce) is warm, never blue
    const floor = texel(g, 3, 6);
    expect(floor[0]).toBeGreaterThan(floor[2]);
  });

  it('a uniform environment integrates to its own radiance', () => {
    const flat = { w: 16, h: 8, rgb: new Float32Array(16 * 8 * 3).fill(0.5), meanLuminance: 0.5 };
    for (const n of [[0, 1, 0], [1, 0, 0], [0, 0, -1]] as [number, number, number][]) {
      const e = roomEnvIrradiance(flat, n);
      expect(e[0]).toBeCloseTo(0.5, 1);
    }
  });

  it('builds a linear half-float equirect texture carrying its mean luminance', () => {
    const t = roomEnvironment('day');
    expect(t.type).toBe(THREE.HalfFloatType);
    expect(t.colorSpace).toBe(THREE.LinearSRGBColorSpace);
    expect(t.mapping).toBe(THREE.EquirectangularReflectionMapping);
    expect(t.userData.meanLuminance).toBeCloseTo(g.meanLuminance, 6);
    expect(roomEnvironment('day')).toBe(t); // cached
  });
});

describe('room environment (night)', () => {
  it('is dark and warm with bright candle texels', () => {
    const g = roomEnvironmentGrid('night');
    expect(g.meanLuminance).toBeLessThan(roomEnvironmentGrid('day').meanLuminance);
    const candle = g.rgb.subarray(0, 3); // row 0, x 0: a chandelier candle
    expect(lum(candle)).toBeGreaterThan(g.meanLuminance * 5);
    expect(candle[0]).toBeGreaterThan(candle[2]);
  });
});
