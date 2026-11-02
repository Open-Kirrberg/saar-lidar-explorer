# Saar LiDAR Explorer – Daten (Teil 2)

Second static data repository of the [Saar LiDAR Explorer]({{APP_URL}}) (code: https://github.com/{{ORG}}/saar-lidar-explorer), served at {{DATA2_URL}}. Split from [Teil 1]({{DATA_URL}}) to stay below the GitHub Pages site limit (1 GB).

> **Schauen, nicht graben.** Terrain data and models, not finds. No digging, no metal detecting; sites are protected (SDschG Saarland, DSchG RLP).

## Contents

| Path | What |
|---|---|
| `{{AOI}}/xyz/<layer>/{z}/{x}/{y}.png` | Leaflet (EPSG:3857) tiles of the relief layers and historic maps up to zoom {{XYZ_MAX_ZOOM}} (the app overzooms beyond). Referenced from `{{DATA_URL}}{{AOI}}/manifest.json`. |
| `print/<series>/` | 3D-printable terrain tiles: `index.json`, `<id>.3mf` (Bambu Studio / any slicer), `<id>.png` preview, `layout.png`, `keys/` (bowtie connector), `printer/` (Bambu Studio printer preset). STL tile meshes are not published (3MF only). |

{{PRINT_LIST}}

## Licences and attribution

Code: MIT (code repository). **Data keep their own licences:** Geobasisdaten Saarland (LVGL-SL) and Rheinland-Pfalz (GeoBasis-DE/LVermGeoRP) under **Datenlizenz Deutschland – Namensnennung – 2.0** (dl-de/by-2-0, https://www.govdata.de/dl-de/by-2-0), processed („Daten bearbeitet“). Print tiles are terrain models derived from the DGM1 (same licence) — a model, not a finding.

{{ATTRIBUTION_LIST_2}}
