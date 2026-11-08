"""Orte im Vergleich: place statistics (`stats.py`, sle-stats-v1) — every metric on synthetic places, trees and
rasters. No network and no data files."""
from __future__ import annotations

import json
import math
import sys
import zipfile
from pathlib import Path

import numpy as np
import pytest
import shapely
from shapely.geometry import Point, Polygon, box

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import stats as S  # noqa: E402


# ------------------------------------------------------------------------------------------- ids & rounding
def test_slugify_contract_examples():
    assert S.slugify("Einöd") == "einoed"
    assert S.slugify("Mörsbach") == "moersbach"
    assert S.slugify("Bruchhof-Sanddorf") == "bruchhof-sanddorf"
    assert S.slugify("Zweibrücken") == "zweibruecken"
    assert S.slugify("Groß  Straße (Süd)") == "gross-strasse-sued"


def test_sort_key_de_sorts_umlauts_with_base_letter():
    names = ["Homburg", "Einöd", "Erbach-Reiskirchen", "Bechhofen", "Mörsbach", "Kirrberg"]
    assert sorted(names, key=S.sort_key_de) == ["Bechhofen", "Einöd", "Erbach-Reiskirchen", "Homburg", "Kirrberg",
                                                "Mörsbach"]


@pytest.mark.parametrize("x,n,exp", [(123456, 2, 120000), (0.04567, 2, 0.046), (4.749, 2, 4.7), (0, 2, 0),
                                     (57321.0, 2, 57000), (1.0, 2, 1)])
def test_round_sig(x, n, exp):
    assert S.round_sig(x, n) == exp


def test_round_sig_returns_int_for_whole_numbers_and_none_for_nan():
    assert isinstance(S.round_sig(57321.0), int)
    assert S.round_sig(float("nan")) is None and S.round_sig(None) is None


def test_round_to_steps():
    assert S.round_to(1234.56, 0.1) == 1234.6
    assert S.round_to(14283.2, 10) == 14280 and isinstance(S.round_to(14283.2, 10), int)
    assert S.round_to(45.04, 0.1) == 45
    assert S.round_to(None, 0.1) is None


def test_round_range_keeps_order_and_rejects_unordered():
    r = S.round_range([57321.2, 114642.4, 229284.8])
    assert r == [57000, 110000, 230000]
    assert r[0] <= r[1] <= r[2]
    with pytest.raises(ValueError):
        S.round_range([3, 2, 1])


# ------------------------------------------------------------------------------------------------- biomass
def test_agb_formula_and_density():
    h, r = np.array([20.0]), np.array([3.0])
    d = 0.557 * (20 * 6) ** 0.809
    exp = 0.0673 * (0.60 * d * d * 20) ** 0.976
    assert S.agb_kg(h, r, np.array([False]))[0] == pytest.approx(exp)
    con = S.agb_kg(h, r, np.array([True]))[0]
    assert con == pytest.approx(0.0673 * (0.42 * d * d * 20) ** 0.976)
    assert con < exp
    # monotone in height and crown
    a = S.agb_kg(np.array([10.0, 20.0, 20.0]), np.array([3.0, 3.0, 5.0]), np.zeros(3, bool))
    assert a[0] < a[1] < a[2]


def test_biomass_range_ordering_and_co2():
    agb, co2 = S.biomass_range_t(250_000.0)  # kg
    assert agb == pytest.approx([125.0, 250.0, 500.0])
    assert agb[0] <= agb[1] <= agb[2]
    assert co2 == pytest.approx([v * 1.8 for v in agb])


def test_share_pct_caps_and_handles_zero():
    assert S.share_pct(5, 10) == 50
    assert S.share_pct(15, 10) == 100
    assert S.share_pct(1, 0) is None


# ----------------------------------------------------------------------------------------------- assignment
def test_assign_points_first_match_and_outside():
    a, b = box(0, 0, 10, 10), box(10, 0, 20, 10)
    x = np.array([5.0, 15.0, 10.0, 25.0])
    y = np.array([5.0, 5.0, 5.0, 5.0])
    idx = S.assign_points(x, y, [a, b])
    assert idx.tolist() == [0, 1, 0, -1]  # on the shared edge → first parcel; outside → −1


def test_assign_points_to_places_via_parcels():
    parcels = [box(0, 0, 10, 10), box(10, 0, 20, 10), box(0, 10, 20, 20)]
    place = np.array(["a", "b", "a"])
    x = np.array([1.0, 11.0, 5.0, 19.0])
    y = np.array([1.0, 1.0, 15.0, 19.0])
    idx = S.assign_points(x, y, parcels)
    assert place[idx].tolist() == ["a", "b", "a", "a"]


# ------------------------------------------------------------------------------------------------- Ortslage
def test_fill_small_holes_closes_only_small_holes():
    outer = [(0, 0), (1000, 0), (1000, 1000), (0, 1000)]
    small = [(100, 100), (150, 100), (150, 150), (100, 150)]   # 2500 m²
    big = [(300, 300), (500, 300), (500, 500), (300, 500)]     # 4 ha
    g = S.fill_small_holes(Polygon(outer, [small, big]), 10_000)
    assert len(g.interiors) == 1
    assert g.area == pytest.approx(1_000_000 - 40_000)


def test_ortslage_buffer_closes_holes_and_drops_lone_buildings():
    # a village: 4 houses at the corners of a 100 m square (gaps 80 m < 2 × 50 m) → the buffers touch and
    # leave a small courtyard hole in the middle
    houses = [box(x, y, x + 10, y + 10) for x, y in ((0, 0), (90, 0), (0, 90), (90, 90))]
    raw = shapely.union_all([h.buffer(50, quad_segs=4) for h in houses])
    assert len(raw.interiors) == 1
    lone = box(2000, 2000, 2010, 2010)                      # a barn far away
    g, info = S.ortslage_geometry(houses + [lone])
    assert g.geom_type == "Polygon" and len(g.interiors) == 0  # hole < 1 ha closed
    assert not g.contains(Point(2005, 2005))                 # lone building dropped (< 3 buildings)
    assert g.contains(Point(50, 50))
    assert info == {"parts": 1, "parts_dropped": 1, "buildings_dropped": 1}
    # the buffer reaches ~50 m beyond the footprints, not more
    assert g.contains(Point(-45, 5)) and not g.contains(Point(-55, 5))


def test_ortslage_keeps_large_courtyards():
    ring = [box(x, 0, x + 10, 10) for x in range(0, 400, 40)] + [box(x, 390, x + 10, 400) for x in range(0, 400, 40)]
    ring += [box(0, y, 10, y + 10) for y in range(40, 390, 40)] + [box(390, y, 400, y + 10) for y in range(40, 390, 40)]
    g, _ = S.ortslage_geometry(ring)
    assert len(g.interiors) == 1                               # 400 m square leaves a ≈ 2.9 ha hole → kept
    assert not g.contains(Point(200, 200))


def test_ortslage_empty():
    g, info = S.ortslage_geometry([])
    assert g is None and info["parts"] == 0


