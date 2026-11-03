# 0003 · 🗻 Terrarium heights on the native grid

- **Status:** Accepted · 2026-11-01
- **Origin:** [PRD v1 §5, §9](../history/prd-v1.md#9-decisions-log) · [data contract](../data-contract.md)

## Context
Quantisation, resampling and colour management create terracing that looks like walls or pits.

## Decision
- Heights are **Terrarium PNG**, 502² per 500 m chunk with a 1-cell apron. Layers are 500² u8.
- The grid is the native DGM grid: PixelIsArea, with cell centres at +0.5 m. No resampling.
- Decode with `colorSpaceConversion: 'none'`. Never use half-float heights.
- Exaggeration is `y = hRef + (h − hRef) · exag` for **everything** placed in 3D.

## Consequences
- ✅ < 5 mm error at cell centres, checked against the GeoTIFF.
- ⚠️ Half-pixel errors are the #1 bug class. Every data change gets a numeric spot check.
