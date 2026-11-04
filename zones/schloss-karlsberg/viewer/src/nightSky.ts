/**
 * Night sky (audit wave 9, rank 5): the stars brighter than V 5.0 (HYG 4.4, CC BY-SA 4.0; starCatalogue.ts) at their 1789
 * places and the moon disc at its computed phase (ephemeris.ts). Both are drawn only at night (sun below −2°), so
 * every day frame stays byte-identical; the moonlight itself is the sun's directional light turned toward the moon
 * (atmosphere.ts `Atmosphere.update(…, moon)`), so it casts shadows through the existing near and far maps.
 *
 * Brightness is physical and then pre-exposed like everything else: a star of V magnitude m gives
 * 2.54 µlx · 10^(−0.4 (m + k X)) at the ground (k = 0.25 mag per air mass X, ephemeris.ts), spread over a small
 * point-spread spot of a few pixels (the eye's and a lens's blur; energy kept), so the stars fade with the twilight sky
 * by themselves. The moon's surface radiance follows the Lommel–Seeliger law (no limb darkening, as the full moon
 * looks) with an albedo of 0.12, and its maria are darker discs at their selenographic places [D-> from lunar maps,
 * shapes I]. The disc's display value is capped (MOON_DISPLAY_CAP): the eye adapts locally to the moon and still
 * sees the maria, which a linear exposure for the moonlit land would clip to a white blob [I, art direction].
 * Cost: 1,604 points and one 2-triangle quad, two draw calls, at night only.
 *
 * Wave-10 review fix (60: "few and faint stars, no Milky Way on a moonless July night of 1789"): the star gain is
 * raised (STAR_SPOT.gain 6 → 9) and a procedural Milky Way band is drawn behind the stars: brightness as a function
 * of galactic longitude and latitude in the IAU galactic frame (the J2000 → galactic rotation of the Hipparcos
 * catalogue, ESA SP-1200 vol. 1 §1.5.3 [D]), with the central bulge toward Sagittarius, the Cygnus star cloud, the
 * Great Rift and value-noise clumps (shape [I]; no image or survey data, so no licence to audit). Its surface
 * brightness at the brightest star clouds is MILKY_WAY.peakCd (≈ 20.7 mag/arcsec² [D-> typical photometry of the
 * Sagittarius and Cygnus star clouds]) lifted like the sky (MILKY_WAY.lift = the never-black night floor of light.ts
 * over a real moonless sky), so the twilight and the moon wash it out by themselves. One sphere, one draw call, night only.
 */
import * as THREE from 'three';
import { clamp, smoothstep } from '@model/layout/geom.ts';
import { STARS, STAR_COUNT } from './starCatalogue.ts';
import { type MoonState, NIGHT_EXTINCTION_MAG, equatorialToLocalMatrix, precessionMatrix } from './ephemeris.ts';
import { kelvinLinear } from './light.ts';

/**
 * Star spots [I, art direction]: diameter (px) of the smallest spot, the largest, the display value above which a
 * bright star's spot grows instead of brightening, and `gain`, the perceptual lift of a point source: the eye sees a
 * star as a point whose whole flux lands on a few receptors, while a display spreads it over 2–3 pixels at the
 * (raised, never-black) night sky level of light.ts (NIGHT_FLOOR_LUX 0.03 lx against ≈ 0.002 lx of a real moonless
 * sky); ×9 (wave-10 review fix, was ×6) lets V 4–5 stars read at 23:00 as they do to the dark-adapted eye under a sky
 * without light pollution.
 */
export const STAR_SPOT = { minPx: 1.6, maxPx: 6, peak: 2.5, gain: 9 } as const;
/**
 * Radius of the moon's aureole in moon radii, and its strength relative to the capped disc [I]: forward scattering by
 * the summer haze makes a faint glow a few moon diameters wide round the bright moon.
 */
export const MOON_HALO_R = 7;
export const MOON_HALO = 0.06;
/** Display cap of the moon disc (local adaptation, see the file note) [I]. */
export const MOON_DISPLAY_CAP = 3;
/** Geometric albedo used for the lunar surface radiance (Lommel–Seeliger) [I; Bond albedo ≈ 0.12]. */
export const MOON_ALBEDO = 0.12;

