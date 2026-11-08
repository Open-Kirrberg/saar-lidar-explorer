# 0059 · 🗺️ Places with sources from one state only: neighbour services best effort, no foreign historic maps, calibrated RLP orthophoto

- **Status:** Accepted · 2026-11-09 (S4, Zweibrücken)
- **Origin:** [plan „Orte skalieren“](../plans/orte-skalieren.md) §9 S4 · user, 2026-11-08: Zweibrücken as the second place · builds on [0055](0055-global-grid-tile-ownership-central-overview.md), [0058](0058-actions-builds-place-cache-catalog-bundle.md)

## Context
Zweibrücken is the first place whose tiles lie entirely in Rheinland-Pfalz. The v3 place build had only been run for Homburg (Saarland, a little RLP fill). Three things broke or were wrong for an RLP-only place: the Saarland ALKIS WFS 414 (down since 2026-11-07) blocked the parcels although only the RLP service was needed; the historic maps exist only as a Saarland WMS; and the RLP DOP20 is much darker than the Saarland TrueDOP, so the crown colour classifier read 71 % of Zweibrücken's trees as conifers (DLR 2022: 15 %).

## Decision
- **Services of the place's own state are required, the neighbour state's are best effort.** A place fetches parcels (and other per-state vector services) for its own state as a required step; the neighbour state's service is tried for the buffer ring and skipped with a warning when it is down.
- **Historic maps only where a source exists.** The 1840/1935 maps come from the Saarland WMS; for a place in another state the step is *not applicable* (no request, no warning, no manifest keys) instead of failed.
- **RLP orthophoto cells are brightness-calibrated** before the crown colour type, with the fixed linear mapping already fitted for the leaderboard (`stats_trees calibrate`, pinned constants), applied only to cells taken from the RLP DOP20. Saarland places are byte-identical.
- **Ortho attribution names only the sources whose pixels are used.**

## Consequences
- ✅ An RLP place builds while the Saarland Geoportal is down; Zweibrücken: 384 MB, 4.2 MB/km², 29,535 parcels, 4 % conifer.
- ✅ The SL/RLP border is seamless (both sides apply the same height rule; 28 chunk pairs, Δh = 0).
- ⚠️ The crown colour classifier under-calls conifers in both states (known before S4); the calibration only removes the RLP darkness bias.
- ⚠️ Point-cloud areas exist only for the Saarland; an RLP place must not list any.
