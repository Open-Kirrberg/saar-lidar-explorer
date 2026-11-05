"""Paths for the Raumplan scripts (no absolute home paths in the repo).

    PLAN   zones/baeckerei-heusser/plan/            public plan (redacted JSON, SVG, PNG)
    PRIV   ../baeckerei-heusser-privat/plan/        full plan + work files (private, outside the repo)
    WORK   PRIV/work/                               LoD2/OSM/parcel extracts, mesh in frame B, QA renders
    DATA   <repo>/data/                             downloaded data (untrusted, read only)

`BH_PRIVAT` overrides the private folder (the folder that contains `plan/`).
"""
from __future__ import annotations

import os
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
PLAN = REPO / "zones" / "baeckerei-heusser" / "plan"
PRIV = Path(os.environ.get("BH_PRIVAT", REPO.parent / "baeckerei-heusser-privat")) / "plan"
WORK = PRIV / "work"
DATA = REPO / "data"
CAPTURE_WORK = DATA / "work" / "zones" / "baeckerei-heusser"
DTM = DATA / "work" / "overall" / "dtm.tif"

SP = str(PRIV) + "/"  # legacy prefix used by the analysis scripts: SP + "work/<file>"
