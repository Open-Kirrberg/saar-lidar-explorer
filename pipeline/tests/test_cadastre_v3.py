"""Unit tests for the v3 place output of cadastre.py (contract "Vectors in v3", rule 6): `lines: 'derived'`,
whole polygons of parcels touching present tiles, label points only inside present tiles. No network."""
from __future__ import annotations

import json
import sys
import tomllib
import urllib.parse
from pathlib import Path

import pytest
from shapely.geometry import MultiPoint, box, shape

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cadastre  # noqa: E402
import common  # noqa: E402
from common import AOI, load_aoi  # noqa: E402


def parcel(geom, kennz, zae, nen=None, **extra):
    props = {"OID": "o" + kennz, "FLSTKENNZ": kennz, "FLSTNRZAE": zae, "FLSTNRNEN": nen or "null",
             "GEMARKUNG": "Limbach", "FLUR": "Flur 3", **extra}
    return {"type": "Feature", "geometry": geom.__geo_interface__, "properties": props}


def punkt(kennz, *pts):
    return {"type": "Feature", "geometry": MultiPoint(pts).__geo_interface__,
            "properties": {"OID": "p" + kennz, "FLSTKENNZ": kennz}}


A = frozenset({(0, 0), (1, 0), (1, 1)})   # place A (L-shape)
B = frozenset({(0, 1)})                  # neighbour B (the fourth tile of the 2 x 2 block)

PARCELS = [
    parcel(box(100, 100, 300, 300), "k1", "1"),                     # inside A
    parcel(box(900, 400, 1100, 600), "k2", "2", "1"),              # straddles two A tiles
    parcel(box(500, 800, 700, 1300), "k3", "3"),                   # straddles A/B, Punkt in B
    parcel(box(400, 1700, 600, 1900), "k4", "4"),                  # inside B only
    parcel(box(2500, 2500, 2600, 2600), "k5", "5"),                # in neither place
    parcel(box(0, 950, 100, 1050), "k6", "6"),                     # straddles A/B, no Punkt
    parcel(box(10, 10, 20, 20), "k7", None),                       # no Flurnummer
]
PUNKTE = [punkt("k1", (200.004, 199.996)), punkt("k3", (600, 1200)), punkt("k4", (5000, 5000))]


def test_in_tiles_half_open():
    assert cadastre.in_tiles(999.99, 0, {(0, 0)}) and not cadastre.in_tiles(1000.0, 0, {(0, 0)})
    assert cadastre.in_tiles(1000.0, 1000.0, {(1, 1)}) and cadastre.in_tiles(-0.01, 5, {(-1, 0)})


def test_canonical_label_point_prefers_punkt_inside_parcel():
    g = box(0, 0, 10, 10)
    pt, how = cadastre.canonical_label_point(g, MultiPoint([(50, 50), (3.004, 4.006)]))
    assert how == "punkt" and (pt.x, pt.y) == (3.0, 4.01)
    pt, how = cadastre.canonical_label_point(g, MultiPoint([(50, 50)]))
    assert how == "representative" and g.covers(pt)
    assert cadastre.canonical_label_point(None, None) == (None, "none")


def test_label_tested_after_rounding():
    # the Punkt rounds onto the tile edge E = 1000 -> belongs to tile 1, not tile 0
    ps = [parcel(box(990, 10, 1010, 20), "e", "9")]
    pk = [punkt("e", (999.996, 15))]
    assert cadastre.build_labels_v3(ps, pk, {(0, 0)})[0]["features"] == []
    (f,) = cadastre.build_labels_v3(ps, pk, {(1, 0)})[0]["features"]
    assert f["geometry"]["coordinates"] == [1000.0, 15.0]


def test_labels_only_in_present_tiles_and_never_in_two_places():
    la, sa = cadastre.build_labels_v3(PARCELS, PUNKTE, A)
    lb, sb = cadastre.build_labels_v3(PARCELS, PUNKTE, B)
    ka = {f["properties"]["flstkennz"] for f in la["features"]}
    kb = {f["properties"]["flstkennz"] for f in lb["features"]}
    # k6 has no Punkt: its representative point (mid scan line y = 1000) lies in B
    assert ka == {"k1", "k2"} and kb == {"k3", "k4", "k6"}
    assert not ka & kb and ka | kb == {"k1", "k2", "k3", "k4", "k6"}   # every labelled parcel exactly once
    assert sa["label_no_number"] == 1 and sa["label_punkt"] == 1
    for fc, tiles in ((la, A), (lb, B)):
        for f in fc["features"]:
            x, y = f["geometry"]["coordinates"]  # 2D, no baked z
            assert cadastre.in_tiles(x, y, tiles) and round(x, 2) == x and round(y, 2) == y
            assert set(f["properties"]) <= {"text", "flstkennz", "gemarkung", "flur", "lage"}
    k1 = next(f for f in la["features"] if f["properties"]["flstkennz"] == "k1")
    assert k1["geometry"]["coordinates"] == [200.0, 200.0]
    assert sb["label_representative"] == 2 and sb["label_punkt"] == 1  # k4 (Punkt outside the parcel), k6


