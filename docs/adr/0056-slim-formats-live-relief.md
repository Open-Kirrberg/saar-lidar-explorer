# 0056 · 🪶 Slim formats: WebP/AVIF, live relief, no DSM, 2D vectors

- **Status:** Accepted · 2026-11-08
- **Origin:** [S0 report](../plans/orte-skalieren-s0.md) §2–3 · [plan „Orte skalieren“](../plans/orte-skalieren.md) §5, D6 · contract [„Slim formats (v3)“](../data-contract.md)

## Context
S0 measured Homburg at 13.1 MB/km² in today's format; one Pages site holds 1 GB. The baked hillshade was never displayed, slope and SLRM have live equivalents, VAT can be recomputed from SVF and positive openness, PNG optimisation gains nothing, and the DSM is only needed for the canopy surface.

## Decision
- **Lossless WebP** for heights and data layers (`dtm`, `chm`, `mask`, `bldg`), bit-exact under `colorSpaceConversion: 'none'`.
- **Lossy AVIF** for visual layers: `svf` / openness and coarse `vat` at q90, ortho and historic maps at q65 (hosted, D6).
- **Live relief:** hillshade, slope and local relief are computed in the shader; VAT is derived from `svf` + `opns_pos` with the exact RVT blend, including rvt's in-place overlay quirk. Declared as `derived` modes; coarse levels keep a small baked VAT.
- **No DSM** in v3: the surface is DTM + CHM.
- **OSM as 2D source vertices**, densified and draped at runtime; **parcel lines derived** from the polygons in the app.
- **No AVIF fallback files:** every audience browser decodes AVIF (Chrome 85, Firefox 93, Safari 16); without it the app hides the AVIF layers and says so.

## Consequences
- ✅ ≈ 5.3 MB/km² (−60 %) without losing a feature; ≈ 30 % less traffic per flight.
- ⚠️ Two R8 textures per level-0 chunk for live VAT (+8 to +27 MB GPU in S0 views); phone cost to be measured.
- ⚠️ Lossy SVF/openness differ by ≈ 1 grey level from the source; exact value readouts show „≈“. AVIF decode in Safari/Firefox workers is not yet verified.
