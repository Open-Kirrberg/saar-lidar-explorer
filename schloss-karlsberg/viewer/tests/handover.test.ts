import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { dirLocal } from '@model/frame.ts';
import {
  EXPLORER_DEFAULT_URL,
  explorerDefaultUrl,
  backTarget,
  headingToYaw,
  liftAboveGround,
  parseHandover,
  pickWalkStart,
  pitchToRad,
  poseFields,
  poseFromCamera,
  poseToLocal,
  replaceHashPose,
  validateBackUrl,
  walkFallbackYaw,
  yawTowards,
  yawToHeading,
} from '../src/handover.ts';

const back = 'http://localhost:5240/?aoi=karlsberg#382200.5,5466100.2,420.3,80,-25,hs,lrm,0.6,transparent,2,135,30,8,relikte';
const q = (o: Record<string, string>) => `?${new URLSearchParams(o).toString()}`;

describe('parseHandover', () => {
  it('reads a full explorer handover', () => {
    const h = parseHandover(q({ src: 'explorer', E: '382226.4', N: '5466120.1', h: '371.2', heading: '80.5', pitch: '-12.3', mode: 'gehen', back }));
    expect(h).not.toBeNull();
    expect(h!.pose).toEqual({ E: 382226.4, N: 5466120.1, h: 371.2, heading: 80.5, pitch: -12.3 });
    expect(h!.mode).toBe('gehen');
    expect(h!.src).toBe('explorer');
    expect(h!.back).toBe(back);
  });

  it('defaults to fliegen, normalises heading and clamps pitch', () => {
    const h = parseHandover(q({ E: '1', N: '2', h: '3', heading: '-90', pitch: '-120', mode: 'xyz' }))!;
    expect(h.mode).toBe('fliegen');
    expect(h.pose.heading).toBe(270);
    expect(h.pose.pitch).toBe(-89);
    expect(h.back).toBeNull();
  });

  it('rejects missing or non-finite fields (no params = default start)', () => {
    expect(parseHandover('')).toBeNull();
    expect(parseHandover(q({ E: '1', N: '2', h: '3', heading: '4' }))).toBeNull();
    expect(parseHandover(q({ E: '1', N: '', h: '3', heading: '4', pitch: '5' }))).toBeNull();
    expect(parseHandover(q({ E: '1', N: 'abc', h: '3', heading: '4', pitch: '5' }))).toBeNull();
    expect(parseHandover(q({ E: 'Infinity', N: '2', h: '3', heading: '4', pitch: '5' }))).toBeNull();
  });
});

describe('validateBackUrl (no open redirect)', () => {
  it('accepts local http(s) hosts', () => {
    for (const u of ['http://localhost:5240/', 'https://127.0.0.1:8080/x#1,2', 'http://[::1]:5240/', 'http://sle.localhost/', 'http://karlsberg.test:5240/'])
      expect(validateBackUrl(u)).not.toBeNull();
  });
  it('rejects anything else', () => {
    for (const u of [
      'https://example.com/',
      'http://localhost.example.com/',
      'javascript:alert(1)',
      'data:text/html,hi',
      'file:///etc/passwd',
      '//localhost:5240/',
      '/relative',
      'http://user:pw@localhost/',
      'http://test/',
      'not a url',
      '',
      null,
    ])
      expect(validateBackUrl(u)).toBeNull();
  });
});

describe('public build (same origin, VITE_EXPLORER_URL)', () => {
  const ORIGIN = 'https://open-kirrberg.github.io';
  it('accepts a back URL on the page origin only', () => {
    expect(validateBackUrl(`${ORIGIN}/saar-lidar-explorer/?aoi=overall#1,2,3,4,5`, ORIGIN)).toBe(`${ORIGIN}/saar-lidar-explorer/?aoi=overall#1,2,3,4,5`);
    expect(validateBackUrl('https://evil.example/', ORIGIN)).toBeNull();
    expect(validateBackUrl(`https://u:p@open-kirrberg.github.io/`, ORIGIN)).toBeNull();
    expect(validateBackUrl(`${ORIGIN}/x`, undefined)).toBeNull();
  });
  it('explorerDefaultUrl resolves relative values against the page and falls back to localhost', () => {
    expect(explorerDefaultUrl('../', `${ORIGIN}/saar-lidar-explorer/castle/?src=explorer`)).toBe(`${ORIGIN}/saar-lidar-explorer/`);
    expect(explorerDefaultUrl(`${ORIGIN}/saar-lidar-explorer/`, undefined)).toBe(`${ORIGIN}/saar-lidar-explorer/`);
    expect(explorerDefaultUrl('javascript:alert(1)', undefined)).toBe('http://localhost:5240/');
    expect(explorerDefaultUrl(undefined, undefined)).toBe('http://localhost:5240/');
  });
});

