# 🧱 Built twin generator

Turns the public Raumplan ([`../plan/`](../plan/README.md)) plus open survey data into the twin the zone shows ([ADR 0042](../../../docs/adr/0042-baeckerei-heusser-built-twin.md)): measured, stylised geometry in the look of [`../docs/style.md`](../docs/style.md). The capture mesh is only the hidden reference.

```bash
zones/baeckerei-heusser/build/run.sh                      # generator + pack into the zone package
zones/baeckerei-heusser/build/run.sh --update-catalogue   # also write status / dims / placement into ../catalogue/objects.json
                                                          # and the product slots into ../catalogue/slots.json
zones/baeckerei-heusser/build/run.sh --debug-slots --no-package   # magenta slot plates (debug only, never package them)
zones/baeckerei-heusser/build/run.sh --no-package         # generator only (build/out/)
zones/baeckerei-heusser/build/run.sh --no-lettering       # without the shop's own lettering (on by default, ADR 0044)
cd pipeline && uv run python -I -m pytest -q -p no:cacheprovider ../zones/baeckerei-heusser/build
```

The packing step is the capture tool's stage `twin` (`tools/capture/run.sh baeckerei-heusser twin`). It needs a capture package in `app/public/data/zones/baeckerei-heusser/` (stage `package`, which runs `twin` itself when `[package.twin]` is in the TOML).

## Inputs → outputs

