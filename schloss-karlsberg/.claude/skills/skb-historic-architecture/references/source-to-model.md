# From a source to the model: edit points, recipes and traps

How a documented fact or a period norm reaches the 3D model, the plan sheets and the explorer export **in one place**.
Paths are relative to `schloss-karlsberg/`. Re-read a file right before you edit it, because other agents may be
working in the repo.

## 1. Where a change goes

| You learned… | Change it in | Not in |
|---|---|---|
| A fact about one building: name, date, function, footprint, storeys, roof, cover, axes, colours, portals, alternatives | `scripts/catalogue-v2/buildings.ts`: the `EDITS['<id>']` patch (v1 buildings), `REMOVED_V1`, `UNPLACED_NOTES`; `scripts/catalogue-v2/newBuildings.ts`: the `NEW` array (new buildings), `NEW_UNPLACED` | `model/catalogue.json` (generated, and a test checks it is reproduced exactly) |
| Rooms: names, order, finishes, stairs, interior doors, passages | `scripts/catalogue-v2/programme.ts`: the `Prog` objects `CDL`, `SUED`, `NORD`, `SAMMLUNG`, `KUECHE`, `GALERIE`, `ORANGERIE`, plus `FIN` / `FIN_TAG` | `interior/` code |
| Terrain features next to buildings (court, grille line, terraces) | `scripts/catalogue-v2/terrain.ts` | site code |
| A period norm: a size, ratio or count valid for a class | `model/src/layout/grammar.ts`, with a tag comment, then read it in the consumer | a literal in `exterior/` or `interior/` |
| A colour or PBR value for a surface type | `MATERIAL_BASE` in `model/src/materials/index.ts` (+ `FALLBACK` in `model/src/interior/materials.ts`) and, for catalogue colours, `PALACE_FACADE_BASE` / `FARM_FACADE` in buildings.ts and `spec.defaults` in `pipeline.ts` | shader strings |
| New geometry (rods, downpipes, rotunda portico, Tapetenleisten) | builders: `model/src/exterior/facade.ts`, `roof.ts`, `index.ts`; `model/src/interior/fixtures.ts`, `furniture.ts`, `shell.ts`. Pure helpers go in `model/src/layout/` with a test | the viewer |
| A new catalogue field (`fachwerk`, `build_year`, `epoch`) | core: `model/src/spec.ts` (optional field) + `model/src/validate.ts` (if it needs checking) + `docs/architecture.md` §4.1, in the same change | anywhere else first |
| Source keys shown in the info panel | `SRC` in buildings.ts (`addSources(b, SRC.x)`) | free text only |
| An open question | `OPEN_QUESTIONS` in `scripts/catalogue-v2/pipeline.ts` | — |

## 2. Rebuild order

```bash
pnpm exec tsx scripts/catalogue-v2/build.ts          # writes model/catalogue.json; fails on validation errors, programme issues, overlaps
# only if footprints moved and new ground levels are needed (reads ../data/work read-only):
cd ../pipeline && uv run python -I ../schloss-karlsberg/scripts/catalogue-v2/sample_dtm.py && cd ../schloss-karlsberg
pnpm exec tsx scripts/catalogue-v2/build.ts          # pass 2 with the DTM samples
pnpm run test && pnpm run build
node .claude/skills/skb-historic-architecture/scripts/history-check.mjs --strict
pnpm run plans --only <sheet> --no-pdf               # sheets you affected → plans/out/, docs/plans-preview/
pnpm run export:explorer                             # if the change is visible at LOD1 from the explorer
```

The build prints `validation v2: N errors`, `programme checks: N issues` and `footprint overlaps > 0.5 m²: N`. All
three must be 0.

## 3. Recipes

### 3.1 Change a building fact (example: KB-B23 Hundezwinger, research/10 §b.3)

In `EDITS` (buildings.ts), add or extend the patch:

```ts
'KB-B23': (b) => {
  b.name_de = 'Hundezwinger';
  b.function = 'kennel for the ducal hunting pack ("ein Zwinger für tausend Hunde", Mannlich 1910 p. 365) [D]';
  b.confidence = 'med';            // existence and use D; geometry still LP06 + N
  addSources(b, 'research/10-karlsberg-source-sweep.md T1: Mannlich, ed. Stollreither 1910, p. 365');
  b.notes = (b.notes ?? '') + ' 01 Q7 closed by T1 p. 365.';
},
```

- If `EDITS` already has an entry for the id, extend it rather than adding a second one.
- Keep the old reading in `b.alternatives` if it was a real alternative.
- Confidence follows the weakest essential part. A documented use on an LP06-only position is still `low` or `med`
  for the 3D model.

### 3.2 Move or rename rooms (example: H06, Großer Speisesaal on the KB-B05 OG)

