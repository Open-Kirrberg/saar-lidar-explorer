---
name: skb-historic-architecture
description: Makes the Schloss Karlsberg 1789 buildings historically right, outside and inside. Covers 1780s construction and ornament grammar (render over rubble or Fachwerk, croisée windows, blue-grey shutters, slate vs Biberschwanz, Hemmer rods, Louis-seize rooms), Karlsberg facts and the evidence ladder (D, D->, I, N, U, HMS), and how to turn a source into a catalogue, grammar, exterior, interior or material change while keeping plans and 3D consistent. Includes a review checklist and a history-check script. Use it whenever the user asks about historical accuracy, how a building looked or was built, facades, roofs, windows, colours, rooms, sources or evidence, e.g. "is this historically right", "the windows look wrong", "which rooms were in the north wing", "add the gallery rotunda", "how was it built", "make the palace more impressive but correct". Also use it before changing building data, grammar constants or material colours in schloss-karlsberg/.
---

# Schloss Karlsberg: historic architecture (c. 1789)

You make the reconstruction of Schloss Karlsberg (Homburg, Duke Karl II. August, built 1778–88, burnt 28 Jul 1793) **look like summer 1789 and say how sure we are**. The audience is someone flying over and walking through it, so it has to be impressive. It is also a research hypothesis, so it has to be honest. Both goals usually agree: the documented 1780s finish already gives the "wow". Examples are blue-grey shutters on white-grey limewash, blue slate over the palace against red tile on the service town, gilt Tapetenleisten, a yellow salon, and diagonal parquet under chandeliers (research/09 §6.6).

All paths are relative to `schloss-karlsberg/` (the folder with `CLAUDE.md`). `references/…` and `scripts/…` are relative to this skill folder.

## Boundaries (read first)

- **Castle side only.** Another agent owns the explorer app in `../` (`../app`, `../pipeline`, `../docs`, `../PRD.md`, `../.claude`), so don't edit there. The explorer only sees the light layer that `pnpm run export:explorer` writes to `../app/public/data/shared/karlsberg1789/`. Re-run the export after a visible change, and tell the user that the explorer picks it up on reload.
- `viewer/src/handover.ts` and `viewer/tests/handover.test.ts` belong to the camera handover work. Leave them alone unless your task is the handover.
- **Hypothesis, not record.** Everything carries a confidence level and evidence tags, and the UI keeps "Schauen, nicht graben". Give no digging, detector or find-spot hints beyond what the cited publications already state (SDschG Saarland).
- **HMS 2022** (© Matzerath / Historisches Museum Saar) is a reference for numbers and readings (tag `HMS`). No frames or textures from it go into the model.
- **Never invent a source.** If you can't cite it, it is `N` (period norm), `I` (inferred, reasoning stated) or `U` (unknown).

## Orient (every session, as deep as the task needs)

1. `CLAUDE.md`, `README.md` (status, changelog) and `docs/architecture.md` (the binding contract: frames, sides, storeys, LOD, materials §3.6, grammar §4.4, builder rules §5).
2. `references/fact-sheet.md`: a condensed version of what is known per building and globally, with the open research deltas. Start here for any "what did X look like" question.
3. Run the history check. It is read-only and takes under 1 s:
   ```bash
   node .claude/skills/skb-historic-architecture/scripts/history-check.mjs --open
   ```
   It lists integrity failures (missing tags, confidence or sources) and the documented research findings that the model does not show yet (OPEN), each with its research section. Use it to pick work and to prove progress. An item flips to DONE by itself when the catalogue or code implements it.
4. Go to the research doc **section** the fact sheet points to before you change anything. The docs are long, so read by heading (`grep -n '^##' research/09-*.md`):

