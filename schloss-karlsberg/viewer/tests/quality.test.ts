import { describe, expect, it } from 'vitest';
import { ADAPTIVE_DEFAULTS, AdaptiveScale, effectiveDpr, isPreset, QUALITY } from '../src/quality.ts';

describe('quality presets (KB-I05)', () => {
  it('caps the device pixel ratio per preset', () => {
    expect(effectiveDpr(2, QUALITY.hoch.dprCap)).toBe(1.5);
    expect(effectiveDpr(2, QUALITY.mittel.dprCap)).toBe(1.25);
    expect(effectiveDpr(2, QUALITY.mobil.dprCap)).toBe(1);
    expect(effectiveDpr(1, QUALITY.hoch.dprCap)).toBe(1);
    expect(effectiveDpr(3, 2)).toBe(2);
  });

  it('adaptive scale never goes below one device pixel per CSS pixel (or the device ratio)', () => {
    expect(effectiveDpr(2, 1.5, 0.6)).toBe(1);
    expect(effectiveDpr(0.8, 1.5, 0.5)).toBe(0.8);
    expect(effectiveDpr(2, 1.5, 0.8)).toBeCloseTo(1.2, 9);
  });

  it('recognises presets', () => {
    expect(isPreset('mittel')).toBe(true);
    expect(isPreset('ultra')).toBe(false);
    expect(isPreset(undefined)).toBe(false);
  });
});

describe('AdaptiveScale', () => {
  const feed = (a: AdaptiveScale, ms: number, n: number) => {
    for (let i = 0; i < n; i++) a.update(ms);
    return a.scale;
  };

  it('stays at 1 within budget', () => {
    expect(feed(new AdaptiveScale(), 12, 200)).toBe(1);
  });

  it('drops when over budget, roughly to the scale that meets it', () => {
    const a = new AdaptiveScale();
    a.update(20);
    // sqrt(14/20) = 0.84 → floor to 0.8
    expect(a.scale).toBe(0.8);
  });

  it('honours the cooldown and the minimum', () => {
    const a = new AdaptiveScale();
    a.update(40);
    const s = a.scale;
    expect(feed(a, 40, ADAPTIVE_DEFAULTS.cooldown)).toBe(s);
    expect(feed(a, 40, 500)).toBe(ADAPTIVE_DEFAULTS.minScale);
  });

  it('recovers step by step below the relax threshold', () => {
    const a = new AdaptiveScale();
    a.update(30);
    expect(a.scale).toBeLessThan(1);
    expect(feed(a, 5, 1000)).toBe(1);
  });

  it('does not oscillate between relax and budget (hysteresis)', () => {
    const a = new AdaptiveScale();
    a.update(20);
    const s = a.scale;
    expect(feed(a, 11, 500)).toBe(s);
  });

  it('ignores non-finite and negative samples; reset restores full scale', () => {
    const a = new AdaptiveScale();
    a.update(NaN);
    a.update(Infinity);
    a.update(-3);
    expect(a.scale).toBe(1);
    expect(Number.isNaN(a.avg)).toBe(true);
    a.update(50);
    a.reset();
    expect(a.scale).toBe(1);
  });
});
