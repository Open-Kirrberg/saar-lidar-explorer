import math

import numpy as np
import pytest

from capture import similarity as S
from capture.export import crop_mask
from capture.georef import (classify_indoor, exterior_mask, footprint_grid, global_search, inside_buildings,
                             inside_walls, level)


def rot3(axis, ang):
    axis = np.asarray(axis, float) / np.linalg.norm(axis)
    k = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    return np.eye(3) + np.sin(ang) * k + (1 - np.cos(ang)) * k @ k


def test_level_recovers_up_from_floor_and_ceiling_normals():
    rng = np.random.default_rng(5)
    R = rot3([0.3, 1.0, 0.2], 1.1)
    base = np.array([[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]], float)
    n = np.repeat(base, 200, 0) + rng.normal(scale=0.02, size=(1200, 3))
    n = n / np.linalg.norm(n, axis=1, keepdims=True) @ R.T
    area = np.ones(len(n))
    up_true = R @ [0, 0, 1]
    cam_up = R @ rot3([1, 0, 0], math.radians(8)) @ [0, 0, 1]  # handheld: 8 deg off
    up = level(n, area, cam_up)
    assert math.degrees(math.acos(min(1.0, up @ up_true))) < 0.3


def _ccw(pts):
    pts = np.asarray(pts, float)
    return pts, np.roll(pts, -1, axis=0)


def test_global_search_then_icp_recovers_similarity():
    rng = np.random.default_rng(6)
    # world: an L-shaped building and a rectangle across a 10 m street (CCW rings -> outward right-hand normals)
    aL, bL = _ccw([[0, 0], [24, 0], [24, 8], [10, 8], [10, 16], [0, 16]])
    aR, bR = _ccw([[0, -22], [20, -22], [20, -10], [0, -10]])
    a, b = np.vstack([aL, aR]), np.vstack([bL, bR])
    wn = S.segment_normals(a, b)
    # the camera saw the street side of both + the L's inner corner; points carry outward normals
    seen = [0, 1, 2, 3, 8]
    p, phi = [], []
    for k in seen:
        t = rng.random(300)[:, None]
        p.append(a[k] + t * (b[k] - a[k]) + rng.normal(scale=0.03, size=(300, 1)) * wn[k])
        phi.append(np.full(300, math.atan2(wn[k, 1], wn[k, 0])))
    pw, phw = np.vstack(p), np.concatenate(phi)
    s, th, t = 0.37, math.radians(123), np.array([381460.0, 5462250.0])
    a, b = a + t, b + t
    pw = pw + t
    # mesh frame: inverse similarity
    pm = ((pw - t) @ S.rot2(th)) / s
    psi = phw - th
    clutter = rng.uniform(pm.min(0), pm.max(0), size=(400, 2))
    pm = np.vstack([pm, clutter])
    psi = np.concatenate([psi, rng.uniform(-math.pi, math.pi, 400)])

    anchor = t + [12, -5]
    pivot = pm.mean(0)
    s0 = s * 1.07  # scale prior 7 % off
    scales = s0 * np.exp(np.arange(math.log(0.85), math.log(1.15), math.log(1.04)))
    thetas = np.radians(np.arange(0, 360, 2.0))
    cands = global_search(pm, psi, a, b, anchor, pivot, scales, thetas, radius=35, t_radius=25)
    sc, s1, th1, pe, pn, _ = cands[0]
    assert abs((th1 - th + math.pi) % (2 * math.pi) - math.pi) < math.radians(3)
    assert s1 == pytest.approx(s, rel=0.05)

    n2 = np.stack([np.cos(psi), np.sin(psi)], 1)
    x = (s1, th1, *(np.array([pe, pn]) - s1 * S.rot2(th1) @ pivot))
    for md in (2.0, 1.0, 0.6):
        x, info = S.fit_similarity_2d(pm, n2, a, b, x, max_dist=md)
    assert x[0] == pytest.approx(s, rel=2e-3)
    assert math.degrees(x[1]) % 360 == pytest.approx(123, abs=0.1)
    assert np.allclose(x[2:], t, atol=0.05)


def test_crop_mask_radius_and_height():
    c = np.array([[0, 240, 0], [30, 240, 0], [0, 240, -45], [3, 300, 4], [3, 230, 4]], float)
    keep = crop_mask(c, 40.0, (235.0, 270.0))
    assert keep.tolist() == [True, True, False, False, False]


def test_inside_walls_survives_split_walls():
    # rectangle 10 x 6, south wall split in two pieces (LoD2 often splits a wall into several polygons)
    a, b = _ccw([[0, 0], [10, 0], [10, 6], [0, 6]])
    a = np.vstack([a, [[0, 0]]])
    b = np.vstack([b, [[4, 0]]])  # duplicate piece of the south wall
    q = np.array([[5, 3], [0.2, 0.2], [9.9, 5.9], [5, -0.3], [-1, 3], [11, 3], [5, 6.5]], float)
    assert inside_walls(q, a, b).tolist() == [True, True, True, False, False, False, False]


