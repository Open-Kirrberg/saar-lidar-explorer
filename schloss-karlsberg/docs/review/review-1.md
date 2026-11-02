# Review 1: model, viewer and plans (2026-11-01)

This is an independent visual and consistency review. It was read-only, apart from the screenshots in this folder.

Method:
- Ran `pnpm run test` and `pnpm run build`.
- Opened the viewer on :5250 in a new Chrome tab and drove it with `window.skb`.
- Scripted a walk with `controls.keys` and probed the scene with three's Raycaster.
- Sampled terrain via `controls.ground`.
- Compared against the HMS reference stills (interpretive only), Le Clerc 1790, catalogue v2 and research/08.
- Reviewed the plan previews in `docs/plans-preview/`.

## What works
- Tests 158/158, and `tsc` + `vite build` both pass.
- **Walk route passes.** Ehrenhof → Freitreppe → Vestibül → Prunktreppe → landing (348.8) → Beletage gallery (351.4) → Gardesaal → Antichambre → Audienzzimmer → Paradeschlafzimmer.
  - The enfilade doors lie on the building axis; the 9.5° grid rotation explains apparent offsets in local x/z.
- **Fly mode, POIs, the confidence colours and the info panel all work.** UI labels are German.
- **CdL court front matches across sources.** 15 = 4+7+4 axes at 2.65 m, the same in 3D, GR-01/02 and AN-01. The raised centre roof and lantern agree with HMS.
- The imperial stair (38 × 13.7/37.6) is the same in 3D, GR and SC-02.
- **Interiors read well.** Boiseries, parquet, glazed court windows, open double doors, warm candle light at night (`17`, `18`).
- **LP-03 scale and grid are correct** (100 m = 100 mm at 1:1000). Footprints sit on the KB features; the known HMS-vs-LiDAR deltas are documented.

## Performance (GPU timer query, 1920×1080, DPR 1, shadows on)

| View | GPU ms | CPU ms | Draw calls | Triangles |
|---|---|---|---|---|
| view-west (overview) | 10.1 | 2.1 | 806 | 2.98 M |
| view-ehrenhof | 2.4 | 3.2 | 1204 | 3.19 M |
| Festsaal | 2.2 | 3.5 | 1095 | 3.23 M |

- Totals: 2967 geometries; JS heap 423 MB.
- The CdL interior is 85k triangles in 355 meshes.

## Issues (most severe first)

