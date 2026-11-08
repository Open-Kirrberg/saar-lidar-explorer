"""Unit tests for the v3 place output of osm.py (contract "Vectors in v3", rule 6): exact clip to the union of
present tiles, original vertices, 0.1 m rounding, `densified: false`. No network."""
from __future__ import annotations

import json
import math
import random
import sys
import tomllib
from pathlib import Path

import pytest
import shapely
from shapely.geometry import LineString, box, shape

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import load_aoi  # noqa: E402
from osm import (  # noqa: E402
    ATTRIBUTION_OSM, build_collection_v3, clip_polyline_tiles, manifest_entry, way_to_feature_v3,
)


def identity(xs, ys):
    return list(xs), list(ys)


def way(wid, pts, **tags):
    return {"type": "way", "id": wid, "tags": tags or {"highway": "track"},
            "geometry": [{"lon": e, "lat": n} for e, n in pts]}


def area(tiles):
    return shapely.union_all([box(e * 1000, n * 1000, e * 1000 + 1000, n * 1000 + 1000) for e, n in tiles])


# --- clip_polyline_tiles -------------------------------------------------------------------------------

def test_inside_single_tile_unchanged():
    pts = [(100.0, 100.0), (500.0, 300.0), (900.0, 900.0)]
    assert clip_polyline_tiles(pts, {(0, 0)}) == [pts]


def test_line_crossing_an_absent_tile_is_cut_at_the_tile_edges():
    # tiles 0 and 2 present, tile 1 absent: the vertex inside tile 1 is dropped, cut points exactly on the edges
    pts = [(500.0, 500.0), (1500.0, 600.0), (2500.0, 700.0)]
    pieces = clip_polyline_tiles(pts, {(0, 0), (2, 0)})
    assert len(pieces) == 2
    (a, b), (c, d) = pieces
    assert a == (500.0, 500.0) and b[0] == 1000.0 and math.isclose(b[1], 550.0)
    assert c[0] == 2000.0 and math.isclose(c[1], 650.0) and d == (2500.0, 700.0)


def test_no_cut_point_between_two_present_tiles():
    pts = [(500.0, 500.0), (1500.0, 600.0)]
    assert clip_polyline_tiles(pts, {(0, 0), (1, 0)}) == [pts]


def test_line_on_a_shared_edge_belongs_to_one_side_only():
    pts = [(1000.0, 100.0), (1000.0, 900.0)]
    assert clip_polyline_tiles(pts, {(0, 0)}) == []
    assert clip_polyline_tiles(pts, {(1, 0)}) == [pts]


def test_through_a_tile_corner():
    pts = [(500.0, 500.0), (1500.0, 1500.0)]
    assert clip_polyline_tiles(pts, {(0, 0), (1, 1)}) == [pts]  # touches the absent tiles in a point only
    assert clip_polyline_tiles(pts, {(1, 1)}) == [[(1000.0, 1000.0), (1500.0, 1500.0)]]


def test_duplicate_vertices_and_leaving_reentering():
    pts = [(100.0, 100.0), (100.0, 100.0), (1500.0, 100.0), (1500.0, 200.0), (100.0, 200.0)]
    pieces = clip_polyline_tiles(pts, {(0, 0)})
    assert pieces == [[(100.0, 100.0), (1000.0, 100.0)], [(1000.0, 200.0), (100.0, 200.0)]]


def test_matches_shapely_and_partitions_between_disjoint_places():
    rnd = random.Random(7)
    a_tiles = {(0, 0), (1, 0), (1, 1)}          # L-shape like the fixture places
    b_tiles = {(0, 1), (-1, 1), (-1, 0)}
    for _ in range(200):
        pts = [(rnd.uniform(-1500, 2500), rnd.uniform(-500, 2500)) for _ in range(rnd.randint(2, 6))]
        line = LineString(pts)
        got = {}
        for name, tiles in (("a", a_tiles), ("b", b_tiles)):
            pieces = clip_polyline_tiles(pts, tiles)
            geom = shapely.union_all([LineString(p) for p in pieces]) if pieces else LineString()
            assert math.isclose(geom.length, line.intersection(area(tiles)).length, abs_tol=1e-6)
            assert geom.is_empty or area(tiles).buffer(1e-6).covers(geom)
            orig = set(pts)
            for p in pieces:  # inner vertices are original vertices
                assert all(v in orig for v in p[1:-1])
            got[name] = geom
        assert got["a"].intersection(got["b"]).length < 1e-6  # no line drawn by both places


