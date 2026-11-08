# Releasing to GitHub Pages (Open-Kirrberg)

The public release ([ADR 0012](../../docs/adr/0012-github-pages-release.md), user decision 2026-11-02) consists of three
GitHub repositories in the org **Open-Kirrberg**, all served by GitHub Pages under `https://open-kirrberg.github.io/`:

| Repository | Pages | Content | Built by |
|---|---|---|---|
| `saar-lidar-explorer` (public, MIT; **this repository**, developed here directly) | GitHub Actions (`.github/workflows/pages.yml`) → `/saar-lidar-explorer/` + standalone castle viewer `/saar-lidar-explorer/castle/` (fallback, [ADR 0048](../../docs/adr/0048-castle-zone-public.md)) | code + `LICENSE`, `NOTICE.md` | `git push origin main` |
| `saar-lidar-data` | branch deploy (`main`, `/`), `.nojekyll` | AOI `overall` without Leaflet tiles, stats-only AOI `saarland` (leaderboard level „Gemeinden“), `pois.geojson`, `shared/` (reconstruction 1789), `castle-viewer/terrain/`, `zones/` (cleared zone packages: castle, bakery) | `export-data.sh` |
| `saar-lidar-data-2` | branch deploy (`main`, `/`), `.nojekyll` | Leaflet XYZ tiles (≤ z17), 3D-print series (3MF only) | `export-data.sh` |

**S3 (many places):** the per-place repos `ort-<id>`, the template `ort-vorlage` and the catalog `orte-katalog` are
built by GitHub Actions instead (§6); the two data repos below stay online during the transition (§7).

**Why two data repos.** GitHub Pages publishes at most **≈ 1 GB per repository** (every file < 100 MB).
`saar-lidar-data` holds ≈ 825 MB (AOI `overall` layers, point clouds, castle terrain, zone packages),
`saar-lidar-data-2` ≈ 330 MB of Leaflet XYZ minimap tiles (≤ z17) plus ≈ 105 MB of legacy 3D-print series
(`print/`). Together that is ≈ 1.26 GB, so they cannot be merged into one site without cutting content. The
manifest references the tiles by absolute URL (contract "Public release" in `docs/data-contract.md`). What happens
to the legacy `print/` part (print work now lives in a separate private repository) is a **decision pending**.
The export fails (exit 2) when a hard limit is exceeded.

**Identity.** Commits in this repository and in the data staging clones are made as the GitHub **noreply**
identity, never a personal address: set `git config user.name` / `git config user.email` repo-locally in each
clone (`git config user.email <id>+<login>@users.noreply.github.com`) and check it before committing.

Everything for the data export is configured in `release.env` (org, host, repo names, AOI, `XYZ_MAX_ZOOM`,
limits, staging dir `../_release`, i.e. next to the checkout — never inside it).

## 1. App configuration (already in the code)

`SLE_PUBLIC=1 pnpm run build` (in `app/`) produces the public site; dev mode and the local build are unchanged.

| Env | Public default | Effect |
|---|---|---|
| `SLE_PUBLIC=1` | – | absolute base `SLE_BASE` (default `/saar-lidar-explorer/`), fills the `VITE_*` defaults below, copies **no** `public/data` into `dist/` |
| `VITE_DATA_URL` | `https://open-kirrberg.github.io/saar-lidar-data/` | manifest, chunks (decode worker), vectors (vector worker), pois, `shared/`, point clouds |
| `VITE_AOIS` | `overall` | AOIs this deployment has: no probes for others, AOI switcher hidden, `?aoi=` outside → `overall` |
| `VITE_VIEWER_URL` | `/saar-lidar-explorer/castle/` | castle viewer handover target (same origin is trusted); `off` hides „Schloss betreten“. Hidden anyway while the zone index offers the castle zone (its portal is the way in, ADR 0048); the handover is only the fallback when the zone is absent |
| `VITE_IMPRESSUM_URL` | – (unset) | optional http(s) link „Impressum“ in *Über & Datenschutz*; set the repo variable `SLE_IMPRESSUM_URL` |

