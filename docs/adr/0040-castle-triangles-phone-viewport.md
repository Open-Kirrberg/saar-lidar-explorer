# 0040 · 📐 Castle triangles: within 1.5 M in the phone viewport, waiver dropped

- **Status:** Accepted · 2026-11-04
- **Origin:** v2 performance pass (castle KB-I105) · supersedes row 7 („Triangle waiver“) of [0033](0033-castle-module-zone.md) · builds [0028](0028-phone-proxy-headroom.md), [0034](0034-tree-lod-rank-prefix-dither.md)

## Context
[0033](0033-castle-module-zone.md) let the castle declare 3.7 M triangles in view against the contract's 1.5 M, because the garden's tree crowns put up to 3.63 M in view during the Rundflug. The waiver was meant to last only until the crowns got cheap far stand-ins. The zone contract sets its budgets for the phone proxy ([zone contract](../zone-contract.md) „Budgets“), but it never said in which viewport the triangles are counted. A wide desktop window sees more of the garden than a portrait phone.

## Decision
| # | Topic | Rule |
|---|---|---|
| 1 | 🌳 Far crowns | Garden crowns beyond max(160 m, 34 crown radii) are drawn as 70-triangle hulls with the forest's leaf-cluster shading. The forest's close and hero tiers only take crowns in view (frustum + 14°) |
| 2 | 📏 Measure | Triangles in view = `skb.inView()` (submitted triangles of visible meshes in the frustum, no shadow pass). The peak comes from a sweep of the whole Rundflug in 0.5 s steps in the **phone-proxy viewport** (390 × 844), `pnpm run perf:zone` |
| 3 | 📐 Budget | The castle declares **1.4 M** (measured peak 1.36 M, ≤ 0.9 M indoors). The contract's 1.5 M holds, and `TRIANGLES_WAIVER` is gone from the export and the tests |
| 4 | 🖥️ Desktop | A landscape desktop view (1440 × 900) sees ≈ 2.1 M in the Rundflug. That is not a budget breach: desktop GPUs have the headroom, and the budget is the phone's |

## Consequences
- ✅ Every zone, the castle included, now meets the same triangle limit. The bakery and later zones never got a waiver, and now there is none to point to as a precedent.
- ✅ Phone-proxy Rundflug peak 2.78 → 1.36 M in view, spawn 2.2 → 1.2 M. Draw calls stay at ≈ 580 (castle KB-I108).
- ⚠️ Close up, side-by-side, flowering shrubs at ≈ 250 m lose a few blossom specks and one conifer tip looks rounder. Nobody has checked yet whether the swap pops in a live flight.
- ⚠️ A zone's triangle budget now depends on the viewport. Producers measure in the phone-proxy viewport.
