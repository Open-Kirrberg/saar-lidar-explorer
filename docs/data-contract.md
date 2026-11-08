# Data Contract v3 — pipeline → app

The pipeline (`pipeline/`) writes static files to **`app/public/data/<aoi>/`** (git-ignored). The app (`app/`) loads them via `fetch('data/<aoi>/manifest.json')`. Both sides must follow this file; change it only together with a `CHANGELOG.md` line (and an ADR if the change is a decision, e.g. a new layer kind).

**Zones** (detailed places behind portals: castle, bakery, …) have their own binding contract: [zone-contract.md](zone-contract.md) (`sle-zone-v1`, [ADR 0029](adr/0029-zones-same-bundle-folder-layout.md)). Frames, proj4 and attribution rules below apply to zones unchanged.

**Versions.** `version: 1` = single 1 m level (the MVP format). `version: 2` (F9) = v1 **plus** `levels` (overview pyramid, see "Levels") — a v2 manifest is a strict superset, all v1 keys keep their meaning and paths. Optional baked vector heights (`vectors.<key>.heights`, see "Vectors") are allowed in both, as are the additive F11/F13/F14 keys (`rgb` image layers, the `bldg` mask layer, `models.buildings`, `xyz.hist_*`, F15 `candidates`, F16 `pointclouds`, V2.4 `trees`, Orte im Vergleich `stats` and `forest_hist`; see "Image layers", "Building mask", "Models", "Candidates", "Point clouds", "Trees", "Place statistics", "Historic forest mask"). The app loads v1, v2 and v3 (see Revision 3.0 below): a v1 manifest is treated as one level (level 0); unknown versions are rejected. The pipeline writes `version: 2` exactly when it writes `levels`. **Revision 2.1 (V2.4, 2026-11-04):** adds the optional `trees` key — additive, the manifest `version` stays 1/2 and older manifests stay valid. **Revision 2.2 (Orte im Vergleich Phase 0, 2026-11-08):** adds the optional `stats` key (`sle-stats-v1`: `stats/places.json` + `stats/places.geojson`, [ADR 0049](adr/0049-orte-im-vergleich-places-only.md)) and the optional `forest_hist` key (`sle-forest-hist-v1`: `forest_hist/forest_hist.png`) — additive like `trees`: `version` stays 1/2, manifests without them stay valid, and the app hides the panel / the card row when a key is missing or invalid. **Revision 2.3 (Orte im Vergleich Phase 1, 2026-11-08):** adds the optional `species` key (`sle-species-v1`: `species/species.png`, see "Tree species") — additive like `forest_hist`: `version` stays 1/2, manifests without it stay valid, and the tree card hides the species row when it is missing or invalid. **Revision 2.4 (S1 Saarland leaderboard, 2026-11-08):** adds the optional top-level key `stats_levels` (`sle-stats-levels-v1`) and **stats-only manifests** (`kind: 'stats-only'`, e.g. AOI `saarland`: `stats` + `stats_levels` + `attribution`, no terrain), see "Gemeinde level" under "Place statistics" — additive: tile manifests keep `version` 1/2 and stay valid without the key. **Revision 3.0 (S2 many places, 2026-11-08):** manifest `version: 3` = v2 plus the global grid (`grid`, rectangles aligned at 1 km), the chunk `presence` list, fixed u8 ranges, WebP/AVIF files, `derived` relief modes (no baked hillshade/slope/slrm/vat at level 0), no `dsm`, 2D OSM and derived parcel lines; plus the catalog `sle-catalog-v1` and the central overview `sle-overview-v1`, see "Many places (v3, S2)". The app loads v1, v2 and v3; v1/v2 keep their meaning unchanged. **Revision 3.1 (S2 follow-ups, 2026-11-08):** adds the optional overview key `coverage` (real-data tiles) and the "Overview no-data" rule, fixes the v3 source-height plausibility rule `h-plausible-v1` (replaces the 100 m floor; so catalog `height_ref_m` reflects real terrain) and makes v3 tree crown types depend only on the place's own inputs — additive: `version` stays 3, `sle-overview-v1` / `sle-catalog-v1` keep their format ids, files without `coverage` stay valid, see "Many places (v3, S2)".

## Coordinate frames

- Source CRS: **EPSG:25832** (ETRS89 / UTM 32N), heights DHHN2016 (m).
- AOI origin `E0, N0` = lower-left corner of the AOI (integer metres, e.g. Karlsberg `381000, 5465000`).
- **three.js world frame** (y-up, metres): `x = E − E0`, `y = height`, `z = −(N − N0)`. So +x = east, −z = north. Never put raw UTM values into float32 buffers.
- WGS84 ⇄ EPSG:25832 via proj4, definition `+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`.

## Grid & chunks

- Cell size **1 m**. Source DGM1 is PixelIsArea: pixel `(col,row)` of a 1 km tile with lower-left `(E,N)` has its **centre** at `E + col + 0.5`, `N + 1000 − row − 0.5`.
- AOI raster: `width × height` cells (e.g. 3000 × 3000), sample `(c, r)` at centre `E0 + c + 0.5`, `N0 + height − r − 0.5` (row 0 = north edge, as in GeoTIFF).
- v3 (Revision 3.0): the AOI rectangle lies on the **global 1 km grid** and may publish only some chunks (`presence`); `(i, j)` stay relative to the rectangle, see "Many places (v3, S2)".
- Chunks: `chunkSize = 500` cells. Chunk `(i, j)`: `i` = column index going **east**, `j` = row index going **south**, from the north-west corner. Chunk `(i,j)` owns cells `c ∈ [i·500, i·500+500)`, `r ∈ [j·500, j·500+500)`.
- **Height images carry a 1-cell apron on every side**: 502 × 502 pixels, pixel `(px,py)` ↔ AOI cell `(i·500 − 1 + px, j·500 − 1 + py)`. Cells outside the AOI raster are edge-clamped. The mesh is built over the 500 × 500 owned cells (plus a shared edge to the neighbour via the apron so there are no gaps); the apron also allows seamless per-pixel normals.
- **Relief layer images have no apron**: 500 × 500 pixels, pixel `(px,py)` ↔ cell `(i·500 + px, j·500 + py)`.

## Encodings

- **`terrarium`** (heights): PNG RGB8, `h = (R·256 + G + B/256) − 32768` metres (≈ 4 mm precision). NoData is filled (interpolated/nearest) before encoding; a separate optional `mask` layer marks filled cells.
- **`u8`** (relief layers): single-channel grayscale PNG (or WebP lossless), `value = min + (v / 255) · (max − min)` with `min`/`max` from the manifest. Layers that are already display images (e.g. `vat`) use `min: 0, max: 1`.
- **`rgb`** (colour images: orthophoto, historic maps; F13/F14): RGB8 WebP or JPEG (`format`), one image per chunk covering exactly the chunk's 500 × 500 cells at `pixelsPerChunk` px per side, see "Image layers". **Decoded with normal sRGB handling** (`colorSpace = SRGBColorSpace`, default `createImageBitmap` colour conversion) — unlike `terrarium`/`u8`, these are pictures, not data.
- Decode heights in a worker / with `createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })`. Never let the browser colour-manage them.
- v3 (Revision 3.0): which file types (`.png` / `.webp` lossless / `.avif` lossy) each encoding allows, and the AVIF rules, are in "Slim formats (v3)".

## manifest.json

```jsonc
{
  "version": 2,                                  // 1 = no `levels`; 2 = with `levels`
  "aoi": "karlsberg",
  "name": "Schloss Karlsberg",
  "crs": "EPSG:25832",
  "origin": { "E0": 381000, "N0": 5465000 },
  "size": { "width": 3000, "height": 3000 },   // cells
  "cellSize": 1,
  "chunkSize": 500,
  "chunks": { "nx": 6, "ny": 6 },
  "heightRange": { "min": 231.4, "max": 402.9 },  // over DTM, metres
  "wgs84Bounds": [[49.326, 7.362], [49.354, 7.403]], // [[south, west], [north, east]], informative
  "height": {
    "dtm": { "path": "dtm/{i}_{j}.png", "encoding": "terrarium", "apron": 1 },
    "dsm": { "path": "dsm/{i}_{j}.png", "encoding": "terrarium", "apron": 1 }   // optional
  },
  "layers": {
    // key: { path, encoding, min, max, unit, label_de, description }
    "hillshade": { "path": "relief/hillshade/{i}_{j}.png", "encoding": "u8", "min": 0, "max": 1, "label_de": "Schummerung (multidirektional)" },
    "slope":     { "path": "relief/slope/{i}_{j}.png",     "encoding": "u8", "min": 0, "max": 60, "unit": "deg", "label_de": "Hangneigung" },
    "slrm":      { "path": "relief/slrm/{i}_{j}.png",      "encoding": "u8", "min": -1.5, "max": 1.5, "unit": "m", "label_de": "Lokales Relief" },
    "svf":       { "path": "relief/svf/{i}_{j}.png",       "encoding": "u8", "min": 0.6, "max": 1, "label_de": "Himmelssicht (SVF)" },
    "opns_pos":  { "path": "relief/opns_pos/{i}_{j}.png",  "encoding": "u8", "min": 60, "max": 95, "unit": "deg", "label_de": "Offenheit positiv" },
    "opns_neg":  { "path": "relief/opns_neg/{i}_{j}.png",  "encoding": "u8", "min": 60, "max": 95, "unit": "deg", "label_de": "Offenheit negativ" },
    "vat":       { "path": "relief/vat/{i}_{j}.png",       "encoding": "u8", "min": 0, "max": 1, "label_de": "VAT (Kombination)" },
    "chm":       { "path": "relief/chm/{i}_{j}.png",       "encoding": "u8", "min": 0, "max": 40, "unit": "m", "label_de": "Vegetationshöhe" },
    "mask":      { "path": "relief/mask/{i}_{j}.png",      "encoding": "u8", "min": 0, "max": 1, "label_de": "Ergänzte Daten (RLP/Lücke)" },
    // optional (R0.7/F11): building footprint mask, see "Building mask"
    "bldg":      { "path": "relief/bldg/{i}_{j}.png",      "encoding": "u8", "min": 0, "max": 1, "label_de": "Gebäudemaske" },
    // optional (F13/F14): colour image layers, see "Image layers"
    "ortho":     { "path": "ortho/{i}_{j}.webp", "encoding": "rgb", "format": "webp", "pixelsPerChunk": 1000, "kind": "image",
                   "label_de": "Luftbild (DOP20)", "attribution": "© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (DOP20)" },
    "hist_1840": { "path": "hist_1840/{i}_{j}.jpg", "encoding": "rgb", "format": "jpg", "pixelsPerChunk": 500, "kind": "image",
                   "label_de": "Karte 1836–41 (Bayer. Positionsblätter)", "attribution": "© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet (Historische Karten)" }
  },
  "xyz": {
    // Web-Mercator overlay tiles for Leaflet
    "vat":   { "url": "xyz/vat/{z}/{x}/{y}.png",   "minZoom": 12, "maxZoom": 18 },
    "slrm":  { "url": "xyz/slrm/{z}/{x}/{y}.png",  "minZoom": 12, "maxZoom": 18 },
    // optional (F14): historic map tiles, same shape; label_de/kind/attribution optional
    "hist_1840": { "url": "xyz/hist_1840/{z}/{x}/{y}.png", "minZoom": 12, "maxZoom": 17, "kind": "image",
                   "label_de": "Karte 1836–41 (Bayer. Positionsblätter)" }
  },
  "models": {
    // optional (F11), see "Models"
    "buildings": { "path": "models/buildings/{i}_{j}.glb", "chunks": [[2, 3], [2, 4]], "frame": "local",
                   "featureCount": 1834, "label_de": "Gebäude (LoD2)",
                   "attribution": "© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet (LoD2)" }
  },
  "vectors": {
    // optional (F10/F12); each sub-key optional; see "Vectors" below
    "osm":         { "path": "vectors/osm.geojson", "crs": "EPSG:25832", "featureCount": 590,
                     "label_de": "Wege & Straßen (OSM)", "source": "OpenStreetMap (Overpass API, Stand 2026-11-01)" },
    "flurstuecke": { "path": "vectors/flurstuecke.geojson", "crs": "EPSG:25832", "featureCount": 8672,
                     "label_de": "Flurstücke", "source": "ALKIS Saarland, WFS SL ALKIS Vereinfacht (abgerufen 2026-11-01); ALKIS Rheinland-Pfalz, …",
                     "labels": "vectors/flurstuecke_labels.geojson",
                     "polygons": "vectors/flurstuecke_polygons.geojson" }   // optional (POLISH), parcel lookup
  },
  "candidates": {
    // optional (F15), PRIVATE/local data, see "Candidates"
    "path": "candidates/candidates.geojson", "crs": "EPSG:25832", "featureCount": 214, "heights": "baked",
    "counts": { "pit": 120, "mound": 31, "linear": 44, "rect": 9, "platform": 10 },
    "classes": { "pit": "Grube/Trichter", "mound": "Hügel", "linear": "Graben/Wall/Weg", "rect": "Rechteckstruktur", "platform": "Plattform" },
    "method": "lrm-rules", "version": 1, "generated": "2026-11-01T12:00:00Z",
    "params": { "lrm_radius_m": [10, 25], "threshold_m": 0.3 }, "weights": { "depth": 0.4, "shape": 0.3 },
    "mask": { "path": "candidates/mask/{i}_{j}.png", "encoding": "class8", "minScore": 0.3, "chunks": [[2, 3]] },
    "label_de": "Verdachtsflächen"
  },
  "levels": [                                   // v2 only; fine → coarse, see "Levels (v2)"
    { "level": 0, "cellSize": 1, "chunks": { "nx": 6, "ny": 6 }, "size": { "width": 3000, "height": 3000 },
      "height": { "dtm": { "path": "dtm/{i}_{j}.png", "encoding": "terrarium", "apron": 1 } },   // = top-level height/layers
      "layers": { "vat": { "path": "relief/vat/{i}_{j}.png", "encoding": "u8", "min": 0, "max": 1, "label_de": "VAT (Kombination)" } /* … */ } },
    { "level": 1, "cellSize": 2, "chunks": { "nx": 3, "ny": 3 }, "size": { "width": 1500, "height": 1500 },
      "height": { "dtm": { "path": "levels/1/dtm/{i}_{j}.png", "encoding": "terrarium", "apron": 1 } },
      "layers": { "vat":       { "path": "levels/1/vat/{i}_{j}.png",       "encoding": "u8", "min": 0, "max": 1, "label_de": "VAT (Kombination)" },
                  "hillshade": { "path": "levels/1/hillshade/{i}_{j}.png", "encoding": "u8", "min": 0, "max": 1, "label_de": "Schummerung (multidirektional)" } } }
    // … level 2 (4 m, 2×2), 3 (8 m, 1×1), 4 (16 m, 1×1, size 188×188)
  ],
  "sources": [ { "tile": "382_5466", "provider": "LVGL-SL", "year": 2025, "product": "DGM1" } ],
  "attribution": "© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet; © GeoBasis-DE/LVermGeoRP (2026), dl-de/by-2-0, www.lvermgeo.rlp.de, Daten bearbeitet; © OpenStreetMap-Mitwirkende, ODbL"
}
```

