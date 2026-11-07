"""Orte im Vergleich: stats-area trees (`stats_trees.py`) — tiling, apron, seam merge, aggregation helpers.

All synthetic, no network and no data files."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import AOI  # noqa: E402
from stats_trees import (BLOCK, CHUNK, MARGIN, TILE, TileSet, TreeArrays, block_windows, cell_metrics,  # noqa: E402
                         compare_tiles, detect_window, dop_mode, merge_trees, overlap_slices, parse_tiles_needed,
                         rlp_lod2_tiles, summarize, tile_code, tile_of, tiles_in, to_global)
from trees import APRON, FILL, Params, detect  # noqa: E402

E0, N0 = 381000, 5465000


def _cones(shape, peaks):
    rr, cc = np.mgrid[:shape[0], :shape[1]]
    z = np.zeros(shape, np.float32)
    for r, c, h, rad in peaks:
        z = np.maximum(z, h * np.clip(1 - np.hypot(rr - r, cc - c) / rad, 0, None))
    return z


def _domes(shape, peaks):
    """Smooth Gaussian domes (conifer blobs that the fill splits)."""
    rr, cc = np.mgrid[:shape[0], :shape[1]]
    z = np.zeros(shape, np.float32)
    for r, c, h, s in peaks:
        z = np.maximum(z, (h * np.exp(-((rr - r) ** 2 + (cc - c) ** 2) / (2 * s * s))).astype(np.float32))
    return z


def _forest(n=800, seed=11):
    rng = np.random.default_rng(seed)
    k = 1400
    cones = [(int(r), int(c), float(h), float(rad)) for r, c, h, rad in
             zip(rng.integers(0, n, k), rng.integers(0, n, k), rng.uniform(4, 38, k), rng.uniform(2, 7, k))]
    # crowns exactly on block (200) and chunk (100) seams, and on the raster edge
    cones += [(200, 200, 30.0, 6.0), (199, 400, 25.0, 5.0), (400, 599, 28.0, 7.0), (0, 300, 20.0, 5.0),
              (600, 100, 22.0, 4.0), (100, 600, 26.0, 6.0)]
    domes = [(200, 300, 27.0, 8.0), (401, 200, 25.0, 9.0), (300, 400, 26.0, 8.0), (600, 599, 24.0, 9.0)]
    dtm = np.full((n, n), 250.0, np.float32) + np.linspace(0, 30, n, dtype=np.float32)[None, :]
    chm = np.maximum(_cones((n, n), cones), _domes((n, n), domes))
    ortho = np.full((3, n, n), 120, np.uint8)
    ortho[:, :, : n // 2] = 50          # west half dark → conifer → fill trees, east half broadleaf
    return dtm, dtm + chm, ortho


def _global_ref(dsm, dtm, ortho, aoi, p):
    res = detect(dsm, dtm, None, ortho, aoi, p, workers=1)
    parts = []
    for t in res.values():
        parts.append(to_global(t, (aoi.e0, aoi.n0, aoi.e1, aoi.n1)))
    a = TreeArrays.concat(parts)
    return a.take(np.lexsort((a.e, -a.n)))


def _blockwise(dsm, dtm, ortho, p, chunk, block, margin):
    n = dsm.shape[0]
    parts = []
    for r0 in range(0, n, block):
        for c0 in range(0, n, block):
            wr0, wr1 = max(0, r0 - margin), min(n, r0 + block + margin)   # clipped like the raster edge of a global run
            wc0, wc1 = max(0, c0 - margin), min(n, c0 + block + margin)
            t, _chm = detect_window(dsm[wr0:wr1, wc0:wc1], dtm[wr0:wr1, wc0:wc1], None,
                                    ortho[:, wr0:wr1, wc0:wc1], (r0 - wr0, r0 - wr0 + block),
                                    (c0 - wc0, c0 - wc0 + block), p, chunk=chunk)
            window = (E0 + wc0, N0 + n - wr1, E0 + wc1, N0 + n - wr0)
            parts.append(to_global(t, window))
    return merge_trees(parts, p.min_height, p.max_height)


def _key(a):
    return a.e * 100_000_000 + a.n


# --------------------------------------------------------------------------------------------- tiling helpers

def test_parse_tiles_needed_repr_and_dict():
    meta = {"tiles_needed_list": "{'SL': [[377, 5456], [378, 5456]], 'RLP': [[378, 5456], [380, 5454]]}"}
    t = parse_tiles_needed(meta)
    assert t == {"SL": [(377, 5456), (378, 5456)], "RLP": [(378, 5456), (380, 5454)]}
    assert parse_tiles_needed({"tiles_needed_list": {"SL": [[1, 2]]}}) == {"SL": [(1, 2)]}
    assert parse_tiles_needed({}) == {}


def test_tileset_is_a_fetch_aoi():
    ts = TileSet("orte", "SPK", ((380, 5460), (381, 5460)), (375000, 5453000, 387000, 5471000))
    assert ts.tiles(buffered=True) == [(380, 5460), (381, 5460)] == ts.tiles(buffered=False)
    assert ts.county == "SPK" and ts.key == "orte"


def test_block_windows_on_global_grid_cover_all_tiles():
    tiles = [(375, 5457), (376, 5457), (377, 5458), (386, 5470), (380, 5460)]
    bw = block_windows(tiles)
    assert BLOCK % CHUNK == 0 and MARGIN >= APRON + 3 + 4 + 3
    cores = [c for c, _ in bw]
    for core, win in bw:
        assert all(v % BLOCK == 0 for v in core) and core[2] - core[0] == BLOCK == core[3] - core[1]
        assert win == (core[0] - MARGIN, core[1] - MARGIN, core[2] + MARGIN, core[3] + MARGIN)
    for e, n in tiles:  # every tile lies in exactly one core
        hits = [c for c in cores if c[0] <= e * TILE < c[2] and c[1] <= n * TILE < c[3]]
        assert len(hits) == 1
    assert len(set(cores)) == len(cores) == 5   # 375 → 374–376 km, 376/377 → 376–378 km (two rows), 380, 386
    # north-to-south order (row 0 = north), then west to east
    assert [c[1] for c in cores] == sorted([c[1] for c in cores], reverse=True)


def test_overlap_slices_and_tiles_in():
    window = (999_936, 4_999_936, 1_002_064, 5_002_064)  # 2 km block + 64 m margin
    (wr, wc), (sr, sc) = overlap_slices(window, (1_000_000, 5_001_000, 1_001_000, 5_002_000))
    assert (wr.start, wr.stop, wc.start, wc.stop) == (64, 1064, 64, 1064)
    assert (sr.start, sr.stop, sc.start, sc.stop) == (0, 1000, 0, 1000)
    (wr, wc), (sr, sc) = overlap_slices(window, (999_000, 5_002_000, 1_000_000, 5_003_000))  # NW neighbour tile
    assert (wr.start, wr.stop, wc.start, wc.stop) == (0, 64, 0, 64) and (sr.start, sr.stop) == (936, 1000)
    assert (sc.start, sc.stop) == (936, 1000)
    assert overlap_slices(window, (1_003_000, 5_000_000, 1_004_000, 5_001_000)) is None
    assert len(tiles_in(window)) == 16 and (999, 4999) in tiles_in(window) and (1002, 5002) in tiles_in(window)


def test_tile_codes():
    assert int(tile_code(380, 5460)) == 38005460
    e = np.array([380000, 380999, 381000, 379999])
    n = np.array([5460000, 5460999, 5460000, 5461000])
    assert tile_of(e, n).tolist() == [38005460, 38005460, 38105460, 37905461]


def test_rlp_lod2_tiles_two_km_even():
    need = [(380, 5454), (381, 5455), (383, 5457), (390, 5460)]
    avail = {(380, 5454), (382, 5456), (384, 5456)}
    assert rlp_lod2_tiles(need, avail) == [(380, 5454), (382, 5456)]


def test_dop_mode():
    assert dop_mode(np.full((4, 4), 255, np.uint8)) == "sl"
    assert dop_mode(np.zeros((4, 4), np.uint8)) == "rlp"
    a = np.zeros((4, 4), np.uint8)
    a[0, 0] = 255
    assert dop_mode(a) == "mixed"


# --------------------------------------------------------------------------------------------- seams

def test_blockwise_detection_equals_single_run():
    """Blocks + apron + merge reproduce one trees.detect run over the whole raster, conifer fill included."""
    n, chunk, block = 800, 100, 200
    dtm, dsm, ortho = _forest(n)
    aoi = AOI("t", "T", E0, N0, E0 + n, N0 + n, 100, "x", chunk)
    p = Params()
    ref = _global_ref(dsm, dtm, ortho, aoi, p)
    new = _blockwise(dsm, dtm, ortho, p, chunk, block, MARGIN)
    assert ref.e.size > 1000 and ((ref.type & FILL) > 0).sum() > 20   # dense, with fill trees
    assert np.array_equal(_key(ref), _key(new))
    assert np.array_equal(ref.type, new.type)
    meas = (ref.type & FILL) == 0
    for f in ("h", "r", "g"):
        assert np.array_equal(getattr(ref, f)[meas], getattr(new, f)[meas]), f
    # fill trees on the same cell may come from a different chunk window: same cell + type, radius within 1 m
    assert np.abs(ref.r[~meas] - new.r[~meas]).max() <= 1.0
    assert np.unique(_key(new)).size == new.e.size   # one tree per cell across block seams


def test_without_apron_seams_break():
    """Control: the same blocks without the margin truncate crowns at block seams (so the test above is sensitive)."""
    n, chunk, block = 800, 100, 200
    dtm, dsm, ortho = _forest(n)
    aoi = AOI("t", "T", E0, N0, E0 + n, N0 + n, 100, "x", chunk)
    p = Params()
    ref = _global_ref(dsm, dtm, ortho, aoi, p)
    new = _blockwise(dsm, dtm, ortho, p, chunk, block, 0)
    same = np.array_equal(_key(ref), _key(new)) and np.array_equal(ref.r, new.r)
    assert not same


def test_merge_prefers_measured_top_and_filters_height():
    def ta(e, n, h, typ):
        k = len(e)
        return TreeArrays(np.array(e, np.int64), np.array(n, np.int64), np.zeros(k), np.array(h, float),
                          np.ones(k), np.array(typ, np.uint8), np.full(k, np.nan), np.zeros(k, np.uint8))
    a = ta([10, 11, 12], [5, 5, 5], [10.0, 12.0, 50.0], [1 | FILL, 1, 2])   # 12/5: 50 m → dropped (pylon)
    b = ta([10, 11, 13], [5, 5, 6], [11.0, 9.0, 2.0], [1, 1 | FILL, 2])     # 13/6: 2 m → dropped
    m = merge_trees([a, b], 3.0, 45.0)
    got = {(int(e), int(n)): (float(h), int(t)) for e, n, h, t in zip(m.e, m.n, m.h, m.type)}
    assert got == {(10, 5): (11.0, 1), (11, 5): (12.0, 1)}
    assert merge_trees([TreeArrays.empty()], 3, 45).e.size == 0


def test_stats_height_cap_keeps_tall_tops_up_to_the_chm_clip():
    import stats_trees as ST
    from trees import smooth_chm
    assert ST.STATS_MAX_HEIGHT > Params().max_height          # stats keep 45–60 m tops; stats.py checks them
    dsm, dtm = np.full((3, 3), 400.0, np.float32), np.zeros((3, 3), np.float32)
    assert smooth_chm(dsm, dtm, None, Params())[0].max() == ST.STATS_MAX_HEIGHT   # = the CHM clip
    t = TreeArrays(np.array([1, 2], np.int64), np.array([1, 1], np.int64), np.zeros(2), np.array([52.0, 30.0]),
                   np.ones(2), np.array([1, 2], np.uint8), np.full(2, np.nan), np.zeros(2, np.uint8))
    assert merge_trees([t], 3.0, ST.STATS_MAX_HEIGHT).e.size == 2
    assert merge_trees([t], 3.0, Params().max_height).e.size == 1


def test_to_global_axis_and_corner():
    from trees import Trees
    t = Trees(row=np.array([0, 9]), col=np.array([0, 4]), g=np.zeros(2), h=np.array([5.0, 6.0]), r=np.ones(2),
              type=np.zeros(2, np.uint8), bright=np.zeros(2))
    st = np.zeros((10, 10), np.uint8)
    st[9, 4] = 1
    a = to_global(t, (1000, 2000, 1010, 2010), st)
    assert a.e.tolist() == [1000, 1004] and a.n.tolist() == [2009, 2000] and a.state.tolist() == [0, 1]


# --------------------------------------------------------------------------------------------- aggregation

def test_cell_metrics_and_summary():
    chm = np.zeros((100, 100), np.float32)
    chm[:50, :50] = 20.0      # NW cell: full canopy
    chm[:50, 50:75] = 10.0    # NE cell: half canopy
    valid = np.ones_like(chm, bool)
    valid[50:, :] = False     # south half: no data
    bldg = np.zeros_like(chm, np.uint8)
    box = (0, 0, 100, 100)
    t = TreeArrays(np.array([10, 20, 60, 60]), np.array([90, 80, 70, 10]), np.zeros(4), np.array([20.0, 18.0, 10.0, 9.0]),
                   np.array([3.0, 5.0, 2.0, 2.0]), np.array([2, 1 | FILL, 2, 2], np.uint8), np.full(4, np.nan),
                   np.zeros(4, np.uint8))
    m = cell_metrics(chm, valid, bldg, t, box, 50)
    assert m["valid"].tolist() == [[1.0, 1.0], [0.0, 0.0]]
    assert m["cover"][0].tolist() == [1.0, 0.5]
    assert m["trees"].tolist() == [[2, 1], [0, 1]] and m["measured"][0, 0] == 1
    assert m["canopy_ha"][0, 0] == pytest.approx(0.25)
    s = summarize(m, np.array([[True, False], [False, False]]))
    assert s["trees"] == 2 and s["trees_per_ha_canopy"] == pytest.approx(8.0)
    assert s["mean_crown_radius_m"] == pytest.approx(4.0) and s["conifer_share"] == pytest.approx(0.5)
    assert summarize(m, np.zeros((2, 2), bool)) == {"cells": 0}


def test_compare_tiles_counts_and_matches():
    def ta(e, n, h):
        k = len(e)
        return TreeArrays(np.array(e, np.int64), np.array(n, np.int64), np.zeros(k), np.array(h, float), np.ones(k),
                          np.zeros(k, np.uint8), np.full(k, np.nan), np.zeros(k, np.uint8))
    ref = ta([1000, 1001, 1500, 2100], [5000, 5000, 5000, 5000], [10, 11, 12, 13])
    new = ta([1000, 1001, 1500, 1502, 2100, 2101], [5000, 5000, 5000, 5000, 5000, 5000], [10, 11, 12.5, 7, 13, 9])
    r = compare_tiles(ref, new, (1000, 5000, 2000, 6000))   # 2100 lies outside the box
    assert r["ref_count"] == 3 and r["new_count"] == 4 and r["same_cell"] == 3
    assert r["tiles"] == [{"tile": "1_5", "ref": 3, "new": 4, "delta_pct": pytest.approx(33.333)}]
    assert r["same_cell_h_equal_cm"] == pytest.approx(2 / 3, abs=1e-4)
    assert r["tiles_over_2pct"] and r["max_abs_tile_delta_pct"] == pytest.approx(33.333)


# --------------------------------------------------------------------------------------------- RLP DOP colour

def test_rlp_rgba_fix_masks_white_and_calibrates_linearly():
    from stats_trees import rlp_rgba_fix
    a = np.zeros((2, 2, 4), np.uint8)
    a[..., 3] = 255
    a[0, 0, :3] = 255                      # WMS background outside RLP imagery
    a[0, 1, :3] = (40, 60, 80)
    a[1, 0, :3] = 250                      # bright but not pure white: kept
    out = rlp_rgba_fix(a, (1.5, 10.0))
    assert out[0, 0, 3] == 0 and out[0, 1, 3] == 255 and out[1, 0, 3] == 255
    assert out[0, 1, :3].tolist() == [70, 100, 130]          # 1.5·b + 10 per band → crown mean maps the same way
    assert out[1, 0, :3].tolist() == [255, 255, 255]         # clipped
    assert rlp_rgba_fix(a, None)[0, 1, :3].tolist() == [40, 60, 80]
    assert a[0, 0, 3] == 255                                 # input untouched


def test_moment_fit_and_calibration_report():
    from stats_trees import fit_calibration, moment_fit
    rng = np.random.default_rng(5)
    sl = np.concatenate([rng.normal(55, 4, 300), rng.normal(95, 12, 2700)])   # conifer tail + broadleaf
    rlp = (sl - 30) / 1.2 + rng.normal(0, 2, sl.size)                         # darker, compressed, noisy
    k, c = moment_fit(sl, rlp)
    assert np.mean(k * rlp + c) == pytest.approx(sl.mean()) and np.std(k * rlp + c) == pytest.approx(sl.std())
    pairs = {"a": (sl[:1500], rlp[:1500]), "b": (sl[1500:], rlp[1500:]), "tiny": (sl[:10], rlp[:10])}
    r = fit_calibration(pairs, Params())
    assert r["ok"] and set(r["tiles"]) == {"a", "b"}           # tiles with < 200 crowns are ignored
    assert r["type_agree_raw"] < 0.3 < 0.85 < r["type_agree_fit"]
    assert r["type_agree_leave_one_tile_out"] > 0.8
    assert r["conifer_recall_fit"] >= r["least_squares"]["conifer_recall"]
    assert fit_calibration({}, Params()) == {"ok": False, "reason": "no tile with enough crowns in both DOPs"}


def test_german_number_format():
    from stats_trees import _de
    assert _de(-0.384) == "−0,4" and _de(19.94, 0) == "+20" and _de(56.2, 0, sign=False) == "56"
