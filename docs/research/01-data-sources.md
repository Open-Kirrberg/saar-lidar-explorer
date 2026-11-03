# 01 – Data sources: Saarland LiDAR 2025 (Homburg / Kirrberg / Karlsberg)

Researched 2026-11-01. Everything marked **verified** was checked live with HTTP requests on that date. That includes one LAZ tile and one DGM1 tile that were actually downloaded and inspected.

---

## TL;DR

* The "new LiDAR data of the Saarland" is the **landesweite Airborne-Laserscanning-Befliegung 2025 (ALS 2025)** by the **LVGL Saarland**. The Karlsberg tile was flown about **1 Feb 2025**, so it is leaf-off. The derived products are the classified point cloud, DGM1 (bare earth), DOM1 (surface) and TrueDOP20. They were released as **open data under DL-DE-BY-2.0 in Jan 2026**. In March 2026 they were also presented in the "Saarland 3D" digital-twin viewer (VC Map/Cesium).
* **Free bulk download, no login.** A public Nextcloud share at `https://www.shop.lvgl.saarland.de/cloud/freiegeobasisdaten` holds one ZIP per Landkreis. Homburg is in **SPK = Saarpfalz-Kreis**.
* The ZIPs are huge (point cloud SPK = **20.6 GB**). But the server supports **HTTP Range requests**, so single 1 km tiles (~40–46 MB LAZ, ~2 MB DGM1) can be pulled out of the remote ZIP by script. **Verified.**
* Tile naming: `3dm_32_{E_km}_{N_km}_1_SL_2025_050.laz` and `dgm1_32_{E}_{N}_1_SL_2025.tif`. These are 1×1 km tiles in **EPSG:25832** with heights in **DHHN2016**.
* **No CORS** on the Nextcloud share or on the Saarland-3D tiles, so preprocess offline and serve your own static assets. The **WMS services do send `Access-Control-Allow-Origin: *`**: DGM1 2025, Shaded Relief 2025 and DOP20.

---

## 1. Publisher and products

### Who publishes

| Body | Role |
|---|---|
| **LVGL Saarland** – Landesamt für Vermessung, Geoinformation und Landentwicklung | Produces and distributes the Geobasisdaten: ALS, DGM, DOM, DOP, LoD2, ALKIS. Shop / open-data portal: https://www.shop.lvgl.saarland.de/ |
| **Geoportal Saarland** (MUKMAV, Referat E/6 Geodatenzentrum) | Runs the OGC services (WMS) and the metadata. https://geoportal.saarland.de/ – overview: https://geoportal.saarland.de/app-article/geobasisdatenuebersicht/ |
| **Saarland 3D** (LVGL + MUKMAV, built by M.O.S.S. with VC Map from virtualcitysystems) | Web digital twin presented 10 Mar 2026: https://www.shop.lvgl.saarland.de/mogi3d/ |
| BKG / GDZ (geodatenzentrum.de) | Nationwide DGM1 mosaic (fee-based) and basemap.de. You do not need it here. |

The press release ("Saarland 3D", 2026-03-10) is at https://www.saarland.de/mukmav/DE/aktuelles/aktuelle-meldungen/2026/geodatenzentrum/q1/pm_2026-03-10_lpk-saarland-3d. It sits behind a JS bot wall and could not be fetched. Secondary coverage:
https://www.moss.de/2026/06/18/pionierarbeit-im-saarland-der-digitale-zwilling-saarland-3d-ist-live/ ,
https://www.smartcountry.berlin/de/newsblog/details/saarland-3d-der-digitale-zwilling-ist-da.html ,
https://lokalo.de/artikel/405616/das-saarland-gibt-es-jetzt-auch-dreidimensional/ .
These sources say Saarland is "the first German Flächenland to publish a *classified* laser-scan point cloud" through Saarland 3D.

### Products from the 2025 campaign. All are in the open-data share and all were verified.

