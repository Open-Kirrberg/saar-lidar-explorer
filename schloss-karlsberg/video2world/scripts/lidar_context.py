"""Render the LiDAR context (hillshade + SLRM + features + catalogue footprints) of the palace core into work/.

Own data only (LiDAR dl-de/by-2-0 + catalogue). Run from pipeline/:
  uv run python -I ../schloss-karlsberg/video2world/scripts/lidar_context.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

import v2w_common as C

E_MIN, E_MAX, N_MIN, N_MAX = 382130, 382340, 5465900, 5466260
hs, (e0, n0) = C.read_raster_window("hillshade", E_MIN, E_MAX, N_MIN, N_MAX)
sl, _ = C.read_raster_window("slrm", E_MIN, E_MAX, N_MIN, N_MAX)
ext = [e0, e0 + hs.shape[1], n0 - hs.shape[0], n0]
fig, ax = plt.subplots(figsize=(10, 17), dpi=110)
ax.imshow(hs, cmap="gray", extent=ext)
ax.imshow(np.clip(sl, -0.6, 0.6), cmap="RdBu_r", alpha=0.35, extent=ext, vmin=-0.6, vmax=0.6)
for f in C.load_lidar_features()["features"]:
    p, g = f["properties"], f["geometry"]
    if not (p["id"].startswith("KB-0") or p["id"] in ("KB-30", "KB-31", "KB-34")):
        continue
    if g["type"] == "Polygon":
        xy = np.array(g["coordinates"][0])
    else:
        xy = np.array(g["coordinates"])
    ax.plot(xy[:, 0], xy[:, 1], "y-", lw=1.2)
    ax.text(xy[:, 0].mean(), xy[:, 1].mean(), p["id"], color="yellow", fontsize=8)
for b in C.load_catalogue()["buildings"]:
    if b.get("footprint") and b["id"] in ("KB-B01", "KB-B02", "KB-B03", "KB-B04", "KB-B05", "KB-B06", "KB-B10", "KB-B11", "KB-B12", "KB-B13", "KB-B07"):
        xy = np.array(b["footprint"])
        ax.plot(xy[:, 0], xy[:, 1], "c--", lw=1)
        ax.text(xy[:, 0].mean(), xy[:, 1].mean() - 4, b["id"], color="cyan", fontsize=7)
ax.set_xlim(E_MIN, E_MAX)
ax.set_ylim(N_MIN, N_MAX)
ax.set_xticks(np.arange(E_MIN, E_MAX + 1, 20))
ax.set_yticks(np.arange(N_MIN, N_MAX + 1, 20))
ax.tick_params(labelsize=6)
ax.grid(alpha=0.3)
os.makedirs(os.path.join(C.WORK, "renders"), exist_ok=True)
fig.savefig(os.path.join(C.WORK, "renders", "lidar_context.png"), bbox_inches="tight")
print("ok")