def test_build_outputs_v3_polygons_whole_and_labels_subset():
    labels, polys, stats = cadastre.build_outputs_v3(PARCELS, PUNKTE, A)
    kp = {f["properties"]["flstkennz"]: f for f in polys["features"]}
    assert set(kp) == {"k1", "k2", "k3", "k6"}            # k4/k5 do not touch A, k7 has no number
    assert shape(kp["k3"]["geometry"]).equals(box(500, 800, 700, 1300))  # not clipped
    assert "k3" not in {f["properties"]["flstkennz"] for f in labels["features"]}  # its label belongs to B
    assert {f["properties"]["flstkennz"] for f in labels["features"]} <= set(kp)
    assert stats["polygons"] == 4


def test_manifest_entry_v3_lines_derived():
    e = cadastre.manifest_entry(featureCount=4, source="ALKIS", v3=True)
    assert e == {"labels": "vectors/flurstuecke_labels.geojson", "polygons": "vectors/flurstuecke_polygons.geojson",
                 "lines": "derived", "crs": "EPSG:25832", "featureCount": 4, "label_de": "Flurstücke",
                 "source": "ALKIS"}
    old = cadastre.manifest_entry(featureCount=4, source="ALKIS", v3=False)
    assert old["path"] == "vectors/flurstuecke.geojson" and old["heights"] == "baked" and "lines" not in old


def _fake_wfs(sl_parcels, sl_punkte):
    def get(url: str) -> bytes:
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        rlp = url.startswith(cadastre.RLP_WFS_URL)
        feats = [] if rlp else (sl_punkte if q["TYPENAMES"][0].endswith("FlurstueckPunkt") else sl_parcels)
        if q.get("RESULTTYPE") == ["hits"]:
            return f'<wfs:FeatureCollection numberMatched="{len(feats)}"/>'.encode()
        if rlp:
            return (b'<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" numberMatched="0"/>')
        return json.dumps({"type": "FeatureCollection", "features": feats}).encode()
    return get


def test_main_v3_end_to_end(tmp_path, monkeypatch):
    """main() for a v3 place: no lines file (stale one removed), labels + polygons, manifest merged."""
    monkeypatch.setattr(common, "APP_DATA", tmp_path / "app")
    monkeypatch.setattr(cadastre, "CADASTRE_RAW", tmp_path / "raw")
    monkeypatch.setattr(cadastre, "http_get", _fake_wfs(PARCELS, PUNKTE))
    aoi = AOI("fx-a", "A", 0, 0, 2000, 2000, 200, "Saarpfalz", 500, fmt=3, place="a", ags="10000000",
              owned=A, out="fx/a")
    monkeypatch.setattr(cadastre, "load_aoi", lambda key: aoi)
    d = aoi.data_dir
    (d / "vectors").mkdir(parents=True)
    (d / "vectors" / "flurstuecke.geojson").write_text("{}")
    (d / "manifest.json").write_text(json.dumps({
        "version": 3, "origin": {"E0": 0, "N0": 0}, "attribution": "x; " + cadastre.ATTRIBUTION_ALKIS_RLP,
        "vectors": {"osm": {"path": "vectors/osm.geojson"},
                    "flurstuecke": {"path": "vectors/flurstuecke.geojson", "heights": "baked"}}}))
    cadastre.main("fx-a")
    m = json.loads((d / "manifest.json").read_text())
    assert m["vectors"]["osm"] == {"path": "vectors/osm.geojson"}          # other keys kept
    e = m["vectors"]["flurstuecke"]
    assert e["lines"] == "derived" and "path" not in e and "heights" not in e and e["featureCount"] == 4
    assert not (d / "vectors" / "flurstuecke.geojson").exists()
    assert m["attribution"].split("; ") == ["x", cadastre.ATTRIBUTION_ALKIS_SL]  # no RLP parcel used
    polys = json.loads((d / e["polygons"]).read_text())
    labels = json.loads((d / e["labels"]).read_text())
    assert len(polys["features"]) == 4 and {f["properties"]["flstkennz"] for f in labels["features"]} == {"k1", "k2"}


# --- generated output of v3 places (skipped until `./run.sh <place> cadastre` has run) ----------------

_CFG = tomllib.loads((Path(__file__).resolve().parents[1] / "aois.toml").read_text())


def _v3_places_with_parcels():
    out = []
    for k, v in _CFG.items():
        if not (isinstance(v, dict) and "place" in v):
            continue
        try:
            a = load_aoi(k)
        except SystemExit:
            continue
        mf = a.data_dir / "manifest.json"
        if mf.exists() and "flurstuecke" in (json.loads(mf.read_text()).get("vectors") or {}):
            out.append(k)
    return out


@pytest.mark.parametrize("key", _v3_places_with_parcels())
def test_generated_v3_flurstuecke(key):
    a = load_aoi(key)
    m = json.loads((a.data_dir / "manifest.json").read_text())
    e = m["vectors"]["flurstuecke"]
    assert e["lines"] == "derived" and "path" not in e and isinstance(e["polygons"], str)
    assert not (a.data_dir / "vectors" / "flurstuecke.geojson").exists()
    labels = json.loads((a.data_dir / e["labels"]).read_text())["features"]
    polys = json.loads((a.data_dir / e["polygons"]).read_text())["features"]
    assert len(polys) == e["featureCount"] > 0
    for f in labels:
        x, y = f["geometry"]["coordinates"]
        assert cadastre.in_tiles(x, y, a.owned)
    assert {f["properties"]["flstkennz"] for f in labels} <= {f["properties"]["flstkennz"] for f in polys}
