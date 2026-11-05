# 📐 Raumplan (floor plan)

The *Raumplan* is the twin's **dimensional backbone**. Walls, openings, floor levels and fixture footprints are fixed here first. The generator in [`../build/`](../build/README.md) builds the visible twin from it, and the catalogue (`../catalogue/`) names the parts.

| File | What |
|---|---|
| `raumplan-v0.json` | The plan, format `sle-raumplan/0.1`, **public version** (redacted, see *Privacy*) |
| `raumplan-v0.svg` / `.png` | Plan sheet A3 (ground plan, sections, dimensions); the private part of the passage is hatched „privat – nicht dargestellt“ |
| `messliste.md` | What to measure on site (A–J) and how one tape length fixes the scale |
| `check_plan.py` | Checker (stdlib): every value has `v` / `sigma_m` / `source`, references resolve, scale factor = capture TOML, privacy |
| `test_plan.py` | Tests for the checker and the redaction |
| `regen.sh` | Regenerates everything from the private work files (full plan → public plan → sheets → check) |
| `scripts/` | Generator (`paths`, `model`, `build_json`, `redact`, `build_svg`) and the fact extractors behind `model.py` (`extract_lod2`, `load_mesh`, `common`, `measure`, `diagwall`, `vsection`, `exterior_facts`: analysis, not part of `regen.sh`). One-off exploration scripts stay in the private folder |

## What v0 contains

- Frame **B**: origin at the SSW end of the LoD2 street facade (E 381464.680, N 5462236.762), x along the facade (NNE), y into the building (WNW), z above the shop floor ±0.00 = 244.25 m NHN (DHHN2016). `frame.x_axis_EN` / `y_axis_EN` convert to EPSG:25832; the zone frame is `x = E − 381467`, `y = h`, `z = −(N − 5462254)`.
- Site: LoD2 outline of the shop's building and the neighbours, ALKIS parcel, DGM1 street heights, the covered passage up to the shop's side opening.
- Sales room `R1` (outline A–K, ceiling 2.28, walls, shop windows O1/O2, the glass front with the door O4, the side opening O5, the rear corridor O6), the open porch `R-vorbau` with 5 steps, 10 fixtures (counter, bread shelf, grid shelf, news stand, 2 bistro tables, fridge, 2 pendant lamps, wood soffit).

## Sources and uncertainty (per value)

Every value carries `v`, its source and a 1-σ uncertainty `sigma_m`. The plan never mixes them silently.

| Source | What it gives | Typical σ |
|---|---|---|
| `lod2` | Building outline and walls (GeoBasis-DE/LVGL-SL LoD2, dl-de/by-2-0) | ≈ 0.1–0.3 m |
| `dgm1` | Street and ground height (DGM1) | ≈ 0.05–0.15 m |
| `alkis` | Parcel boundary | ≈ 0.1 m |
| `mesh` / `video` / `photo` | Room shape, openings, fixtures from the capture (`tools/capture/`, georef median 0.04 m to LoD2, scale prior ± 11 %) and reference material | ≈ 0.2–0.9 m |
| `tape` | Measured on site | ≈ 0.01–0.02 m |

When values conflict, `tape` > `lod2`/`dgm1`/`alkis` > `mesh`.

## The one scale factor

The capture's scale rests on an assumed camera height (± 11 %). **One tape length fixes it** (`messliste.md`, item A): `factor = tape / plan value`.

1. Set the same factor in `scale.factor` of the plan (via the private full plan + `regen.sh`) **and** in `tools/capture/zones/baeckerei-heusser.toml` (`package.scale_factor`). `check_plan.py` fails when they differ.
2. Plan values stay unscaled on disk. The generator applies `xy' = pivot + f·(xy − pivot)` and `L' = f·L` to the mesh-derived values only; LoD2, DGM1 and ALKIS values never scale.
3. Rebuild: `zones/baeckerei-heusser/build/run.sh`.

## Privacy

Consent covers the shop and its exterior (`bh-datenschutz`). The public plan is made by `scripts/redact.py`: the passage is public only up to the shop's side opening (frame B `y ≤ 1.60`), nothing beyond it is drawn, and the pickup locker's position stays private. `check_plan.py` checks this. The full plan, the measurements and the work files stay in the *privater Materialordner (lokal, nicht im Repo)*.

Facts beyond the passage door that the full plan needs (positions, labels, the full sheet's extra drawing) are **data in the private folder** (`plan/work/private_facts.json`, read by `model.private_facts()`), never values in the committed scripts. Without that file the generators produce the public content only. `check_plan.py` also scans `plan/` and `build/` for private words and for the private coordinate pairs listed in that file ([ADR 0043](../../../docs/adr/0043-built-twin-package-reference-nav.md)).

## Commands

```bash
zones/baeckerei-heusser/plan/regen.sh [--no-png]          # needs the private work files
python3 -I zones/baeckerei-heusser/plan/check_plan.py     # public plan ([file] --private for the full one)
cd pipeline && uv run python -I -m pytest -q -p no:cacheprovider ../zones/baeckerei-heusser/plan
```
