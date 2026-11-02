"""F16 point clouds (`pointcloud.py`, contract "Point clouds", sle-pts-v1)."""
from __future__ import annotations

import json
import re
import struct
import sys
import tomllib
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import APP_DATA, WORK_DIR, load_aoi  # noqa: E402
from pointcloud import (CLASS_LABELS_DE, HEADER, RECORD, TILE_SIZE, FocusArea, areas_for_aoi, clip_mask,  # noqa: E402
                        decode_tile, encode_tile, intensity_u8, parse_areas, previous_entry, tile_index,
                        tile_permutation, write_area)

AOIS_TOML = Path(__file__).resolve().parents[1] / "aois.toml"


def _random_tile(n=5000, seed=1):
    rng = np.random.default_rng(seed)
    x = rng.integers(0, TILE_SIZE * 100, n)
    y = rng.integers(0, TILE_SIZE * 100, n)
    z = rng.integers(28_000, 40_000, n)  # true heights in cm
    agl = rng.integers(-500, 4000, n)
    cls = rng.choice([1, 2, 6, 20, 24, 30], n).astype(np.uint8)
    inten = rng.integers(0, 256, n).astype(np.uint8)
    return x, y, z, agl, cls, inten


def test_header_and_record_layout():
    assert HEADER.size == 16 and RECORD.itemsize == 10
    assert [RECORD.fields[k][1] for k in ("x", "y", "h", "agl", "cls", "intensity")] == [0, 2, 4, 6, 8, 9]
    x, y, z, agl, cls, inten = _random_tile(3)
    buf, h_base = encode_tile(x, y, z, agl, cls, inten)
    assert len(buf) == 16 + 10 * 3
    assert buf[:4] == b"SLEP"
    magic, ver, res, count, hb = struct.unpack("<4sHHIf", buf[:16])
    assert (ver, res, count) == (1, 0, 3)
    assert hb == pytest.approx(z.min() / 100, abs=1e-4) and h_base == z.min() / 100
    # first record by hand (little-endian, no permutation)
    rx, ry, rh, ragl, rc, ri = struct.unpack_from("<HHHhBB", buf, 16)
    assert (rx, ry, rh, ragl, rc, ri) == (x[0], y[0], z[0] - z.min(), agl[0], cls[0], inten[0])


def test_round_trip_within_1cm():
    x, y, z, agl, cls, inten = _random_tile()
    perm = tile_permutation(len(x), "test-area", 3, 7)
    buf, _ = encode_tile(x, y, z, agl, cls, inten, perm)
    h_base, rec = decode_tile(buf)
    E0, N0 = 381700 + 3 * TILE_SIZE, 5465600 + 7 * TILE_SIZE  # arbitrary tile origin
    E_true = (E0 * 100 + x[perm]) / 100
    N_true = (N0 * 100 + y[perm]) / 100
    E = E0 + rec["x"] / 100
    N = N0 + rec["y"] / 100
    Z = h_base + rec["h"].astype(np.float64) / 100
    assert np.abs(E - E_true).max() <= 0.01 and np.abs(N - N_true).max() <= 0.01
    assert np.abs(Z - z[perm] / 100).max() <= 0.01
    assert (rec["agl"] == agl[perm]).all() and (rec["cls"] == cls[perm]).all() and (rec["intensity"] == inten[perm]).all()


def test_decode_rejects_bad_tiles():
    buf, _ = encode_tile(*_random_tile(10))
    with pytest.raises(ValueError):
        decode_tile(b"XLEP" + buf[4:])
    with pytest.raises(ValueError):
        decode_tile(buf[:-1])


def test_height_and_agl_limits():
    x = np.array([0, 10, 20])
    z = np.array([10_000, 10_000 + 65_535, 10_000 + 65_536])  # last one is > 655.35 m above hBase
    agl = np.array([-40_000, 0, 40_000])
    buf, _ = encode_tile(x, x, z, agl, np.array([2, 2, 2]), np.array([0, 0, 0]))
    _, rec = decode_tile(buf)
    assert len(rec) == 2 and rec["h"].max() == 65535
    assert rec["agl"][0] == -32767
    with pytest.raises(ValueError):
        encode_tile(np.array([10_001]), np.array([0]), np.array([0]), np.array([0]), np.array([2]), np.array([0]))


