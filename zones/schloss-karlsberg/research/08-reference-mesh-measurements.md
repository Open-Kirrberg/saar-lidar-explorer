# 08 — Reference meshes from the HMS video: registration and measurements

> Date: 2026-11-01. Source: "3D-Rekonstruktion und Animation: Schloss Karlsberg 1789",
> © Architekturvisualisierung Matzerath + Historisches Museum Saar (2022). Shot list:
> [06-video-analysis.md](06-video-analysis.md). Recipe and limits: [04-video-and-video2world.md](04-video-and-video2world.md).
>
> **Copyright.** The meshes, textures and renders made from the video are private reference material. They live
> only in the git-ignored `video2world/work/`. This file and `video2world/measurements.json` record **numbers only**.
> Every number taken from the meshes is tagged **[HMS]**.
>
> **What the numbers are.** They measure *the HMS CG model*: a modern, research-based hypothesis (Schwan). They do
> not measure the 1789 buildings. Rank: LiDAR foundations [D] > period sources [D] > HMS > period norms [N].
> Where HMS disagrees with the LiDAR, the LiDAR footprint stays and the conflict is listed (§6, §7).
>
> **Tags** (as in the other files): [D] documented · [D->] derived · [I] inferred · [N] period norm · [U] unknown ·
> [HMS] measured on the registered HMS mesh · [T] tool or registration statistic.

---

## 1. Key results (short)

1. **Pipeline works on a Mac without NVIDIA [T].** Apple Object Capture (RealityKit `PhotogrammetrySession`) rebuilt
   every daylight aerial shot except S06 alone. The combined palace run (S04+S06+S08+S09, 160 frames) registered
   all 160 frames. Registration to the LiDAR used 7 control lines: scale ±0.6 %, control RMS **1.3 m**.
   The two independent single-shot runs give RMS 1.2 m (S09) and 0.5 m (S23).
2. **One cornice everywhere [HMS].** In the HMS model the Corps de logis, both arms, the Sammlungsflügel and the
   Küchenbau share one cornice at **≈356.0 m**, i.e. 11.2 m above the court. Across runs this is 355.1–356.3.
   Mansard break ≈15.3 m above the court. Ridges ≈19 m above the court. Pitches ≈70° lower, ≈28° upper.
3. **Axis counts differ from catalogue v1 [HMS].** These counts are scale-free and the most robust HMS numbers:
   - arms: **21** axes at ≈3.15 m (catalogue 17 at 3.65–3.75);
   - Sammlungsflügel: **19** dormers at ≈3.3 m (catalogue 15);
   - Küchenbau: **12** axes at 3.2 m (catalogue 7);
   - Orangerie: **25±1** axes at ≈3.4 m (catalogue 21);
   - CdL court front: **15 = 4+7+4** (confirms research/06).
4. **Corps de logis topology [HMS].** HMS shows the CdL as a ≈44.5 × 18.4 m block *between* the arms. The arms run
   along its flanks to u ≈ 37–39, and the garden front projects ≈6 m beyond the arm ends. Catalogue v1 has one
   78 m CdL across the arm ends. The depth agrees (18 m). The LiDAR KB-03 band (78 m, with KB-04 at its E end)
   fits an arm that continues past the CdL court face.
5. **Orangerie [HMS].** The model is taller and denser than catalogue v1. Eaves are **16 m above the W foot**
   (catalogue 12.5). Above the high basement there are two window tiers. Hipped roof ≈6 m high, with a Dachreiter
   and a 3-axis pedimented centre risalit. Plan 85.5 × 10 m, which matches KB-30/31.
6. **Conflicts with the LiDAR [HMS vs D].**
   - The HMS Küchenbau is ≈40 m long; KB-06 is 28 m. The N ends agree; HMS runs ≈12 m further south.
   - The HMS Sammlungsflügel is ≈62 × 17 m; KB-05 is 50 × 13.
   - The HMS Ehrenhof is ≈2.6 m wider than in the LiDAR.
   - HMS terrain is stylised: ±2–4 m off the DTM away from the court.
7. **Not measured.** The Marstall/Nutzbauten are not in any registered mesh. The CdL spire is not reconstructed:
   ≥367.8 m is only a lower bound.

---

## 2. Method

