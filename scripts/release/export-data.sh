#!/usr/bin/env bash
# Stage the two public data repositories (GitHub Pages, branch deploy) from app/public/data.
#   saar-lidar-data   = AOI dataset (no xyz), pois.geojson, shared/, castle-viewer/terrain/
#   saar-lidar-data-2 = xyz tiles (<= XYZ_MAX_ZOOM) + 3D-print series (3MF only)
# Idempotent; fails (exit 2) when a GitHub Pages hard limit is exceeded. See RELEASING.md.
# Usage: scripts/release/export-data.sh      (env overrides: see release.env; SLE_DATA_DIR = data dir)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=release.env
source "$HERE/release.env"

SRC="${SLE_DATA_DIR:-$REPO/app/public/data}"
case "$SRC" in /*) ;; *) SRC="$REPO/app/$SRC" ;; esac
TERRAIN="$REPO/schloss-karlsberg/viewer/public/terrain"
OUT1="$RELEASE_DIR/$DATA_REPO"
OUT2="$RELEASE_DIR/$DATA2_REPO"
mkdir -p "$RELEASE_DIR"

[[ -f "$SRC/$RELEASE_AOI/manifest.json" ]] || { echo "no $SRC/$RELEASE_AOI/manifest.json – run the pipeline first" >&2; exit 1; }
for IDX in "$SRC"/print/*/index.json; do
  [[ -f "$IDX" ]] || continue
  echo "[export-data] print $(python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("series",{}).get("key","?"), len(d.get("tiles",[])), "tiles, updated", d.get("updated","?"))' "$IDX")"
done

python3 -I "$HERE/export_data.py" \
  --src "$SRC" --castle-terrain "$TERRAIN" \
  --out1 "$OUT1" --out2 "$OUT2" \
  --aoi "$RELEASE_AOI" --xyz-max-zoom "$XYZ_MAX_ZOOM" \
  --app-url "$APP_URL" --data-url "$DATA_URL" --data2-url "$DATA2_URL" --org "$GH_ORG" \
  --site-hard-mb "$SITE_HARD_MB" --site-aim-mb "$SITE_AIM_MB" --file-hard-mb "$FILE_HARD_MB" --file-aim-mb "$FILE_AIM_MB" \
  --report "$RELEASE_DIR/data-size-report.txt"
