"""Unit tests for cadastre.py (pure logic, no network)."""
from __future__ import annotations

import json
import math
import sys
import urllib.parse
from pathlib import Path

import pytest
from shapely.geometry import MultiPoint, Point, box

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cadastre  # noqa: E402

URN = "urn:ogc:def:crs:EPSG::25832"


def poly_feature(geom, **props):
    return {"type": "Feature", "geometry": geom.__geo_interface__, "properties": props}


def page_bytes(features):
    return json.dumps({"type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": "EPSG:25832"}},
                       "features": features}).encode()


# --- requests --------------------------------------------------------------------------------------

def test_wfs_url_uses_25832_urn_for_bbox_and_srsname():
    q = urllib.parse.parse_qs(urllib.parse.urlsplit(
        cadastre.wfs_url("Flurstueck", (381000, 5465000, 384000, 5468000), start=10000)).query)
    assert q["BBOX"] == [f"381000,5465000,384000,5468000,{URN}"]  # E,N axis order
    assert q["SRSNAME"] == [URN]
    assert q["TYPENAMES"] == ["ALKIS_ALKIS_WFS_ohne_Eig:Flurstueck"]
    assert q["OUTPUTFORMAT"] == ["GEOJSON"] and q["COUNT"] == ["10000"] and q["STARTINDEX"] == ["10000"]
    hits = urllib.parse.parse_qs(urllib.parse.urlsplit(cadastre.wfs_url("Flurstueck", (0, 0, 1, 1), hits=True)).query)
    assert hits["RESULTTYPE"] == ["hits"] and "OUTPUTFORMAT" not in hits


def test_parse_number_matched():
    xml = b'<?xml version="1.0"?><wfs:FeatureCollection x="1" numberMatched="2607" numberReturned="0"/>'
    assert cadastre.parse_number_matched(xml) == 2607
    with pytest.raises(ValueError):
        cadastre.parse_number_matched(b"<ows:ExceptionReport/>")


def test_parse_page_rejects_exception_reports_and_wrong_crs():
    assert cadastre.parse_page(page_bytes([])) == []
    with pytest.raises(ValueError):
        cadastre.parse_page(b'<?xml version="1.0"?><ows:ExceptionReport>boom</ows:ExceptionReport>')
    with pytest.raises(ValueError):
        cadastre.parse_page(b'{"type":"Feature"}')
    bad = json.dumps({"type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": "EPSG:4326"}},
                      "features": []}).encode()
    with pytest.raises(ValueError):
        cadastre.parse_page(bad)


def test_fetch_type_pages_and_reuses_cache(tmp_path):
    feats = [poly_feature(box(i, 0, i + 1, 1), OID=f"o{i}") for i in range(5)]
    calls = []

    def get(url):
        calls.append(url)
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        if q.get("RESULTTYPE") == ["hits"]:
            return b'<wfs:FeatureCollection numberMatched="5" numberReturned="0"/>'
        start, count = int(q["STARTINDEX"][0]), int(q["COUNT"][0])
        return page_bytes(feats[start:start + count])

    got = cadastre.fetch_type("Flurstueck", (0, 0, 10, 10), tmp_path, get=get, page_size=2)
    assert [f["properties"]["OID"] for f in got] == ["o0", "o1", "o2", "o3", "o4"]
    assert len(calls) == 4  # hits + pages 0, 2, 4
    again = cadastre.fetch_type("Flurstueck", (0, 0, 10, 10), tmp_path, get=lambda u: pytest.fail("network"),
                                page_size=2)
    assert again == got


def test_fetch_type_exact_multiple_needs_no_extra_page(tmp_path):
    feats = [poly_feature(box(i, 0, i + 1, 1), OID=f"o{i}") for i in range(4)]
    calls = []

    def get(url):
        calls.append(url)
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        if q.get("RESULTTYPE") == ["hits"]:
            return b'numberMatched="4"'
        start = int(q["STARTINDEX"][0])
        return page_bytes(feats[start:start + 2])

    assert len(cadastre.fetch_type("X", (0, 0, 1, 1), tmp_path, get=get, page_size=2)) == 4
    assert len(calls) == 3


