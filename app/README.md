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
| Click canvas | Capture the mouse (pointer lock) for mouse look. `Esc` releases it. A click on a near tree opens its *Baum-Steckbrief* instead (see *Bäume*); while captured, a click picks the tree under the crosshair. |
| Drag (without lock) | Look around |
| `W A S D` / arrow keys | Fly horizontally in the heading direction (drone style, not pitched) |
| `Space` / `E` | Climb |
| `Shift` / `Q` | Descend |
| Mouse wheel, `+` / `−` | Speed multiplier (×1.2 steps, 0.05–50) |
| `1`–`9`, `0` | Relief mode (see *Relief lab* below) |
| `Shift` + `1`–`N` | Relief combination preset (4 relief presets, plus *Luftbild × Relief* / *Karte 1840 ↔ Relief* when the AOI has those images) |
| `B` | Overlay on/off (last overlay layer, default Lokales Relief) |
| `V` | Forest: aus → transparent → voll |
| `F` | *Relikt-Blick* lens on/off: trees fade, relief over the aerial ground, possible relicts glow (all tiers; see *Spiel-Look & Relikt-Blick*) |
| `K` | Automatic contrast (percentile stretch) |
| `O` | Wege (OSM) in 3D on/off (only if the manifest has `vectors.osm`) |
| `G` | Gebäude (LoD2) in 3D on/off (only if the manifest has `models.buildings`; default on) |
| `L` | Messen on/off (Strecke / Fläche / Höhenprofil / Punkt). While on: click adds a point, double-click / `Enter` finishes, `Backspace` removes the last point, `Esc` discards the drawing (second `Esc` ends) |
| `X` | Verdachtsflächen (F15 relict candidates) on/off in 3D and on the map (only if the manifest has `candidates`) |
| `N` / `P` | Next / previous candidate (score order, current filters; only while Verdachtsflächen are on) |
| `C` | Punktwolke (F16) on/off — 🧊 frozen since V2.1, not wired |
| `R` | Rekonstruktion 1789 (F19 hypothetical Schloss Karlsberg model) on/off (only if the shared dataset `data/shared/karlsberg1789/` exists and overlaps the AOI; default off) |
| `T` / `Shift`+`T` | *Schloss betreten*: hand the camera over to the castle viewer (fly / *zu Fuß*); only with the layer on and within 300 m of the palace |
| `M` | Markieren (find marker) mode on/off; `Esc` cancels |
| `?` | *Steuerung* dialog with every shortcut of the mounted features (also the *Steuerung* button); does not change speed |
| `Esc` | Closes the open dialog / drawer, ends the tour (besides releasing pointer lock and cancelling Markieren/Messen) |
| Gamepad (standard mapping) | Left stick moves, right stick looks, `LT`/`RT` descend/climb, `LB`/`RB` change speed |

The table above and the *Steuerung* dialog come from `src/ui/shortcuts.ts` (rows carry a `feature` id; the dialog lists only rows of mounted features, see *Shell*); `tests/shortcuts.test.ts` scans `src/` for bound `e.code`/`k.has` keys and fails when one is missing there. `Space`/`Enter` on a keyboard-focused button activate the button and are not flight keys.

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

The gestures drive `DroneController.setPose`, so minimum clearance, store/URL hash and minimap stay in sync. Phones (≤ 600 px) get the same shell as the desktop with an icon-only action bar and drawers as bottom sheets (see *Shell*; the v1 *Einfach* layout is gone since V2.2). `html.sle-touch` hides keyboard hints on coarse pointers. Touches that start on UI (bar, drawers, minimap) never reach the canvas, so they don't move the camera; there is no on-screen joystick for `'drone'` mode. Any `flyTo` stops the pan inertia. Two-finger gestures are classified once the fingers have moved 12 px (`classifyTwoFinger`).

**Phone defaults:** on a touch-first phone (coarse pointer and shorter side < 820 px) the *Mobil* quality preset applies automatically unless a level was picked before (`qualityPicked` in `sle.settings.v1`; the stored level stays *Hoch*, so a later desktop visit is unaffected). The *Steuerung* dialog adds the touch gestures, and pull-to-refresh is off. **WebGL context loss** (`ui/contextLoss.ts`, common on phones under memory pressure): an overlay „Grafik wird neu geladen …“, then a page reload — the URL hash keeps pose and look.

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
    TerrainChunk.ts       R32F height texture (502², incl. apron), layer textures (3 slots: base, overlay, lens), mesh, CanopyPart
    TerrainMaterial.ts    shared/per-chunk uniforms, terrain + canopy materials
    relief.ts             pure: modes + shortcuts, image modes, colormaps, stretch/gamma, percentile stretch, blend modes,
                          presets (+ image presets), image ↔ relief slider mapping
    layerApron.ts         pure: 1-texel apron for u8 layer textures from same-level neighbours (seam fix)
    imageApron.ts         `rgb` image textures with a 1-texel apron (OffscreenCanvas compose, GPU strip patches)
    imageSides.ts         pure: chunk sides / apron UV for image layers
    heightSample.glsl     shared GLSL: 12-texel bilinear height + gradient, hillshade, fog
    terrain.vert/.frag    GLSL3: vertex displacement; per-pixel normals; base + overlay channel, blend, lens channel + glow rings, value pass
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
  map/  Minimap.ts (Leaflet game minimap), minimap.css, bearing.ts (pure: heading → map bearing, rotation, cone, click unrotate), footprint.ts (pure), aois.ts (pure: known AOIs, focus outlines, start AOI choice),
        overlays.ts (pure: XYZ relief vs. historic-map overlays, TrueDOP20 WMS)
  pois/ pois.ts (pure), PoiPanel.ts
  markers/ markerStore.ts (pure), parcel.ts (local lookup hook → WFS 414; `lookupParcelLocal` = local only, F18),
           MarkerManager.ts (`add`/`has` for F15, `setReportHandler` + ⎙ / "Meldung erstellen" for F18)
  buildings/ F11 LoD2 buildings: select.ts (pure: chunk rects, distance plan with hysteresis, surface
           fallback), BuildingMaterial.ts (clay ShaderMaterial, shared uExag/uHRef/sun/fog uniforms),
           BuildingLayer.ts (GLTFLoader streaming per level-0 chunk), Buildings.ts (card "Gebäude", key G)
  trees/   V2.4 CHM trees (see *Bäume*): treeData.ts (pure: sle-trees-v1 decode/encode, fmix32 ids/ranks, manifest
           tolerance, instance rows, gather), lod.ts (pure: density, rank prefix, crown scale, LOD bands — TS twins of the
           GLSL), treeShapes.ts (pure: lathe meshes per LOD), TreeMaterial.ts (GLSL3 instanced shader, dither cross-fade),
           TreeLayer.ts (chunk streaming, near/mid/far meshes, stats, CPU `pick`), index.ts (`installTrees`, features
           `trees` + `tree-card`); Baum-Steckbrief: treePick.ts (pure: ray vs. per-tree cylinders), treeFacts.ts (pure:
           crown-allometry-v1 twin, `forest_hist` parse/lookup/wording, point in Gemarkung), treeSpecies.ts (pure:
           manifest `species`, species-dlr-neighbourhood-v1 + tree-age-height-v2 twins), TreeCard.ts (picking + card)
  places/  🏆 Orte im Vergleich (see *Orte im Vergleich*): placesData.ts (pure: manifest `stats`, sle-stats-v1 +
           outline parsers incl. Phase 1 blocks, ranking rule, badges, German formatting, AOI clipping, sheet framing,
           goal bars), collect.ts (pure: local collecting, localStorage `sle.orteCollect.v1`), PlaceLayer.ts (draped
           outline + minimap outline, Riesenbaum pins, Riesen dots + pin), PlacesPanel.ts (card in the „Orte“ drawer),
           index.ts (feature `place-stats`)
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
  vectors/ F10/F12 draped vectors: drape.ts (pure: UTM → local float64, densify, per-chunk segment
           buckets with TRUE heights), spatial.ts (pure: point/segment grid indices, local parcel lookup),
           labels.ts + styles.ts (pure), DrapedLines.ts (screen-space ribbons),
           VectorLayers.ts (card "Wege", key O, loading; parcels only for the local lookup),
           vectorData.ts (pure GeoJSON → buckets, baked heights) parsed in vectors.worker.ts via vectorLoader.ts
  ui/  startAoi.ts (start AOI; no switcher UI since V2.1), flyTo.ts (fly-to re-aimed as finer data streams in),
       streaming.ts (pure: pending count for "Lade Details …", fly-to refinement rule),
       displayState.ts (store ⇄ Terrain bridge for overlay/opacity/forest), reliefPanel.ts + relief.css ("Darstellung"), gui.ts (lil-gui "Flug & Technik"; LOD/Debug folder in dev only), style.css (base vars), features.css + polish.css (card/toast/a11y styles), Labels3D.ts, disclaimer.ts, about.ts, panelSection.ts,
       mobileMode.ts (pure: auto Mobil quality, touch gestures list), quality.ts, settings.ts, shortcuts.ts, contextLoss.ts (WebGL context loss → reload)
  lens/ V2.5 game look + Relikt-Blick (see *Spiel-Look & Relikt-Blick*): lensState.ts (pure: 0.5 s progress, staggered blend curve),
       variants.ts (pure: relief / LRM / slope + Zeitreise 1840 / 1935), glow.ts (pure: glow pool, look-ahead centre, nearest ≤ 24, pack, pick),
       merken.ts (pure: hypothesis card text, candidate → private marker + note), targets.ts (pure: `setLensFade` registry),
       layout.ts (pure: card clear of the splash corner), look.ts (aerial ground in Standard/Entdecker, Labor restores),
       Lens.ts (toggle, key F, card, chips, frame loop), index.ts, lens.css
  shell/ V2.2 game shell (see *Shell*): Shell.ts (layout, bar, drawers, dialogs wiring, walk mode, extension APIs), registry.ts (pure tier-gated
       feature registry), tiers.ts (pure), attribution.ts (pure: source rows, splash timer), flight.ts (pure: walk height, speed steps), builtins.ts
       (the v1 features as registry entries), host.ts (per-feature wrappers), hud.ts, sources.ts („© Quellen“), dialog.ts, dialogs.ts, dom.ts, types.ts, shell.css
scripts/  make-fixture.ts, fixture-terrain.ts, fixture-imagery.ts (synthetic ortho / 1840 map, DSM roofs, `bldg` mask), fixture-buildings.ts (gabled houses → glb per chunk, F11)
tests/    terrarium, geo, grid/apron, HeightQuery/boxBlur, relief (colormaps, stretch, percentiles, blend), footprint, markers (+ parcel helpers, QGIS-style null/empty import), pois, state (hash parse/format), displayState, skirts, latestBuild, manifest (`vectors` tolerance, v1/v2 `levels`), vectors (frame E−E0 / z=−(N−N0), densify, drape, spatial lookup, labels incl. hidden `Flur 0`), streaming (levels, quadtree selection, budget/LRU, low-pass region, pyramid, `heightAtDisplayed`), vectorData (baked z, buckets), aoiStreaming (start AOI, focus outlines, pending count, fly-to refinement), buildings (chunk rects/plan/hysteresis, surface classes, glb round-trip through GLTFLoader), candidates + candidatesManifest (parse/tolerance, labels incl. `along_path`, filter, N/P order, outlines, review store re-attach, confirm → reset → confirm reuses the marker, default min score), measure (lengths, area vs shoelace, ground factor, profile sampling, slope, formatting, GeoJSON, fetch limit), report (coordinate formats incl. DMS carry, escaping, template has no script + only this marker, tile maths, scale bar, file names), pointcloud + pointcloudsManifest (`sle-pts-v1` decode/encode round trip and header checks, LOD wish/budget water-fill, streaming plan, residency cap with hysteresis, styles/prefs, `pointclouds` tolerance), reconstruction (sle-recon-v1 tolerance, AOI offset, handover URLs both ways, footprints, prefs, glb load + picking at 1×/3×, ghost mode), trees (sle-trees-v1 round trip + header checks, fmix32/id, `trees` tolerance, world frame, nested rank prefixes, crown scale, exactly-one-LOD cross-fade, same anchor in every LOD, lathe winding/budgets), touchGestures (gesture math + fake-DOM runs of pan/pinch/twist/tilt/double tap/inertia/long press), mobileMode (layout/quality detection, Relief cycle, sheets), locate (AOI test, distances, nearest point, German messages, privacy radius), print3d (tile ids ↔ UTM, index/series.json parsing + warnings, tile/set datum, totals, shared edges and keys per datum, `setKeys` for incomplete sets, CLI command incl. `--datum`, display cells, outline runs, prefs)
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
- **Trees (V2.4)** replace the canopy in the default look: instanced CHM trees, see *Bäume*. The canopy stays in the relief lab (🔴 Labor); while it is on, the trees hide.
- **Exaggeration** (`uExag`, 1–5×) is a shared uniform used by terrain, canopy, trees, `surfaceY`/`collisionY`, picking and the HUD (true heights); changing it keeps the camera's true height.
- Distance haze (`uFogDensity`) and the sky dome give depth cues. Colours are written in display space, with no three.js colour management in the custom shaders.