### 2.1 Frames (shots from research/06, `video2world/scripts/shots.json`)

| Shot | Source t (s) | fps | Frames | Masks (painted mid-grey 0x808080) |
|---|---|---|---|---|
| S04 | 18.6–28.9 | 5 | 52 | centre title (18.9–23.0 s), label "Küchenbau" (25.2–28.95 s) |
| S06 | 34.15–36.95 | 20 | 56 | label box, bottom 25 % (raised from 8 fps after a failure) |
| S08 | 39.6–42.2 | 8 | 21 | top 6 % sky/horizon |
| S09 | 42.3–47.5 | 6 | 31 | label "Orangerie" (bottom-left), top 5 % sky |
| S23 | 100.9–116.5 | 3 | 47 | sun/sky + labels, top 37 → 24 → 12 % |
| CORE_DAY | S04+S06+S08+S09 | – | 160 | symlinks to the shots above |

`ffmpeg -copyts` with `drawbox … enable='between(t,a,b)'` keeps the masks on the source time base. Frames are
written as JPEG q2 at 3840×2160. Night and interior shots were not used (research/06 §4).

### 2.2 Object Capture

`scripts/pgtool.swift` is a ~90-line CLI around `PhotogrammetrySession`. It requests `.poses`, `.pointCloud` and
`.modelFile(url: dir, detail:)`. Settings: featureSensitivity `high`, ordering `sequential` for single shots and
`unordered` for the combined run. It writes an OBJ with baked textures, `poses.json` and `points.ply`. Runs were on
an M5 Pro with 48 GB.

| Run | Frames → poses | Detail | Triangles | Time | Result |
|---|---|---|---|---|---|
| S04_full | 52 → 52 | full | 100 k | 160 s | ok; levelled (QA), superseded by CORE_DAY |
| S06 (×2) | 23 / 56 | full | – | 33 s | **processError** both times (near-nadir, low parallax). Its frames all registered inside CORE_DAY |
| S08_full | 21 → 21 | full | 100 k | 86 s | ok; levelled only |
| S09_full | 31 → 31 | full | 100 k | 91 s | ok; registered (independent check, Orangerie) |
| S23_full | 47 → 47 | full | 100 k | 147 s | ok; registered (independent check from the E) |
| **CORE_DAY_full** | 160 → 160 | full | 100 k, 8192² texture | 794 s | ok; **primary** |
| S04_raw | 52 → 52 | raw | 339 k | 152 s | test only |
| CORE_DAY_raw | 160 → 160 | raw | 505 k | 766 s | finished after the measurements; not registered (its object frame differs from the full run, so it needs its own picks) |

Full detail was enough. The limit is the CG geometry and edge smear (0.2–0.6 m), not the triangle count.

### 2.3 Levelling ("up") and heading — `scripts/level.py`

- **Gravity.** Object Capture gives no reliable gravity (research/04). First guess for up: the smallest PCA axis of
  the thin site relief. This is then refined by a mean shift on near-horizontal face normals. A reconstructed
  sky/haze sheet is cut first with `--zclip`.
- **Validation.** The camera right-vectors of a CG drone camera should be horizontal. Median camera roll:
  0.15° (S04), −0.2° (CORE), −3.6° (S09), −3.0° (S23).
  - A first naive attempt picked the wrong axis (roll −89°); the PCA approach fixed it.
- **Heading.** The 4-fold mean of the wall-normal angles.

### 2.4 Registration (7-parameter similarity) — `scripts/register.py`, picks in `scripts/picks/*.json`

1. **Plan.** In the levelled top DSM of the mesh, each picked façade segment is snapped to the strongest height edge.
   A 2D similarity (s, θ, tE, tN) is then fitted by `scipy.optimize.least_squares` (soft-L1). The fit minimises
   point-to-line distances to LiDAR polygon edges (`research/lidar_features.geojson`). Each line is a **control** or
   a **check**.
