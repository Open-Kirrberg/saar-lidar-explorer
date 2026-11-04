# Explorer integration: light reconstruction layer + camera handover

Status 2026-11-01 (§2.5 updated 2026-11-02 after improvement wave 8: light-layer changes waiting for re-export). This note is the castle side of the integration with the Saar LiDAR Explorer (`../../app`). The
explorer shows a **light** model of the reconstructed residence (summer 1789, hypothesis) as a toggleable layer.
Near the palace, "Schloss betreten" hands the camera to this viewer. "Zurück zur Karte" in the viewer hands it back.
The explorer side (loader, layer toggle, button, attribution) is built against this note and documented in
`../../docs/data-contract.md`.

## 1. Servers

| What | Port | Command |
|---|---|---|
| Explorer dev | 5240 | `cd app && pnpm dev --port 5240 --strictPort` |
| Explorer `serve:local` | 5250 | (explorer) |
| Castle viewer dev | **5260** | `cd zones/schloss-karlsberg && pnpm run dev` |
| Castle viewer preview | 5261 | `pnpm run build && pnpm run preview` |

Vite binds `localhost`, which on macOS is `[::1]` only. Use `http://localhost:5260/`, not `127.0.0.1`.

## 2. Data product `sle-recon-v1`

```bash
cd zones/schloss-karlsberg && pnpm run export:explorer            # -> ../../app/public/data/shared/karlsberg1789/
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
- Up to the 2026-11-01 export every node has an identity transform and float32 positions in that frame. From the
  wave-7 export on (KB-I62, §2.5) positions are **int16 on a global 1/64 m grid**: each node carries the
  dequantisation transform `translation = offset` (a multiple of 1/64 m), `scale = (1/64, 1/64, 1/64)`, no
  rotation, so `model = offset + q/64`. Max error 7.8 mm (half a step); coincident vertices of different nodes stay
  identical because every node snaps to the same grid. A node whose extent exceeds the int16 range (± 512 m at
  1/64 m) would stay float32 with an identity transform (none does today). The explorer bakes `matrixWorld` into
  the vertices (`ReconLayer.prepareGeometry`), as `../../docs/data-contract.md` allows ("a transform added by
  quantization is tolerated"), so the format stays `sle-recon-v1`.
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
  | `POSITION` | int16 VEC3, not normalized (wave 7, KB-I62; float32 before) | `position` | model frame, true heights after the node's translation + uniform 1/64 scale |
  | `NORMAL` | int8 normalized VEC3 | `normal` | flat normals |
  | `COLOR_0` | uint8 normalized VEC3 | `color` | **linear** RGB, baked from the material base colours (render `#ECE8DF`, red sandstone `#A65E4A`, slate `#4B5057`, catalogue tints …). From the 2026-11-02 export on (§2.5) it also carries the generator's per-vertex `aShade`: albedo variation (limewash age, per-building luminance, roof and stone tints, KB-I19) and baked AO (reveals, passages, cornice undersides, wall foot, KB-I20) as `colour × rgb × mix(1, AO, EXPLORER_AO_STRENGTH)` with `EXPLORER_AO_STRENGTH` = 0.6 (`shadeColour()` in `model/src/exterior/shade.ts`). Format and attribute unchanged |
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

