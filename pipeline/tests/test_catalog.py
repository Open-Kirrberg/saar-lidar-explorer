"""S2 catalog: ownership rule largest-share-v1 (contract test vectors), sle-catalog-v1, overview geometry."""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import pytest
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import catalog as C  # noqa: E402
import grid as G  # noqa: E402
import overview as O  # noqa: E402
from common import APP_DATA  # noqa: E402

T = (380, 5460)   # test tile 380000–381000 × 5460000–5461000


def place(pid, ags, geom):
    return {"id": pid, "ags": ags, "geom": geom, "name_de": pid.title(), "state": "SL"}


def test_vector_600k_400k():
    a = place("aa", "10045114", box(380000, 5460000, 380600, 5461000))
    b = place("bb", "10045113", box(380600, 5460000, 381000, 5461000))
    own = C.ownership([a, b])
    assert own[T]["owner"] == "aa" and own[T]["shares"] == {"aa": 600000, "bb": 400000}


def test_vector_tie_smaller_ags():
    a = place("zz", "10045111", box(380000, 5460000, 380500, 5461000))
    b = place("aa", "10045114", box(380500, 5460000, 381000, 5461000))
    assert C.ownership([b, a])[T]["owner"] == "zz"           # 500 000 / 500 000 → smaller AGS, not smaller id


def test_vector_tie_same_ags_smaller_id():
    assert C.owner_of({"b": 5, "a": 5}, {"a": "10000000", "b": "10000000"}) == "a"


def test_vector_france_and_3m2():
    # the rest of the tile is France (no catalog place); 3 m² in a Saarland municipality → that municipality
    a = place("perl", "10042117", box(380997, 5460000, 381000, 5460001))
    assert C.ownership([a])[T]["owner"] == "perl"


def test_share_below_one_m2_is_no_owner():
    a = place("x", "10000001", box(380000, 5460000, 380000.7, 5460001))          # 0.7 m² → round → 1 m²
    b = place("y", "10000002", box(380000, 5460000, 380000.4, 5460001))          # 0.4 m² → 0 → no share
    assert C.tile_shares(b["geom"]) == {}
    assert C.ownership([a])[T]["shares"] == {"x": 1}
    assert C.ownership([b]) == {}


def test_partition_and_tile_spanning_geometry():
    a = place("a", "10000001", box(379500, 5459500, 381500, 5460500))   # touches 6 tiles
    b = place("b", "10000002", box(380200, 5460000, 381000, 5461000))
    own = C.ownership([a, b])
    assert own[(380, 5460)]["owner"] == "b"                             # 800 000 vs 500 000
    assert own[(379, 5459)]["owner"] == "a" and len(own) == 6


def test_place_entry_bitmap_orientation():
    e = C.place_entry({"id": "x", "ags": "10000001", "name_de": "X", "state": "SL"},
                      {(380, 5461), (381, 5460)}, {"status": "3d", "data_url": "../ort-x/", "relict_candidates": False})
    assert e["bbox"] == [380000, 5460000, 382000, 5462000]
    assert G.decode_bitmap(e["tiles"]) == {(0, 0), (1, 1)}               # row 0 = north
    assert e["state"] == "SL" and e["options"] == {"relict_candidates": False}
    with pytest.raises(ValueError):
        C.place_entry({"id": "x", "ags": "10000001", "name_de": "X", "state": "RLP"}, {(380, 5460)}, {"status": "3d"})
    rp = C.place_entry({"id": "x", "ags": "07320000", "name_de": "X", "state": "RLP"}, {(380, 5460)}, {})
    assert rp["state"] == "RP" and rp["status"] == "stats" and "data_url" not in rp


