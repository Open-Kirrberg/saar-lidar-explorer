"""Tests for the catalogue check: cd pipeline && uv run python -I -m pytest -q ../zones/baeckerei-heusser/catalogue"""
import copy
import json
from pathlib import Path

from check import SLOT_CATEGORIES, check, check_slots

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


def slots_base():
    return {
        "format": "bh-slots-v1",
        "categories": list(SLOT_CATEGORIES),
        "slots": [
            {"id": "brotregal/ebene-2/platz-01", "fixture": "brotregal/ebene-2",
             "pose": {"x": 4.1, "y": 1.6, "z": -2.0, "heading_deg": 225.0}, "tilt_deg": 25.0,
             "size": {"w": 0.23, "d": 0.36, "h": 0.26}, "capacity": 1, "capacity_de": "1 Brot", "categories": ["brot"]},
            {"id": "brotregal/platz-01", "fixture": "brotregal",
             "pose": {"x": 4.0, "y": 0.9, "z": -2.0, "heading_deg": 225.0}, "tilt_deg": 0.0,
             "size": {"w": 0.5, "d": 0.3, "h": 0.2}, "capacity": 20, "capacity_de": "", "categories": ["broetchen", "laugengebaeck"]},
        ],
    }


def slot_errs(mutate, known=("brotregal", "brotregal/ebene-2")):
    doc = slots_base()
    mutate(doc)
    return check_slots(doc, set(known))


def test_slots_valid_example_and_committed_slots():
    assert check_slots(slots_base(), {"brotregal", "brotregal/ebene-2"}) == []
    path = HERE / "slots.json"
    if path.is_file():
        known = {o["id"] for o in json.loads((HERE / "objects.json").read_text(encoding="utf-8"))["objects"]}
        doc = json.loads(path.read_text(encoding="utf-8"))
        assert check_slots(doc, known) == []
        assert len({s["id"] for s in doc["slots"]}) == len(doc["slots"])


def test_slots_rules():
    assert any("format" in e for e in slot_errs(lambda d: d.update(format="x")))
    assert any("platz-NN" in e for e in slot_errs(lambda d: d["slots"][0].update(id="brotregal/ebene-2/brot-1")))
    assert any("start with" in e for e in slot_errs(lambda d: d["slots"][0].update(fixture="brotregal")))
    assert any("duplicate" in e for e in slot_errs(lambda d: d["slots"].append(copy.deepcopy(d["slots"][0]))))
    assert any("catalogue id" in e for e in slot_errs(lambda d: None, known=("brotregal",)))
    assert any("categories" in e for e in slot_errs(lambda d: d["slots"][0].update(categories=["torte"])))
    assert any("categories" in e for e in slot_errs(lambda d: d["slots"][0].update(categories=[])))
    assert any("pose" in e for e in slot_errs(lambda d: d["slots"][0]["pose"].pop("y")))
    assert any("heading" in e for e in slot_errs(lambda d: d["slots"][0]["pose"].update(heading_deg=360.0)))
    assert any("size" in e for e in slot_errs(lambda d: d["slots"][0]["size"].update(d=0)))
    assert any("capacity" in e for e in slot_errs(lambda d: d["slots"][0].update(capacity=0)))
    assert any("capacity" in e for e in slot_errs(lambda d: d["slots"][0].update(capacity=True)))
    assert any("tilt" in e for e in slot_errs(lambda d: d["slots"][0].update(tilt_deg=90)))
    assert any("prices" in e for e in slot_errs(lambda d: d["slots"][0].update(preis_eur=2.5)))


def test_discover_needs_a_clickable_card():
    assert errs_for(lambda d: d["objects"][0].update(discover=True)) == []
    assert any("discover" in e for e in errs_for(lambda d: d["objects"][1].update(discover=True)))       # not clickable
    assert any("discover" in e for e in errs_for(lambda d: d["objects"][0].update(discover="ja")))
    doc = json.loads((HERE / "objects.json").read_text(encoding="utf-8"))
    assert 12 <= sum(1 for o in doc["objects"] if o.get("discover")) <= 25      # a curated list, not every object