Castle viewer (`zones/schloss-karlsberg/`): `VITE_EXPLORER_URL=/saar-lidar-explorer/` (default return target) and
`vite build --base /saar-lidar-explorer/castle/`. Its back-URL guard accepts local hosts and the page's own origin.
All URL logic is pure and unit-tested (`app/tests/publicBuild.test.ts`, `zones/schloss-karlsberg/viewer/tests/handover.test.ts`).
GitHub Pages sends `Access-Control-Allow-Origin: *`, so the cross-origin fetches (also from workers, which only
ever get absolute URLs) work.

## 2. Export the data

```bash
cd pipeline && ./run.sh overall          # if the data are not current
# print series (F21) now come from the separate sle-print repo, if any
scripts/release/export-data.sh           # → ../_release/saar-lidar-data, ../_release/saar-lidar-data-2
scripts/release/export-data.sh --dry-run     # list what would be written/deleted in both repos, change nothing
scripts/release/export-data.sh --zones-only  # stage only saar-lidar-data/zones/ (nothing else read, written or deleted)
scripts/release/export-data.sh --stats-only [--dry-run]  # stage only the stats-only AOIs (saarland/) + add `stats_levels`
                                             # to the staged overall/manifest.json (+ README/ATTRIBUTION/index.html)
scripts/release/export-data.sh --allow-deletes  # accept removing > RELEASE_MAX_DELETES staged files (default: refuse, exit 3)
```

Run `--dry-run` first when the staging repos hold changes you do not want to publish: a full run rewrites
them from `app/public/data`.

`--zones-only` never ships new **AOI layers**. When a code release starts using a new manifest key (e.g.
V2.4 `trees`), compare the local and the published `overall/manifest.json` keys and publish that layer too —
the V2.4 trees were missing on the live site until 2026-11-06 (data 8bf08d7: `overall/trees/` + only the
`trees` key added to the published manifest, pending candidate changes left untouched).

- **Symlinked inputs** (the v2 checkout links `overall/*`, `shared/`, `pois.geojson` from the
  `saar-lidar-explorer` checkout) are followed when they resolve inside the repo, `--src`, the castle terrain
  or `RELEASE_LINK_ROOTS` (release.env; default: the sibling `saar-lidar-explorer/app/public/data`). A link
  outside them, a dangling link or a loop **aborts** the export. (Before 2026-11-06 linked dirs were skipped
  and a full run would have deleted them from the staging repos.)
- **Delete guard**: when a run would remove more than `RELEASE_MAX_DELETES` (default 20) already-staged files
  from one repo, it writes nothing and exits **3**, listing the affected folders (`--dry-run` reports the same
  and also exits 3). Find the missing source first; pass `--allow-deletes` only when the removals are intended
  (`--max-deletes N` sets the limit for one run). Example from the v2 checkout: it has no `print/`
  (print series now come from the sle-print repo), so a full run would remove `print/` from `saar-lidar-data-2`.

Idempotent (copies only changed files, deletes files that are no longer planned, never touches `.git/`).
Size report: `../_release/data-size-report.txt`. What it does:

- `overall/` → repo 1, except `xyz/`; `manifest.json` rewritten (`xyz.*.url` absolute into repo 2, `maxZoom` ≤
  `XYZ_MAX_ZOOM`, `tileCount`/`bytes` recounted, `release` note). Tiles ≤ z17 → repo 2.
- `pois.geojson`, `shared/**` → repo 1; `zones/schloss-karlsberg/viewer/public/terrain/` → repo 1 `castle-viewer/terrain/` + `SHA256SUMS`.
- `print/*.json` and per series `index.json` (without `files.stl`), `*.3mf`, `*.png`, `keys/`, `printer/` → repo 2.
  Tile STLs are not published.
