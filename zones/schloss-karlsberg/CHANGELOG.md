# 📝 Changelog — Schloss Karlsberg

One line per shipped item, newest first. Numbers and details go in the commit message; decisions in the [ADRs](../../docs/adr/README.md). Long-form entries up to 2026-11-03: [docs/history/readme-v1.md](docs/history/readme-v1.md#changelog).

| Date | Item | What |
|---|---|---|
| 2026-11-04 | KB-I106 | ⚡ No first-visit hitch: walk colliders cached per tile and building, interiors, colliders and shaders warmed behind the loading screen; package 19.7 → 9.5 MB (deflated predicted terrain), byte progress while loading |
| 2026-11-04 | KB-I105 | 🌳 Far garden crowns as 70-triangle hulls with leaf-cluster relief; forest tiers and fringe cards only in view: Rundflug 2.8 → 1.4 M triangles, waiver dropped ([ADR 0040](../../docs/adr/0040-castle-triangles-phone-viewport.md)) |
| 2026-11-04 | KB-I103 | 📱 Phone proxy ≥ 30 fps in the Rundflug, at the spawn and on the Festsaal walk (58–60 fps, max frame after „Gehe zu“ 317 → 33 ms) |
| 2026-11-04 | KB-I104 | 🏰 Zone #1 of the explorer: `zone.json` + `export:zone` package, `mountZone` on the shared renderer, Rundflug entry, today's CHM trees outside the footprint ([ADR 0033](../../docs/adr/0033-castle-module-zone.md)) |
| 2026-11-04 | KB-I101 | 🎚️ UI by tiers: 1789 only, 8 „Gehe zu“ highlights, Gewissheit, one quality setting, Kino default; Vollmondnacht removed, festivals frozen |
| 2026-11-04 | docs | 📚 README 1 524 → ≈ 70 lines, this changelog, backlog trimmed to open items; long forms frozen in `docs/history/` |
| 2026-11-03 | cleanup | 🧹 Final cleanup after wave 11; improvement rounds paused |
| 2026-11-02 | wave 11 | 🕯️ Garden-front relief, room hierarchy, carved heads; candle-lit rooms at night; HYG star table; field trees in context |
| 2026-11-02 | wave 10 | 🌙 Audit pass: real moon of July 1789, cumulus + cloud shadows, procedural paintings, mixed plinth stone, Petri lawn vs hay meadow |
| 2026-11-02 | wave 9 | 🪞 Window pull + mirrors indoors, night-sky seam, pond shores in the terrain, Petri framing groups, CdL perron |
| 2026-11-02 | wave 8 | 🎆 Festbeleuchtung mode, far shadow map, fences, Pavillon zu Carlsberg, Hemmer masts, low-sun warmth |
| 2026-11-02 | wave 7 | 🎬 Kino golden hour, interior mapping behind windows, int16 light layer (5.9 → 4.1 MB), vineyard |
| 2026-11-02 | wave 6 | ✨ Post chain (AO, MSAA, SSR water), leaf cards, Fachwerk, Orangerie, Menagerie, follies |
| 2026-11-02 | wave 5 | 🌳 State-room finishes, named room colours, parterre à l'angloise, Rundflug, photo mode, night |
| 2026-11-02 | wave 4 | 🏛️ Retina terrain-cost fix, Biberschwanz roofs, Hemmer rods, Ehrenhof furniture, gallery rotunda, room programme |
| 2026-11-02 | wave 3 | 🪟 Facade truth: palette, French casements, plain wings, limewash variation, baked AO, clump-crown trees |
| 2026-11-02 | wave 2 | 🌾 1789 land cover instead of today's forest, forest LOD tiles, tree species, Petri's Herzogsgarten, axial basin |
| 2026-11-02 | waves 0–1 | 💡 Pose hooks, catalogue fact fixes, 1789 epoch, shadow cache, quality presets, calibrated light, height fog |
| 2026-11-01 | integration | 🔗 Explorer light layer `sle-recon-v1` + camera handover both ways |
| 2026-11-01 | fix round 1 | 🔧 Review 1: 20 of 22 issues (Orangerie wall, parterre height, 1789 terrain aprons, …) |
| 2026-11-01 | phases 1–4 | 📋 Research 01–08, catalogue v2, generator, viewer, 30 plan sheets |
