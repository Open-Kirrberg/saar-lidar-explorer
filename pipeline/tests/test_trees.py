"""V2.4 trees layer (`trees.py`, contract "Trees", sle-trees-v1)."""
from __future__ import annotations

import json
import sys
import tomllib
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import AOI, APP_DATA  # noqa: E402
from trees import (FILL, FORMAT, HEADER, MAGIC, RECORD, TYPE_CODES, Params, chunk_origin, classify,  # noqa: E402
                   decode_chunk, detect, encode_all, encode_chunk, find_tops, fmix32, tree_ids)

E0, N0 = 381000, 5465000
SMALL = AOI("t", "Test", E0, N0, E0 + 1000, N0 + 1000, 100, "x", 500)  # 2 × 2 chunks


def _cone(shape, peaks):
    """DSM − DTM = sum of cones (row, col, height, radius); row 0 = north."""
    rr, cc = np.mgrid[:shape[0], :shape[1]]
    z = np.zeros(shape, np.float32)
    for r, c, h, rad in peaks:
        z = np.maximum(z, h * np.clip(1 - np.hypot(rr - r, cc - c) / rad, 0, None))
    return z


def _decode_en(aoi, i, j, buf):
    g_base, rec = decode_chunk(buf)
    e_ll, n_ll = chunk_origin(aoi, i, j)
    return e_ll + rec["x"] / 10, n_ll + rec["y"] / 10, g_base, rec


# --------------------------------------------------------------------------- encoding

def test_layout_matches_contract():
    assert HEADER.size == 16 and RECORD.itemsize == 10 and MAGIC == b"SLET"
    assert [RECORD.fields[f][1] for f in ("x", "y", "g", "h", "r", "type")] == [0, 2, 4, 6, 8, 9]


