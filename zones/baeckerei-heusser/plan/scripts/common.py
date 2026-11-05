import json
import numpy as np
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I: own scripts only
from paths import SP  # noqa: E402
E0, N0 = 381467.0, 5462254.0
def mesh():
    d = np.load(SP + "work/mesh_local.npz")
    v = d["v"]; f = d["f"]
    # plan coords: X = E-E0, Y = N-N0, H = height
    V = np.c_[v[:, 0], -v[:, 2], v[:, 1]]
    C = np.c_[d["cams"][:, 0], -d["cams"][:, 2], d["cams"][:, 1]]
    return V, f, C, d["files"]
def lod2():
    return json.load(open(SP + "work/lod2_near.json"))
def face_normals(V, f):
    n = np.cross(V[f[:, 1]] - V[f[:, 0]], V[f[:, 2]] - V[f[:, 0]])
    a = 0.5 * np.linalg.norm(n, axis=1)
    return n / np.maximum(2 * a, 1e-15)[:, None], a
def slice_mesh(V, f, h):
    """Segments where plane H=h cuts the triangles -> (n,2,2) plan XY + face idx."""
    z = V[f][:, :, 2] - h
    s = np.sign(z); s[s == 0] = 1e-9
    cut = ~((s > 0).all(1) | (s < 0).all(1))
    segs, idx = [], []
    for fi in np.nonzero(cut)[0]:
        P = V[f[fi]]; zz = z[fi]; pts = []
        for i, j in ((0, 1), (1, 2), (2, 0)):
            if (zz[i] > 0) != (zz[j] > 0):
                t = zz[i] / (zz[i] - zz[j]); pts.append(P[i, :2] + t * (P[j, :2] - P[i, :2]))
        if len(pts) == 2: segs.append(pts); idx.append(fi)
    return np.array(segs), np.array(idx)
# Building frame "B": origin = SSW end of the LoD2 street facade (wall 33), u along the facade (NNE), v inward (WNW).
def bframe():
    B = lod2(); bk = [b for b in B if b["id"] == "DESLA0AKQYG11262"][0]
    g = np.array(bk["ground"][0])[:, :2] - [E0, N0]
    # facade = longest ring edge
    L = [np.linalg.norm(g[i + 1] - g[i]) for i in range(len(g) - 1)]
    i = int(np.argmax(L)); a, b = g[i], g[i + 1]
    if a[1] > b[1]: a, b = b, a           # a = south end
    ux = (b - a) / np.linalg.norm(b - a)
    vx = np.array([-ux[1], ux[0]])        # CCW 90 -> should point inward (WNW)
    return a, ux, vx
def to_b(P, fr=None):
    a, ux, vx = fr or bframe()
    d = np.asarray(P)[..., :2] - a
    return np.stack([d @ ux, d @ vx], -1)