describe('hash pose replacement', () => {
  const pose = { E: 382226.44, N: 5466120.06, h: 371.249, heading: 359.97, pitch: -12.34 };
  it('rounds to 0.1 m / 0.1° and wraps heading', () => {
    expect(poseFields(pose)).toEqual(['382226.4', '5466120.1', '371.2', '0', '-12.3']);
    expect(poseFields({ ...pose, heading: -10, pitch: 95 })).toEqual(['382226.4', '5466120.1', '371.2', '350', '89']);
  });
  it('keeps the trailing explorer fields', () => {
    expect(replaceHashPose('#1,2,3,4,5,hs,lrm,0.6,transparent,2,135,30,8,relikte', pose)).toBe('#382226.4,5466120.1,371.2,0,-12.3,hs,lrm,0.6,transparent,2,135,30,8,relikte');
    expect(replaceHashPose('1,2,3,4,5', pose)).toBe('#382226.4,5466120.1,371.2,0,-12.3');
  });
  it('writes just the five fields for an empty or short hash', () => {
    expect(replaceHashPose('', pose)).toBe('#382226.4,5466120.1,371.2,0,-12.3');
    expect(replaceHashPose('#foo', pose)).toBe('#382226.4,5466120.1,371.2,0,-12.3');
  });
  it('builds the return URL from back or the default', () => {
    expect(backTarget(back, pose)).toBe('http://localhost:5240/?aoi=karlsberg#382226.4,5466120.1,371.2,0,-12.3,hs,lrm,0.6,transparent,2,135,30,8,relikte');
    expect(backTarget(null, pose)).toBe(`${EXPLORER_DEFAULT_URL}#382226.4,5466120.1,371.2,0,-12.3`);
    expect(backTarget('https://evil.example/#1,2,3,4,5', pose)).toBe(`${EXPLORER_DEFAULT_URL}#382226.4,5466120.1,371.2,0,-12.3`);
  });
});

describe('heading / pitch conventions match the viewer camera', () => {
  /** Camera forward the way Controls.applyRotation sets it. */
  const forward = (yaw: number, pitch: number) => {
    const cam = new THREE.PerspectiveCamera();
    cam.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    return cam.getWorldDirection(new THREE.Vector3());
  };
  it('grid heading cw from north maps to local (sin, 0, −cos)', () => {
    for (const hd of [0, 45, 80.5, 90, 180, 270, 333]) {
      const f = forward(headingToYaw(hd), 0);
      const d = dirLocal(hd);
      expect(f.x).toBeCloseTo(d.x, 9);
      expect(f.z).toBeCloseTo(d.z, 9);
    }
    // explicit: north = −z, east = +x, south = +z, west = −x
    expect(forward(headingToYaw(0), 0).z).toBeCloseTo(-1, 9);
    expect(forward(headingToYaw(90), 0).x).toBeCloseTo(1, 9);
    expect(forward(headingToYaw(180), 0).z).toBeCloseTo(1, 9);
    expect(forward(headingToYaw(270), 0).x).toBeCloseTo(-1, 9);
  });
  it('negative pitch looks down', () => {
    const f = forward(headingToYaw(30), pitchToRad(-30));
    expect(f.y).toBeCloseTo(-0.5, 9);
  });
  it('round-trips through the camera state', () => {
    const p = { E: 382226.4, N: 5466120.1, h: 371.2, heading: 250.3, pitch: -17.5 };
    const l = poseToLocal(p);
    expect(l.x).toBeCloseTo(1226.4, 6);
    expect(l.z).toBeCloseTo(-1120.1, 6);
    const back2 = poseFromCamera(l, headingToYaw(p.heading), pitchToRad(p.pitch));
    expect(back2.E).toBeCloseTo(p.E, 6);
    expect(back2.N).toBeCloseTo(p.N, 6);
    expect(back2.heading).toBeCloseTo(p.heading, 9);
    expect(back2.pitch).toBeCloseTo(p.pitch, 9);
    // yaw from Controls.lookAt (atan2(−dx, −dz)) for a target due east = heading 90
    expect(yawToHeading(Math.atan2(-1, -0))).toBeCloseTo(90, 9);
  });
});