2. **Datum.** The court pavement (30th percentile in court boxes) is set to **344.8 m** [D, research/03].
3. **Solving "up" from the roofs.** Levelling by normals left a pitch of a few degrees. The camera-roll test cannot
   see it, because it is a rotation about the camera's right axis. So the tilt is solved iteratively, rotating
   about the court centre:
   - long-wing ridges must be horizontal (Theil–Sen slope of the 98th-percentile ridge height per 3 m bin);
   - the twin arms must have equal ridge heights (pair constraint).

   Total tilt: CORE 3.8°, S09 3.0°, S23 8.3°. After 2–3 iterations the residual ridge slopes are below 0.2 %.
   The Sammlungsflügel ridge is stepped (§4), so it is not used.
4. **Composite.** The result is one 7-parameter similarity, raw OBJ → (E, N, h) = s·R·p + t. It is stored in
   `work/reg/<run>/registration.json`; re-applying it reproduces the exported mesh to < 1e-8 m. An Umeyama fit on
   3D control pairs agrees: scale within 0.03 %, rotation within 0.02°.
5. **Export.** `registered_local.obj` / `.glb` in the explorer frame **x = E − 381000, y = h, z = −(N − 5465000)**.
   Geometry only; no HMS textures in the GLB. All files are in `work/` (ignored).

### 2.5 Measuring — `scripts/measure.py`, `scripts/elevation.py`, `scripts/uv_view.py`

- **Plan.** Top views in the palace grid u/v (0.25 m, height above court) are read against a 1 m grid.
- **Profiles.** Median cross- and long-profiles per wing from `measure_spec.json` boxes. A blurred piecewise
  mansard/hip model is fitted to give wall lines, break, pitches and length.
- **Elevations.** Textured orthographic elevations at 0.1 m/px: a numpy z-buffer rasteriser that uses the OBJ UVs and
  the baked texture. From these the cornice, window tiers, dormers and axes are read in metres. This is the most
  precise height source; fitted eaves values are noisy.
- **Ground check** (`scripts/ground_check.py`). Mesh vs LiDAR DTM at reference spots.

### 2.6 Commands (from `pipeline/`, with `PY="uv run python -I ../zones/schloss-karlsberg/video2world/scripts"`)

```bash
cd schloss-karlsberg/video2world && python3 -I scripts/extract_frames.py S04 S06 S08 S09 S23   # + CORE_DAY symlinks
scripts/run_oc.sh full sequential S04 S08 S09 S23 ; scripts/run_oc.sh full unordered CORE_DAY
cd ../../../pipeline
$PY/level.py CORE_DAY_full --zclip 0.12          # S09_full: --zclip 0.2 ; S23_full: --zclip 0.12
$PY/register.py ../zones/schloss-karlsberg/video2world/scripts/picks/CORE_DAY_full.json
$PY/render_check.py CORE_DAY_full ; $PY/ground_check.py CORE_DAY_full
$PY/measure.py CORE_DAY_full S09_full S23_full ; $PY/elevation.py CORE_DAY_full
$PY/uv_view.py CORE_DAY_full -50 60 -45 110 ../zones/schloss-karlsberg/video2world/scripts/measure_spec.json
```

The rasters (DGM/DOM/hillshade) under `data/` are opened read-only. Nothing under `data/` or
`app/public/data/` is executed.

---

## 3. Registration residuals [T]

Residuals are the 25/50/75 % signed distances (m) of the snapped mesh edge to the LiDAR edge line. The sign
follows the edge direction, so the magnitude is what counts. "Spread" is the scatter of the mesh edge.

### 3.1 CORE_DAY_full (primary): s = 182.22 ± 1.02 m/unit (0.56 %), θ = −79.48 ± 0.41°, tE/tN ± 0.77/0.74 m

