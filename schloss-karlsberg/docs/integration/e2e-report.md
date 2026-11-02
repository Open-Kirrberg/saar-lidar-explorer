# E2E integration check: explorer ↔ castle viewer (F19)

Date 2026-11-01. Chrome (claude-in-chrome, own tab), explorer dev `http://localhost:5240/` (PID 70424, untouched),
viewer dev `http://localhost:5260/` (PID 97675). Dataset `app/public/data/shared/karlsberg1789/` as exported by
`pnpm run export:explorer` (glb 4.64 MB, 92 nodes, 340,087 triangles). Frames driven with `window.sle.step(n)` /
`window.skb.step(n)`. Screenshots are only our own app renders.

## Results

| # | Check | Result | Numbers / evidence |
|---|---|---|---|
| a1 | Layer loads in AOI `karlsberg` | PASS | index + glb + footprints fetched; layer `ready` 122 ms after switching on (fetch 20 ms + meshopt decode + build), no console warnings |
| a2 | Placement over the LiDAR ruin terrace | PASS | top-down ghost view (01): wings sit on the ruin wall lines of the hillshade. KB-B01 centre at E 382262.3 / N 5466126.3 (anchor 382262.7 / 5466126.3). 2025 DTM under KB-B01 344.04–346.01 m, skirt bottom 343.52 m, eaves 356.0 m |
| a3 | Nothing floats (exag 1) | PASS after fix | on every visible part the lowest vertices are ≥ 0.50 m below the displayed 2025 terrain (max −0.50 m, median −0.67 m). Before the fix, 10 Karlslust buildings (KL-B40–49, south of N 5465000) hung past the AOI's south edge, up to 27 m above the edge-clamped terrain (see fixes) |
| a4 | Exaggeration 3 | PASS | the layer shares the terrain's `uExag` uniform; skirt bottoms are ≥ 1.51 m below the displayed terrain (03); handover `h` stays the true height (372.5 m at exag 3, camera display y 672.5) |
| a5 | Colour mode Konfidenz | PASS | `uMode` 1, legend high/med/low (04) |
| a6 | Ghost/opacity | PASS | slider 15–100 %; 45 % shows the ruin walls through the model (01) |
| a7 | Click-pick info card | PASS after fix | click on the south wing selects KB-B02 "Südflügel – Flügel der Herzogin" (name, confidence, eaves/ridge, sources, disclaimer, attribution); no pointer lock is taken. Before the fix the card opened about 2000 px down the panel, out of view (05 shows it after the fix) |
| a8 | Minimap outlines | PASS | 91 footprints drawn, coloured by confidence, low dashed (06) |
| b | AOI `overall` line-up | PASS | layer offset (3000, 0, −5000); KB-B01 centre again E 382262.3 / N 5466126.3; all 92 nodes visible and grounded (max −0.50 m); same pose renders identically to `karlsberg` (07 vs 04) |
| c1 | "Schloss betreten" only within 300 m and only with the layer on | PASS | 516 m: hidden; 299.7 m: shown; 300.7 m: hidden; in range with the layer off: hidden; shortcut row R/T in the HUD |
| c2 | Explorer → viewer (fliegen, button click) | PASS | URL `?src=explorer&E=382200&N=5465980&h=372.5&heading=20&pitch=-12&mode=fliegen&back=…`; viewer camera E 382200.00 / N 5465980.00 / h 372.50 / heading 20.00° / pitch −12.00°, mode fly (08 vs 09: same framing) |
| c3 | Explorer → viewer (key T) | PASS | pose 382235.5 / 5466082.1 / 347.1 / 350.5° / 3.3° taken over exactly |
| c4 | Explorer → viewer (zu Fuß) | PASS (with a model issue, see open issues) | mode walk at POI `KB-B02/durchfahrt-garden-11`, 68.5 m from the handed-over point, facing the passage (12) |
| c5 | Viewer → explorer (key M) | PASS | after moving the viewer camera to 382300.04 / 5466050.06 / 360.26, heading 300°, pitch −5°, the explorer opens at `#382300,5466050.1,360.3,300,-5,opns_pos,live-slope,0.55,off,1,315,35,1` (fields 6–13 kept), `aoi=overall` query kept, camera heading 300 / pitch −5 / h 360.3 (10 → 11) |
| c6 | Viewer → explorer ("Zurück zur Karte" button) | PASS | the walk pose h 345.7 came back; the explorer lifted it to 347.1 (2025 ground 345.08 + its own minimum clearance), which is expected because the two apps use different terrains |
| c7 | Open-redirect guard | PASS | `back=https://evil.example/…` gives `handover.back = null`; return target `http://localhost:5240/#382262,5466000,360,0,-10` |
| d1 | Explorer GPU time over the palace (EXT_disjoint_timer_query, median of 40 frames, 3 alternating runs, view 04) | PASS (moderate cost) | 1920×1080 at DPR 1: off 23.0–28.2 ms, on 25.4–26.9 ms (about +3 ms). Native 3142×1648: off 36.6–45.8 ms, on 44.8–48.0 ms (+3 to +8 ms). Draw calls 33 → 86, drawn triangles 1.80 M → 2.03 M. The baseline is dominated by the terrain/relief shader ("Offenheit + × Hangneigung live"); the reconstruction is a small share of it |
| d2 | Load size/time | PASS | buildings.glb 4.64 MB (4,533 KiB transferred), index.json 37.6 kB, footprints 28 kB; from local dev: glb fetch 20 ms, layer ready 122 ms |
| d3 | Viewer reference | info | full viewer at 1080p: GPU 3.5 ms, CPU 2.3 ms, 781 calls, 4.59 M triangles |

## Fixes made in this phase

