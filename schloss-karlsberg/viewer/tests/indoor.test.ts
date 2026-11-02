import { describe, expect, it } from 'vitest';
import catalogue from '../../model/catalogue.json';
import { loadSite } from '@model/catalogue.ts';
import * as THREE from 'three';
import { INTERIOR_NEIGHBOUR_M, SHELL_LIFT_BASE_EV, SHELL_LIFT_EV, countsAsIndoor, inShell, interiorMode, ringDistance, roomLightOn, shellLiftEv } from '../src/indoor.ts';
import { applyInteriorMode } from '../src/interiorView.ts';

const { spec } = loadSite(catalogue);
const byId = (id: string) => {
  const b = spec.buildings.find((x) => x.id === id);
  if (!b) throw new Error(id);
  return b;
};

describe('countsAsIndoor (KB-I60)', () => {
  it('the glazed Tempelzimmer KB-B07 (room shell, no interior model) is not indoor', () => {
    expect(byId('KB-B07').interior).toBe('none');
    expect(countsAsIndoor(byId('KB-B07'), true)).toBe(false);
  });

  it('open garden enclosures never count as indoor', () => {
    const gard = spec.buildings.filter((b) => b.cls === 'GARD');
    expect(gard.length).toBeGreaterThan(0);
    for (const b of gard) {
      expect(countsAsIndoor(b, true)).toBe(false);
      expect(shellLiftEv(b, true)).toBe(0);
    }
    expect(countsAsIndoor({ cls: 'GARD', interior: 'detailed' }, true)).toBe(false);
  });

  it('rooms with a drawn interior model keep the indoor look (poses 06, 07, 20-24 unchanged)', () => {
    for (const id of ['KB-B01', 'KB-B03', 'KB-B04', 'KB-B05', 'KB-B06']) {
      const b = byId(id);
      expect(b.interior).not.toBe('none');
      expect(countsAsIndoor(b, true)).toBe(true);
      expect(shellLiftEv(b, true)).toBe(0);
    }
  });

  it('rooms that are not drawn (hidden or not built yet) do not count', () => {
    expect(countsAsIndoor(byId('KB-B01'), false)).toBe(false);
    expect(shellLiftEv(byId('KB-B07'), false)).toBe(0);
  });
});

describe('shellLiftEv (KB-I60)', () => {
  it('lifts the Tempelzimmer exposure by the unglazed share of its bays (5 glass doors of 8)', () => {
    expect(shellLiftEv(byId('KB-B07'), true)).toBeCloseTo(SHELL_LIFT_BASE_EV + SHELL_LIFT_EV * (3 / 8), 6);
    // wave-7 review: about +0.3 EV more than KB-I60's +0.75 EV
    expect(shellLiftEv(byId('KB-B07'), true)).toBeCloseTo(1.05, 6);
  });

  it('a shell without glazing information gets half the lift; buildings without rooms none', () => {
    expect(shellLiftEv({ cls: 'PAV', interior: 'none', rooms: [{}] }, true)).toBe(SHELL_LIFT_BASE_EV + SHELL_LIFT_EV / 2);
    expect(shellLiftEv({ cls: 'FARM', interior: 'none' }, true)).toBe(0);
    expect(shellLiftEv({ cls: 'PAV', interior: 'none', rooms: [{}], facade: { rotunda: { bays: ['door', 'door'] } } }, true)).toBe(SHELL_LIFT_BASE_EV);
  });

  it('no farm or service building without rooms gets a lift', () => {
    for (const b of spec.buildings) if (b.interior === 'none' && !b.rooms?.length) expect(shellLiftEv(b, true)).toBe(0);
  });
});

describe('roomLightOn (KB-I65)', () => {
  it('draws only burning lights of the nearest room while the visitor is inside', () => {
    expect(roomLightOn(true, true, 0.4)).toBe(true);
    expect(roomLightOn(true, true, 0)).toBe(false);
    expect(roomLightOn(false, true, 0.4)).toBe(false);
    expect(roomLightOn(true, false, 0.4)).toBe(false);
  });
});

