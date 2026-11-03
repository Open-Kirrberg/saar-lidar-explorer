// KB-I24 wave-4 review fixes on the Tempelzimmer rotunda exterior: Ionic volutes from LOD1, the portico roof ending
// against a raised attic block (not in the dome), a smooth dull lead dome, grey columns.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import { DEFAULT_BUILD_OPTIONS, type BuildContext, makeLayoutFn } from '../src/context.ts';
import { GeoBuilder } from '../src/exterior/builder.ts';
import { buildExterior } from '../src/exterior/index.ts';
import { voluteDisc } from '../src/exterior/rotunda.ts';
import { ROTUNDA } from '../src/layout/grammar.ts';
import { rotundaLayout } from '../src/layout/rotunda.ts';
import { MATERIAL_BASE, createMaterials } from '../src/materials/index.ts';

const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8'));
const { spec } = loadSite(raw);
const layout = makeLayoutFn(spec);
const B07 = spec.buildings.find((b) => b.id === 'KB-B07')!;
const ctx = (lod: 0 | 1 | 2): BuildContext => ({ spec, lod, materials: createMaterials(), terrain: () => NaN, options: { ...DEFAULT_BUILD_OPTIONS, showHypothetical: true }, layout });

describe('KB-I24 rotunda layout: portico roof and attic block', () => {
  it('wave 10: with the lead collar (ROTUNDA.porticoCollar) the portico roof needs no attic block', () => {
    const P = rotundaLayout(layout(B07))!.portico!;
    expect(P.pediment).not.toBeNull();
    expect(P.atticBlock === null).toBe(ROTUNDA.porticoCollar);
  });
  it.skipIf(ROTUNDA.porticoCollar)('the pediment roof stays under the attic block top, which clears it by ROTUNDA.atticBlockClear', () => {
    const R = rotundaLayout(layout(B07))!;
    const P = R.portico!;
    expect(P.pediment).not.toBeNull();
    expect(P.atticBlock).not.toBeNull();
    const A = P.atticBlock!;
    // lead roof 0.07 m over the raking cornice apex
    expect(P.pediment!.apex_h + 0.07 + ROTUNDA.atticBlockClear).toBeLessThanOrEqual(A.top_h + 1e-9);
    expect(A.top_h).toBeGreaterThanOrEqual(layout(B07).stack.eaves_h);
    // the block is at least as wide as the pediment, stands in front of the drum and reaches back inside it
    expect(A.halfWidth).toBeGreaterThanOrEqual(P.pediment!.halfWidth);
    expect(A.front).toBeGreaterThan(R.radius);
    expect(A.front).toBeLessThan(P.front);
    expect(Math.hypot(A.back, A.halfWidth)).toBeLessThan(R.radius);
  });
});

describe('KB-I24 rotunda exterior (wave-4 review)', () => {
  it('a volute disc faces its `out` direction', () => {
    const g = new GeoBuilder();
    voluteDisc(g, 'render.member', [0, 0, 10], [1, 0], [0, 1], 0.12, 1);
    const [m] = g.toMeshes(createMaterials(), 'v', {});
    const n = m.geometry.attributes.normal;
    // object space: plan t = −z, so out (0, 1) in [s, t] is −z
    for (let i = 0; i < n.count; i++) expect(n.getZ(i)).toBeLessThan(-0.3);
  });

  it('LOD1 already carries the Ionic volutes (more member triangles than plain capitals would need)', () => {
    const count = (lod: 1 | 2) => {
      let n = 0;
      buildExterior(B07, ctx(lod)).traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && /render\.member$/.test(m.name)) n += m.geometry.attributes.position.count / 3;
      });
      return n;
    };
    const R = rotundaLayout(layout(B07))!;
    const columns = R.portico!.columns.length + (R.colonnade?.columns.length ?? 0);
    // ≥ 4 volute discs × 8 segments × 2 rings per column and 2 discs per pilaster
    expect(count(1)).toBeGreaterThan((columns * 4 + R.pilasters.length * 2) * 16);
  });

  it('the lead dome has smooth normals and a dull lead', () => {
    let normals: THREE.BufferAttribute | null = null;
    buildExterior(B07, ctx(1)).traverse((o) => {
      const m = o as THREE.Mesh;
      // the dome is the largest lead mesh (the portico roof and the block top are separate, flat pieces)
      if (m.isMesh && /roof\.lead$/.test(m.name) && (!normals || m.geometry.attributes.normal.count > normals.count)) normals = m.geometry.attributes.normal as THREE.BufferAttribute;
    });
    expect(normals).not.toBeNull();
    const n = normals!;
    // smooth: the three normals of a dome triangle differ (flat shading repeats one normal three times)
    let smooth = 0;
    for (let i = 0; i < n.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(n, i);
      const b = new THREE.Vector3().fromBufferAttribute(n, i + 1);
      if (a.distanceTo(b) > 1e-4) smooth++;
    }
    expect(smooth).toBeGreaterThan(n.count / 3 / 2);
    expect(MATERIAL_BASE['roof.lead'].metalness ?? 0).toBeLessThanOrEqual(0.2);
    expect(MATERIAL_BASE['roof.lead'].roughness).toBeGreaterThanOrEqual(0.6);
  });
});
