# 0034 · 🌲 Tree LOD: rank prefixes, dithered cross-fade, cones far

- **Status:** Accepted · 2026-11-04
- **Origin:** V2.4b · instanced CHM trees in the overworld

## Context
[0017](0017-real-trees-from-chm.md) asks for one tree per crown, all LODs derived from a stable id, cross-fading, no popping. The overall area has 326 k trees; the phone proxy ([0028](0028-phone-proxy-headroom.md)) must hold 30 fps over forest. Options per axis:

| Axis | Options | Chosen |
|---|---|---|
| Which trees far away | random subset per frame · spatial clustering · **rank prefix** | rank = `fmix32(id)` order of the contract |
| Shape transition | alpha blend (needs sorting) · geomorph · **screen-space dither** | complementary dither |
| Far representation | impostor atlas · **low-poly cones** | cones |
| Range | fixed · **quality preset** | `canopyDistance` × 1.5 |

## Decision
- Thinning keeps the trees whose rank lies below a density `D(d)`; records are sorted by rank, so each chunk draws a **prefix** (`instanceCount`). The thinned far forest gets larger crowns (`× 1/√falloff`, capped) so its cover stays closed.
- Three instanced lathe meshes (near / mid / far) read the **same instance rows**; in each overlap band one mesh keeps a pixel where the dither value is below the blend weight and the other keeps the rest. No tree moves between LODs, every pixel comes from exactly one mesh, nothing is sorted.
- Far trees are cheap cones, no impostor textures.
- The vegetation radius follows the quality preset (`streaming.canopyDistance`, Mobil 700 m → 1050 m).
- Trees replace the F5 DSM canopy in the default look. The canopy stays in the relief lab (Labor); while it is on, the trees hide.

## Consequences
- ✅ Positions never change; pure TS twins of the shader make "no popping" unit-testable.
- ✅ No texture memory, no atlas bake; per-tree cost is one row of 32 B.
- ⚠️ Dither shows as fine grain during a transition, and in-band trees are drawn twice (vertex cost).
- ⚠️ One far draw call per chunk (≈ 100 at Hoch). Merging far tiles is the next lever if a device needs it.
- ➡️ Zones reuse `decodeTrees` and the same rank prefix for their surroundings.
