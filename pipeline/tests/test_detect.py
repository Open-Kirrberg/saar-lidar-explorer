"""F15 relict candidate detection (detect.py): synthetic DTMs with known features, shape metrics, output contract."""
from __future__ import annotations

import json
import math
import sys
import tomllib
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import APP_DATA, load_aoi  # noqa: E402
import detect as D  # noqa: E402

E0, NTOP = 380000.0, 5465000.0
RNG = np.random.default_rng(42)


def base(h=260, w=260, tilt=0.01, noise=0.03, seed=1):
    """Gently tilted plane + small white noise (1 m cells, row 0 = north)."""
    rng = np.random.default_rng(seed)
    r, c = np.mgrid[0:h, 0:w].astype(np.float64)
    return 300.0 + tilt * c + rng.normal(0, noise, (h, w))


def bowl(z, r0, c0, radius, depth):
    r, c = np.mgrid[0:z.shape[0], 0:z.shape[1]]
    d = np.hypot(r - r0, c - c0) / radius
    z -= depth * np.where(d < 1, np.cos(d * math.pi / 2) ** 2, 0)
    return z


def dome(z, r0, c0, radius, height):
    return bowl(z, r0, c0, radius, -height)


def cell_en(r, c):
    return E0 + c + 0.5, NTOP - r - 0.5


def run(z, **kw):
    params = {**D.PARAMS, **kw}
    return D.detect(z.astype(np.float32), E0, NTOP, D.Context(), [], params)


def nearest(cands, r, c, cls=None):
    E, N = cell_en(r, c)
    cs = [x for x in cands if cls is None or x.cls == cls]
    return min(cs, key=lambda x: math.hypot(x.E - E, x.N - N)) if cs else None


def dist(cand, r, c):
    E, N = cell_en(r, c)
    return math.hypot(cand.E - E, cand.N - N)


# ----------------------------------------------------------------------------- pure helpers
def test_circularity_and_rectangularity_of_ideal_shapes():
    from shapely.geometry import Point, Polygon, box
    from shapely.affinity import rotate
    circle = Point(0, 0).buffer(10, 64)
    assert D.circularity(circle.area, circle.length) > 0.99
    assert D.rectangularity(circle) == pytest.approx(math.pi / 4, abs=0.01)
    sq = rotate(box(0, 0, 20, 10), 30)
    assert D.rectangularity(sq) == pytest.approx(1.0, abs=1e-6)
    assert D.circularity(sq.area, sq.length) == pytest.approx(4 * math.pi * 200 / 60 ** 2, abs=1e-6)
    L, W, ori = D.rect_dims(box(0, 0, 20, 10))   # long axis east–west
    assert (L, W) == pytest.approx((20, 10)) and ori == pytest.approx(90)
    tri = Polygon([(0, 0), (10, 0), (0, 10)])
    assert D.rectangularity(tri) == pytest.approx(0.5, abs=1e-6)


def test_orientation_and_german_numbers():
    assert D.orientation_deg(0, 1) == pytest.approx(0)
    assert D.orientation_deg(1, 0) == pytest.approx(90)
    assert D.orientation_deg(-1, -1) == pytest.approx(45)
    assert D.orientation_deg(1, -1) == pytest.approx(135)
    assert D.de_num(0.75, 2) == "0,75" and D.de_num(12.0, 0) == "12"


def test_ramp_and_trapezoid():
    assert D.ramp(0.3, 0.3, 1.2) == 0 and D.ramp(1.5, 0.3, 1.2) == 1 and D.ramp(0.75, 0.3, 1.2) == pytest.approx(0.5)
    assert D.trapezoid(1, 2, 5, 15, 25) == 0 and D.trapezoid(10, 2, 5, 15, 25) == 1
    assert D.trapezoid(30, 2, 5, 15, 25, 0.3) == pytest.approx(0.3)


def test_hysteresis_keeps_only_seeded_regions():
    a = np.zeros((10, 10))
    a[1:4, 1:4] = 0.2
    a[2, 2] = 0.5          # seeded
    a[6:9, 6:9] = 0.2      # no seed
    m = D.hysteresis(a, 0.15, 0.3)
    assert m[1:4, 1:4].all() and not m[6:9, 6:9].any()


