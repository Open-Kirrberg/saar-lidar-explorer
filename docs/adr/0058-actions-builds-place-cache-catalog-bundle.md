# 0058 · 🏗️ Place and catalog builds in GitHub Actions: pinned reusable workflow, cached builds, catalog data bundle

- **Status:** Accepted · 2026-11-09 (repositories pushed 2026-11-08; prepared locally in S3)
- **Origin:** [plan „Orte skalieren“](../plans/orte-skalieren.md) §4.4, §7, §8, §9 S3 · user, 2026-11-08: repos `ort-vorlage`, `ort-homburg`, `orte-katalog` under Open-Kirrberg · builds on [0052](0052-one-repo-per-municipality-central-catalog.md), [0053](0053-relict-candidates-opt-in-new-places.md), [0055](0055-global-grid-tile-ownership-central-overview.md)

## Context
[0052](0052-one-repo-per-municipality-central-catalog.md) decided that place data are built in Actions and never committed. Open were: how a place repo pins the pipeline, how often it may touch the public download services (R8), how community-content pushes avoid rebuilding terrain, and how the catalog gets its statewide products, which need ≈ 11 GB (overview: DGM1 of ≈ 2 800 tiles) to ≈ 22 GB (leaderboard trees: DGM1 + DOM1) of raw data — more than a runner's ≈ 14 GB free disk and the 10 GB per-repo `actions/cache`, which also evicts entries unused for 7 days.

## Decision
- **Place repos call one reusable workflow** of the explorer (`build-place.yml`) at a **pinned commit SHA**, with the matching `pipeline_ref` and `pipeline_version` inputs; a mismatch fails the build. A pipeline bump is a reviewed pull request in the place repo. `ort.toml` (`sle-ort-v1`) is the only build configuration; ownership comes from the published catalog, never from the place.
- **Two caches per place:** raw downloads keyed on the fetch set + source versions (a new official flight = one bumped constant), and the finished data build keyed on pipeline version + ref + owned tiles + build options. Content-only pushes restore the data build and only re-stage `inhalte/` / `aktionen/`. Builds run only on a change (ort.toml, content, workflow pin) or by hand, one per place at a time.
- **Geoportal steps are optional** (cadastre WFS, historic WMS): an outage yields a site without parcels / historic maps and a warning, not a failed deploy. Every other step is required.
- **The catalog's statewide products ship as a data bundle** (`sle-katalog-bundle-v1`: overview, both leaderboard levels, the VG25 outlines, the ownership it was built with), computed by a maintainer with the explorer pipeline and uploaded as a release asset of `orte-katalog`, pinned by SHA-256 in `daten.toml`. The catalog workflow downloads nothing from public services: it recomputes the ownership from the bundled outlines (must equal the bundle's), builds `catalog.json` from `orte.toml` and deploys.
- **Community content is checked twice** (the place repo's `ort_check.py` on every pull request and again before each build) and published unchanged next to the data; the app does not read it before S5.

## Consequences
- ✅ A place build is reproducible from its repo alone; public services see each place's fetch set about once per cache lifetime, the catalog never.
- ✅ Leaderboard numbers and tile ownership stay central (R3); a place repo cannot change them.
- ⚠️ A place repo idle for > 7 days loses its caches: its next build (also content-only) downloads the fetch set again (Homburg ≈ 1.3 GB LiDAR + ≈ 0.9 GB DOP20 + LAZ). Acceptable at a few builds per month; revisit with many places (e.g. a shared raw mirror).
- ⚠️ The data bundle is a manual maintainer step; it goes stale until someone rebuilds it (new flight, new VG25 edition, new discipline).
