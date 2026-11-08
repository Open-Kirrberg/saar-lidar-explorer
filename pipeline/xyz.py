"""Web-Mercator XYZ PNG overlay tiles for Leaflet (vat: grayscale, slrm: diverging colour), transparent outside data.

Usage:  uv run python xyz.py <aoi> [--layers vat,slrm] [--minzoom 12] [--maxzoom 18]

Reads data/work/<aoi>/<layer>.tif (written by build.py), writes app/public/data/<aoi>/xyz/<layer>/{z}/{x}/{y}.png
and merges `xyz.<layer>` into app/public/data/<aoi>/manifest.json (other `xyz.*` sub-keys such as the
historic maps' `xyz.hist_*` are kept).

`build_rgb_layer` (F14, used by historic.py) tiles an RGB(A) GeoTIFF the same way into palette PNGs.

v3 places (contract "Many places (v3, S2)" rule 7): only `xyz.vat`, z12–16 by default, palette PNGs whose
transparent index (alpha 0) covers everything outside the place's present 1 km tiles. The mask is exact at the tile
edges: a Mercator pixel is opaque only if its centre, transformed to EPSG:25832, lies in a present tile (not just
where the reprojected VAT happens to be NaN). `bounds` = WGS84 bounds of the place rectangle. Stale `slrm` /
`hist_*` minimap tiles and their `xyz.*` keys of the place are removed.
"""
from __future__ import annotations

import argparse
import json
import shutil
import time

import morecantile
import numpy as np
import rasterio
from PIL import Image
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject, transform_bounds

from matplotlib import colormaps

from common import WORK_DIR, load_aoi, update_manifest
from render import CMAPS

TMS = morecantile.tms.get("WebMercatorQuad")
TILE = 256
V3_LAYERS = ("vat",)       # rule 7 / S0 §2.6: vat only, ≤ z16
V3_MAXZOOM = 16


class PresenceMask:
    """Exact 'pixel centre in a present tile' test for EPSG:3857 pixels of a v3 place (pure apart from pyproj)."""

    def __init__(self, e0: int, n1: int, tiles_w: int, tiles_h: int, cells):
        from pyproj import Transformer
        self.e0, self.n1 = e0, n1
        self.grid = np.zeros((tiles_h, tiles_w), bool)
        for c, r in cells:
            self.grid[r, c] = True
        self.tr = Transformer.from_crs("EPSG:3857", "EPSG:25832", always_xy=True)

    @classmethod
    def of(cls, aoi) -> "PresenceMask":
        from grid import tile_cell
        return cls(aoi.e0, aoi.n1, aoi.width // 1000, aoi.height // 1000,
                   [tile_cell(t, aoi.e0, aoi.n1) for t in aoi.owned])

    def utm(self, e: np.ndarray, n: np.ndarray) -> np.ndarray:
        """Bool: EPSG:25832 points inside a present tile (tile = [E, E + 1000) × [N, N + 1000))."""
        col = np.floor((e - self.e0) / 1000.0)
        row = np.ceil((self.n1 - n) / 1000.0) - 1        # half-open like E: a south edge belongs to its tile
        h, w = self.grid.shape
        ok = (col >= 0) & (col < w) & (row >= 0) & (row < h)
        out = np.zeros(e.shape, bool)
        out[ok] = self.grid[row[ok].astype(int), col[ok].astype(int)]
        return out

    def tile_pixels(self, left: float, top: float, px: float, size: int = TILE) -> np.ndarray:
        """size × size bool mask of the Mercator pixels (centres) of the window with NW corner (left, top)."""
        c = (np.arange(size) + 0.5) * px
        x, y = np.meshgrid(left + c, top - c)
        e, n = self.tr.transform(x, y)
        return self.utm(np.asarray(e), np.asarray(n))

    def nan_outside(self, arr: np.ndarray, cell: float = 1.0) -> None:
        """Set the cells of a rectangle raster (row 0 = north, `cell` m) outside the present tiles to NaN."""
        tp = int(round(1000 / cell))
        for r in range(self.grid.shape[0]):
            for c in range(self.grid.shape[1]):
                if not self.grid[r, c]:
                    arr[r * tp:(r + 1) * tp, c * tp:(c + 1) * tp] = np.nan


