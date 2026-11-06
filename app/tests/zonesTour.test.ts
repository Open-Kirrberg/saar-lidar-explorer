/**
 * Built twins: the guided tour (zone contract „Tour“) and the small products' pick proxies — the pure parts:
 * parsing, step sequencing, glide maths, proxy sizing and choice. Also: the bakery's real tour, when the package
 * is built locally.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseZoneCatalogue } from '../src/zones/catalogue';
import {
  chooseProxy,
  isSmallBox,
  pickAngle,
  PROXY_DEPTH_SLACK_M,
  PROXY_MAX_HALF_M,
  PROXY_PX_TOUCH,
  proxyHalf,
  rayBoxEnter,
} from '../src/zones/pickProxy';
import { glideAt, glideVia, headingDelta, lookAngles, makeGlide, parseTour, tourMove, tourNav } from '../src/zones/tour';
import type { GlidePose } from '../src/zones/tour';

const objects = new Set(['fassade/wandmalerei', 'theke', 'brotregal']);
const stop = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title_de: `Halt ${id}`,
  text_de: 'Hier schaust du dir etwas an.',
  target: 'theke',
  eye: [6, 245.9, -0.6],
  look: [3.9, 245, -1.8],
  ...extra,
});

describe('tour: parse', () => {
  it('keeps valid stops, drops broken ones, needs two', () => {
    const warns: string[] = [];
    const t = parseTour(
      {
        name_de: 'Kleine Führung',
        stops: [
          stop('giebel', { target: 'fassade/wandmalerei', via: [[1, 2], [Number.NaN, 0], [3, 4, 5]] }),
          stop('theke'),
          stop('theke'), // duplicate id
          stop('kaputt', { eye: [381467, 245, -5462254] }), // raw UTM
          stop('blind', { look: [6, 245.9, -0.6] }), // eye = look
          stop('Gross'), // bad id
          stop('leer', { text_de: '  ' }),
          stop('fremd', { target: 'hinterhof' }), // unknown target: kept, no highlight
          stop('html', { title_de: '<b>Fett</b>', text_de: 'a\u0000b' }),
        ],
      },
      objects,
      (w) => warns.push(w),
    )!;
    expect(t.name_de).toBe('Kleine Führung');
    expect(t.stops.map((s) => s.id)).toEqual(['giebel', 'theke', 'fremd', 'html']);
    expect(t.stops[0]!.via).toEqual([[1, 2]]);
    expect(t.stops[0]!.target).toBe('fassade/wandmalerei');
    expect(t.stops[2]!.target).toBeNull();
    expect(t.stops[3]!.title_de).toBe('<b>Fett</b>'); // text, rendered with textContent
    expect(t.stops[3]!.text_de).toBe('a b');
    expect(warns).toEqual(['catalogue: tour: 5 invalid stop(s) dropped']);
  });

  it('missing → null quietly; one stop → null with a warning', () => {
    const warns: string[] = [];
    expect(parseTour(undefined, objects, (w) => warns.push(w))).toBeNull();
    expect(warns).toEqual([]);
    expect(parseTour({ stops: [stop('a')] }, objects, (w) => warns.push(w))).toBeNull();
    expect(warns).toEqual(['catalogue: tour needs at least 2 valid stops, no tour']);
    expect(parseTour({ stops: [stop('a'), stop('b')] }, objects)!.name_de).toBe('Führung');
  });

  it('the catalogue carries it; old catalogues have no tour', () => {
    const base = { schema: 'sle-zone-catalogue-v1', consent: { prices: true }, objects: { theke: { name_de: 'Theke', info_de: 'Hier wird bedient.' } }, products: {}, discoverable: ['theke'] };
    expect(parseZoneCatalogue(base)!.tour).toBeNull();
    const c = parseZoneCatalogue({ ...base, tour: { name_de: 'Führung', stops: [stop('a'), stop('b', { target: 'brotregal' })] } })!;
    expect(c.tour!.stops.map((s) => [s.id, s.target])).toEqual([
      ['a', 'theke'],
      ['b', null], // brotregal is not an object of this catalogue
    ]);
  });
});

describe('tour: steps', () => {
  it('start, next, back, end; „Weiter“ on the last stop ends', () => {
    expect(tourMove(null, 'start', 6)).toBe(0);
    expect(tourMove(3, 'start', 6)).toBe(0);
    expect(tourMove(null, 'next', 6)).toBe(0);
    expect(tourMove(null, 'back', 6)).toBeNull();
    expect(tourMove(0, 'next', 6)).toBe(1);
    expect(tourMove(4, 'next', 6)).toBe(5);
    expect(tourMove(5, 'next', 6)).toBeNull();
    expect(tourMove(0, 'back', 6)).toBe(0);
    expect(tourMove(3, 'back', 6)).toBe(2);
    expect(tourMove(3, 'end', 6)).toBeNull();
    expect(tourMove(9, 'back', 6)).toBe(4); // a stale index is clamped
    expect(tourMove(null, 'start', 0)).toBeNull();
  });

  it('a whole walk through visits every stop once', () => {
    const seen: number[] = [];
    for (let i = tourMove(null, 'start', 6); i !== null; i = tourMove(i, 'next', 6)) seen.push(i);
    expect(seen).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('panel: counter, back enabled after the first stop, Fertig on the last', () => {
    expect(tourNav(0, 6)).toEqual({ counter: '1 / 6', back: false, next: 'Weiter' });
    expect(tourNav(2, 6)).toEqual({ counter: '3 / 6', back: true, next: 'Weiter' });
    expect(tourNav(5, 6)).toEqual({ counter: '6 / 6', back: true, next: 'Fertig' });
  });

  it('waypoints: forward by one uses the target’s via, back by one the leaving stop’s via reversed', () => {
    const stops = [{ via: [] }, { via: [[1, 1], [2, 2]] as [number, number][] }, { via: [[9, 9]] as [number, number][] }];
    expect(glideVia(0, 1, stops)).toEqual([[1, 1], [2, 2]]);
    expect(glideVia(1, 0, stops)).toEqual([[2, 2], [1, 1]]);
    expect(glideVia(null, 0, stops)).toEqual([]);
    expect(glideVia(null, 1, stops)).toEqual([]);
    expect(glideVia(0, 2, stops)).toEqual([]);
    expect(stops[1]!.via).toEqual([[1, 1], [2, 2]]); // not reversed in place
  });
});

describe('tour: glide', () => {
  it('look angles: grid heading clockwise from north (−z), pitch up positive', () => {
    expect(lookAngles([0, 0, 0], [0, 0, -1]).heading).toBeCloseTo(0);
    expect(lookAngles([0, 0, 0], [1, 0, 0]).heading).toBeCloseTo(90);
    expect(lookAngles([0, 0, 0], [0, 0, 1]).heading).toBeCloseTo(180);
    expect(lookAngles([0, 0, 0], [-1, 0, 0]).heading).toBeCloseTo(270);
    expect(lookAngles([0, 0, 0], [1, 1, 0]).pitch).toBeCloseTo(45);
    expect(lookAngles([0, 2, 0], [0, 0, -2]).pitch).toBeCloseTo(-45);
  });

  it('heading delta takes the short way round', () => {
    expect(headingDelta(350, 10)).toBeCloseTo(20);
    expect(headingDelta(10, 350)).toBeCloseTo(-20);
    expect(headingDelta(25.6, 295.6)).toBeCloseTo(-90);
    expect(headingDelta(0, 180)).toBeCloseTo(180);
  });

  const A: GlidePose = { x: 0, y: 10, z: 0, heading: 350, pitch: 0 };
  const B: GlidePose = { x: 10, y: 12, z: 0, heading: 30, pitch: -20 };

  it('starts and ends exactly on the poses, eased, the short way round', () => {
    const g = makeGlide(A, B);
    expect(g.length).toBeCloseTo(10);
    expect(g.duration).toBeGreaterThanOrEqual(1);
    expect(g.duration).toBeLessThanOrEqual(3);
    expect(glideAt(g, 0)).toEqual({ ...A, heading: 350 });
    const end = glideAt(g, g.duration + 1);
    expect(end.x).toBeCloseTo(10);
    expect(end.y).toBeCloseTo(12);
    expect(end.heading).toBeCloseTo(30);
    expect(end.pitch).toBeCloseTo(-20);
    const mid = glideAt(g, g.duration / 2);
    expect(mid.x).toBeCloseTo(5);
    expect(mid.heading).toBeCloseTo(10); // 350 → 10 → 30, never through 180
    expect(glideAt(g, g.duration * 0.1).x).toBeLessThan(1); // eased in
  });

  it('passes through the waypoints, heights eased along the path', () => {
    const g = makeGlide({ ...A, y: 0 }, { ...B, x: 10, z: 10, y: 4 }, [[10, 0]]);
    expect(g.length).toBeCloseTo(20);
    expect(g.points[1]).toEqual([10, 2, 0]);
    const half = glideAt(g, g.duration / 2);
    expect(half.x).toBeCloseTo(10);
    expect(half.z).toBeCloseTo(0);
    expect(half.y).toBeCloseTo(2);
    const q = glideAt(g, g.duration * 0.75);
    expect(q.x).toBeCloseTo(10);
    expect(q.z).toBeGreaterThan(0);
  });

  it('a turn on the spot still glides; longer ways take longer, capped', () => {
    const g = makeGlide(A, { ...A, heading: 170 });
    expect(g.length).toBe(0);
    expect(glideAt(g, g.duration / 2).x).toBe(0);
    expect(glideAt(g, g.duration).heading).toBeCloseTo(170);
    expect(makeGlide(A, { ...A, x: 30 }).duration).toBeGreaterThan(makeGlide(A, { ...A, x: 3 }).duration);
    expect(makeGlide(A, { ...A, x: 500 }).duration).toBe(3);
  });
});

describe('pick proxies', () => {
  it('only small boxes get one', () => {
    expect(isSmallBox([0.2, 0.13, 0.22])).toBe(true); // a loaf on the bread wall
    expect(isSmallBox([0.4, 0.12, 0.52])).toBe(false); // a basket
  });

  it('pick angle: 22 px on an 844 px phone with a 70° fov ≈ 2.1°', () => {
    const a = pickAngle(PROXY_PX_TOUCH, 844, 70);
    expect((a * 180) / Math.PI).toBeCloseTo(2.09, 1);
    expect(pickAngle(0, 844, 70)).toBe(0);
    expect(pickAngle(22, 0, 70)).toBe(0);
  });

  it('proxy size: at least the pick radius at its distance, never smaller than the box, capped', () => {
    const a = pickAngle(PROXY_PX_TOUCH, 844, 70);
    const h = proxyHalf([0.1, 0.065, 0.11], 3.7, a);
    // a 13 cm loaf 3.7 m away is ≈ 24 px tall; its proxy spans ≥ 44 px
    expect(h[1]).toBeCloseTo(3.7 * Math.tan(a), 5);
    expect(h[1]).toBeGreaterThan(0.065);
    expect(h[2]).toBeCloseTo(Math.max(0.11, 3.7 * Math.tan(a)), 5);
    expect(proxyHalf([0.1, 0.065, 0.11], 0.5, a)).toEqual([0.1, 0.065, 0.11]); // close up: the box itself
    expect(proxyHalf([0.01, 0.01, 0.01], 40, a)).toEqual([PROXY_MAX_HALF_M, PROXY_MAX_HALF_M, PROXY_MAX_HALF_M]);
  });

  it('ray / box entry', () => {
    expect(rayBoxEnter([0, 0, 0], [1, 0, 0], [2, -1, -1], [3, 1, 1])).toBeCloseTo(2);
    expect(rayBoxEnter([2.5, 0, 0], [1, 0, 0], [2, -1, -1], [3, 1, 1])).toBe(0); // inside
    expect(rayBoxEnter([0, 2, 0], [1, 0, 0], [2, -1, -1], [3, 1, 1])).toBeNull();
    expect(rayBoxEnter([0, 0, 0], [-1, 0, 0], [2, -1, -1], [3, 1, 1])).toBeNull(); // behind
  });

  // two loaves side by side on a shelf 3.7 m in front (−z), 24 cm apart; the visitor at the origin
  const loaves = [
    { c: [-0.12, 0, -3.7] as const, h: [0.1, 0.065, 0.11] as const },
    { c: [0.12, 0, -3.7] as const, h: [0.1, 0.065, 0.11] as const },
  ];
  const a = pickAngle(PROXY_PX_TOUCH, 844, 70);
  const dir = (x: number, y: number): [number, number, number] => {
    const l = Math.hypot(x, y, 3.7);
    return [x / l, y / l, -3.7 / l];
  };

  it('a tap just above a loaf (on the shelf bar) picks that loaf', () => {
    const r = chooseProxy([0, 0, 0], dir(0.15, 0.1), loaves, a, 3.6, 30);
    expect(r.index).toBe(1);
    expect(r.distance).toBeGreaterThan(3.4);
    expect(chooseProxy([0, 0, 0], dir(-0.15, -0.1), loaves, a, Infinity, 30).index).toBe(0);
  });

  it('nothing without a radius, far off, too far, or behind a wall', () => {
    expect(chooseProxy([0, 0, 0], dir(0.15, 0.1), loaves, 0, 3.6, 30).index).toBe(-1);
    expect(chooseProxy([0, 0, 0], dir(0.6, 0.5), loaves, a, Infinity, 30).index).toBe(-1);
    expect(chooseProxy([0, 0, 0], dir(0.12, 0), loaves, a, Infinity, 2).index).toBe(-1);
    // a wall 1 m in front: the proxies are more than the slack behind it
    expect(chooseProxy([0, 0, 0], dir(0.12, 0), loaves, a, 1, 30).index).toBe(-1);
    expect(chooseProxy([0, 0, 0], dir(0.12, 0), loaves, a, 3.7 - 0.11 - PROXY_DEPTH_SLACK_M + 0.05, 30).index).toBe(1);
  });

  it('between two proxies the closer centre wins', () => {
    expect(chooseProxy([0, 0, 0], dir(0.01, 0), loaves, a, Infinity, 30).index).toBe(1);
    expect(chooseProxy([0, 0, 0], dir(-0.01, 0), loaves, a, Infinity, 30).index).toBe(0);
  });
});

// The bakery's own tour (built package, git-ignored): every stop's target is a card object.
const pkg = join(import.meta.dirname, '../public/data/zones/baeckerei-heusser/built/catalogue.json');
describe.skipIf(!existsSync(pkg))('the bakery tour (local package)', () => {
  it('5–6 stops from the gable mural to the old pictures, all targets known', () => {
    const c = parseZoneCatalogue(JSON.parse(readFileSync(pkg, 'utf8')))!;
    if (!c.tour) return; // a package built before the tour
    expect(c.tour.stops.length).toBeGreaterThanOrEqual(5);
    expect(c.tour.stops.length).toBeLessThanOrEqual(6);
    expect(c.tour.stops[0]!.target).toBe('fassade/wandmalerei');
    expect(c.tour.stops.at(-1)!.target).toBe('bilderwand');
    for (const s of c.tour.stops) expect(s.target && c.objects.has(s.target)).toBeTruthy();
  });
});
