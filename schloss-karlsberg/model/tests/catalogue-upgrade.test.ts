import { describe, expect, it } from 'vitest';
import { roofCoverFromText, upgradeV1 } from '../src/catalogue.ts';
import { signedArea } from '../src/layout/geom.ts';
import { readCatalogueV1 } from './helpers.ts';

const v1 = readCatalogueV1();
const v2 = upgradeV1(v1);
const get = (id: string) => v2.buildings.find((b) => b.id === id)!;

describe('upgradeV1', () => {
  it('does not mutate its input and keeps every v1 field', () => {
    const fresh = readCatalogueV1();
    upgradeV1(fresh);
    expect(fresh).toEqual(readCatalogueV1());
    for (const b1 of v1.buildings) {
      const b2 = get(b1.id);
      for (const k of Object.keys(b1)) expect(b2).toHaveProperty(k);
      for (const k of Object.keys(b1.facade)) expect(b2.facade).toHaveProperty(k);
    }
  });

  it('normalises roofs and covers', () => {
    expect(get('KB-B28').roof.type).toBe('mound');
    expect(get('KB-B28').roof.cover).toBe('earth');
    expect(get('KL-B40').roof.type).toBe('none');
    expect(get('KL-B40').roof.note).toContain('iron grilles');
    expect(get('UP-01').roof.type).toBe('none');
    expect(get('KB-B01').roof.cover).toBe('slate');
    expect(get('KB-B20').roof.cover).toBe('tile');
    expect(roofCoverFromText('slate or lead; lantern', 'dome')).toBe('slate');
    expect(roofCoverFromText('copper/lead (oriental onion or tent roof U)', 'dome')).toBe('copper');
  });

  it('assigns storey kinds', () => {
    expect(get('KB-B01').storeys.map((s) => s.kind)).toEqual(['plinth', 'floor', 'floor']);
    expect(get('KB-B10').storeys.map((s) => s.kind)).toEqual(['basement', 'floor']);
    expect(get('KB-B20').storeys.map((s) => s.kind)).toEqual(['plinth', 'floor', 'kneewall']);
    expect(get('KB-B27').storeys.map((s) => s.kind)).toEqual(['wall']);
    expect(get('KB-B28').storeys.map((s) => s.kind)).toEqual(['mound']);
    expect(get('KL-B42').storeys.map((s) => s.kind)).toEqual(['plinth', 'floor']);
  });

  it('forces CCW footprints', () => {
    for (const b of v2.buildings) if (b.footprint) expect(signedArea(b.footprint)).toBeGreaterThan(0);
  });

  it('structures the CdL facade: sides, rhythm groups, centre risalit, raised roof, portals', () => {
    const b = get('KB-B01');
    expect(b.court_toward).toBe('TF-01');
    expect(b.facade.sides?.garden).toMatchObject({ axes: 19, spacing: 4.1, groups: [6, 7, 6] });
    expect(b.facade.sides?.court).toMatchObject({ axes: 9, spacing: 4.1 });
    expect(b.facade.sides?.court?.groups).toBeUndefined();
    expect(b.facade.risalits).toEqual([expect.objectContaining({ side: 'garden', first_axis: 6, axis_count: 7, kind: 'centre' })]);
    expect(b.roof.raised?.[0]).toMatchObject({ side: 'garden', first_axis: 6, axis_count: 7, type: 'mansard', turret: { kind: 'dachreiter' } });
    const ps = b.facade.portals!;
    expect(ps).toContainEqual(expect.objectContaining({ side: 'court', axis: 'centre', kind: 'portal', steps: 7 }));
    expect(ps).toContainEqual(expect.objectContaining({ side: 'garden', kind: 'porte_fenetre', span_axes: 3, storey: 2 }));
    expect(ps).toContainEqual(expect.objectContaining({ side: 'garden', kind: 'door', storey: 1 }));
    expect(b.facade.shutter_type).toBe('louvred');
    expect(b.facade.members_colour).toBe('#BDBAB2');
    expect(b.facade.plinth_colour).toBe('#A65E4A');
    for (const p of ps) expect(p.tag).toMatch(/^I /);
  });

  it('turns Durchfahrt texts into passages on both long sides', () => {
    for (const id of ['KB-B02', 'KB-B03']) {
      const ps = get(id).facade.portals!;
      expect(ps.map((p) => [p.side, p.kind])).toEqual([
        ['court', 'durchfahrt'],
        ['garden', 'durchfahrt'],
      ]);
    }
  });

  it('resolves compass words to the geometric side (Sammlungsfluegel gate on the west)', () => {
    // court of KB-B04 faces the Kuechenhof (east) -> the west gate is on the garden side
    expect(get('KB-B04').facade.portals).toEqual([expect.objectContaining({ side: 'garden', kind: 'carriage_gate' })]);
  });

  it('puts the Reithaus end portal on the end nearer the palace with its dimensions', () => {
    const p = get('KB-B22').facade.portals![0];
    expect(p).toMatchObject({ kind: 'carriage_gate', width: 3.8, height: 4.4 });
    expect(['end_a', 'end_b']).toContain(p.side);
  });

  it('adds a court-side centre risalit with pediment for the Orangerie', () => {
    expect(get('KB-B10').facade.risalits).toEqual([expect.objectContaining({ side: 'court', kind: 'centre', axis_count: 3, first_axis: 9, pediment: true })]);
  });
});
