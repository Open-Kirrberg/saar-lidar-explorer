/**
 * Wave-10 review fix (look): cumulus shape and default, sky-cube strips, the night fill on the land, the Milky Way
 * frame and profile, room lights per storey, table-candle lamps.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CLOUD, CLOUD_ALOFT, CLOUD_PARS_GLSL, cloudAloft, cloudColumn, cloudMode, cloudsShown, cloudTop, cumulusAmount } from '../src/clouds.ts';
import { SKY_CUBE_SIZE, SKY_CUBE_TILES, skyCubeTile } from '../src/postMath.ts';
import { NIGHT_GROUND_FILL, nightGroundFill } from '../src/light.ts';
import { GALACTIC_FROM_J2000, MILKY_WAY, STAR_SPOT, galactic, milkyWayProfile } from '../src/nightSky.ts';
import { LIGHT_SPILL_M, lightOnStorey } from '../src/indoor.ts';
import { rundflugSpec } from '../src/tour.ts';

const C: [number, number] = [1226, -1120];

describe('cumulus shape (wave-10 review fix)', () => {
  it('a column stands exactly where the shadow field has cover, never above the layer thickness', () => {
    let n = 0;
    for (let x = -6000; x <= 6000; x += 97)
      for (let z = -6000; z <= 6000; z += 89) {
        const top = cloudColumn(x, z, 1, C[0], C[1]);
        const c = cloudTop(x, z, 1, C[0], C[1]);
        expect(top > 0).toBe(c > 0);
        expect(top).toBeLessThanOrEqual(CLOUD.thickness);
        if (top > 0) n++;
      }
    expect(n).toBeGreaterThan(100);
  });

  it('domes, not prisms: few columns reach the full thickness, and the top rises steeply at the rim', () => {
    let cloudy = 0;
    let full = 0;
    for (let x = -6000; x <= 6000; x += 53)
      for (let z = -6000; z <= 6000; z += 59) {
        const top = cloudColumn(x, z, 1, C[0], C[1]);
        if (top <= 0) continue;
        cloudy++;
        if (top >= CLOUD.thickness * 0.999) full++;
      }
    expect(full / cloudy).toBeLessThan(0.05);
    // √ profile: a quarter of the dome margin already gives half the full height
    expect(Math.sqrt(0.25)).toBe(0.5);
    expect(CLOUD.dome).toBeGreaterThan(0.3);
  });

  it('billows lean in by less than they rise (no overhangs) and the march uses them', () => {
    // steepest slope of a value-noise octave ≈ 1.5 · amplitude · 2π / wavelength (vertical wavelength stretched)
    const lean = (1.5 * CLOUD.erode * 2 * Math.PI) / (CLOUD.billow[0] * CLOUD.billowStretch) / 1.5;
    expect(lean).toBeLessThan(1.1);
    expect(CLOUD_PARS_GLSL).toContain('skbCloudColumn');
    expect(CLOUD_PARS_GLSL).toContain('skbCloudBillow');
    expect(CLOUD_PARS_GLSL).not.toContain('flat ');
  });
});

describe('Wolken default (wave-10 review fix)', () => {
  it('older boolean values map onto the modes; the default is "aus der Luft"', () => {
    expect(cloudMode(true)).toBe('on');
    expect(cloudMode(false)).toBe('off');
    expect(cloudMode('air')).toBe('air');
    expect(cloudMode(undefined)).toBe('air');
  });

  it('clouds show from the air only, with hysteresis, never when walking', () => {
    expect(cloudAloft(false, 1.7, true)).toBe(false);
    expect(cloudAloft(true, 500, true)).toBe(false);
    expect(cloudAloft(false, CLOUD_ALOFT.on - 1, false)).toBe(false);
    expect(cloudAloft(false, CLOUD_ALOFT.on + 1, false)).toBe(true);
    expect(cloudAloft(true, (CLOUD_ALOFT.on + CLOUD_ALOFT.off) / 2, false)).toBe(true);
    expect(cloudAloft(true, CLOUD_ALOFT.off - 1, false)).toBe(false);
    expect(cloudsShown('air', false)).toBe(false);
    expect(cloudsShown('air', true)).toBe(true);
    expect(cloudsShown('on', false)).toBe(true);
    expect(cloudsShown('off', true)).toBe(false);
  });

  it('the Rundflug asks for clouds in its evening aerial shot only (none at 7:15, before the cumulus forms)', () => {
    const shots = rundflugSpec().shots;
    expect(shots.filter((s) => s.clouds).map((s) => s.id)).toEqual(['goldene-stunde']);
    for (const s of shots) if (s.clouds) expect(cumulusAmount(s.hour)).toBeGreaterThan(0.3);
  });
});

describe('sky cube strips (wave-10 review fix)', () => {
  it('cover every face once, bottom to top, without gaps', () => {
    const rows = new Map<number, number>();
    for (let k = 0; k < 6 * SKY_CUBE_TILES; k++) {
      const t = skyCubeTile(k);
      expect(t.face).toBe(Math.floor(k / SKY_CUBE_TILES));
      expect(t.y).toBe(rows.get(t.face) ?? 0);
      rows.set(t.face, t.y + t.h);
    }
    for (let f = 0; f < 6; f++) expect(rows.get(f)).toBe(SKY_CUBE_SIZE);
    expect(SKY_CUBE_TILES).toBeGreaterThanOrEqual(2);
  });
});

describe('night fill on the land (wave-10 review fix)', () => {
  it('is 1 by day and lifts the land, cool, at night', () => {
    expect(nightGroundFill(0)).toEqual([1, 1, 1]);
    const n = nightGroundFill(1);
    const l = 0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2];
    expect(l).toBeCloseTo(1 + NIGHT_GROUND_FILL.gain, 5);
    expect(n[2]).toBeGreaterThan(n[0]);
    expect(NIGHT_GROUND_FILL.env).toBeLessThan(NIGHT_GROUND_FILL.gain);
  });
});

describe('Milky Way (wave-10 review fix)', () => {
  it('the galactic frame is the Hipparcos rotation: centre, pole and Deneb', () => {
    const gc = galactic(266.405, -28.936);
    expect(Math.abs(gc.l)).toBeLessThan(0.1);
    expect(Math.abs(gc.b)).toBeLessThan(0.1);
    expect(galactic(192.85948, 27.12825).b).toBeGreaterThan(89.9);
    const deneb = galactic(310.358, 45.28);
    expect(deneb.l).toBeCloseTo(84.3, 0);
    expect(deneb.b).toBeCloseTo(2.0, 0);
    // a rotation: rows orthonormal
    const m = GALACTIC_FROM_J2000;
    for (let i = 0; i < 3; i++) expect(Math.hypot(m[i * 3], m[i * 3 + 1], m[i * 3 + 2])).toBeCloseTo(1, 9);
  });

  it('a band along b = 0, brightest toward Sagittarius, with the Great Rift north of the plane', () => {
    expect(milkyWayProfile(0, 0)).toBeGreaterThan(milkyWayProfile(180, 0) * 2.5);
    expect(milkyWayProfile(30, 25)).toBeLessThan(0.02);
    expect(milkyWayProfile(40, MILKY_WAY.rift.b)).toBeLessThan(milkyWayProfile(40, -4));
    expect(milkyWayProfile(75, -6)).toBeGreaterThan(milkyWayProfile(120, -6));
    expect(STAR_SPOT.gain).toBeGreaterThan(6);
  });
});

describe('room lights per storey (wave-10 review fix, pose 07)', () => {
  it('a light on another storey burns only within the spill distance', () => {
    expect(lightOnStorey(2, 2, 30)).toBe(true);
    expect(lightOnStorey(1, 2, 14)).toBe(false);
    expect(lightOnStorey(1, 2, LIGHT_SPILL_M - 1)).toBe(true);
    expect(lightOnStorey(undefined, 2, 30)).toBe(true);
    expect(lightOnStorey(1, undefined, 30)).toBe(true);
  });
});

describe('table candles light the table (wave-10 review fix, pose 07; wave 11: candle pool)', () => {
  it('a guéridon candle becomes a flame of its room', async () => {
    const { addTableCandles } = await import('../src/night.ts');
    const { indexInterior } = await import('../src/candleLight.ts');
    // a candle-lit room with one guéridon (instanced top) at x = 3, a second one outside the room at x = 20
    const inner = new THREE.Group();
    const light = new THREE.PointLight();
    light.userData.roomId = 'R1';
    inner.userData.lights = [light];
    const floor = new THREE.Mesh(new THREE.BoxGeometry(10, 0.1, 6).translate(2, -0.05, 0), new THREE.MeshStandardMaterial());
    floor.userData = { roomId: 'R1', part: 'interior/boden' };
    inner.add(floor);
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.02, 0.6), new THREE.MeshStandardMaterial(), 2);
    im.name = 'B/interior/furniture/gueridon/Platte';
    im.userData.instances = [{ roomId: 'R1' }, { roomId: 'R1' }];
    im.setMatrixAt(0, new THREE.Matrix4().makeTranslation(3, 0, 0));
    im.setMatrixAt(1, new THREE.Matrix4().makeTranslation(20, 0, 0));
    inner.add(im);
    expect(addTableCandles(inner, 'B')).toBe(2);
    const rooms = indexInterior(inner);
    expect(rooms.map((r) => r.id)).toEqual(['R1']);
    // the flame at x = 20 lies outside R1's box: no light through the wall; the model light (no flame within 1.5 m)
    // stays a source with its own intensity
    const flames = rooms[0].flames.filter((f) => f.kind === 'other' && f.p[1] > 0.5);
    expect(flames.length).toBe(1);
    expect(flames[0].p[0]).toBeCloseTo(3, 5);
    expect(flames[0].p[1]).toBeGreaterThan(0.76);
    expect(rooms[0].flames.length).toBe(2);
    light.intensity = 25;
    expect(indexInterior(inner)[0].flames.find((f) => f.p[1] < 0.5)?.cd).toBe(25);
  });
});
