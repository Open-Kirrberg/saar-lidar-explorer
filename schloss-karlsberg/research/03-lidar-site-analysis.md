# 03 — LiDAR site analysis: Schloss Karlsberg and the residence landscape

*Status: 2026-11-01, first pass. Evidence base for the 3D reconstruction. Source data: local 1 m DGM1/DOM1
(LVGL-SL ALS 2025; RLP 2022 only as fill east of E 384000, no feature lies on it), Bavarian survey 1836–41 and
Messtischblatt 1935 WMS rasters, DOP20 orthophoto, OSM. All coordinates EPSG:25832 (UTM 32N), heights DHHN2016.*

**Evidence labels used below:** **[D]** documented (measured in the LiDAR or shown on a map/source, with reference),
**[I]** inferred (my reasoning; may be wrong), **[U]** unknown / cannot be decided from this data.

Machine-readable result: [`lidar_features.geojson`](lidar_features.geojson) (45 features, EPSG:25832, properties
`id, kind, name_guess, confidence, height_m, depth_m, level_m, z_min, z_max, length_m, width_m, azimuth_grid_deg,
azimuth_true_deg, notes`). Images: [`img/`](img/). Scripts: [`scripts/`](scripts/) (see §9).

---

## 1. Key findings (short)

1. **The palace ruin is clearly preserved in the DTM** as rectilinear foundations on a levelled terrace at
   **344.5–344.9 m** on the western brow of the Karlsberg plateau, centred ≈ **E 382224 / N 5466150**
   (the OSM/POI point 382195/5466095 lies at its SW corner) [D: DTM, img/02_*, img/12_core_features.jpg].
2. **Grid of the palace complex:** all well-traced long walls run at **az 80.5° ± 1.5° (grid)** = **79.3° (true)**;
   cross walls at ≈ 170–174° (grid). Measured lines: S-wing N wall 81.4°, central wing S edge 80.8°, N court scarp
   78.4°, Orangerie W wall 167.7° (⊥ 77.7°) [D: `trace_lines.py`, rms 0.5–1.2 m].
   Grid convergence at the site is **−1.23°** (pyproj): *true azimuth = grid azimuth − 1.23°*.
3. **The palace axis continues as a dead-straight avenue to the east** (KB-12): 588 m at **80.0° grid**
   (78.8° true), parallel to the walls within 1°, ending at a path star at ≈ 382785/5466215 [D: geometry;
   I: that it is the baroque main axis].
4. **A second straight avenue (KB-14) leaves the palace to the SSE at 150.8° grid (624 m)** and points at the
   Karlslust valley / Bärenzwinger [D: geometry; also on the 1836–41 and 1935 maps; I: palace–Karlslust connection].
5. **Two large artificial terraces at the same design level ≈ 344 m:** the palace court (KB-01, 344.8 m) and a
   ~90 × 190 m **north terrace** (KB-20, 344.1 m) cut 3–4.8 m into the plateau; between them an upper block at
   347.6 m (KB-23) [D: profiles P1, P3]. The north terrace and the N–S road are aligned ~0–5° grid, i.e. **not**
   to the palace grid (80.5/170.5°) [D] — different phase (Louisenhof?) or later use [U].
6. **Orangerie:** an 81 m long, standing W retaining wall/front (KB-30) with a **5.3–5.6 m** drop from the upper
   parterre (340.4–340.8 m) to a lower bench (335.0 m); building depth ~8–10 m [D: P4, img/14].
7. **Karlslust (south valley) is rich:** a **stepped cascade on a N–S axis at E 382815** (KL-03, 310.5 → 271.6 m
   over 150 m) ending in the **Tosbecken** (271.7 m water), continued south across the valley by a stepped
   double-lined avenue/canal to a **rondell** at 287.5 m (KL-08/09); three **Schwanenweiher**; the **round moated
   Bärenzwinger island** (D ≈ 44 m); and a **terraced parallelogram (~90 × 210 m) with 7–9 cross-banks**
   stepping down ~1 m each (KL-02), function unknown [D: geometry; I/U: functions].
