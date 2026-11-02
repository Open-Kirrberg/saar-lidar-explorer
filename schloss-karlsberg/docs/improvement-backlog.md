# Improvement backlog: Schloss Karlsberg 1789 (history-accurate and beautiful)

Living document, driven by the `skb-improve` skill (`.claude/skills/skb-improve/`). Created 2026-11-02 from
research/09 (building practice), research/10 (source sweep), research/11 (gardens and landscape), the visual audit
(`docs/visual-audit.md`) and the leftovers of review 1 (`docs/review/review-1.md`). Earlier research (01–08) is
referenced where it already covers a point.

**How to use it.** Work top to bottom in the index order unless the user names an item. One item per cycle, or two
whose file sets are disjoint. Tick the status with the commit hash, record measured numbers in the item, and append
newly found problems under "Discovered". Never renumber: new items get the next free id.

**Status:** `[ ]` open · `[~]` partial · `[x]` done (hash) · `[-]` dropped (reason) · `[?]` needs a user decision.

**Field key.** *Why* = the evidence, with project tags (D, D→, I, N, U, HMS, measured). *Payoff* = history / visual,
★ local … ★★★ changes how the whole site reads. *Effort* S (≤ ½ day of agent work), M, L. *Perf* = expected GPU
change at 1080p on the M5 Pro. *Poses* = ids from `.claude/skills/skb-improve/scripts/shots.mjs --list` (01–11 reproduce the audit
poses exactly; 12–15 were added for this backlog). The domain skills' own shot scripts (`skb-visual-wow`,
`skb-schlossgarten`) use different cameras under overlapping ids, so acceptance shots always come from this script. Every item with a visible change needs before/after shots at those poses.

**Baseline (2026-11-02, `shots.mjs --bench`, headless M5 Pro, ±50 %):** 01 aerial west 6.0 ms at 1080p / 10.6 ms at
3024×1964, 820 calls, 4.36 M triangles; 04 garden front 2.4 / 6.9 ms; 06 Festsaal 2.6 / 5.2 ms. Audit worst case:
08 golden-hour aerial 21.1 ms at 3024×1964. Tests: 224 passing. Light layer: 4.65 MB, 99 nodes, 340 k triangles.

**After wave 1 (2026-11-02, same tool, a later session; full table in the README changelog):**

| Pose | 1080p GPU ms | 3024×1964 GPU ms | Calls | Triangles |
|---|---|---|---|---|
| 01 | 8.4 | 22.8 | 509 | 2.40 M |
| 08 | 7.5 | 23.5 | 509 | 2.40 M |
| 13 | 4.7 | 23.6 | 558 | 2.58 M |

Eye-level and interior poses: 1080p 1.9–2.6 ms. Pose 01 "Mittel" (1890×1228): 8.2–9.4 ms. Tests: 271 passing. Light
layer (temp export): 4.55 MB, 97 nodes, 334 k triangles. The retina aerial regression is KB-I55.

**After wave 2 (2026-11-02, `shots.mjs --bench`; before = the final wave-1 state, a different session; full
15-pose table in the README changelog):**

| Pose | 1080p GPU ms before → after | 3024×1964 GPU ms before → after | Calls | Triangles |
|---|---|---|---|---|
| 01 | 3.1 → 5.0–6.1 | 15.4 → 25.1–26.4 | 509 → 568 | 2.40 → 1.26 M |
| 08 | 2.7 → 2.7–6.5 | 7.4 → 21.2–27.0 | 509 → 568 | 2.40 → 1.26 M |
| 12 | 2.4 → 5.9–8.1 | 11.4 → 20.5–22.6 | 289 → 358 | 2.14 → 1.09 M |
| 13 | 2.7 → 2.4 | 4.3 → 20.7–21.8 | 558 → 583 | 2.58 → 1.21 M |
| 03 | 2.2 → 2.0 | 3.4 → 4.0 | 1093 → 1157 | 2.56 → 1.46 M |

Ranges are two runs in this session. Tests: 335 passing in 35 files. Light layer (temp export): 4.57 MB, 98 nodes
(89 buildings + 9 site), 335 k triangles. Triangles halved everywhere, but retina GPU time rose on every pose that
sees much terrain: the per-pixel land-cover splat (KB-I09) now dominates (see Discovered, wave 2). A wave-2 fix
round (land-cover bake, garden and look fixes; poses 16 and 17 added) followed; its final state `wave2-final`
benched 01 2.6 / 16.5 ms, 08 2.4 / 5.8 ms, 12 1.9 / 8.2 ms, 13 2.1 / 3.1 ms (1080p / retina), 1.24–1.61 M triangles.

**After wave 3 (2026-11-02, `shots.mjs --bench`, all 17 poses; before = `wave2-final`, a different session; full
table in the README changelog):**

| Pose | 1080p GPU ms before → after | 3024×1964 GPU ms before → after | Calls | Triangles |
|---|---|---|---|---|
| 01 | 2.6 → 3.1–3.4 | 16.5 → 17.4–18.6 | 592 → 598 | 1.42 → 1.63 M |
| 02 | 2.3 → 2.7–2.9 | 7.1 → 10.9–11.3 | 621 → 639 | 1.35 → 1.78 M |
| 08 | 2.4 → 2.9–3.3 | 5.8 → 14.6–19.6 | 592 → 598 | 1.42 → 1.63 M |
| 12 | 1.9 → 2.7–6.5 | 8.2 → 19.8–20.1 | 383 → 403 | 1.24 → 1.63 M |
| 13 | 2.1 → 2.5–2.8 | 3.1 → 9.2–10.7 | 610 → 628 | 1.35 → 1.68 M |
| 03 | 2.1 → 2.6 | 3.8 → 4.6 | 1168 → 1187 | 1.61 → 1.89 M |

Ranges are two runs in this session (load average 10–14 from parallel agents). Eye-level and interior poses rose
+0.3 to +0.6 ms at 1080p. Tests: 412 passing in 43 files. Light layer (temp export): 5.61 MB, 99 nodes (89 buildings
+ 10 site), 388 k triangles. Retina aerials are still far above 12 ms; the vegetation implementer's same-session A/B
puts ~13 ms of 01's 21 ms retina frame in the terrain and ground shading (KB-I59).

**After wave 4 (2026-11-02, `shots.mjs --bench`, all 24 poses; before = `wave3-final`, a different session; full
table in the README changelog):**

| Pose | 1080p GPU ms before → after | 3024×1964 GPU ms before → after | Calls | Triangles |
|---|---|---|---|---|
| 01 | 3.6 → 2.8–2.9 | 17.6 → 4.3–4.6 | 597 → 747 | 1.68 → 2.14 M |
| 02 | 3.1 → 2.6 | 14.0 → 3.5–3.6 | 636 → 808 | 1.88 → 2.37 M |
| 08 | 3.2 → 2.7 | 20.3 → 4.0 | 597 → 747 | 1.68 → 2.14 M |
| 12 | 3.1 → 2.5–2.6 | 19.5 → 3.8–4.7 | 399 → 520 | 1.74 → 2.21 M |
| 13 | 2.8 → 2.5–2.6 | 16.5 → 3.6–4.1 | 629 → 763 | 1.77 → 2.32 M |
| 03 | 2.8 → 2.7–3.1 | 4.9 → 4.0–4.1 | 1185 → 1359 | 1.99 → 2.47 M |

Ranges are two runs in this session (load average 36–49 from parallel agents). **Every pose is now ≤ 5.0 ms at
3024×1964** (the ≤ 12 ms aerial budget is met with ~7 ms to spare; KB-I59). Calls and triangles rose at every pose
mainly because the terrain depth pre-pass is now counted (+80–120 calls, +0.4–0.5 M triangles), plus roof and court
furniture (KB-I22/I23) and the rotunda (KB-I24). CPU per frame rose 1.0–2.0 ms at 1080p (see Discovered, wave 4).
Tests: 469 passing in 49 files. Light layer (temp export): 5.69 MB, 101 nodes (90 buildings + 11 site), 391 k
triangles.

**After wave 5 (2026-11-02, `shots.mjs --bench`, all 29 poses; before = `wave4-final` (wave 4 plus its review
fixes), a different session; full table in the README changelog):**

| Pose | 1080p GPU ms before → after | 3024×1964 GPU ms before → after | Calls | Triangles |
|---|---|---|---|---|
| 01 | 2.7 → 2.8–2.9 | 4.4 → 4.5–4.7 | 646 → 691 | 1.78 → 1.99 M |
| 02 | 2.4 → 2.7 | 3.4 → 3.5–3.6 | 684 → 725 | 1.99 → 2.20 M |
| 08 | 2.6 → 2.9 | 4.5 → 5.1–5.3 | 646 → 691 | 1.78 → 1.99 M |
| 12 | 2.5 → 2.6–2.9 | 7.8 → 6.4–9.3 | 412 → 439 | 1.83 → 1.98 M |
| 13 | 2.3 → 2.5–2.6 | 4.1 → 3.9–4.0 | 685 → 703 | 1.86 → 2.02 M |
| 03 | 2.7 → 2.8 | 3.9 → 4.3–4.4 | 1285 → 1448 | 2.09 → 2.35 M |
| 21 | 2.4 → 2.7 | 4.4 → 4.8–5.4 | 1219 → 1325 | 1.30 → 1.45 M |

Ranges are two runs in this session (the second on 11 poses; load average 50–70 from parallel agents). Every pose
is ≤ 2.9 ms at 1080p and ≤ 5.7 ms at 3024×1964 except 12 (6.4 and 9.3 ms in two runs; the sky-cloud cost of
Discovered, wave 4), so the ≤ 12 ms aerial budget holds. Across sessions 1080p rose +0.1 to +0.4 ms per pose; the
implementers' same-session A/Bs put each item within +0.5 ms (KB-I26/I27 +0.48 ms worst at 21, garden detail +0.10
to +0.24 ms, lanterns 0). Tests: 543 passing in 56 files. Light layer (temp export): **5.93 MB** of 6 MB, 104 nodes
(92 buildings + 12 site), 406 k triangles (KB-I62).

**After wave 6 (2026-11-02, `shots.mjs --bench`, all 37 poses; before = `wave5-final` (wave 5 plus its review
fixes), a session about an hour earlier; full table in the README changelog):**

| Pose | 1080p GPU ms before → after | 3024×1964 GPU ms before → after | Calls | Triangles |
|---|---|---|---|---|
| 01 | 3.1 → 4.0–4.3 | 5.6 → 6.8–7.3 | 709 → 739 | 2.07 → 2.11 M |
| 08 | 3.1 → 4.0–4.2 | 5.2 → 5.3–5.7 | 709 → 739 | 2.07 → 2.11 M |
| 12 | 2.8 → 3.9–4.1 | 10.1 → 6.6–7.0 | 442 → 464 | 2.00 → 2.15 M |
| 13 | 2.6 → 3.8–3.9 | 4.5 → 4.9–5.2 | 702 → 751 | 2.01 → 2.33 M |
| 03 | 2.9 → 4.0–4.3 | 4.6 → 5.4–5.6 | 1476 → 1553 | 2.47 → 2.71 M |
| 21 | 2.9 → 3.7–4.0 | 5.6 → 7.5–9.3 | 1332 → 1393 | 1.50 → 1.56 M |
| 33 | 2.2 → 3.5–3.9 | 3.2 → 8.0–8.2 | 510 → 561 | 1.83 → 2.16 M |
| 34 | 2.5 → 3.9–4.2 | 13.5 → 9.7–10.1 | 434 → 510 | 1.91 → 2.20 M |

Ranges are three runs in this session (load average ≈ 60 from parallel agents). Every pose rose +0.6 to +1.5 ms at
1080p, which matches the post chain's same-session cost (KB-I41: +1.0…+1.4 ms) plus the leaf cards (KB-I44:
+0.2…+0.5 ms). **The aerial budget holds:** every aerial pose is ≤ 7.3 ms at 3024×1964 with Hoch and ≤ 7.0 ms with
Mittel (01 7.0, 02 5.1, 08 4.9, 12 6.3, 13 5.0, 26 6.6, 36 5.5 ms; `wave6-mittel`). Retina rose at eye level and
indoors (19 3.1 → 7.1, 33 3.2 → 8.0, 21 5.6 → 7.5–9.3 ms) and CPU rose +0.7 to +1.4 ms at every pose (Discovered,
wave 6 → KB-I65). Tests: 621 passing in 64 files. Light layer (temp export): 5.90 MB of 6 MB, 105 nodes (93 buildings
+ 12 site), 405 k triangles.

**After wave 7 (2026-11-02, `shots.mjs --bench`, all 45 poses, three runs in one session (min / median); before =
`wave6-final` (wave 6 plus its review fixes), a single run in another session; full table in the README changelog):**

| Pose | 1080p GPU ms before → after | 3024×1964 GPU ms before → after | Calls | Triangles |
|---|---|---|---|---|
| 01 | 5.7 → 4.8 / 4.9 | 6.8 → 6.8 / 6.8 | 754 → 768 | 2.49 → 2.64 M |
| 08 | 4.9 → 4.6 / 4.7 | 6.5 → 6.8 / 7.0 | 754 → 768 | 2.49 → 2.64 M |
| 12 | 4.6 → 4.2 / 4.3 | 6.0 → 5.2 / 5.3 | 475 → 492 | 2.54 → 2.74 M |
| 03 | 6.0 → 4.0 / 4.1 | 5.8 → 4.9 / 5.2 | 1557 → 653 | 3.05 → 2.67 M |
| 21 | 4.0 → 2.6 / 2.6 | 10.9 → 4.1 / 4.6 | 1394 → 998 | 1.56 → 1.35 M |
| 33 | 5.1 → 3.6 / 3.7 | 7.5 → 5.0 / 5.5 | 566 → 583 | 2.41 → 2.51 M |
| 34 | 5.1 → 3.9 / 4.0 | 8.1 → 6.4 / 6.5 | 539 → 547 | 2.65 → 2.67 M |
| 40 (new) | 3.0 / 3.8 | 6.5 / 6.7 | 286 | 1.72 M |

Load average 22–37 from parallel agents. Every pose but 19 is faster or equal at 1080p (−0.1…−2.0 ms; 19 +0.1 ms, it now draws the outdoor vegetation,
KB-I60), mainly KB-I65
(interiors drawn as shells from outside, idle point lights skipped, sky cube): calls at 03 / 09 / 14 fell 1557 → 653
and CPU per frame 6.3 → 2.7 ms. **Every pose is ≤ 7.1 ms at 3024×1964** (aerial budget 12 ms; eye level and
interiors ≤ 6.5 ms). Same-session A/Bs: vines +0.95…1.45 ms at 1080p at pose 40 (over budget, KB-I35), forest mid
crowns ≤ +0.25 ms (KB-I66). Three consecutive runs gave byte-identical JPEGs at all 45 poses (KB-I64). Tests: 708
passing in 76 files. Light layer (temp export): **4.17 MB**, 114 nodes (102 buildings + 12 site), 406,853 triangles,
int16 positions (KB-I62).

**After wave 8 (2026-11-02, `shots.mjs --bench`, all 52 poses, three runs in one session (min / median); before =
`wave7-final` (wave 7 plus its review fixes), a single run in another session; full table in the README changelog):**

| Pose | 1080p GPU ms before → after | 3024×1964 GPU ms before → after | Calls | Triangles |
|---|---|---|---|---|
| 01 | 6.1 → 5.6 / 5.9 | 21.4 → 7.2 / 7.7 | 774 → 837 | 2.70 → 2.71 M |
| 08 | 6.2 → 5.6 / 5.6 | 15.4 → 7.4 / 7.8 | 774 → 837 | 2.70 → 2.71 M |
| 12 | 5.8 → 5.0 / 5.2 | 14.8 → 5.8 / 6.1 | 499 → 508 | 2.87 → 2.87 M |
| 03 | 5.1 → 4.6 / 4.8 | 6.8 → 5.7 / 5.9 | 655 → 681 | 2.73 → 2.73 M |
| 19 | 5.6 → 3.6 / 3.7 | 4.9 → 5.7 / 6.0 | 634 → 677 | 2.31 → 2.32 M |
| 34 | 5.2 → 4.5 / 4.7 | 16.7 → 6.2 / 6.6 | 550 → 563 | 2.74 → 2.75 M |
| 41 | 3.8 → 5.0 / 5.2 | 14.8 → 7.1 / 7.4 | 353 → 373 | 1.46 → 1.47 M |
| 52 (new) | 4.2 / 4.3 | 7.3 / 7.6 | 848 | 2.71 M |

Load average 14–17. The `wave7-final` retina numbers carried the `flat`-varying glass regression (KB-I65, ≈ 10 ms per
frame on ANGLE/Metal); with it fixed **every pose is ≤ 7.9 ms at 3024×1964** (aerial budget 12 ms met again; 01 / 08
were 21.4 / 15.4). At 1080p every pose is faster or within +0.3 ms except 41 (+1.2 ms against a single earlier run;
the garden A/B puts its change at ≤ +0.4 ms, Discovered). Interiors 06–29 are pixel-equal to `wave7-final` (≤ 0.05/255)
and all 52 poses were byte-identical over three runs. Tests: 784 passing in 83 files. Light layer (temp export):
**4.37 MB**, 116 nodes (103 buildings + 13 site), 425,045 triangles.

**After wave 9 (2026-11-02, `shots.mjs --bench`, all 52 poses, three runs in one session (min / median); before =
`wave8-final` (wave 8 plus its review fixes), a single run in another session; full table in the README changelog):**

| Pose | 1080p GPU ms before → after | 3024×1964 GPU ms before → after | Calls | Triangles |
|---|---|---|---|---|
| 01 | 5.7 → 5.6 / 5.7 | 7.5 → 7.3 / 7.4 | 837 → 843 | 2.71 → 2.73 M |
| 08 | 5.8 → 5.5 / 5.5 | 7.4 → 7.3 / 7.5 | 837 → 843 | 2.71 → 2.73 M |
| 16 | 4.2 → 4.3 / 4.4 | 4.7 → 5.4 / 5.4 | 748 → 760 | 3.02 → 3.15 M |
| 23 | 2.0 → 2.0 / 2.0 | 6.0 → 4.6 / 5.2 | 535 → 534 | 0.87 → 0.89 M |
| 33 | 4.5 → 4.2 / 4.4 | 5.7 → 6.6 / 7.2 | 649 → 662 | 2.66 → 2.77 M |
| 34 | 4.6 → 4.5 / 4.6 | 6.3 → 6.7 / 6.7 | 564 → 569 | 2.75 → 2.87 M |
| 39 | 2.9 → 2.8 / 3.0 | 5.8 → 6.7 / 7.4 | 392 → 392 | 1.54 → 1.64 M |
| 41 | 5.2 → 3.6 / 5.2 | 7.5 → 7.6 / 7.8 | 374 → 374 | 1.47 → 1.57 M |
| 47 | 4.8 → 4.5 / 4.7 | 6.0 → 7.1 / 7.5 | 705 → 712 | 2.89 → 2.99 M |

Load average 19–39 (other agents' headless Chromes). At 1080p every pose is within −0.4…+0.1 ms of `wave8-final`
(medians). **Every pose is ≤ 7.8 ms at 3024×1964** (median; max 41 7.8, 08 / 47 7.5, 39 7.4): the 8 ms retina target
holds, but with little room. Retina rose where the new grass blades fill the lower frame (04 / 15 +0.6, 16 / 17
+0.7, 46 +0.7, 33 +0.9…1.5, 39 +0.9…1.6, 47 +1.1…1.5 ms; garden A/B: blades +0.6…1.6 ms retina, ≤ +0.19 ms 1080p) →
KB-I78. Interiors fell at retina (06 6.3 → 3.6, 22 7.4 → 3.7, 27 7.0 → 3.6 ms min) with the room mirrors on, so the
single `wave8-final` interior numbers were noise. All 52 poses byte-identical over the three runs. Tests: 852 passing
in 93 files. Light layer (temp export): **4.32 MB**, 117 nodes (103 buildings + 14 site), 422,389 triangles.

**Shots.** The wave-1 `after-*.jpg` in `docs/shots/KB-I03…I15/` show the final wave-1 state (`wave1-final`, the
"before" of wave 2), not the first wave-1 run. Wave-2 follow-ups on wave-1 items are `after-wave2-<pose>.jpg` in the
same folder; their "before" is that folder's `after-<pose>.jpg`. The wave-2 `after-*.jpg` (KB-I09…I13) and all
`after-wave2-*.jpg` now show `wave2-final` (after the wave-2 fix round; they first came from the pre-fix
`wave2-after`). Wave-3 pairs (`docs/shots/KB-I16/…`) compare `wave2-final` with `wave3-after`; `*-crop-*.jpg` are
1:1 crops of the 1920 × 1080 frames. Wave-4 pairs (`docs/shots/KB-I18`, `I20/*-wave4-*`, `I22`–`I25`, `I59`) compare
`wave3-final` with `wave4-after`; poses 18–24 are new, so they have `after-*` only (KB-I24, KB-I25). Wave-5 pairs
(`docs/shots/KB-I26`, `I27`, `I32`–`I34`, `I36`, `I43`, `I61`, `I35/*-wave5-*`) compare `wave4-final` with
`wave5-after`; poses 26–29 are new (`after-*` only). `after-eye-*`, `after-9m-*` and `after-12m-*` in KB-I33, I34 and
I36 are the garden implementer's extra views (not reproducible from `shots.mjs` until KB-I63 appends them). KB-I46
and KB-I47 hold the experience implementer's tour frames and the example still. Wave-6 pairs compare `wave5-final`
with `wave6-after`: new folders `docs/shots/KB-I21`, `I28`, `I29`, `I37`, `I41` use `before-*` / `after-*`; existing
folders get `*-wave6-*` (`KB-I26`, `I34`, `I43`, `I44`, `I46`, `I63`). Poses 35–37 are new (`after-*` only).
`KB-I37/after-kw-eye-custom.jpg` and the `KB-I46/*-wave6-goldene-stunde-*` pair are the look implementer's custom
views (Karlsbergweiher at eye level; `skb.tour('goldene-stunde', 0.7)`), not `shots.mjs` poses. Wave-7 pairs compare `wave6-final` with `wave7-after`: new folders `docs/shots/KB-I30`,
`I31`, `I39`, `I60`, `I66` use `before-*` / `after-*`; existing folders get `*-wave7-*` (`KB-I35`, `I37`, `I42`, `I45`,
`I06`). Poses 39–45 are new (`after-*` only). `KB-I06/*-wave7-kino-*` are the look implementer's tour frames
(`skb.tour('goldene-stunde', 0.3)` and a sunward 18:45 Kino view), not `shots.mjs` poses. Wave-8 pairs compare `wave7-final` with `wave8-after`
(1280 px; crops 1:1): new folders `docs/shots/KB-I48`, `I50`, `I52`, `I70`, `I72` use `before-*` / `after-*`; existing
folders get `*-wave8-*` (`KB-I14`, `I22`, `I32`, `I35`, `I39`, `I45`, `I66`, `I68`, `I71`). Poses 46–50, 52, 53 are new
(`after-*` only). The look owner's custom frames (tour Anflug, far-shadow A/Bs, Festbeleuchtung Ehrenhof) are in
`docs/review/wave8-look/`. Wave-9 pairs compare `wave8-final` with `wave9-after` (1280 px; crops 1:1): new folders
`docs/shots/KB-I75`, `I76`, `I77` use `before-*` / `after-*`; existing folders get `*-wave9-*` (`KB-I12`, `I43`, `I45`,
`I71`, `I72`); the architecture owner's side-by-side crops are `wave9-*-before-after.jpg` in `KB-I22`, `I24`, `I32`,
`I72`. No new poses in wave 9 (next free pose number 56; reserved 54–62 unused).

**Budgets.** Aerial ≤ 12 ms GPU at 3024×1964 after the polish wave; any single item ≤ +1 ms at 1080p unless the item
says otherwise; light layer ≤ 6 MB; triangles net ≤ +0.5 M at pose 01 for garden work (research/11 §6.4).

---

## Index (recommended order)

| Id | Title | Wave | Domain skill | Payoff hist/vis | Effort | Perf | Status |
|---|---|---|---|---|---|---|---|
| KB-I01 | Viewer pose and look hooks for reproducible reviews | 0 | visual-wow | – / ★ | S | 0 | [x] (uncommitted) |
| KB-I02 | Catalogue fact fixes (names, dates, tags, sources) | 0 | historic-architecture | ★★ / – | S | 0 | [x] (uncommitted) |
| KB-I03 | Epoch field: show the summer-1789 state only | 0 | historic-architecture | ★★ / ★ | M | 0 | [~] re-export pending |
| KB-I04 | Shadow caching and soft radius | 1 | visual-wow | – / ★ | S | −1…−4 ms | [x] (uncommitted) |
| KB-I05 | Render scale and quality presets | 1 | visual-wow | – / ★ | S | −30…−45 % retina | [x] (uncommitted) |
| KB-I06 | Calibrated light budget (sun, sky IBL, exposure, twilight) | 1 | visual-wow | – / ★★★ | M | ~0 | [x] (uncommitted; shade ratio met in the wave-2 review fix; wave 7: Kino golden hour) |
| KB-I07 | Height fog and sky-matched haze | 1 | visual-wow | – / ★★★ | S | ~0 | [x] (uncommitted) |
| KB-I08 | Hero hour and time presets | 1 | visual-wow | – / ★★ | S | 0 | [x] (uncommitted) |
| KB-I15 | Exterior palette: blue-grey shutters, bluer slate, painted render members | 1 (quick win) | historic-architecture | ★★ / ★★ | S | 0 | [~] re-export pending |
| KB-I14 | Ground colours: Buntsandstein gravel, sand, hay, fields | 1 (quick win) | schlossgarten | ★ / ★★ | S | 0 | [x] (uncommitted; wave 8: class 12 in use, 748 cells; yellow parterre sand) |
| KB-I55 | Wave-1 aerial GPU regression: diffuse sky via SH probe, PMREM on glossy only | 1 (follow-up) | visual-wow | – / ★ | S-M | −5…−12 ms retina aerial | [x] (uncommitted; goal met via KB-I59, PMREM split not done: no A/B gain) |
| KB-I59 | Terrain and ground shading cost at retina | 1 (follow-up) | visual-wow | – / ★ | M | −5…−10 ms retina aerial | [x] (uncommitted; review fix: static pre-pass bound + frozen matrices, −0.5…−0.9 ms CPU) |
| KB-I09 | 1789 land cover instead of today's forest | 2 | schlossgarten | ★★★ / ★★★ | L | −2…−6 ms | [x] (uncommitted) |
| KB-I10 | Forest tiling, culling and impostors | 2 | visual-wow | – / ★ | M | −3…−9 ms aerial | [x] (uncommitted; aerial budget met via KB-I59) |
| KB-I11 | Tree species, shapes and young avenue trees | 2 | schlossgarten | ★★ / ★★ | M | +0…0.3 ms | [x] (uncommitted) |
| KB-I12 | Herzogsgarten: Petri's lawn garden replaces the TF-09 parterre | 2 | schlossgarten | ★★★ / ★★★ | L | +0.3 ms | [x] (uncommitted; wave 9: Petri framing groups TF-45…49, hypothetical / low, poses 16 / 17 / 33; wave-9 review fix: Heister limes, green tall shrubs, conifer at the 16/17 edge, poplars 7 m off the jet sightline) |
| KB-I13 | Axial basin with fountain and two stag heads | 2 | schlossgarten | ★★ / ★★★ | S | +0.1 ms | [~] re-export pending |
| KB-I56 | Land-cover look: soft class edges, meadow and lawn, fields, micro-relief | 2 (follow-up) | schlossgarten + visual-wow | ★ / ★★ | M | ~0 (re-bench) | [x] (uncommitted; wave-8 review fix: meadow / lawn near detail and the far vineyard, see KB-I45 / KB-I73) |
| KB-I57 | Hinterland hedgerows and farmstead orchards | 2 (follow-up) | schlossgarten | ★ / ★★ | M | ≤ +0.9 ms (all site vegetation) | [x] (uncommitted) |
| KB-I16 | French two-leaf casements and class-aware glazing | 3 | historic-architecture | ★★ / ★★ | M | +0.1 ms | [x] (uncommitted) |
| KB-I17 | Plain wings: surrounds, flat Lisenen, no string course | 3 | historic-architecture | ★★ / ★ | S | 0 | [x] (uncommitted) |
| KB-I18 | Roof detail: Biberschwanz scale, lead decks, pavilion covers | 3 | historic-architecture | ★ / ★ | S | 0 | [x] (uncommitted; lead-deck rule inert, see Discovered) |
| KB-I19 | Limewash, stone and slate variation; light weathering | 3 | visual-wow | ★ / ★★ | M | ~0 | [x] (uncommitted) |
| KB-I20 | Baked vertex AO in the generator | 3 | visual-wow | – / ★★★ | M | 0 | [x] (uncommitted) |
| KB-I21 | Fachwerk flag for timber-framed buildings | 3 | historic-architecture | ★★ / ★ | M | 0 | [x] (uncommitted) |
| KB-I22 | Roof furniture: Hemmer rods, downpipes, weather vanes | 3 | historic-architecture | ★★ / ★★ | M | +0.1 ms | [x] (uncommitted; wave 8 + review fix: ridge-end masts only, scaled to the roof, level NDB Fünfspitz head, none on chimneys or huts; wave 9: gilt knob with spike and four short points, masts 1.2–3.0 m, 0.5 m points under 120 m²) |
| KB-I23 | Court furniture: Ehrenhof grille, cobbles, sentry boxes, basins | 3 | historic-architecture | ★★ / ★★ | M | +0.1 ms | [~] Marstall basin, Küchenhof pump need located sources |
| KB-I24 | Gallery 97 m, Ionic Tempelzimmer rotunda, colonnade, library pavilion | 4 | historic-architecture | ★★★ / ★★ | L | +0.1 ms | [~] re-export pending (+ KB-I60); wave 9: Ionic bases and capitals on the inner pilasters (19) |
| KB-I25 | Room programme moves (B02, B03, B04, B05) | 4 | historic-architecture | ★★★ / ★ | L | 0 | [x] (uncommitted) |
| KB-I60 | Exposure inside glazed garden rooms (Tempelzimmer) | 4 (follow-up) | visual-wow | – / ★★ | S | 0 | [x] (uncommitted) indoor look only with an interior model; shell lift |
| KB-I61 | 1789 terrain re-run for the rotunda, colonnade and Bibliothekspavillon | 4 (follow-up) | schlossgarten | ★ / ★★ | S | 0 | [x] (uncommitted) |
| KB-I26 | State-room finish system (Tapetenleisten, dado, parquet, supraportes) | 4 | historic-architecture | ★★ / ★★★ | M | +0.2 ms | [x] (uncommitted; wave 6: Louis-seize chimneypieces, faience column stove) |
| KB-I27 | Named room colours, collection rooms, gallery interior | 4 | historic-architecture | ★★★ / ★★ | M | +0.3 ms | [x] (uncommitted) |
| KB-I28 | Orangerie: white joinery, Komödienhaus annex, workshops | 4 | historic-architecture | ★★ / ★ | M | 0 | [x] (uncommitted, wave-6 review fix) |
| KB-I29 | Menagerie: 19 slate-roofed houses, terrace rows, island pavilion | 4 | historic-architecture | ★★ / ★★ | M | +0.1 ms | [x] (uncommitted, wave-6 review fix) |
| KB-I30 | Unplaced items and new staffage entries (zones only) | 4 | historic-architecture | ★★ / ★ | M | 0 | [x] (uncommitted) KB-B89/90/91 placed as hypotheses, UP-19…25 as zones; wave-7 review fix: Monopteros order and dome; wave 8 (garden): Felsenpfad KB-W8 and the translucent aerial (pose 48); Sammelbecken not drawn (no LiDAR basin) |
| KB-I31 | S-wing Altan | 4 | historic-architecture | ★ / ★ | S | 0 | [x] (uncommitted) KB-B02a hypothetical; pose 42; wave-7 review fix: portes-fenêtres, 2 axes, base courses, entablature |
| KB-I32 | Garden pavilions behind the palace | 5 | schlossgarten | ★★ / ★★ | M | +0.1 ms | [x] (uncommitted) 2 round pavilions hypothetical; KB-B87 stepped dome + setting (review fix); wave 8: KB-B28 Pavillon zu Carlsberg + apse KB-B28a, pose 50; octagon not placed (U); wave 9: KB-B28 sides fixed (door and windows W, blank E wall behind the apse), flatter calotte |
| KB-I33 | Benches, sculpture, aviaries | 5 | schlossgarten | ★ / ★★ | S | +0.1 ms | [~] (uncommitted) 19 benches + Flora herm; aviaries U |
| KB-I34 | Parterre à l'angloise for TF-08 and TF-15, treillage, tubs | 5 | schlossgarten | ★★ / ★★ | M | +0.2 ms | [x] (uncommitted; review fix: treillage, thinning; pose 30; wave 6: framed treillage joinery, sparse plantings; wave-6 review fix: clipped glossy citrus with fruit) |
| KB-I35 | Vineyard (LP06 30) | 5 | schlossgarten | ★★ / ★★ | M | +0.1 ms | [~] (uncommitted) 3D stakes and vines within 170 m, crisp edge; wave-7 review fix: one material at the hand-over, slim grey stakes, smooth close clumps; +0.9…1.45 ms (min) at 1080p at pose 40 under load ~28, budget still not shown; wave 8: row groups, lighter far parcel, still a dark decal from the air → KB-I73 |
| KB-I36 | Kitchen gardens and the Holländische Gärtnerei | 5 | schlossgarten | ★★ / ★★ | M | +0.2 ms | [x] (uncommitted; review fix: lean-to glasshouses, lighter crops; pose 32; wave-7 review fix: lapped crown-glass panes, chimneys, night-mats; hotbeds open) |
| KB-I37 | Water: pond edges, jets, reflections | 5 | schlossgarten + visual-wow | ★ / ★★ | M | +0.5…2 ms when active | [~] (uncommitted) SSR, wet banks, jet spray, pose 39 done; SSR comb stripes (KB-I69), Schwanenweiher jet and Findlinge open |
| KB-I38 | Herzogskastanien grove | 5 | schlossgarten | ★ / ★ | S | +0.05 ms | [x] (uncommitted) |
| KB-I39 | Karlslust follies of 1789 | 5 | schlossgarten | ★★ / ★★ | M | +0.1 ms | [x] (uncommitted) KL-B50…53 hypothetical; Eremitage not 1789; poses 43, 44; wave-7 review fix: finial, tent palette, hay load; wave 8: KL-B50 double up-swept roof, folly facades without shutters |
| KB-I40 | Park boundary: Wildzaun and gatehouses | 5 | schlossgarten | ★ / ★ | S | 0 | [ ] blocked: no located Wildzaun line; evidenced barrière → KB-I68 |
| KB-I58 | Roadside avenues on the chaussée to Homburg and the Homburg–Erbach road | 5 | schlossgarten | ★ / ★ | S | +0.1 ms | [ ] needs a located source |
| KB-I63 | Garden detail at eye level: flowers, bean rows, herm, shrub limbs; garden shot poses | 5 (follow-up) | schlossgarten | ★ / ★★ | S-M | ~0 | [x] (uncommitted) poses 30–34, rounded flowers, lighter beans; wave 6: lathed herm, shrubs without limbs |
| KB-I41 | Post chain: AO, SMAA, bloom, tone mapping, looks | 6 | visual-wow | – / ★★★ | M | +2…3.5 ms | [x] (uncommitted) own chain, +1.0…1.4 ms |
| KB-I42 | Glass: crown-glass tint and jitter, far reflections, interior mapping | 6 | visual-wow | ★ / ★★★ | M | +0.2 ms | [x] (uncommitted; wave 7: interior mapping, review fix: catalogue rooms, inside view restored; far reflections stay env-only) |
| KB-I43 | Night: lit windows, lanterns, candles, Fest chandeliers | 6 | visual-wow | ★ / ★★★ | M | +0.3 ms | [x] (uncommitted; review fix: scotopic shift, chandeliers only with "Fest", flames on all candles; wave 6: lantern pools, glass-dressed chandeliers; wave 9: night sky seam at 52 fixed) |
| KB-I44 | Tree look near the camera | 6 | visual-wow | – / ★★ | M-L | +0.5…1.5 ms | [x] (uncommitted; wave 6: leaf cards with procedural atlas) |
| KB-I45 | Ground detail: wear masks, lawn variation, hedge bevels | 6 | visual-wow | – / ★★ | M | ~0 | [x] (uncommitted) lawn variation, worn verges, hedge bevels; wave 8: Ehrenhof wear bands, turning sweep, plinth damp, polished track cobbles; wave-8 review fix: near lawn / meadow grain within 32 m, meadow regrowth patches, KB-L2 rotunda lawn; wave 9: grass blades within 22 m, isotropic Ehrenhof wear (lawn look and retina cost → KB-I78) |
| KB-I46 | Rundflug (scripted fly-around) | 6 | visual-wow | – / ★★★ | M | 0 | [x] (uncommitted; review fix: higher Anflug, Galerie arc, W golden hour, Kino grade, occlusion test; wave 6: Kino low-sun grade) |
| KB-I47 | Photo mode | 6 | visual-wow | – / ★★ | S-M | stills | [x] (uncommitted; review fix: full footer credit burned in; wave-7 fix: DOF capped, credit research/01–11) |
| KB-I48 | Festbeleuchtung and the "Dezember 1785" scene | later | visual-wow + historic-architecture | ★★ / ★★★ | L | +0.3 ms | [~] (uncommitted, wave 8: Festbeleuchtung mode done; review fix: rotunda rings only on KB-B13 in 1785; the 1785 scene year open; wave 9: logged as not cheap, Decisions log) |
| KB-I49 | Physically based atmosphere | later | visual-wow | – / ★★ | L | +1…2 ms | [ ] |
| KB-I50 | Static far shadow map or CSM | later | visual-wow | – / ★★ | M-L | +1…3 ms | [x] (uncommitted, wave 8: static far map, ≤ +0.45 ms) |
| KB-I51 | WebGPU / TSL migration | parked | visual-wow | – / ★★★ | L | ? | [-] |
| KB-I52 | Review-1 leftovers | any | – | ★ / ★ | S | 0 | [x] (uncommitted; wave 8: `warn` [] everywhere, SC-02 title, TF-08 wall foot, B02 forecourt pad; pose 49) |
| KB-I53 | CdL massing check and concealed stair | later | historic-architecture | ★★ / ★ | M | 0 | [x] (uncommitted) massing kept, research/10 §d.4 |
| KB-I54 | Source acquisition (requests from research/09–11) | any | historic-architecture | ★★★ / – | – | – | [?] |
| KB-I62 | Light-layer headroom before more exported geometry | any | – | – / ★ | S | 0 | [x] (uncommitted) int16 positions: 5.88 → 4.11 MB; 4.17 MB after wave 7 |
| KB-I64 | Deterministic shots again (animation clocks, a lighting flake at 21) | any | visual-wow | – / ★ | S | 0 | [x] (uncommitted) review clock, stale shadow fixed |
| KB-I65 | Sky and post cost at retina (eye level, interiors) and CPU per frame | 6 (follow-up) | visual-wow | – / ★ | M | −2…−5 ms retina eye level | [~] (uncommitted; wave 7: lights only when burning, shell interiors from outside, sky cube; wave 8: `flat`-varying retina regression fixed; 19/21/33 ≤ 6 ms retina (median), 34 6.2 / 6.6, aerials 7.2–7.8 ms; wave 9: all poses ≤ 7.8 ms retina, 34 6.7 / 6.7, 33 7.2 with the grass blades) |
| KB-I66 | Forest crowns at 150–300 m and conifer whorls | 6 (follow-up) | visual-wow | – / ★★ | M | ≤ +0.5 ms | [x] (uncommitted; wave-6 review fix + wave 7: mid-crown leaf relief and silhouette fringe; wave 8: the ≈ 320 m band softened) |
| KB-I67 | Menagerie setting: terrace ground, beech wood, island pavilion as hypothesis | 4 (follow-up) | schlossgarten | ★ / ★ | S | 0 | [x] (uncommitted, wave-6 review fix) |
| KB-I68 | Barrière at the valley entrance and the court-mouth post-and-rail fence | 5 (follow-up) | schlossgarten + historic-architecture | ★ / ★ | S | 0 | [x] (uncommitted; wave 8: KB-F1 post-and-rail, KB-F2 barrière, poses 46 / 47; wave 9: KB-V1 forecourt low-passed; wave-9 review fix: graded walled carriage drive KB-V2 (9.8 %) to the grille, KB-V1 a planar forecourt strip, humps gone) |
| KB-I69 | Water SSR comb stripes | 6 (follow-up) | visual-wow | – / ★★ | S | ≤ +0.2 ms | [x] (uncommitted; wave-7 fix: DDA march + ripple LOD) |
| KB-I70 | Tempelzimmer from inside: see-through glass doors, closed openings | 4 (follow-up) | historic-architecture + visual-wow | ★ / ★★ | S | 0 | [x] (uncommitted; look: glass doors + exposure; wave 8 architecture: doors fill the openings, single outward glass, Granitsaal, banquette) |
| KB-I71 | Setting of the wave-7 follies and the V23 terrain items | 5 (follow-up) | schlossgarten | ★ / ★★ | M | ~0 | [x] (uncommitted) serpentine walks, shrub backdrops, Monopteros lawn, KB-B91 well and track; wave 8: Felsenpfad KB-W8, translucent aerial pose 48; Sammelbecken and Vogeltränke not drawn (reasoned); wave-8 review fix: Felsenpfad a trodden earth footpath on the contour with Buntsandstein outcrops, not painted into the ground, no tree moved (test); wave 9: loose edge stones, breathing tread |
| KB-I72 | CdL emphasis: court portal frame, N-wing porch, Festsaal garden balcony | 3 (follow-up) | historic-architecture | ★★ / ★★ | M | +0.1 ms | [x] (uncommitted; wave 8 frame + review fix: 10-step perron, sentries at its foot, N-wing porch, wing-centre and Festsaal balconies, AN-01/02 + GR; wave 9: perron across the three centre axes in grey-pink treads with pale nosings; wave-9 review fix: back to frame + 0.9 m with no LC tag (HMS short stair, N width), darker risers + step-corner AO, sentries on the piers) |
| KB-I73 | Vineyard far parcel reads as a dark decal from the air | 5 (follow-up) | schlossgarten + visual-wow | – / ★★ | S | ~0 | [x] (uncommitted; wave-8 review fix: far rows as box-filtered stripes over red-brown soil, parcel 0.91 of the meadow at 01, soft edge) |
| KB-I74 | Low-sun warmth and sky fill (golden hour, both looks) | 6 (follow-up) | visual-wow | – / ★★ | S-M | 0 | [x] (uncommitted; wave-8 review fix: 3100–3500 K at 5–10°, sky fill 0.72, lilac shade, warm sun-side haze) |
| KB-I75 | Interior whites and mirror reflections | 6 (follow-up) | visual-wow | – / ★★ | M | ≤ +0.3 ms | [x] (uncommitted; wave 9: window pull, indoor shoulder, parquet bounce, box-projected room mirrors; review fix: same-session CPU A/B ±0.15 ms (no cost), capture debounced on light changes, O(1) steady state) |
| KB-I76 | Leaf scale on leaf cards and forest crowns | 6 (follow-up) | schlossgarten + visual-wow | – / ★★ | S-M | ~0 | [x] (uncommitted; wave 9: fine leaf atlas on cards ≥ 0.9 m within ~32 m, ≤ +0.09 ms) |
| KB-I77 | Pond shores: smoothed outline, depth fade, banks (water-mesh contract with the SSR) | 5 (follow-up) | schlossgarten + visual-wow | ★ / ★★ | M | ≤ +0.2 ms | [x] (uncommitted; wave 9: graded natural shores, water on the terrain's own vertices, TF-21 island; ≤ +0.18 ms; wave-9 review fix: depth fade over 0.3 m, 1:4 island bank, dam / outline decision recorded) |
| KB-I78 | Lawn and meadow blades: finer, denser lawn, no disc edge, retina cost | 6 (follow-up) | schlossgarten + visual-wow | – / ★★ | S-M | −0.5…−1 ms retina | [~] (uncommitted; wave-9 review fix: lawn speckle gone, disc edge dithered, retina ≤ +0.4 ms at 16 / 33 / 47; 39 meadow +1.7 ms open) |
| KB-I79 | End-side orientation audit for rotated `axisRect` buildings | 4 (follow-up) | historic-architecture | ★ / ★ | S | 0 | [ ] |

Waves: **0** foundations · **1** headroom and light (audit pass 1), closed by two cheap, well-evidenced quick wins
(KB-I15 palette, KB-I14 ground colours) that need the calibrated light to be judged · **2** the 1789 landscape, the biggest truth and
"wow" lever · **3** facade truth · **4** building and room corrections · **5** garden detail · **6** cinematic
polish (audit passes 2–3) · **later** needs headroom or a decision.

---

## Wave 0: foundations

### KB-I01 · Viewer pose and look hooks for reproducible reviews `[x] (uncommitted)`
- **Why:** before/after pairs only mean something at identical cameras. The audit asks for `skb.pose`, `skb.look`,
  `skb.quality` and `skb.tour` (visual-audit §7). Today the poses live only in the skill's `scripts/shots.mjs`.
- **Payoff:** – / ★ (enables every later check). **Effort:** S. **Perf:** 0.
- **Files:** `viewer/src/main.ts` (the `skb` object). Not `viewer/src/handover.ts`.
- **Acceptance:** `skb.pose(x, y, z, lx, ly, lz, mode)` sets the camera exactly and runs the LOD and collider update
  that `goto` runs; `shots.mjs` keeps working (it defines its own `pose` if `skb.pose` is missing). Shots 01 and 04
  are byte-identical before and after (the render must not change).
- **Result (2026-11-02, wave 1):** `skb.pose(x, y, z, lx, ly, lz, mode)` added. `pose` and `goto` now share
  `placeCamera()`: fly, set the position, `updateLod2(true)`, refresh the colliders, then walk if asked. Checked
  headless: the camera lands exactly on the target (position error 0, view direction · target direction = 1.000000).
  `goto('KB-B01/B01.2.og-festsaal')` now lands at 353.05 m. Before, the first room goto fell to the terrain at
  347.55 m; that was a collider-order bug, now fixed. `shots.mjs` still works. The byte-identity check is moot,
  because KB-I04–I15 changed the render in the same wave. The implementer's own A/B before those changes found pose
  04 byte-identical and pose 01 differing only in the Orangerie region, where the model edits landed at the same time.
  `skb.look()` sets the display look ('doku' / 'kino', KB-I06), not a camera target. `skb.quality` exists;
  `skb.tour` (visual-audit §7) is still missing → KB-I46.

### KB-I02 · Catalogue fact fixes (names, dates, tags, sources) `[x] (uncommitted)`
- **Why:** cheap corrections with no geometry, all documented:
  - KB-B23 → "Hundezwinger", kennel for the pack, **D** (Mannlich: "ein Zwinger für tausend Hunde"; research/10 §b.3).
  - KB-B11 → "Orangerie, Nordflügel"; KB-B12 → "Orangerie, Südflügel mit Komödienhaus (ab 1783)" (10 §b.2, D).
  - KB-B01 slate tag D→ → **D** (Mannlich 1910 pp. 356, 370; 10 §b.1).
  - KB-B02 built "1782 – c. 1785/89 (long a carcass)"; KB-B04 built "c. 1784" (10 §b.1, D).
  - Stables C11 wording: "D (Mannlich, as commission)" (10 §b.3).
  - KB-B28: alias "Pavillon zu Carlsberg? (Schneider)", confidence low; TF-40: "Waldparzelle hinter dem Schloss
    (Böschung, 1797/98)" [I, med]; UP-10 candidate TF-08 [I, low]; UP-09 candidate Pavilion 3 (research/11 S16).
  - KB-B14 (Orangerie retaining wall) carries no evidence tag at all: add one (history-check E2 fails on it today).
  - Herzogskastanien: not in the catalogue yet. Record *Castanea sativa* [D] (11 S16, §3.3) when KB-I38 adds the grove;
    nothing to change here.
  - UP-12 Kirchturm and UP-11 Monbijou leave the site list: the tower is Homburg's Protestant church (Weber 1954), and
    Monbijou is a separate estate in the 1797 inventory (10 §b.6). Keep a note in `open_questions`, do not delete silently.
  - UP-18 "Kapelle, Ballhaus, Apotheke": note that the Ballhaus = the KB-B03 Tanzsaal and/or the convertible
    Komödienhaus floor [I] (10 §b.6); Kapelle and Apotheke stay unplaced.
  - KL-B42 / KL-B46: V23 shows one Tschifflik, nearer KL-B46 [I, low] (10 §b.6).
  - Add to `SRC`: NDB Hautt, Koblenz, Herzogvorstadt, SSG Hemmer, Redding/Langer (09 C8), Schwan 2012 (T5),
    Mannlich 1910 (T1), Schneider archived pages (10 §a; 11 §7).
- **Payoff:** ★★ / –. **Effort:** S. **Perf:** 0.
- **Files:** `scripts/catalogue-v2/buildings.ts` (SRC, building defs), `scripts/catalogue-v2/terrain.ts`,
  regenerated `model/catalogue.json`.
- **Acceptance:** `verify.sh catalogue` reproduces the regenerated file; validation 0 errors;
  `history-check.mjs --strict` passes (E2) and shows H10 and H11 DONE; info panel shows the new names (clicking KB-B23
  in the viewer); `pnpm run plans` regenerated if a name appears on a sheet. No shots needed.
- **Result (2026-11-02, wave 1):** all sub-points are in `scripts/catalogue-v2/` and the regenerated
  `model/catalogue.json`.
  - Names: KB-B23 "Hundezwinger"; KB-B11 "Orangerie, Nordflügel"; KB-B12 "Orangerie, Südflügel mit Komödienhaus
    (ab 1783)".
  - Tags and dates: KB-B01 slate D (T1 pp. 356, 370); KB-B02 built "1782 – c. 1785/89 (long a carcass) [D T5]"; KB-B04
    "c. 1784 [D T5]"; C11 "as commission".
  - Aliases and candidates: KB-B28 alias "Pavillon zu Carlsberg?", low; TF-40 renamed, med; UP-09 and UP-10
    candidates; UP-18 Ballhaus note; KL-B46 note on the single Tschifflik.
  - KB-B14 is now tagged.
  - UP-11 and UP-12 left the building list and are kept in `open_questions` (101 → 99 catalogue entries).
  - New SRC entries: Mannlich 1910, Schwan 2012, Koblenz, Herzogvorstadt, NDB Hautt, Hemmer, Redding/Langer and
    Schneider (web).

  Checks: `verify.sh catalogue` reproduces the file byte for byte (validation 0 errors, 0 warnings, 0 programme
  issues, 0 overlaps). `history-check.mjs --strict` exits 0: E2 PASS, H10 and H11 DONE. The viewer's catalogue entry
  for KB-B23 reads "Hundezwinger" (`skb.entries`, checked headless; the panel was not clicked). The AN-04 plan sheet
  was regenerated and carries the new names.

### KB-I03 · Epoch field: show the summer-1789 state only `[~] re-export pending`
- **Why:** several things in the model did not stand in summer 1789: the Orangerie rotunda KB-B13 was a timber and
  canvas fair building of Dec 1785, then demolished (10 §0.3, §b.2, D); the Hymen temple KL-B49 was a fireworks
  stage set of 1785 (10 §b.4, D); the round pavilion stood at the CdL 1785–1792 and became the Karlslust "Eremitage"
  only in 1792 (11 §1.3, S5); the axial basin existed 1783–c.1790 (11 S3). An `epoch {from, to}` field lets the
  viewer show 1789 correctly and keeps the other dates as alternatives (11 §6.1). `placement: 'hypothetical'` cannot
  do this: it means "uncertain", and `DEFAULT_BUILD_OPTIONS.showHypothetical` is `true`, so hypotheticals render.
- **Payoff:** ★★ / ★. **Effort:** M. **Perf:** 0.
- **Design:** one optional `epoch?: { from?: number; to?: number }` (years, `to` inclusive) on both `Building` and
  `TerrainFeature`, and one pure `inEpoch(epoch, year)` used by every consumer (skill references
  `skb-historic-architecture/references/source-to-model.md` §3.6 and research/11 §6.1 describe the same design). The
  scene year defaults to 1789. Don't conflate it with the viewer's existing `state.epoch` ('1789' | '2025'), which
  only switches the terrain.
- **Files:** `model/src/spec.ts`, `model/src/validate.ts`, `inEpoch()` in `model/src/layout/` with a test,
  builders' skip rules (`model/src/exterior/index.ts`, `model/src/interior/index.ts`, `model/src/site/index.ts`,
  `model/src/site/access.ts`), `model/src/explorer/export.ts`, `scripts/export-glb.ts`, plans sheet lists (AN-04 lists
  KB-B13), `scripts/catalogue-v2/`, `docs/architecture.md` §4.1 and §5 rule 2.
- **Acceptance:** tests from research/11 §6.5 (basin shown for 1789, hidden for 1791; Rundpavillon at the CdL in 1789
  and in the Karlslust in 1792), written against `inEpoch` before those features exist; KB-B13 and KL-B49 absent by
  default (history-check H01, H02 DONE; `model/tests/footprint-storeys.test.ts` still finds KB-B13 in the spec); shots
  01, 02 before/after; export node count drops and the explorer agent is told (light layer changed).
- **Result (2026-11-02, wave 1):**
  - Added `Epoch` and `epoch_tag` on `Building` and `TerrainFeature` (`spec.ts`), and `layout/epoch.ts` with
    `SCENE_YEAR = 1789`, `inEpoch`, `inScene` and `epochIssues`. Validation is in `validate.ts`, and
    `BuildOptions.year` defaults to 1789.
  - The year filters run in `site/access.ts`, `site/features.ts`, the exterior and interior builders, both export
    scripts and the plan sheets.
  - KB-B13 and KL-B49 carry `epoch {1785, 1785}` with D tags (T1/T5/T6).
  - `model/tests/epoch.test.ts` has 12 tests, including the research/11 §6.5 scenarios: the basin shows in 1789 and is
    hidden in 1791; the Rundpavillon stands at the CdL in 1789 and at the Karlslust in 1792.
    `footprint-storeys.test.ts` still finds KB-B13 in the spec.
  - `docs/architecture.md` §4.1 and §5 rule 2 are updated.

  Checks: history-check H01 and H02 DONE. The viewer has 90 entries, with no KB-B13 or KL-B49 and no KB-B13 mesh.
  Shots 01 and 02 show the rotunda in the Orangerie court gone (`docs/shots/KB-I03/`). In the temp-dir export,
  nodes dropped from 99 to 97 (89 buildings + 8 site), triangles from 340 k to 334 k, size from 4.65 to 4.55 MB.
  **Missing:** `pnpm run export:explorer` into `../app` and the explorer notice. This is the coordinator's step at
  commit, and the export also carries KB-I15's new colours.

## Wave 1: headroom and light (visual-audit pass 1)

### KB-I04 · Shadow caching and soft radius `[x] (uncommitted)`
- **Why:** every caster is static, yet the shadow map is redrawn every frame (+1.95 M triangles at view-west); r187
  removed `PCFSoftShadowMap`, so the setting at `viewer/src/main.ts:38` is a no-op and edges are hard (console
  warning; visual-audit §3, §5.5, P2) [measured].
- **Payoff:** – / ★. **Effort:** S. **Perf:** −1 to −4 ms in flight.
- **Files:** `viewer/src/main.ts`.
- **Acceptance:** `shadowMap.autoUpdate = false`, redraw on hour change or when the shadow frustum moves > ~10 %;
  `sun.shadow.radius ≈ 3`; the PCFSoft warning is gone from the `shots.mjs` console list; shots 01, 03, 09 show no
  stale or missing shadows after `goto` between poses; bench 01/03 before and after.
- **Result (2026-11-02, wave 1):**
  - `sun.shadow.autoUpdate = false`. This is per light; `renderer.shadowMap.autoUpdate` stays true and has the same
    effect.
  - The frustum snaps to an ext/8 grid. The map redraws only on a centre change, a > 10 % extent change, a LOD
    signature change, a sun move, an LOD2 build or a display change.
  - `PCFShadowMap` with `radius 3`, because r187 removed PCFSoft. Interiors use `receiveShadow`, so the sun no longer
    shines through walls. New counter: `skb.shadowRedraws()`.

  Checks: standing still at view-west and view-ehrenhof gave 0 redraws in 30 frames, twice. The full after run
  printed 0 console warnings, so the PCFSoft warning is gone. Shots 01 → 09 taken in sequence show no stale shadows
  (09: N wing lit, CdL in shade, court streak correct). At pose 01, calls fell from 820 to 509 and triangles from
  4.36 M to 2.40 M, because the shadow pass is skipped. The bench at 01/03 is in the KB-I05 table. Pose 01's GPU time
  rose for reasons outside this item (see KB-I55).

### KB-I05 · Render scale and quality presets `[x] (uncommitted)`
- **Why:** full retina (DPR 2) already misses 60 fps in aerials: 13–21 ms at 3024×1964 (visual-audit §3, P7)
  [measured]. `preserveDrawingBuffer: true` (`main.ts:32`) costs bandwidth on tile GPUs and is not needed for
  screenshots (CDP capture works).
- **Payoff:** – / ★. **Effort:** S. **Perf:** −30 to −45 % at retina.
- **Files:** `viewer/src/main.ts`, `viewer/src/ui.ts`.
- **Acceptance:** presets "Hoch / Mittel / Mobil" (DPR caps 1.5 / 1.25 / 1.0, 2 only in photo mode; visual-audit P7
  and §6 target; German labels), adaptive scale when the moving-average frame time exceeds 14 ms (pure controller +
  test), `preserveDrawingBuffer` off (on only in a capture/photo mode); `shots.mjs` still captures correct images.
  `gpuBench(n, size)` renders at DPR 1, so bench the buffer a preset really produces on the 1512×982 pt retina
  window: "Mittel" ≈ 1890×1228, "Hoch" ≈ 2268×1473. Poses 01 and 08 with "Mittel" ≤ 12 ms.
- **Result (2026-11-02, wave 1):**
  - `viewer/src/quality.ts` (pure, 9 tests) adds the presets Hoch 1.5 / Mittel 1.25 / Mobil 1.0 DPR. Hoch and Mittel
    use a 4096 shadow map, Mobil 2048. Photo and capture render at DPR 2.
  - `AdaptiveScale`: budget 14 ms, relax below 9 ms, step 0.1, min 0.6, cooldown 30 samples. GPU timer queries feed
    it, and it pauses during bench and photo.
  - `preserveDrawingBuffer` is false (checked headless). `skb.capture()` reads in the same task.
  - UI: "Qualität", "Auflösung automatisch anpassen", and "Auflösung ×" in the stats line.

  Bench in one session (gpuBench ×3, ms):

  | Pose | Mittel 1890×1228 | Hoch 2268×1473 | 1080p | 3024×1964 |
  |---|---|---|---|---|
  | 01 | 8.2–9.4 | 12.4–12.9 | 4.8–7.9 | 23.0–23.8 |
  | 08 | 8.0–10.0 | 13.1–13.5 | 4.9–6.7 | 19.7–23.9 |

  So **"Mittel" ≤ 12 ms at 01 and 08 is met** in this session. An earlier implementer session measured 13–16 ms,
  because headless timings drift between sessions.
  Not verified: the adaptive scale on a real retina display (headless DPR 1 makes it inert), and real rAF pacing.

### KB-I06 · Calibrated light budget (sun, sky IBL, exposure, twilight) `[x] (uncommitted; wave 7: Kino golden hour)`
- **Why:** image-based light is effectively off (`environmentIntensity` 0.02–0.07, `main.ts:104`); the env map is
  built from the unscaled Preetham sky while the visible sky is scaled ×0.3, so gilding reads olive and glass empty.
  Naively raising it blew the image out to cyan and lit interiors with sky (visual-audit §4.1, §5.2, P3; `ab-*.jpg`).
- **Payoff:** – / ★★★. **Effort:** M. **Perf:** ~0.
- **Files:** `viewer/src/main.ts` (`updateSun`), new `viewer/src/atmosphere.ts`, `model/src/interior/materials.ts`
  (room environment); pure EV-curve and blackbody helpers in `viewer/src/` with vitest.
- **Acceptance:** follow visual-audit §5.2 steps 1–6 (one sky radiance for background and IBL, hemisphere light off
  or ≤ 0.1, sun:sky about 3:1–8:1 at high sun, EV curve over sun elevation, blackbody sun colour, twilight floor;
  interiors use the warm room environment). Shots 01, 03, 06, 08, 09, 10, 14: catalogue colours recognisable
  (render `#ECE8DF` reads warm white in sun, not grey-green), no cyan cast, dusk (10) not black.
- **Result (2026-11-02, wave 1):**
  - `viewer/src/light.ts` (pure, 11 tests): Kasten-Young sun, log-table sky lux anchored on Wikipedia Lux/Twilight
    values, a 0.03 lx night floor, blackbody sun colour (Helland fit), an EV curve and Frostbite pre-exposure.
  - `viewer/src/preetham.ts` (5 tests) is a CPU port of three's Sky.js. Background and PMREM IBL now share one sky,
    normalised to the target sky lux, with an albedo-0.2 ground instead of the hemisphere light.
  - Interiors get the warm `roomEnvironment` at daylight factor 3 % plus 3 lx candle ambient, inside only.
  - Emissive 1000 nits. Neutral tone mapping ("Dokumentation") by default, AgX as "Kino".

  Grey-card sun:shade ratio (`skb.lightProbe()`, Ehrenhof): 10:30 5.2 (target 3–8, met); 17:30 12.0 and 19:00 19.7
  (targets 2–3 and 1–1.5, missed). That is why the item is partial: with no GI, low-sun shade gets only sky plus
  ground.

  Shots (`docs/shots/KB-I06/`):
  - 10 (dusk) is a readable deep blue, where it was black.
  - 08 is warm with a pale horizon, where it was muddy.
  - 07 is candle-warm, and gilding reads gold, not olive.
  - 14 shows the CdL warm white in sun.

  Still wrong:
  - At 10:30 the shade and the distant forest have a teal tint (01, 02, 12), and the sky is a very saturated deep
    blue (03, 05).
  - 06: the ceiling reads dark brown-grey and the sun patch on the wall clips.
  - 07: the parquet reads grey-taupe instead of wood.

  See Discovered. (The final wave-1 state in `docs/shots/KB-I06/after-*.jpg` already has a light ceiling at 06, but a
  grey-mauve parquet.)
- **Result (2026-11-02, wave 2, look fixes):**
  - Festsaal by day (06): the room environment is now a contrasty 16×8 half-float equirect (pure
    `roomEnvironmentGrid()` + `roomEnvIrradiance()`, `model/src/interior/materials.ts`), with `userData.meanLuminance`
    read by the viewer's normalisation. Parquet `#9B7448` and boiserie `#F1EFE8` restored from research/02 §3; parquet
    clearcoat 0.15 (roughness 0.12), specular 0.3; gilt roughness 0.25; indoor day headroom 0.1 EV
    (`INDOOR_DAY_HEADROOM_EV`). Interior shadow flags now come only from the model (`interiorShadows()`, casters =
    walls, cornices, ceilings); the viewer copies are gone.
  - Hero hours (14 at 17:30, 15 at 07:00): sun 4000 K at 20°, 4200 K at 25°, 4650 K at 32°; chromatic adaptation 0.2
    at 22°; −0.15 EV key over 20–26°; sky 17.5 klx at 22°. Every value carries an [I] note in `light.ts`.
  - Sky at low sun: `skyViewEv` is a table (+2.35 EV at 22°), and the new `viewSkySat(el)` desaturates the visible sky
    to 0.62 at 15–28°. IBL and the light budget are unchanged.

  Checks (`docs/shots/KB-I06/after-wave2-06-festsaal-day.jpg`, `docs/shots/KB-I08/after-wave2-14…`, `…-15…`):
  - 06: parquet reads warm oak (sampled `#766861` → `#816345`), boiserie warm off-white, the gilt shows highlight and
    core. Still flat: the chairs and sofa are tan silk `#c9b27c`, close to gilt (→ KB-I26/I27).
  - 14: the sky is a pale mid-blue instead of a deep navy, and the CdL reads cream in sun; 15 is warmer with a paler
    sky. 03 and 10 are unchanged in their samples; 07 keeps the candle look.
  - Grey-card sun:shade ratio, re-measured with `skb.lightProbe()` at the Ehrenhof in this session: 10:30 5.3 (target
    3–8, met), 17:30 **15.0** (was 12.0; target 2–3), 19:00 **28.7** (was 19.7; target 1–1.5). The low-sun shade is
    darker relative to the sun than after wave 1, so the item stays partial.
  - Tests: `model/tests/interior.roomenv.test.ts` (new), `materials.response.test.ts` and `viewer/tests/light.test.ts`
    updated. GPU at 1080p flat (06 2.5 → 2.2 ms, 14 2.2 → 2.2); retina 06 4.4 → 7.7 ms in this session, mostly
    terrain and garden work in the same run (no clean A/B).

- **Result (2026-11-02, wave-2 review fix, look):**
  - Cause of the dark low-sun shade, measured on the CPU Preetham port: the three.js sky's single-scattering Mie lobe
    put ≈ 48 klx of sky light on a card facing the 22° sun but ≈ 3.9 klx on a vertical card facing away (12:1), so
    the image-based light added ≈ 1 EV to sunlit walls and almost nothing to shaded ones.
  - Fix (`viewer/src/light.ts`, `atmosphere.ts`, `preetham.ts`): the env twin and the SH probe are blended toward
    the sky's hemispherical mean (`envSkyIso`: 0.8 at 12–30°, 0.6 at 5°, 0.35 at high sun, 0 in twilight), normalised
    to the same sky lux; their mean colour sits on the CIE daylight locus (`skylightColour`, 12 000–15 000 K, green
    trim 0.97) instead of Preetham's green-cyan; ground bounce albedo 0.275 warm-neutral (was olive 0.2/0.19/0.12);
    sun extinction 0.23 (hazy July, was 0.21); sky lux 5° 5.3, 10° 10.5, 22° 19.5, 40° 20.5 klx; low-sun key opened
    (−0.2 EV at 20–26°, −0.35…−0.4 at 6–10°) and `skyViewEv` lowered by the same amount, so the visible sky is
    unchanged. All [I] with the reasoning in the code.
  - Grey-card `skb.lightProbe()` (Ehrenhof, measured): 10:30 **4.6** (was 5.3), 17:30 **5.9** (15.0), 19:00 **7.2**
    (28.7), 19:12 7.0 (29.8). Targets ≤ 6 / ≤ 8 met.
  - Shots (scratchpad `wave2-fix-look` vs `wave2-after`): 14 shaded wings light blue-grey (wall median #2C2F34 →
    #41454E incl. shutters; visually ≈ 1/4 of the sunlit CdL), CdL in sun cream #E1C1AA (was #DFCAB5); 09 shaded
    court cool grey #696864 (was olive #605238), sunlit wing #D1AB96. 03, 10 unchanged in look; 08 slightly flatter
    relief in the shade (the price of the brighter shade).
  - Festsaal (06/07): procedural parquet de Versailles (`model/src/materials/parquet.ts`, 1.05 m panels laid at 45°,
    frame, interlaced lattice, field boards; photo set kept as grain only, its normal/ARM maps dropped for the
    parquet; pure twin + tests `model/tests/parquet.test.ts`); boiserie-room upholstery crimson damask #8E1F2A [N
    research/02 §3] instead of tan #c9b27c; chandelier drops a new `interior.crystal` (opaque near-white
    dielectric, ior 1.6, clearcoat) instead of the 0.38-opacity crown glass; indoor day headroom 0.1 → 0.25 EV. The
    window opening itself stays clipped (#F4F9FD at any headroom ≤ 0.4: the outdoors is 4–5 EV above the room); +0.3
    EV only greyed the boiserie (#D4D0C5 → #C0BEB2), so 0.25 is the compromise.
  - GPU (same run, M5 Pro): 06 1080p 2.1 ms / retina 3.6 ms, 14 2.4 / 3.7 (wave-2: 2.2 / –); the light changes are
    CPU-side per hour change (one 512-sample hemisphere mean).
- **Wave 7 (look, 2026-11-02): Kino golden hour.** `kinoLowSun` (`viewer/src/light.ts`) also returns `g`, the weight
  of the golden grade (1 up to 12° sun, 0.5 from 26° by day, 0 in twilight), and `ev`, an outdoor exposure lift
  (`KINO_GOLDEN_EV` 0.45 at the golden hour + `KINO_LOW_EV` 0.25 × (g − w)); the visible sky drops by the same EV,
  like a graduated filter. `grade.ts` `KINO_GOLDEN_LOOK` (warm slope [1.01, 1, 0.96], power 1.04 / 1.04 / 1.06,
  saturation 1.38) is blended by `kinoLookAt(g)`; the grade pass adds `KINO_SKY_GOLD`, a warm gold of up to 0.6, low
  and toward the sun, while the high sky keeps `KINO_SKY_BLUE` [I]. Dokumentation is untouched (ev, g and gold are 0).
  Tests `viewer/tests/look-kb-i06.test.ts` (4); `post.test.ts` uses `toMatchObject` for the new fields. Implementer
  samples (T1 goldene-stunde 0.3): meadow #7F6A3B → #91804B, trees #514D24 → #626330, facade #90745F → #A08B72; a
  sunward 18:45 Kino frame has a clear blue top sky #B4D3ED and gold #E0CCA3 round the sun (was grey-beige #BBBFBA).
- **Lead check (wave 7):** Dokumentation poses do not change through this item (01 0.37, 02 0.14, 12 0.38/255 mean
  |Δ| against `wave6-final`, all in the forest crowns of KB-I66). Pair `docs/shots/KB-I06/*-wave7-kino-goldene-stunde-0.3.jpg`
  (the look implementer's tour frame `skb.tour('goldene-stunde', 0.3)`, not a `shots.mjs` pose; its after also
  carries the wave-7 crowns) and `after-wave7-kino-k10-1845-sunward.jpg`: warmer and lighter, the meadow golden instead
  of olive, no milky patches round the sun. **Done:** the open part (low-sun shade ratio) was met by the wave-2 review
  fix (4.6 / 5.9 / 7.2 at 10:30 / 17:30 / 19:00, within ≤ 6 / ≤ 8) and Dokumentation light is unchanged since; the
  ratios were not re-measured in this session.

### KB-I07 · Height fog and sky-matched haze `[x] (uncommitted)`
- **Why:** distance haze is a fixed cool hue (`main.ts:43`, `:105`) that does not match the sky; golden-hour aerials
  get a brown horizon band (visual-audit §4.1, §5.4 level 1, P4).
- **Payoff:** – / ★★★ (aerial depth). **Effort:** S. **Perf:** ~0.
- **Files:** `viewer/src/atmosphere.ts`, `viewer/src/terrain.ts` (splat keeps fog), `model/src/materials/index.ts`
  only if a shader chunk must be shared.
- **Acceptance:** exponential height fog with sun in-scatter, colour from the sky; shots 01, 02, 08, 11, 12 show
  layered blue distance without a band at the horizon; after KB-I06.
- **Result (2026-11-02, wave 1):**
  - `viewer/src/fog.ts` (pure, 5 tests): analytic exponential height fog with h0 345 m and scale height 450 m (250 m
    for morning mist). a = 1.9e-4 /m, ×1.6 in the morning and ×1.35 at golden hour. Mild superlinear growth, (1 +
    t/1600 m), stands in for the haze beyond the terrain crop.
  - Three's `fog_*` chunks are overridden once (`installHeightFog`), and a shared `uFog[4]` uniform carries the haze
    colours toward and away from the sun, taken from the same Preetham sky. Fog is applied before tone mapping.
  - UI: "Dunst".

  Haze at noon: palace from view-west 5.3 %, 2 km crop edge 59 %.
  Shots: in 08 the brown horizon band is gone, replaced by a sky-matched pale band on the sun side. 01, 02 and 12
  show layered blue distance (`docs/shots/KB-I07/`). The fog switch costs nothing measurable in A/B.
  `docs/architecture.md` doesn't describe the chunk override yet (see Discovered).

### KB-I08 · Hero hour and time presets `[x] (uncommitted)`
- **Why:** the default 10:30 (56° sun) gives flat light. The Ehrenhof front faces west, so its hero hour is about
  17:30 (sun 22° from 278°); the garden front wants about 07:00 (25° from 85°) (visual-audit §2 sun table, P6;
  research/02 §3.3 N).
- **Payoff:** – / ★★. **Effort:** S. **Perf:** 0.
- **Files:** `viewer/src/main.ts` (`state.hour`, view POIs with a preferred hour), `viewer/src/ui.ts`.
- **Acceptance:** default 17:30; presets "Morgen / Nachmittag / Goldene Stunde / Dämmerung / Nacht" (+ "Fest" once
  KB-I43 exists); `view-east` uses 07:00; shots 01, 02, 14, 15.
- **Result (2026-11-02, wave 1):** default `state.hour` 17.5. Presets Morgen 7:00 / Nachmittag 17:30 / Goldene
  Stunde 19:00 / Dämmerung 20:30 / Nacht 22:00 sit above the 4–23 h slider; all labels are present in the panel
  (checked headless). `VIEW_HOURS`: view-west and view-ehrenhof 17:30, view-east 07:00. They apply only to a goto
  from the UI, so `skb.goto` stays deterministic for the shot poses. Shots 14 (hero, 17:30) and 15 (garden, 07:00)
  are in `docs/shots/KB-I08/`. Shots 01 and 02 force 10:30, so they are unchanged by this item.
  Not verified: the preset buttons were not clicked by hand. "Fest" waits for KB-I43.
  Wave 2: the hero-hour light was retuned under KB-I06 (warmer mid-band sun, paler sky);
  `docs/shots/KB-I08/after-wave2-14-ehrenhof-hero.jpg` and `after-wave2-15-garden-hero.jpg`.

### KB-I55 · Wave-1 aerial GPU regression: diffuse sky via SH probe, PMREM on glossy only `[x] (uncommitted)`
- **Why:** after wave 1, aerial poses at 3024×1964 roughly doubled: 01 10.5 → 22.8 ms, 02 12.5 → 20.5, 08 13.5 →
  23.5, 12 12.2 → 19.7, 13 14.6 → 23.6 [measured, `shots.mjs --bench`; before and after are from different
  sessions]. At 1080p, 01, 02 and 08 rose +2.3 to +3.8 ms, which breaks the +1 ms-per-item budget. This happened
  even though draw calls fell (820 → 509) and triangles fell (4.36 → 2.40 M), because the shadow pass is now cached.
  The implementer's A/B runs ruled out the sky, fog, the shadow radius, shadows off and the trees. Removing
  `scene.environment` (the PMREM sky IBL) brought 01 retina from 23 ms down to 8.3 ms in three runs, but a
  same-session A/B did not reproduce that. Headless timings also drifted 2–3× between sessions (KB-I05 "Mittel" at
  01: 6.2 ms in one session, 13–16 in another, 8.2–9.4 in this check). Lead: r187's PMREM is a cube render target
  with custom mips; a copy to a plain texture assumed the old cubeUV atlas and was reverted.
- **Payoff:** – / ★ (keeps the aerial budget ≤ 12 ms retina reachable). **Effort:** S-M. **Perf:** target back to
  ≤ 12 ms retina at 01 and 08 with Hoch.
- **Files:** `viewer/src/atmosphere.ts`, `viewer/src/main.ts`.
- **Acceptance:**
  - Diffuse sky light from an SH `LightProbe` fitted to the Preetham sky. The PMREM environment applies only to
    glossy materials (glass, metal, gilding, water).
  - A reproducible bench protocol: the same session, 3 repeats per pose and an A/B toggle via `--eval`, with min and
    median reported.
  - 01 and 08 at 3024×1964: back near the pre-wave values (≈ 10–14 ms) in a same-session A/B.
  - Shots 01, 03, 06, 08 and 14 visually equal: gilding and glass keep their reflections, and the grey-card ratio at
    10:30 stays at 3–8.
- **Result (2026-11-02, wave 4, with KB-I59):**
  - The regression's cause was not the PMREM: a same-session split (`ab.mjs`, below) put it in the **draw order** and the
    terrain's per-pixel lighting (KB-I59). Terrain and vegetation already took their diffuse sky from the SH probe
    (`useSkyShDiffuse`, wave 1); the terrain now evaluates the SH per vertex (KB-I59).
  - PMREM only on glossy materials was A/B-tested by removing `scene.environment` for every material (the upper bound
    of the split), 3 repeats at 3024×1964, min / median ms: 03 4.30 / 4.52 → 3.88 / 4.10, 13 3.94 / 5.04 → 3.55 / 4.04,
    14 4.10 / 4.46 → 3.99 / 4.69; at 01 / 08 / 12 the delta was below the noise (base 4.6–16 ms in that loaded run).
    The split would change the sheen of slate, render and sandstone for ≤ 0.4–1 ms at eye level, so it was **not
    done** (Decisions log). Buildings, glass, gilding and water keep the PMREM; shots 03, 06, 14 are unchanged.
  - Acceptance "01 and 08 back to ≈ 10–14 ms retina in a same-session A/B": met, see the KB-I59 table (01 4.5–6.6,
    08 4.9–7.4 ms medians). Grey-card ratio untouched (no light-budget change).

### KB-I59 · Terrain and ground shading cost at retina `[x] (uncommitted)`
- **Why:** promoted from Discovered (wave 2, perf). Wave 3 (same-session A/B by the vegetation implementer): hiding
  the terrain takes pose 01 at 3024×1964 from 21.4 to 7.9 ms with the forest still drawn, so ~13 ms is terrain and
  ground shading; forest full vs lite detail differs by ≤ 0.3 ms. KB-I56 cut per-pixel grass taps, but the bench
  could not prove a gain on a loaded machine (01 retina 16.5 → 17.4–18.6, 12 8.2 → 19.8–20.1 ms across sessions)
  [measured]. Wave-3 review fix (vegetation, same-session retina A/B, 3 repeats, see KB-I44): hiding the terrain takes
  12 from 19.2 to 6.2 ms, 13 from 16.3 to 2.6, 08 from 20.8 to 6.5 and 02 from 17.1 to 3.8 (medians). Hiding the
  whole forest saves ≤ 1.2 ms, foliage shading ≤ 1 ms, and the close / hero tiers and hinterland are within noise.
  The vegetation-heavy retina regressions are terrain and ground shading [measured].
- **Payoff:** – / ★ (the ≤ 12 ms aerial retina budget). **Effort:** M. **Perf:** target −5…−10 ms retina at 01, 08,
  12.
- **Files:** `viewer/src/terrain.ts`, `viewer/src/landcoverBake.ts`, `viewer/src/main.ts`.
- **Acceptance:** an idle-machine, same-session A/B (3 repeats, min and median) of terrain shown / hidden / flat
  splat at 01, 08, 12 at 3024×1964; the cost split by shader branch (bake lookups, `tDist`, grass taps, vine splat,
  shadows, fog); 01 and 08 ≤ 12 ms retina with Hoch, or the remaining gap documented; shots 01, 08, 12 visually
  equal. Levers: a depth pre-pass or drawing buildings and forest before the terrain, a lower-resolution bake for
  far tiles, fewer dependent fetches. Do it together with KB-I55.
- **Result (2026-11-02, wave 4, perf):**
  - **Profile first** (same session, `--eval`-style runtime toggles, 3 repeats, retina 3024×1964, pose 01 before
    the change, median ms of a 20.4 ms frame): terrain hidden −13.8; terrain fragment shader replaced by a constant
    −15.1 (so ≈ 15 ms is terrain *fragment* work, vertex work ≈ 0); land-cover splat −3.9 (grass taps −0.5, field
    lines +0.2, i.e. noise, vine 0, the rest is the `tLand` / `tWeights` fetches); three's physical lighting of the
    terrain ≈ −7 (sun shadow −1.7, per-pixel SH −1.25, fog + tone mapping −1.2); stock `MeshStandardMaterial` on the
    terrain still cost 14.1 ms. The decisive test: drawing the **terrain after all other opaque objects** saved
    −8.4 ms at 01, −3.1 at 12, −5.8 at 13. three sorts opaque objects front to back by object centre, so the sky dome
    (centred on the camera) was drawn first and the 128 m terrain chunks interleaved with the trees and buildings on
    them; on this GPU (ANGLE/Metal, 4× MSAA) the hidden fragments were shaded anyway. A render-target probe showed
    the scene costing 3.4 ms without MSAA and 15.5 ms with 4× MSAA at retina (same frame): MSAA multiplies every
    overdrawn or edge fragment, which is why retina cost 5× the 1080p frame instead of 2.9×.
  - **Levers shipped** (all viewer-only, no visible change):
    1. Draw order (`atmosphere.ts RENDER_ORDER`): terrain chunks `renderOrder` 1 (after buildings, site, forest,
       hinterland), the sky dome 2 (last: it only fills what is still at the far plane). Transparent objects are a
       separate list and keep their order.
    2. Terrain depth pre-pass (`TerrainMesh` `prepass`, `depthMaterial`): each chunk is drawn once more, depth only,
       first (`renderOrder` −1), pushed back by `polygonOffset(1, 1)` so the colour pass (LessEqual) always passes it.
       Without it, terrain-last cost +2.7 ms at 05 and 11 (hills hide the buildings and trees behind them). Costs
       +80–120 draw calls (+0.1–0.3 ms CPU) and adds the terrain triangles again to `renderer.info` (stats line,
       `skb.triangles().rendered`, bench "triangles" +0.4 M).
    3. Terrain light per vertex (`atmosphere.ts useTerrainVertexLight`, `TERRAIN_LIGHT_GLSL`): sun Lambert × (1 − F),
       GGX sun specular with multi-scatter compensation, SH sky diffuse and its multi-scatter share are three's own
       formulas and DFG table evaluated per vertex (roughness 0.95, no normal map, smooth normals); albedo (splat), sun
       shadow, point lights and fog stay per pixel. Dropped: three's per-pixel `geometryRoughness` widening of far
       sub-pixel normals (≤ 3/255 at 13, far terrain). A/B hook `material.userData.setVertexLight(false)`.
    4. Shadow taps (`shadowTaps.ts`, `installShadowTaps`): three r187's 5 Vogel PCF taps computed 5 sin + 5 cos per
       pixel; the offsets are now constants rotated by one cos / sin pair (same samples to float rounding), for every
       shadow receiver. −0.6 / −0.9 ms at 01 / 08 (4 repeats).
    5. Field lines skip the strip frame and the `tCult` fetch where both grid axes span ≥ 4 m per pixel (lines are
       faded to zero there anyway: exact).
  - **Vineyard moiré (pose 11, wave-3 residual):** the near rows used `fwidth` and a mipmapped noise fetch inside a
    non-uniform branch (undefined derivatives) and kept hard leaf edges up to 0.4 rows per pixel; the 1 m plant
    swelling (staggered 0.37 m per row) aliased into the red/green diagonal crosshatch. Now the footprint comes from
    the derivatives taken in uniform control flow; `vineRows(…, pr)` box-filters the leaf and shadow edges to the
    pixel footprint across the rows; the plant swelling fades at 0.08–0.2 m and the 0.32 m leaf clusters at
    0.05–0.12 m per pixel along the rows (`vnoise0`, no mip jumps at row seams); the rows fade into the baked average
    at 0.1–0.25 rows per pixel. The near-field mean equals the bake within 0.2 % (linear RGB over the rows, measured
    with the rows forced off). `docs/shots/KB-I59/before|after-11-crop-vineyard.jpg`: clean stripes, no crosshatch.
  - **Bench**, same session, `ab.mjs` (`new` = this item; `old` = terrain and sky order 0, no pre-pass, per-pixel
    terrain light; shadow taps, field skip and vine filter are not runtime-switchable and are in both), 3024×1964,
    "Hoch" (4096 shadow map), min / median ms:

    | Pose | Run A (load 32) new | Run A old | Run B (load 36) new | Run B old |
    |---|---|---|---|---|
    | 01 | 5.45 / 6.59 | 14.32 / 18.05 | 4.01 / 4.54 | 7.61 / 10.79 |
    | 08 | 6.30 / 7.42 | 16.49 / 19.12 | 4.09 / 4.85 | 6.39 / 10.55 |
    | 12 | 11.21 / 11.66 | 18.33 / 20.17 | 5.68 / 10.28 | 17.35 / 18.91 |
    | 13 | 3.61 / 3.85 | 4.37 / 4.95 | 3.70 / 3.91 | 4.63 / 4.95 |
    | 05 | 3.68 / 3.99 | 4.12 / 4.25 | | |
    | 11 | 3.76 / 3.93 | 4.30 / 4.33 | | |
    | 16 | 3.27 / 3.27 | 3.34 / 3.44 | | |
    | 03 | 3.95 / 4.17 | 4.38 / 4.49 | | |

    Run A 5 repeats per variant (8 poses), run B 5 repeats (4 poses). 1080p (3 repeats, min / median): 01 2.92 / 2.93
    vs 3.02 / 3.25, 08 2.71 / 3.02 vs 3.11 / 3.51, 12 2.70 / 2.87 vs 3.06 / 6.07, 13 2.49 / 2.49 vs 2.70 / 2.87, 05,
    11, 16 −0.1…−0.5. CPU per frame +0.1–0.4 ms (pre-pass calls). The full 24-pose `shots.mjs --bench` after set
    (scratchpad `wave4-perf-after`, one run, quieter GPU): 01 2.8 / 4.5, 08 2.7 / 3.7, 12 2.6 / 4.3, 13 2.6 / 3.8 ms
    (1080p / retina); `wave3-final`: 3.6 / 17.6, 3.2 / 20.3, 3.1 / 19.5, 2.8 / 16.5. **01, 08, 12, 13 ≤ 12 ms retina
    with Hoch: met** (12 is the closest: run A median 11.7; its remaining big term is the sky's cloud fbm, see
    Discovered).
  - **Visual equality:** same-session new vs old shots at 1920×1080 (01, 05, 08, 11, 12, 13, 16): mean |Δ| 0.02–0.13
    of 255, p99 ≤ 3, > 12/255 on ≤ 0.08 % of the pixels (wind-animated foliage between captures and a few MSAA silhouette
    pixels); 13 is +0.13 brighter on far terrain (the dropped `geometryRoughness`). Against `wave3-final` the
    differences are other implementers' building changes. Shots `docs/shots/KB-I59/` (01, 08, 12, 11 vineyard crop).
  - Tests: `viewer/tests/perf-shading.test.ts` (7: tap rotation = three's Vogel samples, r187 patch targets, the
    collapsed multi-scatter terms, the draw order, the vine edge filter keeps the area average).
  - Not verified: real rAF pacing on a retina display; the cost on base M1/M2 GPUs (the MSAA overdraw effect may differ
    off ANGLE/Metal headless).
  - **Lead check (wave 4, `wave4-after`, all 24 poses, load average 36–49):** retina 01 4.3, 02 3.5, 08 4.0, 12 4.7,
    13 4.1 ms; a second run 01 4.6, 02 3.6, 08 4.0, 12 3.8, 13 3.6 ms. Every pose is ≤ 5.0 ms at 3024×1964 and ≤ 3.1 ms
    at 1080p. Shots 01, 08, 12 against `wave3-final` (`docs/shots/KB-I59/`, refreshed at 1280 px) differ only where
    other items changed the scene (court lanes, rotunda, rods). **Acceptance met.**
  - **Wave-4 review fix (CPU, perf):** the review measured 1080p CPU per frame up 1–2 ms (03 3.6 → 5.6, 14 3.8 → 5.2)
    and CPU ahead of the GPU at every eye-level pose. Profile (CDP sampling, pose 03, load ≈ 65): `renderScene`
    3.4 ms, `projectObject` 1.6, `updateMatrixWorld` 1.2 (three recomposed and multiplied all ~5 400 matrices each
    frame, because the Scene's own `matrixAutoUpdate` forces the whole tree). Hiding toggles at 03 (1080p, same
    session): interiors −944 calls / −3.1 ms CPU, terrain pre-pass −86 calls / −0.4, roof hardware + court furniture
    + rotunda −21 calls / ≈ 0.05. Changes:
    1. **Pre-pass as a static lower bound** (`terrain.ts` `minEnvelope`, `PREPASS_STEP` 8, `PREPASS_BLOCK` 512): 30
       blocks of a coarse 8 m grid (≈ 89 k vertices) instead of a copy of every 128 m chunk (+80–120 draws and ~360
       scene objects). Each vertex keeps its DTM height lowered by the largest chord excess of its triangles, so the
       bound is exact on crests and convex slopes (what hides things) and lower only in hollows; it uses the chunk
       triangulation, whose diagonals are unions of the fine ones, so it lies below every LOD mesh (step 1/2/4/8) by
       construction (`viewer/tests/terrain-prepass.test.ts` checks it on a 0.25-cell raster). Cells cut by the grid
       edge cap their corners at the cell minimum; 0.1 m `PREPASS_DROP` + `polygonOffset` against ties. The pre-pass
       hides itself while the camera is below the ground (buried rooms). Rebuilt on the epoch switch (15–55 ms).
       A first plain min-envelope (min over the vertex support) shaved crests by metres and was replaced.
    2. **Static matrices** (`staticMatrices.ts`, main.ts after the build and on each lazy LOD2 build): the buildings,
       site features, forest and terrain are composed once and frozen, and the Scene root no longer forces the tree.
       Objects with their own `onBeforeRender` (fountain jets) and everything added later stay live. Terrain chunks are
       created frozen.
    - **Same-session A/B** (`ab.mjs`, private Vite on 5271 without HMR, `old` = per-chunk pre-pass + live matrices,
      i.e. the wave-4 state; load average 70–72; 6 repeats, median CPU ms at 1080p): 03 6.66 → 6.08, 14 6.52 → 6.03,
      06 5.78 → 5.12, 21 5.98 → 5.26, 24 5.90 → 5.01, 12 3.11 → 2.26, 01 4.41 → 3.76 (−0.5…−0.9 ms). Calls −86 at 03,
      −100…−170 elsewhere; triangles −0.4…−0.5 M (the pre-pass now adds ≈ 0.06 M). GPU at retina (8–10 repeats, the
      `old` variant interleaved between two copies of `new` to cancel order bias): 05 7.0 / 8.1 / 7.4 vs 7.2, 08
      6.3 / 7.4 / 6.6 vs 5.8, 12 10.6 / 11.6 vs 11.3 ms median, minima 4.1 vs 4.2 (05), 4.2 vs 4.5 (08), 3.6 vs 4.4
      (13): equal within the noise of a machine at load 70. Debug renders of the pre-pass depth in colour (01, 05,
      12) cover the same pixels.
    - **Visual:** same-session new vs `old` at 1920×1080 (01, 03, 05, 08, 11, 12, 13, 14, 16): mean |Δ| ≤ 0.03 of
      255, p99 ≤ 1, > 12/255 on ≤ 0.07 % (foliage wind between captures and the stats line); epoch 2025 at 01 / 16
      0.11 / 0.02. All 25 poses re-shot (`wave4-fix-perf`): every retina pose ≤ 5.3 ms except 12 at 7.9 under load
      74 (≤ 4.7 in quieter runs); against `wave4-after` the differences are other items (lanes at 03/09/10/14,
      rotunda 18, Speisesaal 20).
    - **Not met / handed on:** "CPU within 0.5 ms of `wave3-final` at 03 and 14": across sessions 03 is ≈ 5.3 ms
      (`wave4-fix-perf`, load 74) against 3.6 (`wave3-final`). The rest of the rise is not terrain: at 03 the
      interiors within `INTERIOR_DIST` (45 m) are ≈ 940 of 1 285 draws and ≈ 3 ms CPU, seen only through windows.
      Levers outside perf ownership: merge interior meshes per material per room or storey (`model/src/interior`,
      programme; most rooms draw lambris, boiserie, door, cornice, ceiling, pier glass and candelabra parts in gilt,
      wood and wall materials separately), or tighten the interior budget in `main.ts` `updateInteriorBudget` (e.g.
      only facades facing the camera). Rods / downpipes / court furniture are already merged per material per
      building (≈ 21 draws at 03), so merging them further gains little. Not verified on an idle machine.

## Wave 2: the 1789 landscape

### KB-I09 · 1789 land cover instead of today's forest `[x] (uncommitted)`
- **Why:** the forest is "today's canopy > 8 m and > 40 m from features" (`scripts/prepare-terrain.py` ~l. 281–282,
  class 6), so the palace sits in a clearing. The Pleine vue 1791, Petri's plan (BSB Cod.icon. 180 h, 26r) and HMS
  show an open, cultivated ridge: meadows, fields, a vineyard, avenues, forest only as belts and on the E plateau
  (research/11 §0, §1.5, G1, S1, §6.3) [D PV; D Petri via Schneider; HMS]. The single biggest visual and
  historical error.
- **Payoff:** ★★★ / ★★★. **Effort:** L. **Perf:** fewer trees near the core, est. −2 to −6 ms aerial.
- **Files:** `scripts/catalogue-v2/terrain.ts` (`landcover` polygons per 11 §6.3), `model/src/spec.ts` +
  `validate.ts` (new kind), `scripts/prepare-terrain.py` (classes 8 field, 9 vineyard, 10 kitchen garden, 11 hay
  meadow; forest from polygons, not CHM, for epoch 1789), `viewer/src/terrain.ts` (splat colours), `viewer/src/forest.ts`;
  regenerate `viewer/public/terrain/` (CLAUDE.md command); `docs/architecture.md`.
- **Acceptance:** the aerial reads "a long white palace town on an open ridge" (11 §6.3 expected result); forest
  edge irregular (noise 6–10 m) with a shrub mantle; the 2025 epoch keeps today's canopy; shots 01, 02, 11, 12, 13
  before/after; bench 01, 08; tree count before/after logged.
- **Result (2026-11-02, wave 2):**
  - New builder `scripts/catalogue-v2/landcover.ts`: 23 evidence-tagged polygons painted in order (LC-01…04 fields,
    LC-05/20/21 hay, LC-10 steep-slope forest rule `min_slope 0.3`, LC-11…16 forest belts and the E-plateau beech
    wood after D Louisenhof 1768, LC-22 Herzogsgarten lawn, LC-23 vineyard LP06 30 traced from the hatching with RMS
    11.7 m, LC-24…30 kitchen gardens), each with confidence, tag and notes; U/I areas are low/med confidence. They
    reach `catalogue.json` as a top-level `landcover` key via `pipeline.ts`. `spec.ts` and `validate.ts` do **not**
    type or validate it yet (see Discovered).
  - `scripts/prepare-terrain.py` writes `ground.u8` for 1789 (polygons, slope rule with morphological cleanup, seeded
    ±7 m irregular edge, 14 m clearings at buildings, path verges, then epoch-filtered features) and `ground2025.u8`
    (the old CHM rule) for the 2025 epoch. New classes 8 field, 9 vineyard, 10 kitchen garden, 11 hay, 12 parterre
    sand, with German labels, hectares and tags in `meta.json`. Deterministic (identical bytes on re-run, ~7 s).
  - `viewer/src/landcover.ts` (pure: `packGround`, `forestPlan` with beech .7 / oak .2 / hornbeam .1, a 3.6 m shrub
    mantle in the outer 6 m, standards ~20 % taller within 20 m of the edge; `noiseLattice`). `viewer/src/terrain.ts`
    shades hay (~95 × 70 m parcels: standing, cut with windrows, regrowth), fields (Gewann blocks, 12–24 m strips,
    balks, furrows), vineyard rows 1.1 m apart down the slope, kitchen-garden quarters and beds. Ground textures swap
    on epoch change.

  Checks:
  - Shots (`docs/shots/KB-I09/`, poses 01, 11, 12, 13; 02 and 08 in the full set): the palace now sits on an open,
    cultivated ridge. Field patchwork on the plateaus, hay on the W and SW slopes, the Herzogsgarten lawn framed by
    forest belts, forest on the E plateau and the steep valley sides, kitchen gardens at the Gärtnerei, a vineyard
    strip, and a forest edge with shrub mantle and standards. **Acceptance met.**
  - Ground cells (2 m) for 1789: forest 324 k (2025: 1.01 M), field 270 k, hay 261 k, kitchen garden 20 k, vineyard
    5.2 k, lawn 21 k. Trees: 28,381 (old CHM forest) → **20,597** in 1789; the 2025 epoch plants 107,825 (denser
    planner).
  - Bench 01 / 08, before → after: 1080p 3.1 → 5.0–6.1 / 2.7 → 2.7–6.5 ms; 3024×1964 15.4 → 25.1–26.4 / 7.4 →
    21.2–27.0 ms. The perf estimate (−2…−6 ms) was **not** met: triangles halved, but the per-pixel splat costs more
    than the trees saved (see KB-I10 and Discovered).
  - Weak spots seen in the shots: the 2 m class raster shows as stair steps at field/meadow edges near the camera
    (12); "regrowth" hay parcels read as dark brown ploughed soil from the air (01, 11); pose 11 "Tiefflug über den
    W-Wald" now flies over meadows, so no current pose shows a low flight over 1789 forest.
  - Tests: `viewer/tests/landcover.test.ts`, `model/tests/landcover.test.ts` (catalogue equals builder, ids, covers,
    tags, CCW rings, mixes, zones).
- **Result (2026-11-02, wave 3, follow-up):** `landcover` is typed and validated. `spec.ts` has `LANDCOVER_COVERS`,
  `LandcoverCover`, `LandcoverArea` and `SiteSpec.landcover?`; `scripts/catalogue-v2/landcover.ts` re-exports them.
  `validate.ts` checks unique LC-nn ids, known covers, `name_de`, confidence, evidence tags, one closed CCW ring of
  ≥ 4 points inside the EPSG window, `min_slope` in (0, 2], forest mix shares summing to 1, and the epoch.
  `verify.sh catalogue`: byte for byte, 0 errors, 0 warnings; 5 tests in `viewer/tests/landcover-validate.test.ts`.
  The look follow-ups (soft class edges, meadow, fields, micro-relief) are KB-I56. `viewer/src/main.ts` still reads
  the parcels through an `as unknown as { landcover? }` cast (Discovered, wave 3).

### KB-I10 · Forest tiling, culling and impostors `[x] (uncommitted; aerial budget met via KB-I59)`
- **Why:** 28,381 trees in 4 InstancedMeshes with ~2.15 km bounding spheres are never culled and are drawn in the
  main and shadow passes; hiding them took view-west from ~13 to 4.1 ms (visual-audit §3, P1) [measured].
- **Payoff:** – / ★. **Effort:** M. **Perf:** −3 to −9 ms aerial.
- **Files:** `viewer/src/forest.ts`, `model/src/site/trees.ts`.
- **Acceptance:** 512 m tiles (or InstancedMesh2 + BVH, pinned) with per-tile bounds; impostors beyond ~400 m;
  shadow casting only inside the near shadow box; shots 01, 11 visually equal; bench 01, 08, 11 before/after. Do it
  after KB-I09 (the tree set changes).
- **Result (2026-11-02, wave 2):**
  - `viewer/src/forest.ts` is a `Forest` class: trees bucketed into **320 m** tiles with per-tile bounding spheres, so
    frustum culling works in the main and the shadow pass. Two levels per tile by camera distance to its box
    (`FOREST_NEAR` 420 m): near = shared 6-sided trunks + 3 lobed crown variants, casting shadows; far = crowns only as
    a 20-triangle icosahedron (low-poly, **not** billboard impostors), no shadows. `forestLod.update(camera)` runs every
    frame and marks the cached shadow map dirty only when a tile changes level. `skb.forest` exposes `stats()` and
    `nearDistance`.
  - The splat shader was optimised too, because A/B showed it, not the trees, was the main GPU cost: value noise from
    a mipmapped 256² lattice texture (one fetch instead of four hashes), the court-sand rut loop vectorised (no
    `pow()` with a negative base, which is undefined in GLSL), gravel anisotropy 8 → 4.

  Checks:
  - At 01, 4 of 46 tiles draw the near level. Triangles 2.40 → 1.26 M; calls 509 → 568 (tiles).
  - Shots 01 and 11 are not "visually equal" to the before set because KB-I09 changed the tree set in the same wave;
    `docs/shots/KB-I10/` (01, 08) shows the new forest belts with no popping seams in the stills.
  - Bench 01 / 08 / 11 at 3024×1964: 15.4 / 7.4 / 3.4 → 25.1–26.4 / 21.2–27.0 / 12.5–18.9 ms. The forest itself costs
    about 2–3 ms retina at 01 (implementer A/B: forest hidden 23.7 vs 26.0 ms); a constant splat gives 8–16 ms. The
    item's perf goal (−3…−9 ms aerial) and the ≤ 12 ms aerial budget are **missed**; the remaining cost is the
    land-cover splat at retina resolution. Next levers: a signed-distance or lower-frequency class encoding, fewer
    taps in the cultivated branches, a depth pre-pass (or drawing buildings and forest before the terrain).
  - Not done: 512 m tiles / InstancedMesh2 as written, real impostors. Not verified: frame pacing in flight.
- **Wave 4 (lead):** with KB-I59's draw order and terrain pre-pass, `wave4-after` benches 01 / 08 / 11 at
  3024×1964 in 4.3 / 4.0 / 4.0 ms (1080p 2.9 / 2.7 / 2.6), so the ≤ 12 ms aerial budget this item missed is met.
  The low-poly far tier stands in for impostors (Decisions log); closed.

### KB-I11 · Tree species, shapes and young avenue trees `[x] (uncommitted)`
- **Why:** only tilia, malus, aesculus, forest and citrus exist, every crown is a lobed icosahedron, and
  `speciesFor()` (`model/src/site/trees.ts:32–36`) maps every "kastanie" to *Aesculus*, although the Herzogskastanien
  were sweet chestnuts (research/11 G5, S4) [D de.wikipedia "Esskastanien"]. Avenues and clumps were young in 1789
  (planted 1778–88, 5–8 m) (11 §3.2) [I]; TF-10 Paradestraße is a confirmed two-row avenue (S9) [D Schneider].
- **Payoff:** ★★ / ★★. **Effort:** M. **Perf:** +0…0.3 ms.
- **Files:** `model/src/site/trees.ts`, `model/src/layout/grammar.ts` (a `GARDEN` block with tags), tests for
  `speciesFor`.
- **Acceptance:** species castanea, populus_italica, conifer, shrub_flowering, taxus_cone, beech_old per 11 S4;
  `speciesFor('Castanea sativa (D: Esskastanien)').key === 'castanea'` (it returns a `TreeSpecies`); stakes on young avenue trees at LOD0; shots 03,
  04, 13.
- **Result (2026-11-02, wave 2):**
  - `model/src/site/trees.ts`: five crown shapes (lobed, column, tiered, cone, shrub; `crownGeometry`/`crownHeight`
    exported) and the species tilia, malus (8° lean), aesculus, castanea, populus_italica, conifer (tiered spruce),
    shrub_flowering, taxus_cone, beech_old and citrus, each with a tag. Forest bark `#6E6860`.
  - `speciesFor`: Castanea / Edel- / Esskastanie → castanea; Rosskastanie / marronnier → aesculus; a bare "Kastanie"
    → aesculus with one `console.warn`; Pappel, Malus, Taxus; Hainbuche / carpinus → tilia shape. Fixed: "carpinus"
    matched `\bpinus` and became a conifer. Fixed: cone lobes rendered as knife blades (indexed geometry →
    `toNonIndexed` in `pushLobe`).
  - Avenue trees up to 8 m get one stake each (non-shadow InstancedMesh, built at lod ≤ 1, hidden beyond 150 m).
  - Plans and 3D share one avenue-blocking function (`avenueBlockers` / `treeBlocked` in `layout/garden.ts`).

  Checks: `speciesFor('Castanea sativa (D: Esskastanien)').key` returns `'castanea'` (run with tsx in this check;
  also in `garden.test.ts`), and `speciesFor('carpinus betulus').key` returns `'tilia'`. All six S4 species exist.
  Shots `docs/shots/KB-I11/` (02, 13) show column poplars, tiered conifers and clumps; the stakes are too small for
  the standard poses (implementer close-up only), and their presence at lod ≤ 1 is tested (TF-10 in the site build).
  Shots 03 and 04 show no trees near the camera. Note: a conifer in deep shade reads almost black at 02.

### KB-I12 · Herzogsgarten: Petri's lawn garden replaces the TF-09 parterre `[x] (uncommitted)`
- **Why:** Petri's c. 1788 plan shows an English lawn E of the CdL with a belt walk, clumps, conifers, benches,
  sculpture and four pavilions, and no parterre; Schneider finds no evidence of a Rasenparterre (research/11 §1.2,
  G2, S2) [D BSB 26r via Schneider]. From 1788 Petri began "nach der allerneuesten englischen Mode" (10 §b.7, D).
  TF-11 Ostachse appears in no period plan (11 G4) [I].
- **Payoff:** ★★★ / ★★★. **Effort:** L. **Perf:** +0.3 ms (clumps), within the +0.5 M triangle budget.
- **Files:** `scripts/catalogue-v2/terrain.ts`, `model/src/spec.ts`, `model/src/layout/site.ts` (pure
  `clumpPlants`, `walkRibbon` + tests per 11 §6.5), `model/src/site/features.ts`, `model/src/site/trees.ts`,
  `scripts/prepare-terrain.py` (lawn class, no levelling), plans (LP sheets).
- **Acceptance:** 11 S2 (a)–(e): 6–8 m gravel terrace at 345.9 with the 2-step perron kept; 3 m belt walk loop with a
  serpentine branch to KB-B80; 12–20 clumps; forest belts N and S; TF-11 trees `hypothetical` with low confidence
  (hypotheticals render by default, so they hide only via the viewer's "Hypothesen (niedrige Konfidenz)" select or a
  logged decision to change the default); shots 02, 04, 13, 15;
  `pnpm run plans` regenerated; light layer re-exported if site stone features change.
- **Result (2026-11-02, wave 2):**
  - TF-09 is now a 7 m gravel garden terrace (kind `terrace`, u 46.2–53.2, v ±30, level 345.9) with the 2-step perron
    kept.
  - New spec kinds `lawn` and `clump` (fields `placement`, `radius`, `mix`, `fountain_h`, `coping`, `ornaments`) in
    `spec.ts` / `validate.ts` (small additive edits by the garden implementer). `herzogsgarten()` in
    `catalogue-v2/terrain.ts`: HG-01 lawn (from 1788, outline shared with LC-22), HG-02 belt walk 3.0 m
    (Chaikin-smoothed loop), HG-03 serpentine walk 2.4 m to KB-B80, HG-05 rondell (R ≈ 10), 16 clumps HG-10…25
    (8–25 m, shrubs 60 / trees 30 / accent 10 %, some with retained beech), HG-30 with ≥ 30 single trees kept off the
    axis. Walks ≤ 4 m render as draped gravel ribbons. Pure helpers: `chaikin`, `resample`, `walkRibbon`,
    `polylineSelfIntersects`, `allocateShares`, `clumpPlants`, `singleTrees`; the generator throws on self-crossing
    walks, clumps touching walks / basin / axis, or < 30 single trees.
  - TF-11 trees: `placement: 'hypothetical'`, confidence low, a separate `site/trees-hypothetical` group, not drawn
    across HG-01, hidden with "Hypothesen" off or low confidence "hide".
  - LP-00 / LP-01 draw the lawn, clumps, basin and walks (previews regenerated with `--no-pdf`).

  Checks: catalogue 54 terrain features, 0 validation errors, `verify.sh catalogue` reproduces it byte for byte.
  Shots `docs/shots/KB-I12/` (02, 04, 13): 02 shows the open lawn, the kidney-shaped belt walk, clumps and the basin on
  the axis; 04 and 15 show the open lawn in front of the garden façade with the terrace as a pale band at its foot;
  forest belts N and S (LC-13/14) frame the lawn in 01. All of S2 (a)–(e) are met. Garden geometry adds +32 calls and
  +92 k triangles (1789 vs 1782 feature group, counted in node), within the +0.5 M budget.
  Open: the TF-11 avenue's 8 m gravel strip is still painted down the axis across the lawn in `ground.u8` (two faint
  lines at 02); LP-02 / LP-03 previews were not regenerated (both date from before the change); benches, sculpture
  and pavilions are KB-I32/I33.
- **Wave 9 (garden, 2026-11-02): Petri framing groups.** Five catalogue features `TF-45`…`TF-49` (MultiPoint, one
  layer each; `placement: 'hypothetical'`, confidence low, epoch from 1788) form two groups graded low → tall away from
  the lawn: low July-flowering roses / Spiraea / Hypericum (new species `shrub_july`), tall flowering shrubs, young
  limes, Pyramidenpappeln, conifers (22 front shrubs, 17 mid shrubs, 7 back trees). Group N (palace grid u 132, v 46)
  frames the right of the lawn view to the garden front (16 / 17), group S (u 85, v −22) is a dark backdrop behind the
  fountain jet (a first position at u 96 hid the Rundpavillon). Seeded `framingLayout` in
  `scripts/catalogue-v2/terrain.ts` keeps the axis vista (|v| ≥ 12), belt and spur walks, basin, single trees, furniture
  and wells clear; numbers in grammar `GARDEN_GRADED` [D Petri plan clumps, columnar trees, conifers (research/11 S2 c);
  N species and July bloom (§3.1); I positions]. The features sort last, so the seeded tree streams stay
  prefix-stable. Test `model/tests/garden-wave9.test.ts` (5).
- **Lead check (wave 9):** `docs/shots/KB-I12/*-wave9-16-…`, `…-17-…`, `…-33-…`. 16 / 17: a tall mass of young limes
  and shrubs now closes the right edge and a darker grove with conifers stands behind the jet; 33: group N appears
  right of the HG-10 clump. The young limes read bright yellow-green next to the older crowns and hide the conifer
  that topped the right edge before. Trees at 39 / 40 / 41 unchanged (mean |Δ| 40: 0.16 / 255; 39 / 41 differ only
  at the shore and the blades). verify.sh catalogue reproduces byte for byte (87 terrain features, 82 after the wave-8 review fix), history-check
  0 failures. Done.
- **Wave-9 review fix (garden, 2026-11-02): framing groups.** TF-47 are young feathered limes (Heister, new species
  `tilia_heister`: 6–7 m from `GARDEN_GRADED.heister`, a narrow ovoid crown from ≈ 1.4 m, mid / yellow-green
  `#5C8039`, the mature trees' close-crown clumps), not big-lobe balloons on a 3 m trunk; TF-46 are tall shrubs out of
  flower in July (`shrub_green`, no bloom); the July shrub blooms rose and white only (no yellow; leaf `#5C7E44`).
  Group N's back row is conifer · lime · poplar · lime, so the TF-49 conifer breaks the skyline at the right edge of
  16 / 17 again. `framingLayout` keeps every Pyramidenpappel `GARDEN_GRADED.sightClear` (7 m) off the line of sight
  from the lawn eye (u 150, v 25) to the jet (`FramingAvoid.sight`, `sightDistance`); group S is poplar · lime ·
  conifer, the dark conifer behind the jet. TF-48 tag: "columnar trees D Petri plan ("pappelartig"); species I; German
  cultivation date U (research/11 §3.1 conflict)". Tests (`garden-wave9.test.ts`, +3): Heister form and colours, the
  sight distance, and the jet's screen box at the 16/17 camera overlapping no poplar. Shots `…/scratchpad/wave9-fix-garden/final/` 16, 17, 33,
  `photo-garten.jpg`, `tour-garten-0.6.jpg`: no balloon mass at the right edge, the jet stands free against the
  conifer.

### KB-I13 · Axial basin with fountain and two stag heads `[~] re-export pending`
- **Why:** a round basin with a jet and two stag heads on the CdL axis existed from after 1783 to about 1790
  (LA Speyer B3 2595, B4 2547, B3 2611 via Schneider; research/11 §1.3, G7, S3) [D existence; position I; size N/U].
- **Payoff:** ★★ / ★★★. **Effort:** S. **Perf:** +0.1 ms.
- **Files:** `scripts/catalogue-v2/terrain.ts` (`basin`, epoch 1783–1790), `model/src/site/features.ts`,
  `model/src/materials/index.ts` (water).
- **Acceptance:** after KB-I03 and KB-I12 (the site lies inside today's TF-09 parterre, u 46.2–110); basin D ≈ 14 m at
  u ≈ +90…+130 m, v = 0 ± 0.5 m, sandstone coping 0.4 × 0.25 m, 5 m jet, stag heads facing the CdL; hidden in an
  epoch after 1790; light layer re-exported (the coping is a stone site node); shots 02, 04, 13, 15.
- **Result (2026-11-02, wave 2):** HG-04, epoch 1783–1790: round pond at u 112, v 0, R 7 m (D 14 m), water level
  349.8, on the levelled HG-05 rondell. 48-segment stone coping 0.4 × 0.25 m with a wall down to the ground, a water
  disc, a 5 m jet group (`feature/HG-04/jet`: column, mist sheath, foam ring; own `water.jet` material), and two stone
  stag heads on plinths facing KB-B01 (`basinOrnaments`). Tags: existence D (LA Speyer via Schneider), position I,
  size N/U.

  Checks: tests cover position and size, the epoch (built in 1789, absent in 1782 and 1791) and ornament placement.
  Shot `docs/shots/KB-I13/after-02-aerial-east.jpg`: basin and jet centred on the axis. In 04 and 15 the camera (u ≈
  96) stands W of the basin (u 105–119) looking W, so the basin is behind it; 13 does not frame it. The temp-dir export
  now has 98 nodes (89 buildings + **9 site**), 335 k triangles, 4.57 MB, so the stone coping and stag heads are in
  the light layer build. **Missing:** `pnpm run export:explorer` into `../app` and the explorer notice
  (coordinator's step at commit, with KB-I03 and KB-I15).

### KB-I14 · Ground colours: Buntsandstein gravel, sand, hay, fields `[x] (uncommitted; wave 8)`
- **Order:** pulled forward into wave 1 as a quick win (index); do it after KB-I06 so the colours are judged under
  calibrated light. The hay and field colours wait for KB-I09's classes.
- **Why:** gravel is a uniform grey-ochre; period courts used pinkish Buntsandstein grit and yellow parterre sand
  (research/11 G19, S15) [N d'Argenville; D Le Clerc 1790; I hues]. Review-1 #16 left the Ehrenhof too light from the
  air (partly fixed).
- **Payoff:** ★ / ★★. **Effort:** S. **Perf:** 0.
- **Files:** `viewer/src/terrain.ts`.
- **Acceptance:** gravel ≈ `#B79A84` (albedo 0.40–0.45), parterre sand `#D3BE8A`, court sand `#C9B48E` (all [I]/[N],
  11 S15); July hay strips `#8FA060` / `#B9B07A` once KB-I09 adds the hay class; shots 01, 03, 14.
- **Result (2026-11-02, wave 1):**
  - `viewer/src/terrain.ts` adds a second weights texture: R gravel/building (classes 2/7), G cobbles (3), B sand
    (4).
  - Colours: gravel `#B79A84` (Buntsandstein grit [I hue; N d'Argenville; D Le Clerc 1790]); court sand `#C9B48E`
    [I]; cobbles `#9D8F7D` (catalogue `ground.cobbles`) [I].
  - The texture is normalised by its mean linear colour, so the hex is the average. Slow mottling is added.

  Shots: court and paths read pinkish-ochre instead of grey (01, 03, 14; `docs/shots/KB-I14/`). At 10:30 under blue
  skylight the court reads mauve; the sampled average at pose 03 is ≈ `#977E77`.
  **Missing:** parterre sand `#D3BE8A` (no ground class yet → KB-I34/I12), and the hay strips `#8FA060` / `#B9B07A`
  (→ KB-I09). The A channel of the second weights texture is free for one more class. Note that `#B79A84` has a
  linear albedo of ≈ 0.35, not the 0.40–0.45 the acceptance asks for; see Discovered.
- **Result (2026-11-02, wave 2):**
  - Hay `#8FA060` / `#B9B07A` now shade the hay class 11 from KB-I09 (standing, cut with windrows, regrowth).
  - Parterre sand `#D3BE8A` is wired as ground class 12 (features whose surface says "fine sand" or "parterre sand"),
    but no feature uses it yet (0 cells), so it is not visible. Hence still partial.
  - Ehrenhof court sand redone as raked fine sand: a second rotated and rescaled gravel tap breaks the 2 m texture
    repeat that caused periodic stripes; short irregular tine marks fade out before they alias; isotropic damp/dry
    patches at 3–15 m; three pairs of wheel ruts (gauge 1.48 m) from gate to portal with a hoof-trodden middle; edge
    wear with a moss tint along the buildings.

  Shots `after-wave2-03-ehrenhof-eye.jpg` and `after-wave2-14-ehrenhof-hero.jpg` (before = `after-03…`, `after-14…`):
  the stripe banding is gone and the sand is fine-grained. At eye level the main ruts read as two thin, fairly dark
  lines converging on the portal rather than soft tracks; acceptable, but a candidate for KB-I45. GPU at 03 / 14
  retina 3.4 / 3.5 → 4.0 / 3.7 ms.
- **Wave 8 (garden, 2026-11-02):** the "parterre sand unused" note was out of date: ground class 12 has 748 cells
  (TF-08 and TF-15, surface "fine sand", since wave 5). The parterre sand plate of `site/gardenDetail.ts` is now the
  yellow `#D3BE8A` of `GROUND_COLOURS.parterreSand` instead of the greyer `#CDBB98` (d'Argenville's yellow-sanded
  parterre ground, research/11 §4.3 / S7) [N; I hue].
- **Lead check (wave 8, 2026-11-02; before = `wave7-final`, after = `wave8-after`, three bench runs, min / median):** 42 and 31
  (`docs/shots/KB-I14/*-wave8-42-…`, `*-wave8-31-…`): the TF-08 and TF-15 parterre ground reads yellow-sanded instead
  of grey-beige; nothing else in those frames changed beyond the wave-8 lawn and rods. Done.

### KB-I56 · Land-cover look: soft class edges, meadow and lawn, fields, micro-relief `[x] (uncommitted)`
- **Why:** wave-2 review: the 2 m class raster showed as stair steps at field and meadow edges near the camera,
  field and balk fringes read neon, lawn and meadow were too saturated (lawn saturation ≈ 0.42), "regrowth" hay read
  as ploughed soil, the Orangerie foot had an orange fringe, and the DTM micro-relief read as lumpy turf beside
  levelled courts (visual-audit V6; Discovered, wave 2) [measured; I].
- **Payoff:** ★ / ★★. **Effort:** M. **Perf:** ~0 per pixel (fewer grass taps), one-off CPU at load.
- **Files:** `viewer/src/landcover.ts`, `viewer/src/landcoverBake.ts`, `viewer/src/terrain.ts`,
  `scripts/prepare-terrain.py`, `viewer/public/terrain/` (regenerated), tests.
- **Acceptance:** no raster staircase on class edges at the close-ups; calmer, less saturated lawn and meadow at 01,
  02, 12; no orange fringe at the Orangerie foot (05); a staircase-edge unit test; within +1 ms at 1080p.
- **Result (2026-11-02, wave 3):**
  - Soft class edges: class weights Gaussian-blurred (σ 1 cell), a max filter with peak-adaptive normalisation
    (`bandEdge` / erf) keeps each edge on the 0.5 iso-line and keeps bands ≥ 2 cells at full width; the weight texture
    is mipmapped. Hard surfaces use a per-pixel smoothstep at 0.5 with `fwidth` AA and a grain-based fray. A new RGBA
    distance texture `tDist` (0.25 m units: hard surface, forest, own-class edge inward, water). Grass detail taps are
    distance-gated (23 m tap within 700 m, 2 m tap within 150 m); grass chroma halved. Smoothing runs at load and on
    an epoch switch (~0.5 s CPU), not per frame.
  - Meadow and lawn (bake): dry and lush patches (lusher near water and the forest edge), 2.7 m noise against texture
    repeat, trodden verges near hard surfaces, desire paths within 45 m; the lawn as a scythed meadow-lawn with dry
    patches and worn walk edges. `GROUND_COLOURS` meadow `#717C4C`, dry `#8A8A55`, lush `#5E7444`, lawn `#738750`,
    lawn dry `#7E8A52`, worn `#8B7D62` (all [I]).
  - Fields: strips of spelt / rye, oats, fallow or clover, stubble with stooks; plough streaks and lodged patches; a
    hashed balk or furrow per strip boundary; grass headlands; dusty tracks with ruts 3 m inside ~45 % of block edges
    (same edge keys as the hedges, own hash offset). Hay parcels get a 5 m warp at 23 m scale (mirrored in the CPU
    `hayParcel`), a flowering tint and soft seams. Kitchen gardens toned down.
  - Micro-relief: beside levelled courts, terraces and parterres the open-land relief ramp is 2 → 6 m (was 4 → 12 m);
    buildings, water, dams and scarps keep 4 → 12 m. `prepare-terrain.py` re-run: 5,250 cells changed by > 5 cm (max
    +0.66 / −1.05 m); micro-relief rms 0.239 → 0.147 m.

  Checks: `viewer/tests/landcover-edges.test.ts` (9 tests; a 10° staircase edge becomes smooth: deviation < 0.3
  cells, kink < ⅓). Shots `docs/shots/KB-I56/` (01, 05, 12 and a field crop of 01): the near field strips and the
  meadow are calmer, balks are no longer neon, the forest-edge band at 12 is clean, the Orangerie foot (05) has no
  orange fringe; the Orangerie W bank is only slightly smoother (the TF-07 terrace edge is real curvature). The
  implementer's close-ups along TF-14 show smooth gravel edges. **Acceptance met for the look; the +1 ms budget is
  not proven** (bench noise-dominated, see KB-I59). Residuals: the kitchen gardens still read grid-like (KB-I36);
  hay parcel edges are fairly straight; the striped hay rectangle in 01's foreground still reads as a hard-edged
  block from the air.
- **Review fix (2026-11-02, wave 3 review, ground):**
  - Gewann strips (12, 01, 08; review: "the strip structure has nearly vanished"): a shared `FIELD_GLSL` strip frame
    (bake + terrain shader, CPU mirror `landcover.ts fieldStrip`). Every strip gets an alternating ±5.5 % value step
    (±1.5 % jitter), so neighbours differ by ≥ 8 % even with the same crop (tested); crops stay hard-stepped between
    strips (soft blending only field ↔ meadow). Balks (0.85 m grass) and furrows (0.45 m) are drawn **per pixel** in the
    terrain shader at ≥ 1 px (fwidth-based width from screen derivatives taken in uniform control flow), ending at the
    headland and fading where a strip is narrower than 6-12 px (no moiré); the bake keeps only a faint trace for the
    far mips. Field edges use the unwobbled class weight in both bake and shader, so the lines end where the field
    ends. Strips are 12-24 m × 150-190 m (block size unchanged: the hinterland hedges use the parcel polygons, not
    the blocks). Not done: orienting the strips along the slope (needs a slope input in the bake).
  - Vineyard LC-23 (11; review: "a dark amoeba"): the bake draws the LP06 outline exactly (signed distance to the
    catalogue polygon, `uVineSeg`, ≤ 1 m antialiased edge, `landcover.ts ringSegments` / `parcelSignedDistance`
    tested); the edge is exclusive (other classes yield inside, the neighbouring hay is looked up 3.5 m outside, so no
    soft meadow seam); a 1.6 m grass headland inside [N]. Colours `vine #7A9C4C`, hoed red-brown soil `#A0684E` only
    20 % greyed, lit leaf shading; the area average is now luminance 0.21 (was 0.15; meadow 0.18, hay 0.32) and warm
    olive-brown. Analytic rows now reach 400 m (alias fade 0.08-0.4 rows/px). No dry-stone wall: no source.
  - Hay near the camera (05): standing hay is buff-green with seed-head drifts, flower specks, 2-6 m tussock and
    lodged-patch breakup; parcels still being mown (hash < 0.6 of the cut ones, ~1/3) show mown and standing parts
    side by side (`hayParcel().cutTo`; hay cocks only on the mown part, tested); cultivated land takes 0.8 of the
    luminance grain near the camera.
  - TF-07 foot (05): `prepare-terrain.py` gives terraces without `wall_height` (TF-07, TF-09) a grass bank of 2.5 × the
    drop (3-10 m; TF-07 drop 5.6 m → 10 m, TF-09 0.45 m → 3 m) and rounds the crest (σ 1.5 m, outside only): the
    stair-stepped, fold-shaded crest is gone (close-up c5). Ground classes unchanged.

  Shots `docs/shots/KB-I56-review-fix/` (01, 04, 05, 11, 12 and close-ups c1 field strips from 250 m, c2/c3 vineyard,
  c5 TF-07 foot, c6 TF-09 edge); all 17 poses in the session scratchpad `wave3-fix-ground/`. Perf, same-session A/B
  of the new shader work (field lines, vine rows to 400 m, second near grass tap) against it switched off, 9
  repeats, min / median ms at 3024×1964: 01 13.4 / 20.1 vs 14.8 / 18.9, 12 11.3 / 20.4 vs 13.1 / 19.3, 13 14.1 / 16.2
  vs 12.4 / 14.7; at 1080p (5 repeats) within ±0.4 ms at 01, 04, 05, 11, 12, 13 [measured, loaded machine]. So ≈ +1 ms
  retina median, inside the noise; the wave-3 retina rise at 12 / 13 is not from the ground work. Tests
  `viewer/tests/landcover-review3.test.ts` (10).

### KB-I57 · Hinterland hedgerows and farmstead orchards `[x] (uncommitted)`
- **Why:** the 1789 hinterland read as bare parcels. The Pleine vue 1791 draws schematic hedge bands [D]; the open
  Gewannflur itself had no hedges [N]; orchards beside farmsteads are typical [N]; the Apfelallee TF-14 is
  documented [D]. All placements are low-confidence hypotheses.
- **Payoff:** ★ / ★★. **Effort:** M. **Perf:** shares the site-vegetation cost (≤ +0.9 ms upper bound with KB-I44).
- **Files:** new `viewer/src/hinterland.ts`, `viewer/src/forest.ts`, `viewer/src/main.ts`, tests.
- **Acceptance:** hedges only on open-land parcel edges, clear of forest and ways, with gaps and no duplicates;
  orchards next to farmsteads, never in fields, the palace core kept clear; evidence tags; shots 02, 12, 13.
- **Result (2026-11-02, wave 3):** pure `hinterlandPlan()`: meandering hedgerows with noise gaps along field and hay
  parcel edges (open land on both sides, ≥ 9 m from forest, ≥ 7 m from hard surfaces), deduplicated on shared edges,
  a hedge tree every 30–70 m; orchards on a 10 m grid 12–70 m from farmstead groups, 20–45 trees each, never in
  fields, outside 380 m of the palace core. Species: Crataegus, Prunus spinosa, Corylus, Rosa canina, Acer
  campestre, wild cherry, standard apple / pear / plum, Quercus as hedge tree. Counts: hedgerow 3,331, hedge tree
  195, orchard 241; total trees 23,464 → 25,997. The old Gewann hedges from `openTreePlan` are no longer planted.

  Checks: `viewer/tests/hinterland.test.ts` (determinism, edge rule, gaps, no duplicates, hedge-tree ratio, orchard
  rules, core clear, species, low-confidence tags). Shots `docs/shots/KB-I57/` (02, 11, 12): hedgerows with gaps on
  parcel edges; 12's foreground hedge reads well. **Acceptance met.** Roadside avenues were not drawn (no located
  road geometry): KB-I58.

  **Review fix (2026-11-02, wave 3).** The review found strings of identical shrubs in single file ("pearls") on almost
  every field and hay edge, which read as bocage at 13 and 11.
  - Coverage: only `HEDGE_SHARE` = 0.28 of the eligible edge length now carries a hedge. This is the one tunable
    density constant [I; review: 20–35 %]. Each line point is scored, and the best-scoring share is kept. Points score
    higher for slope balks along the contours (Stufenraine: slope 4–12 % with the edge across the gradient, from the
    terrain heights), for lying 10–25 m from a way, and for lying within 60–150 m of a farmstead or village building.
    A smooth noise makes runs of about 40–150 m [N preference; I weights]. Ravines are not detected.
  - Form: 1–3 shrubs deep (smooth noise along the line) and 1.5–5 m high (a smooth height noise; the middle row is
    taller), so neighbours merge into irregular masses with gaps. Hedge shrubs keep their planned height (no extra
    size jitter). The hedge trees stay, every 30–70 m of planted line.
  - Wobble and noise are functions of position, so a shared edge gives one line. It is deduplicated by 3 m owner
    cells.
  - Counts: hedgerow 3,331 → 1,905, hedge tree 195 → 56, orchard 241; total trees 25,997 → 24,432. Tags are
    unchanged (low confidence).

  Checks: `hinterland.test.ts` checks the share (0.28 ± 0.05 of the eligible length), that shrubs are 1.5–5 m high and
  1–3 deep, that a shared edge is not denser than the outer edges, and that contour edges get ≥ 1.5× the hedges of
  fall-line edges on a 10 % slope.

  Shots `wave3-fix-vegetation/` 02, 11, 13: a few curving hedge masses remain, and the hillsides no longer read as
  bocage. 11's single-file hedge is now a short mass with a hedge tree.

## Wave 3: facade truth (research/09)

### KB-I15 · Exterior palette: blue-grey shutters, bluer slate, painted render members `[~] re-export pending`
- **Order:** pulled forward into wave 1 as a quick win (index): S effort, documented, whole-site visual payoff. Do it
  after KB-I06 so the before/after compares colours under calibrated light.
- **Why:** classicist shutters were mostly white, light grey or blue-grey; HMS shows blue-grey (09 §3.2, M1, C3)
  [D→ Baunetz; HMS]. Koblenz 1777–93 (restored 1998 to Weissgrau walls, grey members), Le Clerc 1790 and Stengel's
  white Ludwigskirche back pale render with grey painted members (09 §2.5, M4, C4) [D→]. Slate was "blue" in the
  Pleine vue colour code (M2) [D]. A rushed, poorly run site (Hautt's 1785 "vernichtendes Gutachten") supports painted
  render members over dressed stone on the wings (09 §1.2–1.3, E7) [D NDB; I].
- **Payoff:** ★★ / ★★. **Effort:** S. **Perf:** 0.
- **Files:** `model/src/materials/index.ts`, `model/src/context.ts` (`MATERIAL_NAMES`: add `render.member`, additive),
  `model/src/exterior/facade.ts`, `scripts/catalogue-v2/buildings.ts` (defaults l. ~108–124),
  `model/src/explorer/export.ts` (colour bake), `docs/architecture.md` §3.6.
- **Acceptance:** shutters `#5F6F7A` on court buildings (farm buildings green `#3F5A3A` / oxblood `#6E2E26`, [N]),
  slate `#4A525C`, iron `#2E3439`, `render.member` `#B9B8B2` on wing members; stone only at plinths, portals, steps;
  history-check H13, H14, H15, H19 DONE and the E4 warning answered; shots 03, 05, 14; light layer re-exported (vertex
  colours change) and the explorer agent told.
- **Result (2026-11-02, wave 1):**
  - `render.member` `#B9B8B2` added to `MATERIAL_NAMES` and `MATERIAL_BASE` (additive, `docs/architecture.md` §3.6).
  - `palette()` selects members via `facade.members_material`: render on court buildings, stone on FARM, FARM_GROUP,
    RIDE and STABLE. Portals use `portal_colour` grey-pink `#BFAEA5`, and plinths and steps use `stone.red`.
  - Colours: shutters `#5F6F7A` on court buildings (farm `#3F5A3A`, stables `#6E2E26`) [N/D→]; slate `#4A525C` [D PV];
    iron `#2E3439`.
  - `model/tests/palette.test.ts` has 5 tests.

  Checks: history-check H13, H14, H15 and H19 DONE, and E4 PASS (the KB-B10 red members are resolved). Shots 03, 05
  and 14 show blue-grey shutters and a bluer slate (`docs/shots/KB-I15/`).
  **Missing:** the light-layer re-export (vertex colours change) and the explorer notice. This is the coordinator's
  step at commit, together with KB-I03.

### KB-I16 · French two-leaf casements and class-aware glazing `[x] (uncommitted)`
- **Why:** today one glazing rule (~0.42 × 0.48 m panes) applies everywhere and LOD1 draws "one mullion + transom",
  which reads as a Kreuzstock or a late-19th-century T-window. 1780s practice: two leaves on a meeting stile with an
  espagnolette, a transom only on tall windows; HMS shows 2 × 4 panes per sash (09 §3.1, G1–G3, E1)
  [D Baunetz; HMS; N].
- **Payoff:** ★★ / ★★. **Effort:** M. **Perf:** +0.1 ms.
- **Files:** `model/src/layout/grammar.ts` (`GLAZING` table + tags), `model/src/exterior/cut.ts` (`glazingGrid`,
  l. 157), `model/src/exterior/facade.ts` (l. ~328), tests.
- **Acceptance:** CDL upper 1 pane per leaf (h ≈ 0.55 m); CDL ground, WING2, RANGE1, ORANG 2 per leaf (~0.25 × 0.33 m);
  STABLE/FARM 2 per leaf in 3–4 rows; bars 0.03 m; transom only ≥ 2.6 m at 0.75 h; unit test per class
  (`model/tests/exterior.cut.test.ts` pins today's ~0.48 m rows, so rewrite it); history-check H16 DONE; shots 03,
  05, 14 (close facade); plans elevations regenerated if they draw glazing.
- **Result (2026-11-02, wave 3):**
  - `model/src/layout/grammar.ts`: `CASEMENT` (meeting stile 0.06 m, frame 0.07 m, transom only at ≥ 2.6 m, placed at
    0.75 h, one leaf below 0.7 m width) and `GLAZING` per class: CdL Beletage 1 pane per leaf (h ≈ 0.55 m); court
    buildings 2 per leaf, h/w 1.3 (≈ 0.265 × 0.345 m on a 1.2 m window), bar 0.03 m; farm 2 per leaf in 3–4 rows,
    bar 0.035 m. `glazingClass()` and the pure `glazingLayout()` feed both the 3D exterior and the plan elevations;
    `glazingGrid` is gone from `cut.ts`.
  - The meeting stile stops at the transom; the top light is fixed. LOD1 draws stile plus transom only, no Kreuzstock.
    Glass is `glass.crown` `#22302C` (M6, part of KB-I42) with ±1.5° normal jitter per leaf and top light at LOD2
    (per pane would cost ~+130 k LOD2 triangles). Bars draw only their front and long sides.

  Checks: 6 `glazingLayout` tests in `model/tests/exterior.cut.test.ts` (class mapping, pane sizes per class, STABLE
  rows, transom rule, narrow windows). history-check H16 DONE. Plans regenerated; AN-01 and AN-04 follow
  `glazingLayout`. Shots `docs/shots/KB-I16/` (03, 14 and a 1:1 CdL crop of 14): the CdL state floor shows large
  panes, 1 per leaf; the CdL ground floor and the wings show 4 columns of small panes. **Acceptance met** (05 frames
  the Orangerie too far away to judge panes; checked at 03 and 14). Perf: all buildings shown vs hidden at 14 cost
  0–1 ms within noise (implementer A/B); palace group LOD2 543 k → 568 k triangles for KB-I16/I17/I19/I20 together.

### KB-I17 · Plain wings: surrounds, flat Lisenen, no string course `[x] (uncommitted)`
- **Why:** HMS and Hautt's practice show plain wings: flat 0.20 m surrounds without hoods, flat 0.6 m corner strips,
  no Gurtgesims; one continuous cornice across the palace group (09 §3.4, G7–G9) [HMS; D Schneider 1988].
- **Payoff:** ★★ / ★. **Effort:** S. **Perf:** 0.
- **Files:** `model/src/layout/grammar.ts` (`ARTICULATION`), `model/src/exterior/facade.ts`.
- **Acceptance:** Ecklisene 0.6 m / 0.02 m (was 0.75 / 0.04); Verdachung only on CDL centre axes; layout tests
  updated; shots 03, 05, 13.
- **Result (2026-11-02, wave 3):**
  - `grammar.ts`: a `MEMBERS` table (string course and window caps only on the CdL) and `CORNICE.palace` {0.75, 0.68};
    `corniceFor()` gives the palace group one continuous cornice when `defaults.eaves_continuous` is set and the
    eaves equal `eaves_palace`. `BuildingLayout.members` (`facadeMembers()`) carries cornice, string course, corner
    Lisenen (not on FARM / FARM_GROUP) and risalit Lisenen ('all' on the CdL, 'portico' elsewhere).
  - `FacadeOpening` gains `row`, `hood` (CdL centre-risalit Beletage only) and `balcony` (porte-fenêtre above a
    portal only). Surrounds are flat 0.20 / 0.03 m bands; Ecklisene 0.6 × 0.02 m. Plan elevations use `L.members`.

  Checks: tests in `model/tests/facade.finish.test.ts` (B01–B03 get `CORNICE.palace`; string course only on the CdL;
  hoods only on CdL upper-row openings across the catalogue; balconies only on portes-fenêtres; no corner Lisenen on
  FARM). Shots `docs/shots/KB-I17/` (03, a 1:1 wing crop of 03, 05): the wings lost the string course and hoods and
  read calmer; the CdL keeps its string course. At 05 the Orangerie lost its undocumented risalit-edge Lisenen.
  13 shows the galerie only from 60 m, where the change is too small to judge. **Acceptance met.** AN-01: wings
  without string course.

### KB-I18 · Roof detail: Biberschwanz scale, lead decks, pavilion covers `[x] (uncommitted)`
- **Why:** the cover split itself is already in the catalogue: slate on the palace group (CdL, B02–B06, Orangerie),
  red tile on stables, farm and service ranges (history-check H18 DONE, 2026-11-02; 09 §2.7, E8 [D PV 1791 colour
  code, HMS]; slate on the main house D via Mannlich, 10 §c.1). What remains: the south-German tile is 38 × 18 cm with a
  ~15 cm visible course (G10) [D format], so the tile texture scale should follow it; mansard tops with upper pitch
  < 10° read as lead decks (E9) [HMS]; the 15 PAV buildings on slate need a check (garden pavilions may differ) [U].
- **Payoff:** ★ / ★. **Effort:** S. **Perf:** 0.
- **Files:** `model/src/layout/grammar.ts` (tile course, tagged), `model/src/exterior/roof.ts`,
  `model/src/materials/index.ts` (`roof.lead` exists), texture UV scale from `viewer/textures.json`,
  `scripts/catalogue-v2/buildings.ts` only if a PAV cover changes.
- **Acceptance:** H18 stays DONE; tile courses ≈ 0.15 m at LOD1 (measure in a close shot); lead deck on mansards with
  upper pitch < 10°; any cover change listed in the commit body with its tag; shots 01, 02, 13; light layer
  re-exported if a cover changed.
- **Result (2026-11-02, wave 4, exterior):**
  - `ROOF_COVER` in `grammar.ts`: Biberschwanz 38 × 18 cm, 0.15 m course [D format; D→ gauge 14.5–16.5 cm]. The
    clay-tile texture maps to 3.645 × 1.839 m (`clayTileSize()`, `TEXTURE_SIZE`), which matches its measured
    12.26 courses and 20.25 tiles per image: courses 0.15 m, tiles 0.18 m wide.
  - Lead-deck rule: a mansard upper slope flatter than `ROOF_COVER.leadDeckMaxPitch` (10°) is drawn in `roof.lead`
    (`isLeadDeckSegment` in `roof.ts`) [HMS E9; D Ludwigskirche]. **No catalogue mansard qualifies** (all upper
    pitches are 21–30°), so the rule changes nothing today; the conflict with the HMS "flat light deck" is in
    Discovered (wave 4).
  - Spear tips on fence and grille bars from LOD1: iron on the fence, gilt on the gate leaves (the KB-I23 grille
    point) [D→ Schwetzingen "teilvergoldet"].
  - No cover changed: the 15 PAV buildings stay slate (no source for another cover, [U]); no light-layer re-export
    needed for this item.

  Checks (lead): H18 DONE (history-check, 0 integrity failures). Tests in `model/tests/exterior.hardware.test.ts`
  (tile course, lead-deck rule). Tile course measured in the implementer's close-up of the Marstall KB-B20
  (`docs/shots/KB-I18/after-marstall-tile-closeup.jpg`, custom camera, no "before" possible without git): small
  Biberschwanz rows. At poses 01, 02 and 13 the tile scale is not visible (`before|after-13-galerie-garden-crop-roofs`
  are equal). **Acceptance met** (lead-deck clause vacuous until the catalogue has a flat deck). Perf 0.

### KB-I19 · Limewash, stone and slate variation; light weathering `[x] (uncommitted)`
- **Why:** a fast, additive site had uneven finish: warm limewash for 1778–82 work, cool for 1785–88, streaks under
  sills and cornices (09 §2.4, M3, C2) [D dates; N; I]; recycled Jägersburg/Hohenburg stone varies red to
  yellow-grey to grey-white (M5) [D reuse; I]; slate jitter and lead (visual-audit §5.8, P16).
- **Payoff:** ★ / ★★. **Effort:** M. **Perf:** ~0.
- **Files:** `scripts/catalogue-v2/buildings.ts` (`facade.build_year`), `model/src/spec.ts`,
  `model/src/materials/index.ts`, `model/src/exterior/builder.ts`, `model/src/exterior/roof.ts`.
- **Acceptance:** luminance variation ±3 % per building, deterministic (`mulberry32(hashString(id) ^ seed)`); stone
  per-block jitter as vertex colour; history-check H20 DONE; shots 01, 03, 05 (variation visible but subtle; no
  "dirty" look).
- **Result (2026-11-02, wave 3):**
  - `Facade.build_year` + `build_year_tag` (optional, additive in `spec.ts`), set by the catalogue builder from a
    `BUILD_YEAR` table and a `finishYear()` parser of the `built` text: 38 buildings dated; catalogue regenerated.
  - New `model/src/exterior/shade.ts`: `limewashColour()` moves the base 70 % toward warm `#EDE6D8` (finished by 1780)
    or cool `#E6E6E2` (from 1786) [D dates; N; I hues]; `buildingLum` ±3 % per building and `roofTint` per-building
    slate/tile jitter, both `mulberry32(hashString(id) ^ seed)`; grime streaks under cornices and under each window's
    sill column.
  - Sandstone per block: red 75 %, yellow-grey 16 %, grey-white 9 %, blend 0.2, lum ±3.5 % [D reuse; I shares],
    following the joints of the `sandstone_ashlar` texture (`ASHLAR`, `ashlarBlocks`) on plinths (LOD2 only),
    thresholds, Durchfahrt voussoirs, portal surrounds, Freitreppen and portico podiums. All of it is the per-vertex
    `aShade` rgb (KB-I20).

  Checks: history-check H20 DONE. `verify.sh catalogue` reproduces the file; 0 validation errors. Tests: warm/cool
  order, lum within ±3 % and deterministic, `ashlarBlocks` tiling, block tints deterministic with > 60 % red,
  `finishYear` ('1781-82' → 1782; 'before' / '1780s' → undefined). Shots `docs/shots/KB-I19/` (01, 05, a 1:1 plinth
  crop of 14): variation is subtle at 01 and 05; at 1:1 the wing plinth blocks read a little patchy but not dirty
  (the implementer weakened them twice). **Acceptance met.** LOD2 cost: ~85 k triangles for the plinth blocks (LOD2
  only); the LOD2 site build in Node rose from 748 to ~1160 ms (shading callbacks and wall splits).
- **Fix (2026-11-02, wave-3 review):** the plinth variation read as random patches (some purplish-grey) that did not
  follow the joints. Now every block varies a little: value ±5 % and a hue step from the base red toward yellow-grey of
  at most 12 % (share 0.12 · r², luminance kept), grey-white dropped (blending red toward grey turned it mauve)
  [D 09 §2.2 "yellow, red and yellow-red"; I amplitudes]. The ashlar texture now maps to 3 × 1.8 m (`TEXTURE_SIZE` in
  `materials/index.ts`), so the drawn courses are 0.36 m [N 09 §2.2: 0.30–0.40 m] and blocks 0.3–1.1 m; `ASHLAR`
  (`tileV` 1.8, `course` 0.36) keeps the colour blocks on the same joints. Tests: ±5 % value on 300 blocks, hue only
  toward yellow-grey (no blue lift), course grid and block lengths. Shots `docs/shots/KB-I19/*-wave3*` (09, 14 crops):
  calm red masonry with faint courses instead of patches. Cost: stone.red ≈ +20 k LOD2 triangles in view at 14 (more
  courses), within noise.

### KB-I20 · Baked vertex AO in the generator `[x] (uncommitted)`
- **Why:** no AO or contact darkening anywhere; a per-vertex `_AO` on reveals, cornice undersides and the wall foot
  costs nothing at runtime and survives glb export (visual-audit §4.3, §5.8, P9) [I].
- **Payoff:** – / ★★★. **Effort:** M. **Perf:** 0.
- **Files:** `model/src/exterior/builder.ts`, `facade.ts`, `roof.ts`, `model/src/materials/index.ts` (aomap chunk),
  `model/src/explorer/export.ts`, `docs/architecture.md` §3.6, `docs/explorer-integration.md` §2.2.
- **Acceptance:** AO visible in reveals at shots 03, 05, 14; the light layer either bakes AO into `COLOR_0` (format
  unchanged) or adds an attribute only after the explorer agent agrees (format change → `sle-recon-v1` contract);
  export round trip OK.
- **Result (2026-11-02, wave 3):**
  - `GeoBuilder({ bake: true })` writes `aShade` (Uint16 normalised RGBA: rgb = albedo multiplier / 4, a = AO). AO on
    reveals (darkest at soffits and toward the joinery), deep Durchfahrt passages, cornice undersides (per profile
    segment, `CORNICE_AO`), wall foot and plinth ledge, the band under the cornice, dormer feet, joinery and glass.
    Walls are split at `wallBreaks` so vertex interpolation reproduces the profiles.
  - `materials.baked(name, colour)` (optional in `MaterialLibrary`): albedo × rgb; AO fully on indirect light, 0.3 of
    it on direct light, plus specular occlusion. Model glbs carry the attribute as `_ASHADE`.
  - Explorer light layer: `COLOR_0 = colour × rgb × mix(1, AO, 0.6)` via `shadeColour()` (`EXPLORER_AO_STRENGTH`
    0.6); **format unchanged**. `docs/architecture.md` describes `aShade` and the bake.

  Checks: `verify.sh export` round trip OK: buildings.glb 4.57 → **5.61 MB** (budget 6 MB), 335 k → 388 k triangles,
  99 nodes. Tests: encode/decode, `wallAO`, `plinthAO`, grime, reveal order, a `buildExterior(KB-B03)` mesh with
  darkened `aShade` vertices. Shots `docs/shots/KB-I20/` (03 reveal crop, 09, 14): reveals and passages read deeper,
  with a soft band under the cornice and at the plinth ledge. **Acceptance met.** Open: `pnpm run export:explorer`
  into `../app` and the explorer notice (with KB-I03/I13/I15/I16/I17/I19), plus the `COLOR_0` row in
  `docs/explorer-integration.md` §2 (see Discovered, wave 3). The `COLOR_0` row was updated in wave 4; the `../app`
  re-export still waits for the user's go.
- **Fix (2026-11-02, wave 4, exterior; wave-3 residual):** the cellar-window reveals in the plinth read as bright
  orange squares in low sun (14). Reveal AO is now the depth AO times the AO of the wall zone it is cut into
  (`revealCornerAO` in `shade.ts`, applied in `facade.ts revealStrip`): `plinthAO` in the plinth band, `wallAO` above.
  Plinth reveals also take `REVEAL_GRIME.stone` = 0.7 on their albedo, which stands in for the sub-texel self-shadow
  the shadow map cannot resolve. Test (`exterior.hardware.test.ts`): on KB-B01/B02/B03 at LOD1 every shaded reveal
  vertex has AO ≤ the wall-zone AO at its height (+0.005), and some plinth reveal vertices are darker (before: reveal
  AO 0.94 against a wall-foot AO of 0.62). Shots `docs/shots/KB-I20/before|after-14-ehrenhof-hero-crop-wave4-plinth`:
  the cellar reveals read as dark recesses; the sunlit left jamb is still a little warmer than the face.

### KB-I21 · Fachwerk flag for timber-framed buildings `[x] (uncommitted)`
- **Why:** the 1793 fire record names timber-framed buildings; the gallery grew from a wooden passage (March 1788)
  (09 §2.3, G4, C1; 10 §b.1 KB-B06) [D existence; I selection].
- **Payoff:** ★★ / ★. **Effort:** M. **Perf:** 0.
- **Files:** `scripts/catalogue-v2/buildings.ts` (`facade.fachwerk`), `model/src/spec.ts`, `model/src/layout/grammar.ts`
  (0.30 m wall, 0.12–0.15 m reveals), `model/src/layout/` wall thickness, `model/src/exterior/facade.ts`.
- **Acceptance:** flagged: gallery KB-B06, Wachhäuser, roof lanterns, service upper storeys; fully rendered; reveal
  depth test; history-check H17 DONE; shot 13; plans GR sheets regenerated (thinner walls).
- **Done (wave 6, architecture, 2026-11-02):** `facade.fachwerk {storeys?, tag}` + `layout/fachwerk.ts`
  (`fachwerkStoreys`, `isFachwerk`, `outerWall`) and grammar `FACHWERK` (0.30 m wall, 0.13 m reveal). Flagged: gallery
  KB-B06 (D T5 "neuer hölzerner Gang"; Fachwerk I), Wachhäuser KB-B37/38/63/64 (whole house I), upper storeys of
  KB-B24 Jägerhaus, KB-B40 Waffenschmiede, KB-B41 Taubenhaus (I), the Orangerie Dachreiter (`turret.fachwerk`, record
  only); the Orangerie itself stays masonry (C1). Exterior: per-opening wall depth and frame plane from the opening's
  storey; interiors (gallery programme `outerWall: FACHWERK.wall`, `generatedRooms`) and plans (GR/SC wall poché,
  window depth) read the same helper. Same render outside. Plans regenerated (GR-17 shows the 0.30 m gallery wall).
  history-check H17 DONE. Note: the masonry frame plane was already only 0.14 m behind the face, so from outside the
  Fachwerk tell is small; the thin wall shows in the plans, the gallery reveals (28) and section.
- **Lead check (wave 6, `wave6-after`):** literal acceptance met. Flagged set as listed (test
  `wave6.architecture.test.ts` "flags the gallery, the four Wachhäuser and the service upper storeys"); reveal depth
  test (0.30 m wall, 0.12–0.15 m reveal); history-check 0 integrity failures, H17 DONE; shot 13 taken; GR/SC previews
  regenerated 11:24 (GR-17 shows the thin gallery wall). Pairs `docs/shots/KB-I21/` 13, 28 and the 28 reveal crop:
  the gallery window reveals are visibly shallower inside (28); outside (13) the change is not readable at 60 m, as
  the implementer warned. Bench 13: 1080p 2.6 → 3.8–3.9 ms, 28: 1.7 → 2.5 ms (the cross-session rise is the post
  chain; the architecture A/B puts 13 at −0.2 / 28 at +0.1–0.2 ms). Light layer: the flagged nodes grew 0.1–1 k
  triangles each (KB-B06 2.3 → 2.7 k, Wachhäuser 1.2 → 1.5 k against the deployed layer).

### KB-I22 · Roof furniture: Hemmer rods, downpipes, weather vanes `[x] (uncommitted; wave 8: masts on the high points)`
- **Why:** lightning rods "auf allen Gebäuden" (10 §c.1, D); Kurpfalz order Feb 1776, Hemmer's five-point rod on
  Schwetzingen 17 Jul 1776 (09 §2.8, G6, E4) [D; geometry N/U]; downpipes one per ≤ 18 m of eaves (G5, E3) [N];
  vanes on the CdL Dachreiter and pavilion roofs (E5) [HMS].
- **Payoff:** ★★ / ★★ (glints at low sun). **Effort:** M. **Perf:** +0.1 ms.
- **Files:** `model/src/layout/grammar.ts`, `model/src/exterior/roof.ts`, `model/src/exterior/facade.ts`.
- **Acceptance:** 3.0 m masts, 1 + 4 points, a corner down-conductor; downpipes Ø 0.11 m with hopper heads at LOD1+;
  extend `lightning_rods` to service buildings; shots 03, 13, 14.
- **Result (2026-11-02, wave 4, exterior):**
  - Pure `model/src/exterior/hardwarePlan.ts` (`rodMasts`, `conductorCorner`, `conductorPath`, `downpipePositions`)
    and the builder `model/src/exterior/hardware.ts` (`roofHardware()`, replaces the old LOD2 rod block in
    `facade.ts`). Grammar `LIGHTNING_ROD`, `DOWNPIPE`, `WEATHER_VANE` with tags.
  - Hemmer five-point rods: 3.0 m mast, 1 + 4 points (0.4 m arms, gilt tips), one mast per ≤ 18 m of ridge; one
    down-conductor from the ridge down the hip or verge, round the cornice and down a free garden-side corner to the
    ground (LOD2) [D rods on all buildings, Hemmer Fünfspitz; geometry N/U].
  - Downpipes Ø 0.11 m with hopper heads and shoes, one per ≤ 18 m of eaves, in the piers between window axes and out
    of junction corners, LOD1+; FARM, FARM_GROUP, GARD and WALL get none (drip eaves) [N G5].
  - Weather vanes (N/O/S/W letters, pennant to the NE, downwind) on the CdL Dachreiter and the pavilion apex roofs,
    LOD1+ [HMS E5].
  - Service buildings: `defaults.lightning_rods = true` already applies to every building, so they carry rods.

  Checks (lead): `exterior.hardware.test.ts` (mast spacing, downpipe spacing and pier placement, conductor path, LOD
  gating). Shots `docs/shots/KB-I22/` (03, 03 N-wing crop, 09 Dachreiter crop): downpipes on the court fronts, rods
  on the wing ridges, the vane on the Dachreiter; at 13 the rods read as fine detail. Node triangles: 8.9 k site-wide
  at LOD1, 21.5 k at LOD2. The light layer drops `metal.iron` (rods, downpipes) as before (20.8 k triangles
  dropped); the gilt vane parts go in. Perf (implementer, same session, 3 interleaved repeats, hardware and court
  furniture hidden vs shown): within noise at 01, 03, 14 (1080p 2.7–2.9 vs 2.7–3.1 ms medians), +16–30 calls.
  **Acceptance met.** Not done: the plan elevations do not draw downpipes or rods (optional; `hardwarePlan.ts` is
  pure and ready for `plans/src/sheets/elevation.ts`).
- **Review fix (wave 4, exterior):** the review found downpipes inside the CdL garden risalit (04), on the Orangerie
  piers (05) and against shutter leaves. New placement rule in `hardwarePlan.ts` (`downpipePositions` rewritten,
  `openingBlock`, `sideDownpipes`, `DownpipeOptions`): corners first (fallback to the arris at 0.15 m when the corner
  is blocked); short sides (≤ 18 m) get one pipe at the lone corner; longer runs (> `DOWNPIPE.maxSpacing` 25 m, open
  ends count double) take a pipe at a risalit flank or a passage flank first, then at a free pier in the middle 60 %
  of the run; never inside a risalit; an opening blocks its surround plus open shutter leaves (leaf = w/2 for louvred
  and plank shutters). The pipe stands off the corner lisene by `ARTICULATION.ecklisene.projection`. Tag on
  `DOWNPIPE` quotes the source's "a few downpipes at the corners and next to risalits" [N G5]. Result: on the
  louvred palace fronts the shutter leaves take every pier, so B01–B05 and B10 keep corner pipes only (see
  Discovered); the pipes in the CdL risalit and on the Orangerie piers are gone. Tests: `exterior.hardware.test.ts`
  (rule test with risalit and shutters; per-building check for B01–B05, B10: no pipe inside a risalit or on a leaf).
  Shots 03, 04, 05 in `wave4-fix-exterior` (scratchpad).
- **Wave 8 (architecture, audit rank 10, 2026-11-02):** lightning-rod masts only on the high points: pure
  `hemmerMasts()` (`exterior/hardwarePlan.ts`): one central mast on a short ridge, otherwise masts 1.2 m in from each
  ridge end with gaps ≤ 32 m; tapered dark iron (`#2E2B28`) with a gilt collar and a larger gilt five-point head, from
  LOD1 (4 sides; 6 at LOD2); the down-conductor stays LOD2-only. Grammar `HEMMER_ROD` [D→ Hemmer 1786; sizes N;
  spacing I]; `LIGHTNING_ROD` / `rodMasts` kept. Tests in `model/tests/wave8.architecture.test.ts`.
- **Lead check (wave 8):** 14 (`docs/shots/KB-I22/*-wave8-14-…`, crop `…-crop-wing-roof`): the row of masts along
  the wing ridges is gone; masts stand at the ridge ends. Bench 03 / 14 1080p 4.6 / 4.8 and 4.6 / 4.9 ms. Done. The
  plan elevations still draw no rods (Discovered, wave 4).
- **Wave-8 review fix (architecture, 2026-11-02):** the review still read the masts as TV aerials (a flat 0.45 m cross
  on a 3.4 m mast, as tall as the 4 m guard-house walls, one on a hut at 45, one rising from a chimney at 47) and the
  Orangerie kept 4–6 masts. Source check: the NDB (F. Klemm, NDB 8 (1969) 510 f.) describes Hemmer's rods as "einer
  senkrechten Stange und einem waagerechten Stangenkreuz (Fünfspitz)" and dates the *Anleitung* Offenbach 1782
  (²1788), not 1786 as research/09 says. So the head stays a **level** cross (the review's 50–60° crown would
  contradict the D source) but small: arms 0.2 m + 0.1 m points, `armRise` 0 [D NDB form; N sizes; Schwetzingen
  photos still unchecked, U]. Changes in `HEMMER_ROD` / `exterior/hardwarePlan.ts` / `hardware.ts`:
  - masts only at the two ridge ends (no intermediates; I until Hemmer or Schwan 2024 T25 gives a spacing), one
    central mast on ridges < 14 m, the vane on pavilion apexes and Dachreiter as before;
  - mast height `hemmerMastHeight` = 0.5 × roof rise above the eaves, clamped 1.2–3.4 m [I] (guard houses 1.45–1.85 m,
    palace 3.4 m);
  - masts move clear of chimney stations (`chimneyStations()`, now shared with `facade.ts chimneys()`), none on
    footprints < 50 m² (KB-B91 at 45) [I].
  Shots `wave8-fix-architecture` 35 (4 → 2 masts), 37, 45 (hut rod gone), 46 / 47 (short masts with a small star,
  no aerial; `docs/shots/KB-I22/wave8fix-46-before-after.jpg`), 53. Tests in `wave8.architecture.test.ts`. research/09
  §2.8 / G6 should take the NDB citation and the 1782 date (not my file; noted for the lead).
- **Wave 9 (architecture, 2026-11-02):** the level cross on 0.2 m arms still read as an aerial. The head is now a
  gilt knob (r 0.055 m) with a dominant vertical spike (0.38 m) and four short level points growing out of the knob
  (0.17 m from the axis, no arms): the NDB Fünfspitz "vertical rod + horizontal cross" kept [D NDB; N sizes]. Mast
  height `mastRoofShare` 0.4 of the roof rise, clamped 1.2–3.0 m (was 0.5, 3.4 m); roofs under `pointArea` 120 m²
  (guard houses KB-B37 / 38 / 63 / 64, huts) carry only a 0.5 m point at the ridge centre [I]; < 50 m² none, chimney
  clearance kept. Hemmer's own height and spacing rules were not found (de.wikipedia, web search): `HEMMER_ROD` tags
  them U. `hemmerMastHeight(roofRise, rule?, area?)` in `docs/architecture.md`; tests in
  `model/tests/wave8.architecture.test.ts` updated.
- **Lead check (wave 9):** `docs/shots/KB-I22/wave9-46-…`, `wave9-47-…`, `wave9-35-…` and the full frames 46 / 47 in
  `wave9-after`: the guard-house masts are short gilt finials, the palace and Orangerie masts shorter with a spike
  and a small star, no crossbar. Iron stays out of the light layer; against the wave-8 lead export the smaller gilt heads
  take 28–192 triangles off each exported building. Bench 46 / 47 1080p 4.1 / 4.1, 4.5 / 4.7 ms. Done.

### KB-I23 · Court furniture: Ehrenhof grille, cobbles, sentry boxes, basins `[~] Marstall basin, Küchenhof pump need located sources`
- **Why:** Ehrenhof grille with gilt tips on the gate only, cobbled carriage lanes and sandstone gutters in the gravel
  court, bollards at portals, sentry boxes with blue-white Wittelsbach stripes (09 §5, C6, G11, M9) [D Le Clerc, PV
  legend; HMS; D Schwetzingen gate]; a basin at the Marstall (Lambsborn aqueduct end) and a pump fountain in the
  Küchenhof (C7) [D PV legend]; "100 guardsmen at the entrances" (10 §b.3, D).
- **Payoff:** ★★ / ★★. **Effort:** M. **Perf:** +0.1 ms.
- **Files:** `model/src/site/features.ts`, `model/src/site/access.ts`, `scripts/catalogue-v2/terrain.ts`,
  `model/src/materials/index.ts` (iron `#2E3439`, gilt).
- **Acceptance:** sentry box 1.0 × 1.0 × 2.4 m + 0.5 m cap; 2 per portal; shots 03, 14 (and a Marstall pose if added).
- **Result (2026-11-02, wave 4, exterior):** pure `model/src/site/courtPlan.ts` plans, `model/src/site/court.ts`
  builds; `site/features.ts` adds it for the Ehrenhof TF-01 and registers the pieces as colliders. Grammar
  `COURT_FURNITURE` [HMS 06 §3.2; N; D→].
  - 10 sentry boxes (`COURT_FURNITURE.sentry` 1.0 × 1.0 × 2.4 m + 0.5 m domed cap), in pairs at the CdL court portal,
    the B02 and B03 court Durchfahrten, the B02 end_a portico and the B04 W gate; blue-white diagonal stripes round the
    corners, open front, white inner faces with baked AO, dark cap.
  - 12 Prellsteine beside the passages, in each building's own stone; 3 cobbled carriage lanes (gate to the CdL
    stair foot and two cross lanes between the Durchfahrten); 6 sandstone gutters.
  - Grille: gilt spear tips on the gate leaves only, iron on the fence (built with KB-I18).
  - **Skipped (no located source):** the Marstall basin (PV "S", position U, research/11 S12) and the Küchenhof pump
    fountain (PV "v", not located in TF-02). Both go to KB-I54.

  Checks (lead): `model/tests/site-court.test.ts` (paired boxes outside every building, Prellsteine, lanes inside the
  court, < 5 k triangles). Shots `docs/shots/KB-I23/` (03, 14, 01 court crop): the court reads inhabited without
  clutter; from the air the lanes form a paved cross. Court furniture ≈ 1.9 k triangles at LOD1. Light layer: a new
  node `site:TF-01` (696 triangles) holds only the stone parts (Prellsteine, gutters); the boxes and the cobbled lanes
  are not exported (see Discovered, wave 4). **Acceptance met** for the furniture; the item stays partial for the two
  water features. Residual: the cobbled lane reads coarse and very dark in shade near the camera (14 foreground).
  Not verified: walk-mode collisions against the boxes and Prellsteine.
- **Review fix (wave 4, exterior):** the lanes read as modern concrete pavers, near-black in shade and blue at dusk.
  They are now a procedural Katzenkopf shader (`model/src/materials/cobbles.ts`, `cobblePatch`, no texture fetches):
  rows of ≈ 0.14 m rounded stones in sand joints, 0.25 m dressed edging blocks, court sand drifted over the edges,
  two wheel tracks, a distance fade to the mean colour and a flat normal (no shimmer) [N research/09 §5; sizes
  `COURT_FURNITURE.lane` N; hues I]. `court.ts` builds one quad per lane (`laneGeometry`, attribute `aLane`);
  axis lane 3.2 m, cross lanes 2.2 m (`crossWidth`, used by `courtPlan.ts`); lift 0.01 m with polygon offset. The
  material sets `userData.groundLit`, and `viewer/src/main.ts` gives it the terrain's SH sky diffuse (one additive
  line), so it stays warm at dusk. Ground luminance vs `wave3-final` (court crops, `lum.py`): 03 −11.5 % → −2.7 %,
  09 −13.3 % → −3.4 %, 10 −15.5 % → −4.0 %, 14 −11.6 % → −2.9 %, aerials 01 −5.7 % → −1.6 %, 08 −4.6 % → −1.1 %;
  the lane is 10–14 % darker than the gravel by day and warm at 10. Bench (same session, 3 repeats, lanes shown vs
  hidden): 03 1080p 2.6 / 2.7 vs 2.6 / 2.7 ms min / median, retina 4.0 / 4.5 vs 4.1 / 4.5; 14 retina min 3.8 vs 3.9:
  within noise. Tests: `site-court.test.ts` (lane widths, lift, mesh and material). Shots 01, 03, 08, 09, 10, 14 in
  `wave4-fix-exterior` (scratchpad). Not fully verified: at 09 (19:12) the near lane is a little darker than the gravel; a luminance
  profile shows the sun shadows land on the lane at the same rows as on the gravel, so the darkening is the tilted
  stone normals facing away from the low sun, accepted as stone relief.

## Wave 4: building and room corrections (research/10)

### KB-I24 · Gallery 97 m, Ionic Tempelzimmer rotunda, colonnade, library pavilion `[~] re-export pending (+ KB-I60)`
- **Why:** Mannlich's "hundert Fuß" mistranslates "cent pas" ≈ 300 pieds ≈ 97 m (Schwan 2012 n. 47), matching LP06
  95–105 m (10 §0.1) [D→]. The garden end is a round Ionic "Tempelzimmer" with large glass doors and a pedimented
  portico, three steps to the garden; from 1789 faux marble and granite in paper; sequence Tempelzimmer → Kolonnade
  → Rotunde (10 §0.2, §b.1 KB-B07) [D]. A Bibliothekspavillon (with "lieux à l'Angloise") left the middle of the
  gallery through a glass door (10 §b.1) [D existence; I/U side, size]. Building accounts via Schneider confirm a
  1789 Rotunde with colonnade (11 G15, S5(5)) [D].
- **Payoff:** ★★★ / ★★. **Effort:** L. **Perf:** +0.1 ms.
- **Files:** `scripts/catalogue-v2/buildings.ts` (KB-B06 length, KB-B07 → round PAV with portico, new KB-B06a),
  `scripts/catalogue-v2/programme.ts`, `model/src/exterior/` (round pavilion with Ionic pilasters, portico),
  `model/src/interior/` (Tempelzimmer finishes), plans.
- **Acceptance:** hall + rotunda ≈ 95–97 m from the Sammlungsflügel; KB-B07 `name_de` "Tempelzimmer / Rotunde am
  Gartenende der Galerie (Granitsaal)"; 81 m and the LP06 square kept as documented alternatives in the catalogue;
  footprint overlaps 0; history-check H03, H04 DONE; shots 13 and 02; plans regenerated; light layer re-exported
  (node added).
- **Result (2026-11-02, wave 4):**
  - Spec/validation: `Facade.rotunda` (`RotundaSpec`: order, axis azimuth, bays door/niche/link, portico, colonnade),
    pure `model/src/layout/rotunda.ts` (`rotundaLayout`, `orderFor`, `stepsBetween`), norms in `ROTUNDA` appended to
    `grammar.ts` [N Vignola]. Geometry in `model/src/exterior/rotunda.ts` (plinth, drum with 8 bays: 5 glazed doors,
    2 niches, 1 link; Ionic pilasters, entablature, attic, low lead dome; tetrastyle portico with pediment and three
    steps; colonnade with steps up from the gallery floor; faux granite/marble tints at LOD2), registered with one
    line in `exterior/index.ts`.
  - Catalogue: KB-B07 round (r 10.5 m) on the gallery axis, floor 349.7, portico E to the Herzogsgarten; hall +
    colonnade + rotunda 96–97 m from the Sammlungsflügel face (test); KB-B06 notes "cent pas" and keeps 81 m as an
    alternative; KB-B07 keeps the LP06 square, HMS 12 m and 81 m readings as alternatives. New **KB-B06a**
    Bibliothekspavillon (hypothetical, low) on the gallery N side at a glass door (garden axis 14), off-centre so it
    clears the Holländische Gärtnerei KB-B27 wall (exact middle = alternative). DTM samples refreshed.
  - Plans: LP sheets draw the portico and colonnade outlines from the same layout. Tests: `model/tests/rotunda.test.ts`
    (8). history-check H03, H04 DONE. Export 5.69 MB (≤ 6), nodes KB-B06a and KB-B07 present.
  - Bench (same session, private Vite, 3 repeats, min / median 1080p GPU ms, with vs with KB-B07 + KB-B06a removed):
    02 2.6 / 2.7 vs 2.7 / 3.2; 13 2.5 / 2.8 vs 2.4 / 2.5; 18 2.1 / 2.3 vs 2.2 / 2.3; +28 draw calls, +0.01 M tris.
    Retina ≤ 4.1 ms median at all five poses. Shots in `docs/shots/KB-I24/`.
  - Open: pose 19 (inside the glazed rotunda) is washed out because the viewer applies the indoor EV to every
    footprint (`viewer/src/main.ts cameraInside`); the 1789 terrain still carries the old square pad under KB-B07
    until `prepare-terrain.py` is re-run; the light layer still has to be re-exported into `../app`.
  - **Lead check (wave 4):** `verify.sh catalogue` reproduces the file (100 buildings, 93 placed, 0 errors, 0
    warnings, 0 programme issues, 0 overlaps); history-check H03, H04 DONE; temp export nodes `KB-B06` 2.9 k,
    `KB-B06a` 1.0 k, `KB-B07` 2.9 k triangles. `wave4-after`: 18 2.1 / 3.1 ms, 19 1.2 / 2.4 ms (1080p / retina).
    Shots refreshed from `wave4-after` (1280 px): `docs/shots/KB-I24/` 02, 13, 13 rotunda crop, 18, 19. At 13 and 18
    a pale square pad and a hollow beside the colonnade show the old KB-B07 terrain (→ **KB-I61**); 19 is white-washed
    (→ **KB-I60**). Status `[~]`: the acceptance asks for the light layer re-exported with the new node, which waits for
    the user's go; KB-I60 and KB-I61 are the visible follow-ups.
  - **Review fix (wave 4, programme, sequence only):** KB-B07 has a new alternative, "R12 / T1 order". In it, the
    Tempelzimmer stands at the gallery end (round, glazed, pedimented portico, T5), the colonnade lies beyond it,
    and an open peristyle Rotunde closes the colonnade as a separate garden element (T1 p. 375) [D R12/T1 order; I
    form]. The colonnade tag now reads "D existence; position between gallery and Tempelzimmer I; R12 order
    differs". The KB-B06 and KB-B07 function texts say the same, and the question goes to KB-I54. The rotunda
    visuals from the review (LOD1 volutes, pediment against the dome, faceted metallic dome, pink-brown columns)
    belong to the exterior owner and are not changed here.
  - **Review fix (wave 4, exterior):**
    - Ionic order from LOD1 (`exterior/rotunda.ts`): portico and colonnade capitals get a round echinus, the channel,
      the bolster pair and four volute discs (`voluteDisc`: eye, rings, baked AO; 8 segments at LOD1, 12 at LOD2)
      under a thin abacus; drum pilasters get volute pairs. The portico entablature has three fasciae, a frieze, a
      bed moulding and a corona [N Vignola].
    - Pediment against the dome: `layout/rotunda.ts` (programme-owned, additive) gives `pediment.halfWidth` and a new
      `atticBlock` (front R + 0.45, back inside the drum, top ≥ apex + lead + `ROTUNDA.atticBlockClear` 0.2 m). The
      portico roof ends against the block (render faces, members coping, lead top), so no roof enters the dome [I].
    - Dome: `roundRoof` has smooth normals (radial; along the profile for domes), 12 × 48 from LOD1; the attic coping
      has a lip that closes the seam; lead roll seams (`ROTUNDA.domeRibs` 16) and a top boss at LOD2 only (they
      aliased at LOD1). `roof.lead` is now #6F757B, roughness 0.66, metalness 0.1, in `ROUGH_ROOFS` (env 0.45): this
      dulls every lead deck, not just the dome [I].
    - Columns: portico columns are painted `members` grey (research/10 §c.1 [N]; the faux granite is documented for
      the interior only [D T5]); podium and steps stay red sandstone.
    - Tests: `model/tests/rotunda.exterior.test.ts` (block clears the pediment, volute normals, LOD1 member triangles,
      smooth dull lead). Shots 02, 13, 18 in `wave4-fix-exterior` (scratchpad): 18 1080p 2.0–2.4 ms vs 2.1 in `wave4-after`.
- **Wave 9 (architecture, review fix pose 19, 2026-11-02):** the inner marble pilasters of KB-B07 (LOD2) get a
  two-step Attic base and an Ionic capital (necking, abacus, volute pair facing the room), the order of the outside
  [D T5 Ionic pilasters inside; forms N]. Test in `model/tests/wave9.architecture.test.ts`.
- **Lead check (wave 9):** 19 (`docs/shots/KB-I24/wave9-19-pilasters-before-after.jpg`): bases and volute capitals
  under the entablature instead of plain strips. The bench shows 2.32 → 2.42 M triangles at 19 (the architecture
  owner's count without the grass blades was unchanged); 1080p 3.7 → 3.5 / 3.6, retina 5.6 → 5.0 / 5.2 ms. Done.

### KB-I25 · Room programme moves (B02, B03, B04, B05) `[x] (uncommitted)`
- **Why:** the N wing (Duke) held the Silberkammer, a Tanzsaal and a small and large Bildersaal on the 1st OG; the
  Großer Speisesaal was on the upper floor of the kitchen wing KB-B05 with two stove niches; the library was four
  rooms ≈ 52 m on the KB-B04 ground floor, with the Naturalienkabinett and Waffensammlung on the 1st OG; the S wing EG
  held guest apartments, vestibule/stair and Durchfahrt, its OG the apartment of Pfalzgraf Max Joseph (10 §0.4–0.5,
  §b.1) [D T5, T1, R12; I layout].
- **Payoff:** ★★★ / ★. **Effort:** L. **Perf:** 0.
- **Files:** `scripts/catalogue-v2/programme.ts`, `scripts/catalogue-v2/checks.ts` (must stay green),
  `model/src/interior/programme.ts`, plans GR sheets.
- **Acceptance:** programme checks 0 issues; history-check H05–H08 DONE; interior-reveal test green; room-id tests
  updated if a pinned room moves (source-to-model §3.2); `verify.sh warn` no new warnings (fix the
  B04/B05 unserved doors here if the stairs move); "Gehe zu" room list shows the new names; GR sheets regenerated;
  shots 06 and one new room pose per moved hall (append to `shots.mjs`).
- **Result (2026-11-02, wave 4):** `scripts/catalogue-v2/programme.ts`:
  - KB-B02 EG: two guest apartments (Antichambre, Schlafzimmer, Kabinett, Garderobe, Dienerzimmer), Vestibül +
    Treppenhaus West, Durchfahrt; no Silberkammer / Speisesaal / Anrichte left. OG: Salon im Südflügel, apartment of
    Pfalzgraf Max Joseph (W half), Duchess's rooms towards the CdL [D R12 names, LP06; I positions].
  - KB-B03: EG Silberkammer (Porzellan- und Silberkammern) + Silberdiener at the Küchenhof access; OG Großer
    Bildersaal (axes 2–6), Kleiner Bildersaal (7–9), Tanzsaal (10–15, floor U), Salon Mannlich (court 14–15) [D T5].
  - KB-B04 EG: Hofbibliothek in four rooms (4 × 3 axes ≈ 36 m; the documented 160 Schuh ≈ 52 m does not fit the 57 m
    wing with stair, guard room and gate, noted in the tag), Wachtstube am Tor; OG Naturalienkabinett, Waffensammlung,
    physical cabinet, Kupferstichkabinett (?). The gunsmith stays KB-B40.
  - KB-B05 OG: Großer Speisesaal (axes 0–5) with two niche stoves, Vestibül des Küchenflügels, Küchenschreiberei,
    Wohnung des Mundkochs; EG stair renamed Küchenbautreppe [D T1 pp. 338, 341, R12 OG 24–28].
  - `model/src/interior/programme.ts`: Bildersaal → gallery hang, Tanzsaal → festsaal; a dining room whose function
    names stove niches gets two stoves (tag T1 p. 341, T26/O4) instead of a chimneypiece.
  - "Gehe zu": new entries Großer/Kleiner Bildersaal, Tanzsaal, Hofbibliothek (one entry for the four rooms),
    Naturalienkabinett, Waffensammlung, Großer Speisesaal and Vestibül (B05), Tempelzimmer (`model/src/site/index.ts`
    ROOM_POI).
  - Checks: programme checks 0, overlaps 0, history-check H05–H08 DONE, `warn.ts` output identical to before (the
    two pre-existing B04/B05 unserved-door warnings remain; no stair moved), `model/tests/programme-moves.test.ts`
    (4), all 45 test files green. GR sheets regenerated. Poses 18–24 appended to `shots.mjs`; shots in
    `docs/shots/KB-I25/`. Bench pose 20 (B05 Speisesaal) 1.7 / 1.9 ms 1080p, 3.1 / 3.2 ms retina.
  - **Lead check (wave 4):** `verify.sh warn` output equals the baseline (B04: 2, B05: 1 unserved doors; no stair
    moved, so they were not fixed here, see KB-I52); history-check H05–H08 DONE; GR previews regenerated. `wave4-after`
    (1080p / retina ms): 20 1.8 / 2.7, 21 2.6 / 5.0, 22 1.7 / 2.9, 23 1.5 / 2.5, 24 2.6 / 4.7; 06 Festsaal 2.1 / 4.3 →
    1.9 / 3.2. Shots refreshed from `wave4-after` (1280 px). The Speisesaal shows a long table under two chandeliers
    with a niche stove; the library reads as a book room; the Bildersaal hang is dense. Residual: the picture
    canvases are flat colour fields, and on the Bildersaal piers they take the wall green, so they read as empty
    frames (KB-I27). **Acceptance met.**
  - **Review fix (wave 4, programme):**
    - Building texts: `function` and the EG/OG storey names of KB-B02/B03/B04/B05 now follow the moved rooms. For
      example, B04 reads "EG: the Hofbibliothek … OG: Naturalienkabinett with the Waffensammlung" and B05 OG is
      "Obergeschoss (Großer Speisesaal)". The texts carry D T5 / T1 / R12 / LP06 tags, and `palaceStoreys(upper,
      lower, useTag)` tags the names. Both texts keep "Küchenhof" because `exterior/facade.ts` picks kitchen
      chimneys by the regex `küche|kitchen` on the function, so B03/B04 chimneys are unchanged.
    - New rule `functionIssues` in `checks.ts`, run inside `checkProgramme`: a room term in the function text
      (silver, dining, library, armoury, picture room, dance hall, guard, guest apartment, …) or in a storey name's
      parentheses needs a matching room. Clauses written "EG: …" or "… on the OG" need the room on that floor. Tests
      in `programme-moves.test.ts` show the rule flags the old B02/B04 texts and passes the four new ones.
    - Stoves (O4): two altar stoves (`altar_stove`) stand in two real round-headed niches, 1.3 × 0.4 m, crown 3.4 m.
      The niches sit symmetrically on the blind S end wall, the outer wall towards the N wing (0.7 m). Each niche has
      a semi-elliptic plan, a stucco hood and a gilt surround. Each stove is a dark enamel die of 0.9 × 0.6 × 1.4 m
      on a stone pedestal, with gilt mounts (panel frame, medallion, bead swag), a cornice, and a 0.75 m bronze
      draped figure with a staff and a sheaf. The tag is D T1 p. 341 / T26 O4; form, size and enamel colour are N.
      Pure `stoveNichePlan` / `STOVE_NICHE`, `RoomWall.niches` and `Item.niche` are listed in architecture §4.
    - B05 OG: the Speisesaal now spans 7 axes (k 0–6, centre axis k 3). The Vestibül (k 7–9) joins the hall to the
      Küchenbautreppe landing (k 10), so it touches both (test). The Küchenschreiberei (k 11) is now tagged
      N/I, and the Mundkoch keeps k 12–13. GR-15 is regenerated.
    - New pose **25** `25-speisesaal-ofennischen` shows the S end wall with both niches. Pose 20 is unchanged but
      now looks at the vestibule wall. Bench, same session, 3 repeats, min / median: 20 1.6 / 1.6 ms 1080p, 2.7 / 2.7
      retina; 25 1.7 / 1.9 ms 1080p, 3.1 / 3.2 retina. Shots are in the scratchpad `wave4-fix-programme/`.
    - Checks: `verify.sh catalogue` reproduces the catalogue (0 programme issues, 0 overlaps); H03–H08 DONE;
      `warn.ts` equals the baseline (B04 2, B05 1).
    - Open: GR-15 does not draw the niches, because the plans read the catalogue, not the interior model.

### KB-I60 · Exposure inside glazed garden rooms (Tempelzimmer) `[x] (uncommitted)`
- **Why:** wave-4 lead check. Pose 19 (inside the KB-B07 rotunda, 08:00) is washed out to near white: `cameraInside()`
  in `viewer/src/main.ts` applies the indoor EV (+1.4 by day, KB-I06) and the candle ambient inside every building
  footprint, but KB-B07 has `interior: 'none'` and five glass doors, so it is lit like the outside [measured, shot
  `docs/shots/KB-I24/after-19-tempelzimmer-inside.jpg`]. The same rule will hit any future pavilion or Orangerie
  hall without a room model.
- **Payoff:** – / ★★. **Effort:** S. **Perf:** 0.
- **Files:** `viewer/src/main.ts` (`cameraInside`, `updateExposure`), maybe `model/src/interior/` (a minimal room
  model for the Tempelzimmer: faux-granite walls [D 1789 "Granitsaal"], marble floor).
- **Acceptance:** buildings without an interior (or a glazing ratio above a threshold) do not switch to the indoor
  EV, or blend it by the open/glazed share; pose 19 reads like a bright garden room (no clipped walls), 06 / 07 / 20–24
  unchanged (byte-compare or mean |Δ| ≤ 1/255); a viewer test for the rule.
- **Wave 5:** pose 19 is unchanged (mean |Δ| 0.04/255 against `wave4-final`). The same `cameraInside` rule now also
  treats cameras inside a GARD enclosure as indoor: inside the KB-B27 kitchen garden the exposure rises and the
  vegetation is culled (garden report). Fix both together: no indoor EV for buildings without an interior model or for
  open enclosures.
- **Done (wave 7, look, 2026-11-02):** new pure `viewer/src/indoor.ts`: `countsAsIndoor` is false for GARD enclosures
  and for `interior: 'none'`, so the indoor EV, candle ambient, room environment and vegetation culling apply only in
  buildings with a drawn interior model. A room shell without one (KB-B07) keeps the outdoor EV plus `shellLiftEv` =
  `SHELL_LIFT_EV` 2 × the unglazed share of the bays (KB-B07: 5 glazed doors of 8 bays → +0.75 EV) [I].
  `cameraInside()` and `updateExposure` in `main.ts` use it. Tests `viewer/tests/indoor.test.ts` (15).
- **Lead check (`wave7-after`):** met. 19 is no longer washed out (mean |Δ| 137.5/255 against `wave6-final`): white
  pilasters, shaded walls, legible floor stones and bench (`docs/shots/KB-I60/`). 06, 07 and 20–24 differ by 0.02–0.17/255
  (≤ 1/255). 19 now draws the outdoor vegetation (0.91 → 2.18 M triangles, 503 → 620 calls): 1080p 2.9–3.0 ms,
  retina 4.2–5.1 ms. **Residuals → KB-I70:** the glazed doors read as dark proxy panes from inside (box glass, so the
  outside test always fires); the flat door leaves leave gaps to the curved openings, with the garden visible beside
  them; the "Granitsaal" walls read grey-mauve and the bench is a two-colour box.

### KB-I61 · 1789 terrain re-run for the rotunda, colonnade and Bibliothekspavillon `[x] (uncommitted)`
- **Why:** wave-4 lead check. `viewer/public/terrain/` was prepared before KB-I24, so the 1789 terrain still carries
  the levelled square pad of the old KB-B07 pavilion: a pale pad around the colonnade at 13 and a hollow beside the
  portico at 18; KB-B06a, the new portico and the colonnade have no pads [measured, shots `docs/shots/KB-I24/`].
  The wave-2 note on the TF-11 gravel strip across the HG-01 lawn (Discovered, wave 2) needs the same re-run.
- **Payoff:** ★ / ★★. **Effort:** S. **Perf:** 0.
- **Files:** `scripts/prepare-terrain.py` (only if the round footprint, portico or colonnade need a pad rule), then
  `cd ../pipeline && uv run python -I ../schloss-karlsberg/scripts/prepare-terrain.py`, `pnpm run plans` if the
  underlays change, `verify.sh export` (skirts are sampled from the 2025 DTM, so the light layer should not change).
- **Acceptance:** shots 13, 18 and 02 show lawn up to the rotunda plinth and portico steps, no pad or hollow;
  KB-B06a stands on a pad at its floor; `verify.sh export` round trip OK.
- **Result (2026-11-02, wave 4, exterior):** `scripts/prepare-terrain.py` gains `rotunda_pads(b)`: the portico band
  (to R + depth + 0.75 D + steps × 0.38 + 0.6 m, half width w/2 + 0.7 m) and the colonnade band join the KB-B07
  footprint mask, so the 3 m apron levels them at its base 349.1 [I]. KB-B06a (hypothetical, base 348.3) is in the
  solid list and gets its pad from its own footprint. Re-run through the pipeline uv env (17 s), `viewer/public/terrain/`
  regenerated. Shots 13 and 18 in `wave4-fix-exterior` (scratchpad) show lawn up to the steps and the plinth, no pale pad or hollow.
  `verify.sh export` round trip OK, 5.74 MB. Not done: `pnpm run plans` (the underlays are programme-owned and not
  regenerated here).
- **Wave-5 residual (garden):** `PAVILION_PAD_IDS` in `prepare-terrain.py` (KB-B07, KB-B06a, KB-B87, KB-B88) blends
  the 3 m pads to the lawn over 12 m, outside the 6 m of the other buildings. KB-B07 moves by ≤ 0.76 m. In the 18 pair
  (`docs/shots/KB-I61/`) the plinth sits on the lawn, and the GARD wall behind now shows piers and stepped bays
  instead of a blank slab (`site/gardenWall.ts`).

### KB-I26 · State-room finish system (Tapetenleisten, dado, parquet, supraportes) `[x] (uncommitted)`
- **Why:** silk panels framed by gilt Tapetenleisten above a 0.9 m dado; Jacob's panelling and gilt silk-frame mouldings
  (5 March 1782 suite); Lyon silks; parquet de Versailles (~0.97 m panels) in state rooms; supraportes over enfilade
  doors; candle-only light (09 §4, I1–I5, I7, G12) [D; N sizes]; "Antichambre Nr. 8" with 2 bergères + a Jacob set
  (I6, C5) [D Redding citing Langer 1995 no. 46].
- **Payoff:** ★★ / ★★★ (interiors). **Effort:** M. **Perf:** +0.2 ms.
- **Files:** `model/src/interior/fixtures.ts`, `furniture.ts`, `materials.ts`, `wall.ts`, `model/src/layout/grammar.ts`
  (parquet panel), `scripts/catalogue-v2/programme.ts` (finishes, Antichambre tag).
- **Acceptance:** shots 06, 07 plus Vestibül/Enfilade room poses; gilt reads gold under KB-I06 lighting (do after it).
- **Done (wave 5, interiors):** `STATE_ROOM` in `grammar.ts` (dado 0.9 m, Leiste 45 × 22 mm, damask border 0.12 m,
  damask repeat 0.54 × 0.72 m, parquet panel 0.974 m, supraporte ≥ 0.45 m, rosette, sconce; tags D rule / N sizes).
  Silk rooms lose the upper boiserie: each wall field is a damask silk panel (`damaskMaterial`, shader figure from
  `finish.ts` `DAMASK_GLSL`) inside a profiled gilt Tapetenleiste (`mesh.ts` `mouldFrame` + `beadProfile`), with a
  contrasting damask border band and gold lines (Mannlich, D). Gilt boiserie frames, door surrounds, picture and
  mirror frames and the Deckenspiegel are now mitred bead profiles whose faces catch the room environment at
  different angles, so gilt reads as metal (highlight/shadow) rather than a flat yellow; the gilt base colour was not
  changed. `PARQUET_PANEL` 1.05 → 0.974 m. State-room overdoors ≥ 0.45 m get a supraporte canvas. Flat gilt ceiling
  discs are gone: a stucco rosette (lathe + 12 leaves, gilt ring in state rooms) appears only under a chandelier.
  Candle fittings only: wall sconce pairs beside the trumeau in state and private rooms, six-arm candelabra in the
  gallery (no electric-looking fixtures). Pier glasses show a mercury-glass image of the room opposite
  (`mirrorGrid`, metalness 0.45, roughness 0.12). Antichambre Nr. 8 (`B01.2.og-antichambre`, renamed "Antichambre
  (Nr. 8)"): canapé + the 2 bergères of the Jacob suite (5 March 1782) [D Redding citing Langer 1995 no. 46;
  identification I; form N]. Festsaal upholstery is crimson silk instead of the tan `#c9b27c` (wave-2 note).
  Tests: `model/tests/interior.finish.test.ts` (16), `parquet.test.ts`. Shots: poses 06, 07, 20–25 and the new
  27 Gelber Salon, 28 Bildergalerie, 29 Rotes Vorzimmer (scratchpad `int-a2`, `int-a3`, `ab-bench/after-*`).
  Same-session A/B (KB-I26 + KB-I27 together; before = snapshot of the interior sources in the same tree, private
  vite servers, 3 interleaved repeats, GPU ms min / median, machine load ≈ 85):

  | pose | 1080p before | 1080p after | retina before | retina after | calls | tris M |
  |---|---|---|---|---|---|---|
  | 01 aerial W | 3.05 / 3.12 | 3.01 / 3.17 | 5.77 / 5.82 | 5.35 / 5.56 | 686 → 686 | 1.98 → 1.98 |
  | 06 Festsaal day | 1.89 / 1.99 | 2.09 / 2.13 | 3.28 / 4.12 | 3.60 / 3.69 | 1081 → 1104 | 1.27 → 1.34 |
  | 07 Festsaal night | 1.64 / 1.80 | 1.81 / 1.85 | 2.79 / 3.08 | 3.09 / 3.11 | 1081 → 1104 | 1.27 → 1.34 |
  | 20 Speisesaal | 1.76 / 1.97 | 1.91 / 1.95 | 2.66 / 3.02 | 3.41 / 3.49 | 797 → 811 | 1.05 → 1.23 |
  | 21 Hofbibliothek | 2.41 / 2.56 | 2.89 / 2.92 | 4.03 / 5.27 | 5.45 / 6.40 | 1258 → 1349 | 1.34 → 1.46 |
  | 22 Bildersaal | 1.72 / 1.75 | 1.90 / 2.04 | 2.96 / 3.04 | 3.56 / 3.63 | 928 → 1011 | 0.96 → 1.07 |
  | 23 Tanzsaal | 1.38 / 1.42 | 1.45 / 1.49 | 2.72 / 2.95 | 2.88 / 2.93 | 573 → 597 | 0.87 → 0.89 |
  | 24 Naturalien | 2.42 / 2.56 | 2.75 / 2.83 | 5.44 / 6.95 | 5.16 / 5.35 | 1218 → 1308 | 1.30 → 1.42 |
  | 25 Ofennischen | 1.89 / 1.89 | 1.87 / 1.89 | 3.04 / 3.30 | 3.27 / 3.39 | 1079 → 1157 | 1.22 → 1.30 |
  | 27 Gelber Salon (new) | 2.10 / 2.17 | 2.29 / 2.32 | 3.50 / 3.69 | 3.93 / 4.14 | 1407 → 1545 | 1.15 → 1.26 |
  | 28 Bildergalerie (new) | 1.32 / 1.41 | 1.72 / 1.76 | 2.20 / 2.24 | 2.76 / 3.50 | 635 → 681 | 0.90 → 1.11 |
  | 29 Rotes Vorzimmer (new) | 1.80 / 1.80 | 1.89 / 1.90 | 3.06 / 3.16 | 3.43 / 3.82 | 1028 → 1115 | 1.01 → 1.13 |

  Worst 1080p delta +0.48 ms (21, min to min), so both items together stay within +1 ms; the aerial is unchanged
  (interiors are culled there; retina 5.4–5.6 ms ≪ 12 ms). Not verified: live walk feel, real retina frame pacing.
- **Lead check (wave 5, `wave5-after`):** pairs in `docs/shots/KB-I26/` (06, 22, new 27). At 22 the flat gilt
  ceiling disc is gone and a rosette sits over a candle chandelier; the walls show the damask figure, and the gilt
  frames show highlight and shadow. At 06 (white-and-gold boiserie) only the frame profiles change (mean |Δ| 3.8/255).
  07 barely changes (2.5/255): the Festsaal chandelier still has flameless candles (KB-I43). Cross-session bench
  (1080p / retina ms): 06 1.8 / 3.0 → 2.1 / 3.8, 22 1.6 / 2.8 → 2.0 / 3.7, 27 2.1 / 3.4 (new). The same-session A/B
  above is the budget evidence. **Acceptance met:** shots 06, 07 and the enfilade rooms 27 and 29; gilt reads gold,
  though it leans yellow in strong sun. Residuals: placeholder canvases blur below ~2 m. In the Gelber Salon (27) the
  seats take the wall yellow (a matching suite [N]), so chairs and walls merge into one tone.
- **Fix (wave-5 review, interiors, 2026-11-02):** shots of all 34 poses in scratchpad `wave5-fix-interiors`
  (compare `wave5-after`, `wave4-final`); tests `model/tests/interior.wave5fix.test.ts`.
  - Mirrors (high): pier glasses and trumeaux were dark grey. `mirrorGrid(seed, w, h, room)` now paints the room's own
    colours (dado, gilt bands, wall, ceiling, opening) under a light mercury tint (`MERCURY_TINT`); `interior.mirror`
    is a non-metal clear-coated glass (`MeshPhysicalMaterial`, roughness 0.4, clearcoat 1) with the room environment.
    Each fixture gets the room wall colour (`FixtureCtx.wall`). Test: mirror luminance ≥ 0.6 × the wall's. Shots 21,
    24, 27, 29 show light, room-tinted glass.
  - Supraportes vs. hang (high): the gallery hang ran through the supraporte canvases (22). New pure
    `corniceHeight()` and `supraportePanels()` (`finish.ts`) are used by the shell and by the hang, which skips any
    canvas within 0.06 m of a supraporte. Test: no frame intersections in B03.2.og-grosser-bildersaal and
    B06.1.bildergalerie.
  - Damask: the figure was a faint dotted ellipse. `damaskMotif(u, v, aa, figure)` (+ GLSL twin) draws a filled lobed
    palmette with corner sprigs (`floral`) or a candelabrum stem with C-scrolls (`arabesque`, gallery, `damaskFigureOf`);
    satin ground glossier than the figure (`STATE_ROOM.damask.sheen` [0.86, 1.06]). Fields wider than
    `STATE_ROOM.panelMax` 2.3 m are split into panels (`splitField`), and the border is 0.15 m with a second gold
    line inside the Leiste (Mannlich's broad gold borders approximated) [D rule; N sizes].
  - Sconces no longer sit on bookcases or cabinets: `fitSconces()` (`programme.ts`) moves a clashing sconce onto the
    trumeau frame as a bras de lumière or drops it. Test over every palace room.
  - Gelber Salon (27): light silk grounds (yellow, grey) get a pearl silk cover `PEARL_COVER` `#E8E0CC` on the seats
    (contrasting colours, Mannlich T1 p. 365 [D]; hue N/I), so the suite no longer merges with the walls.
  - Fireplaces and stoves: cheminée à la française in one veined white marble material (`marbleMaterial`): soot
    cheeks, console jambs with scrolls, frieze with tablet and gilt oval, profiled shelf, arched fireback, fire-dogs
    and logs [N]. The Ofennischen stoves are Louis XVI column stoves (faience pedestal, lathed shaft, cornice, urn) and
    the altar-stove figure has a robe, mantle, head, torch and sheaf in gilt bronze [N; no likeness].
  - Same-session A/B (before = pre-fix interior sources + library rows in a copied tree; private vite servers on
    5285/5284, 3 interleaved repeats; GPU ms min / median):

    | pose | 1080p before | 1080p after | retina before | retina after | calls | tris M |
    |---|---|---|---|---|---|---|
    | 03 Ehrenhof eye | 2.91 / 3.03 | 2.90 / 2.97 | 4.28 / 4.46 | 4.15 / 4.20 | 1462 → 1476 | 2.40 → 2.47 |
    | 06 Festsaal day | 2.04 / 2.10 | 2.09 / 2.11 | 3.37 / 3.54 | 3.39 / 3.52 | 1106 → 1108 | 1.35 → 1.38 |
    | 07 Festsaal night | 1.76 / 1.78 | 1.76 / 1.81 | 2.89 / 2.93 | 3.00 / 3.08 | 1111 → 1113 | 1.35 → 1.38 |
    | 14 Ehrenhof hero | 2.89 / 2.89 | 2.89 / 2.95 | 4.30 / 4.44 | 4.06 / 4.16 | 1462 → 1476 | 2.40 → 2.47 |
    | 20 Speisesaal | 1.85 / 1.91 | 1.90 / 1.92 | 3.04 / 3.23 | 2.98 / 3.23 | 811 → 815 | 1.24 → 1.31 |
    | 21 Hofbibliothek | 2.77 / 2.78 | 2.82 / 2.89 | 5.85 / 6.20 | 5.61 / 6.49 | 1321 → 1332 | 1.46 → 1.50 |
    | 22 Bildersaal | 1.85 / 1.87 | 1.93 / 1.97 | 3.27 / 3.28 | 3.43 / 3.45 | 989 → 997 | 1.07 → 1.10 |
    | 24 Naturalien | 2.64 / 2.65 | 2.69 / 2.71 | 5.06 / 5.26 | 5.01 / 5.25 | 1290 → 1301 | 1.42 → 1.46 |
    | 25 Ofennischen | 1.84 / 1.91 | 1.87 / 1.98 | 3.03 / 3.45 | 3.09 / 3.13 | 1149 → 1157 | 1.31 → 1.35 |
    | 27 Gelber Salon | 2.07 / 2.22 | 2.28 / 2.44 | 3.68 / 3.77 | 3.91 / 3.92 | 1534 → 1546 | 1.27 → 1.34 |
    | 28 Bildergalerie | 1.47 / 1.53 | 1.56 / 1.68 | 2.66 / 2.93 | 2.76 / 3.41 | 649 → 660 | 1.12 → 1.20 |
    | 29 Rotes Vorzimmer | 1.88 / 1.95 | 2.00 / 2.02 | 3.17 / 3.46 | 3.62 / 3.82 | 1092 → 1109 | 1.12 → 1.18 |

    Worst 1080p delta +0.21 ms (27, min to min); the aerials are unchanged (interiors culled). Interior triangles per
    building ≤ 265k (B06), under the 300k test budget. Not verified: live walk feel, real retina frame pacing.
  - Residuals: seat frames stay all gilt (no white-and-gold frames); Mannlich's embroidered borders are approximated
    by a band and two gold lines; 07 night is darker than wave 4 because the chandeliers are unlit outside "Fest"
    (KB-I43, experience).
- **Wave 6 (architecture, interior residuals, 2026-11-02):** chimneypieces (`interior/hearth.ts chimneypiece`) with
  Louis-seize console jambs, an inlaid fluted frieze, gilt garland and paterae, a moulded shelf, an arched cast-iron
  fireback with a medallion and gilt-bronze chenets with urns and logs; white marble with Griotte inlays in state
  rooms, Bleu turquin grey in private rooms (grammar `HEARTH` [N]). The Antichambre stove is a faience column stove
  (`faienceStove`: tiled fire box on brass feet, blue-grey bands, fluted column, cornice, gadrooned urn) [N]. Tests in
  `model/tests/wave6.architecture.test.ts`.
  **Lead check:** pairs `docs/shots/KB-I26/*-wave6-*` 27 and 29: the Gelber Salon (a private-apartment room) has the
  grey Bleu turquin chimneypiece with gilt chenets; the Antichambre (29) has the white-and-blue column stove instead
  of the plain white pedestal stove. Cost: the architecture A/B gives 29 +0.18 ms median at 1080p but +2.6 ms median
  (+1.7 min) at retina; this session 29 is 2.0 → 2.8–3.0 / 3.4 → 4.6–5.2 ms (cross-session, post chain included).

### KB-I27 · Named room colours, collection rooms, gallery interior `[x] (uncommitted)`
- **Why:** documented room names carry colours (Gelber Salon, Blauer Salon, Grauer Salon, Grünes Schlafzimmer…;
  10 §c.2) [D names; N hues; U positions]; damask in three contrasting colours with broad gold borders (Mannlich) [D];
  gallery green damask with arabesques, 20 crystal chandeliers, 104 gilt curule chairs; library oak cases with a
  Greek-key frieze and crimson-taffeta wire doors; white glass cabinets; white panelling and three mirror doors in the
  Waffensammlung (10 §c.3) [D]. Add `wall.silk.yellow` `#C9A94E` (09 M8).
- **Payoff:** ★★★ / ★★. **Effort:** M. **Perf:** +0.3 ms (chandeliers).
- **Files:** `scripts/catalogue-v2/programme.ts`, `model/src/interior/materials.ts`, `fixtures.ts`, `furniture.ts`,
  `model/src/context.ts` (new material names, additive).
- **Acceptance:** after KB-I25; every named colour carries its tag in the room `tag`; history-check H09 DONE; shots of
  the gallery interior and one salon (append poses). The two yellow hexes in the research (10 §c.2 `#D9B95B` [N],
  09 M8 `#C9A94E` [I]) are both suggestions: pick one, tag it, note the other.
- **Done (wave 5, interiors):** `Finish.colour?` / `Finish.border?` (validated hex) and `wall.silk.yellow` `#C9A94E`
  [I 09 M8; `#D9B95B` N noted, too close to the gilt] and `wall.silk.grey` `#A7A9A4` [N]. Colours in
  `scripts/catalogue-v2/programme.ts`, each with "colour …" in the room tag: Gelber Salon (CdL EG, yellow); B03 OG
  duke's apartment after R12 [D names, hues N, positions I]: "Antichambre des Herzogs (Rotes Vorzimmer)" crimson
  `#9B2D2A`, "Salon des Herzogs (Grauer Salon)" grey, "Schlafzimmer des Herzogs (Grünes Schlafzimmer)" green,
  "Kabinett (Kirschrotes Kabinett)" `#8E2F3A`; B02 OG "Roter Salon der Herzogin" `#A33A35`. Each colour gets a
  contrasting border (catalogue `border`, else `borderColour`). History-check H09 DONE. Hofbibliothek: oak cases to
  the cornice with a Greek-key frieze and brass-wire doors on crimson taffeta `#9E1B32` (D T5; hues N), parsed from the
  room function text, no white shelving. Naturalienkabinett: white-painted glass cabinets plus a row of glass-topped
  display tables (D T5). Waffensammlung: three mirror doors and an inlaid green-cloth table (D T5). Gallery rooms: a
  dense 18th-c. hang from 1.12 m to the cornice on blind walls, over doors and on every window wall's piers; canvases
  are seeded tonal placeholders (`canvasGrid`: landscape, portrait, history, still life under yellowed varnish, no
  artwork) in moulded gilt frames on a dark backing. KB-B06 Bildergalerie: green damask `#4E6B4F` with the
  arabesque figure, 20 crystal chandeliers, gilt-bronze side tables with six-arm candelabra on the piers and
  104 gilt curule armchairs (low back under the 0.8 m sills), all counts read from the function text (T1 pp. 374 f.,
  T5). New poses 27–29 (`shots.mjs`). Bench: see KB-I26 (measured together). Not done: the seven R12 colour rooms
  without a placed room (Discovered, wave 5); GR plan sheets not regenerated after the renames.
- **Lead check (wave 5, `wave5-after`):** pairs in `docs/shots/KB-I27/` (21, 24; new 28, 29).
  - 21: oak cases with the Greek-key frieze replace the white shelving, the pier glass reads as a mirror, and a portrait
    hangs over the door. At this distance the taffeta wire doors read only as darker shelves.
  - 24: white glass cabinets and glass-topped tables replace the dark cabinets.
  - 28: green damask, a receding row of chandeliers, side tables with candelabra, and curule chairs along both walls.
  - 29: the crimson Rotes Vorzimmer.
  - Checks: history-check H09 DONE (0 integrity failures; H12 and H17 open). `verify.sh catalogue` reproduces the
    file (102 buildings, 95 placed, 58 terrain features, 116 rooms; 0 errors, warnings, programme issues and
    overlaps).
  - Bench (1080p / retina ms): 21 2.4 / 4.4 → 2.7 / 4.8–5.4, 24 2.6 / 4.6 → 2.5–2.6 / 4.7–5.7, 28 1.5 / 2.7,
    29 1.9 / 3.3.
  - **Acceptance met.** Open: the GR sheets are not regenerated after the renames, and `ROOM_POI` has no colour rooms.
- **Fix (wave-5 review, interiors, 2026-11-02):** see the KB-I26 fix note for shots, tests and the A/B.
  - Library wire doors: only the first Hofbibliothek room (`B04.1.eg-bibliothek`, at the N stair) has brass-wire doors on
    crimson taffeta (T5 [D]; which room U, first room I); rooms II–IV have open oak cases to the ceiling with the
    Greek-key frieze. Catalogue regenerated from `scripts/catalogue-v2/programme.ts`; `verify.sh catalogue`
    reproduces it (0 errors, warnings, issues, overlaps); history-check 0 integrity failures. Test: exactly one
    wire-door library room.
  - Gallery curule chairs (28): rebuilt as gilt carved X-frame armchairs: curved X legs with a rosette, block feet,
    turned stretchers, baluster arms, back posts with finials (≤ 0.8 m, under the sills), padded back and domed seat in
    the green arabesque damask with a gold fringe (~670 triangles per chair, instanced) [D 104 curule chairs T1;
    form N]. At distance the X still reads a little like a folding stool.
  - Gelber Salon suite: pearl silk cover, see KB-I26.

### KB-I28 · Orangerie: white joinery, Komödienhaus annex, workshops `[x] (uncommitted)`
- **Why:** "meterhohen, weiß gestrichenen Fenstern und Toren", a bright hall; no louvred shutters on the hall tier
  [I]; the 1783 Komödienhaus with boxes was attached to the S side wing (KB-B12), with a floor convertible for dancing;
  gunsmith's and clockmaker's workshops in a side wing (10 §b.2, §c.1) [D; I form].
- **Payoff:** ★★ / ★. **Effort:** M. **Perf:** 0.
- **Files:** `scripts/catalogue-v2/buildings.ts`, `model/src/exterior/facade.ts`, `model/src/interior/` (B10 has a
  detailed interior).
- **Acceptance:** joinery `#F2F0EA` [N hue] on KB-B10–12; shots 05 and an Orangerie court pose (append).
- **Done (wave 6, architecture, 2026-11-02):** `facade.joinery_colour` (frames, glazing bars, door leaves) #F2F0EA on
  KB-B10/B11/B12/B12a (grammar `ORANGERIE_JOINERY`); `facade.shutters_omit_storeys: [1]` on KB-B10 (hall tier
  unshuttered, upper tier keeps the blue-grey louvres). NEW **KB-B12a Komödienhaus** (hypothetical, low): 20 × 11 m
  hall against the W half of the S wing's S face, 5 windows S, door in the W end, blind N side, hip slate roof without
  dormers, white joinery [D T5 existence/attachment; I form]. KB-B11 N wing gets a detailed interior
  (`ORANGERIE_NORD`): plant hall + "Werkstatt des Hofuhrmachers" + "Werkstatt des Büchsenmachers" (Werkzeugschrank,
  Werkbank, Schemel) [D Schwan 2010 p. 317 via T5; wing I]. Poses 35 (court) and 37 (Komödienhaus) appended.
- **Lead check (wave 6, `wave6-after`):** literal acceptance met: joinery `#F2F0EA` on KB-B10/B11/B12 (+ B12a),
  tested on the frame material; shot 05 and the appended court pose 35. Pairs `docs/shots/KB-I28/`: at 05 the
  Saalgeschoss loses its shutters and the white frames read on the hall tier, the upper tier keeps its louvres; 35
  shows the white joinery round the court; 37 shows the Komödienhaus as a plain hipped annex (hypothetical, low; it
  is drawn like any building, so only the confidence colours mark it). New light-layer node `KB-B12a` (824
  triangles, `_CONF` low). KB-B11 and KB-B12a have no room POI or "Gehe zu" entry yet (viewer, Discovered).
  Bench 05: 1080p 2.8 → 3.8 ms, retina 7.2 → 6.6 ms; 35 (new) 2.6 / 4.6 ms, 37 (new) 4.1 / 4.7 ms.
- **Review fix (wave 6, architecture, 2026-11-02):** (1) one shutter rule for the whole Orangerie: **no louvred
  shutters anywhere** (KB-B10 `shutter_type: 'none'`, `shutters_omit_storeys` removed; B11/B12/B12a were already
  none) [I from T5 "weiß gestrichene Fenster und Tore", a bright plant hall]. (2) The red streaks under the KB-B10
  upper sills were the stone thresholds of `porte_fenetre` openings z-fighting with the wall: thresholds now stand
  1 cm proud (`exterior/facade.ts`, all buildings), and NEW `FacadeSideSpec.window_kind_storeys` makes KB-B10's
  upper tier (storey 2, court/end_a/end_b) sill windows with a grey Sohlbank. (3) The bench-like wedge at the B10 SW
  corner (pose 37) was the TF-06 retaining wall ending outside the building: its vertex moved inside B10, and the
  slope building keeps its natural ground apron in `prepare-terrain.py` (335.2 → 340.6 m ramp S of B10). Shots
  `wave6-fix-architecture/05`, `/35`, `/37`.
- **Decision:** the Orangerie has no louvred shutters on any tier or wing; the upper tier has sill windows, not
  French doors.

### KB-I29 · Menagerie: 19 slate-roofed houses, terrace rows, island pavilion `[x] (uncommitted)`
- **Why:** KL-B40 was a circular layout of 19 square, slate-roofed, separated houses around a moat (T20); KL-B43 had
  straight rows of single-storey heated houses with grilles, a water channel and an 11-foot (~3.6 m) net; KL-B41 island
  pavilion foundations were found in 2016 (10 §b.4) [D; I details]. Modern Cor-Ten consolidation must not enter the
  model (10 §c.1).
- **Payoff:** ★★ / ★★. **Effort:** M. **Perf:** +0.1 ms.
- **Files:** `scripts/catalogue-v2/buildings.ts`, `model/src/exterior/` (small pyramid-roof houses, grille fronts).
- **Acceptance:** history-check H12 DONE; shot 12 plus a menagerie pose (append); heritage: no find-spot detail beyond
  what T20 publishes.
- **Done (wave 6, architecture, 2026-11-02):** `facade.menagerie` (ring | rows) + pure `layout/menagerie.ts` +
  `exterior/menagerie.ts` (replaces the GARD wall). KL-B40 renamed "Amphitheater (Menagerie-Rund mit 19
  schiefergedeckten Tierhäusern und Loge, „Bärenzwinger“)": 19 square slate-pyramid houses + a loge on the N axis on
  r 24.8 m, facing the moat, radial grilles between the yards [D T20; I sizes/loge]. KL-B43: six straight rows of 13
  slots (78 slots, 66 houses: two slots per row stay open for the channel) on the LiDAR terraces, fronts and runs downhill (az 156), iron grille runs with ≈ 3.6 m
  net posts, a water channel down the axis that keeps its slots open [D T1 pp. 383, 413; I layout]. KL-B41: 2016
  foundations + spiral stair [D T20], superstructure U. SRC `t20` added. No Cor-Ten, no find-spot detail beyond T20.
  history-check H12 DONE. Pose 36 appended. Light layer 5.90 MB (was 5.93; the garden-wall bays were heavier).
- **Lead check (wave 6, `wave6-after`):** literal acceptance met: history-check H12 DONE; shot 12 taken (the
  menagerie is not in its frame, so 12 is unchanged there) and the appended pose 36; heritage: the catalogue names the
  2016 foundations and the spiral stair as T20 publishes them, no coordinates or find detail beyond that. Shots
  `docs/shots/KB-I29/after-36-menagerie.jpg` plus two crops: the ring reads as 19 small slate pyramids round the
  moat with radial grilles; the six terrace rows read as a dense grid of houses and runs. **Residuals (→ KB-I67):** the
  rows stand on a large bare brown apron with no trees round them (T1 p. 383 "in Buchenwald"), and the island
  building in the moat reads as a finished pavilion although its superstructure is U. Light layer: `KL-B40` 0.8 →
  0.5 k triangles, `KL-B43` 0.2 → 1.7 k, `KL-B41` 0.8 → 1.0 k (against the deployed layer); iron is dropped. Bench 36
  (new): 1080p 3.1–3.5 ms, retina 5.5–6.5 ms, 120 calls.
- **Review fix (wave 6, architecture, 2026-11-02):** the KL-B43 rows no longer read as barracks: slate roofs (T20),
  seeded jitter per house (`MENAGERIE.rowJitter`: shift ≤ 0.35 m, width −0.3 m, eaves ± 0.12 m), terrace retaining
  walls with coping along the six back lines (`layout.terraces`, rise 0.35–1.6 m from the terrain), trampled run
  ground, a coarse cord net (1.5 m cells) at LOD 2, square 26 mm iron bars at 0.2 m, a 2.2 m watercourse with kerbs,
  stoke doors above the terrace; 66 houses, 144 grilles, 66 runs, 6 terraces. Ring: yards closed, radial grilles to
  the water. Island and KL-B41a see KB-I67. New pure API `menagerieLayout(m, seed)`, `MenagerieTerrace`,
  `MenagerieGrille.radial`; catalogue constants in `scripts/catalogue-v2/menagerie.ts`. Tests in
  `model/tests/wave6.architecture.test.ts`. Light layer 5.88 MB. Bench (3 runs, min / median): 36 1080p 3.5 / 4.0
  ms, retina 5.6 / 6.4 ms, 126 calls; 38 (new) 1080p 5.8 / 5.9 ms, retina 6.8 / 7.0 ms, 980 calls, 3.65 M tris (beech
  wood in view).

### KB-I30 · Unplaced items and new staffage entries (zones only) `[x] (uncommitted; garden residuals done in wave 8 via KB-I71)`
- **Why:** UP-08 Chinoiserie belongs to the Karlslust S of the Schwanenweiher (V23 no. 31; HM_1950_108); UP-05 and UP-09
  lie in a zone SE of the Orangerie; UP-06 Ananashaus → the Treibhäuser KB-B54–56; new entries: Wintervogelhaus,
  Monopteros (W end of the Karlsbergweiher), Felsenpfad, Wassermaschine (NW slope), Seidenhasenhaus / Schießhaus /
  Sauschütte zone, Vogeltränke, Volierenpavillon / three pavilions / hay wagon / tent zone, Eremitage (far E),
  Sammelbecken; the "Langer Gang" (> 100 m timber passage, date U) as optional (10 §b.3, §b.6, §b.1) [D→; U positions].
- **Payoff:** ★★ / ★. **Effort:** M. **Perf:** 0 (unplaced) to +0.1 ms.
- **Files:** `scripts/catalogue-v2/buildings.ts`, `scripts/catalogue-v2/terrain.ts`.
- **Acceptance:** zone placements carry `placement: 'hypothetical'`, confidence low and a ±50–100 m note (V23 is
  schematic). Note that hypotheticals render by default (`showHypothetical: true`); users hide them with the
  "Hypothesen (niedrige Konfidenz)" select, so low confidence is what keeps them switchable. Catalogue validation 0
  errors; one aerial shot showing how the zone items read (translucent mode).
- **Wave 7 (architecture, 2026-11-02):** placed as hypotheses (`placement: 'hypothetical'`, low, ±50–100 m notes from
  V23): KB-B89 Monopteros (W end of the Karlsbergweiher), KB-B90 Bienenhaus (apiary with skeps, was UP-05) and KB-B91
  Wassermaschine (small service house). Merged: UP-08 into KL-B50 (KB-I39) and UP-06 into KB-B54/56 (KB-I36).
  Unplaced entries with their V23 zone notes: UP-19 Wintervogelhaus, UP-20 Seidenhasenhaus, UP-21 Schießhaus, UP-22
  Sauschütte, UP-23 Vogeltränke, UP-24 Terrasse mit „Drei Pavillons“, UP-25 „Langer Gang“. Eremitage not modelled
  (1792+, Decisions log). Tests `model/tests/wave7.architecture.test.ts` (10, with KB-I31/I39).
- **Lead check:** `verify.sh catalogue` (lead): 116 buildings (105 placed), 63 terrain features, validation 0 errors
  / 0 warnings, 0 programme issues, 0 overlaps, reproduced byte for byte; history-check 0 integrity failures, 0 of 20
  deltas open. Pose 45 (new, `docs/shots/KB-I30/after-45-monopteros.jpg`): the Monopteros reads as a small open ring of
  columns on bare meadow by the water. The report's "pose 13 shows KB-B91" could not be confirmed: no new building is
  identifiable in 13 (its changes are crowns and mapped windows). **Corrected (wave-7 review):** KB-B91 *is* visible,
  small, at 13 (top centre) and on the left horizon of 11; it now has a Hoflinde, a well and a cart track (KB-I71). **Not met:** the aerial in translucent mode showing
  how the zone items read, and the terrain items Felsenpfad and Sammelbecken (garden-owned) → KB-I71. Partial.
- **Wave-7 review fix (architecture, 2026-11-02):** `KB-B89` Monopteros: Tuscan bases (square plinth + torus) and
  capitals (necking at LOD2, quarter-round echinus, square abacus), shafts with a slight diminution, an entablature that
  reads (two-fascia architrave, recessed rendered frieze, bed moulding and projecting corona with soffits), a ceiling
  under the dome, a lead-grey dome of rise 0.5 × radius (32 segments at LOD2) and a gilt ball finial on a neck instead of
  the rod (`FOLLY.monopteros`, N). Shots 45, 39 and close-up 95 in scratchpad `wave7-fix-architecture/` (close-ups in `close/`). KB-B91 being visible at 11 / 13 (review
  note) is a lead-check correction, not a geometry change.

### KB-I31 · S-wing Altan `[x] (uncommitted)`
- **Why:** "Mauerrest des südlichen Schlossflügels mit Fundamenten des Altans" (T5 Abb. 11; 10 §b.1) [D existence;
  U position].
- **Payoff:** ★ / ★. **Effort:** S. **Perf:** 0.
- **Files:** `scripts/catalogue-v2/buildings.ts` (portal/portico option), `model/src/exterior/`.
- **Acceptance:** hypothetical, garden (S) front towards TF-08 [I]; shot 13 or a TF-08 pose.
- **Done (wave 7, architecture, 2026-11-02):** `KB-B02a` "Altan am Südflügel": an upper terrace on four rendered piers
  over the 3.4 m garden Durchfahrt of the S wing, deck at 351.4 m (= the KB-B02 Beletage floor), sandstone imposts and
  a stone balustrade; `placement: 'hypothetical'`, low [D T5 Abb. 11 "Fundamente des Altans" for existence; N form; I
  position on the garden (S) front towards TF-08]. New `facade.folly` kind `altan`; pure `altanPiers`
  (`model/src/layout/folly.ts`: gate clear, symmetric, span ≤ 4.4 m) with tests. New light-layer node `KB-B02a`
  (open folly, no base skirt). `model/tests/site-court.test.ts` now skips folly footprints (the Prellsteine of the
  Durchfahrt legitimately lie under the Altan).
- **Lead check:** met. 42 (new) shows the Altan on its piers over the gate; 30 (TF-08 at eye level) now has it in the
  right half (`docs/shots/KB-I31/`), reading as a portico with balcony while the gate stays visible. Bench 42: 1080p
  3.3 ms, retina 4.3 ms.
- **Wave-7 review fix (architecture, 2026-11-02):** the review found an Altan nobody could step onto (deck at the
  Beletage floor, the windows behind it kept their parapets and the balustrade crossed them), piers standing bare on the
  gravel and a thin CAD-like deck edge.
  - Access: two two-leaf portes-fenêtres on the two gate axes of the KB-B02 Beletage (`programme.ts` SUED portal,
    storey 2, `balconet: false`), opening from the Kabinett der Herzogin [I; N period practice]. New optional spec field
    `PortalSpec.balconet` (default true; `layout/facade.ts`, `docs/architecture.md`).
  - Size: the Altan now covers only the two gate axes (5.9 m wide instead of 4 axes), so no window is crossed; two end
    piers flank the gate (`altanPiers` returns only the end piers when the front is too narrow for jamb piers, with a
    float-tolerance fix that had put a pier in the gate mouth). Alternative "four axes, portes-fenêtres on all four"
    logged in the catalogue.
  - Form: red Buntsandstein base courses (#A65E4A) up to the wing's plinth top with a stepped cap, pilaster responds on
    the same base, impost in two courses, a 0.6 m entablature (two-fascia architrave, rendered frieze, bed moulding and
    projecting corona) and waisted balusters at LOD2 (`FOLLY.altan`, N). Hypothetical / low kept. The portes-fenêtres
    belong to KB-B02 and stay when the hypothesis switch hides the Altan (existence D, place I; catalogue note).
  - Shots: 42, 30, 05 and close-up 91 in scratchpad `wave7-fix-architecture/` (close-ups in `close/`). Tests: `wave7.architecture.test.ts` (Altan crosses no window,
    two portes-fenêtres at deck level without balconet, CdL balconets unchanged).

## Wave 5: garden detail (research/11)

### KB-I32 · Garden pavilions behind the palace `[x] (uncommitted; KB-B28 and its apse in wave 8; octagon U)`
- **Why:** Petri's plan shows four pavilions: a round double-domed pavilion SE of the CdL (1785–1792, then the
  Karlslust "Eremitage"), the square "Pavillon zu Carlsberg" with an E apse in a circular clearing ~250 m E of the
  Küchenflügel, a round pavilion above the Hirschwürzloch, an octagonal point de vue (11 §1.2, G8, S5 1–4)
  [D Schneider; positions I ±20–30 m].
- **Payoff:** ★★ / ★★. **Effort:** M. **Perf:** +0.1 ms.
- **Files:** `scripts/catalogue-v2/buildings.ts` (PAV, `placement: 'hypothetical'` or `map`, epoch), `model/src/exterior/`
  (dome, apse templates).
- **Acceptance:** after KB-I03 and KB-I12; shots 02, 04, 13.
- **Result (2026-11-02, wave 5):** template `garden_round` (plinth 0.45 m, one 4.2 m hall, lead dome rise 0.42).
  KB-B87 Rundpavillon (D 9 m, palace grid u 70 / v −56, epoch 1785–1791, later the Karlslust Eremitage) and KB-B88
  round pavilion above the Hirschwürzloch (D 8 m, u 463 / v −64, "Prinzenlusthaus?", UP-09), both `placement:
  'hypothetical'`, confidence low, positions I ±30 m; LC-32 lawn clearing round KB-B88. The square "Pavillon zu
  Carlsberg" with its apse is the existing KB-B28 (alias, already in a clearing); the octagonal point de vue is not
  placed (U position). Their 3 m pads now blend to the lawn over 12 m (prepare-terrain `PAVILION_PAD_IDS`, also KB-B07
  and KB-B06a). **Open:** the double-stepped dome of KB-B87 (exterior dome template; the model has one dome) and the
  apse of KB-B28. Shots: 02 (KB-B87 left of the basin), 01, 13.
- **Lead check (wave 5):** KB-B87 is visible at 02 (`docs/shots/KB-I32/`, full frame and the crop
  `-crop-kb-b87`) and at 01 (the TF-08 crop in `KB-I34/`). It reads as a small domed drum on a pad, with a single
  dome, although its `name_de` says "Rundpavillon mit gestufter Kuppel" (rename it or build the stepped dome). KB-B88 is not in frame at any standard pose. Light layer: new nodes `KB-B87` (2.9 k triangles) and `KB-B88`
  (2.7 k). Both are hypothetical with low confidence, so `_CONF` is low (see KB-I62). Literal acceptance: shots 02,
  04 and 13 were taken, but neither pavilion appears at 04 or 13. **Partial**, as reported: the double-stepped dome,
  the KB-B28 apse and the octagon are missing.
- **Review fix (2026-11-02, wave 5, garden):** the review found KB-B87 alone on the lawn, with a single dome and no walk.
  - Stepped dome: `GARDEN_DETAIL.steppedDome` (cornice, lower tier, ledge, riser, upper tier, lantern) and the pure
    `steppedDomeSection` in `layout/roof.ts`, used by `roofSection` when `roof.dome_tiers` is 2 (spec, validation,
    `docs/architecture.md`) [D Schneider form "double-stepped dome"; N profile; I proportions]. `name_de` unchanged.
  - Entrance: with `court_toward` set, `buildRoundFacades` turns the bay ring so bay 0 faces that point and gives it a
    round-headed door with steps over the plinth (KB-B87 faces the belt walk HG-02) [N; I].
  - Setting: a crescent of three clumps behind the drum (HG-26 D 16 m with retained conifers, HG-27 poplar, HG-28
    conifer) and the 2 m spur walk HG-06 from the belt walk to the door, all `placement: 'hypothetical'`, low
    confidence ("Wald" planting round pavilions on Petri's plan [D Schneider]; positions I). Their trees go to separate
    low-confidence buckets, so no existing tree moves.
  - Unrelated-tree reshuffle at 01/02/08: the furniture keep-off inside the HG-30 singles loop had changed the list
    order. The loop is back to its wave-4 form; conflicts (furniture 8 m, clumps, pavilion, spur) now nudge a tree
    instead of dropping it. 33 of 34 singles match wave 5 and the order matches wave 4; at 02 the foreground trees
    match `wave4-final` again (`docs/shots/KB-I32/fix-cmp-02-w4-w5-fix.jpg`: wave 4 | wave 5 | fix; mean |Δ| to wave 4
    2.53 vs 3.01 before). Pose 12's change comes from `viewer/src/forest.ts` (per-tile sequential randomness) and is
    not garden code (Discovered).
  - Shots: `after-fix-34-rundpavillon-eye.jpg` (new pose 34) and `after-fix-b87-air.jpg`.
- **Wave 8 (architecture, 2026-11-02):** `KB-B28` is drawn as Schneider's "Pavillon zu Carlsberg" on the LiDAR pit
  KB-50: a 10 × 10 m square, EG + OG "Salon", slate pavilion roof, three axes per side, a blind E side and a W door
  with two steps; `placement: 'hypothetical'`, low, the Eiskeller reading kept as the alternative in the catalogue.
  New `KB-B28a` apse: a `garden_round` drum (D 5.6 m, half-dome) centred on the E wall, so only its outer half
  shows; `checks.ts` whitelists this intended overlap (`ATTACHED`); `pipeline.ts` `V2_FACADE` keeps the v1 building's
  v2 sides and portals; DTM samples re-run (only KB-B28 / KB-B28a changed, a KB-L1 sample added). Pose 50 (aerial;
  the clearing is too tight at eye level). Tests in `wave8.architecture.test.ts`.
- **Lead check (wave 8):** 50 (`docs/shots/KB-I32/after-wave8-50-…`): a square two-storey pavilion with blue-grey
  shutters and a half-domed apse in its clearing. Light layer: new node `KB-B28a` (2.5 k triangles), `KB-B28` 0.8 →
  2.8 k. Bench 50 1080p 3.7 / 3.8, retina 5.1 / 5.5 ms. The octagonal point de vue stays unplaced (U position), so
  the item counts as done. Open (garden owner): `PAVILION_PAD_IDS` for KB-B28 / KB-B28a (the plinth shows ≈ 1.5 m on
  the downhill side at eye level).
- **Wave 9 (architecture, review fix pose 50, 2026-11-02):** on KB-B28's footprint the s axis points W, so `end_a`
  is the E side: the catalogue had the entrance and three window axes behind and under the apse and a blind W front.
  `scripts/catalogue-v2/buildings.ts`: `end_a` (E) blind, `end_b` (W) 3 axes and the entrance; the apse calotte
  flatter (`dome_rise_ratio` 0.5 → 0.36) so it reads as a half-dome on the blank wall [N / I, low]. The wave-8 test
  assumed the wrong side; rewritten to check the sides in E/N.
- **Lead check (wave 9):** 50 (`docs/shots/KB-I32/wave9-50-apse-before-after.jpg`, `docs/shots/KB-I76/*-50-…`): the
  half-dome sits on a blank E wall and cuts no window. The blank 10 × 8 m wall reads plain (blind-window articulation
  optional, Discovered). Other rotated `axisRect` buildings may share the side mix-up → KB-I79. Done.

### KB-I33 · Benches, sculpture, aviaries `[~] (uncommitted)`
- **Why:** 52 green-painted garden benches in the Orangerie cellar (Schügens damage list via Schneider; 11 §0, §1.3,
  S6) [D colour]; a yellowish sandstone Flora herm survives
  (O1; 10 §b.7) [D]; aviaries documented (11 S6) [D presence].
- **Payoff:** ★ / ★★. **Effort:** S. **Perf:** +0.1 ms (instanced).
- **Files:** `scripts/catalogue-v2/terrain.ts`, `model/src/site/features.ts`.
- **Acceptance:** benches `#3F5A3A`, 2.0 × 0.55 m; 4–6 sculptures on 1.2 m pedestals; shot 04.
- **Result (2026-11-02, wave 5):** kind `furniture` (spec `GardenItem`): HG-40, 19 green benches (`#3F5A3A` D,
  2.0 × 0.55 m, seat 0.45, back 0.9 [N]) at the walk edge in front of the clumps next to the belt walk, one at the E
  end of the axis vista facing the CdL and three on levelled gravel platforms on the serpentine facing the Brunnenhaus
  [D Schneider on Petri; positions I ±30 m]; HG-41 the Flora herm (yellowish sandstone `#CDB78A` D, pedestal 1.2 m N)
  in front of clump HG-10 facing the axis. Single trees keep 8 m off the furniture. Plans LP-00/LP-01 draw benches as
  green bars. **Not placed:** further sculpture (Bacchus group) and the aviaries (D presence, U position). Shot 16 (herm
  right of the CdL) and an eye-level view.
- **Lead check (wave 5):**
  - Shots: at 16 (`docs/shots/KB-I33/`) the herm stands right of the CdL in front of clump HG-10, small at this
    distance, and a bench shows at the lower edge of 13. The implementer's eye-level view (`after-eye-herm-bench.jpg`)
    shows a bench and the herm; the herm reads as a stack of boxes on its pedestal (KB-I63).
  - Literal acceptance: bench colour and size met; "4–6 sculptures" not met (one placed, the rest U); shot 04 shows
    no furniture (mean |Δ| 0.46/255, from tree changes).
  - Light layer: new node `site:HG-41` (herm, 132 triangles, stone); the benches are not exported.
  - **Partial.**

### KB-I34 · Parterre à l'angloise for TF-08 and TF-15, treillage, tubs `[x] (uncommitted; TF-08 pose → KB-I63)`
- **Why:** today's 0.45 m hedge boxes read as kerbs (review screenshots; 11 G3, G9, G10). d'Argenville's parterre à
  l'angloise (lawn panels, 1.0–2.0 m plates-bandes with 0.2 m box edges, sanded sentiers, yew cones every 3.9 m); 2.2 m
  green treillage with arched portals around TF-08 (Le Clerc via Schneider fn 27; HMS) (11 S7, S8) [N; D].
- **Payoff:** ★★ / ★★. **Effort:** M. **Perf:** +0.2 ms.
- **Files:** `model/src/layout/site.ts` (pure `parterreAnglaise` + test), `model/src/site/features.ts`,
  `model/src/site/trees.ts` (citrus clear stem), `scripts/catalogue-v2/terrain.ts`.
- **Acceptance:** tests per 11 §6.5; shots 05 and a TF-08 pose (append); tubs 0.8 m oak green with iron bands.
- **Result (2026-11-02, wave 5):** spec `parterre{type: 'angloise', panels, cross_walk, tubs}` and
  `fence{type: 'treillage', height, portal_height, portals}`; pure `parterreAnglaise` in `layout/garden.ts`
  (GARDEN_DETAIL.angloise: plate-bande 1.3 m raised 0.15 m, sentier 0.8 m, cut corners 1.2 m, cones every 3.9 m,
  cross walks 3 m) with tests. TF-08: 4 × 1 lawn panels with the centre walk on the S-wing Durchfahrt axis, a 2.2 m
  green treillage (posts 2 m, lattice, finials) with three 3.2 m arched portals on its free edges; TF-15: 2 × 2 panels
  and citrus tubs every 5 m on the walk edges (0.8 m green oak, iron corner bands and hoops, standards 1.2 m stem +
  1.6 m crown). Box edging 0.2 m, July border flowers (low clumps, a few tall hollyhocks / sunflowers), clipped yew
  cones ≈ 1.35 m and instanced standard roses (`rosa_standard`). Surfaces now ground class 12 parterre sand. The old
  0.45 m hedge boxes stay only for parterres without a `parterre` layout. Fixed with it: a third of all clipped-yew
  instances rendered black (lightness jitter in linear space, `treeMeshes`). Built into `site/garden-detail/*`.
  Shots: 01, 02, plus eye-level and 9 m views of TF-08 and TF-15. **Residual:** TF-08's S retaining wall shows a
  saw-tooth of raster terrain at its foot from the S (pre-existing 1 m DTM edge, not the parterre).
- **Lead check (wave 5):**
  - Shots (`docs/shots/KB-I34/`): at 01 (crop `-crop-tf08`) TF-08 reads as four lawn panels in sand beside the
    S wing, with the treillage as a fine green line. At 02 the parterre shows behind the CdL. The implementer's views
    show the parterre at eye level (`after-eye-tf08`: cones, box-edged plates-bandes, standard roses, an arched portal)
    and TF-15 with its tubs (`after-9m-tf15-orangerie`).
  - Literal acceptance: tests in `garden-wave5.test.ts` met; tubs (0.8 m green oak with iron bands) met; shot 05
    shows no parterre (mean |Δ| 0.76/255). The TF-08 pose is **not appended** to `shots.mjs` (its camera is in the
    scratchpad `garden5/shots-g5.mjs`), so it goes to KB-I63.
  - Residuals at eye level: border flowers read as coloured cubes, and the standard roses as lollipops (KB-I63).
  - Bench: 01 2.7 / 4.4 → 2.8–2.9 / 4.5–4.7 ms (1080p / retina), within the garden A/B (+0.10–0.24 ms).
- **Review fix (2026-11-02, wave 5, garden):** the review found TF-08 overcrowded, with a treillage that read as modern
  mesh fencing.
  - `parterreAnglaise`: cones only at the compartment corners and side middles (8 per compartment), standard roses only
    midway on the long sides (4) [N d'Argenville rhythm; I]; tests updated in `garden-wave5.test.ts`.
  - Border flowers: rounded clumps (`dome()`), 60 % with a flower cap, a few hollyhock spires (leafy base, stem,
    three rosettes) on the band centre line only; share 0.3 [N].
  - Treillage rebuilt (`buildTreillage`): slim posts without finials, a diagonal lath lattice (0.18 m mesh, 0.03 m
    laths), a frieze of close upright laths 0.3 m under a capped top rail, flat panel stiles; at the portals lattice
    pilasters, an arched head, spandrel lattice and a crown rail [N Le Clerc via Schneider; I sizes].
  - The 4 × 1 panel layout stays (Decisions log).
  - Shots: new pose 30 (`after-fix-30-tf08-parterre-eye.jpg`) and 31 (`after-fix-31-tf15-orangerie-9m.jpg`).
- **Wave 6 (vegetation, 2026-11-02):** the treillage is framed period joinery: lattice pilasters with caps, bottom,
  dado, frieze and top rails, stiles, a close square lattice under the dado, a square field lattice, a diagonal frieze
  and a projecting cornice (`GARDEN_DETAIL.treillage` pier / frame / dado / cornice [I]); colour `#4B6648` unchanged.
  `sparsePlantings(lay)` keeps 4 corner cones and one rose per long side per compartment, so the lawn dominates.
  **Lead check:** pair `docs/shots/KB-I34/*-wave6-30-crop-treillage.jpg`: framed bays instead of a mesh fence; fewer
  cones at 30. At 20–40 m the square field lattice still reads a little like a fence.
- **Wave-6 review fix (vegetation, 2026-11-02): citrus standards** (review: low-poly faceted heads at 35, 31, photo
  p3). `SPECIES.citrus` is a clipped standard: shape `'clipped'` (18 small detail-1 clumps in a tight round shell),
  leaf `#2E4A2B` with a glossy material (roughness 0.85 on the shell, cards 0.6 with the specular lobe kept,
  `FOL_GLOSS`), slim 1.2 m stem, head ≈ 1.5 m across, size jitter ±3 % so a row reads as one size, and 9 sparse
  fruits per tree (orange and a few green, 4 cm, instanced, no shadows) [N research/11 §3 "glossy dark green … green /
  orange fruit"; I count, size]. Leaf cards for the clipped heads (`CLIPPED` in `leafCards.ts`: citrus broadleaf
  0.17, yew cones needle 0.1). Tests in `model/tests/trees-kb-i66.test.ts` and `viewer/tests/leafCards.test.ts`.
  Shots 35, 31, p3 and o1 (scratchpad `wave6-fix-vegetation/final`): round dark glossy heads with fruit on slim
  stems, uniform rows. **Residual:** bright sheen patches on the head tops in full sun.

### KB-I35 · Vineyard (LP06 30) `[~] (uncommitted; 3D stakes done, over the +1 ms budget at pose 40)`
- **Why:** the Pleine vue draws red-brown vine rows, legend "x. La vigne"; LP06 30 (11 S10; 10 §b.6 V23 no. 6)
  [D; N/I dimensions].
- **Payoff:** ★★ / ★★. **Effort:** M. **Perf:** +0.1 ms (stakes at LOD0 only).
- **Files:** `scripts/catalogue-v2/terrain.ts`, `scripts/prepare-terrain.py` (class 9), `viewer/src/terrain.ts`
  (down-slope stripes), `model/src/site/features.ts`.
- **Acceptance:** rows 1.1 m apart down-slope; shots 01, 05.
- **Result (2026-11-02, wave 3, ground part):** one shared `VINE_GLSL` in the bake and in the near-field splat (camera
  < 170 m): rows 1.1 m apart down the slope, drawn plant by plant on a 1 m stake period (Pfahlerziehung [N]), clump
  variation, shaded soil, 1.6 m contour walks every 30 m. The far colour `vineAverage` is matched numerically to the
  near-field mean, so there is no pop at the hand-over. Vine hue `#5E7A34` → `#6A8A3C` (the old hue read as a cloud
  shadow from the air) [I]. Shots `docs/shots/KB-I35/` (11 and a row crop): green rows with walks over soil. The
  vineyard is not in frame at 01 or 05, so 11 is used. **Open:** LOD0 instanced stakes on 1 m spacing and a low
  leaf canopy (`viewer/src/forest.ts` / `model/src/site/trees.ts`), lined up with the shader rows; the vineyard's
  outer edge is soft over ~10 m at 11.
- **Wave-5 residual (garden):** the vineyard bake is muted in `VINE_GLSL` (soil 35 % toward grey, leaves 28 %
  desaturated, row contrast fading with distance; mean L 0.215 vs 0.212). In `docs/shots/KB-I35/*-wave5-11` the rows
  read as a muted green-brown strip instead of red-green stripes, with no seam. The status is unchanged: 3D stakes
  are still open.
- **Wave 7 (garden, 2026-11-02): 3D stakes and vines.** Pure `model/src/site/vines.ts` places one stake per vine on the
  rows and plant phase that `VINE_GLSL` paints, keeps the contour walks free and stays 0.6 m inside the parcel
  (`vinePlants`, `walkDistance`); `vineGeometry` is a square stake (bark) plus a column of 2–4 leaf clumps.
  `VINEYARD` block in `layout/grammar.ts` [D PV 1791; N Pfahlerziehung; I]. `viewer/src/vines.ts` draws two
  instanced tiers within `VINEYARD.near` 170 m (near < 45 m icosahedral clumps, far octahedral ×1.3) plus 28 leaf cards
  per plant within 20 m, selected in a 110° view cone and reselected after 4 m or 15°; 1789 only, not indoors, no
  shadows. Plants shrink away over 136–170 m (`FOL_FADE`) while the terrain turns the painted leaf wall under them
  into hoed soil. Crisp vineyard outline (`terrain.ts`, two exact-outline fetches in the blur band). Poses 40 and 41
  appended. Tests `viewer/tests/vines.test.ts` (9).
- **Lead check (`wave7-after`, `docs/shots/KB-I35/*-wave7-*`):** the vineyard is still not in 01 / 05, so 11, 40 and 41
  are the views. 11: the near half of the parcel shows staked plants in rows, the far half (beyond 170 m) stays the
  painted strip; the hand-over is a soft band but reads as a change of texture across the parcel. 40: leafy columns on
  grey stakes either side of a contour walk; 41: staked rows with a crisp parcel edge. Clumps nearer than 2 m show
  polygon outlines under the cards.
- **Perf (lead, same-session A/B, `skb.vines.setEnabled(false)` vs on, 3 alternating repeats, load 29–37, min /
  median ms):** 40 1080p 2.34 / 2.95 → 3.79 / 3.90 (**+0.95…1.45**), retina 4.88 / 4.91 → 6.83 / 6.83; 41 1080p
  3.62 / 3.80 → 3.02 / 4.48 (noise, median +0.7), retina 6.12 / 6.22 → 6.24 / 6.27; 11 1080p 3.75 / 3.80 → 4.00 / 4.22
  (+0.25…0.4). Triangles 40 1.24 → 1.72 M. **Over the +1 ms item budget inside the vineyard (40).** Lever, as the
  implementer suggests: fewer cards (`VINE_CARDS.count`) or a shorter far tier in `viewer/src/vines.ts`. Status stays
  partial until 40 is ≤ +1 ms.
- **Wave-7 review fix (garden, 2026-11-02).** *Hand-over (11, 41):* the painted strip beyond the 3D plants was a pale
  olive on pink-brown soil, the 3D tier dark green. `VINE_GLSL` gains `vineCanopy` (the leaf colour × the measured 3D
  shading, `#5B673E` rendered vs `#83855F` painted) and `vineCover` (leaf wall cover by view angle, across / along the
  rows); `terrain.ts` tints the far field toward it over the fade band, and the soil is browner (`× (0.92, 0.96,
  0.78)`). Measured at 41: 3D region L 0.133 vs painted 0.135; 11 now reads as one planting with a texture change.
  Plants shrink over `VINEYARD.fade` 60 m (110–170 m) instead of 34 m. Crisp edge: the exact-outline fetches now use
  explicit `textureGrad` (a dashed pale line ran inside the outline from implicit-derivative mips) and also run in the
  class-raster band; cache key `terrain-splat-7`. *Stakes (40):* 1.6 → 1.5 m, 0.04 → 0.035 m, colour `(0.21, 0.20,
  0.18)` with the side normals tilted up, so they read as weathered grey wood level with the leaf tops, not dark posts
  above them [I]. *Facets (40):* `vineGeometry` lays out the clumps once for every detail level, and a close tier
  (< `CLOSE_DETAIL` 7 m, cap 400) uses subdivided icosahedra (328 tris) plus `VINE_CARDS_CLOSE` (16 cards of 0.3 m);
  the near cards went 28 → 12 per plant (size 0.38) to pay for it. Tests: `viewer/tests/vines.test.ts`,
  `landcover-review3.test.ts` mirror updated. Shots: scratchpad `wave7-fix-garden/` 11, 40, 41 (and all poses).
  **Perf (same-session A/B, `skb.vines.setEnabled`, interleaved, 1080p, min / median ms, load average ~28 from
  parallel agents; medians unusable):** 40 off 2.82 / 4.22 → on 3.73 / 10.38 (5 repeats) and off 2.84 / 4.74 → on
  4.29 / 9.89 (10 repeats), so **+0.9…1.45 by the minima**; 41 3.39 → 4.21 (+0.8); 11 4.25 → 4.71 (+0.46). Retina at
  40 11.08 → 14.43 (6 repeats). Breakdown at 40 by hiding one part (minima): cards ~0.2, near + close ~0.6, far
  ~0.4; the cost scales with resolution (fill-bound: the leaf wall covers half the frame). Still not shown ≤ +1 ms;
  the next lever is a shorter near tier (`NEAR_DETAIL` 45 → ~30) or a 3-clump near plant, to be measured on a quiet
  machine. Status stays partial.
- **Wave 8 (garden, audit #4, 2026-11-02):** `landcoverBake.ts`: groups of 6–10 rows vary in vigour and soil share
  (7–11 m stripes); `terrain.ts`: the far vineyard lightens over 220–480 m (cover × (1 − 0.6 · farV), canopy toward
  vineLeaf × 0.8). Same-session A/B (garden, 3 + 3 runs): 41 retina min 16.2 → 16.8, 40 15.9 → 16.2, 1080p ≤ +0.4 ms.
- **Lead check (wave 8):** 41 and 01 (`docs/shots/KB-I35/*-wave8-41-…`, `*-wave8-01-…-crop-parcel`): the row groups
  are faint and the far parcel is a little lighter, but **from the air it still reads as a flat dark-olive
  quadrilateral with hard edges** at 01, 02, 08, 41, 48 and 52 (the "dark quadrilateral" the look owner reported at
  01 / 08 is this parcel: the view-west camera stands over x ≈ 996, the parcel lies below-right at x 950–1005). →
  KB-I73. Bench 41: 1080p 3.8 (single run) → 5.0 / 5.2, retina 14.8 → 7.1 / 7.4 ms (the retina drop is the KB-I65
  glass fix); 40 1080p 4.2 → 3.8 / 4.1. Status stays partial (budget at 40 and the far parcel).

### KB-I36 · Kitchen gardens and the Holländische Gärtnerei `[x] (uncommitted)`
- **Why:** LP06 11, 34, 45, 47 and K05 parcels; Mistbeet frames; espaliers; Petri's two S-facing greenhouses; the
  Treibhäuser grew figs, peaches, coffee, papaya, pineapple and melons (11 G12, S11; 10 §b.3) [D; N].
- **Payoff:** ★★ / ★★. **Effort:** M. **Perf:** +0.2 ms.
- **Files:** `scripts/catalogue-v2/terrain.ts`, `model/src/site/features.ts`, `model/src/exterior/` (glasshouse type).
- **Acceptance:** beds 1.2–1.5 m with 0.5 m paths; lean-to glasshouses with S-sloped glazing and solid N walls [N];
  an aerial pose over KB-B27 (append).
- **Note (wave 3):** KB-I56 toned the kitchen-garden splat down, but the quarters still read grid-like from the air
  (02, 13).
- **Result (2026-11-02, wave 5):** kind `beds` (spec `BedsLayout`), KG-01 in the KB-B27 walls (LiDAR KB-23): pure
  `kitchenBeds` (GARDEN_DETAIL.kitchen: beds 1.35 m, paths 0.5 m, 2 × 3 quarters with 1.8 m walks, rows alternating
  direction per quarter, seeded July crops, neighbours differ) along the walls' own axis (≈ 90.7° grid), clipped per
  4 m piece to the wall parallelogram and 2 m round the glasshouses; crop rows, beans on poles, a dug bed; two rows of
  hotbed frames (timber boxes, glass lights tilted S) in front of KB-B54..56; horizontal palmette espaliers on the
  S-facing N wall. The enclosure walls step with the ground (residual c). **Open:** the glasshouses are still the plain
  `glass` template (hip roof), not lean-to houses with S-sloped glazing and a solid N wall (exterior owner). Shots 13,
  01, 02 and a 12 m view over the W wall.
- **Lead check (wave 5):**
  - Shots (`docs/shots/KB-I36/`): at 13 (crop `-crop-kitchen`) the quarters with crop rows, walks, hotbed frames and
    the three glasshouses read as a kitchen garden from the air, and the walls step with the ground. In the 12 m view
    (`after-12m-kitchen-garden`) the bean-pole rows read as dark palisades and dominate the quarters (KB-I63).
  - Literal acceptance: beds 1.35 m with 0.5 m paths met; lean-to glasshouses not done; the aerial pose over KB-B27
    is not appended (13 covers it).
  - Light layer: the stepped GARD walls (lean variant) raise `KB-B27` to 2.0 k triangles and `KB-B23` to 1.0 k
    (0.1 k in the deployed layer).
  - **Partial.**
- **Review fix (2026-11-02, wave 5, garden):** the review found the quarters too dark and the glasshouses reading as
  cottages.
  - Glasshouses: new `model/src/exterior/glasshouse.ts` (`facade.glasshouse`, dispatched from `exterior/index.ts`,
    roof `none`): solid rendered N back wall, solid end walls, a sandstone dwarf wall, glazing sloped to the S with
    rafters and lap bars, a short tiled lean-to strip over the back, soil floor, staging with plants and a tan bed
    (Lohbeet) [D Petri via Schneider "facing due S"; D-> BSB 25r serres pour les ananas; N form;
    I `GARDEN_DETAIL.glasshouse`]. KB-B54 and KB-B56 are the forcing houses. KB-B55 is now the gardener's lodging with
    the passage between them (Decisions log).
  - Crops: lighter July hues and a lighter soil (`GARDEN_DETAIL.kitchen`), cabbages as single heads in two rows,
    lower and narrower rows, tall bean poles in only about a third of the bean beds, beans as a tapered leaf column [N; I].
  - Shots: new pose 32 (`after-fix-32-kitchen-garden-12m.jpg`, the aerial view over KB-B27 asked for) and 13
    (`after-fix-13.jpg`). The lean-to glasshouses read as glasshouses; the beans no longer form palisades.
  - Light layer 5.93 MB (temp export, round trip OK).
- **Wave 7 (architecture):** UP-06 Ananashaus merged into the existing lean-to glasshouses: `KB-B54` "(Ost; Ananas,
  Kaffee, Papaya)" and `KB-B56` "(West; Feigen, Pfirsiche, Melonen)" with T5 / T7 / T1 tags; UP-06 removed. No
  geometry change (test in `model/tests/wave7.architecture.test.ts`).
- **Wave-7 review fix (architecture, 2026-11-02):** the forcing houses KB-B54 / KB-B56 read as photovoltaic arrays
  (one blue-grey sheet in a white grid). `exterior/glasshouse.ts` + appended grammar `GLASSHOUSE` [N period practice; I
  sizes]: small lapped crown-glass panes (≈ 0.3 × 0.42 m, three per rafter bay) with a per-pane normal jitter (LOD2; per
  sash at LOD1), dark oiled timber rafters, sash bars, sash rails and faint lap lines, two Kanalheizung flue chimneys on
  the back wall, rolled straw night-mats along the top of the glazing. The panes face into the house, so `glass.crown`
  shows them from outside as clear green-grey glass with the soil, staging and plants behind (not the dark room proxy
  meant for palace windows; from inside the house the proxy shows, nobody walks in). The staging moved back where the
  slope leaves head room (plants poked through the low glazing). Shots 32, 13 and close-up 96 in scratchpad `wave7-fix-architecture/` (close-ups in `close/`).
  **Open (garden owner, `site/gardenDetail.ts`):** the hotbed frames in front still read as blue PV strips at 32 / 13;
  the same inward-facing pane trick would fix them.

### KB-I37 · Water: pond edges, jets, reflections `[~] (uncommitted; pose 39 done; SSR stripes → KB-I69, Schwanenweiher jet and Findlinge open)`
- **Why:** ponds are flat planes; Findlinge on the Schwanenweiher dams and tumulus, a fountain jet there, a shell
  niche (11 G13, S12) [D]; water reflects nothing (visual-audit §5.7, P15).
- **Payoff:** ★ / ★★. **Effort:** M. **Perf:** +0.5…2 ms when a reflector is active.
- **Files:** `model/src/site/features.ts`, `viewer/src/main.ts`.
- **Acceptance:** after KB-I06 (IBL first); shot 12 and a Karlsbergweiher pose; LP06 geometric Karlsbergweiher only
  as a hypothetical alternative.
- **Done (2026-11-02, wave 6):**
  - **Reflections:** screen-space reflection in the post chain's grade pass (`viewer/src/post.ts`, KB-I41) instead of
    a planar reflector: the `water` material marks its pixels with alpha 0 (`waterPatch`,
    `model/src/materials/index.ts`), the grade pass marches the reflected ray through the depth buffer (32 exponential
    steps from 0.35 m, ×1.24, ≥ 250 m reach, 5-step refine), fades it at the screen edge and blends it by Schlick's
    Fresnel (F0 0.02). Gentle ripples (`WATER_RIPPLE_GLSL`, three travelling cosines, shared by material and SSR)
    animate with `waterTime`. Karlsbergweiher (TF-20) eye-level check: trees and the far bank mirror, the sun glint
    stays. The basin HG-04 (16/17) reflects the garden front.
  - **Pond edges:** `wetBank` (`model/src/site/water.ts`): a 1.6 m multiply band on natural banks (not on coped basins),
    0.62 at the water → 0.84 → 1, fading out within 1 m of height (`wetShade`), on a ring densified to 1.5 m and with
    quads dropped where the band would lie on water (the TF-20 ring runs partly inside the water; a dark stripe
    floated there before). No reeds (no source). No Findlinge: research/11 places them on the Schwanenweiher dams and
    tumulus [D], but there is no dam geometry for them in the catalogue (only the Karlsbergweiher W dam TF-22, without
    boulder evidence).
  - **Jets:** `jetSpray` adds animated droplets (ballistic paths in the vertex shader, seeded per feature, lit by the
    viewer's `sprayColour` per hour) to every jet. `features.ts` now builds a jet in a plain pond when the catalogue
    sets `fountain_h` (centroid of the ring); the Schwanenweiher fountain [D presence, N 4 m] waits for that catalogue
    value on TF-32 (request to the catalogue owner).
  - **Cost** (same session, 1080p, min of 3): SSR on − off ≈ 0 … 0.2 ms at 16 / 26 (only water pixels march).
  - Tests: `model/tests/water.test.ts` (offset ring orientation and distance, densify, wet shade, bank height, faces up,
    dropped wet quads, spray bounds and determinism); `viewer/tests/post.test.ts` (Fresnel, march reach).
- **Lead check (wave 6, `wave6-after`):** **partial**, as reported. Met: after KB-I06; shot 12 taken (no water in
  frame); reflections, wet banks and jet spray built and tested. Not met: no Karlsbergweiher pose in `shots.mjs` (the
  look implementer checked it with a custom CDP camera, `docs/shots/KB-I37/after-kw-eye-custom.jpg`; the request to
  append it as pose 38 was not taken up). The LP06 geometric alternative is untouched. Pairs `docs/shots/KB-I37/` 16
  and the basin crop: the jet now has a droplet veil and the basin carries a faint reflection of the garden front. In
  the custom Karlsbergweiher view the mirrored trees show thin horizontal comb stripes (ripple sampling of the SSR,
  Discovered). **Remaining:** `fountain_h` on TF-32 (catalogue owner: "D presence research/11 S12, N 4 m"), a
  Karlsbergweiher pose (append 38 at local (965, −865) looking at (850, 276.5, −880), 17:30), and the Findlinge once
  dams are located (KB-I54). Water additions are viewer-only; the light layer keeps `stone.*` site parts only.
- **Wave 7 (garden):** pose `39-karlsbergweiher-ufer` appended (E bank at eye level, 17:30; the camera the wave-6 lead
  asked for). **Lead check:** `docs/shots/KB-I37/after-wave7-39-karlsbergweiher-ufer.jpg`: the pond mirrors the bank
  trees, the far bank and the Monopteros KB-B89, but with the horizontal comb stripes → promoted to **KB-I69**. The W
  bank on the left reads as a steep faceted cut (Discovered). Still open: SSR stripes (KB-I69), `fountain_h` on TF-32,
  the Findlinge (KB-I54).

### KB-I38 · Herzogskastanien grove `[x] (uncommitted)`
- **Why:** sweet chestnuts above the Hirschwürzloch (11 G17, S13) [D species and place; I layout].
- **Payoff:** ★ / ★. **Effort:** S. **Perf:** +0.05 ms.
- **Files:** `scripts/catalogue-v2/terrain.ts` (`clump` with `mix`), needs KB-I11.
- **Acceptance:** 20–40 *Castanea*, loose 8–10 m grid, 6–8 m high; shot 02.
- **Result (2026-11-02, wave 5):** HK-01, 25 *Castanea sativa* [D species and place] on a loose 9 m grid (±1.6 m
  jitter, rotated) in an ellipse round palace grid u 325 / v −148 (I ±30 m), 6–8 m high as nursery standards, in a
  meadow clearing LC-31; pure `groveGrid` with tests.
- **Lead check (wave 5):** the data and tests meet the acceptance (25 trees, 9 m grid, 6–8 m). At 02 the grove cannot
  be told apart from the surrounding clumps, so the shot evidence is weak; there is no pair in `docs/shots/`.

### KB-I39 · Karlslust follies of 1789 `[x] (uncommitted; wave 8: KL-B50 double roof)`
- **Why:** a Chinese pavilion, a Turkish pavilion and tent, a hay-wagon folly and an aviary are documented but not
  located; KL-12 has no Eremitage before 1792 (11 G16, S14; 10 §b.4) [D presence; U positions].
- **Payoff:** ★★ / ★★. **Effort:** M. **Perf:** +0.1 ms.
- **Files:** `scripts/catalogue-v2/buildings.ts`, `model/src/exterior/` (PAV variants).
- **Acceptance:** all `hypothetical`, low confidence; shot 12.
- **Done (wave 7, architecture, 2026-11-02):** all `placement: 'hypothetical'`, low, ±50–100 m: `KL-B50` Chinesischer
  Pavillon (concave roof with upturned eaves, red posts, green railing, light stone floor; S of the Schwanenweiher, V23
  no. 31, UP-08 merged), `KL-B51` Türkisches Zelt (striped drum, cone roof), `KL-B52` Heuwagen, `KL-B53`
  Volierenpavillon (octagonal core, two wire wings) [D presence research/11 G16, S14 and 10 §b.4; N form; U position].
  The Turkish pavilion is the existing Tschifflik KL-B46. Eremitage not modelled (1792+). 140–630 triangles each at
  LOD1; they hide with the hypothesis switch (test).
- **Lead check:** met, except that "shot 12" cannot show them (not in its frame), so poses 43 and 44 were appended
  (`docs/shots/KB-I39/`). 43: tent, aviary and hay wagon read as small staffage in the meadow by the menagerie ring; 44:
  the Chinese pavilion reads clearly. All stand on bare meadow without paths or planting (→ KB-I71). Bench 43:
  1080p 4.1–4.4 ms, retina 7.0–7.1 ms (aerial budget 12 ms).
- **Wave-7 review fix (architecture, 2026-11-02):**
  - `KL-B50` Chinese pavilion: the rod-and-prism finial (read as a cross) is a stacked gilt finial (knob, ball, two
    parasol tiers, spike; `FOLLY.chinese.finialProfile`), gilt bells hang from the eight eave tips, a red valance board
    with a scalloped (LOD2) edge hangs under the eave, the railing has a Chinese fret (verticals, diagonals and a mid
    rail per cell, LOD2), and the roof is a deeper matt painted green with red hip ribs instead of light copper [N].
  - `KL-B51` Turkish tent: blue and white instead of red and cream; light canvas drum with narrow blue seam bands, a
    striped, gently swelling roof (24 segments), a solid blue scalloped valance with a gilt edge band and a gilt crescent
    on a knob [N; comparison Haga Koppartälten 1787 only, no Karlsberg source].
  - `KL-B52` hay wagon: flaring ladder sides (Leiterwagen) and a lofted load that fills them, bulges 0.5 m over them and
    rounds off to a crown and both ends, smooth normals, slight irregularity, the meadow-grass texture tinted straw-gold
    for a fibrous surface (no straw set in the library) [N; I].
  - Paths and planted backdrops are terrain features (garden owner) → still KB-I71. All four stay hypothetical / low.
  - Shots: 43, 44 and close-ups 92–94 in scratchpad `wave7-fix-architecture/` (close-ups in `close/`).
- **Wave 8 (architecture, audit rank 11 and the folly facades, 2026-11-02):** `KL-B50` gets a double roof: a lower
  skirt roof over the posts, a lantern drum (green panels, red posts at LOD2, gilt band), the upper roof; both drawn
  per sector with the pure `upsweptRoofPoint` (`layout/folly.ts`) so the hips sweep up and out at the corners; red hip
  ribs, scalloped red valance, gilt bells at the swept tips, the stacked gilt finial. Grammar `CHINESE_ROOF` [N
  Chambers 1757; Wörlitz, Oranienbaum, Potsdam for comparison only]. `FOLLY_FACADE` per folly kind
  (`scripts/catalogue-v2/buildings.ts`): KL-B50…53, KB-B89, KB-B90, KB-B02a get their own material, dressing and tag
  text, `shutter_type: 'none'`, no lightning rods (colours unchanged).
- **Lead check (wave 8):** 44 (`docs/shots/KB-I39/*-wave8-44-…`): reads as a chinoiserie pagoda pavilion, no longer a
  bandstand. LOD1 < 2,000 triangles (wave-7 test). Bench 44 1080p 4.1 → 3.8 / 4.2, retina 7.0 → 6.5 / 7.1 ms. Open:
  the platform toward the Schwanenweiher (site walk KL-W4).

### KB-I40 · Park boundary: Wildzaun and gatehouses `[ ] blocked (no located line; barrière → KB-I68)`
- **Why:** a Wildzaun ≈ 100 km long with Torhäuser; fenced parforce parks along the road (10 §b.7) [D].
- **Payoff:** ★ / ★. **Effort:** S. **Perf:** 0.
- **Files:** `model/src/site/features.ts`, `scripts/catalogue-v2/terrain.ts` (KB-B63/64, KB-B84 gate props).
- **Acceptance:** fence only where a line is evidenced or at AOI-edge gates; low confidence.
- **Wave 7 (garden): skipped, nothing invented.** research/10 §b.7 gives a Wildzaun of ≈ 100 km with Torhäuser [D]
  but no located line. Located evidence: PV legend 1 "deux petites maisons … pour le corps de garde et la barrière" =
  KB-B63 / KB-B64 at the valley entrance (LP06 37, low) and Le Clerc 1790's post-and-rail fence in front of the
  court-mouth guard houses (research/11 §1.5). The guard houses and the Carlsluster Torhaus KB-B84 are already in the
  catalogue; the barrière needs a fence feature kind in `spec.ts` / `validate.ts` → **KB-I68**. The Wildzaun line
  stays blocked on KB-I54.

### KB-I58 · Roadside avenues on the chaussée to Homburg and the Homburg–Erbach road `[ ]`
- **Why:** the Pleine vue legend names "8. La chaussée pour aller à Hombourg" and "9. La chaussée à Erbach", and
  draws the Homburg chaussée as a poplar avenue (research/07 §1.1 "Avenues" row and the legend list) [D existence]; the
  road lines are not located [U]. Wave 3 (KB-I57) skipped them rather than invent geometry. The Apfelallee TF-14
  stays as it is.
- **Payoff:** ★ / ★. **Effort:** S once a source exists. **Perf:** +0.1 ms.
- **Files:** `scripts/catalogue-v2/terrain.ts` (avenue features), `viewer/src/hinterland.ts` or `model/src/site/trees.ts`.
- **Acceptance:** blocked until a georeferenced historic map gives the road line (KB-I54); then avenue trees with
  tags and low or medium confidence; shots 01, 13.

### KB-I63 · Garden detail at eye level: flowers, bean rows, herm, shrub limbs; garden shot poses `[x] (uncommitted)`
- **Why:** wave-5 lead check of the garden implementer's eye-level views (`docs/shots/KB-I33/after-eye-herm-bench.jpg`,
  `KB-I34/after-eye-tf08.jpg`, `KB-I36/after-12m-kitchen-garden.jpg`) [measured]:
  - The border flowers of the plates-bandes read as coloured cubes, and the standard roses as lollipops.
  - In the kitchen garden the bean-pole rows read as dark palisades that dominate the quarters.
  - The Flora herm reads as a stack of boxes on its pedestal.
  - Under the vase-profile shrubs the limbs show as black stilts, so the clumps seem to hover.
  - None of these views can be reproduced from `shots.mjs`: KB-I34 and KB-I36 asked for appended poses, and the
    cameras are only in the scratchpad (`garden5/shots-g5.mjs`, views g5a–g5f).
- **Payoff:** ★ / ★★. **Effort:** S-M. **Perf:** ~0 (same instanced meshes).
- **Files:** `model/src/site/gardenDetail.ts`, `model/src/site/trees.ts`,
  `.claude/skills/skb-improve/scripts/shots.mjs` (append poses 30+).
- **Acceptance:**
  - Append poses for TF-08 at eye level, TF-15 at 9 m, the kitchen garden at 12 m, and herm + bench, with the next
    free numbers.
  - At those poses: flower clumps with a rounded, broken silhouette; bean rows lower and lighter than the walls; a
    herm with a tapering shaft, a bust and a profiled pedestal [N]; shrub limbs hidden under the crown skirt or
    lightened.
  - Garden A/B within +0.2 ms at 1080p.
- **Result (2026-11-02, wave-5 review fix, garden):** poses 30–34 appended to `shots.mjs` (TF-08 eye level, TF-15 at
  9 m, kitchen garden at 12 m, herm + bench, Rundpavillon KB-B87). Border flowers are rounded clumps with caps and a
  few hollyhock spires; bean rows are thinned, lower and lighter (KB-I34, KB-I36). **Open:** the Flora herm still
  reads as a stack of boxes and the vase-shrub limbs as black stilts (`docs/shots/KB-I63/after-fix-33-herm-bench-eye.jpg`).
  Bench (3 runs, min / median, 1080p GPU): 01 2.89 / 3.21, 02 2.82 / 2.83, 13 2.55 / 2.58, 16 2.26 / 2.27,
  18 2.24 / 2.26 ms, against wave 5 2.88, 2.68, 2.65, 2.25, 2.24 ms (≤ +0.15 ms); retina ≤ 4.7 ms.
- **Wave 6 (vegetation, 2026-11-02):** the Flora herm HG-41 is a profiled pedestal, a square shaft tapering to the
  foot with feet and a band, and a lathed bust, neck and head with a wreath and hair knot (new lathe and frustum
  helpers with smooth normals; ≈ 530 triangles, was 132) [N form; D object research/11]. Flowering shrubs are 13
  ground-sitting clumps with no limbs; standard roses stand on thin stems (`TreeSpecies.trunkR` 0.016 m). Tests
  `model/tests/garden-wave6.test.ts` (9), `viewer/tests/crown.test.ts` updated.
- **Lead check (wave 6, `wave6-after`):** acceptance met. Pairs `docs/shots/KB-I63/*-wave6-*` 33 (+ herm crop) and
  30: the herm reads as a herm (bust on a tapering shaft on a moulded pedestal); the black stilts under the shrubs
  are gone, the clumps sit on the ground. The herm and shrub changes were not A/B-timed on their own; the leaf cards
  (KB-I44) dominate the vegetation cost. Light layer: `site:HG-41` 132 → 572 triangles. Status `[x]`.

## Wave 6: cinematic polish (visual-audit passes 2–3)

### KB-I41 · Post chain: AO, SMAA, bloom, tone mapping, looks `[x] (uncommitted)`
- **Why:** no post-processing at all (visual-audit §4, §5.1, §5.3, P5). Options: pmndrs `postprocessing` 6.39.6 +
  `n8ao` 2.0.1 (peer three ≥ 0.168 < 0.188) or r187's built-in `setEffects`. Neutral tone mapping keeps catalogue
  colours as authored ("Dokumentation"); AgX + LUT for "Kino".
- **Decision needed:** a new runtime dependency (audit §8 Q1) and the default look (Q2). Recommendation: pmndrs +
  n8ao pinned exactly, "Dokumentation" (Neutral) by default, "Kino" in the Rundflug and photo mode. Decide by this
  recommendation unless the user objects; log it.
- **Payoff:** – / ★★★. **Effort:** M. **Perf:** +2…3.5 ms (needs KB-I04, I05, I10 headroom first).
- **Files:** new `viewer/src/post.ts`, `viewer/src/main.ts` (`antialias: false`, half-float), `package.json` (lead only).
- **Acceptance:** all 15 shots; bench at 3024×1964 ≤ 12 ms aerial with "Mittel".
- **Done (2026-11-02, wave 6):** own chain on three r187 render targets, no new dependency (Decisions log).
  - `viewer/src/post.ts` `PostChain`: the scene renders into a half-float target (MSAA by drawing-buffer size,
    `sceneMsaa`: 4× to 2.6 Mpx, 2× to 4.2 Mpx, none above) with a 32-bit float depth texture; materials compile without
    tone mapping. Passes: half-res depth-only AO (12 / 8 spiral taps Hoch / Mittel, radius 0.9 m at the eye growing
    to 6 m, faded out 900–1600 m, texel-snapped taps against banding) + 2 bilateral blurs; bloom (Karis prefilter with
    soft knee and clamp, 5-level dual filter; threshold 2.4 by day → 0.95 at night, strength 0.05 → 0.10); one grade
    pass with water SSR (KB-I37), the lantern light (below), AO on the ambient share only (`aoLightWeight`), bloom,
    night vision (grade.ts), Neutral or AgX + the Kino CDL, a light Kino vignette (0.22) and the output encoding.
    SMAA (`three/addons` SMAAPass) is wired but off in every preset: +1.5 ms at 1080p for little gain over MSAA.
    Mobil: no AO, bloom or SSR. `skb.post` exposes settings, `bypass` (old direct path, bench only) and `debug`.
  - Pure parameters in `viewer/src/postMath.ts`, tested in `viewer/tests/post.test.ts`.
  - Photo mode renders through the chain (`PhotoHost.render`, `setStill`: no MSAA while accumulating) and exposes
    stills in the Kino look by default (`skb.takePhoto({ look })`), restoring the user's look afterwards.
  - **Lantern pools (wave-5 review, poses 10 / 26):** screen-space light of the portal lanterns in the grade pass
    (`lanternLights()` from night.ts): inverse-square from 1.2 cd per lantern (≈ 15 lm, a candle lantern [I]), 9 m
    reach, cut behind the wall the lantern hangs on, Lambert on the screen-space normal, grey albedo 0.45. At 22:00
    the reveals, steps and gravel by the portal get a clear warm pool; at 21:00 (sun −7.9°, still bright twilight)
    it is a soft warm glow only.
  - **Goldene Stunde (wave-5 review):** `kinoLowSun(el)` (light.ts, Kino only, full between 3° and 12°, gone by 24°):
    adaptation × 0.4 (warmer key), sky fill × 0.6 (deeper shade), visible-sky saturation × 1.45, haze × 0.55 on
    top of KINO_HAZE. Tour shot `goldene-stunde` (18:45) reads warmer with darker, longer-reading shadows; the
    Ehrenhof 17:30 shot is almost unchanged (w ≈ 0.2).
  - **Cost** (same session, M5 Pro under load avg ≈ 50, `gpuBench` 20 frames, min / median of 3; chain = Hoch − bypass):
    1080p 01 3.87 / 4.04 vs 2.80 / 2.96 (+1.07), 03 +1.04, 06 +1.14, 10 +1.17, 14 +1.20, 16 +1.26, 26 +1.37 ms
    (≤ +2.5 ✓). Per item at 1080p (full − item off): AO 0.03–0.48, bloom 0.0–0.38, SSR ≈ 0 ms (≤ +1 ✓).
    3024×1964: 01 6.44 / 7.07 ms, 14 5.00 / 5.28 ms (≤ 12 ✓; with 4× MSAA it was 11.0–11.9). Draw calls +13 (passes).
- **Lead check (wave 6, `wave6-after`):** literal acceptance met: all shots (now 37 poses) render through the chain;
  bench at 3024×1964 with Mittel (`wave6-mittel`): 01 7.0, 02 5.1, 08 4.9, 12 6.3, 13 5.0, 26 6.6, 36 5.5 ms, all
  ≤ 12 ms (Hoch: ≤ 7.3 ms). No new dependency (`package.json` unchanged). Pairs `docs/shots/KB-I41/` 01, 03 (+ contact
  crop), 06, 14: Dokumentation colours stay as they were (mean |Δ| 1–2.5/255 at the exterior poses); AO adds soft
  contact shade under the sentry boxes, at wall feet and under the Festsaal seats; 06 also shows mild dark halos above
  the chair backs, as reported. Cross-session 1080p +0.6…+1.5 ms per pose matches the implementer's chain cost of
  +1.0…+1.4 ms. Not verified: leaf-card and window edges at native retina, where the scene target has no MSAA
  (`sceneMsaa` 0 above 4.2 Mpx; at Hoch's DPR cap a 3024×1964 screen draws 2268×1473 with 2× MSAA); real frame pacing.
- **Wave-6 review fix (look, 2026-11-02):** Kino skies were beige and golden hour muddy. `atmosphere.ts`: Kino haze
  0.6 → 0.42 (`KINO_HAZE`), the visible sky and anti-solar haze keep the Dokumentation white balance, `KINO_SKY`
  (saturation 1.3, horizon 0.55, a cool earth-shadow blue away from the sun), leaves × 1.08 saturation; `grade.ts`:
  the warm slope spares clear blues (`KINO_BLUE_KEEP`), `KINO_LOOK` power 1.12, sat 1.28; `post.ts`: sky pixels
  are pulled after tone mapping toward `KINO_SKY_BLUE` by day (`kinoSkyStrength`, Kino only, fades out with the sun
  under the horizon). Tour (`viewer/src/tour.ts`, vegetation-owned, changed on the review's assignment): Anflug
  25 m higher with the look lowered, Garten on the garden axis to the basin's E rim (jet and stag heads frame the
  garden front), Orangerie at 17:45 obliquely from the SW. Result: Anflug, Garten, Galerie skies blue and haze
  clearer; Goldene Stunde better but the horizon still pale and the meadows somewhat olive. Shots
  `scratchpad/wave6-fix-look/tour/`. Dokumentation grading unchanged (exterior poses differ from `wave6-after` by
  the low-resolution sky and by other owners' wave-6 fixes).

### KB-I42 · Glass: crown-glass tint and jitter, far reflections, interior mapping `[x] (uncommitted; wave 7: interior mapping; wave-7 review fix)`
- **Why:** windows read as white frames round empty holes (visual-audit §4.3, §5.9, P8); crown glass was green-grey with
  per-pane waviness, 0.5–1.5° normal jitter catches low sun (09 M6) [N]; regional glassworks in the Warndt [D].
- **Payoff:** ★ / ★★★. **Effort:** M. **Perf:** +0.2 ms.
- **Files:** `model/src/materials/index.ts`, `model/src/exterior/facade.ts`.
- **Acceptance:** after KB-I06; shots 03, 09, 14.
- **Partial (2026-11-02, wave 3, via KB-I16):** `glass.crown` tinted `#22302C` (M6) with ±1.5° normal jitter per
  leaf and top light at LOD2 (per pane was too costly, ~+130 k triangles). Far reflections and interior mapping are
  open.
- **Fix (2026-11-02, wave-3 review):** in shade the glass glowed brighter than the wall (14, left wing: glass
  133/118/111 vs wall 75/78/95). Cause: at LOD2 the 62 % transparent glass showed whatever lay behind: the room-lit
  interior, or, when the interior is beyond `INTERIOR_DIST` / not built yet, the sky-lit cream inner faces of the
  outer walls (reproduced with `skb.state.interiors = false`); the result depended on build timing. New `glassPatch`
  (`GLASS_LOOK`, `model/src/materials/index.ts`) for `glass.crown`: seen from outside (camera on the outward-normal
  side) the pane covers 85 % of the view with a dark room proxy (`#4A4D47`) lit by the facade's own irradiance (sky ×
  baked AO, 30 % of the sun, both through the shadow map), and the reflections (env sky, sun glint, clearcoat; Fresnel
  from the physical BRDF) are no longer dimmed by the alpha. Seen from inside the glass is unchanged (06 identical);
  lit night windows keep their alpha (10 unchanged). Sun specular cannot appear in shadow (three.js shadows the
  direct specular). Measured at 14 (left wing, shade): glass 39/49/61 and 62/70/83 vs wall 75/78/95 (glass < wall,
  blue-grey); with interiors hidden 67/62/66 and 74/81/99 (was cream). Tests: patch order and uniforms, the proxy at
  < 15 % of the limewash albedo. Shots `docs/shots/KB-I42/` (14, 09 crops); 05 lost the random sky-through windows.
  Status: outside look done; far reflections (a sky probe per facade) and true interior mapping remain open.
- **Done (wave 7, look, 2026-11-02): interior mapping** (after van Dongen 2008) in `glassPatch`. `GLASS_LOOK.interior`
  holds the wall hues and curtains [N research/02 materials table, research/09 §1], parquet floor, stucco ceiling, gain
  0.3, daylight falloff, curtain gap, sill / lintel and French-window rules [I]. `interiorMapGlsl()` casts each pixel
  to the curtains, the back wall (dado, a framed picture in every second room), side walls, floor and ceiling; mapped
  panes are opaque, and at night the room glows through the lit-window path. `night.ts` writes `aWin` / `aRoom` on LOD2
  vertical panes only; rooms are seeded per window in `viewer/src/windowRooms.ts` (depth 4.5–7 m, half width ≥ 1.8 m,
  curtains on 75 %), with `roomHit`, a CPU twin of the ray cast, for tests (8). Without the attributes (LOD0/1, glb,
  light layer) the flat proxy stays. `docs/architecture.md` updated.
- **Lead check:** met (03, 09, 14 after KB-I06). Pairs `docs/shots/KB-I42/*-wave7-*` with 1:1 crops: the piano-nobile
  windows show curtains and a dim room instead of the far side of the court, and the glass stays darker than the wall.
  Mean |Δ| against `wave6-final`: 03 1.43, 09 1.54, 14 1.67/255. Cost (implementer A/B, mapping off by zeroing `aRoom`):
  within noise, ≤ +0.3 ms. Residuals (Discovered, wave 7): some curtains read violet rather than crimson (03); mapped
  rooms also sit behind mansard dormers and roof oculi (13); at 17:30 the yellow rooms at 13 read almost like lit
  windows by day. Far reflections stay environment + sun glint (no per-facade probe).
- **Review fix (wave 7, look, 2026-11-02):**
  - *Lost window views (22, 24, 28) and the violet sliver (24).* Cause: `glass.crown` is transparent and double-sided,
    so three.js draws a back-face pass with `FLIP_SIDED`, which negates `vNormal`; the outside test then fired for a
    room's own panes from inside and drew the opaque mapped room. `glassPatch` now undoes the flip (`skbGlassN`) for the
    outside test and the mapping frame. 22, 24 and 28 again show the opposite facade through the panes (crops
    `wave7-fix-look/cmp/`, `c22f.jpg`, `c24.jpg`). Test `viewer/tests/glass-inside.test.ts`.
  - *Random room colours and violet curtains.* `windowRooms.ts` now reads the catalogue room behind each window
    (`catalogueRooms`: the room programme, or the generated hall; level-local ring, `floor_h` / `ceiling_h`, the wall
    colour from the room's silk or `finish.walls`), so all windows of one hall share colour, depth and side walls
    (left / right from the polygon, capped 25 / 30 m) [I]. Dormers, oculi (roof glass), service rooms and windows with
    no room on that storey show a dark cavity (`#5C5852`); a building without rooms keeps a plain generic room.
    Curtains on 35 % of the rooms, muslin or cream, silk only in silk rooms [N research/09 §1]; pictures at a 2.6 m
    pitch in galleries and half of the state rooms; room albedo desaturated 50 %, gain 0.2 (≤ 25 % of the limewash).
    Packed as `aRoom` (depth, mode, open, rgb565 + 65536 · curtain) and `aRoom2` (left, right, sill, ceil), flat
    varyings. Checked: 35 (Orangerie hall) and 37 (Komödienhaus) uniform rows, 03 dormers dark, 42 muted; roof glass
    (13) gets the cavity by rule. Tests `viewer/tests/windowRooms.test.ts` (rewritten).
  - Cost (same session, load ≈ 28, 3 alternations, mapping off by zeroing the mode): 01 1080p min 5.45 vs 5.08,
    retina med ≈ 16 either way; 03 1080p min 4.35 vs 4.55 ms → within noise.

### KB-I43 · Night: lit windows, lanterns, candles, Fest chandeliers `[x] (uncommitted; review fix wave 5)`
- **Why:** the night Festsaal has non-glowing candles and a black chandelier (shot 07); flames ~1800–1930 K, ~13 lm;
  ordinary evenings lit by table candelabra, chandeliers only for celebrations (SPSG) (visual-audit §5.9, P11; 09 I7;
  Knigge [D]). Lit-window share 10–20 % is U (audit §8 Q4).
- **Payoff:** ★ / ★★★. **Effort:** M. **Perf:** +0.3 ms.
- **Files:** `model/src/exterior/facade.ts`, `model/src/interior/index.ts`, `model/src/interior/fixtures.ts`,
  `viewer/src/main.ts`.
- **Acceptance:** deterministic lit windows (pure helper + test); shots 07, 10, a night aerial (append); after KB-I06.
- **Result (2026-11-02, wave 5, experience):**
  - Lit windows: amber 1850 K candle light (`windowCandleColour`), less adapted than the room colour, capped at
    `WINDOW_PEAK_MAX` 1.35 below the tone-mapping shoulder and shaded per vertex (brighter low centre, darker head
    and reveals). About 15 % of the CdL windows and 10 % of the wing windows are lit, seeded deterministically [U];
    measured 20 of 131 CdL windows and 118 of 1180 wing windows.
  - Lanterns: four portal lanterns (hypothesis, N/U), a pair at the CdL court portal and one over each wing
    Durchfahrt to the Ehrenhof. They are merged iron, glass and wall-pool meshes plus additive halo sprites, with no
    point lights, and show at night only (`viewer/src/nightlights.ts`).
  - Candles: the mantel candelabra are wax sticks with emissive flames, 2 draws each (was 3).
  - New pose 26 `26-night-exterior`; hook `skb.night(showLanterns?)`; tests in `viewer/tests/night-kb-i43.test.ts` (5).
  - A/B (same session, 3 repeats, lanterns on/off): +7 calls; 1080p GPU unchanged (10 2.3 / 2.3 ms, 26 2.4 / 2.4 ms).
- **Lead check (wave 5, `wave5-after`):**
  - Shots: pairs `docs/shots/KB-I43/` 07 and 10, plus 26 (new). At 10 (21:00) the lit windows are amber and the
    lanterns glow at the CdL portal and the wing Durchfahrten. 26 (22:00, 30 m) still reads "day for night", with
    bright green grass and trees. 07 is almost unchanged: the chandelier's candles have no flames, and the mantel
    candelabra are out of frame.
  - Bench (1080p / retina ms): 10 2.2 / 3.3 → 2.3 / 3.5; 26 2.3–2.4 / 3.5–3.8.
  - Literal acceptance: the deterministic lit windows with a pure helper and test are met; shots 07 and 10 and a night
    aerial (pose 26, appended) are met.
  - **Partial**, because the title's chandelier candles and "Fest chandeliers" are not done. `CHANDELIER_NIGHT = 1`
    lights the chandeliers every night, which contradicts "chandeliers only for celebrations" (move that to KB-I48).
    The scotopic/Purkinje shift (Larson, Rushmeier & Piatko 1997) is designed, gated by a uniform in the
    atmosphere/tone-mapping chunk, but not built.
- **Fix (wave-5 review, interiors, chandelier only, 2026-11-02):** the chandelier is a crystal crown instead of a
  gilt cage: thin gilt armature (stem, collar, cup, corona ring), glass ball, drops on the corona, glass drip pans
  and pendants on each arm, festoon chains between the arms, basket chains and a finial drop (3 instanced parts,
  ~2.1k triangles; glass outweighs gilt, tested) [N form]. Lighting it for "Fest" remains with the experience owner.

  - Review fix (2026-11-02, wave 5, experience). The review found 26 still "day for night", 07 uniformly sepia-bright
    with flameless chandelier candles, and the chandeliers lit every night.
    - Scotopic shift: new `viewer/src/grade.ts`, patched into three's tone-mapping chunk once (one shared `uGrade`
      uniform, like `uFog`). Per pixel, the luminance in cd/m² (display value / pre-exposure) blends toward Larson,
      Rushmeier & Piatko's (1997) scotopic luminance with a blue-grey tint, by σ = s · K / (K + Y) (Krawczyk et al.
      2005), K = 0.04 cd/m² [I]. The strength s is the night factor (0 above −2°), so day frames are pixel-equal. The
      tint is cooler than Krawczyk's (0.86, 0.98, 1.22) [I], because theirs read violet at 26. Candle flames, lit
      windows and lantern panes are far above K and keep their amber.
    - Chandeliers: `CHANDELIER_NIGHT` is gone. `nightlights.ts roomLightShare` keeps the model's light at a chandelier
      off at night unless "Fest: Kronleuchter brennen" is set (UI checkbox, `skb.set('fest', true)`; D-> SPSG,
      look-and-period §5). The light is matched to its chandelier by plan position (`chandelierAt`). An ordinary
      evening is the mantel candelabra plus the sconces. The candle ambient drops 0.4 → 0.15 lx (light.ts), so 07 falls
      off away from the candles.
    - Flames: `night.ts addCandleFlames` turns every `interior.candle` mesh (chandelier, sconces, gallery candelabra,
      hall lanterns) into wax sticks with a flame cone on top of each stick (`flameSpots`, pure). For a chandelier
      this is an instanced flame mesh sharing the sticks' instance matrices. The flames show only at night (night
      ≥ 0.3), and a chandelier's only with Fest (`setCandles`). By day they cost nothing.
    - Checks: `viewer/tests/night-review5.test.ts` (9: Purkinje direction, white kept, blend, grass vs window,
      uniform block, light shares, flame spots, chandelier matching, photo credit). Shots in scratchpad
      `wave5-fix-experience/`:
      - 26: moonlit blue-grey lawn and crowns with amber windows and lanterns, against the saturated green of wave 5.
      - 07: chandelier out, darker room with falloff; `it2/07-fest.jpg` shows the Fest with chandelier flames.
      - 10: the sky is a little deeper, otherwise unchanged.
      - 03 / 14: pixel-equal to wave 5.
    - Perf, same-session A/B with night vision on/off, 3 repeats (min / median ms, loaded machine):
      - 26: 1080p 3.47 / 3.86 vs 3.91 / 4.20; retina 6.87 / 8.19 vs 5.61 / 7.06.
      - 07: 1080p 2.51 / 2.70 vs 2.42 / 2.45.
      - 01 (day): 1080p 4.18 / 4.27 vs 4.12 / 4.24.
      - All within noise at 1080p (≤ +0.3 ms). Final bench: 26 2.6 / 4.4 ms, 07 1.8 / 3.2 ms.
    - Residuals:
      - The interiors' night room environment (`model/src/interior/materials.ts`, interiors-owned) still has warm
        texels for chandelier candles overhead.
      - The Festbeleuchtung lamps and the 1785 scene stay KB-I48.
      - Flames are small cones without a halo or bloom.
      - The sconces and gallery candelabra have no point lights; they glow but cast no light.
- **Wave 6 (2026-11-02):**
  - Lantern pools (look): the four portal lanterns light reveals, steps and gravel in the grade pass (1.2 cd ≈ 15 lm
    each [I], inverse square, 9 m reach, cut behind the wall; `night.ts lanternLights()`, KB-I41).
  - Chandeliers (architecture): glass-dressed (`interior/chandelier.ts chandelierPlan`: crown spears, bead cage,
    double festoons, pendeloques, basket, finial), ≤ 2,500 triangles each; the gallery stays within its 300 k interior
    budget.
  - **Lead check:** pair `docs/shots/KB-I43/*-wave6-26-*`: a small warm pool at the CdL portal and the wing
    Durchfahrten at 22:00; 10 (21:00) shows only a soft glow, as reported. 06 and 29 show the glass chandeliers by day;
    at 07 (no "Fest") they are dark, as decided.
- **Wave-6 review fix (look, 2026-11-02; chandelier geometry is architecture-owned, changed on the review's
  assignment):**
  - Floating shards → strung glass: `interior/chandelier.ts` chains are now links end to end between fixing points
    (`chainPoint()`, `GlassPiece.dir`; cage 8 × 7, basket 8 × 5, festoons 6 upper + 8 outer, upper tier 4), drops hang
    under the arm nozzles and from the outer festoons' low points (42 → 22 pendeloques); `furniture.ts` orients each
    link along its chain as a stretched tetrahedron (4 triangles) so the chandelier stays ≤ 2,500 triangles. Test
    `model/tests/chandelier-links.test.ts` (no loose link end, every drop hangs within 2 cm of a fixing).
  - Candle light: the chandelier's point light sits 0.15 m under the finial (`night.ts CHANDELIER_LIGHT_DROP`), the
    room's non-emissive materials widen their specular lobe at night as for a sphere light (`atmosphere.ts
    CANDLE_NIGHT.widen` 0.12, Karis 2013), the crystal keeps 45 % of its day albedo at night (glints stay), bloom is
    +0.1 stronger indoors at night (`postMath.bloomStrength`). Fest photo (p2): the festoons read as chains, the drops
    near the flames glow, the table hotspot is gone; the floor highlight left of the table (a candelabrum's
    reflection) remains, as in wave 5. Shots `scratchpad/wave6-fix-look/final/07`, `ch6/p2-*`.
- **Wave 9 (look, 2026-11-02): night sky seam.** At pose 52 a horizontal seam ≈ 12 % below the frame top came from
  three's Sky `acos(max(0, direction.y))`, which kinks the optical depth with the sun below the horizon. `light.ts`
  `HORIZON_SOFT` 0.06 / `horizonSoftness(el)` (0 at 0°, full from −4°) + pure twin `softHorizonY`; `atmosphere.ts`
  uses `acos(min(1, 0.5 (y + sqrt(y² + k²))))` with `uHorizonSoft`, shared with the env sky. k = 0 by day gives exactly
  max(0, y) (test `viewer/tests/skyHorizon.test.ts`).
- **Lead check (wave 9):** 52 (`docs/shots/KB-I43/*-wave9-52-…`): the seam is gone, no NaN blocks. Day poses: the
  sky is unchanged (12 / 30 / 35 / 42 differ only in the ground). Done.

### KB-I44 · Tree look near the camera `[x] (uncommitted)`
- **Why:** toy-like trees with black trunks (shots 01, 11): leaf-card crowns near the camera (EZ-Tree 1.1.0 variants,
  seeded), inner-crown AO, wrap and back-light, wind sway, lighter beech bark, forest-edge band (visual-audit §5.6,
  P10; research/02 §3.2). Atlases must be CC0.
- **Payoff:** – / ★★. **Effort:** M-L. **Perf:** +0.5…1.5 ms.
- **Files:** `model/src/site/trees.ts`, `viewer/src/forest.ts`, `model/src/site/features.ts`.
- **Acceptance:** after KB-I10 and KB-I11; shots 04, 11, 13; attribution for any atlas in the footer.
- **Result (2026-11-02, wave 3):** geometric clump crowns instead of leaf-card atlases (so no atlas and no new
  attribution).
  - Crowns of many clumps with smooth sphere normals blended with the envelope normal and a per-vertex `crown` vec4
    (position in the envelope + a random per clump, −1 on limbs). New `viewer/src/foliage.ts` patches the leaf
    materials (`onBeforeCompile`, after `useSkyShDiffuse`): wrap diffuse, rim-weighted back-light, sheen, crown
    occlusion (100 % indirect, 55 % direct), per-clump brightness, yellower tops, leaf-cluster noise faded by
    `fwidth`, dark bark on limbs, SW wind (bend + flutter). Toggles `skb.foliage.uFolOn` / `uFolWind`.
  - Forest crown tiers by camera distance: tile meshes draw 3-clump mid crowns (60 triangles); near tiles switch to
    10-clump crowns (238 triangles) within 250 m and detail-1 "hero" crowns within 110 m, recomputed every 8 m of
    travel, ≤ 4000 per tier; far tiles keep the 20-face blob. `skb.forest.setDetail('lite'|'full')`, `stats()`.
  - Forest edge: lower crown base (no "stilts"), crowns × 1.2, slight ellipticity and lean, less colour noise; mantle
    shrubs take hedge-shrub looks. Site and garden trees use the same clump builder; garden shrubs cut to 8 clumps
    (180 instead of 500 faces, −0.19 M triangles). Poplar stays a column, yew a cone.

  Checks: `viewer/tests/crown.test.ts` (crown attribute on every species, smooth per-clump normals, silhouettes,
  bounds, determinism, < 260 triangles) and the foliage maths in `hinterland.test.ts`. Shots `docs/shots/KB-I44/`
  (01, 12, 13, 16): 12 shows a full forest edge without stilts and a leafy clumped near tree instead of a faceted
  ball; the canopy at 01 and 13 is clumpy; 16's garden tree and shrubs read leafier. 04 shows no trees near the
  camera and 11 flies over open meadow in 1789, so 12, 13 and 16 stand in for them. **Acceptance met.** Perf
  (implementer, interleaved same-session A/B on a loaded machine): full vs lite forest detail ≤ +0.3 ms at 1080p; all
  site vegetation vs hidden ≤ +0.9 ms at 04 / 13 / 16. Residuals: canopy gaps visible from ~45 m in some views; pink
  blossom triangles on flowering shrubs (pre-existing, still visible at 16); a slightly lumpy poplar column; the 19:12
  back-light may be strong. Not verified: wind in motion; the shadow pass does not sway (static by design).

  **Review fix (2026-11-02, wave 3).** The review found poplar-like columns in the forest (01, 08, 12), flat-topped far
  "buckets" (05), a polka-dot clump pattern (02, 13, 16, 17), pink blossom triangles, and +0.26 M triangles in the
  Festsaal.
  - Forest crown form (new pure `viewer/src/crownForm.ts`): beech / oak / hornbeam crowns are broad domes with a
    width : height of 1.1 / 1.2 / 1.05 (±7 %) and a crown depth of 0.55 h in the stand [N habit; I values]. At the edge
    (8–26 m) the crown comes down to 0.8 h, gets up to 28 % wider, and leans up to 12° and 0.18 r toward the open land
    (direction from the class grid). That makes an asymmetric mantle, not a vertical stretch. Open-grown Überhälter in
    the meadow get 0.76 h and no lean. Stems under the closed canopy are darkened (the light beech grey read as
    stilts). Only `populus_italica` keeps a column.
  - Unit crowns are normalised to their mean silhouette width, not their largest radius. Few-clump crowns had looked
    25–30 % narrower than their instance scale. The mid tile crown is now a 4-clump dome (3 ring + 1 top, 80
    triangles) that fills its envelope from every side. Close is 11 clumps of mixed size with 2 outline twigs; hero is
    16 smaller detail-1 clumps. Hero is capped at 700 instances (nearest first), and the tier instances are sorted
    front to back. The far tier is a 5-meridian dome with its pole on top (20 triangles, as before).
  - Shading (`foliage.ts`): the leaf-cluster noise runs in crown-envelope space with a per-instance offset instead of
    per clump. The rim and back-light use the crown envelope normal (a new varying through the instance matrix), and
    the shading normal leans 45 % further toward it. Per-clump brightness is ±5 % instead of ±9 %. No dithered sky
    holes: `discard` would defeat Apple's hidden-surface removal. Clump sizes vary 0.6–1.3 instead.
  - Garden: flowering shrubs have 10 small clumps of mixed size (220 faces) and less lightness jitter. Flowers are a
    per-vertex tint of at most 15 % on the tips of about 1 in 4 clumps (`bloomTint`); the per-face `bloomColours`
    stays only for its test. The Lombardy poplar is one tapered lathe column with 34 fine surface clumps. Big crowns
    (beech_old, R 7 m) get proportionally more and smaller clumps.
  - Indoors: while the camera is inside a building, the forest (`forestLod.indoor`) and the site trees (main.ts) are
    not drawn, because the windows are over-exposed at the indoor EV. Festsaal 06/07 drops from 1.71 to 1.08 M
    triangles.

  Checks: `viewer/tests/crown.test.ts` adds forest crown aspect ≥ 0.8 for every species, edge and random. It also
  checks that the edge form is a lean and not a stretch, that every tier geometry's horizontal silhouette is ≥ 0.85 of
  its envelope from 16 azimuths, that the far dome has a pole and narrows to < 0.6 r at 85 % of its height (≤ 20
  triangles), that the bloom tint is ≤ 15 %, that clump sizes vary, and that the poplar column has outward normals.

  Shots: scratchpad `wave3-fix-vegetation/` (all 17 poses with bench). At 01, 08 and 12 the forest reads as a
  broad-crowned deciduous wood. 05's far trees are rounded domes. At 13 the near beech shows smaller leafy clumps
  instead of metre-sized plates. At 16 and 17 the blossom triangles are gone and the shrub mass is finer. The poplar
  is a slim spire.

  Perf, retina A/B in the same session at 3024×1964 (3 repeats; min / median in ms; loaded machine):

  | Pose | Base | Forest hidden | Terrain hidden | Foliage shading off | Lite crowns | No close/hero tiers | No hinterland |
  |---|---|---|---|---|---|---|---|
  | 12 | 19.1 / 19.2 | 14.8 / 18.0 | 5.6 / 6.2 | 17.6 / 18.2 | 18.9 / 19.9 | ≈ base | ≈ base |
  | 13 | 14.8 / 16.3 | 13.2 / 15.4 | 2.5 / 2.6 | – | – | 10.8 / 12.8 | – |
  | 08 | 20.7 / 20.8 | 20.0 / 20.9 | 6.4 / 6.5 | – | ≈ base | – | – |
  | 02 | 15.5 / 17.1 | slower (noise) | 2.9 / 3.8 | – | – | – | – |

  The tier and hinterland differences at 13 did not repeat in a 5-repeat rerun: base 16.4 / 18.5, no tiers
  15.5 / 18.6, forest hidden 16.5 / 17.7, site vegetation hidden 15.6 / 16.9. Hiding all vegetation therefore saves
  about 1–1.5 ms at most. Hiding the terrain saves about 13 ms at every one of these poses, so the retina regression
  of 12 / 13 / 08 / 02 is terrain and ground shading (KB-I59), not foliage overdraw. 1080p stays at about +0.3–0.8 ms
  against wave 2.

  Triangles: outdoor poses are +0.03–0.11 M against wave 3 (mid 80 vs 60, close 300 vs 238, hero 1,400). Indoor
  poses are −0.63 M.

  Residuals: hero and close clumps still show detail-0/1 facets at 60–100 m; there are no sky holes; the far dome is
  pentagonal against the sky at < 30 px; the poplar reads a little conical. Not verified: wind in motion, and an
  idle-machine bench.

  **Wave 6 (vegetation, 2026-11-02): leaf cards near the camera.** A procedural 2 × 2 leaf-cluster atlas
  (`viewer/src/leafAtlas.ts`: three broadleaf sprays and one needle spray, own output, so no licence or footer entry)
  on camera-facing cards anchored on the outer clump surface (`viewer/src/leafCards.ts`). Site trees: the nearest 160
  instances within 140 m; forest hero and close tiers share their instance buffers through `Forest.onTiers` and fade
  the cards out by 220 m. Alpha-to-coverage, no shadows, no specular; `foliage.ts` `FOL_CARD` path with `uCardFar` /
  `uCardGain`; shells darken under the cards (clipped cones skip it, crown w 0.99). Limb bark a little lighter. Tests
  `viewer/tests/leafCards.test.ts` (8). Cost (implementer, same session, n = 3): +0.2…0.5 ms at 1080p, retina within
  noise; the final no-specular code was not re-measured.
  **Lead check (wave 6, `wave6-after`):** pairs `docs/shots/KB-I44/*-wave6-*` 12, 13, 33, 34. The near crowns at 33 and
  34 now read as leafy silhouettes with broken edges instead of faceted balls, and the near Karlslust tree (12) and
  the galerie tree (13) lose their polyhedral plates. **Residuals (→ KB-I66):** forest crowns at 150–300 m (01, 08,
  Rundflug) are unchanged and still faceted, because the cards fade by 220 m; conifer whorls (34, right) still look
  stacked; the cards rely on MSAA for alpha-to-coverage, which the scene target drops above 4.2 Mpx (KB-I41). Bench:
  33 1080p 2.2 → 3.5–3.9 ms and retina 3.2 → 8.0–8.2 ms, 34 2.5 → 3.9–4.2 / 13.5 → 9.7–10.1 ms (cross-session, post
  chain included; KB-I65).

### KB-I45 · Ground detail: wear masks, lawn variation, hedge bevels `[x] (uncommitted; Ehrenhof wear in wave 8)`
- **Why:** visual-audit §5.6 items 6–7, §5.7, P12.
- **Payoff:** – / ★★. **Effort:** M. **Perf:** ~0.
- **Files:** `viewer/src/terrain.ts`, `model/src/site/features.ts`.
- **Acceptance:** shots 03, 04.
- **Partial (2026-11-02, wave 3, via KB-I56):** lawn variation (scythed meadow-lawn, dry patches), worn walk edges,
  trodden verges and desire paths are in the bake. Shots `docs/shots/KB-I45/` (04, 16): the lawn is calmer and less
  saturated. **Open:** hedge bevels, wear masks in the Ehrenhof (03 is unchanged; the wave-2 ruts still read as two
  thin dark lines).
- **Review fix (2026-11-02, wave 3 review, ground):** TF-09 garden terrace: the lawn now rises in a 3 m grass bank to
  the kerb (prepare-terrain.py, terraces without a retaining wall), so the kerb reads as a thin pale line at lawn level
  instead of a raised slab with a jagged seam (04, 15, close-up c6). Contact darkening in the bake: −10 % within 1.4 m
  of any hard edge (`tDist` R: grass overhang at kerbs, paths, terrace and wall feet) plus up to −12 % over 0.5-5 m at
  building walls (macro nearness). Near lawn: two decorrelated grass taps (2 m and a rotated 2.9 m) at half weight,
  so the 2 m photo repeat is gone and the straw scratches lose contrast; at 04 / 16 they are still visible at the very
  bottom of the frame. **Still open:** hedge bevels and Ehrenhof wear masks (03).
- **Wave 7 (garden, 2026-11-02):** pure `model/src/site/hedgeProfile.ts`: a battered section with a bevelled, rounded
  shoulder and smooth normals (5 faces; tests `model/tests/hedge-profile.test.ts`, 4). `extrudeHedge`
  (`gardenDetail.ts`) draws it with end caps only at band ends, for the box edging of the parterres à l'angloise (10
  instead of ~22 triangles per segment, replacing two stacked boxes) and the generic parterre hedges in `features.ts`.
  Ehrenhof sand (`terrain.ts`): wheel tracks as broad bands of packed sand (smoother, slightly darker and warmer)
  instead of thin dark lines, a noise-broken trodden band 2–7 m beside the causeway, a damp splash and moss strip at the
  plinth, pale drifted dust 1–3 m out; cobble lanes (`model/src/materials/cobbles.ts`) with flatter wheel-track stones
  and hoof dust. No darker hedge foot (the site GeoBuilder bakes no AO).
- **Lead check:** 30 (`docs/shots/KB-I45/*-wave7-30-*`, incl. a hedge crop): the hard dark seam along the hedge tops is
  gone and a light shoulder reads. 03 (`*-wave7-03-*`): no dark rut lines any more, but no wear pattern reads at eye
  level either (mean |Δ| 1.43/255 including the mapped windows). Partial: the Ehrenhof wear masks are too subtle at 03.
- **Wave 8 (garden, 2026-11-02):** Ehrenhof wear in `viewer/src/terrain.ts` (sand court, `uCourtHalf` from
  `courtHalfLength`, axis gate → portal): patchy ±10 % sand, two broad wandering packed bands ≈ 4.7 m either side of
  the axis with faint wheel-gauge pairs (no tram lines), a turning sweep 12 m W of the portal, a trodden band beside
  the causeway, a damp splash band and moss at the plinths, pale dust beyond [I; N gravel courts]. `cobbles.ts`
  (no owner, as in wave 7): wheel-track stones darker, greyer and smoother (`cobPolish`, roughness 0.5), track
  darkening 0.05 → 0.08 (cache key `cobbles-v3`). Lawn and meadow (audit #1): the bright luminance tail of the grass
  photo (the straw scratches) is compressed (meadow 40 %, lawn 20 %) and the lawn gets a fine mottling within 150 m;
  16 reads as a short green lawn. Shots `docs/shots/KB-I45/after-wave8-03-…`, `…-14-…`: soft packed bands read at
  eye level; the plinth damp band is ≈ 1 px at 60 m. Same-session A/B of the lawn and vineyard shader changes (#if
  toggle, 3+3 runs, load 20): 41 retina min 16.2 → 16.8, med 16.3 → 16.9 ms; 40 retina min 15.9 → 16.2; 1080p
  within noise (≤ +0.4 ms min).
- **Lead check (wave 8):** 03, 14 (`docs/shots/KB-I45/*-wave8-03-…`, `*-wave8-14-…`): two soft wandering packed
  bands and the turning sweep now read at eye level, converging on the portal without tram lines; the track cobbles
  are darker and smoother. 16, 33 (`*-wave8-16-…`, `*-wave8-33-…`): the straw scratches are gone and the lawn reads
  short and green (33 mean |Δ| 7.8/255). Side effect: the near meadow at 39, 44, 46 also reads flatter and more
  uniform than before (less blade texture); grass-blade cards were not done. Bench 03 / 14 1080p 5.1 → 4.6 / 4.8 and
  4.4 → 4.6 / 4.9 ms. Done.
- **Wave-8 review fix (garden, 2026-11-02):** the review found the near lawn at 18 strewn with straw and the near
  meadow at 39 / 44 / 46 flat and felt-like. `viewer/src/terrain.ts`: tail compression 0.22 on meadow / hay and 0.2
  on the lawn; near meadow / hay (< 60 m) keeps the photo's blades at half contrast; within 32 m a procedural
  isotropic grain (three octaves 14 / 6 / 2.7 cm on all grass, plus a 32 cm octave on meadow / hay, each faded by its
  pixel footprint so it does not alias); within 160 m the meadow and hay get darker, greener regrowth patches (Grummet,
  2–6 m) and paler seeding tufts (1–2 m), gated off lawn, fields, vines, hard ground and forest [N July meadows mown
  in turns; I amounts]. New lawn `KB-L2` "Rasen an der Rotunde (Gartenseite der Galerie)" in
  `scripts/catalogue-v2/terrain.ts` (`pleasureLawns()`, low, from 1788, ≥ 9 m off the Überhälter oak): the ground at
  18 was meadow; 78 cells meadow → lawn, no tree changes (planner diff). Shots `docs/shots/KB-I45/wave8fix-18-…`,
  `…-16-…`, `…-46-…`: 18 an even short lawn with fine mottling, no straw; 16 keeps its grain; 46 a mottled meadow
  without straw scratches. Bench 16 1080p 4.16 / 4.18, 46 4.35 / 4.36 ms (min / median of 3; `wave8-after` single
  run 4.35 / 4.23). Grass-blade cards still not done.
- **Wave 9 (garden, 2026-11-02):**
  - **Grass blades at eye level** (`viewer/src/grassBlades.ts`, `skb.grass.setEnabled`): blade cards in a 22 m disc
    round the camera with a procedural tuft atlas (lawn tussocks; meadow tufts with seed stems), heights from grammar
    `GRASS_SWARD` (scythed lawn 4.5–8.5 cm, July aftermath meadow 9–22 cm) [N; I], on the terrain mesh's own
    triangles, lit like the terrain, off walks ≤ 4 m, thinned with distance; `depthWrite` false and `renderOrder` 1.5,
    so SSAO and SSR ignore them (the first cut drew dark AO clumps). Hay less yellow (`hayGreen #88A05E`, less straw
    and buttercup in the bake). Test `viewer/tests/grassBlades.test.ts` (7).
  - **Ehrenhof wear** (`terrain.ts`, splat key `terrain-splat-10`): the straight gauge tracks and stripes replaced by
    isotropic noise wear bands with a ±0.5 m wobble, a softer sweep and trodden patches at 0.75.
  - Garden A/B (5 interleaved repeats, min / median, load 13–20): blades on / off 16 1080p 4.31 / 4.36 vs 4.20 / 4.25,
    retina 5.40 / 5.43 vs 4.75 / 4.76; 33 retina 7.14 / 7.16 vs 5.62 / 5.66; 39 7.13 / 7.18 vs 5.61 / 5.71; 47 7.45 /
    7.47 vs 5.87 / 5.88 ms. 1080p +0.11…+0.19 ms; retina +0.6…+1.6 ms, every total < 8 ms.
- **Lead check (wave 9):** `docs/shots/KB-I45/*-wave9-…` (16 crop, 46, 47, 03, 09). The meadow at 46 / 47 now reads as
  grass with seed tufts (better). On the scythed lawn (04, 16, 33) the blades read as scattered dark speckles in a
  regular grain at 1:1, not as a dense sward, and at 39 (fly mode) the disc's start shows as a band in the lower left
  → KB-I78. Ehrenhof 03 / 09 / 14: the tyre-track stripes are gone and the court reads calm; the cobbled lane's hard
  straight end on the court axis is older (Discovered). Retina in the full bench (three runs): 33 6.6 / 7.2, 39 6.7 /
  7.4, 47 7.1 / 7.5 ms, within 8 ms but the largest rise of the wave. Done (look follow-up KB-I78).

### KB-I46 · Rundflug (scripted fly-around) `[x] (uncommitted)`
- **Why:** the main "wow" moment; 6 deterministic shots with a `skb.tour(id, t)` capture hook (visual-audit §5.11, P13).
- **Payoff:** – / ★★★. **Effort:** M. **Perf:** 0.
- **Files:** new `viewer/src/tour.ts`, `viewer/src/ui.ts`.
- **Acceptance:** "Rundflug" button (German), stop on any input, frames reproducible via `skb.tour`; a short frame
  strip in `docs/shots/`.
- **Result (2026-11-02, wave 5, experience):** `viewer/src/tour.ts` (pure) defines six shots, about 71 s in all:
  Anflug 07:15, Ehrenhof 17:30, Garten 07:00, Galerie/Rotunde 08:30, Orangerie 16:30 and Goldene Stunde 18:45.
  - Each shot follows a centripetal Catmull-Rom path at constant speed (arc-length table) with a C1 trapezoid speed
    ramp, and is anchored to catalogue buildings.
  - Cuts and hour changes happen inside a 1.2 s fade through black; the camera stays ≥ 1.6 m above the terrain, and
    the LOD2 probe looks ahead along the path.
  - The tour plays in the Kino look with 2.2:1 letterbox bars and German captions that give each building's
    confidence and "Rekonstruktion = Hypothese".
  - Any key, click, wheel or touch (or Esc) stops it and restores hour, look and panel. A frame hitch slows the tour
    instead of skipping (dt ≤ 0.1 s).
  - Panel button "▶ Rundflug"; hooks `skb.tour`, `tourFrame`, `tourShots`, `tourPlay`. Tests: `viewer/tests/tour.test.ts` (10).
  - The golden hour was moved from 19:00–19:15 to 18:45, because the later hours looked hazy and grey.
  - The tour code costs nothing while inactive.
- **Lead check (wave 5):**
  - Frame strip: `docs/shots/KB-I46/1-anflug … 6-goldene-stunde.jpg` plus `esc-restored.jpg`. The implementer checked
    in the browser that Esc restores hour 17.5, the Doku look and the panel. Tree clearance is ≥ 6.7 m in every shot.
  - Literal acceptance: German button met (`ui.ts`); stop on any input met (Esc checked in the browser, the other
    inputs by code); frames reproducible through `skb.tour` / `tourFrame` met (tests); frame strip met.
  - Not verified: live feel at real frame pacing (frames were driven with `skb.step`). `tour.test.ts` failed once on
    a `toBeCloseTo(0.5, 9)` float check (5e-10) during parallel edits, and it passes in the final run.

- **Review fix (2026-11-02, wave 5, experience).** The review found that the Anflug opened skimming crowns, a near
  crown blocked about a third of the Galerie shot, and the 18:45 closing shot was flat grey haze.
  - Anflug: the camera starts at 386 m, about 85 m over the valley floor and ≥ 30 m over every crown within 50 m
    (was 338 m, 17 m below nearby crown tops). The eye looks out along the valley meadow instead of down into the
    canopy.
  - Galerie: the arc around the rotunda runs from 44° to 74° (SE → S, r 62 m) instead of −18° to 50°, and the eye is
    aimed slightly W of the rotunda, so the Herzogskastanien grove N of it leaves the right edge.
  - Goldene Stunde: the high arc moved W of the residence (148° → 184°, r 230 m) with the 18:45 sun (≈ 10°, WNW)
    behind the right shoulder. The court fronts are warm and front-lit, and long shadows reach across the meadow
    (pose 08 is the reference).
  - Kino grade (`grade.ts`): an ASC CDL look inside AgX's sigmoid, milder than Blender's "Punchy" (slope 1.03 / 1.0 /
    0.95, power 1.18, saturation 1.22 [I]), and 0.6× haze in the Kino look (`KINO_HAZE`). Dokumentation is unchanged.
  - Test: `viewer/tests/tour-occlusion.test.ts` builds the real 1789 forest, hinterland and site trees in node (about
    50 k crowns as spheres). For every shot at u 0.05–0.95 it requires ≤ 15 % of a 16 × 7 ray grid through the
    letterboxed frame to hit a crown within 30 m, and within 60 m. It also requires the Anflug to stay ≥ 25 m above
    every crown within 50 m. Worst shares now: Anflug 0, Ehrenhof 0.05, Garten 0.11, Galerie 0.04 (was 0.48 at 30 m),
    Orangerie 0, Goldene Stunde 0.
  - Frames: scratchpad `wave5-fix-experience/tour/` (18 frames, `sheetA/B.jpg`, the cut, the restore and two photos).
    Esc restores hour 17.5 and the panel.
  - Tour GPU (1080p / retina, loaded machine): Garten 4.6 / 4.2 ms, Anflug 4.1 / 4.9 ms, at +250 calls and +0.5 M
    triangles at the Anflug, since the higher camera sees more. This is within budget.
  - Residual: the top-right corner of Galerie 0.1 still shows part of a grove crown, about 10 %.
- **Wave 6 (look, 2026-11-02):** `kinoLowSun(el)` (light.ts, Kino only; full weight 3–12° sun, gone by 24° and below
  −1°): adaptation × 0.4, sky fill × 0.6, visible-sky saturation × 1.45, haze × 0.55. Pair
  `docs/shots/KB-I46/*-wave6-goldene-stunde-0.7.jpg` (`skb.tour('goldene-stunde', 0.7)`): warmer key and deeper,
  more legible shade; the horizon sky toward the sun is still pale beige. Dokumentation unchanged.

### KB-I47 · Photo mode `[x] (uncommitted)`
- **Why:** stills with TAA accumulation, 2–3× scale, DOF and burned-in attribution and "Hypothese" label
  (visual-audit §5.11, P14).
- **Payoff:** – / ★★. **Effort:** S-M. **Perf:** stills only.
- **Files:** new `viewer/src/photo.ts`, `viewer/src/main.ts`.
- **Acceptance:** attribution and the hypothesis notice burned in; one example still.
- **Result (2026-11-02, wave 5, experience):** key P or "Foto P", with "Foto 2×/3×" and "Tiefenunschärfe".
  - Accumulated still at 2× or 3× the canvas (≤ 8192 px): 16 Halton sub-pixel-jittered samples, or 32 with depth of
    field, averaged in display space in a float or half-float target.
  - Depth of field: thin-lens accumulation (Haeberli & Akeley 1990), focused on the surface at the screen centre (a
    raycast against buildings and terrain); circle of confusion 0.12 % of the width at infinity.
  - Burned in: the label, the scene time and the full attribution. The file is `schloss-karlsberg-1789_HHMM_<ts>.png`.
  - One sample per tick, and the viewer's own frames pause meanwhile. Camera, pixel ratio and size are restored in a
    `finally` block.
  - The maths is in `photoMath.ts` (tests `viewer/tests/photo.test.ts`, 4); hook `skb.takePhoto`.
  - Timing: 3840×2160 takes 419 ms (DOF 528 ms); 5760×3240 also works.
- **Lead check (wave 5):**
  - The example still `docs/shots/KB-I47/photo-2x-3840x2160-downscaled.jpg` carries "Schloss Karlsberg um 1789 ·
    Rekonstruktion – Hypothese", the date and time line, and the attribution footer ending in "Schauen, nicht graben".
    The crops (`photo-2x-crop` vs `before-crop`) show the cleaner antialiasing.
  - **Acceptance met.**
  - Not verified: the real download in a visible tab (only the dataUrl path), and the photo on a retina display.

- **Review fix (2026-11-02, wave 5, experience):** the burned-in credit was shorter than the live footer (it lacked
  "Rekonstruktion: Hypothese nach research/01–08 (Teilprojekt Schloss Karlsberg)"). Footer and photo now share one
  credit line, `photoMath.ts footerParts`. Checked on the 3840×2160 night still (`wave5-fix-experience/tour/
  photo-night-credit.png`); the DOF still takes 522 ms. Lazy-loading photo.ts was not done, because it would save
  only about 8 kB of the 1,564 kB bundle.
- **Review fix (wave 7, look, 2026-11-02):** with the focus on a far surface the fixed 0.12 % circle of confusion
  blurred the foreground strongly (tilt-shift look). `photoMath.ts` now has `PHOTO_DOF` (far focus 25 m, near 15 m,
  max 1.5 px) and `photoAperture`, which caps the aperture for a focus beyond 25 m so that nothing from 15 m to
  infinity blurs by more than 1.5 px; near focus (interiors) keeps the mild DOF [I]. The credit now reads
  "research/01–11" in HUD and burn-in (one `footerParts`). Checked with `skb.takePhoto({dof:true})` at 3840×2160:
  14 focus 56.7 m, aperture 14.7 mm, 712 ms (foreground cobbles sharp); 39 focus 141 m, 12.1 mm; 22 focus 13.8 m,
  30.6 mm (`wave7-fix-look/photo/`). Tests `viewer/tests/photo.test.ts` (PHOTO_DOF), `night-review5.test.ts`.

## Later, parked, cross-cutting

### KB-I48 · Festbeleuchtung and the "Dezember 1785" scene `[~] (uncommitted; mode done, 1785 scene open)`
- **Why:** the 1785 wedding festivities had illuminations (Fürstenwärther 1786) and fireworks (Mannlich) (research/01
  §4.2; visual-audit §5.9, P17); Mannlich's 1785 rotunda section (Darmstadt Mappe 27/4/4, CC0) gives a spec: steep
  timber truss over a painted sky dome, pink Ionic arcades, green-and-gold piers, lampions (10 §c.4) [D]. With
  KB-I03, KB-B13 and KL-B49 can return in an epoch "Dezember 1785".
- **Decision needed:** audit §8 Q3 (the arrangement is a hypothesis). Recommendation: yes, as a clearly labelled mode.
- **Payoff:** ★★ / ★★★. **Effort:** L. **Perf:** +0.3 ms.
- **Files:** new `viewer/src/festival.ts`, `viewer/src/ui.ts`, catalogue epoch entries.
- **Acceptance:** after KB-I03 and KB-I43; the mode is off by default and labelled "Festbeleuchtung (wie 1785
  beschrieben, Anordnung Hypothese)"; the 1785 scene shows KB-B13 and KL-B49 and hides post-1785 items via `inEpoch`;
  lamp placement deterministic (pure helper + test); a night aerial and a 1785 Orangerie-court shot (append poses).
  Downloading the Darmstadt CC0 sheets still needs the user's approval (KB-I54).
- **Done (2026-11-02, wave 8, look):** the mode (checkbox, off by default, label as above). Placement is pure
  (`model/src/layout/festival.ts` `festivalLamps`, grammar `FESTIVAL` with tags; tests `model/tests/festival.test.ts`):
  cornice lampions every 1.2 m (not inside a neighbouring building), two lampions per window sill, rings on the
  rotunda entablature and attic plus the archivolts, pots-à-feu round TF-01 every 6.5 m, lamps along the TF-08 / TF-15
  parterre edges and the HG-04 rim; 1,689 lamps for 1789; `year` filters by `inEpoch` (KB-B13 only in 1785). Viewer
  `festival.ts` + `festivalMath.ts` (tests `viewer/tests/festival.test.ts`): points with a minimum pixel size and kept
  energy, instanced additive pools on walls and ground, ≈ 4 draw calls, no point lights; every window of
  `FESTIVAL.buildings` is candle-lit (`night.ts` `setWindowFest`, negative `aLit`); the chandeliers burn. Poses 52
  (night aerial) / 53 (Orangerie court). A/B within ±0.2 ms. **Open:** the "Dezember 1785" scene (a scene-year switch
  for KB-B13 / KL-B49; `festivalLamps` already takes `year`); the Mannlich rotunda section (KB-I54).
- **Lead check (wave 8):** label, default off and the pure, tested placement as asked; 52 (night aerial) and 53
  (Orangerie court) render (`docs/shots/KB-I48/after-52-…`, `after-53-…`): cornice lampions and lit windows outline
  the palace and the Orangerie, pots-à-feu ring the Ehrenhof. 53 is the 1789 court, not the asked "1785
  Orangerie-court shot" (no scene-year switch yet). Bench 52 1080p 4.2 / 4.3, retina 7.3 / 7.6; 53 2.6 / 2.7, 4.2 /
  4.5 ms. Partial: the "Dezember 1785" scene year.
- **Review fix (wave 8, look, 2026-11-02):** the mode drew the dense 1785 rotunda rings (the fête's centrepiece,
  research/10 §c.4) on the 1789 Tempelzimmer KB-B07, built 1788–89 [D T5], so the 1789 scene mixed two years.
  `FESTIVAL.rotunda.event = { year: 1785, buildings: ['KB-B13'] }` and `festRotundaRings(b, year)`: the rings and
  archivolts apply only to the event building, in a scene of the event year, when its epoch contains it; KB-B07 gets
  the ordinary cornice line (eaves) and a pair of lampions at each glazed door [I]; KB-B13 (no modelled order) keeps a
  dense cornice ring in a 1785 scene. Label "Festbeleuchtung (Muster 1785, auf 1789 übertragen; Hypothese)", tooltip
  says the rotunda rings belong to the Festjahr 1785. 1789: 1,500 lamps (rotunda group 0; cornice 595, sill 699).
  Test `model/tests/festival.test.ts` ("the dense rotunda rings apply only to the 1785 event building in its year").
  Shots 52 / 53 (`…/scratchpad/wave8-fix-look/after/`, crop `crop-52-rotunda.jpg`): the bright ring at the gallery's
  E end is now a single cornice line; 53 unchanged. Bench (same run, single): 52 1080p 4.1, retina 7.3; 53 2.7 / 4.4 ms.

### KB-I49 · Physically based atmosphere `[ ]`
- **Why:** visual-audit §5.4 level 2, P18 (`@takram/three-atmosphere` 0.19.1, pre-1.0, ECEF frame). Behind a flag for
  the Rundflug and photo mode.
- **Payoff:** – / ★★. **Effort:** L. **Perf:** +1…2 ms.
- **Acceptance:** after KB-I46/KB-I47; flag off by default; exact pin with the reason in the commit; shots 01, 08
  with the flag on; the ECEF↔local transform has a round-trip test (< 1 m at the palace).

### KB-I50 · Static far shadow map or CSM `[x] (uncommitted, wave 8)`
- **Why:** aerial palace shadows (visual-audit §5.5, P19); prefer a static far map.
- **Payoff:** – / ★★. **Effort:** M-L. **Perf:** +1…3 ms (CSM).
- **Acceptance:** after KB-I04; palace shadows visible at pose 01 and 08 without acne or swimming while flying;
  rebuilt only on an hour change; bench 01 and 08 within the item budget.
- **Done (2026-11-02, wave 8, look):** `viewer/src/shadowsFar.ts` / `shadowsFarMath.ts` (tests
  `viewer/tests/shadowsFar.test.ts`). A second directional light (colour 0) owns a 4096² map (Mobil 2048) over a square
  round all placed buildings + 220 m; its light-space height is foreshortened by sin(el) so ground texels stay
  near-square at low sun (≈ 1 m). `installFarShadowChunk` patches `lights_fragment_begin`: the sun reads the near map
  and fades into the far map over the outer 6 % of the near frustum; light 1 adds no light and no BRDF. Redraw only
  when the sun moved (at once > 2°, else after 6 settled frames) or the casters changed (display toggles, epoch); the
  far forest impostors (`forest/<chunk>/impostors`, no near-map casters) cast into the far map for that one frame,
  which waits a frame if the near map redraws. No swimming (fixed frustum). A/B fhd +0.2…+0.45 ms, retina ±0.5 (noise);
  one redraw ≈ 2–3 ms. Shots `docs/review/wave8-look/kb-i50-*`. The palace shadows at 01 / 08 were already inside the
  near map (700 m); the visible gain is the canopy relief and forest-edge shadows beyond it.
- **Lead check (wave 8):** 12 and 08 (`docs/shots/KB-I50/before-…`, `after-…`): the far forest on the hills gains
  crown relief and forest-edge shadows instead of evenly lit domes; the palace shadows at 01 / 08 were already in the
  near map. No acne at 14 or 03. "No swimming while flying" holds by construction (fixed frustum) but was not seen in
  motion (stepped headless frames only). Bench (includes the KB-I65 glass fix): 01 1080p 6.1 → 5.6 / 5.9, retina
  21.4 → 7.2 / 7.7; 08 6.2 → 5.6 / 5.6, 15.4 → 7.4 / 7.8 ms. Done.

### KB-I51 · WebGPU / TSL migration `[-]`
- Parked: only after the look is settled (visual-audit P20); requires porting `onBeforeCompile` patches and the splat.

### KB-I52 · Review-1 leftovers `[x] (uncommitted; wave 8, architecture)`
- SC-02 "Querschnitt B–B" title (review-1 #21); B04 (2 doors) and B05 (1 door) not served by their stairs
  (#18, `verify.sh warn`); jagged foot of the TF-08 retaining wall S of B02; the B02 portico mound (#6 residual; the
  1789 forecourt level is U).
- **Files:** `plans/src/sheets/schnitt.ts`, `scripts/catalogue-v2/programme.ts`, `scripts/prepare-terrain.py`.
- **Acceptance:** `verify.sh warn` shows `[]` for every building; a TF-08 pose (append).
- **Done (wave 8, architecture, 2026-11-02):**
  - Doors: `programme.ts` gives the B04 passage an OG door onto the stair gallery and drops the Kupferstich door to the
    stair; the B05 Küchenbautreppe is two axes wide and the rooms beside it are re-gridded. `verify.sh warn` is `[]`
    for B01–B06, B10, B11 (a test asserts it).
  - SC-02 is titled "Schnitt B–B quer zur Hofachse (Prunktreppe)" (`schnitt.ts`, `sections.ts`, `plans/README.md`;
    file slug unchanged).
  - TF-08 retaining-wall foot: `prepare-terrain.py` `WALL_FOOT_IDS`: a linear ±0.8 m ramp in the distance to the
    terrace edge, then a flat foot to 1.6 m; the 1 m saw teeth (≈ 55 % of the wall drop in a simulation) drop to ≈ 6 %.
    Price: a uniform shallow gutter ≈ 0.27 × drop along the inside of the parapet [I].
  - B02 W portico: the mound is a level 7 m forecourt pad at 344.8 m with a 9 m grass bank (`PORTICO_PADS`) [I; the
    1789 forecourt level is U].
  - Pose 49 (TF-08 wall foot and the S-wing W portico from the SSW, 4 m). Plan sheets GR-11…16 and SC-02 regenerated.
- **Lead check (wave 8):** `verify.sh warn` prints `[]` for all eight detailed buildings. 49
  (`docs/shots/KB-I52/after-49-…`): the wall foot runs as a near-straight line; at its W end the terrain dips slightly
  under the wall, and a pale strip marks the ramp at the E end. Bench 49 1080p 4.6 / 4.7, retina 5.8 / 5.8 ms. Done.

### KB-I53 · CdL massing check and concealed stair `[x] (uncommitted; massing kept)`
- **Why:** Mannlich and Molitor describe the core as a one-storey-plus-mansard country house with projecting wings,
  which argues for a modest CdL rather than the HMS centre pavilion at 366.2 + lantern (10 §b.1) [D text; I massing];
  an optional secret service stair in a cabinet (10 §b.1, T5) [D].
- **Payoff:** ★★ / ★. **Effort:** M (mostly analysis). Write findings into research, then decide; do not change the
  massing on this alone.
- **Acceptance:** a dated note in research/10 (or a new research section) comparing T1 "einstöckiges Wohnhaus mit
  Mansarden", LC 1790 and the HMS 366.2 m centre, with tags; a decision row in the Decisions log; geometry changes only
  as a separate item.
- **Done (wave 7, architecture, 2026-11-02):** dated note research/10 §d.4 comparing T1 / Molitor "einstöckiges
  Wohnhaus mit Mansarden", T1 p. 365, LC 1790, PL, the HMS figures (366.2 ± 1.2 m, lantern ≥ 367.8 m) and the model
  (366.22 / 367.8 m), with tags. Two readings resolve the phrase: in period usage "einstöckig" can count only the upper
  floor, or it describes the 1760/61 core. Decision: keep the massing (Decisions log); the KB-B01 notes cite it. The
  concealed stair (T5) belongs to the early phase and no source places it: an optional low-confidence interior item,
  not taken. **Lead check:** met; no geometry change (catalogue reproduced byte for byte).

### KB-I54 · Source acquisition (requests from research/09–11) `[?]`
- research/10 §d.2 (Darmstadt Mappe 27/4/1–5 CC0; Becker 1796 PD; Schneider 2014; Schwan 2010; Schwan 2023–25;
  Weber 1969/1980/1987; Marx 2011; Buttmann; BayHStA inventories; LDA 2006 forecourt report; HathiTrust Mannlich
  1913), research/09 §7, research/11 §8.
- Public-domain or CC0 downloads go to the git-ignored `sources/` with a licence line in research/07's log; print
  monographs and archives need the user (library, ILL, reading room). Each source that arrives should settle a named
  open question; update the affected items' tags.
- **Acceptance (per source):** the user approved the download or access; licence line logged; the open question it
  settles is named, and the research doc and catalogue tags it changes are updated in the same cycle.
- Wave 4 asks (KB-I23, KB-I18): a located source for the Marstall basin ("aux grandes écuries", PV "S", end of the
  Lambsborn aqueduct) and the Küchenhof pump fountain (PV "v"); evidence for the mansard upper pitch (flat lead deck
  per HMS E9 vs the catalogue's 21–30°).
- Wave 4 review ask (KB-I24): the order of the gallery's garden end. The model has gallery → colonnade →
  Tempelzimmer/Rotunde as one building. R12 lists "Tempelzimmer (Granitsaal) → Kolonnade → Rotunde", and T1 p. 375
  speaks of "eine offene, durch eine Kolonnade abgeschlossene Rotunde", which fits a separate open Rotunde beyond the
  colonnade (KB-B07 alternative). The question needs the Schwan 2012 figures and the T7 inventory order.

### KB-I62 · Light-layer headroom before more exported geometry `[x] (uncommitted)`
- **Why:** the temp export is 5.93 MB of the 6 MB budget after wave 5: 104 nodes (92 buildings + 12 site), 405,696
  triangles, 695,642 vertices [measured, `verify.sh export`]. Since the deployed 2026-11-01 layer (4.65 MB, 340 k
  triangles), most building nodes have grown by 10–30 % in triangles (the cause has not been split per item; likely the wave-3/4 exterior detail). The GARD walls,
  the round KB-B07 and the pavilions KB-B06a, KB-B87 and KB-B88 add more. The stepped garden walls first cost
  0.35 MB; they fit only through a lean variant below LOD 2. Any further exported item would break the budget (KB-I28 Orangerie joinery, KB-I29 menagerie,
  KB-I39 follies, KB-I31 Altan).
- **Payoff:** – / ★ (enables later items). **Effort:** S. **Perf:** 0.
- **Files:** `scripts/export-explorer.ts`, `model/src/explorer/export.ts`, `docs/explorer-integration.md`.
- **Options:** quantise POSITION as well (`scripts/export-explorer.ts` quantises only NORMAL and COLOR_0 today;
  `KHR_mesh_quantization` is already required, so the explorer's loader handles it; check ≤ 1 cm error with
  node-local offsets); drop `placement: 'hypothetical'` nodes or move them to a separate optional
  file; drop flat ground-level stone (`site:TF-01` gutters, see Discovered, wave 4); a simplify pass on LOD1 roofs.
- **Acceptance:** ≥ 0.8 MB headroom under 6 MB with the same node list (or a documented, user-approved drop);
  GLTFLoader round trip OK; `sle-recon-v1` either unchanged or bumped together with `../docs/data-contract.md` (the
  parent repo's contract, so it needs the user's go).
- **Wave 6 update:** 5.90 MB, 105 nodes (93 buildings + 12 site), 405,005 triangles, 692,693 vertices
  (`verify.sh export`). The menagerie went *down* (KL-B43 rows replace the heavier stepped GARD wall: 2.6 → 1.7 k), so
  KB-I28's new `KB-B12a` (0.8 k) and the lathed herm (`site:HG-41` 0.1 → 0.6 k) still fit. Dropped: `wood.frame`
  252,812 and `metal.iron` 30,028 triangles. Headroom is 0.1 MB; KB-I31, KB-I39 and KB-I67 still need this item first.
- **Done (wave 7, architecture, 2026-11-02):** each `POSITION` accessor is int16 (not normalised) on a global 1/64 m
  grid; every node carries its dequantisation as translation + uniform 1/64 scale, with the offset snapped to the
  same grid so vertices shared between nodes stay identical. A node outside the int16 range or above 1 cm error would
  stay float32 (none does). The round-trip check accepts translation + uniform scale and compares bboxes in world
  space. Open follies (Altan, tent, wagon, aviary, apiary) get no base skirt. Tests
  `model/tests/explorer-quantise.test.ts` (3). Docs: `docs/explorer-integration.md` §2.1, §2.2, §2.5;
  `docs/architecture.md`.
- **Lead check:** met. With the wave-6 node list the layer drops 5.88 → 4.11 MB (1.89 MB headroom, ≥ 0.8 required).
  `verify.sh export` after all wave-7 work: **4.17 MB**, 114 nodes (102 buildings + 12 site), 406,853 triangles,
  696,797 vertices, max error 7.8 mm, round trip OK; dropped `wood.frame` 252,396 and `metal.iron` 31,942 triangles;
  `footprints.geojson` / `index.json` 102 / 102; deepest skirt KL-B41a 5.68 m. `sle-recon-v1` unchanged
  (`../docs/data-contract.md` already allows a quantisation transform; the explorer bakes `matrixWorld`). Not verified:
  the explorer-side render of the quantised layer (the round trip checks bboxes only). The re-export into `../app`
  still waits for the user's go.

### KB-I64 · Deterministic shots again (animation clocks, a lighting flake at 21) `[x] (uncommitted)`
- **Why:** until wave 5 an unchanged scene gave byte-identical JPEGs, which the reviews use to prove "no visual
  change" (verification §2). In `wave6-after` and two repeat runs (same session) the outdoor poses differ run to run
  by mean |Δ| 0.07–0.3/255 in up to ~400 pixels (01, 12, 32, 33, 34, 36; 03 and 06 stay identical) [measured]. The
  likely sources are the wave-6 animation clocks (`waterTime` ripples, `jetSpray` droplets, leaf-card fades) running
  on wall time instead of `skb.step` time. Separately, pose 21 once (1 of 8 runs) rendered with a large blown-out
  sunlit floor (mean |Δ| 30/255; `wave6-after-r2/21-hofbibliothek-b04.jpg`), so some light state (shadow cache, eye
  adaptation or the post chain's history) is not settled when the capture is taken.
- **Payoff:** – / ★ (review tooling). **Effort:** S. **Perf:** 0.
- **Files:** `viewer/src/main.ts` (frame clock), `viewer/src/post.ts`, `model/src/site/water.ts` (shader time),
  `viewer/src/leafCards.ts`.
- **Acceptance:** three consecutive `shots.mjs` runs of all poses give byte-identical JPEGs; 20 runs of poses 19, 21
  show no lighting flake; a test that the animated uniforms advance only through `skb.step` / the frame dt.
- **Done (2026-11-02, wave-6 review fix, look):**
  - **The flake at 21** was a stale shadow map: `updateInteriorBudget` toggled an interior's `inner` group (ceilings,
    the only shadow casters over the room, since the exterior's single-sided roofs drop out of the shadow pass)
    without marking the cached shadow dirty, so the room rendered with a map drawn without its ceiling (sunlit floor
    with tree shadows). `viewer/src/main.ts`: a visibility change sets `shadowDirty`; `placeCamera` now syncs the
    inside state (`syncInside(true)`), the interior budget and the shadow at once.
  - **Review clock** (`viewer/src/clock.ts`, pure): while test hooks drive the frames (`skb.step`, `goto`, `pose`,
    `tour`, `set`, `setMode`) the rAF loop draws and advances nothing, so the canvas keeps exactly the stepped frame;
    the first real input (pointer, key, wheel, touch) or `skb.tourPlay` hands frames back to the wall clock. The
    animation clocks (post `waterTime`, foliage `uFolTime`) advance only through `advanceClock(t, dt)` and restart
    when a pose is placed (`placeCamera`, `skb.set`/`setMode`, or a camera moved > 0.5 m between steps), so a pose
    renders the same frame whatever ran before it. The HUD line now follows `skb.step` (it used to update only in
    the rAF loop). Tests: `viewer/tests/look-review6.test.ts`.
  - **Measured:** 4 repeats in one page of 01, 03, 07, 16, 21, 33, 34 (re-posed each time) give byte-identical JPEGs,
    and 07 is byte-identical across two separate runs; earlier 5 repeats each of 19, 21, 03, 01 identical
    (`scratchpad/wave6-fix-look/rep`). Not run: three consecutive full 38-pose runs and 20 runs of 19 / 21.
- **Lead check (wave 7):** three consecutive full `shots.mjs --bench` runs of all 45 poses (`wave7-after`,
  `wave7-after-r2`, `wave7-after-r3`) gave byte-identical JPEGs at every pose, so that acceptance is now met. Not run:
  20 repeats of 19 / 21 (no flake in the 3 runs).

### KB-I65 · Sky and post cost at retina (eye level, interiors) and CPU per frame `[~] (uncommitted; wave 8: retina regression fixed)`
- **Why:** after wave 6 the aerial budget holds (≤ 7.3 ms at 3024×1964), but eye-level and interior poses got
  expensive at retina: 19 3.1 → 7.1, 33 3.2 → 8.0, 21 5.6 → 7.5–9.3, 34 9.7–10.1 ms (three runs, `wave6-after*`);
  pose 29 +2.6 ms median at retina in the architecture A/B (chimneypiece and stove). The vegetation A/B puts 5–6 ms of
  the 32 / 34 retina frame in the sky and clouds (32: 12.0 with sky vs 7.1 without; 34: 12.4 vs 6.6), as the wave-4
  note on pose 12 already found. CPU per frame rose +0.7…+1.4 ms at 1080p at every pose (post passes, card updates).
  [measured]
- **Payoff:** – / ★. **Effort:** M. **Perf:** −2…−5 ms retina at eye level.
- **Files:** `viewer/src/atmosphere.ts` (sky, clouds), `viewer/src/post.ts`, `viewer/src/leafCards.ts`.
- **Options:** cache the sky (and clouds) in a low-resolution cube or equirect refreshed on hour changes; a cheaper
  cloud fbm (octave early-out); per-pose A/B of AO and bloom at retina; skip the AO pass indoors where the room
  environment already darkens corners; update the card instance set only on camera moves > 1 m.
- **Acceptance:** same-session A/B, ≥ 3 repeats: 19, 21, 33, 34 ≤ 6 ms at 3024×1964 with Hoch, no aerial over 7.5 ms,
  pixel-equal or visually equal at 01, 03, 14; CPU per frame back within +0.5 ms of `wave5-final`.
- **Done in part (2026-11-02, wave-6 review fix, look):**
  - **Low-resolution sky** (`viewer/src/post.ts`): outdoors the sky mesh (sky and clouds) renders alone into a
    half-float target at `skyScale(px)` of the resolution per axis (0.5 up to 1.5 Mpx, 0.35 above), then the scene pass
    draws it through a proxy material that samples that target at the pixel (no extra MSAA pass, depth at the far
    plane). Off indoors and while a photo accumulates (full-resolution sky for stills). A/B: `skb.post.skyLowRes`.
  - **AO at native retina:** quarter resolution above 4.2 Mpx (`aoDivisor`), half below. **Indoor AO:** a fixed 0.35 m
    radius at strength 0.55 (`AO_INDOOR`): the soot band under the coves and the halos over the chair backs (06, 21)
    are gone.
  - **Same-session A/B, 3 repeats, min / median ms at 3024×1964 (loaded machine, load avg 20–50):** sky low-res vs
    full: 01 6.06 / 6.22 vs 6.75 / 7.17; 32 6.17 / 6.50 vs 8.38 / 9.55; 33 6.82 / 7.24 vs 7.12 / 8.67; 34 7.66 / 8.04
    vs 9.16 / 9.30 (second run 8.59 / 8.65 vs 9.92 / 11.64); 1080p within ±0.3 ms. Interiors (sky skipped): AO and
    bloom each ≤ 0.5 ms; the whole chain costs ≈ 1 ms at 1080p and ≈ 2 ms at retina at 21 (6.76 / 7.13 chain vs
    4.75 / 5.76 bypass). 19 measures 4.2–5.7 ms retina (noise between repeats exceeds the change).
  - **Open:** 21 at retina stays 7–9 ms (scene geometry: 1.56 M triangles, 1,394 calls), 33 / 34 ≈ 7 ms; CPU per
    frame unchanged (scene traversal dominates, 21 / 06 ≈ 6 ms). Note: the bench draws native 3024×1964 at DPR 1;
    in the app, Hoch caps the DPR at 1.5 (2268×1473 on that screen, 2× MSAA, half-res AO); that size was not benched.
- **Wave 7 (look, 2026-11-02):** (1) room point lights are drawn only when they burn (`roomLightOn`: nearest room,
  visitor inside, intensity > 0); six candelabra at 0 cd by day had cost ≈ 3–4 ms at retina at 21. (2) Interior draw
  modes (`interiorMode`, `viewer/src/interiorView.ts` `applyInteriorMode`): 'full' only for a visitor inside or within
  6 m of a neighbour; 'shell' from outside within `INTERIOR_DIST` (floor, wall, reveal, ceiling, door and stair parts
  of storeys ≤ 1, so open portals still show their vestibule); walk colliders stay invisible. (3) Sky cube cache
  (`post.ts`): a 1024² half-float cube, one face per frame, refreshed when the sky uniforms change (signature to 5
  significant digits); for small changes the old cube stays while the refresh runs, after a jump the per-frame sky is
  used until the cube is complete; ≈ 48 MB GPU memory; A/B `skb.post.skyCache = false`. Tests
  `viewer/tests/indoor.test.ts`, `viewer/tests/skyCube.test.ts` (4).
- **Lead check (`wave7-after` ×3, min / median ms, load 22–37; before = `wave6-final`, another session):** retina 19
  4.2 / 5.1, 21 4.1 / 4.6, 33 5.0 / 5.5 (≤ 6 ✓), **34 6.4 / 6.5 (✗, target 6)**; aerials 01 6.8 / 6.8, 02 4.9, 08 6.8 /
  7.0, 12 5.2 / 5.3, 13 4.6 / 4.7, 43 7.0 / 7.1 (≤ 7.5 ✓). Calls at 03 / 09 / 14 1557 → 653. CPU at 1080p (min) against
  `wave5-final`: 03 2.7 vs 5.4, 09 2.8 vs 5.3, 14 3.0 vs 5.6, 21 3.2 vs 5.3, 33 2.6 vs 2.9, 34 2.4 vs 2.3, 19 2.7 vs 2.6,
  01 2.8 vs 3.1: within +0.5 ms everywhere ✓. Visual: 01 0.37, 03 1.43, 14 1.67/255 against `wave6-final`; the 03 / 14
  differences are the mapped windows (KB-I42), the portal views match, so "visually equal" holds. The implementer's
  note that 33's shrubs look blobby against `wave6-final` does not reproduce (33: 0.04/255). The sky-cube A/B is the
  implementer's (retina min, cube vs per-frame: 01 6.17 vs 6.80, 08 7.92 vs 9.83). **Open:** 34 at retina (vegetation,
  2.7 M triangles), then done.
- **Wave 8 (look, 2026-11-02): retina regression.** After wave 7 the aerials measured 15–25 ms at retina (01 17–20, 08
  15–22, 12 18–24, 43 19–26). Bisect: hiding only the 147 `glass.crown` meshes (a few hundred pixels at pose 12)
  restored 6–8 ms; a constant-colour glass fragment shader did not, a plain material did. Cause: the KB-I42 room
  attributes were `flat varying`; ANGLE's Metal backend emulates GL's last-vertex provoking convention for programs
  with flat varyings by rewriting each draw's index buffer, ≈ 10 ms per frame for the glass draws. Fix: plain
  varyings (the values are constant per window; packed integers are rounded on decode; `glass-inside.test.ts` forbids
  `flat`). Same-session A/B (4 repeats, min / median, retina): 12 17.4 / 21.0 → 6.2 / 7.8, 01 9.9 / 19.3 → 8.3 / 9.9,
  08 14.6 / 21.8 → 8.3 / 10.6. After the fix (with KB-I50, load ≈ 15): 01 7.7 / 8.1, 08 7.8 / 8.5, 12 6.1 / 6.6,
  26 5.9 / 6.0, 34 6.6 / 6.8, 43 8.0 / 8.6 at retina; 1080p 4.5–6.5. The wave-7 bisect had pinned pose 34 on the leaf
  cards (11.5 vs 17.5 ms), measured with this regression in the frame; 34 is now 6.8 ms. **Open:** 34 and the aerials
  just above their 6 / 7.5 ms targets on a loaded machine; rule for shaders: no `flat` qualifiers (ANGLE/Metal).
- **Lead check (wave 8, `wave8-after` ×3, min / median ms at 3024×1964, load 14–17):** 19 5.7 / 6.0, 21 4.7 / 5.3,
  33 5.6 / 6.0 (≤ 6 ✓), **34 6.2 / 6.6 (✗, target 6)**; aerials 01 7.2 / 7.7, 02 5.7 / 6.0, 08 7.4 / 7.8, 12 5.8 /
  6.1, 13 5.7 / 5.9, 43 7.4 / 7.7, 52 7.3 / 7.6 (≤ 7.5 by the minima; 01 / 08 / 43 / 52 just above by the medians).
  The ≤ 12 ms aerial budget holds at every pose (worst median 7.9 ms, 48). CPU per frame at 1080p (min) is lower than
  `wave7-final` at every pose (e.g. 01 4.2 → 2.9, 03 4.0 → 2.7, 21 3.8 → 3.5 ms). Visual: interiors 06–29 are within
  0.05/255 of `wave7-final` (unchanged), so the plain varyings did not alter the mapped rooms. Still partial (34, the
  aerial 7.5 ms medians).
- **Wave 9 (look):** pose 34 not re-tuned: the look owner's session ran at ≈ 3× the `wave8-final` times. In the
  lead's `wave9-after` (three runs, load 19–39) 34 reads 4.5 / 4.6 ms at 1080p and 6.7 / 6.7 ms at retina (target
  ≤ 6.5), with the new grass blades in the frame (KB-I78). Every pose is ≤ 7.8 ms at retina (median); the aerials 01 /
  08 7.4 / 7.5 ms. Still partial.

### KB-I66 · Forest crowns at 150–300 m and conifer whorls `[x] (uncommitted)`
- **Why:** the wave-6 leaf cards fade out by 220 m, so at 150–300 m (aerials 01, 08, the Rundflug Anflug and Goldene
  Stunde) the mid and close forest crowns still read as faceted polyhedra; the conifer whorls (34, right edge) still
  look like stacked plates (vegetation report, lead check) [measured].
- **Payoff:** – / ★★. **Effort:** M. **Perf:** ≤ +0.5 ms at 1080p.
- **Files:** `viewer/src/forest.ts`, `viewer/src/foliage.ts`, `viewer/src/crownForm.ts`, `model/src/site/trees.ts`.
- **Options:** a silhouette-breaking normal or alpha-edge term on the mid crown (no `discard`, see KB-I44), cards on the
  close tier out to 300 m at lower density, a drooping-branch conifer form [N habit].
- **Acceptance:** 01, 08 and the tour frames `anflug` / `goldene-stunde`: no visible polyhedral facets on crowns
  nearer than 300 m; 34: conifers read as spruce or fir; ≤ +0.5 ms at 1080p same-session.
- **Done (wave-6 review fix, vegetation, 2026-11-02):**
  - Mid tile crowns: `unitDome(11, s, MID_DOME)` (88 tris, was a 4-clump dome of 80); far crowns `unitDome(7, 97,
    FAR_DOME)` (28 tris, was 20). New `DomeOptions {rings, lumps, lump, jitter}` in `trees.ts`: low-frequency lumps
    (fading to the pole, which stays on top) break the regular polygon outline [I]. Far trunk stubs thicker
    (`FAR_TRUNK` 1.8) and casting shadows; solitary trees' far crowns in their own shadow-casting mesh
    (`forest/<key>/impostors-solitary`), so distant crowns no longer float.
  - Close tier out to 300 m (`CLOSE_DIST` 250 → 300) with cards to `FOREST_CARD_FAR` 300 (was 220); the close tier per
    variant takes only the nearest `FOREST_CARD_CAP.close` (400) crowns, so every close crown carries cards (close
    64 cards of 0.44, hero 300 of 0.27). Forest shell darkening follows `FOL_SHELL_FAR`.
  - `foliage.ts`: a coarse "leaf mass" noise (about a third of the crown radius) on mid / far crowns at 120–420 m
    only (not on cards; beyond ~400 m it cost ~0.5 ms on the aerials for nothing visible).
  - Conifer (`'tiered'`, `CONIFER_FORM` [N Picea / Abies habit; I numbers]): open inner cone, 9 whorls of 5–7 flat,
    drooping sprays narrowing to a leader (~1.1 k tris at detail 2) instead of stacked balls.
  - Tests: `model/tests/trees-kb-i66.test.ts` (cone narrowing, whorl / spray counts, lumpy dome envelope, pole and
    determinism), `viewer/tests/crown.test.ts` (far ≤ 28, mid ≤ 88 tris), `viewer/tests/leafCards.test.ts`
    (`FOREST_CARD_FAR ≥ CLOSE_DIST`).
  - Shots (scratchpad `wave6-fix-vegetation/final`, compare with `wave6-after` / `wave5-final`): t1, t8, 01, 08, 12,
    13, 26 show no hexagonal plates on crowns within 300 m; 34 and close-ups c1 / c2 read as spruce.
  - Bench (A = wave-6 original forest / foliage / leafCards, B = this fix, same session, min ms 1080p / retina, load
    15–45, noisy): t1 4.68 → 5.29 (final card setting 5.05 → 5.56; retina 6.2 → 7.4), t8 4.64 → 5.29 (final 5.28
    → 4.84), 01 4.64 → 4.72, 08 4.31 → 4.56, 12 4.05 → 4.25, 34 4.38 → 4.44, 35 2.90 → 3.14. So ≈ +0.1–0.6 ms at
    1080p (t1 at the +0.5 limit), retina +0–1.2 ms; aerial retina stays ≤ 8 ms.
  - **Residuals:** at 150–300 m the mid domes read as soft lumpy "broccoli" masses rather than leafy, and a few
    outlines are still slightly polygonal; the step from carded close crowns to mid domes is visible at the 400-crown
    cap in dense forest (t1 left half).
- **Wave 7 (garden, 2026-11-02): residual mid crowns.** Mid crown tiles, far impostors and far solitary trees use
  `vegetation.leaf.mid` (define `FOL_MID`): three octaves of anti-aliased leaf-mass noise in crown-envelope space,
  active from 30–60 m and faded out at 320–460 m, with gap darkening and a surface-gradient bump. A silhouette fringe of
  leaf cards (`FOREST_FRINGE`: 40 cards of 0.5 m, gone by 460 m) shares the crown instance buffers and opens only where
  the anchor normal runs across the view ray, beyond 40–70 m. Crowns beyond 320 m stay smooth domes. A/B:
  `skb.foliage.uFolMid.value = 0`, `skb.forest.setFringe(false)`. Tests `viewer/tests/forest-mid.test.ts` (3).
- **Lead check:** pairs `docs/shots/KB-I66/` (01 with a 1:1 forest crop, 08, 12): the crowns of the near forest block
  are dappled and leafy instead of soft domes, 12's forest edge is leafier and the far forest is unchanged. Same-session
  A/B (lead, both switches off vs on, 3 alternating repeats, load 29–37, min / median ms): 01 1080p 4.49 / 4.55 →
  4.38 / 4.66, retina 6.83 / 6.84 → 6.95 / 7.02; 08 4.33 / 4.40 → 4.35 / 4.62, retina 6.22 / 6.53 → 6.16 / 6.80; 12
  4.13 / 4.15 → 4.27 / 4.27, retina 5.26 / 5.37 → 5.31 / 5.33. So ≤ +0.25 ms at 1080p (budget +0.5 ✓); 12 +0.2 M
  triangles (fringe). **Residuals (Discovered):** at 01 the step from dappled crowns to the smooth domes beyond ≈ 320 m
  reads as a band, and a large solitary crown at the left edge is still a faceted dome; at 13 the fringe cards show as
  detached dark specks just outside the outline of mid solitary crowns.
- **Wave 8 (garden, 2026-11-02, the wave-7 "band at ≈ 320 m"):** `foliage.ts`: the mid-crown relief fades over
  360–640 m instead of 320–460 m, and beyond its fade the relief's mean albedo and occlusion stay (`folMidW`, mean
  gk 0.54; the blotch term keeps its mean 0.87), so the dappled crowns no longer step to lighter smooth domes. 08 and
  01 (`docs/shots/KB-I66/after-wave8-…`): the band is much reduced, the far forest a little darker overall.
  Same-session A/B `skb.foliage.uFolMid` 1 vs 0 (3 + 3 runs, load 20–22), 1080p min / median: 01 6.1 / 6.4 vs
  5.9 / 6.4; 08 6.1 / 6.1 vs 6.3 / 6.5; 11 5.5 / 5.6 vs 5.7 / 5.7 ms; retina 01 12.3 / 18.6 vs 11.2 / 16.1, 08
  14.5 / 16.0 vs 16.7 / 17.9 (noise ±50 %). The whole relief costs ≤ 0.2 ms at 1080p, so its extension does too.
- **Lead check (wave 8):** 01, 08 (`docs/shots/KB-I66/*-wave8-01-…`, `*-wave8-08-…`): the light band of smooth
  domes beyond ≈ 320 m is gone; the far forest reads slightly darker and continuous. Done.

### KB-I67 · Menagerie setting: terrace ground, beech wood, island pavilion as hypothesis `[x] (uncommitted)`
- **Why:** pose 36 shows the KL-B43 terrace rows on a large bare brown apron, open meadow round the ring and a hedge
  belt N of it, while T1 p. 383 places the menagerie "in Buchenwald" [D]; the island building in the KL-B40 moat
  (KL-B41, PAV, low confidence) reads as a finished pavilion although only its foundations and spiral stair are
  documented (T20) [D; U superstructure].
- **Payoff:** ★ / ★. **Effort:** S. **Perf:** 0.
- **Files:** `scripts/catalogue-v2/terrain.ts` / `landcover.ts` (ground and land cover at TF-37 / TF-38),
  `scripts/catalogue-v2/buildings.ts` (KL-B41: foundation and stair as the default, the pavilion as a documented
  alternative), `scripts/prepare-terrain.py`.
- **Acceptance:** 36: terrace ground as beaten earth or grass under a beech stand with the runs left clear; KL-B41
  shows no invented superstructure by default; history-check unchanged; shots 36 and 12.
- **Done (wave-6 review fix, architecture, 2026-11-02):** TF-38 surface "meadow under the beeches between the rows (I);
  the runs trampled (drawn by KL-B43)" (`prepare-terrain.py` paints `meadow` as grass, keeps the rows out of the
  garden smoothing and keeps the LiDAR ≈ 1 m terrace steps); new clump **TF-39** "Buchen der Menagerie-Terrassen"
  (82 old beeches between and round the rows, ≥ 4.5 m from the watercourse, the NW side open; low) and land cover
  **LC-17** "Buchenwald um die Menagerie-Terrassen" (forest, beech 0.7 / oak 0.2 / hornbeam 0.1, ≈ 4.6 ha, low)
  [D T1 p. 383 "in Buchenwald"; extent, positions I]. KL-B41 is now cls GARD, "Insel im Amphitheater mit den
  Fundamenten des Inselpavillons und Wendeltreppe", `menagerie.kind 'island'` (10 m quay over the foundation course +
  spiral stair, med) [D T20]; the superstructure moved to NEW **KL-B41a** "Inselpavillon der Menagerie – Aufbau
  (Hypothese)" (`placement: 'hypothetical'`, low, `open_pavilion`: slender posts and a beam under a slate pavilion
  roof), so the "Hypothesen" switch hides it [U form]. KL-B40 ring yards closed behind the houses, the 20 radial
  grilles run in to the water (`ring.moat_radius` 22 m). Pose 38 appended (terraces from the watercourse, 11 m).
  Shots `wave6-fix-architecture/36`, `/38`; history-check 0 OPEN, 0 integrity failures.
- **Decision:** the island superstructure is a separate hypothetical building (KL-B41a), not an option on KL-B41,
  so the documented quay/stair stay visible when hypotheses are hidden; terraces without a level keep their LiDAR
  steps (no flattening) and the menagerie's slope ground is meadow under beech, not an apron.

### KB-I68 · Barrière at the valley entrance and the court-mouth post-and-rail fence `[x] (uncommitted; wave 8, garden)`
- **Why:** PV legend 1 "deux petites maisons … pour le corps de garde et la barrière" places a barrier between the
  guard houses KB-B63 / KB-B64 at the valley entrance (LP06 37) [D existence; N/I form]; Le Clerc 1790 draws a
  post-and-rail fence in front of the court-mouth guard houses (research/11 §1.5) [D]. The ≈ 100 km Wildzaun has no
  located line and stays unbuilt (KB-I40, wave-7 garden report).
- **Payoff:** ★ / ★. **Effort:** S. **Perf:** 0.
- **Files:** `model/src/spec.ts`, `model/src/validate.ts` (a `fence` TerrainFeature kind, e.g. `{type: 'barriere' |
  'post_rail', height}`), `scripts/catalogue-v2/terrain.ts`, `model/src/site/`, `docs/architecture.md`.
- **Acceptance:** low confidence with tags; the barrier only between KB-B63 / KB-B64, the post-and-rail line only as
  far as Le Clerc draws it; pure helper + test; one eye-level shot (append a pose).
- **Done (wave 8, garden, 2026-11-02):** new TerrainFeature kind `fence` with `fence_line{type: 'post_rail' |
  'barriere', height, post_spacing?, rails?, tag?}` (`spec.ts`, `validate.ts`: a fence needs `fence_line` and a
  LineString, a barrière exactly 2 points; `docs/architecture.md` §4.1). Pure `model/src/site/fence.ts`
  (`postRailLayout`: posts every ≤ 2.6 m, evenly divided, 2 rails, small deterministic lean and sag;
  `barriereLayout`: a 7 m beam centred on the gap on a pivot post with a 1.5 m counterweight heel, a forked rest post,
  rails closing the rest of the gap clear of the swing) with norms in `grammar.ts FENCE` [N; I sizes]. Catalogue:
  `KB-F1` post-and-rail 1.15 m between KB-B38 and KB-B37 (only as far as Le Clerc draws it), `KB-F2` barrière between
  KB-B64 and KB-B63 (PV 1791 l. 1), both low with tags; plus `KB-V1`, a 12 m sand/gravel forecourt between the
  Ehrenhof grille and the guard houses (Le Clerc "bare forecourt"; the audit found hay up to the court mouth). Built by
  `site/features.ts` in the timber door material (`#6F6455`), the beam in the sentry-box blue and white; timber, so
  not in the stone-only explorer export. Test `model/tests/fence.test.ts` (8). Poses 46 (barrière, eye level) and 47
  (fence and forecourt from the W field, 17:30) appended: `docs/shots/KB-I68/after-wave8-46-…`, `…-47-…`; both read
  clearly (striped beam with counterweight and side rails; two-rail fence between the houses).
- **Lead check (wave 8):** 46 and 47 (`docs/shots/KB-I68/after-wave8-46-…`, `…-47-…`, refreshed from `wave8-after`):
  as described; the barrière spans only the KB-B63 / 64 gap and the rails only KB-B37 / 38 (test). Bench 46 1080p
  4.1 / 4.2, retina 5.3 / 5.5; 47 4.8 / 4.9, 5.7 / 5.9 ms. Done.
- **Wave 9 (garden, 2026-11-02): KB-V1 forecourt.** `prepare-terrain.py` applies a normalised Gaussian low-pass
  (σ 4 m) to the free ground of `forecourt` paths, kept 2 m off the footprints and blended over 3 m [I].
- **Lead check (wave 9):** the 1789 DTM along KB-V1 changed by ≤ 0.35 m (mean 0.19 m, against the garden owner's
  pre-change copy) and now rises monotonously 342.3 → 342.9 m toward the court. At 47 the two steep sand humps at the
  ends of the court-mouth wall remain (343.4 m at the guard houses, then a 2.0–2.3 m vertical step to the Ehrenhof at
  344.8 m along E ≈ 382 187; Discovered).
- **Wave-9 review fix (garden, 2026-11-02): court mouth.** The carriage approach is now possible: catalogue `KB-V2`
  "Auffahrt zum Ehrenhofgitter (Rampe mit Wangenmauern)", an 8 m gravel drive on the court axis from the W field up to
  the central grille, 344.8 → 340.55 m over 43.2 m (**9.8 %**), with 0.8 m flank walls and a 0.4 m parapet that slope
  with it while it stands > 0.9 m on fill (grammar `DRIVE`; tag LP06 29 Hauptzufahrt, research/07 §3.2; D-> LiDAR 2025
  axis ramp ≈ 8–9 %; N ramps ≤ 1:10, research/09 §5). The terrace wall opens across its top (`access.ts` `driveCuts`,
  a minimal additive edit in an unowned file), the KB-F1 post-and-rail stops at its walls (`clipOutsideDrives`).
  `KB-V1` is now a 12 m forecourt strip along the TF-03 W wall foot, levelled to one robust least-squares plane
  (hump cells dropped, slope clamped to 4 %, blended over 6 m): "KB-V1 forecourt plane: 561 cells, slope 4.0 %, max fill
  0.98, max cut −2.55"; "KB-V2 drive 43.2 m at 9.8 %, fill up to 2.01 m, foot vs ground −0.14 m". New pure
  `model/src/site/drive.ts` (`isDrive` needs top / foot / width **and** `wall_height`, so the terrace stair TF-35 is no
  drive; `isForecourt`, `isDrapedWay`, `driveWalls`, `driveCuts`, `clipOutsideDrives`), `prepare-terrain.py`
  `is_drive` / `is_forecourt`. **Grade 9.8 %, not < 8 %:** the guard houses KB-B37 / 38 stand at ≈ 342.0–342.3 m only
  ≈ 9 m off the court at 344.8 m and the field falls ≈ 5.5 % W; < 8 % needs a ≈ 75 m causeway through the field
  (rejected); raising the guard-house bases (architecture, `buildings.ts`) would allow it. Both ways are draped gravel
  ribbons (the drive on its graded plane) and are **not painted into `ground.u8`**: painting them moved hinterland
  hedgerows at 39 (a seeded stream along the LC-20 edge), now 39–41 are pixel-identical to `wave9-after` (planner
  outputs checked identical: forest, open trees, hay cocks, hinterland). Test `model/tests/drive.test.ts` (6). Shots
  `…/scratchpad/wave9-fix-garden/final/`: 47 (a gravel drive rising between the guard houses to the gate), 26, 03, 14, `tour-ehrenhof-0.25.jpg` (the
  Rundflug now reads a walled ramp, no humps). Bench 47 1080p 5.4, retina 7.5 ms.

### KB-I69 · Water SSR comb stripes `[x] (uncommitted; wave-7 review fix, look)`
- **Why:** the screen-space reflections (KB-I37) mirror bank trees and buildings as horizontal comb stripes: the
  Karlsbergweiher at pose 39 (`docs/shots/KB-I37/after-wave7-39-…`), the pond in 40, and the wave-6 custom view
  [measured]. Likely the ripple normal sampled per march step, or a step-quantised hit (look and garden reports).
- **Payoff:** – / ★★. **Effort:** S. **Perf:** ≤ +0.2 ms.
- **Files:** `viewer/src/post.ts` (SSR march), `model/src/materials/index.ts` (`WATER_RIPPLE_GLSL`, water patch).
- **Acceptance:** 39, 16 and 40 show continuous reflections without comb lines (the ripple distortion stays); shots
  stay deterministic (KB-I64); same-session A/B ≤ +0.2 ms at 39.
- **Done (wave-7 review fix, look, 2026-11-02):** the stripes came mainly from the ripple normal at mid distance (with
  the ripple off the mirror was clean) plus the geometric march steps. `post.ts waterReflect` now marches in screen
  space (DDA after McGuire & Mara 2014) to the old reach (`marchReach`), clipped to the near plane and the screen
  edge, perspective-correct depth, interleaved-gradient-noise start jitter (deterministic per pixel) and 5 bisection
  steps; the hit is blurred over 3 vertical taps. The ripple is filtered by its pixel footprint: `skbRippleLod(p, t,
  fp)` in `WATER_RIPPLE_GLSL` fades each wave once it is smaller than ~5–12 px (`fwidth` in the water patch, the
  view-space footprint in the SSR). 39 shows continuous reflections of the trees and the Monopteros with mild ripple
  distortion (`wave7-fix-look/39-…`, `c39g.jpg`); 16 likewise. Same-session A/B at 39 (4 alternations, 30 frames, load
  ≈ 28): new 1080p min 2.70 / med 3.84 ms vs old 2.98 / 4.33; retina min 5.40 / med 11.79 vs 4.77 / 13.89 → within
  noise; at 01 new min 5.25 / 6.35 vs old 5.92 / 11.9 ms. Not mine: the faceted W bank at 39 comes from
  `scripts/prepare-terrain.py` (garden).

### KB-I70 · Tempelzimmer from inside: see-through glass doors, closed openings `[x] (uncommitted; architecture part in wave 8)`
- **Why:** after KB-I60 pose 19 is legible, but (a) the rotunda's glazed doors are box glass (`exterior/rotunda.ts`,
  `orientedBox` with faces on both sides), so `glassPatch`'s outside test always fires and they read as dark proxy panes
  from inside; (b) the flat door leaves leave gaps to the curved openings, with the garden visible beside them; (c) the
  "Granitsaal" walls read grey-mauve and the bench is a two-colour box [measured, `docs/shots/KB-I60/after-19-…`].
- **Payoff:** ★ / ★★. **Effort:** S. **Perf:** 0.
- **Files:** `model/src/exterior/rotunda.ts` (one outward-facing glass plane per leaf, as the facade windows; optionally
  `aWin` / `aRoom` by the `night.ts` convention), `model/src/interior/` or the shell finish for the faux granite [D 1789
  "Granitsaal"; N colour].
- **Acceptance:** 19 shows the garden through the doors and no gaps at the reveals; 18 unchanged from outside apart
  from the doors (mean |Δ| ≤ 1/255); a test that rotunda glass is single-sided and outward-facing.
- **Look part (wave-7 review fix, 2026-11-02):** instead of changing the rotunda geometry, `night.ts` flags box glass
  (panes thinner than 0.7 m) per vertex: faces whose normal points toward the building origin get `aWin.z = −2`, and
  `glassPatch` never treats them as outside (`step(-1.5, vWin.z)`). From inside, 19 now shows the garden and the
  Orangerie through the doors; 18 from outside is unchanged by the flag (mean |Δ| 0.01/255). The shell exposure lift
  gained a base of 0.3 EV (`SHELL_LIFT_BASE_EV`, `indoor.ts`): KB-B07 1.05 EV (was 0.75), wall mean at 19 102 → 116
  [I]. Tests `glass-inside.test.ts`, `indoor.test.ts`.
- **Open (architecture):** the grey-mauve "Granitsaal" walls (room finish), the flat door leaves against the curved
  openings (`exterior/rotunda.ts`) and the two-colour box bench (KB-I26 furniture kit).
- **Done (wave 8, architecture, 2026-11-02):** `exterior/rotunda.ts`: straight `reveal` / `revealCap` helpers and a
  `glazedDoor()` at the full clear width, so the glazed double doors fill the curved openings; one outward-facing glass
  plane per leaf (12 vertices at LOD1 / LOD2, normal · radial > 0.95). The "Granitsaal" walls in painted faux granite:
  new material `wall.granite` (`model/src/materials/granite.ts`: shader flecks on the face UVs, sin-free hash, fading
  to the mean colour with distance; shares `GRANITE.shares`) [D T5 "Granit von Papier", R12 "Granitsaal"; colours and
  grain N; shares I]. A curved Louis-seize banquette in the niche bays. Tests in `wave8.architecture.test.ts`.
- **Lead check (wave 8):** 19 (`docs/shots/KB-I70/before-19-…`, `after-19-…`): speckled grey stone walls, the doors
  fill the openings with the garden and the Orangerie behind, a white-and-gilt banquette with a crimson seat instead
  of the two-colour box. 18 from outside: mean |Δ| 2.66/255 against `wave7-final`, but nearly all of it is the wave-8
  lawn, rods and B02 forecourt pad; the architecture owner's isolated A/B gives 0.29/255 (the door glass now reads as
  slightly darker proxy glass). Bench 19 1080p 5.6 → 3.6 / 3.7, retina 4.9 → 5.7 / 6.0 ms. Done.

### KB-I71 · Setting of the wave-7 follies and the V23 terrain items `[x] (uncommitted; residuals in wave 8)`
- **Why:** KL-B50…53, KB-B89, KB-B90 and KB-B91 stand on bare meadow without paths, clearings or planting (43, 44, 45)
  [measured]; V23 also names the Felsenpfad, a Sammelbecken and the Vogeltränke (UP-23 is a placeholder) (10 §b.6) [D→;
  U positions]. Requested by the architecture owner in wave 7.
- **Payoff:** ★ / ★★. **Effort:** M. **Perf:** ~0.
- **Files:** `scripts/catalogue-v2/terrain.ts` / `landcover.ts`, `scripts/prepare-terrain.py` (pads), `model/src/site/`.
- **Acceptance:** hypothetical, low confidence, the same ±50–100 m note as the follies; paths as N / I only; 43, 44,
  45 re-shot; the translucent-mode aerial that KB-I30 still owes.
- **Wave-7 review fix (garden, 2026-11-02):** pure `model/src/site/follyWalks.ts` (`serpentineWalk`: one bend per ~35 m,
  ≤ 7 m off the line, Chaikin-rounded, bends swing away from footprints; `blocked`, `walkLength`) [N "serpentine
  walks", research/11 §4.4; I geometry]. `scripts/catalogue-v2/terrain.ts` `follySettings()` adds, all `placement:
  'hypothetical'`, low, with the ±50–100 m V23 note: walks KL-W1 (TF-35 → volière front → amphitheatre W rim, 2 m),
  KL-W2 (→ tent KL-B51), KL-W3 (1.6 m track → hay wagon KL-B52), KL-W4 (rondell TF-36 → Chinese pavilion KL-B50),
  KB-W5 (dam crest TF-22 + spur → Monopteros KB-B89), KB-W6 (Apfelallee TF-14 → Bienenhaus KB-B90, round KB-B12),
  KB-W7 (2.5 m cart track TF-10 → Wassermaschine KB-B91; the Teuchel line is assumed along it, not drawn); gravel
  `#B79A84` as the other garden walks. Shrub backdrops KL-C1 (volière), KL-C2 (tent), KL-C3 (pavilion), KB-C4
  (Monopteros), KB-C5 (Hoflinde and shrubs at KB-B91); KB-L1 lawn apron (r 11 m) round the Monopteros; KB-WB1 well
  (kind `well`, an exported stone node) N of KB-B91. `prepare-terrain.py` `on_meadow()`: the hay wagon gets no
  building pad (it stands in the meadow). Catalogue 116 buildings / 77 terrain features, validation 0 / 0; test
  `model/tests/folly-setting.test.ts` (11); the HG clump tests in `garden.test.ts` / `garden-wave2.test.ts` are scoped
  to `HG-*`. Shots scratchpad `wave7-fix-garden/` 43, 44, 45, 13: walks link TF-35, volière, tent, amphitheatre and
  hay wagon (no pad); the pavilion and the temple stand on a walk with a shrub mass behind; the lawn apron is subtle.
  Side effect: the hinterland hedgerows draw from one sequential random stream, so the new walks shift hedge-tree
  positions nearby; at 43 a hedge tree now stands 14 m in front of the camera (bottom centre). KB-B91 itself was not
  moved (architecture owns it); it reads only as a small house with a tree at 13. **Open:** Felsenpfad, Sammelbecken,
  Vogeltränke (no located source), the translucent-mode aerial; KB-I68 fences are not part of this fix.
- **Wave 8 (garden, 2026-11-02):** `KB-W8` Felsenpfad (V23 no. 3 "Felsenpfad mit Inschrift", D→ ±50–100 m): a 1.6 m
  hypothetical walk along the S shore of the Karlsbergweiher, 6–9 m off the water, from the S end of the W dam (where
  KB-W5 starts) to the pond's E end; the inscribed rock and its text are U and not drawn (no item kind, no text
  source). Not drawn, with reason: the **Sammelbecken** (V23 no. 27; research/10 asks for it only "if the LiDAR shows
  one"; KL-05…07 are the three Schwanenweiher ponds, no separate basin) and the **Vogeltränke** (V23 no. 19; a zone
  without a form, UP-23 stays a placeholder). Pose 48 is the KB-I30 translucent-mode aerial over the W end of the
  Karlsbergweiher (Monopteros, Dammweg KB-W5, Felsenpfad KB-W8; `docs/shots/KB-I71/after-wave8-48-…`); it is last in
  the list and leaves `lowConfidence: 'translucent'` set. Test added to `folly-setting.test.ts`. Wells (audit #8):
  `case 'well'` now draws a low-confidence well (the TF-42 pits, KB-WB1) as a flush kerb with a stone cover instead of
  a 0.8 m red ring, and a med one (TF-41) as a Buntsandstein well-head with a grey coping and a dark shaft.
- **Lead check (wave 8):** 48 (`docs/shots/KB-I71/after-wave8-48-…`): the Felsenpfad runs along the S shore as a
  pale pink-brown walk; the low-confidence buildings are ghosted. 39 (`*-wave8-39-…`): the path shows on the left
  slope, but **the large solitary tree on the S bank in the left foreground is gone** (and at 41 the tree beside the
  pond moved), most likely through the new walk's keep-off (KB-W8 runs there), against the wave-5 rule that new
  hypothetical features must not reshuffle trees at the standard poses (Discovered). The pond outline is still a straight-edged
  rectangle from the air (48) → KB-I77. Bench 48 1080p 3.4 / 3.5, retina 5.7 / 7.9 ms. Done (tree note open).
- **Wave-8 review fix (garden, 2026-11-02):** the review found the trees at 39 / 40 / 41 moved and the Felsenpfad a
  raked gravel walk. **Cause** (verified with the terrain regenerated without KB-W8 and a planner diff): the walk was
  painted into the ground classes (44 meadow cells → gravel), so `openTreePlan` dropped one walnut field tree on the
  S bank (juglans, local x 901.0 / z −842.1) and the per-tile random stream of `Forest.buildTile` then gave the other
  trees of that tile new crown variants ("moved"). Changes:
  - `scripts/catalogue-v2/terrain.ts`: KB-W8 is re-drawn (no longer by `walk()`) as a Chaikin curve through contour
    control points (≈ 278 m, 3–8 m above / off the water, ≥ 8 m N of the walnut), 1.4 m wide, surface "trodden earth
    (Buntsandstein), rock outcrops", low / hypothetical; tag: V23 no. 3 D→, Sckell footpaths 0.9–1.6 m (research/11
    §4.4) N, the Karlslust boulder facing (research/11 §1.4 D) for the outcrops, the inscribed rock U.
  - `scripts/prepare-terrain.py`: `paint_features` skips paths whose surface is "trodden earth" (a footpath in the
    meadow is not a ground class), so **no tree planner sees the walk**: rule for later hypothetical footpaths. The
    regenerated ground differs from the KB-W8-free one only by the KB-L2 lawn (78 cells, KB-I45); DTM identical.
  - New pure `model/src/site/rockPath.ts` (`isTroddenPath`, `smoothNoise1`, `pathWidthFactor`, `outcropPlan`,
    `outcropShape`) and `site/features.ts`: a trodden path is a soft earth ribbon (feathered 0.8 m verge, width
    breathing 0.7–1.2 ×, `earthWalkMaterial` tinted `#8F7766`, patchy alpha) with low Buntsandstein outcrops
    (`feature/KB-W8/outcrops`, `stone.red` `#A88A7A`, low / hypothetical): a ledge of 1.6–3.4 × 0.9–1.7 m, 0.4–0.9 m
    proud, every ~22 m, mostly uphill, with 1–3 smaller blocks of the same bed, smooth-shaded, half sunk; none in the
    water [N landscape-garden rockwork; I sizes].
  - Tests: `viewer/tests/felsenpfad-trees.test.ts` (catalogue facts; with the generated terrain: no gravel cell along
    the walk and the planners' trees within 30 m equal the frozen pre-walk list, none on the walk),
    `model/tests/rock-path.test.ts` (6: determinism, width range, outcrops clear of the path and mostly uphill,
    `avoid`, closed outward-wound shape).
  - Shots (scratchpad `wave8-fix-garden/final`; `docs/shots/KB-I71/wave8fix-39-…`, `wave8fix-48-…`): the S-bank walnut
    and the trees at 39 / 40 / 41 stand where they stood in `wave7-final`; 48 shows a narrow red-brown trodden path
    along the contour past the walnut with small stone groups; 39 shows it on the left slope. Same-session A/B (KB-W8
    objects hidden vs shown, 3 + 3 runs, min / median): 48 1080p 3.50 / 3.52 → 3.53 / 3.53, retina 8.53 / 8.56 →
    8.81 / 8.87; 39 1080p 2.85 / 2.88 → 2.91 / 2.93, retina 5.36 / 5.40 → 5.53 / 5.59 ms. Light layer 4.34 MB. Done.
- **Wave 9 (garden, 2026-11-02):** KB-W8 gets a narrower, breathing tread with loose Buntsandstein stones along both
  edges (`rockPath.ts` `EDGE_STONES`, `edgeStonePlan`; `features.ts` material `ROCK_PATH_LOOSE` `#B6A292`, earth
  `#A08A78`, soft verge 0.55 m, tuft breakup) [N; I]. Edge-stone case in `model/tests/rock-path.test.ts`.
- **Lead check (wave 9):** 39 (`docs/shots/KB-I71/*-wave9-39-crop-path.jpg`) and 48: small stones along the path
  edges; the width change is hard to see at these distances. The outcrops and edge stones are `stone.red`, so the
  light layer carries a node `site:KB-W8` (2,040 triangles; new against the wave-8 lead export). Trees at 39 / 40 / 41 unchanged. Done.

### KB-I72 · CdL emphasis: court portal frame, N-wing porch, Festsaal garden balcony `[x] (uncommitted; portal frame in wave 8, the rest in the wave-8 review fix)`
- **Why:** the wave-8 visual audit (rank 3) found the CdL centre under-accented: a plain court portal, no N-wing
  (KB-B03) court porch or wing-centre balconies (the architecture owner reads both in Le Clerc 1790 / the Pleine vue),
  no continuous garden balcony for the three Festsaal portes-fenêtres. Cite the exact sheet (research/10) for each
  element before building it; forms N / I.
- **Payoff:** ★★ / ★★. **Effort:** M. **Perf:** +0.1 ms.
- **Files:** `model/src/exterior/facade.ts`, `model/src/layout/grammar.ts` (`PORTAL_FRAME`), the catalogue (porch,
  balcony as portal / portico entries), `plans/src/sheets/ansicht.ts` (AN-01 / AN-02).
- **Acceptance:** porch and balcony from catalogue entries with tags (no invented dimensions without I); AN-01 and
  AN-02 draw the portal frame, porch and balcony so plans and 3D agree; shots 03, 04, 14.
- **Done in part (wave 8, architecture, 2026-11-02):** a sandstone pilaster-and-entablature frame round the CdL court
  portal at LOD1+ (`PORTAL_FRAME`, drawn in `furnishOpening` for a `portal` without a portico; stone `#BFAEA5`,
  keystone) [N; I sizes]; it clears the neighbouring EG windows and stays below the Beletage sill (≈ 351.7 vs 351.97 m;
  test). Lead check: 14 (`docs/shots/KB-I72/before-14-…-crop-portal`, `after-…`) and 03: a pink sandstone frame marks
  the centre. **Open:** N-wing porch and balconies, the Festsaal garden balcony, a wider perron (the present one is 10
  steps, ≈ 4.3 m deep, with cheek walls and the sentry boxes), AN-01 / AN-02 (the plans do not draw the frame yet).
- **Wave-8 review fix (architecture, 2026-11-02):** the review read the perron as a 3-step red stair hemmed in by the
  sentry boxes and found the porch, the balconies and the plans missing. Changes:
  - **Perron:** `MAIN_PERRON` + pure `freitreppePlan()` (`layout/facade.ts`, shared by the exterior, `courtPlan` and the
    sheets): the 10 steps of D LC 1790 (D-> 1.4 m Sockel) now run 5.15 m wide (the PORTAL_FRAME + 0.9 m each side),
    3.48 m deep (0.6 m landing, 0.32 m treads), with stepped cheek walls and foot pedestals in the grey-pink portal
    sandstone and a pale nosing on each red step so the rhythm reads from the court [N Blondel / d'Argenville; I sizes].
    The cellar windows behind it are dropped. The CdL sentry pair now flanks the stair foot
    (`site/courtPlan.ts`, outside my listed files: a two-line placement change plus `openingClearance` via
    `freitreppePlan`).
  - **N-wing porch:** `PortalSpec.portico` on the KB-B03 court Durchfahrt (`PASSAGE_PORTICO`, `passagePortico()`): four
    Tuscan columns in pairs on pedestals either side of the carriage passage, an entablature and an iron-railed balcony
    deck at the Beletage floor, reached through two portes-fenêtres without balconets [D LC 1790 "columned porch in the
    N wing centre" + D PL "balcony in each wing centre" (research/07 §1.1); placed on the Durchfahrt = the court face's
    centre I; sizes N/I; low]. Its sentry pair stands at the porch front.
  - **Balconies:** new `PortalSpec.balcony_run` (`BALCONY`, `balconyRun()`): one sandstone slab on consoles with a
    wrought-iron railing across all doors of an entry. Festsaal garden balcony across the three portes-fenêtres (1.2 m;
    I 05 §e.1) and the S-wing court centre balcony over the Durchfahrt (1.0 m; D PL symmetrised, low).
  - **Plans:** `elevation.ts` `portalExtrasElev` draws the portal frame, the porch and the balcony runs, and `stepsElev`
    the broad perron with cheeks and pedestals (AN-01 shows the frame and perron, AN-02 the Festsaal balcony);
    `grundriss.ts` draws the perron from the same numbers (from the risalit face), the porch columns and the balconies
    (dashed, labelled). Regenerated: AN-01, AN-02, GR-01, -02, -05, -06, -08, -09. The porch's side view in AN-01 is
    not drawn (the N-wing court face is end-on there).
  - Tests: `model/tests/wave8.architecture.test.ts` (perron size, sills and cellar windows; sentries at the foot; one
    Festsaal run without balconets; porch deck = Beletage floor, clear of the neighbouring windows; S-wing run; the
    elevation draws all of them; LOD1/2 build). Shots `wave8-fix-architecture` 03, 04, 09, 14 (crops in
    `docs/shots/KB-I72/wave8fix-*`). Bench (one run after vs `wave8-after`, same machine, not interleaved): 03 / 14
    1080p 4.9 → 4.6 / 4.7 ms, retina 5.9 → 5.7 / 5.6 ms, +1.1 k triangles, −2 calls: within noise. Light layer
    4.34 MB (verify.sh export). Not done: the HMS junction-portico awning and the porch's 1789 iron pattern (U).
- **Wave 9 (architecture, audit-3 rest, 2026-11-02):** `MAIN_PERRON.beyondFrame` 0.9 → 1.92 m, so the 10-step
  flight passes the neighbouring EG windows and spans the three centre axes (7.2 m flight, ≈ 8 m with the cheeks; cheeks
  and pedestals on the next piers; still 3.48 m deep) [D LC 1790 steps; N Blondel / d'Argenville; I sizes]. New
  `MAIN_PERRON.stoneTreads`: treads in the grey-pink portal sandstone `#BFAEA5` with paler nosings `#D5CBC6` over the
  risers [I]. The cheek walls drop the cellar windows behind them; the sentry pair moves out with `freitreppePlan`.
  No balcony or entablature over the CdL court portal (no evidence in research/06, 07, 10; the LC portico and balcony
  belong to the B02 head). Plans regenerated: AN-01, AN-02, GR-01, GR-02, SC-01. Test
  `model/tests/wave9.architecture.test.ts`.
- **Lead check (wave 9):** 14 (`docs/shots/KB-I72/*-wave9-14-…`, crops `wave9-14-crop-perron-…`, `wave9-03-…`): a broad
  pale stair across the centre bays with a visible step rhythm. In shade (03) the grey-pink treads contrast less with
  the plinth than the red did; the flat 0.5 m centre risalit stays the weak point (Discovered). At 16 / 17 a striped
  sentry box now shows through the open garden door on the axis. Light layer: KB-B01 12,663 → 13,039 triangles. Done.
- **Wave-9 review fix (architecture, 2026-11-02):** the review found the perron D-tagged on Le Clerc although
  research/07 §1.1 gives LC's broad 10–12-step Freitreppe to the KB-B02 head pavilion, and the only CdL depiction (HMS,
  research/06 §3.3) is a short straight stair of ≈ 5 steps between the sentry boxes; the three-axis width had no source.
  Changes: `MAIN_PERRON.beyondFrame` 1.92 → 0.9 m (5.15 m flight, ≈ 6 m with the cheeks, as in the wave-8 fix; 10 steps,
  3.48 m deep); `MAIN_PERRON.tag` and the KB-B01 portal tag (`scripts/catalogue-v2/programme.ts`, catalogue rebuilt)
  now read "10 steps D-> (1.4 m Sockel / 0.145); stair HMS short straight ~5 steps between sentries (secondary, step
  count conflicts); width N Blondel; sizes I; low" (no LC). Steps: each is a riser block in the portal sandstone at
  `MAIN_PERRON.riser` 0.68 albedo standing on the step below, plus a `#BFAEA5` tread slab and the pale nosing; baked
  `AO.stepCorner` 0.55 at the riser foot and the tread back edge [I render], so the 0.14 m rhythm reads in shade (03),
  golden hour (09) and dusk (10). Sentries: new pure `perronSentryAlong()` snaps the foot pair to the pier centres
  beside the cheek pedestals (±3.975 m on the CdL, between the ±2.65 / ±5.30 m windows; before ±4.97 m, in front of the
  ±5.30 m windows); at 10 the right box no longer covers the lit window. The portal lanterns' pool still lights the top
  steps at 10 (top tread ≈ 1.7× the luminance of the lower ones; the pool is additive, so it reads less warm on grey
  stone than on the old red). Plans regenerated: AN-01, AN-02, GR-01, GR-02, SC-01. Tests
  `model/tests/wave9.architecture.test.ts` (width = frame + 0.9 m, no LC tag, sentries on the piers and clear of every
  EG window, `perronSentryAlong` unit cases, riser/tread/nosing luminance order). Shots
  `scratchpad/wave9-fix-architecture` 03, 09, 10, 14, 26, 47 (47 unchanged). Bench 03 / 14: GPU 1080p 4.7 / 4.8 ms,
  retina 5.7 / 5.8 ms (= wave9-after), +1 call (the riser tint), +≈ 100 triangles. Light layer 4.32 MB.

### KB-I73 · Vineyard far parcel reads as a dark decal from the air `[x] (uncommitted; wave-8 review fix)`
- **Why:** at 01, 02, 08, 41, 48 and 52 the LP06 30 vineyard beyond the 3D tier is a flat dark-olive quadrilateral with
  hard straight edges, darker than any field around it; the look owner first took it for a shadow artefact (it stays
  with both shadow maps off). The wave-8 far-lightening (220–480 m) barely shows because the aerial cameras see the
  parcel at 150–300 m [measured, `docs/shots/KB-I35/*-wave8-01-…-crop-parcel`].
- **Payoff:** – / ★★. **Effort:** S. **Perf:** ~0.
- **Files:** `viewer/src/terrain.ts` (vineyard far colour), `viewer/src/landcoverBake.ts`, `viewer/src/vines.ts`.
- **Acceptance:** from 01 / 08 the parcel reads as a planted field of rows (row texture or mid-tone stripes at the
  pixel scale, soft parcel edge), with its mean luminance within ±10 % of the neighbouring hay and meadow; 40 / 41
  hand-over unchanged; ≤ +0.2 ms.
- **Done (wave-8 review fix, garden, 2026-11-02):** the darkness was the 3D plants' canopy tint (`vineCanopy`) applied
  to the whole painted parcel beyond the 3D range, not lighting (A/B with `uShowClasses` 0: the parcel turns meadow
  luminance). `viewer/src/terrain.ts` (splat cache key `terrain-splat-9`):
  - far rows: where the analytic rows fade (0.1–0.5 rows per pixel, camD < 900 m) a box-filtered stripe (the leaf
    walls' share of each pixel, `DUTY` 0.58, same 1.1 m pitch and phase as the rows and the 3D stakes) over the soil,
    normalised to the area mean so it adds texture, not darkness [D PV "red-brown vine rows"; I];
  - the canopy tint × 0.7 and only up to the middle of the plants' fade band; from there to 40 m beyond the 3D range
    it cross-fades to the far look (sunlit leaf tops and dry hoed soil: mean × 1.46 toward 30 % soil) [I];
  - soft parcel edge: a ~2 m feather ≈ 2 m inside the boundary with ±1.2 m wobble beyond the 3D range.
  `viewer/src/landcoverBake.ts`: hoed row groups 45 % leaf, lush ones 68 %. The reviewer's 1.2–1.5 m pitch was not
  adopted: the grammar's 1.1 m keeps the painted rows in phase with the 3D stakes.
  Measured (linear luminance, scratchpad `wave8-fix-garden/final2`): 01 parcel 0.150 → 0.263 against meadow 0.29
  (ratio 0.51 → 0.91, rgb 150 / 140 / 98, red-brown); 08 0.44 → 0.80 (the meadow there is half in shade); 41 far
  parcel 0.295 against hay 0.270 (+9 %), the band past the 3D plants 0.257; 11 no dark band past the plants; 52
  dark quadrilateral gone. 40 / 41 hand-over: the 3D plants and their ground under them unchanged. Shots
  `docs/shots/KB-I73/wave8fix-01-…`, `…-01-crop-parcel-before-after.png`, `…-11-…`, `…-41-…`. Same-session A/B
  (far stripes + meadow regrowth disabled by a temporary edit vs on, 3 + 3 runs, min / median): 41 1080p 4.95 / 5.01
  → 5.14 / 5.20, retina 7.14 / 7.15 → 7.76 / 7.83; 48 1080p 3.41 / 3.45 → 3.57 / 3.58, retina 7.14 / 8.12 → 8.72 /
  8.88 ms: ≤ +0.2 ms at 1080p for both blocks together. Done; KB-I35 keeps only its budget note at 40.

### KB-I74 · Low-sun warmth and sky fill (golden hour, both looks) `[x] (uncommitted; wave-8 review fix)`
- **Why:** wave-8 visual audit rank 6 (low-sun warmth). The look owner's intended direction: ≈ 3000–3500 K at 6° sun
  elevation and less sky fill at low sun, in both looks, plus the haze toward the sun. Not done in wave 8.
- **Payoff:** – / ★★. **Effort:** S-M. **Perf:** 0.
- **Files:** `viewer/src/light.ts` (`SUN_K`), `viewer/src/atmosphere.ts` (sky fill, haze toward the sun).
- **Acceptance:** same-session before / after at 08, 09, 14 (low sun) in both looks; 01 / 03 at 10:30 within
  1/255; Dokumentation stays a calibration, not a grade (KB-I06 decisions).

- **Done (wave-8 review fix, look, 2026-11-02):** all in `viewer/src/light.ts` (pure, tested) and the wiring in
  `atmosphere.ts`, both looks, uniforms only (0 ms by construction):
  - `SUN_K`: 3100 K at 5°, 3300 K at 8°, 3500 K at 10°, 3800 K at 14° (was 3400 / 3700 / 3900 / 3940) [I]; 20° up unchanged.
  - `lowSunSkyFill(el)`: the env + SH sky fill × 0.72 at 4–10°, ramping back to 1 by 20° and by −1° (twilight). Kino
    keeps its own deeper fill where lower (`min(kinoLowSun.fill, …)`). The exposure meter and the white balance keep
    the full sky. `KEY_STOPS` opens 0.12 EV at 6–10° (0.05 at 14°) to keep the grazing-lit court from going brown;
    `SKY_VIEW_EV_TABLE` lowered by the same amount, so the sky on screen stays.
  - Shade colour: `SKY_K` 18 000 K at 4°, 16 500 K at 8° (was 15 000), and `skyGreenTrim(el)` 0.88 at ≤ 4°, 0.9 at 12°,
    `SKY_GREEN_TRIM` 0.97 from 22°: the golden-hour shade on the court sand goes lilac-grey instead of grey-green.
  - `lowSunHazeWarm(el)`: the sun-side horizon haze moves 40 % toward the sun colour (same luminance) at 1–10°, gone by
    20°; the anti-solar side keeps the cool earth-shadow blend.
  - Tests: `viewer/tests/light.test.ts` "KB-I74 …" (Kelvin band, fill limits, haze limits, lilac shade / warm sunlit
    sand at 5–8°, 22° trim unchanged).
- **Lead check:** same-session A/B on two private no-HMR servers (old `light.ts` vs new; `…/scratchpad/wave8-fix-look/
  ab-old`, `ab-new`, crops `crop-d09.jpg`, `crop-k09-kino.jpg`, `crop-t6c-…`). 01, 03, 15: pixel-identical (max diff
  0); 14 / k14 / Rundflug 'ehrenhof': mean diff < 0.1 (noise). 09 Doku: court shade `#61625D` (h 73, grey-green) →
  `#545255` (h 280, lilac-grey); court in sun `#6E6559` → `#675851` (h 34 → 18, warmer); the sunlit S wing turns
  salmon-cream (`#C5A799` → `#CDA28F`); 0.07 % of pixels ≥ 250 (was 0.05 %), no clipped whites. 09 Kino: sunlit sand
  `#847259` → `#8B7462`, shade `#6A6759` (h 49) → `#6F6A64` (h 31). 08 and the Rundflug 'goldene-stunde' (18:45) read a
  little warmer and brighter (mean R +4–5). Bench (single run, load ≈ 16): 08 1080p 5.4, retina 7.4; 09 4.7 / 5.6 ms.
  **Not met:** the court sand in sun at 09 is warm but still a dim mid-tone (a 6° sun on a horizontal court gives
  ≈ 1.6 klx), not a "glow"; no low-sun pose looks into the sun, so the warm forward haze is verified numerically only.
- **Wave 9 (look, 2026-11-02):** re-checked in fresh shots of 08, 09, 14, 17 (Doku), k08 / k09 / k14 (Kino) and the
  Rundflug 'goldene-stunde' at 0.5: the low sun reads warm in both looks (salmon-cream S wing, warm sunlit sand,
  lilac-grey shade), Kino warmer and more saturated; no change made. The "Not met" above stands.

### KB-I75 · Interior whites and mirror reflections `[x] (uncommitted; wave 9)`
- **Why:** wave-8 visual audit rank 5 (interior whites, mirror reflections). Not done in wave 8 (the look owner's time
  went to the retina regression and KB-I50); re-shoot 06, 21, 27, 29 to pin the faults before changing anything.
- **Payoff:** – / ★★. **Effort:** M. **Perf:** ≤ +0.3 ms indoors.
- **Files:** `viewer/src/indoor.ts`, `viewer/src/post.ts`, `model/src/interior/materials.ts` (look-owned shading only).
- **Acceptance:** findings written per pose first; then before / after at 06, 21, 27, 29; interiors stay ≤ 6 ms at
  3024×1964.

- **Findings (wave 9, before):** at 06, 20–24, 27–29 the windows, the court beyond them and the reveals clipped to
  white (0.05–1.71 % of pixels with min channel ≥ 250), the ceiling and boiserie read cool white, and every pier glass
  or trumeau showed the model's soft vertex-colour image of its room (a beige smear at 21, 23, 24, 27, 29).
- **Done (wave 9, look, 2026-11-02):**
  - Window pull (`viewer/src/interiorGrade.ts` `windowTransmittance`, `model/src/materials/index.ts` `glassView`):
    seen from inside, the view through a pane is dimmed to `WINDOW_VIEW_EV` = 1 EV above the room's adapted exposure
    (at most 4 EV); 1 outdoors and whenever the outside is not brighter (dusk, night) [I, interior photography].
  - Indoor highlight shoulder (`INDOOR_TONE` knee 0.5, s 0.12, `uIndoorTone` in the post grade before the tone
    mapping, weight `indoor · (1 − night)`): sun pools and reveals keep texture and the gilt its hue [I].
  - Parquet bounce (`warmRoomGrid`, `PARQUET_BOUNCE_SHARE` 0.2 of waxed oak `#9B7448`, luminance kept): the day room
    environment's floor rows warm the walls and the ceiling to ivory (`atmosphere.ts` `warmRoomEnvironment`).
  - Room mirrors (`viewer/src/mirrors.ts`, pure `mirrorsMath.ts`): one static 512² half-float mipmapped cube per room,
    captured one face per frame from just in front of the room's largest glass after 10 settled frames, and again only
    when the light key (room, hour to 0.05 h, look, celebration) changes; the room's glasses then read it box-projected
    (parallax-corrected) at mip 1 (wavy plate glass) × the amalgam tint (≈ 70 %, faintly green) [I]. Mirrors of other
    rooms keep the model's image. `skb.mirrors` (`enabled`, `captures`) for A/B.
  - Tests: `viewer/tests/interiorGrade.test.ts`, `viewer/tests/mirrors.test.ts`.
- **Lead check:** shots `…/scratchpad/w9look/it5/` (stats `w9look/stats.py`). Clipped pixels 0.00 % at 06, 20, 21, 22,
  23, 24, 27, 28, 29; frame means −3…−9 levels; ceiling at 23 (197,189,176) → (200,188,174); windows show the court
  facades and sky; reveals ≈ 224 instead of 246–251; the pier glasses at 23 show the chandelier and chairs, the
  trumeau at 21 the bookcases and windows, 27 / 29 the opposite walls. Outdoor frames are unchanged by construction
  (pull, shoulder and mirrors are gated on `inside`; the env is the indoor one). Night 07 mean diff 0.79 (mirrors by
  candle light).
- **Not met / not verified:** GPU cost. The machine ran at load 7–13 with every pose ≈ 3× its `wave8-final` time
  (01 at 1080p 16.5 ms vs 5.7), so the A/B (mirrors on / off, 3–6 repeats) is inside the noise: 23 on 9.2 / 13.2 ms
  vs off 12.2 / 13.4 (min / median), 06 on 11.1 / 13.2 vs off 9.9 / 12.4. A steady room renders no cube (by design;
  `captures` stays constant); a capture adds 5–6 frames each with one 512² scene render (best case 23: 2.96 ms vs
  2.04 baseline, ≈ +0.9 ms on those frames only). Retina ≤ 6 ms for interiors not re-measured on an idle machine.
- **Lead check (wave 9, `wave9-after`, three runs, load 19–39):** `docs/shots/KB-I75/` (06, 21, 23, 28). Clipped pixels
  (min channel ≥ 250, frame without the footer) 0.05–1.73 % → 0.00 % at 06, 20–25, 28, 29 (27 0.00 → 0.00). Pier
  glasses show the room (23: chairs and chandelier; 21: the bookcases), windows the court. Floors unchanged (mean
  parquet colour at 06 / 21 / 23 / 27 within 1 level). Steady-state cost with the mirrors on: 1080p 06 2.5 → 2.5,
  21 2.8 → 2.8, 23 2.0 → 2.0, 27 2.6 → 2.5, 29 2.5 → 2.5 ms (min); retina min / median 06 3.6 / 3.7, 21 4.1 / 4.1, 23
  4.6 / 5.2, 27 3.6 / 3.9, 28 5.7 / 5.8, 29 3.6 / 3.7 ms: **interiors ≤ 6 ms at 3024×1964** in this session. The
  capture frames (≈ +0.9 ms on 5–6 frames after a room change) were not benched. 07 (night) is within 0.01 / 255 of
  `wave8-final` in this run. Done.
- **Review fix (wave 9, look; CPU per frame):** the review saw fhd `cpuMs` rise 0.1–0.4 ms at most poses and 0.8–1.1 ms
  at 27 / 28 / 29 in `wave9-after` against single-run `wave8-final` numbers. Same-session interleaved A/B (private
  no-HMR vite, load 25–30, 3 × 40 frames per cell, four cells: all on / `skb.mirrors.enabled` off / window pull and
  shoulder off (`skb.windowPull.enabled`, `skb.post.indoorShoulder`, new A/B switches) / all off), fhd CPU min / median:
  06 4.06 / 4.22 on vs 4.26 / 4.35 all off, 07 3.63 / 4.01 vs 3.88 / 3.97, 27 3.31 / 3.59 vs 3.56 / 3.69, 28 2.32 /
  2.49 vs 2.48 / 2.51, 29 3.69 / 3.76 vs 3.72 / 3.93, exteriors 03 3.33 / 3.44 vs 3.49 / 3.56, 14 3.41 / 3.60 vs 3.55 /
  3.69 ms; an earlier run gave the same picture (every on / off pair within ±0.15 ms, no direction). A CPU profile of
  400 frames at 29 (100 µs sampling) gives `frame()` 3.79 ms with all on and 3.81 ms with all off: ≈ 97 % is three's
  `render` (≈ 900 draw calls, the same counts as wave 8), the viewer's own per-frame JS is ≈ 0.1 ms and `mirrors.update`
  does not register (< 2 µs). So the KB-I75 features cost no measurable CPU in steady state; the interior rise is
  not theirs (the wave-8 runs alone spread 2.95–3.30 ms at 27 and 3.20–3.72 at 29; no wave-8 code snapshot exists for
  a code A/B). What did cost CPU are the capture frames: +1.5…3.5 ms on each of the 6 frames (06 / 29, 3 repeats), and
  a dragged hour slider restarted a capture every 0.05 h. Changes: (a) `mirrorsMath.SettleGate`: a capture starts only
  after the room **and** light key held `MIRROR_SETTLE_FRAMES` (10) frames, so dragging the hour captures nothing (40
  dragged frames: 0 faces, then 6 once it rests; the glasses keep the last cube meanwhile); (b) with the camera
  standing still the room lookup is skipped (steady state O(1); a room built later or a detached one still re-checks);
  (c) outdoors `main.ts` no longer builds the mirror key string (O(1), no allocation). Env binding was already O(1):
  the room environments are static textures swapped only when `inside` flips, and `glassView` is one shared uniform.
  Shots `…/scratchpad/wave9-fix-look/` (03, 06, 07, 14, 19–25, 27–29): interiors pixel-identical to `wave9-after`
  (mean |Δ| 0.00–0.01), 03 / 14 0.10 / 0.24 from other owners' concurrent court-mouth work. Bench in that run: retina 22
  4.3 / 4.9 / 6.8, 28 5.6 / 5.7 / 5.7, 29 3.9 / 4.2 / 6.8 ms (three runs, load ≈ 27): min ≤ 5.6 ms. Tests
  `viewer/tests/mirrors.test.ts` "capture debounce". Lead checks should report fhd `cpuMs` next to the GPU times
  (shots.mjs already prints it in the table's CPU column).

### KB-I76 · Leaf scale on leaf cards and forest crowns `[x] (uncommitted; wave 9)`
- **Why:** wave-8 visual audit rank 9 (leaf scale on the leaf cards and forest crowns). Not done in wave 8: the files
  belong to the garden owner, and the look owner passed it on.
- **Payoff:** – / ★★. **Effort:** S-M. **Perf:** ~0.
- **Files:** `viewer/src/leafCards.ts`, `viewer/src/leafAtlas.ts`, `viewer/src/forest.ts`.
- **Acceptance:** before / after at 33, 34, 50; no new shimmer; re-measure 34 at retina (6.2 / 6.6 ms, target 6)
  with the cards on and off (the wave-7 card cost was measured with the `flat`-varying regression in the frame).
- **Done (wave 9, garden, 2026-11-02):** fine sprays (`fineBroadleafSpray`, `fineNeedleSpray`, `rasterFineLeafAtlas`)
  beside the coarse tiles in one 2048 × 1024 atlas (`combinedLeafAtlas`); cards ≥ `FINE_CARD.minSize` 0.9 m within
  ≈ 32 m (±25 % per card, dithered) take the fine tiles, so near leaves read 6–11 cm instead of hand-sized
  (`viewer/src/leafAtlas.ts`, `leafCards.ts`, `foliage.ts`; A/B `skb.foliage.uCardFine.value.x = 1e9`). Test
  `viewer/tests/leafAtlasFine.test.ts` (3). Same-session A/B (5 repeats, min / median, 1080p): 16 4.38 / 4.43 vs
  4.29 / 4.36, 33 4.56 / 4.61 vs 4.57 / 4.66, 38 5.71 / 5.73 vs 5.63 / 5.67 (retina 6.86 / 6.87 vs 6.77 / 6.82): ≤ +0.09
  ms. Forest crowns beyond the card range unchanged.
- **Lead check (wave 9):** `docs/shots/KB-I76/` (38 full and `crop-near-tree`, 50). At 38 the near lime's leaves are
  about a third of their former size and read as foliage; a few coarse sprays remain at the crown edge. 50: the
  crowns round the pavilion read finer. No shimmer is visible in stills (motion not checked). 34 at retina: 6.3 →
  6.7 / 6.7 ms (min / median), above the 6 ms target of KB-I65, with the grass blades in the frame; the fine tiles
  themselves cost ≤ 0.1 ms. Done.

### KB-I77 · Pond shores: smoothed outline, depth fade, banks `[x] (uncommitted; wave 9)`
- **Why:** the Karlsbergweiher reads as a straight-edged rectangle from the air (48, 41) and its W bank is a steep cut
  with visible terrain triangles (39); wave-8 audit #7, skipped by the garden owner because the water mesh is shared
  with the look's SSR [measured].
- **Payoff:** ★ / ★★. **Effort:** M. **Perf:** ≤ +0.2 ms.
- **Files:** `scripts/prepare-terrain.py` (pond banks), the water mesh in `model/src/site/` and `viewer/src/post.ts`
  (SSR), `docs/architecture.md` (a short water-mesh contract first).
- **Acceptance:** a written water-mesh contract (outline, level, bank profile) agreed by garden and look; 39, 41, 48
  show a rounded shore with a shallow-water fade; KB-I69 reflections unchanged at 39; no reeds without a source
  (decision KB-I37).
- **Done (wave 9, garden, 2026-11-02):** `prepare-terrain.py` `natural_pond` / `shore_field` / `natural_shores` grade
  every natural pond (a water level, no coping, not a Bassin): a seeded, smoothed shoreline wandering up to 3.5 m off
  the catalogue polygon, a shallow shelf, a grass bank clamped to 5–50 % slope blended over 8 m, and the TF-21 island
  raised from a smoothed signed distance field [I]. New pure `model/src/site/shore.ts` lays the water on the terrain's
  own 1 m vertices (k + 0.5, same diagonal), so the terrain contour is the shore, with a vertex-colour tint over the
  shallows; `site/features.ts` uses it for natural ponds, formal basins keep the plane and wet bank. The water-mesh
  contract is in `docs/architecture.md` (`shore.ts`): a grid mesh `feature/<id>`, a `water` material clone with
  `vertexColors`, the alpha-0 `waterPatch` SSR marker kept. The bake shows bank grass on water-class cells above the
  level; the wet band is dropped on natural shores (it drew the grid's zigzag). Test `model/tests/shore.test.ts` (4).
  Same-session shore-water A/B (5 repeats, min / median): 39 1080p 3.04 / 3.20 vs 2.98 / 3.02, retina 7.22 / 7.50 vs
  6.05 / 6.29; 45 1080p 2.67 / 2.78 vs 2.59 / 2.76; 48 1080p 3.42 / 3.49 vs 3.28 / 3.40, retina 4.80 / 5.15 vs 4.30 /
  4.70 ms.
- **Lead check (wave 9):** `docs/shots/KB-I77/` (39 full and `crop-shore`, 48, 45). 39: the cut W bank with terrain
  triangles is gone; a grassy bank runs into the water with a pale shallow rim, and the TF-21 island shows as a low
  grass lens (bare). 48: rounded corners and a wavy long edge instead of a ruler line; the overall plan still reads
  as an elongated rectangle (the catalogue outline). 45: the straight bank is a soft curve. SSR: the bank reflections
  still work; at 39 the reflected bank shows a stepped edge of a few pixels near the inlet (Discovered, look). 1080p
  39 2.9 → 2.8 / 3.0, 48 3.5 → 3.4 / 3.4 ms; retina 39 6.7 / 7.4 (with the blades), 48 7.3 → 4.9 / 5.0 ms (the
  9.4 ms in the garden owner's full run was contention). Done.
- **Wave-9 review fix (garden, 2026-11-02): shores.** (a) `shore.ts`: every water vertex carries its unclamped depth
  (`depths`, attribute `aDepth`); the water fades in over the first `SHORE.fade` 0.3 m per fragment (`shoreFade`). On
  the terrain's own triangulation the interpolated depth is the true depth, so the fade is 0 on the waterline and the
  1 m grid can no longer step the edge (45). The shore material is drawn with custom blending (colour SrcAlpha /
  1 − SrcAlpha, alpha 0 / 1 − SrcAlpha), so the scene alpha is dst · (1 − fade) and the SSR marker holds where the
  water is nearly opaque (`docs/architecture.md` water contract). (b) `prepare-terrain.py` `SHORE_ISLAND_*`: the TF-21
  island bank runs through the waterline at 1:4 on its smoothed SDF, rising from the pond floor over ≤ 5 m and easing
  toward the catalogue level (profile W→E: −1.0 … +0.68 m … −0.36 m), so the terrain, not a water lip, meets the water
  (39: no dark under-lip or pale gap). (c) **Decision (Karlsbergweiher outline):** the straight W edge is the dam TF-22
  (KB-42, D LiDAR: crest ≈ 277 m, 2.3 m drop downstream); the long N / S edges are the catalogue outline KB-40 (the
  2025 water surface, ≈ 130 × 46 m) and agree with LP06 32's "larger, geometric" pond (D LP06; formal basin I, low,
  research/11 §1.4; research/03 §4.4); the wandering shore is the I generator rule on top, not evidence. So the rounded rectangle from the
  air (48) is intended. Test `shore.test.ts` (+1). Shots `…/scratchpad/wave9-fix-garden/final/` 39, 45, 48. Same-session A/B fade vs no fade (retina,
  min): 39 7.47 / 7.05, 45 6.62 / 6.66, 48 8.98 / 8.66 ms (≤ +0.4). 48 measured 9.4 ms retina in this run and in the
  single `wave9-after` run (9.12), but 4.9–5.0 in `wave9-after-r2/r3`: bimodal headless timing, not this change.
  The stepped edge of the reflected bank at 39 is the SSR's (look; not changed).

### KB-I78 · Lawn and meadow blades: finer, denser lawn, no disc edge, retina cost `[ ]`
- **Why:** wave-9 lead check. The grass blades (KB-I45, wave 9) make the meadow at 46 / 47 read as grass, but on the
  scythed lawn (04, 16, 33) they read as scattered dark speckles in a regular grain at 1:1, the disc's start shows as
  a band at 39 (fly mode), and they carry the wave's largest retina rise (+0.6…+1.6 ms; 33 7.2, 39 7.4, 47 7.5 ms
  median at 3024×1964, cap 8) [measured, `docs/shots/KB-I45/*-wave9-16-crop-lawn-blades.jpg`].
- **Payoff:** – / ★★. **Effort:** S-M. **Perf:** −0.5…−1 ms retina at eye level.
- **Files:** `viewer/src/grassBlades.ts` (atlas, density, fade), grammar `GRASS_SWARD`.
- **Acceptance:** a lawn tuft contrast close to the ground's own grain (no dark speckles at 1:1 at 04 / 16 / 33), a
  disc edge invisible at 39 and 45, meadow look at 46 / 47 kept; retina ≤ +0.5 ms against blades off at 16, 33, 39,
  47 (same-session A/B); fewer blades or a lower resolution path at retina if needed.
- **Wave-9 review fix (garden, 2026-11-02):** lawn tile nearly flat (`LAWN_SHADE` 0.97–0.985) and normalised edge
  shading (partly covered texels no longer fade to black: that dark fringe was the speckle), lawn colour ±`lawnJitter`
  4 % around the ground's albedo, lawn cards half as wide (`GRASS_SWARD.lawn.card` 1.7), lawn tufts only within
  `GRASS.lawnRadius` 10 m (they add nothing visible farther out); the disc edge dissolves per pixel over the outer
  `GRASS.feather` 7 m (interleaved-gradient noise, no flat varying); meadow tile unchanged (46: mean |Δ| 0.18 / 255).
  Pose 16 lawn band (rows 700–1000) high-pass std 5.93 (`wave9-after`) → 2.62 (blades off 2.69), mean colour within
  0.3 levels of blades-off. Same-session interleaved A/B on a private no-HMR preview (4 × 2 cells, min / median, blades
  on vs off): retina 16 5.03 / 5.11 vs 4.73 / 4.77 (+0.30), 33 5.99 / 6.04 vs 5.67 / 5.72 (+0.32), 47 7.49 / 7.61 vs
  7.09 / 7.21 (+0.40), **39 7.89 / 8.29 vs 6.23 / 6.48 (+1.66)**; 1080p ≤ +0.14. 39 (meadow from 1.7 m) misses the
  +0.5 gate. Measured cause: an alpha-tested card defeats the tile GPU's hidden-surface removal: the same cards drawn
  opaque cost 5.54 vs 6.16 ms *without* blades; shadows (off: −0.1), draw order (near first: ±0) and card width barely
  matter, fewer mid-field tufts (`uGDense` 2: +0.55) read as sparse fat clumps (rejected). Open: a cheaper meadow path
  (cards cut to the tuft silhouette, or opaque blade geometry), visual-wow. Tests `grassBlades.test.ts` (+1).

### KB-I79 · End-side orientation audit for rotated `axisRect` buildings `[ ]`
- **Why:** wave-9 architecture review fix (KB-I32): on `axisRect(…, 90, …)` footprints the s axis points W, so
  `end_a` is the E side; KB-B28 had its door and windows behind the apse because the catalogue and its test assumed
  the opposite. Other buildings built with a rotated `axisRect` may carry the same mix-up (doors or windows on the wrong
  end) [measured on KB-B28].
- **Payoff:** ★ / ★. **Effort:** S. **Perf:** 0.
- **Files:** `scripts/catalogue-v2/buildings.ts` (read only first), a test that prints each rotated building's sides
  in E/N.
- **Acceptance:** a list of every `axisRect` with rotation ≠ 0 and the compass side of `end_a` / `end_b` / `long_*`,
  checked against the entries' descriptions and sources; fixes only where the description or a source names the side;
  `verify.sh catalogue` reproduces after the deliberate rebuild; plans regenerated where a side changed.

---

## Discovered (append here; give each a new id when promoted)

- 2026-11-02: `shots.mjs` 01-aerial-west is byte-identical to `docs/visual-audit/01-aerial-west.jpg`, so headless
  renders are deterministic and byte comparisons can prove "no visual change" for refactors.

- 2026-11-02 (wave 1): two model sessions worked at once. The model implementer's report said KB-I02 and KB-I15
  were "skipped" and KB-I03 "partial, no tests". The files on disk show all three done: catalogue regenerated,
  `epoch.test.ts` and `palette.test.ts` present, history-check H01/H02/H10/H11/H13/H14/H15/H19 DONE. The `render.member`
  build break the report mentions is resolved (tsc passes). The verdicts in this backlog follow the files on disk,
  checked by `verify.sh` and history-check, not the reports.
- 2026-11-02 (wave 1, light): the low-sun shade is too dark. Grey-card sun:shade ratio is 12.0 at 17:30 and 19.7 at
  19:00, against targets of 2–3 and 1–1.5. Candidates: more sky lux at 10–25° elevation, a brighter court and ground
  bounce, or a cheap one-bounce term. This is the open part of KB-I06.
- 2026-11-02 (wave 1, light): at 10:30 the shade and distant forest have a teal or cyan tint, and the sky is a very
  saturated deep blue (shots 01, 02, 03, 05, 12). Check against the visual-audit "no cyan cast" criterion when
  KB-I55 changes the diffuse sky. Wave 2 desaturated the sky only at 15–28° sun (14, 15); 10:30 is unchanged (03
  samples identical).
- 2026-11-02 (wave 1, interiors): in the Festsaal by day (06), the ceiling reads dark brown-grey and the sunlit wall
  patch clips (indoor EV +1.4 by day). At night (07) the parquet reads grey-taupe instead of wood brown. Re-check
  the room environment rows (`model/src/interior/materials.ts`) and the candle ambient. Fold this into KB-I26 or
  KB-I43. **Resolved in wave 2** (KB-I06 look fixes: contrasty half-float room environment, parquet `#9B7448`).
- 2026-11-02 (wave 1, ground): KB-I14's targets disagree. `#B79A84` has a linear albedo of ≈ 0.35, while the
  acceptance asks for 0.40–0.45. Under blue skylight at 10:30 the court reads mauve (sampled ≈ `#977E77` at pose 03).
  Decide the hue or the albedo with research/11 S15 before KB-I45.
- 2026-11-02 (wave 1, contracts):
  - ~~The viewer forces `receiveShadow = true` on interior meshes (`InteriorLook.adopt`).~~ Resolved in wave 2:
    `interiorShadows()` in the model owns the interior shadow flags; the viewer copies are gone.
  - `docs/architecture.md` doesn't yet describe the viewer's height fog: `installHeightFog` overrides three's
    `fog_*` chunks once and adds a `uFog[4]` uniform to every ShaderLib that has `fogColor`, with fog applied before
    tone mapping. The doc also needs `roomEnvironment()` noted as the interior IBL source, scaled to a 3 % daylight
    factor plus candle ambient.
- 2026-11-02 (wave 1, hooks): `skb.look()` is the display look ('doku' / 'kino'), not a camera target. `skb.tour`
  from visual-audit §7 is still missing; it belongs with KB-I46 Rundflug.
- 2026-11-02 (wave 1, light layer): the light layer now differs from `../app/public/data/shared/karlsberg1789/`
  (KB-I03 epoch: −2 nodes; KB-I15 vertex colours). Re-export it with `pnpm run export:explorer` and add a
  "Light-layer changes" line in `docs/explorer-integration.md` at commit.
- 2026-11-02 (wave 2, perf): **retina GPU regression from the land-cover splat.** Two runs in one session against
  the final wave-1 state (other session): 01 15.4 → 25.1–26.4 ms, 02 17.5 → 21.7–23.5, 05 3.2 → 15.8–16.3, 08 7.4 →
  21.2–27.0, 11 3.4 → 12.5–18.9, 12 11.4 → 20.5–22.6, 13 4.3 → 20.7–21.8 at 3024×1964, although triangles halved
  (2.4 → 1.1–1.5 M). At 1080p 01, 02 and 12 rose +1.8 to +5.7 ms, over the +1 ms per-item budget. The landscape
  implementer's A/B puts the cost in the per-pixel land-cover splat at retina resolution (constant splat: 8–16 ms
  at 01). Candidate item (next id): cheaper class encoding (signed distance or lower-frequency classes), fewer
  texture taps in the cultivated branches, a depth pre-pass or drawing buildings and forest before the terrain, grass
  anisotropy 8 → 4. Do it together with KB-I55; the ≤ 12 ms aerial budget is now far off. **Promoted to KB-I59**
  (wave 3).
- 2026-11-02 (wave 2, land cover):
  - ~~The 2 m class raster shows as stair steps at field/meadow edges near the camera (12 foreground).~~ Resolved
    in wave 3 (KB-I56: blurred class weights with the edge on the 0.5 iso-line, `tDist` distance texture).
  - "Regrowth" hay parcels read as dark brown ploughed soil from the air (01 lower right, 11 centre). Check the
    regrowth colour against `#8FA060` / `#B9B07A`. Wave 3: no longer brown; the 01 lower-right parcel now reads as a
    dark green-grey block (KB-I56 hay tints).
  - A dotted line of black specks crosses the meadow S of the palace at 01 (and near the horizon at 12). Cause not
    known (a draped ribbon or wall z-fighting, or a terrain seam); investigate with `skb.pose` close-ups.
  - The TF-11 avenue's 8 m gravel strip is still painted across the HG-01 lawn in `prepare-terrain.py` (two faint
    lines on the axis at 02). Skip gravel for `placement: 'hypothetical'` avenues or inside `lawn` features and re-run
    prepare-terrain after the final catalogue build.
  - Pose 11 "Tiefflug über den W-Wald" now flies over open meadows in 1789. Append a pose 16 (low flight over the
    E-plateau beech wood, LC-11) for KB-I10/KB-I44 forest checks; don't change pose 11.
  - The 2025 epoch now plants 107,825 trees (denser planner; 2.13 M triangles at 01).
- 2026-11-02 (wave 2, contracts and docs):
  - ~~`landcover` sits in `catalogue.json` as an untyped top-level key.~~ Resolved in wave 3 (KB-I09 follow-up:
    `SiteSpec.landcover?: LandcoverArea[]` and its validation).
  - `docs/architecture.md` doesn't yet describe `ground.u8` / `ground2025.u8`, ground classes 8–12, the `landcover`
    key, the `Forest` LOD tiles or `roomEnvironment()` as the interior IBL (half-float, `userData.meanLuminance`, 3 %
    daylight factor). The garden (§4.1/§4.3/§5) and interior shadow (§8) parts are updated.
  - LP-02 and LP-03 previews predate the TF-09 change; run `pnpm run plans` and check whether they show the old
    parterre.
  - The tag text in `scripts/catalogue-v2/programme.ts` still says "perron down to the parterre TF-09".
  - Parterre sand (ground class 12, `#D3BE8A`) is ready but no feature uses it (0 cells); KB-I34.
- 2026-11-02 (wave 2, light): the grey-card sun:shade ratio got worse: 17:30 15.0 (wave 1: 12.0), 19:00 28.7 (19.7),
  10:30 5.3 (5.2). The warmer hero-hour key did not touch the shade term; KB-I06 stays open.
- 2026-11-02 (wave 2, interiors): `silkColour()` (`model/src/interior/evidence.ts`) gives every boiserie room the tan
  upholstery `#c9b27c`, close to gilt, so the Festsaal chairs and sofa read as flat gold blocks (06). Pick an
  evidence-tagged silk for white-and-gold rooms (research/09 lists crimson, blue, green and yellow silks [N]) in
  KB-I26/I27. A horizontal sunlit band across the upper wall at 06 predates wave 2 and was not investigated.
- 2026-11-02 (wave 2, light layer): the HG-04 coping and stag heads are new stone site geometry (temp export: 9 site
  nodes, was 8). The `../app` re-export at commit now carries KB-I03, KB-I13 and KB-I15.
- 2026-11-02 (wave 2, process): headless shots during concurrent HMR edits sometimes fail with "G is not defined",
  "meshes is not defined" or "gridFrame is not defined", and benches run while another bench is running are useless.
  Re-run after edits settle; bench alone.
- 2026-11-02 (wave 3, perf): all 17 poses rose +0.3 to +0.8 ms at 1080p and +0.4 to +1.5 ms at retina at eye level
  between `wave2-final` and `wave3-after` (different sessions, load average 10–14). Aerial retina: 01 16.5 →
  17.4–18.6, 02 7.1 → 10.9–11.3, 08 5.8 → 14.6–19.6, 12 8.2 → 19.8–20.1, 13 3.1 → 9.2–10.7 ms. The `wave2-final`
  session was unusually fast (its 08 retina 5.8 ms vs 21–27 ms in `wave2-after`), so the cross-session deltas
  overstate the regression. The implementers' same-session A/Bs: vegetation ≤ +0.9 ms (all site vegetation),
  buildings 0–1 ms in total, terrain ~13 ms of 01's retina frame → KB-I59. No item is shown to break +1 ms at
  1080p, but none is proven within it either; re-bench on an idle machine.
- 2026-11-02 (wave 3, triangles): rendered triangles rose at every pose: 01 1.42 → 1.63 M, 02 1.35 → 1.78 M, 03 1.61
  → 1.89 M, interiors 1.45 → 1.71 M. Sources per the reports: crown tiers and hinterland hedgerows / orchards
  (site vegetation 0.43 M after a −0.19 M shrub cut), LOD2 facades (palace group 543 → 568 k; whole-site LOD2 1.62 →
  1.73 M in Node). Pose 01 is +0.21 M, inside the +0.5 M garden budget. `skb.bench().triangles.terrain` reports the
  whole terrain mesh (1.39 M), not what is drawn, so don't read it as a per-pose cost.
- 2026-11-02 (wave 3, light layer): the temp export is 5.61 MB of the 6 MB budget (was 4.57 MB), 388 k triangles
  (was 335 k), 99 nodes with **10 site nodes** (was 9; the new one was not identified). Little headroom is left for
  KB-I22/I23 roof and court furniture: check the budget before adding to the light layer. The `../app` re-export now
  carries KB-I03, I13, I15, I16, I17, I19 and I20.
- 2026-11-02 (wave 3, contracts and docs):
  - `docs/explorer-integration.md` §2: the `COLOR_0` row should say the colours include baked AO and the `aShade`
    albedo variation (KB-I19/I20, `EXPLORER_AO_STRENGTH` 0.6), and a "Light-layer changes" line is due at re-export.
    **COLOR_0 row done in wave 4;** the "Light-layer changes" section is drafted there as pending.
  - `docs/architecture.md` still lacks the land-cover pipeline (`ground.u8` / `ground2025.u8`, classes 8–12, the
    typed `landcover` key, `smoothWeights` σ 1 with the 0.5 iso-line, `tDist` RGBA in 0.25 m units, the bake and the
    shared `VINE_GLSL`, `GROUND_COLOURS`), the `crown` vec4 vertex attribute, the foliage `onBeforeCompile` patch
    (`viewer/src/foliage.ts`, uniforms at `skb.foliage`), the forest crown tiers (mid / close < 250 m / hero < 110 m,
    every 8 m, `skb.forest.setDetail`) and `viewer/src/hinterland.ts`. `aShade` / `_ASHADE` is documented.
  - `viewer/src/main.ts` reads the parcels through `(spec as unknown as { landcover? })`; use the typed
    `SiteSpec.landcover` now.
  - `openTreePlan`'s Gewann-hedge path (gridU, `viewer/src/landcover.ts`) is no longer used for hedges; remove it or
    keep it deliberately.
  - Model GLBs (`pnpm run export`) now carry a custom `_ASHADE` attribute.
- 2026-11-02 (wave 3, look residuals): canopy gaps visible from ~45 m in some views; pink blossom triangles on
  flowering shrubs (16, pre-existing); a slightly lumpy poplar column; the 19:12 foliage back-light may be strong;
  kitchen gardens grid-like (KB-I36); straight hay-parcel edges and a hard-edged striped hay block in 01's
  foreground; the vineyard's outer edge is soft over ~10 m (11); wing plinth ashlar blocks a little patchy at 1:1 (14).
- 2026-11-02 (wave 3, CPU): the LOD2 site build in Node rose from 748 to ~1160 ms (palace group 259 → 328 ms) from
  the shading callbacks and wall splits; land-cover edge smoothing adds ~0.5 s CPU at load and on each epoch switch.
- 2026-11-02 (wave 3, process): the wave-2 fix round (`wave2-fix-garden`, `-landscape`, `-look`; poses 16 and 17)
  was not written into this backlog or the README; only its bench numbers are recorded now (header). The wave-2
  `after-*.jpg` in `docs/shots/` had come from the pre-fix `wave2-after`; they now show `wave2-final`. The shared
  5260 dev server's HMR broke during parallel edits; one implementer took shots from its own server on port 5277
  (same bench numbers on 5260 at 01 and 12).
- 2026-11-02 (wave 4, perf, KB-I59): the sky's cloud layer (three's `Sky.js` 4-octave gradient-noise fbm, `time` is
  never advanced, so the clouds are static) costs ≈ 5 ms of pose 12's retina frame (cloud coverage 0 vs 0.25, same
  session, 5 repeats: 13.8 → 8.8 median, 10.3 → 6.6 min) and the whole sky ≈ 5.8 ms there. Candidates: a bound-based
  early-out per octave, or a cached sky (cube / equirect) refreshed on hour changes (would soften near-horizon clouds
  unless ≥ 2k per face). Pose 12 is within budget now, so not done.
- 2026-11-02 (wave 4, perf): 4× MSAA dominates the retina frame on ANGLE/Metal: the same frame into a plain render
  target costs 3.4 ms vs 15.5 ms with 4 samples (pose 01, before the draw-order fix). Any future full-screen or
  overdraw-heavy effect should be measured at retina with MSAA on; a post chain with SMAA instead of MSAA (KB-I41) may
  pay more than it costs.
- 2026-11-02 (wave 4, perf): `terrain.ts` court-sand rake and wheel tracks still call `fwidth` (`aaFade`) and mipmapped
  `vnoise` inside the non-uniform `hw > 0.002` / `hard.b > 0.002` branches (undefined derivatives in GLSL); no
  artefact seen so far, but pass the derivatives in from uniform control flow as the vine rows now do.
- 2026-11-02 (wave 4, perf): `skb.triangles().rendered`, the stats line and the bench "triangles" now include the
  terrain depth pre-pass (+0.4–0.5 M at the aerials); compare triangle counts across wave 4 with that in mind.
- 2026-11-02 (wave 4, lead, CPU): CPU per frame rose at every pose between `wave3-final` and `wave4-after` (1080p,
  different sessions): 01 2.0 → 3.2, 03 3.6 → 5.6, 06 3.7 → 5.1, 14 3.8 → 5.2, 21 5.8, 24 6.1 ms; calls +120–175 per
  pose. The perf implementer measured the pre-pass at +0.1–0.4 ms in the same session; the rest is the new hardware,
  court and rotunda calls plus a much busier machine (load average 36–49 vs 10–14). Re-measure on an idle machine;
  if it holds, look at the per-building material count first (roof hardware adds its iron / gilt / downpipe
  materials to each building's roof builder, i.e. 1–3 calls per building) and at skipping the pre-pass where little
  terrain is visible.
- 2026-11-02 (wave 4, lead, triangles): indoor poses rose 1.08 → 1.61 M (06 / 07). Most of it is the terrain pre-pass,
  which is drawn even while the camera is inside, where the forest and site trees are already culled (KB-I44). Skipping
  the pre-pass indoors would save draw calls there at no visual cost.
- 2026-11-02 (wave 4, lead, light layer): the temp export has a new 11th site node `site:TF-01` (696 triangles): only
  the stone parts of the KB-I23 court furniture (Prellsteine and the flat sandstone gutters), because the site export
  keeps `stone.*` only. The sentry boxes (`wood.shutter` / `roof.slate`) and the cobbled lanes (`ground.cobbles`) are
  not in the light layer, although `court.ts` chose `wood.shutter` for the boards so the export would keep them. The
  gutters are flat strips 3 cm above the 1789 / 2025 minimum terrain and may z-fight or sink under the explorer's
  2025 DTM. Decide in `scripts/export-explorer.ts`: drop the gutters by name, and keep or drop the boxes (≈ 1 k
  triangles). New building nodes: KB-B06a (1.0 k triangles) and the round KB-B07 (2.9 k). 5.69 MB of 6 MB.
- 2026-11-02 (wave 4, lead, roofs): every catalogue mansard has `pitch_upper` 21–30°, which contradicts the HMS
  "flat light deck" (research/09 E9). The KB-I18 lead-deck rule (< 10° → `roof.lead`) therefore draws nothing. If
  a source settles it (KB-I54), lower `pitch_upper` in `scripts/catalogue-v2` and the rule applies by itself.
- 2026-11-02 (wave 4, lead, look): the cobbled carriage lanes (KB-I23) read coarse and very dark in shade at 14's
  foreground; the setts look larger than Katzenkopf cobbles (~0.15 m). Check `COBBLE_UV` and the lane colour in shade.
  The wave-2 wheel ruts in the gravel court are now hidden under the lanes at 03.
- 2026-11-02 (wave 4, lead, programme): the B04 Hofbibliothek is four rooms ≈ 36 m, while the source gives 160 Schuh
  ≈ 52 m: the 57 m LiDAR wing also holds the stair, guard room and gate (noted in the tag). KB-B06a is off-centre
  (≈ 26 m from the gallery's W end) to clear the KB-B27 wall; the exact middle is the recorded alternative.
- 2026-11-02 (wave 4, lead, plans): the plan elevations (`ansicht.ts`, `elevation.ts`) draw no downpipes, rods or
  vanes, and the sentry boxes are not on the LP sheets; `hardwarePlan.ts` and `courtPlan.ts` are pure and could feed
  them.
- 2026-11-02 (wave 4, exterior, downpipes): on the louvred palace fronts the open shutter leaves cover every pier (in
  the 2.65–3.3 m axes the leaves of neighbouring windows even overlap), so the KB-I22 rule keeps corner pipes only on
  B01–B05 and B10. Runs of 40–84 m then drain to the corners, more than G5's 15–20 m per pipe. If that matters,
  pipes could go behind a closed leaf or in the risalit re-entrant angle; a source would settle it.
- 2026-11-02 (wave 4, exterior, cross-owner): the review fixes touched two files outside the exterior area, both
  additively: `model/src/layout/rotunda.ts` (programme: `pediment.halfWidth`, `atticBlock`) and
  `scripts/prepare-terrain.py` plus the regenerated `viewer/public/terrain/` (perf: `rotunda_pads`). The cobbled-lane
  note above (14 foreground, `COBBLE_UV`) is resolved by the KB-I23 review fix. The README changelog has no entry for
  the review fixes yet, and the plan underlays were not regenerated after the terrain re-run.
- 2026-11-02 (wave 5, interiors, KB-I26/I27): R12 names seven more coloured rooms that have no placed room yet:
  Blauer Salon, Kirschenfarbener Salon, Gelb-weißes Vorzimmer, Roter (violetter) Salon, Blau-weißes Schlafzimmer,
  Haselnussfarbenes Kabinett and Lorbeersaal [D names; U positions]. They stay unplaced until a source locates them,
  so `wall.silk.blue` is still used only where it was before. The GR plan sheets were not regenerated after the
  room renames ("Antichambre (Nr. 8)", "Rotes Vorzimmer", "Grauer Salon", "Grünes Schlafzimmer", "Kirschrotes
  Kabinett", "Roter Salon der Herzogin"). The room POI list (`ROOM_POI`, `model/src/site/index.ts`, garden-owned)
  has no salons, so poses 27 and 29 use explicit cameras; adding "Gelber Salon" would let `skb.goto` reach it.
  Canvases are 14 × 14 vertex-colour grids, so up close (< 2 m) they read soft and blurred rather than painted; a
  small procedural texture atlas would sharpen them at a draw-call cost.
- 2026-11-02 (wave 5, garden): the light layer is now 5.93 MB of the 6 MB budget (5.74 before; the stepped GARD
  walls and the two pavilions KB-B87/KB-B88). The full stepped wall first cost 0.35 MB, so GARD walls below LOD 2
  (viewer mid range, explorer) use a lean variant (one body box, saddle on the wall head, piers without caps,
  ≈ 18 instead of 42 triangles per bay). Any further exported geometry needs headroom first (e.g. drop hypothetical
  nodes or quantise positions). Cameras inside a GARD enclosure (kitchen garden) count as indoor in the viewer
  (exposure up, vegetation culled), so walking the beds looks wrong; viewer-owned. The TF-08 S retaining wall
  meets a 1 m raster sawtooth at its foot (pre-existing DTM edge). Aviaries, further sculpture and the octagon are
  not located (U) and not modelled.
- 2026-11-02 (wave 5, lead, CPU and calls): the Ehrenhof poses gained +163 to +170 draw calls and +0.5 to +1.0 ms CPU
  at 1080p across sessions (03 5.3 → 5.8–6.1, 10 5.1 → 6.1, 14 5.3 → 6.1 ms). The interiors' A/B did not measure 03,
  and the garden A/B did not include the Ehrenhof. The likely source is the new state-room parts (bead-profile frames,
  sconces, rosettes, supraportes) in the rooms within `INTERIOR_DIST` that show through the windows; the KB-I59
  review measured interiors at ≈ 940 of 1,285 draws at 03. Re-measure same-session with interiors hidden. The lever is
  the one KB-I59 handed on: merge interior meshes per material per room or storey.
- 2026-11-02 (wave 5, lead, build): the JS bundle is 1,533.8 kB, over Vite's `chunkSizeWarningLimit` 1500 (a
  warning, not a failure). Lazy-load `photo.ts` and `tour.ts`, which are inactive until used, rather than raising the
  limit.
- 2026-11-02 (wave 5, lead, light layer): the new nodes are `KB-B87` and `KB-B88` (hypothetical, low `_CONF`) and
  `site:HG-41` (Flora herm). The GARD-wall nodes grew: `KB-B27` 0.1 → 2.0 k, `KB-B23` 0.1 → 1.0 k, `KL-B43` 0.2 → 2.6 k
  triangles against the deployed layer. Whether hypothetical pavilions belong in the explorer layer at all is part
  of KB-I62.
- 2026-11-02 (wave 5, lead, look): at eye level the garden detail reads cruder than from the air: cube flowers,
  palisade-like bean rows, a box-stack herm, and black shrub limbs under hovering clumps. The crowns of near trees are
  faceted polyhedra at 10–30 m (`after-12m-kitchen-garden`). → KB-I63 for the garden parts; the crown facets are a
  KB-I44 residual.
- 2026-11-02 (wave 5, lead, night): pose 26 shows the night scene still reads as day for night (bright green ground and
  crowns at 22:00), so the scotopic shift is the main night lever left. Chandeliers are lit every night
  (`CHANDELIER_NIGHT` = 1), against "chandeliers only for celebrations" (KB-I43/I48). Pose 07 is unchanged apart from
  the KB-I26 frames.
- 2026-11-02 (wave 5, lead, plans): `pnpm run plans` regenerated LP-00 and LP-01 (garden). The GR previews (08:04)
  predate the room renames to "Antichambre (Nr. 8)", "Rotes Vorzimmer", "Grauer Salon", "Grünes Schlafzimmer",
  "Kirschrotes Kabinett" and "Roter Salon der Herzogin". The underlays in `plans/data/` are from 2026-11-01, so they
  predate the wave-4 and wave-5 terrain re-runs; run `plans/scripts/terrain.py`, then `pnpm run plans`.
- 2026-11-02 (wave 5, lead, process): the wave-5 implementers edited files outside their ownership, all additively:
  `spec.ts`, `validate.ts`, `scripts/catalogue-v2/buildings.ts`, `exterior/index.ts` (gardenWall hook), viewer tests
  `crown`, `landcover-review3` and `model/tests/landcover.test.ts` (garden), and `shots.mjs` (experience: pose 26;
  interiors: poses 27–29). The next free pose number is 30.

- 2026-11-02 (wave-5 review fix, garden): pose 12 changed between wave 4 and wave 5 without any garden change in
  frame. The cause is `viewer/src/forest.ts` `buildTile`, which draws crown look, scale and colour from one sequential
  random stream per 320 m tile (and `forestPlan`'s shrub-mantle loop draws a variable number of values per cell). Any
  change in a tile's content, here the LC-31/LC-32 clearings, reshuffles every crown in that tile. Proposal:
  position-hashed per-instance randomness (`mulberry32(hash(round(x), round(z)))`) as a deliberate one-time reshuffle,
  owned by the forest code; the same applies to the per-bucket stream in `model/src/site/trees.ts` `treeMeshes`.
- 2026-11-02 (wave-5 review fix, garden): pose 18 draws the kitchen-garden beds although they are hidden behind the
  palace (review: +344 k triangles). The garden-detail meshes are merged per material over the whole site, so frustum
  culling cannot drop them. Proposal: split `site/garden-detail/*` per feature (KG-01, TF-08, TF-15), measured with
  the bench at 18 and 13. Not done in this fix.

- 2026-11-02 (wave 6, lead, determinism): shots are no longer byte-identical run to run at outdoor poses, and pose 21
  once rendered with a blown-out sunlit floor (1 of 8 runs). → **KB-I64**.
- 2026-11-02 (wave 6, lead, perf): retina at eye level and indoors rose by 2–5 ms (19, 21, 29, 33, 34), the sky and
  clouds cost 5–6 ms of the 32 / 34 retina frame, and CPU per frame rose +0.7…+1.4 ms at every pose. The aerial budget
  holds. → **KB-I65**.
- 2026-11-02 (wave 6, lead, look): forest crowns at 150–300 m stay faceted (cards fade by 220 m) and the conifer
  whorls look stacked → **KB-I66**. The menagerie terraces stand on a bare apron without the documented beech wood,
  and the island pavilion KL-B41 shows an undocumented superstructure → **KB-I67**.
- 2026-11-02 (wave 6, lead, look): the water SSR mirrors the Karlsbergweiher bank trees with thin horizontal comb
  stripes (`docs/shots/KB-I37/after-kw-eye-custom.jpg`); likely the ripple offset sampled per march step
  (→ **KB-I69**, wave 7). The
  menagerie channel (KL-B43) uses the shared `water` material on thin strips that follow the terrace steps; nobody
  has checked the SSR there at LOD2 (36 is 40 m up).
- 2026-11-02 (wave 6, lead, look): the AO leaves mild dark halos above the Festsaal chair backs (06; intensity 4.5,
  strength 0.85 kept). The leaf cards and window edges at native retina without MSAA (`sceneMsaa` 0 above 4.2 Mpx)
  were not checked by eye; at Hoch's DPR cap a 3024×1964 display draws 2268×1473 with 2× MSAA.
- 2026-11-02 (wave 6, lead, contracts): the post chain makes alpha a contract: opaque materials must keep alpha 1 in
  the scene target, because alpha < 0.25 marks water for the SSR (`docs/architecture.md` §3.6). The leaf cards need a
  multisampled target for alpha-to-coverage; any future post or photo target must keep samples ≥ 4 where cards show
  (photo mode accumulates without MSAA, so stills rely on the 16–32 jittered samples instead).
- 2026-11-02 (wave 6, lead, viewer): KB-B12a Komödienhaus and the KB-B11 workshops have no `ROOM_POI` / "Gehe zu"
  entry. The Fachwerk flag (KB-I21) is not visible from outside at the standard poses; the masonry frame plane stays
  0.14 m behind the face for every building, so deepening masonry reveals would be the visible lever (a change for
  every building, not done).
- 2026-11-02 (wave 6, lead, build): the JS bundle grew to 1,703.9 kB (1,533.8 after wave 5), further over Vite's
  1500 kB warning. Lazy-load `photo.ts`, `tour.ts` and the post chain's SMAA (off in every preset).
- 2026-11-02 (wave 6, lead, catalogue requests): `fountain_h: 4` on TF-32 (upper Schwanenweiher; "D presence
  research/11 S12, N height") turns on the jet that `features.ts` already builds (KB-I37). A Karlsbergweiher pose
  (append 38) is the KB-I37 acceptance view. The Findlinge need located dam and tumulus geometry (KB-I54).
- 2026-11-02 (wave 6, lead, process): implementers edited shared files additively (`viewer/src/main.ts` by look and
  vegetation, `model/src/layout/grammar.ts` by vegetation and architecture, `model/src/exterior/index.ts` and
  `model/src/materials/index.ts`) and `viewer/src/night.ts` (no owner). One architecture A/B pair of private vite
  servers re-optimised the shared `node_modules/.vite` cache once (11:26) before getting their own `cacheDir`; the
  5260 server may have done one dependency reload then. The next free pose number is 38.

- 2026-11-02 (wave 7, lead, gates): `verify.sh test build catalogue export warn` pass: 708 tests in 76 files;
  catalogue reproduced (116 buildings, 105 placed, 63 terrain features, 119 rooms; 0 errors, 0 warnings, 0 programme
  issues, 0 overlaps); temp export 4.17 MB, 114 nodes, round trip OK; `warn` unchanged (B04 2, B05 1 unserved doors,
  KB-I52); history-check 0 failures, 0 of 20 deltas open. Build: only the known chunk-size warning.
- 2026-11-02 (wave 7, lead, look): interior mapping residuals (KB-I42): some curtains read violet rather than crimson
  at 03; mapped rooms also appear behind mansard dormers and the roof oculi (13: a yellow room behind an œil-de-boeuf),
  where attic rooms or roof space would be dark; at 17:30 (13) the yellow rooms read almost like lit windows by day.
  Consider dimmer rooms above the Beletage and no room behind oculi.
- 2026-11-02 (wave 7, lead, look): KB-I66 residuals: at 01 the step from the dappled crowns to the smooth domes beyond
  ≈ 320 m reads as a band and a large solitary crown at the left edge is still faceted; at 13 the fringe cards show as
  detached dark specks just outside mid solitary crowns (the fringe opens on the silhouette but the card centres sit
  off the crown).
- 2026-11-02 (wave 7, lead, garden): the vineyard's 3D hand-over at 170 m is visible from the air at 11 (staked rows
  on the near half, the painted strip on the far half); clumps nearer than 2 m show polygon outlines (40). The vines
  cost +0.95…1.45 ms at 1080p at 40 (KB-I35).
- 2026-11-02 (wave 7, lead, terrain): at 39 the Karlsbergweiher's W bank is a steep cut with visible terrain triangles
  above the water (`prepare-terrain.py` pond banks); the follies of KB-I39 / KB-I30 sit on unprepared meadow (KB-I71).
- 2026-11-02 (wave 7, lead, export): the deepest base skirt is now KL-B41a, 5.68 m below its plinth (the hypothetical
  island-pavilion superstructure on the quay in the moat); check how it reads in the explorer before the re-export.
- 2026-11-02 (wave 7, lead, memory): the KB-I65 sky cube costs ≈ 48 MB GPU memory in every preset; not checked on a
  low-memory device (Mobil).
- 2026-11-02 (wave 7, lead, process): shared files edited additively: `viewer/src/main.ts` (garden: vines; look:
  indoor rule, interior modes, exposure), `model/src/layout/grammar.ts` (garden `VINEYARD`, architecture `FOLLY`),
  `model/src/materials/cobbles.ts` (garden, no owner: wheel-track flattening and hoof dust),
  `model/src/materials/index.ts` (look: interior mapping), `model/src/exterior/index.ts` (architecture: follies);
  `model/tests/site-court.test.ts` (architecture: folly footprints skipped). The architecture owner saw the 5260 dev
  server reload mid-run (HMR) and rendered from a private server; the lead's final runs on 5260 were clean. GPU
  timings: load average 22–37 during every wave-7 bench, so the cross-session before/after is indicative; the
  same-session A/Bs carry the item costs. Next free pose number: 46 (46–47 were reserved for look and stay unused); next free id: KB-I72.
- 2026-11-02 (wave 8, garden): the aerial retina budget (≤ 12 ms) is not met at 01 / 08 / 41 in any wave-8 run
  (01 retina 11.2–20.4, 08 14.5–17.9, 41 16.2–18.3 ms with load 20–22); it was already 21.4 / 15.4 / 14.8 in
  `wave7-final`, so it predates the wave-8 garden changes (A/Bs above) — needs a quiet-machine bench.
- 2026-11-02 (wave 8, garden): pond shores (audit #7) stay as `prepare-terrain.py` draws them: the Karlsbergweiher
  reads as a straight-edged rectangle from the air (48) and its W bank is a steep cut (39). A smoothed shore polygon,
  a depth fade and reeds would need a contract for the water mesh shared with the look's SSR; not done.
- 2026-11-02 (wave 8, garden): Petri's clumps (audit #2) unchanged; the meadow at 17:30 (47, the field W of the
  court mouth) still has a yellow cast — the hay class, not the lawn.
- 2026-11-02 (wave 8, garden, process): shared files edited additively: `model/src/layout/grammar.ts` (`FENCE`),
  `model/src/spec.ts` / `validate.ts` (kind `fence`), `.claude/skills/skb-improve/scripts/shots.mjs` (poses 46–48
  appended at the end of the list, after look's 52 / 53, and each switches the festival off first);
  `model/src/materials/cobbles.ts` (no owner). Next free pose number after this wave: 49 (unless 49 / 51 are used by
  architecture).

- 2026-11-02 (wave 8, lead, gates): `verify.sh test build catalogue export warn` pass: 784 tests in 83 files;
  catalogue reproduced byte for byte (117 buildings, 106 placed, 81 terrain features, 119 rooms, 168 interior openings,
  12 stairs; 0 errors, 0 warnings, 0 programme issues, 0 overlaps); temp export 4.37 MB, 116 nodes (103 buildings +
  13 site), 425,045 triangles, round trip OK; `warn` `[]` for B01–B06, B10, B11; history-check 0 failures, 0 of 20
  deltas open. Build: the known chunk-size warning; the JS bundle is now 1,877.0 kB (1,703.9 after wave 6), so
  lazy-loading `photo.ts`, `tour.ts` and `festival.ts` is due. Three consecutive `shots.mjs --bench` runs gave
  byte-identical JPEGs at all 52 poses (KB-I64 holds with the far shadow map and the festival).
- 2026-11-02 (wave 8, lead, look): the "dark quadrilateral" on the meadow at 01 / 08 / 52 (look report) is the
  vineyard's far painted parcel, also at 02, 41 and 48 → KB-I73.
- 2026-11-02 (wave 8, lead, garden): at 39 the large solitary tree on the Karlsbergweiher's S bank (left foreground)
  is gone and at 41 the tree beside the pond moved; the Felsenpfad KB-W8 runs there. New hypothetical features must
  nudge, not drop, existing trees (decision of the wave-5 review fix); check the site tree keep-off for walks.
- 2026-11-02 (wave 8, lead, look): with the compressed grass highlights (audit #1) the near meadow reads flatter and
  more uniform at 39, 44 and 46 (the lawn at 16 / 33 gains); grass-blade cards or a finer meadow detail tap would
  restore texture at eye level. The meadow at 47 (17:30) keeps a yellow cast from the hay class.
- 2026-11-02 (wave 8, lead, perf): 41 at 1080p 3.8 (single `wave7-final` run) → 5.0 / 5.2 ms (min / median of 3),
  the one pose above the +1 ms item budget across sessions; the garden owner's same-session A/B of the lawn and
  vineyard shader blocks put it at ≤ +0.4 ms (min). 13 +0.3, 14 +0.2, 15 +0.3, 18 +0.3 ms (min), within noise; every
  other pose is faster. Retina fell at every aerial (01 21.4 → 7.2, 08 15.4 → 7.4, 26 20.9 → 5.4, 43 18.1 → 7.4 ms
  min): the `flat`-varying fix (KB-I65), which also settles the garden entry above (aerial retina over budget).
  Load average 14–17 during the three runs.
- 2026-11-02 (wave 8, lead, plans): the CdL court portal frame (`PORTAL_FRAME`) exists only in 3D; AN-01 does not
  draw it (KB-I72). GR-11…16, SC-02, LP-00 and LP-01 previews were regenerated by the architecture owner.
- 2026-11-02 (wave 8, lead, process): shared files edited additively: `model/src/layout/grammar.ts` (garden `FENCE`;
  look `FESTIVAL`; architecture `CHINESE_ROOF`, `HEMMER_ROD`, `PORTAL_FRAME`), `model/src/materials/index.ts` (look:
  plain glass varyings; architecture: `wall.granite`), `model/src/context.ts` (architecture), `viewer/src/main.ts`
  (look: festival, far shadow), `.claude/skills/skb-improve/scripts/shots.mjs` (49 / 50 architecture, 52 / 53 look,
  46–48 garden appended last; 48 leaves `lowConfidence: 'translucent'`, so any later pose must reset it),
  `scripts/prepare-terrain.py` (architecture: `WALL_FOOT_IDS`, `PORTICO_PADS`; garden: KB-V1 gravel). No owner:
  `model/src/materials/cobbles.ts` (garden, cache key `cobbles-v3`). Unused reserved poses: 51 (architecture), 54–55
  (look); next free pose number 56 unless those are used; next free id KB-I78.
- 2026-11-02 (wave 8, lead, export): the explorer layer gains `KB-B28a` and `site:KB-WB1` against the wave-7 lead
  check and changes `KB-B28`, `KL-B50`, `KB-B07`, `KB-B01`, the follies and the TF-41 / TF-42 wells
  (`docs/explorer-integration.md` §2.5); the re-export into `../app` still waits for the user's go.
- 2026-11-02 (wave-8 review fix, garden): the S-bank tree at 39 / 41 (entry above) is resolved: the walk had been
  painted as gravel, which dropped one walnut and reshuffled a forest tile's crown variants; trodden-earth footpaths
  are now not painted (`prepare-terrain.py`), and `viewer/tests/felsenpfad-trees.test.ts` freezes the trees near
  KB-W8 (KB-I71). The vineyard "dark quadrilateral" is resolved (KB-I73). The flat near meadow at 39 / 44 / 46 got a
  procedural grain and regrowth patches (KB-I45); grass-blade cards remain open.
- 2026-11-02 (wave-8 review fix, garden): the forest tile planner draws each tile's crown variants from one
  sequential random stream, so dropping or adding a single tree in a tile changes the look of all later trees of that
  tile. Seeding the variant per tree (hash of its cell) would make the planners robust to such edits but changes
  every tree once (all poses); not done.
- 2026-11-02 (wave-8 review fix, garden): the 3D vine plants (`viewer/src/vines.ts`, not touched) still read darker
  than the painted parcel next to them at 11 / 41 (3D 0.118 vs 0.257 linear); the hand-over cut at the 3D range is
  softened on the ground side only. The new KB-L2 lawn and the earth walk / outcrops are in the catalogue and in the
  site geometry: the plans (LP sheets) and the explorer light layer pick them up on their next regeneration
  (verify.sh export: 4.34 MB, round trip OK).

- 2026-11-02 (wave 9, lead, gates): `verify.sh test build catalogue export warn` pass: 852 tests in 93 files;
  catalogue reproduced byte for byte (117 buildings, 106 placed, 87 terrain features, 119 rooms, 168 interior openings,
  12 stairs; 0 errors, 0 warnings, 0 programme issues, 0 overlaps); temp export **4.32 MB**, 117 nodes (103 buildings +
  14 site), 422,389 triangles, round trip OK; `warn` `[]` for B01–B06, B10, B11; history-check 0 failures, 0 of 20
  deltas open. JS bundle 1,930.7 kB (1,877.0 after wave 8): lazy-loading `photo.ts`, `tour.ts`, `festival.ts` is due.
  Three consecutive `shots.mjs --bench` runs gave byte-identical JPEGs at all 52 poses.
- 2026-11-02 (wave 9, lead, export): against the wave-8 lead export the light layer gains `site:KB-W8` (Felsenpfad
  outcrops and edge stones, `stone.red`, 2,040 triangles); KB-B01 grows by 376 triangles (perron); most buildings lose
  28–192 triangles (smaller gilt Hemmer heads; the iron masts are dropped as before); `index.json` heights drop where
  masts got shorter. Format unchanged; the re-export into `../app` still waits for the user's go
  (`docs/explorer-integration.md` §2.5).
- 2026-11-02 (wave 9, lead, architecture): at 16 / 17 a blue-white sentry box shows through the CdL's open garden door
  on the axis (the sentries moved out with the wider perron); harmless, but it reads as an object in the doorway.
- 2026-11-02 (wave 9, lead, site): at 47 the KB-V1 forecourt ends in two steep sand humps at the guard houses and a
  2.0–2.3 m vertical step to the Ehrenhof (344.8 m) along E ≈ 382 187 (the red court-mouth wall under the grille), with
  no ramp on the axis. How carriages entered the court is not modelled; check Le Clerc / PV for a ramp or a lower
  court mouth before changing the terrain.
- 2026-11-02 (wave 9, lead, ground): at 03 / 09 / 14 the cobbled lane ends in a hard straight edge on the court axis
  (pre-existing since wave 4, now more visible with the calmer sand).
- 2026-11-02 (wave 9, lead, look): at 39 the SSR reflection of the graded bank shows a stepped edge of a few pixels
  near the inlet, and the shallow-water tint draws a pale rim along the shore (the garden owner asked look to check
  the bank reflections at 39 / 45 with the new grid water mesh).
- 2026-11-02 (wave 9, architecture): (a) KB-B28's sides were swapped because `axisRect(…, 90, …)` points s W → KB-I79.
  (b) In shade (03) the grey-pink perron contrasts less than the red stair did; the flat 0.5 m centre risalit is
  still the weak point of the CdL hierarchy in frontal light (a deeper projection or stone Lisenen would be N, not
  done without evidence). (c) KB-B28's E face is a blank 10 × 8 m wall; a blind-window articulation is optional.
  (d) research/09 §2.8 / G6 should cite NDB 8 (1969) 510 f. and Hemmer's *Anleitung*, Offenbach 1782 (²1788), not
  "1786" (carried over from wave 8; research is not lead-owned in this wave).
- 2026-11-02 (wave 9, lead, perf): every GPU number of wave 9 was taken under load (look owner 7–13 with ≈ 3× times,
  garden 13–20, lead 19–39). Still to bench on an idle machine: room-mirror capture frames (06, 21, 23, 27, 29 with
  `skb.mirrors.enabled` true / false), 34 and 48 at retina, the grass blades at retina.
- 2026-11-02 (wave 9, lead, process): shared files edited additively: `model/src/layout/grammar.ts` (garden
  `GRASS_SWARD`, `GARDEN_GRADED`; architecture `HEMMER_ROD`, `MAIN_PERRON`), `model/src/materials/index.ts` (look:
  `glassView`), `viewer/src/main.ts` (garden: grass blades; look: mirrors, window pull), `scripts/prepare-terrain.py`
  (garden: natural shores, KB-V1 low-pass). The viewer terrain was regenerated by the garden owner (backup of the
  previous dtm in the scratchpad `g9/dtm1789.before.f32`). No poses added; next free pose number 56; next free id KB-I80.

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-11-02 | Backlog created; order = headroom and light first, then the 1789 landscape | visual-audit §6 pass order; research/11 names land cover the main "wow" lever, and it also cuts forest cost |
| 2026-11-02 | Skill/backlog review: KB-I15 and KB-I14 pulled forward as quick wins after the light items; KB-I18 narrowed (the cover split is already in the catalogue, H18); one `epoch {from, to}` + `inEpoch()` design for buildings and features; pose 15 (garden front 07:00) added to `shots.mjs`; KB-I05 DPR caps aligned with visual-audit P7 | cheap, documented changes first; avoid two epoch designs; acceptance must be measurable |
| 2026-11-02 | KB-I06: Khronos PBR Neutral tone mapping by default ("Dokumentation"), AgX as "Kino" (part of KB-I41 taken early) | Neutral keeps catalogue colours 1:1 below the highlight shoulder, so palette checks (KB-I15) stay readable |
| 2026-11-02 | KB-I06: pre-exposure after Frostbite (display = nits / (1.2 · 2^EV)); `toneMappingExposure` carries only the eye adaptation between inside and outside (tau 1.2 s, snaps on step, goto and pose); indoor EV +1.4 by day, tuned on pose 06 | one EV curve for sky, sun and emissives; adaptation stays deterministic for shots |
| 2026-11-02 | KB-I06: candle ambient (3 lx) only when the camera is inside; which windows were lit in 1789 is unknown [U] and goes to KB-I43 | no invented night scene outside |
| 2026-11-02 | KB-I07: fog grows mildly superlinear with distance (1 + t/1600 m) | stands in for the haze beyond the 2 km terrain crop, so the crop edge melts into the sky |
| 2026-11-02 | KB-I08: a view's preferred hour applies only to a goto from the UI; `skb.goto` keeps the hour | shot poses stay deterministic |
| 2026-11-02 | KB-I04: the viewer sets `receiveShadow` on interior meshes until the interior builder does | stops sunlight passing through walls now; moved to the model later (Discovered) |
| 2026-11-02 | KB-I15: `facade.members_material` 'render' or 'stone', defaulting to stone for FARM, FARM_GROUP, RIDE and STABLE | painted render members on the court buildings (research/09 E7), sandstone dressings kept where the evidence is for farm work |
| 2026-11-02 | KB-I02: UP-11 Monbijou and UP-12 Kirchturm leave the building list, with notes kept in `open_questions` | separate estate and Homburg's church (research/10 §b.6); nothing deleted silently |
| 2026-11-02 | Wave 1 verdicts follow the files on disk (gates and history-check), not the implementer reports | two model sessions overlapped and the reports disagreed with the files |
| 2026-11-02 | KB-I09: 1789 land cover lives in `catalogue.json` as a top-level `landcover` list built by `scripts/catalogue-v2/landcover.ts`; forest for 1789 comes from those polygons plus a steep-slope rule, not the CHM; the 2025 epoch keeps today's canopy via `ground2025.u8` | research/11 §6.3; the CHM shows today's forest, not 1789's; typing it in `spec.ts` follows (Discovered) |
| 2026-11-02 | KB-I10: 320 m forest tiles with two levels (near trunks + lobed crowns with shadows; far 20-triangle crowns, no shadows) instead of billboard impostors | per-tile culling in both passes is the main win; low-poly crowns need no atlas and stay consistent with the near look |
| 2026-11-02 | KB-I11: a bare "Kastanie" maps to *Aesculus* with a warning; only Castanea / Edel- / Esskastanie give *Castanea*; Hainbuche uses the tilia shape | the catalogue names sweet chestnuts explicitly where the evidence says so (research/11 G5); silent guessing hid the ambiguity |
| 2026-11-02 | KB-I12: TF-11 Ostachse avenue is `placement: 'hypothetical'`, confidence low, and its trees are not drawn across the HG-01 lawn; plans and 3D share one avenue-blocking function | no period plan shows TF-11 (research/11 G4); Petri's lawn is open on the axis |
| 2026-11-02 | KB-I06 (wave 2): the interior room environment is a contrasty half-float equirect carrying `meanLuminance`; documented parquet `#9B7448` and boiserie `#F1EFE8` restored; indoor day headroom 0.1 EV | the flat environment and the specular veil turned wood grey; research/02 §3 colours |
| 2026-11-02 | KB-I06 (wave 2): hero-hour sun ≈ 4000–4650 K over 20–32°, chromatic adaptation 0.2 at 22°, a −0.15 EV key dip over 20–26°, visible sky desaturated to 0.62 at 15–28° (all [I]) | keeps the sunlit CdL below the Neutral shoulder (cream, not grey) and stops the navy sky at 17:30 |
| 2026-11-02 | KB-I44: geometric clump crowns with a foliage shader patch instead of EZ-Tree leaf-card atlases | no new dependency or atlas licence; one crown builder for forest and garden trees; costs ≤ +0.3 ms (full vs lite) |
| 2026-11-02 | KB-I16: crown-glass normal jitter per leaf and top light, not per pane | per pane cost ~+130 k LOD2 triangles for no visible gain at the standard poses |
| 2026-11-02 | KB-I19: per-block sandstone hues only at LOD2; LOD1 uses one tint per wall piece | saves ~85 k LOD1 triangles; blocks are invisible at LOD1 distances |
| 2026-11-02 | KB-I20: AO baked into the light layer's `COLOR_0` (format `sle-recon-v1` unchanged); model glbs carry `_ASHADE` | no contract change for the explorer; full AO stays available in the model files |
| 2026-11-02 | KB-I57: no roadside avenues without located road geometry (KB-I58); parcel-edge hedgerows replace the Gewann hedges | no invented geometry; the open Gewannflur had no hedges [N] |
| 2026-11-02 | KB-I56: micro-relief ramp 2 → 6 m beside levelled courts, terraces and parterres; 4 → 12 m kept at buildings, water, dams and scarps | calms the lumpy turf (visual-audit V6) without flattening real terrace edges |
| 2026-11-02 | Interior shadow flags belong to the model (`interiorShadows()`: walls, cornices, ceilings cast); supersedes the KB-I04 row on the viewer setting `receiveShadow` | exports and plans get the same flags; furniture no longer casts |
| 2026-11-02 | KB-I59: the terrain is drawn after every other opaque object, behind a depth-only pre-pass, and the sky dome last (`RENDER_ORDER`) | on ANGLE/Metal with 4× MSAA hidden fragments were shaded: −6…−12 ms retina at the aerials for +80–120 draw calls (+0.1–0.3 ms CPU), pixel-equal shots |
| 2026-11-02 | KB-I59: terrain lighting per vertex (three's formulas and DFG table), shadow, albedo, point lights and fog per pixel | the terrain is rough, unbumped and smooth per vertex; −2.5…−4 ms retina, ≤ 3/255 change on far terrain |
| 2026-11-02 | KB-I59 review: the terrain depth pre-pass is a static lower bound of the DTM on an 8 m grid (30 blocks), and static scene matrices are frozen (`staticMatrices.ts`) | the per-chunk pre-pass cost 80–120 draws and ~360 objects, and the Scene root recomposed ~5 400 matrices per frame: −0.5…−0.9 ms CPU at 1080p, GPU and pixels equal within noise |
| 2026-11-02 | KB-I55: the PMREM stays on all building and site materials (no SH-only split for rough ones) | removing the environment entirely saved ≤ 0.4–1 ms at eye level and nothing measurable at the aerials, while the split would change slate, render and sandstone sheen |
| 2026-11-02 | KB-I18: no roof cover changed; the lead deck is a data-driven rule (`pitch_upper` < 10°), not a per-building override | no source for other PAV covers [U]; the deck follows the catalogue once its pitch is settled (KB-I54) |
| 2026-11-02 | KB-I23: no Marstall basin and no Küchenhof pump until they are located; court furniture only in the Ehrenhof TF-01 | PV legend proves existence, not position (research/11 S12); no invented geometry |
| 2026-11-02 | KB-I24: KB-B06a Bibliothekspavillon off-centre on the gallery N side (hypothetical, low), the exact middle kept as an alternative | the middle collides with the Holländische Gärtnerei KB-B27 wall; side and size are I/U (research/10 §b.1) |
| 2026-11-02 | KB-I25: Hofbibliothek as four rooms ≈ 36 m on the KB-B04 EG, not the documented 160 Schuh ≈ 52 m | the 57 m LiDAR wing also holds the stair, guard room and gate; the conflict is in the tag |
| 2026-11-02 | KB-I27: `wall.silk.yellow` is `#C9A94E` (09 M8, I); 10 §c.2 `#D9B95B` (N) noted as the alternative | `#D9B95B` sits too close to the gilt `#D4AF6A` and the gilt frames vanish against it |
| 2026-11-02 | KB-I26/I27: paintings are tonal vertex-colour placeholders (no artwork, no textures), and documented counts (20 chandeliers, 104 curule chairs, 2 bergères) come from the room `function` text | no image of the hang survives; HMS frames are excluded; the catalogue stays the single source of facts |
| 2026-11-02 | KB-I43: the portal lanterns are a viewer-only, night-only hypothesis (N/U): merged meshes and halo sprites, no point lights, not exported; lit windows are seeded at 15 % (CdL) and 10 % (wings) [U], at 1850 K and less adapted than the room light | no source for lanterns or lit windows; zero cost by day and nothing reaches the light layer; candle light should read warmer than the adapted room |
| 2026-11-02 | KB-I46: the Rundflug plays in the Kino look and restores hour, look and panel when stopped; its shots are anchored to catalogue buildings, not to fixed coordinates | the look decision of KB-I41 ("Kino" for tour and photo); anchoring keeps the tour valid when catalogue positions change |
| 2026-11-02 | KB-I47: photo samples are accumulated in display space (after tone mapping), with DOF by thin-lens accumulation instead of a post blur | averaging after tone mapping keeps bright edges (sky, glass) from ringing and matches the live look; accumulation needs no new dependency |
| 2026-11-02 | Wave 5 garden: GARD walls below LOD 2 (viewer mid range, explorer) use a lean variant with less than half the triangles | the full stepped wall cost 0.35 MB and would break the 6 MB light-layer budget |
| 2026-11-02 | KB-I32/I33: KB-B87 and KB-B88 are `placement: 'hypothetical'` with low confidence (positions ±30 m); the square "Pavillon zu Carlsberg" is the existing KB-B28; the octagon, the aviaries and further sculpture are not placed | Petri's plan proves existence, not position (research/11 G8, S6); no invented geometry |
| 2026-11-02 | Wave-5 review fix: TF-08 keeps 4 × 1 lawn panels in one row | its 24.2 m depth cannot hold two rows at d'Argenville's module (2 × 10.2 m panels + 3 m cross walk + 3.2 m borders = 26.6 m > 24.2 m) [N; I] |
| 2026-11-02 | Wave-5 review fix: of the three LP06 buildings in the Holländische Gärtnerei, KB-B54 and KB-B56 are S-facing lean-to forcing houses and KB-B55 between them is the gardener's lodging with a passage (I, low) | LP06 draws three buildings [D]; Petri draws two S-facing greenhouses with a central passage [D Schneider]; PV g. "serre chaude … avec son logement" [D] |
| 2026-11-02 | Wave-5 review fix: new hypothetical garden features keep their trees in separate low-confidence buckets, and keep-off conflicts nudge existing single trees instead of dropping them | adding a feature must not reshuffle unrelated trees at the standard poses |
| 2026-11-02 | Wave-5 review fix: chandeliers burn at night only with "Fest: Kronleuchter brennen"; an ordinary evening is the mantel candelabra and sconces | look-and-period §5 (D-> SPSG: chandeliers for celebrations); the full KB-I48 Festbeleuchtung stays separate |
| 2026-11-02 | Wave-5 review fix: scotopic night vision per pixel in the tone-mapping chunk (Larson 1997 V, Krawczyk 2005 blend, K 0.04 cd/m², cooler tint) gated by the night factor | night read as day for night; gating keeps every day frame pixel-equal; no post pass or new dependency |
| 2026-11-02 | Wave-5 review fix: the Kino look gets an ASC CDL look inside AgX and 0.6× haze; Dokumentation stays ungraded | AgX alone read grey at the tour's golden hour; documented colours stay 1:1 in Dokumentation |
| 2026-11-02 | KB-I41: own post chain on three r187 render targets (+ the built-in `three/addons` SMAAPass), not pmndrs `postprocessing` + `n8ao` and not r187 `setEffects` | no new dependency (n8ao 2.0.1 pins three < 0.188 peer); `setEffects` needs an output buffer type and its output pass cannot carry the night vision and Kino grade (`uGrade`); one grade pass keeps the cost at ≈ +1.1–1.4 ms at 1080p |
| 2026-11-02 | KB-I41: the scene target's MSAA steps down with the drawing buffer (4× ≤ 2.6 Mpx, 2× ≤ 4.2 Mpx, 0 above); SMAA off in all presets | the half-float MSAA target cost ≈ +6 ms at 3024×1964 (the old canvas MSAA was resolved in tile memory almost for free); SMAA cost +1.5 ms at 1080p for little gain |
| 2026-11-02 | KB-I41: AO acts on the ambient share only (a third on sunlit pixels, none on emissive), photos are exposed in the Kino look | screen-space AO stands for occluded sky light (GTAO practice); the Rundflug and stills share the cinematic look (KB-I46 decision) |
| 2026-11-02 | KB-I37: screen-space reflections in the grade pass instead of a planar reflector; no reeds; no Findlinge until the Schwanenweiher dams are in the catalogue | a reflector re-renders the scene (+2 ms+) per water level; no source documents reeds; boulders need located dams |
| 2026-11-02 | Wave-5 review fix: portal lanterns light their surroundings in screen space at 1.2 cd (≈ 15 lm), not with point lights | point lights cost every lit pixel; 1.2 cd matches a candle lantern and still gives a clear pool against moonlight |
| 2026-11-02 | Wave-5 review fix: Kino at low sun (3–24°) adapts less, fills less from the sky, shows a more saturated sky and less haze (`kinoLowSun`) | the 18:45 tour shot read as flat grey haze; Dokumentation stays physically calibrated |
| 2026-11-02 | KB-I21: Fachwerk changes only the wall thickness and reveal depth of flagged storeys (one `outerWall` helper for exterior, interiors and plans); render and masonry reveals unchanged | no source for the gallery's exterior finish beyond "hölzerner Gang" (T5); deepening every masonry reveal would change all buildings |
| 2026-11-02 | KB-I28: the Komödienhaus KB-B12a is a hypothetical, low-confidence 20 × 11 m hall on the W half of the S wing's S face; the workshops sit in the KB-B11 N wing (I) | T5 documents existence and attachment (D), not form or position; the N wing is the side wing with room |
| 2026-11-02 | KB-I29: the menagerie ring and rows are a pure layout (`layout/menagerie.ts`) replacing the GARD wall, with iron dropped from the light layer; no Cor-Ten and no find detail beyond T20 | T20 / T1 give counts and arrangement (D), sizes are I; the lean LOD1 keeps the light layer under 6 MB |
| 2026-11-02 | KB-I44 (wave 6): leaf cards from a procedural atlas on the nearest site trees and the forest hero/close tiers, faded by 220 m; no EZ-Tree atlas | no licence to record; the card set stays bounded (160 site instances, tier caps); supersedes nothing in the wave-3 clump decision, which stays the base |
| 2026-11-02 | Wave-6 lead check: four follow-ups promoted (KB-I64 shot determinism, KB-I65 retina and CPU cost, KB-I66 far crowns and conifers, KB-I67 menagerie setting); the explorer re-export still waits for the user's go | each is measured in `wave6-after*`; the light layer changed (new `KB-B12a`, menagerie, herm) but the format did not |
| 2026-11-02 | KB-I53: CdL massing kept (Sockel + EG + Beletage + mansard, centre to 366.2 m + lantern) | T1 / Molitor "einstöckig" = the 1760/61 core or a count of the upper floor only (I); LC 1790 shows two storeys + mansard and a higher centre (D); research/10 §d.4. The concealed stair is an optional interior item, position U |
| 2026-11-02 | KB-I39 / KB-I30: no Eremitage for 1789 | it dates from 1792 or later; KB-B87 ends in 1791 and KL-12 = KL-B44 |
| 2026-11-02 | KB-I39 / KB-I30 / KB-I31: follies, the Altan and the V23 zone items are `placement: 'hypothetical'`, low, with a ±50–100 m note; the Turkish pavilion is the existing Tschifflik KL-B46 | V23 and the documents prove existence, not position or form |
| 2026-11-02 | KB-I40: no Wildzaun line without a located source; the documented barrière and Le Clerc's fence wait for a fence feature kind (KB-I68) | no invented geometry (KB-I57 / KB-I23 precedent) |
| 2026-11-02 | KB-I60: the indoor look (EV, candle ambient, room environment, vegetation culling) applies only inside buildings with a drawn interior model; a room shell gets the outdoor EV + `SHELL_LIFT_EV` 2 × its unglazed share (I) | a glazed garden room is lit like the outside; GARD enclosures are open air |
| 2026-11-02 | KB-I65: from outside, interiors are drawn as a ground-level shell within `INTERIOR_DIST`; the full interior only for a visitor inside or within 6 m; point lights at 0 cd are hidden; the sky is cached in a 1024² cube (≈ 48 MB) | the mapped windows (KB-I42) replace the view through the panes; −900 calls and −3 ms CPU at the Ehrenhof |
| 2026-11-02 | KB-I06 (wave 7): Kino applies half the golden grade all day and the full grade below 12° sun; Dokumentation stays untouched | the cinematic look is for tour and stills; documented colours stay 1:1 |
| 2026-11-02 | KB-I42: interior mapping only on LOD2 panes with `aWin` / `aRoom`; LOD0/1, glbs and the light layer keep the flat proxy | no new vertex data in exports; the effect matters only near the camera |
| 2026-11-02 | KB-I62: `POSITION` int16 on a global 1/64 m grid under per-node translation + uniform scale; `sle-recon-v1` unchanged | ≤ 7.8 mm error, 5.88 → 4.11 MB; the explorer already bakes node matrices and the contract allows a quantisation transform |
| 2026-11-02 | KB-I35: vines in 3D only within 170 m (two tiers, cards within 20 m); beyond, the painted rows | bounded instance count; the painted bake was already matched to the near field |
| 2026-11-02 | Wave-7 lead check: KB-I68 (barrière), KB-I69 (SSR stripes), KB-I70 (Tempelzimmer doors), KB-I71 (folly setting) promoted; the explorer re-export still waits for the user's go | each is measured in `wave7-after`; the light-layer format is unchanged |
| 2026-11-02 | KB-I42 review fix: the mapped room behind a window is the catalogue room on that storey (or the generated hall); roof glass, service rooms and windows without a room show a dark cavity; curtains only muslin, cream or the room's silk | one room reads as one space from outside; no invented palette colours |
| 2026-11-02 | KB-I47 review fix: for a focus beyond 25 m the photo aperture is capped so that 15 m…∞ blurs ≤ 1.5 px | a far focus otherwise gave a tilt-shift miniature look |
| 2026-11-02 | KB-I48 (wave 8): Festbeleuchtung as a clearly labelled mode over the 1789 scene, lamps without point lights (points + additive pools), all windows of the illuminated buildings candle-lit; the "Dezember 1785" scene year stays open | audit §8 Q3 recommendation; the illuminations are D (1785), their arrangement I; ≈ 1,700 lamps for ≈ 4 draw calls |
| 2026-11-02 | Wave-8 review fix (KB-I48): the dense rotunda rings of the Festbeleuchtung belong to the 1785 fête rotunda KB-B13 in a 1785 scene only; the 1789 Tempelzimmer KB-B07 gets ordinary cornice and door lampions; label "Muster 1785, auf 1789 übertragen" | the rotunda section with lampions is the 1785 rotunda (research/10 §c.4, D); KB-B07 dates 1788–89 (T5, D); drawing it as the fête centrepiece conflated two years |
| 2026-11-02 | KB-I74 (wave-8 review fix): at low sun both looks get a warmer sun (3100–3500 K at 5–10°), less sky fill (× 0.72, exposure meter and white balance unchanged, key +0.12 EV), a bluer, green-trimmed shade and warm sun-side haze; 20° and above untouched | 01 / 03 / 15 stay pixel-identical, so the Dokumentation calibration at the hero and day hours holds; values [I] with sources in light.ts |
| 2026-11-02 | KB-I50 (wave 8): a static far shadow map (second lightless directional light, chunk patch) instead of cascades; the far forest impostors cast into it only | no per-frame shadow pass and no swimming; ≤ +0.45 ms at 1080p |
| 2026-11-02 | KB-I65 (wave 8): no `flat` varyings in viewer shaders | ANGLE/Metal provoking-vertex emulation rewrites index buffers per draw (≈ 10 ms per frame for the glass) |
| 2026-11-02 | KB-I52 (wave 8): the TF-08 wall foot is a ±0.8 m terrain ramp (`WALL_FOOT_IDS`) and the B02 W portico stands on a level 7 m forecourt pad with a grass bank (`PORTICO_PADS`), both I | the 1 m DTM sawtooth and the mound were raster artefacts; the 1789 forecourt level is U |
| 2026-11-02 | KB-I32 (wave 8): KB-B28 is drawn as Schneider's "Pavillon zu Carlsberg" with an E apse KB-B28a, both hypothetical / low; the Eiskeller reading stays the alternative | Petri / Schneider give form and clearing (D), the LiDAR pit KB-50 the place (I); no source decides between pavilion and ice house |
| 2026-11-02 | Wave 8 (architecture): Hemmer masts only on ridge high points (`hemmerMasts`, ≤ 32 m gaps); follies have their own facade sets without shutters or rods; KL-B50 a double up-swept roof (N comparison only) | Hemmer 1786 rods stand at the high points (D→); a garden folly is not a palace wing; still labelled "Hypothese" |
| 2026-11-02 | KB-I68 (wave 8): fences are a terrain-feature kind `fence` (timber, viewer-only, not exported); the Wildzaun stays unbuilt | only the barrière (PV 1791) and Le Clerc's court-mouth fence are located; the light layer keeps stone only |
| 2026-11-02 | Wave-8 lead check: KB-I72 (CdL emphasis), KB-I73 (vineyard far parcel), KB-I74 (low-sun warmth), KB-I75 (interior whites, mirrors), KB-I76 (leaf scale), KB-I77 (pond shores) promoted; the explorer re-export still waits for the user's go | each is measured or reported in `wave8-after`; the light-layer format is unchanged |
| 2026-11-02 | KB-I75 (wave 9): indoors by day the view through a window is pulled to 1 EV above the room exposure (max 4 EV), a logarithmic shoulder above 0.5 compresses highlights before the tone mapping, and the room environment's floor takes 20 % of the waxed oak's colour | interior-photography window pull and local adaptation [I]; outdoor frames and night stay unchanged (gated on `inside`, weight 1 − night) |
| 2026-11-02 | KB-I75 (wave 9): mirrors reflect via one static, box-projected 512² cube per room, captured one face per frame on entry and on a light change (hour to 0.05 h, look, celebration), never per frame; only the visitor's room, other rooms keep the model's image | a planar reflector or per-frame cube re-renders the scene (KB-I37 precedent); tin-amalgam glass is soft and ≈ 70 % [I] |
| 2026-11-02 | Wave 9 (night sky seam, pose 52): with the sun below the horizon the Preetham sky's zenith angle uses a smooth max(0, y) of width `HORIZON_SOFT` 0.06 (full from −4°, 0 by day, so every day frame is identical) | three's Sky clamps `direction.y` at 0, which kinks the optical depth ≈ 12 % below the frame top at night |
| 2026-11-02 | Wave 9: the "Dezember 1785" scene year (KB-I48) stays open | it needs every builder (exterior, interior, site, garden) to rebuild for year 1785 plus a winter state (bare trees, no lawn green, snow or frost); the festival lamps already take `year` |
| 2026-11-02 | Wave 9 (garden): grass blades are a camera-centred card disc (22 m) with `depthWrite` false, drawn after the terrain, and lit like the terrain | SSAO and SSR then ignore them (the depth-writing first cut drew dark AO clumps); a bounded disc keeps the cost independent of the lawn area |
| 2026-11-02 | KB-I77 (wave 9): natural ponds are shaped in the 1789 terrain (`prepare-terrain.py`) and their water is laid on the terrain's own 1 m vertices; formal basins keep the plane | the terrain contour is then the shore, with no separate outline to keep in sync; the SSR marker and the `water` material stay, so the reflection contract holds |
| 2026-11-02 | Wave 9 (garden): Petri's framing groups are new catalogue features TF-45…49 (hypothetical, low) appended after all others | the seeded tree streams stay prefix-stable, so no existing tree moves at the standard poses (wave-5 rule) |
| 2026-11-02 | KB-I72 (wave 9): the CdL perron spans the three centre axes with grey-pink sandstone treads; no balcony or entablature over the court portal | treads in the portal stone tie frame and stair together [I]; research/06, 07, 10 give no court-portal balcony (the LC portico belongs to the B02 head) |
| 2026-11-02 | KB-I22 (wave 9): the Hemmer head is a gilt knob with a vertical spike and four short level points; masts 0.4 × roof rise (1.2–3.0 m); 0.5 m points on roofs under 120 m² | keeps the NDB Fünfspitz form (D) while losing the aerial look; Hemmer's own height and spacing rules are not found (U) |
| 2026-11-02 | KB-I72 (wave-9 review fix): the CdL perron returns to the portal frame + 0.9 m (withdraws the wave-9 three-axis width), tagged D-> steps / HMS stair / N width, no LC; sentries on the first piers | no source shows a broad CdL perron: LC's broad Freitreppe belongs to the KB-B02 head (research/07 §1.1), and HMS (research/06 §3.3) shows a short stair between the sentry boxes; the 10 D-> steps stay against HMS's ≈ 5 (conflict noted in the tag); the narrower flight puts the sentry pair on the piers instead of in front of windows |
| 2026-11-02 | Wave-9 lead check: KB-I78 (lawn blades look and retina cost) and KB-I79 (rotated `axisRect` side audit) promoted; the explorer re-export still waits for the user's go | each is measured or found in `wave9-after` / the KB-B28 fix; the light-layer format is unchanged |
