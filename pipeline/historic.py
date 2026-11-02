"""F14: historic map image layers `hist_*` (contract "Image layers") + Leaflet XYZ tiles `xyz.hist_*`.

Usage:  uv run python historic.py <aoi> [--layers hist_1840,hist_1935] [--workers 3] [--maxzoom 17]

Source: "WMS SL Historische Karten" (Geoportal Saarland WMS id 2597, root layer 41884; LVGL Saarland). GetMap only
works through the Geoportal owsproxy, which answers the `0000…` session URL with a 302 to `/owsproxy/<PHPSESSID>/…`
plus a `PHPSESSID` cookie and serves the image only when the cookie comes back. So all requests go through one
urllib opener with a cookie jar; a small GetMap primes the session before the parallel (≤ 3) requests.

- GetMap WMS 1.1.1, SRS EPSG:25832 (E,N), PNG with TRANSPARENT=TRUE, 1 m/px, blocks of up to 4 × 4 level-0
  chunks (≤ 2000 px, limit 4096) whose BBOX lies exactly on chunk edges → 1 m RGBA mosaic of the AOI.
- Level 0: `hist_<year>/{i}_{j}.jpg` (500², 1 m/px, quality 85); pixels without map (alpha 0) become white paper.
  Coarse levels `hist_<year>/levels/{k}/{i}_{j}.jpg` (area mean, 500²). Not under `levels/` (build.py wipes it).
- Leaflet: data/work/<aoi>/hist_<year>.tif (RGBA) → `xyz/hist_<year>/{z}/{x}/{y}.png` (palette PNG, transparent
  outside the AOI/map) via xyz.build_rgb_layer.
- Manifest: `layers.<key>`, `levels[k].layers.<key>`, `xyz.<key>`, attribution (read–modify–write).
- Raw responses: data/raw/historic/<aoi>/<layer>_<E>_<N>_<w>x<h>m_<px>px.png (+ meta.json).

Licence (re-checked 2026-11-01, mod_showMetadata.php?resource=wms&id=2597 and the capabilities): Fees `none`,
AccessConstraints `noLimitations`, "Lizenz: Datenlizenz Deutschland Namensnennung 2.0, Quellenvermerk:
© GeoBasis DE/LVGL-SL (Jahr)".
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
import time
from typing import Any

import numpy as np

from common import APP_DATA, PREVIEW_DIR, RAW_DIR, WORK_DIR, fmt_bytes, load_aoi
from ortho import (
    WmsClient, cache_name, chunk_bbox, composite_over, fetch_meta, run_pool, save_image, save_preview,
    wms_getmap_url, write_coarse_levels, write_geotiff_rgb, write_image_layer_manifest,
)

HIST_WMS = "https://geoportal.saarland.de/owsproxy/00000000000000000000000000000000/ab93f249fdcf35edf2b1d581f136b9d2?"
HIST_CAPS = ("https://geoportal.saarland.de/mapbender/php/wms.php?layer_id=41884&VERSION=1.1.1&SERVICE=WMS"
             "&REQUEST=GetCapabilities&withChilds=1")
HIST_METADATA = "https://geoportal.saarland.de/mapbender/php/mod_showMetadata.php?languageCode=de&resource=wms&id=2597"
ATTRIBUTION_HIST = "© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet (Historische Karten)"

# key → WMS layer name + labels (contract table "Keys and labels")
HIST_LAYERS: dict[str, dict[str, str]] = {
    "hist_1840": {"layer": "1", "label_de": "Karte 1836–41 (Bayer. Positionsblätter)",
                  "title": "Bayrische Originalpositionsblätter 1:25 000, Ausgabe 1836–1841"},
    "hist_1935": {"layer": "5", "label_de": "TK25 1935–40",
                  "title": "TK25 Ausgaben 1935–1940"},
    "hist_1960": {"layer": "6", "label_de": "TK25 1957–65",
                  "title": "TK25 Ausgaben 1957–1965"},
}
DEFAULT_LAYERS = "hist_1840,hist_1935"
PX_PER_M = 1            # 1 m/px → 500 px per level-0 chunk
HIST_PPC = 500
BLOCK_CHUNKS = 4        # 4 × 4 chunks = 2000 m = 2000 px per GetMap (service limit 4096 px)
JPEG_QUALITY = 85
PAPER = (255, 255, 255)  # background where the WMS has no map (alpha 0)


def request_blocks(e0: float, n_top: float, nx: int, ny: int, block: int = BLOCK_CHUNKS,
                   chunk_m: int = 500, px_per_m: int = PX_PER_M, max_px: int = 4096) -> list[dict[str, Any]]:
    """Pure: GetMap blocks of ≤ block × block chunks covering the nx × ny chunk grid exactly.
    Each: chunk offset (i0, j0), size in chunks (ni, nj), bbox on chunk edges, pixel size, mosaic offset (row, col)."""
    out = []
    for bj in range(math.ceil(ny / block)):
        for bi in range(math.ceil(nx / block)):
            i0, j0 = bi * block, bj * block
            ni, nj = min(block, nx - i0), min(block, ny - j0)
            minx, _, _, maxy = chunk_bbox(e0, n_top, i0, j0, chunk_m)
            bbox = (minx, maxy - nj * chunk_m, minx + ni * chunk_m, maxy)
            w, h = ni * chunk_m * px_per_m, nj * chunk_m * px_per_m
            if max(w, h) > max_px:
                raise ValueError(f"block {w}×{h} px exceeds {max_px}")
            out.append({"i0": i0, "j0": j0, "ni": ni, "nj": nj, "bbox": bbox, "width": w, "height": h,
                        "row": j0 * chunk_m * px_per_m, "col": i0 * chunk_m * px_per_m})
    return out


def fill_paper(rgba: np.ndarray, paper: tuple[int, int, int] = PAPER) -> np.ndarray:
    """RGBA → RGB with transparent (no-map) pixels composited onto paper colour."""
    rgb, _ = composite_over([rgba], background=paper)
    return rgb


def build_key(aoi, key: str, client: WmsClient, workers: int, zooms: range, date: str) -> dict[str, Any]:
    spec = HIST_LAYERS[key]
    out = APP_DATA / aoi.key
    cs = aoi.chunk_size
    nx, ny = aoi.width // cs, aoi.height // cs
    n_top = aoi.n1
    t0 = time.time()
    mosaic = np.zeros((aoi.height * PX_PER_M, aoi.width * PX_PER_M, 4), np.uint8)
    blocks = request_blocks(aoi.e0, n_top, nx, ny)

    def do_block(b: dict[str, Any]) -> None:
        url = wms_getmap_url(HIST_WMS, spec["layer"], b["bbox"], b["width"], b["height"], version="1.1.1")
        arr = client.image(url, cache_name(f"L{spec['layer']}", b["bbox"], b["width"]), (b["width"], b["height"]))
        mosaic[b["row"]:b["row"] + b["height"], b["col"]:b["col"] + b["width"]] = arr

    run_pool(do_block, blocks, workers)
    t_fetch = time.time() - t0
    nodata = int((mosaic[..., 3] == 0).sum())
    print(f"{key} (layer {spec['layer']}): {len(blocks)} blocks, no-map px {nodata} "
          f"({100 * nodata / mosaic[..., 3].size:.2f} %), {t_fetch:.0f}s", flush=True)
    rgb = fill_paper(mosaic)
    shutil.rmtree(out / key, ignore_errors=True)
    l0 = 0
    for j in range(ny):
        for i in range(nx):
            tile = rgb[j * HIST_PPC:(j + 1) * HIST_PPC, i * HIST_PPC:(i + 1) * HIST_PPC]
            l0 += save_image(out / key / f"{i}_{j}.jpg", tile, "jpg", JPEG_QUALITY)
    print(f"  level 0: {nx * ny} chunks, {fmt_bytes(l0)}", flush=True)
    src = (f"WMS SL Historische Karten (Geoportal Saarland, WMS-ID 2597), Layer {spec['layer']}: {spec['title']}; "
           f"abgerufen {date}")
    entry0 = {"path": f"{key}/{{i}}_{{j}}.jpg", "encoding": "rgb", "format": "jpg", "pixelsPerChunk": HIST_PPC,
              "kind": "image", "label_de": spec["label_de"], "attribution": ATTRIBUTION_HIST, "source": src}
    manifest = json.loads((out / "manifest.json").read_text())
    coarse = write_coarse_levels(out, key, rgb, manifest, key, entry0, "jpg", JPEG_QUALITY, cs)
    tif = WORK_DIR / aoi.key / f"{key}.tif"
    # XYZ source keeps the alpha (transparent outside the map) but paper RGB under it (no dark resampling fringe)
    write_geotiff_rgb(tif, np.dstack([rgb, mosaic[..., 3]]), aoi.e0, n_top, 1.0 / PX_PER_M)
    from xyz import build_rgb_layer  # heavy imports (matplotlib/morecantile) only when tiling
    t = time.time()
    xyz_entry = build_rgb_layer(tif, out / "xyz" / key, zooms, f"xyz/{key}")
    xyz_entry.update({"kind": "image", "label_de": spec["label_de"], "attribution": ATTRIBUTION_HIST})
    t_xyz = time.time() - t
    write_image_layer_manifest(out, key, entry0, coarse, attribution=[ATTRIBUTION_HIST], xyz_entry=xyz_entry)
    save_preview(PREVIEW_DIR / f"{aoi.key}_{key}.jpg", rgb)
    total = sum(p.stat().st_size for p in (out / key).rglob("*") if p.is_file())
    print(f"  {key}: chunks {fmt_bytes(total)}, xyz {xyz_entry['tileCount']} tiles {fmt_bytes(xyz_entry['bytes'])}",
          flush=True)
    return {"layer": spec["layer"], "blocks": len(blocks), "noMapPx": nodata, "chunkBytes": total,
            "xyzTiles": xyz_entry["tileCount"], "xyzBytes": xyz_entry["bytes"],
            "timingsS": {"fetch": round(t_fetch, 1), "xyz": round(t_xyz, 1), "total": round(time.time() - t0, 1)}}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("aoi")
    ap.add_argument("--layers", default=DEFAULT_LAYERS, help=f"keys from {', '.join(HIST_LAYERS)}")
    ap.add_argument("--workers", type=int, default=3, help="parallel requests (max 3)")
    ap.add_argument("--minzoom", type=int, default=12)
    ap.add_argument("--maxzoom", type=int, default=17)
    args = ap.parse_args()
    aoi = load_aoi(args.aoi)
    keys = [k.strip() for k in args.layers.split(",") if k.strip()]
    unknown = [k for k in keys if k not in HIST_LAYERS]
    if unknown:
        sys.exit(f"unknown layer key(s) {unknown}; known: {', '.join(HIST_LAYERS)}")
    out = APP_DATA / aoi.key
    if not (out / "manifest.json").exists():
        sys.exit(f"{out}/manifest.json missing – run build first")
    t0 = time.time()
    raw = RAW_DIR / "historic" / aoi.key
    meta = fetch_meta(raw, {"getmap": HIST_WMS, "capabilities": HIST_CAPS, "metadata": HIST_METADATA,
                            "license": "Datenlizenz Deutschland Namensnennung 2.0; Quellenvermerk: "
                                       "© GeoBasis DE/LVGL-SL (Jahr); Fees none; AccessConstraints noLimitations",
                            "srs": "EPSG:25832", "pxPerM": PX_PER_M})
    # the owsproxy session (302 → PHPSESSID cookie) is primed by one small GetMap before the first real download
    prime = wms_getmap_url(HIST_WMS, HIST_LAYERS[keys[0]]["layer"], chunk_bbox(aoi.e0, aoi.n1, 0, 0), 16, 16,
                           version="1.1.1")
    client = WmsClient(raw, cookies=True, share_glob="historic/*", prime_url=prime)
    report = {"aoi": aoi.key, "layers": {}}
    for key in keys:
        report["layers"][key] = build_key(aoi, key, client, args.workers, range(args.minzoom, args.maxzoom + 1),
                                          meta["firstFetched"])
    report.update({"requests": client.requests, "bytes": client.bytes, "cached": client.cached,
                   "linked": client.linked, "totalS": round(time.time() - t0, 1)})
    (WORK_DIR / aoi.key).mkdir(parents=True, exist_ok=True)
    (WORK_DIR / aoi.key / "historic.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"historic {aoi.key}: {client.requests} requests ({fmt_bytes(client.bytes)}), cached {client.cached}, "
          f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
