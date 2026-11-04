"""Pure geometry for georeferencing: rotations, Umeyama 3D similarity, robust 2D similarity to wall segments.

2D similarity params are (s, theta, tx, ty):  p' = s * R(theta) @ p + t.
"""
from __future__ import annotations

import numpy as np


def rot2(theta: float) -> np.ndarray:
    c, s = np.cos(theta), np.sin(theta)
    return np.array([[c, -s], [s, c]])


def apply_sim2(params, p: np.ndarray) -> np.ndarray:
    s, th, tx, ty = params
    return s * p @ rot2(th).T + np.array([tx, ty])


def rotation_to_z(u: np.ndarray) -> np.ndarray:
    """Rotation matrix R with R @ u = +z (Rodrigues; handles u = -z)."""
    u = np.asarray(u, float) / np.linalg.norm(u)
    z = np.array([0.0, 0.0, 1.0])
    v = np.cross(u, z)
    c = float(u @ z)
    if np.linalg.norm(v) < 1e-12:
        return np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    k = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + k + k @ k * (1 / (1 + c))


def umeyama(src: np.ndarray, dst: np.ndarray, with_scale: bool = True):
    """dst ~= s * R @ src + t  (src, dst: (n, d)). Returns s, R, t."""
    src, dst = np.asarray(src, float), np.asarray(dst, float)
    mu_s, mu_d = src.mean(0), dst.mean(0)
    S, D = src - mu_s, dst - mu_d
    U, sig, Vt = np.linalg.svd(D.T @ S / len(src))
    C = np.eye(src.shape[1])
    C[-1, -1] = np.sign(np.linalg.det(U @ Vt))
    R = U @ C @ Vt
    s = (sig * np.diag(C)).sum() / (S ** 2).sum(axis=1).mean() if with_scale else 1.0
    return float(s), R, mu_d - s * R @ mu_s


def point_segment(p: np.ndarray, a: np.ndarray, b: np.ndarray):
    """Distances from points p (n,2) to every segment (m: a,b (m,2)). Returns (n,m) distance and (n,m) t in [0,1]."""
    ab = b - a
    L2 = np.maximum((ab ** 2).sum(1), 1e-12)
    t = np.clip(((p[:, None, :] - a[None]) * ab[None]).sum(2) / L2[None], 0, 1)
    q = a[None] + t[..., None] * ab[None]
    return np.linalg.norm(p[:, None, :] - q, axis=2), t


