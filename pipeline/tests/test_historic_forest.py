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


# --- stats area (blockwise, `--stats`) -----------------------------------------------------------------------------

def test_stats_blocks_on_global_grid():
    b = HF.stats_blocks((375000, 5453000, 387000, 5471000))
    es, ns = sorted({e for e, _ in b}), sorted({n for _, n in b})
    assert es[0] == 374000 and es[-1] == 386000 and ns[0] == 5452000 and ns[-1] == 5470000
    assert all(e % 2000 == 0 and n % 2000 == 0 for e, n in b) and len(b) == 7 * 10
    assert HF.stats_blocks((378000, 5460000, 384000, 5468000)) == [(e, n) for n in range(5460000, 5468000, 2000)
                                                                   for e in range(378000, 384000, 2000)]


def test_assemble_window_places_neighbours_north_up():
    B, M = HF.STATS_BLOCK_M, HF.STATS_MARGIN_M
    nb, win = HF.block_window(2000, 4000)
    assert win == (2000 - M, 4000 - M, 4000 + M, 6000 + M) and len(nb) == 9 and (2000, 4000) in nb

    def blk(val):
        a = np.zeros((B, B, 4), np.uint8)
        a[..., 0] = val
        a[..., 3] = 255
        a[0, 0, 1] = 7          # marks the NW corner pixel of each block
        return a

    imgs = {k: None for k in nb}
    imgs[(2000, 4000)] = blk(10)        # centre
    imgs[(2000, 6000)] = blk(20)        # north neighbour
    imgs[(4000, 4000)] = blk(30)        # east neighbour
    w = HF.assemble_window(imgs, win)
    assert w.shape == (B + 2 * M, B + 2 * M, 4)
    assert w[M, M, 0] == 10 and w[M, M, 1] == 7            # centre's NW pixel at (margin, margin)
    assert w[M - 1, M, 0] == 20                             # row above the centre comes from the north block
    assert w[M + 5, M + B, 0] == 30                         # first column east of the centre: east block
    assert w[M + B + 5, M + 5, 3] == 0                      # missing south block → transparent


def test_classify_blocks_has_no_seam_at_block_edges():
    """A symbol field straddling a block edge is found on both sides and gives one connected forest patch."""
    rng = np.random.default_rng(1)
    B = HF.STATS_BLOCK_M
    blocks = [(0, 0), (B, 0)]
    om = HF.omega_template(1.0)
    canvas = np.clip(0.93 + 0.12 * rng.random((B, 2 * B)), 0, 1).astype(np.float32)   # textured paper
    k = om.shape[0] // 2
    for r in range(B // 2 - 300, B // 2 + 300, 60):
        for c in range(B - 400, B + 400, 60):
            canvas[r - k:r + k + 1, c - k:c + k + 1] = np.minimum(canvas[r - k:r + k + 1, c - k:c + k + 1], om)
    rgb = (canvas * 230).astype(np.uint8)

    def get(b):
        a = np.zeros((B, B, 4), np.uint8)
        a[..., :3] = rgb[:, b[0]:b[0] + B, None]
        a[..., 3] = 255
        return a

    res = HF.classify_blocks(blocks, get, (0, 0, 2 * B, B))
    f = res["forest"]
    row = (B // 2) // HF.CELL_M
    assert f[row, (B - 300) // HF.CELL_M] and f[row, (B + 300) // HF.CELL_M]
    assert f[row, B // HF.CELL_M - 1] and f[row, B // HF.CELL_M]      # both sides of the seam
    assert not f[20, 20]                                                # blank paper away from the field
    from scipy import ndimage as ndi
    assert ndi.label(f)[1] == 1
    assert (res["value"] != HF.NODATA).all()
