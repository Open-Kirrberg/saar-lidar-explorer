#!/bin/zsh
# Run Apple Object Capture on extracted shots, sequentially (one GPU job at a time).
# Usage (from video2world/):  scripts/run_oc.sh <detail> <ordering> SHOT [SHOT ...]
#   e.g. scripts/run_oc.sh full sequential S04 S23 ;  scripts/run_oc.sh full unordered CORE_DAY
# Output: work/oc/<SHOT>_<detail>/{model/*.obj, poses.json, points.ply, run.log}
set -u
cd "${0:A:h}/.."
[[ -x work/bin/pgtool ]] || { mkdir -p work/bin && swiftc -O -o work/bin/pgtool scripts/pgtool.swift; }
detail=$1; ordering=$2; shift 2
for shot in "$@"; do
  out=work/oc/${shot}_${detail}
  mkdir -p $out
  echo "== $shot $detail $ordering -> $out"
  /usr/bin/time -p work/bin/pgtool work/frames/$shot $out $detail $ordering high > $out/run.log 2>&1
  grep -E "^(poses|points|model|done|error|invalid|skipped)" $out/run.log | head -20
  tail -3 $out/run.log
done
