# 🗺️ Orte skalieren: the whole Saarland, one community repo per municipality (living plan)

- **Status:** ✅ S0 done ([spike report](orte-skalieren-s0.md)); ✅ S1 built locally incl. the statewide LiDAR run, release prepared (waits for the user's go); ✅ S2 built locally (contract v3, catalog mode, Homburg as a v3 place), follow-ups listed under S2. Next: S2 follow-ups, then S3 (needs new GitHub repos: user's go).
- **Last updated:** 2026-11-08
- **Origin:** user idea, 2026-11-08: bring Zweibrücken, the neighbouring towns and eventually the whole Saarland into the explorer. One repo per town, village or district, which also collects other data, tools and skills for the community. Community-driven on GitHub, no backend, hosted on GitHub Pages.
- **How to keep this alive:** tick the boxes in §9, update the open questions in §10, and add a dated line to §11 for every decision and to §12 for every change to this file. Once a step ships, its decisions move into an ADR and its formats into `docs/data-contract.md` (contract first, [ADR 0004](../adr/0004-contract-first.md)); this file then links to them.
- **Related:** [Orte im Vergleich](orte-im-vergleich.md) (leaderboards, ADR 0049/0050), `scripts/release/RELEASING.md`, ADR 0048 (zones).

---

## 1. Goals

1. **Coverage:** every municipality of the Saarland (52 Städte und Gemeinden, 2,570 km²), plus neighbours across the border such as Zweibrücken (RLP), can be explored in 3D. Flying across a municipal border is seamless.
2. **Motivation:** a Saarland-wide leaderboard (*Orte im Vergleich*) in which every municipality appears, including those without 3D yet. "Bring your town to the top" and "your town still needs an Ortspate" both drive participation.
3. **Community:** local people (*Ortspaten*) maintain their municipality's repo: points of interest, stories, tree reports, planting and unsealing actions, special 3D zones. They don't need to install the pipeline.
4. **No backend:** static hosting only (GitHub Pages), GitHub Actions for builds, GitHub Issues and pull requests as the input channel. This keeps [ADR 0022](../adr/0022-local-first-no-accounts.md) (local first, no accounts) intact.

## 2. Guardrails (decided or inherited)

| # | Rule | Source |
|---|---|---|
| R1 | Everything stays under the GitHub org **Open-Kirrberg** for now. | user, 2026-11-08 |
| R2 | Leaderboards rank places only, never parcels, people or buildings; aggregates only. | ADR 0049, 0050 |
| R3 | Leaderboard numbers are **computed centrally** from public sources, never reported by a place repo. | §6, anti-cheating |
| R4 | The app shows hypotheses; keep "Schauen, nicht graben"; no digging or detector guidance. | ADR 0008 |
| R5 | The craters stay fully private and never enter a community repo. | Q-29, 2026-11-02 |
| R6 | Every new source and every community asset is licence-checked before it is published. CI does the routine part, a maintainer reviews. | CLAUDE.md, RELEASING.md |
| R7 | Community content: no people, licence plates, mailboxes, private doors or courtyards, no personal data beyond a GitHub handle. | existing zone rules |
| R8 | Be polite to public services: caching, ≤ 3 parallel requests, scheduled builds, no rebuild without a reason. | CLAUDE.md |
| R9 | Contract first; old manifests stay loadable, because place repos are built at different times. | ADR 0004 |

## 3. Why one repo per municipality

Measured today: the published AOI `overall` (6 × 8 km = 48 km²) is **748 MB**, i.e. **≈ 15.6 MB/km²**. The whole Saarland would be ≈ 40 GB. A GitHub Pages site may be at most **1 GB** (files ≤ 100 MB, soft limit ≈ 100 GB bandwidth per month, ≈ 10 builds per hour). Splitting is therefore required, not just nice for the community.