| Product | Share folder | Format | Tile | Size per tile | Notes |
|---|---|---|---|---|---|
| **Classified point cloud (ALS 2025)** | `OD_LIDAR_Punktwolke_2025_laz_LK` | LAZ (LAS 1.2, PF1 + RIEGL extra bytes) | 1×1 km | 38–46 MB | **~4 pts/m²** in the open version. It was thinned with `lasthin64`, hence the `_050` suffix (likely a 0.5 m thinning grid). Has intensity, returns, gps_time and extra bytes Amplitude/Reflectance/Deviation. **No RGB.** |
| **DGM1 2025** (bare-earth DTM, 1 m) | `OD_DGM1_2025_tif_LK` / `OD_DGM1_2025_laz_LK` | GeoTIFF float32, uncompressed, 1000×1000, nodata −9999; or the grid as LAZ | 1×1 km | 4.0 MB tif (~2 MB zipped); ~0.7 MB laz | Product page: "Datengrundlage … landesweite Airborne-Laserscan-Befliegung von 2025" – https://www.shop.lvgl.saarland.de/index.php?option=com_virtuemart&view=category&virtuemart_category_id=1060&Itemid=156 |
| **DOM1 2025** (surface model, 1 m) | `OD_DOM1_2025_tif_LK` / `OD_DOM1_2025_laz_LK` | GeoTIFF float32 / LAZ | 1×1 km | 4.0 MB tif | Built from classes 2, 6, 8, 9, 17, 20 |
| **TrueDOP20 2025** (true orthophoto, 20 cm, RGBI) | `OD_TrueDOP20_2025_tif_LK` | GeoTIFF (4 band) + .tfw | **2×2 km** (even km) | **~290 MB** | Image flights 11–12 Apr and 9–11 May 2025, according to the shop. Rectified on a bDOM. |
| **LoD2 buildings** | `OD_Gebäudemodelle_LoD2_gml_LK` | CityGML (.gml + .txt per tile) | 1×1 km | Homburg centre tile 38 MB gml (4 MB zipped) | Undated ("LOD2BWK"). Folder updated 2026-05-29. |
| Hausumringe (footprints, shp) | `OD_Hausumringe_shp_SL` | Shapefile, whole state | – | 66 MB | Usable for LoD1 extrusion |
| ALKIS, Basis-DLM, DTK5/25/50/100, Hauskoordinaten | various | shp / NAS / tif / csv | – | – | Streets: Basis-DLM (`OD_BDLM_shp_SL`, 84 MB) or OSM |

Older campaigns: 2006 (2–3 pts/m²) and spring 2016 (~8 pts/m² raw). The DGM1 for 2006 and 2016 is still served as WMS layers. Source: https://wiesehahn.github.io/lidar-forestry/content/data.html. Those details come from a secondary source; only the WMS layer names were checked here.

**Classification code list ALS 2025.** PDF: https://www.shop.lvgl.saarland.de/templates/lvgl/images/product/dgm/ALS_2025_Klassifizierung.pdf (verified, text extracted):

| Class | Meaning | DGM | DOM |
|---|---|---|---|
| 1 | Unclassified / moving objects / outliers | | |
| **2** | **Ground** (includes man-made earthworks, quarries, terraces) | X | X |
| **6** | **Building** | | X |
| 8 | Synthetic water points | X | X |
| 9 | Water (rivers wider than 6 m, ponds larger than 100 m²) | X | X |
| 14 | Wires (power lines, catenary) | | |
| 17 | Bridge deck | | X |
| **20** | **Non-ground, general: vegetation, other structures, carports, guard rails** | | X |
| 24 | Basement points: cellar stairs, light wells, pools | | |
| 30 | Synthetic surface points (gap fill under houses or dense vegetation) | X | |

Note that there is **no separate low/medium/high vegetation class**. Vegetation is in class 20. Use classes 2 (+8, 9) for bare earth. Class 24 "Keller" is a nice extra.

**Measured on tile `3dm_32_382_5466` (Schloss Karlsberg, mostly forest).** Downloaded and inspected with laspy:

