/**
 * Pure helpers for showing an area (a selected place's outline) on the minimap (no Leaflet / DOM).
 *  - The compact dial is player-centred and round: an area shows when its farthest point lies
 *    inside the dial's circle around the player, so the dial zooms out briefly („peek“).
 *  - The full-screen map fits the area's bounds and keeps clear of floating shell buttons.
 */

/**
 * Integer zoom (Leaflet zoomSnap 1) at which a point `distPx` from the centre at `zoom` comes within
 * `radiusPx` of it, clamped to [minZoom, maxZoom]. Never zooms in past `maxZoom` (the user's zoom).
 */
export function zoomToFitAround(zoom: number, distPx: number, radiusPx: number, minZoom: number, maxZoom: number): number {
  if (!(distPx > 0) || !(radiusPx > 0)) return Math.max(minZoom, Math.min(maxZoom, zoom));
  const z = Math.floor(zoom + Math.log2(radiusPx / distPx) + 1e-9);
  return Math.max(minZoom, Math.min(maxZoom, z));
}

/** Rectangles in viewport pixels (DOMRect-like). */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * How far (px) the full map's bottom-right controls must move up so a floating button (`keep`, the
 * shell's „© Quellen“) does not cover them: the overlap of `keep` with the bottom-right strip of
 * `map` that holds the zoom control (`stripW` px wide), plus `gap`. 0 when they do not overlap.
 */
export function cornerLift(map: Rect, keep: Rect | null, stripW = 120, gap = 6): number {
  if (!keep || keep.right <= keep.left || keep.bottom <= keep.top) return 0;
  const overlapX = keep.left < map.right && map.right - stripW < keep.right;
  const overlapY = keep.top < map.bottom && map.top < keep.bottom;
  if (!overlapX || !overlapY) return 0;
  return Math.max(0, Math.ceil(map.bottom - keep.top + gap));
}
