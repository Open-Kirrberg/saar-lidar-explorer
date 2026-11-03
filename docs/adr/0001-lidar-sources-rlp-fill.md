# 0001 · 📡 LiDAR sources: LVGL ALS 2025 + RLP fill

- **Status:** Accepted · 2026-11-01
- **Origin:** [PRD v1 §4, §9](../history/prd-v1.md#9-decisions-log) · `research/01`

## Context
The relicts sit under forest around Karlsberg, Kirrberg and Homburg. Karlsberg and Karlslust straddle the Saarland / Rheinland-Pfalz border.

## Decision
| Source | Use | Licence |
|---|---|---|
| LVGL-SL ALS 2025 open data (DGM1, DOM1, LAZ ≈ 4 pts/m²) | Primary terrain, surface, point clouds | dl-de/by-2-0 |
| GeoBasis RLP DGM1 2022 | Merged at the border as fill | dl-de/by-2-0 |
| LoD2, DOP20 / TrueDOP20, historic maps, ALKIS (SL + RLP) | Buildings, ground imagery, cadastre | dl-de/by-2-0 |
| OSM (Overpass, tiles) | Ways, POIs, minimap | ODbL |

The "freie Liegenschaftskarte SL" is **not** used (not open).

## Consequences
- ✅ Everything is open and redistributable with attribution ([0013](0013-attribution-every-source.md)).
- ⚠️ Mixed epochs at the border (2025 vs 2022).
- ⚠️ The thinned LAZ adds little over the 1 m DTM; full density was not ordered.