def test_fetch_type_detects_count_mismatch_and_does_not_cache_errors(tmp_path):
    def get(url):
        if "RESULTTYPE=hits" in url:
            return b'numberMatched="3"'
        return page_bytes([poly_feature(box(0, 0, 1, 1), OID="a")])

    with pytest.raises(RuntimeError, match="numberMatched=3"):
        cadastre.fetch_type("X", (0, 0, 1, 1), tmp_path, get=get, page_size=2)

    def get_err(url):
        if "RESULTTYPE=hits" in url:
            return b'numberMatched="1"'
        return b"<ows:ExceptionReport/>"

    with pytest.raises(ValueError):
        cadastre.fetch_type("Y", (0, 0, 1, 1), tmp_path, get=get_err)
    assert not list((tmp_path).glob("Y_*/page_*.geojson"))


# --- attributes ------------------------------------------------------------------------------------

def test_label_text_and_clean():
    assert cadastre.label_text("5419", "null") == "5419"
    assert cadastre.label_text("5416", "2") == "5416/2"
    assert cadastre.label_text(" 12 ", None) == "12"
    assert cadastre.label_text("null", "3") is None
    assert cadastre.clean("NULL") is None and cadastre.clean("") is None and cadastre.clean(7) == "7"


def test_dedupe_by_oid():
    a = poly_feature(box(0, 0, 1, 1), OID="x")
    b = poly_feature(box(0, 0, 1, 1), OID="x")
    c = poly_feature(box(0, 0, 1, 1), OID="y")
    assert cadastre.dedupe([a, b, c]) == [a, c]


# --- geometry --------------------------------------------------------------------------------------

def _seg_lengths(coords):
    return [math.dist(a, b) for a, b in zip(coords, coords[1:])]


def test_boundary_lines_shared_edge_once_densified_rounded():
    # two 10 m squares sharing the edge x=10; AOI covers both
    left, right = box(0, 0, 10, 10), box(10, 0, 20, 10)
    lines = cadastre.boundary_lines([left, right], (-5, -5, 25, 15))
    total = sum(sum(_seg_lengths(c)) for c in lines)
    assert total == pytest.approx(70.0, abs=1e-6)  # 2×40 perimeter − 10 shared
    assert max(s for c in lines for s in _seg_lengths(c)) <= cadastre.MAX_SEGMENT_M
    for c in lines:
        for x, y in c:
            assert round(x, 2) == x and round(y, 2) == y


def test_boundary_lines_dedupes_near_identical_vertices():
    # a neighbour's copy of the shared edge differs by 1 mm (below the 1 cm grid)
    left = box(0, 0, 10, 10)
    right = shapely_poly([(10.001, 0), (20, 0), (20, 10), (10.001, 10)])
    lines = cadastre.boundary_lines([left, right], (-5, -5, 25, 15))
    assert sum(sum(_seg_lengths(c)) for c in lines) == pytest.approx(70.0, abs=0.01)


def shapely_poly(coords):
    from shapely.geometry import Polygon
    return Polygon(coords)


def test_boundary_lines_clipped_to_aoi_without_drawing_aoi_edge():
    big = box(0, 0, 100, 100)
    lines = cadastre.boundary_lines([big], (50, 50, 150, 150))
    pts = [p for c in lines for p in c]
    assert all(50 <= x <= 150 and 50 <= y <= 150 for x, y in pts)
    total = sum(sum(_seg_lengths(c)) for c in lines)
    assert total == pytest.approx(100.0, abs=1e-6)  # only the parcel's top + right edges inside the AOI


def test_boundary_lines_with_hole_and_long_edge():
    ring = shapely_poly([(0, 0), (101, 0), (101, 101), (0, 101)]).difference(box(40, 40, 60, 60))
    lines = cadastre.boundary_lines([ring], (-1, -1, 200, 200))
    assert sum(sum(_seg_lengths(c)) for c in lines) == pytest.approx(4 * 101 + 4 * 20, abs=1e-6)
    assert max(s for c in lines for s in _seg_lengths(c)) <= cadastre.MAX_SEGMENT_M


