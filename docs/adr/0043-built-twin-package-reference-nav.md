# 0043 · 🧩 Built twin package: reference role, twin block, walking on the nav floor

- **Status:** Accepted · 2026-11-05
- **Origin:** Bäckerei Heusser round 2 (first built package) · resolves the open point of [0042](0042-baeckerei-heusser-built-twin.md) · extends [0016](0016-zone-kinds-zone-contract.md), [0041](0041-gltf-zone-runtime-walk-on-mesh.md) · contract: [`docs/zone-contract.md`](../zone-contract.md) (`twin`)

## Context
Round 2 built the first visible twin of the bakery from the *Raumplan* v0 (`zones/baeckerei-heusser/plan/`, generator `zones/baeckerei-heusser/build/`). ADR 0042 left open how a measured, built twin fits the zone contract, which only knew the evidence kinds `reconstructed` and `captured`. The package also has to keep the capture for checking, walk on exact geometry instead of a noisy mesh, and stay inside the consent scope (shop + exterior).

## Decision
| # | Rule |
|---|---|
| 1 | **No new zone kind.** A built twin stays `kind: "captured"` (`evidence.kind: "capture"`) and adds an optional, additive **`twin` block** (`method: "built-from-plan"`, plan format + version, catalogue, `scaleFactor`, `nav`, `referenceScale`). Older apps ignore it and still show the twin. |
| 2 | New asset role **`reference`**: the capture LODs. They are not drawn by default, never collide, and count only in `totalBytes`, not in the first-view budget. Unknown roles are skipped by older apps. |
| 3 | **True scale.** The twin is built at true scale, so `capture.scale.factor` must be **1** in a twin package (the runtime applies it to every asset and spawn). The capture's own factor moves to `twin.referenceScale` and applies to `reference` assets only. The one tape-based factor lives in the plan and the capture TOML (`check_plan.py` keeps them equal). |
| 4 | **Look in the data, not in the runtime.** Unlit materials: base colour = palette token, `COLOR_0` = baked light (warm key + hemisphere fill × AO). `NORMAL` stays for a later relit look. No textures in the visible twin. |
| 5 | **Walking on the nav floor.** A separate `collider` asset (`nav/floor` + invisible `nav/edge` fences) is the walkable area: street and pavement near the entrance, the 5 steps, the customer side of the shop minus fixtures and the open door leaves (buffered by the 0.18 m body radius). The walker (`holes: 'block'`) stops at the floor's edge and slides along it; it does not keep height over holes as on captures. A test checks that no vertical twin surface in the body band stands on the shrunk walkable floor. |
| 6 | **Context fades.** The DGM1 ground patch (r = 38 m), the road and the neighbour LoD2 blocks fade radially into the horizon haze (shader patch after fog), so the small disc does not float. |
| 7 | **`?referenz` is a local, dev-only switch** (*Referenz* button). The capture stays in local packages for checking alignment and measurements. **Public exports drop it**: no `reference` assets and no `scene/` folder of `baeckerei-heusser` in any release (`scripts/release/RELEASING.md`). Only then does 0042's "the visible scene carries no capture texture" hold for the public. |
| 8 | **Ground patch behind the buildings stays.** The DGM1 patch also covers the ground behind the shop's row of houses. It is open data at 1 m, one flat stylised colour, no objects, and no more detail than the overworld terrain already shows; it is not a model of the courtyard. Anything beyond the shop's passage door that is more than open survey context (walls, doors, fixtures, labels) stays out of every public file. |
| 9 | **Private plan facts live only in the private folder.** The full plan's private facts (beyond the passage door: house door, pickup locker position, courtyard labels, sample points) are a data file in the private folder (`plan/work/private_facts.json`), read by the generators when present. The committed scripts carry no private values or labels; `check_plan.py` scans `plan/` and `build/` for private words and for the private coordinate pairs listed in that file. |
| 10 | **Spawn on the street** in front of the shop (frame B 23.0 / −7.0, pitch −4°): the shop windows and the porch fill the first view. |

## Consequences
- ✅ The twin is a normal glTF zone: same runtime, LOD, budget and validator, plus one optional block and one role.
- ✅ Walking is exact and cannot leave the modelled area; collisions come from one small mesh.
- ✅ Re-running `regen.sh` gives byte-identical public plan files; the private sheet is rebuilt from data.
- ⚠️ The bare upper facade (LoD2 wall without windows), missing building bevels and outlines, and the empty shelves are known look gaps for round 3; they need catalogue rows and plan values first (no geometry without a catalogue entry).
- ⚠️ The release exporter does not stage zone packages yet; when it does, it must drop `reference` assets (rule 7).
