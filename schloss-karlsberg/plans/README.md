# plans/ – Plansatz Schloss Karlsberg um 1789

Generated architectural drawings (Lagepläne, Grundrisse, Ansichten, Schnitte) of the
reconstruction hypothesis. Every sheet is computed from **catalogue v2** (`model/catalogue.json`)
through the **same pure layout functions as the 3D model** (`model/src/layout`, the interiors'
stair planner `model/src/interior/stairPlan.ts`, the 3D avenue-tree rule), so plans and model
cannot disagree. Nothing is drawn by hand.

## Regenerate

```bash
# 1. terrain products (contours, hillshade/SLRM underlays, DTM crop) -> plans/data/ (git-ignored)
#    reads ../data/work/karlsberg/{dtm,hillshade,slrm}.tif read-only; extents in plans/terrain-extents.json
cd ../pipeline && uv run python -I ../schloss-karlsberg/plans/scripts/terrain.py

# 2. sheets -> plans/out/*.svg + *.pdf, previews -> docs/plans-preview/*.png (1600 px)
cd ../schloss-karlsberg && pnpm run plans                 # all 30 sheets, ~15 s
pnpm run plans --only GR-01 --no-pdf                      # selected sheets, SVG + PNG only
pnpm run test                                             # includes plans/tests (geometry + smoke)
```

PDF and PNG export use headless Chrome/Chromium (`CHROME_BIN` or the usual install paths);
without Chrome only the SVGs are written. Without `plans/data/` the sheets render without
terrain (a warning is printed). `plans/out/` holds generated files only.

API (docs/architecture.md §5): `generatePlans(spec, outDir)` in `plans/src/index.ts` writes the
SVGs and returns their paths; `sheetList(spec)` lists the sheets with lazy builders.

## Sheet list

| Blatt | Inhalt | Maßstab | Format |
|---|---|---|---|
| LP-00 | Übersichtsplan der Residenz (Schloss, Hofbezirk, Gärten, Karlslust) – Konfidenzfarben, Schummerung, Höhenlinien 2 m | 1:5000 | A2 hoch |
| LP-01 | Lageplan Schlossbezirk – Konfidenzfarben, Höfe/Terrassen, Alleen mit Baumstellung, Höhenlinien 2 m | 1:2000 | A2 hoch |
| LP-02 | Lageplan Schlosskern – Dachaufsicht, Funktionsfarben, Höhenlinien 1 m, Schnittlinien A–A / B–B | 1:500 | A2 hoch |
| LP-03 | Befund und Rekonstruktion – SLRM des DGM1 unter den Grundrissen, LiDAR-Kennungen (research/03) | 1:1000 | A2 hoch |
| GR-01…03 | Corps de logis (KB-B01): Erdgeschoss, Beletage, Mansardgeschoss | 1:200 | A3 |
| GR-04…07 | Südflügel (KB-B02): Kellergeschoss (Sohle 342,40 D LiDAR), EG, OG, DG | 1:200 | A2 |
| GR-08…10 | Nordflügel (KB-B03): EG, OG, DG | 1:200 | A2 |
| GR-11…13 | Westflügel / Sammlungsflügel (KB-B04): EG, OG, DG | 1:200 | A3 |
| GR-14…16 | Ostflügel / Küchenbau (KB-B05): EG, OG, DG | 1:200 | A3 |
| GR-17 | Galerieflügel (KB-B06): Galeriegeschoss | 1:200 | A2 |
| GR-18…20 | Orangerie-Hauptflügel (KB-B10): hohes Kellergeschoss, Saalgeschoss, Obergeschoss | 1:200 | A2 |
| AN-01 | Ansicht Hofseite (Ehrenhof, von Westen): KB-B01 mit Kopfbauten B02/B03 | 1:200 | A2 |
| AN-02 | Ansicht Gartenseite (von Osten) | 1:200 | A2 |
| AN-03 | Ansicht Südfront (Südflügel, dahinter Corps de logis) | 1:200 | A2 |
| AN-04 | Ansicht Orangerie (Talseite, von Westen): B10–B14 | 1:200 | A2 |
| SC-01 | Längsschnitt A–A in der Hauptachse (Ehrenhof – Vestibül – Festsaal – Garten) + Geländeschnitt 1:1000 bis zur Ostallee | 1:200 / 1:1000 | A2 |
| SC-02 | Querschnitt B–B durch Vestibül und Prunktreppe (Kaiserstiege) | 1:200 | A3 |

**Deviation from the brief:** the whole residence (≈ 1.9 × 2.4 km incl. Karlslust) does not fit
on A2 at 1:2000, so it is LP-00 at 1:5000; LP-01 is the 1:2000 Lageplan of the Schlossbezirk.
The DGM crop of the explorer ends at N 5 465 000: Karlslust (south of it) is drawn from the
catalogue only, on a dotted "ohne DGM-Unterlage" ground.

