"""roofs.py (Orte im Vergleich ☀️): roof plane geometry, suitability rules, aggregation and municipality view on
synthetic roof planes (no LoD2 files needed)."""
import math
import sys
from pathlib import Path

import numpy as np
import pytest
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import roofs as R  # noqa: E402


def gable_half(width: float, depth: float, tilt_deg: float, facing: str, x0=0.0, y0=0.0) -> np.ndarray:
    """Rectangular roof half sloping down towards `facing` (N/E/S/W); horizontal extent width × depth."""
    rise = depth * math.tan(math.radians(tilt_deg))
    # build facing south (eave at y0, ridge at y0 + depth), then rotate
    pts = np.array([[0, 0, 0], [width, 0, 0], [width, depth, rise], [0, depth, rise], [0, 0, 0]], float)
    rot = {"S": 0, "W": -90, "E": 90, "N": 180, "SE": 45, "SW": -45, "NE": 135, "NW": -135}[facing]   # CCW (maths)
    a = math.radians(rot)
    c, s = math.cos(a), math.sin(a)
    xy = pts[:, :2] @ np.array([[c, s], [-s, c]])
    return np.c_[xy[:, 0] + x0, xy[:, 1] + y0, pts[:, 2] + 100.0]


@pytest.mark.parametrize("facing,az", [("S", 180), ("N", 0), ("E", 90), ("W", 270), ("SE", 135), ("SW", 225)])
def test_plane_tilt_azimuth_area(facing, az):
    ring = gable_half(10, 6, 35, facing)
    p = R.plane_from_polygons([[ring]])
    assert p.tilt == pytest.approx(35, abs=1e-6)
    assert p.azimuth == pytest.approx(az, abs=1e-6)
    assert p.area == pytest.approx(10 * 6 / math.cos(math.radians(35)), rel=1e-9)   # inclined area
    rev = R.plane_from_polygons([[ring[::-1]]])                                       # ring order is irrelevant
    assert rev.azimuth == pytest.approx(az, abs=1e-6) and rev.area == pytest.approx(p.area)


def test_flat_roof_and_holes():
    ring = np.array([[0, 0, 5], [20, 0, 5], [20, 10, 5], [0, 10, 5], [0, 0, 5]], float)
    hole = np.array([[2, 2, 5], [4, 2, 5], [4, 4, 5], [2, 4, 5]], float)
    p = R.plane_from_polygons([[ring, hole]])
    assert p.tilt == pytest.approx(0) and math.isnan(p.azimuth)
    assert p.area == pytest.approx(200 - 4)
    assert R.orient_class(p) == "flat" and R.suitable(p)
    # two coplanar polygons of one RoofSurface → one plane with the summed area
    two = R.plane_from_polygons([[gable_half(5, 6, 30, "S")], [gable_half(5, 6, 30, "S", x0=5)]])
    assert two.area == pytest.approx(2 * 30 / math.cos(math.radians(30)))
    assert R.plane_from_polygons([[np.zeros((4, 3))]]) is None


def test_suitability_rules():
    P = R.Plane
    assert R.suitable(P(40, 35, 180))                  # south
    assert R.suitable(P(40, 35, 100)) and R.suitable(P(40, 35, 260))   # east / west
    assert not R.suitable(P(40, 35, 0))                # north
    assert not R.suitable(P(40, 35, 45))               # north-east
    assert not R.suitable(P(40, 35, 315))              # north-west
    assert R.suitable(P(40, 5, 0))                     # flat (< 10°): any orientation
    assert not R.suitable(P(40, 65, 180))              # too steep
    assert R.suitable(P(40, 60, 180))                  # 60° still ok
    assert not R.suitable(P(9.9, 30, 180))             # too small
    assert R.orient_class(P(1, 30, 200)) == "S" and R.orient_class(P(1, 30, 150)) == "SE_SW"
    assert R.orient_class(P(1, 30, 280)) == "E_W" and R.orient_class(P(1, 30, 340)) == "N"


def test_building_class():
    assert R.building_class("31001_1000") == "residential"
    assert R.building_class("31001_1100") == "residential"
    assert R.building_class("31001_2463") == "garage" and R.building_class("51009_1611") == "garage"
    assert R.building_class("31001_2000") == "other" and R.building_class(None) == "other"


def _house(i, planes, function="31001_1000", source="sl", x=0.0, y=0.0):
    return R.RoofBuilding(f"b{i}", source, function, planes, x, y)


def test_aggregate_sums_kwp_and_suppresses_small_sets():
    P = R.Plane
    houses = [_house(i, [P(50, 35, 180), P(50, 35, 0)]) for i in range(4)]       # gable N/S: 50 m² suitable each
    houses.append(_house(9, [P(100, 3, float("nan"))], function="31001_2000"))   # flat hall
    a = R.aggregate(houses)
    assert a["buildings"] == 5 and a["buildings_suitable"] == 5
    assert a["roof_area_m2"] == 500 and a["suitable_area_m2"] == 300
    # pitched 200 m² × 0.7 + flat 100 m² × 0.4 (row spacing on flat roofs, review 2026-11-08) = 180 m²
    assert a["usable_area_m2"] == round(200 * R.SETBACK + 100 * R.FLAT_USABLE) == 180
    assert a["kwp"] == [round(180 * d, 1) for d in R.KWP_PER_M2]
    assert a["usable_share_pct"] == 36.0
    assert a["suitable_by_orientation_m2"]["S"] == 200 and a["suitable_by_orientation_m2"]["flat"] == 100
    assert a["by_building_class"]["other"] == {"buildings": 1, "suppressed": True}
    assert a["by_building_class"]["residential"]["buildings"] == 4    # < 5 → suppressed too
    assert a["by_building_class"]["residential"].get("suppressed") is True
    small = R.aggregate(houses[:3])
    assert small["kwp"] is None and "kwp" in small["suppressed"] and small["buildings"] == 3
    lo, mid, hi = a["kwp"]
    assert lo <= mid <= hi