- **F22: UXO candidate classes are stripped** (`crater`, `crater_field` from saar-lidar-detect are private): features
  removed from `candidates.geojson`, manifest `counts`/`classes`/`params.crater_threshold`/crater versions and detectors
  dropped, `featureCount` recomputed, mask PNGs rewritten with codes 6/7 → 0 (stdlib PNG codec; a non-8-bit-grey mask
  aborts the export). The log prints how many were removed. The explorer ignores them in every build (bundle guard).
  Mask chunks left empty are dropped (with their `mask.chunks` entry); a crater-only primary `method` is renamed.
  Of `candidates/` only the manifest's GeoJSON and mask chunks are staged; saar-lidar-detect side files in the AOI dir
  (`run.json`, `report*.html`, `eval*`, `fachbericht*`, `manifest.json.bak-*`, `*.sld-new/`) are never staged, and the
  export **aborts** if a staged AOI text file still contains `crater`/`Bombentrichter`/`Trichterfeld`.
- **Zone packages** (`app/public/data/zones/` → repo 1 `zones/`): only the zones in `RELEASE_ZONES` (release.env,
  default `schloss-karlsberg,baeckerei-heusser`) **and** cleared in `PUBLIC_ZONE_POLICY` (export_data.py). Per zone:
  `zone.json` plus only the files its assets and `twin.catalogue` reference under the cleared prefixes (bakery:
  `built/` = twin, nav floor, visitor catalogue) or, for a module zone, the exact `moduleFiles` its code fetches
  (castle, [ADR 0048](../../docs/adr/0048-castle-zone-public.md): `terrain/` 1789 grids + `meta.json`, the 8 Poly Haven
  CC0 texture sets as `textures/<set>/{diff,nor_gl,arm}.jpg`; ≈ 8 MB; all must exist, other files stay local).
  Image files are staged only where the policy allows images (castle JPEGs; their APPn/COM metadata is scanned). Assets with
  `role: "reference"` are dropped from `zone.json` (with `twin.referenceScale`; `budget.totalBytes` recounted),
  `scene/` and any other local file are never staged (the photogrammetry capture is local-only,
  [ADR 0043](../../docs/adr/0043-built-twin-package-reference-nav.md)). `zones/index.json` lists only the staged
  zones. The export validates the public `zone.json` and catalogue (`pipeline/zones.py`) and **aborts** when a
  staged zone file names a local path (`/Users/…`), the private material folder or an e-mail address (GLBs:
  their JSON chunk incl. node names and extras) or a GLB embeds images where the policy forbids them (bakery:
  no textures, ADR 0042). Run the `bh-datenschutz` checklist first and tick it in the release notes.
