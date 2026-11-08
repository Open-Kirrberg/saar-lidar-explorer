"""forest_age.py (Orte im Vergleich Phase 1): height → age class per tree, forest continuity from forest_hist bits."""
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import forest_age as F  # noqa: E402


def test_yield_tables_are_monotone_and_ordered():
    for name, y in F.YIELD.items():
        assert len(y["ages"]) == len(y["I"]) == len(y["II"]) == len(y["III"]), name
        for cls in ("I", "II", "III"):
            assert all(b > a for a, b in zip(y[cls], y[cls][1:])), (name, cls)
        assert all(a > b > c for a, b, c in zip(y["I"], y["II"], y["III"])), name   # good site grows taller


def test_tree_age_range_and_rounding():
    a = F.tree_age(20 + F.DOMINANT_OFFSET_M, "beech")
    assert a["lo"] <= a["mid"] <= a["hi"]
    assert all(v % F.ROUND_Y == 0 for v in (a["lo"], a["mid"], a["hi"]))
    # 20 m mean height: beech class I 40 + 20·5/7 ≈ 54 y, class II 60 + 20·1.5/5 = 66 y, class III 80 + 20·0.5/3.5 ≈ 83 y
    assert (a["lo"], a["mid"], a["hi"]) == (55, 65, 85)
    assert a["class"] == "middle" and not a["open_hi"] and a["label_de"] == "etwa 55–85 Jahre"


def test_taller_is_older_and_small_trees_get_none():
    ages = [F.tree_age(h, "oak")["mid"] for h in (10, 15, 20, 25, 30)]
    assert ages == sorted(ages) and ages[0] < ages[-1]
    assert F.tree_age(F.MIN_HEIGHT_M - 0.1, "beech") is None
    assert F.tree_age(float("nan"), "beech") is None


def test_open_upper_bound_above_class_three():
    b = F.tree_age(30.0 + F.DOMINANT_OFFSET_M, "beech")      # above class III (28), below class II's end (32)
    assert b["open_hi"] and not b["beyond"] and b["hi"] == 160 and b["label_de"].endswith("+ Jahre")
    assert b["lo"] < b["mid"] <= b["hi"]


def test_no_age_beyond_class_two_table_end():
    # review 2026-11-08: v1 returned the clamped last table age („über 200 Jahre“) for these
    for h, g in ((45.0, "spruce"), (34.0 + F.DOMINANT_OFFSET_M, "beech"), (40.7, "oak"), (33.0, "broadleaf"),
                 (60.9, "douglas"), (40.0, "larch")):
        a = F.tree_age(h, g)
        assert a["beyond"] and a["class"] == "beyond", (h, g)
        assert a["lo"] is None and a["mid"] is None and a["hi"] is None
        assert a["label_de"] == "nicht schätzbar: höher als die Ertragstafel"
    # exactly at the class-II end is still an estimate (the last table age), 0.1 m above is not
    end = F.YIELD["oak"]["II"][-1] + F.DOMINANT_OFFSET_M
    assert F.tree_age(end, "oak")["mid"] == 200 and not F.tree_age(end, "oak")["beyond"]
    assert F.tree_age(end + 0.1, "oak")["beyond"]
    # a union is beyond as soon as one of its tables is (oak ends lower than beech)
    assert F.tree_age(end + 0.1, "broadleaf")["beyond"]


def test_groups_and_unions():
    assert F.tree_age(25, "douglas")["mid"] < F.tree_age(25, "spruce")["mid"] < F.tree_age(25, "pine")["mid"]
    u = F.tree_age(25, "unknown")
    for g in ("beech", "oak", "spruce"):
        one = F.tree_age(25, g)
        assert u["lo"] <= one["lo"] and u["hi"] >= one["hi"]
    assert F.tree_age(25, "no-such-group")["tables"] == list(F.GROUP_TABLES["unknown"])
    assert set(F.DLR_GROUPS.values()) <= set(F.GROUP_TABLES)
    assert set(F.TYPE_GROUPS.values()) <= set(F.GROUP_TABLES)


def test_age_classes_cover_all_ages():
    assert [F.age_class(a) for a in (0, 39.9, 40, 79, 80, 119, 120, 500)] == \
        ["young", "young", "middle", "middle", "old", "old", "very_old", "very_old"]


