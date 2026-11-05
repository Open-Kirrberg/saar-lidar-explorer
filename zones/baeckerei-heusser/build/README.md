# 🧱 Built twin generator

Turns the public Raumplan ([`../plan/`](../plan/README.md)) plus open survey data into the twin the zone shows ([ADR 0042](../../../docs/adr/0042-baeckerei-heusser-built-twin.md)): measured, stylised geometry in the look of [`../docs/style.md`](../docs/style.md). The capture mesh is only the hidden reference.

```bash
zones/baeckerei-heusser/build/run.sh                      # generator + pack into the zone package
zones/baeckerei-heusser/build/run.sh --update-catalogue   # also write status / dims / placement into ../catalogue/objects.json
zones/baeckerei-heusser/build/run.sh --no-package         # generator only (build/out/)
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

`build/out/` (git-ignored): `twin.glb` and `nav.glb` (raw: float32, unlit, `COLOR_0` = baked light), `report.json` (node list, triangles, bbox, hashes), `package.json` (manifest fragment for the packer), `cache/` (LoD2/OSM extracts). Packed result: `app/public/data/zones/baeckerei-heusser/built/{twin,nav}.glb`, zone.json with the `twin` block (`docs/zone-contract.md`).

## What gets built

| Node | Content |
|---|---|
| `verkaufsraum/boden`, `/wandfliesen` | Tile partitions (floor 0.30 m, walls 0.30 × 0.60 m, grout as coplanar strips: no z-fighting), wall openings for the shop windows and the rear door |
| `verkaufsraum/rasterdecke`, `/deckenblende` | Panel ceiling at 2.28 (0.625 m grid), bulkhead over the shop windows (2.05), wood soffit with red fascia over the counter |
| `verkaufsraum/glaswand`, `/ladentuer`, `/hintertuer` | Glazed side wall, glass front with the two door leaves standing open, closed door at the end of the rear corridor |
| `fassade/aussenwand`, `/dach`, `/schaufenster`, `/vorbau`, `/eingangsstufen` | LoD2 walls with the openings cut out (sandstone plinth band), roof, window reveals through the 0.62 m wall with frames and glass, porch arch and corner pillar, 5 granite steps |
| `theke/…`, `brotregal/…`, `gitterregal/…`, `getraenkekuehlschrank/korpus`, `zeitungsaufsteller/korpus`, `bistrotisch-1/2/korpus`, `haengelampe-1/2/leuchte` | Fixture blockouts from the plan's poses and sizes (products follow in round 3) |
| `umgebung/gelaende`, `/strasse`, `/nachbarhaeuser`, `/durchgang` | Round DGM1 patch (r = 38 m, 1 m cells, skirt), road and pavement, neighbour LoD2 blocks that stand wholly on the patch, the public mouth of the passage closed by a plain wall at `y = 1.60` |
| `nav/floor`, `nav/edge` (separate `nav.glb`, the zone's collider) | Walkable floor: street and pavement within 24 m of the entrance, the 5 treads, the customer side of the sales room (not behind the counter, not the rear corridor, minus fixtures), the passage only up to the shop's side opening; edge fences −0.3 … +2.0 m |

Rendering: unlit materials (base colour = palette token, linear) × `COLOR_0` (soft Lambert from a warm key light + hemisphere fill, times vertex AO). The app's `gltf` runtime has no lights, so this looks right as is; `NORMAL` stays for a later relit look. Node `extras`: `{ id, source, sigma_m, confidence }` (`id` = catalogue row).

## Rules

- Deterministic: same inputs → byte-identical GLBs (tested).
- One scale factor, applied to mesh-derived values only; survey data never scales (tested).
- Nothing beyond the privacy line (passage `y > 1.60`) and no walkable floor behind the counter (tested).
- Budget (style.md): < 300 k triangles in total, fixtures ≤ 5 k, appliances ≤ 2 k, containers/signs ≤ 1 k per object (checked by the build and the tests). v0: ≈ 24 k triangles, 0.5 MB packed.
- Raw data is parsed, never executed (`python -I`).
