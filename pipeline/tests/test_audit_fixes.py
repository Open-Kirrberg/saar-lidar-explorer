"""Regression tests for the v1.0.1 audit fixes (pipeline-1..3)."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build  # noqa: E402
import detect as D  # noqa: E402
from common import swap_dir  # noqa: E402


def test_build_rerun_keeps_foreign_relief_dirs(tmp_path: Path):
    """pipeline-1: build must not delete relief/bldg (owned by buildings.py)."""
    for sub in ("dtm/0_0.png", "dsm/0_0.png", "relief/slrm/0_0.png", "relief/chm/0_0.png", "relief/bldg/0_0.png"):
        p = tmp_path / sub
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"x")
    build.clear_build_outputs(tmp_path)
    assert (tmp_path / "relief/bldg/0_0.png").exists()
    for gone in ("dtm", "dsm", "relief/slrm", "relief/chm"):
        assert not (tmp_path / gone).exists()


def test_swap_dir_keeps_old_output_until_new_one_is_complete(tmp_path: Path):
    """pipeline-2: ortho writes into staging and swaps; the old dir survives until the swap."""
    out = tmp_path / "ortho"
    (out / "levels").mkdir(parents=True)
    (out / "0_0.webp").write_bytes(b"old")
    stage = tmp_path / ".ortho.staging" / "ortho"
    stage.mkdir(parents=True)
    (stage / "0_0.webp").write_bytes(b"new")
    assert (out / "0_0.webp").read_bytes() == b"old"  # a failure before the swap leaves this intact
    swap_dir(stage, out)
    assert (out / "0_0.webp").read_bytes() == b"new"
    assert not (out / "levels").exists() and not (tmp_path / "ortho.old").exists()


def test_inside_mean_ignores_edge_line_for_masks_and_slope():
    """pipeline-3: an empty edge column must not pull the settlement fraction / slope context down."""
    rng = np.random.default_rng(1)
    b = np.zeros((400, 400), np.float32)
    b[:, 2:60] = (rng.random((400, 58)) < 0.10).astype(np.float32)
    true_frac = b[150:251, 0:56].mean()  # window of r=50 around (200, 5), clipped to the raster
    assert D.box_mean(b, 50)[200, 5] < 0.03  # the old odd-padded mean misses the settlement
    assert abs(D.inside_mean(b, 50)[200, 5] - true_frac) < 1e-5
    s = np.full((400, 400), 12.0, np.float32)
    s[:, 0] = 2.0
    assert D.box_mean(s, 15)[200, 3] < 10  # old: hillside platforms next to a flat edge line were lost
    assert D.inside_mean(s, 15)[200, 3] > 10
    # Interior: identical to the plain box mean.
    assert np.allclose(D.inside_mean(s, 15)[100:300, 100:300], D.box_mean(s, 15)[100:300, 100:300], atol=1e-4)