| # | Sev | Area | Issue | Fix | Shot |
|---|---|---|---|---|---|
| 1 | high | exterior/plans | **B14 "Orangerie-Stützmauer" sits on the B10 W face line.** Its line runs 382228.3/5466005.8 → 382245.6/5465926.7; B10's W face runs 382228.05 → 382245.95. It is drawn as a separate blank 5.6 m wall in front of the high basement. In both 3D and AN-04 the W front therefore shows no basement windows (HMS shows a windowed ashlar basement), and the catalogue's own function string reads "W basement front". | Treat B14 as B10's basement façade: give the B10 basement storey its openings and skip the B14 solid where it coincides with the B10 footprint (or move B14 to the TF-07 W edge if it is a separate wall). | 16 |
| 2 | high | site/exterior | **Garden parterre TF-09 is above the EG floor.** TF-09 is at 347.40 and the EG floor at 346.20. The ground at the garden door is 345.55, so the door sill is ~0.65 m above grade with no steps (the plinth shows below it). | Set TF-09 to ≤ 346.0, add a garden perron/steps to the `garden` axis-7 portal, and re-run plans. | 03 |
| 3 | high | site | **Küchenhof terrain cuts the Galerie plinth in a saw-tooth.** B06 has base 347.6 over a 344.8 court. The coarse terrain ramp (TF-04 scarp) runs into the red plinth in ~3 m triangles. | Flatten TF-02 up to the B06 wall line (or add a retaining wall), and clamp terrain to `min(court, base)` under the footprint plus a 1 m apron. | 19 |
| 4 | high | interior | **Prunktreppenhaus window reveals don't match the exterior holes.** Rays enter the interior reveal and then hit exterior `render.lime` around 352.6. The result is blind grey niches on the court wall of the two-storey hall. | Take reveal rects for multi-storey halls from the same `layoutBuilding` openings as the exterior; add a test that each interior reveal lies inside an exterior hole. | 09 |
| 5 | med | exterior | **The CdL main roof reads almost white/metallic** (grazing env specular), while the raised pavilion roof is dark slate. | Slate roughness ≥ 0.75, lower `envMapIntensity`, one shared slate material. | 14 |
| 6 | med | exterior | **Arm W head pavilions lack the 4-column portico with balcony and broad Freitreppe.** This is documented by Le Clerc 1790 and the catalogue's portal text. The model has a plain door with a narrow stair. | Add a `portico` portal kind for `end_a` (B02, mirrored on B03 if intended). | 15 |
| 7 | med | site | **1789 terrain keeps ruin hummocks at the Orangerie W foot.** Heights reach 336.8–337.8 on the 335.2 bench and half-bury the basement door. | 1789 terrain: flatten a 3 m apron around every footprint to the adjacent terrace level. | 16 |
| 8 | med | site | **Parterre hedge lines overshoot the TF-09 polygon and sit off the CdL axis.** | Clip beds to the polygon and centre them on the palace-grid u axis. | 03, 04 |
| 9 | med | site | **Meadows render ochre/straw everywhere.** July 1789 should read green (HMS is green). | Green meadow albedo; keep ochre only for fields and paths. | 01, 02 |
| 10 | med | plans | **AN-01 omits the CdL Freitreppe (10 steps) and the arm-head steps** that exist in 3D. | Draw portal stairs in elevations from the shared layout portals. | AN-01 |
| 11 | med | exterior | **Orangerie W tiers are all round-arched with French-balcony grilles.** The catalogue specifies portes-fenêtres only on the E parterre side and two window tiers on the W. | W side: normal windows, no grilles. | 16 |
| 12 | med | viewer | **Info panel shows English catalogue prose in a German UI, and long lines are clipped at the right edge.** | `overflow-wrap:anywhere`; add a German `function_de`/summary field, or label the text "Katalogtext (engl.)". | 20 |
| 13 | low | interior | **Trumeau mirrors reflect the outdoor sky env,** giving a bright sun hotspot (Audienzzimmer). | Indoor mirrors: neutral env without sun, roughness ~0.35. | 12 |
| 14 | low | exterior | **Shutters #BDBAB2 vanish on the #ECE8DF render.** The colour is tagged N/U; HMS uses dark shutters. | Use a contrasting colour, or state the choice in the catalogue. | 06 |
| 15 | low | exterior | **Chimneys are oversized white render boxes.** | ~0.9×0.6 m stacks, sandstone colour, cap. | 14, 19 |
| 16 | low | realism | **Façades read cool blue-grey, and Ehrenhof gravel is near-white from the air.** | Check exposure/hemi tint against #ECE8DF; gravel albedo ~0.45. | 05, 15 |
| 17 | low | realism | **Trees are uniform dark icosahedra.** | Lobed crowns or impostors with hue/size variation. | 01 |
| 18 | low | interior | **Interior warning: Dienertreppe Süd leaves 2 doors unserved** (OG garderobe-süd, passage-cdl-süd-2). | Extend the stair run or drop those doors. | – |
| 19 | low | plans | **GR-01 omits the Vestibül columns built in 3D.** The EG plan also draws the return flights above the cut solid. | Read columns from the interior model; dash flights above the cut. | GR-01 |
| 20 | low | plans | **LP-03 draws TF-11 Ostachse in the LiDAR-Befund blue.** | Give avenues their own line style. | LP-03 |
| 21 | low | plans | **SC-02 "Querschnitt B–B" runs along the CdL's 40.9 m length.** | Rename it or add "(quer zur Hofachse)". | SC-02 |
| 22 | low | repo | **`plans/out` (32 MB) and `docs/plans-preview` (12 MB) are not ignored.** The root `.gitignore` patterns are unanchored (CLAUDE.md requires anchored). | Anchor the patterns; ignore `/plans/out/` or commit only the PDFs. | – |

## Not checked
- Real pointer-lock walking feel.
- The B02 Speisesaal, B04 Bibliothek and B10 interiors.
- Printed scale on paper.
- Karlslust close-ups.
- Every Grundriss sheet beyond GR-01/02.

## Fix round

Fix round 1, 2026-11-01. Each issue was checked with tests (`model/tests/fix-round-1.test.ts` 16, `plans/tests/fix-round-1.test.ts` 5; suite 179/179), `pnpm run build`, `pnpm run plans` (30 sheets), `pnpm run export` (92 buildings, round trip OK) and browser screenshots (`docs/screenshots/`).

