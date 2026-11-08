"""F13: orthophoto image layer `ortho` (contract "Image layers") from the TrueDOP20 WMS, chunk-aligned.

Usage:  uv run python ortho.py <aoi> [--workers 3]

- Saarland: WMS `sl_dop20_rgb` (WMS SL DOP20 2025, https://geoportal.saarland.de/freewms/truedop), GetMap 1.3.0 in
  EPSG:25832 (axis order E,N for this CRS), one request per level-0 chunk with BBOX exactly on the chunk's 500 m
  edges and WIDTH = HEIGHT = 1000 px (0.5 m/px), PNG with TRANSPARENT=TRUE so pixels without imagery are alpha 0.
- Rheinland-Pfalz fill: only for chunks with SL alpha < 255 somewhere, the same bbox from WMS RP DOP20
  (`rp_dop20`, https://geo4.service24.rlp.de/wms/rp_dop20.fcgi, FORMAT `image/png; mode=24bit` — plain
  `image/png` is an 8-bit palette there). Per pixel "SL over RLP over black" (alpha compositing).
- Output: `ortho/{i}_{j}.webp` (1000², quality 85) + coarse levels `ortho/levels/{k}/{i}_{j}.webp` (500², area
  mean of the level-0 imagery via a 1 m mosaic, edge clamp past the AOI like the height levels). The coarse images
  live under `ortho/` and not under `levels/` because build.py wipes `levels/` on every run.
- Manifest: `layers.ortho`, `levels[k].layers.ortho` (k = 0 mirrors the top level), attribution — read–modify–write.
- v3 places (contract "Many places (v3, S2)", rules 2 + 3, "Slim formats"): AVIF q65 (`format: 'avif'`), requests
  and files only for the present level-0 chunks (`ortho/{i}_{j}.avif`, 1000²) and level 1 only, one 500² image per
  present tile (`ortho/levels/1/{i}_{j}.avif`); no levels ≥ 2 (those come from the central overview). The raw
  cache of the covering rectangle AOI (`cache_from`, e.g. homburg-gemeinde) is read and extended in place: cache
  names are bbox-based and every 1 km aligned place chunk is a chunk of that rectangle (`map_chunk_index`).
- v3 work raster `ortho_src.tif` (1 m, u8: 0 none, 1 SL, 2 RLP per cell; S4) lets trees.py calibrate the darker
  RLP DOP20 before its colour thresholds. It is not published.
- Raw responses are cached in data/raw/ortho/<aoi>/{sl,rlp}/ (named by bbox; identical files from another AOI's
  cache are hard-linked instead of downloaded again). Work: data/work/<aoi>/ortho_1m.tif, ortho.json.

The generic pieces (chunk/bbox maths, polite cached WMS client, compositing, coarse levels, manifest merge) are
shared with historic.py and unit-tested in tests/test_ortho.py (no network).
"""
from __future__ import annotations

import argparse
import copy
import http.cookiejar
import io
import json
import math
import os
import shutil
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable

import numpy as np
from PIL import Image

from common import (PREVIEW_DIR, RAW_DIR, SSL_CTX, USER_AGENT, WORK_DIR, fmt_bytes, load_aoi, swap_dir,
                    update_manifest)
from encode import AVIF_RGB_QUALITY, save_avif_rgb
from levels import block_mean, level_grid

SL_DOP_WMS = "https://geoportal.saarland.de/freewms/truedop"
SL_DOP_LAYER = "sl_dop20_rgb"
RLP_DOP_WMS = "https://geo4.service24.rlp.de/wms/rp_dop20.fcgi"
RLP_DOP_LAYER = "rp_dop20"

ATTRIBUTION_DOP_SL = "© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (DOP20)"
ATTRIBUTION_DOP_RLP = "© GeoBasis-DE/LVermGeoRP (2026), dl-de/by-2-0, www.lvermgeo.rlp.de, Daten bearbeitet (DOP20)"

CHUNK_M = 500          # level-0 chunk side in metres (chunkSize 500 × cellSize 1)
ORTHO_PPC = 1000       # px per level-0 chunk (0.5 m/px)
COARSE_PPC = 500       # px per coarse-level chunk (contract: required at k ≥ 1)
WEBP_QUALITY = 85


