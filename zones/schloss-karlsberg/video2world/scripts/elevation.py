"""Orthographic textured elevations of the registered HMS mesh (for reading storeys, cornice, axes in metres).

Usage (from pipeline/): uv run python -I ../zones/schloss-karlsberg/video2world/scripts/elevation.py <RUN> [name ...]
Uses the raw Object Capture OBJ + its baked texture and the 7-parameter similarity in work/reg/<RUN>/registration.json.
Writes work/renders/<RUN>_elev_<name>.png (contains HMS textures -> work/ only, never commit).
A software z-buffer rasteriser (numpy) at 0.1 m/pixel; horizontal axis = palace-grid u or v, vertical = h.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

import v2w_common as C

Image.MAX_IMAGE_PIXELS = None
PX = 0.1

# name: (box u0,u1,v0,v1 of faces to draw, view: '+u','-u','+v','-v' = direction the viewer LOOKS, hmin, hmax)
VIEWS = {
    "Suedfluegel_S": ([-40, 45, -45, -20], "+v", 340, 370),
    "Nordfluegel_court": ([-40, 45, 22, 32], "+v", 340, 370),
    "Ehrenhof_E_CdL": ([22, 50, -22, 25], "+u", 340, 372),
    "Sammlungsfluegel_W": ([-38, -24, 40, 106], "+u", 340, 370),
    "Kuechenbau_W": ([17, 26, 42, 92], "+u", 340, 370),
    "Orangerie_W": ([-20, -8, -200, -105], "+u", 333, 372),
    "Galerie_S": ([-20, 30, 88, 100], "+v", 342, 362),
    "CdL_garden_E": ([30, 60, -42, 44], "-u", 340, 372),
    "Kuechenbau_E": ([26, 40, 42, 92], "-u", 340, 370),
}


def load_obj_uv(path):
    vs, vts, fv, ft = [], [], [], []
    with open(path) as fh:
        for line in fh:
            if line.startswith("v "):
                vs.append(line.split()[1:4])
            elif line.startswith("vt "):
                vts.append(line.split()[1:3])
            elif line.startswith("f "):
                parts = [t.split("/") for t in line.split()[1:4]]
                fv.append([int(p[0]) - 1 for p in parts])
                ft.append([int(p[1]) - 1 for p in parts])
    return np.array(vs, float), np.array(vts, float), np.array(fv), np.array(ft)


def raster(P2, depth, UV, tri, tri_t, tex, x0, x1, y0, y1):
    W, H = int((x1 - x0) / PX), int((y1 - y0) / PX)
    img = np.full((H, W, 3), 255, np.uint8)
    zb = np.full((H, W), np.inf)
    th, tw = tex.shape[:2]
    for k in range(len(tri)):
        a, b, c = tri[k]
        xs = (P2[[a, b, c], 0] - x0) / PX
        ys = (y1 - P2[[a, b, c], 1]) / PX
        i0, i1 = int(max(np.floor(xs.min()), 0)), int(min(np.ceil(xs.max()), W - 1))
        j0, j1 = int(max(np.floor(ys.min()), 0)), int(min(np.ceil(ys.max()), H - 1))
        if i1 < i0 or j1 < j0:
            continue
        gx, gy = np.meshgrid(np.arange(i0, i1 + 1) + 0.5, np.arange(j0, j1 + 1) + 0.5)
        den = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
        if abs(den) < 1e-9:
            continue
        l0 = ((ys[1] - ys[2]) * (gx - xs[2]) + (xs[2] - xs[1]) * (gy - ys[2])) / den
        l1 = ((ys[2] - ys[0]) * (gx - xs[2]) + (xs[0] - xs[2]) * (gy - ys[2])) / den
        l2 = 1 - l0 - l1
        m = (l0 >= -1e-6) & (l1 >= -1e-6) & (l2 >= -1e-6)
        if not m.any():
            continue
        dz = l0 * depth[a] + l1 * depth[b] + l2 * depth[c]
        jj, ii = (gy[m] - 0.5).astype(int), (gx[m] - 0.5).astype(int)
        closer = dz[m] < zb[jj, ii]
        if not closer.any():
            continue
        jj, ii = jj[closer], ii[closer]
        ta, tb, tc = UV[tri_t[k]]
        uu = (l0[m][closer] * ta[0] + l1[m][closer] * tb[0] + l2[m][closer] * tc[0])
        vv = (l0[m][closer] * ta[1] + l1[m][closer] * tb[1] + l2[m][closer] * tc[1])
        px = np.clip((uu * tw).astype(int), 0, tw - 1)
        py = np.clip(((1 - vv) * th).astype(int), 0, th - 1)
        img[jj, ii] = tex[py, px]
        zb[jj, ii] = dz[m][closer]
    return img


def main():
    run = sys.argv[1]
    names = sys.argv[2:] or list(VIEWS)
    reg = json.load(open(os.path.join(C.WORK, "reg", run, "registration.json")))
    sim = reg["similarity_7p"]
    oc = os.path.join(C.WORK, "oc", run)
    objp = C.find_obj(oc)
    v, vt, fv, ft = load_obj_uv(objp)
    enh = sim["s"] * v @ np.array(sim["R"]).T + np.array(sim["t"])
    U, V = C.en_to_uv(enh[:, 0], enh[:, 1])
    texp = objp.replace(".obj", "_tex0.png")
    tex = np.asarray(Image.open(texp).convert("RGB"))
    for name in names:
        (u0, u1, v0, v1), look, hmin, hmax = VIEWS[name]
        cu, cv = U[fv].mean(1), V[fv].mean(1)
        sel = (cu >= u0) & (cu <= u1) & (cv >= v0) & (cv <= v1)
        tri, trt = fv[sel], ft[sel]
        if look in ("+v", "-v"):
            P2 = np.column_stack([U, enh[:, 2]]) if look == "+v" else np.column_stack([-U, enh[:, 2]])
            depth = V if look == "+v" else -V
            x0, x1 = (u0, u1) if look == "+v" else (-u1, -u0)
        else:
            P2 = np.column_stack([-V, enh[:, 2]]) if look == "+u" else np.column_stack([V, enh[:, 2]])
            depth = U if look == "+u" else -U
            x0, x1 = (-v1, -v0) if look == "+u" else (v0, v1)
        img = raster(P2, depth, vt, tri, trt, tex, x0, x1, hmin, hmax)
        fig, ax = plt.subplots(figsize=(min(40, (x1 - x0) / 2.2), (hmax - hmin) / 2.2), dpi=110)
        ax.imshow(img, extent=[x0, x1, hmin, hmax])
        ax.set_xticks(np.arange(np.ceil(x0), x1, 1), minor=True)
        ax.set_xticks(np.arange(np.ceil(x0 / 5) * 5, x1, 5))
        ax.set_yticks(np.arange(np.ceil(hmin), hmax, 1))
        ax.grid(which="major", color="r", alpha=0.5, lw=0.5)
        ax.grid(which="minor", color="r", alpha=0.15, lw=0.3)
        ax.axhline(C.COURT_H, color="b", lw=0.6)
        ax.tick_params(labelsize=6)
        lab = {"+v": "u (m, east ->)", "-v": "-u", "+u": "-v (m; north <- left)", "-u": "v"}[look]
        ax.set_xlabel(lab)
        ax.set_ylabel("h (m DHHN2016); blue = court 344.8")
        ax.set_title(f"{run} elevation {name} (looking {look}), {len(tri)} faces - HMS texture, private reference")
        fig.savefig(os.path.join(C.WORK, "renders", f"{run}_elev_{name}.png"), bbox_inches="tight")
        plt.close(fig)
        print(name, len(tri), "faces")


main()