8. **The 1836–41 map is offset ≈ +50 m E** (±10 m, local residuals up to ~30 m) against the LiDAR; after a −50 m E
   correction its red building marks fall on the palace foundations, the Orangerie and a "Forsthaus" group N of
   the palace, and its straight N–S road on the LiDAR hollow way [D: img/19_hist1840_overlay_*]. The 1935
   Messtischblatt fits within ≈ 10–15 m without correction [D: road overlay].

---

## 2. Data and method

| Item | Detail |
|---|---|
| DTM/DSM | DGM1/DOM1 2025 tiles `data/raw/lvgl-sl/*_SL_2025.tif` (1 m, PixelIsArea), mosaicked for E 380800–384600, N 5463400–5468200 (`scripts/mosaic.py`); RLP DGM1 2022 only fills E > 384000 / N < 5466000 — no digitised feature uses it. Licence dl-de/by-2-0, © GeoBasis-DE/LVGL-SL 2025 / LVermGeoRP 2022. |
| Relief layers | `scripts/relief.py`: 6-azimuth hillshade (35° sun), SLRM (DTM − circular mean) at r = 5/10/20 m, positive/negative openness r = 15 m (rvt-py), slope. The "combo" images = SLRM-10 (±0.5–0.6 m, red high/blue low) over hillshade+openness; "hs" images are the stretched multi-hillshade (dark = steep = edges). |
| Historic maps | `data/work/karlsberg/hist_1840.tif` (Bavarian survey 1836–41, WMS layer 1) and `hist_1935.tif` (Messtischblatt, layer 5), Geoportal Saarland, dl-de/by-2-0 (`data/raw/historic/karlsberg/meta.json`). Only cover the AOI (N ≥ 5465000) — **Karlslust has no local historic-map coverage**. |
| Ortho / canopy | DOP20 (resampled 1 m) and CHM = DOM − DGM: whole site is closed forest except two clearings (palace ruin court ≈ 382190–382240 / 5466120–5466150; Orangerie meadow) and the pond surfaces [D: img/01_palace_1km_ortho.jpg, chm]. |
| Digitising | Visual interpretation of 10–25 m-grid zoom crops; straight features refined by `scripts/trace_lines.py` (perpendicular SLRM-5 / slope extremum every 3 m, robust line fit → azimuth, rms). Heights from DTM profiles (`scripts/profiles.py`, img/20_profiles.jpg) and polygon statistics (`scripts/features.py`). |
| Accuracy | Positions ±1–2 m for sharp walls/scarps, ±3–5 m for diffuse features; azimuths ±1–2° for lines > 50 m; heights ±0.15 m (ALS vertical) but **relief of robbed/ruined walls ≠ original wall heights**. |

## 3. Historic-map comparison (georeferencing check)

- **1836–41 Bavarian survey** [D, img/00_overview_hist1840.jpg, img/01_palace_1km_hist1840.jpg]: labels "Ruine
  Carlsberg", "Forsthaus", "Carlsbergerhof", "Sanddorf", "Louisenthal"(?). Small red (= masonry) marks at the
  palace site and at the Orangerie; a cluster of red buildings N of the palace ("Forsthaus").
  Control points (pond outline, straight N–S road, red ruin marks, Orangerie) give a systematic offset of the
  map of **≈ +50 m E, ≈ 0 m N** relative to the LiDAR; the SSE road fits only to ~±30 m → a local rubber-sheet
  distortion remains [D: visual control points; I: offset value ±10 m].
  With the −50 m correction (img/19_hist1840_overlay_shift50.jpg vs …_noshift.jpg):
  - red marks fall on KB-05/KB-06 (≈ 382210–382225 / 5466190–5466200) and on the S wing (≈ 382190 / 5466090–5466110) [D];
  - a red mark sits on the Orangerie wall (≈ 382250 / 5465900–5465950) [D];
  - the "Forsthaus" buildings fall at ≈ 382190–382290 / 5466590–5466650 → KB-52 (raised strip with pits) [D/I];
  - the straight N–S road = LiDAR hollow way KB-10 + path KB-11; the hachured scarp E of it = N-terrace E scarp KB-21 [D];
  - "Carlsbergerhof" building → today's building complex at ≈ 381510–381560 / 5465945–5466025 (KB-60) [I, med];
  - the Karlsbergweiher rectangle (≈ 100 × 40 m) matches the present pond (≈ 130 × 45 m) [D/I].