def test_label_point_prefers_punkt_inside_parcel_and_aoi():
    parcel = box(0, 0, 10, 10)
    pt, how = cadastre.label_point(parcel, MultiPoint([(3, 4)]), (-100, -100, 100, 100))
    assert how == "punkt" and (pt.x, pt.y) == (3, 4)
    # punkt outside the parcel (ALKIS places labels of tiny parcels outside) -> representative point
    pt, how = cadastre.label_point(parcel, Point(30, 30), (-100, -100, 100, 100))
    assert how == "representative" and parcel.contains(pt)
    # punkt outside the AOI -> representative point of the clipped part
    pt, how = cadastre.label_point(parcel, Point(2, 2), (5, 5, 100, 100))
    assert how == "representative" and box(5, 5, 10, 10).contains(pt)
    # no punkt
    assert cadastre.label_point(parcel, None, (-100, -100, 100, 100))[1] == "representative"
    # parcel only touching the AOI edge
    assert cadastre.label_point(parcel, None, (10, 0, 20, 10)) == (None, "none")


def test_build_outputs_contract_shapes():
    aoi = (0, 0, 100, 100)
    parcels = [
        poly_feature(box(0, 0, 10, 10), OID="a", FLSTKENNZ="10207202205419______", FLSTNRZAE="5419",
                     FLSTNRNEN="null", GEMARKUNG="Bruchhof-Sanddorf", FLUR="Flur 22", LAGEBEZTXT="Am Karlsberg"),
        poly_feature(box(10, 0, 20, 10), OID="b", FLSTKENNZ="10207202205416000200", FLSTNRZAE="5416",
                     FLSTNRNEN="2", GEMARKUNG="Bruchhof-Sanddorf", FLUR="Flur 22", LAGEBEZTXT="null"),
        poly_feature(box(10, 0, 20, 10), OID="b"),  # duplicate from another page
    ]
    punkte = [{"type": "Feature", "geometry": MultiPoint([(5.004, 5.006)]).__geo_interface__,
               "properties": {"OID": "pa", "FLSTKENNZ": "10207202205419______"}}]
    lines, labels, stats = cadastre.build_outputs(parcels, punkte, aoi)
    assert stats["parcels"] == 2 and stats["labels"] == 2
    assert stats["label_punkt"] == 1 and stats["label_representative"] == 1
    assert all(f["geometry"]["type"] == "LineString" and f["properties"] == {"kind": "parcel"}
               for f in lines["features"])
    by_text = {f["properties"]["text"]: f for f in labels["features"]}
    a = by_text["5419"]
    assert a["geometry"] == {"type": "Point", "coordinates": [5.0, 5.01]}
    assert a["properties"] == {"text": "5419", "flstkennz": "10207202205419______",
                               "gemarkung": "Bruchhof-Sanddorf", "flur": "Flur 22", "lage": "Am Karlsberg"}
    assert "lage" not in by_text["5416/2"]["properties"]
    json.dumps(lines), json.dumps(labels)  # serialisable


# --- Rheinland-Pfalz (WFS 519, GML 3.2) ------------------------------------------------------------

