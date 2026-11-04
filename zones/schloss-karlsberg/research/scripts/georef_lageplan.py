"""Georeference the 2006 'Lageplan des Carlsberges mit der Carlslust' (Commons File:Karlsberg_Lageplan.gif,
schloss-carlsberg.de, CC BY-SA 2.0 DE) to EPSG:25832 with control points matched to LiDAR features.

Usage (from pipeline/, isolated):
  uv run python -I ../zones/schloss-karlsberg/research/scripts/georef_lageplan.py fit
  uv run python -I ../zones/schloss-karlsberg/research/scripts/georef_lageplan.py render <workdir-with-hs_multi.tif>
  uv run python -I ../zones/schloss-karlsberg/research/scripts/georef_lageplan.py vector

Plan pixel coordinates refer to the original 2050 x 1477 GIF. The plan is drawn with north to the LEFT.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import georef_common as gc  # noqa: E402

PLAN = gc.SK / "sources/Karlsberg_Lageplan.gif"
OUT_JSON = Path("/private/tmp") / "georef_lageplan_result.json"  # overridden by argv in render/vector
ATTR = "Plan: Karlsberg_Lageplan.gif, schloss-carlsberg.de, CC BY-SA 2.0 DE (georeferenced, recoloured)"

F = gc.load_features()
C = {b["id"]: b for b in gc.load_catalogue()["buildings"]}


def fc(fid):
    return gc.centroid(F[fid]["geometry"]["coordinates"][0]).tolist()


# ---- control points: (id, plan px x, plan px y, E, N, group, weight, note) -------------------------------
# plan px = centre of the drawn element (read from red/blue pixel components, original resolution)
CP = [
    ("S-wing 3 / KB-02", 742.0, 695.5, *fc("KB-02"), "core", 1.0, "Suedfluegel (3) centre vs LiDAR S wing"),
    ("N-wing 2 / KB-03", 700.5, 700.0, *fc("KB-03"), "core", 1.0, "Nordfluegel (2) centre vs LiDAR central E-W band"),
    ("W-wing 4 / KB-05", 675.0, 724.0, *fc("KB-05"), "core", 1.0, "Westfluegel (4) vs LiDAR west block"),
    ("E-wing 5 / KB-06", 674.5, 683.0, *fc("KB-06"), "core", 0.5, "Kuechenfluegel (5) vs NE block (plan bar 2x longer)"),
    ("Orangerie 7 / KB-31", 827.0, 693.0, *fc("KB-31"), "core", 1.0, "Orangerie main range vs standing W wall/building"),
    ("Marstall 12 / KB-20", 457.0, 682.0, *fc("KB-20"), "north", 1.0, "Marstall+Reithalle block vs north terrace (global fit only)"),
    ("Weiher 32 / KB-40", 873.0, 944.0, *fc("KB-40"), "valley", 0.5, "pond centroid (pond was larger in 1789?)"),
    ("Baumagazin 36 / LoD2", 911.0, 1209.0, *gc.centroid(C["KB-B29"]["footprint"]).tolist(), "valley", 1.0,
     "surviving building (LoD2 footprint)"),
    ("Amphitheater 53 / KL-01", 1610.0, 235.0, *fc("KL-01"), "karlslust", 1.0, "round red mark vs moated round island"),
    ("Tosbecken / KL-04", 1681.0, 330.0, *fc("KL-04"), "karlslust", 1.0, "round basin at head of Grosse Kaskade 58"),
    ("Schwanenweiher 57a / KL-05", 1704.3, 301.6, *fc("KL-05"), "karlslust", 1.0, "upper pond"),
    ("Schwanenweiher 57b / KL-06", 1750.3, 281.6, *fc("KL-06"), "karlslust", 1.0, "lower pond"),
    ("Menagerie 54 / KL-02", 1667.0, 170.0, *fc("KL-02"), "karlslust", 0.5, "parallelogram centre vs terraced cell complex"),
]

# windows for overlays: (file, e0, n0, w, h, transform-set, title)
VIEWS = [
    ("30_lageplan2006_site.jpg", 381250, 5464450, 2100, 2650, "global", "2006 Lageplan over LiDAR — whole residence (global similarity)"),
    ("31_lageplan2006_core.jpg", 382000, 5465850, 450, 450, "core", "2006 Lageplan over LiDAR — palace core + Orangerie (local similarity: wings + Orangerie + road KB-10/11)"),
    ("32_lageplan2006_north.jpg", 381950, 5466200, 700, 900, "north", "2006 Lageplan over LiDAR — Marstall / utility row (local similarity: N/W wings + road KB-10/11 + scarp KB-22)"),
    ("33_lageplan2006_karlslust.jpg", 382500, 5464500, 700, 600, "karlslust", "2006 Lageplan over LiDAR — Carlslust (local similarity)"),
]

SETS = {
    "global": None,  # all points
    "core": {"core"},  # + road-line constraints (below): palace core, Orangerie, garden buildings S of the palace
    "north": {"core"},  # N/W wings only + road line + KB-22 scarp (below): Marstall and the utility row
    "karlslust": {"karlslust"},
}

# Centre line of the plan's main road W of the utility row (grey band, plan px) -- assumed to be the LiDAR hollow
# way / avenue KB-10 + KB-11 [I]. Used as point-on-line constraints for the 'north' transform only.
ROAD_PX = [(240, 689.0), (300, 695.5), (350, 701.0), (480, 714.0), (540, 721.5), (600, 727.5)]
# South end of the Marstall / north edge of garden 11 in the plan -> S scarp KB-22 of the north terrace [I; the
# 1805 ruins map shows the Marstall block starting at this scarp too]
SCARP_PX = [(524, 660.0), (524, 700.0)]


def _road_target(en, fids=("KB-10", "KB-11")):
    """Project a point onto the nearest of the given LiDAR lines."""
    from shapely.geometry import LineString, Point
    best = None
    for fid in fids:
        ln = LineString(F[fid]["geometry"]["coordinates"])
        q = ln.interpolate(ln.project(Point(*en)))
        d = Point(*en).distance(q)
        if best is None or d < best[0]:
            best = (d, (q.x, q.y))
    return best[1]


def arrays(groups=None):
    rows = [c for c in CP if groups is None or c[5] in groups]
    px = np.array([[c[1], c[2]] for c in rows]); en = np.array([[c[3], c[4]] for c in rows]); w = np.array([c[6] for c in rows])
    return rows, px, en, w


def north_arrays(which="core"):
    """'core': palace wings + Orangerie + road line. 'north': N/W wings + road line + KB-22 scarp (utility row)."""
    rows, px, en, w = arrays(SETS["core"])
    if which == "north":
        keep = [i for i, r in enumerate(rows) if r[0].startswith(("N-wing", "W-wing"))]
        rows = [rows[i] for i in keep]; px, en, w = px[keep], en[keep], w[keep]
    T = gc.fit(px, en, "similarity", w)
    extra = ROAD_PX + (SCARP_PX if which == "north" else [])
    rpx = np.array(extra, float)
    nr = len(ROAD_PX)
    rw = np.r_[np.full(nr, 0.5), np.full(len(rpx) - nr, 1.0)]
    for _ in range(10):  # iterate: predict -> project onto LiDAR line -> refit
        pred = gc.apply(T, rpx)
        ren = np.array([_road_target(p) for p in pred[:nr]] + [_road_target(p, ("KB-22",)) for p in pred[nr:]])
        T = gc.fit(np.r_[px, rpx], np.r_[en, ren], "similarity", np.r_[w, rw])
    rrows = ([(f"road KB-10/11 @px{int(x)}", x, y, *e, "road", 0.5, "point-on-line") for (x, y), e in zip(ROAD_PX, ren[:nr])] +
             [(f"scarp KB-22 @px{int(x)},{int(y)}", x, y, *e, "road", 1.0, "point-on-line") for (x, y), e in zip(SCARP_PX, ren[nr:])])
    return rows + rrows, np.r_[px, rpx], np.r_[en, ren], np.r_[w, rw]


def transforms():
    out = {}
    for name, groups in SETS.items():
        rows, px, en, w = north_arrays(name) if name in ("north", "core") else arrays(groups)
        out[name] = gc.fit(px, en, "similarity", w)
    rows, px, en, w = arrays(None)
    out["global_affine"] = gc.fit(px, en, "affine", w)
    return out


def cmd_fit():
    T = transforms()
    res = {"transforms": T, "describe": {k: gc.describe(v) for k, v in T.items()}, "residuals": {}}
    for name in ["global", "global_affine", "core", "north", "karlslust"]:
        groups = SETS.get(name.replace("_affine", ""))
        rows, px, en, w = north_arrays(name) if name in ("north", "core") else arrays(groups)
        r, rms = gc.residuals(T[name], px, en)
        lo = gc.loo(px, en, T[name]["kind"], w)
        print(f"\n== {name} ({T[name]['kind']}, n={len(rows)}) rms {rms:.1f} m  {gc.describe(T[name])}")
        res["residuals"][name] = {"rms": rms, "points": []}
        for c, (dx, dy), l in zip(rows, r, lo):
            print(f"  {c[0]:32s} dE {dx:+7.1f} dN {dy:+7.1f} |{np.hypot(dx, dy):6.1f}|  LOO {l:6.1f}")
            res["residuals"][name]["points"].append({"id": c[0], "dE": round(float(dx), 1), "dN": round(float(dy), 1),
                                                     "abs": round(float(np.hypot(dx, dy)), 1), "loo": round(l, 1)})
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else OUT_JSON
    out.write_text(json.dumps(res, indent=1)); print("->", out)


# ---- rendering -------------------------------------------------------------------------------------------
def load_plan():
    from PIL import Image
    return np.array(Image.open(PLAN).convert("RGB")).astype(np.int16)


def classify(rgb):
    """RGBA overlay colours for the plan classes (background green/white -> transparent)."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    out = np.zeros(rgb.shape[:2] + (4,), float)
    red = (r > 180) & (g < 70) & (b < 70)
    blue = (b > r + 25) & (b > g + 5)
    grey = (abs(r - 223) < 8) & (abs(g - 223) < 8) & (abs(b - 222) < 8)
    garden = ((abs(r - 185) < 12) & (abs(g - 219) < 12) & (abs(b - 125) < 15)) | ((abs(r - 143) < 12) & (abs(g - 85) < 12) & (abs(b - 69) < 12))
    black = (r < 60) & (g < 60) & (b < 60)
    yy, xx = np.mgrid[0:rgb.shape[0], 0:rgb.shape[1]]
    text = ((yy < 175) & (xx < 1060)) | ((xx > 1320) & (yy > 675)) | ((xx < 250) & (yy > 1060))  # title, legend, compass
    black &= ~text
    out[grey] = (1.0, 1.0, 0.85, 0.45)
    out[garden] = (0.75, 1.0, 0.3, 0.30)
    out[blue] = (0.2, 0.45, 1.0, 0.65)
    out[red] = (1.0, 0.1, 0.05, 0.60)
    out[black] = (0.0, 0.0, 0.0, 0.85)
    return out


