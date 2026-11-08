"""S2 v3 places in pointcloud.py: a focus area belongs to the place whose present tile holds its bbox centre."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pointcloud as PC  # noqa: E402
from common import AOI  # noqa: E402
from pointcloud import FocusArea, area_belongs, areas_for_aoi, covering_window  # noqa: E402

PLACE = AOI("p", "P", 376000, 5462000, 378000, 5464000, 200, "SPK", 500, fmt=3, place="p", ags="10000000",
            owned=frozenset({(376, 5462), (377, 5462), (377, 5463)}), relict_candidates=False, cache_from="big")
OTHER = AOI("q", "Q", 375000, 5462000, 377000, 5464000, 200, "SPK", 500, fmt=3, place="q", ags="10000001",
            owned=frozenset({(375, 5462), (375, 5463), (376, 5463)}), relict_candidates=False)
RECT = AOI("r", "R", 376000, 5462000, 378000, 5464000, 200, "SPK", 500)


def test_bbox_centre_rule():
    inside = FocusArea("a", "A", (377100, 5462100, 377900, 5462900))
    crossing = FocusArea("b", "B", (375800, 5462000, 376800, 5463000))     # centre (376300, 5462500) → 376_5462
    absent = FocusArea("c", "C", (376200, 5463200, 376800, 5463800))       # centre in 376_5463 (absent)
    edge = FocusArea("d", "D", (376500, 5462500, 377500, 5463500))         # centre (377000, 5463000) → 377_5463
    outside = FocusArea("e", "E", (378200, 5462200, 378800, 5462800))
    assert [area_belongs(PLACE, a) for a in (inside, crossing, absent, edge, outside)] == [True, True, False, True,
                                                                                         False]
    # exactly one of two neighbouring places owns each area
    assert [area_belongs(OTHER, a) for a in (inside, crossing, absent, edge, outside)] == [False, False, True, False,
                                                                                         False]
    # v1/v2: bbox fully inside (unchanged); the crossing area is not
    assert [area_belongs(RECT, a) for a in (inside, crossing, absent, edge, outside)] == [True, False, True, True,
                                                                                        False]


def test_areas_for_place_from_config(tmp_path):
    toml = tmp_path / "aois.toml"
    toml.write_text('[[defaults.pointclouds]]\nid = "x"\nname_de = "X"\nbbox = [376600, 5462600, 377600, 5463600]\n'
                    '[[defaults.pointclouds]]\nid = "y"\nname_de = "Y"\nbbox = [375500, 5463200, 376500, 5463800]\n')
    assert [a.id for a in areas_for_aoi(PLACE, toml)] == ["x"]     # centre (377100, 5463100) → 377_5463
    assert [a.id for a in areas_for_aoi(OTHER, toml)] == ["y"]     # centre (376000, 5463500) → 376_5463
    assert [a.id for a in areas_for_aoi(RECT, toml)] == ["x"]


def _tif(path: Path, arr: np.ndarray, e0: int, n_top: int) -> None:
    import rasterio
    from rasterio.transform import from_origin
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path, "w", driver="GTiff", width=arr.shape[1], height=arr.shape[0], count=1,
                       dtype=arr.dtype, crs="EPSG:25832", transform=from_origin(e0, n_top, 1, 1)) as ds:
        ds.write(arr, 1)


def test_covering_window_prefers_own_then_cache_from(tmp_path, monkeypatch):
    monkeypatch.setattr(PC, "WORK_DIR", tmp_path)
    own = np.arange(2000 * 2000, dtype=np.float32).reshape(2000, 2000)
    _tif(tmp_path / "p" / "dtm.tif", own, 376000, 5464000)
    big = np.arange(4000 * 4000, dtype=np.float32).reshape(4000, 4000)
    _tif(tmp_path / "big" / "dtm.tif", big, 374000, 5466000)           # 374–378 km × 5462–5466 km
    # inside the place rectangle → own raster
    arr, e0, n_top = covering_window(PLACE, "dtm", (377000, 5462500, 377100, 5462600), margin=2)
    assert (e0, n_top, arr.shape) == (376998, 5462602, (104, 104))
    assert arr[0, 0] == own[5464000 - 5462602, 376998 - 376000]
    # reaching west of the rectangle → the cache_from AOI's raster
    arr, e0, n_top = covering_window(PLACE, "dtm", (375800, 5462500, 376300, 5462600), margin=0)
    assert (e0, n_top, arr.shape) == (375800, 5462600, (100, 500))
    assert arr[0, 0] == big[5466000 - 5462600, 375800 - 374000]
    # nothing covers it
    assert covering_window(PLACE, "dtm", (373000, 5462500, 373500, 5462600)) is None
    assert covering_window(PLACE, "chm", (377000, 5462500, 377100, 5462600)) is None
    # a DTM window with NaN is not used
    nan = own.copy()
    nan[1400:1500, 1000:1100] = np.nan
    _tif(tmp_path / "p" / "dtm.tif", nan, 376000, 5464000)
    arr, e0, _ = covering_window(PLACE, "dtm", (377000, 5462500, 377100, 5462600), margin=0)
    assert np.isfinite(arr).all() and arr[0, 0] == big[5466000 - 5462600, 377000 - 374000]


def test_place_area_inputs_window_sampler(tmp_path, monkeypatch):
    monkeypatch.setattr(PC, "WORK_DIR", tmp_path)
    E, N = np.meshgrid(np.arange(374000, 378000) + 0.5, 5466000 - np.arange(4000) - 0.5)
    plane = (200 + 0.01 * (E - 374000) + 0.02 * (N - 5462000)).astype(np.float32)
    _tif(tmp_path / "big" / "dtm.tif", plane, 374000, 5466000)
    _tif(tmp_path / "big" / "chm.tif", np.full((4000, 4000), 5.0, np.float32), 374000, 5466000)
    _tif(tmp_path / "p" / "dtm.tif", plane[2000:, 2000:].copy(), 376000, 5464000)
    area = FocusArea("x", "X", (375800, 5462100, 376400, 5462500))
    sampler, chm = PC.place_area_inputs(PLACE, area)
    e = np.array([375850.25, 376390.0])
    n = np.array([5462120.0, 5462480.75])
    assert sampler.z(e, n) == pytest.approx(200 + 0.01 * (e - 374000) + 0.02 * (n - 5462000), abs=1e-3)
    arr, e0, n_top = chm
    assert (e0, n_top, arr.shape) == (375800, 5462500, (400, 600)) and (arr == 5.0).all()


# --------------------------------------------------------------------------- generated data (v3 places)
import json  # noqa: E402
import tomllib  # noqa: E402

from common import APP_DATA, load_aoi  # noqa: E402
from grid import tile_of_point  # noqa: E402

_CFG = tomllib.loads((Path(__file__).resolve().parents[1] / "aois.toml").read_text())
PLACES = [k for k, v in _CFG.items() if isinstance(v, dict) and "place" in v
          and (APP_DATA / v.get("out", k) / "manifest.json").exists()]


@pytest.mark.skipif(not PLACES, reason="no v3 place built")
@pytest.mark.parametrize("key", PLACES)
def test_generated_place_pointclouds(key):
    a = load_aoi(key)
    m = json.loads((a.data_dir / "manifest.json").read_text())
    want = {x.id for x in areas_for_aoi(a)}
    if "pointclouds" not in m:
        if not want:   # with areas but no key, the LAZ were missing (logged) – nothing to check
            assert not (a.data_dir / "pointclouds").exists()
        return
    pc = m["pointclouds"]
    assert {x["id"] for x in pc["areas"]} <= want
    for x in pc["areas"]:
        e0, n0, e1, n1 = x["bbox"]
        assert a.present(*tile_of_point((e0 + e1) / 2, (n0 + n1) / 2))
        files = {p.name for p in (a.data_dir / "pointclouds" / x["id"]).glob("*.bin")}
        assert files == {f"{tx}_{ty}.bin" for tx, ty, _ in x["tiles"]}
