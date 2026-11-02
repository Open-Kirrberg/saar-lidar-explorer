"""Dominant orientation of linear micro-relief (walls/scarps) in windows: gradient-direction histogram (mod 90 deg)
of SLRM-5, weighted by gradient magnitude. Prints the azimuth (deg, clockwise from grid north) of the wall set.
Usage: orient.py <workdir>"""
import sys
from pathlib import Path
import numpy as np, rasterio
from rasterio.windows import from_bounds
from scipy import ndimage
wd = Path(sys.argv[1])
W = {"palace_core": (382170, 5466070, 382275, 5466230), "north_terrace": (382170, 5466350, 382285, 5466590),
     "orangerie": (382215, 5465915, 382260, 5466015), "core_plus_terrace": (382160, 5466060, 382290, 5466600),
     "karlsbergweiher": (381800, 5465830, 381990, 5465910)}
with rasterio.open(wd / "dgm1.tif") as d:
    tf = d.transform
    for k, b in W.items():
        a = d.read(1, window=from_bounds(*b, transform=tf)).astype(float)
        a = ndimage.gaussian_filter(a, 1.0)
        gy, gx = np.gradient(a)  # rows go south: gy = dz/d(row) = -dz/dN
        gN = -gy; gE = gx
        mag = np.hypot(gE, gN)
        az = np.degrees(np.arctan2(gE, gN)) % 180  # gradient direction (normal to wall), mod 180
        # double-angle mean mod 90 (4θ) for orthogonal sets
        wts = mag ** 2
        th = np.radians(az)
        c4 = np.sum(wts * np.cos(4 * th)); s4 = np.sum(wts * np.sin(4 * th))
        dom4 = (np.degrees(np.arctan2(s4, c4)) / 4) % 90
        r4 = np.hypot(c4, s4) / wts.sum()
        c2 = np.sum(wts * np.cos(2 * th)); s2 = np.sum(wts * np.sin(2 * th))
        dom2 = (np.degrees(np.arctan2(s2, c2)) / 2) % 180
        hist, edges = np.histogram(az % 90, bins=90, range=(0, 90), weights=wts)
        peak = edges[np.argmax(ndimage.uniform_filter1d(hist, 3, mode="wrap"))] + 0.5
        # wall direction = gradient direction + 90
        print(f"{k:18s} normal-set mod90 = {dom4:5.1f} deg (R4={r4:.2f}), hist peak {peak:4.1f}; mod180 normal {dom2:5.1f} -> wall line az {(dom2+90)%180:5.1f}")
