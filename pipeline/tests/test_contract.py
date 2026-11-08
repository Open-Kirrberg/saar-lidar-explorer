"""Sanity checks of the generated data against docs/data-contract.md.

Run after build.py/xyz.py/pois.py:  uv run pytest -q   (AOIs without output are skipped)
"""
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
from encode import terrarium_decode, terrarium_encode, u8_decode, u8_encode  # noqa: E402

# v1/v2 rectangle AOIs only; v3 places (`place = …`) and groups are checked in tests/test_place_v3.py
_KNOWN = [k for k, v in tomllib.loads((Path(__file__).resolve().parents[1] / "aois.toml").read_text()).items()
          if k != "defaults" and not v.get("place") and not v.get("group")]
# only AOIs built by this pipeline (the app may keep its own test fixtures under app/public/data/)
AOIS = sorted(k for k in _KNOWN if (APP_DATA / k / "manifest.json").exists() and (WORK_DIR / k / "dtm.tif").exists())
POI_TYPES = {"castle", "palace", "garden", "bunker", "burial_mound", "cave", "boundary_stone", "mine", "other"}


def load_manifest(aoi):
    return json.loads((APP_DATA / aoi / "manifest.json").read_text())


def read_png(path: Path) -> np.ndarray:
    with Image.open(path) as im:
        assert "icc_profile" not in im.info and "gamma" not in im.info, f"{path}: colour-managed PNG"
        return np.asarray(im)


def dec_height(aoi, kind, i, j):
    return terrarium_decode(read_png(APP_DATA / aoi / kind / f"{i}_{j}.png"))


# ------------------------------------------------------------------------- encoding unit tests
def test_terrarium_roundtrip_synthetic():
    rng = np.random.default_rng(0)
    h = rng.uniform(-50, 3000, (300, 300)).astype(np.float32)
    err = np.abs(terrarium_decode(terrarium_encode(h)) - h)
    assert err.max() <= 0.005
    assert err.max() <= 1 / 512 + 1e-4  # nearest rounding → ≤ 2 mm


def test_u8_roundtrip_synthetic():
    x = np.linspace(-2, 2, 10001)
    err = np.abs(u8_decode(u8_encode(x, -2, 2), -2, 2) - x)
    assert err.max() <= 4 / 255 / 2 + 1e-9


# ------------------------------------------------------------------------- per-AOI output tests
pytestmark_aoi = pytest.mark.skipif(not AOIS, reason="no built AOI in app/public/data")