def test_longest_path_through_branching_skeleton():
    sk = np.zeros((20, 30), bool)
    sk[10, 2:28] = True    # 25 m main line
    sk[3:10, 15] = True    # side branch
    p = D.longest_path(sk)
    seg = np.hypot(*np.diff(p, axis=0).T).sum()
    assert seg == pytest.approx(25, abs=0.01)
    assert {tuple(p[0]), tuple(p[-1])} == {(10, 2), (10, 27)}


def test_closed_depth_distinguishes_closed_pit_from_open_slope_hollow():
    z = base(60, 60, tilt=0.0, noise=0)
    z = bowl(z, 30, 30, 5, 1.0)
    sub = np.hypot(*np.mgrid[-6:7, -6:7]) <= 5
    assert D.closed_depth(z, sub, 24, 24) == pytest.approx(1.0, abs=0.05)
    # a dent that opens downhill on a steep slope (drains): no closed depth
    s = base(60, 60, tilt=0.3, noise=0)
    r, c = np.mgrid[0:60, 0:60]
    s -= 0.3 * np.exp(-((r - 30) ** 2 + (c - 30) ** 2) / 8)
    assert D.closed_depth(s, sub, 24, 24) < 0.05


def test_cross_profile_ditch_vs_slope_step():
    r, c = np.mgrid[0:60, 0:60].astype(float)
    ditch = 300 - 0.8 * np.exp(-((c - 30) ** 2) / 4)
    pr, pc = np.arange(5, 55), np.full(50, 30)
    two, step = D.cross_profile(ditch, pr, pc, 3, -1)
    assert two == pytest.approx(0.8, abs=0.1) and step < 0.05
    stepz = 300 + 1.0 / (1 + np.exp(-(c - 30)))   # terrace edge: one side higher
    two, step = D.cross_profile(stepz, pr, pc, 3, -1)
    assert two < 0.1 and step > 0.8


# ----------------------------------------------------------------------------- synthetic detection
def test_flat_noise_yields_nothing():
    z = base(300, 300, tilt=0.02, noise=0.05, seed=7)
    assert run(z) == []
    # long-wavelength natural undulation (±1 m over 150 m) is not a relict either
    r, c = np.mgrid[0:300, 0:300]
    z2 = z + np.sin(r / 25.0) * np.cos(c / 30.0)
    assert [x for x in run(z2) if x.score >= 0.3] == []


def test_synthetic_pit_is_detected_with_metrics():
    z = bowl(base(), 130, 130, 5, 1.0)
    cands = run(z)
    assert len(cands) == 1
    p = cands[0]
    assert p.cls == "pit" and dist(p, 130, 130) <= 1.5
    m = p.metrics
    assert 0.6 <= m["depth_m"] <= 1.05
    assert 0.6 <= m["closed_depth_m"] <= 1.05   # measured on the σ = 1 m smoothed DTM
    assert 5 <= m["diameter_m"] <= 11 and m["circularity"] > 0.85
    assert p.score >= 0.5 and any("tief" in s for s in p.reasons)
    assert p.id == f"pit-{math.floor(round(p.E, 2) + 0.5)}-{math.floor(round(p.N, 2) + 0.5)}"


def test_synthetic_mound_is_detected_with_metrics():
    z = dome(base(), 130, 130, 10, 1.5)
    cands = run(z)
    m = [x for x in cands if x.cls == "mound"]
    assert len(m) == 1 and dist(m[0], 130, 130) <= 1.5
    assert 1.0 <= m[0].metrics["height_m"] <= 1.6
    assert 10 <= m[0].metrics["diameter_m"] <= 22 and m[0].metrics["circularity"] > 0.85
    assert m[0].score >= 0.5
    assert all(x.cls != "pit" or x.score < 0.3 for x in cands)


def test_synthetic_ditch_is_linear_with_orientation_and_length():
    z = base(200, 200, tilt=0.005, noise=0.02)
    r, c = np.mgrid[0:200, 0:200]
    on = (c >= 50) & (c <= 150)
    z -= np.where(on, 0.8 * np.exp(-((r - 100) ** 2) / 6), 0)  # E–W ditch, ≈ 100 m, ≈ 4 m wide
    cands = run(z)
    lin = [x for x in cands if x.cls == "linear"]
    assert len(lin) == 1
    d = lin[0]
    assert d.metrics["length_m"] == pytest.approx(100, abs=8)
    assert d.metrics["orientation_deg"] == pytest.approx(90, abs=3)
    assert d.metrics["depth_m"] >= 0.5 and d.metrics["two_sided_m"] >= 0.5 and d.metrics["width_m"] <= 6
    assert d.metrics["straightness"] > 0.97 and d.score >= 0.6
    assert d.outline.geom_type == "LineString" and dist(d, 100, 100) <= 2
    assert any("Graben" in s for s in d.reasons)