- **Orte im Vergleich + historic forest + tree species** ([ADR 0049](../../docs/adr/0049-orte-im-vergleich-places-only.md),
  contract „Place statistics“ / „Historic forest mask“ / „Tree species“): of `overall/stats/` only `places.json` +
  `places.geojson` (manifest key `stats`, `sle-stats-v1`), of `overall/forest_hist/` only `forest_hist.png` (key
  `forest_hist`, `sle-forest-hist-v1`) and of `overall/species/` only `species.png` (key `species`, `sle-species-v1`)
  are staged; review reports and work files there never are. A key naming a missing file, a
  path outside its folder or a JSON naming a local path **aborts**; a key with another `format` is dropped with its
  folder. **Licence audit** (record in `AUDIT.md`): aggregates per Gemarkung / Gemeinde only (no parcel, building or
  owner data; groups < 5 suppressed), derived from ALKIS, LiDAR DGM/DOM, DOP20 RGB/CIR/RGBI and LoD2 of
  GeoBasis-DE/LVGL-SL and GeoBasis-DE/LVermGeoRP (dl-de/by-2-0, Daten bearbeitet), OSM (ODbL), **Zensus 2022**
  (© Statistische Ämter des Bundes und der Länder, dl-de/by-2-0) and the **Marktstammdatenregister**
  (© Bundesnetzagentur, dl-de/by-2-0); the forest mask from the historic maps of GeoBasis-DE/LVGL-SL
  (dl-de/by-2-0, Daten bearbeitet). **Tree species** (`species/species.png` and the species / age values in
  `places.json`): DLR EOC *Tree Species Germany* 2022 (Wegler et al. 2025, doi:10.15489/smh8w3j8i962), **CC BY 4.0**:
  publishing the reprojected PNG is allowed with the credit and the note „Daten bearbeitet (umprojiziert)“ (both in
  the manifest `attribution`); no personal data. **Thünen cross-check** (`species.crossCheck` in the manifest:
  agreement numbers only, no Thünen pixel): Thünen-Institut, Dominant Tree Species for Germany 2017/2018 (Blickensdörfer et al. 2024, doi:10.3220/DATA20221214084846), **CC BY 4.0**; the
  credit „Abgleich Baumarten: Thünen-Institut …“ is in `crossCheck.attribution` and the manifest `attribution` (audited
  2026-11-08, Phase 1 review round 2). **Artenvielfalt** (`biodiversity` in `places.json`): only counts
  per place from the GBIF occurrence search (`GBIF.org (<query date>) GBIF Occurrence Search`), no record,
  coordinate or species name; the records are CC0 / CC BY 4.0 / CC BY-NC 4.0 (iNaturalist research grade is mostly
  CC BY-NC: counts of them are facts, not a copy of the records, and the `note_de` says so). GBIF asks for a
  DOI-backed *derived dataset* citation for published results; registering one needs a GBIF account — decide before
  the release (tick in `AUDIT.md`). The yield tables of the age estimate are literature values (cited, not copied
  as a dataset). All credits are in the manifest `attribution` and thus in `ATTRIBUTION` / README. Publishing them needs the user's go (plan „Orte im Vergleich“ §8, last Phase 0 box); with
  `--zones-only` these keys are not shipped (see above: publish `stats/`, `forest_hist/`, `species/` and the three
  manifest keys).
- **Stats-only AOIs** ([ADR 0051](../../docs/adr/0051-leaderboard-levels-gemeinden-ortsteile.md), contract „Place
  statistics“ → „Gemeinde level“, revision 2.4): every AOI in `RELEASE_STATS_AOIS` (release.env, default `saarland`) goes to
  repo 1 as `<aoi>/manifest.json` (byte-identical) + the two files its `stats` key names (`stats/places.json`,
  `stats/places.geojson`, ≈ 300 KB together); work files, review reports or anything else in the AOI dir are never staged.
  The export **aborts** when the manifest is not `kind: 'stats-only'`, names another AOI, carries any key besides
  `version kind aoi name crs stats stats_levels attribution` (tiles, layers, work data), has no valid `stats` key, a stats
  file is > 1 MB, or the privacy guard finds something (cheap mirror of the pipeline's `check_privacy`: parcel / owner /
  address / person keys or parcel-id- / address-like values, outline properties other than `id` + `name_de`, and on the
  Gemeinde level `riesen` / `tallest` tree positions or `biodiversity` with anything but numbers). Above the contract
  targets (places.json 160 KB, outlines 200 KB) it warns. **`stats_levels`** (in the tile AOI and the stats-only manifest)
  may only point at staged AOIs that hold that level; other entries are dropped, and with fewer than two levels left the
  key is dropped (so a run with `RELEASE_STATS_AOIS=` publishes no dangling level switch).
  **`--stats-only`** is the release path while `overall` has unpublished local changes (pending candidate restage, xyz
  rewrite): it stages only `saarland/` and adds **only** `stats_levels` from the local `overall/manifest.json` to the
  manifest already staged in repo 1, keeping its serialisation, so the diff is that one key (the log prints added /
  removed / changed keys and the local keys that stay unpublished). Check out the published HEAD of
  `overall/manifest.json` in the staging clone first (`git -C ../_release/saar-lidar-data checkout -- overall/manifest.json`)
  when it holds unwanted changes. Besides the key it adds only the BKG VG25 credit to that manifest's `attribution`
  (when the local one carries it; the app's „© Quellen“ reads it). README.md / ATTRIBUTION / index.html are regenerated (BKG VG25 credit, `saarland/` row,
  BKG + CC BY 4.0 linked on the landing page as the BKG requires for web pages).
