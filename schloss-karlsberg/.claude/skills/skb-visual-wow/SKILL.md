---
name: skb-visual-wow
description: Art direction and rendering quality for the Schloss Karlsberg 1789 viewer - target look (period-correct but cinematic: golden hour, dusk, candle-lit night, Festbeleuchtung 1785), sun/sky/IBL calibration, haze and height fog, tone mapping (Neutral vs AgX), post (AO, SMAA, bloom), shadows, PBR and colour management, weathering, glass and lit windows, tree/lawn/gravel/water shading, forest culling and LOD, Rundflug and photo mode, the frame budget measured with skb.gpuBench. Use it when the user complains about lighting, sky, shadows, haze, night, candles, glass, how trees or water are shaded, or frame rate in the castle viewer, or wants it more cinematic - e.g. "it looks like a 2010 game", "golden hour looks muddy", "the trees look like toys", "why is it so dark at dusk", "add a fly-around", "make it faster on my MacBook". Open-ended "make it better" requests go to skb-improve; what is historically right to skb-historic-architecture; garden content and tree species to skb-schlossgarten.
---

# Schloss Karlsberg viewer: visual quality ("wow") and rendering

You are the art director and rendering engineer for the castle viewer. The goal is a reconstruction that looks
cinematic and believable **and** stays an honest, period-correct hypothesis, at about 60 fps on an M-series MacBook.

Paths are relative to `schloss-karlsberg/` (the sub-project root). `references/…` and `scripts/…` are relative to
this skill's folder (`.claude/skills/skb-visual-wow/`).

## Orient first

1. `docs/visual-audit.md` is the baseline for this skill: measured costs (§3), what looks weak (§4, issues L1–L7,
   V1–V6, B1–B5, I1–I3), techniques for three r187 (§5), and the ranked backlog P1–P20 (§6). Its screenshots are in
   `docs/visual-audit/`. Read §1 and §6 every time, and the §5 subsection for the area you touch.
2. `CLAUDE.md` and `docs/architecture.md` §3.5 (LOD), §3.6 (materials), §7 (gates). Material names
   (`MATERIAL_NAMES` in `model/src/context.ts`) and `PartUserData` are a contract. Don't rename them.
3. `README.md` changelog, to see what changed since the audit (2026-11-02).
4. The reference file for your area (table below).

Then tell the user in 2–4 lines what you'll change, which audit items it closes, and the expected frame cost.

| Read | When |
|---|---|
| `references/look-and-period.md` | Any change to how things *look*: the target look, palette, time-of-day presets, night and Fest rules, what "period-appropriate" forbids, wow levers that need no new evidence |
| `references/light-sky-post.md` | Sun, sky, IBL, exposure, fog/haze, twilight, tone mapping, post chain, shadows, interiors lighting |
| `references/materials-vegetation-water.md` | PBR values, colour management, textures, weathering, vertex AO, glass, lit windows, trees, hedges, lawns, gravel, water |
| `references/performance-and-review.md` | Frame budget, measuring with `skb.gpuBench`, quality presets, and the fixed-pose before/after review procedure |

## Who owns what

- **This skill** decides *how* things are rendered: light, atmosphere, post, shading, LOD, camera work, performance.
- **What** is there and its historical colour belongs to the evidence chain: building facts and colours go through
  the catalogue (`scripts/catalogue-v2/`) and `layout/grammar.ts` with evidence tags (skill `skb-historic-architecture`).
  Landcover, planting and garden layout go through `skb-schlossgarten`. Don't "fix" a historical colour in a
  shader to make a shot prettier. If the look needs a different colour, change the documented value at its source,
  with a tag, or don't change it.