* 3,998,670 points on 1 km², which is **4.0 pts/m²**. Ground (class 2) is **1.27 pts/m²** under forest. Class 20 is 2.73/m². Building: 672 points. Class 24: 22 points. Class 30: 2,255 points.
* Z range 289.4–397.4 m. DGM1 range for the same tile is 289.4–362.6 m.
* Scale 0.01 m, offsets (0, 5,000,000, 0). 5 flight lines (point_source_id). Header creation date 2025-09-21. gps_time (adjusted standard) decodes to **2025-02-01 ~18:48–19:27 UTC**, i.e. leaf-off winter.
* **The LAZ has no CRS VLR** (no WKT/GeoKeys). You must assign EPSG:25832 + DHHN2016 yourself, e.g. `pdal translate --readers.las.spatialreference=EPSG:25832+7837`.

1.27 ground pts/m² under forest is enough for a good 1 m DTM. Walls, moats, pits, bunker mounds and ditches of about 1 m scale will show. Features below 0.5 m will be soft.

---

## 2. License and attribution

* **Datenlizenz Deutschland – Namensnennung – Version 2.0 (dl-de/by-2-0)**: https://www.govdata.de/dl-de/by-2-0 . This is stated on the LVGL open-data page (verified): https://www.shop.lvgl.saarland.de/index.php?option=com_content&view=article&id=18
* **Required attribution** (licensor's wording): **`© GeoBasis DE/LVGL-SL (Jahr der Bereitstellung)`**. Suggested text for the app: `© GeoBasis DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet`. Add "Daten bearbeitet" because the data gets reprocessed, e.g. meshing or decimation.
* Commercial use, modification and redistribution are allowed with attribution. So it is fine to republish derived tiles (meshes, COPC, hillshade) in the app.
* Caveat: Saarland 3D *viewer assets* (the `/wega-3d-data/...` 3D Tiles, the quantized-mesh terrain, the mesh) have no stated license. They are derived from the same open data but are not offered for reuse. Do not hotlink them; build your own.
* If you use RLP data (fallback): `©GeoBasis-DE / LVermGeoRP <Jahr>, dl-de/by-2-0, www.lvermgeo.rlp.de [Daten bearbeitet]`.

---

## 3. How to download

### 3a. Open-data share (main route, verified)

* Landing pages: LVGL "Offene Daten und Dienste" → https://www.shop.lvgl.saarland.de/index.php?option=com_content&view=article&id=17 → "Offene Geobasisdaten" → https://www.shop.lvgl.saarland.de/index.php?option=com_content&view=article&id=18
* The **"Landesweite Datensätze"** link `https://www.shop.lvgl.saarland.de/cloud/freiegeobasisdaten` redirects to the Nextcloud public share **`https://www.shop.lvgl.saarland.de/cloud/index.php/s/NK8ndP55qAqGEZD`** (HTML UI).
* **Scriptable WebDAV root** (no auth): `https://www.shop.lvgl.saarland.de/cloud/public.php/dav/files/NK8ndP55qAqGEZD/`

```bash
# list a folder
curl -X PROPFIND -H "Depth: 1" \
  "https://www.shop.lvgl.saarland.de/cloud/public.php/dav/files/NK8ndP55qAqGEZD/OD_LIDAR_Punktwolke_2025_laz_LK/"
```

Folders (total ~397 GB) and Saarpfalz-Kreis (SPK) files:

| Folder | SPK file | SPK size |
|---|---|---|
| `OD_LIDAR_Punktwolke_2025_laz_LK/` | `LIDAR_laz_SPK_EPSG-25832_Entstehung-2025.zip` | 20.6 GB (509 tiles) |
| `OD_DGM1_2025_tif_LK/` | `DGM1_tif_SPK_EPSG-25832_Entstehung-2025.zip` | 888 MB |
| `OD_DGM1_2025_laz_LK/` | `DGM1_laz_SPK_EPSG-25832_Entstehung-2025.zip` | 342 MB |
| `OD_DOM1_2025_tif_LK/` | `DOM1_tif_SPK_EPSG-25832_Entstehung-2025.zip` | 1.0 GB |
| `OD_DOM1_2025_laz_LK/` | `DOM1_laz_SPK_…zip` | – |
| `OD_TrueDOP20_2025_tif_LK/` | `tDOP-SPK_EPSG-25832_Entstehung-2025.zip` | 38.4 GB (147 tiles) |
| `OD_Gebäudemodelle_LoD2_gml_LK/` (URL: `OD_Geb%c3%a4udemodelle_LoD2_gml_LK`) | `SPK_LOD2BWK_gml.zip` | 214 MB |
| each LK folder | `Kachelübersicht-Airborne Laserscanning 2025.pdf` | 7 MB tile index map |

Other Landkreis codes: SB = Regionalverband Saarbrücken, SLS = Saarlouis, MZG = Merzig-Wadern, NK = Neunkirchen, WND = St. Wendel.

**Tile names inside the ZIPs.** Lower-left corner in km, EPSG:25832.

```
LIDAR_laz_SPK/3dm_32_{E}_{N}_1_SL_2025_050.laz
DGM1_tif_SPK/dgm1_32_{E}_{N}_1_SL_2025.tif        (GeoKeys EPSG:25832, PixelIsArea, UL tiepoint = (E*1000, (N+1)*1000))
DGM1_laz_SPK/dgm1_32_{E}_{N}_1_SL_2025.laz
DOM1_tif_SPK/dom1_32_{E}_{N}_1_SL_2025.tif
tDOP-SPK/dop20rgbi_32_{E}_{N}_2_SL_2025.tif + .tfw   (2 km tiles, E and N even)
SPK_LOD2BWK_gml/LoD2_32_{E}_{N}_1_SL.gml + .txt
```

**Partial download of single tiles (verified).** The server answers `206 Partial Content` with `Accept-Ranges`. Python's `zipfile` over a range-reading file object reads the central directory in 3–4 requests (~60 KB) and then streams one member. Extracting `3dm_32_382_5466…laz` (45.5 MB) took 15 requests and 43 s. Extracting `dgm1_32_382_5466…tif` took 4 requests. Minimal implementation:

```python
import io, zipfile, urllib.request
class HttpFile(io.RawIOBase):
    def __init__(s, url):
        s.url, s.pos = url, 0
        s.size = int(urllib.request.urlopen(urllib.request.Request(url, method="HEAD")).headers["Content-Length"])
    def seekable(s): return True
    def readable(s): return True
    def tell(s): return s.pos
    def seek(s, off, wh=0):
        s.pos = off if wh == 0 else s.pos + off if wh == 1 else s.size + off; return s.pos
    def readinto(s, b):
        if s.pos >= s.size: return 0
        end = min(s.pos + len(b), s.size) - 1
        d = urllib.request.urlopen(urllib.request.Request(s.url, headers={"Range": f"bytes={s.pos}-{end}"})).read()
        b[:len(d)] = d; s.pos += len(d); return len(d)

BASE = "https://www.shop.lvgl.saarland.de/cloud/public.php/dav/files/NK8ndP55qAqGEZD/"
z = zipfile.ZipFile(io.BufferedReader(HttpFile(BASE + "OD_LIDAR_Punktwolke_2025_laz_LK/LIDAR_laz_SPK_EPSG-25832_Entstehung-2025.zip"), 4 << 20))
with z.open("LIDAR_laz_SPK/3dm_32_382_5466_1_SL_2025_050.laz") as src, open("3dm_32_382_5466.laz", "wb") as dst:
    while (chunk := src.read(4 << 20)): dst.write(chunk)
```

The `remotezip` PyPI package does the same. For the TrueDOP (290 MB per 2 km tile) prefer the WMS below unless you need full resolution.

### 3b. Shop (ordering route)

The classic VirtueMart shop lets you order by map selection with free "Testdaten". The open DGM map-selection entry in the shop is currently commented out in the page HTML, so the cloud share is the working route.
Point cloud product page: https://www.shop.lvgl.saarland.de/index.php?option=com_virtuemart&view=category&virtuemart_category_id=1067&Itemid=156. The shop also offers custom DGM grids down to 0.25 m on request.

### 3c. OGC services (CORS checked)

| Service | URL | Layers | CORS |
|---|---|---|---|
| DGM WMS | `https://geoportal.saarland.de/freewms/dgm?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0` | `sl_dgm1_2025`, **`sl_shaded_relief_2025`**, `sl_dgm1_2016`, `sl_shaded_relief_2016`, `sl_dgm1_2006`, `sl_dgm5_2006`, `sl_shaded_relief_2006`, `sl_dhm50_2006`, `sl_dgm1_2025_info` | **`Access-Control-Allow-Origin: *`** (verified) |
| DGM1 2025 INSPIRE WMS (Mapbender proxy) | `https://geoportal.saarland.de/mapbender/php/wms.php?inspire=1&layer_id=49931&withChilds=1&REQUEST=GetCapabilities&SERVICE=WMS&` | `sl_dgm1_2025` | `*` (verified) |
| TrueDOP20 2025 WMS | `https://geoportal.saarland.de/freewms/truedop?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0` | `sl_dop20_rgb`, `sl_dop20_cir`, `sl_dop20_ir` | `*` (verified). Fees: none, AccessConstraints: noLimitations |
| ALKIS WMS | `https://geoportal.saarland.de/geobasisdaten/mapserv?map=/mapfiles/geobasisdaten/Internet/alkis.map&` | `adv_alkis` | not checked |
| basemap.de WMS (BKG) | `https://sgx.geodatenzentrum.de/wms_basemapde` | `de_basemapde_web_raster_farbe/grau` | not checked |

These WMS services support CRS EPSG:25832, 3857, 4326 and others, with formats png, jpeg and tiff. A test GetMap of `sl_shaded_relief_2025` over Karlsberg returned a clean 800×800 PNG. Example:
`https://geoportal.saarland.de/freewms/dgm?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=sl_shaded_relief_2025&STYLES=&CRS=EPSG:25832&BBOX=381000,5465000,383500,5467500&WIDTH=800&HEIGHT=800&FORMAT=image/png`.
Because of the CORS header, three.js can load DOP and hillshade WMS tiles directly as textures.

No WCS or WMTS was found for raw heights. For elevation data in the browser, preprocess the GeoTIFFs.

### 3d. CORS summary

* Nextcloud share (`/cloud/public.php/dav/...`): **no CORS**. A preflight OPTIONS returns no ACAO. Download offline with a script.
* Saarland 3D assets (`https://www.shop.lvgl.saarland.de/wega-3d-data/...`): **no CORS**.
* Geoportal WMS: **CORS `*`**.
* RLP `geobasis-rlp.de/data/...`: **CORS `*`** plus Range support.

---

## 4. CRS and vertical datum

* Horizontal: **ETRS89 / UTM zone 32N, EPSG:25832** (all file names say `EPSG-25832`, and the GeoTIFF GeoKeys say 25832).
* Vertical: **DHHN2016 normal heights** (NHN), EPSG:7837. Compound: **EPSG:25832+7837**. Stated on the DGM/point-cloud product pages. The LAZ files carry no CRS tag.
* Delivery in GK2 is possible through the shop (not needed).
* For three.js: subtract a local origin, e.g. (380000, 5463000, 0) or the AOI centre, to keep float32 precision. Easting maps to +x, northing to −z (or +y), height to +y.

---

## 5. Focus points and tiles

Coordinates come from OSM/Nominatim and were converted with pyproj. Tile = `floor(E/1000)_floor(N/1000)`.

| Focus point | WGS84 (lat, lon) | EPSG:25832 (E, N) | 1 km tile |
|---|---|---|---|
| Kirrberg village centre | 49.30070, 7.36880 | 381412, 5462164 | 381_5462 |
| Burgruine Merburg (Kirrberg) | 49.31243, 7.37597 | 381961, 5463457 | 381_5463 |
| **Schloss Karlsberg** (OSM castle node, main ruin) | 49.33623, 7.37844 | 382198, 5466099 | **382_5466** |
| Karlsberg Orangerie ruin | 49.33523, 7.37891 | 382230, 5465987 | 382_5465 |
| Karlsberg Eiskeller (archaeological site) | 49.33811, 7.38271 | 382512, 5466301 | 382_5466 |
| Karlsberg ruins (OSM node) | 49.33440, 7.37316 | 381810, 5465903 | 381_5465 |
| Tschifflik pavilion ruin | 49.32433, 7.38459 | 382616, 5464766 | 382_5464 |
| Celtic burial mounds (Keltischer Grabhügel) | 49.32033, 7.38108 / 49.31320, 7.35907 | 382352, 5464327 / 380735, 5463569 | 382_5464 / 380_5463 |
| Homburg Marktplatz | 49.32147, 7.34105 | 379446, 5464517 | 379_5464 |
| **Schlossberg / Burgruine Hohenburg** | 49.32059, 7.34431 | 379680, 5464414 | **379_5464** |
| Schlossberghöhlen (sandstone caves) | 49.32051, 7.34265 | 379559, 5464408 | 379_5464 |

The OSM tag "Schlossberg (peak)" at 49.32177, 7.35644 is east of the castle ruin. Use the Hohenburg node for the Schlossberg. OSM also has "D/S" boundary stones from the 1920–35 Saar border at 49.33312, 7.36992 and 49.33713, 7.37562.

### Suggested AOIs (all tiles exist in the SPK ZIP unless noted)

| AOI | EPSG:25832 bbox (Emin, Nmin – Emax, Nmax) | WGS84 SW → NE | 1 km tiles | LAZ volume |
|---|---|---|---|---|
| **Karlsberg** (ruins + forest) | 381000, 5465000 – 384000, 5468000 | 49.32612, 7.36229 → 49.35367, 7.40268 | E 381–383 × N 5465–5467 (9) | ~397 MB |
| **Kirrberg** + surrounding forest + Merburg | 380000, 5460000 – 383000, 5463500 | 49.28097, 7.35003 → 49.31302, 7.39024 | E 380–382 × N 5460–5463 (12) | ~499 MB |
| **Homburg centre + Schlossberg** | 378000, 5463000 – 381000, 5466000 | 49.30754, 7.32163 → 49.33511, 7.36199 | E 378–380 × N 5463–5465 (9) | ~359 MB |
| **Overall** (covers all three) | 378000, 5460000 – 384000, 5468000 | 49.28057, 7.32255 → 49.35367, 7.40268 | 6×8 = 48 → **45 present**. Missing: 383_5460, 383_5461, 383_5462 (Rheinland-Pfalz) | ~1.9 GB LAZ, ~90 MB DGM1 tif |

TrueDOP20 2 km tiles for the overall AOI: `dop20rgbi_32_{378,380,382}_{5460,5462,5464,5466}_2` plus `…_382_5468_2` if you go north of 5468. That is 12–15 files of ~290 MB, so use the WMS instead.

**Border warning.** The Saarland/RLP border runs right along the eastern edge of the Karlsberg forest and south-east of Kirrberg. The 2025 shaded relief shows nodata east of about E 383.3 km near N 5465. Border tiles (382/383/384 × 5460–5467) are clipped to Saarland, so mosaic with RLP data for a seamless edge (see §6).

---

## 6. Fallbacks and complements

1. **Rheinland-Pfalz open data** (verified, CORS `*`, Range OK, no login): directory listings at https://geobasis-rlp.de/data/
   * DGM1: `https://geobasis-rlp.de/data/dgm1/current/tif/dgm1_32_{E}_{N}_1_rp_{year}.tif` (+ .tfw). Border tiles near Kirrberg/Karlsberg are from **2022**, e.g. `dgm1_32_383_5465_1_rp_2022.tif`, 1.7 MB.
   * Point cloud "Laserpunkte Oberfläche und Gelände (LAS)": `https://geobasis-rlp.de/data/las/current/las/lpolpg_32_{E}_{N}_1_rp.laz`. Full density, **190–490 MB per km²**. Example `lpolpg_32_383_5465_1_rp.laz` = 465 MB. Metadata: `https://geobasis-rlp.de/data/las/current/metadata/lpolpg_32_383_5465_1_rp_meta.xml`.
   * Also available: `dom1/`, `dop20rgb/`, `dop20rgbi/`, `bdom20rgbi/`, `geb3dlo/` (LoD2), `basisdlm/`. Same 1 km grid (lower-left km corner), EPSG:25832. License dl-de/by-2-0.
   * Use these to fill 383_5460–5462 and the RLP side of the Karlsberg / Kirrberg forests.
2. **Older Saarland DGM1** (2016, 2006): WMS layers only (`sl_dgm1_2016`, `sl_shaded_relief_2016`). The 2016 DGM1 has an INSPIRE ATOM record (https://gdk.gdi-de.org/geonetwork/srv/api/records/96b3a5b3-b73b-0002-a9a3-417cb1736fe4). Useful for change detection.
3. **Copernicus DEM GLO-30 / EU-DEM**: 30 m, useless for features. Only for a far-distance backdrop.
4. **OpenTopography**: hosts no German state ALS for this area. Not useful except for global DEMs.
5. **BKG DGM1 (bundesweit)**: fee-based (https://sg.geodatenzentrum.de/web_public/gdz/dokumentation/deu/dgm1.pdf). Not needed.
6. **OSM** (Geofabrik Saarland extract: https://download.geofabrik.de/europe/germany/saarland.html): streets, paths and POI labels. ODbL.

---

## 7. Existing viewers to learn from

* **Saarland 3D**: https://www.shop.lvgl.saarland.de/mogi3d/ (VC Map 6 / CesiumJS, by M.O.S.S. and virtualcitysystems). Its config is public JSON. Root: `app.config.json`. The modules live in `configs/*.json`, and the "Geobasiszwilling" module is `configs/7fceeee0-8413-4a8a-8a02-4d365b231ec6.json`. Things worth copying:
  * Point cloud is split **per class into separate 3D Tiles tilesets** (`/wega-3d-data/LIDAR/2025/{Boden,Gebaeude,Vegetation,Keller,Leitungen,Bruecken,Gewaesser}/tileset.json`). These are `pnts` with CONSTANT_RGBA per class and no attributes beyond position. Each leaf has about 13k points. You can toggle "Vegetation" off to see the ground.
  * Terrain is **quantized-mesh** (`/wega-3d-data/TERRAIN/DTM_1M/layer.json`, z 0–16, octvertexnormals), made from the 1 m DTM.
  * LoD2 is 3D Tiles (`/wega-3d-data/LOD2/Gebaeude/tileset.json`). There is also a photogrammetric/2.5D mesh (`/wega-3d-data/MESH/Saarland_NN/saarland_tileset.json`) and a DOP20 WMS drape.
  * Plugins: flight, height-profile, measurement, shadow, viewshed, walk, pointcloud-settings.
  * There is no CORS and no license for these assets, so learn from them but do not consume them.
* **Geoportal Saarland map viewer** (2D, DGM/hillshade/DOP layers): https://geoportal.saarland.de/
* **RLP**: "Rheinland-Pfalz in 3D" viewer and the Viewernavigator flyer: https://vermka-westeifel-mosel.rlp.de/fileadmin/lvermgeo/pdf/faltblaetter_broschueren/Flyer_Viewernavigator.pdf
* LiDAR-archaeology practice uses multi-direction hillshade, Sky-View Factor, openness and local relief model (RVT / LiVT toolboxes). Background: https://edoc.hu-berlin.de/18452/6020 , EAC guidelines https://air.unimi.it/retrieve/e828cbca-3a91-429b-9317-2e665f1e02e1/EAC10guidance-LiDAR_2025.pdf . Covered in `03-archaeology-visualization.md`.
* General overview of German open LiDAR availability: https://wiesehahn.github.io/lidar-forestry/content/data.html

---

## Recommendation

1. **Primary terrain:** **DGM1 2025 GeoTIFF** tiles (1 m, float32) for the overall AOI E 378–384 / N 5460–5468. That is 45 tiles at ~4 MB each, so ~180 MB raw (~90 MB zipped transfer). Pull them by range request from `DGM1_tif_SPK_…zip`. Fill 383_5460–5462 and the clipped border with RLP `dgm1_…_rp_2022.tif`. Mosaic, then build:
   * a terrain mesh (e.g. Martini/RTIN or quantized-mesh tiles, or simply 1 m grid chunks per 1 km tile with LOD), and
   * archaeological relief textures from the same DGM: multi-hillshade, SVF, local relief model. These are what reveal walls, moats and pits in the Karlsberg forest.
2. **Point cloud for the fly-through:** the **ALS 2025 LAZ** tiles (~43 MB/km², 4 pts/m², classified) for Karlsberg + Schlossberg + Kirrberg (~1.3–1.9 GB). Convert to **COPC** or **Potree 2 / 3D Tiles** per class offline, with PDAL / untwine / PotreeConverter / py3dtiles. Assign EPSG:25832 explicitly because there is no CRS in the files. Render with class toggles: ground only, ground + buildings, everything.
3. **Buildings:** LoD2 CityGML (`SPK_LOD2BWK_gml.zip`, 214 MB, extract only the AOI tiles). Convert to glTF/3D Tiles, e.g. with citygml-tools + FME/py3dtiles. Simpler alternative: extrude `OD_Hausumringe_shp_SL` (LoD1-ish) or take building points (class 6) straight from the point cloud.
4. **Imagery drape:** stream **TrueDOP20 WMS** (`sl_dop20_rgb`, CORS `*`) at the needed zoom, or pre-render one ~0.5 m texture per km tile. Use **`sl_shaded_relief_2025`** WMS for quick prototyping before you have your own relief rendering.
5. **Streets:** Basis-DLM shp (open, LVGL) or OSM.
6. Put `© GeoBasis DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet` (and the RLP note if used) in the app footer.
7. Everything should be **preprocessed offline into static files served by the app**. The source data has no CORS, and the ZIPs are not browser-friendly.

---

## Uncertain / unverified

* The official March 2026 press release could not be read (403 / JS challenge). Details about Saarland 3D (cost ~€50k, "first Flächenland") come from secondary sources.
* Exact flight dates statewide: only one tile was checked (gps_time ≈ 2025-02-01). The full campaign window and the raw (un-thinned) density are unknown. The 4 pts/m² is the thinned open product. A denser version may be orderable via the shop; that is not confirmed.
* Meaning of the `_050` suffix: assumed to be the thinning grid (0.5 m) or a version code. Not documented in the sources found.
* LoD2 acquisition date and data basis (whether it was updated from ALS 2025) were not checked. Only folder dates (2026-05-29) are known.
* DOM1 2025 GeoTIFF internals were not opened; assumed identical to DGM1 (float32, nodata −9999).
* Whether `freewms/dgm` GetMap with `FORMAT=image/tiff` returns real float heights (a usable "poor man's WCS") was not tested.
* No WCS/WMTS found for Saarland DGM. One might exist in the Geoportal catalogue.
* The Nextcloud share token `NK8ndP55qAqGEZD` can change. Always resolve it through `https://www.shop.lvgl.saarland.de/cloud/freiegeobasisdaten` (302 redirect).
* Extent of the Karlsberg ruins and forest: the AOI boxes are based on OSM POIs and the shaded relief, not on a heritage register. Saarland monument protection (Denkmalschutzgesetz / Schatzregal) applies: looking is fine, digging or detecting needs permission.
* RLP LAS density and year for the border tiles were not inspected. Files are dated 2024, and the DGM1 tiles there are labelled 2022.
* No public archaeology LiDAR portal for Saarland was found.