- Both: `.nojekyll`, `README.md` (contents, licences, the **candidates are unverified hypotheses** note,
  „Schauen, nicht graben“), `ATTRIBUTION`, `index.html` landing page linking to the app.

### Licence audit S1 „Gemeinden im Vergleich“ (`saarland/`, 2026-11-08, not published yet)

Aggregates per Gemeinde only (52 SL + Zweibrücken, Bechhofen); no parcel, building, tree position or person data
(`check_privacy` in the pipeline, the export guard above). Inputs and their credits — all present in
`saarland/stats/places.json` `inputs` and in the `saarland/manifest.json` `attribution` (a test checks every input credit
is in the manifest string, which feeds `ATTRIBUTION` / README / index.html):

| Input (`inputs` id) | Licence | Credit (verbatim, from the pipeline) | Audit |
|---|---|---|---|
| BKG VG25 Gemeindegrenzen (`vg25`) | **CC BY 4.0** | `© BKG (2026) CC BY 4.0 (Daten verändert), Datenquellen: https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg25.pdf (VG25)` (`ATTRIBUTION_VG25`, `pipeline/gemeinden.py`) | BKG's required Quellenvermerk (gdz.bkg.bund.de VG25 page, checked 2026-11-08): „© BKG (Jahr des letzten Datenbezugs) CC BY 4.0, Datenquellen: https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg25.pdf“, with BKG's own Veränderungshinweis „(Daten verändert)“ after the licence (page „Hinweise zu Nutzungsbedingungen und Quellenvermerken“) since the outlines are dissolved per AGS and simplified to 50 m; ` (VG25)` is the project's layer tag. On web pages „BKG“ links to https://www.bkg.bund.de and „CC BY 4.0“ to the licence: done on the data landing page (export template); **the app's „© Quellen“ row does not link them yet** (open item 2). The old credit (`sg.` host, no change note) is in `ATTRIBUTION_VG25_SUPERSEDED` and replaced wherever a manifest carries it. |
| Zensus 2022 municipality totals (`zensus_gemeinden`) | dl-de/by-2-0 | `Zensus 2022, © Statistische Ämter des Bundes und der Länder, dl-de/by-2-0, Daten bearbeitet` | ok (same credit as the published `overall` stats) |
| Marktstammdatenregister (`mastr`) | dl-de/by-2-0 | `Marktstammdatenregister – © Bundesnetzagentur für Elektrizität, Gas, Telekommunikation, Post und Eisenbahnen, dl-de/by-2-0, Daten bearbeitet` | ok (as published) |
| DLR Tree Species Germany 2022 (`species_dlr`) | CC BY 4.0 | `Baumarten: DLR, Tree Species Germany 2022 (Wegler et al. 2025), CC BY 4.0, doi:10.15489/smh8w3j8i962, Daten bearbeitet (umprojiziert)` | ok; only cell shares per Gemeinde, no pixels |
| GBIF occurrence search (`gbif`) | records CC0 / CC BY 4.0 / CC BY-NC 4.0 | `GBIF.org (2026-11-08) GBIF Occurrence Search, https://www.gbif.org` + `note_de` (iNaturalist CC BY-NC) | counts only (guard: `biodiversity` numbers only); DOI-backed derived dataset still **open** (user decision 2026-11-08: publish with the plain credit, register the DOI later) |
| LoD2 / LiDAR SL + RLP (`lod2_*`, `lidar_*`) | dl-de/by-2-0 | as in `overall` | only once S1b values exist (statewide run in progress); re-check `inputs` before the release |