# ------------------------------------------------------------------------------------------- green / sealed
def _cover_case():
    n = 10
    inside = np.ones((n, n), bool)
    inside[:, 9] = False                         # one column outside the Ortslage
    chm = np.zeros((n, n), np.float32)
    ndvi = np.full((n, n), 0.10, np.float32)      # between T_BARE and T_GREEN: neither green nor bare
    bldg = np.zeros((n, n), bool)
    paved = np.zeros((n, n), bool)
    water = np.zeros((n, n), bool)
    chm[0, :] = 12.0                              # row 0: canopy (9 cells inside)
    ndvi[1, :] = 0.40                             # row 1: green below 3 m
    bldg[2, :] = True                             # row 2: roofs
    ndvi[2, :] = 0.0
    paved[3, :] = True                            # row 3: roads with a tree over 3 cells → green wins
    chm[3, :3] = 8.0
    ndvi[4, :] = -0.05                            # row 4: unmapped bare / paved
    water[5, :] = True                            # row 5: water, low NDVI → neither
    ndvi[5, :] = -0.2
    chm[6, :2] = np.nan                           # row 6: 2 cells without LiDAR → not valid
    return inside, chm, ndvi, bldg, paved, water


def test_cover_counts_classes():
    c = S.cover_counts(*_cover_case())
    assert c["inside"] == 90 and c["valid"] == 88
    assert c["canopy"] == 9 + 3
    assert c["green"] == 9 + 9 + 3
    assert c["sealed"] == 9 + 6 + 9                 # roofs, roads without the tree-covered cells, bare
    s = S.cover_shares(c)
    assert s["green_pct"] >= s["canopy_pct"]
    assert s["green_pct"] + s["sealed_pct"] <= 100
    assert s["canopy_pct"] == pytest.approx(100 * 12 / 88)


def test_cover_counts_threshold_parameters():
    inside, chm, ndvi, bldg, paved, water = _cover_case()
    lo = S.cover_counts(inside, chm, ndvi, bldg, paved, water, t_green=0.05)
    assert lo["green"] > S.cover_counts(inside, chm, ndvi, bldg, paved, water)["green"]
    bare = S.cover_counts(inside, chm, ndvi, bldg, paved, water, t_bare=0.2)
    assert bare["sealed"] > S.cover_counts(inside, chm, ndvi, bldg, paved, water)["sealed"]


def test_ndvi_sl_scale_decodes_and_maps_rlp(monkeypatch):
    i8 = np.array([[-128, 0, 40], [50, 50, -10]], np.int8)
    src = np.array([[0, 1, 1], [2, 1, 2]], np.uint8)
    table = {"src": [-1.0, 0.0, 0.5, 1.0], "ref": [-1.0, 0.0, 0.3, 1.0]}
    v = S.ndvi_sl_scale(i8, src, table)
    assert np.isnan(v[0, 0])
    assert v[0, 2] == pytest.approx(0.40) and v[1, 1] == pytest.approx(0.50)  # SL untouched
    assert v[1, 0] == pytest.approx(0.30)                                     # RLP 0.5 → 0.3
    assert v[1, 2] == pytest.approx(-0.10)
    assert np.allclose(S.ndvi_sl_scale(i8, src, None)[1], [0.5, 0.5, -0.1])


# ---------------------------------------------------------------------------------------------- inhabitants
def test_zensus_cell_polygons_are_100m_cells_in_utm():
    cells = S.zensus_cell_polygons(np.array([4123250.0]), np.array([2923050.0]))
    c = cells[0]
    assert c.area == pytest.approx(10_000, rel=0.01)
    assert c.centroid.x == pytest.approx(374895.14, abs=1.0) and c.centroid.y == pytest.approx(5471953.13, abs=1.0)


def test_apportion_by_area_share():
    cells = [box(0, 0, 100, 100), box(100, 0, 200, 100), box(500, 500, 600, 600)]
    pop = np.array([40.0, 10.0, 99.0])
    place = box(50, 0, 200, 100)                  # half of cell 0, all of cell 1, none of cell 2
    assert S.apportion(cells, pop, place) == pytest.approx(20 + 10)
    assert S.apportion(cells, pop, box(1000, 1000, 1100, 1100)) == 0.0


# -------------------------------------------------------------------------------------------------- tallest
def _cone(h, rad, k=4):
    yy, xx = np.mgrid[-k:k + 1, -k:k + 1]
    return (h * np.clip(1 - np.hypot(yy, xx) / rad, 0, None) + 0.0).astype(np.float32)


def test_spike_reason_accepts_crowns_rejects_spikes():
    crown = np.maximum(_cone(40, 30), 0)
    assert S.spike_reason(crown, 40.0, 5.0) is None
    spike = np.zeros((9, 9), np.float32)
    spike[4, 4] = 44.0                            # a mast: one high cell, ground around
    assert S.spike_reason(spike, 44.0, 5.0) == "spike"
    assert S.spike_reason(crown, 40.0, 1.0) == "crown"
    narrow = np.zeros((9, 9), np.float32)
    narrow[2:7, 2:7] = 40.0                       # a 5 m wide tower top: ring ok, disc too small
    assert S.spike_reason(narrow, 40.0, 5.0, {**S.TALLEST, "disc_frac_min": 0.6}) == "narrow"
    wide = np.full((9, 9), 38.0, np.float32)      # closed canopy
    assert S.spike_reason(wide, 40.0, 3.0) is None


def _flat(v, k=4):
    return np.full((2 * k + 1, 2 * k + 1), v, np.float32)


def test_ground_rise_measures_max_rise_within_radius():
    dtm = _flat(100.0)
    assert S.ground_rise(dtm, 4.0) == 0.0
    yy, xx = np.mgrid[-4:5, -4:5]
    plane = (100 + 0.5 * xx).astype(np.float32)          # uniform slope ≈ 27°: rise 2 m at 4 m
    assert S.ground_rise(plane, 4.0) == pytest.approx(2.0)
    gully = (100 + 1.0 * np.abs(xx)).astype(np.float32)  # top in a V gully (45° flanks): rise 4 m
    assert S.ground_rise(gully, 4.0) == pytest.approx(4.0)
    corner = _flat(100.0)
    corner[0, 0] = 200.0                                   # outside the 4 m disc → ignored
    assert S.ground_rise(corner, 4.0) == 0.0
    nan_c = _flat(100.0)
    nan_c[4, 4] = np.nan
    assert S.ground_rise(nan_c, 4.0) == math.inf


def test_tree_reason_order_and_terrain():
    crown = np.maximum(_cone(50, 30, k=S.chm_pad()), 0)
    yy, xx = np.mgrid[-15:16, -15:16]
    flat, no_b = np.full((31, 31), 300.0, np.float32), np.zeros((11, 11), bool)
    assert S.tree_reason(50.0, 5.0, 100.0, crown, no_b, flat) is None
    assert S.tree_reason(50.0, 5.0, 25.0, crown, no_b, flat) == "pylon-or-mast"   # v4: 30 m clearance
    assert S.tree_reason(50.0, 5.0, 31.0, crown, no_b, flat) is None
    tall = np.maximum(_cone(60.9, 36, k=S.chm_pad()), 0)                           # v4: unclipped 60.9 m crown
    assert S.tree_reason(60.9, 5.0, 100.0, tall, no_b, flat) is None
    assert S.tree_reason(80.0, 5.0, 100.0, crown * 1.6, no_b, flat) == "too-tall"  # mast / turbine / crane
    b = no_b.copy()
    b[0, 0] = True
    assert S.tree_reason(50.0, 5.0, 100.0, crown, b, flat) == "building"
    assert S.tree_reason(50.0, 5.0, 100.0, crown[:-1], no_b, flat) == "edge"
    assert S.tree_reason(50.0, 5.0, 100.0, crown[4:-4, 4:-4], no_b, flat) == "edge"  # v3-size window too small
    assert S.tree_reason(50.0, 5.0, 100.0, crown, no_b, flat[:9, :9]) == "edge"   # DTM window too small
    gully = (300 + 1.0 * np.abs(xx)).astype(np.float32)
    assert S.tree_reason(50.0, 5.0, 100.0, crown, no_b, gully) == "terrain"
    slope = (300 + 0.5 * xx).astype(np.float32)           # 27° hillside: fine
    assert S.tree_reason(50.0, 5.0, 100.0, crown, no_b, slope) is None
    ravine = (300 + 0.6 * np.abs(xx)).astype(np.float32)  # rise 2.4 m in 4 m, but ≈ 5 m deep within 15 m
    assert S.tree_reason(50.0, 5.0, 100.0, crown, no_b, ravine) == "valley"
    assert S.tree_reason(50.0, 5.0, 100.0, crown, no_b, None) is None   # no DTM → terrain tests skipped
    spike = _flat(0.0, k=S.chm_pad())
    spike[8, 8] = 50.0
    assert S.tree_reason(50.0, 5.0, 100.0, spike, no_b, flat) == "spike"
    jib = _flat(20.0, k=S.chm_pad())                 # a crane jib seen blurred: a 5 m wide, 17 m long bar at 60 m
    jib[6:11, :] = 60.0                              # (wide enough to pass the spike / narrow support tests)
    assert S.tree_reason(60.0, 5.0, 100.0, jib, no_b, flat) == "linear"


