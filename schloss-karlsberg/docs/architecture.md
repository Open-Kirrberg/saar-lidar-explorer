# Schloss Karlsberg: architecture of the generator, viewer and plans

Status 2026-11-01. The core (spec, frame, layout) is in place and tested. Exterior, interiors, site, viewer and plans
are separate work packages that build on it. This document is the contract between them. If you change an API
listed here, change this file in the same commit.

## 1. Overview

```
model/catalogue.json (v2, built by        model/src/catalogue.ts: loadSite() = validate -> upgradeV1 -> validate(v2)
  scripts/catalogue-v2/build.ts from model/catalogue.v1.json = frozen v1 test fixture)
        │                                                  │
        ▼                                                  ▼
  SiteSpec v2 (spec.ts) ──► layout/ (PURE: frame, storeys, roof, bays, openings, rooms, stairs, avenues)
                                   │  layoutBuilding(b, spec) -> BuildingLayout   (one truth for all consumers)
             ┌─────────────────────┼─────────────────────────┬─────────────────────────┐
             ▼                     ▼                         ▼                         ▼
   exterior/ buildExterior   interior/ buildInterior    site/ buildSite          plans/ generatePlans
   (three.js Group)          (three.js Group)           (Group+colliders+POIs)   (SVG/PDF, no three)
             └──────────── viewer/ (fly + walk, three-mesh-bvh) ─────────┘
                           scripts/export-glb.ts -> model/out/*.glb + index.json -> explorer app
```

**Package.** There is one pnpm package, `schloss-karlsberg`, at the sub-project root. It pins three 0.187.0,
three-mesh-bvh 0.9.16 (peer `three >= 0.159`), vite 8.3.5, typescript 7.0.2, vitest 5.0.5, tsx 4.23.15 and
@types/node 26.6.6.

| Script | What it does |
|---|---|
| `pnpm run dev` | viewer on <http://localhost:5260/> (strict port; root `viewer/`) |
| `pnpm run build` | `tsc --noEmit && vite build` → `dist/` |
| `pnpm run test` | vitest (`model/tests`, `plans/tests`, `viewer/tests`) |
| `pnpm run export` | `tsx scripts/export-glb.ts` → `model/out/` |
| `pnpm run export:explorer` | `tsx scripts/export-explorer.ts` → `../app/public/data/shared/karlsberg1789/` (light layer `sle-recon-v1`, see `docs/explorer-integration.md`) |
| `pnpm run plans` | `tsx plans/src/main.ts` → 30 sheets in `plans/out/`, PNG previews in `docs/plans-preview/` |
| `pnpm run textures` | `bash scripts/fetch-textures.sh` |

**Imports.** The viewer imports the model as `@model/...` (alias to `model/src`, also in tsconfig `paths`) or by
relative path. Vite `server.fs.allow` covers the whole sub-project. Use explicit `.ts` extensions in imports
(`allowImportingTsExtensions`, as in the explorer).

## 2. Module map and ownership

| Path | Owner | Rule |
|---|---|---|
| `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vite.config.ts` | core | others ask before changing |
| `model/src/spec.ts` | core | catalogue v2 types |
| `model/src/validate.ts`, `model/src/catalogue.ts` | core | validator, v1→v2 upgrade, `loadSite` |
| `model/src/frame.ts` | core | coordinate frames |
| `model/src/layout/**` | core | pure layout; **no three imports** |
| `model/src/context.ts`, `model/src/api.ts`, `model/src/index.ts` | core | BuildContext, material names, function types |
| `model/tests/**` | core (+ anyone adding tests for core code) | vitest |
| `scripts/**` | core; `export-glb.ts` and `export-explorer.ts` by **exterior** | |
| `model/src/exterior/**`, `model/src/site/**`, `viewer/**` | **exterior + viewer** package | `viewer/src/main.ts` wires the viewer |
| `model/src/interior/**` | **interiors** package | `index.ts`: `buildInterior` |
| `plans/**` | **plans** package | `plans/src/main.ts`: CLI over `generatePlans` |
| `viewer/public/textures/` | git-ignored, filled by `scripts/fetch-textures.sh` | manifest: `viewer/textures.json` (committed) |
| `model/out/`, `dist/`, `node_modules/` | git-ignored build output | |

If a consumer needs a new pure helper, it goes into `model/src/layout/` with a test. Ask the core owner or add it
in a clearly separated new file. Do not duplicate geometry logic in a consumer.

## 3. Conventions

### 3.1 Units and heights
- Metres, degrees, and heights in **m DHHN2016 (true heights)**. There is never vertical exaggeration in this
  package. The explorer applies its own `y = hRef + (h − hRef)·exag` when it places the glb.
- Unit for snapping (optional): `PIED_DU_ROI = 0.3248 m` (grammar.ts).

### 3.2 Frames (`frame.ts`, `layout/footprint.ts`)

| Frame | Definition | Functions |
|---|---|---|
| EN | EPSG:25832 `[E, N]` | — |
| local (explorer three.js world) | `x = E − 381000`, `y = h`, `z = −(N − 5465000)` | `enToLocal`, `localToEN`, `enToXZ` |
| palace grid | `u` along the Ehrenhof axis (grid az 80.5°, towards the E avenue), `v` 90° CCW (az 350.5°), origin E 382226 / N 5466120 | `gridFrame(spec.palace_grid)` → `toEN(u,v)`, `toUV(E,N)` |
| building local `[s, t]` | origin = centre of the oriented footprint rectangle; `+t` = outward normal of the **court** side; `+s` = `t` rotated 90° clockwise | `buildingFrame`, `stToEN`, `enToST`, `stToLocal`, `sidePoint` |
| building group (three object space) | `group.position = frame.originLocal`, `group.rotation.y = frame.rotationY`, child coords `(X, Y, Z) = (s, h, −t)` with absolute `h` | `stToObject` |

- **Azimuths** are degrees clockwise from **grid** north (+N = local −z). Convert with
  `true = grid + γ`. `γ = gridConvergenceDeg(E, N)` is about −1.23° here. Helpers: `gridToTrueAzimuth`,
  `trueNorthLocal`, `dirLocal(az)`, `rotationYForAzimuth(az)` (turns local −z to az).
- **Never** put raw UTM into float32 buffers. Vertex data is either building-object-space (s, h, −t) under a group
  transform, or local coordinates.
- Heights stay absolute (y = h). A building group has `position.y = 0`, so `y = 346.0` in the group is the EG floor.
  float32 resolves ≈ 30 µm at 350 m, which is fine.

### 3.3 Building sides
```
            end_a (s = −L/2)                      end_b (s = +L/2)
                 ┌──────────── court (t = +W/2) ───────────┐
                 │                    ↑ +t                  │
                 │                    o──→ +s               │
                 └──────────── garden (t = −W/2) ──────────┘
```
- Sides run counter-clockwise (garden → end_b → court → end_a).
- Each side has `p0` (its **left** end seen from outside), `p1`, `tangent`, outward `normal` and `normalAzimuth`.
- Facade positions `a` are metres from `p0`. Axes are 0-based, left to right seen from outside.
- **Court side** = the long side facing `Building.court_toward`, which is either an EN point or a terrain-feature
  id. For a line feature, the nearest point of the line is used.
  - The default is the palace grid origin (Ehrenhof centre).
  - `COURT_TOWARD` in `catalogue.ts` sets the [I] assignments for v1: CdL and arms → TF-01; Sammlungsflügel,
    Küchenbau and Galerie → TF-02; Orangerie group → TF-06; Marstall/Reithaus → TF-05; Jägerhaus, Lazarett and
    Brauerei → TF-10.
- "garden" is simply the opposite long side, even for a stable.

### 3.4 Storeys (`layout/storeys.ts`)
- Storeys are listed bottom-up, including the plinth. Heights are floor-to-floor. The first storey starts at
  `base_h`, and `eaves_h = base_h + Σ storeys`.
- Example (CdL): 344.8 (court) → EG floor 346.0 → Beletage 350.8 → eaves/mansard floor 356.4.
- `StoreyKind`: `plinth | basement | floor | mezzanine | kneewall | wall | mound`. It is inferred from the
  name in v1.
- Ceilings sit at the next floor minus the class floor build-up (grammar `FLOOR_BUILD_UP`).
- The plinth runs down to `min(base_h, ground_dtm.min) − 0.3 m` (`stack.plinth.bottom_h`).
- Storey **indices** (into `Building.storeys`, plinth included) are used everywhere: rooms, openings, portals
  and stairs.

### 3.5 LOD

| LOD | Content | Used for |
|---|---|---|
| 0 | Massing: plinth, wall prism (or risalit-stepped prism), roof volume from `roofSection` + `roofPlan`; no openings | far views, explorer default |
| 1 | Facades: openings as recessed holes or inset panels with glass, surrounds, cornice, corner strips, dormers/oculi, chimneys, lightning rods, shutters | fly-over |
| 2 | Detail: glazing bars, shutters open/closed, Freitreppe, portals; **interiors** (`buildInterior`) and walk colliders | walk mode |

The viewer can mix LODs per building by distance. The export writes LOD0 and LOD1 (and LOD2 for buildings with
`interior !== 'none'`).

### 3.6 Materials
- Names are `<surface>.<variant>` from `MATERIAL_NAMES` (context.ts), for example `render.lime`, `stone.red`,
  `roof.slate`, `roof.tile`, `glass.crown`, `floor.parquet`, `wall.boiserie` and `ground.gravel`.
- The glb keeps the name as `material.name`, so the explorer can swap materials.
- Colours come from the catalogue: `facade.colour`, `members_colour`, `plinth_colour` and
  `spec.defaults.*`. Use `materials.tinted(name, colour)` for them.
- `MATERIAL_TEXTURE` maps material names to the texture sets in `viewer/textures.json`.
- Low-confidence parts can use `hypothesis` (evidence style).
- **Exterior palette (KB-I15, research/09 §3.7):** `render.member` (additive, `#B9B8B2`, render texture, not ashlar) is
  painted render for Lisenen, bands, surrounds, sills, window caps and the cornice on court buildings [D→ Koblenz; I].
  `exterior/index.ts palette()` picks the member material: `facade.members_material` (`'render' | 'stone'`, default
  `stone` for FARM, FARM_GROUP, RIDE and STABLE, `render` otherwise); a red member hex (`#A…`, `#9…`, `#8…`) still
  means red ashlar (`stone.red`). Exposed sandstone appears only at plinths and steps (`plinth_colour`, `stone.red`)
  and at portals, Durchfahrten, porticos and gate piers (`palette().stone` = `stone.grey` in `facade.portal_colour`,
  palace default LC grey-pink `#BFAEA5`). Colours: `wood.shutter` `#5F6F7A` (court buildings and court-town ranges;
  farm `#3F5A3A`, stables `#6E2E26` via `shutter_colour`), `roof.slate` `#4A525C`, `metal.iron` `#2E3439`.
