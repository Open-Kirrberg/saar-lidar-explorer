/**
 * Exponential height fog (backlog KB-I07, visual-audit §5.4 level 1), pure maths shared by the GLSL chunk in
 * atmosphere.ts and the tests. Density ρ(h) = a · exp(−b · (h − h0)), integrated analytically along the view ray
 * (Quilez, "Better fog", https://iquilezles.org/articles/fog/).
 *
 * Values [I], tuned on poses 01, 08, 09, 10, 14: the palace from view-west (≈ 250 m) ≈ 5 % hazed, the edge of the
 * 2.1 × 2.6 km terrain crop (1.5–2.5 km) about half hazed so it melts into the sky colour, scale height ≈ 450 m above
 * the plateau (h0 = 345 m, the Ehrenhof level). Morning mist adds a thin, dense layer near the valley floors at 05–09 h.
 */

export interface FogParams {
  /** extinction at h0 (1/m) */
  a: number;
  /** height falloff (1/m) = 1 / scale height */
  b: number;
  /** reference height (m) */
  h0: number;
  /**
   * distance (m) over which the extinction doubles: a mild superlinear growth stands in for the haze layers beyond the
   * terrain crop (the real horizon is 5–8 km away), so near views stay clear while the crop edge melts into the sky
   */
  grow: number;
}

export const FOG_H0 = 345;

/**
 * Haze over the day [I]: denser in the morning (dew, mist) and at the golden hour (dust, humidity). The morning mist
 * holds its full strength (×1.6, scale height 250 m) from 5:30 to 7:30 and fades out by 4:00 and 9:00 (wave-1 review,
 * pose 02 at 07:00: the mist had already half gone).
 */
export function fogFor(hour: number): FogParams {
  const morning = Math.min(1, Math.max(0, Math.min(hour - 4, 9 - hour) / 1.5)); // 4:00–9:00, plateau 5:30–7:30
  const evening = Math.max(0, 1 - Math.abs(hour - 19.5) / 2); // 17:30–21:30
  return { a: 1.9e-4 * (1 + 0.6 * morning + 0.35 * evening), b: 1 / (450 - 200 * morning), h0: FOG_H0, grow: 1600 };
}

/** Optical depth along a ray from height `camY` with direction y-component `dy` (unit vector) over distance `t`. */
export function opticalDepth(p: FogParams, camY: number, dy: number, t: number): number {
  const k = p.b * dy * t;
  const f = Math.abs(k) > 1e-4 ? (1 - Math.exp(-k)) / k : 1 - 0.5 * k;
  return p.a * Math.exp(-p.b * (camY - p.h0)) * t * f * (1 + t / p.grow);
}

/** Fog amount (0…1) between a camera at `camY` and a point `dist` metres away at height `targetY`. */
export function fogAmount(p: FogParams, camY: number, targetY: number, dist: number): number {
  const dy = dist > 0 ? (targetY - camY) / dist : 0;
  return 1 - Math.exp(-opticalDepth(p, camY, dy, dist));
}

/** GLSL for the fog chunks; uniform `uFog[4]`: [a, b, on, h0], [sunDir, inscatter power], [haze colour, grow], sun-side colour. */
export const FOG_GLSL = {
  pars_vertex: /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogRay;
#endif`,
  vertex: /* glsl */ `
#ifdef USE_FOG
  // camera-to-vertex ray in world orientation (view rotation transposed), no large world numbers
  vFogRay = transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
#endif`,
  pars_fragment: /* glsl */ `
#ifdef USE_FOG
  uniform vec4 uFog[ 4 ];
  varying vec3 vFogRay;
#endif`,
  /** applied before tone mapping (prepended to tonemapping_fragment), in pre-exposed linear radiance */
  apply: /* glsl */ `
#ifdef USE_FOG
  {
    float fogD = length( vFogRay );
    vec3 fogRd = vFogRay / max( fogD, 1e-3 );
    float fogK = uFog[ 0 ].y * fogRd.y * fogD;
    float fogF = abs( fogK ) > 1e-4 ? ( 1.0 - exp( - fogK ) ) / fogK : 1.0 - 0.5 * fogK;
    float fogOd = uFog[ 0 ].x * exp( - uFog[ 0 ].y * ( cameraPosition.y - uFog[ 0 ].w ) ) * fogD * fogF * ( 1.0 + fogD / uFog[ 2 ].w );
    float fogAmt = ( 1.0 - exp( - fogOd ) ) * uFog[ 0 ].z;
    float fogSun = pow( max( dot( fogRd, uFog[ 1 ].xyz ), 0.0 ), uFog[ 1 ].w );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( uFog[ 2 ].rgb, uFog[ 3 ].rgb, fogSun ), fogAmt );
  }
#endif
`,
};
