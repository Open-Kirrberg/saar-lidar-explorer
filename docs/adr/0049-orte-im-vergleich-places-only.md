# 0049 · 🏆 Orte im Vergleich: leaderboards rank places only

- **Status:** Accepted · 2026-11-07
- **Origin:** [plan „Orte im Vergleich“](../plans/orte-im-vergleich.md) §2, §5, §9 (Q1, Q3, Q4, Q10) · user, 2026-11-07

## Context
The LiDAR trees, ALKIS parcels, LoD2 roofs and the orthophoto allow numbers per parcel and per building: trees, canopy, sealed area, PV panels. A leaderboard makes the data visible and playful. But a parcel or a roof can be linked to its owner. A public „greyest gardens“ list would be a pillory and a GDPR problem. MaStR hides small PV systems below the municipality for the same reason. Biomass from crown allometry can be wrong by a factor of 2.

## Decision
- **Places only (G1).** Leaderboards rank Gemarkungen (Q4; Ortsteile, teams or clubs later). Never parcels, buildings, households or persons. First nine places per Q1; RLP places carry `other-flight`.
- **Aggregates only (G2, G3).** Published files hold values per place or municipality, nothing per parcel or building, no parcel ids, addresses or owner data. Aggregates over fewer than 5 buildings or parcels are suppressed. Looking at one's own parcel stays a private, on-device view.
- **PV:** MaStR totals per municipality (Phase 0); per-building detections from the orthophoto are **never published or shown**, only summed per place (Phase 1).
- **Estimates are labelled (G7).** Biomass, CO₂ and detected kWp are published as `[lo, mid, hi]` ranges with a versioned method id. Biomass is not a discipline until a girth calibration exists (Q3).
- **Diversity, virtual, local (G4–G6).** Disciplines reward green and unsealed shares, not only tree counts. Goals and quests stay virtual ([0021](0021-quests-virtual-only.md)); planting ideas exclude monuments and candidate areas ([0008](0008-hypotheses-schauen-nicht-graben.md)).
- **No server in Phases 0 and 1** (extends [0022](0022-local-first-no-accounts.md)): one static `stats/places.json` (`sle-stats-v1`) plus simplified outlines. A community backend (Phase 2) needs a new ADR.

## Consequences
- ✅ Public, fun comparison without a pillory; static hosting and the release export stay as they are ([0012](0012-github-pages-release.md)).
- ✅ Format in [data-contract „Place statistics“](../data-contract.md#-place-statistics-stats-optional-orte-im-vergleich); every input credited ([0013](0013-attribution-every-source.md)).
- ⚠️ Places differ in size and LiDAR epoch: boards compare shares, incomplete places stay unranked, RLP places get a badge.
- ⏳ PV per Gemarkung, species and progress disciplines wait for Phase 1 or a second flight.
