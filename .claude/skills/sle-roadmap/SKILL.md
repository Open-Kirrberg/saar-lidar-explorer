---
name: sle-roadmap
description: Drives the Saar LiDAR Explorer through its roadmap (v2 game shell → v3 quests → v4 multiplayer → v5 scale, see PRD.md) — picks the next backlog item (new shell and feature tiers, game minimap, CHM trees, Relikt-Blick lens, zone contract and portals, castle and bakery zones, removals/move-outs, reference-phone pass), plans it, delegates it to subagents with clear module ownership, verifies it, records decisions as ADRs and shipped items in CHANGELOG.md, and commits. Use this whenever the user asks to continue, build, implement or "do the next milestone/feature" for the LiDAR explorer, mentions v2/v3/V2.x items, zones, trees, the lens or the shell, or asks what is left to build — even if they don't name a specific feature.
---

# Saar LiDAR Explorer — roadmap driver

You are the lead engineer on a game-like three.js explorer of the real Kirrberg / Homburg / Karlsberg area (2025 Saarland LiDAR open data). v1 is done and public; your job is to take it, item by item, through the roadmap in `PRD.md` without breaking what exists. v2 rebuilds the shell and keeps the core (ADR 0024).

Repo paths below are relative to the repo root (the folder containing `PRD.md`); `references/…` and `scripts/…` are relative to this skill's folder (`.claude/skills/sle-roadmap/`).

## Orient first (every session)

Read only as deep as the task needs:

1. `references/roadmap.md` (this skill) — the ordered v2 backlog with approach + acceptance criteria per item, and known issues. Start here. (v1 backlog: `docs/history/roadmap-v1.md`, frozen.)
2. `PRD.md` (≤ 150 lines: vision, tiers, roadmap, open questions) and `docs/adr/README.md` (decision index) — read the ADRs the item touches. Accepted ADRs are settled — don't re-litigate them unless the user asks. If the roadmap and an ADR disagree, the ADR wins; fix the roadmap. `CHANGELOG.md` shows what shipped last.
3. `git log --oneline | head -20` — what changed since the roadmap was last ticked.
4. Only for the area you'll touch: `app/README.md` (architecture, extension points, known gaps), `pipeline/README.md`, `docs/data-contract.md` (any change to data shape goes through it).

Then tell the user in 2–4 lines which item you'll do next and why (dependency order from the roadmap), unless they already named one.

## Pick the work

- Follow the order in `references/roadmap.md` unless the user picks something else; it is ordered by dependency and value. Every new feature first gets a tier (ADR 0019); if it has none, ask.
- One roadmap item per cycle is the default. Bundle only items that touch disjoint modules (e.g. a pipeline-only item with an app-only item).
- If an item needs a decision only the user can make (e.g. hosting, a data purchase, a big dependency like Java for citygml-tools), ask with concrete options and a recommendation; otherwise choose sensibly and record it as a new ADR.

## Plan → delegate → verify → record

### 1. Plan
Write a short plan (in chat, 5–15 lines): files/modules touched, contract changes (if any), new dependencies (pinned), test plan, how you'll verify visually. Domain guidance lives in the specialist skills — load the relevant one before planning in detail:

| Area | Skill |
|---|---|
| Data: new AOIs, new layers/sources (OSM, ALKIS WFS, historic WMS, LoD2, orthophoto, LAZ/PDAL), contract changes | `sle-pipeline` |
| three.js / Leaflet: LOD streaming, draped vectors, buildings, textures, point clouds, measuring, UI | `sle-renderer` |
| F15 anomaly / relict candidate detection | `sle-relict-detection` |

### 2. Delegate
Do the work in subagents (the user asked for this), each with a narrow scope and explicit ownership:

- **Ownership by directory.** Typical split: pipeline agent → `pipeline/` + generated `app/public/data/**`; renderer agent → `app/src/terrain/`, new `app/src/<feature>/`; UI/map agent → `app/src/map/`, `app/src/markers/`, `app/src/ui/<feature>*`. Run agents in parallel only when their directories are disjoint.
- **Shared files** (`app/src/main.ts`, `app/src/ui/features.ts`, `app/src/data/manifest.ts`, `app/index.html`, `docs/data-contract.md`, `PRD.md`, `docs/adr/`, `CHANGELOG.md`): you (the lead) own them, or an agent edits them minimally and additively and re-reads the file right before each edit. Contract changes are made by the lead *before* spawning agents, so both sides build against the same spec.
- **Brief like a peer.** Each brief states: goal + acceptance criteria (copy from the roadmap), files to read first (relevant ADRs, contract, READMEs, research file), ownership boundaries, project conventions (below), verification it must run, and the report format (<300 words: what changed, test/build results, what was verified vs. not, known gaps). Ask agents not to commit.
- Don't duplicate an agent's work while it runs; use the time for docs upkeep or the next plan.

