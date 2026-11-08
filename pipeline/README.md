# Pipeline: LiDAR tiles → app data

Plain Python via **uv** (no Docker or PDAL in the MVP). It downloads the LVGL Saarland **DGM1/DOM1 2025** GeoTIFF tiles, fills gaps with **RLP** tiles and computes archaeological relief layers. It then writes the static files defined in [`../docs/data-contract.md`](../docs/data-contract.md) to `app/public/data/<aoi>/`.

The app reads that directory in place with `pnpm dev`, `pnpm preview` and `pnpm run serve:local`; it is never copied into `app/dist/` (see [Local packaging](../README.md#local-packaging-one-data-directory-no-copies)).

## Setup

```bash
cd pipeline
uv sync            # Python 3.12 (.python-version); all deps pinned in pyproject.toml + uv.lock
```

There are two dependency workarounds, both in `pyproject.toml`:
- `rvt-py` declares `gdal` (osgeo bindings, needs a system GDAL build) plus `jupyter`, `pandas` and `geopandas`. We only use `rvt.vis` and `rvt.blend_func`, so those dependencies are removed with `[tool.uv] override-dependencies`. Raster I/O uses `rasterio`, whose wheels bundle GDAL.
- `rvt.blend_func` imports `matplotlib.cm.get_cmap`, which was removed in matplotlib 3.9. `build.py` adds a one-line shim before the import.
- uv's standalone Python has no system CA store, so `geobasis-rlp.de` fails TLS. HTTP uses an explicit `certifi` context.

## Run

```bash
./run.sh karlsberg                 # fetch → build → xyz → osm → cadastre → buildings → ortho → historic → pois → detect → pointcloud → trees → tests
                                   # (pointcloud downloads ≈ 45 MB LAZ per km² tile: Karlsberg 4 tiles ≈ 180 MB, overall 8 ≈ 350 MB)
./run.sh karlsberg build xyz       # selected steps only
uv run python fetch.py homburg     # single steps; AOIs are defined in aois.toml
uv run pytest -q                   # contract tests for every built AOI
```

| Step | What it does | Karlsberg time (M-series Mac) |
|---|---|---|
| `fetch.py <aoi>` | Resolves the share token from the `…/cloud/freiegeobasisdaten` 302 (it can change). Then range-extracts `dgm1_/dom1_32_{E}_{N}_1_SL_2025.tif` from the SPK county ZIPs over WebDAV (HTTP Range: about 1 request per 2 MB tile, plus 3 for the central directory). Fetches AOI + buffer ring (25 tiles), then the RLP `dgm1`/`dom1` tiles from the `geobasis-rlp.de/data/*/current/tif/` listing. Sequential, with retries, skips cached files, remembers tiles that are not in the ZIP (`--refresh` re-checks them). | first run ≈ 3.5 min (≈ 250 MB), cached ≈ 8 s |
| `build.py <aoi>` | Mosaic (native 1 m grid, no resampling) → RLP fill + bias check → nearest fill → relief on AOI + 200 m buffer → crop → Terrarium/u8 PNG chunks + `manifest.json` + previews; F9: overview levels 1–4 (`levels.py`: 2/4/8/16 m block mean with edge-clamp padding, NW-anchored, `levels/{k}/{dtm,vat,hillshade}/{i}_{j}.png`) → manifest `version: 2` + `levels` (`--levels 0` writes a v1 manifest) | ≈ 22 s (levels ≈ 1.4 s) |
| `xyz.py <aoi>` | EPSG:3857 XYZ overlays `vat` (grayscale) and `slrm` (RdBu_r) for z12–18. Palette PNGs, index 0 transparent. | ≈ 9 s |
| `osm.py <aoi> [--refresh]` | F10: one Overpass query (`overpass-api.de`) for AOI + buffer: `highway` (no proposed/construction/areas), `railway`, `waterway`, `barrier=wall/retaining_wall/city_wall/ditch` (no fences/hedges). Cached as `data/raw/osm/<aoi>.json` + `.meta.json` (reused while the query is unchanged; `--refresh` downloads again). Projected to EPSG:25832, clipped to the AOI, densified to ≤ 2 m, rounded to 0.01 m, z baked (`heights.py`, see below) → `vectors/osm.geojson`, manifest `vectors.osm` + ODbL attribution. Karlsberg: 590 ways, 52 k vertices, 1.2 MB. | first run one request (≈ 0.5 MB), cached < 1 s |
| `cadastre.py <aoi>` | F12: ALKIS Flurstücke from **WFS SL ALKIS Vereinfacht** (`geoportal.saarland.de/registry/wfs/414`, types `Flurstueck` + `FlurstueckPunkt`) and, for the RLP part, **WFS RP ALKIS Vereinfacht** (`geoportal.rlp.de/registry/wfs/519`, GML 3.2 only, no label points → representative point inside the parcel). BBOX and SRSNAME as `urn:ogc:def:crs:EPSG::25832`, paged (≤ 10 000/request), every page validated before caching under `data/raw/cadastre/<aoi>/`. A complete cache is reused without requests; there is no `--refresh`, delete the cache subfolder to re-download. Boundaries deduplicated → `vectors/flurstuecke.geojson`, one label point per parcel → `vectors/flurstuecke_labels.geojson` (both with baked z), whole parcel polygons (2D, original vertices, not clipped, deduped by `FLSTKENNZ`, `flaeche_m2` from the ALKIS `FLAECHE`) → `vectors/flurstuecke_polygons.geojson` for the app's offline point-in-polygon lookup (`vectors.flurstuecke.polygons`), manifest `vectors.flurstuecke` + ALKIS attributions. RLP parcels have no Flur (the app hides `Flur 0`). Karlsberg: 2607 SL + 544 RLP parcels, 8672 lines (4.9 MB), 3132 labels (0.7 MB), 3151 polygons (1.6 MB, 3143 with `flaeche_m2`; every label point lies in the polygon of its own parcel); overall 23 725 polygons (12.0 MB). | cold service: first request can take ≈ 70 s; cached ≈ 0.5 s |
| `buildings.py <aoi> [--refresh]` | F11 + R0.7: LoD2 CityGML. SL `LoD2_32_{E}_{N}_1_SL.gml` range-extracted from the county ZIP `OD_Gebäudemodelle_LoD2_gml_LK/<county>_LOD2BWK_gml.zip` (all tiles touching AOI + buffer); RLP `geobasis-rlp.de/data/geb3dlo/current/gml/LoD2_32_{E}_{N}_2_RP.gml` (2 km tiles touching the AOI). Cached gzip-compressed under `data/raw/lod2/{sl,rlp}/`, parsed with a hardened lxml parser (no entities, no network). Wall/roof/closure surfaces triangulated in the local frame → `models/buildings/{i}_{j}.glb` (one per level-0 chunk, each building whole in the chunk of its footprint centroid). Walls on a GroundSurface are extended down to min(DTM along the wall) − 0.3 m (≤ 5 m) so the flat LoD2 floor shows no gap on slopes. GroundSurface footprints → `relief/bldg/{i}_{j}.png` (u8 0/255, cell centres, dilated 3 × 3). Needs `data/work/<aoi>/dtm.tif` (run `build` first). Report `data/work/<aoi>/buildings.json`. Karlsberg: 2391 buildings, 19 chunks, 56 k triangles, 3.4 MB glb; overall: 20 038 buildings, 145 chunks, 515 k triangles, 31 MB. | cached: Karlsberg ≈ 3 s, overall ≈ 25 s |
| `ortho.py <aoi> [--workers 3]` | F13: TrueDOP20 WMS SL `sl_dop20_rgb` (`geoportal.saarland.de/freewms/truedop`), GetMap 1.3.0 EPSG:25832, one request per level-0 chunk with BBOX exactly on the chunk edges, 1000 px (0.5 m/px), transparent PNG. Chunks with SL gaps are filled from WMS RP `rp_dop20` (`image/png; mode=24bit`). Cached in `data/raw/ortho/<aoi>/{sl,rlp}/` (identical bboxes of another AOI are hard-linked). → `ortho/{i}_{j}.webp` (1000², q85) + `ortho/levels/{k}/{i}_{j}.webp` (500², area mean); work `ortho_1m.tif`, `ortho.json`. Written into `.ortho.staging/ortho/` and swapped in (`common.swap_dir`) only after every chunk and level succeeded, so a WMS error mid-run keeps the previous `ortho/` that the manifest points at. Karlsberg 13 MB, overall 61 MB; no RLP fill or nodata needed in either AOI. | cached: Karlsberg ≈ 2 s, overall ≈ 12 s |
| `historic.py <aoi> [--layers …] [--workers 3] [--maxzoom 17]` | F14: WMS SL Historische Karten (Geoportal id 2597) through the owsproxy (session cookie). Layer `1` → `hist_1840` (Bayerische Originalpositionsblätter 1:25 000, 1836–41), layer `5` (TK25 1935–40) → `hist_1935`. 1 m/px GetMap blocks of ≤ 4 × 4 chunks on chunk edges, cached in `data/raw/historic/<aoi>/` → `hist_<year>/{i}_{j}.jpg` (500², no-map pixels white) + `hist_<year>/levels/{k}/…` and Leaflet tiles `xyz/hist_<year>/{z}/{x}/{y}.png`. Karlsberg ≈ 20 MB per layer (incl. xyz), overall ≈ 105 MB per layer. | cached: Karlsberg ≈ 22 s, overall ≈ 105 s (mostly xyz) |
| `pois.py` | Converts the research/03 Part B table + research/01 §5 focus points into `app/public/data/pois.geojson` (dedupe < 80 m) | < 1 s |
| `detect.py <aoi> [--min-score 0.3] [--mask-min-score 0.4] [--no-mask]` | F15: rule-based relict candidates (pit, mound, linear, rect, platform) from the work DTM + CHM/bldg/mask + `vectors/osm.geojson` → `candidates/candidates.geojson` (+ `candidates/mask/{i}_{j}.png`), manifest `candidates`, report `data/work/<aoi>/detect.json`. **Private/local data** (see "Relict detection" below). Needs `build` (and ideally `buildings`, `osm`, `pois`) first. | Karlsberg ≈ 5 s, overall ≈ 24 s |
| `pointcloud.py <aoi> [--no-fetch]` | F16: classified ALS 2025 points for the focus areas in `[[defaults.pointclouds]]` → `pointclouds/<area>/{tx}_{ty}.bin` (`sle-pts-v1`), manifest `pointclouds`, report `data/work/<aoi>/pointcloud.json`. See "Point clouds" below. | first run downloads the LAZ (see below); cached: Karlsberg ≈ 2 s, overall ≈ 4 s |
| `zones.py <zone dir…>` | V2.6: strict validator for zone packages ([zone contract](../docs/zone-contract.md), `sle-zone-v1`): manifest rules, files exist, declared `bytes` = file size, only allowed glTF extensions (meshopt/quantization/KTX2/unlit/…, no Draco), budgets, folder name = `id`. Producers (castle export, `tools/capture/`) run it before publishing a package; exit 1 on problems. Tests share the fixture with the app (`app/tests/fixtures/zones/`). | < 1 s |
| `trees.py <aoi> [--workers 4]` | V2.4: one record per tree crown from the CHM (DOM1 − DGM1): local maxima with a height-adaptive window, marker watershed for crowns, LoD2 building mask, type from the DOP colour, conifer fill (ADR 0030) → `trees/{i}_{j}.bin` (`sle-trees-v1`), manifest `trees`, report `data/work/<aoi>/trees.json`. Needs `build`; `buildings` and `ortho` optional (read from a covering AOI if the AOI has none). See "Trees" below. | Karlsberg ≈ 5 s, overall ≈ 10–30 s |
| `pytest` | Terrarium round trip ≤ 5 mm, apron = neighbour edge, edge clamp, u8 decode, manifest keys, chunk counts/sizes, georeference, POI schema, manifest merge (unknown keys, attribution, shared sections), OSM classify/clip/densify, cadastre paging/labels, generated `vectors/*` vs contract (AOIs from `aois.toml` only), overview levels (block means, NW anchor, edge clamp, v2 manifest), baked heights vs `rasterio` `sample()`, buildings (non-convex polygons with holes, tilted planes, local frame, mask vs point-in-polygon at cell centres, glb round trip, CityGML parsing, wall skirts, generated data), ortho/historic (chunk bboxes, RLP fill, alignment < 1 m, levels), rebuild keeps foreign layer keys, detection (synthetic pit/mound/ditch/rectangle/kiln platform found with the right class + metrics, flat noise and smooth undulation yield nothing, rim/ring ditch/uprooted-tree rules, building/road exclusion, output + mask contract, generated candidates), point clouds (`sle-pts-v1` header layout, round trip ≤ 1 cm, permutation, half-open tile clipping, limits, area config, previous-entry fallback, staged tile write that keeps the old output when there are no points, generated data), parcel polygons (whole/2D/deduped/area, label point ↔ polygon), coarse detection pass (scarped platform + moat, straight terrace edge, no coarse candidates on rounded hills, fine ids unchanged, exact chance baseline), trees (`sle-trees-v1` layout + round trip, fmix32 order, peak → exact cell-centre E/N with no flip, chunk south edge, plateau tie-break, min/max height + building filter, byte-identical reruns for 1 vs 4 workers, conifer fill, generated data) | 279 tests (2026-11-04, V2.4a: + 16 trees) |

## Manifest ownership (read–modify–write)

Steps never regenerate `manifest.json` from scratch. Each one patches only the top-level keys it owns through `common.update_manifest`. Every other key is kept, so steps can run independently and in any order.

```python
from common import APP_DATA, update_manifest
update_manifest(APP_DATA / aoi.key, {"vectors": {"osm": entry}}, merge=["vectors"],
                attribution=["© OpenStreetMap-Mitwirkende, ODbL"])
```

- Keys in the patch replace the old value in place, so key order is kept. New keys are appended. Unknown keys (`vectors`, `models`, `candidates`, `trees`, …) are left alone. `remove=[…]` deletes keys the step owns but no longer produces.
- `attribution` stays the contract's `"; "`-joined string. Pass entries as `attribution=[…]`; passing an `"attribution"` key in the patch raises an error. Entries are deduplicated and keep their order: existing entries stay where they are and new ones are appended. `drop_attribution=[…]` takes back entries the step owns but no longer uses. An entry listed in both is kept. Entries must not contain `;`.
- Shared sections such as `vectors` hold entries from several steps (osm, cadastre, …). Name them in `merge=[…]` so your sub-key is shallow-merged into the existing dict instead of replacing the whole section.
- Ownership: `build.py` owns `version` … `layers`, `levels`, `sources` and `build` (`version` and `levels` are written together), plus the SL/RLP attribution entries. It removes `xyz` only when `xyz/` is gone. `xyz.py` owns `xyz` (except `xyz.hist_*`, written by `historic.py`). The file is written atomically (temp file + `os.replace`).
- `layers` and `levels[k].layers` are shared per sub-key: `buildings.py` adds `bldg`, `ortho.py` adds `ortho`, `historic.py` adds `hist_*` (and `models.buildings` / `xyz.hist_*`). `build.py` passes `own_layers=LAYER_META` to `update_manifest`, so a rebuild replaces only its relief layers and carries every foreign entry over (`common.carry_foreign_layers`; a level keeps them only when its `cellSize` is unchanged). On disk, `build.py` deletes only what it writes (`dtm/`, `dsm/`, `relief/<k>` for `LAYER_META`, via `clear_build_outputs`), so `relief/bldg/` from `buildings.py` survives a rebuild (before v1.0.1 `build` wiped all of `relief/` and the kept `layers.bldg` pointed at deleted files until `buildings` ran again). Order does not matter for the manifest, but `buildings`, `osm`, `cadastre` and `heights` read `data/work/<aoi>/dtm.tif`, so `build` must have run once before them. `tests/test_manifest_merge.py` covers the rebuild case for the manifest, `tests/test_audit_fixes.py` for the files.

## Files

```
pipeline/aois.toml               AOIs (bbox EPSG:25832, buffer_m ≥ 100, county)
data/raw/lvgl-sl/                LVGL tiles (git-ignored, untrusted: only ever opened as rasters)
data/raw/rlp/                    RLP tiles
data/raw/osm/<aoi>.json          Overpass response (+ .meta.json with query, endpoint, date)
data/raw/cadastre/<aoi>/         paged WFS responses (SL 414, rlp_* = RLP 519) + hits.json
data/work/<aoi>/*.tif            float32 AOI rasters (dtm, dsm, chm, mask, all relief layers) – open in QGIS
data/work/<aoi>/build.json       parameters, percentiles, RLP offset, fill stats, timings
data/work/<aoi>/vat_buffered.jpg buffered VAT for checking seams in the buffer ring
app/public/data/<aoi>/           dtm/ dsm/ relief/<layer>/ (incl. bldg/) levels/ xyz/<layer>/ (incl. hist_*) vectors/
                                 models/buildings/ ortho/ (+ levels/{k}/) hist_<year>/ (+ levels/{k}/) trees/ manifest.json
app/public/data/pois.geojson
data/raw/lod2/{sl,rlp}/          LoD2 CityGML tiles, gzip (≈ 52 MB for overall)
data/raw/ortho/<aoi>/{sl,rlp}/   DOP20 WMS responses per chunk (≈ 500 MB for karlsberg + overall)
data/raw/historic/<aoi>/         historic-map WMS blocks + meta.json (≈ 105 MB)
data/work/<aoi>/{buildings,ortho,historic,trees}.json  step reports (counts, sizes, ground vs DTM, timings)
data/work/<aoi>/{bldg,ortho_1m,hist_*}.tif        work rasters (mask, 1 m RGB mosaics)
docs/previews/<aoi>_{vat,slrm,chm}.jpg + {bldg,ortho,hist_1840,hist_1935}.jpg
```

Karlsberg sizes: raw 176 MB (SL) + 74 MB (RLP) + 0.5 MB (Overpass). App data: dtm 9.5 MB, dsm 14 MB, relief 51 MB (9 layers × 36 chunks), xyz 115 MB (2 × 1309 tiles; about 75 % of that is z18), vectors 7.1 MB (osm 1.28 MB, flurstuecke 5.10 MB, labels 0.71 MB), models 3.3 MB, bldg 0.17 MB, ortho 13 MB, hist_1840/hist_1935 5.1 MB each + xyz 15 MB each; total 264 MB. Work rasters: 227 MB (before F11/F13/F14).

Overall sizes (v0.12): 1.4 GB app data incl. point clouds 115 MB (Karlsberg: 305 MB incl. 38 MB point clouds). v0.10 (1.3 GB) incl. ortho 61 MB, hist_1840 24 MB, hist_1935 26 MB, models 30 MB, bldg 1.0 MB, xyz/hist_1840 80 MB, xyz/hist_1935 81 MB.

## Layers (manifest `layers`, all `u8`, 500×500 per chunk)

| key | computation | Karlsberg range (from percentiles) |
|---|---|---|
| hillshade | multi-directional, oblique-weighted (MDOW; az 225/270/315/360, elevation 35°), **stretched p0.5–p99.5 to 0–1** (display image) | 0 … 1 |
| slope | `rvt.vis.slope_aspect`, degrees | 0 … ceil5(p99.5) = 40 |
| slrm | `rvt.vis.slrm`, radius 20 m | ±ceil0.1(max abs p0.5/p99.5) = ±2.1 m |
| svf | `rvt.vis.sky_view_factor`, 16 dirs, r = 10 m | floor(p0.5) … 1 = 0.71 … 1 |
| opns_pos / opns_neg | same pass, negative = openness of −DEM | 74 … 92° / 75 … 92° |
| vat | RVT presets "VAT general" (SVF 0.7–1 multiply 25 %, openness+ 68–93 overlay 50 %, slope 0–50 luminosity 50 %, hillshade 315°/35° normal) over "VAT flat" (0.9–1 / 85–91 / 0–15) at 50 %, using `rvt.blend_func` | 0 … 1 |
| chm | clip(DSM − DTM, 0, 40) | 0 … 40 m |
| mask | 0 = LVGL-SL 2025, 0.5 = RLP 2022 fill, 1 = nearest-neighbour fill | 0 … 1 |

The percentiles behind each range are stored in `manifest.build.layerStats`. `manifest.build.slrmDisplayRange` (±p98, Karlsberg ±1.4 m) is the stretch used for the SLRM XYZ tiles and preview.

## Data notes (checked for Karlsberg, 2026-11-01)

- **The SL 2025 DGM1/DOM1 cover the border.** No SL tile in the Karlsberg buffer contains a single nodata pixel. The SPK ZIP even contains tiles that lie wholly in RLP (384_5466–5468), and they hold real LiDAR detail. Only `384_5464` and `384_5465` are missing from the ZIP, and both are in the SE buffer corner outside the AOI. So **within the Karlsberg AOI the RLP fill and the `mask` layer are all zero.** The fill code is still needed for Kirrberg (383_5460–5462).
- **RLP vs SL vertical offset:** RLP 2022 (EPSG:25832 + DHHN2016) overlaps SL on 7.48 M px. The median SL − RLP is **−0.07 m** (p10 −0.12, p90 0.00), consistent across tiles. This is treated as a constant bias: −0.07 m is added to the RLP heights before filling. DOM differences are large (vegetation changes between 2022 and 2025), so the DSM fill uses the DTM offset.
- RLP `dgm1` GeoTIFFs carry a compound CRS (EPSG:25832 + 7837) and use the same 1 km / 1 m PixelIsArea grid as SL. No resampling is needed.
- **Cadastre (F12):** SL WFS 414 covers 87.4 % of the Karlsberg AOI, RLP WFS 519 the remaining 12.6 %. Along the border both datasets agree to a median of 0.1 cm (max 2.1 cm), so up to ≈ 4.8 km of border can show as two lines < 2 cm apart. All 30 776 raw SL corner points inside the AOI are within 0.71 cm of an output vertex; total line length is 0.504 × the summed parcel outlines (shared edges kept once). 19 parcels that only touch the AOI edge get no label. Local lines vs the live INSPIRE CP WMS: median ≈ 2 cm, max 4 cm (2 corners checked).
- **OSM (F10):** segments are split at 1.98 m so they stay ≤ 2 m after rounding to 1 cm. The raw `waterway`/`railway`/`barrier` values are not exported (not in the contract), so e.g. `barrier=ditch` is styled like walls.
- Grid convention: pixel `(col,row)` centre = `E + col + 0.5`, `N_top − row − 0.5`. `tests/test_world_frame_georeference` checks this.

## Attribution

`© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet` · `© GeoBasis-DE/LVermGeoRP (2022), dl-de/by-2-0, www.lvermgeo.rlp.de, Daten bearbeitet` (added only when RLP pixels were used) · `© OpenStreetMap-Mitwirkende, ODbL` (osm.py) · `© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (ALKIS)` and `© GeoBasis-DE/LVermGeoRP (2026), dl-de/by-2-0, www.lvermgeo.rlp.de, Daten bearbeitet (ALKIS)` (cadastre.py; RLP only when RLP parcels were used) · `© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet (LoD2)` and `© GeoBasis-DE/LVermGeoRP (2026), dl-de/by-2-0, www.lvermgeo.rlp.de, Daten bearbeitet (LoD2)` (buildings.py) · `© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (DOP20)` (ortho.py; an RLP DOP entry only when RLP imagery was used) · `© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet (Historische Karten)` (historic.py) · POI coordinates mostly `© OpenStreetMap contributors (ODbL)`. Licence: https://www.govdata.de/dl-de/by-2-0

## Baked vector heights (`heights.py`)

`osm.py` and `cadastre.py` write every coordinate as `[E, N, z]` and set `vectors.<key>.heights = "baked"`. z is the bilinear DTM height from `data/work/<aoi>/dtm.tif` (filled 1 m AOI DTM, so run `build` first) with the PixelIsArea half-pixel convention: `u = E − E0 − 0.5`, `v = N_top − N − 0.5`, indices edge-clamped, rounded to 0.01 m. `tests/test_heights.py` checks cell centres against `rasterio` `sample()` and every generated file against the work DTM.

## Relict detection (`detect.py`, F15)

Output = **hypotheses, not findings**. Candidate files live under the git-ignored `app/public/data/<aoi>/candidates/`; never commit them here. Relict classes are published only via `scripts/release/` (ADR 0009); UXO classes never (ADR 0010). SDschG Saarland §§ 3, 8, 16; DSchG RLP. No digging/detector guidance. Contract: `docs/data-contract.md` "Candidates".

**Rules** (`method: "lrm-rules"`, `version: 2` = the fine rules of version 1 + a coarse pass; every threshold in `PARAMS`, every weight/penalty in `WEIGHTS`/`PENALTIES`, all copied into the manifest). DTM smoothed with σ = 1 m; local relief = smoothed DTM − box mean (r = 7 / 10 / 25 m, odd-reflected edges so planes stay flat at the AOI border).
- **pit** — LRM10 ≤ −0.3 m seed, grows to −0.15 m (hysteresis), 3–400 m², and a **closed depression ≥ 0.15 m** below its local spill point (morphological reconstruction on a 3 m margin). This one rule removed ≈ 85 % of the first-draft pits (slope hollows, gully heads). Score: depth, closedness, roundness (4πA/P²), size (Ø 5–15 m best), raised rim (plane-detrended ring profile).
- **mound** — LRM25 ≥ +0.3 m (hysteresis 0.15), Ø 4–45 m, circularity ≥ 0.55. Score: height, roundness (dominant, 0.6→0.85), size (Ø 8–30 m), closed dome, ring ditch (dip in the detrended ring profile).
- **rect** — a pit/mound region (holes filled, up to 2500 m²) with rectangularity (A / min. rotated rectangle) ≥ 0.88 **and** circularity ≤ 0.88 (a digitised small disc reaches rectangularity ≈ 0.86!), short side ≥ 4 m; or a positive-relief ring enclosing a rectangular hole (foundation walls).
- **platform** — slope < 6° disc (opened with r 2.5 m, so tracks drop out), 40–320 m², length/width ≤ 2, 3–10 m ring slope ≥ 10° and 20–85 % of that ring higher than the platform (hillside, not valley floor or summit).
- **linear** — LRM7 ≤ −0.3 m (ditch/hollow way) or ≥ +0.3 m (bank/wall), hysteresis 0.12 m, skeleton → longest path ≥ 30 m, width ≤ 10 m, length/width ≥ 4. A cross-profile at ±(w/2 + 2.5 m) must be lower/higher than **both** sides by ≥ 0.1 m, otherwise it is a one-sided slope step (×0.4). Valley floors / crests (|LRM25| > 1 m along the line) ×0.6. Ditch + parallel bank within 6 m: bonus.
- **Filters** — drop: ≥ 25 % on buildings (bldg + 2 m), OSM road/rail (6 m buffer) or waterway (5 m); linear ≥ 60 % on roads or ≥ 50 % on water. Down-weight: settlement (> 3 % building cover within ±50 m, mean over the in-AOI cells of the window — `inside_mean`, not the odd-padded `box_mean`, since v1.0.1) ×0.6, interpolated DTM ×0.5, small pit + small mound ≤ 3 m apart or a one-sided spoil heap next to a small pit (uprooted tree) ×0.5, linear ≥ 50 % along an OSM road/track/path ×0.7 (`along_path`, "Weg (bekannt)"), platform at an OSM way ×0.5, cut by the AOI edge ×0.8. Candidates < 0.3 are not written; the mask uses ≥ 0.4.
- **Coarse pass (version 2, Q-15)** — for structures larger than the fine radii (palace terraces, castle platforms, moats), on 2 m block means of the 1 m DTM (like level 1), local relief at r = 40 m (LRM40) and 20 m (LRM20), slope from a σ = 1.5 m smoothed surface. It runs **after** the fine pass and never changes it: fine candidates, scores and ids are identical to version 1 (decisions in `sle.candidates.v1.<aoi>` stay attached); coarse candidates that only repeat a fine one (same class inside, ≥ 50 % of its area; or a line ≥ 50 % within 4 m of a fine line) are dropped, and coarse ids continue the collision counter. Every coarse candidate has `metrics.scale_m` (40 = large region, 20 = moat, 2 = scarp) and the reason "großräumige Struktur (Grobanalyse 2 m)". Same classes as the fine pass (no contract change):
  - **large regions** — LRM40 ≥ 0.4 / 0.8 / 1.5 / 3 m (raised) or ≤ −… (sunken), 1200–40 000 m²; the lowest threshold at which a region qualifies wins (component tree), with flank = median slope on the region edge, outer = slope 6–16 m outside, break = flank − outer: `rect` (rectangularity ≥ 0.85, circularity ≤ 0.88, short side ≥ 15 m, flank ≥ 8°), `mound` (raised, circularity ≥ 0.6, length/width ≤ 2, flank ≥ 15°, closed dome ≥ 0.5 m **and** a flat top ≥ 25 % or a sharp foot, break ≥ 6° — natural knolls are rounded), `platform` (raised, top ≥ 50 % flatter than 6°, flank ≥ 15°, length/width ≤ 3, circularity ≥ 0.35 or a scarped edge with flank ≥ 20° and break ≥ 8°).
  - **moat** — LRM20 ≤ −0.3 m cells within 20 m around a raised region covering ≥ 25 % of 36 direction sectors (≥ 100 m²): the parent gets a bonus and the reason "mit umlaufendem Graben", the ditch's centreline becomes a `linear` candidate whose score is the parent's (before flags) × (0.6 + 0.4 × its own coverage/depth/length evidence) — a "ditch" around a natural knoll is just its valley, so it can never outrank the structure it encloses.
  - **scarp (terrace edge)** — slope ≥ 15° bands ≤ 10 m wide, centreline ≥ 30 m and straightness ≥ 0.9, median height step across ≥ 1 m and flatter ground (< 10°) at ±(w/2 + 4 m) on both sides → `linear` "gerade Geländekante … (Terrassenrand/Mauerzug?)"; two scarps meeting within 10 m at 90° ± 12° get a bonus ("rechtwinklig …").
  - **filters** — as the fine pass (buildings, roads, water, settlement, interpolated, AOI edge), plus: a large region whose edge lies ≥ 30 % in the OSM road/rail corridor (6 m buffer + 16 m: embankments, cuttings) and scarps/moats running ≥ 50 % in it are dropped. Tried and removed again: a flat-rectangle detector (pond basins, foundation interiors; 0 hits in both AOIs at sane thresholds) and an edge-orientation "rectilinearity" texture measure (its top hits were valley slivers and road junctions, not the palace foundations).
- **Flags** — `forest` (≥ 50 % of the footprint CHM ≥ 3 m), `near_path` (any OSM way within 5 m, incl. water/barrier — informative), `along_path` (linear only: ≥ 50 % of the line within 5 m of an OSM road/track/path → "Weg (bekannt)" in the app, score × 0.7), `near_known` (POI within 50 m).

**Evaluation** (2026-11-01, written to the manifest `candidates.evaluation` and `data/work/<aoi>/detect.json`; "before" = rule set 1, "after" = rule set 2 with the coarse pass). Densities per km², forest / open (CHM ≥ 3 m area: Karlsberg 7.14 / 1.86 km², overall 27.8 / 20.2 km²):

| AOI, score | pit | mound | linear | rect | platform | total written |
|---|---|---|---|---|---|---|
| Karlsberg ≥ 0.3 before → after | 21.2 / 7.0 | 20.5 / 17.2 → 20.6 / 17.2 | 41.3 / 10.2 → 45.5 / 12.3 | 0.3 / 0 | 9.5 / 8.6 | 742 → 777 |
| Karlsberg ≥ 0.5 after | 15.8 / 4.3 | 6.6 / 5.9 | 11.1 / 1.6 | 0.3 / 0 | 6.2 / 1.6 | 297 → 318 |
| overall ≥ 0.3 before → after | 13.3 / 3.5 | 19.8 / 14.8 → 19.9 / 14.9 | 39.8 / 12.3 → 43.6 / 14.4 | 0.3 / 0.3 | 11.2 / 7.1 → 11.5 / 7.2 | 3113 → 3275 |
| overall ≥ 0.5 after | 8.8 / 1.3 | 6.2 / 5.3 | 10.1 / 3.3 | 0.2 / 0.2 | 6.9 / 2.5 | 1102 → 1177 |

The coarse pass alone adds (forest / open per km²): Karlsberg linear 4.2 / 2.2 (34: 33 scarps, 1 moat), mound 0.14 / 0 (1); overall linear 3.9 / 2.1 (150: 139 scarps, 11 moats), platform 0.22 / 0.10 (8), mound 0.04 / 0.10 (3), rect 0 / 0.05 (1) — 35 and 162 candidates (run time +1.3 s / +5.6 s; detect ≈ 6 s / 31 s). The first draft of the fine pass (LRM thresholds only) wrote 144 pits/km² and 264 linear/km² in the Karlsberg forest; the closed-depression rule, roundness thresholds and the two-sided cross-profile brought this down to the numbers above.

Known-site recall against `pois.geojson` (sites of type burial_mound, bunker, castle, palace, garden count as "DTM-visible"; a hit = any candidate centre within the radius). POI coordinates are partly only ≈ 10–40 m precise, so 50 m is shown too. **Chance** = fraction of the AOI area within the radius of any candidate (rasterised at 2 m, `coverage_fraction`), i.e. the hit rate of a randomly placed site; it replaces the earlier Poisson estimate (kept as `chance_hit_rate_poisson`), which ignored clustering and overstated the baseline (e.g. overall 30 m 0.17 → 0.14). Rule set 1 recomputed with the same baseline:

| AOI | radius | score ≥ | recall before → after | chance before → after | after ÷ chance (expected hits) |
|---|---|---|---|---|---|
| overall | 30 m | 0.3 | 6/18 → **8/18** | 0.143 → 0.150 | 8 vs 2.7 (3.0×) |
| overall | 30 m | 0.5 | 4/18 → 5/18 | 0.054 → 0.058 | 5 vs 1.0 (4.8×) |
| overall | 50 m | 0.3 | 13/18 → **15/18** | 0.319 → 0.334 | 15 vs 6.0 (2.5×) |
| overall | 50 m | 0.5 | 6/18 → 8/18 | 0.131 → 0.140 | 8 vs 2.5 (3.2×) |
| Karlsberg | 30 m | 0.3 | 1/5 → **2/5** | 0.181 → 0.188 | 2 vs 0.94 (2.1×) |
| Karlsberg | 30 m | 0.5 | 0/5 → 1/5 | 0.077 → 0.082 | 1 vs 0.41 |
| Karlsberg | 50 m | 0.3 | 3/5 → **4/5** | 0.394 → 0.406 | 4 vs 2.0 (2.0×) |
| Karlsberg | 50 m | 0.5 | 1/5 → 2/5 | 0.183 → 0.193 | 2 vs 0.97 |

Hits at 30 m (overall, after): Rabenhorst barrows (mound 0.91), Grabhügel Schwanenweiher (mound 0.55), Hohenburg (pit/platform 0.70), Bunker südl. Homburg (0.68), Schwanenweiher (0.45), Orangerie (linear 0.31), **new:** Karlsbergweiher (coarse scarp along the dam, 0.65, 19 m) and Burgruine Merburg (coarse platform = the scarped castle platform, 96 × 54 m, 8.4 m high, 29° flank, 28 m; its moat is a coarse `linear` 0.49 at 40 m, 272 m long, 3.4 m deep, 83 % of the directions). At 50 m additionally the Eremitage (coarse scarp 0.50 at 42 m). Karlsberg with only 5 sites is statistically weak: one site more or less changes the ratio by 1×. Rabenhorst: 9 mound candidates within 150 m of the group point, 8 with score ≥ 0.5 (one-to-one matching not checked).

Still missed: the Hauptschloss itself (nearest coarse candidates 134/176 m away; the fine mound at 32 m; the foundation walls on the palace plateau are low, rubble-filled and interrupted, so neither the wall-ring rule nor the scarp rule sees closed rectangles), the Ruine westlich des Schlosses (scarp at 66 m), the Eremitage hill as a mound (rounded, 10–11° flank — rejected like natural knolls), the Hallstatt barrow at the Stumpfer Gipfel (low-confidence POI; the hill itself was a coarse mound in a draft but is natural), bunker south of Kirrberg (small, low ruin in a field). Coarse false positives seen in the overlays: natural spur ends and knolls with a valley around them as mound/platform + "moat" (0.3–0.8; hence the moat score is bounded by its parent), large flat-topped buildings or reservoirs missing from the LoD2 mask, field terrace edges (Stufenraine; anthropogenic but not old), channel/canal banks without an OSM waterway. No reviewed user decisions exist yet, so there is no precision figure. Remaining fine-pass false positives: skid trails and track cuttings (linear, mostly 0.3–0.5), irregular low natural mounds (0.3–0.45), flat patches in old quarries (platform).

**Candidate ids.** Fine-pass candidates are unchanged by rule set 2 (verified: all 742 Karlsberg and 3113 overall ids from rule set 1 are present with identical scores), so review decisions in `sle.candidates.v1.<aoi>` keep their ids. Only new coarse candidates were added (`metrics.scale_m` present).

## Point clouds (`pointcloud.py`, F16)

Contract: `docs/data-contract.md` "Point clouds" (`sle-pts-v1`). Part of the default `run.sh` step list.

- **Focus areas** are defined once in `aois.toml` as `[[defaults.pointclouds]]` (`id`, `name_de`, `bbox` in EPSG:25832, multiples of the 100 m tile size). An AOI gets every area whose bbox lies fully inside it: `karlsberg` → Schloss Karlsberg; `overall` → Karlsberg, Homburg Schlossberg, Merburg. An AOI without areas has its `pointclouds` key and folder removed.
- **Download:** the 1 km LVGL LAZ tiles touching each bbox (`3dm_32_{E}_{N}_1_SL_2025_050.laz`, ≈ 39–46 MB each) are range-extracted from the county ZIP on the LVGL Nextcloud share (sequential, retries, cached in `data/raw/laz/`). Karlsberg needs 4 tiles (≈ 180 MB), overall 8 (≈ 350 MB). Cached tiles are never re-downloaded. The LAZ are untrusted data, only parsed by laspy as points.
- **`--no-fetch`** uses only cached LAZ. An area without LAZ or points in this run keeps its previous output and manifest entry if all its tiles still exist, else it is left out; if no area remains, the `pointclouds` key is removed (never a manifest pointing at deleted tiles). Tiles are written into `pointclouds/<id>.tmp/` and swapped in only when complete, so the previous tiles are deleted only after the new ones exist (also when every point is filtered out or the run crashes mid-area).
- **Output:** per area 100 m tiles, random point order (so a prefix is a uniform subsample), cm quantisation, `agl` = Z − bilinear 1 m work DTM, class, intensity scaled to the area's p99.5; ≈ 4 M points / 40 MB per 1 km² area. Needs `data/work/<aoi>/dtm.tif` (run `build` first); uses `chm.tif`/`bldg.tif` for the report if present.
- **Report** `data/work/<aoi>/pointcloud.json`: fetch status, per area tiles/points/bytes, density per class, ground points vs DTM (median/p95 |dz|), missing LAZ, run time.
- **Measured (2026-11-01):** ≈ 3.99 pts/m² per area (Karlsberg 3 988 998, Schlossberg 3 994 414, Merburg 3 982 465 points; the open LAZ is uniformly thinned, many tiles hold exactly 40 000 points). Ground per m²: 1.25 / 1.81 / 1.63; under canopy (CHM ≥ 3 m, outside LoD2) ≈ 1.1–1.2, and 34–37 % of forest cells have no ground point. Ground vs raw DGM median / p95 |dz|: 0.018 / 0.076, 0.011 / 0.074, 0.017 / 0.080 m; ±0.5 m shifts increase the error (no half-pixel offset). First overall run: 7 LAZ downloaded (≈ 290 MB, ≈ 6 s each). Intensity p99.5 per area 1947–2123.

## 3D-Druck (moved out)

F21 (`print3d.py`, `print3d.toml`, tests) moved to the separate local repo `sle-print` in V2.1.

## 🌳 Trees (V2.4)

`trees.py` turns the CHM into one record per crown (contract "Trees", `sle-trees-v1`; [ADR 0017](../docs/adr/0017-real-trees-from-chm.md), [ADR 0030](../docs/adr/0030-conifer-fill-trees.md)).

| # | Step | Parameters (`trees.Params`) |
|---|---|---|
| 1 | CHM = DSM − DTM (work rasters, 1 m), NaN → 0, clip 0…60 m; LoD2 `bldg` dilated 1 m → 0; Gaussian | `sigma` 0.8 m |
| 2 | Tops = cells ≥ `min_height` that beat every cell within `r(h) = clip(r0 + k·h, r_min, r_max)`; ties → lower flat index | 3 m · 1.2 + 0.03·h, 1…2.5 m |
| 3 | Crowns = marker watershed on −CHM per chunk + 24 m apron, cut below `max(2 m, crown_frac · h_top)`; `r = √(area/π)` | `crown_frac` 0.45, `r_cap` 12 m |
| 4 | `h` = raw CHM 3 × 3 max at the top; `g` = DGM of the top cell | drop `h` outside 3…45 m |
| 5 | Type = mean DOP (R+G+B)/3 over the crown: `< dark` conifer, `> light` broadleaf, else unknown | 62 / 74 |
| 6 | Conifer fill: crown area A → `round(A / (π·rc²))` crowns by k-means (CHM-weighted, seeds: top + farthest point); extra trees at their centroid cell, flagged `0x80` | `rc = clip(1.0 + 0.05·h, 1.5, 3.5)` |
| 7 | One tree per cell (overlapping windows), bin by the tree cell's chunk, sort by `fmix32(id)` | — |

Output is byte-identical across reruns and worker counts (tested). Report `data/work/<aoi>/trees.json`.

### 📊 Runs (2026-11-04, M-series Mac)

| AOI | Trees | per ha | conifer / broadleaf / unknown | fill | Chunks | Size | Time |
|---|---|---|---|---|---|---|---|
| karlsberg (9 km²) | 89 258 | 99 | 12 415 / 65 377 / 11 466 | 8 818 | 36 | 0.87 MB | 3–7 s |
| overall (48 km²) | 326 010 | 68 | 27 131 / 272 447 / 26 432 | 19 235 | 192 | 3.1 MB | 10–31 s (cold read) |

Karlsberg percentiles: `h` p5/p50/p95 = 9.4 / 28.7 / 37.5 m, `r` 1.9 / 4.3 / 7.8 m.

### 🎯 H7 count check (3 plots, ±15 %)

**Method.** TrueDOP20 at 0.2 m (3 WMS requests, plot ± 20 m, git-ignored `data/raw/ortho/plots/`). Every crown marked by hand on a 5 m grid **before** the detector ran on the plot. Saplings under the canopy were not counted; uncertain marks counted as trees. Detector run on the plot ± 60 m of the `overall` rasters; trees counted when their cell lies in the plot. Matching: greedy, ≤ 3 m. Overlays: `docs/shots/v24/final_P*.png` (git-ignored).

| Plot | SW corner (EPSG:25832) | Size | Stand | Hand | Detected | Error | Matched ≤ 3 m (P / R) |
|---|---|---|---|---|---|---|---|
| P1 | 383310, 5465610 | 50 × 50 m | dense spruce, 30 m | 88 | 90 (54 fill) | **+2 %** | 0.69 / 0.70 |
| P2 | 382430, 5465530 | 70 × 70 m | mixed broadleaf, 34 m | 51 | 48 | **−6 %** | 0.29 / 0.27 |
| P3 | 381760, 5460390 | 70 × 70 m | open orchard, 6 m | 33 | 34 | **+3 %** | 0.74 / 0.76 |

**Tuning path** (P1 / P2 / P3 error): first defaults `r(h)` up to 4 m → −75 / −31 / +3 %; narrower window (≤ 2.5 m) → −59 / −6 / +3 %; smaller `sigma` only moves noise (P2 +25 %); fill with `rc(30 m)` = 2.8 m → −18 %, 2.5 m → +2 %.

⚠️ **Limits.**
- ALS 2025 is **leaf-off** (Feb), the 1 m DOM is smooth: dense conifer tops ≈ 5 m apart merge. Fill trees fix the **count**, their positions are estimates. A 0.5 m LAZ max-z CHM (4 pts/m²) was too speckled to separate tops.
- Broadleaf counts are right, positions are not (P2 matches 27 %): leaf-off tops ≠ summer crown centres.
- Type is brightness only: shaded broadleaf → conifer, sunlit conifer → unknown, larch → broadleaf. P1 still has 6 "unknown" crowns that are never filled.
- Calibrated on one plot per stand type. `rc(h)` matches ≈ 500 stems/ha for mature spruce, but young dense conifer stands will be under-counted.

## 🏆 Place statistics (`stats.py`, Orte im Vergleich)

`./run.sh overall stats` (= `uv run python stats.py overall [--refresh-osm] [--no-manifest]`) writes `stats/places.json` + `stats/places.geojson` (contract "Place statistics", `sle-stats-v1`; [ADR 0049](../docs/adr/0049-orte-im-vergleich-places-only.md); plan [docs/plans/orte-im-vergleich.md](../docs/plans/orte-im-vergleich.md)) and the manifest key `stats`. The AOI argument only says where the output goes; the statistics cover the `[orte]` stats bbox (12 × 18 km), which is larger than any 3D AOI.

**Inputs** (run these first, all write to `data/work/orte/`; `./run.sh orte` runs the chain `places stats-trees stats-inputs` and then `stats` for `overall`; `orte` is `stats_only = true` in aois.toml, so `./run.sh orte fetch|build|…|trees|forest` and every tile script called with `orte` stop with a message, see `common.plan_steps` / `load_aoi`): `places.py` (outlines, parcels), `stats_trees.py all` (trees over the stats area, CHM/DTM/LiDAR-source/building rasters), `stats_inputs.py all` (NDVI, Zensus 100 m grid, MaStR). `stats.py` itself fetches and caches one Overpass query (roads, parking, squares, residential, water, pylons/masts/wind turbines → `data/raw/osm-orte/`, ≈ 10 MB) and the Zensus 2022 *Regionaltabelle Bevölkerung* (official municipality totals → `data/raw/zensus2022-regional/`, 1.8 MB), and reads the LoD2 cache of `buildings.py`.

| Measure | Method id | Rule (parameters in `places.json` `method[*].params`) |
|---|---|---|
| trees, crown, biomass | `parcel-pip-v1`, `crown-disc-v1`, `crown-allometry-v2` | tree top in an ALKIS parcel of the place; crown = Σ π r² ÷ official area; AGB from H and 2r, ρ by `species.tree_group` (`tree-group-v1`: a „wahrscheinlich“ DLR class, else the DOP colour type; v1 used the colour type only), published as [½·mid, mid, 2·mid] t, CO₂ = 1.8 × AGB. Tops above the app's 45 m cap (kept by `stats_trees.py` up to the 60 m CHM clip; tops at the clip re-measured on the unclipped CHM, ≤ 75 m) count only when they pass the tallest checks |
| Ortslage | `ortslage-bldg-buffer-50m-v1` | LoD2 footprints buffered 50 m, union, holes < 1 ha closed, parts with < 3 buildings dropped, clipped to the place |
| green / canopy | `ndvi-cir-v1` | CHM ≥ 3 m or NDVI ≥ 0.15 (SL scale; RLP DOP pixels mapped through ndvi.json's quantile table) |
| sealed | `sealed-v1` | not green, not OSM water, and LoD2 building cell, OSM paved road (buffered by width/class) / parking / square, or NDVI < 0.08 |
| inhabitants | `zensus-grid-area-v1` | Zensus 100 m cells × area share inside the place |
| tallest | `tallest-checked-v4` | highest non-fill tree **outside the Ortslage** and **≥ 10 m inside the place outline**, with crown r ≥ 2 m, CHM support (ring median ≥ 0.75 h, ≥ 50 % of the 4 m disc ≥ 0.6 h), h ≤ 75 m on the **unclipped** CHM for tops at the 60 m detector clip (DSM − DTM from the raw tiles, `stats.unclipped_chm`; no readable unclipped window → rejected as `chm-clip`, `stats.remeasure_at_clip`), no line-shaped top (cells ≥ 0.8 h within 8 m connected to the top: principal-axis ratio ≤ 3), DTM rise ≤ 3 m within 4 m (no gully bottom / bank foot), mean DTM within 15 m ≤ 3 m above the top's ground (no ravine bottom), no building cell within 5 m, no OSM pylon / mast / tower / chimney / wind turbine within 30 m. `in_trees` = the AOI Trees layer holds the tree (by id) |
| category | `category-inhabitants-v1` | `stadt` from 5,000 inhabitants (grid), else `dorf` (Erbach-Reiskirchen, ≈ 12,600, competes with the towns) |
| lidar_epoch | — | flight year of the majority of the place's LiDAR cells (`rasters/src.tif`); `lidar_epochs` = shares per flight |
| PV | `mastr-municipality-v1` | MaStR units in operation per municipality ÷ official Zensus 2022 municipality total |
| riesen (Phase 1) | `riesen-checked-v1` | ≤ 10 trees per place passing every tallest check, greedy by height, each ≥ 20 m from the earlier picks (`stats.pick_top`); `riesen[0]` = tallest; ranks share ties on the published 0.1 m height; DLR species `{key, p}` at the top only when „wahrscheinlich“ (p ≥ 50, no contradiction), never alder / other broadleaf |
| species (Phase 1) | `species-dlr-crown-mix-v1` | DLR class per tree (`species_trees.npy`, filtered with the tall-tree rejects), crown-weighted mix of the crown area with a class, `coverage_pct`; alder / other broadleaf entries carry `weak: true` (`SPECIES_WEAK`) |
| biodiversity (Phase 1) | `gbif-rarefied-v1` | `gbif_by_place.json`: species, records, iNaturalist share, Hurlbert rarefaction at 500 (board measure) and 150 records, years |
| forest age / 1935 forest (Phase 1) | `tree-age-height-v2`, `hist-forest-crown-share-v1` | `forest_age_by_place.json`: crown-weighted age classes plus `beyond` (taller than the class-II table end: no age), median age of the trees with an age; 1935 forest share only where the mask covers ≥ 50 % of the crown area |
| land use (Phase 1) | `alkis-nutzung-groups-v1` | `nutzung_summary.json` (`places.py`): 7 groups, RLP only until the SL WFS 414 answers |
| roof potential (Phase 1) | `roof-pv-potential-v2` | `roofs_by_place.json`: suitable m², usable = pitched × 0.7 + flat × 0.4, kWp range per place and municipality; `pv.used_pct` only for complete municipalities |
| goals (Phase 1) | `goals-examples-v1` | plan §5 example goals with the published baseline; `progress` null until a second epoch |

NDVI thresholds were set from the classes measured inside the Ortslage (`stats_report.json` `ndvi_classes`, 2026-11-07): roofs median 0.01 (p90 0.11), OSM paved median 0.00 (p90 0.07, p95 0.15), canopy median 0.36 (p5 0.16).

**Phase 1 inputs** (all optional; a missing file leaves its block `null` and its source out of `inputs`): `./run.sh orte species gbif roofs forest-age stats` runs `species.py fetch/compare/stats` (DLR + Thünen windows, per-tree arrays aligned with `trees.npz`: rerun after `stats-trees`), `gbif.py` (facet counts, cached in `data/raw/gbif/`), `roofs.py` (LoD2 roof planes) and `forest_age.py` (needs the species window), then `stats`. `./run.sh overall species` also writes the app layer `species/species.png`. `nutzung_summary.json` comes from `places.py`. `places.json` is compact JSON since Phase 1 (≈ 59 KB). Review round 2 (2026-11-08): `roof_potential.usable_m2` (the kWp base) next to `suitable_m2`; `species.py build` also credits the Thünen cross-check in the manifest `attribution`; `stats_report.json` `tree_group` counts (168,496 conifer / 606,905 broadleaf / 104,153 no group by `tree-group-v1`, vs 56,456 conifers by colour type alone).

**Privacy.** Only aggregates per place / municipality are published; the only points are trees (`tallest` and the ≤ 10 `riesen` per place), never inside the Ortslage and always ≥ 10 m inside the place outline; roof potential below 5 buildings is suppressed like the Ortslage. `check_privacy` refuses parcel-id, owner, address or person keys (by fragment) and parcel-id- or address-like string values, `check_outline_privacy` anything but `{id, name_de}` in the outlines; Ortslage on < 5 buildings → `null` + `suppressed`; places with < 5 parcels are dropped; MaStR `by_year` carries years with < 5 systems into the next year. Local diagnostics go to `data/work/orte/stats_report.json` and `stats_table.md`.

**Run 2026-11-07, round 2** (≈ 50 s with caches; the first run adds ≈ 35 s for Overpass): 9 places, 879 838 trees detected in the stats area (1 649 above 45 m, of which 1 378 pass the checks: rejected 120 terrain, 58 pylon/mast, 52 CHM clip, 30 spike, 6 crown, 5 building), 550 421 inside the places, 58 205 LoD2 buildings, 171 Ortslage parts. `places.json` 28 KB, `places.geojson` 40 KB (clean coverage: no overlaps, one 10 m² rounding sliver). Tallest trees 39.6–58.7 m, no ties; every winner checked in DOP, CHM and DTM/DSM profiles (clear crown apex over moderate ground, in forest). Ortslage covers 97–100 % of OSM `landuse=residential` per place; 42–78 % of the Ortslage is OSM residential (the rest is commerce, industry, schools, and the 50 m fringe).

**Round 3 (2026-11-07, review fixes).** `tallest-checked-v3`: the place-edge rule replaced Bechhofen's 47.5 m pick (0.24 m from the Gemarkung line); the valley rule then rejected its 46.9 m successor in a 13 m deep ravine (flat DSM, mean ground within 15 m 3.9 m above the top; ordinary 30–45 m tops: p1 2.7 m) and 12 other tops above 45 m (1 365 of 1 649 kept). Bechhofen's tallest is now 46.6 m (384297.5, 5469230.5, 17 m inside the outline; RLP 2022 LiDAR) on flat ground with a clear DSM apex, a leaf-off broadleaf crown in the DOP; the other 8 winners are unchanged. `tallest.in_trees` is new: only Beeden-Schwarzenbach's winner is in the overall Trees layer; 619 checked tops above 45 m inside the overall AOI are not (the Trees layer keeps its 45 m cap, `trees.py` is not changed by this step). Slope: the winners stand on 3–31° (4 m plane fit) and 2–6.5 m above the CHM p95 of their 20 m stand; flat-ground winners stand as far above their stand as slope winners (Erbach-Reiskirchen 3°: +4.7 m, Kirrberg 30°: +6.1 m), and for 600 sampled tops above 45 m slope and height above the stand correlate at −0.19, so no slope rule was added (it would reject ≈ 40 % of the tall tops at 25°). Discipline texts now say Gemarkung (not Stadtteil) and that the Ortslage includes commercial and industrial sites.

**Round 4 (2026-11-08, review: CHM clip).** `trees.smooth_chm` clips the CHM at 60 m, so 55 tops in the stats area read exactly 60.0 m and v3 rejected all of them ("chm-clip"), among them a 60.9 m top in Bruchhof-Sanddorf 40 m from the published 58.7 m one. `tallest-checked-v4` re-measures tops at the clip on the unclipped CHM: 50 of the 55 are 70–181 m (wind turbines south of Kirrberg and near Bechhofen, masts near Mörsbach and Zweibrücken: now `pylon-or-mast` via the 16 OSM wind turbines and the 30 m clearance, or `too-tall` > 75 m, e.g. a 181 m nacelle whose OSM node lies 31 m away), 2 are 60–61 m cranes in Zweibrücken's industrial area (OSM objects within 1 m → `pylon-or-mast`; the linear test alone would also reject them, ratio 5.5 and 6.8), one more 59–62 m top stands 2 m from an OSM mast, and 2 pass: the Bruchhof-Sanddorf top (60.9 m) and a 60.4 m RLP 2022 top outside every place. The linear test also removed two 47–51 m crane-jib points (ratio 3.9 / 4.7) that v3 counted as trees. 45–60 m tree tops have ratio median 1.3, p95 2.0. Rejected tops above 45 m: 98 pylon/mast/wind, 10 too-tall, 2 linear, 120 terrain, 30 spike, 13 valley, 6 crown, 5 building (1 365 of 1 649 kept). Only Bruchhof-Sanddorf's winner changed: **60.9 m at 383180.5 / 5465532.5** (summer DOP: a dark conifer crown in a group of emergent conifers over lighter broadleaf forest; the CHM shows a round dome with its apex in the centre on 8° ground, 6 m above the 20 m stand p95 of 54.8 m; most likely a Douglas fir, the only species here that reaches ≈ 60 m, but the species is not measurable from these data).

**Phase 1 run (2026-11-08, ≈ 57 s with caches).** Riesen: 10 per place, min spacing 20.2–26.2 m, `riesen[0]` = the unchanged v4 winners (tallest 39.6–60.9 m), all inside the published outlines; 16 of 90 are in the overall Trees layer (Beeden-Schwarzenbach 10, Kirrberg 6, others above 45 m or outside the tiles); most tall Riesen sit in DLR Douglas fir cells. Species: dominant Buche (Bechhofen, Einöd, Kirrberg, Mörsbach, Zweibrücken), Eiche (Beeden-Schwarzenbach, Bruchhof-Sanddorf, Erbach-Reiskirchen), Kiefer (Homburg); coverage 40–89 %. Artenvielfalt (rarefied 500): 227–316 species, Bruchhof-Sanddorf highest; Mörsbach and Bechhofen `few_records`. 1935 forest share only for Kirrberg 44.8 %, Homburg 48.4 %, Bruchhof-Sanddorf 59.4 %, Mörsbach 46.6 % (the others lie mostly outside the overall historic mask until `historic_forest.py --stats` runs). Land use only for the RLP places. Roof potential from 7,500–10,000 kWp (Mörsbach) to 120,000–160,000 kWp (Homburg); `pv.used_pct` only for Bechhofen (11.2–14.9 %). 4 example goals per place, progress null.

**Known limits.** The tallest-tree checks are geometric only: the 60.9 m top (Bruchhof-Sanddorf, in a group of 50–58 m conifers) is plausible but not confirmed on the ground. NDVI cannot tell bare soil from asphalt (fields inside the 50 m fringe count as sealed). RLP places are partly RLP 2022 LiDAR (+20 % trees per ha of canopy at the border, `border_effect.json`, not harmonised). Copernicus imperviousness is not used.

## 🗺️ Gemeinde level (`gemeinden.py`, `gemeinde_trees.py`, `gemeinden_stats.py`, S1)

The Saarland leaderboard (plan `docs/plans/orte-skalieren.md` S1, [ADR 0051](../docs/adr/0051-leaderboard-levels-gemeinden-ortsteile.md), contract "Place statistics" → "Gemeinde level"). `./run.sh saarland` (stats-only AOI, `stats_steps`) = `gemeinden.py all` → `gemeinde_trees.py all` → `gemeinden_stats.py saarland`; every step is cached and can be rerun alone. Work files: `data/work/gemeinden/`; output: `app/public/data/saarland/{manifest.json,stats/}` plus `stats_levels` in `overall`'s manifest.

| Step | What | Cost |
|---|---|---|
| `gemeinden.py outlines` | BKG VG25 `vg25_gem` WFS (2 requests, CC BY 4.0): 52 SL + Zweibrücken + Bechhofen, checks (count, Σ area 2,570 km², AGS, overlaps, Homburg 82.6 km²), 1 km tiles per Gemeinde, tile owners (largest share) | seconds |
| `zensus` / `mastr` | Regionaltabelle totals per AGS; MaStR solar units per AGS (paged, cached, 1 s pause) | ≈ 11 min first run |
| `dlr` | DLR COG window of the state (≈ 5 MB) → 10 m EPSG:25832 grid → forest share + cell species mix | ≈ 15 s |
| `gbif` | `gbif.run` on the Gemeinde outlines (facets only; simplification steps up to 200 m for the WKT limit) | ≈ 30 s per Gemeinde |
| `lod2` / `roofs` | LVGL LoD2 county ZIPs (≈ 1.3 GB) + RLP 2 km tiles; one pass → roof potential per Gemeinde + WKB footprints per tile (`footprints/`) | ≈ 20 + 8 min |
| `gemeinde_trees.py fetch` | all DGM1 + DOM1 members of the six county ZIPs (≈ 2,700 tiles, ≈ 20 GB in `data/raw/lvgl-sl/`), sequential, both products per tile, waits on outages | ≈ 90 min |
| `gemeinde_trees.py run` | per 1 km tile + 64 m apron: `stats_trees.lidar_window` → trees.py detection (DLR type, conifer fill) → sums per Gemeinde → `tiles/<E>_<N>.json` (resumable; ≈ 1 s per tile and worker) | ≈ 15 min with 3 workers |
| `gemeinden_stats.py` | publishes; a discipline is `ready` only when every Gemeinde has it; slow inputs stay `pending` per place | seconds |

Measured on two Kirrberg/Homburg tiles against the Ortsteile run: crown area equal to < 0.02 %, measured tops identical; tree counts differ only by the conifer fill (DLR class instead of DOP colour: 2× trees in a conifer tile, 380/5464), which is why the Gemeinde level has its own method id.

## 🌲 Historic forest mask (`historic_forest.py`)

`./run.sh <aoi> forest` (after `historic`; = `uv run python historic_forest.py <aoi> [--no-manifest]`) reads `data/work/<aoi>/hist_1935.tif` / `hist_1840.tif` (1 m RGBA mosaics of historic.py) and writes `forest_hist/forest_hist.png` (one u8 PNG, 5 m cells, ≈ 35 KB for `overall`) plus the manifest key `forest_hist` (contract "Historic forest mask", `sle-forest-hist-v1`). Bits: 0 forest 1836–41, 1 forest 1935–40, 2/3 that map has no image, 255 outside.

- **TK25 1935–40:** forest is drawn as tree symbols, not as a tint: broadleaf „Ω“ (a ring on two feet, 20–28 m across at 1 m/px) and conifer „Λ“ (narrow, ≈ 17 m tall, foot to the right); meadow is „··“, orchards small rings, built-up land hatching. The grey image is divided by the local paper brightness (sheets are yellow, orange or white), synthetic Ω and Λ templates are matched (NCC, 3 sizes; Ω ≥ 0.45, Λ ≥ 0.6, local std ≥ 0.12 so blank paper does not fire), peaks ≥ 10 px apart are symbols (3 113 in `overall`). Density with σ 50 m ≥ 0.7 symbols/ha is forest (one lone symbol peaks at 0.64, so two are needed), parts < 1 ha dropped, holes < 0.5 ha closed: 37 % of `overall` is forest in 1935 (today's canopy share: 72 % inside, 49 % outside the mask).
- **Accuracy (2026-11-08):** 100 simple-random map cells, labelled blind by looking at 160 m crops (forest = tree symbols around the point; unsure at roads, text, map edges, dense villages): 76 labelled, precision 0.76, recall 0.79, accuracy 0.86 (unsure points excluded, so the real accuracy is lower; 95 % intervals are ± 0.15). A first Ω-only version had recall 0.38 on the same sample: conifer stands are drawn with Λ only. Labels: `data/work/<aoi>/forest_hist_review.json`, scores `forest_hist_accuracy.json` (copied into the manifest).
- **Bayer. Positionsblätter 1836–41:** no forest signature in the scan (hachures, boundaries, names only; named forests such as the Vierherrenwald look like open hillsides), so `classified: false`. „Wald seit mindestens 1840“ needs another source (e.g. layer `2`, Preußische Generalstabskarte 1816–47, unchecked: the WMS answered 503 on 2026-11-07/08).
- Effective resolution ≈ 50–100 m; small woods, hedges and single trees are missed, orchards and ring-like glyphs can read as forest. Only AOIs with historic tiles get a mask (the stats area of `orte` has none, so places have no historic-forest share yet).

## 🗺️ Many places (v3, S2)

Contract revision 3.0 ("Many places (v3, S2)"), ADR 0052–0056. A **place** is a catalog municipality that publishes
only the 1 km tiles it owns; v1/v2 rectangle AOIs (karlsberg, overall, …) are built exactly as before.

```bash
./run.sh orte-katalog                    # catalog.py ownership → overview.py → catalog.py build (AOI-independent)
./run.sh ort-homburg                     # a place: fetch build xyz osm cadastre buildings ortho historic … trees test
./run.sh fixture-v3                      # shared S2 fixture: both fixture places, then fixture_v3.py
```

| Module | What it does |
|---|---|
| `grid.py` | `sle-grid-25832-v1` (origin E 300 000 / N 5 400 000, 256 km, 1 km tiles `"{E_km}_{N_km}"`), global chunk addresses `(k, I, J)`, alignment, the presence bitmap (row 0 = north, LSB first, base64 with padding; the contract example is a test vector), fixed v3 u8 ranges. |
| `catalog.py` | Ownership `largest-share-v1` from the **unsimplified** VG25 outlines (`data/raw/vg25/`, dissolved per AGS by `gemeinden.parse_vg25`): integer m² per tile, owner = largest share ≥ 1 m², ties → smaller AGS, then id → `data/work/catalog/tile_owners.json` (2 857 tiles, 54 places; Homburg 91). `build` writes `sle-catalog-v1` (`app/public/data/orte-katalog/catalog.json`); status / data_url / repo / opt-ins from `catalog.toml` (unlisted places are `stats`). `height_ref_m` = floor of the overview's 1 m minimum. |
| `build.py` (v3) | aois.toml `place = "<id>"` (optional `tiles` subset, `out`, `cache_from`, `relict_candidates`): rectangle = bbox of the owned tiles, fetch set = owned tiles + 8 neighbours. **Every tile is computed from its own source window (tile ± `buffer_m`)**: SL first, RLP + a fixed −0.06 m, nearest fill inside the window, svf/openness (r 10 m), internal 1 m VAT, CHM. So a tile's bytes do not depend on which tiles are built with it (locality test). Writes only present chunks: `dtm/{i}_{j}.webp` (terrarium, WebP lossless, apron from real terrain), `relief/{svf,opns_pos,opns_neg}` AVIF q90 (`lossy: true`, budget mean ≤ 1.5 / max ≤ 16 checked per file), `relief/{chm,mask}` WebP lossless, level 1 `levels/1/{dtm,vat}` (one tile per chunk; baked VAT = 2 m block mean), `derived` hillshade/slope/slrm/vat, `presence`, `grid`, `place`, `build.pipeline`, no `dsm`. Work rasters cover the whole rectangle (`vat.tif` NaN outside present tiles). |
| `encode.py` | `save_webp_lossless` (VP8L, R = G = B for u8, exact, method 6; asserts the bit-exact decode), `save_avif_u8` (4:0:0, full range, no ICC), `save_avif_rgb` (q65, 4:2:0). |
| `overview.py` | `sle-overview-v1` levels 2…K (default 6) for the catalog area: bbox aligned at S_K, level-2 cells = 4 × 4 block means of the per-tile filled DTM (same fill as the places), coarser levels by 2 × 2 means, heights quantised to `quant_m` 0.05, WebP lossless, presence = chunks touching an owned tile. |
| `fixture_v3.py` | `app/public/data/fixture-v3/`: two interlocking 3-tile places (Homburg / Kirkel border), a `stats` place, overview 2–3, catalog, README. |

Other steps for a place filter per tile (contract rule 6): trees by top cell, buildings / candidates by centroid,
point-cloud areas by bbox centre, OSM clipped to the present tiles (2D, `densified: false`), parcel labels inside
present tiles (`lines: 'derived'`), ortho / historic maps AVIF q65 per present chunk, minimap `xyz.vat` ≤ z16 with
alpha 0 outside the place. Candidates only with `relict_candidates = true` (ADR 0053).

## Larger AOIs

`overall` (6 × 8 km, 80 tiles incl. buffer) runs the relief step on about 54 M cells and needs roughly 4–5 GB RAM. Tile it by AOI if that becomes a problem. XYZ size grows with area: about 13 MB per km² at z12–18.

Overall, measured 2026-11-01 (`./run.sh overall`, 399 s: fetch 142 s, build 121 s incl. levels 7.6 s, xyz 44 s, osm 52 s, cadastre 27 s): 45 SL tiles in the AOI (68 incl. buffer; 12 tiles not in the SPK ZIP), RLP fills exactly 383_5460–5462 (3 000 000 px, mask 0.5), no interpolated cells; SL 2025 border tiles already contain the RLP side. RLP bias −0.06 m (Karlsberg −0.07). heightRange 222.52–385.89 m. Sizes: 1.0 GB total — dtm 48 MB, dsm 68 MB, relief 251 MB, levels 42 MB, xyz 578 MB, vectors 58 MB (osm 10.9 MB / 4803 ways, flurstuecke 42.2 MB / 66 653 lines, labels 5.2 MB / 23 525).

## Known gaps

- `common.carry_foreign_layers` keeps foreign `layers`/`levels[k].layers` entries without checking that their files exist; since v1.0.1 `build` no longer deletes `relief/bldg/`, but deleting a foreign output by hand still leaves a dangling manifest entry until its step runs again.
- `ortho.py` leaves a partial `.ortho.staging/` under the AOI data dir after a failed run (cleared by the next run); `historic.py` still deletes `hist_<year>/` after fetching the full mosaic but before writing (a write error there would leave it incomplete).
- Detection: the platform slope context (r = 15 m) and settlement fraction (r = 50 m) now average only in-AOI cells; at the AOI edge they rest on fewer cells. Re-run after the change (2026-11-01): overall 3275 → 3276 candidates, karlsberg 777 → 777; known-site recall unchanged (overall 8/18 at 30 m, karlsberg 2/5).
