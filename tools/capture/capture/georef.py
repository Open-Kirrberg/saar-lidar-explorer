"""Stage `georef`: scale + georeference the Object Capture mesh against LoD2 walls and the DTM.

1. Level: "up" starts as the mean camera up-vector (a handheld camera is held roughly upright) and is refined by
   mean shift on near-horizontal face normals (floors, street, ceilings).
2. Scale: camera height above floor/street (heaviest up-facing level below the cameras) = `camera_height_m`.
   The walls of a street walk-through rarely fix scale (one straight facade, one corner), so the scale is not fitted;
   the room height is reported as a check.
3. Indoor/outdoor cameras (a ceiling above or not); exterior wall points = faces seen mostly from outdoor cameras.
   Interior room walls never take part: they would match the gaps between LoD2 buildings.
4. Plan fit, scale fixed:
   a) global search over rotation; translation by FFT correlation of the exterior points against an orientation-aware
      LoD2 wall-proximity map, times a free-space term (indoor cameras inside the zone building, outdoor cameras
      outside every LoD2 footprint);
   b) robust ICP (point-to-line, soft-L1, similarity.fit_similarity_2d) from the best candidates; the pick is
      inliers x camera consistency^4.
5. Height: street ground below the outdoor cameras, outside every footprint, onto the DTM.
6. Residuals: walls, footprint corners in view, ground vs DTM, eaves where the mesh reaches them, ambiguity
   (2nd-best vs best) and an along-wall shift profile. Output: <work>/georef.json (4x4 mesh -> EPSG:25832/DHHN2016
   and -> zone-local), QA top view.
"""
from __future__ import annotations

import json
import math

import numpy as np

from . import lod2
from . import similarity as S
from .common import DATA, REPO, Zone, save_json


# --------------------------------------------------------------------------------------------- mesh I/O (numpy)

def load_obj_geom(path):
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
    return v, np.where(f < 0, f + len(v), f - 1)


def face_normals(v, f):
    n = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    a = 0.5 * np.linalg.norm(n, axis=1)
    return n / np.maximum(2 * a, 1e-15)[:, None], a


def sample_faces(v, f, sel, n_pts, rng):
    """Area-weighted random points on the selected faces; returns points and the face index of each."""
    fi = np.nonzero(sel)[0]
    a = 0.5 * np.linalg.norm(np.cross(v[f[fi, 1]] - v[f[fi, 0]], v[f[fi, 2]] - v[f[fi, 0]]), axis=1)
    pick = rng.choice(fi, size=n_pts, p=a / a.sum())
    r1 = np.sqrt(rng.random(n_pts))[:, None]
    r2 = rng.random(n_pts)[:, None]
    A, B, C = v[f[pick, 0]], v[f[pick, 1]], v[f[pick, 2]]
    return (1 - r1) * A + r1 * (1 - r2) * B + r1 * r2 * C, pick


