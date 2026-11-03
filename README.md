# Saar LiDAR Explorer

> **Live:** [https://open-kirrberg.github.io/saar-lidar-explorer/](https://open-kirrberg.github.io/saar-lidar-explorer/) · Schloss-Viewer: [https://open-kirrberg.github.io/saar-lidar-explorer/castle/](https://open-kirrberg.github.io/saar-lidar-explorer/castle/) · Daten: [https://open-kirrberg.github.io/saar-lidar-data/](https://open-kirrberg.github.io/saar-lidar-data/), [https://open-kirrberg.github.io/saar-lidar-data-2/](https://open-kirrberg.github.io/saar-lidar-data-2/) · [github.com/Open-Kirrberg](https://github.com/Open-Kirrberg)  
> Code: MIT ([LICENSE](LICENSE)). Daten und Bilder behalten ihre Lizenzen (dl-de/by-2-0, ODbL, CC BY-SA 2.0 DE) – siehe [NOTICE.md](NOTICE.md). **Schauen, nicht graben:** Verdachtsflächen sind ungeprüfte Hypothesen.

Explore the **real** Kirrberg, Homburg and Schloss Karlsberg like a game. Fly or walk over the 2025 airborne-LiDAR terrain, enter detailed places such as the palace as it stood in **1789**, and learn to spot relicts under the forest: walls, moats, pits, hollow ways. 🎮🌲🏰

> **Schauen, nicht graben.** Everything the app highlights is a *hypothesis* from terrain data, not a find. See [Heritage and ethics](#heritage-and-ethics).

![Schloss Karlsberg 1789 reconstruction, Ehrenhof at dusk, walking mode](schloss-karlsberg/docs/visual-audit/09-golden-hour-ehrenhof.jpg)
*The castle zone: Schloss Karlsberg 1789, a researched reconstruction (hypothesis). This is the look the whole world is heading for.*

## 🧭 Where it is going

| | Today: v1.4 ([live](https://open-kirrberg.github.io/saar-lidar-explorer/)) | Next: v2 "game shell" |
|---|---|---|
| Look | Analytic relief shading, many panels | Game look: aerial-photo ground, one real tree per LiDAR crown, houses, sky |
| Relicts | Relief lab with 10 modes, candidate review | *Relikt-Blick* lens: the trees fade, the relief shows, candidates glow |
| Places | Castle viewer as a separate app | Zones behind portals: the castle (1789) and a bakery in Kirrberg captured from video |
| UI | Dozens of switches | About 8 controls; *Entdecker* and *Labor* modes for more |

Later: quests and professions (v3), exploring together with friends (v4), more places and the whole Saarland (v5). Details: [PRD.md](PRD.md) · decisions: [docs/adr/](docs/adr/README.md) · history: [CHANGELOG.md](CHANGELOG.md).

## 🚀 Quickstart

Needs [uv](https://docs.astral.sh/uv/) (installs Python 3.12), Node 24 + pnpm 12, and ≈ 5 GB disk.

```bash
cd pipeline && uv sync && ./run.sh overall     # open data → app/public/data/overall/ (≈ 1.4 GB; ./run.sh karlsberg = small 3 × 3 km)
cd ../app && pnpm install && pnpm dev          # without pipeline data it opens the synthetic ?aoi=fixture
.claude/skills/sle-roadmap/scripts/verify.sh   # all gates: app tests + build, docs, pipeline tests
```

Serving a build, other data dirs, phone over HTTPS, controls: [app/README.md](app/README.md). Pipeline steps and sources: [pipeline/README.md](pipeline/README.md). Castle viewer: [schloss-karlsberg/README.md](schloss-karlsberg/README.md).

## ©️ Data sources and licences

| Data | Source | Licence |
|---|---|---|
| DGM1 / DOM1 2025, LAZ 2025, LoD2, TrueDOP20, historic maps, ALKIS Flurstücke (WFS + INSPIRE WMS) | Landesamt für Vermessung, Geoinformation und Landentwicklung Saarland (LVGL), open data | [dl-de/by-2-0](https://www.govdata.de/dl-de/by-2-0) — `© GeoBasis-DE/LVGL-SL (2026)` |
| DGM1 2022 (border fill), LoD2, DOP20, ALKIS (WFS) | Landesamt für Vermessung und Geobasisinformation Rheinland-Pfalz (geobasis-rlp.de) | dl-de/by-2-0 — `© GeoBasis-DE/LVermGeoRP` |
| Streets, paths, water, walls; most POI coordinates; minimap tiles | OpenStreetMap contributors (Overpass, tile.openstreetmap.org), OpenTopoMap | [ODbL](https://opendatacommons.org/licenses/odbl/) / CC-BY-SA (OpenTopoMap) |

The exact attribution strings are written into each dataset's `manifest.json` by the pipeline and shown in the app's footer; every new source must add its entry there. The "freie Liegenschaftskarte SL" is not openly licensed and is not used. Raw downloads stay in the git-ignored `data/`, generated data in the git-ignored `app/public/data/`.

## ⚖️ Heritage and ethics

- The app shows **hypotheses** from terrain data. Ground monuments in the Saarland and in Rheinland-Pfalz are protected (SDschG Saarland, DSchG RLP); searching for or digging up finds requires a permit, and chance finds must be reported to the Landesdenkmalamt.
- **Schauen, nicht graben:** no digging or metal-detector guidance. The disclaimer opens on the first start and stays reachable via ⓘ in the footer.
- **Private by default:** find markers, measurements, candidate reviews and settings live only in the browser's localStorage. Relict candidates (`candidates/`) are generated locally and git-ignored; they are published only in the public data repository, with a note that they are unverified hypotheses ([ADR 0009](docs/adr/0009-candidates-public-user-data-private.md)); crater/UXO indicators never ([ADR 0010](docs/adr/0010-craters-never-public.md)). Reports are downloaded, never sent.
- Public hosting: app and `overall` data (incl. candidates) on GitHub Pages under Open-Kirrberg ([ADR 0012](docs/adr/0012-github-pages-release.md)); the disclaimer opens on the first visit there too.

## 🗂️ Repository layout

| Path | What |
|---|---|
| [PRD.md](PRD.md) · [docs/adr/](docs/adr/README.md) · [CHANGELOG.md](CHANGELOG.md) | Product, decisions, shipped items |
| [docs/data-contract.md](docs/data-contract.md) | Binding format between pipeline and app |
| [pipeline/](pipeline/README.md) | Python 3.12 (uv): open data → static chunks, layers, candidates |
| [app/](app/README.md) | Vite + TypeScript + three.js + Leaflet explorer (German UI) |
| [schloss-karlsberg/](schloss-karlsberg/README.md) | Researched 3D reconstruction of the palace, 1789 |
| `research/` | Source research: data, tech stack, archaeology/legal, cadastre/historic maps |
| `docs/history/` | Frozen v1 PRD and roadmap |

Coordinates are EPSG:25832 everywhere in data and 3D (local origin); only the Leaflet map uses EPSG:3857.
