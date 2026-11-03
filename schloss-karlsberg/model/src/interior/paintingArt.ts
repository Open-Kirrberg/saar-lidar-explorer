/**
 * Wave-10 review fix (audit #4): paints the placeholder compositions of painting.ts ONCE into a texture atlas with the
 * Canvas 2D API (browser only; Node exports keep the vertex-colour canvases). Painterly means: soft-edged masses built
 * from radial-gradient blobs, light-to-shade modelling instead of outlines, no drawn facial features, a muted
 * old-master palette, brushwork, yellowed varnish, a darkened edge and craquelure [N 18th-c. genres and technique;
 * I shapes]. No artwork is copied and no HMS image is used (decisions log KB-I26/I27).
 *
 * Each tile is drawn at 2× in a scratch canvas in "picture units" (x in [0, aspect], y in [0, 1], y down) and reduced
 * into its atlas cell, which softens it like paint seen through varnish.
 */
import * as THREE from 'three';
import { mulberry32 } from '../layout/geom.ts';
import { ATLAS, ATLAS_PX, KIND_ASPECT, type HistorySpec, type LandscapeSpec, type PaintingSpec, type PortraitSpec, type StillLifeSpec, paintingVariants } from './painting.ts';

type C2D = CanvasRenderingContext2D;

// ---------------------------------------------------------------------------------------------
// colour helpers (sRGB hex)
// ---------------------------------------------------------------------------------------------

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}
function hex(c: readonly number[]): string {
  return `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}
/** Scale the value of a colour (k > 1 lightens toward a warm white, k < 1 darkens toward umber). */
function val(h: string, k: number): string {
  const c = rgb(h);
  if (k <= 1) return hex([c[0] * k + 18 * (1 - k), c[1] * k + 12 * (1 - k), c[2] * k + 6 * (1 - k)]);
  const t = Math.min(1, k - 1);
  return hex([c[0] + (250 - c[0]) * t, c[1] + (238 - c[1]) * t, c[2] + (212 - c[2]) * t]);
}
function mixc(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return hex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t));
}
function rgba(h: string, a: number): string {
  const c = rgb(h);
  return `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
}

// ---------------------------------------------------------------------------------------------
// drawing primitives
// ---------------------------------------------------------------------------------------------

/** Soft elliptical blob: colour at alpha `a` up to `hard` of the radius, fading to 0 at the rim. */
function blob(g: C2D, x: number, y: number, rx: number, ry: number, col: string, a = 1, hard = 0.45, rot = 0): void {
  if (rx <= 0 || ry <= 0) return;
  g.save();
  g.translate(x, y);
  if (rot) g.rotate(rot);
  g.scale(rx, ry);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  gr.addColorStop(0, rgba(col, a));
  gr.addColorStop(Math.min(0.98, hard), rgba(col, a));
  gr.addColorStop(1, rgba(col, 0));
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, 1, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function vgrad(g: C2D, y0: number, y1: number, stops: [number, string][]): CanvasGradient {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  for (const [t, c] of stops) gr.addColorStop(t, c);
  return gr;
}
function hgrad(g: C2D, x0: number, x1: number, stops: [number, string][]): CanvasGradient {
  const gr = g.createLinearGradient(x0, 0, x1, 0);
  for (const [t, c] of stops) gr.addColorStop(t, c);
  return gr;
}

function rect(g: C2D, x: number, y: number, w: number, h: number, fill: string | CanvasGradient): void {
  g.fillStyle = fill;
  g.fillRect(x, y, w, h);
}

/** A ridge line y(x) over [0, A] filled down to `bottom`. */
function ridge(g: C2D, A: number, y: (x: number) => number, bottom: number, fill: string | CanvasGradient): void {
  g.beginPath();
  g.moveTo(-0.02, bottom);
  for (let i = 0; i <= 48; i++) {
    const x = -0.02 + ((A + 0.04) * i) / 48;
    g.lineTo(x, y(x));
  }
  g.lineTo(A + 0.02, bottom);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
}

/** 1-D value noise from a seeded table (smooth). */
function noise1(rnd: () => number, n = 16): (x: number) => number {
  const t = Array.from({ length: n + 1 }, () => rnd());
  return (x: number) => {
    const f = ((x % 1) + 1) % 1;
    const p = f * n;
    const i = Math.floor(p);
    const s = p - i;
    const k = s * s * (3 - 2 * s);
    return t[i] + (t[i + 1] - t[i]) * k;
  };
}

/** Foliage mass: overlapping soft dark masses with lighter leaf clumps toward the light (lx = −1 left, +1 right). */
function foliage(g: C2D, rnd: () => number, cx: number, cy: number, rx: number, ry: number, n: number, dark: string, lit: string, lx: number, scale = 1): void {
  const r0 = 0.42 * Math.min(rx, ry) * Math.min(1.2, scale);
  const pts: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.pow(rnd(), 0.7);
    pts.push([cx + Math.cos(a) * r * rx * 0.85, cy + Math.sin(a) * r * ry * 0.85, 0.5 + 0.5 * rnd()]);
  }
  for (const [x, y, s] of pts) blob(g, x, y, r0 * s, r0 * s * 0.9, val(dark, 0.85), 0.9, 0.4);
  for (const [x, y, s] of pts) {
    const toward = ((x - cx) / rx) * lx - (y - cy) / ry;
    if (toward > -0.1) blob(g, x + lx * r0 * 0.2, y - r0 * 0.15, r0 * s * 0.6, r0 * s * 0.5, mixc(dark, lit, Math.min(1, 0.3 + 0.45 * toward)), 0.6, 0.25);
  }
  for (let i = 0; i < n / 2; i++) {
    const [x, y, s] = pts[Math.floor(rnd() * pts.length)];
    const toward = ((x - cx) / rx) * lx - (y - cy) / ry;
    if (toward > 0.35) blob(g, x + lx * r0 * 0.35, y - r0 * 0.3, r0 * s * 0.25, r0 * s * 0.2, lit, 0.5, 0.2);
  }
}

// ---------------------------------------------------------------------------------------------
// genres
// ---------------------------------------------------------------------------------------------