- **Finish variation and baked AO (KB-I19/I20, `exterior/shade.ts`, pure):** the exterior `GeoBuilder({ bake: true })`
  writes a per-vertex `aShade` attribute (Uint16 normalised RGBA: rgb = albedo multiplier / `SHADE_RGB_MAX` 4,
  a = ambient occlusion). It carries per-building limewash luminance (±3 %, `buildingLum`), slate/tile jitter
  (`roofTint`), per-block sandstone hues following the `sandstone_ashlar` texture joints (`ASHLAR`, `ashlarBlocks`,
  `blockTint`; every block ±5 % value and at most a 12 % hue step toward yellow-grey, LOD2 only; the ashlar
  texture maps to 3 × 1.8 m (`TEXTURE_SIZE` in `materials/index.ts`), so courses are 0.36 m), grime under cornices and sills, and AO in
  reveals (darker toward the joinery and never lighter than the wall zone they are cut into, `revealCornerAO`; plinth
  reveals also take `REVEAL_GRIME.stone` 0.7 albedo), under cornices (`CORNICE_AO`), at the wall foot and plinth ledge and at
  dormer cheeks. Walls are split at the AO/grime break heights (`wallBreaks`) so vertex interpolation reproduces the
  profiles. Meshes with `aShade` use `materials.baked(name, colour?)` (optional in `MaterialLibrary`): the albedo is
  multiplied by rgb, AO darkens the indirect light fully and the direct light by `BAKED_AO_DIRECT` (0.3). The limewash
  base follows `facade.build_year` (catalogue, set by `scripts/catalogue-v2/buildings.ts`): warm `#EDE6D8` up to
  1780, cool `#E6E6E2` from 1786 (`limewashColour`). `glass.crown` is tinted green-grey `#22302C` (M6); at LOD2 each
  casement leaf (and top light) gets a slightly jittered normal (±1.5°) so the leaves catch the sky differently.
  Seen from outside (camera on the side of the outward normals), `glassPatch` (`GLASS_LOOK`) makes the pane cover
  85 % of the view with a dark room proxy lit by the facade's own irradiance (sky × AO, 30 % of the sun) and adds the
  reflections without the alpha dimming them, so shaded glass stays darker than the wall whatever is (or is not) built
  behind it; from inside the glass keeps its plain transparent look, dimmed by the shared uniform `glassView`
  (exported from `materials/index.ts`, default 1; the viewer sets it per frame indoors to its window pull, KB-I75).
  Wave 7 (KB-I42 interior mapping): panes that carry the optional vertex attributes `aWin` (x along the facade from
  the window centre, y up from the window bottom, window half width, window height; m), `aRoom` (depth to the back
  wall, mode 1 room / 2 room with pictures / 3 dark cavity, open share between the curtains, sRGB 5-6-5 wall colour +
  65536 · curtain kind 0 white muslin / 1 cream muslin / 2 the room's silk) and `aRoom2` (side walls left / right of
  the window axis, floor below and ceiling above the window bottom; m) show a box room cast per pixel instead of the
  flat proxy (`GLASS_LOOK.interior`: curtains, parquet, ceiling, cavity, gain 0.2, saturation, fallback room), fully
  opaque. The viewer writes them on LOD2 panes (`viewer/src/night.ts`) from the **catalogue room behind each window**
  (`viewer/src/windowRooms.ts`: its polygon gives depth and side walls, its storey floor and ceiling, its finish the wall
  colour; curtains per room in ~35 %; roof glass, service rooms and windows without a room get the dark cavity); every
  other consumer (glb export, explorer layer, LOD0/1) leaves them zero and keeps the proxy. Box-shaped glass (both
  faces drawn) gets `aWin.z` −1 on the outer and −2 on the room-side faces; −2 never counts as seen from outside
  (KB-I70). The outside test uses the unflipped normal: three.js draws a transparent double-sided material in two
  passes and negates `vNormal` under `FLIP_SIDED` in the back-face pass (wave-7 review: from inside a room its own
  panes tested as outside and showed the opaque mapped room).
  The model glbs keep the attribute as `_ASHADE`; the explorer light layer bakes it into `COLOR_0` (§6).
