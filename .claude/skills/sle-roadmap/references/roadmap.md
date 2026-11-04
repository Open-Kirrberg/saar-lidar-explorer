# 🗺️ Roadmap v2 — game shell

Ordered by dependency. Each item: **why** · **approach** · **acceptance** · **skill** · ADRs. Tick items (`[x]`, commit hash) and append findings to "Known issues". Decisions go into ADRs, not here. v1 backlog (R0 → F22, all done): [`docs/history/roadmap-v1.md`](../../../../docs/history/roadmap-v1.md).

Status: `[ ]` open · `[~]` partial · `[x]` done · ⏳ blocked

**v2 is done when:** the new shell runs on desktop + phone, CHM trees are in the overworld, castle (#1) and bakery (#2) are behind portals, and simple relict finding (lens, glow, *Merken*) works, all measured on the reference phone (2021 mid-range, 30 fps).

---

## V2.0 — Baseline 📏 (first)
- [~] **Why:** every v2 item is judged on the phone; we have never measured one (Q-22).
- **Approach:** run the v1.4 public build on a real mid-range Android + iOS Safari; record fps, memory and load time at 3 fixed views (`window.sle.flyTo`). ✅ Done: castle test skips without generated terrain; `verify.sh castle` gate.
- **Acceptance:** numbers in the commit + `app/README.md` "Performance".
- **Skill:** `sle-renderer` · ADR [0014](../../../../docs/adr/0014-audience-scope-devices.md)

## V2.1 — Removals & move-outs 🗑️
- [x] **Why:** smaller surface before the rebuild.
- **Approach:** apply [0020](../../../../docs/adr/0020-remove-move-out-freeze.md). Debug panel behind `import.meta.env.DEV`. F21 → own repo/tool; F22 → private repo (keep the public-build guards until the code is gone). Frozen features: off the UI, code kept, tests kept.
- **Acceptance:** public bundle has no F21/F22 code; `verify.sh` green; release-strip tests still pass.
- **Skill:** `sle-renderer`, `sle-pipeline`

## V2.2 — New shell + tiers 🧹
- [ ] **Why:** "zero structure"; new users should see ≈ 8 controls.
- **Approach:** new `app/src/shell/` per [0019](../../../../docs/adr/0019-feature-tiers.md) + [0024](../../../../docs/adr/0024-rebuild-shell-keep-core.md): HUD, tier setting (Standard / Entdecker / Labor), keybind button → roomy dialog, disclaimer banner, settings. Desktop and phone layouts from one component set. Existing features plug into their tier; nothing is hidden by CSS only.
- **Acceptance:** Standard shows only the 🟢 column; Labor reaches every v1 analysis tool; a11y kept (focus rings, labels, contrast); screenshots desktop + 390 px.
- **Skill:** `sle-renderer`

## V2.3 — Game minimap 🧭
- [ ] **Approach:** rebuild the minimap panel on Leaflet ([0006](../../../../docs/adr/0006-leaflet-minimap.md)): player centred, view cone, north-up/heading-up, minimal chrome, click-to-fly kept.
- **Acceptance:** heading matches 3D within 1° incl. grid convergence (numeric test).
- **Skill:** `sle-renderer`

## V2.4 — Real trees from the CHM 🌲
- [ ] **Why:** green curtains in the explorer; popping and moving trees in the castle ([0017](../../../../docs/adr/0017-real-trees-from-chm.md)).
- **Approach:** contract first: new `trees` layer (per chunk: id, E, N, h, crown r, type). Pipeline: CHM local maxima + watershed crowns. Renderer: instanced trees, LOD by stable id with cross-fade, wind amplitude low. Castle viewer consumes the same layer outside its modelled garden.
- **Acceptance:** tree count vs. a hand count on 3 plots (±15 %); no tree changes position between LOD levels (test); 30 fps on the reference phone over forest.
- **Skill:** `sle-pipeline` → `sle-renderer`

## V2.5 — Game look + Relikt-Blick lens 🔍
- [ ] **Approach:** default look = aerial ground + trees + houses + sky ([0018](../../../../docs/adr/0018-game-look-relikt-blick-lens.md)). Lens: trees fade, relief blends in, candidates glow; 3 variants + *Zeitreise* in Entdecker. *Merken* + note on top of the existing marker store.
- **Acceptance:** U2 from the PRD works on phone and desktop; relief lab unchanged in Labor.
- **Skill:** `sle-renderer`, `sle-relict-detection`

## V2.6 — Zone contract + portal 🚪
- [ ] **Approach:** write the zone contract next to `docs/data-contract.md` ([0016](../../../../docs/adr/0016-zone-kinds-zone-contract.md)): footprint, portal, spawn, assets/LOD, preset, attribution, evidence. Decide same bundle vs. separate app (new ADR). Portal + loading screen in the overworld.
- **Acceptance:** contract + ADR; a test zone (fixture) enterable and leavable, camera pose restored. Decide the zone folder layout and move `schloss-karlsberg/` there (done: `zones/schloss-karlsberg/`, ADR 0029) (≈ 140 path refs: Pages workflow, release scripts, `../` paths).
- **Skill:** `sle-pipeline`, `sle-renderer`

## V2.7 — Castle as zone #1 🏰
- [ ] **Approach:** castle viewer behind the portal (1789 only), Kino look default, Rundflug as entry, „Gehe zu“ ≈ 8 highlights, *Gewissheit* control; shared sky + trees.
- **Acceptance:** U1 end-to-end on the phone.
- **Skill:** castle skills in `zones/schloss-karlsberg/.claude/skills/`

## V2.8 — Captured zone pipeline + bakery 🥖 ⏳
- [ ] ⏳ Blocked on location + footage from Hoon (Q-36).
- **Approach:** move `zones/schloss-karlsberg/video2world/` (→ `tools/capture/`) out of the castle into a shared tool; automate it: video → frames → mesh (or splats, ADR [0027](../../../../docs/adr/0027-captured-zone-method.md)) → scale + georeference → zone package. Measure hours per zone.
- **Acceptance:** U3 works; one command from footage to zone; time per zone recorded.

## V2.9 — Tutorial + attribution ✨
- [ ] **Approach:** first-flight tutorial (replaces intro + tour); resolve [0026](../../../../docs/adr/0026-collapsed-attribution.md) „© Quellen“ (Q-33) before release.
- **Acceptance:** a new user reaches the castle without help (hallway test with 2 people).

## V2.10 — Release v2 🚀
- [ ] Reference-phone pass, `scripts/release/` + review, CHANGELOG line, PRD status.

---

## Known issues / notes log
- Carried from v1 (details: [`docs/history/roadmap-v1.md`](../../../../docs/history/roadmap-v1.md#known-issues--notes-log)): F15 precision unknown (Q-15); never run on a real phone (Q-22); canopy ends ≈ 1.9 km out (moot after V2.4); failed DSM / point tiles not retried until reload; F21 nothing printed (Q-26, moves out with F21); sld outlines beyond the AOI bbox (Q-30).
- V2.1: `scripts/release/export_data.py` still stages `data/print/` into `saar-lidar-data-2`; F21 now lives in `../sle-print` → drop that staging at V2.10 (humans decide whether the published 3MF series stays).
- V2.1: *Vollmondnacht*, shadow/cloud/resolution toggles never existed in the explorer (castle-only); only *Dunst* was removed.
- Castle vitest: heavy builds time out at 5 s under parallel load → `testTimeout: 30_000`.
- Automated Chrome tabs are often "hidden" → rAF paused; use `window.sle.step()` (it fires `sle:step`; any new rAF-driven overlay must listen to it).