RLP_GML = b"""<?xml version='1.0' encoding="UTF-8" ?>
<wfs:FeatureCollection xmlns:ave="http://repository.gdi-de.org/schemas/adv/produkt/alkis-vereinfacht/2.0"
   xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:wfs="http://www.opengis.net/wfs/2.0"
   timeStamp="2026-11-01T02:40:33" numberMatched="1" numberReturned="1">
  <wfs:boundedBy><gml:Envelope srsName="urn:ogc:def:crs:EPSG::25832"><gml:lowerCorner>0 0</gml:lowerCorner>
    <gml:upperCorner>10 10</gml:upperCorner></gml:Envelope></wfs:boundedBy>
  <wfs:member>
    <ave:Flurstueck gml:id="Flurstueck.1">
      <gml:boundedBy><gml:Envelope srsName="urn:ogc:def:crs:EPSG::25832"><gml:lowerCorner>0 0</gml:lowerCorner>
        <gml:upperCorner>10 10</gml:upperCorner></gml:Envelope></gml:boundedBy>
      <ave:geometrie>
        <gml:Polygon gml:id="Flurstueck.1.1" srsName="urn:ogc:def:crs:EPSG::25832">
          <gml:exterior><gml:LinearRing><gml:posList srsDimension="2">383000.5 5466000.25 383010 5466000.25
            383010 5466010 383000.5 5466010 383000.5 5466000.25</gml:posList></gml:LinearRing></gml:exterior>
          <gml:interior><gml:LinearRing><gml:posList srsDimension="2">383002 5466002 383004 5466002 383004 5466004
            383002 5466004 383002 5466002</gml:posList></gml:LinearRing></gml:interior>
        </gml:Polygon>
      </ave:geometrie>
      <ave:oid>DERPLP1900000Et5FL</ave:oid>
      <ave:aktualit gml:id="x"><gml:timePosition>2026-07-24</gml:timePosition></ave:aktualit>
      <ave:flstkennz>075054000050610003__</ave:flstkennz>
      <ave:gemarkung>K\xc3\xa4shofen</ave:gemarkung>
      <ave:flur>Flur 0</ave:flur>
      <ave:flstnrzae>5061</ave:flstnrzae>
      <ave:flstnrnen>3</ave:flstnrnen>
      <ave:regbezirk></ave:regbezirk>
      <ave:lagebeztxt>Franzosenkopf</ave:lagebeztxt>
    </ave:Flurstueck>
  </wfs:member>
</wfs:FeatureCollection>"""


def test_parse_gml_page_rlp():
    (f,) = cadastre.parse_gml_page(RLP_GML)
    p = f["properties"]
    assert p["FLSTKENNZ"] == "075054000050610003__" and p["GEMARKUNG"] == "Käshofen" and p["OID"] == "DERPLP1900000Et5FL"
    assert cadastre.label_text(p["FLSTNRZAE"], p["FLSTNRNEN"]) == "5061/3" and p["REGBEZIRK"] == ""
    assert f["geometry"]["type"] == "MultiPolygon"
    (rings,) = f["geometry"]["coordinates"]
    assert rings[0][0] == [383000.5, 5466000.25] and len(rings) == 2  # E,N order, hole kept
    g = cadastre.to_geom(f)
    assert g.area == pytest.approx(9.5 * 9.75 - 4)


def test_parse_gml_page_rejects_exceptions_and_wrong_crs():
    with pytest.raises(ValueError):
        cadastre.parse_gml_page(b'<ows:ExceptionReport xmlns:ows="http://www.opengis.net/ows/1.1"/>')
    with pytest.raises(ValueError):
        cadastre.parse_gml_page(b"not xml")
    with pytest.raises(ValueError):
        cadastre.parse_gml_page(RLP_GML.replace(b"EPSG::25832", b"EPSG::4258"))


def test_rlp_wfs_url_gml_default_and_25832():
    q = urllib.parse.parse_qs(urllib.parse.urlsplit(cadastre.rlp_wfs_url("Flurstueck", (1, 2, 3, 4), start=5)).query)
    assert cadastre.RLP_WFS_URL.endswith("/registry/wfs/519")
    assert q["TYPENAMES"] == ["ave:Flurstueck"] and "OUTPUTFORMAT" not in q
    assert q["BBOX"] == [f"1,2,3,4,{URN}"] and q["SRSNAME"] == [URN] and q["STARTINDEX"] == ["5"]


def test_fetch_type_with_gml_parser_caches_with_suffix(tmp_path):
    def get(url):
        return RLP_GML if "RESULTTYPE" not in url else b'numberMatched="1"'

    got = cadastre.fetch_type("Flurstueck", (0, 0, 1, 1), tmp_path, get=get, url=cadastre.rlp_wfs_url,
                              parse=cadastre.parse_gml_page, suffix=".gml", cache_prefix="rlp_")
    assert len(got) == 1
    assert (tmp_path / "rlp_Flurstueck_0_0_1_1" / "page_0.gml").exists()


