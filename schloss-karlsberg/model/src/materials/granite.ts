/**
 * KB-I70: painted faux granite for `wall.granite`, the "Granitsaal" walls of the Tempelzimmer KB-B07.
 *
 * Evidence: from 1789 the room was lined with "Marmor und Granit von Papier mit Säulen und Figuren" [D T5 (Schwan
 * 2012, damage inventory T7 no. 2); R12 "Tempelzimmer (Granitsaal)"]. Nothing records the hue. Painted imitation
 * granite of the period is a mid grey ground spattered with dark, white and rose flecks (the sprinkled "granit"
 * finish of decorative painters) [N]; grain ≈ 1 cm and the fleck colours are [N], their shares [I] (chosen so the
 * mean stays close to the research/10 §c.2 suggestion #8D8580 [N]).
 *
 * The pattern is drawn in the shader on the face UVs (metres, exterior/builder.ts), so it costs no geometry; beyond
 * about two grains per pixel it fades to the flecks' mean colour, so it never aliases from afar. `graniteFlecks` is
 * the CPU twin of the GLSL (same hash, same thresholds) for tests.
 */
import type * as THREE from 'three';
import { hash12, smoothstep } from '../layout/geom.ts';

export const GRANITE = {
  /** Grain (noise cell) in metres [N sprinkled granite finish ≈ 0.5–1.5 cm]. */
  grain: 0.014,
  /** Fleck colours: dark (hornblende / mica), white (feldspar), rose (pink feldspar) [N]. */
  dark: '#36312F',
  light: '#E7E2D9',
  rose: '#B98C7E',
  /** Thresholds on the three value-noise fields [I tuned to the shares below]. */
  darkAbove: 0.74,
  lightBelow: 0.27,
  roseAbove: 0.73,
  /** Mean fleck shares of the thresholds above (measured with `graniteShares`, used for the far fade) [measured]. */
  shares: [0.15, 0.14, 0.12] as [number, number, number],
  /** Fleck opacity: painted spatter on paper is softer than real granite [I, pose 19]. */
  strength: [0.5, 0.4, 0.55] as [number, number, number],
  /** Large-scale mottling of the ground (±) [N hand-painted paper]. */
  cloud: 0.07,
  tag: 'D T5/T7 "Granit von Papier" (1789), R12 "Granitsaal"; colours and grain N (painted sprinkled granite), shares I',
} as const;

/** Hash of a lattice point (Hoskins "hash12", no sin: stable in float32 on the GPU); cells wrap every 1024. */
function hash(x: number, y: number): number {
  return hash12(x - 1024 * Math.floor(x / 1024), y - 1024 * Math.floor(y / 1024));
}

function noise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * fx;
  const b = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * fx;
  return a + (b - a) * fy;
}

/** Fleck weights [dark, light, rose] at face UV (u, v) in metres (CPU twin of `graniteFlecks` in the GLSL). */
export function graniteFlecks(u: number, v: number): [number, number, number] {
  const span = 1024 * GRANITE.grain;
  const px = (u - span * Math.floor(u / span)) / GRANITE.grain;
  const py = (v - span * Math.floor(v / span)) / GRANITE.grain;
  const n1 = noise(px, py);
  const n2 = noise(px * 0.61 + 17.3, py * 0.61 + 3.7);
  const n3 = noise(px * 1.37 + 5.1, py * 1.37 + 11.9);
  const dark = smoothstep(GRANITE.darkAbove - 0.03, GRANITE.darkAbove + 0.03, n1);
  const light = (1 - smoothstep(GRANITE.lightBelow - 0.03, GRANITE.lightBelow + 0.03, n3)) * (1 - dark);
  const rose = smoothstep(GRANITE.roseAbove - 0.03, GRANITE.roseAbove + 0.03, n2) * (1 - dark) * (1 - light);
  return [dark, light, rose];
}