- **Water (KB-I37):** `waterPatch(m)` (materials/index.ts, applied to `water` and to basin clones) tilts the normal by
  `WATER_RIPPLE_GLSL` (time from the shared `waterTime` uniform, advanced by the viewer; `skbRippleLod` fades waves finer
  than the pixel footprint, KB-I69) and writes **alpha 0**, the
  marker by which the viewer's post chain finds water pixels for its screen-space reflection. Opaque materials must
  keep alpha 1 in the scene target. `water.bank` (multiply blend, keeps the target's alpha) and `water.spray` (points)
  are viewer-only looks from `site/water.ts`; the explorer light layer exports neither (only `stone.*` site parts).
  Wave 9: ponds with a natural bank (`naturalShore(f)`, `site/shore.ts`; the terrain is graded by
  `scripts/prepare-terrain.py` `natural_shores`) draw their water as `shoreWater(ring, level, terrain)`: a grid on the
  terrain's own 1 m vertices (x, z = k + 0.5) over the ring grown by `SHORE.reach`, so the terrain contour is the shore;
  a `water` clone with `vertexColors` (shallow tint by depth) that keeps the `waterPatch` marker; no `water.bank`.
  Wave-9 review fix: each shore vertex also carries `aDepth` (level − ground, unclamped); the clone fades in over the
  first `SHORE.fade` m of depth (`shoreFade`) and is drawn transparent with custom blending (colour SrcAlpha /
  OneMinusSrcAlpha, alpha Zero / OneMinusSrcAlpha), so the scene alpha is dst · (1 − fade): the water marker (< 0.25)
  holds where the water is nearly opaque and the shallow rim lets the bank show through.
- **Graded drives and the forecourt strip (wave-9 review fix, `site/drive.ts`):** a `path` LineString with `top`
  (first vertex), `foot` (last), `width` **and** `wall_height` (0 = unwalled) is a drive on a straight grade
  (`isDrive`; TF-35 with top/foot/width but no `wall_height` is not); `wall_height` > 0 adds sloping flank walls
  (`driveWalls`, `DRIVE` in grammar.ts) while the fill exceeds `DRIVE.wallMinFill`, `access.ts` opens the terrace wall
  across its top (`driveCuts`) and a fence across it is clipped (`clipOutsideDrives`). A path whose surface names a
  forecourt is the forecourt strip (`isForecourt`). Both are drawn as draped gravel ribbons (`isDrapedWay`, the drive
  on its graded plane) and are **not painted into the ground classes** (`prepare-terrain.py` `is_drive` /
  `is_forecourt` grade the terrain only), so the viewer's seeded tree planners never see them; the grass blades keep
  off every `isDrapedWay` path.

### 3.7 Object naming and userData
- Names follow `<buildingId>/<part>[/<detail>]`, for example `KB-B01/roof`, `KB-B01/facade/court`,
  `KB-B01/R-2-salon/floor`.
- `userData` follows `PartUserData`: `{ buildingId, part, lod, confidence?, tag?, collider?, roomId? }`.
- Colliders set `userData.collider = true` and are also returned in lists (§5).

### 3.8 Evidence
- Catalogue v2 (2026-11-01) is generated: `pnpm exec tsx scripts/catalogue-v2/build.ts`, then
  `scripts/catalogue-v2/sample_dtm.py` (DTM statistics → `model/v2/dtm-samples.json`), then the build again. It adds
  placement `map` (LP06 only), explicit `facade.sides`/`portals`, and rooms/openings/stairs for B01–B06 and B10 on one
  axis grid per building (partitions on pier midpoints; `scripts/catalogue-v2/checks.ts` checks that no wall meets a window).
- Every Building carries `confidence`, `placement`, `sources` and free-text tags (`D`, `D->`, `I`, `N`, `U`,
  `HMS`). `parseEvidenceTags()` extracts the letters.
- Everything `upgradeV1()` derives is tagged `I (upgradeV1 …)`.
- Grammar constants carry their tag in a comment.
- Do not invent sources. HMS-derived numbers are tagged `HMS`.
- **No HMS frames or textures go into the model** (© Matzerath / Historisches Museum Saar).

## 4. Core API (pure, no three.js runtime)

Import from `model/src/index.ts` (re-exports everything below) or from the individual files.

### 4.1 Catalogue
```ts
loadSite(raw: unknown): { spec: SiteSpec; warnings: Issue[] }          // throws CatalogueError
validateSite(raw: unknown, mode: 'v1-compatible' | 'v2'): ValidationResult
upgradeV1(v1: SiteSpec): SiteSpec                                       // deep copy, version 2
isPlaced(b: Building): boolean                                          // 29 of 47 in v1
parseEvidenceTags(note?: string): EvidenceTag[]
```

**Catalogue v2** (`spec.ts`) is a superset of v1. It adds the following fields.

| Object | New fields |
|---|---|
| Building | `court_toward`, `rooms?: Room[]`, `openings?: Opening[]`, `stairs?: Stair[]` |
| Storey | `kind`, `floor_build_up` |
| Roof | `type` normalised to `mansard \| hip \| gable \| flat \| pavilion \| cone \| dome \| mound \| none`, plus `cover`, `break_ratio`, `dome_rise_ratio`, `dome_tiers` (2 = double-stepped dome with drum-head cornice and lantern, `steppedDomeSection`, GARDEN_DETAIL.steppedDome), `hipped_ends`, `raised[]` (raised centre with `turret`), structured `chimneys`, `dormers` |
| Building, TerrainFeature | `epoch?: { from?, to? }` (KB-I03: years it stood, `to` inclusive, open ends) + `epoch_tag?` (evidence). Absent = stood throughout. Not `placement: 'hypothetical'` (= uncertain) |
| Facade | `sides{court, garden, end_a, end_b: {axes, spacing, groups, from, to, blind}}`, `risalits[]`, `portals[]`, `shutter_type`, `members_colour`, `plinth_colour`, `members_material` (`render \| stone`, KB-I15), `portal_colour` (KB-I15), `rotunda?` (KB-I24: `{order, axis_azimuth, bays[door\|niche\|link], portico?{columns, width, depth, steps, pediment}, colonnade?{length, width, columns_per_side, floor_h, eaves_h, to?}}` on a round footprint), `glasshouse?` (wave 5: `{tag}` lean-to forcing house on a rect footprint with roof `none`; solid N back wall, S-sloped glazing, tiled back strip; exterior/glasshouse.ts, GARDEN_DETAIL.glasshouse); wave 6: `joinery_colour?` (KB-I28: `#RRGGBB` of window frames, glazing bars and door leaves, default `wood.frame` #E9E6DE / `wood.door`), `shutters_omit_storeys?` (KB-I28: storey indices whose windows get no shutters), `fachwerk?` (KB-I21: `{storeys?, tag}` rendered timber frame, absent `storeys` = every storey above plinth/basement; `layout/fachwerk.ts`), `menagerie?` (KB-I29: `{kind 'ring' \| 'rows' \| 'island' \| 'open_pavilion', ring?{centre, radius, houses, loge_azimuth?, roof 'pyramid', cover, moat_radius?}, island?{size, top_h, stair?}, rows?[{p0, p1, houses}], front_azimuth?, run_depth?, channel? EN[] (KB-I97: a 4.5 m trough of level reaches with weirs, layout `channelReaches`), tag}` drawn by `exterior/menagerie.ts` instead of the GARD enclosure wall; wave-6 review fix added `island` (quay over the foundations + spiral stair), `open_pavilion` (hypothetical posts + beam under the catalogue roof) and `ring.moat_radius` (radial grilles run in to the water)). `FacadeSideSpec.window_kind_storeys?` (wave-6 review fix, KB-I28: storey indices whose openings on that side are forced to sill windows (`window`) instead of the side's `window_kind`; validated as integers). `Roof.raised[].turret.fachwerk?` (KB-I21, record only). Wave 7: `folly?` (KB-I31/I39/I30: `{kind 'altan' \| 'chinese' \| 'tent' \| 'hay_wagon' \| 'aviary' \| 'monopteros' \| 'apiary', gate_width?, tag?}`, `FOLLY_KINDS`; a small structure on a one-storey footprint with roof `none`, drawn by `exterior/folly.ts` instead of walls/roof; validate warns unless `placement: 'hypothetical'` + confidence low) |
| Room | `{id, name_de, function, storey, polygon [s,t][], floor_h?, ceiling_h?, finish{floor, walls, ceiling, colour?, border?}, tag, sources?}` (KB-I26/I27: `colour` = the room's silk hue `#RRGGBB` overriding the `wall.silk.*` base, `border` = the damask border colour; validated as hex) |
| Opening | `{kind, storey, wall: {kind:'side', side} \| {kind:'room', room, edge} \| {kind:'segment', p0, p1, rooms?}, a, width, height, sill, head?, tag}` |
| TerrainFeature | kinds: court, terrace, scarp, avenue, rondell, pond, island, dam, cascade, moat, enclosure, well, wall, parterre, path, `lawn` (KB-I12: open lawn on the natural slope, no level), `clump` (KB-I12: Point + `radius` = a clump, MultiPoint = single trees). GeoJSON geometry in EN; `trees{species, rows, spacing, row_distance}`, levels, `wall_height`; KB-I12/I13: `placement?: 'hypothetical'` (skipped only when `showHypothetical` is false; its trees go to a `site/trees-hypothetical` group the viewer's low-confidence select hides), `mix?: {species, share, height?}[]`, `radius?`; a `pond` with `coping{width, height, material}` is a formal basin (`fountain_h?`, `ornaments?{kind: 'stag_head', count, facing}`); a `terrace` with `coping` is a gravel terrace drawn as a level surface with a stone kerb on its free edges and a broad perron at doors whose `grade_h` is its level (wave-2 fix, GARDEN.terraceKerb / GARDEN.perron). A `path` ≤ 4 m wide is drawn as a gravel ribbon draped on the terrain. Wave 5 (KB-I32..I38): a `parterre` or `terrace` with `parterre{type: 'angloise', panels [nu, nv], cross_walk?, tubs?}` is drawn as a parterre à l'angloise (lawn panels with cut corners, sanded sentiers, raised box-edged plates-bandes with border flowers, yew cones, standard roses, optional citrus tubs; `layout/garden.ts parterreAnglaise`); `fence{type: 'treillage', height, portal_height, portals EN[], open_edges?}` adds a green treillage with arched portals on the edges that do not stand against a building; kind `furniture` (MultiPoint) carries `items{type: 'bench' \| 'herm', at, facing (grid az), platform?, name_de?}`; kind `beds` (Polygon) carries `beds{quarters, axis_deg?, frame_rows? EN[][], espaliers? EN[][]}` (`kitchenBeds`). These are built by `site/gardenDetail.ts` into their own meshes `site/garden-detail/<material>`. GARD enclosure walls are stepped bays with a saddle coping, piers and a baked foot shade (`site/gardenWall.ts`, `steppedWallTops`, GARDEN_DETAIL.wall). Wave 8 (KB-I68): kind `fence` (LineString) with `fence_line{type: 'post_rail' \| 'barriere', height, post_spacing?, rails?, tag?}` is a timber fence draped on the terrain: `post_rail` = posts every ≤ FENCE.postRail.spacing with `rails` rails per bay (`site/fence.ts postRailLayout`); `barriere` = a 2-point gap closed by a Schlagbaum on a pivot post with a counterweight, resting in a forked post, and rails on the rest of the gap (`barriereLayout`); validation requires `fence_line` and a LineString (2 points for a barrière); built by `site/features.ts` (timber, not in the stone-only explorer export). A `well` of confidence `low` is drawn as a flush kerb with a stone cover, a med/high one as a Buntsandstein well-head with a grey coping |

Room polygons are in building-local `[s, t]`, so they survive footprint edits that keep the frame.

**Time slice (KB-I03, `layout/epoch.ts`, pure):** `SCENE_YEAR = 1789`; `inEpoch(epoch, year = 1789)` is the one test
every consumer uses; `inScene(items, year)` filters a list; `epochIssues(epoch)` is the `validate.ts` check (integer
years, `from ≤ to`). `BuildOptions.year` (default 1789) is the scene year of a `BuildContext`. In the 1789 catalogue
KB-B13 (Dec 1785 fair rotunda) and KL-B49 (1785 Hymen temple stage set) carry `epoch {from: 1785, to: 1785}`
[D T1/T5/T6]. This is not the viewer's `state.epoch` ('1789' | '2025'), which only switches the terrain.

### 4.2 Frames (`frame.ts`)
```ts
E0, N0; enToLocal(E, N, h?): Vec3; localToEN(x, z): EN; enToXZ(p): [x, z]
gridFrame(pg): { origin, uDir, vDir, toEN(u, v), toUV(E, N) }
azimuthOf(dE, dN); dirEN(az); dirLocal(az); rotationYForAzimuth(az)
enToLatLon(E, N): [lat, lon]; gridConvergenceDeg(E, N); gridToTrueAzimuth; trueToGridAzimuth; trueNorthLocal(E, N)
```

### 4.3 Layout (`layout/`)
```ts
// whole building - START HERE
layoutBuilding(b, spec, { roofVariant?: 'catalogue' | 'enwp-gabled', groundMin? }): BuildingLayout
  // { frame, ring, stack, roofSpec, roof: RoofSection, roofPlan, sides: Record<SideName, BayLayout>,
  //   openings: FacadeOpening[], roofOpenings: RoofOpening[], raised: {section, s0, s1}[], warnings }
makeLayoutFn(spec, opts) // memoised (context.ts) -> ctx.layout(b)

// frame
buildingFrame(ring, { courtToward?, axisAzimuth?, rectThreshold?, roundCv? }): BuildingFrame
  // shape 'rect' | 'polygon' | 'round', centreEN, sDir, tDir, azimuthS, length, width, radius?,
  // ringST, sides, rotationY, originLocal
stToEN, enToST, stToLocal, stToObject, sidePoint(frame, side, a, inset), sideFacing(frame, az)
lineFootprint(line, thickness)                         // WALL class

// storeys
storeyStack(b, { groundMin?, buildUp? }): StoreyStack  // levels[], floors[], eaves_h, plinth{bottom_h, extension}
inferStoreyKind(storey); levelAt(stack, y); entranceStorey(stack)

// roof
roofSection({ type, depth, eaves_h, pitch_lower?, pitch_upper?, break_ratio?, dome_rise_ratio?, dome_tiers?, ridge_h?, matchRidge? }): RoofSection   // dome_tiers 2: final stepped profile, `tiers: 2` on the section
  // eaves_h, ridge_h, rise, break_h, break_inset, deck_width, ridge_inset, profile [t, h][], adjusted, notes
roofPlan(section, length, hippedEnds?): RoofPlan       // ridgeLength, ridgeEndInset, breakRect, deckRect
roofHeightAtInset(section, inset)

// facade
parseRhythm(text); risalitsFromGroups(side, groups); centreAxes(n); axesThatFit(L, spacing)
sideSpec(facade, side, length, cls): FacadeSideSpec
layoutBays({ side, length, axes, spacing?, from?, to?, groups?, risalits?, cls?, blind? }): BayLayout
facadeOpenings({ cls, side, layout, stack, portals? }): FacadeOpening[]   // a, width, height, sill, bottom_h, top_h, head, kind, steps?
roofOpenings(layout, section, { lower?, upper?, head? }): RoofOpening[]   // dormers per axis, oculi alternate (HMS)
cullBuriedOpenings(openings, frame, groundAt(E, N), clearance?, probe?, doorTolerance?)
portalAxes(portal, axes)

// rooms
pileBands(width, { outerWall, spineWall?, layout?: 'single' | 'double' | 'double_corridor', courtPileClear?, corridorClear? }): PileBand[]
enfiladeRooms({ storey, s0, direction, band, items: ProgrammeItem[], partition?, floor_h?, ceiling_h? }): { rooms, partitions, end }
enfiladeDoors(partitions, { storey, windowWallT, into, offset?, width?, height? }): Opening[]   // aligned on one line
widthsBetweenAxes(axisS, counts, s0, s1, partition?): number[]   // partitions on pier centres
axisSCoordinates(bayAs, 'garden' | 'court', length); rectST; roomArea

// stairs
stairRun(rise, 'prunk' | 'secondary' | 'service' | 'freitreppe'): StairRun   // Blondel 2R+T = 0.65

// site
avenueTrees(line, trees, { seed?, jitter?, endClearance? }): TreePosition[]
geometryCentroid(g); resolveCourtToward(spec, v, from?); nearestOnLine(line, p); featuresOfKind(spec, kind)

// garden (KB-I11..I13, layout/garden.ts; norms in grammar GARDEN)
chaikin(line, iterations); resample(line, step); walkRibbon(line, width, step?): {centre, left, right, width}
polylineSelfIntersects(pts); distanceToLine(line, p)
allocateShares(mix, n); clumpPlants(centre, radius, mix, {seed?, areaPerPlant?}): Plant[]; singleTrees(points, mix, seed)
circleRing(centre, r, n); basinOrnaments(centre, r, count, toward): {p, facing}[]
avenueBlockers(spec, feature, year): EN[][]; treeBlocked(E, N, blockers)   // shared by site/features.ts and plans

// rotunda (KB-I24, layout/rotunda.ts; norms in grammar ROTUNDA): round temple pavilion with facade.rotunda
rotundaLayout(L): RotundaLayout | null   // radius, axis, floor_h, order (orderFor), attic, bays[], pilasters[],
                                         // portico {columns, steps, pediment {base_h, apex_h, halfWidth},
                                         //   atticBlock {front, back, halfWidth, top_h} | null (the portico roof ends
                                         //   against it, top ≥ pediment roof + ROTUNDA.atticBlockClear; null when
                                         //   ROTUNDA.porticoCollar: the roof runs into the drum, wave 10), outline},
                                         // colonnade {columns, steps, outline, to_id}
orderFor(name, foot_h, height); stepsBetween(drop, maxRiser?); drumPoint(angle, r); rotateST
// consumers: exterior/rotunda.ts buildRotunda (registered in exterior/index.ts for round footprints with
// facade.rotunda) and plans/src/sheets/lageplan.ts (portico + colonnade outlines)

// KB-I21 Fachwerk (layout/fachwerk.ts; norms in grammar FACHWERK): the one place that decides outer wall and reveal
fachwerkStoreys(b): number[]; isFachwerk(b, storey)
outerWall(b, storey?): { thickness, reveal, fachwerk }   // 0.30 m / 0.13 m on Fachwerk storeys, else WALL_THICKNESS
// consumers: exterior/facade.ts (per-opening reveal depth and frame plane), interior/model.ts generatedRooms,
// plans grundriss.ts / schnitt.ts; the gallery programme (scripts/catalogue-v2/programme.ts) uses FACHWERK.wall

// KB-I29 menagerie (layout/menagerie.ts; norms in grammar MENAGERIE): EN plan of houses, grilles, runs, posts, channel
menagerieLayout(m: MenagerieSpec, seed = 0): { houses[{kind 'house'|'loge', centre, front, width, depth, eaves, pitch,
                                     roof 'pyramid'|'gable'}], grilles[{a, b, radial?}], runs[{ring}],
                                     terraces[{a, b, back}], posts EN[], channel }
// rows: seeded jitter (grammar MENAGERIE.rowJitter, mulberry32(seed)); ring: yards closed behind the houses, radial
// grilles to ring.moat_radius; 'island' / 'open_pavilion' return an empty layout (drawn directly from the spec)
distToPolyline(p, line)   // slots the watercourse crosses stay open
// consumer: exterior/menagerie.ts buildMenagerie (dispatched in exterior/index.ts before the glasshouse/facades)

// wave 7 follies (layout/folly.ts; norms in grammar FOLLY): local [s, t] placement helpers, no three
polygonRing(n, r, phase = 0): [s, t][]                       // regular n-gon, CCW
altanPiers(width, gate = 0, pier?, maxSpan?): number[]       // symmetric pier centres; gate mouth clear; clear span ≤ maxSpan (a front too narrow for jamb piers: end piers only)
concaveRoofProfile(r, rise, upturn, n = 4): [radius, h][]    // Chinese tent roof, eave (upturned) → apex, sags below the chord
skepCentres(len, spacing?, skep?): number[]                  // straw skeps on one apiary shelf
upsweptRoofPoint(a, b, t, u, {top, rise, upturn, cornerLift, cornerOut}): [s, t, h]  // wave 8: one sector of an up-swept polygonal roof (hips lift + reach out ∝ c²(1−u)²); KL-B50 double roof (grammar CHINESE_ROOF)
// consumer: exterior/folly.ts buildFolly(g, gr, L, pal, ctx) (dispatched in exterior/index.ts after the menagerie
// branch); the Altan's deck height is the building's eaves_h (= the S wing Beletage floor in the catalogue)

// free-standing walls (fix round 1): parts of a WALL line clear of other footprints (exterior + elevations)
wallFreeSpans(line, footprints, tol = 0.8): [d0, d1][]; distanceToRing(p, ring)

// geometry
signedArea, isCCW, ensureCCW, openRing, closeRing, centroid, convexHull, minAreaRect, circleEstimate,
pointInPolygon, polylineLength, pointAlong, mulberry32, hashString
```

### 4.4 Grammar (`layout/grammar.ts`)
This file holds all period-norm numbers, from research/02 §2 plus the HMS overrides:
- `AXIS_SPACING`, `FLOOR_BUILD_UP` and `WALL_THICKNESS` per class
- `WINDOW[class][ground | upper | mezz]`, `PORTE_FENETRE_HEIGHT`, `CELLAR_WINDOW`, `PORTAL`, `INTERIOR_DOOR`
- `ROOF` (mansard break 0.4·d/2, dome 0.3·d), `CORNICE`, `DORMER`, `CHIMNEY`, `ARTICULATION`, `STAIR`,
  `AVENUE`, `SILL_WINDOW` (facade sides with `window_kind: 'window'`), `PORTICO` (portal option `portico`)
- KB-I18/I22/I23 (research/09 §2.7-2.8, §3.5-3.6, §5, G5, G10, G11, E3-E5, C6, M9; HMS 06 §3.2): `ROOF_COVER`
  (Biberschwanz format, `leadDeckMaxPitch` 10°: a mansard deck flatter than that is drawn `roof.lead`,
  `exterior/roof.ts isLeadDeckSegment`), `LIGHTNING_ROD` (Hemmer five-point masts ≤ 18 m apart, down-conductor at a
  free garden-side corner), `DOWNPIPE` (Ø 0.11 m, hopper head, none on FARM/FARM_GROUP/GARD/WALL; wave-4 review:
  corners first, then risalit / passage flanks, a pier only where it is free of surrounds and open shutter leaves,
  never inside a risalit, ≤ `maxSpacing` 25 m apart where a free spot exists), `WEATHER_VANE` (Dachreiter and pavilion apexes), `COURT_FURNITURE` (sentry boxes,
  Prellsteine, cobbled lanes, gutters). Pure planning in `exterior/hardwarePlan.ts` (`rodMasts`, wave 8 `hemmerMasts(ridgeLength, sMid, rule, chimneys)` (masts on the high points: one at each ridge end inset `HEMMER_ROD.endInset`, no intermediates, one central mast on short ridges, moved clear of chimney stations; wave-8 review fix), `hemmerMastHeight(roofRise, rule?, area?)` (mast scaled to the roof, `HEMMER_ROD.mastRoofShare` within `mastMin`..`mast`; wave 9: footprints under `pointArea` get a short `pointMast` point; the head drawn by `hardware.ts hemmerMast()` is a gilt knob with a vertical spike and four short level points, no arms), `chimneyStations(L)` (the chimney positions shared by `facade.ts chimneys()` and the masts), `conductorCorner`,
  `conductorPath`, `downpipePositions`, `sideDownpipes`, `openingBlock`) and `site/courtPlan.ts` (`courtPlan`,
  `diagonalBands`; the axis lane `lane.width`, cross lanes `lane.crossWidth`); geometry in
  `exterior/hardware.ts` (`roofHardware`: downpipes and vanes from LOD1, rods and conductor at LOD2; wave 8: tapered dark masts with the gilt five-point head from LOD1, the conductor at LOD2) and
  `site/court.ts` (`buildCourtFurniture`, called by `site/features.ts` for the Ehrenhof court; the lanes are one
  quad each with an `aLane` attribute (`laneGeometry`) drawn by the procedural Katzenkopf shader
  `materials/cobbles.ts` `cobblePatch`, whose `userData.groundLit` makes the viewer light it like the terrain:
  SH sky diffuse, no PMREM). `massing()` and
  `grille()` take the LOD (spear tips on railings from LOD1, gilt on gate leaves).
- KB-I24 (research/10 §0.2, §b.1 KB-B07): `ROTUNDA` (appended at the end of the file): Vignola orders (Ionic 9 D,
  Doric 8 D, Tuscan 7 D; entablature 1/4 of the column; base, capital, taper), pilaster projection, door share of a
  bay, door head gap, niche depth, steps (riser 0.16, tread 0.38), attic 0.9 m, drum wall 0.45 m, pediment 22°,
  `atticBlockClear` 0.2 m, `domeRibs` 16 [N]. Revolved roofs (`exterior/roof.ts roundRoof`) have smooth normals
  (dome: also along the profile) and 48 segments × 12 dome steps from LOD1.

KB-I16/I17 (research/09 §3.1, §3.4, G1-G9): `CASEMENT` (French two-leaf casement: meeting stile, frame, transom
only at ≥ 2.6 m at 3/4 h), `GLAZING` (`state` CdL Beletage 1 pane per leaf h ≈ 0.55 m; `court` 2 per leaf ≈ 0.25 ×
0.33 m; `farm` 2 per leaf in 3-4 rows) with `glazingClass(cls, row)` and the pure `glazingLayout(cls, row, w, h,
archRise)` used by the exterior and the plan elevations; `MEMBERS` (string course and window caps only on the CdL;
caps only on its centre-risalit Beletage axes) and `CORNICE.palace` + `corniceFor()` (one continuous palace cornice
where `defaults.eaves_continuous` and the eaves sit on `eaves_palace`). `layoutBuilding()` resolves them into
`BuildingLayout.members` (`cornice`, `stringCourse`, `cornerLisenen` – not on FARM/FARM_GROUP – and
`risalitLisenen` `'all'` on the CdL, `'portico'` elsewhere); `FacadeOpening` gains `row`, `hood` and `balcony`
(balconets only before a porte-fenêtre above a portal). Surrounds are flat 0.20 m bands, `ARTICULATION.ecklisene`
0.6 × 0.02 m.

Fix round 1 added these optional, additive spec fields: `FacadeSideSpec.window_kind`, `PortalSpec.grade_h` (the level the steps start from, e.g. a parterre) and `PortalSpec.portico { columns, balcony, depth? }`. `FacadeOpening` carries `grade_h`/`portico`. The wave-7 review fix added `PortalSpec.balconet` (default true; `false` = an upper-storey porte-fenêtre without an iron balconet because it opens onto a terrace drawn as its own building, e.g. the S-wing Altan KB-B02a). In the interiors, `collectOpenings(b, layout, groundAt?)` and `interiorModel(b, layout, seed, groundAt?)` cull terrain-buried facade openings with the same `cullBuriedOpenings` as the exterior. Deep straight reveals get a splay (`revealSplay`).

Wave 4 fix (KB-I25 review) added wall niches to the interiors, all optional and additive: `Item.niche` (a furnishing piece standing in a niche, `{wall, u0, u1, v1, depth, head, tag}`), `RoomWall.niches` (filled by `interiorModel` from the items; `buildShell` cuts them into the room face as a semi-elliptic, round-headed niche with a moulded surround) and the pure `stoveNichePlan(walls, clearH)` with the sizes in `STOVE_NICHE` (`interior/programme.ts`). A dining room whose function names "stove niches" gets two `altar_stove` pieces in such niches on one blind outer wall.

KB-I26/I27 (state-room finishes) added, all additive: `Finish.colour?` / `Finish.border?` (above); the material names `wall.silk.yellow` and `wall.silk.grey` (`MATERIAL_NAMES`, `MATERIAL_BASE`, interior `FALLBACK`); `STATE_ROOM` in `layout/grammar.ts` (dado 0.9 m, Tapetenleiste, damask border and repeat, parquet panel 0.974 m = `PARQUET_PANEL`, supraporte minimum, rosette, sconce, library oak/frieze/taffeta, gallery counts); the pure module `interior/finish.ts` (`silkHue`, `borderColour`, `silkFields`, `borderRects`, `damaskMotif` + its GLSL twin `DAMASK_GLSL`, `canvasGrid`, `mirrorGrid`, `meanderRects`, `countIn`; `SILK_BASE` is tested equal to `MATERIAL_BASE`); in `interior/mesh.ts` `Bucket.colourGrid` (per-vertex linear colours, the geometry then carries `color`), `MouldProfile`, `beadProfile` and `mouldFrame` (mitred profiled frame sweep for Tapetenleisten, boiserie, door surrounds, picture and mirror frames); `damaskMaterial(lib, name, colour)` and the extras `interior.canvas` / `interior.vitrine` in `interior/materials.ts`; `ShellInput.rosettes` (a stucco rosette only under a chandelier); item kinds `bergere`, `curule` (instanced) and `sconce`, `candelabrum` (sized, no footprint), and `Item.style {oak, frieze, wireDoors, white}` for the library cases and the white collection cabinets. Documented counts (20 chandeliers, 104 curule chairs, 2 bergères) are read from the room `function` text with `countIn`, so the catalogue stays the single source.

Wave-5 review fix (interiors), additive: `damaskMaterial(lib, name, colour, figure = 'floral')` with `DamaskFigure` `'floral' | 'arabesque'` and `damaskFigureOf(fn)`; `damaskMotif(u, v, aa, figure)` (GLSL twin switches on `DAMASK_ARABESQUE`); `mirrorGrid(seed, w, h, room = { wall })` paints the room's own colours under `MERCURY_TINT` (`interior.mirror` is a clear-coated non-metal glass), plus `gridLuminance`; `corniceHeight`, `supraportePanels` and `splitField` in `finish.ts` (shell and gallery hang share the supraporte geometry); `STATE_ROOM.panelMax` and `STATE_ROOM.damask.sheen`; `wallOverlap` and `fitSconces` in `programme.ts`; `PEARL_COVER` in `evidence.ts`; `marbleMaterial(lib, colour, vein)` in `materials.ts`; `FixtureCtx.wall?` (the room wall colour for mirrors).

Wave 6 (architecture), appended at the end of the file: `FACHWERK` (KB-I21: wall 0.30 m, reveal 0.13 m, masonry joinery plane 0.17 m), `ORANGERIE_JOINERY` (KB-I28: #F2F0EA, D T5 white; hue N), `MENAGERIE` (KB-I29: ring house 3.6 × 3.6 m, eaves 2.6 m, pyramid 40°; loge 5.6 × 4.8 m; `ringYard` 1.2 m; row house 3.4 × 3.0 m, eaves 2.4 m, gable 30°, slate (D T20) with `rowJitter` shift 0.35 / narrow 0.3 / eaves 0.12 m; grille square bars 26 mm at 0.2 m, height 2.2 m; run depth 9 m, net 3.6 m on posts ≤ 4.5 m apart, 1.5 m cord cells; channel 2.2 m + 0.35 m kerbs; `terraceWall` 0.55 m thick, rise 0.35-1.6 m, 0.12 m coping; `runGround`; `island` quay/foundation/stair; `openPavilion` posts 0.18 m, 3 per side, beam 0.22 m) and `HEARTH` (marble palettes state/private, cast iron, faience glaze/joint/band/brass, tile 0.21 m, 16 flutes). Interior pure modules: `interior/chandelier.ts` (`chandelierPlan()`, `CHANDELIER`: the glass-dressed lustre, ≤ 2,500 triangles as a prototype) and `interior/hearth.ts` (`HearthKit`, `consoleProfile`, `chimneypiece`, `flutedSection`, `faienceStove`), used by `interior/fixtures.ts`.

Wave 7 (architecture), appended at the end of the file: `FOLLY` (all form/sizes N unless noted): `altan` (D existence T5 Abb. 11: piers 0.75 m, clear span ≤ 4.4 m, deck 0.45 m, balustrade 1.0 m), `chinese` (octagon on a 0.45 m plinth, red posts / green railing, eaves 3.4 m, concave roof with 0.55 m upturn, gilt finial; research/11 S14), `tent` (16-segment striped drum 2.3 m, cone rise 2.6 m, valance), `hayWagon` (4.6 m bed, wheels 1.35/1.05 m, hay load), `aviary` (V23 no. 20: octagonal core 4.6 m with slate pyramid 38° and two wire wings), `monopteros` (V23 no. 2: three steps, 8 Tuscan columns 4.2 m, entablature, shallow dome) and `apiary` (V23 no. 16: tiled lean-to, three shelves of straw skeps). The wave-7 review fix changed: `altan` deck 0.6 m (architrave/frieze/cornice, `baseCourse`), `chinese` (`finialProfile` stacked finial, `bell`, `valance`, `fretCells`, matt green roof), `tent` (24 segments, blue/white, `swell`, `crescent`), `hayWagon` (`loadOver` 0.5, flaring `ladder`/`ladderFlare`), `monopteros` (`base`, `capital`, `architrave`, `frieze`, `corniceProjection`, `domeRise` 0.5, `domeSegments`, `domeColour`, `finialBall`), and appended `GLASSHOUSE` (lapped crown-glass panes, sash bars, rails, chimneys, night-mats for `exterior/glasshouse.ts`; the panes face into the house so `glass.crown` shows them as clear glass from outside).

The explorer export (`model/src/explorer/export.ts`, wave 7, KB-I62) adds `POSITION_STEP` (1/64 m), `POSITION_MAX_ERROR` (0.01 m) and the pure `quantisePositions(pos, step, maxError)` → `QuantisedPositions | null` (`q` Int16Array, `offset`, `step`, …) (offset snapped to the global grid; `null` = keep float32); `scripts/export-explorer.ts` writes the node translation/scale (see `docs/explorer-integration.md` §2.1).

Wave 11 (architecture), appended at the end of the file: `CDL_CENTRE` (audit #8, the garden front of the CdL centre
risalit, research/02 §2.3 / §2.6 and research/09 §3.4 [N; I sizes]): `lisene` (0.7 × 0.05 m on the risalit edges of
KB-B01 only, `risalitLisenen === 'all'` and `risalit.kind === 'centre'`), profiled `surround` (0.06 band + 0.03
fillet), EG `keystone`, and the glazed garden `door` (stiles, meeting stile, battement bead, bottom rail, fielded
panel to 0.85 m, hood). `exterior/facade.ts` draws them via the internal `glazedDoorJoinery` (a glazed opening with no
arch rise); a Verdachung is drawn only where it clears the cornice (`capTop ≤ eaves − cornice`), so the Beletage hoods
that sat inside the palace cornice are gone. `ROOM_ORDER` (audit #9, research/09 §4.2 [N; I rank]): boiserie tones
`blanc` / `perle` / `gris`, rosette size rule, `plainCove`, carved-head sizes. Pure helpers in `interior/finish.ts`:
`roomOrder(type)` → `{ cornice: 'grand' | 'state' | 'plain', tone }`, `corniceProfile(order, c, reach, ch)` (fold-free
section), `rosetteRadius(span)`, `carvedFields(n)` (every second field, symmetric). Geometry helpers in
`interior/mesh.ts`: `beadProfileLite(w, z)` (5-facet bead for dado frames), `carvedHead(b, m, w, bead, sag, lite)`
(laurel swag tied with ribbon bows, over pier glasses and on every second upper field of gilt panelled rooms); in
`interior/furniture.ts`: `ovalMoulding(a, b, segs, section)` and `MEDALLION_SECTION` (the 22 × 16 mm seat-back oval).
Tests: `model/tests/wave11.architecture.test.ts`.

Wave-11 review fix (architecture), additive: `CDL_CENTRE.shutter` (`clear` 0.05 m, `fold` 0.5 [I]) and in
`layout/facade.ts` `LeafFit` (`'full' | 'folded' | 'none'`), `LEAF_GAP`, `leafSpan(a, width, side, fit, face?)` and
`shutterLeafFit(a, width, side, guards, face?)`: an open leaf lies flat on its own wall plane; beside the CdL centre
risalit's Lisenen (and the air past its edges) or a centre risalit's return it is sized to the pier (full, a two-panel
folding leaf, or none); `exterior/facade.ts` passes those guards to `furnishOpening` (no leaf is lifted onto a Lisene any
more). `ROOM_ORDER.carved` gains `glassMax` (1.6) and `crest` (0.2: pier glasses stop that much lower, programme.ts);
`carvedHead` draws paired pointed laurel leaves (lite: alternate single leaves), bows just outside a glass frame's top
corners, longer ribbon ends and drops. `ShellInput.covers?: WallCover[]` (`{pos, facing, width, z0, z1}`, filled by
`interior/index.ts` from pier glasses, trumeaux, pictures and cases) and the pure `wallCoverSpans(covers, wall)` in
`interior/shell.ts`: no panel-field head is carved behind a wall-hung item, and the every-second-field alternation runs
over the free fields. KB-I97: `MENAGERIE.channel` is `{ width 4.5, kerb 0.35, freeboard 0.2, over 0.05, weir 0.4,
maxProud 0.6, minReach 4, step 2 }` and `MENAGERIE.houseRender` (`#DED6C5`, `render.farm`) [I]; `layout/menagerie.ts`
adds `ChannelReach`, `channelReaches(line, ground, C?)` (level reaches, weirs at the foot of each terrace step, water
never buried and never uphill, either line direction), `crossing`, `polylineAt` (arc lengths from the shared
`layout/geom.ts` `polylineLength`), and cuts each row's
terrace wall open where the watercourse passes (`terraces` may hold two pieces per row).

Consumers read these constants and must not hard-code numbers. A new norm goes into this file with its tag.

### 4.5 Facts the core reproduces (tests)
- All 21 v1 `ridge_h` values come out of the default rules within 0.05 m (mansard break 0.4·depth/2,
  pitched `depth/2·tan p`, dome 0.3·depth).
- All v1 `eaves_h` values equal `base_h + Σ storeys`.
- The CdL frame is 77.9 × 18.0 m. Its court side faces az 260.5° grid (W). In the palace grid it spans
  u 28.2–46.2 and v −37.3–40.6.
- The raised 7-axis centre spans s ±14.35 m.
- All EN ⇄ local and (u, v) ⇄ EN round trips are below 1 mm.
- Grid convergence −1.23° is computed and matches the catalogue.

## 5. Work-package contracts (signatures to implement)

The types are in `model/src/api.ts` and `model/src/context.ts`.

```ts
// model/src/exterior/index.ts            (exterior + viewer package)
export const buildExterior: BuildExteriorFn;   // (b: Building, ctx: BuildContext) => THREE.Group

// model/src/interior/index.ts            (interiors package)
export const buildInterior: BuildInteriorFn;   // (b: Building, ctx: BuildContext) => THREE.Group

// model/src/site/index.ts                (exterior + viewer package)
export const buildSite: BuildSiteFn;           // (spec: SiteSpec, ctx: BuildContext) => { group, colliders: THREE.Mesh[], pois: Poi[] }

// plans/src/index.ts (+ main.ts CLI)     (plans package)
export const generatePlans: GeneratePlansFn;   // (spec: SiteSpec, outDir: string) => Promise<string[]>

interface BuildContext {
  spec: SiteSpec;
  lod: 0 | 1 | 2;
  materials: MaterialLibrary;                  // get(name: MaterialName), tinted(name, colour)
  terrain: (x: number, z: number) => number;   // local frame -> true height; NaN outside
  options: { roofVariant: 'catalogue' | 'enwp-gabled'; style: 'realistic' | 'evidence'; showHypothetical: boolean; seed: number };
  layout(b: Building): BuildingLayout;         // makeLayoutFn(spec, { roofVariant }) - memoised
}
interface Poi { id; name_de; kind: 'building' | 'room' | 'feature' | 'view' | 'entrance'; position: Vec3; lookAt?; buildingId?; roomId?; text_de?; confidence?; tags? }
```

Rules for all builders:
1. Start from `ctx.layout(b)`. Do not recompute frames, axes or heights.
2. Skip buildings for which `isPlaced(b)` is false. Skip `placement === 'hypothetical'` unless
   `ctx.options.showHypothetical` is set. Skip buildings and terrain features whose `epoch` excludes the scene year
   (`!inEpoch(x.epoch, ctx.options.year)`; KB-I03). `site/access.ts` `siteBuildings(spec, ctx)` and
   `siteFeatures(spec, year)` apply all three rules; the plans (`placedBuildings(spec, year?)`, sheet lists, tree
   blockers, 1789 ground) and both exports (`export-glb.ts`, `export-explorer.ts`) use the same filters.
3. Return a Group positioned with the building-group convention (§3.2). Name it `<id>/exterior` or
   `<id>/interior` and set `userData.buildingId`.
4. `buildExterior` uses `cullBuriedOpenings(openings, frame, (E, N) => ctx.terrain(E − 381000, N0 − N))` for
   openings below grade. It extends the plinth to `stack.plinth.bottom_h` or below the sampled terrain. It
   honours `roof.raised` and `facade.risalits`. FARM_GROUP is an envelope: render it as a placeholder or skip it.
   Round / polygon footprints are extruded from `frame.ringST`.
5. `buildInterior` produces geometry only for `b.interior !== 'none'`.
   - It uses `b.rooms` / `b.openings` / `b.stairs` when present.
   - Otherwise it generates a programme with `pileBands`, `widthsBetweenAxes`, `enfiladeRooms`, `enfiladeDoors`
     and `stairRun`. Generated rooms carry tag `I`/`N`. The CdL hypothesis is in research/05 §e.
   - The rooms must line up with `layout.openings`: same axes, same sills.
   - Walk colliders are floors, walls and stairs (`userData.collider = true`).
6. `buildSite` covers terrain features (courts, terraces with retaining walls, scarps, avenues via `avenueTrees`
   (young trees on stakes, KB-I11), ponds at `water_level` (natural banks get a `wetBank` band; a pond with
   `fountain_h` gets a jet at its centroid, KB-I37), formal basins with coping, jet (+ `jetSpray`) and rim sculpture (KB-I13),
   garden walks, clumps and single trees (KB-I12), cascade, and the Ehrenhof furniture of KB-I23: paired striped
  sentry boxes at the CdL portal, the court Durchfahrten and the approach, Prellsteine beside the passages, cobbled
  carriage lanes and sandstone gutters, all colliders) plus walk colliders and POIs (German `name_de`). There is a POI per placed
   building and an entrance POI per portal.
7. `generatePlans` writes SVG plans (and PDF, if the package chooses a dependency):
   - Lageplan 1:2000 and 1:500; Grundrisse (one per walkable storey); Ansichten (court, garden, ends);
     Schnitte (through the axis).
   - Inputs: `layoutBuilding` + `b.rooms`. Labels in German.
   - Every sheet carries the evidence legend, the confidence and "Hypothese – Stand <date>".
   - Plans use EN or (u, v) plan coordinates and never three.js.

## 6. How the explorer will load the result

`pnpm run export` (to be implemented by the exterior package) writes to `model/out/` (git-ignored):

```
model/out/
  index.json
  site.lod0.glb  site.lod1.glb
  KB-B01.lod0.glb  KB-B01.lod1.glb  KB-B01.lod2.glb   (lod2 = exterior detail + interior)
  …
```

- Every glb is in the **explorer local frame**:
  - The root node is at (0, 0, 0). Each building node carries the building-group transform (position
    `originLocal`, rotation `rotationY`).
  - Vertex heights are true metres DHHN2016 (y = h). Units are metres; glTF +Y is up, matching three.
  - The explorer adds its vertical exaggeration by scaling y about `hRef` on the loaded scene.
- Material names follow §3.6. Textures are referenced, not embedded, at LOD0/1 (see `textures.json`).

`index.json`:
```json
{
  "version": 1,
  "generated": "2026-11-01T12:00:00Z",
  "frame": { "crs": "EPSG:25832", "E0": 381000, "N0": 5465000, "height_datum": "DHHN2016", "local": "x = E - E0, y = h, z = -(N - N0)" },
  "time_slice": "summer 1789",
  "catalogue_version": 2,
  "buildings": [
    { "id": "KB-B01", "name_de": "Corps de logis …", "cls": "CDL", "confidence": "med", "placement": "lidar+hms",
      "lods": { "0": "KB-B01.lod0.glb", "1": "KB-B01.lod1.glb", "2": "KB-B01.lod2.glb" },
      "bbox_local": [[xmin, ymin, zmin], [xmax, ymax, zmax]], "eaves_h": 356.4, "ridge_h": 364.44,
      "interior": "detailed", "sources": ["…"] }
  ],
  "site": { "lods": { "0": "site.lod0.glb", "1": "site.lod1.glb" } },
  "pois": [ { "id": "…", "name_de": "…", "position": [x, y, z] } ],
  "attribution": ["Rekonstruktion (Hypothese): Schloss-Karlsberg-Teilprojekt", "Texturen: Poly Haven (CC0)", "Gelände: LVGL-SL ALS 2025 (dl-de/by-2-0)"]
}
```

The explorer integration (loader, layer toggle, exaggeration) belongs to the explorer session and is specified
there in `docs/data-contract.md`. This package only guarantees the frame and the index format above.

**Explorer layer (2026-11-01).** The explorer does not load `model/out/`. It loads the light, single-file product
`sle-recon-v1` from `pnpm run export:explorer`: one meshopt-compressed glb with one node per building, vertex
colours, a `_CONF` attribute and base skirts to the 2025 DTM, plus `footprints.geojson` and `index.json`. Since
KB-I19/I20 `COLOR_0` = material colour × the builder's `aShade` (albedo variation × AO at `EXPLORER_AO_STRENGTH`
0.6, `shadeColour`); the format is unchanged (≈ 5.6 MB, 388 k triangles). Camera
handover runs in both directions through URL parameters (`viewer/src/handover.ts`). Both are specified in
`docs/explorer-integration.md`.

## 7. Coding rules and quality gates
- **Pure logic is in `model/src/layout`, `frame.ts`, `spec.ts`, `validate.ts` and `catalogue.ts`.** It has no
  three.js import (type-only imports are allowed in `context.ts` / `api.ts`) and every function is unit-tested.
  Code that uses three lives only in `model/src/exterior`, `model/src/interior`, `model/src/site` and `viewer/`.
- Gates: `pnpm run test` and `pnpm run build` must pass. Rendering changes get a browser check with screenshots
  (dev server on port 5260).
- English code and docs; German UI labels and building names (`name_de`).
- Deterministic generation: use `mulberry32(hashString(id) ^ ctx.options.seed)` for any randomness.
- Dependencies are pinned to exact versions. New dependencies need a reason in the commit message.
- Data stays out of git: `viewer/public/textures/`, `model/out/`, `dist/` and video2world inputs and work.
- Heritage: the model is a hypothesis. The UI shows confidence and "Schauen, nicht graben". There is no
  digging or detector guidance.

## 8. Textures
- `scripts/fetch-textures.sh` downloads 8 CC0 sets from Poly Haven into `viewer/public/textures/<name>/`:
  2K JPG `diff.jpg` (sRGB), `nor_gl.jpg` (OpenGL normal) and `arm.jpg` (AO/rough/metal → `aoMap`,
  `roughnessMap`, `metalnessMap`).
- Both maps are normalised to their mean in the shader (`model/src/materials/index.ts`): the colour map only
  modulates luminance around the catalogue tint, and the ARM G channel only varies roughness around
  `MATERIAL_BASE[*].roughness` (`roughnessScale`, ratio clamped 0.5–1.6, contrast 0.5). three.js would otherwise
  multiply roughness by G, and Poly Haven's parquet (G ≈ 0.10) and sandstone (G ≈ 0.51) went mirror-like and glossy.
  Roof covers use no ARM map at all.
- Interior meshes receive shadows; only room walls, cornices and ceilings cast (`INTERIOR_SHADOW_CASTERS`). `buildInterior` sets the flags (`interiorShadows`); the viewer keeps them as an upper bound.
- The script works sequentially with a UA, retries and an MD5 check. It is idempotent. The total is 66 MiB.
- The sets:

| Set | Poly Haven asset | Use |
|---|---|---|
| `lime_plaster` | painted_plaster_wall | render (tint `#ECE8DF` / `#E8DFC8`) |
| `slate_roof` | roof_slates_03 | palace roofs |
| `clay_tile_roof` | ceramic_roof_01 | Biberschwanz-type plain tiles: Nutzbauten |
| `sandstone_ashlar` | sandstone_blocks_08 | plinths, dressings (tint red `#A65E4A` / grey) |
| `sandstone_flags` | red_sandstone_pavement | vestibule, stair hall, court paving |
| `parquet` | diagonal_parquet | state rooms (stand-in for Tafelparkett) |
| `gravel` | gravel_floor_02 | courts, paths (tint `#C8BFAE`) |
| `grass` | leafy_grass | lawns, parterres |

- `viewer/textures.json` records each set's source URL, authors, licence (CC0), real-world size in m (for
  UV scale), files with MD5 and byte sizes. `TEXTURE_SIZE` in `model/src/materials/index.ts` overrides the size where
  the model needs another grid (`sandstone_ashlar`: 3 × 1.8 m, 0.36 m courses, matching `ASHLAR`; `clay_tile_roof`:
  `clayTileSize()` = 3.65 × 1.84 m, so the measured 12.26 courses / 20.25 tiles per image give the Biberschwanz 0.15 m
  course and 0.18 m width of grammar `ROOF_COVER`, KB-I18).

## 9. Known limits of the core (to revisit with evidence)
- `upgradeV1()` reads portals from v1 free text with a few explicit rules (§ catalogue.ts). Anything it cannot
  parse stays text.
- The raised CdL centre height (`extra_h` 1.5 m) is **U**. The CdL court side has 9 axes (v1) where HMS counts
  15 (4 + 7 + 4); the catalogue decides this, not the code.
- Window sizes per class are **N** (research/02). HMS says that EG and OG windows of the wings are equal; WING2
  follows that.
- `buildingFrame` uses the minimum-area rectangle. Strongly irregular footprints (Herzogsterrassen,
  FARM_GROUP) get `shape: 'polygon'` and their sides refer to the bounding rectangle.
- Baumagazin (12 axes on 38 m) and Reithaus (13 axes on 54 m) do not fit their catalogue spacing. The layout
  compresses them and warns.

Wave 8 (architecture), all additive: the material name `wall.granite` (`MATERIAL_NAMES`, `MATERIAL_BASE` #96928A, interior `FALLBACK`) with its shader patch in `materials/granite.ts` (`GRANITE`, `graniteFlecks` / `graniteShares` CPU twin, `GRANITE_GLSL`, `granitePatch`; flecks on the face UVs, faded to the mean shares beyond ~2 grains per pixel); `exterior/rotunda.ts` exports `glazedDoor` (one outward-facing glass plane per leaf, full clear width) and `banquette`; grammar `CHINESE_ROOF`, `HEMMER_ROD`, `PORTAL_FRAME` (sandstone pilaster strips + entablature on a `portal` without a portico, LOD1+); `layout/folly.ts` `upsweptRoofPoint`; `exterior/hardwarePlan.ts` `hemmerMasts`; catalogue-v2 `checks.ts` `ATTACHED` (intended footprint overlaps of an annex drawn as its own volume: KB-B28 / apse KB-B28a) and `pipeline.ts` `V2_FACADE` (v1 buildings whose v2 edit writes facade sides / portals itself). `scripts/prepare-terrain.py`: `WALL_FOOT_IDS` (a straight ramp in the distance to a walled terrace edge, ±0.8 m, so the 1 m mesh shows no saw teeth at the wall foot) and `PORTICO_PADS` (a level forecourt pad in front of a portico stair on falling ground, KB-B02 W end).

Wave-8 review fix (architecture), all additive: `PortalSpec.balcony_run?: {depth?, tag?}` (only on a `porte_fenetre` entry above the entrance storey: one continuous balcony across all its doors instead of a balconet each; validated) and `PortalSpec.portico` on a `durchfahrt` (a columned porch on the court in front of the passage, balcony deck at the floor of the storey above). `FacadeOpening.portico.deck_h?` (passage porch deck) and `FacadeOpening.balconyRun?: {a0, a1, depth, tag}` (on the first door of a run). `layout/facade.ts` `freitreppePlan(o)` / `FreitreppePlan` (the Freitreppe numbers shared by `exterior/facade.ts`, `site/courtPlan.ts openingClearance` and the plan sheets: main perron for a `portal` without portico per `MAIN_PERRON`, the old plain stair for doors); a main perron also takes the cellar windows behind it. Grammar `MAIN_PERRON`, `PASSAGE_PORTICO`, `BALCONY`; `HEMMER_ROD` loses `spacing` and gains `mastMin`, `mastRoofShare`, `minArea`, `chimneyClear` (`armRise` 0: the NDB Fünfspitz is a level cross). `courtPlan`: the sentry pair of a portal with a Freitreppe or a passage porch stands at the stair foot / porch front (`CourtPortal.porch`). Plans: `elevation.ts` exports `portalExtrasElev` (portal frame, passage porch, balcony runs) and draws the main perron with cheeks and pedestals; `grundriss.ts` draws the main perron, the porch columns and the balconies (dashed).

Wave 9 (architecture), additive: `MAIN_PERRON.beyondFrame` 1.92 m (the CdL perron spans the three central axes, cheeks on the piers beyond the neighbouring EG windows) and `MAIN_PERRON.stoneTreads` (treads in the portal sandstone `FacadeOptions.stone`, nosings a paler tint of it). `HEMMER_ROD` replaces `arm` / `armRise` / `tip` / `tipRadius` / `collar` with `knob`, `spike`, `spikeRadius`, `point`, `pointRadius` and gains `pointArea` / `pointMast`; `hemmerMastHeight(roofRise, rule?, area?)`. `exterior/rotunda.ts`: the inner (marble, LOD2) pilasters get base and Ionic capital blocks with volutes like the outer order.

Wave-9 review fix (architecture), additive: `MAIN_PERRON.beyondFrame` back to 0.9 m (portal frame + 0.9 m, closest to the HMS short stair between the sentry boxes; the three-axis width had no source) and the tag no longer cites LC (research/07 §1.1 gives Le Clerc's broad Freitreppe to the KB-B02 head). New `MAIN_PERRON.riser` (riser albedo share of the tread stone; the exterior builds each main-perron step as a riser block standing on the step below + a tread slab + the nosing) and `AO.stepCorner` in `exterior/shade.ts` (baked AO at each step's inner corner). New pure `layout/facade.ts` `perronSentryAlong(o, openings, clear, box, gap)`: the signed along offsets of a main perron's sentry pair, snapped to the pier centres between the portal storey's window bays; `site/courtPlan.ts` stores them as `CourtPortal.sentryAlong` and places the foot pair there.

Wave 10 (architecture), additive: `PortalSpec.glazed?: boolean` (only on a `door`; validated) → `FacadeOpening.glazed` (`layout/facade.ts`): the exterior draws such a door with the porte-fenêtre joinery (two closed glazed leaves) instead of open leaves; the CdL garden door uses it (window width, head on the window line). Mixed dressed stone: `exterior/shade.ts` `STONE_MIX` (shares red / yellow-grey / grey-white, partial `mix` and `lumKeep`, joint, value jitter) with the pure `stoneMixTints(base)`, and `PLINTH_DAMP` / `plinthDamp(h, zones)` (damp-dark plinth foot in the baked colour); `materials/ashlar.ts` `isMixedAshlar(colour)` / `ashlarPatch(m, base)` is chained in `materials/index.ts` on every `stone.red` material with a mapped texture whose colour is in `STONE_MIX.colours` (per-block hue and recessed joints on the `ASHLAR` texture grid; its own varying from `uv`, cache key `ashlar<base>`); the glb export and the light layer keep only the baked vertex colours. `ROTUNDA` gains `porticoCollar`, `collar` (lead flashing collar width) and `entasisFrom` (column entasis starts at that share of the shaft); `rotundaLayout().portico.atticBlock` is `null` with `porticoCollar`. Paintings (wave-10 review): `interior/painting.ts` is pure (no canvas): `paintingVariants()` (64 deterministic compositions, `VARIANTS_PER_KIND` per genre, portraits distinct by sitter/head/coat `variantClass`), `ATLAS` (8 × 8 tiles of 256 px), `kindTiles(kind)`, `PaintingHang` / `hangOf(owner)` (per wall and genre no repeat until the genre is used up, seeded mirror), `canvasParams(kind, tile, mirror, w, h)` → `[tile + 1, ±aspect, w, h]`, `atlasUv(p, u, v)` (the vertex shader's cover-fit in TS) and `paintingPatch(m, atlas)` (vertex-shader UV into the atlas, fragment texture2D + frame-edge shadow; cache key `|painting-atlas`); `interior/paintingArt.ts` paints the atlas once with Canvas2D (`paintComposition`, `ageCanvas` varnish + craquelure, `paintingAtlas()` → sRGB `CanvasTexture` or `null` in Node, so tests and the glb keep plain vertex colours). `interior/mesh.ts` `Bucket` carries a fourth vertex attribute `aCanvas` (`CANVAS_ATTRIBUTE`; zero = plain vertex colours) filled by `colourGrid(..., canvas?)`. Grammar: `STATE_ROOM.coveReach` (cove reach as a share of the clear height), `STATE_ROOM.library.taffetaFold` / `doorFrame` / `openShare` (framed wire doors, pleated taffeta, a seeded share stands open); `HEMMER_ROD` knob 0.07, point 0.11, pointRadius 0.024. Louis-seize seat furniture (`interior/furniture.ts` `lsLeg`, medallion backs) stays within the per-building 300k triangle budget. Wave-10 review, additive: `exterior/roof.ts roundRoof(..., smoothProfile, gores?: { count, keys })` draws alternating lead gores (`ROTUNDA.leadGores`, seams `ROTUNDA.leadSeam`, pale stone base `ROTUNDA.baseStone`; Ionic `taper` 5/6); `exterior/shade.ts` `RETAINING_ASHLAR` (`colour`, `courseScale`, `coping` slab with overhang and bed course; used by the terrace retaining walls in `site/features.ts`) and `STONE_MIX.textureContrast` / `joint.arris`; `STATE_ROOM.reveal` (darker boiserie and moulded panels in the window embrasures of panelled rooms; portes-fenêtres get a floor through the reveal) and `coveReach` 0.14.

Wave 8 (look), all additive: grammar `FESTIVAL` (KB-I48: lamp colour temperature, the illuminated buildings, spacing and offsets per group, tags) appended to `layout/grammar.ts`; pure `layout/festival.ts` `festivalLamps(spec, layouts, {year?, seed?})` → `FestLamp {p, n, wall, kind 'lampion' | 'pot', group 'cornice' | 'sill' | 'rotunda' | 'court' | 'parterre' | 'rim', kelvin, src}` plus `ringPoints`, `distanceToRing`, `festivalCounts` (filters `isPlaced`, non-hypothetical, `inEpoch(year)`; never three). Wave-8 review fix: `FESTIVAL.rotunda.event {year, buildings}` and `festRotundaRings(building, year)`: the dense `rotunda` group only for the event's buildings in a scene of the event year whose epoch contains it (KB-B13 in 1785); any other rotunda gets `cornice` + door `sill` lamps. The glass patch's room attributes `vRoom` / `vRoom2` are plain varyings (no `flat`: ANGLE/Metal rewrites index buffers per draw for flat varyings); cache key `glass|imap3`. Viewer only: `festival.ts` / `festivalMath.ts`, `night.ts` `setWindowFest`, and the KB-I50 far shadow (`shadowsFar.ts` `installFarShadowChunk` patches three's `lights_fragment_begin` once before any compile, so directional light 0 is the sun with the near map faded into directional shadow 1, a lightless far light; consumers that derive from that chunk, such as `atmosphere.ts` `terrainLightsBegin`, keep working; the scene must hold no other shadow-casting directional light).

Wave 10 (garden and look), all additive: grammar `PLEASURE_GROUND` (close-mown front band, walk verge, bays round benches and the herm, rondell band, scythe swath, aftermath parcel size, minimum lawn area), `AVENUE_ROW` (per-tree height / width / depth / lean variation and the replanted share of young avenue trees), `HOTBED_LIGHT` (propped / removed / limewashed shares of the Mistbeet lights, prop angle, glazing bars, tints) and `GRASS_SWARD.seeding` / `windrow` / `stubble`. `site/trees.ts`: `TreeSpec.row?` (an avenue tree) takes its looks from the pure `rowVariation(x, z, variants)` (a position hash; the group's random stream is still consumed, so no other tree moves). `site/hotbed.ts` (pure): `hotbedLightStates(n, seed)` → `LightState[]` and `lightSection(D, loY, hiY, propDeg)`; `site/gardenDetail.ts` draws the sashes from them. `site/water.ts`: the fountain jet's translucent parts `JetPart`, `JET_LOOK`, `jetPartMaterial(part, h)`, the down-wind drift `JET_WIND`, `jetFallTime(h, y)` and `jetDrift(t)` (used by `site/features.ts` `jetMesh` and `jetSpray`). Viewer only (no light-layer change): `lawnZones.ts` (pure: `lawnZoneInput(features)`, `lawnZoneField(grid, input)` signed distance per ground cell, `encodeZone`, packed into the terrain's macro B; `landcoverBake.ts` `ZONE_GLSL` shared by the bake, the terrain shader and the grass blades), `ephemeris.ts` (pure Meeus moon / sun / precession, `moonState`, `moonIlluminance`, `fullMoonEvening`, German date and moon labels), `starCatalogue.ts` (star table; wave 11: HYG 4.4, CC BY-SA 4.0, `STAR_ATTRIBUTION` in the footer, KB-I93) and `nightSky.ts` `NightSky` (stars, Milky Way, moon disc; night only), `clouds.ts` (pure coverage field `cloudTop` / `cloudColumn` with its GLSL twins, `CloudMode` 'off' | 'air' | 'on', the shared `cloudData` uniform block and the baked shadow texture `cloudGrid`; the sky march lives in `atmosphere.ts`, the shadow lookup in `shadowsFar.ts` via `lights_fragment_begin`), `Atmosphere.update(elevation, azimuthGrid, moon?)` (moonlight on directional light 0 after sunset) and `night.ts` `addTableCandles` (candles on laid tables and guéridons) (wave 11: lit by the candle pool, below).

Wave 11 (look), viewer only (no light-layer change): `candleMath.ts` (pure: `CANDLE_CD`, `CANDLE_POOL`, `CLUSTER_MERGE_M`, `CLUSTER_MIN_R`, `ROOM_REFLECTANCE`, `FAR_SHARE`, `LIGHT_FLOOR_LUX`, `sphereIlluminance(cd, d, r)`, `clusterFlames(flames, merge)` single-linkage clusters with a cd-weighted centre and an rms sphere radius, `pickClusters(clusters, eye, k)` → the `k` brightest-at-the-eye clusters as lights + `farLux` of the rest, `bounceLux(cd, area, ρ)` / `roomCandleLux` the room's inter-reflected candle ambient, `sphereDecay(r)` (a point light's `decay` > 2 carries r²), `lightCutoff(cd)`, `patchAttenuation(chunk)` for three's `getDistanceAttenuation`: decay > 2 → 1 / (d² + r²), decay 2 unchanged, `INDOOR_NIGHT_VISION`) and `candleLight.ts` (`installCandleFalloff()` once before any compile, next to `installFarShadowChunk`; `indexInterior(inner)` room boxes from `interior/boden` / `interior/wand` and the flames of each room from night.ts `flameMeshes()` / `flameCentres(geo)`; `CandleLights` holds a fixed pool of `CANDLE_POOL` shadowless PointLights that light the visitor's room after dusk, `update(...)` returns whether it is active, then main.ts switches the rooms' own point lights off and the interior look takes the room's candle ambient instead of the fixed `CANDLE_AMBIENT_LUX`; `skb.candles`). The screen-space post lamps are the portal lanterns only. `light.ts` `CANDLE_KEY_LUX` (3 lx, was 5) is the indoor night meter. `interiorGrade.ts` `INDOOR_TONE.knee2` / `s2` (KB-I92: a second log stage of the indoor shoulder; `INDOOR_SHOULDER_GLSL` now takes `tone2`) and `aoBrightFade(l, indoor)` / `AO_BRIGHT_FADE_GLSL` (indoors by day the sky-lit reveals keep more screen-space AO). `starCatalogue.ts` is generated by `scripts/stars/hyg-to-ts.py` from HYG v4.4 (`STARS`, `STAR_COUNT`, `STAR_ATTRIBUTION`; CC BY-SA 4.0 data, credited in the footer and the photo burn-in via `photoMath.ts` `burnInText`; release note under KB-I93 in the backlog).

Wave-11 review fix (look), viewer only (no light-layer change): `shadowsNearMath.ts` (pure: `NEAR_SHADOW`, `nearTexel(ext, size)`, `nearBiasMetres(ext, size)`, `nearShadowBias(ext, size, near, far)`; main.ts `updateShadowFrustum` sets the sun's `shadow.bias` from it per fitted frustum, KB-I99; was a fixed −0.0004 ≈ 1.16 m). `candleMath.ts`: `roomCandleLux` now uses `diffuseBounceLux` (= ρ · `bounceLux`, the second and later bounces; the first stays near the flames), `POOL_FLOOR_LUX` (the ambient floor while the pool burns), `CANDLE_SHADOW` (cube map 512², near 0.05 m, bias, normal bias, PCF radius, `viewCos`), `shadowClusterIndex(lights, eye, dir)` (the brightest cluster in view casts), `shadowRadius(cluster)` (0 for a single flame), `shadowKey(p)`. `candleLight.ts`: pool light 0 casts a cube shadow (redrawn only when its cluster moves), `interiorCasters(inner)` (instanced furniture except chandeliers and lanterns, laid tables, candlesticks) cast only while the pool burns (their `origCast` stays false for the sun map; a flame's own candlestick within 0.6 m does not cast), `CandleUpdate.dir` (camera view direction). `shadowTaps.ts` `patchShadowChunk` also patches three's point (cube) PCF block (`POINT_PCF5_SOURCE`, `pointPcf5Rotated()`): radius 0 → one hardware-filtered tap, else five taps with one cos / sin pair. `interiorGrade.ts`: `INDOOR_TONE_NIGHT`, `indoorToneParams(night)` → `IndoorTone` (`peak`: 0 luminance … 1 largest channel), `indoorShoulderRgb(c, tone)`; `INDOOR_SHOULDER_GLSL` takes `tone2` as a vec3 (knee2, s2, measure); post.ts runs the shoulder indoors by day and by candle light (the AO bright fade keeps its day-only weight).

Wave 11 (garden), all additive: grammar `AVENUE_ROW.aniso` / `tone` / `hue` (`rowVariation` also returns `aniso`, `tone`, `hue`: out-of-round crowns and per-tree leaf tone) and `GARDEN.basinLook.jetFar` / `jetFarGain` (`site/features.ts` `jetMesh`: column, crown and curtain gain opacity with the camera distance). Viewer only (no light-layer change): `landcover.ts` `FIELD_TREES`, `fieldTreeContext`, `OpenTreeOptions.farms` / `clustered` (field trees only at farmsteads, ways, field edges, banks and the forest edge, in groups seeded per cell), `FieldCrop` / `FieldZelge` / `FIELD_ROTATION` / `fieldZelge` / `fieldCropOf` (three-field rotation per block, eight crops), `FIELD_DIR` / `fieldBlockDirs` / `fieldAcross` (strips along the contour per block, the RGBA8 table `tFieldDir` shared by the bake and the terrain shader); `fieldStrip(lat, x, z, gridU, dirs?)` also returns `zelge` and `across`. `hinterland.ts` `GEWANN_FILL` (the catalogue's Gewann fill parcels LC-06…08 carry no hedges). `grassBlades.ts` `GRASS.meadowDense` (meadow tufts thin from 4.5 m, the lawn from 6 m). Terrain uniform `uFieldGate` (Gewann line gate, A/B 0). Wave-11 review fix (garden, KB-I96): `scripts/prepare-terrain.py` also paints the 1789 ground without `PLANNER_BASE_SKIP` (the Gewann fill LC-06…08) and writes the differing cells to `meta.json` `ground.plannerBase.runs` ([row, col0, length, class]; `TerrainMeta.ground.plannerBase`); `landcover.ts` `plannerBaseGround(ground, cols, runs)` rebuilds that base and `OpenTreeOptions.base` decides on it which Überhälter and lattice trees exist (their place in the forest tiles' random streams), the current ground only turns them into `ghost`s; `forest.ts` plans the hay cocks and the hinterland on the base too and ghosts entries on repainted cells, so a land-cover edit added to `PLANNER_BASE_SKIP` never re-rolls another tree. `FIELD_TREES.oldScale` / `keep.oldEdge` (old trees beside the ploughland stay as boundary trees), `FIELD_TREES.farmOwn` (a group may stand within `offBuilding` of a building only if it is the farmstead's own). `fieldCropOf(sid, bx, by, t?)` is one crop per block plus a reaped / ploughed run (`FIELD_ROTATION.winterCut` / `fallowCut`, `fieldCutShare`); `fieldStripValue(sid, bx)` (±6.5 %). `Forest.setClustered(on)` (A/B of the clustered field trees, `skb.forest.setClustered(false)`) and `Forest.plan` (the last tree plan, ghosts included). `landcover.ts` `cellAt(g, x, y)` (grid cell index or −1) is shared by `forestPlan`, `openTreePlan` and `hinterlandPlan`.