- In `KUECHE.floors[storey 2].zones`, replace the `Kammer` zones with a zone such as
  `{ k: [0, 5], band: 'full', id: 'og-speisesaal', name: 'Großer Speisesaal', fn: 'state dining hall with two stove niches', fin: 'boiserie', tag: 'D T1 p. 338 (Mannlich 1910), R12 OG 24; position in the S part I; finish N' }`.
- `k` are grid indices. Partitions fall on pier centres, and `checks.ts` fails the build if a partition hits a window.
- The room id becomes `B05.2.og-speisesaal`. It shows up as a POI `KB-B05/B05.2.og-speisesaal`.
- Three tests pin room ids: `model/tests/catalogue-v2.test.ts` (`B01.1.eg-kabinett`), `interior.enfilade.test.ts`
  (`B01.2.og-festsaal`) and `fix-round-1.test.ts` (`B01.1.eg-prunktreppe`). If you rename those rooms, update the tests
  in the same change.
- **Name vs position:** tag them separately (`D T5 name; position I`).
- Stairs are zones made with `stairZone(...)` plus a `voidZ(...)` on the floor above. Moving them changes the plan
  sheets (`interior/stairPlan.ts` → plans), so re-render the GR sheets.

### 3.3 Add a finish or material (example: `wall.silk.yellow`, research/09 M8)

1. Add the name to `MATERIAL_NAMES` in `model/src/context.ts` (the array order doesn't matter, but keep the related
   names together).
2. Add the PBR values to `MATERIAL_BASE` in `model/src/materials/index.ts`, e.g.
   `'wall.silk.yellow': { color: '#C9A94E', roughness: 0.7 }`, with a comment like `// D Gelber Salon (room name); hue I`.
3. Add the plain colour to `FALLBACK` in `model/src/interior/materials.ts`. Steps 2 and 3 are `Record<MaterialName, …>`,
   so tsc fails until they are complete.
4. Optionally add a texture in `MATERIAL_TEXTURE` (context.ts). Texture sets are listed in `viewer/textures.json`.
5. In programme.ts, add `yellow: { floor: 'floor.parquet', walls: 'wall.silk.yellow', ceiling: 'ceiling.stucco' }` to
   `FIN` and its tag to `FIN_TAG`. Then set `fin: 'yellow'` on the Gelber Salon zone in `CDL`.
6. Mention the new name in `docs/architecture.md` §3.6 if it is a new surface family.

### 3.4 Add a period-norm table (example: `GLAZING`, research/09 G1–G3)

1. In `grammar.ts`, add an exported table keyed by the window-table class (`windowClass(cls)`) and the row, with tag
   comments. For example: panes per leaf, target pane height, bar width, and the transom threshold (2.6 m).
2. The consumer reads it: `glazingGrid(w, h)` in `model/src/exterior/cut.ts` gets the class and row, and
   `furnishOpening` in `facade.ts` draws a meeting stile instead of the LOD1 mullion.
3. Update `model/tests/exterior.cut.test.ts`. The current test expects "even columns and ~0.48 m rows", so rewrite it
   to the new rule (for example "wing window 1.2 m → 4 columns, panes 0.25–0.35 m high").
4. Add the table to the `docs/architecture.md` §4.4 list.

### 3.5 Add a catalogue field (example: `facade.fachwerk`, `facade.build_year`)

- Add it to `spec.ts` as an **optional** field with a doc comment and its tag convention.
- Add a check in `validate.ts` only if a wrong value would break builders.
- `model/catalogue.v1.json` is a frozen fixture, so old data must stay loadable without the field.
- Set the field in buildings.ts (`PALACE_FACADE_BASE` or per `EDITS`).
- Read it in exactly one place, a layout helper or `palette()`, and pass it on from there.
- Document it in `docs/architecture.md` §4.1. That doc is the binding contract, so it changes in the same change.

### 3.6 Take a building out of the 1789 state (example: KB-B13 rotunda, KL-B49 Hymen temple)

- **Do not delete it, and do not mark it `hypothetical`.** `hypothetical` means "uncertain". The viewer shows it by
  default (`DEFAULT_BUILD_OPTIONS.showHypothetical = true` in context.ts).
- KB-B13 is also referenced in:
  - `model/tests/footprint-storeys.test.ts`, which needs its round footprint;
  - `COURT_TOWARD` in `model/src/catalogue.ts`;
  - the AN-04 sheet list in `plans/src/sheets/ansicht.ts`.