const SKY: Record<LandscapeSpec['mood'], { top: string; mid: string; low: string; glow: string; cloud: string; under: string }> = {
  morning: { top: '#6F8290', mid: '#A9B0A4', low: '#E2D6B0', glow: '#F2E6C0', cloud: '#EEE6CE', under: '#9A9888' },
  noon: { top: '#5E7486', mid: '#97A6A6', low: '#D2CCAE', glow: '#EAE2C4', cloud: '#F0EADA', under: '#A2A498' },
  evening: { top: '#6E7480', mid: '#B8A888', low: '#EAC68A', glow: '#F6D898', cloud: '#F2DCB0', under: '#8E7E6E' },
};

function landscape(g: C2D, A: number, s: LandscapeSpec): void {
  const rnd = mulberry32(s.seed);
  const hz = s.horizon;
  const sk = SKY[s.mood];
  const lx = s.trees === -1 ? 1 : -1; // light from the side away from the trees
  // sky and sun glow
  rect(g, 0, 0, A, hz + 0.02, vgrad(g, 0, hz, [[0, sk.top], [0.55, sk.mid], [1, sk.low]]));
  const sunX = A * (lx > 0 ? 0.72 : 0.28);
  blob(g, sunX, hz - 0.06, 0.45, 0.22, sk.glow, 0.55, 0.1);
  // cumulus: grey undersides, lit tops toward the sun
  for (let k = 0; k < s.clouds; k++) {
    const cx = A * (0.08 + 0.84 * rnd());
    const cy = 0.08 + (hz - 0.3) * rnd();
    const w = 0.08 + 0.14 * rnd();
    for (let i = 0; i < 9; i++) {
      const x = cx + (rnd() - 0.5) * w * 2;
      const y = cy + (rnd() - 0.3) * w * 0.5;
      const r = w * (0.35 + 0.4 * rnd());
      blob(g, x, y + r * 0.25, r, r * 0.6, sk.under, 0.55, 0.2);
    }
    for (let i = 0; i < 9; i++) {
      const x = cx + (rnd() - 0.5) * w * 1.8 + lx * w * 0.1;
      const y = cy + (rnd() - 0.6) * w * 0.45;
      const r = w * (0.3 + 0.35 * rnd());
      blob(g, x, y, r, r * 0.62, sk.cloud, 0.7, 0.25);
    }
  }
  // distant hills (aerial perspective) and a nearer range
  const n1 = noise1(rnd);
  const n2 = noise1(rnd);
  const far = (x: number) => hz - 0.025 - 0.07 * n1(x / A * 0.8 + 0.1) - 0.02 * n2(x / A * 3);
  ridge(g, A, far, hz + 0.05, vgrad(g, hz - 0.1, hz + 0.02, [[0, mixc('#8E9CA2', sk.low, 0.25)], [1, mixc('#9AA39A', sk.low, 0.4)]]));
  // a small building on the far hills, lit on the sun side
  if (s.building !== 'none') {
    const bx = A * (s.trees === -1 ? 0.62 + 0.2 * rnd() : 0.18 + 0.2 * rnd());
    const by = far(bx) + 0.008;
    const stone = mixc('#B8AE96', sk.low, 0.3);
    const shade = mixc('#7E7C74', sk.low, 0.3);
    g.fillStyle = shade;
    if (s.building === 'tower') {
      g.fillRect(bx - 0.008, by - 0.07, 0.016, 0.07);
      g.beginPath();
      g.moveTo(bx - 0.011, by - 0.07);
      g.lineTo(bx, by - 0.095);
      g.lineTo(bx + 0.011, by - 0.07);
      g.fill();
      g.fillStyle = stone;
      g.fillRect(bx + (lx > 0 ? 0 : -0.008), by - 0.07, 0.008, 0.07);
    } else if (s.building === 'temple') {
      g.fillRect(bx - 0.03, by - 0.035, 0.06, 0.035);
      g.beginPath();
      g.moveTo(bx - 0.034, by - 0.035);
      g.lineTo(bx, by - 0.05);
      g.lineTo(bx + 0.034, by - 0.035);
      g.fill();
      g.fillStyle = stone;
      for (let i = 0; i < 5; i++) g.fillRect(bx - 0.027 + i * 0.0125, by - 0.033, 0.005, 0.031);
    } else {
      g.fillRect(bx - 0.045, by - 0.03, 0.09, 0.03);
      g.fillRect(bx - 0.05, by - 0.055, 0.016, 0.055);
      g.fillRect(bx + 0.03, by - 0.065, 0.018, 0.065);
      g.fillStyle = stone;
      g.fillRect(bx - 0.045, by - 0.03, 0.09, 0.008);
      g.fillRect(bx + (lx > 0 ? 0.039 : 0.03), by - 0.065, 0.009, 0.065);
    }
  }
  const n3 = noise1(rnd);
  const near = (x: number) => hz + 0.005 - 0.035 * n3(x / A * 1.3 + 0.4);
  ridge(g, A, near, 1.02, vgrad(g, hz - 0.03, 1, [[0, '#6E7458'], [0.25, '#5C5E3A'], [0.6, '#4A4426'], [1, '#2E2818']]));
  // lit fields and darker hedgerows in the middle distance
  for (let i = 0; i < 9; i++) {
    const y = hz + 0.03 + 0.2 * rnd();
    blob(g, A * rnd(), y, 0.12 + 0.12 * rnd(), 0.012 + 0.01 * rnd(), rnd() < 0.6 ? '#9C8C50' : '#7C8048', 0.45, 0.3);
  }
  for (let i = 0; i < 7; i++) {
    const x = A * rnd();
    const y = hz + 0.03 + 0.14 * rnd();
    foliage(g, rnd, x, y, 0.04 + 0.04 * rnd(), 0.022, 8, '#343A22', '#6A6E3A', lx, 1);
  }
  // water reflecting the sky
  if (s.water !== 'none') {
    g.save();
    g.beginPath();
    if (s.water === 'lake') {
      g.ellipse(A * (0.5 + 0.12 * lx), hz + 0.08, A * 0.24, 0.035, 0, 0, Math.PI * 2);
    } else {
      const x0 = A * (0.45 + 0.2 * (rnd() - 0.5));
      g.moveTo(x0 - 0.01, hz + 0.02);
      g.bezierCurveTo(x0 + 0.15, hz + 0.07, x0 - 0.25, hz + 0.14, x0 + 0.05, 0.86);
      g.lineTo(x0 + 0.24, 0.86);
      g.bezierCurveTo(x0 - 0.05, hz + 0.15, x0 + 0.24, hz + 0.07, x0 + 0.012, hz + 0.02);
      g.closePath();
    }
    g.fillStyle = vgrad(g, hz, 0.9, [[0, mixc(sk.mid, '#5E6458', 0.35)], [1, mixc(sk.top, '#3A4240', 0.55)]]);
    g.fill();
    g.clip();
    for (let i = 0; i < 14; i++) blob(g, A * rnd(), hz + 0.02 + 0.3 * rnd(), 0.05, 0.003, sk.glow, 0.3, 0.2);
    g.restore();
  }
  // foreground: a dark bank with a lit path
  const n4 = noise1(rnd);
  ridge(g, A, (x) => 0.8 + 0.06 * n4(x / A), 1.02, vgrad(g, 0.76, 1, [[0, '#4A3E24'], [1, '#231B10']]));
  g.beginPath();
  const px = A * (0.5 - 0.15 * lx);
  g.moveTo(px - 0.14, 1.01);
  g.bezierCurveTo(px - 0.04, 0.92, px + 0.08, 0.88, px + 0.02, 0.82);
  g.lineTo(px + 0.06, 0.82);
  g.bezierCurveTo(px + 0.14, 0.88, px + 0.06, 0.93, px + 0.16, 1.01);
  g.closePath();
  g.fillStyle = vgrad(g, 0.82, 1, [[0, '#9C8A5C'], [1, '#6A5636']]);
  g.fill();
  // repoussoir tree group, trunks first
  const tx = s.trees === -1 ? A * 0.13 : A * 0.87;
  g.strokeStyle = '#1E1810';
  g.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const x = tx + (rnd() - 0.5) * 0.12;
    g.lineWidth = 0.012 + 0.008 * rnd();
    g.beginPath();
    g.moveTo(x, 0.95);
    g.quadraticCurveTo(x + (rnd() - 0.5) * 0.06, 0.6, x + (rnd() - 0.5) * 0.08, 0.32);
    g.stroke();
  }
  foliage(g, rnd, tx, 0.3, 0.2, 0.26, 42, '#20261A', '#6E7038', lx, 1.3);
  foliage(g, rnd, tx + s.trees * -0.12, 0.5, 0.1, 0.14, 18, '#252B1C', '#7A7640', lx, 0.9);
  // staffage: small figures on the path, one red or blue accent
  for (let i = 0; i < 2 + Math.floor(rnd() * 2); i++) {
    const fx = px + (rnd() - 0.3) * 0.1;
    const fy = 0.86 + 0.06 * rnd();
    const sz = 0.03 + 0.012 * (fy - 0.86) * 10;
    blob(g, fx, fy - sz * 0.5, sz * 0.22, sz * 0.5, ['#8E2A1E', '#33465E', '#D8CCB0', '#5A4A30'][i % 4], 0.95, 0.6);
    blob(g, fx, fy - sz * 1.05, sz * 0.12, sz * 0.13, '#C9A080', 0.95, 0.5);
  }
}