| Unit | Count | Size at today's density | Verdict |
|---|---|---|---|
| Landkreis | 6 | Saarpfalz-Kreis 418 km² → ≈ 6.5 GB | too big for one site |
| **Gemeinde** | 52 (+ neighbours) | average ≈ 50 km² → ≈ 0.8 GB; Saarbrücken 167 km² → ≈ 2.6 GB | **chosen unit**; fits after S0 slimming |
| Gemarkung / village | several hundred | small | too many repos, too few maintainers |

A Gemeinde also matches the official statistics (Zensus, MaStR are published per municipality) and has an unambiguous boundary. Villages and districts (Kirrberg, Bruchhof-Sanddorf …) become **Ortsteile inside their Gemeinde repo**, as they are today inside Homburg.

## 4. Architecture

```
Open-Kirrberg/saar-lidar-explorer   app code (one app for all places), deployed as today
Open-Kirrberg/orte-katalog          catalog of places + tile ownership + Saarland leaderboard + overview levels
Open-Kirrberg/ort-homburg           Homburg: ort.toml, community content, zones; data built by Actions
Open-Kirrberg/ort-zweibruecken      created from the template repo
Open-Kirrberg/ort-vorlage           template repo (workflow, devcontainer, CI checks, skills, CONTRIBUTING.md)
```

### 4.1 Catalog (`orte-katalog`, format `sle-catalog-v1`, draft)

Published on Pages as `catalog.json`; small, cached by the app.

```jsonc
{
  "format": "sle-catalog-v1",
  "crs": "EPSG:25832",
  "grid": { "origin": { "E": 300000, "N": 5400000 }, "tile_m": 1000, "chunk_m": 500 },
  "places": [
    {
      "id": "homburg",
      "name_de": "Homburg",
      "ags": "10045114",                       // Amtlicher Gemeindeschlüssel
      "state": "SL",
      "repo": "Open-Kirrberg/ort-homburg",
      "data_url": "https://open-kirrberg.github.io/ort-homburg/",
      "status": "3d",                          // "3d" | "stats" (no Ortspate yet) | "building"
      "maintainers": ["huhn511"],
      "tiles": "tiles/homburg.json"            // owned 1 km tiles (see 4.2)
    }
  ],
  "overview": "overview/manifest.json",        // coarse levels for the whole area (4.3)
  "leaderboard": "stats/places.json"          // sle-stats-v1, all municipalities (§6)
}
```

### 4.2 One global grid, every tile has exactly one owner

- All places share one **global 1 km tile grid** in EPSG:25832 (500 m chunks inside, as now). The current AOI origins already lie on whole kilometres, so today's data fits the grid.
- **Ownership rule:** a 1 km tile belongs to the municipality with the largest area share in it; the catalog computes this deterministically from the official boundaries. A place repo builds and publishes **only its own tiles**, with a buffer for the relief kernels, so neighbouring repos meet without overlap or gaps.
- **Contract change needed:** today an AOI is a rectangle (`width × height`, all chunks present). A place is a set of tiles, so the manifest gets the bounding rectangle **plus a chunk presence list**. Missing chunks are "not mine", not errors.
- **App:** one world origin per session (float64), every further place is translated by its offset, the same pattern as shared datasets (data contract, "Shared datasets"). The app loads the manifests of the places around the camera on demand, from different origins (Pages sends `access-control-allow-origin: *`, already verified for the data repo).

### 4.3 Coarse levels are central

Coarse LOD levels span several municipalities (a level-5 chunk is 16 km wide), so no single place repo can own them. The catalog therefore builds **overview levels for the whole area** (Saarland at 16 m is ≈ 10 M cells, a few MB). Place repos ship only the fine levels. Levels are anchored to the global grid origin, no longer to each AOI's north-west corner (contract change, versioned).

### 4.4 Data is built in Actions, not committed

