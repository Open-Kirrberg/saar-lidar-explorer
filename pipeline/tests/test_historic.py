"""F14 historic maps: request-block maths, paper fill, XYZ palette tiles (no network), plus contract checks of
generated `hist_*` layers and `xyz.hist_*` tiles (skipped for AOIs where historic.py has not run)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import APP_DATA  # noqa: E402
from historic import ATTRIBUTION_HIST, HIST_LAYERS, fill_paper, request_blocks  # noqa: E402
from ortho import chunk_bbox, pixel_centre  # noqa: E402
from test_ortho import _KNOWN, check_image_layer  # noqa: E402
from xyz import rgba_to_palette  # noqa: E402


def test_request_blocks_cover_grid_exactly_on_chunk_edges():
    # overall: 12 × 16 chunks → 3 × 4 blocks of 4 × 4 chunks (2000 px each, ≤ 4096)
    e0, ntop = 378000, 5468000
    bl = request_blocks(e0, ntop, 12, 16)
    assert len(bl) == 12 and all(b["width"] == b["height"] == 2000 for b in bl)
    covered = np.zeros((16, 12), int)
    for b in bl:
        covered[b["j0"]:b["j0"] + b["nj"], b["i0"]:b["i0"] + b["ni"]] += 1
        minx, miny, maxx, maxy = b["bbox"]
        assert (minx - e0) % 500 == 0 and (ntop - maxy) % 500 == 0 and (maxx - minx) == b["width"]
        assert b["bbox"][:1] + b["bbox"][3:] == chunk_bbox(e0, ntop, b["i0"], b["j0"])[:1] + \
            chunk_bbox(e0, ntop, b["i0"], b["j0"])[3:]     # NW corner = NW corner of the first chunk
        assert (b["row"], b["col"]) == (b["j0"] * 500, b["i0"] * 500)
    assert (covered == 1).all()
    # karlsberg 6 × 6 → 2 × 2 blocks: 2000², 1000×2000, 2000×1000, 1000²
    kb = request_blocks(381000, 5468000, 6, 6)
    assert sorted((b["width"], b["height"]) for b in kb) == [(1000, 1000), (1000, 2000), (2000, 1000), (2000, 2000)]
    se = [b for b in kb if b["i0"] == 4 and b["j0"] == 4][0]
    assert se["bbox"] == (383000, 5465000, 384000, 5466000)
    with pytest.raises(ValueError):
        request_blocks(0, 0, 10, 10, block=10)            # 5000 px > 4096 service limit


def test_block_pixels_map_to_chunk_pixel_centres():
    # mosaic pixel (row, col) from a block GetMap at 1 m/px has the contract pixel centre of chunk (col//500, row//500)
    e0, ntop = 381000, 5468000
    for b in request_blocks(e0, ntop, 6, 6):
        minx, _, _, maxy = b["bbox"]
        for bx, by in [(0, 0), (b["width"] - 1, b["height"] - 1), (517, 3)]:
            if bx >= b["width"] or by >= b["height"]:
                continue
            e, n = minx + bx + 0.5, maxy - by - 0.5            # WMS pixel centre inside the block
            row, col = b["row"] + by, b["col"] + bx
            assert pixel_centre(e0, ntop, col // 500, row // 500, col % 500, row % 500, 500) == (e, n)


def test_fill_paper():
    a = np.zeros((2, 2, 4), np.uint8)
    a[0, 0] = (10, 20, 30, 255)
    rgb = fill_paper(a)
    assert tuple(rgb[0, 0]) == (10, 20, 30) and (rgb[1, 1] == 255).all()


def test_rgba_to_palette_transparency():
    t = np.zeros((256, 256, 4), np.uint8)
    assert rgba_to_palette(t) is None                     # fully transparent tile is skipped
    t[:128] = (200, 180, 120, 255)
    t[128:, :128] = (20, 20, 20, 255)
    img = rgba_to_palette(t)
    assert img.mode == "P" and img.info["transparency"] == 0
    idx = np.asarray(img)
    assert (idx[128:, 128:] == 0).all() and (idx[:128] > 0).all()
    back = np.asarray(img.convert("RGBA"))
    assert tuple(back[0, 0]) == (200, 180, 120, 255) and tuple(back[200, 10]) == (20, 20, 20, 255)
    assert back[200, 200, 3] == 0


def test_layer_table_matches_contract_labels():
    assert HIST_LAYERS["hist_1840"]["layer"] == "1" and HIST_LAYERS["hist_1935"]["layer"] == "5"
    assert HIST_LAYERS["hist_1840"]["label_de"] == "Karte 1836–41 (Bayer. Positionsblätter)"
    assert HIST_LAYERS["hist_1935"]["label_de"] == "TK25 1935–40"
    assert ";" not in ATTRIBUTION_HIST


# ------------------------------------------------------------------------------------------- generated output
def _built():
    out = []
    for k in _KNOWN:
        mf = APP_DATA / k / "manifest.json"
        if mf.exists():
            lays = json.loads(mf.read_text()).get("layers") or {}
            out += [(k, key) for key in lays if key.startswith("hist_")]
    return out


BUILT = _built()


@pytest.mark.skipif(not BUILT, reason="no AOI with hist_* layers")
@pytest.mark.parametrize("aoi,key", BUILT)
def test_generated_historic(aoi, key):
    m = check_image_layer(aoi, key, 500, "jpg", ATTRIBUTION_HIST)
    assert m["layers"][key]["label_de"] == HIST_LAYERS[key]["label_de"]
    x = m["xyz"][key]
    assert x["url"] == f"xyz/{key}/{{z}}/{{x}}/{{y}}.png" and x["label_de"] == HIST_LAYERS[key]["label_de"]
    assert x["kind"] == "image" and x["minZoom"] <= x["maxZoom"]
    tiles = list((APP_DATA / aoi / "xyz" / key).rglob("*.png"))
    assert len(tiles) == x["tileCount"] > 0
    with Image.open(tiles[0]) as im:
        assert im.size == (256, 256) and im.mode == "P"
    zs = {int(p.relative_to(APP_DATA / aoi / "xyz" / key).parts[0]) for p in tiles}
    assert zs == set(range(x["minZoom"], x["maxZoom"] + 1))
    # relief xyz layers written by xyz.py are still there (per-sub-key merge)
    assert "vat" in m["xyz"]
