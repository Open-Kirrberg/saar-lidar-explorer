"""DTM statistics under every catalogue footprint / terrain polygon (catalogue v2 build, pass 2).

Reads model/catalogue.json, samples the explorer's 1 m DTM (DGM1 LVGL-SL 2025, dl-de/by-2-0;
read-only, ../../data/work/overall/dtm.tif, which also covers the Karlslust) and writes
model/v2/dtm-samples.json: {id: {hash, min, median, max, n_cells}}. `hash` is the sha1 of the
footprint as JSON.stringify writes it, so build.ts only uses samples of the current geometry.

Run (from the explorer's pipeline env, isolated mode):
  cd pipeline && uv run python -I ../zones/schloss-karlsberg/scripts/catalogue-v2/sample_dtm.py
"""

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.windows import from_bounds

HERE = Path(__file__).resolve().parent
SK = HERE.parent.parent
DTM = SK.parents[1] / "data" / "work" / "overall" / "dtm.tif"


def js_num(x):
    """Number formatting identical to JavaScript JSON.stringify for our values."""
    if float(x).is_integer():
        return str(int(x))
    return repr(float(x))


def js_dumps(v):
    if isinstance(v, list):
        return "[" + ",".join(js_dumps(x) for x in v) + "]"
    return js_num(v)


def ring_hash(r):
    return hashlib.sha1(js_dumps(r).encode()).hexdigest()[:12]


def buffer_line(line, half):
    (x0, y0), (x1, y1) = line[0], line[-1]
    L = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5
    nx, ny = -(y1 - y0) / L * half, (x1 - x0) / L * half
    return [[x0 - nx, y0 - ny], [x1 - nx, y1 - ny], [x1 + nx, y1 + ny], [x0 + nx, y0 + ny], [x0 - nx, y0 - ny]]


def stats(ds, ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    win = from_bounds(min(xs) - 2, min(ys) - 2, max(xs) + 2, max(ys) + 2, ds.transform).round_offsets().round_lengths()
    a = ds.read(1, window=win, masked=False)
    tr = ds.window_transform(win)
    inside = geometry_mask([{"type": "Polygon", "coordinates": [ring]}], out_shape=a.shape, transform=tr, invert=True)
    v = a[inside & np.isfinite(a)]
    if v.size == 0:
        return None
    return {"min": round(float(v.min()), 2), "median": round(float(np.median(v)), 2), "max": round(float(v.max()), 2), "n_cells": int(v.size)}


def main():
    cat = json.loads((SK / "model" / "catalogue.json").read_text())
    out = {}
    with rasterio.open(DTM) as ds:
        for b in cat["buildings"]:
            if b.get("footprint"):
                r = b["footprint"]
                h = ring_hash(r)
            elif b.get("line"):
                r = buffer_line(b["line"], 0.5)
                h = ring_hash(b["line"])
            else:
                continue
            s = stats(ds, r)
            if s:
                out[b["id"]] = {"hash": h, **s}
        for t in cat["terrain_features"]:
            g = t["geometry"]
            if g["type"] != "Polygon":
                continue
            s = stats(ds, g["coordinates"][0])
            if s:
                out[t["id"]] = {"hash": ring_hash(g["coordinates"][0]), **s}
    dst = SK / "model" / "v2" / "dtm-samples.json"
    dst.write_text(json.dumps({
        "source": "DGM1 1 m, LVGL-SL 2025 (dl-de/by-2-0), data/work/overall/dtm.tif; cell centres inside the ring",
        "samples": out,
    }, indent=1) + "\n")
    print(f"{len(out)} samples -> {dst}", file=sys.stderr)


if __name__ == "__main__":
    main()