| # | Status | Note |
|---|---|---|
| 1 | fixed | New `layout/walls.ts` `wallFreeSpans()`: a WALL line is built only where it is ≥ 0.8 m clear of other footprints. B14 now builds nothing in 3D. AN-04 labels it "(KB-B14) = Kellerfront". The B10 basement counts as the ashlar base and carries 24 windows plus the door (layout test). TF-07's E edge was moved onto the B10 W face. |
| 2 | fixed | TF-09 is a fixed 345.9 (was the DTM median 347.39). It is levelled into the slope with an 8 m talus. B01 garden door: 2-step perron from `grade_h` 345.9. Terrain samples on both sides of the garden face read 345.9. GR-01 draws "Freitreppe 2 Stg.". |
| 3 | fixed | `prepare-terrain.py`: under each footprint the value is the nearest outside value, clamped ≤ lowest floor − 0.05. Each building gets a 3 m flat apron at the adjacent levelled feature (else `base_h`) and a 3–6 m blend. B06 S court reads 344.8 flat to the plinth (screenshot `exterior-kuechenhof-galerie`). |
| 4 | fixed (diagnosis differs) | Rays showed the interior reveals and exterior holes already coincide. The "render.lime" hit was the exterior jamb continuing the interior jamb. The blind look came from reveals 1.33–1.5 m deep (risalit +0.5 m) seen at grazing angles. Fixes: splayed embrasures for straight-headed facade reveals ≥ 0.45 m deep (0.25·depth, ≤ 0.22 m per side), and interiors now cull terrain-buried openings exactly as the exterior does. New test: every interior reveal lies inside its exterior hole for all 7 detailed buildings, with burying terrain; a shifted reveal fails. |
| 5 | fixed | Slate roughness 0.88, tile 0.86. Roof materials skip the ARM roughness map; envMapIntensity 0.45. All roofs share one slate material, and the CdL roof reads dark. |
| 6 | fixed (B02 only) | New `portico` portal option. B02 `end_a`: 4 columns, balcony, 11-step Freitreppe with cheeks; drawn in 3D and AN-01. B03 has no documented `end_a` portico, so it is unchanged. Residual: the W ground in front of B02 is 341.6 (DTM today), so the stair lands on the 3 m apron at 344.8, which reads as a mound. The 1789 forecourt level there is U. |
| 7 | fixed | The apron rule from #3 sets the B10 W foot to 335.2 along its full length. The basement door is clear. |
| 8 | fixed | The parterre is laid out in the palace grid: axis v=0, 2.5 m walks, 1.2 m border. Hedge segments are clipped to the polygon and heights follow the terrain. Tubs stand only on the Orangerie parterre. |
| 9 | fixed | Lawn ×(0.50,1.06,0.40), meadow ×(0.50–0.64,0.94–0.97,0.36–0.40). Gravel and sand ways stay ochre. Checked in the aerial screenshots. |
| 10 | fixed | `stepsElev()` in `elevation.ts` draws steps, cheeks and the portico (columns, entablature, balustrade) for every layout opening with `steps`. AN-01 shows the CdL Freitreppe and the B02 portico (≥ 2 step groups, test). |
| 11 | fixed | New `window_kind: 'window'` for the B10 garden (W) side. Saal tier: 1.5×3.5 m, sill 0.7, round head (HMS). Upper tier: 1.4×2.8 m, sill 0.5, segmental. No grilles. The E parterre side keeps its portes-fenêtres (test). |
| 12 | fixed | `dd` has min-width 0 and `overflow-wrap:anywhere`; the grid uses `minmax(0,1fr)`. The labels "Katalogtext (engl.)" and "Katalognotiz (engl.)" carry `lang="en"`, and a German "Bautyp" row was added. URLs now wrap (checked in the browser). |
| 13 | fixed | Mirrors: roughness 0.35, envMapIntensity 0.7, a warm 16×8 room environment without sun. No sky hotspot in the Festsaal/Audienzzimmer. |
| 14 | fixed | Palace shutters are now dark grey-green #5E665B, tagged HMS (dark shutters); the hue is U. |
| 15 | fixed | Chimneys 0.9×0.6 m (kitchen 1.2×0.9) in plinth sandstone, with a cap and cover slab (test). |
| 16 | partly | Hemisphere sky #f1ede4; exposure 0.45 + 0.3·day. Gravel #ABA393 × (0.80,0.76,0.68). Façades read warmer, but the Ehrenhof is still light from the air. No numeric albedo check. |
| 17 | fixed | Lobed crowns (5 lobes; 2 in the forest LOD) with blended normals. 3 crown variants per species, more variation in hue and size. Cost: about +1.4 M triangles (see below). |
| 18 | fixed (B01) | The OG door Garderobe Süd → Dienertreppe Süd is dropped (`skipDoors`), and the cdl-süd passage was moved (`atByStorey`). B01 has 0 interior warnings. Not fixed: B04 (2 doors) and B05 (1 door) show the same warning, out of scope. |
| 19 | fixed | `columnsOf()` reads the columns from `interiorModel()`. GR-01 draws 8 cut shafts (poché), plinths and dashed architraves. Flights and mid landings that start above the +1.20 m cut are dashed and unfilled (test). |
| 20 | fixed | LP-03: reconstructed avenues are a translucent green band (row distance) with a green dash-dot axis. LiDAR avenue and path traces are blue double-dash, and LiDAR outlines stay solid blue. Legend updated (test). |
| 21, 22 | not in this round | Untouched (outside the assigned list). |

Performance after the fix round (GPU timer, 1920×1080, DPR 1, shadows on): view-west 6.5 ms GPU / 1.9 ms CPU / 820 calls / 4.36 M tris; view-ehrenhof 3.3 / 3.0 / 1218 / 4.56 M; Festsaal 2.8 / 3.2 / 1104 / 4.54 M. JS heap 445 MB. The triangle increase comes from the lobed tree crowns.

New observations (not fixed): the TF-08 terrace retaining wall S of B02 shows a jagged foot where the 1 m terrain meets it; the B02 portico mound (#6).
