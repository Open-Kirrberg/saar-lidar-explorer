"""Compute relief layers on the extended mosaic: MDOW hillshade, SLRM 5/10/20 m, positive/negative openness (r=15 m),
local dominance-free 'terrace map' (DTM smoothed). Usage: relief.py <workdir>"""
import sys, time
from pathlib import Path
import numpy as np, rasterio
from scipy import ndimage
import rvt.vis

wd = Path(sys.argv[1])
with rasterio.open(wd / "dgm1.tif") as d:
    dtm = d.read(1).astype("float32"); prof = d.profile

def save(name, a):
    with rasterio.open(wd / f"{name}.tif", "w", **prof) as d:
        d.write(a.astype("float32"), 1)

t = time.time()
sa = rvt.vis.slope_aspect(dtm, resolution_x=1, resolution_y=1, output_units="radian")
slope, aspect = sa["slope"], sa["aspect"]
save("slope", np.degrees(slope))
# multi-directional hillshade (simple mean of 6 azimuths, elev 35) - display layer
elev = np.radians(35)
hs = np.zeros_like(dtm)
for az in (0, 60, 120, 180, 240, 300):
    a = np.radians(az)
    hs += np.cos(elev) * np.sin(slope) * np.cos(a - aspect) + np.sin(elev) * np.cos(slope)
save("hs_multi", np.clip(hs / 6, 0, 1))
hs315 = rvt.vis.hillshade(dtm, 1, 1, sun_azimuth=315, sun_elevation=25)
save("hs315", hs315)
print("hillshade", round(time.time() - t, 1)); t = time.time()

def disk(r):
    y, x = np.mgrid[-r:r + 1, -r:r + 1]
    k = (x * x + y * y <= r * r).astype("float32"); return k / k.sum()
for r in (5, 10, 20):
    # SLRM = DTM - mean of circular neighbourhood (FFT convolution for speed)
    from scipy.signal import fftconvolve
    pad = np.pad(dtm, r, mode="edge")
    m = fftconvolve(pad, disk(r), mode="same")[r:-r, r:-r]
    save(f"slrm{r}", dtm - m)
    print("slrm", r, round(time.time() - t, 1)); t = time.time()
r = rvt.vis.sky_view_factor(dtm, resolution=1, compute_svf=False, compute_opns=True, svf_n_dir=16, svf_r_max=15, svf_noise=0)
save("opns_pos", r["opns"])
r = rvt.vis.sky_view_factor(-dtm, resolution=1, compute_svf=False, compute_opns=True, svf_n_dir=16, svf_r_max=15, svf_noise=0)
save("opns_neg", r["opns"])
print("openness", round(time.time() - t, 1))
