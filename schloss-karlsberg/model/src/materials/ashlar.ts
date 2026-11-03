/**
 * Wave 10 (audit #3): mixed dressed sandstone in the viewer's stone shader. Red Buntsandstein surfaces whose catalogue
 * colour is listed in `STONE_MIX.colours` (plinths, the Orangerie's high basement, terrace and retaining walls, steps
 * cut from the plinth stone) read per block as red / yellow-red, yellow-grey or grey-white stone, with recessed joints
 * on the ashlar texture's own course grid (exterior/shade.ts ASHLAR: 0.36 m courses, the drawn vertical joints), so the
 * blocks agree with the texture and with the LOD2 vertex block tints at every LOD [research/09 §1 item 5, §3.7, M5;
 * I mix]. The joints are pixel-filtered (they fade to their mean coverage from afar, no moiré). Cheap: a hash and a
 * few compares on stone fragments only. Evidence and amplitudes: exterior/shade.ts STONE_MIX.
 */
import * as THREE from 'three';
import { ASHLAR, RETAINING_ASHLAR, STONE_MIX, hexLinear, linearLuma, stoneMixTints } from '../exterior/shade.ts';

const f = (x: number) => x.toFixed(5);
const v3 = (c: readonly number[]) => `vec3( ${c.map(f).join(', ')} )`;

/** Joint table of the ashlar image (u fractions per course, padded with 2.0) as GLSL vec4s. */
function jointRows(): string {
  return ASHLAR.joints.map((row) => `vec4( ${[0, 1, 2, 3].map((i) => f(row[i] ?? 2)).join(', ')} )`).join(', ');
}

/** Is `colour` (normalised hex) drawn as mixed dressed stone? */
export function isMixedAshlar(colour: string | undefined): boolean {
  return !!colour && STONE_MIX.colours.includes(colour.toUpperCase());
}

/** Course scale of a mixed-stone colour: retaining walls are laid in larger courses (shade.ts RETAINING_ASHLAR). */
function ashlarScale(colour: string): number {
  return colour.toUpperCase() === RETAINING_ASHLAR.colour ? RETAINING_ASHLAR.courseScale : 1;
}

/** Patch a `stone.red` material of a mixed-stone colour. Chains onBeforeCompile (after lumaPatch, before shadePatch). */
export function ashlarPatch(m: THREE.Material, base: string): void {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  const t = stoneMixTints(base);
  const k = ashlarScale(base);
  // the red blocks desaturated toward their own luminance (wave-10 review: red-brown, not orange-red)
  const bl = hexLinear(base);
  const yb = linearLuma(bl);
  const desat = bl.map((c) => 1 + (yb / Math.max(1e-4, c) - 1) * STONE_MIX.redDesat);
  const J = STONE_MIX.joint;
  const S = STONE_MIX.shares;
  const nRows = ASHLAR.joints.length;
  const counts = ASHLAR.joints.map((r) => r.length);
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    // wave-10 review: the photo's own block-to-block value steps damped, so the joints and the subtle hue mix carry the
    // coursing instead of a light / dark checkerboard
    if (sh.uniforms.uMapContrast) sh.uniforms.uMapContrast = { value: STONE_MIX.textureContrast };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vAshUv;').replace('#include <begin_vertex>', `#include <begin_vertex>\nvAshUv = uv / ${f(k)};`);
    // larger courses: the texture maps scale with the joint grid
    if (k !== 1)
      sh.vertexShader = sh.vertexShader.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
#ifdef USE_MAP
  vMapUv = ( mapTransform * vec3( uv / ${f(k)}, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
  vNormalMapUv = ( normalMapTransform * vec3( uv / ${f(k)}, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
  vRoughnessMapUv = ( roughnessMapTransform * vec3( uv / ${f(k)}, 1 ) ).xy;
#endif`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vAshUv;
float ashHash( vec3 p ) { p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) ); p += dot( p, p.yxz + 33.33 ); return fract( ( p.x + p.y ) * p.z ); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  {
    // tile coordinates of the ashlar image (u along the face, v = height), its course and the block in the course
    vec2 au = vAshUv / vec2( ${f(ASHLAR.tile)}, ${f(ASHLAR.tileV)} );
    float cq = au.y * ${nRows.toFixed(1)};
    float cy = floor( cq );
    float row = cy - ${nRows.toFixed(1)} * floor( cy / ${nRows.toFixed(1)} );
    vec4 J[ ${nRows} ] = vec4[ ${nRows} ]( ${jointRows()} );
    float N[ ${nRows} ] = float[ ${nRows} ]( ${counts.map((c) => c.toFixed(1)).join(', ')} );
    int ri = int( row + 0.5 );
    vec4 jr = J[ ri ];
    float fx = fract( au.x );
    float tx = floor( au.x );
    vec4 past = step( jr, vec4( fx ) );
    float bi = past.x + past.y + past.z + past.w;
    // the block before a tile's first joint continues the last block of the tile before (as exterior/shade.ts ashlarBlocks)
    if ( bi < 0.5 ) { tx -= 1.0; bi = N[ ri ]; }
    float h = ashHash( vec3( tx, cy, bi ) + 17.0 );
    float h2 = ashHash( vec3( bi, tx, cy ) + 41.0 );
    vec3 tint = vec3( 1.0 );
    if ( h < ${f(S.red)} ) tint = mix( ${v3(desat)}, ${v3(t.yellowGrey)}, ${f(STONE_MIX.redToYellow)} * h2 * h2 );
    else if ( h < ${f(S.red + S.yellowGrey)} ) tint = ${v3(t.yellowGrey)};
    else tint = ${v3(t.greyWhite)};
    tint *= 1.0 + ${f(STONE_MIX.value)} * ( 2.0 * ashHash( vec3( cy, bi, tx ) + 5.0 ) - 1.0 );
    // recessed joints: bed joints at the course lines, head joints at the drawn joints; pixel-filtered
    vec4 dj = abs( jr - fx ) * ${f(ASHLAR.tile)};
    float dh = min( min( dj.x, dj.y ), min( dj.z, dj.w ) );
    float dv = min( fract( cq ), 1.0 - fract( cq ) ) * ${f(ASHLAR.course)};
    float fwh = max( fwidth( vAshUv.x ), 1e-5 );
    float fwv = max( fwidth( vAshUv.y ), 1e-5 );
    float jw = ${f(J.halfWidth)};
    float lh = ( 1.0 - smoothstep( jw - 0.5 * fwh, jw + 0.5 * fwh, dh ) ) * min( 1.0, 2.0 * jw / fwh );
    float lv = ( 1.0 - smoothstep( jw - 0.5 * fwv, jw + 0.5 * fwv, dv ) ) * min( 1.0, 2.0 * jw / fwv );
    float joint = max( lh, lv );
    // the lit arris: the top edge of the block below a bed joint catches the light
    float up = ( 1.0 - fract( cq ) ) * ${f(ASHLAR.course)};
    float aw = ${f(J.arris.width)};
    float ar = ( smoothstep( jw - 0.5 * fwv, jw + 0.5 * fwv, up ) - smoothstep( jw + aw - 0.5 * fwv, jw + aw + 0.5 * fwv, up ) ) * min( 1.0, aw / fwv ) * ( 1.0 - lh );
    diffuseColor.rgb *= tint * mix( 1.0, ${f(J.albedo)}, joint ) * ( 1.0 + ${f(J.arris.gain - 1)} * ar );
  }`,
      );
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}|ashlar${base}`;
}
