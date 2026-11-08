"""S2 v3 places in buildings.py: per-tile ownership (contract "Many places (v3, S2)", rules 2 + 6), WebP bldg mask."""
from __future__ import annotations

import io
import json
import sys
import tomllib
from pathlib import Path

import numpy as np
import pytest
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from buildings import MASK_PATH, MASK_PATH_V3, Building, in_present_tile, mask_chunks, read_glb, select_buildings  # noqa: E402
from common import AOI, APP_DATA, WORK_DIR, load_aoi  # noqa: E402

# L-shaped place like fixture-v3-homburg: rectangle 376–378 km × 5462–5464 km, NW tile 376_5463 absent
PLACE = AOI("p", "P", 376000, 5462000, 378000, 5464000, 200, "SPK", 500, fmt=3, place="p", ags="10000000",
            owned=frozenset({(376, 5462), (377, 5462), (377, 5463)}), relict_candidates=False)
RECT = AOI("r", "R", 376000, 5462000, 378000, 5464000, 200, "SPK", 500)


def _b(bid: str, e0, n0, e1, n1) -> Building:
    return Building(bid, "sl", footprint=box(e0, n0, e1, n1))


def test_centroid_rule_and_half_open_tiles():
    assert in_present_tile(PLACE, 376500, 5462500)
    assert not in_present_tile(PLACE, 376500, 5463500)        # absent tile inside the rectangle
    assert not in_present_tile(PLACE, 375999.9, 5462500)      # outside the rectangle
    assert in_present_tile(PLACE, 377000.0, 5463000.0)        # edge point → tile east/north (377_5463)
    assert not in_present_tile(PLACE, 376999.99, 5463000.0)   # → 376_5463 (absent)
    assert in_present_tile(RECT, 376500, 5463500)             # rectangle AOIs: no per-tile rule


def test_select_buildings_by_footprint_centroid():
    bs = [
        _b("in", 376100, 5462100, 376120, 5462120),
        _b("absent", 376100, 5463100, 376120, 5463120),
        _b("straddle-in", 376990, 5462990, 377030, 5463004),    # centroid (377010, 5462997) → 377_5462
        _b("straddle-out", 376900, 5463000, 376990, 5463400),   # centroid in absent 376_5463, touches present tiles
        _b("outside", 375900, 5462100, 375990, 5462120),        # in the neighbour's tile west of the rectangle
        _b("outside-touching", 375990, 5462100, 376004, 5462120),  # centroid 375997 → neighbour's tile
    ]
    assert [b.id for b in select_buildings(bs, PLACE)] == ["in", "straddle-in"]
    # v1/v2: footprint intersects the rectangle (unchanged rule)
    assert [b.id for b in select_buildings(bs, RECT)] == ["in", "absent", "straddle-in", "straddle-out",
                                                          "outside-touching"]


def test_two_places_partition_the_buildings():
    other = AOI("q", "Q", 375000, 5462000, 377000, 5464000, 200, "SPK", 500, fmt=3, place="q", ags="10000001",
                owned=frozenset({(375, 5462), (375, 5463), (376, 5463)}), relict_candidates=False)
    rng = np.random.default_rng(3)
    bs = [_b(str(k), e, n, e + w, n + h) for k, (e, n, w, h) in
          enumerate(zip(rng.uniform(375000, 378000, 400), rng.uniform(5462000, 5464000, 400),
                        rng.uniform(4, 60, 400), rng.uniform(4, 60, 400)))]
    a = {b.id for b in select_buildings(bs, PLACE)}
    c = {b.id for b in select_buildings(bs, other)}
    assert not a & c
    inside = {b.id for b in bs if b.footprint.centroid.x < 378000 and b.footprint.centroid.y < 5464000}
    assert len(inside) < len(bs)                     # some centroids fall outside both places
    assert a | c == inside


def test_mask_chunks_present_only():
    ch = mask_chunks(PLACE)
    assert len(ch) == 12 and (0, 0) not in ch and (1, 1) not in ch and (2, 0) in ch and (0, 2) in ch
    assert ch == sorted(ch, key=lambda k: (k[1], k[0]))
    assert len(mask_chunks(RECT)) == 16
    assert MASK_PATH.endswith(".png") and MASK_PATH_V3 == "relief/bldg/{i}_{j}.webp"


# --------------------------------------------------------------------------- generated data (v3 places)
_CFG = tomllib.loads((Path(__file__).resolve().parents[1] / "aois.toml").read_text())
PLACES = [k for k, v in _CFG.items() if isinstance(v, dict) and "place" in v
          and (APP_DATA / v.get("out", k) / "manifest.json").exists()
          and "buildings" in json.loads((APP_DATA / v.get("out", k) / "manifest.json").read_text()).get("models", {})]


@pytest.mark.skipif(not PLACES, reason="no v3 place with models.buildings")
@pytest.mark.parametrize("key", PLACES)
def test_generated_place_buildings(key):
    import rasterio
    from PIL import Image
    a = load_aoi(key)
    d = a.data_dir
    m = json.loads((d / "manifest.json").read_text())
    B = m["models"]["buildings"]
    assert m["version"] == 3 and B["featureCount"] > 0
    assert all(a.chunk_present(i, j) for i, j in B["chunks"])
    assert {f.stem for f in (d / "models" / "buildings").glob("*.glb")} == {f"{i}_{j}" for i, j in B["chunks"]}
    for i, j in B["chunks"]:
        _, arr = read_glb((d / "models" / "buildings" / f"{i}_{j}.glb").read_bytes())
        assert len(arr["POSITION"]) > 0
    L = m["layers"]["bldg"]
    assert L == {**L, "path": MASK_PATH_V3, "encoding": "u8", "min": 0, "max": 1}
    if isinstance(m.get("levels"), list) and m["levels"] and "layers" in m["levels"][0]:
        assert m["levels"][0]["layers"].get("bldg") == L
    want = {f"{i}_{j}" for i, j in mask_chunks(a)}
    files = list((d / "relief" / "bldg").iterdir())
    assert {f.name for f in files} == {f"{s}.webp" for s in want}
    with rasterio.open(WORK_DIR / key / "bldg.tif") as ds:
        work = ds.read(1)
        assert ds.shape == (a.height, a.width) and (ds.transform.c, ds.transform.f) == (a.e0, a.n1)
    for i, j in mask_chunks(a):
        raw = (d / "relief" / "bldg" / f"{i}_{j}.webp").read_bytes()
        assert raw[:4] == b"RIFF" and raw[12:16] == b"VP8L"   # lossless
        with Image.open(io.BytesIO(raw)) as im:
            v = np.asarray(im.convert("RGB"))
        assert v.shape == (500, 500, 3) and (v[..., 0] == v[..., 1]).all() and (v[..., 1] == v[..., 2]).all()
        assert np.array_equal(v[..., 0], work[j * 500:(j + 1) * 500, i * 500:(i + 1) * 500] * 255)