def test_remeasure_at_clip_keeps_v3_rejection_without_unclipped_chm():
    k = S.chm_pad()
    clipped = np.minimum(np.maximum(_cone(60.9, 36, k=k), 0), 60.0).astype(np.float32)   # detector CHM, 60 m clip
    raw = np.maximum(_cone(60.9, 36, k=k), 0).astype(np.float32)                          # DSM − DTM, no clip
    h, win, why = S.remeasure_at_clip(60.0, clipped, raw)
    assert why is None and h == pytest.approx(60.9) and win is raw                        # v4: re-measured
    assert S.remeasure_at_clip(60.0, clipped, None) == (60.0, clipped, "chm-clip")       # no raw LiDAR → v3 rule
    assert S.remeasure_at_clip(60.0, clipped, raw[1:, 1:])[2] == "chm-clip"              # shape mismatch
    nan_top = raw.copy()
    nan_top[k, k] = np.nan
    assert S.remeasure_at_clip(60.0, clipped, nan_top)[2] == "chm-clip"
    assert S.remeasure_at_clip(60.0, clipped[1:, 1:], raw[1:, 1:])[2] == "chm-clip"       # window cut at the edge
    low = np.maximum(_cone(50, 30, k=k), 0)
    assert S.remeasure_at_clip(50.0, low, None) == (50.0, low, None)                      # below the clip: unchanged


def test_linear_ratio_round_tops_vs_lines():
    k = S.chm_pad()
    assert S.linear_ratio(np.maximum(_cone(50, 30, k=k), 0), 50.0) == pytest.approx(1.0, abs=0.05)
    bar = _flat(10.0, k=k)
    bar[k, :] = 50.0
    assert S.linear_ratio(bar, 50.0) > 5
    diag = _flat(10.0, k=k)
    for d in range(-6, 7):
        diag[k + d, k + d] = 50.0
    assert S.linear_ratio(diag, 50.0) > 5            # 8-connected diagonal line
    blob = _flat(10.0, k=k)
    blob[k - 2:k + 3, k - 3:k + 4] = 50.0            # 5 × 7 m crown top: not a line
    assert S.linear_ratio(blob, 50.0) < S.TALLEST["linear_ratio_max"]
    lone = _flat(10.0, k=k)
    lone[k, k] = 50.0
    assert S.linear_ratio(lone, 50.0) == 1.0         # one cell: the spike test handles it


def test_valley_depth_is_zero_on_planes_and_positive_in_hollows():
    yy, xx = np.mgrid[-15:16, -15:16]
    assert abs(S.valley_depth((300 + 0.7 * xx + 0.2 * yy).astype(float), 15.0)) < 1e-9
    assert S.valley_depth((300 + 0.6 * np.abs(xx)).astype(float), 15.0) > 3.0
    assert S.valley_depth((300 - 0.6 * np.abs(xx)).astype(float), 15.0) < 0       # ridge
    w = np.full((31, 31), 300.0)
    w[15, 15] = np.nan
    assert S.valley_depth(w, 15.0) == math.inf


def test_size_category_by_inhabitants():
    assert S.size_category(12645.0) == "stadt" and S.size_category(5000) == "stadt"
    assert S.size_category(4999.9) == "dorf" and S.size_category(None) == "dorf"


def test_lidar_epochs_majority_and_shares():
    src = np.array([0] * 53 + [1] * 47 + [2] * 10 + [255] * 5, np.uint8)   # 2 none / 255 unfetched ignored
    ep, rows = S.lidar_epochs(src)
    assert ep == 2025 and rows == [[2025, 53.0], [2022, 47.0]]
    ep2, rows2 = S.lidar_epochs(np.array([1, 1, 1, 0], np.uint8))
    assert ep2 == 2022 and rows2 == [[2022, 75.0], [2025, 25.0]]
    assert S.lidar_epochs(np.array([0, 0], np.uint8)) == (2025, [[2025, 100.0]])
    assert S.lidar_epochs(np.array([2, 255], np.uint8)) == (None, [])
    q = S.round_place(_raw_place(lidar_epochs=[[2025, 53.44], [2022, 46.56]]))
    assert q["lidar_epochs"] == [[2025, 53.4], [2022, 46.6]]


def test_pick_tallest_skips_fill_and_rejected_and_breaks_ties_by_id():
    h = np.array([50.0, 44.0, 45.0, 45.0, 30.0])
    fill = np.array([False, False, True, False, False])
    ids = np.array([5, 4, 3, 9, 1])
    bad = {0}                                      # the 50 m "tree" is a pylon
    i, rej = S.pick_tallest(h, fill, ids, lambda k: "pylon-or-mast" if k in bad else None)
    assert i == 3 and rej == {"pylon-or-mast": 1}
    h2 = np.array([45.0, 45.0])
    i2, _ = S.pick_tallest(h2, np.zeros(2, bool), np.array([7, 2]), lambda k: None)
    assert i2 == 1                                 # equal heights → lower id
    i3, rej3 = S.pick_tallest(h, fill, ids, lambda k: "spike")
    assert i3 == -1 and rej3 == {"spike": 4}



def test_edge_reason_keeps_tops_off_the_place_border():
    sq = box(0, 0, 100, 100).boundary
    assert S.edge_reason(sq, 50.5, 50.5) is None
    assert S.edge_reason(sq, 10.5, 50.5) is None                 # 10.5 m ≥ edge_clear_m
    assert S.edge_reason(sq, 0.5, 50.5) == "place-edge"          # Bechhofen v2 case: on the Gemarkung line
    assert S.edge_reason(sq, 50.5, 95.5) == "place-edge"