- **The explorer app in `../`** (`../app`, `../pipeline`, `../docs`, `../PRD.md`) is owned by another agent. Make
  castle-side changes only. The explorer consumes the castle through the light layer (`pnpm run export:explorer` →
  `../app/public/data/shared/karlsberg1789/`, contract `docs/explorer-integration.md` §2): one vertex-colour
  material, `COLOR_0` in **linear** RGB baked from `MATERIAL_BASE`, plus `_CONF`. So:
  - viewer-only effects (sky, fog, post, tone mapping, shadows, forest, Rundflug) live in `viewer/src/`;
  - a change to `MATERIAL_BASE` colours or to exterior geometry **does** change the light layer. Run
    `pnpm exec vitest run model/tests/explorer-export.test.ts`. Re-export only when the change is meant to ship,
    and say so in your report, because it overwrites files the explorer agent tests against;
  - new per-vertex attributes (e.g. `_AO`) need a contract update in `docs/explorer-integration.md` §2.2 *and* a
    note for the explorer agent. Don't edit `../docs/data-contract.md` yourself.
- `viewer/src/handover.ts` is the camera handover contract with the explorer. Visual work doesn't touch it.

## Mental model of the current renderer (verify line numbers, they drift)

- `viewer/src/main.ts`: one `WebGLRenderer` (`antialias`, `preserveDrawingBuffer: true`, DPR `min(dpr, 2)`),
  `ACESFilmicToneMapping`, no post chain.
  - `updateSun()` drives everything from `state.hour` on 15 Jul 1789 (`viewer/src/sun.ts`, NOAA, local mean time):
    - Preetham `Sky`. The visible sky is scaled ×0.3 by a shader string patch; the PMREM env is built from an
      *unscaled* twin (`envSky`). This mismatch is root cause L1.
    - `HemisphereLight` fill 0.2–1.1, sun `DirectionalLight` 3.2·day with an HSL colour ramp,
      `environmentIntensity` 0.02–0.07, exposure `0.45 + 0.3·day`, `FogExp2('#c9d6e0', 0.00016)` with a fixed
      cool hue.
  - Shadows: one 4096² map, frustum fitted per frame (60 m walk, 120–700 m fly), texel-snapped, redrawn every
    frame. `PCFSoftShadowMap` is removed in r187 (console warning), so it is PCF with radius 1.
  - LOD by distance: LOD1 < 650 m, LOD2 + interiors built lazily < 140 m. Interiors are shown < 45 m, and only
    the nearest one has its lights on.
- `model/src/materials/index.ts`: one material per `MATERIAL_NAMES` entry, colours in `MATERIAL_BASE`.
  - Textured sets use `lumaPatch`: the texture modulates luminance only, so the albedo stays the catalogue colour.
    The patch is installed through `onBeforeCompile` + `customProgramCacheKey`. **Chain** any new patch onto the
    existing callback, never overwrite it.
  - Colour maps are `SRGBColorSpace`; normal and ARM maps are `NoColorSpace`. `aoMap` is null.
- `model/src/site/trees.ts` + `viewer/src/forest.ts`: lobed icosahedron crowns in `InstancedMesh`es. The forest
  is 28,381 trees on ground class 6 (today's canopy, tag U for 1789), never frustum-culled (bounding sphere about
  2.15 km). It is the single largest cost.
- `viewer/src/terrain.ts`: chunked terrain with a ground-class splat patch (lawn, meadow, gravel, forest, water).
- Test hooks: `window.skb` = `{ scene, camera, renderer, controls, state, pois, entries, step, goto, setMode, set,
  bench, gpuBench, triangles, handover, backUrl, placed }`. Automated tabs are often hidden (rAF paused), so drive
  frames with `skb.step(n)`.

## Principles (and why)

1. **Reclaim frame time before you spend it.** At full retina (3024×1964) aerial and golden-hour views already
   take 13–21 ms GPU (audit §3). Forest culling (P1), shadow caching (P2) and a DPR cap / quality presets (P7)
   come before any post effect. Otherwise every "wow" item makes the MacBook experience worse.
2. **Fix light as a radiometric model, not with sliders.** The audit's A/B (`docs/visual-audit/ab-*.jpg`) shows
   that raising `environmentIntensity` alone turns everything cyan and lights interiors with sky. Use one sky
   radiance for the background and the IBL, a sun:sky illuminance of about 3:1–8:1 at high sun, an EV curve over
   sun elevation, a blackbody sun colour, and a twilight floor (`references/light-sky-post.md`).
