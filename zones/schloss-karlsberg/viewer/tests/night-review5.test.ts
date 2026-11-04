// Wave-5 review fix (experience): scotopic night vision and the Kino look (grade.ts), which candles burn on an
// ordinary evening and at a celebration, flame spots on candle sticks, and the shared photo / footer credit.
import { describe, expect, it } from 'vitest';
import { KINO_LOOK, SCOTOPIC_HALF_CD, SCOTOPIC_TINT, gradeData, nightVision, scotopicRatio, scotopicWeight, setKinoLook, setNightVision } from '../src/grade.ts';
import { CANDLES_LIT_AT, chandelierAt, flameSpots, flamesLit, roomLightShare } from '../src/nightlights.ts';
import { burnInText, footerParts } from '../src/photoMath.ts';

const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const sat = (c: number[]) => (Math.max(...c) - Math.min(...c)) / Math.max(...c);

describe('night vision (Purkinje shift)', () => {
  it('keeps a D65 white at its luminance and tints it blue-grey', () => {
    expect(scotopicRatio([1, 1, 1])).toBeCloseTo(1, 2);
    expect(lum(SCOTOPIC_TINT)).toBeCloseTo(1, 6);
    // green above red, blue above green (no violet cast)
    expect(SCOTOPIC_TINT[2]).toBeGreaterThan(SCOTOPIC_TINT[1]);
    expect(SCOTOPIC_TINT[1]).toBeGreaterThan(SCOTOPIC_TINT[0]);
  });

  it('darkens reds and lightens greens and blues relative to their luminance (rods peak at 507 nm)', () => {
    expect(scotopicRatio([1, 0, 0])).toBeLessThan(0.3);
    expect(scotopicRatio([0, 1, 0])).toBeGreaterThan(1);
    expect(scotopicRatio([0, 0, 1])).toBeGreaterThan(2);
  });

  it('blends by luminance: half at K, nothing by day or for bright candle light', () => {
    expect(scotopicWeight(SCOTOPIC_HALF_CD, 1)).toBeCloseTo(0.5, 6);
    expect(scotopicWeight(0.001, 1)).toBeGreaterThan(0.95);
    expect(scotopicWeight(500, 1)).toBeLessThan(1e-4);
    expect(scotopicWeight(0.001, 0)).toBe(0);
  });

  it('moonlit grass goes grey-blue, a candle-lit window keeps its amber', () => {
    const pre = 3; // display units per cd/m² at 22:00 (order of magnitude)
    const grass = [0.06, 0.09, 0.03].map((v) => v * 0.004 * pre) as [number, number, number]; // ≈ 0.003 cd/m²
    const g = nightVision(grass, 1 / pre, 1);
    expect(g[2]).toBeGreaterThan(g[1]); // bluer than green
    expect(sat(g)).toBeLessThan(sat(grass));
    const window = [1, 0.55, 0.2].map((v) => v * 6 * pre) as [number, number, number]; // ≈ 6 cd/m²
    const w = nightVision(window, 1 / pre, 1);
    for (let i = 0; i < 3; i++) expect(Math.abs(w[i] - window[i]) / window[i]).toBeLessThan(0.02);
  });

  it('writes the shared uniform block', () => {
    setNightVision(0.5, 4);
    expect(gradeData[0]).toBe(0.5);
    expect(gradeData[1]).toBeCloseTo(0.25, 6);
    setKinoLook(true);
    expect(gradeData[7]).toBe(1);
    expect(gradeData[11]).toBeCloseTo(KINO_LOOK.sat, 6);
    setKinoLook(false);
    expect(gradeData[7]).toBe(0);
    setNightVision(0, 1);
  });
});

describe('which candles burn (look-and-period §5: chandeliers for celebrations)', () => {
  it('an ordinary evening lights candelabra and sconces, not the chandeliers', () => {
    expect(roomLightShare('chandelier', 1, false)).toBe(0);
    expect(roomLightShare('chandelier', 1, true)).toBe(1);
    expect(roomLightShare('candelabrum', 1, false)).toBe(1);
    expect(roomLightShare('candelabrum', 0, false)).toBe(0);
    expect(roomLightShare('other', 1, false)).toBe(1);
    // by day the chandelier light keeps standing in for the room daylight it was tuned with (KB-I06)
    expect(roomLightShare('chandelier', 0, false)).toBe(1);
    expect(flamesLit('chandelier', 1, false)).toBe(false);
    expect(flamesLit('chandelier', 1, true)).toBe(true);
    expect(flamesLit('other', 1, false)).toBe(true);
    expect(flamesLit('other', CANDLES_LIT_AT - 0.01, true)).toBe(false);
  });

  it('puts one flame on top of each candle stick', () => {
    // two sticks (4 vertices each: bottom pair, top pair) and a 2 cm stub
    const pos = [0, 0, 0, 0.02, 0, 0, 0, 0.15, 0, 0.02, 0.15, 0, 1, 0.1, 1, 1.02, 0.1, 1, 1, 0.3, 1, 1.02, 0.3, 1, 5, 0, 5, 5, 0.02, 5];
    const comp = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2];
    const s = flameSpots(pos, comp);
    expect(s).toHaveLength(2);
    expect(s[0][0]).toBeCloseTo(0.01, 6);
    expect(s[0][1]).toBeCloseTo(0.15, 6);
    expect(s[1][1]).toBeCloseTo(0.3, 6);
  });

  it('matches a room light to the chandelier it hangs at', () => {
    const ch: [number, number, number][] = [
      [0, 3, 0],
      [6, 3, 0],
    ];
    expect(chandelierAt([6.2, 2.4, 0.1], ch)).toBe(1);
    expect(chandelierAt([3, 2.4, 0], ch)).toBe(-1);
  });
});

describe('photo credit = footer credit (wave-5 review)', () => {
  it('burns the full footer line into the still', () => {
    const t = burnInText(19, 'Gelände: X');
    expect(t.attribution).toBe(footerParts('Gelände: X').join(' · '));
    // wave-7 review: footer and caption credit the same research range (01–11)
    expect(t.attribution).toContain('Rekonstruktion: Hypothese nach research/01–11');
    expect(t.sub).toContain('research/01–11');
    expect(t.attribution.endsWith('Schauen, nicht graben')).toBe(true);
  });
});