def test_along_path_only_for_lines_running_along_a_way():
    from shapely.geometry import LineString
    z = base(200, 200, tilt=0.005, noise=0.02)
    r, c = np.mgrid[0:200, 0:200]
    z -= np.where((c >= 50) & (c <= 150), 0.8 * np.exp(-((r - 100) ** 2) / 6), 0)  # E–W ditch
    z = z.astype(np.float32)
    (Ew, N), (Ee, _) = cell_en(100, 40), cell_en(100, 160)
    E_mid = cell_en(100, 100)[0]
    along = LineString([(Ew, N + 2), (Ee, N + 2)])
    across = LineString([(E_mid, N - 60), (E_mid, N + 60)])

    def lin(osm):
        cs = [x for x in D.detect(z, E0, NTOP, D.Context(osm=osm), [], D.PARAMS) if x.cls == "linear"]
        assert len(cs) == 1
        return cs[0]

    plain = lin([])
    a = lin([("track", along)])
    assert a.near_path and a.along_path and a.score == pytest.approx(plain.score * D.PENALTIES["near_path"], abs=0.01)
    assert any("entlang" in s for s in a.reasons)
    x = lin([("path", across)])                     # crosses a path: near, not along, not down-weighted
    assert x.near_path and not x.along_path and x.score == pytest.approx(plain.score, abs=0.01)
    w = lin([("barrier", along)])                   # runs along a fence/wall line: near, not a known path
    assert w.near_path and not w.along_path
    assert D.to_feature(a)["properties"]["along_path"] is True and D.to_feature(w)["properties"]["along_path"] is False


def test_synthetic_rectangle_is_rect_class():
    z = base()
    r, c = np.mgrid[0:260, 0:260].astype(float)
    # raised 22 × 12 m foundation platform, 0.8 m high, soft 1 m edges
    inside = (1 / (1 + np.exp(-(r - 124) * 2))) * (1 / (1 + np.exp((r - 136) * 2))) \
        * (1 / (1 + np.exp(-(c - 119) * 2))) * (1 / (1 + np.exp((c - 141) * 2)))
    z += 0.8 * inside
    cands = run(z)
    rect = [x for x in cands if x.cls == "rect"]
    assert len(rect) == 1, [(x.cls, x.score, x.metrics) for x in cands]
    m = rect[0].metrics
    assert m["rectangularity"] >= 0.85
    assert m["length_m"] == pytest.approx(22, abs=3) and m["width_m"] == pytest.approx(12, abs=3)
    assert m["orientation_deg"] == pytest.approx(90, abs=5)   # long axis E–W
    assert dist(rect[0], 130, 130) <= 1.5 and rect[0].score >= 0.5
    assert not [x for x in cands if x.cls in ("mound", "pit") and dist(x, 130, 130) < 8]


def test_synthetic_charcoal_kiln_platform_on_slope():
    z = base(200, 200, tilt=0.0, noise=0.02)
    r, c = np.mgrid[0:200, 0:200].astype(float)
    z = z + 0.36 * (200 - r)        # ≈ 20° slope falling to the south
    d = np.hypot(r - 100, c - 100)
    level = 300 + 0.36 * 100
    w = np.clip((8 - d) / 1.0, 0, 1)  # flat disc Ø ≈ 14–16 m, soft edge
    z = z * (1 - w) + level * w
    pl = [x for x in run(z) if x.cls == "platform"]
    assert len(pl) == 1 and dist(pl[0], 100, 100) <= 2
    assert pl[0].metrics["slope_in_deg"] < 6 and pl[0].metrics["slope_around_deg"] > 12
    assert 7 <= pl[0].metrics["diameter_m"] <= 16 and pl[0].score >= 0.5


