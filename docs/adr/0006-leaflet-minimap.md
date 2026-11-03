# 0006 · 🗺️ Leaflet 1.9.4 for the 2D map

- **Status:** Accepted · 2026-11-01
- **Origin:** [PRD v1 §5, §9](../history/prd-v1.md#9-decisions-log)

## Context
The 3D view needs a synced 2D map for orientation.

## Decision
Leaflet **1.9.4** (stable), not 2.0 alpha and not MapLibre. The base map stays Web Mercator.

## Consequences
- ✅ Small and stable; OSM, WMS and XYZ layers work out of the box.
- ➡️ In v2 the panel becomes a **game minimap**: player in the centre, view cone, minimal chrome ([0019](0019-feature-tiers.md)). It is still built on Leaflet.
