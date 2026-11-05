"""OBJ (mesh frame) + poses -> zone-local npz (x=E-E0, y=h, z=-(N-N0)). Reads data files only."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I: own scripts only
import paths  # noqa: E402
import json, sys
import numpy as np
W = str(paths.CAPTURE_WORK) + "/"
out = sys.argv[1]
vs, fs = [], []
with open(W + "mesh/model_medium/baked_mesh_4d829724.obj") as f:
    for line in f:
        if line.startswith("v "): vs.append(line.split()[1:4])
        elif line.startswith("f "):
            idx = [int(t.split("/")[0]) for t in line.split()[1:]]
            for k in range(1, len(idx) - 1): fs.append((idx[0], idx[k], idx[k + 1]))
v = np.asarray(vs, float); f = np.asarray(fs, int) - 1
g = json.load(open(W + "georef.json"))
M = np.array(g["mesh_to_local"])
vl = v @ M[:3, :3].T + M[:3, 3]
P = json.load(open(W + "mesh/poses.json"))["poses"]
P.sort(key=lambda p: p["id"])
t = np.array([p["t"] for p in P]); cl = t @ M[:3, :3].T + M[:3, 3]
files = np.array([p["file"] for p in P])
np.savez(out, v=vl, f=f, cams=cl, files=files)
print(vl.shape, f.shape, vl.min(0).round(2), vl.max(0).round(2), cl.min(0).round(2), cl.max(0).round(2))
