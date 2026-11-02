/**
 * State-room finish system (KB-I26/I27), pure helpers (no three.js), unit-tested in model/tests/interior.finish.test.ts.
 *
 * - silk walls: the field layout of stretched silk / damask framed by gilt Tapetenleisten above the dado, with the
 *   broad contrasting border of Mannlich's rule (T1 p. 365 / T5) [D rule; sizes N, grammar STATE_ROOM];
 * - colours: the silk hue of a room (catalogue `finish.colour`, else the material's own) and a contrasting border;
 * - canvases: the tonal layout of a varnished 18th-c. picture as a coarse colour grid (vertex colours), generated from
 *   a seed: landscape, portrait, history piece, still life. These are PLACEHOLDERS that read as paintings at room
 *   distance; they copy no artwork [N dense hang; D picture collection, research/10 §c.3];
 * - mirrors: a soft "reflected room" colour grid so pier glasses and trumeaux read as old mercury glass [I];
 * - the damask figure (a mirrored palmette in an ogee lattice), CPU twin of DAMASK_GLSL [N Lyon damask];
 * - the Greek-key (meander) frieze of the Hofbibliothek cases [D T5 "Fries a la greece"; geometry N];
 * - numbers from a room's `function` text ("20 crystal chandeliers"), so documented counts stay in the catalogue.
 */
import { STATE_ROOM } from '../layout/grammar.ts';
import { fract, mulberry32, smoothstep as smooth } from '../layout/geom.ts';
import type { Finish } from '../spec.ts';
import { DEFAULT_BOISERIE, type Hole, type Panel, type WallRect, boiseriePanels, solidRects } from './wall.ts';

export type RGB = [number, number, number];

// ---------------------------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------------------------

/**
 * Base colours of the silk materials (twin of MATERIAL_BASE in model/src/materials/index.ts, which this pure module
 * may not import; a test keeps them equal).
 */