### 3. Verify (before you claim done)
Follow `references/verification.md`. Minimum gate:

```bash
.claude/skills/sle-roadmap/scripts/verify.sh   # app tests + typecheck/build, pipeline tests
```

plus a browser check of the new feature (use `window.sle.step()` — Chrome often reports automated tabs as hidden, which pauses rAF), and numeric spot checks for anything geospatial. Report honestly what was and wasn't verified (e.g. "live flight feel not tested — needs your hands").

### 4. Record (ADR 0025 — no living-PRD appends)
- **ADRs:** every non-obvious decision → new `docs/adr/NNNN-*.md` (Status · Context · Decision · Consequences, ≈ one screen) + a row in `docs/adr/README.md`. Changing an accepted decision = new ADR + `Superseded by NNNN` on the old status line; never rewrite an accepted ADR. No private locations (`docs/` ships publicly).
- **CHANGELOG.md:** one line per shipped item (date · version · what). Measured numbers (sizes, timings, fps) go into the commit message and the module README.
- **PRD.md:** touch only if vision, goals, tiers, roadmap status or open questions changed (answered question → remove the row, or turn it into an ADR). Keep it ≤ 150 lines.
- Update `app/README.md` / `pipeline/README.md` / `docs/data-contract.md` where behaviour changed.
- Update `references/roadmap.md` in this skill: tick the item, add newly discovered issues to "Known issues".
- **Commit** once per roadmap item (local git; data stays ignored). Message: `V2.3: CHM trees in the overworld` style, ending with the attribution trailer the session provides.

Then give the user a short update: what shipped, how to try it (`http://localhost:<port>/`, keys), what's next.

## Project conventions (pass these to every agent)

- **Frames:** EPSG:25832 everywhere in data; three.js world `x = E − E0`, `y = h`, `z = −(N − N0)`; never raw UTM in float32 buffers. Leaflet is EPSG:3857; headings on the map add `gridConvergenceDeg(E, N)` (≈ −1.2°).
- **Heights:** Terrarium PNG, decoded without colour management. Exaggeration is `y = hRef + (h − hRef)·exag` — anything new placed in 3D (lines, labels, buildings, points, measurements) must use the same formula so it stays glued to the terrain at 1–5×.
- **Grid:** DGM is PixelIsArea; cell centres at +0.5 m. 500 m chunks, height textures 502² with 1-cell apron, layers 500². Half-pixel and axis-flip errors are the most common bug class here — test them numerically.
- **UI:** German labels, English code/docs. Global shortcuts must ignore text fields via `isTyping()` from `app/src/ui/keys.ts`. Panels go into `#panel` via `createPanelSection` (`app/src/ui/panelSection.ts`); store writes carry a source tag (in use: `'camera'`, `'hash'`, `'gui'`; add a new tag per writer, e.g. `'map'`) to avoid feedback loops. Reserved/planned keys: `O` OSM ways, `L` measuring, `N`/`P` candidate navigation — check `app/README.md` before claiming a key.
- **Data stays out of git**; generated data lives in `app/public/data/<aoi>/` and is not copied into `dist/`. Reproducibility comes from `pipeline/run.sh <aoi>`.
- **Attribution** (`© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0`, RLP, OSM/ODbL) must cover any new source. The footer shows `manifest.attribution` plus strings hard-coded in `app/src/ui/features.ts` (`buildAttribution()`, already includes OSM and Flurstücke) — add new sources to the manifest from the pipeline.
- **Heritage law / ethics:** the app shows hypotheses, never digging or detector guidance; user markers, reviews and location stay local (ADR 0009); crater/UXO data never public (ADR 0010); quests virtual only, no "go there" (ADR 0021); keep the "Schauen, nicht graben" disclaimer intact.
- Pinned dependency versions; Vite 8 / TS 7 / three r187 / Leaflet 1.9.4 / Python 3.12 via uv.

## When things go wrong
- Downloads failing or a service changed → don't fake data. Report precisely, check `docs/research/01`/`04` for alternatives, ask the user if a source decision is needed.
- An agent's report claims success but verification fails → fix or re-brief with the concrete failure; never pass unverified claims on to the user.
- Scope creep (e.g. a bigger area before v5, quests in v2, accounts) → it's a PRD non-goal; ask before expanding.
