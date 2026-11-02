# 03 — LiDAR Archaeology: Visualization, Detection & Known Sites (Kirrberg / Homburg / Karlsberg)

> Research date: 2026-11-01. Scope: relief-visualization techniques for spotting anthropogenic micro-topography under forest, hobby-grade detection ideas, DTM/DSM display strategy, and a seed list of points of interest (POIs) for the Kirrberg / Homburg / Schloss Karlsberg study area. Includes legal notes.
>
> Confidence markers: **High** = two or more independent sources agree, or an authoritative source. **Med** = one decent source, or OSM only. **Low** = inferred, or memory not re-verified. Anything marked "verify" was not confirmed in this session.

---

## TL;DR for the PRD

- **Default "discovery" layer:** compute **SLRM/LRM + SVF + positive/negative openness + slope** and blend them into a **VAT-style composite**. All of these can run on the **GPU in three.js as render-to-texture passes** from a 1 m DTM heightmap. They need not run every frame: recompute only when parameters change. **MSTP / e²–e⁴MSTP, sky illumination and Hesse's "true" LRM are best precomputed offline** with `rvt-py` or WhiteboxTools and shipped as tiles.
- **Detection MVP:** threshold the local relief model (for example LRM < −0.3 m for pits/craters, > +0.3 m for mounds). Then filter the resulting shapes by size, circularity and rectangularity. That is easy to build and works well. ML (YOLOv8 on VAT tiles) is an optional phase 2. Some public models and datasets exist, but most carry a **non-commercial** licence.
- **Canopy:** keep the DTM as the "truth" surface. Show vegetation as a classified point cloud (LAS classes 3–5) or as an nDSM mesh, with an opacity slider, a height-above-ground clip and a "lens" mode. Also show ground-point density as a confidence layer.
- **Study area has rich, verifiable targets:**
  - Schloss Karlsberg / Karlslust: foundations, ponds, the Tosbecken cascade basin, Bärenzwinger, Tschifflik, Orangerie, Eiskeller.
  - Merburg castle ruin (Kirrberg) and the Hohenburg / Vauban fortress (Homburg).
  - A Hallstatt/La Tène barrow group at the Rabenhorst (9 mounds, one excavated in 2002).
  - Several (mostly blown-up) bunkers, Saargebiet border stones, an old adit, and WWII bombing targets.
- **Legal:** under the Saarland SDschG 2018, a targeted search with technical aids needs a permit (§ 8). Finds must be reported to the Landesdenkmalamt "unverzüglich" (without delay, § 16). The Schatzregal (state ownership of finds, § 18) applies. Fines go up to €250k, or €500k for destroying a monument (§ 28). **The app must ship a "look, don't dig" disclaimer.**

---

# Part A — Techniques

## A1. Relief visualizations compared

