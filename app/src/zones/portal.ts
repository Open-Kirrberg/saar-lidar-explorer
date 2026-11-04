/** V2.6: portal proximity (offer *Betreten*, with hysteresis), exit fallback pose, LOD pick. Pure. */
import type { Pose, Portal, ZoneAsset, ZoneLod, ZoneManifest } from './contract';
import { normHeading } from './contract';

/** A portal stays offered until the camera is beyond `radius_m · PORTAL_HYSTERESIS`. */
export const PORTAL_HYSTERESIS = 1.1;

export interface PortalFocus {
  zoneId: string;
  portalId: string;
  label_de: string;
  distance_m: number;
}

const dist = (p: Portal, E: number, N: number): number => Math.hypot(p.E - E, p.N - N);

/** All portals whose radius contains (E, N), nearest first. Horizontal distance only. */
export function portalsInRange(zones: readonly ZoneManifest[], E: number, N: number, scale = 1): PortalFocus[] {
  const out: PortalFocus[] = [];
  for (const z of zones) {
    for (const p of z.portals) {
      const d = dist(p, E, N);
      if (d <= p.radius_m * scale) out.push({ zoneId: z.id, portalId: p.id, label_de: p.label_de, distance_m: d });
    }
  }
  return out.sort((a, b) => a.distance_m - b.distance_m);
}

/**
 * The portal the shell offers now. Keeps `prev` while the camera is within its hysteresis radius
 * (no flicker at the edge, no hopping between overlapping portals); otherwise the nearest portal in
 * range; otherwise null. Never enters by itself.
 */
export function updatePortalFocus(prev: PortalFocus | null, zones: readonly ZoneManifest[], E: number, N: number): PortalFocus | null {
  if (prev) {
    const z = zones.find((x) => x.id === prev.zoneId);
    const p = z?.portals.find((x) => x.id === prev.portalId);
    if (p) {
      const d = dist(p, E, N);
      if (d <= p.radius_m * PORTAL_HYSTERESIS) return { ...prev, distance_m: d };
    }
  }
  return portalsInRange(zones, E, N)[0] ?? null;
}

export function findPortal(zone: ZoneManifest, portalId: string): Portal | undefined {
  return zone.portals.find((p) => p.id === portalId);
}

/** Height of the fallback exit pose above the portal ground. */
export const EXIT_FALLBACK_HEIGHT_M = 30;

/**
 * Exit pose when no overworld pose was saved (deep link into a zone): `radius/3` (≥ 20 m) in front
 * of the portal along `facing_deg`, looking back at it, pitch −15°, `fliegen`, 30 m above the
 * portal ground. `groundH` = overworld terrain height at the portal (true metres) if known; else the
 * portal's own `h`, else the spawn height.
 */
export function fallbackExitPose(zone: ZoneManifest, portal: Portal, groundH?: number): Pose {
  const back = Math.max(20, portal.radius_m / 3);
  const rad = (portal.facing_deg * Math.PI) / 180; // grid heading: 0 = north (+N), 90 = east (+E)
  const base = Number.isFinite(groundH) ? (groundH as number) : (portal.h ?? zone.spawns[portal.spawn]!.h);
  return {
    E: portal.E + Math.sin(rad) * back,
    N: portal.N + Math.cos(rad) * back,
    h: base + EXIT_FALLBACK_HEIGHT_M,
    heading_deg: normHeading(portal.facing_deg + 180),
    pitch_deg: -15,
    mode: 'fliegen',
  };
}

/** Distance from a zone-frame point to an axis-aligned box (0 inside). */
export function distanceToBox(p: readonly [number, number, number], box: ZoneAsset['bboxLocal']): number {
  if (!box) return 0;
  let s = 0;
  for (let a = 0; a < 3; a++) {
    const d = Math.max(box[0][a]! - p[a]!, 0, p[a]! - box[1][a]!);
    s += d * d;
  }
  return Math.sqrt(s);
}

/** Contract LOD rule: first level whose `until_m` ≥ the camera distance to `bboxLocal` (null = ∞). */
export function pickLod(asset: ZoneAsset, cameraLocal: readonly [number, number, number]): ZoneLod {
  const d = distanceToBox(cameraLocal, asset.bboxLocal);
  return asset.lods.find((l) => l.until_m === null || d <= l.until_m) ?? asset.lods[asset.lods.length - 1]!;
}