def hillshade(wd, b, res):
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.windows import from_bounds
    with rasterio.open(Path(wd) / "hs_multi.tif") as d:
        win = from_bounds(*b, transform=d.transform)
        h = int(round((b[3] - b[1]) / res)); w = int(round((b[2] - b[0]) / res))
        a = d.read(1, window=win, boundless=True, fill_value=np.nan, out_shape=(h, w), resampling=Resampling.average)
    lo, hi = np.nanpercentile(a, [2, 98])
    return np.nan_to_num(np.clip((a - lo) / (hi - lo), 0, 1), nan=1.0)


def warp_plan(plan_rgba, T, b, res):
    h = int(round((b[3] - b[1]) / res)); w = int(round((b[2] - b[0]) / res))
    E = b[0] + (np.arange(w) + 0.5) * res
    N = b[3] - (np.arange(h) + 0.5) * res
    EE, NN = np.meshgrid(E, N)
    px = gc.inverse(T, np.c_[EE.ravel(), NN.ravel()])
    x = np.round(px[:, 0]).astype(int); y = np.round(px[:, 1]).astype(int)
    ok = (x >= 0) & (y >= 0) & (x < plan_rgba.shape[1]) & (y < plan_rgba.shape[0])
    out = np.zeros((h * w, 4)); out[ok] = plan_rgba[y[ok], x[ok]]
    return out.reshape(h, w, 4)


