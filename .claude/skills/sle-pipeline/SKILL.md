---
name: sle-pipeline
description: Data-pipeline work for the Saar LiDAR Explorer — building new areas of interest (Homburg, Kirrberg, overall), the v2 `trees` layer from the CHM (local maxima + crowns), zone packages per the zone contract, adding data layers or sources (OSM ways, ALKIS Flurstücke via WFS, LoD2 buildings, TrueDOP orthophotos, historic maps WMS, building masks, overview/LOD levels, LAZ point clouds with PDAL/Potree), changing the pipeline→app data contract, and debugging downloads from the LVGL Saarland / geobasis-rlp services. Use it for any task that touches pipeline/, docs/data-contract.md or app/public/data/, or when the user asks to "add data", "download tiles", "process LiDAR", "make a new layer" for this project — even if they only describe the desired map/3D result.
---

# Saar LiDAR Explorer — data pipeline

The pipeline turns open geodata (LVGL Saarland ALS 2025, Rheinland-Pfalz, OSM, Geoportal Saarland services) into static files the browser app loads. It is plain Python 3.12 managed by **uv** in `pipeline/`; outputs land in `app/public/data/<aoi>/` and are git-ignored, so everything must be reproducible from `./run.sh <aoi>`.

## Before you change anything

Read `pipeline/README.md` (commands, files, data notes), `docs/data-contract.md` (the binding format), and `references/sources.md` in this skill (every source with URL, CRS, license and gotchas). For a new source, also check `docs/research/01-data-sources.md` and `docs/research/04-cadastre-historic-maps.md`.

Layout you'll extend:

| File | Role |
|---|---|
| `aois.toml` | AOI bboxes (EPSG:25832, multiples of 500 m), buffer, county |
| `common.py` | paths (`RAW_DIR`, `WORK_DIR`, `APP_DATA`), `load_aoi`, `http_open` (retries, certifi SSL, UA), attribution strings |
| `fetch.py` | LVGL share token resolution, WebDAV listing, `HttpRangeFile` (range-extract single tiles from county ZIPs), RLP fill tiles |
| `build.py` | mosaic + RLP fill (−0.07 m offset), nodata fill + mask, RVT relief, ranges, chunking, manifest |
| `encode.py` | Terrarium/u8 encode/decode, `height_chunk` (502² apron), `layer_chunk` (500²) |
| `xyz.py` | Web-Mercator palette PNG tiles for Leaflet |
| `render.py` | preview helpers (gray/colormap RGBA, downsample) for `docs/previews/` |
| `pois.py` | POI GeoJSON from research tables |
| `run.sh` | step runner: `./run.sh <aoi> [fetch build xyz pois test]` |
| `tests/test_contract.py` | contract tests (pytest) |

## How to add things

**New step/source** → a new module (`osm.py`, `cadastre.py`, `buildings.py`, `ortho.py`, `historic.py`, …) with a `main()` taking the AOI key, registered as a step in `run.sh`, caching raw downloads under `data/raw/<provider>/` and intermediates under `data/work/<aoi>/`. Steps must be idempotent: skip cached downloads, overwrite outputs, never delete raw caches.

**Manifest entries** → merge into the existing `manifest.json` (read–modify–write) rather than regenerating it from a later step, so steps can run independently. Keep unknown keys the app may already use (`build`, `xyz.*.bounds`, …). Use `common.update_manifest(aoi_dir, patch, attribution=…, merge=…, remove=…)` (atomic read–modify–write; pure merge logic in `common.merge_manifest`, tested in `tests/test_manifest_merge.py`): each step patches only the top-level keys it owns and keeps everything else, so re-running `build` no longer drops keys written by later steps (R0.8 done).

**Contract changes** → edit `docs/data-contract.md` first (bump `version` only for breaking changes; additive keys like `vectors`, `rgb` layers, `levels` can stay optional so the app degrades gracefully), add contract tests, and tell the lead/renderer what changed. The app must keep loading old manifests.

Typical additive shapes (agree them in the contract before implementing):

