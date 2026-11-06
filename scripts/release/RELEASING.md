# Releasing to GitHub Pages (Open-Kirrberg)

The public release ([ADR 0012](../../docs/adr/0012-github-pages-release.md), user decision 2026-11-02) consists of three
GitHub repositories in the org **Open-Kirrberg**, all served by GitHub Pages under `https://open-kirrberg.github.io/`:

| Repository | Pages | Content | Built by |
|---|---|---|---|
| `saar-lidar-explorer` (public, MIT; **this repository**, developed here directly) | GitHub Actions (`.github/workflows/pages.yml`) → `/saar-lidar-explorer/` + standalone castle viewer `/saar-lidar-explorer/castle/` (fallback, [ADR 0048](../../docs/adr/0048-castle-zone-public.md)) | code + `LICENSE`, `NOTICE.md` | `git push origin main` |
| `saar-lidar-data` | branch deploy (`main`, `/`), `.nojekyll` | AOI `overall` without Leaflet tiles, `pois.geojson`, `shared/` (reconstruction 1789), `castle-viewer/terrain/`, `zones/` (cleared zone packages: castle, bakery) | `export-data.sh` |
| `saar-lidar-data-2` | branch deploy (`main`, `/`), `.nojekyll` | Leaflet XYZ tiles (≤ z17), 3D-print series (3MF only) | `export-data.sh` |

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
- Both: `.nojekyll`, `README.md` (contents, licences, the **candidates are unverified hypotheses** note,
  „Schauen, nicht graben“), `ATTRIBUTION`, `index.html` landing page linking to the app.

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