## Conventions

- **Orientation:** Lagepläne north up (grid north); north arrow shows grid north (GN) and true
  north with the meridian convergence γ ≈ −1,23°. Grundrisse are drawn square to the building
  (palace buildings: Gartenseite oben / Ehrenhof unten for the Corps de logis); every plan
  carries its own north arrow. Transforms are rotations only, never mirrored (tested).
- **Heights:** m ü. NHN (DHHN2016) and relative to **±0,00 = 346,20 m ü. NHN** (EG floor of the
  Corps de logis) for the palace group; the Orangerie uses its Saalgeschoss floor (340,80).
- **Coordinates:** ETRS89 / UTM 32N (EPSG:25832), grid ticks on the Lagepläne.
- **Pens (mm):** 0,13 / 0,18 / 0,25 / 0,35 / 0,50 / 0,70; line types: solid = visible/cut,
  dashed = above the cut plane or hidden, dotted = hypothetical, dash-dot = axis / section line.
- **Grundrisse:** cut at +1,20 m. Walls are the remainder of outline minus rooms (`planCells`):
  outer walls solid black (position documented), inner walls hatched (inferred), areas without
  catalogue rooms dotted ("ohne Raumbefund", U). Windows and doors from the layout / catalogue
  with swings; stairs from the stair planner with walk line, step count and riser/tread;
  dimension chains (axes + overall), axis numbering per side, section markers A–A / B–B.
- **Mansardgeschoss:** level set of the roof solid at +1,20 m over the attic floor, mansard
  break, dormers from the layout; no attic rooms are catalogued (U).
- **Ansichten / Schnitte:** painter's algorithm on the layout roof solids and facade openings;
  1789 ground = catalogue levels of courts/terraces/parterres (else today's DTM), today's DGM1 as
  red dashed line. Structure (vaults, roof trusses, slab build-up) is schematic (N/U).
- **Roofs:** a raised centre pavilion (`model/src/layout/raised.ts`, shared with the exterior)
  sits on the full-length main roof; the combined surface is the maximum of both.

## Evidence legend

Tags as in the catalogue: **D** documented (period source) · **D→** derived from documented ·
**I** inferred · **N** period norm (comparable buildings, research/02) · **U** unknown ·
**HMS** secondary source (HMS/Matzerath 2022 reconstruction; numbers only, interpretation).
Building fills on LP-00/01: confidence high / medium / low; outlines solid = placed after LiDAR,
dashed = only after Lageplan 2006, dotted = relative / hypothetical. Each title block states
"HYPOTHESE – kein Aufmaß".

## Licences and attribution

- DGM1: © GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet (hillshade, SLRM, contours, profiles).
- Footprints partly after "Karlsberg_Lageplan.gif" (Lageplan 2006, "Mannlich", schloss-carlsberg.de),
  CC BY-SA 2.0 DE → the derived plans are shared under CC BY-SA 2.0 DE.
- Period views (Le Clerc 1790, von Lüder 1791, porcelain plate, 1805 ruin map): public domain.
- HMS (Historisches Museum Saar / Matzerath 2022): only numbers derived and tagged HMS; no frames,
  images or textures are used.
- Heritage: the residence is a protected archaeological site (SDschG Saarland) – the plans are
  for looking, not digging ("Schauen, nicht graben").

## Layout of the code

| File | Role |
|---|---|
| `src/main.ts` | CLI (`pnpm run plans`), parallel export |
| `src/index.ts` | `sheetList`, `generatePlans` |
| `src/sheet.ts` | sheet sizes, pens/patterns, frame, bottom band, title block, legend, scale bar, north arrow |
| `src/geom/transform.ts` | plan/elevation views (pure, tested) |
| `src/geom/plan.ts` | wall poché from room rectangles, wall depth, cut-line coverage (pure, tested) |
| `src/geom/dims.ts` | dimension chains (pure, tested) |
| `src/geom/roof3d.ts` | roof solids, height field, level sets |
| `src/geom/stairs.ts` | adapter to the interiors' stair planner |
| `src/geom/trees.ts` | avenue trees with the 3D blocking rule |
| `src/sections.ts` | section definitions shared by plan markers and section sheets |
| `src/sheets/*.ts` | Lageplan, Grundriss, Ansicht, Schnitt, shared elevation renderer |
| `src/terrain.ts` | loaders for `plans/data` (DTM sampler, contours, underlays) |
| `scripts/terrain.py` | terrain products from the explorer's DGM (run with `uv run python -I`) |
| `tests/` | vitest: geometry helpers, model consistency, sheet smoke test |
