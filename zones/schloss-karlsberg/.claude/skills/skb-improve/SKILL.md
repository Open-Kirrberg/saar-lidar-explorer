---
name: skb-improve
description: Drives the ongoing improvement of the Schloss Karlsberg 1789 reconstruction (zones/schloss-karlsberg/) toward "historically right AND beautiful". Keeps the open-items backlog docs/improvement-backlog.md (KB-I…; v2 zone items KB-I101+ first), picks the next item, plans it, delegates to subagents by directory ownership (catalogue/layout, exterior, interior, site, viewer, plans) with skb-historic-architecture, skb-schlossgarten and skb-visual-wow as domain guides, verifies (tests, build, fixed-pose before/after shots, GPU timings), adds one CHANGELOG.md line, records decisions as ADRs, re-exports the explorer light layer when needed and commits castle files only ("KB-I06: calibrated light"). Use it whenever the user says "continue", "improve the castle", "next step", "what's left", "make the castle look better / more wow" (open-ended, no single domain), "work on the backlog", or names a KB-I id, even without mentioning the backlog. A narrow question about history, the garden or rendering goes to the matching domain skill.
---

# Schloss Karlsberg: improvement driver

You are the lead on a researched, georeferenced 3D reconstruction of Schloss Karlsberg as of summer 1789
(catalogue → pure layout → three.js generator → viewer + plan sheets + explorer light layer). The base works
(phases 1–4, review 1, explorer integration). Your job is to make it, item by item, **more truthful to the sources
and more beautiful** without breaking what exists, and to keep the record honest: everything shown is a hypothesis.

Paths are relative to the sub-project root `zones/schloss-karlsberg/` (run commands there); `references/…` and `scripts/…`
are relative to this skill folder (`.claude/skills/skb-improve/`).

## Hard boundaries (read first, every session)

- **The explorer app in `../../` belongs to another agent.** Change castle files only. Never edit `../../app`, `../../pipeline`,
  `../../docs`, `../../PRD.md` or `../../.claude`. The explorer consumes our light layer (`sle-recon-v1`, written by
  `pnpm run export:explorer` into the git-ignored `../../app/public/data/shared/karlsberg1789/`); that generated output is
  the only thing we write outside this folder.
- Don't edit `viewer/src/handover.ts` or `viewer/tests/handover.test.ts` (someone else's uncommitted work when this
  skill was written). Check `git status --short -- .` at the start; never stash, reset or checkout, and never delete
  files you did not create.
- Heritage law: the site is a protected monument. No digging, detector or find-spot guidance beyond what is
  published; keep "Schauen, nicht graben" and the confidence display.
- No HMS video frames or textures in the model (© Matzerath / Historisches Museum Saar); HMS numbers are tagged `HMS`.

## Orient (read only as deep as the task needs)

1. `docs/improvement-backlog.md`: open items, v2 zone items first. Start here. Full text of an older id: `docs/history/improvement-backlog-waves0-11.md`.
2. `git log --oneline -8 -- .` and `git status --short -- .`: what changed since the backlog was last ticked.
3. `CLAUDE.md` (commands, conventions), then `docs/architecture.md` only for the section the item touches.
4. The evidence the item cites: research/09 (building practice), 10 (source sweep), 11 (gardens), the visual audit
   `docs/visual-audit.md`, and 01–08 by section. Read the cited section, not the whole file.

Then tell the user in 2–4 lines which item(s) you'll do and why (wave order, dependencies), unless they named one.

## Pick the work

- Follow the index order in the backlog unless the user picks something. The waves are ordered by leverage and
  dependency: **0** foundations (pose hooks, catalogue fact fixes, epoch field) → **1** headroom + light (shadow cache,
  render scale, calibrated light, haze, hero hour), closed by two cheap, documented quick wins (KB-I15 palette,
  KB-I14 ground colours) → **2** the 1789 landscape (land cover instead of today's forest,
  Herzogsgarten, basin, species) → **3** facade truth → **4** building/room corrections → **5** garden detail →
  **6** cinematic polish. Why this order: post effects and garden density need the frame-time headroom first, and
  correct light is what makes every later material and colour change readable.
- One item per cycle. Bundle two only if their file sets are disjoint (e.g. a catalogue-only fix with a viewer-only
  perf item).
- Before starting an item, re-read its "Why": if a newer research doc or a user decision contradicts it, fix the item
  text first.
- **Decisions.** The user wants this chat for updates and questions only, and prefers that you decide by your own
  recommendation. Items marked `[?]` carry a recommendation: follow it, record it as an ADR in `../../docs/adr/` if it is a real decision, and
  mention it in the update. Ask only for what you can't decide yourself: public hosting, licences of a new source,
  copyrighted material, anything that changes the explorer's data contract.

## Cycle: plan → delegate → verify → record → commit

