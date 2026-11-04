"""Top view of a registered mesh in the palace grid (u east along the axis, v north), height above court, 5 m grid.

Usage (from pipeline/): uv run python -I ../zones/schloss-karlsberg/video2world/scripts/uv_view.py <RUN> u0 u1 v0 v1 [boxes.json]
Writes work/renders/<RUN>_uv_<u0>_<v0>.png (HMS-derived: work/ only).
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

run = sys.argv[1]
u0, u1, v0, v1 = map(float, sys.argv[2:6])
m = np.load(os.path.join(C.WORK, "reg", run, "registered_enh.npz"))
p, _ = C.sample_surface(m["v"], m["f"], density=16.0)
u, w = C.en_to_uv(p[:, 0], p[:, 1])
res = 0.25
dsm = C.grid_max(np.column_stack([u, w, p[:, 2]]), u0, v1, res, int((u1 - u0) / res), int((v1 - v0) / res))
fig, ax = plt.subplots(figsize=(14, 14 * (v1 - v0) / (u1 - u0)), dpi=100)
ax.imshow(dsm - C.COURT_H, cmap="turbo", extent=[u0, u1, v0, v1], vmin=-6, vmax=24)
gy, gx = np.gradient(np.nan_to_num(dsm, nan=np.nanmin(dsm)), res)
ax.imshow(np.clip((-gx + gy) * 0.3 + 0.5, 0, 1), cmap="gray", alpha=0.35, extent=[u0, u1, v0, v1])
ax.set_xticks(np.arange(u0, u1 + 0.1, 5))
ax.set_yticks(np.arange(v0, v1 + 0.1, 5))
plt.setp(ax.get_xticklabels(), rotation=90, fontsize=7)
plt.setp(ax.get_yticklabels(), fontsize=7)
ax.grid(alpha=0.4, color="w", lw=0.4)
if len(sys.argv) > 6:
    for name, b in json.load(open(sys.argv[6]))["buildings"].items():
        bb = b["box"]
        ax.plot([bb[0], bb[1], bb[1], bb[0], bb[0]], [bb[2], bb[2], bb[3], bb[3], bb[2]], "w-", lw=1)
        ax.text(bb[0], bb[3] + 0.5, name, color="w", fontsize=8)
ax.set_title(f"{run}: height above court 344.8 m (colour -6..+24 m), palace grid u/v (m)")
os.makedirs(os.path.join(C.WORK, "renders"), exist_ok=True)
fig.savefig(os.path.join(C.WORK, "renders", f"{run}_uv_{u0:g}_{v0:g}.png"), bbox_inches="tight")
print("ok")