| Line | LiDAR | Role | Residual 25/50/75 (m) | Spread |
|---|---|---|---|---|
| Südflügel outer (S) face | KB-02 | control | −1.93 / −1.40 / −0.87 | 0.49 |
| Nordflügel court (S) face | KB-03 | control | 1.91 / 2.21 / 2.51 | 0.49 |
| Nordflügel N face | KB-03 | control | 1.34 / 1.09 / 0.84 | 0.49 |
| Nordflügel W end | KB-03 | control | −0.68 / −0.70 / −0.72 | 0.25 |
| Südflügel W end | KB-02 | control | 0.88 / 1.01 / 1.15 | 0.00 |
| Orangerie W front | KB-30 | control | 0.60 / −0.20 / −1.00 | 0.49 |
| Orangerie N end | KB-31 | control | −2.02 / −1.72 / −1.42 | 0.49 |
| Orangerie S end | KB-31 | control | −0.34 / −0.51 / −0.68 | 0.00 |
| Südflügel court (N) face | KB-02 | check | 1.69 / 1.17 / 0.64 | 0.49 |
| Sammlungsflügel W face | KB-05 | check | 3.45 / 2.42 / 1.38 | 0.25 |
| Sammlungsflügel E (court) face | KB-05 | check | −5.87 / −6.89 / −7.90 | 0.00 |
| Sammlungsflügel N end | KB-05 | check | −12.59 / −12.89 / −13.20 | 0.00 |
| Küchenbau W face | KB-06 | check | −0.40 / −0.78 / −1.17 | 0.00 |
| Küchenbau E face (smeared side) | KB-06 | check | −4.67 / −5.05 / −5.44 | 1.47 |
| Küchenbau S end | KB-06 | check | −12.86 / −12.71 / −12.57 | 0.00 |
| Küchenbau N end | KB-06 | check | −3.92 / −4.06 / −4.20 | 0.00 |
| Galerie bar vs KB-07 scarp | KB-07 | check | −1.08 / −1.35 / −1.62 | 1.96 |

**Control RMS 1.30 m.** Check RMS is 6.9 m. That figure is dominated by real HMS-vs-LiDAR differences in the
Sammlungsflügel and the Küchenbau (§6), not by registration error.

### 3.2 Scale sensitivity (control-set variants)

| Variant | Controls | Scale vs main | RMS (m) |
|---|---|---|---|
| CORE A: palace court + Orangerie front only | 5 | **−5.7 %** | 0.73 |
| CORE B: no Orangerie ends | 6 | −1.7 % | 1.24 |
| CORE C: no Nordflügel N face | 7 | −0.8 % | 1.23 |
| CORE D: palace only | 5 | −1.5 % | 1.31 |
| CORE E: + all palace checks as controls | 13 | −1.1 % | 1.97 |
| S09 main: s = 201.58 (0.56 %), θ −77.45° | 7 | – | 1.19 |
| S09 A: no Orangerie ends | 5 | −4.3 % | 1.13 |
| S09 D: palace only | 4 | −4.9 % | 0.13 |
| S23 main: s = 191.56 (0.98 %), θ 93.27° | 4 | – | **0.50** |
| S23 B: + Nordflügel N face (smeared) | 5 | +8.8 % | 2.40 |

S09 key checks: Küchenbau W face −0.3, Sammlungsflügel W +0.9, Orangerie N end 0.0, Südflügel court face +4.6
(occluded from the W). S23 key checks: Sammlungsflügel W +0.09, Küchenbau E face −0.9.

**Meaning.** HMS proportions do not match the LiDAR exactly. The palace-only fits come out 1.5–5 % smaller than
fits that also span the Orangerie. Heights read from S09/S23 come out 5–9 % lower than from CORE. A **±5 %
systematic** on all HMS lengths and heights is adopted. Counts (axes, storeys) are not affected.

### 3.3 Tilt from ridges

| Run | Before: S arm / N arm / Orangerie ridge slope | After | Total tilt |
|---|---|---|---|
| CORE_DAY_full | −6.7 % / −7.1 % / +0.5 % | −0.01 % / −0.18 % / +0.12 %; arm pair −0.004 % | 3.8° |
| S09_full | −5.0 % / −4.5 % / +1.8 % | < 0.2 % | 3.0° |
| S23_full | −13.9 % / −13.7 % / – | < 0.1 % | 8.3° |

### 3.4 Ground check, mesh − DTM (m) [T]

| Spot | CORE | S09 | S23 |
|---|---|---|---|
| Ehrenhof (datum) | +0.22 | −1.71 | +0.12 |
| Küchenhof | +0.20 | −0.16 | +0.12 |
| Forecourt W of the Ehrenhof | +2.15 | −0.95 | +1.84 |
| Between palace and Orangerie | +2.26 | −0.97 | +1.97 |
| Orangerie parterre E (KB-33) | +2.15 | −0.06 | – |
| Orangerie lower bench W (KB-32) | +4.30 | +0.75 | – |
| Garden E of the CdL | −1.15 | −3.82 | −1.43 |

