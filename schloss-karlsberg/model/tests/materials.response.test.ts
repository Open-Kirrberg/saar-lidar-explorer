/**
 * Wave-1 review fixes: material response under the physically based light (matt shutters and sandstone, slate sheen,
 * waxed honey-oak parquet, burnished gilt), ARM roughness normalised to its mean, interior shadow flags in the model.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import { type BuildContext, DEFAULT_BUILD_OPTIONS, makeLayoutFn } from '../src/context.ts';
import { INTERIOR_SHADOW_CASTERS, buildInterior } from '../src/interior/index.ts';
import { ASHLAR } from '../src/exterior/shade.ts';
import { GLASS_LOOK, MATERIAL_BASE, ROUGHNESS_VARIATION, TEXTURE_SIZE, createMaterials, roughnessScale } from '../src/materials/index.ts';

describe('material response (wave-1 review)', () => {
  it('keeps the documented hexes and sets matt dielectrics', () => {
    expect(MATERIAL_BASE['wood.shutter']).toMatchObject({ color: '#5F6F7A', metalness: 0 });
    expect(MATERIAL_BASE['wood.shutter'].roughness).toBeGreaterThanOrEqual(0.8);
    expect(MATERIAL_BASE['wood.shutter'].roughness).toBeLessThanOrEqual(0.9);
    expect(MATERIAL_BASE['roof.slate'].color).toBe('#4A525C');
    expect(MATERIAL_BASE['roof.slate'].roughness).toBeGreaterThanOrEqual(0.55);
    expect(MATERIAL_BASE['roof.slate'].roughness).toBeLessThanOrEqual(0.65);
    for (const n of ['stone.red', 'stone.grey', 'stone.yellow'] as const) expect(MATERIAL_BASE[n].roughness, n).toBeGreaterThanOrEqual(0.85);
  });

  it('parquet is waxed honey oak, gilt a burnished metal', () => {
    const lib = createMaterials();
    const p = lib.get('floor.parquet') as THREE.MeshPhysicalMaterial;
    expect(p.isMeshPhysicalMaterial).toBe(true);
    expect(`#${p.color.getHexString().toUpperCase()}`).toBe('#9B7448'); // research/02 §3
    expect(p.roughness).toBe(0.45);
    // a thin wax film, no grey veil (Festsaal review, wave 2)
    expect(p.clearcoat).toBeGreaterThan(0.05);
    expect(p.clearcoat).toBeLessThanOrEqual(0.2);
    expect(p.specularIntensity).toBeLessThanOrEqual(0.5);
    const g = lib.get('metal.gilt') as THREE.MeshStandardMaterial;
    expect(`#${g.color.getHexString().toUpperCase()}`).toBe('#D4AF6A');
    expect(g.metalness).toBe(1);
    expect(g.roughness).toBeGreaterThanOrEqual(0.25);
    expect(g.roughness).toBeLessThanOrEqual(0.35);
  });

  it('roughnessScale varies roughness around 1 at the map mean, clamped', () => {
    expect(roughnessScale(0.1, 0.1)).toBe(1);
    expect(roughnessScale(0.506, 0.506)).toBe(1);
    // the Poly Haven parquet ARM (G mean ≈ 0.10) no longer turns a 0.45 floor into a mirror
    expect(0.45 * roughnessScale(0.05, 0.1)).toBeGreaterThan(0.3);
    const { min, max, contrast } = ROUGHNESS_VARIATION;
    expect(roughnessScale(0, 0.5)).toBeCloseTo(1 + (min - 1) * contrast);
    expect(roughnessScale(1, 0.1)).toBeCloseTo(1 + (max - 1) * contrast);
  });
});

describe('interior shadow flags', () => {
  const { spec } = loadSite(JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8')));
  const ctx: BuildContext = { spec, lod: 2, materials: createMaterials(), terrain: () => NaN, options: { ...DEFAULT_BUILD_OPTIONS }, layout: makeLayoutFn(spec) };
  it('every visible interior mesh receives shadows; only room walls, cornices and ceilings cast', () => {
    const g = buildInterior(spec.buildings.find((b) => b.id === 'KB-B01')!, ctx);
    let n = 0;
    let casters = 0;
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.userData.collider === true) return;
      n++;
      const shell = INTERIOR_SHADOW_CASTERS.has(m.userData.part);
      if (shell) casters++;
      expect(m.castShadow, m.name).toBe(shell);
      expect(m.receiveShadow, m.name).toBe(true);
      if ((m as THREE.InstancedMesh).isInstancedMesh) expect(m.castShadow, m.name).toBe(false);
    });
    expect(n).toBeGreaterThan(10);
    expect(casters).toBeGreaterThan(0);
    expect(casters).toBeLessThan(n);
  });
});

describe('window glass seen from outside (wave-3 review, KB-I42)', () => {
  const compile = (m: THREE.Material) => {
    const sh = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    };
    m.onBeforeCompile(sh as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    return sh;
  };
  it('patches the baked glass: room proxy and alpha before the alpha test, unattenuated reflections after opaque', () => {
    const m = createMaterials().baked('glass.crown');
    const sh = compile(m);
    const f = sh.fragmentShader;
    expect(sh.uniforms.uGlassRoom).toBeDefined();
    expect(sh.uniforms.uGlassOut.value.x).toBe(GLASS_LOOK.outsideAlpha);
    const decl = f.indexOf('float glassOutside');
    expect(decl).toBeGreaterThan(0);
    expect(decl).toBeLessThan(f.indexOf('#include <alphatest_fragment>'));
    expect(f.indexOf('uGlassOut.y')).toBeGreaterThan(f.indexOf('#include <aomap_fragment>'));
    expect(f.indexOf('glassSpec')).toBeGreaterThan(f.indexOf('#include <opaque_fragment>'));
    // the baked AO patch still applies on top
    expect(f).toContain('bakedAO');
    expect(m.customProgramCacheKey()).toContain('glass');
    // other materials are untouched
    expect(compile(createMaterials().get('render.lime')).fragmentShader).not.toContain('glassOutside');
  });
  it('the room behind the glass stays well below the limewash (shaded glass darker than the wall)', () => {
    const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const room = lum(new THREE.Color(GLASS_LOOK.roomColour)) * GLASS_LOOK.outsideAlpha;
    const wall = lum(new THREE.Color(MATERIAL_BASE['render.lime'].color));
    expect(room / wall).toBeLessThan(0.15);
    expect(GLASS_LOOK.outsideAlpha).toBeGreaterThanOrEqual(0.75);
    expect(GLASS_LOOK.roomDirect).toBeLessThan(0.5);
  });
  it('maps the ashlar texture on the stone-hue course grid', () => {
    expect(TEXTURE_SIZE.sandstone_ashlar).toEqual([ASHLAR.tile, ASHLAR.tileV]);
  });
});
