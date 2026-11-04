/**
 * Wave 10 (audit #4) and its review fix: the canvases of the picture rooms and the supraportes. Still placeholders, no
 * artwork (decisions log KB-I26/I27: no image of the hang survives; HMS frames excluded; real BStGS works need the
 * user's licence decision): each canvas shows one of a fixed set of procedural compositions of its genre [N 18th-c.
 * genres and old-master palette; I shapes] -
 *  - landscape: warm horizon sky with cumulus, blue distant hills with a small building, a river or lake, fields and a
 *    dark repoussoir tree group, small staffage;
 *  - portrait: a half-length sitter on a dark ground: a lit three-quarter head modelled light to shade with soft
 *    eye-socket darks and no drawn features, powdered wig, own hair, a pouf or a muslin cap, coat or gown in a muted
 *    palette, jabot or fichu, sometimes in a painted oval;
 *  - history piece: one lit group of draped figures (drapery diagonals, mantles, raised arms) against dark architecture
 *    or a dark grove, a sky opening on the light side;
 *  - still life: a stone ledge with a white cloth, a vase with a bouquet of soft-edged flower clusters, fruit -
 * under yellowed varnish with craquelure (paintingArt.ts draws them).
 *
 * Review fix (wave 10): the compositions were evaluated per pixel in the canvas shader (+1.1…1.3 ms at retina in the
 * picture galleries) although they never change. Now every composition is painted ONCE at load into a texture atlas
 * (paintingArt.ts, browser only), and the canvas shader only fetches it (one texture read + the frame's edge shadow).
 * `PaintingHang` deals the compositions out so that no wall repeats one before all of its genre have been used.
 *
 * The per-vertex attribute `aCanvas` = (atlas tile + 1, ± the tile's aspect (negative: mirrored), canvas width m,
 * canvas height m) is constant over a canvas (no flat varying); 0 = not a canvas (the vertex colour stays). A canvas
 * of another aspect than its tile shows the centred crop of the tile (cover fit). Without an atlas (Node exports,
 * tests) the canvas keeps the vertex-colour grid of finish.ts canvasGrid.
 */
import type * as THREE from 'three';
import type { CanvasKind } from './finish.ts';
import { mulberry32 } from '../layout/geom.ts';

export const CANVAS_ATTRIBUTE = 'aCanvas';
export const CANVAS_KINDS: readonly CanvasKind[] = ['landscape', 'portrait', 'history', 'stilllife'];

/** Atlas layout: `cols` × `rows` tiles of `tile` px, each with a `gutter` px dark border against mip bleeding. */
export const ATLAS = { cols: 8, rows: 8, tile: 256, gutter: 4 } as const;
export const ATLAS_PX = ATLAS.cols * ATLAS.tile;

/** Canonical aspect (w / h) each genre is painted at [N usual formats; I]. */
export const KIND_ASPECT: Readonly<Record<CanvasKind, number>> = { landscape: 1.36, portrait: 0.8, history: 1.3, stilllife: 0.84 };
/** Number of compositions per genre (sums to the atlas tile count). */
export const VARIANTS_PER_KIND: Readonly<Record<CanvasKind, number>> = { landscape: 20, portrait: 20, history: 12, stilllife: 12 };

// ---------------------------------------------------------------------------------------------
// Composition specs (pure)
// ---------------------------------------------------------------------------------------------

export type Side = -1 | 1;

export interface PortraitSpec {
  kind: 'portrait';
  sitter: 'man' | 'woman';
  /** man: powdered wig or own hair; woman: powdered pouf or muslin cap */
  head: 'wig' | 'own' | 'pouf' | 'cap';
  /** coat / gown colour (sRGB hex, muted) */
  coat: string;
  /** waistcoat / bodice ribbon accent */
  accent: string;
  /** the side the head turns to (three-quarter view) */
  turn: Side;
  /** the side the light comes from */
  light: Side;
  ground: string;
  oval: boolean;
  /** an order sash (men) or pearls (women) */
  jewel: boolean;
  seed: number;
}

