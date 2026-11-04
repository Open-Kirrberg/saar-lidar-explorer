"""Terrain products for the plan sheets (contours, hillshade / SLRM underlays, DTM crop).

Reads plans/terrain-extents.json and the explorer's 1 m DTM products (DGM1 LVGL-SL ALS 2025,
dl-de/by-2-0) read-only from ../../data/work/karlsberg/, and writes into plans/data/ (git-ignored):

  contours-<id>.geojson   LineStrings in EPSG:25832 with properties {h, index}
  <raster>-<id>.jpg       grayscale underlay covering exactly bbox (north up), + <raster>-<id>.json
  dtm-core.f32 / .json    Float32 little-endian DTM crop (row 0 = north edge) for profiles

Pixel convention: the GeoTIFFs are PixelIsArea, so cell (col, row) has its centre at
E = left + col + 0.5, N = top - row - 0.5. Contour vertices are converted with that offset.

Run (explorer pipeline env, isolated mode; nothing from data/ is executed):
  cd ../../pipeline && uv run python -I ../zones/schloss-karlsberg/plans/scripts/terrain.py
"""

import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.windows import from_bounds
from scipy import ndimage
from shapely.geometry import LineString
from skimage import measure

HERE = Path(__file__).resolve().parent
PLANS = HERE.parent
CFG = json.loads((PLANS / "terrain-extents.json").read_text())
SRC = (PLANS.parent / CFG["source_dir"]).resolve()
OUT = PLANS / "data"
OUT.mkdir(exist_ok=True)
ATTR = "DGM1 (c) GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet"


def read_window(name, bbox, pad=0):
    E0, N0, E1, N1 = bbox
    with rasterio.open(SRC / f"{name}.tif") as ds:
        win = from_bounds(E0 - pad, N0 - pad, E1 + pad, N1 + pad, ds.transform).round_offsets().round_lengths()
        a = ds.read(1, window=win, boundless=True, fill_value=np.nan).astype(np.float64)
        tr = ds.window_transform(win)
    return a, tr


def contours(prod):
    c = prod["contours"]
    a, tr = read_window("dtm", prod["bbox"], pad=10)
    valid = np.isfinite(a)
    fill = np.where(valid, a, np.nanmean(a))
    sm = ndimage.gaussian_filter(fill, c["sigma"])
    sm[~valid] = np.nan
    lo = np.ceil(np.nanmin(sm) / c["interval"]) * c["interval"]
    hi = np.floor(np.nanmax(sm) / c["interval"]) * c["interval"]
    left, top = tr.c, tr.f
    E0, N0, E1, N1 = prod["bbox"]
    feats = []
    for h in np.arange(lo, hi + 1e-6, c["interval"]):
        for seg in measure.find_contours(sm, h):
            # seg = (row, col) in pixel index space -> cell centres
            E = left + seg[:, 1] + 0.5
            N = top - seg[:, 0] - 0.5
            line = LineString(np.column_stack([E, N]))
            if line.length < c["min_length"]:
                continue
            line = line.simplify(c["simplify"], preserve_topology=False)
            clipped = line.intersection(
                LineString([(E0, N0), (E1, N0), (E1, N1), (E0, N1), (E0, N0)]).envelope
            )
            parts = [clipped] if clipped.geom_type == "LineString" else list(getattr(clipped, "geoms", []))
            for p in parts:
                if p.geom_type != "LineString" or p.length < 2:
                    continue
                coords = [[round(x, 2), round(y, 2)] for x, y in p.coords]
                hh = round(float(h), 2)
                feats.append(
                    {
                        "type": "Feature",
                        "properties": {"h": hh, "index": bool(abs(hh / c["index"] - round(hh / c["index"])) < 1e-6)},
                        "geometry": {"type": "LineString", "coordinates": coords},
                    }
                )
    fc = {
        "type": "FeatureCollection",
        "name": f"contours-{prod['id']}",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::25832"}},
        "attribution": ATTR,
        "interval": c["interval"],
        "index": c["index"],
        "smoothing_sigma_m": c["sigma"],
        "features": feats,
    }
    p = OUT / f"contours-{prod['id']}.geojson"
    p.write_text(json.dumps(fc, separators=(",", ":")))
    print(f"[terrain] {p.name}: {len(feats)} lines, {lo:.0f}-{hi:.0f} m every {c['interval']} m")


def raster(prod, name, px_per_m):
    E0, N0, E1, N1 = prod["bbox"]
    a, _ = read_window(name, prod["bbox"])
    if name == "hillshade":
        v = np.clip(a, 0, 1)
        v = 0.25 + 0.75 * v  # lift the shadows so linework stays readable
    else:  # slrm: -1.2 .. +1.2 m -> dark .. light
        v = np.clip((a + 1.2) / 2.4, 0, 1)
    v = np.where(np.isfinite(v), v, 1.0)
    img = Image.fromarray((v * 255).astype(np.uint8), "L")
    w, h = int(round((E1 - E0) * px_per_m)), int(round((N1 - N0) * px_per_m))
    if (w, h) != img.size:
        img = img.resize((w, h), Image.BICUBIC)
    p = OUT / f"{name}-{prod['id']}.jpg"
    img.save(p, quality=82, optimize=True)
    (OUT / f"{name}-{prod['id']}.json").write_text(
        json.dumps({"bbox": prod["bbox"], "width": w, "height": h, "source": f"{name}.tif", "attribution": ATTR})
    )
    print(f"[terrain] {p.name}: {w}x{h} px")


def dtm_crop(crop):
    E0, N0, E1, N1 = crop["bbox"]
    a, tr = read_window("dtm", crop["bbox"])
    a = a.astype("<f4")
    (OUT / f"{crop['id']}.f32").write_bytes(a.tobytes())
    (OUT / f"{crop['id']}.json").write_text(
        json.dumps(
            {
                "bbox": crop["bbox"],
                "width": int(a.shape[1]),
                "height": int(a.shape[0]),
                "cell": 1.0,
                "pixel": "PixelIsArea: cell (col,row) centre E = bbox[0] + col + 0.5, N = bbox[3] - row - 0.5; row 0 = north",
                "attribution": ATTR,
            }
        )
    )
    print(f"[terrain] {crop['id']}.f32: {a.shape[1]}x{a.shape[0]}")


def main():
    only = set(sys.argv[1:])
    for prod in CFG["products"]:
        if only and prod["id"] not in only:
            continue
        if prod.get("contours"):
            contours(prod)
        for name, ppm in (prod.get("rasters") or {}).items():
            raster(prod, name, ppm)
    if not only or CFG["dtm_crop"]["id"] in only:
        dtm_crop(CFG["dtm_crop"])


if __name__ == "__main__":
    main()