# --- features and manifest -----------------------------------------------------------------------------

def test_way_to_feature_v3_rounds_to_dm_keeps_props_and_splits():
    tiles = frozenset({(0, 0), (2, 0)})
    f = way_to_feature_v3(way(42, [(100.04, 100.06), (1500.0, 300.0), (2900.123, 899.987)], highway="track",
                              tracktype="grade2", name="Alter Weg"), identity, tiles)
    assert f["properties"] == {"kind": "track", "name": "Alter Weg", "highway": "track", "tracktype": "grade2",
                               "osm_id": "way/42"}
    g = f["geometry"]
    assert g["type"] == "MultiLineString" and len(g["coordinates"]) == 2
    for line in g["coordinates"]:
        for c in line:
            assert len(c) == 2 and round(c[0], 1) == c[0] and round(c[1], 1) == c[1]
    assert g["coordinates"][0][0] == [100.0, 100.1] and g["coordinates"][0][-1][0] == 1000.0
    assert g["coordinates"][1][0][0] == 2000.0 and g["coordinates"][1][-1] == [2900.1, 900.0]
    # no densification: a 1.4 km segment stays one segment
    single = way_to_feature_v3(way(1, [(10.0, 10.0), (990.0, 990.0)]), identity, tiles)
    assert single["geometry"] == {"type": "LineString", "coordinates": [[10.0, 10.0], [990.0, 990.0]]}


def test_way_to_feature_v3_outside_or_skipped():
    tiles = frozenset({(0, 0)})
    assert way_to_feature_v3(way(1, [(1500.0, 10.0), (1600.0, 900.0)]), identity, tiles) is None
    assert way_to_feature_v3(way(2, [(10.0, 10.0), (20.0, 20.0)], building="yes"), identity, tiles) is None
    # a piece that collapses below 0.1 m after rounding is dropped
    assert way_to_feature_v3(way(3, [(999.97, 10.0), (1500.0, 10.0)]), identity, tiles) is None


def test_build_collection_v3_sorted():
    tiles = frozenset({(0, 0)})
    fc = build_collection_v3({"elements": [way(9, [(1.0, 1.0), (5.0, 5.0)]), way(3, [(1.0, 2.0), (5.0, 6.0)]),
                                           {"type": "node", "id": 1}]}, identity, tiles)
    assert [f["properties"]["osm_id"] for f in fc["features"]] == ["way/3", "way/9"]


def test_manifest_entry_shapes():
    v3 = manifest_entry(5, "OpenStreetMap", v3=True)
    assert v3 == {"path": "vectors/osm.geojson", "crs": "EPSG:25832", "featureCount": 5,
                  "label_de": "Wege & Straßen (OSM)", "source": "OpenStreetMap", "densified": False}
    v2 = manifest_entry(5, "OpenStreetMap", v3=False)
    assert v2["heights"] == "baked" and "densified" not in v2


# --- generated output of v3 places (skipped until `./run.sh <place> osm` has run) ---------------------

_CFG = tomllib.loads((Path(__file__).resolve().parents[1] / "aois.toml").read_text())
_PLACES = [k for k, v in _CFG.items() if isinstance(v, dict) and "place" in v]


def _loadable(k):
    try:
        return load_aoi(k)
    except SystemExit:  # e.g. a real place before the catalog ownership step has run
        return None


OSM_PLACES = [k for k in _PLACES if (a := _loadable(k)) and (a.data_dir / "vectors" / "osm.geojson").exists()]


@pytest.mark.parametrize("key", OSM_PLACES)
def test_generated_v3_osm_matches_contract(key):
    a = load_aoi(key)
    m = json.loads((a.data_dir / "manifest.json").read_text())
    if m.get("version") != 3:
        pytest.skip("manifest is not v3")
    entry = m["vectors"]["osm"]
    assert entry["densified"] is False and "heights" not in entry and entry["crs"] == "EPSG:25832"
    assert ATTRIBUTION_OSM in m["attribution"].split("; ")
    fc = json.loads((a.data_dir / entry["path"]).read_text())
    assert len(fc["features"]) == entry["featureCount"] > 0
    present = area(a.owned).buffer(1e-6)
    for f in fc["features"]:
        g = f["geometry"]
        assert g["type"] in ("LineString", "MultiLineString")
        for line in [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]:
            assert len(line) >= 2
            assert all(len(c) == 2 and round(c[0], 1) == c[0] and round(c[1], 1) == c[1] for c in line)
        assert present.covers(shape(g))
