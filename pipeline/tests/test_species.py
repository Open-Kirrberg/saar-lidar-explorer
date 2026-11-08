"""species.py: DLR class encoding, 10 m grid resampling, species-dlr-neighbourhood-v1 probability, place mix,
cross-check confusion (contract "Tree species"). Synthetic data; the output check at the end skips without data."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import species as S  # noqa: E402
from common import APP_DATA  # noqa: E402

CONTRACT = Path(__file__).resolve().parents[2] / "docs" / "data-contract.md"


# ------------------------------------------------------------------------------------------- encodings
def test_encode_dlr_maps_classes_loss_and_nodata():
    raw = np.array([0, 5, 9, 10, 666, 999, 800, 65535], np.uint16)
    assert S.encode_dlr(raw).tolist() == [0, 5, 9, 255, 10, 255, 255, 255]
    assert S.encode_dlr(raw).dtype == np.uint8


def test_thuenen_mapping_covers_the_eleven_classes():
    raw = np.array([9, 8, 4, 10, 14, 3, 5, 2, 6, 16, 17, 0, 7, 11, 12], np.uint8)
    assert S.thuenen_to_dlr(raw).tolist() == [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 255, 255, 255, 255]


def test_classes_match_paper_table_and_contract_labels():
    codes = [c[0] for c in S.CLASSES]
    assert codes == list(range(11))
    f1 = {c[1]: c[4] for c in S.CLASSES}
    assert f1 == {"pine": 0.98, "spruce": 0.94, "douglas_fir": 0.91, "larch": 0.96, "fir": 0.88, "beech": 0.95,
                  "oak": 0.76, "birch": 0.90, "alder": 0.89, "other_broadleaf": 0.76, "canopy_loss": None}
    assert [c[2] for c in S.CLASSES][:10] == ["Kiefer", "Fichte", "Douglasie", "Lärche", "Tanne", "Buche", "Eiche",
                                              "Birke", "Erle", "andere Laubbäume"]
    assert {c[3] for c in S.CLASSES[:5]} == {"conifer"} and {c[3] for c in S.CLASSES[5:10]} == {"broadleaf"}
    assert S.F1_PCT[5] == 95 and S.F1_PCT[7] == 90 and S.LOSS not in S.F1_PCT


# ------------------------------------------------------------------------------------------- grid
def test_cell_centres_and_index_follow_forest_hist_convention():
    E, N = S.cell_centres(1000, 2000, 3, 2, 10)
    assert E[0].tolist() == [1005, 1015, 1025] and N[:, 0].tolist() == [1995, 1985]
    px, py, ok = S.cell_index(np.array([1000.0, 1029.99, 1030.0, 1005]), np.array([2000.0, 1980.01, 1990, 1980]),
                              1000, 2000, 3, 2, 10)
    assert px.tolist()[:2] == [0, 2] and py.tolist()[:2] == [0, 1]
    assert ok.tolist() == [True, True, False, False]       # E = east edge and N = south edge are outside
    # round trip: every centre maps back to its own cell
    px, py, ok = S.cell_index(E.ravel(), N.ravel(), 1000, 2000, 3, 2, 10)
    assert ok.all() and px.tolist() == [0, 1, 2, 0, 1, 2] and py.tolist() == [0, 0, 0, 1, 1, 1]


def test_sample_containing_edges_and_outside():
    src = np.arange(12, dtype=np.uint16).reshape(3, 4)     # 4 × 3 px of 10 m, west 0, north 30
    x = np.array([0.0, 9.99, 10.0, 39.99, 40.0, -0.01, 5.0])
    y = np.array([30.0, 25.0, 25.0, 0.01, 5.0, 5.0, 0.0])
    assert S.sample_containing(src, 0, 30, 10, x, y, 999).tolist() == [0, 0, 1, 11, 999, 999, 999]


def test_to_grid_identity_on_aligned_utm_source():
    src = np.arange(20, dtype=np.uint16).reshape(4, 5)
    out = S.to_grid(src, "EPSG:25832", 500, 1040, 10, e0=500, n1=1040, width=5, height=4, fill=999)
    assert (out == src).all()
    shifted = S.to_grid(src, "EPSG:25832", 500, 1040, 10, e0=510, n1=1030, width=5, height=4, fill=999)
    assert (shifted[:3, :4] == src[1:, 1:]).all() and (shifted[3] == 999).all() and (shifted[:, 4] == 999).all()


def test_to_grid_laea_matches_pointwise_pyproj_and_overlaps_agree():
    from pyproj import Transformer
    rng = np.random.default_rng(3)
    x0, y1 = 4122880.0, 2922310.0                          # LAEA window like the real cache
    src = rng.integers(0, 10, size=(1900, 1300)).astype(np.uint16)
    big = S.to_grid(src, "EPSG:3035", x0, y1, 10, e0=378000, n1=5468000, width=60, height=80, fill=999)
    small = S.to_grid(src, "EPSG:3035", x0, y1, 10, e0=378200, n1=5467500, width=20, height=10, fill=999)
    assert (big != 999).all() and (big[50:60, 20:40] == small).all()              # shared cells identical (overall ⊂ orte)
    t = Transformer.from_crs("EPSG:25832", "EPSG:3035", always_xy=True)
    for px, py in [(0, 0), (59, 79), (17, 33)]:
        x, y = t.transform(378000 + (px + 0.5) * 10, 5468000 - (py + 0.5) * 10)
        col, row = int((x - x0) // 10), int((y1 - y) // 10)
        assert big[py, px] == src[row, col]


def test_window_in_covers_bbox_corners():
    from pyproj import Transformer
    bbox = (375000, 5453000, 387000, 5471000)
    x0, y0, x1, y1 = S.window_in("EPSG:3035", bbox)
    t = Transformer.from_crs("EPSG:25832", "EPSG:3035", always_xy=True)
    for e in (bbox[0], bbox[2]):
        for n in (bbox[1], bbox[3]):
            x, y = t.transform(e, n)
            assert x0 < x < x1 and y0 < y < y1


# ------------------------------------------------------------------------------------------- probability
def test_neighbourhood_counts_centre_edge_corner():
    r = np.array([[5, 5, 6],
                  [5, 5, 255],
                  [0, 5, 5]], np.uint8)
    c, k, n = S.neighbourhood(r, np.array([1, 0, 2, 2]), np.array([1, 0, 0, 1]))
    assert c.tolist() == [5, 5, 6, 255]
    assert n.tolist() == [9, 4, 4, 6]
    assert k.tolist() == [6, 4, 1, 1]


@pytest.mark.parametrize("k,n,f,x,pct", [
    (9, 9, 95, False, 90), (6, 9, 95, False, 60), (1, 2, 90, False, 50), (3, 4, 76, False, 60),
    (9, 9, 76, True, 40), (1, 9, 76, True, 10),
])
def test_probability_contract_vectors(k, n, f, x, pct):
    assert S.probability_pct(k, n, f, x) == pct


def test_probability_vectors_are_in_the_contract():
    text = CONTRACT.read_text(encoding="utf-8")
    sec = text[text.index("## 🌲 Tree species"):text.index("## 🏆 Place statistics")]
    rows = re.findall(r"^\| (\d) \| (\d) \| (\d+) \| (true|false) \| (\d+)", sec, re.M)
    assert len(rows) == 6
    for k, n, f, x, pct in rows:
        assert S.probability_pct(int(k), int(n), int(f), x == "true") == int(pct)
    for word in ("sle-species-v1", "species-dlr-neighbourhood-v1", "dlr-nearest-25832-v1",
                 "floor((num + 5 · den) / (10 · den))", "type-conifer-in-broadleaf-class"):
        assert word in sec


def test_probability_is_half_up_and_monotone():
    for n in (4, 6, 9):
        for f in sorted(set(S.F1_PCT.values())):
            prev = 0
            for k in range(1, n + 1):
                p = S.probability_pct(k, n, f, False)
                exact = k * f / n
                assert p == max(10, min(90, 10 * int(exact / 10 + 0.5 + 1e-12)))
                assert p >= prev and p >= S.probability_pct(k, n, f, True)
                prev = p
    with pytest.raises(ValueError):
        S.probability_pct(0, 9, 95, False)


def test_contradiction_is_one_sided():
    assert S.contradicts(5, 1) and S.contradicts(9, 1) and S.contradicts(6, 1 | 0x80)   # dark crown in broadleaf
    assert not S.contradicts(0, 2) and not S.contradicts(1, 2) and not S.contradicts(3, 2)  # bright conifers
    assert not S.contradicts(5, 2) and not S.contradicts(5, 0) and not S.contradicts(5, 7)
    assert not S.contradicts(0, 1) and not S.contradicts(S.LOSS, 1) and not S.contradicts(255, 1)
    assert S.certainty(60, False) == "wahrscheinlich" and S.certainty(50, False) == "wahrscheinlich"
    assert S.certainty(40, False) == "unsicher" and S.certainty(90, True) == "unsicher"


def test_tree_species_per_tree():
    r = np.full((4, 4), 255, np.uint8)
    r[0:3, 0:3] = 5                                        # a 3 × 3 beech block in the north-west
    r[1, 1] = 5
    r[3, 3] = S.LOSS
    r[0, 3] = 0
    E = np.array([15.0, 15.0, 5.0, 35.0, 35.0, 99.0, 25.0])
    N = np.array([25.0, 25.0, 35.0, 5.0, 35.0, 5.0, 5.0])  # n1 = 40
    t = np.array([2, 1, 0, 2, 2, 2, 2], np.uint8)
    out = S.tree_species(r, E, N, t, e0=0, n1=40)
    assert out["code"].tolist() == [5, 5, 5, 255, 0, 255, 255]
    assert out["contra"].tolist() == [False, True, False, False, False, False, False]
    # centre (1,1): k = n = 9 → 95 → 90; contra → 9·95/18 = 47.5 → 50; corner (0,0): k = n = 4 → 90;
    # pine at (3,0): n = 4, k = 1 → 98/4 = 24.5 → 20
    assert out["pct"].tolist() == [90, 50, 90, 0, 20, 0, 0]


def test_place_mix_crown_weighted():
    code = np.array([5, 5, 0, 255, 6], np.uint8)
    r = np.array([2.0, 2.0, 4.0, 3.0, 0.0])
    pct = np.array([80, 60, 40, 0, 50], np.uint8)
    contra = np.array([False, False, False, False, True])
    t = np.array([2, 2, 2, 1, 1], np.uint8)
    m = S.place_mix(code, pct, contra, r, t)
    assert m["trees"] == 5 and m["trees_with_species"] == 4
    assert m["mix_pct"] == {"pine": 66.7, "beech": 33.3}           # 16π vs 2·4π; the oak has no crown area
    assert m["dominant"]["key"] == "pine" and m["dominant"]["label_de"] == "Kiefer"
    assert m["conifer_pct"] == 66.7
    assert m["coverage_pct"] == round(100 * 24 / 33, 1)            # the 255 tree (9π) has no species
    assert m["dop_conifer_pct"] == round(100 * 9 / 33, 1)
    assert m["prob_mean_pct"] == 57.5 and m["contradicts_pct"] == 25.0 and m["likely_pct"] == 50.0
    empty = S.place_mix(np.array([255], np.uint8), np.zeros(1, np.uint8), np.zeros(1, bool), np.ones(1),
                        np.zeros(1, np.uint8))
    assert empty["dominant"] is None and empty["conifer_pct"] is None and empty["mix_pct"] == {}


def test_type_by_class():
    out = S.type_by_class(np.array([0, 0, 0, 5]), np.array([2, 2, 1, 0]))
    assert out["pine"] == {"n": 3, "unknown": 0.0, "conifer": 33.3, "broadleaf": 66.7}
    assert out["beech"]["unknown"] == 100.0 and "oak" not in out


# ------------------------------------------------------------------------------------------- cross-check
def test_confusion_table():
    a = np.array([5, 5, 5, 6, 0, 255, 10, 1])
    b = np.array([5, 6, 5, 6, 1, 5, 5, 255])
    r = S.confusion(a, b)
    assert r["n"] == 5 and r["agree_pct"] == 60.0
    assert r["group_agree_pct"] == 100.0                   # 0 ↔ 1 both conifer, 5 ↔ 6 both broadleaf
    assert r["per_class"]["beech"] == {"n_dlr": 3, "n_thuenen": 2, "agree": 2, "agree_of_dlr_pct": 66.7,
                                       "agree_of_thuenen_pct": 100.0, "dice": 0.8}
    assert r["per_class"]["pine"]["agree"] == 0 and r["per_class"]["spruce"]["n_dlr"] == 0
    assert np.array(r["table"]).sum() == 5


# ------------------------------------------------------------------------------------------- manifest
def test_manifest_entry_shape():
    e = S.manifest_entry(600, 800, "2026-11-08T00:00:00Z", {"n": 1})
    assert e["format"] == "sle-species-v1" and e["path"] == "species/species.png" and e["cellSize"] == 10
    assert e["size"] == {"width": 600, "height": 800} and e["nodata"] == 255
    assert e["label_de"] == "Baumart (Schätzung, 10-m-Raster)"
    assert [c["code"] for c in e["classes"]] == list(range(11))
    assert all(("f1" in c) == c["species"] for c in e["classes"])
    assert e["probability"]["method"] == "species-dlr-neighbourhood-v1" and e["probability"]["maxPct"] == 90
    assert ";" not in e["attribution"] and "CC BY 4.0" in e["attribution"] and "DLR" in e["attribution"]
    assert ";" not in S.ATTRIBUTION_THUENEN and e["crossCheck"] == {"n": 1}
    assert "crossCheck" not in S.manifest_entry(1, 1, "x")


def test_written_layer_matches_manifest_if_present():
    man = APP_DATA / "overall" / "manifest.json"
    if not man.exists():
        pytest.skip("no overall manifest")
    m = json.loads(man.read_text())
    if "species" not in m:
        pytest.skip("species step not run")
    from PIL import Image
    e = m["species"]
    assert e["format"] == "sle-species-v1"
    img = Image.open(APP_DATA / "overall" / e["path"])
    assert img.mode == "L" and img.size == (e["size"]["width"], e["size"]["height"])
    assert img.size == (m["size"]["width"] // 10, m["size"]["height"] // 10)
    v = np.asarray(img)
    assert set(np.unique(v).tolist()) <= set(range(11)) | {255}
    assert S.ATTRIBUTION_DLR in m["attribution"]


def test_tree_group_species_wins_over_colour_type():
    # tree-group-v1 (contract "Tree species"); the app's treeGroup (tests/treesSpecies.test.ts) tests the same cases
    code = np.array([0, 0, 5, 5, 0, 0, 255, 255, 10, 6, 6, 2], np.uint8)
    pct = np.array([90, 40, 80, 80, 40, 40, 0, 0, 0, 40, 30, 50], np.uint8)
    ttype = np.array([2, 2, 2, 1, 1, 0, 1, 2, 2, 2, 0x81, 0], np.uint8)
    g = S.tree_group(code, pct, ttype)
    # likely pine over a „broadleaf“ colour → conifer; unsure pine vs broadleaf colour → none; likely beech → broadleaf;
    # beech with a conifer colour = contradiction → unsure → disagree → none; unsure pine with conifer colour → conifer;
    # unsure pine with unknown colour → none; no class → colour type; canopy loss → colour; unsure oak + broadleaf
    # colour → broadleaf; oak + conifer fill tree → contradiction → none; Douglas fir 50 % → conifer
    assert g.tolist() == [1, 0, 2, 0, 1, 0, 1, 2, 2, 2, 0, 1]
    assert g.dtype == np.uint8
    assert S.tree_group(np.array([255]), np.array([0]), np.array([7])).tolist() == [0]   # unknown type code → 0