def _trees_aoi(tmp_path, recs):
    """Tiny AOI (1000 × 1000 m, 500 m chunks) with one Trees chunk (i=1, j=0) holding `recs` = [(E, N, h)]."""
    import trees as TR
    e0, n0, cs = 10000, 20000, 500
    e_ll, n_ll = e0 + cs, n0 + 1000 - cs                      # chunk (1, 0): east half, north half
    e = np.array([r[0] for r in recs]); n = np.array([r[1] for r in recs])
    buf, _ = TR.encode_chunk((e - e_ll) * 10, (n - n_ll) * 10, np.full(e.size, 300.0),
                             np.array([r[2] for r in recs]), np.full(e.size, 3.0), np.full(e.size, 2, np.uint8),
                             TR.tree_ids(e - 0.5, n - 0.5))
    (tmp_path / "trees").mkdir()
    (tmp_path / "trees" / "1_0.bin").write_bytes(buf)
    (tmp_path / "manifest.json").write_text(json.dumps({
        "origin": {"E0": e0, "N0": n0}, "size": {"width": 1000, "height": 1000}, "chunkSize": cs,
        "trees": {"format": "sle-trees-v1", "path": "trees/{i}_{j}.bin", "chunks": [[1, 0, len(recs)]]}}))
    return e_ll, n_ll, buf


def test_chunk_tree_ids_decode_the_trees_rule(tmp_path):
    import trees as TR
    recs = [(10600.5, 20700.5, 30.0), (10999.5, 20999.5, 44.0), (10500.5, 20500.5, 12.0)]
    e_ll, n_ll, buf = _trees_aoi(tmp_path, recs)
    got = set(S.chunk_tree_ids(buf, e_ll, n_ll).tolist())
    want = set(TR.tree_ids(np.array([r[0] - 0.5 for r in recs]), np.array([r[1] - 0.5 for r in recs])).tolist())
    assert got == want


def test_trees_layer_has_finds_only_published_trees(tmp_path):
    import trees as TR
    _trees_aoi(tmp_path, [(10600.5, 20700.5, 30.0)])
    tid = int(TR.tree_ids(np.array([10600]), np.array([20700]))[0])
    assert S.trees_layer_has(tmp_path, 10600.5, 20700.5, tid)
    other = int(TR.tree_ids(np.array([10601]), np.array([20700]))[0])
    assert not S.trees_layer_has(tmp_path, 10601.5, 20700.5, other)   # same chunk, not in it (e.g. > 45 m)
    assert not S.trees_layer_has(tmp_path, 10100.5, 20700.5, tid)     # chunk (0, 0) has no file
    assert not S.trees_layer_has(tmp_path, 12000.5, 20700.5, tid)     # outside the AOI tiles


def test_tallest_context_slope_and_stand():
    yy, xx = np.mgrid[-20:21, -20:21]
    dtm = (300 + np.tan(np.radians(17)) * xx).astype(np.float32)
    chm = np.full((41, 41), 40.0, np.float32)
    chm[20, 20] = 48.0
    c = S.tallest_context(chm, dtm, 48.0)
    assert abs(c["slope_deg"] - 17.0) < 0.2
    assert c["stand_p95_m"] == 40.0 and c["above_stand_p95_m"] == 8.0
    assert S.tallest_context(np.zeros((41, 41)), np.full((41, 41), np.nan), 5.0) == {
        "slope_deg": None, "stand_p95_m": None, "above_stand_p95_m": None}
# ------------------------------------------------------------------------------------------------------ OSM
def test_road_width_rules():
    assert S.road_width({"highway": "residential"}) == 5.5
    assert S.road_width({"highway": "residential", "width": "7.5"}) == 7.5
    assert S.road_width({"highway": "residential", "width": "7,5 m"}) == 7.5
    assert S.road_width({"highway": "residential", "width": "wide"}) == 5.5
    assert S.road_width({"highway": "service", "surface": "gravel"}) is None
    assert S.road_width({"highway": "track"}) is None
    assert S.road_width({"highway": "track", "tracktype": "grade1"}) == 3.0
    assert S.road_width({"highway": "footway", "surface": "paving_stones"}) == 2.0
    assert S.road_width({"highway": "footway"}) is None
    assert S.road_width({"highway": "primary", "tunnel": "yes"}) is None
    assert S.road_width({"highway": "pedestrian", "area": "yes"}) is None   # an area, handled as polygon


def _ll(coords):
    return [{"lon": x, "lat": y} for x, y in coords]


def test_osm_features_classifies_and_assembles_multipolygons():
    sq = [(0, 0), (100, 0), (100, 100), (0, 100), (0, 0)]
    hole = [(40, 40), (60, 40), (60, 60), (40, 60), (40, 40)]
    data = {"elements": [
        {"type": "way", "tags": {"highway": "residential"}, "geometry": _ll([(0, 0), (100, 0)])},
        {"type": "way", "tags": {"highway": "track"}, "geometry": _ll([(0, 10), (100, 10)])},
        {"type": "way", "tags": {"amenity": "parking"}, "geometry": _ll(sq)},
        {"type": "way", "tags": {"amenity": "parking", "surface": "grass"}, "geometry": _ll(sq)},
        {"type": "way", "tags": {"natural": "water"}, "geometry": _ll(sq)},
        {"type": "relation", "tags": {"type": "multipolygon", "landuse": "residential"}, "members": [
            {"type": "way", "role": "outer", "geometry": _ll(sq[:3])},
            {"type": "way", "role": "outer", "geometry": _ll(sq[2:])},
            {"type": "way", "role": "inner", "geometry": _ll(hole)}]},
        {"type": "node", "tags": {"power": "tower"}, "lon": 5, "lat": 6},
        {"type": "node", "tags": {"power": "pole"}, "lon": 7, "lat": 8},
        {"type": "node", "tags": {"power": "generator", "generator:source": "wind"}, "lon": 9, "lat": 9},
        {"type": "node", "tags": {"power": "generator", "generator:source": "solar"}, "lon": 3, "lat": 3},
        {"type": "way", "tags": {"man_made": "chimney"}, "geometry": _ll([(0, 0), (2, 0), (2, 2), (0, 2), (0, 0)])},
    ]}
    f = S.osm_features(data, lambda pts: [(p["lon"], p["lat"]) for p in pts])
    assert len(f["paved"]) == 2                     # residential road + paved parking
    road = f["paved"][0]
    assert road.area == pytest.approx(100 * 5.5)    # flat caps, full width
    assert len(f["water"]) == 1
    assert len(f["residential"]) == 1 and f["residential"][0].area == pytest.approx(10_000 - 400)
    assert f["hazards"][0] == (5, 6) and len(f["hazards"]) == 3
    assert f["hazards"][1] == (9, 9) and f["wind"] == [(9, 9)]   # wind turbine yes, solar generator no
    assert f["hazards"][2] == pytest.approx((1, 1))


# ------------------------------------------------------------------------------------------- Zensus xlsx
def _xlsx(path: Path, rows):
    ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    strings: list[str] = []

    def cell(ref, v):
        if v is None:
            return ""
        if isinstance(v, (int, float)):
            return f'<c r="{ref}"><v>{v}</v></c>'
        strings.append(v)
        return f'<c r="{ref}" t="s"><v>{len(strings) - 1}</v></c>'
    body = "".join(f'<row r="{i + 1}">' + "".join(cell(f"{chr(65 + j)}{i + 1}", v) for j, v in enumerate(r)) + "</row>"
                   for i, r in enumerate(rows))
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("xl/workbook.xml", f'<workbook xmlns="{ns}" xmlns:r="http://schemas.openxmlformats.org/'
                   f'officeDocument/2006/relationships"><sheets><sheet name="Impressum" r:id="rId2"/>'
                   f'<sheet name="Bevölkerung" r:id="rId1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/'
                   '2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet4.xml"/>'
                   '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>')
        z.writestr("xl/worksheets/sheet4.xml", f'<worksheet xmlns="{ns}"><sheetData>{body}</sheetData></worksheet>')
        z.writestr("xl/worksheets/sheet2.xml", f'<worksheet xmlns="{ns}"><sheetData/></worksheet>')
        z.writestr("xl/sharedStrings.xml", f'<sst xmlns="{ns}">' + "".join(f"<si><t>{s}</t></si>" for s in strings)
                   + "</sst>")


