#!/usr/bin/env bash
# Full pipeline for one AOI:  ./run.sh karlsberg   (AOIs: see aois.toml)
# Steps can be selected:      ./run.sh karlsberg build xyz
set -euo pipefail
cd "$(dirname "$0")"   # always run from pipeline/ (never from the untrusted data dirs)
# Stats-only AOIs (aois.toml `stats_only = true`, e.g. orte) refuse the tile steps; `./run.sh orte` alone runs
# places stats-trees stats-inputs and then `stats` for the output AOI (overall). The plan comes from common.py.
# Phase 1 inputs (optional for `stats`): ./run.sh orte species gbif roofs forest-age stats
# (species for a tile AOI, e.g. `./run.sh overall species`, also writes the app layer species/species.png).
AOI="${1:-karlsberg}"; shift || true
PLAN=$(uv run python common.py plan "$AOI" "$@") || exit 1
STEPS=(); AOIS=()
while read -r s a; do [[ -n "$s" ]] && STEPS+=("$s") && AOIS+=("$a"); done <<< "$PLAN"

step() { local t0=$SECONDS; echo "=== $1"; shift; "$@"; echo "=== done in $((SECONDS - t0))s"; }
stats_only() { uv run python -c 'import sys, common; sys.exit(0 if common.aoi_config(sys.argv[1]).get("stats_only") else 1)' "$1"; }
for n in "${!STEPS[@]}"; do
  s="${STEPS[$n]}"; AOI="${AOIS[$n]}"
  case "$s" in
    fetch) step "fetch $AOI" uv run python fetch.py "$AOI" ;;
    build) step "build $AOI" uv run python build.py "$AOI" ;;
    xyz)   step "xyz $AOI"   uv run python xyz.py "$AOI" ;;
    osm)   step "osm $AOI"   uv run python osm.py "$AOI" ;;
    cadastre) step "cadastre $AOI" uv run python cadastre.py "$AOI" ;;
    buildings) step "buildings $AOI" uv run python buildings.py "$AOI" ;;
    ortho) step "ortho $AOI" uv run python ortho.py "$AOI" ;;
    historic) step "historic $AOI" uv run python historic.py "$AOI" ;;
    forest) step "forest $AOI" uv run python historic_forest.py "$AOI" ;;          # forest mask from hist_1840/hist_1935 (after historic)
    detect) step "detect $AOI" uv run python detect.py "$AOI" ;;   # F15 candidates: private/local data only
    pointcloud) step "pointcloud $AOI" uv run python pointcloud.py "$AOI" ;;   # F16 focus-area point clouds (LAZ ≈ 45 MB/km²)
    trees) step "trees $AOI" uv run python trees.py "$AOI" ;;                 # V2.4 tree crowns from the CHM (after buildings, ortho)
    places) step "places"    uv run python places.py ;;                         # Orte im Vergleich: place outlines + parcels (AOI-independent, data/work/orte)
    stats-trees) step "stats-trees" uv run python stats_trees.py all ;;        # Orte im Vergleich: trees + rasters over the stats bbox (long, downloads)
    stats-inputs) step "stats-inputs" uv run python stats_inputs.py all ;;     # Orte im Vergleich: NDVI, Zensus grid, MaStR
    species)                                                                     # DLR tree species: fetch + compare + per-place stats (data/work/orte); app layer only for a tile AOI
      if stats_only "$AOI"; then step "species (stats area)" sh -c 'uv run python species.py fetch && uv run python species.py compare && uv run python species.py stats'
      else step "species $AOI" uv run python species.py all "$AOI"; fi ;;
    gbif)  step "gbif"       uv run python gbif.py ;;                           # Orte im Vergleich: GBIF species counts per place (facets only, cached)
    roofs) step "roofs"      uv run python roofs.py ;;                          # Orte im Vergleich: LoD2 roof PV potential per place / municipality
    forest-age) step "forest-age" uv run python forest_age.py ;;                # Orte im Vergleich: age classes + 1935 forest share per place (after species)
    stats) step "stats $AOI" uv run python stats.py "$AOI" ;;                 # Orte im Vergleich: place stats (needs data/work/orte from places.py, stats_trees.py, stats_inputs.py; Phase 1 files optional)
    pois)  step "pois"       uv run python pois.py ;;
    gemeinden) step "gemeinden" uv run python gemeinden.py all ;;                 # S1 Gemeinde level: VG25 outlines, Zensus, MaStR, DLR, GBIF, LoD2 + roofs
    gemeinde-trees) step "gemeinde-trees" uv run python gemeinde_trees.py all ;;  # S1b: LiDAR canopy per Gemeinde, streamed per tile (long, resumable)
    gemeinden-stats) step "gemeinden-stats $AOI" uv run python gemeinden_stats.py "$AOI" ;;   # S1: publish saarland/stats (sle-stats-v1, level gemeinde)
    attribution) step "attribution $AOI" uv run python -c 'import sys, common; print(common.refresh_attribution(sys.argv[1]))' "$AOI" ;;  # manifest-only: heal superseded entries
    test)  step "tests"      uv run pytest -q ;;
    *) echo "unknown step $s (fetch|build|xyz|osm|cadastre|buildings|ortho|historic|forest|pois|detect|pointcloud|trees|places|stats-trees|stats-inputs|species|gbif|roofs|forest-age|stats|gemeinden|gemeinde-trees|gemeinden-stats|attribution|test)"; exit 1 ;;
  esac
done
AOI="${AOIS[${#AOIS[@]}-1]:-$AOI}"
du -sh "../app/public/data/$AOI" "../app/public/data/$AOI/xyz" 2>/dev/null || true
