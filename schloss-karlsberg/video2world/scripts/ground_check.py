"""Compare the HMS mesh ground with today's LiDAR DTM at reference spots (vertical registration check).

Usage (from pipeline/): uv run python -I ../schloss-karlsberg/video2world/scripts/ground_check.py <RUN>
Spots are palace-grid boxes on open ground (no buildings, few trees). Mesh ground = 20th percentile of a 0.5 m max-DSM.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np

import v2w_common as C

SPOTS = {
    "Ehrenhof (court) KB-01": [-25, 15, -12, 12],
    "Kuechenhof": [-12, 12, 55, 80],
    "forecourt W of Ehrenhof": [-60, -45, -10, 10],
    "Orangerie parterre E (KB-33)": [5, 25, -170, -130],
    "Orangerie lower bench W (KB-32)": [-26, -20, -180, -130],
    "garden E of Corps de logis": [60, 80, -10, 10],
    "between palace and Orangerie": [-10, 10, -80, -55],
}
run = sys.argv[1]
m = np.load(os.path.join(C.WORK, "reg", run, "registered_enh.npz"))
p, _ = C.sample_surface(m["v"], m["f"], density=16.0)
U, V = C.en_to_uv(p[:, 0], p[:, 1])
out = {}
for name, (u0, u1, v0, v1) in SPOTS.items():
    sel = (U > u0) & (U < u1) & (V > v0) & (V < v1)
    if sel.sum() < 50:
        continue
    dsm = C.grid_max(np.column_stack([U[sel], V[sel], p[sel, 2]]), u0, v1, 0.5, int((u1 - u0) / 0.5), int((v1 - v0) / 0.5))
    hm = float(np.nanpercentile(dsm, 20))
    uu, vv = np.meshgrid(np.arange(u0, u1, 2.0), np.arange(v0, v1, 2.0))
    e, n = C.uv_to_en(uu.ravel(), vv.ravel())
    hd = float(np.median(C.dtm_at(e, n)))
    out[name] = {"mesh_h": round(hm, 2), "dtm_h": round(hd, 2), "diff": round(hm - hd, 2)}
    print(f"{name:36s} mesh {hm:7.2f}  DTM {hd:7.2f}  diff {hm - hd:+6.2f}")
json.dump(out, open(os.path.join(C.WORK, "reg", run, "ground_check.json"), "w"), indent=1)
