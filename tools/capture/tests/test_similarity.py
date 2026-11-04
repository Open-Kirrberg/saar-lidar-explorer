import numpy as np
import pytest

from capture import similarity as S


def rot3(axis, ang):
    axis = np.asarray(axis, float) / np.linalg.norm(axis)
    k = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    return np.eye(3) + np.sin(ang) * k + (1 - np.cos(ang)) * k @ k


def test_umeyama_recovers_similarity():
    rng = np.random.default_rng(1)
    src = rng.normal(size=(50, 3))
    R = rot3([1, 2, 3], 0.7)
    dst = 2.5 * src @ R.T + np.array([10, -4, 3])
    s, R2, t = S.umeyama(src, dst)
    assert s == pytest.approx(2.5)
    assert np.allclose(R2, R) and np.allclose(t, [10, -4, 3])


def test_umeyama_never_reflects():
    rng = np.random.default_rng(2)
    src = rng.normal(size=(30, 3))
    dst = src * np.array([1, 1, -1])  # mirror image: best proper rotation, det +1
    _, R, _ = S.umeyama(src, dst)
    assert np.linalg.det(R) == pytest.approx(1.0)


@pytest.mark.parametrize("u", [[0, 0, 1], [0, 0, -1], [1, 0, 0], [0.3, -0.5, 0.8]])
def test_rotation_to_z(u):
    R = S.rotation_to_z(np.array(u))
    assert np.allclose(R @ (np.array(u) / np.linalg.norm(u)), [0, 0, 1])
    assert np.allclose(R @ R.T, np.eye(3)) and np.linalg.det(R) == pytest.approx(1.0)


def _box_walls(x0, y0, x1, y1):
    """Counter-clockwise in plan view -> right-hand normals of a->b point outward."""
    pts = np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], float)
    return pts, np.roll(pts, -1, axis=0)


def _sample_outside(a, b, n_per, rng, noise=0.0):
    wn = S.segment_normals(a, b)
    p, n = [], []
    for ai, bi, ni in zip(a, b, wn):
        t = rng.random(n_per)[:, None]
        p.append(ai + t * (bi - ai) + rng.normal(scale=noise, size=(n_per, 1)) * ni)
        n.append(np.repeat(ni[None], n_per, 0))
    return np.vstack(p), np.vstack(n)


def test_segment_normals_point_outward_for_ccw_plan():
    a, b = _box_walls(0, 0, 10, 5)
    wn = S.segment_normals(a, b)
    mid = (a + b) / 2
    assert np.all(((mid - [5, 2.5]) * wn).sum(1) > 0)


def test_fit_similarity_2d_recovers_transform_with_outliers():
    rng = np.random.default_rng(3)
    a, b = _box_walls(100, 200, 124, 210)  # 24 x 10 m building in "world"
    pw, nw = _sample_outside(a, b, 200, rng, noise=0.03)
    true = (1.7, np.radians(33), 100.0, 200.0)
    # mesh frame = inverse transform of the world points
    s, th, tx, ty = true
    pm = ((pw - [tx, ty]) @ S.rot2(th)) / s
    nm = nw @ S.rot2(th)
    # interior partition walls + clutter, which have no LoD2 counterpart
    clutter = rng.uniform(pm.min(0), pm.max(0), size=(300, 2))
    cn = rng.normal(size=(300, 2))
    cn /= np.linalg.norm(cn, axis=1, keepdims=True)
    p = np.vstack([pm, clutter])
    n = np.vstack([nm, cn])
    init = (1.6, np.radians(30), 101.0, 199.0)
    x, info = S.fit_similarity_2d(p, n, a, b, init, max_dist=2.0)
    assert x[0] == pytest.approx(1.7, rel=2e-3)
    assert np.degrees(x[1]) == pytest.approx(33, abs=0.1)
    assert x[2] == pytest.approx(100, abs=0.05) and x[3] == pytest.approx(200, abs=0.05)
    assert info["median_abs"] < 0.05


def test_fit_ignores_interior_surface_of_walls():
    rng = np.random.default_rng(4)
    a, b = _box_walls(0, 0, 20, 10)
    p_out, n_out = _sample_outside(a, b, 100, rng)
    # interior surfaces 0.4 m inside, normals facing inward: must not pull the fit
    wn = S.segment_normals(a, b)
    p_in, n_in = _sample_outside(a, b, 300, rng)
    k = np.repeat(np.arange(4), 300)
    p_in = p_in - 0.4 * wn[k]
    n_in = -n_in
    p, n = np.vstack([p_out, p_in]), np.vstack([n_out, n_in])
    x, info = S.fit_similarity_2d(p, n, a, b, (1.02, 0.01, 0.2, -0.2), max_dist=1.0)
    assert x[0] == pytest.approx(1.0, abs=2e-3)
    assert abs(x[2]) < 0.03 and abs(x[3]) < 0.03


def test_intersect_lines_and_line_fit():
    c, d = S.line_fit(np.array([[0, 0], [1, 1], [2, 2.0]]))
    assert abs(abs(d @ np.array([1, 1]) / np.sqrt(2)) - 1) < 1e-9
    p = S.intersect_lines(np.array([0, 1.0]), np.array([1, 0.0]), np.array([3, 0.0]), np.array([0, 1.0]))
    assert np.allclose(p, [3, 1])
    assert S.intersect_lines(np.zeros(2), np.array([1, 0.0]), np.ones(2), np.array([1, 0.0])) is None
