---
name: skb-schlossgarten
description: Models the gardens and landscape around Schloss Karlsberg (summer 1789) faithfully and beautifully - Petri's English Herzogsgarten behind the palace, parterres, terrace and Orangerie gardens, avenues, hedges, basins, ponds, cascade, Karlslust follies, fields, meadows, vineyard and forest edge. Gives the 1780s garden grammar with numbers, a planting palette, where it lives in code (catalogue terrain_features, model/src/site, viewer forest.ts/terrain.ts, prepare-terrain.py), vegetation budgets and a garden shot script. Use it whenever the user mentions the Schlossgarten, garden, park, Karlslust, tree species, forest extent, Allee, hedges, lawn, water, Weiher, fountain, landscape, ground colours or "the area around the castle" - also for "the garden looks empty", "those are the wrong trees", "why is the castle in a forest", "more wow around the palace" or "is the park historically right". Tree shading, leaf cards and forest culling are skb-visual-wow.
---

# Schloss Karlsberg: Schlossgarten and landscape (1789)

The viewer shows the residence as a **hypothesis** for summer 1789. Around the buildings that means a hybrid typical of
German courts in the 1780s [I, research/11 §1.1, §2]:

- **Formal work at the buildings**: gravel courts, the Orangerie parterre, the terrace garden S of the S wing, avenues on
  the roads, walled kitchen gardens.
- **A young English landscape garden behind the palace**: Bernhard Petri's Herzogsgarten (from 1788), with an open lawn,
  a belt walk, clumps, conifer and poplar accents, benches, pavilions, and **no parterre** [D BSB Cod.icon. 180 h 26r via
  Schneider; research/10 b.7 T5/T13].
- **A picturesque valley garden**: the Karlslust, with the cascade, the Schwanenweiher, the menagerie and exotic follies.
- **An open, cultivated ridge**: hay meadows, fields and a vineyard on the slopes. Forest appears only as belts, on the
  E plateau and in the valleys [D Pleine vue 1791, Petri plan; HMS].

The model today wraps the palace in a closed forest, because "today's canopy" is used as the 1789 forest. That is the
**largest visual and historical error** (research/11 G1), and opening the landscape is the biggest "wow" lever.

Paths below are relative to `zones/schloss-karlsberg/`. `references/…` and `scripts/…` are relative to this skill folder.

## Orient first

Read only as deep as the task needs:

1. `research/11-gardens-and-landscape.md`: read **§0** (key findings) and **§6** (specs S1–S16, new feature kinds, landcover
   shapes, perf, tests). Read §1 for the evidence of the zone you touch, §3 for planting and §4 for the grammar.
2. `research/03-lidar-site-analysis.md` **§4** (site by site), **§6** (design levels) and **§8** (what the LiDAR cannot
   tell). Positions and levels of courts, terraces, ponds and the cascade come from here.
3. `research/02` **§2.14** (garden elements) and **§3.2** (vegetation context). `research/10` **b.7** (Petri's garden from
   1788, the surviving tulip tree, the Karlslust arboretum) and **b.4** (menagerie houses). `research/06` **§3.7** (the HMS
   terrace garden, fences, terrain).
4. `docs/visual-audit.md` **§4.2** (what looks weak in vegetation and ground), **§5.6–5.7** (techniques) and **§6**
   (items P1, P10, P12, P15).
5. `docs/architecture.md` **§4.1** (TerrainFeature), **§4.3** (`avenueTrees`, `featuresOfKind`), **§5 rule 6** (buildSite).
6. `git status`: other agents may have uncommitted work. Never touch files you don't own for the task.

## Boundaries

- **Castle side only.** The explorer app in `../../` (`../../app`, `../../pipeline`, `../../docs`, `../../PRD.md`, `../../.claude`) belongs
  to another agent. It consumes the castle through `pnpm run export:explorer`. The light layer
  (`scripts/export-explorer.ts`) exports only **stone** site meshes (`site:<featureId>` nodes: walls, coping, cascade,
  wells), never trees, hedges, water or tubs. A new stone feature, such as a basin coping, therefore lands in the
  explorer. Keep it modest in triangles and give it the feature's confidence.
- **Sibling skills.** Building form, pavilion architecture, facades and rooms belong to `skb-historic-architecture`. Light,
  sky, fog, tone mapping and post-processing belong to `skb-visual-wow`. The overall improvement loop is `skb-improve`. This
  skill owns terrain features, landcover, ground classes, vegetation (species, placement, forest, culling) and garden
  furniture. For a garden pavilion, this skill decides siting, epoch, clearing and paths, and the architecture skill
  builds the building.
- Don't edit `viewer/src/handover.ts` or its test unless the task is about the handover.

