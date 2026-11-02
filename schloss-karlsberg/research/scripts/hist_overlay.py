"""Overlay the dark linework / red building marks of a historic map (optionally shifted by dE,dN) on the relief.
Usage: hist_overlay.py <workdir> <out.jpg> <hist: 1840|1935> <e0> <n0> <size> <dE> <dN> [title]"""
import sys
from pathlib import Path
import numpy as np, rasterio
from rasterio.windows import from_bounds
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
ROOT = Path(__file__).resolve().parents[3]
wd = Path(sys.argv[1]); out = sys.argv[2]; hk = sys.argv[3]
e0, n0, sz, dE, dN = map(float, sys.argv[4:9]); title = sys.argv[9] if len(sys.argv) > 9 else ""
b = (e0, n0, e0 + sz, n0 + sz)
def rd(p, bb):
    with rasterio.open(p) as d:
        return d.read(window=from_bounds(*bb, transform=d.transform), boundless=True, fill_value=0)
hs = rd(wd / "hs_multi.tif", b)[0]; hs = np.clip((hs - np.percentile(hs, 1)) / (np.percentile(hs, 99.5) - np.percentile(hs, 1)), 0, 1)
sl = rd(wd / "slrm10.tif", b)[0]
# historic map sampled at shifted window: real position = map position - shift  => read map at b + shift
hb = (b[0] + dE, b[1] + dN, b[2] + dE, b[3] + dN)
h = rd(ROOT / f"data/work/karlsberg/hist_{hk}.tif", hb)[:3].astype(float)
r, g, bl = h
dark = (r + g + bl) / 3 < 90
red = (r > 140) & (r - g > 45) & (r - bl > 35)
base = plt.get_cmap("RdBu_r")(np.clip((sl + 0.6) / 1.2, 0, 1))[..., :3] * (0.5 + 0.5 * hs[..., None])
img = 0.6 * base + 0.4 * hs[..., None]
img[dark] = img[dark] * 0.3 + np.array([0.0, 0.0, 0.0]) * 0.7
img[red] = np.array([1.0, 0.0, 0.9])
fig = plt.figure(figsize=(10, 10.4), dpi=150)
ax = fig.add_axes([0.08, 0.06, 0.9, 0.88])
ax.imshow(np.clip(img, 0, 1), extent=(b[0], b[2], b[1], b[3]))
g = 50 if sz <= 1200 else 250
ax.set_xticks(np.arange(b[0], b[2] + 1, g)); ax.set_yticks(np.arange(b[1], b[3] + 1, g))
ax.tick_params(labelsize=5.5); ax.ticklabel_format(useOffset=False, style="plain"); ax.grid(color="k", alpha=0.25, lw=0.4)
ax.set_title(f"{title}  {hk} map linework (black) + red building marks (magenta) shifted by dE={-dE:+.0f} m, dN={-dN:+.0f} m over SLRM-10 relief", fontsize=7)
fig.text(0.08, 0.01, "EPSG:25832. DGM1 © GeoBasis-DE/LVGL-SL 2025 / LVermGeoRP 2022; historic map © GeoBasis-DE/LVGL-SL; dl-de/by-2-0, processed", fontsize=5)
fig.savefig(out, dpi=150, pil_kwargs={"quality": 85}); print(out)