# ------------------------------------------------------------------------------------------- grid maths (pure)
def chunk_bbox(e0: float, n_top: float, i: int, j: int, chunk_m: float = CHUNK_M) -> tuple[float, float, float, float]:
    """EPSG:25832 bbox (minE, minN, maxE, maxN) of chunk (i, j); i east, j south from the NW corner (n_top = N0 + height)."""
    return (e0 + i * chunk_m, n_top - (j + 1) * chunk_m, e0 + (i + 1) * chunk_m, n_top - j * chunk_m)


def pixel_centre(e0: float, n_top: float, i: int, j: int, px: float, py: float, ppc: int,
                 chunk_m: float = CHUNK_M) -> tuple[float, float]:
    """Contract: centre of pixel (px, py) of chunk (i, j) in an image layer with `ppc` px per chunk side."""
    s = chunk_m / ppc
    return e0 + i * chunk_m + (px + 0.5) * s, n_top - j * chunk_m - (py + 0.5) * s


def wms_getmap_url(base: str, layer: str, bbox: tuple[float, float, float, float], width: int, height: int, *,
                   fmt: str = "image/png", version: str = "1.3.0", transparent: bool = True) -> str:
    """GetMap URL in EPSG:25832. For EPSG:25832 the axis order is E,N in both WMS 1.1.1 (SRS) and 1.3.0 (CRS)
    (unlike EPSG:4326 in 1.3.0), so BBOX is always minE,minN,maxE,maxN."""
    crs_key = "CRS" if version == "1.3.0" else "SRS"
    params = [("SERVICE", "WMS"), ("VERSION", version), ("REQUEST", "GetMap"), ("LAYERS", layer), ("STYLES", ""),
              (crs_key, "EPSG:25832"), ("BBOX", ",".join(_num(v) for v in bbox)),
              ("WIDTH", str(width)), ("HEIGHT", str(height)), ("FORMAT", fmt)]
    if transparent:
        params.append(("TRANSPARENT", "TRUE"))
    sep = "" if base.endswith(("?", "&")) else "?"
    return base + sep + urllib.parse.urlencode(params, quote_via=urllib.parse.quote, safe=",:")


