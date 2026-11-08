"""Pure parts of places.py (Orte im Vergleich, Phase 0): slugs, dissolve, bbox snapping, filters, paging."""
import json
import sys
import tomllib
import urllib.parse
from pathlib import Path

import pytest
from shapely.geometry import MultiPolygon, Polygon, box

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import places as P  # noqa: E402
from common import load_aoi  # noqa: E402

AOIS_TOML = Path(__file__).resolve().parents[1] / "aois.toml"


# --- ids -------------------------------------------------------------------------------------------

@pytest.mark.parametrize("name,expected", [
    ("Kirrberg", "kirrberg"), ("Einöd", "einoed"), ("Mörsbach", "moersbach"), ("Zweibrücken", "zweibruecken"),
    ("Bruchhof-Sanddorf", "bruchhof-sanddorf"), ("Beeden-Schwarzenbach", "beeden-schwarzenbach"),
    ("Straße (Neu)", "strasse-neu"), ("  Élan  ", "elan"),
])
def test_slug(name, expected):
    assert P.slug(name) == expected


def test_slug_rejects_empty():
    with pytest.raises(ValueError):
        P.slug("–")


def test_places_are_the_nine_decided_ones():
    ids = [p.id for p in P.PLACES]
    assert ids == ["kirrberg", "homburg", "bruchhof-sanddorf", "beeden-schwarzenbach", "erbach-reiskirchen",
                   "einoed", "moersbach", "bechhofen", "zweibruecken"]
    assert len(set(ids)) == len(ids)
    for p in P.PLACES:
        assert p.state in ("SL", "RLP") and len(p.municipality_key) == 8
        assert p.flags == (["other-flight"] if p.state == "RLP" else [])
    assert {p.id for p in P.PLACES if p.state == "RLP"} == {"moersbach", "bechhofen", "zweibruecken"}


# --- dissolve --------------------------------------------------------------------------------------

def test_dissolve_adjacent_parcels_with_float_noise():
    a = box(0, 0, 10, 10)
    b = Polygon([(10.000001, 0), (20, 0), (20, 10), (10.000002, 10)])  # shared edge off by µm
    out, info = P.dissolve([a, b])
    assert isinstance(out, Polygon) and len(out.interiors) == 0
    assert out.area == pytest.approx(200, abs=0.01)
    assert info["parts"] == 1 and info["holes"] == 0


def test_dissolve_drops_sliver_hole_keeps_enclave():
    # ring of four parcels around a 20x20 enclave (kept) + a 1 m² sliver hole inside one parcel (dropped)
    ring = [box(0, 0, 100, 40), box(0, 60, 100, 100), box(0, 40, 40, 60), box(60, 40, 100, 60)]
    sliver_parcel = Polygon(box(0, 0, 100, 40).exterior.coords, [[(10, 10), (11, 10), (11, 11), (10, 11)]])
    out, info = P.dissolve([sliver_parcel, *ring[1:]])
    assert isinstance(out, Polygon)
    assert info["holes"] == 1 and len(out.interiors) == 1
    assert Polygon(out.interiors[0]).area == pytest.approx(400)
    assert info["dropped_holes_m2"] == pytest.approx(1.0)
    assert out.area == pytest.approx(100 * 100 - 400)


def test_dissolve_disjoint_parts_and_invalid_input():
    bowtie = Polygon([(0, 0), (10, 10), (10, 0), (0, 10)])  # self-intersecting -> make_valid
    far = box(1000, 1000, 1010, 1010)
    tiny = box(5000, 5000, 5000.5, 5000.5)                 # 0.25 m² part -> dropped
    out, info = P.dissolve([bowtie, far, tiny])
    assert isinstance(out, MultiPolygon) and info["parts"] == 3  # bowtie -> two triangles touching at a point
    assert out.area == pytest.approx(50 + 100)
    assert info["dropped_parts_m2"] == pytest.approx(0.25)


def test_dissolve_needs_polygons():
    with pytest.raises(ValueError):
        P.dissolve([])


# --- bbox and tiles --------------------------------------------------------------------------------

def test_snap_bbox_grows_and_snaps_outward():
    assert P.snap_bbox((378_850.3, 5_452_100.0, 389_799.9, 5_470_000.0)) == (378_000, 5_451_000, 390_000, 5_471_000)
    # exactly on the grid after the margin: no extra km
    assert P.snap_bbox((1200, 1200, 2800, 2800)) == (1000, 1000, 3000, 3000)
    assert P.snap_bbox((10, 10, 20, 20), margin=0, step=100) == (0, 0, 100, 100)
    with pytest.raises(ValueError):
        P.snap_bbox((5, 0, 0, 5))


