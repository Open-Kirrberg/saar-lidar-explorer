import { describe, expect, it } from 'vitest';
import { cornerLift, zoomToFitAround } from '../src/map/fit';

describe('minimap fit helpers', () => {
  it('zooms the round dial out until the area fits around the player', () => {
    // 400 px away at z15, dial radius 60 px → 400/60 ≈ 6.7 → 3 zoom levels out (×8 > 6.7)
    expect(zoomToFitAround(15, 400, 60, 10, 15)).toBe(12);
    expect(zoomToFitAround(15, 60, 60, 10, 15)).toBe(15); // exactly on the rim
    expect(zoomToFitAround(15, 30, 60, 10, 15)).toBe(15); // never zooms in past the user's zoom
    expect(zoomToFitAround(15, 1e6, 60, 10, 15)).toBe(10); // min zoom
    expect(zoomToFitAround(13, 0, 60, 10, 15)).toBe(13);
  });

  it('lifts the full map controls above the „© Quellen“ button', () => {
    const map = { left: 10, top: 10, right: 380, bottom: 760 };
    const btn = { left: 290, top: 712, right: 380, bottom: 756 };
    expect(cornerLift(map, btn)).toBe(760 - 712 + 6);
    expect(cornerLift(map, { left: 290, top: 780, right: 380, bottom: 824 })).toBe(0); // below the map
    expect(cornerLift(map, { left: 10, top: 712, right: 100, bottom: 756 })).toBe(0); // bottom left, not over the zoom
    expect(cornerLift(map, null)).toBe(0);
  });
});