## Where the garden lives in code

| Concern | File | Notes |
|---|---|---|
| Facts (what, where, level, species, confidence, tags) | `scripts/catalogue-v2/terrain.ts` → `model/catalogue.json` `terrain_features` | Never hand-edit `catalogue.json`. Edit the builder, then run `pnpm exec tsx scripts/catalogue-v2/build.ts`. 32 features today, TF-01…TF-44 |
| Types | `model/src/spec.ts` (`TerrainKind`, `TerrainFeature`, `AvenueTrees`), `model/src/validate.ts` (`TERRAIN_KINDS`) | A new kind or field changes spec, validate and `docs/architecture.md` §4.1 **in the same change** |
| Period norms | `model/src/layout/grammar.ts` (`AVENUE` today; add a tagged `GARDEN` block) | No garden numbers in consumers |
| Pure garden geometry | `model/src/layout/site.ts` (`avenueTrees`, `featuresOfKind`, `nearestOnLine`) | New helpers go here with tests: `clumpPlants`, `walkRibbon`, `parterreAnglaise`. The epoch filter is the shared `inEpoch()` from backlog KB-I03 (also used for buildings), not a garden-only copy |
| Rendering of features | `model/src/site/features.ts` (`buildFeatures`: switch on `f.kind`) | Terrace walls and gap stairs come from `site/access.ts` (`siteWalls`), so walk starts see the same walls |
| Trees | `model/src/site/trees.ts` (`SPECIES`, `speciesFor`, `treeMeshes`) | Instanced trunks plus 3 crown variants per species, deterministic |
| Forest | `viewer/src/forest.ts` (`Forest`: 320 m tiles, near/far levels), placement in `viewer/src/landcover.ts` (`forestPlan`, `openTreePlan`) and `viewer/src/hinterland.ts` (`hinterlandPlan`) | Pure, seeded placement on ground class 6 (1789 land cover) or the 2025 canopy. Wired in `viewer/src/main.ts` (`new Forest(terrain, …)`). The open-land planners order their trees on the base ground (`plannerBaseGround`, `meta.json` `ground.plannerBase`, KB-I96): a later land-cover edit of the open land goes into `PLANNER_BASE_SKIP` in `prepare-terrain.py` (and `GEWANN_FILL_IDS` if it is a fill), so it hides trees (`ghost`) but re-rolls none |
| 1789 terrain and ground classes | `scripts/prepare-terrain.py` (`CLASSES`, levelling, the forest rule, `put`) → `viewer/public/terrain/` (git-ignored) | **Reads `model/catalogue.json`**, so rerun it after any feature change that affects ground or levels |
| Ground look | `viewer/src/terrain.ts` (`groundTextures`, the splat in `onBeforeCompile`), `viewer/src/landcover.ts` (`packGround`, `GROUND_CLASS`), the far bake `viewer/src/landcoverBake.ts` | Ground classes are packed into several RGBA textures (`weights`: R lawn, G gravel/sand/cobbles/building, B forest, A water, meadow = rest; plus `hard`, `cult`, `macro`, `dist`) |
| Explorer export | `scripts/export-explorer.ts` | Stone-only site nodes, see above |

## What is wrong today (fix in this order)

The table follows research/11 §5 and §6.2. "S" ids are the specs there and "G" ids the gap analysis.

| Pri | Issue | Spec | Payoff |
|---|---|---|---|
| P1 | Forest = today's canopy > 8 m, more than 40 m from features (`prepare-terrain.py`): the palace sits in a clearing | **S1**: 1789 `landcover` polygons (forest belts, hay meadow, field, vineyard, kitchen garden). Keep today's canopy for epoch 2025 | ★★★ |
| P1 | TF-09 hedged 4-compartment parterre, cut up to 3.2 m into the slope | **S2**: Herzogsgarten lawn, a 6–8 m gravel garden terrace at 345.9 along the CdL front, a 3 m belt walk, 12–20 clumps, forest belts | ★★★ |
| P1 | No axial basin | **S3**: round basin on the CdL axis (v = 0, u ≈ +90…+130), D ≈ 14 m, jet, two stag heads, `epoch` 1783–1790 | ★★★ |
| P1 | `speciesFor('kastanie')` → Aesculus, and only 5 species exist | **S4**: castanea, populus_italica, conifer, shrub_flowering, taxus_cone, beech_old | ★★ |
| P1 | Catalogue facts (KB-B28 identity, TF-40; the Herzogskastanien are not in the catalogue yet, so their species lands with S13) | **S16**, cheap (backlog KB-I02) | — |
| P2 | Parterre "hedges" are 0.45 m kerbs (G3); TF-08 and TF-15 lack the period type | **S7/S8**: parterre à l'angloise, box edgings, yew cones, treillage | ★★ |
| P2 | TF-11 Ostachse limes are in no period plan | Trees → `hypothetical`, keep the line as an open vista (G4) | ★ |
| P2 | Ponds are flat planes without edges or jets; no vineyard; flat ground colours | **S10, S12, S15** | ★★ |
| P2/3 | Pavilions, benches, sculpture, kitchen gardens, Karlslust follies, Herzogskastanien | **S5, S6, S11, S13, S14** | ★–★★ |