The HMS terrain is flatter and more stylised than today's DTM. Heights are therefore given **above the court**
(palace) or **above the building's own foot** (Orangerie). S09 matches the DTM at the Orangerie within 0.1–0.8 m,
so it is the absolute height source there.

Visual QA (renders in `work/renders/`, looked at):
- `CORE_DAY_full_top_over_lidar.png`: the U sits on KB-02/03, the Orangerie on KB-30/31, the Sammlungsflügel along
  KB-05 but longer, and the Küchenbau on KB-06 but ≈12 m longer to the S.
- `*_side_views.png`: the ridges are level.

---

## 4. Measurements [HMS]

Heights are in m DHHN2016, read on CORE_DAY_full textured elevations unless stated otherwise. **±** is the
1-sigma combination of reading (≈0.3 m), registration and the 5 % scale systematic. u/v are palace-grid metres.

| Building | Plan (L × W, position) | Eaves (above court) | Break | Ridge / top (above court) | Storeys | Axes | Roof |
|---|---|---|---|---|---|---|---|
| **Südflügel** (KB-B02) | 73 ± 2 × 17.3 ± 0.6; u −34.8 → 37–39, v −38.4…−21.1 | 356.0 ± 0.8 (11.2); S09 355.1 | 360.1 | 363.7 ± 1.0 (18.9); vane 367.7 | Sockel with cellar windows + EG (windows 348.0–351.0) + OG (352.3–355.4) + mansard (dormers 357.4–359.3, oculi ≈361.5) | 21 at 3.15 ± 0.15; 21 dormers, 10 oculi; gate u −1.6…4.9 | mansard 68.5° / 27.4° |
| **Nordflügel** (KB-B03) | 74 ± 2 × 17.5 ± 0.8; v 23.1…40.7 | 356.0 ± 0.8 (11.2) | ≈360 | 363.8 ± 1.0 (19.0) | as Südflügel | ≈20 ± 1 at ≈3.1; gate u −6.1…−0.4 | mansard 63° / 35° (fit) |
| **Corps de logis** (KB-B01) | court front 44.5 ± 1.5, depth 18.4 ± 1.5 (court face u 26.6, risalit 25.5, garden face ≈45); centre risalit 19.5 ± 1 wide | 356.0 ± 0.8 (11.2); S23 garden 354.9 | 359.8 | sides 362.7 ± 1.0 (17.9); centre hipped roof 366.2 ± 1.2 (21.4); lantern ≥ 367.8 (≥ 23.0, spire missing) | Sockel 344.8–346.2 with cellar windows + EG (347.0–349.9) + Beletage (352.3–355.0) + mansard with dormers | court 15 = 4+7+4 (sides 3.17, centre 2.6); garden ≈14–15 at ≈3.0 (S23, low) | mansard sides; steep hipped centre with lantern |
| **Sammlungsflügel** (KB-B04) | 62 ± 3 × 17 ± 1; W face u −33.6, v 40.7 → ≈103; gate with sentry boxes v 45.5–48.5 | 356.3 ± 0.8 (11.5) | – | N part 364.0 ± 1.0 (19.2), S part ≈362 (stepped) | as the arms | 19 dormers at 3.29 ± 0.15 (W face) | mansard, stepped ridge |
| **Küchenbau** (KB-B05) | 40.5 ± 2 × 13 ± 1; W face u 20.6, v 46.3 → 86.4 | 356.0 ± 0.8 (11.2) | – | 361.7 ± 1.0 (16.9) | 2 storeys + mansard | 12 at 3.2 ± 0.15; 11 dormers | mansard 72° / 28° |
| **Galerie** (KB-B06) | ≈40 ± 4 long (u −17 → rotunda u 22–26), bar at v ≈93, width ≈6 ± 3 | ≈4.3 ± 1.0 above court | – | ≈6 ± 1.5 above court | 1, low | – | low hip (U) |
| **Orangerie Hauptflügel** (KB-B10) | 85.5 ± 1.5 × 10 ± 1; W front u −15 (risalit −17), v −196…−110 | 16.1 ± 0.8 above the W foot; absolute ≈352.0 ± 1.0 (S09) | – | eaves + 6.0 ± 0.8 → ≈357.8 ± 1.0; Dachreiter ≈25.7 above the foot (CORE) | high basement (windows 2.2–3.4 above the foot) + 2 window tiers (6.2–9.7 and 12.2–15.0 above the foot) | 25 ± 1 at 3.4 ± 0.15; 3-axis pedimented risalit at v ≈−153 (pediment ≈4.6 above the eaves) | hip ≈50 ± 8°, roof oculi, octagonal Dachreiter |
| **Orangerie Nordflügel** (KB-B11) | 45 ± 3 from the W front (projects 35 ± 3 beyond the main wing) × 13 ± 1; v −123…−110 | not read | – | – | – | – | hip (fit) |
| **Orangerie Südflügel** (KB-B12) | v −196…−183, E end not reconstructed | – | – | – | – | – | – |
| **Ehrenhof** | clear width 44.2 ± 1.5; depth 61.6 ± 2 (u −35 → CdL face) | – | – | – | – | – | – |
| **Marstall / Nutzbauten** | not covered | – | – | – | – | – | – |

