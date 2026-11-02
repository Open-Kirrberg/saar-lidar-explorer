/**
 * Procedural Katzenkopf cobbles for the Ehrenhof carriage lanes (KB-I23, wave-4 review).
 *
 * The wave-4 lanes used the photo set behind `ground.cobbles` (large red flags) stretched to "setts": from eye level it
 * read as modern concrete pavers, near-black in shade and sky-blue at dusk. The period norm is small rounded field
 * stones (Katzenköpfe, ≈ 0.10–0.15 m) set in sand in rows across the track, framed by dressed sandstone edging
 * [N research/09 §5 "cobbled (Katzenkopf) carriage lanes"; sizes COURT_FURNITURE.lane, N]. The hues are local
 * Buntsandstein and grey-yellow sandstone, kept a little darker than the court sand [I].
 *
 * Geometry carries one extra attribute `aLane` = (across m from the centre line, along m from the start, half width m,
 * length m), so the stones keep their size on lanes of any width. The shader draws (no texture fetches):
 *  - cobbles: a row-structured Voronoi (rows across the track, a random offset per row, jittered centres), each stone a
 *    low dome (tilted normal, darker toward the joint), sand in the joints;
 *  - edging: dressed sandstone kerb blocks (0.25 m wide, 0.75 m long) along both sides and the ends;
 *  - sand spill: court sand drifted over the edging and the outer stones (value noise), so the edge reads soft;
 *  - distance fade: below ≈ 3 px per stone the pattern fades to its mean colour and a flat normal (no shimmer).
 * Pure helpers (`laneZone`) mirror the GLSL band logic for tests.
 */
import * as THREE from 'three';
import { COURT_FURNITURE } from '../layout/grammar.ts';

/** Albedo hues (sRGB) [N local sandstone; I values tuned against the court sand #C9B48E]. */
export const COBBLE_COLOURS = {
  /** grey-yellow sandstone cobble */
  a: '#BDA884',
  /** reddish Buntsandstein cobble */
  b: '#B29A80',
  /** sand in the joints (court sand, a little darker in the crevice) */
  joint: '#A38D69',
  /** dressed edging stone */
  edge: '#C6B08B',
  /** court sand drifted over the edge (= terrain court sand) */
  sand: '#C9B48E',
} as const;

export type LaneZone = 'cobble' | 'edge';

/** Which band of a lane a point falls in (mirrors the GLSL): edging within `edge` m of a side or an end. */
export function laneZone(across: number, along: number, halfWidth: number, length: number, edge: number = COURT_FURNITURE.lane.edge): LaneZone {
  const dSide = halfWidth - Math.abs(across);
  const dEnd = Math.min(along, length - along);
  return dSide < edge || dEnd < edge ? 'edge' : 'cobble';
}

const GLSL_COMMON = /* glsl */ `
varying vec4 vLane;
uniform vec3 uCobA;
uniform vec3 uCobB;
uniform vec3 uCobJoint;
uniform vec3 uCobEdge;
uniform vec3 uCobSand;
vec3 cobN = vec3( 0.0, 0.0, 1.0 );
float cobPolish = 0.0;
float cobHash( vec2 p ) {
  p = fract( p * vec2( 123.34, 456.21 ) );
  p += dot( p, p + 45.32 );
  return fract( p.x * p.y );
}
float cobNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( cobHash( i ), cobHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( cobHash( i + vec2( 0.0, 1.0 ) ), cobHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
`;

