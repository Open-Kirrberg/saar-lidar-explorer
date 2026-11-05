"""Tests for the catalogue check: cd pipeline && uv run python -I -m pytest -q ../zones/baeckerei-heusser/catalogue"""
import copy
import json
from pathlib import Path

from check import check

HERE = Path(__file__).resolve().parent


def base():
    return {
        "format": "bh-catalogue-v1",
        "consent": {"scope": ["verkaufsraum", "aussen"], "prices": False},
        "objects": [
            {"id": "brotregal", "type": "fixture", "area": "verkaufsraum", "name_de": "Brotregal", "info_de": "Brote.",
             "dims": {"w": 2.4, "d": 0.5, "h": 1.9}, "placement": {"plan": {"x": 4.2, "z": -2.0, "rot_deg": 180}},
             "source": "plan", "sigma_m": 0.05, "refs": ["Raumplan v0"], "status": "built", "clickable": True},
            {"id": "brotregal/ebene-2", "type": "fixture", "area": "verkaufsraum", "name_de": "Ebene 2", "info_de": "",
             "dims": {"w": 2.3, "d": 0.4, "h": 0.05}, "placement": {"rel": {"to": "brotregal", "offset": [0, 0.8, 0.05]}},
             "source": "tape", "sigma_m": 0.01, "refs": [], "status": "blockout", "clickable": False},
            {"id": "brotregal/ebene-2/brot-03", "type": "product", "area": "verkaufsraum", "name_de": "Bauernbrot", "info_de": "",
             "dims": None, "placement": None, "source": "photo", "sigma_m": 0.1, "refs": [], "status": "planned", "clickable": True},
        ],
    }


def errs_for(mutate):
    doc = base()
    mutate(doc)
    return check(doc)


def test_valid_example_and_committed_catalogue():
    assert check(base()) == []
    doc = json.loads((HERE / "objects.json").read_text(encoding="utf-8"))
    assert check(doc) == []


def test_ids_parents_and_duplicates():
    assert any("parent" in e for e in errs_for(lambda d: d["objects"].pop(1)))
    assert any("duplicate" in e for e in errs_for(lambda d: d["objects"].append(copy.deepcopy(d["objects"][0]))))
    assert any("lower-case" in e for e in errs_for(lambda d: d["objects"][0].update(id="Brot Regal")))


def test_enums_sigma_and_required_geometry():
    assert any("source" in e for e in errs_for(lambda d: d["objects"][0].update(source="guess")))
    assert any("sigma_m" in e for e in errs_for(lambda d: d["objects"][0].update(sigma_m=-1)))
    assert any("required once" in e for e in errs_for(lambda d: d["objects"][0].update(placement=None)))
    assert any("info card" in e for e in errs_for(lambda d: d["objects"][0].update(info_de="")))


def test_rel_placement_target_and_cycles():
    assert any("rel.to" in e for e in errs_for(lambda d: d["objects"][1]["placement"]["rel"].update(to="nope")))

    def cycle(d):
        d["objects"][0]["placement"] = {"rel": {"to": "brotregal/ebene-2", "offset": [0, 0, 0]}}
    assert any("cycle" in e for e in errs_for(cycle))


def test_privacy_rules():
    # private files or paths in refs
    assert any("private" in e for e in errs_for(lambda d: d["objects"][0].update(refs=["fotos/theke.jpg"])))
    assert any("private" in e for e in errs_for(lambda d: d["objects"][0].update(refs=["/Users/x/theke"])))
    # prices only with consent
    assert any("consent" in e for e in errs_for(lambda d: d["objects"][2].update(preis_eur=3.2)))
    assert not errs_for(lambda d: (d["consent"].update(prices=True), d["objects"][2].update(preis_eur=3.2)))
    # areas outside the consent scope must not be public
    assert any("consent scope" in e for e in errs_for(lambda d: d["objects"][0].update(area="backstube")))
    assert not errs_for(lambda d: d["objects"][0].update(area="backstube", public=False))