function portrait(g: C2D, A: number, s: PortraitSpec): void {
  const rnd = mulberry32(s.seed);
  const L = s.light;
  const T = s.turn;
  const woman = s.sitter === 'woman';
  const cx = A / 2 + T * 0.01;
  // ground: dark, a soft light behind the head on the light side, darker below
  rect(g, 0, 0, A, 1, vgrad(g, 0, 1, [[0, val(s.ground, 1.05)], [0.6, s.ground], [1, val(s.ground, 0.7)]]));
  blob(g, cx + L * 0.14, 0.32, 0.42, 0.42, val(s.ground, 1.45), 0.75, 0.05);
  for (let i = 0; i < 6; i++) blob(g, A * rnd(), rnd(), 0.2, 0.2, val(s.ground, 0.8 + 0.4 * rnd()), 0.25, 0.1);
  // proportions of a half-length portrait: the head about a quarter of the height [N]
  const fx = cx + T * 0.012;
  const fy = 0.31;
  const rx = woman ? 0.09 : 0.097;
  const ry = woman ? 0.118 : 0.125;
  const neckY = woman ? 0.49 : 0.465;
  const shY = woman ? 0.58 : 0.55;
  const near = -T;
  const sw = (side: number) => (side === near ? 0.3 : 0.24);
  const pale = '#D8D2C6';
  const paleShade = '#A29E94';
  const hairDark = '#3A2A1E';
  // hair mass behind the head
  if (s.head === 'pouf') blob(g, fx - T * 0.02, fy - 0.07, 0.17, 0.17, paleShade, 0.95, 0.55);
  else if (s.head === 'wig') blob(g, fx - T * 0.05, fy + 0.01, 0.12, 0.14, paleShade, 0.95, 0.55);
  else if (s.head === 'own') blob(g, fx - T * 0.045, fy + 0.0, 0.115, 0.135, val(hairDark, 0.8), 0.95, 0.55);
  else blob(g, fx - T * 0.03, fy - 0.02, 0.13, 0.14, '#D2CABA', 0.95, 0.55);
  // neck, in shadow under the chin
  g.beginPath();
  g.moveTo(fx - 0.046, fy + 0.07);
  g.lineTo(fx + 0.046, fy + 0.07);
  g.lineTo(cx + 0.052, neckY + 0.03);
  g.lineTo(cx - 0.052, neckY + 0.03);
  g.closePath();
  g.fillStyle = hgrad(g, fx - 0.05, fx + 0.05, L < 0 ? [[0, '#BC8E6E'], [1, '#6E4A36']] : [[0, '#6E4A36'], [1, '#BC8E6E']]);
  g.fill();
  blob(g, fx, fy + 0.13, 0.06, 0.035, '#5E3E2C', 0.5, 0.2);
  // bust: sloping shoulders, the far shoulder (turn side) narrower
  g.beginPath();
  g.moveTo(cx - sw(-1) - 0.14, 1.05);
  g.bezierCurveTo(cx - sw(-1) - 0.08, 0.82, cx - sw(-1) - 0.02, shY + 0.03, cx - sw(-1) + 0.03, shY);
  g.quadraticCurveTo(cx - 0.16, neckY + 0.0, cx - 0.06, neckY);
  g.lineTo(cx + 0.06, neckY);
  g.quadraticCurveTo(cx + 0.16, neckY + 0.0, cx + sw(1) - 0.03, shY);
  g.bezierCurveTo(cx + sw(1) + 0.02, shY + 0.03, cx + sw(1) + 0.08, 0.82, cx + sw(1) + 0.14, 1.05);
  g.closePath();
  const dark = s.coat === '#1E1C1A' || s.coat === '#22201E';
  const coatLit = val(s.coat, dark ? 1.25 : 1.32);
  const coatDark = val(s.coat, 0.45);
  g.fillStyle = hgrad(g, cx - 0.42, cx + 0.42, L < 0 ? [[0, coatLit], [0.45, s.coat], [1, coatDark]] : [[0, coatDark], [0.55, s.coat], [1, coatLit]]);
  g.fill();
  g.save();
  g.clip();
  for (let i = 0; i < 7; i++) blob(g, cx + (rnd() - 0.5) * 0.6, 0.72 + 0.25 * rnd(), 0.025, 0.14, rnd() < 0.5 ? coatDark : coatLit, 0.3, 0.2, (rnd() - 0.5) * 0.7);
  if (!woman) {
    // coat opening with the waistcoat and soft buttons
    g.beginPath();
    g.moveTo(cx + T * 0.02 - 0.045, neckY + 0.01);
    g.lineTo(cx + T * 0.02 + 0.045, neckY + 0.01);
    g.lineTo(cx + T * 0.05 + 0.08, 1.02);
    g.lineTo(cx + T * 0.05 - 0.07, 1.02);
    g.closePath();
    g.fillStyle = hgrad(g, cx - 0.1, cx + 0.12, L < 0 ? [[0, val(s.accent, 1.1)], [1, val(s.accent, 0.55)]] : [[0, val(s.accent, 0.55)], [1, val(s.accent, 1.1)]]);
    g.fill();
    for (let i = 0; i < 5; i++) blob(g, cx + T * 0.03 + 0.05 + i * 0.006, neckY + 0.12 + i * 0.075, 0.007, 0.006, '#C8A858', 0.75, 0.3);
    if (s.jewel) {
      // the broad blue sash of an order across the chest
      g.beginPath();
      g.moveTo(cx - 0.26 * near, shY - 0.01);
      g.lineTo(cx - 0.26 * near + near * 0.08, shY - 0.05);
      g.lineTo(cx + 0.32 * near, 1.04);
      g.lineTo(cx + 0.32 * near - near * 0.09, 1.04);
      g.closePath();
      g.fillStyle = rgba('#3E5E8E', 0.8);
      g.fill();
      blob(g, cx - 0.16 * near, 0.82, 0.028, 0.028, '#D8D0B8', 0.8, 0.3);
    }
  } else {
    // décolleté and fichu, a bow at the bodice
    blob(g, cx + T * 0.01, neckY + 0.05, 0.12, 0.07, '#D4A888', 1, 0.6);
    blob(g, cx + T * 0.01 + L * 0.03, neckY + 0.04, 0.07, 0.04, '#E8C4A4', 0.7, 0.2);
    for (let i = 0; i < 9; i++) {
      const a = (i / 8) * Math.PI;
      blob(g, cx + Math.cos(a) * 0.15, neckY + 0.06 + Math.sin(a) * 0.07, 0.055, 0.032, i % 2 ? '#EEE8DA' : '#D8D0C0', 0.75, 0.3);
    }
    blob(g, cx + T * 0.02, neckY + 0.17, 0.03, 0.022, s.accent, 0.85, 0.4);
    if (s.jewel) for (let i = 0; i < 9; i++) blob(g, cx - 0.05 + i * 0.0125, neckY + 0.005 + 0.014 * Math.sin((i / 8) * Math.PI), 0.0055, 0.0055, '#EEE6D6', 0.95, 0.4);
  }
  g.restore();
  if (!woman) {
    // stock and jabot: a soft white cascade
    blob(g, cx, neckY - 0.005, 0.055, 0.022, '#E8E2D4', 0.95, 0.5);
    for (let i = 0; i < 5; i++) blob(g, cx + T * 0.012 + (rnd() - 0.5) * 0.025, neckY + 0.03 + i * 0.03, 0.036 - i * 0.004, 0.024, i % 2 ? '#EEE8DA' : '#D0C8B8', 0.9, 0.35);
  }
  // the head: a three-quarter oval modelled light to shade, soft eye-socket darks, no drawn features
  g.save();
  // forehead and cheeks broad, the jaw tapering to the chin; the far cheek (turn side) narrower
  const cn = rx * (T < 0 ? 0.88 : 1);
  const cf = rx * (T < 0 ? 1 : 0.88);
  g.beginPath();
  g.moveTo(fx, fy - ry);
  g.bezierCurveTo(fx + cf * 0.75, fy - ry, fx + cf * 1.02, fy - ry * 0.45, fx + cf, fy);
  g.bezierCurveTo(fx + cf * 0.98, fy + ry * 0.5, fx + cf * 0.5 + T * 0.01, fy + ry * 0.95, fx + T * 0.012, fy + ry);
  g.bezierCurveTo(fx - cn * 0.5 + T * 0.01, fy + ry * 0.95, fx - cn * 0.98, fy + ry * 0.5, fx - cn, fy);
  g.bezierCurveTo(fx - cn * 1.02, fy - ry * 0.45, fx - cn * 0.75, fy - ry, fx, fy - ry);
  g.closePath();
  g.fillStyle = hgrad(g, fx - rx, fx + rx, L < 0 ? [[0, '#E4BEA0'], [0.5, '#CFA184'], [1, '#845842']] : [[0, '#845842'], [0.5, '#CFA184'], [1, '#E4BEA0']]);
  g.fill();
  g.clip();
  blob(g, fx + L * 0.03, fy - 0.045, 0.065, 0.05, '#F0D4B8', 0.5, 0.1); // forehead light
  blob(g, fx + L * 0.04, fy + 0.035, 0.045, 0.04, '#E2AE94', 0.35, 0.1); // lit cheek
  blob(g, fx - L * 0.09, fy + 0.01, 0.055, 0.14, '#6A4430', 0.5, 0.2); // shadow side
  const eyeY = fy - 0.012;
  const ex = fx + T * 0.02;
  blob(g, ex - T * 0.042, eyeY, 0.026, 0.015, '#5E3E2C', 0.36, 0.15); // near eye socket
  blob(g, ex + T * 0.034, eyeY, 0.019, 0.014, '#5E3E2C', 0.36, 0.15); // far eye socket
  blob(g, fx + T * 0.034 - L * 0.012, fy + 0.03, 0.009, 0.028, '#7A4E38', 0.28, 0.2); // nose shadow
  blob(g, fx + T * 0.034 + L * 0.004, fy + 0.045, 0.01, 0.008, '#F2D4B8', 0.35, 0.2); // nose light
  blob(g, fx + T * 0.024, fy + 0.078, 0.022, 0.008, '#9A5A48', 0.18, 0.2); // a soft mouth shadow
  blob(g, fx, fy + ry * 0.98, 0.08, 0.03, '#7A5038', 0.35, 0.2); // under the chin
  g.restore();
  // hair over the head
  if (s.head === 'wig') {
    // powdered wig: crown over the hairline, rolled side curls (ailes de pigeon), a black queue bow behind
    g.beginPath();
    g.ellipse(fx - T * 0.006, fy - 0.058, rx * 1.08, ry * 0.68, 0, Math.PI, Math.PI * 2);
    g.fillStyle = vgrad(g, fy - 0.14, fy - 0.03, [[0, pale], [1, '#C2BCB0']]);
    g.fill();
    blob(g, fx + L * 0.03, fy - 0.11, 0.05, 0.02, '#ECE8DE', 0.6, 0.2);
    for (const sd of [-1, 1]) {
      const far = sd === T;
      const x = fx + sd * (far ? rx - 0.012 : rx + 0.008);
      for (let k = 0; k < 2; k++) blob(g, x, fy - 0.035 + k * 0.032, far ? 0.02 : 0.028, 0.017, k ? paleShade : pale, 0.95, 0.5);
    }
  } else if (s.head === 'own') {
    g.beginPath();
    g.ellipse(fx - T * 0.008, fy - 0.04, rx * 1.08, ry * 0.8, 0, Math.PI * 1.02, Math.PI * 1.98);
    g.fillStyle = hairDark;
    g.fill();
    blob(g, fx + L * 0.03, fy - 0.12, 0.04, 0.016, '#6A4E36', 0.55, 0.2);
    blob(g, fx - T * 0.085, fy + 0.0, 0.028, 0.06, hairDark, 0.9, 0.4);
  } else if (s.head === 'pouf') {
    // the high powdered coiffure of the 1780s (hérisson) with side curls and a ribbon
    for (let i = 0; i < 9; i++) blob(g, fx + (i - 4) * 0.028, fy - 0.11 - 0.06 * Math.sin((i / 8) * Math.PI), 0.045, 0.05, i % 2 ? pale : '#E4DED2', 0.95, 0.5);
    blob(g, fx + L * 0.03, fy - 0.19, 0.06, 0.03, '#EEEAE2', 0.6, 0.2);
    for (const sd of [-1, 1]) blob(g, fx + sd * (rx + 0.01), fy + 0.05, 0.022, 0.045, paleShade, 0.9, 0.4);
    blob(g, fx + L * 0.06, fy - 0.17, 0.03, 0.02, s.accent, 0.85, 0.4);
  } else {
    // a muslin cap with a frilled edge and a ribbon over powdered hair
    for (let i = 0; i < 7; i++) blob(g, fx + (i - 3) * 0.026, fy - 0.1, 0.03, 0.03, pale, 0.9, 0.5);
    for (let i = 0; i < 11; i++) {
      const a = Math.PI * (0.95 + (1.1 * i) / 10);
      blob(g, fx + Math.cos(a) * 0.12, fy - 0.03 + Math.sin(a) * 0.14, 0.042, 0.038, i % 2 ? '#EEEAE0' : '#D4CEC0', 0.95, 0.45);
    }
    blob(g, fx, fy - 0.15, 0.11, 0.06, '#EEEAE0', 0.95, 0.5);
    g.strokeStyle = rgba(s.accent, 0.85);
    g.lineWidth = 0.012;
    g.beginPath();
    g.ellipse(fx, fy - 0.08, 0.11, 0.075, 0, Math.PI * 1.05, Math.PI * 1.95);
    g.stroke();
  }
  // painted oval
  if (s.oval) {
    g.save();
    g.beginPath();
    g.rect(-0.1, -0.1, A + 0.2, 1.2);
    g.ellipse(A / 2, 0.5, A * 0.47, 0.48, 0, 0, Math.PI * 2);
    g.fillStyle = rgba('#1C1610', 0.9);
    g.fill('evenodd');
    g.restore();
    g.strokeStyle = rgba('#8A7A5A', 0.3);
    g.lineWidth = 0.008;
    g.beginPath();
    g.ellipse(A / 2, 0.5, A * 0.47, 0.48, 0, 0, Math.PI * 2);
    g.stroke();
  }
}

