# 0026 · ©️ Collapsed attribution behind „© Quellen“

- **Status:** Accepted · 2026-11-04 (supersedes the footer rule of [0013](0013-attribution-every-source.md))
- **Origin:** v2 workshop · PRD open question Q-33

## Context
The 3-line attribution footer eats the game view, especially on phones. Do dl-de/by-2-0 and ODbL allow showing it briefly and then behind a button?

## 🔎 Research
| Source | What it says | Verdict |
|---|---|---|
| **dl-de/by-2-0** §2 ([govdata.de/dl-de/by-2-0](https://www.govdata.de/dl-de/by-2-0)) | „Bei der Nutzung ist sicherzustellen, dass folgende Angaben als Quellenvermerk enthalten sind: 1. Bezeichnung des Bereitstellers nach dessen Maßgabe, 2. der Vermerk „Datenlizenz Deutschland – Namensnennung – Version 2.0“ oder „dl-de/by-2-0“ mit Verweis auf den Lizenztext unter www.govdata.de/dl-de/by-2-0 sowie 3. einen Verweis auf den Datensatz (URI).“ §3: changes must carry „den Hinweis …, dass die Daten geändert wurden“. | ✅ Says **what** the Quellenvermerk contains, nothing about placement or permanent visibility. A one-click dialog is fine. ⚠️ Item 3 (dataset URI) is missing today. The dialog adds it. |
| **LVGL Saarland** (Geoportal metadata, see [docs/research/04](../research/04-cadastre-historic-maps.md)) | Quellenvermerk „© GeoBasis DE/LVGL-SL (Jahr)“ | ✅ Wording only, no placement rule. |
| **LVermGeo RLP** (GDI-DE catalogue metadata) | „©GeoBasis-DE / LVermGeoRP ‹Jahr des Datenbezugs›, dl-de/by-2-0, http://www.lvermgeo.rlp.de [Daten bearbeitet]“. The 2016 terms ask for a „deutlich sichtbar“ note, but those terms predate the open-data licence. | ✅ Under dl-de the wording is what binds. The splash covers „sichtbar“ anyway. |
| **OSMF Attribution Guidelines** (adopted 2021-06-25, [osmfoundation.org/wiki/Licence/Attribution_Guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)), *Interactive maps* | Attribution may be faded or collapsed „immediately with a dismiss interaction, for example clicking an ‘x’…“, „automatically on map interaction such as panning, clicking, or zooming“, or „automatically after five seconds. This also applies to splash screens or pop-ups.“ After collapsing, the licence must stay reachable, e.g. „from an ‘(i)’ button in the corner of the map or an ‘About’ option in a menu“. | ✅ This is exactly our variant. |
| OSMF guidelines, *Computer games and simulations* | Attribution „can be provided either by a splash screen on application startup, in the game view, during gameplay…“. The splash must give „the typical viewer … time to comprehend“. „Detailed information must be provided in a suitable location.“ | ✅ Splash plus detail dialog. |

**Verdict: compliant.** The pre-approved variant is accepted.

## Decision
| # | Rule |
|---|---|
| 1 | **On load:** a splash strip in the 3D view shows the **short line** (table below, column *Kurz*) for every source in the current manifest, plus „Schauen, nicht graben“. Text ≥ 12 px, WCAG AA contrast, no truncation (wrap instead). |
| 2 | **Collapse** after **8 s**, or earlier on „×“. Map/flight interaction does **not** collapse it during the first 5 s. Reload shows it again. No „never show again“ option. |
| 3 | **Collapsed:** a „© Quellen“ button stays in a corner of the 3D view, always visible, ≥ 44 px touch target, never hidden by tiers, HUD modes or the lens. |
| 4 | **Dialog** („Quellen und Lizenzen“): one row per source with provider, short line, licence name **linked** to the licence text, dataset URI (link), „Daten bearbeitet“ where it applies, and what we use it for. Then the reuse note ([NOTICE.md](../../NOTICE.md)) and „Schauen, nicht graben“. Built from `manifest.attribution` plus app constants, so a new source shows up without UI work (rule of 0013 stays). |
| 5 | **Minimap:** the Leaflet attribution control stays on, with „© OpenStreetMap“ linked to `openstreetmap.org/copyright`. Its full Leaflet text may collapse to „© OSM“ + ⓘ only on phones (≤ 480 px). |
| 6 | **Zones** (castle, bakery) use the same button and dialog with their own source rows (e.g. HYG, Poly Haven). Burned-in exports (castle photo) keep their full attribution band. |

### Attribution strings (implement from this)
| Source | Kurz (splash) | Full Quellenvermerk (dialog) | Licence link | Dataset URI |
|---|---|---|---|---|
| LVGL-SL DGM/DOM/ALS 2025 | © GeoBasis-DE/LVGL-SL (2026) | © GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet | govdata.de/dl-de/by-2-0 | shop.lvgl.saarland.de (Freie Geobasisdaten) |
| LVGL-SL DOP20 | ″ | © GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (DOP20) | ″ | ″ |
| LVGL-SL LoD2 | ″ | © GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet (LoD2) | ″ | ″ |
| LVGL-SL ALKIS / INSPIRE CP | ″ | © GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (ALKIS) | ″ | geoportal.saarland.de (WFS 414, INSPIRE CP WMS) |
| LVGL-SL Historische Karten | ″ | © GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet (Historische Karten) | ″ | geoportal.saarland.de (WMS 2597) |
| LVermGeo RLP DGM/DOP/LoD2/ALKIS | © GeoBasis-DE/LVermGeoRP | © GeoBasis-DE/LVermGeoRP (‹Jahr›), dl-de/by-2-0, www.lvermgeo.rlp.de, Daten bearbeitet (‹Layer›) | ″ | geobasis-rlp.de/data |
| OpenStreetMap (data + minimap tiles) | © OpenStreetMap | © OpenStreetMap-Mitwirkende, ODbL. Kacheln: OpenStreetMap, CC BY-SA 2.0 | openstreetmap.org/copyright | openstreetmap.org |
| OpenTopoMap (minimap option) | (only when active) | Darstellung: © OpenTopoMap (CC BY-SA 3.0), SRTM | opentopomap.org | opentopomap.org |
| Castle: Lageplan 2006 | (castle zone) | Grundrisse teils nach Lageplan 2006, schloss-carlsberg.de, CC BY-SA 2.0 DE | creativecommons.org/licenses/by-sa/2.0/de | Wikimedia Commons file |
| Castle: HYG 4.4 | (castle zone) | Sterne: HYG 4.4 (D. Nash, astronexus), CC BY-SA 4.0 | creativecommons.org/licenses/by-sa/4.0 | codeberg.org/astronexus/hyg |
| Castle: textures | — | Texturen CC0 (Poly Haven, ambientCG) | creativecommons.org/publicdomain/zero/1.0 | polyhaven.com, ambientcg.com |
| Software | — | Leaflet (BSD-2), three.js (MIT) | — | — |

Strings for the pipeline sources come verbatim from `manifest.attribution` (pipeline constants), not from this table. The table explains them.

## Consequences
- ✅ The game view is free after 8 s. The licence information stays one click away and is more complete than the footer was (licence links + dataset URIs per dl-de §2 Nr. 3).
- ⚠️ The RLP year is inconsistent in the pipeline (`ATTRIBUTION_RLP` says 2022 = tile year, the other RLP strings say 2026). The provider asks for the year of retrieval („Jahr des Datenbezugs“), which is 2026. Fix this in the pipeline, not here.
- ⚠️ This is research, not legal advice. If a provider objects, go back to the visible footer (0013) for that source.