Open items before the go: (1) done 2026-11-08: BKG wording + change note in `ATTRIBUTION_VG25`; `gemeinden_stats.py`
writes the VG25 credit into `overall`'s `attribution` next to `stats_levels` (idempotent, also `--levels-only`), and
`--stats-only` adds exactly that line (pattern `STATS_ONLY_ATTRIBUTION`) to the staged manifest. The local `saarland/`
files keep the old credit until the statewide chain re-runs `gemeinden_stats.py`; until then ATTRIBUTION lists both VG25
lines (the export warns) — re-run the dry run afterwards. (2) App: „© Quellen“ renders the BKG entry through the
generic row (provider text „BKG (2026) CC BY 4.0 (Daten verändert)“, no licence link, not marked as modified, no
bkg.bund.de link) — needs a BKG branch in `rowFromEntry` (`app/src/shell/attribution.ts`). (3) GBIF DOI (above).
(4) Re-run the dry run after the S1b run and confirm the new `inputs` (LoD2, LiDAR) are in the manifest `attribution`.

## 3. Release the code

The code is released by pushing this repository; there is no separate code export any more.

```bash
.claude/skills/sle-roadmap/scripts/verify.sh   # all gates must pass
git status                                     # clean; only reviewed commits
git push origin main                           # → .github/workflows/pages.yml builds and deploys
```

- **Data first:** when the code depends on new or changed data, export and push the data repos (§2, §4) before
  pushing the code, so the deployed site never points at data that are not live yet.
- **Leak scan (recommended before a push):** run `secret_scan.py` on a copy of the committed tree, never on the
  checkout itself (it rewrites the files it scans):
  `T=$(mktemp -d) && git archive HEAD | tar -x -C "$T" && python3 -I scripts/release/secret_scan.py "$T" --repo-root "$PWD"`.
  "Neutralised local paths" and HIGH must both be *none*; review the INFO list (e-mails, home paths).
- Why no export any more: in v1 the local history contained candidate coordinates and private work, so the public
  repository was a fresh-history export (`export-code.sh` → `../_release/saar-lidar-explorer`). v2 is developed
  directly in the public repository, so the script, its exclude list and its templates were removed (2026-11-06).

The workflow builds the explorer (`pnpm install --frozen-lockfile`, tests, `SLE_PUBLIC=1` build), then the standalone
castle viewer into `app/dist/castle/` (kept as the handover fallback and for direct links; the explorer enters the
castle as a zone, ADR 0048): textures via `scripts/fetch-textures.sh` (Poly Haven CC0, md5-checked, cached by
`actions/cache`), terrain from `<VITE_DATA_URL>castle-viewer/terrain/` (sha256-checked). If that step fails, the
explorer is rebuilt with `VITE_VIEWER_URL=off` (no handover) so the site still deploys. Repository variables
`SLE_DATA_URL`, `SLE_AOIS`, `SLE_IMPRESSUM_URL` override the defaults without a code change.

## 4. Publish the data (the lead / the user — not the scripts)

```bash
# first time only (create the repos empty in the org first; public; set the noreply identity, see "Identity")
cd ../_release/saar-lidar-data   && git init -b main && git add -A && git commit -m "Data: overall AOI" \
  && git remote add origin git@github.com:Open-Kirrberg/saar-lidar-data.git && git push -u origin main
cd ../saar-lidar-data-2          && git init -b main && git add -A && git commit -m "Data: tiles + 3D print" \
  && git remote add origin git@github.com:Open-Kirrberg/saar-lidar-data-2.git && git push -u origin main
# Settings → Pages → "Deploy from a branch", main, / (root)   (both data repos)
# code repo (this repository): Settings → Pages → Source "GitHub Actions"
```

