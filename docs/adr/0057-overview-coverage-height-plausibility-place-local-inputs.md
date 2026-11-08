# 0057 · 🧹 Overview coverage, height plausibility, place builds from their own inputs only

- **Status:** Accepted · 2026-11-08 (S2 follow-ups; decided under the autonomous-roadmap rule)
- **Origin:** [plan „Orte skalieren“](../plans/orte-skalieren.md) §9 S2 follow-ups · contract [„Many places (v3, S2)“](../data-contract.md), revision 3.1 · refines [0055](0055-global-grid-tile-ownership-central-overview.md)

## Context
Three S2 shortcuts did not hold up. (1) The central overview filled every cell without source data (France, RLP beyond the cache) with block means and had no no-data marker, so the app hid everything outside the catalog's owned tiles. (2) v3 treated heights below 100 m as no data; two interpolated funnels in SL 2025 tiles (bottoms at ≈ 0 m) still left their 100–137 m walls, which set the overview minimum and the catalog `height_ref_m` to 100 m instead of real terrain. (3) A place's tree crown types came from whichever other AOIs' orthophoto rasters happened to lie in `data/work/`, so the same place built differently on another machine (GitHub Actions, [0052](0052-one-repo-per-municipality-central-catalog.md)).

## Decision
- **Overview no-data = `coverage` + filler, not alpha.** The overview carries an optional 1 km `coverage` bitmap of the tiles with real source data. Heights outside it stay finite filler (smooth push-pull continuation) that readers must not show or query. Terrarium images keep RGB without alpha: an alpha 0 marker would change the bit-exact decode path and cost bytes in every chunk, and meshes need finite heights at their edges anyway.
- **Implausible heights by a local test.** Rule `h-plausible-v1`: an absolute guard below the lowest terrain of both source areas (30 m), plus "a closed depression deeper than 50 m and no wider than 50 m is a source error" (sink fill, local, so tile builds stay byte-identical across tile sets). A floor at the documented lowest point alone cannot work: the grid reaches the Rhine (≈ 45 m) while the SL errors sit at 100–184 m.
- **A place builds only from its own inputs.** v3 tree types come from the place's own 1 m orthophoto work raster (present tiles; crowns reaching into absent tiles are typed from their present part), never from other AOIs' rasters. Not the 10 m DLR class map: it is coarser than a crown and, as type input, doubled the conifer fill in S1b; the own DOP keeps the v1/v2 method and costs nothing extra. v1/v2 AOIs keep their fallback.

## Consequences
- ✅ The app can show real terrain on every covered tile (also the relief buffer ring and RLP neighbours) and hide only true no-data; catalog `height_ref_m` = real lowest terrain (137 m, Moselle near Perl).
- ✅ Place builds are reproducible from their own repo; the pipeline version is bumped (0.9.1) because fill and type rules changed published bytes.
- ⚠️ Trees at a place border can differ in type from what a whole-area build would give (partial crowns); the 23 m deep, 6 m wide hole in SL 357_5444 is kept as possibly real.
