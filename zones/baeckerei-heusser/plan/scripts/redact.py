"""Full (private) Raumplan -> public Raumplan (bh-datenschutz: consent scope = shop + exterior).

    python -I redact.py [full.json] [public.json]     # defaults: <private>/plan/raumplan-v0.json -> plan/raumplan-v0.json

Removed or neutralised in the public file (the full file keeps everything):
  - the residents' house door in the passage (opening O8) and anything else beyond the shop's passage door,
  - the position of the pickup locker X1 (it stands in the private part of the passage),
  - the DGM sample point inside the private part of the passage,
  - every mention of the courtyard (COURTYARD below).
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

# Frame B: the shop's passage door (open side of the porch, O5) ends at y = 1.52; the capture's privacy crop runs
# across the passage at y ~ 1.6. Public geometry in the passage stays at y <= PASSAGE_PUBLIC_Y.
PASSAGE_PUBLIC_Y = 1.60
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
        p["note_de"] = "öffentlich nur bis zur Ladentür (Rahmen B y ≤ 1,60); der hintere Teil ist privat"
        p["public_until_y"] = PASSAGE_PUBLIC_Y
    for fx in site.get("fixtures", []):
        xy = (fx.get("pose") or {}).get("xy")
        if xy and xy[0] > 24.6 and xy[1] > PASSAGE_PUBLIC_Y:
            fx["pose"] = None
            fx.pop("z_ref", None)
            fx["status"] = "nur_privat"
            fx["note_de"] = "steht im privaten Teil des Durchgangs: Lage nur im privaten Plan"
    dg = site.get("dgm1", {})
    for k in [k for k, v in dg.items() if v.get("xy") and v["xy"][0] > 24.6 and v["xy"][1] > PASSAGE_PUBLIC_Y]:
        del dg[k]
    for lvl in d.get("levels", []):
        for room in lvl.get("rooms", []):
            ops = room.get("openings")
            if ops:
                room["openings"] = [o for o in ops if not _private_opening(o)]
    d = _scrub(d)
    d["privacy"] = {
        "version": "public",
        "rule": "bh-datenschutz: Einwilligung = Laden + Außenansicht; nichts hinter der Ladentür im Durchgang, keine Privatbereiche",
        "passage_public_until_y": PASSAGE_PUBLIC_Y,
        "full_version": "privater Materialordner (lokal, nicht im Repo)",
    }
    return d


def _private_opening(o: dict) -> bool:
    pts = [o.get("from"), o.get("to")]
    return all(p and p[0] > 24.6 and p[1] > PASSAGE_PUBLIC_Y for p in pts)


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