def test_vectorised_mid_matches_scalar():
    h = np.array([7.0, 12.0, 22.0, 31.0, 26.0])
    g = np.array(["beech", "beech", "oak", "spruce", "unknown"])
    mid, beyond = F.age_mid_vectorised(h, g)
    assert math.isnan(mid[0]) and not beyond[0]
    for i in range(1, len(h)):
        assert F._round(mid[i]) == F.tree_age(float(h[i]), str(g[i]))["mid"]
    hb = np.array([40.7, 36.0, 30.0, 33.0, 7.0])
    gb = np.array(["oak", "beech", "beech", "broadleaf", "oak"])
    mb, bb = F.age_mid_vectorised(hb, gb)
    for i in range(len(hb)):
        a = F.tree_age(float(hb[i]), str(gb[i]))
        assert bool(bb[i]) == bool(a and a["beyond"])
        assert (a is None or a["beyond"]) == bool(np.isnan(mb[i]))


def test_class_shares_weighted():
    mid = np.array([10.0, 50.0, 90.0, 130.0, np.nan])
    w = np.array([1.0, 1.0, 2.0, 0.0, 5.0])
    s = F.class_shares(mid, w)
    assert s == {"young": 25.0, "middle": 25.0, "old": 50.0, "very_old": 0.0}
    assert F.class_shares(np.array([np.nan]), np.array([1.0]))["young"] is None
    b = F.class_shares(mid, w, np.array([False, False, False, False, True]))   # the NaN tree is beyond: weight 5
    assert b == {"young": 11.1, "middle": 11.1, "old": 22.2, "very_old": 0.0, "beyond": 55.6}


EPOCHS = [{"year": 1840, "bit": 0, "noMapBit": 2, "classified": False},
          {"year": 1935, "bit": 1, "noMapBit": 3, "classified": True}]


def test_continuity_ignores_unclassified_epochs_and_nomap():
    v = np.array([0, 2, 2 | 1, 8, 2 | 8, 255, 4 | 2], np.uint8)
    c = F.continuity(v, EPOCHS)
    assert c["covered"].tolist() == [True, True, True, False, False, False, True]
    assert c["forest_all"].tolist() == [False, True, True, False, False, False, True]
    assert c["forest_1935"].tolist() == c["forest_all"].tolist()
    two = EPOCHS[:1] + [{**EPOCHS[1]}]
    two[0] = {**two[0], "classified": True}                                     # if 1840 became classified
    c2 = F.continuity(v, two)
    assert c2["forest_all"].tolist() == [False, False, True, False, False, False, False]
    none = F.continuity(v, [{**e, "classified": False} for e in EPOCHS])
    assert not none["covered"].any() and not none["forest_all"].any()


def test_mask_lookup_follows_contract_grid():
    img = np.arange(12, dtype=np.uint8).reshape(3, 4)         # 3 rows (north first) × 4 cols of 5 m
    e0, ntop = 1000.0, 2015.0
    E = np.array([1000.1, 1019.9, 1007.5, 999.9, 1020.0])
    N = np.array([2014.9, 2000.1, 2007.5, 2010.0, 2010.0])
    assert F.mask_lookup(E, N, img, e0, ntop, 5.0).tolist() == [0, 11, 5, 255, 255]


def test_contract_table_matches_yield_tables():
    """docs/data-contract.md „Tree age estimate“ is the app's copy of YIELD: it must not drift."""
    text = (Path(__file__).resolve().parents[2] / "docs" / "data-contract.md").read_text()
    sec = text.split("### Tree age estimate", 1)[1].split("\n## ", 1)[0]
    rows = {}
    for line in sec.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) == 5 and cells[0].split(" ")[0] in F.YIELD:
            rows[cells[0].split(" ")[0]] = [[float(x) for x in c.split()] for c in cells[1:]]
    assert set(rows) == set(F.YIELD)
    for name, (ages, i, ii, iii) in rows.items():
        y = F.YIELD[name]
        assert ages == y["ages"] and i == y["I"] and ii == y["II"] and iii == y["III"], name