- **1935 Messtischblatt** [D, img/01_palace_1km_hist1935.jpg, img/19_hist1935_overlay.jpg]: "R. Carlsberg"
  label, spot height **342** at ≈ 382240/5466080 (LiDAR court 344.6 m; old datum and spot placement explain
  ~2 m), the 1920–35 Saargebiet border (red band) passes just S of the palace, double-line roads match the LiDAR
  hollow way and the SSE avenue within ~10–15 m. No building outlines in the forest.
- Neither map shows the palace layout itself — both postdate the 1793 destruction and the clearing of the ruins.

## 4. Site-by-site interpretation

### 4.1 Palace core (KB-01…KB-09) — img/02_core_*, img/12_core_features.jpg, img/13_north_terrace_features.jpg
- **KB-01 terrace / court:** flat 344.5–344.9 m from N ≈ 5466088 to 5466215, E ≈ 382186–382262 (≈ 128 × 72 m
  incl. ruins). West of it the ground drops to 339 m within 70 m, east of it rises to 352 m within 150 m (P2) →
  a **cut-and-fill platform on the W brow** [D: P1, P2; I: cut-and-fill].
- **KB-02 southern wing** (64 × 17 m, az 81.4°): N wall a sharp scarp, inner E-W wall at N ≈ 5466088, sunken
  rooms ~2 m below the court (P1: 342.4 vs 344.5 m) → **cellars** or robbed foundations [D: geometry/depth;
  I: cellars]. Possibly the "Räuberhöhle" (Kavaliersbau cellar, research/03 B1) — unverified [U].
- **KB-03 central E–W band** (≈ 78 × 20 m, az 80.8°): rubble mounds and trench pairs (robbed walls) N 5466138–5466162;
  with **KB-04** (22 × 14 m) at its E end [D]. Interpreted as a main wing [I, med].
- **KB-05 west block** (50 × 13 m, ≈ 174°): two parallel walls ~10 m apart with cross walls (rooms) [D].
- **KB-06 NE block** (28 × 13 m): closed rectangle of trenches around a raised rubble core (+0.4–1.7 m) [D].
- **KB-07 north scarp:** 2.0–2.9 m step (P1: 344.8 → 347.5 m), turning S along E 382251 [D].
- **KB-08/09:** two round pits D ≈ 3–4 m, 0.6–0.8 m deep (wells? tree throws? later pits?) [D: pits; U: function].
- The open, flat strip N 5466105–5466137 between KB-02 and KB-03 is crossed by the modern path on the E-axis
  line (KB-12) [D] — likely the original court/axis space [I].
- **Overall footprint of visible foundations: ≈ 80 m (E–W) × 135 m (N–S)** [D]. This is only the part that
  survived clearing; wings that stood on fill W of the terrace edge or were fully robbed may leave no trace [I].

### 4.2 North terrace and N–S axis (KB-10, KB-11, KB-20…KB-23, KB-52) — img/03_*, img/13, img/18
- **KB-20:** levelled 343.8–344.3 m, ~90 × 190 m, scarps 3.0 m (S) and 4.4 m (E, up to 348.9 m) [D: P1, P3].
  Same level as the palace court → one design datum ≈ 344 m [I]. Function (garden parterre, Marstall/service
  court, riding ground?) [U].
