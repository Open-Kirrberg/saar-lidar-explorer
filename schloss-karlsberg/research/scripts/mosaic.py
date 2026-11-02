"""Build a 1 m DTM/DSM mosaic (E 380800-384600, N 5463400-5468200) from raw SL 2025 tiles,
filling gaps (outside Saarland) with RLP 2022 DGM1. Also converts research POIs to UTM.
Usage: mosaic.py <outdir>"""
import json, sys
from pathlib import Path
import numpy as np, rasterio
from rasterio.transform import from_origin
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[3]
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
E0, E1, N0, N1 = 380800, 384600, 5463400, 5468200
W, H = E1 - E0, N1 - N0
tf = from_origin(E0, N1, 1, 1)

def paste(arr, src_path, src_mask=None):
    with rasterio.open(src_path) as d:
        a = d.read(1).astype("float32")
        if d.nodata is not None:
            a[a == d.nodata] = np.nan
        a[a < -100] = np.nan
        b = d.bounds
        c0 = int(round(b.left - E0)); r0 = int(round(N1 - b.top))
        h, w = a.shape
        rs, cs = max(r0, 0), max(c0, 0)
        re, ce = min(r0 + h, H), min(c0 + w, W)
        if re <= rs or ce <= cs:
            return 0
        sub = a[rs - r0:re - r0, cs - c0:ce - c0]
        tgt = arr[rs:re, cs:ce]
        m = np.isnan(tgt) & ~np.isnan(sub)
        tgt[m] = sub[m]
        return int(m.sum())

for prod in ("dgm1", "dom1"):
    arr = np.full((H, W), np.nan, "float32")
    src = np.zeros((H, W), "uint8")
    for e in range(E0 // 1000, (E1 - 1) // 1000 + 1):
        for n in range(N0 // 1000, (N1 - 1) // 1000 + 1):
            p = ROOT / f"data/raw/lvgl-sl/{prod}_32_{e}_{n}_1_SL_2025.tif"
            if p.exists():
                paste(arr, p)
    src[~np.isnan(arr)] = 1
    for e in range(E0 // 1000, (E1 - 1) // 1000 + 1):
        for n in range(N0 // 1000, (N1 - 1) // 1000 + 1):
            p = ROOT / f"data/raw/rlp/{prod}_32_{e}_{n}_1_rp_2022.tif"
            if p.exists():
                paste(arr, p)
    src[(src == 0) & ~np.isnan(arr)] = 2
    print(prod, "nan px", int(np.isnan(arr).sum()), "SL px", int((src == 1).sum()), "RLP px", int((src == 2).sum()))
    prof = dict(driver="GTiff", width=W, height=H, count=1, dtype="float32", crs="EPSG:25832", transform=tf, nodata=np.nan, compress="deflate", predictor=3)
    with rasterio.open(out / f"{prod}.tif", "w", **prof) as d:
        d.write(arr, 1)
    prof.update(dtype="uint8", nodata=0, predictor=1)
    with rasterio.open(out / f"{prod}_src.tif", "w", **prof) as d:
        d.write(src, 1)

tr = Transformer.from_crs(4326, 25832, always_xy=True)
pois = json.loads((ROOT / "app/public/data/pois.geojson").read_text())["features"]
res = []
for f in pois:
    lon, lat = f["geometry"]["coordinates"]
    x, y = tr.transform(lon, lat)
    if E0 < x < E1 and N0 < y < N1:
        res.append({"id": f["properties"]["id"], "name": f["properties"]["name"], "E": round(x, 1), "N": round(y, 1)})
        print(res[-1])
(out / "pois_utm.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
