# Explorer integration: light reconstruction layer + camera handover

Status 2026-11-01. This note is the castle side of the integration with the Saar LiDAR Explorer (`../app`). The
explorer shows a **light** model of the reconstructed residence (summer 1789, hypothesis) as a toggleable layer.
Near the palace, "Schloss betreten" hands the camera to this viewer. "Zurück zur Karte" in the viewer hands it back.
The explorer side (loader, layer toggle, button, attribution) is built against this note and documented in
`../docs/data-contract.md`.

## 1. Servers

| What | Port | Command |
|---|---|---|
| Explorer dev | 5240 | `cd app && pnpm dev --port 5240 --strictPort` |
| Explorer `serve:local` | 5250 | (explorer) |
| Castle viewer dev | **5260** | `cd schloss-karlsberg && pnpm run dev` |
| Castle viewer preview | 5261 | `pnpm run build && pnpm run preview` |

Vite binds `localhost`, which on macOS is `[::1]` only. Use `http://localhost:5260/`, not `127.0.0.1`.

## 2. Data product `sle-recon-v1`

```bash
cd schloss-karlsberg && pnpm run export:explorer            # -> ../app/public/data/shared/karlsberg1789/
pnpm run export:explorer -- --out /some/dir                 # elsewhere
```

The script is `scripts/export-explorer.ts`, with its pure helpers in `model/src/explorer/export.ts` (tests:
`model/tests/explorer-export.test.ts`). It runs the generator directly (catalogue v2 → layout → `buildExterior`
at LOD1) and does not read `model/out/`. It needs `viewer/public/terrain/` (see README, `prepare-terrain.py`).
It takes about 2 s and is deterministic, apart from the `generated` timestamp.

The output dir `app/public/data/shared/karlsberg1789/` is git-ignored and AOI-independent (not a manifest key):

| File | Size | Content |
|---|---|---|
| `buildings.glb` | 4.66 MB | 99 nodes (91 buildings + 8 `site:<featureId>`), 340 087 triangles, 624 855 vertices |
| `footprints.geojson` | 0.03 MB | 91 Polygons, EPSG:25832 |
| `index.json` | 0.04 MB | header + 91 building entries |

### 2.1 Frame
- Model frame = explorer karlsberg AOI frame: `x = E − 381000`, `y = h` (true m DHHN2016, **no exaggeration**),
  `z = −(N − 5465000)`.
- Every node has an identity transform, and positions are float32 in that frame. Positions are deliberately not
  quantised: quantised positions would need a dequantisation node transform, and they would lose about 3 cm over
  the 2 km extent.
- Explorer placement per AOI: `object.position.set(E0_model − E0_aoi, 0, −(N0_model − N0_aoi))`.
  - `karlsberg` AOI: (0, 0, 0)
  - `overall` AOI (378000/5460000): (3000, 0, −5000)
- Exaggeration is applied by the explorer per vertex: `y' = hRef + (y − hRef)·exag`.

### 2.2 `buildings.glb`
- glTF 2.0 binary, one scene `karlsberg1789`, one material `karlsberg1789/vertex-colour` (white base colour,
  roughness 0.9, metalness 0) and one mesh with one primitive per node. No textures and no images.
- Required extensions: `EXT_meshopt_compression` (method QUANTIZE: lossless vertex/index codec) and
  `KHR_mesh_quantization`. Decode with three's bundled `three/examples/jsm/libs/meshopt_decoder.module.js`
  (`loader.setMeshoptDecoder(MeshoptDecoder)`; `await MeshoptDecoder.ready` in Node).
- Attributes per primitive:

  | glTF | Storage | three.js attribute name | Meaning |
  |---|---|---|---|
  | `POSITION` | float32 VEC3 | `position` | model frame, true heights |
  | `NORMAL` | int8 normalized VEC3 | `normal` | flat normals |
  | `COLOR_0` | uint8 normalized VEC3 | `color` | **linear** RGB, baked from the material base colours (render `#ECE8DF`, red sandstone `#A65E4A`, slate `#4B5057`, catalogue tints …) |
  | `_CONF` | uint8 SCALAR (not normalized) | **`_conf`** (GLTFLoader lower-cases custom attributes) | 0 = low, 1 = med, 2 = high |

  GLTFLoader turns on `vertexColors` by itself when `COLOR_0` is present. The viewer's confidence colours are
  high `#3f9b4f`, med `#e0a526` and low `#c8452f`.
- **Node names / ids:**
  - `node.name` = building id (`KB-B01` …), or `site:<featureId>` (e.g. `site:TF-03`) for a site feature.
  - three's GLTFLoader sanitises names (`PropertyBinding.sanitizeNodeName` strips `:`), so a site node
    arrives as e.g. `siteTF-03`.
  - Every node therefore also carries `extras` = `{ id, kind: 'building' | 'site', confidence }`. GLTFLoader
    copies that into `mesh.userData`. **Use `userData.id`.**
