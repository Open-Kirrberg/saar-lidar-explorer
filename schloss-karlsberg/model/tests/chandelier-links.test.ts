// Wave-6 review fix (look): the chandelier drops read as a cloud of loose shards. Every glass piece must now hang from
// something: chain links run end to end between fixing points, drops hang from an arm end or a festoon's low point.
import { describe, expect, it } from 'vitest';
import { CHANDELIER, type P3, chandelierPlan } from '../src/interior/chandelier.ts';

const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: P3) => Math.hypot(a[0], a[1], a[2]);

describe('chandelier glass hangs together (wave-6 review)', () => {
  const p = chandelierPlan();
  const links = p.glass.filter((g) => g.kind === 'bead');
  const ends = (g: (typeof links)[number]): [P3, P3] => {
    const d = g.dir!;
    const h = g.size[1];
    return [sub(g.at, [d[0] * h, d[1] * h, d[2] * h]), [g.at[0] + d[0] * h, g.at[1] + d[1] * h, g.at[2] + d[2] * h]];
  };

  it('chain links are oriented diamonds that touch their neighbours (gap ≤ 1 cm)', () => {
    expect(links.length).toBeGreaterThan(150);
    for (const g of links) {
      expect(g.dir).toBeDefined();
      expect(len(g.dir!)).toBeCloseTo(1, 6);
      expect(g.size[1]).toBeGreaterThan(g.size[0]); // elongated along the chain
    }
    // every link end lies within 1 cm of another link's end or of a fixing point (arm ends, rings, finial top)
    const allEnds = links.flatMap(ends);
    const fixings: P3[] = [[0, 0.12, 0]];
    for (const t of p.tiers) for (let k = 0; k < t.n; k++) fixings.push([Math.sin((k * 2 * Math.PI) / t.n) * t.r, t.y, Math.cos((k * 2 * Math.PI) / t.n) * t.r]);
    let loose = 0;
    for (const [i, e] of allEnds.entries()) {
      const near = allEnds.some((f, j) => j !== i && j >> 1 !== i >> 1 && len(sub(e, f)) <= 0.01);
      const onRing = [p.crown, p.ring].some((r) => Math.abs(Math.hypot(e[0], e[2]) - r.r) < 0.012 && Math.abs(e[1] - r.y) < 0.025);
      const fixed = fixings.some((f) => len(sub(e, f)) < 0.04);
      if (!near && !onRing && !fixed) loose++;
    }
    expect(loose).toBe(0);
  });

  it('every pendeloque hangs from an arm end or a chain (top within 2 cm), none floats free', () => {
    const drops = p.glass.filter((g) => g.kind === 'pendeloque');
    expect(drops.length).toBeLessThanOrEqual(24); // 42 before the fix
    const points = links.flatMap(ends);
    for (const t of p.tiers) for (let k = 0; k < t.n; k++) points.push([Math.sin((k * 2 * Math.PI) / t.n) * t.r, t.y, Math.cos((k * 2 * Math.PI) / t.n) * t.r]);
    for (const d of drops) {
      const top: P3 = [d.at[0], d.at[1] + d.size[1], d.at[2]];
      expect(Math.min(...points.map((q) => len(sub(top, q))))).toBeLessThan(0.02);
    }
  });

  it('stays inside its envelope and its glass budget (links 4 triangles, other pieces 8)', () => {
    for (const g of p.glass) {
      expect(Math.hypot(g.at[0], g.at[2])).toBeLessThanOrEqual(CHANDELIER.radius);
      expect(g.at[1]).toBeGreaterThanOrEqual(0);
      expect(g.at[1]).toBeLessThanOrEqual(CHANDELIER.height);
    }
    expect(links.length * 4 + (p.glass.length - links.length) * 8).toBeLessThanOrEqual(1500);
  });
});
