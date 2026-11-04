# Data Contract v2 — pipeline → app

The pipeline (`pipeline/`) writes static files to **`app/public/data/<aoi>/`** (git-ignored). The app (`app/`) loads them via `fetch('data/<aoi>/manifest.json')`. Both sides must follow this file; change it only together with a `CHANGELOG.md` line (and an ADR if the change is a decision, e.g. a new layer kind).

**Zones** (detailed places behind portals: castle, bakery, …) have their own binding contract: [zone-contract.md](zone-contract.md) (`sle-zone-v1`, [ADR 0029](adr/0029-zones-same-bundle-folder-layout.md)). Frames, proj4 and attribution rules below apply to zones unchanged.

**Versions.** `version: 1` = single 1 m level (the MVP format). `version: 2` (F9) = v1 **plus** `levels` (overview pyramid, see "Levels") — a v2 manifest is a strict superset, all v1 keys keep their meaning and paths. Optional baked vector heights (`vectors.<key>.heights`, see "Vectors") are allowed in both, as are the additive F11/F13/F14 keys (`rgb` image layers, the `bldg` mask layer, `models.buildings`, `xyz.hist_*`, F15 `candidates`, F16 `pointclouds`, V2.4 `trees`; see "Image layers", "Building mask", "Models", "Candidates", "Point clouds", "Trees"). The app loads v1 and v2: a v1 manifest is treated as one level (level 0); unknown versions are rejected. The pipeline writes `version: 2` exactly when it writes `levels`. **Revision 2.1 (V2.4, 2026-11-04):** adds the optional `trees` key — additive, the manifest `version` stays 1/2 and older manifests stay valid.

## Coordinate frames

- Source CRS: **EPSG:25832** (ETRS89 / UTM 32N), heights DHHN2016 (m).
- AOI origin `E0, N0` = lower-left corner of the AOI (integer metres, e.g. Karlsberg `381000, 5465000`).
- **three.js world frame** (y-up, metres): `x = E − E0`, `y = height`, `z = −(N − N0)`. So +x = east, −z = north. Never put raw UTM values into float32 buffers.
- WGS84 ⇄ EPSG:25832 via proj4, definition `+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`.

## Grid & chunks

- Cell size **1 m**. Source DGM1 is PixelIsArea: pixel `(col,row)` of a 1 km tile with lower-left `(E,N)` has its **centre** at `E + col + 0.5`, `N + 1000 − row − 0.5`.
- AOI raster: `width × height` cells (e.g. 3000 × 3000), sample `(c, r)` at centre `E0 + c + 0.5`, `N0 + height − r − 0.5` (row 0 = north edge, as in GeoTIFF).
- Chunks: `chunkSize = 500` cells. Chunk `(i, j)`: `i` = column index going **east**, `j` = row index going **south**, from the north-west corner. Chunk `(i,j)` owns cells `c ∈ [i·500, i·500+500)`, `r ∈ [j·500, j·500+500)`.
- **Height images carry a 1-cell apron on every side**: 502 × 502 pixels, pixel `(px,py)` ↔ AOI cell `(i·500 − 1 + px, j·500 − 1 + py)`. Cells outside the AOI raster are edge-clamped. The mesh is built over the 500 × 500 owned cells (plus a shared edge to the neighbour via the apron so there are no gaps); the apron also allows seamless per-pixel normals.
- **Relief layer images have no apron**: 500 × 500 pixels, pixel `(px,py)` ↔ cell `(i·500 + px, j·500 + py)`.

## Encodings

- **`terrarium`** (heights): PNG RGB8, `h = (R·256 + G + B/256) − 32768` metres (≈ 4 mm precision). NoData is filled (interpolated/nearest) before encoding; a separate optional `mask` layer marks filled cells.
- **`u8`** (relief layers): single-channel grayscale PNG (or WebP lossless), `value = min + (v / 255) · (max − min)` with `min`/`max` from the manifest. Layers that are already display images (e.g. `vat`) use `min: 0, max: 1`.
- **`rgb`** (colour images: orthophoto, historic maps; F13/F14): RGB8 WebP or JPEG (`format`), one image per chunk covering exactly the chunk's 500 × 500 cells at `pixelsPerChunk` px per side, see "Image layers". **Decoded with normal sRGB handling** (`colorSpace = SRGBColorSpace`, default `createImageBitmap` colour conversion) — unlike `terrarium`/`u8`, these are pictures, not data.
- Decode heights in a worker / with `createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })`. Never let the browser colour-manage them.

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
- Historic maps: `© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet (Historische Karten)` (licensor wording `© GeoBasis DE/LVGL-SL (Jahr)`, WMS id 2597 metadata, see `research/04-cadastre-historic-maps.md` §5)

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
| `bldg` mask (level 0, with canopy) | 500² × R8 | 250 000 ≈ 0.24 MiB |
| building mesh (per chunk with buildings) | vertex buffers, ≈ 25 B/vertex | typically 0.1–2 MB |
| per-chunk low-pass for live local relief (only while it is shown) | ≈ 502² × R32F | ≈ 0.96 MiB |
| geometry | shared per LOD spacing, not per chunk | ≈ 0 |

