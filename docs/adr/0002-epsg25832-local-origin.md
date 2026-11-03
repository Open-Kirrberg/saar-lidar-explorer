# 0002 · 🧭 EPSG:25832 everywhere, local origin in 3D

- **Status:** Accepted · 2026-11-01
- **Origin:** [PRD v1 §5, §9](../history/prd-v1.md#9-decisions-log) · `research/02`

## Context
Raw UTM coordinates (≈ 380 000 / 5 460 000 m) in float32 jitter by decimetres, which fakes or hides relicts.

## Decision
- All data stays in **EPSG:25832** (vectors to 0.01 m).
- three.js world: `x = E − E0`, `y = h`, `z = −(N − N0)`. Raw UTM never goes into float32 buffers.
- Leaflet stays EPSG:3857. Map headings add `gridConvergenceDeg` (≈ −1.2°).

## Consequences
- ✅ Stable sub-cm precision in the GPU.
- ⚠️ Axis flips and the sign of z are a recurring bug class, so they get numeric tests.