- **KB-23:** 139 × 83 m block at 347.6 m between both terraces — natural remnant or demolished-building platform [U].
- **KB-10/KB-11:** sunken road + straight path on one N–S line (az 0.3–1.6° grid, 717 m total) running to the
  1836–41 "Forsthaus" (KB-52) [D]. Alignment ≈ grid/true north, **not** the palace grid [D] → older (Louisenhof
  1760s?) or 19th-c. forestry layout [U].
- **KB-51 well** (pit D ≈ 5 m, 1.5 m deep) 23 m from OSM "Brunnen am alten Forsthaus" [D].
- **KB-50 Eiskeller:** pit D ≈ 10 m, 1.8 m deep, with ring bank — typical collapsed ice cellar; 38 m S of the OSM point [D/I].
- **KB-53:** faint ~90 × 90 m bank enclosure (garden? plantation fence?) [U, low].

### 4.3 Orangerie (KB-30…KB-34) — img/04_*, img/14_orangerie_features.jpg
- **KB-30** sharp 81 m wall line, az 167.7° (perpendicular 77.7°, ≈ palace grid within 3°), drop **5.3–5.6 m**
  (340.8 → 335.1 m) [D]. Matches the documented Orangerie ruin (OSM way, de.wikipedia, research/03 B1).
- **KB-31** building ~84 × 8–10 m on the upper level [I: depth from parallel inner line].
- **KB-32** lower bench 335.2 m, ~14 m wide; **KB-33** upper parterre 340.4–341.1 m bounded E by a V-shaped
  2–3 m scarp [D].
- **KB-34** two concentric rings D 34/28 m in the meadow (basin? modern?) [U, low].

### 4.4 Karlsbergweiher (KB-40…KB-42) — img/17
- Water level **276.18 m**, ~130 × 46 m, round island D ≈ 12 m at the E end, W dam crest ≈ 277 m with 2.3 m drop
  downstream (P6) [D]. Banks and older terrace lines N of the pond suggest a once larger basin [I, low].

### 4.5 Karlslust valley (KL-01…KL-13) — img/15, img/16_karlslust_zoom_hs.jpg
- **KL-03 cascade:** 8–12 m wide stepped feature on the N slope, axis E ≈ 382815 (az 180.6° grid), landings
  every 10–15 m, **310.5 → 271.6 m (≈ 39 m fall over 150 m)** [D: P5]; ends in **KL-04 Tosbecken** (271.7 m)
  [D: OSM "Tosbecken" at 382814/5464814]. Identification as the "Große Kaskade" [I, med].
- **KL-08/09:** the axis continues S as two parallel lines ~10 m apart, stepped up to a round platform D ≈ 12 m
  at 287.5 m [D] — avenue or second cascade/canal [U].
- **KL-05…07 Schwanenweiher:** three ponds, levels 270.1 / 266.8 / 268.3 m (pond 1 with two islets) [D; names per OSM/research/03].
- **KL-01 Bärenzwinger:** round ring/moat D ≈ 44 m around a ~10 m square [D]. The "19 enclosures" ring
  (research/03) is not obvious around it [U].
- **KL-02 terraced parallelogram** E of the Bärenzwinger: ~90 × 210 m, NE scarp az 154.1°, 7–9 cross-banks
  az ≈ 75° spaced 15–20 m, ~1 m steps (P7: 300.2 → 292.5 m), SW bank 4.7 m [D]. Candidate for the
  "Herzogsterrassen / bear cages 1786", kennels, a nursery or kitchen garden [U].
- **KL-10 Tschifflik:** mound D ≈ 20 m, 2 m high, central pit ~4 × 6 m (cellar) at the OSM ruin [D].
- **KL-11** oval mound E of it, **KL-12** ring mound at the "Eremitage" point, **KL-13** crisp 50 × 20 m
  rectangle (likely modern) [U, low].

## 5. Orientation summary

