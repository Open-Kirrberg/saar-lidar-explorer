/**
 * Procedural "parquet de Versailles" (Tafelparkett) for `floor.parquet` (Festsaal review, wave 2).
 *
 * The CC0 photo set (Poly Haven "diagonal_parquet", 2.36 m tile) is a strip parquet whose ≈ 10 cm boards read as
 * modern laminate at room scale. State rooms of the 1780s had panel parquet: square panels ≈ 1.0–1.1 m with a
 * frame and an interlaced diagonal lattice, the panels laid at 45° to the walls [N research/02 §3 finish table
 * "Tafelparkett (oak, panels ≈ 1.0–1.1 m square, diagonal 'Versailles' pattern)", Benrath parquet D; research/09 I4
 * "parquet de Versailles in the state rooms"]. Exact dimensions of the Karlsberg floors are U; the values below are
 * period norm [N] / [I].
 *
 * The shader keeps the photo set only as a wood-grain source: it is sampled stretched along each board, so the
 * colour stays the catalogue albedo (lumaPatch) and only the board layout is drawn procedurally. `parquetCell` is the
 * pure CPU twin of the GLSL (same constants, same branches) for tests; its `gap` includes the field boards' seams,
 * which the shader draws fainter.
 */

import { fract } from '../layout/geom.ts';
import { STATE_ROOM } from '../layout/grammar.ts';

/** Panel edge (m): 3 pieds de roi = 0.974 m (KB-I26, grammar STATE_ROOM.parquetPanel) [N research/09 §4.2; research/02 §3 1.0–1.1 m]. */
export const PARQUET_PANEL = STATE_ROOM.parquetPanel;
/** Frame board width (m) [I]. */
export const PARQUET_FRAME = 0.075;
/** Lattice strip width (m) and spacing of the lattice lines inside a panel (m) [I]. */
export const PARQUET_STRIP = 0.055;
export const PARQUET_LATTICE = 0.31;
/** Width of the short boards that fill the lattice fields (m) [I]. */
export const PARQUET_FIELD_BOARD = 0.065;

export interface ParquetCell {
  kind: 'frame' | 'strip' | 'field';
  /** board direction (unit vector in the panel frame, i.e. after the 45° laying rotation) */
  dir: [number, number];
  /** integer-ish board id within its panel (tone variation) */
  id: number;
  /** panel index (after the 45° laying rotation) */
  panel: [number, number];
  /** distance (m) from the point to the nearest joint of its board */
  gap: number;
}

const R2 = Math.SQRT1_2;

/** Board under the floor point (x, y) in metres (floor UV space). Mirrors PARQUET_GLSL. */
export function parquetCell(x: number, y: number): ParquetCell {
  const P = PARQUET_PANEL;
  const B = PARQUET_FRAME;
  const S = PARQUET_STRIP;
  const L = PARQUET_LATTICE;
  const W = PARQUET_FIELD_BOARD;
  // panels laid at 45° to the room axes
  const qx = (x + y) * R2;
  const qy = (y - x) * R2;
  const cx = Math.floor(qx / P);
  const cy = Math.floor(qy / P);
  const fx = qx - cx * P;
  const fy = qy - cy * P;
  const ex = Math.min(fx, P - fx);
  const ey = Math.min(fy, P - fy);
  const dEdge = Math.min(ex, ey);
  if (dEdge < B) {
    const alongX = ey < ex;
    const id = alongX ? (fy < P / 2 ? 1 : 2) : fx < P / 2 ? 3 : 4;
    const mitre = Math.abs(Math.abs(fx - P / 2) - Math.abs(fy - P / 2)) * R2;
    return { kind: 'frame', dir: alongX ? [1, 0] : [0, 1], id, panel: [cx, cy], gap: Math.min(B - dEdge, mitre, dEdge) };
  }
  const ux = fx - P / 2;
  const uy = fy - P / 2;
  const rx = (ux + uy) * R2;
  const ry = (uy - ux) * R2;
  const kx = Math.floor(rx / L + 0.5);
  const ky = Math.floor(ry / L + 0.5);
  const gx = (fract(rx / L + 0.5) - 0.5) * L;
  const gy = (fract(ry / L + 0.5) - 0.5) * L;
  let sx = Math.abs(gx) < S / 2;
  let sy = Math.abs(gy) < S / 2;
  const cross = sx && sy;
  if (cross) {
    const topX = (((kx + ky) % 2) + 2) % 2 === 0;
    sx = topX;
    sy = !topX;
  }
  const inner = B - dEdge; // ≤ 0 inside the field; joint with the frame
  if (sx) {
    const gap = Math.min(S / 2 - Math.abs(gx), cross ? Infinity : Math.abs(gy) - S / 2, -inner);
    return { kind: 'strip', dir: [R2, -R2], id: 10 + kx, panel: [cx, cy], gap };
  }
  if (sy) {
    const gap = Math.min(S / 2 - Math.abs(gy), cross ? Infinity : Math.abs(gx) - S / 2, -inner);
    return { kind: 'strip', dir: [R2, R2], id: 30 + ky, panel: [cx, cy], gap };
  }
  const even = (((kx + ky) % 2) + 2) % 2 === 0;
  const dir: [number, number] = even ? [R2, R2] : [R2, -R2];
  const across = -dir[1] * fx + dir[0] * fy;
  const seam = (0.5 - Math.abs(fract(across / W) - 0.5)) * W;
  const gap = Math.min(Math.abs(gx) - S / 2, Math.abs(gy) - S / 2, seam, -inner);
  return { kind: 'field', dir, id: 50 + kx * 7 + ky * 3 + Math.floor(across / W), panel: [cx, cy], gap };
}