**Global mansard [HMS].** Lower pitch 70° (range 63–74 over runs and wings), upper 28° (24–35). Break 15.3 ± 0.8 m
above the court, i.e. ≈4.1 m above the eaves. Upper-roof rise ≈3.5 m over a half-depth of ≈7.2 m (≈26°).

---

## 5. Comparison with catalogue v1 and the LiDAR

| Building | Quantity | HMS | Catalogue v1 | LiDAR (research/03) | Verdict |
|---|---|---|---|---|---|
| Südflügel | eaves | 356.0 ± 0.8 (S09 355.1) | 355.0 | – | catalogue inside the band; HMS +0.6 to +1.0 |
| Südflügel | ridge | 363.7 ± 1.0 (S09 362.8, S23 ≈362.3) | 362.59 | – | agree within 1σ |
| Südflügel | length | 73 ± 2 | 64 (ends at CdL, u 28.2) | KB-02 64 × 17 (ends u ≈28) | HMS arm runs 9–11 m further E along the CdL flank |
| Südflügel | depth | 17.3 | 17.0 | 17 | **agree** |
| Südflügel | axes | 21 at 3.15 | 17 at 3.75 | – | change (count is scale-free) |
| Nordflügel | depth | 17.5 ± 0.8 | 20.0 | KB-03 band 20 | **conflict**: LiDAR rubble band may include spoil / light wells; HMS twin arms are equal |
| Nordflügel | length | 74 ± 2 | 62 | KB-03 78 (+ KB-04 at its E end) | LiDAR supports a long arm |
| Nordflügel | ridge | 363.8 ± 1.0 | 363.93 | – | agree; but in HMS both arms are equal |
| CdL | footprint | 44.5 × 18.4, between the arms | 78 × 18 across the arm ends | no separate foundation | depth agrees; **length/topology differ** |
| CdL | eaves | 356.0 ± 0.8 | 356.4 | – | agree |
| CdL | side ridge / centre | 362.7 / 366.2, lantern ≥ 367.8 | 364.44 / centre raised (no number) | – | side ridge −1.7 (within 1.5σ); centre number new |
| CdL | court axes | 15 (4+7+4) | 15 (research/06) | – | agree |
| Ehrenhof | clear width | 44.2 ± 1.5 | 40.9 | 41.6 | **conflict** (HMS +2.6); keep LiDAR |
| Sammlungsflügel | footprint | 62 × 17 | 57 × 13 | KB-05 50 × 13 (W face agrees: 0.1–2.4 m) | **conflict**: HMS longer to the N (+13) and wider (+4) |
| Sammlungsflügel | eaves / ridge | 356.3 / 364.0 (N), 362 (S) | 355.0 / 360.81 | – | ridge +3.2: catalogue depth 13 is too shallow for HMS |
| Sammlungsflügel | axes | 19 at 3.3 | 15 at 3.8 | – | change |
| Küchenbau | footprint | 40.5 × 13 (v 46.3–86.4) | 28 × 13 (v 58.4–86.5) | KB-06 28 × 13 (D, high) | width and N end **agree**; HMS +12 m to the S = **conflict** |
| Küchenbau | eaves / top | 356.0 / 361.7 | 354.6 / 360.41 | – | +1.4 / +1.3 |
| Küchenbau | axes | 12 at 3.2 | 7 at 4.0 | – | change (over 28 m: 8–9 axes at 3.2) |
| Galerie | eaves / top above court | ≈4.3 / ≈6 | 7.1 / 11.1 | KB-07 scarp within 1.35 m | HMS lower; low confidence |
| Galerie | length | ≈40 | 62 | – | low confidence |
| Orangerie | plan | 85.5 × 10 | 84 × 10 | KB-31 84 × 9; KB-30 81 | **agree** |
| Orangerie | eaves above the W foot | 16.1 ± 0.8 | 12.5 (335.3 → 347.8) | drop 5.3–5.6 m = basement | HMS +3.6: a second window tier |
| Orangerie | eaves / ridge absolute | ≈352.0 / ≈357.8 | 347.8 / 352.0 | foot 335.2, parterre 340.8 | +4.2 / +5.8 |
| Orangerie | axes | 25 ± 1 at 3.4 | 21 at 3.9 | – | change |
| Orangerie N wing | plan | 35 beyond the main wing × 13 | 30 × 12 | KB-31 N end | slightly larger |
| Mansard | pitches / break | 70° / 28°, break +15.3 | 70 / 30 | – | **agree** |

