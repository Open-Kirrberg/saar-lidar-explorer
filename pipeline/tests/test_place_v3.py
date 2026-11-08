"""S2 v3 place build: locality (byte identity across tile sets), lossless round trips, AVIF budget, live VAT formula,
manifest rules (contract "Many places (v3, S2)")."""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build as B  # noqa: E402
import grid as G  # noqa: E402
from common import APP_DATA, SL_RAW, sl_name  # noqa: E402
from encode import (  # noqa: E402
    avif_u8_bytes, terrarium_decode, terrarium_encode, u8_decode, u8_encode, webp_lossless_bytes,
)
from levels import block_mean  # noqa: E402

BUF = 200


def synthetic_mosaic(box, seed=3):
    """Smooth terrain with pits, walls and a gap (NaN) over `box`, a pure function of the absolute coordinates so
    two different boxes see the same values where they overlap."""
    e0, n0, e1, n1 = box
    E = np.arange(e0, e1) + 0.5
    N = np.arange(n1, n0, -1) - 0.5
    EE, NN = np.meshgrid(E, N)
    h = 250 + 20 * np.sin(EE / 700.0) + 15 * np.cos(NN / 530.0) + 0.6 * np.sin(EE / 9.0) * np.cos(NN / 13.0)
    h += 3 * np.exp(-(((EE - 376400) ** 2 + (NN - 5462600) ** 2) / 200.0))          # mound
    h -= 2 * ((np.abs(EE - 376800) < 3) & (NN > 5462100))                           # ditch crossing tiles
    sl = h.astype(np.float32)
    sl[(np.abs(EE - 377010) < 4) & (np.abs(NN - 5462500) < 4)] = np.nan             # small gap at a tile edge
    rlp = (h + 0.06).astype(np.float32)
    rlp[EE < 376050] = np.nan
    sl[(EE > 377900)] = np.nan                                                     # SL ends, RLP fills
    dsm = (h + np.clip(8 * np.sin(EE / 31.0) * np.sin(NN / 23.0), 0, None)).astype(np.float32)
    return {"dgm_sl": sl, "dgm_rlp": rlp, "dom_sl": dsm, "dom_rlp": np.full_like(dsm, np.nan)}


def files_for(tile, tiles, src_fn):
    """Encoded files of `tile` when built as part of the tile set `tiles` (own rectangle, own source box)."""
    e0, n0, e1, n1 = G.tiles_bbox(tiles)
    box = (e0 - BUF, n0 - BUF, e1 + BUF, n1 + BUF)
    src = src_fn(box)
    w = B.process_tile_v3(B.window_of(src, box, B.tile_window(tile, BUF)), BUF)
    files = B.tile_files_v3(w, BUF, tile, e0, n1)
    # rename to tile-relative names: the (i, j) of a tile differ between rectangles, the content must not
    out = {}
    for rel, (fmt, arr) in files.items():
        parts = rel.split("/")
        i, j = (int(x) for x in parts[-1].split(".")[0].split("_"))
        k = 1 if rel.startswith("levels/1/") else 0
        I, J = G.global_address(k, i, j, e0, n0, n1 - n0)
        out[f"{'/'.join(parts[:-1])}/{I}_{J}"] = (fmt, arr)
    return out


def assert_identical(fa, fb):
    assert fa.keys() == fb.keys() and len(fa) == 4 * 6 + 2
    for k in fa:
        (fmt, a), (_, b) = fa[k], fb[k]
        assert np.array_equal(a, b), k                  # identical encoder input (lossless and lossy)
        if fmt == "webp":
            assert webp_lossless_bytes(a) == webp_lossless_bytes(b), k   # byte-identical files


def test_locality_synthetic_byte_identity():
    t = (376, 5462)
    fa = files_for(t, [t, (377, 5462)], synthetic_mosaic)
    fb = files_for(t, [t, (375, 5462), (376, 5463), (375, 5463)], synthetic_mosaic)
    assert_identical(fa, fb)


REAL_TILES = [(376, 5462), (377, 5462), (375, 5462), (376, 5463)]


@pytest.mark.skipif(not all((SL_RAW / sl_name("dgm1", *t)).exists() for t in
                            {(e + de, n + dn) for e, n in REAL_TILES for de in (-1, 0, 1) for dn in (-1, 0, 1)}),
                    reason="raw DGM1 tiles of the fixture area not cached")
