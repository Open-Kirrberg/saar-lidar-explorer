# 🚀 V2 run — orchestrator brief

You are the **orchestrator** for the whole v2 of the Saar LiDAR Explorer, in one long autonomous run. This is a limit-testing experiment: how good a result a long-running, heavily parallel agent run reaches, and how many iterations it takes. Work until the done definition holds, or until only human-blocked items remain. **Do not stop to ask.** Every decision a human had to make is settled below; anything new you decide yourself and record as an ADR.

Repo: `/Users/svenreiser/Documents/Develop/open-kirrberg/saar-lidar-explorer` · start commit `d4aba51` (+ this file) · branch `main`.

## 📚 Read first

1. `CLAUDE.md` (conventions, gates, heritage rules), then the `sle-roadmap` skill (`.claude/skills/sle-roadmap/SKILL.md`): it is your process (plan → delegate → verify → record). This brief **overrides** it where they differ.
2. `PRD.md`, `docs/adr/README.md` and ADRs 0014–0027, `.claude/skills/sle-roadmap/references/roadmap.md` (items V2.0–V2.10 with acceptance).
3. Per item: the specialist skill (`sle-renderer`, `sle-pipeline`, `sle-relict-detection`, castle skills in `zones/schloss-karlsberg/.claude/skills/`) and the module README.

## 🎯 Done definition

v2 is done when **V2.0–V2.9 are `[x]`** in the roadmap, each meeting its acceptance (with the substitutions below), `verify.sh` is green on `main`, and the final report is delivered. **V2.10 (release) is not yours.**

## ✅ Settled decisions (the human-in-the-loop list — do not ask again)