/**
 * J2000 equatorial (ICRS) unit vector → galactic unit vector (x toward the galactic centre, z to the north galactic
 * pole), rows of A_G′ (Hipparcos, ESA SP-1200 vol. 1 §1.5.3) [D].
 */
export const GALACTIC_FROM_J2000: readonly number[] = [
  -0.0548755604162154, -0.873437090234885, -0.4838350155487132,
  0.4941094278755837, -0.4448296299600112, 0.7469822444972189,
  -0.8676661490190047, -0.1980763734312015, 0.4559837761750669,
];

/** Galactic longitude and latitude (deg) of a J2000 place (deg). */
export function galactic(raDeg: number, decDeg: number): { l: number; b: number } {
  const r = (raDeg * Math.PI) / 180;
  const d = (decDeg * Math.PI) / 180;
  const v = [Math.cos(d) * Math.cos(r), Math.cos(d) * Math.sin(r), Math.sin(d)];
  const m = GALACTIC_FROM_J2000;
  const x = m[0] * v[0] + m[1] * v[1] + m[2] * v[2];
  const y = m[3] * v[0] + m[4] * v[1] + m[5] * v[2];
  const z = m[6] * v[0] + m[7] * v[1] + m[8] * v[2];
  return { l: (Math.atan2(y, x) * 180) / Math.PI, b: (Math.asin(clamp(z, -1, 1)) * 180) / Math.PI };
}

/**
 * The Milky Way band [I shapes, D frame]: peak surface brightness (cd/m², real) of the brightest star clouds, the lift
 * applied like the night sky floor (light.ts NIGHT_FLOOR_LUX 0.03 lx over ≈ 0.002 lx), band half-widths (deg), the
 * Great Rift (latitude, width, depth, longitude span) and the Cygnus cloud (longitude, width, extra).
 */
export const MILKY_WAY = {
  peakCd: 3e-4,
  lift: 15,
  width: 4.5,
  bulge: 5.5,
  rift: { b: 1.8, w: 1.8, depth: 0.55, l0: 8, l1: 85 },
  cygnus: { l: 75, w: 18, k: 0.35 },
} as const;

/** Smooth part of the Milky Way brightness (0…≈1.2) at galactic l, b (deg); the GLSL adds clumps (value noise). */
export function milkyWayProfile(l: number, b: number): number {
  const mw = MILKY_WAY;
  const al = Math.abs(l);
  const sig = mw.width + mw.bulge * Math.exp(-(al * al) / 900);
  const band = Math.exp((-0.5 * b * b) / (sig * sig));
  const lon = 0.3 + 0.7 * Math.pow(0.5 + 0.5 * Math.cos((l * Math.PI) / 180), 1.5) + mw.cygnus.k * Math.exp(-(((l - mw.cygnus.l) / mw.cygnus.w) ** 2));
  const rift = 1 - mw.rift.depth * Math.exp(-(((b - mw.rift.b) / mw.rift.w) ** 2)) * smoothstep(mw.rift.l0, mw.rift.l0 + 10, l) * (1 - smoothstep(mw.rift.l1 - 15, mw.rift.l1, l));
  return band * lon * rift;
}

/** Colour temperature of a star from its B−V index (Ballesteros 2012, EPL 97, 34008) [D]. */
export function starKelvin(bv: number): number {
  const b = clamp(bv, -0.4, 2);
  return 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
}

/**
 * Star spot size (px) and peak display value for a total display "energy" `d` (display value × pixel solid angle,
 * divided by the pixel solid angle: what the star would show if it filled one pixel).
 */
export function starSpot(d: number): { size: number; peak: number } {
  // a Gaussian spot of diameter s (≈ 2σ·1.6) holds ≈ 0.55 s² × its peak
  const area = (s: number): number => 0.55 * s * s;
  let s: number = STAR_SPOT.minPx;
  if (d / area(s) > STAR_SPOT.peak) s = Math.min(STAR_SPOT.maxPx, Math.sqrt(d / (0.55 * STAR_SPOT.peak)));
  return { size: s, peak: d / area(s) };
}

