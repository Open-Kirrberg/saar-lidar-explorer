import pytest

from capture import boxes as B


def test_iou_and_overlap():
    a = [0, 0, 10, 10]
    assert B.iou(a, a) == 1.0
    assert B.iou(a, [20, 20, 30, 30]) == 0.0
    assert B.iou(a, [5, 0, 15, 10]) == pytest.approx(50 / 150)
    assert B.overlap_min(a, [2, 2, 4, 4]) == 1.0  # nested


def test_merge_boxes_unions_tile_splits_only():
    # one car split at a tile border + a separate far car
    out = B.merge_boxes([[0, 0, 10, 10], [8, 0, 20, 10], [100, 100, 110, 110]], thr=0.1)
    assert sorted(out) == [[0, 0, 20, 10], [100, 100, 110, 110]]


def test_pad_box_clips_to_image():
    assert B.pad_box([0, 0, 10, 10], 0.1, 2, 100, 100) == [0.0, 0.0, 13.0, 13.0]
    assert B.pad_box([90, 90, 100, 100], 0.0, 5, 100, 100) == [85.0, 85.0, 100.0, 100.0]


def test_plate_zone_lower_part_or_whole_when_small():
    assert B.plate_zone([0, 0, 400, 200], small_px=120, lower=0.6) == [0, 80.0, 400, 200]
    assert B.plate_zone([0, 0, 100, 50], small_px=120) == [0, 0, 100, 50]


@pytest.mark.parametrize("s,ok", [
    ("HOM-AB 123", True), ("hom ab123", True), ("ZW X 7E", True), ("KUS·Q 4711", True),
    ("Bäckerei", False), ("11:00 Uhr", False), ("1,50 €", False), ("Preis 2,50", False),
])
def test_looks_like_plate(s, ok):
    assert B.looks_like_plate(s) is ok


def test_link_tracks_follows_moving_box_and_splits_distant_objects():
    frames = [10, 14, 20, 26]
    dets = {
        10: [[100, 100, 200, 150], [1000, 1000, 1100, 1050]],
        14: [[130, 100, 230, 150]],               # first object moved right; second missed
        20: [[160, 100, 260, 150], [1010, 1000, 1110, 1050]],
        26: [[3000, 2000, 3100, 2050]],          # far away: a new object
    }
    tracks = B.link_tracks(dets, frames, max_gap=3)
    assert len(tracks) == 3
    first = next(t for t in tracks if 10 in t and t[10][0] == 100)
    assert sorted(first) == [10, 14, 20]
    second = next(t for t in tracks if 10 in t and t[10][0] == 1000)
    assert sorted(second) == [10, 20]  # bridged a one-keyframe miss


def test_link_tracks_respects_max_gap():
    frames = [1, 2, 3, 4, 5]
    dets = {1: [[0, 0, 10, 10]], 5: [[0, 0, 10, 10]]}
    assert len(B.link_tracks(dets, frames, max_gap=3)) == 2
    assert len(B.link_tracks(dets, frames, max_gap=4)) == 1


def test_fill_track_interpolates_by_frame_number_and_extends():
    frames = [0, 10, 30, 40, 50]
    track = {10: [0, 0, 10, 10], 40: [30, 0, 40, 10]}
    out = B.fill_track(track, frames, extend=1)
    assert sorted(out) == [0, 10, 30, 40, 50]
    assert out[30] == pytest.approx([20, 0, 30, 10])  # (30-10)/(40-10) = 2/3 of the way
    assert out[0] == [0, 0, 10, 10] and out[50] == [30, 0, 40, 10]


def test_frame_no():
    assert B.frame_no("f_01234.jpg") == 1234