### Extension points

- **Minimap / map sync:**
  - Subscribe with `store.subscribe((s, changed, source) => …, ['E','N','heading','pitch'])`.
  - Write with `store.set({...}, 'map')` (the minimap itself ignores `'map'` writes; today it writes none, flights go through `ctx.flyTo`). Camera-driven updates use the source `'camera'`, hash edits use `'hash'`.
  - Click-to-fly: `ctx.flyTo(E, N, { agl, heading, pitch, lookAt, duration })` returns `Promise<boolean>`: `true` when the camera arrives, `false` if user input interrupts it.
  - Heading is relative to grid north. On Web Mercator use `mapBearingDeg(heading, E, N)` (`map/bearing.ts`, convergence ≈ −1.2° + Mercator skew ≤ 0.1°).
  - Slots: `shell.slots.minimap` (top-right) and the feature host's `panel` (the *Werkzeuge* drawer); see *Shell* for every slot.
- **Markers / picking:**
  - `ctx.pickAt(clientX, clientY)` returns `{ point, E, N, h }`.
  - `raycaster.intersectObject(terrain)` also works: `Terrain.raycast` marches the displaced height field. Chunk meshes have raycasting disabled because their CPU geometry is not displaced.
  - `terrain.heightAt(x, z)` returns the true height (finest resident level) and `terrain.surfaceY(x, z)` the displayed height of the surface actually drawn there (level of the drawn chunk), used for picking, labels and collision.
  - When a click should place a marker instead of locking the mouse, set `controller.opts.lockOnClick = false`.
- **Ground vs. canopy:** `terrain.surfaceY` is always the bare earth (DTM). The drone uses `terrain.collisionGround` (`collisionY`): the DTM (canopy collision removed in V2.1; you fly through the crowns).
- `window.sle` is the `AppContext`. `window` fires `sle:ready` once the coarsest level is resident (the loading box then hides; further streaming shows as "Lade Details … n" with a spinner in the HUD). `window.sle.terrainStats()` returns the streaming stats (resident/drawn chunks per level, `pending`, GPU estimate, evictions).
- `window.sle.step(frames = 1, dt = 1/60)` advances frames synchronously (controller, LOD, render, store sync). Automated Chrome tabs are often reported as hidden, which pauses rAF; use `step()` to render for screenshots and measurements.

## Shell (V2.2) 🧹

`src/shell/` rebuilds the UI around the kept core (terrain engine, store, markers): ADR 0019 (tiers), 0024 (rebuild the shell), 0026 (attribution), 0032 (shell layout + registry). One component set serves desktop and phone (≤ 600 px).

```text
desktop                                        phone (≤ 600 px)
┌───────────────────────────────────────────┐  ┌──────────────────────┐
│ ┌ HUD ──────────────────┐         ( map ) │  │ ┌ HUD ──────┐ (map)  │
│ │ ··N···|···NO···O··    │         (dial ) │  │ │ tape      │        │
│ │ ^ 150 m | 0 km/h  52° │       [?] [cog] │  │ │ ^ km/h 52°│[?][cog]│
│ └───────────────────────┘                 │  │ └───────────┘        │
│ ┌ Drawer ─┐                               │  │ ┌ Drawer (sheet) ──┐ │
│ │ Orte /  │      [Markieren · Messen]     │  │ │        © Quellen │ │
│ │ Werkz.  │ [Fliegen|(-)x1(+)|Orte|Teilen]│  │ └──────────────────┘ │
│ └─────────┘                     © Quellen │  │ [icon bar, aria-lbl] │
└───────────────────────────────────────────┘  └──────────────────────┘
```

- **HUD:** compass tape (1.4 px/°, follows every frame) over one row: height over ground (icon + log mini bar), speed, heading. *Gehen* swaps the height for the walker. Labor's `hud-full` rows hang below.
- **System buttons** *Steuerung* (`?`) and *Einstellungen*: 44 px icon buttons under the minimap dial (`--mm-h` from a `ResizeObserver`), not in the bar.
- **Tempo − / +:** 30 px chips with a 44 px hit area (`::after`).

**Tiers** (*Einstellungen → Stufe*, `localStorage sle.tier.v1`, default Standard; `?tier=labor` overrides for one visit and is dropped when the user picks a tier):

