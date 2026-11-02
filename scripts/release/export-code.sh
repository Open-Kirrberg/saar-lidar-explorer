#!/usr/bin/env bash
# Stage the public code repository (fresh history) for Open-Kirrberg/saar-lidar-explorer.
#   - content: `git archive HEAD` (committed files only) minus code-excludes.txt
#   - adds LICENSE (MIT), NOTICE.md (licences of non-code content), .github/workflows/pages.yml, README "Live" links
#   - neutralises local paths and scans for secrets (secret_scan.py; HIGH findings abort)
#   - first run: `git init -b main` + ONE commit (fresh history); later runs keep the staged `.git/` (the published
#     repository) and add ONE update commit on top, so `git push` is a fast-forward. Never pushes.
# Idempotent: the staging tree is recreated on every run (only `.git/` survives). See RELEASING.md.
# Usage: scripts/release/export-code.sh [--worktree] [--fresh]
#   --worktree  dry-run from the working tree (tracked + untracked, not ignored) instead of HEAD
#   --fresh     discard the staged `.git/` and start a new single-commit history
#   RELEASE_MESSAGE="..."  subject of the update commit (default: "Update from source <rev>")
set -euo pipefail
shopt -s globstar nullglob dotglob
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=release.env
source "$HERE/release.env"
MODE=head
FRESH=0
for arg in "$@"; do
  case "$arg" in
    --worktree) MODE=worktree ;;
    --fresh) FRESH=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