export interface LandscapeSpec {
  kind: 'landscape';
  /** horizon height from the top (0…1) */
  horizon: number;
  /** side of the repoussoir tree group */
  trees: Side;
  water: 'river' | 'lake' | 'none';
  building: 'none' | 'tower' | 'temple' | 'castle';
  mood: 'morning' | 'noon' | 'evening';
  clouds: number;
  seed: number;
}

export interface HistorySpec {
  kind: 'history';
  setting: 'arcade' | 'colonnade' | 'grove';
  /** group centre (fraction of the width) */
  groupX: number;
  figures: number;
  light: Side;
  /** robe colours, the first is the lit main figure */
  robes: string[];
  seed: number;
}

export interface StillLifeSpec {
  kind: 'stilllife';
  subject: 'flowers' | 'fruit' | 'mixed';
  vase: string;
  cloth: Side;
  seed: number;
}

export type PaintingSpec = PortraitSpec | LandscapeSpec | HistorySpec | StillLifeSpec;

/** Muted 18th-c. coat colours (men): claret, slate-blue, black, olive, brown, dove-grey, bottle-green [N]. */
const COATS_MEN = ['#5E2328', '#3C4A5E', '#1E1C1A', '#4D4A2C', '#5A3B26', '#6E6A62', '#2F3D30'] as const;
/** Gown colours (women): blue-grey, dusty rose, ivory silk, sage, black, deep blue [N]. */
const GOWNS = ['#7F8C96', '#9A6F68', '#C4BAA2', '#77806A', '#22201E', '#2E3A52'] as const;
const ACCENTS = ['#D8CCA8', '#B89A58', '#9FB0B8', '#C9B98E', '#7A2A26', '#E2D8C0'];
const GROUNDS = ['#2A2119', '#33302A', '#2B2A20', '#3A2E22', '#262A26'];
const ROBES = ['#8E2A1E', '#33465E', '#C9B98E', '#6A5A2C', '#E2D7BC', '#4A2E3E', '#5E6B4A', '#A8642E'];
const VASES = ['#6B5A3A', '#CFC8B8', '#9A8E78', '#4E5A64'];

/** Tile index range of a genre: [first, count]. */
export function kindTiles(kind: CanvasKind): [number, number] {
  let first = 0;
  for (const k of CANVAS_KINDS) {
    if (k === kind) return [first, VARIANTS_PER_KIND[k]];
    first += VARIANTS_PER_KIND[k];
  }
  return [0, 0];
}