- A place repo contains only **`ort.toml`** (name, AGS, maintainers, options such as `relict_candidates = false`), the community content and a workflow that calls a **reusable workflow** from the explorer repo with a pinned pipeline version.
- The workflow fetches the LVGL / GeoBasis RLP tiles for the owned tiles, runs the pipeline and deploys with `actions/deploy-pages` (Pages artifact). **Generated data never enters git**, so repo history stays small. Today's two data repos deploy from a branch and grow with every update; they are retired after S3.
- Rebuilds happen on a change of `ort.toml` or content, on a new pipeline version (Renovate/Dependabot PR), or on a new official flight, and are never scheduled blindly (R8). Downloads are cached between runs (actions/cache, keyed on tile list + source version).
- A **devcontainer / Codespace** gives Ortspaten a preview without installing anything.

## 5. Size budget (target ≤ 5.5 MB/km²)

**S0 result (2026-11-08, [spike report](orte-skalieren-s0.md)):** the target holds. Homburg as a whole municipality (82.6 km², AOI `homburg-gemeinde`, a 176 km² rectangle) is ≈ 2.3 GB = 13.1 MB/km² today and **≈ 930 MB = 5.3 MB/km²** in the target format (`overall`: 5.5 MB/km²), without losing a feature:
- hillshade, slope, SLRM and VAT live in the shader (VAT from svf + opns_pos; mean difference 0.4 grey levels); the baked hillshade was never displayed;
- svf / openness as AVIF q90, DTM and u8 data layers as WebP lossless (bit-exact in Chromium);
- `dsm` dropped (DTM + CHM reproduce it to 8 cm p99);
- only level 1 in a place repo, coarse levels central (§4.3);
- OSM ways as 2D lines, parcel lines derived from the polygons;
- ortho and historic maps hosted as AVIF q65 (D6);
- minimap tiles (missing below, +7.3 MB/km² today): VAT only, ≤ z16, ≈ 0.5 MB/km².

