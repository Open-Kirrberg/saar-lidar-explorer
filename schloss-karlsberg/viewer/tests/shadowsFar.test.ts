import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FAR_SHADOW, farLightExtent, farRedrawDue, farShadowBox, farTexel, nearWeight } from '../src/shadowsFarMath.ts';
import { FarShadow, patchFarShadowChunk } from '../src/shadowsFar.ts';
import { terrainLightsBegin } from '../src/atmosphere.ts';

/** KB-I50 static far shadow map: box, light-space extent, near/far blend, redraw policy and the chunk patch. */
describe('far shadow maths', () => {
  it('box: square over the points, padded, never below the minimum', () => {
    const b = farShadowBox([
      [0, 0],
      [1000, -200],
      [1800, 100],
    ]);
    expect(b.cx).toBe(900);
    expect(b.cz).toBe(-50);
    expect(b.half).toBe(900 + FAR_SHADOW.pad);
    expect(farShadowBox([[5, 5]]).half).toBe(FAR_SHADOW.minHalf);
    expect(farShadowBox([])).toEqual({ cx: 0, cz: 0, half: FAR_SHADOW.minHalf });
  });

  it('extent: the diagonal across the azimuth, foreshortened by sin(el) along it', () => {
    const box = { cx: 0, cz: 0, half: 1000 };
    const high = farLightExtent(box, 1);
    expect(high.halfX).toBeCloseTo(1000 * Math.SQRT2, 6);
    expect(high.halfY).toBeCloseTo(1000 * Math.SQRT2, 6);
    const low = farLightExtent(box, Math.sin((6 * Math.PI) / 180));
    expect(low.halfX).toBeCloseTo(1000 * Math.SQRT2, 6);
    expect(low.halfY).toBeLessThan(high.halfY * 0.2);
    // the ground texels stay near-square at low sun: along ≈ across within the relief allowance
    const t = farTexel(low, Math.sin((6 * Math.PI) / 180));
    expect(t.across).toBeCloseTo((2 * 1000 * Math.SQRT2) / FAR_SHADOW.mapSize, 6);
    expect(t.along / t.across).toBeLessThan(1.6);
    expect(t.along / t.across).toBeGreaterThan(0.99);
  });

  it('near weight: 1 inside, smooth fade over the rim, 0 outside', () => {
    expect(nearWeight(0.5, 0.5)).toBe(1);
    expect(nearWeight(0.5, 0.0)).toBe(0);
    expect(nearWeight(-0.1, 0.5)).toBe(0);
    const mid = nearWeight(0.5, FAR_SHADOW.fade / 4);
    expect(mid).toBeCloseTo(0.5, 6);
    expect(nearWeight(0.5, FAR_SHADOW.fade / 2)).toBe(1);
  });

  it('redraw policy: first draw and jumps at once, small changes after settling', () => {
    expect(farRedrawDue(0, 0, false)).toBe(true);
    expect(farRedrawDue(0, FAR_SHADOW.maxStaleDeg + 0.1, true)).toBe(true);
    expect(farRedrawDue(0, 0.3, true)).toBe(false);
    expect(farRedrawDue(FAR_SHADOW.settleFrames - 1, 0.3, true)).toBe(false);
    expect(farRedrawDue(FAR_SHADOW.settleFrames, 0.3, true)).toBe(true);
  });
});

describe('far shadow light', () => {
  const sunDir = (elDeg: number, azDeg: number) => {
    const el = (elDeg * Math.PI) / 180;
    const az = (azDeg * Math.PI) / 180;
    return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  };

  it('draws once, holds for small changes until they settle, redraws at once for a jump', () => {
    const f = new FarShadow(256);
    f.setBox({ cx: 100, cz: -50, half: 900 }, 340);
    f.setSun(sunDir(20, 250));
    expect(f.tick()).toBe(true);
    expect(f.light.shadow.needsUpdate).toBe(true);
    f.light.shadow.needsUpdate = false;
    expect(f.tick()).toBe(false);
    // a slider drag: tiny steps every frame never redraw until they hold still
    for (let i = 0; i < 20; i++) {
      f.setSun(sunDir(20 - i * 0.01, 250));
      expect(f.tick()).toBe(false);
    }
    let n = 0;
    for (let i = 0; i < FAR_SHADOW.settleFrames + 1; i++) n += f.tick() ? 1 : 0;
    expect(n).toBe(1);
    f.setSun(sunDir(8, 270));
    expect(f.tick()).toBe(true);
    expect(f.renders).toBe(3);
  });

  it('the fitted frustum holds the whole box on the ground, for high and low sun', () => {
    for (const [el, az] of [
      [55, 180],
      [6, 285],
      [15, 80],
    ]) {
      const f = new FarShadow(256);
      const box = { cx: 300, cz: 120, half: 1100 };
      f.setBox(box, 340);
      f.setSun(sunDir(el, az));
      f.tick();
      const cam = f.light.shadow.camera;
      cam.position.copy(f.light.position);
      cam.lookAt(f.light.target.position);
      cam.updateMatrixWorld();
      for (const [dx, dz, dy] of [
        [-1, -1, 0],
        [1, -1, 0],
        [1, 1, 0],
        [-1, 1, 0],
        [0, 0, 60],
      ]) {
        const p = new THREE.Vector3(box.cx + dx * box.half, 340 + dy, box.cz + dz * box.half).project(cam);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1.0001);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1.0001);
        expect(Math.abs(p.z)).toBeLessThan(1);
      }
    }
  });
});

