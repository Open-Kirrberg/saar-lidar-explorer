"""Tests for the wave A helpers (bh_twin/site.py, keystones and plinth cap in bh_twin/facade.py, Fraktur lettering):
pure geometry on the committed public plan, no local data needed.

    cd pipeline && uv run python -I -m pytest -q -p no:cacheprovider ../zones/baeckerei-heusser/build
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

import pytest
from shapely import union_all
from shapely.geometry import box

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parents[2] / "pipeline")]

from bh_twin import facade as fc  # noqa: E402
from bh_twin import site  # noqa: E402
from bh_twin.lettering import fraktur_math, text_polys  # noqa: E402

PLAN = json.loads((HERE.parent / "plan" / "raumplan-v0.json").read_text(encoding="utf-8"))
FAC = PLAN["site"]["facade"]


def test_niche_treads_climb_from_the_street_to_the_landing():
    nb = site.niche(FAC)
    tr = site.niche_treads(nb)
    assert len(tr) == nb.risers                                            # 4 treads + the landing
    assert tr[0][0] == 0.0 and tr[-1][1] == nb.depth
    rises = [b[2] - a[2] for a, b in zip([(0, 0, nb.street)] + tr[:-1], tr)]
    assert all(abs(r - rises[0]) < 1e-9 for r in rises) and 0.15 < rises[0] < 0.22   # even risers ≈ 0.19
    assert tr[-1][2] == nb.landing_z
    pitch = site.niche_pitch(nb)
    assert all(abs(pitch(y0) - z) < 1e-9 for y0, _, z in tr)              # the pitch line runs through the nosings
    assert site.niche(None) is None and site.niche({}) is None


def test_niche_nav_stays_inside_the_niche_and_short_of_the_door():
    nb = site.niche(FAC)
    polys = site.niche_nav_polys(nb)
    U = union_all([q for q, _ in polys])
    assert U.within(box(nb.x0, 0.0, nb.x1, nb.depth))
    assert U.bounds[3] <= nb.depth - 0.05 + 1e-9 and U.bounds[0] >= nb.x0 + nb.string_b - 1e-9
    assert abs(U.area - (nb.x1 - nb.cap_proj - nb.x0 - nb.string_b) * (nb.depth - 0.05)) < 1e-6
    x0, x1, *_ , z1 = site.niche_cutter_box(nb)
    assert x0 == pytest.approx(nb.x0 - nb.r_left) and x1 == nb.x1 and z1 == nb.head


def test_plinth_cap_is_open_over_the_niche():
    spans = fc.plinth_cap_spans(FAC, 21.83)
    nb = site.niche(FAC)
    assert spans[0][0] == 0.0 and spans[-1][1] == 21.83
    assert spans[0][1] <= nb.x0 - nb.r_left + 1e-9 and spans[1][0] >= nb.x1
    old = {k: v for k, v in FAC.items() if k != "backstube_eingang"}
    assert fc.plinth_cap_spans(old, 21.83) == [(0.0, 21.83)]


def test_keystones_are_trapezoids_and_the_inscription_fits():
    k1, k2 = FAC["schlusssteine"]
    hw = fc.keystone_half_width(k2, 0.0, 0.44)
    assert hw(0.0) == pytest.approx(k2["w_bottom"]["v"] / 2) and hw(0.44) == pytest.approx(k2["w_top"]["v"] / 2)
    assert hw(0.0) < hw(0.44)
    lines = fc.inscription_polys(k2, 0.0, 0.44, hw)
    assert len(lines) == 2                                                  # „H.H.“ over „AD 1933“
    top, bottom = lines
    assert top.bounds[1] > bottom.bounds[3]                                 # stacked, no overlap
    for t in lines:
        x0, y0, x1, y1 = t.bounds
        assert y0 >= 0.0 and y1 <= 0.44 - 0.03
        assert -x0 <= hw(y0) - fc.KEYSTONE_MARGIN + 1e-6 and x1 <= hw(y0) - fc.KEYSTONE_MARGIN + 1e-6
    assert 0.12 < top.bounds[3] - top.bounds[1] < 0.21                      # H.H. ≈ 0.15–0.18 tall
    rect = {"w": {"v": 0.42}}                                               # older plans: plain width
    assert fc.keystone_half_width(rect, 0, 1)(0.5) == pytest.approx(0.21)
    big = copy.deepcopy(k2)
    big["inschrift"] = [{"text": "I", "h": {"v": 0.6}}]                   # narrow: shrinking to the width does not help
    with pytest.raises(ValueError):
        fc.inscription_polys(big, 0.0, 0.44, hw)


def test_fraktur_lettering():
    assert fraktur_math("AD 1933") == r"$\mathfrak{AD\ 1933}$"
    with pytest.raises(ValueError):
        fraktur_math("$x$")
    t = text_polys("H.H.", 0.18, fraktur=True)
    assert t.equals(text_polys("H.H.", 0.18, fraktur=True))                 # deterministic
    assert not t.equals(text_polys("H.H.", 0.18))                           # not the DejaVu outline


def test_herringbone_tiles_the_passage_without_overlap():
    region = box(24.66, 0.0, 27.62, 4.35)
    pav = site.herringbone(region, 0.20, 0.10, 0.008, (24.66, 0.0))
    U = union_all([q for q, _ in pav])
    assert U.within(region.buffer(1e-9))
    assert sum(q.area for q, _ in pav) == pytest.approx(U.area, rel=1e-9)   # no overlaps
    assert U.area / region.area > 0.85                                      # joints only between the pavers
    tones = [k for _, k in pav]
    assert 0.2 < sum(tones) / len(tones) < 0.6
    assert pav == site.herringbone(region, 0.20, 0.10, 0.008, (24.66, 0.0))
    with pytest.raises(ValueError):
        site.herringbone(region, 0.25, 0.10)


def test_cabinet_is_public_in_front_of_the_line():
    c = site.cabinet(PLAN)
    assert (c.w, c.d, c.h) == (0.90, 0.42, 1.75)
    fp = site.cabinet_footprint(c)
    assert fp.bounds[3] <= PLAN["site"]["passage"]["public_until_y"] - 0.2
    edge = next(e for e in PLAN["site"]["building"]["edges"] if e["id"] == "L3")
    (xa, ya), (xb, yb) = edge["to"], edge["from"]
    yc = c.y0 + c.w / 2
    assert fp.bounds[0] == pytest.approx(xa + (xb - xa) * (yc - ya) / (yb - ya), abs=0.01)   # back to the shop wall
    no_pose = copy.deepcopy(PLAN)
    next(f for f in no_pose["site"]["fixtures"] if f["id"] == "X1")["pose"] = None
    assert site.cabinet(no_pose) is None