| Doc | Read it for |
|---|---|
| `research/01` §0–§3 | chronology, building inventory, "plain, grown" exterior, rooms, makers |
| `research/02` §0, §2.2–§2.13 | the Karlsberg facts K1–K12 and the dimension tables (storeys, windows, doors, walls, roofs, stairs, rooms, finishes) |
| `research/05` §d, §e | per-building parameters and the Grundriss hypothesis for the CdL and wings |
| `research/06` §3.2–§3.7 | what the HMS film shows: one facade system, shutters, sentry boxes, portals |
| `research/07` §1, §1.3, §2, §3 | LC 1790, PV 1791, the PL plate, K05 (§1); conflicts C1–C16 (§1.3); LP06 and K05 georeferenced (§2); the conflict rule and proposed changes (§3) |
| `research/08` §4, §7 | HMS reference-mesh measurements (heights, cornice 356.0) |
| `research/09` §1–§6 | **how it was built and finished**: process, Fachwerk, limewash, colour comparables, windows, shutters, members, interiors, site works; §6 maps rules G/M/E/I/C to files |
| `research/10` §0, §b, §c | **Karlsberg source sweep** (Schwan 2012, Mannlich 1910, R12): per-building deltas, room colours, gallery, rotunda |
| `research/11` | gardens and landscape. Building-adjacent items here are the pavilions, the basin and KB-B28; everything else is garden work |

## Mental model: what "historically right" means here