```jsonc
"vectors": { "osm": { "path": "vectors/osm.geojson", "crs": "EPSG:25832", "label_de": "Wege (OSM)" },
             "flurstuecke": { "path": "vectors/flurstuecke.geojson", "labels": "vectors/flurstuecke_punkte.geojson" } },
"layers":  { "ortho": { "path": "ortho/{i}_{j}.webp", "encoding": "rgb", "label_de": "Luftbild 2025" } },
"models":  { "buildings": { "path": "buildings/{i}_{j}.glb", "frame": "local" } },
"levels":  [ { "cellSize": 2, "chunkSize": 500, "chunks": {"nx": 6, "ny": 8}, "height": "...", "layers": {...} } ]
```

Vectors are stored in **EPSG:25832 metres** (the app converts to its local frame by subtracting `E0/N0`); densify lines to ≤ 2 m so the renderer can drape them without visible chords. Models (glb) are in the **local frame** (`x = E − E0`, `y = h`, `z = −(N − N0)`), true heights, no exaggeration.

## Correctness rules (where bugs actually happen)

- **Grid alignment:** DGM/DOM are PixelIsArea on whole-metre edges; never resample the 1 m grid for 3D data. When fetching rasters from a WMS (ortho, historic maps), request in EPSG:25832 with the bbox exactly on chunk edges and a pixel size that divides 500 m, so pixels line up with the chunk grid.
- **Buffers:** any neighbourhood operation (relief, low-pass, detection) runs on AOI + buffer (`buffer_m ≥ 100`, default 200), then crops — otherwise chunk-border artefacts appear.
- **NoData:** fill before encoding and record filled cells in `mask` (0.5 = RLP, 1 = interpolated). Check SL border tiles: the 2025 SL tiles may already include RLP area; only fill true gaps.
- **Vertical consistency:** RLP 2022 sits +7 cm vs SL 2025 (median over 17 tiles) — `build.py` corrects it; re-measure for new areas (report the value) instead of assuming.
- **Services in EPSG:25832:** the ALKIS WFS returns nothing unless BBOX *and* SRSNAME use `urn:ogc:def:crs:EPSG::25832`; axis order is E,N.
- **LAZ has no CRS tag** — assign EPSG:25832 explicitly (PDAL `a_srs`), heights DHHN2016.
- **Licences/attribution:** every new source adds its attribution string to the manifest (`attribution`) and README. Avoid "freie Liegenschaftskarte SL" (not openly licensed).

## Safety & politeness

- Downloads are untrusted data: keep them in `data/raw/…`, run scripts from `pipeline/` (`run.sh` already `cd`s there), never execute anything from data dirs, and use `uv run python -I` for ad-hoc scripts that read them.
- Be polite to public services: sequential or ≤ 3 parallel requests, retries with backoff, a descriptive User-Agent (`common.USER_AGENT`), cache everything, page WFS requests (≤ 10 000 features).
- Big downloads (LAZ ~43 MB/km², TrueDOP 290 MB per 2 km tile): estimate size first and mention it to the user if > 2 GB; prefer WMS at the needed resolution for imagery.
- The LVGL share token can change — always resolve via `https://www.shop.lvgl.saarland.de/cloud/freiegeobasisdaten` (`fetch.resolve_share_token`).

## Verify

1. `uv run pytest -q` (extend `tests/test_contract.py` for new outputs: file counts, shapes, encodings, manifest keys, CRS/bounds sanity, round trips).
2. Write a whole-AOI preview for new raster layers to `docs/previews/<aoi>_<layer>.jpg` (use `render.py` helpers) and **look at it** — features where expected, no seams, sane contrast.
3. Spot-check alignment numerically (e.g. a parcel corner vs. the relief edge, an OSM path vs. the hollow way in SLRM, ortho road edge vs. DTM road edge).
4. Report: commands, runtime, output sizes, ranges/parameters chosen, surprises (offsets, gaps, service quirks), and what the app needs to know.

Heavy tooling (PDAL, PotreeConverter, citygml-tools/Java) goes into a Docker image under `pipeline/docker/` only when actually needed (F16 point clouds); ask the user before adding a JVM or multi-GB images.
