# S0 Size and traffic spike: result (Orte skalieren)

- **Date:** 2026-11-08 · **Plan:** [orte-skalieren.md](orte-skalieren.md) §5, §8, §9 S0, §10 D6
- **Question:** what does one published municipality cost in bytes and traffic, and what do the §5 levers really bring?
- **Short answer:** today a published AOI costs **≈ 13 MB/km²** of its rectangle (Homburg 13.1, `overall` 13.5,
  without point clouds, candidates and minimap tiles) plus **≈ 7 MB/km²** of Leaflet minimap tiles, which §5 does not
  list. The recommended target format reaches **≈ 5.3–5.5 MB/km²** with no feature lost. A typical session moves
  **≈ 80 MB (open and look around) to ≈ 210 MB (11 km flight)** today and ≈ 30 % less in the target format.
- MB = 10⁶ bytes. Verification shots are in the git-ignored `docs/shots/s0/`. The measuring scripts were throwaway
  and are not committed; each section states the method.

## 1. Homburg, whole municipality

- **Outline:** the 8 Gemarkungen of Homburg (AGS 10045114: Beeden-Schwarzenbach, Bruchhof-Sanddorf, Einöd,
  Erbach-Reiskirchen, Homburg, Jägersburg, Kirrberg, Wörschweiler) from the cached INSPIRE CadastralZoning answer
  (`data/raw/alkis-orte/`), dissolved: **82.6 km²** (official 82.7). Written to `data/work/homburg-gemeinde/outline.geojson`.
- **AOI** `[homburg-gemeinde]` in `pipeline/aois.toml`: bbox = outline bounds snapped outward to 1 km =
  `[374000, 5456000, 385000, 5472000]`, 11 × 16 km = **176 km²**. Data: `app/public/data/homburg-gemeinde/`.
- **Built:** fetch (234 SL + 132 RLP tiles per product, 47 min: slow RLP server, 502s), build (8.3 min, ≈ 15 GB RAM
  peak), osm, buildings (10.5 min), ortho (sequential, 16.6 min), trees, xyz. **Failed for external reasons:**
  `historic` and `cadastre` (Geoportal Saarland `owsproxy` and WFS 414 answered 503 all day). Their sizes below are
  **estimates** at `overall` density. `detect` skipped (private); `pointcloud` not built (opt-in, measured on `overall`).
- **Rectangle waste:** the outline fills only **47 %** of the rectangle. 298 of 704 chunks (42 %) and 56 of 176 1 km
  tiles do not touch the outline; on the real chunks ≈ 42 % of the bytes (dtm 76 of 180 MB, relief 390 of 939 MB,
  ortho 79 of 197 MB) lie in chunks that do not touch Homburg. The chunk presence list of §4.2 removes this. Under the
  ownership rule (largest share) Homburg would own between 82 tiles (≥ 50 % inside) and 120 (touching).

### 1.1 Size per directory (today's format)

| Directory | Homburg MB | MB/km² rectangle (176) | MB/km² municipality (82.6) | `overall` MB/km² (48) |
|---|---|---|---|---|
| relief (10 layers) | 939 | 5.33 | 11.4 | 5.42 |
| dsm | 254 | 1.44 | 3.07 | 1.49 |
| ortho (+ levels) | 216 | 1.23 | 2.61 | 1.32 |
| dtm | 180 | 1.02 | 2.18 | 1.05 |
| levels 1–4 | 158 | 0.90 | 1.91 | 0.92 |
| models (LoD2) | 89 | 0.51 | 1.08 | 0.65 |
| vectors: osm | 35 | 0.20 | 0.43 | 0.24 |
| trees | 15 | 0.08 | 0.18 | 0.07 |
| vectors: parcels (**est.**) | 228 | 1.30 | 2.76 | 1.30 |
| hist_1840 + hist_1935 (**est.**) | 188 | 1.07 | 2.28 | 1.07 |
| **Sum (no point clouds / candidates)** | **≈ 2 300** | **13.1** | **27.9** | **13.5** |
| xyz minimap ≤ z17 (vat + slrm measured 634 MB, hist est.) | ≈ 1 260 | ≈ 7.2 | ≈ 15 | 7.3 |
| point clouds (opt-in hot spots) | – | – | – | ≈ 40 MB per 1 km² hot spot |

