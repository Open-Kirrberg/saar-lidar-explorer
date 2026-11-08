"""Unit tests for osm.py (F10): classification, clipping, densifying, feature building. No network."""
from __future__ import annotations

import json
import math
import sys
import tomllib
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import APP_DATA, load_aoi  # noqa: E402
from osm import (  # noqa: E402
    ATTRIBUTION_OSM, build_collection, classify_kind, clip_polyline, densify, feature_props, max_segment,
    overpass_query, round_coords, way_to_feature,
)

BOX = (0.0, 0.0, 10.0, 10.0)


def identity(xs, ys):
    return list(xs), list(ys)


@pytest.mark.parametrize("tags, kind", [
    ({"highway": "track", "tracktype": "grade2"}, "track"),
    ({"highway": "path"}, "path"),
    ({"highway": "footway"}, "path"),
    ({"highway": "steps"}, "path"),
    ({"highway": "residential"}, "road"),
    ({"highway": "service"}, "road"),
    ({"highway": "proposed"}, None),
    ({"highway": "construction"}, None),
    ({"highway": "pedestrian", "area": "yes"}, None),
    ({"railway": "rail"}, "rail"),
    ({"railway": "abandoned"}, "rail"),
    ({"railway": "platform"}, None),
    ({"waterway": "stream"}, "water"),
    ({"waterway": "ditch"}, "water"),
    ({"waterway": "riverbank"}, None),
    ({"waterway": "dam"}, None),
    ({"barrier": "wall"}, "barrier"),
    ({"barrier": "retaining_wall"}, "barrier"),
    ({"barrier": "fence"}, None),
    ({"highway": "track", "barrier": "wall"}, "track"),  # highway wins
    ({"building": "yes"}, None),
    ({}, None),
])
def test_classify_kind(tags, kind):
    assert classify_kind(tags) == kind


def test_feature_props_contract_shape():
    p = feature_props(123, {"highway": "track", "tracktype": "grade3", "name": " Alter Weg ", "foo": "x"}, "track")
    assert p == {"kind": "track", "name": "Alter Weg", "highway": "track", "tracktype": "grade3", "osm_id": "way/123"}
    assert feature_props(5, {"waterway": "stream"}, "water") == {"kind": "water", "osm_id": "way/5"}


def test_clip_inside_unchanged():
    pts = [(1, 1), (5, 5), (9, 2)]
    assert clip_polyline(pts, BOX) == [pts]


def test_clip_crossing_and_reentering():
    pieces = clip_polyline([(-5, 5), (5, 5), (15, 5), (15, 8), (5, 8)], BOX)
    assert pieces == [[(0.0, 5.0), (5, 5), (10.0, 5.0)], [(10.0, 8.0), (5, 8)]]


def test_clip_fully_outside_and_corner_touch():
    assert clip_polyline([(-5, -5), (-1, 20)], BOX) == []
    assert clip_polyline([(-1, 1), (1, -1)], BOX) == []  # touches only the corner (0,0)


def test_clip_passing_through_without_inner_vertex():
    pieces = clip_polyline([(-10, -10), (20, 20)], BOX)
    assert len(pieces) == 1
    a, b = pieces[0][0], pieces[0][-1]
    assert a == pytest.approx((0, 0)) and b == pytest.approx((10, 10))


def test_densify_limits_segments_and_keeps_vertices():
    pts = [(0.0, 0.0), (5.0, 0.0), (5.0, 1.0)]
    d = densify(pts, 2.0)
    assert d[0] == pts[0] and d[-1] == pts[-1] and (5.0, 0.0) in d
    assert max_segment(d) <= 2.0 + 1e-12
    assert len(d) == 1 + 3 + 1  # 5 m → 3 segments, 1 m → 1 segment
    assert densify([(0.0, 0.0), (2.0, 0.0)], 2.0) == [(0.0, 0.0), (2.0, 0.0)]  # exactly 2 m: no split


def test_round_coords_dedupes():
    assert round_coords([(1.001, 2.004), (1.004, 2.001), (3.456, 4.0)]) == [[1.0, 2.0], [3.46, 4.0]]


def test_way_to_feature_line_and_multiline():
    way = {"type": "way", "id": 42, "tags": {"highway": "track"},
           "geometry": [{"lon": 1, "lat": 1}, {"lon": 9, "lat": 1}]}
    f = way_to_feature(way, identity, BOX)
    assert f["geometry"]["type"] == "LineString"
    assert f["properties"] == {"kind": "track", "highway": "track", "osm_id": "way/42"}
    assert max_segment(f["geometry"]["coordinates"]) <= 2.0

    way2 = {"type": "way", "id": 7, "tags": {"waterway": "stream"},
            "geometry": [{"lon": -5, "lat": 5}, {"lon": 15, "lat": 5}, {"lon": 15, "lat": 8}, {"lon": 5, "lat": 8}]}
    f2 = way_to_feature(way2, identity, BOX)
    assert f2["geometry"]["type"] == "MultiLineString" and len(f2["geometry"]["coordinates"]) == 2
    for line in f2["geometry"]["coordinates"]:
        assert all(0 <= c <= 10 for p in line for c in p)


