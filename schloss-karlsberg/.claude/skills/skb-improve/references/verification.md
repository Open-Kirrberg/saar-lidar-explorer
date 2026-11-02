# Verification playbook (castle)

"Done" means: the gates are green, the change was seen in rendered images at fixed poses (before and after), the
frame cost was measured, history claims carry tags and sources, and the report says honestly what was not verified.
Paths are relative to the sub-project root `schloss-karlsberg/`.

## 1. Automated gates

```bash
.claude/skills/skb-improve/scripts/verify.sh                  # test + build + catalogue + export (≈ 10 s)
.claude/skills/skb-improve/scripts/verify.sh test build       # just the two hard gates
.claude/skills/skb-improve/scripts/verify.sh warn             # interior warnings (B04/B05 have known ones, KB-I52)
```

- `test`: vitest over `model/tests`, `plans/tests`, `viewer/tests` (224 tests on 2026-11-02). New pure logic needs a
  test: layout helpers, grammar tables, `speciesFor`, epoch filters, EV/blackbody curves, lit-window seeding.
- `build`: `tsc --noEmit` + `vite build`. Type errors fail it.
- `catalogue`: the builder must reproduce `model/catalogue.json` byte for byte with 0 validation errors, 0 programme
  issues and 0 footprint overlaps. The step restores the committed file if it differs, so it never leaves a change
  behind. When you *intend* a catalogue change, run `pnpm exec tsx scripts/catalogue-v2/build.ts` yourself and commit
  the regenerated file together with the builder change.
- `export`: builds the explorer light layer into a temp dir (not into `../app`) and runs the GLTFLoader round trip.
  Baseline: 99 nodes (91 buildings + 8 site), 340 k triangles, 4.65 MB.

## 2. Screenshots at fixed poses

The dev server is the castle viewer on port 5260. Check first that it is ours, and start it only if nothing is
listening (never touch 5240/5250, the explorer's):

```bash
lsof -nP -iTCP:5260 -sTCP:LISTEN                  # then: lsof -p <PID> | grep cwd  → must be …/schloss-karlsberg
pnpm run dev                                      # in the background, only if nothing listens
```

Capture with the skill's headless driver (real GPU via ANGLE/Metal; works when the Chrome extension is not
connected; it hides the panel, waits for `window.skb` and `#status` to clear, then drives `skb.step`):

```bash
node .claude/skills/skb-improve/scripts/shots.mjs --list
node .claude/skills/skb-improve/scripts/shots.mjs --out <scratchpad>/KB-I06-before --poses 01,03,08,10 --bench
# … change …
node .claude/skills/skb-improve/scripts/shots.mjs --out <scratchpad>/KB-I06-after  --poses 01,03,08,10 --bench
node .claude/skills/skb-improve/scripts/shots.mjs --out <dir> --poses 03 --eval "skb.set('shadows', false)"   # runtime A/B
```

- Poses 01–11 are exactly the visual-audit poses (`docs/visual-audit.md` §2), so `docs/visual-audit/*.jpg` is the
  "before" for anything that has not changed since. 12 Karlslust, 13 gallery + E end from the SE at 17:30, 14 Ehrenhof
  at the hero hour 17:30 and 15 the garden front (pose 04's camera) at 07:00 were added for this backlog. **Append**
  new poses (16, 17 …) in `POSES` in `shots.mjs` for a new area (menagerie, Orangerie court, a room); never renumber
  or edit an existing pose.
- **One pose namespace for the backlog.** `skb-visual-wow/scripts/shots.mjs` and
  `skb-schlossgarten/scripts/garden-shots.mjs` are useful for extra domain views, but their ids overlap with
  different cameras (e.g. their 04, 05, 11–13 are not the audit's). Before/after pairs for a backlog item come from this
  script only, and the item names its pose ids from here. Runtime A/B uses `--eval "<js>"` here (the visual-wow script
  calls the same thing `--setup`).
- Renders are deterministic: an unchanged scene gives byte-identical JPEGs (`cmp a.jpg b.jpg`). Use that to prove a
  refactor changed nothing.
- **Look at every image** (Read the JPEG). Check: the feature is there and where the evidence puts it; nothing floats
  or sinks (plinths meet the ground, steps reach the grade); no z-fighting or flicker strips; colours plausible against
  the catalogue hexes; the footer still shows attribution and "Schauen, nicht graben".
- Keep full sets in the scratchpad. Commit **2–4 representative pairs** per item to `docs/shots/KB-Ixx/`
  (`before-<pose>.jpg`, `after-<pose>.jpg`, quality 85 ≈ 0.1–0.4 MB each) and link them from the changelog entry.
- Interactive checks (pointer-lock flight, walking feel, real rAF pacing) can't be automated here. Say so and ask the
  user to try it. If the Chrome extension *is* connected, the same hooks work there: `skb.goto(id)`, `skb.set(key, v)`,
  `skb.step(n)` (automated tabs are often hidden and rAF is paused, so never wait on rAF).

## 3. Performance

`--bench` runs `skb.gpuBench(20, [1920, 1080])` and `[3024, 1964]` per pose (GPU timer query) and writes `bench.json`
plus a markdown table. Headless timings vary ±50 % run to run: compare before/after **from the same session**, repeat
a surprising number, and report ranges, not single digits.

| Budget | Value |
|---|---|
| Any single backlog item | ≤ +1 ms GPU at 1080p unless the item says otherwise |
| Aerial at 3024×1964 after wave 6 | ≤ 12 ms GPU (visual-audit §6 target) |
| Garden work | ≤ +0.5 M triangles net at pose 01 (research/11 §6.4) |
| Light layer | ≤ 6 MB `buildings.glb` |

Baseline 2026-11-02: pose 01 6.0 / 10.6 ms (1080p / retina), 820 calls, 4.36 M triangles; worst audit case 08
golden-hour aerial 21.1 ms retina. Also log `skb.triangles()` and `skb.renderer.info.memory` when geometry changes.

## 4. Numeric and evidence checks

- **Geometry against the layout:** read numbers back, don't eyeball them. Examples: `pnpm exec tsx scripts/dev/ray.ts`
  (raycasts through facade openings), a vitest that checks a new feature lies inside its polygon, `skb.controls.ground(x, z)`
  under a placed object vs its base height.
- **Positions:** anything placed from a period source states its EN coordinates and the uncertainty (± m) in the
  catalogue note; for schematic sources (V23) at most low confidence.
- **Tags:** every new or changed catalogue value, grammar constant and material colour carries D, D→, I, N, U or HMS and
  a source (research doc § or a citation). Grep the diff for new hex colours and numbers without a tag.
- **No invented sources.** If a claim needs a source you have not read, tag it U and add it to the item's open points
  (or KB-I54).
- **Heritage:** no new text gives excavation, detector or find-spot guidance beyond what is already published.

## 5. Report template (to the user, in chat)

- Shipped: KB-Ixx <title> (commit <hash>)
- Evidence: what is now D / D→ / I / N / U, and what changed in the record
- Verified: tests (n), build, catalogue reproduce, export (size, nodes), shots (paths) and what they show, bench
  before → after
- Light layer: re-exported to `../app/public/data/shared/karlsberg1789/`? format unchanged / changed (what)
- Not verified: …
- Try it: http://localhost:5260/ (keys in README), "Gehe zu" entry …
- Next: KB-Iyy because …