Order: data repos first (the workflow downloads `castle-viewer/terrain/` from repo 1). Each data push is < 1 GB
(GitHub's push limit is 2 GB). Later data updates: re-run `export-data.sh`, then `git add -A && git commit && git push`
in the staging repos (keep their `.git/`; the export never deletes it). History grows with every data update — for
large refreshes, prefer a fresh orphan commit (`git checkout --orphan new && git commit && git branch -M main && git push -f`).

## 5. Checks before publishing

- `.claude/skills/sle-roadmap/scripts/verify.sh` passes; `pnpm run test` in `app/` and `zones/schloss-karlsberg/`.
- `../_release/data-size-report.txt`: no FAIL; leak scan (§3): neutralised paths and HIGH none, INFO reviewed.
- Zones: `bh-datenschutz` checklist (`zones/baeckerei-heusser/.claude/skills/bh-datenschutz/SKILL.md`) on the staged
  `zones/` files; in the smoke test enter the bakery and open a product card, enter the castle through its portal
  (loading bar → Rundflug → *Verlassen* restores the overworld) and check that „Schloss betreten“ (T, handover) is
  not offered next to the portal.
- `../_release/AUDIT.md`: licence + heritage audit.
- Local smoke test of the public build against the staged data: build with
  `SLE_PUBLIC=1 VITE_DATA_URL=http://127.0.0.1:5271/saar-lidar-data/`,
  serve the site under `/saar-lidar-explorer/` on one port and `../_release` with `Access-Control-Allow-Origin: *` on
  another (the minimap tiles still point to github.io until the data are live).

## 6. Places and catalog (S3, plan „Orte skalieren“, ADR 0052)

From S3 on, the data are built **in GitHub Actions** of three more repositories in the org, never committed and
never staged by `export-data.sh`:

| Repository | Pages | Content | Built by |
|---|---|---|---|
| `ort-vorlage` (public, **template repository**) | none (its build job is skipped in the template itself) | `ort.toml` (`sle-ort-v1`), caller workflows, content checks (`werkzeuge/ort_check.py`, JSON schemas, tests), issue forms, `CONTRIBUTING.md`, devcontainer, skill `ort-pflegen`; code MIT, content CC BY 4.0 / CC0 (`LIZENZEN.md`) | – |
| `ort-homburg` (public, from the template) | GitHub Actions → `https://open-kirrberg.github.io/ort-homburg/` | `ort.toml` + community content; the site = the v3 place build (`manifest.json` …) + `inhalte/`, `aktionen/` | `.github/workflows/build.yml` → this repo's reusable `build-place.yml` at a pinned SHA |
| `orte-katalog` (public) | GitHub Actions → `https://open-kirrberg.github.io/orte-katalog/` | `orte.toml` (place status / hosting), `daten.toml` (pinned data bundle); the site = `catalog.json`, `overview/`, `saarland/`, `ortsteile/` | `.github/workflows/build.yml` (pipeline checked out at a pinned SHA) + the data bundle release asset |

Layout of both sites: data contract „Hosting (Revision 3.2, S3)“. Build commands: `pipeline/place.py`,
`pipeline/katalog.py` (pipeline/README.md „S3“).

**Why the catalog uses a release asset.** The overview needs ≈ 2 800 DGM1 tiles (≈ 11 GB) and the Gemeinde
leaderboard DGM1 + DOM1 (≈ 22 GB, ≈ 90 min download). A runner has ≈ 14 GB free disk, `actions/cache` holds 10 GB
per repository and evicts entries unused for 7 days, so a rarely run catalog workflow would re-download the whole
state from LVGL every time (R8). The maintainer therefore computes the statewide products locally (`./run.sh
saarland`, `./run.sh orte`, `./run.sh orte-katalog`, all cached) and publishes them as one tar
(`katalog.py bundle`, ≈ 170 MB, `sle-katalog-bundle-v1`) on an orte-katalog release; `daten.toml` pins its SHA-256.
The workflow downloads only that asset from GitHub, recomputes the tile ownership from the bundled VG25 outlines
(fails if it differs from the bundle's), builds `catalog.json` from `orte.toml` and deploys. Leaderboard numbers come
only from the bundle (R3).

**Place builds.** One build per place at a time (`concurrency`), triggered by a push that changes `ort.toml`,
content or the pinned workflow ref, or by hand — never on a schedule. Raw downloads (fetch set = owned tiles + 8
neighbours, LAZ of the opted-in areas, LoD2, DOP20 WMS, Overpass) are kept in `actions/cache` under a key of tile
list + `place.SOURCE_VERSIONS` (bump an entry for a new official flight). The finished data build is cached under a
key of pipeline version + ref + owned tiles + options, so a content-only push re-deploys without any download or
compute. The User-Agent names the pipeline version, the project URL and the calling repository
(`SLE_UA_CONTEXT`, no personal data). Cadastre (WFS 414) and historic maps (Geoportal WMS) are optional steps: on a
service outage the site ships without them and the job summary says so. Homburg's `detect` peaks at ≈ 17 GB RSS (runner: 16 GB RAM), so the
workflow adds swap before the build (input `swap_gb`, default 16); measured numbers in pipeline/README.md „S3“.

### Dry run before pushing

```bash
scripts/release/dry-run-orte.sh                    # → ../_orte-dryrun (katalog bundle + site, then ort-homburg)
scripts/release/dry-run-orte.sh --only katalog     # catalog part only (seconds)
scripts/release/dry-run-orte.sh --fresh-downloads  # Homburg without reusing the homburg-gemeinde WMS/WFS caches
```

It runs the workflows' commands against the sibling checkouts `../ort-homburg`, `../orte-katalog` with the shared
raw cache `data/raw/` (never deleted), reports time, peak memory, site / work sizes and warns when the working tree's
pipeline differs from the SHA the place repo pins or when the bundle's SHA-256 differs from `daten.toml`.

### First release (the user; nothing here is pushed by the scripts)

1. Push this repository (`git push origin main`): the place and catalog repos pin a commit of it
   (`build-place.yml` + `pipeline/` at that SHA must be on GitHub).
2. **orte-katalog:** create the repository, push, upload the data bundle (`gh release create …`, tag and asset as in
   `daten.toml`), Settings → Pages → Source „GitHub Actions“, run the workflow.
3. **ort-vorlage:** create, push, mark as template repository.
4. **ort-homburg:** create, push, Pages source „GitHub Actions“, run the workflow (first run downloads the fetch set,
   later runs use the cache). Check `https://open-kirrberg.github.io/ort-homburg/manifest.json`.
5. Re-run the orte-katalog workflow: it now finds Homburg's manifest and copies `pipeline` / `manifest_version`.
6. Smoke test the app in catalog mode against the live catalog (local build with
   `VITE_CATALOG_URL=https://open-kirrberg.github.io/orte-katalog/catalog.json`), then set the repository variable
   `SLE_CATALOG_URL` of this repository and re-run `pages.yml` to switch the public app to catalog mode.

**Pipeline bump in a place repo:** one pull request that changes `uses: …/build-place.yml@<sha>`, `pipeline_ref`
and `pipeline_version` together (the build fails with a clear message when version and ref disagree); same for
`PIPELINE_REF` / `PIPELINE_VERSION` in orte-katalog. Tag explorer commits that place repos pin (`pipeline-v0.9.1`)
so the pins are readable.

## 7. Transition: retiring `saar-lidar-data` / `-2` (plan D8)

The two branch-deployed data repos stay online, unchanged, during the transition:

- The public app keeps single-AOI mode (`VITE_DATA_URL` = saar-lidar-data) until step 6 above; links with
  `?aoi=overall` keep working afterwards because the data stay.
- Still served **only** from `saar-lidar-data`: the zone packages (`zones/`: Schloss Karlsberg, Bäckerei Heusser —
  they stay there in S3, `ort-homburg/zones/README.md`), `castle-viewer/terrain/` (read by `pages.yml`),
  `pois.geojson`, `shared/` (reconstruction 1789). The app reads them from `VITE_DATA_URL` in both modes.
- `saar-lidar-data-2` holds the minimap XYZ tiles of `overall` and the legacy print series.

Retire them only when all of the following hold: (a) catalog mode has been live for ≥ 4 weeks without data issues;
(b) zones, castle terrain, `pois.geojson` and `shared/` have a new home (zone packages from the place repo once the
zone contract allows it; the rest e.g. in the explorer's own site or the catalog site) and `VITE_DATA_URL` points
there; (c) no app release still reads `overall` by default. Then: replace each repo's README / `index.html` with a
pointer to the new sites, archive the repositories (read-only, history kept), keep Pages on for another three months,
then switch Pages off. Never force-push or delete them.
