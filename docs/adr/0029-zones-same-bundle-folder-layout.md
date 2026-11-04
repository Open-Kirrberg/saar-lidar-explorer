# 0029 · 🧩 Zones run in the explorer bundle; zone sources live in `zones/<id>/`

- **Status:** Accepted · 2026-11-04
- **Origin:** V2.6 · follows [0015](0015-overworld-zones-portals.md), [0016](0016-zone-kinds-zone-contract.md)

## Context
The castle viewer is a separate Vite app today: the explorer hands the camera over by URL (`?src=explorer&E=…&back=…`) and the public build serves it under `castle/`. ADR 0015 wants zones behind a portal with a loading screen, sharing the overworld's sky and trees, and the overworld pose restored on exit. More zones will follow, both reconstructed and captured, so the repo layout must scale beyond one castle folder.

## Decision
**1. One app, one page, one renderer.** A zone is entered inside the explorer, never by navigating to another app.

| Option | Pose restore | Shared sky + trees | Phone memory | Verdict |
|---|---|---|---|---|
| 🧩 **Same bundle**, zone code as a lazy chunk (`import()`) | in memory, exact | same modules at runtime | one WebGL context; the overworld frees its GPU caches on enter | ✅ |
| 🔗 Separate app + URL handover (today) | via URL; reload drops the streamed overworld | only as copied source | two page loads | ❌ |
| 🪟 iframe | `postMessage` | no | two WebGL contexts, two three.js copies | ❌ |

- The [zone contract](../zone-contract.md) (`sle-zone-v1`) has two runtimes. **`gltf`** = data-only zones (every captured zone) rendered by the app's generic zone runtime. **`module`** = a zone with its own code (the castle generator: procedural interiors, BVH colliders, candles, Rundflug), imported lazily from the same build and selected by name only. Nothing from a package is executed.
- Both packages pin the same three.js (0.187.0). The app resolves the castle's code through a Vite/tsconfig alias. The standalone castle viewer stays the **authoring tool** (dev server 5260, tests, plans). Its public `castle/` deploy and the URL handover retire when V2.7 ships the castle as a zone.

**2. Folder layout.**
```
zones/<id>/            zone source: generator / research / authoring (one folder per zone, id = contract id)
  schloss-karlsberg/   reconstructed zone #1 (own pnpm package, moved from ./schloss-karlsberg/)
tools/capture/         captured-zone tool (video → mesh → georef → zone package), shared by all captured zones
app/src/zones/         contract loader, portal proximity, enter/exit state machine, zone runtimes
pipeline/zones.py      strict producer-side validator
<dataRoot>zones/<id>/  generated zone packages (git-ignored, never committed)
```
A captured zone needs a `zones/<id>/` folder only for committed inputs that are not media (control points, notes). Footage and meshes stay in the git-ignored `data/`.

## Consequences
- ✅ Enter and exit are instant state changes. Sky, trees and quality settings exist once.
- ✅ New captured zones need no code: one package that passes `pipeline/zones.py`.
- ⚠️ The castle code joins the app build: the castle's tsconfig, aliases and dependencies (`three-mesh-bvh`) must build inside `app/`. The lazy chunk counts against the zone budget (≤ 1.5 MB gzip).
- ⚠️ Both worlds share one tab, so the overworld must release its GPU memory on enter. Measure this on the phone proxy in V2.7.
- ➡️ `schloss-karlsberg/` moves to `zones/schloss-karlsberg/` (V2.6). `video2world/` moves to `tools/capture/` (V2.8).