def test_rim_ditch_and_uprooted_tree_rules():
    # plain dome: no ring ditch reason (a box-mean LRM would fake one)
    m = [x for x in run(dome(base(), 130, 130, 10, 1.5)) if x.cls == "mound"][0]
    assert not any("Kreisgraben" in s for s in m.reasons)
    # dome with a ring ditch
    r, c = np.mgrid[0:260, 0:260]
    d = np.hypot(r - 130, c - 130)
    z = dome(base(), 130, 130, 10, 1.5) - 0.4 * np.exp(-((d - 12) ** 2) / 2)
    m = [x for x in run(z) if x.cls == "mound"][0]
    assert any("Kreisgraben" in s for s in m.reasons)
    # crater with an ejecta rim all around
    z = bowl(base(), 130, 130, 5, 1.2) + 0.35 * np.exp(-((d - 6.5) ** 2) / 2)
    p = [x for x in run(z) if x.cls == "pit"][0]
    assert p.metrics["rim_m"] > 0.1 and any("Randwall" in s for s in p.reasons)
    # small pit with a one-sided root-plate mound next to it → down-weighted
    z = bowl(base(), 130, 130, 2.5, 0.8)
    plain = [x for x in run(z, min_score=0) if x.cls == "pit"][0]
    z = dome(z, 130, 135, 3.0, 0.8)
    res = run(z, min_score=0)
    tree = [x for x in res if x.cls == "pit"][0]
    assert any("Wurzelteller" in s for s in tree.reasons) and tree.score < plain.score * 0.75
    assert all(any("Wurzelteller" in s for s in x.reasons) for x in res if x.cls == "mound")


def test_edge_padding_keeps_plane_flat():
    z = base(120, 120, tilt=0.3, noise=0)    # steep plane (≈ 17°)
    R = D.compute_rasters(z.astype(np.float32))
    for a in (R.lrm_lin, R.lrm_pit, R.lrm_mound):
        assert np.abs(a).max() < 0.01


def test_building_mask_excludes_and_osm_flags():
    from shapely.geometry import LineString
    z = bowl(base(), 130, 130, 5, 1.0)
    bl = np.zeros(z.shape, np.uint8)
    bl[125:136, 125:136] = 1
    assert D.detect(z.astype(np.float32), E0, NTOP, D.Context(bldg=bl), [], D.PARAMS) == []
    E, N = cell_en(130, 130)
    path = LineString([(E - 50, N + 4), (E + 50, N + 4)])
    c = D.detect(z.astype(np.float32), E0, NTOP, D.Context(osm=[("path", path)]), [("r03-x", E + 20, N)], D.PARAMS)
    assert len(c) == 1 and c[0].near_path and c[0].near_known == "r03-x"
    road = LineString([(E - 50, N), (E + 50, N)])
    assert D.detect(z.astype(np.float32), E0, NTOP, D.Context(osm=[("road", road)]), [], D.PARAMS) == []


def test_forest_flag_uses_chm():
    z = bowl(base(), 130, 130, 5, 1.0)
    chm = np.full(z.shape, 20.0, np.float32)
    c = D.detect(z.astype(np.float32), E0, NTOP, D.Context(chm=chm), [], D.PARAMS)
    assert c[0].forest and "unter Wald" in c[0].reasons
    c = D.detect(z.astype(np.float32), E0, NTOP, D.Context(chm=chm * 0), [], D.PARAMS)
    assert not c[0].forest


def test_ids_collisions_and_sorting():
    cs = [D.Candidate("pit", 0.5, 10.4, 20.4, {}, []), D.Candidate("pit", 0.9, 10.2, 19.6, {}, []),
          D.Candidate("pit", 0.4, 10.0, 20.0, {}, [])]
    cs.sort(key=lambda c: -c.score)
    D.assign_ids(cs)
    assert [c.id for c in cs] == ["pit-10-20", "pit-10-20-2", "pit-10-20-3"]


