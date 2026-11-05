import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I: own scripts only
import paths  # noqa: E402
from common import *
import rasterio
B = lod2(); fr = bframe(); a, ux, vx = fr
bk = [b for b in B if b["id"] == "DESLA0AKQYG11262"][0]
g = np.array(bk["ground"][0])
print("ground z", g[:, 2].min(), "n verts", len(g))
gb = to_b(g[:, :2] - [E0, N0], fr)
for i in range(len(gb) - 1):
    print(f"edge {i}: ({gb[i,0]:.3f},{gb[i,1]:.3f}) -> ({gb[i+1,0]:.3f},{gb[i+1,1]:.3f})  L={np.linalg.norm(gb[i+1]-gb[i]):.3f}")
from shapely.geometry import Polygon
print("footprint area", Polygon(gb).area)
roofs = [np.array(r) for r in bk["roof"]]
for r in roofs:
    rb = to_b(r[:, :2] - [E0, N0], fr)
    print(f"roof: u {rb[:,0].min():6.2f}..{rb[:,0].max():6.2f} v {rb[:,1].min():6.2f}..{rb[:,1].max():6.2f}  z {r[:,2].min():.2f}..{r[:,2].max():.2f}")
walls = [np.array(r) for r in bk["wall"]]
for r in walls:
    rb = to_b(r[:, :2] - [E0, N0], fr)
    print(f"wall: u {rb[:,0].min():6.2f}..{rb[:,0].max():6.2f} v {rb[:,1].min():6.2f}..{rb[:,1].max():6.2f}  z {r[:,2].min():.2f}..{r[:,2].max():.2f}")
# pivot
piv = np.array([8.39, -(-4.97)])
print("pivot B", to_b(piv[None], fr))
# DGM
p = str(paths.DTM)
with rasterio.open(p) as r:
    print(r.crs, r.transform, r.res, r.nodata)
    pts = {"facade SSW end": (0, -0.5), "facade mid": (12, -0.5), "entrance (street, u 23, v -0.5)": (23.0, -0.5), "NE corner outside": (25.2, -0.5),
"street centre (u 20, v -4)": (20, -4)}
    for k, (u, v) in pts.items():
        E = a[0] + u * ux[0] + v * vx[0] + E0; N = a[1] + u * ux[1] + v * vx[1] + N0
        val = list(r.sample([(E, N)]))[0][0]
        print(f"DGM {k}: E {E:.2f} N {N:.2f} h {val:.2f}")
