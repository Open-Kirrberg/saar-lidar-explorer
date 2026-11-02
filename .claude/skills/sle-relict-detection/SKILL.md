---
name: sle-relict-detection
description: Semi-automatic detection of possible archaeological relicts (pits/bomb craters, mounds/burial mounds, ditches and hollow ways, walls and terrace edges, rectangular foundations, charcoal-kiln platforms) in the Saar LiDAR Explorer's 1 m DTM — algorithm design, pipeline implementation, candidate data format, scoring, review UI in the app, and evaluation against known sites. Use it for PRD feature F15 or whenever the user asks to "find anomalies", "highlight suspicious spots", "detect bunkers/craters/walls automatically", tune detection thresholds, or reduce false positives — and also when they ask how reliable the candidates are.
---

# Relict candidate detection (F15)

Goal: point the user's eye at spots worth a closer look. The output is **hypotheses**, ranked and reviewable — not findings. The user explores by eye first (PRD decision), so detection is a highlight layer plus a review queue, never a replacement for looking.

Background reading: `research/03-archaeology-visualization.md` Part A2 (detection ideas, ML options and their licences, local false positives) and Part B (known sites for evaluation).

## Ethics and law (shape the design, not just the disclaimer)

Bodendenkmäler in the Saarland are protected even when unknown (SDschG §§ 3, 8); targeted searching with tools needs a permit, finds must be reported (§ 16). Therefore:

- Candidates are generated and stored **locally** (`app/public/data/<aoi>/candidates/…`, git-ignored like all data). Don't publish candidate coordinates, don't upload them anywhere, and don't add features that guide digging or detector use.
- Every candidate UI shows that it is a hypothesis; the "Schauen, nicht graben" disclaimer stays visible from the candidate panel.
- Confirmed candidates become normal private markers (user decides about reporting via F18).

## Pipeline: `pipeline/detect.py <aoi>`

Run on the **buffered** DTM (AOI + buffer, then crop) — reuse `build.py`'s mosaic/relief outputs from `data/work/<aoi>/` rather than recomputing.

1. **Local relief** at two scales (e.g. SLRM r = 10 m and r = 25 m) — from rvt-py or a box/Gaussian low-pass.
2. **Depressions (Gruben, Trichter, Bunkersprengungen):** connected regions with LRM < −t (start t = 0.3 m), area 3–400 m²; features: area, depth (min LRM), circularity (4πA/P²), rectangularity (A / minimum-area-rectangle), rim (ring mean LRM > 0 → crater with ejecta rim), slope inside.
3. **Mounds (Hügelgräber, Meilerplatten):** LRM > +t regions, 5–40 m diameter, circularity high; kiln platforms: flat (low slope inside), 8–15 m, often on slopes with a terrace edge downhill.
4. **Linear features (Gräben, Hohlwege, Wälle, Mauern):** ridge/valley detection on LRM or negative/positive openness (thresholded, skeletonized), segments ≥ 20 m; straightness and parallel pairs (ditch + bank). Suppress segments that coincide with OSM ways within ~3 m (needs F10 data) — but keep them as a separate class "Weg (bekannt)" instead of dropping, because old roads under modern paths are interesting too.
5. **Rectangles (Fundamente, Bunker):** combine (2)/(3) with rectangularity > 0.8 and straight edges; also slope-break polygons with right angles.
6. **False-positive filters:** building mask (ALKIS / class 6), water bodies (OSM), road embankments (OSM ways buffer), uprooted-tree pits (small, paired pit + mound within 3 m, random orientation → down-weight), DTM interpolation areas (`mask` layer > 0 → down-weight, sparse ground points), steep natural gullies (high upslope contributing area). Note local specifics: inland dunes near the Karlsbergweiher produce mound-like shapes.
7. **Score** 0–1 per candidate from the features (transparent weighted rule set first; document weights in the manifest). Don't over-engineer: a simple, explainable score the user can tune beats an opaque one.

Output (additive contract entry — add it to `docs/data-contract.md` first):

```jsonc
"candidates": {
  "path": "candidates/candidates.geojson",       // EPSG:25832 points + polygons/lines
  "mask": "candidates/mask/{i}_{j}.png",         // optional u8 class raster for a highlight overlay
  "params": { "lrm_radius_m": [10, 25], "threshold_m": 0.3, "...": "..." },
  "classes": { "pit": "Grube/Trichter", "mound": "Hügel", "linear": "Graben/Wall/Weg", "rect": "Rechteckstruktur", "platform": "Plattform" }
}
```

Each feature: `id`, `class`, `score`, `area_m2`, `depth_m`/`height_m`, `length_m`, `circularity`, `rectangularity`, `reasons` (short German strings like "rund, 0,8 m tief, mit Randwall"), `near_poi` (id if within 50 m of a known site).

## App: review workflow

- Overlay "Verdachtsflächen" (class colours, opacity, min-score slider) on top of any relief mode.
- Panel "Kandidaten": list sorted by score with class filter; **Weiter/Zurück** (keys `N`/`P`) flies to each candidate at an oblique angle and a low altitude, preselecting a suitable relief preset (pits → "Gräben & Gruben", walls → "Mauern & Kanten").
- Review: **bestätigen** (creates a private marker with category + reasons), **verwerfen**, **unsicher**; store decisions locally (`localStorage` `sle.candidates.v1.<aoi>`) and allow export, so thresholds can be tuned against the user's judgments later.

## Evaluate, don't guess

- **Known-site recall:** for POIs from `pois.geojson` that should be visible in a DTM (Karlsberg terraces/foundations, Merburg, Rabenhorst barrow group — 9 mounds, one excavated, bunker ruins), report how many are hit by a candidate within 30 m and with which class.
- **Density sanity:** candidates per km² by class; if the forest is carpeted with hundreds of pits per km², raise thresholds or improve filters before shipping.
- **User judgments:** once reviewed decisions exist, report precision per class and per score band, and suggest threshold changes.
- Unit-test pure feature computations (circularity/rectangularity on synthetic shapes; the app's fixture already contains a foundation, ring ditch and pits — extend it rather than inventing new synthetic data).

## Phase 2 (only if the rule-based layer proves useful)

Small ML model on VAT/SLRM tiles trained on the user's own confirmed candidates (local, in-browser via ONNX/TF.js or in the pipeline). Public pretrained models for barrows/charcoal kilns mostly carry non-commercial licences — fine for this personal tool, but note the licence in the PRD before using them.