def test_tiles_in_and_touching():
    bb = (378_000, 5_460_000, 381_000, 5_462_000)
    t = P.tiles_in(bb)
    assert len(t) == 6 and t[0] == (378, 5460) and t[-1] == (380, 5461)
    g = box(378_100, 5_460_100, 378_700, 5_460_700)
    assert P.tiles_touching(g, bb, margin=0) == [(378, 5460)]
    # 400 m buffer: the round corner (424 m from the diagonal tile's corner) misses (379, 5461)
    assert P.tiles_touching(g, bb, margin=400) == [(378, 5460), (379, 5460), (378, 5461)]
    assert P.tiles_touching(g, bb, margin=500) == [(378, 5460), (379, 5460), (378, 5461), (379, 5461)]


def test_set_section_bbox_rewrites_only_that_table():
    text = ('[defaults]\nbuffer_m = 200\n\n[overall]\nname = "x"\nbbox = [1, 2, 3, 4]\n\n'
            '[orte]\nname = "Orte im Vergleich (stats only)"\nbbox = [0, 0, 1000, 1000]\nphase = "stats"\n'
            'stats_only = true\n\n[[defaults.pointclouds]]\nid = "a"\nbbox = [9, 9, 9, 9]\n')
    out = P.set_section_bbox(text, "orte", (377000, 5450000, 391000, 5472000), "note")
    cfg = tomllib.loads(out)
    assert cfg["orte"]["bbox"] == [377000, 5450000, 391000, 5472000]
    assert cfg["orte"]["stats_only"] is True and cfg["orte"]["phase"] == "stats"
    assert cfg["overall"]["bbox"] == [1, 2, 3, 4] and cfg["defaults"]["pointclouds"][0]["bbox"] == [9, 9, 9, 9]
    with pytest.raises(ValueError):
        P.set_section_bbox(text, "missing", (0, 0, 1, 1))


def test_aois_toml_orte_section_loads():
    cfg = tomllib.loads(AOIS_TOML.read_text())
    assert cfg["orte"]["stats_only"] is True and cfg["orte"]["phase"] == "stats"
    a = load_aoi("orte")  # still a valid AOI for the shared loader (km grid, multiple of chunk_size)
    assert a.width % 1000 == 0 and a.height % 1000 == 0 and a.e0 % 1000 == 0 and a.n0 % 1000 == 0
    for k, v in cfg.items():  # every other AOI is unchanged in shape
        if k not in ("defaults", "orte"):
            assert "stats_only" not in v


# --- attributes ------------------------------------------------------------------------------------

def test_parse_tntxt():
    assert P.parse_tntxt("Wohnbaufläche;741|Landwirtschaft / Ackerland;421") == [
        ("Wohnbaufläche", 741), ("Landwirtschaft / Ackerland", 421)]
    assert P.parse_tntxt("Gehölz;940") == [("Gehölz", 940)]
    assert P.parse_tntxt("Weg;10|Weg;5.5|kaputt|Wald;0|Heide;x") == [("Weg", 15.5)]
    assert P.parse_tntxt(None) == [] and P.parse_tntxt("null") == []


def test_census_and_resolve_keys():
    feats = [{"properties": {"GEMARKUNG": n, "GEMASCHL": k}} for n, k in
             [("Zweibrücken", "075101")] * 3 + [("Mörsbach", "075110")] * 2 + [("Ixheim", "075103")]]
    c = P.gemarkung_census(feats)
    assert c == [{"name": "Zweibrücken", "key": "075101", "parcels": 3},
                 {"name": "Ixheim", "key": "075103", "parcels": 1},
                 {"name": "Mörsbach", "key": "075110", "parcels": 2}]
    zw = next(p for p in P.PLACES if p.id == "zweibruecken")
    assert P.resolve_keys(zw, c) == [{"name": "Zweibrücken", "key": "075101", "parcels": 3}]
    with pytest.raises(RuntimeError):
        P.resolve_keys(zw, c[1:])


