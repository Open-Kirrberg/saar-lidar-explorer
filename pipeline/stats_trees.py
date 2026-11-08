"""Orte im Vergleich: trees for the stats area `[orte]` (statistics only; nothing is written under app/public/data).

    uv run python stats_trees.py fetch            # DGM1/DOM1 (SL county ZIP + RLP), LoD2, DOP20 at 1 m (cached)
    uv run python stats_trees.py prepare          # RLP height offset + building mask raster
    uv run python stats_trees.py calibrate        # RLP DOP brightness → SL DOP brightness (crown colour type)
    uv run python stats_trees.py detect [--workers 4]
    uv run python stats_trees.py compare          # consistency with the app's sle-trees-v1 trees of `overall`
    uv run python stats_trees.py border           # SL 2025 vs RLP 2022 border effect (plan Q5)
    uv run python stats_trees.py all

Tiles: the 1 km tiles of the stats bbox that touch a place outline + 200 m (`tiles_needed_list` of
data/work/orte/gemarkungen.geojson, written by places.py). Bbox corners that touch no place are not fetched.

Method = trees.py (sle-trees-v1, same `Params`). The inputs are built like the AOI pipeline builds them:
- CHM: build.py rules (SL 2025 first, RLP 2022 fill + the constant RLP height offset, DTM gaps nearest-filled,
  DSM gaps = DTM, DSM ≥ DTM − 0.5 m).
- Building mask: buildings.py rules (LoD2 footprints SL + RLP, cell centre inside, 3 × 3 dilation).
- Colour: inside `overall` its `ortho_1m.tif` (exactly what the app trees used); elsewhere DOP20 WMS GetMap at
  1 m/px per 1 km tile (SL TrueDOP over RLP DOP20, as ortho.py composites), JPEG where one state covers the tile.
  Cells without imagery are NaN → crown brightness NaN → type unknown (and no conifer fill). The RLP DOP20 is
  much darker than the SL TrueDOP (other date/radiometry), so its brightness is mapped linearly onto the SL one
  (`calibrate`, fitted on crowns seen in both) before trees.classify's thresholds apply.
Detection runs per `BLOCK` (a whole number of 500 m chunks on the global 500 m grid, on which overall's E0/N0 lie)
on a window with a `MARGIN` apron. Tops and crowns come from trees.find_tops / trees.chunk_trees unchanged, then a
global merge applies trees.detect's one-tree-per-cell rule (a measured top beats a fill tree) and a height filter of
min_height … STATS_MAX_HEIGHT (60 m, the CHM clip) instead of the app cap (45 m): stats.py checks the taller tops.
Inside the margin this equals one run over the whole area (tests/test_stats_trees.py checks it on synthetic CHMs).

Outputs (data/work/orte/, never published per tree or per parcel: plan guardrails G1–G3):
- `trees.npz`: E, N (cell centre, EPSG:25832), h, r (m), type (0 unknown, 1 conifer, 2 broadleaf), fill (bool),
  state (LiDAR source of the DSM at the top: 0 SL 2025, 1 RLP 2022), tile (E_km·100000 + N_km), g (ground, m),
  id (trees.tree_ids), meta (JSON: params, inputs, attribution).
- `rasters/{chm,dtm,src,bldg}.tif`: stats-area CHM (buildings 0, NaN outside the fetched tiles), DTM (build.py
  mosaic rules, NaN outside), LiDAR source per cell
  (0 SL, 1 RLP, 2 none, 255 not fetched), building mask.
- `stats_trees.json`, `trees_vs_overall.json`, `border_effect.json`.
"""
from __future__ import annotations

import argparse
import ast
import io
import json
import math
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from common import (APP_DATA, ATTRIBUTION_RLP, ATTRIBUTION_SL, RAW_DIR, RLP_RAW, SL_RAW, WORK_DIR, fmt_bytes,
                    http_open, load_aoi, sl_name)

ORTE_DIR = WORK_DIR / "orte"
RASTER_DIR = ORTE_DIR / "rasters"   # sub-dir on purpose: trees.read_covering globs WORK_DIR/*/{bldg,ortho_1m}.tif
PLACES = ORTE_DIR / "gemarkungen.geojson"
DOP_RAW = RAW_DIR / "dop-orte"      # own cache (1 m/px per 1 km tile), separate from ortho.py's 0.5 m chunk cache
TILE = 1000                         # m, source tile side
CHUNK = 500                         # m, trees.py chunk (global 500 m grid)
BLOCK = 2000                        # m, detection block (multiple of CHUNK)
MARGIN = 64                         # m, window apron ≥ trees.APRON (24) + top window (2.5) + 3 × 3 + Gaussian (3)
DOP_PX = 1000                       # px per 1 km tile (1 m/px)
DOP_PROBE_PX = 250                  # SL coverage probe (transparent PNG, a few hundred bytes when empty)
STATE_SL, STATE_RLP, STATE_NONE, STATE_UNFETCHED = 0, 1, 2, 255
STATE_LABELS = {STATE_SL: "LVGL-SL ALS 2025 (DOM1/DGM1)", STATE_RLP: "LVermGeoRP DOM1/DGM1 2022",
                STATE_NONE: "keine Daten", STATE_UNFETCHED: "nicht geladen"}
OVERALL = "overall"
FORMAT = "sle-orte-trees-v1"
# Height filter of the stats trees. trees.Params.max_height (45 m) drops every taller top in the app, but the stats
# area has real stands of 50–55 m (Douglas fir / spruce, checked in DOP + DTM/DSM, review 2026-11-07). So the stats
# detection keeps tops up to the CHM clip (trees.smooth_chm clips at 60 m, so h ≤ 60 here); stats.py counts a top
# above the app cap only when it passes its tall-tree checks (pylon/mast/wind turbine, building, spike/narrow support,
# line shape) and re-measures a top at the clip on the unclipped CHM (DSM − DTM via `lidar_window`, kept ≤ 75 m;
# tallest-checked-v4: the 60.9 m Bruchhof-Sanddorf conifer read as 60.0 here).
STATS_MAX_HEIGHT = 60.0


# --------------------------------------------------------------------------------------------- tile set (pure)
@dataclass(frozen=True)
class TileSet:
    """Duck-typed stand-in for common.AOI where fetch.fetch_sl / fetch_rlp / buildings.fetch_sl only use
    `key`, `county` and `tiles(buffered=…)`: the needed 1 km tiles instead of a bbox + buffer ring."""
    key: str
    county: str
    tile_list: tuple[tuple[int, int], ...]
    bbox: tuple[int, int, int, int]

    def tiles(self, buffered: bool = True) -> list[tuple[int, int]]:
        return list(self.tile_list)


def parse_tiles_needed(meta: dict) -> dict[str, list[tuple[int, int]]]:
    """places.py meta → {'SL': [(e_km, n_km), …], 'RLP': […]} (the list may be stored as a repr string)."""
    t = meta.get("tiles_needed_list")
    if isinstance(t, str):
        t = ast.literal_eval(t)
    if not isinstance(t, dict):
        return {}
    return {k: sorted({(int(e), int(n)) for e, n in v}) for k, v in t.items()}


