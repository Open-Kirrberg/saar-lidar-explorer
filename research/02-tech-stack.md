# 02 — Tech Stack Research: Saar LiDAR Explorer

> **Status:** Research v1 · **Date:** 2026-11-01 · **Scope:** rendering, data pipeline, 2D map, flight controls, project setup, OSM/LoD2 overlays
> Package versions were checked against the npm / PyPI registries and GitHub releases on 2026-11-01 (see [§8](#8-library-list-with-versions)).
> Data-source details (exact Saarland products, tiling, licences) are covered in `01-data-sources.md`. Relief-visualization theory is covered in `03-archaeology-visualization.md`.

---

## TL;DR

- **3D:** **three.js r187 + a small custom terrain engine**: a chunked quadtree/CDLOD heightmap in a **local metric frame based on EPSG:25832** (UTM 32N), drawn with a `ShaderMaterial`. Lighting is computed per pixel from the full-resolution 1 m height texture, so relief detail does not depend on mesh density. Hillshade, slope and local relief are computed live in the shader. SVF, openness, SLRM, MSRM and VAT are **precomputed with RVT (rvt-py)** and blended in as textures.
- **Pipeline:** a **Docker (micromamba/conda-forge) image** with GDAL 3.13, PDAL 2.10 and rvt-py 2.2. A Python script turns the DTM into a **Terrarium-PNG chunk pyramid** on our own UTM grid, plus WebP relief textures. The same rasters are tiled to **EPSG:3857 XYZ tiles** for Leaflet.
- **2D:** keep **Leaflet 1.9.4 + OSM**. `proj4` handles EPSG:25832 ↔ WGS84. **Proj4Leaflet is not needed**, because the base map stays Web Mercator. The camera is a rotated marker, and the frustum footprint is an `L.polygon`.
- **Point clouds (phase 2):** **PotreeConverter 2.1.5 → potree-core 2.0.17**, or the new `PotreePlugin` in 3DTilesRendererJS. Only the focus areas get points; for whole-area "forest on/off", use a CHM raster.
- **Hosting:** Vite 8 + TypeScript. Static tiles go in `public/`. GitHub Pages (≤ 1 GB) is fine for a 5×5 km AOI, but 10×10 km with orthophotos is borderline. PMTiles archives or object storage are the escape hatch.
- **Alternative to spike first:** **Giro3D 2.0.6** (three.js-based, native arbitrary CRS, COG elevation + hillshading, COPC). It is the best batteries-included option if the custom engine turns out to be too much work.

---

## 1. Rendering options

### 1.1 Comparison table

Legend: ✅ good fit · ⚠️ possible with caveats · ❌ poor fit

| Option (version, date) | three.js? | Native CRS / frame | 1 m DTM over ~100 km² | Custom relief shaders (hillshade/SVF/slope) | Free flight | Point clouds | Verdict |
|---|---|---|---|---|---|---|---|
| **Custom three.js heightmap terrain** (three r187, 2026-10-30) — chunked quadtree / CDLOD, `ShaderMaterial` with vertex-texture displacement | ✅ native | ✅ any: we choose local UTM-32N metres | ✅ easy at this size: ~400 chunks of 512 m at LOD0, most never loaded at once | ✅ **full control**: per-pixel normals, live sun, slope, local relief, blending of precomputed SVF/SLRM | ✅ any controls | ⚠️ add potree-core / copc.js | **Recommended core** |
| **3DTilesRendererJS** `3d-tiles-renderer` 0.5.3 (2026-09-18) | ✅ native | ⚠️ tiling is XYZ/Web-Mercator (Terrain-RGB/Terrarium) or WGS84 (quantized-mesh); `projection:'source'` gives a planar display | ✅ LOD/streaming done for you (`TerrariumMeshPlugin`, `TerrainRGBMeshPlugin`, `QuantizedMeshPlugin`) | ⚠️ ships `TerrainLambertMaterial`/`TerrainBasicMaterial` with GPU displacement; custom shaders need material swap / `onBeforeCompile` | ✅ `EnvironmentControls`, or any of your own | ✅ new `PotreePlugin` (Potree v1 `cloud.js` + v2 `metadata.json`, EDL), 3D Tiles `pnts` | **Strong plan B / helper**: reuse its point-cloud and overlay plugins |
| **Giro3D** `@giro3d/giro3d` 2.0.6 (2026-10-28), Oslandia; peer `three ^0.180`, `ol ~10.8`, `proj4` | ✅ built on three | ✅ **arbitrary projected CRS** via proj4 (EPSG:25832 OK) | ✅ `Map` + `ElevationLayer` from COG/GeoTIFF, tiled LOD | ⚠️ built-in hillshading, contour lines, colour ramps; arbitrary GLSL is harder. Precomputed SVF can be added as a `ColorLayer` | ⚠️ first-person and camera-controls examples; flight is up to you | ✅ COPC, LAS/LAZ, 3D Tiles, classification, EDL | **Best batteries-included alternative.** Worth a 1-day spike |
| **iTowns** 2.46.0 (2025-10-03); peer `three ^0.174` | ✅ built on three | ✅ PlanarView with proj4 CRS | ✅ | ⚠️ like Giro3D, but older and less flexible | ⚠️ | ✅ Potree/Entwine/COPC sources | ❌ Giro3D (an iTowns fork) is more active |
| **Potree** 1.8.2 (2023-12) | ⚠️ own app on old three | n/a | n/a | ❌ terrain not its job | ✅ fly mode | ✅ reference viewer | ❌ as a library; use its converter only |
| **potree-core** 2.0.17 (2026-10-26) | ✅ library, `three >0.125` | point coords plus offset | n/a | n/a | n/a | ✅ Potree v1/v2 octrees, LOD by point budget | ✅ **for phase-2 point clouds** |
| **copc.js** `copc` 0.0.9 (2026-08-10) | reader only | LAS header CRS | n/a | n/a | n/a | ⚠️ low-level reader (hierarchy + LAZ decode via laz-perf); you build the octree LOD renderer yourself | ⚠️ only if COPC is a hard requirement |
| **three-geo** 1.4.5 (2022-06) | ✅ | Mapbox/WGS84 | ❌ downloads Mapbox tiles, unmaintained | ❌ | — | ❌ | ❌ |
| **deck.gl TerrainLayer** 9.4.1 | ❌ luma.gl | Web Mercator | ✅ Terrain-RGB + martini meshing | ⚠️ shader injection possible | ⚠️ `FirstPersonView` | ✅ PointCloudLayer | ❌ map-centric, no three ecosystem |
| **CesiumJS** 1.146.0 (2026-10-01) | ❌ | globe, quantized-mesh in EPSG:4326 | ✅ via quantized-mesh (cesium-terrain-builder, CTOD) | ⚠️ globe `Material` (elevation/slope ramps); no arbitrary terrain shader. Relief is usually draped as imagery | ✅ | ✅ 3D Tiles | ⚠️ solid non-three fallback; heavy, little shader freedom on terrain |
| **MapLibre GL JS** 6.16.0 (2026-10-25) | ❌ (custom layer can host three) | Web Mercator | ✅ raster-dem terrain + hillshade layer | ⚠️ fixed hillshade styles | ❌ map camera, pitch-limited; not a fly-through camera | ❌ | ❌ for 3D. Possible replacement for Leaflet (see §3.4) |

### 1.2 Why a custom three.js terrain fits best here

1. **Small, static, single-CRS dataset.** 5×5 km to 10×10 km at 1 m is 25–100 M height samples. That is small enough for a simple fixed-grid quadtree. The generic streaming that global engines provide (ellipsoid, WGS84 tiling, geoid) is mostly overhead here, and it also forces resampling of the 1 m UTM grid into Web Mercator or WGS84 tiles.
2. **Relief detection is a shader problem.** The archaeological value is in per-pixel lighting and derivatives. The geometry carries the coarse shape, and the 1 m (or 0.5 m) height **texture** carries the detail:
   - The vertex shader displaces a coarse grid (for example 128² per chunk) using the LOD's height texture.
   - The fragment shader `texelFetch`es the full-res heights for central-difference normals. That gives hillshade with a live sun azimuth and elevation, multi-directional hillshade, slope, curvature, and a cheap **local relief** (`h_LOD0 − h_LOD3`, roughly an SLRM with an ~8–16 m kernel).
   - Expensive, neighbourhood-heavy visualizations (SVF, positive/negative openness, MSRM, VAT blend) are precomputed with RVT and sampled as textures.
3. **Exact alignment with source data and Leaflet.** We work in UTM metres and convert to lat/lon with proj4 only for the map. No Web-Mercator scale factor (×1.53 at 49.3° N) creeps into the 3D geometry.
4. **Full freedom for flight controls** and terrain-following (the CPU keeps decoded height arrays).

Borrow from the ecosystem rather than re-invent:
- 3DTilesRendererJS has plugins worth stealing or reusing: Potree, PMTiles/WMS/WMTS image sources, MVT, `SkirtedPlaneGeometry`, and an LRU cache.
- Use `three-mesh-bvh` for fast raycasts if needed.

### 1.3 Key implementation notes (custom terrain)

- **World frame:** `x = E − E0`, `y = H`, `z = −(N − N0)`. (E0, N0) is the AOI centre, roughly E ≈ 380 000, N ≈ 5 465 000 for Homburg (approximate). Raw UTM coordinates in float32 jitter at about the 0.5 m level, so a local origin is mandatory.
- **Grid north vs true north:** UTM grid convergence at lon ≈ 7.35° is about −1.25° (Δλ·sin φ). Account for it when drawing camera heading on Leaflet, or just compute the heading from two projected points.
- **Chunk grid:** tile = 256 cells + 1-cell apron on each side (258² samples). LOD k uses 2^k m cells, so a tile covers 256·2^k m. Use LOD 0–5 (1 m → 32 m; the coarsest LOD covers 8 km per tile). Select tiles with a quadtree by screen-space error or distance. Hide cracks with **skirts** (simple) or CDLOD morphing (prettier).
- **Height texture precision:**
  - Do **not** use half-float. At 256–512 m the float16 step is 0.25 m, which destroys cm-scale relief.
  - Use the RGB8 Terrarium texture with `NearestFilter` and decode in the shader (`h = (r·256 + g + b/256) − 32768`, with r,g,b in 0..255), with manual bilinear interpolation.
  - Alternatively, decode on the CPU into a `R32F` `DataTexture`. Float32 linear filtering (`OES_texture_float_linear`) is not guaranteed on mobile, so use manual bilinear interpolation there too.
- **Image decoding:**
  - Browsers decode **16-bit PNGs down to 8 bit** in `<img>`/canvas, so 16-bit grayscale PNG heightmaps need a JS decoder (`fast-png` 8.0.0). That is a reason to prefer Terrarium RGB PNGs or raw binary.
  - Decode Terrarium with `createImageBitmap(blob, {colorSpaceConversion:'none', premultiplyAlpha:'none'})` in a Web Worker. Store **RGB without alpha**.
- **Renderer:** use `WebGLRenderer` + GLSL `ShaderMaterial` / `onBeforeCompile`. `WebGPURenderer` needs TSL node materials, and potree-core / 3DTilesRendererJS materials are WebGL-based. Revisit WebGPU later.
- **Performance targets (integrated GPU, 60 fps):**
  - ≤ ~300 draw calls, ≤ ~2–4 M triangles, ≤ ~500 MB GPU memory.
  - LRU-evict tile textures. One 258² Terrarium RGB texture is about 0.2 MB of GPU memory, so 400 resident tiles cost about 80 MB.
  - Use logarithmic depth or a tight near/far (near ≈ 0.5 m when low, scaled with height above ground).

---

## 2. Data pipeline

### 2.1 Tool overview

| Tool | Version (2026-11-01) | Use |
|---|---|---|
| **GDAL** (`gdalbuildvrt`, `gdal_translate`, `gdalwarp`, `gdaldem`, `gdal2tiles.py`, new `gdal` CLI incl. `gdal raster tile` since 3.12) | 3.13.3 (2026-08-18) | Mosaic, crop, COG, hillshade/slope, XYZ tiles for Leaflet |
| **PDAL** (+ `python-pdal`) | 2.10.2 (2026-06-12) | LAZ → ground filter (`filters.smrf`/`filters.csf`), DTM/DSM/CHM (`writers.gdal`), COPC (`writers.copc`), thinning |
| **rvt-py** (Relief Visualization Toolbox) | 2.2.3 (2025-07-04) | SVF, anisotropic SVF, openness ±, SLRM, MSRM, multi-dir hillshade, VAT blends |
| **rasterio** / **rio-tiler** / **morecantile** | 1.5.2 / 9.4.12 / 7.1.0 | Python windowed reads, custom tiling, mercator tiles |
| **numpy**, **Pillow** | 2.5.4 / current | Terrarium encoding, PNG/WebP output |
| **PotreeConverter** | 2.1.5 (2026-09-23) | LAZ → Potree 2 octree |
| **py3dtiles** | 12.1.1 (2026-03-20) | LAS/LAZ → 3D Tiles `pnts`, if going the 3D Tiles route |
| **cesium-terrain-builder** / **CTOD** | CTB unmaintained / CTOD 1.0.1 (2024-08) | Quantized-mesh. Only needed for Cesium/QuantizedMeshPlugin; **not recommended** here |
| **go-pmtiles** / **pmtiles** (py) | 1.31.2 / 3.8.1 | Pack tile directories into single range-readable archives |
| **citygml-tools** / **cjio** | 2.5.0 (2026-04) / 0.10.1 | LoD2 CityGML → CityJSON → glb |
| **osmium** (py) / Overpass API / osmtogeojson | 4.3.2 / — / 3.0.0-beta.5 | OSM extracts → GeoJSON |

**Environment:** GDAL and PDAL are not installed on this Mac, but Docker and Node 24.19 are. Recommended: one `pipeline/Dockerfile` based on `mambaorg/micromamba`, with everything from conda-forge so GDAL and PDAL ABIs match:

```dockerfile
FROM mambaorg/micromamba:2-debian12-slim
RUN micromamba install -y -n base -c conda-forge \
      python=3.12 gdal=3.13 pdal=2.10 python-pdal rasterio numpy scipy pillow pyproj \
 && micromamba clean -a -y
RUN /opt/conda/bin/pip install rvt-py==2.2.3 rio-tiler morecantile pmtiles
WORKDIR /work
```
Run it with `docker run --rm -v "$PWD":/work saar-pipe python pipeline/build.py --aoi aoi.geojson` and orchestrate with a `Makefile` (one target per stage, file-based caching). Alternatives: the official `ghcr.io/osgeo/gdal` images plus a separate `pdal/pdal` image (verify tag names).

### 2.2 Recommended pipeline steps

```
raw/ (downloads, gitignored)   work/ (intermediate, gitignored)   web/public/data/ (published)
```

**Step 1: DTM mosaic (DGM1 GeoTIFF or XYZ, EPSG:25832, DHHN2016 heights)**
```bash
# If delivered as ASCII XYZ: convert each tile (GDAL XYZ driver needs regularly spaced, sorted points)
for f in raw/dgm1/*.xyz; do
  gdal_translate -a_srs EPSG:25832 -co COMPRESS=DEFLATE -co PREDICTOR=3 -ot Float32 \
    "$f" "work/dgm1/$(basename "${f%.*}").tif"
done
gdalbuildvrt -a_srs EPSG:25832 work/dgm1.vrt work/dgm1/*.tif
gdalinfo work/dgm1.vrt   # CHECK pixel alignment: corner at integer or .5 m?

# Crop to AOI on the native grid (no resampling!) and write a COG
gdal_translate -projwin 375000 5470000 385000 5460000 -of COG \
  -co COMPRESS=DEFLATE -co PREDICTOR=3 -co OVERVIEW_RESAMPLING=AVERAGE \
  work/dgm1.vrt work/dtm_aoi.tif
gdal_fillnodata -md 10 work/dtm_aoi.tif work/dtm_filled.tif   # only if gaps
```
(The AOI coordinates are placeholders. Derive them from `aoi.geojson`.)

**Step 1b (optional): own DTM/CHM from classified LAZ.** This gives a 0.5 m DTM if the point density allows, plus a canopy height model.
```json
{ "pipeline": [
  "raw/laz/tile_123.laz",
  { "type": "filters.range", "limits": "Classification[2:2]" },
  { "type": "writers.gdal", "filename": "work/dtm_050.tif", "resolution": 0.5,
    "output_type": "idw", "window_size": 3, "data_type": "float32", "nodata": -9999 }
]}
```
- If the data is **not** classified: `filters.assign` ("Classification = 0") → `filters.outlier` → `filters.smrf` (or `filters.csf`) → range on class 2.
- CHM: `filters.hag_nn` → `writers.gdal` with `"dimension": "HeightAboveGround", "output_type": "max"`.
- Generate the per-tile pipelines from Python (`python-pdal`), or merge first.

**Step 1c (optional): point cloud for focus areas** (Schloss Karlsberg, Kirrberg):
```bash
pdal translate raw/laz/karlsberg.laz work/karlsberg.copc.laz \
  --filter filters.range --filters.range.limits="Classification![7:7],Classification![18:18]"
#  (writers.copc is inferred from .copc.laz; add filters.voxeldownsize to thin)
PotreeConverter work/karlsberg.copc.laz -o web/public/data/pc/karlsberg   # Potree 2 format
```

**Step 2: relief visualizations (RVT + gdaldem)**
```bash
gdaldem hillshade -multidirectional -compute_edges work/dtm_filled.tif work/hs_multi.tif
gdaldem slope -compute_edges work/dtm_filled.tif work/slope.tif
```
```python
import rvt.default, rvt.vis, numpy as np
d = rvt.default.get_raster_arr("work/dtm_filled.tif"); dem, nd = d["array"], d["no_data"]
svf = rvt.vis.sky_view_factor(dem=dem, resolution=1.0, compute_svf=True, compute_asvf=False,
                              compute_opns=True, svf_n_dir=16, svf_r_max=10, svf_noise=0, no_data=nd)
slrm = rvt.vis.slrm(dem=dem, radius_cell=20, ve_factor=1, no_data=nd)
msrm = rvt.vis.msrm(dem=dem, resolution=1.0, feature_min=1, feature_max=20, scaling_factor=2, ve_factor=1, no_data=nd)
rvt.default.save_raster(src_raster_path="work/dtm_filled.tif", out_raster_path="work/svf.tif",
                        out_raster_arr=svf["svf"], no_data=np.nan, e_type=6)
# … openness ("opns"), slrm, msrm likewise; VAT via rvt.blend (see 03-archaeology-visualization.md)
```
Then stretch each layer to **8-bit** with fixed, documented percentiles (`gdal_translate -ot Byte -scale a b 0 255`) so the shader can blend them consistently.

**Step 3: 3D chunk pyramid (custom script `pipeline/make_chunks.py`)**
- For LOD k = 0..5: downsample the **float** DTM by 2×2 averaging. Never resample already-encoded RGB bytes.
- Cut 256-cell tiles with a 1-cell apron on the UTM grid. Write:
  - `dtm/{k}/{i}/{j}.png`: Terrarium RGB, 8-bit, no alpha, precision 1/256 m ≈ 4 mm
  - `svf|slrm|msrm|hs/{k}/{i}/{j}.webp`: 8-bit gray, lossy q≈85 (or lossless for LOD0)
  - `manifest.json`: `{crs:"EPSG:25832", origin:[E0,N0], tileCells:256, apron:1, levels:[…], bounds, heightRange, layers:{…}, attribution}`

```python
def terrarium(h):                       # h: float32 metres
    v = h.astype(np.float64) + 32768.0
    r = np.floor(v / 256); g = np.floor(v - r * 256); b = np.floor((v - r * 256 - g) * 256)
    return np.dstack([r, g, b]).astype(np.uint8)
```
*Why Terrarium over Mapbox Terrain-RGB:*
- Terrain-RGB's standard decoding (`−10000 + (R·65536+G·256+B)·0.1`) quantizes to **0.1 m**, which causes visible terracing in hillshade at 1 m.
- Terrarium gives ~4 mm and is natively supported by 3DTilesRendererJS's `TerrariumMeshPlugin`, which keeps plan B open.
- The alternative is raw `Uint16` binary (`h = base + v·0.01`). But GitHub Pages does not reliably compress `.bin` files, whereas PNG is self-compressed.

**Step 4: 2D overlay tiles for Leaflet (EPSG:3857 XYZ)**
```bash
gdal2tiles.py --xyz -z 12-17 -r average -w none --tiledriver=WEBP --processes=8 \
  work/svf_8bit.tif web/public/data/xyz/svf          # reprojects to Web Mercator itself
# GDAL ≥3.12 alternative (C++ port of gdal2tiles, 3–6× faster): gdal raster tile … (check `gdal raster tile --help`)
```
z17 ≈ 0.78 m/px at 49.3° N, which matches the 1 m data. Set Leaflet `maxNativeZoom: 17`, `maxZoom: 19`.

**Step 5: OSM + buildings** (see §6). Pre-fetch once into `web/public/data/osm/*.geojson`. Do not hit Overpass at runtime.

**Step 6 (optional): pack** large tile trees into `.pmtiles` (`pmtiles convert x.mbtiles x.pmtiles`, or write MBTiles directly with `gdal_translate -of MBTILES` + `gdaladdo`). This avoids tens of thousands of small files in git. Leaflet reads them via the `pmtiles` lib, and 3DTilesRendererJS has a `PMTilesImageSource`.

### 2.3 Why not quantized-mesh / 3D Tiles terrain?
- **Quantized-mesh** (cesium-terrain-builder, CTOD, `QuantizedMeshPlugin`):
  - It is a TIN format tiled in EPSG:4326, so 1 m UTM data must be reprojected.
  - Per-vertex normals at mesh resolution lose the per-pixel relief that matters for archaeology.
  - CTB is unmaintained, and CTOD is a server, not a static export.
- **3D Tiles** (py3dtiles): fine for point clouds and buildings, but overkill for a 2.5D heightfield.

---

## 3. Leaflet integration

### 3.1 Projections
- Leaflet's default CRS (EPSG:3857) is kept, so the OSM tiles work unchanged. Only **proj4** is needed:
  ```ts
  proj4.defs('EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
  const [lon, lat] = proj4('EPSG:25832', 'EPSG:4326', [E, N]);
  const [E2, N2]   = proj4('EPSG:4326', 'EPSG:25832', [latlng.lng, latlng.lat]);
  ```
- **Proj4Leaflet (1.0.2, last release 2022)** is only needed if the *Leaflet map itself* should run in EPSG:25832, for example with a UTM-only Saarland WMTS. Most WMS services can deliver EPSG:3857 via `L.tileLayer.wms`, so skip Proj4Leaflet.

### 3.2 Layers
- **OSM standard tiles:** `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. Attribution and the OSM tile usage policy apply. That is fine for a hobby project, but no prefetching or bulk use.
- Our **relief XYZ overlays** (SVF / hillshade / SLRM), switchable with an `L.control.layers` plus an opacity slider.
- Saarland **DOP / DGM WMS** directly as `L.tileLayer.wms` (verify endpoint and licence in 01-data-sources).
- An AOI rectangle and POI markers (bunkers, finds), which share a GeoJSON with the 3D scene.

### 3.3 Camera ↔ map sync
- **3D → map** (throttle to ~10 Hz):
  - Camera marker: position = proj4(origin + camera.xz). Rotation = heading, using a `divIcon` with CSS `rotate()` or `leaflet-rotate` 0.5.2 (supports Leaflet 1.9 and 2.0-alpha).
  - **Frustum footprint:**
    - Cast the 4 corner rays plus a few edge rays of the camera frustum, using `camera.projectionMatrixInverse`.
    - Intersect each ray with the terrain (CPU heightfield ray-march), or with a plane at the local ground height. Clamp the far distance to about 2–5 km so near-horizontal rays stay finite.
    - Convert the hits to lat/lon and draw an `L.polygon`, plus an `L.polyline` for the view direction.
  - Optional "follow camera" mode uses `map.panTo` and only re-centres when the marker leaves the inner 60 % of the view.
- **Map → 3D:**
  - `map.on('click')`: convert lat/lon to E/N, look up the ground height from the CPU height cache, and fly the camera there with an eased tween.
  - Target: 150 m above ground, looking down at 45°, keeping the current heading.
  - Show a "fly-to" ring in 3D.
- **Shared state:** a tiny observable store, e.g. `{ camE, camN, camH, heading, pitch, fovFootprint }`. Both views subscribe, which avoids feedback loops.

### 3.4 Leaflet vs MapLibre
Keep **Leaflet 1.9.4** (the latest stable; **Leaflet 2.0 is still alpha**: 2.0.0-alpha.1, 2025-08). Map rotation and vector-tile styling are MapLibre's only real advantages, and neither is needed: the 3D view is the main view, and the map is for orientation. If 2.0 goes stable during the project, migrating is easy, since only a few APIs are used.

---

## 4. Flight controls

| Option | Notes | Use |
|---|---|---|
| `FlyControls` (three/examples) | 6-DoF incl. roll, mouse-drag look. Feels like space flight, has no "up" | ❌ as-is |
| `PointerLockControls` | Mouse-look only; you add movement. Pointer lock needs a user click and `Esc` exits | ✅ base for **drone mode** |
| `OrbitControls` / `MapControls` / `camera-controls` 3.1.2 | Orbit or inspect around a point; smooth transitions (`setLookAt`, `fitToBox`) | ✅ **inspect mode** (double-click a feature → orbit it) |
| 3DTilesRendererJS `EnvironmentControls` | Drag-pan, zoom-to-cursor on terrain, inertia | ⚠️ nice "map-like" mode |

**Recommended custom `DroneController`** (about 200 lines of TS):
- Mouse-look via pointer lock: yaw around world Y, pitch clamped to ±89°, no roll. In the "plane" variant, roll comes from the turn rate (cosmetic).
- Movement keys:
  - WASD: horizontal movement in the heading frame.
  - Space/E: up; Shift/Q: down.
  - Mouse wheel: speed in exponential steps (×1.25), over a range of 2–500 m/s.
- **Speed scales with height above ground (AGL)**: `v = base · clamp(AGL/50, 0.2, 20)`. This feels natural from 5 m to 2000 m.
- **Terrain following / collision:**
  - Bilinear-sample the CPU height cache at the camera's x/z.
  - Enforce a minimum clearance of 2 m.
  - Optional "AGL hold" mode keeps a constant height above ground (smoothed with a critically damped spring), which is great for scanning forest floors.
- **Gamepad API** (`navigator.getGamepads()` polled each frame, standard mapping): left stick moves, right stick looks, triggers (buttons 6/7) go down/up, bumpers change speed. Use a 0.15 deadzone.
- **Bookmarks:** save and restore camera poses in the URL hash, e.g. `#E,N,H,heading,pitch`. Shareable links also make a good debug tool.
- **Timing:** use `THREE.Timer` (the older `Clock` is reportedly deprecated since r183) and clamp `dt` to ≤ 0.1 s.

---

## 5. Project setup

```
saar-lidar-explorer/
├─ PRD.md, research/
├─ pipeline/            Dockerfile, Makefile, build.py, make_chunks.py, rvt_layers.py, osm_fetch.py, aoi.geojson
├─ data/raw|work/       (gitignored)
└─ web/                 Vite + TS app
   ├─ src/terrain/      QuadTree.ts, TerrainTile.ts, TileCache.ts, terrain.vert/.frag (GLSL via ?raw)
   ├─ src/controls/     DroneController.ts, Gamepad.ts, InspectMode.ts
   ├─ src/map/          LeafletMap.ts, Frustum.ts
   ├─ src/overlays/     OsmLines.ts, Buildings.ts, PointCloud.ts
   ├─ src/state.ts, src/geo.ts (proj4 + origin), src/ui/ (lil-gui)
   └─ public/data/      manifest.json, dtm/, svf/, …, xyz/, osm/, pc/  (generated, possibly git-ignored and deployed by CI)
```
- **Tooling:**
  - `npm create vite@latest web -- --template vanilla-ts`, with Vite 8.3.5 and TypeScript 7.0.2 (fall back to TS 5.9/6.x if any tool chokes on TS 7).
  - Runtime libs: `three@0.187`, `@types/three@0.187`, `leaflet@1.9.4`, `@types/leaflet`, `proj4@2.22`, `lil-gui`, `stats-gl`.
  - Put GLSL in `.glsl` files imported with `?raw`.
- **Workers:** tile fetch and decode in a Web Worker (`new Worker(new URL('./decode.worker.ts', import.meta.url), {type:'module'})`).
- **Serving:**
  - Dev: Vite serves `public/`.
  - Prod: `vite build` → `dist/`, with `base: '/saar-lidar-explorer/'` for GitHub Pages. Deploy via a GitHub Actions Pages workflow, which avoids the 10-builds/hour soft limit.
- **GitHub Pages limits:** published site ≤ 1 GB, repo recommended ≤ 1 GB, 100 GB/month soft bandwidth, 10-minute deploy timeout.

**Size budgets (estimates):**

| Asset | 5×5 km | 10×10 km |
|---|---|---|
| DTM Terrarium pyramid (≈1.5 B/px × 1.33) | ~50 MB | ~200 MB |
| Each 8-bit relief layer, WebP pyramid (SVF, SLRM, hillshade, …) | ~8–15 MB | ~35–60 MB |
| Leaflet XYZ overlays (3 layers, z12–17) | ~30 MB | ~120 MB |
| DOP orthophoto resampled to 0.5 m, JPEG/WebP | ~30–50 MB | ~120–200 MB |
| OSM GeoJSON + LoD2 glb | ~5–20 MB | ~20–60 MB |
| Point cloud (focus areas only) | 50–300 MB | (only focus areas) |
| **Total** | **~0.2–0.5 GB ✅** | **~0.6–1.2 GB ⚠️** |

Beyond about 1 GB, host the data on Cloudflare R2, S3 or Hetzner object storage with CORS, keep only the app on Pages, or run locally (`npx vite preview` / any static server). Runtime target for a first view: < 10 MB to first interactive frame (coarse LODs plus the visible tiles).

---

## 6. OSM vectors and buildings in 3D

**Fetch once (build time):**
```
[out:json][timeout:90];
( way["highway"](49.28,7.30,49.36,7.42);  way["building"](49.28,7.30,49.36,7.42);
  way["waterway"](49.28,7.30,49.36,7.42); way["railway"](49.28,7.30,49.36,7.42);
  way["historic"](49.28,7.30,49.36,7.42); node["historic"](49.28,7.30,49.36,7.42); );
out body; >; out skel qt;
```
(The bbox is approximate for Homburg/Kirrberg/Karlsberg; derive it from `aoi.geojson`.) Convert with `osmtogeojson` (3.0.0-beta.5 is the "latest" tag), or use `osmium`/Python, then project to EPSG:25832 in the pipeline.

**Streets / paths / water (draping):**
1. **Recommended: the vertex shader samples the same height texture** as the terrain. Densify lines to ≤ 2 m segments, then use `Line2`/`LineMaterial` (fat lines) or flat ribbon meshes. Each vertex reads the terrain height (+0.3 m) in the vertex shader, so the lines match the terrain exactly at every LOD.
2. Simpler: sample heights on the CPU from the cache when a tile loads, and use `polygonOffset` against z-fighting.
3. Most robust visually: **rasterize roads into the terrain texture**, either per chunk at runtime (OffscreenCanvas) or in the pipeline (`gdal_rasterize`). There is no z-fighting at all, but roads lose crisp edges when viewed from close up.

Toggle "historic=*" features (OSM already maps some bunkers and ruins) as POIs. Showing them is useful *ground truth* for relief interpretation.

**Buildings:**
- **OSM fallback:**
  - Extrude footprints (`ExtrudeGeometry`). The base sits at the min terrain height under the footprint.
  - Height comes from `height`, or `building:levels × 3 m`, or 8 m by default.
  - Merge the buildings of each chunk into a single geometry with `BufferGeometryUtils.mergeGeometries`.
- **LoD2 (if Saarland provides open CityGML):**
  - `citygml-tools to-cityjson *.gml` (2.5.0, Docker), then `cjio in.city.json export glb out.glb` (`pip install 'cjio[export]'`). Keep EPSG:25832 and subtract the origin in three.js.
  - LoD2 heights are DHHN2016 like DGM1, so they are consistent.
  - For large areas, convert to 3D Tiles and load with 3DTilesRendererJS. Commercial or alternative routes: FME, or 3DCityDB → 3D Tiles.
- Make buildings semi-transparent or hideable. The bare-earth view is the primary one.

**Canopy / "forest on" view:**
- Cheapest: a CHM/nDSM heightfield (DSM − DTM), rendered as a translucent green second surface or as instanced point sprites.
- Best looking: the real classified point cloud (classes 3–5) for focus areas.

---

## 7. Recommended architecture

```
                         ┌──────────────────────── BUILD TIME (Docker: GDAL 3.13 · PDAL 2.10 · rvt-py) ───────────────────────┐
 Saarland Open Data      │                                                                                                    │
 DGM1 (GeoTIFF/XYZ) ───► │ gdalbuildvrt → gdal_translate -projwin (COG, EPSG:25832) ──┬─► make_chunks.py ─► dtm/{k}/{i}/{j}.png    │
 LAZ (classified) ─────► │ PDAL: range/smrf → writers.gdal (DTM 0.5m, CHM) ──────────┤    (Terrarium, UTM grid, apron)         │
                         │ PDAL writers.copc / PotreeConverter ──────────────────────┼─► pc/<area>/ (Potree2)                 │
 DOP (WMS/download) ───► │ gdalwarp/translate → 0.5 m JPEG chunks ───────────────────┤                                        │
 LoD2 CityGML ─────────► │ citygml-tools → cjio export glb ─────────────────────────┤─► buildings/*.glb                      │
 OSM (Overpass) ───────► │ osmtogeojson → proj 25832 → densify ─────────────────────┤─► osm/*.geojson                        │
                         │ rvt-py: SVF/openness/SLRM/MSRM/VAT · gdaldem hillshade ───┴─► relief/{layer}/{k}/{i}/{j}.webp        │
                         │                                      └─ gdal2tiles (EPSG:3857) ─► xyz/{layer}/{z}/{x}/{y}.webp        │
                         │                                                                  manifest.json                       │
                         └───────────────────────────────────────────────────────────────────────┬────────────────────────────┘
                                                                                                 │ static files (Pages / R2 / local)
 ┌──────────────────────────────────────── BROWSER (Vite + TS) ──────────────────────────────────▼──────────────────────────────┐
 │  geo.ts (proj4: EPSG:25832 ⇄ 4326, local origin E0/N0)         state.ts (observable camera/UI state, URL hash)              │
 │        ▲                                                         ▲          │                                                │
 │  ┌─────┴──────────────── three.js r187 (WebGLRenderer) ─────────┴───┐      │      ┌──────── Leaflet 1.9.4 ─────────────┐    │
 │  │ TerrainQuadTree ── TileCache(LRU) ◄── decode.worker (Terrarium)  │      ├─────►│ OSM base · relief XYZ overlays     │    │
 │  │   └ TerrainMaterial (GLSL): VTF displacement, per-pixel normals, │      │      │ DOP WMS · POIs · AOI                │    │
 │  │     live hillshade/slope/local-relief, blend SVF/SLRM/MSRM/DOP   │      │      │ camera marker + frustum polygon    │    │
 │  │ Overlays: draped OSM lines (VTF) · buildings glb · CHM / potree  │      │      │ click → flyTo(E,N)  ───────────────┼──┐ │
 │  │ Controls: DroneController (pointer-lock, AGL, gamepad) ·         │◄─────┘      └────────────────────────────────────┘  │ │
 │  │           InspectMode (camera-controls) · flyTo tween            │◄────────────────────────────────────────────────────┘ │
 │  │ HeightQuery (CPU cache) → terrain following, frustum ground hits │      lil-gui: layer toggles, sun az/el, exaggeration     │
 │  └──────────────────────────────────────────────────────────────────┘                                                         │
 └───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Suggested build order (MVP first):**
1. The pipeline produces the DTM chunks + manifest for a 2×2 km test area.
2. three.js renders a single LOD with a hillshade shader, plus the DroneController.
3. Leaflet sync (marker, frustum, click-to-fly).
4. Quadtree LOD + worker decoding.
5. RVT layers + layer UI.
6. OSM lines/buildings.
7. DOP draping.
8. CHM / point clouds for Karlsberg.
9. Deploy.

---

## 8. Library list with versions

Checked 2026-11-01 via the npm / PyPI registries and GitHub releases.

| Library | Version | Released | Role | Notes |
|---|---|---|---|---|
| three | 0.187.0 (r187) | 2026-10-30 | 3D engine | r186 2026-09-24, r185 2026-07-01 |
| @types/three | 0.187.0 | 2026-10-30 | types | |
| three-mesh-bvh | 0.9.17 | 2026-10 | fast raycast (optional) | |
| camera-controls | 3.1.2 | 2025-11-17 | inspect/orbit mode | |
| 3d-tiles-renderer | 0.5.3 | 2026-09-18 | optional: Potree/terrain/overlay plugins | peer `three >=0.167`. 0.5.2 added Terrain-RGB/Terrarium mesh plugins; 0.5.3 added the `projection` option |
| potree-core | 2.0.17 | 2026-10-26 | point clouds | peer `three >0.125` |
| copc (copc.js) | 0.0.9 | 2026-08-10 | COPC reader (alt.) | |
| @giro3d/giro3d | 2.0.6 | 2026-10-28 | alternative engine | peer `three ^0.180`, `ol ~10.8`, `proj4 ^2.19` |
| itowns | 2.46.0 | 2025-10-03 | (not recommended) | peer `three ^0.174` |
| leaflet | 1.9.4 | 2023-05-18 | 2D map | 2.0.0-alpha.1 (2025-08) is not stable |
| @types/leaflet | 1.9.22 | 2026-08 | types | |
| leaflet-rotate | 0.5.2 | 2026-10-29 | optional map rotation | peer leaflet ^1.9.3 or ^2.0.0-alpha.1 |
| proj4 | 2.22.0 | 2026 | CRS transforms | |
| proj4leaflet | 1.0.2 | 2022 | **not needed** | |
| pmtiles | 4.5.0 | 2026-08-10 | optional single-file tiles | |
| fast-png | 8.0.0 | 2025-12 | only if using 16-bit PNG | |
| osmtogeojson | 3.0.0-beta.5 | 2022 | OSM → GeoJSON (build time) | |
| @turf/turf | 7.4.0 | 2026-08 | densify/clip helpers (optional) | |
| lil-gui / stats-gl | 0.21.0 / 4.2.3 | — | debug UI / perf | |
| vite | 8.3.5 | 2026 | build/dev server | |
| typescript | 7.0.2 | 2026 | language | fall back to 5.9/6.x if tooling breaks |
| *Not used:* cesium 1.146.0 · maplibre-gl 6.16.0 · @deck.gl/geo-layers 9.4.1 · three-geo 1.4.5 | | | | |
| **Pipeline** | | | | |
| GDAL | 3.13.3 | 2026-08-18 | raster processing | `gdal raster tile` since 3.12 |
| PDAL | 2.10.2 | 2026-06-12 | point cloud processing | |
| rvt-py | 2.2.3 | 2025-07-04 | SVF/openness/SLRM/MSRM | |
| rasterio · rio-tiler · morecantile | 1.5.2 · 9.4.12 · 7.1.0 | 2026 | Python raster/tiling | |
| numpy | 2.5.4 | 2026-10 | | |
| PotreeConverter | 2.1.5 | 2026-09-23 | LAZ → Potree 2 | |
| py3dtiles | 12.1.1 | 2026-03-20 | optional 3D Tiles | |
| citygml-tools · cjio | 2.5.0 · 0.10.1 | 2026-04 · 2025-05 | LoD2 → glb | |
| go-pmtiles | 1.31.2 | 2026-07-22 | tile packing | |
| osmium (py) | 4.3.2 | 2026-10 | OSM processing (alt.) | |

---

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Height quantization** (Terrain-RGB at 0.1 m, half-float textures, 8-bit 16-bit-PNG decode) | Terracing that hides or fakes relicts | Terrarium (4 mm) or raw Uint16 at 1 cm; float32 / RGB8 on the GPU; worker decoding with `colorSpaceConversion:'none'` |
| **Resampling** the 1 m grid (half-pixel shifts, Web-Mercator warps for the 3D data) | Blur, loss of subtle features | Crop on the native grid; keep 3D data in UTM; only the Leaflet overlays are warped |
| **Float precision** with UTM coordinates (≈380 000 / 5 465 000) | Vertex jitter | Local origin; never put raw UTM coordinates into float32 attributes |
| **XYZ ASCII quirks** (sort order, separators, pixel-is-point) for GDAL's XYZ driver | Import fails or shifts by half a pixel | Inspect a tile first; fall back to PDAL `readers.text` + `writers.gdal`, or numpy |
| **Data volume** for 10×10 km + DOP + point clouds vs GitHub Pages 1 GB | Can't deploy | Start with 5×5 km; PMTiles + object storage; point clouds only for focus areas |
| **Custom-engine effort** (quadtree, cracks, caching) | Schedule slip | MVP with a fixed LOD set and skirts. Spike Giro3D or 3DTilesRendererJS `TerrariumMeshPlugin` as plan B |
| **Library churn**: three.js renames (r183 `PostProcessing`→`RenderPipeline`, `Clock`→`Timer`), 3DTilesRendererJS 0.x API changes, Giro3D pinned to three 0.180 | Upgrade breakage | Pin exact versions; keep three-dependent code isolated |
| **Licensing / attribution** (DL-DE BY 2.0 for Saarland geodata, ODbL for OSM, OSM tile policy) | Takedown / non-compliance | Attribution string in the manifest and UI; no bulk use of OSM tiles; cache our own overlays |
| **Overpass rate limits / downtime** | Build fails | Fetch once, commit the GeoJSON; or use a Geofabrik Saarland extract with osmium |
| **LoD2 / LAZ availability for Saarland unverified** | Features 6/8 blocked | OSM building extrusion and a CHM from DOM data as fallbacks |
| **Mobile / low-end GPUs** (vertex texture fetch OK in WebGL2, float-linear not guaranteed) | Artifacts or slowness | Manual bilinear filtering; a quality preset that lowers LOD distance |
| **Pointer-lock UX** (needs a click; browser banners) | Awkward controls | Offer a non-locked drag-look mode too |
| **Archaeological sensitivity**: publishing precise locations of unprotected relicts may invite looting (Raubgrabungen) | Ethical/legal | Keep the hosted version private/local, or blur POIs; check Saarland Denkmalschutz rules |

---

## 10. Uncertain / unverified

- Exact Saarland product formats: DGM1 as GeoTIFF vs XYZ, tile size (1 km?), pixel-is-area vs point, LAZ availability and point density, LoD2 open-data status. The DGM1 2016 laser flight and the DL-DE BY 2.0 licence were seen in GDI-DE metadata; the rest → `01-data-sources.md`.
- Whether 3DTilesRendererJS's `TerrariumMeshPlugin` with `projection:'source'` works well for a small local dataset with `maxZoom` 17–18, and how hard swapping in a custom `ShaderMaterial` is (its materials use `displacementMap` on GPU-displaced skirted planes). Not tested.
- Whether 3DTilesRendererJS `PotreePlugin` is production-ready. It exists in 0.5.3 source (Potree v1/v2, EDL), but its maturity is unknown.
- Giro3D 2.0 changelog and API details. Release notes for 2.0 weren't found, and how easily custom GLSL fits into its terrain material is unknown.
- `gdal raster tile` exact option names (`--min-zoom`/`--max-zoom`/`--format`?). The `gdal2tiles.py` command is the safe fallback.
- The `writers.copc` inference from `.copc.laz` in `pdal translate`, and filter-option syntax on the CLI. Verify with `pdal translate --help`.
- rvt-py `sky_view_factor` keyword set in 2.2.3 (taken from the docs example notebook; `no_data` usage assumed) and its key names in the returned dict (`"svf"`, `"opns"`).
- PotreeConverter 2.x accepting `.copc.laz` input directly (it should, since COPC is valid LAZ, but this is untested).
- TypeScript 7.0 (native compiler) compatibility with Vite 8 plugins and `@types/three`.
- Docker image tag names (`mambaorg/micromamba:2-debian12-slim`, `ghcr.io/osgeo/gdal:*`, `pdal/pdal:*`).
- three.js r183 rename claims (`PostProcessing`→`RenderPipeline`, `Clock` deprecated). These come from secondary sources (utsubo.com blog, mind-verse.de), not the changelog.
- MapLibre GL 6.x maximum pitch / free-camera capabilities (not re-checked; irrelevant if staying with Leaflet).
- Whether GitHub Pages serves Git-LFS objects (assume **no**; don't rely on LFS).
- Size estimates in §5 are back-of-envelope. Measure them on the 2×2 km test area.
- UTM coordinates of the AOI (E0/N0) and the Overpass bbox are approximations.

---

## Sources

- three.js releases: https://github.com/mrdoob/three.js/releases · 2026 changes overview (secondary): https://www.utsubo.com/blog/threejs-2026-what-changed · https://www.mind-verse.de/news/three-js-boom-ki-coding-webgpu-analyse-ed0965d1ad11
- 3DTilesRendererJS: https://github.com/NASA-AMMOS/3DTilesRendererJS · releases: https://github.com/NASA-AMMOS/3DTilesRendererJS/releases · docs: https://gkjohnson.github.io/tools/docs/3d-tiles-renderer.md · QuantizedMeshPlugin: https://gkjohnson.github.io/tools/docs/3d-tiles-renderer/three/plugins/QuantizedMeshPlugin.md · (plugin source inspected from the npm tarball `3d-tiles-renderer@0.5.3`: `src/three/plugins/images/terrain-rgb/*`, `potree/PotreePlugin.*`)
- Giro3D: https://giro3d.org/ · examples: https://giro3d.org/latest/examples/index.html · 1.0 release: https://oslandia.com/en/2025/12/19/sortie-giro3d-v1-0-outil-web-visualisation-opensource/ · 0.41 (COPC): https://oslandia.com/en/2025/01/14/les-nouveautes-giro3d-0-41/
- iTowns: https://github.com/iTowns/itowns · COPC software list: https://copc.io/software.html
- Potree: https://github.com/potree/potree · PotreeConverter: https://github.com/potree/PotreeConverter · potree-core: https://github.com/tentone/potree-core · copc.js: https://github.com/connormanning/copc.js
- CesiumJS Material/terrain shading discussion: https://cesium.com/learn/cesiumjs/ref-doc/Material.html · https://community.cesium.com/t/hillshade-using-cesium-terrain/9590 · quantized-mesh spec: https://github.com/CesiumGS/quantized-mesh · Mercator profile thread: https://community.cesium.com/t/quantized-mesh-terrain-mercator-profile-support/26004
- CTOD: https://github.com/sogelink-research/ctod · https://research.geodan.nl/country-wide-terrain-tiles-on-demand/ · cesium-terrain-builder Docker: https://www.asg.ed.tum.de/en/gis/software/cesium-terrain-builder-docker/
- MapLibre terrain/hillshade: https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/ · https://maplibre.org/maplibre-gl-js/docs/examples/add-a-hillshade-layer/
- GDAL 3.12 release (`gdal raster tile`, new CLI): https://lists.osgeo.org/pipermail/gdal-dev/2025-November/061158.html · https://newreleases.io/project/github/OSGeo/gdal/release/v3.12.0 · GDAL 3.12/3.13 talk: https://talks.osgeo.org/foss4g-europe-2026/talk/9AQJYA/
- PDAL: https://github.com/PDAL/PDAL/releases · https://pdal.io/
- RVT: https://github.com/EarthObservation/rvt_py · https://pypi.org/project/rvt-py · examples: https://rvt-py.readthedocs.io/en/latest/examples/rvt_vis_example.html
- Leaflet releases / 2.0 alpha: https://github.com/Leaflet/Leaflet/releases · https://leafletjs.com/2025/05/18/leaflet-2.0.0-alpha.html
- GitHub Pages limits: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- citygml-tools: https://github.com/citygml4j/citygml-tools · cjio: https://github.com/cityjson/cjio
- Saarland DGM1 metadata (GDI-DE): https://gdk.gdi-de.org/geonetwork/srv/api/records/96b3a5b3-b73b-0002-a9a3-417cb1736fe4 · BKG DGM1 doc: https://sg.geodatenzentrum.de/public/gdz/dokumentation/deu/dgm1.pdf
- Package versions: https://registry.npmjs.org/ and https://pypi.org/ (queried 2026-11-01)
