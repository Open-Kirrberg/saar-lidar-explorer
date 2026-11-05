#!/bin/zsh
# Bäckerei Heusser built twin: Raumplan -> twin.glb + nav.glb -> zone package.
#   zones/baeckerei-heusser/build/run.sh [--update-catalogue] [--no-package]
# 1. generator (pipeline venv: shapely, rasterio, earcut; raw data is parsed, never executed: python -I)
# 2. capture tool stage `twin`: pack (meshopt + quantization) into app/public/data/zones/baeckerei-heusser/ (needs a
#    capture package there: `tools/capture/run.sh baeckerei-heusser package`, which also runs `twin` at its end)
set -euo pipefail
HERE="${0:A:h}"
REPO="${HERE:h:h:h}"
pkg=1
gen_args=()
for a in "$@"; do
  case "$a" in
    --no-package) pkg=0 ;;
    *) gen_args+=("$a") ;;
  esac
done
cd "$REPO/pipeline"
uv run --quiet python -I "$HERE/build.py" "${gen_args[@]}"
if (( pkg )); then
  "$REPO/tools/capture/run.sh" baeckerei-heusser twin
fi
