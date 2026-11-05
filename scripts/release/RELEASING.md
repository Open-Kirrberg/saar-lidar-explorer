# Releasing to GitHub Pages (Open-Kirrberg)

The public release ([ADR 0012](../../docs/adr/0012-github-pages-release.md), user decision 2026-11-02) consists of three
GitHub repositories in the org **Open-Kirrberg**, all served by GitHub Pages under `https://open-kirrberg.github.io/`:

| Repository | Pages | Content | Built by |
|---|---|---|---|
| `saar-lidar-explorer` (public, **fresh history**, MIT) | GitHub Actions (`.github/workflows/pages.yml`) → `/saar-lidar-explorer/` + castle viewer `/saar-lidar-explorer/castle/` | code (committed files only) + `LICENSE`, `NOTICE.md` | `export-code.sh` |
| `saar-lidar-data` | branch deploy (`main`, `/`), `.nojekyll` | AOI `overall` without Leaflet tiles, `pois.geojson`, `shared/` (reconstruction 1789), `castle-viewer/terrain/` | `export-data.sh` |
| `saar-lidar-data-2` | branch deploy (`main`, `/`), `.nojekyll` | Leaflet XYZ tiles (≤ z17), 3D-print series (3MF only) | `export-data.sh` |

Why two data repositories: a GitHub Pages site may be at most **1 GB** (every file < 100 MB). Measured 2026-11-02:
AOI `overall` = 1.47 GB (xyz 740 MB, of which z18 = 409 MB), print 3MF ≈ 0.4 GB, castle terrain 47 MB. Trimming the
tiles to z17 still leaves ≈ 1.5 GB, so the tiles and the print files moved to `saar-lidar-data-2` (the manifest
references the tiles by absolute URL; contract "Public release" in `docs/data-contract.md`). Both sites stay
under the 900 MB aim; the export fails (exit 2) when a hard limit is exceeded.

Everything is configured in `release.env` (org, host, repo names, AOI, `XYZ_MAX_ZOOM`, limits, staging dir
`../_release`, i.e. next to the checkout — never inside it).

## 1. App configuration (already in the code)

`SLE_PUBLIC=1 pnpm run build` (in `app/`) produces the public site; dev mode and the local build are unchanged.

| Env | Public default | Effect |
|---|---|---|
| `SLE_PUBLIC=1` | – | absolute base `SLE_BASE` (default `/saar-lidar-explorer/`), fills the `VITE_*` defaults below, copies **no** `public/data` into `dist/` |
| `VITE_DATA_URL` | `https://open-kirrberg.github.io/saar-lidar-data/` | manifest, chunks (decode worker), vectors (vector worker), pois, `shared/`, point clouds |
| `VITE_AOIS` | `overall` | AOIs this deployment has: no probes for others, AOI switcher hidden, `?aoi=` outside → `overall` |
| `VITE_VIEWER_URL` | `/saar-lidar-explorer/castle/` | castle viewer handover target (same origin is trusted); `off` hides „Schloss betreten“ |
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
```

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
- **Zone packages** (`app/public/data/zones/`) are not staged yet. When they are: for `baeckerei-heusser` stage only
  `zone.json` and `built/` (the built twin + nav floor), drop every asset with `role: "reference"` from `zone.json`
  and never stage `scene/` (the photogrammetry capture is local-only, [ADR 0043](../../docs/adr/0043-built-twin-package-reference-nav.md));
  run the `bh-datenschutz` checklist first.
- Both: `.nojekyll`, `README.md` (contents, licences, the **candidates are unverified hypotheses** note,
  „Schauen, nicht graben“), `ATTRIBUTION`, `index.html` landing page linking to the app.

## 3. Export the code

```bash
git status                                # commit first: only committed files are exported
scripts/release/export-code.sh            # → ../_release/saar-lidar-explorer (1st run: fresh repo, 1 commit;
                                          #   later runs keep its .git/ and add 1 update commit → fast-forward push)