const STAR_VERT = /* glsl */ `
attribute float aMag;
attribute vec3 aCol;
uniform mat3 uRot;
uniform float uPre;
uniform float uPxSr;
uniform float uPxScale;
varying vec3 vCol;
void main() {
  vec3 d = uRot * position;
  float alt = asin( clamp( d.y, -1.0, 1.0 ) ) * 57.29578;
  // relative air mass (Kasten & Young 1989)
  float X = 1.0 / ( max( d.y, 0.0 ) + 0.50572 * pow( max( alt, 0.0 ) + 6.07995, -1.6364 ) );
  float E = 2.54e-6 * pow( 10.0, -0.4 * ( aMag + ${NIGHT_EXTINCTION_MAG.toFixed(3)} * X ) );
  float D = ${STAR_SPOT.gain.toFixed(1)} * E * uPre / uPxSr; // display value if the star filled one pixel
  float s = ${STAR_SPOT.minPx.toFixed(2)};
  if ( D / ( 0.55 * s * s ) > ${STAR_SPOT.peak.toFixed(2)} ) s = min( ${STAR_SPOT.maxPx.toFixed(1)}, sqrt( D / ( 0.55 * ${STAR_SPOT.peak.toFixed(2)} ) ) );
  vCol = aCol * ( D / ( 0.55 * s * s ) ) * smoothstep( -0.01, 0.02, d.y );
  gl_PointSize = s * uPxScale;
  vec4 v = viewMatrix * vec4( d, 0.0 );
  gl_Position = projectionMatrix * v;
  gl_Position.z = gl_Position.w; // far plane, behind everything (as the sky dome)
  if ( d.y < -0.02 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
}`;

const STAR_FRAG = /* glsl */ `
varying vec3 vCol;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot( p, p );
  if ( r2 > 1.0 ) discard;
  gl_FragColor = vec4( vCol * exp( -3.2 * r2 ), 1.0 );
}`;

