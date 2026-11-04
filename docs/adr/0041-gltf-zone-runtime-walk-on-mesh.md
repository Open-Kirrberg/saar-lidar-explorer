# 0041 · 🥖 Generic glTF zone runtime: coarse-first LODs, walking on the captured mesh

- **Status:** Accepted · 2026-11-04
- **Origin:** V2.8b (bakery = zone #2) · builds on [0037](0037-zone-runtime-host.md), [0027](0027-captured-zone-method.md), [0039](0039-capture-tool-beside-video2world.md)

## Context
Zones with `runtime.kind: "gltf"` were absent until a runtime existed ([zone contract](../zone-contract.md)). The bakery is the first one. It is a photogrammetry mesh: noisy floor, step risers, holes, mirror geometry under the shiny shop floor, no separate collider. Its scale rests on a camera-height prior (± 11 %). The phone budget allows one lazy chunk and a few MB per zone.

## Decision
| # | Rule |
|---|---|
| 1 | **One generic runtime** (`app/src/zones/runtime/gltfZone.ts`), lazy chunk, same `mountZone`/handle as module zones, `hostChrome: true` (host *Verlassen*, Esc). Every gltf zone uses it; no per-zone code. |
| 2 | **Coarse first:** the loading screen closes once every `scene` asset's coarsest LOD is drawn; finer levels load one at a time by `until_m`, and the coarse one stays drawn until the fine one is shown. A failed level is not retried. Quality `niedrig` keeps the coarsest. |
| 3 | **Collider = the coarsest drawn LOD** when the package has no `collider` asset (one BVH, `three-mesh-bvh`). Captured zones need no hand-made collider. |
| 4 | **Walk on the mesh, forgiving:** ground = first *up-facing* hit of a ray from the knees; step up ≤ 0.45 m, down ≤ 0.6 m, deeper = hole → keep the height; walls only in a body band 0.6–1.5 m above the feet. Mesh noise, risers and mirror floors then neither block nor swallow the walker. „Schweben“ turns collision off. |
| 5 | **Scale is data, not a rebuild:** `capture.scale { factor, pivotLocal }` scales assets, collider and spawn about the best-fixed point. One tape measurement fixes it. |
| 6 | **Packaging is a capture stage** (`tools/capture/run.sh <zone> package`): meshopt + quantize + KTX2 ETC1S + unlit, privacy mask spheres inpaint texels, `zone.json` + `zones/index.json` merge, strict validation. Atlas ≤ 3072² (the wasm Basis encoder fails at 4096²). |
| 7 | **KTX2 transcoder ships with the build** (Vite `?url` assets in the lazy chunk), never from a CDN. |

## Consequences
- ✅ A new captured zone is a TOML file + `run.sh`, no app code.
- ✅ The phone proxy holds 60 fps in the bakery; cold enter ≈ 2 s on 4G (numbers in `app/src/zones/README.md`).
- ⚠️ The forgiving walker lets you step over low counters' bases and walk across mesh holes at the same height — accepted for captured zones.
- ⚠️ The collider is as coarse as the reduced LOD (50 k triangles on the bakery); walls can sit a few cm off the drawn medium LOD.
- ➖ Basis wasm (≈ 250 kB gz) is fetched on the first gltf zone entry.