def test_parcel_feature_is_slim():
    f = {"type": "Feature", "geometry": box(0, 0, 10.004, 10).__geo_interface__,
         "properties": {"FLSTKENNZ": "102100001000010000__", "GEMARKUNG": "Kirrberg", "GEMASCHL": "102100",
                        "FLAECHE": 100.0, "TNTXT": "Wohnbaufläche;100", "LAGEBEZTXT": "Hauptstraße 1"}}
    out = P.parcel_feature(f, "kirrberg", "SL")
    assert out["properties"] == {"flstkennz": "102100001000010000__", "gemarkung": "Kirrberg", "gemaschl": "102100",
                                 "place": "kirrberg", "state": "SL", "flaeche_m2": 100,
                                 "nutzung": [["Wohnbaufläche", 100]]}
    assert out["geometry"]["type"] == "Polygon" and [10.0, 0.0] in out["geometry"]["coordinates"][0]
    assert P.parcel_feature({"geometry": None, "properties": {}}, "x", "SL") is None


# --- filtered WFS requests -------------------------------------------------------------------------

def _params(url):
    return dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))


def test_filter_url_rlp_namespaced_lowercase():
    u = P.filter_url(P.SERVICES["RLP"], "Flurstueck", "GEMASCHL", "075110", start=10000, count=500,
                     properties=("GEMARKUNG", "GEMASCHL"))
    q = _params(u)
    assert u.startswith("https://www.geoportal.rlp.de/registry/wfs/519?")
    assert q["TYPENAMES"] == "ave:Flurstueck" and "BBOX" not in q and q["SRSNAME"] == "urn:ogc:def:crs:EPSG::25832"
    assert "<fes:ValueReference>ave:gemaschl</fes:ValueReference><fes:Literal>075110</fes:Literal>" in q["FILTER"]
    assert 'xmlns:ave="http://repository.gdi-de.org/schemas/adv/produkt/alkis-vereinfacht/2.0"' in q["FILTER"]
    assert q["STARTINDEX"] == "10000" and q["COUNT"] == "500" and "OUTPUTFORMAT" not in q
    assert q["PROPERTYNAME"] == "ave:gemarkung,ave:gemaschl"


def test_filter_url_sl_hits_and_escaping():
    q = _params(P.filter_url(P.SERVICES["SL"], "Flurstueck", "GEMARKUNG", "A&B<C>", hits=True))
    assert q["RESULTTYPE"] == "hits" and "COUNT" not in q and "OUTPUTFORMAT" not in q
    assert "<fes:ValueReference>GEMARKUNG</fes:ValueReference><fes:Literal>A&amp;B&lt;C&gt;</fes:Literal>" in q["FILTER"]
    q = _params(P.filter_url(P.SERVICES["SL"], "Flurstueck", "GEMASCHL", "102100"))
    assert q["OUTPUTFORMAT"] == "GEOJSON" and q["TYPENAMES"] == "ALKIS_ALKIS_WFS_ohne_Eig:Flurstueck"


def _page(n, start=0):
    return json.dumps({"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": None, "properties": {"FLSTKENNZ": str(start + i)}} for i in range(n)]}).encode()


def test_fetch_pages_pages_and_caches(tmp_path):
    calls = []

    def get(url):
        calls.append(url)
        if "hits" in url:
            return b'<wfs:FeatureCollection numberMatched="5" numberReturned="0"/>'
        start = int(url.split("start=")[1].split("&")[0])
        return _page(min(2, 5 - start), start)

    mk = lambda start=0, count=2, hits=False: "hits" if hits else f"x?start={start}&count={count}"  # noqa: E731
    feats = P.fetch_pages(mk, tmp_path / "c", get=get, parse=P.parse_page, suffix=".geojson", page_size=2)
    assert [f["properties"]["FLSTKENNZ"] for f in feats] == ["0", "1", "2", "3", "4"]
    assert len(calls) == 4  # hits + 3 pages
    again = P.fetch_pages(mk, tmp_path / "c", get=lambda u: pytest.fail("cache miss"), parse=P.parse_page,
                          suffix=".geojson", page_size=2)
    assert len(again) == 5


def test_fetch_pages_detects_short_total(tmp_path):
    def get(url):
        return b'numberMatched="3"' if "hits" in url else _page(1)

    mk = lambda start=0, count=2, hits=False: "hits" if hits else f"x?start={start}"  # noqa: E731
    with pytest.raises(RuntimeError):
        P.fetch_pages(mk, tmp_path / "c", get=get, parse=P.parse_page, suffix=".geojson", page_size=2)


def test_dedupe_parcels():
    fs = [{"properties": {"FLSTKENNZ": "a"}}, {"properties": {"FLSTKENNZ": "a"}}, {"properties": {}},
          {"properties": {}}, {"properties": {"FLSTKENNZ": "b"}}]
    assert len(P.dedupe_parcels(fs)) == 4


# --- SL INSPIRE fallback ---------------------------------------------------------------------------

