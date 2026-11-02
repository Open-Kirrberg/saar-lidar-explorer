/**
 * Wave-9 review fix (garden, court mouth): the graded carriage drive KB-V2 up to the Ehrenhof grille with its flanking
 * walls, and the forecourt strip KB-V1 (model/src/site/drive.ts).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import { E0, N0 } from '../src/frame.ts';
import { DRIVE } from '../src/layout/grammar.ts';
import { clipOutsideDrives, driveCoords, driveCuts, driveFrame, driveGrade, driveWalls, isDrapedWay, isDrive, isForecourt } from '../src/site/drive.ts';
import type { TerrainFeature } from '../src/spec.ts';

const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8'));
const { spec } = loadSite(raw);
const tf = (id: string) => spec.terrain_features.find((f) => f.id === id)!;

/** A synthetic drive running W from (E0 + 100, N0 − 0) down 40 m from 110 to 106 m, 8 m wide, parapet 0.4 m. */
const drive = (o: Partial<TerrainFeature> = {}): TerrainFeature =>
  ({
    id: 'KB-VX',
    kind: 'path',
    name: 'Auffahrt',
    geometry: { type: 'LineString', coordinates: [[E0 + 100, N0], [E0 + 60, N0]] },
    width: 8,
    top: 110,
    foot: 106,
    wall_height: 0.4,
    surface: 'gravel (carriage drive)',
    ...o,
  }) as TerrainFeature;
/** Ground outside: a terrace at 110 E of x = 100, falling 1:20 to the W (so the drive stands on fill near the top). */
const ground = (x: number) => (x >= 100 ? 110 : 110 - (100 - x) * 0.05 - Math.min(3, (100 - x) * 0.3));

describe('graded drives (drive.ts)', () => {
  it('needs top, foot, width and wall_height: the terrace stair TF-35 (top/foot/width only) is no drive', () => {
    expect(isDrive(drive())).toBe(true);
    expect(isDrive(drive({ wall_height: 0 }))).toBe(true);
    expect(isDrive(drive({ wall_height: undefined }))).toBe(false);
    expect(isDrive(drive({ foot: undefined }))).toBe(false);
    expect(isDrive(tf('TF-35'))).toBe(false);
    expect(isDrive(tf('KB-V2'))).toBe(true);
  });

  it('grades straight from top to foot and reports along / across coordinates', () => {
    const d = driveFrame(drive());
    expect(d.len).toBeCloseTo(40, 6);
    expect(d.at(0)).toBe(110);
    expect(d.at(20)).toBeCloseTo(108, 6);
    expect(d.at(99)).toBe(106);
    expect(driveGrade(d)).toBeCloseTo(0.1, 6);
    const [s, c] = driveCoords(d, 80, 3); // local x 80 = 20 m down; z +3
    expect(s).toBeCloseTo(20, 6);
    expect(Math.abs(c)).toBeCloseTo(3, 6);
  });

  it('flanks the drive with sloping walls while it stands on more than DRIVE.wallMinFill of fill', () => {
    const walls = driveWalls(drive(), (x) => ground(x));
    expect(walls.length).toBeGreaterThan(2);
    expect(new Set(walls.map((w) => w.side))).toEqual(new Set([-1, 1]));
    const d = driveFrame(drive());
    for (const w of walls) {
      // parapet = drive surface + wall_height at both ends, on the edge + half a wall thickness
      const [s0, c0] = driveCoords(d, w.x0, w.z0);
      const [s1] = driveCoords(d, w.x1, w.z1);
      expect(w.top0).toBeCloseTo(d.at(s0) + 0.4, 6);
      expect(w.top1).toBeCloseTo(d.at(s1) + 0.4, 6);
      expect(Math.abs(c0)).toBeCloseTo(4 + DRIVE.wallThick / 2, 6);
      expect(w.foot).toBeLessThan(Math.min(w.top0, w.top1) - 0.4);
      expect(Math.hypot(w.x1 - w.x0, w.z1 - w.z0)).toBeLessThanOrEqual(DRIVE.pieceLen + 1e-9);
      // the walls start behind the terrace wall's inner face and end before the drive meets the ground
      expect(s0).toBeGreaterThanOrEqual(-DRIVE.wallStart - 1e-9);
      expect(d.at(s1) - ground(d.a[0] + d.dir[0] * s1)).toBeGreaterThan(DRIVE.wallMinFill - 0.6);
    }
    // no walls on an unwalled drive or on flat ground
    expect(driveWalls(drive({ wall_height: 0 }), (x) => ground(x))).toEqual([]);
    expect(driveWalls(drive(), () => 0 / 0)).toEqual([]);
  });

  it('cuts a terrace wall across its top end (to the outer wall faces) and clips a fence across it', () => {
    const f = drive();
    // a N-S terrace edge at x = 100 (local), crossing the drive's top end
    const cuts = driveCuts([f], [100, -30], [100, 30]);
    expect(cuts.length).toBe(1);
    const [a, b] = cuts[0];
    expect((a + b) / 2).toBeCloseTo(30, 6);
    expect(b - a).toBeCloseTo(2 * (4 + DRIVE.wallThick), 6);
    // a segment far from the top end is not cut
    expect(driveCuts([f], [70, -30], [70, 30])).toEqual([]);
    // a fence across the drive at x = 90 stops at the walls
    const runs = clipOutsideDrives(
      [
        [90, -20],
        [90, 20],
      ],
      [f],
    );
    expect(runs.length).toBe(2);
    for (const r of runs) for (const [, z] of r) expect(Math.abs(z)).toBeGreaterThan(4 + DRIVE.wallThick);
  });

  it('KB-V2 rises to the court mouth at most DRIVE.maxGrade, 8 m wide, with a parapet; KB-V1 is the forecourt strip', () => {
    const v2 = tf('KB-V2');
    const d = driveFrame(v2);
    expect(driveGrade(d)).toBeLessThanOrEqual(DRIVE.maxGrade);
    expect(v2.width).toBeGreaterThanOrEqual(8);
    expect(v2.wall_height).toBeGreaterThan(0);
    expect(v2.tag).toMatch(/LP06/);
    // the top end lies at the court level (Ehrenhof TF-03, 344.8)
    expect(v2.top).toBeCloseTo(344.8, 1);
    expect(isForecourt(tf('KB-V1'))).toBe(true);
    expect(isForecourt(v2)).toBe(false);
  });

  it('draws walks ≤ 4 m, the forecourt strip and drives as ribbons, other wide paths not', () => {
    expect(isDrapedWay(drive())).toBe(true);
    expect(isDrapedWay(tf('KB-V1'))).toBe(true);
    expect(isDrapedWay(tf('TF-35'))).toBe(false);
    expect(isDrapedWay({ ...drive(), top: undefined, wall_height: undefined, width: 3 } as TerrainFeature)).toBe(true);
    expect(isDrapedWay({ ...drive(), top: undefined, wall_height: undefined, width: 6 } as TerrainFeature)).toBe(false);
  });
});
