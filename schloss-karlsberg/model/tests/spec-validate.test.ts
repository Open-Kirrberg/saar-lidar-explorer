import { describe, expect, it } from 'vitest';
import { CatalogueError, loadSite, upgradeV1 } from '../src/catalogue.ts';
import { isPlaced, parseEvidenceTags } from '../src/spec.ts';
import { normaliseRoofTypeLoose, validateSite } from '../src/validate.ts';
import { readCatalogueV1 } from './helpers.ts';

describe('validator', () => {
  it('accepts catalogue.json v1 in v1-compatible mode', () => {
    const r = validateSite(readCatalogueV1(), 'v1-compatible');
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    // only the two free-text roof types are flagged
    expect(r.warnings.map((w) => w.path).sort()).toEqual([
      '$.buildings[22](KB-B28).roof.type',
      '$.buildings[9](KL-B40).roof.type',
    ]);
  });

  it('rejects v1 in strict v2 mode', () => {
    const r = validateSite(readCatalogueV1(), 'v2');
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === '$.version')).toBe(true);
    expect(r.errors.some((e) => e.path.endsWith('.roof.type'))).toBe(true);
    expect(r.errors.some((e) => e.path.endsWith('.kind'))).toBe(true);
  });

  it('accepts the upgraded catalogue in v2 mode without warnings', () => {
    const r = validateSite(upgradeV1(readCatalogueV1()), 'v2');
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('finds structural errors', () => {
    const c = readCatalogueV1();
    c.buildings[1].id = c.buildings[0].id; // duplicate
    c.buildings[2].footprint = c.buildings[2].footprint!.slice(0, -1); // not closed
    c.buildings[3].base_h = 5; // implausible height
    (c.buildings[4] as unknown as { cls: string }).cls = 'TOWER';
    c.buildings[5].storeys[0].height = -1;
    (c.terrain_features[0].geometry as { type: string }).type = 'Circle';
    const r = validateSite(c, 'v1-compatible');
    const paths = r.errors.map((e) => e.path);
    expect(paths.some((p) => p.endsWith('.id') && p.includes('[1]'))).toBe(true);
    expect(r.errors.some((e) => e.message === 'ring not closed')).toBe(true);
    expect(paths.some((p) => p.endsWith('.base_h'))).toBe(true);
    expect(paths.some((p) => p.endsWith('.cls'))).toBe(true);
    expect(paths.some((p) => p.endsWith('.storeys[0].height'))).toBe(true);
    expect(paths.some((p) => p.startsWith('$.terrain_features[0]') && p.endsWith('geometry.type'))).toBe(true);
  });

  it('treats a clockwise ring as warning (v1) and error (v2)', () => {
    const c = readCatalogueV1();
    c.buildings[0].footprint = c.buildings[0].footprint!.slice().reverse();
    expect(validateSite(c, 'v1-compatible').warnings.some((w) => w.message.includes('clockwise'))).toBe(true);
    const v2 = upgradeV1(readCatalogueV1());
    v2.buildings[0].footprint = v2.buildings[0].footprint!.slice().reverse();
    expect(validateSite(v2, 'v2').errors.some((e) => e.message.includes('clockwise'))).toBe(true);
  });

  it('checks v2 interiors (rooms, openings with wall refs)', () => {
    const v2 = upgradeV1(readCatalogueV1());
    const b = v2.buildings[0];
    b.rooms = [{ id: 'R1', name_de: 'Salon', storey: 2, polygon: [[0, 0], [5, 0], [5, 5]], tag: 'I' }];
    b.openings = [
      { kind: 'double_door', storey: 2, wall: { kind: 'room', room: 'R1', edge: 0 }, a: 1, width: 1.4, height: 3, sill: 0, tag: 'N' },
      { kind: 'double_door', storey: 9, wall: { kind: 'room', room: 'NOPE', edge: 0 }, a: 1, width: 1.4, height: 3, sill: 0, tag: 'N' },
    ];
    const r = validateSite(v2, 'v2');
    expect(r.errors.map((e) => e.path)).toEqual(['$.buildings[0](KB-B01).openings[1].storey', '$.buildings[0](KB-B01).openings[1].wall.room']);
  });

  it('loadSite returns a v2 spec and throws CatalogueError on invalid input', () => {
    const { spec } = loadSite(readCatalogueV1());
    expect(spec.version).toBe(2);
    expect(spec.buildings).toHaveLength(47);
    expect(() => loadSite({ version: 1 })).toThrow(CatalogueError);
  });
});

describe('spec helpers', () => {
  it('parses evidence tags from free text', () => {
    expect(parseEvidenceTags('N; HMS shows plinth with cellar windows')).toEqual(['N', 'HMS']);
    expect(parseEvidenceTags('7 centre axes D (Louisenhof); 4.1 m D-> (Saarbruecken 4.36); 19 total I')).toEqual(['D', 'D->', 'I']);
    expect(parseEvidenceTags('D floor-length windows (skb); size N')).toEqual(['D', 'N']);
    expect(parseEvidenceTags('form I/N')).toEqual(['I', 'N']);
    expect(parseEvidenceTags('')).toEqual([]);
  });

  it('normalises v1 roof types', () => {
    expect(normaliseRoofTypeLoose('earth mound')).toBe('mound');
    expect(normaliseRoofTypeLoose('none (iron grilles / net domes)')).toBe('none');
    expect(normaliseRoofTypeLoose('dome')).toBe('dome');
    expect(normaliseRoofTypeLoose('Walmdach')).toBe('hip');
    expect(normaliseRoofTypeLoose('onion')).toBeNull();
  });

  it('isPlaced: 29 placed buildings, 18 unplaced', () => {
    const { spec } = loadSite(readCatalogueV1());
    expect(spec.buildings.filter(isPlaced)).toHaveLength(29);
    expect(spec.buildings.filter((b) => b.placement === 'unplaced')).toHaveLength(18);
  });
});
