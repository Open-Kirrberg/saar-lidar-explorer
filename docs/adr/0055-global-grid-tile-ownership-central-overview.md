# 0055 · 🧭 Global 1 km grid, tile ownership, presence list, central overview levels

- **Status:** Accepted · 2026-11-08
- **Origin:** [plan „Orte skalieren“](../plans/orte-skalieren.md) §4.2–4.3, §9 S2 · [S0 report](../plans/orte-skalieren-s0.md) §1, §2.5 · contract [„Many places (v3, S2)“](../data-contract.md)

## Context
An AOI today is a rectangle with every chunk present and its levels anchored at its own north-west corner. Municipalities are not rectangles (Homburg fills 47 % of its bounding box), neighbours must meet without gaps or overlap, and coarse levels (a level-5 chunk is 16 km wide) span several municipalities. The engine and the pipeline should keep their chunk formulas.

## Decision
- **One global grid** in EPSG:25832: origin E 300 000 / N 5 400 000, extent 256 km (all of the Saarland and its RLP neighbours; level chunks up to k = 9 nest), 1 km tiles named like the source tiles (`382_5466`), 500 m chunks inside. Every v3 rectangle is aligned at 1 km; chunk indices in paths stay relative to the rectangle, with a fixed conversion to global addresses.
- **Ownership:** a tile belongs to the catalog place with the largest area share (integer m², VG25 outlines); ties go to the smaller AGS. Computed only by the catalog.
- **Presence list:** a place publishes only its own tiles; a base64 bitmap per rectangle says which exist. Missing means „not mine“, never an error.
- **Seamless borders by recomputation, not by exchange:** each place builds from the official sources with the 8-neighbour tiles as buffer; every value depends only on data within the buffer, and u8 ranges are fixed constants.
- **Central overview:** levels ≥ 2 are built by the catalog for the whole area, anchored at the global grid; places ship levels 0 and 1 only. The app resolves level ≤ 1 chunks through the tile owner and levels ≥ 2 through the overview.
- **One session origin** (float64) and one exaggeration reference height for all places; each place is translated by its offset.
- Manifest `version: 3`, so older apps reject the new semantics instead of misrendering; v1/v2 stay loadable.

## Consequences
- ✅ Kirrberg-to-Zweibrücken flights cross borders without seams or double objects; places can be built and moved independently.
- ✅ Loaders keep their per-rectangle formulas; the presence list costs < 100 bytes per place.
- ⚠️ The central overview carries ≈ 26 MB of every session (S0): it must stay cheap (quantised heights) or move to another host.
- ⚠️ AOI `kirrberg` (north edge on the 500 m grid) stays a v2 single-AOI dataset; the western Eifel (E < 300 000) needs a new grid id if ever wanted.