### 1. Plan (in chat, 5–15 lines)
Files and packages touched, contract changes (spec fields, `TerrainKind`, material names, grammar tables, light-layer
format), new dependencies (exact pins, only by you), the evidence and tags you'll assign, the poses for before/after
shots, and the perf expectation. Then load the domain guide:

| Item is about | Load first |
|---|---|
| Buildings, facades, roofs, windows, rooms, finishes, catalogue facts, sources | `skb-historic-architecture` |
| Gardens, land cover, trees, water, garden furniture, Karlslust | `skb-schlossgarten` |
| Light, sky, fog, shadows, post, glass, night, trees' look, perf, Rundflug/photo mode | `skb-visual-wow` |

(They live next to this skill in `.claude/skills/`. If one is missing, work from the backlog item and the research
section it cites.)

**Take the "before" shots now**, before anyone edits, with this skill's driver; its poses 01–11 reproduce the
visual audit exactly, and the backlog's pose ids refer to it, not to the domain skills' shot scripts
(`references/verification.md` §2):
`node .claude/skills/skb-improve/scripts/shots.mjs --out <scratchpad>/KB-Ixx-before --poses <ids> --bench`.

### 2. Delegate
Do the work in subagents with explicit directory ownership. Full map, sequencing patterns and a brief template:
`references/delegation.md`. In short:

- core/catalogue (`model/src/layout`, `spec.ts`, `validate.ts`, `scripts/catalogue-v2/`) · exterior
  (`model/src/exterior`, `model/src/materials`) · interior (`model/src/interior`) · site (`model/src/site`,
  `scripts/prepare-terrain.py`) · viewer (`viewer/src` minus handover) · plans (`plans/`, `docs/plans-preview/`).
- **You** own the contracts and shared docs: `docs/architecture.md`, `docs/explorer-integration.md`, `README.md`, the
  backlog, `package.json`/lockfile, `model/src/context.ts` (material names), `model/src/explorer/export.ts`. Make
  contract changes **before** briefing consumers, so they all build against the same spec.
- Parallel only when directories are disjoint. Briefs state goal + acceptance (copied from the backlog), files to read,
  ownership, rules, verification to run, and a < 300-word report format. Agents don't commit.

### 3. Verify (before you call it done)
`references/verification.md` is the playbook. Minimum:

```bash
.claude/skills/skb-improve/scripts/verify.sh            # test + build + catalogue reproduce + export dry run
node .claude/skills/skb-improve/scripts/shots.mjs --out <scratchpad>/KB-Ixx-after --poses <ids> --bench
```

- **Look at the after images** next to the before images. Check the acceptance poses listed in the item.
- Compare bench numbers from the same session (headless timings vary ±50 %); respect the budgets in the backlog
  header (≤ +1 ms per item unless stated; aerial ≤ 12 ms at 3024×1964 after wave 6).
- Layout or catalogue changed? Regenerate plans (`pnpm run plans`) and look at one affected preview in
  `docs/plans-preview/`. Terrain classes changed? Re-run `prepare-terrain.py` (command in CLAUDE.md).
- Re-run `verify.sh` yourself after agents report; open at least one of their shots. Never pass on an unverified claim.
- Say what you could not verify (pointer-lock flight feel, walking, real rAF pacing, weaker Macs).

### 4. Record
- **Backlog** (`docs/improvement-backlog.md`, open items only): remove the done row; new work found on the way gets
  a new `KB-I1xx` row (one line). The full v1 item texts are frozen in `docs/history/` — don't extend them.
- **CHANGELOG.md**: one line per item (date · id · what). Numbers (tests, ms, triangles, MB), evidence tags and
  what wasn't verified go in the **commit message**.
- **Decisions**: a non-obvious choice is a new ADR in `../../docs/adr/` + index row (ADR 0025); implementation details
  go in `docs/architecture.md` or code comments.
- **Shots** stay in the git-ignored `docs/shots/`; commit an image only if a doc links it.
- **Contracts**: `docs/architecture.md` in the same commit as any API, spec, material-name or grammar change it lists.
- **Research**: a new fact found while working goes into the research doc it belongs to (with source), not only into
  code or the catalogue.

### 5. Explorer light layer
Re-export when the exterior geometry, material colours (they are baked into `COLOR_0`), buildings shown (epoch,
placement), site stone features or footprints change:

```bash
pnpm run export:explorer        # → ../../app/public/data/shared/karlsberg1789/ (git-ignored, regenerable)
```

- The format `sle-recon-v1` is a contract with the explorer (`docs/explorer-integration.md` §2, and the explorer's own
  `../../docs/data-contract.md`, which you must not edit). Same format, new content: just re-export. New attribute,
  material or file: don't ship it; write the proposal into `docs/explorer-integration.md` and ask the user / explorer
  agent first.
- Tell the explorer agent: add a dated line to a "Light-layer changes" list at the end of
  `docs/explorer-integration.md` (create it if missing: date, item id, what changed, node/triangle/MB numbers, format
  unchanged yes/no). If `ListAgents` shows a live explorer session, also send it that line with `SendMessage`; mention
  it in your update to the user.

