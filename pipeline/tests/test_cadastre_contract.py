"""Contract checks of generated vectors/flurstuecke*.geojson (docs/data-contract.md, "Vectors").

Skipped for AOIs where cadastre.py has not run."""
from __future__ import annotations

import json
import math
import sys
import tomllib
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cadastre import ATTRIBUTION_ALKIS_SL  # noqa: E402
from common import APP_DATA, load_aoi  # noqa: E402

_KNOWN = [k for k in tomllib.loads((Path(__file__).resolve().parents[1] / "aois.toml").read_text()) if k != "defaults"]


def _with_parcels():
    out = []
    for k in _KNOWN:
        mf = APP_DATA / k / "manifest.json"
        if mf.exists() and "flurstuecke" in (json.loads(mf.read_text()).get("vectors") or {}):
            out.append(k)
    return out


AOIS = _with_parcels()
pytestmark = pytest.mark.skipif(not AOIS, reason="no AOI with vectors.flurstuecke")


@pytest.mark.parametrize("aoi", AOIS)
def test_flurstuecke_manifest_and_files(aoi):
    a = load_aoi(aoi)
    m = json.loads((APP_DATA / aoi / "manifest.json").read_text())
    entry = m["vectors"]["flurstuecke"]
    if entry.get("lines") == "derived":
        pytest.skip("v3 place output (lines: 'derived') – checked in test_cadastre_v3.py")
    assert entry["crs"] == "EPSG:25832" and isinstance(entry["path"], str) and isinstance(entry["labels"], str)
    assert ATTRIBUTION_ALKIS_SL in m["attribution"].split("; ")

    lines = json.loads((APP_DATA / aoi / entry["path"]).read_text())
    assert lines["type"] == "FeatureCollection" and len(lines["features"]) == entry["featureCount"] > 0
    for f in lines["features"]:
        assert f["properties"] == {"kind": "parcel"} and f["geometry"]["type"] == "LineString"
        c = f["geometry"]["coordinates"]
        assert len(c) >= 2
        baked = entry.get("heights") == "baked"
        for x, y, *z in c:
            assert len(z) == (1 if baked else 0)
            assert a.e0 <= x <= a.e1 and a.n0 <= y <= a.n1  # EPSG:25832, clipped, not local frame
            assert round(x, 2) == x and round(y, 2) == y
        assert max(math.dist(p[:2], q[:2]) for p, q in zip(c, c[1:])) <= 2.0 + 1e-9  # horizontal

    labels = json.loads((APP_DATA / aoi / entry["labels"]).read_text())
    assert labels["features"]
    for f in labels["features"]:
        p = f["properties"]
        assert f["geometry"]["type"] == "Point"
        x, y, *z = f["geometry"]["coordinates"]
        assert len(z) == (1 if entry.get("heights") == "baked" else 0)
        assert a.e0 <= x <= a.e1 and a.n0 <= y <= a.n1
        assert p["text"] and p["text"] != "null" and "null" not in p["text"].split("/")
        assert isinstance(p["flstkennz"], str) and isinstance(p["gemarkung"], str) and isinstance(p["flur"], str)
        assert p.get("lage", "x") not in ("", "null")


@pytest.mark.parametrize("aoi", AOIS)
def test_flurstuecke_polygons(aoi):
    from shapely.geometry import box, shape
    a = load_aoi(aoi)
    entry = json.loads((APP_DATA / aoi / "manifest.json").read_text())["vectors"]["flurstuecke"]
    if "polygons" not in entry:
        pytest.skip("no polygons file (pre-POLISH manifest)")
    fc = json.loads((APP_DATA / aoi / entry["polygons"]).read_text())
    assert fc["type"] == "FeatureCollection" and fc["features"]
    labels = {f["properties"]["flstkennz"]: f["properties"]
              for f in json.loads((APP_DATA / aoi / entry["labels"]).read_text())["features"]}
    aoi_box = box(a.e0, a.n0, a.e1, a.n1)
    seen = set()
    for f in fc["features"]:
        p, g = f["properties"], f["geometry"]
        assert g["type"] in ("Polygon", "MultiPolygon")
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for rings in polys:
            for ring in rings:
                assert len(ring) >= 4 and ring[0] == ring[-1]
                for pt in ring:
                    assert len(pt) == 2 and round(pt[0], 2) == pt[0] and round(pt[1], 2) == pt[1]
        assert shape(g).intersects(aoi_box)
        assert p["flstkennz"] not in seen
        seen.add(p["flstkennz"])
        assert p["text"] == (f"{p['zae']}/{p['nen']}" if "nen" in p else p["zae"])
        assert "flaeche_m2" not in p or (isinstance(p["flaeche_m2"], (int, float)) and p["flaeche_m2"] > 0)
        lab = labels.get(p["flstkennz"])
        if lab is not None:
            assert (lab["text"], lab["gemarkung"], lab["flur"], lab.get("lage")) == \
                   (p["text"], p["gemarkung"], p["flur"], p.get("lage"))
    assert set(labels) <= seen  # every labelled parcel has a polygon