- Content (= viewer LOD1 exterior, minus fine detail):
  - massing, roofs (mansard/hip/dome, dormers, chimneys), facade relief (recessed openings with dark glass,
    surrounds, cornices, risalits, shutters, portals)
  - **dropped** for weight: window frames and glazing bars (`wood.frame`, 294 208 triangles), ironwork such as
    balconets, railings and lightning rods (`metal.iron`, 16 080 triangles)
  - not included: interiors, trees, hedges, water, orange tubs, textures
- `KB-B14` (Orangerie-Stützmauer) has no own geometry, because its front is part of the `KB-B10` basement since
  fix round 1. So there are 91 building nodes for the 92 placed catalogue buildings.
- The `site:<featureId>` nodes (5 376 triangles in all, one node per catalogue terrain feature that has stone
  parts: terrace retaining walls, scarps, the cascade and wells) hold the stone parts of the 1789 site. They are built
  on `min(1789 terrain, 2025 DTM)` so the wall feet reach the lower ground. Each carries its feature's confidence as
  `_CONF`. Splitting per feature lets the explorer hide features past its AOI edge (the Karlslust cascade `site:TF-30`
  lies wholly south of AOI `karlsberg`).
- **Base skirts:**
  - Every building reaches down to `min(2025 DTM under the footprint and in a 1 m band outside it) − 0.5 m`.
    The sampling points are the footprint vertices, the edges every 1 m and the interior on a 1 m grid, read from
    `viewer/public/terrain/dtm2025.f32`.
  - Where the plinth is not deep enough, a vertical skirt in the plinth colour runs from that depth up into the
    plinth. It is inset 6 cm and overlaps 0.3 m.
  - 82 of 91 buildings got a skirt; the deepest reaches 1.19 m below its plinth (KB-B39).
  - An independent read-back (gltf-transform) confirmed a margin of ≥ 0.50 m for all 91 footprints.
  - Skirts may sink into the 2025 terrain. That is intended.

### 2.3 `footprints.geojson`
A FeatureCollection with a legacy `crs` member `urn:ogc:def:crs:EPSG::25832`. Each feature is a closed Polygon
with coordinates `[E, N]` rounded to 1 cm and properties `{ id, name_de, confidence }`. The ring is the layout
footprint; for WALL buildings it is the buffered centre line.

### 2.4 `index.json`
```jsonc
{ "format": "sle-recon-v1", "id": "karlsberg1789",
  "label_de": "Rekonstruktion 1789 (Hypothese)", "name_de": "Schloss Karlsberg – Rekonstruktion Sommer 1789",
  "crs": "EPSG:25832", "heightDatum": "DHHN2016", "origin": { "E0": 381000, "N0": 5465000 },
  "anchor": { "E": 382262.7, "N": 5466126.3, "enterRadius_m": 300 },     // centre of the Corps de logis (KB-B01)
  "bboxEN": [[381255.3, 5464622], [383159.4, 5467054.1]],                // everything in the glb
  "files": { "model": "buildings.glb", "footprints": "footprints.geojson" },
  "viewer": { "url": "http://localhost:5260/" },
  "attribution": "Rekonstruktion Schloss Karlsberg 1789 (Hypothese): …; Grundrisse teils nach Lageplan 2006, schloss-carlsberg.de (CC BY-SA 2.0 DE); Sockeltiefen: DGM1 GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0",
  "disclaimer_de": "Hypothetische Rekonstruktion, kein Befund. Schauen, nicht graben.",
  "generated": "<ISO>", "catalogueVersion": 2,
  "buildings": [ { "id": "KB-B01", "name_de": "Corps de logis (…)", "cls": "CDL", "confidence": "med",
                   "eaves_h": 356, "ridge_h": 362.72,
                   "bbox_local": [[1248.65, 343.52, -1148.98], [1275.96, 369.02, -1103.59]],   // incl. skirt
                   "sources_de": ["Recherche research/03", "Web: nhp-2000.de", "Web: en.wikipedia.org"] } ] }
```
- `attribution` is one string. Its entries are joined by `'; '`, and no entry contains `';'`.
- `sources_de` holds at most 3 short labels per building. The full sources are in `model/catalogue.json`.
- The Lageplan entry is required: some footprints derive from the CC BY-SA 2.0 DE plan (research/07).
- No HMS frames, video or meshes are exported. The catalogue's derived numbers are only cited as "HMS/Matzerath
  2022 (nur Maße, ©)".

## 3. Camera handover

The pure module `viewer/src/handover.ts` is tested in `viewer/tests/handover.test.ts`. The conventions are the
same as in the explorer's URL hash:
- E/N: EPSG:25832
- h: true height in m DHHN2016. Convert explorer display y with the current exaggeration first.
- heading: degrees clockwise from **grid** north
- pitch: degrees, negative = looking down
- rounding: 0.1 m and 0.1°

### 3.1 Explorer → viewer
```
http://localhost:5260/?src=explorer&E=382226.4&N=5466120.1&h=371.2&heading=80.5&pitch=-12.3&mode=fliegen&back=<encodeURIComponent(explorer URL incl. hash)>
```
- E, N, h, heading and pitch must all be present and finite. Otherwise the viewer starts as before, at
  "Übersicht von Westen".
