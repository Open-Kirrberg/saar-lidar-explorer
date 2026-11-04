#!/usr/bin/env bash
# Full pipeline for one AOI:  ./run.sh karlsberg   (AOIs: see aois.toml)
# Steps can be selected:      ./run.sh karlsberg build xyz
set -euo pipefail
cd "$(dirname "$0")"   # always run from pipeline/ (never from the untrusted data dirs)
AOI="${1:-karlsberg}"; shift || true
if [[ $# -gt 0 ]]; then STEPS=("$@"); else STEPS=(fetch build xyz osm cadastre buildings ortho historic pois detect pointcloud trees test); fi

step() { local t0=$SECONDS; echo "=== $1"; shift; "$@"; echo "=== done in $((SECONDS - t0))s"; }
for s in "${STEPS[@]}"; do
  case "$s" in
    fetch) step "fetch $AOI" uv run python fetch.py "$AOI" ;;
    build) step "build $AOI" uv run python build.py "$AOI" ;;
    xyz)   step "xyz $AOI"   uv run python xyz.py "$AOI" ;;
    osm)   step "osm $AOI"   uv run python osm.py "$AOI" ;;
    cadastre) step "cadastre $AOI" uv run python cadastre.py "$AOI" ;;
    buildings) step "buildings $AOI" uv run python buildings.py "$AOI" ;;
    ortho) step "ortho $AOI" uv run python ortho.py "$AOI" ;;
    historic) step "historic $AOI" uv run python historic.py "$AOI" ;;
    detect) step "detect $AOI" uv run python detect.py "$AOI" ;;   # F15 candidates: private/local data only
    pointcloud) step "pointcloud $AOI" uv run python pointcloud.py "$AOI" ;;   # F16 focus-area point clouds (LAZ ≈ 45 MB/km²)
    trees) step "trees $AOI" uv run python trees.py "$AOI" ;;                 # V2.4 tree crowns from the CHM (after buildings, ortho)
    pois)  step "pois"       uv run python pois.py ;;
    attribution) step "attribution $AOI" uv run python -c 'import sys, common; print(common.refresh_attribution(sys.argv[1]))' "$AOI" ;;  # manifest-only: heal superseded entries
    test)  step "tests"      uv run pytest -q ;;
    *) echo "unknown step $s (fetch|build|xyz|osm|cadastre|buildings|ortho|historic|pois|detect|pointcloud|trees|attribution|test)"; exit 1 ;;
  esac
done
du -sh "../app/public/data/$AOI" "../app/public/data/$AOI/xyz" 2>/dev/null || true
