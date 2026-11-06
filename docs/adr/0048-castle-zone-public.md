# 0048 · 🏰 Castle zone goes public: zone package in the release export, portal replaces the handover

- **Status:** Accepted · 2026-11-06 · amends the retirement line of [0029](0029-zones-same-bundle-folder-layout.md) (the `/castle/` deploy stays for now)
- **Origin:** release follow-up to V2.7 (builds [0029](0029-zones-same-bundle-folder-layout.md), [0033](0033-castle-module-zone.md), [0037](0037-zone-runtime-host.md), [0043](0043-built-twin-package-reference-nav.md))

## Context
Locally the castle is zone #1: portal, loading bar, Rundflug, exact pose restore on exit. The public build already contains the castle module chunk, but the public data had only the bakery in `zones/index.json`. `release.env` said "the castle is public through its own viewer (/castle/)", so the export never staged it. The explorer therefore still offered the v1 URL handover „Schloss betreten“ (key T) to the standalone viewer. Locally both entrances were offered side by side: the zone portal and the handover button (with the reconstruction layer on and the camera near the castle).

The castle package (`pnpm run export:zone`) is a `module` zone. Its `zone.json` lists no assets, because the module fetches its files by convention below its base URL. The export's zone policy only staged files that `zone.json` references, so it had nothing to stage for the castle.

## Decision
| # | Rule |
|---|---|
| 1 | 📦 **Export:** `schloss-karlsberg` joins `PUBLIC_ZONE_POLICY` with an exact `moduleFiles` list: `terrain/{meta.json, dtm1789.u16.deflate, ground.u8.deflate}` + `textures/<set>/{diff,nor_gl,arm}.jpg` for the 8 Poly Haven CC0 sets of `viewer/textures.json` (a test pins the match and the CC0 licence). Each file must exist, and only a `module` zone running its own module may use the list. Other files under `terrain/` and `textures/` stay local. `RELEASE_ZONES` defaults to `schloss-karlsberg,baeckerei-heusser`. |
| 2 | 🛡️ **Guards:** image files are staged only when the policy allows images (castle yes, bakery no). Only JPEGs are allowed, and their metadata segments (APPn/COM) are scanned for local paths, the private folder and e-mail addresses. Deflated binary grids carry no text and are not scanned. `zone.json` and `meta.json` are scanned as JSON, as before. |
| 3 | 🚪 **One way in:** while the zone index offers the castle zone (its portal is in `zonePortals()`), the reconstruction card hides „Schloss betreten“ / „zu Fuß“ and the toolbar button. T then only shows the hint „über das Portal … (Taste E)“, and inside a zone it does nothing. The same rule applies locally. |
| 4 | 🛟 **Fallback:** without the castle zone (index missing, zone absent, zone portals not mounted), the handover works as before. Pages keeps building `/castle/` and keeps `VITE_VIEWER_URL`, so a stale or partial data push still has a way into the castle, and old `/castle/` links keep working. Retiring the standalone deploy is a separate step, once the zone has run publicly for a while. |

## Consequences
- ✅ Public = local: portal, loading bar, Rundflug and exact restore on exit, with the overworld's sky and trees.
- 📏 Size: the package is 27 files plus `zone.json`, 7.95 MB (terrain 2.58 MB, textures 5.37 MB). The module chunk is ≈ 0.38 MB gzip and the catalogue chunk ≈ 0.10 MB gzip. First download ≈ 8.4 MB, which replaces the ≈ 18.7 MB estimate in 0033 row 8. `saar-lidar-data` grows by ≈ 8 MB, far below the Pages limits (≤ 1 GB per site, < 100 MB per file).
- ⚖️ Licences: terrain is dl-de/by-2-0 (processed, 1789 = hypothesis), textures are Poly Haven CC0 (downscaled), and the footprint is derived partly from the Lageplan 2006 (CC BY-SA 2.0 DE, as `shared/karlsberg1789/`). The `zone.json` attribution covers all of them, and the castle HUD shows it.
- ⚠️ The castle's terrain is now public twice: `castle-viewer/terrain/` (2025 + 1789, for the `/castle/` build) and `zones/schloss-karlsberg/terrain/` (1789, u16). That is ≈ 2.6 MB extra until `/castle/` retires.
- ➡️ Release order stays data first: export `--zones-only`, push `saar-lidar-data`, then push the code.
