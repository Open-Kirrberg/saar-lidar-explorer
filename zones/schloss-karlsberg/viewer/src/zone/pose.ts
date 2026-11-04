/**
 * Zone pose ↔ viewer camera (V2.7). Pure: reuses the handover helpers (handover.ts), so the explorer's URL handover
 * and the in-app zone handover share one convention: local x = E − E0, y = h, z = −(N − N0); yaw = −heading (rad),
 * pitch clamped to ±89°.
 */
import type { ZonePose } from './api.ts';
import { headingToYaw, pitchToRad, poseFromCamera, poseToLocal } from '../handover.ts';

export interface LocalPose {
  x: number;
  y: number;
  z: number;
  /** viewer yaw (rad); forward = (−sin yaw, 0, −cos yaw) */
  yaw: number;
  /** viewer pitch (rad), up-positive */
  pitch: number;
  /** gehen → walk mode */
  walk: boolean;
}

export function zonePoseToLocal(p: ZonePose): LocalPose {
  const l = poseToLocal(p);
  return { ...l, yaw: headingToYaw(p.heading_deg), pitch: pitchToRad(p.pitch_deg), walk: p.mode === 'gehen' };
}

export function localToZonePose(pos: { x: number; y: number; z: number }, yaw: number, pitch: number, walk: boolean): ZonePose {
  const p = poseFromCamera(pos, yaw, pitch);
  return { E: p.E, N: p.N, h: p.h, heading_deg: p.heading, pitch_deg: p.pitch, mode: walk ? 'gehen' : 'fliegen' };
}