def draw_view(wd, outdir, plan_rgba, T, view, extra=None):
    import matplotlib; matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fn, e0, n0, w, h, tset, title = view
    b = (e0, n0, e0 + w, n0 + h)
    res = max(w, h) / 1400.0
    hs = hillshade(wd, b, res)
    ov = warp_plan(plan_rgba, T, b, res)
    base = np.dstack([0.05 + 0.9 * hs] * 3)
    img = base * (1 - ov[..., 3:4]) + ov[..., :3] * ov[..., 3:4]
    fig = plt.figure(figsize=(10.6, 10.6 * h / w + 0.6), dpi=150)
    ax = fig.add_axes([0.07, 0.06, 0.9, 0.88])
    ax.imshow(np.clip(img, 0, 1), extent=(b[0], b[2], b[1], b[3]), interpolation="nearest")
    # catalogue footprints (cyan) and LiDAR features (yellow)
    for f in F.values():
        g = f["geometry"]
        cc = np.asarray(g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"], float)
        if not ((cc[:, 0] > b[0]) & (cc[:, 0] < b[2]) & (cc[:, 1] > b[1]) & (cc[:, 1] < b[3])).any():
            continue
        ax.plot(cc[:, 0], cc[:, 1], color="#ffd400", lw=0.7, ls="--")
        if w <= 900:
            m = cc.mean(0); ax.text(m[0], m[1], f["properties"]["id"], color="#806a00", fontsize=5, ha="center")
    for bid, bb in C.items():
        fp = bb.get("footprint")
        if not fp:
            continue
        cc = np.asarray(fp, float)
        if not ((cc[:, 0] > b[0]) & (cc[:, 0] < b[2]) & (cc[:, 1] > b[1]) & (cc[:, 1] < b[3])).any():
            continue
        ax.plot(cc[:, 0], cc[:, 1], color="#00b7ff", lw=1.0)
        if w <= 900:
            m = cc[:-1].mean(0); ax.text(m[0], m[1], bid, color="#004a80", fontsize=5.5, ha="center", va="center", weight="bold")
    if extra:
        extra(ax, b)
    gstep = 50 if w <= 900 else 250
    ax.set_xticks(np.arange(np.ceil(b[0] / gstep) * gstep, b[2] + 1, gstep)); ax.set_yticks(np.arange(np.ceil(b[1] / gstep) * gstep, b[3] + 1, gstep))
    ax.tick_params(labelsize=5.5); ax.ticklabel_format(useOffset=False, style="plain"); ax.grid(color="k", alpha=0.2, lw=0.4)
    ax.set_xlim(b[0], b[2]); ax.set_ylim(b[1], b[3])
    ax.set_title(title + "\nplan colours: red buildings, blue water, pale yellow roads, light green gardens · cyan = catalogue v1 footprints · yellow dashed = LiDAR features (research/03)", fontsize=7)
    fig.text(0.07, 0.012, ATTR + " · Relief: DGM1 © GeoBasis-DE/LVGL-SL 2025 (dl-de/by-2-0), processed · EPSG:25832, grid N up", fontsize=5.5)
    out = Path(outdir) / fn
    fig.savefig(out, dpi=150, pil_kwargs={"quality": 85}); plt.close(fig)
    from PIL import Image
    im = Image.open(out)
    if max(im.size) > 1600:
        s = 1600 / max(im.size); im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS).save(out, quality=85)
    print(out, Image.open(out).size)