| # | Topic | Decision |
|---|---|---|
| H1 | Scope | V2.0–V2.9. V2.8 includes the bakery (footage exists, see H6). |
| H2 | Data | Ready locally (see "State at start"). If a source breaks, take that layer from the public data repo `https://github.com/Open-Kirrberg/saar-lidar-data` instead of stopping. Before V2.0, diff our `app/public/data/overall/manifest.json` against the published one and note differences. |
| H3 / H14 | Phone | No new hardware. New ADR superseding ADR 0014's reference-phone line: **low-end proxy = Chrome emulation, 4× CPU throttle, 30 fps**; **headroom rule = 60 fps on a Pixel 9**. Real devices are the user's iPhone and Huhn's Pixel 9, tested by the humans at milestones. Agents measure the proxy; never claim real-phone numbers. |
| H4 | F21 / F22 move-out | Move into local sibling folders `../sle-print/` and `../sle-craters-private/`, each its own `git init` repo with history-free copies. No remote, no push. Delete from this repo. Keep public-build guards until the code is gone; crater data never enters this repo again. |
| H5 | Attribution (ADR 0026) | Full attribution shown for a few seconds on load, then collapsed into a „© Quellen“ button that opens an **info dialog with all details**; „© OSM“ stays on the minimap. Research dl-de/by-2-0 + ODbL (OSMF attribution guideline) and write it into ADR 0026 → Accepted (the user pre-approved this variant). If the research says it is not compliant, keep the footer and write why. |
| H6 | Bakery (zone #2, Q-36) | Bäckerei Heusser, Eckstr. 3, 66424 Homburg-Kirrberg; the owner is Huhn (co-owner of this repo) → consent settled. Footage: `/Users/svenreiser/Documents/Develop/DJI_0079.MP4` (DJI action cam, 119 s, 4000×3000, 30 fps, wide-angle: undistort first). Copy it to `data/raw/zones/bakery/` (git-ignored), treat as untrusted input. Shows street → shop interior → courtyard entrance. Decide mesh vs splats on this footage (ADR 0027 → Accepted; lean: mesh first). Georeference against LoD2 + ortho. Close Q-36 in the PRD. |
| H7 | Tree count (V2.4) | Count crowns on the orthophoto for 3 plots yourself (document plots + method); the user spot-checks one plot at M3. |
| H8 | Hallway test (V2.9) | Not yours. Replace with: a scripted first-run walkthrough (fresh profile, 390 px + desktop) that reaches the castle without help; the human test happens after the run. |
| H9 | Look & feel | Your call, reviewed at milestones. Target: readable game HUD over a 3D view that owns the screen; German labels. |
| H10 | New ADRs | Write them as **Accepted**. The user vetoes at milestones. |
| H11 | Push / release | **Never push, never release, never touch remotes or GitHub.** Local commits only. |
| H13 | Privacy in zones | Blur the third-party car licence plate in the bakery footage before reconstruction. No people in zone assets. |

Still respected: heritage rules (hypotheses only, no digging/detector guidance, no "go there", *Mein Standort* frozen), craters/UXO never public (ADR 0010), `docs/` ships publicly (no private locations), pinned versions, contract first, anchored `.gitignore`.

## 📦 State at start

- `app/public/data/overall/` (1.4 GB, incl. ortho, historic, LoD2, OSM, cadastre, candidates, point clouds) + `pois.geojson`; `data/raw` + `data/work/{overall,karlsberg}` (3 GB, GeoTIFFs incl. DTM/DSM for the CHM).
- Castle (moved by V2.6a): `zones/schloss-karlsberg/viewer/public/terrain/`, textures, explorer light layer in `app/public/data/shared/`.
- Disk: ≈ 65 GB free. Keep splat/photogrammetry intermediates under `data/` and delete what you don't need.

## 🕸️ Orchestration

**Two kinds of helpers — pick by the weight of the piece:**

| | Tool | Spawns its own agents | Use for |
|---|---|---|---|
| 👯 Sibling | `delegate_task`, `isolation: "worktree"`, model `claude-opus-5-5`, `fastMode: true` | ✅ | A whole roadmap item or a heavy sub-part (V2.2 shell, V2.4 trees, V2.6+V2.7 zones, V2.8 capture). It plans and fans out on its own. |
| 👶 Child | native `Agent`, `run_in_background: false` | ❌ | Small, bounded pieces: one test file, a docs pass, a search, a review. |

**Effort per task** (`target.options.effort`; default medium):

| `low` | `medium` | `high` | `xhigh` / `max` |
|---|---|---|---|
| Docs, CHANGELOG/ADR rows, removals (V2.1), renames, test wiring | UI components, minimap, tutorial, attribution dialog, pipeline steps | Shell architecture (V2.2), zone contract (V2.6), CHM crown segmentation | 3D + shaders: tree instancing + cross-fade LOD, lens blend, castle-as-zone, photogrammetry georeferencing, performance passes |

**Rules:**
- **Only you merge into `main`**, one item at a time, after `verify.sh` is green on the merged result. Siblings never commit to `main`; they hand back a worktree branch.
- **Ownership by directory.** V2.2 owns `app/src/shell/` + `main.ts` wiring; others build modules behind interfaces and get wired by V2.2 or by you. Contract changes (`docs/data-contract.md`, zone contract) are written by you or by the owning sibling **before** dependents start.
- Every brief: goal + acceptance (copy from the roadmap), files to read, owned directories, settled decisions that apply, gates to run, report format (≤ 300 words, verified vs. not verified).
- Don't poll siblings; follow each task's `next`. Cancel what you replace.
- **No visible Chrome on the user's desktop** (user request): every brief says so. Browser checks and screenshots → T3 preview tools (`preview_open`, `preview_evaluate`, `preview_snapshot`); perf runs need CDP CPU throttling, which the T3 preview lacks → headless Chrome only (`pnpm run perf`, headless by default). Never `--headed`, never `open <url>`.

**Waves** (start everything that is independent at once):

```
Wave A (now):  V2.0 baseline · V2.1 removals · V2.4 pipeline (trees layer + contract) · V2.6 zone contract + ADR · V2.8 capture pipeline (bakery) · ADR 0026 research
Wave B:        V2.2 shell + tiers (after V2.1) · V2.4 renderer (after its contract)
Wave C:        V2.3 minimap · V2.5 lens · V2.7 castle zone (after V2.2 + V2.6) · bakery zone package (after V2.6 + V2.8)
Wave D:        V2.9 tutorial + „© Quellen“ · performance pass on the proxy · cleanup
```

## 🏁 Milestones for the user (don't wait for feedback)

After each milestone: start the dev server (`cd app && pnpm dev --port 5240 --strictPort --host`; castle 5260 if needed; check the port first), open it with the T3 preview tools so it shows in the sidebar, and send the user a short message:

```
🏁 M<n> — <title>
🔗 Desktop: http://localhost:5240/…   📱 Phone (same Wi-Fi): http://<LAN-IP>:5240/…
✅ Test: 3–6 concrete steps, each with the expected result
📏 Proxy numbers: fps / memory / load time (Chrome 4× throttle)
⚠️ Not verified: …
```

| M | Content | The user tests |
|---|---|---|
| M1 | V2.0 + V2.1 | App loads `overall`; F21/F22 gone; baseline numbers on iPhone + Pixel 9 |
| M2 | V2.2 + V2.3 | Standard ≈ 8 controls; tier switch; minimap heading + view cone; phone layout |
| M3 | V2.4 | Trees where the ortho shows crowns (spot-check one plot); no popping in flight; fps over forest |
| M4 | V2.5 | U2: lens on → candidate glows → *Merken* with a note |
| M5 | V2.6 + V2.7 + bakery zone | U1: Kirrberg → portal → castle → Festsaal → back (pose restored); U3: walk through the bakery |
| M6 | V2.9 + final | Tutorial without help; „© Quellen“ dialog; everything above on the phone |

Feedback the user sends in between becomes work items in the next wave. A veto of an ADR = new superseding ADR.

## ✅ Gates and records

- `.claude/skills/sle-roadmap/scripts/verify.sh` (app, castle, docs, pipeline) green before every merge; new pure logic gets tests; rendering gets a browser check with `window.sle.step(n)` and screenshots in the git-ignored `docs/shots/`.
- Per item: tick the roadmap (`[x]` + hash), one CHANGELOG line, ADRs for decisions, module README for details, **one commit per roadmap item** (`V2.4: CHM trees in the overworld`), trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Keep `PRD.md` ≤ 150 lines; close Q-22 (proxy ADR), Q-33 (ADR 0026), Q-36 (bakery) when done.

## 📊 Run log (the experiment)

Keep `docs/shots/v2-run-log.md` (git-ignored): per iteration — time, wave, what was spawned (sibling/child, effort), merged items, failed gates and fixes. An **iteration** = one plan → delegate → verify → merge cycle of yours.

**Final report** to the user: done-definition checklist, iterations, siblings/children spawned (by effort), wall-clock, what was verified vs. not, open risks, and what V2.10 still needs from the humans.