/** Mean fleck shares over an n × n sample grid (test and tuning helper). */
export function graniteShares(n = 200, span = 1.3): [number, number, number] {
  const s: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const f = graniteFlecks((i / n) * span + 0.37, (j / n) * span + 1.91);
      s[0] += f[0];
      s[1] += f[1];
      s[2] += f[2];
    }
  return [s[0] / (n * n), s[1] / (n * n), s[2] / (n * n)];
}

const lin = (hex: string): string => {
  const c = parseInt(hex.slice(1), 16);
  const ch = (k: number) => {
    const x = ((c >> k) & 255) / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return `vec3( ${ch(16).toFixed(4)}, ${ch(8).toFixed(4)}, ${ch(0).toFixed(4)} )`;
};

const f = (x: number) => x.toFixed(4);

/** GLSL twin of `graniteFlecks` plus the far fade (fwidth of the grain coordinates). */
export const GRANITE_GLSL = /* glsl */ `
// lattice hash without sin (face UVs reach ~350 m = 3e4 grains; sin of such arguments is noise in float32)
float grHash( vec2 p ) {
  p = mod( p, 1024.0 );
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float grNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = mix( grHash( i ), grHash( i + vec2( 1.0, 0.0 ) ), f.x );
  float b = mix( grHash( i + vec2( 0.0, 1.0 ) ), grHash( i + vec2( 1.0, 1.0 ) ), f.x );
  return mix( a, b, f.y );
}
vec3 graniteFlecks( vec2 uv ) {
  vec2 p = mod( uv, 1024.0 * ${f(GRANITE.grain)} ) / ${f(GRANITE.grain)};
  float n1 = grNoise( p );
  float n2 = grNoise( p * 0.61 + vec2( 17.3, 3.7 ) );
  float n3 = grNoise( p * 1.37 + vec2( 5.1, 11.9 ) );
  float dark = smoothstep( ${f(GRANITE.darkAbove - 0.03)}, ${f(GRANITE.darkAbove + 0.03)}, n1 );
  float light = ( 1.0 - smoothstep( ${f(GRANITE.lightBelow - 0.03)}, ${f(GRANITE.lightBelow + 0.03)}, n3 ) ) * ( 1.0 - dark );
  float rose = smoothstep( ${f(GRANITE.roseAbove - 0.03)}, ${f(GRANITE.roseAbove + 0.03)}, n2 ) * ( 1.0 - dark ) * ( 1.0 - light );
  // grains per pixel: beyond ~2 the flecks fade to their mean shares (no aliasing from afar)
  float px = length( fwidth( p ) );
  float keep = 1.0 - smoothstep( 0.35, 1.2, px );
  return mix( vec3( ${GRANITE.shares.map(f).join(', ')} ), vec3( dark, light, rose ), keep );
}
`;

/** Patch a `wall.granite` material: flecks over the tinted ground on the face UVs (metres). Chains onBeforeCompile. */
export function granitePatch(m: THREE.Material): void {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vGraniteUv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGraniteUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vGraniteUv;\n${GRANITE_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  {
    vec3 gw = graniteFlecks( vGraniteUv );
    vec2 cuv = mod( vGraniteUv, 64.0 );
    float cloud = grNoise( cuv * 2.7 ) * 0.65 + grNoise( cuv * 7.9 + 3.1 ) * 0.35;
    diffuseColor.rgb *= 1.0 + ${f(GRANITE.cloud)} * ( 2.0 * cloud - 1.0 );
    gw *= vec3( ${GRANITE.strength.map(f).join(', ')} );
    diffuseColor.rgb = mix( diffuseColor.rgb, ${lin(GRANITE.dark)}, gw.x );
    diffuseColor.rgb = mix( diffuseColor.rgb, ${lin(GRANITE.light)}, gw.y );
    diffuseColor.rgb = mix( diffuseColor.rgb, ${lin(GRANITE.rose)}, gw.z );
  }`,
      );
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}|granite`;
}
