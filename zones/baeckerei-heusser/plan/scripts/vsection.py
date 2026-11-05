"""Vertical sections of the mesh. mode diag: plane t=(u+v)/rt2=const, plot c=(u-v)/rt2 vs h. mode u: plane u=const, plot v vs h. mode v: plane v=const, plot u vs h"""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I: own scripts only
from common import *
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
V, f, C, files = mesh(); fr = bframe()
P = np.c_[to_b(V[:, :2], fr), V[:, 2]]; FL = 244.25; r2 = np.sqrt(2)
mode = sys.argv[1]; vals = list(map(float, sys.argv[2].split(","))); xr = list(map(float, sys.argv[3].split(","))); name = sys.argv[4]
if mode == "diag": A = (P[:, 0] + P[:, 1]) / r2; X = (P[:, 0] - P[:, 1]) / r2
elif mode == "u": A = P[:, 0]; X = P[:, 1]
else: A = P[:, 1]; X = P[:, 0]
Q = np.c_[X, P[:, 2] - FL, A]
fig, axs = plt.subplots(len(vals), 1, figsize=(10, 3.6 * len(vals)))
for ax, val in zip(np.atleast_1d(axs), vals):
    S, _ = slice_mesh(Q, f, val)
    ax.add_collection(LineCollection(S, colors="k", lw=1))
    ax.set_xlim(*xr); ax.set_ylim(-1.0, 2.6); ax.set_aspect("equal"); ax.set_title(f"{mode} = {val}")
    ax.set_xticks(np.arange(xr[0], xr[1] + 0.01, 0.1), minor=True); ax.set_yticks(np.arange(-1, 2.61, 0.1), minor=True)
    ax.set_xticks(np.arange(np.ceil(xr[0]), xr[1] + 0.01, 0.5)); ax.set_yticks(np.arange(-1, 2.61, 0.5))
    ax.grid(True, which="minor", lw=0.2, color="0.8"); ax.grid(True, which="major", lw=0.5, color="0.5")
plt.savefig(SP + f"work/vs_{name}.png", dpi=110, bbox_inches="tight")