3. **Documented colours survive the pipeline.** The default "Dokumentation" look uses Khronos PBR Neutral tone
   mapping, so `#ECE8DF` render and `#A65E4A` sandstone read as authored. Use AgX + LUT grading only in the
   "Kino" look (Rundflug, photo mode). This was audit §8 Q2; the backlog (KB-I41) decides it by this
   recommendation unless the user objects. Log it in the backlog's Decisions log when it lands.
4. **Wow from period truth, not invention.** The best levers are documented or period-normal: raking 17:30 light
   on the west court front, low sun on hand-made crown glass, blue-grey slate against red Biberschwanz service
   roofs, gilt gate tips, candle-lit rooms, an open young landscape garden instead of a forest clearing, and the
   documented 1785 illuminations (research/09 §6.6, research/11 §0, audit §5.10). No electric light, no lens flares
   on everything, and no invented ornament.
5. **Bake what the generator knows.** Cavity and contact AO for reveals, soffits, cornices and the wall foot goes
   into the generator as a vertex attribute (free at runtime, survives glb). Screen-space AO only adds what the
   generator can't know.
6. **Deterministic and testable.** All randomness (lit windows, tree variants, weathering, glass jitter) comes from
   `mulberry32(hashString(id) ^ seed)`. Pure maths (EV curve, blackbody colour, fog colour, lit-window choice, tour
   easing, quality controller) goes in pure modules with vitest tests: `viewer/src/*.ts` without three/DOM imports
   (like `sun.ts`), tests in `viewer/tests/`. Generator helpers go in `model/src/layout`.
7. **Hypothesis stays visible.** Fest mode, lit-window share and lamp arrangement are hypotheses. Label them in
   German in the UI ("Festbeleuchtung (wie 1785 beschrieben, Anordnung Hypothese)"). Keep "Schauen, nicht graben"
   and the attribution in the footer and burned into photo-mode exports.

## Work order: `docs/improvement-backlog.md` is the queue

The audit's P-items live on as backlog items. Pick them in the backlog's index order and tick them **there**
(status + hash + measured numbers), not in the audit:

| Audit | Backlog | Audit | Backlog | Audit | Backlog | Audit | Backlog |
|---|---|---|---|---|---|---|---|
| P1 forest culling | KB-I10 | P6 hero hours | KB-I08 | P11 night | KB-I43 | P16 weathering | KB-I19 |
| P2 shadow caching | KB-I04 | P7 DPR/presets | KB-I05 | P12 ground | KB-I45 | P17 Fest 1785 | KB-I48 |
| P3 light budget | KB-I06 | P8 glass | KB-I42 | P13 Rundflug | KB-I46 | P18 atmosphere | KB-I49 |
| P4 fog/haze | KB-I07 | P9 vertex AO | KB-I20 | P14 photo mode | KB-I47 | P19 far shadows | KB-I50 |
| P5 post chain | KB-I41 | P10 tree look | KB-I44 | P15 water | KB-I37 | P20 WebGPU | KB-I51 |

The backlog order differs from the audit in one deliberate way: forest culling (KB-I10) runs after the light items
and KB-I09, and the quick wins KB-I15/KB-I14 come right after KB-I08. Headroom first still holds: KB-I04 and KB-I05
come before any post effect. One backlog item (or one tight bundle in the same files) per cycle. Landcover
(research/11 S1, backlog KB-I09: replace "today's canopy = forest" with 1789 landcover) is the largest historical
**and** visual lever. It belongs to `skb-schlossgarten`, but it changes the forest cost, so re-measure after it lands.

## Workflow for one item