| Input | Used for |
|---|---|
| `../plan/raumplan-v0.json` (public) | Room, openings, porch and steps, fixtures, passage up to `y ≤ 1.60` |
| `tools/capture/zones/baeckerei-heusser.toml` `package.scale_factor` | The one scale factor (must equal the plan's `scale.factor`) |
| `data/work/overall/dtm.tif` (DGM1) | Ground patch, street and spawn heights |
| `data/raw/lod2/sl/*.gml.gz` (LoD2, parsed with `pipeline/buildings.py`) | The shop's envelope and roof, neighbour blocks |
| `data/raw/osm/overall.json` (OSM highways) | Carriageway and pavement |
| `../catalogue/objects.json` | Node names must be catalogue ids („no catalogue entry, no geometry“) |

`build/out/` (git-ignored): `twin.glb` and `nav.glb` (raw: float32, unlit, `COLOR_0` = baked light), `report.json` (node list, triangles, bbox, hashes), `slots.json` (product slots, `bh-slots-v1`), `package.json` (manifest fragment for the packer), `cache/` (LoD2/OSM extracts). Packed result: `app/public/data/zones/baeckerei-heusser/built/{twin,nav}.glb`, zone.json with the `twin` block (`docs/zone-contract.md`).

## What gets built

| Node | Content |
|---|---|
| `verkaufsraum/boden`, `/wandfliesen` | Floor tiles 0.30 m (warm cream, grout as coplanar strips: no z-fighting); tall marble-look wall panels ≈ 0.75 wide, the window wall in white render; opening for the rear door. Big faces are split on a 0.45 m grid so the vertex AO has resolution |
| `verkaufsraum/rasterdecke`, `/deckenblende`, `/zierleiste`, `/einbauleuchten` | Cream plank ceiling at 2.28 (≈ 0.28 m planks, staggered joints), bulkhead over the shop windows (2.05), wood soffit with red fascia over the counter, white cove with a red trim line round the walls, downlights |
| `verkaufsraum/glaswand`, `/ladentuer`, `/hintertuer` | Glazed side wall, glass front with the automatic sliding door (2 leaves parked open behind the side panes, operator box with sensor), closed door at the end of the rear corridor |
| `fassade/aussenwand`, `/dach`, `/schaufenster`, `/vorbau`, `/eingangsstufen` | LoD2 walls with the openings cut out, roof, shop-window reveals through the 0.62 m wall with white frames and glass, porch with a flat lintel (video) and the sandstone-clad corner pillar, 5 granite steps |
| `fassade/aussenwand/abdeckplatte`, `/glasbausteine`, `/fenster-rollladen`, `/fenstergewaende(/quader)`, `/schlussstein-1/-2`, `/obergeschoss-fenster`, `/kellergitter`, `/fallrohr`, `/ausleger-schild`, `/handlauf`, `/wandmalerei`, `/dach/schiefer`, `/dach/ortgang` | Round 3b (`bh_twin/facade.py`, values in the plan's `site.facade`, from `plan/scripts/exterior_r3.py`): stone-slip plinth (street + gable) with cap, glass-block panel in basket weave, wide window with closed roller shutter, sandstone surrounds with quoins and keystones (pretzel relief on O1, plain stone on O2), pilaster and corner quoins, 4 upper + 2 gable windows (opaque glass), cellar grilles, gutter and downpipes, projecting sign with a neutral oven graphic, galvanised handrail, the SSW end as a gable (LoD2 has a hip there: hip faces replaced, roof planes run on, raking end walls) with verge boards and the mural panel (neutral oven arch + loaf), slate diamonds on the front roof. `…/schrift` nodes add the shop's lettering (gable text, keystone „H.H. 1933“, sign name); on by default since the owners' OK (ADR 0044), `--no-lettering` leaves them out. The pickup cabinet is not built: its place is in the private part of the passage |
| `theke/sockel`, `/faecher`, `/granitablage`, `/zierband`, `/vitrine`, `/vitrine/ebene-1..3`, `/arbeitsplatte`, `/kasse`, `/brezelstaender`, `/kuchenhaube`, `/aufsteller` | Counter (round 3, styled): white base with rounded SW end, pink granite ledge, red band with champagne trim, two display modules (sloped / upright curved front glass), deck, glass shelf, glass top, staff work top over open compartments, till, pretzel stand, cake cover, blank table cards. Empty like in the video |
| `brotregal/seitenwangen`, `/korpus`, `/unterboden`, `/koerbe`, `/koerbe/korb-1..6`, `/ebene-1..3`, `/preisschienen` | Bread shelf: curved white side cheeks, 3 bays, low board, basket level with 6 wicker baskets and raspberry cloths, 3 sloped champagne rod tiers (red front edge on top), price rails |
| `gitterregal/…`, `dosenregal/…`, `getraenkekuehlschrank/…`, `wuerfelregal/…`, `kaffeemaschine/…`, `tuetenhalter/…`, `brotschneidemaschine/…`, `arbeitstisch/…`, `waermevitrine/…`, `hocker/…`, `zeitungsaufsteller/…` | Chrome grid shelf, dark jar/can shelf (2 units), drinks fridge, white cube shelf + wall boards + coffee machine, bag holder, slicer, work table with warming display and stool, news stand |
| `bistrotisch-1/2/korpus`, `/stuhl-1..2`, `wandbild-kaffee`, `prospektstaender`, `schirmstaender`, `zimmerpflanze`, `bleiglasbild`, `bilderwand/rahmen-1..3`, `wanduhr`, `fussmatte-eingang`, `laeufer-theke`, `schaufensterdeko-1/2` | Café corner (round + square table, chairs with cushions, coffee picture as a plain graphic), old frames with a neutral sepia fill, clock, mats, window-sill decoration with garlands |
| `haengelampe-1..4/leuchte`, `strahlerschiene-1..3/leuchte` | 4 pendant lamps on the soffit with a soft warm glow (their light is baked as warm pools), track lights |
| `umgebung/gelaende`, `/strasse`, `/nachbarhaeuser`, `/durchgang` | Round DGM1 patch (r = 38 m, 1 m cells, skirt), road and pavement, neighbour LoD2 blocks that stand wholly on the patch, the public mouth of the passage closed by a plain wall at `y = 1.60` |
| `nav/floor`, `nav/edge` (separate `nav.glb`, the zone's collider) | Walkable floor: street and pavement within 24 m of the entrance, the 5 treads, the customer side of the sales room (not behind the counter, not the rear corridor, minus fixtures), the passage only up to the shop's side opening; edge fences −0.3 … +2.0 m |

Rendering: unlit materials (base colour = palette token, linear) × `COLOR_0` (soft Lambert from a warm key light + hemisphere fill, warm pendant pools, daylight falling off from the shop windows, times analytic vertex AO under boards, around bases and in corners). The app's `gltf` runtime has no lights, so this looks right as is; `NORMAL` stays for a later relit look. Node `extras`: `{ id, source, sigma_m, confidence }` (`id` = catalogue row).

## Rules

- Deterministic: same inputs → byte-identical GLBs (tested).
- One scale factor, applied to mesh-derived values only; survey data never scales (tested).
- Nothing beyond the privacy line (passage `y > 1.60`) and no walkable floor behind the counter (tested).
- Budget (style.md): < 300 k triangles in total, fixtures ≤ 5 k, appliances ≤ 2 k, containers/signs ≤ 1 k per object (checked by the build and the tests). v0: ≈ 24 k triangles, 0.5 MB packed; round 3: ≈ 34 k triangles; round 3b (facade): ≈ 52 k triangles, 1.3 MB packed.
- Raw data is parsed, never executed (`python -I`).
