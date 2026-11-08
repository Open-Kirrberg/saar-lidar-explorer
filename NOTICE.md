# Licences of non-code content

The **code** in this repository is MIT-licensed (`LICENSE`, © 2026 Open-Kirrberg). Some files are **not code** and
keep the licence of the material they show or derive from. Reuse them under that licence, with attribution.

| Path | Content | Licence / attribution |
|---|---|---|
| `zones/schloss-karlsberg/docs/integration/` | Screenshots/renders of the app showing Geobasisdaten (DGM, DOM, DOP20, LoD2, ALKIS, historic maps) and minimap tiles | own screenshots; data © GeoBasis-DE/LVGL-SL (2026) and © GeoBasis-DE/LVermGeoRP, **dl-de/by-2-0**, Daten bearbeitet; map tiles © OpenStreetMap-Mitwirkende (ODbL data, tiles CC BY-SA 2.0), OpenTopoMap (CC BY-SA 3.0) |
| `zones/schloss-karlsberg/research/img/00_*`–`22_*` | Own LiDAR/relief/orthophoto/historic-map renders of the castle site | © GeoBasis-DE/LVGL-SL (2026), **dl-de/by-2-0**, Daten bearbeitet; OSM features © OpenStreetMap-Mitwirkende, ODbL |
| `zones/schloss-karlsberg/research/img/30_*`–`36_*` | Georeferenced overlays of the *Lageplan 2006* | derived from „Karlsberg_Lageplan.gif“, schloss-carlsberg.de („Mannlich“), Wikimedia Commons, **CC BY-SA 2.0 DE** — these images are shared under CC BY-SA 2.0 DE |
| `zones/schloss-karlsberg/research/img/37_*`, `38_*` | Overlays of the 1805 ruins map | „Karlsberg_karte_II.jpg“ (1805, anonymous), Wikimedia Commons, **public domain**; hillshade dl-de/by-2-0 |
| `zones/schloss-karlsberg/model/catalogue*.json`, `zones/schloss-karlsberg/docs/review/`, `zones/schloss-karlsberg/docs/screenshots/`, `zones/schloss-karlsberg/research/07-period-sources.md` (Appendix A) | Reconstruction catalogue, generated plan sheets and renders | own work (hypothesis); footprint geometry partly derived from the Lageplan 2006 (**CC BY-SA 2.0 DE**, see above) — the derived geometry is shared under CC BY-SA 2.0 DE; terrain © GeoBasis-DE/LVGL-SL, dl-de/by-2-0 |
| `zones/schloss-karlsberg/video2world/*.json`, `zones/schloss-karlsberg/research/06-video-analysis.md`, `zones/schloss-karlsberg/research/08-reference-mesh-measurements.md` | Measured numbers only, from the HMS 2022 video | the video is © Architekturvisualisierung Matzerath + Historisches Museum Saar; **no frames, meshes or textures are included**, only own measurements („HMS, nur Maße“) |
| Viewer textures (fetched at build time, `zones/schloss-karlsberg/viewer/textures.json`) and their downscaled copies in the published castle zone (`saar-lidar-data/zones/schloss-karlsberg/textures/`) | Poly Haven texture sets (1024² / 512² JPEG) | **CC0 1.0** |
| `zones/schloss-karlsberg/viewer/src/starCatalogue.ts` (star table only, not the code that reads it) | Stars brighter than V 5.0, positions carried to 1789 | adapted extract of the **HYG star database v4.4** (David Nash, astronexus; https://codeberg.org/astronexus/hyg), **CC BY-SA 4.0** — this table is shared under CC BY-SA 4.0; credited in the castle viewer footer |
| Published castle zone `saar-lidar-data/zones/schloss-karlsberg/` (`zone.json`, `terrain/`) | 1789 terrain hypothesis (u16 grid, ground classes) and the zone manifest (footprint, texts, attribution) | terrain © GeoBasis-DE/LVGL-SL (2026), **dl-de/by-2-0**, Daten bearbeitet (1789 = hypothesis, own work); footprint partly derived from the Lageplan 2006 (**CC BY-SA 2.0 DE**, as above); texts own work (hypothesis) |
| `zones/baeckerei-heusser/` (name, shop lettering „Bäckerei Heinrich Heusser seit 1933“, product names, texts and prices in `products/`, `catalogue/`) and the published twin (`saar-lidar-data/zones/baeckerei-heusser/`) | Stylised rebuild of a real, operating bakery in Kirrberg | shown **with the owners' permission**; the bakery's name, lettering, product texts and prices are **not** covered by the MIT licence and are not licensed for reuse (all rights with the owners). The build code is MIT; terrain and building context © GeoBasis-DE/LVGL-SL (2026), **dl-de/by-2-0**; streets © OpenStreetMap-Mitwirkende, ODbL |

Data served by the public site (separate repositories `saar-lidar-data`, `saar-lidar-data-2`): Geobasisdaten Saarland
and Rheinland-Pfalz under **Datenlizenz Deutschland – Namensnennung – 2.0** (https://www.govdata.de/dl-de/by-2-0),
OpenStreetMap under **ODbL 1.0**; the place statistics *Orte im Vergleich* (`overall/stats/`) also derive from
**Zensus 2022** (© Statistische Ämter des Bundes und der Länder) and the **Marktstammdatenregister** (© Bundesnetzagentur),
both dl-de/by-2-0, and the historic forest mask (`overall/forest_hist/`) from the historic maps of GeoBasis-DE/LVGL-SL
(dl-de/by-2-0). The tree species layer (`overall/species/`) and the species / age values of the place statistics derive
from **DLR EOC, Tree Species Germany 2022** (Wegler et al. 2025, doi:10.15489/smh8w3j8i962), **CC BY 4.0**, Daten
bearbeitet (umprojiziert); the per-class agreement numbers in the manifest (`species.crossCheck`, no pixels)
from the **Thünen-Institut, Dominant Tree Species for Germany 2017/2018 (Blickensdörfer et al. 2024, doi:10.3220/DATA20221214084846)**, **CC BY 4.0**; the *Artenvielfalt* counts from the **GBIF** occurrence search (GBIF.org, counts only; records
CC0 / CC BY 4.0 / CC BY-NC 4.0, incl. iNaturalist). The leaderboard level *Gemeinden* (`saarland/stats/`, from the S1 data release on; aggregates per
municipality only) uses the municipality outlines of the **BKG VG25** (© BKG (2026), **CC BY 4.0**, https://www.bkg.bund.de,
Daten verändert (dissolved per AGS, simplified to 50 m), Datenquellen:
https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg25.pdf), the **Zensus 2022** municipality totals (Regionaltabelle, © Statistische Ämter des Bundes und
der Länder, dl-de/by-2-0) and the sources above (MaStR, DLR, GBIF counts). See the README and `ATTRIBUTION` of those
repositories.

> **Schauen, nicht graben.** The app shows hypotheses from terrain data, not finds. Archaeological sites are protected
> (SDschG Saarland, DSchG Rheinland-Pfalz); no digging or detector use, report finds to the Landesdenkmalamt.