# ----------------------------------------------------------------------------- output contract
def _check_feature(f, bbox=None, baked=True):
    g, p = f["geometry"], f["properties"]
    assert g["type"] == "Point" and len(g["coordinates"]) == (3 if baked else 2)
    for v in g["coordinates"]:
        assert math.isfinite(v) and math.isclose(v, round(v, 2))
    assert p["class"] in D.CLASSES and 0 <= p["score"] <= 1 and p["score"] == round(p["score"], 2)
    assert isinstance(p["reasons"], list) and p["reasons"] and all(isinstance(s, str) for s in p["reasons"])
    assert isinstance(p["forest"], bool) and isinstance(p["near_path"], bool)
    assert p.get("along_path", False) is False or (p["class"] == "linear" and p["near_path"])
    assert p["near_known"] is None or isinstance(p["near_known"], str)
    E, N = g["coordinates"][:2]
    assert p["id"].startswith(f"{p['class']}-{math.floor(E + 0.5)}-{math.floor(N + 0.5)}")
    for k, v in p["metrics"].items():
        assert math.isfinite(v) and v == round(v, 2), k
    for k in ("depth_m", "height_m"):
        if k in p["metrics"] and p["class"] != "platform":
            assert p["metrics"][k] > 0
    if bbox:
        assert bbox[0] <= E <= bbox[2] and bbox[1] <= N <= bbox[3]
    o = p.get("outline")
    if o:
        line = o["coordinates"][0] if o["type"] == "Polygon" else o["coordinates"]
        assert o["type"] == ("LineString" if p["class"] == "linear" else "Polygon")
        assert all(len(q) == (3 if baked else 2) for q in line)
        segs = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(line, line[1:])]
        assert max(segs) <= 2.0 + 1e-9
        if o["type"] == "Polygon":
            assert line[0] == line[-1] and len(line) >= 4
            area2 = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(line, line[1:]))
            assert area2 > 0, "exterior ring must be counter-clockwise"
        if bbox:
            for q in line:
                assert bbox[0] <= q[0] <= bbox[2] and bbox[1] <= q[1] <= bbox[3]


def test_feature_collection_matches_contract_with_baked_heights():
    z = bowl(base(), 130, 130, 5, 1.0)
    z = dome(z, 60, 60, 9, 1.4)
    r, c = np.mgrid[0:260, 0:260]
    z -= np.where((c >= 40) & (c <= 220), 0.8 * np.exp(-((r - 200) ** 2) / 6), 0)
    cands = run(z.copy())
    assert {x.cls for x in cands} >= {"pit", "mound", "linear"}
    zf = z.astype(np.float32).astype(np.float64)
    fc = D.feature_collection(cands, z_at=lambda e, n: float(D_bilinear(zf, e, n)))
    assert fc["type"] == "FeatureCollection"
    scores = [f["properties"]["score"] for f in fc["features"]]
    assert scores == sorted(scores, reverse=True)
    assert len({f["properties"]["id"] for f in fc["features"]}) == len(scores)
    for f in fc["features"]:
        _check_feature(f, (E0, NTOP - 260, E0 + 260, NTOP))
    # z of the centre point = DTM height at that cell centre (bilinear at an exact centre)
    pit = next(f for f in fc["features"] if f["properties"]["class"] == "pit")
    E, N, zz = pit["geometry"]["coordinates"]
    rr, cc = int(NTOP - N - 0.5), int(E - E0 - 0.5)
    assert zz == pytest.approx(zf[rr, cc], abs=0.006)


def D_bilinear(z, e, n):
    from heights import bilinear
    return bilinear(z, E0, NTOP, e, n)


def test_class_mask_codes_and_priority():
    z = bowl(base(), 130, 130, 5, 1.0)
    z = dome(z, 60, 60, 9, 1.4)
    cands = run(z)
    grid = D.Grid(E0, NTOP, z.shape)
    m = D.class_mask(cands, grid, 0.0)
    assert m.dtype == np.uint8 and set(np.unique(m)) <= {0, 1, 2, 3, 4, 5}
    assert m[130, 130] == D.CLASS_CODE["pit"] and m[60, 60] == D.CLASS_CODE["mound"]
    assert m[5, 250] == 0
    assert not D.class_mask(cands, grid, 1.01).any()


