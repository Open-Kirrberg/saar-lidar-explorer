"""S1 Saarland leaderboard (Gemeinde level): outlines, S1a blocks, S1b streaming aggregation, contract validation."""
from __future__ import annotations

import copy
import sys
from pathlib import Path

import numpy as np
import pytest
from shapely.geometry import box, mapping

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import gemeinde_trees as GT  # noqa: E402
import gemeinden as G  # noqa: E402
import gemeinden_stats as GS  # noqa: E402


# ------------------------------------------------------------------------------------------------ outlines
def feat(ags, name, geom, bez="Gemeinde", ibz=62):
    return {"type": "Feature", "properties": {"ags": ags, "gen": name, "bez": bez, "ibz": ibz},
            "geometry": mapping(geom)}


def test_parse_vg25_keeps_sl_and_neighbours_drops_condominium_and_dissolves():
    fs = [feat("10045114", "Homburg", box(0, 0, 10, 10), "Stadt", 61),
          feat("10045114", "Homburg", box(10, 0, 12, 10), "Stadt", 61),       # second part, same AGS
          feat("10942115", "Kondominium", box(20, 0, 21, 1), "Kondominium", 69),
          feat("07320000", "Zweibrücken", box(-10, 0, 0, 10), "Stadt", 60),
          feat("07340999", "Elsewhere", box(-20, 0, -10, 10))]
    g = G.parse_vg25(fs, keep_ags={"07320000"})
    assert [x["ags"] for x in g] == ["07320000", "10045114"]
    hb = g[1]
    assert hb["id"] == "homburg" and hb["category"] == "stadt" and hb["state"] == "SL"
    assert hb["geom"].area == pytest.approx(120)
    assert g[0]["id"] == "zweibruecken" and g[0]["state"] == "RLP"


def gem(ags, name, geom, state="SL", cat="gemeinde"):
    return {"ags": ags, "id": G.slugify(name), "name_de": name, "state": state, "category": cat, "geom": geom}


def test_check_outlines_passes_and_fails():
    gems = [gem("10000001", "A", box(0, 0, 1000, 1000)), gem("10000002", "B", box(1000, 0, 2000, 1000))]
    r = G.check_outlines(gems, sl_count=2, sl_area_km2=2.0, homburg=None)
    assert r["sl_municipalities"] == 2 and r["overlap_m2"] == 0
    with pytest.raises(ValueError, match="municipalities"):
        G.check_outlines(gems, sl_count=52, sl_area_km2=2.0, homburg=None)
    with pytest.raises(ValueError, match="area"):
        G.check_outlines(gems, sl_count=2, sl_area_km2=5.0, homburg=None)
    bad = gems + [gem("10000003", "C", box(500, 0, 1500, 1000))]
    with pytest.raises(ValueError, match="overlap"):
        G.check_outlines(bad, sl_count=3, sl_area_km2=3.0, tol=0.5, homburg=None)


def test_tiles_and_owner_rule():
    gems = [gem("10000001", "A", box(0, 0, 1400, 1000)), gem("10000002", "B", box(1400, 0, 2000, 1000))]
    assert G.tiles_of(gems[0]["geom"]) == [(0, 0), (1, 0)]
    assert G.tiles_of(gems[1]["geom"]) == [(1, 0)]     # touching (0,0)'s edge only does not count
    own = G.tile_owners(gems)
    assert own["0_0"]["owner"] == "a"
    assert own["1_0"]["owner"] == "b" and own["1_0"]["shares"] == {"a": 400000, "b": 600000}


def test_species_mix_cells():
    codes = np.array([5] * 6 + [0] * 2 + [10] * 2 + [255] * 10, np.uint8)
    r = G.species_mix_cells(codes)
    assert r["forest_pct"] == pytest.approx(50.0)
    assert r["canopy_loss_pct"] == pytest.approx(10.0)
    assert [m["key"] for m in r["mix"]] == ["beech", "pine"]
    assert r["mix"][0]["share_pct"] == pytest.approx(75.0)
    assert r["conifer_pct"] == pytest.approx(25.0)


# ------------------------------------------------------------------------------------------------ S1b
def test_dlr_pseudo_brightness_drives_trees_classify():
    from trees import Params, classify
    b = GT.dlr_pseudo_brightness(np.array([0, 4, 5, 9, 10, 255], np.uint8))
    assert list(classify(b, Params())) == [1, 1, 2, 2, 0, 0]


