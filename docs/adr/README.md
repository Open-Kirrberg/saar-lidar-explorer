# 📚 Architecture Decision Records

One decision per file. **Accepted ADRs are never edited**, except the status line. A changed mind means a new ADR plus `Superseded by NNNN` on the old one. Open choices are `Proposed`. Why: [0025](0025-adrs-and-short-prd.md).

**Template:** `NNNN-kebab-title.md` → `# NNNN · emoji Title`, `- **Status:** Proposed | Accepted | Superseded by NNNN · YYYY-MM-DD`, then `## Context` · `## Decision` · `## Consequences`. Add the row below. `verify.sh` checks it.

| # | Title | Status | Date | Supersedes |
|---|---|---|---|---|
| **📡 Data & coordinates** | | | | |
| [0001](0001-lidar-sources-rlp-fill.md) | LiDAR sources: LVGL ALS 2025 + RLP fill | Accepted | 2026-11-01 | |
| [0002](0002-epsg25832-local-origin.md) | EPSG:25832 everywhere, local origin in 3D | Accepted | 2026-11-01 | |
| [0003](0003-terrarium-heights-native-grid.md) | Terrarium heights on the native grid | Accepted | 2026-11-01 | |
| [0004](0004-contract-first.md) | Contract first: `docs/data-contract.md` is binding | Accepted | 2026-11-01 | |
| **🛠️ Rendering & UI stack** | | | | |
| [0005](0005-custom-terrain-engine.md) | Custom three.js terrain engine (Giro3D = plan B) | Accepted | 2026-11-01 | |
| [0006](0006-leaflet-minimap.md) | Leaflet 1.9.4 for the 2D map | Accepted | 2026-11-01 | |
| [0007](0007-german-ui-english-code.md) | German UI, English code and docs | Accepted | 2026-11-01 | |
| **⚖️ Heritage & privacy** | | | | |
| [0008](0008-hypotheses-schauen-nicht-graben.md) | Hypotheses only — „Schauen, nicht graben“ | Accepted | 2026-11-01 | |
| [0009](0009-candidates-public-user-data-private.md) | Candidates public; markers, reviews and location private | Accepted | 2026-11-02 | v1 "candidates local only" |
| [0010](0010-craters-never-public.md) | Crater / UXO indicators are never public | Accepted | 2026-11-02 | |
| [0011](0011-castle-evidence-no-hms.md) | Castle: evidence tags, confidence, no HMS material | Accepted | 2026-11-01 | |
| **🚀 Hosting & licences** | | | | |
| [0012](0012-github-pages-release.md) | Public hosting: GitHub Pages via `scripts/release/` | Accepted | 2026-11-02 | v1 non-goal "local only" |
| [0013](0013-attribution-every-source.md) | Attribution for every source | Accepted | 2026-11-01 | |
| **🎮 v2 — game shell** | | | | |
| [0014](0014-audience-scope-devices.md) | Audience: Kirrberg public · area frozen · desktop = phone | Superseded by 0028 (reference-phone line) · Accepted | 2026-11-04 | v1 "personal tool" |
| [0015](0015-overworld-zones-portals.md) | Overworld + zones behind portals | Accepted | 2026-11-04 | |
| [0016](0016-zone-kinds-zone-contract.md) | Two zone kinds, one zone contract | Accepted | 2026-11-04 | |
| [0017](0017-real-trees-from-chm.md) | Real trees from the CHM, shared by all worlds | Accepted | 2026-11-04 | v1 F5 canopy drape |
| [0018](0018-game-look-relikt-blick-lens.md) | Game look by default, relief as the *Relikt-Blick* lens | Accepted | 2026-11-04 | |
| [0019](0019-feature-tiers.md) | Feature tiers: Standard · Entdecker · Labor · Freeze · Remove | Accepted | 2026-11-04 | |
| [0020](0020-remove-move-out-freeze.md) | Remove, move out, freeze | Accepted | 2026-11-04 | |
| [0021](0021-quests-virtual-only.md) | Quests stay virtual until a heritage partner agrees | Accepted | 2026-11-04 | |
| [0022](0022-local-first-no-accounts.md) | Local-first, no accounts | Accepted | 2026-11-04 | |
| [0023](0023-multiplayer-trystero-v4.md) | Multiplayer via Trystero in v4 | Accepted | 2026-11-04 | |
| [0024](0024-rebuild-shell-keep-core.md) | Rebuild the shell, keep the core | Accepted | 2026-11-04 | |
| [0028](0028-phone-proxy-headroom.md) | Phone proxy (Chrome, 4× CPU, 30 fps) + headroom rule (Pixel 9, 60 fps) | Accepted | 2026-11-04 | 0014 reference-phone line |
| [0030](0030-conifer-fill-trees.md) | Conifer fill trees: estimated, flagged | Accepted | 2026-11-04 | |
| [0034](0034-tree-lod-rank-prefix-dither.md) | Tree LOD: rank prefixes, dithered cross-fade, cones far | Accepted | 2026-11-04 | |
| [0026](0026-collapsed-attribution.md) | Collapsed attribution behind „© Quellen“ | Accepted | 2026-11-04 | 0013 (footer rule) |
| [0027](0027-captured-zone-method.md) | Captured zones: photogrammetry mesh first, splats later | Accepted | 2026-11-04 | |
| [0029](0029-zones-same-bundle-folder-layout.md) | Zones run in the explorer bundle; zone sources in `zones/<id>/` | Accepted | 2026-11-04 | (ends: castle as separate app + URL handover) |
| [0032](0032-shell-layout-tier-registry.md) | Shell layout and tier-gated feature registry | Accepted | 2026-11-04 | v1 Einfach layout, intro overlay |
| [0035](0035-relikt-blick-lens-channel.md) | *Relikt-Blick* as a third terrain channel; the game look leaves the relief lab alone | Accepted | 2026-11-04 | |
| [0036](0036-game-minimap.md) | Game minimap: round dial, heading-up by default, CSS rotation | Accepted | 2026-11-04 | v1 minimap header (folgen/klein/groß/Vollbild) |
| [0037](0037-zone-runtime-host.md) | Zone runtime host: shared renderer, frame ownership, built-in Testraum | Accepted | 2026-11-04 | |
| [0038](0038-first-flight-tutorial.md) | First-flight tutorial: five self-completing steps to the castle, v1 tour stays in Entdecker | Accepted | 2026-11-04 | v1 intro overlay (removed in V2.2) |
| [0033](0033-castle-module-zone.md) | Castle as module zone #1: own HUD, shared trees, triangle waiver | Accepted (waiver superseded by [0040](0040-castle-triangles-phone-viewport.md)) | 2026-11-04 | castle URL handover from the explorer, 1789/2025 switch |
| [0039](0039-capture-tool-beside-video2world.md) | Shared capture tool in `tools/capture/`; castle `video2world/` stays as HMS evidence | Accepted | 2026-11-04 | 0029 (video2world line) |
| [0040](0040-castle-triangles-phone-viewport.md) | Castle triangles within 1.5 M in the phone viewport: far crown hulls, waiver dropped | Accepted | 2026-11-04 | ADR 0033 triangle waiver (3.7 M) |
| **📚 Meta** | | | | |
| [0025](0025-adrs-and-short-prd.md) | ADRs + short PRD instead of one living PRD | Accepted | 2026-11-04 | v1 living PRD |

🧊 The 166 v1 detail decisions (thresholds, formats, UI details) are not ported. See [PRD v1 §9](../history/prd-v1.md#9-decisions-log) and the module READMEs.
