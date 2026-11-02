"""Georeference the 1805 map of the Karlsberg ruins (Commons File:Karlsberg_karte_II.jpg, PD, 642 x 531 px copy)
to EPSG:25832. The copy is small (~2.9 m per pixel), so only a few large features can serve as control points.

Usage (from pipeline/, isolated):
  uv run python -I ../schloss-karlsberg/research/scripts/georef_1805.py fit
  uv run python -I ../schloss-karlsberg/research/scripts/georef_1805.py render <workdir-with-hs_multi.tif> <outdir>
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import georef_common as gc  # noqa: E402
import georef_lageplan as lp  # noqa: E402

MAP = gc.SK / "sources/Karlsberg_karte_II.jpg"
ATTR = ("Map: Karlsberg_karte_II.jpg (ruins map 1805, Commons, public domain), georeferenced · vectors: "
        "Karlsberg_Lageplan.gif, schloss-carlsberg.de, CC BY-SA 2.0 DE")

# (id, map px x, map px y, E, N, weight, kind, note); kind 'pt' = point pair, 'line:<fid>' = point on LiDAR line
CP = [
    ("palace complex centre (parcel 106)", 276.0, 318.0, 382224.0, 5466151.0, 1.0, "pt",
     "two-court ruin block vs centre of the LiDAR foundation field KB-01..07"),
    ("Orangerie block", 300.0, 392.0, 382262.0, 5465965.0, 1.0, "pt",
     "block at the head of the straight SSE avenue vs Orangerie (KB-30/31 + 2006 plan wings)"),
    ("Apfelallee a", 330.0, 444.0, None, None, 1.0, "line:KB-14", "straight SSE avenue"),
    ("Apfelallee b", 385.0, 520.0, None, None, 1.0, "line:KB-14", "straight SSE avenue"),
    ("N-S road a", 247.0, 20.0, None, None, 0.7, "line:KB-11", "double-line road W of the north group"),
    ("N-S road b", 247.0, 120.0, None, None, 0.7, "line:KB-11", "double-line road W of the north group"),
    ("pond (dark parcel W of 121)", 137.0, 442.0, *lp.fc("KB-40"), 0.7, "pt", "Karlsbergweiher water surface centroid"),
    ("Marstall double court", 272.0, 178.0, 382213.0, 5466465.0, 0.5, "pt",
     "two-court block at the 'Carlsberg' label vs Marstall of the georeferenced 2006 plan (secondary)"),
]


def _line_target(fid, en):
    from shapely.geometry import LineString, Point
    ln = LineString(lp.F[fid]["geometry"]["coordinates"])
    q = ln.interpolate(ln.project(Point(*en)))
    return q.x, q.y


def solve():
    px = np.array([[c[1], c[2]] for c in CP]); w = np.array([c[5] for c in CP])
    pts = [i for i, c in enumerate(CP) if c[6] == "pt"]
    T = gc.fit(px[pts], np.array([[CP[i][3], CP[i][4]] for i in pts]), "similarity", w[pts])
    for _ in range(8):
        pred = gc.apply(T, px)
        en = np.array([(c[3], c[4]) if c[6] == "pt" else _line_target(c[6].split(":")[1], pred[i]) for i, c in enumerate(CP)])
        T = gc.fit(px, en, "similarity", w)
    return T, px, en, w


def cmd_fit():
    T, px, en, w = solve()
    r, rms = gc.residuals(T, px, en)
    lo = gc.loo(px, en, "similarity", w)
    print(f"1805 map similarity, n={len(CP)}: rms {rms:.1f} m  {gc.describe(T)}")
    for c, (dx, dy), l in zip(CP, r, lo):
        print(f"| {c[0]} | {c[6]} | {dx:+.1f} | {dy:+.1f} | {np.hypot(dx, dy):.1f} | {l:.1f} |")


def cmd_render():
    import matplotlib; matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from PIL import Image, ImageOps
    wd, outdir = sys.argv[2], sys.argv[3]
    T, *_ = solve()
    a = np.asarray(ImageOps.autocontrast(Image.open(MAP).convert("L"), cutoff=1), float) / 255.0
    rgba = np.zeros(a.shape + (4,))
    dark = np.clip((0.75 - a) / 0.5, 0, 1)  # ink/hatching
    rgba[..., 0] = 0.55; rgba[..., 1] = 0.1; rgba[..., 2] = 0.0; rgba[..., 3] = 0.75 * dark
    feats = lp.vectorise()
    views = [("37_map1805_site.jpg", 381300, 5465500, 1500, 1500, "1805 ruins map over LiDAR (similarity, 8 control points)"),
             ("38_map1805_core.jpg", 382050, 5465850, 400, 750, "1805 ruins map over LiDAR — palace, gardens, Marstall")]
    for fn, e0, n0, wv, hv, title in views:
        b = (e0, n0, e0 + wv, n0 + hv)
        res = max(wv, hv) / 1400.0
        hs = lp.hillshade(wd, b, res)
        ov = lp.warp_plan(rgba, T, b, res)
        base = np.dstack([0.1 + 0.85 * hs] * 3)
        img = base * (1 - ov[..., 3:4]) + ov[..., :3] * ov[..., 3:4]
        fig = plt.figure(figsize=(10.6, 10.6 * hv / wv + 0.6), dpi=150)
        ax = fig.add_axes([0.07, 0.06, 0.9, 0.88])
        ax.imshow(np.clip(img, 0, 1), extent=(b[0], b[2], b[1], b[3]), interpolation="bilinear")
        for f in feats:
            for poly in getattr(f["geom"], "geoms", [f["geom"]]):
                x, y = poly.exterior.xy
                ax.plot(x, y, color="#e000c0", lw=0.9)
        for f in lp.F.values():
            g = f["geometry"]
            cc = np.asarray(g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"], float)
            ax.plot(cc[:, 0], cc[:, 1], color="#ffb000", lw=0.6, ls="--")
        cpx = gc.apply(T, np.array([[c[1], c[2]] for c in CP]))
        ax.plot(cpx[:, 0], cpx[:, 1], "o", mfc="none", mec="#00a0ff", ms=7, mew=1.2)
        g = 50 if wv <= 800 else 250
        ax.set_xticks(np.arange(np.ceil(b[0] / g) * g, b[2] + 1, g)); ax.set_yticks(np.arange(np.ceil(b[1] / g) * g, b[3] + 1, g))
        ax.tick_params(labelsize=5.5); ax.ticklabel_format(useOffset=False, style="plain"); ax.grid(color="k", alpha=0.2, lw=0.4)
        ax.set_xlim(b[0], b[2]); ax.set_ylim(b[1], b[3])
        ax.set_title(title + "\nbrown = 1805 map ink · magenta = vectorised 2006 plan · orange dashed = LiDAR features · blue circles = control points", fontsize=7)
        fig.text(0.07, 0.012, ATTR + " · Relief: DGM1 © GeoBasis-DE/LVGL-SL 2025 (dl-de/by-2-0), processed · EPSG:25832", fontsize=5.5)
        out = Path(outdir) / fn
        fig.savefig(out, dpi=150, pil_kwargs={"quality": 85}); plt.close(fig)
        im = Image.open(out)
        if max(im.size) > 1600:
            s = 1600 / max(im.size); im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS).save(out, quality=85)
        print(out, Image.open(out).size)


if __name__ == "__main__":
    {"fit": cmd_fit, "render": cmd_render}[sys.argv[1]]()
