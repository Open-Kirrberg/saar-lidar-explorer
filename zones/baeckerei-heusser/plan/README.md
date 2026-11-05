# 📐 Raumplan (floor plan)

The *Raumplan* is the twin's **dimensional backbone**. Walls, openings, floor levels and fixture footprints are fixed here first, and objects are then placed on it (`../catalogue/`). **Raumplan v0 arrives from a parallel task** and replaces this placeholder.

## What v0 contains

- Shop outline (*Verkaufsraum*), street facade with door, steps, shop window and glass blocks, the door to the passage, ceiling height, and floor level (true height, DHHN2016).
- Fixture footprints: counter, bread shelf, grid shelf, fridge, newspaper stand.
- Coordinates in the zone frame (`x = E − 381467`, `y = h`, `z = −(N − 5462254)`), metres. Headings are grid-north.

## Sources and uncertainty (per value)

Every value carries its source and a 1-σ uncertainty. The plan never mixes them silently.

| Source | What it gives | Typical σ |
|---|---|---|
| `lod2` | Building outline and walls (GeoBasis-DE/LVGL-SL LoD2, dl-de/by-2-0) | ≈ 0.1–0.3 m |
| `dgm1` | Street and ground height (DGM1) | ≈ 0.05–0.15 m |
| `mesh` | Room shape, openings, fixture positions from the capture (`tools/capture/`, georef median 0.04 m to LoD2, scale prior ± 11 %) | ≈ 0.1–0.3 m |
| `tape` | Measured on site (door width, counter length, room depth, ceiling height) | ≈ 0.01–0.02 m |

When values conflict, `tape` > `lod2`/`dgm1` > `mesh`. **One tape length also fixes the capture's scale** (`capture.scale.factor` in the zone package, see [`tools/capture/README.md`](../../../tools/capture/README.md#-fixing-the-scale-with-one-tape-measurement)).

## Rules

- Only the consent scope (shop + exterior) is drawn. The private part of the passage and the rooms above stay blank.
- Measurements and sketches from site visits stay in the *privater Materialordner (lokal, nicht im Repo)*. Only the derived numbers go into the plan.
- Format and file names are decided with v0 (an ADR if it is not obvious).
