# 0036 · 🧭 Game minimap: round dial, heading-up by default, CSS rotation

- **Status:** Accepted · 2026-11-04
- **Origin:** V2.3 (builds on [0006](0006-leaflet-minimap.md), [0019](0019-feature-tiers.md), [0026](0026-collapsed-attribution.md), [0032](0032-shell-layout-tier-registry.md))

## Context
The v1 minimap was a GIS panel: a header row (folgen / klein / groß / Vollbild), a layer control and a footprint. V2 wants a game HUD with the player centred, a view cone and a north-up / heading-up toggle. Leaflet 1.9.4 cannot rotate the map. Plugins that can rotate it patch Leaflet internals.

## Decision
| # | Rule |
|---|---|
| 1 | **Round dial, player centred.** Leaflet stays on 1.9.4, no plugin. Heading-up rotates the Leaflet container with CSS. Clicks are mapped back by inverting the rotation around the container centre. While rotated, dragging is off and wheel/pinch zoom around the centre. |
| 2 | **Heading-up is the default.** The „N“ badge on the rim shows where north is and switches to north-up. The choice is stored locally. |
| 3 | **Map bearing = projected heading.** The minimap projects a short step along the grid heading into Web Mercator. This includes the grid convergence (≈ −1.2°) and the Web Mercator ellipsoid skew (≤ 0.1°). A numeric test compares it with the three.js camera: it must agree within 1° (measured: < 0.05°). |
| 4 | **View cone = horizontal FOV** of the 3D camera (`2·atan(tan(vfov/2)·aspect)`), so a phone in portrait shows a narrow cone. |
| 5 | **One expand button** opens a full-screen map. It is always north-up and can be dragged and zoomed. A click flies there and closes it; „Zentrieren“ brings the player back. |
| 6 | **Tiers:** Standard/Entdecker show OSM, the AOI outline, places, markers and zone portals. Labor adds the v1 layer control, relief opacity and the ray-cast footprint (controls only on the full-screen map). |
| 7 | **Attribution:** under the dial, „© OpenStreetMap“ (linked) is always visible ([0026](0026-collapsed-attribution.md)). The full-screen map shows Leaflet's full attribution. |

## Consequences
- ✅ Heading matches the 3D view within 1° (tested). No new dependency.
- ✅ Zone portals have an API (`Minimap.setPortals`) that V2.6 can call.
- ⚠️ When the map is rotated, tile labels and tooltips rotate with it. Sticky tooltips (AOI outline) can sit off the cursor.
- ⚠️ There are no ± buttons on the dial. Zoom on the dial is wheel or pinch; the full-screen map has buttons.