- **Plain outside, rich inside.** The exteriors were sober early classicism: one- and two-storey ranges, **one continuous cornice** (HMS 356.0 on the palace group), rendered walls, repeated identical bays, corner strips only on the wings, and no string courses or window pediments (research/02 K1, research/06 §3.2). The richness is concentrated at the CdL centre (7-axis Louisenhof core, Dachreiter), the KB-B02 head (4-column portico and balcony, LC 1790) and the interiors (Paris and Lyon: Jacob, Dugourc, Lyon silks, gilding, mirrors; Knigge 1792).
- **A rushed, painter-led, foreman-run site.** Mannlich was a painter, and the building was run by the Polier Schäfer. Hautt's damning report came in 1785, and in 1788 he returned mainly to fix defects (research/09 §1). Material was recycled from Jägersburg and the Hohenburg. So the model shows render over rubble or Fachwerk, members painted in render rather than cut stone, mixed sandstone hues where stone shows, and uneven limewash. **Don't "upgrade" it into Versailles.** Extra carving, giant orders and statuary on the wings are the most common way to make it less true.
- **Evidence ladder** (catalogue `conventions.conflict_rule`, research/07 §3): documented period sources (Mannlich, Schwan's archival work, the 1793/95 damage inventories, LC 1790, PV 1791) > LP06 research plan (topology) > LiDAR (positions, foundations) > HMS (heights, massing) > comparables (D->) > period norms (N). The R12 room list ("Stand 2003") is superseded where Schwan 2012 differs. Within one value, the lower rung loses and the alternative goes into `alternatives`.
- **One truth, many consumers.** The facts go in `model/catalogue.json`, which is **generated** by `scripts/catalogue-v2/`. Never hand-edit the JSON: a test checks that the build reproduces it exactly. Period norms go in `model/src/layout/grammar.ts` with their tag. Colours and PBR values go in `model/src/materials/index.ts`. `layoutBuilding()` turns all of that into one layout that exterior/, interior/, site/, the plans and the explorer export all read, so a change in the right place updates the 3D model, the plan sheets and the export together.

## Rules that bite

1. **Tag every value you add or change**, in the same format the code already uses: `tag: 'D T5 (Schwan 2012) …; size N'`, a comment `// [N] 0.9-1.1`, or a `*_tags` string. Write the reason for an `I`. Upgrading a tag (N → D) needs the citation. Downgrading needs nothing but honesty.
2. **Facts per building → the catalogue builder; norms → grammar.ts; colours → materials + catalogue defaults.** Don't hard-code a number in `exterior/` or `interior/` (CLAUDE.md). Where each kind of change goes is in `references/source-to-model.md`.
3. **The 1789 time slice is strict.** Ephemeral or later things don't stand in the 1789 state: the 1785 Orangerie fair rotunda KB-B13, the 1785 Hymen temple KL-B49, the post-1792 Eremitage move, and modern Cor-Ten consolidation. If something matters for another date, it is an *option* (a scene or epoch), never a default. `placement: 'hypothetical'` means "we're not sure it existed or where it stood", **not** "it existed at another time". Excluding a building by date needs an additive spec field (core change, see source-to-model §3.6).
4. **Exterior palette** (research/09 §3.7, which carries the full table):
   - walls white-grey limewash `#E9E7E0` (model keeps `#ECE8DF`) [D-> Koblenz 1998, LC 1790, PV 1791; warm/cool split
     by build year I]; members grey `#B9B8B2` as painted render [D-> Koblenz; I];
   - exposed sandstone only on plinths, steps, portals and corner strips, mixed red `#A65E4A`, yellow-grey `#C8B38C`
     and grey-white `#CFC8BA` [D local stone; I mix];
   - shutters blue-grey `#5F6F7A` on court buildings [D-> Baunetz; HMS], green `#3F5A3A` or oxblood `#6E2E26` on farm
     buildings [N]; joinery white or pale grey `#E9E6DE` [D-> Bamberg; HMS];
   - iron `#2E3439`, with gilt `#C9A24A` only on the Ehrenhof gate tips [D-> Schwetzingen, LC];
   - slate `#4A525C` on the palace group [D PV "blue"; D T1 for the main house], red Biberschwanz `#A8573A` on the
     service town [D PV/HMS]. The cover split is already in the catalogue (history-check H18); the hexes are not yet.
   - Don't use Benrath pink or Mannheim red-on-yellow (Baroque schemes, research/09 §0 item 6, §2.5).
5. **Windows are French two-leaf casements** that meet on a stile with an espagnolette [D Baunetz]. They have no fixed central mullion, and a transom only when the window is 2.6 m or taller [N]. Panes are small and upright: 2 per leaf, about 0.25 × 0.33 m, on the wings [HMS 2 × 4 per leaf; N size]; larger, 1 per leaf, on the CdL state floor [N]. A T-mullion (Galgenfenster) is a late-19th-century form [D Baunetz] (research/09 §3.1, §6.1 G1–G3).
6. **Rooms: name and position are separate claims.** Many room *names* are D (R12, Schwan 2012, room-guide pages), but their *positions* are mostly I or U. Tag them separately, e.g. `D T5 name; position I`. Room colours by name are in research/10 §c.2. The hues there are N suggestions, so keep the hex tagged N.
7. **Plans and 3D must agree.** Plans read the same layout (`plans/src`, `plans/tests/model-consistency.test.ts`). If you add geometry outside the layout (a new exterior part), check whether an elevation or Grundriss should show it. If it should, add the helper in `model/src/layout/` and use it from both.
8. **`members_colour` decides the member material by its hex.** `palette()` in `model/src/exterior/index.ts` picks `stone.red` for `#A…`, `#9…` and `#8…`, and `stone.grey` for anything else. A red member colour therefore renders as ashlar texture. Choose it on purpose.
9. **New material names** go into `MATERIAL_NAMES` (`model/src/context.ts`), `MATERIAL_BASE` (`model/src/materials/index.ts`) and `FALLBACK` (`model/src/interior/materials.ts`). The last two are `Record<MaterialName, …>`, so tsc fails until all three agree. The explorer export bakes material colours into vertex colours (`scripts/export-explorer.ts`), so new colours reach it automatically after `pnpm run export:explorer`.

## Workflow: from a question or source to a change

1. **Pin the claim.** Write down what the source says, its id (V/T/R/O ids from research/01 and research/10 §a, LC/PV/PL/LP06 from research/07), the page or section, and the tag it earns. Check the fact sheet and research/09–11 first: often the answer exists and only the model lags behind (history-check OPEN).
2. **Decide the level:** a building fact (catalogue), a period norm (grammar), a colour or material (materials + defaults), new geometry (exterior/ or interior/ builder, plus a layout helper if plans need it), or a spec/contract change (core: `spec.ts`, `validate.ts`, `docs/architecture.md` in the same change).
3. **Implement** following `references/source-to-model.md`. It has the edit points (`EDITS` in `scripts/catalogue-v2/buildings.ts`, `PROGRAMMES` and `FIN` in `scripts/catalogue-v2/programme.ts`, `NEW` buildings in `scripts/catalogue-v2/newBuildings.ts`, `SRC` keys, grammar tables, `MATERIAL_BASE`) and the rebuild order. For construction details and numbers, use `references/period-grammar.md`.
4. **Keep the alternative.** If you overrule an earlier reading (for example the LP06 square pavilion vs the documented round temple), move the old reading into `alternatives` with its tag. Don't delete it.
5. **Verify** (below), then **record**: add a README changelog entry (CLAUDE.md asks for one per shipped change). Update `docs/architecture.md` if an API, field or material changed, and tick the delta in research by adding a line to its section only if the research doc tracks status. Don't commit unless the user asked.

## Verification (before you say "done")

```bash
pnpm exec tsx scripts/catalogue-v2/build.ts     # if catalogue inputs changed: must print 0 errors, 0 programme issues, 0 overlaps
pnpm run test                                   # vitest: model, plans, viewer
pnpm run build                                  # tsc --noEmit + vite build
node .claude/skills/skb-historic-architecture/scripts/history-check.mjs --strict   # integrity passes; your delta now DONE
                                                # (E2 fails on KB-B14 until backlog KB-I02 tags it: pre-existing, not yours)
pnpm run plans --only GR-01 --no-pdf            # re-render the sheets you touched (needs Chrome for PNGs) → docs/plans-preview/
```

**Browser check (required for anything visible).**
- Check that port 5260 isn't already serving another session (`lsof -iTCP:5260 -sTCP:LISTEN`). Reuse a running viewer read-only, or start one with `pnpm run dev` (http://localhost:5260/, not 127.0.0.1).
- Drive the viewer with `window.skb`, because automated tabs are often hidden and rAF is paused:
  ```js
  skb.set('hour', 17.5); skb.set('interiors', true);
  skb.goto('view-ehrenhof'); skb.step(5);   // or 'view-west', 'view-east', a building id 'KB-B01', a room 'KB-B01/B01.2.og-festsaal'
  await skb.gpuBench(20, [1920, 1080])      // GPU ms, calls, triangles; noisy (±50 %), compare within one run
  ```
- Use 17:30 for the west-facing court front and 07:00 for the garden front: the 10:30 default gives flat light (docs/visual-audit.md §2, sun table). Take **before and after** shots at the same pose with the backlog's shot driver, which has both hero hours as poses 14 and 15: `node .claude/skills/skb-improve/scripts/shots.mjs --out <scratchpad>/<topic>-before --poses 03,05,14,15` (append a pose there for a new building or room). Keep full sets in the scratchpad, commit 2–4 pairs to `docs/shots/<KB-Ixx or topic>/`, and look at them yourself before you claim anything.
- The driver uses headless Chrome over CDP, so the Chrome extension is not needed.
- Open a building's info panel by clicking it, and check that the new evidence text and confidence show.
- For an export-visible change, run `pnpm run export:explorer` and say that the explorer side was **not** checked by you (another agent owns it).
- Report honestly what you didn't verify (live walk feel, real frame pacing, colours under all hours).

## "Does it match history?" review

When the user asks "is this right?", or before you finish, go through `references/review-checklist.md`: time slice, massing and roof, facade system, openings, colours, members and stone, roof hardware, site furniture, interiors, evidence display, and plans parity. Answer with three lists: findings with tag and source, what is unknown, and what would settle it (which source; research/09 §7 and research/10 §d list the candidates). Mark guesses as guesses.

## When the user wants "wow"

Pick the levers in research/09 §6.6, plus rotunda, gallery and room facts from research/10 §c. Each of them is both impressive and documented: a croisée glazing grid that catches low sun on slightly uneven crown glass, a limewash patina varied by build year, Hemmer five-point rods and gilt gate tips, sentry boxes in Wittelsbach stripes, the green damask gallery with 20 chandeliers, and the round Ionic Tempelzimmer at the gallery end. Some work belongs to the sibling skills in `.claude/skills/`:
- lighting, sky, post-processing, trees, material look and performance → `skb-visual-wow` (docs/visual-audit.md);
- gardens, avenues, landcover, ponds and garden pavilions → `skb-schlossgarten` (research/11);
- picking and sequencing backlog items (`docs/improvement-backlog.md`) and delegating them → `skb-improve`.

This skill owns what the buildings are, including their colours and joinery facts. When a material colour change is also a look change, agree the hex here and the shading there. Don't mix a lighting change into a history change, or the before/after shots stop showing what the history fix did.

## References

- `references/fact-sheet.md`: global facts, people and dates, per-building facts with deltas, the palette, the interior room list, the do-not-copy list, and a source registry with links. **Read for any content question.**
- `references/period-grammar.md`: 1780s construction and ornament grammar with numbers, and the grammar.ts or material key each value maps to. **Read before changing grammar.ts, facade.ts or interior fixtures.**
- `references/source-to-model.md`: edit points, rebuild order, recipes (rename a room, re-date a building, add a building, add a grammar table, add a material, exclude by epoch), and traps. **Read before editing code or catalogue scripts.**
- `references/review-checklist.md`: the "does it match history?" checklist and the report format.
- `scripts/history-check.mjs`: read-only audit (integrity + 20 tracked research deltas). Extend its `checks` array when new research adds a delta.
