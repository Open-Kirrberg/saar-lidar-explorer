import { describe, expect, it } from 'vitest';
import catalogue from '../../model/catalogue.json';
import { loadSite } from '@model/catalogue.ts';
import { layoutBuilding } from '@model/layout/building.ts';
import { GLASS_LOOK, MATERIAL_BASE } from '@model/materials/index.ts';
import { SILK_BASE } from '@model/interior/finish.ts';
import {
  CURTAIN_GAP,
  CURTAIN_KIND,
  CURTAIN_SHARE,
  ROOM_MODE,
  type RoomInfo,
  type WindowRoom,
  catalogueRooms,
  packRgb565,
  roomAttributes,
  roomHit,
  unpackRgb565,
  windowRoomAt,
} from '../src/windowRooms.ts';

const { spec } = loadSite(catalogue);

/** A 24 m long, 8 m deep hall (level-local x along the facade, z = −t; the facade at z = +4, normal +z). */
const hall = (id: string, over: Partial<RoomInfo> = {}): RoomInfo => ({
  id,
  type: 'salon',
  grade: 'private',
  ring: [
    [-12, -4],
    [12, -4],
    [12, 4],
    [-12, 4],
  ],
  floor_h: 350,
  ceiling_h: 355,
  wall: '#F1EFE8',
  silk: false,
  ...over,
});
const N: [number, number] = [0, 1];
/** window at x on the facade (glass 0.6 m out in the wall), bottom 1 m above the floor, 2.6 m tall */
const at = (rooms: RoomInfo[], x: number, key = `w${x}`, roof = false) => windowRoomAt(rooms, [x, 352.3, 4.6], N, 351, 2.6, 0.6, key, roof);

describe('windowRoomAt: the catalogue room behind the window (KB-I42, wave-7 review)', () => {
  it('every window of one hall looks into the same space: one colour, mode, curtain choice and depth', () => {
    const rooms = [hall('R1')];
    const ws = [-9, -5, 0, 4, 8].map((x) => at(rooms, x));
    for (const w of ws) {
      expect(w.wall).toBe('#F1EFE8');
      expect(w.mode).toBe(ws[0].mode);
      expect(w.open < 1).toBe(ws[0].open < 1);
      expect(w.curtain).toBe(ws[0].curtain);
      // glass 0.6 m outside the clear wall line + 8 m of room
      expect(w.depth).toBeCloseTo(8.6, 1);
      // the side walls are the hall's ends: left + right = the hall length from every window
      expect(w.left + w.right).toBeCloseTo(24, 1);
      expect(w.sill).toBeCloseTo(1, 9);
      expect(w.ceil).toBeCloseTo(4, 9);
    }
    expect(ws[0].left).toBeCloseTo(3, 1);
    expect(ws[4].right).toBeCloseTo(4, 1);
  });

  it('takes the room of the window storey only', () => {
    const rooms = [hall('EG', { floor_h: 345, ceiling_h: 349.5, wall: '#5B7798' }), hall('OG', { floor_h: 350, ceiling_h: 355 })];
    expect(at(rooms, 0).wall).toBe('#F1EFE8');
  });

  it('dormers and oculi (roof glass), service rooms and windows with no room behind them show the dark cavity', () => {
    const cavity = GLASS_LOOK.interior.cavity;
    expect(at([hall('R')], 0, 'k', true)).toMatchObject({ mode: ROOM_MODE.cavity, wall: cavity, open: 1 });
    expect(at([hall('K', { grade: 'service', type: 'kitchen' })], 0)).toMatchObject({ mode: ROOM_MODE.cavity, wall: cavity, open: 1 });
    // a room on another storey only: nothing behind this window (stair or roof space)
    expect(at([hall('EG', { floor_h: 340, ceiling_h: 344 })], 0).mode).toBe(ROOM_MODE.cavity);
  });

  it('a building without any room keeps a plain, uncurtained generic room', () => {
    const w = at([], 0);
    expect(w.mode).toBe(ROOM_MODE.room);
    expect(w.open).toBe(1);
    expect(w.wall).toBe(GLASS_LOOK.interior.fallbackWall);
  });

  it('curtains in about a third of the rooms, only muslin or the room silk, never a free palette colour', () => {
    let curtained = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      const silk = i % 2 === 0;
      const w = at([hall(`R${i}`, { silk, wall: silk ? '#8E2A2E' : '#F1EFE8' })], 0);
      if (w.open < 1) {
        curtained++;
        expect(w.open).toBeGreaterThanOrEqual(0.45);
        expect(w.open).toBeLessThanOrEqual(0.8);
        expect(Object.values(CURTAIN_KIND)).toContain(w.curtain);
        if (!silk) expect(w.curtain).not.toBe(CURTAIN_KIND.silk);
      }
    }
    expect(curtained / n).toBeGreaterThan(CURTAIN_SHARE - 0.08);
    expect(curtained / n).toBeLessThan(CURTAIN_SHARE + 0.08);
    expect(GLASS_LOOK.interior.curtains.length).toBe(2);
  });

  it('is deterministic', () => {
    expect(at([hall('R7')], 3)).toEqual(at([hall('R7')], 3));
  });
});