## Rules (and why)

- **Evidence first.** Every new feature carries `confidence`, a `tag` string with D / D-> / I / N / U / HMS and its
  sources, as the existing TF entries do. Positions read off the Petri plan are ±20–30 m until it is georeferenced
  (research/11 §8 Q2). Say so in the tag, and use `confidence: 'low'`. Never invent a source. If a fact is not in research
  01–11, find and cite it, or tag it U.
- **Facts in the catalogue, norms in grammar, geometry in layout.** A clump's species mix is a catalogue fact. A box
  edging height is a `GARDEN` norm in `grammar.ts` with its tag. The placement of plants inside a clump is a pure,
  tested `layout/` function. Then the plans (`plans/`) and the 3D model cannot disagree.
- **Hypotheses are switchable; dates are epochs.** TerrainFeature has no `placement` field yet. Add
  `placement?: 'hypothetical'` rather than deleting doubtful features, with the same skip rule as buildings
  (`ctx.options.showHypothetical`). That option **defaults to true**, so "hypothetical" features still render; give
  them `confidence: 'low'` so the viewer's "Hypothesen (niedrige Konfidenz)" select can hide them, and say so in the
  report. Dates use `epoch?: { from?, to? }` (years, `to` inclusive, research/11 §6.1, backlog KB-I03), never
  `hypothetical`. The viewer is **summer 1789**: the stag basin (1783–1790) and the round pavilion at the CdL
  (1785–1792) are in. The Eremitage in the Karlslust (from 1792), the 1785 Orangerie rotunda and the 1785 Hymen temple
  are out (research/10 §0, b.2, b.4).
- **Young plantings.** Avenues and clumps date from 1778–1788, so trees are 5–8 m (grammar `AVENUE.height1789 = 6`). Mix in
  retained mature edge trees of 18–25 m. Full-grown baroque avenues are wrong for 1789 and also hide the buildings.
- **Determinism.** All randomness uses `mulberry32(hashString(id) ^ ctx.options.seed)`. A reload must give the same
  garden, and the before/after shots depend on it.
- **One frame.** Local `x = E − 381000`, `y = h` (true DHHN2016, no exaggeration), `z = −(N − 5465000)`. Garden layouts
  on the palace axis use `gridFrame(spec.palace_grid)` (u along the CdL axis at grid az 80.5°, v toward N), as the
  parterre code does. Never put raw UTM into float32.
- **Terrain and features agree.** A level set in the catalogue must be levelled in `prepare-terrain.py` too, or hedges
  float and walls stand in mid-air. Keep `lawn`-type gardens on the natural slope: the Petri garden was not cut into a
  platform. After any catalogue or terrain change, rebuild the catalogue, rerun `prepare-terrain.py`, then look.
- **Heritage.** The site is a protected monument. Don't publish find-spot hints beyond what is already published. For
  example, "the basin stood on the CdL axis" is published, but a measured DTM anomaly coordinate is not. Give no digging
  or detector guidance. Read-only DTM checks are fine, and their results stay in prose at the published precision.
- **No HMS imagery.** The HMS 2022 reconstruction is a reference for readings only. Don't use its frames or textures.
  Vegetation textures must be CC0 (Poly Haven, ambientCG), recorded in `viewer/textures.json`, and credited in the footer.

## Design grammar and planting

The numbers are in **`references/garden-grammar.md`**: avenues (d'Argenville width vs length, Sckell spacing), hedges
(box 0.15–0.25 m, banquette 1.0–1.3 m, palissade up to 5.8 m), the parterre à l'angloise module, paths (drives 4.4–7.8 m,
walks 2.3–3.9 m, footpaths 0.9–1.6 m), water edges and jets, benches and sculpture, plus a draft `GARDEN` block. Read it
**before** you add or change any garden geometry.

Species, colours, sizes and seasonal looks are in **`references/planting.md`**, with the proposed `SPECIES` entries,
the `speciesFor` rules, the forest mix, and the landcover classes and ground colours. Read it **before** you touch
`trees.ts`, `forest.ts`, the splat or `CLASSES`.

Each garden zone is listed in **`references/site-zones.md`**, with its TF ids, its levels, its verdict and the positions
in palace-grid (u, v) for new items. Read it when you place anything.

