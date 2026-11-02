# 04: Cadastre (ALKIS) and historic maps, Saarland

Research date: 2026-11-01. Everything marked **tested** was run live with `curl` or Python against the services on that date. The test points were Schloss Karlsberg (≈ E 382165 / N 5466074, EPSG:25832) and Kirrberg (≈ E 382201 / N 5460957). LiDAR, DGM and DOP are covered in `01-data-sources.md` and are not repeated here.

**Short version:**
- **Vectors:** Saarland's simplified ALKIS WFS (**"WFS SL ALKIS Vereinfacht"**, `registry/wfs/414`) returns parcels as **GeoJSON in EPSG:25832**. Each parcel comes with its Gemarkung, Flur, Zähler/Nenner, Flurstückskennzeichen, Lagebezeichnung and a summary of its tatsächliche Nutzung. No owner data is included. The service sends `Access-Control-Allow-Origin: *`, and the license is dl-de/by-2-0.
- **WMS:** The INSPIRE CP WMS draws the parcels with their numbers in EPSG:3857, so it works directly as a Leaflet overlay.
- **Historic maps:** A historic-maps WMS exists, including the **Bayerische Originalpositionsblätter 1836–41**, which show "Ruine Carlsberg". It sits behind a session-cookie proxy, so the safe route is to bake it at build time.

---

## 1. What cadastral data Saarland offers, and the license

Source of the inventory: the Geoportal Saarland catalogue API (tested).
`https://geoportal.saarland.de/mapbender/php/mod_callMetadata.php?searchText=ALKIS&searchResources=wfs&outputFormat=json&maxResults=50` (and the same with `searchResources=wms` / `dataset`).

| Content | Where (tested) | License in the metadata |
|---|---|---|
| **Flurstücke** (polygons + number, Gemarkung, Flur, Kennzeichen, Lage, Nutzung summary, area) | WFS 414 `ALKIS_ALKIS_WFS_ohne_Eig:Flurstueck` | dl-de/by-2-0 |
| **Flurstück label points** | WFS 414 `…:FlurstueckPunkt` (MultiPoint) | dl-de/by-2-0 |
| **Gemarkungen + Fluren** | WFS 414 `…:Katasterbezirk` (`ART` = `Gemarkung` / `Gemarkungsteil/Flur`) | dl-de/by-2-0 |
| **Gebäude** (ALKIS footprints with function) | WFS 414 `…:GebaeudeBauwerk`; also WFS 416 `GDI_ALKIS_Gebaeude:Hausumringe` (CC BY 4.0); INSPIRE BU WMS | dl-de/by-2-0 / CC BY 4.0 |
| **Tatsächliche Nutzung** | WFS 414 `…:Nutzung`, `…:NutzungFlurstueck` (Nutzung cut per parcel) | dl-de/by-2-0 |
| **Verwaltungseinheiten** (Land … Gemeinde) | WFS 414 `…:Verwaltungseinheit` | dl-de/by-2-0 |
| INSPIRE CadastralParcel / CadastralZoning | INSPIRE WFS + WMS + Atom feed | dl-de/by-2-0 |
| ALKIS map (official SW cartography incl. Lagebezeichnungen, numbers at large scale) | WMS "ALKIS Saarland SW (Raster)" | dl-de/by-2-0 per Geoportal metadata (see conflict below) |
| ALKIS Bodenschätzung | WMS/WFS 332 | CC BY 4.0 |

The WFS 414 type names contain `ohne_Eig`, meaning "without owners". The description says the service carries only "Flurstücke, Gebäude, Tatsächliche Nutzungen, Verwaltungseinheiten, Katasterbezirke". It has no owner or Buchungsblatt data.

