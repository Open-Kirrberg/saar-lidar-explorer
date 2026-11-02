"""F9 overview levels: downsampling, cell-centre maths, chunk counts (pure) + generated output (if built)."""
from __future__ import annotations

import json
import sys
import tomllib
from pathlib import Path

import numpy as np
import pytest
import rasterio
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import APP_DATA, WORK_DIR, load_aoi  # noqa: E402
from encode import terrarium_decode, u8_decode  # noqa: E402
from levels import (  # noqa: E402
    block_mean, cell_centre, layer_chunk_clamped, level0_entry, level_grid, level_size, write_levels,
)


# ------------------------------------------------------------------------------------------- pure
def test_level_size_and_chunks_contract_examples():
    # data-contract "Sizes": overall 6000 × 8000 m → 12×16, 6×8, 3×4, 2×2, 1×1
    assert [level_grid(6000, 8000, k)["chunks"] for k in range(5)] == [
        {"nx": 12, "ny": 16}, {"nx": 6, "ny": 8}, {"nx": 3, "ny": 4}, {"nx": 2, "ny": 2}, {"nx": 1, "ny": 1}]
    # Karlsberg 3000 m: level 4 → 188 cells (3008 m), level 1 → 1500 / 3×3, level 3 → 375 / 1×1
    assert level_size(3000, 4) == 188 and level_size(3000, 1) == 1500 and level_size(3000, 3) == 375
    assert level_grid(3000, 3000, 2) == {"cellSize": 4, "size": {"width": 750, "height": 750},
                                         "chunks": {"nx": 2, "ny": 2}}
    assert level_grid(3000, 3500, 1)["chunks"] == {"nx": 3, "ny": 4}  # kirrberg 3000 × 3500
    for size0 in (500, 3000, 3500, 6000, 8000):
        for k in range(1, 5):
            n0 = level_grid(size0, size0, k - 1)["chunks"]["nx"]
            n1 = level_grid(size0, size0, k)["chunks"]["nx"]
            assert n1 == -(-n0 // 2)  # each level-k chunk has ≤ 2×2 children, no orphans


def test_block_mean_exact_and_edge_clamp():
    a = np.arange(36, dtype=np.float64).reshape(6, 6)
    m = block_mean(a, 2)
    assert m.shape == (3, 3)
    assert m[0, 0] == np.mean([0, 1, 6, 7]) and m[2, 2] == np.mean([28, 29, 34, 35])
    # 6 cells at f=4 → 2 cells; the partial block is edge-clamp padded (cols 4,5,5,5)
    m4 = block_mean(a, 4)
    assert m4.shape == (2, 2)
    rows = [0, 1, 2, 3]
    cols = [4, 5, 5, 5]
    assert m4[0, 1] == pytest.approx(a[np.ix_(rows, cols)].mean())
    assert m4[1, 1] == pytest.approx(a[np.ix_([4, 5, 5, 5], cols)].mean())
    assert block_mean(a, 1) is not a and np.array_equal(block_mean(a, 1), a)


def test_block_mean_preserves_planes_at_cell_centres():
    """A plane z = a·E + b·N sampled at 1 m centres averages to the plane at the level-k cell centre."""
    e0, n0, W, H = 381000, 5465000, 40, 24
    n_top = n0 + H
    c, r = np.meshgrid(np.arange(W), np.arange(H))
    E, N = e0 + c + 0.5, n_top - r - 0.5
    plane = lambda e, n: 0.013 * (e - e0) - 0.021 * (n - n0) + 300.0  # noqa: E731
    dtm = plane(E, N)
    for k in (1, 2, 3):
        f = 1 << k
        m = block_mean(dtm, f)
        for (cc, rr) in [(0, 0), (W // f - 1, H // f - 1), (1, 2)]:
            ec, nc = cell_centre(e0, n_top, cc, rr, f)
            assert m[rr, cc] == pytest.approx(plane(ec, nc), abs=1e-9)


def test_cell_centre_nw_anchor():
    assert cell_centre(381000, 5468000, 0, 0, 1) == (381000.5, 5467999.5)
    assert cell_centre(381000, 5468000, 0, 0, 16) == (381008.0, 5467992.0)
    assert cell_centre(381000, 5468000, 187, 187, 16) == (381000 + 187.5 * 16, 5468000 - 187.5 * 16)


def test_layer_chunk_clamped_full_size():
    a = np.arange(30 * 20, dtype=np.float64).reshape(20, 30)
    ch = layer_chunk_clamped(a, 1, 0, cs=16)  # cols 16..31 → 16..29 real, 30/31 clamp to 29
    assert ch.shape == (16, 16)
    assert np.array_equal(ch[:, :14], a[:16, 16:30]) and np.array_equal(ch[:, 15], a[:16, 29])


def test_write_levels_roundtrip(tmp_path):
    rng = np.random.default_rng(1)
    dtm = 250 + rng.normal(0, 3, (1000, 1500))  # 3×2 chunks at level 0
    vat = rng.uniform(0, 1, dtm.shape)
    top = {"vat": {"path": "relief/vat/{i}_{j}.png", "encoding": "u8", "min": 0.0, "max": 1.0, "label_de": "VAT"},
           "hillshade": {"path": "relief/hillshade/{i}_{j}.png", "encoding": "u8", "min": 0.0, "max": 1.0,
                         "label_de": "S"}}
    entries = write_levels(tmp_path, dtm, {"vat": vat}, top, n_levels=3, cs=500)
    assert [e["level"] for e in entries] == [1, 2, 3]
    assert [e["chunks"] for e in entries] == [{"nx": 2, "ny": 1}, {"nx": 1, "ny": 1}, {"nx": 1, "ny": 1}]
    assert entries[0]["height"]["dtm"] == {"path": "levels/1/dtm/{i}_{j}.png", "encoding": "terrarium", "apron": 1}
    assert set(entries[0]["layers"]) == {"vat"}  # hillshade array not given → omitted
    assert entries[0]["layers"]["vat"]["path"] == "levels/1/vat/{i}_{j}.png"
    for e in entries:
        k = e["level"]
        m = block_mean(dtm, 1 << k)
        for j in range(e["chunks"]["ny"]):
            for i in range(e["chunks"]["nx"]):
                with Image.open(tmp_path / f"levels/{k}/dtm/{i}_{j}.png") as im:
                    assert im.size == (502, 502) and im.mode == "RGB"
                    h = terrarium_decode(np.asarray(im))
                real_w = min(500, e["size"]["width"] - i * 500)
                real_h = min(500, e["size"]["height"] - j * 500)
                assert np.abs(h[1:1 + real_h, 1:1 + real_w] - m[j * 500:j * 500 + real_h, i * 500:i * 500 + real_w]).max() < 0.003
                with Image.open(tmp_path / f"levels/{k}/vat/{i}_{j}.png") as im:
                    assert im.size == (500, 500) and im.mode == "L"
    assert not (tmp_path / "levels" / "4").exists()


def test_level0_entry_repeats_top_level():
    m = {"cellSize": 1, "chunkSize": 500, "size": {"width": 3000, "height": 3000}, "chunks": {"nx": 6, "ny": 6},
         "height": {"dtm": {"path": "dtm/{i}_{j}.png"}}, "layers": {"vat": {"path": "relief/vat/{i}_{j}.png"}}}
    e = level0_entry(m)
    assert e["level"] == 0 and e["height"] is m["height"] and e["layers"] is m["layers"]


# --------------------------------------------------------------------------- generated output
_KNOWN = [k for k in tomllib.loads((Path(__file__).resolve().parents[1] / "aois.toml").read_text()) if k != "defaults"]


def _with_levels():
    out = []
    for k in _KNOWN:
        mf = APP_DATA / k / "manifest.json"
        if mf.exists() and (WORK_DIR / k / "dtm.tif").exists() and "levels" in json.loads(mf.read_text()):
            out.append(k)
    return out


LEVEL_AOIS = _with_levels()


@pytest.mark.skipif(not LEVEL_AOIS, reason="no AOI built with levels")
@pytest.mark.parametrize("aoi", LEVEL_AOIS)
def test_generated_levels(aoi):
    a = load_aoi(aoi)
    m = json.loads((APP_DATA / aoi / "manifest.json").read_text())
    assert m["version"] == 2
    L = m["levels"]
    assert [e["level"] for e in L] == list(range(len(L))) and len(L) == 5
    assert L[0]["height"] == m["height"] and L[0]["layers"] == m["layers"] and L[0]["chunks"] == m["chunks"]
    with rasterio.open(WORK_DIR / aoi / "dtm.tif") as ds:
        dtm = ds.read(1).astype(np.float64)
    for e in L[1:]:
        k = e["level"]
        g = level_grid(a.width, a.height, k)
        assert e["cellSize"] == 2 ** k and e["size"] == g["size"] and e["chunks"] == g["chunks"]
        assert e["height"]["dtm"]["path"] == f"levels/{k}/dtm/{{i}}_{{j}}.png"
        u8 = {key: lay for key, lay in e["layers"].items() if lay.get("encoding") != "rgb"}  # rgb: test_ortho.py
        assert set(u8) == {"vat", "hillshade"}
        for key, lay in u8.items():
            assert lay["encoding"] == "u8" and lay["min"] == m["layers"][key]["min"] and lay["max"] == m["layers"][key]["max"]
        base = APP_DATA / aoi
        nx, ny = e["chunks"]["nx"], e["chunks"]["ny"]
        for sub in ("dtm", "vat", "hillshade"):
            assert len(list((base / "levels" / str(k) / sub).glob("*.png"))) == nx * ny, (k, sub)
        # NW chunk: decoded heights == block mean of the 1 m work DTM
        mean = block_mean(dtm, 2 ** k)
        with Image.open(base / f"levels/{k}/dtm/0_0.png") as im:
            h = terrarium_decode(np.asarray(im))
        n = min(500, e["size"]["width"]), min(500, e["size"]["height"])
        assert np.abs(h[1:1 + n[1], 1:1 + n[0]] - mean[:n[1], :n[0]]).max() < 0.003
        with Image.open(base / f"levels/{k}/hillshade/0_0.png") as im:
            v = u8_decode(np.asarray(im), 0, 1)
        assert 0.2 < v.mean() < 0.9
