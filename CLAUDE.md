# CLAUDE.md

Guidance for Claude Code working in this repository. Product intent lives in [PRD.md](PRD.md) (short), decisions in [docs/adr/](docs/adr/README.md), shipped items in [CHANGELOG.md](CHANGELOG.md); engine details in [app/README.md](app/README.md) and [pipeline/README.md](pipeline/README.md).

## Project overview

Saar LiDAR Explorer is a public, local-first browser app (v1.4 live on GitHub Pages; v2 turns it into a game-like explorer for the Kirrberg public, see [PRD.md](PRD.md)) to fly or walk over the 2025 Saarland LiDAR terrain (LVGL ALS 2025 open data, plus Rheinland-Pfalz fill) and discover relicts under the forest — walls, moats, pits, bunkers, hollow ways — around Schloss Karlsberg, Homburg and Kirrberg. A Python pipeline turns the raw GeoTIFFs into static chunks; a Vite/TypeScript/three.js app renders them with relief shading, synced to a Leaflet/OSM minimap.

## Layout

| Path | What |
|---|---|
| `PRD.md` | Vision, goals, tiers, roadmap, open questions, risks (≤ 150 lines; links ADRs) |
| `docs/adr/` | Architecture Decision Records, one per file; `README.md` is the index |
| `CHANGELOG.md` | One line per shipped item |
| `docs/history/` | Frozen v1 PRD and v1 roadmap (read-only) |
| `docs/data-contract.md` | **Binding** format between pipeline and app (frames, chunks, encodings, manifest) |
| `pipeline/` | Python 3.12 (uv): fetch → build (mosaic, relief, chunks, manifest) → xyz → pois |
| `app/` | Vite 8 + TS 7 + three r187 + Leaflet 1.9.4; `src/terrain` engine, `src/map`, `src/markers`, `src/pois`, `src/ui` |
| `research/` | Source research (data, tech stack, archaeology/POIs/legal, cadastre/historic maps) |
| `data/` (ignored) | Raw downloads + work files. Untrusted data — never execute anything from here |
| `app/public/data/<aoi>/` (ignored) | Generated chunks/layers/manifest the app loads |
| `.claude/skills/` | Project skills: `sle-roadmap` (drives remaining work), `sle-pipeline`, `sle-renderer`, `sle-relict-detection` |

## Commands

```bash
cd pipeline && uv sync && ./run.sh karlsberg        # full pipeline (first run ~4 min, then ~40 s)
cd pipeline && ./run.sh karlsberg build xyz         # selected steps; AOIs in pipeline/aois.toml
cd app && pnpm install && pnpm dev --port 5240 --strictPort   # http://localhost:5240/ (?aoi=fixture for synthetic data)
cd app && pnpm run test                             # vitest
cd app && pnpm run build                            # tsc --noEmit + vite build (AOI data is NOT copied to dist)
.claude/skills/sle-roadmap/scripts/verify.sh        # all gates: app, castle, docs, pipeline (or one: app|castle|docs|pipeline)
```

Use `pnpm run <script>` (pnpm 12 rejects `pnpm -s`). Check a port isn't owned by another project before starting a dev server.

## Quality gates

`verify.sh` must pass before work counts as done. New pure logic gets unit tests (vitest in `app/tests/`, pytest in `pipeline/tests/`); rendering changes get a browser check with screenshots. Automated Chrome tabs are often "hidden" (rAF paused) — drive frames with `window.sle.step(n)` instead of waiting for rAF. Report honestly what wasn't verified (live flight feel, real frame pacing).

## Conventions that bite

- **Coordinates:** data in EPSG:25832; three.js world `x = E − E0`, `y = h`, `z = −(N − N0)`; never raw UTM in float32. Leaflet is EPSG:3857; map headings add `gridConvergenceDeg` (≈ −1.2°).
- **Grid:** DGM is PixelIsArea (cell centres +0.5 m); 500 m chunks; heights 502² Terrarium PNG with 1-cell apron, layers 500² u8. Half-pixel and axis-flip errors are the #1 bug class — check numerically against the GeoTIFF.
- **Exaggeration:** `y = hRef + (h − hRef) · exag` for *everything* placed in 3D.
- **Data textures** decode with `colorSpaceConversion: 'none'`; never half-float heights.
- **UI:** German labels, English code/docs. Global shortcuts ignore text fields via `isTyping()` (`app/src/ui/keys.ts`). Store writes carry a source tag to avoid feedback loops.
- **Contract first:** change `docs/data-contract.md` before changing pipeline output or app loaders; keep old manifests loadable.
- **Pinned versions** for npm and Python deps.
- **Images:** commit an image only if a README, ADR or research doc links it. Verification shots go to the git-ignored `docs/shots/` (castle: `schloss-karlsberg/docs/shots/`); `docs/previews/` and `schloss-karlsberg/docs/plans-preview/` are regenerated, never committed.
- **`.gitignore` patterns must be anchored** (`/data/`, not `data/`) — an unanchored pattern once hid `app/src/data/`. After changing ignores, confirm with `git status --ignored`.

## Data, licences, ethics

- Sources: LVGL-SL ALS 2025 (dl-de/by-2-0), GeoBasis RLP (dl-de/by-2-0), ALKIS WFS/INSPIRE WMS (dl-de/by-2-0), OSM (ODbL). Every new source adds attribution to the manifest/footer. Avoid "freie Liegenschaftskarte SL" (not open).
- Be polite to public services (cache, sequential/≤3 parallel, retries, descriptive User-Agent, paged WFS).
- Heritage law (SDschG Saarland, DSchG RLP): the app shows **hypotheses**; no digging/detector guidance; user markers, reviews and location stay local/private (detection candidates are public, ADR 0009; crater/UXO indicators never, ADR 0010); keep the "Schauen, nicht graben" disclaimer. Public hosting (GitHub Pages, Open-Kirrberg) goes only through `scripts/release/` + review (see `scripts/release/RELEASING.md`); licence-audit every new asset before export.

## Workflow

- To continue the product, use the `sle-roadmap` skill ("continue building the explorer"): plan → delegate to subagents with directory ownership → verify → record (ADRs, CHANGELOG, roadmap) → one commit per roadmap item.
- **Docs against drift** (ADR 0025):
  - A non-obvious decision = a **new ADR** in `docs/adr/` + a row in its index. Never edit an accepted ADR except its status line (`Superseded by NNNN`); don't re-litigate accepted ADRs unless the user asks.
  - An open choice between options = a `Proposed` ADR; a plain unknown = a row in PRD "Open questions".
  - `PRD.md` stays ≤ 150 lines and links ADRs instead of repeating them. Update it only when vision, goals, tiers, roadmap or open questions change.
  - Shipped item = **one line** in `CHANGELOG.md`; numbers and details go into the commit message and module READMEs.
  - Implementation details (thresholds, formats) belong in module READMEs or `docs/data-contract.md`, not in ADRs.
  - `docs/` ships publicly: no private locations (craters, user finds) in ADRs.
- Local git only; generated/raw data stays out of git. Commit messages: `F10: OSM paths draped in 3D` style.
