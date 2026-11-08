#!/usr/bin/env bash
# Local dry run of the S3 GitHub Actions builds (RELEASING.md §6): runs the same commands as
#   orte-katalog/.github/workflows/build.yml              (catalog site from the data bundle)
#   .github/workflows/build-place.yml (called by ort-homburg/.github/workflows/build.yml)
# against the local checkouts next to this repository, into a scratch directory. Nothing is pushed or deployed.
#
#   scripts/release/dry-run-orte.sh [--out DIR] [--only katalog|homburg] [--steps a,b] [--fresh-downloads]
#
# Differences to Actions, all on purpose:
# - Raw downloads come from the shared cache data/raw/ of this checkout (Actions: actions/cache); nothing there is
#   ever deleted. Unless --fresh-downloads, SLE_CACHE_FROM=homburg-gemeinde lets the Homburg build reuse the local
#   WMS/WFS/Overpass answers instead of downloading ≈ 1 GB of orthophotos again (same requests, same bytes).
# - The catalog bundle is packed from the local statewide outputs first (the maintainer step `katalog.py bundle`;
#   Actions downloads that tar as a release asset) and the place build reads that local catalog.json instead of
#   https://open-kirrberg.github.io/orte-katalog/catalog.json.
# - The pipeline is this working tree; the script warns when it differs from the ref the place repo pins.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SIB="$(dirname "$ROOT")"
OUT="$SIB/_orte-dryrun"; ONLY=""; STEPS=""; FRESH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    --steps) STEPS="$2"; shift 2 ;;
    --fresh-downloads) FRESH=1; shift ;;
    *) echo "unknown argument $1"; exit 2 ;;
  esac
done
case "$OUT" in /*) ;; *) OUT="$PWD/$OUT" ;; esac
mkdir -p "$OUT"
ORT="$SIB/ort-homburg"; KAT="$SIB/orte-katalog"; PIPE="$ROOT/pipeline"
LOG="$OUT/dry-run.log"; : > "$LOG"
say() { echo "$*" | tee -a "$LOG"; }
t() { local t0=$SECONDS; "$@"; say "    ($((SECONDS - t0)) s)"; }

# pinned values exactly as the workflows read them
pin() { sed -n "s/^ *$2: *\"\{0,1\}\([^\" #]*\)\"\{0,1\}.*/\1/p" "$1" | head -1; }
PLACE_ID=$(pin "$ORT/.github/workflows/build.yml" place_id)
PIPE_VERSION=$(pin "$ORT/.github/workflows/build.yml" pipeline_version)
PIPE_REF=$(pin "$ORT/.github/workflows/build.yml" pipeline_ref)
say "== S3 dry run → $OUT  (pipeline working tree $(git -C "$ROOT" rev-parse --short HEAD), place pins $PIPE_REF / $PIPE_VERSION)"
if git -C "$ROOT" cat-file -e "$PIPE_REF^{commit}" 2>/dev/null; then
  git -C "$ROOT" diff --quiet "$PIPE_REF" -- pipeline .github/workflows/build-place.yml \
    || say "!! the working tree's pipeline differs from the pinned ref $PIPE_REF (Actions would build with the pin)"
else
  say "!! pinned ref $PIPE_REF is not a commit of this repository (yet)"
fi

cd "$PIPE"
uv sync --frozen >/dev/null 2>&1

if [ "$ONLY" != "homburg" ]; then
  say "== orte-katalog"
  read -r TAG ASSET PINNED_SHA < <(uv run --frozen python -c 'import sys, tomllib; b = tomllib.load(open(sys.argv[1], "rb"))["bundle"]; print(b["tag"], b["asset"], b["sha256"])' "$KAT/daten.toml")
  say "-- maintainer step: katalog.py bundle (release asset $TAG/$ASSET)"
  t uv run --frozen python katalog.py bundle --out "$OUT/katalog-release" --name "$ASSET" 2>&1 | tee -a "$LOG"
  SHA=$(cut -d' ' -f1 "$OUT/katalog-release/$ASSET.sha256")
  [ "$SHA" = "$PINNED_SHA" ] || say "!! bundle sha256 $SHA ≠ daten.toml $PINNED_SHA: update daten.toml before the release"
  say "-- workflow: katalog.py site + check"
  t env SLE_UA_CONTEXT="dry-run orte-katalog" uv run --frozen python katalog.py site \
    --bundle "$OUT/katalog-release/$ASSET" --sha256 "$SHA" --config "$KAT/orte.toml" \
    --out "$OUT/katalog-site" --work "$OUT/katalog-work" 2>&1 | tee -a "$LOG"
  uv run --frozen python katalog.py check --site "$OUT/katalog-site" 2>&1 | tee -a "$LOG"
  du -sh "$OUT/katalog-release/$ASSET" "$OUT/katalog-site" | tee -a "$LOG"
