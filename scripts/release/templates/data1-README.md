# Saar LiDAR Explorer – Daten (Teil 1)

Static data for the [Saar LiDAR Explorer]({{APP_URL}}) (code: https://github.com/{{ORG}}/saar-lidar-explorer), served by GitHub Pages at {{DATA_URL}}.

> **Schauen, nicht graben.** Everything here is terrain data and *hypotheses*, not finds. Archaeological sites are protected (Saarländisches Denkmalschutzgesetz SDschG, Denkmalschutzgesetz Rheinland-Pfalz DSchG). No digging, no metal detecting; report finds to the Landesdenkmalamt.

## Contents

| Path | What |
|---|---|
| `{{AOI}}/` | AOI „{{AOI_NAME}}“: `manifest.json`, height chunks (Terrarium PNG), relief layers, overview levels, DOM, orthophoto, historic maps, LoD2 buildings, OSM ways, ALKIS parcels, point clouds, relict candidates, place statistics *Orte im Vergleich* (`stats/places.json`, `stats/places.geojson`: aggregates per Gemarkung / Gemeinde, estimates as ranges) the historic forest mask (`forest_hist/`, an estimate from the 1935–40 map symbols) and the tree species layer (`species/`, DLR 10 m classes, an estimate). Format: `docs/data-contract.md` in the code repository. The Leaflet tiles (`xyz`) are in the second data repository ({{DATA2_URL}}), referenced by absolute URLs in the manifest. |
{{STATS_AOI_ROWS}}
| `pois.geojson` | Known sites („Bekannte Orte“), WGS84. |
| `shared/karlsberg1789/` | Hypothetical reconstruction of Schloss Karlsberg, summer 1789 (light model for the explorer). |
| `castle-viewer/terrain/` | 1 m terrain crops (2025 DTM and the 1789 terrain hypothesis) used to build the castle viewer; `SHA256SUMS`. |
| `zones/` | Zone packages the explorer enters through a portal (`index.json`, format `docs/zone-contract.md`): `schloss-karlsberg/` (reconstruction 1789: zone manifest, 1789 terrain, texture sets) and `baeckerei-heusser/` (built twin of the bakery, shown with the owners' permission). |

## Relict candidates (`{{AOI}}/candidates/`)

The {{CANDIDATE_COUNT}} *Verdachtsflächen* are the output of an **automatic, unverified** terrain-shape detector (pits, mounds, ditches, rectangular structures, platforms). They are **hypotheses, not verified sites**: most are natural forms, modern disturbances, tracks or noise. Nobody has checked them in the field. They are published for looking and learning only — **not** as a guide for digging, probing or detector use.

## Licences and attribution

The code is MIT-licensed (see the code repository). **The data keep their own licences:**

- Geobasisdaten Saarland (LVGL-SL: DGM1/DOM1/ALS points, DOP20, LoD2, ALKIS, historic maps) and Rheinland-Pfalz (GeoBasis-DE/LVermGeoRP): **Datenlizenz Deutschland – Namensnennung – Version 2.0** (dl-de/by-2-0, https://www.govdata.de/dl-de/by-2-0). All products here are processed („Daten bearbeitet“).
- Place statistics (`{{AOI}}/stats/`) also use the **Zensus 2022** 100 m grid (© Statistische Ämter des Bundes und der Länder) and the **Marktstammdatenregister** (© Bundesnetzagentur), both dl-de/by-2-0, processed. They are aggregates per place, never per parcel, building or person.
- Tree species (`{{AOI}}/species/`, and the species / age values in `stats/`): **DLR EOC, Tree Species Germany 2022** (Wegler et al. 2025, doi:10.15489/smh8w3j8i962), **CC BY 4.0**, Daten bearbeitet (umprojiziert). The species cross-check numbers in the manifest (`species.crossCheck`, no pixels): **Thünen-Institut, Dominant Tree Species for Germany 2017/2018 (Blickensdörfer et al. 2024, doi:10.3220/DATA20221214084846)**, **CC BY 4.0**. *Artenvielfalt* in `stats/places.json`: counts from the **GBIF** occurrence search (GBIF.org; records CC0 / CC BY 4.0 / CC BY-NC 4.0, incl. iNaturalist), no records or species names.
{{STATS_AOI_LICENCE}}
- OpenStreetMap data (ways, most POI coordinates): **ODbL 1.0** (https://opendatacommons.org/licenses/odbl/), © OpenStreetMap-Mitwirkende.
- Reconstruction 1789 (`shared/karlsberg1789/`): own work (hypothesis); building footprints partly derived from the Lageplan 2006 by schloss-carlsberg.de („Mannlich“), **CC BY-SA 2.0 DE** — these derived geometries are shared under CC BY-SA 2.0 DE.
- Relief visualisations, candidates, levels and encodings: derived from the data above (same licences).
- Castle zone textures (`zones/schloss-karlsberg/textures/`): Poly Haven (https://polyhaven.com), **CC0 1.0**, downscaled. Bäckerei Heusser (`zones/baeckerei-heusser/`): the bakery's name, lettering, product texts and prices are shown with the owners' permission and are not licensed for reuse.

Attribution entries (also in `ATTRIBUTION`):

{{ATTRIBUTION_LIST_1}}