Pixel = 1 m (Saarland DGM1). Unless noted, the default values come from the `rvt-py` defaults module ([rvt default.py source](https://rvt-py.readthedocs.io/en/latest/_modules/rvt/default.html), [rvt.default docs](https://rvt-py.readthedocs.io/en/latest/rvt.default.html)). Those defaults "assume … high resolution DEMs derived from airborne laser scanning" ([RVT_py GitHub](https://github.com/EarthObservation/RVT_py/)). The standard reference is Kokalj & Hesse 2017, *Airborne laser scanning raster data visualization: A Guide to Good Practice* (ZRC SAZU) ([PDF](https://omp.zrc-sazu.si/zalozba/catalog/download/824/3485/287?inline=1), [record](https://oeaw.ac.at/resources/Record/993546357304498/Details)).

"Shader?" legend:
- ✅ **live**: cheap enough to run every frame in the fragment shader.
- 🟡 **GPU-once**: run as a render-to-texture or compute pass when tiles load or parameters change. It takes milliseconds on the GPU, so it still feels interactive.
- ❌ **precompute**: run offline in Python/WASM and ship as tiles.

| Technique | What it reveals / weaknesses | Params for 1 m DTM (default → suggested) | Cost | Shader? |
|---|---|---|---|---|
| **Hillshade (single)** | Intuitive 3D look. Linear features **parallel to the light direction disappear**. Dark shadows hide detail. | az 315°, elev 35° (RVT default). Use a low elevation (10–25°) for subtle features. | 3×3 normal | ✅ live (move the sun interactively; this is the main advantage of a live 3D app) |
| **Multi-directional hillshade** | Reduces directional bias; good general overview. Can look "muddy". | 16 directions, elev 35° (RVT default) | 16× hillshade, trivial | ✅ live |
| **Slope** | Edges of terraces, walls, ditch banks, crater rims. Direction-independent. Weak on flat features. | Degrees, stretch 0–51° (RVT default). Use 0–15° for flat areas. | 3×3 | ✅ live |
| **Curvature / Laplacian (LoG, DoG)** | Breaks of slope, rims, mound edges, small pits. Noisy, so smooth first. | Gaussian σ 1–3 m (pits, walls) and 5–10 m (mounds) | 3×3 on a blurred texture | ✅ live (blur in 🟡) |
| **Simple Local Relief Model (SLRM)** = DTM − mean-filtered DTM | Isolates small positive/negative features (mounds, pits, craters, ditches, hollow ways, field boundaries) from the large-scale terrain. Values are **in metres, so you can threshold them**. Edge "halo" artefacts appear on steep slopes. | Radius 20 px (RVT default) = 20 m. 10–15 m for pits and walls, 25–30 m for barrows. Stretch −2…+2 m (default); −0.5…+0.5 m for subtle features. | Separable box/Gaussian blur | 🟡 (2-pass separable blur) → ✅ to display |
| **Local Relief Model (LRM, Hesse 2010)** | Same purpose as SLRM but cleaner. A low-pass filter is applied, the zero-contours of the difference are "purged", and a base surface is reinterpolated from them. Lets you measure relative heights and volumes of features ([Hesse 2010, Archaeol. Prospection 17(2)](https://zendy.io/title/10.1002/arp.374), [AARG 2010 slides](https://aarg2010.cimec.ro/pdf/Hesse-LIDAR-based-archaeological-prospection-Baden-Wurttemberg.pdf)). Targets: burial mounds, earthworks, sunken roads, terraces, ridge and furrow. | Low-pass kernel about 20–30 m (verify in Hesse 2010). | Contour extraction plus interpolation | ❌ precompute (or approximate with SLRM / multi-scale DoG in a shader) |
| **Multi-Scale Relief Model (MSRM)** | Local relief across a range of feature sizes, from a pyramid of filtered DTMs. | Feature size min 0 – max 20 m, scaling factor 2 (RVT default) | Several blurs; can use mipmaps | 🟡 (mip-pyramid difference) |
| **Sky-View Factor (SVF)** | Share of visible sky, like diffuse light. **Direction-independent.** Very good for ditches, pits, hollow ways, wall foundations and small depressions (dark), and ridges (bright). Introduced for historic landscape features in *Antiquity* 85 (2011) (cited in [RVT_py](https://github.com/EarthObservation/RVT_py/)). | 16 directions, max radius 10 px = 10 m, noise removal 0 (RVT default). Stretch 0.64–1.0. Use 5 m for very fine features and 20–30 m for large ditches. | N directions × R steps of horizon search per pixel (16×10 = 160 fetches) | 🟡 GPU-once (ray-march the horizon). Easily interactive for 2k² tiles. |
| **Anisotropic SVF** | SVF with directional weighting, so it looks more like a hillshade. | asvf level 1, direction 315° | as SVF | 🟡 |
| **Openness (+/−)** (Yokoyama 2002) | **Positive openness** (looking upward) brightens convex forms: walls, ramparts, mound edges, crater rims. **Negative openness** (looking downward), inverted, highlights concave forms: ditches, moats (Burggräben), hollow ways, pits, cellar holes. It ignores the horizon above the local area, so it does not darken valleys the way SVF does. | Same search settings as SVF: 16 directions, 10 m. Stretch 60–95° (RVT default). | as SVF (same pass, extra outputs) | 🟡 (compute SVF and ±openness in one shader pass) |
| **Local dominance (LD)** | How strongly a point dominates its surroundings. Excellent for **very subtle mounds and hollows on flat ground**. | min radius 10, max 20 px, observer height 1.7 m, angular step 15° (RVT default) | Moderate | 🟡 |
| **Sky illumination (SIM)** | Soft, natural "overcast" render with cast shadows. Good for presentation. | Overcast model, 32 directions, shadow distance 100 px | Expensive | ❌ precompute (or use SSAO / ambient occlusion in three.js as a look-alike) |
| **Multi-Scale Topographic Position (MSTP)** (Lindsay et al. 2015) | RGB composite of deviation from mean elevation at local, meso and broad scales. Shows landforms and features at their own scale with colour coding. | local (1–5, step 1), meso (5–50, step 5), broad (50–500, step 50) px; lightness 0.9 (RVT default) ([RVT MSTP](https://rvt-py.readthedocs.io/en/latest/listofvis_mstp.html)) | Many window statistics. Summed-area tables help. | ❌ precompute (GPU is possible with summed-area tables, but not worth it at first) |
| **e²MSTP / e³MSTP / e⁴MSTP** (Guyot et al. 2021; Kokalj 2025) | e²MSTP = MSTP + SLRM + RRIM. It was the **top-ranked visualization in Guyot's CNN segmentation tests**. e³ swaps RRIM for CRIM (RRIM is patented in some countries). e⁴ blends red slope, ±openness, LD, two-radius SVF and MSTP, and is "exceptional" for small structures on flat terrain ([RVT eMSTP](https://rvt-py.readthedocs.io/en/latest/listofvis_emstp.html), [Guyot et al. 2018, Remote Sensing 10(2):225](https://www.mdpi.com/2072-4292/10/2/225/html)). | Inherits the MSTP, SLRM and SVF settings | High | ❌ precompute |
| **Red Relief Image Map (RRIM)** (Chiba, Kaneta & Suzuki 2008) | Slope is mapped to red saturation and (positive − negative openness)/2 to brightness. Concave forms look dark, convex forms light, steep slopes red. Very readable, with no light-direction bias ([ISPRS 2008 paper](https://WWW.ISPRS.org/proceedings/XXXVII/congress/2_pdf/11_ThS-6/08.pdf), [openrelief impl.](https://pypi.org/project/openrelief/)). | Openness radius about 10–30 m | Openness + slope | 🟡 (cheap once openness exists). ⚠ Patent status in some countries; use CRIM / e³MSTP if publishing widely. |
| **VAT – Visualization for Archaeological Topography** (Kokalj & Somrak 2019 blending; VAT named in Verbovšek, Popit & Kokalj 2019) | Blends **hillshade + slope + positive openness + SVF**. "VAT general" is for mixed relief. "VAT flat" makes subtle features on plains very distinct but oversaturates on steep slopes. **Combined VAT** (blending the two) is recommended as a hillshade replacement and base map ([RVT VAT](https://rvt-py.readthedocs.io/en/latest/listofvis_VAT.html), [Remote Sens. 11(24):2946](https://api.crossref.org/works/10.3390%2FRS11242946)). | Layers use the settings above. The "flat" variant uses larger radii and tighter stretches (exact values: see RVT blender presets in the repo; verify). Blend modes: normal, screen, multiply, overlay, luminosity. | Sum of its parts | 🟡 for the components, ✅ for the blend (it is just blend-mode math in the fragment shader) |

**Practical take-aways**

1. Kirrberg and Karlsberg are hilly Buntsandstein forest with steep valley sides and flat plateaus, such as the Karlsberg plateau at about 383 m and the castle terraces. So use **Combined VAT** as the base and offer **SLRM (−0.5…+0.5 m)** and **negative openness** as "hunting" layers.
2. Run the horizon-search shader once per tile into a float render target (SVF, openness+, openness− in RGB) and cache it. Re-run it when the user changes the radius slider. Tile borders need an overlap ("apron") of at least the radius, e.g. 32 px.
3. Note that different visualizations matter less than you might think for ML. In a 2024 study, seven DEM visualizations and eight segmentation models showed **up to 8 % difference by visualization, but up to 25 % by model configuration**, and no single visualization won for all classes ([Jaturapitpornchai, … Kokalj, Traviglia 2024, arXiv 2404.05512](https://arxiv.org/abs/2404.05512)).
4. A Rhineland study confirms that archaeology-oriented visualizations beat standard hillshade for detecting and delineating monuments ([AIR article](https://journals.ub.uni-heidelberg.de/index.php/air/article/view/66777/60067)).

### Minimal GPU recipe (three.js)

```
Pass 0  heightTex (R32F, 1 m, tile + apron)
Pass 1  blurH → blurV (σ or box radius r)       → lowpassTex
Pass 2  slrm = h - lowpass                       → slrmTex (metres)
Pass 3  horizon search: for d in 0..15 dirs, for s in 1..R: track max/min elevation angle
        → SVF, openness+, openness− in RGBA     → horizonTex
Pass 4  display: hillshade(sunDir) | slope | slrm colormap | VAT blend(hs, slope, open+, svf)
```

All passes are plain `WebGLRenderTarget` + `ShaderMaterial` work, or WebGPU compute shaders. Expensive passes run only when parameters change.

## A2. Simple (semi-)automated detection

The pipeline below uses the 1 m DTM plus SLRM/LRM. It can run in a Web Worker (JS/WASM, OpenCV.js) or offline in Python (numpy, scipy, scikit-image, rasterio).

| Target | Signature in LiDAR | Simple rule / algorithm | Typical size (from literature / known local example) |
|---|---|---|---|
| **Bomb craters** | Circular depression, often with a raised rim. Frequently in **lines or clusters** (bomb strings). | LRM < −0.3 m blobs, area 10–300 m², circularity 4πA/P² > 0.7, optional positive ring. Or a **fill-depth** map (priority-flood fill minus DTM > 0.3 m). Then run DBSCAN to find clusters and linear strings. | About 5–15 m across, 1–3 m deep. The NRW crater work targets "approximately 10 m wide" craters ([Dolejš et al. 2020, ISPRS IJGI 9(12):713](https://doaj.org/article/02750f02ddf94244b549b3483bfab764)). |
| **Blown-up bunkers** (most Westwall bunkers were demolished after 1945) | Hummocky, irregular mound and pit complex with rubble, often 10–25 m. Sometimes a rectangular pit. | Mixed ±LRM in a small area plus high roughness (std-dev of SLRM). Use the OSM bunker points (below) as **training and validation examples**. | about 10–25 m |
| **Pits / cellar holes / Kalkgruben / Meilerplätze** | Round or rectangular depression (pit); flat circular platform on a slope (charcoal kiln, *Meilerplatz*). | Depression: as for craters. Charcoal platform: low slope disc with a steep downhill edge; LoG blob plus slope test. | Kiln platforms about 8–15 m |
| **Burial mounds (Hügelgräber)** | Low circular dome, sometimes with a surrounding ditch. | LRM > +0.2 m blobs, circularity > 0.8, diameter 8–30 m. Check for a ring ditch (negative ring). | **Rabenhorst mound 1: about 18.5 m diameter, 2 m high, ditch about 1.2 m wide** ([KuLaDig](https://www.kuladig.de/Objektansicht/KLD-354061)) |
| **Walls / foundations / terraces** | Narrow linear ridges (walls) or steps (terraces). **Straight segments and right angles.** | Ridge/valley filter on SLRM (Hessian eigenvalues, Frangi "vesselness"). Then a Hough transform or probabilistic line segment detector. Score parallel and orthogonal segments. | Wall ridges 0.5–2 m wide, 0.1–1 m high |
| **Rectangular structures** (house platforms, bunker pits, building foundations at Karlsberg) | Rectangular ±LRM patches | Threshold SLRM, find contours, simplify with Douglas–Peucker, then minAreaRect. **Rectangularity = A / A_rect > 0.85**; prefer 4-vertex polygons. | 5–50 m |
| **Ditches / moats (Burggräben) / hollow ways (Hohlwege)** | Concave linear channels. Hollow ways form **bundles of parallel channels running up and down slopes** and do not follow the stream network. | Negative openness or negative SLRM, then skeletonize, then filter on length > 30 m. Compare with a flow-accumulation map so that natural gullies can be rejected. | Moat around Merburg / Hohenburg (verify); hollow ways 2–10 m wide |
| **Old roads / Alleen** | Straight or gently curved embankments or cuts; avenues lined with planted trees (visible in the DSM). | Long straight segments in the line detection; alignment with historic maps. | Karlsberg had an avenue to Homburg, the "Apfelallee" and the "Paradestraße" ([de.wikipedia Schloss Karlsberg](https://de.wikipedia.org/wiki/Schloss_Karlsberg)) |

**False positives to warn about in this area:**
- Root plates of fallen trees (Wurfteller): pit plus mound pairs, very common after storms (the 1990 storm "Wiebke" is mentioned in the Karlsberg history).
- Forestry skid trails (Rückegassen).
- **Inland dunes (Binnendünen) near the Karlsbergweiher** ([ich-geh-wandern](https://www.ich-geh-wandern.de/karlsbergweiher-binnenduenen-und-closenbruch)).
- Sandstone outcrops and boulders.
- Modern sand pits.
- DTM interpolation facets where few ground points exist (see A3).

**ML options (phase 2, keep it small):**

- **Burial mounds:** YOLOv8m checkpoints (plain, xView-pretrained and oriented bounding boxes) on Hugging Face ([kardosdrur/burial-mounds-yolov8m-obb](https://huggingface.co/kardosdrur/burial-mounds-yolov8m-obb/blob/main/README.md)). Code: [x-tabdeveloping/burial-mounds-object-recognition](https://awesome.ecosyste.ms/projects/github.com%2Fx-tabdeveloping%2Fburial-mounds-object-recognition). Weights are **CC-BY-NC-4.0**. They were aimed at satellite imagery, so fine-tune them on VAT/SLRM tiles.
- **Charcoal kiln sites:** an annotated LiDAR dataset (hillshade, slope and SVF inputs) **plus trained weights**, from the Erzgebirge in Saxony, on TU Dresden OPARA ([dataset](https://opara.zih.tu-dresden.de/handle/123456789/1914)). Licence **CC BY-NC-SA 4.0**. Related work: Bonhage et al. 2021 (Mask R-CNN, Archaeol. Prospection, doi 10.1002/arp.1806).
- **Bomb craters:** a CNN on 0.5 m DTMs worked best compared with crater-detection and edge-based methods ([Dolejš et al. 2020](https://doaj.org/article/02750f02ddf94244b549b3483bfab764)). No public German crater dataset was found.
- **Maya challenge (ECML PKDD 2021):** ALS-based segmentation of buildings, platforms and aguadas, organized by ZRC SAZU (the RVT authors) ([arXiv 2208.03163](https://export.arxiv.org/abs/2208.03163?context=cs)). Useful as a pretraining/benchmark dataset; features differ from Central Europe.
- **YOLO + QGIS workflow for mounds on LiDAR derivatives:** Slovak University of Technology, 2026, mAP50 about 0.79; scripts "to be published" ([ICA abstract](https://ica-abs.copernicus.org/articles/12/134/2026/ica-abs-12-134-2026.pdf)).
- **Recommended hobby path:** label 30–100 local examples yourself with an in-app "mark candidate" tool, for example the OSM bunkers, Rabenhorst mounds and craters found by the LRM rule. Fine-tune YOLOv8n/s on 256×256 tiles (3 channels: SLRM, SVF, negative openness). Export to ONNX and run it in the browser with `onnxruntime-web`. The rule-based detector provides the candidates; the human (or ML) verifies them.

## A3. DTM vs DSM vs nDSM — showing the canopy while revealing the ground

- **DTM** (bare earth): interpolated from **LAS class 2 (ground)** points. This is where the archaeology is.
- **DSM**: the first or highest return, i.e. the top of canopy and roofs.
- **nDSM = DSM − DTM**: canopy and building height. Useful for:
  - "fly above the forest" realism;
  - finding **avenues and plantations**, such as planted rows at Karlsberg;
  - masking forest versus open land.
- **Data quality caveat:** the Saarland-wide DGM1 comes from an **ALS flight in spring 2016** ([INSPIRE metadata via GDI-DE](https://gdk.gdi-de.org/geonetwork/srv/api/records/79c77a2e-111f-4c44-9ef7-b4d57d2d6fe0); licence dl-de/by-2-0 per [GDI-DE record](https://gdk.gdi-de.org/geonetwork/srv/api/records/96b3a5b3-b73b-0002-a9a3-417cb1736fe4)). Leaf-off conditions are good, but under dense conifers ground points are sparse and the DTM shows TIN facets, which can **fake** linear features. Show a **ground-point density** raster (points/m² of class 2) as a confidence overlay when a point cloud is available. (Data sourcing details are in `01-data-sources.md`.)

**UI patterns for three.js:**
1. **Layer stack:** the DTM mesh (with a relief shader) is always rendered. On top is the **vegetation point cloud** (classes 3/4/5, coloured by height above ground) or an nDSM mesh, with an **opacity slider** and a **height-above-ground clip**. The fragment shader discards points with HAG > *h* or < *h*. This lets you "peel" the canopy from the top down to the understory.
2. **X-ray lens:** inside a circle around the cursor or camera target, discard canopy fragments (a world-space distance test in the shader). Outside it, show the canopy normally. This is the most "magical" way to reveal ground features while flying.
3. **Swipe / split view** between the DSM (realistic) and the DTM+VAT (analysis), synced with the Leaflet 2D map.
4. **Point cloud rendering:** load COPC/LAZ with `copc.js` or `loaders.gl` (LAS loader), or use `potree-core`. Filter by classification as a uniform (2 = ground, 3–5 = vegetation, 6 = building).
5. **Buildings (class 6):** extrude, or show as points. Streets and houses also come from the OSM overlay.

---

# Part B — Known sites & features (POI seed list)

**Coordinates.** Coordinates are WGS84 decimal degrees. Many come from an **OpenStreetMap Overpass query** run for this research on 2026-11-01 (bbox 49.26–49.36 N, 7.28–7.45 E; data © OpenStreetMap contributors, ODbL). "OSM" in the source column refers to that query. Positions are approximate (±10–50 m) unless stated otherwise.

**Coordinate warning.** The English Wikipedia "Karlsberg Castle" infobox gives 49.32028, 7.34389. That point is actually **the Hohenburg on the Schlossberg in Homburg town**, not Karlsberg. Use the German Wikipedia / OSM value (about 49.335, 7.379).

## B1. Schloss Karlsberg (Homburg-Sanddorf / Karlsberg forest)

**History**
- Built **1778–1788** for **Duke Karl II. August of Pfalz-Zweibrücken** on the Buchenberg (later "Karlsberg"), on the site of the 1760 Louisenhof. Architect: J. C. von Mannlich.
- The duke resided there from 1779 and fled French troops on 9 Feb 1793.
- **French revolutionary troops burned the palace on 28 July 1793.** Napoleon later returned the ruins to the duke's widow on condition that she clear them.
- Sources: [de.wikipedia Schloss Karlsberg](https://de.wikipedia.org/wiki/Schloss_Karlsberg), [en.wikipedia](https://en.wikipedia.org/wiki/Karlsberg_Castle).

**Remains**
- Foundations, the cellar of the Kavaliersbau (the "Räuberhöhle"), terraces, ruins of the Orangerie and the Tschifflik pavilion, the three Schwanenweiher, the Karlsbergweiher, the basins of the Große Kaskade, the Bärenzwinger, several wells, and old avenues.
- The Karlsberger Hof is the only intact building (now owned by the brewery foundation). The de.wikipedia article also names the "Baumagazin", now a villa, as the only surviving palace building.
- 1950s excavations are mentioned.
- The garden had three parts: the palace park, **Karlslust** and **Hirschwürzloch**.
- Managed as **"WaldPark Schloss Karlsberg"**, a cooperation founded in 2008 of the Saarpfalz-Kreis, the City of Homburg, Zweibrücken-Land, the forestry authorities of the Pfalz and Saarland, the Landesdenkmalamt and others ([Saarpfalz-Kreis 2025](https://www.saarpfalz-kreis.de/:translation/en/saarpfalz-kreis/de/aktuelles/pressemitteilungen/2025/juni/kurzfilm-zu-schloss-karlsberg-begeistert)).
- The site lies right on the **Saarland / Rheinland-Pfalz border**. The remains are "in the forest between Sanddorf and Bechhofen" ([Rheinpfalz 2019](https://www.rheinpfalz.de/startseite_artikel,-eulengezwitscher-verr%C3%A4t-geheimnisse-von-schloss-karlsberg-_arid,1382324.html)).

**Why it is a good LiDAR target:** a large terraced palace footprint, an axial road network, and pond dams and basins, all under forest. Foundations should show in SLRM as rectilinear ±0.2–1 m patterns.

## B2–B3. POI table

| # | Name | Type | Lat | Lon | Conf. | Source / note |
|---|---|---|---|---|---|---|
| 1 | Schloss Karlsberg – main palace site / ruins | Palace ruin, foundations | 49.3362 | 7.3784 | High | OSM node + ruins way; de.wikipedia gives 49.3347, 7.3789 |
| 2 | Orangerie (ruin) | Ruin | 49.3352 | 7.3789 | High | OSM way "Orangerie"; de.wikipedia confirms ruins |
| 3 | Unnamed ruin W of palace (near Karlsbergweiher) | Ruin | 49.3344 | 7.3732 | Med | OSM `historic=ruins` |
| 4 | Karlsbergweiher (incl. island) | Baroque park pond | 49.3341 | 7.3741 | High | OSM; de/en.wikipedia (park basin remnant) |
| 5 | Eiskeller | Ice cellar (archaeological site) | 49.3384 | 7.3828 | Med | OSM `historic=archaeological_site` |
| 6 | Brunnen am alten Forsthaus | Historic well | 49.3397 | 7.3806 | Med | OSM; de.wikipedia mentions a well at the former Forsthaus |
| 7 | Karlsberg summit plateau | Topographic high, 383 m | 49.3321 | 7.3835 | High | OSM peak |
| 8 | Bärenzwinger (Karlslust) | Ring of 19 enclosures around a moated island, from 1778 | 49.3257 | 7.3889 | High | OSM way; [urlaub.saarland](https://www.urlaub.saarland/attraktion/baerenzwinger-1986e52928); de.wikipedia |
| 9 | Herzogsterrassen (bear cages, 1786) | Terraces | ~49.326 | ~7.389 | Low | "Near the Bärenzwinger, above the Schwanenweiher" ([urlaub.saarland](https://www.urlaub.saarland/attraktion/baerenzwinger-1986e52928)); exact spot unverified |
| 10 | Schwanenweiher (3 ponds) | Baroque ponds | 49.3242 | 7.3881 | High | OSM; de.wikipedia |
| 11 | Tosbecken / Kaskade (Karlslust) | Cascade basin | 49.3248 | 7.3873 | Med | OSM "Tosbecken"; komoot "Kaskade mit Tosbecken" |
| 12 | Tschifflik Pavillon (ruin) | Pavilion ruin | 49.3243 | 7.3846 | Med | OSM way; de.wikipedia (attribution of the ruin debated) |
| 13 | Eremitage (Karlslust) | Garden building site | 49.3234 | 7.3920 | Med | OSM `tourism=attraction`; komoot |
| 14 | "Räuberhöhle" (cellar of the Kavaliersbau) | Cellar | ? | ? | Low | de.wikipedia; location not found. Look for it in LiDAR near the palace. |
| 15 | Karlsberger Hof | Only intact farm building of the complex | ~49.33 | ~7.37 | Low | en.wikipedia; coordinates not verified |
| 16 | "D/S" boundary stones (Karlsberg) | Border stones; probably the 1920–35 **Saargebiet** border (Kirrberg stayed with Bavaria/Pfalz in 1920) | 49.3331 / 49.3371 | 7.3699 / 7.3756 | Med (object) / Low (interpretation) | OSM `boundary_stone name=D/S`; many more unnamed stones in OSM along the line |
| 17 | **Burgruine Merburg** (Kirrberg) | Castle ruin (12th c., Count Dietrich v. Merburg 1179): octagonal keep, 75 m ring wall, on the Malafelsen above the Lambsbach | 49.3124 | 7.3760 | High | [de.wikipedia](https://de.wikipedia.org/wiki/Merburg) 49.3119, 7.3756; OSM 49.3124, 7.3760; [en.wikipedia](https://en.wikipedia.org/wiki/Merburg) |
| 18 | Fischweiher Kirrberg | Pond (near Merburg) | 49.3131 | 7.3746 | Med | OSM |
| 19 | Kirrberg village centre / Wallfahrtskirche Mariä Himmelfahrt (1290 "Capella in Kirchperch") | Village / church | 49.3003 | 7.3694 | High | [de.wikipedia Kirrberg](https://de.wikipedia.org/wiki/Kirrberg_(Homburg)) |
| 20 | "Early Celtic hilltop fortifications (1000–800 BC)" on the heights north of Kirrberg | Possible hillfort / ringwall | ? | ? | Low | de.wikipedia Kirrberg says they are "still visible". Location not given. **Prime LiDAR hunting target** (heights: Zimmermannsberg 49.3122/7.3859, Tobisberg 49.3080/7.3933, Kastenbühl 49.3127/7.3990, per OSM). |
| 21 | Lambsbach valley route ("Salzstraße", Stone Age passage) | Old road | along the Lambsbach | — | Low | de.wikipedia Kirrberg |
| 22 | **Keltischer Grabhügel "Rabenhorst"** (9 mounds; mound 1 excavated 2002: 12 graves, about 2.5 m stele, late Hallstatt / early La Tène) | Barrow cemetery | 49.3132 | 7.3590 | High | [KuLaDig KLD-354061](https://www.kuladig.de/Objektansicht/KLD-354061) = OSM node (identical). **LiDAR should show the other 8 mounds nearby.** |
| 23 | Keltischer Grabhügel (east, near Schwanenweiher) | Barrow | 49.3203 | 7.3811 | Med | OSM |
| 24 | "Pyramidenstein / Totenstein" | Menhir / megalith (per OSM) | 49.3202 | 7.3817 | Med | OSM `archaeological_site=megalith` |
| 25 | Hallstatt mounds "am Stumpfen Gipfel bei Homburg" | Barrows | ~49.325 | ~7.370 | Low–Med | Literature title (Reinhard) in a publication index; Stumpfer Gipfel peak (340 m) per OSM at 49.3251, 7.3697. Exact mounds not located; may overlap #23. |
| 26 | **Burgruine Hohenburg** (Schlossberg) + **Vauban fortress** (1679–1692, razed 1714; ruins restored from 1981) | Castle and fortress ruins | 49.3206 | 7.3443 | High | OSM; [en.wikipedia](https://en.wikipedia.org/wiki/Hohenburg_Castle_(Homburg)) 49.3210, 7.3448; [de.wikipedia Homburg](https://de.wikipedia.org/wiki/Homburg) |
| 27 | **Schlossberghöhlen** | Man-made red sandstone caves (15th–17th c.; rediscovered 1930s; WWII air-raid shelter) | 49.3205 | 7.3427 | High | OSM; [t-online](https://www.t-online.de/leben/reisen/deutschland/id_58983516/homburg-riesige-hoehle-von-menschenhand-in-deutschland.html); de.wikipedia. Underground, so **not visible in LiDAR**; only the entrances and surface are. |
| 28 | Unnamed ruin E of Schlossberg | Ruin | 49.3218 | 7.3544 | Med | OSM `historic=ruins` |
| 29 | **Römermuseum Schwarzenacker** (Gallo-Roman vicus, about 0–275 AD; junction of the Metz–Mainz and Trier–Straßburg roads) | Roman settlement / museum | 49.2828 | 7.3179 | High | OSM; [en.wikipedia](https://en.wikipedia.org/wiki/Schwarzenacker_Roman_Museum) 49.2828, 7.3167; de.wikipedia Homburg |
| 30 | Hügel "Gloria Romanorum" (Wörschweiler) | Tumulus | 49.2832 | 7.3052 | Med | OSM `archaeological_site=tumulus` |
| 31 | Klosterruine Wörschweiler | Abbey ruin | 49.2841 | 7.3074 | High | OSM; de.wikipedia Homburg |
| 32 | Turmruine Beeden | Tower ruin | 49.3081 | 7.3156 | Med | OSM |
| 33 | Bunker (ruin, "gesprengt" = blown up), S of Homburg / Webersberg area | WWII bunker | 49.2838 | 7.3351 | Med | OSM `military=bunker` |
| 34 | Bunker (ruin), S of Kirrberg | WWII bunker | 49.2949 | 7.3787 | Med | OSM |
| 35 | Bunker (pillbox), near Rothenbergerhof | WWII bunker | 49.2651 | 7.3634 | Med | OSM `bunker_type=pillbox` |
| 36 | 3 bunkers near Oberauerbach (Zweibrücken) | WWII bunkers | 49.2746–49.2751 | 7.4038–7.4083 | Med | OSM (3 ways) |
| 37 | Bunker (ruin) near Rosenkopf / Bechhofen | WWII bunker | 49.3563 | 7.4448 | Med | OSM |
| 38 | "Alter Stolleneingang" | Old adit (mining) | 49.3589 | 7.3861 | Med | OSM. Purpose (coal? sand? water?) unknown. |
| 39 | Felsenkeller / Schlangenhöhle (Schwarzenacker–Einöd) | Rock cellar / cave | 49.2836 / 49.2806 | 7.3211 / 7.3217 | Med | OSM |
| 40 | Sandgrube (W edge of area) | Sand pit / quarry | 49.2977 | 7.2871 | Med | OSM `landuse=quarry` |
| 41 | Homburg town (WWII air raids 1944–45; heaviest raid **14 March 1945** by RAF/USAAF, 220 killed; a synthetic fuel plant was still operating in March 1945; US troops entered 20 March 1945) | Bombing context → look for **crater fields** near the rail yards, industrial sites and the approach corridors | 49.3215 | 7.3409 | High (history) / Low (crater locations) | [de.wikipedia Homburg](https://de.wikipedia.org/wiki/Homburg) |
| 42 | Königsbrucherhof (1766) | Historic estate | 49.3519 | 7.3737 | Med | OSM `heritage=4` |
| 43 | Napoleon-Stein (Schelmenkopf) | Memorial stone | 49.3455 | 7.3612 | Med | OSM |
| 44 | Jägersburg "Kulturwald" Celtic burial mound(s) + Gustavsburg | Barrows / castle (NW of Homburg, outside bbox) | ~49.37 | ~7.33 | Low | [komoot](https://www.komoot.com/highlight/2593878); de.wikipedia Homburg. Coordinates not verified. |

**Westwall context.**
- Festungspionierstab 17 was set up in **Homburg on 1 Aug 1936** to survey bunker sites.
- About 4,500 of the Westwall's about 14,200 bunkers were in the Saarland ([memotransfront Uni Saarland PDF](https://www.memotransfront.uni-saarland.de/pdf/westwall.pdf), via search snippet).
- de.wikipedia Homburg mentions many German troops "an Westwall-Anlagen" (at Westwall installations) in 1945.
- No Kirrberg-specific bunker documentation was found. The OSM points above are the best seeds.

**Not found.** No Bexbach or Limbach barrow sources were found; those areas are mostly outside the bbox.

## B4. Existing LiDAR projects & citizen science (Saarland / Pfalz / similar)

- **No Saarland-specific public LiDAR-archaeology programme** or citizen-science project was found. The Landesdenkmalamt website (saarland.de/lda) blocks automated access, so check it manually.
- **Pfalz (GDKE Speyer):** LiDAR terrain data from the Landesvermessungsamt RLP led to a new **Bronze Age hilltop settlement on the Hohenberg**, confirmed by test excavations ([Bentz et al. 2018, MHVP 115](https://www.phil.uni-wuerzburg.de/fileadmin/04080200/user_upload/Mitarbeiter/Bentz_u.a.__Hohenberg__MHVP_115__2018_farbig.pdf)).
- **Hessen:** handbook "Bodendenkmäler unter Wald im LiDAR-Scan" for forestry staff, with a call to report observations ([PDF](https://denkmal.hessen.de/sites/denkmal.hessen.de/files/2022-08/bodendenkmaeler-unter-wald_0.pdf)). This is an excellent model for in-app "what is this?" help texts.
- **Baden-Württemberg:** Hesse's statewide LiDAR prospection with LRM, about 35,751 km² ([slides](https://aarg2010.cimec.ro/pdf/Hesse-LIDAR-based-archaeological-prospection-Baden-Wurttemberg.pdf)). Review: [Posluschny 2022](https://archiv.ub.uni-heidelberg.de/propylaeumdok/6379/1/Posluschny_Archaeologie_aus_der_Luft_2022.pdf).
- **Netherlands, "Heritage Quest" (Zooniverse):**
  - About 6,500 volunteers worked on about 600,000 LiDAR maps of the Veluwe and Utrechtse Heuvelrug, about 15 views per map.
  - They found more than 1,000 burial mounds, Celtic fields, charcoal kilns and cart tracks.
  - Volunteer results were validated against fieldwork at 380 locations (*Antiquity* 2024).
  - Sources: [artnet](https://news.artnet.com/art-world/citizen-scientists-netherlands-find-burial-mounds-lidar-2253367?amp=1), [EU citizen science](https://eu-citizen.science/project/135), [Leiden 2019](https://www.universiteitleiden.nl/en/news/2019/08/prehistoric-veluwe-more-densely-populated-than-was-thought).
  - **This is the template for the app's "candidate → multiple independent votes → report" workflow.**
- **Local research on Karlsberg:** Jutta Schwan wrote her doctoral thesis on the palace. Other references are W. Weber 1987, *Schloss Karlsberg: Legende und Wirklichkeit*, and a 2012 *Burgen und Schlösser* article on the "rediscovery" of Schloss Carlsberg (Heidelberg journals; access was blocked by bot protection). No LiDAR or laser-scan study of Karlsberg was found.

---

# Legal notes (Saarland) and a recommended in-app disclaimer

The source is the Saarländisches Denkmalschutzgesetz (SDschG) of 13 June 2018 ([lexaris full text](https://lexaris.de/book/version/documentflat/head/1368164); see also [umwelt-online](https://umwelt-online.de/recht/bau/laender/saarland/dschg18.htm)):

- **§ 3:** Bodendenkmäler (archaeological monuments) are **protected directly by law**. They do **not** have to be listed. "Unknown" sites found via LiDAR are protected as well.
- **§ 8:** anyone who wants to dig, salvage, or **"mit technischen Hilfsmitteln zielgerichtet nach Bodendenkmälern suchen"** (search purposefully for monuments with technical aids, which includes metal detectors) **needs a permit**. The Landesdenkmalamt also states that detector searching in the Saarland requires a permit (search snippet of [saarland.de/lda Bodendenkmalpflege](https://www.saarland.de/lda/DE/themen-aufgaben/Bodendenkmalpflege)).
- **§ 9:** *Grabungsschutzgebiete* (excavation protection zones) need permits for any potentially damaging work.
- **§ 16:** finds must be **reported to the Landesdenkmalamt "unverzüglich"** (without delay). The find and site must remain **unchanged for 6 working days**.
- **§ 18:** **Schatzregal**. Ownerless finds of scientific value become **property of the state**.
- **§ 28:** fines **up to €250,000**, or **€500,000** for intentionally destroying a monument without authorization.
- Next door in **Rheinland-Pfalz** (Karlslust, Bechhofen, Mörsbach, Oberauerbach are partly or fully in RLP), the **DSchG RLP and GDKE** apply, with similar permit and reporting duties (verify).
- Many forest areas are also **nature reserves / Natura 2000** (e.g. Closenbruch / Karlsberg area). Stay on paths.
- **WWII:** bunker ruins and crater fields may contain **unexploded ordnance (UXO)**. Never dig. Report suspected munitions to the police / Kampfmittelbeseitigungsdienst.

**Suggested disclaimer text (DE/EN):**

> **Schauen, nicht graben.** Alle markierten Strukturen sind *Hypothesen* aus Geländedaten und können natürlichen Ursprungs sein. Bodendenkmäler sind im Saarland gesetzlich geschützt (SDschG §§ 3, 8) – auch unbekannte. Gezielte Suche mit Sonden/Werkzeugen ist genehmigungspflichtig; Funde sind unverzüglich dem Landesdenkmalamt Saarland zu melden (§ 16). In Rheinland-Pfalz gilt das DSchG RLP (GDKE). Kampfmittelgefahr an Bunkern/Kratern – nichts berühren.
>
> *Look, don't dig. Everything highlighted is a hypothesis from terrain data. Archaeological sites are protected by law, even unknown ones. Report observations to the Landesdenkmalamt Saarland.*

**Product implication:**
- Consider **not publishing precise coordinates of newly detected candidates publicly** (anti-looting; Heritage Quest also restricted this). Keep "my candidates" private or blur them to about 100 m when shared.
- Provide a "Report to Landesdenkmalamt" export (screenshot + coordinates + description).

---

# Uncertain / unverified

1. **Karlsberg coordinates:** en.wikipedia's value (49.32028, 7.34389) is wrong; it points at the Hohenburg. The OSM and de.wikipedia values (about 49.335–49.336, 7.378–7.379) differ by about 150 m. The precise palace footprint should be determined from LiDAR itself.
2. **Locations not found:** the Räuberhöhle, the Herzogsterrassen, the Karlsberger Hof and the Große Kaskade (as distinct from the "Tosbecken") were not located precisely. The Tschifflik ruin's original function is debated (de.wikipedia).
3. **Kirrberg "early Celtic hilltop fortifications":** only mentioned in de.wikipedia; no location or primary source.
4. **"Stumpfer Gipfel" Hallstatt mounds:** only a literature title seen. May be the same group as the OSM barrow at 49.3203, 7.3811 or near the Rabenhorst; unconfirmed.
5. **Bunkers (OSM):** the type (Westwall combat bunker vs LVZ-West flak vs shelter) and date are unverified. No Kirrberg-specific Westwall literature was found.
6. **"D/S" border stones:** the Saargebiet (1920–35) interpretation is my inference from Kirrberg's 1920 assignment to Bezirksamt Zweibrücken. The OSM name is just "D/S".
7. **"Alter Stolleneingang":** the mining purpose is unknown. No sandstone quarry or mine history for Kirrberg was found. The Schlossberghöhlen were sometimes described as sand mining and sometimes as escape tunnels; sources differ.
8. **WWII bomb crater locations:** none are documented. Only the raid history (14 Mar 1945) is verified. The location of the synthetic-fuel plant was not verified.
9. **Hesse LRM kernel size and the exact VAT "general/flat" preset values:** not re-verified here. Check the RVT repository's blender settings and Hesse 2010.
10. **RRIM patent status:** "patented in some countries" per RVT docs; jurisdiction not checked.
11. **ML weights licences:** both the burial-mound and charcoal-kiln resources are **non-commercial**. Fine for a hobby project; re-check before any commercial use.
12. **Saarland Landesdenkmalamt pages:** blocked for automated fetching. The detector-permit statement comes from a search snippet; the law text is from lexaris.
13. **Bexbach / Limbach barrows:** no sources found.
