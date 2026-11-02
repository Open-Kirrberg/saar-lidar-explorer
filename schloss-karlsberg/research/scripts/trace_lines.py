"""Refine straight linear features (sunken paths / avenues / scarps) by searching the SLRM-5 extremum across
perpendicular profiles every `step` m and fitting a straight line (robust: 2 passes, drop > 2.5 m residuals).
Usage: trace_lines.py <workdir>"""
import sys, math
from pathlib import Path
import numpy as np, rasterio
from scipy.ndimage import map_coordinates
wd = Path(sys.argv[1])
with rasterio.open(wd / "slrm5.tif") as d:
    S = d.read(1); tf = d.transform
with rasterio.open(wd / "slope.tif") as d:
    SL = d.read(1)
def samp(A, e, n):
    c = (np.asarray(e) - tf.c) / tf.a - 0.5; r = (np.asarray(n) - tf.f) / tf.e - 0.5
    return map_coordinates(A, [r, c], order=1, mode="nearest")
LINES = {  # name: (p0, p1, mode, halfwidth)
    "E-axis avenue W part": ((382200, 5466112), (382780, 5466212), "min", 8),
    "E-axis avenue E part": ((382790, 5466215), (383380, 5466300), "min", 10),
    "SSE avenue to Karlslust": ((382290, 5465985), (382600, 5465440), "min", 8),
    "N-S axis road south (hollow)": ((382170, 5466114), (382178, 5466365), "min", 6),
    "N-S axis path north": ((382178, 5466380), (382180, 5466850), "min", 6),
    "N terrace east scarp": ((382265, 5466368), (382277, 5466475), "slope", 6),
    "N terrace south scarp": ((382182, 5466368), (382263, 5466368), "slope", 6),
    "Orangerie west wall": ((382229, 5466006), (382246, 5465924), "slope", 3),
    "Palace S-wing north wall": ((382197, 5466094), (382258, 5466103), "slope", 3),
    "Palace central wing south edge": ((382188, 5466140), (382248, 5466147), "slope", 3),
    "Palace W-block west wall": ((382183, 5466209), (382187, 5466162), "slope", 3),
    "Palace N court north scarp": ((382215, 5466218), (382246, 5466224), "slope", 3),
    "Cascade axis (Karlslust)": ((382815, 5464930), (382815, 5464840), "max", 6),
    "Karlslust S axis canal/avenue": ((382815, 5464785), (382815, 5464662), "min", 6),
    "Cells NE scarp": ((383022, 5464948), (383070, 5464858), "slope", 5),
}
for name, (p0, p1, mode, hw) in LINES.items():
    p0 = np.array(p0, float); p1 = np.array(p1, float)
    L = np.linalg.norm(p1 - p0); u = (p1 - p0) / L; nrm = np.array([u[1], -u[0]])
    ts = np.arange(0, L + 0.1, 3.0); offs = np.arange(-hw, hw + 0.01, 0.5)
    pts = []
    for t in ts:
        c = p0 + u * t
        q = c[None, :] + offs[:, None] * nrm[None, :]
        v = samp(SL if mode == "slope" else S, q[:, 0], q[:, 1])
        i = {"min": np.argmin, "max": np.argmax, "slope": np.argmax}[mode](v)
        pts.append(q[i])
    pts = np.array(pts)
    keep = np.ones(len(pts), bool)
    for _ in range(3):
        A = pts[keep]; m = A.mean(0); _, _, vt = np.linalg.svd(A - m); d = vt[0]
        res = np.abs((pts - m) @ np.array([d[1], -d[0]]))
        keep = res < max(2.5, np.percentile(res, 70))
    A = pts[keep]; m = A.mean(0); _, _, vt = np.linalg.svd(A - m); d = vt[0]
    if d @ u < 0: d = -d
    proj = (A - m) @ d; a, b = m + d * proj.min(), m + d * proj.max()
    az = math.degrees(math.atan2(d[0], d[1])) % 360
    rms = math.sqrt(np.mean(((A - m) @ np.array([d[1], -d[0]])) ** 2))
    print(f"{name:32s} az_grid {az:6.1f}  az_true {(az-1.23)%360:6.1f}  len {np.ptp(proj):6.1f}  inliers {keep.sum()}/{len(keep)} rms {rms:4.2f}  "
          f"from ({a[0]:.1f},{a[1]:.1f}) to ({b[0]:.1f},{b[1]:.1f})")
