---
name: sle-renderer
description: three.js / Leaflet / UI work in the Saar LiDAR Explorer app (app/) — custom terrain engine (chunk LOD, quadtree streaming, LRU, skirts), GLSL relief shading and layer channels, canopy, drone controls, draped vector lines (OSM ways, Flurstücke) and labels, LoD2 building meshes, orthophoto/historic-map textures, Potree point clouds, measuring tools and height profiles, the minimap, markers and German UI panels. Use it whenever a task changes or debugs anything under app/src (rendering, shaders, controls, map sync, panels, performance, visual artefacts like cracks, seams, z-fighting, floating objects), even if the user just says "show X in 3D", "it looks wrong when…", or "make it faster".
---

# Saar LiDAR Explorer — renderer & app

A Vite 8 + TypeScript 7 + three.js r187 (WebGLRenderer, GLSL3) app with a small custom terrain engine, a Leaflet 1.9.4 minimap and German UI. Read `app/README.md` first — its *Architecture*, *Rendering*, *Extension points* and *Known gaps* sections describe the current engine precisely. `docs/data-contract.md` defines what the data looks like. Recipes for upcoming features are in `references/recipes.md`.

## Mental model

- **World frame:** `x = E − E0`, `y = h`, `z = −(N − N0)` (+x east, −z north). UTM only in `geo.ts` conversions; never in float32 buffers.
- **Terrain = chunks** (500 m, `TerrainChunk`): R32F height texture 502² with apron; mesh vertices in height-pixel space, displaced in the vertex shader by `texelFetch`; LOD grids 1/2/4/10 m with skirts (`gridGeometry.ts`), chosen per chunk by distance in `Terrain.update(camera)`.
- **Shading is per pixel** from the full-res height texture (12-texel bilinear + gradient in `heightSample.glsl`), so detail never depends on mesh density. Display = base channel + optional overlay channel, each `source → physical value → stretch/gamma → colormap`, blended in display space (`relief.ts` holds the pure logic).
- **Exaggeration:** `y = hRef + (h − hRef) · uExag` — the single source of truth for vertical scale. Every object you add to 3D (lines, labels, buildings, points, measurement geometry, markers) must use the same formula, ideally in its vertex shader with the *true* height as attribute, so changing the slider never detaches it from the ground. CPU side: `terrain.surfaceY(x, z)` (displayed) vs `terrain.heightAt(x, z)` (true).
- **State:** `Store<AppState>` in `state.ts` with keyed subscriptions and a source tag on every write (in use: `'camera'`, `'hash'`, `'gui'`, `'terrain'`) to prevent feedback loops; URL hash is derived from it. Overlay key/opacity and forest mode are mirrored between `Terrain` and the store by `ui/displayState.ts` (R0.6); blend/stretch/colormap still live only in `Terrain`.
- **AppContext** (`window.sle`): `manifest, store, terrain, controller, camera, scene, renderer, flyTo, pickAt, step`. Features are wired in `ui/features.ts` (`initFeatures(ctx)`), panels via `createPanelSection` into `#panel`.

## Rules of thumb

- **Colour management:** custom shaders write display-space colours; height/value textures are decoded with `colorSpaceConversion: 'none'` and must stay linear data (`NoColorSpace`). Photo-like textures (ortho, historic maps) are sRGB — sample them as sRGB and keep them out of the value pipeline.
- **Precision:** heights as R32F (or Terrarium decoded in the worker), never half-float (0.25 m steps hide relicts). Lift draped geometry by a small, exaggeration-scaled offset and use `polygonOffset`/depth bias rather than large lifts.
- **Memory & lifetimes:** every texture/geometry/material created per chunk is disposed on eviction/LOD change; check `renderer.info.memory` before/after flying around. Decode in workers (`DecodePool`) and transfer buffers.
- **Picking:** use `ctx.pickAt` or `Terrain.raycast` (height-field march). Chunk meshes don't raycast (CPU geometry isn't displaced).
- **Input:** global shortcuts must ignore text fields (`isTyping` from `ui/keys.ts`) and modifier combos; document new keys in the HUD help and README. Modes that need clicks (markers, measuring) set `controller.opts.lockOnClick = false` while active and restore it.
- **UI language:** German labels/tooltips, English code/comments. Keep the panel compact; add sections with `createPanelSection`, keyboard shortcut hints in labels.
- **Map sync:** Leaflet stays EPSG:3857; convert with `geo.ts`; headings add `gridConvergenceDeg(E, N)`. Throttle map updates (~150 ms).
- **Performance budget:** 60 fps on an Apple M5 Pro in the worst realistic view; aim < 8 ms/frame. Measure (see the roadmap skill's `references/verification.md`) — don't guess. Prefer instancing/merged geometry for many small objects, label LOD (only near the camera), and frustum culling per chunk.
- **Pure logic in pure modules** (`*.ts` without three/DOM imports) with vitest tests: geometry, densify/drape math, profile sampling, parsing, colormaps, LOD selection.

## Workflow for a feature

1. Read the roadmap item (acceptance criteria) and the relevant recipe in `references/recipes.md`.
2. Check the data you need exists in the manifest; if not, the pipeline must produce it first (`sle-pipeline`) — agree on the contract shape before writing loaders.
3. Implement in a new module directory (`app/src/<feature>/`) with a small public API; wire it in `ui/features.ts` / `main.ts` with minimal additive edits (re-read shared files right before editing — other agents may be working in parallel).
4. Tests for pure logic; `pnpm run test`, `pnpm run build`.
5. Browser check with `window.sle.step()` (automated tabs are often hidden → rAF paused; `step()` fires `sle:step` for rAF-driven overlays like `Labels3D` — new overlays with their own loop must listen to it), screenshots at exaggeration 1× and 3×+, console errors, a perf measurement. Save screenshots to `docs/screenshots/`.
6. Update `app/README.md` (architecture list, controls, known gaps) and report what was verified vs. not (live flight feel needs the user).