| Element | az grid | az true (−1.23°) | Source |
|---|---|---|---|
| Palace long walls (KB-02, KB-03, KB-07) | 78.4–81.4 (mean 80.5) | 79.3 | trace_lines |
| E axis avenue KB-12 | 80.0 | 78.8 | trace_lines (588 m, rms 1.4 m) |
| Orangerie wall KB-30 | 167.7 (⊥ 77.7) | 166.5 | trace_lines |
| Palace cross walls (KB-05/06) | 172–174 | 171–173 | digitised |
| SSE avenue KB-14 | 150.8 | 149.6 | trace_lines (624 m, rms 1.0 m) |
| N–S road/path KB-10/11 | 0.3–1.6 | 359.1–0.4 | trace_lines |
| N terrace E scarp KB-21 | 5.5 | 4.2 | trace_lines |
| Karlslust cascade axis KL-03/08 | 178.5–180.6 | 177.2–179.4 | trace_lines |
| Cell-terrace NE scarp KL-02 | 154.1 | 152.8 | trace_lines |

[I] The palace grid (≈ 80°/170°) is neither grid- nor true-north based; it follows the plateau brow and points its
E axis along the ridge. The N–S road, north terrace and Karlslust axis are aligned within ~5° of north — a
second alignment family.

## 6. Terrace / level summary (design datums for the model)

| Level (m DHHN2016) | Where | Evidence |
|---|---|---|
| 352–353 | plateau E of the palace (natural, rising) | P2 |
| 347.5–347.9 | upper block KB-23 between court and N terrace | P1 |
| **344.5–344.9** | **palace court KB-01** | P1, P2 |
| 342.4 (−2 m) | cellar floor level in KB-02 (rubble-filled) | P1 |
| **343.8–344.3** | **north terrace KB-20** | P1, P3 |
| 340.4–341.1 | Orangerie parterre KB-33 | P4 |
| 335.0–335.2 | Orangerie lower bench KB-32 | P4 |
| 276.2 | Karlsbergweiher water | P6 |
| 310.5 → 271.6 | Karlslust cascade top → Tosbecken | P5 |
| 270.1 / 266.8 / 268.3 | Schwanenweiher 1/2/3 water | features.py |
| 287.5 | Karlslust rondell KL-09 | P5 |

## 7. Feature table

Generated by `scripts/features.py` from the GeoJSON (centroids rounded to 1 m; L × W of minimum rotated
rectangle for polygons, length for lines; `h` = p90 inside − median of a 2–6 m outer ring, or the side-to-side
step for scarps; `d` = outer median − p10 inside; `level` = median inside). Values for terraces are better read
from the profiles (§6); ring-based values on slopes are indicative only.