`overall` (748 MB in plan §3) = 13.5 MB/km² plus point clouds (2.4) and candidates (0.2). The parcel boundary file
alone (`flurstuecke.geojson`) is 44 MB in `overall` (≈ 160 MB at Homburg size).

**Verdict:** in today's format Homburg is ≈ 2.3 GB for the rectangle and still ≈ 1.3 GB with a presence list, so
over the 1 GB Pages limit. The levers are required.

## 2. Levers (measured)

### 2.1 Relief: derive in the shader

| Layer | `overall` MB | Homburg MB | Finding |
|---|---|---|---|
| hillshade | 30 | 111 | **Dead weight.** Not in the mode table; the app draws *live* hillshade. Also 7.8 + 2.6 MB in `levels/*/hillshade` (Homburg 37 MB), never read. Drop. |
| slope | 33 | 122 | Live slope exists (`live-slope`). The baked layer only feeds the lens variant *Hangkanten*, which already falls back to `live-slope`. Drop. |
| slrm | 22 | 81 | = DTM − 41 × 41 box mean (checked: mean |Δ| 0.005 m, p99 0.012 m, below one u8 step of 0.021 m). The app's `live-lrm` is the same filter with a neighbour-aware low-pass. Drop; preset *Relikte suchen* switches to `live-lrm` r = 20. |
| **vat** | 38 | 145 | **Derivable from svf + opns_pos + live slope + live hillshade (315°/35°).** Numeric emulation on the u8 inputs and the terrarium DTM: mean |Δ| **0.4 u8 levels**, p99 1.2, max 15 (only where opns_pos < 72° is clipped by its u8 range), r = 0.9999, same on 4 `overall` and 3 Homburg chunks. Must mirror an rvt quirk: `blend_overlay` mutates its background in place, so the 50 % overlay opacity has no effect in the baked VAT. |
| svf, opns_pos, opns_neg | 107 | 402 | Keep (r = 10 m, 16 directions: needs neighbour heights far beyond the 1-cell apron). |
| chm, mask, bldg | 24 | 79 | Keep (data layers, lossless). |

**Shader prototype** (git worktree `../saar-lidar-explorer-v2-s0vat`, branch `spike/s0-live-vat`, uncommitted, not on
`main`): a uniform `uLiveVat` turns base = `svf` (slot A) + overlay = `opns_pos` (slot B) into the RVT VAT blend
(≈ 25 lines GLSL in `terrain.frag.glsl`). Screenshots baked vs live at the same pose
(`docs/shots/s0/vat_{forest,merburg}_{baked,live}.png`): visually the same; per-pixel mean |Δ| 2.3–3.8 grey levels,
concentrated on sharp edges, because the live variant evaluates slope/hillshade per fragment (slightly crisper than a
bilinear 1 m texture). **GPU cost:** step time unchanged (forest 5.2 → 5.2 ms, Merburg 4.0 → 3.7 ms; M4 Max,
headless), but **two** R8 textures instead of one per level-0 chunk (terrain GPU +8 to +27 MB at these views). Coarse
levels have no svf/opns, so they keep small baked `vat` level textures (or show live hillshade).

### 2.2 Re-encoding the u8 layers and the heights

24 (`overall`) and 44 (Homburg) chunks per layer, Pillow 13; size relative to today's PNG:

| Layer | PNG optimised | WebP lossless | AVIF q90 (mean / max err, u8) | AVIF q75 (mean / max) |
|---|---|---|---|---|
| svf / opns_pos / opns_neg | 0.98 | 0.94 | **0.58–0.61** (0.9–1.0 / 8–9) | 0.37–0.41 (2.2–2.6 / 26) |
| vat (if kept) | 0.98 | 0.95 | 0.61 (1.1 / 9) | 0.42 (2.5 / 22) |
| chm | 0.99 | 0.93–0.95 | 0.56 (0.6 / 11) | 0.36 |
| mask / bldg | 1.0 | **0.12–0.16 / 0.62** | – | – |
| dtm (terrarium RGB) | 1.0 | **0.68–0.69, bit-exact** | – | 2 cm quantisation + WebP ll: 0.55 |