def test_permutation_is_deterministic_permutation():
    p = tile_permutation(10_000, "karlsberg-schloss", 4, 5)
    assert np.array_equal(np.sort(p), np.arange(10_000))
    assert np.array_equal(p, tile_permutation(10_000, "karlsberg-schloss", 4, 5))
    assert not np.array_equal(p, tile_permutation(10_000, "karlsberg-schloss", 5, 4))
    assert not np.array_equal(p, np.arange(10_000))
    # a prefix is a spatially even subsample: each quadrant of a uniform tile keeps ~25 % of the first 1000
    rng = np.random.default_rng(0)
    xy = rng.integers(0, 10_000, (10_000, 2))
    xy = xy[np.lexsort((xy[:, 1], xy[:, 0]))]  # scan-line ordered input, like a LAZ file
    q = (xy[p[:1000], 0] >= 5000).astype(int) * 2 + (xy[p[:1000], 1] >= 5000)
    assert np.bincount(q, minlength=4).min() > 180


def test_bbox_clipping_half_open_and_tile_index():
    bbox = (381700, 5465600, 382700, 5466600)
    e = np.array([381700_00, 382699_99, 382700_00, 381699_99, 381750_00, 381800_00])
    n = np.array([5465600_00, 5466599_99, 5466000_00, 5466000_00, 5466600_00, 5465699_99])
    m = clip_mask(e, n, bbox)
    assert m.tolist() == [True, True, False, False, False, True]
    tx, ty = tile_index(e[m], n[m], bbox)
    assert tx.tolist() == [0, 9, 1] and ty.tolist() == [0, 9, 0]  # ty counts northwards


def test_intensity_scaling():
    assert intensity_u8(np.array([0, 975, 1950, 4000]), 1950).tolist() == [0, 128, 255, 255]


def test_previous_entry_only_when_all_tiles_exist(tmp_path):
    entry = {"id": "a", "path": "pointclouds/a/{tx}_{ty}.bin", "tiles": [[0, 0, 10], [1, 0, 5]]}
    section = {"areas": [entry, {"id": "b", "path": "x", "tiles": []}]}
    (tmp_path / "pointclouds" / "a").mkdir(parents=True)
    (tmp_path / "pointclouds" / "a" / "0_0.bin").write_bytes(b"x")
    assert previous_entry(section, "a", tmp_path) is None  # 1_0.bin missing
    (tmp_path / "pointclouds" / "a" / "1_0.bin").write_bytes(b"x")
    assert previous_entry(section, "a", tmp_path) is entry
    assert previous_entry(section, "b", tmp_path) is None  # no tiles
    assert previous_entry(section, "c", tmp_path) is None
    assert previous_entry(None, "a", tmp_path) is None
    assert previous_entry({"areas": [{"id": "a"}]}, "a", tmp_path) is None  # malformed


class _FlatSampler:
    def z(self, e, n):
        return np.full(np.shape(e), 300.0)


def _pts(n, area, seed=3):
    rng = np.random.default_rng(seed)
    e0, n0, e1, n1 = area.bbox
    return {"e": rng.integers(e0 * 100, e1 * 100, n), "n": rng.integers(n0 * 100, n1 * 100, n),
            "z": rng.integers(30_000, 32_000, n), "cls": rng.choice([2, 6], n).astype(np.uint8),
            "i": rng.integers(0, 3000, n).astype(np.uint16), "synthetic": np.zeros(n, dtype=bool)}


def test_write_area_keeps_previous_output_without_points_and_swaps_atomically(tmp_path):
    area = FocusArea("t", "T", (0, 0, 200, 100))
    aoi = load_aoi("karlsberg")
    out = tmp_path / "t"
    out.mkdir()
    (out / "9_9.bin").write_bytes(b"old")
    empty = {k: np.empty(0, dtype=np.int64) for k in ("e", "n", "z", "cls", "i", "synthetic")}
    assert write_area(aoi, area, empty, _FlatSampler(), root=tmp_path) is None
    assert (out / "9_9.bin").read_bytes() == b"old"  # nothing wiped
    entry, rep = write_area(aoi, area, _pts(2000, area), _FlatSampler(), root=tmp_path)
    assert sorted(p.name for p in out.iterdir()) == ["0_0.bin", "1_0.bin"]  # old tile gone only after the swap
    assert [t[:2] for t in entry["tiles"]] == [[0, 0], [1, 0]] and entry["pointCount"] == 2000
    assert not (tmp_path / "t.tmp").exists() and not (tmp_path / "t.old").exists()


def test_focus_areas_config():
    cfg = tomllib.loads(AOIS_TOML.read_text())
    areas = parse_areas(cfg["defaults"]["pointclouds"])
    assert {a.id for a in areas} == {"karlsberg-schloss", "homburg-schlossberg", "merburg"}
    for a in areas:
        assert re.fullmatch(r"[\w-]+", a.id) and 0.5e6 <= a.area_m2 <= 1.5e6
        assert all(v % TILE_SIZE == 0 for v in a.bbox)
    assert [a.id for a in areas_for_aoi(load_aoi("karlsberg"))] == ["karlsberg-schloss"]
    assert len(areas_for_aoi(load_aoi("overall"))) == 3
    assert FocusArea("x", "x", (381500, 5463000, 382500, 5464000)).laz_tiles() == [(381, 5463), (382, 5463)]
    with pytest.raises(ValueError):
        parse_areas([{"id": "a", "bbox": [0, 0, 150, 100]}])
    with pytest.raises(ValueError):
        parse_areas([{"id": "a b", "bbox": [0, 0, 100, 100]}])