| id | kind | name (guess) | conf. | centroid E / N | L x W (m) | az grid / true (deg) | DTM z range (m) | h / d / level (m) |
|---|---|---|---|---|---|---|---|---|
| KB-01 | platform | Palace terrace / Schlosshof level (court between wings) | high | 382224 / 5466154 | 128 x 72 | 177.2 / 176.0 | 341.7-347.8 | level 344.8 |
| KB-02 | foundation | Southern wing with cellars (S-Flügel) | high | 382227 / 5466091 | 64 x 17 | 81.4 / 80.2 | 340.1-345.9 | d 2.9 |
| KB-03 | foundation | Central E-W wing (main building? corps de logis candidate) | med | 382226 / 5466151 | 78 x 20 | 80.8 / 79.6 | 343.8-346.0 | h 0.8 |
| KB-04 | foundation | Eastern pavilion / corner block at central wing | med | 382259 / 5466143 | 22 x 14 | 80.8 / 79.6 | 344.4-345.9 | h 0.3 |
| KB-05 | foundation | West block (W-Flügel), subdivided rooms | high | 382190 / 5466186 | 50 x 13 | 174.0 / 172.8 | 344.1-345.9 | h 0.9 |
| KB-06 | foundation | NE block (rubble-filled rectangle, robbed-wall trenches around) | high | 382241 / 5466196 | 28 x 13 | 172.0 / 170.8 | 344.8-347.8 | h 1.7 |
| KB-07 | terrace | North court scarp (step up to upper plateau 347.8 m) | high | 382244 / 5466206 | 89 | 141.4 / 140.2 | 345.5-347.3 | h 2.0 |
| KB-08 | pit | Round pit / well shaft? (E of NE block) | med | 382280 / 5466190 | 4 x 4 |  | 346.7-347.8 | d 0.8 |
| KB-09 | pit | Round pit / well shaft? (E of NE block, S) | med | 382288 / 5466172 | 4 x 4 |  | 346.4-347.5 | d 0.6 |
| KB-10 | path | Hollow way W of palace (N-S axis road, south part) | high | 382172 / 5466238 | 249 | 1.7 / 0.4 | 341.6-344.7 |  |
| KB-11 | avenue | N-S axis road/avenue north of palace (to Forsthaus / Louisenhof area) | med | 382181 / 5466614 | 468 | 0.3 / 359.1 | 337.4-344.4 |  |
| KB-12 | avenue | East axis avenue (palace axis, W part) | high | 382489 / 5466168 | 588 | 80.0 / 78.8 | 343.9-352.4 |  |
| KB-13 | avenue | East axis avenue (E continuation) | low | 383084 / 5466258 | 594 | 83.6 / 82.4 | 343.7-361.3 |  |
| KB-14 | avenue | SSE avenue palace -> Karlslust | high | 382441 / 5465712 | 624 | 150.8 / 149.6 | 343.0-365.8 |  |
| KB-15 | path | Rondell / path star at end of E axis | low | 382785 / 5466215 | 24 x 24 |  | 341.5-344.9 |  |
| KB-20 | terrace | North terrace (levelled platform, same level as palace court) | high | 382227 / 5466466 | 193 x 96 | 1.2 / 180.0 | 341.7-347.1 | level 344.1 |
| KB-21 | terrace | North terrace E scarp | high | 382271 / 5466420 | 99 | 5.4 / 4.2 | 345.0-349.0 | h 4.4 |
| KB-22 | terrace | North terrace S scarp | high | 382222 / 5466368 | 81 | 90.7 / 89.5 | 344.1-348.0 | h 3.0 |
| KB-23 | other | Upper plateau block between palace and N terrace (347.5-347.9 m) | med | 382221 / 5466297 | 139 x 83 | 0.4 / 179.2 | 344.1-349.4 | level 347.6 |
| KB-30 | wall | Orangerie: W retaining wall / building front | high | 382237 / 5465966 | 81 | 167.7 / 166.4 | 335.7-340.8 | h 5.3 |
| KB-31 | foundation | Orangerie building footprint (on upper terrace) | med | 382242 / 5465966 | 84 x 9 | 167.7 / 166.5 | 335.6-342.2 | h 2.5 |
| KB-32 | terrace | Orangerie lower terrace (W, 335 m) | med | 382226 / 5465962 | 75 x 14 | 167.7 / 166.5 | 333.3-337.5 | level 335.2 |
| KB-33 | terrace | Orangerie parterre (upper level 340.4-340.8 m) | med | 382271 / 5465953 | 95 x 55 | 151.2 / 150.0 | 340.1-343.9 | level 341.1 |
| KB-34 | other | Circular feature in clearing (basin? modern?) | low | 382263 / 5465972 | 34 x 34 |  | 340.4-341.7 |  |
| KB-40 | pond | Karlsbergweiher (water surface) | high | 381890 / 5465876 | 138 x 46 | 86.5 / 85.3 | 276.0-278.2 | level 276.2 |
| KB-41 | other | Karlsbergweiher island | high | 381945 / 5465880 | 12 x 12 |  | 276.3-277.5 | h 1.1 |
| KB-42 | dam | Karlsbergweiher W dam | med | 381819 / 5465875 | 54 | 173.7 / 172.4 | 276.5-278.0 |  |
| KB-50 | cellar | Eiskeller (collapsed ice cellar: pit with ring bank) | high | 382508 / 5466296 | 10 x 10 |  | 354.0-356.5 | d 1.8 |
| KB-51 | pit | Well at former Forsthaus (Brunnen) | med | 382386 / 5466477 | 5 x 5 |  | 346.9-348.0 | d 1.5 |
| KB-52 | platform | Building platforms at the 1836-41 'Forsthaus' (W of N-S avenue) | low | 382203 / 5466650 | 100 x 16 | 0.0 / 178.8 | 342.1-345.4 | h 1.2 |
| KB-53 | other | Rectangular low-bank enclosure (garden? plantation?) | low | 382600 / 5466397 | 95 x 90 |  | 353.9-357.2 |  |
| KB-60 | other | Karlsberger Hof (existing building complex) | med | 381536 / 5465983 | 80 x 52 | 0.0 / 178.8 | 256.6-262.0 |  |
| KL-01 | other | Barenzwinger: moated round island | high | 382935 / 5464913 | 44 x 44 |  | 298.4-300.6 | d 0.0 |
| KL-02 | terrace | Terraced parallel-strip complex E of Barenzwinger (kennels/enclosures/garden?) | med | 383034 / 5464827 | 210 x 99 | 156.1 / 154.8 | 287.2-305.1 |  |
| KL-03 | other | Cascade (stepped channel) on N slope, axis E 382815 | med | 382815 / 5464882 | 95 | 180.6 / 179.4 | 276.3-302.5 |  |
| KL-04 | pond | Tosbecken (plunge basin) / upper pond | high | 382812 / 5464811 | 57 x 30 | 93.3 / 92.0 | 271.1-276.4 | level 271.7 |
| KL-05 | pond | Schwanenweiher pond 1 (oval, with two islets) | high | 382855 / 5464786 | 60 x 40 | 160.5 / 159.2 | 269.5-273.0 | level 270.1 |
| KL-06 | pond | Schwanenweiher pond 2 | high | 382880 / 5464714 | 61 x 46 | 160.0 / 158.8 | 266.7-271.3 | level 266.8 |
| KL-07 | pond | Schwanenweiher pond 3 (small, lower) | med | 382913 / 5464690 | 22 x 22 |  | 264.6-270.5 | level 268.3 |
| KL-08 | avenue | Axis S of Tosbecken: stepped avenue/canal to rondell | med | 382811 / 5464724 | 123 | 178.5 / 177.2 | 275.9-287.3 |  |
| KL-09 | other | Rondell at S end of axis | med | 382815 / 5464652 | 12 x 12 |  | 287.2-288.3 | h 0.4 |
| KL-10 | foundation | Tschifflik pavilion ruin: mound with central cellar pit | high | 382618 / 5464770 | 20 x 20 |  | 324.4-327.9 | h 2.0 |
| KL-11 | platform | Oval mound with depression E of Tschifflik | low | 382745 / 5464750 | 26 x 16 | 160.4 / 159.2 | 296.4-300.8 | h 0.9 |
| KL-12 | platform | Eremitage site: ring mound | low | 383155 / 5464658 | 16 x 16 |  | 284.9-287.6 | h 2.8 |
| KL-13 | other | Sharp rectangle 50 x 20 m (modern building/hut? check) | low | 382745 / 5464610 | 50 x 20 | 70.0 / 68.8 | 287.8-291.3 | h 1.2 |