**Attribution entries and dataset URIs (ADR 0026, V2.9).** `attribution` stays one `"; "`-joined string of verbatim Quellenvermerke; the year is the **year of retrieval** (2026 for every LVGL-SL and LVermGeoRP entry; manifests written with the old RLP tile year `(2022)` are healed in place by `merge_attribution` on any step's next write, or alone with `./run.sh <aoi> attribution`). A trailing `(<Layer>)` tag (`ALKIS`, `LoD2`, `DOP20`, `Historische Karten`) names the dataset. The „© Quellen“ dialog (`app/src/shell/attribution.ts`) maps provider + tag to the dataset URI (dl-de/by-2-0 §2 Nr. 3), so the manifest gains **no new field** and old manifests need no change. A new source whose provider the app does not know may put its dataset URI into its entry as a plain `https://…` URL (no `;`); the dialog links the first such URL. Unknown entries without a URL still show verbatim, without a dataset link.

Layer keys and value ranges may be tuned by the pipeline; the app must read `min`/`max`/`label_de` from the manifest and not hard-code them. Optional layers may be missing; the app hides missing ones.

**Manifest ownership.** Pipeline steps update `manifest.json` read–modify–write (`pipeline/common.py update_manifest`): each step replaces only the top-level keys it owns (`build.py`: `version` … `layers`, `levels`, `sources`, `build` — `version` and `levels` must be written together so they never disagree; `xyz.py`: `xyz`; later steps e.g. `vectors.<name>`, merged per sub-key) and keeps every other key. `attribution` remains one `"; "`-joined string; steps add/withdraw their own entries (entries must not contain `;`). Consumers must ignore unknown top-level keys. **Sub-key merges (F11/F13/F14):** `layers`, every `levels[k].layers`, `xyz` and `models` are merged **per sub-key** — `build.py` writes its own relief layer keys and must keep foreign keys it does not produce (`ortho`, `hist_*`, `bldg`, …) in `layers` and in `levels[k].layers` (for the same `k`); `xyz.py` writes `xyz.vat`/`xyz.slrm` merged into `xyz` (keeping `xyz.hist_*`); `ortho.py`/`historic.py`/`buildings.py` patch only their own `layers.<key>`, `levels[k].layers.<key>`, `xyz.<key>`, `models.buildings` sub-keys (read–modify–write).

## Vectors (optional, F10/F12)

`vectors` is an optional top-level key (additive, valid in v1 and v2; manifests without it remain valid and the app treats it as absent). Each sub-key is optional too:

```ts
VectorLayer = { path: string /* relative to the AOI dir */, crs: 'EPSG:25832', featureCount: number,
                label_de: string, source: string, heights?: 'baked' }
vectors = { osm?: VectorLayer,
            flurstuecke?: VectorLayer & { labels: string /* relative path */, polygons?: string /* relative path, optional */ } }
```

**Common file rules.** Each file is a GeoJSON `FeatureCollection` (UTF-8, no `crs` member required). Coordinates are **EPSG:25832 metres `[E, N]`, rounded to 0.01 m** — *not* the local frame. The app subtracts `E0`/`N0` in float64 before creating float32 buffers. Geometries are clipped to the AOI bbox (`E0 … E0 + width`, `N0 … N0 + height`) and **densified so no segment is longer than 2 m**, so the renderer can drape vertices on the terrain without visible chords. Heights are optional (see "Baked heights" below); without them the app samples the DTM (HeightQuery). Either way the app applies exaggeration (`y = hRef + (h − hRef) · exag`).

**Baked heights (optional, `heights: "baked"`).** A vector entry MAY carry `"heights": "baked"`. Then **every** coordinate in that layer's file(s) — for `flurstuecke` also the `labels` file, but **not** the `polygons` file (always 2D) — is `[E, N, z]` (RFC 7946 3rd value), where `z` = true DTM height in metres (no exaggeration), rounded to 0.01 m, sampled **bilinearly from the 1 m DTM** (level 0, after NoData fill): with fractional cell coordinates `u = E − E0 − 0.5`, `v = (N0 + height) − N − 0.5` (cell centres, row 0 = north), interpolate the four surrounding cells, indices edge-clamped to the AOI raster. Densification happens before baking (every densified vertex has its own z). App rule: per coordinate, use `z` when the coordinate has a finite 3rd value, otherwise fall back to HeightQuery — so draping no longer depends on which chunks/levels are loaded. Any other `heights` value is ignored (treated as absent). Note: baked z follows the 1 m surface; where the terrain is drawn from a coarse level the line can sit slightly above/below the coarse mesh. The renderer currently only applies its general lift + distance-proportional depth bias (no level-aware handling); coarse levels are drawn only far from the camera (screen-space error selection), where the offset is a few pixels at most.

**`vectors.osm`** → `vectors/osm.geojson`: `LineString` / `MultiLineString` features with properties
`{ kind: 'road'|'track'|'path'|'rail'|'water'|'barrier', name?: string, highway?: string, tracktype?: string, osm_id: string }` (`osm_id` e.g. `"way/123456"`; `highway`/`tracktype` are the raw OSM tag values).

**`vectors.flurstuecke`** → `vectors/flurstuecke.geojson`: parcel boundaries as `LineString` features, properties `{ kind: 'parcel' }`. Shared edges between neighbouring parcels are deduplicated where possible; otherwise each polygon ring is emitted as a closed `LineString`.
Labels → `vectors/flurstuecke_labels.geojson` (path in `labels`): `Point` features (one per parcel, inside it) with properties
`{ text: string /* Flurnummer: "ZAE" or "ZAE/NEN" */, flstkennz: string, gemarkung: string, flur: string, lage?: string }`.
Saarland label points come from the WFS `FlurstueckPunkt` type; Rheinland-Pfalz parcels (RLP WFS has no label points) get a representative point inside the parcel. RLP parcels have no Flur and carry `flur: "Flur 0"`; consumers must not display a Flur of `"Flur 0"`/`"0"`/`"000"`. Parcels that only touch the AOI edge may have no label.

Polygons (optional, POLISH) → `vectors/flurstuecke_polygons.geojson` (path in `polygons`): one `Polygon` or `MultiPolygon` feature per parcel, used by the app only for **point-in-polygon parcel lookup** (markers, measuring point, candidate confirm, reports) — not rendered. Exceptions to the common file rules: coordinates are `[E, N]` EPSG:25832 rounded to 0.01 m, **never** a z value (even with `heights: "baked"`), **not densified** (original ALKIS vertices) and **not clipped** — every parcel whose geometry intersects the AOI bbox is included whole. Rings follow GeoJSON nesting (first ring = outer boundary, further rings = holes); orientation is not guaranteed, so consumers must not depend on winding. Properties:
`{ flstkennz: string, gemarkung: string, flur: string, zae: string, nen?: string, text: string /* "ZAE" or "ZAE/NEN", same as the label */, lage?: string, flaeche_m2?: number /* amtliche Fläche (ALKIS) in m², omitted if the service has none */ }`.
`flstkennz`/`gemarkung`/`flur`/`text`/`lage` match the label point of the same parcel (same `"Flur 0"` rule for RLP). If several polygons contain a point (overlap at slivers), consumers take the first in file order. Without `polygons` (old manifests) the app falls back to the nearest label point (and the opt-in online lookup).

**Manifest + attribution.** Each vector step writes only its own sub-key via `update_manifest(aoi_dir, {"vectors": {"<name>": {...}}}, merge=["vectors"], attribution=[ATTRIBUTION_…])`: `vectors` is shallow-merged, so `osm` and `flurstuecke` steps run independently, and the step's attribution entry is merged into the `"; "`-joined `attribution` string (no duplicates, entries without `;`). OSM adds `© OpenStreetMap-Mitwirkende, ODbL`; Flurstücke add `© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (ALKIS)` and, only when RLP parcels are used, `© GeoBasis-DE/LVermGeoRP (2026), dl-de/by-2-0, www.lvermgeo.rlp.de, Daten bearbeitet (ALKIS)`.

**App tolerance.** Missing `vectors`, a missing sub-key, or a malformed entry (no string `path`, `crs` ≠ `EPSG:25832`, `flurstuecke` without string `labels`) → that layer is treated as absent (logged, not fatal). A `flurstuecke.polygons` that is not a non-empty string is dropped (logged) while the layer stays valid; a 404 on it disables only the polygon lookup. `featureCount` defaults to 0, `label_de`/`source` to empty strings. Unknown sub-keys are ignored. A 404 on a listed file hides that layer only.

## Image layers (`rgb`, optional, F13/F14)

An entry in `layers` (level 0) or `levels[k].layers` (k ≥ 1) with `encoding: "rgb"` is a colour image layer. It is additive: manifests without one stay valid, and consumers that only know `u8` must skip it (it has no `min`/`max`).

```ts
ImageLayer = {
  path: string,                // template with {i}, {j} (and optionally {level}); extension matches `format`
  encoding: 'rgb',
  format: 'webp' | 'jpg',      // 'png' tolerated; missing → inferred from the path extension
  pixelsPerChunk: number,      // px per chunk side: 1000 (0.5 m/px at level 0) or 500 (1 m/px; required value at k ≥ 1)
  kind: 'image',
  label_de: string,
  attribution?: string,        // informative; the same entry is also merged into the top-level `attribution`
  source?: string              // informative, e.g. "WMS sl_dop20_rgb (TrueDOP20 2025), abgerufen 2026-11-01"
}
```

**Grid.** One RGB8 image per chunk, `pixelsPerChunk × pixelsPerChunk`, covering **exactly** the chunk's 500 × 500 cells (no apron), row 0 = north. With `s = chunkSize · cellSize_k / pixelsPerChunk` metres per pixel (level 0: 0.5 m at 1000 px, 1 m at 500 px; level k at 500 px: `2^k` m), pixel `(px, py)` of chunk `(i, j)` has its **centre** at
`E = E0 + i · 500 · cellSize_k + (px + 0.5) · s`, `N = N0 + height − j · 500 · cellSize_k − (py + 0.5) · s`
(i.e. chunk-local `(px + 0.5) · 500 / pixelsPerChunk` cells east/south of the chunk's north-west corner). Pipeline: request WMS GetMap in EPSG:25832 with BBOX exactly on the chunk edges and `WIDTH = HEIGHT = pixelsPerChunk` (or crop one larger aligned request). Pixels outside the AOI/level raster (east/south edge chunks of coarse levels) may hold real imagery or black; the renderer must not rely on them. Coarse-level images are the downsampled (area mean) level-0 imagery at 500 px. Every listed chunk image exists for the full chunk grid of that level; a 404 hides that chunk's image only (fallback to relief shading).

**Decoding.** Colour-managed like a normal picture: three.js `texture.colorSpace = SRGBColorSpace`, default `createImageBitmap` options (do **not** pass `colorSpaceConversion: 'none'`); mipmaps allowed. The app keeps these entries out of the `u8` data-layer list (`Manifest.layers`) and exposes them as `Manifest.imageLayers` / `ManifestLevel.imageLayers`.

**Keys and labels.**

| key | `label_de` | source | pixelsPerChunk (level 0) |
|---|---|---|---|
| `ortho` | `Luftbild (DOP20)` | SL: WMS `sl_dop20_rgb` (TrueDOP20 2025); RLP fill: WMS `rp_dop20` (`image/png; mode=24bit`) | 1000 |
| `hist_1840` | `Karte 1836–41 (Bayer. Positionsblätter)` | WMS SL Historische Karten, layer `1` (Bayrische Originalpositionsblätter 1:25 000) | 500 (source scan is coarser) |
| `hist_1935` (optional) | `TK25 1935–40` | same WMS, layer `5` | 500 |
| `hist_1960` (optional) | `TK25 1957–65` | same WMS, layer `6` | 500 |

Further `hist_<year>` keys may follow the same pattern; the app must take labels from the manifest.

**`xyz.hist_*` (optional, F14).** Leaflet tiles of a historic map, EPSG:3857, same shape as `xyz.vat`: `{ url: 'xyz/hist_1840/{z}/{x}/{y}.png' | '….jpg', minZoom, maxZoom, bounds?, kind?: 'image', label_de?: string, attribution?: string }`. The minimap takes the label from `xyz.<key>.label_de`, else `layers.<key>.label_de`, else the key.

**Attribution entries** (merged into the top-level `attribution`, no `;` inside):
- DOP Saarland: `© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (DOP20)`
- DOP Rheinland-Pfalz (only if RLP imagery is used): `© GeoBasis-DE/LVermGeoRP (2026), dl-de/by-2-0, www.lvermgeo.rlp.de, Daten bearbeitet (DOP20)`
- Historic maps: `© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet (Historische Karten)` (licensor wording `© GeoBasis DE/LVGL-SL (Jahr)`, WMS id 2597 metadata, see `docs/research/04-cadastre-historic-maps.md` §5)

## Building mask (`layers.bldg`, optional, R0.7/F11)

`layers.bldg` = `{ path: 'relief/bldg/{i}_{j}.png', encoding: 'u8', min: 0, max: 1, label_de: 'Gebäudemaske' }`, level 0 only, 500 × 500 per chunk, same pixel ↔ cell mapping as other relief layers. Value `1` (byte 255) = building: a cell is set when its **centre** lies inside a LoD2 building footprint (GroundSurface polygons; if a building has none, the 2D outline of its other surfaces), then the mask is **dilated by 1 m** (one cell, 3 × 3). `0` = no building. Use: the renderer suppresses canopy over buildings (where `bldg ≥ 0.5`, draw the DTM / treat CHM as 0 instead of green canopy). It is a data layer (decode with `colorSpaceConversion: 'none'`), not meant as a relief mode.

## Models (`models.buildings`, optional, F11)

```ts
models = { buildings?: {
  path: 'models/buildings/{i}_{j}.glb',  // level-0 chunk template
  chunks: Array<[number, number]>,        // [i, j] of chunks that HAVE a file (only those are fetched)
  frame: 'local',
  featureCount: number,                   // buildings in total
  label_de: string,                       // 'Gebäude (LoD2)'
  attribution?: string,                   // informative; also merged into top-level `attribution`
  source?: string
} }
```

**Frame.** Positions are in the **local three.js frame**: `x = E − E0`, `y = h` (absolute DHHN2016 metres, true heights, **no exaggeration**), `z = −(N − N0)` — float32 is fine because coordinates are AOI-local. The app applies `y' = hRef + (y − hRef) · exag` to every vertex (custom material / `onBeforeCompile`), like everything else in 3D. Nodes carry no transforms (identity).

**Chunking.** Each building goes, whole and unsplit, into the level-0 chunk containing its footprint centroid (index clamped to the grid), so meshes may poke a few metres over chunk edges. Buildings entirely outside the AOI are dropped.

**glb content.** glTF 2.0 binary, one scene with **one mesh** per file (one primitive preferred; several allowed), mode TRIANGLES, indexed or not, **no textures, no images**; materials are optional and ignored by the app. Vertex attributes:
- `POSITION` — FLOAT VEC3 (local frame, metres)
- `NORMAL` — FLOAT VEC3, unit, outward (flat per face, i.e. vertices not shared across faces of different orientation)
- `_SURFACE` — SCALAR, `UNSIGNED_BYTE` (FLOAT tolerated), surface class per vertex: `0` = ground/closure/other, `1` = wall, `2` = roof. three.js `GLTFLoader` exposes it as geometry attribute `_surface`. `COLOR_0` is **not** used.

GroundSurface polygons may be omitted from the mesh (they sit on the terrain); they are used for `bldg`. Heights come from the LoD2 CityGML as delivered (SL `LoD2_32_{E}_{N}_1_SL.gml`, RLP `LoD2_32_{E}_{N}_2_RP.gml` from `geb3dlo`), with one exception: wall vertices at a GroundSurface height are lowered to min(DTM along the wall) − 0.3 m, by at most 5 m, so the flat LoD2 floor shows no gap on slopes (roofs never move). The pipeline reports the median offset of building ground heights vs. the DTM and the remaining gaps (`data/work/<aoi>/buildings.json`). In three.js `_surface` arrives as an `InterleavedBufferAttribute` (u8, stride 4 as glTF requires).

**Attribution entries:** `© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet (LoD2)`; only when RLP buildings are used, `© GeoBasis-DE/LVermGeoRP (2026), dl-de/by-2-0, www.lvermgeo.rlp.de, Daten bearbeitet (LoD2)`.

**App tolerance (F11/F13/F14 keys).** A malformed `rgb` layer (no string `path`, `pixelsPerChunk` not a positive integer) or `models.buildings` entry (no string `path`, `frame` ≠ `local`, `chunks` not an array) is dropped with a warning; malformed `[i, j]` pairs (non-integers or outside the level-0 chunk grid) are skipped. `label_de` defaults to the key, `featureCount` to 0. Unknown `models` sub-keys are ignored. A 404 on a listed file hides that chunk's content only.

## Candidates (`candidates`, optional, F15)

Semi-automatic relict candidates from `pipeline/detect.py` (rule-based, local relief + shape filters). They are **hypotheses, not findings**. `candidates` is an optional top-level key (additive, valid in v1 and v2); manifests without it stay valid.

**Privacy (heritage law, SDschG Saarland §§ 3, 8, 16; DSchG RLP).** Candidate files live under the git-ignored `app/public/data/<aoi>/candidates/` and are never committed to this repo; neither the pipeline nor the app sends them anywhere. The *relict* classes of the `overall` AOI are published only through the release export (see "Public release"; [ADR 0009](adr/0009-candidates-public-user-data-private.md)); the UXO classes below never are ([ADR 0010](adr/0010-craters-never-public.md)). Candidates carry no digging/detector guidance. Review decisions are **never** written into data files (see "Review decisions"). Every UI that shows candidates shows the hypothesis note and the "Schauen, nicht graben" disclaimer.

**UXO classes (`crater`, `crater_field`, codes 6/7).** The sister project `saar-lidar-detect` may write these UXO-indicator classes into the same files. They are **always private** ([ADR 0010](adr/0010-craters-never-public.md)): the explorer treats them as unknown classes in every build (features, counts, labels, decisions and mask codes 6/7 are ignored; `featureCount` is capped at the sum of known per-class counts), and the release export strips them (see "Public release"). Their format and viewer live in the private `sle-craters-private` repo (moved out in V2.1).

```ts
CandidateClass = 'pit' | 'mound' | 'linear' | 'rect' | 'platform'
               // 'crater' | 'crater_field' (6/7): saar-lidar-detect only, ignored by the explorer
candidates = {
  path: 'candidates/candidates.geojson',   // relative to the AOI dir
  crs: 'EPSG:25832',
  featureCount: number,                    // total features in the file
  counts: Partial<Record<CandidateClass, number>>,   // features per class (absent class = 0)
  classes?: Partial<Record<CandidateClass, string>>, // label_de per class; app defaults = table below
  heights?: 'baked',                       // as in "Vectors": every coordinate (point AND outline) is [E, N, z]
  method: string,                          // detector id, e.g. 'lrm-rules'
  version: number,                         // detector rule-set version (integer, bumped when rules/scoring change)
  generated?: string,                      // ISO 8601 UTC timestamp of the run
  params: Record<string, unknown>,         // thresholds/radii used (informative, shown in the panel)
  weights?: Record<string, number>,        // score weights (informative)
  mask?: { path: 'candidates/mask/{i}_{j}.png', encoding: 'class8', minScore: number,
           chunks?: Array<[number, number]> },   // [i, j] of level-0 chunks that HAVE a mask file; absent = all
  label_de?: string,                       // default 'Verdachtsflächen'
  evaluation?: Record<string, unknown>,    // informative (known-site recall, density per km²)
  // ---- additive keys written by saar-lidar-detect (all optional, informative unless noted) ----
  generator?: string,                      // e.g. 'saar-lidar-detect 0.1.0'
  method_version?: string,                 // primary '<method>/<ruleset>+sld.<version>'
  method_versions?: string[],              // every method_version in the file, e.g. lrm-rules/2+…
  detectors?: string[],                    // detectors that ran, e.g. 'relicts'
  data_dates?: string[],                   // distinct feature data_date values
  disclaimer_de?: string,                  // German hypothesis/heritage/UXO note (shown in the panel)
  tiling?: Record<string, unknown>         // tile grid of the run (informative)
}
```

**Classes** (fixed set; `mask` code in brackets):

| `class` | `label_de` | typical relicts | metrics expected |
|---|---|---|---|
| `pit` (1) | `Grube/Trichter` | pits, bomb craters, blasted bunkers | `depth_m`, `area_m2`, `diameter_m`, `circularity`, `rim_m`? |
| `mound` (2) | `Hügel` | burial mounds, spoil heaps | `height_m`, `area_m2`, `diameter_m`, `circularity` |
| `linear` (3) | `Graben/Wall/Weg` | ditches, banks, walls, hollow ways, terrace edges | `length_m`, `width_m`?, `depth_m` (ditch/hollow way) or `height_m` (bank/wall), `orientation_deg` |
| `rect` (4) | `Rechteckstruktur` | foundations, bunkers | `area_m2`, `rectangularity`, `length_m`, `width_m`, `orientation_deg`, `depth_m` or `height_m` |
| `platform` (5) | `Plattform` | charcoal-kiln platforms, terraces | `area_m2`, `diameter_m`, `circularity`, `slope_in_deg`, `height_m`? |

Known paths are not a separate class: a `linear` candidate with `along_path: true` (≥ 50 % of its centreline within 5 m of an OSM `road`/`track`/`path` way) is shown, filtered and saved as "Weg (bekannt)". `near_path` alone (which also counts `water`/`barrier` and lines that merely cross a way) is informative only. Older files without `along_path` read it as `false`.

**File `candidates.geojson`.** A GeoJSON `FeatureCollection` (UTF-8), features sorted by `score` descending. Coordinates follow the "Vectors" common rules: **EPSG:25832 `[E, N]` metres rounded to 0.01 m**, or `[E, N, z]` when `heights: "baked"` (z = true bilinear 1 m DTM height, no exaggeration). Features lie inside the AOI bbox.

- **`geometry`: always a `Point`** = the candidate's centre (polygon classes: centroid of the detected region, moved to the nearest inside cell centre if the centroid falls outside; `linear`: the point at half length along the centreline). Lists, fly-to, labels and markers use this point.
- **`properties.outline`** (optional, recommended): the extent as a GeoJSON geometry object — `Polygon` (exterior ring only, closed, counter-clockwise) for `pit`/`mound`/`rect`/`platform`, `LineString` (centreline) for `linear`. Same coordinate rules as the point (incl. baked z), simplified (≈ 0.5 m tolerance) then **densified to ≤ 2 m segments** so it can be draped. Without it the app draws a circle of `metrics.diameter_m` (fallback 5 m) around the point.

```ts
CandidateProps = {
  id: string,              // stable: `${class}-${round(E)}-${round(N)}` (centre, integer metres), e.g. "pit-382412-5466731";
                           // collisions get "-2", "-3" … in descending score order
  class: CandidateClass,
  score: number,           // 0..1, rounded to 0.01; higher = more likely anthropogenic
  metrics: {               // all optional, finite numbers, rounded to 0.01; unknown keys allowed (shown raw or ignored)
    depth_m?: number,      // > 0, metres below the surrounding surface (= −min local relief)
    height_m?: number,     // > 0, metres above the surrounding surface (= max local relief)
    area_m2?: number, diameter_m?: number /* 2·√(area/π) */, circularity?: number /* 4πA/P², 0..1 */,
    rectangularity?: number /* A / min-area rectangle, 0..1 */, length_m?: number, width_m?: number,
    orientation_deg?: number /* long axis, 0..180, clockwise from grid north */, slope_in_deg?: number,
    rim_m?: number         /* pit: mean rim height above surroundings (crater ejecta) */
  },
  reasons: string[],       // ≥ 1 short German phrases, e.g. ["rund, 0,8 m tief", "mit Randwall", "unter Wald"]
  forest: boolean,         // under canopy: ≥ 50 % of the footprint has CHM ≥ 3 m (false when no CHM)
  near_path: boolean,      // any `vectors.osm` way within 5 m of the outline (or point); false when no OSM data
  along_path?: boolean,    // linear only: ≥ 50 % of the centreline within 5 m of an OSM road/track/path → known path
                           // (score × 0.7); always false for other classes; missing → false
  near_known: string | null,  // `id` of the nearest pois.geojson site within 50 m, else null
  outline?: Polygon | LineString,
  // additive (saar-lidar-detect, optional): informative for every class
  member_ids?: string[],      // saar-lidar-detect UXO classes only; ignored
  method_version?: string,    // e.g. 'lrm-rules/2+sld.0.1.0'
  data_date?: string          // ISO year of the terrain data under the candidate ('2025', RLP '2022')
}
```

**Rule set 2 (v1.0, additive).** `method: "lrm-rules"`, `version: 2` = the version-1 fine rules unchanged plus a coarse pass for large structures on 2 m block means (large `rect`/`mound`/`platform` regions, moats around them and straight terrace scarps, both as `linear`). Fine-pass candidates keep their ids and scores; coarse ids continue the same collision counter. Every coarse candidate carries `metrics.scale_m` (analysis scale in metres: the local-relief radius for regions and moats, the 2 m cell for scarps); further informative metrics may appear (`flank_slope_deg`, `slope_break_deg`, `top_flat`, `moat_coverage`, `straightness`, `side_slope_deg`) — consumers show or ignore unknown metric keys as above. `evaluation.*.chance_hit_rate` is now the share of the AOI area within the radius of any candidate (`chance_hit_rate_poisson` keeps the old density estimate); `evaluation` stays informative.

**Mask (optional).** `candidates/mask/{i}_{j}.png`, level 0 only, 500 × 500 single-channel 8-bit PNG per chunk, same pixel ↔ cell mapping as relief layers (no apron, row 0 = north). Encoding `class8`: the raw byte **is the class code** (0 = none, 1 = pit, 2 = mound, 3 = linear, 4 = rect, 5 = platform; unknown codes — incl. the private 6/7 — read as 0; no min/max scaling; decode with `colorSpaceConversion: 'none'`). A cell is set when its centre lies inside the outline polygon (`linear`: within 1 m of the centreline; no outline: within `diameter_m / 2`, fallback 2.5 m) of a candidate with `score ≥ minScore`; on overlap the higher-scored candidate wins. The mask cannot be filtered by score — the app's min-score filter works on the GeoJSON; the mask is a coarse highlight only. The app's min-score filter starts at `params.min_score` when it is a finite number (fallback 0.3), never at `mask.minScore`. It is **not** a `layers` entry (not a relief mode). Only chunks listed in `chunks` are fetched; a 404 hides that chunk's mask.

**Review decisions** (app only, never in data files): `localStorage` key `sle.candidates.v1.<aoi>`, JSON
`{ version: 1, decisions: { [id]: { status: 'confirmed' | 'rejected' | 'unsure', at: string /* ISO */, class: CandidateClass, E: number, N: number, score: number, markerId?: string } } }`. `class`/`E`/`N` let the app re-attach a decision whose `id` vanished after a re-run to the nearest same-class candidate within 3 m. Confirming creates a normal private marker (`sle.markers.v1`) whose id is stored in `markerId`. Export of decisions is a user-triggered local download only. The export document (`type: "sle-candidate-decisions"`, `version: 1`, `aoi`, `exported`, `detector`, `note`, `counts`, `decisions`) is what `sld review import` reads; Optional `classes: Partial<Record<CandidateClass, number>>` (decisions per class) — readers ignore it.

**Manifest + attribution.** `detect.py` owns the whole `candidates` key (replaces it on each run, read–modify–write via `update_manifest`, keeps all other keys) and adds no attribution entry (derived from the already attributed DGM/OSM). `build.py` keeps it.

**App tolerance.** Missing `candidates`, no string `path`, or `crs` ≠ `EPSG:25832` → absent (logged, not fatal). `featureCount` defaults to 0, `counts` to `{}` (non-numeric or unknown-class entries dropped), `classes` merged over the default labels, `method` to `''`, `version` to 0, `params` to `{}`. A malformed `mask` (no string `path`, `encoding` ≠ `class8`) is dropped; invalid `[i, j]` pairs are skipped as for `models.buildings`; `minScore` defaults to 0. Features with an unknown `class`, a non-Point geometry or a non-finite `score` are skipped; missing `reasons` → `[]`, missing booleans → `false`, missing `near_known` → `null`. A 404 on `path` hides the candidate layer only. `along_path` is read for `linear` only; the additive manifest keys are optional (`method_versions`/`detectors`/`data_dates` keep string entries, `disclaimer_de` a non-empty string). `crater`/`crater_field` (and any other unknown class) are dropped from features, counts and labels in every build; `featureCount` is capped at the sum of the known counts.

## Point clouds (`pointclouds`, optional, F16)

Classified ALS 2025 points for a few focus areas (Karlsberg palace, Homburg Schlossberg, Merburg; ≈ 1 km² each). `pointclouds` is an optional top-level key (additive, valid in v1 and v2); manifests without it stay valid. **No Potree/Docker** (docs/history/prd-v1.md §9): the pipeline reads the LAZ with `laspy` + `lazrs` and writes this simple tiled format, `sle-pts-v1`.

**Source frame.** The LVGL LAZ 2025 files carry **no CRS VLR**: coordinates are EPSG:25832 (E, N in metres, scale 0.01 m) and heights DHHN2016 (m), like the DGM. Other providers (RLP) must be checked for the same frame before use.

```ts
pointclouds = {
  format: 'sle-pts-v1',                  // anything else → the whole key is ignored
  tileSize: 100,                         // metres (tile side); default 100
  crs?: 'EPSG:25832',                    // informative; heights DHHN2016
  areas: Array<{
    id: string,                          // /^[\w-]+$/, unique, e.g. 'karlsberg-schloss'
    name_de: string,                     // 'Schloss Karlsberg' (default: id)
    bbox: [Emin, Nmin, Emax, Nmax],      // EPSG:25832, multiples of tileSize, Emin < Emax, Nmin < Nmax, inside the AOI
    tiles: Array<[tx, ty, count]>,       // only tiles that HAVE a file (count ≥ 1 points)
    path: 'pointclouds/<id>/{tx}_{ty}.bin',   // relative to the AOI dir
    pointCount: number,                  // Σ count (app default: that sum)
    density_per_m2: number,              // pointCount / bbox area (app default: computed)
    classCounts?: Record<string, number>,      // points per LAS class code (decimal string)
    heightRange?: { min: number, max: number }, // true heights (m) of the stored points
    intensityMax?: number,               // raw LAS intensity mapped to 255 (see records)
    source?: string[]                    // LAZ tile names used (informative)
  }>,
  classes: Record<string, string>,       // LAS class code (decimal string) → label_de; app merges over its defaults
  attribution?: string                   // informative; also merged into top-level `attribution`
}
```

**Tiles.** Tile `(tx, ty)` of an area covers `E ∈ [Emin + tx·tileSize, Emin + (tx+1)·tileSize)`, `N ∈ [Nmin + ty·tileSize, Nmin + (ty+1)·tileSize)` (half-open, **ty counts northwards** from the south edge — unlike chunk `j`). `0 ≤ tx < (Emax − Emin)/tileSize`, `0 ≤ ty < (Nmax − Nmin)/tileSize`. Points outside the bbox are not stored. `{tx}`/`{ty}` in `path` are substituted with the decimal integers.

**Binary tile `.bin` (little-endian).** File size is exactly `16 + 10 · count` bytes.

| Offset | Type | Field |
|---|---|---|
| 0 | 4 × u8 | magic `SLEP` (ASCII `53 4C 45 50`) |
| 4 | u16 | version = 1 |
| 6 | u16 | reserved = 0 (ignored) |
| 8 | u32 | `count` points |
| 12 | f32 | `hBase` (m, DHHN2016) = minimum height of the tile's points, floored to 0.01 m |

then `count` records of **10 bytes** at offset `16 + 10·k`:

| Offset | Type | Field | Decode |
|---|---|---|---|
| 0 | u16 | `x` cm from the tile's lower-left E, 0…10000 | `E = Emin + tx·tileSize + x / 100` |
| 2 | u16 | `y` cm from the tile's lower-left N, 0…10000 | `N = Nmin + ty·tileSize + y / 100` |
| 4 | u16 | `h` cm above `hBase` (≤ 655.35 m) | `h_true = hBase + h / 100` |
| 6 | i16 | `agl` cm above ground: `Z − DTM(E, N)`, DTM = bilinear 1 m DGM (cell centres, PixelIsArea; same values as the app's `heightAt`), clamped to ±327.67 m | `agl / 100` |
| 8 | u8 | `cls` LAS classification code | see `classes` |
| 9 | u8 | `intensity` = `clip(round(I · 255 / intensityMax), 0, 255)` | relative brightness |

Encoding rounds to the nearest centimetre (LAZ coordinates are already cm-exact). Points whose height exceeds `hBase + 655.35 m` and LAS `withheld` points are dropped; all classes are otherwise kept (the app filters by class). All u16/i16 fields sit at even offsets and the header is 16 bytes, so the file body can be uploaded unchanged as **one interleaved WebGL vertex buffer** (byte offset 16, stride 10: `x,y,h` as unsigned shorts, `agl` as a short, `cls`,`intensity` as unsigned bytes).

**Progressive LOD.** Records are stored in a **random permutation** (deterministic seed per tile, e.g. `crc32("<id>/<tx>_<ty>")` for `numpy.random.default_rng`), so **any prefix of n records is a uniform random subsample** of the tile. The renderer reaches a level of detail with `drawRange` (`n = ⌈count · f⌉`, same fraction `f` for neighbouring tiles keeps the density uniform) and never re-sorts.

**World frame in the app.** Like everything else: `x = E − E0`, `z = −(N − N0)`, `y = hRef + (h_true − hRef) · exag` (the terrain's exaggeration uniforms). Per tile the vertex shader adds the tile origin `(Emin + tx·tileSize − E0, hBase, −(Nmin + ty·tileSize − N0))`; never put raw UTM into float32. `agl` is exaggeration-free (used for height-above-ground clipping, e.g. hide `agl > 2 m` for an "X-ray" view of the ground).

**Classes** (LVGL ALS 2025 code list, [research/01](research/01-data-sources.md); app defaults, manifest `classes` overrides/extends):

| Code | `label_de` | meaning | measured 3dm_32_382_5466 (Karlsberg, 4.0 pts/m²) |
|---|---|---|---|
| 1 | `Unklassifiziert` | unclassified, moving objects, outliers | 1 448 (0.04 %) |
| 2 | `Boden` | ground incl. earthworks, terraces | 1 267 332 (31.7 %) |
| 6 | `Gebäude` | buildings | 672 (0.02 %) |
| 8 | `Wasser (synthetisch)` | synthetic water points | – |
| 9 | `Wasser` | water | – |
| 14 | `Leitungen` | power lines, catenary | – |
| 17 | `Brücke` | bridge deck | – |
| 20 | `Sonstige` | non-ground in general: vegetation, other structures, carports, guard rails | 2 726 941 (68.2 %) |
| 24 | `Keller` | basement points: cellar stairs, light wells, pools | 22 |
| 30 | `Füllpunkte (synthetisch)` | synthetic surface points (gap fill under houses or dense vegetation; LAS `synthetic` flag set) | 2 255 (0.06 %) |

The pipeline writes in `classes` every code present in its areas (with these labels); a code the app has no label for is shown as `Klasse <n>`.

**Size.** ≈ 4 pts/m² → ≈ 40 000 points and ≈ 0.4 MB per 100 m tile, ≈ 40 MB per km² (uncompressed; the dev server/browsers may gzip). GPU: 10 B per resident point (3 M points ≈ 30 MB).

**Manifest + attribution.** The point-cloud step owns the whole `pointclouds` key (replaced on each run via `update_manifest`, all other keys kept; `build.py` keeps it) and adds `ATTRIBUTION_SL` (`© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet`) — plus `ATTRIBUTION_RLP` only if RLP LAZ is used — to the top-level `attribution`.

**App tolerance.** Missing `pointclouds`, a non-object, or `format` ≠ `sle-pts-v1` → absent (logged, not fatal). `tileSize` must be a positive number (default 100). An area is dropped when its `id` is missing/invalid/duplicate, `bbox` is not 4 finite numbers with `Emin < Emax`, `Nmin < Nmax` and sides that are whole multiples of `tileSize`, or `path` lacks `{tx}`/`{ty}`. `tiles` entries that are not three integers with `0 ≤ tx < nx`, `0 ≤ ty < ny`, `count ≥ 1` are skipped (duplicates removed). `name_de` defaults to `id`, `pointCount` to the sum of tile counts, `density_per_m2` to `pointCount / area`. `classes` merges over the default table above (keys must be integers 0–255, labels non-empty). No valid area → `pointclouds` absent. A tile whose bytes fail the header check (magic, version 1, size `16 + 10·count`) or 404s is skipped; the rest of the area still shows.

## Shared datasets — reconstruction models (`data/shared/<id>/`, sle-recon-v1, F19)

A **reconstruction model** is an AOI-independent dataset produced by a separate project, not by `pipeline/`. The first one is the hypothetical reconstruction of Schloss Karlsberg in summer 1789, written by the castle viewer (`zones/schloss-karlsberg/`, `pnpm run export:explorer`) to **`app/public/data/shared/karlsberg1789/`** (git-ignored, regenerable). It is **not a manifest key**: old and new manifests are unaffected, and every AOI may show it. The app fetches `<dataRoot>shared/karlsberg1789/index.json` (`dataRootUrl()`, i.e. `<base>data/` or `VITE_DATA_URL`); `vite build` does not copy `data/shared/` into `dist/` (like AOI data, `pnpm preview` serves it from the data dir).

The content is a **hypothesis, not a finding**: every UI that shows it says so and keeps the "Schauen, nicht graben" disclaimer. The dataset is only served locally (no public hosting). Files are untrusted data — nothing from them is executed or injected as HTML.

### `index.json`

```jsonc
{
  "format": "sle-recon-v1",                       // required, exact
  "id": "karlsberg1789",                          // [A-Za-z0-9_-]{1,64}
  "label_de": "Rekonstruktion 1789 (Hypothese)",  // panel / layer label
  "name_de": "Schloss Karlsberg – Rekonstruktion Sommer 1789",
  "crs": "EPSG:25832",                            // required, exact
  "heightDatum": "DHHN2016",
  "origin": { "E0": 381000, "N0": 5465000 },      // model frame: x = E − E0, y = h (true), z = −(N − N0)
  "anchor": { "E": 381512.0, "N": 5466170.0, "enterRadius_m": 300 },  // palace centre; "Schloss betreten" radius
  "bboxEN": [[380900.0, 5465800.0], [382300.0, 5466700.0]],          // [[Emin, Nmin], [Emax, Nmax]] of the model
  "files": { "model": "buildings.glb", "footprints": "footprints.geojson" },  // relative to index.json
  "viewer": { "url": "http://localhost:5260/" },  // full castle viewer (handover target)
  "attribution": "entry 1; entry 2",              // one string, entries joined by "; ", no ';' inside an entry
  "disclaimer_de": "Hypothetische Rekonstruktion, kein Befund. Schauen, nicht graben.",
  "generated": "2026-11-01T12:00:00Z",
  "catalogueVersion": 2,
  "buildings": [
    { "id": "KB-B01", "name_de": "Hauptschloss", "cls": "CDL", "confidence": "high",   // "high" | "med" | "low"
      "eaves_h": 356.0, "ridge_h": 362.7,                     // true heights, m DHHN2016 (optional)
      "bbox_local": [[x, y, z], [x, y, z]],                   // model frame (optional)
      "sources_de": ["≤ 3 short strings"] }
  ]
}
```

### `buildings.glb` (`files.model`)

glTF 2.0 binary, one scene, **one node + mesh per building, `node.name` = building `id`** from `index.json`; site features of the 1789 model (walls, terraces, ponds) may be extra nodes named `site:<id>`. The app reads the node name from the glTF JSON (three's `GLTFLoader` sanitises `Object3D.name`, e.g. `site:wall` → `sitewall`); a node with several primitives counts as one building. Nodes carry identity transforms (a transform added by quantization is tolerated — the app bakes it into the vertices). Positions are in the **model frame** above, true heights (no exaggeration). Content = the light LOD1 exterior (massing, roofs, facade relief): **no interiors, no trees, no textures, no images**; ≤ 15 MB, ≤ ≈ 600 k triangles. Vertex attributes (three.js names in brackets):

- `POSITION` (`position`), `NORMAL` (`normal`) — required/expected; missing normals are computed.
- `COLOR_0` (`color`) — **linear** RGB (VEC3 or VEC4; float or normalised u8/u16), baked from the material base colours (walls, roofs, stone read right without textures). Missing → neutral stone grey.
- `_CONF` (`_conf`) — SCALAR `UNSIGNED_BYTE`, **not normalised**, confidence per vertex: `0` = low, `1` = med, `2` = high (drives the colour mode *Konfidenz*). A normalised flag is ignored (values are class ids). Missing → taken from the building's `confidence` in `index.json` (`site:` / unknown nodes → low).
- Compression: `EXT_meshopt_compression` + `KHR_mesh_quantization` (gltf-transform). The app decodes with three's bundled `three/examples/jsm/libs/meshopt_decoder.module.js` (no extra dependency).

**Base skirts.** The explorer shows the **2025** terrain (ruin pits), not the reconstructed 1789 terrain: every building's walls reach down to min(2025 DTM under its footprint) − 0.5 m, so nothing floats; skirts may sink into the terrain.

### `footprints.geojson` (`files.footprints`, optional)

FeatureCollection in **EPSG:25832** (metres; a `crs` member may say so), one `Polygon` (or `MultiPolygon`) per building, properties `{ id, name_de, confidence }`. Used for the minimap outlines (converted to WGS84 with the proj4 definition above). Features with non-UTM-looking coordinates (|E| outside 100 000–900 000 or N outside 1 000 000–9 500 000) or without a string `id` are skipped.

### Placement in an AOI

For an AOI with origin (`E0_aoi`, `N0_aoi`) the whole model is translated by `(E0_model − E0_aoi, 0, −(N0_model − N0_aoi))` (one `Object3D.position`; float32 stays AOI-local). If `bboxEN` does not intersect the AOI rectangle the layer is not offered for that AOI (e.g. `fixture`). A building node whose bounding box does not lie fully on the AOI terrain is hidden and not pickable (it would float past the terrain edge, e.g. the Karlslust buildings KL-B40–49 south of AOI `karlsberg`); a `site:` node only needs to overlap the AOI. The minimap draws a footprint only when its building node is shown (before the glb has loaded: the same rule applied to the footprint's EN bounding box). Every vertex follows the **exaggeration rule** `y' = hRef + (y − hRef) · exag` in the vertex shader (same shared uniforms as the terrain and LoD2 buildings; the normal becomes `(nx, ny/exag, nz)`).

### App tolerance

- `index.json` 404, network error, invalid JSON, `format` ≠ `sle-recon-v1`, `crs` ≠ `EPSG:25832`, missing/invalid `origin`, `anchor`, `bboxEN` (non-finite or min ≥ max) or `files.model` → **dataset absent** (logged once, not fatal; no UI).
- Unknown keys are ignored (top level and inside entries). Defaults: `label_de` → "Rekonstruktion (Hypothese)", `name_de` → `label_de`, `attribution` → "", `disclaimer_de` → the text above, `anchor.enterRadius_m` → 300 (clamped to 1–2000 m).
- `files.*` must be plain relative paths (`[A-Za-z0-9_./-]`, no `..`, no scheme, no leading `/`); otherwise the file is treated as absent (`model` → dataset absent).
- `viewer.url` must parse as an http(s) URL on a local host (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`, `*.test`, no credentials); otherwise `http://localhost:5260/` is used.
- Malformed building entries (not an object, no string `id`, duplicate `id`) are skipped; an invalid `confidence` becomes `low`; non-finite numbers are dropped; `sources_de` keeps at most 3 strings (each ≤ 200 chars).
- glb 404 / parse error → the layer shows "nicht geladen" and stays empty (no retry until reload). Nodes without a matching building entry are shown but not pickable for an info card (except `site:` nodes, which show a generic card).
- `footprints.geojson` missing/invalid → no minimap outlines; the 3D layer still works.

### Camera handover (explorer ⇄ castle viewer)

Both directions use **true heights** (m DHHN2016, no exaggeration), **heading in degrees clockwise from UTM grid north** and **pitch in degrees, negative = looking down** — the same values as the explorer's URL hash. E/N/h are rounded to 0.1 m, angles to 0.1° (heading normalised to [0, 360)).

**Explorer → viewer** ("Schloss betreten", only while the layer is on and the camera is within `anchor.enterRadius_m` horizontally):

```
<viewer.url>?src=explorer&E=<m>&N=<m>&h=<m>&heading=<deg>&pitch=<deg>&mode=fliegen|gehen&back=<encodeURIComponent(explorer URL incl. hash)>
```

`h` is the camera's true height (`terrain.fromDisplayY(camera.y)` with the current exaggeration). `back` is the explorer page URL (origin + path + query, e.g. `?aoi=karlsberg`) plus the freshly formatted hash of the current state. `mode=gehen` asks the viewer to start in walk mode at the nearest entrance. Opened in the same tab (`location.assign`).

**Viewer → explorer** ("Zurück zur Karte"): target = the validated `back` URL (http/https and a local host as above; otherwise ignored) or `http://localhost:5240/`. The viewer replaces the **first five comma-separated hash fields** with its current pose `E,N,h,heading,pitch` (rounded as above) and keeps all remaining fields (layer, overlay, exaggeration, …); a target without a hash gets just the five fields. The explorer's existing hash parser applies it (true height → display y with the current exaggeration). Navigation in the same tab.

## 3D print tiles (moved out, V2.1)

F21 (`print3d.py`, sle-print3d-v1 tiles, the in-app planner) moved to the separate local repo `sle-print` (with its contract `docs/data-contract-print.md`). The explorer no longer reads or ships `data/print/`.

## Levels (v2, F9)

`levels` is an array ordered **fine → coarse**; `levels[k].level === k`, contiguous from 0. Level 0 is the existing 1 m data: it repeats the top-level `cellSize`, `chunks`, `size`, `height`, `layers` (same paths) and is informative — the app always builds level 0 from the top-level keys. The pipeline writes coarse levels **k = 1 … 4** (cell size 2, 4, 8, 16 m); the app must cope with any number of coarse levels (including none).

```ts
Level = {
  level: number,                       // k
  cellSize: number,                    // metres = cellSize₀ · 2^k  (1, 2, 4, 8, 16)
  chunkSize?: number,                  // optional; if present must equal the top-level chunkSize (500)
  size: { width: number, height: number },   // level raster in cells = ceil(size₀ / 2^k)
  chunks: { nx: number, ny: number },  // ceil(size.width / 500), ceil(size.height / 500) = ceil(size₀ / (500 · 2^k))
  height: { dtm: { path: 'levels/{k}/dtm/{i}_{j}.png', encoding: 'terrarium', apron: 1 } },   // no dsm at k ≥ 1
  layers: { vat: LayerSource, hillshade: LayerSource }   // path 'levels/{k}/<key>/{i}_{j}.png', u8, same min/max/label_de/unit as the top-level layer
}
```

Paths are written with the level number substituted (`levels/2/dtm/{i}_{j}.png`); a literal `{level}` in a path is also accepted and substituted by the app. Coarse levels carry **only `vat` and `hillshade`** plus, optionally, downsampled `rgb` image layers (`pixelsPerChunk: 500`, path e.g. `ortho/levels/{k}/{i}_{j}.webp` — kept outside `levels/` because `build.py` recreates that folder — same key/label as the top-level entry; see "Image layers"); `bldg` and other u8 layers stay level-0 only; the app must render a level without the currently selected layer by falling back (e.g. to `hillshade`/neutral shading) rather than failing. Levels whose entry is malformed (wrong `level`/`cellSize`/`chunks`/`size`, no terrarium `height.dtm`) end the list: the app keeps the valid contiguous prefix.

**Grid.** Every level is anchored at the AOI's **north-west corner** (`E0`, `N0 + height`), like level 0, with the same `chunkSize = 500` cells, so a level-k chunk covers `500 · 2^k` m and exactly the 2 × 2 level-(k−1) chunks `(2i … 2i+1, 2j … 2j+1)` (children beyond the level-(k−1) grid simply don't exist). Level-k cell `(c, r)` has its **centre** at `E0 + (c + 0.5) · cellSize`, `N0 + height − (r + 0.5) · cellSize` (`height` = AOI height in metres); its value is the **mean of the 2^k × 2^k block** of 1 m cells `c₀ ∈ [c·2^k, (c+1)·2^k)`, `r₀ ∈ [r·2^k, (r+1)·2^k)`. At the east/south AOI edge a partial block is padded by **edge clamp** (1 m indices clamped to `[0, width−1]`, `[0, height−1]`, i.e. `numpy.pad(mode="edge")` to a multiple of 2^k before averaging), so the level raster can extend past the AOI by less than one cell (e.g. Karlsberg 3000 m at 16 m → 188 cells = 3008 m); the renderer should clamp vertices to the AOI rectangle.

**Images.** Same rules as level 0, in level-k cells: height images 502 × 502 with a 1-cell apron, pixel `(px, py)` ↔ level cell `(i·500 − 1 + px, j·500 − 1 + py)`; relief images 500 × 500, pixel ↔ `(i·500 + px, j·500 + py)`. Every chunk image has the full size; cells outside the level raster (`c ≥ size.width`, `r ≥ size.height`, or < 0) are **edge-clamped** to the level raster, so only the first `min(500, size.width − i·500)` × `min(500, size.height − j·500)` cells of a chunk are real data. Heights: block mean of the float 1 m DTM (after NoData fill, float64), then `terrarium`. Layers: block mean of the level-0 layer values (unquantised float where available, else the decoded u8 values), re-encoded `u8` with the top-level `min`/`max`.

**Sizes (overall AOI, 6000 × 8000 m).** Level 0: 12 × 16 = 192 chunks; level 1: 6 × 8 = 48; level 2: 3 × 4 = 12; level 3: 2 × 2 = 4; level 4: 1 × 1 = 1.

### GPU memory per chunk (streaming budget)

| Resource | Texture | Bytes |
|---|---|---|
| DTM heights (any level) | 502² × 4 B (decoded R32F; RGBA8 Terrarium would be the same) | 1 008 016 ≈ 0.96 MiB |
| DSM heights (level 0, canopy on) | 502² × R32F | 1 008 016 ≈ 0.96 MiB |
| relief layer, each resident | 500² × R8 | 250 000 ≈ 0.24 MiB |
| `rgb` image layer, 1000 px (level-0 `ortho`) | 1000² × RGBA8 (+⅓ mipmaps) | 4 000 000 (≈ 5.3 MB with mips) ≈ 3.8 MiB |
| `rgb` image layer, 500 px (historic maps, coarse levels) | 500² × RGBA8 (+⅓ mipmaps) | 1 000 000 (≈ 1.3 MB with mips) ≈ 0.95 MiB |
| `rgb` image layer, 250 / 125 px (decode tiers, see below) | 250² / 125² × RGBA8 (+⅓ mipmaps) | ≈ 0.34 / 0.09 MB with mips |
| `bldg` mask (level 0, with canopy) | 500² × R8 | 250 000 ≈ 0.24 MiB |
| building mesh (per chunk with buildings) | vertex buffers, ≈ 25 B/vertex | typically 0.1–2 MB |
| per-chunk low-pass for live local relief (only while it is shown) | ≈ 502² × R32F | ≈ 0.96 MiB |
| geometry | shared per LOD spacing, not per chunk | ≈ 0 |

Typical chunk (DTM + 2 resident layers) ≈ **1.5 MB**, with canopy ≈ 2.5 MB, worst case (all 9 level-0 layers + DSM + low-pass) ≈ 5.3 MB. No mipmaps (data textures use Nearest/Linear without mips). The JS heap keeps a ~1 MB Float32 copy of each height texture (HeightQuery, skirts). Overall AOI, everything resident: level 0 ≈ 290 MB (≈ 480 MB with canopy), levels 1–4 (65 chunks) ≈ 100 MB — far below the 1.5 GB acceptance bound. The app still enforces an explicit budget so larger AOIs stay bounded: 600 MiB soft (hard cap 1400 MiB), LRU eviction, coarsest level pinned (`app/src/terrain/budget.ts`); measured peak on an overall flight 382.6 MB.

**Image decode tiers (perf pass).** The files stay at `pixelsPerChunk` (no data change); the app decodes each chunk's `rgb` image at the smallest of P₀, P₀/2, P₀/4 … (≥ 125 px) that still gives ≥ 1 texel per CSS pixel at the chunk's nearest point (`createImageBitmap` resize, `app/src/terrain/imageRes.ts`), re-decodes it when the camera approaches (up) or recedes (down, 20 % band), and under budget pressure halves image detail once before the mesh is coarsened. Byte accounting uses the decoded size. The 1-texel apron is built from neighbour edges resampled to the chunk's own tier, so chunks at different tiers stay seamless.

## 🗺️ Many places (v3, S2): global grid, presence, catalog, central overview, slim formats

Plan: [orte-skalieren.md](plans/orte-skalieren.md) §4, §5, §9 S2 and the [S0 report](plans/orte-skalieren-s0.md) §3. Decisions: [ADR 0052](adr/0052-one-repo-per-municipality-central-catalog.md) (one repo per Gemeinde + catalog), [ADR 0055](adr/0055-global-grid-tile-ownership-central-overview.md) (grid, ownership, presence, overview), [ADR 0056](adr/0056-slim-formats-live-relief.md) (slim formats, live relief), [ADR 0053](adr/0053-relict-candidates-opt-in-new-places.md) (candidates opt-in). **Revision 3.0** adds three things, all versioned so old readers fail loudly instead of misrendering:

| Format | File | Written by |
|---|---|---|
| manifest `version: 3` | `<data_url>manifest.json` of a place (or any AOI on the global grid) | pipeline (place build) |
| `sle-catalog-v1` | `catalog.json` of `Open-Kirrberg/orte-katalog` | catalog build |
| `sle-overview-v1` | `overview/overview.json` (+ chunk images) | catalog build |

v1 and v2 manifests keep their meaning and stay loadable (R9). The app has two session modes:
- **Single-AOI mode** (`?aoi=<id>`, or no catalog configured): today's behaviour, one manifest (v1, v2 or v3), session origin = its `origin`, its own levels.
- **Catalog mode** (build-time `VITE_CATALOG_URL` set, absolute or relative to the page, and no `?aoi=` in the URL): the app loads the catalog, the overview and the v3 manifests of the places around the camera, and streams all of them into one world. If the catalog fails to load or validate, the app falls back to single-AOI mode with the preferred AOI (logged, not fatal).

### Global grid (`sle-grid-25832-v1`)

| Constant | Value |
|---|---|
| CRS | EPSG:25832, cell size 1 m (PixelIsArea, cell centres at +0.5 m as in "Grid & chunks") |
| origin (south-west corner) `Eg, Ng` | **E 300 000, N 5 400 000** |
| extent `Wg = Hg` | **256 000 m** → north-west corner `(Eg, NgTop) = (300 000, 5 656 000)` |
| tile | 1 000 m square; **tile id** = `"{E/1000}_{N/1000}"` of its south-west corner, e.g. `"382_5466"` (= `sources[].tile` and the LVGL / GeoBasis RLP file names); valid tiles: `300 ≤ E/1000 < 556`, `5400 ≤ N/1000 < 5656` |
| level-k chunk side `S_k` | `500 · 2^k` m (level 0: 500 m, 1: 1 km = one tile, 2: 2 km … 9: 256 km); `k ≤ 9` |

Manifests and the overview declare the grid as

```jsonc
"grid": { "id": "sle-grid-25832-v1", "origin": { "E": 300000, "N": 5400000 }, "extent_m": 256000, "tile_m": 1000, "chunk_m": 500 }
```

and a reader rejects any other value (catalog mode: the source is not placeable; single-AOI mode: loaded as a standalone AOI).

**Global chunk address** `(k, I, J)`: `I` counts east, `J` counts **south** (row order, like `j`), both from the NW corner: a chunk with west edge `Ew` and north edge `Nn` has `I = (Ew − Eg) / S_k`, `J = (NgTop − Nn) / S_k`. Because `Hg` is a multiple of every `S_k` (k ≤ 9), alignment counted from the south and from the north is the same.

**Aligned rectangle.** A rectangle `[E0, N0, E0 + W, N0 + H]` (metres) is *aligned at G* when `(E0 − Eg) mod G = 0`, `(N0 − Ng) mod G = 0`, `W mod G = 0`, `H mod G = 0`. **Every v3 manifest rectangle is aligned at 1 000 m**; the overview rectangle is aligned at `S_K` of its coarsest level `K`. Chunk indices `(i, j)` in paths stay **relative to the rectangle's NW corner**, exactly as in "Grid & chunks" and "Levels" (so loaders and the chunk writer keep their formulas), and convert to global addresses by

`I = i + (E0 − Eg) / S_k`, `J = j + (NgTop − (N0 + H)) / S_k` — integers for every level the file carries (places: k ∈ {0, 1}; overview: 2 ≤ k ≤ K).

**Coverage check (2026-11-08).** Saarland bbox `[308000, 5441000, 388000, 5501000]` (AOI `saarland`), Zweibrücken / Bechhofen (E ≤ 402 000) and all of Rheinland-Pfalz except a ≈ 6 km strip of the western Eifel (E ≈ 294 000 near Prüm) lie inside; extending west needs a new grid id. Existing AOIs:

| AOI | rectangle | aligned at 1 km? |
|---|---|---|
| karlsberg | 381000–384000 × 5465000–5468000 | ✅ |
| homburg | 378000–381000 × 5463000–5466000 | ✅ |
| overall | 378000–384000 × 5460000–5468000 | ✅ |
| homburg-gemeinde | 374000–385000 × 5456000–5472000 | ✅ |
| kirrberg | 380000–383000 × 5460000–5463500 | ❌ north edge on the 500 m grid only: level-0 chunks align, level-1 chunks do not; stays v2 (single-AOI mode) unless snapped to 5 464 000 |
| fixture, orte, saarland | synthetic / stats-only | not applicable |

### Presence bitmap

One encoding for every "which cells of a rectangle exist" list (catalog tiles, manifest presence, overview presence):

```ts
Bitmap = { w: number, h: number, bits: string, count: number }
```

- `w × h` cells of the rectangle, **row-major, row 0 = north**, column 0 = west; bit index `b = row · w + col`.
- `bits` = RFC 4648 **standard base64 with padding** of `ceil(w · h / 8)` bytes; bit `b` = `(byte[b >> 3] >> (b & 7)) & 1` (LSB first). Trailing bits after `w · h` are 0.
- `count` = number of set bits (a checksum; mismatch → the bitmap is invalid).
- Example: `w = 3, h = 2`, cells (col, row) (0,0), (2,0), (1,1) set → bits 0, 2, 4 → byte `0x15` → `{ "w": 3, "h": 2, "bits": "FQ==", "count": 3 }`.
- Size: Saarbrücken (≈ 22 × 18 tiles) = 50 bytes = 68 characters; all 54 catalog places < 10 KB; overview level 2 over 128 × 96 km (64 × 48 chunks) = 512 characters. A list of tile ids would be ≈ 30 × larger and is not used.

### Manifest `version: 3`

A v3 manifest is a v2 manifest (all keys and paths keep their meaning) with these changes:

```jsonc
{
  "version": 3,
  "aoi": "homburg",                               // = catalog place id for a place
  "name": "Homburg",
  "place": { "id": "homburg", "ags": "10045114" }, // required in catalog mode, must match the catalog entry
  "crs": "EPSG:25832",
  "grid": { "id": "sle-grid-25832-v1", "origin": { "E": 300000, "N": 5400000 }, "extent_m": 256000, "tile_m": 1000, "chunk_m": 500 },
  "origin": { "E0": 374000, "N0": 5456000 },       // rectangle aligned at 1 km (REQUIRED in v3)
  "size": { "width": 11000, "height": 16000 }, "cellSize": 1, "chunkSize": 500, "chunks": { "nx": 22, "ny": 32 },
  "presence": { "w": 11, "h": 16, "bits": "…", "count": 96 },   // tiles of the rectangle that are published
  "heightRange": { "min": 221.8, "max": 412.3 },
  "height": { "dtm": { "path": "dtm/{i}_{j}.webp", "encoding": "terrarium", "apron": 1 } },   // no dsm
  "layers": {
    "svf":      { "path": "relief/svf/{i}_{j}.avif",      "encoding": "u8", "min": 0.6, "max": 1, "lossy": true, "label_de": "Himmelssicht (SVF)" },
    "opns_pos": { "path": "relief/opns_pos/{i}_{j}.avif", "encoding": "u8", "min": 60, "max": 95, "unit": "deg", "lossy": true, "label_de": "Offenheit positiv" },
    "opns_neg": { "path": "relief/opns_neg/{i}_{j}.avif", "encoding": "u8", "min": 60, "max": 95, "unit": "deg", "lossy": true, "label_de": "Offenheit negativ" },
    "chm":      { "path": "relief/chm/{i}_{j}.webp",      "encoding": "u8", "min": 0, "max": 40, "unit": "m", "label_de": "Vegetationshöhe" },
    "mask":     { "path": "relief/mask/{i}_{j}.webp",     "encoding": "u8", "min": 0, "max": 1, "label_de": "Ergänzte Daten (RLP/Lücke)" },
    "bldg":     { "path": "relief/bldg/{i}_{j}.webp",     "encoding": "u8", "min": 0, "max": 1, "label_de": "Gebäudemaske" },
    "ortho":    { "path": "ortho/{i}_{j}.avif", "encoding": "rgb", "format": "avif", "pixelsPerChunk": 1000, "kind": "image", "label_de": "Luftbild (DOP20)", "attribution": "…" }
  },
  "derived": {                                     // see "Derived relief modes"
    "hillshade": { "method": "live-hillshade", "label_de": "Schummerung" },
    "slope":     { "method": "live-slope", "unit": "deg", "label_de": "Hangneigung" },
    "slrm":      { "method": "live-lrm", "params": { "radius_m": 20 }, "unit": "m", "label_de": "Lokales Relief" },
    "vat":       { "method": "rvt-vat-combined-v1", "inputs": ["svf", "opns_pos"], "label_de": "VAT (Kombination)" }
  },
  "levels": [
    { "level": 0, "…": "= top level" },
    { "level": 1, "cellSize": 2, "chunks": { "nx": 11, "ny": 16 }, "size": { "width": 5500, "height": 8000 },
      "height": { "dtm": { "path": "levels/1/dtm/{i}_{j}.webp", "encoding": "terrarium", "apron": 1 } },
      "layers": { "vat":   { "path": "levels/1/vat/{i}_{j}.avif", "encoding": "u8", "min": 0, "max": 1, "lossy": true, "label_de": "VAT (Kombination)" },
                  "ortho": { "path": "ortho/levels/1/{i}_{j}.avif", "encoding": "rgb", "format": "avif", "pixelsPerChunk": 500, "kind": "image", "label_de": "Luftbild (DOP20)" } } }
  ],
  "build": { "pipeline": "0.9.0", "…": "…" },     // `pipeline` = pipeline version string (REQUIRED in v3; the catalog CI compares neighbours)
  "xyz": { "vat": { "url": "xyz/vat/{z}/{x}/{y}.png", "minZoom": 12, "maxZoom": 16, "bounds": [[49.25, 7.22], [49.40, 7.38]] } },
  "attribution": "…"
}
```

Rules (each one testable on a manifest alone):
1. **`grid`** equals the constant above; `origin`/`size` form a rectangle aligned at 1 km.
2. **`presence`** (optional; absent = every tile of the rectangle present): `w = width · cellSize / 1000`, `h = height · cellSize / 1000`. Level-0 chunk `(i, j)` exists iff tile bit `(⌊i/2⌋, ⌊j/2⌋)` is set; level-1 chunk `(i, j)` (= one tile) iff bit `(i, j)`. **A chunk outside the presence list is "not mine": no request is made, it is not an error and not a hole** (the app draws the coarser level or another source there). Every per-chunk file of every key (`height`, u8 and `rgb` layers, `models.buildings.chunks`, `trees.chunks`, `candidates.mask.chunks`) exists only for present chunks; chunk lists naming an absent chunk are invalid entries (skipped, logged). Conversely every present chunk has its `dtm` image at every level the manifest lists.
3. **Levels:** `levels` is optional and holds level 0 and at most level 1 for a place (k ≥ 2 come from the overview, below). In single-AOI mode a v3 manifest may also carry k ≥ 2 (v2 rules); catalog mode ignores them. Level 1 carries `dtm` and the baked `vat` (block mean of the 1 m VAT, see "Derived relief modes"), optionally `rgb` layers at 500 px; **no `hillshade` at any level**.
4. **Aprons from real data:** height images (502², apron 1, every level) take the apron cells from the real neighbouring terrain (the buffered mosaic, see "Tile ownership"), also at the place's outer edge and next to absent tiles; edge clamp only outside the catalog area's source data. So the edge row of a chunk equals the apron row of its neighbour, whichever place publishes it.
5. **Fixed value ranges.** `min`/`max` of u8 layers are **constants** in v3, identical in every place, so one decode range serves chunks of several places: `svf` 0.6–1, `opns_pos` / `opns_neg` 60–95°, `chm` 0–40 m, `mask` / `bldg` / `vat` 0–1. (v1/v2 pick ranges from percentiles per AOI; that stays valid there.)
6. **Content per tile.** Everything a place publishes belongs to its present tiles: trees with the top cell centre in a present tile; buildings with the footprint centroid in a present tile; candidates with the centroid in a present tile; point-cloud areas with the bbox centre in a present tile; OSM lines clipped to the union of present tiles; parcel label points inside present tiles. So two neighbouring places never draw the same object twice. (Parcel `polygons` stay unclipped, see "Vectors"; a lookup takes the first hit.)
7. **`xyz`** in a v3 place: RGBA tiles with **alpha 0 outside the place's present tiles**, so the minimap can stack the tiles of several places without a seam; `bounds` = WGS84 bounds of the rectangle. Recommended: `vat` only, `maxZoom` 16 (S0 §2.6).
8. The pipeline writes `version: 3` exactly when it writes `grid` (place builds); `version`, `grid`, `presence` and `levels` are owned by `build.py` and written together.

### Tile ownership and the relief buffer

**Ownership rule `largest-share-v1`** (computed by the catalog build, never by a place repo):
- Candidates: every catalog place (all statuses, including `stats`) with its **unsimplified** BKG VG25 outline in EPSG:25832 (the published `places.geojson` is simplified and is not used).
- For each tile `T`: `a_p = round(area(T ∩ outline_p))` in integer m² (float64 GEOS/shapely, Python `round`). **Owner = the place with the largest `a_p ≥ 1`; ties → the smallest `ags` (8-digit string compare), then the smallest `id`.** Tiles with no `a_p ≥ 1` have no owner (no 3D at level ≤ 1 there).
- Every tile has at most one owner, so the union of all places' tiles is a partition. A new VG25 edition can move tiles; the catalog names the edition in `ownership.outlines`, and the affected places rebuild.
- Test vectors: a tile split 600 000 / 400 000 m² → the first; 500 000 / 500 000 → the place with the smaller AGS; a tile half in France and 3 m² in a Saarland municipality → that municipality.

**Relief buffer.** A place builds exactly its owned tiles (`presence` ⊆ owned tiles; fewer only while `status` is `building`). To make borders seamless it computes everything from the official sources with a buffer, never from a neighbour repo's output:
- **Fetch set** = the owned tiles plus all their 8-neighbour tiles (the square dilation by `buffer_m`, 100 m ≤ `buffer_m` ≤ 1000 m, default 200 m), regardless of who owns the neighbours. Sources and precedence as today ([ADR 0001](adr/0001-lidar-sources-rlp-fill.md)): LVGL-SL first, GeoBasis RLP fill, NoData fill and the `mask` layer as in build.
- **Implausible source heights (`h-plausible-v1`, Revision 3.1).** Before the RLP precedence and the NoData fill, a source DTM cell counts as no data (filled, `mask` 1) when (a) it lies below **30 m** NHN (below the lowest terrain of both source areas: RLP's Rhine at the NRW border ≈ 45 m, the lowest SL 2025 cell is the Moselle near Perl at 137.0 m; a guard against garbage blocks), or (b) it belongs to a **closed depression deeper than 50 m whose extent (larger side of its bounding box) is ≤ 50 m**: screened by a grey closing with a 50 m square (closing − h > 50 m on cells with source data), confirmed per screened component by a sink fill (morphological reconstruction by erosion) of its bounding box ± 50 m; the depression = the 8-connected cells below the spill level that contain the component, flagged as a whole (walls included) when it does not reach that window's border. Calibration over all 2 999 cached DGM1 tiles (2026-11-08): exactly two such holes, interpolated funnels in SL 2025 tiles 343_5457 and 327_5485 (24 m wide, bottoms −0.26 m / 0.0 m, 184 m / 205 m below the rim); the deepest real closed depressions are 23 m (6 m wide) and 22 m (240 m wide) and stay. A cell's verdict depends only on source data within ≈ 150 m, so the locality requirement holds. DSM cells use rule (a) only (they are clamped to ≥ DTM − 0.5 m anyway). The manifest records the rule in `build.heightRule` (informative). v1/v2 builds are unchanged.
- **Locality requirement:** every published value of a cell (heights, apron, svf/openness, the internal 1 m VAT behind level-1 `vat`, chm, mask, bldg, level-1 block means) depends only on source data within `buffer_m` of that cell, with fixed parameters (`svf`/openness r = 10 m, 16 directions; no percentile ranges, rule 5). **Test:** building tile `T` as part of two different tile sets yields byte-identical lossless files and identical encoder input for lossy files.
- Neighbours built with different `build.pipeline` versions may differ slightly at the border (heights never do: same source, same fill); the catalog CI warns.

### Catalog (`sle-catalog-v1`)

Published as `catalog.json` on the Pages site of `Open-Kirrberg/orte-katalog`; small (≈ 30 KB for 54 places), fetched once per session with `cache: 'no-cache'` (revalidated, Pages ETag).

```ts
Catalog = {
  format: 'sle-catalog-v1',               // exact; anything else → no catalog mode
  generated: string,                      // ISO-8601
  crs: 'EPSG:25832',
  grid: Grid,                             // the constant above
  height_ref_m: number,                   // session hRef of the exaggeration rule in catalog mode: integer metres, = floor(lowest DTM height of the catalog area) = floor(overview heightRange.min), after `h-plausible-v1` (Saarland 2026-11: 137)
  ownership: { rule: 'largest-share-v1', outlines: string /* e.g. "BKG VG25, Stand 31.12.2025" */, attribution: string },
  overview?: string,                      // URL of the sle-overview-v1 file (below)
  leaderboard?: string,                   // URL of a stats-only manifest (kind 'stats-only', "Gemeinde level"), e.g. "stats/manifest.json"
  attribution: string,                    // '; '-joined, no ';' inside an entry
  places: CatalogPlace[]                  // file order = tie order for display
}
CatalogPlace = {
  id: string,                             // /^[a-z0-9][a-z0-9-]{0,39}$/, unique; = the place id on the Gemeinde level of the leaderboard
  name_de: string,
  ags: string,                            // /^\d{8}$/, unique (Homburg "10045114")
  state: 'SL' | 'RP',
  status: '3d' | 'building' | 'stats',
  repo?: string,                          // "Open-Kirrberg/ort-homburg" (informative, for links)
  data_url?: string,                      // required for '3d' and 'building'; absent for 'stats'
  maintainers?: string[],                 // GitHub handles only (R7)
  bbox: [number, number, number, number], // [Emin, Nmin, Emax, Nmax] of the OWNED tiles, multiples of 1000
  tiles: Bitmap,                          // owned tiles in bbox: w = (Emax − Emin)/1000, h = (Nmax − Nmin)/1000
  manifest_version?: number, pipeline?: string, built?: string,   // informative, copied by the catalog CI from the place manifest
  options?: { relict_candidates?: boolean }                        // informative mirror of ort.toml (ADR 0053)
}
```

- **`status`** is the source of truth for 3D: `'3d'` = the place publishes a v3 manifest for all owned tiles; `'building'` = a v3 manifest exists but may cover only part (presence ⊂ tiles) or is being rebuilt; `'stats'` = no place repo yet („Ortspate gesucht“), only overview terrain. The Gemeinde-level `places.json` ([ADR 0051](adr/0051-leaderboard-levels-gemeinden-ortsteile.md)) carries the same enum; the catalog build writes it from the catalog (join on `ags`). If both are loaded and disagree, the app uses the catalog's value for 3D, fly-to and the „Ortspate gesucht“ hint (`place_aoi` / `aoi_share_pct` are single-AOI fields and are ignored in catalog mode).
- **URL resolution:** `data_url`, `overview` and `leaderboard` resolve with `new URL(value, catalogUrl)`; a `data_url` without a trailing `/` gets one. Allowed schemes: `https:`; `http:` only for `localhost`, `127.0.0.1`, `[::1]`, `*.localhost` (dev). The place manifest is `<data_url>manifest.json`; every relative path in it resolves against `data_url` (absolute `xyz` URLs as in "Public release"). Moving a place to another static host = changing `data_url` only.
- **CORS:** every host serves all files with `Access-Control-Allow-Origin: *` and needs no cookies (GitHub Pages does; an object store must be configured so). The app fetches with `mode: 'cors'`, `credentials: 'omit'` and hands workers absolute URLs only.
- **Versioning:** keys may be added without a format change (readers ignore unknown keys). A breaking change gets `sle-catalog-v2` in a new file `catalog-v2.json` published next to `catalog.json` during a transition. Place manifests of any pipeline age stay valid as long as they are v3 (R9); a place still on v1/v2 is treated as `'stats'` for 3D in catalog mode (logged).
- **Which places load:** the app keeps the manifests of the places with `status` `'3d'` / `'building'` whose `bbox` lies within **8 km** of the camera's ground point (distance from the point to the rectangle, 0 inside), nearest first, and drops them beyond **12 km** (hysteresis; their chunks leave through the LRU). A fly-to target loads its place first. The catalog's `bbox` list is the spatial index (linear scan, ≤ a few hundred entries).
- **Owner lookup:** at catalog load the app builds `tileId → placeId` from all `tiles` bitmaps. A tile claimed twice (invalid catalog) → first place in file order, logged. Presence bits of a manifest outside its catalog tiles are ignored (logged).

### Multi-origin (catalog mode)

- **One float64 session origin** `(Es, Ns)` = the SW corner of the tile under the start camera position (integer km). World frame `x = E − Es`, `y = h`, `z = −(N − Ns)` for the whole session; it never changes during a session.
- **Every source is translated by its offset**, exactly as shared datasets are placed ("Placement in an AOI"): a place (or the overview) with rectangle origin `(E0, N0)` sits at `Object3D.position = (E0 − Es, 0, −(N0 − Ns))`; its vertex buffers, model files (`frame: 'local'`), tree and point decodes stay local to its own origin, so float32 never holds raw UTM. three.js composes model-view matrices in float64 on the CPU; world positions in shaders (fog) stay below ≈ 1 cm error within ±150 km.
- **One `hRef`** for the exaggeration rule = catalog `height_ref_m` (single-AOI mode keeps `heightRange.min` of its manifest). Different `hRef` per place would tear the terrain at borders.
- The URL hash and every handover keep absolute E/N (unchanged), so links work in both modes.

### Central overview levels (`sle-overview-v1`)

Coarse levels span several municipalities, so the catalog builds them once for the catalog area (the union of all owned tiles) and anchors them at the global grid:

```ts
Overview = {
  format: 'sle-overview-v1',              // exact
  generated: string, crs: 'EPSG:25832', grid: Grid,
  bbox: [Emin, Nmin, Emax, Nmax],         // aligned at S_K (K = coarsest level), covers the catalog area
  heightRange: { min, max },              // of the filled 1 m DTM over the owned tiles (never filler cells)
  coverage?: Bitmap,                      // Revision 3.1: 1 km tiles of `bbox` with real source data, see "Overview no-data"
  levels: OverviewLevel[],                // fine → coarse, contiguous, first level ≥ 2 (Saarland: 2 … 6)
  attribution: string
}
OverviewLevel = {
  level: number,                          // k ≥ 2
  cellSize: number,                       // 2^k
  chunkSize: 500,
  size: { width, height },                // (Emax − Emin)/2^k, (Nmax − Nmin)/2^k cells (integers, no partial blocks)
  chunks: { nx, ny },                     // (Emax − Emin)/S_k, (Nmax − Nmin)/S_k
  presence: Bitmap,                       // w = nx, h = ny; set iff the chunk intersects ≥ 1 owned tile of any catalog place
  height: { dtm: { path: 'levels/{k}/dtm/{i}_{j}.webp', encoding: 'terrarium', apron: 1, quant_m?: number } },
  layers?: { vat?: LayerSource /* u8 0–1, lossy AVIF allowed */, ortho?: ImageLayer /* rgb, 500 px */ }
}
```

- Paths resolve against the overview file's URL. `(i, j)` are relative to the overview `bbox` NW corner (global address by the formula above).
- Level-k cell = mean of the 2^k × 2^k block of the NoData-filled 1 m DTM (same sources and fill as the places), apron from real data, edge clamp only at the overview `bbox` edge. Because the block grid is global, an overview level-2 cell is the mean of four place level-1 cells.
- **Overview no-data (`coverage`, Revision 3.1).** `coverage` is a presence-style Bitmap ("Presence bitmap": row 0 = north, LSB first) over the overview `bbox` in **1 km tiles**: `w = (Emax − Emin) / 1000`, `h = (Nmax − Nmin) / 1000`, bit `(col, row)` = tile `(Emin/1000 + col, Nmax/1000 − 1 − row)`. A bit is set iff the tile holds ≥ 1 cell of real source data (SL or RLP after `h-plausible-v1`; a tile that only gets nearest fill from its neighbours is not covered). Every owned tile with source data is covered (`build.ownedTilesWithoutCoverage` lists exceptions). **Rule:** overview heights outside covered tiles are *filler* — a smooth push-pull continuation (NaN-ignoring 2 × 2 means down to one cell, bilinear back up) so meshes, aprons and skirts stay finite — and carry no meaning: readers must not draw them as terrain (hide or fade them into the haze), must not answer height readouts, ground clamps or profiles from them, and must never take them into `heightRange`. Inside a covered tile, cells without source data (e.g. France in a border tile) carry the same per-tile nearest fill as the places (`mask` 1 there at level 0). Heights stay RGB terrarium without alpha (no alpha 0 marker: that would change the lossless decode path and add bytes to every chunk). An overview without `coverage` (Revision 3.0 files): readers treat the union of the catalog's owned tiles as the covered set.
- **`quant_m`** (recommended 0.05): heights are rounded to multiples of `quant_m` before terrarium encoding, which makes the lossless WebP smaller; decoding is unchanged, the value is informative.
- `vat` is optional (block mean of the 1 m VAT where a statewide relief run exists); without it a VAT mode shows live hillshade on overview levels (v2 fallback rule).
- **Traffic warning (S0 §2.5):** coarse levels were ≈ 26 MB of a Homburg flight session (21 MB dtm, 5 MB ortho). On one central site that is ≈ 3 900 sessions per month for the whole Saarland under the ≈ 100 GB soft limit. Keep them cheap (`quant_m`, no `ortho` below level 3 if needed) and, when traffic grows, point `overview` at another static host.

### Which source serves a chunk (catalog mode)

The quadtree is global: nodes are `(k, I, J)`; the coarsest overview level is the root set (pinned, as today). For a node:

```
k ≥ 2:      overview, if it has level k and its presence bit is set; else none.
k ∈ {0,1}:  T = the tile containing the node (k = 1: the node itself); owner = tileOwner(T)
            none     if T has no owner, or the owner's status is 'stats', or its manifest failed / is not v3 / mismatches grid or place id,
                     or T's presence bit is 0 in that manifest;
            pending  while the owner's manifest is loading;
            else     (owner, i = I − (E0 − Eg)/S_k, j = J − (NgTop − (N0 + H))/S_k) with the owner's paths.
```

`none` and `pending` stop refinement into that node (never a request, never an error). The terrain must have no holes: where some children of a node are `none`, the parent stays drawn for those quadrants (or the whole node stays unrefined). Edges between different sources at the same level match by rule 4 (heights) and the runtime layer apron from neighbour chunks of any source (rule 5); across levels the existing skirts apply. In single-AOI mode every chunk comes from the one manifest, and a v3 manifest's absent chunks are `none` as above.

### Slim formats (v3)

| Data | `encoding` | Files | Lossless? | Decode |
|---|---|---|---|---|
| heights `dtm` (places, overview) | `terrarium` | `.webp` (lossless) or `.png` | **must** be bit-exact | `createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })` |
| data u8 `chm`, `mask`, `bldg`, candidates `class8` mask | `u8` | `.webp` (lossless) or `.png` | **must** be bit-exact | same, read R |
| visual u8 `svf`, `opns_pos`, `opns_neg`, level `vat` | `u8` | `.avif` (`lossy: true`) or `.webp` / `.png` | may be lossy | same, read R |
| colour `ortho`, `hist_*` | `rgb` | `.avif` (`format: 'avif'`) or `.webp` / `.jpg` | lossy | sRGB (unchanged) |

- **Format by extension.** `.png`, `.webp`, `.avif` are accepted for `terrarium` and `u8` in every version (the decode path is format-agnostic); `format` is optional for `u8` and, if present, must match the extension. `rgb` `format` gains `'avif'`. `terrarium` and the data layers above must never point to `.avif` (rejected: layer absent, height source invalid).
- **WebP lossless:** VP8L, RGB without alpha (u8: R = G = B), encoder `lossless=True, exact=True`, method 6. The pipeline asserts byte equality of the decoded pixels with the source array for every file it writes.
- **AVIF u8:** 8-bit, full range, monochrome (4:0:0) where the encoder supports it, else 4:4:4 with identity matrix (R = G = B), no ICC profile; quality 90 (S0). `lossy: true` on the layer. Budget, checked by the pipeline on every file: mean |Δ| ≤ 1.5 and max |Δ| ≤ 16 u8 levels against the source. **AVIF rgb:** quality 65, 8-bit 4:2:0 allowed.
- **Browsers without AVIF:** no fallback files are published (they would double the largest layers). Chrome ≥ 85, Firefox ≥ 93 and Safari ≥ 16 decode AVIF, which covers the audience devices ([ADR 0028](adr/0028-phone-proxy-headroom.md)). The decode worker probes once with a 1 × 1 AVIF; on failure every `.avif` layer counts as absent: `rgb` → relief shading instead of the ortho, `svf` / `opns_*` hidden, derived `vat` unavailable (falls back to live hillshade), and the UI shows once „Dieser Browser kann AVIF nicht anzeigen – Luftbild und einige Reliefansichten fehlen.“

### Derived relief modes (`derived`, v3)

`derived` maps a relief mode key to a method the app computes live instead of loading a baked layer:

```ts
derived = { [key: string]: { method: string, inputs?: string[], params?: object, unit?: string, label_de: string } }
```

**Resolution** for mode `m` on a chunk at level `k`: (1) a baked layer `m` of that level (level 0: `layers[m]`, k ≥ 1: `levels[k].layers[m]`) wins; (2) else `derived[m]`, if every `inputs` key is a layer of that level and its texture is resident for the chunk; (3) else the v2 fallback (live hillshade / neutral). Unknown `method` → that entry is ignored. Methods:

| `method` | Definition (true heights, no exaggeration, gradient `∇h = (∂h/∂E, ∂h/∂N)` in m/m from the DTM) |
|---|---|
| `live-hillshade` | the app's live hillshade (sun from the UI), as drawn today |
| `live-slope` | `s = atan(|∇h|)` in degrees |
| `live-lrm` | `h − mean of the (2r+1)² box`, `r = params.radius_m` (20 = the old `slrm`, S0: mean |Δ| 0.005 m) |
| `rvt-vat-combined-v1` | RVT „VAT combined“ from `svf` + `opns_pos`, below |

**`rvt-vat-combined-v1`** (= `pipeline/build.py` `VAT_GENERAL` / `VAT_FLAT` through `rvt.blend_func`; spike `spike/s0-live-vat`). With decoded `svf` (via `min`/`max`) and `O` = `opns_pos` in degrees:
1. Hillshade `hs = clamp(n · L, 0, 1)` with `n = normalize(−∂h/∂E, −∂h/∂N, 1)` and `L = (cos e · sin a, cos e · cos a, sin e)` in (east, north, up), sun azimuth `a = 315°` (clockwise from grid north), elevation `e = 35°`, single direction, independent of the UI sun.
2. For each preset `P = (s_max, o_min, o_max, v_min)`: general `(50, 68, 93, 0.7)`, flat `(15, 85, 91, 0.9)`:
   - `r1 = 0.5 · (1 − clamp(s / s_max, 0, 1)) + 0.5 · hs` (slope, luminosity 50 %)
   - `o = clamp((O − o_min) / (o_max − o_min), 0, 1)`; `r2 = r1 > 0.5 ? 1 − (1 − 2 · (r1 − 0.5)) · (1 − o) : 2 · r1 · o` (positive openness, overlay at **full strength**: rvt's `blend_overlay` writes its result into the background array in place, so the nominal 50 % opacity has no effect in the baked VAT, and the live formula must reproduce that quirk)
   - `v = clamp((svf − v_min) / (1 − v_min), 0, 1)`; `VAT_P = 0.75 · r2 + 0.25 · v · r2` (svf, multiply 25 %)
3. `VAT = 0.5 · VAT_general + 0.5 · VAT_flat` ∈ [0, 1], shown as grey.

Tolerance (tests on fixture chunks, baked u8 `vat` vs the formula on the decoded u8 inputs): mean |Δ| ≤ 1 u8 level, p99 ≤ 2 (S0: 0.4 / 1.2; the max of 15 occurs only where `opns_pos` is clipped by its u8 range). The live variant may evaluate `∇h` per fragment from the bilinear height texture (S0: visually equal). Level-1 and overview `vat` stay **baked** (block mean of the internal 1 m VAT), because svf / openness exist only at level 0.

**v3 place builds write no `hillshade`, `slope`, `slrm` or `vat` layer at level 0** and declare all four in `derived`; presets that used `slrm` use `live-lrm` with r = 20.

### No `dsm` in v3; canopy from DTM + CHM

v3 manifests carry no `height.dsm`. Where a surface is needed (canopy surface of the *Wald* lab modes, `dsmAt` in profiles and measuring, the canopy lens target), the app uses `dsm = dtm + chm` per cell (bilinear on both; `chm` decoded 0–40 m). S0: mean |Δ| 0.03 m, p99 0.08 m against the real DSM; only objects above 40 m (towers, pylons, chimneys) are cut. `bldg` keeps suppressing canopy over buildings. v1/v2 manifests with `dsm` are read as before.

### Vectors in v3

- **`vectors.osm` with `densified: false`:** 2D `[E, N]` rounded to **0.1 m**, the original OSM vertices (not densified), no `heights`, clipped to the union of the place's present tiles (lines cut exactly at the tile edges). The app densifies to ≤ 2 m (linear in E/N) before draping with HeightQuery. Without `densified` (or `true`) the old rule (≤ 2 m, optional baked heights) applies.
- **`vectors.flurstuecke` with `lines: 'derived'`:** `path` is absent and `polygons` is required; the app derives the boundary lines: every ring segment of every polygon, each undirected segment (endpoints rounded to 0.01 m) drawn once, clipped to the union of the place's present tiles, densified ≤ 2 m, draped. `labels` stays required (points inside present tiles only, rule 6). Polygons keep their rules (2D, not clipped, original vertices).
- Old manifests (no `lines`, string `path`) keep loading the baked boundary file.

### App tolerance (v3, catalog, overview)

- Manifest `version` 3 without a valid `grid` or with a rectangle not aligned at 1 km → **rejected in catalog mode** (place treated as `'stats'`, logged); in single-AOI mode a missing/invalid `grid` only disables placement (the manifest loads standalone).
- Invalid `presence` (wrong `w`/`h`, bad base64, `count` mismatch) → the whole place manifest is rejected in catalog mode; in single-AOI mode treated as "all present" with a warning.
- A 404 on a chunk the presence list names → that chunk shows the coarser level (logged once per layer), as in v2.
- Catalog: invalid `format`, `grid` or JSON → no catalog mode. A place with an invalid `id`/`ags`/`bbox`/`tiles` is skipped (its tiles have no owner); a missing `data_url` on a `'3d'`/`'building'` place → treated as `'stats'`. Unknown `status` → `'stats'`. Unknown keys ignored.
- Overview: invalid → no levels ≥ 2 (places still stream; the root set is then the places' level 1). Malformed levels end the list (contiguous valid prefix, as in v2). Invalid `coverage` (wrong `w`/`h`, bad base64, `count` mismatch) → ignored with a warning (covered set = owned tiles, as without the key).
- `derived` entries with an unknown `method` or `inputs` that are not layers → ignored. A u8 layer with `lossy: true` is excluded from exact value readouts (e.g. probes show „≈“).

### Size (target format, S0)

≈ 5.3 MB/km² for a place (Homburg 82–120 tiles ≈ 0.45–0.65 GB; Saarbrücken ≈ 0.9–1.1 GB, borderline: AVIF q75 for svf/openness or a second site) plus ≈ 0.5 MB/km² `xyz.vat` ≤ z16; a typical flight ≈ 147 MB. Details: [S0 report](plans/orte-skalieren-s0.md) §3–4.

## 🌳 Trees (`trees`, optional, V2.4)

One record per tree crown from the canopy height model (CHM = DOM1 − DGM1), [ADR 0017](adr/0017-real-trees-from-chm.md); conifer fill trees per [ADR 0030](adr/0030-conifer-fill-trees.md). Written by `pipeline/trees.py` (method, parameters and the plot check: [pipeline/README.md "Trees"](../pipeline/README.md#-trees-v24)). `trees` is an optional top-level key (additive, valid in v1 and v2); manifests without it stay valid.

```ts
trees = {
  format: 'sle-trees-v1',                 // anything else → the whole key is ignored
  path: 'trees/{i}_{j}.bin',              // relative to the AOI dir; level-0 chunk (i, j) as in "Grid & chunks"
  crs: 'EPSG:25832',                      // informative
  chunks: Array<[i, j, count]>,           // only chunks that HAVE a file (count ≥ 1)
  count: number,                          // Σ count
  counts: { unknown, conifer, broadleaf }, // trees per base type (fill trees included)
  fill: number,                           // trees with the FILL flag (estimated position)
  fillFlag: 128,                          // bit of `type` that marks fill trees
  bounds: [Emin, Nmin, Emax, Nmax],       // EPSG:25832, integer metres, cell extent of all trees
  heightRange: { min, max },              // tree height h (m)
  crownRadiusRange: { min, max },         // crown radius r (m)
  types: { unknown: 'Baum', conifer: 'Nadelbaum', broadleaf: 'Laubbaum' }, // label_de per base type (informative)
  method: 'chm-lmf-watershed', version: 1, generated: ISO-8601, params: {...}, inputs: {...}, // informative
  label_de: 'Bäume (aus Kronenhöhenmodell)'
}
```

**Binary chunk `.bin` (little-endian).** File size is exactly `16 + 10 · count` bytes.

| Offset | Type | Field |
|---|---|---|
| 0 | 4 × u8 | magic `SLET` (ASCII `53 4C 45 54`) |
| 4 | u16 | version = 1 |
| 6 | u16 | reserved = 0 (ignored) |
| 8 | u32 | `count` trees |
| 12 | f32 | `gBase` (m, DHHN2016) = lowest ground height of the chunk's trees, floored to 0.01 m |

then `count` records of **10 bytes** at offset `16 + 10·k`:

| Offset | Type | Field | Decode |
|---|---|---|---|
| 0 | u16 | `x` dm east of the chunk's west edge, 0…5000 | `E = E0 + i·500 + x / 10` |
| 2 | u16 | `y` dm **north** of the chunk's **south** edge, 0…5000 | `N = N0 + height − (j+1)·500 + y / 10` |
| 4 | u16 | `g` cm above `gBase` | ground `g_true = gBase + g / 100` (DGM1 value of the top cell) |
| 6 | u16 | `h` cm | tree height above ground (m) = `h / 100` |
| 8 | u8 | `r` dm, 1…255 | crown radius (m) = `r / 10` |
| 9 | u8 | `type` | low 7 bits: 0 = unknown, 1 = conifer, 2 = broadleaf (other codes → unknown); bit 7 (`& 0x80`) = **fill** tree |

- **Precision.** Tops are 1 m DGM cells, stored at the **cell centre** (`x, y` ≡ 5 mod 10), so positions are exact to the grid (±0.5 m true position). Heights 1 cm, radius 1 dm. `y` runs north (like `pointclouds` tiles), unlike chunk `j`.
- **Ground is stored** (`g`) so the renderer can place trunks without sampling the DTM; at a cell centre it equals the app's bilinear `heightAt`. World frame as everywhere: `x = E − E0`, `z = −(N − N0)`, trunk base `y = hRef + (g_true − hRef) · exag`; whether the tree itself scales with `exag` is a renderer choice.
- **Stable id** (not stored, derived): `id = ((Ec mod 65536) << 16) | (Nc mod 65536)` as u32, with `Ec = E − 0.5`, `Nc = N − 0.5` the integer lower-left corner of the top cell. Unique within any 65 km square, independent of the AOI and chunking, identical across reruns with the same inputs and params.
- **Order = LOD.** Records are sorted ascending by `fmix32(id)` (MurmurHash3 finalizer: `h ^= h>>>16; h = Math.imul(h, 0x85EBCA6B); h ^= h>>>13; h = Math.imul(h, 0xC2B2AE35); h ^= h>>>16; h >>>= 0`). Any prefix of `n` records is a pseudo-random, spatially uniform subsample; a tree's rank never changes between LOD levels, so `drawRange` LOD needs no reseeding.
- **Type** (heuristic): mean `(R+G+B)/3` of the summer DOP20 (1 m) over the crown segment: `< 62` → conifer, `> 74` → broadleaf, else or without DOP → unknown. ⚠️ Weak: shaded broadleaf crowns read as conifer, sunlit conifers as unknown; larch (deciduous conifer) is "broadleaf"-bright. Good enough for the tree model, not a species map. **v3 places (Revision 3.1):** the DOP is the place's **own** `ortho_1m` work raster only (its present tiles, 0.5 m WMS → 1 m 2 × 2 mean; cells outside the present tiles count as no DOP and are left out of the crown mean), never another AOI's raster, so a place build gives the same types on any machine (reproducible Actions builds). Crowns that reach into absent tiles are typed from their present part; a conifer crown with its top in an absent tile can still yield fill trees in a present tile from that part. `inputs.ortho` names the raster used. v1/v2 AOIs keep window-reading another AOI's raster where their own has no data.
- **Fill trees** (`type & 0x80`): the leaf-off 1 m DOM merges conifer tops ≈ 5 m apart into one blob; oversized conifer crowns are split into crowns of the expected size ([ADR 0030](adr/0030-conifer-fill-trees.md)). Their position is an **estimate** (cluster centre), height and radius come from the CHM. Never use them as evidence for a single tree.
- Heights outside `3 … 45 m` are dropped (pylons, chimneys, cranes). Building cells (LoD2 `bldg` mask, dilated 1 m) are excluded.

**Size.** ≈ 10 B per tree; Karlsberg (9 km²) ≈ 89 k trees ≈ 0.9 MB, overall (48 km²) ≈ 326 k trees ≈ 3.1 MB.

**Manifest + attribution.** The trees step owns the whole `trees` key (replaced on each run via `update_manifest`, all other keys kept) and adds `© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (DOP20)` when the DOP was used for the type (the DGM/DOM attribution is already present from `build`).

**App tolerance.** Missing `trees`, a non-object or `format` ≠ `sle-trees-v1` → absent (logged, not fatal). `path` must contain `{i}` and `{j}`. `chunks` entries that are not three integers with `0 ≤ i < nx`, `0 ≤ j < ny`, `count ≥ 1` are skipped. A chunk whose bytes fail the header check (magic, version 1, size `16 + 10·count`) or 404s is skipped; the other chunks still show. Unknown `type` base codes read as unknown; unknown manifest fields are ignored.

## 🌲 Historic forest mask (`forest_hist`, optional)

Where the historic maps of the AOI show forest, for the *Baum-Steckbrief* („laut Karte 1935–40 wahrscheinlich Wald“; „seit …“ only once two classified epochs agree, e.g. later „laut Karten seit mindestens 1840 wahrscheinlich Wald“) and the Phase 1 forest-age class ([plan „Orte im Vergleich“](plans/orte-im-vergleich.md) §4). Written by `pipeline/historic_forest.py` (`./run.sh <aoi> forest`, after `historic`) from the 1 m mosaics of the image layers `hist_1840` and `hist_1935` (see "Image layers"). `forest_hist` is an optional top-level key (additive, valid in v1 and v2); manifests without it stay valid. It is an **estimate** from map symbols, not a forest register.

```ts
forest_hist = {
  format: 'sle-forest-hist-v1',           // anything else → the whole key is ignored
  path: 'forest_hist/forest_hist.png',    // relative to the AOI dir: ONE 8-bit greyscale PNG for the whole AOI
  encoding: 'u8-bits',
  cellSize: 5,                            // metres per pixel
  size: { width: number, height: number },// = ceil(AOI width / cellSize) × ceil(AOI height / cellSize)
  nodata: 255,
  epochs: Array<{
    year: 1840 | 1935,                    // nominal map epoch
    bit: number,                          // forest bit of this epoch (1840: 0, 1935: 1)
    noMapBit: number,                     // "the map has no image here" bit (1840: 2, 1935: 3)
    key: string,                          // image layer it was read from: 'hist_1840' | 'hist_1935'
    label_de: string,                     // 'Wald 1836–41' | 'Wald 1935–40'
    map_de: string,                       // e.g. 'TK25, Ausgaben 1935–40'
    classified: boolean,                  // false → the forest bit is always 0 and means "unknown", never "no forest"
    note_de: string,                      // one line for the UI, e.g. why an epoch is not classified
    accuracy?: { n, tp, fp, fn, tn, precision, recall, accuracy, unsure, sample }   // review sample, informative
  }>,
  method: 'hist-forest-symbols-v1', params: {...}, generated: ISO-8601,   // informative
  label_de: 'Historischer Wald (Schätzung)',
  attribution: string,                    // also merged into the top-level `attribution`
  source: string                          // informative
}
```

**Grid.** Pixel `(px, py)` (row 0 = north) covers the 5 m square whose **centre** is `E = E0 + (px + 0.5) · 5`, `N = N0 + height − (py + 0.5) · 5` (AOI origin and `size.height` in cells of the manifest, 1 m). Lookup of a point: `px = floor((E − E0) / 5)`, `py = floor((N0 + height − N) / 5)`; outside `0 … width−1 / 0 … height−1` → no data. One file (≈ 0.1–0.3 MB for `overall`), no chunks, no levels: the app loads it once when it needs it (tree card), not for rendering.

**Value** (decode as data: `createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })` or a PNG decoder; never colour-managed): `255` = no data. Otherwise, per entry of `epochs`: `v & (1 << noMapBit)` → that map has no image here (unknown); else `v & (1 << bit)` → forest on that map. Values 0–15 occur. An epoch with `classified: false` is unknown everywhere.

**Method `hist-forest-symbols-v1`** (details and parameters: [pipeline/README.md](../pipeline/README.md#-historic-forest-mask-historic_forestpy)):
- **TK25 1935–40** (`hist_1935`, `classified: true`): forest is drawn as tree symbols (broadleaf „Ω“, conifer „Λ“), not as an area tint. Symbols are found by template matching; their smoothed density (σ 50 m) above a threshold is forest; parts < 1 ha dropped, holes < 0.5 ha closed. Effective resolution ≈ 50–100 m: edges are blurred, small woods, hedges and single trees are missed, orchards and ring-like glyphs can read as forest. Accuracy on an independent random sample is in `accuracy` (2026-11-08, `overall`: precision 0.76, recall 0.79, accuracy 0.86 on the 76 of 100 points that could be labelled; the 24 unsure points — map edges, roads, text, dense villages — are not counted, so real accuracy is lower).
- **Bayerische Originalpositionsblätter 1836–41** (`hist_1840`, `classified: false`): the scan has relief hachures, water, roads, buildings, boundaries and names but **no forest signature**, so forest cannot be read from it. The app must not claim „Wald seit 1840“ from this file while `classified` is false.

**App rule.** Show it only as an estimate („laut Karte 1935–40 wahrscheinlich Wald, Schätzung“), with the map name and `attribution`; never as a fact about a parcel. One map is one snapshot: „seit …“ only when at least two classified epochs with a map at the point agree on forest. No forest bit for a classified epoch = „auf der Karte kein Wald erkannt“, not „sicher kein Wald“.

**Manifest + attribution.** The forest step owns the whole `forest_hist` key (replaced on each run via `update_manifest`) and adds `© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet (Historische Karten)` (already present when `historic` ran). The release export may publish the PNG (derived from dl-de/by-2-0 maps, same credit); it contains no personal data.

**App tolerance.** Missing `forest_hist`, a non-object, `format` ≠ `sle-forest-hist-v1`, a non-string `path`, `cellSize` not a positive number or `size` not two positive integers → absent (logged, not fatal). A 404, a decode error or an image whose size ≠ `size` → absent. Unknown epochs or fields are ignored; an epoch without a numeric `bit`/`noMapBit` is treated as unknown.

**Future epochs (reserved bits).** A further classified map (e.g. the Preußische Generalstabskarte 1816–47, WMS layer `2`, if it ever proves classifiable) is added as a new `epochs` entry with the next free pair: forest bit 4, no-map bit 5 (then values up to 63 occur). Bits 0–3 keep their meaning, so old apps stay correct; apps must read the bits from `epochs`, never hard-code them. As of 2026-11-08 no such epoch exists (the Geoportal answered 503, the layer could not be inspected).

**Stats area (work file, not published).** `historic_forest.py --stats` writes the same encoding for the stats bbox of *Orte im Vergleich* to `data/work/orte/forest_hist.png` + `forest_hist.json` (`entry` = an object in the manifest format above, plus `E0`, `N_top` of its grid; TK25 1935–40 only, the 1836–41 epoch `classified: false` and not fetched). It feeds the per-place forest-continuity share of `forest_age.py`; it is not a manifest key.

### Tree age estimate (`tree-age-height-v2`, app rule, Phase 1)

For the *Baum-Steckbrief* („Alter geschätzt“) and the per-place age classes (`pipeline/forest_age.py`, reference implementation `tree_age`). The app computes it itself from the tree's height (no new file); the full table is also in `data/work/orte/forest_age_by_place.json` `tree_age_rule`.

- **Input:** tree height `h` (m, Trees layer or `tallest.h`) and a species group: from the `species` layer when present (`pine`, `spruce`, `douglas`, `larch`, `fir`, `beech`, `oak`, `birch`, `alder`, `other`), else from the tree `type` (`conifer`, `broadleaf`, `unknown`).
- **Rule:** `h' = h − 2.0` (LiDAR tops are dominant trees, the tables list stand mean heights). For each yield table of the group (`beech` → beech; `oak` → oak; `spruce`, `fir`, `larch` → spruce; `pine` → pine; `douglas` → Douglas fir; `conifer` → spruce ∪ pine; `birch`, `alder`, `other`, `broadleaf` → beech ∪ oak; `unknown` → beech ∪ oak ∪ spruce) read the age at which the site-class curves I, II, III reach `h'`, linearly between the table points and from (0 y, 0 m). `lo` = min over tables of the class-I age, `mid` = median of the class-II ages, `hi` = max of the class-III ages; all rounded to 5 years. If `h'` is above the last value of a class-III curve, `hi` is that table's last age and `open_hi = true` („…+ Jahre“). **Beyond the table:** if `h'` is above the last value of the class-II curve of **any** table of the group, the tables cannot age the tree (the middle value would only repeat the table's last age): `beyond = true`, `lo = mid = hi = null`, class `beyond`, wording „nicht schätzbar: höher als die Ertragstafel“ (very good site or very old; height alone cannot tell). Exactly at the class-II end is still an estimate. No estimate below `h = 8 m`. *v1 (until 2026-11-08) clamped instead and reported the last table age („über 200 Jahre“), which made 14 % of all trees ≥ 8 m „sehr alt“ by construction.*
- **Tables** (mean height m at age y, mäßige Durchforstung; rounded):

| Table (source) | Ages | I | II | III |
|---|---|---|---|---|
| beech (Schober 1967) | 30 40 60 80 100 120 140 160 | 11 15 22 27 30.5 33 34.5 35.5 | 8.5 12 18.5 23.5 27 29.5 31 32 | 6 9 15 19.5 23 25.5 27 28 |
| oak (Jüttner 1955) | 30 40 60 80 100 120 140 160 180 200 | 10.5 13.5 18.5 22.5 25.5 28 30 31.5 32.5 33.5 | 8 11 15.5 19.5 22.5 25 27 28.5 29.5 30.5 | 6 8.5 12.5 16 19 21.5 23.5 25 26 27 |
| spruce (Wiedemann 1936/42) | 20 30 40 60 80 100 120 | 6.5 12 17 24.5 29.5 33 35 | 5 9.5 14 21 26 29.5 31.5 | 3.5 7.5 11 17.5 22 25.5 28 |
| pine (Wiedemann 1943) | 20 40 60 80 100 120 140 | 7 15 20.5 24.5 27.5 29.5 31 | 5 12 17 21 23.5 25.5 27 | 3.5 9.5 13.5 17 19.5 21.5 23 |
| douglas (Bergel 1985) | 20 40 60 80 100 | 10 23 32 38 42 | 8 19 27 33 37 | 6 15 22 27 31 |

- **Class** by `mid`: `young` < 40 („jung“), `middle` 40–80 („mittelalt“), `old` 80–120 („alt“), `very_old` ≥ 120 („sehr alt“); `beyond` without `mid` („höher als die Ertragstafel (ohne Alter)“).
- **UI rule (G7):** always a range with „Schätzung“ („etwa 55–85 Jahre, geschätzt aus der Höhe“), never a single year; add „gilt für Waldbäume; frei stehende Bäume sind meist älter“ outside forest. Example: a 22 m beech → 55 / 65 / 85 years, `middle`; a 40.7 m oak → `beyond` (no age, no „Schätzung“ chip, the reason instead).

## 🌲 Tree species (`species`, optional)

The dominant tree species of the forest per 10 m cell, from the DLR map *Tree Species Germany 2022*, for the species row of the *Baum-Steckbrief* („wahrscheinlich Buche (70 %)“) and the species mix per place ([plan „Orte im Vergleich“](plans/orte-im-vergleich.md) §4, Q6). Written by `pipeline/species.py` (`uv run python species.py all [aoi]`: fetch → compare → build → stats). `species` is an optional top-level key (additive, valid in v1 and v2); manifests without it stay valid. It is an **estimate** (G7): a satellite classification of the stand around a tree, never a statement about one tree.

**Source.** DLR EOC, *Tree Species Germany* 2022 (Wegler et al. 2025, *Int. J. Remote Sensing*, doi:10.1080/01431161.2025.2530236; data doi:10.15489/smh8w3j8i962), 10 m Cloud-Optimized GeoTIFF in EPSG:3035, **CC BY 4.0**. Sentinel-1/-2 time series + DEM, XGBoost; classes 0 pine, 1 spruce, 2 Douglas fir, 3 larch, 4 fir, 5 beech, 6 oak, 7 birch, 8 alder, 9 other (deciduous), 666 canopy cover loss; 999 = no data (outside the forest mask: gardens, streets and single trees in villages have no class). Only the window over the stats bbox `[orte]` + 200 m is read (HTTP range requests, cached under `data/raw/dlr-tree-species/`); the app never calls DLR at runtime ([ADR 0022](adr/0022-local-first-no-accounts.md)). Cross-check (not published as pixels): Thünen *Dominant Tree Species for Germany 2017/2018* (Blickensdörfer et al. 2024, doi:10.3220/DATA20221214084846, CC BY 4.0), see `crossCheck`.

```ts
species = {
  format: 'sle-species-v1',              // anything else → the whole key is ignored
  path: 'species/species.png',           // relative to the AOI dir: ONE 8-bit greyscale PNG for the whole AOI
  encoding: 'u8-class',
  cellSize: 10,                          // metres per pixel
  size: { width: number, height: number },// = ceil(AOI width / 10) × ceil(AOI height / 10)
  nodata: 255,
  year: 2022,                            // reference year of the map
  classes: Array<{
    code: number,                        // pixel value 0–10
    key: string,                         // 'pine' | 'spruce' | 'douglas_fir' | 'larch' | 'fir' | 'beech' | 'oak' | 'birch' | 'alder' | 'other_broadleaf' | 'canopy_loss'
    label_de: string,                    // 'Kiefer' | 'Fichte' | 'Douglasie' | 'Lärche' | 'Tanne' | 'Buche' | 'Eiche' | 'Birke' | 'Erle' | 'andere Laubbäume' | 'Kronendachverlust (keine Art)'
    group: 'conifer' | 'broadleaf' | 'none',
    species: boolean,                    // false for canopy_loss: no species, no probability
    f1?: number                          // class F1 (0…1, two decimals); present iff species
  }>,
  probability: { method: 'species-dlr-neighbourhood-v1', contradictionDivisor: 2, minPct: 10, maxPct: 90,
                 likelyPct: 50, contradiction: 'type-conifer-in-broadleaf-class' },
  accuracy: { overallF1: 0.89, perClass: 'classes[].f1', source: string, note_de: string },
  crossCheck?: { against, attribution, area, n, agreePct, groupAgreePct,
                 perClass: { [key]: { agreeOfDlrPct, dice } }, note_de },   // informative
  method: 'dlr-nearest-25832-v1', generated: ISO-8601,   // informative
  label_de: 'Baumart (Schätzung, 10-m-Raster)',
  attribution: string,                   // also merged into the top-level `attribution`
  source: string                         // informative: product + paper citation
}
```

**Classes and F1** (Wegler et al. 2025, Table 4, XGBoost S2-S1-DEM; test samples of **pure** stands, so mixed stands, forest edges and single trees are less certain):

| code | key | label_de | group | f1 |
|---|---|---|---|---|
| 0 | pine | Kiefer | conifer | 0.98 |
| 1 | spruce | Fichte | conifer | 0.94 |
| 2 | douglas_fir | Douglasie | conifer | 0.91 |
| 3 | larch | Lärche | conifer | 0.96 |
| 4 | fir | Tanne | conifer | 0.88 |
| 5 | beech | Buche | broadleaf | 0.95 |
| 6 | oak | Eiche | broadleaf | 0.76 |
| 7 | birch | Birke | broadleaf | 0.90 |
| 8 | alder | Erle | broadleaf | 0.89 |
| 9 | other_broadleaf | andere Laubbäume | broadleaf | 0.76 |
| 10 | canopy_loss | Kronendachverlust (keine Art) | none | — |

The app takes codes, labels, groups and F1 from the manifest, not from this table.

**Grid** (method `dlr-nearest-25832-v1`, same convention as "Historic forest mask"). Pixel `(px, py)` (row 0 = north) covers the 10 m square whose **centre** is `E = E0 + (px + 0.5) · 10`, `N = N0 + height − (py + 0.5) · 10`. Lookup of a point: `px = floor((E − E0) / 10)`, `py = floor((N0 + height − N) / 10)`; outside `0 … width−1 / 0 … height−1` → no data. Each cell takes the DLR pixel that **contains its centre** (exact ETRS89 UTM 32 → LAEA with pyproj, no resampling filter), so AOIs whose edges lie on the 10 m lattice share identical values where they overlap (the pipeline's stats-area raster equals the app raster inside the AOI). Decode as data (`createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })` or a PNG decoder). Values: `0–9` species class, `10` canopy cover loss (DLR 666), `255` no data / not forest; any other value → no data. One file (≈ 75 KB for `overall`), loaded once when the tree card needs it.

**Per-tree probability `species-dlr-neighbourhood-v1`.** The DLR map gives one class per cell and **no probabilities**, so the app shows a transparent heuristic, not a calibrated probability. For a tree at `(E, N)` with base type `t = type & 0x7F` from the Trees layer (0 unknown, 1 conifer, 2 broadleaf; other codes → 0; fill trees included):
1. `(px, py)` by the lookup above; outside → **no species**. `c = value(px, py)`; if `c` is not a class with `species: true` (255, 10, unknown) → **no species**.
2. Over the 3 × 3 block `px−1 … px+1, py−1 … py+1`: `n` = cells inside the raster (9; 6 on an edge; 4 in a corner), `k` = those whose value equals `c` (the centre counts, so `k ≥ 1`).
3. `f = round(100 · f1(c))` as an integer (0.95 → 95).
4. **Contradiction** `x` = `t == 1 && group(c) == 'broadleaf'`. One-sided on purpose: the DOP colour type "broadleaf" is no evidence against a conifer class (in pure 3 × 3 pine blocks of the stats area 93 % of the trees read "broadleaf", in spruce / Douglas fir blocks 50–59 %), while a "conifer" (dark) crown is rare in pure broadleaf blocks (≈ 3 %) and more common in dark conifer blocks (≈ 17 %).
5. Integer arithmetic (identical in TS and Python): `num = k · f`, `den = n · (x ? 2 : 1)`, `pct = 10 · floor((num + 5 · den) / (10 · den))` (= `k/n · f` rounded half-up to 10 %), then `pct = min(90, max(10, pct))`. Never above 90 %: a 10 m stand class is never certain for one crown.
6. **Wording:** `!x && pct ≥ 50` → „wahrscheinlich {label_de} ({pct} %)“, otherwise „{label_de}? unsicher ({pct} %)“; with `x` add that the crown colour reads as conifer. Always with „Schätzung“, the year 2022 and `attribution`. No species → „Baumart: keine Angabe (außerhalb der Waldkarte)“ or no row.

**Tree group `tree-group-v1`** (conifer / broadleaf of one tree, Phase 1 review 2026-11-08). The DOP colour type alone reads most conifers as broadleaf (pure pine blocks: 93 % „broadleaf“; 79 % of the trees with a „wahrscheinlich“ conifer class have type 2), so wherever one tree's group matters (the *Baum-Steckbrief* title „🌲 Nadelbaum / 🌳 Laubbaum / 🌳 Baum“ and ρ in `crown-allometry-v2`) the species class wins. With `c`, `pct`, `x` from the steps above and `t` the base type: a class with `!x && pct ≥ 50` („wahrscheinlich“) → its group (`conifer` → 1, `broadleaf` → 2); a class that is „unsicher“ → `t` when `t` is that class's group, else **0** (no group: the two sources disagree); no class (outside, no data, canopy loss) → `t`. TS `treeGroup` (app/src/trees/treeSpecies.ts) and Python `species.tree_group` must agree (both test the same cases).

Test vectors (pipeline `tests/test_species.py` checks the same; the TS port should too):

| k | n | f | x | pct |
|---|---|---|---|---|
| 9 | 9 | 95 | false | 90 (95 → 100, capped) |
| 6 | 9 | 95 | false | 60 (63.3) |
| 1 | 2 | 90 | false | 50 (45, half-up) |
| 3 | 4 | 76 | false | 60 (57) |
| 9 | 9 | 76 | true | 40 (38) |
| 1 | 9 | 76 | true | 10 (4.2 → 0, floor 10) |

**Per place** (not in the manifest; stats input `data/work/orte/species_by_place.json`, `sle-species-by-place-v1`, local): per place the crown-area-weighted species mix of its trees (`crown-disc-v1`, trees assigned by `parcel-pip-v1` as in "Place statistics"), the dominant class, the number of trees with a species, the coverage (crown area with a species ÷ all crown area), the conifer share (DLR) next to the DOP colour-type conifer share, the mean probability and the DLR cell area per class inside the outline. `species_trees.npy` (u8 code, 255 none) and `species_prob_trees.npy` (u8 %, 0 none) are aligned with `trees.npz` for the *Riesen* list. Publishing any of it goes through `stats/places.json` (contract change there first); aggregates only (G1–G3).

**Cross-check** (2026-11-08, stats bbox, 735,813 forest cells classified in both maps): exact class agreement 50.0 %, conifer/broadleaf agreement 88.3 %. Per DLR class (share of its cells that Thünen gives the same class): pine 38 %, spruce 79 %, Douglas fir 77 %, larch 19 %, beech 78 %, oak 59 %, birch 61 %, alder 7 %, other 6 %. The maps differ in year (2017/18 vs 2022: of the DLR canopy-loss cells, 8,659 were Thünen spruce) and in method (Thünen trains on the national forest inventory), so agreement is not accuracy. Largest disagreements: DLR pine is Douglas fir in Thünen for 37 % of its cells, larch for 25 %; DLR alder (7 % of the forest cells here, suspiciously many) is oak, beech or Douglas fir in Thünen for 80 %, DLR "other" is beech or oak for 58 %; beech ↔ oak confusion is 16–30 % both ways. So alder and "other" are the weakest classes here, and the app should not single out an alder or "other" tree. Details: `data/work/orte/species_crosscheck.json` (local).

**Manifest + attribution.** The species step owns the whole `species` key (replaced on each run via `update_manifest`) and adds `Baumarten: DLR, Tree Species Germany 2022 (Wegler et al. 2025), CC BY 4.0, doi:10.15489/smh8w3j8i962, Daten bearbeitet (umprojiziert)` to the top-level `attribution` (CC BY 4.0 requires the credit and the note that the data were changed). No Thünen pixel is published, but the cross-check numbers (`crossCheck`, agreement per class) derive from it and ship with the manifest, so the step also merges `Abgleich Baumarten: Thünen-Institut, Dominant Tree Species for Germany 2017/2018 (Blickensdörfer et al. 2024), CC BY 4.0` into the top-level `attribution` when `crossCheck` is present, and the release credits it in NOTICE.md. The release export may publish the PNG (CC BY 4.0, same credit); it contains no personal data.

**App tolerance.** Missing `species`, a non-object, `format` ≠ `sle-species-v1`, a non-string `path`, `cellSize` not a positive number, `size` not two positive integers or `classes` not an array → absent (logged, not fatal). A 404, a decode error or an image whose size ≠ `size` → absent. A class entry without a numeric `code`, or with `species: true` but no `f1` in `(0, 1]`, is skipped (its pixels read as no species). Unknown fields are ignored; a missing `probability` block uses the values above.

## 🏆 Place statistics (`stats`, optional, Orte im Vergleich)

Aggregates per place (Gemarkung) for the leaderboard *Orte im Vergleich*: parcels, trees, canopy, biomass range, built-up area (*Ortslage*), green and sealed shares, inhabitants, tallest tree, PV totals per municipality; since Phase 1 also the *Riesen* (top trees), species mix, observed biodiversity, forest age and 1935 forest share, land use, roof PV potential and example goals. Written by `pipeline/stats.py`; plan: [docs/plans/orte-im-vergleich.md](plans/orte-im-vergleich.md); decision: [ADR 0049](adr/0049-orte-im-vergleich-places-only.md). `stats` is an optional top-level key (additive, valid in v1 and v2); manifests without it stay valid and the app hides the panel.

**Phase 1 additions (2026-11-08)** are additive inside `sle-stats-v1` (`format` and `version: 1` unchanged): new optional fields in `Place` (`riesen`, `species`, `biodiversity`, `forest_continuity_pct`, `forest_continuity`, `forest_age`, `nutzung`, `roof_potential`, `goals`), in `Municipality` (`roof_potential`, `pv.used_pct`, `pv.used_pct_reason_de`), at the top level (`labels_de`) and in `Input` / `Discipline` (`note_de`); the discipline `artenvielfalt` is `ready`. A Phase 0 reader ignores all of them. Every Phase 1 block comes from an optional pipeline input (`data/work/orte/*_by_place.json`): when that input is missing the field is `null` (or absent) and its source is not listed in `inputs`. **Phase 1 review fixes (2026-11-08, still additive):** `tree-age-height-v2` (trees taller than the yield table get no age: class `beyond`, `forest_age.trees_beyond`), `roof-pv-potential-v2` (flat roofs usable × 0.4), Riesen species only when „wahrscheinlich“, `Goal.note_de` and the `entsiegeln` goal as a deed counter; a reader that does not know `beyond` or `note_de` shows / ignores them as unknown keys. **Review round 2 (2026-11-08, still additive):** `crown-allometry-v2` (ρ from `tree-group-v1`, so biomass values change), `species.mix[].weak`, `roof_potential.usable_m2`.

**Privacy (G1–G3, binding).** Every published value is an aggregate over a **place** (or a municipality). The files contain **no** per-parcel, per-building or per-person value, no parcel id (`flstkennz`), no address and no owner data. Per-building PV detections, per-building roof planes and per-parcel intermediates stay in `data/work/orte/` and are never written under `app/public/data/`. **Minimum-size rule:** an aggregate that rests on fewer than **5** buildings (Ortslage, PV, roof potential) or 5 parcels (place totals) is not published: the value is `null` and its field path is listed in the place's `suppressed`. A place with fewer than 5 parcels is left out entirely. The only published points are trees: `tallest` and the `riesen` list (≤ 10 per place, `riesen[0]` = `tallest`). Every one passed the `tallest-checked-v4` checks, so it is never inside the Ortslage (no garden tree is published by position) and always ≥ 10 m inside the place outline; they carry no parcel id. GBIF data enter only as counts per place (no record, coordinate or species name). The stats step refuses to write a file with a parcel-id, owner, address or person key (matched by fragment) or a parcel-id- or address-like string value, and outline features with properties other than `{id, name_de}`.

**Stats extent ≠ AOI.** Statistics may cover a larger area than the 3D tiles (all nine places, including all of Zweibrücken) without publishing tiles for it. `extent` is the area whose inputs were processed; trees outside the AOI come from a stats-only `trees.py` run with the same method, so tree ids follow the Trees rule everywhere. One difference: the Trees layer drops every top above `max_height` (45 m); the stats run keeps tops up to the detector's CHM clip (60 m; a top at the clip is re-measured on the unclipped CHM and kept up to 75 m, see `tallest-checked-v4`) and counts a top above 45 m only when it passes the `tallest` plausibility checks (the stats area has real 50–61 m conifer stands). So a place's `tallest` tree is often **not** in the AOI's Trees layer (above 45 m, or outside the 3D tiles): `tallest.in_trees` says whether it is. When it is `false` the app draws its own marker at `tallest.E/N` (ground from the terrain) instead of looking the tree up by `id`. `aoi_share_pct` tells the app how much of a place it can show in 3D.

**Manifest key** (owned by the stats step, replaced on each run via `update_manifest`, all other keys kept):

```ts
stats = {
  format: 'sle-stats-v1',                 // anything else → the whole key is ignored
  url: 'stats/places.json',               // relative to the AOI dir
  geometry?: 'stats/places.geojson',      // relative to the AOI dir; outlines, see below
  generated: string,                      // ISO 8601 UTC, = places.json `generated`
  places: number,                         // = places.json places.length
  label_de?: string                       // default 'Orte im Vergleich'
}
```

### `stats/places.json`

UTF-8 JSON, compact (≈ 60 KB with the Phase 1 blocks, target < 80 KB, see **Size** below). All coordinates **EPSG:25832 metres `[E, N]`** (not the local frame). All paths relative to the AOI dir.

```ts
Range = [lo: number, mid: number, hi: number]   // lo ≤ mid ≤ hi, an estimate (G7); the UI shows "lo–hi" and labels it „geschätzt“
Places = {
  format: 'sle-stats-v1',
  version: 1,                             // bumped only for breaking changes (then format changes too)
  generated: string,                      // ISO 8601 UTC
  aoi: string,                            // e.g. 'overall'
  crs: 'EPSG:25832',
  extent: [Emin, Nmin, Emax, Nmax],       // integer metres, area whose inputs were processed
  geometry?: { url: 'stats/places.geojson', simplify_m: 10, featureCount: number },
  min_count: 5,                           // minimum-size rule actually applied
  label_de: 'Orte im Vergleich',
  disclaimer_de: string,                  // e.g. „Schätzungen aus Luftdaten, keine amtlichen Zahlen …“; the panel shows it
  inputs: Record<InputId, Input>,
  method: Record<Topic, Method>,
  disciplines: Discipline[],
  places: Place[],                        // sorted by name_de (de collation); NOT a ranking
  municipalities: Municipality[],
  labels_de?: {                           // German labels for the keys used below (Phase 1); the app takes labels from here
    species: Record<SpeciesKey, string>,  // 'beech' → 'Buche' … (the 10 species classes of "Tree species", no canopy_loss)
    age_classes: Record<'young' | 'middle' | 'old' | 'very_old' | 'beyond', string>,   // 'jung (unter 40 Jahre)' … 'höher als die Ertragstafel (ohne Alter)'
    nutzung: Record<NutzungGroup, string> // 'forest' → 'Wald und Gehölz' …
  },
  attribution: string                     // '; '-joined verbatim entries of all inputs used (no duplicates)
}
```

**`inputs`** — one entry per source actually used; ids are free snake_case (`lidar_sl`, `lidar_rlp`, `alkis_sl`, `alkis_rlp`, `lod2_sl`, `lod2_rlp`, `dop_cir_sl`, `dop_rgbi_rlp`, `osm`, `zensus`, `mastr`, `imperviousness`; Phase 1: `species_dlr`, `gbif`, `hist_maps_sl` …):

```ts
Input = {
  name_de: string,                        // e.g. 'Digitales Oberflächenmodell DOM1'
  provider: string,                       // e.g. 'LVGL-SL', 'LVermGeoRP', 'Destatis', 'BNetzA', 'OSM', 'EEA/Copernicus'
  year: number | null,                    // data epoch (flight / census / register year), null if unknown
  retrieved: string,                      // ISO date of the download (cached copy)
  licence: string,                        // SPDX-like: 'dl-de/by-2-0', 'ODbL-1.0', 'CC-BY-4.0' …
  attribution: string,                    // verbatim Quellenvermerk, no ';' (ADR 0026 rules: retrieval year, trailing (<Layer>) tag)
  url?: string,                           // dataset URI (https://…)
  note_de?: string                        // extra licence note for the sources dialog (e.g. GBIF: contains iNaturalist CC BY-NC records)
}
```

The stats step also merges every `attribution` entry into the manifest's `attribution` string (as in "manifest.json"). Examples: `© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (DOP20)` for the CIR DOP, `Zensus 2022, © Statistische Ämter des Bundes und der Länder, dl-de/by-2-0` (wording confirmed against the bundled description before release), `Marktstammdatenregister, © Bundesnetzagentur, dl-de/by-2-0`, `© OpenStreetMap-Mitwirkende, ODbL`. Phase 1 (licences checked 2026-11-08): `species_dlr` = the "Tree species" credit (CC BY 4.0, also used for the Riesen species and the age estimate), `gbif` = `GBIF.org (<query date>) GBIF Occurrence Search, https://www.gbif.org` with licence `CC0-1.0 / CC-BY-4.0 / CC-BY-NC-4.0 (je Datensatz)` and the iNaturalist CC BY-NC note in `note_de` (only counts are published; GBIF prefers a DOI-backed derived-dataset citation for a public release, which needs a GBIF account: release decision), `hist_maps_sl` = `© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet (Historische Karten)`. The yield tables of `tree-age-height-v2` are literature, cited in `method.forest_age.params.tables`.

**`method`** — keyed by topic; the `id` is versioned and changes whenever the algorithm or a parameter that changes results changes (`-v1` → `-v2`). Ids in Phase 0:

| Topic | `id` | Meaning |
|---|---|---|
| `assign` | `parcel-pip-v1` | trees and areas belong to the place whose parcels contain the tree top (point in polygon, `make_valid`, first match) |
| `crown` | `crown-disc-v1` | crown area = Σ π r² of the place's trees; `crown_pct` = crown area ÷ place area (capped at 100) |
| `biomass` | `crown-allometry-v2` | `D = 0.557 · (H · 2r)^0.809` cm; `AGB = 0.0673 · (ρ · D² · H)^0.976` kg; ρ = 0.42 for a conifer, 0.60 else, the group by `tree-group-v1` ("Tree species": a „wahrscheinlich“ DLR class wins over the DOP colour type); `lo = mid · 0.5`, `hi = mid · 2`; CO₂ = 1.8 × AGB. v1 (until 2026-11-08) took the group from the colour type alone, which reads most conifers as broadleaf |
| `ortslage` | `ortslage-bldg-buffer-50m-v1` | union of LoD2 footprints buffered 50 m, holes < 1 ha closed, clipped to the place; checked against OSM `landuse=residential` (overlap reported in `params`). Includes commercial, industrial and clinic sites and outlying plant buildings (e.g. a landfill), not only housing; the discipline texts say so |
| `green` | `ndvi-cir-v1` | Ortslage cell is green when CHM ≥ 3 m **or** NDVI ≥ threshold (SL CIR WMS, RLP RGBI tiles); `canopy_pct` = CHM ≥ 3 m part only |
| `sealed` | `sealed-v1` | Ortslage cell is sealed when it is not green, not OSM water, and a building (LoD2 mask), an OSM paved road (buffered by its `width` or road class) / parking / square / `area:highway`, or non-vegetated in the NDVI (< `ndvi_bare_max`, 0.08 on the SL scale; also catches unmapped yards and bare soil). Copernicus imperviousness is **not** used in v1 (`params.imperviousness`); adding it means `sealed-v2` |
| `inhabitants` | `zensus-grid-area-v1` | Σ Zensus 2022 100 m cells × share of the cell inside the place |
| `tallest` | `tallest-checked-v4` | highest non-fill tree that passes the plausibility checks (crown radius ≥ 2 m; CHM support, no single-cell spike or narrow tower top; a top at the detector's 60 m CHM clip is re-measured on the **unclipped** CHM (DSM − DTM) and must stay ≤ 75 m (`max_tree_m`; taller = mast, wind turbine, crane), and is rejected as `chm-clip` (the v3 rule) when no unclipped window can be read; **no line-shaped top** (cells ≥ 0.8 h within 8 m connected to the top have a principal-axis ratio ≤ 3: crane jibs, rotor blades and cables are long and thin); no LoD2 building within 5 m; no OSM pylon / mast / tower / chimney / **wind turbine** (`power=generator` + `generator:source=wind`) within **30 m**; terrain: DTM rises ≤ 3 m within 4 m of the top, so no gully bottom or bank foot under overhanging canopy; valley: mean DTM within 15 m ≤ 3 m above the top's ground, so no ravine bottom spanned by the canopy of both slopes) **and stands outside the Ortslage** (no garden tree is published by position, G1/G2) **and ≥ 10 m inside the place outline** (`edge_clear_m`; a top on the Gemarkung line may belong to the neighbour and must stay inside the 10 m-simplified outline); detector clip 60 m, see `params`. The height is the LiDAR CHM at the top cell (unclipped for tops at the clip), not a ground measurement. v3 (until 2026-11-07) rejected every top at the 60 m clip and knew no wind turbines nor line shapes |
| `category` | `category-inhabitants-v1` | `category` = `'stadt'` from 5,000 inhabitants (`inhabitants`, grid estimate) on, else `'dorf'` |
| `pv_mastr` | `mastr-municipality-v1` | MaStR PV units „in Betrieb“ per municipality key, balcony plants included |
| `riesen` | `riesen-checked-v1` | up to **10** trees per place that pass every `tallest-checked-v4` check (incl. outside the Ortslage, ≥ 10 m inside the outline), picked greedily by height (h to 0.01 m descending, ties → lower id), each **≥ 20 m** (2D) from every tree picked before it, so one tall stand does not fill the list; `riesen[0]` is the `tallest` tree. At most 2,000 candidates are checked per place (the `tallest` budget) |
| `species` | `species-dlr-crown-mix-v1` | per tree the DLR class of the 10 m cell under its top ("Tree species", `dlr-nearest-25832-v1`); per place the share of each class in the **crown area with a class** (Σ π r², `crown-disc-v1`, trees by `parcel-pip-v1`); `coverage_pct` = crown area with a class ÷ all crown area (village and garden trees lie outside the DLR forest mask); canopy loss is no class. `alder` and `other_broadleaf` entries carry `weak: true` (`params.weak`): the Thünen cross-check agrees with them for < 10 % of their cells here, so the app marks their shares as unsure |
| `biodiversity` | `gbif-rarefied-v1` | GBIF occurrence search per place outline (simplified 20–80 m, `hasCoordinate`, no geospatial issue, `PRESENT`), facet counts only (`gbif-facets-v1`); `rarefied_500` = Hurlbert expected species in 500 random species-level records, interval ± 1.96 SD (Heck 1975, sampling noise only); `null` below 500 records |
| `forest_age` | `tree-age-height-v2` | the "Tree age estimate" rule per tree (height − 2 m, yield tables, species from the DLR map, else the tree type); per place the classes of the middle estimate weighted by crown area of the trees ≥ 8 m, the trees taller than the class-II table end as their own class `beyond` (no age), and the median middle estimate of the trees **with** an age. v1 clamped such trees to the last table age |
| `forest_continuity` | `hist-forest-crown-share-v1` | share of the crown area (inside the historic forest mask, with a map on every classified epoch) that stands on forest on **every** classified map; with one classified map (1935–40) it is a snapshot, not continuity; `null` when the mask covers < 50 % of the place's crown area |
| `nutzung` | `alkis-nutzung-groups-v1` | ALKIS *tatsächliche Nutzung* per parcel (RLP WFS 519; SL WFS 414 pending) grouped by keyword (first match, `params.rule`) into 7 groups, shares of the official area |
| `roof_potential` | `roof-pv-potential-v2` | LoD2 roof planes (true sloped area, tilt, facing): planes ≥ 10 m², tilt ≤ 60°, flat (< 10°) or facing E…S…W are suitable; usable = pitched suitable × 0.7 + **flat suitable × 0.4** (row spacing against self-shading, parapets, skylights; v1 used 0.7 for flat roofs too, ≈ 9–11 kWp per inhabitant in the industrial places); kWp = usable × 0.15 / 0.18 / 0.20 kWp/m² (no shading or statics check). `pv.used_pct` = MaStR building PV kWp ÷ potential (lo uses the hi potential), only for a municipality whose Gemarkungen are all processed |
| `goals` | `goals-examples-v1` | the plan's §5 example goals per place with the published baseline; `progress` is `null` until a second LiDAR epoch or community data exists |

```ts
Method = { id: string, label_de?: string, params?: Record<string, unknown> }   // params informative (thresholds, radii, ρ …)
```

**`disciplines`** — the app renders every leaderboard generically from this list (no discipline is hard-coded):

```ts
Discipline = {
  id: string,                             // slug, e.g. 'gruenste-ortslage'
  name_de: string,                        // 'Grünste Ortslage'
  emoji?: string,                         // '🌳'
  description_de: string,                 // one line, what is measured
  scope: 'place' | 'municipality',        // which array `measure` reads from
  measure: string,                        // dotted path into Place / Municipality, e.g. 'ortslage.green_pct'
  unit: string,                           // display unit: '%', 'm', 'Bäume/Einw.', 'kWp/Einw.'
  higher_is_better: boolean,
  method: string,                         // a method id from `method`, e.g. 'ndvi-cir-v1'
  ready: boolean,                         // false → listed as „bald“, no board
  note_de?: string                        // caveat shown with the board (e.g. „Grober Hinweis, keine Messung …“)
}
```

Phase 0 + 1 list (pipeline may add more; Biomass is **never** a discipline, Q3):

| `id` | `measure` | `unit` | higher better | `method` | `ready` |
|---|---|---|---|---|---|
| `gruenste-ortslage` | `ortslage.green_pct` | `%` | ✓ | `ndvi-cir-v1` | ✓ |
| `wenigsten-beton` | `ortslage.sealed_pct` | `%` | ✗ | `sealed-v1` | ✓ |
| `baeume-pro-einwohner` | `trees_per_inhabitant` | `Bäume/Einw.` | ✓ | `zensus-grid-area-v1` | ✓ |
| `waldreichste-gemarkung` | `crown_pct` | `%` | ✓ | `crown-disc-v1` | ✓ |
| `riesenbaum` | `tallest.h` | `m` | ✓ | `tallest-checked-v4` | ✓ |
| `sonnenstaerkster-ort` | `pv.kwp_per_inhabitant` (scope `municipality`) | `kWp/Einw.` | ✓ | `mastr-municipality-v1` | ✓ |
| `groesster-fortschritt` | — | — | ✓ | — | ✗ |
| `artenvielfalt` | `biodiversity.rarefied_500` | `Arten` | ✓ | `gbif-rarefied-v1` | ✓ (✗ without GBIF input: `measure`/`method` empty) |

**`artenvielfalt` measures observations, not nature.** The value is effort-normalised (expected species among 500 random records), but it still depends on *what* people record: bird-list datasets lower it, insect- and plant-rich iNaturalist samples raise it, grid-generalised records can fall into a neighbouring place, and the ≤ 1 km-uncertainty variant reorders places (`method.biodiversity.params.caveats`). `description_de` says so and `note_de` carries the „grober Hinweis“ caveat; the app shows both with the board. Places with fewer than 500 species-level records have `rarefied_500: null` and `few_records: true` → „keine Daten“ (unranked).

**Ranking rule (app).** A board ranks entries of its `scope` whose `measure` is a finite number; ties share a rank. Places with `complete: false` are listed below the board, unranked, marked „unvollständig“. `null` (suppressed or not available) shows „keine Daten“, unranked. `other-flight` places are ranked with a badge „andere Befliegung“, with the year mix from `lidar_epochs` when present (e.g. „andere Befliegung: 47 % 2022“).

**`places`:**

```ts
Place = {
  id: string,                             // slug: lowercase, ä→ae ö→oe ü→ue ß→ss, other non [a-z0-9] → '-'; e.g. 'kirrberg', 'einoed', 'moersbach', 'bruchhof-sanddorf'
  name_de: string,                        // 'Einöd' = the Gemarkung name; the UI says „Gemarkung Einöd“, not the Stadtteil (outlines and inhabitants differ, see below)
  kind: 'gemarkung' | 'gemarkung-group' | 'ortsteil',   // Phase 0: 'gemarkung' (a town of several Gemarkungen: 'gemarkung-group')
  gemarkungen: string[],                  // ALKIS Gemarkung names as in flurstuecke `gemarkung`
  state: 'SL' | 'RLP',
  municipality: string,                   // id into `municipalities`, e.g. 'homburg', 'zweibruecken', 'bechhofen'
  category: 'stadt' | 'dorf',             // fairness size class (§5 of the plan): by inhabitants, see method `category`
  complete: boolean,                      // false when flags contain 'cut-by-aoi' or an input does not cover the place
  flags: Flag[],
  suppressed: string[],                   // field paths nulled by the minimum-size rule, e.g. ['ortslage']
  lidar_epoch: number,                    // flight year of the majority of the place's LiDAR cells: 2025 (SL) or 2022 (RLP)
  lidar_epochs?: Array<[year: number, pct: number]>,   // share of the place's LiDAR cells per flight, largest first; pct 0.1
  label: [E, N],                          // label / fly-to point inside the outline (pole of inaccessibility), integer m
  bbox: [Emin, Nmin, Emax, Nmax],         // of the full outline, integer m
  aoi_share_pct: number,                  // share of area_ha inside the 3D AOI tiles (0 … 100)
  area_ha: number,                        // Σ official parcel area (ALKIS flaeche_m2, else polygon area)
  parcels: number,
  trees: number,                          // non-fill + fill trees with their top inside the place (tops > 45 m only when plausible, see "Stats extent")
  crown_ha: number,
  crown_pct: number,
  agb_t: Range,                           // above-ground dry biomass, tonnes (estimate, G7)
  co2_t: Range,                           // CO₂ equivalent, tonnes (estimate, G7)
  ortslage: null | {
    area_ha: number,
    buildings: number,                    // LoD2 buildings used (≥ min_count, else ortslage = null)
    canopy_pct: number,                   // CHM ≥ 3 m
    green_pct: number,                    // canopy + green below 3 m; ≥ canopy_pct
    sealed_pct: number                    // green_pct + sealed_pct ≤ 100
  },
  inhabitants: number | null,             // Zensus 2022, apportioned
  trees_per_inhabitant: number | null,
  tallest: null | { h: number, E: number, N: number, id: number, in_trees?: boolean },
                                          // id = stable tree id by the Trees rule; E, N = top cell centre;
                                          // in_trees: the AOI's Trees layer holds this id (false: above max_height or outside the tiles → own marker)
  pv: null,                               // Phase 0 always null (flag 'pv-municipality-only'); Phase 1: aggregates only, see below

  // ---- Phase 1 (optional; null / absent when the input is missing) ----
  riesen?: Array<{                        // riesen-checked-v1: ≤ 10 trees, h descending; riesen[0] = tallest
    rank: number,                         // competition rank on the published h (45.1, 44.0, 44.0, 43.2 → 1, 2, 2, 4)
    h: number, E: number, N: number,      // as tallest: CHM height (unclipped at the 60 m clip), top cell centre
    id: number,                           // stable tree id by the Trees rule (no parcel id)
    in_trees: boolean,                    // as tallest.in_trees: false → the app draws its own marker
    species?: { key: SpeciesKey, p: number }   // DLR class at the top + species-dlr-neighbourhood-v1 probability, only when „wahrscheinlich“
                                          // (p ≥ 50 %, no conifer-in-broadleaf contradiction; since 2026-11-08, before: 10–90 %);
                                          // absent without a class, for canopy loss, for „unsicher“ classes and for 'alder' / 'other_broadleaf' (weakest classes here)
  }>,
  species?: null | {                      // species-dlr-crown-mix-v1 (null: < 5 trees with a class)
    mix: Array<{ key: SpeciesKey, share_pct: number, weak?: true }>,   // share of the crown area with a class, descending (ties → lower class code); 0.0 entries dropped;
                                          // weak: the class is unreliable here (alder, other_broadleaf; review 2026-11-08), absent otherwise
    dominant: SpeciesKey,                 // = mix[0].key
    method: 'species-dlr-crown-mix-v1',
    coverage_pct: number,                 // crown area with a class ÷ all crown area of the place
    conifer_pct: number,                  // DLR conifer classes in the mix
    trees: number                         // trees with a class
  },
  biodiversity?: null | {                 // gbif-rarefied-v1: counts of GBIF records inside the outline (observations, not individuals)
    species: number,                      // distinct species among the records
    occurrences: number,                  // records
    inat_share_pct: number | null,        // share of iNaturalist research-grade records
    rarefied_500: number | null,          // expected species in 500 random records (whole species); the board measure
    rarefied_500_range: Range | null,     // [−1.96 SD, value, +1.96 SD]
    rarefied_150_range: Range | null,     // the same at 150 records (covers the small places, less discriminating)
    few_records: boolean,                 // fewer than 500 species-level records → rarefied_500 null
    years: [from: number, to: number] | null   // first and last record year
  },
  forest_continuity_pct?: number | null,  // hist-forest-crown-share-v1 (null: mask covers < 50 % of the crown area)
  forest_continuity?: null | {
    covered_pct: number,                  // share of the crown area inside the historic mask
    epochs: number[],                     // classified map epochs used, e.g. [1935]
    snapshot: boolean                     // true with one classified map: „laut Karte 1935–40 Wald“, never „seit“
  },
  forest_age?: null | {                   // tree-age-height-v2 (Schätzung)
    trees: number,                        // trees ≥ 8 m with an estimate (beyond the table excluded)
    trees_beyond?: number | null,         // trees ≥ 8 m taller than the class-II table end: no age (v2; absent/null from a v1 work file)
    median_y: number | null,              // median middle estimate of the trees with an estimate, 5 years
    classes_pct: { young: number, middle: number, old: number, very_old: number, beyond?: number }
                                          // by crown area of all trees ≥ 8 m, sum ≈ 100; labels in labels_de.age_classes; readers keep unknown keys
  },
  nutzung?: null | {                      // alkis-nutzung-groups-v1; null while the land use is unknown (SL: WFS 414 pending)
    source: 'alkis',
    shares_pct: Record<NutzungGroup, number>   // forest, agriculture, garden_green, settlement, traffic, water, other
  },
  roof_potential?: null | {               // roof-pv-potential-v2 (Schätzung); null + suppressed 'roof_potential' below 5 buildings
    buildings: number,                    // LoD2 buildings of the place
    suitable_m2: number,                  // suitable roof area (true sloped area) BEFORE the usable factors, 100 m²
    usable_m2?: number,                   // usable area = pitched suitable × 0.7 + flat suitable × 0.4 (the base of kwp), 100 m²; since 2026-11-08
    kwp: Range                            // installable power, kWp
  },
  goals?: Goal[]                          // see "Goals"
}
SpeciesKey = 'pine' | 'spruce' | 'douglas_fir' | 'larch' | 'fir' | 'beech' | 'oak' | 'birch' | 'alder' | 'other_broadleaf'
NutzungGroup = 'forest' | 'agriculture' | 'garden_green' | 'settlement' | 'traffic' | 'water' | 'other'
Flag = 'other-flight'                     // LiDAR (≥ 1 % of the cells, or an RLP place) from another flight (RLP 2022 vs SL 2025, Q5); shares in `lidar_epochs`
     | 'cut-by-aoi'                       // outline reaches beyond `extent` or an input's coverage; totals are partial
     | 'pv-municipality-only'             // no own PV figure; the card shows the municipality's MaStR total
     | 'estimate'                         // a normally measured value (area, trees, inhabitants) was extrapolated here; UI prefixes „≈“
```

**Gemarkung ≠ Stadtteil.** A place is the cadastral Gemarkung, not the district people know: built-up areas cross Gemarkung lines (part of Schwarzenbach lies in Gemarkung Einöd), so `inhabitants` differs from the town's district figures by up to ≈ ±25 % (Einöd 3,500 vs district 2,810; Beeden-Schwarzenbach 3,560 vs 4,665), while the totals agree. The UI labels places as Gemarkung and shows `disclaimer_de`.

Unknown flags are shown as plain text or ignored; the app must not fail on them. Values that are always estimates (`agb_t`, `co2_t`, PV `kwp`) are `Range`s and need no flag.

**PV per place (reserved shape).** `pv = { source: 'dop-detect', buildings: number, with_pv: number, residential_with_pv_pct: number | null, kwp: Range, roof_potential_used_pct: number | null, method: string }`, aggregates only; `buildings < min_count` → `pv = null` + `suppressed: ['pv']`. Per-building detections are never published. **Not built** (user decision 2026-11-08: no PV detection in the orthophoto for now): Phase 1 PV is the MaStR municipality view plus `roof_potential` per place and municipality, so `pv` stays `null` with the flag `pv-municipality-only`.

**`municipalities`** — MaStR is per municipality, not per Gemarkung (Q10):

```ts
Municipality = {
  id: string,                             // slug, e.g. 'homburg', 'zweibruecken', 'bechhofen'
  name_de: string,
  state: 'SL' | 'RLP',
  ags: string,                            // 8-digit Amtlicher Gemeindeschlüssel
  places: string[],                       // place ids in this file that belong to it (not all its Gemarkungen)
  inhabitants: number | null,             // official Zensus 2022 municipality total (not the grid)
  pv: null | {
    source: 'mastr',
    as_of: string,                        // ISO date of the MaStR export
    systems: number,                      // units in operation
    kwp: number,                          // Σ gross power, kWp (register value, not an estimate)
    kwp_per_inhabitant: number | null,
    small_systems: number,                // units < 30 kWp (no coordinates in MaStR)
    by_year?: Array<[year: number, systems: number, kwp: number]>,  // commissioned per year
    used_pct?: Range | null,              // Phase 1: share of the roof potential in use (MaStR building PV ÷ roof_potential), 0.1 pp;
                                          // null when not all Gemarkungen of the municipality are processed (small PV exists only per municipality)
    used_pct_reason_de?: string | null    // one German line why used_pct is null (null when it is set)
  },
  roof_potential?: null | {               // Phase 1, roof-pv-potential-v2 summed over the processed places of the municipality
    places: string[],                     // place ids it covers (not all Gemarkungen of the municipality)
    suitable_m2: number,                  // 100 m²
    kwp: Range,
    complete: boolean                     // all Gemarkungen of the municipality processed (only then used_pct can be set)
  }
}
```

**Goals** (`goals-examples-v1`, plan §5, „Ziele“). Per place a list of example goals; the app shows them as goals with a baseline, never as a ranking, and draws no progress bar while `progress` is `null`:

```ts
Goal = {
  id: string,                             // 'kronen-ortslage' | 'entsiegeln' | 'riesen-bestimmt' | 'hecke' (more may come)
  title_de: string,                       // e.g. '+2 Prozentpunkte Kronenanteil in der Ortslage bis 2030'
  metric: string | null,                  // dotted path into Place when the baseline is a published field ('ortslage.canopy_pct')
  unit: string,                           // '%', 'm²', 'Bäume', 'm'
  baseline: number | null,                // value at baseline_year; null = not measurable yet (e.g. hedges: no hedge layer)
  baseline_year: number,                  // the place's lidar_epoch for measured baselines, else the year of `generated`
  target: number | null,                  // = baseline + target_delta (rounded like the baseline); null when baseline is null
  target_delta: number,                   // e.g. +2 (pp), −1000 (m²), +500 (m)
  target_year: number,                    // 2030
  measured_by: 'lidar' | 'community',     // next flight (impact) vs reported deeds (Phase 2, needs a backend and a partner, G5/G6)
  progress: null,                         // 0…1 once a second epoch / community data exists; until then always null
  note_de?: string                        // one German context line shown under the values (e.g. today's sealed area)
}
```

Current list (in this order, a goal is left out when its baseline field is missing, e.g. no Ortslage): `kronen-ortslage` (+2 pp `ortslage.canopy_pct`, `lidar`), `entsiegeln` (1,000 m² unsealed in the Ortslage: a deed counter, baseline 0 m² → target 1,000 m², `community`; `note_de` gives today's sealed area `ortslage.area_ha` × `sealed_pct`, 100 m², for comparison — until 2026-11-08 the baseline was that sealed total, so the 1,000 m² step was an invisible 0.03 %), `riesen-bestimmt` (all `riesen` identified on site: species and girth; baseline 0, target = number of Riesen, `community`), `hecke` (500 m of new hedge, baseline `null`, `community`). Goals stay virtual (G5, [ADR 0021](adr/0021-quests-virtual-only.md)): no „go there“ prompt, no digging or planting advice at monuments or relict candidates.

**Rounding (publish rounded values; the pipeline rounds, the app displays as is):**

| Field | Rounding |
|---|---|
| counts: `parcels`, `trees`, `buildings`, `systems`, `small_systems` | whole numbers |
| `inhabitants` | nearest 10 (Zensus cells are altered for confidentiality) |
| `area_ha`, `crown_ha`, `ortslage.area_ha` | 0.1 ha |
| `*_pct` (shares) | 0.1 percentage points |
| `agb_t`, `co2_t`, PV `kwp` Range | each bound 2 significant digits (e.g. `[57000, 110000, 230000]`) |
| `trees_per_inhabitant`, `kwp_per_inhabitant` | 2 significant digits |
| MaStR `kwp` | whole kWp |
| `tallest.h` | 0.1 m; `tallest.E/N` exact cell centre (x.5) |
| `lidar_epochs` pct | 0.1 percentage points |
| `label`, `bbox`, `extent` | whole metres |
| `riesen[].h` | 0.1 m; `E/N` exact cell centre (x.5); `rank` from the rounded h; `species.p` whole % (multiple of 10) |
| `species.mix[].share_pct`, `coverage_pct`, `conifer_pct` | 0.1 percentage points |
| `biodiversity.rarefied_500`, `*_range` | whole species (each bound) |
| `forest_age.median_y` | 5 years; `classes_pct` 0.1 pp |
| `roof_potential.suitable_m2`, `usable_m2` | 100 m²; `kwp` Range 2 significant digits |
| `pv.used_pct` | each bound 0.1 percentage points |
| `goals[].baseline`, `target` | as the source field (`%` 0.1, m² 100) |

Rounding happens last; derived values (shares, per-inhabitant) are computed from unrounded numbers.

### `stats/places.geojson` (outlines)

`FeatureCollection` (UTF-8), one feature per place in `places`, used to fly to a place and outline it (map and 3D). Coordinates **EPSG:25832 `[E, N]`, rounded to 1 m**, 2D only, **not clipped** to the AOI (the full place outline, also beyond `extent` if the parcels are known), **not densified**; the app drapes outlines like vectors where it has terrain and draws them 2D elsewhere. Geometry: dissolved union of the place's ALKIS parcels (`make_valid`), holes < 1 ha dropped, made into a clean coverage (each outline snapped within 2 m to the earlier ones and cut by them: the SL and RLP parcels overlap or leave sub-metre gaps along the state border), then coverage-simplified to `simplify_m` = **10 m**, so neighbours share their border without overlaps or gaps. `Polygon` or `MultiPolygon`; winding not guaranteed. Properties: `{ id: string /* = Place.id */, name_de: string }` only. Target < 150 KB for all places.

**Size.** places.json is written as compact JSON (no indentation): ≈ 20 KB in Phase 0, ≈ 60 KB with the Phase 1 blocks (target **< 80 KB**); places.geojson < 150 KB: small enough for the public release. The release export stages exactly these two files of `stats/`.

**App tolerance.** Missing `stats`, a non-object, `format` ≠ `sle-stats-v1` or a non-string `url` → absent (logged, not fatal). A 404 or a places.json whose `format` ≠ `sle-stats-v1` → panel hidden. Missing `geometry` or a 404 on it → no outlines; fly-to uses `label` and `bbox`. A place without a string `id` or `name_de` is skipped. A discipline whose `measure` does not resolve to a number for any entry shows „keine Daten“. Unknown fields, flags, topics, input ids and disciplines with unknown `scope` are ignored. Phase 1 fields are all optional: a missing, `null` or malformed block hides its row; a `riesen` entry without finite `h`, `E`, `N` is skipped; an unknown species key, age class or land-use group without a `labels_de` entry is shown by its key or skipped; a `goals` entry without `title_de` is skipped.

**UI rules for the Phase 1 values (G7).** Species, age, biodiversity, roof potential and the 1935 forest share are **estimates**: show „Schätzung“/„geschätzt“ and the range or probability (`kwp` as „lo–hi kWp“, Riesen species as „wahrscheinlich Douglasie (80 %)“ per the "Tree species" wording (only „wahrscheinlich“ classes are published for Riesen), age classes with „aus der Baumhöhe geschätzt“; the `beyond` share as „höher als die Ertragstafel (ohne Alter)“ in a neutral colour, never as old). The species mix covers only the forest part (`coverage_pct`); `weak` entries are marked as unsure (e.g. hatched, „?“, with the reason). The roof area next to `kwp` is `usable_m2` (the area the kWp rest on); `suitable_m2` is only shown as the larger area before the factors, labelled so. `forest_continuity` with `snapshot: true` reads „laut Karte 1935–40 Wald“, never „seit“. `biodiversity` reads as „gemeldete Beobachtungen“, never as the quality of nature. Credits come from `inputs` / `attribution` (DLR CC BY 4.0, GBIF).

### 🗺️ Gemeinde level (`level: 'gemeinde'`, S1 Saarland leaderboard)

Plan: [docs/plans/orte-skalieren.md](plans/orte-skalieren.md) §6, §9 S1; decision: [ADR 0051](adr/0051-leaderboard-levels-gemeinden-ortsteile.md). The leaderboard has **two levels in separate files, never mixed in one ranking** (plan D3): **Gemeinden** (all 52 Saarland municipalities plus the RLP neighbours Zweibrücken and Bechhofen) and **Ortsteile innerhalb einer Gemeinde** (today's Gemarkungen in `overall`). Both files are `sle-stats-v1` (`format` and `version: 1` unchanged): everything below is **additive**, so the current panel, which only reads the AOI's own `stats` key, keeps working unchanged (R9).

**Where it is published.** A **stats-only AOI** `saarland` (aois.toml `stats_only = true`, built by `pipeline/gemeinden.py` → `gemeinde_trees.py` → `gemeinden_stats.py`), on the same data root as the tile AOIs:

```
<dataRoot>/saarland/manifest.json            stats-only manifest (below)
<dataRoot>/saarland/stats/places.json        sle-stats-v1, level 'gemeinde'
<dataRoot>/saarland/stats/places.geojson     outlines {id, name_de}, simplify_m 50
```

Why a sibling AOI and not more entries in `overall`'s file: `overall`'s file stays below its 80 KB target and byte-for-byte what old readers know; one file = one level, so a reader cannot rank Gemeinden against Gemarkungen by accident; the later catalog (`sle-catalog-v1`, plan §4.1 `leaderboard`) points at this file unchanged; the release export stages one more directory of three small files.

**Stats-only manifest** (`saarland/manifest.json`; no `origin`, `size`, `levels`, `layers` or chunks):

```ts
{
  version: 1,
  kind: 'stats-only',                     // NEW. The app never opens such a manifest as a terrain AOI (no ?aoi=saarland flight)
  aoi: 'saarland',
  name: 'Saarland – Gemeinden im Vergleich',
  crs: 'EPSG:25832',
  stats: { format: 'sle-stats-v1', url: 'stats/places.json', geometry: 'stats/places.geojson',
           generated: string, places: number, label_de: 'Gemeinden im Vergleich', level: 'gemeinde' },
  stats_levels: StatsLevels,              // same value as in the tile AOIs, see below
  attribution: string                     // '; '-joined, all inputs of places.json
}
```

**`stats_levels`** (new optional top-level key, owned by `gemeinden_stats.py`, written into the stats-only manifest **and** into every tile AOI manifest whose stats are an Ortsteile level, today `overall`; `stats.py` does not touch it):

```ts
StatsLevels = {
  format: 'sle-stats-levels-v1',          // anything else → ignored
  levels: Array<{
    level: 'gemeinde' | 'ortsteil',       // unknown levels are ignored
    aoi: string,                          // AOI dir under the SAME data root whose manifest `stats` key holds this level
                                          // (may be the AOI itself); load <dataRoot>/<aoi>/manifest.json, then its stats.url
    label_de: string                      // 'Gemeinden' | 'Ortsteile'
  }>                                      // order = display order of the level switch (Gemeinden first)
}
```

A manifest `stats` key without `level` and a places.json without `level` mean `'ortsteil'` (all files before S1). A reader that knows no levels simply shows the AOI's own `stats` (today's behaviour).

**`places.json` of the Gemeinde level** = the `Places` shape above plus:

```ts
Places += {
  level: 'gemeinde',                      // NEW top-level (absent = 'ortsteil')
  complete: boolean,                      // NEW: every discipline of this file is ready for every place (a reasoned `discipline_state: 'none'`, e.g. too few GBIF records, counts as done)
  progress?: {                            // NEW: state of the slow inputs (S1b LiDAR run), informative
    lidar: { tiles_done: number, tiles_total: number, pct: number, places_done: number }
  },
  categories_de: { stadt: 'Städte', gemeinde: 'Gemeinden' }   // NEW: labels of the size-class filter on this level
}
Place += {                                // kind: 'gemeinde'; gemarkungen: [] (VG25 outline, no ALKIS parcels)
  ags: string,                            // 8-digit Amtlicher Gemeindeschlüssel, e.g. Homburg '10045114'
  status: '3d' | 'building' | 'stats',    // '3d': a 3D place (repo/AOI) of the whole Gemeinde is published;
                                          // 'building': 3D in preparation or partial (e.g. Homburg: `overall` covers part, S0 builds the rest);
                                          // 'stats': numbers only → the app shows „Ortspate gesucht“
  place_aoi?: string,                     // AOI that shows (part of) it in 3D, e.g. 'overall'; aoi_share_pct = its share
  ortsteile?: { aoi: string, places: string[] },   // its places on the Ortsteile level (place ids in that AOI's stats), e.g.
                                          // Homburg → { aoi: 'overall', places: ['beeden-schwarzenbach', …] }; absent when none
  discipline_state: Record<DisciplineId, 'ready' | 'pending' | 'none'>,
                                          // per discipline of this file: 'ready' = value from complete inputs (may still be
                                          // null by the min-size / few-records rules); 'pending' = input not processed yet
                                          // (value null, card „wird noch berechnet“); 'none' = no source for this place
  forest_pct: number | null,              // dlr-forest-share-v1: share of the outline's 10 m cells with a DLR class or canopy loss
  ortslage_canopy_pct?: number | null,    // S1b, ortslage-bldg-edt-50m-v1: CHM ≥ 3 m share of the Ortslage cells
  ortslage_area_ha?: number | null        // S1b, area of that Ortslage
}
```

Field meanings that differ from the Ortsteile level:

| Field | Gemeinde level |
|---|---|
| `kind` | `'gemeinde'` (UI: „Gemeinde Kirkel“ / „Stadt Homburg“ by `category`) |
| `municipality` | its own id; `municipalities[]` has exactly one entry per place with the same id (so `scope: 'municipality'` boards rank the same set) |
| `category` | `'stadt' \| 'gemeinde'` by **legal status** (VG25 `bez`, method `category-legal-status-v1`; 18 Städte, 36 Gemeinden). Not by inhabitants: every Saarland municipality has > 5,000. The filter reads *Alle / Städte / Gemeinden* (`categories_de`); a reader that knows only `stadt`/`dorf` shows no class for `'gemeinde'` |
| `area_ha` | area of the VG25 outline (no parcel sum); `parcels: null` |
| `inhabitants` | official Zensus 2022 municipality total (`zensus-gemeinde-v1`, Regionaltabelle), not the grid; = `municipalities[].inhabitants` |
| `complete` | `true` unless the outline is not fully covered by an input that *is* ready (then flag `cut-by-aoi` as before). Pending slow inputs do **not** set `complete: false` (that would unrank every board); they show in `discipline_state` |
| `trees`, `crown_ha`, `crown_pct`, `agb_t`, `co2_t`, `trees_per_inhabitant` | S1b streaming run (`gemeinde_trees.py`), `null` while `discipline_state` is `'pending'` |
| `ortslage` | always `null` on this level (no NDVI statewide, see disciplines); `ortslage_canopy_pct` instead |
| `tallest`, `riesen` | absent in S1 (the plausibility checks of `tallest-checked-v4` need OSM masts/turbines and the Ortslage statewide; positions are published only after them) |
| `species` | `species-dlr-cell-mix-v1`: the mix of the 10 m DLR cells inside the outline (cell area, no tree weighting); `trees` = 0, `coverage_pct` = cells with a class ÷ forest cells |
| `biodiversity`, `roof_potential` | as on the Ortsteile level, per Gemeinde outline |
| `nutzung`, `forest_age`, `forest_continuity*`, `goals` | absent in S1 |
| `lidar_epoch`, flags | RLP places: `2022` + flag `other-flight` (the RLP 2022 flight); SL: `2025` |

**Disciplines of the Gemeinde level** (the app renders them generically as before; `ready` is `true` only when the discipline is `'ready'` for **every** place, so no board is ever shown with half the Gemeinden missing):

| `id` | `measure` | `unit` | higher better | `method` | stage |
|---|---|---|---|---|---|
| `waldanteil` | `forest_pct` | `%` | ✓ | `dlr-forest-share-v1` | S1a |
| `sonnenstaerkste-gemeinde` | `pv.kwp_per_inhabitant` (scope `municipality`) | `kWp/Einw.` | ✓ | `mastr-municipality-v1` | S1a |
| `solarpotenzial-genutzt` | `pv.used_pct_mid` (scope `municipality`) | `%` | ✓ | `roof-pv-potential-v2` | S1a (after the statewide LoD2) |
| `artenvielfalt` | `biodiversity.rarefied_500` | `Arten` | ✓ | `gbif-rarefied-v1` | S1a |
| `waldreichste-gemeinde` | `crown_pct` | `%` | ✓ | `crown-disc-v1` | S1b |
| `baeume-pro-einwohner` | `trees_per_inhabitant` | `Bäume/Einw.` | ✓ | `zensus-gemeinde-v1` | S1b; measured crowns only, `note_de` says so |
| `kronenreichste-ortslage` | `ortslage_canopy_pct` | `%` | ✓ | `ortslage-bldg-edt-50m-v1` | S1b |

`Municipality.pv.used_pct_mid` (new, number) = `used_pct[1]`, so a board can rank it. *Grünste Ortslage*, *Wenigsten Beton* (NDVI from the CIR WMS: ≈ 2,600 GetMap requests at 1 m for the state, against R8) and *Riesenbaum* are **not offered on this level** in S1 (ADR 0051); they stay on the Ortsteile level. The medal table of the Gemeinde level counts only its place-scope disciplines (as ADR 0050).

New method ids (in `method`):

| Topic | `id` | Meaning |
|---|---|---|
| `outline` | `vg25-gemeinde-v1` | BKG VG25 `vg25_gem` (Stand 31.12., ATKIS accuracy), parts with the same AGS dissolved; Moselle condominium (ibz 69) dropped; published simplified 50 m. Checks: 52 SL features, Σ ≈ 2,570 km² (± 1 %), unique AGS, no overlaps, Homburg 82.6 km² |
| `inhabitants` | `zensus-gemeinde-v1` | Zensus 2022 Regionaltabelle total of the AGS |
| `category` | `category-legal-status-v1` | `stadt` when the VG25 `bez` contains „Stadt“, else `gemeinde` |
| `forest` | `dlr-forest-share-v1` | DLR Tree Species 2022 on the EPSG:25832 10 m grid (`dlr-nearest-25832-v1`), cell centre inside the outline: class 0–9 or canopy loss = forest |
| `species` | `species-dlr-cell-mix-v1` | share of each DLR class among the outline's cells with a class; `weak` as in `species-dlr-crown-mix-v1` |
| `trees` | `chm-lmf-watershed-dlrtype-v2` | trees.py detection (`sle-trees-v1` Params, tops ≤ 60 m) per 1 km tile with a 64 m apron, streamed; tree type from the **DLR class** under the crown instead of the DOP colour (conifer ⇒ conifer fill as ADR 0030); building mask from LoD2; a tree belongs to the Gemeinde whose outline contains its top cell centre. **`trees` counts measured tops only** (fill trees are excluded from the count but kept in crown area and biomass, since they partition measured canopy segments); v1 counted the fill, which doubled counts in conifer tiles. The method carries a `note_de` |
| `ortslage` | `ortslage-bldg-edt-50m-v1` | cells within 50 m (Euclidean distance on the 1 m grid) of a LoD2 building cell, inside the outline; no hole filling (v1 Ortsteile rule closes holes < 1 ha) |

**Outlines** (`saarland/stats/places.geojson`): as "places.geojson" above (`{id, name_de}` only, EPSG:25832, 1 m integers, coverage-simplified, holes < 1 ha dropped) with `simplify_m` **50** (54 outlines over 2,650 km², ≈ 170 KB, target **< 200 KB**; 25 m gave 260 KB). **Size** of places.json target **< 160 KB** (≈ 25 KB gzip on Pages).

**Inputs** (new ids): `vg25` (`© BKG (2026) CC BY 4.0 (Daten verändert), Datenquellen: https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg25.pdf (VG25)`, licence `CC-BY-4.0`), plus the known `zensus_gemeinden`, `mastr`, `species_dlr`, `gbif`, `lod2_sl`, `lod2_rlp`, `lidar_sl`, `lidar_rlp` (the LiDAR ones only once at least one Gemeinde has S1b values).

**Privacy** (ADR 0049) unchanged: aggregates per Gemeinde only; the S1b run keeps per-tile sums and at most the 10 highest tops per Gemeinde and tile in `data/work/gemeinden/` (never published); `check_privacy` runs on the file.

**App tolerance (additions).** A missing / invalid `stats_levels`, an unreachable level AOI or a places.json without `level` → only the AOI's own stats (no level switch). `kind: 'stats-only'` manifests are never used as a terrain AOI. Unknown `status` → treated as `'stats'`; unknown `discipline_state` values → `'pending'`. A Gemeinde-level place has no `riesen` / `tallest` / `goals`: hide those rows. Fly-to: `label` / `bbox` as before, decided by geometry against the **current** AOI (not by `status`, and not by `aoi_share_pct`, which refers to `place_aoi`): a Gemeinde partly inside the current 3D area is flown to that part with a „Nur x % …“ note; one fully outside gets no 3D flight, its card says so and the minimap fits its outline.

## Other files

- `app/public/data/pois.geojson`: WGS84 FeatureCollection of known sites. Properties: `id`, `name` (DE), `type` (`castle|palace|garden|bunker|burial_mound|cave|boundary_stone|mine|other`), `confidence` (`high|med|low`), `source` (URL), `note`.
- User find markers are stored in the browser (localStorage key `sle.markers.v1`), exported as WGS84 GeoJSON with properties `id, title, note, category, created, E, N, h`.
- Candidate review decisions (F15) are stored in the browser (localStorage key `sle.candidates.v1.<aoi>`), see "Candidates"; never in data files.
- *Orte im Vergleich* collecting progress is stored in the browser (localStorage key `sle.orteCollect.v1`): `{ version: 1, riesen: { [treeId: string]: 'YYYY-MM-DD' }, places: { [placeId: string]: 'YYYY-MM-DD' } }`, ids and the date of the first discovery only (no position, no track); never sent anywhere ([ADR 0022](adr/0022-local-first-no-accounts.md)). Rules in `app/src/places/collect.ts`: a Riese counts within 150 m (3D) or when its *Baum-Steckbrief* opens; a place counts when the camera is over its outline below 1,500 m above ground, but not during a fly-to and not at the start or after a fly-to or reset until the camera moved 100 m from where it was (the start pose and the framed arrival pose are not a visit).
- `app/public/data/shared/<id>/`: AOI-independent shared datasets (F19 reconstruction models), see "Shared datasets". Not part of any manifest.

## Public release (static hosting, 2026-11-02)

The public GitHub Pages release (`scripts/release/`, see `scripts/release/RELEASING.md`) serves the app and its data from separate static hosts. Contract additions, all backward compatible:

- **Data roots are build-time config** (`app/src/data/urls.ts`): `VITE_DATA_URL` = root holding `<aoi>/manifest.json`, `pois.geojson` and `shared/`. Roots are resolved to absolute URLs on the main thread, so the decode/vector workers only ever see absolute URLs.
- **`xyz.<key>.url` may be an absolute `https://…` URL template** (the app uses it as is; relative templates are still appended to the AOI base URL unchanged — the `{z}/{x}/{y}` braces must not be percent-encoded). The release export uses this to put the Leaflet tiles into a second data repository and trims `maxZoom` (the minimap keeps `maxZoom: 20` with `maxNativeZoom` = the manifest's `maxZoom`, i.e. overzoom); it recomputes `tileCount`/`bytes`.
- `VITE_AOIS` (comma list) tells the app which AOIs a deployment ships: no manifest probes for others, `?aoi=` outside the list falls back to the preferred AOI.
- **Zone packages** are published under `<dataRoot>zones/` like locally (`docs/zone-contract.md`): `zones/index.json` lists only the packages actually staged (zones cleared in `PUBLIC_ZONE_POLICY` of `export_data.py` and named in `RELEASE_ZONES`; today `baeckerei-heusser`), each with `zone.json` and the files its manifest references under the cleared prefixes (`built/`). `reference` assets are dropped from the public `zone.json` (with `twin.referenceScale`; `budget.totalBytes` recounted) and `scene/` is never published (ADR 0043). The app tolerates a listed zone whose `zone.json` is missing (it is skipped with a warning), but the export never lists one.
- **UXO candidate classes are never exported (F22).** `export_data.py` removes `crater`/`crater_field` features from `candidates/candidates.geojson`, their `counts`/`classes` entries, `params.crater_threshold`, crater entries of `method_versions`/`detectors`, recomputes `featureCount`, and rewrites every mask PNG with codes 6/7 set to 0 (re-encoded 8-bit grey PNG); it aborts when a mask is not 8-bit greyscale. Mask chunks left empty are dropped together with their `mask.chunks` entry; only the manifest's GeoJSON and mask chunks under `candidates/` are staged, saar-lidar-detect side files in the AOI dir (`run.json`, `report*.html`, `eval*`, `fachbericht*`, `manifest.json.bak-*`, `*.sld-new/`) never are, and the export aborts when a staged AOI text file still names a UXO class. The explorer ignores them in every build, and the build fails if a crater/print string reaches the bundle (`app/scripts/bundleGuard.ts`).