## Performance rules for vegetation

The measured baseline (2026-11-02, view-west, 1080p, M5 Pro, headless) is **4.36 M triangles with 820 calls**. The forest is
**28,381 trees in 4 InstancedMeshes, about 1.48 M triangles**, with bounding spheres about 2.15 km across. It is never
frustum-culled and it is drawn again in the shadow pass. Hiding it drops view-west to 1.41 M triangles. Details,
recipes and budgets are in **`references/performance.md`**. The short rules:

1. **Instance everything that repeats**, with one InstancedMesh per species and variant (as `treeMeshes` does). Never use
   one Mesh per tree, bench, stake or tub.
2. **Cull spatially.** Split instances into tiles of about 256–512 m, each with its own tight bounding sphere, so that
   three's per-object frustum culling works. Large single InstancedMeshes defeat it.
3. **LOD by distance.** Use leaf detail and stakes only near the camera (< 150 m), simple crowns in the mid range, and
   impostors or splat colour beyond about 400–600 m. Box edgings, vineyard stakes and bench detail are LOD0-near only.
4. **Shadows.** Let only near vegetation cast shadows. Far trees receive shadows but don't cast them.
5. **Budget.** Garden work may add at most **+0.5 M triangles net** at view-west (research/11 §6.4). Opening the landscape
   (S1) should remove far more than the clumps add. Measure before and after.
6. Animate wind and sway **in the vertex shader** and keep per-frame CPU work out of the instance loops.

## Workflow

1. **Plan** in 5–15 lines. Name the S ids, the files, any contract change (new kind or field → spec, validate,
   architecture §4.1), the tests and the shots.
2. **Catalogue**: edit `scripts/catalogue-v2/terrain.ts`. Add a tag and a confidence to every value. Then run
   `pnpm exec tsx scripts/catalogue-v2/build.ts`.
3. **Pure logic**: `model/src/layout/` plus vitest in `model/tests/`. Use research/11 §6.5 for the test list.
4. **Render**: `model/src/site/features.ts` and `trees.ts`, and in the viewer `forest.ts` and `terrain.ts`.
5. **Terrain**, if ground or levels changed:
   `cd ../../pipeline && uv run python -I ../zones/schloss-karlsberg/scripts/prepare-terrain.py`. This step reads
   `../../data/work` read-only. If `../../data` is missing, say so and verify only the code paths.
6. **Verify** with **`references/verification.md`**: tests, build, numeric checks, and before/after shots. For a
   backlog item the acceptance poses come from `node .claude/skills/skb-improve/scripts/shots.mjs --out
   <scratchpad>/KB-Ixx-before --poses <ids> --bench` (one pose namespace for the backlog). Add garden views and
   vegetation stats with `node .claude/skills/skb-schlossgarten/scripts/garden-shots.mjs --out
   <scratchpad>/<topic>-before --bench` (and `-after`); its pose ids are its own (its 03 is not the backlog's 03).
   Both run against the dev server on 5260.
7. **Record.** Add one line to `CHANGELOG.md` and update `docs/architecture.md` if an API listed there changed.
   Mark resolved items in research/11 §8 (open questions). Run `pnpm run plans --only LP-00 --only LP-01 --no-pdf` if avenues or
   features changed (LP-00 and LP-01 draw the gardens and the avenue trees, plans/README.md).
   Don't commit unless the user asks.

## Wow levers that are also true

Take them in roughly this order. Each is documented, and each changes a whole view:

1. **Open the ridge (S1).** A long white palace town on an open hill, pale gravel courts, dark avenue lines, a soft lawn
   garden behind, and dark forest only on the E plateau and in the valleys. Add July hay strips on the W slopes and
   golden fields to the N.
2. **The Herzogsgarten (S2) plus the stag basin with its jet (S3)** on the CdL axis. Seen from the garden front at about 07:00
   (sun 25° from 85°; backlog pose 15), this is the hero morning shot.
3. **A forest edge with a mantle**: a soft, noisy border of 6–10 m, a shrub band and taller standards (Überhälter). The
   border reads as landscape instead of a carpet.
4. **Avenues of young limes on stakes**, the Apfelallee with green fruit, and Lombardy poplars as columnar accents.
5. **The Orangerie parterre in summer**: lawn panels, a box edge, yew cones every 3.9 m, citrus tubs in rows, and the
   high W basement front above the slope.
6. **Water with edges**: Findlinge on the Schwanenweiher dams, a fountain jet in the Schwanenweiher, and the cascade
   sheet catching low sun.

Lighting quality (hero hours, IBL, haze) multiplies all of these. It is `skb-visual-wow`'s job, so coordinate the
shot hour with it.
