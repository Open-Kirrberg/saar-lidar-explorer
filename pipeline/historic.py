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
- v3 places (contract "Many places (v3, S2)" rules 2, 3, 7, "Slim formats"): `hist_<year>/{i}_{j}.avif` (AVIF q65,
  `format: 'avif'`) only for the present level-0 chunks, level 1 only (`hist_<year>/levels/1/{i}_{j}.avif`, one
  per present tile), no Leaflet tiles (stale `xyz/hist_*` and `xyz.hist_*` of the place are removed). GetMap blocks
  lie on the block grid of the covering rectangle AOI (`cache_from`, else the place's own rectangle) so its raw
  cache is reused; only blocks touching a present chunk are requested (`place_blocks`).

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

from common import PREVIEW_DIR, RAW_DIR, WORK_DIR, fmt_bytes, load_aoi, update_manifest
from encode import AVIF_RGB_QUALITY
from ortho import (
    WmsClient, WmsError, cache_name, chunk_bbox, composite_over, fetch_meta, has_level, image_layer_patch,
    present_chunk_list, present_tile_cells, presence_raster, run_pool, save_image, save_preview, wms_getmap_url,
    write_coarse_levels, write_geotiff_rgb, write_image_layer_manifest, write_level1_cells,
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


def place_blocks(blocks: list[dict[str, Any]], di: int, dj: int, present: set[tuple[int, int]],
                 nx: int, ny: int, chunk_px: int = HIST_PPC) -> list[dict[str, Any]]:
    """Pure: blocks of a covering grid (from `request_blocks` on the cache AOI, whose chunk (i, j) is place chunk
    (i − di, j − dj)) that touch ≥ 1 present place chunk, each with the paste window into the place mosaic:
    `src` = (row0, row1, col0, col1) in the block image, `dst` = the same window in the place mosaic (nx × ny chunks)."""
    out = []
    for b in blocks:
        ci0, cj0 = b["i0"] - di, b["j0"] - dj          # block's first chunk in place indices
        chunks = {(ci0 + a, cj0 + c) for a in range(b["ni"]) for c in range(b["nj"])}
        if not chunks & present:
            continue
        i_lo, i_hi = max(ci0, 0), min(ci0 + b["ni"], nx)
        j_lo, j_hi = max(cj0, 0), min(cj0 + b["nj"], ny)
        src = ((j_lo - cj0) * chunk_px, (j_hi - cj0) * chunk_px, (i_lo - ci0) * chunk_px, (i_hi - ci0) * chunk_px)
        dst = (j_lo * chunk_px, j_hi * chunk_px, i_lo * chunk_px, i_hi * chunk_px)
        out.append({**b, "src": src, "dst": dst})
    return out


def drop_xyz_keys(manifest: dict[str, Any], keys: list[str]) -> tuple[dict[str, Any], list[str]]:
    """Pure: (patch, remove) that retracts `xyz.<key>` for `keys` (v3 places publish no historic minimap tiles).
    `xyz` is replaced, not merged, so the sub-keys really go; an emptied `xyz` is removed."""
    xyz = manifest.get("xyz")
    if not isinstance(xyz, dict) or not any(k in xyz for k in keys):
        return {}, []
    rest = {k: v for k, v in xyz.items() if k not in keys}
    return ({"xyz": rest}, []) if rest else ({}, ["xyz"])


def write_place_chunks(out_dir, key: str, rgb: np.ndarray, chunks: list[tuple[int, int]],
                       cells: list[tuple[int, int]], entry_base: dict[str, Any],
                       quality: int = AVIF_RGB_QUALITY) -> tuple[dict[str, Any], dict[int, dict[str, Any]], int]:
    """v3 writer: `<key>/{i}_{j}.avif` (HIST_PPC², 1 m/px) for the present chunks of the 1 m RGB place mosaic and
    level 1 for the present tiles. Returns (entry0, {1: entry1} or {}, level-0 bytes)."""
    l0 = 0
    for i, j in chunks:
        tile = rgb[j * HIST_PPC:(j + 1) * HIST_PPC, i * HIST_PPC:(i + 1) * HIST_PPC]
        l0 += save_image(out_dir / key / f"{i}_{j}.avif", tile, "avif", quality)
    entry0 = {"path": f"{key}/{{i}}_{{j}}.avif", "encoding": "rgb", "format": "avif", "pixelsPerChunk": HIST_PPC,
              "kind": "image", **entry_base}
    coarse = write_level1_cells(out_dir, key, rgb, cells, entry0, "avif", quality)
    return entry0, coarse, l0


def fill_paper(rgba: np.ndarray, paper: tuple[int, int, int] = PAPER) -> np.ndarray:
    """RGBA → RGB with transparent (no-map) pixels composited onto paper colour."""
    rgb, _ = composite_over([rgba], background=paper)
    return rgb


def build_key(aoi, key: str, client: WmsClient, workers: int, zooms: range, date: str) -> dict[str, Any]:
    if aoi.is_place:
        return build_key_v3(aoi, key, client, workers, date)
    spec = HIST_LAYERS[key]
    out = aoi.data_dir
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


def source_text(spec: dict[str, str], date: str) -> str:
    return (f"WMS SL Historische Karten (Geoportal Saarland, WMS-ID 2597), Layer {spec['layer']}: {spec['title']}; "
            f"abgerufen {date}")


def block_grid(aoi) -> tuple[Any, int, int]:
    """(grid AOI, di, dj): the rectangle whose block grid the requests use (the `cache_from` AOI, else the place)
    and the place's chunk offset in it."""
    g = aoi.cache_aoi() or aoi
    return g, (aoi.e0 - g.e0) // HIST_PPC, (g.n1 - aoi.n1) // HIST_PPC


def build_key_v3(aoi, key: str, client: WmsClient, workers: int, date: str) -> dict[str, Any]:
    spec = HIST_LAYERS[key]
    out = aoi.data_dir
    cs = aoi.chunk_size
    nx, ny = aoi.width // cs, aoi.height // cs
    t0 = time.time()
    chunks = present_chunk_list(aoi)
    g, di, dj = block_grid(aoi)
    blocks = place_blocks(request_blocks(g.e0, g.n1, g.width // cs, g.height // cs), di, dj, set(chunks), nx, ny)
    mosaic = np.zeros((aoi.height * PX_PER_M, aoi.width * PX_PER_M, 4), np.uint8)

    def do_block(b: dict[str, Any]) -> None:
        url = wms_getmap_url(HIST_WMS, spec["layer"], b["bbox"], b["width"], b["height"], version="1.1.1")
        arr = client.image(url, cache_name(f"L{spec['layer']}", b["bbox"], b["width"]), (b["width"], b["height"]))
        r0, r1, c0, c1 = b["src"]
        R0, R1, C0, C1 = b["dst"]
        mosaic[R0:R1, C0:C1] = arr[r0:r1, c0:c1]

    # one polite try: the first block alone (its retry burst is the only one if the service is down), then ≤ 3
    do_block(blocks[0])
    run_pool(do_block, blocks[1:], workers)
    t_fetch = time.time() - t0
    present = presence_raster(aoi, PX_PER_M)
    mosaic[~present] = 0                       # outside present tiles: not this place's data
    nodata = int((mosaic[..., 3][present] == 0).sum())
    print(f"{key} (layer {spec['layer']}): {len(blocks)} blocks on the {g.key} grid, no-map px {nodata} "
          f"({100 * nodata / max(1, int(present.sum())):.2f} % of present), {t_fetch:.0f}s", flush=True)
    rgb = fill_paper(mosaic)
    shutil.rmtree(out / key, ignore_errors=True)
    manifest = json.loads((out / "manifest.json").read_text())
    cells = present_tile_cells(aoi) if has_level(manifest, 1) else []
    entry0, coarse, l0 = write_place_chunks(out, key, rgb, chunks, cells,
                                            {"label_de": spec["label_de"], "attribution": ATTRIBUTION_HIST,
                                             "source": source_text(spec, date)})
    print(f"  level 0: {len(chunks)} present chunks, {fmt_bytes(l0)}", flush=True)
    write_geotiff_rgb(WORK_DIR / aoi.key / f"{key}.tif", np.dstack([rgb, mosaic[..., 3]]), aoi.e0, aoi.n1,
                      1.0 / PX_PER_M)
    # manifest: layers/levels like the rectangle AOIs, minus the place's stale xyz.<key> (rule 7: vat only)
    cur = json.loads((out / "manifest.json").read_text())
    patch = image_layer_patch(cur, key, entry0, coarse)
    xyz_patch, remove = drop_xyz_keys(cur, [key])
    update_manifest(out, {**patch, **xyz_patch}, merge=["layers"], remove=remove, attribution=[ATTRIBUTION_HIST])
    shutil.rmtree(out / "xyz" / key, ignore_errors=True)
    save_preview(PREVIEW_DIR / f"{aoi.key}_{key}.jpg", rgb)
    total = sum(p.stat().st_size for p in (out / key).rglob("*") if p.is_file())
    print(f"  {key}: chunks {fmt_bytes(total)} ({total / 1e6 / len(aoi.owned):.3f} MB/km²)", flush=True)
    return {"layer": spec["layer"], "blocks": len(blocks), "noMapPx": nodata, "chunkBytes": total,
            "presentChunks": len(chunks), "mbPerKm2": round(total / 1e6 / len(aoi.owned), 3), "gridAoi": g.key,
            "timingsS": {"fetch": round(t_fetch, 1), "total": round(time.time() - t0, 1)}}


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
    out = aoi.data_dir
    if not (out / "manifest.json").exists():
        sys.exit(f"{out}/manifest.json missing – run build first")
    t0 = time.time()
    g = block_grid(aoi)[0] if aoi.is_place else aoi
    raw = RAW_DIR / "historic" / g.key           # v3 place: the covering AOI's cache (same block grid)
    meta = fetch_meta(raw, {"getmap": HIST_WMS, "capabilities": HIST_CAPS, "metadata": HIST_METADATA,
                            "license": "Datenlizenz Deutschland Namensnennung 2.0; Quellenvermerk: "
                                       "© GeoBasis DE/LVGL-SL (Jahr); Fees none; AccessConstraints noLimitations",
                            "srs": "EPSG:25832", "pxPerM": PX_PER_M})
    # the owsproxy session (302 → PHPSESSID cookie) is primed by one small GetMap before the first real download
    prime = wms_getmap_url(HIST_WMS, HIST_LAYERS[keys[0]]["layer"], chunk_bbox(g.e0, g.n1, 0, 0), 16, 16,
                           version="1.1.1")
    client = WmsClient(raw, cookies=True, share_glob="historic/*", prime_url=prime)
    report = {"aoi": aoi.key, "layers": {}}
    for key in keys:
        try:
            report["layers"][key] = build_key(aoi, key, client, args.workers,
                                              range(args.minzoom, args.maxzoom + 1), meta["firstFetched"])
        except WmsError as e:
            if not aoi.is_place:
                raise
            # v3: nothing of this key was written (files and manifest change only after a complete fetch)
            sys.exit(f"historic {aoi.key}: {key} not built, service unavailable: {e}")
    report.update({"requests": client.requests, "bytes": client.bytes, "cached": client.cached,
                   "linked": client.linked, "totalS": round(time.time() - t0, 1)})
    (WORK_DIR / aoi.key).mkdir(parents=True, exist_ok=True)
    (WORK_DIR / aoi.key / "historic.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"historic {aoi.key}: {client.requests} requests ({fmt_bytes(client.bytes)}), cached {client.cached}, "
          f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
