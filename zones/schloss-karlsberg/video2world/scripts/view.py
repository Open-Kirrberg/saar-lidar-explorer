"""Zoomed view of a levelled top-view DSM with a fine grid (for picking building boxes / control points).

Usage (from pipeline/): uv run python -I ../zones/schloss-karlsberg/video2world/scripts/view.py <RUN> x0 x1 y0 y1 [step] [boxes.json]
Writes work/reg/<RUN>/view_<x0>_<y0>.png (HMS-derived: keep in work/). Optional boxes.json overlays boxes.
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
x0, x1, y0, y1 = map(float, sys.argv[2:6])
step = float(sys.argv[6]) if len(sys.argv) > 6 and not sys.argv[6].startswith("--") else 0.05
d = os.path.join(C.WORK, "reg", run)
dsm = np.load(os.path.join(d, "dsm_top.npy"))[0]
g = json.load(open(os.path.join(d, "dsm_top.json")))
c0 = int((x0 - g["x0"]) / g["res"])
c1 = int((x1 - g["x0"]) / g["res"])
r0 = int((g["y1"] - y1) / g["res"])
r1 = int((g["y1"] - y0) / g["res"])
sub = dsm[max(r0, 0):r1, max(c0, 0):c1]
ext = [g["x0"] + max(c0, 0) * g["res"], g["x0"] + c1 * g["res"], g["y1"] - r1 * g["res"], g["y1"] - max(r0, 0) * g["res"]]
if "--ndsm" in sys.argv:  # colour by height above a smooth ground (min filter + blur): detrends sloping CG terrain
    from scipy import ndimage

    k = max(3, int(float(sys.argv[sys.argv.index("--ndsm") + 1]) / g["res"]))
    filled = np.nan_to_num(sub, nan=np.nanmedian(sub))
    ground = ndimage.uniform_filter(ndimage.minimum_filter(filled, size=k), size=k)
    sub = sub - ground
gy, gx = np.gradient(np.nan_to_num(sub, nan=np.nanmin(sub)), g["res"])
shade = np.clip((-gx * 0.6 + gy * 0.6 + 1) / np.sqrt(1 + gx ** 2 + gy ** 2), 0, 1.5)
fig, ax = plt.subplots(figsize=(14, 14 * sub.shape[0] / sub.shape[1]), dpi=100)
lo, hi = np.nanpercentile(sub, [1, 99.8])
ax.imshow(sub, cmap="terrain", extent=ext, vmin=lo, vmax=hi)
ax.imshow(shade, cmap="gray", alpha=0.4, extent=ext)
ax.set_xticks(np.arange(np.ceil(ext[0] / step) * step, ext[1], step))
ax.set_yticks(np.arange(np.ceil(ext[2] / step) * step, ext[3], step))
ax.tick_params(labelsize=7)
plt.setp(ax.get_xticklabels(), rotation=90)
ax.grid(alpha=0.5, color="k", lw=0.4)
if len(sys.argv) > 7 and sys.argv[7].endswith(".json"):
    for name, b in json.load(open(sys.argv[7])).get("boxes", {}).items():
        bx = [b[0], b[1], b[1], b[0], b[0]]
        by = [b[2], b[2], b[3], b[3], b[2]]
        ax.plot(bx, by, "r-", lw=1)
        ax.text(b[0], b[3], name, color="r", fontsize=8)
ax.set_title(f"{run} z {lo:.3f}..{hi:.3f}")
fig.savefig(os.path.join(d, f"view_{x0:g}_{y0:g}.png"), bbox_inches="tight")
print("ok")