@pytestmark_aoi
@pytest.mark.parametrize("aoi", AOIS)
def test_manifest_schema(aoi):
    m = load_manifest(aoi)
    for k in ("version", "aoi", "name", "crs", "origin", "size", "cellSize", "chunkSize", "chunks", "heightRange",
              "wgs84Bounds", "height", "layers", "sources", "attribution"):
        assert k in m, k
    a = load_aoi(aoi)
    assert m["version"] in (1, 2) and m["aoi"] == aoi and m["crs"] == "EPSG:25832"
    assert ("levels" in m) == (m["version"] == 2)  # contract: version 2 exactly when levels are written
    assert m["origin"] == {"E0": a.e0, "N0": a.n0}
    assert m["size"] == {"width": a.width, "height": a.height}
    assert m["cellSize"] == 1 and m["chunkSize"] == 500
    assert m["chunks"] == {"nx": a.width // 500, "ny": a.height // 500}
    assert m["heightRange"]["min"] < m["heightRange"]["max"]
    (s, w), (n, e) = m["wgs84Bounds"]
    assert 49 < s < n < 50 and 7 < w < e < 8
    assert m["height"]["dtm"] == {"path": "dtm/{i}_{j}.png", "encoding": "terrarium", "apron": 1}
    for key, L in m["layers"].items():
        if L.get("encoding") == "rgb":
            continue  # F13/F14 image layers (no min/max): checked in test_ortho.py / test_historic.py
        for f in ("path", "encoding", "min", "max", "label_de"):
            assert f in L, (key, f)
        assert L["encoding"] == "u8" and L["min"] < L["max"] and "{i}_{j}" in L["path"]
    for key, X in m.get("xyz", {}).items():
        assert {"url", "minZoom", "maxZoom"} <= X.keys()
    assert "LVGL-SL" in m["attribution"] and m["sources"]


@pytestmark_aoi
@pytest.mark.parametrize("aoi", AOIS)
def test_chunk_files_and_sizes(aoi):
    m = load_manifest(aoi)
    nx, ny = m["chunks"]["nx"], m["chunks"]["ny"]
    base = APP_DATA / aoi
    for kind, H in m["height"].items():
        files = list((base / Path(H["path"]).parent).glob("*.png"))
        assert len(files) == nx * ny, kind
        with Image.open(files[0]) as im:
            assert im.size == (502, 502) and im.mode == "RGB"
    for key, L in m["layers"].items():
        if L.get("encoding") == "rgb":
            continue  # image layers (webp/jpg, 1000²/500²): test_ortho.py / test_historic.py
        files = list((base / Path(L["path"]).parent).glob("*.png"))
        assert len(files) == nx * ny, key
        with Image.open(files[0]) as im:
            assert im.size == (500, 500) and im.mode == "L", key
    for key, X in m.get("xyz", {}).items():
        tiles = list((base / "xyz" / key).rglob("*.png"))
        assert tiles and {int(p.parts[-3]) for p in tiles} == set(range(X["minZoom"], X["maxZoom"] + 1))


@pytestmark_aoi
@pytest.mark.parametrize("aoi", AOIS)
def test_terrarium_roundtrip_against_source(aoi):
    with rasterio.open(WORK_DIR / aoi / "dtm.tif") as ds:
        dtm = ds.read(1).astype(np.float64)
    m = load_manifest(aoi)
    worst = 0.0
    for j in range(m["chunks"]["ny"]):
        for i in range(m["chunks"]["nx"]):
            h = dec_height(aoi, "dtm", i, j)[1:-1, 1:-1]
            worst = max(worst, float(np.abs(h - dtm[j * 500:(j + 1) * 500, i * 500:(i + 1) * 500]).max()))
    assert worst <= 0.005, worst
    assert abs(m["heightRange"]["min"] - dtm.min()) < 0.01 and abs(m["heightRange"]["max"] - dtm.max()) < 0.01


@pytestmark_aoi
@pytest.mark.parametrize("aoi", AOIS)
def test_apron_matches_neighbours(aoi):
    m = load_manifest(aoi)
    nx, ny = m["chunks"]["nx"], m["chunks"]["ny"]
    for kind in m["height"]:
        for j in range(ny):
            for i in range(nx):
                c = dec_height(aoi, kind, i, j)
                if i + 1 < nx:  # east apron column == first owned column of east neighbour
                    e = dec_height(aoi, kind, i + 1, j)
                    assert np.array_equal(c[:, 501], e[:, 1]) and np.array_equal(c[:, 500], e[:, 0])
                else:  # edge clamp
                    assert np.array_equal(c[:, 501], c[:, 500])
                if j + 1 < ny:  # south apron row == first owned row of south neighbour
                    s = dec_height(aoi, kind, i, j + 1)
                    assert np.array_equal(c[501, :], s[1, :]) and np.array_equal(c[500, :], s[0, :])
                else:
                    assert np.array_equal(c[501, :], c[500, :])
                if i == 0:
                    assert np.array_equal(c[:, 0], c[:, 1])
                if j == 0:
                    assert np.array_equal(c[0, :], c[1, :])


@pytestmark_aoi
@pytest.mark.parametrize("aoi", AOIS)
def test_u8_layers_decode_to_source(aoi):
    m = load_manifest(aoi)
    for key in ("slrm", "slope", "chm"):
        if key not in m["layers"]:
            continue
        L = m["layers"][key]
        with rasterio.open(WORK_DIR / aoi / f"{key}.tif") as ds:
            src = ds.read(1)[:500, 500:1000]  # chunk (1, 0)
        v = u8_decode(read_png(APP_DATA / aoi / "relief" / key / "1_0.png"), L["min"], L["max"])
        clipped = np.clip(src, L["min"], L["max"])
        assert np.abs(v - clipped).max() <= (L["max"] - L["min"]) / 510 + 1e-4, key


@pytestmark_aoi
@pytest.mark.parametrize("aoi", AOIS)
def test_world_frame_georeference(aoi):
    """Cell (c, r) centre = (E0 + c + .5, N0 + height − r − .5): check against the work GeoTIFF transform."""
    m = load_manifest(aoi)
    with rasterio.open(WORK_DIR / aoi / "dtm.tif") as ds:
        E, N = ds.xy(0, 0)  # centre of row 0, col 0
        assert (E, N) == (m["origin"]["E0"] + 0.5, m["origin"]["N0"] + m["size"]["height"] - 0.5)
        assert ds.crs.to_epsg() == 25832


def test_pois_geojson():
    p = APP_DATA / "pois.geojson"
    if not p.exists():
        pytest.skip("pois.geojson not built")
    fc = json.loads(p.read_text())
    assert fc["type"] == "FeatureCollection" and len(fc["features"]) > 20
    ids = set()
    for f in fc["features"]:
        pr = f["properties"]
        assert {"id", "name", "type", "confidence", "source", "note"} <= pr.keys()
        assert pr["type"] in POI_TYPES and pr["confidence"] in {"high", "med", "low"}
        assert pr["source"].startswith("http")
        lon, lat = f["geometry"]["coordinates"]
        assert 49.2 < lat < 49.4 and 7.2 < lon < 7.5
        assert pr["id"] not in ids
        ids.add(pr["id"])