1. `app/src/reconstruction/ReconLayer.ts`: building nodes whose bounding box is not fully on the AOI terrain are hidden.
   They are also left out of picking and the ghost depth pre-pass. `site:` nodes only need to overlap the AOI. This
   affects KL-B40–49 in AOI `karlsberg`; in `overall` all 92 nodes are shown.
2. `app/src/reconstruction/Reconstruction.ts`: the info card scrolls into view when a building is picked
   (`scrollIntoView({block:'nearest'})`).
3. `app/tests/reconstruction.test.ts`: the fake terrain gets `size`/`cellSize`, plus a new test that a building
   sticking out of the AOI is hidden and not pickable while a site node stays visible (21 tests).
4. `docs/data-contract.md` ("Placement in an AOI"): documents the rule above.

Gates after the fixes: `.claude/skills/sle-roadmap/scripts/verify.sh` reports ALL CHECKS PASSED (app tests, typecheck,
build, 199 pipeline tests); `schloss-karlsberg`: `pnpm run test` (209 passed) and `pnpm run build` OK.

## Open issues (not fixed, castle model / follow-ups)

- ~~Walk start at the KB-B02 garden passage cannot be entered~~ — fixed, see "Fix round 2" below.
- ~~The footer attribution repeats the label prefix~~ — fixed in the explorer (`reconFooterText`).
- Fixed after review: the site walls were one merged `site:walls` node that reached about 340 m past the south edge of
  AOI `karlsberg`. The export now writes one `site:<featureId>` node per feature; the Karlslust cascade (`site:TF-30`)
  lies wholly outside the AOI and is hidden, and the other 7 site nodes lie fully inside it.
- Heights differ between the 1789 and 2025 terrain, as documented: a walk pose handed back can be lifted by about 1–2 m
  in the explorer.
- With exaggeration > 1 the buildings are stretched with the terrain, as the spec requires. That is correct but looks
  odd at 3× (03). Fading out the layer at high exaggeration is a possible UX follow-up.
- The viewer dev server listens on IPv6 only, so `localhost:5260` works and `127.0.0.1:5260` does not. Not changed:
  Vite's default host already is `localhost` (Node resolves it to `::1`; the explorer on 5240 is the same), and
  `0.0.0.0` is ruled out (local-only). Documented in `docs/explorer-integration.md` §4.
- Not verified: live pointer-lock / walk feel and real frame pacing in a visible tab.

## Fix round 2 (same day)

1. **Walk start reachable.** The 1.5 m "plinth wall" in front of `KB-B02/durchfahrt-garden-11` was the TF-03
   terrace retaining wall (top = terrace level + 0.35 m parapet) running along the S-arm face, right across the
   passage; TF-08 below lies 0.74 m lower. The model now cuts a gap into terrace walls in front of Durchfahrten at
   terrace level and adds steps down to the ground (`model/src/site/access.ts`, rendered by `site/features.ts`):
   KB-B02 garden (5 steps) and KB-B04 garden (6 steps; its TF-03 wall stood 4.5 m out). Behind the wall a second
   blocker showed up: the 8 cm plinth-top ledge and the plinth course moulding ran uncut across every Durchfahrt
   arch at EG floor level (346.0–346.2 m, 1.4 m above the passage floor), a floating strip that also stopped the
   walker in the doorway. Both are now cut at Durchfahrten (`exterior/facade.ts`, test probes the arch zone of all
   six Durchfahrten at LOD 1 and 2). Entrance POIs carry `walkable`; `pickWalkStart` ranks reachable entrance →
   building view point → blocked entrance (`KB-B02/portal-end_a-1`, Freitreppe ending beyond the terrace edge).
2. **Walk fallback heading.** With no POI within 200 m the walker faces the nearest building centre (else the
   palace grid origin) horizontally instead of keeping the explorer heading.
3. **Minimap** draws only footprints whose building the 3D layer shows (KL-B40–49 absent in AOI `karlsberg`).
4. **Footer** credit without the repeated "Rekonstruktion 1789 (Hypothese):" prefix.

Re-export: 99 nodes (91 buildings + 8 site), 340,291 triangles, buildings.glb 4.65 MB, round trip OK.

Browser check (Chrome, own background tab, frames via `window.skb.step`, viewer dev server reloaded by HMR):

| Check | Result | Numbers |
|---|---|---|
| `?…E=382200&N=5465980&…&mode=gehen` start | PASS | walk mode at `KB-B02/durchfahrt-garden-11` (still the nearest entrance, now `walkable: true`), facing the passage (13) |
| Hold W | PASS | 1.6 m/s; climbs the new steps (+0.74 m, eye 345.71 → 346.45) at 4–5 s and walks on through the passage into the court: 22.4 m after 14 s, no stop (before: stopped after 6.4 m at the wall; after the steps alone: stopped 0.44 m before the facade at the ledge) |
| Far-side fallback `E=381250&N=5466000&heading=200&mode=gehen` | PASS | nearest POI 289 m away → ground at (E, N); heading 85.8° = direction to the nearest building centre KB-B30c (255 m), pitch 0 (handed-over heading 200° ignored) |
| `walkable` flags | PASS | 7 of 8 entrance POIs true, `KB-B02/portal-end_a-1` false |

## Screenshots

01 top-down ghost 45 % over the hillshade · 02 oblique exag 1 · 03 oblique exag 3 · 04 Konfidenz · 05 pick + info
card · 06 minimap footprints · 07 AOI overall, same pose · 08 explorer before "Schloss betreten" · 09 viewer after the
handover (fliegen) · 10 viewer moved, before M · 11 explorer after M · 12 viewer after "zu Fuß" (before fix round 2) ·
13 walk start after fix round 2: steps in the TF-03 wall gap, open arch.
