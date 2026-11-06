#!/usr/bin/env bash
# Stage the two public data repositories (GitHub Pages, branch deploy) from app/public/data.
#   saar-lidar-data   = AOI dataset (no xyz), pois.geojson, shared/, castle-viewer/terrain/, zones/ (RELEASE_ZONES)
#   saar-lidar-data-2 = xyz tiles (<= XYZ_MAX_ZOOM) + 3D-print series (3MF only)
# Idempotent; fails (exit 2) when a GitHub Pages hard limit is exceeded. See RELEASING.md.
# Usage: scripts/release/export-data.sh [--dry-run] [--zones-only] [--allow-deletes] [--max-deletes N]
#        (env overrides: see release.env; SLE_DATA_DIR = data dir)
#   --dry-run        list what would be written/deleted in both staging repos, change nothing
#   --zones-only     stage only saar-lidar-data/zones/ (zone packages + index); nothing else is touched
#   --allow-deletes  allow removing more than RELEASE_MAX_DELETES staged files per repo (else exit 3, nothing written)
# Symlinked inputs are followed inside the repo and RELEASE_LINK_ROOTS (release.env); anything else aborts.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=release.env
source "$HERE/release.env"

SRC="${SLE_DATA_DIR:-$REPO/app/public/data}"
case "$SRC" in /*) ;; *) SRC="$REPO/app/$SRC" ;; esac
TERRAIN="$REPO/zones/schloss-karlsberg/viewer/public/terrain"
OUT1="$RELEASE_DIR/$DATA_REPO"
OUT2="$RELEASE_DIR/$DATA2_REPO"
mkdir -p "$RELEASE_DIR"

# The Pages workflow builds the castle viewer from COMMITTED code; its terrain must match that code.
ZONES_ONLY=0
for ARG in "$@"; do [[ "$ARG" == --zones-only ]] && ZONES_ONLY=1; done
if [[ $ZONES_ONLY == 0 && -n "$(git -C "$REPO" status --porcelain -- zones/schloss-karlsberg/viewer zones/schloss-karlsberg/model 2>/dev/null)" ]]; then
  echo "[export-data] WARNING: zones/schloss-karlsberg/ has uncommitted changes – castle-viewer/terrain/ may not match the" >&2
  echo "              published viewer code. Review 'git -C $OUT1 status castle-viewer' and revert it if unsure." >&2
fi
[[ $ZONES_ONLY == 1 || -f "$SRC/$RELEASE_AOI/manifest.json" ]] || { echo "no $SRC/$RELEASE_AOI/manifest.json – run the pipeline first" >&2; exit 1; }
for IDX in "$SRC"/print/*/index.json; do
  [[ $ZONES_ONLY == 0 ]] || break
  [[ -f "$IDX" ]] || continue
  echo "[export-data] print $(python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("series",{}).get("key","?"), len(d.get("tiles",[])), "tiles, updated", d.get("updated","?"))' "$IDX")"
done

LINK_ARGS=()
IFS=':' read -r -a LINK_ROOT_LIST <<< "$RELEASE_LINK_ROOTS"
for R in ${LINK_ROOT_LIST[@]+"${LINK_ROOT_LIST[@]}"}; do [[ -n "$R" && -d "$R" ]] && LINK_ARGS+=(--link-root "$R"); done

python3 -I "$HERE/export_data.py" \
  --src "$SRC" --castle-terrain "$TERRAIN" \
  --out1 "$OUT1" --out2 "$OUT2" \
  --aoi "$RELEASE_AOI" --xyz-max-zoom "$XYZ_MAX_ZOOM" \
  --app-url "$APP_URL" --data-url "$DATA_URL" --data2-url "$DATA2_URL" --org "$GH_ORG" \
  --site-hard-mb "$SITE_HARD_MB" --site-aim-mb "$SITE_AIM_MB" --file-hard-mb "$FILE_HARD_MB" --file-aim-mb "$FILE_AIM_MB" \
  --zones "$RELEASE_ZONES" --max-deletes "$RELEASE_MAX_DELETES" ${LINK_ARGS[@]+"${LINK_ARGS[@]}"} \
  --report "$RELEASE_DIR/data-size-report.txt" "$@"