def test_xlsx_rows_and_official_population(tmp_path):
    p = tmp_path / "t.xlsx"
    _xlsx(p, [["Amtlicher Regionalschlüssel (ARS)", "Name", "Regionalebene", "Bevölkerung"],
              ["10045", "Saarpfalz-Kreis", "Stadtkreis/kreisfreie Stadt/Landkreis", 141000],
              ["100450114114", "Homburg, Kreisstadt", "Gemeinde", 42891],
              ["073405008203", "Bechhofen", "Gemeinde", 2060],
              ["095710115115", "Bechhofen, M", "Gemeinde", 6193],
              ["073200000000", "Zweibrücken, Stadt", "Gemeinde", None]])
    rows = S.xlsx_rows(p, "Bevölkerung")
    assert rows[2][:4] == ["100450114114", "Homburg, Kreisstadt", "Gemeinde", "42891"]
    assert S.official_population(rows, "10045114") == (42891, "Homburg, Kreisstadt")
    assert S.official_population(rows, "07340203") == (2060, "Bechhofen")      # not the Bavarian Bechhofen
    assert S.official_population(rows, "07320000") == (None, "Zweibrücken, Stadt")
    assert S.official_population(rows, "99999999") == (None, None)
    with pytest.raises(KeyError):
        S.xlsx_rows(p, "Nope")


# ------------------------------------------------------------------------------------------------- MaStR
def test_bucket_years_merges_small_years_and_keeps_totals():
    rows = [(1939, 1, 0.4), (1965, 1, 5.2), (2000, 5, 13.9), (2001, 2, 10.0), (2002, 4, 20.0), (2003, 10, 50.0),
            (2004, 1, 1.0)]
    b = S.bucket_years(rows, 5)
    assert all(n >= 5 for _, n, _ in b)
    assert sum(n for _, n, _ in b) == 24
    assert sum(k for _, _, k in b) == pytest.approx(round(0.4 + 5.2 + 13.9) + 30 + 51, abs=1)
    assert [y for y, _, _ in b] == [2000, 2002, 2003]   # 1939/1965 carried into 2000, 2004 tail into 2003
    assert S.bucket_years([(2020, 2, 3.0)], 5) == []


# ---------------------------------------------------------------------------------------- privacy, rounding
def _raw_place(**over):
    p = {"id": "x", "name_de": "X", "kind": "gemarkung", "gemarkungen": ["X"], "state": "SL", "municipality": "m",
         "category": "dorf", "complete": True, "flags": ["pv-municipality-only"], "suppressed": [], "lidar_epoch": 2025,
         "label": (381438.6, 5461188.4), "bbox": [379719.3, 5459660.2, 383373.1, 5464363.9], "aoi_share_pct": 98.234,
         "area_ha": 806.113, "parcels": 5039, "trees": 50702, "crown_ha": 374.04, "crown_pct": 46.4012,
         "agb_t": [57321.2, 114642.4, 229284.8], "co2_t": [103178.2, 206356.3, 412712.6],
         "ortslage": {"area_ha": 166.66, "buildings": 2259, "canopy_pct": 32.94, "green_pct": 65.43,
                      "sealed_pct": 28.47},
         "inhabitants": 2582.4, "trees_per_inhabitant": 50702 / 2582.4,
         "tallest": {"h": 44.8312, "E": 380937.5, "N": 5461397.5, "id": 3490272661}, "pv": None}
    p.update(over)
    return p


def test_apply_min_count_suppresses_small_ortslage():
    p = S.apply_min_count(_raw_place(ortslage={"area_ha": 1.0, "buildings": 4, "canopy_pct": 1, "green_pct": 2,
                                               "sealed_pct": 3}))
    assert p["ortslage"] is None and p["suppressed"] == ["ortslage"]
    q = S.apply_min_count(_raw_place())
    assert q["ortslage"] is not None and q["suppressed"] == []


def test_round_place_contract_rounding():
    q = S.round_place(_raw_place())
    assert q["area_ha"] == 806.1 and q["crown_ha"] == 374 and q["crown_pct"] == 46.4
    assert q["aoi_share_pct"] == 98.2
    assert q["agb_t"] == [57000, 110000, 230000] and q["co2_t"] == [100000, 210000, 410000]
    assert q["inhabitants"] == 2580
    assert q["trees_per_inhabitant"] == 20                      # 19.63… → 2 significant digits
    assert q["label"] == [381439, 5461188]
    assert q["bbox"] == [379719, 5459660, 383374, 5464364]       # outward to whole metres
    assert q["tallest"] == {"h": 44.8, "E": 380937.5, "N": 5461397.5, "id": 3490272661}
    t = S.round_place(_raw_place(tallest={"h": 50.04, "E": 1.5, "N": 2.5, "id": 7, "in_trees": np.False_}))["tallest"]
    assert t == {"h": 50.0, "E": 1.5, "N": 2.5, "id": 7, "in_trees": False} and type(t["in_trees"]) is bool
    assert q["ortslage"] == {"area_ha": 166.7, "buildings": 2259, "canopy_pct": 32.9, "green_pct": 65.4,
                             "sealed_pct": 28.5}


def test_round_place_keeps_share_invariants_after_rounding():
    q = S.round_place(_raw_place(ortslage={"area_ha": 10, "buildings": 9, "canopy_pct": 40.04, "green_pct": 40.0,
                                           "sealed_pct": 59.98}))
    o = q["ortslage"]
    assert o["green_pct"] >= o["canopy_pct"]
    assert o["green_pct"] + o["sealed_pct"] <= 100


def test_round_place_null_inhabitants():
    q = S.round_place(_raw_place(inhabitants=None, trees_per_inhabitant=None, tallest=None, ortslage=None))
    assert q["inhabitants"] is None and q["trees_per_inhabitant"] is None and q["tallest"] is None
    assert q["ortslage"] is None


def test_check_privacy_rejects_parcel_ids():
    S.check_privacy({"places": [S.round_place(_raw_place())]})
    with pytest.raises(ValueError):
        S.check_privacy({"places": [{"id": "x", "flstkennz": "102100004009870002__"}]})


@pytest.mark.parametrize("doc", [
    {"places": [{"Flurstueck_id": "x"}]},                     # key fragments, any case
    {"places": [{"lagebezeichnung": "x"}]},
    {"a": {"addr:housenumber": "3"}},
    {"a": [{"Eigentuemer": None}]},
    {"a": {"note": "102100004009870002__"}},                   # parcel-id-like value under a harmless key
    {"a": {"note": "Hauptstraße 12a"}},                        # address-like value
    {"a": ["Kirrberger Weg 3"]},
])
def test_check_privacy_rejects_parcel_and_address_like_keys_and_values(doc):
    with pytest.raises(ValueError):
        S.check_privacy(doc)


def test_check_privacy_allows_contract_content():
    S.check_privacy({"road_width_m": {"living_street": 5.0}, "ags": "10045114", "generated": "2026-11-07T21:00:00Z",
                     "attribution": "© OpenStreetMap-Mitwirkende, ODbL", "parcels": 5039,
                     "sources": ["OSM paved roads (buffered by width)"]})
    S.check_outline_privacy([{"properties": {"id": "a", "name_de": "A"}}])
    with pytest.raises(ValueError):
        S.check_outline_privacy([{"properties": {"id": "a", "name_de": "A", "flaeche": 3}}])