- PNG optimisation brings nothing (already `compress_level=9`). WebP lossy is worse than AVIF at equal error and is
  never exact (limited-range YUV).
- **Browser decode path** (`app/src/data/decode.worker.ts`: `createImageBitmap(blob, {colorSpaceConversion: 'none',
  premultiplyAlpha: 'none'})`, R channel): format-agnostic, no loader change beyond the path extension. Checked in
  Chromium 1248 with exactly that path: WebP lossless u8 → **identical** (R = G = B); WebP lossless terrarium →
  **bit-identical**; AVIF q90 → identical to Pillow's decode (mean 1.0, max 7 levels from the source). Data layers
  (chm, mask, bldg, dtm) must stay lossless.

### 2.3 dsm

Read by the app only for the canopy surface (Labor *Wald* modes), the DSM line in profiles/measuring (`dsmAt`) and
the canopy lens target; with the default look (V2.4 trees) it is **not loaded at all** (0 bytes in every session
below). DTM + CHM(u8) reproduces the DSM with mean |Δ| 0.03 m, p99 0.08 m; only 0.09–0.12 % of cells are off by
> 0.5 m (CHM clipped at 40 m: towers, chimneys, pylons). **Drop dsm** (−1.4 MB/km²); canopy and `dsmAt` read DTM + CHM.

### 2.4 Vectors

GitHub Pages gzips `.json`, `.geojson`, `.bin` and `.glb` (checked on the live data repo; no brotli; PNG/WebP are
sent as is). Vectors load lazily, so they cost storage much more than traffic.

| File (`overall`) | MB | gzip | brotli | Lever |
|---|---|---|---|---|
| flurstuecke.geojson (boundaries, densified, baked z) | 44.3 | 11.5 | 7.0 | **drop**: derive the lines from the polygons in the vector worker and drape at runtime (the contract already allows unbaked heights) |
| flurstuecke_polygons.geojson | 12.6 | 2.8 | 1.5 | keep (parcel lookup); fetched only when a lookup happens |
| flurstuecke_labels.geojson | 5.4 | 0.7 | 0.4 | keep (or representative points from the polygons) |
| osm.geojson (densified, baked z) | 11.4 | 3.4 | 2.0 | **2D, undensified, 0.1 m: 1.3 MB** (gzip 0.23); Homburg 35.3 → 3.6 MB |

### 2.5 Levels (fine vs coarse, §4.3)

Homburg levels: L1 117 MB (74 %), L2 31 MB, L3 8 MB, L4 2 MB; by layer dtm 76, vat 45, hillshade 37 MB (dead). Central
coarse levels save little storage in a place repo; dropping hillshade and re-encoding matter more. **Proposal:** a
place repo keeps level 1 (2 m, 1 km chunks = exactly its own 1 km tiles); the catalog builds levels ≥ 2.
**Traffic caveat:** levels ≥ 2 were 21 MB (dtm) + 5 MB (ortho) of one Homburg flight session. On one central Pages
site shared by every place that is ≈ 3 900 such sessions per month for the whole Saarland. Make them cheap (quantised
or lossy coarse DTM, e.g. 5 cm steps at 4–16 m cells) or host them outside Pages (§8 risk).

### 2.6 Minimap tiles (xyz), missing in §5

Published today ≤ z17 (`saar-lidar-data-2`): `overall` vat 99 + slrm 81 + hist 2 × 86 MB = **7.3 MB/km²**. z17 alone
is 75 % of it; **≤ z16 costs ≈ 2.1 MB/km²** for all four layers, vat + slrm ≤ z16 ≈ 0.95 MB/km² (Homburg measured:
168 MB for 176 km²), vat alone ≈ 0.5 MB/km². Traffic is small (Labor session: 32 tiles = 1.8 MB; Standard uses OSM
tiles). Recommendation: vat only, ≤ z16, from the place repo; no slrm minimap tiles; historic minimap ≤ z16 or drawn
from the 3D image chunks.

### 2.7 Ortho and historic maps: encoding

