# 0051 · 🗺️ Leaderboard levels: Gemeinden and Ortsteile in separate files, Gemeinde level as a stats-only AOI

- **Status:** Accepted · 2026-11-08 (proposed as D3 in the plan the same day; accepted with the S1 contract)
- **Origin:** [plan „Orte skalieren“](../plans/orte-skalieren.md) §6, §9 S1 (user, 2026-11-08: the whole Saarland in the leaderboard, one repo per municipality) · builds on [0049](0049-orte-im-vergleich-places-only.md), [0050](0050-orte-im-vergleich-medal-table-no-total.md)

## Context
*Orte im Vergleich* ranks nine Gemarkungen around Homburg. The scaling plan wants every Saarland municipality on the board, including those without 3D yet, computed centrally from public sources. A Gemeinde (Homburg, 82.7 km², 42,900 inhabitants) and a Gemarkung (Einöd, 10 km²) are different units: ranking them in one table is unfair even with shares, and the Gemarkung „Homburg“ (the core town) would compete with the Stadt Homburg it belongs to. Some disciplines cannot be computed statewide politely: the NDVI behind *Grünste Ortslage* / *Wenigsten Beton* needs ≈ 2,600 GetMap requests on the SL CIR WMS, and *Riesenbaum* publishes tree positions that first need the statewide plausibility checks.

## Decision
- **Two levels, never mixed:** *Gemeinden* (52 SL municipalities + RLP neighbours) and *Ortsteile innerhalb einer Gemeinde* (today's Gemarkungen). Each level is its own `sle-stats-v1` file with a top-level `level`; a file without it is the Ortsteile level.
- **The Gemeinde level is a stats-only AOI `saarland`** (manifest `kind: 'stats-only'`, no terrain) on the same data root; tile AOIs point to the levels with the additive manifest key `stats_levels`. `overall`'s stats file stays unchanged, so old readers keep working.
- **RLP neighbours:** Zweibrücken and Bechhofen (the two RLP municipalities that already own Ortsteile on the board), flagged `other-flight` (2022). More neighbours come with their place repos (S4/S6), not by default: each adds a different flight and a different land's statistics.
- **Outlines:** BKG VG25 (CC BY 4.0, ATKIS accuracy), not VG250 (too coarse for 1 m LiDAR) and not dissolved ALKIS Gemarkungen (SL ALKIS WFS unreliable, parcel paging takes hours).
- **Size classes on the Gemeinde level by legal status** (Stadt / Gemeinde): every SL municipality has > 5,000 inhabitants, so the Ortsteile threshold does not separate them.
- **Not offered on the Gemeinde level in S1:** *Grünste Ortslage*, *Wenigsten Beton* (NDVI, R8) and *Riesenbaum* (positions need the checks). Instead the cheap *Waldanteil* (DLR map) and, after the LiDAR run, *Kronenreichste Ortslage* (canopy only).
- **No half boards:** a discipline is `ready` on a level only when every place has its value or a reasoned `none` (e.g. too few records, shown unranked with the reason); slow inputs show per place as `pending`, not as „unvollständig“.

## Consequences
- ✅ Fair comparisons per level; the level switch is a pure UI choice; the later catalog (`sle-catalog-v1`) can point at the same file.
- ✅ Every municipality appears with real numbers from day one (S1a), with „Ortspate gesucht“ where no place repo exists.
- ⚠️ Method differences between levels (tree type from the DLR map instead of the DOP colour, Ortslage without hole filling, official instead of grid inhabitants) mean numbers of a Gemeinde and the sum of its Ortsteile do not match exactly; the method ids say so.
- The Gemeinde tree count is **measured crown tops only** (no conifer fill trees, decided 2026-11-08): without a statewide orthophoto the tree type comes from the 10 m DLR map, and its conifer fill doubled the count in conifer tiles. It is labelled as such and is not compared 1:1 with the Ortsteile figure.
- ⏳ Grünste Ortslage / Wenigsten Beton for Gemeinden need an NDVI source that does not hammer the WMS (e.g. open DOP tiles per place repo build).