## 8. What the LiDAR can and cannot tell

**Can** [D]: positions, alignments and sizes of terraces, scarps, retaining walls, robbed-wall trenches, cellar
hollows, ponds/dams, avenues and pits to ±1–2 m; true heights of today's ground (±0.15 m); design levels of
platforms; which features fit the historic maps.

**Cannot / limits:**
- **Elevations of buildings**: only ground remains; walls were cleared after 1793 (ruins handed back on condition
  of clearing, research/03 B1) → no storeys, roofs, façades, window rhythms. Those must come from plans/views.
- **Robbed vs. buried walls**: a trench can be a robbed wall, a cellar or a later pit; mounds can be rubble heaps.
  The 1950s excavations (research/03 B1) may have altered the core (spoil heaps, re-exposed walls) [U].
- **Forest effects**: dense canopy (CHM 20–35 m) reduces ground-point density; small walls (< 0.2 m, < 1 m wide)
  may vanish; tree throws create pits/mounds resembling features.
- **1 m grid**: walls < ~1 m wide are at the resolution limit; corners are rounded; sharp masonry steps appear as
  1–2 m wide slopes.
- **Later changes**: forest roads/paths (often on old avenues, but also new), drainage ditches, the 20th-c.
  border (stones, 1920–35), clearings and modern features (KL-13, KB-34?) overprint the baroque layout.