describe('pickWalkStart', () => {
  const pois = [
    { id: 'B01', kind: 'building', position: { x: 10, y: 360, z: 0 } },
    { id: 'B01/portal-court-3', kind: 'entrance', position: { x: 150, y: 346, z: 0 }, lookAt: { x: 160, y: 347, z: 0 } },
    { id: 'B02/portal-court-1', kind: 'entrance', position: { x: 80, y: 346, z: 0 } },
    { id: 'view-west', kind: 'view', position: { x: 0, y: 450, z: 0 } },
    { id: 'B03/room', kind: 'room', position: { x: 1, y: 350, z: 0 } },
  ];
  it('prefers the nearest entrance within range', () => {
    expect(pickWalkStart(pois, 0, 0)?.id).toBe('B02/portal-court-1');
    expect(pickWalkStart(pois, 140, 5)?.id).toBe('B01/portal-court-3');
  });
  it('falls back to a building POI, then to nothing', () => {
    expect(pickWalkStart(pois, -150, 0)?.id).toBe('B01');
    expect(pickWalkStart(pois, -500, 0)).toBeNull();
    expect(pickWalkStart(pois, 0, 0, 5)?.id).toBeUndefined();
  });
  it('ranks reachable entrances first, then building POIs, then entrances that cannot be reached on foot', () => {
    const ranked = [
      { id: 'B02/durchfahrt-garden-11', kind: 'entrance', walkable: false, position: { x: 5, y: 346, z: 0 } },
      { id: 'B02/portal-end_a-1', kind: 'entrance', walkable: false, position: { x: 8, y: 346, z: 0 } },
      { id: 'B02', kind: 'building', position: { x: 30, y: 360, z: 0 } },
      { id: 'B02/durchfahrt-court-7', kind: 'entrance', walkable: true, position: { x: 60, y: 346, z: 0 } },
      { id: 'B05/portal-court-1', kind: 'entrance', position: { x: 120, y: 346, z: 0 } }, // no flag = reachable
    ];
    // a reachable entrance 60 m away beats a blocked one 5 m away
    expect(pickWalkStart(ranked, 0, 0)?.id).toBe('B02/durchfahrt-court-7');
    // missing flag counts as reachable
    expect(pickWalkStart(ranked.filter((p) => p.id !== 'B02/durchfahrt-court-7'), 0, 0)?.id).toBe('B05/portal-court-1');
    // only blocked entrances + a building in range: the building view point wins
    expect(pickWalkStart(ranked, 0, 0, 50)?.id).toBe('B02');
    // only blocked entrances in range: the nearest of them, as a last resort
    expect(pickWalkStart(ranked, 0, 0, 10)?.id).toBe('B02/durchfahrt-garden-11');
  });
});

describe('walk fallback heading', () => {
  const fwd = (yaw: number) => {
    const cam = new THREE.PerspectiveCamera();
    cam.rotation.set(0, yaw, 0, 'YXZ');
    return new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  };
  it('yawTowards looks horizontally at the target (three.js camera)', () => {
    for (const [tx, tz] of [[0, -10], [10, 0], [0, 10], [-10, 0], [3, -7]] as const) {
      const f = fwd(yawTowards(0, 0, tx, tz));
      const l = Math.hypot(tx, tz);
      expect(f.x).toBeCloseTo(tx / l, 9);
      expect(f.z).toBeCloseTo(tz / l, 9);
      expect(f.y).toBeCloseTo(0, 9);
    }
    // grid north (−z) = heading 0, east = heading 90
    expect(yawToHeading(yawTowards(0, 0, 0, -5))).toBeCloseTo(0, 9);
    expect(yawToHeading(yawTowards(0, 0, 5, 0))).toBeCloseTo(90, 9);
  });
  it('faces the nearest building centre, else the anchor, else null', () => {
    const centres = [{ x: 100, z: 0 }, { x: 0, z: -40 }];
    expect(walkFallbackYaw(0, 0, centres, { x: -500, z: 0 })).toBeCloseTo(yawTowards(0, 0, 0, -40), 12);
    expect(walkFallbackYaw(0, 0, [], { x: -500, z: 0 })).toBeCloseTo(yawTowards(0, 0, -500, 0), 12);
    expect(walkFallbackYaw(0, 0, [])).toBeNull();
    expect(walkFallbackYaw(0, 0, [], { x: 0.1, z: 0 })).toBeNull();
  });
});

describe('liftAboveGround', () => {
  it('lifts poses below ground + 1.5 m only', () => {
    expect(liftAboveGround(340, 345)).toBe(346.5);
    expect(liftAboveGround(346, 345)).toBe(346.5);
    expect(liftAboveGround(400, 345)).toBe(400);
    expect(liftAboveGround(300, NaN)).toBe(300);
  });
});