def quat_to_R(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


# --------------------------------------------------------------------------------------------- level

def level(n, area, cam_up, tol_deg=15.0, iters=50):
    """Up vector: mean camera up, refined by mean shift on near-horizontal face normals."""
    u = cam_up / np.linalg.norm(cam_up)
    for _ in range(iters):
        d = n @ u
        sel = np.abs(d) > math.cos(math.radians(tol_deg))
        m = (np.sign(d[sel])[:, None] * n[sel] * area[sel][:, None]).sum(0)
        new = m / np.linalg.norm(m)
        done = math.degrees(math.acos(min(1.0, float(new @ u)))) < 0.005
        u = new
        if done:
            break
    if u @ cam_up < 0:
        u = -u
    return u


# --------------------------------------------------------------------------------------------- rasters

def raster_sample(path, e, n, bilinear=True):
    """Sample a north-up GeoTIFF (PixelIsArea) at E/N; NaN outside."""
    import rasterio

    with rasterio.open(path) as r:
        e = np.asarray(e, float)
        n = np.asarray(n, float)
        pad = 3
        w = rasterio.windows.from_bounds(e.min() - pad, n.min() - pad, e.max() + pad, n.max() + pad, r.transform)
        w = w.round_offsets().round_lengths()
        a = r.read(1, window=w, boundless=True, fill_value=np.nan).astype(float)
        if r.nodata is not None:
            a[a == r.nodata] = np.nan
        t = r.window_transform(w)
    # cell centres at (c + 0.5, r + 0.5)
    fc = (e - t.c) / t.a - 0.5
    fr = (n - t.f) / t.e - 0.5
    if not bilinear:
        ci, ri = np.round(fc).astype(int), np.round(fr).astype(int)
        ok = (ci >= 0) & (ci < a.shape[1]) & (ri >= 0) & (ri < a.shape[0])
        out = np.full(e.shape, np.nan)
        out[ok] = a[ri[ok], ci[ok]]
        return out
    c0, r0 = np.floor(fc).astype(int), np.floor(fr).astype(int)
    dc, dr = fc - c0, fr - r0
    out = np.full(e.shape, np.nan)
    ok = (c0 >= 0) & (c0 + 1 < a.shape[1]) & (r0 >= 0) & (r0 + 1 < a.shape[0])
    c0, r0, dc, dr = c0[ok], r0[ok], dc[ok], dr[ok]
    out[ok] = (a[r0, c0] * (1 - dc) * (1 - dr) + a[r0, c0 + 1] * dc * (1 - dr)
               + a[r0 + 1, c0] * (1 - dc) * dr + a[r0 + 1, c0 + 1] * dc * dr)
    return out


def wall_maps(a, b, origin, shape, g, sigma):
    """Proximity map G = exp(-d^2/2 sigma^2) to the nearest wall and Gc = G * exp(i phi_outward(nearest wall)).
    Arrays are indexed [iy, ix] with y = N increasing with the row index."""
    import cv2

    h, w = shape
    lab = np.zeros((h, w), np.int32)  # 0 = no wall; wall k -> k+1
    for k, (p, q) in enumerate(zip(a, b)):
        x0, y0 = ((p - origin) / g)
        x1, y1 = ((q - origin) / g)
        cv2.line(lab, (int(round(x0)), int(round(y0))), (int(round(x1)), int(round(y1))), k + 1, 1)
    src = (lab == 0).astype(np.uint8)
    d, lbl = cv2.distanceTransformWithLabels(src, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    # map pixel labels back to wall ids
    ys, xs = np.nonzero(lab)
    pix_wall = np.zeros(lbl.max() + 1, np.int32)
    pix_wall[lbl[ys, xs]] = lab[ys, xs] - 1
    nearest = pix_wall[lbl]
    wn = S.segment_normals(a, b)
    phi = np.arctan2(wn[:, 1], wn[:, 0])
    G = np.exp(-(d * g) ** 2 / (2 * sigma ** 2)).astype(np.float32)
    Gc = (G * np.exp(1j * phi[nearest])).astype(np.complex64)
    return G, Gc


def global_search(p, psi, a, b, anchor, pivot, scales, thetas, g=0.4, sigma=0.8, radius=90.0, t_radius=45.0,
                  top=8, workers=8, cams_in=None, cams_out=None, in_mask=None, free_mask=None, cam_power=4.0):
    """Exhaustive rotation x scale search; translation by FFT correlation. Returns candidates sorted by score:
    (score, s, theta, E, N of the mesh pivot, camera consistency).

    Wall term: sum over points of G * (1 + cos(phi_wall - phi_point)) / 2.
    Free-space term (optional; masks on the wall-map grid, see footprint_grid): mean of the share of
    indoor cameras inside `in_mask` (the zone building) and the share of outdoor cameras inside `free_mask` (outside
    every building); the score is multiplied by that share ** cam_power. A straight facade alone fits any long wall -- the cameras' free space is what pins
    scale and position along it."""
    from concurrent.futures import ThreadPoolExecutor

    from scipy.signal import fftconvolve

    origin = np.array(anchor) - radius
    n = int(math.ceil(2 * radius / g))
    G, Gc = wall_maps(a, b, origin, (n, n), g, sigma)
    use_cams = in_mask is not None and free_mask is not None and cams_in is not None and cams_out is not None \
        and len(cams_in) + len(cams_out) > 0
    if use_cams:
        Bm = in_mask.astype(np.float32)
        Fm = free_mask.astype(np.float32)
        ci0, co0 = cams_in - pivot, cams_out - pivot
    q0 = p - pivot

    def grid(q, mn, shape, w=None):
        ij = np.floor((q - mn) / g).astype(int)
        A = np.zeros(shape, np.complex64 if w is not None and np.iscomplexobj(w) else np.float32)
        np.add.at(A, (ij[:, 1], ij[:, 0]), 1.0 if w is None else w)
        return A

    def one_theta(th):
        out = []
        Rt = S.rot2(th)
        ph = np.exp(1j * (psi + th)).astype(np.complex64)
        for s in scales:
            q = s * q0 @ Rt.T
            allq = q
            if use_cams:
                qi, qo = s * ci0 @ Rt.T, s * co0 @ Rt.T
                allq = np.vstack([q, qi, qo])
            mn = allq.min(0)
            ext = np.floor((allq.max(0) - mn) / g).astype(int) + 1
            if ext[0] >= n or ext[1] >= n:
                continue
            shape = (ext[1], ext[0])
            P, Pc = grid(q, mn, shape), grid(q, mn, shape, ph)
            sc = 0.5 * fftconvolve(G, P[::-1, ::-1], mode="valid") \
                + 0.5 * fftconvolve(Gc, np.conj(Pc)[::-1, ::-1], mode="valid").real
            cons = None
            if use_cams:
                parts = []
                if len(qi):
                    parts.append(fftconvolve(Bm, grid(qi, mn, shape)[::-1, ::-1], mode="valid") / len(qi))
                if len(qo):
                    parts.append(fftconvolve(Fm, grid(qo, mn, shape)[::-1, ::-1], mode="valid") / len(qo))
                cons = np.clip(sum(parts) / len(parts), 0, 1)  # mean of indoor-inside and outdoor-outside shares
                sc = sc * cons ** cam_power
            # translation: world(pivot) = origin + (j, i) * g - mn
            jj, ii = np.meshgrid(np.arange(sc.shape[1]), np.arange(sc.shape[0]))
            piv_e = origin[0] + jj * g - mn[0]
            piv_n = origin[1] + ii * g - mn[1]
            far = (piv_e - anchor[0]) ** 2 + (piv_n - anchor[1]) ** 2 > t_radius ** 2
            sc = np.where(far, -np.inf, sc)
            k = int(np.argmax(sc))
            i, j = divmod(k, sc.shape[1])
            out.append((float(sc[i, j]), float(s), float(th), float(piv_e[i, j]), float(piv_n[i, j]),
                        float(cons[i, j]) if cons is not None else None))
        return out

    with ThreadPoolExecutor(workers) as ex:
        cands = [c for part in ex.map(one_theta, thetas) for c in part]
    cands.sort(reverse=True)
    # keep distinct solutions
    out = []
    for c in cands:
        if all(abs(c[3] - o[3]) + abs(c[4] - o[4]) > 2.0 or abs((c[2] - o[2] + math.pi) % (2 * math.pi) - math.pi) > 0.1
               for o in out):
            out.append(c)
        if len(out) >= top:
            break
    return out


# --------------------------------------------------------------------------------------------- free space

def classify_indoor(fc_down, cams, r=0.75, dz=(0.2, 5.0), min_faces=10):
    """A camera is indoor if at least `min_faces` downward-facing faces (a ceiling) lie 0.2-5 m above it within r.
    A count, not `any`: stray sky sheets and awnings put a few such faces over the street too."""
    from scipy.spatial import cKDTree

    t = cKDTree(fc_down[:, :2])
    z = fc_down[:, 2]
    out = np.zeros(len(cams), bool)
    for k, c in enumerate(cams):
        idx = t.query_ball_point(c[:2], r=r)
        if idx:
            h = z[idx] - c[2]
            out[k] = int(np.sum((h > dz[0]) & (h < dz[1]))) >= min_faces
    return out


def exterior_mask(p2, n2, cams2, indoor, r=8.0, front=0.3, min_outdoor=0.5):
    """Wall points seen from outside: the cameras within r on the point's normal side are mostly outdoor.
    Interior room walls (shop) face indoor cameras and would match the gaps between LoD2 buildings."""
    from scipy.spatial import cKDTree

    t = cKDTree(cams2)
    ext = np.zeros(len(p2), bool)
    for k, (p, n) in enumerate(zip(p2, n2)):
        idx = np.asarray(t.query_ball_point(p, r=r), int)
        if len(idx) == 0:
            continue
        idx = idx[((cams2[idx] - p) @ n) > front]
        ext[k] = len(idx) > 0 and float((~indoor[idx]).mean()) >= min_outdoor
    return ext


def inside_walls(q, a, b):
    """Point-in-footprint from oriented walls of ONE building: inside if on the inner side of the nearest wall.
    Robust to walls split into several polygons (a parity test is not)."""
    wn = S.segment_normals(a, b)
    d = b - a
    L2 = np.maximum((d * d).sum(1), 1e-12)
    best = np.full(len(q), np.inf)
    side = np.zeros(len(q))
    for k in range(len(a)):
        t = np.clip(((q - a[k]) @ d[k]) / L2[k], 0, 1)
        r = q - (a[k] + t[:, None] * d[k])
        dist = np.hypot(r[:, 0], r[:, 1])
        upd = dist < best - 1e-9
        best[upd] = dist[upd]
        side[upd] = (q[upd] - a[k]) @ wn[k]
    return side < 0


def inside_buildings(q, a, b, building):
    """Inside any LoD2 footprint (inside_walls per building). Not the pipeline's bldg.tif: that one is dilated by a
    cell, which puts a camera on the sidewalk 1-2 m in front of a facade 'inside'."""
    building = np.asarray(building)
    out = np.zeros(len(q), bool)
    for bid in np.unique(building):
        k = building == bid
        lo, hi = np.minimum(a[k], b[k]).min(0) - 0.5, np.maximum(a[k], b[k]).max(0) + 0.5
        box = ((q >= lo) & (q <= hi)).all(1) & ~out
        if box.any():
            out[box] = inside_walls(q[box], a[k], b[k])
    return out


def zone_building(anchor, a, b, building):
    """The LoD2 building whose footprint contains the anchor (bbox first: the nearest-wall test is only meaningful
    near a complete footprint); fallback: the building of the nearest wall."""
    building = np.asarray(building)
    hits = []
    for bid in np.unique(building):
        k = building == bid
        lo, hi = np.minimum(a[k], b[k]).min(0), np.maximum(a[k], b[k]).max(0)
        if (anchor >= lo).all() and (anchor <= hi).all() and inside_walls(anchor[None], a[k], b[k])[0]:
            hits.append((float(np.prod(hi - lo)), bid))
    if hits:
        return min(hits)[1]
    d, _ = S.point_segment(anchor[None], a, b)
    return str(building[int(np.argmin(d[0]))])


def footprint_grid(a, b, building, origin, n, g):
    """inside_buildings on the global-search grid: cell [i, j] at E = origin_E + j g, N = origin_N + i g."""
    jj, ii = np.meshgrid(np.arange(n), np.arange(n))
    q = np.stack([origin[0] + jj.ravel() * g, origin[1] + ii.ravel() * g], 1)
    return inside_buildings(q, a, b, building).reshape(n, n)


# --------------------------------------------------------------------------------------------- main

def peak(values, weights, lo, hi, bin_w=0.05):
    """Centre of the heaviest histogram bin of `values` in [lo, hi) (area-weighted)."""
    h, e = np.histogram(values, bins=np.arange(lo, hi + bin_w, bin_w), weights=weights)
    return float(e[np.argmax(h)] + bin_w / 2) if h.sum() > 0 else float("nan")


def run(zone: Zone) -> dict:
    from scipy import ndimage
    from scipy.spatial import cKDTree

    cfg = zone.cfg["georef"]
    rng = np.random.default_rng(0)
    mesh_dir = zone.work / "mesh"
    detail = cfg.get("fit_detail", "medium")
    obj = next((mesh_dir / f"model_{detail}").glob("*.obj"))
    v, f = load_obj_geom(obj)
    n3, area = face_normals(v, f)
    poses = json.loads((mesh_dir / "poses.json").read_text())["poses"]
    cams = np.array([p["t"] for p in poses], float)
    Rs = np.array([quat_to_R(p["q_xyzw"]) for p in poses])
    cam_up = Rs[:, :, 1].sum(0)

    # ---- 1. level
    up = level(n3, area, cam_up)
    tilt = math.degrees(math.acos(float(up @ cam_up / np.linalg.norm(cam_up))))
    RL = S.rotation_to_z(up)
    c0 = cams.mean(0)
    vl = (v - c0) @ RL.T
    nl = n3 @ RL.T
    cl = (cams - c0) @ RL.T
    roll = np.degrees(np.arcsin(np.clip((Rs[:, :, 0] @ RL.T)[:, 2], -1, 1)))
    fc = vl[f].mean(1)

    # ---- 2. scale: camera height above the floor / street (heaviest up-facing level below the cameras)
    upward = nl[:, 2] > math.cos(math.radians(15))
    downward = nl[:, 2] < -math.cos(math.radians(15))
    r_near = cfg.get("near_radius", 1.5)  # mesh units
    tu = cKDTree(fc[upward][:, :2])
    rel, w = [], []
    for c in cl:
        idx = tu.query_ball_point(c[:2], r=r_near)
        rel.append(c[2] - fc[upward][idx, 2])
        w.append(area[upward][idx])
    cam_h = peak(np.concatenate(rel), np.concatenate(w), 0.2, 4.0)
    s_fix = cfg.get("camera_height_m", 1.35) / cam_h
    h_tol = cfg.get("camera_height_tol_m", 0.15)

    # ---- 3. indoor / outdoor cameras, exterior wall points
    indoor = classify_indoor(fc[downward], cl, r=0.75)
    vert = np.abs(nl[:, 2]) < math.sin(math.radians(cfg.get("wall_tol_deg", 12)))
    pts, fi = sample_faces(vl, f, vert, cfg.get("wall_points", 60000), rng)
    n2 = nl[fi, :2] / np.linalg.norm(nl[fi, :2], axis=1, keepdims=True)
    p2 = pts[:, :2]
    psi = np.arctan2(n2[:, 1], n2[:, 0])
    ext = exterior_mask(p2, n2, cl[:, :2], indoor)
    tdn = cKDTree(fc[downward][:, :2])
    ceil = [fc[downward][tdn.query_ball_point(c[:2], r=1.0), 2] - c[2] for c in cl[indoor]]
    ceil_w = [area[downward][tdn.query_ball_point(c[:2], r=1.0)] for c in cl[indoor]]
    room_h = (peak(np.concatenate(ceil), np.concatenate(ceil_w), 0.1, 4.0) + cam_h) * s_fix if indoor.any() else None

    # ---- 4. LoD2 walls, zone building, free-space grids
    anchor = np.array([cfg["anchor_E"], cfg["anchor_N"]], float)
    radius = cfg.get("radius", 90)
    walls = lod2.load_walls(anchor[0], anchor[1], radius)
    a = np.array([w.a for w in walls])
    b = np.array([w.b for w in walls])
    bid = np.array([w.building for w in walls])
    wn = S.segment_normals(a, b)
    zone_b = zone_building(anchor, a, b, bid)
    zsel = bid == zone_b
    g = 0.4
    origin = anchor - radius
    n_grid = int(math.ceil(2 * radius / g))
    in_mask = ndimage.binary_dilation(footprint_grid(a[zsel], b[zsel], bid[zsel], origin, n_grid, g))
    free_mask = ~ndimage.binary_erosion(footprint_grid(a, b, bid, origin, n_grid, g))

    def cam_consistency(x):
        q = S.apply_sim2(x, cl[:, :2])
        parts = []
        if indoor.any():
            parts.append(inside_walls(q[indoor], a[zsel], b[zsel]).mean())
        if (~indoor).any():
            parts.append((~inside_buildings(q[~indoor], a, b, bid)).mean())
        return float(np.mean(parts))

    # ---- 5. global plan search (rotation; translation by FFT), fixed scale
    pe, ne, pse = p2[ext], n2[ext], psi[ext]
    sub = rng.choice(len(pe), size=min(len(pe), 20000), replace=False)
    pivot = cl[:, :2].mean(0)
    thetas = np.radians(np.arange(0, 360, cfg.get("theta_step_deg", 1.0)))
    cands = global_search(pe[sub], pse[sub], a, b, anchor, pivot, np.array([s_fix]), thetas, g=g, radius=radius,
                          t_radius=cfg.get("search_radius", 45), cams_in=cl[indoor, :2], cams_out=cl[~indoor, :2],
                          in_mask=in_mask, free_mask=free_mask)

    # ---- 6. robust ICP (scale fixed) from the best candidates; pick by inliers x camera consistency^4
    tried = []
    for sc, s, th, ce, cn, cons0 in cands[:cfg.get("refine_top", 6)]:
        t = np.array([ce, cn]) - s * S.rot2(th) @ pivot
        x0 = x = (s, th, t[0], t[1])
        for md in (2.0, 1.0, 0.6):
            x, info = S.fit_similarity_2d(pe, ne, a, b, x, max_dist=md, fix_scale=True)
        if np.hypot(x[2] - x0[2], x[3] - x0[3]) > 10 or info["inliers"] == 0:
            continue  # diverged
        good = int(np.sum(np.abs(info["signed"]) < 0.3))
        cons = cam_consistency(x)
        if any(abs(x[2] - r["x"][2]) + abs(x[3] - r["x"][3]) < 0.5 and abs(x[1] - r["x"][1]) < 0.01 for r in tried):
            continue  # same solution
        tried.append({"x": [float(u) for u in x], "search_score": round(sc, 1), "theta_deg": round(math.degrees(x[1]) % 360, 2),
                      "E": round(float(S.apply_sim2(x, pivot[None])[0, 0]), 2),
                      "N": round(float(S.apply_sim2(x, pivot[None])[0, 1]), 2),
                      "inliers_0.3m": good, "camera_consistency": round(cons, 3), "score": round(good * cons ** 4, 1)})
    tried.sort(key=lambda r: -r["score"])
    x = tuple(tried[0]["x"])
    ambiguity = tried[1]["score"] / tried[0]["score"] if len(tried) > 1 else 0.0
    x, info = S.fit_similarity_2d(p2, n2, a, b, x, max_dist=0.6, iters=0)  # residuals on all wall points
    s, th, tx, ty = x

    # along the main wall: how sharply do the end walls / corners pin the position?
    q = S.apply_sim2(x, p2)
    signed, idx = info["signed"], info["idx"]
    inl = np.isfinite(signed) & (np.abs(signed) < 0.6)
    k_main = int(np.bincount(idx[inl & ext]).argmax())
    dmain = (b[k_main] - a[k_main]) / np.linalg.norm(b[k_main] - a[k_main])
    along = {}
    for du in (-1.0, -0.5, 0.5, 1.0, 3.0, -3.0):
        xs = (s, th, tx + du * dmain[0], ty + du * dmain[1])
        j2, s2 = S.match_points(S.apply_sim2(xs, pe), ne @ S.rot2(th).T, a, b, wn, 0.6)
        along[f"{du:+.1f}"] = int(np.sum((j2 >= 0) & (np.abs(s2) < 0.3)))
    base_in = int(np.sum((idx[ext] >= 0) & (np.abs(signed[ext]) < 0.3)))

    # ---- 7. height: street / ground outside every LoD2 footprint onto the DTM
    dtm = DATA / "work" / cfg.get("dtm_aoi", "overall") / "dtm.tif"
    gpts, _ = sample_faces(vl, f, upward, 30000, rng)
    gEN = S.apply_sim2(x, gpts[:, :2])
    hd = raster_sample(dtm, gEN[:, 0], gEN[:, 1])
    # ground level = camera height below the outdoor cameras (not car roofs, steps, window sills)
    co = cl[~indoor] if (~indoor).any() else cl
    tco = cKDTree(co[:, :2])
    dd, jj = tco.query(gpts[:, :2])
    near_ground = (dd < 4.0) & (np.abs(gpts[:, 2] - (co[jj, 2] - cam_h)) < 0.25)
    use = near_ground & np.isfinite(hd) & ~inside_buildings(gEN, a, b, bid)
    if use.sum() < 50:
        raise RuntimeError(f"georef: only {int(use.sum())} street ground points outside buildings -- plan fit wrong?")
    dz = hd[use] - s * gpts[use, 2]
    tz = float(np.median(dz[np.abs(dz - peak(dz, None, dz.min(), dz.max())) < 0.3]))
    ground_res = hd[use] - (s * gpts[use, 2] + tz)
    ground_in = ground_res[np.abs(ground_res) < 1.0]

    # ---- transforms
    A = np.zeros((3, 3))
    A[:2, :2] = s * S.rot2(th)
    A[2, 2] = s
    A = A @ RL
    tvec = np.array([tx, ty, tz]) - A @ c0
    M = np.eye(4)
    M[:3, :3], M[:3, 3] = A, tvec
    E0, N0 = int(round(anchor[0])), int(round(anchor[1]))
    L = np.array([[1, 0, 0, -E0], [0, 0, 1, 0], [0, -1, 0, N0], [0, 0, 0, 1]], float)
    M_local = L @ M

    # ---- residuals
    per_wall = []
    zw = s * pts[:, 2] + tz
    for k in np.unique(idx[inl]):
        m = inl & (idx == k)
        if m.sum() < 30:
            continue
        top = float(np.percentile(zw[m], 98))
        per_wall.append({"wall": int(k), "building": walls[k].building, "n": int(m.sum()),
                         "median_m": round(float(np.median(signed[m])), 3), "length_m": round(walls[k].length, 2),
                         "z0": walls[k].z0, "z1": walls[k].z1, "mesh_top": round(top, 2),
                         "eaves_reached": bool(top > walls[k].z1 - 0.5)})
    # corners: points on each of the two walls (and collinear neighbours of the same building) within 3 m
    corner_res = []
    for c in lod2.corners(walls):
        cp = np.array(c["p"])
        lines = []
        for k in (next(i for i, w in enumerate(walls) if w is c[key]) for key in ("w1", "w2")):
            same = np.nonzero((bid == bid[k]) & (wn @ wn[k] > math.cos(math.radians(5))))[0]
            m = inl & np.isin(idx, same) & (np.linalg.norm(q - cp, axis=1) < 3.0)
            if m.sum() < 40:
                break
            cc, dd_ = S.line_fit(q[m])
            if np.ptp((q[m] - cc) @ dd_) < 0.6:  # too short for a direction
                break
            lines.append((cc, dd_))
        if len(lines) == 2:
            pi = S.intersect_lines(lines[0][0], lines[0][1], lines[1][0], lines[1][1])
            if pi is not None:
                corner_res.append({"building": c["building"], "E": round(cp[0], 2), "N": round(cp[1], 2),
                                   "dE": round(float(pi[0] - cp[0]), 3), "dN": round(float(pi[1] - cp[1]), 3),
                                   "dist": round(float(np.linalg.norm(pi - cp)), 3)})
    zone_share = float(np.mean(bid[idx[inl & ext]] == zone_b)) if (inl & ext).any() else 0.0

    r_in = signed[inl]
    res = {
        "level": {"tilt_vs_camera_up_deg": round(tilt, 2), "camera_roll_median_deg": round(float(np.median(roll)), 2),
                  "camera_roll_p95_abs_deg": round(float(np.percentile(np.abs(roll), 95)), 2),
                  "wall_area_share": round(float(area[vert].sum() / area.sum()), 3)},
        "scale": {"mesh_units_to_m": s, "source": "camera height prior (walls in view fix no scale)",
                  "camera_height_mesh": cam_h, "camera_height_m": cfg.get("camera_height_m", 1.35),
                  "rel_uncertainty": round(h_tol / cfg.get("camera_height_m", 1.35), 3),
                  "room_height_m_check": round(room_h, 2) if room_h else None},
        "cameras": {"n": len(cl), "indoor": int(indoor.sum()), "outdoor": int((~indoor).sum()),
                    "consistency": tried[0]["camera_consistency"]},
        "plan": {"theta_deg": math.degrees(th) % 360, "exterior_points": int(ext.sum()), "of_points": len(p2),
                 "inliers_0.6m": int(inl.sum()), "median_abs_m": float(np.median(np.abs(r_in))),
                 "rms_m": float(np.sqrt(np.mean(r_in ** 2))), "p90_abs_m": float(np.percentile(np.abs(r_in), 90)),
                 "zone_building_share": round(zone_share, 3),
                 "ambiguity_2nd_vs_best": round(ambiguity, 3), "candidates": tried,
                 "along_main_wall": {"wall": k_main, "inliers_at_0": base_in, "inliers_shifted_m": along}},
        "walls": sorted(per_wall, key=lambda r: -r["n"]),
        "corners": corner_res,
        "corners_summary": {"n": len(corner_res),
                            "median_m": float(np.median([c["dist"] for c in corner_res])) if corner_res else None,
                            "max_m": float(max(c["dist"] for c in corner_res)) if corner_res else None},
        "ground_vs_dtm": {"n": int(use.sum()), "median_abs_m": float(np.median(np.abs(ground_in))),
                          "p90_abs_m": float(np.percentile(np.abs(ground_in), 90)),
                          "share_within_0.5m": float(np.mean(np.abs(ground_res) < 0.5))},
        "ground_ref_h": round(float(np.median(hd[use])), 2),
        "zone_building": zone_b,
    }
    geo = {"crs": "EPSG:25832", "height": "DHHN2016 (NHN)", "anchor": {"E0": E0, "N0": N0},
           "local_frame": "x = E - E0, y = h, z = -(N - N0)",
           "mesh_to_world": M.tolist(), "mesh_to_local": M_local.tolist(), "fit_detail": detail,
           "residuals": res}
    save_json(zone.work / "georef.json", geo)
    qa_topview(zone, walls, q, signed, inl, x, anchor, cams=S.apply_sim2(x, cl[:, :2]), indoor=indoor)
    print("   georef:", json.dumps({"scale": round(s, 4), "theta": round(math.degrees(th) % 360, 2),
                                     "plan_median_abs": round(res["plan"]["median_abs_m"], 3),
                                     "corners": res["corners_summary"], "ground": res["ground_vs_dtm"],
                                     "cameras": res["cameras"], "ambiguity": res["plan"]["ambiguity_2nd_vs_best"],
                                     "along": res["plan"]["along_main_wall"], "room_h": res["scale"]["room_height_m_check"],
                                     "level": res["level"]}), flush=True)
    return res


def qa_topview(zone, walls, q, signed, inl, x, anchor, half=45.0, ppm=12, cams=None, indoor=None):
    """Ortho (0.5 m/px DOP tiles) + LoD2 walls + fitted mesh wall points coloured by residual."""
    import cv2

    E0, N0 = anchor[0] - half, anchor[1] + half
    size = int(2 * half * ppm)
    img = np.full((size, size, 3), 40, np.uint8)
    tiles = sorted((DATA / "raw" / "ortho").glob("*/sl/sl_dop20_rgb_*_500x500m_1000px.png"))
    for t in tiles:
        e, n = (int(v) for v in t.name.split("_")[3:5])
        if e > E0 + 2 * half or e + 500 < E0 or n > N0 or n + 500 < N0 - 2 * half:
            continue
        tile = cv2.imread(str(t))
        sc = ppm * 500 / tile.shape[1]
        big = cv2.resize(tile, None, fx=sc, fy=sc, interpolation=cv2.INTER_LINEAR)
        ox, oy = int(round((e - E0) * ppm)), int(round((N0 - (n + 500)) * ppm))
        x0, y0 = max(0, ox), max(0, oy)
        x1, y1 = min(size, ox + big.shape[1]), min(size, oy + big.shape[0])
        if x1 > x0 and y1 > y0:
            img[y0:y1, x0:x1] = big[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
    img = (img * 0.6).astype(np.uint8)

    def px(e, n):
        return int(round((e - E0) * ppm)), int(round((N0 - n) * ppm))

    for w in walls:
        cv2.line(img, px(*w.a), px(*w.b), (255, 255, 255), 2)
    for p, r, ok in zip(q, signed, inl):
        if ok:
            t = min(1.0, abs(r) / 0.5)
            col = (0, int(255 * (1 - t)), int(255 * t))
        else:
            col = (200, 120, 0)
        cv2.circle(img, px(*p), 1, col, -1)
    if cams is not None:
        for c, ins in zip(cams, indoor):
            cv2.circle(img, px(*c), 3, (255, 0, 255) if ins else (255, 255, 0), -1)
    cv2.putText(img, "LoD2 walls (white), mesh wall points: green=0 m .. red>=0.5 m, blue=unmatched; "
                "cameras: magenta=indoor, cyan=outdoor",
                (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    out = REPO / "docs" / "shots" / "v2.8"
    out.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out / f"{zone.id}_georef_top.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 85])
