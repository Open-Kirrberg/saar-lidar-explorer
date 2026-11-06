"""Guided tour of the built twin (catalogue/tour.json -> catalogue `tour`, docs/zone-contract.md „Tour“).
Pure parts, no local data needed.

    cd pipeline && uv run python -I -m pytest -q -p no:cacheprovider ../zones/baeckerei-heusser/build/test_tour.py
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parents[2] / "pipeline")]

import build as B  # noqa: E402


def card_objects() -> set[str]:
    cat_doc = json.loads(B.CATALOGUE.read_text(encoding="utf-8"))
    return set(B.catalogue_json(cat_doc, {"products": []}, {})["objects"])


def test_the_bakery_tour_is_valid():
    doc = B.load_tour()
    assert doc is not None
    t = B.tour_block(doc, card_objects())
    ids = [s["id"] for s in t["stops"]]
    assert 5 <= len(ids) <= 6 and ids[0] == "giebel" and ids[-1] == "bilder"
    # the gable mural opens the tour, the historic pictures close it
    assert t["stops"][0]["target"] == "fassade/wandmalerei" and t["stops"][-1]["target"] == "bilderwand"
    for s in t["stops"]:
        # zone frame near the shop (|x|, |z| < 40 m around the origin), eye level above the street (≈ 243 m)
        assert all(abs(s[k][0]) < 40 and abs(s[k][2]) < 40 and 243 < s[k][1] < 252 for k in ("eye", "look")), s["id"]
        # German du-form, never the formal address
        assert not any(w in f" {s['text_de']} " for w in (" Sie ", " Ihr ", " Ihnen ")), s["id"]


def test_catalogue_gets_the_tour_block():
    doc = B.load_tour()
    cat_doc = json.loads(B.CATALOGUE.read_text(encoding="utf-8"))
    out = B.catalogue_json(cat_doc, {"products": []}, {}, None, doc)
    assert out["tour"]["name_de"] == "Kleine Führung" and len(out["tour"]["stops"]) == len(doc["stops"])
    assert "tour" not in B.catalogue_json(cat_doc, {"products": []}, {})


@pytest.mark.parametrize("patch, msg", [
    (lambda d: d["stops"][0].update(target="hinterhof"), "not a card object"),
    (lambda d: d["stops"][0].update(text_de="Eins. Zwei. Drei. Vier."), "1–3 sentences"),
    (lambda d: d["stops"][0].update(text_de="Das Brot ist gesund."), "health"),
    (lambda d: d["stops"][0].update(eye=[381467.0, 245.0, -5462254.0]), "zone frame"),
    (lambda d: d["stops"][1].update(look=list(d["stops"][1]["eye"])), "different"),
    (lambda d: d["stops"][1].update(via=[[0, 0]] * 5), "via"),
    (lambda d: d["stops"][1].update(id=d["stops"][0]["id"]), "unique"),
    (lambda d: d.update(stops=d["stops"][:1]), "stops: 2"),
    (lambda d: d.update(format="x"), "format"),
])
def test_broken_tours_fail_the_build(patch, msg):
    doc = copy.deepcopy(B.load_tour())
    patch(doc)
    with pytest.raises(SystemExit, match=msg):
        B.tour_block(doc, card_objects())
