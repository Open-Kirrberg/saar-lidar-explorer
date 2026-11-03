#!/usr/bin/env bash
# Verification gate for the Saar LiDAR Explorer: app unit tests, typecheck + production build,
# pipeline contract tests. Run from anywhere inside the repo.
#   .claude/skills/sle-roadmap/scripts/verify.sh            # all
#   .claude/skills/sle-roadmap/scripts/verify.sh app        # app only
#   .claude/skills/sle-roadmap/scripts/verify.sh pipeline   # pipeline only
set -uo pipefail
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
WHAT="${1:-all}"
fail=0

run() { echo "=== $1"; shift; if "$@"; then echo "=== ok"; else echo "=== FAILED"; fail=1; fi; }
# Each check pipes into tail for brevity; `set -o pipefail` inside bash -c keeps the real exit code.
check() { bash -c "set -o pipefail; $1"; }

if [[ "$WHAT" == all || "$WHAT" == app ]]; then
  run "app: unit tests"             check "cd '$ROOT/app' && pnpm run test 2>&1 | tail -15"
  run "app: typecheck + build"      check "cd '$ROOT/app' && pnpm run build 2>&1 | tail -8"
  run "app: dist excludes AOI data" check "cd '$ROOT/app' && test \$(du -sm dist | cut -f1) -lt 20"
fi
if [[ "$WHAT" == all || "$WHAT" == castle ]]; then
  run "castle: tests + build"         check "cd '$ROOT/schloss-karlsberg' && '$ROOT/schloss-karlsberg/.claude/skills/skb-improve/scripts/verify.sh' test build 2>&1 | tail -12"
fi
if [[ "$WHAT" == all || "$WHAT" == docs ]]; then
  run "docs: ADR index + PRD length"  check "python3 -I '$ROOT/.claude/skills/sle-roadmap/scripts/check_docs.py' '$ROOT'"
fi
if [[ "$WHAT" == all || "$WHAT" == pipeline ]]; then
  run "pipeline: contract tests"    check "cd '$ROOT/pipeline' && uv run pytest -q 2>&1 | tail -15"
fi
echo
[[ $fail == 0 ]] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit $fail
