"""Stage `clean` (runs last by default): delete intermediates that nothing downstream needs.

  frames/raw        unblurred keyframes -- only blurred frames may outlive a run (H13); `frames` re-extracts them
  sfm/database.db   COLMAP features + matches
  sfm/models        mapper output, duplicate of sfm/sparse

Kept: frames/clean, frames/undistorted, sfm/sparse (a splat run starts from these, ADR 0027), mesh/, export/.
"""
from __future__ import annotations

import shutil

from .common import Zone

TARGETS = ("frames/raw", "sfm/database.db", "sfm/models")


def run(zone: Zone) -> dict:
    freed = {}
    for rel in TARGETS:
        p = zone.work / rel
        if not p.exists():
            continue
        files = [p] if p.is_file() else [f for f in p.rglob("*") if f.is_file()]
        freed[rel] = round(sum(f.stat().st_size for f in files) / 1e6, 1)
        p.unlink() if p.is_file() else shutil.rmtree(p)
    print("   clean: freed MB", freed, flush=True)
    return freed