def cmd_render():
    wd, outdir = sys.argv[2], sys.argv[3]
    T = transforms()
    plan = classify(load_plan())
    only = sys.argv[4:] or None
    for v in VIEWS:
        if only and v[0] not in only:
            continue
        draw_view(wd, outdir, plan, T[v[5]], v)


# ---- vectorising the plan's buildings ----------------------------------------------------------------------
# (plan no., German name from the plan legend, transform set, parts). Part kinds:
#   ("rect", [component ids]) -> minimum rotated rectangle of the components (bars split by label circles)
#   ("shape", [component ids]) -> traced pixel outline (L/U/ring shapes)
#   ("box", [x0, y0, x1, y1]) -> manual axis-parallel box in plan px (tiny marks below the component threshold)
# component ids = scipy.ndimage.label of the red fill (r>180, g<70, b<70) of the original GIF, 8-bit RGB
BUILDINGS = [
    ("1", "Corps de Logis", "core", [("rect", [63, 64])]),
    ("2", "Nordfluegel, Fluegel des Herzogs", "core", [("rect", [70, 87])]),
    ("3", "Suedfluegel, Fluegel der Herzogin", "core", [("rect", [67, 83])]),
    ("4", "Westfluegel", "core", [("rect", [91, 92])]),
    ("5", "Ostfluegel, Kuechenfluegel", "core", [("rect", [71, 72])]),
    ("6", "Galeriefluegel", "core", [("shape", [59, 88])]),
    ("7", "Orangerie", "core", [("shape", [55, 66])]),
    ("8", "Taubenhaus", "core", [("rect", [75, 77])]),
    ("9", "Chevau-leger Kaserne", "core", [("rect", [85, 86])]),
    ("10", "Waffenschmiede", "north", [("rect", [90])]),
    ("11", "Hollaendische Gaertnerei: kleine Gebaeude im Garten (Treibhaeuser?)", "north", [("rect", [68]), ("rect", [82]), ("rect", [89])]),
    ("12", "Marstall", "north", [("shape", [60, 62, 74, 78])]),
    ("13", "Reithalle", "north", [("rect", [58])]),
    ("14", "Remisen", "north", [("rect", [48, 49])]),
    ("15", "Zwinger", "north", [("shape", [57]), ("rect", [65])]),
    ("16", "Jaegerhaus, spaeter Kaserne der Jaeger und Scharfschuetzen", "north", [("rect", [76, 79])]),
    ("17", "Torfschuppen", "north", [("rect", [44]), ("rect", [45]), ("rect", [47])]),
    ("18", "Jaegerhof", "north", [("shape", [52, 53])]),
    ("19", "Cavaliershaus", "north", [("rect", [69, 73])]),
    ("20", "Kaserne", "north", [("shape", [54, 56])]),
    ("21", "Lazarett", "north", [("rect", [50, 61])]),
    ("22", "Brauerei und Wirtshaus", "north", [("shape", [46, 51])]),
    ("23", "Kaserne", "north", [("rect", [43])]),
    ("24", "Kaserne", "north", [("rect", [42])]),
    ("25", "Schaeferei", "global", [("rect", [27]), ("rect", [28, 30]), ("rect", [29])]),
    ("26", "Schaeferei", "global", [("rect", [20]), ("rect", [26])]),
    ("27", "Landwirtschaftlich genutztes Gebaeude", "global", [("rect", [33, 37])]),
    ("28", "Wachhaeuser", "core", [("box", [714, 733, 721, 739]), ("box", [729, 731, 736, 737])]),
    ("31", "Pavillon", "global", [("box", [839, 764, 846, 770])]),
    ("33", "Brunnenhaus", "global", [("rect", [97])]),
    ("34", "Gaertnerei", "global", [("rect", [98])]),
    ("35", "Pavillon", "global", [("rect", [99])]),
    ("36", "Baumagazin", "global", [("rect", [107, 109])]),
    ("37", "Wachhaeuser", "global", [("box", [836, 1225, 843, 1231]), ("box", [857, 1226, 863, 1231])]),
    ("38", "Carlsberger Hof", "global", [("shape", [104]), ("shape", [105]), ("shape", [111]), ("shape", [115])]),
    ("39", "Scheune", "global", [("rect", [110, 113])]),
    ("40", "Kelterei", "global", [("rect", [108])]),
    ("41", "Pastorshaeuschen", "global", [("rect", [100])]),
    ("42", "Carlsdorf (Sanddorf)", "global", [("rect", [101]), ("rect", [102]), ("rect", [106]), ("rect", [112]), ("rect", [114])]),
    ("43", "Neue Schaeferei", "global", [("rect", [118]), ("rect", [119]), ("rect", [120])]),
    ("45", "Gaertnerei Reichard, Kegelbahn", "global", [("rect", [36, 39])]),
    ("46", "Hirschwuerzloch", "global", [("shape", [15])]),
    ("47", "Gaertnerei", "global", [("rect", [24, 25])]),
    ("50", "Carlsluster Torhaus", "global", [("rect", [21, 23])]),
    ("51", "Fasanerie", "global", [("rect", [16])]),
    ("52", "Pavillon", "global", [("rect", [10, 11])]),
    ("53", "Amphitheater", "karlslust", [("shape", [8])]),
    ("54", "Menagerie", "karlslust", [("shape", [2, 3, 4, 5, 6, 7])]),
    ("55", "Point de Vue", "karlslust", [("rect", [1])]),
    ("59", "Standort des Hymenaeostempel 1785", "karlslust", [("rect", [13])]),
    ("61", "Tschifflik Pavillon", "karlslust", [("rect", [9, 12])]),
    ("62", "Terrasse (Gebaeude am Label 62)", "karlslust", [("rect", [14, 17])]),
    ("63", "Treillagenpavillon", "karlslust", [("rect", [18, 19])]),
    ("65", "sog. Tschifflik Pavillon", "karlslust", [("rect", [31])]),
    ("67", "(Nr. 67, nicht in der Legende)", "global", [("rect", [32, 34])]),
]


