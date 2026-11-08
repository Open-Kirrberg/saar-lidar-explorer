"""v3 place minimap tiles (contract rule 7): exact presence mask at tile edges, rectangle bounds, stale keys, plus
checks of generated v3 fixture tiles (skipped where xyz.py has not run on them)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import AOI, APP_DATA  # noqa: E402
from xyz import TMS, PresenceMask, build_layer, stale_xyz  # noqa: E402

OWNED = frozenset({(376, 5462), (377, 5462), (377, 5463)})          # NW tile 376_5463 absent


def place() -> AOI:
    return AOI("t-place", "T", 376000, 5462000, 378000, 5464000, 200, "x", 500, fmt=3, place="t", owned=OWNED)


def test_presence_mask_points_and_half_open_edges():
    m = PresenceMask.of(place())
    e = np.array([376500.0, 377500.0, 376500.0, 377000.0, 376999.9, 375999.0, 378000.0, 376500.0, 376500.0])
    n = np.array([5463500.0, 5463500.0, 5462500.0, 5463500.0, 5463500.0, 5462500.0, 5462500.0, 5463000.0,
                  5462999.9])
    # NW absent; NE, SW present; E edge 377000 belongs to the east tile; outside the rectangle → False;
    # N 5463000 is the south edge of the absent NW tile (half-open [N, N + 1000)) → absent; just below → SW present
    assert m.utm(e, n).tolist() == [False, True, True, True, False, False, False, False, True]


def test_presence_mask_nan_outside():
    a = np.ones((2000, 2000), np.float32)
    PresenceMask.of(place()).nan_outside(a)
    assert np.isnan(a[:1000, :1000]).all() and np.isfinite(a[1000:]).all() and np.isfinite(a[:, 1000:]).all()


def _write_vat(path: Path) -> None:
    import rasterio
    from rasterio.transform import from_origin
    rng = np.random.default_rng(7)
    arr = (0.3 + 0.4 * rng.random((2000, 2000))).astype(np.float32)   # data everywhere, also in the absent tile
    with rasterio.open(path, "w", driver="GTiff", width=2000, height=2000, count=1, dtype="float32",
                       crs="EPSG:25832", transform=from_origin(376000, 5464000, 1, 1), nodata=np.nan) as dst:
        dst.write(arr, 1)


def test_build_layer_alpha_zero_exactly_outside_present_tiles(tmp_path):
    """The source has values in the absent tile, so only the presence mask (not NaN) can make it transparent."""
    from pyproj import Transformer
    from rasterio.warp import transform_bounds
    a = place()
    src = tmp_path / "vat.tif"
    _write_vat(src)
    out = tmp_path / "xyz" / "vat"
    entry = build_layer(a, "vat", range(15, 17), {}, src_path=src, out=out, mask=PresenceMask.of(a))
    w, s, e, n = transform_bounds("EPSG:25832", "EPSG:4326", a.e0, a.n0, a.e1, a.n1, densify_pts=21)
    assert entry["bounds"] == [[round(s, 6), round(w, 6)], [round(n, 6), round(e, 6)]]
    assert (entry["minZoom"], entry["maxZoom"]) == (15, 16) and entry["tileCount"] > 0
    tr = Transformer.from_crs(3857, 25832, always_xy=True)
    owned = a.owned
    edge_in = edge_opaque = 0
    for p in out.rglob("*.png"):
        z, x, y = int(p.parts[-3]), int(p.parts[-2]), int(p.stem)
        b = TMS.xy_bounds(x, y, z)
        px = (b.right - b.left) / 256
        c = (np.arange(256) + 0.5) * px
        E, N = tr.transform(*np.meshgrid(b.left + c, b.top - c))
        inside = np.vectorize(lambda ee, nn: (int(ee // 1000), int(nn // 1000)) in owned)(E, N)
        with Image.open(p) as im:
            alpha = np.asarray(im.convert("RGBA"))[..., 3]
        assert not ((alpha > 0) & ~inside).any(), f"{p}: opaque pixel outside the present tiles"
        # pixels inside a present tile next to the absent-tile edges stay opaque
        near = inside & ((np.abs(E - 377000) < 4) | (np.abs(N - 5463000) < 4))
        edge_in += int(near.sum())
        edge_opaque += int((near & (alpha > 0)).sum())
    assert edge_in > 0 and edge_opaque == edge_in


def test_stale_xyz():
    man = {"xyz": {"vat": {"url": "v"}, "slrm": {"url": "s"}, "hist_1840": {"url": "h"}}}
    kept, stale = stale_xyz(man, ("vat",), dirs=["vat", "slrm", "hist_1935"])
    assert kept == {"vat": {"url": "v"}} and stale == ["hist_1840", "hist_1935", "slrm"]
    assert stale_xyz({}, ("vat",)) == ({}, [])


# ------------------------------------------------------------------------------------------- generated v3 output
def _v3_dirs():
    root = APP_DATA / "fixture-v3"
    out = []
    for d in sorted(root.iterdir()) if root.is_dir() else []:
        mf = d / "manifest.json"
        if mf.exists() and json.loads(mf.read_text()).get("version") == 3 and "xyz" in json.loads(mf.read_text()):
            out.append(d)
    return out


V3_DIRS = _v3_dirs()


@pytest.mark.skipif(not V3_DIRS, reason="no v3 fixture with xyz")
@pytest.mark.parametrize("d", V3_DIRS, ids=lambda d: d.name)
def test_generated_v3_xyz(d):
    m = json.loads((d / "manifest.json").read_text())
    assert set(m["xyz"]) == {"vat"}
    x = m["xyz"]["vat"]
    assert x["url"] == "xyz/vat/{z}/{x}/{y}.png" and x["maxZoom"] == 16 and x["minZoom"] <= 16
    assert sorted(p.name for p in (d / "xyz").iterdir()) == ["vat"]
    tiles = list((d / "xyz" / "vat").rglob("*.png"))
    assert len(tiles) == x["tileCount"] > 0
    zs = {int(p.relative_to(d / "xyz" / "vat").parts[0]) for p in tiles}
    assert zs == set(range(x["minZoom"], 17))
    (s, w), (n, e) = x["bounds"]
    assert s < n and w < e
