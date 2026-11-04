# 0030 · 🌲 Conifer fill trees: estimated, flagged

- **Status:** Accepted · 2026-11-04
- **Origin:** V2.4a · H7 tree-count check (plot P1, dense spruce)

## Context
[0017](0017-real-trees-from-chm.md) wants one tree per crown from CHM local maxima. The CHM comes from the 1 m DOM1 of a **leaf-off** flight. In dense conifer stands (≈ 5 m between tops) the DOM is a smooth blob, so the maxima miss most trees:

| Plot (hand count) | Maxima only | With fill |
|---|---|---|
| P1 dense conifer (88) | 36 (−59 %) | 90 (+2 %) |
| P2 mixed broadleaf (51) | 48 | 48 (no fill) |
| P3 open orchard (33) | 34 | 34 (no fill) |

A 0.5 m CHM from the LAZ (4 pts/m²) was tested: too speckled to separate the tops, and it needs ≈ 2 GB of downloads for `overall`.

## Decision
- A conifer crown segment larger than expected is split by k-means into `round(area / (π · rc(h)²))` crowns, `rc(30 m) = 2.5 m` (≈ 500 stems/ha, typical for mature spruce).
- The measured top stays. Every extra tree is a **fill tree**: its position is estimated, its height and radius come from the CHM. It carries the `type` flag `0x80` ([data contract "Trees"](../data-contract.md#-trees-trees-optional-v24)).
- Broadleaf and unknown crowns are never filled.

## Consequences
- ✅ Forest density looks right where it matters most visually (dense conifers).
- ⚠️ Fill positions are within ≈ 2–3 m of a real tree, not on it. "That tree is really there" (0017) holds for measured tops only.
- ⚠️ The calibration is a single plot. A LAZ- or leaf-on-based CHM would replace the fill.
- ➡️ The renderer may style fill trees the same way. Tools that inspect single trees must ignore them.