Typical chunk (DTM + 2 resident layers) ≈ **1.5 MB**, with canopy ≈ 2.5 MB, worst case (all 9 level-0 layers + DSM + low-pass) ≈ 5.3 MB. No mipmaps (data textures use Nearest/Linear without mips). The JS heap keeps a ~1 MB Float32 copy of each height texture (HeightQuery, skirts). Overall AOI, everything resident: level 0 ≈ 290 MB (≈ 480 MB with canopy), levels 1–4 (65 chunks) ≈ 100 MB — far below the 1.5 GB acceptance bound. The app still enforces an explicit budget so larger AOIs stay bounded: 600 MiB soft (hard cap 1400 MiB), LRU eviction, coarsest level pinned (`app/src/terrain/budget.ts`); measured peak on an overall flight 382.6 MB.

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
- **Type** (heuristic): mean `(R+G+B)/3` of the summer DOP20 (1 m) over the crown segment: `< 62` → conifer, `> 74` → broadleaf, else or without DOP → unknown. ⚠️ Weak: shaded broadleaf crowns read as conifer, sunlit conifers as unknown; larch (deciduous conifer) is "broadleaf"-bright. Good enough for the tree model, not a species map.
- **Fill trees** (`type & 0x80`): the leaf-off 1 m DOM merges conifer tops ≈ 5 m apart into one blob; oversized conifer crowns are split into crowns of the expected size ([ADR 0030](adr/0030-conifer-fill-trees.md)). Their position is an **estimate** (cluster centre), height and radius come from the CHM. Never use them as evidence for a single tree.
- Heights outside `3 … 45 m` are dropped (pylons, chimneys, cranes). Building cells (LoD2 `bldg` mask, dilated 1 m) are excluded.

**Size.** ≈ 10 B per tree; Karlsberg (9 km²) ≈ 89 k trees ≈ 0.9 MB, overall (48 km²) ≈ 326 k trees ≈ 3.1 MB.

**Manifest + attribution.** The trees step owns the whole `trees` key (replaced on each run via `update_manifest`, all other keys kept) and adds `© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (DOP20)` when the DOP was used for the type (the DGM/DOM attribution is already present from `build`).

**App tolerance.** Missing `trees`, a non-object or `format` ≠ `sle-trees-v1` → absent (logged, not fatal). `path` must contain `{i}` and `{j}`. `chunks` entries that are not three integers with `0 ≤ i < nx`, `0 ≤ j < ny`, `count ≥ 1` are skipped. A chunk whose bytes fail the header check (magic, version 1, size `16 + 10·count`) or 404s is skipped; the other chunks still show. Unknown `type` base codes read as unknown; unknown manifest fields are ignored.

## Other files

- `app/public/data/pois.geojson`: WGS84 FeatureCollection of known sites. Properties: `id`, `name` (DE), `type` (`castle|palace|garden|bunker|burial_mound|cave|boundary_stone|mine|other`), `confidence` (`high|med|low`), `source` (URL), `note`.
- User find markers are stored in the browser (localStorage key `sle.markers.v1`), exported as WGS84 GeoJSON with properties `id, title, note, category, created, E, N, h`.
- Candidate review decisions (F15) are stored in the browser (localStorage key `sle.candidates.v1.<aoi>`), see "Candidates"; never in data files.
- `app/public/data/shared/<id>/`: AOI-independent shared datasets (F19 reconstruction models), see "Shared datasets". Not part of any manifest.

## Public release (static hosting, 2026-11-02)

The public GitHub Pages release (`scripts/release/`, see `scripts/release/RELEASING.md`) serves the app and its data from separate static hosts. Contract additions, all backward compatible:

- **Data roots are build-time config** (`app/src/data/urls.ts`): `VITE_DATA_URL` = root holding `<aoi>/manifest.json`, `pois.geojson` and `shared/`. Roots are resolved to absolute URLs on the main thread, so the decode/vector workers only ever see absolute URLs.
- **`xyz.<key>.url` may be an absolute `https://…` URL template** (the app uses it as is; relative templates are still appended to the AOI base URL unchanged — the `{z}/{x}/{y}` braces must not be percent-encoded). The release export uses this to put the Leaflet tiles into a second data repository and trims `maxZoom` (the minimap keeps `maxZoom: 20` with `maxNativeZoom` = the manifest's `maxZoom`, i.e. overzoom); it recomputes `tileCount`/`bytes`.
- `VITE_AOIS` (comma list) tells the app which AOIs a deployment ships: no manifest probes for others, `?aoi=` outside the list falls back to the preferred AOI.
- **UXO candidate classes are never exported (F22).** `export_data.py` removes `crater`/`crater_field` features from `candidates/candidates.geojson`, their `counts`/`classes` entries, `params.crater_threshold`, crater entries of `method_versions`/`detectors`, recomputes `featureCount`, and rewrites every mask PNG with codes 6/7 set to 0 (re-encoded 8-bit grey PNG); it aborts when a mask is not 8-bit greyscale. Mask chunks left empty are dropped together with their `mask.chunks` entry; only the manifest's GeoJSON and mask chunks under `candidates/` are staged, saar-lidar-detect side files in the AOI dir (`run.json`, `report*.html`, `eval*`, `fachbericht*`, `manifest.json.bak-*`, `*.sld-new/`) never are, and the export aborts when a staged AOI text file still names a UXO class. The explorer ignores them in every build, and the build fails if a crater/print string reaches the bundle (`app/scripts/bundleGuard.ts`).
