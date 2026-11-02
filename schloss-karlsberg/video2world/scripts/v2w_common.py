"""Shared helpers for the Karlsberg reference-mesh scripts (numpy only + rasterio for LiDAR).

Frames used here:
  mesh   - raw Object Capture frame (arbitrary scale/rotation, nominally Y-up but unreliable)
  ENh    - EPSG:25832 E, N + DHHN2016 h (right-handed: x=E, y=N, z=h)
  local  - explorer frame x = E - 381000, y = h, z = -(N - 5465000)
  uv     - palace grid (catalogue.json palace_grid): origin E 382226 / N 5466120, u along az 80.5 deg (grid)
"""
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
V2W = os.path.dirname(HERE)
SK = os.path.dirname(V2W)  # schloss-karlsberg/
REPO = os.path.dirname(SK)
WORK = os.path.join(V2W, "work")
LIDAR_DIR = os.path.join(REPO, "data", "work", "karlsberg")
E0, N0 = 381000.0, 5465000.0
COURT_H = 344.8

# palace grid (catalogue.json)
PG_E, PG_N = 382226.0, 5466120.0
_CU, _SU = 0.98629, 0.16505  # E = PG_E + cu*u - su*v ; N = PG_N + su*u + cu*v


def uv_to_en(u, v):
    u = np.asarray(u, float)
    v = np.asarray(v, float)
    return PG_E + _CU * u - _SU * v, PG_N + _SU * u + _CU * v


def en_to_uv(e, n):
    de = np.asarray(e, float) - PG_E
    dn = np.asarray(n, float) - PG_N
    return _CU * de + _SU * dn, -_SU * de + _CU * dn


def enh_to_local(p):
    p = np.asarray(p, float)
    return np.stack([p[..., 0] - E0, p[..., 2], -(p[..., 1] - N0)], axis=-1)


def load_obj(path):
    """Minimal OBJ reader: returns vertices (n,3) float64, faces (m,3) int (triangulated fan), uv-less."""
    vs, fs = [], []
    with open(path) as f:
        for line in f:
            if line.startswith("v "):
                vs.append(line.split()[1:4])
            elif line.startswith("f "):
                idx = [int(t.split("/")[0]) for t in line.split()[1:]]
                for k in range(1, len(idx) - 1):
                    fs.append((idx[0], idx[k], idx[k + 1]))
    v = np.asarray(vs, float)
    f = np.asarray(fs, int)
    f = np.where(f < 0, f + len(v), f - 1)
    return v, f


def find_obj(oc_dir):
    m = os.path.join(oc_dir, "model")
    objs = [x for x in os.listdir(m) if x.endswith(".obj")]
    return os.path.join(m, objs[0])


def load_ply_points(path):
    with open(path, "rb") as f:
        hdr = b""
        while not hdr.endswith(b"end_header\n"):
            hdr += f.readline()
        n = int([l for l in hdr.split(b"\n") if l.startswith(b"element vertex")][0].split()[-1])
        dt = np.dtype([("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("r", "u1"), ("g", "u1"), ("b", "u1")])
        a = np.frombuffer(f.read(n * dt.itemsize), dtype=dt, count=n)
    return np.stack([a["x"], a["y"], a["z"]], 1).astype(float), np.stack([a["r"], a["g"], a["b"]], 1)


def write_obj(path, v, f, header=""):
    with open(path, "w") as fh:
        for line in header.splitlines():
            fh.write(f"# {line}\n")
        np.savetxt(fh, v, fmt="v %.3f %.3f %.3f")
        np.savetxt(fh, f + 1, fmt="f %d %d %d")


def sample_surface(v, f, density, rng=None):
    """Area-weighted random points on triangles; density = points per unit^2 (in the mesh's units)."""
    rng = rng or np.random.default_rng(0)
    a, b, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    cnt = rng.poisson(area * density)
    idx = np.repeat(np.arange(len(f)), cnt)
    r1 = np.sqrt(rng.random(len(idx)))
    r2 = rng.random(len(idx))
    p = (1 - r1)[:, None] * a[idx] + (r1 * (1 - r2))[:, None] * b[idx] + (r1 * r2)[:, None] * c[idx]
    return p, idx


def face_normals(v, f):
    n = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    area = 0.5 * np.linalg.norm(n, axis=1)
    return n / np.maximum(2 * area, 1e-12)[:, None], area


def umeyama(src, dst, with_scale=True):
    """dst ~= s * R @ src + t  (src, dst: (n,3))."""
    mu_s, mu_d = src.mean(0), dst.mean(0)
    S, D = src - mu_s, dst - mu_d
    U, sig, Vt = np.linalg.svd(D.T @ S / len(src))
    C = np.eye(3)
    C[2, 2] = np.sign(np.linalg.det(U @ Vt))
    R = U @ C @ Vt
    s = (sig * np.diag(C)).sum() / (S ** 2).sum(axis=1).mean() if with_scale else 1.0
    return s, R, mu_d - s * R @ mu_s


def grid_max(p, x0, y0, res, nx, ny):
    """Max-z raster of points p (x,y,z) on a grid with origin (x0, y0 = top/north edge), res metres."""
    ix = ((p[:, 0] - x0) / res).astype(int)
    iy = ((y0 - p[:, 1]) / res).astype(int)
    ok = (ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny)
    out = np.full(ny * nx, -np.inf)
    np.maximum.at(out, iy[ok] * nx + ix[ok], p[ok, 2])
    out = out.reshape(ny, nx)
    out[~np.isfinite(out)] = np.nan
    return out


def load_catalogue():
    return json.load(open(os.path.join(SK, "model", "catalogue.json")))


def load_lidar_features():
    return json.load(open(os.path.join(SK, "research", "lidar_features.geojson")))


def read_raster_window(name, e_min, e_max, n_min, n_max):
    """Read data/work/karlsberg/<name>.tif window (read-only). Returns array (rows north->south) + (e0, n_top)."""
    import rasterio
    from rasterio.windows import from_bounds

    with rasterio.open(os.path.join(LIDAR_DIR, f"{name}.tif")) as r:
        w = from_bounds(e_min, n_min, e_max, n_max, r.transform).round_offsets().round_lengths()
        a = r.read(1, window=w).astype(float)
        t = r.window_transform(w)
    return a, (t.c, t.f)


def dtm_at(e, n):
    """Bilinear-ish (nearest cell) DTM height at points (read-only)."""
    import rasterio

    with rasterio.open(os.path.join(LIDAR_DIR, "dtm.tif")) as r:
        vals = np.array([x[0] for x in r.sample(list(zip(np.ravel(e), np.ravel(n))))], float)
    return vals.reshape(np.shape(e))