# --------------------------------------------------------------------------------------- disciplines/method
def test_disciplines_match_contract():
    d = {x["id"]: x for x in S.disciplines()}
    assert list(d) == ["gruenste-ortslage", "wenigsten-beton", "baeume-pro-einwohner", "waldreichste-gemarkung",
                       "riesenbaum", "sonnenstaerkster-ort", "groesster-fortschritt", "artenvielfalt"]
    assert d["gruenste-ortslage"]["measure"] == "ortslage.green_pct" and d["gruenste-ortslage"]["higher_is_better"]
    assert d["wenigsten-beton"]["higher_is_better"] is False
    assert d["sonnenstaerkster-ort"]["scope"] == "municipality"
    assert d["sonnenstaerkster-ort"]["measure"] == "pv.kwp_per_inhabitant"
    assert not d["groesster-fortschritt"]["ready"]
    a = d["artenvielfalt"]
    assert a["ready"] and a["measure"] == "biodiversity.rarefied_500" and a["higher_is_better"]
    assert a["method"] == "gbif-rarefied-v1" and a["unit"] == "Arten" and a["scope"] == "place"
    assert "nicht die Qualität der Natur" in a["description_de"] and a["note_de"]   # observations, not nature
    off = {x["id"]: x for x in S.disciplines(biodiversity_ready=False)}["artenvielfalt"]
    assert not off["ready"] and off["measure"] == ""
    assert all("agb" not in x["measure"] and "co2" not in x["measure"] for x in d.values())  # biomass never ranked
    m = S.methods({}, {"parts": 1}, True, None)
    ready_methods = {x["method"] for x in d.values() if x["ready"]}
    assert ready_methods <= {v["id"] for v in m.values()}


def test_method_ids_are_the_contract_ids():
    m = S.methods({}, {}, False, {"trees_per_ha_canopy_rlp_over_sl": 1.2, "canopy_cover_diff": -0.03})
    assert {k: v["id"] for k, v in m.items()} == {
        "assign": "parcel-pip-v1", "crown": "crown-disc-v1", "biomass": "crown-allometry-v2",
        "ortslage": "ortslage-bldg-buffer-50m-v1", "green": "ndvi-cir-v1", "sealed": "sealed-v1",
        "inhabitants": "zensus-grid-area-v1", "tallest": "tallest-checked-v4", "pv_mastr": "mastr-municipality-v1",
        "category": "category-inhabitants-v1", "species": "species-dlr-crown-mix-v1", "riesen": "riesen-checked-v1",
        "biodiversity": "gbif-rarefied-v1", "forest_age": "tree-age-height-v2",
        "forest_continuity": "hist-forest-crown-share-v1", "nutzung": "alkis-nutzung-groups-v1",
        "roof_potential": "roof-pv-potential-v2", "goals": "goals-examples-v1"}
    json.dumps(m)  # serialisable


# ---------------------------------------------------------------------------------------------- outlines
def test_outline_features_shape_and_properties():
    a = Polygon([(0, 0), (1000.4, 0), (1000.4, 1000), (500, 1003), (0, 1000)])
    b = Polygon([(1000.4, 0), (2000, 0), (2000, 1000), (1000.4, 1000)])
    feats = S.outline_features(["a", "b"], ["A", "B"], [a, b])
    assert [f["properties"] for f in feats] == [{"id": "a", "name_de": "A"}, {"id": "b", "name_de": "B"}]
    for f in feats:
        ring = f["geometry"]["coordinates"][0]
        assert all(isinstance(v, int) for pt in ring for v in pt)
        assert f["geometry"]["type"] == "Polygon"
    # the 3 m bump is removed by the 10 m simplification, the areas stay ≈
    ra = Polygon(feats[0]["geometry"]["coordinates"][0])
    assert ra.area == pytest.approx(a.area, rel=0.01)


def test_disjoint_outlines_removes_overlap_and_closes_slivers():
    a = box(0, 0, 1000, 1000)
    b = box(999.0, 0, 2000, 1000)          # 1 m overlap (state-border parcel mismatch)
    c = box(2000.6, 0, 3000, 1000)         # 0.6 m gap to b
    g = S.disjoint_outlines([a, b, c])
    assert g[0].intersection(g[1]).area == pytest.approx(0, abs=1e-6)
    assert g[1].intersection(g[2]).area == pytest.approx(0, abs=1e-6)
    u = shapely.union_all(g)
    assert u.geom_type == "Polygon" and len(u.interiors) == 0          # one piece: the gap is closed
    assert g[0].equals(a)                                              # the first outline keeps the overlap
    assert sum(x.area for x in g) == pytest.approx(3_000_000, rel=1e-3)
    far = box(5000, 0, 6000, 1000)
    assert S.disjoint_outlines([a, far])[1].equals(far)                # nothing to snap to: unchanged
    feats = S.outline_features(["a", "b", "c"], ["A", "B", "C"], [a, b, c])
    fs = [shapely.geometry.shape(f["geometry"]) for f in feats]
    assert sum(fs[i].intersection(fs[j]).area for i in range(3) for j in range(i + 1, 3)) == pytest.approx(0, abs=1)


def test_label_point_inside():
    u = Polygon([(0, 0), (100, 0), (100, 10), (10, 10), (10, 100), (0, 100)])
    x, y = S.label_point(u)
    assert u.contains(Point(x, y))
    assert math.isfinite(x) and math.isfinite(y)


# ================================================================================ Phase 1 (riesen, species …)
def _grid_trees(h, e, n=None, fill=None, ids=None):
    h = np.asarray(h, float)
    k = h.size
    return (h, np.zeros(k, bool) if fill is None else np.asarray(fill, bool),
            np.arange(k) + 100 if ids is None else np.asarray(ids), np.asarray(e, float),
            np.zeros(k) if n is None else np.asarray(n, float))


def test_pick_top_orders_by_height_then_id_and_keeps_min_spacing():
    #            0     1     2     3     4     5
    h, fill, ids, e, n = _grid_trees([50.0, 49.0, 48.0, 48.0, 47.0, 46.0], [0, 10, 100, 200, 205, 300],
                                     ids=[9, 8, 7, 3, 2, 1])
    picks, rej = S.pick_top(h, fill, ids, e, n, lambda i: None, count=10, min_spacing_m=20.0)
    # 1 is 10 m from 0 → skipped; 2 and 3 have equal h → lower id (3) first; 4 is 5 m from 3 → skipped
    assert picks == [0, 3, 2, 5] and rej == {"spacing": 2}
    hs = h[picks]
    assert all(a >= b for a, b in zip(hs, hs[1:]))                  # ordering: height descending
    pts = np.c_[e[picks], n[picks]]
    d = np.hypot(*(pts[:, None, :] - pts[None, :, :]).transpose(2, 0, 1))
    assert d[~np.eye(len(picks), dtype=bool)].min() >= 20.0          # min spacing between all listed trees


def test_pick_top_spacing_is_exact_at_the_threshold_and_measured_in_2d():
    h, fill, ids, e, n = _grid_trees([50.0, 49.0, 48.0], [0, 12, 0], n=[0, 16, 19.99])
    picks, rej = S.pick_top(h, fill, ids, e, n, lambda i: None, min_spacing_m=20.0)
    assert picks == [0, 1] and rej == {"spacing": 1}                 # (12, 16) is exactly 20 m: kept