---

## 6. Interpretation and limits

- **Uncertainty budget.**
  - Registration RMS 0.5–1.3 m (plan).
  - Mesh edge smear 0.2–0.6 m on sharp sides, 1.5–2 m on smeared sides (Küchenbau E in CORE, Nordflügel N face in S23).
  - Height readings ≈0.3 m.
  - Systematic scale ±5 %, which is ±0.6 m on an 11 m eaves and ±1 m on a 19 m ridge.
  - Absolute heights hang on the court datum 344.8 [D].
- **Systematic scale.** The HMS model is not exactly proportional to the LiDAR. Its court is ≈2.6 m wider and
  several blocks are bigger. So any single scale is a compromise. The main CORE fit spans palace and Orangerie (the
  longest baseline). Fits on the palace alone give 1.5–5 % smaller values. S09 and S23 heights are 5–9 % below CORE.
  Read every HMS length and height as **±5 %**.
- **Terrain is stylised.** Never take ground heights from HMS (§3.4).
- **What HMS adds best.** Counts and proportions: storeys, axes, dormers, pitches, the continuous cornice, the CdL
  topology, the Orangerie elevation. Use footprints only where they agree with the LiDAR.
- **Conflicts to resolve** (open questions):
  1. Küchenbau length: KB-06 28 m [D] vs HMS 40 m. HMS fits the Küchenhof gap to the Nordflügel (5.6 m left).
  2. Sammlungsflügel size: KB-05 50 × 13 [D] vs HMS 62 × 17.
  3. Nordflügel depth: 20 (LiDAR band) vs 17.5 (HMS).
  4. Ehrenhof width: 41.6 (LiDAR) vs 44.2 (HMS).
  5. CdL extent: is the garden front ≈45 m between the arms (HMS) or 78 m across them (catalogue v1)? A garden-side
     LiDAR edge at u ≈45 would decide it.
- **Not covered.** The Marstall and Nutzbauten; the Orangerie S wing E end; the Orangerie side-wing heights; the
  CdL spire (needle not reconstructed; 367.8 is a lower bound); interiors.

---

## 7. Proposed catalogue changes (all tagged HMS; the lead decides)

Each item gives the field, current → proposed value, and the evidence. "Keep" means the LiDAR [D] outranks HMS.

1. **KB-B02/KB-B03 eaves** 355.0 → **355.5** (±0.8), equal on both arms.
   [HMS: CORE 356.0, S09 355.1; same cornice as the CdL 356.0 / catalogue 356.4.]
2. **KB-B02/KB-B03 ridge** 362.59 / 363.93 → **363.2 for both** (±1.0).
   [HMS: CORE 363.7/363.8, S09 ≈362.8, S23 ≈362.3; twin arms equal in all runs.]
3. **KB-B02/KB-B03 axes** 17 at 3.75/3.65 → **21 at ≈3.15 m**. Add 21 dormers and oculi every second axis in the
   upper roof.
   [HMS: S face 21 dormers at 3.16 (CORE), 21 at 3.1 (S09); N arm ≈20 ± 1.]