RELEASE_MESSAGE="Fix: …" scripts/release/export-code.sh   # custom subject for the update commit
scripts/release/export-code.sh --fresh    # discard the staged history (needs a force push — avoid)
scripts/release/export-code.sh --worktree # dry run from the working tree (tracked + untracked, not ignored)
```

- `git archive HEAD`, minus `code-excludes.txt` (defensive list: local settings, `.env`, keys, data dirs,
  copyrighted video/sources dirs — all git-ignored today).
- Adds `LICENSE` (MIT, „Copyright (c) 2026 Open-Kirrberg“), `NOTICE.md` (licences of non-code content: screenshots
  with dl-de/by-2-0 data, CC BY-SA 2.0 DE Lageplan derivatives, public-domain 1805 map, HMS numbers only),
  `.github/workflows/pages.yml` (Node/pnpm = the versions on this machine unless `NODE_VERSION`/`PNPM_VERSION`
  are set; actions pinned by tag), and a „Live“ block under the README title.
- `secret_scan.py`: neutralises absolute local paths (repo root, `$HOME`, Claude scratch dirs) and scans for
  tokens, private keys, credential assignments, `.env`/key files, `.claude/settings.local.json` (HIGH → abort, no
  commit) and lists e-mail addresses / home paths for review (`../_release/secret-scan.md`).
- First run: `git init -b main` + one commit; later runs: one update commit on the kept `.git/` (no changes → no commit). Local identity (override: `RELEASE_GIT_NAME`, `RELEASE_GIT_EMAIL`, e.g. a
  GitHub noreply address). Never pushes.

The workflow builds the explorer (`pnpm install --frozen-lockfile`, tests, `SLE_PUBLIC=1` build), then the castle
viewer into `app/dist/castle/`: textures via `scripts/fetch-textures.sh` (Poly Haven CC0, md5-checked, cached by
`actions/cache`), terrain from `<VITE_DATA_URL>castle-viewer/terrain/` (sha256-checked). If that step fails, the
explorer is rebuilt with `VITE_VIEWER_URL=off` (no handover) so the site still deploys. Repository variables
`SLE_DATA_URL`, `SLE_AOIS`, `SLE_IMPRESSUM_URL` override the defaults without a code change.

## 4. Publish (the lead / the user — not the scripts)

```bash
# data repos (create them empty in the org first; public)
cd ../_release/saar-lidar-data   && git init -b main && git add -A && git commit -m "Data: overall AOI" \
  && git remote add origin git@github.com:Open-Kirrberg/saar-lidar-data.git && git push -u origin main
cd ../saar-lidar-data-2          && git init -b main && git add -A && git commit -m "Data: tiles + 3D print" \
  && git remote add origin git@github.com:Open-Kirrberg/saar-lidar-data-2.git && git push -u origin main
# Settings → Pages → "Deploy from a branch", main, / (root)   (both data repos)
cd ../saar-lidar-explorer && git remote add origin git@github.com:Open-Kirrberg/saar-lidar-explorer.git && git push -u origin main
# Settings → Pages → Source "GitHub Actions"
```

Order: data repos first (the workflow downloads `castle-viewer/terrain/` from repo 1). Each data push is < 1 GB
(GitHub's push limit is 2 GB). Later data updates: re-run `export-data.sh`, then `git add -A && git commit && git push`
in the staging repos (keep their `.git/`; the export never deletes it). History grows with every data update — for
large refreshes, prefer a fresh orphan commit (`git checkout --orphan new && git commit && git branch -M main && git push -f`).

## 5. Checks before publishing

- `.claude/skills/sle-roadmap/scripts/verify.sh` passes; `pnpm run test` in `app/` and `zones/schloss-karlsberg/`.
- `../_release/data-size-report.txt`: no FAIL; `../_release/secret-scan.md`: HIGH none, INFO reviewed.
- `../_release/AUDIT.md`: licence + heritage audit.
- Local smoke test of the public build against the staged data: build with
  `SLE_PUBLIC=1 VITE_DATA_URL=http://127.0.0.1:5271/saar-lidar-data/`,
  serve the site under `/saar-lidar-explorer/` on one port and `../_release` with `Access-Control-Allow-Origin: *` on
  another (the minimap tiles still point to github.io until the data are live).