def test_pick_top_first_pick_is_pick_tallest_and_count_limits():
    rng = np.random.default_rng(3)
    h = np.round(rng.uniform(20, 50, 300), 1)
    fill = rng.random(300) < 0.1
    ids = rng.permutation(300)
    e, n = rng.uniform(0, 500, 300), rng.uniform(0, 500, 300)
    bad = set(rng.choice(300, 60, replace=False).tolist())
    check = lambda i: "spike" if i in bad else None  # noqa: E731
    picks, _ = S.pick_top(h, fill, ids, e, n, check, count=10)
    i, _ = S.pick_tallest(h, fill, ids, check)
    assert picks[0] == i and len(picks) == 10
    assert not any(fill[picks]) and not (set(picks) & bad)


def test_pick_top_skips_spacing_without_running_the_check_and_respects_max_checks():
    calls = []
    h, fill, ids, e, n = _grid_trees([50.0, 49.0, 48.0, 47.0], [0, 5, 100, 200])

    def check(i):
        calls.append(i)
        return "terrain" if i == 2 else None
    picks, rej = S.pick_top(h, fill, ids, e, n, check)
    assert picks == [0, 3] and calls == [0, 2, 3] and rej == {"spacing": 1, "terrain": 1}
    picks2, _ = S.pick_top(h, fill, ids, e, n, lambda i: "spike", max_checks=2)
    assert picks2 == []


def test_competition_ranks_share_ties():
    assert S.competition_ranks([45.1, 44.0, 44.0, 43.2]) == [1, 2, 2, 4]
    assert S.competition_ranks([]) == [] and S.competition_ranks([7.0]) == [1]


def test_round_riesen_rounds_and_ranks_on_published_heights():
    rows = [{"h": 50.04, "E": 1.5, "N": 2.5, "id": 1, "in_trees": np.True_, "species": {"key": "douglas_fir", "p": 80}},
            {"h": 49.96, "E": 31.5, "N": 2.5, "id": 2},                  # rounds to 50.0 as well → shared rank 1
            {"h": 49.0, "E": 61.5, "N": 2.5, "id": 3, "in_trees": False}]
    out = S.round_riesen(rows)
    assert [r["rank"] for r in out] == [1, 1, 3] and [r["h"] for r in out] == [50.0, 50.0, 49.0]
    assert out[0] == {"rank": 1, "h": 50.0, "E": 1.5, "N": 2.5, "id": 1, "in_trees": True,
                      "species": {"key": "douglas_fir", "p": 80}}
    assert "species" not in out[1] and out[1]["in_trees"] is False and type(out[0]["in_trees"]) is bool
    q = S.round_place(_raw_place(riesen=rows))
    assert q["riesen"] == out
    assert "riesen" not in S.round_place(_raw_place())


def test_tree_species_entry_omits_no_class_and_weak_classes():
    assert S.tree_species_entry(2, 80) == {"key": "douglas_fir", "p": 80}
    assert S.tree_species_entry(5, 50) == {"key": "beech", "p": 50}
    assert S.tree_species_entry(5, 40) is None and S.tree_species_entry(3, 10) is None   # „unsicher“: left out
    assert S.tree_species_entry(5, 60, tree_type=1) is None             # conifer crown in a broadleaf class
    assert S.tree_species_entry(2, 60, tree_type=2) == {"key": "douglas_fir", "p": 60}  # one-sided rule
    assert S.tree_species_entry(255, 0) is None                         # outside the DLR forest mask
    assert S.tree_species_entry(10, 0) is None                          # canopy loss: no species
    assert S.tree_species_entry(8, 70) is None and S.tree_species_entry(9, 70) is None   # alder / other: weak
    assert S.tree_species_entry(5, 0) is None


def test_species_block_mix_order_rounding_and_coverage():
    # crown radii: beech (5) 2× r=2 → 8π; oak (6) r=2 → 4π; pine (0) r=2 → 4π; no class r=4 → 16π
    code = np.array([5, 5, 6, 0, 255], np.uint8)
    r = np.array([2.0, 2.0, 2.0, 2.0, 4.0])
    b = S.species_block(code, r, min_count=1)
    assert b["mix"] == [{"key": "beech", "share_pct": 50}, {"key": "pine", "share_pct": 25},
                        {"key": "oak", "share_pct": 25}]                 # tie oak/pine → lower class code (pine 0)
    assert b["dominant"] == "beech" and b["method"] == "species-dlr-crown-mix-v1"
    assert b["coverage_pct"] == 50 and b["conifer_pct"] == 25 and b["trees"] == 4
    assert S.species_block(code, r) is None                             # < 5 trees with a species → null
    weak = S.species_block(np.array([5, 8, 9], np.uint8), np.ones(3), min_count=1)
    assert {m["key"]: m.get("weak", False) for m in weak["mix"]} == {"beech": False, "alder": True,
                                                                     "other_broadleaf": True}
    tiny = S.species_block(np.array([5] * 2000 + [6], np.uint8), np.ones(2001), min_count=1)
    assert [m["key"] for m in tiny["mix"]] == ["beech"]                 # 0.05 % rounds to 0 → dropped
    canopy_loss = S.species_block(np.array([10] * 9, np.uint8), np.ones(9), min_count=1)
    assert canopy_loss is None                                          # canopy loss is not a species


def test_biodiversity_block_rounding_and_few_records():
    g = {"id": "x", "occurrences": 1316, "species": 429, "rarefied": [212.0, 226.9, 241.7], "rarefy_n": 500,
         "rarefied_150": [86.5, 96.5, 106.49], "years": {"first": 1990, "last": 2026},
         "inaturalist": {"occurrences": 287, "share_pct": 21.84}, "flags": []}
    b = S.biodiversity_block(g)
    assert b == {"species": 429, "occurrences": 1316, "inat_share_pct": 21.8, "rarefied_500": 227,
                 "rarefied_500_range": [212, 227, 242], "rarefied_150_range": [86, 96, 106],
                 "few_records": False, "years": [1990, 2026]}
    few = S.biodiversity_block({**g, "rarefied": None, "flags": ["few-records"], "occurrences": 326})
    assert few["rarefied_500"] is None and few["rarefied_500_range"] is None and few["few_records"]
    assert S.biodiversity_block(None) is None and S.biodiversity_block({"id": "x"}) is None


def test_forest_blocks_cover_threshold_snapshot_and_age():
    fa = {"trees_with_age": 45491, "age_mid_median": 93, "age_class_share_pct_by_crown":
          {"young": 6.14, "middle": 22.1, "old": 27.2, "very_old": 44.56},
          "forest_continuity": {"covered_crown_pct": 87.94, "forest_all_classified_pct": 48.44}}
    pct, cont, age = S.forest_blocks(fa)
    assert pct == 48.4 and cont == {"covered_pct": 87.9, "epochs": [1935], "snapshot": True}
    assert age == {"trees": 45491, "trees_beyond": None, "median_y": 95,
                   "classes_pct": {"young": 6.1, "middle": 22.1, "old": 27.2, "very_old": 44.6}}   # v1 file: no beyond
    v2 = {**fa, "trees_beyond_tables": 9000, "age_class_share_pct_by_crown":
          {"young": 6.14, "middle": 22.1, "old": 27.2, "very_old": 9.0, "beyond": 35.56}}
    a2 = S.forest_blocks(v2)[2]
    assert a2["trees_beyond"] == 9000 and a2["classes_pct"] == {"young": 6.1, "middle": 22.1, "old": 27.2,
                                                                "very_old": 9.0, "beyond": 35.6}
    low = {**fa, "forest_continuity": {"covered_crown_pct": 6.4, "forest_all_classified_pct": 12.0}}
    pct2, cont2, _ = S.forest_blocks(low)
    assert pct2 is None and cont2["covered_pct"] == 6.4                # mask covers too little → no value
    assert S.forest_blocks(fa, epochs=(1840, 1935))[1]["snapshot"] is False
    assert S.forest_blocks({**fa, "trees_with_age": 3})[2] is None      # minimum count
    assert S.forest_blocks(None) == (None, None, None)


