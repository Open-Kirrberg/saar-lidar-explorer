# 07 — Period sources: views, maps and the 2006 site plan, georeferenced

> Date: 2026-11-01. Inputs: eight approved Commons files in the git-ignored `../sources/`. Their log is in §0 and in
> `../sources/SOURCES.md`. Two approved PDFs could **not** be downloaded because both servers answer with a bot
> challenge (§0).
>
> Scripts:
> - [`scripts/georef_common.py`](scripts/georef_common.py) — fitting helpers.
> - [`scripts/georef_lageplan.py`](scripts/georef_lageplan.py) — the 2006 plan: fit, render, vector, compare, polys.
> - [`scripts/georef_1805.py`](scripts/georef_1805.py) — the 1805 map.
>
> Images: `img/30_…38_*.jpg`. All overlays show only public-domain or CC BY-SA material plus our own LiDAR. Nothing
> from the HMS 2022 video is used here.
>
> **Tags** (as in 01–06): **[D]** documented (source named) · **[D→]** derived arithmetically/geometrically ·
> **[I]** inferred · **[N]** period norm · **[U]** unknown · **[HMS]** HMS 2022 reconstruction (secondary).
>
> New source keys used below:
> - **LC** Le Clerc 1790
> - **PV** "Pleine vue" 1791
> - **PL** porcelain ("Meissen") plate
> - **K82** Oberamt map 1782
> - **K05** ruins map 1805
> - **LP06** 2006 Lageplan (schloss-carlsberg.de)
> - **AN06** 2006 Ansicht

---

## 0. Download log (copy of `sources/SOURCES.md`)

| File | Original URL | Author | Date | Licence | Size (bytes, px) | SHA-256 |
|---|---|---|---|---|---|---|
| Karlsberg_II.jpg | https://upload.wikimedia.org/wikipedia/commons/5/59/Karlsberg_II.jpg | Friedrich & Wilhelm von Lüder ("Pleine vue du Carlsberg") | 1791 | PD | 322212, 1300×857 | 44d0bb5a2d30db70f6e50723e586d3fdfdb2351e4f0834ef1afa7d6bdcc776b3 |
| Schloss_Karlsberg_Leclerc.jpeg | https://upload.wikimedia.org/wikipedia/commons/9/93/Schloss_Karlsberg_Leclerc.jpeg | Philipp Le Clerc ("Vue du Château de Carlsberg") | 1790 | PD | 18317, 550×339 | f1a052bef38d55a35012c23a151d323d37b38aff1fba8c758979676987ed9600 |
| Karlsberg_III.jpg | https://upload.wikimedia.org/wikipedia/commons/2/2d/Karlsberg_III.jpg | Philipp Le Clerc (detail; uploader Thw1309) | 1790 | PD | 91565, 747×253 | 688e95201e0abe48949e3ab268bcf20b327130376b128d58cad7315954cdc2af |
| Le_Château_de_Carlsberg.jpg | https://upload.wikimedia.org/wikipedia/commons/c/c3/Le_Ch%C3%A2teau_de_Carlsberg.jpg | unknown; porcelain plate from Karl II. August's collection | 2nd half 18th c. | PD | 45504, 341×231 | 4ab433cb1a467ad0b16fd416456dc24135dbf4f1d30ea4314194b7c2dbb6a980 |
| Karlsberg_karte_II.jpg | https://upload.wikimedia.org/wikipedia/commons/d/d9/Karlsberg_karte_II.jpg | anonymous (ruins map; uploader Thw1309) | 1805 | PD | 79355, 642×531 | a437762a79f550bac3e362c3f13780c3f5d5dde10427f471afea4aeaf0e93bd8 |
| Karlsberg_Karte.jpg | https://upload.wikimedia.org/wikipedia/commons/b/b2/Karlsberg_Karte.jpg | P. Schäfer, "General-Carte über das Ober-Amt Homburg" | 1782 | PD | 337102, 1075×967 | 010c4c42471151cbd76858108556d926c4bba2fd17b062aa541f299104258e4d |
| Karlsberg_Lageplan.gif | https://upload.wikimedia.org/wikipedia/commons/4/47/Karlsberg_Lageplan.gif | "Mannlich", schloss-carlsberg.de | 2006-12-02 | CC BY-SA 2.0 DE | 235672, 2050×1477 | 45cad8f1443c1323be75cde29510714c27b5250168ccbaab754d9d97eb36c230 |
| Ansicht_Karlsberg.png | https://upload.wikimedia.org/wikipedia/commons/f/fc/Ansicht_Karlsberg.png | "Mannlich", schloss-carlsberg.de | 2006-12-02 | CC BY-SA 2.0 DE | 102080, 3023×750 | 5ef8a829c072967c3362580671e0135a4d7ce0000271086965a8abc3544ccbaf |
| **failed:** Schwan, *Burgen und Schlösser* 4/2012 | https://journals.ub.uni-heidelberg.de/index.php/bus/article/download/53625/47240/166406 (→ ahnp mirror) | J. Schwan | 2012 | U | — | HTML proof-of-work bot page (Anubis), no PDF |
| **failed:** LDA Saarland Jahresbericht 2006 | https://www.saarland.de/SharedDocs/Downloads/DE/LDA/Jahresbericht/Denkmalpflege_im_Saarland_Jahresbericht_2006.pdf?__blob=publicationFile&v=5 | LDA Saarland | 2006 | U | — | HTTP 403 JavaScript challenge, no PDF |

- **Integrity.** All Commons SHA-1 values equal the API's `sha1`.
- **Failed PDFs.** The bot challenges were not circumvented, and no other files were substituted. **Open both links
  in a normal browser and save the PDFs into `sources/`.** Then this document can be extended with Schwan's plan
  figures and the 2006 forecourt investigation.
- **Resolution warning.** The Commons copies of LC (550/747 px), PL (341 px) and K05 (642 px) are small. Every
  window count from them is ±1–2. The 2006 plan is a clean vector-style drawing and is the best geometric source here.

---

## 1. What each source shows

### 1.1 Overview

| Topic | LC 1790 (+ detail) | PV 1791 | PL plate | K82 1782 | K05 1805 | LP06 2006 | AN06 2006 |
|---|---|---|---|---|---|---|---|
| Kind / reliability | eyewitness vedute, court painter; idealised but architectural | naive panorama from Homburg (Schlossberg garden) with a 36-item legend; schematic | decorative vedute on porcelain; symmetrised | survey map 1:~25 000; schematic | cadastral survey of the **ruins** (Section B, parcel numbers) | **modern research plan** (schloss-carlsberg.de/Schwan circle), 66-item legend, based on old plans | modern line drawing; mostly a tracing of PV |
| Ehrenhof | three wings; court crossed by a **wrought-iron grille with central gate**; two small guard pavilions in front | château block seen from W/NW | two long wings converge on the CdL; **grille + gate** before the CdL; chain-and-post barrier and a **retaining wall** in the foreground | — | two-court ruin block (parcel 106) | U-court **open to the W** onto the road. Corps de Logis (1) closes it on the E, Nord- (2) and Südflügel (3) flank it. **Wachhäuser (28)** flank the mouth | — |
| Wings | N-, S-wing + CdL visible; S-wing W head as a tall pavilion | palace group with slate-blue roofs | 2 wings + CdL | single red bar NNE–SSW | outlines of both courts | **6 parts:** 1 CdL, 2 N, 3 S, 4 Westflügel, 5 Ost-/Küchenflügel, 6 Galerieflügel (a 2nd court N of the Ehrenhof) | — |
| Storeys | **2 full storeys + mansard** (wings and CdL); head pavilion 2 + mansard on a high base | 2 storeys (blurred) | **2 storeys + mansard** with dormers | — | — | — | château: raised ground floor + 1 tall storey + small attic/mezzanine row |
| Roofs | **mansards with 2 rows of dormers** on the long wings; CdL centre pavilion with a **higher hipped roof + lantern/spire (Dachreiter)**; head pavilion **hipped mansard** (Mansardwalmdach) with 4 dormers + oculus | palace roofs **blue-grey (slate)**; service buildings **red (tile)**, several with pyramid pavilion roofs, one blue pavilion | **mansards with dormers** on both wings; CdL pavilion roof + Dachreiter | — | — | — | plain hip roof with a few dormers; pedimented centre + Dachreiter with flag |
| Axes (counts, ±1–2) | left (N) wing court face ≈ 20–23 axes before a columned centre section, more beyond it; **CdL centre pavilion 7 axes**; head pavilion **4 axes** on its W face | château front ≈ 13–15 axes with a 3-axis pedimented centre | wing fronts ≈ 24 axes each | — | — | — | château elevation **9 + 3 + 9 = 21 axes** |
| Portals / stairs | head pavilion: **4-column portico + balcony** over a broad **Freitreppe** (~10–12 steps) down to a lower level with a retaining wall; columned porch in the N wing centre | — | central gate in the grille; balcony in each wing's centre | — | — | 44 "Schloßterrasse" south of the S wing | raised base with central arched door |
| Colours | pale render (cream to light grey), grey/pinkish stone dressings, dark slate roofs, dark iron grille | white-grey walls; blue (slate) vs red (tile) roofs | white walls, blue-grey roofs | — | — | — | — |
| Orangerie / Rotunde | — | legend **b. "L'orangerie et la demeure des Courtisans et la Sommellerie"** (courtiers lodged at the Orangerie) | — | — | block at the head of the SSE avenue | **7: U-shape open to the E**, main range W on the terrace wall. N wing ≈ 45 m, S wing ≈ 70–75 m to the V-scarp. **No rotunda drawn** | long building with ~16 tall round-arched windows, 3-axis pedimented centre (probably the Orangerie W front [I]) |
| Gallery | — | — | — | — | (inside parcel 106) | **6: thin range ~95–105 m**, from the Westflügel's N end E past the Küchenflügel, with a **square end pavilion** | — |
| Marstall / Reithaus | — | **h. "Les écuries avec leurs apartemens des palfreniers et manège aux chevaux"** | — | — | two-court block on the north terrace | **12 Marstall:** two-court block ~75 × 170 m with **13 Reithalle** in its E range. Also **14 Remisen**, **15 Zwinger** (walled square with a central house), 16 Jägerhaus | — |
| Gardens | — | x. vineyard (*la vigne*); 3. *Jardin et maison de plaisance*; g. *serre chaude* | lawn strips | — | hatched garden parcels between the palace and the Marstall, both sides of the road | 11 Holländische Gärtnerei (both sides of the road, on KB-23), 30 Weinberg, 34/45/47 Gärtnereien, garden grids E of the palace | — |
| Avenues | — | u. *L'allée des marronniers sauvages*; 8. *la chaussée … à Hombourg* (the poplar avenue in the foreground) | — | tree-lined avenue Homburg → Carlsberg | straight SSE avenue (= KB-14); E–W road from the Marstall | 48 Apfelallee (= KB-14), 29 Hauptzufahrt (valley → palace), 66 Hauptzufahrt to the Carlslust, a grid of straight roads E of the palace | poplar avenue |
| Water | — | s. **aqueduct from the Lambsborn spring, 1600 toises (≈ 3.1 km)**, into a basin at the great stables; v. *fontaine par machine* feeding the kitchen and barracks | — | — | pond (Karlsbergweiher) | 32 Carlsbergweiher (larger than today), cascade 58, 57 Schwanenweiher, 60/64 basins | — |