function shuffle<T>(a: T[], rnd: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * All compositions, in atlas tile order (landscapes, portraits, history pieces, still lifes). Deterministic. Portraits
 * never share a (sitter, head, coat) class, and turn and light alternate, so neighbours differ at a glance.
 */
export function paintingVariants(): PaintingSpec[] {
  const out: PaintingSpec[] = [];
  const rnd = mulberry32(0x5eed1789);
  const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
  const side = (): Side => (rnd() < 0.5 ? -1 : 1);
  const moods = ['morning', 'noon', 'evening'] as const;
  const builds = ['none', 'tower', 'temple', 'castle'] as const;
  const waters = ['river', 'lake', 'none'] as const;
  for (let i = 0; i < VARIANTS_PER_KIND.landscape; i++) {
    out.push({ kind: 'landscape', horizon: 0.55 + 0.13 * rnd(), trees: i % 2 ? 1 : -1, water: waters[i % 3], building: builds[(i + Math.floor(i / 4)) % 4], mood: moods[(i * 2 + 1) % 3], clouds: 3 + Math.floor(rnd() * 5), seed: Math.floor(rnd() * 2 ** 31) });
  }
  // portraits: distinct (sitter, head, coat) classes, men and women alternating
  const men = shuffle(
    COATS_MEN.flatMap((c) => (['wig', 'own'] as const).map((h) => ({ head: h, coat: c }))),
    rnd,
  );
  const women = shuffle(
    GOWNS.flatMap((c) => (['pouf', 'cap'] as const).map((h) => ({ head: h, coat: c }))),
    rnd,
  );
  // wigs dominate among men in the 1780s [N]: 7 wigs, 3 own hair
  const menPick = [...men.filter((m) => m.head === 'wig').slice(0, 7), ...men.filter((m) => m.head === 'own').slice(0, 3)];
  shuffle(menPick, rnd);
  const womenPick = women.slice(0, 10);
  for (let i = 0; i < VARIANTS_PER_KIND.portrait; i++) {
    const m = i % 2 === 0;
    const c = m ? menPick[i >> 1] : womenPick[i >> 1];
    const turn: Side = i % 4 < 2 ? -1 : 1;
    out.push({
      kind: 'portrait',
      sitter: m ? 'man' : 'woman',
      head: c.head,
      coat: c.coat,
      accent: pick(ACCENTS),
      turn,
      light: rnd() < 0.75 ? (-turn as Side) : turn,
      ground: GROUNDS[i % GROUNDS.length],
      oval: rnd() < 0.3,
      jewel: rnd() < 0.3,
      seed: Math.floor(rnd() * 2 ** 31),
    });
  }
  const settings = ['arcade', 'colonnade', 'grove'] as const;
  for (let i = 0; i < VARIANTS_PER_KIND.history; i++) {
    const robes = shuffle([...ROBES], rnd);
    // the lit main figure wears a light robe (white, ivory, gold) or a strong red
    const mainIdx = robes.findIndex((r) => r === ['#E2D7BC', '#C9B98E', '#8E2A1E'][Math.floor(i / 3) % 3]);
    [robes[0], robes[mainIdx]] = [robes[mainIdx], robes[0]];
    out.push({ kind: 'history', setting: settings[i % 3], groupX: 0.38 + 0.24 * rnd(), figures: 4 + Math.floor(rnd() * 4), light: side(), robes, seed: Math.floor(rnd() * 2 ** 31) });
  }
  const subjects = ['flowers', 'mixed', 'fruit'] as const;
  for (let i = 0; i < VARIANTS_PER_KIND.stilllife; i++) {
    out.push({ kind: 'stilllife', subject: subjects[i % 3], vase: VASES[i % VASES.length], cloth: i % 2 ? 1 : -1, seed: Math.floor(rnd() * 2 ** 31) });
  }
  return out;
}

/** The variation class two canvases on one wall must not share (portraits: sitter, head and coat). */
export function variantClass(s: PaintingSpec): string {
  switch (s.kind) {
    case 'portrait':
      return `p|${s.sitter}|${s.head}|${s.coat}`;
    case 'landscape':
      return `l|${s.water}|${s.building}|${s.mood}|${s.trees}`;
    case 'history':
      return `h|${s.setting}|${s.robes[0]}|${s.light}`;
    default:
      return `s|${s.subject}|${s.vase}|${s.cloth}`;
  }
}

// ---------------------------------------------------------------------------------------------
// The hang: compositions dealt out per wall (pure, deterministic)
// ---------------------------------------------------------------------------------------------

/**
 * Deals compositions to canvases: per wall and genre, a canvas takes the first composition (from a seed-chosen start)
 * not yet used on that wall; only after every composition of the genre hangs on the wall does it start over. The
 * mirror flag (from the seed) mirrors the composition left to right.
 */
export class PaintingHang {
  private used = new Map<string, Set<number>>();

  pick(wall: string, kind: CanvasKind, seed: number): { tile: number; mirror: boolean } {
    const [first, n] = kindTiles(kind);
    const key = `${wall}|${kind}`;
    let u = this.used.get(key);
    if (!u) this.used.set(key, (u = new Set()));
    if (u.size >= n) u.clear();
    const s = seed >>> 0;
    let i = s % n;
    while (u.has(i)) i = (i + 1) % n;
    u.add(i);
    return { tile: first + i, mirror: ((s >>> 9) & 1) === 1 };
  }
}

const hangs = new WeakMap<object, PaintingHang>();
/** The hang of one build (keyed by its accumulator or any object living as long as the build). */
export function hangOf(owner: object): PaintingHang {
  let h = hangs.get(owner);
  if (!h) hangs.set(owner, (h = new PaintingHang()));
  return h;
}

/** Per-canvas attribute value: atlas tile + 1, ± tile aspect (negative = mirrored), canvas width and height (m). */
export function canvasParams(kind: CanvasKind, tile: number, mirror: boolean, w: number, h: number): [number, number, number, number] {
  return [tile + 1, (mirror ? -1 : 1) * KIND_ASPECT[kind], w, h];
}

/** Atlas UV (three.js, v up, flipY texture) of canvas UV (u, v) for an `aCanvas` value: mirrors the vertex shader. */
export function atlasUv(p: readonly [number, number, number, number], u: number, v: number): [number, number] {
  const ka = Math.abs(p[1]);
  const ca = p[2] / Math.max(p[3], 1e-3);
  let qx = u - 0.5;
  let qy = v - 0.5;
  if (ca > ka) qy *= ka / ca;
  else qx *= ca / ka;
  qx += 0.5;
  qy += 0.5;
  if (p[1] < 0) qx = 1 - qx;
  const t = Math.max(p[0] - 1, 0);
  const cx = t % ATLAS.cols;
  const cy = Math.floor(t / ATLAS.cols);
  const T = ATLAS.tile;
  const G = ATLAS.gutter;
  const px = cx * T + G + qx * (T - 2 * G);
  const py = cy * T + G + (1 - qy) * (T - 2 * G);
  return [px / ATLAS_PX, 1 - py / ATLAS_PX];
}

// ---------------------------------------------------------------------------------------------
// Canvas material patch (viewer)
// ---------------------------------------------------------------------------------------------

const f = (x: number) => x.toFixed(1);

/** Patch the canvas material: the atlas tile where `aCanvas.x` > 0.5, the vertex colour elsewhere. */
export function paintingPatch(m: THREE.Material, atlas: THREE.Texture): void {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  (m as THREE.Material & { defaultAttributeValues?: Record<string, number[]> }).defaultAttributeValues = { aCanvas: [0, 1, 1, 1] };
  const T = ATLAS.tile;
  const G = ATLAS.gutter;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.skbPaintAtlas = { value: atlas };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 ${CANVAS_ATTRIBUTE};\nvarying vec2 vCanUv;\nvarying vec4 vCanvas;\nvarying vec2 vAtlasUv;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vCanUv = uv;
vCanvas = ${CANVAS_ATTRIBUTE};
{
  // cover fit of the tile's aspect onto the canvas, mirror, then the tile's cell in the atlas (painting.ts atlasUv)
  float ka = abs( ${CANVAS_ATTRIBUTE}.y );
  float ca = ${CANVAS_ATTRIBUTE}.z / max( ${CANVAS_ATTRIBUTE}.w, 1e-3 );
  vec2 q = uv - 0.5;
  if ( ca > ka ) q.y *= ka / ca; else q.x *= ca / ka;
  q += 0.5;
  if ( ${CANVAS_ATTRIBUTE}.y < 0.0 ) q.x = 1.0 - q.x;
  float t = max( ${CANVAS_ATTRIBUTE}.x - 1.0, 0.0 );
  vec2 cell = vec2( mod( t, ${f(ATLAS.cols)} ), floor( t / ${f(ATLAS.cols)} + 1e-3 ) );
  vec2 px = vec2( cell.x * ${f(T)} + ${f(G)} + q.x * ${f(T - 2 * G)}, cell.y * ${f(T)} + ${f(G)} + ( 1.0 - q.y ) * ${f(T - 2 * G)} );
  vAtlasUv = vec2( px.x, ${f(ATLAS_PX)} - px.y ) / ${f(ATLAS_PX)};
}`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D skbPaintAtlas;\nvarying vec2 vCanUv;\nvarying vec4 vCanvas;\nvarying vec2 vAtlasUv;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  if ( vCanvas.x > 0.5 ) {
    vec3 pc = texture2D( skbPaintAtlas, vAtlasUv ).rgb;
    // the frame's shadow on the canvas edge (deeper under the top rail)
    vec2 cm = vCanUv * vCanvas.zw;
    float edge = min( min( cm.x, vCanvas.z - cm.x ), min( cm.y, vCanvas.w - cm.y ) );
    pc *= mix( 0.5, 1.0, smoothstep( 0.0, 0.04, edge + 0.01 * step( 0.0, cm.y - vCanvas.w + 0.06 ) ) );
    diffuseColor.rgb = pc;
  }`,
      );
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}|painting-atlas`;
}