def test_evaluate_recall_and_density():
    cs = [D.Candidate("mound", 0.8, 100.0, 100.0, {}, [], forest=True),
          D.Candidate("pit", 0.4, 500.0, 500.0, {}, [], forest=False)]
    pois = [{"id": "a", "name": "A", "type": "burial_mound", "E": 110.0, "N": 100.0},
            {"id": "b", "name": "B", "type": "bunker", "E": 900.0, "N": 900.0},
            {"id": "c", "name": "C", "type": "boundary_stone", "E": 500.0, "N": 510.0}]
    ev = D.evaluate(cs, pois, D.Grid(0, 1000, (1000, 1000)), forest_km2=0.5, open_km2=0.5)
    assert ev["recall_any"] == "1/2" and ev["recall_expected_class"] == "1/2"
    assert ev["density_per_km2"]["mound"]["forest_per_km2"] == 2.0
    assert ev["density_per_km2"]["pit"]["open_per_km2"] == 2.0
    ev5 = D.evaluate(cs, pois, D.Grid(0, 1000, (1000, 1000)), 0.5, 0.5, min_score=0.5)
    assert ev5["candidates"] == 1 and ev5["density_per_km2"]["pit"]["n"] == 0


def test_along_fraction():
    from shapely.geometry import LineString
    line = LineString([(0, 0), (100, 0)])
    assert D.along_fraction(line, [LineString([(0, 3), (50, 3)])], 5) == pytest.approx(0.5, abs=0.05)
    assert D.along_fraction(line, [LineString([(50, -50), (50, 50)])], 5) < 0.15


# ----------------------------------------------------------------------------- generated output
_KNOWN = [k for k in tomllib.loads((Path(__file__).resolve().parents[1] / "aois.toml").read_text()) if k != "defaults"]
CAND_AOIS = sorted(k for k in _KNOWN if (APP_DATA / k / "manifest.json").exists()
                   and "candidates" in json.loads((APP_DATA / k / "manifest.json").read_text()))


@pytest.mark.parametrize("aoi", CAND_AOIS)
def test_generated_candidates_match_contract(aoi):
    from PIL import Image
    a = load_aoi(aoi)
    m = json.loads((APP_DATA / aoi / "manifest.json").read_text())
    e = m["candidates"]
    assert e["path"] == "candidates/candidates.geojson" and e["crs"] == "EPSG:25832"
    assert e["method"] == D.METHOD and isinstance(e["version"], int) and isinstance(e["params"], dict)
    assert set(e["counts"]) <= set(D.CLASSES) and e["classes"] == D.LABELS_DE
    fc = json.loads((APP_DATA / aoi / e["path"]).read_text())
    feats = fc["features"]
    assert len(feats) == e["featureCount"] == sum(e["counts"].values())
    scores = [f["properties"]["score"] for f in feats]
    assert scores == sorted(scores, reverse=True)
    assert len({f["properties"]["id"] for f in feats}) == len(feats)
    for f in feats:
        _check_feature(f, (a.e0, a.n0, a.e1, a.n1), baked=e.get("heights") == "baked")
    mk = e.get("mask")
    if mk:
        assert mk["encoding"] == "class8" and mk["path"] == "candidates/mask/{i}_{j}.png"
        nx, ny = a.width // a.chunk_size, a.height // a.chunk_size
        for i, j in mk["chunks"]:
            assert 0 <= i < nx and 0 <= j < ny
            im = Image.open(APP_DATA / aoi / mk["path"].format(i=i, j=j))
            assert im.mode == "L" and im.size == (a.chunk_size, a.chunk_size)
            assert set(np.unique(np.asarray(im))) <= {0, 1, 2, 3, 4, 5}


# ----------------------------------------------------------------------------- coarse pass (rule set 2, Q-15)
def test_block_mean_fine_cells_and_angular_coverage():
    a = np.arange(16, dtype=float).reshape(4, 4)
    assert D.block_mean(a, 2).tolist() == [[2.5, 4.5], [10.5, 12.5]]
    assert D.block_mean(np.ones((3, 5)), 2).shape == (2, 3)  # edge-padded
    assert sorted(D.fine_cells(np.array([1]), np.array([0]), 2, (4, 3)).tolist()) == [6, 7, 9, 10]
    assert sorted(D.fine_cells(np.array([1]), np.array([1]), 2, (4, 3)).tolist()) == [8, 11]  # clipped at W = 3
    t = np.linspace(0, 2 * np.pi, 200, endpoint=False)
    assert D.angular_coverage(10 * np.sin(t), 10 * np.cos(t), 0, 0) == 1.0
    half = t < np.pi
    assert D.angular_coverage(10 * np.sin(t[half]), 10 * np.cos(t[half]), 0, 0) == pytest.approx(0.5, abs=0.06)