describe('interiorMode (KB-I42 / KB-I65)', () => {
  it('draws the full interior only for a visitor inside (or in a neighbour within 6 m)', () => {
    expect(interiorMode(true, 0)).toBe('full');
    expect(interiorMode(true, INTERIOR_NEIGHBOUR_M)).toBe('full');
    expect(interiorMode(true, INTERIOR_NEIGHBOUR_M + 1)).toBe('shell');
  });

  it('from outside only the ground-level shell (the far cut-off is the interior budget of the caller)', () => {
    expect(interiorMode(false, 0)).toBe('shell');
    expect(interiorMode(false, 80)).toBe('shell');
  });

  it('the shell keeps floors, walls, reveals, ceilings, doors and stairs of the plinth and ground storey', () => {
    for (const p of ['interior/boden', 'interior/wand', 'interior/laibung', 'interior/decke', 'interior/tuer', 'interior/tuerblatt']) {
      expect(inShell(p, 1)).toBe(true);
      expect(inShell(p, 0)).toBe(true);
      expect(inShell(p, 2)).toBe(false);
    }
    expect(inShell('interior/fireplace', 1)).toBe(false);
    expect(inShell('interior/boden', undefined)).toBe(false);
    expect(inShell(undefined, 1)).toBe(false);
  });
});

describe('ringDistance', () => {
  const sq: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  it('is 0 inside and the plan distance to the nearest edge outside', () => {
    expect(ringDistance(5, 5, sq)).toBe(0);
    expect(ringDistance(13, 5, sq)).toBeCloseTo(3, 9);
    expect(ringDistance(13, 14, sq)).toBeCloseTo(5, 9);
    expect(ringDistance(-2, -2, sq)).toBeCloseTo(Math.hypot(2, 2), 9);
  });
});

describe('applyInteriorMode', () => {
  const build = () => {
    const inner = new THREE.Group();
    const mk = (part: string, roomId: string, visible = true) => {
      const o = new THREE.Object3D();
      o.userData = { part, roomId };
      o.visible = visible;
      inner.add(o);
      return o;
    };
    return {
      inner,
      wall0: mk('interior/wand', 'r-eg'),
      chair: mk('interior/furniture', 'r-eg'),
      wall2: mk('interior/wand', 'r-og'),
      collider: mk('interior/collider', 'r-eg', false),
    };
  };
  const storey = (id: string) => (id === 'r-eg' ? 1 : 2);

  it('shell shows only the ground-level shell; full shows all; off hides the group', () => {
    const t = build();
    expect(applyInteriorMode(t.inner, 'shell', storey)).toBe(true);
    expect([t.inner.visible, t.wall0.visible, t.chair.visible, t.wall2.visible]).toEqual([true, true, false, false]);
    expect(applyInteriorMode(t.inner, 'shell', storey)).toBe(false);
    applyInteriorMode(t.inner, 'full', storey);
    expect([t.wall0.visible, t.chair.visible, t.wall2.visible]).toEqual([true, true, true]);
    expect(applyInteriorMode(t.inner, 'off', storey)).toBe(true);
    expect(t.inner.visible).toBe(false);
  });

  it('children built invisible (walk colliders) stay invisible in every mode', () => {
    const t = build();
    for (const m of ['full', 'shell', 'full'] as const) {
      applyInteriorMode(t.inner, m, storey);
      expect(t.collider.visible).toBe(false);
    }
  });

  it('re-applies the group flag every call (the display toggle may reset it)', () => {
    const t = build();
    applyInteriorMode(t.inner, 'full', storey);
    t.inner.visible = false;
    expect(applyInteriorMode(t.inner, 'full', storey)).toBe(true);
    expect(t.inner.visible).toBe(true);
  });
});
