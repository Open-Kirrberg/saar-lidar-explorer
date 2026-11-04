"""Sanity renders of a registered HMS reference mesh over the LiDAR (top view + two side views) into work/renders/.

Usage (from pipeline/): uv run python -I ../zones/schloss-karlsberg/video2world/scripts/render_check.py <RUN>
Images are derived from the copyrighted HMS video: they stay in git-ignored work/, never in research/img/.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

import v2w_common as C

run = sys.argv[1]
d = os.path.join(C.WORK, "reg", run)
m = np.load(os.path.join(d, "registered_enh.npz"))
v, f = m["v"], m["f"]
E_MIN, E_MAX, N_MIN, N_MAX = 382110, 382360, 5465880, 5466300
p, _ = C.sample_surface(v, f, density=6.0)
sel = (p[:, 0] > E_MIN) & (p[:, 0] < E_MAX) & (p[:, 1] > N_MIN) & (p[:, 1] < N_MAX)
p = p[sel]
res = 0.5
nx, ny = int((E_MAX - E_MIN) / res), int((N_MAX - N_MIN) / res)
dsm = C.grid_max(p, E_MIN, N_MAX, res, nx, ny)
dtm, (e0, n0) = C.read_raster_window("dtm", E_MIN, E_MAX, N_MIN, N_MAX)
hs, _ = C.read_raster_window("hillshade", E_MIN, E_MAX, N_MIN, N_MAX)
# DTM at DSM resolution (nearest)
rr = np.clip((np.arange(ny) * res / 1.0).astype(int), 0, dtm.shape[0] - 1)
cc = np.clip((np.arange(nx) * res / 1.0).astype(int), 0, dtm.shape[1] - 1)
dtm_r = dtm[np.ix_(rr, cc)]
ndsm = dsm - dtm_r
os.makedirs(os.path.join(C.WORK, "renders"), exist_ok=True)

fig, ax = plt.subplots(1, 2, figsize=(20, 17), dpi=90)
ext = [E_MIN, E_MAX, N_MIN, N_MAX]
for a in ax:
    a.imshow(hs, cmap="gray", extent=ext)
ax[0].imshow(np.ma.masked_invalid(dsm - C.COURT_H), cmap="turbo", alpha=0.55, extent=ext, vmin=-12, vmax=22)
ax[0].set_title(f"{run}: registered HMS mesh height above court (m) over LiDAR hillshade")
ax[1].contour(np.linspace(E_MIN, E_MAX, nx), np.linspace(N_MAX, N_MIN, ny), np.nan_to_num(ndsm, nan=0), levels=[5.0],
              colors="red", linewidths=1.0)
ax[1].set_title("red: mesh 5 m above today's DTM; yellow: LiDAR features; cyan: catalogue v1")
for fe in C.load_lidar_features()["features"]:
    g = fe["geometry"]
    xy = np.array(g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"])
    if xy[:, 0].min() > E_MAX or xy[:, 0].max() < E_MIN or xy[:, 1].min() > N_MAX or xy[:, 1].max() < N_MIN:
        continue
    for a in ax:
        a.plot(xy[:, 0], xy[:, 1], "y-", lw=1)
    ax[1].text(xy[:, 0].mean(), xy[:, 1].mean(), fe["properties"]["id"], color="yellow", fontsize=7)
for b in C.load_catalogue()["buildings"]:
    if b.get("footprint"):
        xy = np.array(b["footprint"])
        if xy[:, 0].min() > E_MAX or xy[:, 0].max() < E_MIN or xy[:, 1].min() > N_MAX or xy[:, 1].max() < N_MIN:
            continue
        ax[1].plot(xy[:, 0], xy[:, 1], "c--", lw=0.8)
for a in ax:
    a.set_xlim(E_MIN, E_MAX)
    a.set_ylim(N_MIN, N_MAX)
    a.grid(alpha=0.25)
fig.savefig(os.path.join(C.WORK, "renders", f"{run}_top_over_lidar.png"), bbox_inches="tight")

# side views in the palace grid: elevation looking north (u vs h) and looking east (v vs h)
u, w = C.en_to_uv(p[:, 0], p[:, 1])
fig, ax = plt.subplots(2, 1, figsize=(18, 10), dpi=90)
core = (w > -45) & (w < 105) & (u > -60) & (u < 70)
ax[0].scatter(u[core & (w < -15)], p[core & (w < -15), 2], s=0.2, c=w[core & (w < -15)], cmap="viridis")
uu = np.linspace(-80, 80, 161)
for vline, col in [(-29, "k"), (0, "gray"), (30, "brown")]:
    e, n = C.uv_to_en(uu, np.full_like(uu, vline))
    ax[0].plot(uu, C.dtm_at(e, n), color=col, lw=1, label=f"DTM today along v={vline}")
ax[0].axhline(C.COURT_H, color="r", lw=0.6, ls="--")
ax[0].set_title(f"{run}: south half of the palace (Suedfluegel, v<-15) seen from the south: u (m, +E) vs h (m)")
ax[0].legend(fontsize=7)
ax[0].set_ylim(330, 375)
sel2 = (u > -10) & (u < 60) & (w > -60) & (w < 110)
ax[1].scatter(w[sel2], p[sel2, 2], s=0.2, c=u[sel2], cmap="viridis")
vv = np.linspace(-210, 120, 331)
e, n = C.uv_to_en(np.full_like(vv, -10.0), vv)
ax[1].plot(vv, C.dtm_at(e, n), "k-", lw=1, label="DTM today along u=-10")
ax[1].axhline(C.COURT_H, color="r", lw=0.6, ls="--")
ax[1].set_xlim(-210, 120)
ax[1].set_ylim(325, 375)
pz = (u > -30) & (u < 20) & (w < -100)
ax[1].scatter(w[pz], p[pz, 2], s=0.2, c="m")
ax[1].set_title("east half seen from the east (u -10..60): v (m, +N) vs h; magenta: Orangerie (u -30..20)")
ax[1].legend(fontsize=7)
for a in ax:
    a.grid(alpha=0.3)
fig.savefig(os.path.join(C.WORK, "renders", f"{run}_side_views.png"), bbox_inches="tight")
print("ok")