def test_coverage_fraction_is_area_within_radius():
    g = D.Grid(0.0, 1000.0, (1000, 1000))
    assert D.coverage_fraction([], g, 30) == 0.0
    assert D.coverage_fraction([(500.0, 500.0)], g, 30) == pytest.approx(math.pi * 900 / 1e6, rel=0.1)
    # two coincident points cover no more than one (unlike the Poisson estimate, clustering is accounted for)
    assert D.coverage_fraction([(500.0, 500.0), (501.0, 500.0)], g, 30) == pytest.approx(
        D.coverage_fraction([(500.0, 500.0)], g, 30), rel=0.1)


def castle(h=360, w=360):
    """Flat-topped, steep-sided platform (Ø 60 m, 6 m high) with a 2 m deep ring moat on a gently tilted plane."""
    z = base(h, w, tilt=0.01, noise=0.02)
    r, c = np.mgrid[0:h, 0:w]
    d = np.hypot(r - h / 2, c - w / 2)
    z += 6.0 / (1 + np.exp((d - 30) / 1.2))
    z -= 2.0 * np.exp(-((d - 40) ** 2) / 18)
    return z


def test_coarse_pass_finds_scarped_platform_and_moat_without_touching_fine_ids():
    z = castle()
    fine = run(z, large_enabled=False)
    both = run(z)
    assert {c.id for c in fine} <= {c.id for c in both}
    coarse = [c for c in both if "scale_m" in c.metrics]
    blob = [c for c in coarse if c.cls in ("platform", "mound", "rect")]
    assert len(blob) == 1 and dist(blob[0], 180, 180) <= 6
    m = blob[0].metrics
    assert 45 <= m["diameter_m"] <= 75 and m["flank_slope_deg"] >= 20 and m.get("moat_coverage", 0) >= 0.9
    assert any("Graben" in s for s in blob[0].reasons)
    moat = [c for c in coarse if c.cls == "linear" and "moat_coverage" in c.metrics]
    assert len(moat) == 1 and moat[0].score <= blob[0].score + 1e-9  # bounded by the enclosed structure
    assert moat[0].metrics["depth_m"] >= 0.5 and moat[0].metrics["length_m"] >= 60
    assert all(x.id.startswith(x.cls + "-") for x in both) and len({x.id for x in both}) == len(both)


def test_coarse_pass_finds_straight_terrace_edge():
    z = base(300, 300, tilt=0.005, noise=0.02)
    r, c = np.mgrid[0:300, 0:300]
    on = (r >= 70) & (r <= 230)
    z += np.where(on, 2.5 / (1 + np.exp(-(c - 150) / 1.0)), np.where(c > 150, 2.5, 0))  # N–S step, 2.5 m
    z[(r < 70) | (r > 230)] = base(300, 300, tilt=0.005, noise=0.02, seed=3)[(r < 70) | (r > 230)] + 2.5 * (
        1 / (1 + np.exp(-(c[(r < 70) | (r > 230)] - 150) / 25.0)))  # gentle natural slope beyond the scarp ends
    sc = [x for x in run(z) if x.cls == "linear" and "scale_m" in x.metrics and "moat_coverage" not in x.metrics]
    assert sc, "terrace edge not found"
    best = max(sc, key=lambda x: x.metrics["length_m"])
    assert 1.5 <= best.metrics["height_m"] <= 3.0 and best.metrics["straightness"] >= 0.9
    assert 100 <= best.metrics["length_m"] <= 175
    assert best.metrics["orientation_deg"] < 10 or best.metrics["orientation_deg"] > 170  # N–S
    assert any("Geländekante" in s for s in best.reasons)


def test_large_natural_undulation_is_not_a_coarse_candidate():
    r, c = np.mgrid[0:400, 0:400]
    z = base(400, 400, noise=0.03) + 4 * np.sin(r / 40.0) * np.cos(c / 45.0)   # rounded hills, ≤ 6° slopes
    assert [x for x in run(z) if "scale_m" in x.metrics] == []


def test_assign_ids_continues_collision_counter():
    a = [D.Candidate("pit", 0.9, 100.2, 200.2, {}, [])]
    b = [D.Candidate("pit", 0.5, 100.4, 199.9, {}, [])]
    seen = D.assign_ids(a)
    D.assign_ids(b, seen)
    assert a[0].id == "pit-100-200" and b[0].id == "pit-100-200-2"
