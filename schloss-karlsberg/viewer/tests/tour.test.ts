import { describe, expect, it } from 'vitest';
import {
  type V3,
  TourPlayer,
  arcTable,
  atArcFraction,
  captionAlpha,
  captionFor,
  catmullRom,
  clampClearance,
  cutFade,
  easeRamp,
  resolveTour,
  rundflugSpec,
  shortName,
  shotAt,
  tourAt,
} from '../src/tour.ts';

const flat = () => 340;

describe('Rundflug (KB-I46)', () => {
  it('easeRamp: 0 → 0, 1 → 1, monotone, symmetric, C1 at the ramp joints', () => {
    for (const r of [0.1, 0.25, 0.5]) {
      expect(easeRamp(0, r)).toBe(0);
      expect(easeRamp(1, r)).toBeCloseTo(1, 12);
      let prev = -1;
      for (let i = 0; i <= 200; i++) {
        const t = i / 200;
        const v = easeRamp(t, r);
        expect(v).toBeGreaterThanOrEqual(prev);
        expect(v + easeRamp(1 - t, r)).toBeCloseTo(1, 9);
        prev = v;
      }
      // derivative continuous at t = r: left and right difference quotients agree
      const h = 1e-6;
      const dl = (easeRamp(r, r) - easeRamp(r - h, r)) / h;
      const dr = (easeRamp(r + h, r) - easeRamp(r, r)) / h;
      expect(dl).toBeCloseTo(dr, 3);
      // starts and ends at rest
      expect((easeRamp(h, r) - easeRamp(0, r)) / h).toBeLessThan(1e-3);
    }
  });

  it('catmullRom passes through every control point and stays near the polygon (no overshoot)', () => {
    const pts: V3[] = [
      [0, 0, 0],
      [10, 2, 0],
      [11, 2, 30], // uneven spacing: centripetal keeps it tight
      [40, 0, 31],
    ];
    for (let i = 0; i < pts.length; i++) {
      const p = catmullRom(pts, i / (pts.length - 1));
      for (let k = 0; k < 3; k++) expect(p[k]).toBeCloseTo(pts[i][k], 9);
    }
    for (let i = 0; i <= 100; i++) {
      const p = catmullRom(pts, i / 100);
      expect(p[0]).toBeGreaterThan(-3);
      expect(p[0]).toBeLessThan(43);
      expect(p[2]).toBeGreaterThan(-3);
      expect(p[2]).toBeLessThan(34);
      expect(p[1]).toBeLessThan(4);
    }
  });

  it('arc-length parameterisation gives constant speed', () => {
    const tab = arcTable([
      [0, 0, 0],
      [1, 0, 0],
      [50, 0, 10],
      [60, 0, 60],
    ]);
    const steps: number[] = [];
    let prev = atArcFraction(tab, 0);
    for (let i = 1; i <= 50; i++) {
      const p = atArcFraction(tab, i / 50);
      steps.push(Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]));
      prev = p;
    }
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
    for (const s of steps) expect(Math.abs(s - mean) / mean).toBeLessThan(0.02);
    expect(mean * 50).toBeCloseTo(tab.length, 0);
  });

  it('the Rundflug has the six shots of the backlog, German captions and plausible hours', () => {
    const spec = rundflugSpec();
    expect(spec.shots.map((s) => s.id)).toEqual(['anflug', 'ehrenhof', 'garten', 'galerie', 'orangerie', 'goldene-stunde']);
    for (const s of spec.shots) {
      expect(s.title_de.length).toBeGreaterThan(5);
      expect(s.cam.length).toBeGreaterThanOrEqual(2);
      expect(s.look.length).toBeGreaterThanOrEqual(2);
      expect(s.hour).toBeGreaterThanOrEqual(4.5);
      expect(s.hour).toBeLessThanOrEqual(20); // daylight shots (sun.ts: sunset 20:02)
      expect(s.duration).toBeGreaterThanOrEqual(8);
    }
    expect(spec.shots.find((s) => s.id === 'goldene-stunde')!.hour).toBeGreaterThanOrEqual(18.5);
    expect(spec.shots.find((s) => s.id === 'ehrenhof')!.hour).toBe(17.5); // hero hour of the W court front (KB-I08)
    const total = spec.shots.reduce((a, s) => a + s.duration, 0);
    expect(total).toBeGreaterThan(50);
    expect(total).toBeLessThan(100);
  });

  it('frames are deterministic, continuous within a shot and black at every cut', () => {
    const tour = resolveTour(rundflugSpec(), flat);
    const a = tourAt(tour, 17.3, flat);
    const b = tourAt(tour, 17.3, flat);
    expect(a).toEqual(b);
    // continuity: at 60 fps the camera never jumps more than speed allows inside a shot
    for (const r of tour.shots) {
      let prev = tourAt(tour, r.start, flat).pos;
      for (let t = r.start + 1 / 60; t < r.start + r.spec.duration; t += 1 / 60) {
        const p = tourAt(tour, t, flat).pos;
        expect(Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2])).toBeLessThan(3); // < 180 m/s
        prev = p;
      }
      // fully black at both ends of every shot (cuts and hour changes are hidden)
      expect(tourAt(tour, r.start, flat).fade).toBeCloseTo(1, 9);
      expect(tourAt(tour, r.start + r.spec.duration - 1e-9, flat).fade).toBeGreaterThan(0.99);
      expect(tourAt(tour, r.start + r.spec.duration / 2, flat).fade).toBe(0);
    }
  });

  it('shotAt maps u ∈ [0, 1] onto a shot; clearance keeps the camera above the terrain', () => {
    const tour = resolveTour(rundflugSpec(), flat);
    const f = shotAt(tour, 'galerie', 0.5, flat)!;
    expect(f.shot.id).toBe('galerie');
    expect(f.u).toBeCloseTo(0.5, 6);
    expect(shotAt(tour, "galerie", 1, flat)!.shot.id).toBe("galerie"); // u = 1 stays in the shot
    expect(shotAt(tour, 'nope', 0.5)).toBeNull();
    expect(clampClearance([0, 300, 0], flat, 1.6)).toEqual([0, 341.6, 0]);
    expect(clampClearance([0, 400, 0], flat, 1.6)).toEqual([0, 400, 0]);
    expect(clampClearance([0, 1, 0], () => NaN)).toEqual([0, 1, 0]);
    // every frame of the whole tour keeps ≥ 1.6 m over this terrain
    for (let t = 0; t <= tour.duration; t += 0.25) expect(tourAt(tour, t, flat).pos[1]).toBeGreaterThanOrEqual(341.6 - 1e-9);
  });

  it('anchors move the shots with their building', () => {
    const base = resolveTour(rundflugSpec(), flat);
    const moved = resolveTour(rundflugSpec({ 'KB-B10': { x: 1251.9, y: 335.3, z: -967.1 } }), flat);
    const a = shotAt(base, 'orangerie', 0.5, flat)!;
    const b = shotAt(moved, 'orangerie', 0.5, flat)!;
    expect(b.pos[0] - a.pos[0]).toBeCloseTo(10, 6);
    expect(b.look[0] - a.look[0]).toBeCloseTo(10, 6);
    expect(shotAt(moved, 'ehrenhof', 0.5, flat)!.pos).toEqual(shotAt(base, 'ehrenhof', 0.5, flat)!.pos);
  });

  it('cutFade and captionAlpha', () => {
    expect(cutFade(0, 10, 0.6, false, false)).toBe(1);
    expect(cutFade(0.6, 10, 0.6, false, false)).toBe(0);
    expect(cutFade(10, 10, 0.6, false, false)).toBe(1);
    expect(cutFade(0.6, 10, 0.6, true, false)).toBeGreaterThan(0); // the first shot fades in longer
    expect(captionAlpha(0.5, 10)).toBe(0);
    expect(captionAlpha(5, 10)).toBe(1);
    expect(captionAlpha(9.5, 10)).toBe(0);
  });

  it('captions name the catalogue confidence and say "Hypothese"', () => {
    const spec = rundflugSpec();
    const info = (id: string) => ({ 'KB-B01': { name: 'Corps de logis', confidence: 'med' }, 'KB-B02': { name: 'Südflügel', confidence: 'high' } })[id];
    const c = captionFor(spec.shots[1], info);
    expect(c.title).toBe('Ehrenhof mit Corps de logis und Flügeln');
    expect(c.note).toContain('Corps de logis: mittel');
    expect(c.note).toContain('Südflügel: hoch');
    expect(c.note).toContain('Hypothese');
    expect(captionFor(spec.shots[0], () => undefined).note).toContain('Rekonstruktion = Hypothese');
    expect(shortName('Corps de logis (Hauptpalais; Kern = Louisenhof-Herrenhaus 1760/61)')).toBe('Corps de logis');
    expect(shortName('Südflügel – Flügel der Herzogin')).toBe('Südflügel');
    expect(shortName('Herzogsgarten: offener Rasen (Petri, ab 1788)')).toBe('Herzogsgarten');
  });

  it('TourPlayer plays every shot once, reports cuts and ends', () => {
    const tour = resolveTour(rundflugSpec(), flat);
    const p = new TourPlayer(tour);
    expect(p.update(1 / 60)).toBeNull();
    p.start();
    const shots: number[] = [];
    let n = 0;
    for (;;) {
      const r = p.update(1 / 30, flat);
      if (!r) break;
      if (r.newShot) shots.push(r.frame.index);
      n++;
      expect(n).toBeLessThan(10000);
    }
    expect(shots).toEqual([0, 1, 2, 3, 4, 5]);
    expect(p.playing).toBe(false);
    // a long hitch slows the tour instead of skipping a shot
    p.start();
    p.update(5);
    expect(p.t).toBeCloseTo(0.1, 9);
  });
});