def segment_normals(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    d = (b - a) / np.linalg.norm(b - a, axis=1, keepdims=True)
    return np.stack([d[:, 1], -d[:, 0]], 1)  # right-hand normal of a->b


def match_points(p, n, a, b, wn, max_dist, min_cos=0.7, interior_band=0.0):
    """Nearest compatible segment per point: normal of the point agrees with the wall's outward normal (dot >=
    min_cos) and lies within max_dist. With interior_band > 0, points whose normal *opposes* the wall normal and
    that lie up to interior_band *inside* it are ignored rather than mis-assigned. Returns (idx, dist) with -1 = none."""
    d, _ = point_segment(p, a, b)
    cos = n @ wn.T if n is not None else np.ones_like(d)
    d = np.where(cos >= min_cos, d, np.inf)
    j = np.argmin(d, axis=1)
    dj = d[np.arange(len(p)), j]
    j = np.where(dj <= max_dist, j, -1)
    return j, dj


def fit_similarity_2d(p: np.ndarray, n: np.ndarray | None, a: np.ndarray, b: np.ndarray, init,
                      max_dist: float = 1.0, iters: int = 30, f_scale: float = 0.15, min_cos: float = 0.7,
                      fix_scale: bool = False, scale_bounds: tuple[float, float] | None = None):
    """Robust ICP of points (with 2D normals) to wall segments, point-to-line, soft-L1 loss.

    p, n   mesh points and unit normals in the levelled mesh frame (n may be None = ignore orientation)
    a, b   wall segments in the target frame, ordered so that the right-hand normal of a->b points outward
           (lod2.load_walls orders them by the wall polygon's Newell normal)
    init   (s, theta, tx, ty)
    scale_bounds  (lo, hi) keeps s from collapsing onto a single wall (a straight facade alone fixes no scale)
    Returns params, info {inliers, rms, median_abs, per-point idx/residual}.
    """
    from scipy.optimize import least_squares

    a_all, b_all = np.asarray(a, float), np.asarray(b, float)
    x = np.array(init, float)
    # only walls near the points (bbox + margin) take part -- keeps the (points x walls) distance matrix small
    q0 = apply_sim2(x, p)
    m = max_dist + 5.0
    lo, hi = q0.min(0) - m, q0.max(0) + m
    near = np.nonzero(((np.maximum(a_all, b_all) >= lo) & (np.minimum(a_all, b_all) <= hi)).all(1))[0]
    if len(near) == 0:
        return x, {"inliers": 0, "rms": float("nan"), "median_abs": float("nan"),
                   "idx": np.full(len(p), -1), "signed": np.full(len(p), np.nan)}
    a, b = a_all[near], b_all[near]
    wn = segment_normals(a, b)
    idx = np.full(len(p), -1)
    for it in range(iters):
        q = apply_sim2(x, p)
        qn = None if n is None else n @ rot2(x[1]).T
        idx, _ = match_points(q, qn, a, b, wn, max_dist, min_cos)
        sel = idx >= 0
        if sel.sum() < 10:
            break
        ps, segs = p[sel], idx[sel]
        an, nn = a[segs], wn[segs]

        def res(v):
            par = v if not fix_scale else np.r_[x[0], v]
            return ((apply_sim2(par, ps) - an) * nn).sum(1)

        v0 = x if not fix_scale else x[1:]
        bounds = (-np.inf, np.inf)
        if scale_bounds is not None and not fix_scale:
            lo, hi = scale_bounds
            v0 = v0.copy()
            v0[0] = np.clip(v0[0], lo * (1 + 1e-9), hi * (1 - 1e-9))
            bounds = ([lo, -np.inf, -np.inf, -np.inf], [hi, np.inf, np.inf, np.inf])
        r = least_squares(res, v0, loss="soft_l1", f_scale=f_scale, bounds=bounds)
        new = r.x if not fix_scale else np.r_[x[0], r.x]
        step = np.abs(new - x)
        x = new
        if step[0] < 1e-6 * max(abs(x[0]), 1e-9) and step[1] < 1e-7 and step[2:].max() < 1e-4:
            break
    q = apply_sim2(x, p)
    qn = None if n is None else n @ rot2(x[1]).T
    idx, dist = match_points(q, qn, a, b, wn, max_dist, min_cos)
    sel = idx >= 0
    signed = np.full(len(p), np.nan)
    if sel.any():
        signed[sel] = ((q[sel] - a[idx[sel]]) * wn[idx[sel]]).sum(1)
    idx = np.where(sel, near[np.maximum(idx, 0)], -1)  # back to indices into the caller's a/b
    r = signed[sel]
    info = {"inliers": int(sel.sum()), "rms": float(np.sqrt(np.mean(r ** 2))) if len(r) else float("nan"),
            "median_abs": float(np.median(np.abs(r))) if len(r) else float("nan"), "idx": idx, "signed": signed}
    return x, info


def line_fit(p: np.ndarray):
    """Total-least-squares 2D line: returns (centroid, unit direction)."""
    c = p.mean(0)
    _, _, vt = np.linalg.svd(p - c, full_matrices=False)
    return c, vt[0]


def intersect_lines(c1, d1, c2, d2):
    A = np.array([d1, -d2]).T
    if abs(np.linalg.det(A)) < 1e-9:
        return None
    t = np.linalg.solve(A, c2 - c1)
    return c1 + t[0] * d1