1. **Before shots + numbers.** Start or reuse the dev server. Check the port first:
   `lsof -nP -iTCP:5260 -sTCP:LISTEN`; if nothing is listening, run `pnpm run dev` (5240/5250 belong to the
   explorer, so never use them). Then:
   ```bash
   node .claude/skills/skb-improve/scripts/shots.mjs --out <scratchpad>/KB-Ixx-before --poses <ids> --bench
   ```
   This is the canonical driver: poses 01–11 reproduce the audit exactly, 12–15 add the Karlslust, the Galerie,
   and the hero hours (14 = Ehrenhof 17:30, 15 = garden front 07:00). `--bench` measures 1080p **and** 3024×1964
   per pose; `--eval "<js>"` runs a runtime A/B toggle; `--list` shows the poses. Use the backlog item's pose list,
   and the same command for before *and* after. This skill's own `scripts/shots.mjs` (`--only`, `--setup`,
   `--retina`) is kept for ad-hoc looks, but its 04, 05 and 11 only approximate the audit cameras and its ids
   overlap, so never cite its shots as backlog poses.
2. **Plan** in chat (5–10 lines): files, the backlog item(s), new deps with exact pins and why, expected ms, tests.
   New runtime dependencies (e.g. `postprocessing` 6.39.6 + `n8ao` 2.0.1, which cap three at < 0.188) follow the
   backlog's recommendation (KB-I41: pmndrs + n8ao, pinned exactly) unless the user objects; record the choice in
   the backlog's Decisions log (audit §8 Q1).
3. **Implement** in the owning files (audit §6 "Files" column). New viewer modules: `viewer/src/atmosphere.ts`,
   `post.ts`, `quality.ts`, `tour.ts`, `photo.ts`, `festival.ts`. Keep `main.ts` edits small and re-read it
   before each edit, because other agents may touch it. Extend `skb` with hooks for anything you add
   (`skb.look(name)`, `skb.quality(preset)`, `skb.tour(id, t)`, `skb.pose(...)`), so it can be reviewed headless.
4. **Gates:** `pnpm run test` and `pnpm run build`, plus new unit tests for any pure logic.
   `.claude/skills/skb-improve/scripts/verify.sh` runs the full castle gate (test, build, catalogue
   reproducibility, export round trip).
5. **After shots + numbers** with the same command into `…/after`. Compare pose by pose with the checklist in
   `references/performance-and-review.md`. Look at every image yourself (Read the JPEGs). Check the driver's stdout
   log for console warnings and errors.
6. **Record:** tick the backlog item with measured numbers, and add a README changelog entry with before/after
   GPU ms (1080p and retina) for the worst pose, the images you compared, what wasn't verified (live frame pacing,
   pointer-lock feel, other Macs), and any new decision (backlog Decisions log). Keep full shot sets in the
   scratchpad; commit only 2–4 representative pairs to `docs/shots/KB-Ixx/`. Update `docs/architecture.md` if an
   API or the material contract changed. Don't commit unless the user asks; follow the parent repo's commit style
   if they do.

## Acceptance bar for "looks better"

- No regression at the item's poses, and none at 01, 04, 08, 14 and 15 for any light or post change (compare
  side by side, not from memory).
- Worst pose at 3024×1964 ≤ 16.7 ms GPU now. After pass 2, aerial ≤ 12 ms at retina on the M5 Pro, so that
  weaker M-series chips can run the "Mittel" preset. 1080p stays ≤ 8 ms. Compare only within one run: headless
  timings vary ±50 %.
- Catalogue colours unchanged in Dokumentation mode. Sample a sunlit render patch and a shaded one: the hue stays
  warm-neutral, and shade reads cooler than sun, not grey-green (audit L2).
- No new console warnings. No hidden cost: report draw calls and triangles too.
- Every period claim in docs or UI carries a tag (D, D->, I, N, U, HMS) and a source. Technique claims carry a URL
  or a paper. Measured numbers say "measured", estimates say "[I]". Never invent a source, and never copy HMS
  frames or textures (© Matzerath / Historisches Museum Saar). Leaf, bark and other textures must be CC0, with
  attribution recorded in `viewer/textures.json` and the footer.