| Feature id | Tier | Panel from | What |
|---|---|---|---|
| `markers` | 🟢 standard | 🔴 labor | MarkerManager, long-press form; list card in Labor |
| `minimap` | 🟢 standard | | game minimap in `slots.minimap` (V2.3, ADR 0036); Labor: layer control on the full-screen map |
| `places` | 🟢 standard | | *Orte* drawer (nearest places, search) |
| `place-stats` | 🟢 standard | | 🏆 *Orte im Vergleich* card in the *Orte* drawer (only with `stats`), see *Orte im Vergleich* |
| `zone-portals` | 🟢 standard | | V2.6b portal markers, „… betreten“ prompt, loading screen, zones ([below](#zones-v26b-)) |
| `tutorial` | 🟢 standard | | V2.9 first-flight tutorial card (once per profile; restart in *Steuerung* / *Einstellungen*), see *Tutorial* below |
| `osm-paths` / `buildings` | 🟢 standard | 🔴 labor | 3D layers; their cards in Labor (only with `vectors` / `models.buildings`) |
| `trees` | 🟢 standard | | V2.4 CHM trees (only with `trees`); switch „Bäume“ in *Einstellungen* (see *Bäume*) |
| `tree-card` | 🟢 standard | | *Baum-Steckbrief*: tap / click a tree → card (only with `trees`), see *Bäume* |
| `quality`, `exaggeration` | 🟡 entdecker | | sections in *Einstellungen* |
| `reconstruction`, `tour` | 🟡 entdecker | | *Werkzeuge* cards (Rekonstruktion 1789, Tour) |
| `relief-lab`, `flight-tech`, `hud-full` | 🔴 labor | | *Darstellung*, *Flug & Technik*, NN/Kurs/E/N/fps HUD rows |
| `candidates`, `marker-tool`, `measure` | 🔴 labor | | F15 review, Markieren + F18 Meldung, F17 Messen |
| `look`, `lens` | 🟢 standard | | V2.5 aerial-photo ground; *Relikt-Blick* toggle in `slots.lens` (key F) |
| `lens-variants` | 🟡 entdecker | | V2.5 lens chips in the tool row (only if the AOI has > 1 variant) |

Standard shows: bar Fliegen/Gehen · Tempo − / + · Orte · *Relikt-Blick* · Teilen (+ QR); corner buttons Steuerung, Einstellungen; minimap; „© Quellen“.

**Rules.** A feature below the current tier is *unmounted* (its wrapper DOM removed, its teardown run), never hidden by CSS. v1 modules without a teardown (global keys) cause a reload on downgrade (toast „Stufe …: wird neu geladen …“; the hash keeps the view); upgrades mount live. `Gehen` keeps the eye `1.7 m` (display) over `terrain.collisionGround`, `×1` speed, pitch −5°; any flight key switches back to fly. The splash („Schauen, nicht graben“ + short source lines) collapses after 8 s or on ×; canvas interaction collapses it only after 5 s; „© Quellen“ (≥ 44 px, `z-index` above drawers and the full-screen map) opens *Quellen und Lizenzen* (manifest rows verbatim + dataset URIs + NOTICE.md link).

**Extension points** (`ctx.shell` = `window.sle.shell`, types in `src/shell/types.ts`; siblings call these instead of editing `src/shell/`):

```ts
shell.registerFeature({ id, tier, label, panelTier?, available?, shortcuts?, replaces?,
  mount(h: FeatureHost): void | (() => void) | Promise<void | (() => void)> }): () => void  // unregister
// FeatureHost: { ctx, shell, panel, tools, places, hud, settings, overlay, services: { labels, markers, minimap, toast } }
shell.tier(): Tier; shell.setTier(t, source?); shell.onTier((t, source) => …): () => void; shell.isMounted(id)
shell.slots.minimap | .lens | .overlay | .tutorial   // V2.3 minimap · V2.5 lens toggle · V2.6 portal/loading · V2.9 tutorial
shell.anchor('move-mode'|'speed'|'minimap'|'places'|'lens'|'share'|'keys'|'settings'|'sources'|'tools'): HTMLElement | null
shell.prompt({ text, action, onAction, keyHint? }): { close() }                  // V2.6 zone portal prompt
shell.loading(title): { progress(p: number | null, text?), close() }            // V2.6 loading screen
shell.firstRun(): boolean; shell.markTutorialDone(); shell.mountTutorial((layer, shell) => teardown?): () => void  // V2.9
shell.setTutorialStart(fn): () => void   // V2.9: „Einführung starten“ in *Steuerung* while set
shell.openDialog({ id, title, body, wide?, onClose? }); shell.openKeys(); shell.openSettings(); shell.openSources(); shell.toast(text, warn?)
shell.moveMode(): 'fly' | 'walk'; shell.setMoveMode(m)
ctx.onFrame((dt) => …): () => void   // runs after controller.update, before render
```

- **Tutorial (V2.9, ADR 0038):** `src/tutorial/` — `steps.ts` (pure step machine + German texts, `tests/tutorial.test.ts`), `Tutorial.ts` (card in `slots.tutorial`, ticks on `onFrame`, `sle:step` and a 400 ms timer because zones own the frame loop), `tutorial.css`. Steps: umschauen (≥ 20° / 8° / 40 m) → fliegen (≥ 120 m) → finden (*Orte* or full map open, or ≤ 1.2 km) → hinfliegen (inside the castle portal radius; without the `schloss-karlsberg` zone: 250 m around the palace ruins) → betreten (castle zone loading/entered). `?notutorial` skips it for one visit; `window.sleTutorial` = `{ start, stop, step, active }` for debugging. **H8 walkthrough:** `pnpm run first-run -- --url http://127.0.0.1:<port>/?aoi=overall` (headless, fresh profile, 390 px touch + 1440 px desktop, reads only the card, real input, no `flyTo`; shots + JSON in `docs/shots/v29/`).
- Minimap (V2.3): `registerFeature({ id: 'minimap', replaces: 'minimap', tier: 'standard', … })` and render into `h.shell.slots.minimap`; set `h.services.minimap` if markers should sync.
- Lens (V2.5): a Standard feature that appends its toggle to `shell.slots.lens` (it then shows in the bar; `slots.lens` is shared, so the feature removes its button on teardown); variants as an Entdecker feature with chips in `h.tools`.
- Keys: pass `shortcuts` rows (with `feature: id`) so the *Steuerung* dialog lists them while mounted; bind keys yourself with `isTyping()` and `modalOpen()` guards.
- Tests: `tests/shell.test.ts` (tiers, registry incl. async/stale mounts and reload-needed, attribution rows + splash timer, walk/speed, keybind rows).

## Zones (V2.6b) 🚪

`src/zones/runtime/` ([README](src/zones/README.md), [ADR 0037](../docs/adr/0037-zone-runtime-host.md)). A zone is a module from **this** build, selected by `runtime.module` ([zone contract → Runtime API](../docs/zone-contract.md#-runtime-api-v26b)).

```ts
// register a zone module (V2.7 castle, bakery runtime): one line in src/zones/runtime/modules.ts
'schloss-karlsberg': () => import('…/zone'),          // module exports mountZone (+ optional hostChrome)

mountZone(ctx: ZoneMountContext): Promise<ZoneHandle>
// ctx  { container, renderer, baseUrl, manifest, tier?, quality?, footprintEN?, onExit(), onProgress(label_de, f), signal }
// handle { enter(spawn), exit(): ZonePose | void, frame(dt), resize(w, h), setTier?, setQuality?, dispose() }

ctx.zones: { portals(), zones(), state(), enter(zoneId, portalId?), exit(), cancel() }   // window.sle.zones
zonePortals(): ZonePortalInfo[]; onZonePortals(cb): () => void   // minimap (V2.3): { zoneId, portalId, name_de, label_de, E, N, radius_m, facing_deg, kind }
ctx.setFrameOwner(fn | null)    // while set, fn(dt) replaces the overworld frame (same rAF / step())
```

- **Portal:** gold ring + beam + gate at the displayed ground (`toDisplayY(h)` or `surfaceY`), label „Name · Hypothese“. Within `radius_m` the prompt „… betreten · Betreten E“ appears, it hides beyond `radius_m · 1.1`. While it shows, **E enters** (it does not climb; Space still climbs).
- **Enter:** controls off, pose + speed + renderer state saved; `shell.loading(name_de)` with summary, disclaimer, attribution and „Abbrechen Esc“; the module chunk loads (0–10 %), then `mountZone` (10–100 %). The zone then owns frames and the shell is hidden.
- **Leave:** „Verlassen“ / Esc / `ctx.onExit()` → `exit()` + `dispose()` → renderer state + pose restored bit-exactly (re-derived from E/N/h when the exaggeration changed meanwhile). A cancel, a load error or a throwing `frame()` lead to the same path, plus one German toast.
- **Testraum** (`testraum`, built-in, procedural, no data): in dev, with `?aoi=fixture`, or with `?testraum`. Portal ≈ 382450 / 5466254 (fixture and overall AOI). `?zoneDelay=<ms>` slows its loading for screenshots.
- **glTF zones (V2.8b, [ADR 0041](../docs/adr/0041-gltf-zone-runtime-walk-on-mesh.md)):** `runtime.kind: "gltf"` → the generic lazy runtime `GLTF_RUNTIME` (`gltfZone.ts`): coarsest LODs first, finer by `until_m`; *Gehen* on the mesh (WASD / drag, touch ▲ Vor ▼ Zurück), *Schweben* toggle; host *Verlassen* + Esc. Zone #2 = Bäckerei Heusser (`bakery`, `?aoi=overall`), built by `tools/capture/run.sh bakery`.

## Spiel-Look & Relikt-Blick (V2.5) 🔍

[ADR 0018](../docs/adr/0018-game-look-relikt-blick-lens.md) (look) · [ADR 0035](../docs/adr/0035-relikt-blick-lens-channel.md) (lens channel, glow, *Merken*). Code in `src/lens/`.

| Part | Standard / Entdecker | Labor |
|---|---|---|
| Ground | aerial photo `ortho` (`look`; AOIs without it keep the old default); a lab overlay is parked | relief lab exactly as before (`store.layer` / overlay restored) |
| *Relikt-Blick* (`lens`, key `F`, button in the bar) | trees fade → relief blends in → candidates glow | same toggle, over whatever the lab shows |
| Variants (`lens-variants`, Entdecker+) | chips in the tool row while the lens is on: *Relief*, *Senken & Wälle*, *Hangkanten*, *Zeitreise* 1840 / 1935 | same |

```text
progress p: 0 ──────────── 0.5 s ────────────▶ 1   (backwards when off; 0.15 s with reduced motion)
trees fade   ███████████████████░░░░░░░░░░░░   p 0 … 0.6
relief mix         ░░░░████████████████████░░░   p 0.15 … 0.85  (× variant strength, 0.88–0.92)
glow                         ░░░░░████████████   p 0.5 … 1
```

- **Channel:** slot C of the terrain shader (`Terrain.setLens({ key, colormap?, stretch?, shade?, tint? })`, `uLensMix`). It never touches base/overlay, the store, the URL hash or saved settings. Slot C streams like the overlay but does not hold back finer chunks (`isComplete` ignores it).
- **Glow:** up to 24 rings (`uGlow[]` = world x, z, radius, strength), drawn in the terrain fragment shader (no extra draw calls), pulsing, radius ≥ 8 px at any distance. Cost control: a bounding circle of all rings (`uGlowBound`, `glowBound()`) lets most fragments skip the loop, and each ring is tested by squared distance before any `sqrt`/`exp` (pixel-identical to the plain loop at 2880 × 1800). Pool = F15 candidates of the public classes, score ≥ 0.5, linear ones along a known path dropped, not *verworfen* in the local review. Selection = nearest to the point the camera looks at (≤ 350 m ahead), re-selected every 0.25 s once the camera moved 8 m / turned 4° (or after 2 s). Candidates are loaded on the first lens-on (reuses `window.sleCandidates` when F15 is mounted).
- **Card + *Merken*:** tap/click a ring (5 px mouse / 12 px touch tolerance) → card with the hypothesis title („Mögliche Grube?“), *eine Hypothese, kein Fund*, up to 3 measures + score, a private note field and *Schauen, nicht graben*. *Merken* writes a marker into `sle.markers.v1` (title „Mögliche … (Relikt-Blick)“, category from the class, note = tag + hypothesis + user note + caution line, parcel from the local lookup). Tapping again edits the note. Markers from F15 *bestätigen* count as already saved. No route, no own location. The card lifts itself above the start splash / „© Quellen“ corner while they would overlap (`layout.ts`; on phones the splash otherwise hid *Merken* in its first 8 s).
- **Lens targets** (trees, zone props): anything that should vanish implements one method. `window.sleTrees` (V2.4b) is picked up without registering, and the DSM canopy is wired internally.

```ts
const off = window.sleLens?.registerLensTarget({ setLensFade(f) { mesh.material.opacity = 1 - f; mesh.visible = f < 1; } });
// f: 0 = normal … 1 = gone; called on change only, current value applied on register; off() resets to 0
window.sleLens?.onChange(() => …); window.sleLens?.setOn(true); window.sleLens?.setVariant('hist_1840');
```

- **API** (`window.sleLens`): `isOn`, `setOn`, `toggle`, `progress`, `mix`, `variant`, `setVariant`, `variants`, `registerLensTarget`, `glowing()` (ids), `open(id)`, `onChange`. The lens is off after a reload; the chosen variant persists (`sle.lens.v1`).
- **Tests:** `tests/lens.test.ts` (state machine, blend curve, variants + tier fallback, glow pool/centre/selection/packing/picking + bounding circle, card text + layout, Merken → marker → reload round trip, dedupe, lens targets, look).

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
- **Wald / Kronendach (`V`):** *Aus* / *Transparent* (opacity slider) / *Voll*, *Mindesthöhe* (default 2 m) (you fly through the canopy; the HUD shows "durchfliegbar" and "im Kronendach" while below the crown tops).
- **Gelände:** *Überhöhung* 1–5×.

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

All registered as shell features in `src/shell/builtins.ts` (see *Shell*).

- **Minimap (F4 → V2.3 game minimap, ADR 0036)**, `src/map/Minimap.ts` + `bearing.ts` + `minimap.css`, Leaflet 1.9.4 in `shell.slots.minimap`:

  | | Compact dial (184 px, phone 128 px) | Full-screen map (⤢) |
  |---|---|---|
  | Orientation | heading-up (default) or north-up via the „N“ rim badge | always north-up |
  | Centre | player, always | follows until dragged; ◎ *Zentrieren* |
  | Zoom | wheel / pinch around the centre | + / −, wheel, pinch, drag |
  | Attribution | „© OpenStreetMap“ (linked) under the dial | Leaflet control |
  | Labor extras | footprint | + layer control, relief opacity |

  - Prefs: localStorage `sle.map.v2` (`mode`, `zoom`, Labor `base`/`overlays`/`reliefOpacity`; seeded once from `sle.map.v1`).
  - Player: arrow + view cone in one divIcon, rotated by `mapBearingDeg` (projected 10 m step in Web Mercator = grid heading + convergence + Mercator skew). Cone opening = horizontal FOV of the 3D camera; radius ≈ 44 % of the dial. Heading-up rotates the Leaflet container by −bearing (CSS); `tests/minimapBearing.test.ts` checks against a three.js camera at 7 spots × 9 headings × 3 pitches, both modes: < 0.05° (limit 1°).
  - **Click → `ctx.flyTo`**: on the rotated dial the click is un-rotated around the container centre (`unrotatePoint`) before `containerPointToLatLng`. Keeps the AGL, pitch ≤ −20°, centres the point. A click on the full-screen map (or on a place/marker/portal) closes it. Esc closes it too.
  - Layers in Standard/Entdecker: OSM, AOI outline, *Bekannte Orte*, *Fundmarker*, zone portals. Labor: the v1 set (relief XYZ with opacity slider, `hist_*`, live DOP20 WMS, Flurstücke/Gemarkung WMS, focus outlines) chosen in the layer control on the full-screen map. Other modules (candidates, reconstruction, point clouds) still add their own layers to `minimap.map`.
  - Footprint (Labor): 12 rays through the screen border against `terrain.intersectRay`, clamped to 2.5 km, ≤ every 150 ms (`footprint.ts`).
  - Zone portals: `minimap.setPortals([{ id, E, N, label }])` draws glowing door icons; click flies there (or `onPortalClick`). Hook for V2.6b `zonePortals()` — not wired yet.
  - `showBounds(points)` / `endTemporaryView()` open and close the full-screen map for a temporary fit (Locate).
  - `fitBounds(bounds, { peekMs })` shows an area: the full-screen map fits it (stops following); the round dial zooms out (`zoomToFitAround`, `fit.ts`) until the area fits around the player, for `peekMs` (4 s) after the current flight, then back to the user's zoom (a user zoom ends the peek; never persisted). `setFocus(bounds | null)` keeps a selected area (place outline): fitted now and, together with the player, whenever the full map opens. Full map: Leaflet's bottom-right controls move up by `--gmm-br-lift` when the shell's „© Quellen“ button would cover them (`cornerLift`); `setFull` fires `sle:map-full` synchronously so the shell re-places that button first.
- **Bekannte Orte (F7)**, `src/pois/`:
  - `pois.ts` (pure): parse `public/data/pois.geojson`, group by type (German labels, fixed order), forgiving search (case-, umlaut- and ß-insensitive; all words must match).
  - `PoiPanel.ts`: the *Orte* drawer (Standard) with search, `nur im Gebiet`, and `in 3D zeigen`.
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

## Viele Orte: Katalog-Modus (S2, contract 3.0) 🗺️

**Two modes.** Without `VITE_CATALOG_URL` (or with `?aoi=…` in the URL) the app is the single-AOI
app as before; a single v3 manifest (`?aoi=ort-homburg`) loads there too (absent tiles of its
`presence` are holes in the quadtree, never errors). With `VITE_CATALOG_URL=<url of catalog.json>`
(e.g. `VITE_CATALOG_URL=data/fixture-v3/catalog.json pnpm dev …`) it opens the catalog
(`sle-catalog-v1`) and overview (`sle-overview-v1`) and streams places around the camera
(≤ 8 km load, > 12 km drop, ≤ 3 manifests in flight, CORS without credentials). A failing catalog
falls back to single-AOI mode; a failing place counts as „stats“.

**Pieces.** `data/globalGrid.ts` (grid constants, tile ids, global addresses, presence bitmaps),
`data/catalog.ts`, `data/overview.ts`, v3 in `data/manifest.ts` (`stripAvif`), `terrain/sources.ts`
(`AoiResolver` / `CatalogResolver`: level 0–1 from the tile owner's manifest, ≥ 2 from the
overview; `none` = hole (parent keeps those quadrants via `uQuadMask`), `pending` = stop refining),
`catalog/` (session manifest, `PlaceManager`, outlines, per-place trees + buildings).
**One frame:** the session manifest covers the session rectangle (overview bbox ∪ 3D places,
aligned at the top level); its SW corner is the one float64 origin and `ctx.manifest.origin`.
Place content sits in a Group at `(E0 − Es, 0, −(N0 − Ns))`; OSM lines are built directly in the
session frame and clipped to each place's tiles. hRef = catalog `height_ref_m`.

**Derived relief (v3 `derived`).** `vat` = live `rvt-vat-combined-v1` in the terrain shader (alt
source 9) from `svf` + `opns_pos` and the per-fragment gradient; TS reference `terrain/liveVat.ts`
(unit-tested). `hillshade`/`slope`/`slrm` map to the live modes (`relief.ts adaptPreset`, slrm →
live-lrm r = 20). Canopy and `dsmAt` = DTM + CHM (`terrain/canopyChm.ts`) when there is no `dsm`.
**AVIF:** the decode worker probes once; without AVIF all `.avif` layers are dropped and a German
hint is shown once (no fallback files). **Vectors:** `densified: false` OSM is densified ≤ 2 m;
`flurstuecke.lines: 'derived'` → boundary lines from the polygons (`vectors/parcelEdges.ts`).
**Minimap:** outlines + names of all catalog places, per-place `xyz.vat` tiles stacked.

## Wege & Flurstücke (F10, F12)

`src/vectors/`, registered in `shell/builtins.ts`; card *Wege* (OSM in 3D), hidden without `vectors.osm`. Since V2.1 Flurstücke are **not drawn in 3D** (no lines, no Flurnummern, no `F` key); their data still loads for the local parcel lookup, and the 2D WMS overlay stays on the minimap. Parcel-line and label notes below are historical.

- **Loading:** GeoJSON is fetched and parsed in `vectors.worker.ts` (main-thread fallback if the worker fails), producing per-chunk segment buckets (`vectorData.ts`). With `heights: "baked"` the file's z is used per vertex; vertices without z are sampled from `HeightQuery` and re-sampled when height data changes. Overall parcels (42 MB) take ≈ 1.1 s in the worker.
- **Lines** are screen-space ribbons: one instance per ≤ 2 m segment (start/end with the *true* DTM height — baked or from `HeightQuery` — and a style index), expanded in the vertex shader to a constant pixel width with a dark casing in the same pass. The shader shares the terrain's `uExag`/`uHRef`/fog uniform objects: `y = hRef + (h − hRef)·exag + 0.3·exag`. Against z-fighting with coarse LODs: a view-space pull toward the camera (0.15 % of the distance × exag) plus `polygonOffset`. `alphaToCoverage` (MSAA) gives soft edges and the distance fade without blending artefacts. Segments are bucketed per 500 m chunk (frustum + distance culling). Bucket meshes exist only within a build radius of the camera (fade end + 500 m: parcels ≈ 2.1 km, OSM 6.5 km) and are disposed beyond it with hysteresis.
- **Styles:** Straße yellow, Wirtschaftsweg orange, Pfad magenta, Bahn light grey, Gewässer blue, Mauer/Graben green (barrier=wall/retaining_wall/city_wall/ditch; fences and hedges are not imported); parcel boundaries thin pale yellow (fade out 0.9–1.6 km).
- **Flurnummern:** pooled DOM labels; each update takes the ≤ 200 nearest label points within 300 m **3D distance** from the camera (grid index, label height = baked z or displayed terrain; so from ≳ 300 m AGL no labels are shown) that are in the view frustum, projected by hand, and **declutters** them greedily nearest-first (a label whose screen box overlaps a nearer one is skipped); dimmed when the terrain occludes them (round-robin ray tests). Updated from `scene.onBeforeRender` (≈ 11 Hz) and on `sle:step`.
- The toggle persists in localStorage `sle.vectors.v1` (`osm`, off by default). Debug handle: `window.sleVectors`.
- **Parcel lookup** (`VectorLayers.lookupLocal`, used by the marker form, *Messen → Punkt*, *bestätigen* and the report): with `flurstuecke.polygons` a point-in-polygon on the parcel polygons (`parcelPolygons.ts`: packed in the vector worker on first use, 100 m grid index, holes/MultiPolygons, any winding, first feature wins on overlap); if the file is missing or fails, the nearest label point ≤ 60 m whose connecting line crosses no parcel boundary; else the live WFS (marker form) or the opt-in online lookup (report). Checked: 3/3 points equal the live SL WFS, incl. a 60 ha forest parcel 836 m from its label point (118 ms incl. the lazy load).

## Gebäude (F11)

`src/buildings/`, registered in `shell/builtins.ts`; the card is hidden when the manifest has no `models.buildings`.

- **Streaming:** one glb per level-0 chunk (contract "Models"), fetched with three's `GLTFLoader` when the chunk rect (grown by 60 m, buildings poke over edges) is within 2 km of the camera, nearest first, ≤ 3 fetches in flight; disposed beyond 2.6 km (hysteresis band in between). A failing chunk (404/parse) is skipped until reload. Planned in `select.ts` (pure, tested), driven from `scene.onBeforeRender` (also by `sle.step()`).
- **Material:** a `ShaderMaterial` (not `MeshLambertMaterial` + `onBeforeCompile`) sharing the terrain's uniform objects: `y = hRef + (y − hRef)·exag` in the vertex shader on the true heights in the glb, normal `(nx, ny/exag, nz)`; Lambert from the terrain sun (`uSunAz/uSunEl`) + hemisphere ambient; the terrain's haze. Colours are display-space like the terrain shaders (no scene lights, no colour management). Clay walls, terracotta roofs, grey ground/closure from the `_surface` attribute (fallback: classified from normals). Back faces are lit from the visible side (robust to flipped LoD2 winding). Screen-door fade 1.5–1.95 km so chunks don't pop.
- **Picking/culling:** meshes don't raycast (CPU positions are not exaggerated) — `pickAt` still hits the terrain; per-mesh bounding spheres follow the exaggeration for frustum culling.
- **Default on** (orientation in towns; buildings don't hide relief under the forest), persisted in localStorage `sle.buildings.v1`. Off frees the meshes. Debug handle: `window.sleBuildings` (`layer.stats`).

## Bäume (V2.4) 🌲

`src/trees/`, one call in `main.ts`: `installTrees(ctx)`. It adds the layer, updates it via `ctx.onFrame` and registers the 🟢 Standard feature `trees` (switch „Bäume“ in *Einstellungen*, `localStorage sle.trees.v1`, default on). Data: contract „Trees“ (`sle-trees-v1`, `trees/{i}_{j}.bin` per 500 m chunk, records sorted by `fmix32(id)`); no `trees` in the manifest → inert API, no feature. Decisions: [ADR 0017](../docs/adr/0017-real-trees-from-chm.md), [0030](../docs/adr/0030-conifer-fill-trees.md), [0034](../docs/adr/0034-tree-lod-rank-prefix-dither.md).

```ts
installTrees(ctx) → TreesApi { available, visible, on, update(dt) /* only without onFrame */, setVisible(on),
                               setLensFade(0…1) /* V2.5 lens: dithered fade-out per tree */, stats(), layer, dispose() }
import { decodeTrees, treeChunkRef } from 'app/src/trees/treeData'   // pure, DOM/three-free: castle zone reuse
window.sleTrees.stats() → { resident, loading, failed, trees, instances: { near, mid, far }, meshes, triangles, gpuBytes, params }
```

| Piece | How |
|---|---|
| 📦 Streaming | per chunk, planned by the buildings' pure `planChunks`: load ≤ `max` + 150 m, drop > 1.25·`max` + 300 m, ≤ 4 fetches, failed chunks never retried. One interleaved instance buffer per chunk, 8 floats/tree `(x, g, z, h, r, rank, seed, kind)` ≈ 7.3 MB at Hoch |
| ⛰️ Ground | anchor `y = hRef + (g − hRef)·exag` from the record's `g`; trees themselves are not exaggerated. Trunks and far cones reach `0.5 + 0.0012·d` m below the ground |
| 🌲 Shapes | lathe meshes from per-kind profiles (conifer: tiers, broadleaf: round crown on a long trunk, unknown: ovoid), `h` and `r` from the record, ±10 % `r` and rotation from the id seed. Near: 7 sides + trunk · mid: 5 sides + trunk · far: 5-sided cone to the ground (≤ 20 tris) |
| 🎲 Thinning | density `D(d)` = 1 up to `full`, then `(full/d)²`, 0 at `max`. A tree is drawn while `rank = fmix32(id)/2³²` < `D·(1+fade)`: nested **prefixes** of the record order, so each chunk's `instanceCount` is one binary search; trees dither in/out over the last 8 % of rank. Crown radius × `min(2.5, 1/√falloff)` keeps the thinned far forest closed |
| 🔀 Cross-fade | near / mid / far read identical rows (near = verbatim copy of the rows within its radius) → same position in every LOD. Bands `[0.75, 1]·nearEnd` and `[0.8, 1]·midEnd`: inner mesh keeps a pixel if `t < w`, outer if `t ≥ w` (`w = 1 − smoothstep`, `t` = screen IGN dither + per-tree offset) → every pixel from exactly one LOD, no alpha sorting. Outside its interval an instance collapses in the vertex shader |
| ⚙️ Quality | vegetation radius = `streaming.canopyDistance`: Hoch 2000 → `max` 3000 m · Mittel 2250 · Niedrig 1500 · Mobil 1050 (`lodParams`) |
| 🍃 Wind / fill | sway ≤ 1.2 % of `h` at the top, same formula in every LOD. Fill trees (`type & 0x80`) look the same; their row keeps `kind + 4` |
| 🧪 Labor | relief lab *Wald* ≠ aus shows the F5 DSM canopy instead (trees hidden, F5 code unchanged) |

**Checked** (overall, `scripts/trees-shots.mjs` → `docs/shots/v24b/`, git-ignored):

| Check | Result |
|---|---|
| `g` vs. rendered terrain | = 1 m DTM within 2 mm (p95) up to 1.5 km, 3 views; coarse far terrain ±2.1 m beyond (sub-pixel there) |
| Count | resident trees = manifest counts (205,831 in 100 chunks, 0 mismatches); every record drawn within `full` |
| Ortho, H7 plots | P3 orchard tree-for-tree on the crowns; P2 broadleaf density and gaps; P1 spruce block vs. broadleaf margin and path |
| No popping | unit tests (same anchor, exactly-one-LOD, monotone visibility, conservative prefix); 240 m frame-diff walk: peaks follow the trees-off peaks, no isolated spikes |

### Baum-Steckbrief 🌳 (plan „Orte im Vergleich“ §4, §8 Phase 0 + 1)

Tap / click a tree in 3D → a floating card (desktop: at the side away from the tree; phones: bottom sheet; `Esc` / × closes). Feature 🟢 `tree-card`, registered by `installTrees`. Verification handle: `window.sleTreeCard.pickAt(x, y)`, `.close()`, `.open`.

| Piece | How |
|---|---|
| 🎯 Picking | The instanced trees have no CPU geometry (`mesh.raycast` is a no-op), so `TreeLayer.pick(ray)` tests the camera ray against one vertical cylinder per resident row (`treePick.ts`): displayed ground `hRef + (g − hRef)·exag` up to `+ h`, radius = the shader's crown radius bound (`r · 1.1 · crownScale(d)`); only trees the shader draws (existence ≥ 0.5 incl. lens fade); chunk boxes the ray misses are skipped. Exact hits beat near misses (6 px mouse / 14 px touch slack); nearest along the ray wins; a terrain hit ≥ 3 m before it (ridge) cancels. Far forest is not picked (crown < 2.5 px or > 1.5 km), so a click there still captures the mouse. ≈ 0.6–0.9 ms per pick incl. card render (overall, ≈ 105 k resident trees, headless) |
| 🖱️ Input | window capture listeners like the lens: click ≤ 5 px / < 600 ms (touch ≤ 12 px) on the canvas; a mouse hit suppresses that click's pointer lock. Touch waits 300 ms so a double tap still zooms. Off while *Markieren* / *Messen* own taps, inside zones and while the trees are hidden (switch, lens, relief-lab canopy) |
| 📋 Card | type (🌲 Nadelbaum / 🌳 Laubbaum / 🌳 Baum by `treeGroup` = `tree-group-v1`: a „wahrscheinlich“ species class wins over the DOP colour type, an unsure class that disagrees with the colour gives „Baum“; „Baum“ while the species grid loads; chip „geschätzte Position“ for fill trees + note), height ± 0,5 m, crown diameter, trunk diameter, biomass and CO₂ as ranges with „Schätzung“ (`treeAllometry` = TS twin of `stats.py` `crown-allometry-v2`: same formula, ρ by the tree group, lo/hi factors; a unit test pins the Python numbers), historic forest, Gemarkung, Riesenbaum note when the id = a place's `tallest.id`, tree id; „Quellen und Methode“ collapsed. No parcel / owner data (G3) |
| 🗺️ Historic forest | manifest `forest_hist` (`sle-forest-hist-v1`), loaded once on the first card: PNG decoded as data (`colorSpaceConversion: 'none'`), size and value set (0–15, 255) checked, else absent. Wording (`forestSummary`, contract app rule): one map is one snapshot, so „laut Karte 1935–40 wahrscheinlich Wald“ (+ „Schätzung“); „seit …“ only when ≥ 2 classified epochs with a map at the point agree („laut Karten seit mindestens 1836–41 wahrscheinlich Wald“, or „laut Karten seit … (1800: kein Wald erkannt)“); „1935–40: auf der Karte kein Wald erkannt“; no readable epoch → „Historische Karten hier nicht auswertbar“. 1840 is not `classified` today („1836–41: nicht auswertbar“, the reason as tooltip). Map name + attribution under „Quellen und Methode“ |
| 🌲 Baumart | manifest `species` (`sle-species-v1`, DLR Tree Species Germany 2022, CC BY 4.0), PNG loaded once like `forest_hist`; a 404 / decode error / size mismatch → no row. `speciesAt` = TS twin of `pipeline/species.py` `tree_species` (cell lookup, 3 × 3 block incl. edges, one-sided contradiction for a conifer-coloured crown in a broadleaf class, integer half-up to 10 %, 10–90 %); `tests/treesSpecies.test.ts` checks the contract vectors and three real `overall` points computed with the pipeline. Row: „wahrscheinlich Buche (70 %)“ / „Eiche? unsicher (30 %)“ + „Schätzung“ + „Satellitenkarte 2022, 10-m-Raster: Bestand um den Baum“ (contradiction / weak class notes); no class → „keine Angabe (außerhalb der Waldkarte)“ or „(… Kronendachverlust)“. DLR credit under „Quellen und Methode“ |
| ⏳ Alter | `treeAge` = TS twin of `pipeline/forest_age.py` `tree_age` (`tree-age-height-v1`: h − 2 m on the contract's yield tables, species group from the species row else the tree type, Python half-to-even 5-year rounding): „etwa 75–120 Jahre“ / „etwa 75–100+ Jahre“ / „über 100 Jahre“ + „Schätzung“; outside the DLR forest mask (or without `species`) adds „gilt für Waldbäume; frei stehende Bäume sind meist älter“. No row below 8 m |
| 🏘️ Gemarkung | point in the `stats/places.geojson` outlines (even-odd, 10 m simplified) → „Gemarkung <Name>“ + button „Orte im Vergleich ›“, which fires `PLACE_OPEN_EVENT` (`sle:place-open`); the panel opens the *Orte* drawer and that place's card (phones: the tree card closes) |
| 📍 Selection | small ▼ pin above the crown (Labels3D, lift `h + 0.5`, same ground rule) |
| 🏆 Riese | the id in a place's `riesen` → chip „Riese Nr. k“ + note; every open fires `TREE_CARD_OPEN_EVENT` (`sle:tree-card-open`, `{ id, E, N }`), the places panel counts it for „Riesen entdeckt“ (the card says so). Context data (places, forest mask, species) are kept after the first card, so later cards render without „lädt …“ |

## Orte im Vergleich 🏆

`src/places/`, one call in `main.ts`: `registerPlaceStats(ctx)` → 🟢 Standard feature `place-stats`, mounted only when the manifest has a valid `stats` key (contract „Place statistics“, `sle-stats-v1`; decision [ADR 0049](../docs/adr/0049-orte-im-vergleich-places-only.md), plan [Orte im Vergleich](../docs/plans/orte-im-vergleich.md) §5/§8).

- **Where:** a collapsible card in the *Orte* drawer, between „Nachbauten zum Betreten“ and „Bekannte Orte“ (it is about places, needs no tools, and is the playful entry to the data, so Standard, not Labor). Phones (ADR 0014): the same card in the bottom sheet; chips scroll sideways, no page scroll; fly-to frames the place above the sheet (`framedPose`: the camera keeps its oblique pose near the target and looks down more steeply; the pose is flown to directly, so no look-at point falls outside the terrain). While a sheet is open the shell lifts „© Quellen“ above it (`Shell.ts` `syncCorner`), so it covers no card values.
- **Boards:** generic from `disciplines` (emoji + `name_de` chips; `ready: false` → „bald“). Ranking rule per contract (finite values only, ties share a rank, `complete: false` and `null` listed unranked). *Sonnenstärkster Ort* (`scope: municipality`) is a Gemeinde board with a note why (MaStR only per Gemeinde). Places are labelled „Gemarkung …“; badges: Stadt/Dorf, „andere Befliegung: 56 % 2022“ (explained in the card: RLP-Befliegung, trees ≈ 20 % higher from `method.crown.params.rlp_border_effect`), „unvollständig“.
- **Tap:** fly to the place (oblique, like the POI list), outline it in 3D (DrapedLines, clipped to the AOI rectangle in metres = `size × cellSize`, `aoiRect`; exaggeration in the shader) and on the minimap (full outline, `Minimap.setFocus`: the dial zooms out briefly, the full map fits it; card button *Auf der Karte* opens it). A place mostly outside the 3D area (or with its label outside) is flown to at the centroid of its part inside the AOI (`insideFocus`) with the card notice „Nur x % … liegen im 3D-Gebiet“; none inside → no flight, the full map shows it. Then open the place card (area, parcels, trees, crown, Ortslage green/sealed/canopy, inhabitants, trees per inhabitant, Riesenbaum, biomass and CO₂ as ranges labelled „Schätzung“, PV of the Gemeinde, LiDAR epochs, 3D share), with `disclaimer_de` and the `attribution` under „Quellen und Methode“.
- **Riesenbaum:** while that discipline is chosen, a pin per place at `tallest.E/N` (3D: tip at displayed ground + true height; minimap: 🌲 marker); tap → fly to the tree, framing the crown top (pin tip). Phones show the short pin text „🌲 60,9 m“ (`giantPinText`, name in the tooltip), so the label stays clear of the minimap dial. The pin is always our own marker (also for `in_trees: true`, where it sits on the rendered tree; the tree layer has no highlight API yet). Tops outside the AOI show only on the map.
- **Phase 1 card sections** (collapsible, open state kept while the panel lives; all optional, a missing / malformed block hides its section; contract UI rules G7):
  - 🌲 *Riesen von …* (open): `riesen` (≤ 10), rank, height, species „wahrscheinlich Douglasie (80 %)“ / „Lärche? unsicher (40 %)“ + „Schätzung“ (labels from `labels_de.species`), tags „✓ entdeckt“ / „nur auf der Karte“. Tap → fly to the crown top (outside the 3D area: in-card note + the place) and mark it: 3D pin „🌲 Nr. 5 · 44,6 m“ at the crown top (true height), numbered minimap dots for all Riesen of the place (✓ when discovered, the tapped one highlighted; a dot click does the same as the list).
  - 🌳 *Baumarten im Wald* (open): stacked bar + legend of `species.mix` (crown share), with coverage („gilt nur für den Waldteil: 78,1 % …“), conifer share, DLR 2022, „Schätzung“. `weak` entries (Erle, „andere Laubbäume“) are hatched, labelled „Erle?“ and explained in a line below (Thünen agrees for < 10 %).
  - ⏳ *Waldalter und alter Wald*: age class bar (`labels_de.age_classes`), median, and the 1935 share as a snapshot („Laut Karte 1935–40: 44,8 % … Eine Karte ist eine Momentaufnahme, kein „seit““); `null` → „keine Angabe, die Karte deckt nur x % … ab“.
  - 🦋 *Gemeldete Artenvielfalt*: expected species per 500 records with range, species, records + years, iNaturalist share; few records → „zu wenige Meldungen“ + the 150-record value; „gemeldete Beobachtungen, keine Bewertung der Natur“.
  - ☀️ *Dächer und Sonne*: usable roof area (`usable_m2`, the kWp base; sub-line „von ≈ … m² geeigneten Dachflächen“; files without it show the suitable area as „Geeignete Dachfläche“), kWp range („Schätzung“), buildings; the Gemeinde's MaStR kWp and `pv.used_pct` („11,2–14,9 % genutzt“) or its `used_pct_reason_de`. The municipality card shows roof potential + used share too.
  - 🗺 *Nutzung laut Kataster* (only when `nutzung` is set: RLP today), 🎯 *Ziele bis 2030*: per goal a baseline bar on an honest 0-based scale (`%`: 0–100) with a target tick, „Ausgangswert … → Ziel …“, and „Fortschritt: ab der nächsten Befliegung“ (`lidar`) / „sobald Meldungen vor Ort möglich sind“ (`community`); never a progress bar while `progress` is null.
- **🦋 Artenvielfalt board:** generic (no code of its own); the board shows `description_de` and the discipline's `note_de` caveat; Mörsbach / Bechhofen (`rarefied_500: null`) are „keine Daten“.
- **Local collecting** (`collect.ts`, ADR 0022): progress row at the top of the card „🌲 Riesen entdeckt x/48 · 📍 Orte besucht x/9“ + „Nur auf diesem Gerät gespeichert, nichts wird übertragen.“ A Riese inside the 3D area counts when the camera comes within 150 m (3D: horizontal distance and camera height above ground vs. tree height) or its Baum-Steckbrief opens; a place counts when the camera is over its outline below 1,500 m above ground (checked every 0.5 s). Automatic fly-tos never collect (`collectGate`: nothing while `controller.flying`, seen every frame), and after one — and likewise after the app start and a reset (`newCollectGate` is armed, `armCollectGate`) — no place counts until the camera moved 100 m from that pose (the framed arrival pose can hover over the neighbouring Gemarkung; the default start lies in Homburg). Riesen are not held back after a flight, but the list's fly-to ends ≥ 160 m away, so it does not discover the Riese; the card notice says to fly closer or tap the tree. localStorage `sle.orteCollect.v1` = `{ version: 1, riesen: { <tree id>: 'YYYY-MM-DD' }, places: { <place id>: 'YYYY-MM-DD' } }` (ids and dates only, no positions or track), every access in try/catch (private mode: progress lasts until reload). „Zurücksetzen“ needs a second tap within 4 s. Board rows mark visited places „✓“. New finds flash the progress row; a toast only where it covers nothing (not over the phone sheet or the phone tree card).
- **Toast fix (phones):** messages about the open card (place mostly outside the 3D area, Riese outside) go into a highlighted notice line at the top of the card instead of the shell toast, which covered card rows on phones; the share uses the card's rounding (`fmtShare`, 0.1 pp: „Nur 1,3 % …“, not „1 %“).
- Prefs: chosen discipline in `localStorage sle.placesCmp.v1` (per viewer; `discipline` = Ortsteile level as before, `byLevel.<level>` for other levels, `level` = last switch). No global keys.
- **🗺️ Levels Gemeinden / Ortsteile (S1, [ADR 0051](../docs/adr/0051-leaderboard-levels-gemeinden-ortsteile.md), contract „Gemeinde level“):** `levels.ts` reads the AOI manifest's `stats_levels` (`parseStatsLevels`, `levelChoices`: ≥ 2 levels incl. the own one), probes the other level's manifest at start (`probeLevel`; a stats-only manifest such as `saarland` is fine, it is only read for `stats`; `validateManifest` refuses `kind: 'stats-only'` as a terrain AOI) and loads its places.json + outlines on the first switch (`loadLevelData`; wrong level / unreachable → the level is dropped, no switch: R9). A switch *Gemeinden | Ortsteile* tops the board and every tab of the full view; one level at a time (board, card, Medaillenspiegel, Vergleichen, „So kommt … nach oben“; `buildMatrix` also drops places whose `kind` belongs to another level). Size classes come from `categories_de` (Gemeinde level: Alle / Städte / Gemeinden by legal status). `discipline_state`: a discipline that is `pending` for some place is a ⏳ chip whose board says „wird noch berechnet (LiDAR-Auswertung x %)“ and is listed above the table instead of a column; `none` everywhere → hidden; a pending place is unranked „wird noch berechnet“. Gemeinde cards („Stadt Homburg“ / „Gemeinde Kirkel“): status box 🙋 *Ortspate gesucht* (link to https://github.com/Open-Kirrberg; table rows carry a small 🙋 link, board rows an inline 🙋) or 🏗 *3D im Aufbau*, area, inhabitants, forest share (DLR map), LiDAR values or „⏳ wird berechnet“, PV, 3D share computed from the outline; their `ortsteile` as buttons → that Ortsteil card (level switch + fly). Ortsteil cards link up „Gemeinde X im Gemeinde-Vergleich ›“. A Gemeinde with no part in the 3D area is never flown to in 3D: the card says so, the dial peeks at the outline (`setFocus`) and *Auf der Karte* (primary) opens the full map; partly inside → flight to the inside part with „Nur x % …“. While the Gemeinde level is on, all Gemeinde outlines are drawn dashed on the minimap (`PlaceLayer.setLevelOutlines`, not interactive); in 3D only the selected outline, clipped to the AOI. Collecting („Orte besucht x/9“, Riesen) and the tree card's place link stay on the own level. Deep link: `?vergleich=a,b&ebene=gemeinde` (the copy button writes `ebene` when levels exist); old links without `ebene` open the own level, whatever level the viewer used last.
- Not verified: live flight feel and real-phone touch (headless checks with `window.sle.step`, 390 × 844 and 1440 × 900).

## Rekonstruktion 1789 (F19)

`src/reconstruction/`, registered in `shell/builtins.ts` (`initReconstruction`, async). The dataset is **not** in the manifest: the app fetches `<data root>shared/karlsberg1789/index.json` (contract "Shared datasets", sle-recon-v1), written by the castle viewer (`cd schloss-karlsberg && pnpm run export:explorer`). 404 / invalid / outside the AOI → no card, no keys, one console line. `vite build` does not copy `public/data/shared/` into `dist/` (`preview` serves it from the data dir).

- **Model:** one glb (`buildings.glb`: ≈ 92 nodes, LOD1 exterior, `COLOR_0` + `_CONF`, `EXT_meshopt_compression` decoded with three's bundled `meshopt_decoder.module.js`), loaded on first switch-on, freed when switched off. The layer group is translated by `(E0_model − E0_aoi, 0, −(N0_model − N0_aoi))` so `karlsberg` and `overall` line up; any node transform (quantization) is baked into float positions. Building ids come from the raw glTF node names (`GLTFLoader` sanitises `Object3D.name`, `site:x` → `sitex`).
- **Material** (`ReconMaterial.ts`): `ShaderMaterial` like the LoD2 buildings — shares the terrain's `uExag`/`uHRef`/sun/fog uniform objects, exaggeration applied in world space in the vertex shader. *Farbe*: **Material** (COLOR_0, linear → sRGB) or **Konfidenz** (`_CONF`: hoch `#009E73`, mittel `#E69F00`, niedrig `#CC79A7` — Okabe–Ito, colour-blind safe, legend with words; minimap outlines for *niedrig* are dashed too). **Deckkraft** 15–100 % (*Geister-Modus*): below 100 % a depth-only pre-pass (opaque list, after the terrain) plus a blended colour pass (depth "≤"), so only the front surface is blended over today's ruins.
- **Picking:** a plain click (≤ 4 px, < 500 ms) on the model opens the info card (name, id, class, confidence, eaves/ridge height, ≤ 3 sources, disclaimer, attribution) and highlights the building; that click does not capture the mouse. With the mouse captured, a click picks under the crosshair. Inactive while *Markieren*/*Messen* own the click. The ray is mapped display → true heights (affine in y) and tested against the true geometry; terrain in front wins.
- **Minimap:** footprints (`footprints.geojson`, EPSG:25832 → WGS84 via proj4) coloured by confidence while the layer is on; click = info card + fly to the building. Only footprints whose building the 3D layer shows on this AOI are drawn (`ReconLayer.partShown`, before the glb is loaded the same rule on the footprint's EN bbox: `footprintShownOnAoi`), so KL-B40–49 are absent in AOI `karlsberg`.
- **Schloss betreten:** toolbar buttons *Schloss betreten* / *zu Fuß* appear only with the layer on and the camera ≤ `anchor.enterRadius_m` (300 m) horizontally from the palace; also in the card (disabled with a distance hint when far), keys `T` / `Shift+T`, `Shift`+click = zu Fuß. Opens `<viewer.url>?src=explorer&E&N&h&heading&pitch&mode=fliegen|gehen&back=<this URL incl. fresh hash>` in the same tab (`recon.ts` `buildViewerUrl`, true height from the displayed y, grid heading, 0.1 m / 0.1° rounding; tested). The viewer's *Zurück zur Karte* returns with the first five hash fields replaced (`backTargetUrl` is the executable form of that rule). The viewer URL from the dataset must be a local http(s) URL, else `http://localhost:5260/`.
- **Prefs:** localStorage `sle.reconstruction.v1` (`on`, `mode`, `opacity`; default off). The URL hash is unchanged. Attribution entries join the footer while the layer is on (`reconFooterText`: prefixed with *Rekonstruktion 1789 (Hypothese):* only when the first entry does not already name the reconstruction). Debug handle: `window.sleRecon` (`layer.stats`, `handoverUrl(mode)`, `inRange()`).

## Messen (F17)

`src/measure/`, registered in `shell/builtins.ts` (`initMeasure`); toolbar button *Messen* and card *Messen*. Debug handle `window.sleMeasure` (`addVertexUtm(E, N)`, `finish()`, `list`).

- **Modes:** Strecke (polyline), Fläche (polygon), Höhenprofil (polyline), Punkt. `L` / button toggles; mutually exclusive with *Markieren* (`exclusiveWith`), `controller.opts.lockOnClick` is restored to the value found before the first mode started. Clicks ≤ 4 px / < 600 ms → `ctx.pickAt`; the second click of a double-click adds no vertex.
- **Metrics** (pure, `geometry.ts`, `profile.ts`, `model.ts`, tested in `tests/measure.test.ts`): horizontal length / perimeter / shoelace area in the UTM grid (primary values; they match Leaflet's spherical distance to ≈ 0.3 %). *Naturmaß* = grid · ground factor (1/k · (R + h + 48 m geoid)/R; k ≈ 0.99977 here, total ≈ +0.028 %). 3D length, Δh, ascent/descent, min/max/avg height and slope (Ø/max, central difference over 2 m) from DTM samples every ≤ 0.5 m (vertices exact).
- **1 m heights:** `heights.ts` (`MeasureHeights`) uses the terrain's resident level-0 chunks along the line, fetches + decodes missing level-0 DTM (and DSM for profile/point) chunks itself (one lazy decode worker, ≤ 3 at a time, LRU 32), else falls back to the finest resident level and the card warns with the share of non-1-m samples. Checked: profile heights equal bilinear samples of `data/work/*/dtm.tif` to < 5 mm (Karlsberg + an overall line 3 km from the camera: 100 % level 1 before, 0 % after the fetch).
- **Profile chart:** 2D canvas in the card: DGM solid + fill, DOM dashed (only where the DSM exists), min/max marks, axes in m, chart exaggeration shown; hover → readout (distance, DGM, DOM, slope) + a 3D cursor dot.
- **3D:** lines/outlines are `DrapedLines` with their own colour table (cyan done, yellow selected, white draft; true heights per ≤ 2 m vertex, exaggeration in the shader); vertex dots, value tags and the profile cursor are `Labels3D` elements; the rubber band to the cursor is a CPU line re-placed per frame with `surfaceY` (depth test off).
- **Punkt:** E/N, DGM height, DOM height + height above ground, WGS84, Flurstück via `lookupParcel` (local F12 data first, else ALKIS WFS 414; one request per point).
- **Storage / export:** per AOI in localStorage `sle.measure.v1.<aoi>` (profiles not stored, rebuilt on selection). *Export* → `messungen-YYYY-MM-DD.geojson`: WGS84 `[lon, lat, h]` (Point / LineString / closed Polygon), properties `id, kind, label_de, created, summary_de, vertices_utm [[E, N, h]], metrics{…}` (+ `E, N, h, lat, lon, parcel` for points, `profile{d_m, dtm_m, dsm_m}` for profiles).

## Verdachtsflächen (F15)

`src/candidates/`, registered in `shell/builtins.ts`; card *Verdachtsflächen* (only if the manifest has `candidates`). Data from `pipeline/detect.py` (contract "Candidates"); **hypotheses, private, local only**. Debug handle `window.sleCandidates`.

- **Display:** outlines (or a circle of `diameter_m`, 5 m fallback) as `DrapedLines` with baked heights (else terrain sampling), exaggeration in the shader; colour per class, grey for "Weg (bekannt)" (`linear` + `along_path`; `near_path` is informative only); minimap circles only while the layer is on. `X` toggles (persisted per AOI in `sle.candidates.prefs.v1.<aoi>` together with the filter, `candidates/prefs.ts`; the first AOI opened inherits the old shared key once, with the min score reset to that AOI's default, then the old key is deleted).
- **Filter:** class chips + "Weg (bekannt)", min-score slider starting at `params.min_score` (0.3), not the mask threshold. `N`/`P` step through the visible candidates in score order and fly there (`flyToSiteExag` / `framing.ts`, 45–160 m out: aims at the **displayed** height at any exaggeration and raises the camera when a ridge would block the view; also used by markers, measurements and the report); both ignore text fields and modifier keys.
- **Review:** *bestätigen* / *verwerfen* / *unsicher* per AOI in localStorage `sle.candidates.v1.<aoi>`; decisions re-attach to the nearest same-class candidate within 3 m after a re-run; *verworfen* hides the candidate. *bestätigen* creates a normal private marker (category from the class, reasons + metrics + disclaimer in the note); confirming again (also after *zurücksetzen*) reuses that marker; the parcel is looked up locally and stored on it (`MarkerManager.setParcel`). Un-confirming offers inline *Marker löschen / Behalten* (`MarkerManager.delete`); nothing is deleted automatically. Decisions export = local download `verdachtsflaechen-entscheidungen-<aoi>-YYYY-MM-DD.json`.

### Bombentrichter / Trichterfelder (moved out)

`crater`/`crater_field` (saar-lidar-detect, UXO indicators) are ignored in every build; the viewer moved to the private repo `sle-craters-private` in V2.1 ([ADR 0010](../docs/adr/0010-craters-never-public.md)).

## Meldung (F18)

`src/report/`, opened from a marker (⎙ in the list, *Meldung erstellen* in the form). Builds **one self-contained HTML file** and offers it as a download (Blob + `a[download]`, `meldung-<titel>-YYYY-MM-DD.html`); nothing is ever sent.

- **Content:** title, category, notes, date; UTM 32N, WGS84 decimal and DMS (rounding carry), height, Flurstück; 3D view (1600 × 1000 JPEG, optional fly-to for an oblique view) with only this marker's pin; detail (z18) and overview (z15) map snippets from the AOI's own relief XYZ tiles (layer selectable) with scale bar and north arrow — no OSM or other online tiles; sources/licences and the "Schauen, nicht graben" disclaimer.
- **Privacy:** other markers and POI labels are DOM overlays and never reach the image; the `Candidates` group, `MeasureOverlay` and any object with `userData.reportHide` are hidden during capture (`sle:report-capture` event, phase begin/end). All user text is escaped; inline CSS, no scripts, CSP allowing only `data:` images.
- **Flurstück:** the marker's stored parcel, else `lookupParcelLocal` (parcel polygons, fallback label points ≤ 60 m; no network); the online ALKIS WFS lookup is an opt-in checkbox (sends only the coordinate), off by default.
- **Zuständige Stelle:** LDA Saarland, Bodendenkmalpflege (`www.saarland.de/lda/DE/themen-aufgaben/Bodendenkmalpflege`, § 16 SDschG) and GDKE Rheinland-Pfalz for RLP sites — no postal address or phone (research/03 has none).

## Punktwolke (F16)

🧊 **Frozen in V2.1:** code and tests stay, but `shell/builtins.ts` does not register it (no card, no `C`, not in the bundle).

Classified ALS 2025 points (`manifest.pointclouds`, contract format `sle-pts-v1`) for the focus areas. Off by default; nothing is fetched until the card's *anzeigen* or `C` switches it on.

- **GPU path:** each 100 m tile's record body (offset 16, stride 10 B) is uploaded unchanged as one interleaved `Uint16` buffer (`position` = x/y/h cm, `aMisc` = agl + cls|intensity). three.js takes the GL type from the typed array, so `agl` (i16) arrives as u16 and is re-signed in the vertex shader. The tile origin (E − E0, hBase, −(N − N0)) is computed in float64 and passed per tile; displayed `y = hRef + (h − hRef)·exag` with the terrain's shared uniforms.
- **LOD:** records are randomly ordered, so `drawRange(0, n)` is a uniform subsample. Visible tiles want `f = (120 m / d)²` (≥ 2 %); the global budget (*Punktbudget*, 0,5–8 Mio., default 3 Mio.) is water-filled with one common scale. Point size = drawn spacing projected to pixels × *Punktgröße*, clamped 1,5–14 device px. Tiles load within 1.3 km (nearest first, 4 fetches) and are disposed beyond 1.5 km; switching off frees everything. **Residency cap:** resident points ≤ max(2 × *Punktbudget*, 2 Mio.) — walking tiles nearest first, those past the cap are evicted farthest first and loads stop at 90 % of it (hysteresis). Each resident point costs 10 B on the GPU plus 10 B on the CPU (the tile buffer stays referenced), so the default cap is ≈ 60 MB GPU + 60 MB CPU; these bytes are *not* counted in the terrain's GPU estimate/LRU (`layer.stats.gpuBytes` reports them).
- **Röntgen-Linse:** uses the per-point `agl` field (contract: z − bilinear 1 m DGM, computed by the pipeline), so no terrain texture lookup in the shader; points with `agl > X` are dropped in the vertex shader. *Nur Boden* hides all classes but 2. *Gelände ausblenden* hides the terrain mesh (auto contrast then has nothing to read).
- **Failures:** a failed tile retries after 2 s, doubling up to 60 s, at most 6 tries (`lod.ts` `RETRY`); the status line shows resident points and memory (details in its tooltip). Checked: 13/13 tiles reloaded ≈ 2 s after forced HTTP 503s.
- **Colour modes:** Klasse (palette per LAS code), Höhe (ramp over the nearest area's `heightRange`), ü. Grund (agl 0–30 m), Intensität.

## Einstellungen, Teilen, Einführung, Tour, Qualität (final polish, v1.0)

Since V2.2 the shell wires everything below (bar buttons *Teilen* — with the QR code inside — *Steuerung*, *Einstellungen*; the *Tour* card from Entdecker on).

- **Settings** (`settings.ts`): one versioned localStorage key `sle.settings.v1` — display (layer/overlay/opacity/forest), exaggeration, sun, quality, flight tempo, HUD help, intro seen. The URL hash always wins over it. All access in try/catch: without storage (checked in an iframe whose `localStorage` throws) the app runs with defaults. *Einstellungen zurücksetzen* needs a second click ("Wirklich zurücksetzen? Nochmal klicken"), clears every `sle.*` preference key (incl. per-AOI ones) and reloads with only the camera pose in the hash; `sle.markers.v1`, `sle.candidates.v1.<aoi>` and `sle.measure.v1.<aoi>` are never touched.
- **Ansicht teilen** (toolbar *Teilen* / card button): copies `location.href` (pose, display, exaggeration, sun, active preset — see *URL hash*) to the clipboard and shows a toast ("Ohne Fundmarker/Verdachtsflächen"). Markers, candidates and measurements never enter a link. `clipboard.ts` (pure, tested) waits ≤ 1.5 s for `navigator.clipboard.writeText` (it never settles without user activation), then tries `execCommand('copy')`, else the toast shows the link selectable for manual copying.
- **QR-Code zur Website** (toolbar *QR*, simple layout: *Mehr → QR-Code zur Website*; `src/share/`): modal (Esc, Tab trapped) with *Website* / *Diese Ansicht* (public URL + the same `formatHash` as *Teilen*; disabled while the view would reveal the user's position), QR as inline SVG (`qrcode-generator` 2.0.4, MIT, level M, 4-module quiet zone, offline), the URL as selectable text, *Link kopieren*, *QR als PNG speichern*. Public URL: `VITE_PUBLIC_URL` (default `https://open-kirrberg.github.io/saar-lidar-explorer/`, `share/publicUrl.ts`).
- **Einführung:** the v1 intro overlay is gone (V2.2); the *Steuerung* dialog lists the shortcuts, and V2.9 adds a first-flight tutorial through `shell.mountTutorial`.
- **Tour** (`tour.ts` data, pure + tested; `TourGuide.ts`): 7 stops (Schloss Karlsberg, Orangerie, Karlsbergweiher, Schwanenweiher, Burgruine Merburg, Grabhügel „Rabenhorst“, Hohenburg/Schlossberg), each with a relief preset, distance/height and hedged German text; only stops inside the loaded AOI (karlsberg 3, overall 7). *Weiter*/*Zurück*, *Weiter* on the last stop or `Esc` ends it (an open intro, disclaimer, marker form or report dialog gets its own `Esc` first); with `prefers-reduced-motion` the camera jumps instead of flying.
- **Qualität** (`quality.ts`, pure + tested): *Hoch* (= engine defaults) / *Mittel* / *Niedrig* (+ *Mobil* since F20: pixel ratio ≤ 1.5, pixel error 2, 200 MiB, canopy 700 m, LOD × 0.6, labels × 0.5, buildings 800 m, 0.5 M points; auto on phones, see *Touch (F20)*) set only existing knobs — pixel ratio cap 2 / 1.5 / 1, terrain pixel error 1 / 1.5 / 2.5, GPU budget 600 / 450 / 300 MiB, canopy distance 2000 / 1500 / 1000 m, mesh LOD distances and 3D label distance × 1 / 0.75 / 0.5, building load radius 2000 / 1500 / 1000 m, point budget 3 / 2 / 1 M (only when a preset is picked, and never over a budget the user set with the point-cloud slider). A window resize re-applies only the pixel ratio, so manual *LOD / Debug* slider changes survive. Measured on overall (DPR 2, low oblique view, synchronous `step()` + readPixels, 2 runs): Hoch 2.5–3.1 ms (1.90 M tris, 35 calls), Mittel 1.9–2.5 ms (1.57 M, 28), Niedrig 1.5–2.4 ms (1.15 M, 20).
- **Accessibility** (`a11y.ts`, `contrast.ts`, `polish.css`): `:focus-visible` ring (2 px amber) on every control (115 checked), `aria-label` on icon-only buttons, quality buttons as an ARIA radio group (arrow keys), `Space`/`Enter` on a focused button are not flight keys, HUD/bar/drawer backgrounds darkened so dim text stays ≥ 4.5:1 even over white terrain (lowest measured 5.56:1). Since V2.2 the attribution footer is replaced by the splash + „© Quellen“ (ADR 0026); bottom-anchored v1 UI (toasts, tour, mode hints) sits above the action bar via `--above-footer`.

## Mein Standort & Handy im WLAN (F20)

🧊 **Frozen in V2.1:** `initLocate` is not called and the mobile button is hidden; code and tests stay.

`src/locate/` — card *Mein Standort* (button, *Folgen*, *Kompass*); other UIs (mobile toolbar) use `getLocate()` / the `LocateApi` returned by `initLocate()`: `locateMe()`, `toggleFollow(on?)`, `toggleCompass(on?)`, `flyToNearest()`, `clear()`, `getState()`, `onState(cb)`.

- **Flow:** `navigator.geolocation.getCurrentPosition` (`enableHighAccuracy`, timeout 15 s, `maximumAge` 5 s) → `wgs84ToUtm` → AOI rectangle test (`locateMath.ts`, origin = lower-left). Inside: `ctx.flyTo` 150 m (true) above ground, pitch −45°, plus a pulsing DOM dot (Labels3D, follows the displayed terrain) and an accuracy ring draped as `DrapedLines` (true heights, `y = hRef + (h − hRef)·exag` in the shader; radius = accuracy clamped 5 m … 3 km). Minimap: blue dot + `L.circle` with the accuracy radius. Outside: „Sie sind 12,3 km außerhalb des Gebiets.“, the minimap shows AOI + position (`Minimap.showBounds`: in memory only — follow/zoom are not saved and `endTemporaryView()` restores them on *Zum nächsten Punkt* / *Ausblenden*; while the map is hidden in the closed *Karte* sheet the fit waits until the sheet opens), *Zum nächsten Punkt im Gebiet* flies to the nearest point (150 m inset) looking towards the user.
- **Folgen:** `watchPosition`; the camera re-centres (keeping height and pitch, 1.2 s flight) only after a move > 15 m.
- **Kompass:** `deviceorientationabsolute` (Android/Chrome) or `deviceorientation` + `webkitCompassHeading` (iOS, `DeviceOrientationEvent.requestPermission()` on the button tap); a relative-only `alpha` is ignored. Arrow on the 3D dot (projected grid heading) and the minimap (true heading). No signal within 3 s → „Kein Kompass verfügbar“. Magnetic declination (≈ 2–3°) is not corrected.
- **Errors (German):** denied, unavailable, timeout, no geolocation API, and insecure context (explains HTTPS / `dev:lan`).
- **Privacy:** the position lives only in memory (the layer and the controller closure): no localStorage, not in the store/URL hash, not in reports (`userData.reportHide`; DOM dots never reach the snapshot), no console output, no requests. `LocateState` carries no coordinates. The *camera* pose would give it away too, so `revealsPosition(pose)` (`poseRevealsPoint`, `PRIVACY_RADIUS_M` = 1 km from the camera or the ground point in the view centre; fails closed) suspends the URL-hash writer (`bindHash` `suspend`), blocks *Ansicht teilen* (toast) and drops the pose on an AOI switch — during a locate flight and while the view is within 1 km, also after *Ausblenden* until the camera has left that zone once.
- **Phone access:** `pnpm run dev:lan` = `SLE_HTTPS=1 vite --host 0.0.0.0 --port 5243 --strictPort` with `@vitejs/plugin-basic-ssl` (self-signed certificate, cached in `node_modules/.vite/basic-ssl`; own optimizer cache `node_modules/.vite-lan` so it can run next to `pnpm dev`). It prints the `https://<LAN-IP>:5243/` URLs. Without `SLE_HTTPS=1` (plain `pnpm dev`, build, preview) nothing changes. Geolocation needs a secure context: `http://localhost` is fine on the desktop, `http://<LAN-IP>` is not.
- **Not verified:** a real phone (GPS fix and accuracy, iOS/Android permission prompts, self-signed certificate flow), *Folgen*, the *Kompass* arrow direction, the *Zum nächsten Punkt* flight and the outside-case minimap fit; *Ansicht teilen* being blocked near the user was checked by code path only.

## 3D-Druck planner (moved out)

F21 moved to the separate local repo `sle-print` in V2.1.

## Performance 📏

Yardstick: [ADR 0028](../docs/adr/0028-phone-proxy-headroom.md). The low-end proxy targets 30 fps; real phones are tested by humans only.

```sh
pnpm run build && pnpm exec vite preview --port 5241 --strictPort --host 127.0.0.1 &
pnpm run perf                                  # phone proxy + desktop; JSON + shots → docs/shots/perf-*
pnpm run perf -- --profiles phone --url 'http://127.0.0.1:5241/?aoi=overall'
pnpm run perf:zone -- --url 'http://127.0.0.1:5241/?aoi=karlsberg'   # castle zone (needs zone data): enter, Rundflug, Festsaal walk (src/zones/README.md)
pnpm run perf:gltf -- --url 'http://127.0.0.1:5241/?aoi=overall'    # baeckerei-heusser (U3): portal → loading → street → shop → passage → back (src/zones/README.md)
```

**Method** (`scripts/perf-proxy.mjs`, puppeteer-core with the system Chrome, headless by default since b1023b4 (`--headed` for the V2.0 method: headed so rAF runs and WebGL uses the real GPU — compare like with like); not part of the bundle):

| Step | What |
|---|---|
| Profiles | **phone**: 390 × 844, DPR 3, touch, 4× CPU throttle, 4G (9 Mbit/s, 150 ms RTT) · **desktop**: 1440 × 900, DPR 2, no throttle |
| Load | Cold load (cache off) → `sle:ready` = first rendered terrain; then + time until the streaming queue is empty |
| Views | `sle.flyTo(E, N, {duration: 0})`, wait until streaming settles (`terrainStats().pending == 0`), first-run dialogs dismissed |
| fps | rAF frames over 5 s (p95 frame time), plus the idle-page rAF **ceiling** = display refresh |
| step ms | 30 × synchronous `sle.step(1)` + 1-pixel `readPixels` (CPU + GPU finish), mean |
| Memory | `performance.memory.usedJSHeapSize`, `terrainStats().gpuMB` (terrain textures), `renderer.info` triangles/calls |

**Baseline V2.0** (2026-11-04, v1.5 build on `main`, `?aoi=overall`, MacBook Pro M4 Max, Chrome, ANGLE Metal — no SwiftShader; median of 3 runs):

| Profile | View (E/N, AGL, pitch) | rAF fps | step ms | JS heap MB | terrain GPU MB | triangles | calls | view streamed in |
|---|---|---|---|---|---|---|---|---|
| 📱 phone | Kirrberg church (381455/5462119, 150 m, −30°) | 50 = cap | 5.1 | 125 | 78 | 1.67 M | 26 | 13.8 s |
| 📱 phone | Forest, Karlsberg plateau (382556/5465632, 60 m, −15°) | 50 = cap | 5.7 | 167 | 117 | 1.35 M | 17 | 15.6 s |
| 📱 phone | Schloss Karlsberg (382195/5466095, 120 m, −35°) | 50 = cap | 4.0 | 169 | 117 | 0.75 M | 8 | 0.5 s |
| 🖥️ desktop | Kirrberg church | 50 = cap | 7.4 | 235 | 160 | 3.08 M | 75 | < 1 s |
| 🖥️ desktop | Forest, Karlsberg plateau | 50 = cap | 4.6 | 275 | 203 | 2.12 M | 55 | < 1 s |
| 🖥️ desktop | Schloss Karlsberg | 50 = cap | 6.8 | 298 | 213 | 1.81 M | 39 | < 1 s |

| Load | 📱 phone (4G) | 🖥️ desktop (localhost) |
|---|---|---|
| `sle:ready` (first terrain) | 3.2 s | 0.4 s |
| + streaming done at start view | + 19.7 s | + 0.9 s |

**Read it right:**
- rAF fps sat at the host display's refresh rate in every view (50 Hz external display; one run on the 120 Hz panel gave 120 fps everywhere, phone proxy included). So: no frame-rate bottleneck on this host — **not** a phone number.
- The proxy throttles the **CPU only**. The phone's GPU (fill rate at DPR 3; the app caps the pixel ratio at 1.5 → 585 × 1266 buffer), shader cost and GPU memory are not modelled. `step ms` (≤ 6 ms against a 33 ms budget at 30 fps) is the proxy's main signal.
- The phone layout draws less (castle view: 8 calls, 0.75 M triangles) than desktop.
- Load times use a local server; the phone's 4G emulation is the only network model. Streaming at a new view (≈ 14–15 s on 4G) is the slowest felt thing on the proxy.
- `--uncapped` (vsync off) exists but gave inconsistent rAF numbers; don't use it for baselines.
- Console: 404s for absent AOIs (`homburg`, `kirrberg`) and `print/` (F21) probes — expected, no other errors.

**V2.4b trees** (2026-11-04, same machine, `?aoi=overall`; trees off → on in the *same page*, 20 alternating rounds of 15 × `step(1)` + `readPixels`, median; headless, host loaded by a parallel photogrammetry job, so absolute ms are ≈ 1.2–2× the quiet baseline above):

| Profile | View | step ms off → on | Δ (median of pairs) | calls | triangles | tree instances near / mid / far | tree GPU |
|---|---|---|---|---|---|---|---|
| 📱 phone (Mobil, `max` 1050 m) | Kirrberg | 7.9 → 7.9 | +0.9 | 22 → 33 | 1.75 → 2.19 M | 482 / 15 k / 26 k | 1.6 MB |
| 📱 phone | Forest | 7.1 → 8.0 | +1.5 | 25 → 38 | 1.39 → 2.25 M | 898 / 26 k / 51 k | 2.3 MB |
| 📱 phone | Schloss | 6.0 → 7.0 | +0.9 | 11 → 22 | 0.75 → 1.42 M | 951 / 22 k / 47 k | 2.9 MB |
| 🖥️ desktop (Hoch, `max` 3000 m) | Kirrberg | 10.5 → 13.5 | +2.0 | 75 → 127 | 3.08 → 4.34 M | 482 / 19 k / 74 k | 7.3 MB |
| 🖥️ desktop | Forest | 9.0 → 11.3 | +2.6 | 55 → 103 | 2.12 → 3.55 M | 898 / 32 k / 105 k | 7.3 MB |
| 🖥️ desktop | Schloss | 8.7 → 10.4 | +1.4 | 39 → 73 | 1.81 → 3.45 M | 951 / 30 k / 105 k | 7.3 MB |

- Phone proxy over forest: ≈ 8 ms per frame with trees against the 33 ms budget (30 fps); headed `pnpm run perf` runs sat at the display cap (50 fps) in every view. A quiet-host run before the far crown scale gave phone forest 4.7 → 5.0 ms and desktop forest 3.9 → 7.7 ms (`perf-proxy.mjs`, main vs. branch).
- `triangles` count every submitted instance, including those the vertex shader collapses (outside its LOD band or thinned out).
- Tree GPU memory (`stats().gpuBytes`: instance rows; the per-chunk shape copies add ≈ 2 KB per chunk) is ≤ 7.3 MB, far below the 600 MiB soft cap.

**V2.5 game look + lens** (2026-11-04, `?aoi=overall`, same host, **headless** Chrome since b1023b4 (ANGLE Metal, real GPU), `pnpm run perf -- --lens both`, one run, no other perf run in parallel):

| Profile | View | step ms lens off → on | rAF fps off / on | terrain GPU MB off / on | calls off / on |
|---|---|---|---|---|---|
| 📱 phone | Kirrberg church | 4.3 → 4.2 | 60 / 59 | 198 / 196 | 28 / 28 |
| 📱 phone | Forest, Karlsberg plateau | 3.5 → 4.0 | 60 / 60 | 198 / 199 | 25 / 22 |
| 📱 phone | Schloss Karlsberg | 2.6 → 2.8 | 60 / 60 | 199 / 199 | 11 / 11 |
| 🖥️ desktop | Kirrberg church | 4.4 → 5.0 | 60 / 60 | 558 / 579 | 75 / 75 |
| 🖥️ desktop | Forest, Karlsberg plateau | 3.9 → 4.5 | 60 / 60 | 599 / 599 | 55 / 55 |
| 🖥️ desktop | Schloss Karlsberg | 3.1 → 6.0 | 60 / 60 | 596 / 598 | 39 / 39 |

- 60 fps = the headless rAF cap everywhere; `step ms` stays far below the 33 ms budget. Not a phone number: the proxy's GPU is the M4 Max.
- **The aerial ground fills the terrain texture budget.** `ortho` has 1000 px per 500 m chunk (RGBA8 + mips ≈ 5.4 MB vs. 0.25 MB for a u8 relief layer), so terrain GPU sits at the budget (≈ 200 MB phone, 600 MB desktop) instead of 78–213 MB with the relief look. The budget logic coarsens the far terrain earlier. This is the visible price of [ADR 0018](../docs/adr/0018-game-look-relikt-blick-lens.md).
- The lens itself adds ≤ 3 ms (desktop, 24 rings near the castle at 2880 × 1800). Most of that is the ring loop, which was tightened (see *Spiel-Look & Relikt-Blick*).
- Runs that overlapped another session's perf script were 2–5× slower and were discarded. Compare only runs without parallel GPU load.

**v2 perf pass** (2026-11-04, headless, ANGLE Metal on the M4 Max. These are proxy numbers, not phone numbers. Before = a build of `0bae96b` with its own zone package, after = this pass, each on its own preview port):

| 📱 phone proxy | Before | After | Load avg |
|---|---|---|---|
| Castle zone, Rundflug (3 cold runs, median) | 58 fps · step 24.5 ms · peak **2.78 M** tris in view | 59.5 fps · step 22.1 ms · peak **1.36 M** | 2.4–3.8 |
| Castle zone, spawn | 60 fps · 2.23 M | 60 fps · 1.17 M | 2.4–3.8 |
| Castle zone, „Gehe zu“ Festsaal | 1.6 s sync; next 3 s max frame 150 ms | 0 s; max 33 ms | 2.4–3.8 |
| Castle zone, Festsaal walk | 56 fps · max frame **317 ms** | 60 fps · max 17 ms | 2.4–3.8 |
| Cold castle enter (4G) | 26.9 s · 17.1 MB | **18.2 s** · 9.1 MB | 2.4–3.8 |
| Overworld ortho terrain GPU (Kirrberg / Forest / Castle) | 174 / 189 / 170 MB | 139 / 152 / 159 MB (relief look 72–89) | 2.5–6.5 |
| 🖥️ Overworld ortho terrain GPU, desktop | 459 / 476 / 447 MB | 246 / 288 / 288 MB (relief 149–207) | 4.2–5.6 |

- 🌄 **Aerial ground by need:** each chunk's ortho is decoded at 1000, 500, 250 or 125 px, whichever is the smallest that gives ≥ 1 texel per CSS px at the chunk's nearest point (`terrain/imageRes.ts`). The chunk re-decodes sharper as you approach and smaller as you move away, with a 20 % band against flicker. Over budget, image detail halves before the mesh coarsens. With a forced 220 MB desktop budget, `pixelError` stays at 1 (it was 2.4). Resampled 1-texel aprons keep the seams closed. `streaming.imageDetail` (default 1, `Infinity` = old behaviour). No data change. Drawn levels and `pixelError` are the same as with the relief look in all views.
- ⚠️ In one long session the phone's terrain GPU still climbs to its 200 MB cap: the LRU keeps chunks you have left until the cap. Compare kept bytes, not the total. Phone `mobil` detail 0.75 (`ui/quality.ts`) would give 118–131 MB with no measurable sharpness loss; that is not done yet.
- 🏰 The castle-zone details are in the castle's CHANGELOG (KB-I103/105/106) and [ADR 0040](../docs/adr/0040-castle-triangles-phone-viewport.md).
- 🧪 Scripts: `pnpm run perf -- --ortho both [--rounds 3]` A/Bs the aerial ground against the relief look in the same page and drops image textures for the relief rounds. `pnpm run perf:zone -- --runs 3 --shots-dir perf-pass` gives medians and also reports:
  - the Rundflug triangle peak (`inView()` sweep in 0.5 s steps),
  - frames > 50 / > 100 ms after „Gehe zu“,
  - bytes fetched during the enter,
  - the load average.

  It hands the frames back to the castle after `step` hooks (the castle's review clock held them, which hid the hitch before).

## Known gaps

- **Katalog-Modus (S2):** no Bäume/Gebäude switches (the stored prefs are honoured), no tree card
  for place trees, no per-place candidates/POIs/zones/point clouds/historic layers yet; parcel
  lookup only via the owning place's polygons; lossy layers are not marked „≈“ in probes; live VAT
  phone GPU cost and Safari/Firefox AVIF not measured.

- Messen (F17): no editing of finished measurements (delete + redraw); no measurement import; the rubber band is a straight (not draped) preview; the area is horizontal only (no 3D surface area). Exports are not written by the Export button in automated checks (GeoJSON content was checked via `measurementsToGeoJSON`).
- Verdachtsflächen (F15): the optional `candidates.mask` class raster is not rendered (outlines/circles only); N/P does not switch the relief preset per class; *Bekannte Orte* (`pois/PoiPanel.ts`) still fly with the old, not exaggeration-aware `flyToSite` (one-line switch to `flyToSiteExag`). Precision of the rule-set-2 coarse candidates is unknown (2 inspected by eye). The mask raster is not drawn. Clicking a candidate circle or a point-cloud outline on the minimap no longer also triggers the map's click-to-fly (`bubblingMouseEvents: false`, v1.0.1; verified by code path, not clicked in a browser).
- Meldung (F18): without `flurstuecke.polygons` (old manifests) the label-point fallback still misses large forest parcels. Notes over ≈ 1000 characters push the print to a third page (the dialog warns). No postal address/phone for the authorities (none in the research). Printing from a real browser dialog and an occluded marker were not checked.
- Punktwolke (F16): no eye-dome lighting; point bytes (10 B GPU + 10 B CPU per resident point) are not counted in the terrain's GPU estimate/LRU; *Gelände ausblenden* also pauses auto contrast while on; colour modes Höhe/ü. Grund/Intensität, the point-size slider and frame pacing while tiles stream in flight were not checked. Areas exist only where the pipeline wrote them (`overall`: all three, `karlsberg`: Schloss Karlsberg; `homburg` after a rebuild, `kirrberg` none).
- Rekonstruktion 1789 (F19): only the one dataset `shared/karlsberg1789/` is looked up (no discovery of other `shared/<id>/`); no distance fade/LOD (≈ 340 k triangles always drawn while on); where today's LoD2 buildings stand inside the model both are drawn (no masking); the model is not hidden by the canopy; skirts reach 0.5 m below the 2025 DTM, so at high exaggeration they sink visibly deeper into ruin pits (by design). Browser rendering, frame time and the round trip with the viewer were not verified in this build step.
- Mobile (F20): nothing tested on a real phone (see *Touch (F20)* / *Mein Standort*). A long-press marker leaves Markieren on, and it opens the form by a synthetic canvas tap because `MarkerManager.openForm` is private (a public `openDraftAt(E, N, h)` would fix both). The Markieren hint still mentions keys and clicks. The lil-gui panels (*Darstellung*, *Flug & Technik*) still render 245 px wide inside the 320 px drawer. After *Mein Standort* the camera sits ≈ 200 m above the ground under it (150 m is relative to the target). The compass ignores magnetic declination (≈ 2–3°). The desktop canvas now has `touch-action: none`.
- Shell (V2.2): Labor is not blocked on phones but is cramped there (long drawer); the default „aerial ground“ look is V2.5's; the tutorial and zone prompt/loading APIs have no caller yet (checked once via `window.sle.shell` in the browser); live flight feel of *Gehen* and real frame pacing were not checked (hidden tab, `step()`).
- Baum-Steckbrief: on phones the card can cover the picked tree (the camera does not move). A picked tree hidden behind a nearer crown loses to it (nearest along the ray). Places' Riesenbäume with `in_trees: false` are not in the Trees layer and so have no card (their pin flies there). Real-phone touch and a visible (non-headless) tab were not checked.
- Bäume (V2.4): one far draw call per chunk (≈ 100 at Hoch, ≈ 35 on Mobil); `renderer.info` triangles count every submitted instance, including those the shader collapses. Beyond the vegetation radius (3 km at Hoch) the relief is bare. No trunk collision when walking (ADR 0017). Hidden trees keep their chunks (≈ 7 MB). Real-phone frame time, live flight feel and the castle reuse of `decodeTrees` were not checked.
- Lens (V2.5): trees fade through `window.sleTrees.setLensFade` (V2.4b) and the DSM canopy through its own target. A lab overlay parked in Standard is off after a reload. With the lens, the phone bar has 7–8 items (34–45 px wide at 360–390 px; a *Mehr* menu is for the reference-phone pass). The glow is a terrain-shader loop (≤ 24 rings), so its cost on a real phone GPU is unknown (proxy only). Live flight feel with the lens on was not checked.
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
- Final polish: presets are not measured in real rAF pacing. A point budget set with the point-cloud slider is kept across preset picks (`sle.pointcloud.v1` `budgetUser`; v1.0 prefs count as user-set when the budget is no preset value) — after *Einstellungen zurücksetzen* presets control it again. `pnpm run serve:local` on 5250 itself, the tour with reduced motion, and gamepad were not checked.
