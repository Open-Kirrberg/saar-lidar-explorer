import { describe, expect, it } from 'vitest';
import {
  E0,
  N0,
  azimuthOf,
  dirLocal,
  enToLatLon,
  enToLocal,
  gridConvergenceDeg,
  gridFrame,
  gridToTrueAzimuth,
  localToEN,
  rotationYForAzimuth,
  trueNorthLocal,
  trueToGridAzimuth,
} from '../src/frame.ts';
import { readCatalogueV1 } from './helpers.ts';

const MM = 1e-3;
const spec = readCatalogueV1();
const grid = gridFrame(spec.palace_grid);

/** three.js rotation about +y applied to a vector (same formula as Object3D.rotation.y). */
function rotY(theta: number, v: { x: number; y: number; z: number }) {
  return { x: v.x * Math.cos(theta) + v.z * Math.sin(theta), y: v.y, z: -v.x * Math.sin(theta) + v.z * Math.cos(theta) };
}

describe('EN <-> local', () => {
  it('uses the karlsberg AOI origin and axis flip', () => {
    expect(E0).toBe(381000);
    expect(N0).toBe(5465000);
    expect(enToLocal(382226, 5466120, 344.8)).toEqual({ x: 1226, y: 344.8, z: -1120 });
  });

  it('round-trips below 1 mm across the AOI', () => {
    for (let i = 0; i < 200; i++) {
      const E = 381000 + ((i * 7919) % 3000) + 0.123456;
      const N = 5464500 + ((i * 104729) % 3500) + 0.654321;
      const l = enToLocal(E, N);
      const [E2, N2] = localToEN(l.x, l.z);
      expect(Math.abs(E2 - E)).toBeLessThan(MM);
      expect(Math.abs(N2 - N)).toBeLessThan(MM);
    }
  });
});

describe('palace grid', () => {
  it('matches the coefficients written in catalogue.palace_grid.note', () => {
    // E = E0+u*0.98629-v*0.16505; N = N0+u*0.16505+v*0.98629
    expect(grid.uDir[0]).toBeCloseTo(0.98629, 5);
    expect(grid.uDir[1]).toBeCloseTo(0.16505, 5);
    expect(grid.vDir[0]).toBeCloseTo(-0.16505, 5);
    expect(grid.vDir[1]).toBeCloseTo(0.98629, 5);
    expect(grid.toEN(0, 0)).toEqual([382226, 5466120]);
  });

  it('round-trips (u, v) <-> EN below 1 mm', () => {
    for (let u = -400; u <= 800; u += 37.3) {
      for (let v = -1500; v <= 700; v += 91.7) {
        const [E, N] = grid.toEN(u, v);
        const [u2, v2] = grid.toUV(E, N);
        expect(Math.abs(u2 - u)).toBeLessThan(MM);
        expect(Math.abs(v2 - v)).toBeLessThan(MM);
      }
    }
  });

  it('reproduces the CdL corner given in research/05 (u 28.2..46.2, v -37.3..40.6)', () => {
    const cdl = spec.buildings.find((b) => b.id === 'KB-B01')!;
    const uv = cdl.footprint!.map(([E, N]) => grid.toUV(E, N));
    const us = uv.map((p) => p[0]);
    const vs = uv.map((p) => p[1]);
    expect(Math.min(...us)).toBeCloseTo(28.2, 0);
    expect(Math.max(...us)).toBeCloseTo(46.2, 0);
    expect(Math.min(...vs)).toBeCloseTo(-37.3, 0);
    expect(Math.max(...vs)).toBeCloseTo(40.6, 0);
  });
});

describe('azimuths and north', () => {
  it('azimuthOf / dirLocal agree with the local axis flip', () => {
    expect(azimuthOf(0, 1)).toBeCloseTo(0);
    expect(azimuthOf(1, 0)).toBeCloseTo(90);
    expect(azimuthOf(0, -1)).toBeCloseTo(180);
    expect(azimuthOf(-1, 0)).toBeCloseTo(270);
    const n = dirLocal(0);
    expect(n.x).toBeCloseTo(0);
    expect(n.z).toBeCloseTo(-1);
    const e = dirLocal(90);
    expect(e.x).toBeCloseTo(1);
    expect(e.z).toBeCloseTo(0);
  });

  it('rotationYForAzimuth turns local -z (grid north) to the azimuth', () => {
    for (const az of [0, 30, 80.5, 170.5, 260, 350.5]) {
      const r = rotY(rotationYForAzimuth(az), { x: 0, y: 0, z: -1 });
      const d = dirLocal(az);
      expect(r.x).toBeCloseTo(d.x, 9);
      expect(r.z).toBeCloseTo(d.z, 9);
    }
  });

  it('geographic position of the Ehrenhof is ~49.33 N, 7.37 E', () => {
    const [lat, lon] = enToLatLon(382226, 5466120);
    expect(lat).toBeGreaterThan(49.3);
    expect(lat).toBeLessThan(49.36);
    expect(lon).toBeGreaterThan(7.33);
    expect(lon).toBeLessThan(7.4);
  });

  it('UTM inverse matches a reference point (zone 32 central meridian, equator)', () => {
    const [lat, lon] = enToLatLon(500000, 0);
    expect(lat).toBeCloseTo(0, 9);
    expect(lon).toBeCloseTo(9, 9);
  });

  it('grid convergence ≈ catalogue value and converts the palace axis to 79.3° true', () => {
    const [E, N] = spec.palace_grid.origin_EN;
    const g = gridConvergenceDeg(E, N);
    expect(g).toBeCloseTo(spec.palace_grid.grid_convergence_deg!, 1);
    expect(gridToTrueAzimuth(80.5, E, N)).toBeCloseTo(spec.palace_grid.u_azimuth_true_deg!, 1);
    expect(trueToGridAzimuth(gridToTrueAzimuth(123.4, E, N), E, N)).toBeCloseTo(123.4, 9);
    const tn = trueNorthLocal(E, N);
    expect(Math.hypot(tn.x, tn.z)).toBeCloseTo(1, 12);
    expect(tn.x).toBeGreaterThan(0); // true north points slightly east of grid north (W of the CM)
  });
});
