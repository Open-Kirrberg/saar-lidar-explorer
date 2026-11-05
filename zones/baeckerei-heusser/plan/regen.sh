#!/bin/zsh
# Regenerate the Raumplan: full plan (private folder) -> public plan (this folder) -> check.
#   zones/baeckerei-heusser/plan/regen.sh           # JSON + SVG (+ PNG when Chrome is found)
#   zones/baeckerei-heusser/plan/regen.sh --no-png
# Needs the explorer's pipeline env (numpy, shapely, rasterio, matplotlib) and the work files in the private folder
# (<private>/plan/work: LoD2/OSM/parcel extracts, mesh in frame B; see README.md). Reads data files only.
set -euo pipefail
HERE="${0:A:h}"
REPO="${HERE:h:h:h}"
PY="$REPO/pipeline/.venv/bin/python"
[[ -x "$PY" ]] || (cd "$REPO/pipeline" && uv sync --quiet)
PRIV="${BH_PRIVAT:-${REPO:h}/baeckerei-heusser-privat}/plan"
[[ -d "$PRIV/work" ]] || { echo "regen: work files missing in $PRIV/work (private folder)"; exit 1; }

"$PY" -I "$HERE/scripts/build_json.py"            # full plan -> $PRIV/raumplan-v0.json
"$PY" -I "$HERE/scripts/redact.py"                # public plan -> plan/raumplan-v0.json
"$PY" -I "$HERE/scripts/build_svg.py"             # full sheet -> $PRIV/raumplan-v0.svg
"$PY" -I "$HERE/scripts/build_svg.py" --public    # public sheet -> plan/raumplan-v0.svg

if [[ "${1:-}" != "--no-png" ]]; then
  CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
  if [[ -x "$CHROME" ]]; then
    for dir in "$HERE" "$PRIV"; do
      tmp="$(mktemp -d)"
      print -r -- '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}img{width:3307px;height:2339px;display:block}</style></head><body><img src="file://'"$dir"'/raumplan-v0.svg"></body></html>' > "$tmp/render.html"
      "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
        --window-size=3307,2339 --screenshot="$dir/raumplan-v0.png" "file://$tmp/render.html" >/dev/null 2>&1
      rm -rf "$tmp"
      echo "wrote $dir/raumplan-v0.png"
    done
  else
    echo "regen: Chrome not found, PNG skipped (set CHROME=...)"
  fi
fi
python3 -I "$HERE/check_plan.py"