def stretch(layer: str, manifest: dict) -> tuple[str | None, float, float]:
    if layer == "slrm":
        lo, hi = manifest["build"]["slrmDisplayRange"]
        return CMAPS["slrm"], lo, hi
    if layer == "chm":
        return CMAPS["chm"], 0.0, 35.0
    return None, 0.0, 1.0


def palette(cmap: str | None) -> list[int]:
    """8-bit palette: index 0 = transparent (no data), 1..255 = colour ramp."""
    ramp = np.linspace(0, 1, 255)
    if cmap is None:
        rgb = np.repeat(np.rint(ramp * 255)[:, None], 3, axis=1).astype(np.uint8)
    else:
        rgb = colormaps[cmap](ramp, bytes=True)[:, :3]
    return [0, 0, 0] + rgb.reshape(-1).tolist()


def to_index(arr: np.ndarray, lo: float, hi: float) -> np.ndarray:
    v = np.clip((np.nan_to_num(arr, nan=lo) - lo) / (hi - lo), 0, 1)
    idx = (1 + np.rint(v * 254)).astype(np.uint8)
    idx[~np.isfinite(arr)] = 0
    return idx


def build_layer(aoi, layer: str, zooms: range, manifest: dict, *, src_path=None, out=None,
                mask: PresenceMask | None = None) -> dict:
    """Palette PNG tiles of one scalar work raster. With `mask` (v3 place): cells outside the present tiles are
    NaN before reprojection, every written pixel whose centre is outside them gets index 0 (alpha 0), and `bounds`
    is the WGS84 bbox of the AOI rectangle."""
    src_path = src_path or WORK_DIR / aoi.key / f"{layer}.tif"
    out = out or aoi.data_dir / "xyz" / layer
    shutil.rmtree(out, ignore_errors=True)
    n_tiles, n_bytes = 0, 0
    with rasterio.open(src_path) as src:
        src_arr = src.read(1)
        bounds = src.bounds
        if mask is not None:
            src_arr = src_arr.astype(np.float32, copy=True)
            if (round(src.bounds.left), round(src.bounds.top)) != (aoi.e0, aoi.n1) or src.res != (1.0, 1.0):
                raise ValueError(f"{src_path}: expected a 1 m raster of the rectangle {aoi.e0}/{aoi.n1}")
            mask.nan_outside(src_arr)
            bounds = (aoi.e0, aoi.n0, aoi.e1, aoi.n1)
        west, south, east, north = transform_bounds(src.crs, "EPSG:4326", *bounds, densify_pts=21)
        for z in zooms:
            tiles = list(TMS.tiles(west, south, east, north, zooms=[z]))
            xs, ys = [t.x for t in tiles], [t.y for t in tiles]
            x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
            ul, lr = TMS.xy_bounds(x0, y0, z), TMS.xy_bounds(x1, y1, z)
            w, h = (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE
            dst = np.full((h, w), np.nan, np.float32)
            dst_tr = from_bounds(ul.left, lr.bottom, lr.right, ul.top, w, h)
            px_m = (lr.right - ul.left) / w
            # Mercator pixel ≈ px_m·cos(lat) on the ground; average when downsampling, bilinear when upsampling
            res = Resampling.average if px_m * 0.65 > 1.2 else Resampling.bilinear
            reproject(src_arr, dst, src_transform=src.transform, src_crs=src.crs, src_nodata=np.nan,
                      dst_transform=dst_tr, dst_crs="EPSG:3857", dst_nodata=np.nan, resampling=res)
            cmap, lo, hi = stretch(layer, manifest)
            idx = to_index(dst, lo, hi)
            pal = palette(cmap)
            for ty in range(y1 - y0 + 1):
                for tx in range(x1 - x0 + 1):
                    t = idx[ty * TILE:(ty + 1) * TILE, tx * TILE:(tx + 1) * TILE]
                    if not t.any():
                        continue
                    if mask is not None:
                        t = np.where(mask.tile_pixels(ul.left + tx * TILE * px_m, ul.top - ty * TILE * px_m, px_m),
                                     t, 0).astype(np.uint8)
                        if not t.any():
                            continue
                    p = out / str(z) / str(x0 + tx) / f"{y0 + ty}.png"
                    p.parent.mkdir(parents=True, exist_ok=True)
                    img = Image.fromarray(t, "P")
                    img.putpalette(pal)
                    img.save(p, optimize=True, transparency=0)
                    n_tiles += 1
                    n_bytes += p.stat().st_size
            print(f"  {layer} z{z}: {len(tiles)} tiles ({res.name})", flush=True)
    entry = {"url": f"xyz/{layer}/{{z}}/{{x}}/{{y}}.png", "minZoom": zooms.start, "maxZoom": zooms.stop - 1,
             "bounds": [[round(south, 6), round(west, 6)], [round(north, 6), round(east, 6)]],
             "tileCount": n_tiles, "bytes": n_bytes}
    if layer == "slrm":
        lo, hi = manifest["build"]["slrmDisplayRange"]
        entry.update({"colormap": CMAPS["slrm"], "min": lo, "max": hi, "unit": "m"})
    return entry


# --- F14: RGB(A) image layers (historic maps) ------------------------------------------------------------------
def zoom_window(west: float, south: float, east: float, north: float, z: int):
    """Tile range covering a WGS84 bbox at zoom z: (x0, y0, x1, y1, EPSG:3857 transform, width px, height px)."""
    tiles = list(TMS.tiles(west, south, east, north, zooms=[z]))
    xs, ys = [t.x for t in tiles], [t.y for t in tiles]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    ul, lr = TMS.xy_bounds(x0, y0, z), TMS.xy_bounds(x1, y1, z)
    w, h = (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE
    return x0, y0, x1, y1, from_bounds(ul.left, lr.bottom, lr.right, ul.top, w, h), w, h


def rgba_to_palette(t: np.ndarray, colors: int = 255) -> Image.Image | None:
    """H×W×4 uint8 tile → 8-bit palette image, index 0 transparent (alpha < 128), ≤ `colors` colours for the rest.
    Returns None for a fully transparent tile (not written)."""
    opaque = t[..., 3] >= 128
    if not opaque.any():
        return None
    rgb = Image.fromarray(np.ascontiguousarray(t[..., :3]), "RGB")
    q = rgb.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    idx = np.asarray(q, np.uint8).astype(np.uint16) + 1
    idx[~opaque] = 0
    pal = q.getpalette()[:3 * colors]
    pal += [0] * (3 * colors - len(pal))
    img = Image.fromarray(idx.astype(np.uint8), "P")
    img.putpalette([0, 0, 0] + pal)
    img.info["transparency"] = 0
    return img


def build_rgb_layer(src_path, out, zooms: range, url_rel: str) -> dict:
    """EPSG:3857 XYZ palette-PNG tiles from an RGB(A) uint8 GeoTIFF (alpha band = data mask; without one every
    pixel is data). Average resampling when downsampling, bilinear when upsampling; tiles without data are skipped."""
    shutil.rmtree(out, ignore_errors=True)
    n_tiles, n_bytes = 0, 0
    with rasterio.open(src_path) as src:
        bands = src.read()
        if bands.shape[0] == 3:
            bands = np.concatenate([bands, np.full((1, *bands.shape[1:]), 255, np.uint8)])
        west, south, east, north = transform_bounds(src.crs, "EPSG:4326", *src.bounds, densify_pts=21)
        px_src = src.transform.a
        for z in zooms:
            x0, y0, x1, y1, dst_tr, w, h = zoom_window(west, south, east, north, z)
            px_m = dst_tr.a
            res = Resampling.average if px_m * 0.65 > 1.2 * px_src else Resampling.bilinear
            dst = np.zeros((4, h, w), np.uint8)
            reproject(bands, dst, src_transform=src.transform, src_crs=src.crs, dst_transform=dst_tr,
                      dst_crs="EPSG:3857", resampling=res, src_nodata=None, dst_nodata=0)
            rgba = np.moveaxis(dst, 0, 2)
            for ty in range(y1 - y0 + 1):
                for tx in range(x1 - x0 + 1):
                    img = rgba_to_palette(rgba[ty * TILE:(ty + 1) * TILE, tx * TILE:(tx + 1) * TILE])
                    if img is None:
                        continue
                    p = out / str(z) / str(x0 + tx) / f"{y0 + ty}.png"
                    p.parent.mkdir(parents=True, exist_ok=True)
                    img.save(p, optimize=True, transparency=0)
                    n_tiles += 1
                    n_bytes += p.stat().st_size
            print(f"  {url_rel} z{z}: {(x1 - x0 + 1) * (y1 - y0 + 1)} tiles ({res.name})", flush=True)
    return {"url": f"{url_rel}/{{z}}/{{x}}/{{y}}.png", "minZoom": zooms.start, "maxZoom": zooms.stop - 1,
            "bounds": [[round(south, 6), round(west, 6)], [round(north, 6), round(east, 6)]],
            "tileCount": n_tiles, "bytes": n_bytes}


def stale_xyz(manifest: dict, keep: tuple[str, ...], dirs=()) -> tuple[dict, list[str]]:
    """Pure: v3 place → (the `xyz` entries to keep, stale sub-keys = manifest keys and tile dirs not in `keep`)."""
    xyz = manifest.get("xyz") if isinstance(manifest.get("xyz"), dict) else {}
    stale = sorted({k for k in xyz if k not in keep} | {d for d in dirs if d not in keep})
    return {k: v for k, v in xyz.items() if k in keep}, stale


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("aoi")
    ap.add_argument("--layers", default=None, help="default vat,slrm (v3 place: vat, the only allowed layer)")
    ap.add_argument("--minzoom", type=int, default=12)
    ap.add_argument("--maxzoom", type=int, default=None, help="default 18 (v3 place: 16)")
    args = ap.parse_args()
    aoi = load_aoi(args.aoi)
    v3 = aoi.is_place
    layers = (args.layers or ("vat" if v3 else "vat,slrm")).split(",")
    if v3 and set(layers) - set(V3_LAYERS):
        raise SystemExit(f"v3 place {aoi.key}: minimap tiles only for {', '.join(V3_LAYERS)} (contract rule 7)")
    maxzoom = args.maxzoom if args.maxzoom is not None else (V3_MAXZOOM if v3 else 18)
    out_dir = aoi.data_dir
    manifest = json.loads((out_dir / "manifest.json").read_text())
    mask = PresenceMask.of(aoi) if v3 else None
    t0 = time.time()
    xyz = {}
    for layer in layers:
        xyz[layer] = build_layer(aoi, layer, range(args.minzoom, maxzoom + 1), manifest, mask=mask)
        print(f"{layer}: {xyz[layer]['tileCount']} tiles, {xyz[layer]['bytes'] / 1e6:.1f} MB"
              + (f" ({xyz[layer]['bytes'] / 1e6 / len(aoi.owned):.3f} MB/km²)" if v3 else ""))
    if v3:
        # rule 7: the place's xyz holds only the v3 layers; stale slrm / hist_* tiles and keys go
        cur = json.loads((out_dir / "manifest.json").read_text())
        dirs = [p.name for p in (out_dir / "xyz").iterdir() if p.is_dir()] if (out_dir / "xyz").is_dir() else []
        kept, stale = stale_xyz(cur, V3_LAYERS, dirs)
        for k in stale:
            shutil.rmtree(out_dir / "xyz" / k, ignore_errors=True)
        update_manifest(out_dir, {"xyz": {**kept, **xyz}})
        if stale:
            print(f"removed stale xyz: {', '.join(stale)}")
    else:
        # read–modify–write, other keys untouched; `xyz` merged per sub-key so xyz.hist_* (historic.py) survive
        update_manifest(out_dir, {"xyz": xyz}, merge=["xyz"])
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
