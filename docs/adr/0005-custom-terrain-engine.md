# 0005 · 🛠️ Custom three.js terrain engine (Giro3D = plan B)

- **Status:** Accepted · 2026-11-01
- **Origin:** [PRD v1 §5, §9](../history/prd-v1.md#9-decisions-log) · `research/02`

## Context
Relief shading needs full control over the shaders, the height decoding and the flight. Off-the-shelf globes resample.

## Decision
- A custom engine in `app/src/terrain`: 500 m chunks, quadtree LOD with overview levels, skirts, LRU streaming with a GPU budget.
- Pinned stack: Vite 8, TS 7, three r187.
- Giro3D stays plan B.

## Consequences
- ✅ Exact heights, one shader for all layers, and the game look is possible ([0018](0018-game-look-relikt-blick-lens.md)).
- ⚠️ We own LOD cracks, streaming and memory budgets.