function history(g: C2D, A: number, s: HistorySpec): void {
  const rnd = mulberry32(s.seed);
  const L = s.light;
  rect(g, 0, 0, A, 1, vgrad(g, 0, 1, [[0, '#2E251C'], [1, '#1A1410']]));
  const skyX = L < 0 ? 0 : A;
  // the sky opening on the light side
  const sky = vgrad(g, 0, 0.75, [[0, '#6E7880'], [0.6, '#BCAE88'], [1, '#D8C69A']]);
  if (s.setting === 'grove') {
    rect(g, 0, 0, A, 0.78, sky);
    blob(g, skyX, 0.6, A * 0.4, 0.3, '#E6D4A4', 0.6, 0.1);
    foliage(g, rnd, A - skyX * 0.9 + (L < 0 ? -0.15 : 0.15), 0.3, A * 0.45, 0.45, 50, '#1E2216', '#4E5230', L, 1.5);
  } else {
    // dark stone architecture with a lit arch or a receding colonnade
    rect(g, 0, 0, A, 0.8, '#3A3024');
    const ox = L < 0 ? A * 0.22 : A * 0.78;
    g.save();
    g.beginPath();
    if (s.setting === 'arcade') {
      g.moveTo(ox - 0.2, 0.8);
      g.lineTo(ox - 0.2, 0.35);
      g.arc(ox, 0.35, 0.2, Math.PI, 0);
      g.lineTo(ox + 0.2, 0.8);
    } else {
      g.rect(ox - 0.26, 0.08, 0.52, 0.72);
    }
    g.closePath();
    g.fillStyle = sky;
    g.fill();
    g.clip();
    for (let i = 0; i < 6; i++) blob(g, ox + (rnd() - 0.5) * 0.4, 0.2 + 0.3 * rnd(), 0.1, 0.05, '#E8DCC0', 0.55, 0.2);
    ridge(g, A, (x) => 0.62 + 0.04 * Math.sin(x * 9 + s.seed), 0.8, '#7C8070');
    g.restore();
    const cols = s.setting === 'colonnade' ? 4 : 2;
    for (let i = 0; i < cols; i++) {
      const x = s.setting === 'colonnade' ? ox - 0.25 + (i * 0.5) / (cols - 1) : ox + (i ? 0.22 : -0.22);
      const w = s.setting === 'colonnade' ? 0.04 : 0.055;
      g.fillStyle = hgrad(g, x - w, x + w, L < 0 ? [[0, '#A89878'], [1, '#3A3024']] : [[0, '#3A3024'], [1, '#A89878']]);
      g.fillRect(x - w, 0.08, 2 * w, 0.72);
      g.fillRect(x - w * 1.3, 0.08, 2.6 * w, 0.03);
      g.fillRect(x - w * 1.3, 0.77, 2.6 * w, 0.03);
    }
    rect(g, 0, 0, A, 0.08, '#2A2118');
  }
  // floor
  rect(g, 0, 0.78, A, 0.24, vgrad(g, 0.78, 1, [[0, '#5A4630'], [1, '#221A12']]));
  // the light falling on the group, a raking shaft
  const gx = A * s.groupX;
  blob(g, gx, 0.66, 0.42, 0.34, '#E8D2A0', 0.22, 0.1);
  blob(g, gx, 0.86, 0.38, 0.05, '#8A6E48', 0.5, 0.2);
  // background figures in shadow, then the lit group, back to front
  const figs: { x: number; base: number; h: number; robe: string; mantle: string; lit: number; arm: number; lean: number }[] = [];
  for (let i = 0; i < 3; i++) figs.push({ x: gx + (rnd() - 0.5) * 0.5, base: 0.8, h: 0.34, robe: '#3A3026', mantle: '#2A2219', lit: 0.35, arm: 0, lean: (rnd() - 0.5) * 0.15 });
  for (let i = 0; i < s.figures; i++) {
    const t = s.figures > 1 ? i / (s.figures - 1) - 0.5 : 0;
    const main = i === Math.floor(s.figures / 2);
    figs.push({
      x: gx + t * 0.55 + (rnd() - 0.5) * 0.04,
      base: 0.86 + (main ? 0.04 : 0.03 * rnd()),
      h: (main ? 0.5 : 0.4 + 0.07 * rnd()) * (1 - 0.15 * Math.abs(t)),
      robe: main ? s.robes[0] : s.robes[1 + (i % (s.robes.length - 1))],
      mantle: s.robes[(i + 3) % s.robes.length],
      lit: (main ? 1.15 : 0.95) - 0.9 * Math.abs(t) * (Math.sign(t) === L ? 0.4 : 1),
      arm: main ? L : rnd() < 0.35 ? (rnd() < 0.5 ? -1 : 1) : 0,
      lean: (rnd() - 0.5) * 0.25 - t * 0.2,
    });
  }
  // draw the main figure last so it sits in front
  const order = figs.map((_, i) => i).sort((a, b) => figs[a].base - figs[b].base || (figs[a].lit > 1 ? 1 : 0) - (figs[b].lit > 1 ? 1 : 0));
  for (const i of order) figure(g, rnd, figs[i], L);
}