def test_locality_real_border_tile_byte_identity():
    """Tile 376_5462 (Homburg, at the Kirkel border) built with Homburg's tiles or with Kirkel's tiles."""
    def real(box):
        fetch = sorted(G.neighbours8([(e // 1000, n // 1000) for e in range(box[0] + BUF, box[2] - BUF, 1000)
                                      for n in range(box[1] + BUF, box[3] - BUF, 1000)]))
        return B.read_sources(fetch, box, with_dsm=True)
    t = (376, 5462)
    assert_identical(files_for(t, [t, (377, 5462), (377, 5463)], real), files_for(t, [t, (375, 5462)], real))


def test_neighbour_apron_equals_edge():
    """Rule 4: the apron row of a chunk equals the edge row of the neighbouring chunk, built by another place."""
    a, b = (376, 5462), (376, 5463)
    fa = files_for(a, [a], synthetic_mosaic)
    fb = files_for(b, [b], synthetic_mosaic)
    ha = {k: terrarium_decode(v[1]) for k, v in fa.items() if k.startswith("dtm/")}
    hb = {k: terrarium_decode(v[1]) for k, v in fb.items() if k.startswith("dtm/")}
    # chunk directly south of b's south-west chunk
    I, J = G.global_address(0, 0, 0, 376000, 5463000, 1000)
    south_of_b = hb[f"dtm/{I}_{J + 1}"]
    north_of_a = ha[f"dtm/{I}_{J + 2}"]
    assert np.array_equal(north_of_a[0, 1:501], south_of_b[500, 1:501])   # a's apron = b's last own row
    assert np.array_equal(north_of_a[1, 1:501], south_of_b[501, 1:501])   # a's first row = b's apron


def test_webp_lossless_roundtrip_bit_exact():
    rng = np.random.default_rng(1)
    h = 200 + rng.random((502, 502)) * 300
    rgb = terrarium_encode(h)
    data = webp_lossless_bytes(rgb)
    back = np.asarray(Image.open(io.BytesIO(data)))
    assert back.shape == (502, 502, 3) and np.array_equal(back, rgb)
    assert data[8:12] == b"WEBP" and data[12:16] == b"VP8L"                       # lossless bitstream
    u = (rng.random((500, 500)) * 255).astype(np.uint8)
    back = np.asarray(Image.open(io.BytesIO(webp_lossless_bytes(u))))
    assert back.shape == (500, 500, 3) and all(np.array_equal(back[..., c], u) for c in range(3))


def test_avif_u8_budget_and_monochrome():
    x = np.linspace(0, 1, 500)
    a = u8_encode(0.6 + 0.4 * np.outer(np.sin(x * 9) ** 2, np.cos(x * 7) ** 2), 0.6, 1)
    data, st = avif_u8_bytes(a)
    assert st["quality"] == 90 and st["mean_err"] <= 1.5 and st["max_err"] <= 16
    im = Image.open(io.BytesIO(data))
    assert im.format == "AVIF" and im.mode == "L" and "icc_profile" not in im.info


def vat_error(w):
    """Live VAT (rvt-vat-combined-v1 on the decoded u8 svf/opns_pos and the terrarium DTM) vs the baked u8 VAT."""
    core = (slice(BUF, BUF + 1000), slice(BUF, BUF + 1000))
    lo, hi = G.FIXED_RANGES["svf"]
    svf = u8_decode(u8_encode(w["svf"], lo, hi), lo, hi)
    lo, hi = G.FIXED_RANGES["opns_pos"]
    opn = u8_decode(u8_encode(w["opns_pos"], lo, hi), lo, hi)
    dtm = terrarium_decode(terrarium_encode(w["dtm"]))
    live = u8_encode(B.vat_formula_v1(svf, opn, dtm)[core], 0, 1).astype(int)
    baked = u8_encode(w["vat"][core], 0, 1).astype(int)
    return np.abs(live - baked)


def test_vat_formula_matches_baked_vat():
    """Contract tolerance: mean |Δ| ≤ 1, p99 ≤ 2 u8 levels."""
    box = (376000 - BUF, 5462000 - BUF, 377000 + BUF, 5463000 + BUF)
    d = vat_error(B.process_tile_v3(synthetic_mosaic(box), BUF))
    assert d.mean() <= 1.0 and np.percentile(d, 99) <= 2.0, (d.mean(), np.percentile(d, 99), d.max())


@pytest.mark.skipif(not all((SL_RAW / sl_name("dgm1", *t)).exists() for t in G.neighbours8([(376, 5462)])),
                    reason="raw DGM1 tiles of the fixture area not cached")
@pytest.mark.parametrize("tile", [(376, 5462), (377, 5463)])
def test_vat_formula_matches_baked_vat_real(tile):
    box = B.tile_window(tile, BUF)
    src = B.read_sources(sorted(G.neighbours8([tile])), box, with_dsm=False)
    d = vat_error(B.process_tile_v3(src, BUF))
    assert d.mean() <= 1.0 and np.percentile(d, 99) <= 2.0, (d.mean(), np.percentile(d, 99), d.max())


def test_level1_block_means():
    box = (376000 - BUF, 5462000 - BUF, 377000 + BUF, 5463000 + BUF)
    t = (376, 5462)
    w = B.process_tile_v3(synthetic_mosaic(box), BUF)
    files = B.tile_files_v3(w, BUF, t, 376000, 5463000)
    d1 = terrarium_decode(files["levels/1/dtm/0_0.webp"][1])
    assert d1.shape == (502, 502)
    # level-1 cell (c, r) with apron: pixel (c + 1, r + 1) = mean of 1 m cells [2c, 2c + 2) × [2r, 2r + 2)
    ref = block_mean(w["dtm"][BUF:BUF + 1000, BUF:BUF + 1000], 2)
    assert np.abs(d1[1:501, 1:501] - ref).max() < 0.003
    apron = block_mean(w["dtm"][BUF - 2:BUF, BUF:BUF + 1000], 2)[0]
    assert np.abs(d1[0, 1:501] - apron).max() < 0.003                           # apron from real terrain
    assert files["levels/1/vat/0_0.avif"][1].shape == (500, 500)


def test_fixed_ranges_in_layer_entries():
    for k in B.V3_LAYER_ORDER:
        e = B.v3_layer_entry(k, f"relief/{k}/{{i}}_{{j}}.{B.V3_LAYERS[k]}")
        assert (e["min"], e["max"]) == G.FIXED_RANGES[k]
        assert e.get("lossy", False) == (B.V3_LAYERS[k] == "avif")


# ------------------------------------------------------------------------------------------- generated outputs
def v3_manifests():
    out = []
    for p in sorted(APP_DATA.glob("*/manifest.json")) + sorted(APP_DATA.glob("fixture-v3/*/manifest.json")):
        try:
            m = json.loads(p.read_text())
        except (OSError, ValueError):
            continue
        if m.get("version") == 3:
            out.append((p.parent, m))
    return out


@pytest.mark.parametrize("d,m", v3_manifests() or [pytest.param(None, None, marks=pytest.mark.skip("no v3 output"))])
def test_generated_v3_manifest_rules(d, m):
    assert m["grid"] == G.GRID
    e0, n0 = m["origin"]["E0"], m["origin"]["N0"]
    W, H = m["size"]["width"], m["size"]["height"]
    assert G.is_aligned(e0, n0, W, H, 1000)
    assert m["place"]["id"] == m["aoi"] and m["build"]["pipeline"]
    assert "dsm" not in m["height"]
    assert not {"hillshade", "slope", "slrm", "vat"} & set(m["layers"])
    assert set(m["derived"]) == {"hillshade", "slope", "slrm", "vat"}
    for k, (lo, hi) in G.FIXED_RANGES.items():
        if k in m["layers"]:
            assert (m["layers"][k]["min"], m["layers"][k]["max"]) == (lo, hi)
    for k in ("dtm",):
        assert not m["height"][k]["path"].endswith(".avif")
    tiles = G.presence_tiles(m["presence"], e0, n0 + H)
    assert [lv["level"] for lv in m["levels"]] == [0, 1]
    assert "hillshade" not in m["levels"][1]["layers"]
    n1 = n0 + H
    present = {c for t in tiles for c in G.tile_chunks(t, e0, n1)}
    files = {p.stem for p in (d / "dtm").glob("*.webp")}
    assert files == {f"{i}_{j}" for i, j in present}                                 # rule 2, both directions
    l1 = {p.stem for p in (d / "levels" / "1" / "dtm").glob("*.webp")}
    assert l1 == {"{}_{}".format(*G.tile_cell(t, e0, n1)) for t in tiles}
    for key, lay in m["layers"].items():
        if lay.get("encoding") != "u8" or "{i}" not in lay["path"]:
            continue
        stems = {p.name.rsplit(".", 1)[0] for p in (d / Path(lay["path"]).parent).glob("*")}
        assert stems <= {f"{i}_{j}" for i, j in present}, key


def test_implausible_heights_are_no_data():
    sl = np.full((5, 5), 300.0, np.float32)
    sl[2, 2] = 0.0
    sl[0, 0] = -0.26
    dtm, mask = B.fill_heights(sl, np.full_like(sl, np.nan), B.RLP_OFFSET_V3_M)
    assert dtm.min() == 300.0 and mask[2, 2] == 1.0 and mask[0, 0] == 1.0


# ------------------------------------------------------------------------- h-plausible-v1 (S2 follow-up)
def _plane(n=400):
    rr, cc = np.mgrid[:n, :n]
    return (200.0 + 0.05 * cc + 0.02 * rr).astype(np.float32), rr, cc


def _hole(h, rr, cc, r0, c0, radius, depth):
    d = np.hypot(rr - r0, cc - c0)
    return (h - depth * np.clip(1 - d / radius, 0, None)).astype(np.float32)


def test_pit_rule_flags_narrow_deep_funnel():
    """An interpolated funnel like SL 343_5457 (24 m wide, 184 m deep, bottom ≈ 0 m) becomes no data as a whole,
    walls included; the filled DTM then has no cell below the surrounding terrain."""
    h, rr, cc = _plane()
    f = _hole(h, rr, cc, 200, 180, 12, 184)
    pits = B.implausible_pits(f)
    assert pits[200, 180] and pits.sum() >= 0.9 * ((np.hypot(rr - 200, cc - 180) < 12).sum())
    assert not pits[np.hypot(rr - 200, cc - 180) > 13].any()
    dtm, mask = B.fill_heights(f, np.full_like(f, np.nan), B.RLP_OFFSET_V3_M)
    assert dtm.min() >= h.min() - 1e-3 and (mask[pits] == 1).all() and (mask[~pits] == 0).all()


def test_pit_rule_keeps_real_terrain():
    h, rr, cc = _plane()
    small = _hole(h, rr, cc, 200, 200, 3, 23)          # 6 m wide, 23 m deep (the deepest real hole, SL 357_5444)
    assert not B.implausible_pits(small).any()
    quarry = _hole(h, rr, cc, 200, 200, 120, 80)       # 240 m wide, 80 m deep: wider than PIT_EXTENT_M
    assert not B.implausible_pits(quarry).any()
    gorge = h - 60 * np.clip(1 - np.abs(cc - 200) / 20, 0, None).astype(np.float32)   # 40 m wide, 60 m deep, open
    assert not B.implausible_pits(gorge.astype(np.float32)).any()
    pit = _hole(h, rr, cc, 200, 200, 12, 49)           # just under PIT_DEPTH_M
    assert not B.implausible_pits(pit).any()
    valid = np.ones(h.shape, bool)
    funnel = _hole(h, rr, cc, 200, 200, 12, 184)
    valid[190:210, 190:210] = False                    # cells already without source data are not screened
    assert not B.implausible_pits(funnel, valid).any()


def test_pit_rule_is_local():
    """The verdict is a function of the cells within ≈ 150 m: two windows offset by 130 / 70 m agree in their
    common part (locality requirement of the relief buffer)."""
    h, rr, cc = _plane(700)
    f = _hole(_hole(h, rr, cc, 300, 330, 12, 184), rr, cc, 420, 470, 10, 120)
    a = B.implausible_pits(f[0:600, 0:600])
    b = B.implausible_pits(f[130:700, 70:700])
    assert a.any() and np.array_equal(a[130:600, 70:600], b[:470, :530])


def test_floor_and_rule_constants():
    assert B.H_FLOOR_M < 45 < 137 and B.PIT_DEPTH_M > 23 and B.HEIGHT_RULE == "h-plausible-v1"


@pytest.mark.skipif(not (SL_RAW / sl_name("dgm1", 343, 5457)).exists(), reason="SL tile 343_5457 not cached")
def test_real_funnel_343_5457_removed():
    tiles = [(343 + de, 5457 + dn) for de in (-1, 0, 1) for dn in (-1, 0, 1)]
    sl, rl = B.tile_paths("dgm1", tiles)
    win = B.tile_window((343, 5457), BUF)
    a = B.read_mosaic(sl, win)[0]
    dtm, mask = B.fill_heights(a, np.full_like(a, np.nan), B.RLP_OFFSET_V3_M)
    core = dtm[BUF:BUF + 1000, BUF:BUF + 1000]
    assert core.min() > 180 and 200 < int((mask == 1).sum()) < 1000
