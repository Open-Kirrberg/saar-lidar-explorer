import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NEAR_SHADOW, nearBiasMetres, nearShadowBias, nearTexel } from '../src/shadowsNearMath.ts';
import { POINT_PCF5_SOURCE, patchShadowChunk } from '../src/shadowTaps.ts';

/** KB-I99: the near sun map's depth bias in metres (the balcony shadow at 66 / 15 starts at the slab). */
describe('near shadow bias', () => {
  it('texel size of the fitted map', () => {
    expect(nearTexel(60, 4096)).toBeCloseTo(120 / 4096, 9);
    expect(nearTexel(700, 2048)).toBeCloseTo(1400 / 2048, 9);
  });

  it('walk mode (ext 60 m, 4096²): a few centimetres, not the former 1.16 m', () => {
    const m = nearBiasMetres(60, 4096);
    expect(m).toBeGreaterThanOrEqual(NEAR_SHADOW.minBiasM);
    expect(m).toBeLessThan(0.1);
    const b = nearShadowBias(60, 4096, 100, 3000);
    expect(b).toBeLessThan(0);
    // back to metres over the orthographic depth range: the same few centimetres
    expect(-b * 2900).toBeCloseTo(m, 9);
    // the former fixed bias in metres, for the record
    expect(0.0004 * 2900).toBeCloseTo(1.16, 6);
    expect(-b * 2900).toBeLessThan(0.0004 * 2900 / 10);
  });

  it('grows with the texel (flight, mobile map size) and never exceeds the former bias at the widest map', () => {
    expect(nearBiasMetres(700, 4096)).toBeCloseTo(NEAR_SHADOW.biasTexels * (1400 / 4096), 9);
    expect(nearBiasMetres(700, 2048)).toBeCloseTo(2 * nearBiasMetres(700, 4096), 9);
    expect(nearBiasMetres(120, 4096)).toBeGreaterThan(nearBiasMetres(60, 4096));
    expect(-nearShadowBias(700, 4096, 100, 3000)).toBeLessThan(0.0004);
  });

  it('degenerate inputs stay finite', () => {
    expect(Number.isFinite(nearShadowBias(60, 0, 100, 100))).toBe(true);
  });
});

describe('candle cube shadow taps (wave-11 review fix, shadowTaps.ts)', () => {
  it('patches three r187 point PCF block: one tap at radius 0, five rotated taps otherwise', () => {
    const src = THREE.ShaderChunk.shadowmap_pars_fragment;
    expect(src).toContain(POINT_PCF5_SOURCE);
    const out = patchShadowChunk(src);
    expect(out).toContain('if ( shadowRadius <= 0.0 ) {');
    expect(out.match(/shadow \+= texture\( shadowMap, vec4\( direction, dp \) \)/g)?.length).toBe(1);
    expect(out).not.toMatch(/\bflat\b/);
    expect(patchShadowChunk(out)).toBe(out);
  });
});
