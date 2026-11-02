"""Baked vector heights: bilinear DTM sampling with the PixelIsArea half-pixel convention."""
from __future__ import annotations

import json
import math
import sys
import tomllib
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import APP_DATA, WORK_DIR, load_aoi  # noqa: E402
from heights import DtmSampler, all_baked, bake_collection, bilinear, iter_coords  # noqa: E402

E0, N0, W, H = 381000, 5465000, 7, 5
N_TOP = N0 + H


@pytest.fixture
def tif(tmp_path):
    rng = np.random.default_rng(3)
    a = (300 + rng.uniform(-5, 5, (H, W))).astype(np.float32)
    p = tmp_path / "dtm.tif"
    with rasterio.open(p, "w", driver="GTiff", width=W, height=H, count=1, dtype="float32", crs="EPSG:25832",
                       transform=from_origin(E0, N_TOP, 1, 1)) as ds:
        ds.write(a, 1)
    return p, a


def test_cell_centre_equals_rasterio_sample(tif):
    p, a = tif
    s = DtmSampler.from_geotiff(p, E0, N_TOP)
    with rasterio.open(p) as ds:
        for r in range(H):
            for c in range(W):
                e, n = ds.xy(r, c)  # PixelIsArea: cell centre
                assert (e, n) == (E0 + c + 0.5, N_TOP - r - 0.5)
                ref = next(ds.sample([(e, n)]))[0]
                assert s.z(e, n) == pytest.approx(float(ref), abs=1e-6)


def test_half_pixel_convention_and_bilinear_mix(tif):
    p, a = tif
    s = DtmSampler.from_geotiff(p, E0, N_TOP)
    d = a.astype(np.float64)
    # cell corner (whole metres) between cells (c=1,2) × (r=1,2) = mean of 4 cells
    assert s.z(E0 + 2, N_TOP - 2) == pytest.approx(d[1:3, 1:3].mean(), abs=1e-9)
    # halfway between two centres horizontally
    assert s.z(E0 + 3.0, N_TOP - 0.5) == pytest.approx((d[0, 2] + d[0, 3]) / 2, abs=1e-9)
    # 25 % east of centre (c=4, r=3)
    assert s.z(E0 + 4.75, N_TOP - 3.5) == pytest.approx(0.75 * d[3, 4] + 0.25 * d[3, 5], abs=1e-9)
    # not the PixelIsPoint mistake (value at the whole-metre corner = one cell)
    assert s.z(E0 + 2, N_TOP - 2) != pytest.approx(float(d[2, 2]), abs=1e-6)


def test_edge_clamp(tif):
    p, a = tif
    s = DtmSampler.from_geotiff(p, E0, N_TOP)
    d = a.astype(np.float64)
    assert s.z(E0, N_TOP) == pytest.approx(d[0, 0])            # NW AOI corner
    assert s.z(E0 + W, N0) == pytest.approx(d[-1, -1])         # SE AOI corner
    assert s.z(E0, N_TOP - 1.0) == pytest.approx((d[0, 0] + d[1, 0]) / 2)  # west edge between rows 0/1


def test_plane_is_exact():
    c, r = np.meshgrid(np.arange(20), np.arange(10))
    plane = lambda e, n: 0.3 * (e - E0) - 0.7 * (n - N0) + 250  # noqa: E731
    dtm = plane(E0 + c + 0.5, N0 + 10 - r - 0.5)
    rng = np.random.default_rng(0)
    e = E0 + rng.uniform(0.5, 19.5, 200)
    n = N0 + rng.uniform(0.5, 9.5, 200)
    assert np.abs(bilinear(dtm, E0, N0 + 10, e, n) - plane(e, n)).max() < 1e-9


def test_from_geotiff_rejects_wrong_origin(tif):
    p, _ = tif
    with pytest.raises(ValueError):
        DtmSampler.from_geotiff(p, E0 + 1, N_TOP)


def test_bake_collection_shapes(tif):
    p, a = tif
    s = DtmSampler.from_geotiff(p, E0, N_TOP)
    fc = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"kind": "path"},
         "geometry": {"type": "LineString", "coordinates": [[E0 + 0.5, N_TOP - 0.5], [E0 + 1.5, N_TOP - 0.5]]}},
        {"type": "Feature", "properties": {},
         "geometry": {"type": "MultiLineString", "coordinates": [[[E0 + 1, N0 + 1], [E0 + 2, N0 + 1]]]}},
        {"type": "Feature", "properties": {"text": "1/2"},
         "geometry": {"type": "Point", "coordinates": [E0 + 3.5, N_TOP - 2.5]}},
    ]}
    out = bake_collection(fc, s)
    assert all_baked(out) and not all_baked(fc)
    assert out["features"][0]["geometry"]["coordinates"][0] == [E0 + 0.5, N_TOP - 0.5, round(float(a[0, 0]), 2)]
    assert out["features"][2]["geometry"]["coordinates"] == [E0 + 3.5, N_TOP - 2.5, round(float(a[2, 3]), 2)]
    assert out["features"][0]["properties"] == {"kind": "path"}
    assert fc["features"][0]["geometry"]["coordinates"][0] == [E0 + 0.5, N_TOP - 0.5]  # input untouched


# --------------------------------------------------------------------------- generated output
_KNOWN = [k for k in tomllib.loads((Path(__file__).resolve().parents[1] / "aois.toml").read_text()) if k != "defaults"]
BAKED = [(k, v) for k in _KNOWN if (APP_DATA / k / "manifest.json").exists() and (WORK_DIR / k / "dtm.tif").exists()
         for v, e in (json.loads((APP_DATA / k / "manifest.json").read_text()).get("vectors") or {}).items()
         if e.get("heights") == "baked"]


@pytest.mark.skipif(not BAKED, reason="no AOI with baked vectors")
@pytest.mark.parametrize("aoi,layer", BAKED)
def test_generated_baked_heights_match_dtm(aoi, layer):
    a = load_aoi(aoi)
    m = json.loads((APP_DATA / aoi / "manifest.json").read_text())
    entry = m["vectors"][layer]
    s = DtmSampler.from_geotiff(WORK_DIR / aoi / "dtm.tif", a.e0, a.n1)
    files = [entry["path"]] + ([entry["labels"]] if "labels" in entry else [])
    lo, hi = m["heightRange"]["min"], m["heightRange"]["max"]
    for f in files:
        fc = json.loads((APP_DATA / aoi / f).read_text())
        assert all_baked(fc), f
        pts = [p for feat in fc["features"][::50] for p in iter_coords(feat["geometry"])]
        arr = np.asarray(pts)
        z = s.z(arr[:, 0], arr[:, 1])
        assert np.abs(np.round(z, 2) - arr[:, 2]).max() <= 0.005 + 1e-9, f
        assert lo - 0.01 <= arr[:, 2].min() and arr[:, 2].max() <= hi + 0.01
        assert all(math.isclose(v, round(v, 2)) for v in arr[:200, 2])