def test_classify_indoor_needs_a_ceiling_not_a_few_stray_faces():
    rng = np.random.default_rng(1)
    ceiling = np.c_[rng.uniform(0, 5, (400, 2)), np.full(400, 2.5)]            # room 0..5 x 0..5, ceiling at 2.5
    stray = np.c_[rng.uniform(10, 11, (4, 2)), np.full(4, 6.0)]               # a few sky-sheet faces over the street
    cams = np.array([[2.5, 2.5, 1.4], [1, 4, 1.4], [10.5, 10.5, 1.4], [20, 20, 1.4]])
    assert classify_indoor(np.vstack([ceiling, stray]), cams).tolist() == [True, True, False, False]


def test_exterior_mask_keeps_the_facade_and_drops_room_walls():
    # facade y = 0 seen from the street (y < 0); a room behind it seen from inside
    fac = np.c_[np.linspace(0, 10, 50), np.zeros(50)]
    room = np.c_[np.full(50, 2.0), np.linspace(1, 5, 50)]                      # room wall x = 2, faces +x (room side)
    p2 = np.vstack([fac, room])
    n2 = np.vstack([np.tile([0, -1.0], (50, 1)), np.tile([1.0, 0], (50, 1))])
    cams = np.vstack([np.c_[np.linspace(0, 10, 20), np.full(20, -1.0)], np.c_[np.full(20, 4.0), np.linspace(1, 5, 20)]])
    indoor = np.r_[np.zeros(20, bool), np.ones(20, bool)]
    ext = exterior_mask(p2, n2, cams, indoor)
    assert ext[:50].all() and not ext[50:].any()


def test_free_space_term_puts_the_shop_into_the_zone_building():
    # two row houses with one straight, collinear facade (y = 0, facing south); the zone is the eastern one.
    # Walls alone cannot tell where along the facade the walk was -- the indoor cameras can.
    # (6 m deep, so the 8 m facade in view does not fit a gable; a backyard neighbour rules out the mirrored fit)
    aA, bA = _ccw([[0, 0], [20, 0], [20, 6], [0, 6]])
    aB, bB = _ccw([[20, 0], [40, 0], [40, 6], [20, 6]])
    aC, bC = _ccw([[0, 6.5], [40, 6.5], [40, 30], [0, 30]])
    a, b = np.vstack([aA, aB, aC]), np.vstack([bA, bB, bC])
    bid = np.array(["A"] * 4 + ["B"] * 4 + ["C"] * 4)
    t = np.array([381000.0, 5462000.0])
    a, b = a + t, b + t
    # mesh (scale 1, rotated by -30 deg): facade x 26..34, street cams in front, shop cams behind it
    fac = np.c_[np.linspace(26, 34, 400), np.zeros(400)]
    shop = np.c_[np.random.default_rng(2).uniform(27, 33, 60), np.random.default_rng(3).uniform(2, 5, 60)]
    street = np.c_[np.linspace(24, 34, 20), np.full(20, -1.0)]
    th = math.radians(30)
    to_mesh = lambda w: w @ S.rot2(th)  # inverse rotation by theta (row vectors)
    pm, sm, cm = to_mesh(fac), to_mesh(shop), to_mesh(street)
    psi = np.full(len(pm), math.atan2(-1, 0) - th)
    anchor = t + [30, 5]
    g, radius = 0.4, 45
    origin = anchor - radius
    n = int(math.ceil(2 * radius / g))
    zsel = bid == "B"
    in_mask = footprint_grid(a[zsel], b[zsel], bid[zsel], origin, n, g)
    free_mask = ~footprint_grid(a, b, bid, origin, n, g)
    pivot = sm.mean(0)
    cands = global_search(pm, psi, a, b, anchor, pivot, np.array([1.0]), np.radians(np.arange(0, 360, 2.0)),
                          g=g, radius=radius, t_radius=30, cams_in=sm, cams_out=cm, in_mask=in_mask,
                          free_mask=free_mask)
    _, s, th1, pe, pn, cons = cands[0]
    assert abs((th1 - th + math.pi) % (2 * math.pi) - math.pi) < math.radians(3)
    x = (s, th1, *(np.array([pe, pn]) - s * S.rot2(th1) @ pivot))
    shop_w = S.apply_sim2(x, sm)
    assert inside_buildings(shop_w, a[zsel], b[zsel], bid[zsel]).mean() > 0.95
    assert not inside_buildings(S.apply_sim2(x, cm), a, b, bid).any()
    assert cons > 0.95
