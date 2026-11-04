import math

import numpy as np
import pytest

from capture.package import (bbox_en, camera_poses_local, convex_hull_en, faces_in_spheres, frame_no, gpu_texture_bytes,
                             heading_pitch, merge_index, path_waypoints, quat_to_R, scale_about)


def test_heading_pitch_grid_convention():
    # zone frame: x = E, y = up, z = -N; heading clockwise from grid north
    assert heading_pitch([0, 0, -1]) == pytest.approx((0.0, 0.0))  # north
    assert heading_pitch([1, 0, 0]) == pytest.approx((90.0, 0.0))  # east
    assert heading_pitch([0, 0, 1])[0] == pytest.approx(180.0)
    assert heading_pitch([-1, 0, 0])[0] == pytest.approx(270.0)
    assert heading_pitch([0, -1, -1])[1] == pytest.approx(-45.0)


def test_quat_identity_and_frame_numbers():
    assert np.allclose(quat_to_R([0, 0, 0, 1]), np.eye(3))
    assert frame_no("f_00046.jpg") == 46
    assert frame_no("nope.jpg") == -1


def test_camera_poses_local_order_and_forward():
    # camera looks along its -Z; a 90° yaw about +Y turns -Z into -X (west)
    s = math.sqrt(0.5)
    poses = [
        {"file": "f_00010.jpg", "t": [1, 0, 0], "q_xyzw": [0, s, 0, s]},
        {"file": "f_00002.jpg", "t": [0, 0, 0], "q_xyzw": [0, 0, 0, 1]},
    ]
    M = np.eye(4)
    M[:3, 3] = [10, 240, 5]  # mesh -> zone frame: translate only
    cams = camera_poses_local(poses, M)
    assert [c["frame"] for c in cams] == [2, 10]  # video order
    assert (cams[0]["x"], cams[0]["y"], cams[0]["z"]) == pytest.approx((10, 240, 5))
    assert cams[0]["heading_deg"] == pytest.approx(0.0)
    assert cams[1]["heading_deg"] == pytest.approx(270.0)


def test_path_waypoints_thins_and_keeps_the_end():
    cams = [{"x": 0.1 * i, "y": 244.0, "z": 0.0, "heading_deg": 90.0} for i in range(31)]  # 3 m east
    w = path_waypoints(cams, step_m=1.0)
    assert [p[0] for p in w] == pytest.approx([0.0, 1.0, 2.0, 3.0])
    assert w[-1] == [3.0, 244.0, 0.0, 90.0]
    assert path_waypoints(cams[:1]) == [[0.0, 244.0, 0.0, 90.0]]


def test_convex_hull_is_padded_ccw_ring():
    pts = np.array([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5]], float)
    ring = convex_hull_en(pts, pad_m=1.0)
    assert len(ring) == 4 and [5.0, 5.0] not in ring
    area2 = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:] + ring[:1]))
    assert area2 > 0  # CCW
    assert min(p[0] for p in ring) < 0 and max(p[0] for p in ring) > 10  # pushed out


def test_bbox_and_index_merge():
    assert bbox_en([[[1.2, 2.7], [3.4, 5.1]]], pad_m=1.0) == [[0, 1], [5, 7]]
    idx = {"format": "sle-zones-v1", "zones": [{"id": "schloss-karlsberg", "bboxEN": [[0, 0], [1, 1]]}, {"id": "bakery", "bboxEN": "old"}]}
    out = merge_index(idx, {"id": "bakery", "bboxEN": [[2, 2], [3, 3]]})
    assert [z["id"] for z in out["zones"]] == ["schloss-karlsberg", "bakery"]
    assert out["zones"][1]["bboxEN"] == [[2, 2], [3, 3]]
    assert merge_index(None, {"id": "a"}) == {"format": "sle-zones-v1", "zones": [{"id": "a"}]}


def test_privacy_spheres_select_faces():
    c = np.array([[0, 0, 0], [0.5, 0, 0], [2, 0, 0]], float)
    assert faces_in_spheres(c, [{"center": [0, 0, 0], "radius": 0.6}]).tolist() == [True, True, False]
    assert not faces_in_spheres(c, []).any()


def test_gpu_bytes_and_scale_twin():
    assert gpu_texture_bytes(3072, 3072) == int(3072 * 3072 * 4 / 3)
    # same numbers as app/tests/zonesGltf.test.ts (scaleAbout)
    assert scale_about([18, 244, -5], [8, 243, -5], 1.1) == pytest.approx([19, 244.1, -5])
    assert scale_about([8, 243, -5], [8, 243, -5], 1.1) == pytest.approx([8, 243, -5])
