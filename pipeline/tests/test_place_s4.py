"""S4: the first RLP-only place (Zweibrücken). Catalog state on the place AOI, state-only steps (historic maps are
Saarland only), neighbour-state WFS as best effort, ortho source and attribution by the pixels actually used."""
from __future__ import annotations

import json
import sys
import urllib.error
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cadastre  # noqa: E402
import common  # noqa: E402
import ortho  # noqa: E402
import place  # noqa: E402
from test_place_s3 import ORT, cat_doc, entry  # noqa: E402

ZW = {**ORT, "id": "zweibruecken", "name_de": "Zweibrücken", "ags": "07320000", "state": "RP"}


def test_place_aoi_carries_catalog_state(tmp_path, monkeypatch):
    tiles = [(380, 5452), (381, 5452)]
    e = {**entry("zweibruecken", "07320000", tiles), "state": "RP"}
    cat = tmp_path / "catalog.json"
    cat.write_text(json.dumps(cat_doc([e])))
    extra = tmp_path / "aois.ort.toml"
    extra.write_text(place.aoi_table(place.parse_ort(ZW), [], cat))
    monkeypatch.setenv(common.AOIS_EXTRA_ENV, str(extra))
    assert common.load_aoi("ort-zweibruecken", step="build").state == "RP"
    assert common.load_aoi("karlsberg", step="build").state is None   # rectangles: no state


def test_skip_reason_state_only_steps():
    zw, hb = place.parse_ort(ZW), place.parse_ort(ORT)
    assert "SL only" in place.skip_reason("historic", zw, False)
    assert place.skip_reason("historic", hb, False) is None
    assert place.skip_reason("cadastre", zw, False) is None and place.skip_reason("ortho", zw, False) is None
    assert place.skip_reason("pois", zw, False) and place.skip_reason("pointcloud", zw, False)
    assert place.skip_reason("pointcloud", zw, True) is None


def test_run_build_reports_historic_not_applicable(tmp_path, monkeypatch):
    calls = []

    class R:
        returncode = 0

    monkeypatch.setattr(place.subprocess, "run", lambda args, **kw: calls.append(args[1]) or R())
    plan = place.Plan(place.parse_ort(ZW), [], {(380, 5452)}, set(), tmp_path / "a.toml", tmp_path / "c.json",
                      tmp_path / "app", tmp_path / "work", "stats", [])
    rep = place.run_build(plan, 1, ["cadastre", "historic", "pointcloud"])
    assert calls == ["cadastre.py"]
    st = {s["step"]: s["status"] for s in rep["steps"]}
    assert st["cadastre"] == "ok" and st["historic"].startswith("not applicable") and rep["result"] == "ok"


def _boom():
    raise urllib.error.HTTPError("https://x", 503, "Service Unavailable", {}, None)


def test_fetch_state_home_required_neighbour_best_effort():
    assert cadastre.fetch_state("SL", "RP", lambda: [1]) == ([1], None)
    res, err = cadastre.fetch_state("SL", "RP", _boom)
    assert res is None and "503" in err
    with pytest.raises(urllib.error.HTTPError):
        cadastre.fetch_state("RP", "RP", _boom)          # own state: required
    with pytest.raises(urllib.error.HTTPError):
        cadastre.fetch_state("SL", None, _boom)          # v1/v2 rectangle: both required as before
    with pytest.raises(ValueError):                      # ExceptionReport → ValueError, also best effort only for
        cadastre.fetch_state("RP", "RP", lambda: cadastre.parse_number_matched(b"<x/>"))   # the neighbour
    assert cadastre.fetch_state("RP", "SL", lambda: cadastre.parse_number_matched(b"<x/>"))[0] is None


def test_source_v3():
    both = cadastre.source_v3("2026-11-08", "2026-11-09", [])
    assert both == ("ALKIS Saarland, WFS SL ALKIS Vereinfacht (abgerufen 2026-11-08); ALKIS Rheinland-Pfalz, "
                    "WFS RP ALKIS Vereinfacht (abgerufen 2026-11-09)")   # = the v1/v2 wording (Homburg unchanged)
    rp = cadastre.source_v3(None, "2026-11-09", ["SL"])
    assert rp.startswith("ALKIS Rheinland-Pfalz") and "ALKIS Saarland (WFS SL ALKIS Vereinfacht) beim Build nicht" in rp


def test_ortho_source_by_pixels_used():
    d = "2026-11-09"
    src, att = ortho.ortho_source(d, True, False)
    assert att == [ortho.ATTRIBUTION_DOP_SL] and src.startswith("WMS SL DOP20 2025") and "Lücken" not in src
    src, att = ortho.ortho_source(d, True, True)
    assert att == [ortho.ATTRIBUTION_DOP_SL, ortho.ATTRIBUTION_DOP_RLP]
    assert src == (f"WMS SL DOP20 2025 (Layer sl_dop20_rgb, TrueDOP20, Geoportal Saarland), abgerufen {d}; "
                   f"Lücken: WMS RP DOP20 (Layer rp_dop20, LVermGeo RLP), abgerufen {d}")   # pre-S4 wording
    src, att = ortho.ortho_source(d, False, True)
    assert att == [ortho.ATTRIBUTION_DOP_RLP] and src == f"WMS RP DOP20 (Layer rp_dop20, LVermGeo RLP), abgerufen {d}"


def test_source_cells_sl_over_rlp():
    import numpy as np
    sl = np.zeros((4, 4, 4), np.uint8)
    rlp = np.zeros((4, 4, 4), np.uint8)
    sl[:2, :2, 3] = 255                 # SL covers the top-left 2 × 2 block
    sl[2:, 2:, 3] = [[255, 0], [0, 0]]  # only a quarter of the bottom-right block: not SL
    rlp[:, 2:, 3] = 255                 # RLP covers the right half
    src = ortho.source_cells([sl, rlp])
    assert src.tolist() == [[ortho.SRC_SL, ortho.SRC_RLP], [ortho.SRC_NONE, ortho.SRC_RLP]]
    assert ortho.source_cells([sl]).tolist() == [[ortho.SRC_SL, ortho.SRC_NONE], [ortho.SRC_NONE, ortho.SRC_NONE]]


def test_calibrate_rlp_cells_only_rlp_and_not_black():
    import numpy as np
    import trees
    rgb = np.array([[[50, 0], [60, 200]]] * 3, np.uint8)   # (3, 2, 2)
    src = np.array([[2, 2], [1, 2]], np.uint8)
    out, n = trees.calibrate_rlp_cells(rgb, src, (1.13902, 22.0928))
    assert n == 2                                          # the black RLP cell is no data, the SL cell untouched
    assert out[0].tolist() == [[79, 0], [60, 250]]         # rint(50 · 1.13902 + 22.0928) = 79, 200 → 250
    same, n0 = trees.calibrate_rlp_cells(rgb, np.ones((2, 2), np.uint8))
    assert n0 == 0 and same is rgb                         # an SL-only place (Homburg) reads exactly as before
    k, c = trees.RLP_DOP_CALIB
    assert trees.classify(np.array([50.0 * k + c]), trees.Params())[0] == trees.TYPE_CODES["broadleaf"]   # RLP 50 (raw: conifer)