/**
 * GLSL twin of `parquetCell`, inserted in place of three's `map_fragment` (needs `map`, `vMapUv`, `uMapMean`,
 * `uParqTile` = metres per UV unit). Writes `diffuseColor` and leaves `parqH` (board hash 0…1) and `parqJoint`
 * (1 in a joint, 0 on a board) for the roughness chunk.
 */
export const PARQUET_GLSL = /* glsl */ `
  float parqH = 0.5;
  float parqJoint = 0.0;
#ifdef USE_MAP
  {
    const float P = ${PARQUET_PANEL.toFixed(4)};
    const float B = ${PARQUET_FRAME.toFixed(4)};
    const float S = ${PARQUET_STRIP.toFixed(4)};
    const float L = ${PARQUET_LATTICE.toFixed(4)};
    const float W = ${PARQUET_FIELD_BOARD.toFixed(4)};
    const float R2 = 0.70710678;
    vec2 pm = vMapUv * uParqTile;
    vec2 q = vec2( pm.x + pm.y, pm.y - pm.x ) * R2;
    vec2 cell = floor( q / P );
    vec2 f = q - cell * P;
    float ex = min( f.x, P - f.x );
    float ey = min( f.y, P - f.y );
    float dEdge = min( ex, ey );
    vec2 dir;
    float id;
    float gap;
    float seamGap = 1.0;
    if ( dEdge < B ) {
      bool alongX = ey < ex;
      dir = alongX ? vec2( 1.0, 0.0 ) : vec2( 0.0, 1.0 );
      id = alongX ? ( f.y < P * 0.5 ? 1.0 : 2.0 ) : ( f.x < P * 0.5 ? 3.0 : 4.0 );
      float mitre = abs( abs( f.x - P * 0.5 ) - abs( f.y - P * 0.5 ) ) * R2;
      gap = min( min( B - dEdge, mitre ), dEdge );
    } else {
      vec2 u = f - P * 0.5;
      vec2 r = vec2( u.x + u.y, u.y - u.x ) * R2;
      vec2 k = floor( r / L + 0.5 );
      vec2 g = ( fract( r / L + 0.5 ) - 0.5 ) * L;
      bool sx = abs( g.x ) < S * 0.5;
      bool sy = abs( g.y ) < S * 0.5;
      bool crossing = sx && sy;
      if ( crossing ) {
        bool topX = mod( k.x + k.y, 2.0 ) < 0.5;
        sx = topX;
        sy = !topX;
      }
      float inner = dEdge - B;
      if ( sx ) {
        dir = vec2( R2, -R2 );
        id = 10.0 + k.x;
        gap = min( min( S * 0.5 - abs( g.x ), crossing ? 1.0 : abs( g.y ) - S * 0.5 ), inner );
      } else if ( sy ) {
        dir = vec2( R2, R2 );
        id = 30.0 + k.y;
        gap = min( min( S * 0.5 - abs( g.y ), crossing ? 1.0 : abs( g.x ) - S * 0.5 ), inner );
      } else {
        bool even = mod( k.x + k.y, 2.0 ) < 0.5;
        dir = even ? vec2( R2, R2 ) : vec2( R2, -R2 );
        float across = -dir.y * f.x + dir.x * f.y;
        float seam = ( 0.5 - abs( fract( across / W ) - 0.5 ) ) * W;
        gap = min( min( abs( g.x ) - S * 0.5, abs( g.y ) - S * 0.5 ), inner );
        seamGap = seam;
        id = 50.0 + k.x * 7.0 + k.y * 3.0 + floor( across / W );
      }
    }
    parqH = fract( sin( id * 12.9898 + dot( cell, vec2( 78.233, 37.719 ) ) ) * 43758.5453 );
    // wood grain: the photo set sampled stretched along the board, a different stretch of it per board
    float along = dot( f, dir );
    float acrossB = dot( f, vec2( -dir.y, dir.x ) );
    vec2 guv = vec2( acrossB * 0.35 + parqH * 3.1, along * 0.04 + parqH * 1.7 );
    vec4 grain = texture2D( map, guv );
    float lum = dot( grain.rgb, vec3( 0.299, 0.587, 0.114 ) ) / uMapMean;
    // joints: ≈ 1.5 mm dark line, faded out where a pixel covers more than ≈ 1 cm (no shimmer at distance)
    float px = length( fwidth( pm ) );
    float joint = 1.0 - smoothstep( 0.0012, 0.0012 + max( px, 0.0008 ), gap );
    // the short field boards' own seams are tighter and read fainter than the frame and lattice joints
    joint = max( joint, 0.4 * ( 1.0 - smoothstep( 0.0008, 0.0008 + max( px, 0.0008 ), seamGap ) ) );
    joint *= 1.0 - smoothstep( 0.006, 0.02, px );
    parqJoint = joint;
    // subtle board-to-board variation (one oak, boards sorted by colour) [I]
    float tone = 0.93 + 0.14 * parqH;
    diffuseColor.rgb *= clamp( mix( 1.0, lum, 0.8 ), 0.0, 2.0 ) * tone * ( 1.0 - 0.5 * joint );
  }
#endif
`;