def test_encode_decode_roundtrip():
    rng = np.random.default_rng(3)
    n = 2000
    x, y = rng.integers(0, 500, n) * 10 + 5, rng.integers(0, 500, n) * 10 + 5
    g, h, r = rng.uniform(230, 400, n), rng.uniform(3, 45, n), rng.uniform(0.6, 12, n)
    t = rng.choice([0, 1, 2, 1 | FILL], n).astype(np.uint8)
    ids = tree_ids(E0 + x // 10, N0 + y // 10)
    buf, g_base = encode_chunk(x, y, g, h, r, t, ids)
    assert len(buf) == 16 + 10 * n
    gb, rec = decode_chunk(buf)
    assert gb == pytest.approx(g_base) and g_base <= g.min() < g_base + 0.01
    order = np.argsort(fmix32(ids), kind="stable")
    assert np.array_equal(rec["x"], x[order]) and np.array_equal(rec["y"], y[order])
    assert np.abs(gb + rec["g"] / 100 - g[order]).max() <= 0.005 + 1e-4  # f32 gBase
    assert np.abs(rec["h"] / 100 - h[order]).max() <= 0.005 + 1e-9
    assert np.abs(rec["r"] / 10 - r[order]).max() <= 0.05 + 1e-9
    assert np.array_equal(rec["type"], t[order])
    # LOD order: ascending fmix32 of the derived id
    rid = tree_ids(E0 + rec["x"].astype(np.int64) // 10, N0 + rec["y"].astype(np.int64) // 10)
    assert np.all(np.diff(fmix32(rid).astype(np.int64)) >= 0)


@pytest.mark.parametrize("bad", [b"XXXX", "version", "size"])
def test_decode_rejects_bad_chunks(bad):
    buf = bytearray(encode_chunk(np.array([5]), np.array([5]), np.array([300.0]), np.array([10.0]),
                                 np.array([2.0]), np.array([1], np.uint8), np.array([1], np.uint32))[0])
    if bad == "version":
        buf[4] = 2
    elif bad == "size":
        buf += b"\0"
    else:
        buf[:4] = bad
    with pytest.raises(ValueError):
        decode_chunk(bytes(buf))


def test_fmix32_bijective_sample_and_reference():
    x = np.arange(200_000, dtype=np.uint32)
    assert np.unique(fmix32(x)).size == x.size
    assert int(fmix32(np.array([0]))[0]) == 0
    # reference from the contract's JS formula (Math.imul), computed by hand in Python ints
    v = 0x12345678
    v ^= v >> 16; v = (v * 0x85EBCA6B) & 0xFFFFFFFF; v ^= v >> 13; v = (v * 0xC2B2AE35) & 0xFFFFFFFF; v ^= v >> 16
    assert int(fmix32(np.array([0x12345678]))[0]) == v


def test_ids_from_cell_corner():
    assert int(tree_ids(np.array([381234]), np.array([5466789]))[0]) == ((381234 % 65536) << 16) | (5466789 % 65536)


# --------------------------------------------------------------------------- detection geometry

def test_peak_lands_on_its_cell_centre_no_flip():
    """A single cone at AOI cell (row 123, col 777) → exactly E0 + 777.5, N0 + 1000 − 123.5, chunk (1, 0)."""
    dtm = np.full((1000, 1000), 300.0, np.float32)
    dtm[:, :] += np.arange(1000, dtype=np.float32)[None, :] * 0.01  # tilted ground: g must follow the column
    dsm = dtm + _cone(dtm.shape, [(123, 777, 20.0, 4.0)])
    res = detect(dsm, dtm, None, None, SMALL, Params(fill=False), workers=1)
    assert list(res) == [(1, 0)]
    (i, j), buf = next(iter(encode_all(SMALL, res).items()))
    e, n, g_base, rec = _decode_en(SMALL, i, j, buf)
    assert (e[0], n[0]) == (E0 + 777.5, N0 + 1000 - 123.5)
    assert rec["x"][0] % 10 == 5 and rec["y"][0] % 10 == 5
    assert g_base + rec["g"][0] / 100 == pytest.approx(300 + 7.77, abs=0.01)
    assert rec["h"][0] / 100 == pytest.approx(20.0, abs=0.05)
    assert 1.0 < rec["r"][0] / 10 < 4.0


def test_chunk_south_edge_and_y_north():
    """Cone in the last row band of chunk (0, 1): y counts north from the chunk's south edge (N0)."""
    dtm = np.zeros((1000, 1000), np.float32)
    dsm = _cone(dtm.shape, [(990, 10, 12.0, 4.0)])
    res = detect(dsm, dtm, None, None, SMALL, Params(fill=False), workers=1)
    (i, j), buf = next(iter(encode_all(SMALL, res).items()))
    assert (i, j) == (0, 1)
    e, n, _, rec = _decode_en(SMALL, i, j, buf)
    assert (e[0], n[0]) == (E0 + 10.5, N0 + 9.5) and rec["y"][0] == 95


def test_plateau_yields_one_top_lowest_flat_index():
    sm = np.zeros((20, 20), np.float32)
    sm[5:8, 5:9] = 10.0
    r, c = find_tops(sm, Params())
    assert list(zip(r.tolist(), c.tolist())) == [(5, 5)]


def test_min_height_and_buildings():
    dtm = np.zeros((1000, 1000), np.float32)
    dsm = _cone(dtm.shape, [(100, 100, 2.5, 3.0), (300, 300, 15.0, 4.0), (600, 600, 15.0, 4.0), (800, 200, 52.0, 4.0)])
    bldg = np.zeros_like(dtm, np.uint8)
    bldg[598:603, 598:603] = 1
    res = detect(dsm, dtm, bldg, None, SMALL, Params(fill=False), workers=1)
    rows = sorted(int(rw) for t in res.values() for rw in t.row)
    assert rows == [300]  # < 3 m dropped, building dropped, > 45 m (pylon) dropped


def test_stable_across_runs_and_workers():
    rng = np.random.default_rng(7)
    peaks = [(int(r), int(c), float(h), float(rad)) for r, c, h, rad in
             zip(rng.integers(5, 995, 400), rng.integers(5, 995, 400), rng.uniform(4, 35, 400), rng.uniform(2, 6, 400))]
    dtm = np.full((1000, 1000), 250.0, np.float32)
    dsm = dtm + _cone(dtm.shape, peaks)
    ortho = np.full((3, 1000, 1000), 50, np.uint8)  # dark → conifer → fill active
    a = encode_all(SMALL, detect(dsm, dtm, None, ortho, SMALL, Params(), workers=1))
    b = encode_all(SMALL, detect(dsm, dtm, None, ortho, SMALL, Params(), workers=4))
    assert a == b and sum(len(v) for v in a.values()) > 16 * len(a)
    ids = np.concatenate([tree_ids(*(np.floor(x).astype(np.int64) for x in _decode_en(SMALL, i, j, buf)[:2]))
                          for (i, j), buf in a.items()])
    assert np.unique(ids).size == ids.size  # one tree per cell, ids unique


def test_conifer_fill_splits_blob_and_flags():
    """One broad smooth conifer dome (25 m, crown ≈ 300 m²) → several trees, all but the measured top FILL."""
    rr, cc = np.mgrid[:1000, :1000]
    dtm = np.zeros((1000, 1000), np.float32)
    dsm = (25.0 * np.exp(-((rr - 250) ** 2 + (cc - 250) ** 2) / (2 * 8.0 ** 2))).astype(np.float32)
    ortho = np.full((3, 1000, 1000), 50, np.uint8)
    t = detect(dsm, dtm, None, ortho, SMALL, Params(), workers=1)[(0, 0)]
    base = t.type & 0x7F
    assert np.all(base == TYPE_CODES["conifer"])
    assert (t.type & FILL == 0).sum() == 1 and (t.type & FILL > 0).sum() >= 3
    top = np.nonzero(t.type & FILL == 0)[0][0]
    assert (t.row[top], t.col[top]) == (250, 250) and t.h.max() <= 25.0 + 1e-3
    off = detect(dsm, dtm, None, np.full((3, 1000, 1000), 120, np.uint8), SMALL, Params(), workers=1)[(0, 0)]
    assert off.row.size == 1 and off.type[0] == TYPE_CODES["broadleaf"]  # broadleaf is never filled


def test_classify_thresholds():
    p = Params()
    t = classify(np.array([40.0, 62.0, 70.0, 74.0, 90.0, np.nan]), p)
    assert t.tolist() == [1, 0, 0, 0, 2, 0]


# --------------------------------------------------------------------------- generated data

_KNOWN = set(tomllib.loads((Path(__file__).resolve().parents[1] / "aois.toml").read_text())) - {"defaults"}
AOIS = sorted(k for k in _KNOWN if (APP_DATA / k / "manifest.json").exists()
              and "trees" in json.loads((APP_DATA / k / "manifest.json").read_text()))


@pytest.mark.skipif(not AOIS, reason="no AOI with generated trees")
@pytest.mark.parametrize("aoi", AOIS)
def test_generated_trees(aoi):
    m = json.loads((APP_DATA / aoi / "manifest.json").read_text())
    t = m["trees"]
    assert t["format"] == FORMAT and "{i}" in t["path"] and "{j}" in t["path"]
    nx, ny = m["chunks"]["nx"], m["chunks"]["ny"]
    E0_, N0_, H = m["origin"]["E0"], m["origin"]["N0"], m["size"]["height"]
    total = 0
    for i, j, count in t["chunks"]:
        assert 0 <= i < nx and 0 <= j < ny and count >= 1
        buf = (APP_DATA / aoi / t["path"].replace("{i}", str(i)).replace("{j}", str(j))).read_bytes()
        _, rec = decode_chunk(buf)
        assert rec.size == count
        assert rec["x"].max() <= 5000 and rec["y"].max() <= 5000 and np.all(rec["x"] % 10 == 5)
        e = E0_ + i * 500 + rec["x"] / 10
        n = N0_ + H - (j + 1) * 500 + rec["y"] / 10
        b = t["bounds"]
        assert e.min() >= b[0] and n.min() >= b[1] and e.max() <= b[2] and n.max() <= b[3]
        assert np.all(rec["h"] >= 300) and np.all(rec["h"] <= 4500)
        assert np.all(np.isin(rec["type"] & 0x7F, [0, 1, 2]))
        total += count
    assert total == t["count"] == sum(t["counts"].values())
    assert "DOP20" in m["attribution"] or t["inputs"]["ortho"] is None
