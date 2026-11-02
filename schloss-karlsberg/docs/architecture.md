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
| `pnpm run plans` | `tsx plans/src/main.ts` (stub) |
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
| `scripts/**` | core; `export-glb.ts` will be filled by **exterior** | |
| `model/src/exterior/**`, `model/src/site/**`, `viewer/**` | **exterior + viewer** package | `viewer/src/main.ts` is a placeholder (cube) |
| `model/src/interior/**` | **interiors** package | `index.ts` is a stub returning an empty Group |
| `plans/**` | **plans** package | `plans/src/main.ts` is a stub |
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
| Roof | `type` normalised to `mansard \| hip \| gable \| flat \| pavilion \| cone \| dome \| mound \| none`, plus `cover`, `break_ratio`, `dome_rise_ratio`, `hipped_ends`, `raised[]` (raised centre with `turret`), structured `chimneys`, `dormers` |
| Facade | `sides{court, garden, end_a, end_b: {axes, spacing, groups, from, to, blind}}`, `risalits[]`, `portals[]`, `shutter_type`, `members_colour`, `plinth_colour` |
| Room | `{id, name_de, function, storey, polygon [s,t][], floor_h?, ceiling_h?, finish{floor, walls, ceiling}, tag, sources?}` |
| Opening | `{kind, storey, wall: {kind:'side', side} \| {kind:'room', room, edge} \| {kind:'segment', p0, p1, rooms?}, a, width, height, sill, head?, tag}` |
| TerrainFeature | kinds: court, terrace, scarp, avenue, rondell, pond, island, dam, cascade, moat, enclosure, well, wall, parterre, path. GeoJSON geometry in EN; `trees{species, rows, spacing, row_distance}`, levels, `wall_height` |

Room polygons are in building-local `[s, t]`, so they survive footprint edits that keep the frame.

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
roofSection({ type, depth, eaves_h, pitch_lower?, pitch_upper?, break_ratio?, dome_rise_ratio?, ridge_h?, matchRidge? }): RoofSection
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

Fix round 1 added these optional, additive spec fields: `FacadeSideSpec.window_kind`, `PortalSpec.grade_h` (the level the steps start from, e.g. a parterre) and `PortalSpec.portico { columns, balcony, depth? }`. `FacadeOpening` carries `grade_h`/`portico`. In the interiors, `collectOpenings(b, layout, groundAt?)` and `interiorModel(b, layout, seed, groundAt?)` cull terrain-buried facade openings with the same `cullBuriedOpenings` as the exterior. Deep straight reveals get a splay (`revealSplay`).

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

// model/src/interior/index.ts            (interiors package; stub exists)
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
   `ctx.options.showHypothetical` is set.
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
6. `buildSite` covers terrain features (courts, terraces with retaining walls, scarps, avenues via `avenueTrees`,
   ponds at `water_level`, cascade) plus walk colliders and POIs (German `name_de`). There is a POI per placed
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
colours, a `_CONF` attribute and base skirts to the 2025 DTM, plus `footprints.geojson` and `index.json`. Camera
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
  UV scale), files with MD5 and byte sizes.

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
