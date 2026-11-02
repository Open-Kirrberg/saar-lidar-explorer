/**
 * KB-I15 exterior palette (research/09 §3.7, §6.2 M1/M2/M4/M7, §6.3 E7, §6.5 C3/C4): blue-grey shutters and slate,
 * blue-grey-black iron, painted-render members on court buildings, exposed stone only at plinths, portals and steps.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import { DEFAULT_BUILD_OPTIONS, type BuildContext, MATERIAL_NAMES, makeLayoutFn } from '../src/context.ts';
import { buildExterior, palette } from '../src/exterior/index.ts';
import { MATERIAL_BASE, createMaterials } from '../src/materials/index.ts';
import { readCatalogue } from './helpers.ts';

const { spec } = loadSite(readCatalogue());
const ctx = (lod: 0 | 1 | 2): BuildContext => ({ spec, lod, materials: createMaterials(), terrain: () => NaN, options: { ...DEFAULT_BUILD_OPTIONS }, layout: makeLayoutFn(spec) });
const B = (id: string) => spec.buildings.find((b) => b.id === id)!;

describe('KB-I15 material colours', () => {
  it('has the period hexes', () => {
    expect(MATERIAL_NAMES).toContain('render.member');
    expect(MATERIAL_BASE['render.member'].color).toBe('#B9B8B2');
    expect(MATERIAL_BASE['wood.shutter'].color).toBe('#5F6F7A');
    expect(MATERIAL_BASE['roof.slate'].color).toBe('#4A525C');
    expect(MATERIAL_BASE['metal.iron'].color).toBe('#2E3439');
    expect(spec.defaults.slate).toBe('#4A525C');
  });
});

describe('KB-I15 palette()', () => {
  it('court buildings: members as painted render, portals in grey-pink sandstone, plinth red sandstone', () => {
    for (const id of ['KB-B01', 'KB-B02', 'KB-B03', 'KB-B04', 'KB-B05', 'KB-B10']) {
      const p = palette(B(id), ctx(1));
      expect(p.members, id).toBe('render.member|#B9B8B2');
      expect(p.stone, id).toBe('stone.grey|#BFAEA5');
      expect(p.plinth, id).toBe('stone.red|#A65E4A');
    }
  });

  it('farm and stable buildings keep sandstone dressings', () => {
    const farm = spec.buildings.find((b) => b.cls === 'FARM' && b.facade.members_colour)!;
    expect(palette(farm, ctx(1)).members.startsWith('stone.grey')).toBe(true);
  });

  it('shutter colours by class: court blue-grey, farm green, stables oxblood', () => {
    expect(B('KB-B02').facade.shutter_colour).toBe('#5F6F7A');
    expect(B('KB-B49').facade.shutter_colour).toBe('#5F6F7A'); // Cavaliershaus, court-town range
    expect(B('KB-B57a').facade.shutter_colour).toBe('#3F5A3A');
    expect(B('KB-B31').facade.shutter_colour).toBe('#6E2E26');
  });

  it('the S wing facade uses render.member for members and stone only at plinths, portals and steps', () => {
    const g = buildExterior(B('KB-B02'), ctx(1));
    const names = new Set<string>();
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) names.add((m.material as THREE.Material).name);
    });
    expect(names.has('render.member')).toBe(true);
    expect(names.has('stone.grey')).toBe(true); // Durchfahrt voussoirs, portico
    expect(names.has('stone.red')).toBe(true); // plinth, steps
  });
});