function figure(g: C2D, rnd: () => number, f: { x: number; base: number; h: number; robe: string; mantle: string; lit: number; arm: number; lean: number }, L: number): void {
  const H = f.h;
  const w = H * 0.2;
  const hx = f.x + f.lean * H; // head x
  const hy = f.base - H * 0.88;
  const sh = f.base - H * 0.72;
  const k = Math.max(0.3, f.lit);
  const robe = val(f.robe, k);
  const lit = val(f.robe, Math.min(1.5, k * 1.35));
  const dark = val(f.robe, k * 0.4);
  // body: shoulders to a wide hem, drapery falling on a diagonal
  g.save();
  g.beginPath();
  g.moveTo(f.x - w * 1.15, f.base);
  g.bezierCurveTo(f.x - w * 0.95, f.base - H * 0.3, hx - w * 1.15, sh + H * 0.22, hx - w * 1.05, sh + H * 0.03);
  g.quadraticCurveTo(hx - w * 0.6, sh - H * 0.05, hx, sh - H * 0.04);
  g.quadraticCurveTo(hx + w * 0.6, sh - H * 0.05, hx + w * 1.05, sh + H * 0.03);
  g.bezierCurveTo(hx + w * 1.2, sh + H * 0.25, f.x + w * 0.9, f.base - H * 0.35, f.x + w * 1.2, f.base);
  g.quadraticCurveTo(f.x, f.base + H * 0.03, f.x - w * 1.15, f.base);
  g.closePath();
  g.fillStyle = hgrad(g, f.x - w * 1.3, f.x + w * 1.3, L < 0 ? [[0, lit], [0.5, robe], [1, dark]] : [[0, dark], [0.5, robe], [1, lit]]);
  g.fill();
  g.clip();
  // drapery diagonals: lit and shaded folds
  const dir = rnd() < 0.5 ? -1 : 1;
  for (let i = 0; i < 6; i++) {
    const y = sh + H * (0.1 + 0.8 * rnd());
    blob(g, f.x + (rnd() - 0.5) * w * 2, y, w * 0.25, H * 0.3, i % 2 ? lit : dark, 0.45, 0.2, dir * (0.5 + 0.3 * rnd()));
  }
  // a mantle crossing from one shoulder to the opposite hip
  const ms = rnd() < 0.5 ? -1 : 1;
  g.beginPath();
  g.moveTo(hx + ms * w * 0.9, sh - 0.01);
  g.lineTo(hx + ms * w * 0.1, sh);
  g.bezierCurveTo(f.x - ms * w * 0.2, f.base - H * 0.45, f.x - ms * w * 0.9, f.base - H * 0.3, f.x - ms * w * 1.4, f.base - H * 0.15);
  g.lineTo(f.x - ms * w * 1.4, f.base + 0.02);
  g.lineTo(f.x + ms * w * 1.4, f.base + 0.02);
  g.closePath();
  const mk = Math.max(0.3, f.lit * 0.95);
  g.fillStyle = hgrad(g, f.x - w * 1.3, f.x + w * 1.3, L < 0 ? [[0, val(f.mantle, mk * 1.3)], [1, val(f.mantle, mk * 0.4)]] : [[0, val(f.mantle, mk * 0.4)], [1, val(f.mantle, mk * 1.3)]]);
  g.globalAlpha = 0.92;
  g.fill();
  g.globalAlpha = 1;
  g.restore();
  // arm: a sleeve raised or held out, a hand
  if (f.arm) {
    const ax = hx + f.arm * w * 0.8;
    const tx = ax + f.arm * H * 0.22;
    const ty = sh - H * (0.08 + 0.15 * rnd());
    g.strokeStyle = val(f.robe, k * (f.arm === L ? 1.2 : 0.6));
    g.lineWidth = w * 0.45;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(ax, sh + H * 0.04);
    g.quadraticCurveTo(ax + f.arm * H * 0.1, sh + H * 0.02, tx, ty);
    g.stroke();
    blob(g, tx, ty, w * 0.22, w * 0.25, val('#C99A78', k), 0.95, 0.5);
  }
  // head: lit on the light side, hair dark
  const r = H * 0.085;
  blob(g, hx, hy, r, r * 1.2, val('#B88866', k), 1, 0.7);
  blob(g, hx + L * r * 0.35, hy - r * 0.1, r * 0.6, r * 0.75, val('#E2B694', k), 0.7, 0.2);
  blob(g, hx - L * r * 0.4, hy - r * 0.55, r * 0.95, r * 0.6, val('#3A2A1C', Math.min(1, k)), 0.85, 0.4);
}

