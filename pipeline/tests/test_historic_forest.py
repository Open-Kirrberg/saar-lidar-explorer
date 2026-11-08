"""historic_forest.py: TK25 tree-symbol detector, density → mask, u8 bit encoding (contract "Historic forest mask")."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import historic_forest as HF  # noqa: E402
from common import APP_DATA  # noqa: E402


def _paste(img: np.ndarray, t: np.ndarray, r: int, c: int) -> None:
    k = t.shape[0] // 2
    img[r - k:r + k + 1, c - k:c + k + 1] = np.minimum(img[r - k:r + k + 1, c - k:c + k + 1], t)


def test_templates_are_ink_on_paper():
    for make in (HF.omega_template, HF.lambda_template):
        t = make(1.0)
        assert t.shape[0] == t.shape[1] and t.shape[0] % 2 == 1
        assert t.max() > 0.95 and t.min() < 0.3          # paper and ink
        assert 0.05 < (t < 0.5).mean() < 0.4              # a thin glyph, not a blob
    o = HF.omega_template(1.0)
    k = o.shape[0] // 2
    assert o[k, k] > 0.95                                 # the ring is open inside
    assert HF.omega_template(1.15).shape[0] > o.shape[0]


def test_detect_symbols_finds_planted_glyphs_not_blank_paper_or_lines():
    rng = np.random.default_rng(0)
    g = (1.0 + 0.01 * rng.standard_normal((300, 300))).astype(np.float32)
    assert len(HF.detect_symbols(g)) == 0                # blank paper: NCC is meaningless there, gated by std
    g[200:204, :] = 0.1                                  # a long contour line
    om, la = HF.omega_template(1.0), HF.lambda_template(1.0)
    spots = [(50, 50, om), (50, 150, la), (120, 80, om), (120, 230, la)]
    for r, c, t in spots:
        _paste(g, t.astype(np.float32), r, c)
    pk = HF.detect_symbols(g)
    for r, c, _t in spots:
        assert np.min(np.hypot(pk[:, 0] - r, pk[:, 1] - c)) <= 3
    assert not np.any(np.abs(pk[:, 0] - 202) <= 6)        # nothing on the plain line
    valid = np.ones_like(g, bool)
    valid[:100] = False
    pk2 = HF.detect_symbols(g, valid)
    assert np.all(pk2[:, 0] >= 100)


def test_density_threshold_needs_two_symbols():
    lone = HF.density_per_ha(np.array([[500, 500]]), (1000, 1000))
    assert lone.max() == pytest.approx(1e4 / (2 * np.pi * HF.SIGMA_M ** 2), rel=0.05)   # ≈ 0.64 per ha
    assert lone.max() < HF.DENSITY_MIN
    pair = HF.density_per_ha(np.array([[500, 500], [500, 530]]), (1000, 1000))
    assert pair.max() >= HF.DENSITY_MIN
    grid = np.array([[r, c] for r in range(0, 1000, 80) for c in range(0, 1000, 80)])     # ≈ 1.6 per ha
    d = HF.density_per_ha(grid, (1000, 1000))
    assert d[100, 100] == pytest.approx(1e4 / 80 ** 2, rel=0.1)
    assert d.shape == (200, 200)
    assert HF.density_per_ha(np.zeros((0, 2), int), (12, 7)).shape == (3, 2)


def test_clean_mask_drops_small_parts_and_closes_small_holes():
    m = np.zeros((100, 100), bool)
    m[10:60, 10:60] = True          # 6.25 ha
    m[30:32, 30:32] = False         # 0.01 ha hole → closed
    m[80:83, 80:83] = True          # 0.0225 ha speck → dropped
    m[45:60, 70:100] = True         # 1.125 ha part touching the border → kept
    out = HF.clean_mask(m)
    assert out[31, 31] and not out[81, 81] and out[50, 90]
    big = np.ones((100, 100), bool)
    big[20:60, 20:60] = False       # 4 ha clearing → kept open
    assert not HF.clean_mask(big)[40, 40]


def test_cell_fraction_and_encoding_round_trip():
    px = np.zeros((12, 7), bool)
    px[:5, :5] = True
    f = HF.cell_fraction(px)
    assert f.shape == (3, 2) and f[0, 0] == 1.0 and f[0, 1] == 0.0
    assert f[2, 1] == 0.0
    shape = (2, 3)
    forest = {1935: np.array([[1, 0, 1], [0, 1, 0]], bool), 1840: None}
    nomap = {1935: np.array([[0, 0, 1], [0, 0, 0]], bool), 1840: np.array([[1, 0, 0], [0, 0, 0]], bool)}
    v = HF.encode(forest, nomap, shape)
    assert v.tolist() == [[2 | 4, 0, 8], [0, 2, 0]]       # no-map wins over forest (cell [0,2])
    assert HF.decode(int(v[0, 0])) == {"nodata": False, 1840: None, 1935: True}
    assert HF.decode(int(v[0, 2])) == {"nodata": False, 1840: False, 1935: None}
    assert HF.decode(255) == {"nodata": True}
    assert v.max() < HF.NODATA


def test_cell_center_matches_contract_grid():
    assert HF.cell_center(378000, 5468000, 0, 0) == (378002.5, 5467997.5)
    assert HF.cell_center(378000, 5468000, 1199, 1599) == (383997.5, 5460002.5)


def test_precision_recall_skips_unsure():
    r = HF.precision_recall([True, True, False, False, True], [True, False, True, False, None])
    assert (r["tp"], r["fp"], r["fn"], r["tn"], r["unsure"]) == (1, 1, 1, 1, 1)
    assert r["precision"] == 0.5 and r["recall"] == 0.5 and r["accuracy"] == 0.5 and r["n"] == 4


@pytest.mark.parametrize("aoi", ["overall"])
def test_published_mask_follows_contract(aoi):
    """The generated file (if built) matches its manifest entry: size, values, epochs (contract binding)."""
    man = APP_DATA / aoi / "manifest.json"
    if not man.exists() or "forest_hist" not in json.loads(man.read_text()):
        pytest.skip(f"no forest_hist for {aoi}")
    from PIL import Image
    m = json.loads(man.read_text())
    e = m["forest_hist"]
    assert e["format"] == "sle-forest-hist-v1" and e["encoding"] == "u8-bits" and e["nodata"] == 255
    assert e["size"] == {"width": -(-m["size"]["width"] // e["cellSize"]),
                         "height": -(-m["size"]["height"] // e["cellSize"])}
    im = Image.open(APP_DATA / aoi / e["path"])
    assert im.mode == "L" and im.size == (e["size"]["width"], e["size"]["height"])
    v = np.asarray(im)
    assert set(np.unique(v).tolist()) <= set(range(16)) | {255}
    by_year = {ep["year"]: ep for ep in e["epochs"]}
    assert by_year[1840]["classified"] is False and not (v[v != 255] & 1).any()   # unknown epoch: bit never set
    assert by_year[1935]["bit"] == 1 and by_year[1935]["noMapBit"] == 3
    assert e["attribution"] in m["attribution"]
