import { describe, expect, it } from 'vitest';
import { findForbidden } from '../scripts/bundleGuard';

describe('public-bundle guard (F21/F22 moved out, ADR 0020)', () => {
  it('flags crater/UXO and 3D-print strings', () => {
    expect(findForbidden("cls==='crater_field'")).toHaveLength(1);
    expect(findForbidden('Bombentrichter (Hypothese)')).toHaveLength(1);
    expect(findForbidden('Hinweis, keine Aussage über Kampfmittel/Blindgänger')).toHaveLength(1);
    expect(findForbidden('"format":"sle-print3d-v1"')).toHaveLength(1);
    expect(findForbidden('<h3>3D-Druck</h3>')).toHaveLength(1);
  });

  it('lets the general safety disclaimer and pit labels through', () => {
    expect(findForbidden('<strong>Kampfmittelgefahr an Bunkern/Kratern – nichts berühren.</strong>')).toEqual([]);
    expect(findForbidden("pit:'Grube/Trichter'")).toEqual([]);
    expect(findForbidden('Druckbare HTML-Datei für diesen Marker')).toEqual([]);
  });
});
