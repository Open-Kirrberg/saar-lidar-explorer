# Renderer recipes

Concrete approaches for the remaining roadmap features. They are starting points that fit the current engine — deviate when the code tells you otherwise, and record the decision in the PRD.

## Contents
1. Draped vector lines (F10 OSM, F12 Flurstücke)
2. Labels with LOD (F12, POIs)
3. Streaming & levels (F9)
4. Per-chunk low-pass for live local relief (F9)
5. Buildings (F11)
6. RGB layers: orthophoto & historic maps (F13, F14)
7. Measuring & height profile (F17)
8. Point clouds (F16)
9. Report snapshot (F18)

---

## 1. Draped vector lines

Input: GeoJSON in EPSG:25832, densified ≤ 2 m by the pipeline.

- Convert to local `x, z`; sample **true** height per vertex with `HeightQuery` (bilinear). Store as attribute `aTrueH`.
- Vertex shader: `y = uHRef + (aTrueH - uHRef) * uExag + uLift * uExag`, share `uExag/uHRef` with the terrain material (same uniform objects).
- Width: screen-space lines need `Line2`/`LineMaterial` (three/examples `lines/`) — patch its vertex shader via `onBeforeCompile` for the height formula, or build thin ribbons (two vertices per point, offset in the shader along the screen-space normal). Plain `LineSegments` (1 px) is fine for a first version.
- Depth: small lift (0.3 m) + `polygonOffset`/`depthFunc` tweaks; at very oblique views a ribbon slightly above ground beats a large lift.
- Heights for chunks not yet loaded (F9 streaming): re-sample when a chunk loads (keep per-chunk line batches so only affected batches update).
- Style by `kind` (road/track/path/water/rail/barrier; parcels thin white-ish), toggle in panel + key, off by default (discovery first).

## 2. Labels with LOD

- CSS2D (`Labels3D.ts` exists for POIs) is simplest; for thousands (parcel numbers) use a pooled set: each frame (throttled), pick the N nearest label points within ~300 m in front of the camera (spatial grid per chunk), assign them to pooled DOM elements or SDF text sprites.
- Height via the same exaggeration formula; occlusion: test with `Terrain.raycast` from the camera at low frequency, dim occluded ones (as POI labels do).

## 3. Streaming & levels (F9)

- Data contract v2 `levels`: level 0 = 1 m chunks (current), level k = 2^k m cells, same 500-cell chunk size, so each coarser chunk covers 2^k × 500 m.
- Quadtree over level chunks: refine when screen-space error (cell size / distance × projection scale) > threshold; keep coarse chunks resident (they're small), stream fine ones by priority (distance, in-frustum first), cap concurrent fetches (≈ 6), LRU-evict beyond a GPU budget (count bytes of height + layer textures).
- Skirts already hide T-junctions; scale skirt depth with exaggeration (roadmap R0.5).
- `HeightQuery` must answer from the finest loaded level (fallback to coarse) — collision and draping depend on it; drones near unloaded fine chunks should clamp to the coarse height + margin.
- Loading UX: first frame from coarse levels within ~1–3 s; no blocking loading screen after start.

## 4. Per-chunk low-pass (live local relief)

The current AOI-wide 3000² R32F low-pass texture doesn't scale. Per chunk: compute `boxBlur(h, r)` in the worker over the chunk + apron ≥ r (needs neighbour heights → either ship height chunks with a larger apron, or assemble from neighbours already in `HeightQuery` before blurring). Store as a second R32F texture per chunk; invalidate when the radius changes. Pipeline-precomputed `slrm` stays the default; the live variant is for radius experiments.

## 5. Buildings (F11)

- Pipeline delivers per-chunk glb in the local frame with true heights.
- `GLTFLoader` per chunk (lazy, only within ~1.5 km), merge into one mesh per chunk; material `MeshLambertMaterial` (clay) with `onBeforeCompile` injecting the exaggeration formula on `transformed.y` (use world `hRef`).
- Toggle "Gebäude"; dispose on chunk eviction. Optional roof colour from LoD2 roof type.
- Canopy: use the building mask layer (R0.7) to stop colouring buildings as trees.

## 6. RGB layers (F13 ortho, F14 historic maps)

- New channel source type `rgb`: sampled as sRGB texture, bypasses value/stretch/colormap; base or overlay with the existing blend modes ("Luftbild × Relief": multiply with hillshade).
- Texture size per chunk: ortho 0.5 m → 1000² (WebP); historic maps ~1–2 m. Use mipmaps + anisotropy (`renderer.capabilities.getMaxAnisotropy()`), they're viewed obliquely.
- Auto-contrast value pass must ignore rgb sources.

## 7. Measuring & height profile (F17)

- `app/src/measure/` with pure `profile.ts`: sample along polyline every 0.5 m (true heights from `HeightQuery`, DSM if loaded), return distance/height arrays, min/max, total ascent, max slope.
- Interaction: mode toggle (key `L` — check free keys in README), click adds vertices via `ctx.pickAt`, double-click/Enter finishes, Esc cancels, Backspace removes last.
- Draw: draped line (recipe 1) + vertex handles; profile chart in a panel `<canvas>` (plain 2D canvas: axes in m, DTM line, DSM line dashed, hover syncs a 3D cursor).
- Units: horizontal length (UTM metres are true to ~0.04 % here), 3D length, area via shoelace in UTM.
- Export as GeoJSON together with markers.

## 8. Point clouds (F16)

- Pipeline produces Potree 2 datasets per focus area (local frame offset documented in metadata).
- `potree-core` (pinned) or `3d-tiles-renderer` PotreePlugin; class toggles (2 ground / 6 building / 20 other), point budget slider, EDL; positions in local frame; apply exaggeration via a custom `onBeforeCompile` or by scaling the point cloud's y around `hRef` (simplest: `object.scale.y = uExag` with position offset so `hRef` stays fixed).
- Keep terrain visible underneath; "Röntgen-Linse": clip points above `h_ground + x` inside a radius around the cursor.

## 9. Report snapshot (F18)

- Render the current view into a `WebGLRenderTarget` at 2× size (or set `preserveDrawingBuffer` temporarily) → `readRenderTargetPixelsAsync` → canvas → PNG data URL.
- Map snippet: render the Leaflet container with the relief XYZ tiles (or compose the relevant XYZ tiles directly on a canvas — avoids cross-origin taint from OSM tiles; OSM tiles may taint the canvas).
- Assemble a self-contained HTML (inline images/CSS), download via a Blob link. Never upload or send.
