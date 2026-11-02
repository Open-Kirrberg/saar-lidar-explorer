# Source cheat sheet (verified 2026-11-01)

Full research: `research/01-data-sources.md` (LiDAR, ortho, RLP), `research/04-cadastre-historic-maps.md` (ALKIS, historic maps), `research/03-…` (POIs). Re-verify a URL before relying on it if something fails — services move.

## LVGL Saarland open data (ALS 2025, released Jan 2026) — dl-de/by-2-0

- Entry (302 → Nextcloud share; token may change): `https://www.shop.lvgl.saarland.de/cloud/freiegeobasisdaten`
- WebDAV (no auth): `https://www.shop.lvgl.saarland.de/cloud/public.php/dav/files/<TOKEN>/<folder>/` — `PROPFIND Depth: 1` to list.
- One ZIP per county (`SPK` = Saarpfalz-Kreis; others SB, SLS, MZG, NK, WND). Server supports `Range` → extract single members with `fetch.HttpRangeFile` + `zipfile`.

| Folder | SPK file | Member pattern |
|---|---|---|
| `OD_DGM1_2025_tif_LK/` | `DGM1_tif_SPK_EPSG-25832_Entstehung-2025.zip` (888 MB) | `DGM1_tif_SPK/dgm1_32_{E}_{N}_1_SL_2025.tif` (float32, nodata −9999, PixelIsArea) |
| `OD_DOM1_2025_tif_LK/` | `DOM1_tif_SPK_…zip` (1.0 GB) | `dom1_32_{E}_{N}_1_SL_2025.tif` |
| `OD_LIDAR_Punktwolke_2025_laz_LK/` | `LIDAR_laz_SPK_EPSG-25832_Entstehung-2025.zip` (20.6 GB) | `3dm_32_{E}_{N}_1_SL_2025_050.laz` (~43 MB/km², thinned ~4 pts/m²; classes 2 ground, 6 building, 20 other; **no CRS tag**) |
| `OD_TrueDOP20_2025_tif_LK/` | `tDOP-SPK_…zip` (38 GB) | `dop20rgbi_32_{E}_{N}_2_SL_2025.tif` (2 km tiles, ~290 MB each) |
| `OD_Gebäudemodelle_LoD2_gml_LK/` (URL-encode `%c3%a4`) | `SPK_LOD2BWK_gml.zip` (214 MB) | `LoD2_32_{E}_{N}_1_SL.gml` |

Tiles: 1 km, named by lower-left corner in km (EPSG:25832). Karlsberg ALS flown ~2025-02-01 (leaf-off).
Attribution: `© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet`.

### Geoportal Saarland OGC services (CORS `*`)
- WMS DGM / shaded relief 2025, TrueDOP: see research/01 §3c for exact URLs + layer names (`sl_dop20_rgb`, `sl_shaded_relief_2025`, …). Use EPSG:25832 GetMap with chunk-aligned bboxes for pipeline downloads.

## Rheinland-Pfalz open data — dl-de/by-2-0, CORS `*`, Range OK

- Listings: `https://geobasis-rlp.de/data/`
- DGM1: `https://geobasis-rlp.de/data/dgm1/current/tif/dgm1_32_{E}_{N}_1_rp_{year}.tif` (border tiles 2022) — **+0.07 m vs SL 2025** (corrected in build.py)
- Also `dom1/`, `dop20rgb/`, `dop20rgbi/`, `bdom20rgbi/`, `geb3dlo/` (LoD2), `las/current/las/lpolpg_32_{E}_{N}_1_rp.laz` (full density, 190–490 MB/km²).
- Python's uv interpreter needs certifi for this host (`common.SSL_CTX`).
- Attribution: `© GeoBasis-DE/LVermGeoRP (2022), dl-de/by-2-0, www.lvermgeo.rlp.de, Daten bearbeitet`.

## ALKIS cadastre (Saarland) — dl-de/by-2-0, no owner data

- **WFS 414 "SL ALKIS Vereinfacht"**: `https://geoportal.saarland.de/registry/wfs/414` (GetCapabilities for the current endpoint)
  - Types (prefix `ALKIS_ALKIS_WFS_ohne_Eig:`): `Flurstueck`, `FlurstueckPunkt`, `Katasterbezirk`, `GebaeudeBauwerk`, `Nutzung`, `NutzungFlurstueck`, `Verwaltungseinheit`
  - Attributes: `FLSTKENNZ`, `GEMARKUNG`, `FLUR`, `FLSTNRZAE`, `FLSTNRNEN`, `LAGEBEZTXT`, `TNTXT`
  - **BBOX and SRSNAME must be `urn:ogc:def:crs:EPSG::25832`** (WGS84/3857 → empty result); axis E,N; ≤ 10 000 features/page (overall AOI ≈ 21.5 k parcels, 25 MB → 3 pages); GeoJSON output supported. Cold service can take up to ~70 s.
- **INSPIRE CP WMS** (Leaflet, EPSG:3857, CORS `*`): `/gdi-sl/inspirewms_Flurstuecke_Grundstuecke_ALKIS`, layers `CP.CadastralParcel` (style `…LabelOnReferencePoint`, labels from z16), `CP.CadastralZoning` (from z15).
- Avoid "freie Liegenschaftskarte SL" (not openly licensed); ALKIS SW raster WMS has contradictory terms.

## Historic maps — "WMS SL Historische Karten", dl-de/by-2-0

- Layers `0`–`8`; **`1` = Bavarian Originalpositionsblätter 1836–41** (shows "Ruine Carlsberg"); also Preußische Generalstabskarte, Karte des Deutschen Reiches, TK25 1935–40 / 1957–65 / 1978–82, KDS 1963. Tranchot / Ur-Messtischblätter cover only the former Prussian part (empty at Homburg).
- Behind a Geoportal proxy needing a session cookie (302 + `PHPSESSID`) → download at build time with a cookie jar; EPSG:25832 GetMap ≤ 4096 px, aligned with the DGM grid (tested).

## OSM — ODbL

- Overpass (be gentle; one query per AOI, cache the response) or Geofabrik Saarland extract `https://download.geofabrik.de/europe/germany/saarland.html` + osmium (RLP side: Rheinland-Pfalz extract).
- Relevant tags: `highway=*` (incl. `track` + `tracktype`, `path`, `footway`), `railway`, `waterway`, `barrier=wall|ditch`, `historic=*`, `man_made=*`, `military=bunker`.
- Attribution: `© OpenStreetMap contributors (ODbL)`. Don't bulk-download OSM *tiles*.

## Focus coordinates (EPSG:25832)

| Site | E | N | Tile |
|---|---|---|---|
| Schloss Karlsberg (main ruin) | 382198 | 5466099 | 382_5466 |
| Orangerie | 382230 | 5465987 | 382_5465 |
| Hohenburg / Schlossberg | 379680 | 5464414 | 379_5464 |
| Merburg (Kirrberg) | 381961 | 5463457 | 381_5463 |
| Kirrberg centre | 381412 | 5462164 | 381_5462 |

Overall AOI 378000–384000 / 5460000–5468000: 45 SL tiles; 383_5460–5462 are RLP-only.
