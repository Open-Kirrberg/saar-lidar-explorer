/**
 * Procedural parquet de Versailles (Festsaal review, wave 2): ≈ 1 m panels laid at 45°, a frame, an interlaced
 * diagonal lattice and short field boards; joints everywhere a board ends.
 */
import { describe, expect, it } from 'vitest';
import { PARQUET_FRAME, PARQUET_GLSL, PARQUET_PANEL, PARQUET_STRIP, parquetCell } from '../src/materials/parquet.ts';
import { silkColour, BOISERIE_SILK } from '../src/interior/evidence.ts';

const R2 = Math.SQRT1_2;
/** floor point (m) of panel-frame coordinates (u, v) in panel (i, j) — inverse of the 45° laying rotation */
const at = (i: number, j: number, u: number, v: number): [number, number] => {
  const qx = i * PARQUET_PANEL + u;
  const qy = j * PARQUET_PANEL + v;
  return [(qx - qy) * R2, (qx + qy) * R2];
};

describe('parquet de Versailles', () => {
  it('panels are 1.0–1.1 m (research/02 §3) and repeat exactly', () => {
    expect(PARQUET_PANEL).toBeGreaterThanOrEqual(0.95); // KB-I26: 3 pieds = 0.974 m
    expect(PARQUET_PANEL).toBeLessThanOrEqual(1.1);
    for (const [u, v] of [
      [0.03, 0.5],
      [0.5, 0.5],
      [0.31, 0.62],
      [0.8, 0.2],
    ]) {
      const a = parquetCell(...at(0, 0, u, v));
      const b = parquetCell(...at(3, -2, u, v));
      expect(b.kind).toBe(a.kind);
      expect(b.id).toBe(a.id);
      expect(b.dir[0]).toBeCloseTo(a.dir[0], 9);
      expect(b.panel).toEqual([3, -2]);
    }
  });

  it('a frame runs along each panel edge; boards inside are on the diagonal', () => {
    const edge = parquetCell(...at(0, 0, 0.5, 0.02));
    expect(edge.kind).toBe('frame');
    expect(edge.dir).toEqual([1, 0]);
    const side = parquetCell(...at(0, 0, 0.02, 0.5));
    expect(side.dir).toEqual([0, 1]);
    const centre = parquetCell(...at(0, 0, PARQUET_PANEL / 2, PARQUET_PANEL / 2));
    expect(centre.kind).toBe('strip'); // the lattice crosses at the panel centre
    for (const p of [centre, parquetCell(...at(0, 0, 0.3, 0.45)), parquetCell(...at(0, 0, 0.7, 0.4))]) {
      if (p.kind === 'frame') continue;
      expect(Math.abs(Math.abs(p.dir[0]) - R2)).toBeLessThan(1e-9);
      expect(Math.abs(Math.abs(p.dir[1]) - R2)).toBeLessThan(1e-9);
    }
  });

  it('has joints at the frame edge, between frame and field, and none mid-board', () => {
    expect(parquetCell(...at(0, 0, 0.5, 0.0005)).gap).toBeLessThan(0.001); // panel edge
    expect(parquetCell(...at(0, 0, 0.5, PARQUET_FRAME - 0.0005)).gap).toBeLessThan(0.001); // frame / field
    expect(parquetCell(...at(0, 0, 0.5, PARQUET_FRAME / 2)).gap).toBeGreaterThan(0.02); // mid frame board
    // every board is narrower than ≈ 8 cm, so no point is farther than half a board from a joint
    for (let k = 0; k < 400; k++) {
      const p = parquetCell(k * 0.0373, k * 0.0619);
      expect(p.gap).toBeGreaterThanOrEqual(0);
      expect(p.gap).toBeLessThanOrEqual(Math.max(PARQUET_FRAME, PARQUET_STRIP) / 2 + 1e-9);
    }
  });

  it('the GLSL twin carries the same constants', () => {
    expect(PARQUET_GLSL).toContain(`const float P = ${PARQUET_PANEL.toFixed(4)};`);
    expect(PARQUET_GLSL).toContain(`const float B = ${PARQUET_FRAME.toFixed(4)};`);
    expect(PARQUET_GLSL).toContain('parqJoint');
  });
});

describe('upholstery of white-and-gold rooms', () => {
  it('is crimson damask, not a tan next to the gilt', () => {
    expect(silkColour(undefined)).toBe(BOISERIE_SILK);
    expect(silkColour('wall.boiserie')).toBe('#8E1F2A'); // research/02 §3 crimson damask [N]
    expect(silkColour('wall.silk.blue')).toBe('#46679a');
  });
});
