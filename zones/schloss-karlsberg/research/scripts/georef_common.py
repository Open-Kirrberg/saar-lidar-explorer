"""Shared helpers for georeferencing scanned plans/maps against the LiDAR relief (EPSG:25832).

Plan pixel coordinates (x right, y down) are fitted with X = x, Y = -y so that a similarity has no reflection.
Pure numpy; rendering uses matplotlib + rasterio (the pipeline's uv env).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[4]
SK = ROOT / "zones" / "schloss-karlsberg"


def _design(px: np.ndarray, kind: str) -> np.ndarray:
    X, Y = px[:, 0], -px[:, 1]
    one, zero = np.ones_like(X), np.zeros_like(X)
    if kind == "similarity":  # E = a X - b Y + c ; N = b X + a Y + d
        top = np.c_[X, -Y, one, zero]
        bot = np.c_[Y, X, zero, one]
        return np.r_[top, bot]
    if kind == "affine":  # E = p0 + p1 X + p2 Y ; N = q0 + q1 X + q2 Y
        top = np.c_[one, X, Y, zero, zero, zero]
        bot = np.c_[zero, zero, zero, one, X, Y]
        return np.r_[top, bot]
    raise ValueError(kind)


def fit(px, en, kind="similarity", w=None):
    px, en = np.asarray(px, float), np.asarray(en, float)
    w = np.ones(len(px)) if w is None else np.asarray(w, float)
    A = _design(px, kind)
    b = np.r_[en[:, 0], en[:, 1]]
    W = np.sqrt(np.r_[w, w])
    p, *_ = np.linalg.lstsq(A * W[:, None], b * W, rcond=None)
    return {"kind": kind, "p": p.tolist()}


def apply(T, px) -> np.ndarray:
    px = np.atleast_2d(np.asarray(px, float))
    A = _design(px, T["kind"])
    v = A @ np.asarray(T["p"])
    n = len(px)
    return np.c_[v[:n], v[n:]]


def inverse(T, en) -> np.ndarray:
    """EPSG:25832 -> plan pixel (x, y down)."""
    en = np.atleast_2d(np.asarray(en, float))
    p = T["p"]
    if T["kind"] == "similarity":
        a, b, c, d = p
        M = np.array([[a, -b], [b, a]]); t = np.array([c, d])
    else:
        M = np.array([[p[1], p[2]], [p[4], p[5]]]); t = np.array([p[0], p[3]])
    XY = np.linalg.solve(M, (en - t).T).T
    return np.c_[XY[:, 0], -XY[:, 1]]


def describe(T) -> dict:
    p = T["p"]
    if T["kind"] == "similarity":
        a, b = p[0], p[1]
        s = float(np.hypot(a, b)); rot = float(np.degrees(np.arctan2(b, a)))
        # direction of the plan's "up" (-y in pixels = +Y) as a grid azimuth
        up = np.array([-b, a])
        az_up = float(np.degrees(np.arctan2(up[0], up[1])) % 360)
        return {"scale_m_per_px": round(s, 4), "rotation_deg_ccw": round(rot, 2), "plan_up_grid_azimuth_deg": round(az_up, 2)}
    M = np.array([[p[1], p[2]], [p[4], p[5]]])
    sx = float(np.hypot(M[0, 0], M[1, 0])); sy = float(np.hypot(M[0, 1], M[1, 1]))
    shear = float(np.degrees(np.arccos(np.dot(M[:, 0], M[:, 1]) / (sx * sy))))
    up = M[:, 1]
    return {"scale_x": round(sx, 4), "scale_y": round(sy, 4), "axis_angle_deg": round(shear, 2),
            "plan_up_grid_azimuth_deg": round(float(np.degrees(np.arctan2(up[0], up[1])) % 360), 2)}


def residuals(T, px, en):
    r = apply(T, px) - np.asarray(en, float)
    return r, float(np.sqrt((r ** 2).sum(1).mean()))


def loo(px, en, kind, w=None):
    """Leave-one-out residual per point (m)."""
    px, en = np.asarray(px, float), np.asarray(en, float)
    out = []
    for i in range(len(px)):
        m = np.ones(len(px), bool); m[i] = False
        T = fit(px[m], en[m], kind, None if w is None else np.asarray(w)[m])
        out.append(float(np.hypot(*(apply(T, px[i:i + 1])[0] - en[i]))))
    return out


def load_features():
    g = json.loads((SK / "research/lidar_features.geojson").read_text())
    return {f["properties"]["id"]: f for f in g["features"]}


def load_catalogue():
    return json.loads((SK / "model/catalogue.json").read_text())


def centroid(coords):
    a = np.asarray(coords, float)
    if len(a) > 1 and np.allclose(a[0], a[-1]):
        a = a[:-1]
    return a.mean(0)
