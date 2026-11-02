"""Render annotated relief crops (EPSG:25832 grid, scale bar) to JPG.
Usage: render.py <workdir> <outdir> <spec.json>
spec: [{"name":..., "e0":..., "n0":..., "w":..., "h":..., "layer": "combo|slrm5|slrm10|slrm20|hs|opns|hist1840|hist1935|ortho|dtm|chm",
        "grid": 100, "features": "<geojson>", "labels": true, "title": "..."}]"""
import json, sys
from pathlib import Path
import numpy as np, rasterio
from rasterio.windows import from_bounds
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MPoly

ROOT = Path(__file__).resolve().parents[3]
wd, outdir = Path(sys.argv[1]), Path(sys.argv[2])
spec = json.loads(Path(sys.argv[3]).read_text())
HIST = {"hist1840": ROOT / "data/work/karlsberg/hist_1840.tif", "hist1935": ROOT / "data/work/karlsberg/hist_1935.tif",
        "ortho": ROOT / "data/work/karlsberg/ortho_1m.tif"}

def rd(name, b, path=None):
    p = path or (wd / f"{name}.tif")
    with rasterio.open(p) as d:
        win = from_bounds(*b, transform=d.transform)
        a = d.read(window=win, boundless=True, fill_value=0)
    return a if a.shape[0] > 1 else a[0]

def norm(a, lo, hi):
    return np.clip((a - lo) / (hi - lo), 0, 1)

def layer_rgb(s, b):
    L = s["layer"]
    hs = rd("hs_multi", b)
    hsn = norm(hs, *np.percentile(hs, [1, 99.5]))
    if L == "hs":
        return np.dstack([hsn] * 3), None
    if L.startswith("slrm"):
        a = rd(L, b); lim = s.get("lim", {"slrm5": 0.4, "slrm10": 0.6, "slrm20": 1.0}[L])
        c = plt.get_cmap("RdBu_r")(norm(a, -lim, lim))[..., :3]
        return c * (0.55 + 0.45 * hsn[..., None]), (f"SLRM {L[4:]} m, ±{lim} m", lim)
    if L == "opns":
        a = rd("opns_pos", b); n = rd("opns_neg", b)
        g = norm(a, *np.percentile(a, [2, 99.5])) * (1 - 0.6 * norm(n, *np.percentile(n, [60, 99.8])))
        return np.dstack([g] * 3), None
    if L == "combo":
        a = rd("slrm10", b); o = rd("opns_pos", b)
        on = norm(o, *np.percentile(o, [2, 99.5]))
        lim = s.get("lim", 0.6)
        c = plt.get_cmap("RdBu_r")(norm(a, -lim, lim))[..., :3]
        base = (0.5 * hsn + 0.5 * on)[..., None]
        return 0.55 * c * (0.4 + 0.6 * base) + 0.45 * base, (f"SLRM 10 m ±{lim} m over hillshade+openness", lim)
    if L == "dtm":
        a = rd("dgm1", b)
        lo, hi = s.get("hrange", np.percentile(a, [1, 99]))
        c = plt.get_cmap("terrain")(norm(a, lo, hi))[..., :3]
        return c * (0.45 + 0.55 * hsn[..., None]), (f"DTM {lo:.0f}–{hi:.0f} m", None)
    if L == "chm":
        a = rd("dom1", b) - rd("dgm1", b)
        c = plt.get_cmap("Greens")(norm(a, 0, 35))[..., :3]
        return c * (0.5 + 0.5 * hsn[..., None]), ("canopy height 0–35 m", None)
    if L in HIST:
        a = rd(None, b, HIST[L]).astype("float32") / 255
        rgb = np.moveaxis(a[:3], 0, -1)
        k = s.get("blend", 0.35)
        return rgb * (1 - k + k * hsn[..., None]), None
    raise ValueError(L)