def test_split_prefixes_descends_only_where_needed():
    counts = {"102100": 25, "1021000": 9, "1021001": 12, "10210010": 6, "10210011": 6, "1021002": 4}

    def count_of(p):
        return counts.get(p, 0)

    assert P.split_prefixes("102100", count_of, limit=10) == ["1021000", "10210010", "10210011", "1021002"]
    assert P.split_prefixes("102100", count_of, limit=30) == ["102100"]
    assert P.split_prefixes("999999", count_of, limit=10) == []
    with pytest.raises(RuntimeError):
        P.split_prefixes("102100", lambda p: 99, limit=10, max_len=7)


def test_inspire_filters():
    f = P.inspire_like("nationalCadastralReference", "102100")
    assert "<fes:ValueReference>cp:nationalCadastralReference</fes:ValueReference><fes:Literal>102100*</fes:Literal>" in f
    with pytest.raises(ValueError):
        P.inspire_like("x", "10*")
    z = P.inspire_gemarkung_filter((49.28, 7.32, 49.35, 7.40))
    assert "<gml:lowerCorner>49.280000 7.320000</gml:lowerCorner>" in z and "<fes:Literal>......</fes:Literal>" in z
    q = _params(P.inspire_url("CadastralParcel", f, hits=True))
    assert q["TYPENAMES"] == "cp:CadastralParcel" and q["RESULTTYPE"] == "hits" and "COUNT" not in q
    assert q["NAMESPACES"] == "xmlns(cp,http://inspire.ec.europa.eu/schemas/cp/4.0)"


_INSPIRE_GML = b"""<?xml version='1.0' encoding='UTF-8'?>
<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:gml="http://www.opengis.net/gml/3.2"
  numberMatched="unknown" numberReturned="0">
  <wfs:member>
    <cp:CadastralParcel xmlns:cp="http://inspire.ec.europa.eu/schemas/cp/4.0" gml:id="p1">
      <cp:areaValue uom="m2">410</cp:areaValue>
      <cp:geometry><gml:Polygon gml:id="g1" srsName="urn:ogc:def:crs:EPSG::4258"><gml:exterior><gml:LinearRing>
        <gml:posList srsDimension="2">49.0 7.0 49.0 7.001 49.001 7.001 49.001 7.0 49.0 7.0</gml:posList>
      </gml:LinearRing></gml:exterior></gml:Polygon></cp:geometry>
      <cp:label>987/2</cp:label>
      <cp:nationalCadastralReference>102100004009870002__</cp:nationalCadastralReference>
    </cp:CadastralParcel>
  </wfs:member>
  <wfs:member>
    <cp:CadastralZoning xmlns:cp="http://inspire.ec.europa.eu/schemas/cp/4.0" gml:id="z1">
      <cp:geometry><gml:Polygon gml:id="g2" srsName="urn:ogc:def:crs:EPSG::4258"><gml:exterior><gml:LinearRing>
        <gml:posList srsDimension="2">49.0 7.0 49.0 7.001 49.001 7.001 49.0 7.0</gml:posList>
      </gml:LinearRing></gml:exterior></gml:Polygon></cp:geometry>
      <cp:levelName><gmd:LocalisedCharacterString xmlns:gmd="http://www.isotc211.org/2005/gmd">Gemarkung</gmd:LocalisedCharacterString></cp:levelName>
      <cp:name><gn:GeographicalName xmlns:gn="http://inspire.ec.europa.eu/schemas/gn/4.0"><gn:spelling><gn:SpellingOfName>
        <gn:text>Kirrberg</gn:text></gn:SpellingOfName></gn:spelling></gn:GeographicalName></cp:name>
      <cp:nationalCadastalZoningReference>102100</cp:nationalCadastalZoningReference>
    </cp:CadastralZoning>
  </wfs:member>
</wfs:FeatureCollection>"""


def test_parse_inspire_parcels_and_zonings_reproject_latlon():
    parcels = P.parse_inspire_parcels(_INSPIRE_GML)
    assert len(parcels) == 1
    pr = parcels[0]["properties"]
    assert pr == {"FLSTKENNZ": "102100004009870002__", "GEMASCHL": "102100", "FLAECHE": "410", "LABEL": "987/2"}
    ring = parcels[0]["geometry"]["coordinates"][0][0]
    # 49°N 7°E is in zone 32 (E ≈ 353 km, N ≈ 5.43 Mm); lat/lon axis order must not be swapped
    assert 353_000 < ring[0][0] < 354_000 and 5_429_000 < ring[0][1] < 5_431_000
    assert ring[1][0] - ring[0][0] == pytest.approx(73, abs=1)    # +0.001° lon ≈ 73 m east
    assert ring[3][1] - ring[0][1] == pytest.approx(111, abs=1)   # +0.001° lat ≈ 111 m north
    z = P.parse_inspire_zonings(_INSPIRE_GML)
    assert z[0]["properties"] == {"REF": "102100", "NAME": "Kirrberg", "LEVEL": "Gemarkung"}
    with pytest.raises(ValueError):
        P.parse_inspire_parcels(b"<ExceptionReport/>")


