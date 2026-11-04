#!/usr/bin/env bash
# Quality gate for the schloss-karlsberg sub-project (castle only; never touches ../../app, ../../pipeline).
#   .claude/skills/skb-improve/scripts/verify.sh              # test + build + catalogue + export (default)
#   .claude/skills/skb-improve/scripts/verify.sh test build    # selected steps
# Steps:
#   test       pnpm run test (vitest: model/tests, plans/tests, viewer/tests)
#   build      pnpm run build (tsc --noEmit + vite build → dist/, git-ignored)
#   catalogue  scripts/catalogue-v2/build.ts must reproduce model/catalogue.json byte for byte (validation,
#              programme checks, footprint overlaps). Non-destructive: the committed file is restored afterwards.
#   export     pnpm run export:explorer into a temp dir (light layer builds + GLTFLoader round trip), NOT into ../../app
#   warn       scripts/dev/warn.ts: interior warnings per detailed building (informational, never fails)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"   # .claude/skills/skb-improve/scripts → sub-project root
cd "$ROOT" || exit 2
[[ -f model/catalogue.json && -f package.json ]] || { echo "not the schloss-karlsberg root: $ROOT"; exit 2; }
STEPS=("$@"); [[ ${#STEPS[@]} -eq 0 ]] && STEPS=(test build catalogue export)
TMP="$(mktemp -d "${TMPDIR:-/tmp}/skb-verify.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
fail=0
run() { local name="$1"; shift; echo "=== $name"; if "$@"; then echo "=== ok: $name"; else echo "=== FAILED: $name"; fail=1; fi; }

step_test()  { set -o pipefail; pnpm run test 2>&1 | tail -6; }
step_build() { set -o pipefail; pnpm run build 2>&1 | tail -6; }
step_catalogue() {
  cp model/catalogue.json "$TMP/catalogue.before.json"
  pnpm exec tsx scripts/catalogue-v2/build.ts > "$TMP/catalogue.log" 2>&1; local rc=$?
  grep -E "catalogue v2:|validation v2:|programme checks:|footprint overlaps" "$TMP/catalogue.log"
  if cmp -s model/catalogue.json "$TMP/catalogue.before.json"; then
    echo "catalogue.json reproduced byte for byte"
  else
    echo "catalogue.json differs from the builder output: a hand edit, or the builder changed without regenerating."
    echo "Run 'pnpm exec tsx scripts/catalogue-v2/build.ts' deliberately and review the diff. (Committed file restored.)"
    cp "$TMP/catalogue.before.json" model/catalogue.json; rc=1
  fi
  return $rc
}
step_export() {
  [[ -d viewer/public/terrain ]] || { echo "viewer/public/terrain missing: run scripts/prepare-terrain.py first (see CLAUDE.md)"; return 1; }
  set -o pipefail; pnpm run export:explorer -- --out "$TMP/explorer" 2>&1 | grep -E "nodes|skirts|dropped|export:explorer|Error|error" | tail -6
}
step_warn() { pnpm exec tsx scripts/dev/warn.ts 2>&1 | head -30; return 0; }

for s in "${STEPS[@]}"; do
  case "$s" in
    test|build|catalogue|export|warn) run "$s" "step_$s" ;;
    *) echo "unknown step: $s (test|build|catalogue|export|warn)"; fail=1 ;;
  esac
done
echo
[[ $fail == 0 ]] && echo "ALL CHECKS PASSED (${STEPS[*]})" || echo "SOME CHECKS FAILED"
exit $fail