fi

if [ "$ONLY" != "katalog" ]; then
  say "== ort-homburg (place_id $PLACE_ID)"
  CATALOG="$OUT/katalog-site/catalog.json"
  [ -f "$CATALOG" ] || { say "no $CATALOG – run without --only homburg first"; exit 1; }
  export SLE_UA_CONTEXT="dry-run ort-$PLACE_ID"
  [ "$FRESH" = 1 ] || export SLE_CACHE_FROM=homburg-gemeinde
  APP="$OUT/app-data"; WORK="$OUT/work"
  say "-- content check (place repo's werkzeuge/ort_check.py)"
  uv run --project "$ORT/werkzeuge" --frozen python "$ORT/werkzeuge/ort_check.py" "$ORT" 2>&1 | tee -a "$LOG"
  say "-- plan"
  uv run --frozen python place.py plan --ort "$ORT/ort.toml" --catalog "$CATALOG" --app-data "$APP" \
    --work "$WORK" --expect-pipeline "$PIPE_VERSION" 2>&1 | tee -a "$LOG" | tee "$OUT/plan.txt"
  SITE=$(sed -n 's/^site=//p' "$OUT/plan.txt")
  say "-- build (peak memory via /usr/bin/time)"
  T0=$SECONDS
  TIMEFLAG=-l; [ "$(uname)" = Darwin ] || TIMEFLAG=-v
  /usr/bin/time $TIMEFLAG uv run --frozen python place.py build --ort "$ORT/ort.toml" --catalog "$CATALOG" \
    --app-data "$APP" --work "$WORK" --workers 3 ${STEPS:+--steps "$STEPS"} 2> >(tee "$OUT/time.txt" >&2) | tee -a "$LOG"
  say "    build $((SECONDS - T0)) s"
  say "-- stage + check"
  uv run --frozen python place.py stage --ort "$ORT/ort.toml" --site "$SITE" --repo "$ORT" 2>&1 | tee -a "$LOG"
  uv run --frozen python place.py check --ort "$ORT/ort.toml" --catalog "$CATALOG" --site "$SITE" --work "$WORK" 2>&1 | tee -a "$LOG"
  say "-- sizes"
  du -sh "$SITE" "$WORK" | tee -a "$LOG"
  (cd "$SITE" && du -sh -- */ | sort -h | tail -12) | tee -a "$LOG"
  grep -E "maximum resident|Maximum resident" "$OUT/time.txt" | tee -a "$LOG" || true
  uv run --frozen python - "$OUT/plan.txt" <<'PY' 2>&1 | tee -a "$LOG"
import sys
from pathlib import Path
from common import RAW_DIR, SL_RAW, RLP_RAW
import place
lines = dict(l.split("=", 1) for l in Path(sys.argv[1]).read_text().split() if "=" in l)
print(f"raw cache key {lines['raw_key']}, build key {lines['build_key']}")
# raw bytes the Actions cache would hold for this place: SL + RLP tiles of the fetch set (+ LAZ of the areas)
from catalog import owners_from_catalog, owned_tiles
import json
from grid import neighbours8
cat = json.loads(Path(lines["site"]).parent.parent.joinpath("katalog-site", "catalog.json").read_text())
own = owned_tiles(owners_from_catalog(cat)[0], lines["place_id"])
fetch = neighbours8(own)
sl = sum(p.stat().st_size for e, n in fetch for p in SL_RAW.glob(f"d[go]m1_32_{e}_{n}_1_SL_2025.tif"))
rlp = sum(p.stat().st_size for e, n in fetch for p in RLP_RAW.glob(f"d[go]m1_32_{e}_{n}_1_rp_*.tif"))
print(f"raw fetch set {len(fetch)} tiles: SL {sl / 1e9:.2f} GB, RLP {rlp / 1e9:.2f} GB (+ LoD2, DOP20, LAZ)")
PY
fi
say "== done; log $LOG"