describe('lights_fragment_begin patch', () => {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const patched = patchFarShadowChunk(chunk);

  it("patches three r187's directional loop once", () => {
    expect(patched).toContain('KB-I50');
    expect(patchFarShadowChunk(patched)).toBe(patched);
    // light 0 mixes the near map (0) and the far map (1); light 1 reads no map of its own and adds no light
    expect(patched).toContain('getShadow( directionalShadowMap[ 0 ]');
    expect(patched).toContain('getShadow( directionalShadowMap[ 1 ]');
    expect(patched).toContain('#if !( ( NUM_DIR_LIGHT_SHADOWS > 1 ) && ( UNROLLED_LOOP_INDEX == 1 ) )');
    // with a single shadow (sun only, e.g. at night or other consumers) three's own line stays
    expect(patched).toContain('getShadow( directionalShadowMap[ i ]');
    // the point and spot loops are untouched
    expect(patched.slice(0, patched.indexOf('directionalLights[ i ]'))).toBe(chunk.slice(0, chunk.indexOf('directionalLights[ i ]')));
  });

  it('the terrain per-vertex sun still finds its RE_Direct in the patched chunk', () => {
    const t = terrainLightsBegin(patched);
    expect(t).toContain('KB-I50');
    expect(t).not.toBe(patched);
  });

  it('unrolled for two shadowed lights, light 0 blends and light 1 is empty', () => {
    // emulate three's unroll (WebGLProgram unrollLoops) and the preprocessor for NUM_DIR_LIGHT_SHADOWS = 2
    const start = patched.indexOf('#pragma unroll_loop_start', patched.indexOf('DirectionalLight directionalLight;'));
    const body = patched.slice(patched.indexOf('{', start) + 1, patched.indexOf('#pragma unroll_loop_end', start));
    const iter = (i: number) => body.replace(/\[\s*i\s*\]/g, `[ ${i} ]`).replace(/UNROLLED_LOOP_INDEX/g, String(i));
    const keep = (src: string) => {
      // minimal #if evaluator for the conditions this chunk uses
      const out: string[] = [];
      const stack: { on: boolean; taken: boolean }[] = [];
      const active = () => stack.every((s) => s.on);
      const cond = (e: string) => new Function(`return (${e.replace(/defined\(\s*USE_SHADOWMAP\s*\)/g, 'true').replace(/NUM_DIR_LIGHT_SHADOWS/g, '2')});`)() as boolean;
      for (const line of src.split('\n')) {
        const t = line.trim();
        if (t.startsWith('#if ')) {
          const v = cond(t.slice(4));
          stack.push({ on: v, taken: v });
        } else if (t.startsWith('#elif ')) {
          const s = stack[stack.length - 1];
          s.on = !s.taken && cond(t.slice(6));
          s.taken ||= s.on;
        } else if (t === '#else') {
          const s = stack[stack.length - 1];
          s.on = !s.taken;
          s.taken = true;
        } else if (t === '#endif') stack.pop();
        else if (active()) out.push(line);
      }
      return out.join('\n');
    };
    const l0 = keep(iter(0));
    const l1 = keep(iter(1));
    expect(l0).toContain('mix( skbFar, skbNear, skbW )');
    expect(l0).toContain('RE_Direct(');
    expect(l1).not.toContain('getShadow');
    expect(l1).not.toContain('RE_Direct(');
  });
});