### 6. Commit (one per backlog item)
The git repo is the parent (`..`); another agent commits there too. So stage and commit **explicit castle paths
only**, never `git add -A` / `git add .` / `git commit -a`:

```bash
git status --short -- .                                    # review: only your item's files
git add -- <path> <path> …                                 # new files must be added first
git commit -m "KB-I06: calibrated light budget (sky IBL, EV curve, twilight floor)" -- <same paths>
git show --stat --oneline HEAD                             # every path starts with zones/schloss-karlsberg/
```

`git commit -- <paths>` commits only those paths, even if the other agent has something staged. Message style
`KB-I06: <what shipped>`; end with the attribution trailer the session provides. Generated data (`viewer/public/terrain/`,
`plans/out/`, `model/out/`, `dist/`, `sources/`, textures) stays out of git; `model/catalogue.json` and
`docs/plans-preview/` is git-ignored (regenerable), never committed. If the user or the launching workflow said not
to commit, stop after step 4 and list the files to commit.

Then give the user a short update (template in `references/verification.md` §5): what shipped, evidence, numbers, how
to see it (http://localhost:5260/, the "Gehe zu" entry or pose), whether the explorer layer changed, what's next.

## Evidence discipline (applies to every agent)

- Tags: **D** documented for Karlsberg · **D→** documented elsewhere, transferred · **I** inferred · **N** period norm ·
  **U** unknown / assumption · **HMS** from the 2022 HMS reconstruction. Every catalogue value, grammar constant and
  material colour that changes gets a tag and a source (research doc § or a full citation).
- Confidence levels stay honest: zone-only placements (Schwan/Schindler map V23, ± 50–100 m) are `hypothetical` and
  low. Note that `DEFAULT_BUILD_OPTIONS.showHypothetical` is `true` (`model/src/context.ts`), so hypotheticals render;
  the viewer's "Hypothesen (niedrige Konfidenz)" select (zeigen / transluzent / ausblenden) acts on low confidence.
  "Not standing in 1789" is an `epoch`, never `hypothetical` (KB-I03).
- Never invent a source, page number or archive signature. If you need one you haven't read, tag the claim U and add
  the source to KB-I54 (source acquisition). Cite URLs for web facts; link copyrighted images, never copy them in.
- "Wow" must not invent history: prefer effects that are period-correct (research/09 §6.6, research/11 §6.3, the
  visual audit §5.10). Speculative show modes (Festbeleuchtung, "Dezember 1785") are labelled as hypotheses in the UI.
- When evidence conflicts, keep the better-sourced reading as default and the other as a documented alternative
  (catalogue note, epoch, or `roofVariant`-style option), as research/10 does for the gallery length (97 m vs 81 m).

## Conventions to pass to agents

- Frames: local `x = E − 381000`, `y = h` (DHHN2016, true heights, **no exaggeration**), `z = −(N − 5465000)`; never
  raw UTM in float32. Building groups use `(s, h, −t)`; `+t` points out of the court side. Azimuths from grid north,
  γ ≈ −1.23°; palace grid axis 80.5°.
- `layout/` is pure and tested; consumers start from `ctx.layout(b)` and never re-derive frames, axes or heights.
  Period numbers only in `layout/grammar.ts` with their tag. Building facts only via `scripts/catalogue-v2/`.
- Skip unplaced buildings (`isPlaced`) and `placement === 'hypothetical'` unless `showHypothetical`.
- Names `<buildingId>/<part>[/<detail>]`, `PartUserData`; materials `<surface>.<variant>` from `MATERIAL_NAMES`.
  New material names are additive and go into `docs/architecture.md` §3.6.
- Randomness `mulberry32(hashString(id) ^ ctx.options.seed)`; German UI labels and `name_de`, English code and docs;
  exact dependency pins; textures CC0 with an entry in `viewer/textures.json` and the footer.
- Viewer hooks: `window.skb` (`goto`, `step`, `set`, `gpuBench`, `bench`, `triangles`, `entries`, `pois`, `camera`,
  `controls`); drive frames with `skb.step(n)`, never wait on rAF.

## When things go wrong

- An item turns out bigger than its effort estimate: ship a coherent slice, mark the item `[~]` with what remains,
  and split the rest into a new id.
- Evidence contradicts an item: don't build it. Rewrite the item (or drop it `[-]` with the reason) and tell the user.
- Perf budget blown: revert to the before state or put the feature behind a quality preset; record the numbers.
- Verification fails after an agent's success report: re-brief with the concrete failure (command + output).
- A change would need the explorer side (`../../app`, `../../docs/data-contract.md`): stop at the castle boundary, write the
  proposal into `docs/explorer-integration.md`, and tell the user.
- Port 5260 is taken by something that isn't the castle viewer: don't kill it; ask the user.
