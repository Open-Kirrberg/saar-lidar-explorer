# 0042 · 🥖 Bäckerei Heusser as a built digital twin (mesh = reference)

- **Status:** Accepted · 2026-11-05
- **Origin:** user decision 2026-11-05 · refines [0016](0016-zone-kinds-zone-contract.md) and [0027](0027-captured-zone-method.md) for this one zone · runtime [0041](0041-gltf-zone-runtime-walk-on-mesh.md)

## Context
Zone #2 is a photogrammetry mesh from one handheld video (V2.8). It walks, but glass, the counter and the shelves come out weak, nothing in it can be clicked, its scale rests on a ± 11 % prior, and its texture is a photo of everything the camera saw. That photo includes the private end of the covered passage (house door, meter box and mailbox, residents' belongings), and consent covers only the shop and its exterior. The owners want a place where visitors **discover the bakery and its products**, which the shop can later extend (Backstube, Lager) and use to try out renovations (Umbau).

## Decision
| # | Rule |
|---|---|
| 1 | The bakery becomes a **built digital twin**: modelled objects (counter, shelves, breads, cans …) placed on a dimensioned floor plan (*Raumplan*). Focus now: exterior + *Verkaufsraum*. Later: Backstube, Lager, *Umbau* variants. Sources: [`zones/baeckerei-heusser/`](../../zones/baeckerei-heusser/README.md) (code, docs, catalogue, skills, approved model; public). |
| 2 | **The plan is the backbone.** Every object has a catalogue id (`brotregal/ebene-2/brot-03`), a source (`plan`, `photo`, `mesh`, `tape`) and a 1-σ uncertainty in metres. Proportions stay true. |
| 3 | **The captured mesh is reference only** (alignment, measuring, georeference), never the visible scene of the twin. |
| 4 | **Look: light, friendly, stylised** (simplified shapes, bevelled edges, flat or soft-shaded colours from the real shop, warm light), not photo-real like the castle. No photo textures in the visible scene. Rules in the zone's `docs/style.md`. |
| 5 | **Experience over material accuracy:** clickable objects with hover/tap highlight, an info card per object, a light *entdeckt x / y* collection; no full game. |
| 6 | **Privacy:** consent scope = shop + exterior. No people, plates, health details, private entrances or courtyards; prices only if the owners agree; third-party photos (social media, the shop's website, Street View) are modelling reference only. Raw material stays in a private folder outside the repo. The capture package crops the private passage part (`[[package.privacy_crop]]`, `tools/capture/`). |
| 7 | Zone id **`baeckerei-heusser`** (was `bakery`): one name for folder, capture config, package and index. Clean rename; the package stage drops the old index entry (`former_ids`). |

## Consequences
- ✅ Objects can be named, clicked, measured, replaced and varied; the twin no longer depends on photo quality or on the camera-height scale.
- ✅ The visible scene carries no capture texture, which removes most privacy risk.
- ⚠️ Building is manual work per object class. The catalogue, style rules and four zone skills (`bh-*`) keep it repeatable.
- ⚠️ Until the built twin ships, the cropped capture stays the zone's visible scene (V2.8 runtime).
- ⏳ The contract has kinds `reconstructed` (hypothesis) and `captured`. A measured, built twin fits neither evidence kind exactly. Decide (additive contract change) when the first built package exists.
