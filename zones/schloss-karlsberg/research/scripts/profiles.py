"""DTM height profiles through key structures (1 m DTM, bilinear). Writes a multi-panel JPG and a CSV-ish printout.
Usage: profiles.py <workdir> <out.jpg>"""
import sys, math
from pathlib import Path
import numpy as np, rasterio
from scipy.ndimage import map_coordinates
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
wd = Path(sys.argv[1]); out = sys.argv[2]
with rasterio.open(wd / "dgm1.tif") as d:
    Z = d.read(1); tf = d.transform
with rasterio.open(wd / "dom1.tif") as d:
    D = d.read(1)
def samp(A, e, n):
    c = (np.asarray(e) - tf.c) / tf.a - 0.5; r = (np.asarray(n) - tf.f) / tf.e - 0.5
    return map_coordinates(A, [r, c], order=1, mode="nearest")
P = [
 ("P1 N-S through palace core and north terrace (E 382225)", (382225, 5466040), (382225, 5466560),
  {5466091: "S-wing", 5466120: "court/path", 5466150: "central wing", 5466195: "N court", 5466222: "scarp", 5466368: "terrace scarp", 5466430: "N terrace"}),
 ("P2 along palace axis az 80 (court line)", (382120, 5466108), (382420, 5466161), {}),
 ("P3 E-W across north terrace (N 5466420)", (382100, 5466420), (382340, 5466420), {382178: "N-S path", 382271: "E scarp"}),
 ("P4 across Orangerie (az 77.7, N~5465965)", (382190, 5465955), (382310, 5465981), {}),
 ("P5 Karlslust axis N-S (E 382815): cascade - Tosbecken - canal/avenue", (382815, 5464960), (382815, 5464640), {}),
 ("P6 Karlsbergweiher valley W-E (N 5465875)", (381650, 5465872), (382060, 5465880), {}),
 ("P7 cell-terrace complex along long axis (az ~164)", (383005, 5464935), (383068, 5464715), {}),
]
fig, axs = plt.subplots(len(P), 1, figsize=(10, 2.1 * len(P)), dpi=150)
for ax, (name, p0, p1, marks) in zip(axs, P):
    p0 = np.array(p0, float); p1 = np.array(p1, float); L = np.linalg.norm(p1 - p0)
    t = np.arange(0, L, 0.5); q = p0 + (p1 - p0)[None, :] * (t / L)[:, None]
    z = samp(Z, q[:, 0], q[:, 1]); ds = samp(D, q[:, 0], q[:, 1])
    ax.fill_between(t, z, np.maximum(ds, z), color="#7fbf7f", alpha=0.35, lw=0, label="DSM (vegetation)")
    ax.plot(t, z, "k", lw=0.9, label="DTM")
    az = math.degrees(math.atan2(*(p1 - p0))) % 360
    ax.set_title(f"{name}   from ({p0[0]:.0f}, {p0[1]:.0f}) az {az:.1f}° grid, {L:.0f} m", fontsize=7)
    ax.set_ylim(z.min() - 1, z.max() + 3)
    ax.tick_params(labelsize=6); ax.grid(alpha=0.3); ax.set_ylabel("m DHHN2016", fontsize=6)
    for k, lab in marks.items():
        tt = (k - p0[1]) if p0[0] == p1[0] else (k - p0[0])
        if p1[1] < p0[1] and p0[0] == p1[0]: tt = p0[1] - k
        ax.axvline(tt, color="r", lw=0.5, alpha=0.6); ax.text(tt, z.max() + 1.5, lab, fontsize=5.5, color="r", ha="center")
    print(f"# {name}")
    for tt in range(0, int(L) + 1, 10):
        i = min(int(tt / 0.5), len(z) - 1); print(f"  t={tt:4d} E={q[i,0]:.0f} N={q[i,1]:.0f} z={z[i]:.2f}")
axs[-1].set_xlabel("distance along profile (m)", fontsize=7); axs[0].legend(fontsize=6, loc="lower right")
fig.text(0.01, 0.002, "DGM1/DOM1 © GeoBasis-DE/LVGL-SL 2025, dl-de/by-2-0, processed. Vertical exaggeration varies per panel.", fontsize=5.5)
fig.tight_layout(rect=(0, 0.01, 1, 1)); fig.savefig(out, pil_kwargs={"quality": 85}); print(out)
