/**
 * KB-I59 / KB-I55 shading shortcuts: the PCF tap rotation (shadowTaps.ts), the per-vertex terrain light and the draw
 * order (atmosphere.ts). The GPU cost is measured headless (backlog); these tests pin the maths and the three r187
 * patch targets, so a three update fails here instead of rendering dark or unshadowed.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GOLDEN_ANGLE, PCF5_SOURCE, patchShadowChunk, pcf5Rotated, vogelDiskOffsets } from '../src/shadowTaps.ts';
import { RENDER_ORDER, TERRAIN_LIGHT_GLSL, terrainLightsBegin } from '../src/atmosphere.ts';

/** three's GLSL vogelDiskSample, in JS */
function vogel(k: number, n: number, phi: number): [number, number] {
  const r = Math.sqrt((k + 0.5) / n);
  const t = k * GOLDEN_ANGLE + phi;
  return [Math.cos(t) * r, Math.sin(t) * r];
}

describe('PCF tap rotation (shadowTaps)', () => {
  it('constant offsets rotated by phi equal three’s per-tap Vogel samples', () => {
    const c = vogelDiskOffsets(5);
    for (const phi of [0, 0.3, 1.7, 3.1, 4.4, 6.2]) {
      for (let k = 0; k < 5; k++) {
        // GLSL mat2(cos, sin, −sin, cos) · v (column-major) = rotation by phi
        const x = Math.cos(phi) * c[k][0] - Math.sin(phi) * c[k][1];
        const y = Math.sin(phi) * c[k][0] + Math.cos(phi) * c[k][1];
        const [ex, ey] = vogel(k, 5, phi);
        expect(x).toBeCloseTo(ex, 7);
        expect(y).toBeCloseTo(ey, 7);
      }
    }
  });

  it('patches the pinned three r187 chunk once and keeps the rest', () => {
    const src = THREE.ShaderChunk.shadowmap_pars_fragment;
    expect(src).toContain(PCF5_SOURCE);
    const out = patchShadowChunk(src);
    expect(out).not.toContain('vogelDiskSample( 0, 5, phi )');
    expect(out).toContain('pcfRot');
    expect(out.match(/texture\( shadowMap, vec3\( shadowCoord\.xy \+ pcfRot/g)?.length).toBe(5);
    expect(patchShadowChunk(out)).toBe(out); // idempotent
    // wave-11 review fix: the point-light (cube) PCF loop gets the same constant offsets and one rotation
    expect(out).not.toContain('vogelDiskSample( i, 5, phi )');
    expect(out).toContain('vec2 offset = pcfPRot * skbVogel5[ i ];');
    expect(out.match(/pcfPRot = mat2/g)?.length).toBe(1);
    expect(pcf5Rotated()).toContain(') * 0.2;');
  });

  it('throws when the three source moved', () => {
    expect(() => patchShadowChunk('float getShadow() { return 1.0; }')).toThrow(/not found/);
  });
});

describe('terrain vertex light (atmosphere)', () => {
  it('replaces only the directional RE_Direct of lights_fragment_begin', () => {
    const src = THREE.ShaderChunk.lights_fragment_begin;
    const calls = (s: string) => s.split('RE_Direct( directLight, geometryPosition').length - 1;
    const out = terrainLightsBegin(src);
    expect(calls(out)).toBe(calls(src)); // the #else branch keeps one call for any further directional light
    expect(out).toContain('#if UNROLLED_LOOP_INDEX == 0');
    expect(out).toContain('vTerrLight.x * material.diffuseContribution');
    // point and spot lights keep three's per-pixel path, in their own loops before the directional one
    const dirAt = out.indexOf('directionalLights[ i ]');
    expect(out.indexOf('pointLights[ i ]')).toBeLessThan(dirAt);
    expect(out.indexOf('RE_Direct( directLight', out.indexOf('pointLights[ i ]'))).toBeLessThan(dirAt);
    expect(() => terrainLightsBegin('no lights here')).toThrow();
  });

  it('collapses three’s dielectric multi-scatter terms correctly', () => {
    // three r187, F0 0.04, F90 1, metalness 0: computeMultiscattering + RE_IndirectSpecular_Physical with zero radiance
    for (const [fx, fy] of [[0.9, 0.05], [0.6, 0.1], [0.35, 0.12], [0.2, 0.15]]) {
      const fssEss = 0.04 * fx + fy;
      const ess = fx + fy;
      const ems = 1 - ess;
      const favg = 0.04 + 0.96 * 0.047619;
      const fms = (fssEss * favg) / (1 - ems * favg);
      const multi = fms * ems;
      const E = 2.3; // sky irradiance
      const albedo = 0.31;
      const threeDiffuse = albedo * (1 - (fssEss + multi)) * (E / Math.PI);
      const threeSpec = multi * (E / Math.PI);
      // the vertex shader's collapsed form (vTerrLight.z, .w)
      const ms = ((fssEss * favg) / (1 - (1 - ess) * favg)) * (1 - ess);
      expect(albedo * E * ((1 - fssEss - ms) / Math.PI)).toBeCloseTo(threeDiffuse, 12);
      expect(E * (ms / Math.PI)).toBeCloseTo(threeSpec, 12);
    }
    expect(TERRAIN_LIGHT_GLSL.vertexMain).toContain('textureLod( dfgLUT');
    expect(TERRAIN_LIGHT_GLSL.indirect).toContain('vTerrSky * vTerrLight.z');
  });

  it('draws the terrain after the other opaque objects and the sky last', () => {
    expect(RENDER_ORDER.terrain).toBeGreaterThan(0);
    expect(RENDER_ORDER.sky).toBeGreaterThan(RENDER_ORDER.terrain);
  });
});

describe('vine rows footprint filter (terrain.ts / landcoverBake.ts VINE_GLSL)', () => {
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  /** mean leaf share across one row period for a leaf half-width hw and an edge widening e (m), as in vineRows */
  const leafMean = (hw: number, e: number) => {
    let s = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const r = ((i + 0.5) / n) * 0.55;
      s += 1 - smooth(hw - 0.07 - e, hw + 0.03 + e, r);
    }
    return s / n;
  };
  it('box-filtering the leaf edge keeps the area average (no brightness pop where the rows fade)', () => {
    for (const hw of [0.3, 0.36, 0.42]) {
      // rows fade out completely at 0.25 rows per pixel, i.e. e = 0.5 · 0.25 · 1.1 m
      for (const e of [0.02, 0.06, 0.1, 0.1375]) expect(Math.abs(leafMean(hw, e) - leafMean(hw, 0))).toBeLessThan(0.006);
    }
  });
});
