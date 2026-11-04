# 0037 · 🔌 Zone runtime host: shared renderer, frame ownership, built-in Testraum

- **Status:** Accepted · 2026-11-04
- **Origin:** V2.6b (builds [0015](0015-overworld-zones-portals.md), [0016](0016-zone-kinds-zone-contract.md), [0029](0029-zones-same-bundle-folder-layout.md), [0032](0032-shell-layout-tier-registry.md))

## Context
[0029](0029-zones-same-bundle-folder-layout.md) puts zones in the explorer bundle as lazy chunks. Still open: how a chunk gets the screen and the input, how the overworld comes back exactly, which key enters, and what to enter before the castle (V2.7) and the bakery (V2.8) exist. The only fixture package (`tests/fixtures/zones/fixture`) uses the `gltf` runtime, and no gltf runtime exists yet.

## Decision
| # | Rule |
|---|---|
| 1 | **One API for every zone module:** `mountZone(ctx) → { enter(spawn), frame(dt), resize, exit(), dispose() }` on the explorer's **shared** `WebGLRenderer` (one GL context, phone-safe). Spec: [zone contract → Runtime API](../zone-contract.md#-runtime-api-v26b). |
| 2 | **Frame ownership:** while a zone runs, `ctx.setFrameOwner(fn)` replaces the whole overworld frame (controller, streaming, hooks, render, store sync). The overworld is frozen, not rebuilt, so restoring is a bit-exact `setPose` of the saved rig. |
| 3 | **Host chrome by default:** the host draws title, evidence badge, „Verlassen“, disclaimer + attribution; a zone may opt out (`hostChrome: false`). Esc always leaves. |
| 4 | **E = „Betreten“ only while a portal is offered** (it overrides climb there; Space still climbs). No auto-enter ([zone contract](../zone-contract.md#-enter-and-exit)). |
| 5 | **Built-in Testraum** (`runtime.module: "testraum"`, procedural, no data) is the enterable fixture: dev builds, `?aoi=fixture`, `?testraum`. Not offered on the public build otherwise. |
| 6 | **`gltf` zones stay absent** until a gltf runtime is registered (with the bakery); the contract tolerance rule covers it. |

## Consequences
- ✅ V2.7 registers the castle with one line in `ZONE_MODULES`; the castle's own `ZoneHandle` is assignable to the explorer's.
- ✅ Enter, leave, cancel and failure share one teardown path, unit-tested with injected ports.
- ⚠️ Overworld GPU caches stay resident in a zone (allowed by the contract, not done). If phone memory gets tight, free them on enter.
- ⚠️ No deep link into a zone yet: the URL hash keeps the overworld view.
