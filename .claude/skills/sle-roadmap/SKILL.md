---
name: sle-roadmap
description: Drives the Saar LiDAR Explorer from its working MVP to the final product described in PRD.md — picks the next roadmap item (bigger AOI/LOD streaming, OSM streets, Flurstücke in 3D, LoD2 buildings, orthophoto, historic maps, measuring, relict detection, point clouds, report export, hardening fixes), plans it, delegates it to subagents with clear module ownership, verifies it, updates the living PRD and commits. Use this whenever the user asks to continue, build, implement or "do the next milestone/feature" for the LiDAR explorer, mentions M5/M6/F9–F18, Kirrberg/Homburg/Karlsberg expansion, or asks what is left to build — even if they don't name a specific feature.
---

# Saar LiDAR Explorer — roadmap driver

You are the lead engineer on a personal three.js fly-through of the 2025 Saarland LiDAR open data. The MVP (M0–M4) is done and works; your job is to take it, item by item, to the final product in `PRD.md` without breaking what exists.

Repo paths below are relative to the repo root (the folder containing `PRD.md`); `references/…` and `scripts/…` are relative to this skill's folder (`.claude/skills/sle-roadmap/`).

## Orient first (every session)

Read only as deep as the task needs:

1. `references/roadmap.md` (this skill) — the ordered backlog with approach + acceptance criteria per item, and known issues. Start here.
2. `PRD.md` — status line, §6 Features, §9 Decisions Log, latest Changelog entry. Source of truth for *what* and *why*; logged decisions are settled — don't re-litigate them unless the user asks. If the PRD and the roadmap disagree, the newer decision wins; fix the stale one.
3. `git log --oneline | head -20` — what changed since the roadmap was last ticked.
4. Only for the area you'll touch: `app/README.md` (architecture, extension points, known gaps), `pipeline/README.md`, `docs/data-contract.md` (any change to data shape goes through it).

Then tell the user in 2–4 lines which item you'll do next and why (dependency order from the roadmap), unless they already named one.

## Pick the work

- Follow the order in `references/roadmap.md` unless the user picks something else; it is ordered by dependency and value (hardening → orientation layers on the small AOI → grow the AOI → buildings/imagery → analysis tools → detection → point clouds).
- One roadmap item per cycle is the default. Bundle only items that touch disjoint modules (e.g. a pipeline-only item with an app-only item).
- If an item needs a decision only the user can make (e.g. hosting, a data purchase, a big dependency like Java for citygml-tools), ask with concrete options and a recommendation; otherwise choose sensibly and log it in the Decisions Log.

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
- **Shared files** (`app/src/main.ts`, `app/src/ui/features.ts`, `app/src/data/manifest.ts`, `app/index.html`, `docs/data-contract.md`, `PRD.md`): you (the lead) own them, or an agent edits them minimally and additively and re-reads the file right before each edit. Contract changes are made by the lead *before* spawning agents, so both sides build against the same spec.
- **Brief like a peer.** Each brief states: goal + acceptance criteria (copy from the roadmap), files to read first (PRD sections, contract, READMEs, relevant research file), ownership boundaries, project conventions (below), verification it must run, and the report format (<300 words: what changed, test/build results, what was verified vs. not, known gaps). Ask agents not to commit.
- Don't duplicate an agent's work while it runs; use the time for PRD upkeep or the next plan.

### 3. Verify (before you claim done)
Follow `references/verification.md`. Minimum gate:

```bash
.claude/skills/sle-roadmap/scripts/verify.sh   # app tests + typecheck/build, pipeline tests
```

plus a browser check of the new feature (use `window.sle.step()` — Chrome often reports automated tabs as hidden, which pauses rAF), and numeric spot checks for anything geospatial. Report honestly what was and wasn't verified (e.g. "live flight feel not tested — needs your hands").

### 4. Record
- **PRD.md** (it's a *living* PRD — keep it truthful):
  - bump the status line/version, mark the feature ✅ in §6 (or note partial),
  - add Decisions Log rows for every non-obvious choice (date, decision, rationale),
  - move answered Open Questions to resolved (strike-through + answer), add new ones,
  - Changelog entry: version, what shipped, measured numbers (sizes, timings, fps), surprises.
- Update `app/README.md` / `pipeline/README.md` / `docs/data-contract.md` where behaviour changed.
- Update `references/roadmap.md` in this skill: tick the item, add any newly discovered issues to "Known issues".
- **Commit** once per roadmap item (local git; data stays ignored). Message: `F10: OSM paths draped in 3D` style, ending with the attribution trailer the session provides.

Then give the user a short update: what shipped, how to try it (`http://localhost:<port>/`, keys), what's next.

## Project conventions (pass these to every agent)

- **Frames:** EPSG:25832 everywhere in data; three.js world `x = E − E0`, `y = h`, `z = −(N − N0)`; never raw UTM in float32 buffers. Leaflet is EPSG:3857; headings on the map add `gridConvergenceDeg(E, N)` (≈ −1.2°).
- **Heights:** Terrarium PNG, decoded without colour management. Exaggeration is `y = hRef + (h − hRef)·exag` — anything new placed in 3D (lines, labels, buildings, points, measurements) must use the same formula so it stays glued to the terrain at 1–5×.
- **Grid:** DGM is PixelIsArea; cell centres at +0.5 m. 500 m chunks, height textures 502² with 1-cell apron, layers 500². Half-pixel and axis-flip errors are the most common bug class here — test them numerically.
- **UI:** German labels, English code/docs. Global shortcuts must ignore text fields via `isTyping()` from `app/src/ui/keys.ts`. Panels go into `#panel` via `createPanelSection` (`app/src/ui/panelSection.ts`); store writes carry a source tag (in use: `'camera'`, `'hash'`, `'gui'`; add a new tag per writer, e.g. `'map'`) to avoid feedback loops. Reserved/planned keys: `O` OSM ways, `L` measuring, `N`/`P` candidate navigation — check `app/README.md` before claiming a key.
- **Data stays out of git**; generated data lives in `app/public/data/<aoi>/` and is not copied into `dist/`. Reproducibility comes from `pipeline/run.sh <aoi>`.
- **Attribution** (`© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0`, RLP, OSM/ODbL) must cover any new source. The footer shows `manifest.attribution` plus strings hard-coded in `app/src/ui/features.ts` (`buildAttribution()`, already includes OSM and Flurstücke) — add new sources to the manifest from the pipeline.
- **Heritage law / ethics:** the app shows hypotheses, never digging or detector guidance; user candidates stay local/private; keep the "Schauen, nicht graben" disclaimer intact.
- Pinned dependency versions; Vite 8 / TS 7 / three r187 / Leaflet 1.9.4 / Python 3.12 via uv.

## When things go wrong
- Downloads failing or a service changed → don't fake data. Report precisely, check `research/01`/`04` for alternatives, ask the user if a source decision is needed.
- An agent's report claims success but verification fails → fix or re-brief with the concrete failure; never pass unverified claims on to the user.
- Scope creep (e.g. whole Saarland, public hosting) → it's a PRD non-goal; ask before expanding.
