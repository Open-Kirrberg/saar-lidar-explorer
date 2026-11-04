# Delegation: ownership, parallelism, briefs

Read this before spawning agents for a backlog item. Paths are relative to the sub-project root
(`zones/schloss-karlsberg/`). `docs/architecture.md` §2 has the original ownership table; it predates the implementation, so
use the map below, which reflects the code as it is.

## 1. Ownership map (one agent per row; parallel only when rows are disjoint)

| Package | Owns (may edit) | Typical backlog items | Domain skill to load |
|---|---|---|---|
| **core / catalogue** | `model/src/layout/**`, `model/src/spec.ts`, `validate.ts`, `catalogue.ts`, `frame.ts`, `scripts/catalogue-v2/**`, generated `model/catalogue.json`, `model/tests/**` for these | I02, I03, I21 (flags), I24/I25 (catalogue side), I30, new `GARDEN`/`GLAZING` tables | `skb-historic-architecture` (buildings, rooms), `skb-schlossgarten` (features) |
| **exterior** | `model/src/exterior/**`, `model/src/materials/**` | I15–I20, I22, I24 (geometry), I28, I29, I42 | `skb-historic-architecture`, `skb-visual-wow` (materials) |
| **interior** | `model/src/interior/**` | I25 (model side), I26, I27, I43 (fixtures) | `skb-historic-architecture` |
| **site** | `model/src/site/**`, `scripts/prepare-terrain.py`, regenerated `viewer/public/terrain/` (git-ignored) | I09, I11–I14, I23, I32–I40 | `skb-schlossgarten` |
| **viewer** | `viewer/src/**` **except `viewer/src/handover.ts`**, `viewer/tests/**` **except `handover.test.ts`**, `viewer/index.html`, `viewer/textures.json` | I01, I04–I08, I10, I41, I43–I47 | `skb-visual-wow` |
| **plans** | `plans/**`, `docs/plans-preview/` | regeneration after layout/catalogue changes, I52 (SC-02) | – |
| **lead (you)** | `docs/architecture.md`, `docs/explorer-integration.md`, `README.md`, `CHANGELOG.md`, `docs/improvement-backlog.md`, `CLAUDE.md`, `package.json` + `pnpm-lock.yaml`, `model/src/context.ts` (`MATERIAL_NAMES`, `BuildContext`), `model/src/api.ts`, `model/src/explorer/export.ts` + `scripts/export-explorer.ts` | contract edits, dependency pins, light-layer export | – |

Why this split: `layout/` is the single truth that exterior, interior, site, plans and the explorer export all read.
If two agents change it at once, the consumers disagree; so contract changes (a new `spec.ts` field, a new
`TerrainKind`, a new material name, a new grammar table) are made **by the lead or the core agent first**, tested, and
only then are the consumers briefed against the finished contract.

Never edit, for any reason: anything outside `zones/schloss-karlsberg/` (`../../app`, `../../pipeline`, `../../docs`, `../../PRD.md`,
`../../.claude` belong to the explorer agent), `viewer/src/handover.ts`, `viewer/tests/handover.test.ts` (someone else's
uncommitted work at the time of writing; re-check `git status` before touching the viewer), downloaded `sources/`,
or the HMS-derived `video2world/` outputs.

## 2. Sequencing patterns

- **Catalogue fact → geometry:** core agent changes `scripts/catalogue-v2/` and regenerates `model/catalogue.json`
  (`pnpm exec tsx scripts/catalogue-v2/build.ts`; validation, programme checks and overlaps must report 0), then the
  exterior/interior/site agents consume it. Run them in parallel only if they touch different builders.
- **New feature kind (garden):** lead adds the type to `spec.ts` + `validate.ts` + `docs/architecture.md` §4.1; core
  agent adds the pure generator in `layout/site.ts` with tests; site agent renders it in `site/features.ts`; then
  `prepare-terrain.py` if it needs a ground class.
- **Lighting / post / perf:** viewer agent alone; the model package is untouched unless a shader chunk must live in
  `model/src/materials/` (then the exterior agent owns that file for the cycle).
- **Plans:** after any layout or catalogue change that moves walls, openings, names or features, the plans agent (or
  you) runs `pnpm run plans` (all sheets; `--only GR-01 --no-pdf` for a quick look). It needs `plans/data/` (see
  CLAUDE.md for `plans/scripts/terrain.py`) and Chrome (`CHROME_BIN`). Previews in `docs/plans-preview/` are git-ignored
  (regenerable).
- **Terrain:** `cd ../../pipeline && uv run python -I ../zones/schloss-karlsberg/scripts/prepare-terrain.py` reads
  `../../data/work` read-only and writes `viewer/public/terrain/` (git-ignored). This runs a command in `../../pipeline`
  but writes only castle files, so it is allowed.

## 3. Brief template (copy, fill, keep under ~60 lines)

```
You are the <package> agent for backlog item KB-Ixx "<title>" in
schloss-karlsberg.

Goal and acceptance (from the backlog row, or the frozen item text in docs/history/ for KB-I01…I100):
- …

Read first: CLAUDE.md, docs/architecture.md §<n>, docs/improvement-backlog.md KB-Ixx (+ its docs/history/ text),
research/<nn> §<section> (the evidence), and the <domain> skill at .claude/skills/<skill>/SKILL.md.

You own: <paths>. Do not edit anything else. Never edit outside zones/schloss-karlsberg/, never
viewer/src/handover.ts or viewer/tests/handover.test.ts. If you need a change elsewhere (a new spec field,
a material name, a grammar constant), stop and report what you need instead of editing.

Rules: pure logic in model/src/layout with vitest; period numbers only in layout/grammar.ts with their
evidence tag; facts only via scripts/catalogue-v2/; deterministic randomness mulberry32(hashString(id) ^ seed);
frames x = E − 381000, y = h, z = −(N − 5465000), no exaggeration; German UI labels and name_de; every new
fact carries a tag (D, D→, I, N, U, HMS) and a source; no invented sources; no HMS frames or textures;
no digging/detector guidance; exact dependency pins (ask the lead before adding any).

Verify before reporting: .claude/skills/skb-improve/scripts/verify.sh test build (+ catalogue if you touched
scripts/catalogue-v2, + export if exterior/site output changed). For visual changes also:
node .claude/skills/skb-improve/scripts/shots.mjs --out <scratchpad>/KB-Ixx-after --poses <ids> --bench
and LOOK at the images.

Do not commit, stash, reset or checkout. Report (< 300 words): files changed, tests/build result with
numbers, shots taken (paths) and what you saw in them, bench numbers, evidence tags you assigned, what you
could not verify, open questions.
```

## 4. While agents run

- Don't redo their work. Use the time to prepare the next brief, update the backlog item text, or draft the changelog.
- When a report claims success, re-run `verify.sh` yourself and open at least one of their shots. If a claim fails,
  re-brief with the concrete failure; never pass an unverified claim on to the user.
- If two agents need the same file, serialise them: the second starts after the first has reported and you have
  checked the result.