def draw(s):
    b = (s["e0"], s["n0"], s["e0"] + s["w"], s["n0"] + s["h"])
    rgb, leg = layer_rgb(s, b)
    W = 1500; dpi = 150
    asp = s["h"] / s["w"]
    fig = plt.figure(figsize=(W / dpi, W / dpi * asp + 0.6), dpi=dpi)
    ax = fig.add_axes([0.07, 0.06, 0.9, 0.9 * (W / dpi * asp) / (W / dpi * asp + 0.6)])
    ax.imshow(np.clip(rgb, 0, 1), extent=(b[0], b[2], b[1], b[3]), interpolation="bilinear" if s["w"] > 600 else "bicubic")
    g = s.get("grid", 100)
    xs = np.arange(np.ceil(b[0] / g) * g, b[2] + 1, g); ys = np.arange(np.ceil(b[1] / g) * g, b[3] + 1, g)
    ax.set_xticks(xs); ax.set_yticks(ys)
    ax.set_xticklabels([f"{x:.0f}" for x in xs], fontsize=5.5, rotation=0)
    ax.set_yticklabels([f"{y:.0f}" for y in ys], fontsize=5.5)
    ax.grid(color="k", alpha=0.25, lw=0.4)
    ax.set_xlim(b[0], b[2]); ax.set_ylim(b[1], b[3])
    # scale bar
    sb = s.get("scalebar", 100 if s["w"] > 500 else 50)
    x0 = b[0] + 0.04 * s["w"]; y0 = b[1] + 0.04 * s["h"]
    ax.add_patch(plt.Rectangle((x0 - 0.01 * s["w"], y0 - 0.015 * s["h"]), sb + 0.02 * s["w"], 0.05 * s["h"], fc="white", alpha=0.75, lw=0))
    ax.plot([x0, x0 + sb], [y0, y0], color="k", lw=3, solid_capstyle="butt")
    ax.plot([x0, x0 + sb / 2], [y0, y0], color="w", lw=1.5, solid_capstyle="butt")
    ax.text(x0 + sb / 2, y0 + 0.012 * s["h"], f"{sb} m", ha="center", fontsize=6)
    ax.annotate("N (grid)", xy=(b[2] - 0.04 * s["w"], b[3] - 0.03 * s["h"]), xytext=(b[2] - 0.04 * s["w"], b[3] - 0.11 * s["h"]),
                arrowprops=dict(arrowstyle="-|>", color="k"), ha="center", fontsize=6, bbox=dict(fc="white", alpha=0.7, lw=0))
    if s.get("features"):
        fc = json.loads(Path(s["features"]).read_text())
        col = {"wall": "#ff00ff", "foundation": "#ff00ff", "terrace": "#ffcc00", "platform": "#ff7f00", "pond": "#00e5ff",
               "dam": "#0040ff", "path": "#ffffff", "avenue": "#7fff00", "pit": "#ff0000", "cellar": "#ff0000", "other": "#ffffff"}
        for f in fc["features"]:
            p = f["properties"]; gm = f["geometry"]; c = col.get(p["kind"], "w")
            ls = {"high": "-", "med": "--", "low": ":"}[p["confidence"]]
            if gm["type"] == "Polygon":
                ring = np.array(gm["coordinates"][0])
                ax.add_patch(MPoly(ring[:, :2], closed=True, fill=False, ec=c, lw=1.1, ls=ls))
                cx, cy = ring[:-1, 0].mean(), ring[:-1, 1].mean()
            elif gm["type"] == "LineString":
                l = np.array(gm["coordinates"]); ax.plot(l[:, 0], l[:, 1], color=c, lw=1.1, ls=ls)
                cx, cy = l[len(l) // 2, 0], l[len(l) // 2, 1]
            else:
                cx, cy = gm["coordinates"][:2]; ax.plot(cx, cy, "o", ms=4, mfc="none", mec=c, mew=1.2)
            if s.get("labels", True) and b[0] < cx < b[2] and b[1] < cy < b[3]:
                ax.text(cx, cy, p["id"], fontsize=5.5 if s["w"] > 600 else 7, color="k", ha="center", va="center",
                        bbox=dict(fc=c, alpha=0.75, lw=0, pad=0.8))
    for pt in s.get("points", []):
        ax.plot(pt[0], pt[1], "x", color="yellow", ms=6, mew=1.5)
        ax.text(pt[0] + 0.01 * s["w"], pt[1], pt[2], fontsize=6, color="k", bbox=dict(fc="yellow", alpha=0.7, lw=0, pad=0.8))
    ttl = s.get("title", s["name"])
    if leg: ttl += f"  [{leg[0]}; red = high, blue = low]" if leg[1] else f"  [{leg[0]}]"
    ax.set_title(ttl, fontsize=7.5)
    fig.text(0.07, 0.008, "EPSG:25832 (UTM32N), grid in m. DGM1 © GeoBasis-DE/LVGL-SL 2025 / LVermGeoRP 2022, dl-de/by-2-0, processed" +
             ("; historic map © GeoBasis-DE/LVGL-SL" if s["layer"].startswith("hist") or s["layer"] == "ortho" else ""), fontsize=5)
    out = outdir / f"{s['name']}.jpg"
    fig.savefig(out, dpi=dpi, pil_kwargs={"quality": 85})
    plt.close(fig)
    print(out)

for s in spec:
    if "only" in sys.argv[4:] and s["name"] not in sys.argv[5:]:
        continue
    draw(s)
