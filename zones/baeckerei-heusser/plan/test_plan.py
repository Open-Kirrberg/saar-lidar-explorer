"""Tests for the Raumplan check + redaction: cd pipeline && uv run python -I -m pytest -q ../zones/baeckerei-heusser/plan"""
import copy
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "scripts"))

from check_plan import check, privacy, toml_scale_factor  # noqa: E402
from redact import redact  # noqa: E402

PUBLIC = json.loads((HERE / "raumplan-v0.json").read_text(encoding="utf-8"))


def private_like():
    """The public plan plus the kind of content the full plan has beyond the privacy line (made-up positions)."""
    d = copy.deepcopy(PUBLIC)
    d.pop("privacy", None)
    d["site"]["passage"]["name_de"] = "Durchgang (überbaut) → Hof"
    d["site"]["passage"]["note_de"] = "Hof am hinteren Ende, nicht erfasst"
    d["site"]["dgm1"]["durchgang"] = {"xy": [26.4, 6.2], "h_nhn": {"v": 243.4, "sigma_m": 0.15, "source": "dgm1"}}
    x9 = copy.deepcopy(next(f for f in d["site"]["fixtures"] if f["id"] == "X1"))
    x9.update(id="X9", name_de="Kasten (erfunden)", pose={"xy": [25.6, 5.2], "z": -0.9, "rot_deg": 90.0})
    d["site"]["fixtures"].append(x9)
    room = d["levels"][0]["rooms"][0]
    room["openings"].append({"id": "O8", "type": "tuer", "wall": None, "from": [24.8, 6.6], "to": [24.8, 7.3],
                             "width": {"v": 0.8, "sigma_m": 0.23, "source": "mesh"},
                             "name_de": "Hauseingang im Durchgang (nicht erfasst)", "status": "geschaetzt"})
    return d


def test_committed_public_plan_is_valid():
    assert check(PUBLIC, public=True, toml_factor=toml_scale_factor()) == []


def test_every_value_needs_sigma_and_source():
    d = copy.deepcopy(PUBLIC)
    d["levels"][0]["rooms"][0]["ceiling"].pop("sigma_m")
    d["site"]["building"]["eaves"]["source"] = "guess"
    errs = check(d, public=False)
    assert any("ceiling" in e and "sigma_m" in e for e in errs)
    assert any("eaves" in e and "source" in e for e in errs)
    d = copy.deepcopy(PUBLIC)
    d["levels"][0]["rooms"][0]["points"]["A"].pop("source")
    assert any("points.A" in e for e in check(d, public=False))


def test_references_resolve():
    d = copy.deepcopy(PUBLIC)
    d["levels"][0]["rooms"][0]["walls"][0]["to"] = "Z"
    d["levels"][0]["rooms"][0]["openings"][0]["wall"] = "W99"
    errs = check(d, public=False)
    assert any("'Z'" in e for e in errs) and any("W99" in e for e in errs)


def test_one_scale_factor_for_plan_and_zone():
    assert check(PUBLIC, public=False, toml_factor=1.05)
    assert check(PUBLIC, public=False, toml_factor=PUBLIC["scale"]["factor"]) == []


def test_privacy_catches_the_private_passage_and_the_courtyard():
    errs = privacy(private_like())
    text = "\n".join(errs)
    assert "Hof" in text and "Hauseingang" in text
    assert "[25.6, 5.2]" in text and "[24.8, 6.6]" in text and "[26.4, 6.2]" in text
    assert not any("X1" in e or "fixtures[" in e and "5.2" not in e for e in errs)  # the pickup cabinet is public


def test_redact_removes_private_content_and_keeps_the_shop():
    full = private_like()
    pub = redact(full)
    assert privacy(pub) == []
    assert check(pub, public=True) == []
    room_full, room_pub = full["levels"][0]["rooms"][0], pub["levels"][0]["rooms"][0]
    assert room_pub["points"] == room_full["points"]
    assert [o["id"] for o in room_pub["openings"]] == [o["id"] for o in room_full["openings"] if o["id"] != "O8"]
    assert pub["site"]["building"] == full["site"]["building"]
    fx = {f["id"]: f for f in pub["site"]["fixtures"]}
    assert fx["X1"]["pose"] == next(f for f in full["site"]["fixtures"] if f["id"] == "X1")["pose"]
    assert not fx["X9"].get("pose")
    assert redact(pub) == pub  # idempotent


def test_pickup_cabinet_is_public_and_in_front_of_the_line():
    """ADR 0047: the Abholschrank stands in the public part of the passage, the line runs just behind it."""
    from check_plan import PASSAGE_PUBLIC_Y as CHECK_Y, PASSAGE_X as CHECK_X
    from redact import PASSAGE_PUBLIC_Y, PASSAGE_X
    assert (CHECK_X, CHECK_Y) == (PASSAGE_X, PASSAGE_PUBLIC_Y) == (24.6, 4.35)
    x1 = next(f for f in PUBLIC["site"]["fixtures"] if f["id"] == "X1")
    x, y = x1["pose"]["xy"]
    assert x > PASSAGE_X and y + x1["size"]["l"] <= PASSAGE_PUBLIC_Y   # pose = street-side front corner, length along +y
    assert PUBLIC["site"]["passage"]["public_until_y"] == PASSAGE_PUBLIC_Y


def test_redact_drops_ground_samples_inside_the_passage():
    """Even in front of the line a DGM sample in the passage would pin the ground under it: dropped (y > 0)."""
    d = copy.deepcopy(PUBLIC)
    d["site"]["dgm1"]["probe"] = {"xy": [25.5, 2.0], "h_nhn": {"v": 243.5, "sigma_m": 0.15, "source": "dgm1"}}
    d["site"]["dgm1"]["mouth"] = {"xy": [25.5, -0.5], "h_nhn": {"v": 243.6, "sigma_m": 0.15, "source": "dgm1"}}
    pub = redact(d)
    assert "probe" not in pub["site"]["dgm1"] and "mouth" in pub["site"]["dgm1"]


def test_source_scan_finds_private_words_and_coordinates(tmp_path):
    from check_plan import scan_sources
    gen = tmp_path / "gen.py"
    gen.write_text('label = "Hof (nicht erfasst)"\nRX = re.compile(r"\\bHof\\b")\nxy = (12.5, 3.75)\n', encoding="utf-8")
    doc = tmp_path / "notes.md"
    doc.write_text("Lage 12.50 , 3.750 im Plan\n", encoding="utf-8")
    errs = scan_sources([gen], [gen, doc], fingerprints=[[12.5, 3.75]])
    assert sum("consent scope" in e for e in errs) == 1          # the regex line is exempt
    assert sum("coordinate pair" in e for e in errs) == 2
    assert scan_sources([gen], [gen], fingerprints=[[2.5, 3.75]]) == [e for e in errs if "consent" in e]


def test_committed_sources_carry_no_private_words():
    from check_plan import scan_sources, source_files, private_fingerprints
    assert scan_sources(*source_files(), private_fingerprints()) == []