def red_labels():
    from scipy import ndimage as ndi
    a = load_plan()
    red = (a[..., 0] > 180) & (a[..., 1] < 70) & (a[..., 2] < 70)
    lab, _ = ndi.label(red)
    return lab


def part_poly(lab, kind, arg):
    from shapely.geometry import MultiPoint, box, shape
    from shapely.ops import unary_union
    if kind == "box":
        x0, y0, x1, y1 = arg
        return box(x0, y0, x1, y1)
    m = np.isin(lab, arg)
    if kind == "rect":
        ys, xs = np.nonzero(m)
        pts = np.r_[np.c_[xs, ys], np.c_[xs + 1, ys], np.c_[xs, ys + 1], np.c_[xs + 1, ys + 1]]
        return MultiPoint(pts).convex_hull.minimum_rotated_rectangle.buffer(1.0, join_style=2)  # +1 px = outline
    from rasterio.features import shapes
    polys = [shape(g) for g, v in shapes(m.astype(np.uint8), mask=m) if v == 1]
    u = unary_union(polys).buffer(1.0, join_style=2).simplify(0.8)
    return u


def to_en(geom, T):
    import shapely
    return shapely.transform(geom, lambda xy: gc.apply(T, xy))


def rect_stats(g):
    r = g.minimum_rotated_rectangle
    c = np.asarray(r.exterior.coords)[:4]
    e1, e2 = c[1] - c[0], c[2] - c[1]
    L, W = np.hypot(*e1), np.hypot(*e2)
    v = e1 if L >= W else e2
    az = float(np.degrees(np.arctan2(v[0], v[1])) % 180)
    return max(L, W), min(L, W), az