# --------------------------------------------------------------------------- generated data
_KNOWN = [k for k in tomllib.loads(AOIS_TOML.read_text()) if k != "defaults"]
AOIS = sorted(k for k in _KNOWN if (APP_DATA / k / "manifest.json").exists()
              and "pointclouds" in json.loads((APP_DATA / k / "manifest.json").read_text()))


@pytest.mark.skipif(not AOIS, reason="no AOI with generated point clouds")
@pytest.mark.parametrize("aoi", AOIS)
def test_generated_pointclouds(aoi):
    m = json.loads((APP_DATA / aoi / "manifest.json").read_text())
    pc = m["pointclouds"]
    a = load_aoi(aoi)
    assert pc["format"] == "sle-pts-v1" and pc["tileSize"] == TILE_SIZE
    assert "LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet" in m["attribution"]
    seen_classes = set()
    for area in pc["areas"]:
        e0, n0, e1, n1 = area["bbox"]
        assert a.e0 <= e0 < e1 <= a.e1 and a.n0 <= n0 < n1 <= a.n1
        nx, ny = (e1 - e0) // TILE_SIZE, (n1 - n0) // TILE_SIZE
        assert "{tx}" in area["path"] and "{ty}" in area["path"]
        total = 0
        files = {p.name for p in (APP_DATA / aoi / "pointclouds" / area["id"]).glob("*.bin")}
        assert len(files) == len(area["tiles"])
        for tx, ty, cnt in area["tiles"]:
            assert 0 <= tx < nx and 0 <= ty < ny and cnt >= 1
            p = APP_DATA / aoi / area["path"].replace("{tx}", str(tx)).replace("{ty}", str(ty))
            buf = p.read_bytes()
            h_base, rec = decode_tile(buf)
            assert len(rec) == cnt and rec["x"].max() <= 10_000 and rec["y"].max() <= 10_000
            assert area["heightRange"]["min"] - 0.01 <= h_base <= area["heightRange"]["max"]
            assert rec["h"].min() == 0  # hBase is the tile minimum
            seen_classes |= set(np.unique(rec["cls"]).tolist())
            total += cnt
        assert total == area["pointCount"]
        assert sum(area["classCounts"].values()) == total
        assert area["density_per_m2"] == pytest.approx(total / ((e1 - e0) * (n1 - n0)), abs=1e-3)
    assert {int(k) for k in pc["classes"]} == seen_classes
    assert all(pc["classes"][k] == CLASS_LABELS_DE.get(int(k), f"Klasse {k}") for k in pc["classes"])


@pytest.mark.skipif(not AOIS, reason="no AOI with generated point clouds")
@pytest.mark.parametrize("aoi", AOIS)
def test_generated_ground_matches_dtm(aoi):
    """Ground points (class 2) vs the bilinear 1 m work DTM: median |dz| < 0.1 m, p95 < 0.2 m (Q-5 alignment)."""
    from heights import DtmSampler
    if not (WORK_DIR / aoi / "dtm.tif").exists():
        pytest.skip("no work DTM")
    a = load_aoi(aoi)
    s = DtmSampler.from_geotiff(WORK_DIR / aoi / "dtm.tif", a.e0, a.n1)
    pc = json.loads((APP_DATA / aoi / "manifest.json").read_text())["pointclouds"]
    for area in pc["areas"]:
        e0, n0 = area["bbox"][:2]
        dz, agl_err = [], []
        for tx, ty, _ in area["tiles"][::7]:
            h_base, rec = decode_tile((APP_DATA / aoi / area["path"].format(tx=tx, ty=ty)).read_bytes())
            g = rec[rec["cls"] == 2]
            E = e0 + tx * TILE_SIZE + g["x"] / 100
            N = n0 + ty * TILE_SIZE + g["y"] / 100
            Z = h_base + g["h"] / 100
            d = Z - s.z(E, N)
            dz.append(np.abs(d))
            agl_err.append(np.abs(d - g["agl"] / 100))
        dz, agl_err = np.concatenate(dz), np.concatenate(agl_err)
        assert len(dz) > 1000
        assert np.median(dz) < 0.1 and np.percentile(dz, 95) < 0.2, area["id"]
        assert agl_err.max() <= 0.011  # agl = Z − DTM, rounded to cm (+ f32 hBase)