def test_inspire_rejects_other_crs():
    with pytest.raises(ValueError):
        P.parse_inspire_parcels(_INSPIRE_GML.replace(b"EPSG::4258", b"EPSG::4326"))


def test_is_service_down():
    import urllib.error
    assert P.is_service_down(urllib.error.HTTPError("u", 503, "x", {}, None))
    assert P.is_service_down(urllib.error.URLError("dns"))
    assert P.is_service_down(TimeoutError())
    assert not P.is_service_down(urllib.error.HTTPError("u", 400, "x", {}, None))
    assert not P.is_service_down(ValueError())


def test_clip_landuse_splits_and_drops():
    outline = box(0, 0, 100, 100)
    feats = [
        {"geometry": box(10, 10, 20, 20).__geo_interface__, "properties": {"OID": "in", "NUTZART": "Wald"}},
        {"geometry": box(90, 0, 110, 10).__geo_interface__, "properties": {"OID": "half", "NUTZART": "Weg"}},
        {"geometry": box(200, 200, 210, 210).__geo_interface__, "properties": {"OID": "out"}},
        {"geometry": box(100, 0, 110, 10).__geo_interface__, "properties": {"OID": "touch"}},  # edge only
        {"geometry": None, "properties": {"OID": "none"}},
    ]
    out = P.clip_landuse(feats, outline, "kirrberg")
    assert [(f["properties"]["oid"], f["properties"]["area_m2"]) for f in out] == [("in", 100), ("half", 100)]
    assert out[1]["properties"]["place"] == "kirrberg" and out[0]["properties"]["nutzart"] == "Wald"
    assert max(x for x, _ in out[1]["geometry"]["coordinates"][0]) == 100


# --- land-use summary (Q9) ---------------------------------------------------------------------------

def test_landuse_group_mapping_sl_and_rlp_class_texts():
    cases = {"Laubholz": "forest", "Wald / Laubholz": "forest", "Laub- und Nadelholz": "forest", "Gehölz": "forest",
             "Ackerland": "agriculture", "Landwirtschaft / Ackerland": "agriculture", "Grünland": "agriculture",
             "Streuobstwiese": "agriculture", "Garten": "garden_green", "Park": "garden_green",
             "Friedhof": "garden_green", "Spielplatz, Bolzplatz": "garden_green", "Parkplatz": "traffic",
             "Parken": "traffic", "Straßenverkehr": "traffic", "Platz": "traffic", "Wohnbaufläche": "settlement",
             "Industrie und Gewerbe": "settlement", "Campingplatz": "settlement", "Eis-, Rollschuhbahn": "settlement",
             "Bach": "water", "Gewässer / Stehendes Gewässer": "water", "Modellfluggelände": "other",
             "Naturnahe Fläche": "other", "Völlig Neues": "unmapped"}
    for cls, group in cases.items():
        assert P.landuse_group(cls) == group, cls


def test_nutzung_summary_shares_and_pending():
    props = {"id": "x", "name_de": "X", "state": "RLP", "parcel_source": "wfs519", "area_official_ha": 10.0,
             "nutzung_m2": {"Laubholz": 40000.0, "Ackerland": 30000.0, "Wohnbaufläche": 20000.0, "Garten": 5000.0,
                            "Unbekannt": 5000.0}}
    s = P.nutzung_summary(props)
    assert s["status"] == "ok" and s["landuse_total_ha"] == 10.0
    assert s["share_pct"]["forest"] == 40.0 and s["share_pct"]["agriculture"] == 30.0
    assert s["share_pct"]["settlement"] == 20.0 and s["share_pct"]["garden_green"] == 5.0
    assert s["unmapped_ha"] == {"Unbekannt": 0.5}
    pend = P.nutzung_summary({"id": "y", "name_de": "Y", "state": "SL", "parcel_source": "inspire-cp",
                              "nutzung_m2": {}})
    assert pend["status"] == "pending" and pend["share_pct"] is None and "414" in pend["note"]
