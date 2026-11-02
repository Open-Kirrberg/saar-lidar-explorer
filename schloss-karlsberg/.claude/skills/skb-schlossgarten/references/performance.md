# Vegetation and garden performance

**Target:** 60 fps on an Apple M5 Pro in the worst realistic view, which leaves headroom for weaker M-series chips (a base
M1/M2 GPU has about a third to a quarter of the throughput [I], visual-audit §2). Garden work may add at most **+0.5 M
triangles net at view-west** (research/11 §6.4). Opening the landscape should make the scene *cheaper*.

## Measured baseline (2026-11-02, headless Chrome on M5 Pro, `scripts/garden-shots.mjs --bench`)

| Pose | Rendered triangles | Calls | GPU ms at 1080p (±50 %) |
|---|---|---|---|
| 01 view-west | 4.36 M | 820 | 4.4–5.5 |
| 02 view-east | 4.25 M | 764 | 5.5 |
| 03 Herzogsgarten eye | 4.52 M | 599 | 2.6 |
| 07 view-karlslust | 3.72 M | 320 | 5.9 |
| view-west **without the forest** | 1.41 M | 812 | 3.4 |

Vegetation instances (`VEG_STATS` in `verification.md`):

| Group | Trees | Triangles | Max bounding radius |
|---|---|---|---|
| `forest/forest/*` (trunks + 3 crown variants) | 28,381 | ≈ 1.48 M | ≈ 2.16 km |
| `site/trees/tilia` | 251 | 103 k | 516 m |
| `site/trees/malus` | 152 | 63 k | 309 m |
| `site/trees/citrus` | 32 | 1.7 k | 27 m |

`VEG_STATS` counts instances of trunks *and* crowns, so its `instances` value is twice the tree count for site trees. A
tree costs 12 trunk triangles plus 40 crown triangles (`detail: 0`: forest, citrus) or 400 (`detail: 1`: tilia, malus,
aesculus).

At full retina (3024 × 1964) aerial views took 13–21 ms GPU, so they already miss 60 fps (visual-audit §3). Lighting and
post work will add cost, so vegetation has to give time back.

## Why the forest is expensive

- `treeMeshes` builds one InstancedMesh per crown variant across the **whole** crop, so each bounding sphere is about
  2.15 km. three.js culls per object, never per instance, so the full forest is always drawn.
- All instances have `castShadow = true`, so the forest is drawn again into the 4096² sun shadow map every frame (the
  shadow map is not cached, visual-audit P2).
- The crowns are 40 triangles each (2 lobes, `detail: 0`), drawn at full detail even 2 km away. The avenue species use
  400-triangle crowns (5 lobes, `detail: 1`) at every distance.

## Rules and recipes

1. **Tile the instances.** Bucket the tree positions into 256–512 m cells and build one InstancedMesh per (cell, species,
   variant). Call `computeBoundingSphere()` per tile. This works with plain three r187 and needs no new dependency. The
   alternative is `@three.ez/instanced-mesh` 0.3.16 (`InstancedMesh2`, per-instance BVH culling plus LOD and shadow LOD),
   pinned exactly and with the reason stated in the commit (visual-audit §5.6, §7).
2. **Distance LOD.**
   - Near (< 150 m): richer crowns, leaf cards later (visual-audit P10), stakes on young trees, box edgings, bench detail
     and vineyard stakes.
   - Mid (150–400 m): today's lobed crowns, and 2-lobe crowns for shrubs.
   - Far (> 400–600 m): octahedral impostors (one quad per tree) or just the splat colour. Clumps beyond about 600 m can
     become splat colour (research/11 §6.4).
3. **Shadows.** Only tiles inside the near shadow box cast shadows. Far tiles set `castShadow = false` and still receive.
   Re-render the shadow map only on an hour change or when the shadow frustum moves (visual-audit P2, owned by
   `skb-visual-wow`; coordinate with it).
4. **Instance counts.** S1 removes most of the forest near the core. Shrub clumps add many small instances: 12–20 clumps
   of 10–40 plants is a few hundred instances, which is cheap if instanced per species. Vineyard stakes at 1.1 × 1.0 m on a
   1 ha strip are about 9,000. Draw them only near the camera, or as the stripe splat at LOD1 (S10).
5. **Hedges, walls, basins.** `GeoBuilder.toMeshes` merges every feature's boxes into one mesh per material for the
   whole site, so draw calls stay low, but the merged mesh is never culled either. Keep near-only detail (box edgings,
   bench slats, stakes) out of these site-wide buckets: build it per zone or instanced, with a distance switch. Avoid
   hundreds of tiny segments: the current 3 m hedge segments only exist so the hedge can be clipped to the polygon.
6. **Water.** Planes are cheap. A reflector (`Water`, `Water2`) costs one extra scene render each: use it only near and in
   view, or use a static cube capture per pond (visual-audit §5.7, P15).
7. **Wind.** Animate it in the vertex shader (bend by height, flutter by a per-instance phase). Never update instance
   matrices per frame.
8. **CPU at load.** The `Forest` placement (`viewer/src/forest.ts`) runs on the main thread at start-up. If the instance count rises (more species, edge
   mantle), keep the placement pure and O(n), and consider building per tile lazily.

## Measure, don't guess

Use `skb.gpuBench(20, [1920, 1080])` for GPU ms (EXT_disjoint_timer_query_webgl2), and `skb.triangles()` with
`renderer.info.render.calls` for load. Headless GPU timings vary by ±50 %. Compare before and after **in the same run**,
or run both 3 times and report the range. Always report triangles and calls too, because they are deterministic.