### 1.2 Notes per source

**Le Clerc 1790 (LC; PD).** This is the most architectural contemporary image.
- **Viewpoint [I].** The viewer stands W of the Ehrenhof, outside it, looking E. On the left, the N wing's court face
  recedes; in the centre is the CdL; on the right is the S wing's W head pavilion with its stair and terrace wall.
  The two small buildings in the foreground match **LP06 no. 28 "Wachhäuser"**: two small houses flanking the court
  mouth, ~25 m apart (§2.4).
- **Roofs.** Everything is under mansard roofs. The wings show two dormer rows, large lower and small upper.
  - The CdL centre (7 axes) rises as a pavilion with its own steep hipped roof, a lantern with a spire, and tall
    chimneys.
  - This **contradicts** the en.wikipedia statement "only the Corps de logis had a mansard" (05 C1) and **supports the
    HMS massing** [D LC].
- **Grille.** The court is crossed by an elaborate **wrought-iron grille with gate piers and a central gate**. Its
  exact line (court mouth or nearer the CdL) cannot be read [U].
- **Idealisation.** The proportions are stretched (very long wings) and the scene is clean and symmetrical.

**Pleine vue du Carlsberg 1791 (PV; PD).** A panorama by the Lüder brothers "from a garden on the Schlossberg at
Hombourg". Its legend (a–z, 1–9) is transcribed in Appendix B.
- **Reliable content.** The legend inventory, and the colour code: **blue roofs on the palace group, red tile roofs on
  the service town and the valley buildings**, with two-storey service buildings and pyramid-roofed corner pavilions.
- **Unreliable content.** Geometry, and the window counts on the château (~13–15 axes, blurry).
- **Extra content.** It names buildings that are not in the catalogue:
  - *Colombier avec ses logemens de part et d'autre* — a dovecote with lodgings on both sides; this matches LP06 no. 8,
    a 57 m range.
  - *Caserne des chevaux légers* (LP06 9).
  - *Maison des armuriers* (LP06 10 Waffenschmiede).
  - *Grand corps de garde devant le Château* — the main guard in front of the palace (LP06 28 Wachhäuser [I]).
  - *L'hôtellerie avec ses écuries*, *Grand Cabaret à la bière* (LP06 22 Brauerei und Wirtshaus).
  - *Le grand magasin avec ses logemens* (LP06 36 Baumagazin).
  - *La cense* (farm = LP06 38 Carlsberger Hof [I]).
  - *Le petit hameau hors du parc* (LP06 42 Carlsdorf/Sanddorf [I] or UP-13).
  - *La Faisanderie dans le bois d'Erbach*.

**Porcelain plate (PL; PD).** A symmetric frontal vedute: two long wings with 2 storeys plus a mansard with dormers,
converging on the CdL pavilion with its Dachreiter. In front stand a **grille with a gate**, a chain-and-post barrier,
and a **retaining wall** in the foreground; the last fits the LiDAR cut-and-fill platform on the brow.
- The wings are "unfolded" into the picture plane. This is typical porcelain idealisation, so it is **not** usable for
  plan geometry [I].

**Oberamt map 1782 (K82; PD).** The north arrow (fleur-de-lis) points ~30–35° right of the sheet's top.
- "Carls Berg" appears as a single red bar aligned ≈ NNE–SSW (≈ 20° true, read off the rotated sheet).
- A tree-lined avenue leads there from Homburg, and "Carls Lust" lies to the south.
- It confirms the **1782 state**: an early N–S row on the ridge, no wings yet [I]. It has no geometry at palace
  scale.
- Its inset "Prospect der Ober-Amts-Stadt Homburg" shows the Schlossberg — PV's viewpoint.

**Ruins map 1805 (K05; PD).** A cadastral sheet ("Section B"). The ruins are drawn as thick-walled outlines; the
parcels are numbered and the gardens hatched.
- Georeferenced in §2.3 to **10.5 m RMS**.
- It is **independent of LP06 and agrees with it**:
  - the two-court palace block (parcel 106);
  - the hatched garden parcels on both sides of the road on KB-23;
  - the two-court **Marstall** on the north terrace KB-20;
  - the square **Zwinger** north of it, with a central house;
  - the Orangerie block at the head of the straight SSE avenue (KB-14);
  - the Karlsbergweiher;
  - the road network.
- LP06 was probably drawn on this or a related survey [I].

**Lageplan 2006 (LP06; CC BY-SA 2.0 DE).** This is modern research by the schloss-carlsberg.de author ("Mannlich"),
with Schwan's work behind it [I].
- **North is to the LEFT** of the sheet. The needle tip points left, and the georeference confirms plan-up = grid
  azimuth 85–90°.
- It is the only source that names and places the **whole residence (66 items)**.
- Its building outlines are schematic: walls are drawn thick, wings are ~10–15 % longer than the LiDAR remains, and
  the scale differs locally (1.27–1.46 m/px). **Treat footprints as ±5–10 m (core) and ±10–20 m (elsewhere).**

**Ansicht 2006 (AN06; CC BY-SA 2.0 DE).** A modern ink panorama of the same scene and composition as PV.
- It is a redrawing, so it is **not an independent source** [I].
- It shows the château as 21 axes (9 + 3 + 9): a tall main storey over a basement, a row of small attic windows, a hip
  roof with a few dormers, and a pedimented centre with a Dachreiter. This **conflicts with LC/PL (mansard, 2 full
  storeys)**. The contemporary images win [I].

### 1.3 Key conflicts after this step

| # | Question | Evidence now | Resolution proposed |
|---|---|---|---|
| C1 | Mansard on the CdL only (en.wp) vs on all wings (HMS) | **LC 1790 and PL: mansards with dormers on the wings and the CdL**; PV: slate-blue roofs on the whole palace group; AN06: hip roof (modern) | **Mansard on all Ehrenhof wings + CdL [D LC, PL]**; keep gable/hip as an alternative only for the Küchenflügel and gallery (not depicted) |
| C2 | Rotunde at the Orangerie (05) vs at the gallery end (HMS) | LP06: **no rotunda** in the Orangerie court; a **square end pavilion** at the gallery's E end; K05 too coarse | KB-B07 → rectangular end pavilion (D→ LP06); the rotunda stays an HMS alternative. KB-B13 stays documented-but-unplaced-in-plan (low) |
| C3 | Which feature is the "Große Kaskade" | LP06 draws **58 Große Kaskade S of the round basin (= KL-08 → KL-09)**. The stepped band N of the basin (= KL-03) is a grey **terrace** with the **61 "Tschifflik Pavillon"** in it | Re-identify: cascade = KL-08; KL-03 = terraced stair/terrace (LP06 61/62) |
| C4 | Tschifflik identity | LP06 has **two**: 61 "Tschifflik Pavillon" on the KL-03 terrace axis, and 65 "sog. Tschifflik Pavillon" at the OSM ruin (KL-10). This matches the 1950s note that the real one stood "on a terrace opposite the cascade" (05 a.5) | KL-B42 renamed "sog. Tschifflik"; new building for the real Tschifflik on KL-03 |
| C14 | Which wing was the Duke's | LP06: **2 Nordflügel = "Flügel des Herzogs"; 3 Südflügel = "Flügel der Herzogin"**; HMS (05): S wing = "herzoglicher Wohnflügel" | Follow LP06 (research plan) and keep HMS as an alternative |
| C15 | Bärenzwinger vs Amphitheater vs Menagerie | LP06: round moated KL-01 = **53 "Amphitheater"**; terraced parallelogram KL-02 = **54 "Menagerie"** (cage cells drawn as 5 cross-strips) | KL-B40 also carries the alias "Amphitheater" (and absorbs UP-07). KL-B43 is aliased "Menagerie" |
| C16 | CdL extent | LP06: CdL (1) is a **46 × 19 m block between the wing heads**, projecting ~7 m E beyond them. Catalogue: 78 m range over the wing ends | Topology change proposed (§3, P1) — medium-low confidence |

---

## 2. Georeferencing

### 2.1 Method

- **Similarity transforms.** Plan pixels (x right, y down) are fitted as X = x, Y = −y, so no reflection occurs.
  Weighted least squares; leave-one-out (LOO) errors are reported.
- **Point-on-line constraints** (iterated projection) are used where the plan draws a road or edge that is a traced
  LiDAR line: the hollow way KB-10/11, the avenue KB-14, and the scarp KB-22.
- **The residuals of line constraints are cross-track only.** Their along-track part is ~0 by construction, so RMS
  values including them are optimistic. Judge the fits by the point residuals.
- **Relief.** The 6-azimuth hillshade `hs_multi.tif` from `scripts/relief.py` (03 §9), from DGM1 2025.
- **Reproduce:**
  ```bash
  cd pipeline
  W=<scratch>/kb  # the output of scripts/mosaic.py + relief.py
  uv run python -I ../zones/schloss-karlsberg/research/scripts/georef_lageplan.py fit
  uv run python -I ../zones/schloss-karlsberg/research/scripts/georef_lageplan.py render $W ../zones/schloss-karlsberg/research/img
  uv run python -I ../zones/schloss-karlsberg/research/scripts/georef_lageplan.py render_vec $W ../zones/schloss-karlsberg/research/img
  uv run python -I ../zones/schloss-karlsberg/research/scripts/georef_lageplan.py vector ../zones/schloss-karlsberg/sources/lageplan2006_buildings.geojson
  uv run python -I ../zones/schloss-karlsberg/research/scripts/georef_lageplan.py compare
  uv run python -I ../zones/schloss-karlsberg/research/scripts/georef_1805.py fit
  uv run python -I ../zones/schloss-karlsberg/research/scripts/georef_1805.py render $W ../zones/schloss-karlsberg/research/img
  ```

### 2.2 The 2006 Lageplan (LP06)

**Control points.** The plan element's centre is matched to the LiDAR feature centroid:
- S wing 3 ↔ KB-02, N wing 2 ↔ KB-03, Westflügel 4 ↔ KB-05, Küchenflügel 5 ↔ KB-06 (weight 0.5; the plan bar is
  longer);
- Orangerie 7 ↔ KB-31;
- Marstall 12 ↔ KB-20 (global fit only);
- Weiher 32 ↔ KB-40 (weight 0.5);
- Baumagazin 36 ↔ LoD2 footprint (KB-B29);
- Amphitheater 53 ↔ KL-01, round basin ↔ KL-04 Tosbecken, Schwanenweiher 57a/b ↔ KL-05/06;
- Menagerie 54 ↔ KL-02 (weight 0.5).

