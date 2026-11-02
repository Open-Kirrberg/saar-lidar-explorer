/**
 * `flyToSiteExag`: the shared oblique fly-to (pois/PoiPanel `flyToSite`) made exaggeration-aware.
 * With a known true height (candidate `z`, marker `h`, or the loaded DTM) the camera pose is
 * computed by `frameSite` around the displayed target and flown with an absolute `y`, so the site is
 * centred at 1–5× and the result no longer depends on which terrain levels are streamed in. Without
 * any height it falls back to `flyToSite` (which re-aims while terrain streams).
 */
import { utmToWorld, worldToUtm } from '../geo';
import type { AppContext } from '../main';
import { flyToSite, gridBearing } from '../pois/PoiPanel';
import { displayY, frameSite } from './framing';

export function flyToSiteExag(
  ctx: AppContext,
  E: number,
  N: number,
  dist = 120,
  agl = 60,
  hTrue: number | null = null,
): Promise<boolean> {
  const { terrain, manifest, store } = ctx;
  const origin = manifest.origin;
  const { x, z } = utmToWorld(E, N, origin);
  const h = hTrue !== null && Number.isFinite(hTrue) ? hTrue : terrain.heightAt(x, z);
  if (!Number.isFinite(h)) return flyToSite(ctx, E, N, dist, agl);
  const s = store.get();
  const far = Math.hypot(E - s.E, N - s.N) > dist * 1.5;
  const heading = far ? gridBearing(s.E, s.N, E, N) : s.heading;
  const exag = terrain.uniforms.uExag.value;
  const hRef = terrain.uniforms.uHRef.value;
  const f = frameSite(x, displayY(h, hRef, exag), z, dist, agl, heading, (gx, gz) => terrain.surfaceY(gx, gz));
  const cam = worldToUtm(f.x, f.z, origin);
  return ctx.flyTo(cam.E, cam.N, { y: f.y, heading: f.heading, pitch: f.pitch, lookAt: false });
}
