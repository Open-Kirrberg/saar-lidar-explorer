# 📝 Changelog

One line per shipped item, newest first. Details go in commits and module READMEs; decisions in [ADRs](docs/adr/README.md). Long-form entries up to 2026-11-04: [PRD v1 changelog](docs/history/prd-v1.md#changelog).

| Date | Version | What |
|---|---|---|
| 2026-11-05 | twin | 🥖 Bäckerei Heusser round 2: *Raumplan* v0 (public, redacted; private facts only in the private folder), built stylised shell + street context from the plan, walker on an exact nav floor, capture as hidden `reference` asset (ADR 0043) |
| 2026-11-05 | twin | 🥖 Bäckerei Heusser becomes a built digital twin: `zones/baeckerei-heusser/` (catalogue + schema + check, style rules, plan/variants stubs, 4 `bh-*` skills), zone id `bakery` → `baeckerei-heusser`, private passage end cropped from the capture (ADR 0042) |
| 2026-11-04 | V2.8 | 🥖 Bäckerei Heusser as zone #2: capture tool `tools/capture/` (video → blurred frames → mesh → georeferenced zone package, ≈ 1.15 h per zone) + generic glTF zone runtime, walk on the captured mesh (ADR 0027, 0039, 0041) |
| 2026-11-04 | perf | ⚡ Phone-proxy pass: castle Festsaal stall gone, castle under 1.5 M triangles, cold enter 18 s, ortho sharpness by screen need (ADR 0040) |
| 2026-11-04 | V2.7 | 🏰 Schloss Karlsberg as zone #1 behind its portal: 1789 only, Kino look, Rundflug entry, „Gehe zu“ 8 highlights, shared CHM trees, one quality setting (ADR 0033) |
| 2026-11-04 | V2.9 | ✨ First-flight tutorial (5 self-completing steps to the castle, `pnpm run first-run` walkthrough) + RLP attribution year 2026 and dataset links in „© Quellen“ (ADR 0038) |
| 2026-11-04 | V2.5 | 🔍 Game look (aerial ground) + *Relikt-Blick* lens: trees fade, relief blends in, candidates glow; variants + *Zeitreise* in Entdecker; *Merken* with a private note (ADR 0035) |
| 2026-11-04 | V2.2 | 🎛️ Shell polish: *Steuerung* + *Einstellungen* as corner buttons under the minimap, lighter tempo chips, HUD with compass tape and icon row |
| 2026-11-04 | V2.4 | 🌲 Real trees from the CHM: `sle-trees-v1` layer (326 010 trees, plot counts within ±6 %), instanced overworld trees with rank-prefix LOD + dither cross-fade, „Bäume“ switch (ADR 0030, 0034) |
| 2026-11-04 | V2.6 | 🚪 Zone contract `sle-zone-v1`, castle moved to `zones/`, portals + loading screen + *Testraum*, pose restored on exit (ADR 0029, 0037) |
| 2026-11-04 | V2.3 | 🧭 Game minimap: round player-centred dial, view cone, heading-up / north-up, full-screen map (ADR 0036) |
| 2026-11-04 | V2.2 | 🧹 New game shell: tiers Standard / Entdecker / Labor, *Gehen* mode, *Steuerung* dialog, „© Quellen“ (ADR 0026, 0032) |
| 2026-11-04 | V2.0 | 📏 Baseline on the phone proxy (Chrome, 4× CPU, 4G) + `pnpm run perf`; ADR 0028 proxy + Pixel 9 headroom rule |
| 2026-11-04 | V2.1 | 🗑️ AOI switcher, HUD key list, prod debug panel, canopy collision, 3D Flurstücke, *Dunst* removed; *Mein Standort* + point cloud frozen; F21 → `sle-print`, F22 → private repo; bundle guard against crater/print code |
| 2026-11-04 | docs | 📚 PRD split into ADRs 0001–0027, a short PRD and this changelog; v2 vision recorded (ADR 0014–0024); v1 PRD and roadmap frozen in `docs/history/` |
| 2026-11-03 | castle | 🏰 Waves 10–11: paintings, HYG night sky, July field mosaic, garden-front relief, candle light |
| 2026-11-03 | F21 | 🖨️ Kirrberg showpiece tile `kirrberg-11050` (1:11050, engraved title) |
| 2026-11-02 | F21 | 🖨️ LoD2 buildings in print tiles; filament-saving slicer hint (−24…−55 %) |
| 2026-11-02 | v1.5-local | 💣 F22 crater / crater-field review merged to `main`, private; UXO leak in the release export fixed |
| 2026-11-02 | v1.4.2 | 🖨️ Print tiles fit the Bambu Studio GUI (1:9200 / 1:2300, centred) |
| 2026-11-02 | v1.4.1 | 🩹 Favicon, planner labels, „Über & Datenschutz“ dialog |
| 2026-11-02 | v1.4 | 🚀 Public release on GitHub Pages (Open-Kirrberg), candidates included |
| 2026-11-01 | v1.3 | 🖨️ F21 3D-Druck: joinable 3MF tiles for the Bambu P1S + app planner |
| 2026-11-01 | v1.2 | 📱 F20 mobile: touch gestures, *Einfach* layout, *Mobil* quality, *Mein Standort*, HTTPS LAN dev |
| 2026-11-01 | v1.1 | 🏰 F19 Schloss Karlsberg 1789 reconstruction in the explorer + *Betreten* |
| 2026-11-01 | v1.0.1 | 🩹 Audit fixes (quadtree sibling eviction, footer layout, …) |
| 2026-11-01 | v1.0 | ✨ Polish: settings, share, intro + tour, quality presets, a11y, offline packaging |
| 2026-11-01 | v0.12 | ☁️ F16 point clouds for the focus areas (`sle-pts-v1`) |
| 2026-11-01 | v0.11 | 🔍 F15 relict candidates, F17 measuring, F18 report export |
| 2026-11-01 | v0.10 | 🏠 F11 LoD2 buildings, F13 orthophoto, F14 historic maps |
| 2026-11-01 | v0.9 | 🗺️ F9 `overall` AOI (6 × 8 km) with overview levels + quadtree streaming |
| 2026-11-01 | v0.8 | 🛤️ F10 OSM ways + F12 Flurstücke in 3D |
| 2026-11-01 | v0.7 | 🔧 R0 hardening (local relief, canopy, import, hash, LOD cracks, manifest merge) |
| 2026-11-01 | v0.6 | 🎉 MVP: relief lab, forest, Leaflet minimap, find markers, disclaimer |
| 2026-11-01 | v0.5 | 🛫 M0 pipeline + M1 first flight |
| 2026-11-01 | v0.1–0.4 | 📋 Skeleton, research, data sources, cadastre and historic maps resolved |