| Option (24 chunks) | ortho 1000² (0.5 m) | hist 500² (1 m) |
|---|---|---|
| today (WebP q85 / JPEG q85) | 298 KB | 89 KB |
| WebP q75 | 0.65 (33.7 dB vs today) | 0.70 |
| AVIF q65 | **0.63** (34.1 dB) | **0.67** (34.8 dB) |
| AVIF q50 | 0.35 (30.8 dB, visibly softer) | 0.43 |
| half resolution (1 m / 2 m), WebP q85 | 0.28 | 0.27 |

## 3. Recommended target format and projection

| Item | Today | Target | Homburg MB |
|---|---|---|---|
| dtm | terrarium PNG | **terrarium WebP lossless** (bit-exact) | 180 → 124 |
| dsm | terrarium PNG | **dropped**, DTM + CHM in the app | 254 → 0 |
| hillshade, slope, slrm, vat | baked u8 PNG | **live in the shader** (VAT from svf + opns_pos) | 458 → 0 |
| svf, opns_pos, opns_neg | u8 PNG | **AVIF q90** (visual layers; mean err ≈ 1 level) | 402 → 241 |
| chm, mask, bldg | u8 PNG | **WebP lossless** | 79 → 73 |
| levels | L1–4: dtm + vat + hillshade | **L1 only** in the place repo (dtm WebP ll, vat AVIF q90), no hillshade | 158 → 59 |
| vectors | baked, densified, + boundary lines | OSM 2D; parcel lines from polygons | 264 (est.) → 70 |
| ortho | WebP q85, 0.5 m | **AVIF q65** (≈ WebP q75), 0.5 m | 216 → 136 |
| hist × 2 | JPEG q85, 1 m | **AVIF q65** | 188 (est.) → 126 |
| models, trees | as is | keep (models travel gzipped at 26 %) | 104 → 104 |
| **Total** | **≈ 2 300 MB = 13.1 MB/km²** | **≈ 930 MB = 5.3 MB/km²** (−60 %) | |
| minimap xyz | ≤ z17, 4 layers, 7.3 MB/km² | vat ≤ z16, ≈ 0.5 MB/km² | |

- `overall` with the same rules: 646 → 264 MB = **5.5 MB/km²**. So the plan's **≤ 5.5 MB/km² holds**, plus
  ≈ 0.5 MB/km² for the minimap.
- **Homburg as a place repo:** 5.3 MB/km² × 82–120 owned tiles (+ relief buffer) ≈ **0.45–0.65 GB** plus ≈ 50 MB
  minimap: fits one Pages site. Saarbrücken (167 km², ≈ 170–200 tiles) ≈ 0.9–1.1 GB: borderline; it needs AVIF q75
  for svf/opns (≈ −0.4 MB/km²) or a second site, as §5 foresees.
- Further levers, not needed for the target and not measured: meshopt/Draco for `models`, AVIF q75 for svf/opns,
  1 m ortho outside settlements.
- Contract work for S2: `.webp`/`.avif` layer paths (the decode path is ready), unbaked OSM heights, parcel lines
  derived from polygons, `vat` as a derived mode needing `svf` + `opns_pos`, no `dsm` when `chm` is present. Old
  manifests stay loadable (R9).

## 4. Traffic per session

Method: Chromium 1248 headless via puppeteer-core, 1440 × 900, Vite dev server, `?aoi=homburg-gemeinde`, fresh
profile, disclaimer closed. Cold load until streaming settles, then a scripted flight Schlossberg → Schloss Karlsberg
→ Kirrberg church → Einöd (**11.1 km**, 48 waypoints every 250 m, 120 m AGL, pitch −25°, `sle.flyTo` + `sle.step`
until `pending = 0` at each waypoint). All requests including the decode/vector workers (CDP on each worker), counted
once per unique file (Pages sends `max-age=600`); JSON/bin/glb at their gzip size, as Pages serves them. App code
(≈ 1.1 MB gzip, code site, cached) not included.

