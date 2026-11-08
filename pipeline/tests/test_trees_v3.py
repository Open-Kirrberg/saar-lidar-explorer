"""S2 v3 places in trees.py: trees with the top cell centre in a present tile only (contract rules 2 + 6)."""
from __future__ import annotations

import json
import sys
import tomllib
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import AOI, APP_DATA, load_aoi  # noqa: E402
from grid import tile_of_point  # noqa: E402
from trees import (TYPE_CODES, Params, Trees, chunk_origin, chunk_trees, decode_chunk, detect, encode_all,  # noqa: E402
                   own_chunks, published_area_ha, records_for, smooth_chm, find_tops)

PLACE = AOI("p", "P", 376000, 5462000, 378000, 5464000, 200, "SPK", 500, fmt=3, place="p", ags="10000000",
            owned=frozenset({(376, 5462), (377, 5462), (377, 5463)}), relict_candidates=False)
RECT = AOI("r", "R", 376000, 5462000, 378000, 5464000, 200, "SPK", 500)


def _cones(shape, peaks):
    rr, cc = np.mgrid[:shape[0], :shape[1]]
    z = np.zeros(shape, np.float32)
    for r, c, h, rad in peaks:
        z = np.maximum(z, h * np.clip(1 - np.hypot(rr - r, cc - c) / rad, 0, None))
    return z


def test_own_chunks_keeps_present_chunks_only():
    res = {(i, j): Trees.empty() for j in range(4) for i in range(4)}
    kept = own_chunks(PLACE, res)
    assert set(kept) == {(i, j) for j in range(4) for i in range(4) if not (i < 2 and j < 2)}
    assert own_chunks(RECT, res) is res
    assert published_area_ha(PLACE) == 300.0 and published_area_ha(RECT) == 400.0


def test_place_trees_lie_in_present_tiles():
    """Cones on both sides of the absent-tile border; only tops in present tiles survive, each in its own chunk
    and at its cell centre (E = E0 + col + 0.5, N = N_top − row − 0.5)."""
    H = W = 2000
    peaks = [(500, 500, 20, 5),       # absent tile 376_5463 (row < 1000, col < 1000)
             (500, 1003, 18, 5),      # 377_5463, 3 m east of the absent tile
             (1003, 500, 22, 5),      # 376_5462, 3 m south of it
             (998, 997, 15, 5),       # absent, 2–3 m from both borders
             (1500, 1500, 25, 5)]     # 377_5462
    dtm = np.full((H, W), 250.0, np.float32)
    dsm = dtm + _cones((H, W), peaks)
    res = own_chunks(PLACE, detect(dsm, dtm, None, None, PLACE, Params(fill=False), workers=2))
    got = []
    for (i, j), buf in encode_all(PLACE, res).items():
        assert PLACE.chunk_present(i, j)
        _, rec = decode_chunk(buf)
        e_ll, n_ll = chunk_origin(PLACE, i, j)
        for x, y in zip(rec["x"], rec["y"]):
            e, n = e_ll + x / 10, n_ll + y / 10
            assert PLACE.present(*tile_of_point(e, n))
            got.append((e, n))
    want = {(376000 + c + 0.5, 5464000 - r - 0.5) for r, c, _, _ in peaks
            if PLACE.present(*tile_of_point(376000 + c + 0.5, 5464000 - r - 0.5))}
    assert set(got) == want and len(want) == 3


def test_zero_ortho_is_nodata_only_when_asked():
    """A crown half on black (absent-tile) ortho cells: default darkens it into a conifer, the v3 flag uses only
    the valid half (bright → broadleaf); a crown fully on black cells → unknown."""
    H = W = 120
    p = Params(fill=False)
    chm_in = _cones((H, W), [(60, 60, 20, 8), (30, 100, 20, 6)])
    dtm = np.zeros((H, W), np.float32)
    chm, sm = smooth_chm(chm_in, dtm, None, p)
    tr, tc = find_tops(sm, p)
    ortho = np.full((3, H, W), 120, np.uint8)
    ortho[:, :, 60:] = 0                      # east half black, as outside a place's present tiles
    box = (0, H, 0, W)
    a = chunk_trees(chm, sm, dtm, ortho, tr, tc, box, p)
    b = chunk_trees(chm, sm, dtm, ortho, tr, tc, box, p, zero_ortho_nodata=True)
    k1 = int(np.nonzero((a.row == 60) & (a.col == 60))[0][0])
    k2 = int(np.nonzero((a.row == 30) & (a.col == 100))[0][0])
    assert a.type[k1] == TYPE_CODES["conifer"] and b.type[k1] == TYPE_CODES["broadleaf"]
    assert b.bright[k1] == pytest.approx(120.0)
    assert a.type[k2] == TYPE_CODES["conifer"] and b.type[k2] == TYPE_CODES["unknown"] and np.isnan(b.bright[k2])
    # without black cells the flag changes nothing
    full = np.full((3, H, W), 50, np.uint8)
    c = chunk_trees(chm, sm, dtm, full, tr, tc, box, p)
    d = chunk_trees(chm, sm, dtm, full, tr, tc, box, p, zero_ortho_nodata=True)
    assert np.array_equal(c.bright, d.bright) and np.array_equal(c.type, d.type)