**Is it open?** Yes, for the services above.
- **Service metadata (tested):** The metadata for WFS 414, the INSPIRE WFS/WMS and the ALKIS SW WMS all say `Beschränkungen des öffentlichen Zugangs: noLimitations` and `Lizenz: Datenlizenz Deutschland Namensnennung 2.0, Quellenvermerk: © GeoBasis DE/LVGL-SL (Jahr)`. See for example `https://geoportal.saarland.de/mapbender/php/mod_showMetadata.php?languageCode=de&resource=wfs&id=414`.
- **Dataset metadata (tested):** The ISO dataset record "Amtliches Liegenschaftskatasterinformationssystem – Grunddatenbestand" (uuid `2cd9351d-91e0-4ddb-a678-26766a633972`) carries `{"id":"dl-de-by-2.0", … "quelle":"© GeoBasis DE/LVGL-SL (Jahr)"}`. Source: `https://geoportal.saarland.de/mapbender/php/mod_dataISOMetadata.php?outputFormat=iso19139&id=2cd9351d-91e0-4ddb-a678-26766a633972`.
- **Why it is open:** This fits the EU High-Value Datasets regulation, Implementing Regulation (EU) 2023/138, applicable since 9 June 2024. Its "geospatial" category covers cadastral parcels, buildings and administrative units, which must be free and available via API and bulk download (https://eur-lex.europa.eu/eli/reg_impl/2023/138/oj). A Saarland INSPIRE CP WMS record is tagged `HVD` + `opendata` in the GDI-DE catalogue (https://gdk.gdi-de.org/geonetwork/srv/api/records/80498756-b2b5-4eb5-121c-cfe2a89cfbc9).

**Attribution to display:**
`© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (https://www.govdata.de/dl-de/by-2-0)`. Add "Daten bearbeitet" whenever you reproject, simplify or clip, which matches the PRD line.
The INSPIRE services' `<Fees>` text gives an older variant, `"©LVGL 2022, dl-de/by-2-0, www.lvgl.saarland.de"`. Either form is fine. Use the GeoBasis-DE form so it matches the LiDAR attribution.

**License conflicts (keep in mind):**
- **ALKIS SW (Raster) WMS:** The Geoportal metadata says dl-de/by-2-0, but the service's own GetCapabilities `<Fees>`/`<AccessConstraints>` still contain the old pre-open-data text: "Einbinden in andere Anwendungen … kostenpflichtig". I treat that as stale. The INSPIRE WMS has no such conflict, so prefer it for embedding.
- **"freie Liegenschaftskarte SL":** This WMS (Geoportal id 2415, via owsproxy) has **no** open license in its metadata and carries the restrictive "kostenpflichtig" text. **Don't use it.**
- **"SL-Netz: AdV-ALKIS-WMS-SL":** These services point to an intranet host (`wapllalweb71.lkvk.saarland.de`) and are not reachable publicly.

## 2. Access services (tested)

### 2a. WFS SL ALKIS Vereinfacht, the main source (ArcGIS Server behind the Mapbender proxy)

- **Capabilities:** `https://geoportal.saarland.de/registry/wfs/414?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities`
- **Versions:** 1.0.0, 1.1.0 and 2.0.0. Paging works (`ImplementsResultPaging=TRUE`, `STARTINDEX` tested). `CountDefault` = **10000** per request.
- **Output formats:** `GEOJSON`, `GEOJSON+ZIP/GZIP`, `ESRIGEOJSON`, `GML2/3/32`, `KML`, `SHAPE+ZIP`, `CSV`, `Geopackage(+ZIP)`.
- **Filters:** FES 2.0 filters work. `PropertyIsEqualTo NAME=Kirrberg` on Katasterbezirk was tested and returned the Gemarkung. `SORTBY` returned an error.
- **CRS (important):** Only **EPSG:25832** returns features. With `SRSNAME` = EPSG:4326, 4258 or 3857, or with a BBOX given in 4326, the service returns **an empty FeatureCollection**. If `SRSNAME` is omitted, the output is labelled 4326 and is also empty. **Always pass both** `BBOX=…,urn:ogc:def:crs:EPSG::25832` **and** `SRSNAME=urn:ogc:def:crs:EPSG::25832`. This fits our pipeline, which works in 25832; for Leaflet, reproject with proj4.
- **CORS (tested):** `Access-Control-Allow-Origin: *` on GetCapabilities and on GetFeature, with `Content-Type: geojson`. This is a non-standard MIME type, so use `fetch().then(r => r.json())`, which ignores the content type.
- **Feature types:**
  - `ALKIS_ALKIS_WFS_ohne_Eig:Flurstueck`
  - `…:FlurstueckPunkt`
  - `…:GebaeudeBauwerk`
  - `…:Katasterbezirk`
  - `…:Nutzung`
  - `…:NutzungFlurstueck`
  - `…:Verwaltungseinheit`

**Test: Schloss Karlsberg, 300 × 300 m box.** It returned 15 parcels in about 0.4 s:
```
https://geoportal.saarland.de/registry/wfs/414?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=ALKIS_ALKIS_WFS_ohne_Eig:Flurstueck&BBOX=382015,5465924,382315,5466224,urn:ogc:def:crs:EPSG::25832&SRSNAME=urn:ogc:def:crs:EPSG::25832&COUNT=50&OUTPUTFORMAT=GEOJSON
```
Example properties, verbatim:
```
FLSTKENNZ '10207202205419______'  GEMARKUNG 'Bruchhof-Sanddorf'  GEMASCHL '102072'
FLUR 'Flur 22'  FLURSCHL '102072022'  FLSTNRZAE '5419'  FLSTNRNEN 'null'
GEMEINDE 'Homburg'  LAGEBEZTXT 'Am Karlsberg'  FLAECHE 31860.0  AKTUALIT '2016-03-18Z'
TNTXT 'Wald / Nadelholz;31457|Wohnbaufläche;403'   (tatsächliche Nutzung: type;m² | …)
```
Other Karlsberg parcels in the result include 5416/2 "Am Schlossberg", 5435 "Am vordersten großen Berg", 5444/3 "An der Saargebietsgrenze" (Weg) and 5394 "Herrenwald".

**Test: Kirrberg, same box size** (`BBOX=382051,5460807,382351,5461107,…`). It returned 88 parcels in Gemarkung **Kirrberg** (`102100`), Flur 7/8. Examples: 1688 "Oben am Nobelsofen" (Ackerland) and 1876/5 "An der Schützenfranzen Klamm" (Grünland).

**Other feature types in the Kirrberg box:**

| Type | Result |
|---|---|
| FlurstueckPunkt | 46 MultiPoints with the same number attributes |
| Katasterbezirk | 3 features: Gemarkung Kirrberg 102100, Flur 7 `102100007`, … |
| NutzungFlurstueck | 88 features (`NUTZART`/`BEZ`, e.g. Landwirtschaft/Ackerland) |
| GebaeudeBauwerk | 0 in that open-field box. In Homburg town it returns footprints with `FUNKTION` (e.g. "Gebäude für Wirtschaft oder Gewerbe") and `GFKZSHH` |

**Flurstückskennzeichen format:** `LL GGGG FFF ZZZZZ NNNN __`. For example, `10 2072 022 05419 0002__` is Land 10, Gemarkung 2072, Flur 022, Zähler 5419, Nenner 2. The display label is `ZAE` or `ZAE/NEN`. Note that `FLSTNRNEN` is the literal string `'null'` when a parcel has no Nenner.

**Volumes for our AOIs** (tested with paging, GeoJSON at 8-decimal precision):

| AOI | Flurstücke | Gebäude | Katasterbezirke |
|---|---|---|---|
| Karlsberg 381000–384000 / 5465000–5468000 | 2 607 (3.1 MB) | 1 704 (1.2 MB) | 14 |
| Overall 378000–384000 / 5460000–5468000 | 21 507 (25.3 MB, 3 pages) | 15 692 (11.3 MB) | 84 (2.2 MB) |

The first request took up to about 70 s (cold cache); later requests took 1–25 s. The data is small after rounding coordinates to cm and simplifying.

**OGC API Features proxy (experimental):** `https://geoportal.saarland.de/spatial-objects/414/collections/ALKIS_ALKIS_WFS_ohne_Eig:Flurstueck/items?f=json&limit=…`. CORS is `*`. `limit` must be one of 1,5,10,…,1000,2500. A WGS84 `bbox` query returned `"success": false`, the same 4326 problem as above. **Not usable**; use the WFS.

### 2b. INSPIRE CadastralParcels (deegree)

- **WFS:** `https://geoportal.saarland.de/gdi-sl/inspirewfs_Flurstuecke_Grundstuecke_ALKIS?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities`
  - Types: `cp:CadastralParcel`, `cp:CadastralZoning`.
  - CRS: EPSG:4258 (default) and 4326. Output is GML 3.2 only (no GeoJSON). Count limit 15000, **no paging**. CORS is `*`.
  - **Tested:** `…&REQUEST=GetFeature&TYPENAMES=cp:CadastralParcel&NAMESPACES=xmlns(cp,http://inspire.ec.europa.eu/schemas/cp/4.0)&BBOX=49.335,7.376,49.337,7.380,urn:ogc:def:crs:EPSG::4258&COUNT=2` returns parcels with `cp:label` "5419/2", `cp:nationalCadastralReference` "102072022054190002__", `cp:areaValue`, `cp:referencePoint` and a link to the zoning.
  - Usable, but WFS 414 is easier: GeoJSON, native 25832, richer attributes.
- **WMS:** `https://geoportal.saarland.de/gdi-sl/inspirewms_Flurstuecke_Grundstuecke_ALKIS?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities`

  | Layer | Title | Visible from | Styles |
  |---|---|---|---|
  | `CP.CadastralParcel` | Flurstücke | ≤ 1:9 500 | `CP.CadastralParcel.Default`, `default`, **`CP.CadastralParcel.LabelOnReferencePoint`** (draws parcel numbers) |
  | `CP.CadastralZoning` | Katasterbezirk (Gemarkung/Flur boundaries + numbers) | ≤ 1:20 000 | |

  - CRS: EPSG:25832, 31466, 4326, 4258, **3857**, 3035, 25833. Formats: png, gif, jpeg. GetFeatureInfo is available (html, gml, text). CORS is `*`. "Es gelten keine Zugriffsbeschränkungen".
  - **Tested GetMap in 3857**, which returns a transparent PNG with parcel lines and numbers 5417, 5450, …:
    ```
    https://geoportal.saarland.de/gdi-sl/inspirewms_Flurstuecke_Grundstuecke_ALKIS?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=CP.CadastralParcel&STYLES=CP.CadastralParcel.LabelOnReferencePoint&CRS=EPSG:3857&BBOX=820915,6331667,821715,6332467&WIDTH=512&HEIGHT=512&FORMAT=image/png&TRANSPARENT=TRUE
    ```
    `CP.CadastralZoning` renders Gemarkung/Flur outlines with labels ("2072", "022") at 2 km/1024 px. It is empty at 4 km/512 px because that is beyond its scale limit.
- **Buildings:** `https://geoportal.saarland.de/gdi-sl/inspirewms_Gebaeude_2D_ALKIS?` provides layers `BU.Building` and `BU.BuildingPart`, with 3857 available and CORS `*`.
- **Atom feed (INSPIRE predefined download):** `https://geoportal.saarland.de/mapbender/php/mod_inspireDownloadFeed.php?id=90a59e98-e97b-43f9-b8a9-6453bed1b6dd&type=SERVICE&generateFrom=wfs&wfsid=408`. It is generated from tiled WFS GetFeature calls, so it is GML only and offers nothing beyond the WFS.

### 2c. ALKIS Saarland SW (Raster) WMS (MapServer)

- **Endpoint:** `https://geoportal.saarland.de/geobasisdaten/mapserv?map=/mapfiles/geobasisdaten/Internet/alkis.map&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities`
- **Layers:**

  | Layer | Content | Visible from |
  |---|---|---|
  | `adv_alkis` | Official Liegenschaftskarte, black and white | ≤ 1:10 000 |
  | `adv_alkis_info` | | |
  | `adv_alkis_GFInfo` | | |

- CRS includes **3857**. CORS is `*`.
- **Tested:** At about 1:2 000 around Karlsberg it shows parcel numbers (5419, 5444/3), Lagebezeichnungen ("Am Schloßberg") and the text **"Ausgrabungen Schloß Karlsberg"**, which is a nice touch for us. At about 1:5 500 the parcel numbers are not shown.
- See the license conflict in §1.

### 2d. Bulk downloads (NAS / Shape / GeoPackage)

- I found **no public static bulk ZIP** of ALKIS for Saarland: no NAS/Shape files on an Open-Data share like the LiDAR Nextcloud. The ALKIS dataset metadata links to the LVGL shop (`https://www.shop.lvgl.saarland.de/`) for full NAS extracts.
- In practice, **WFS 414 is the bulk path.** It offers `OUTPUTFORMAT=SHAPE+ZIP` / `Geopackage+ZIP` / `GEOJSON+ZIP` with 10 000-feature paging, and our whole 6 × 8 km AOI is only 3 requests.
- `www.saarland.de/lvgl/...` pages sit behind a JavaScript bot challenge (HTTP 403 to curl/WebFetch), so I could not read the LVGL "verfügbare Geodatendienste" page.

## 3. Usage restrictions and rate limits

- **No owner data in any of the open services.** `ohne_Eig` = without owners; INSPIRE CP has no owners by design. Geometry, numbers, Lage and Nutzung are fine under dl-de/by-2-0, and attribution is the only obligation.
- **Rate limits:** None documented, and none hit while testing (~40 requests). Server-side limits:

  | Service | Limit |
  |---|---|
  | WFS 414 | 10 000 features/request |
  | INSPIRE WFS | 15 000 features/request, no paging |
  | WMS GetMap | max 4096 px (the historic WMS rejected 5000 px with `InvalidFormat`) |
  | OGC API proxy | limit ≤ 2500 |

  Be polite: build-time download, cached, no per-frame queries.
- **Availability:** The Geoportal reports about 96–97 % monthly availability, and the first WFS call can take over 60 s. Another reason to bake the data into static files rather than call the services live from the 3D app.
- **Cross-border caveat:** The east edge of the Karlsberg AOI is in Rhineland-Palatinate. Saarland ALKIS ends at the Land border, so parcels there would need RLP's ALKIS/INSPIRE services. Not researched here.

## 4. Recommended integration

### (a) Leaflet: WMS overlay with CORS, directly in the browser

```js
const cadastre = L.tileLayer.wms(
  'https://geoportal.saarland.de/gdi-sl/inspirewms_Flurstuecke_Grundstuecke_ALKIS?', {
    layers: 'CP.CadastralParcel',
    styles: 'CP.CadastralParcel.LabelOnReferencePoint', // parcel numbers
    format: 'image/png', transparent: true, version: '1.3.0',
    minZoom: 16, maxZoom: 22,
    attribution: '© GeoBasis-DE/LVGL-SL (2026), <a href="https://www.govdata.de/dl-de/by-2-0">dl-de/by-2-0</a>',
  });
const zoning = L.tileLayer.wms(
  'https://geoportal.saarland.de/gdi-sl/inspirewms_Flurstuecke_Grundstuecke_ALKIS?', {
    layers: 'CP.CadastralZoning', format: 'image/png', transparent: true,
    version: '1.3.0', minZoom: 15, attribution: '…same…' });
```

**Zoom thresholds:** The server computes scale from 3857 units. At zoom 16 a 256 px tile is about 1:8 500, inside the parcel limit of 1:9 500; zoom 15 is about 1:17 000. So parcels need **z ≥ 16** and zoning (1:20 000 limit) needs **z ≥ 15**. Set `minZoom` accordingly so users don't see blank tiles.

**Optional:** Add the official map look as `adv_alkis` from the MapServer endpoint (2c), at z ≥ 16 / ≤ 1:10 000.

**Alternative:** Use the baked GeoJSON from (b) as an `L.geoJSON` layer, reprojected 25832 → 4326 with proj4. You get clickable parcels and popups with Gemarkung/Flur/number/Lage/Nutzung at any zoom, plus consistent styling with the 3D view. 21k polygons are fine with the canvas renderer, or convert to PMTiles/vector tiles if needed.

### (b) Three.js: build-time WFS → GeoJSON in our local 25832 frame

**Pipeline step** (`pipeline/fetch_cadastre.py`, plain `urllib` or `requests`):

```
for T in Flurstueck FlurstueckPunkt Katasterbezirk GebaeudeBauwerk NutzungFlurstueck:
  for start in 0, 10000, 20000, … until page < 10000:
    GET https://geoportal.saarland.de/registry/wfs/414?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature
        &TYPENAMES=ALKIS_ALKIS_WFS_ohne_Eig:{T}
        &BBOX={E0-buf},{N0-buf},{E1+buf},{N1+buf},urn:ogc:def:crs:EPSG::25832
        &SRSNAME=urn:ogc:def:crs:EPSG::25832
        &OUTPUTFORMAT=GEOJSON&COUNT=10000&STARTINDEX={start}
```

Then post-process:
- **Dedupe** by `IDFLURST`/`OID`. Features crossing page boundaries can't be duplicated, but bbox-tiled fetches can.
- **Clip** to the AOI.
- **Keep only the needed attributes:** `FLSTKENNZ, GEMARKUNG, FLURSCHL, FLSTNRZAE, FLSTNRNEN, LAGEBEZTXT, TNTXT, FLAECHE`.
- **Convert to the local frame:** `x = E − E0`, `y = N − N0`, rounded to 0.01 m. No reprojection is needed, because the data is already EPSG:25832.
- **Write** `data/<aoi>/cadastre/{parcels,labels,zoning,buildings}.json`, or a compact binary, plus attribution in `manifest.json`.

**3D rendering:**
- **Lines, preferred approach:** Rasterise parcel and Flur boundaries into an overlay texture per chunk at build time, or at runtime into a canvas/RT, and sample it in the terrain shader. Line width can scale with zoom. This gives no z-fighting and no draping errors on steep relief, and it is the same mechanism as the relief textures.
- **Lines, alternative:** Real line geometry: densify polygon rings to ≤ 2–5 m segments, because forest-parcel edges can have vertices 100 m apart. Sample the DGM height per vertex, add a +0.2–0.5 m offset and use `polygonOffset`. Use `Line2`/fat lines for width.
- **Labels:** Place one label per `FlurstueckPunkt` (`ZAE[/NEN]`). Height comes from the DGM. Use troika-three-text or an SDF atlas, with a distance/zoom LOD: show Gemarkung/Flur names from `Katasterbezirk` when far away and parcel numbers only within about 300–500 m.
- **Picking:** Raycast to terrain → point-in-polygon on parcels (a 2D spatial index such as `flatbush`) → info panel with Gemarkung, Flur, number, Lage, Nutzung (`TNTXT`), area. Sync the selection to the Leaflet highlight.

**Example request URLs (tested):**
- **Parcels, Karlsberg MVP AOI** (2 607 features, 3.1 MB):
  `https://geoportal.saarland.de/registry/wfs/414?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=ALKIS_ALKIS_WFS_ohne_Eig:Flurstueck&BBOX=381000,5465000,384000,5468000,urn:ogc:def:crs:EPSG::25832&SRSNAME=urn:ogc:def:crs:EPSG::25832&OUTPUTFORMAT=GEOJSON&COUNT=10000`
- **Gemarkung/Flur boundaries, overall AOI:**
  `…&TYPENAMES=ALKIS_ALKIS_WFS_ohne_Eig:Katasterbezirk&BBOX=378000,5460000,384000,5468000,urn:ogc:def:crs:EPSG::25832&SRSNAME=urn:ogc:def:crs:EPSG::25832&OUTPUTFORMAT=GEOJSON`
- **A single Gemarkung by name** (FES filter, URL-encoded):
  `…&TYPENAMES=ALKIS_ALKIS_WFS_ohne_Eig:Katasterbezirk&SRSNAME=urn:ogc:def:crs:EPSG::25832&OUTPUTFORMAT=GEOJSON&FILTER=<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0"><fes:PropertyIsEqualTo><fes:ValueReference>NAME</fes:ValueReference><fes:Literal>Kirrberg</fes:Literal></fes:PropertyIsEqualTo></fes:Filter>`

Since the WFS has CORS `*`, a live "fetch parcels for the current view" in the browser would work. Still, bake it because of cold-start latency and availability; one data snapshot also keeps 2D and 3D consistent.

## 5. Historic maps: "WMS SL Historische Karten" (available, dl-de/by-2-0)

- **Catalogue entry:** Geoportal WMS id 2597, root layer 41884. Metadata: `https://geoportal.saarland.de/mapbender/php/mod_showMetadata.php?languageCode=de&resource=wms&id=2597` gives `noLimitations`, `Datenlizenz Deutschland Namensnennung 2.0`, `© GeoBasis DE/LVGL-SL (Jahr)`.
- **Capabilities:** CORS `*`, WMS 1.1.1 via Mapbender: `https://geoportal.saarland.de/mapbender/php/wms.php?layer_id=41884&VERSION=1.1.1&SERVICE=WMS&REQUEST=GetCapabilities&withChilds=1`
- **GetMap URL** (owsproxy): `https://geoportal.saarland.de/owsproxy/00000000000000000000000000000000/ab93f249fdcf35edf2b1d581f136b9d2?`

**Layers** (named `0`–`8`). Coverage was tested by GetMap around Karlsberg and Saarlouis.

| Name | Title | Ausgabe | Karlsberg/Homburg? |
|---|---|---|---|
| `0` | Kartenaufnahme Tranchot und von Müffling 1:20 000 | 1801–1820 | **No** (empty; covers the Prussian part, e.g. Saarlouis ✔) |
| `1` | **Bayrische Originalpositionsblätter 1:25 000** | 1836–1841 | **Yes**: shows "Ruine Carlsberg", "Carlsbergerhof", "Sanddorf", hachured relief. Highly relevant: Homburg/Kirrberg was Bavarian Palatinate |
| `2` | Preußische Generalstabskarte 1:86 400 | 1816–1847 | yes (content returned) |
| `3` | Ur-Messtischblätter 1:25 000 | 1843–1878 | **No** (empty; Prussian part only, Saarlouis ✔) |
| `4` | Karte des Deutschen Reiches 1:100 000 | 1875–1945 | yes |
| `5` | TK25 Ausgaben 1935–1940 | | yes |
| `6` | TK25 Ausgaben 1957–1965 | | yes |
| `7` | TK25 Ausgaben 1978–1982 | | yes |
| `8` | KDS 1963 (Karte des Saarlandes 1:100 000) | | yes |

**CRS:** The capabilities list 4326, 31466, 31462, 3034, 3044, 3045, 4258, 4839, **25832**, 25833, 31467 and 31463. EPSG:3857 is **not listed, but GetMap with `SRS=EPSG:3857` works** (tested).

**The catch is the proxy session.** Every owsproxy request with the `0000…` session id answers **HTTP 302** to `/owsproxy/<PHPSESSID>/…` and sets `PHPSESSID` (`SameSite=None; Secure`). It only returns an image when the cookie is sent back, which works with `curl -L -c jar -b jar`. A fresh request to the redirected URL without the cookie redirects again. A browser `<img>`/Leaflet tile on our origin depends on third-party cookies for geoportal.saarland.de. That probably works in Chrome, but is **likely to break in Safari/Firefox with tracking protection**. I found no direct (non-proxy) backend URL; guessed ArcGIS/MapServer paths returned 400.

**Recommendation for historic maps:** Bake at build time.
- **Request** GetMap per AOI directly in **EPSG:25832**, aligned to the DGM grid. Max **4096 px** per request; tile it for larger areas.
  ```
  curl -L -c jar -b jar "https://geoportal.saarland.de/owsproxy/00000000000000000000000000000000/ab93f249fdcf35edf2b1d581f136b9d2?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=1&STYLES=&SRS=EPSG:25832&BBOX=381000,5465000,384000,5468000&WIDTH=4096&HEIGHT=4096&FORMAT=image/jpeg"
  ```
  This was tested: 200 OK, a 4096² JPEG in 7.8 s, giving about 0.73 m/px. The source scan is coarser, so 2048² (≈1.5 m/px) is probably enough.
- **Save** the result as GeoTIFF/PNG + world file.
- **In three.js**, use it directly as a switchable terrain texture. It shares the 25832 frame, so no warping is needed.
- **For Leaflet**, run `gdal2tiles` to 3857 XYZ, the same path as the relief overlays.
- **Most useful layers:** `1` (1836–41, closest to the Karlsberg period: the Schloss was destroyed in 1793), `5` (1935–40, Westwall era) and `6` (1957–65).

## Recommendation

1. **Vectors:** Use **WFS 414 → GeoJSON (EPSG:25832) at build time**. Fetch Flurstueck, FlurstueckPunkt, Katasterbezirk, GebaeudeBauwerk and optionally NutzungFlurstueck for the overall AOI (about 40 MB raw, a few MB after trimming). Use them for 3D draped lines, labels and picking, and for the Leaflet GeoJSON layer.
2. **Leaflet quick win:** Add the **INSPIRE CP WMS** (`CP.CadastralParcel` + `LabelOnReferencePoint`, z ≥ 16; `CP.CadastralZoning`, z ≥ 15). It needs no build step, sends CORS `*`, supports 3857 and is clearly open.
3. **Historic maps:** Bake layers `1`, `5`, `6` (± `7`, `8`) as EPSG:25832 rasters per AOI. Reuse them as 3D textures and as XYZ tiles for Leaflet.
4. **Attribution:** `© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet`, already in the PRD; it covers cadastre and historic maps.
5. **Avoid:** "freie Liegenschaftskarte SL" (not open licensed), the SL-Netz services (intranet), and the OGC API proxy (broken bbox).

## Uncertain / unverified

- **ALKIS SW Raster WMS license:** The Geoportal says dl-de/by-2-0, but the service's own capabilities still say embedding requires a fee. I assume the capabilities text is stale. Prefer the INSPIRE WMS, or ask `vertrieb@lvgl.saarland.de` if you want the official map look.
- **Bulk ALKIS:** I could not confirm whether LVGL offers a free bulk NAS/Shape download (HVD would require one); www.saarland.de/lvgl blocks automated access. The LVGL shop may still charge for NAS extracts. Not needed for us, since the WFS covers it.
- **Historic maps in the browser:** Whether the owsproxy's cookie redirect works from a third-party origin in Leaflet is untested in a real browser (curl only). Assume it won't in Safari/Firefox.
- **Data currency:** `AKTUALIT` dates vary per feature (2016–2024). The WFS metadata showed "letzte Aktualisierung 113 Tage". This is not a live cadastre.
- **Other formats:** Only `GEOJSON` output was tested on WFS 414; `SHAPE+ZIP` and `Geopackage` are advertised but were not tested.
- **Native resolution of the historic scans** is unknown (the image looks upsampled at 0.73 m/px). Also unknown is whether coverage of layers 2/4 has gaps in our AOI; they were only spot-checked with one 4 × 4 km GetMap each.
- **RLP side** of the Karlsberg AOI (east edge): parcels and historic maps from Rhineland-Palatinate were not researched.
- **Rate limits:** None are documented. Behaviour under heavy load is unknown.

## Sources

- Geoportal Saarland catalogue API (WMS/WFS/dataset search): https://geoportal.saarland.de/mapbender/php/mod_callMetadata.php
- WFS 414 metadata: https://geoportal.saarland.de/mapbender/php/mod_showMetadata.php?languageCode=de&resource=wfs&id=414 · Capabilities: https://geoportal.saarland.de/registry/wfs/414?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities
- INSPIRE CP WFS: https://geoportal.saarland.de/gdi-sl/inspirewfs_Flurstuecke_Grundstuecke_ALKIS?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities
- INSPIRE CP WMS: https://geoportal.saarland.de/gdi-sl/inspirewms_Flurstuecke_Grundstuecke_ALKIS?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities
- INSPIRE BU WMS: https://geoportal.saarland.de/gdi-sl/inspirewms_Gebaeude_2D_ALKIS?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities
- ALKIS SW WMS: https://geoportal.saarland.de/geobasisdaten/mapserv?map=/mapfiles/geobasisdaten/Internet/alkis.map&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities
- INSPIRE CP dataset metadata: https://geoportal.saarland.de/mapbender/php/mod_dataISOMetadata.php?outputFormat=iso19139&id=90a59e98-e97b-43f9-b8a9-6453bed1b6dd
- ALKIS Grunddatenbestand metadata: https://geoportal.saarland.de/mapbender/php/mod_dataISOMetadata.php?outputFormat=iso19139&id=2cd9351d-91e0-4ddb-a678-26766a633972
- Atom feed: https://geoportal.saarland.de/mapbender/php/mod_inspireDownloadFeed.php?id=90a59e98-e97b-43f9-b8a9-6453bed1b6dd&type=SERVICE&generateFrom=wfs&wfsid=408
- Historic maps WMS metadata: https://geoportal.saarland.de/mapbender/php/mod_showMetadata.php?languageCode=de&resource=wms&id=2597 · Capabilities: https://geoportal.saarland.de/mapbender/php/wms.php?layer_id=41884&VERSION=1.1.1&SERVICE=WMS&REQUEST=GetCapabilities&withChilds=1
- GDI-DE catalogue record (HVD/opendata tags): https://gdk.gdi-de.org/geonetwork/srv/api/records/80498756-b2b5-4eb5-121c-cfe2a89cfbc9 · Atom service record: https://gdk.gdi-de.org/geonetwork/srv/api/records/f68befe3-a090-43f9-b8a9-6453bed1b6dd
- EU HVD Implementing Regulation 2023/138: https://eur-lex.europa.eu/eli/reg_impl/2023/138/oj
- dl-de/by-2-0: https://www.govdata.de/dl-de/by-2-0