export const SILK_BASE: Readonly<Record<string, string>> = {
  'wall.silk.crimson': '#8E2A2E',
  'wall.silk.blue': '#5B7798',
  'wall.silk.green': '#5E7F5E',
  'wall.silk.yellow': '#C9A94E',
  'wall.silk.grey': '#A7A9A4',
};

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex(c: RGB): string {
  const h = (x: number) =>
    Math.round(Math.min(1, Math.max(0, x)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`.toUpperCase();
}

export const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** Relative luminance of an sRGB hex (linear, 0…1). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Silk ground colour of a room: the catalogue `finish.colour`, else the silk material's base; null for non-silk walls. */
export function silkHue(finish: Pick<Finish, 'walls' | 'colour'> | undefined): string | null {
  if (!finish?.walls?.startsWith('wall.silk')) return null;
  return finish.colour ?? SILK_BASE[finish.walls] ?? null;
}

/**
 * Contrasting border of a damask wall when the catalogue gives none (Mannlich: three contrasting colours [D]; hues N):
 * a dark ground gets a warm ivory-straw border, a light ground (yellow, grey) a deeper tone of its own hue.
 */
export function borderColour(ground: string): string {
  if (luminance(ground) < 0.12) return '#E2D5B0';
  const [r, g, b] = hexToRgb(ground);
  return rgbToHex([r * 0.55, g * 0.55, b * 0.6]);
}

// ---------------------------------------------------------------------------------------------
// Silk walls: fields between the dado and the cornice
// ---------------------------------------------------------------------------------------------

/**
 * Silk fields of one wall: the solid rectangles of the band [v0, v1] (top of the dado rail … under the cornice)
 * left by the holes, each one stretched silk framed by a gilt Tapetenleiste at its edge. Fields narrower than
 * `minW` are dropped (a reveal edge).
 */
export function silkFields(length: number, holes: Hole[], v0: number, v1: number, minW = 0.18): WallRect[] {
  if (v1 - v0 < 0.3) return [];
  const band = holes.map((h) => ({ ...h, v0: h.v0 - v0, v1: h.v1 - v0 }));
  return solidRects(length, v1 - v0, band)
    .map((r) => ({ u0: r.u0, u1: r.u1, v0: r.v0 + v0, v1: r.v1 + v0 }))
    .filter((r) => r.u1 - r.u0 >= minW && r.v1 - r.v0 >= 0.12);
}

/** The border band of a field (inside the Leiste) as 4 rects: bottom, top, left, right. Empty when the field is too small. */
export function borderRects(f: WallRect, leiste: number = STATE_ROOM.leiste.width, width: number = STATE_ROOM.border.width): WallRect[] {
  const a = leiste;
  const b = leiste + width;
  if (f.u1 - f.u0 < 2 * b + 0.15 || f.v1 - f.v0 < 2 * b + 0.15) return [];
  return [
    { u0: f.u0 + a, u1: f.u1 - a, v0: f.v0 + a, v1: f.v0 + b },
    { u0: f.u0 + a, u1: f.u1 - a, v0: f.v1 - b, v1: f.v1 - a },
    { u0: f.u0 + a, u1: f.u0 + b, v0: f.v0 + b, v1: f.v1 - b },
    { u0: f.u1 - b, u1: f.u1 - a, v0: f.v0 + b, v1: f.v1 - b },
  ];
}

// ---------------------------------------------------------------------------------------------
// Damask figure
// ---------------------------------------------------------------------------------------------


/** Damask figure family: a lobed palmette with corner sprigs (state rooms) or a scrolling arabesque (KB-B06, T1). */
export type DamaskFigure = 'floral' | 'arabesque';

/** Damask figure of a room: the Bildergalerie's documented "arabesques" (T1 pp. 374 f. / T5 [D]), else floral [N]. */
export function damaskFigureOf(fn: string | undefined): DamaskFigure {
  return fn && /arabesque/i.test(fn) ? 'arabesque' : 'floral';
}

/** 1 inside an ellipse (centre c, radii r, rotated by a), soft edge of width aa (all in repeat-height units). */
const ellipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number, a: number, aa: number) => {
  const dx = x - cx;
  const dy = y - cy;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const d = Math.hypot((dx * c + dy * s) / rx, (-dx * s + dy * c) / ry);
  return 1 - smooth(1, 1 + aa / Math.min(rx, ry), d);
};

/**
 * Damask figure at wall point (u, v) in metres: 1 on the figure, 0 on the satin ground (repeat
 * STATE_ROOM.damask.repeat, mirrored about the repeat axis) [N Lyon damask]. Wave-5 review: the former ogee trellis of
 * continuous lines read as 19th-c. printed wallpaper; a Lyon damask of the 1780s is a field of separate, filled
 * motifs. 'floral': a lobed palmette (five-lobed fan over a pointed bud, two leaves, a stem) on the axis and a small
 * four-lobed sprig at the repeat corners (half-drop); 'arabesque': a candelabrum stem on the axis with an urn and two
 * pairs of open C-scrolls ending in leaves. `aa` is the edge width in repeat-height units. Mirrors DAMASK_GLSL.
 */
export function damaskMotif(u: number, v: number, aa = 0.02, figure: DamaskFigure = 'floral'): number {
  const [W, H] = STATE_ROOM.damask.repeat;
  const k = W / H; // x in repeat-height units, so circles stay round
  const x = Math.abs(fract(u / W) - 0.5) * k; // 0 … 0.5 k, mirrored about the repeat axis
  const y = fract(v / H);
  let f = 0;
  if (figure === 'floral') {
    // pointed bud, a fan of five lobes over it, two leaves and a stem
    f = Math.max(f, 1 - smooth(0.075, 0.075 + aa, Math.hypot(x * 1.5, (y - 0.5) * (1.1 + 2.2 * Math.abs(y - 0.5)))));
    for (const [a, r] of [[0, 0.16], [0.5, 0.15], [1.0, 0.13]] as [number, number][]) f = Math.max(f, ellipse(x, y, Math.sin(a) * r, 0.52 + Math.cos(a) * r, 0.034, 0.06, -a, aa));
    f = Math.max(f, ellipse(x, y, 0.085, 0.36, 0.075, 0.026, 0.55, aa));
    f = Math.max(f, (1 - smooth(0.009, 0.009 + aa, x)) * (1 - smooth(0.0, aa, Math.abs(y - 0.3) - 0.1)));
    // corner sprig (the half-drop motif): four small lobes round the repeat corner
    const cx = 0.5 * k - x;
    const cy = Math.min(y, 1 - y);
    const r = Math.hypot(cx, cy);
    const th = Math.atan2(cy, cx);
    f = Math.max(f, 1 - smooth(0.045 * (0.65 + 0.35 * Math.abs(Math.cos(2 * th))), 0.045 * (0.65 + 0.35 * Math.abs(Math.cos(2 * th))) + aa, r));
  } else {
    // candelabrum stem on the axis with an urn at mid height
    f = Math.max(f, 1 - smooth(0.007, 0.007 + aa, x));
    f = Math.max(f, ellipse(x, y, 0, 0.5, 0.045, 0.07, 0, aa));
    // two C-scrolls per side (lower one opening up, upper one opening down), each ending in a curl and a leaf
    for (const [cy0, dir] of [[0.27, 1], [0.73, -1]] as [number, number][]) {
      const dx = x - 0.17;
      const dy = (y - cy0) * dir;
      const ring = 1 - smooth(0.012, 0.012 + aa, Math.abs(Math.hypot(dx, dy) - 0.085));
      const open = smooth(-0.02, 0.02, -(dy + 0.03) + dx * 0.4); // leave the scroll open towards the stem's top
      f = Math.max(f, ring * (1 - open));
      f = Math.max(f, 1 - smooth(0.022, 0.022 + aa, Math.hypot(dx - 0.03, dy - 0.02)));
      f = Math.max(f, ellipse(x, y, 0.07, cy0 - dir * 0.07, 0.06, 0.02, -dir * 0.6, aa));
    }
  }
  return Math.min(1, Math.max(0, f));
}

/**
 * GLSL twin of damaskMotif (expects `vec2 dUv` in metres, returns `float damask`); `#define DAMASK_ARABESQUE` picks the
 * arabesque. Antialiased by fwidth in uniform control flow (no branch around the derivatives); far away the figure
 * fades out with the pixel footprint (no shimmer).
 */
export const DAMASK_GLSL = /* glsl */ `
float dmEll( vec2 p, vec2 c, vec2 r, float a, float aa ) {
  vec2 d = p - c;
  float cs = cos( a ), sn = sin( a );
  float e = length( vec2( ( d.x * cs + d.y * sn ) / r.x, ( -d.x * sn + d.y * cs ) / r.y ) );
  return 1.0 - smoothstep( 1.0, 1.0 + aa / min( r.x, r.y ), e );
}
float damaskMotif( vec2 dUv ) {
  vec2 rep = vec2( ${STATE_ROOM.damask.repeat[0].toFixed(3)}, ${STATE_ROOM.damask.repeat[1].toFixed(3)} );
  float k = rep.x / rep.y;
  vec2 q = dUv / rep;
  float aa = max( 0.004, 1.2 * max( fwidth( q.x ), fwidth( q.y ) ) );
  float x = abs( fract( q.x ) - 0.5 ) * k;
  float y = fract( q.y );
  vec2 p = vec2( x, y );
  float f = 0.0;
#ifdef DAMASK_ARABESQUE
  f = max( f, 1.0 - smoothstep( 0.007, 0.007 + aa, x ) );
  f = max( f, dmEll( p, vec2( 0.0, 0.5 ), vec2( 0.045, 0.07 ), 0.0, aa ) );
  for ( int i = 0; i < 2; i++ ) {
    float cy0 = i == 0 ? 0.27 : 0.73;
    float dir = i == 0 ? 1.0 : -1.0;
    float dx = x - 0.17;
    float dy = ( y - cy0 ) * dir;
    float ring = 1.0 - smoothstep( 0.012, 0.012 + aa, abs( length( vec2( dx, dy ) ) - 0.085 ) );
    float open = smoothstep( -0.02, 0.02, -( dy + 0.03 ) + dx * 0.4 );
    f = max( f, ring * ( 1.0 - open ) );
    f = max( f, 1.0 - smoothstep( 0.022, 0.022 + aa, length( vec2( dx - 0.03, dy - 0.02 ) ) ) );
    f = max( f, dmEll( p, vec2( 0.07, cy0 - dir * 0.07 ), vec2( 0.06, 0.02 ), -dir * 0.6, aa ) );
  }
#else
  f = max( f, 1.0 - smoothstep( 0.075, 0.075 + aa, length( vec2( x * 1.5, ( y - 0.5 ) * ( 1.1 + 2.2 * abs( y - 0.5 ) ) ) ) ) );
  f = max( f, dmEll( p, vec2( 0.0, 0.68 ), vec2( 0.034, 0.06 ), 0.0, aa ) );
  f = max( f, dmEll( p, vec2( sin( 0.5 ) * 0.15, 0.52 + cos( 0.5 ) * 0.15 ), vec2( 0.034, 0.06 ), -0.5, aa ) );
  f = max( f, dmEll( p, vec2( sin( 1.0 ) * 0.13, 0.52 + cos( 1.0 ) * 0.13 ), vec2( 0.034, 0.06 ), -1.0, aa ) );
  f = max( f, dmEll( p, vec2( 0.085, 0.36 ), vec2( 0.075, 0.026 ), 0.55, aa ) );
  f = max( f, ( 1.0 - smoothstep( 0.009, 0.009 + aa, x ) ) * ( 1.0 - smoothstep( 0.0, aa, abs( y - 0.3 ) - 0.1 ) ) );
  float cx = 0.5 * k - x;
  float cy = min( y, 1.0 - y );
  float rr = 0.045 * ( 0.65 + 0.35 * abs( cos( 2.0 * atan( cy, cx ) ) ) );
  f = max( f, 1.0 - smoothstep( rr, rr + aa, length( vec2( cx, cy ) ) ) );
#endif
  return clamp( f, 0.0, 1.0 ) * ( 1.0 - smoothstep( 0.05, 0.2, aa ) );
}
`;

// ---------------------------------------------------------------------------------------------
// Canvases (placeholders that read as varnished paintings)
// ---------------------------------------------------------------------------------------------

export type CanvasKind = 'landscape' | 'portrait' | 'history' | 'stilllife';

export interface CanvasGrid {
  kind: CanvasKind;
  /** vertices across / up */
  nx: number;
  ny: number;
  /** sRGB colours 0…1, row-major from the bottom row (j) and left (i): index j * nx + i */
  colours: RGB[];
}

const mix3 = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hx = (s: string) => hexToRgb(s);

/** Low-frequency value noise on a small lattice (deterministic from the seed). */
function noise2(seed: number): (x: number, y: number) => number {
  const rnd = mulberry32(seed >>> 0);
  const N = 5;
  const g = Array.from({ length: (N + 1) * (N + 1) }, () => rnd());
  return (x: number, y: number) => {
    const fx = Math.min(N - 1e-6, Math.max(0, x * (N - 1)));
    const fy = Math.min(N - 1e-6, Math.max(0, y * (N - 1)));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = smooth(0, 1, fx - i);
    const ty = smooth(0, 1, fy - j);
    const a = g[j * (N + 1) + i];
    const b = g[j * (N + 1) + i + 1];
    const c = g[(j + 1) * (N + 1) + i];
    const d = g[(j + 1) * (N + 1) + i + 1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

/** Old-master palette under yellowed varnish [N]. */
const PAL = {
  dark: hx('#241C14'),
  umber: hx('#3B2D1E'),
  earth: hx('#5C4630'),
  olive: hx('#3E3F26'),
  foliage: hx('#2B3020'),
  skyLow: hx('#B9A57A'),
  skyHigh: hx('#79735C'),
  cloud: hx('#CBB98E'),
  flesh: hx('#C29673'),
  linen: hx('#D2C3A0'),
  drapery: [hx('#7A2A1E'), hx('#33435A'), hx('#2A2622'), hx('#6A5A2C'), hx('#4A2E3E')] as RGB[],
};

/**
 * Colour grid of one canvas [w × h m], deterministic from `seed`. The grid is coarse (≈ 8–9 cm cells) so it reads as
 * a softly modelled varnished picture at 2–10 m and stays cheap (≤ 14 × 14 vertices).
 */
export function canvasGrid(seed: number, w: number, h: number): CanvasGrid {
  const rnd = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const ar = w / h;
  const r0 = rnd();
  const kind: CanvasKind = ar > 1.18 ? (r0 < 0.75 ? 'landscape' : 'history') : ar < 0.85 ? (r0 < 0.7 ? 'portrait' : 'history') : r0 < 0.45 ? 'stilllife' : r0 < 0.75 ? 'landscape' : 'portrait';
  const nx = Math.max(6, Math.min(14, Math.round(w / 0.085) + 1));
  const ny = Math.max(6, Math.min(14, Math.round(h / 0.085) + 1));
  const n = noise2((seed * 2654435761) >>> 0);
  const horizon = 0.3 + rnd() * 0.22;
  const treeSide = rnd() < 0.5 ? 0.18 + rnd() * 0.12 : 0.7 + rnd() * 0.12;
  const treeR = 0.18 + rnd() * 0.12;
  const drape = PAL.drapery[Math.floor(rnd() * PAL.drapery.length)];
  const fx = 0.4 + rnd() * 0.2;
  const light = rnd() < 0.5 ? 0.25 : 0.75; // side of the light source
  const at = (x: number, y: number): RGB => {
    const nz = n(x, y) - 0.5;
    let c: RGB;
    switch (kind) {
      case 'landscape': {
        if (y > horizon) {
          const t = (y - horizon) / (1 - horizon);
          c = mix3(PAL.skyLow, PAL.skyHigh, Math.pow(t, 0.8));
          if (nz > 0.08) c = mix3(c, PAL.cloud, Math.min(1, (nz - 0.08) * 3));
        } else {
          const t = y / horizon;
          c = mix3(PAL.dark, PAL.olive, t);
          // a light path or water near the horizon
          if (Math.abs(y - horizon * 0.7) < 0.06 && Math.abs(x - 0.5) < 0.3) c = mix3(c, PAL.skyLow, 0.45);
        }
        // a dark tree mass rising into the sky on one side
        const d = Math.hypot((x - treeSide) * 1.2, (y - horizon - treeR * 0.6) * 0.9);
        if (d < treeR) c = mix3(c, PAL.foliage, Math.min(1, (treeR - d) * 10));
        break;
      }
      case 'portrait': {
        c = mix3(PAL.dark, PAL.umber, 0.5 + nz);
        // soft light behind the sitter
        c = mix3(c, PAL.earth, Math.max(0, 0.45 - Math.hypot(x - light, y - 0.7)) * 1.2);
        // body (trapezoid) and head (oval)
        const half = 0.36 - 0.18 * Math.min(1, y / 0.6);
        if (y < 0.6 && Math.abs(x - 0.5) < half) c = mix3(drape, PAL.dark, 0.15 + 0.35 * Math.abs(x - light));
        if (y > 0.54 && y < 0.6 && Math.abs(x - 0.5) < 0.1) c = PAL.linen;
        const dh = Math.hypot((x - 0.5) / 0.13, (y - 0.71) / 0.12);
        if (dh < 1) c = mix3(PAL.flesh, PAL.earth, Math.max(0, dh - 0.4) + 0.3 * Math.abs(x - light));
        break;
      }
      case 'history': {
        c = mix3(PAL.dark, PAL.earth, 0.35 + nz);
        if (y > 0.6) c = mix3(c, PAL.skyLow, (y - 0.6) * (x < 0.5 ? 1.1 : 0.5));
        // a lit group of figures on a diagonal, with drapery accents
        const band = Math.abs(y - (0.25 + 0.3 * x) ) ;
        if (band < 0.16 && x > 0.15 && x < 0.9) {
          const k = (0.16 - band) / 0.16;
          c = mix3(c, (Math.floor(x * 7) % 3 === 0 ? drape : Math.floor(x * 7) % 3 === 1 ? PAL.flesh : PAL.linen), k * 0.85);
        }
        break;
      }
      default: {
        // still life: dark ground, a table ledge, a lit cluster of fruit and flowers
        c = mix3(PAL.dark, PAL.umber, 0.4 + nz);
        if (y < 0.3) c = mix3(PAL.earth, PAL.umber, y / 0.3);
        const d = Math.hypot((x - fx) * 1.1, y - 0.45);
        if (d < 0.22) c = mix3(c, nz > 0 ? PAL.cloud : drape, Math.min(1, (0.22 - d) * 7));
      }
    }
    // varnish darkening towards the frame and a fine tonal variation
    const edge = Math.min(x, 1 - x, y, 1 - y);
    const vig = 0.78 + 0.22 * smooth(0, 0.18, edge);
    const k = vig * (1 + nz * 0.25);
    return [c[0] * k, c[1] * k, c[2] * k];
  };
  const colours: RGB[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) colours.push(at(i / (nx - 1), j / (ny - 1)));
  return { kind, nx, ny, colours };
}

// ---------------------------------------------------------------------------------------------
// Mirrors
// ---------------------------------------------------------------------------------------------

/** Colours of the room a mirror reflects (sRGB hex): the wall above the dado, the dado, the ceiling, the floor. */
export interface MirrorRoom {
  wall: string;
  dado?: string;
  ceiling?: string;
  floor?: string;
}

/** Mercury-glass tint per sRGB channel (≈ 0.85 / 0.83 / 0.77 linear: tin-mercury amalgam reflects ≈ 0.75–0.85, a slightly warm grey) [I]. */
export const MERCURY_TINT: RGB = [0.935, 0.925, 0.895];

/**
 * Colour grid of a mirror glass [w × h m]: a soft image of the room opposite in that room's own colours (wave-5
 * review: the former fixed cream-and-parquet image went near-black in a yellow room and dark brown in the white
 * Naturalienkabinett). Seen at eye height a pier glass shows the opposite wall above its dado, a gilt-framed opening
 * (a window: bright, or a door), the cornice and a strip of ceiling; no floor band (the eye looks across the glass,
 * not down). Under the warm grey of mercury glass, slightly darker at the edges (foxing) [I]. The mean luminance stays
 * ≥ 0.6 × the reflected wall's (test). Same layout as CanvasGrid.
 */
export function mirrorGrid(seed: number, w: number, h: number, room: MirrorRoom = { wall: '#D6CFBF' }): CanvasGrid {
  const rnd = mulberry32((seed ^ 0x51ed270b) >>> 0);
  const nx = Math.max(5, Math.min(12, Math.round(w / 0.12) + 1));
  const ny = Math.max(8, Math.min(18, Math.round(h / 0.12) + 1));
  const n = noise2((seed * 40503) >>> 0);
  const wall = hx(room.wall);
  const dado = hx(room.dado ?? '#E9E5DA');
  const ceil = hx(room.ceiling ?? '#ECE8DE');
  const gold = hx('#C8A458');
  const opening = 0.25 + rnd() * 0.5; // a door or window in the opposite wall
  const openW = 0.14 + rnd() * 0.1;
  const bright = rnd() < 0.6; // a window (bright) or a door (darker)
  const at = (x: number, y: number): RGB => {
    let c: RGB;
    if (y < 0.1) c = dado;
    else if (y < 0.112) c = gold; // chair rail
    else if (y < 0.8) c = mix3(wall, wall.map((v) => Math.min(1, v * 1.08)) as RGB, (y - 0.112) / 0.688);
    else if (y < 0.818) c = gold; // cornice gilding
    else c = mix3(ceil, ceil.map((v) => v * 0.92) as RGB, (y - 0.83) / 0.17);
    if (Math.abs(x - opening) < openW && y > 0.04 && y < 0.7) c = bright ? hx('#EEF2F2') : mix3(hx('#8A765C'), wall, 0.5);
    if (Math.abs(Math.abs(x - opening) - openW) < 0.02 && y > 0.04 && y < 0.72) c = gold;
    const edge = Math.min(x, 1 - x, y, 1 - y);
    const k = (0.9 + 0.1 * smooth(0, 0.1, edge)) * (1 + (n(x, y) - 0.5) * 0.06);
    return [Math.min(1, c[0] * MERCURY_TINT[0] * k), Math.min(1, c[1] * MERCURY_TINT[1] * k), Math.min(1, c[2] * MERCURY_TINT[2] * k)];
  };
  const colours: RGB[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) colours.push(at(i / (nx - 1), j / (ny - 1)));
  return { kind: 'history', nx, ny, colours };
}

/** Mean relative luminance (sRGB-encoded channels → linear) of a colour grid. */
export function gridLuminance(g: CanvasGrid): number {
  let s = 0;
  for (const [r, gg, b] of g.colours) s += 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(gg) + 0.0722 * srgbToLinear(b);
  return s / g.colours.length;
}

// ---------------------------------------------------------------------------------------------
// Panelling bands shared by the shell (drawing) and the programme (the picture hang)
// ---------------------------------------------------------------------------------------------

/**
 * Height of the cove cornice of a room (m): fancy rooms ≈ 12 % of the clear height (≤ 0.75 m), plain rooms 0.16 m,
 * never down over an opening head; 0 under a vault [N 02 §2.12].
 */
export function corniceHeight(holes: readonly { v1: number }[], clear: number, fancy: boolean, vault: boolean): number {
  if (vault) return 0;
  let maxHoleTop = 0;
  for (const h of holes) if (h.v1 < clear - 0.02) maxHoleTop = Math.max(maxHoleTop, h.v1);
  return Math.max(0.08, Math.min(fancy ? Math.min(0.75, clear * 0.12) : 0.16, clear - maxHoleTop - 0.04));
}

/**
 * The painted overdoors (supraportes, KB-I26) of one wall: the boiserie's overdoor fields at least
 * STATE_ROOM.supraporte.min tall, in state rooms with panelled or silk walls only (research/09 I3) [N]. The picture
 * hang of a gallery leaves these fields to the supraporte (wave-5 review: two frames collided over a door).
 */
export function supraportePanels(len: number, holes: Hole[], clear: number, corniceH: number, o: { state: boolean; fancy: boolean }): Panel[] {
  if (!o.state || !o.fancy || clear <= 2.8) return [];
  return boiseriePanels(len, holes, { ...DEFAULT_BOISERIE, top: clear - corniceH }).filter((p) => p.kind === 'overdoor' && p.v1 - p.v0 >= STATE_ROOM.supraporte.min);
}

/**
 * Split a silk field into hanging panels no wider than `maxW` (Tapetenleisten every ≈ 2 m, so every wall shows the
 * framed panels with their border, long walls included: wave-5 review) [N]; adjacent panels are `gap` apart.
 */
export function splitField(f: WallRect, maxW: number = STATE_ROOM.panelMax, gap = 0.08): WallRect[] {
  const w = f.u1 - f.u0;
  const n = Math.max(1, Math.ceil((w + gap) / (maxW + gap) - 1e-9));
  if (n === 1) return [f];
  const pw = (w - (n - 1) * gap) / n;
  return Array.from({ length: n }, (_, i) => ({ ...f, u0: f.u0 + i * (pw + gap), u1: f.u0 + i * (pw + gap) + pw }));
}

// ---------------------------------------------------------------------------------------------
// Greek-key frieze
// ---------------------------------------------------------------------------------------------

/**
 * Raised strips of a running Greek key (meander) along a band of length `len` and height `h` (u along, v up, from
 * the band's lower left). One unit is h wide; the key is drawn with strips of h/5 [N "à la grecque"]. All strips lie
 * inside the band.
 */
export function meanderRects(len: number, h: number): WallRect[] {
  const s = h / 5; // strip width
  const out: WallRect[] = [];
  const units = Math.floor(len / h);
  const start = (len - units * h) / 2;
  // top and bottom fillets of the frieze
  out.push({ u0: 0, u1: len, v0: 0, v1: s * 0.6 });
  out.push({ u0: 0, u1: len, v0: h - s * 0.6, v1: h });
  for (let k = 0; k < units; k++) {
    const a = start + k * h;
    // a square spiral hook: up the left, across the top, down the right to mid height, back left to the middle
    out.push({ u0: a, u1: a + s, v0: s * 0.6, v1: h - s * 1.6 });
    out.push({ u0: a, u1: a + h - s, v0: h - s * 2.6, v1: h - s * 1.6 });
    out.push({ u0: a + h - 2 * s, u1: a + h - s, v0: s * 1.6, v1: h - s * 2.6 });
    out.push({ u0: a + 2 * s, u1: a + h - 2 * s, v0: s * 1.6, v1: s * 2.6 });
  }
  return out.filter((r) => r.u1 - r.u0 > 1e-4 && r.v1 - r.v0 > 1e-4);
}

// ---------------------------------------------------------------------------------------------
// Catalogue function text
// ---------------------------------------------------------------------------------------------

/** First integer before `noun` in a function text ("… 20 crystal chandeliers …" → 20); null when absent. */
export function countIn(text: string | undefined, noun: RegExp): number | null {
  if (!text) return null;
  const m = text.match(new RegExp(`(\\d+)\\s+(?:[\\w-]+\\s+){0,3}?${noun.source}`, 'i'));
  return m ? Number(m[1]) : null;
}
