# 0052 · 🏘️ One repo per municipality, one central catalog

- **Status:** Accepted · 2026-11-08 (plan D1 decided by the user, D2 proposed in the plan and not contradicted; accepted with the S2 contract under the autonomous-roadmap rule)
- **Origin:** [plan „Orte skalieren“](../plans/orte-skalieren.md) §1–4, §10 D1/D2 (user, 2026-11-08: Zweibrücken and the whole Saarland, community-driven, no backend) · [S0 report](../plans/orte-skalieren-s0.md)

## Context
The published AOI `overall` costs ≈ 13 MB/km² today; the whole Saarland would be ≈ 40 GB, and one GitHub Pages site holds at most 1 GB with ≈ 100 GB traffic per month. Local people (*Ortspaten*) should maintain points, stories and actions for their own place without installing the pipeline. A Landkreis is too big for one site (Saarpfalz-Kreis ≈ 6.5 GB), a Gemarkung too small to find maintainers. Coarse terrain and the leaderboard span many places and cannot belong to one of them.

## Decision
- **Org:** everything stays under the GitHub org Open-Kirrberg (D1).
- **Unit = Gemeinde (D2):** one repo `ort-<id>` per municipality (52 in the Saarland plus RLP neighbours on request); villages and districts are Ortsteile inside it. Created from a template repo `ort-vorlage`.
- **Data is built in Actions, never committed:** a place repo holds `ort.toml`, community content and zones; a reusable workflow from the explorer repo with a pinned pipeline version builds the data and deploys it as a Pages artifact.
- **One central catalog** `orte-katalog` publishes `catalog.json` (`sle-catalog-v1`): every place with status, `data_url` and its owned tiles, the central overview levels and the Saarland leaderboard. Leaderboard numbers and tile ownership are computed there, never reported by a place repo.
- **One app** for all places: the explorer reads the catalog and streams the places around the camera from their own hosts (contract „Many places (v3, S2)“).

## Consequences
- ✅ Each place fits one Pages site in the slim format (Homburg ≈ 0.5 GB) and has its own traffic budget; a place can move to any static host by changing `data_url`.
- ✅ Repo history stays small; community work happens where the people are.
- ⚠️ Places are built at different times with different pipeline versions: the app must keep loading every v3 manifest (R9), and the catalog CI warns about outdated neighbours.
- ⚠️ Saarbrücken is borderline (≈ 1 GB): a second site or stronger AVIF settings.
- The release path of [0012](0012-github-pages-release.md) stays for the app and today's data repos until S3 retires `saar-lidar-data` / `-2`.