def _num(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else repr(float(v))


def map_chunk_index(i: int, j: int, e0: int, n_top: int, to_e0: int, to_n_top: int,
                    chunk_m: int = CHUNK_M) -> tuple[int, int]:
    """Chunk (i, j) of the rectangle with west edge e0 / north edge n_top → index of the same chunk in another
    rectangle (to_e0, to_n_top), e.g. a v3 place chunk → the covering cache AOI's chunk. Both on the chunk grid."""
    if (e0 - to_e0) % chunk_m or (to_n_top - n_top) % chunk_m:
        raise ValueError("rectangles are not aligned on the same chunk grid")
    return i + (e0 - to_e0) // chunk_m, j + (to_n_top - n_top) // chunk_m


def present_chunk_list(aoi) -> list[tuple[int, int]]:
    """Level-0 chunks (i, j) to build, row-major: every chunk of a rectangle AOI, only the present ones of a v3
    place (presence rule 2: chunk (i, j) exists iff its tile is present)."""
    cs = aoi.chunk_size
    nx, ny = aoi.width // cs, aoi.height // cs
    return [(i, j) for j in range(ny) for i in range(nx) if not aoi.is_place or aoi.chunk_present(i, j)]


def present_tile_cells(aoi) -> list[tuple[int, int]]:
    """Level-1 chunks (= present 1 km tiles) of a v3 place as (i, j) in its rectangle, row-major."""
    from grid import tile_cell
    return sorted((tile_cell(t, aoi.e0, aoi.n1) for t in aoi.owned), key=lambda c: (c[1], c[0]))


def presence_raster(aoi, px_per_m: float = 1.0) -> np.ndarray:
    """Bool H×W raster of the place rectangle (row 0 = north) at `px_per_m`, True inside present tiles."""
    tp = int(round(1000 * px_per_m))
    w, h = aoi.width // 1000, aoi.height // 1000
    grid = np.zeros((h, w), bool)
    for c, r in present_tile_cells(aoi):
        grid[r, c] = True
    return np.repeat(np.repeat(grid, tp, axis=0), tp, axis=1)


def cache_name(layer: str, bbox: tuple[float, float, float, float], px: int, ext: str = "png") -> str:
    """Cache file name: layer, lower-left corner, size in metres and px (AOI-independent, so other AOIs can reuse it)."""
    e, n, e1, n1 = bbox
    return f"{layer}_{_num(e)}_{_num(n)}_{_num(e1 - e)}x{_num(n1 - n)}m_{px}px.{ext}"


# ------------------------------------------------------------------------------------------- pixels (pure)
def to_rgba(img: Image.Image) -> np.ndarray:
    """Any PIL image → H×W×4 uint8 (palette/RGB images become opaque unless they carry transparency)."""
    return np.asarray(img.convert("RGBA"), dtype=np.uint8)


def composite_over(layers: list[np.ndarray], background: tuple[int, int, int] = (0, 0, 0)) -> tuple[np.ndarray, np.ndarray]:
    """Alpha-composite RGBA uint8 layers, first = top ("SL over RLP over background").

    Pixels with alpha 0 in a layer are nodata and let the next layer through; partial alpha (anti-aliased data
    edges) blends. Returns (RGB uint8, coverage float32 in 0…1 = summed data alpha before the background)."""
    h, w = layers[0].shape[:2]
    out = np.zeros((h, w, 3), np.float32)
    cov = np.zeros((h, w), np.float32)
    for lay in layers:
        a = lay[..., 3].astype(np.float32) / 255.0
        wgt = a * (1.0 - cov)
        out += lay[..., :3].astype(np.float32) * wgt[..., None]
        cov += wgt
    out += np.asarray(background, np.float32) * (1.0 - cov)[..., None]
    return np.clip(np.rint(out), 0, 255).astype(np.uint8), cov


SRC_NONE, SRC_SL, SRC_RLP = 0, 1, 2   # `ortho_src.tif` cell codes (v3 work raster, read by trees.py)


def source_cells(layers: list[np.ndarray]) -> np.ndarray:
    """1 m source code per cell of a 0.5 m chunk composited "SL over RLP": SRC_SL where the SL layer covers the
    2 × 2 block (mean alpha ≥ 128), else SRC_RLP where the RLP layer (second layer, if any) does, else SRC_NONE. S4:
    trees.py maps the darker RLP DOP20 onto the SL brightness before its colour thresholds (pure)."""
    def cover(a: np.ndarray) -> np.ndarray:
        h, w = a.shape[:2]
        return a[..., 3].reshape(h // 2, 2, w // 2, 2).astype(np.float32).mean(axis=(1, 3)) >= 128
    sl = cover(layers[0])
    rlp = cover(layers[1]) if len(layers) > 1 else np.zeros_like(sl)
    return np.where(sl, SRC_SL, np.where(rlp, SRC_RLP, SRC_NONE)).astype(np.uint8)


def downsample2(rgb: np.ndarray) -> np.ndarray:
    """2 × 2 area mean of an H×W×C uint8 image (H, W even) → uint8."""
    h, w, c = rgb.shape
    return np.rint(rgb.reshape(h // 2, 2, w // 2, 2, c).astype(np.float32).mean(axis=(1, 3))).astype(np.uint8)


def chunk_clamped(img: np.ndarray, i: int, j: int, cs: int = CHUNK_M) -> np.ndarray:
    """cs × cs window of chunk (i, j) of an H×W(×C) raster; cells beyond the raster are edge-clamped."""
    rows, cols = img.shape[:2]
    r = np.clip(np.arange(j * cs, (j + 1) * cs), 0, rows - 1)
    c = np.clip(np.arange(i * cs, (i + 1) * cs), 0, cols - 1)
    return img[np.ix_(r, c)]


def block_mean_rgb(img: np.ndarray, f: int) -> np.ndarray:
    """f × f block mean per channel (edge-clamp padding at the east/south edge, as levels.block_mean) → uint8."""
    return np.dstack([np.clip(np.rint(block_mean(img[..., c], f)), 0, 255).astype(np.uint8)
                      for c in range(img.shape[2])])


# ------------------------------------------------------------------------------------------- HTTP (polite, cached)
class WmsError(RuntimeError):
    pass


class WmsClient:
    """urllib opener with User-Agent, optional cookie jar (Geoportal owsproxy session), retries with back-off and a
    file cache. Thread-safe enough for a ≤ 3-worker pool (CookieJar locks internally; counters use a lock)."""

    def __init__(self, cache_dir: Path, *, cookies: bool = False, share_glob: str | None = None, retries: int = 5,
                 timeout: int = 180, prime_url: str | None = None):
        self.cache_dir = Path(cache_dir)
        self.prime_url = prime_url     # fetched once (sequentially) before the first real download
        self._primed = prime_url is None
        self._prime_lock = threading.Lock()
        self.share_glob = share_glob   # e.g. "ortho/*/sl": sibling caches searched before downloading
        self.retries, self.timeout = retries, timeout
        handlers: list[Any] = [urllib.request.HTTPSHandler(context=SSL_CTX)]
        self.jar = http.cookiejar.CookieJar() if cookies else None
        if self.jar is not None:
            handlers.append(urllib.request.HTTPCookieProcessor(self.jar))
        self.opener = urllib.request.build_opener(*handlers)
        self.opener.addheaders = [("User-Agent", USER_AGENT)]
        self._lock = threading.Lock()
        self.requests = self.bytes = self.cached = self.linked = 0

    def _shared(self, name: str) -> Path | None:
        if not self.share_glob:
            return None
        for p in sorted(RAW_DIR.glob(f"{self.share_glob}/{name}")):
            if p.parent != self.cache_dir and p.is_file() and p.stat().st_size > 0:
                return p
        return None

    def fetch(self, url: str) -> tuple[bytes, str]:
        """GET with retries on network errors, 5xx/429 and non-image answers (session/cookie hiccups)."""
        if not self._primed:
            with self._prime_lock:
                if not self._primed:
                    self._primed = True
                    self.fetch(self.prime_url)  # e.g. owsproxy 302 → session cookie, before parallel requests
        delay = 2.0
        err: Exception | None = None
        for attempt in range(1, self.retries + 1):
            try:
                with self.opener.open(url, timeout=self.timeout) as r:
                    data, ctype = r.read(), r.headers.get("Content-Type", "")
                with self._lock:
                    self.requests += 1
                    self.bytes += len(data)
                if ctype.startswith("image/"):
                    return data, ctype
                err = WmsError(f"non-image answer ({ctype}): {data[:300]!r}")
                if self.jar is not None:
                    self.jar.clear()  # stale proxy session → start a new one
            except urllib.error.HTTPError as e:
                if e.code < 500 and e.code != 429:
                    raise WmsError(f"HTTP {e.code} for {url}") from e
                err = e
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
                err = e
            if attempt < self.retries:
                print(f"  ! {err} – retry {attempt}/{self.retries - 1} in {delay:.0f}s", file=sys.stderr, flush=True)
                time.sleep(delay)
                delay *= 2
        raise WmsError(f"giving up after {self.retries} attempts: {url}: {err}")

    def image(self, url: str, name: str, size: tuple[int, int]) -> np.ndarray:
        """Cached GetMap → RGBA uint8 (H×W×4). Validates the size; writes the raw response atomically."""
        path = self.cache_dir / name
        linked = False
        if not path.exists():
            shared = self._shared(name)
            if shared is not None:
                path.parent.mkdir(parents=True, exist_ok=True)
                try:
                    os.link(shared, path)
                except OSError:
                    path.write_bytes(shared.read_bytes())
                linked = True
        if path.exists():
            with Image.open(path) as im:
                if im.size == size:
                    with self._lock:
                        if linked:
                            self.linked += 1
                        else:
                            self.cached += 1
                    return to_rgba(im)
            print(f"  ! cached {path.name} has wrong size, re-downloading", file=sys.stderr)
        data, _ = self.fetch(url)
        with Image.open(io.BytesIO(data)) as im:
            im.load()
            if im.size != size:
                raise WmsError(f"{name}: got {im.size}, expected {size}")
            arr = to_rgba(im)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".part")
        tmp.write_bytes(data)
        os.replace(tmp, path)
        return arr


def fetch_meta(raw_dir: Path, info: dict[str, Any]) -> dict[str, Any]:
    """data/raw/<…>/<aoi>/meta.json: keeps the first download date (the `source` text says when it was fetched)."""
    p = raw_dir / "meta.json"
    old = json.loads(p.read_text()) if p.exists() else {}
    meta = {**info, "firstFetched": old.get("firstFetched") or time.strftime("%Y-%m-%d")}
    raw_dir.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n")
    return meta


# ------------------------------------------------------------------------------------------- outputs
def save_image(path: Path, rgb: np.ndarray, fmt: str, quality: int = WEBP_QUALITY) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    if fmt == "avif":
        return save_avif_rgb(path, rgb, quality)
    img = Image.fromarray(rgb, "RGB")
    if fmt == "webp":
        img.save(path, "WEBP", quality=quality, method=4)
    elif fmt == "jpg":
        img.save(path, "JPEG", quality=quality, optimize=True, progressive=True)
    else:
        img.save(path, "PNG", optimize=True)
    return path.stat().st_size


def write_coarse_levels(out_dir: Path, rel_dir: str, mosaic_1m: np.ndarray, manifest: dict[str, Any], key: str,
                        base_entry: dict[str, Any], fmt: str, quality: int, cs: int = CHUNK_M) -> dict[int, dict[str, Any]]:
    """Coarse image levels for every level k ≥ 1 listed in the manifest: area mean of the 1 m mosaic over 2^k blocks
    (edge clamp), one `COARSE_PPC`² image per level chunk, path `<rel_dir>/levels/{k}/{i}_{j}.<fmt>`."""
    rows, cols = mosaic_1m.shape[:2]
    entries: dict[int, dict[str, Any]] = {}
    for lv in manifest.get("levels") or []:
        k = lv.get("level")
        if not isinstance(k, int) or k < 1:
            continue
        g = level_grid(cols, rows, k, cs)
        arr = block_mean_rgb(mosaic_1m, 1 << k)
        nbytes = 0
        for j in range(g["chunks"]["ny"]):
            for i in range(g["chunks"]["nx"]):
                tile = chunk_clamped(arr, i, j, cs)
                nbytes += save_image(out_dir / rel_dir / "levels" / str(k) / f"{i}_{j}.{fmt}", tile, fmt, quality)
        entries[k] = {**base_entry, "path": f"{rel_dir}/levels/{k}/{{i}}_{{j}}.{fmt}", "pixelsPerChunk": COARSE_PPC}
        print(f"  level {k}: {g['chunks']['nx']}×{g['chunks']['ny']} chunks, {fmt_bytes(nbytes)}", flush=True)
    return entries


def write_level1_cells(out_dir: Path, rel_dir: str, mosaic_1m: np.ndarray, cells: list[tuple[int, int]],
                       base_entry: dict[str, Any], fmt: str, quality: int, cs: int = CHUNK_M) -> dict[int, dict[str, Any]]:
    """v3 place: level 1 only (rule 3), one `COARSE_PPC`² image per present tile (= level-1 chunk), 2 × 2 area mean
    of the 1 m mosaic, path `<rel_dir>/levels/1/{i}_{j}.<fmt>`. Returns {1: entry} ({} without cells)."""
    if not cells:
        return {}
    arr = block_mean_rgb(mosaic_1m, 2)
    nbytes = sum(save_image(out_dir / rel_dir / "levels" / "1" / f"{i}_{j}.{fmt}", chunk_clamped(arr, i, j, cs), fmt,
                            quality) for i, j in cells)
    print(f"  level 1: {len(cells)} present chunks, {fmt_bytes(nbytes)}", flush=True)
    return {1: {**base_entry, "path": f"{rel_dir}/levels/1/{{i}}_{{j}}.{fmt}", "pixelsPerChunk": COARSE_PPC}}


def has_level(manifest: dict[str, Any], k: int) -> bool:
    return any(isinstance(lv, dict) and lv.get("level") == k for lv in manifest.get("levels") or [])


def image_layer_patch(manifest: dict[str, Any], key: str, entry0: dict[str, Any],
                      coarse: dict[int, dict[str, Any]]) -> dict[str, Any]:
    """Pure: manifest patch for one image layer. `layers` is returned as a one-key dict (apply with
    merge=["layers"]); `levels` is a full copy with only `levels[k].layers.<key>` set (k = 0 mirrors the top level,
    coarse k from `coarse`, stale entries at other k removed) and every other key untouched."""
    patch: dict[str, Any] = {"layers": {key: entry0}}
    levels = manifest.get("levels")
    if isinstance(levels, list) and levels:
        levels = copy.deepcopy(levels)
        for lv in levels:
            if not isinstance(lv, dict):
                continue
            k = lv.get("level")
            lays = lv.get("layers") if isinstance(lv.get("layers"), dict) else {}
            if k == 0:
                lays[key] = entry0
            elif k in coarse:
                lays[key] = coarse[k]
            else:
                lays.pop(key, None)
            lv["layers"] = lays
        patch["levels"] = levels
    return patch


def write_image_layer_manifest(aoi_dir: Path, key: str, entry0: dict[str, Any], coarse: dict[int, dict[str, Any]], *,
                               attribution: list[str], drop_attribution: list[str] = (),
                               xyz_entry: dict[str, Any] | None = None) -> dict[str, Any]:
    """Read the current manifest right before writing, patch only this step's sub-keys, write atomically."""
    cur = json.loads((aoi_dir / "manifest.json").read_text())
    patch = image_layer_patch(cur, key, entry0, coarse)
    merge = ["layers"]
    if xyz_entry is not None:
        patch["xyz"] = {key: xyz_entry}
        merge.append("xyz")
    return update_manifest(aoi_dir, patch, merge=merge, attribution=attribution, drop_attribution=drop_attribution)


def write_geotiff_rgb(path: Path, img: np.ndarray, e0: float, n_top: float, px: float) -> None:
    """H×W×C uint8 → GeoTIFF (EPSG:25832, deflate), for QGIS checks and the XYZ tiler."""
    import rasterio
    from rasterio.enums import ColorInterp
    from rasterio.transform import from_origin
    path.parent.mkdir(parents=True, exist_ok=True)
    h, w, c = img.shape
    prof = {"driver": "GTiff", "width": w, "height": h, "count": c, "dtype": "uint8", "crs": "EPSG:25832",
            "transform": from_origin(e0, n_top, px, px), "compress": "deflate", "tiled": True,
            "photometric": "RGB"}
    with rasterio.open(path, "w", **prof) as dst:
        dst.write(np.moveaxis(img, 2, 0))
        if c == 4:
            dst.colorinterp = [ColorInterp.red, ColorInterp.green, ColorInterp.blue, ColorInterp.alpha]


def write_geotiff_u8(path: Path, img: np.ndarray, e0: float, n_top: float, px: float) -> None:
    """H×W uint8 → single-band GeoTIFF (EPSG:25832, deflate)."""
    import rasterio
    from rasterio.transform import from_origin
    path.parent.mkdir(parents=True, exist_ok=True)
    h, w = img.shape
    with rasterio.open(path, "w", driver="GTiff", width=w, height=h, count=1, dtype="uint8", crs="EPSG:25832",
                       transform=from_origin(e0, n_top, px, px), compress="deflate", tiled=True) as dst:
        dst.write(img, 1)


def save_preview(path: Path, img: np.ndarray, max_side: int = 2000) -> None:
    f = max(1, math.ceil(max(img.shape[:2]) / max_side))
    small = block_mean_rgb(img[..., :3], f) if f > 1 else img[..., :3]
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(small, "RGB").save(path, "JPEG", quality=85)


def ortho_source(date: str, sl_used: bool, rlp_used: bool) -> tuple[str, list[str]]:
    """(`layers.ortho.source`, attribution) for the services whose pixels are in the image. SL TrueDOP20 is the
    primary source; RLP DOP20 fills its gaps. S4: a v3 place without a single SL pixel (an RLP-only place such as
    Zweibrücken) names and attributes RLP only. Pure."""
    sl = f"WMS SL DOP20 2025 (Layer {SL_DOP_LAYER}, TrueDOP20, Geoportal Saarland), abgerufen {date}"
    rlp = f"WMS RP DOP20 (Layer {RLP_DOP_LAYER}, LVermGeo RLP), abgerufen {date}"
    if not sl_used:
        return rlp, [ATTRIBUTION_DOP_RLP]
    if rlp_used:
        return f"{sl}; Lücken: {rlp}", [ATTRIBUTION_DOP_SL, ATTRIBUTION_DOP_RLP]
    return sl, [ATTRIBUTION_DOP_SL]


def run_pool(fn: Callable, items: list, workers: int) -> list:
    """≤ `workers` concurrent requests (politeness); results in input order; first exception propagates."""
    with ThreadPoolExecutor(max_workers=max(1, min(3, workers))) as ex:
        return list(ex.map(fn, items))


# ------------------------------------------------------------------------------------------- main
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("aoi")
    ap.add_argument("--workers", type=int, default=3, help="parallel requests (max 3)")
    args = ap.parse_args()
    aoi = load_aoi(args.aoi)
    out = aoi.data_dir
    if not (out / "manifest.json").exists():
        sys.exit(f"{out}/manifest.json missing – run build first")
    t0 = time.time()
    cs = aoi.chunk_size
    n_top = aoi.n1
    v3 = aoi.is_place
    fmt, quality = ("avif", AVIF_RGB_QUALITY) if v3 else ("webp", WEBP_QUALITY)
    cache = aoi.cache_aoi() if v3 else None
    raw = RAW_DIR / "ortho" / (cache.key if cache else aoi.key)   # v3: reuse (and extend) the covering cache
    meta = fetch_meta(raw, {"sl": {"url": SL_DOP_WMS, "layer": SL_DOP_LAYER, "format": "image/png"},
                            "rlp": {"url": RLP_DOP_WMS, "layer": RLP_DOP_LAYER, "format": "image/png; mode=24bit"},
                            "pxPerChunk": ORTHO_PPC, "crs": "EPSG:25832"})
    sl = WmsClient(raw / "sl", share_glob="ortho/*/sl")
    rlp = WmsClient(raw / "rlp", share_glob="ortho/*/rlp")
    items = present_chunk_list(aoi)
    if cache is not None:
        hit = sum((raw / "sl" / cache_name(SL_DOP_LAYER, chunk_bbox(aoi.e0, n_top, i, j, cs), ORTHO_PPC)).exists()
                  for i, j in items)
        ci, cj = map_chunk_index(*items[0], aoi.e0, n_top, cache.e0, cache.n1, cs)
        print(f"cache {cache.key}: {hit}/{len(items)} present chunks cached (chunk {items[0]} = {cache.key} "
              f"chunk ({ci}, {cj}))", flush=True)
    rel = "ortho"
    # Write into a staging tree and swap it in only after every fetch + level succeeded: a WMS error
    # mid-run must not leave the manifest pointing at a deleted ortho/ (audit pipeline-2).
    stage_root = out / ".ortho.staging"
    shutil.rmtree(stage_root, ignore_errors=True)
    mosaic = np.zeros((aoi.height, aoi.width, 3), np.uint8)   # 1 m, for coarse levels + preview + work tif
    src_mosaic = np.zeros((aoi.height, aoi.width), np.uint8) if v3 else None   # S4: per-cell DOP source

    def do_chunk(ij: tuple[int, int]) -> dict[str, Any]:
        i, j = ij
        bbox = chunk_bbox(aoi.e0, n_top, i, j, cs)
        a_sl = sl.image(wms_getmap_url(SL_DOP_WMS, SL_DOP_LAYER, bbox, ORTHO_PPC, ORTHO_PPC),
                        cache_name(SL_DOP_LAYER, bbox, ORTHO_PPC), (ORTHO_PPC, ORTHO_PPC))
        layers = [a_sl]
        sl_cov = float((a_sl[..., 3] == 255).mean())
        if sl_cov < 1.0:
            a_rlp = rlp.image(wms_getmap_url(RLP_DOP_WMS, RLP_DOP_LAYER, bbox, ORTHO_PPC, ORTHO_PPC,
                                             fmt="image/png; mode=24bit"),
                              cache_name(RLP_DOP_LAYER, bbox, ORTHO_PPC), (ORTHO_PPC, ORTHO_PPC))
            layers.append(a_rlp)
        rgb, cov = composite_over(layers)
        rlp_px = int(((a_sl[..., 3] < 255) & (layers[-1][..., 3] > 0)).sum()) if len(layers) > 1 else 0
        nbytes = save_image(stage_root / rel / f"{i}_{j}.{fmt}", rgb, fmt, quality)
        mosaic[j * cs:(j + 1) * cs, i * cs:(i + 1) * cs] = downsample2(rgb)
        if src_mosaic is not None:
            src_mosaic[j * cs:(j + 1) * cs, i * cs:(i + 1) * cs] = source_cells(layers)
        return {"i": i, "j": j, "slCoverage": round(sl_cov, 6), "rlpPx": rlp_px, "slPx": int((a_sl[..., 3] > 0).sum()),
                "nodataPx": int((cov < 0.5).sum()), "bytes": nbytes}

    stats = run_pool(do_chunk, items, args.workers)
    t_fetch = time.time() - t0
    n_rlp = sum(s["rlpPx"] for s in stats)
    n_nodata = sum(s["nodataPx"] for s in stats)
    l0_bytes = sum(s["bytes"] for s in stats)
    print(f"level 0: {len(stats)} chunks, {fmt_bytes(l0_bytes)}; SL requests {sl.requests} ({fmt_bytes(sl.bytes)}), "
          f"cached {sl.cached}, linked {sl.linked}; RLP requests {rlp.requests} ({fmt_bytes(rlp.bytes)}), cached "
          f"{rlp.cached}; RLP-filled px {n_rlp}, remaining nodata px {n_nodata} ({t_fetch:.0f}s)", flush=True)

    date = meta["firstFetched"]
    src, attribution = ortho_source(date, any(s["slPx"] for s in stats) or not v3, bool(n_rlp))
    entry0 = {"path": f"{rel}/{{i}}_{{j}}.{fmt}", "encoding": "rgb", "format": fmt, "pixelsPerChunk": ORTHO_PPC,
              "kind": "image", "label_de": "Luftbild (DOP20)", "attribution": "; ".join(attribution), "source": src}
    t = time.time()
    manifest = json.loads((out / "manifest.json").read_text())
    if v3:
        cells = present_tile_cells(aoi) if has_level(manifest, 1) else []
        coarse = write_level1_cells(stage_root, rel, mosaic, cells, entry0, fmt, quality, cs)
    else:
        coarse = write_coarse_levels(stage_root, rel, mosaic, manifest, "ortho", entry0, fmt, quality, cs)
    t_levels = time.time() - t
    swap_dir(stage_root / rel, out / rel)
    shutil.rmtree(stage_root, ignore_errors=True)
    write_image_layer_manifest(out, "ortho", entry0, coarse, attribution=attribution,
                               drop_attribution=[a for a in (ATTRIBUTION_DOP_SL, ATTRIBUTION_DOP_RLP)
                                                 if a not in attribution])
    # v3: alpha band = presence, so a covering-raster reader never takes black absent tiles for imagery
    work = np.dstack([mosaic, presence_raster(aoi).astype(np.uint8) * 255]) if v3 else mosaic
    write_geotiff_rgb(WORK_DIR / aoi.key / "ortho_1m.tif", work, aoi.e0, n_top, 1.0)
    if src_mosaic is not None:
        write_geotiff_u8(WORK_DIR / aoi.key / "ortho_src.tif", src_mosaic, aoi.e0, n_top, 1.0)
    save_preview(PREVIEW_DIR / f"{aoi.key}_ortho.jpg", mosaic)
    total = sum(p.stat().st_size for p in (out / rel).rglob("*") if p.is_file())
    report = {"aoi": aoi.key, "chunks": len(stats), "level0Bytes": l0_bytes, "totalBytes": total,
              "slRequests": sl.requests, "slBytes": sl.bytes, "rlpRequests": rlp.requests, "rlpBytes": rlp.bytes,
              "cached": sl.cached + rlp.cached, "linked": sl.linked + rlp.linked, "rlpFilledPx": n_rlp,
              "nodataPx": n_nodata, "timingsS": {"fetchAndLevel0": round(t_fetch, 1), "levels": round(t_levels, 1),
                                                 "total": round(time.time() - t0, 1)},
              "chunksWithRlp": [[s["i"], s["j"]] for s in stats if s["rlpPx"]],
              "chunksWithNodata": [[s["i"], s["j"], s["nodataPx"]] for s in stats if s["nodataPx"]]}
    if v3:
        report.update({"format": fmt, "presentTiles": len(aoi.owned), "cacheFrom": cache.key if cache else None,
                       "mbPerKm2": round(total / 1e6 / len(aoi.owned), 3)})
    (WORK_DIR / aoi.key).mkdir(parents=True, exist_ok=True)
    (WORK_DIR / aoi.key / "ortho.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"ortho {aoi.key}: {fmt_bytes(total)} total, done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