def test_nutzung_block_only_for_known_land_use():
    ok = {"status": "ok", "share_pct": {"forest": 29.04, "agriculture": 46.5, "settlement": 15.66}}
    b = S.nutzung_block(ok)
    assert b["source"] == "alkis" and list(b["shares_pct"]) == list(S.NUTZUNG_GROUPS)
    assert b["shares_pct"]["forest"] == 29 and b["shares_pct"]["settlement"] == 15.7 and b["shares_pct"]["water"] == 0
    assert S.nutzung_block({"status": "pending", "share_pct": None}) is None and S.nutzung_block(None) is None


def test_roof_block_suppression_and_rounding():
    rp = {"buildings": 2293, "suitable_area_m2": 128060, "kwp": [13445.3, 16134.3, 17927.0], "suppressed": []}
    b, sup = S.roof_block(rp)
    assert not sup and b == {"buildings": 2293, "suitable_m2": 128100, "kwp": [13000, 16000, 18000]}
    b2, _ = S.roof_block({**rp, "usable_area_m2": 80164})                # usable = the kWp base (review 2026-11-08)
    assert b2["usable_m2"] == 80200 and b2["suitable_m2"] == 128100
    assert S.roof_block({**rp, "buildings": 4}) == (None, True)          # < 5 buildings → null + suppressed
    assert S.roof_block({**rp, "suppressed": ["kwp"]}) == (None, True)
    assert S.roof_block(None) == (None, False)
    p = S.apply_min_count(_raw_place(suppressed=["roof_potential"], roof_potential=None))
    assert p["suppressed"] == ["roof_potential"]


def test_municipality_roofs_used_share_and_reason():
    rm = {"ags": "07340203", "places": ["bechhofen", "other"], "potential_places_kwp": [11885.9, 14263.0, 15847.8],
          "suitable_area_places_m2": 113199, "missing_gemarkungen": [], "complete": True,
          "used_share_pct": [11.24, 12.36, 14.96]}
    pot, used, why = S.municipality_roofs(rm, {"bechhofen"})
    assert pot == {"places": ["bechhofen"], "suitable_m2": 113200, "kwp": [12000, 14000, 16000], "complete": True}
    assert used == [11.2, 12.4, 15] and why is None
    _, used2, why2 = S.municipality_roofs({**rm, "complete": False, "used_share_pct": None,
                                           "missing_gemarkungen": ["Ixheim", "Rimschweiler"]}, {"bechhofen"})
    assert used2 is None and "2 weitere Gemarkungen" in why2 and "Ixheim" in why2
    _, used3, why3 = S.municipality_roofs({**rm, "complete": False, "used_share_pct": None}, set())
    assert used3 is None and why3.startswith("Nicht alle Gemarkungen")
    assert S.municipality_roofs(None, set()) == (None, None, None)
    S.check_privacy({"r": why2})


def test_goals_baseline_target_and_null_progress():
    q = S.round_place(_raw_place(riesen=[{"h": 40, "E": 1.5, "N": 1.5, "id": i} for i in range(3)]))
    gs = {g["id"]: g for g in S.goals_for(q, 2026)}
    assert list(gs) == ["kronen-ortslage", "entsiegeln", "riesen-bestimmt", "hecke"]
    k = gs["kronen-ortslage"]
    assert k["metric"] == "ortslage.canopy_pct" and k["baseline"] == 32.9 and k["target"] == 34.9
    assert k["baseline_year"] == q["lidar_epoch"] and k["target_year"] == 2030 and k["measured_by"] == "lidar"
    e = gs["entsiegeln"]                       # deed counter 0 → 1,000 m²; context 166.7 ha × 28.5 % = 475 095 m²
    assert e["baseline"] == 0 and e["target"] == 1000 and e["unit"] == "m²" and e["metric"] is None
    assert e["note_de"] == "Zum Vergleich: heute etwa 475.100 m² versiegelt (28,5 % der Ortslage)"
    assert "note_de" not in gs["hecke"]
    assert gs["riesen-bestimmt"]["target"] == 3 and gs["riesen-bestimmt"]["baseline"] == 0
    assert gs["hecke"]["baseline"] is None and gs["hecke"]["target"] is None and gs["hecke"]["target_delta"] == 500
    assert all(g["progress"] is None for g in gs.values())
    bare = S.goals_for(S.round_place(_raw_place(ortslage=None)), 2026)
    assert [g["id"] for g in bare] == ["hecke"]
    S.check_privacy({"goals": list(gs.values())})


def test_phase1_lookups_used_inputs_and_labels():
    ph1 = {"species": {"places": {"a": {"x": 1}}, "generated": "2026-11-08T00:55:32Z",
                       "attribution": "Baumarten: DLR, Tree Species Germany 2022 (Wegler et al. 2025), CC BY 4.0"},
           "gbif": {"places": [{"id": "a"}], "query_date": "2026-11-08",
                    "attribution": ["GBIF.org (2026-11-08) GBIF Occurrence Search, https://www.gbif.org"],
                    "attribution_note_de": "enthält iNaturalist-Beobachtungen"},
           "roofs": {"places": [{"id": "a"}], "municipalities": [{"ags": "1"}]}, "forest_age": None, "nutzung": None}
    by = S.phase1_by_place(ph1)
    assert by["species"] == {"a": {"x": 1}} and by["gbif"] == {"a": {"id": "a"}} and by["roofs_muni"] == {"1": {"ags": "1"}}
    assert by["forest_age"] == {} and by["nutzung"] == {}
    used = S.phase1_used(ph1, [{"species": {"mix": []}, "biodiversity": None, "roof_potential": None}])
    assert set(used) == {"species"}                                     # only sources whose data reached a place
    inp = S.phase1_inputs({**used, "gbif": ph1["gbif"]})
    assert set(inp) == {"species_dlr", "gbif"}
    assert inp["species_dlr"]["licence"] == "CC-BY-4.0" and inp["species_dlr"]["retrieved"] == "2026-11-08"
    assert inp["gbif"]["attribution"].startswith("GBIF.org") and inp["gbif"]["note_de"]
    assert all(";" not in v["attribution"] for v in inp.values())
    lab = S.labels_de(None)
    assert lab["species"]["douglas_fir"] == "Douglasie" and "canopy_loss" not in lab["species"]
    assert list(lab["age_classes"]) == list(S.AGE_CLASSES) and list(lab["nutzung"]) == list(S.NUTZUNG_GROUPS)
    S.check_privacy(lab)


def test_load_phase1_missing_files_are_none(tmp_path):
    (tmp_path / "gbif_by_place.json").write_text('{"places": []}')
    ph1 = S.load_phase1(tmp_path)
    assert ph1["gbif"] == {"places": []} and ph1["species"] is None and set(ph1) == set(S.PHASE1_FILES)