def test_assign_by_state_and_outline():
    out = {"a": ("SL", box(0, 0, 100, 100)), "b": ("RLP", box(100, 0, 200, 100))}
    bl = [_house(1, [], x=50, y=50), _house(2, [], x=150, y=50, source="rlp"),
          _house(3, [], x=160, y=50, source="sl"),      # SL building inside an RLP place → dropped
          _house(4, [], x=500, y=50)]                   # outside every place
    got = R.assign(bl, out)
    assert [b.id for b in got["a"]] == ["b1"] and [b.id for b in got["b"]] == ["b2"]
    anyst = R.assign(bl, out, same_state=False)
    assert sorted(b.id for b in anyst["b"]) == ["b2", "b3"]


def test_used_share_and_municipality_completeness():
    assert R.used_share(1000, [8000, 10000, 12000]) == [8.3, 10.0, 12.5]
    assert R.used_share(1000, [0, 0, 0]) is None
    places = {"x": {"municipality_key": "1", "municipality": "Eins", "state": "RLP"},
              "y": {"municipality_key": "2", "municipality": "Zwei", "state": "RLP"},
              "z": {"municipality_key": "3", "municipality": "Drei", "state": "SL"}}
    pp = {k: {"kwp": [800.0, 1000.0, 1200.0], "suitable_area_m2": 5000} for k in places}
    excluded = [{"name": "Nachbar", "key": "9", "state": "RLP", "municipality_key": "2"},
                {"name": "Irgendwo", "key": "8", "state": "SL", "municipality_key": None}]
    mastr = {"municipalities": [{"ags": a, "by_type": {"Gebäudesolaranlage": {"units": 10, "kwp": 100.0}}}
                                for a in ("1", "2", "3")]}
    m = {r["ags"]: r for r in R.municipalities(places, pp, excluded, mastr)}
    assert m["1"]["complete"] and m["1"]["used_share_pct"] == [8.3, 10.0, 12.5]
    assert not m["2"]["complete"] and m["2"]["used_share_pct"] is None and "Nachbar" in m["2"]["used_share_note"]
    assert not m["3"]["complete"] and m["3"]["used_share_pct"] is None      # SL membership unknown
    assert R.municipalities(places, pp, [], None)[0]["used_share_pct"] is None   # no MaStR


CITYGML = b"""<?xml version="1.0" encoding="UTF-8"?>
<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:bldg="http://www.opengis.net/citygml/building/2.0"
 xmlns:gml="http://www.opengis.net/gml">
 <core:cityObjectMember><bldg:Building gml:id="B1"><bldg:function>31001_1000</bldg:function>
  <bldg:boundedBy><bldg:RoofSurface><bldg:lod2MultiSurface><gml:MultiSurface><gml:surfaceMember><gml:Polygon>
   <gml:exterior><gml:LinearRing><gml:posList srsDimension="3">0 0 10 10 0 10 10 5 13 0 5 13 0 0 10</gml:posList>
   </gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember></gml:MultiSurface></bldg:lod2MultiSurface>
  </bldg:RoofSurface></bldg:boundedBy>
  <bldg:boundedBy><bldg:RoofSurface><bldg:lod2MultiSurface><gml:MultiSurface><gml:surfaceMember><gml:Polygon>
   <gml:exterior><gml:LinearRing><gml:posList srsDimension="3">0 5 13 10 5 13 10 10 10 0 10 10 0 5 13</gml:posList>
   </gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember></gml:MultiSurface></bldg:lod2MultiSurface>
  </bldg:RoofSurface></bldg:boundedBy>
  <bldg:boundedBy><bldg:WallSurface><bldg:lod2MultiSurface><gml:MultiSurface><gml:surfaceMember><gml:Polygon>
   <gml:exterior><gml:LinearRing><gml:posList srsDimension="3">0 0 0 10 0 0 10 0 10 0 0 10 0 0 0</gml:posList>
   </gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember></gml:MultiSurface></bldg:lod2MultiSurface>
  </bldg:WallSurface></bldg:boundedBy>
 </bldg:Building></core:cityObjectMember>
</core:CityModel>"""


def test_parse_citygml_roof_planes(tmp_path):
    f = tmp_path / "t.gml"
    f.write_bytes(CITYGML)
    (b,) = list(R.iter_roof_buildings(f, "sl"))
    assert b.id == "B1" and b.function == "31001_1000" and len(b.planes) == 2      # wall ignored
    az = sorted(round(p.azimuth) for p in b.planes)
    assert az == [0, 180]                                                           # gable: one N, one S half
    tilt = math.degrees(math.atan(3 / 5))
    assert all(p.tilt == pytest.approx(tilt) for p in b.planes)
    assert b.x == pytest.approx(5.0) and b.y == pytest.approx(5.0)
    a = R.aggregate([b] * 5)
    assert a["suitable_area_m2"] == round(5 * 10 * math.hypot(5, 3))                # only the south halves