const MW_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * ( viewMatrix * vec4( position, 0.0 ) );
  gl_Position.z = gl_Position.w;
}`;

const MW_FRAG = /* glsl */ `
uniform mat3 uGal;
uniform float uLevel;
uniform vec3 uColour;
varying vec3 vDir;
float skbMwHash( vec2 p ) {
  uint n = uint( int( p.x ) ) * 374761393u + uint( int( p.y ) ) * 668265263u;
  n = ( n ^ ( n >> 13u ) ) * 1274126177u;
  n = n ^ ( n >> 16u );
  return float( n ) * ( 1.0 / 4294967296.0 );
}
float skbMwNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( skbMwHash( i ), skbMwHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( skbMwHash( i + vec2( 0.0, 1.0 ) ), skbMwHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
void main() {
  vec3 d = normalize( vDir );
  if ( d.y < -0.02 ) discard;
  vec3 g = uGal * d;
  float b = asin( clamp( g.z, -1.0, 1.0 ) ) * 57.29578;
  if ( abs( b ) > 35.0 ) discard;
  float l = atan( g.y, g.x ) * 57.29578;
  float al = abs( l );
  float sig = ${MILKY_WAY.width.toFixed(2)} + ${MILKY_WAY.bulge.toFixed(2)} * exp( -al * al / 900.0 );
  float band = exp( -0.5 * b * b / ( sig * sig ) );
  float lon = 0.3 + 0.7 * pow( 0.5 + 0.5 * cos( radians( l ) ), 1.5 ) + ${MILKY_WAY.cygnus.k.toFixed(2)} * exp( -pow( ( l - ${MILKY_WAY.cygnus.l.toFixed(1)} ) / ${MILKY_WAY.cygnus.w.toFixed(1)}, 2.0 ) );
  float rift = 1.0 - ${MILKY_WAY.rift.depth.toFixed(2)} * exp( -pow( ( b - ${MILKY_WAY.rift.b.toFixed(2)} ) / ${MILKY_WAY.rift.w.toFixed(2)}, 2.0 ) ) * smoothstep( ${MILKY_WAY.rift.l0.toFixed(1)}, ${(MILKY_WAY.rift.l0 + 10).toFixed(1)}, l ) * ( 1.0 - smoothstep( ${(MILKY_WAY.rift.l1 - 15).toFixed(1)}, ${MILKY_WAY.rift.l1.toFixed(1)}, l ) );
  // star clouds and dark lanes: two octaves of value noise on (l, b), finer in latitude [I]
  vec2 q = vec2( l + 180.0, b + 40.0 );
  float n = 0.6 * skbMwNoise( q * vec2( 0.22, 0.5 ) ) + 0.4 * skbMwNoise( q * vec2( 0.6, 1.3 ) + 31.0 );
  float alt = asin( clamp( d.y, -1.0, 1.0 ) ) * 57.29578;
  float X = 1.0 / ( max( d.y, 0.0 ) + 0.50572 * pow( max( alt, 0.0 ) + 6.07995, -1.6364 ) );
  float ext = pow( 10.0, -0.4 * ${NIGHT_EXTINCTION_MAG.toFixed(3)} * X ) * smoothstep( -0.01, 0.05, d.y );
  float I = band * lon * rift * ( 0.35 + 1.1 * n * n );
  gl_FragColor = vec4( uColour * ( uLevel * I * ext ), 1.0 ); // additive (SRC_ALPHA, ONE)
}`;

const MOON_VERT = /* glsl */ `
uniform vec3 uMoonDir;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uTanR;
varying vec2 vUv;
void main() {
  vUv = position.xy * ${MOON_HALO_R.toFixed(1)};
  vec3 d = uMoonDir + ( uRight * vUv.x + uUp * vUv.y ) * uTanR;
  gl_Position = projectionMatrix * ( viewMatrix * vec4( d, 0.0 ) );
  gl_Position.z = gl_Position.w;
}`;

/**
 * Maria (selenographic latitude, east longitude, angular radius in degrees) [D-> places from standard lunar maps;
 * round outlines I]. Oceanus Procellarum as two overlapping discs.
 */
export const MARIA: readonly (readonly [number, number, number])[] = [
  [33, -16, 17],
  [28, 17, 10],
  [8.5, 31, 12],
  [17, 59, 7.5],
  [-8, 51, 9],
  [-21, -17, 9],
  [-15, 35, 5],
  [-24, -39, 6],
  [20, -55, 17],
  [-2, -45, 12],
  [56, 1, 5],
];

const MOON_FRAG = /* glsl */ `
uniform vec3 uMoonDir;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uSunDir;
uniform vec3 uSeleN;
uniform vec3 uColour;
uniform float uLevel;
uniform float uCap;
uniform float uPhaseK;
varying vec2 vUv;
const vec3 MARIA[ ${MARIA.length} ] = vec3[]( ${MARIA.map(([la, lo, r]) => `vec3( ${la.toFixed(1)}, ${lo.toFixed(1)}, ${r.toFixed(1)} )`).join(', ')} );
void main() {
  float r2 = dot( vUv, vUv );
  float edge = 1.0 - smoothstep( 0.92, 1.0, sqrt( r2 ) );
  // aureole (premultiplied: it adds light, the disc covers the stars behind it)
  float halo = ${MOON_HALO.toFixed(3)} * min( uLevel, uCap ) * uPhaseK / max( r2, 1.0 ) * ( 1.0 - smoothstep( ${(MOON_HALO_R * 0.5).toFixed(1)}, ${MOON_HALO_R.toFixed(1)}, sqrt( r2 ) ) );
  if ( edge <= 0.0 ) {
    gl_FragColor = vec4( uColour * halo, 0.0 );
    return;
  }
  float mu = sqrt( max( 1.0 - r2, 0.0 ) );
  vec3 toViewer = -uMoonDir;
  vec3 n = normalize( uRight * vUv.x + uUp * vUv.y + toViewer * mu );
  float mu0 = dot( n, uSunDir );
  // Lommel–Seeliger: no limb darkening; a soft terminator over ≈ 2° of lunar longitude
  float ls = 2.0 * max( mu0, 0.0 ) / ( max( mu0, 0.0 ) + max( mu, 0.05 ) ) * smoothstep( -0.02, 0.03, mu0 );
  // selenographic frame: y to the moon's north (celestial north projected), x to its east limb (sky west)
  vec3 sn = normalize( uSeleN - dot( uSeleN, toViewer ) * toViewer );
  vec3 se = normalize( cross( uMoonDir, sn ) );
  float lat = asin( clamp( dot( n, sn ), -1.0, 1.0 ) );
  float lon = atan( dot( n, se ), dot( n, toViewer ) );
  float alb = 1.0;
  for ( int i = 0; i < ${MARIA.length}; i++ ) {
    vec3 m = MARIA[ i ] * 0.0174533;
    float c = sin( lat ) * sin( m.x ) + cos( lat ) * cos( m.x ) * cos( lon - m.y );
    float ang = acos( clamp( c, -1.0, 1.0 ) );
    alb = min( alb, mix( 0.62, 1.0, smoothstep( m.z * 0.75, m.z * 1.15, ang ) ) );
  }
  // earthshine: ≈ 1e-4 of the full moon on the night side [I], kept just visible
  float lit = min( uLevel * ls, uCap ) + min( uLevel, uCap ) * 0.004;
  gl_FragColor = vec4( uColour * ( lit * alb * edge + halo ), edge );
}`;

export class NightSky {
  readonly group = new THREE.Group();
  private readonly stars: THREE.Points;
  private readonly moon: THREE.Mesh;
  /** wave-10 review fix: the Milky Way band (night only) */
  private readonly milkyWay: THREE.Mesh;
  private readonly mwMat: THREE.ShaderMaterial;
  private readonly precess = new THREE.Matrix3();
  private readonly starMat: THREE.ShaderMaterial;
  private readonly moonMat: THREE.ShaderMaterial;
  private readonly rot = new THREE.Matrix3();
  private precessedFor = NaN;
  private readonly j2000: Float32Array;

  constructor() {
    this.group.name = 'night-sky';
    const pos = new Float32Array(STAR_COUNT * 3);
    const mag = new Float32Array(STAR_COUNT);
    const col = new Float32Array(STAR_COUNT * 3);
    this.j2000 = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const ra = (STARS[i * 4] * Math.PI) / 180;
      const dec = (STARS[i * 4 + 1] * Math.PI) / 180;
      this.j2000.set([Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)], i * 3);
      mag[i] = STARS[i * 4 + 2];
      // star colour at half saturation: the dark-adapted eye sees little colour (the night grade desaturates more)
      const c = kelvinLinear(starKelvin(STARS[i * 4 + 3]));
      const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      for (let k = 0; k < 3; k++) col[i * 3 + k] = 0.5 + (0.5 * c[k]) / l;
    }
    pos.set(this.j2000);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: { uRot: { value: this.rot }, uPre: { value: 1 }, uPxSr: { value: 1e-6 }, uPxScale: { value: 1 } },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    });
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.name = 'night-sky/stars';
    this.stars.frustumCulled = false;
    this.stars.renderOrder = 10;
    this.moonMat = new THREE.ShaderMaterial({
      vertexShader: MOON_VERT,
      fragmentShader: MOON_FRAG,
      uniforms: {
        uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
        uRight: { value: new THREE.Vector3(1, 0, 0) },
        uUp: { value: new THREE.Vector3(0, 0, 1) },
        uTanR: { value: 0.0045 },
        uSunDir: { value: new THREE.Vector3(0, -1, 0) },
        uSeleN: { value: new THREE.Vector3(0, 1, 0) },
        uColour: { value: new THREE.Color(1, 1, 1) },
        uLevel: { value: 0 },
        uCap: { value: MOON_DISPLAY_CAP },
        uPhaseK: { value: 1 },
      },
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    });
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.moonMat);
    this.moon.name = 'night-sky/moon';
    this.moon.frustumCulled = false;
    this.moon.renderOrder = 11;
    // the Milky Way: a camera-centred sphere at the far plane, additive, behind the stars
    const mwCol = kelvinLinear(4600);
    const mwL = 0.2126 * mwCol[0] + 0.7152 * mwCol[1] + 0.0722 * mwCol[2];
    this.mwMat = new THREE.ShaderMaterial({
      vertexShader: MW_VERT,
      fragmentShader: MW_FRAG,
      uniforms: { uGal: { value: new THREE.Matrix3() }, uLevel: { value: 0 }, uColour: { value: new THREE.Vector3(mwCol[0] / mwL, mwCol[1] / mwL, mwCol[2] / mwL) } },
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    });
    this.milkyWay = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), this.mwMat);
    this.milkyWay.name = 'night-sky/milky-way';
    this.milkyWay.frustumCulled = false;
    this.milkyWay.renderOrder = 9;
    this.group.add(this.milkyWay, this.stars, this.moon);
    this.group.visible = false;
  }

  /**
   * Set the sky for a moment: `jd` (Julian Day), `lst` local sidereal time (deg), latitude, grid convergence (deg),
   * `night` 0…1 (drawn only above 0), `pre` pre-exposure, the moon (ephemeris), unit vectors toward the moon and the
   * sun in the local frame, and the white-balanced moonlight colour (luminance 1).
   */
  update(o: { jd: number; lst: number; lat: number; gamma: number; night: number; pre: number; moon: MoonState; moonDir: THREE.Vector3; sunDir: THREE.Vector3; colour: [number, number, number] }): void {
    this.group.visible = o.night > 0;
    if (!this.group.visible) return;
    // precess the catalogue once per date (≈ 2.9° from J2000 to 1789)
    if (Math.abs(o.jd - this.precessedFor) > 30) {
      const p = precessionMatrix(o.jd);
      const a = this.stars.geometry.attributes.position as THREE.BufferAttribute;
      const v = this.j2000;
      for (let i = 0; i < STAR_COUNT; i++) {
        const x = v[i * 3];
        const y = v[i * 3 + 1];
        const z = v[i * 3 + 2];
        a.setXYZ(i, p[0] * x + p[1] * y + p[2] * z, p[3] * x + p[4] * y + p[5] * z, p[6] * x + p[7] * y + p[8] * z);
      }
      a.needsUpdate = true;
      this.precessedFor = o.jd;
      this.precess.set(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8]);
    }
    const m = equatorialToLocalMatrix(o.lst, o.lat, o.gamma);
    this.rot.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
    // stars fade in with the night (the physics fades them against the twilight sky too)
    this.starMat.uniforms.uPre.value = o.pre * o.night;
    // Milky Way: local direction → equator of date (rot^T) → J2000 (precession^T) → galactic
    const gm = GALACTIC_FROM_J2000;
    const gal = new THREE.Matrix3().set(gm[0], gm[1], gm[2], gm[3], gm[4], gm[5], gm[6], gm[7], gm[8]);
    gal.multiply(this.precess.clone().transpose()).multiply(this.rot.clone().transpose());
    this.mwMat.uniforms.uGal.value.copy(gal);
    this.mwMat.uniforms.uLevel.value = MILKY_WAY.peakCd * MILKY_WAY.lift * o.pre * o.night;
    // moon
    const u = this.moonMat.uniforms;
    const md = o.moonDir;
    u.uMoonDir.value.copy(md);
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(md, -md.y);
    if (up.lengthSq() < 1e-8) up.set(0, 0, -1);
    up.normalize();
    u.uUp.value.copy(up);
    u.uRight.value.crossVectors(md, up).normalize();
    u.uTanR.value = Math.tan((o.moon.radius * Math.PI) / 180);
    u.uSunDir.value.copy(o.sunDir);
    // celestial north in the local frame: the third column of the equatorial → local matrix
    u.uSeleN.value.set(m[2], m[5], m[8]);
    // the bright disc is seen photopically: paler than the moonlight on the land (60 % toward white) [I]
    u.uColour.value.setRGB(0.4 * o.colour[0] + 0.6, 0.4 * o.colour[1] + 0.6, 0.4 * o.colour[2] + 0.6, THREE.LinearSRGBColorSpace);
    u.uPhaseK.value = o.moon.k;
    // radiance at normal incidence: albedo × solar illuminance (≈ 128 klx at 1 AU) / π, then the air mass
    const X = 1 / (Math.max(md.y, 0) + 0.50572 * Math.pow(Math.max(o.moon.alt, 0) + 6.07995, -1.6364));
    const ext = 10 ** (-0.4 * NIGHT_EXTINCTION_MAG * X);
    u.uLevel.value = ((MOON_ALBEDO * 128000) / Math.PI) * ext * o.pre * o.night;
    this.moon.visible = o.moon.alt > -1;
  }

  /** Pixel solid angle and DPR scale for the star spots (call when the size or the field of view changes). */
  setView(heightPx: number, fovDeg: number, pxScale = 1): void {
    const a = (2 * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, heightPx);
    this.starMat.uniforms.uPxSr.value = a * a;
    this.starMat.uniforms.uPxScale.value = pxScale;
  }
}