| Transform (used for) | Control | Scale m/px | Plan "up" = grid az | RMS | Point residuals (m) |
|---|---|---|---|---|---|
| **global** similarity (valley, garden buildings, Carlslust approach) | 13 points | 1.395 | 87.0° | **11.7 m** | wings 5.5–7.2, Küchenflügel 13.4, Orangerie 3.8, Marstall 21.5, Weiher 13.6, Baumagazin 15.5, KL-01 1.5, Tosbecken 4.7, Schwanenweiher 11.1 / 1.7, Menagerie 20.4 (LOO max 27) |
| global affine (check) | 13 | 1.385 / 1.415, axes 89.8° | 87.6° | 11.2 m | no gain → the plan has no significant shear |
| **core** (palace, Orangerie, buildings S of the palace) | 5 points + 6 road points (KB-10/11) | 1.463 | 85.7° | 4.7 m | S wing 6.0, N wing 4.1, W wing 5.9, Küchenflügel 5.5, Orangerie 4.8 (LOO 5–8) |
| **north** (Marstall and the utility row) | N/W wings + 6 road points + 2 points on scarp KB-22 (Marstall S end / N edge of garden 11) | 1.270 | 84.7° | 4.7 m | N wing 2.9, W wing 6.8, scarp 9.8 / 4.4 (LOO ≤ 12) |
| **karlslust** | 5 points | 1.378 | 89.9° | 8.3 m | KL-01 7.8, KL-04 0.8, KL-05 8.3, KL-06 4.1, KL-02 13.9 |

- **The plan's scale is not uniform.** It runs 1.27 m/px along the north row and 1.46 m/px in the palace core: the
  core is drawn ~15 % large. A single similarity puts the Marstall ~50 m too far N if fitted to the core alone.
  Hence the separate "north" fit.
- **The "north" fit is supported independently by K05**, whose Marstall block falls on the same ground
  (img/38).
- **Why "the road W of the row = KB-10/11" [I].** LP06 draws its main road immediately W of the Marstall, Jägerhaus
  and Cavaliershaus. The LiDAR hollow way/avenue runs there.
  - The plan's second road E of the row (past 14 Remisen and 17 Torfschuppen) then falls exactly on the deep LiDAR
    hollow way at E ≈ 382280–382300 / N 5466550–5466800 (img/32). This is an independent check.

### 2.3 The 1805 ruins map (K05)

- **Control:**
  - the centre of the two-court palace block ↔ the centre of the LiDAR foundation field;
  - the Orangerie block ↔ the Orangerie;
  - the pond (dark parcel W of no. 121) ↔ KB-40;
  - the Marstall double court ↔ the vectorised LP06 Marstall (weight 0.5, secondary);
  - 2 points on the straight SSE avenue ↔ KB-14;
  - 2 points on the N–S road ↔ KB-11.
- **Result:** similarity, scale **2.27 m/px**, map-up = grid az **1.7°** (north up), **RMS 10.5 m**.
  - Palace 4.3 m, pond 1.0 m, Marstall 12.8 m, Orangerie 18.1 m, roads 1.4–17.3 m.
  - The worst LOO is 22 m (Orangerie, avenue point a).
- **Use.** The map is a 642 px copy; it confirms the layout but adds no footprints beyond LP06.

### 2.4 Images (all ≤ 1600 px; attribution printed on each)

| File | Content |
|---|---|
| [`img/30_lageplan2006_site.jpg`](img/30_lageplan2006_site.jpg) | Whole LP06 (global fit) over the hillshade, with catalogue v1 (cyan) and LiDAR features (yellow) |
| [`img/31_lageplan2006_core.jpg`](img/31_lageplan2006_core.jpg) | Palace core + Orangerie (core fit) |
| [`img/32_lageplan2006_north.jpg`](img/32_lageplan2006_north.jpg) | Marstall / utility row (north fit) |
| [`img/33_lageplan2006_karlslust.jpg`](img/33_lageplan2006_karlslust.jpg) | Carlslust (karlslust fit) — cascade 58 on KL-08, Menagerie on KL-02 |
| [`img/34_lageplan2006_vectors_core.jpg`](img/34_lageplan2006_vectors_core.jpg) | **Vectorised** LP06 footprints (magenta, plan numbers) vs catalogue (cyan) — core |
| [`img/35_lageplan2006_vectors_north.jpg`](img/35_lageplan2006_vectors_north.jpg) | the same — utility row |
| [`img/36_lageplan2006_vectors_south.jpg`](img/36_lageplan2006_vectors_south.jpg) | the same — Orangerie, Taubenhaus |
| [`img/37_map1805_site.jpg`](img/37_map1805_site.jpg) | K05 ink (brown) over the hillshade, with the LP06 vectors |
| [`img/38_map1805_core.jpg`](img/38_map1805_core.jpg) | K05 — palace, gardens, Marstall |

**What the images show.**
- **Palace core (img/31, 34).** Every LP06 palace wing lies on its LiDAR foundation within ~5 m.
  - Court open W; the two Wachhäuser stand at E ≈ 382174 just W of the court mouth.
  - The Westflügel 4 lies on KB-05 and the Küchenflügel 5 on KB-06, but LP06's 5 continues S to the N wing over a
    rubble zone.
  - The gallery 6 runs along the top of the KB-07 scarp and on E to an end pavilion at ≈ 382284 / 5466230.
- **Orangerie (img/36).** The main range sits on the standing W wall KB-30 within ~3–5 m. The S wing ends at the
  V-shaped scarp corner of KB-33.
- **North (img/32, 35, 38).**
  - The Marstall block covers the levelled north terrace KB-20; its S end lies on the KB-22 scarp (by construction)
    and its W range lies on the catalogue's KB-B20.
  - Garden 11 covers the upper block KB-23 exactly; K05 shows hatched garden parcels there too.
  - The Zwinger square sits N of the terrace on the catalogue's KB-B23 spot (±20 m).
- **Carlslust (img/33).** Very good agreement: KL-01, KL-04 and KL-05/06 within 1–8 m. The plan's "Großes Bassin" 60
  falls ~30 m from the "sharp rectangle" KL-13 (03 had flagged it "modern?") → KL-13 may be the basin [I, low].

### 2.5 LP06 vs catalogue v1, building by building

Plan footprints come from `georef_lageplan.py vector`. Each building is the minimum rotated rectangle of its red
fill + 1 px outline, or the traced outline for L/U/ring shapes. Sizes include the plan's thick drawing, so they are
≈ +1–3 m.

| Catalogue | LP06 no. / name | Catalogue centroid E / N | LP06 centroid E / N | dE / dN (LP06 − cat) | Catalogue L × W, az | LP06 L × W, az | Reading |
|---|---|---|---|---|---|---|---|
| KB-B01 | 1 Corps de Logis | 382262 / 5466128 | 382262 / 5466128 | 0 / +1 | 78 × 18, 171 | **46 × 19**, 169 | Same centre and depth. LP06's CdL spans only the court width and projects ~7 m E of the wing heads (palace grid u 27–47, v −21…+25) |
| KB-B02 | 3 Südflügel, *Flügel der Herzogin* | 382227 / 5466091 | 382233 / 5466092 | +6 / +1 | 64 × 17, 80 | 74 × 20, 80 | position ✓; LP06 ~10 m longer (drawing scale) |
| KB-B03 | 2 Nordflügel, *Flügel des Herzogs* | 382218 / 5466150 | 382222 / 5466152 | +4 / +2 | 62 × 20, 80 | 74 × 20, 80 | ✓ |
| KB-B04 | 4 Westflügel | 382188 / 5466184 | 382185 / 5466187 | −2 / +3 | 57 × 13, 170 | 65 × 15, 169 | ✓ |
| KB-B05 | 5 Ostflügel, Küchenflügel | 382241 / 5466196 | 382243 / 5466190 | +2 / −6 | 28 × 13, 170 | **52 × 18**, 170 | LP06 runs S to the N wing (closes the Küchenhof on the E) |
| KB-B06 | 6 Galerieflügel | 382221 / 5466213 | 382246 / 5466223 | +26 / +10 | 62 × 12, 80 | **105 × 12** (thin line ≈ 6–8 m + end pavilion), 82 | extends E to ≈ 382290 |
| KB-B07 | (end pavilion of 6) | 382258 / 5466221 (round D 12) | ≈ 382284 / 5466230 | +26 / +9 | round | ≈ 10 × 12 rectangle | rectangular in LP06 |
| KB-B10–12 | 7 Orangerie (U) | 382242 / 5465967 (main) | 382267 / 5465961 (whole U) | — | main 84 × 10 | U 95 × 74 | main range ✓ (≤ 5 m); N wing ≈ 45 m, S wing ≈ 70–75 m |
| KB-B13 | — | 382262 / 5465972 | — | — | D 28 | — | not on LP06 |
| KB-B20 | 12 Marstall (W range) | 382190 / 5466465 | W range ≈ 382192 / 5466460 | ≈ +2 / −5 | 170 × 12 | W range ≈ 165 × 14 with 3 projections | ✓ |
| KB-B21 | 12 Marstall (E range) | 382266 / 5466465 | E range ≈ 382233 / 5466470 | ≈ **−33** / +5 | 170 × 12 | ≈ 150 × 12 | LP06 E range is ~30 m further W, *inside* the terrace, not on the E scarp |
| KB-B22 | 13 Reithalle | 382228 / 5466470 | 382245 / 5466449 | +17 / −21 | 54 × 18 | 57 × 26 | part of the E range |
| KB-B23 | 15 Zwinger | 382235 / 5466590 | 382215 / 5466572 | −20 / −18 | 40 × 40 | **68 × 48** walled yard + house ≈ 10 × 6 | confirmed as "Zwinger" (K05 too) |
| KB-B24 | 16 Jägerhaus, später Kaserne der Jäger und Scharfschützen | 382203 / 5466650 | 382191 / 5466628 | −12 / −22 | 100 × 14 | **66 × 14** | shorter |
| KB-B25 | 21 Lazarett | 382205 / 5466735 | 382228 / 5466800 | +23 / **+65** | 40 × 14, N–S | 32 × 10, **E–W** | move |
| KB-B26 | 22 Brauerei und Wirtshaus | 382205 / 5466790 | 382247 / 5466774 | **+42** / −16 | 40 × 14 | L-shape 32 × 23 | move; absorbs UP-03 Wirtshaus |
| KB-B27 | 11 Holländische Gärtnerei | KB-23 block | same | ≈ 0 | 82 × 136 | garden on KB-23 (+ a W part across the road) + 3 small buildings | ✓ |
| KB-B29 | 36 Baumagazin | 381515 / 5465818 (today 38 m) | 381528 / 5465816 | +14 / −2 | 38 × 11, 162 | **97 × 18**, 161 | the 1789 building was ~2.5× today's length — fits "shortened" [D dewp] |
| KB-B30 | 38 Carlsberger Hof | 381536 / 5465983 | 381513 / 5465990 | −23 / +7 | 80 × 52 envelope | U-court of 4 ranges 105 × 49 | replace the envelope |
| KL-B40 | 53 Amphitheater | 382935 / 5464913 | 382942 / 5464909 | +7 / −4 | D 54 | D 45 | ✓ (name!) |
| KL-B43 | 54 Menagerie | 383034 / 5464827 | 383036 / 5464824 | +2 / −3 | 210 × 99, 156 | 227 × 101, 159 | ✓ (name!) |
| KL-B42 | 65 sog. Tschifflik Pavillon | 382618 / 5464770 | 382608 / 5464784 | −10 / +14 | 14 × 14 | 14 × 12 | ✓ (name!) |
| KL-B44 | 55 Point de Vue | 383155 / 5464658 | 383163 / 5464632 | +8 / −26 | 8 × 8 | 11 × 11 | rename |