4. **KB-B03 depth** 20.0 → **keep 20 (LiDAR)**, with the HMS alternative 17.5 in `alternatives`.
   [HMS 17.5 ± 0.8 vs KB-03 band 20.]
5. **KB-B02/KB-B03 length.** Add an alternative "arms run along the CdL flanks to u ≈ 37–39".
   [HMS 73–74 m; supported by KB-03 being 78 m long with KB-04 at its E end; KB-02 is only 64 m.]
6. **KB-B01 Corps de logis.** Add an alternative footprint: a block **44.5 × 18.4 m between the arms**, court face
   u 26.6, centre risalit 19.5 m wide (u 25.5), garden front ≈u 45 projecting ≈6 m beyond the arm ends.
   [HMS CORE plan + S23 garden view.]
7. **KB-B01 roof heights.**
   - eaves 356.4 → **356.0** (±0.8);
   - side ridge 364.44 → **362.7** (±1.0);
   - add `centre_ridge_h` **366.2** (±1.2) for the raised hipped centre;
   - add `lantern_top_min_h` **367.8** (lower bound; spire unmeasured).

   [HMS CORE elevations.]
8. **KB-B04 Sammlungsflügel.**
   - eaves 355.0 → **356.0**;
   - ridge 360.81 → **≈363.5** (N part 364.0, S part ≈362: stepped);
   - axes 15 → **19 at ≈3.3 m**;
   - add a gate with sentry boxes near the S end (v ≈45.5–48.5);
   - **keep the LiDAR footprint**, with an HMS alternative of 62 × 17 m.

   [HMS CORE; plan from CORE/S09/S23.]
9. **KB-B05 Küchenbau.**
   - eaves 354.6 → **356.0**;
   - ridge 360.41 → **361.7**;
   - axis spacing 4.0 → **3.2 m**; the axis count follows the footprint (≈8–9 over 28 m; 12 if the HMS 40 m length
     is adopted);
   - **keep the 28 m KB-06 footprint**, with an HMS alternative extending 12 m south (v 46.3).

   [HMS CORE elevations; width confirmed by checks within 0.3–0.9 m.]
10. **KB-B06 Galerie.** Add an alternative: eaves ≈349.1 (4.3 above the court), top ≈350.8, length ≈40 m.
    Confidence stays **low**. [HMS CORE, poorly reconstructed.]
11. **KB-B10 Orangerie.**
    - eaves 347.8 → **352.0** (±1.0);
    - ridge 352.0 → **357.8** (±1.0), hip ≈50°;
    - storeys: Kellergeschoss 5.5 + **two window tiers** in place of one 7.0 m Saal. Either Saal 7.0 + Mezzanin
      ≈3.5, or a double-height Saal ≈10.5 m [U];
    - axes 21 at 3.9 → **25 at ≈3.4 m**;
    - add a 3-axis pedimented centre risalit (v ≈−153) and an octagonal Dachreiter (top ≈361.5).

    [HMS S09 absolute + CORE relative; plan agrees with KB-30/31 within 0.2–1.7 m.]
12. **KB-B11 Orangerie Nordflügel.** Projection 30 → **≈35 m** beyond the main wing; depth 12 → **13 m**.
    [HMS CORE/S09 fits 34.7/35.3.]
13. **Roof defaults.** Keep the mansard 70°/30°; add a break height ≈15.3 m above the court (≈4.1 m above the
    eaves). [HMS CORE/S09/S23 fits: 70°/28°.]
14. **Ehrenhof width.** Keep LiDAR 41.6; note HMS 44.2 under `open_questions`.

---

## 8. Files

- **Committed.**
  - `video2world/scripts/`: pgtool.swift, extract_frames.py, run_oc.sh, shots.json, level.py, register.py,
    picks/*.json, render_check.py, lidar_context.py, view.py, uv_view.py, measure.py, measure_spec.json,
    elevation.py, ground_check.py, v2w_common.py.
  - `video2world/measurements.json`.
  - `video2world/README.md`.
- **Ignored** (`video2world/work/`):
  - frames, Object Capture runs, `reg/<run>/registration.json` and registered OBJ/GLB;
  - renders, including the top/side views over the hillshade and the HMS-textured elevations;
  - `measure/*.json`.