function fragColour(): string {
  const L = COURT_FURNITURE.lane;
  const f = (x: number) => x.toFixed(4);
  return /* glsl */ `
  {
    vec2 p = vLane.xy; // across, along (m)
    // pattern scale in metres per pixel, from uniform control flow (derivatives)
    float fw = length( fwidth( p ) );
    float detail = 1.0 - smoothstep( 0.03, 0.1, fw );
    float dSide = vLane.z - abs( p.x );
    float dEnd = min( p.y, vLane.w - p.y );
    float dEdge = min( dSide, dEnd );
    vec3 col;
    vec2 tilt = vec2( 0.0 );
    float ao = 1.0;
    if ( dEdge < ${f(L.edge)} ) {
      // dressed edging blocks along the side (or across an end)
      bool side = dSide < dEnd;
      float u = ( side ? p.y : p.x + 50.0 ) + 0.37 * cobHash( vec2( sign( p.x ), side ? 7.0 : 11.0 ) );
      float k = floor( u / 0.75 );
      float uu = u - k * 0.75;
      float j = min( uu, 0.75 - uu );
      float h = cobHash( vec2( k, side ? 3.0 + sign( p.x ) : 5.0 ) );
      col = uCobEdge * ( 0.9 + 0.18 * h );
      col = mix( uCobJoint * 0.85, col, smoothstep( 0.004, 0.012, j ) );
      // arris: darker toward the block joints and both long edges
      float inner = ${f(L.edge)} - dEdge;
      ao = mix( 0.82, 1.0, smoothstep( 0.0, 0.03, min( j, min( inner, dEdge ) ) ) );
    } else {
      // Katzenkopf rows across the track: row-structured Voronoi, F1 / F2
      float R = ${f(L.row)};
      float C = ${f(L.stone)};
      float row = floor( p.y / R );
      float f1 = 9.0;
      float f2 = 9.0;
      vec2 d1 = vec2( 0.0 );
      float id = 0.0;
      for ( int dr = -1; dr <= 1; dr ++ ) {
        float r = row + float( dr );
        float off = cobHash( vec2( r, 3.1 ) ) * C;
        float cx = floor( ( p.x + off ) / C );
        for ( int dc = -1; dc <= 1; dc ++ ) {
          float c = cx + float( dc );
          float hx = cobHash( vec2( c, r ) );
          float hy = cobHash( vec2( r, c + 17.0 ) );
          vec2 ctr = vec2( ( c + 0.5 + ( hx - 0.5 ) * 0.45 ) * C - off, ( r + 0.5 + ( hy - 0.5 ) * 0.3 ) * R );
          vec2 dv = p - ctr;
          float d = length( dv * vec2( 1.0, C / R ) );
          if ( d < f1 ) {
            f2 = f1;
            f1 = d;
            d1 = dv;
            id = hx + hy * 7.0;
          } else if ( d < f2 ) {
            f2 = d;
          }
        }
      }
      float gap = f2 - f1; // ≈ twice the distance to the joint line
      float rad = 0.5 * C;
      float hs = fract( id * 13.7 );
      col = mix( uCobA, uCobB, step( 0.72, hs ) ) * ( 0.86 + 0.26 * fract( id * 5.3 ) );
      float stone = smoothstep( 0.014, 0.034, gap );
      col = mix( uCobJoint, col, stone );
      // low dome: the normal tilts away from the stone centre, steeper toward its rim
      tilt = d1 / rad * 0.32 * stone;
      ao = mix( 0.78, 1.0, smoothstep( 0.0, 0.05, gap ) );
    }
    // court sand drifted over the edging and the outer stones (and a little everywhere)
    float n = cobNoise( p * 3.1 ) * 0.65 + cobNoise( p * 11.0 ) * 0.35;
    float spill = clamp( ( 1.0 - smoothstep( 0.0, 0.5, dEdge ) ) * 1.1 * n + 0.1 * n, 0.0, 0.85 );
    col = mix( col * ao, uCobSand, spill );
    tilt *= 1.0 - spill;
    // KB-I45 (wave 7): the iron tyres wear the stones of the wheel tracks flatter, the hooves leave dust between them
    float wheel = ( 1.0 - smoothstep( 0.15, 0.45, abs( abs( p.x ) - 0.75 ) ) ) * step( 1.3, vLane.z );
    float hoof = ( 1.0 - smoothstep( 0.2, 0.45, abs( p.x ) ) ) * step( 1.3, vLane.z );
    tilt *= 1.0 - 0.55 * wheel;
    col = mix( col, uCobSand, 0.2 * hoof * n );
    // KB-I45 (wave 8): the tyre-polished stone tops of the wheel tracks: darker and greyer (iron and grease), smoother
    // and less rough, so they catch a soft sheen; the sand stays in the joints [I]
    cobPolish = wheel * ( 1.0 - spill );
    col = mix( col, col * vec3( 0.8, 0.79, 0.78 ), 0.75 * cobPolish );
    // far away: the mean colour, flat
    vec3 meanCol = mix( mix( mix( uCobA, uCobB, 0.28 ) * 0.97, uCobJoint, 0.15 ), uCobSand, spill );
    col = mix( meanCol, col, detail );
    // large-scale wear: two compacted wheel tracks along the lane and a faint mottling (also from the air)
    float track = 1.0 - 0.08 * ( 1.0 - smoothstep( 0.15, 0.45, abs( abs( p.x ) - 0.75 ) ) ) * step( 1.3, vLane.z );
    cobPolish *= detail;
    diffuseColor.rgb = col * track * ( 0.95 + 0.1 * cobNoise( p * 0.7 ) );
    cobN = normalize( vec3( tilt * detail, 1.0 ) );
  }`;
}

/** View-space normal from the lane frame (across, along, up) with a cotangent frame from derivatives. */
const FRAG_NORMAL = /* glsl */ `
  {
    vec3 dpx = dFdx( - vViewPosition );
    vec3 dpy = dFdy( - vViewPosition );
    vec2 dux = dFdx( vLane.xy );
    vec2 duy = dFdy( vLane.xy );
    vec3 N0 = normal;
    vec3 dp2perp = cross( dpy, N0 );
    vec3 dp1perp = cross( N0, dpx );
    vec3 T = dp2perp * dux.x + dp1perp * duy.x;
    vec3 B = dp2perp * dux.y + dp1perp * duy.y;
    float inv = inversesqrt( max( max( dot( T, T ), dot( B, B ) ), 1e-12 ) );
    normal = normalize( T * inv * cobN.x + B * inv * cobN.y + N0 * cobN.z );
  }`;

/**
 * Patch a MeshStandardMaterial into the cobble shader (no maps; the geometry must carry `aLane`). Colours are sRGB hex,
 * converted to linear uniforms. Sets `userData.groundLit` so the viewer lights it like the terrain (SH sky diffuse, no
 * PMREM), which keeps it warm at dusk like the court sand around it.
 */
export function cobblePatch(m: THREE.MeshStandardMaterial, colours: typeof COBBLE_COLOURS = COBBLE_COLOURS): void {
  const lin = (hex: string) => new THREE.Color(hex);
  const uniforms = {
    uCobA: { value: lin(colours.a) },
    uCobB: { value: lin(colours.b) },
    uCobJoint: { value: lin(colours.joint) },
    uCobEdge: { value: lin(colours.edge) },
    uCobSand: { value: lin(colours.sand) },
  };
  m.map = null;
  m.normalMap = null;
  m.roughnessMap = null;
  m.color.set('#ffffff');
  m.roughness = 0.93;
  m.metalness = 0;
  m.envMapIntensity = 0;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -4;
  m.userData.groundLit = true;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = `attribute vec4 aLane;\nvarying vec4 vLane;\n${sh.vertexShader}`.replace('#include <uv_vertex>', '#include <uv_vertex>\n  vLane = aLane;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_COMMON}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${fragColour()}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_NORMAL}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix( roughnessFactor, 0.5, cobPolish );');
  };
  m.customProgramCacheKey = () => 'cobbles-v3';
  m.needsUpdate = true;
}