def test_way_to_feature_skips_bad_input():
    assert way_to_feature({"type": "way", "id": 1, "tags": {"building": "yes"},
                           "geometry": [{"lon": 1, "lat": 1}, {"lon": 2, "lat": 2}]}, identity, BOX) is None
    assert way_to_feature({"type": "way", "id": 1, "tags": {"highway": "path"},
                           "geometry": [{"lon": 1, "lat": 1}, None]}, identity, BOX) is None
    assert way_to_feature({"type": "way", "id": 1, "tags": {"highway": "path"},
                           "geometry": [{"lon": 20, "lat": 20}, {"lon": 30, "lat": 30}]}, identity, BOX) is None


def test_build_collection_sorted_and_filtered():
    elems = [
        {"type": "way", "id": 9, "tags": {"highway": "path"}, "geometry": [{"lon": 1, "lat": 1}, {"lon": 2, "lat": 2}]},
        {"type": "node", "id": 3, "lat": 1, "lon": 1},
        {"type": "way", "id": 2, "tags": {"barrier": "wall"}, "geometry": [{"lon": 3, "lat": 3}, {"lon": 4, "lat": 3}]},
    ]
    fc = build_collection({"elements": elems}, identity, BOX)
    assert fc["type"] == "FeatureCollection"
    assert [f["properties"]["osm_id"] for f in fc["features"]] == ["way/2", "way/9"]


def test_real_projection_and_rounding_keep_segments_le_2m():
    from pyproj import Transformer
    tr = Transformer.from_crs("EPSG:4326", "EPSG:25832", always_xy=True)
    box = (381000.0, 5465000.0, 384000.0, 5468000.0)
    way = {"type": "way", "id": 1, "tags": {"highway": "track"},
           "geometry": [{"lon": 7.37, "lat": 49.33}, {"lon": 7.39, "lat": 49.345}, {"lon": 7.391, "lat": 49.3451}]}
    f = way_to_feature(way, tr.transform, box)
    coords = f["geometry"]["coordinates"]
    assert max_segment(coords) <= 2.0
    assert all(c == round(c, 2) for p in coords for c in p)


def test_overpass_query_shape():
    q = overpass_query(49.3, 7.3, 49.4, 7.4)
    assert q.startswith("[out:json]") and "out tags geom;" in q
    assert q.count("(49.300000,7.300000,49.400000,7.400000)") == 4
    assert ";" not in ATTRIBUTION_OSM


# --- generated output (skipped until `./run.sh <aoi> osm` has run) ---------------------------------

# Only AOIs known to aois.toml: app/public/data/ may also hold synthetic data (e.g. the app's
# `fixture`), which load_aoi() does not know and which is not pipeline output.
_KNOWN = [k for k in tomllib.loads((Path(__file__).resolve().parents[1] / "aois.toml").read_text()) if k != "defaults"]
OSM_AOIS = sorted(k for k in _KNOWN
                  if (APP_DATA / k / "vectors" / "osm.geojson").exists() and (APP_DATA / k / "manifest.json").exists())


@pytest.mark.parametrize("aoi", OSM_AOIS)
def test_generated_osm_geojson_matches_contract(aoi):
    a = load_aoi(aoi)
    m = json.loads((APP_DATA / aoi / "manifest.json").read_text())
    entry = m["vectors"]["osm"]
    if entry.get("densified") is False:
        pytest.skip("v3 place output (densified: false) – checked in test_osm_v3.py")
    assert entry["path"] == "vectors/osm.geojson" and entry["crs"] == "EPSG:25832"
    assert ATTRIBUTION_OSM in [s.strip() for s in m["attribution"].split(";")]
    fc = json.loads((APP_DATA / aoi / entry["path"]).read_text())
    assert fc["type"] == "FeatureCollection" and len(fc["features"]) == entry["featureCount"] > 0
    kinds = {"road", "track", "path", "rail", "water", "barrier"}
    for f in fc["features"]:
        p, g = f["properties"], f["geometry"]
        assert p["kind"] in kinds and p["osm_id"].startswith("way/")
        lines = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
        assert g["type"] in ("LineString", "MultiLineString")
        for line in lines:
            assert len(line) >= 2
            assert max_segment(line) <= 2.0 + 1e-9
            for e, n, *z in line:
                assert len(z) == (1 if entry.get("heights") == "baked" else 0)
                assert a.e0 <= e <= a.e1 and a.n0 <= n <= a.n1
                assert math.isclose(e, round(e, 2)) and math.isclose(n, round(n, 2))
