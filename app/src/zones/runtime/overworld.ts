/** V2.6b: overworld camera pose ↔ zone contract pose (save on enter, exact restore on exit). Pure (fakes in tests). */
import { utmToWorld, worldToUtm } from '../../geo';
import type { Origin } from '../../geo';
import type { Pose } from '../contract';

export interface RawPose {
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
}

export interface CameraRig {
  getPose(): RawPose;
  setPose(p: Partial<RawPose>): void;
  speedMultiplier: number;
}

export interface DisplayHeights {
  toDisplayY(h: number): number;
  fromDisplayY(y: number): number;
}

/** What is saved on enter besides the contract pose. */
export interface RigSnapshot {
  raw: RawPose;
  exag: number;
  speed: number;
}

export function overworldPose(rig: CameraRig, t: DisplayHeights, origin: Origin, walking: boolean): Pose {
  const p = rig.getPose();
  const { E, N } = worldToUtm(p.x, p.z, origin);
  return { E, N, h: t.fromDisplayY(p.y), heading_deg: p.heading, pitch_deg: p.pitch, mode: walking ? 'gehen' : 'fliegen' };
}

export const rigSnapshot = (rig: CameraRig, exag: number): RigSnapshot => ({ raw: rig.getPose(), exag, speed: rig.speedMultiplier });

/**
 * Back to the saved pose. Same exaggeration as on enter → the raw camera pose, bit-exact. Otherwise (or
 * without a snapshot, e.g. a deep link) the contract pose through the current exaggeration.
 */
export function restoreRig(rig: CameraRig, t: DisplayHeights, origin: Origin, pose: Pose, snap: RigSnapshot | null, exagNow: number): void {
  if (snap && snap.exag === exagNow) rig.setPose({ ...snap.raw });
  else {
    const w = utmToWorld(pose.E, pose.N, origin);
    rig.setPose({ x: w.x, z: w.z, y: t.toDisplayY(pose.h), heading: pose.heading_deg, pitch: pose.pitch_deg });
  }
  if (snap) rig.speedMultiplier = snap.speed;
}