| Session (Homburg), MB | ortho L0 | dtm | levels dtm | ortho levels | relief | models (gz) | trees (gz) | **Total** |
|---|---|---|---|---|---|---|---|---|
| Standard look (ortho ground), open + flight | 63.6 | 57.6 | 60.1 | 14.6 | – | 9.8 | 6.3 | **212** |
| Labor (VAT), open + flight | – | 57.6 | 60.1 | 0.2 | vat 45 + levels 35 | 9.8 | 6.3 | **214** |
| Open and look around only (start view settled) | | | | | | | | **≈ 80** |
| Target format, Standard flight (ratios of §2) | 40.1 | 39.7 | 41.5 | 9.2 | – | 9.8 | 6.3 | **≈ 147** |

- `overall` with the same flight: 132 MB (Standard) / 125 MB (Labor); the route leaves `overall` near Einöd.
- ≈ 12 MB per km of flight on top of the opening (Homburg); one flight loads ≈ 70 % of the level-1 pyramid.
- **Sessions per 100 GB/month and site:** today ≈ 470 flight sessions or ≈ 1 250 short visits; target ≈ 680 /
  ≈ 1 800. One repo per municipality gives every place its own budget; a popular place, or the central overview levels
  (§2.5), will hit it first. Moving a place to R2 or another static host via `data_url` remains the fallback.
- DSM, vectors, candidates, point clouds and minimap tiles were not loaded in these sessions (lazy or off).

## 5. D6: ortho and historic maps, host or load the WMS live

| Check (2026-11-08) | SL TrueDOP20 (`freewms/truedop`) | RLP DOP20 (`geo4.service24.rlp.de`) | SL Historische Karten (owsproxy, WMS 2597) |
|---|---|---|---|
| CORS | `Access-Control-Allow-Origin: *` | `*` | not measurable (503); needs a `PHPSESSID` session cookie set on a 302, i.e. a credentialed cross-origin request, which `*` does not allow |
| Latency, size | 0.4–0.6 s per 1000² JPEG (≈ 235 KB); 0.6 s per 500² PNG (680 KB) | 2.2 s per 500² PNG (705 KB) | – |
| Caching | no `Cache-Control` | `max-age=0` | – |
| Availability | up | up (data download server: 502s, slow) | **503 all day**, like WFS 414 since 2026-11-07 |
| Licence | dl-de/by-2-0: attribution only; both hosting copies and live use are allowed | same | same |

**Recommendation: host both, in the slim encodings** (ortho AVIF q65 ≈ 0.8 MB/km², each historic map AVIF ≈ 0.35
MB/km²). Reasons: (1) ortho is the **default ground** of the public app (V2.5 look), so it must be as reliable as the
terrain, and parts of the Geoportal were down during this spike. (2) The historic WMS cannot be used cross-origin
(session cookie). (3) Live use moves the load onto the state service per visitor (≈ 150–220 GetMaps per flight;
R8), with answers as large as or larger than the hosted files and no cache headers. (4) The app needs a 1-pixel apron
per image chunk; hosted chunks already carry it. **Optional later:** a "sharper near the camera" mode loading
TrueDOP20 at 0.2 m live (CORS works, ≈ 0.5 s), with the hosted 0.5 m chunk as fallback. "Lower zoom levels only"
(1 m instead of 0.5 m) saves 72 % of ortho but visibly blurs the default ground at drone height; not recommended for
level 0.

## 6. Not verified

- Historic maps and parcels for Homburg were **not built** (Geoportal 503); their sizes are `overall` densities.
- AVIF/WebP decode checked in **Chromium only**; Safari (iOS) and Firefox AVIF via `createImageBitmap` in a worker,
  and decode time on phones, are open.
- Live VAT: two views, desktop M4 Max headless; phone GPU cost and the second texture's memory on phones unknown.
  Coarse-level VAT (no svf/opns there) not designed.
- Traffic: one scripted route, desktop viewport, dev server (sizes taken from the files, gzip estimated at level 6).
  Real flight speed, LRU re-fetch after `max-age`, phone viewports and the full-map view not measured. The "open and
  look around" figure counts repeated requests.
- Lossy relief quality judged numerically and on one screenshot pair, not by an archaeologist on subtle features.
- Parcel lines from polygons, runtime OSM densification and canopy from DTM + CHM are proposals, not prototyped.