def synthetic(size=600, margin=GT.MARGIN, seed=3):
    """Window arrays (size + 2·margin)² with crowns, a building block and two Gemeinden (west 1 / east 2)."""
    rng = np.random.default_rng(seed)
    W = size + 2 * margin
    yy, xx = np.mgrid[0:W, 0:W]
    dsm = np.zeros((W, W), np.float32)
    for _ in range(260):
        cy, cx = rng.uniform(0, W, 2)
        h, rad = rng.uniform(8, 30), rng.uniform(2, 6)
        dsm = np.maximum(dsm, (h * np.exp(-((yy - cy) ** 2 + (xx - cx) ** 2) / (2 * rad ** 2))).astype(np.float32))
    dtm = np.zeros_like(dsm)
    bldg = np.zeros((W, W), np.uint8)
    bldg[300:330, 200:240] = 1
    dsm[300:330, 200:240] = 9.0
    state = np.zeros((W, W), np.uint8)
    gem = np.where(xx < W // 2 + 7, 1, 2).astype(np.uint16)   # border not on a tile edge
    return dtm, dsm, state, bldg, gem


def test_streaming_per_tile_equals_whole_window():
    size, tile, m = 600, 200, GT.MARGIN
    dtm, dsm, state, bldg, gem = synthetic(size)
    e0, n0 = 100_000, 200_000
    window = (e0 - m, n0 - m, e0 + size + m, n0 + size + m)
    whole = GT.tile_aggregates(dtm, dsm, state, bldg, None, gem, window, (e0, n0, e0 + size, n0 + size), chunk=100)
    parts = []
    W = size + 2 * m
    for ty in range(size // tile):
        for tx in range(size // tile):
            core = (e0 + tx * tile, n0 + ty * tile, e0 + (tx + 1) * tile, n0 + (ty + 1) * tile)
            win = (core[0] - m, core[1] - m, core[2] + m, core[3] + m)
            r0 = window[3] - win[3]
            c0 = win[0] - window[0]
            sl = (slice(r0, r0 + tile + 2 * m), slice(c0, c0 + tile + 2 * m))
            assert r0 >= 0 and c0 >= 0 and r0 + tile + 2 * m <= W
            parts.append({"gemeinden": GT.tile_aggregates(dtm[sl], dsm[sl], state[sl], bldg[sl], None, gem[sl],
                                                          win, core, chunk=100)})
    summed = GT.merge_tile_sums(parts)
    assert set(summed) == set(whole) == {"1", "2"}
    for gi in whole:
        for k in ("cells", "lidar_cells", "canopy_cells", "ortslage_cells", "ortslage_canopy_cells", "trees", "fill"):
            assert summed[gi][k] == whole[gi][k], (gi, k)
        assert summed[gi]["crown_m2"] == pytest.approx(whole[gi]["crown_m2"])
        assert summed[gi]["agb_kg"] == pytest.approx(whole[gi]["agb_kg"])
        assert summed[gi]["top"] == whole[gi]["top"][:GT.TOP_K]
    assert whole["1"]["trees"] > 20 and whole["1"]["ortslage_cells"] > 0


def test_gemeinde_values_shares():
    s = {"cells": 1_000_000, "lidar_cells": 1_000_000, "rlp_cells": 250_000, "canopy_cells": 400_000,
         "ortslage_cells": 100_000, "ortslage_canopy_cells": 20_000, "trees": 5000, "fill": 0, "conifer": 0,
         "crown_m2": 300_000.0, "agb_kg": 2_000_000.0, "top": []}
    v = GT.gemeinde_values(s)
    assert v["crown_pct"] == pytest.approx(30.0) and v["ortslage_canopy_pct"] == pytest.approx(20.0)
    assert v["ortslage_area_ha"] == pytest.approx(10.0) and v["rlp_pct"] == pytest.approx(25.0)
    assert v["agb_t"][1] == pytest.approx(2000.0)


# ------------------------------------------------------------------------------------------------ publish
def test_discipline_ready_rule():
    st = [{"a": "ready", "b": "pending", "c": "none"}, {"a": "ready", "b": "ready", "c": "ready"}]
    assert GS.discipline_ready(st, ("a", "b", "c")) == {"a": True, "b": False, "c": True}
    assert GS.discipline_ready([], ("a",)) == {"a": False}


def test_tree_fields_pending_and_rounding():
    assert all(v is None for v in GS.tree_fields(None, 1000).values())
    v = {"trees": 12345, "crown_ha": 1234.56, "crown_pct": 33.333, "agb_t": [5000.0, 10000.0, 20000.0],
         "co2_t": [9000.0, 18000.0, 36000.0], "ortslage_canopy_pct": 12.345, "ortslage_area_ha": 99.94}
    f = GS.tree_fields(v, 4321)
    assert f["crown_pct"] == 33.3 and f["trees_per_inhabitant"] == 2.9 and f["ortslage_area_ha"] == 99.9


def minimal_doc():
    disc = GS.disciplines({"waldanteil": True})
    states = {d["id"]: ("ready" if d["id"] == "waldanteil" else "pending") for d in disc}
    place = {"id": "homburg", "name_de": "Homburg", "kind": "gemeinde", "ags": "10045114", "state": "SL",
             "municipality": "homburg", "category": "stadt", "status": "building", "flags": [],
             "discipline_state": states, "tallest": None, "ortslage": None}
    return ({"format": "sle-stats-v1", "version": 1, "level": "gemeinde", "places": [place],
             "municipalities": [{"id": "homburg"}], "disciplines": disc},
            [{"type": "Feature", "properties": {"id": "homburg", "name_de": "Homburg"}, "geometry": None}])


def test_validate_accepts_and_rejects():
    doc, feats = minimal_doc()
    GS.validate(doc, feats)
    bad = copy.deepcopy(doc)
    bad["disciplines"][1]["ready"] = True          # ready while the place is pending
    with pytest.raises(ValueError, match="pending"):
        GS.validate(bad, feats)
    bad = copy.deepcopy(doc)
    bad["places"][0]["state"] = "RLP"              # RLP without other-flight
    with pytest.raises(ValueError, match="other-flight"):
        GS.validate(bad, feats)
    bad = copy.deepcopy(doc)
    bad["places"][0]["status"] = "unknown"
    with pytest.raises(ValueError, match="kind/status"):
        GS.validate(bad, feats)
    bad = copy.deepcopy(doc)
    bad["places"][0]["flurstueck"] = "x"           # privacy guard
    with pytest.raises(ValueError, match="forbidden key"):
        GS.validate(bad, feats)


def test_species_cells_block():
    d = {"class_cells": 80, "loss_cells": 20, "conifer_pct": 25.0,
         "mix": [{"key": "beech", "share_pct": 75.04}, {"key": "alder", "share_pct": 24.96, "weak": True}]}
    b = GS.species_cells_block(d)
    assert b["dominant"] == "beech" and b["coverage_pct"] == 80.0 and b["mix"][1]["weak"] is True
    assert GS.species_cells_block({"class_cells": 2, "mix": [{"key": "oak", "share_pct": 100}]}) is None


def test_saarland_plan_uses_stats_steps_and_refuses_tile_steps(tmp_path):
    import common
    toml = tmp_path / "aois.toml"
    toml.write_text('[defaults]\nbuffer_m = 200\ncounty = "SPK"\nchunk_size = 500\n\n'
                    '[saarland]\nname = "x"\nbbox = [0, 0, 1000, 1000]\nstats_only = true\n'
                    'stats_steps = ["gemeinden", "gemeinde-trees", "gemeinden-stats"]\n')
    assert common.plan_steps("saarland", path=toml) == [("gemeinden", "saarland"), ("gemeinde-trees", "saarland"),
                                                       ("gemeinden-stats", "saarland")]
    with pytest.raises(SystemExit):
        common.plan_steps("saarland", ["build"], path=toml)


def test_gemeinde_tree_count_excludes_fill():
    """ADR 0051: the Gemeinde tree count is measured tops only; crowns keep the fill trees."""
    s = {"cells": 1_000_000, "lidar_cells": 1_000_000, "rlp_cells": 0, "canopy_cells": 300_000,
         "ortslage_cells": 100_000, "ortslage_canopy_cells": 20_000, "trees": 5000, "fill": 1200, "conifer": 2000,
         "crown_m2": 250_000.0, "agb_kg": 1e6}
    v = GT.gemeinde_values(s)
    assert v["trees"] == 3800
    assert v["crown_ha"] == 25.0
