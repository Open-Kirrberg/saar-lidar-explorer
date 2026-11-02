import { describe, expect, it } from 'vitest';
import { POSITION_MAX_ERROR, POSITION_STEP, quantisePositions } from '../src/explorer/export.ts';

describe('quantisePositions (KB-I62)', () => {
  it('keeps every component within 1 cm and snaps the offset to the global grid', () => {
    const pos: number[] = [];
    let s = 1;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 500; i++) pos.push(1250 + rnd() * 40, 340 + rnd() * 30, -1150 + rnd() * 60);
    const q = quantisePositions(pos)!;
    expect(q).not.toBeNull();
    expect(q.step).toBe(POSITION_STEP);
    expect(q.maxError).toBeLessThanOrEqual(POSITION_STEP / 2 + 1e-9);
    expect(q.maxError).toBeLessThanOrEqual(POSITION_MAX_ERROR);
    for (const o of q.offset) expect(Math.abs(o / q.step - Math.round(o / q.step))).toBeLessThan(1e-9);
    for (let i = 0; i < pos.length; i++) expect(Math.abs(q.offset[i % 3] + q.q[i] * q.step - pos[i])).toBeLessThanOrEqual(q.maxError + 1e-9);
  });

  it('maps coincident vertices of two different nodes to the same decoded position', () => {
    const shared = [1300.123, 351.777, -1120.456];
    const a = quantisePositions([...shared, 1290, 345, -1130])!;
    const b = quantisePositions([...shared, 1330, 360, -1100, 1310, 350, -1105])!;
    const dec = (q: NonNullable<typeof a>) => [0, 1, 2].map((k) => q.offset[k] + q.q[k] * q.step);
    expect(dec(a)).toEqual(dec(b));
  });

  it('returns null when a node does not fit int16 at the step', () => {
    expect(quantisePositions([0, 0, 0, 1100, 0, 0])).toBeNull(); // 1.1 km > 2 · 32767 / 64 m
    expect(quantisePositions([])).toBeNull();
  });
});
