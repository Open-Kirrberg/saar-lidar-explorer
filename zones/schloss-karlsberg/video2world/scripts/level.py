"""Level a raw Object Capture mesh: find 'up' and the dominant wall direction, write a levelled frame + top view.

Usage (from pipeline/):  uv run python -I ../zones/schloss-karlsberg/video2world/scripts/level.py <OC_RUN> [--zclip Z] [--flip]
  OC_RUN = work/oc/<name> directory name, e.g. S04_full
Up = smallest principal axis of the (wide, thin) site relief, refined by mean shift on near-horizontal face normals
(court, terrain, roof decks); check: CG camera right-vectors must come out horizontal (zero roll); sign check uses the cameras (they look down at the site: camera centres lie on the +up side).
Writes work/reg/<OC_RUN>/level.json (rotation R0 and scale-free frame) and level_top.png (height-coloured top view
with a mesh-unit grid, for control-point picking). Renders are derived from the HMS video: keep them in work/.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

import v2w_common as C


def quat_to_R(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def main():
    run = sys.argv[1]
    oc = os.path.join(C.WORK, "oc", run)
    v, f = C.load_obj(C.find_obj(oc))
    n, area = C.face_normals(v, f)
    poses = json.load(open(os.path.join(oc, "poses.json")))["poses"]
    cams = np.array([p["t"] for p in poses])
    Rs = [quat_to_R(p["q_xyzw"]) for p in poses]
    # the reconstructed site is a wide, thin relief: its smallest principal axis is a robust first guess for 'up';
    # refine by mean shift on near-horizontal face normals (court, terrain, flat roof decks)
    c = v - v.mean(0)
    w, U = np.linalg.eigh(c.T @ c / len(c))
    up = U[:, 0]
    for _ in range(50):
        d = n @ up
        sel = np.abs(d) > np.cos(np.radians(15))
        m = (np.sign(d[sel])[:, None] * n[sel] * area[sel][:, None]).sum(0)
        new = m / np.linalg.norm(m)
        done = np.degrees(np.arccos(np.clip(new @ up, -1, 1))) < 0.01
        up = new
        if done:
            break
    # sign: cameras above the site
    if np.median((cams - v.mean(0)) @ up) < 0:
        up = -up
    if "--flip" in sys.argv:
        up = -up
    # camera roll check: camera right vectors should be ~horizontal
    right = np.array([r[:, 0] for r in Rs])
    roll = np.degrees(np.arcsin(np.clip(right @ up, -1, 1)))
    # heading: dominant wall direction -> mesh x axis
    d = n @ up
    wall = np.abs(d) < np.sin(np.radians(15))
    nw = n[wall] - np.outer(n[wall] @ up, up)
    ex = np.array([1.0, 0, 0]) if abs(up[0]) < 0.9 else np.array([0, 1.0, 0])
    ex = ex - (ex @ up) * up
    ex /= np.linalg.norm(ex)
    ey = np.cross(up, ex)
    a = np.arctan2(nw @ ey, nw @ ex)
    # 4-fold symmetric mean (walls at 90 deg)
    w4 = area[wall]
    phi = np.angle((w4 * np.exp(4j * a)).sum()) / 4
    X = np.cos(phi) * ex + np.sin(phi) * ey
    Y = np.cross(up, X)
    R0 = np.stack([X, Y, up])  # rows: levelled x, y, z
    vl = (v - v.mean(0)) @ R0.T
    zclip = float(sys.argv[sys.argv.index("--zclip") + 1]) if "--zclip" in sys.argv else None
    if zclip is not None:  # drop the reconstructed sky/haze sheet that floats above the site
        f = f[vl[f].mean(1)[:, 2] < zclip]
        used = np.unique(f)
        remap = -np.ones(len(vl), int)
        remap[used] = np.arange(len(used))
        vl, f = vl[used], remap[f]
    out = os.path.join(C.WORK, "reg", run)
    os.makedirs(out, exist_ok=True)
    json.dump({"run": run, "centre": v.mean(0).tolist(), "R0": R0.tolist(),
               "camera_roll_deg": {"median": float(np.median(roll)), "p95_abs": float(np.percentile(np.abs(roll), 95))},
               "zclip": zclip, "n_vertices": len(vl), "n_faces": len(f)}, open(os.path.join(out, "level.json"), "w"), indent=1)
    print(run, "verts", len(v), "faces", len(f), "camera roll median %.2f p95|.| %.2f deg" % (np.median(roll), np.percentile(np.abs(roll), 95)))
    # top view
    span = np.ptp(vl[:, :2], 0)
    res = max(span) / 1400
    p, _ = C.sample_surface(vl, f, density=4 / res ** 2)
    x0, y1 = vl[:, 0].min(), vl[:, 1].max()
    nx, ny = int(span[0] / res) + 1, int(span[1] / res) + 1
    dsm = C.grid_max(p, x0, y1, res, nx, ny)
    # hillshade of dsm for readability
    gy, gx = np.gradient(np.nan_to_num(dsm, nan=np.nanmin(dsm)), res)
    shade = np.clip((-gx * 0.6 + gy * 0.6 + 1) / np.sqrt(1 + gx ** 2 + gy ** 2), 0, 1.5)
    fig, ax = plt.subplots(figsize=(14, 14 * ny / nx), dpi=100)
    ext = [x0, x0 + nx * res, y1 - ny * res, y1]
    lo, hi = np.nanpercentile(dsm, [2, 99.5])
    ax.imshow(dsm, cmap="terrain", extent=ext, vmin=lo, vmax=hi)
    ax.imshow(shade, cmap="gray", alpha=0.45, extent=ext)
    step = 10 ** np.floor(np.log10(max(span) / 8))
    ax.set_xticks(np.arange(np.ceil(ext[0] / step) * step, ext[1], step))
    ax.set_yticks(np.arange(np.ceil(ext[2] / step) * step, ext[3], step))
    ax.tick_params(labelsize=7)
    ax.grid(alpha=0.35, color="k", lw=0.5)
    ax.set_title(f"{run} levelled top view (mesh units), z range {lo:.3f}..{hi:.3f}")
    fig.savefig(os.path.join(out, "level_top.png"), bbox_inches="tight")
    np.save(os.path.join(out, "dsm_top.npy"), np.stack([dsm]))
    np.savez_compressed(os.path.join(out, "levelled_mesh.npz"), v=vl, f=f)
    json.dump({"x0": float(x0), "y1": float(y1), "res": float(res), "nx": nx, "ny": ny},
              open(os.path.join(out, "dsm_top.json"), "w"))


main()
