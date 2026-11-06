"""Full (private) Raumplan -> public Raumplan (bh-datenschutz: consent scope = shop + exterior).

    python -I redact.py [full.json] [public.json]     # defaults: <private>/plan/raumplan-v0.json -> plan/raumplan-v0.json

Removed or neutralised in the public file (the full file keeps everything):
  - the residents' house door in the passage (opening O8) and anything else beyond the passage privacy line
    (frame B y > PASSAGE_PUBLIC_Y: positions of site fixtures there, openings, sample points),
  - the DGM sample points inside the covered passage (private-plan only; the public plan has `site.passage.floor`),
  - every mention of the courtyard (COURTYARD below).
The pickup cabinet X1 is public since 2026-11-06 (ADR 0047): it stands in front of the line.
`redact(doc)` is pure (tested in ../test_plan.py).
"""
from __future__ import annotations

import copy
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I: own scripts only
import paths  # noqa: E402

# Frame B: the covered passage lies at x > PASSAGE_X (outside the shop's north wall). Public geometry in it stays at
# y <= PASSAGE_PUBLIC_Y. ADR 0047 (2026-11-06): 4.35, just behind the pickup cabinet and short of the residents'
# door (ADR 0043 had 1.60, the shop's side opening). check_plan.py keeps its own copy (tested equal in test_plan.py).
PASSAGE_X = 24.6
PASSAGE_PUBLIC_Y = 4.35
COURTYARD = re.compile(r"\s*(→|->)\s*Hof\b|\bHof\b[^,;.)]*", re.U)
COURTYARD_WORD = re.compile(r"\bHof\b", re.U)


def _scrub(obj):
    """Drop courtyard mentions from every string."""
    if isinstance(obj, dict):
        return {k: _scrub(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_scrub(v) for v in obj]
    if isinstance(obj, str) and COURTYARD_WORD.search(obj):
        return COURTYARD.sub("", obj).strip(" ,;")
    return obj


def redact(doc: dict) -> dict:
    d = copy.deepcopy(doc)
    site = d.get("site", {})
    p = site.get("passage")
    if p:
        p["name_de"] = "Durchgang (überbaut)"
        p["note_de"] = "öffentlich bis kurz hinter den Abholschrank (Rahmen B y ≤ 4,35); der hintere Teil ist privat"
        p["public_until_y"] = PASSAGE_PUBLIC_Y
    for fx in site.get("fixtures", []):
        xy = (fx.get("pose") or {}).get("xy")
        if xy and xy[0] > PASSAGE_X and xy[1] > PASSAGE_PUBLIC_Y:
            fx["pose"] = None
            fx.pop("z_ref", None)
            fx["status"] = "nur_privat"
            fx["note_de"] = "steht im privaten Teil des Durchgangs: Lage nur im privaten Plan"
    dg = site.get("dgm1", {})
    for k in [k for k, v in dg.items() if v.get("xy") and v["xy"][0] > PASSAGE_X and v["xy"][1] > 0.0]:
        del dg[k]
    for lvl in d.get("levels", []):
        for room in lvl.get("rooms", []):
            ops = room.get("openings")
            if ops:
                room["openings"] = [o for o in ops if not _private_opening(o)]
    d = _scrub(d)
    d["privacy"] = {
        "version": "public",
        "rule": ("bh-datenschutz: Einwilligung = Laden + Außenansicht; im Durchgang nichts hinter der Grenze y = 4,35 "
                 "(Abholschrank ja, ADR 0047), keine Privatbereiche"),
        "passage_public_until_y": PASSAGE_PUBLIC_Y,
        "full_version": "privater Materialordner (lokal, nicht im Repo)",
    }
    return d


def _private_opening(o: dict) -> bool:
    pts = [o.get("from"), o.get("to")]
    return all(p and p[0] > PASSAGE_X and p[1] > PASSAGE_PUBLIC_Y for p in pts)


def main(argv: list[str]) -> int:
    src = argv[0] if argv else str(paths.PRIV / "raumplan-v0.json")
    dst = argv[1] if len(argv) > 1 else str(paths.PLAN / "raumplan-v0.json")
    doc = json.load(open(src, encoding="utf-8"))
    pub = redact(doc)
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(pub, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("wrote", dst)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