- The heading is normalised to [0, 360) and the pitch is clamped to ±89°.
- `mode=fliegen` (default): the viewer starts at the exact pose. It is lifted to the 1789 terrain + 1.5 m if
  lower.
- `mode=gehen`: the viewer switches to Gehen at the nearest **reachable** entrance POI (portal / Durchfahrt)
  within 200 m horizontally, facing the door (`pickWalkStart`, tested).
  - Reachable = the generator's `Poi.walkable` flag (`model/src/site/access.ts`, tested): the straight approach
    from the POI (8 m in front of the facade) to the foot of the entrance keeps clear of every terrace/scarp wall
    piece the model builds, and the first step there (threshold, or Freitreppe foot, minus the ground 0.5 m in
    front) is at most 0.35 m, the walker's step height. The test is a deterministic plan check, not a physics run.
  - Order: reachable entrance → nearest building POI (a view point outside the building; the viewer drops to the
    ground there, facing the building) → an entrance flagged `walkable: false` as the last resort. Today only
    `KB-B02/portal-end_a-1` is flagged: its Freitreppe ends 4.7 m out, beyond the TF-03 terrace edge.
  - Durchfahrten whose threshold lies on a terrace level get a gap in that terrace's retaining wall and a flight
    of steps (riser ≤ 0.15 m, tread 0.4 m, opening width + 0.6 m) down to the ground outside: the garden-side
    Durchfahrten of KB-B02 (to TF-08, 5 steps) and KB-B04 (6 steps).
  - If there is no POI within 200 m, it drops to the 1789 ground at (E, N) and faces the nearest building
    centre horizontally (else the palace grid origin), not the map heading (`walkFallbackYaw`, tested).
- Heading mapping in the viewer: `yaw = −heading·π/180`. The camera Euler is `(pitch, yaw, 0, 'YXZ')`.
  - Forward is then `(sin hd, 0, −cos hd)` in the local frame (x east, z south). This equals `dirLocal(heading)`
    in `model/src/frame.ts`.
  - Unit tests check this numerically with a three.js camera for N/E/S/W and for arbitrary angles.

### 3.2 Viewer → explorer
- **"← Zurück zur Karte"** is the first button in the panel (always visible). Key **M** does the same; it is
  ignored while typing or with Ctrl/Cmd/Alt. M was free in the viewer.
- Target:
  - the validated `back` URL if present, otherwise `http://localhost:5240/`;
  - the first five comma-separated hash fields are replaced by the viewer's current `E,N,h,heading,pitch`
    (true camera height, grid heading, 0.1 rounding);
  - all further hash fields (layer, overlay, exaggeration, sun, preset …) are kept;
  - a target without a hash (or with fewer than five fields) gets just the five fields.
- Validation of `back` (no open redirect):
  - It must parse with `new URL` and use http/https, with no user:password.
  - The hostname must be `localhost`, `127.0.0.1`, `[::1]`, or end in `.localhost` / `.test`.
  - Anything else is ignored and the default is used.
- Navigation happens in the same tab (`location.assign`), so the browser's Back button also works.
- Test hooks: `window.skb.handover` holds the parsed handover; `window.skb.backUrl()` returns the URL "Zurück"
  would open, without navigating.

## 4. Limits
- **Browser-verified** 2026-11-01 (`docs/integration/e2e-report.md`): the layer in the explorer (AOI `karlsberg`
  and `overall`), the handover both ways (button, key `T`, *zu Fuß*, *Zurück zur Karte*, key M), the fly pose,
  the walk start and the walk through the KB-B02 garden Durchfahrt (`docs/integration/13-…`), and the walk
  fallback heading. Frames were driven with `window.skb.step(n)` in a background tab.
- **Not verified:** the live pointer-lock / walk feel and real frame pacing in a visible tab.
- **Dev server is IPv6-only:** Vite's default host is `localhost`, which Node resolves to `::1` on this machine,
  so `http://localhost:5260/` works and `http://127.0.0.1:5260/` does not (the explorer on 5240 behaves the same).
  Setting `server.host: 'localhost'` would change nothing (it is the default), and binding `0.0.0.0` is ruled
  out because both apps stay local-only. Use `localhost` URLs; the handover defaults already do.
- **Terrain mismatch:**
  - The viewer stands on the 1789 terrain hypothesis. The explorer shows the 2025 DTM, and the two differ by up
    to 2–3 m around the ruin.
  - A walk-mode pose handed back has the viewer's eye height above the 1789 ground. The explorer may clamp it to
    its own terrain.
  - The light model's 1789 terrain features are not in the glb (courts and parterres are terrain shaping), apart
    from the stone walls.
- The light model has no window frames, so windows read as dark recessed panes. The full detail is in the viewer.
- The anchor is the Corps de logis centre. The enter radius (300 m) contains the centres of 25 of the 91
  buildings: the Ehrenhof, the wings, the Orangerie group (120–190 m) and the south part of the Marstall.
  - The Reithaus (323 m) and most of the Marstall are outside.
  - Karlslust is up to 1.7 km away.
  - The viewer covers all of them once entered.