describe('catalogueRooms', () => {
  it('reads the catalogue rooms in the level-local frame with their finish colour', () => {
    const b = spec.buildings.find((x) => x.id === 'KB-B03')!;
    const rooms = catalogueRooms(b, layoutBuilding(b, spec));
    expect(rooms.length).toBe(b.rooms!.length);
    for (const [r, src] of rooms.map((r, i) => [r, b.rooms![i]] as const)) {
      expect(r.ring[0]).toEqual([src.polygon[0][0], -src.polygon[0][1]]);
      expect(r.ceiling_h).toBeGreaterThan(r.floor_h);
      const walls = src.finish?.walls;
      if (walls?.startsWith('wall.silk')) expect(r.wall).toBe(src.finish?.colour ?? SILK_BASE[walls]);
      else if (walls && walls in MATERIAL_BASE) expect(r.wall).toBe(MATERIAL_BASE[walls as keyof typeof MATERIAL_BASE].color);
    }
  });

  it('gives a building with an interior but no room programme its generated hall', () => {
    const b = spec.buildings.find((x) => !x.rooms?.length && x.interior !== 'none' && x.placement !== 'hypothetical');
    if (!b) return;
    expect(catalogueRooms(b, layoutBuilding(b, spec)).length).toBeGreaterThan(0);
  });
});

describe('attribute packing (one truth with the GLSL decode)', () => {
  it('rgb565 round trip within one step', () => {
    for (const hex of ['#F1EFE8', '#8E2A2E', '#5B7798', '#000000', '#FFFFFF']) {
      const [r, g, b] = unpackRgb565(packRgb565(hex));
      const v = parseInt(hex.slice(1), 16);
      expect(Math.abs(r - ((v >> 16) & 255) / 255)).toBeLessThan(1 / 31);
      expect(Math.abs(g - ((v >> 8) & 255) / 255)).toBeLessThan(1 / 63);
      expect(Math.abs(b - (v & 255) / 255)).toBeLessThan(1 / 31);
    }
  });

  it('aRoom.w = rgb565 + 65536 · curtain kind decodes like the shader; float-exact', () => {
    const room: WindowRoom = { mode: 2, depth: 6, left: 2, right: 3, sill: 1, ceil: 4, open: 0.5, wall: '#C9A94E', curtain: CURTAIN_KIND.silk };
    const { aRoom, aRoom2 } = roomAttributes(room);
    const w = Math.fround(aRoom[3]);
    const kind = Math.floor(w / 65536 + 1e-4);
    expect(kind).toBe(CURTAIN_KIND.silk);
    expect(w - 65536 * kind).toBe(packRgb565('#C9A94E'));
    expect(aRoom.slice(0, 3)).toEqual([6, 2, 0.5]);
    expect(aRoom2).toEqual([2, 3, 1, 4]);
  });
});

describe('roomHit (CPU twin of the ray cast)', () => {
  const open: WindowRoom = { mode: 1, depth: 6, left: 3, right: 2, sill: 0.85, ceil: 3.5, open: 1, wall: '#F1EFE8', curtain: 0 };
  const halfW = 0.65;
  const height = 2.8;

  it('a ray straight in through the middle hits the back wall at the room depth', () => {
    const h = roomHit([0, 1.4], [0, 0, -1], open, halfW, height);
    expect(h.surface).toBe('back');
    expect(h.at[2]).toBeCloseTo(-6, 9);
  });

  it('floor below the sill, ceiling above the head', () => {
    const d = Math.SQRT1_2;
    expect(roomHit([0, 0.5], [0, -d, -d], open, halfW, height).at[1]).toBeCloseTo(-0.85, 9);
    expect(roomHit([0, 2.0], [0, d, -d], open, halfW, height).at[1]).toBeCloseTo(3.5, 9);
  });

  it('side walls at −left and +right (asymmetric hall)', () => {
    expect(roomHit([0, 1.4], [0.95, 0, -0.3122], open, halfW, height).at[0]).toBeCloseTo(2, 9);
    expect(roomHit([0, 1.4], [-0.95, 0, -0.3122], open, halfW, height).at[0]).toBeCloseTo(-3, 9);
  });

  it('half-drawn curtains cover the window sides, the middle stays open', () => {
    const room = { ...open, open: 0.5 };
    expect(roomHit([0.5, 1.4], [0, 0, -1], room, halfW, height).surface).toBe('curtain');
    expect(roomHit([0.5, 1.4], [0, 0, -1], room, halfW, height).at[2]).toBeCloseTo(-CURTAIN_GAP, 9);
    expect(roomHit([0.1, 1.4], [0, 0, -1], room, halfW, height).surface).toBe('back');
  });
});

describe('daylight level of the mapped room', () => {
  it('the brightest room wall stays ≤ 25 % of the limewash under the same light (no window reads lit by day)', () => {
    const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const lum = (hex: string) => {
      const v = parseInt(hex.slice(1), 16);
      return 0.2126 * lin(((v >> 16) & 255) / 255) + 0.7152 * lin(((v >> 8) & 255) / 255) + 0.0722 * lin((v & 255) / 255);
    };
    const brightest = Math.max(lum(MATERIAL_BASE['wall.boiserie'].color), lum(GLASS_LOOK.interior.ceiling), ...GLASS_LOOK.interior.curtains.map(lum));
    expect((brightest * GLASS_LOOK.interior.gain) / lum(MATERIAL_BASE['render.lime'].color)).toBeLessThanOrEqual(0.25);
  });
});
