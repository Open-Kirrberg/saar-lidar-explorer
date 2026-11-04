import numpy as np
import pytest

from capture.frames import relative_sharpness, select_expr, select_frames


def test_constant_motion_gives_even_spacing():
    n = 300
    flow = np.full(n, 0.01)
    sel = select_frames(np.ones(n), flow, step=0.05, lo=1.0, hi=1.0, max_gap=30)
    gaps = np.diff(sel)
    assert set(gaps.tolist()) == {5}
    assert sel[-1] >= n - 5


def test_sharpest_frame_in_band_wins():
    n = 60
    flow = np.full(n, 0.01)
    sharp = np.ones(n)
    sharp[7] = 5.0  # band after frame 0..: cumulative 0.06..0.1 -> frames 6..10 for step 0.1, lo 0.6
    sel = select_frames(sharp, flow, step=0.1, lo=0.6, hi=1.0, max_gap=30, window=61)
    assert 7 in sel


def test_blurry_frames_skipped_when_alternatives_exist():
    n = 40
    flow = np.full(n, 0.01)
    sharp = np.ones(n)
    sharp[6:11] = [0.2, 0.2, 1.0, 0.2, 0.2]
    sel = select_frames(sharp, flow, step=0.1, lo=0.6, hi=1.0, max_gap=30, min_rel_sharp=0.5, window=41)
    assert not set(sel) & {6, 7, 9, 10}


def test_fast_motion_takes_consecutive_frames():
    flow = np.full(20, 0.5)  # every frame moves more than one step
    sel = select_frames(np.ones(20), flow, step=0.1)
    assert sel == list(range(20))


def test_static_camera_bounded_by_max_gap():
    n = 200
    sel = select_frames(np.ones(n), np.zeros(n), step=0.1, max_gap=30)
    assert max(np.diff(sel)) <= 30
    assert len(sel) <= n / 15 + 2


def test_relative_sharpness_is_scale_free():
    s = np.r_[np.full(50, 100.0), np.full(50, 10.0)]
    r = relative_sharpness(s, 11)
    assert np.allclose(r[:40], 1) and np.allclose(r[60:], 1)


def test_input_validation():
    with pytest.raises(ValueError):
        select_frames(np.ones(3), np.ones(4), step=0.1)
    with pytest.raises(ValueError):
        select_frames(np.ones(3), np.ones(3), step=0)
    assert select_frames([], [], step=0.1) == []


def test_select_expr_is_a_balanced_tree():
    e = select_expr([1, 2, 3, 4])
    assert e == "((eq(n,1)+eq(n,2))+(eq(n,3)+eq(n,4)))"
    deep = select_expr(list(range(1000)))
    assert deep.count("eq(") == 1000