def vectorise():
    from shapely.ops import unary_union
    lab = red_labels()
    T = transforms()
    rms = {k: gc.residuals(T[k], *(north_arrays(k) if k in ("north", "core") else arrays(SETS[k]))[1:3])[1]
           for k in ("global", "core", "north", "karlslust")}
    feats = []
    for no, name, tset, parts in BUILDINGS:
        gpx = unary_union([part_poly(lab, k, a) for k, a in parts])
        g = to_en(gpx, T[tset])
        L, W, az = rect_stats(g)
        feats.append({"no": no, "name": name, "tset": tset, "rms": rms[tset], "geom": g, "L": L, "W": W, "az": az,
                      "c": (g.centroid.x, g.centroid.y), "area": g.area, "nparts": len(parts)})
    return feats


def cmd_vector():
    from shapely.geometry import mapping
    out = Path(sys.argv[2])
    feats = vectorise()
    fc = {"type": "FeatureCollection", "name": "lageplan2006_buildings",
          "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::25832"}},
          "attribution": ATTR, "features": []}
    for f in feats:
        geom = mapping(f["geom"])
        def rnd(o):
            return [rnd(x) for x in o] if isinstance(o, (list, tuple)) and not isinstance(o[0], float) else [round(o[0], 1), round(o[1], 1)]
        geom = {"type": geom["type"], "coordinates": rnd(json.loads(json.dumps(geom["coordinates"])))}
        fc["features"].append({"type": "Feature", "geometry": geom, "properties": {
            "plan_no": f["no"], "name_de": f["name"], "transform": f["tset"], "transform_rms_m": round(f["rms"], 1),
            "centroid_EN": [round(f["c"][0], 1), round(f["c"][1], 1)], "len_m": round(f["L"], 1), "wid_m": round(f["W"], 1),
            "az_grid_deg": round(f["az"], 1), "area_m2": round(f["area"]), "source": "Karlsberg_Lageplan.gif (schloss-carlsberg.de 2006, CC BY-SA 2.0 DE), georeferenced research/07"}})
    out.write_text(json.dumps(fc, indent=None))
    print("->", out)
    for f in feats:
        print(f"| {f['no']} | {f['name']} | {f['c'][0]:.0f} / {f['c'][1]:.0f} | {f['L']:.0f} x {f['W']:.0f} | {f['az']:.0f} | {f['tset']} |")