function stillLife(g: C2D, A: number, s: StillLifeSpec): void {
  const rnd = mulberry32(s.seed);
  const L = s.cloth;
  rect(g, 0, 0, A, 1, vgrad(g, 0, 1, [[0, '#2A2018'], [0.7, '#1E1712'], [1, '#1A140E']]));
  const vx = A * (0.5 - 0.1 * L);
  blob(g, vx + L * 0.1, 0.38, 0.45, 0.42, '#5C4630', 0.6, 0.05);
  // stone ledge: lit top, front face in shade, a lit arris
  const ly = 0.72;
  rect(g, 0, ly, A, 0.04, vgrad(g, ly, ly + 0.04, [[0, '#7A6A50'], [1, '#5A4C38']]));
  rect(g, 0, ly + 0.04, A, 0.3, vgrad(g, ly + 0.04, 1, [[0, '#3E3226'], [1, '#221A12']]));
  rect(g, 0, ly + 0.038, A, 0.006, '#9A8A6A');
  // white cloth over the ledge with soft folds
  const cx0 = L < 0 ? -0.02 : A * 0.52;
  const cw = A * 0.5;
  g.save();
  g.beginPath();
  g.moveTo(cx0, ly - 0.005);
  g.lineTo(cx0 + cw, ly - 0.005);
  g.lineTo(cx0 + cw - 0.02, ly + 0.04);
  g.bezierCurveTo(cx0 + cw * 0.8, 0.9, cx0 + cw * 0.6, 0.95, cx0 + cw * 0.5, 1.02);
  g.lineTo(cx0, 1.02);
  g.closePath();
  g.fillStyle = vgrad(g, ly, 1, [[0, '#E6DCC4'], [0.2, '#CFC3A6'], [1, '#8E846C']]);
  g.fill();
  g.clip();
  for (let i = 0; i < 7; i++) blob(g, cx0 + cw * (0.08 + 0.84 * rnd()), 0.86, 0.012, 0.14, i % 2 ? '#F0E8D4' : '#9E9478', 0.5, 0.2);
  g.restore();
  // vase
  const vy = ly;
  g.beginPath();
  g.moveTo(vx - 0.035, vy);
  g.bezierCurveTo(vx - 0.1, vy - 0.06, vx - 0.08, vy - 0.17, vx - 0.03, vy - 0.2);
  g.lineTo(vx - 0.045, vy - 0.23);
  g.lineTo(vx + 0.045, vy - 0.23);
  g.lineTo(vx + 0.03, vy - 0.2);
  g.bezierCurveTo(vx + 0.08, vy - 0.17, vx + 0.1, vy - 0.06, vx + 0.035, vy);
  g.closePath();
  g.fillStyle = hgrad(g, vx - 0.09, vx + 0.09, L > 0 ? [[0, val(s.vase, 1.25)], [0.4, s.vase], [1, val(s.vase, 0.35)]] : [[0, val(s.vase, 0.35)], [0.6, s.vase], [1, val(s.vase, 1.25)]]);
  g.fill();
  blob(g, vx - L * -0.03, vy - 0.12, 0.008, 0.035, '#F4ECD8', 0.6, 0.2);
  // bouquet: leaves, then soft flower clusters, back (darker) to front (lit)
  if (s.subject !== 'fruit') {
    const bx = vx;
    const by = 0.33;
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd());
      blob(g, bx + Math.cos(a) * r * 0.2, by + Math.sin(a) * r * 0.2 + 0.03, 0.022, 0.045, rnd() < 0.5 ? '#2E3A22' : '#45502E', 0.85, 0.35, a);
    }
    const cols = ['#E8E0CC', '#D9A6A0', '#A8342A', '#D8B860', '#8E9CB0', '#C77A5A', '#F0E8D8', '#B05068'];
    const fl: [number, number, number, string][] = [];
    for (let i = 0; i < 18; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd());
      fl.push([bx + Math.cos(a) * r * 0.19, by + Math.sin(a) * r * 0.19, 0.022 + 0.022 * rnd(), cols[Math.floor(rnd() * cols.length)]]);
    }
    fl.sort((p, q) => p[2] - q[2]);
    for (const [x, y, r, c] of fl) {
      const depth = 0.55 + 0.45 * ((r - 0.022) / 0.022);
      blob(g, x, y, r * 1.1, r, val(c, 0.5 * depth), 0.9, 0.5);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + rnd();
        blob(g, x + Math.cos(a) * r * 0.45, y + Math.sin(a) * r * 0.4, r * 0.5, r * 0.42, val(c, depth * (0.85 + 0.25 * rnd())), 0.85, 0.3);
      }
      blob(g, x - L * -r * 0.3, y - r * 0.3, r * 0.4, r * 0.35, val(c, 1.25), 0.55, 0.2);
      blob(g, x, y, r * 0.18, r * 0.18, val('#6A5020', depth), 0.7, 0.3);
    }
  }
  // fruit on the ledge: peaches, a lemon, grapes hanging over the edge, on a pewter plate
  if (s.subject !== 'flowers') {
    const fx = s.subject === 'fruit' ? A * 0.5 : A * (0.5 + 0.28 * L);
    blob(g, fx, ly + 0.005, 0.16, 0.022, '#8A887E', 0.9, 0.7);
    const fruit = ['#C98A5A', '#C9B050', '#A8342A', '#7A8A3A', '#B8652A'];
    for (let i = 0; i < 5; i++) {
      const x = fx + (i - 2) * 0.055 + (rnd() - 0.5) * 0.02;
      const y = ly - 0.035 - (i % 2) * 0.025;
      const c = fruit[Math.floor(rnd() * fruit.length)];
      blob(g, x, y, 0.038, 0.035, val(c, 0.55), 1, 0.75);
      blob(g, x - L * -0.008, y - 0.006, 0.03, 0.028, c, 0.85, 0.35);
      blob(g, x - L * -0.014, y - 0.016, 0.008, 0.007, '#F4E8D0', 0.7, 0.2);
    }
    const gx = fx + L * 0.12;
    for (let i = 0; i < 14; i++) {
      const x = gx + (rnd() - 0.5) * 0.06;
      const y = ly + 0.01 + rnd() * 0.12 * (1 - Math.abs(x - gx) * 8);
      blob(g, x, y, 0.014, 0.014, '#3E2434', 1, 0.7);
      blob(g, x - L * -0.004, y - 0.004, 0.005, 0.005, '#B89AB0', 0.6, 0.2);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// finish and atlas
// ---------------------------------------------------------------------------------------------

/** Paint one composition into `g`, whose canvas is `px` × `px`, in picture units (aspect `A`). */
export function paintComposition(g: C2D, s: PaintingSpec, px: number): void {
  const A = KIND_ASPECT[s.kind];
  g.setTransform(px / A, 0, 0, px, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  if (s.kind === 'landscape') landscape(g, A, s);
  else if (s.kind === 'portrait') portrait(g, A, s);
  else if (s.kind === 'history') history(g, A, s);
  else stillLife(g, A, s);
  // brushwork: short strokes of light and dark paint following a few directions
  const rnd = mulberry32(s.seed ^ 0xb5);
  g.lineCap = 'round';
  for (let i = 0; i < 420; i++) {
    const x = A * rnd();
    const y = rnd();
    const a = (rnd() < 0.5 ? 0.6 : -0.9) + (rnd() - 0.5) * 0.6;
    const l = 0.012 + 0.025 * rnd();
    g.strokeStyle = rnd() < 0.5 ? 'rgba(255,240,210,0.05)' : 'rgba(20,12,4,0.06)';
    g.lineWidth = 0.004 + 0.006 * rnd();
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
}

/** Varnish, darkened edge and craquelure over the cell [x, y, w, h] of `g` (pixels). */
export function ageCanvas(g: C2D, x: number, y: number, w: number, h: number, seed: number): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = '#F2E2BE'; // yellowed varnish
  g.fillRect(x, y, w, h);
  const v = g.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.3, x + w / 2, y + h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(255,255,255,1)');
  v.addColorStop(1, 'rgba(150,130,100,1)');
  g.fillStyle = v;
  g.fillRect(x, y, w, h);
  g.globalCompositeOperation = 'source-over';
  // craquelure: short random-walk cracks
  const rnd = mulberry32(seed ^ 0xc4ac);
  g.strokeStyle = 'rgba(30,20,10,0.1)';
  g.lineWidth = 0.6;
  for (let i = 0; i < 70; i++) {
    let px = x + w * rnd();
    let py = y + h * rnd();
    let a = rnd() * Math.PI * 2;
    g.beginPath();
    g.moveTo(px, py);
    for (let k = 0; k < 4; k++) {
      a += (rnd() - 0.5) * 1.6;
      px += Math.cos(a) * 3;
      py += Math.sin(a) * 3;
      g.lineTo(px, py);
    }
    g.stroke();
  }
  g.restore();
}

let atlasTex: THREE.Texture | null | undefined;

/** Create a 2-D canvas (browser only). */
function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof document !== 'undefined') return Object.assign(document.createElement('canvas'), { width: w, height: h });
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}

/**
 * The atlas of all compositions (painting.ts ATLAS layout), painted once per page; null without a 2-D canvas (Node).
 */
export function paintingAtlas(): THREE.Texture | null {
  if (atlasTex !== undefined) return atlasTex;
  atlasTex = null;
  const atlas = makeCanvas(ATLAS_PX, ATLAS.rows * ATLAS.tile);
  const scratch = makeCanvas(2 * ATLAS.tile, 2 * ATLAS.tile);
  const g = atlas?.getContext('2d') as C2D | null;
  const sg = scratch?.getContext('2d') as C2D | null;
  if (!atlas || !scratch || !g || !sg) return null;
  g.fillStyle = '#1A140E';
  g.fillRect(0, 0, atlas.width, atlas.height);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  const T = ATLAS.tile;
  const G = ATLAS.gutter;
  paintingVariants().forEach((s, i) => {
    sg.setTransform(1, 0, 0, 1, 0, 0);
    sg.clearRect(0, 0, scratch.width, scratch.height);
    paintComposition(sg, s, scratch.width);
    const x = (i % ATLAS.cols) * T + G;
    const y = Math.floor(i / ATLAS.cols) * T + G;
    g.drawImage(scratch as CanvasImageSource, x, y, T - 2 * G, T - 2 * G);
    ageCanvas(g, x, y, T - 2 * G, T - 2 * G, s.seed);
  });
  const tex = new THREE.CanvasTexture(atlas as HTMLCanvasElement);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.name = 'interior.canvas.atlas';
  tex.needsUpdate = true;
  atlasTex = tex;
  return tex;
}