def load_tileset(path: Path = PLACES) -> TileSet:
    meta = json.loads(path.read_text())["meta"]
    need = parse_tiles_needed(meta)
    bbox = tuple(int(v) for v in meta["stats_bbox"])
    tiles = sorted(set().union(*need.values())) if need else [
        (e, n) for n in range(bbox[1] // TILE, bbox[3] // TILE) for e in range(bbox[0] // TILE, bbox[2] // TILE)]
    return TileSet("orte", "SPK", tuple(sorted(tiles, key=lambda t: (-t[1], t[0]))), bbox)


def tile_code(e_km, n_km):
    """Tile id E_km · 100000 + N_km (e.g. 380 / 5460 → 38005460), int64-safe for arrays."""
    return np.asarray(e_km, np.int64) * 100000 + np.asarray(n_km, np.int64)


def tile_of(e_cell, n_cell) -> np.ndarray:
    """Tile code of cells given by their integer lower-left corner (E, N) in m."""
    return tile_code(np.floor_divide(e_cell, TILE), np.floor_divide(n_cell, TILE))


def block_windows(tiles, block: int = BLOCK, margin: int = MARGIN
                  ) -> list[tuple[tuple[int, int, int, int], tuple[int, int, int, int]]]:
    """Detection blocks covering the tiles: [(core, window)], each (e0, n0, e1, n1) in m. Cores lie on the global
    `block` grid (so on the 500 m chunk grid too); only blocks holding at least one tile are returned. The window is
    the core grown by `margin` on every side."""
    keys = sorted({((e * TILE) // block, (n * TILE) // block) for e, n in tiles}, key=lambda k: (-k[1], k[0]))
    out = []
    for be, bn in keys:
        core = (be * block, bn * block, (be + 1) * block, (bn + 1) * block)
        out.append((core, (core[0] - margin, core[1] - margin, core[2] + margin, core[3] + margin)))
    return out


def overlap_slices(window: tuple[int, int, int, int], box: tuple[int, int, int, int]):
    """Row/col slices of `box` inside `window` and of the window part inside `box` (both (e0, n0, e1, n1), 1 m grid,
    row 0 = north); None when they do not overlap."""
    e0, n0, e1, n1 = max(window[0], box[0]), max(window[1], box[1]), min(window[2], box[2]), min(window[3], box[3])
    if e0 >= e1 or n0 >= n1:
        return None
    win = (slice(window[3] - n1, window[3] - n0), slice(e0 - window[0], e1 - window[0]))
    src = (slice(box[3] - n1, box[3] - n0), slice(e0 - box[0], e1 - box[0]))
    return win, src


def tiles_in(window: tuple[int, int, int, int]) -> list[tuple[int, int]]:
    e0, n0, e1, n1 = window
    return [(e, n) for n in range(math.floor(n0 / TILE), math.ceil(n1 / TILE))
            for e in range(math.floor(e0 / TILE), math.ceil(e1 / TILE))]


def tile_box(t: tuple[int, int]) -> tuple[int, int, int, int]:
    return t[0] * TILE, t[1] * TILE, (t[0] + 1) * TILE, (t[1] + 1) * TILE


def rlp_lod2_tiles(needed, available) -> list[tuple[int, int]]:
    """2 km RLP LoD2 tiles (even lower-left km corner) that contain a needed 1 km tile and exist in the listing."""
    want = {(e - e % 2, n - n % 2) for e, n in needed}
    return sorted(t for t in want if t in set(available))


# --------------------------------------------------------------------------------------------- detection core (pure)
@dataclass
class TreeArrays:
    """Trees with global cell coordinates (integer lower-left corner of the top cell)."""
    e: np.ndarray
    n: np.ndarray
    g: np.ndarray
    h: np.ndarray
    r: np.ndarray
    type: np.ndarray     # u8 incl. the trees.FILL flag
    bright: np.ndarray
    state: np.ndarray    # u8 LiDAR source at the cell

    FIELDS = ("e", "n", "g", "h", "r", "type", "bright", "state")

    @staticmethod
    def empty() -> "TreeArrays":
        z = np.zeros(0)
        return TreeArrays(z.astype(np.int64), z.astype(np.int64), z, z, z, z.astype(np.uint8), z, z.astype(np.uint8))

    @staticmethod
    def concat(parts: list["TreeArrays"]) -> "TreeArrays":
        parts = [p for p in parts if p.e.size] or [TreeArrays.empty()]
        return TreeArrays(*(np.concatenate([getattr(p, f) for p in parts]) for f in TreeArrays.FIELDS))

    def take(self, m) -> "TreeArrays":
        return TreeArrays(*(getattr(self, f)[m] for f in TreeArrays.FIELDS))


def detect_window(dsm: np.ndarray, dtm: np.ndarray, bldg, ortho, core_rows: tuple[int, int],
                  core_cols: tuple[int, int], p, chunk: int = CHUNK):
    """trees.py detection on one window (row 0 = north); returns the trees of the core chunks in window cells,
    i.e. trees.Trees (row, col, …) whose measured top lies in a core chunk (fill trees may lie up to trees.APRON
    outside the core), plus the raw CHM (buildings 0) of the window."""
    import trees as T
    chm, sm = T.smooth_chm(dsm, dtm, bldg, p)
    tops_r, tops_c = T.find_tops(sm, p)
    parts = []
    for r0 in range(core_rows[0], core_rows[1], chunk):
        for c0 in range(core_cols[0], core_cols[1], chunk):
            parts.append(T.chunk_trees(chm, sm, dtm, ortho, tops_r, tops_c, (r0, r0 + chunk, c0, c0 + chunk), p))
    parts = [t for t in parts if t.row.size] or [T.Trees.empty()]
    return T.Trees(*(np.concatenate([getattr(t, f) for t in parts]) for f in T.Trees.__dataclass_fields__)), chm


def to_global(t, window: tuple[int, int, int, int], state: np.ndarray | None = None) -> TreeArrays:
    """trees.Trees in window cells → global integer cell corners (E = e0 + col, N = n1 − row − 1)."""
    row, col = t.row.astype(np.int64), t.col.astype(np.int64)
    st = state[row, col] if state is not None and row.size else np.zeros(row.size, np.uint8)
    return TreeArrays(window[0] + col, window[3] - row - 1, t.g.astype(np.float64), t.h.astype(np.float64),
                      t.r.astype(np.float64), t.type.astype(np.uint8), t.bright.astype(np.float64),
                      st.astype(np.uint8))


def merge_trees(parts: list[TreeArrays], min_height: float, max_height: float) -> TreeArrays:
    """trees.detect's merge over blocks: one tree per cell (a measured top beats a fill tree; among equals the first
    in input order), then the height filter. Output sorted by (N descending, E)."""
    from trees import FILL
    a = TreeArrays.concat(parts)
    if not a.e.size:
        return a
    cell = a.e * 100_000_000 + a.n
    pref = np.lexsort(((a.type & FILL) > 0, cell))
    keep = np.sort(pref[np.r_[True, cell[pref][1:] != cell[pref][:-1]]])
    keep = keep[(a.h[keep] >= min_height) & (a.h[keep] <= max_height)]
    a = a.take(keep)
    return a.take(np.lexsort((a.e, -a.n)))


# --------------------------------------------------------------------------------------------- fetch
def fetch_lidar(ts: TileSet) -> dict:
    """DGM1 + DOM1 for every needed tile: SL from the county ZIP (fetch.fetch_sl, cached + known-missing list),
    RLP from geobasis-rlp (fetch.fetch_rlp). Both are tried for every tile, like fetch.py does for a buffer ring."""
    from fetch import fetch_rlp, fetch_sl
    rep = {"sl": fetch_sl(ts, ["dgm1", "dom1"]), "rlp": fetch_rlp(ts, ["dgm1", "dom1"])}
    return {"tiles": len(ts.tile_list),
            "sl": {p: {k: len(v) for k, v in r.items()} for p, r in rep["sl"].items()},
            "rlp": {p: len(v) for p, v in rep["rlp"].items()},
            "tiles_without_dgm": [t for t in ts.tile_list if not lidar_paths("dgm1", [t], "mosaic")[0]
                                  and not lidar_paths("dgm1", [t], "mosaic")[1]]}


def fetch_lod2(ts: TileSet) -> dict:
    """LoD2 CityGML (cached gzip) via buildings.py: SL 1 km tiles from the county ZIP, RLP 2 km tiles holding a
    needed tile (not the whole bbox)."""
    import buildings as B
    sl = B.fetch_sl(ts)
    d = B.LOD2_RAW / "rlp"
    d.mkdir(parents=True, exist_ok=True)
    listing_f = d / "_listing.json"
    if not listing_f.exists():
        with http_open(B.RLP_BASE, timeout=120) as r:
            avail = B.parse_rlp_listing(r.read().decode("utf-8", "replace"))
        listing_f.write_text(json.dumps({f"{e}_{n}": v for (e, n), v in sorted(avail.items())}, indent=0))
    avail = {tuple(int(x) for x in k.split("_")): v for k, v in json.loads(listing_f.read_text()).items()}
    rlp = []
    for t in rlp_lod2_tiles(ts.tile_list, avail):
        name = avail[t]
        dst = d / (name + ".gz")
        if not dst.exists():
            t0 = time.time()
            with http_open(B.RLP_BASE + name, timeout=300) as r:
                B._gz_write(dst, r)
            print(f"  + RLP {name}: {fmt_bytes(dst.stat().st_size)} gz, {time.time() - t0:.1f}s", flush=True)
            time.sleep(0.3)
        rlp.append(dst)
    print(f"LoD2: SL {len(sl)} tiles, RLP {len(rlp)} 2-km tiles")
    return {"sl_tiles": len(sl), "rlp_tiles": len(rlp)}


def lod2_paths(ts: TileSet) -> tuple[list[Path], list[Path]]:
    import buildings as B
    sl = [B.LOD2_RAW / "sl" / (B.sl_tile_name(*t) + ".gz") for t in ts.tile_list]
    listing = json.loads((B.LOD2_RAW / "rlp" / "_listing.json").read_text())
    avail = {tuple(int(x) for x in k.split("_")): v for k, v in listing.items()}
    rlp = [B.LOD2_RAW / "rlp" / (avail[t] + ".gz") for t in rlp_lod2_tiles(ts.tile_list, avail)]
    return [p for p in sl if p.exists()], [p for p in rlp if p.exists()]


def dop_names(t: tuple[int, int]) -> dict[str, str]:
    from ortho import RLP_DOP_LAYER, SL_DOP_LAYER, cache_name
    b = tile_box(t)
    return {"probe": cache_name(SL_DOP_LAYER, b, DOP_PROBE_PX, "png"), "sl_jpg": cache_name(SL_DOP_LAYER, b, DOP_PX, "jpg"),
            "sl_png": cache_name(SL_DOP_LAYER, b, DOP_PX, "png"), "rlp_jpg": cache_name(RLP_DOP_LAYER, b, DOP_PX, "jpg")}


def dop_mode(alpha: np.ndarray) -> str:
    """SL coverage probe alpha → 'sl' (full SL imagery), 'rlp' (none) or 'mixed'."""
    if alpha.min() == 255:
        return "sl"
    if alpha.max() == 0:
        return "rlp"
    return "mixed"


def overall_box() -> tuple[int, int, int, int]:
    a = load_aoi(OVERALL)
    return a.e0, a.n0, a.e1, a.n1


def inside(box_inner, box_outer) -> bool:
    return (box_inner[0] >= box_outer[0] and box_inner[1] >= box_outer[1] and box_inner[2] <= box_outer[2]
            and box_inner[3] <= box_outer[3])


def fetch_dop(tiles, extra_modes: dict | None = None, workers: int = 3) -> dict:
    """DOP20 at 1 m per tile (cached in data/raw/dop-orte/{sl,rlp}/): an SL coverage probe, then SL JPEG (full SL
    coverage), RLP JPEG (no SL) or SL PNG + RLP JPEG (mixed). `extra_modes` {tile: ['sl_jpg', 'rlp_jpg']} fetches
    named variants regardless of the probe (DOP check tiles). Max 3 parallel requests (ortho.run_pool)."""
    from ortho import RLP_DOP_LAYER, RLP_DOP_WMS, SL_DOP_LAYER, SL_DOP_WMS, WmsClient, fetch_meta, run_pool, \
        wms_getmap_url
    fetch_meta(DOP_RAW, {"sl": {"url": SL_DOP_WMS, "layer": SL_DOP_LAYER, "format": "image/jpeg | image/png"},
                         "rlp": {"url": RLP_DOP_WMS, "layer": RLP_DOP_LAYER, "format": "image/jpeg"},
                         "pxPerTile": DOP_PX, "tileM": TILE, "crs": "EPSG:25832"})
    sl = WmsClient(DOP_RAW / "sl")
    rlp = WmsClient(DOP_RAW / "rlp")
    full = (DOP_PX, DOP_PX)

    def get(kind: str, t) -> np.ndarray:
        b, nm = tile_box(t), dop_names(t)
        if kind == "probe":
            return sl.image(wms_getmap_url(SL_DOP_WMS, SL_DOP_LAYER, b, DOP_PROBE_PX, DOP_PROBE_PX), nm["probe"],
                            (DOP_PROBE_PX, DOP_PROBE_PX))
        if kind == "sl_jpg":
            return sl.image(wms_getmap_url(SL_DOP_WMS, SL_DOP_LAYER, b, DOP_PX, DOP_PX, fmt="image/jpeg",
                                           transparent=False), nm["sl_jpg"], full)
        if kind == "sl_png":
            return sl.image(wms_getmap_url(SL_DOP_WMS, SL_DOP_LAYER, b, DOP_PX, DOP_PX), nm["sl_png"], full)
        return rlp.image(wms_getmap_url(RLP_DOP_WMS, RLP_DOP_LAYER, b, DOP_PX, DOP_PX, fmt="image/jpeg",
                                        transparent=False), nm["rlp_jpg"], full)

    def one(t):
        mode = dop_mode(get("probe", t)[..., 3])
        for kind in {"sl": ["sl_jpg"], "rlp": ["rlp_jpg"], "mixed": ["sl_png", "rlp_jpg"]}[mode]:
            get(kind, t)
        for kind in (extra_modes or {}).get(t, []):
            get(kind, t)
        return mode

    tl = sorted(set(tiles) | set(extra_modes or {}), key=lambda t: (-t[1], t[0]))
    modes = dict(zip(tl, run_pool(one, tl, workers)))
    idx_f = DOP_RAW / "tiles.json"
    old = json.loads(idx_f.read_text()) if idx_f.exists() else {}
    old.update({f"{e}_{n}": m for (e, n), m in modes.items()})
    idx_f.write_text(json.dumps(old, indent=0, sort_keys=True))
    print(f"DOP: {len(tl)} tiles ({ {m: list(modes.values()).count(m) for m in set(modes.values())} }); "
          f"SL {sl.requests} requests {fmt_bytes(sl.bytes)}, cached {sl.cached}; "
          f"RLP {rlp.requests} requests {fmt_bytes(rlp.bytes)}, cached {rlp.cached}", flush=True)
    return {"tiles": len(tl), "modes": {m: list(modes.values()).count(m) for m in set(modes.values())},
            "requests": sl.requests + rlp.requests, "bytes": sl.bytes + rlp.bytes}


# --------------------------------------------------------------------------------------------- inputs per window
def lidar_paths(product: str, tiles, lidar: str) -> tuple[dict, dict]:
    """Cached tile files ({tile: path}) for SL and RLP; `lidar` 'sl' / 'rlp' blanks the other source."""
    sl, rlp = {}, {}
    for t in tiles:
        p = SL_RAW / sl_name(product, *t)
        if p.exists() and lidar in ("mosaic", "sl"):
            sl[t] = p
        hits = sorted(RLP_RAW.glob(f"{product}_32_{t[0]}_{t[1]}_1_rp_*.tif"))
        if hits and lidar in ("mosaic", "rlp"):
            rlp[t] = hits[-1]
    return sl, rlp


def lidar_window(window, lidar: str, offset: float):
    """build.py mosaic rules on a window → (dtm, dsm, state) float32/float32/u8, or None without any DTM."""
    from build import fill_nearest, read_mosaic
    tl = tiles_in(window)
    shape = (window[3] - window[1], window[2] - window[0])
    nan = np.full(shape, np.nan, np.float32)

    def rd(paths):
        return read_mosaic(paths, window)[0] if paths else nan.copy()

    sl_p, rlp_p = lidar_paths("dgm1", tl, lidar)
    dtm_sl, dtm_rlp = rd(sl_p), rd(rlp_p)
    use_rlp = ~np.isfinite(dtm_sl) & np.isfinite(dtm_rlp)
    dtm = np.where(use_rlp, dtm_rlp + offset, dtm_sl)
    gap = ~np.isfinite(dtm)
    if gap.all():
        return None
    dtm = fill_nearest(dtm)
    sl_p, rlp_p = lidar_paths("dom1", tl, lidar)
    dsm_sl, dsm_rlp = rd(sl_p), rd(rlp_p)
    use = ~np.isfinite(dsm_sl) & np.isfinite(dsm_rlp)
    dsm = np.where(use, dsm_rlp + offset, dsm_sl)
    dsm_gap = ~np.isfinite(dsm)
    dsm = np.where(dsm_gap, dtm, dsm)
    dsm = np.maximum(dsm, dtm - 0.5)
    state = np.where(use, STATE_RLP, STATE_SL).astype(np.uint8)
    state[gap | dsm_gap] = STATE_NONE
    return dtm.astype(np.float32), dsm.astype(np.float32), state


def read_box(path: Path, window, bands=None, fill=0):
    """Window of a 1 m GeoTIFF on the global grid, boundless (cells outside the raster = `fill`)."""
    import rasterio
    from rasterio.windows import from_bounds
    with rasterio.open(path) as ds:
        w = from_bounds(*window, ds.transform).round_offsets().round_lengths()
        return ds.read(bands if bands else 1, window=w, boundless=True, fill_value=fill)


def rlp_rgba_fix(a: np.ndarray, calib: tuple[float, float] | None) -> np.ndarray:
    """RLP DOP20 JPEG → RGBA: pure white (the WMS background outside RLP imagery) becomes alpha 0, and the optional
    brightness calibration b' = k · b + c (fitted on crowns seen in both DOPs, `calibrate`) is applied to R, G, B
    alike, so the crown-mean brightness that trees.classify thresholds is mapped the same way (pure)."""
    a = a.copy()
    white = (a[..., :3] >= 254).all(axis=-1)
    if calib is not None:
        k, c = calib
        a[..., :3] = np.clip(np.rint(a[..., :3].astype(np.float32) * k + c), 0, 255).astype(np.uint8)
    a[..., 3] = np.where(white, 0, a[..., 3])
    return a


def load_dop_tile(t, mode: str, calib: tuple[float, float] | None = None) -> np.ndarray | None:
    """(3, 1000, 1000) float32 RGB of a cached DOP tile, NaN where no imagery; None if not cached.
    mode: 'sl'/'sl_jpg' (SL JPEG), 'sl_png' (SL only, transparent), 'rlp'/'rlp_jpg' (RLP only), 'mixed' (SL over
    RLP). `calib` applies to the RLP layer."""
    from PIL import Image
    from ortho import composite_over, to_rgba
    nm = dop_names(t)

    def rgba(sub, key):
        p = DOP_RAW / sub / nm[key]
        if not p.exists():
            return None
        with Image.open(p) as im:
            a = to_rgba(im)
        return rlp_rgba_fix(a, calib) if sub == "rlp" else a

    if mode in ("sl", "sl_jpg"):
        layers = [rgba("sl", "sl_jpg")]
    elif mode == "sl_png":
        layers = [rgba("sl", "sl_png")]
    elif mode in ("rlp", "rlp_jpg"):
        layers = [rgba("rlp", "rlp_jpg")]
    else:
        layers = [rgba("sl", "sl_png"), rgba("rlp", "rlp_jpg")]
    layers = [x for x in layers if x is not None]
    if not layers:
        return None
    rgb, cov = composite_over(layers)
    out = np.moveaxis(rgb.astype(np.float32), 2, 0)
    out[:, cov < 0.5] = np.nan
    return out


def ortho_window(window, mode: str, dop_modes: dict, ov_box, ov_ortho: Path | None,
                 calib: tuple[float, float] | None = None) -> np.ndarray:
    """Colour for a window: 'auto' = DOP tiles, overlaid by overall's ortho_1m.tif inside `overall`; 'sl_jpg' /
    'rlp_jpg' = only that DOP variant (check tiles); 'none' = all NaN."""
    shape = (3, window[3] - window[1], window[2] - window[0])
    out = np.full(shape, np.nan, np.float32)
    if mode == "none":
        return out
    for t in tiles_in(window):
        m = dop_modes.get(t) if mode == "auto" else mode
        if m is None:
            continue
        arr = load_dop_tile(t, m, calib)
        sl = overlap_slices(window, tile_box(t))
        if arr is None or sl is None:
            continue
        (wr, wc), (sr, sc) = sl
        out[:, wr, wc] = arr[:, sr, sc]
    if mode == "auto" and ov_ortho is not None and ov_ortho.exists():
        sl = overlap_slices(window, ov_box)
        if sl is not None:
            (wr, wc), _ = sl
            a = read_box(ov_ortho, window, bands=[1, 2, 3]).astype(np.float32)
            out[:, wr, wc] = a[:, wr, wc]
    return out


@dataclass(frozen=True)
class BlockCfg:
    lidar: str = "mosaic"     # 'mosaic' (SL first, RLP fill) | 'sl' | 'rlp'
    ortho: str = "auto"       # 'auto' | 'sl_jpg' | 'rlp_jpg' | 'none'
    offset: float = 0.0       # m, constant RLP height offset (build.rlp_offset 'applied')
    bldg: str = ""            # building mask GeoTIFF ('' = none)
    rasters: bool = True      # return core CHM / state rasters
    dop_modes: dict = field(default_factory=dict)
    rlp_calib: tuple | None = None   # (k, c) RLP DOP brightness → SL DOP brightness, see `calibrate`


def detect_block(core, window, cfg: BlockCfg) -> dict:
    """One block: window inputs → trees of the core chunks (global cells) + core rasters."""
    from trees import Params
    p = Params()
    t0 = time.time()
    lw = lidar_window(window, cfg.lidar, cfg.offset)
    if lw is None:
        return {"core": core, "trees": TreeArrays.empty(), "chm": None, "state": None, "dtm": None, "s": 0.0}
    dtm, dsm, state = lw
    bldg = read_box(Path(cfg.bldg), window) if cfg.bldg else None
    ortho = ortho_window(window, cfg.ortho, cfg.dop_modes, overall_box(),
                         WORK_DIR / OVERALL / "ortho_1m.tif", cfg.rlp_calib)
    m = core[0] - window[0]
    t, chm = detect_window(dsm, dtm, bldg, ortho, (window[3] - core[3], window[3] - core[1]),
                           (m, m + core[2] - core[0]), p)
    out = {"core": core, "trees": to_global(t, window, state), "s": round(time.time() - t0, 1)}
    if cfg.rasters:
        rs = slice(window[3] - core[3], window[3] - core[1])
        cs = slice(m, m + core[2] - core[0])
        out["chm"], out["state"], out["dtm"] = chm[rs, cs].copy(), state[rs, cs].copy(), dtm[rs, cs].copy()
    else:
        out["chm"] = out["state"] = out["dtm"] = None
    return out


def _detect_block_star(args):
    return detect_block(*args)


def run_blocks(blocks, cfg: BlockCfg, workers: int):
    jobs = [(core, win, cfg) for core, win in blocks]
    with ProcessPoolExecutor(max_workers=max(1, min(4, workers))) as ex:
        yield from ex.map(_detect_block_star, jobs)


# --------------------------------------------------------------------------------------------- prepare
def compute_rlp_offset(tiles) -> dict:
    """build.rlp_offset over all tiles with both SL and RLP DGM1 (same rule as an AOI build)."""
    from build import read_mosaic, rlp_offset
    sl_v, rlp_v = [], []
    for t in tiles:
        sl_p, rlp_p = lidar_paths("dgm1", [t], "mosaic")
        if t in sl_p and t in rlp_p:
            a, _ = read_mosaic(sl_p, tile_box(t))
            b, _ = read_mosaic(rlp_p, tile_box(t))
            both = np.isfinite(a) & np.isfinite(b)
            sl_v.append(a[both])
            rlp_v.append(b[both])
    if not sl_v:
        return {"overlap_px": 0, "applied": 0.0, "constant_bias": False}
    return rlp_offset(np.concatenate(sl_v), np.concatenate(rlp_v))


def write_tif(path: Path, arr: np.ndarray, bbox, nodata=None) -> None:
    import rasterio
    from rasterio.transform import from_origin
    path.parent.mkdir(parents=True, exist_ok=True)
    kw = dict(driver="GTiff", width=arr.shape[1], height=arr.shape[0], count=1, dtype=arr.dtype.name,
              crs="EPSG:25832", transform=from_origin(bbox[0], bbox[3], 1, 1), compress="deflate", tiled=True,
              nodata=nodata)
    if arr.dtype == np.float32:
        kw["predictor"] = 3
    tmp = path.with_suffix(".tmp.tif")
    with rasterio.open(tmp, "w", **kw) as ds:
        ds.write(arr, 1)
    tmp.replace(path)


def prepare(ts: TileSet) -> dict:
    """RLP offset + building mask raster over the stats bbox (buildings.py rules)."""
    import buildings as B
    from shapely import STRtree  # noqa: F401  (B.drop_rlp_duplicates)
    t0 = time.time()
    off = compute_rlp_offset(ts.tile_list)
    print(f"RLP offset: {off}", flush=True)
    sl_paths, rlp_paths = lod2_paths(ts)
    seen: set[str] = set()
    sl, sl_stats = B.load_buildings(sl_paths, "sl", seen)
    rlp, rlp_stats = B.load_buildings(rlp_paths, "rlp", seen)
    rlp, dups = B.drop_rlp_duplicates(sl, rlp)
    print(f"LoD2: SL {len(sl)} buildings ({len(sl_paths)} tiles), RLP {len(rlp)} ({len(rlp_paths)} tiles, "
          f"{dups} SL duplicates dropped) [{time.time() - t0:.0f}s]", flush=True)
    bb = ts.bbox
    mask = B.rasterize_mask([b.footprint for b in sl + rlp], bb[0], bb[3], bb[2] - bb[0], bb[3] - bb[1])
    write_tif(RASTER_DIR / "bldg.tif", mask, bb)
    info = {"rlp_offset": off, "lod2": {"sl_tiles": len(sl_paths), "rlp_tiles": len(rlp_paths), "sl_buildings": len(sl),
                                        "rlp_buildings": len(rlp), "rlp_duplicates_dropped": dups,
                                        "mask_cells": int(mask.sum())},
            "seconds": round(time.time() - t0, 1)}
    (ORTE_DIR / "stats_trees_prepare.json").write_text(json.dumps(info, indent=1))
    return info


# --------------------------------------------------------------------------------------------- RLP DOP calibration
CALIB_FILE = ORTE_DIR / "dop_calibration.json"
CALIB_MIN_PAIRS = 200


def moment_fit(a: np.ndarray, b: np.ndarray) -> tuple[float, float]:
    """Linear map b → a that matches mean and standard deviation (geometric-mean regression). Unlike least squares
    it keeps the spread of the SL brightness, so the dark (conifer) and bright tails keep their shares (pure)."""
    k = float(np.std(a) / np.std(b))
    return k, float(np.mean(a) - k * np.mean(b))


def fit_calibration(pairs: dict[str, tuple[np.ndarray, np.ndarray]], p) -> dict:
    """Linear map RLP crown brightness → SL crown brightness, b_sl ≈ k · b_rlp + c by mean/std matching over all
    crowns (measured tops seen in both DOPs). Reported: agreement of trees.classify with the SL type raw, with the
    fit, leave-one-tile-out, and with a least-squares fit for comparison (pure)."""
    from trees import TYPE_CODES, classify
    pairs = {t: (np.asarray(a, float), np.asarray(b, float)) for t, (a, b) in pairs.items() if np.size(a) >= CALIB_MIN_PAIRS}
    if not pairs:
        return {"ok": False, "reason": "no tile with enough crowns in both DOPs"}
    A = np.concatenate([a for a, _ in pairs.values()])
    B = np.concatenate([b for _, b in pairs.values()])
    k, c = moment_fit(A, B)
    kl, cl = np.polyfit(B, A, 1)
    ta = classify(A, p)
    loo_hits = 0
    for t, (a, b) in pairs.items():
        rest = [x for u, x in pairs.items() if u != t]
        kk, cc = moment_fit(np.concatenate([x[0] for x in rest]), np.concatenate([x[1] for x in rest])) if rest else (k, c)
        loo_hits += int((classify(kk * b + cc, p) == classify(a, p)).sum())
    tc, tl, tr = classify(k * B + c, p), classify(kl * B + cl, p), classify(B, p)
    con, brd = ta == TYPE_CODES["conifer"], ta == TYPE_CODES["broadleaf"]

    def rec(x, m):
        return round(float(np.mean(x[m] == ta[m])), 4) if m.any() else None

    def shares(x):
        return {kk_: round(float(np.mean(x == v)), 4) for kk_, v in TYPE_CODES.items()}

    return {"ok": True, "fit": "mean/std matching", "k": round(k, 5), "c": round(c, 4), "pairs": int(A.size),
            "tiles": {t: int(np.size(a)) for t, (a, _) in pairs.items()},
            "corr": round(float(np.corrcoef(A, B)[0, 1]), 4),
            "mean_sl": round(float(A.mean()), 2), "mean_rlp": round(float(B.mean()), 2),
            "std_sl": round(float(A.std()), 2), "std_rlp": round(float(B.std()), 2),
            "type_agree_raw": round(float(np.mean(tr == ta)), 4),
            "type_agree_fit": round(float(np.mean(tc == ta)), 4),
            "type_agree_leave_one_tile_out": round(loo_hits / A.size, 4),
            "conifer_recall_fit": rec(tc, con), "broadleaf_recall_fit": rec(tc, brd),
            "least_squares": {"k": round(float(kl), 5), "c": round(float(cl), 4),
                              "type_agree": round(float(np.mean(tl == ta)), 4), "conifer_recall": rec(tl, con),
                              "share": shares(tl)},
            "share_sl": shares(ta), "share_rlp_fit": shares(tc), "share_rlp_raw": shares(tr)}


def paired_brightness(ref_parts, new_parts) -> tuple[np.ndarray, np.ndarray]:
    """Crown brightness of measured tops present (same cell) in two runs with different colour inputs."""
    a = TreeArrays.concat([r["trees"] for r in ref_parts])
    b = TreeArrays.concat([r["trees"] for r in new_parts])
    ma, mb = (a.type & 0x80) == 0, (b.type & 0x80) == 0
    ka, kb = a.e[ma] * 100_000_000 + a.n[ma], b.e[mb] * 100_000_000 + b.n[mb]
    _, ia, ib = np.intersect1d(ka, kb, return_indices=True)
    x, y = a.bright[ma][ia], b.bright[mb][ib]
    ok = np.isfinite(x) & np.isfinite(y)
    return x[ok], y[ok]


def calibration_tiles(ts: TileSet) -> tuple[list, list]:
    """Tiles where SL and RLP DOP overlap: overall tiles that the AOI build filled from RLP (mask 0.5 on > 30 %,
    i.e. RLP territory under the SL TrueDOP), and the stats tiles whose SL coverage probe was partial ('mixed')."""
    ov = overall_box()
    mask = read_box(WORK_DIR / OVERALL / "mask.tif", ov, fill=0)
    ov_tiles = []
    for t in tiles_in(ov):
        sl = overlap_slices(ov, tile_box(t))
        if sl is not None and float((mask[sl[0]] == 0.5).mean()) > 0.3:
            ov_tiles.append(t)
    mixed = [t for t, m in dop_index().items() if m == "mixed" and t in set(ts.tile_list) and not inside(tile_box(t), ov)]
    return sorted(ov_tiles), sorted(mixed)


def run_calibrate(ts: TileSet, workers: int = 4) -> dict:
    from trees import Params
    prep = json.loads((ORTE_DIR / "stats_trees_prepare.json").read_text())
    offset = float(prep["rlp_offset"]["applied"])
    ov_tiles, mixed = calibration_tiles(ts)
    fetch_dop([], extra_modes={t: ["rlp_jpg"] for t in ov_tiles})
    pairs = {}
    for tiles, ref_mode in ((ov_tiles, "auto"), (mixed, "sl_png")):
        if not tiles:
            continue
        blocks = [(tile_box(t), grow(tile_box(t), MARGIN)) for t in tiles]
        common = dict(lidar="mosaic", offset=offset, bldg=str(RASTER_DIR / "bldg.tif"), rasters=False)
        ref = list(run_blocks(blocks, BlockCfg(ortho=ref_mode, **common), workers))
        new = list(run_blocks(blocks, BlockCfg(ortho="rlp_jpg", **common), workers))
        for t, r, n in zip(tiles, ref, new):
            pairs[f"{t[0]}_{t[1]}"] = paired_brightness([r], [n])
    rep = fit_calibration(pairs, Params())
    rep.update({"rule": "b_sl = k * b_rlp + c on crown-mean (R+G+B)/3 of measured tops; RLP DOP20 WMS JPEG at 1 m vs "
                        "SL TrueDOP20 (overall ortho_1m inside overall, SL WMS PNG elsewhere)",
                "overall_tiles": [f"{e}_{n}" for e, n in ov_tiles], "mixed_tiles": [f"{e}_{n}" for e, n in mixed]})
    rep["use"] = bool(rep.get("ok")) and rep.get("type_agree_leave_one_tile_out", 0) > rep.get("type_agree_raw", 1)
    CALIB_FILE.write_text(json.dumps(rep, indent=1))
    return rep


def load_calibration() -> tuple[float, float] | None:
    if not CALIB_FILE.exists():
        return None
    r = json.loads(CALIB_FILE.read_text())
    return (float(r["k"]), float(r["c"])) if r.get("use") else None


def grow(box, m):
    return box[0] - m, box[1] - m, box[2] + m, box[3] + m


# --------------------------------------------------------------------------------------------- detect (main run)
ATTRIBUTION_DOP_SL = "© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (DOP20)"
ATTRIBUTION_DOP_RLP = "© GeoBasis-DE/LVermGeoRP (2026), dl-de/by-2-0, www.lvermgeo.rlp.de, Daten bearbeitet (DOP20)"


def dop_index() -> dict[tuple[int, int], str]:
    f = DOP_RAW / "tiles.json"
    if not f.exists():
        return {}
    return {tuple(int(x) for x in k.split("_")): v for k, v in json.loads(f.read_text()).items()}


COLOUR_OVERALL, COLOUR_SL, COLOUR_MIXED, COLOUR_RLP, COLOUR_NONE = 0, 1, 2, 3, 4
COLOUR_LABELS = {COLOUR_OVERALL: "overall ortho_1m (SL TrueDOP20)", COLOUR_SL: "SL TrueDOP20 WMS 1 m",
                 COLOUR_MIXED: "SL TrueDOP20 + RLP DOP20 (calibrated)", COLOUR_RLP: "RLP DOP20 (calibrated)",
                 COLOUR_NONE: "kein Luftbild"}


def colour_source(e, n, dmodes: dict, ov) -> np.ndarray:
    """Colour source of each tree's tile (u8, COLOUR_*): overall's ortho, SL DOP, mixed tile, RLP DOP or none."""
    codes = tile_of(e, n)
    out = np.full(codes.size, COLOUR_NONE, np.uint8)
    lut = {"sl": COLOUR_SL, "mixed": COLOUR_MIXED, "rlp": COLOUR_RLP}
    for c in np.unique(codes):
        t = (int(c // 100000), int(c % 100000))
        out[codes == c] = COLOUR_OVERALL if inside(tile_box(t), ov) else lut.get(dmodes.get(t), COLOUR_NONE)
    return out


def run_detect(ts: TileSet, workers: int = 4) -> dict:
    from trees import FILL, METHOD, METHOD_VERSION, TYPE_CODES, Params, tree_ids
    import buildings as B
    t0 = time.time()
    prep = json.loads((ORTE_DIR / "stats_trees_prepare.json").read_text())
    offset = float(prep["rlp_offset"]["applied"])
    ov = overall_box()
    dmodes = {t: m for t, m in dop_index().items() if t in set(ts.tile_list) and not inside(tile_box(t), ov)}
    calib = load_calibration()
    cfg = BlockCfg(lidar="mosaic", ortho="auto", offset=offset, bldg=str(RASTER_DIR / "bldg.tif"), dop_modes=dmodes,
                   rlp_calib=calib)
    blocks = block_windows(ts.tile_list)
    bb = ts.bbox
    H, W = bb[3] - bb[1], bb[2] - bb[0]
    chm_all = np.full((H, W), np.nan, np.float32)
    dtm_all = np.full((H, W), np.nan, np.float32)   # ground for stats.py's terrain check of tall tops
    state_all = np.full((H, W), STATE_UNFETCHED, np.uint8)
    parts, secs = [], []
    for k, res in enumerate(run_blocks(blocks, cfg, workers)):
        parts.append(res["trees"])
        secs.append(res["s"])
        if res["chm"] is not None:
            sl = overlap_slices(bb, res["core"])
            if sl is not None:
                (wr, wc), (sr, sc) = sl
                chm_all[wr, wc] = res["chm"][sr, sc]
                state_all[wr, wc] = res["state"][sr, sc]
                dtm_all[wr, wc] = res["dtm"][sr, sc]
        print(f"  block {k + 1}/{len(blocks)} {res['core'][:2]}: {res['trees'].e.size} trees, {res['s']}s", flush=True)
    p = Params()
    a = merge_trees(parts, p.min_height, STATS_MAX_HEIGHT)
    needed = np.isin(tile_of(a.e, a.n), tile_code(*np.array(ts.tile_list).T))
    keep = needed & (a.state != STATE_NONE)
    a = a.take(keep)
    # rasters: only the needed tiles count as fetched
    fetched = np.zeros((H, W), bool)
    for t in ts.tile_list:
        sl = overlap_slices(bb, tile_box(t))
        if sl is not None:
            fetched[sl[0]] = True
    chm_all[~fetched] = np.nan
    dtm_all[~fetched] = np.nan
    state_all[~fetched] = STATE_UNFETCHED
    write_tif(RASTER_DIR / "chm.tif", chm_all, bb, nodata=float("nan"))
    del chm_all
    write_tif(RASTER_DIR / "dtm.tif", dtm_all, bb, nodata=float("nan"))
    del dtm_all
    write_tif(RASTER_DIR / "src.tif", state_all, bb, nodata=STATE_UNFETCHED)

    base = a.type & 0x7F
    fill = (a.type & FILL) > 0
    has_rlp_dop = any(m != "sl" for m in dmodes.values())
    attribution = [ATTRIBUTION_SL, ATTRIBUTION_RLP, B.ATTRIBUTION_LOD2_SL, B.ATTRIBUTION_LOD2_RLP, ATTRIBUTION_DOP_SL] \
        + ([ATTRIBUTION_DOP_RLP] if has_rlp_dop else [])
    meta = {
        "format": FORMAT, "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "method": METHOD, "method_version": METHOD_VERSION, "params": {k: v for k, v in asdict(p).items() if k != "extra"} | {"max_height_stats": STATS_MAX_HEIGHT},
        "crs": "EPSG:25832", "bbox": list(bb), "tiles": [list(t) for t in ts.tile_list],
        "fields": {"E": "cell centre easting (m)", "N": "cell centre northing (m)", "h": "tree height (m)",
                   "r": "crown radius (m)", "type": {str(v): k for k, v in TYPE_CODES.items()},
                   "fill": "conifer fill tree (estimated position, ADR 0030)",
                   "state": {str(k): v for k, v in STATE_LABELS.items() if k in (STATE_SL, STATE_RLP)},
                   "tile": "E_km * 100000 + N_km", "g": "ground height DTM (m, DHHN2016)", "id": "trees.tree_ids",
                   "colour": {str(k): v for k, v in COLOUR_LABELS.items()}},
        "inputs": {"lidar": "SL ALS 2025 DOM1/DGM1 first, RLP DOM1/DGM1 2022 fill (build.py rules)",
                   "rlp_offset_m": offset, "bldg": "LoD2 SL + RLP footprints (buildings.py rules)",
                   "colour": "overall ortho_1m inside overall; elsewhere DOP20 WMS at 1 m (SL over RLP)",
                   "rlp_dop_calibration": {"k": calib[0], "c": calib[1]} if calib else None,
                   "dop_modes": {m: list(dmodes.values()).count(m) for m in set(dmodes.values())}},
        "attribution": attribution,
        "privacy": "work file: per-tree data stays local; publish aggregates per place only (plan G1–G3)",
    }
    colour = colour_source(a.e, a.n, dmodes, ov)
    E = a.e.astype(np.float64) + 0.5
    N = a.n.astype(np.float64) + 0.5
    np.savez_compressed(ORTE_DIR / "trees.npz", E=E, N=N, h=a.h.astype(np.float32), r=a.r.astype(np.float32),
                        type=base.astype(np.uint8), fill=fill, state=a.state.astype(np.uint8),
                        tile=tile_of(a.e, a.n).astype(np.int64), g=a.g.astype(np.float32),
                        id=tree_ids(a.e, a.n), colour=colour, meta=np.array(json.dumps(meta, ensure_ascii=False)))
    tiles_c = tile_of(a.e, a.n)
    per_tile = {f"{c // 100000}_{c % 100000}": int(n) for c, n in zip(*np.unique(tiles_c, return_counts=True))}
    area_ha = len(ts.tile_list) * 100.0
    rep = {"count": int(a.e.size), "per_ha": round(a.e.size / area_ha, 1), "fill": int(fill.sum()),
           "counts": {k: int((base == v).sum()) for k, v in TYPE_CODES.items()},
           "by_state": {STATE_LABELS[s]: int((a.state == s).sum()) for s in (STATE_SL, STATE_RLP)},
           "by_state_colour": {f"{STATE_LABELS[st]} / {COLOUR_LABELS[c]}": {
               "trees": int(k.sum()), "conifer_share": round(float(np.mean(base[k] == 1)), 4),
               "fill_share": round(float(np.mean(fill[k])), 4), "unknown_share": round(float(np.mean(base[k] == 0)), 4)}
               for st in (STATE_SL, STATE_RLP) for c in COLOUR_LABELS
               for k in [(a.state == st) & (colour == c)] if k.any()},
           "height_pct": {q: round(float(np.percentile(a.h, q)), 1) for q in (5, 25, 50, 75, 95)},
           "above_app_cap": {"cap_m": p.max_height, "trees": int((a.h > p.max_height).sum()),
                             "measured_tops": int(((a.h > p.max_height) & ~fill).sum())},
           "radius_pct": {q: round(float(np.percentile(a.r, q)), 1) for q in (5, 50, 95)},
           "tiles": len(ts.tile_list), "blocks": len(blocks), "per_tile": per_tile,
           "cells_by_state": {STATE_LABELS[s]: int((state_all == s).sum()) for s in (STATE_SL, STATE_RLP, STATE_NONE)},
           "block_seconds": {"max": max(secs), "sum": round(sum(secs), 1)},
           "seconds": round(time.time() - t0, 1), "meta": meta}
    (ORTE_DIR / "stats_trees.json").write_text(json.dumps(rep, indent=1, ensure_ascii=False))
    return rep


# --------------------------------------------------------------------------------------------- compare with overall
def load_app_trees(aoi_key: str = OVERALL) -> TreeArrays:
    """Decode the app's sle-trees-v1 chunks of an AOI into global cells (read-only)."""
    from trees import chunk_origin, decode_chunk
    aoi = load_aoi(aoi_key)
    m = json.loads((APP_DATA / aoi_key / "manifest.json").read_text())["trees"]
    parts = []
    for i, j, _n in m["chunks"]:
        g_base, rec = decode_chunk((APP_DATA / aoi_key / "trees" / f"{i}_{j}.bin").read_bytes())
        e_ll, n_ll = chunk_origin(aoi, i, j)
        parts.append(TreeArrays(e_ll + (rec["x"].astype(np.int64) - 5) // 10, n_ll + (rec["y"].astype(np.int64) - 5) // 10,
                                g_base + rec["g"] / 100, rec["h"] / 100, rec["r"] / 10, rec["type"].copy(),
                                np.full(rec.size, np.nan), np.zeros(rec.size, np.uint8)))
    return TreeArrays.concat(parts)


def load_npz(path: Path = ORTE_DIR / "trees.npz") -> TreeArrays:
    from trees import FILL
    z = np.load(path)
    return TreeArrays(np.floor(z["E"]).astype(np.int64), np.floor(z["N"]).astype(np.int64), z["g"].astype(np.float64),
                      z["h"].astype(np.float64), z["r"].astype(np.float64),
                      (z["type"] | np.where(z["fill"], FILL, 0)).astype(np.uint8), np.full(z["E"].size, np.nan),
                      z["state"])


def compare_tiles(a: TreeArrays, b: TreeArrays, box) -> dict:
    """Per 1 km tile counts of two tree sets inside `box` + cell-level match and height distribution (pure)."""
    from trees import FILL

    def clip(t):
        m = (t.e >= box[0]) & (t.e < box[2]) & (t.n >= box[1]) & (t.n < box[3])
        return t.take(m)
    a, b = clip(a), clip(b)
    ta, tb = tile_of(a.e, a.n), tile_of(b.e, b.n)
    codes = sorted(set(np.unique(ta).tolist()) | set(np.unique(tb).tolist()))
    rows = []
    for c in codes:
        na, nb = int((ta == c).sum()), int((tb == c).sum())
        rows.append({"tile": f"{c // 100000}_{c % 100000}", "ref": na, "new": nb,
                     "delta_pct": round(100.0 * (nb - na) / na, 3) if na else None})
    ka, kb = a.e * 100_000_000 + a.n, b.e * 100_000_000 + b.n
    common, ia, ib = np.intersect1d(ka, kb, return_indices=True)
    meas_a = (a.type & FILL) == 0
    pct = (5, 25, 50, 75, 95)
    return {
        "ref_count": int(a.e.size), "new_count": int(b.e.size),
        "delta_pct": round(100.0 * (b.e.size - a.e.size) / max(a.e.size, 1), 3),
        "same_cell": int(common.size), "same_cell_share_of_ref": round(common.size / max(a.e.size, 1), 5),
        "measured_tops_ref": int(meas_a.sum()),
        "measured_tops_same_cell": int(meas_a[ia].sum()),
        "same_cell_h_equal_cm": round(float(np.mean(np.abs(a.h[ia] - b.h[ib]) < 0.006)), 5) if common.size else None,
        "same_cell_r_equal_dm": round(float(np.mean(np.abs(a.r[ia] - b.r[ib]) < 0.06)), 5) if common.size else None,
        "same_cell_type_equal": round(float(np.mean(a.type[ia] == b.type[ib])), 5) if common.size else None,
        "height_pct": {"ref": {q: round(float(np.percentile(a.h, q)), 2) for q in pct} if a.e.size else {},
                       "new": {q: round(float(np.percentile(b.h, q)), 2) for q in pct} if b.e.size else {}},
        "radius_mean": {"ref": round(float(a.r.mean()), 3) if a.e.size else None,
                        "new": round(float(b.r.mean()), 3) if b.e.size else None},
        "types": {k: {"ref": int(((a.type & 0x7F) == v).sum()), "new": int(((b.type & 0x7F) == v).sum())}
                  for k, v in (("unknown", 0), ("conifer", 1), ("broadleaf", 2))},
        "fill": {"ref": int(((a.type & FILL) > 0).sum()), "new": int(((b.type & FILL) > 0).sum())},
        "tiles": rows,
        "tiles_over_2pct": [r for r in rows if r["delta_pct"] is not None and abs(r["delta_pct"]) >= 2.0],
        "max_abs_tile_delta_pct": max((abs(r["delta_pct"]) for r in rows if r["delta_pct"] is not None), default=None),
    }


def dop_check(ts: TileSet, workers: int = 4) -> dict:
    """Colour check on forest tiles inside `overall`: crown type from (a) overall's ortho_1m (what the app uses),
    (b) SL DOP JPEG at 1 m (what the stats area uses outside overall), (c) RLP DOP JPEG at 1 m. Measured tops only
    (their positions/crowns do not depend on colour); conifer fill switched off for the comparison."""
    from trees import TYPE_CODES
    prep = json.loads((ORTE_DIR / "stats_trees_prepare.json").read_text())
    offset = float(prep["rlp_offset"]["applied"])
    app = load_app_trees()
    ov = overall_box()
    codes, cnt = np.unique(tile_of(app.e, app.n), return_counts=True)
    # the 6 tiles with most trees, plus the 3 tiles with the most RLP-filled cells (overall mask 0.5) among the rest
    order = codes[np.argsort(-cnt)]
    check = [(int(c // 100000), int(c % 100000)) for c in order[:6]]
    mask = read_box(WORK_DIR / OVERALL / "mask.tif", ov, fill=0)
    rlp_share = {}
    for c in order[6:40]:
        t = (int(c // 100000), int(c % 100000))
        sl = overlap_slices(ov, tile_box(t))
        rlp_share[t] = float((mask[sl[0]] == 0.5).mean())
    check += [t for t, s in sorted(rlp_share.items(), key=lambda kv: -kv[1])[:3] if s > 0.5]
    fetch_dop([], extra_modes={t: ["sl_jpg", "rlp_jpg"] for t in check})
    out = {"tiles": [f"{e}_{n}" for e, n in check], "variants": {}}
    res = {}
    calib = load_calibration()
    for variant in ("auto", "sl_jpg", "rlp_jpg") + (("rlp_jpg_cal",) if calib else ()):
        cfg = BlockCfg(lidar="mosaic", ortho=variant.replace("_cal", ""), offset=offset, bldg=str(RASTER_DIR / "bldg.tif"),
                       rasters=False, rlp_calib=calib if variant.endswith("_cal") else None)
        blocks = [(tile_box(t), (tile_box(t)[0] - MARGIN, tile_box(t)[1] - MARGIN, tile_box(t)[2] + MARGIN,
                                 tile_box(t)[3] + MARGIN)) for t in check]
        parts = list(run_blocks(blocks, cfg, workers))
        res[variant] = parts
    for variant in [v for v in res if v != "auto"]:
        rows = []
        for ref, new, t in zip(res["auto"], res[variant], check):
            a, b = ref["trees"], new["trees"]
            ma, mb = (a.type & 0x80) == 0, (b.type & 0x80) == 0
            ka, kb = a.e[ma] * 100_000_000 + a.n[ma], b.e[mb] * 100_000_000 + b.n[mb]
            com, ia, ib = np.intersect1d(ka, kb, return_indices=True)
            ta, tb = (a.type[ma] & 0x7F)[ia], (b.type[mb] & 0x7F)[ib]
            ba, bb_ = a.bright[ma][ia], b.bright[mb][ib]
            ok = np.isfinite(ba) & np.isfinite(bb_)
            if ok.sum() < 3:
                rows.append({"tile": f"{t[0]}_{t[1]}", "tops": int(com.size), "note": "no imagery in this variant"})
                continue
            conf = {f"{x}->{y}": int(((ta == vx) & (tb == vy)).sum()) for x, vx in TYPE_CODES.items()
                    for y, vy in TYPE_CODES.items()}
            rows.append({"tile": f"{t[0]}_{t[1]}", "tops": int(com.size), "type_agree": round(float(np.mean(ta == tb)), 4),
                         "bright_ref_mean": round(float(ba[ok].mean()), 2), "bright_new_mean": round(float(bb_[ok].mean()), 2),
                         "bright_new_minus_ref_median": round(float(np.median(bb_[ok] - ba[ok])), 2),
                         "bright_corr": round(float(np.corrcoef(ba[ok], bb_[ok])[0, 1]), 4) if ok.sum() > 2 else None,
                         "share_ref": {k: round(float(np.mean(ta == v)), 4) for k, v in TYPE_CODES.items()},
                         "share_new": {k: round(float(np.mean(tb == v)), 4) for k, v in TYPE_CODES.items()},
                         "confusion": conf})
        rows_ok = [r for r in rows if "type_agree" in r]
        n = sum(r["tops"] for r in rows_ok)
        out["variants"][variant] = {"tiles": rows, "tops_with_imagery": n,
                                    "type_agree": round(sum(r["type_agree"] * r["tops"] for r in rows_ok) / max(n, 1), 4)}
    return out


def run_compare(ts: TileSet, workers: int = 4) -> dict:
    t0 = time.time()
    ov = overall_box()
    from trees import Params
    app = load_app_trees()
    mine = load_npz()
    cap = Params().max_height   # the stats trees keep tops up to STATS_MAX_HEIGHT; compare like with like
    mine = mine.take(mine.h <= cap + 1e-6)
    rep = {"box": list(ov), "app_max_height_applied": cap, "trees": compare_tiles(app, mine, ov)}
    # interior tiles only (≥ 1 tile away from overall's outer edge: the app run had no data beyond its AOI)
    inner = (ov[0] + TILE, ov[1] + TILE, ov[2] - TILE, ov[3] - TILE)
    rep["trees_interior"] = {k: v for k, v in compare_tiles(app, mine, inner).items() if k != "tiles"}
    # building mask vs overall bldg.tif
    ref = read_box(WORK_DIR / OVERALL / "bldg.tif", ov)
    new = read_box(RASTER_DIR / "bldg.tif", ov)
    rep["bldg_mask"] = {"ref_cells": int(ref.sum()), "new_cells": int(new.sum()),
                        "differing_cells": int((ref != new).sum())}
    # CHM vs overall chm.tif (overall clips to 0…40 and does not mask buildings: compare off buildings, CHM < 40)
    ref_chm = read_box(WORK_DIR / OVERALL / "chm.tif", ov, fill=np.nan)
    new_chm = read_box(RASTER_DIR / "chm.tif", ov, fill=np.nan)
    from scipy import ndimage
    near_bldg = ndimage.binary_dilation(ref > 0, structure=np.ones((3, 3), bool))  # trees.smooth_chm zeroes these
    ok = np.isfinite(ref_chm) & np.isfinite(new_chm) & ~near_bldg & (ref_chm < 39.9)
    d = np.abs(np.clip(new_chm[ok], 0, 40) - ref_chm[ok])
    rep["chm"] = {"cells": int(ok.sum()), "max_abs_diff_m": round(float(d.max()), 4),
                  "share_diff_gt_1cm": round(float(np.mean(d > 0.01)), 6)}
    rep["dop_check"] = dop_check(ts, workers)
    rep["seconds"] = round(time.time() - t0, 1)
    (ORTE_DIR / "trees_vs_overall.json").write_text(json.dumps(rep, indent=1))
    return rep


# --------------------------------------------------------------------------------------------- border effect (Q5)
def cell_metrics(chm: np.ndarray, valid: np.ndarray, bldg: np.ndarray, t: TreeArrays, box, cell: int,
                 min_height: float = 3.0) -> dict[str, np.ndarray]:
    """Per `cell` × `cell` m cells of `box` (row 0 = north): valid share, building share, canopy cover (CHM ≥
    min_height among valid cells), p95 CHM, trees (all / measured), sum of crown radii and heights (pure)."""
    from trees import FILL
    H, W = chm.shape
    ny, nx = H // cell, W // cell

    def blocks(a):
        return a[:ny * cell, :nx * cell].reshape(ny, cell, nx, cell).swapaxes(1, 2).reshape(ny, nx, cell * cell)

    v = blocks(valid.astype(bool))
    c = blocks(np.where(valid, chm, np.nan).astype(np.float32))
    canopy = (c >= min_height)
    nvalid = v.sum(-1)
    import warnings
    with np.errstate(invalid="ignore", divide="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)   # cells without valid data → NaN p95
        cover = canopy.sum(-1) / np.maximum(nvalid, 1)
        p95 = np.nanpercentile(c, 95, axis=-1) if nvalid.any() else np.full((ny, nx), np.nan)
    cols = (t.e - box[0]) // cell
    rows = (box[3] - 1 - t.n) // cell
    inb = (cols >= 0) & (cols < nx) & (rows >= 0) & (rows < ny)
    idx = rows[inb] * nx + cols[inb]
    meas = ((t.type & FILL) == 0)[inb]

    def bc(w=None, m=None):
        ii = idx if m is None else idx[m]
        ww = None if w is None else (w if m is None else w[m])
        return np.bincount(ii, weights=ww, minlength=ny * nx).reshape(ny, nx)

    return {"valid": nvalid / (cell * cell), "bldg": blocks(bldg.astype(bool)).mean(-1), "cover": cover,
            "canopy_ha": canopy.sum(-1) / 1e4, "p95": p95,
            "trees": bc(), "measured": bc(m=meas), "r_sum": bc(t.r[inb]), "h_sum": bc(t.h[inb]),
            "conifer": bc(m=((t.type & 0x7F) == 1)[inb]), "broadleaf": bc(m=((t.type & 0x7F) == 2)[inb])}


def summarize(m: dict[str, np.ndarray], sel: np.ndarray) -> dict:
    """Pooled metrics over the selected cells."""
    n = int(sel.sum())
    if not n:
        return {"cells": 0}
    trees, canopy = m["trees"][sel].sum(), m["canopy_ha"][sel].sum()
    return {"cells": n, "trees": int(trees), "measured_tops": int(m["measured"][sel].sum()),
            "trees_per_ha_canopy": round(float(trees / max(canopy, 1e-9)), 1),
            "measured_per_ha_canopy": round(float(m["measured"][sel].sum() / max(canopy, 1e-9)), 1),
            "mean_crown_radius_m": round(float(m["r_sum"][sel].sum() / max(trees, 1)), 3),
            "mean_tree_height_m": round(float(m["h_sum"][sel].sum() / max(trees, 1)), 2),
            "mean_p95_chm_m": round(float(np.nanmean(m["p95"][sel])), 2),
            "canopy_cover": round(float(np.mean(m["cover"][sel])), 4),
            "conifer_share": round(float(m["conifer"][sel].sum() / max(trees, 1)), 4),
            "broadleaf_share": round(float(m["broadleaf"][sel].sum() / max(trees, 1)), 4)}


def paired_ratio(a: dict[str, np.ndarray], b: dict[str, np.ndarray], sel: np.ndarray, rng_seed: int = 1) -> dict:
    """Per-cell paired differences b − a (and ratio of pooled values) with a bootstrap 90 % CI over cells."""
    rng = np.random.default_rng(rng_seed)
    idx = np.flatnonzero(sel.ravel())
    if idx.size < 5:
        return {}

    def pooled(m, ii):
        tr = m["trees"].ravel()[ii].sum()
        return {"trees_per_ha_canopy": tr / max(m["canopy_ha"].ravel()[ii].sum(), 1e-9),
                "mean_crown_radius_m": m["r_sum"].ravel()[ii].sum() / max(tr, 1),
                "mean_tree_height_m": m["h_sum"].ravel()[ii].sum() / max(tr, 1),
                "canopy_cover": m["cover"].ravel()[ii].mean(),
                "mean_p95_chm_m": np.nanmean(m["p95"].ravel()[ii])}

    base_a, base_b = pooled(a, idx), pooled(b, idx)
    boots = []
    for _ in range(300):
        ii = rng.choice(idx, idx.size)
        pa, pb = pooled(a, ii), pooled(b, ii)
        boots.append({k: pb[k] - pa[k] for k in pa})
    out = {}
    for k in base_a:
        d = np.array([x[k] for x in boots])
        out[k] = {"sl": round(float(base_a[k]), 3), "rlp": round(float(base_b[k]), 3),
                  "rlp_minus_sl": round(float(base_b[k] - base_a[k]), 3),
                  "ci90": [round(float(np.percentile(d, 5)), 3), round(float(np.percentile(d, 95)), 3)],
                  "rlp_over_sl": round(float(base_b[k] / base_a[k]), 4) if base_a[k] else None}
    return out


def run_border(ts: TileSet, workers: int = 4, cell: int = 250) -> dict:
    """Q5: (A) paired — the same forest seen by both flights (tiles with SL and RLP DOM1+DGM1, detection run once
    with SL-only and once with RLP-only rasters, same colour + building mask); (B) side by side — forest cells on
    either side of the SL/RLP data boundary in the mosaic the stats use."""
    from trees import Params
    t0 = time.time()
    p = Params()
    prep = json.loads((ORTE_DIR / "stats_trees_prepare.json").read_text())
    offset = float(prep["rlp_offset"]["applied"])
    ov = overall_box()
    dmodes = {t: m for t, m in dop_index().items() if t in set(ts.tile_list) and not inside(tile_box(t), ov)}
    both = [t for t in ts.tile_list if all(t in lidar_paths(pr, [t], "mosaic")[0] and t in lidar_paths(pr, [t], "mosaic")[1]
                                            for pr in ("dgm1", "dom1"))]
    blocks = [(tile_box(t), (tile_box(t)[0] - MARGIN, tile_box(t)[1] - MARGIN, tile_box(t)[2] + MARGIN,
                             tile_box(t)[3] + MARGIN)) for t in both]
    res = {}
    for lidar in ("sl", "rlp"):
        cfg = BlockCfg(lidar=lidar, ortho="auto", offset=offset, bldg=str(RASTER_DIR / "bldg.tif"), dop_modes=dmodes)
        res[lidar] = list(run_blocks(blocks, cfg, workers))
    # (A) paired, per tile → cells; valid = both flights have DSM data (state != NONE in both runs)
    A = {"sl": [], "rlp": []}
    for (core, _w), rs, rr in zip(blocks, res["sl"], res["rlp"]):
        if rs["chm"] is None or rr["chm"] is None:
            continue
        valid = (rs["state"] != STATE_NONE) & (rr["state"] != STATE_NONE)
        bldg = read_box(RASTER_DIR / "bldg.tif", core)
        for k, r_ in (("sl", rs), ("rlp", rr)):
            t = merge_trees([r_["trees"]], p.min_height, p.max_height)
            A[k].append(cell_metrics(r_["chm"], valid, bldg, t, core, cell))
    cat = {k: {f: np.concatenate([m[f].ravel() for m in v]) for f in v[0]} for k, v in A.items()} if A["sl"] else {}
    paired: dict = {"tiles": [f"{e}_{n}" for e, n in both], "cell_m": cell}
    if cat:
        a, b = cat["sl"], cat["rlp"]
        base = (a["valid"] >= 0.99) & (a["bldg"] == 0)
        forest = base & (np.minimum(a["cover"], b["cover"]) >= 0.8)
        stable = forest & (np.abs(b["p95"] - a["p95"]) < 5.0)   # drop harvest / storm / new growth cells
        broad = stable & (a["broadleaf"] >= 0.7 * np.maximum(a["trees"], 1))
        conif = stable & (a["conifer"] >= 0.3 * np.maximum(a["trees"], 1))
        paired.update({
            "rule": f"{cell} m cells fully covered by both flights, no LoD2 building, canopy cover (CHM ≥ 3 m) ≥ 80 % "
                    "in both, |Δ p95 CHM| < 5 m (no harvest/storm); type strata by the SL-run DOP colour",
            "cells_valid": int(base.sum()), "cells_forest": int(forest.sum()), "cells_stable": int(stable.sum()),
            "all_forest": {"sl": summarize(a, stable), "rlp": summarize(b, stable), "diff": paired_ratio(a, b, stable)},
            "broadleaf_cells": {"sl": summarize(a, broad), "rlp": summarize(b, broad), "diff": paired_ratio(a, b, broad)},
            "conifer_cells": {"sl": summarize(a, conif), "rlp": summarize(b, conif), "diff": paired_ratio(a, b, conif)},
            "all_valid_cells": {"sl": summarize(a, base), "rlp": summarize(b, base)},
        })
    # (B) side by side in the stats mosaic: forest cells (cover ≥ 80 %, own flight) within 3 km of the data boundary
    side = side_by_side(ts, cell)
    shares = lidar_share_per_place(ts)
    rep = {"question": "Q5: RLP DOM1/DGM1 2022 vs SL ALS 2025 (leaf-off) — effect on tree detection",
           "method": "sle-trees-v1 (trees.py Params) on both flights; metrics per ha of canopy (CHM ≥ 3 m)",
           "paired_same_forest": paired, "side_by_side": side, "lidar_source_share_per_place": shares,
           "seconds": round(time.time() - t0, 1)}
    rep["summary"] = border_summary(rep)
    (ORTE_DIR / "border_effect.json").write_text(json.dumps(rep, indent=1, ensure_ascii=False))
    return rep


def lidar_share_per_place(ts: TileSet) -> dict:
    """Share of each place outline (cell centres) whose CHM comes from SL 2025 / RLP 2022 / no data (src.tif)."""
    from rasterio.features import rasterize
    from rasterio.transform import from_origin
    from shapely.geometry import shape
    bb = ts.bbox
    src = read_box(RASTER_DIR / "src.tif", bb, fill=STATE_UNFETCHED)
    out = {}
    for f in json.loads(PLACES.read_text())["features"]:
        m = rasterize([(shape(f["geometry"]), 1)], out_shape=src.shape, transform=from_origin(bb[0], bb[3], 1, 1),
                      fill=0, dtype="uint8").astype(bool)
        v = src[m]
        out[f["properties"]["id"]] = {"state": f["properties"].get("state"), "cells": int(m.sum()),
                                      "SL_2025": round(float(np.mean(v == STATE_SL)), 4),
                                      "RLP_2022": round(float(np.mean(v == STATE_RLP)), 4),
                                      "none": round(float(np.mean((v == STATE_NONE) | (v == STATE_UNFETCHED))), 4)}
    return out


def side_by_side(ts: TileSet, cell: int = 250, max_dist_m: float = 3000.0) -> dict:
    from scipy import ndimage
    bb = ts.bbox
    chm = read_box(RASTER_DIR / "chm.tif", bb, fill=np.nan)
    src = read_box(RASTER_DIR / "src.tif", bb, fill=STATE_UNFETCHED)
    bldg = read_box(RASTER_DIR / "bldg.tif", bb)
    t = load_npz()
    out = {}
    ms = {}
    for s, key in ((STATE_SL, "sl"), (STATE_RLP, "rlp")):
        valid = src == s
        tt = t.take(t.state == s)
        ms[key] = cell_metrics(np.nan_to_num(chm), valid, bldg, tt, bb, cell)
    # cell side: majority source; distance to the nearest cell of the other side
    sl_cells = ms["sl"]["valid"] >= 0.99
    rlp_cells = ms["rlp"]["valid"] >= 0.99
    d_to_rlp = ndimage.distance_transform_edt(~rlp_cells) * cell
    d_to_sl = ndimage.distance_transform_edt(~sl_cells) * cell
    for key, own, dist in (("sl", sl_cells, d_to_rlp), ("rlp", rlp_cells, d_to_sl)):
        m = ms[key]
        sel = own & (dist <= max_dist_m) & (m["bldg"] == 0) & (m["cover"] >= 0.8)
        out[key] = summarize(m, sel)
    out["rule"] = (f"{cell} m cells fully in one flight's data, ≤ {max_dist_m / 1000:.0f} km from a cell of the other "
                   "flight, no LoD2 building, canopy cover ≥ 80 % in its own flight (different stands on each side)")
    return out


def _de(x: float, nd: int = 1, sign: bool = True) -> str:
    """German number format with a real minus sign: -0.38 → '−0,4'."""
    t = f"{x:+.{nd}f}" if sign else f"{x:.{nd}f}"
    return t.replace("-", "−").replace(".", ",")


def border_summary(rep: dict) -> dict:
    """Headline numbers of the paired comparison + the text for the 'other-flight' flag."""
    paired = rep["paired_same_forest"]
    pf = paired.get("all_forest", {}).get("diff", {})
    if not pf:
        return {"note": "no paired forest cells"}
    tpc, r, h = pf["trees_per_ha_canopy"], pf["mean_crown_radius_m"], pf["mean_tree_height_m"]
    cov, p95 = pf["canopy_cover"], pf["mean_p95_chm_m"]
    ha = paired["cells_stable"] * paired["cell_m"] ** 2 / 1e4
    effect = (f"Im selben Wald an der Landesgrenze findet die Baumerkennung mit den RLP-Daten "
              f"{_de((tpc['rlp_over_sl'] - 1) * 100, 0)} % Bäume je Hektar Kronenfläche, die Kronen sind im Mittel "
              f"{_de(r['rlp_minus_sl'])} m im Radius, die Bäume {_de(h['rlp_minus_sl'])} m in der Höhe und die "
              f"Kronendeckung {_de(cov['rlp_minus_sl'] * 100, 0)} Prozentpunkte. Baumzahlen sind darum nur "
              f"eingeschränkt mit den Saarland-Orten vergleichbar; Anteile wie die Kronendeckung eher als absolute Zahlen.")
    per_place = {}
    for pid, sh in rep.get("lidar_source_share_per_place", {}).items():
        if sh["RLP_2022"] < 0.01:
            continue
        per_place[pid] = (f"Andere Befliegung: {_de(sh['RLP_2022'] * 100, 0, sign=False)} % der Fläche stammen aus der "
                          f"LiDAR-Befliegung Rheinland-Pfalz 2022, der Rest aus der Saarland-Befliegung 2025. " + effect)
    text_de = "Andere Befliegung: Teile dieses Ortes stammen aus der LiDAR-Befliegung Rheinland-Pfalz 2022 statt " \
              "der Saarland-Befliegung 2025. " + effect
    return {"paired_forest_ha": round(ha, 1),
            "trees_per_ha_canopy_rlp_over_sl": tpc["rlp_over_sl"], "trees_per_ha_canopy_diff_ci90": tpc["ci90"],
            "crown_radius_diff_m": r["rlp_minus_sl"], "tree_height_diff_m": h["rlp_minus_sl"],
            "p95_chm_diff_m": p95["rlp_minus_sl"], "canopy_cover_diff": cov["rlp_minus_sl"],
            "sl_equivalent": {"tree_count_factor": round(1 / tpc["rlp_over_sl"], 4),
                              "canopy_cover_add": round(-cov["rlp_minus_sl"], 4),
                              "note": "optional harmonisation of RLP-2022 places to SL-2025 terms, derived from "
                                      "mostly broadleaf forest at the border; flight and 3 years of change cannot be "
                                      "separated"},
            "interpretation": "The RLP 2022 DOM1 resolves more, smaller crowns in the same stands (more local maxima, "
                              "smaller watershed segments); top height (p95 CHM) is nearly equal, so the lower mean "
                              "tree height comes from the extra small crowns. SL 2025 is newer by 3 years (growth, but "
                              "also 2022+ drought and harvest losses) — the paired cells exclude |Δ p95| ≥ 5 m.",
            "flag_text_de": text_de, "flag_text_de_per_place": per_place}


# --------------------------------------------------------------------------------------------- CLI
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("step", choices=["fetch", "fetch-lidar", "fetch-lod2", "fetch-dop", "prepare", "calibrate", "detect",
                                     "compare", "border", "all"])
    ap.add_argument("--workers", type=int, default=4, help="processes for detection (max 4); downloads use ≤ 3")
    args = ap.parse_args()
    ts = load_tileset()
    ORTE_DIR.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    steps = {"fetch": ["fetch-lidar", "fetch-lod2", "fetch-dop"],
             "all": ["fetch-lidar", "fetch-lod2", "fetch-dop", "prepare", "calibrate", "detect", "compare", "border"]}.get(
        args.step, [args.step])
    ov = overall_box()
    for s in steps:
        print(f"=== {s}", flush=True)
        if s == "fetch-lidar":
            print(json.dumps(fetch_lidar(ts), indent=1))
        elif s == "fetch-lod2":
            print(json.dumps(fetch_lod2(ts)))
        elif s == "fetch-dop":
            print(json.dumps(fetch_dop([t for t in ts.tile_list if not inside(tile_box(t), ov)])))
        elif s == "prepare":
            print(json.dumps(prepare(ts), indent=1))
        elif s == "calibrate":
            print(json.dumps(run_calibrate(ts, args.workers), indent=1))
        elif s == "detect":
            rep = run_detect(ts, args.workers)
            print(json.dumps({k: v for k, v in rep.items() if k not in ("per_tile", "meta")}, indent=1,
                             ensure_ascii=False))
        elif s == "compare":
            rep = run_compare(ts, args.workers)
            print(json.dumps({"trees": {k: v for k, v in rep["trees"].items() if k != "tiles"},
                              **{k: v for k, v in rep.items() if k not in ("trees",)}}, indent=1))
        elif s == "border":
            rep = run_border(ts, args.workers)
            print(json.dumps(rep, indent=1, ensure_ascii=False))
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