- **Erosion/colluvium** on steep slopes (cascade, Orangerie) softens and buries edges; water bodies return only
  the water surface (pond depth unknown).
- **Historic-map georeferencing** is ±10–30 m; use the maps for identification, not for coordinates.

## 9. Reproducibility

```bash
cd pipeline
W=<scratch>/kb; R=../schloss-karlsberg/research
uv run python -I $R/scripts/mosaic.py $W           # DTM/DSM mosaic + POIs in UTM
uv run python -I $R/scripts/relief.py $W           # hillshade, SLRM 5/10/20, openness
uv run python -I $R/scripts/render.py $W $R/img $R/scripts/spec_overview.json   # (+ spec_zoom/spec_features)
uv run python -I $R/scripts/hist_overlay.py $W $R/img/19_hist1840_overlay_shift50.jpg 1840 381650 5465600 1100 50 0
uv run python -I $R/scripts/trace_lines.py $W      # azimuths of straight features
uv run python -I $R/scripts/profiles.py $W $R/img/20_profiles.jpg
uv run python -I $R/scripts/features.py $W $R/lidar_features.geojson <table.md>
```
`scratch_spec_*.json` are the specs of the exploratory crops (written to the scratch dir).

## 10. Image index (research/img)

| File | Content |
|---|---|
| 00_overview_dtm / 00_overview_combo | 3.8 × 4.8 km DTM and local relief with POIs |
| 00_overview_hist1840 / 00_overview_ortho | AOI 3 × 3 km: 1836–41 map, orthophoto |
| 01_palace_1km_{combo,dtm,ortho,chm,hist1840,hist1935} | palace area 1 × 1 km, all layers |
| 02_core_300m_{combo,slrm5,hs,dtm} | palace core 300 m |
| 03_north_300m_{combo,dtm} | north terrace |
| 04_orangerie_300m_{combo,dtm} | Orangerie |
| 10_overview_features … 18_forsthaus_eiskeller_features | annotated feature maps (ids = GeoJSON) |
| 19_hist1840_overlay_{noshift,shift50}, 19_hist1935_overlay | historic linework over relief |
| 20_profiles | DTM/DSM profiles P1–P7 |

## 11. Open questions for the history/plans research

1. Which building occupied which footprint (Corps de logis, Kavaliersbauten, Marstall, galleries, library)? —
   needs Mannlich's plans / the 1780s views to match against KB-02…KB-06 and the 80.5° grid.
2. Was the main front oriented W (towards the valley, over the terrace edge) or E (towards the KB-12 avenue)?
3. Is KB-20 (north terrace) baroque (Marstall/Reithalle/parterre) or older (Louisenhof 1760s)?
4. Where are the large outbuildings (barracks, Marstall, Menagerie, Hundezwinger, Baumagazin)? None are
   unambiguous in the LiDAR; candidates: KB-20, KB-23, KB-52, KL-02.
5. Is KL-02 the "Herzogsterrassen"/bear cages? Are KL-03/KL-08 one cascade system?
6. Exact extent of the 1950s excavations (spoil may distort KB-01…KB-06).

*Licences: DGM1/DOM1, DOP20 and historic maps © GeoBasis-DE/LVGL-SL (2025/2026), dl-de/by-2-0, data processed;
RLP fill © GeoBasis-DE/LVermGeoRP 2022, dl-de/by-2-0; OSM © OpenStreetMap contributors, ODbL. The site is a
protected monument (SDschG Saarland / DSchG RLP) — this analysis is for visualisation, not for fieldwork.*