### 2.6 Buildings the catalogue left unplaced — now located by LP06

Footprint rings are in Appendix A (EPSG:25832, CC BY-SA-derived). Centroids and sizes are given below; heights are
from DGM1 (median under the footprint).

| LP06 no. | Name (LP06) | ↔ catalogue | Centroid E / N | L × W (m), az | DTM median (min–max) | Fit / uncertainty |
|---|---|---|---|---|---|---|
| 28 | Wachhäuser (2 small houses at the court mouth) | part of UP-18 (Wache); PV t. "Grand corps de garde devant le Château" [I] | 382174 / 5466112 (pair 33 m apart along N–S) | each ≈ 7 × 8 | 342.0 (341.6–342.9) | core ±6 m |
| 10 | Waffenschmiede | new (PV f. *maison des armuriers*) | 382189 / 5466226 | 17 × 10, 175 | 344.7 | north ±7 m |
| 8 | Taubenhaus (dovecote with lodgings, PV c.) | **UP-04** | 382261 / 5465875 | 57 × 10, 170 | 341.0 | core ±6 m |
| 9 | Chevau-leger Kaserne | new (PV d.) | 382243 / 5465752 | 59 × 15, 176 | 337.4 (334.0–342.5, slope) | core ±10 m |
| 14 | Remisen | **UP-02** | 382276 / 5466515 | 60 × 12, 1 | 343.6 | north ±8 m |
| 17 | Torfschuppen (3 sheds) | new | ≈ 382277 / 5466619 | 3 × ≈ 14 × 10 | 337.1 (on the hollow way's E bank) | north ±10 m |
| 18 | Jägerhof (U, open W) | new | 382242 / 5466673 | 31 × 21 | 342.4 | north ±10 m |
| 19 | **Cavaliershaus** | **UP-01 Kavaliersbau** | 382191 / 5466728 | 81 × 12, 1 | 344.0 | north ±10 m |
| 20 | Kaserne (multi-wing, with court) | new | 382221 / 5466720 | 67 × 44 | 343.1 | north ±10 m |
| 23, 24 | Kaserne, Kaserne | new | 382263 / 5466808; 382291 / 5466807 | 25 × 12; 22 × 12 (E–W) | 343.5; 340.7 | north ±12 m |
| 11 | Holländische Gärtnerei — 3 small buildings (Treibhäuser? [I]) | UP-06 candidate | ≈ 382210 / 5466325 | 3 × ≈ 8 × 6 | ≈ 347.6 | north ±8 m |
| 25, 26, 27 | Schäferei, Schäferei, landwirtschaftlich genutztes Gebäude | new (PV 4. *nouvelle bergerie*?) | 382527 / 5466897; 382572 / 5467041; 382450 / 5467035 | 49 × 41; 74 × 17; 55 × 19 | 316; 311; 309 | global ±15 m |
| 31, 35, 52 | Pavillon | UP-08/09/11 candidates [U] | 382139 / 5465943; 381632 / 5465902; 382796 / 5465302 | 10 × 8; 13 × 11; 39 × 15 | 309; 274; 354 | global ±15 m |
| 33 | Brunnenhaus | (UP-17 is the Hirschwürzloch one — different) | 381824 / 5466098 | 20 × 17 | 290.5 | global ±15 m |
| 34, 45, 47 | Gärtnerei; Gärtnerei Reichard + Kegelbahn; Gärtnerei | UP-06 candidates | 381697 / 5465892; 382478 / 5466051; 382605 / 5465936 | 15 × 10; 44 × 14; 42 × 9 | 286; 349.7; 351.1 | global ±15 m |
| 46 | Hirschwürzloch (round) | **UP-17** | 382718 / 5466029 | D ≈ 17 | 309.5 | global ±15 m |
| 37 | Wachhäuser at the valley entrance | UP-18 (Wache), PV 1. *deux petites maisons … corps de garde et barrière* | 381497 / 5465902 (pair) | each ≈ 6 × 6 | 257.6 | global ±15 m |
| 39, 40, 41 | Scheune, Kelterei, Pastorshäuschen | new | 381507 / 5466071; 381513 / 5466102; 381594 / 5466113 | 40 × 15; 13 × 11; 10 × 8 | 255.5; 260.5; 274.4 | global ±15 m |
| 42 | Carlsdorf (Sanddorf) — 5 small houses | UP-13 "Petit Hameau"? [I] (PV 5. *le petit hameau hors du parc*) | ≈ 381503 / 5466487 | 5 × ≈ 8 × 6 | 262 | global ±15 m |
| 43 | Neue Schäferei | new | 381280 / 5466313 | 3 small, 61 m strip | 251.6 | global ±15 m |
| 50 | Carlsluster Torhaus | **UP-15** | 382643 / 5465425 | 43 × 14, 63 | 356.0 | global ±15 m |
| 51 | Fasanerie | **UP-14** | 382733 / 5465335 | 48 × 18, 102 | 353.5 | global ±15 m |
| 67 | (number not in the legend) | — | 382556 / 5465339 | 43 × 14 | 352.4 | global ±15 m |
| 61 | **Tschifflik Pavillon** (on the KL-03 terrace axis) | new (see C4) | 382822 / 5464951 | 31 × 17 (two marks) | 307.5 | karlslust ±8 m |
| 62 | building at "Terrasse" | new | 382785 / 5464994 | 32 × 17 | 320.1 | karlslust ±10 m |
| 63 | Treillagenpavillon | **UP-16** | 382759 / 5464959 | 33 × 18 | 307.9 | karlslust ±10 m |
| 59 | Standort des Hymenäostempel 1785 | new | 382812 / 5464628 | ≈ 8 × 8 mark | 286.6 (by the KL-09 rondell) | karlslust ±8 m |
| 60, 64 | Großes Bassin, Kleines Bassin (water, not buildings) | terrain features | ≈ 382770 / 5464605; ≈ 382745 / 5464775 | ≈ 40 × 20; small | — | KL-13 and KL-11 candidates [I, low] |
| 56 | Altertum (sham ruin) | KL-B45 | ≈ 382915 / 5464690 | arc | — | karlslust ±10 m |

**Still not placed by any source here:**
- Kapelle, Ballhaus, Apotheke, Hauptwache as such (only the Wachhäuser), Kirchturm (UP-12);
- Bienenhaus (UP-05), Amphitheater as a garden theatre (UP-07, unless = 53), Chinoiserie (UP-08), Lusthaus des Prinzen
  (UP-09), Lustgarten der Herzogin (UP-10), Monbijou (UP-11);
- the Eiskeller (KB-B28, LiDAR only).

LP06's "49 Pavillon im Bereich des Herzogsgartens" has a label but no drawn building.

---

## 3. Proposed catalogue changes

**Scope.** These are proposals only; `catalogue.json` is not edited. "LP06 ring" means the ring in Appendix A for
that plan number.

**Footprint rule.** Where the LiDAR measures a foundation, keep the LiDAR footprint and take only topology and length
from LP06. LP06's wings are drawn ~10–15 % long and thick.

### 3.1 Changes to existing entries

| # | Id | Field | Old → new | Evidence |
|---|---|---|---|---|
| P1 | KB-B01 | `footprint` | u 28.2…46.2, v −37.3…+40.6 (78 × 18) → **u 28.2…46.2, v −22…+23 (≈ 45 × 18)**, i.e. a block between the wing heads | D→ LP06 (u 27–47, v −21…+25), ±5 m; I. Medium-low: the KB-04 corner block may belong to either. Keep the 78 m variant as `alternatives` |
| P1b | KB-B02, KB-B03 | `footprint` | E end at u 28.2 → **u ≈ 39** (the wing heads flank the CdL, which projects ~7 m E) | D→ LP06; LiDAR KB-04 lies in this corner |
| P2 | KB-B01 | `roof.centre`, `facade.axis_tags` | keep; add the tag "**7-axis centre pavilion with its own higher hipped roof + lantern/spire and tall chimneys [D LC 1790; PL]**" | D LC, PL |
| P3 | KB-B01, B02, B03, B04 | `roof.type` / `roof.tags` | mansard "after HMS (secondary); conflicts with enwp" → **mansard [D LC 1790 + PL: mansards with dormers on wings and CdL]**; demote `alternatives` "gable 45°" to low | D LC, PL; PV slate-blue roofs |
| P4 | KB-B02, B03, B04 | `roof.dormers` (new field) | — → **2 rows: lower large segmental-headed dormers on every axis, upper small dormers** | D LC (low-res, ±) |
| P5 | KB-B02 | `head_pavilion` (new sub-element, W end) | — → **W head pavilion: 4 axes, 2 storeys + Mansardwalmdach with 4 dormers + oculus, 4-column portico at EG with a balcony above, broad Freitreppe (~10–12 steps) to a lower level, retaining wall S** | D LC (identification of the wing: I, view from W) |
| P6 | KB-B02 | `name_de`, `function` | "Südflügel (herzoglicher Wohnflügel …?)" → **"Südflügel, Flügel der Herzogin"**; function "Duchess's apartments; dining rooms/Silberkammer per HMS (alternative)" | D LP06 legend 3 (conflicts with HMS) |
| P7 | KB-B03 | `name_de`, `function` | "Nordflügel" → **"Nordflügel, Flügel des Herzogs"**; function "Duke's wing" | D LP06 legend 2 |
| P8 | KB-B04 | `name_de` | add the plan name **"Westflügel"** (keep Sammlungsflügel as function) | D LP06 4 |
| P9 | KB-B05 | `footprint`, `name_de` | 28 × 13 (KB-06 only) → **≈ 47 × 13**: same W/E lines, extended S to the N wing's N face (N 5466166). Name **"Ostflügel, Küchenflügel"** | D→ LP06 5 (52 × 18 drawn); LiDAR rubble S of KB-06 (img/34) |
| P10 | KB-B06 | `footprint` | 62 × 11.5 (E 382189–382252) → **≈ 95 × 8**: axis from (382190, 5466213) to (382280, 5466228); keep the S face on the KB-07 scarp | D→ LP06 6 (thin line ≈ 6–8 m drawn); level question: DTM under the LP06 line is 347.6 (upper plateau) → `base_h` 344.8 or 347.6 [U] |
| P11 | KB-B07 | `roof`, `footprint`, `name_de` | round D 12 dome (HMS) → **rectangular end pavilion ≈ 10 × 12 m centred (382284, 5466230)**, "Pavillon am Ostende der Galerie"; rotunda as HMS alternative; confidence low → low–med | D→ LP06 6 |
| P12 | KB-B11 | `footprint` | 30 × 12 → **≈ 45 × 12** along the N edge of the parterre (LP06 ring 7, N arm) | D→ LP06 7 |
| P13 | KB-B12 | `footprint` | 30 × 12 → **≈ 70 × 12**, from the main range E to the V-scarp corner of KB-33 (≈ 382315 / 5465940) | D→ LP06 7 + LiDAR KB-33 |
| P14 | KB-B13 | `notes`, `confidence` | add "**not drawn in LP06; K05 too coarse**"; keep low | D (absence) |
| P15 | KB-B10 | `notes` | add PV b.: "**L'orangerie et la demeure des Courtisans et la Sommellerie**" — courtiers' lodgings and the cellarage in the Orangerie complex | D PV legend |
| P16 | KB-B20 | `footprint`, `notes` | keep position; length 170 → **≈ 165** (N 5466380–5466545); add 3 risalit projections on the W face (LP06) | D→ LP06 12 + K05 |
| P17 | KB-B21 | `footprint` | E range at E ≈ 382260–382272 → **E ≈ 382227–382240**, ≈ 150 × 12, with the Reithalle forming its middle | D→ LP06 12 (north fit ±7 m) |
| P18 | KB-B22 | `footprint` | 54 × 18 at 382228 / 5466470 → **≈ 57 × 20 at 382245 / 5466449**, in the E range (LP06 draws 26 m wide) | D→ LP06 13 |
| P19 | KB-B20/21 | new parts | add the **N closing range** (≈ 382185–382215 / 5466530–5466550) and **2 E–W cross ranges** → two courts, open to the S (LP06 ring 12) | D→ LP06 12; K05 two-court block |
| P20 | KB-B23 | `name_de`, `footprint` | "Hundezwinger" 40 × 40 at 382235 / 5466590 → **"Zwinger"**, walled yard **≈ 68 × 48** at **382215 / 5466572** + central house ≈ 10 × 6 (LP06 ring 15) | D→ LP06 15 + K05 square; the function (kennel) stays I |
| P21 | KB-B24 | `footprint`, `name_de` | 100 × 14 at 382203 / 5466650 → **66 × 14 at 382191 / 5466628**; name "**Jägerhaus, später Kaserne der Jäger und Scharfschützen**" | D→ LP06 16 |
| P22 | KB-B25 | `footprint`, `placement` | 40 × 14 N–S at 382205 / 5466735 (hypothetical) → **32 × 10 E–W at 382228 / 5466800**; placement "map" | D→ LP06 21 |
| P23 | KB-B26 | `name_de`, `footprint` | "Brauerei" → **"Brauerei und Wirtshaus"**, L-shape **32 × 23 at 382247 / 5466774**; absorbs UP-03; PV q. "Grand Cabaret à la bière", l. "hôtellerie" | D LP06 22, PV |
| P24 | KB-B27 | `name_de`, `notes` | add the plan name "**Holländische Gärtnerei (11)**"; garden also W of the road (LP06); add its 3 small buildings (LP06 ring 11) | D LP06 11, K05 |
| P25 | KB-B29 | `footprint` (1789), `alternatives` | 38 × 11 (today) → **1789 extent ≈ 97 × 18, az 161°, centred 381528 / 5465816** (LP06 ring 36); today's LoD2 part is its S/central section | D→ LP06 36 + D dewp "longer"; PV z. "Le grand magasin avec ses logemens" |
| P26 | KB-B30 | `name_de`, `footprint` | "Hofgut im Tal" envelope → **"Carlsberger Hof"**: 4 ranges around a court ≈ 105 × 49 (LP06 ring 38); PV 2. "La cense avec ses apartemens" [I] | D LP06 38 |
| P27 | KL-B40 | `name_de` / aliases | add "**Amphitheater**" (LP06 53); merge UP-07 into it [I] | D LP06 53 |
| P28 | KL-B43 | `name_de` / aliases | add "**Menagerie**" (LP06 54; the 5 cross-strips at its S end = cage cells) | D LP06 54 |
| P29 | KL-B42 | `name_de` | → "**sog. Tschifflik Pavillon**" (LP06 65); the real Tschifflik is new building N7 | D LP06 61/65; 1950s note (05) |
| P30 | KL-B44 | `name_de` | "Eremitage (?)" → **"Point de Vue"** (LP06 55) | D LP06 55 |
| P31 | KL-B45 | `name_de` | → **"Altertum"** (LP06 56; sham ruin) | D LP06 56 |
| P32 | terrain TF-30/31 | identification | Große Kaskade = KL-03 → **= KL-08 (S of the Tosbecken, to the rondell KL-09)**; KL-03 = stepped "Terrasse" | D LP06 58, 61/62 (resolves 05 C3 differently) |
| P33 | defaults | `render`, `roofs` | add "**palace group slate-blue, service buildings red tile** [D PV 1791]" | D PV |
| P34 | UP-01, 02, 03, 04, 14, 15, 16, 17 | `placement` / `footprint` | unplaced → **placed per LP06** (new ids N-list below) | D→ LP06 |

### 3.2 New buildings

Footprints are the LP06 rings in Appendix A. `base_h` is the DTM median unless noted.

| New id | Name (de) | LP06 | Centroid E / N | Size | `base_h` | Class, roof (proposal) | Confidence |
|---|---|---|---|---|---|---|---|
| N1 | Wachhaus Nord / Wachhaus Süd (Ehrenhof) | 28 | 382173 / 5466124 and 382176 / 5466102 | ≈ 7 × 8 each | 342.0 | PAV; LC: one with a tetrastyle portico + hip roof, one plain with a hip/mansard | med (LP06 + LC agree) |
| N2 | Ehrenhofgitter mit Tor | — | line across the court (position U: mouth u ≈ −36 or nearer the CdL) | ≈ 41 m | 344.8 | wrought-iron grille, gate piers | med (D LC, PL; position U) |
| N3 | Waffenschmiede | 10 | 382189 / 5466226 | 17 × 10 | 344.7 | FARM, 1–2 storeys, tile | low–med |
| N4 | Taubenhaus mit Wohnungen | 8 (= UP-04) | 382261 / 5465875 | 57 × 10 | 341.0 | RANGE1 + central dovecote tower (PV c.) | low–med |
| N5 | Chevau-leger Kaserne | 9 | 382243 / 5465752 | 59 × 15 | 337.4 (slope) | WING2, tile | low–med |
| N6 | Remisen | 14 (= UP-02) | 382276 / 5466515 | 60 × 12 | 343.6 | RANGE1, tile | low–med |
| N7 | Tschifflik-Pavillon (on the terrace opposite the cascade) | 61 | 382822 / 5464951 | ≈ 15 × 15 (2 marks) | 307.5 | PAV "Turkish" | low–med |
| N8 | Torfschuppen (3) | 17 | ≈ 382277 / 5466619 | 3 × ≈ 14 × 10 | 337–340 [check] | FARM | low |
| N9 | Jägerhof | 18 | 382242 / 5466673 | U 31 × 21 | 342.4 | FARM/WING2 | low |
| N10 | Cavaliershaus (= UP-01 Kavaliersbau) | 19 | 382191 / 5466728 | 81 × 12 | 344.0 | WING2, red tile, 2 storeys (PV) | low–med |
| N11 | Kaserne (with court) | 20 | 382221 / 5466720 | 67 × 44 | 343.1 | WING2 | low |
| N12, N13 | Kaserne, Kaserne | 23, 24 | 382263 / 5466808; 382291 / 5466807 | 25 × 12; 22 × 12 | 343.5; 340.7 | WING2 | low |
| N14 | Gewächshäuser der Holländischen Gärtnerei | 11 | ≈ 382210 / 5466325 | 3 × ≈ 8 × 6 | 347.6 | glasshouse | low |
| N15 | Schäferei, Schäferei, Ökonomiegebäude | 25, 26, 27 | see §2.6 | see §2.6 | 316; 311; 309 | FARM | low |
| N16 | Wachhäuser am Taleingang | 37 | 381497 / 5465902 | 2 × ≈ 6 × 6 | 257.6 | PAV | low |
| N17 | Scheune, Kelterei, Pastorshäuschen | 39, 40, 41 | see §2.6 | see §2.6 | 255.5; 260.5; 274.4 | FARM | low |
| N18 | Carlsdorf (Sanddorf) | 42 | ≈ 381503 / 5466487 | 5 houses | 262 | FARM | low |
| N19 | Neue Schäferei | 43 | 381280 / 5466313 | 61 m strip | 251.6 | FARM | low |
| N20 | Gärtnereien (incl. Gärtnerei Reichard + Kegelbahn) | 34, 45, 47 | see §2.6 | see §2.6 | 286; 349.7; 351.1 | FARM/glasshouse | low |
| N21 | Brunnenhaus | 33 | 381824 / 5466098 | 20 × 17 | 290.5 | PAV | low |
| N22 | Hirschwürzloch (= UP-17) | 46 | 382718 / 5466029 | D ≈ 17 | 309.5 | PAV / fountain | low |
| N23 | Pavillons | 31, 35, 52 | see §2.6 | see §2.6 | 309; 274; 354 | PAV | low |
| N24 | Carlsluster Torhaus (= UP-15) | 50 | 382643 / 5465425 | 43 × 14 | 356.0 | PAV/RANGE1 | low |
| N25 | Fasanerie (= UP-14) | 51 | 382733 / 5465335 | 48 × 18 | 353.5 | FARM | low |
| N26 | Treillagenpavillon (= UP-16) + Terrasse building | 63, 62 | 382759 / 5464959; 382785 / 5464994 | 33 × 18; 32 × 17 | 307.9; 320.1 | PAV (trellis) | low |
| N27 | Hymenäostempel (1785) | 59 | 382812 / 5464628 | ≈ 8 × 8 | 286.6 | PAV (temple) | low |
| N28 | building no. 67 (unnamed) | 67 | 382556 / 5465339 | 43 × 14 | 352.4 | ? | low |

**Terrain/water to add:**
- 60 Großes Bassin (≈ 40 × 20 m, ≈ 382770 / 5464605; KL-13 candidate);
- 64 Kleines Bassin (KL-11 candidate);
- 32 Carlsbergweiher drawn ~170 m long (larger than today's 138 m, cf. 03 §4.4);
- 30 Weinberg (vineyard strip down the slope SW of the palace; PV x. "La vigne");
- 48 Apfelallee = KB-14 ✓;
- 29 Hauptzufahrt (valley → court mouth, the LiDAR road in img/31);
- 66 Hauptzufahrt to the Carlslust.

**Note.** **KB-12** (the 588 m E axis avenue) is **not drawn** as a road in LP06 or K05. Its baroque date remains [U].

---

## 4. Open items

1. **Get the two PDFs manually** (§0). Schwan 2012 should contain her plan figures and the Herdegen view; the LDA 2006
   report contains the forecourt investigation. Both could fix the court-mouth grille and the CdL extent (P1).
2. **Hi-res scans** of LC 1790 and of PV would allow reliable window counts. The Commons copies give ±2 axes. The
   holders are Stiftung Karlsberger Hof and the HMP Speyer (05 §g).
3. **LP06 scale anomaly** (1.27 vs 1.46 m/px). For the north row, K05 supports the "north" fit. Building lengths in
   LP06 are drawing lengths: prefer LiDAR lengths where foundations exist.
4. **Gallery level** (344.8 vs 347.6 m, P10) and **CdL topology** (P1): decide with Schwan's plan.

---

## Appendix A — LP06 footprints, EPSG:25832 (simplified 0.75 m)

> Derived from *Karlsberg_Lageplan.gif*, schloss-carlsberg.de, **CC BY-SA 2.0 DE**. These coordinates are a derived
> work under the same licence. Attribute when reused.
>
> - One JSON object per plan building: `rings` are closed polygons; multi-part buildings have several rings.
> - `transform` names the fit (§2.2). Accuracy is ±5–8 m (core, north) and ±15 m (global); "karlslust" is ±8–14 m.
> - Full file with properties: `sources/lageplan2006_buildings.geojson` (git-ignored; regenerate with
>   `georef_lageplan.py vector`).

```jsonl
{"plan_no":"1","name_de":"Corps de Logis","transform":"core","rings":[[[382248.2,5466149.1],[382256.7,5466104.0],[382275.6,5466107.6],[382267.1,5466152.7],[382248.2,5466149.1]]]}
{"plan_no":"2","name_de":"Nordfluegel, Fluegel des Herzogs","transform":"core","rings":[[[382256.2,5466168.8],[382183.6,5466155.4],[382187.3,5466135.5],[382259.9,5466148.9],[382256.2,5466168.8]]]}
{"plan_no":"3","name_de":"Suedfluegel, Fluegel der Herzogin","transform":"core","rings":[[[382267.1,5466108.4],[382194.8,5466095.0],[382198.5,5466075.1],[382270.8,5466088.5],[382267.1,5466108.4]]]}
{"plan_no":"4","name_de":"Westfluegel","transform":"core","rings":[[[382172.1,5466217.2],[382184.2,5466153.2],[382198.8,5466155.9],[382186.7,5466219.9],[382172.1,5466217.2]]]}
{"plan_no":"5","name_de":"Ostfluegel, Kuechenfluegel","transform":"core","rings":[[[382256.6,5466166.2],[382247.4,5466217.1],[382229.9,5466213.9],[382239.2,5466163.1],[382256.6,5466166.2]]]}
{"plan_no":"6","name_de":"Galeriefluegel","transform":"core","rings":[[[382276.0,5466231.1],[382225.3,5466222.9],[382225.7,5466217.1],[382264.9,5466222.9],[382264.8,5466224.4],[382277.9,5466225.4],[382277.8,5466226.9],[382279.3,5466227.0],[382279.5,5466224.0],[382289.7,5466224.8],[382288.8,5466236.5],[382280.1,5466235.8],[382276.0,5466231.1]],[[382195.0,5466216.2],[382186.2,5466215.5],[382186.7,5466209.7],[382208.5,5466212.8],[382208.0,5466218.6],[382194.9,5466217.7],[382195.0,5466216.2]]]}
{"plan_no":"7","name_de":"Orangerie","transform":"core","rings":[[[382315.0,5465948.0],[382260.0,5465937.9],[382257.0,5465958.3],[382252.6,5465957.9],[382252.8,5465956.5],[382242.4,5465957.2],[382248.0,5465922.4],[382262.6,5465923.5],[382262.5,5465924.9],[382275.6,5465925.9],[382275.5,5465927.4],[382290.1,5465928.5],[382290.0,5465929.9],[382292.9,5465930.2],[382293.3,5465924.3],[382300.6,5465924.9],[382300.5,5465926.3],[382309.3,5465927.0],[382308.8,5465932.8],[382320.4,5465935.2],[382320.1,5465939.5],[382318.6,5465939.4],[382315.0,5465948.0]],[[382274.7,5466015.3],[382257.2,5466014.0],[382257.3,5466012.6],[382232.6,5466009.2],[382240.0,5465970.2],[382253.0,5465972.6],[382249.6,5465998.8],[382278.5,5466003.9],[382278.1,5466009.7],[382276.6,5466009.6],[382274.7,5466015.3]]]}
{"plan_no":"8","name_de":"Taubenhaus","transform":"core","rings":[[[382251.4,5465901.8],[382261.5,5465846.2],[382271.6,5465848.0],[382261.5,5465903.6],[382251.4,5465901.8]]]}
{"plan_no":"9","name_de":"Chevau-leger Kaserne","transform":"core","rings":[[[382248.4,5465781.5],[382233.8,5465780.4],[382238.2,5465722.1],[382252.8,5465723.2],[382248.4,5465781.5]]]}
{"plan_no":"10","name_de":"Waffenschmiede","transform":"north","rings":[[[382193.7,5466234.4],[382183.6,5466233.5],[382185.1,5466217.1],[382195.2,5466218.0],[382193.7,5466234.4]]]}
{"plan_no":"11","name_de":"Hollaendische Gaertnerei: kleine Gebaeude im Garten (Treibhaeuser?)","transform":"north","rings":[[[382234.5,5466324.5],[382243.5,5466327.7],[382240.0,5466337.6],[382231.0,5466334.4],[382234.5,5466324.5]],[[382204.9,5466319.7],[382212.4,5466320.4],[382211.5,5466330.5],[382203.9,5466329.8],[382204.9,5466319.7]],[[382181.1,5466314.9],[382192.4,5466315.9],[382191.5,5466326.1],[382180.1,5466325.0],[382181.1,5466314.9]]]}
{"plan_no":"12","name_de":"Marstall","transform":"north","rings":[[[382223.7,5466540.8],[382220.3,5466536.6],[382220.6,5466532.9],[382235.9,5466533.0],[382235.2,5466499.8],[382222.4,5466499.9],[382222.9,5466494.8],[382220.6,5466492.0],[382221.0,5466488.2],[382235.0,5466488.3],[382234.9,5466475.5],[382247.6,5466476.7],[382248.7,5466478.1],[382247.6,5466489.5],[382248.9,5466489.6],[382247.8,5466501.0],[382249.1,5466501.1],[382248.0,5466512.5],[382249.3,5466512.6],[382248.2,5466524.0],[382249.5,5466524.1],[382248.4,5466535.5],[382249.7,5466535.6],[382248.7,5466545.7],[382222.0,5466545.7],[382223.7,5466540.8]],[[382221.9,5466410.5],[382222.3,5466405.5],[382223.6,5466405.6],[382223.0,5466397.9],[382234.4,5466398.9],[382235.6,5466372.3],[382245.8,5466373.2],[382246.9,5466374.6],[382245.9,5466398.8],[382247.2,5466398.9],[382246.2,5466423.0],[382233.6,5466421.8],[382234.5,5466411.7],[382233.4,5466410.3],[382221.9,5466410.5]],[[382208.3,5466541.9],[382209.6,5466542.0],[382207.8,5466547.0],[382182.4,5466545.9],[382183.6,5466533.2],[382211.6,5466533.3],[382209.9,5466538.2],[382208.6,5466538.1],[382208.3,5466541.9]],[[382203.6,5466523.6],[382202.2,5466524.8],[382192.1,5466523.8],[382191.7,5466500.8],[382186.7,5466500.3],[382186.6,5466501.6],[382181.6,5466499.9],[382182.7,5466488.5],[382186.5,5466488.8],[382187.2,5466481.3],[382185.9,5466481.1],[382186.9,5466471.0],[382185.6,5466470.9],[382186.7,5466459.5],[382183.0,5466457.9],[382183.1,5466442.6],[382185.7,5466442.9],[382186.4,5466435.3],[382185.1,5466435.2],[382186.0,5466412.3],[382180.9,5466411.8],[382181.2,5466409.3],[382179.9,5466409.2],[382180.8,5466399.0],[382188.4,5466399.7],[382189.8,5466398.6],[382190.0,5466396.1],[382188.8,5466396.0],[382190.0,5466383.3],[382188.7,5466383.2],[382189.5,5466374.3],[382190.9,5466373.2],[382201.0,5466374.1],[382201.3,5466398.4],[382208.9,5466399.1],[382208.4,5466404.2],[382210.7,5466406.9],[382210.4,5466410.7],[382197.6,5466410.8],[382196.8,5466419.7],[382198.0,5466419.8],[382197.3,5466441.4],[382201.0,5466443.0],[382200.1,5466451.9],[382201.4,5466452.0],[382200.8,5466458.3],[382198.3,5466458.1],[382198.1,5466487.4],[382199.2,5466488.8],[382209.5,5466488.4],[382209.0,5466493.5],[382207.7,5466493.4],[382208.3,5466501.1],[382203.2,5466500.6],[382203.6,5466523.6]]]}
{"plan_no":"13","name_de":"Reithalle","transform":"north","rings":[[[382231.3,5466421.2],[382257.4,5466420.7],[382258.4,5466477.4],[382232.3,5466477.8],[382231.3,5466421.2]]]}
{"plan_no":"14","name_de":"Remisen","transform":"north","rings":[[[382282.1,5466484.7],[382283.1,5466544.8],[382270.8,5466545.0],[382269.7,5466484.9],[382282.1,5466484.7]]]}
{"plan_no":"15","name_de":"Zwinger","transform":"north","rings":[[[382210.0,5466577.8],[382210.6,5466571.5],[382223.3,5466572.6],[382222.7,5466579.0],[382210.0,5466577.8]],[[382184.1,5466595.8],[382184.4,5466593.2],[382183.1,5466593.1],[382184.2,5466581.7],[382182.9,5466581.6],[382184.0,5466570.2],[382182.7,5466570.1],[382183.8,5466558.7],[382182.5,5466558.6],[382183.4,5466548.5],[382194.8,5466549.6],[382194.9,5466548.3],[382206.3,5466549.4],[382206.4,5466548.1],[382219.1,5466549.3],[382219.2,5466548.0],[382249.8,5466548.3],[382248.7,5466559.7],[382250.0,5466559.8],[382248.9,5466571.2],[382250.2,5466571.3],[382249.1,5466582.7],[382250.4,5466582.8],[382249.2,5466595.5],[382184.1,5466595.8]]]}
{"plan_no":"16","name_de":"Jaegerhaus, spaeter Kaserne der Jaeger und Scharfschuetzen","transform":"north","rings":[[[382184.4,5466660.7],[382183.3,5466594.8],[382196.9,5466594.6],[382198.0,5466660.5],[382184.4,5466660.7]]]}
{"plan_no":"17","name_de":"Torfschuppen","transform":"north","rings":[[[382271.7,5466655.0],[382272.9,5466642.3],[382283.0,5466643.3],[382281.8,5466655.9],[382271.7,5466655.0]],[[382272.5,5466619.3],[382282.6,5466620.3],[382281.4,5466632.9],[382271.3,5466632.0],[382272.5,5466619.3]],[[382272.0,5466583.6],[382282.1,5466584.5],[382280.3,5466603.5],[382270.2,5466602.5],[382272.0,5466583.6]]]}
{"plan_no":"18","name_de":"Jaegerhof","transform":"north","rings":[[[382240.4,5466689.0],[382231.6,5466688.2],[382232.3,5466680.6],[382245.1,5466680.5],[382248.2,5466674.5],[382252.0,5466674.8],[382250.7,5466688.7],[382240.6,5466687.8],[382240.4,5466689.0]],[[382247.4,5466669.3],[382245.1,5466666.5],[382231.1,5466666.5],[382231.8,5466658.9],[382233.2,5466657.7],[382251.0,5466658.1],[382250.9,5466672.2],[382247.2,5466671.8],[382247.4,5466669.3]]]}
{"plan_no":"19","name_de":"Cavaliershaus","transform":"north","rings":[[[382196.8,5466687.7],[382198.2,5466769.0],[382186.1,5466769.2],[382184.7,5466687.9],[382196.8,5466687.7]]]}
{"plan_no":"20","name_de":"Kaserne","transform":"north","rings":[[[382227.8,5466755.5],[382203.7,5466754.5],[382203.0,5466748.0],[382205.6,5466748.3],[382205.7,5466747.0],[382217.1,5466748.1],[382217.2,5466746.8],[382227.3,5466747.8],[382228.2,5466724.9],[382230.8,5466723.8],[382231.0,5466721.3],[382234.8,5466721.7],[382234.3,5466740.8],[382235.6,5466740.9],[382234.3,5466754.8],[382228.0,5466754.2],[382227.8,5466755.5]],[[382242.8,5466704.6],[382234.0,5466703.7],[382234.0,5466716.5],[382229.0,5466716.0],[382228.0,5466713.4],[382222.9,5466712.9],[382222.8,5466714.2],[382218.9,5466715.1],[382218.6,5466717.6],[382217.4,5466717.5],[382217.8,5466726.5],[382216.4,5466727.6],[382202.5,5466726.3],[382202.4,5466713.5],[382211.3,5466714.4],[382213.0,5466709.4],[382211.8,5466709.3],[382212.8,5466697.9],[382211.7,5466696.6],[382202.8,5466695.7],[382201.7,5466694.3],[382202.3,5466688.0],[382220.1,5466688.4],[382220.7,5466708.9],[382227.2,5466708.2],[382226.0,5466706.8],[382227.1,5466695.4],[382244.9,5466695.8],[382245.5,5466703.5],[382242.9,5466703.3],[382242.8,5466704.6]]]}
{"plan_no":"21","name_de":"Lazarett","transform":"north","rings":[[[382244.0,5466804.7],[382211.9,5466805.3],[382211.7,5466794.9],[382243.8,5466794.3],[382244.0,5466804.7]]]}
{"plan_no":"22","name_de":"Brauerei und Wirtshaus","transform":"north","rings":[[[382266.2,5466782.0],[382235.6,5466781.7],[382235.2,5466758.7],[382244.0,5466759.5],[382243.9,5466774.8],[382253.9,5466777.0],[382259.4,5466772.4],[382267.0,5466773.2],[382266.2,5466782.0]]]}
{"plan_no":"23","name_de":"Kaserne","transform":"north","rings":[[[382275.8,5466813.2],[382250.6,5466814.0],[382250.3,5466802.5],[382275.5,5466801.7],[382275.8,5466813.2]]]}
{"plan_no":"24","name_de":"Kaserne","transform":"north","rings":[[[382302.0,5466813.1],[382280.0,5466813.1],[382280.0,5466801.6],[382302.0,5466801.6],[382302.0,5466813.1]]]}
{"plan_no":"25","name_de":"Schaeferei","transform":"global","rings":[[[382511.3,5466925.1],[382509.3,5466913.2],[382549.3,5466906.5],[382551.3,5466918.3],[382511.3,5466925.1]],[[382548.3,5466899.2],[382507.9,5466906.0],[382505.9,5466894.2],[382546.3,5466887.4],[382548.3,5466899.2]],[[382503.1,5466876.5],[382543.3,5466869.8],[382545.3,5466881.6],[382505.1,5466888.4],[382503.1,5466876.5]]]}
{"plan_no":"26","name_de":"Schaeferei","transform":"global","rings":[[[382579.4,5467045.0],[382580.1,5467031.0],[382601.0,5467032.1],[382600.3,5467046.0],[382579.4,5467045.0]],[[382530.0,5467053.6],[382528.0,5467043.6],[382542.7,5467040.7],[382544.7,5467050.7],[382530.0,5467053.6]]]}
{"plan_no":"27","name_de":"Landwirtschaftlich genutztes Gebaeude","transform":"global","rings":[[[382478.7,5467040.5],[382424.3,5467048.9],[382421.4,5467029.9],[382475.8,5467021.5],[382478.7,5467040.5]]]}
{"plan_no":"28","name_de":"Wachhaeuser","transform":"core","rings":[[[382179.8,5466106.5],[382171.1,5466105.8],[382171.8,5466095.6],[382180.6,5466096.3],[382179.8,5466106.5]],[[382175.2,5466128.1],[382166.5,5466127.5],[382167.3,5466117.3],[382176.0,5466117.9],[382175.2,5466128.1]]]}
{"plan_no":"31","name_de":"Pavillon","transform":"global","rings":[[[382143.8,5465938.2],[382135.4,5465937.8],[382134.9,5465947.5],[382143.3,5465948.0],[382143.8,5465938.2]]]}
{"plan_no":"33","name_de":"Brunnenhaus","transform":"global","rings":[[[381833.3,5466106.5],[381813.8,5466105.5],[381814.7,5466088.7],[381834.2,5466089.8],[381833.3,5466106.5]]]}
{"plan_no":"34","name_de":"Gaertnerei","transform":"global","rings":[[[381704.5,5465897.2],[381689.1,5465896.4],[381689.7,5465886.7],[381705.0,5465887.5],[381704.5,5465897.2]]]}
{"plan_no":"35","name_de":"Pavillon","transform":"global","rings":[[[381638.3,5465907.7],[381625.7,5465907.1],[381626.3,5465895.9],[381638.8,5465896.6],[381638.3,5465907.7]]]}
{"plan_no":"36","name_de":"Baumagazin","transform":"global","rings":[[[381552.5,5465772.9],[381521.0,5465864.6],[381503.7,5465858.6],[381535.1,5465767.0],[381552.5,5465772.9]]]}
{"plan_no":"37","name_de":"Wachhaeuser","transform":"global","rings":[[[381500.8,5465918.8],[381492.4,5465918.3],[381492.9,5465908.6],[381501.3,5465909.0],[381500.8,5465918.8]],[[381500.9,5465889.4],[381494.0,5465889.1],[381494.4,5465880.7],[381501.4,5465881.1],[381500.9,5465889.4]]]}
{"plan_no":"38","name_de":"Carlsberger Hof","transform":"global","rings":[[[381528.6,5466029.2],[381530.0,5466029.2],[381530.1,5466026.4],[381532.9,5466026.6],[381532.6,5466005.6],[381541.0,5466006.1],[381540.8,5466035.4],[381528.2,5466036.1],[381528.6,5466029.2]],[[381534.2,5466001.5],[381534.8,5465963.8],[381533.4,5465963.8],[381533.7,5465958.2],[381526.6,5465959.2],[381525.8,5465948.0],[381539.7,5465948.7],[381541.2,5466001.9],[381539.7,5466003.2],[381534.2,5466001.5]],[[381493.7,5466000.8],[381509.1,5466001.6],[381508.1,5466019.7],[381509.5,5466019.8],[381509.1,5466026.8],[381513.3,5466027.0],[381514.2,5466036.8],[381493.3,5466035.7],[381493.7,5466000.8]],[[381503.9,5465993.0],[381492.7,5465993.8],[381492.8,5465937.9],[381491.4,5465937.8],[381493.1,5465932.3],[381500.1,5465932.7],[381499.7,5465939.6],[381501.1,5465939.7],[381501.0,5465942.5],[381503.7,5465942.7],[381503.4,5465948.2],[381511.8,5465948.7],[381511.6,5465952.8],[381510.2,5465952.8],[381511.2,5465959.8],[381504.3,5465959.4],[381503.9,5465993.0]]]}
{"plan_no":"39","name_de":"Scheune","transform":"global","rings":[[[381507.0,5466049.2],[381520.3,5466087.1],[381506.6,5466091.9],[381493.3,5466054.0],[381507.0,5466049.2]]]}
{"plan_no":"40","name_de":"Kelterei","transform":"global","rings":[[[381521.3,5466105.4],[381508.5,5466109.0],[381505.6,5466098.6],[381518.5,5466095.0],[381521.3,5466105.4]]]}
{"plan_no":"41","name_de":"Pastorshaeuschen","transform":"global","rings":[[[381598.0,5466118.0],[381589.6,5466117.6],[381590.1,5466107.8],[381598.5,5466108.2],[381598.0,5466118.0]]]}
{"plan_no":"42","name_de":"Carlsdorf (Sanddorf)","transform":"global","rings":[[[381519.9,5466411.5],[381529.6,5466412.0],[381528.6,5466431.5],[381518.8,5466431.0],[381519.9,5466411.5]],[[381509.6,5466475.2],[381517.9,5466475.6],[381517.3,5466488.2],[381508.9,5466487.7],[381509.6,5466475.2]],[[381505.7,5466496.0],[381514.0,5466496.4],[381513.4,5466508.9],[381505.0,5466508.5],[381505.7,5466496.0]],[[381488.2,5466509.0],[381487.4,5466524.4],[381479.1,5466523.9],[381479.9,5466508.6],[381488.2,5466509.0]],[[381484.2,5466532.6],[381483.4,5466547.9],[381473.7,5466547.4],[381474.5,5466532.1],[381484.2,5466532.6]]]}
{"plan_no":"43","name_de":"Neue Schaeferei","transform":"global","rings":[[[381297.2,5466302.0],[381291.3,5466295.5],[381299.3,5466288.4],[381305.1,5466294.8],[381297.2,5466302.0]],[[381284.7,5466300.2],[381293.1,5466309.6],[381277.9,5466323.3],[381269.4,5466313.9],[381284.7,5466300.2]],[[381255.9,5466331.4],[381265.3,5466322.9],[381271.8,5466330.1],[381262.4,5466338.6],[381255.9,5466331.4]]]}
{"plan_no":"45","name_de":"Gaertnerei Reichard, Kegelbahn","transform":"global","rings":[[[382457.1,5466041.5],[382500.9,5466047.8],[382499.0,5466061.5],[382455.2,5466055.2],[382457.1,5466041.5]]]}
{"plan_no":"46","name_de":"Hirschwuerzloch","transform":"global","rings":[[[382725.5,5466034.1],[382719.7,5466038.0],[382711.5,5466036.2],[382710.3,5466032.0],[382708.9,5466031.9],[382710.8,5466022.2],[382712.3,5466020.9],[382723.4,5466021.5],[382726.0,5466024.4],[382725.5,5466034.1]]]}
{"plan_no":"47","name_de":"Gaertnerei","transform":"global","rings":[[[382597.8,5465956.0],[382603.6,5465914.3],[382612.6,5465915.6],[382606.8,5465957.2],[382597.8,5465956.0]]]}
{"plan_no":"50","name_de":"Carlsluster Torhaus","transform":"global","rings":[[[382627.4,5465409.1],[382665.5,5465428.8],[382658.9,5465441.6],[382620.8,5465421.8],[382627.4,5465409.1]]]}
{"plan_no":"51","name_de":"Fasanerie","transform":"global","rings":[[[382758.5,5465338.7],[382711.9,5465348.5],[382708.2,5465331.2],[382754.8,5465321.3],[382758.5,5465338.7]]]}
{"plan_no":"52","name_de":"Pavillon","transform":"global","rings":[[[382781.2,5465316.1],[382797.8,5465280.9],[382811.1,5465287.2],[382794.6,5465322.4],[382781.2,5465316.1]]]}
{"plan_no":"53","name_de":"Amphitheater","transform":"karlslust","rings":[[[382963.9,5464917.5],[382955.6,5464928.5],[382951.4,5464928.5],[382948.7,5464931.3],[382930.8,5464929.9],[382922.5,5464922.9],[382922.5,5464920.2],[382919.8,5464917.4],[382919.8,5464899.5],[382921.2,5464899.5],[382922.6,5464894.0],[382926.8,5464889.9],[382932.3,5464888.5],[382932.3,5464887.2],[382936.4,5464887.2],[382936.4,5464885.8],[382951.6,5464887.2],[382951.6,5464888.6],[382957.1,5464890.0],[382959.8,5464892.7],[382959.8,5464895.5],[382962.6,5464896.9],[382963.9,5464917.5]]]}
{"plan_no":"54","name_de":"Menagerie","transform":"karlslust","rings":[[[383079.8,5464842.1],[383074.2,5464860.0],[383071.5,5464862.7],[383070.1,5464871.0],[383068.7,5464871.0],[383067.3,5464877.9],[383064.5,5464880.6],[383064.5,5464884.7],[383061.8,5464887.5],[383060.4,5464895.7],[383059.0,5464895.7],[383057.6,5464902.6],[383054.8,5464905.4],[383053.4,5464913.6],[383052.1,5464913.6],[383050.7,5464920.5],[383047.9,5464923.3],[383046.5,5464931.5],[383045.1,5464931.5],[383043.7,5464938.4],[383041.0,5464941.2],[383038.2,5464952.2],[383029.9,5464950.8],[383016.2,5464937.0],[383013.4,5464937.0],[383001.1,5464924.5],[382998.3,5464924.5],[382992.8,5464917.6],[382990.1,5464917.6],[382985.9,5464912.1],[382983.2,5464912.1],[382977.7,5464905.2],[382974.9,5464905.2],[382969.4,5464898.3],[382966.7,5464898.3],[382961.2,5464891.4],[382957.1,5464890.0],[382959.9,5464876.2],[382961.2,5464876.2],[382962.6,5464869.3],[382965.4,5464866.6],[382965.4,5464862.4],[382968.2,5464859.7],[382969.6,5464851.4],[382970.9,5464851.4],[382972.3,5464844.5],[382975.1,5464841.8],[382976.5,5464833.5],[382977.9,5464833.5],[382979.3,5464826.7],[382982.0,5464823.9],[382983.4,5464815.6],[382984.8,5464815.7],[382986.2,5464808.8],[382989.0,5464806.0],[382989.0,5464801.9],[382991.7,5464799.1],[382993.1,5464790.9],[382995.9,5464788.1],[383000.1,5464773.0],[383002.8,5464770.2],[383002.8,5464766.1],[383005.6,5464763.4],[383005.6,5464759.2],[383008.4,5464756.5],[383009.8,5464748.2],[383012.5,5464745.5],[383012.6,5464741.3],[383015.3,5464738.6],[383016.7,5464730.3],[383019.5,5464727.6],[383019.5,5464723.4],[383022.2,5464720.7],[383023.6,5464712.4],[383025.0,5464712.4],[383026.4,5464708.3],[383031.9,5464708.3],[383034.7,5464711.1],[383042.9,5464712.5],[383042.9,5464713.9],[383049.8,5464715.3],[383052.6,5464718.0],[383060.8,5464719.4],[383060.8,5464720.8],[383067.7,5464722.2],[383070.5,5464724.9],[383078.7,5464726.3],[383078.7,5464727.7],[383085.6,5464729.1],[383088.3,5464731.9],[383096.6,5464733.3],[383096.6,5464734.7],[383103.5,5464736.1],[383106.2,5464738.8],[383110.4,5464738.8],[383113.1,5464741.6],[383117.3,5464741.6],[383117.2,5464748.5],[383115.9,5464748.5],[383114.5,5464756.7],[383110.3,5464762.2],[383107.5,5464774.6],[383103.4,5464780.1],[383102.0,5464788.4],[383099.2,5464791.1],[383095.0,5464806.3],[383092.3,5464809.0],[383092.3,5464813.2],[383089.5,5464815.9],[383088.1,5464824.2],[383085.3,5464826.9],[383085.3,5464831.1],[383084.0,5464831.1],[383081.2,5464842.1],[383079.8,5464842.1]]]}
{"plan_no":"55","name_de":"Point de Vue","transform":"karlslust","rings":[[[383168.5,5464637.0],[383157.5,5464637.0],[383157.5,5464626.0],[383168.5,5464626.0],[383168.5,5464637.0]]]}
{"plan_no":"59","name_de":"Standort des Hymenaeostempel 1785","transform":"karlslust","rings":[[[382817.2,5464633.4],[382806.2,5464633.3],[382806.2,5464622.3],[382817.2,5464622.3],[382817.2,5464633.4]]]}
{"plan_no":"61","name_de":"Tschifflik Pavillon","transform":"karlslust","rings":[[[382838.0,5464958.4],[382806.8,5464960.4],[382805.8,5464943.5],[382836.9,5464941.5],[382838.0,5464958.4]]]}
{"plan_no":"62","name_de":"Terrasse (Gebaeude am Label 62)","transform":"karlslust","rings":[[[382768.9,5464986.0],[382800.5,5464984.1],[382801.5,5465001.1],[382769.9,5465003.0],[382768.9,5464986.0]]]}
{"plan_no":"63","name_de":"Treillagenpavillon","transform":"karlslust","rings":[[[382740.2,5464962.9],[382765.3,5464941.8],[382776.9,5464955.6],[382751.9,5464976.7],[382740.2,5464962.9]]]}
{"plan_no":"65","name_de":"sog. Tschifflik Pavillon","transform":"karlslust","rings":[[[382598.6,5464783.0],[382607.4,5464774.2],[382617.6,5464784.4],[382608.8,5464793.2],[382598.6,5464783.0]]]}
{"plan_no":"67","name_de":"(Nr. 67, nicht in der Legende)","transform":"global","rings":[[[382573.5,5465353.8],[382533.1,5465338.0],[382538.3,5465324.7],[382578.7,5465340.5],[382573.5,5465353.8]]]}
```

## Appendix B — "Pleine vue du Carlsberg" 1791, legend

This is a transcription from the 1300 px Commons copy, read from 2–3× crops. The spelling follows the sheet. Bracketed
notes give the LP06 match; these matches are [I] unless stated.

- **a.** "… du Château de Carlsberg en 1776" — beginning illegible/cut [U].
- **b.** L'orangerie et la demeure des Courtisans et la Sommellerie [LP06 7].
- **c.** Colombier avec ses logemens de part et d'autre [LP06 8 Taubenhaus].
- **d.** Caserne des chevaux légers [LP06 9].
- **e.** Chemin de Carlslust [LP06 66].
- **f.** Maison des armuriers [LP06 10 Waffenschmiede].
- **g.** La serre chaude … avec son logement [LP06 11 garden buildings?].
- **h.** Les écuries avec leurs apartemens des palfreniers et manège aux chevaux [LP06 12/13].
- **i.** La maison des Veneurs [LP06 16 Jägerhaus].
- **k.** La caserne avec la place d'armes [LP06 20 Kaserne with court].
- **l.** L'hôtellerie avec ses écuries [LP06 22 Wirtshaus].
- **m.** Maison et logement des officiers [LP06 19 Cavaliershaus?].
- **n.** Autre maison à côté de la maison des officiers.
- **o.** L'hôpital [LP06 21 Lazarett].
- **p.** Deux nouvelles casernes vis à vis de l'hôpital [LP06 23, 24].
- **q.** Grand Cabaret à la bierre [LP06 22 Brauerei].
- **r.** La petite maison du cousin.
- **S.** Aqueduc de la fontaine de Lambsbronne de 1600 toises … tombant dans un bassin aux grandes écuries. The middle
  of this item is partly illegible.
- **t.** Grand corps de garde devant le Château [LP06 28 Wachhäuser].
- **u.** L'allée des marronniers sauvages.
- **v.** Fontaine par machine conduite à la cuisine et aux casernes.
- **x.** La vigne avec son logement [LP06 30 Weinberg].
- **y.** L'étang entre les deux montagnes [LP06 32 Carlsbergweiher].
- **z.** Le grand magasin avec ses logemens [LP06 36 Baumagazin].
- **1.** Les deux petites maisons en entrant au parc pour le corps de garde et la barrière [LP06 37 Wachhäuser].
- **2.** La cense avec ses apartemens [LP06 38 Carlsberger Hof].
- **3.** Jardin et maison de plaisance.
- **4.** La nouvelle bergerie et maison [LP06 43 Neue Schäferei].
- **5.** Le petit hameau hors du parc [LP06 42 Carlsdorf?].
- **6.** Chemin par le bois à la Faisanderie.
- **7.** La Faisanderie dans le bois d'Erbach avec son petit corps de garde [LP06 51].
- **8.** La chaussée pour aller à Hombourg.
- **9.** La chaussée à Erbach.

**How this supports §2.6.** The 1791 legend lists the same service town that LP06 places on the north row: hunters'
house, barracks with a parade ground, officers' houses, hospital, two new barracks opposite the hospital, inn and
beer tavern. This independently supports the new buildings N9–N13 and P21–P23 as **[D PV]** for existence. Their
positions remain **[D→ LP06]**.
