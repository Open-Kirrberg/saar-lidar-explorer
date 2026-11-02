/**
 * KB-I35 (wave 7): the 3D vines stand on the rows and plant phase the ground shader paints (VINE_GLSL), off the
 * contour walks, inside the parcel; the geometry budget per plant is fixed.
 */
import { describe, expect, it } from 'vitest';
import { VINEYARD } from '@model/layout/grammar.ts';
import { vineGeometry, vinePlants, walkDistance } from '@model/site/vines.ts';
import { VINE_GLSL } from '../src/landcoverBake.ts';
import { NEAR_DETAIL, VINE_CARDS, vineLeafColour } from '../src/vines.ts';

const across: [number, number] = [-0.880, -0.475];
const n = Math.hypot(...across);
const A: [number, number] = [across[0] / n, across[1] / n];
// a skewed quadrilateral (local x, z), ~60 × 40 m, open ring
const ring: [number, number][] = [
  [700, -900],
  [760, -905],
  [765, -950],
  [705, -940],
];

describe('vinePlants (model/site/vines.ts)', () => {
  const xz = vinePlants([ring], A);
  const pts = Array.from({ length: xz.length / 2 }, (_, i) => [xz[i * 2], xz[i * 2 + 1]] as const);

  it('fills the parcel at about one stake per 1.1 m² (minus walks and the inset)', () => {
    expect(pts.length).toBeGreaterThan(1500);
    expect(pts.length).toBeLessThan(2600);
  });

  it('puts every stake on a row centre and on the shader plant phase', () => {
    for (const [x, z] of pts) {
      const q = (x * A[0] + z * A[1]) / VINEYARD.rowDistance;
      expect(Math.abs(q - Math.floor(q) - 0.5)).toBeLessThan(1e-3);
      const along = x * -A[1] + z * A[0];
      // VINE_GLSL: plant = cos(2π (along + 0.37 floor(q))) peaks on the stake
      expect(Math.cos(2 * Math.PI * (along + VINEYARD.rowShift * Math.floor(q)))).toBeGreaterThan(0.9999);
    }
  });

  it('keeps the contour walks free and stays inside the outline by the inset', () => {
    for (const [x, z] of pts) {
      const along = x * -A[1] + z * A[0];
      expect(walkDistance(along)).toBeGreaterThanOrEqual(VINEYARD.walk / 2 + 0.3 - 1e-3);
    }
    const xs = pts.map((p) => p[0]);
    expect(Math.min(...xs)).toBeGreaterThan(700);
    expect(Math.max(...xs)).toBeLessThan(765);
  });

  it('is deterministic and honours accept / max', () => {
    expect(Array.from(vinePlants([ring], A))).toEqual(Array.from(xz));
    const half = vinePlants([ring], A, { accept: (x) => x < 730 });
    expect(half.length).toBeLessThan(xz.length);
    for (let i = 0; i < half.length; i += 2) expect(half[i]).toBeLessThan(730);
    expect(vinePlants([ring], A, { max: 10 }).length).toBe(20);
  });

  it('walkDistance measures to the nearest walk centre', () => {
    expect(walkDistance(0)).toBeCloseTo(0);
    expect(walkDistance(29.5)).toBeCloseTo(0.5);
    expect(walkDistance(15)).toBeCloseTo(15);
    expect(walkDistance(-31)).toBeCloseTo(1);
  });

  it('uses the same row constants as the ground shader', () => {
    expect(VINE_GLSL).toContain(`/ ${VINEYARD.rowDistance}`);
    expect(VINE_GLSL).toContain(`${VINEYARD.rowShift} * floor(q)`);
    expect(VINE_GLSL).toContain(`along / ${VINEYARD.walkEvery}.0`);
  });
});

describe('vineGeometry', () => {
  it('has the fixed triangle budget per plant (near 88, far 24) and bark-tagged stakes', () => {
    const near = vineGeometry(1789, 1, 4, true);
    const far = vineGeometry(1789, 0, 2, true, 1.3);
    expect(near.attributes.position.count / 3).toBe(8 + 4 * 20);
    expect(far.attributes.position.count / 3).toBe(8 + 2 * 8);
    const w = near.attributes.crown;
    let bark = 0;
    for (let i = 0; i < w.count; i++) if (w.getW(i) < -0.5) bark++;
    expect(bark).toBe(24);
    near.computeBoundingBox();
    expect(near.boundingBox!.max.y).toBeCloseTo(VINEYARD.stakeHeight, 5);
    expect(near.boundingBox!.max.x).toBeLessThan(VINEYARD.canopyR * 1.4);
  });

  it('is deterministic per seed', () => {
    const a = vineGeometry(7, 1).attributes.position.array;
    const b = vineGeometry(7, 1).attributes.position.array;
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe('viewer vines', () => {
  it('leaf cards are gone before the near tier hands over, and the colour matches the painted leaf', () => {
    expect(VINE_CARDS.far).toBeLessThanOrEqual(NEAR_DETAIL);
    expect(NEAR_DETAIL).toBeLessThan(VINEYARD.near - VINEYARD.fade);
    const c = vineLeafColour();
    expect(c.g).toBeGreaterThan(c.r);
    expect(c.g).toBeGreaterThan(c.b);
  });
});