- Do it as a core change (backlog **KB-I03**; one design shared with the garden features, research/11 §6.1):
  1. Add an optional `epoch?: { from?: number; to?: number }` (years, `to` inclusive) to `Building` **and**
     `TerrainFeature` in spec.ts, plus a range check in validate.ts.
  2. Add one pure helper `inEpoch(epoch, year)` in `model/src/layout/` with a test (no three; same helper for
     buildings and terrain features).
  3. Make every consumer skip out-of-slice items by default: exterior/interior `index.ts`, `site/index.ts` and
     `site/access.ts`, the plans sheet lists, `model/src/explorer/export.ts` / `scripts/export-explorer.ts` and
     `scripts/export-glb.ts`.
  4. Expose the alternative date as an option (a later "Dezember 1785" scene, KB-I48).
  5. Set `epoch: { from: 1785, to: 1785 }` with the tag in `EDITS` and update architecture.md §4.1 and §5 rule 2.
- The history check treats an `epoch` object that excludes 1789, or a free-text `status`/`time_slice`/`exists` marker
  naming another date, as "not in 1789".

### 3.7 Add a building (example: KB-B06a Bibliothekspavillon, research/10 §b.1)

- Add an entry to `NEW` (newBuildings.ts) with:
  - an explicit `footprint` (`axisRect(centreEN, azimuthGrid, length, width)`);
  - `cls`, a `template` (`pav`, `temple`, `guard`, `svc1`, `svc2`, `farm`, `stable`, `glass`, `yardhouse`), `confidence`
    and `placement`;
  - `dtmHint` or `base`, `notes` and `sources`.
- If its existence is D but its position or size is I or U: `placement: 'hypothetical'` and `confidence: 'low'`, with
  the reasoning in `notes`.
- The build fails on footprint overlaps above 0.5 m² in the palace core. Attach the building, don't overlap it.
- Id style: `KB-Bnn` / `KL-Bnn`, with a suffix such as `a` for annexes. Validation only requires a unique id.
- A new building needs a DTM sample (pass 2 of the rebuild order), or set `base` explicitly.

### 3.8 Add exterior detail geometry (rods, downpipes, sentry boxes, portico)

- Build in `facade.ts` / `index.ts` from `ctx.layout(b)` (sides, `p0`, `a`, storeys).
- Name objects `<id>/<part>[/<detail>]` and set `PartUserData` (`buildingId`, `part`, `lod`, `tag`).
- Respect the LOD:
  - LOD1 is the flyover and the explorer light layer, which drops window frames and ironwork;
  - LOD2 is for walk mode.
  - Small metal hardware belongs at LOD2.
- Get materials from `palette(b, ctx)` / `ctx.materials`, and randomness from
  `mulberry32(hashString(id) ^ ctx.options.seed)`.
- Numbers come from `grammar.ts`.
- If plans should show the element (porticoes and Freitreppen appear in elevations), put the geometry rule in
  `model/src/layout/` and use it from both `facade.ts` and `plans/src/sheets/elevation.ts`.

## 4. Keeping plans and 3D consistent

- Plans call the same `layoutBuilding` (`plans/src/geom/*`, `plans/src/sheets/*`).
- `plans/tests/model-consistency.test.ts` pins roofs, stairs, trees and sections against the model.
- `plans/tests/fix-round-1.test.ts` pins the review fixes.
- After a catalogue or layout change, re-render the sheets you touched and **look at the PNGs** in
  `docs/plans-preview/`:
  - GR for rooms;
  - AN for facades;
  - SC-01 for the section;
  - LP for footprints.
- Sheet labels are German. Every sheet carries the evidence legend and "Hypothese – Stand <date>". If you add an
  evidence category, the legend in `plans/src/evidence.ts` must know it.

## 5. Traps

- **Hand-editing `model/catalogue.json`.** The build-reproduction test fails, and the next build overwrites the edit.
- **`palette()` picks the member material from the hex** (`/^#(A|9|8)/` → `stone.red`). If you make `members_colour`
  a grey-pink like `#BFAEA5`, it stays `stone.grey`. A red one turns the members into an ashlar texture.
- **Two colour sources:** the catalogue colour wins when present (`facade.colour`, `members_colour`, `plinth_colour`,
  `shutter_colour`), and the `MATERIAL_BASE` colour is the fallback. Change both, or the change is invisible on half
  the buildings. `spec.defaults` (pipeline.ts) also lists `slate`, `tile` and `shutters` as text for the viewer.
- **Room tags may be empty in a zone** (`Kammer`). The programme then writes the generic `TAG_I` plus the finish tag
  (programme.ts, `tag: [z.tag ?? TAG_I, …]`). Give every room you have evidence for its own tag.
- **The time slice:** see §3.6. "Built 1785" ≠ "standing in 1789".
- **The explorer light layer** bakes colours at export time. Without `pnpm run export:explorer`, the explorer keeps the
  old look. You don't verify the explorer side, so say so.
- **HMS numbers** carry the tag `HMS` even when they look precise (research/08 gives ±1 m and the registration
  residuals).
- **R12 vs T5:** the 2003 room list is outdated where Schwan 2012 differs (library floor, dining room, silver room).
