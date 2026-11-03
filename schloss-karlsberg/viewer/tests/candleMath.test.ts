import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ATTENUATION_FROM, CANDLE_POOL, CANDLE_SHADOW, CLUSTER_MIN_R, FAR_SHARE, POOL_FLOOR_LUX, ROOM_REFLECTANCE, bounceLux, clusterFlames, diffuseBounceLux, lightCutoff, patchAttenuation, pickClusters, roomArea, roomCandleLux, shadowClusterIndex, shadowKey, shadowRadius, sphereDecay, sphereIlluminance, type Cluster, type Flame } from '../src/candleMath.ts';
import { CANDLE_AMBIENT_LUX } from '../src/light.ts';
import { footerParts } from '../src/photoMath.ts';
import { STAR_ATTRIBUTION, STAR_COUNT, STARS } from '../src/starCatalogue.ts';

const f = (x: number, y: number, z: number, cd = 1): Flame => ({ p: [x, y, z], cd });

describe('candle clusters (wave 11, candleMath)', () => {
  it('joins a candelabrum and a chandelier crown, keeps separate tables apart', () => {
    const crown = Array.from({ length: 12 }, (_, i) => f(Math.cos((i * Math.PI) / 6) * 0.45, 3.5, Math.sin((i * Math.PI) / 6) * 0.45));
    const table = [f(5, 1.1, 0), f(5.1, 1.15, 0), f(5.2, 1.1, 0)];
    const other = [f(7.4, 1.1, 0)];
    const c = clusterFlames([...crown, ...table, ...other]);
    expect(c.map((x) => x.n)).toEqual([12, 3, 1]);
    expect(c[0].cd).toBe(12);
    // the crown's centre and its sphere radius ≈ its own radius
    expect(c[0].p[0]).toBeCloseTo(0, 6);
    expect(c[0].p[1]).toBeCloseTo(3.5, 6);
    expect(c[0].r).toBeCloseTo(0.45, 6);
    expect(c[2].r).toBe(CLUSTER_MIN_R);
  });
  it('is independent of the flame order', () => {
    const fl = [f(0, 0, 0), f(0.5, 0, 0), f(3, 0, 0), f(3.2, 0.1, 0), f(10, 0, 0, 2)];
    const a = clusterFlames(fl);
    const b = clusterFlames([...fl].reverse());
    expect(b).toEqual(a);
    expect(clusterFlames([])).toEqual([]);
  });
  it('lights the clusters nearest the eye, the rest go to the ambient', () => {
    const cl = clusterFlames([f(0, 1, 0), f(2, 1, 0), f(4, 1, 0), f(6, 1, 0), f(8, 1, 0), f(30, 1, 0, 3)]);
    const { lights, farLux } = pickClusters(cl, [0, 1.6, 0]);
    expect(lights.length).toBe(CANDLE_POOL);
    expect(lights.map((c) => c.p[0])).toEqual([0, 2, 4, 6]);
    const rest = [8, 30].map((x, i) => sphereIlluminance(i ? 3 : 1, Math.hypot(x, 0.6), CLUSTER_MIN_R));
    expect(farLux).toBeCloseTo(FAR_SHARE * (rest[0] + rest[1]), 10);
    expect(pickClusters(cl.slice(0, 2), [0, 1.6, 0]).farLux).toBe(0);
  });
  it('room ambient: the even (second and later) bounces of the candle flux, never below the floor', () => {
    const a = roomArea(15, 10, 6);
    expect(a).toBe(600);
    // all bounces: seven candles ≈ 0.1 lx, 55 flames ≈ 1 lx (integrating sphere)
    expect(bounceLux(7, a)).toBeGreaterThan(0.08);
    expect(bounceLux(7, a)).toBeLessThan(0.2);
    expect(bounceLux(55, a)).toBeGreaterThan(0.8);
    // wave-11 review fix: the first bounce stays near the flames, only ρ of the reflected light fills the room evenly
    expect(diffuseBounceLux(55, a)).toBeCloseTo(ROOM_REFLECTANCE * bounceLux(55, a), 12);
    expect(diffuseBounceLux(55, a)).toBeGreaterThan(0.35);
    expect(diffuseBounceLux(55, a)).toBeLessThan(0.5);
    expect(roomCandleLux(0, a, 0, CANDLE_AMBIENT_LUX)).toBe(CANDLE_AMBIENT_LUX);
    expect(roomCandleLux(55, a, 0.1, CANDLE_AMBIENT_LUX)).toBeCloseTo(diffuseBounceLux(55, a) + 0.1, 10);
    expect(roomCandleLux(1, a, 0, POOL_FLOOR_LUX)).toBe(POOL_FLOOR_LUX);
    expect(POOL_FLOOR_LUX).toBeLessThan(CANDLE_AMBIENT_LUX);
    expect(bounceLux(5, 0)).toBe(0);
    // pose 07 (wave 11): 11 lit candles in the Festsaal (≈ 330 m²) gave 0.34 lx; now ≈ 0.15 lx, so a 1 cd flame's pool
    // reaches ≈ 2.5 m before the ambient takes over
    const e = diffuseBounceLux(11, 330);
    expect(e).toBeGreaterThan(0.12);
    expect(e).toBeLessThan(0.18);
    expect(Math.sqrt(1 / e)).toBeGreaterThan(2.3);
  });
  it('the shadow goes to the brightest cluster in view, a single flame casts with one tap', () => {
    const cl = (x: number, z: number, cd: number, n = 1, r = CLUSTER_MIN_R): Cluster => ({ p: [x, 1.8, z], cd, n, r });
    // pose 07: two mantel candelabra beside and behind the eye, the guéridon candle 3 m ahead (view toward −z)
    const lights = [cl(-0.8, 0.6, 5, 5, 0.39), cl(1, 0.3, 5, 5, 0.39), cl(-0.5, -3, 1)];
    const eye: [number, number, number] = [0, 1.65, 0];
    expect(shadowClusterIndex(lights, eye, [0, 0, -1])).toBe(2);
    // looking back at the chimneypiece: the candelabrum within the view cone (the other stands 73° aside)
    expect(shadowClusterIndex(lights, eye, [0, 0, 1])).toBe(0);
    // no direction: the brightest (pool order)
    expect(shadowClusterIndex(lights, eye, null)).toBe(0);
    // nothing in view: the brightest
    expect(shadowClusterIndex(lights, eye, [1, 0, 0])).toBe(1);
    expect(shadowClusterIndex(lights, eye, [-1, 0, 0])).toBe(0);
    expect(shadowClusterIndex([], eye, [0, 0, -1])).toBe(-1);
    expect(shadowRadius(lights[2])).toBe(0);
    expect(shadowRadius(lights[0])).toBe(CANDLE_SHADOW.radius);
    expect(shadowKey([1.2344, 2, -3.0004])).toBe('1234,2000,-3000');
    expect(shadowKey(null)).toBe('');
  });
  it('sphere radius rides in the decay; cut-off where the light fades', () => {
    expect(sphereDecay(0)).toBeCloseTo(2 + CLUSTER_MIN_R ** 2, 12);
    expect(sphereDecay(0.5)).toBeCloseTo(2.25, 12);
    expect(lightCutoff(1)).toBe(10);
    expect(lightCutoff(0.01)).toBe(6);
    expect(lightCutoff(1e4)).toBe(40);
  });
  it('patches three r187 getDistanceAttenuation; decay 2 keeps the old falloff', () => {
    const chunk = (THREE.ShaderChunk as unknown as Record<string, string>).lights_pars_begin;
    expect(chunk.includes(ATTENUATION_FROM) || chunk.includes('candleMath.sphereDecay')).toBe(true);
    const p = patchAttenuation(chunk.includes(ATTENUATION_FROM) ? chunk : `x ${ATTENUATION_FROM} y`);
    expect(p).toContain('decayExponent > 2.0 ? 1.0 / ( lightDistance * lightDistance + decayExponent - 2.0 ) : 1.0 / max( pow( lightDistance, decayExponent ), 0.01 )');
    expect(patchAttenuation(p)).toBe(p);
    expect(() => patchAttenuation('nothing')).toThrow();
  });
});

describe('star table licence (KB-I93)', () => {
  it('comes from HYG 4.4 (CC BY-SA 4.0) and carries its attribution in the footer', () => {
    expect(STAR_COUNT).toBeGreaterThan(1500);
    expect(STARS.length).toBe(STAR_COUNT * 4);
    expect(STAR_ATTRIBUTION).toMatch(/HYG.*CC BY-SA 4\.0/);
    expect(footerParts('Gelände: X')).toContain(STAR_ATTRIBUTION);
    // Sirius first (V −1.44), carried back to 1789 by its proper motion (−546, −1223 mas/yr): north of its J2000 −16.716°
    expect(STARS[2]).toBeCloseTo(-1.44, 2);
    expect(STARS[1]).toBeGreaterThan(-16.67);
    expect(STARS[1]).toBeLessThan(-16.62);
  });
});