def test_build_catalog_document():
    a = place("aa", "10045114", box(380000, 5460000, 380600, 5461000))
    b = place("bb", "10045113", box(380600, 5460000, 381000, 5461000))
    own = C.ownership([a, b])
    doc = C.build_catalog([a, b], own, {"aa": {"status": "3d", "data_url": "../ort-aa/"}}, height_ref_m=221,
                          outlines="VG25", outline_attribution="© BKG", overview="overview/overview.json")
    assert doc["format"] == "sle-catalog-v1" and doc["grid"] == G.GRID and doc["height_ref_m"] == 221
    assert doc["ownership"]["rule"] == "largest-share-v1"
    assert [p["id"] for p in doc["places"]] == ["aa"]                   # bb owns no tile
    assert all(";" not in e for e in doc["attribution"].split("; "))


def test_overview_bbox_and_presence():
    tiles = {(375, 5461), (376, 5462), (377, 5463)}
    bb = O.aligned_bbox(tiles, 3)
    assert bb == (372000, 5460000, 380000, 5464000)
    assert G.is_aligned(bb[0], bb[1], bb[2] - bb[0], bb[3] - bb[1], G.chunk_side(3))
    p2 = O.level_presence(bb, 2, tiles)
    assert (p2["w"], p2["h"]) == (4, 2) and G.decode_bitmap(p2) == {(1, 1), (2, 0)}
    p3 = O.level_presence(bb, 3, tiles)
    assert G.decode_bitmap(p3) == {(0, 0), (1, 0)}
    assert O.quantise(221.137) == pytest.approx(221.15)


# ------------------------------------------------------------------------------------------- generated outputs
CATALOGS = [p for p in (APP_DATA / "fixture-v3" / "catalog.json", APP_DATA / "orte-katalog" / "catalog.json")
            if p.exists()]


@pytest.mark.parametrize("path", CATALOGS or [pytest.param(None, marks=pytest.mark.skip("no catalog built"))])
def test_generated_catalog(path):
    doc = json.loads(path.read_text())
    assert doc["format"] == "sle-catalog-v1" and doc["grid"] == G.GRID
    assert isinstance(doc["height_ref_m"], int)
    seen = {}
    for p in doc["places"]:
        bb = p["bbox"]
        assert all(v % 1000 == 0 for v in bb)
        cells = G.decode_bitmap(p["tiles"])
        assert (p["tiles"]["w"], p["tiles"]["h"]) == ((bb[2] - bb[0]) // 1000, (bb[3] - bb[1]) // 1000)
        for c, r in cells:
            t = G.tile_id((bb[0] // 1000 + c, bb[3] // 1000 - 1 - r))
            assert seen.setdefault(t, p["id"]) == p["id"]                  # partition
        if p["status"] in ("3d", "building"):
            m = json.loads((path.parent / p["data_url"] / "manifest.json").read_text())
            assert m["version"] == 3 and m["place"]["id"] == p["id"] and m["place"]["ags"] == p["ags"]
            mt = G.presence_tiles(m["presence"], m["origin"]["E0"], m["origin"]["N0"] + m["size"]["height"])
            assert {G.tile_id(t) for t in mt} <= {t for t, o in seen.items() if o == p["id"]}
            assert m["heightRange"]["min"] >= doc["height_ref_m"]
    if "overview" in doc:
        ov = json.loads((path.parent / doc["overview"]).read_text())
        assert ov["format"] == "sle-overview-v1" and ov["grid"] == G.GRID
        assert doc["height_ref_m"] == math.floor(ov["heightRange"]["min"])
        k_max = ov["levels"][-1]["level"]
        bb = ov["bbox"]
        assert G.is_aligned(bb[0], bb[1], bb[2] - bb[0], bb[3] - bb[1], G.chunk_side(k_max))
        for lv in ov["levels"]:
            k = lv["level"]
            pres = G.decode_bitmap(lv["presence"])
            d = path.parent / Path(doc["overview"]).parent / "levels" / str(k) / "dtm"
            assert {p.stem for p in d.glob("*.webp")} == {f"{i}_{j}" for i, j in pres}