# catalogue id -> (plan no, which part: None = whole building, or 'N'/'S'/'W'/'E' sub-selection by polygon clipping)
MATCH = [
    ("KB-B01", "1"), ("KB-B02", "3"), ("KB-B03", "2"), ("KB-B04", "4"), ("KB-B05", "5"), ("KB-B06", "6"),
    ("KB-B10", "7"), ("KB-B20", "12"), ("KB-B22", "13"), ("KB-B23", "15"), ("KB-B24", "16"), ("KB-B25", "21"),
    ("KB-B26", "22"), ("KB-B29", "36"), ("KB-B30", "38"), ("KL-B40", "53"), ("KL-B43", "54"), ("KL-B42", "65"),
    ("KL-B44", "55"),
]


def cmd_compare():
    from shapely.geometry import Polygon
    feats = {f["no"]: f for f in vectorise()}
    print("| catalogue id | plan no. | catalogue centroid E/N | plan centroid E/N | dE / dN (plan - cat) | cat L x W, az | plan L x W, az |")
    print("|---|---|---|---|---|---|---|")
    for cid, no in MATCH:
        cg = Polygon(C[cid]["footprint"]); f = feats[no]
        L, W, az = rect_stats(cg)
        d = np.subtract(f["c"], (cg.centroid.x, cg.centroid.y))
        print(f"| {cid} | {no} {f['name'][:28]} | {cg.centroid.x:.0f} / {cg.centroid.y:.0f} | {f['c'][0]:.0f} / {f['c'][1]:.0f} | "
              f"{d[0]:+.0f} / {d[1]:+.0f} | {L:.0f} x {W:.0f}, {az:.0f} | {f['L']:.0f} x {f['W']:.0f}, {f['az']:.0f} |")


def cmd_render_vec():
    """Plan footprints (magenta, numbered) vs catalogue v1 (cyan) over the hillshade."""
    wd, outdir = sys.argv[2], sys.argv[3]
    feats = vectorise()
    T = transforms()
    plan = classify(load_plan())
    plan[..., 3] *= 0.35  # faint plan underlay

    def extra(ax, b):
        for f in feats:
            g = f["geom"]
            for poly in getattr(g, "geoms", [g]):
                x, y = poly.exterior.xy
                ax.plot(x, y, color="#e000c0", lw=1.3)
            cx, cy = f["c"]
            if b[0] < cx < b[2] and b[1] < cy < b[3]:
                ax.text(cx, cy, f["no"], color="#7a0068", fontsize=7, weight="bold", ha="center", va="center",
                        bbox=dict(boxstyle="circle,pad=0.15", fc="white", ec="#e000c0", lw=0.6, alpha=0.85))
    views = [("34_lageplan2006_vectors_core.jpg", 382080, 5466040, 260, 220, "core",
              "Vectorised 2006 Lageplan (magenta, plan numbers) vs catalogue v1 (cyan) — palace core"),
             ("35_lageplan2006_vectors_north.jpg", 382100, 5466330, 330, 560, "north",
              "Vectorised 2006 Lageplan (magenta, plan numbers) vs catalogue v1 (cyan) — Marstall / utility row"),
             ("36_lageplan2006_vectors_south.jpg", 382150, 5465840, 330, 230, "core",
              "Vectorised 2006 Lageplan (magenta) vs catalogue v1 (cyan) — Orangerie and garden buildings")]
    only = sys.argv[4:] or None
    for v in views:
        if only and v[0] not in only:
            continue
        draw_view(wd, outdir, plan, T[v[5]], v, extra)


def cmd_polys():
    """Print compact footprint rings (EPSG:25832, simplified 0.75 m, 0.1 m rounding) as JSON lines for research/07."""
    only = set(sys.argv[2].split(",")) if len(sys.argv) > 2 else None
    for f in vectorise():
        if only and f["no"] not in only:
            continue
        g = f["geom"].simplify(0.75)
        rings = [[[round(x, 1), round(y, 1)] for x, y in poly.exterior.coords] for poly in getattr(g, "geoms", [g])]
        print(json.dumps({"plan_no": f["no"], "name_de": f["name"], "transform": f["tset"], "rings": rings}, separators=(",", ":")))


if __name__ == "__main__":
    {"polys": cmd_polys, "fit": cmd_fit, "render": cmd_render, "vector": cmd_vector, "compare": cmd_compare, "render_vec": cmd_render_vec}[sys.argv[1]]()
