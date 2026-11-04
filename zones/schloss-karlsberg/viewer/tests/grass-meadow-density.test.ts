import { describe, expect, it } from 'vitest';
import { GRASS, keepShare } from '../src/grassBlades.ts';

describe('meadow tuft density (wave 11, KB-I94)', () => {
  it('thins the meadow tufts nearer than the lawn tufts, which keep their full-density radius', () => {
    expect(GRASS.dense).toBe(6);
    expect(GRASS.meadowDense).toBeLessThan(GRASS.dense);
    expect(keepShare(GRASS.meadowDense, GRASS.meadowDense).keep).toBe(1);
    // at the lawn's full-density edge the meadow keeps (4.5 / 6)² of its tufts, each widened to hold the cover
    const k = keepShare(GRASS.dense, GRASS.meadowDense);
    expect(k.keep).toBeCloseTo((GRASS.meadowDense / GRASS.dense) ** 2, 6);
    expect(k.widen).toBeCloseTo(GRASS.dense / GRASS.meadowDense, 6);
  });
});
