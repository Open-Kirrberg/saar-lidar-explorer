# Saar LiDAR Explorer — app

Browser app (Vite + TypeScript + three.js r187) to fly over the 2025 Saarland DTM. Data format: [`../docs/data-contract.md`](../docs/data-contract.md).

```sh
pnpm install
pnpm dev              # generates the synthetic fixture if missing, then starts Vite
pnpm run fixture      # (re)write public/data/fixture/ (incl. synthetic vectors/ + manifest `vectors`)
pnpm run test         # vitest
pnpm run build        # typecheck + production build → dist/ (without the AOI datasets, see below)
pnpm preview          # serves dist/ plus the data dir via a preview middleware
pnpm run serve:local  # build, then preview on http://127.0.0.1:5250/ (loopback only, strict port)
```

**Data and the build.** There is one data directory: `public/data/` (the pipeline writes there). `pnpm dev` serves it as usual. `pnpm run build` does **not** copy AOI datasets (every `public/data/<dir>/` that contains a `manifest.json`: ≈ 300 MB for Karlsberg, ≈ 1.4 GB for overall) into `dist/`; the rest of `public/` (e.g. `data/pois.geojson`) is copied, so `dist/` stays ≈ 2 MB (`verify.sh` checks < 20 MB). `pnpm preview` / `serve:local` serve `<base>data/<path>` straight from the data dir (`dataMiddleware` in `vite.config.ts`, URL match anchored at the base so `/src/data/*.ts` still reaches Vite — `scripts/dataPath.ts`, tested: GET/HEAD, `Last-Modified` + 304, `Cache-Control: no-cache`, a real 404 for missing files instead of the SPA's index.html, no paths outside the data dir). `SLE_DATA_DIR=/path/to/data` (absolute or relative to `app/`) makes dev, preview and `serve:local` serve from another directory first (files missing there fall back to `public/data/`); to keep a single copy elsewhere, symlink `public/data` instead, since the pipeline always writes to `app/public/data/`. Any other static server works once `dist/data/<aoi>` is a link to the dataset (relative base `./`). `VITE_DATA_URL=https://example.org/sle-data/ pnpm run build` loads AOIs from `${VITE_DATA_URL}<aoi>/manifest.json` (CORS needed if cross-origin) — private setups only; the public release goes through `scripts/release/` (ADR 0012).

### Serving & packaging: one data directory, no copies

The AOI datasets (≈ 300 MB for Karlsberg, ≈ 1.4 GB for overall) are **never copied into `dist/`**. `pnpm run build` copies only the small files in `public/` (e.g. `data/pois.geojson`); `dist/` stays at about 2 MB.

There is one data directory, `app/public/data/`, where the pipeline writes and from which every server reads:

| Command | Serves the app from | Serves `data/` from |
|---|---|---|
| `pnpm dev` | sources (Vite dev server) | `app/public/data/` |
| `pnpm run build && pnpm preview` | `dist/` | `app/public/data/` (preview middleware in `app/vite.config.ts`) |
| `pnpm run serve:local` | build + preview on `127.0.0.1:5250` (strict port, loopback only) | `app/public/data/` |

- **Data elsewhere** (e.g. an external disk): set `SLE_DATA_DIR=/Volumes/disk/sle-data` (absolute, or relative to `app/`) for `pnpm dev`, `pnpm preview` or `pnpm run serve:local`. Files found there win; files missing there still come from `app/public/data/`. The pipeline always writes to `app/public/data/`, so to keep a single copy on another disk, make `app/public/data` a symlink to it instead.
- **Another static server:** the build uses a relative base (`./`) and loads `./data/<aoi>/manifest.json`, so any static file server works once `dist/data/<aoi>` links to the dataset (e.g. `ln -s ../../public/data/overall app/dist/data/overall`). Run `pnpm run build` again before that, and remove the link before measuring `dist/` (verify.sh checks that `dist/` stays under 20 MB).
- `VITE_DATA_URL=https://…/data/ pnpm run build` points the build at a separate data host (CORS needed if cross-origin).
- **Public release (GitHub Pages, org Open-Kirrberg):** `SLE_PUBLIC=1 pnpm run build` builds the public site (base `/saar-lidar-explorer/`, data from the `saar-lidar-data` / `saar-lidar-data-2` Pages sites, AOI `overall`, castle viewer under `castle/`). Export scripts, limits and the publishing steps: [scripts/release/RELEASING.md](../scripts/release/RELEASING.md). Find markers, reviews and measurements stay in each browser.

The minimap's OpenStreetMap/OpenTopoMap tiles, the live DOP/Flurstück WMS overlays and the optional online Flurstück lookup need a network connection; the 3D view, relief layers, buildings, historic maps, point clouds, candidates and the *Meldung* report work from local data.

URL parameters:

- `?aoi=<name>` loads `public/data/<name>/manifest.json`. Without it the app loads `overall` (6 × 8 km, Homburg / Kirrberg / Karlsberg) if its manifest exists, otherwise `karlsberg`; if that is missing too, it falls back to `fixture`. The *Gebiet* card lists the known AOIs whose manifest loads; switching reloads with `?aoi=` and keeps the camera hash only if it lies inside the new AOI.
- `#E,N,h,heading,pitch,layer,overlay,opacity,forest,…` is the bookmark: camera pose (UTM 32N metres, m ü. NN, degrees), base display key, overlay key/opacity, forest mode, exaggeration, sun and the active blend preset. It is kept in sync while you fly; see *URL hash* below.

## Controls (Steuerung)

| Input | Action |
|---|---|
| Click canvas | Capture the mouse (pointer lock) for mouse look. `Esc` releases it. |
| Drag (without lock) | Look around |
| `W A S D` / arrow keys | Fly horizontally in the heading direction (drone style, not pitched) |
| `Space` / `E` | Climb |
| `Shift` / `Q` | Descend |
| Mouse wheel, `+` / `−` | Speed multiplier (×1.2 steps, 0.05–50) |
| `H` | Show/hide the control help in the HUD |
| `1`–`9`, `0` | Relief mode (see *Relief lab* below) |
| `Shift` + `1`–`N` | Relief combination preset (4 relief presets, plus *Luftbild × Relief* / *Karte 1840 ↔ Relief* when the AOI has those images) |
| `B` | Overlay on/off (last overlay layer, default Lokales Relief) |
| `V` | Forest: aus → transparent → voll |
| `K` | Automatic contrast (percentile stretch) |
| `O` | Wege (OSM) in 3D on/off (only if the manifest has `vectors.osm`) |
| `F` | Flurstücke + Flurnummern in 3D on/off (only if the manifest has `vectors.flurstuecke`) |
| `G` | Gebäude (LoD2) in 3D on/off (only if the manifest has `models.buildings`; default on) |
| `L` | Messen on/off (Strecke / Fläche / Höhenprofil / Punkt). While on: click adds a point, double-click / `Enter` finishes, `Backspace` removes the last point, `Esc` discards the drawing (second `Esc` ends) |
| `X` | Verdachtsflächen (F15 relict candidates) on/off in 3D and on the map (only if the manifest has `candidates`) |
| `N` / `P` | Next / previous candidate (score order, current filters; only while Verdachtsflächen are on) |
| `C` | Punktwolke (F16 classified ALS points of the focus areas) on/off (only if the manifest has `pointclouds`; default off) |
| `R` | Rekonstruktion 1789 (F19 hypothetical Schloss Karlsberg model) on/off (only if the shared dataset `data/shared/karlsberg1789/` exists and overlaps the AOI; default off) |
| `T` / `Shift`+`T` | *Schloss betreten*: hand the camera over to the castle viewer (fly / *zu Fuß*); only with the layer on and within 300 m of the palace |
| `M` | Markieren (find marker) mode on/off; `Esc` cancels |
| `?` | Intro overlay with all shortcuts (also the `?` toolbar button); does not change speed |
| `Esc` | Ends the tour / closes the intro (besides releasing pointer lock and cancelling Markieren/Messen) |
| Gamepad (standard mapping) | Left stick moves, right stick looks, `LT`/`RT` descend/climb, `LB`/`RB` change speed |

The table above, the HUD *Steuerung* list and the intro overlay all come from `src/ui/shortcuts.ts`; `tests/shortcuts.test.ts` scans `src/` for bound `e.code`/`k.has` keys and fails when one is missing there. `Space`/`Enter` on a keyboard-focused button activate the button and are not flight keys.

Speed is `baseSpeed · clamp(AGL/50, 0.2, 20) · multiplier`, with exponential acceleration and damping. A minimum clearance of 2 m (configurable) keeps the camera above the terrain.

### Touch (F20)

On touch screens fingers use map gestures by default (`src/controls/TouchController.ts`, Pointer Events with `pointerType === 'touch'` on the canvas only; mouse and pen keep the drone controls above). `ctx.setNavigationMode('drone')` makes fingers drag-look like the mouse instead.

| Gesture | Action |
|---|---|
| One finger drag | Pan — the grabbed terrain point stays under the finger (exaggeration-aware pick); short damped inertia on release |
| Two fingers pinch | Zoom toward the midpoint (distance 5 m … 30 km) |
| Two fingers twist | Turn (heading, orbit around the midpoint); engages after a 10° twist, which is not applied |
| Two fingers move | Pan |
| Two fingers parallel vertical drag | Tilt (pitch, orbit around the ground point at the screen centre) |
| Double tap | Zoom toward the tapped point, halving the distance (off while Markieren/Messen own taps) |
| Long press (≈ 600 ms) | Context action (`touchContext.ts`): while Messen is on, add a measuring point; otherwise switch Markieren on and open the Fundmarker form at that spot (window event `sle:longpress`) |

The gestures drive `DroneController.setPose`, so minimum clearance, store/URL hash and minimap stay in sync. **Einfach** layout (`src/ui/mobile.ts`; *Einstellungen → Ansicht: Automatisch / Einfach / Vollständig*, automatic = touch-first device or < 820 px wide): full-screen 3D, bottom bar *Standort · Relief · Ebenen · Karte · Mehr*; *Relief* cycles a few curated looks, *Ebenen*/*Karte*/*Mehr* open bottom sheets (layer toggles, the minimap, the whole desktop panel). `html.sle-touch` hides keyboard hints on coarse pointers. Touches that start on UI (bars, sheets, minimap, panel) never reach the canvas, so they don't move the camera; there is no on-screen joystick for `'drone'` mode. Any `flyTo` stops the pan inertia. Two-finger gestures are classified once the fingers have moved 12 px (`classifyTwoFinger`).

**Phone defaults:** on a touch-first phone (coarse pointer and shorter side < 820 px) the *Mobil* quality preset applies automatically unless a level was picked before (`qualityPicked` in `sle.settings.v1`; the stored level stays *Hoch*, so a later desktop visit is unaffected). The HUD shows a collapsed *Gesten* list instead of keys, the intro has a touch variant, and pull-to-refresh is off. **WebGL context loss** (`ui/contextLoss.ts`, common on phones under memory pressure): an overlay „Grafik wird neu geladen …“, then a page reload — the URL hash keeps pose and look.

## Architecture

```
src/
  main.ts                 wiring, frame loop, AppContext (window.sle), 'sle:ready' event
  geo.ts                  proj4 EPSG:25832 ⇄ WGS84, world ⇄ UTM, grid convergence
  state.ts                Store<AppState> (keyed subscriptions + source tag), URL-hash sync
                          (#E,N,h,heading,pitch,layer,overlay,opacity,forest,…; see *URL hash*)
  data/
    manifest.ts           types, loader, ?aoi= fallback, chunk URL templates
    grid.ts               cell / chunk / apron index math (contract §Grid & chunks)
    terrarium.ts          Terrarium encode/decode (pure)
    boxBlur.ts            O(n) separable box blur (low-pass for live local relief)
    lowpassRegion.ts      pure (F9): chunk + radius margin from same-level neighbours (coarser level as fallback) for the per-chunk low-pass
    pyramid.ts            pure (F9): contract block-mean downsampling of overview levels (fixture + tests)
    decode.worker.ts      fetch + createImageBitmap(colorSpaceConversion:'none') + OffscreenCanvas
    DecodePool.ts         worker pool, promise API, transferables
  terrain/
    Terrain.ts            quadtree streaming over the level pyramid (F9): selection, job queue, LRU eviction
                          under a GPU budget, mesh LOD + culling, base/overlay channels, layers, canopy (DSM),
                          per-chunk low-pass, collision height, value pass for auto contrast, raycast
    levels.ts             pure (F9): level / quadtree-node math (node rects, children, roots)
    quadtree.ts           pure (F9): screen-space-error selection, no-hole replacement, hysteresis, want list
    budget.ts             pure (F9): per-chunk GPU bytes, LRU eviction plan, adaptive refinement threshold
    latestBuild.ts        pure: one-build-at-a-time runner (pre-F9 AOI-wide low-pass; no longer used by Terrain)
    skirts.ts             pure: per-chunk edge deviation between LODs, exaggeration-scaled skirt depth
    TerrainChunk.ts       R32F height texture (502², incl. apron), layer textures (2 slots), mesh, CanopyPart
    TerrainMaterial.ts    shared/per-chunk uniforms, terrain + canopy materials
    relief.ts             pure: modes + shortcuts, image modes, colormaps, stretch/gamma, percentile stretch, blend modes,
                          presets (+ image presets), image ↔ relief slider mapping
    layerApron.ts         pure: 1-texel apron for u8 layer textures from same-level neighbours (seam fix)
    imageApron.ts         `rgb` image textures with a 1-texel apron (OffscreenCanvas compose, GPU strip patches)
    imageSides.ts         pure: chunk sides / apron UV for image layers
    heightSample.glsl     shared GLSL: 12-texel bilinear height + gradient, hillshade, fog
    terrain.vert/.frag    GLSL3: vertex displacement; per-pixel normals; base + overlay channel, blend, value pass
    canopy.frag.glsl      DSM surface coloured by CHM (DSM − DTM), sun-lit, discards < Mindesthöhe and over buildings (R0.7 `bldg`)
    gridGeometry.ts       shared LOD grids (1/2/4/10 m) with skirts, in height-pixel space
    HeightQuery.ts        CPU bilinear heights (with apron), mosaic, ray marcher; LevelHeights over all levels
                          (`heightAt` = finest resident, `heightAtDisplayed` = level drawn there)
    Sky.ts                gradient sky dome
  controls/DroneController.ts  (+ `touchLook`; a finger tap never requests pointer lock)
  controls/ F20 touch: touchGestures.ts (pure: pan anchor, pinch, twist, tilt, two-finger classification, release
           velocity, inertia, double tap), TouchController.ts (Pointer Events, map gestures via setPose), touchContext.ts (long press)
  locate/  F20 Mein Standort: locateMath.ts (pure: AOI test, distance text, nearest point, privacy radius), LocateLayer.ts
           (3D dot + draped accuracy ring, minimap dot/circle/arrow), Locate.ts (geolocation, Folgen, Kompass), index.ts (card), locate.css
  map/  Minimap.ts (Leaflet), footprint.ts (pure), aois.ts (pure: known AOIs, focus outlines, start AOI choice),
        overlays.ts (pure: XYZ relief vs. historic-map overlays, TrueDOP20 WMS)
  pois/ pois.ts (pure), PoiPanel.ts
  markers/ markerStore.ts (pure), parcel.ts (local lookup hook → WFS 414; `lookupParcelLocal` = local only, F18),
           MarkerManager.ts (`add`/`has` for F15, `setReportHandler` + ⎙ / "Meldung erstellen" for F18)
  buildings/ F11 LoD2 buildings: select.ts (pure: chunk rects, distance plan with hysteresis, surface
           fallback), BuildingMaterial.ts (clay ShaderMaterial, shared uExag/uHRef/sun/fog uniforms),
           BuildingLayer.ts (GLTFLoader streaming per level-0 chunk), Buildings.ts (card "Gebäude", key G)
  candidates/ F15 Verdachtsflächen: candidateData.ts (pure: parse, labels, filter, N/P order, outlines,
           marker text), reviewStore.ts (pure: localStorage `sle.candidates.v1.<aoi>`, re-attach ≤ 3 m,
           export), colors.ts, CandidateLayer.ts (outlines/circles via DrapedLines, selection on top),
           Candidates.ts (card, minimap circles, keys X/N/P, bestätigen → private marker via MarkerManager.add)
  measure/ F17 Messen: geometry.ts, profile.ts, model.ts (pure: lengths, area, ground factor, 0.5 m profile,
           slope stats, German numbers, GeoJSON), limit.ts (pure: ≤ n jobs in flight), heights.ts (1 m heights,
           level-0 fetch), ProfileChart.ts, MeasureOverlay.ts (`reportHide`), MeasureTool.ts (modes, key L), index.ts
  report/  F18 Meldung: format.ts (pure: UTM/WGS84/DMS, escaping, parcel labels, tile maths, scale bar, file
           name, sources), template.ts (pure: self-contained HTML), snapshot.ts (3D view, this pin only),
           mapSnippet.ts (relief XYZ tiles → detail z18 + overview z15), ReportDialog.ts (dialog, Blob download)
  pointcloud/ F16 Punktwolke: slep.ts (pure: sle-pts-v1 decode = zero-copy u16 view, encode for fixture/tests),
           lod.ts (pure: distance wish f = (d₀/d)², water-filled global budget, streaming plan 1.3/1.5 km),
           style.ts (pure: class palette, colour modes, prefs), PointMaterial.ts (ShaderMaterial on the raw
           interleaved tile buffer, shared uExag/uHRef), PointCloudLayer.ts (fetch/dispose per 100 m tile,
           drawRange LOD, `groundCheck()`), PointCloud.ts (card "Punktwolke", key C, minimap outlines)
  reconstruction/ F19 Rekonstruktion 1789: recon.ts (pure: sle-recon-v1 index/footprint parsing + tolerance, AOI overlap/offset,
           handover URLs both ways, prefs), ReconLayer.ts (glb load, meshopt, bake, picking through the exaggeration,
           ghost pre-pass), ReconMaterial.ts, Reconstruction.ts (card, keys R/T, toolbar, minimap, footer)
  print/   F21 3D-Druck planner: printData.ts (pure: tile ids, grid cells, index/series parsing, totals, keys per datum,
           CLI command), Print3D.ts (card, minimap grid, command popup), PrintOutline.ts (draped tile outline), print.css
  vectors/ F10/F12 draped vectors: drape.ts (pure: UTM → local float64, densify, per-chunk segment
           buckets with TRUE heights), spatial.ts (pure: point/segment grid indices, local parcel lookup),
           labels.ts + styles.ts (pure), DrapedLines.ts (screen-space ribbons), ParcelLabels.ts
           (pooled DOM labels, ≤ 300 m), VectorLayers.ts (panel "Wege & Flurstücke", keys O/F, loading),
           vectorData.ts (pure GeoJSON → buckets, baked heights) parsed in vectors.worker.ts via vectorLoader.ts
  ui/  aoiSwitcher.ts ("Gebiet" card, start AOI), flyTo.ts (fly-to re-aimed as finer data streams in),
       streaming.ts (pure: pending count for "Lade Details …", fly-to refinement rule),
       displayState.ts (store ⇄ Terrain bridge for overlay/opacity/forest), reliefPanel.ts + relief.css ("Darstellung"), gui.ts (lil-gui "Flug & Technik"), hud.ts, style.css, features.ts/.css, Labels3D.ts, disclaimer.ts, panelSection.ts,
       F20: mobileMode.ts (pure: Einfach/Vollständig detection, auto Mobil quality, Relief cycle, sheet state, swipe), mobile.ts + mobile.css
       (top bar, bottom bar, sheets, Standort pill), sheet.ts (bottom sheet), contextLoss.ts (WebGL context loss → reload)
scripts/  make-fixture.ts, fixture-terrain.ts, fixture-imagery.ts (synthetic ortho / 1840 map, DSM roofs, `bldg` mask), fixture-buildings.ts (gabled houses → glb per chunk, F11)
tests/    terrarium, geo, grid/apron, HeightQuery/boxBlur, relief (colormaps, stretch, percentiles, blend), footprint, markers (+ parcel helpers, QGIS-style null/empty import), pois, state (hash parse/format), displayState, skirts, latestBuild, manifest (`vectors` tolerance, v1/v2 `levels`), vectors (frame E−E0 / z=−(N−N0), densify, drape, spatial lookup, labels incl. hidden `Flur 0`), streaming (levels, quadtree selection, budget/LRU, low-pass region, pyramid, `heightAtDisplayed`), vectorData (baked z, buckets), aoiStreaming (start AOI, focus outlines, pending count, fly-to refinement), buildings (chunk rects/plan/hysteresis, surface classes, glb round-trip through GLTFLoader), candidates + candidatesManifest (parse/tolerance, labels incl. `along_path`, filter, N/P order, outlines, review store re-attach, confirm → reset → confirm reuses the marker, default min score), measure (lengths, area vs shoelace, ground factor, profile sampling, slope, formatting, GeoJSON, fetch limit), report (coordinate formats incl. DMS carry, escaping, template has no script + only this marker, tile maths, scale bar, file names), pointcloud + pointcloudsManifest (`sle-pts-v1` decode/encode round trip and header checks, LOD wish/budget water-fill, streaming plan, residency cap with hysteresis, styles/prefs, `pointclouds` tolerance), reconstruction (sle-recon-v1 tolerance, AOI offset, handover URLs both ways, footprints, prefs, glb load + picking at 1×/3×, ghost mode), touchGestures (gesture math + fake-DOM runs of pan/pinch/twist/tilt/double tap/inertia/long press), mobileMode (layout/quality detection, Relief cycle, sheets), locate (AOI test, distances, nearest point, German messages, privacy radius), print3d (tile ids ↔ UTM, index/series.json parsing + warnings, tile/set datum, totals, shared edges and keys per datum, `setKeys` for incomplete sets, CLI command incl. `--datum`, display cells, outline runs, prefs)
```

### URL hash

`#E,N,h,heading,pitch,layer,overlay,opacity,forest,exag,sunAz,sunEl,sunDirs,preset`, e.g. `#382150.5,5466210,420.3,45,-25,vat,slrm,0.6,transparent,2,315,35,1,relikte`.

- `E`/`N` in EPSG:25832, `h` = true camera height (m, not exaggerated), `heading`/`pitch` in degrees.
- `layer` = base display key, `overlay` = overlay key (empty = none), `opacity` = overlay opacity 0–1, `forest` = `off` | `transparent` | `full`. Keys are URI-encoded.
- `exag` (1–5), `sunAz`/`sunEl`/`sunDirs` = exaggeration and sun (final polish, "Ansicht teilen"). `preset` = active blend preset id, written only while one is active: on load the preset is applied first (overlay blend/colormap/stretch/shade, LRM radius), then the link's own layer/overlay/opacity/sun on top. With 13 fields, no preset. Manual blend/stretch/colormap tweaks without a preset are **not** in the hash (open gap).
- Trailing fields are optional: old 5-field (pose only), 6-field (pose + layer), 9-field and 13-field hashes still parse. Unknown layer/overlay keys are dropped (overlay → none), the opacity is clamped, and the hash is rewritten with the normalised values.
- The hash is written (debounced, `history.replaceState`) from the store (`bindHash`); the camera pose is seeded into the store before binding, so a display change in a tab where rAF has not run yet cannot write a `#0,0,0,…` pose.

### Rendering

- **World frame:** `x = E − E0`, `y = height`, `z = −(N − N0)`. Raw UTM values never reach the GPU.
- **Geometry:** each chunk has a mesh whose vertices are in height-pixel space. `mesh.position` maps them to world space.
  - The vertex shader `texelFetch`es the R32F height texture: `y = hRef + (h − hRef)·exag`.
  - **Streaming (F9):** a v2 manifest adds overview levels (2/4/8/16 m cells, 500-cell chunks). Each frame `Terrain.update()` runs the quadtree selection (`quadtree.ts`) from the coarsest level: a node is refined while its screen-space error exceeds the threshold (pixel error 1, raised automatically when the kept chunks exceed the budget); children replace a parent only when all of them are complete (no holes). Missing chunks/layers/low-pass/DSM become prioritised jobs (nearest + in view first, ≤ `maxInFlight` in parallel; jobs awaited by `ensureLayer`/`ensureCanopy` are kept across queue replacements). Resident chunks are evicted LRU under a 600 MiB GPU-texture budget (`budget.ts`; coarsest level pinned). `load()` only waits for the coarsest level. A v1 manifest is one level.
  - Mesh LOD within a drawn chunk (vertex spacing 1/2/4/10 m, never finer than the level's cell) is chosen from the camera's distance to its displaced bounding box. The distances can be changed in *LOD / Debug*.
  - Skirts hide cracks between LOD levels. Their depth (displayed metres) is `max(2 + 2·s, 1 + 2·edgeDev) · max(exag, 1)` (`terrain/skirts.ts`): `s` is the LOD spacing, `edgeDev` the chunk's maximum edge deviation between the full-res border and any coarser LOD (true metres, computed per chunk at load), so the skirt grows with the exaggeration.
  - Culling is done per chunk by `Terrain.update()`; the `bounds()` margin uses the coarsest-LOD skirt, so deep skirts are not culled early.
- **Shading is independent of mesh density:**
  - The fragment shader fetches the 4×4 texel neighbourhood (12 texels) around the fragment's continuous pixel coordinate.
  - From it, it computes the bilinear height and a bilinearly interpolated central-difference gradient.
  - The 1-cell apron makes the normals seamless across chunk borders.
- **Display = base channel + optional overlay channel** (see *Relief lab*). `state.layer` holds the base display key.
  - Each channel turns a *source* into a **physical value** (hillshade 0–1, slope °, local relief m, or a manifest `u8` layer decoded with its manifest `min`/`max`), stretches it with `lo`/`hi`/`gamma` and maps it through a colormap. Colour maps (not grey) are modulated by the live hillshade (*Schummerung in Farbe*).
  - The overlay is blended over the base in display space (Normal, Multiplizieren, Negativ multiplizieren, Ineinanderkopieren, Weiches Licht) with an opacity.
  - Live sources: `live-hillshade` (1–16 directions, sun azimuth/elevation, *Relief-Kontrast* z-factor), `live-slope`, `live-lrm` = `h − boxBlur(h, r)` with a **per-chunk** low-pass texture (F9): the chunk plus an `r`-cell margin from resident same-level neighbours (`data/lowpassRegion.ts`; a coarser level fills missing neighbours, rebuilt when they arrive), so it equals the AOI-wide blur wherever neighbours are resident. Low-pass textures are freed while live local relief is not shown.
  - Manifest layers are loaded lazily per chunk into slot A (base) / slot B (overlay). Chunks whose texture is still loading fall back to grey hillshade (base) or no overlay. Missing layers do not appear.
  - **Layer aprons (seam fix):** u8 layer images have no apron, so bilinear sampling used to clamp in the outer half texel: a flat 0.5-cell band on both sides of every chunk edge plus a step at the edge (column-step metric below: 11–34× the median at level-0 edges). Each u8 layer texture is now (n+2)² with a 1-texel apron copied from resident same-level neighbours (`layerApron.ts`; neighbours' aprons are rebuilt when a chunk arrives; missing neighbours clamp as before), sampled at `(p + 0.5)/(n + 2)`. Image layers get the same apron (`imageApron.ts`): composed in an OffscreenCanvas on arrival, later neighbours patched on the GPU (`copyTextureToTexture`, mipmaps regenerated); only 4 edge strips per chunk stay on the CPU.
  - **Image layers (`rgb`, F13/F14):** `manifest.imageLayers` (orthophoto `ortho`, historic maps `hist_*`) are colour sources: `fetch` + `createImageBitmap` (browser colour management on), sRGB texture with mipmaps + max anisotropy, re-encoded to display sRGB in the shader, no stretch/colormap, optional *Schummerung in Farbe*. They stream per level like VAT (coarse levels carry 500 px versions) and are never part of the value pass (auto contrast ignores them). GPU bytes include RGBA8 + mipmaps.
  - **Building mask (R0.7):** with `layers.bldg`, level-0 chunks that draw canopy also load the mask; the canopy shader discards where `bldg ≥ 0.5`, so roofs in the DSM show the ground relief (or the 3D buildings) instead of green canopy.
  - **Default:** `vat` if the manifest has it, otherwise live hillshade.
- **Value pass (auto contrast):** `uValuePass = 1` writes raw physical values (R base, G overlay, B/A valid flags) into a float render target: 384 px wide from the current camera (*Sichtbereich*) or 1024² from a top-down orthographic camera over the whole AOI (*Gesamtgebiet*). It is read back asynchronously (`readRenderTargetPixelsAsync`) and stretched to the 2–98 % percentiles (`relief.ts percentileStretch`, symmetric about 0 for diverging maps).
- **Canopy (F5):** a second mesh per chunk with the DSM as height texture, sharing the terrain's LOD geometries, exaggeration and culling. The fragment shader computes CHM = DSM − DTM per pixel (both 502² textures), colours it with a green ramp, lights it with the sun and discards it below *Mindesthöhe*, so open ground keeps the analytic relief. *Transparent* also drops near-vertical crown-edge "curtains" so the ground stays readable. With the forest or canopy collision on, the DSM (≈ 1 MB per chunk) streams only for **drawn level-0 chunks within 2 km** of the camera (`streaming.canopyDistance`), so the canopy ends ≈ 1.9 km out; `ensureCanopy()` waits until every such chunk has its canopy (its jobs survive the per-frame queue rebuild). DSM chunks that fail are skipped (not retried until reload).
- **Exaggeration** (`uExag`, 1–5×) is a shared uniform used by terrain, canopy, `surfaceY`/`collisionY`, picking and the HUD (true heights); changing it keeps the camera's true height.
- Distance haze (`uFogDensity`) and the sky dome give depth cues. Colours are written in display space, with no three.js colour management in the custom shaders.

### Extension points

- **Minimap / map sync:**
  - Subscribe with `store.subscribe((s, changed, source) => …, ['E','N','heading','pitch'])`.
  - Write with `store.set({...}, 'map')`. Camera-driven updates use the source `'camera'`, hash edits use `'hash'`.
  - Click-to-fly: `ctx.flyTo(E, N, { agl, heading, pitch, lookAt, duration })` returns `Promise<boolean>`: `true` when the camera arrives, `false` if user input interrupts it.
  - Heading is relative to grid north. On Web Mercator, use `heading + gridConvergenceDeg(E, N)` (≈ −1.2°).
  - Slots: `#minimap` (bottom-left) and `#panel` (right; lil-gui lives there, so append your own blocks).
- **Markers / picking:**
  - `ctx.pickAt(clientX, clientY)` returns `{ point, E, N, h }`.
  - `raycaster.intersectObject(terrain)` also works: `Terrain.raycast` marches the displaced height field. Chunk meshes have raycasting disabled because their CPU geometry is not displaced.
  - `terrain.heightAt(x, z)` returns the true height (finest resident level) and `terrain.surfaceY(x, z)` the displayed height of the surface actually drawn there (level of the drawn chunk), used for picking, labels and collision.
  - When a click should place a marker instead of locking the mouse, set `controller.opts.lockOnClick = false`.
- **Ground vs. canopy:** `terrain.surfaceY` is always the bare earth (DTM). The drone uses `terrain.collisionGround` (`collisionY`): DTM, or max(DTM, DSM) when *Kollision mit Baumkronen* is on. Then the HUD's *Höhe über Grund* is measured above the canopy.
- `window.sle` is the `AppContext`. `window` fires `sle:ready` once the coarsest level is resident (the loading box then hides; further streaming shows as "Lade Details … n" with a spinner in the HUD). `window.sle.terrainStats()` returns the streaming stats (resident/drawn chunks per level, `pending`, GPU estimate, evictions).
- `window.sle.step(frames = 1, dt = 1/60)` advances frames synchronously (controller, LOD, render, store sync). Automated Chrome tabs are often reported as hidden, which pauses rAF; use `step()` to render for screenshots and measurements.

## Relief lab (Darstellung)

The *Darstellung* panel sits at the top of the right panel. Mode buttons show their key; missing manifest layers are hidden. Under the buttons are the colour legend (current range and unit, plus the overlay's), a short hint, the presets and *Kontrast automatisch* / *Zurücksetzen*.

| Key | Mode | Source | Default colormap / range |
|---|---|---|---|
| `1` | VAT (Standard) | `vat` | grey, manifest range |
| `2` | Schummerung | live, sun under *Sonne / Schummerung* (azimuth, elevation, 1–16 directions) | grey 0–1 |
| `3` | Hangneigung | live slope (true, not exaggerated) | inverted grey, 0–manifest `slope.max` (40°), γ 1.25 |
| `4` | Lokales Relief | `slrm` (precomputed, 20 m) | blue–white–red, ±30 % of the manifest range (±0.63 m) |
| `5` | Relief live | live `h − boxBlur(h, r)`, *Relief-Radius* 2–60 m | blue–white–red, ±0.6 m |
| `6` | Himmelssicht | `svf` | grey, manifest range (ditches dark) |
| `7` | Offenheit + | `opns_pos` | grey (walls bright) |
| `8` | Offenheit − | `opns_neg` | inverted grey (ditches dark) |
| `9` | Vegetation | `chm` | green ramp, 0–40 m |
| `0` | Ergänzt | `mask` | categories: grey = LVGL 2025, orange = RLP 2022, magenta = interpolated |

Every mode remembers its own colormap, range and gamma for the session.

**Bilder** (only with `rgb` layers in the manifest, no number keys): *Luftbild* (`ortho`) and *Karte 1840* (`hist_1840`, further `hist_*` by manifest label) as base display or as *Überlagerung* (`Bild · …`). While an image is mixed with relief, a slider under the legend sets the overlay opacity (left = only the image): *Karte ↔ Relief* / *Luftbild ↔ Relief* when the image is the overlay or the relief overlay blends Normal (right = only relief); *Relief-Stärke* (ends "Luftbild" / "Luftbild × Relief") when the image is the base under a Multiply/Screen relief overlay, because the right end there is image × relief, never relief alone.

- **Kontrast & Farbe:** Farbskala, Untergrenze/Obergrenze (physical units, slider bounds from the manifest), Gamma (`t^(1/γ)`; for diverging maps applied symmetrically), Schummerung in Farbe. *Kontrast automatisch* (`K`) stretches to the 2–98 % percentiles (*abschneiden* 0–10 %) over the *Sichtbereich* or the *Gesamtgebiet*. *laufend nachführen* repeats it about twice a second while the camera moves.
- **Überlagerung (`B`):** layer (any mode), opacity, blend mode, its own colormap/range/gamma.
- **Wald / Kronendach (`V`):** *Aus* / *Transparent* (opacity slider) / *Voll*, *Mindesthöhe* (default 2 m), *Kollision mit Baumkronen* (default off: you fly through the canopy; the HUD shows "durchfliegbar" and "im Kronendach" while below the crown tops).
- **Gelände:** *Überhöhung* 1–5×, *Dunst*.

**Presets** (`Shift` + `1`–`N`):

| Preset | Base | Overlay |
|---|---|---|
| Relikte suchen | VAT | Lokales Relief (`slrm`), blue–white–red, Multiplizieren 60 %, γ 0.8 |
| Gräben & Gruben | Himmelssicht (γ 1.4) | Offenheit − inverted, Multiplizieren 60 % |
| Mauern & Kanten | Offenheit + | Hangneigung 0–35°, inverted, Multiplizieren 55 % |
| Schummerung × Relief | Live-Schummerung, NW 25°, 1 direction | Relief live (r = 10 m, ±0.5 m), Multiplizieren 50 % |
| Luftbild × Relief (if `ortho`) | Luftbild | VAT, Multiplizieren 60 % (slider *Relief-Stärke*) |
| Karte 1840 ↔ Relief (if `hist_1840`) | VAT | Karte 1836–41, Normal 60 % (slider *Karte ↔ Relief*) |

Preset shortcuts count the presets available for the AOI (`Shift` + 1–N in the order shown in the panel).

**Performance** (M5 Pro, Chrome, 3142 × 1548 drawing buffer, synchronous render + 1-pixel readback per frame; the tab was occluded so rAF fps could not be read): VAT 2.9 ms, VAT + overlay 2.7–3.8 ms, forest *voll* 3.4 ms, *transparent* 4.3 ms, low oblique view with forest 4.2 ms per frame (≈ 230–360 fps headroom; 1.1–2.9 M triangles, 14–51 draw calls).

## Map, known sites, find markers, disclaimer

All wired by `src/ui/features.ts` (`initFeatures(ctx)`, one call in `main.ts` right after `window.sle` is set).

- **Minimap (F4)**, `src/map/Minimap.ts`, Leaflet 1.9.4 in `#minimap`:
  - AOI: solid red outline of the loaded AOI (*Untersuchungsgebiet*) plus *Schwerpunktgebiete*: dashed outlines of the three focus areas with German tooltips (`map/aois.ts`). The relief XYZ comes from the AOI actually loaded.
  - Header bar: collapse ▾, `folgen` (follow camera), size `klein` / `groß` / `Vollbild`. Settings persist in localStorage `sle.map.v1`.
  - Base layers: OpenStreetMap (default), OpenTopoMap, none. OSM tile policy: visible attribution, default Leaflet loading only (no prefetch / bulk download).
  - Overlays (layer control, top right):
    - every `manifest.xyz` relief layer (`vat`, `slrm`), with a shared opacity slider at the bottom left;
    - `xyz.hist_*` historic maps (F14, e.g. *Karte 1836–41 (Bayer. Positionsblätter)*; label/attribution from the manifest, own opacity 85 %);
    - **Luftbild (DOP20)** (F13): live WMS `sl_dop20_rgb` of the Saarland TrueDOP20 (`geoportal.saarland.de/freewms/truedop`, EPSG:3857, JPEG, z ≥ 12, bounded to the layer extent — Saarland only, the RLP side stays empty), off by default;
    - AOI outline;
    - **Flurstücke** (INSPIRE CP WMS `CP.CadastralParcel`, style `CP.CadastralParcel.LabelOnReferencePoint`, parcel numbers, z ≥ 16) and **Gemarkung/Flur** (`CP.CadastralZoning`, z ≥ 15);
    - Bekannte Orte;
    - Fundmarker.
  - Camera marker: the arrow is rotated by `heading + gridConvergenceDeg` (≈ −1.2°).
  - View footprint: 12 rays through the screen border are intersected with the terrain (`terrain.intersectRay`). Misses and hits farther than 2.5 km are clamped to 2.5 km along the ray's horizontal direction. Pure logic is in `src/map/footprint.ts`, updated at most every 150 ms.
  - **Click on the map → `ctx.flyTo`**: keeps the current AGL and centres the clicked point in view (pitch ≤ −20°). Map keyboard and double-click zoom are off so they don't fight the drone keys or fly twice.
  - Dragging the map turns `folgen` off. Clicking (fly) or ticking the box turns it back on.
  - The URL hash keeps coming from the camera (`bindHash`), so map clicks show up in the bookmark once the flight settles.
- **Bekannte Orte (F7)**, `src/pois/`:
  - `pois.ts` (pure): parse `public/data/pois.geojson`, group by type (German labels, fixed order), forgiving search (case-, umlaut- and ß-insensitive; all words must match).
  - `PoiPanel.ts`: card in `#panel` with search, `nur im Gebiet`, and `in 3D zeigen`.
  - Click (list, map dot or 3D label) → `flyToSite`: oblique view 120 m away at 60 m AGL, approaching from the current direction.
  - 3D labels use `src/ui/Labels3D.ts`: a three.js `CSS2DRenderer` in its own scene and rAF loop. Labels follow the displayed terrain, are hidden beyond 3.5 km, and are dimmed when terrain occludes them (round-robin ray test).
- **Fundmarker (F6)**, `src/markers/`:
  - **Markieren mode**: `M`, the `Markieren` toolbar button, or the card button. It sets `controller.opts.lockOnClick = false` and releases pointer lock. Click (≤ 4 px, < 600 ms) → `ctx.pickAt` → form. Dragging still looks around. `M` / `Esc` ends the mode, and the previous `lockOnClick` is restored.
  - Form fields: Titel, Kategorie (Bunker, Mauer, Graben, Grube/Trichter, Hügel, Weg, Gebäude, Sonstiges), Notiz.
  - Auto-filled: E/N, height, WGS84, and the **Flurstück** via ALKIS WFS 414 `Flurstueck` with a ±0.5 m EPSG:25832 bbox, point-in-polygon, 25 s timeout. The result is patched into the marker if it arrives after saving.
  - Stored in localStorage `sle.markers.v1` (`{version:1, markers:[…]}`, all access in try/catch).
  - List: fly to / edit / delete. 3D pins (click → edit). Orange dots on the map.
  - **Meldung (F18)**: ⎙ in the list or *Meldung erstellen* in the edit form (saves pending edits first), see *Meldung (F18)* below.
  - **GeoJSON export/import**: WGS84 points `[lon, lat, h]` with properties `id, title, note, category, created, E, N, h` (+ `parcel`). Import validates, skips bad features, and merges by `id`. E/N/h properties count only if they are real numbers or non-blank numeric strings (`toFiniteNumber`); QGIS-style `null`/`''` fall back to the geometry (E/N from the coordinates, h from z).
- **Disclaimer & attribution (F8)**, `src/ui/disclaimer.ts`:
  - First-start modal "Schauen, nicht graben" (text from research/03, DE plus a short EN line). `nicht mehr anzeigen` is stored in localStorage `sle.disclaimer.v1`.
  - The ⓘ button at the start of the footer reopens it.
  - Footer attribution = manifest attribution + OpenStreetMap + Flurstücke (© GeoBasis-DE/LVGL-SL, dl-de/by-2-0) + POI sources.

## Wege & Flurstücke (F10, F12)

`src/vectors/`, wired by one call in `features.ts`; the card is hidden when the manifest has no `vectors`.

- **Loading:** GeoJSON is fetched and parsed in `vectors.worker.ts` (main-thread fallback if the worker fails), producing per-chunk segment buckets (`vectorData.ts`). With `heights: "baked"` the file's z is used per vertex; vertices without z are sampled from `HeightQuery` and re-sampled when height data changes. Overall parcels (42 MB) take ≈ 1.1 s in the worker.
- **Lines** are screen-space ribbons: one instance per ≤ 2 m segment (start/end with the *true* DTM height — baked or from `HeightQuery` — and a style index), expanded in the vertex shader to a constant pixel width with a dark casing in the same pass. The shader shares the terrain's `uExag`/`uHRef`/fog uniform objects: `y = hRef + (h − hRef)·exag + 0.3·exag`. Against z-fighting with coarse LODs: a view-space pull toward the camera (0.15 % of the distance × exag) plus `polygonOffset`. `alphaToCoverage` (MSAA) gives soft edges and the distance fade without blending artefacts. Segments are bucketed per 500 m chunk (frustum + distance culling). Bucket meshes exist only within a build radius of the camera (fade end + 500 m: parcels ≈ 2.1 km, OSM 6.5 km) and are disposed beyond it with hysteresis.
- **Styles:** Straße yellow, Wirtschaftsweg orange, Pfad magenta, Bahn light grey, Gewässer blue, Mauer/Graben green (barrier=wall/retaining_wall/city_wall/ditch; fences and hedges are not imported); parcel boundaries thin pale yellow (fade out 0.9–1.6 km).
- **Flurnummern:** pooled DOM labels; each update takes the ≤ 200 nearest label points within 300 m **3D distance** from the camera (grid index, label height = baked z or displayed terrain; so from ≳ 300 m AGL no labels are shown) that are in the view frustum, projected by hand, and **declutters** them greedily nearest-first (a label whose screen box overlaps a nearer one is skipped); dimmed when the terrain occludes them (round-robin ray tests). Updated from `scene.onBeforeRender` (≈ 11 Hz) and on `sle:step`.
- Toggles persist in localStorage `sle.vectors.v1` (both off by default). Debug handle: `window.sleVectors`.
- **Parcel lookup** (`VectorLayers.lookupLocal`, used by the marker form, *Messen → Punkt*, *bestätigen* and the report): with `flurstuecke.polygons` a point-in-polygon on the parcel polygons (`parcelPolygons.ts`: packed in the vector worker on first use, 100 m grid index, holes/MultiPolygons, any winding, first feature wins on overlap); if the file is missing or fails, the nearest label point ≤ 60 m whose connecting line crosses no parcel boundary; else the live WFS (marker form) or the opt-in online lookup (report). Checked: 3/3 points equal the live SL WFS, incl. a 60 ha forest parcel 836 m from its label point (118 ms incl. the lazy load).

## Gebäude (F11)

`src/buildings/`, wired by one call in `features.ts`; the card is hidden when the manifest has no `models.buildings`.

- **Streaming:** one glb per level-0 chunk (contract "Models"), fetched with three's `GLTFLoader` when the chunk rect (grown by 60 m, buildings poke over edges) is within 2 km of the camera, nearest first, ≤ 3 fetches in flight; disposed beyond 2.6 km (hysteresis band in between). A failing chunk (404/parse) is skipped until reload. Planned in `select.ts` (pure, tested), driven from `scene.onBeforeRender` (also by `sle.step()`).
- **Material:** a `ShaderMaterial` (not `MeshLambertMaterial` + `onBeforeCompile`) sharing the terrain's uniform objects: `y = hRef + (y − hRef)·exag` in the vertex shader on the true heights in the glb, normal `(nx, ny/exag, nz)`; Lambert from the terrain sun (`uSunAz/uSunEl`) + hemisphere ambient; the terrain's haze. Colours are display-space like the terrain shaders (no scene lights, no colour management). Clay walls, terracotta roofs, grey ground/closure from the `_surface` attribute (fallback: classified from normals). Back faces are lit from the visible side (robust to flipped LoD2 winding). Screen-door fade 1.5–1.95 km so chunks don't pop.
- **Picking/culling:** meshes don't raycast (CPU positions are not exaggerated) — `pickAt` still hits the terrain; per-mesh bounding spheres follow the exaggeration for frustum culling.
- **Default on** (orientation in towns; buildings don't hide relief under the forest), persisted in localStorage `sle.buildings.v1`. Off frees the meshes. Debug handle: `window.sleBuildings` (`layer.stats`).

## Rekonstruktion 1789 (F19)

`src/reconstruction/`, wired by one call in `features.ts` (`initReconstruction`, async). The dataset is **not** in the manifest: the app fetches `<data root>shared/karlsberg1789/index.json` (contract "Shared datasets", sle-recon-v1), written by the castle viewer (`cd zones/schloss-karlsberg && pnpm run export:explorer`). 404 / invalid / outside the AOI → no card, no keys, one console line. `vite build` does not copy `public/data/shared/` into `dist/` (`preview` serves it from the data dir).

- **Model:** one glb (`buildings.glb`: ≈ 92 nodes, LOD1 exterior, `COLOR_0` + `_CONF`, `EXT_meshopt_compression` decoded with three's bundled `meshopt_decoder.module.js`), loaded on first switch-on, freed when switched off. The layer group is translated by `(E0_model − E0_aoi, 0, −(N0_model − N0_aoi))` so `karlsberg` and `overall` line up; any node transform (quantization) is baked into float positions. Building ids come from the raw glTF node names (`GLTFLoader` sanitises `Object3D.name`, `site:x` → `sitex`).
- **Material** (`ReconMaterial.ts`): `ShaderMaterial` like the LoD2 buildings — shares the terrain's `uExag`/`uHRef`/sun/fog uniform objects, exaggeration applied in world space in the vertex shader. *Farbe*: **Material** (COLOR_0, linear → sRGB) or **Konfidenz** (`_CONF`: hoch `#009E73`, mittel `#E69F00`, niedrig `#CC79A7` — Okabe–Ito, colour-blind safe, legend with words; minimap outlines for *niedrig* are dashed too). **Deckkraft** 15–100 % (*Geister-Modus*): below 100 % a depth-only pre-pass (opaque list, after the terrain) plus a blended colour pass (depth "≤"), so only the front surface is blended over today's ruins.
- **Picking:** a plain click (≤ 4 px, < 500 ms) on the model opens the info card (name, id, class, confidence, eaves/ridge height, ≤ 3 sources, disclaimer, attribution) and highlights the building; that click does not capture the mouse. With the mouse captured, a click picks under the crosshair. Inactive while *Markieren*/*Messen* own the click. The ray is mapped display → true heights (affine in y) and tested against the true geometry; terrain in front wins.
- **Minimap:** footprints (`footprints.geojson`, EPSG:25832 → WGS84 via proj4) coloured by confidence while the layer is on; click = info card + fly to the building. Only footprints whose building the 3D layer shows on this AOI are drawn (`ReconLayer.partShown`, before the glb is loaded the same rule on the footprint's EN bbox: `footprintShownOnAoi`), so KL-B40–49 are absent in AOI `karlsberg`.
- **Schloss betreten:** toolbar buttons *Schloss betreten* / *zu Fuß* appear only with the layer on and the camera ≤ `anchor.enterRadius_m` (300 m) horizontally from the palace; also in the card (disabled with a distance hint when far), keys `T` / `Shift+T`, `Shift`+click = zu Fuß. Opens `<viewer.url>?src=explorer&E&N&h&heading&pitch&mode=fliegen|gehen&back=<this URL incl. fresh hash>` in the same tab (`recon.ts` `buildViewerUrl`, true height from the displayed y, grid heading, 0.1 m / 0.1° rounding; tested). The viewer's *Zurück zur Karte* returns with the first five hash fields replaced (`backTargetUrl` is the executable form of that rule). The viewer URL from the dataset must be a local http(s) URL, else `http://localhost:5260/`.
- **Prefs:** localStorage `sle.reconstruction.v1` (`on`, `mode`, `opacity`; default off). The URL hash is unchanged. Attribution entries join the footer while the layer is on (`reconFooterText`: prefixed with *Rekonstruktion 1789 (Hypothese):* only when the first entry does not already name the reconstruction). Debug handle: `window.sleRecon` (`layer.stats`, `handoverUrl(mode)`, `inRange()`).

## Messen (F17)

`src/measure/`, wired by one call in `features.ts` (`initMeasure`); toolbar button *Messen* and card *Messen*. Debug handle `window.sleMeasure` (`addVertexUtm(E, N)`, `finish()`, `list`).

- **Modes:** Strecke (polyline), Fläche (polygon), Höhenprofil (polyline), Punkt. `L` / button toggles; mutually exclusive with *Markieren* (`exclusiveWith`), `controller.opts.lockOnClick` is restored to the value found before the first mode started. Clicks ≤ 4 px / < 600 ms → `ctx.pickAt`; the second click of a double-click adds no vertex.
- **Metrics** (pure, `geometry.ts`, `profile.ts`, `model.ts`, tested in `tests/measure.test.ts`): horizontal length / perimeter / shoelace area in the UTM grid (primary values; they match Leaflet's spherical distance to ≈ 0.3 %). *Naturmaß* = grid · ground factor (1/k · (R + h + 48 m geoid)/R; k ≈ 0.99977 here, total ≈ +0.028 %). 3D length, Δh, ascent/descent, min/max/avg height and slope (Ø/max, central difference over 2 m) from DTM samples every ≤ 0.5 m (vertices exact).
- **1 m heights:** `heights.ts` (`MeasureHeights`) uses the terrain's resident level-0 chunks along the line, fetches + decodes missing level-0 DTM (and DSM for profile/point) chunks itself (one lazy decode worker, ≤ 3 at a time, LRU 32), else falls back to the finest resident level and the card warns with the share of non-1-m samples. Checked: profile heights equal bilinear samples of `data/work/*/dtm.tif` to < 5 mm (Karlsberg + an overall line 3 km from the camera: 100 % level 1 before, 0 % after the fetch).
- **Profile chart:** 2D canvas in the card: DGM solid + fill, DOM dashed (only where the DSM exists), min/max marks, axes in m, chart exaggeration shown; hover → readout (distance, DGM, DOM, slope) + a 3D cursor dot.
- **3D:** lines/outlines are `DrapedLines` with their own colour table (cyan done, yellow selected, white draft; true heights per ≤ 2 m vertex, exaggeration in the shader); vertex dots, value tags and the profile cursor are `Labels3D` elements; the rubber band to the cursor is a CPU line re-placed per frame with `surfaceY` (depth test off).
- **Punkt:** E/N, DGM height, DOM height + height above ground, WGS84, Flurstück via `lookupParcel` (local F12 data first, else ALKIS WFS 414; one request per point).
- **Storage / export:** per AOI in localStorage `sle.measure.v1.<aoi>` (profiles not stored, rebuilt on selection). *Export* → `messungen-YYYY-MM-DD.geojson`: WGS84 `[lon, lat, h]` (Point / LineString / closed Polygon), properties `id, kind, label_de, created, summary_de, vertices_utm [[E, N, h]], metrics{…}` (+ `E, N, h, lat, lon, parcel` for points, `profile{d_m, dtm_m, dsm_m}` for profiles).

## Verdachtsflächen (F15)

`src/candidates/`, wired by one call in `features.ts`; card *Verdachtsflächen* (only if the manifest has `candidates`). Data from `pipeline/detect.py` (contract "Candidates"); **hypotheses, private, local only**. Debug handle `window.sleCandidates`.

- **Display:** outlines (or a circle of `diameter_m`, 5 m fallback) as `DrapedLines` with baked heights (else terrain sampling), exaggeration in the shader; colour per class, grey for "Weg (bekannt)" (`linear` + `along_path`; `near_path` is informative only); minimap circles only while the layer is on. `X` toggles (persisted per AOI in `sle.candidates.prefs.v1.<aoi>` together with the filter, `candidates/prefs.ts`; the first AOI opened inherits the old shared key once, with the min score reset to that AOI's default, then the old key is deleted).
- **Filter:** class chips + "Weg (bekannt)", min-score slider starting at `params.min_score` (0.3), not the mask threshold. `N`/`P` step through the visible candidates in score order and fly there (`flyToSiteExag` / `framing.ts`, 45–160 m out: aims at the **displayed** height at any exaggeration and raises the camera when a ridge would block the view; also used by markers, measurements and the report); both ignore text fields and modifier keys.
- **Review:** *bestätigen* / *verwerfen* / *unsicher* per AOI in localStorage `sle.candidates.v1.<aoi>`; decisions re-attach to the nearest same-class candidate within 3 m after a re-run; *verworfen* hides the candidate. *bestätigen* creates a normal private marker (category from the class, reasons + metrics + disclaimer in the note); confirming again (also after *zurücksetzen*) reuses that marker; the parcel is looked up locally and stored on it (`MarkerManager.setParcel`). Un-confirming offers inline *Marker löschen / Behalten* (`MarkerManager.delete`); nothing is deleted automatically. Decisions export = local download `verdachtsflaechen-entscheidungen-<aoi>-YYYY-MM-DD.json`.

### Bombentrichter / Trichterfelder (F22, private)

UXO indicator classes from the sister project `saar-lidar-detect` (`sld run`; contract "Candidates" → UXO classes): `crater` *Bombentrichter (Hypothese)* (red ring of `diameter_m`, no outline) and `crater_field` *Trichterfeld (Hypothese)* (coral outline polygon in 3D **and** on the minimap, `member_ids`). Chips, the red UXO note and the *Min. Score Trichter* slider (starts at `params.crater_threshold`, 0.55; craters are written from 0.3) appear only when the data has them; the general *Min. Score* still applies to every other class incl. fields. Detail, tooltips, the 3D pin and the confirmed-marker note carry „Hinweis, keine Aussage über Kampfmittel/Blindgänger“. Reviews/export work as for relicts (`sle-candidate-decisions`, additive `classes` counts; `sld review import` reads it). **Never public:** `SLE_PUBLIC=1` forces `VITE_SLE_PUBLIC=1` and the parsers drop both classes (`src/data/publicBuild.ts`); `scripts/release/export_data.py` strips them from the data export. To preview locally, copy an `sld run` output's `candidates/` into `public/data/<aoi>/` and replace the manifest's `candidates` key with the run's (or run `sld run --out app/public/data/<aoi>`).

## Meldung (F18)

`src/report/`, opened from a marker (⎙ in the list, *Meldung erstellen* in the form). Builds **one self-contained HTML file** and offers it as a download (Blob + `a[download]`, `meldung-<titel>-YYYY-MM-DD.html`); nothing is ever sent.

- **Content:** title, category, notes, date; UTM 32N, WGS84 decimal and DMS (rounding carry), height, Flurstück; 3D view (1600 × 1000 JPEG, optional fly-to for an oblique view) with only this marker's pin; detail (z18) and overview (z15) map snippets from the AOI's own relief XYZ tiles (layer selectable) with scale bar and north arrow — no OSM or other online tiles; sources/licences and the "Schauen, nicht graben" disclaimer.
- **Privacy:** other markers and POI labels are DOM overlays and never reach the image; the `Candidates` group, `MeasureOverlay` and any object with `userData.reportHide` are hidden during capture (`sle:report-capture` event, phase begin/end). All user text is escaped; inline CSS, no scripts, CSP allowing only `data:` images.
- **Flurstück:** the marker's stored parcel, else `lookupParcelLocal` (parcel polygons, fallback label points ≤ 60 m; no network); the online ALKIS WFS lookup is an opt-in checkbox (sends only the coordinate), off by default.
- **Zuständige Stelle:** LDA Saarland, Bodendenkmalpflege (`www.saarland.de/lda/DE/themen-aufgaben/Bodendenkmalpflege`, § 16 SDschG) and GDKE Rheinland-Pfalz for RLP sites — no postal address or phone (research/03 has none).

## Punktwolke (F16)

Classified ALS 2025 points (`manifest.pointclouds`, contract format `sle-pts-v1`) for the focus areas. Off by default; nothing is fetched until the card's *anzeigen* or `C` switches it on.

- **GPU path:** each 100 m tile's record body (offset 16, stride 10 B) is uploaded unchanged as one interleaved `Uint16` buffer (`position` = x/y/h cm, `aMisc` = agl + cls|intensity). three.js takes the GL type from the typed array, so `agl` (i16) arrives as u16 and is re-signed in the vertex shader. The tile origin (E − E0, hBase, −(N − N0)) is computed in float64 and passed per tile; displayed `y = hRef + (h − hRef)·exag` with the terrain's shared uniforms.
- **LOD:** records are randomly ordered, so `drawRange(0, n)` is a uniform subsample. Visible tiles want `f = (120 m / d)²` (≥ 2 %); the global budget (*Punktbudget*, 0,5–8 Mio., default 3 Mio.) is water-filled with one common scale. Point size = drawn spacing projected to pixels × *Punktgröße*, clamped 1,5–14 device px. Tiles load within 1.3 km (nearest first, 4 fetches) and are disposed beyond 1.5 km; switching off frees everything. **Residency cap:** resident points ≤ max(2 × *Punktbudget*, 2 Mio.) — walking tiles nearest first, those past the cap are evicted farthest first and loads stop at 90 % of it (hysteresis). Each resident point costs 10 B on the GPU plus 10 B on the CPU (the tile buffer stays referenced), so the default cap is ≈ 60 MB GPU + 60 MB CPU; these bytes are *not* counted in the terrain's GPU estimate/LRU (`layer.stats.gpuBytes` reports them).
- **Röntgen-Linse:** uses the per-point `agl` field (contract: z − bilinear 1 m DGM, computed by the pipeline), so no terrain texture lookup in the shader; points with `agl > X` are dropped in the vertex shader. *Nur Boden* hides all classes but 2. *Gelände ausblenden* hides the terrain mesh (auto contrast then has nothing to read).
- **Failures:** a failed tile retries after 2 s, doubling up to 60 s, at most 6 tries (`lod.ts` `RETRY`); the status line shows resident points and memory (details in its tooltip). Checked: 13/13 tiles reloaded ≈ 2 s after forced HTTP 503s.
- **Colour modes:** Klasse (palette per LAS code), Höhe (ramp over the nearest area's `heightRange`), ü. Grund (agl 0–30 m), Intensität.

## Einstellungen, Teilen, Einführung, Tour, Qualität (final polish, v1.0)

`src/ui/polish.ts` wires everything below (toolbar buttons *Teilen*, *QR*, *Tour*, *?*; card *Einstellungen & Hilfe*).

- **Settings** (`settings.ts`): one versioned localStorage key `sle.settings.v1` — display (layer/overlay/opacity/forest), exaggeration, sun, quality, flight tempo, HUD help, intro seen. The URL hash always wins over it. All access in try/catch: without storage (checked in an iframe whose `localStorage` throws) the app runs with defaults. *Einstellungen zurücksetzen* needs a second click ("Wirklich zurücksetzen? Nochmal klicken"), clears every `sle.*` preference key (incl. per-AOI ones) and reloads with only the camera pose in the hash; `sle.markers.v1`, `sle.candidates.v1.<aoi>` and `sle.measure.v1.<aoi>` are never touched.
- **Ansicht teilen** (toolbar *Teilen* / card button): copies `location.href` (pose, display, exaggeration, sun, active preset — see *URL hash*) to the clipboard and shows a toast ("Ohne Fundmarker/Verdachtsflächen"). Markers, candidates and measurements never enter a link. `clipboard.ts` (pure, tested) waits ≤ 1.5 s for `navigator.clipboard.writeText` (it never settles without user activation), then tries `execCommand('copy')`, else the toast shows the link selectable for manual copying.
- **QR-Code zur Website** (toolbar *QR*, simple layout: *Mehr → QR-Code zur Website*; `src/share/`): modal (Esc, Tab trapped) with *Website* / *Diese Ansicht* (public URL + the same `formatHash` as *Teilen*; disabled while the view would reveal the user's position), QR as inline SVG (`qrcode-generator` 2.0.4, MIT, level M, 4-module quiet zone, offline), the URL as selectable text, *Link kopieren*, *QR als PNG speichern*. Public URL: `VITE_PUBLIC_URL` (default `https://open-kirrberg.github.io/saar-lidar-explorer/`, `share/publicUrl.ts`).
- **Einführung** (`onboarding.ts`): German first-run overlay shown after the disclaimer, with *nicht mehr zeigen*; `?` or the `?` button reopens it; `Esc` closes. Lists all shortcuts from `shortcuts.ts`. Like the disclaimer it is modal (`modalKeys.ts`): no key reaches the app's shortcuts while it is open, Tab stays inside.
- **Tour** (`tour.ts` data, pure + tested; `TourGuide.ts`): 7 stops (Schloss Karlsberg, Orangerie, Karlsbergweiher, Schwanenweiher, Burgruine Merburg, Grabhügel „Rabenhorst“, Hohenburg/Schlossberg), each with a relief preset, distance/height and hedged German text; only stops inside the loaded AOI (karlsberg 3, overall 7). *Weiter*/*Zurück*, *Weiter* on the last stop or `Esc` ends it (an open intro, disclaimer, marker form or report dialog gets its own `Esc` first); with `prefers-reduced-motion` the camera jumps instead of flying.
- **Qualität** (`quality.ts`, pure + tested): *Hoch* (= engine defaults) / *Mittel* / *Niedrig* (+ *Mobil* since F20: pixel ratio ≤ 1.5, pixel error 2, 200 MiB, canopy 700 m, LOD × 0.6, labels × 0.5, buildings 800 m, 0.5 M points; auto on phones, see *Touch (F20)*) set only existing knobs — pixel ratio cap 2 / 1.5 / 1, terrain pixel error 1 / 1.5 / 2.5, GPU budget 600 / 450 / 300 MiB, canopy distance 2000 / 1500 / 1000 m, mesh LOD distances and 3D label distance × 1 / 0.75 / 0.5, building load radius 2000 / 1500 / 1000 m, point budget 3 / 2 / 1 M (only when a preset is picked, and never over a budget the user set with the point-cloud slider). A window resize re-applies only the pixel ratio, so manual *LOD / Debug* slider changes survive. Measured on overall (DPR 2, low oblique view, synchronous `step()` + readPixels, 2 runs): Hoch 2.5–3.1 ms (1.90 M tris, 35 calls), Mittel 1.9–2.5 ms (1.57 M, 28), Niedrig 1.5–2.4 ms (1.15 M, 20).
- **Accessibility** (`a11y.ts`, `contrast.ts`, `polish.css`): `:focus-visible` ring (2 px amber) on every control (115 checked), `aria-label` on icon-only buttons, quality buttons as an ARIA radio group (arrow keys), `Space`/`Enter` on a focused button are not flight keys, HUD/footer backgrounds darkened so dim text stays ≥ 4.5:1 even over white terrain (lowest measured 5.56:1). The attribution footer wraps to 2–3 lines; its height is the CSS variable `--footer-h` and all bottom-anchored UI (toolbar, minimap, panel, toasts, tour) sits above it.

## Mein Standort & Handy im WLAN (F20)

`src/locate/` — card *Mein Standort* (button, *Folgen*, *Kompass*); other UIs (mobile toolbar) use `getLocate()` / the `LocateApi` returned by `initLocate()`: `locateMe()`, `toggleFollow(on?)`, `toggleCompass(on?)`, `flyToNearest()`, `clear()`, `getState()`, `onState(cb)`.

- **Flow:** `navigator.geolocation.getCurrentPosition` (`enableHighAccuracy`, timeout 15 s, `maximumAge` 5 s) → `wgs84ToUtm` → AOI rectangle test (`locateMath.ts`, origin = lower-left). Inside: `ctx.flyTo` 150 m (true) above ground, pitch −45°, plus a pulsing DOM dot (Labels3D, follows the displayed terrain) and an accuracy ring draped as `DrapedLines` (true heights, `y = hRef + (h − hRef)·exag` in the shader; radius = accuracy clamped 5 m … 3 km). Minimap: blue dot + `L.circle` with the accuracy radius. Outside: „Sie sind 12,3 km außerhalb des Gebiets.“, the minimap shows AOI + position (`Minimap.showBounds`: in memory only — follow/zoom are not saved and `endTemporaryView()` restores them on *Zum nächsten Punkt* / *Ausblenden*; while the map is hidden in the closed *Karte* sheet the fit waits until the sheet opens), *Zum nächsten Punkt im Gebiet* flies to the nearest point (150 m inset) looking towards the user.
- **Folgen:** `watchPosition`; the camera re-centres (keeping height and pitch, 1.2 s flight) only after a move > 15 m.
- **Kompass:** `deviceorientationabsolute` (Android/Chrome) or `deviceorientation` + `webkitCompassHeading` (iOS, `DeviceOrientationEvent.requestPermission()` on the button tap); a relative-only `alpha` is ignored. Arrow on the 3D dot (projected grid heading) and the minimap (true heading). No signal within 3 s → „Kein Kompass verfügbar“. Magnetic declination (≈ 2–3°) is not corrected.
- **Errors (German):** denied, unavailable, timeout, no geolocation API, and insecure context (explains HTTPS / `dev:lan`).
- **Privacy:** the position lives only in memory (the layer and the controller closure): no localStorage, not in the store/URL hash, not in reports (`userData.reportHide`; DOM dots never reach the snapshot), no console output, no requests. `LocateState` carries no coordinates. The *camera* pose would give it away too, so `revealsPosition(pose)` (`poseRevealsPoint`, `PRIVACY_RADIUS_M` = 1 km from the camera or the ground point in the view centre; fails closed) suspends the URL-hash writer (`bindHash` `suspend`), blocks *Ansicht teilen* (toast) and drops the pose on an AOI switch — during a locate flight and while the view is within 1 km, also after *Ausblenden* until the camera has left that zone once.
- **Phone access:** `pnpm run dev:lan` = `SLE_HTTPS=1 vite --host 0.0.0.0 --port 5243 --strictPort` with `@vitejs/plugin-basic-ssl` (self-signed certificate, cached in `node_modules/.vite/basic-ssl`; own optimizer cache `node_modules/.vite-lan` so it can run next to `pnpm dev`). It prints the `https://<LAN-IP>:5243/` URLs. Without `SLE_HTTPS=1` (plain `pnpm dev`, build, preview) nothing changes. Geolocation needs a secure context: `http://localhost` is fine on the desktop, `http://<LAN-IP>` is not.
- **Not verified:** a real phone (GPS fix and accuracy, iOS/Android permission prompts, self-signed certificate flow), *Folgen*, the *Kompass* arrow direction, the *Zum nächsten Punkt* flight and the outside-case minimap fit; *Ansicht teilen* being blocked near the user was checked by code path only.

## 3D-Druck planner (F21)

`src/print/` — card *3D-Druck* (added hidden in `ui/features.ts`, removed when no series is found; no keys). Data: `data/print/` (not in the manifest; format "3D print series" in `docs/data-contract.md`, written by `pipeline/print3d.py`).

- **Files:** `printData.ts` (pure: tile ids `E382.5_N5465.5` ↔ UTM corners, grid cells, `parsePrintIndex` with warnings, `parseSeriesList`, `tileDatum` (tile datum, else series datum), `printTotals`, `sharedEdges`/`blockCount` (tiles join only within the same datum), `setKeys`, `cellCommand`, `displayCells`, `outlineRuns`, prefs), `Print3D.ts` (card, loading, minimap layer), `PrintOutline.ts` (outline of the selected tile draped on the terrain via `DrapedLines`, exaggeration in the shader), `print.css`.
- **Discovery:** `print/series.json` (`sle-print3d-series-v1`) lists the series; without it the known keys (`KNOWN_PRINT_SERIES`, incl. old ones) are tried. Every `<key>/index.json` that validates becomes a choice; invalid ones are skipped with a console warning.
- **Card:** series picker, totals (tiles, typical/solid filament, assembled size, separate pieces, datums), generated tiles table, file links (3MF, PNG, bowtie key STL, Bambu Studio printer profile, `layout.png`), set progress with set datums. Key count: generated tiles (`printTotals.keys`, = `index.keysNeeded`) and, while a set is incomplete, all set members (`setKeys`). Clicking a cell on the minimap (or a table row) selects it, flies there and shows the `uv run python print3d.py --series … --tiles …` command (with `--datum` for a cell outside every set of a per-set-datum series).
- **Prefs:** `localStorage` `sle.print.v1` (`series`, `grid`, `outline`), wrapped in try/catch.
- **Debug:** `window.slePrint` (`PrintApi`), available once the series have loaded (event `sle:features`).
- **Minimap grid:** the series grid covers the AOI plus one ring of cells; generated tiles are labelled and link to their files. A click on a missing cell opens the command popup and does not bubble to the minimap's click-to-fly. Hidden while the card is closed.
- **Mobile (F20 layout):** *Mehr* sheet → button *3D-Druck* opens the card; the grid shows in the *Karte* sheet.

## Known gaps

- Messen (F17): no editing of finished measurements (delete + redraw); no measurement import; the rubber band is a straight (not draped) preview; the area is horizontal only (no 3D surface area). Exports are not written by the Export button in automated checks (GeoJSON content was checked via `measurementsToGeoJSON`).
- Verdachtsflächen (F15): the optional `candidates.mask` class raster is not rendered (outlines/circles only; F22 codes 6/7 are known but unused); N/P does not switch the relief preset per class; *Bekannte Orte* (`pois/PoiPanel.ts`) still fly with the old, not exaggeration-aware `flyToSite` (one-line switch to `flyToSiteExag`). Precision of the rule-set-2 coarse candidates is unknown (2 inspected by eye). The mask raster is not drawn. Clicking a candidate circle or a point-cloud outline on the minimap no longer also triggers the map's click-to-fly (`bubblingMouseEvents: false`, v1.0.1; verified by code path, not clicked in a browser).
- Meldung (F18): without `flurstuecke.polygons` (old manifests) the label-point fallback still misses large forest parcels. Notes over ≈ 1000 characters push the print to a third page (the dialog warns). No postal address/phone for the authorities (none in the research). Printing from a real browser dialog and an occluded marker were not checked.
- Punktwolke (F16): no eye-dome lighting; point bytes (10 B GPU + 10 B CPU per resident point) are not counted in the terrain's GPU estimate/LRU; *Gelände ausblenden* also pauses auto contrast while on; colour modes Höhe/ü. Grund/Intensität, the point-size slider and frame pacing while tiles stream in flight were not checked. Areas exist only where the pipeline wrote them (`overall`: all three, `karlsberg`: Schloss Karlsberg; `homburg` after a rebuild, `kirrberg` none).
- Rekonstruktion 1789 (F19): only the one dataset `shared/karlsberg1789/` is looked up (no discovery of other `shared/<id>/`); no distance fade/LOD (≈ 340 k triangles always drawn while on); where today's LoD2 buildings stand inside the model both are drawn (no masking); the model is not hidden by the canopy; skirts reach 0.5 m below the 2025 DTM, so at high exaggeration they sink visibly deeper into ruin pits (by design). Browser rendering, frame time and the round trip with the viewer were not verified in this build step.
- Mobile (F20): nothing tested on a real phone (see *Touch (F20)* / *Mein Standort*). A long-press marker leaves Markieren on, and it opens the form by a synthetic canvas tap because `MarkerManager.openForm` is private (a public `openDraftAt(E, N, h)` would fix both). The Markieren hint still mentions keys and clicks. On desktop the panel full-width rule no longer matches lil-gui's current class names (panels render 245 px; fixed only inside the Einfach layout). *Vollständig* on a phone is cramped. The HUD *Gesten* button is 60×28 px (< 44 px target). After *Mein Standort* the camera sits ≈ 200 m above the ground under it (150 m is relative to the target). The compass ignores magnetic declination (≈ 2–3°). The desktop canvas now has `touch-action: none`.
- 3D-Druck (F21): "assembled size" is the bounding rectangle of all generated tiles of a series — for far-apart detail sets (Karlsberg + Merburg: 47 × 165 cm) it is not meaningful, the card adds the number of separate pieces. Permanent tile labels on the minimap overlap at the overview zoom. Filament figures come from the pipeline's estimate (5–11 % above Bambu Studio's). The clipboard was checked only in headless Chrome with granted permissions.
- Buildings: bases are matched to the 1 m DTM only; where a coarser terrain level is drawn (far field) the ground may sit slightly off the bases (not measured). Buildings are not pickable. A few LoD2 buildings keep a gap > 0.5 m where the pipeline's 5 m skirt cap applies (2 Karlsberg / 20 overall).

- Live local relief: where a same-level neighbour is not resident, the band within *Relief-Radius* of that edge uses the coarser level's heights (approximate) until the neighbour arrives.
- No geomorphing between levels (pops on refinement); T-junctions are hidden by skirts. Draped lines with baked 1 m heights get no level-aware handling over coarse levels (only the general lift + depth bias).
- SVF and openness are not computed live. They come from the pipeline as `u8` layers. VAT is used as delivered; there is no live re-blend of its components (but any two layers can be blended).
- The URL hash and `sle.settings.v1` hold display, exaggeration, sun and the active preset; manual blend/stretch/colormap tweaks without a preset are neither shared nor persisted. Forest modes other than `off` are dropped when the AOI has no DSM.
- Canopy only for drawn level-0 chunks within 2 km: in *Wald* modes the far field shows bare terrain.
- Chunk-edge seam of precomputed layers: fixed with layer aprons (VAT/hillshade/slope/SVF column-step ratio at level-0 edges 11–34× → 0.7–1.4×, flat band gone). Images: 10.6–17.6× → 0.7–2.1× (off-edge controls 0.5–0.9×), so a faint residual at some ortho edges remains. Aprons only use same-level neighbours; next to a non-resident neighbour (e.g. drawn from a coarser level) the edge still clamps; diagonal corner texels of images are clamped.
- *Column-step metric* (seam check): top-down view 40 m above a chunk edge, mean |Δ luminance| between adjacent pixel columns over the middle half of the rows; report max within ±3 px of the edge ÷ median of all columns, plus the count of near-zero columns within ±14 px (the clamp band).
- Image layers: the live DOP WMS in the minimap covers Saarland only. Image textures are ≈ 5.3 MB per level-0 ortho chunk (1002² RGBA8 + mips): with *Luftbild* on, the 600 MiB budget is reached sooner (Homburg view: 52 ortho chunks, 430 MB). After upload the decoded copy is released; on `webglcontextrestored` Terrain drops all image layers so they stream in again (not covered by a test). Worst case measured (Luftbild × Relief + buildings + *Wald voll*, Homburg): 548 of 600 MiB estimate. After a display change from outside the panel (store write, hash) the previous preset button can stay highlighted.
- The *Drahtgitter* toggle (lil-gui) only affects chunks resident when it is switched; chunks loaded later are drawn solid.
- Start-up / streaming timings were measured with warm caches only; real rAF frame pacing during streaming is unmeasured.
- Failed DSM chunks are not retried until reload.
- Draped lines/labels use the bare-earth DTM; with *Wald: Voll* they should be hidden under the canopy (not checked). Very sharp bends in thick lines show small notches (no round joins). On the overall AOI parcels appear ≈ 1 s after the first `F` (worker parse of 42 MB) and parcel lines exist only within ≈ 2.1 km. Lines are lifted 0.3 m·exag, but 0.04 % of OSM chord samples lie > 0.3 m below the true surface (max 1.38 m on a road near E 381125 / N 5467365), so such short spots can be hidden.
- The canopy colours everything above *Mindesthöhe* green; buildings are excluded only where the manifest has `layers.bldg` (R0.7; LoD2 footprints dilated 1 m — trees overhanging roofs disappear too, other structures (walls, bridges) stay green). In *Voll* mode crown edges form dark near-vertical walls; *Transparent* drops them.
- Final polish: the parcel-label radius is not part of the presets (private to the vectors module); presets are not measured in real rAF pacing. A point budget set with the point-cloud slider is kept across preset picks (`sle.pointcloud.v1` `budgetUser`; v1.0 prefs count as user-set when the budget is no preset value) — after *Einstellungen zurücksetzen* presets control it again. `pnpm run serve:local` on 5250 itself, the tour with reduced motion, and gamepad were not checked.