# --- polygons (POLISH: point-in-polygon lookup) ----------------------------------------------------

def test_parse_area():
    assert cadastre.parse_area(119.0) == 119 and isinstance(cadastre.parse_area(119.0), int)
    assert cadastre.parse_area("940") == 940
    assert cadastre.parse_area("12,345") == 12.35
    assert cadastre.parse_area(None) is None and cadastre.parse_area("null") is None
    assert cadastre.parse_area("abc") is None and cadastre.parse_area(0) is None and cadastre.parse_area("nan") is None


def test_build_polygons_whole_2d_deduped_with_props():
    bbox = (100.0, 100.0, 200.0, 200.0)
    # crosses the AOI edge (kept whole), has a hole and an un-densified 150 m edge
    crossing = box(50.0, 120.0, 150.0004, 140.0).difference(box(60, 125, 70, 130))
    feats = [
        poly_feature(crossing, OID="a", FLSTKENNZ="K1", FLSTNRZAE="12", FLSTNRNEN="3", GEMARKUNG="Sanddorf",
                     FLUR="Flur 2", LAGEBEZTXT="Am Weg", FLAECHE=1950.0),
        poly_feature(box(150, 150, 160, 160), OID="b", FLSTKENNZ="K1", FLSTNRZAE="12", FLSTNRNEN="3"),  # dup kennz
        poly_feature(box(150, 150, 160, 160), OID="c", FLSTKENNZ="K2", FLSTNRZAE="7", FLSTNRNEN="null",
                     GEMARKUNG="Bechhofen", FLUR="Flur 0", FLAECHE="null"),
        poly_feature(box(300, 300, 310, 310), OID="d", FLSTKENNZ="K3", FLSTNRZAE="8"),  # outside the AOI
        poly_feature(box(110, 110, 120, 120), OID="e", FLSTKENNZ="K4", FLSTNRZAE="null"),  # no number
    ]
    fc, stats = cadastre.build_polygons(feats, bbox)
    assert stats["polygons"] == 2 and stats["poly_dup"] == 1 and stats["poly_outside"] == 1
    assert stats["poly_no_number"] == 1 and stats["poly_area"] == 1
    a, c = fc["features"]
    assert a["properties"] == {"flstkennz": "K1", "gemarkung": "Sanddorf", "flur": "Flur 2", "zae": "12", "nen": "3",
                               "text": "12/3", "lage": "Am Weg", "flaeche_m2": 1950}
    assert c["properties"] == {"flstkennz": "K2", "gemarkung": "Bechhofen", "flur": "Flur 0", "zae": "7", "text": "7"}
    g = a["geometry"]
    assert g["type"] == "Polygon" and len(g["coordinates"]) == 2  # outer + hole
    outer = g["coordinates"][0]
    xs = [p[0] for p in outer]
    assert min(xs) == 50.0 and max(xs) == 150.0  # not clipped, rounded to 0.01 m
    assert all(len(p) == 2 for ring in g["coordinates"] for p in ring)  # never z
    assert len(outer) == 5 and outer[0] == outer[-1]  # original vertices, not densified
    # round trip: the lookup finds the parcel at a point inside, not inside the hole
    from shapely.geometry import shape
    assert shape(g).contains(Point(140, 130)) and not shape(g).contains(Point(65, 127))


def test_polygon_geometry_multipolygon_and_collection():
    from shapely.geometry import GeometryCollection, LineString, MultiPolygon
    mp = MultiPolygon([box(0, 0, 1, 1), box(2, 2, 3, 3)])
    assert cadastre.polygon_geometry(mp)["type"] == "MultiPolygon"
    gc = GeometryCollection([box(0, 0, 1, 1), LineString([(0, 0), (5, 5)])])
    assert cadastre.polygon_geometry(gc)["type"] == "Polygon"
    assert cadastre.polygon_geometry(LineString([(0, 0), (1, 1)])) is None
    assert cadastre.polygon_geometry(box(0, 0, 0.001, 0.001)) is None  # collapses at 1 cm
