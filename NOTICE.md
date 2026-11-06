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
| `zones/schloss-karlsberg/video2world/*.json`, `research/06`, `research/08` | Measured numbers only, from the HMS 2022 video | the video is © Architekturvisualisierung Matzerath + Historisches Museum Saar; **no frames, meshes or textures are included**, only own measurements („HMS, nur Maße“) |
| Viewer textures (fetched at build time, `zones/schloss-karlsberg/viewer/textures.json`) | Poly Haven texture sets | **CC0 1.0** |
| `zones/schloss-karlsberg/viewer/src/starCatalogue.ts` (star table only, not the code that reads it) | Stars brighter than V 5.0, positions carried to 1789 | adapted extract of the **HYG star database v4.4** (David Nash, astronexus; https://codeberg.org/astronexus/hyg), **CC BY-SA 4.0** — this table is shared under CC BY-SA 4.0; credited in the castle viewer footer |
| `zones/baeckerei-heusser/` (name, shop lettering „Bäckerei Heinrich Heusser seit 1933“, product names, texts and prices in `products/`, `catalogue/`) and the published twin (`saar-lidar-data/zones/baeckerei-heusser/`) | Stylised rebuild of a real, operating bakery in Kirrberg | shown **with the owners' permission**; the bakery's name, lettering, product texts and prices are **not** covered by the MIT licence and are not licensed for reuse (all rights with the owners). The build code is MIT; terrain and building context © GeoBasis-DE/LVGL-SL (2026), **dl-de/by-2-0**; streets © OpenStreetMap-Mitwirkende, ODbL |

Data served by the public site (separate repositories `saar-lidar-data`, `saar-lidar-data-2`): Geobasisdaten Saarland
and Rheinland-Pfalz under **Datenlizenz Deutschland – Namensnennung – 2.0** (https://www.govdata.de/dl-de/by-2-0),
OpenStreetMap under **ODbL 1.0**; see the README and `ATTRIBUTION` of those repositories.

> **Schauen, nicht graben.** The app shows hypotheses from terrain data, not finds. Archaeological sites are protected
> (SDschG Saarland, DSchG Rheinland-Pfalz); no digging or detector use, report finds to the Landesdenkmalamt.