The chunk presence list (§4.2) matters as much: the outline fills only 47 % of its rectangle (298 of 704 chunks don't touch Homburg). As a place repo Homburg owns 82–120 tiles ≈ 0.45–0.65 GB; Saarbrücken (≈ 0.9–1.1 GB) is borderline. **Traffic:** a typical 11 km flight loads ≈ 212 MB today, ≈ 147 MB in the target format; opening and looking around ≈ 80 MB. That is ≈ 680 flights or ≈ 1,800 short visits per site and month under the ≈ 100 GB soft limit.

The first table from the plan draft (before S0), today's 15.6 MB/km² by directory (from `overall`, 48 km²):

| Directory | MB | MB/km² | Lever |
|---|---|---|---|
| relief (10 layers) | 270 | 5.6 | hillshade, slope and VAT (≈ 100 MB) can be derived in the shader from the DTM; keep SLRM, SVF and openness (large kernels); check WebP/AVIF |
| pointclouds | 115 | 2.4 | only at curated hot spots, opt-in per place |
| vectors | 70 | 1.5 | gzip/brotli check, drop the parcel polygons from the 3D bundle (only needed for lookup), maybe vector tiles |
| dsm | 68 | 1.4 | needed only for canopy height; u8 CHM is already in relief/chm → check whether dsm can go |
| ortho | 61 | 1.3 | lower zoom levels only, or load the official WMS live (check CORS and licence) |
| historic maps (1840, 1935) | 50 | 1.0 | as ortho |
| dtm | 48 | 1.0 | keep |
| levels | 42 | 0.9 | fine levels only (coarse ones are central, 4.3) |
| models | 30 | 0.6 | keep |
| trees, candidates | 10 | 0.2 | keep |

The S0 spike measures what the levers really bring. If a large municipality still exceeds 1 GB, its repo publishes to a second Pages site (`ort-saarbruecken-2`), as `saar-lidar-data-2` does today.

## 6. Saarland leaderboard (central)

- The catalog computes `sle-stats-v1` for **all municipalities** from public sources: LiDAR canopy and trees, ALKIS land use and sealing, Zensus, MaStR, DLR, GBIF. Raw rasters are discarded; only aggregates are published (R2).
- Tree-based disciplines need the canopy model for the whole area. This runs once locally or in Actions per municipality, streaming tile by tile; only the numbers are kept.
- **Levels in the table:** municipalities are compared with municipalities. The nine current places are Gemarkungen (e.g. "Homburg" means the core town only). They become a second level, *Ortsteile innerhalb einer Gemeinde*, with their own table. Mixing levels in one ranking is not fair (decision D3).
- **Comparability:** RLP neighbours are measured from a different flight (2022) than the Saarland (2025). They keep the existing "other flight" badge, and the medal table can be filtered to "same source only".
- A municipality without a place repo still appears with status *stats*, showing a call to action ("Hier fehlt noch ein Ortspate").

## 7. Community content in a place repo

```
ort.toml                  name, AGS, maintainers, options
inhalte/orte/*.geojson    points of interest (schema-checked)
inhalte/geschichten/*.md  stories with front matter (place, sources, licence)
inhalte/bilder/           own photos only, CC BY 4.0 or CC BY-SA 4.0, EXIF stripped by CI
aktionen/*.yml            planting / unsealing actions (date, area, partner); feeds "So kommt <Ort> nach oben"
zones/                    special 3D zones (e.g. Schloss Karlsberg, Bäckerei), ADR 0048
.github/ISSUE_TEMPLATE/   forms: Riesenbaum melden, Fehler melden, Aktion melden, Geschichte vorschlagen
.claude/skills/           e.g. "ort-pflegen": add a point, check the licence, start the preview
CONTRIBUTING.md           German, step by step; CODEOWNERS = the Ortspaten
```

**CI checks on every pull request:** schemas, licence field present and allowed, image size and EXIF, privacy heuristics (R7), no coordinates inside private zones, no precise coordinates for newly reported archaeological finds (R4, R5). Human review stays mandatory; CI only filters the routine cases.

**Issue forms** are the input channel for people without Git. An Ortspate turns an accepted issue into a pull request; a skill can do the conversion.

**Relict candidates** (automatic detection) are off by default in new places (`relict_candidates = false`). The Ortspate switches them on deliberately (decision D4).

## 8. Risks

| Risk | Mitigation |
|---|---|
| Pages is not meant as a data host; bandwidth ≈ 100 GB/month per site | S0 measured ≈ 147 MB per flight in the target format (≈ 680 flights / month / site). The central overview levels carry ≈ 26 MB of every session in the whole Saarland (≈ 3,900 sessions / month): keep them cheap or host them elsewhere. The app loads data only by URL, so a place can move to any static host (Cloudflare R2, Hetzner Object Storage) by changing `data_url` in the catalog. |
| Repos built with different pipeline versions | R9: the app loads all supported contract versions; the catalog CI warns about outdated places; leaderboard numbers are central anyway. |
| Load on LVGL / GeoBasis services when many repos build | Build caches, rebuild only on change, at most one build per place at a time, a descriptive User-Agent. |
| Moderation workload | CI filters routine cases; CODEOWNERS spread the review; content types start small. |
| Heritage law at Saarland scale | D4 (candidates opt-in), R4, R5. |
| Abandoned place repos | Data stays served; the catalog marks a place without an active Ortspate; core maintainers can take over. |
| GitHub dependency | Everything is plain files plus standard workflows, so it can move to another forge or static host. |

## 9. Roadmap

- [x] **S0 Size and traffic spike** (2026-11-08, [report](orte-skalieren-s0.md)). Build one full municipality (Homburg, 82.7 km²) with the current pipeline. Measure MB/km² per directory and the traffic of a typical flight. Prototype shader-derived hillshade / slope / VAT and the ortho / historic map options. Result: target format, update §5.
- [x] **S1 Saarland leaderboard** (2026-11-08, ADR 0051; built and committed locally, statewide LiDAR run done: 2,857 tiles, 54 Gemeinden, all 7 Gemeinde disciplines ready; release staged with `export-data.sh --stats-only`, waits for the user's go). Municipality outlines and stats for all 52 Saarland municipalities plus selected RLP neighbours, computed centrally (first in the explorer pipeline, AOI `saarland` stats-only, later moved to the catalog). App: level switch Gemeinden / Ortsteile, status "Ortspate gesucht". Released via the existing data repo.
- [x] **S2 Contract and app for many sources** (2026-11-08; contract revision 3.0, ADR 0052–0056; `catalog.py`, `overview.py`, v3 place build — Homburg 4.1 MB/km² without parcels and historic maps; app catalog mode via `VITE_CATALOG_URL`). **Follow-ups:** overview no-data / coverage bitmap (today the app hides everything outside owned tiles), per-place relict candidates and historic layers in catalog mode, tree colour type independent of locally present ortho rasters (needed for Actions builds), the 100 m height floor against implausible source pixels, parcels and historic maps for Homburg once the Geoportal answers again, Safari/Firefox AVIF check. `docs/data-contract.md`: global grid, chunk presence list, central overview levels, `sle-catalog-v1`. App: catalog loader, multi-origin streaming, seamless borders, minimap with all place outlines and names (this resolves the open Zweibrücken offer). ADR "one repo per municipality".
- [x] **S3 Template and first place repo** (2026-11-08: public repos `ort-vorlage` (template), `ort-homburg`, `orte-katalog` (catalog live, overview from a release bundle); reusable `build-place.yml` in the explorer repo, ADR 0058; zones stay in `saar-lidar-data` for now, D8). Original scope: `ort-vorlage` (reusable build workflow, Pages artifact deploy, devcontainer, CI checks, issue forms, skills, CONTRIBUTING.md). Move today's `overall` into `ort-homburg`; zones Schloss Karlsberg and Bäckerei Heusser move with it. Retire `saar-lidar-data` / `-2` once the app reads from the catalog (keep them online during a transition).
- [x] **S4 Second place with a real Ortspate.** ✅ 2026-11-09: Zweibrücken live (`ort-zweibruecken`, 384 MB, ADR 0059), first RLP-only place, cross-border test; maintained by the core team until an Ortspate is found. Template fixes: neighbour services best effort, 30 min Pages deploy timeout, build cache on the `pipeline/` tree. Live smoke test of catalog mode (Homburg + Zweibrücken + overview from three Pages sites, CORS ok): `docs/shots/s4-live/`. Public app switched to catalog mode 2026-11-09 (user's go, `SLE_CATALOG_URL`).
- [ ] **S5 Community content in the app.** Points, stories and actions from place repos shown in the app; actions feed "So kommt <Ort> nach oben".
- [ ] **S6 Rollout.** ⏸ On hold (user, 2026-11-08): before the whole Saarland gets detail 3D, the hosting is reconsidered — e.g. one statewide repo instead of one per municipality, or another approach (Q-S1). The catalog's stats layer and overview already cover all municipalities.

## 10. Open questions and decisions

| # | Question | Status |
|---|---|---|
| D1 | GitHub org | **decided:** stay with Open-Kirrberg (user, 2026-11-08) |
| D2 | Unit of a repo | **decided:** Gemeinde; Ortsteile inside ([ADR 0052](../adr/0052-one-repo-per-municipality-central-catalog.md)) |
| D3 | Leaderboard levels | **decided:** separate tables for Gemeinden and Ortsteile, never mixed ([ADR 0051](../adr/0051-leaderboard-levels-gemeinden-ortsteile.md)) |
| D4 | Relict candidates in new places | **decided:** off by default, opt-in by the Ortspate ([ADR 0053](../adr/0053-relict-candidates-opt-in-new-places.md)) |
| D5 | Licence of community content | **decided** ([ADR 0054](../adr/0054-community-content-licences.md)): text and images CC BY 4.0 (or CC BY-SA 4.0 per item), data contributions CC0 or ODbL where derived from OSM |
| D6 | Ortho and historic maps: host or load the WMS live | **decided (S0):** host both as AVIF q65; the historic WMS needs a session cookie (not usable cross-origin), the ortho is the default ground and must be reliable. A live 0.2 m ortho near the camera may come later |
| D7 | Second place and first Ortspate | open, user |
| D8 | When to retire `saar-lidar-data` / `-2` | after S3, with a transition period |
| Q-S1 | Detail 3D for the whole Saarland: one repo per municipality (ADR 0052), one statewide repo, or something else (object storage, PMTiles, …)? | open (user, 2026-11-08): no rollout beyond Homburg, Zweibrücken and St. Ingbert (user, 2026-11-11) until decided |

## 11. Decision log

- 2026-11-08: user wants to scale to Zweibrücken and the whole Saarland, community-driven on GitHub, one repo per place, no backend (GitHub Pages).
- 2026-11-08: stay under the org Open-Kirrberg (D1).
- 2026-11-08 (S2 contract): manifest `version: 3` (older apps reject it instead of drawing gaps); global grid origin E 300000 / N 5400000, 256 km; tile id `"{E_km}_{N_km}"`; presence = base64 bitmap; ownership = largest m² share, tie → smaller AGS; relief buffer = own tiles + 8 neighbours, recomputed from the official sources (byte-identical at borders); fixed u8 value ranges in v3; one session origin and one catalog `height_ref_m`; central `sle-overview-v1` serves levels ≥ 2; catalog with inline ownership bitmaps; no AVIF fallback files. D2, D4, D5 accepted as ADR 0052–0054 (autonomous-decision rule).
- 2026-11-08: Zweibrücken is the second place (S4). The statewide rollout (S6) is on hold; the user wants to reconsider the structure first (Q-S1).
- 2026-11-09: The finished-build cache is keyed on the `pipeline/` tree hash, not the commit (a deploy-only pin bump cost a rebuild); Homburg's first deploy timed out twice at the 10 min default.
- 2026-11-11: St. Ingbert (`ort-st-ingbert`, AGS 10045117, 50 tiles, all five Stadtteile incl. Rohrbach) is the third place, on the user's request — a single place, not the start of the S6 rollout (Q-S1 stays open). Same defaults as Zweibrücken: candidates off, no point clouds, maintained by the core team until an Ortspate is found.
- 2026-11-08 (S2 build): the catalog status wins over the stats status (joined on AGS); in catalog mode the app fades terrain outside owned tiles into the haze (overview fill has no no-data marker yet); a Gemeinde is flown to by geometry against the current area.
- 2026-11-08 (S0): target format ≤ 5.5 MB/km² confirmed on Homburg (5.3); D6 = host ortho and historic maps as AVIF. The format changes (WebP/AVIF paths, live relief, no dsm, 2D OSM, presence list) go into the S2 contract work; the live-VAT shader prototype stays on the branch `spike/s0-live-vat` until then.
- 2026-11-08 (S1): Gemeinde level as a stats-only AOI `saarland` plus manifest key `stats_levels` (ADR 0051). Outlines: BKG VG25 (CC BY 4.0). RLP neighbours for now: Zweibrücken and Bechhofen; more through their place repos later. Size class by legal status (Stadt / Gemeinde). On this level the tree count is measured crown tops only (no conifer fill from the 10 m DLR map, which doubled counts in conifer tiles). Grünste Ortslage (NDVI), Wenigsten Beton and Riesenbaum are not offered on this level in S1.

## 12. Changelog of this file

- 2026-11-08: first draft from the brainstorm in chat.
- 2026-11-08: S0 result merged (§5, §8, D6), S1 decisions logged, D3 decided, Homburg's AGS in the catalog example fixed (10045114).
- 2026-11-08: S2 contract written (data contract revision 3.0, ADR 0052–0056); §4 stays as the overview, the binding text is in the contract.
- 2026-11-08: S1 and S2 ticked, S2 follow-ups listed.
