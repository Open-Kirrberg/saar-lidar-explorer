/**
 * Pure helpers of the room mirrors (backlog KB-I75, viewer/src/mirrors.ts). No three.js, no DOM.
 *
 * A pier glass or trumeau reflects its own room. One static cube map per room, captured from inside it, is sampled with
 * a box projection (parallax-corrected cube map, Bjorke 2004, "Image-based lighting", GPU Gems ch. 19; Lagarde &
 * Zanuttini 2012, "Local image-based lighting with parallax-corrected cubemaps"): the reflected ray is intersected with
 * the room box and the cube is read in the direction from the capture point to that hit, so the opposite windows, the
 * doors and the walls appear where they are, not as if at infinity.
 */
export type V3 = readonly [number, number, number];

/**
 * Silvering of a period mirror [I]: tin-mercury amalgam behind blown plate glass reflects ≈ 70 % (modern silver ≈ 90 %,
 * the amalgam is the darker, greyer "mercury glass" of 18th-century pier glasses), with the faint green of the iron in
 * the glass. Linear RGB.
 */
export const MIRROR_TINT: V3 = [0.68, 0.71, 0.67];
/**
 * Blur of the reflection: the cube mip level read (0 = sharp). Old plate glass is slightly wavy and the amalgam
 * grainy, so the image is soft, not a modern float-glass mirror [I].
 */
export const MIRROR_LOD = 1;
/** Cube face size (px): a 3–4 m pier glass seen from 4–8 m covers ≈ 300–500 px of a 1080p frame (≈ 16 MB with mips). */
export const MIRROR_CUBE_SIZE = 512;
/** Frames the visitor stays in a room before its cube is captured (the interior switches to its 'full' mode first). */
export const MIRROR_SETTLE_FRAMES = 10;
/** Capture height above the floor (m), capped at half the room height: eye level of a standing visitor [I]. */
export const MIRROR_CAPTURE_HEIGHT = 1.7;

/** Axis-aligned room box in the room's local frame (floor mesh space). */
export interface RoomBox {
  min: V3;
  max: V3;
}

/** True when a local point stands in the room box (with `pad` m of slack in plan and below the floor). */
export function inRoom(p: V3, box: RoomBox, pad = 0.05): boolean {
  return p[0] >= box.min[0] - pad && p[0] <= box.max[0] + pad && p[2] >= box.min[2] - pad && p[2] <= box.max[2] + pad && p[1] >= box.min[1] - 0.3 && p[1] <= box.max[1];
}

/** Distance (m) of the capture point in front of the room's largest glass. */
export const MIRROR_CAPTURE_OFFSET = 0.3;

/** A mirror glass in the room frame: centre, unit normal into the room, area (m²). */
export interface MirrorGlass {
  centre: V3;
  normal: V3;
  area: number;
}

/**
 * Capture point of a room's cube. The box projection is exact for walls, windows and doors from any point, but things
 * standing in the room (the chandelier, a stove, chairs) are projected onto the walls as seen from the capture point.
 * The rays a pier glass reflects all start on the glass, so the cube is captured just in front of the room's largest
 * glass (`MIRROR_CAPTURE_OFFSET`, kept inside the box): its reflection then shows the chandelier and the furniture in
 * place, the smaller glasses of the room a little shifted. Without a glass: plan centre at eye height.
 */
export function capturePoint(box: RoomBox, glass?: MirrorGlass | null): V3 {
  const h = box.max[1] - box.min[1];
  if (!glass) return [(box.min[0] + box.max[0]) / 2, box.min[1] + Math.min(MIRROR_CAPTURE_HEIGHT, h / 2), (box.min[2] + box.max[2]) / 2];
  const m = 0.1;
  return [0, 1, 2].map((i) => Math.min(box.max[i] - m, Math.max(box.min[i] + m, glass.centre[i] + glass.normal[i] * MIRROR_CAPTURE_OFFSET))) as unknown as V3;
}

/** The largest glass of a list (or null). */
export function largestGlass(glasses: readonly MirrorGlass[]): MirrorGlass | null {
  let best: MirrorGlass | null = null;
  for (const g of glasses) if (!best || g.area > best.area) best = g;
  return best;
}

/**
 * A glass from its axis-aligned bounds in the room frame (it lies in a wall plane: the thinnest axis is its normal) and
 * the room box (the normal points toward the room centre).
 */
export function glassFromBounds(min: V3, max: V3, box: RoomBox): MirrorGlass {
  const ext = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const centre: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const axis = ext[0] <= ext[2] ? 0 : 2;
  const mid = (box.min[axis] + box.max[axis]) / 2;
  const normal: V3 = axis === 0 ? [Math.sign(mid - centre[0]) || 1, 0, 0] : [0, 0, Math.sign(mid - centre[2]) || 1];
  const area = ext[1] * (axis === 0 ? ext[2] : ext[0]);
  return { centre, normal, area };
}

/**
 * Box-projected lookup direction (not normalised) for a reflected ray from `p` along `r` inside `box`, read from the
 * capture point `c`. Mirrors the GLSL in mirrors.ts.
 */
export function boxProject(p: V3, r: V3, box: RoomBox, c: V3): V3 {
  let t = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(r[i]) < 1e-9) continue;
    const ti = Math.max((box.max[i] - p[i]) / r[i], (box.min[i] - p[i]) / r[i]);
    t = Math.min(t, ti);
  }
  if (!Number.isFinite(t)) return r;
  return [p[0] + r[0] * t - c[0], p[1] + r[1] * t - c[1], p[2] + r[2] * t - c[2]];
}

/**
 * Key of what a captured cube shows: the room and the light (sun hour to 0.05 h, look, celebration). A new key means
 * a new capture; the same key never re-renders (0 ms per frame in a steady room).
 */
export function mirrorKey(roomId: string, hour: number, look: string, fest: boolean): string {
  return `${roomId}|${(Math.round(hour * 20) / 20).toFixed(2)}|${look}|${fest ? 1 : 0}`;
}

/**
 * Debounce of the capture (wave-9 review fix): a cube is captured only after the key (room and light) has stayed the
 * same for `frames` frames. Entering a room waited for the room alone; now a light key that keeps changing (the hour
 * slider dragged, the clock of a tour) no longer restarts a six-face capture every 0.05 h (+1.5…3.5 ms CPU on each
 * capture frame, measured at 06 / 29): the glasses keep the last cube until the light settles. `step` returns true
 * once the key is settled.
 */
export class SettleGate {
  private key: string | null = null;
  private count = 0;
  constructor(private readonly frames: number = MIRROR_SETTLE_FRAMES) {}
  step(key: string): boolean {
    if (key !== this.key) {
      this.key = key;
      this.count = 0;
    }
    if (this.count < this.frames) {
      this.count++;
      return false;
    }
    return true;
  }
  reset(): void {
    this.key = null;
    this.count = 0;
  }
}
