import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createMaterials } from '@model/materials/index.ts';

/**
 * Wave-7 review (poses 22, 24, 28): a transparent double-sided material is drawn in two passes, and three.js defines
 * FLIP_SIDED for the back-face pass, which negates vNormal. The "camera outside" test of the glass patch must use the
 * unflipped (outward) normal, or a room's own panes test as outside from within and show the opaque mapped room.
 */
describe('glass seen from inside a room', () => {
  const compile = (m: THREE.Material, defines = '') => {
    const sh = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: defines + THREE.ShaderLib.physical.fragmentShader,
    };
    m.onBeforeCompile(sh as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    return sh.fragmentShader;
  };

  it('the outside test undoes the back-face pass normal flip', () => {
    const m = createMaterials().baked('glass.crown');
    expect(m.side).toBe(THREE.DoubleSide);
    expect(m.transparent).toBe(true);
    const f = compile(m);
    const flip = f.indexOf('#ifdef FLIP_SIDED\n  vec3 skbGlassN = - normalize( vNormal );');
    expect(flip).toBeGreaterThan(0);
    expect(f.indexOf('float glassOutside = step( 0.0, dot( skbGlassN, vViewPosition ) )')).toBeGreaterThan(flip);
    // KB-I70: the room-side face of box glass (aWin.z = −2) never counts as outside
    expect(f).toContain('* step( -1.5, vWin.z );');
    // the interior mapping builds its frame on the same normal
    expect(f).toContain('cross( skbU, skbGlassN )');
    expect(f).not.toMatch(/dot\( vNormal, vViewPosition \)/);
  });

  it('the room attributes are plain varyings, decoded by rounding (KB-I65 wave 8: no flat varyings)', () => {
    // ANGLE/Metal rewrites the index buffer of every draw whose program has a flat varying (provoking-vertex
    // emulation): ≈ 10 ms per frame at retina for the glass draws. The values are constant per window, so plain
    // varyings carry them; the packed integers are rounded before decoding.
    const m = createMaterials().baked('glass.crown');
    const sh = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
    m.onBeforeCompile(sh as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    for (const s of [sh.vertexShader, sh.fragmentShader]) {
      expect(s).toContain('varying vec4 vRoom;');
      expect(s).toContain('varying vec4 vRoom2;');
      expect(s).not.toMatch(/\bflat\s+varying\b/);
    }
    expect(sh.fragmentShader).toContain('float mode = floor( vRoom.y + 0.5 );');
    expect(sh.fragmentShader).toContain('float packed = floor( vRoom.w + 0.5 );');
  });
});
