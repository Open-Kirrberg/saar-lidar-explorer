# 0033 · 🏰 Castle as module zone #1: own HUD, shared trees, triangle waiver

- **Status:** Accepted · 2026-11-04
- **Origin:** V2.7 (builds [0016](0016-zone-kinds-zone-contract.md), [0017](0017-real-trees-from-chm.md), [0019](0019-feature-tiers.md), [0020](0020-remove-move-out-freeze.md), [0028](0028-phone-proxy-headroom.md), [0029](0029-zones-same-bundle-folder-layout.md), [0037](0037-zone-runtime-host.md))

## Context
The castle viewer was a separate app with its own renderer, a URL handover and a large panel. [0037](0037-zone-runtime-host.md) gives every zone one API on the explorer's shared renderer. Five questions were still open: who draws the chrome, how the castle uses today's trees, which quality the host passes, how big a reconstructed garden may be, and what happens to the viewer's extra features.

## Decision
| # | Topic | Rule |
|---|---|---|
| 1 | 🔌 Runtime | `runtime.module: "schloss-karlsberg"`; the explorer lazy-imports `zones/schloss-karlsberg/viewer/src/zone/entry.ts` (`mountZone`). One code path with the standalone viewer, which stays the dev and authoring tool |
| 2 | 🧭 Chrome | `hostChrome: false`: the castle draws its own HUD (title, evidence badge, Gewissheit, „Verlassen“, „Schauen, nicht graben“, attribution). Esc (host) and M (castle) leave |
| 3 | 🎬 Entry | Kino look, 15 July 1789 at 17:30, **Rundflug as the entry**: any key or touch ends it and lands at the Ehrenhof spawn |
| 4 | 🎚️ Tiers | Standard: Rundflug, „Gehe zu“ (8 highlights), Fliegen/Gehen. Entdecker: + time of day, Foto, Gewissheit. Labor: + Dokumentation, all places, stats. The host forwards its tier (`setTier`) |
| 5 | ⚙️ Quality | One setting, Hoch · Mittel · Mobil. Shadows, haze, clouds, resolution and interiors fold into it, and the adaptive scale is always on. The host passes no quality, so `auto` applies: Mobil on a coarse pointer, Mittel otherwise |
| 6 | 🌳 Shared trees | With preset `trees: "shared"` the host puts a `trees` source on the mount context (the AOI `trees` layer). The castle draws a tree of today only **outside its footprint and on a 1789 forest cell**. Its species comes from the 1789 mix by its stable id [I], and its height comes from the CHM |
| 7 | 📐 Triangle waiver | The contract allows 1.5 M triangles. The castle declares a **3.7 M ceiling**, a fence in the castle export (`TRIANGLES_WAIVER`) and in the app test. Measured: up to 3.63 M in view during the Rundflug, mostly garden crowns, and 0.9–1.9 M indoors. Until crown impostors bring it under 1.5 M, the gate is the phone proxy at 30 fps (`pnpm run perf:zone`) |
| 8 | 📦 Size | The zone package ships 1789 only. Terrain is u16 (5 mm steps), textures are 1024²/512², and the catalogue sits in its own chunk. Download ≈ 18.7 MB; the module is ≈ 0.5 MB gzip |
| 9 | 🗑️ Removed / 🧊 frozen | Removed: the 1789/2025 switch, Vollmondnacht and the separate render toggles. Frozen, with code kept but no UI: festivals, plan sheets and glTF export. The URL handover (`?src=explorer`) stays standalone-only |

## Consequences
- ✅ One renderer and one GL context. Leaving restores the overworld bit-exact (renderer state, camera, hash).
- ✅ The trees of today and the 1789 garden don't overlap; a conifer of today is shown as a broadleaf of 1789 because it is a hypothesis.
- ⚠️ The phone proxy is within budget during the Rundflug and at spawn. The Festsaal walk is not stable: 27–56 fps in two runs. The first visit to a place stalls for 0.2–4.8 s on shader compiles and synchronous LOD2 builds. Fix in the castle backlog.
- ⚠️ The castle patches three's global `lights_fragment_begin` chunk (far shadow). This is inert for the overworld today, but a second shadow-casting sun there would break it.
- ⚠️ Triangles over the contract are a declared exception, not a precedent. The bakery gets no waiver.
