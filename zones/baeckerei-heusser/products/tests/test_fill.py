"""Fills (`bh-fill-v1`), the shared slot layout, generic goods and low-triangle rolls.

    cd pipeline && uv run python -I -m pytest -q -p no:cacheprovider ../zones/baeckerei-heusser/products
"""
from __future__ import annotations

import copy
import itertools
import json
import sys
from pathlib import Path

import numpy as np
import pytest

PRODUCTS = Path(__file__).resolve().parents[1]
if str(PRODUCTS) not in sys.path:
    sys.path.insert(0, str(PRODUCTS))

import fill as FL  # noqa: E402
import shapes as S  # noqa: E402
import waren as W  # noqa: E402

SLOTS = FL.load_json(FL.SLOTS)
PRODS = FL.load_json(FL.PRODUCTS)
BY_SLOT = {s["id"]: s for s in SLOTS["slots"]}
BY_ID = {p["id"]: p for p in PRODS["products"]}


def morgens() -> dict:
    return FL.load_json(FL.fill_path("morgens"))


def test_committed_fills_pass():
    for path in sorted(FL.FILLS.glob("*.json")):
        assert FL.check_fill(FL.load_json(path), SLOTS, PRODS) == [], path.name
    assert FL.load_json(FL.fill_path("feierabend"))["slots"] == {}     # empty like the walkthrough video


def test_morning_fill_is_plausible():
    f = morgens()
    cats = {BY_ID[e["product"]]["category"] for e in f["slots"].values() if "product" in e}
    assert cats == set(PRODS["categories"]), "every product category is in the morning fill"
    tiers = [k for k in f["slots"] if k.startswith("brotregal/ebene-")]
    assert len(tiers) == sum(1 for s in SLOTS["slots"] if s["fixture"].startswith("brotregal/ebene-")), "all three tiers full"
    baskets = [e for k, e in f["slots"].items() if "/koerbe/" in k]
    assert len(baskets) == 6 and all(BY_ID[e["product"]]["category"] in ("broetchen", "snacks") and e["count"] >= 15 for e in baskets)
    assert all(e == {"product": "brezel", "count": 1} for k, e in f["slots"].items() if k.startswith("theke/brezelstaender/"))
    display = {BY_ID[e["product"]]["category"] for k, e in f["slots"].items() if k.startswith("theke/vitrine/ebene-") and "product" in e}
    assert {"kuchen", "torten", "teilchen"} <= display
    goods = {e["ware"] for e in f["slots"].values() if "ware" in e}
    assert {"brottuete", "flasche", "dose", "becher"} <= goods


def test_checker_rules():
    f = morgens()
    bad = copy.deepcopy(f)
    bad["slots"]["brotregal/ebene-1/platz-01"] = {"product": "brezel", "count": 1}
    assert any("not allowed" in e for e in FL.check_fill(bad, SLOTS, PRODS))
    bad = copy.deepcopy(f)
    bad["slots"]["brotregal/ebene-1/platz-01"] = {"product": "gibt-es-nicht", "count": 1}
    assert any("unknown product" in e for e in FL.check_fill(bad, SLOTS, PRODS))
    bad = copy.deepcopy(f)
    bad["slots"]["brotregal/koerbe/korb-1/platz-01"]["count"] = 60
    assert any("capacity" in e or "fit" in e for e in FL.check_fill(bad, SLOTS, PRODS))
    bad = copy.deepcopy(f)
    bad["slots"]["brotregal/ebene-1/platz-01"] = {"product": "baguette-gross", "count": 1}       # 0.58 m long
    assert any("do not fit" in e for e in FL.check_fill(bad, SLOTS, PRODS))
    bad = copy.deepcopy(f)
    bad["slots"]["platz/gibt-es-nicht"] = {"ware": "dose", "count": 1}
    assert any("not a slot" in e for e in FL.check_fill(bad, SLOTS, PRODS))
    bad = copy.deepcopy(f)
    bad["slots"]["dosenregal/platz-01"]["price_eur"] = 1.0
    assert FL.check_fill(bad, SLOTS, PRODS)
    bad = copy.deepcopy(f)
    bad["format"] = "x"
    assert FL.check_fill(bad, SLOTS, PRODS) == ["format must be 'bh-fill-v1'"]


def _boxes(slot, size, n, mode):
    pos, (cw, cd) = FL.layout(slot, size, n, mode)
    return pos, cw, cd


@pytest.mark.parametrize("sid", sorted(morgens()["slots"]))
def test_layout_pieces_stay_in_their_slot_and_apart(sid):
    e = morgens()["slots"][sid]
    s = BY_SLOT[sid]
    it = FL.item_of(e, BY_ID)
    mode = FL.slot_mode(s, it)
    pos, cw, cd = _boxes(s, it["size_m"], e["count"], mode)
    assert len(pos) == e["count"]
    if mode == "hang":
        return
    W_, D_ = s["size"]["w"], s["size"]["d"]
    for u, v, base, _ in pos:
        assert abs(u) <= W_ / 2 + 1e-9 and abs(v) <= D_ / 2 + 1e-9
        assert base >= 0 and base <= s["size"]["h"]
    # pieces of one layer never share a cell (cells are cw × cd and the piece is shrunk to fit its cell)
    for (a, b) in itertools.combinations([p for p in pos if p[2] == 0.0], 2):
        assert abs(a[0] - b[0]) >= cw - 1e-6 or abs(a[1] - b[1]) >= cd - 1e-6, (a, b)


def test_goods_and_low_rolls_stay_small():
    for wid in FL.WAREN:
        for i in range(3):
            parts = W.ware(wid, i)
            assert S.triangles(parts) <= W.WARE_BUDGET, wid
            lo, hi = S.bbox(parts)
            assert np.allclose(hi[1] - lo[1], FL.WAREN[wid]["size_m"][2], rtol=0.02), wid
            assert {q.mat for q in parts} <= set(S.materials()), wid
    for p in PRODS["products"]:
        if p["shape"] in W.LOW_SHAPES:
            parts = W.low(p, 0)
            assert S.triangles(parts) <= W.LOW_BUDGET, p["id"]
            assert S.triangles(parts) < S.triangles(S.build(p, 0)), p["id"]
            assert {q.mat for q in parts} <= set(S.materials()), p["id"]


def test_goods_are_deterministic():
    a, b = W.ware("glas-honig", 5), W.ware("glas-honig", 5)
    assert all(np.array_equal(x.v, y.v) and x.mat == y.mat for x, y in zip(a, b))


def test_cli_checks_all_fills(capsys):
    assert FL.main([]) == 0
    out = capsys.readouterr().out
    assert "morgens.json" in out and "feierabend.json" in out
    assert json.dumps(morgens(), ensure_ascii=False)          # plain JSON, no prices
    assert "price" not in json.dumps(morgens())