### 2.5 Light-layer changes (re-export pending)
The copy in `../../app/public/data/shared/karlsberg1789/` is still the 2026-11-01 export (4.65 MB, 99 nodes), which
§2.2 describes. The castle side has changed since; a temp export (`verify.sh export`, 2026-11-02, after wave 11 and
all its owners' changes) gives:

| | 2026-11-01 (deployed) | 2026-11-02 (pending) |
|---|---|---|
| `buildings.glb` | 4.65 MB, 99 nodes (91 buildings + 8 site) | **4.37 MB**, 118 nodes (103 buildings + 15 site) |
| triangles / vertices | 340 087 / 624 855 | 427 539 / 732 877 |
| `POSITION` | float32 | int16 on a 1/64 m grid, per-node translation + scale (max error 7.8 mm, KB-I62) |
| dropped `wood.frame` / `metal.iron` | 294 208 / 16 080 triangles | 254 104 / 32 892 triangles |
| `footprints.geojson` / `index.json` | 91 polygons / 91 entries | 103 / 103 |
| `bboxEN` | S edge N 5464622 | [[381255.3, 5464643.2], [383159.4, 5467054.1]] |

What changed (format `sle-recon-v1` unchanged; the explorer needs no code change):
- `COLOR_0` now includes baked AO and the `aShade` albedo variation (KB-I19/I20, see the §2.2 table), and the
  exterior palette (blue-grey shutters, bluer slate, painted render members, KB-I15), French casements and plain
  wings (KB-I16/I17).
- Only the summer-1789 state is exported (KB-I03 epoch): nodes `KB-B13` (Rotunde an der Orangerie) and `KL-B49`
  (Hymenäostempel) are gone.
- New or changed nodes: `site:HG-04` (basin coping and stag heads, KB-I13), `site:TF-09` (Herzogsgarten terrace
  stone, 610 triangles), `site:TF-01` (Ehrenhof Prellsteine and flat sandstone gutters, 696 triangles, KB-I23),
  `KB-B06a` (Bibliothekspavillon, hypothetical, low confidence, KB-I24) and `KB-B07`, now the round Tempelzimmer /
  Rotunde with portico and colonnade (KB-I24). Gilt weather vanes and gate spear tips are included; lightning rods
  and downpipes are iron and dropped (KB-I18/I22).
- Wave 5 (garden) adds `KB-B87` (Rundpavillon im Herzogsgarten, 2.9 k triangles) and `KB-B88` (round pavilion above
  the Hirschwürzloch, 2.7 k). Both are `placement: 'hypothetical'` with low confidence (`_CONF` 0), positioned ±30 m.
  It also adds `site:HG-41`, the Flora herm (132 triangles, stone). The garden benches (wood) are not exported.
- The garden walls (GARD) now step with the ground in bays, with piers and a saddle coping. The export uses the lean
  LOD < 2 variant, with less than half the triangles of the viewer's near walls, to stay within budget. Against the
  deployed layer, `KB-B27` (Holländische Gärtnerei) grows from 0.1 to 2.0 k triangles, `KB-B23` from 0.1 to 1.0 k
  and `KL-B43` from 0.2 to 2.6 k.
- The wave-5 interiors, parterres, kitchen-garden beds, grove, lanterns and lit windows are viewer-only; nothing
  else reaches the layer.
- Wave 6 adds one node and changes several (triangles against the deployed layer):
  - **New `KB-B12a`** (Komödienhaus, annex on the S face of the Orangerie S wing; `placement: 'hypothetical'`, low
    confidence, `_CONF` 0; 824 triangles). `footprints.geojson` and `index.json` gain its entry (93 / 93).
  - `KL-B40` is now the menagerie ring of 19 slate-roofed houses and a loge (`name_de` "Amphitheater (Menagerie-Rund
    mit 19 schiefergedeckten Tierhäusern und Loge, „Bärenzwinger“)", 768 → 504 triangles); `KL-B43` carries six
    terrace rows of houses instead of the enclosure wall (182 → 1,664); `KL-B41` 790 → 978. Their grilles, net
    posts and wires are iron and dropped.
  - `site:HG-41` (Flora herm) is a lathed bust on a tapering shaft (132 → 572 triangles).
  - The KB-I21 Fachwerk storeys (gallery KB-B06, Wachhäuser KB-B37/38/63/64, upper storeys of KB-B24/40/41) have
    thinner walls and reveals (+0.1…1 k triangles each). On KB-B10/B11/B12/B12a the door leaves are now white
    (`#F2F0EA`, `wood.door`, baked into `COLOR_0`); the white window frames are `wood.frame` and stay dropped. The
    KB-B10 hall tier has no shutter leaves any more.
  - Viewer-only, nothing in the layer: the post chain, water reflections, wet banks and spray, leaf cards, lantern
    pools, chimneypieces, stoves and chandeliers, treillage and the garden plantings.
- Budget: 5.90 of 6 MB left almost no headroom; wave 7 made room (KB-I62, below).
- Wave 7 (architecture, 2026-11-02; the lead's temp export after all wave-7 changes gives the same numbers):
  - **KB-I62:** `POSITION` is int16 on a 1/64 m grid with a per-node translation + scale (§2.1, §2.2). The wave-6
    layer drops from 5.88 MB to **4.11 MB** with identical nodes and triangles (round trip OK).
  - New nodes, all `placement: 'hypothetical'`, low confidence (`_CONF` 0), positioned ± 50-100 m from zone
    descriptions: `KB-B02a` (Altan on piers over the S-wing garden Durchfahrt, KB-I31), `KB-B89` (Monopteros),
    `KB-B90` (Bienenhaus), `KB-B91` (Wassermaschine), `KL-B50` (Chinesischer Pavillon), `KL-B51` (Türkisches Zelt),
    `KL-B52` (Heuwagen), `KL-B53` (Volierenpavillon) (KB-I39/KB-I30). 140-630 triangles each; open follies (Altan,
    tent, wagon, aviary, bee shelter) get no base skirt.
  - Total: **4.17 MB**, 114 nodes (102 buildings + 12 site), 406 853 triangles, 696 797 vertices; `bboxEN` south
    edge N 5464643.5. `footprints.geojson` / `index.json` gain the 8 entries.
  - `KB-B54`/`KB-B56` (Treibhäuser) only change `name_de`/function (UP-06 Ananashaus merged).
  - Also new against the deployed layer: `KL-B41a` (Inselpavillon der Menagerie – Aufbau, hypothetical, low; the
    wave-6 review split of KL-B41, KB-I67). Its base skirt is the deepest in the layer (5.68 m below the plinth, since
    it stands on the island quay in the moat); check how it reads in the explorer after the re-export.
  - Viewer-only in wave 7, nothing in the layer: the 3D vines, forest crown relief and fringe, hedge bevels, Ehrenhof
    wear, interior mapping (LOD2 panes with `aWin` / `aRoom` only), the indoor-look rule, interior shells and the sky
    cube.
- Wave-7 review fixes and wave 8 (2026-11-02; the lead's temp export after all wave-8 changes):
  - **New nodes:** `KB-B28a` (Apsis des Pavillons zu Carlsberg: a round drum with a half-dome on the E wall of
    `KB-B28`, `placement: 'hypothetical'`, low confidence, `_CONF` 0; 2.5 k triangles; KB-I32) and `site:KB-WB1`
    (the well N of the Wassermaschine KB-B91, wave-7 review fix KB-I71; since wave 8 a flush kerb with a stone cover,
    low confidence). `footprints.geojson` / `index.json` gain `KB-B28a` (103 / 103).
  - **Changed nodes:** `KB-B28` is now Schneider's "Pavillon zu Carlsberg" (10 × 10 m, two storeys, pavilion roof,
    W door; hypothetical / low; 0.8 → 2.8 k triangles); `KL-B50` Chinese pavilion with a double roof, up-swept hip
    corners, lantern drum and bells (1.5 k); `KB-B07` Tempelzimmer doors fill the curved openings (KB-I70); `KB-B01`
    a sandstone pilaster-and-entablature frame round the court portal; the seven follies (`KL-B50…53`, `KB-B89`,
    `KB-B90`, `KB-B02a`) without shutters; `site:TF-41` / `site:TF-42` wells (Buntsandstein well-head with coping for
    TF-41, flush kerbs with covers for the low-confidence TF-42 pits). Lightning-rod masts are now on the ridge high
    points only; their iron is dropped as before.
  - Not in the layer (viewer-only or not stone): the fences `KB-F1` / `KB-F2` (timber), the forecourt `KB-V1` and the
    Felsenpfad `KB-W8` (terrain paint), the Festbeleuchtung lamps, the far shadow map, the Granitsaal walls and the
    banquette (interior), the Ehrenhof wear and the lawn changes.
  - The terrain under the castle changed too (`prepare-terrain.py`: TF-08 retaining-wall foot ramp, a level pad at the
    KB-B02 W portico, KB-V1 gravel); the explorer uses its own 2025 DTM, so only the base skirts can differ.
- Wave-8 review fixes and wave 9 (2026-11-02; the lead's temp export after all wave-9 changes, against the wave-8 lead
  export above):
  - **New node:** `site:KB-W8` (Felsenpfad: low Buntsandstein outcrops and loose edge stones, `stone.red`,
    `placement` of the walk hypothetical, low confidence; 2,040 triangles). The trodden-earth path itself is terrain
    paint and stays out. `footprints.geojson` / `index.json` keep 103 / 103 entries.
  - **Changed nodes:** `KB-B01` (court perron across the three centre axes with sandstone treads, cheeks and
    pedestals, the N-wing porch and balconies of the wave-8 review; 12,663 → 13,039 triangles); `KB-B28` / `KB-B28a`
    (door and windows moved to the W front, blank E wall, flatter apse calotte; triangle counts unchanged); almost every
    building with a lightning rod loses 28–192 triangles (smaller gilt heads; masts 1.2–3.0 m, 0.5 m points on the
    guard houses; the iron stays dropped), and the `index.json` heights of those buildings drop with the masts (e.g.
    367.65 → 367.25 m).
  - Not in the layer (viewer-only): the grass blades, the fine leaf atlas, the Petri framing shrub groups TF-45…49
    (trees), the room mirrors and interior grade, the night-sky fix, the Tempelzimmer's inner pilasters (interior),
    the Ehrenhof wear and the graded pond shores with their water mesh.
  - The 1789 terrain under the castle changed again (`prepare-terrain.py`: natural pond shores and the TF-21 island,
    the KB-V1 forecourt low-pass); the explorer uses its own 2025 DTM, so only the base skirts can differ (deepest
    still KL-B41a, 5.68 m).
- Wave-9 review fixes and wave 10 (2026-11-02; the lead's temp export after all wave-10 changes, against the wave-9
  lead export above, which predates the wave-9 review fixes):
  - **New node:** `site:KB-V2` (the graded carriage drive to the Ehrenhof grille: its sloping flank walls
    (Wangenmauern) in red Buntsandstein with a grey coping, `stone.red` / `stone.grey`; 320 triangles). The drive's
    gravel surface is terrain paint and stays out. `footprints.geojson` / `index.json` keep 103 / 103 entries.
  - **Changed nodes:** `KB-B01` 13,039 → 13,071 triangles (the perron narrowed to the portal frame + 0.9 m with riser
    blocks, sandstone treads and pale nosings; the CdL garden door is now a closed glazed porte-fenêtre drawn with the
    window joinery, so it is exported like the other porte-fenêtres); its `bbox_local` W edge moves 1,249.03 → 1,249.20. `KB-B07` (Tempelzimmer)
    5,859 → 6,125: the portico roof runs into the drum under a lead collar, no attic block, columns with entasis,
    grey-white portico steps. `index.json` heights rise by 0.01 m on every building with a lightning-rod mast (larger
    gilt knob; the iron mast stays dropped).
  - `COLOR_0` changes: a damp darkening at the plinth foot, the grey Tempelzimmer steps, the perron risers' tint and
    step-corner AO. The mixed dressed-stone look of the red plinths and the procedural paintings are viewer-only
    shaders; the layer keeps the plinth's single baked red.
  - Not in the layer (viewer-only): the mowing zones, avenue variation and hotbed lights, the Ehrenhof sand patches,
    the moon, stars, moonlight and cumulus with cloud shadows, the fountain jet, the table candles, the interiors
    (seats, cove, library doors, canvases).
- Wave-10 review fixes and wave 11 (2026-11-02; the lead's temp export after all wave-11 changes, against the wave-10
  lead export above):
  - **No new nodes**; `footprints.geojson` and `index.json` are unchanged apart from the timestamp (103 / 103; one
    `bbox_local` corner of `KB-B88` moves by 0.01 m).
  - **Changed nodes, wave-10 review fixes:** `KB-B07` (Tempelzimmer) 6,125 → 6,517 triangles (two-tone lead gores with
    seams, a lead ridge roll and saddle where the portico roof meets the dome, a grey-white stone base); the round
    garden pavilions `KB-B87` 4,065 → 4,785 and `KB-B88` 2,680 → 3,048 (both still hypothetical, `_CONF` 0);
    `site:KB-V2` 320 → 480 (drive flank walls with a coping slab); the terrace retaining walls `site:TF-03` 1,896 →
    2,772, `TF-04` 768 → 1,152, `TF-05` 672 → 1,008, `TF-06` 432 → 648, `TF-08` 792 → 1,188 (a pale coping slab with
    bed course and overhang, `RETAINING_ASHLAR`).
  - **Changed node, wave 11:** `KB-B01` 13,071 → 13,755 triangles: Lisenen on the garden-front centre risalit,
    profiled window surrounds and EG keystones on its centre axes, the buried Beletage hoods removed, and the garden
    door as a croisée-porte (its joinery is `wood.frame` and dropped: +108 dropped triangles). `COLOR_0` carries the
    new members in the render / stone colours.
  - Not in the layer (viewer-only): the Gewannflur strips, crop rotation and field trees (terrain paint and trees),
    the avenue tone, the fountain jet, the candle light, the HYG star table, the interior cornices, boiserie tones,
    carved heads and seat ovals.
  - The 1789 terrain under the castle changed (`prepare-terrain.py`: the Gewann fill parcels LC-06…08 change the
    ground classes N and E of the palace; heights unchanged); the explorer uses its own 2025 DTM, so nothing changes
    for it.
- The ten Ehrenhof sentry boxes and the cobbled lanes are not in the layer (the site export keeps `stone.*` only).
  The gutters in `site:TF-01` are flat strips 3 cm above the lower of the 1789 and 2025 grounds, so they may z-fight
  with or sink under the explorer's 2025 DTM; whether to drop them is open on the castle side.

The re-export into `../../app` (`pnpm run export:explorer`) **waits for the user's go**, because the explorer is being
built concurrently in the parent repo. After it, update §2's file table and §2.2's dropped counts and site-node
list to the "pending" column.

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

## 5. Zone package (`sle-zone-v1`)

From V2.7 the castle is zone #1 of the explorer ([zone contract](../../../docs/zone-contract.md), [ADR 0029](../../../docs/adr/0029-zones-same-bundle-folder-layout.md)). The committed source is [`zone.json`](../zone.json); `pnpm run export:zone [-- --out <dataRoot>]` (`scripts/export-zone.ts`) writes the git-ignored package:

| File (under `<dataRoot>zones/`) | What |
|---|---|
| `index.json` | `sle-zones-v1`, merged: the castle entry (bbox of footprint + portal) is replaced, other zones are kept |
| `schloss-karlsberg/zone.json` | source + `budget` + `generated` |
| `schloss-karlsberg/terrain/meta.json` | viewer terrain meta, **1789 only**, `encoding.dtm1789 = { dtype: "uint16", offset, scale: 0.01, nodata: 65535 }` |
| `schloss-karlsberg/terrain/dtm1789.u16` | 1789 DTM, `h = offset + v · scale` (≤ 5 mm error, half the f32 size); `loadTerrain` decodes it |
| `schloss-karlsberg/terrain/ground.u8` | 1789 ground classes |
| `schloss-karlsberg/textures/<set>/{diff,nor_gl,arm}.jpg` | Poly Haven CC0 sets, 1024² / 1024² / 512² (pipeline Pillow, sips fallback) |

- **Geometry from the catalogue** (`scripts/zone/castle.ts`, `footprint.ts`): footprint = raster outline of all placed buildings and 1789 terrain features, 20 m buffer, 125 m closing, corridors between remaining islands, ≤ 64 vertices, inside the terrain crop. Portal *Ehrenhof* on the palace axis ≥ 60 m west of the gate KB-B39, at the footprint edge, facing 260.5°; spawn 6 m inside the gate at TF-01 level + eye height, heading 80.5°.
- **Drift:** if the catalogue changes, the export fails until `-- --update-source` rewrites footprint, portal, spawn and budget in `zone.json`; `viewer/tests/zone-package.test.ts` fails too. Review the diff before committing.
- **Budget:** file bytes are measured. The module chunk (`--module-bytes`, default 1.5 MB gzip; measured entry + catalogue ≈ 0.5 MB) and triangles (`--triangles`, default 3.7 M) are declared. Triangles = the most drawn in view at the finest LOD, measured with `skb.inView()`: up to 3.63 M in the Rundflug (garden crowns), 0.9–1.9 M indoors. That is over the contract's 1.5 M, so `scripts/zone/package.ts` `TRIANGLES_WAIVER` lifts **only** that limit, up to 3.7 M ([ADR 0033](../../../docs/adr/0033-castle-module-zone.md)). Meanwhile the phone proxy (`app` `pnpm run perf:zone`) is the gate. Over a limit → the export fails.
- **Shared trees:** with preset `trees: "shared"` the explorer hands `ctx.trees` (its AOI `trees` layer) to `mountZone`. `viewer/src/sharedTrees.ts` keeps a tree only outside the footprint and on 1789 forest, and gives it a species from the 1789 mix by its stable id [I]. Standalone (no explorer), none are drawn.