OUT="$RELEASE_DIR/$CODE_REPO"
case "$OUT" in "$REPO"|"$REPO"/*) echo "refusing to stage inside the repo: $OUT" >&2; exit 1 ;; esac
mkdir -p "$RELEASE_DIR"
KEEP_GIT="$RELEASE_DIR/.${CODE_REPO}.git-keep"
if [[ -d "$KEEP_GIT" && ! -d "$OUT/.git" ]]; then   # left over from an aborted run: restore, never lose it
  mkdir -p "$OUT" && mv "$KEEP_GIT" "$OUT/.git"
fi
rm -rf "$KEEP_GIT"
if [[ -d "$OUT/.git" && $FRESH == 0 ]]; then
  mv "$OUT/.git" "$KEEP_GIT"   # restored after the secret scan; a failed run leaves it here (re-run restores)
fi
rm -rf "$OUT"
mkdir -p "$OUT"

if [[ $MODE == head ]]; then
  if [[ -n "$(git -C "$REPO" status --porcelain --untracked-files=no)" ]]; then
    echo "[export-code] note: uncommitted changes are NOT exported (git archive HEAD)"
  fi
  git -C "$REPO" archive --format=tar HEAD | tar -x -C "$OUT"
  SRC_REV="$(git -C "$REPO" rev-parse --short HEAD)"
else
  (cd "$REPO" && git ls-files -co --exclude-standard -z | while IFS= read -r -d '' f; do
     [[ -f "$f" ]] && printf '%s\0' "$f"; done | tar --null -T - -cf -) | tar -x -C "$OUT"
  SRC_REV="$(git -C "$REPO" rev-parse --short HEAD)+worktree"
fi

# ---- excludes ----
removed=()
while IFS= read -r pat; do
  [[ -z "$pat" || "$pat" == \#* ]] && continue
  for p in "$OUT"/$pat; do
    [[ -e "$p" ]] || continue
    removed+=("${p#"$OUT"/}")
    rm -rf "$p"
  done
done < "$HERE/code-excludes.txt"
printf '[export-code] excluded: %s\n' "${removed[@]:-none}"

# ---- licence, notice, workflow ----
cp "$HERE/templates/LICENSE" "$OUT/LICENSE"
cp "$HERE/templates/NOTICE.md" "$OUT/NOTICE.md"
NODE_VERSION="${NODE_VERSION:-$(node -v | sed 's/^v//')}"
PNPM_VERSION="${PNPM_VERSION:-$(pnpm -v)}"
mkdir -p "$OUT/.github/workflows"
sed -e "s|{{NODE_VERSION}}|$NODE_VERSION|g" -e "s|{{PNPM_VERSION}}|$PNPM_VERSION|g" \
    -e "s|{{CODE_REPO}}|$CODE_REPO|g" -e "s|{{DATA_URL}}|$DATA_URL|g" -e "s|{{DATA2_URL}}|$DATA2_URL|g" \
    -e "s|{{AOI}}|$RELEASE_AOI|g" "$HERE/templates/pages.yml" > "$OUT/.github/workflows/pages.yml"

# ---- README: live links under the title ----
python3 -I - "$OUT/README.md" "$APP_URL" "$DATA_URL" "$DATA2_URL" "$GH_ORG" <<'PY'
import sys
from pathlib import Path
p, app, d1, d2, org = sys.argv[1:]
readme = Path(p)
text = readme.read_text(encoding="utf-8")
block = (f"> **Live:** [{app}]({app}) · Schloss-Viewer: [{app}castle/]({app}castle/) · "
         f"Daten: [{d1}]({d1}), [{d2}]({d2}) · [github.com/{org}](https://github.com/{org})  \n"
         "> Code: MIT ([LICENSE](LICENSE)). Daten und Bilder behalten ihre Lizenzen (dl-de/by-2-0, ODbL, CC BY-SA 2.0 DE) – "
         "siehe [NOTICE.md](NOTICE.md). **Schauen, nicht graben:** Verdachtsflächen sind ungeprüfte Hypothesen.\n")
lines = text.split("\n", 1)
if "> **Live:**" not in text:
    text = lines[0] + "\n\n" + block + ("\n" + lines[1] if len(lines) > 1 else "")
readme.write_text(text, encoding="utf-8")
PY

# ---- neutralise local paths + secret scan ----
if ! python3 -I "$HERE/secret_scan.py" "$OUT" --repo-root "$REPO" --report "$RELEASE_DIR/secret-scan.md" > /dev/null; then
  echo "[export-code] secret scan found HIGH findings – see $RELEASE_DIR/secret-scan.md; nothing committed" >&2
  [[ -d "$KEEP_GIT" ]] && mv "$KEEP_GIT" "$OUT/.git"
  exit 1
fi
echo "[export-code] secret scan clean (review INFO in $RELEASE_DIR/secret-scan.md)"

# ---- commit: fresh history on the first run, one update commit afterwards; never pushes ----
NAME="${RELEASE_GIT_NAME:-$(git -C "$REPO" config user.name)}"
EMAIL="${RELEASE_GIT_EMAIL:-$(git -C "$REPO" config user.email)}"
export GIT_AUTHOR_NAME="$NAME" GIT_AUTHOR_EMAIL="$EMAIL" GIT_COMMITTER_NAME="$NAME" GIT_COMMITTER_EMAIL="$EMAIL"
if [[ -d "$KEEP_GIT" ]]; then
  mv "$KEEP_GIT" "$OUT/.git"
  git -C "$OUT" add -A
  if git -C "$OUT" diff --cached --quiet; then
    echo "[export-code] no changes since the last export ($(git -C "$OUT" rev-parse --short HEAD))"
  else
    git -C "$OUT" -c commit.gpgsign=false commit -q -m "${RELEASE_MESSAGE:-Update from source $SRC_REV}

Exported from the private repository (source $SRC_REV) by scripts/release/export-code.sh."
  fi
else
  git -C "$OUT" init -q -b main
  git -C "$OUT" add -A
  git -C "$OUT" -c commit.gpgsign=false commit -q -m "Saar LiDAR Explorer – initial public release

Fresh history exported from the private repository (source $SRC_REV) by scripts/release/export-code.sh.
Code: MIT. Data and images keep their own licences (NOTICE.md)."
fi
FILES=$(git -C "$OUT" ls-files | wc -l | tr -d ' ')
MB=$(git -C "$OUT" ls-files -z | (cd "$OUT" && xargs -0 wc -c) | awk '$2!="total"{s+=$1} END {printf "%.1f", s/1e6}')
echo "[export-code] $OUT: $FILES files, $MB MB (without .git), commit $(git -C "$OUT" rev-parse --short HEAD) by $NAME <$EMAIL>"