def test_records_for_place_chunk():
    t = Trees(np.array([1500]), np.array([1500]), np.zeros(1), np.full(1, 20.0), np.ones(1),
              np.zeros(1, np.uint8), np.full(1, np.nan))
    x, y, _ = records_for(PLACE, 3, 3, t)
    assert (x[0], y[0]) == (5, 4995)          # chunk (3, 3) spans E 377500–378000, N 5462000–5462500


# --------------------------------------------------------------------------- generated data (v3 places)
_CFG = tomllib.loads((Path(__file__).resolve().parents[1] / "aois.toml").read_text())
PLACES = [k for k, v in _CFG.items() if isinstance(v, dict) and "place" in v
          and (APP_DATA / v.get("out", k) / "manifest.json").exists()
          and "trees" in json.loads((APP_DATA / v.get("out", k) / "manifest.json").read_text())]


def _tree_points(key):
    a = load_aoi(key)
    t = json.loads((a.data_dir / "manifest.json").read_text())["trees"]
    pts = []
    for i, j, count in t["chunks"]:
        _, rec = decode_chunk((a.data_dir / t["path"].format(i=i, j=j)).read_bytes())
        assert rec.size == count
        e_ll, n_ll = chunk_origin(a, i, j)
        pts += [(e_ll + x / 10, n_ll + y / 10) for x, y in zip(rec["x"], rec["y"])]
    return a, t, pts


@pytest.mark.skipif(not PLACES, reason="no v3 place with trees")
@pytest.mark.parametrize("key", PLACES)
def test_generated_place_trees(key):
    a, t, pts = _tree_points(key)
    assert all(a.chunk_present(i, j) for i, j, _ in t["chunks"])
    assert {f.name for f in (a.data_dir / "trees").glob("*.bin")} == {f"{i}_{j}.bin" for i, j, _ in t["chunks"]}
    assert len(pts) == t["count"] > 0
    assert all(a.present(*tile_of_point(e, n)) for e, n in pts)


@pytest.mark.skipif(not {"fixture-v3-homburg", "fixture-v3-kirkel"} <= set(PLACES), reason="fixture places not built")
def test_generated_fixture_places_share_no_tree():
    _, _, a = _tree_points("fixture-v3-homburg")
    _, _, b = _tree_points("fixture-v3-kirkel")
    assert not set(a) & set(b)


def _ortho_tif(path: Path, bands: np.ndarray, e0: int, n_top: int) -> None:
    import rasterio
    from rasterio.transform import from_origin
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path, "w", driver="GTiff", width=bands.shape[2], height=bands.shape[1], count=bands.shape[0],
                       dtype="uint8", crs="EPSG:25832", transform=from_origin(e0, n_top, 1, 1)) as ds:
        ds.write(bands)


def test_read_ortho_alpha_zero_is_missing(tmp_path, monkeypatch):
    import trees as T
    monkeypatch.setattr(T, "WORK_DIR", tmp_path)
    small = AOI("p", "P", 376000, 5462000, 376100, 5462100, 200, "SPK", 500, fmt=3, place="p", ags="1",
                owned=frozenset({(376, 5462)}), relict_candidates=False)
    own = np.zeros((4, 100, 100), np.uint8)
    own[:3, :, :60] = 100
    own[3, :, :60] = 255                     # alpha 0 (and black) east of column 60
    _ortho_tif(tmp_path / "p" / "ortho_1m.tif", own, 376000, 5462100)
    rgb, src, gaps = T.read_ortho(small)     # nothing else covers it → black + gaps
    assert src == "p" and gaps and (rgb[:, :, :60] == 100).all() and (rgb[:, :, 60:] == 0).all()
    # another place's 4-band raster that is black (alpha 0) there too does not help; a 3-band one fills the gap
    other = np.zeros((4, 300, 300), np.uint8)
    _ortho_tif(tmp_path / "a-other" / "ortho_1m.tif", other, 375900, 5462200)
    big = np.full((3, 300, 300), 70, np.uint8)
    _ortho_tif(tmp_path / "b-big" / "ortho_1m.tif", big, 375900, 5462200)
    rgb, src, gaps = T.read_ortho(small)
    assert src == "p+b-big" and not gaps
    assert (rgb[:, :, :60] == 100).all() and (rgb[:, :, 60:] == 70).all()
    # a 3-band own raster is used as is (v1/v2 behaviour)
    _ortho_tif(tmp_path / "p" / "ortho_1m.tif", np.full((3, 100, 100), 90, np.uint8), 376000, 5462100)
    rgb, src, gaps = T.read_ortho(small)
    assert src == "p" and not gaps and (rgb == 90).all() and rgb.shape == (3, 100, 100)
    # no raster at all
    monkeypatch.setattr(T, "WORK_DIR", tmp_path / "none")
    assert T.read_ortho(small) == (None, None, False)
