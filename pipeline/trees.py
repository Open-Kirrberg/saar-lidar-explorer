"""V2.4 `trees` layer: one record per tree crown from the canopy height model (contract "Trees", sle-trees-v1).

    uv run python trees.py <aoi> [--workers 4]

Input (work rasters of `build.py`, AOI grid, 1 m, PixelIsArea): `data/work/<aoi>/{dtm,dsm}.tif`; optional
`bldg.tif` (LoD2 footprints, `buildings.py`) and `ortho_1m.tif` (DOP20 at 1 m, `ortho.py`). When the AOI has no
`bldg`/`ortho` work raster of its own, a work raster of another AOI that covers it is window-read (e.g. karlsberg
⊂ overall).

Method (details + plot check in README "Trees"):
1. CHM = DSM − DTM (NaN → 0, clipped to 0…60 m), building cells (bldg dilated by 1 m) set to 0, Gaussian σ.
2. Tree tops = local maxima of the smoothed CHM ≥ `min_height` inside a circular window whose radius grows with
   the height (crown-width model); exact ties are broken by the lower flat index (deterministic).
3. Crowns = marker-controlled watershed on −CHM (per 500 m chunk + apron), limited to CHM ≥ max(2 m,
   `crown_frac` · top height); crown radius = √(area / π).
4. Type from crown colour in the (summer) DOP: conifers are darker; see `classify`.
5. Conifer fill (ADR 0030): oversized conifer crowns are split by k-means into crowns of the expected size; the
   extra trees carry the FILL flag (estimated position, not a measured top).
Output: `trees/{i}_{j}.bin` per level-0 chunk, manifest key `trees`, report `data/work/<aoi>/trees.json`.
v3 places (contract "Many places (v3, S2)", rules 2 + 6): detection runs on the whole rectangle (absent tiles give
the crowns at the border their real neighbourhood), then only trees whose top cell centre lies in a present tile
are kept, i.e. only the present chunks get a file and a `trees.chunks` entry.
"""
from __future__ import annotations

import argparse
import json
import shutil
import struct
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import from_bounds
from scipy import ndimage
from skimage.segmentation import watershed

from common import WORK_DIR, AOI, fmt_bytes, load_aoi, swap_dir, update_manifest

FORMAT = "sle-trees-v1"
METHOD = "chm-lmf-watershed"
METHOD_VERSION = 1
MAGIC = b"SLET"
HEADER = struct.Struct("<4sHHIf")  # magic, version, reserved, count, gBase
RECORD = np.dtype([("x", "<u2"), ("y", "<u2"), ("g", "<u2"), ("h", "<u2"), ("r", "u1"), ("type", "u1")])
TYPE_CODES = {"unknown": 0, "conifer": 1, "broadleaf": 2}
FILL = 0x80  # type flag: fill tree (position estimated inside a merged conifer crown, not a measured top)
TYPE_LABELS_DE = {"unknown": "Baum", "conifer": "Nadelbaum", "broadleaf": "Laubbaum"}
APRON = 24  # m of neighbouring CHM around a chunk for the watershed (crowns ≤ ≈ 12 m radius)
ATTRIBUTION_DOP_SL = "© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (DOP20)"  # = ortho.py


@dataclass(frozen=True)
class Params:
    sigma: float = 0.8            # m, Gaussian smoothing of the CHM
    min_height: float = 3.0       # m, lowest tree top
    max_height: float = 45.0      # m, taller "trees" are pylons, chimneys, cranes, slope artefacts → dropped
    # local-maximum window radius r(h) = clip(r0 + k·h, r_min, r_max) (m); ≈ half the crown width of the
    # Popescu & Wynne (2004) model at the low end, flatter above 20 m where neighbouring crowns touch
    r0: float = 1.2
    k: float = 0.03
    r_min: float = 1.0
    r_max: float = 2.5
    crown_floor: float = 2.0      # m, crowns never reach below this CHM
    crown_frac: float = 0.45      # crown cells have CHM ≥ crown_frac · top height
    r_cap: float = 12.0           # m, crown radius cap
    # conifer fill (ADR 0030): the 1 m DOM cannot resolve conifer tops ≈ 5 m apart, so a conifer crown segment of
    # area A is split into round(A / (π · rc(h)²)) crowns, rc(h) = clip(fc0 + fck·h, fc_min, fc_max); rc(30 m) =
    # 2.5 m ≈ 500 stems/ha, a typical stocking of mature spruce (checked on plot P1, README "Trees")
    fill: bool = True
    fc0: float = 1.0
    fck: float = 0.05
    fc_min: float = 1.5
    fc_max: float = 3.5
    fill_iter: int = 8            # k-means iterations
    # type: mean DOP brightness (R+G+B)/3 over the crown; < dark → conifer, > light → broadleaf, else unknown
    dark: float = 62.0
    light: float = 74.0
    extra: dict = field(default_factory=dict)


# --- geometry helpers ------------------------------------------------------------------------------------------

def window_radius(h: np.ndarray, p: Params) -> np.ndarray:
    return np.clip(p.r0 + p.k * np.asarray(h, dtype=np.float64), p.r_min, p.r_max)


def disk_offsets(r_max: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(dy, dx, dist) of every cell offset within r_max, (0, 0) excluded."""
    n = int(np.floor(r_max))
    dy, dx = np.mgrid[-n:n + 1, -n:n + 1]
    d = np.hypot(dy, dx)
    keep = (d <= r_max + 1e-9) & (d > 0)
    return dy[keep], dx[keep], d[keep]


def smooth_chm(dsm: np.ndarray, dtm: np.ndarray, bldg: np.ndarray | None, p: Params) -> tuple[np.ndarray, np.ndarray]:
    """Raw CHM (0…60 m, buildings 0) and its Gaussian-smoothed copy, both float32."""
    chm = np.nan_to_num(dsm.astype(np.float32) - dtm.astype(np.float32), nan=0.0, posinf=0.0, neginf=0.0)
    np.clip(chm, 0.0, 60.0, out=chm)
    if bldg is not None:
        chm[ndimage.binary_dilation(bldg > 0, structure=np.ones((3, 3), bool))] = 0.0
    sm = ndimage.gaussian_filter(chm, p.sigma, mode="nearest") if p.sigma > 0 else chm.copy()
    return chm, sm.astype(np.float32)


def find_tops(sm: np.ndarray, p: Params) -> tuple[np.ndarray, np.ndarray]:
    """(rows, cols) of tree tops: cells ≥ min_height that beat every cell within window_radius(h).

    A cell beats a neighbour when its value is higher, or equal and its flat index (row·W + col) is lower,
    so plateaus yield exactly one top and the result does not depend on processing order."""
    H, W = sm.shape
    # cheap pre-filter: 3×3 maxima (non-strict) above the height threshold
    cand = (sm >= p.min_height) & (sm >= ndimage.maximum_filter(sm, size=3, mode="nearest"))
    rows, cols = np.nonzero(cand)
    v = sm[rows, cols]
    rad = window_radius(v, p)
    alive = np.ones(rows.size, bool)
    flat = rows.astype(np.int64) * W + cols
    for dy, dx, d in zip(*disk_offsets(p.r_max)):
        use = alive & (d <= rad + 1e-9)
        if not use.any():
            continue
        rr, cc = rows[use] + dy, cols[use] + dx
        inside = (rr >= 0) & (rr < H) & (cc >= 0) & (cc < W)
        idx = np.nonzero(use)[0][inside]
        rr, cc = rr[inside], cc[inside]
        nv = sm[rr, cc]
        lose = (nv > v[idx]) | ((nv == v[idx]) & (rr.astype(np.int64) * W + cc < flat[idx]))
        alive[idx[lose]] = False
    return rows[alive], cols[alive]


def segment_crowns(sm: np.ndarray, rows: np.ndarray, cols: np.ndarray, p: Params) -> np.ndarray:
    """Marker-controlled watershed on −CHM; label k+1 = crown of top k. Cells below max(crown_floor,
    crown_frac · top height of their basin) are cut off afterwards (label 0)."""
    markers = np.zeros(sm.shape, np.int32)
    markers[rows, cols] = np.arange(1, rows.size + 1, dtype=np.int32)
    lab = watershed(-sm, markers, mask=sm >= p.crown_floor)
    top_h = np.concatenate([[np.inf], sm[rows, cols]]).astype(np.float32)
    lab[sm < np.maximum(p.crown_floor, p.crown_frac * top_h[lab])] = 0
    return lab


# --- per-chunk processing --------------------------------------------------------------------------------------

@dataclass
class Trees:
    """Trees of one chunk in AOI cell coordinates (row 0 = north) plus attributes."""
    row: np.ndarray
    col: np.ndarray
    g: np.ndarray       # ground height (m), DTM at the top cell
    h: np.ndarray       # tree height (m)
    r: np.ndarray       # crown radius (m)
    type: np.ndarray    # u8 code
    bright: np.ndarray  # mean DOP brightness over the crown (NaN without DOP)

    @staticmethod
    def empty() -> "Trees":
        z = np.zeros(0)
        return Trees(z.astype(np.int64), z.astype(np.int64), z, z, z, z.astype(np.uint8), z)


def classify(bright: np.ndarray, p: Params) -> np.ndarray:
    t = np.zeros(bright.shape, np.uint8)
    t[bright < p.dark] = TYPE_CODES["conifer"]
    t[bright > p.light] = TYPE_CODES["broadleaf"]
    return t  # NaN (no DOP) compares False → unknown


def chunk_trees(chm: np.ndarray, sm: np.ndarray, dtm: np.ndarray, ortho: np.ndarray | None,
                tops_r: np.ndarray, tops_c: np.ndarray, box: tuple[int, int, int, int], p: Params,
                zero_ortho_nodata: bool = False) -> Trees:
    """Crowns + attributes for the tops inside `box` = (r0, r1, c0, c1) (AOI cells, half-open).
    The watershed runs on the box plus APRON with every top in that window as a marker.
    `zero_ortho_nodata` (v3 places, whose `ortho_1m` work raster is 0 outside the present tiles): RGB (0, 0, 0)
    cells are left out of the crown brightness instead of darkening it (a crown without valid cells → unknown)."""
    r0, r1, c0, c1 = box
    H, W = sm.shape
    wr0, wr1, wc0, wc1 = max(0, r0 - APRON), min(H, r1 + APRON), max(0, c0 - APRON), min(W, c1 + APRON)
    sel = (tops_r >= wr0) & (tops_r < wr1) & (tops_c >= wc0) & (tops_c < wc1)
    tr, tc = tops_r[sel] - wr0, tops_c[sel] - wc0
    own = (tr + wr0 >= r0) & (tr + wr0 < r1) & (tc + wc0 >= c0) & (tc + wc0 < c1)
    if not own.any():
        return Trees.empty()
    win = sm[wr0:wr1, wc0:wc1]
    lab = segment_crowns(win, tr, tc, p)
    n = tr.size
    area = np.bincount(lab.ravel(), minlength=n + 1)[1:].astype(np.float64)
    # the top cell is always in its own crown (it is ≥ the floor by construction), so area ≥ 1
    r = np.minimum(np.sqrt(np.maximum(area, 1.0) / np.pi), p.r_cap)
    raw = chm[wr0:wr1, wc0:wc1]
    h = ndimage.maximum_filter(raw, size=3, mode="nearest")[tr, tc]  # smoothing lowers peaks: use raw 3×3 max
    if ortho is not None:
        ow = ortho[:, wr0:wr1, wc0:wc1]
        o = ow.astype(np.float64).mean(axis=0)
        s = np.bincount(lab.ravel(), weights=o.ravel(), minlength=n + 1)[1:]
        if zero_ortho_nodata:
            valid = ow.any(axis=0).ravel().astype(np.float64)
            cnt = np.bincount(lab.ravel(), weights=valid, minlength=n + 1)[1:]
            with np.errstate(invalid="ignore", divide="ignore"):
                bright = np.where(cnt > 0, s / np.maximum(cnt, 1.0), np.nan)
        else:
            bright = s / np.maximum(area, 1.0)
        bright[area == 0] = np.nan
    else:
        bright = np.full(n, np.nan)
    ty = classify(bright, p)
    k = np.nonzero(own)[0]
    t = Trees(row=tr[k] + wr0, col=tc[k] + wc0, g=dtm[tr[k] + wr0, tc[k] + wc0].astype(np.float64),
              h=h[k].astype(np.float64), r=r[k], type=ty[k], bright=bright[k])
    if p.fill:
        t = fill_conifers(t, lab, k, win, raw, dtm[wr0:wr1, wc0:wc1], (wr0, wc0), p)
    return t


def fill_radius(h: np.ndarray, p: Params) -> np.ndarray:
    return np.clip(p.fc0 + p.fck * np.asarray(h, dtype=np.float64), p.fc_min, p.fc_max)


def split_segment(rr: np.ndarray, cc: np.ndarray, w: np.ndarray, top: int, n: int, iters: int) -> np.ndarray:
    """Deterministic weighted k-means of one crown segment's cells into n clusters; returns the label per cell.
    Seeds: the top cell, then farthest-point sampling (ties → lowest cell index)."""
    pts = np.c_[rr, cc].astype(np.float64)
    seeds = [top]
    dmin = np.hypot(*(pts - pts[top]).T)
    for _ in range(1, n):
        s = int(np.argmax(dmin))
        seeds.append(s)
        dmin = np.minimum(dmin, np.hypot(*(pts - pts[s]).T))
    cen = pts[seeds]
    for _ in range(iters):
        lab = np.argmin(((pts[:, None, :] - cen[None]) ** 2).sum(-1), axis=1)
        ws = np.bincount(lab, weights=w, minlength=n)
        ok = ws > 0
        for d in range(2):
            cen[ok, d] = np.bincount(lab, weights=w * pts[:, d], minlength=n)[ok] / ws[ok]
    return np.argmin(((pts[:, None, :] - cen[None]) ** 2).sum(-1), axis=1)


def fill_conifers(t: Trees, lab: np.ndarray, k: np.ndarray, sm: np.ndarray, raw: np.ndarray, dtm: np.ndarray,
                  off: tuple[int, int], p: Params) -> Trees:
    """Split oversized conifer crowns (the 1 m DOM merges conifer tops ≈ 5 m apart) into
    round(area / (π · fill_radius(h)²)) crowns. The measured top keeps its crown part; every other part becomes a
    *fill* tree (type | FILL) at its centroid cell. Fill trees may lie outside the chunk; `run` re-bins them."""
    flat = lab.ravel()
    order = np.argsort(flat, kind="stable")
    ends = np.cumsum(np.bincount(flat, minlength=int(flat.max()) + 1))
    starts = np.r_[0, ends[:-1]]
    W = lab.shape[1]
    hmax = ndimage.maximum_filter(raw, size=3, mode="nearest")
    add = {f: [] for f in ("row", "col", "g", "h", "r", "type", "bright")}
    r_new = t.r.copy()
    for m in np.nonzero(t.type == TYPE_CODES["conifer"])[0]:
        segid = int(k[m]) + 1
        cells = order[starts[segid]:ends[segid]]
        n = int(np.round(cells.size / (np.pi * fill_radius(t.h[m], p) ** 2)))
        if n < 2:
            continue
        rr, cc = cells // W, cells % W
        top = int(np.nonzero((rr == t.row[m] - off[0]) & (cc == t.col[m] - off[1]))[0][0])
        cl = split_segment(rr, cc, sm[rr, cc].astype(np.float64), top, n, p.fill_iter)
        sizes = np.bincount(cl, minlength=n)
        r_new[m] = min(np.sqrt(sizes[cl[top]] / np.pi), p.r_cap)
        for q in range(n):
            if q == cl[top] or sizes[q] == 0:
                continue
            # position: the cluster cell nearest its CHM-weighted centroid (the highest cell sits on the border
            # towards the measured top, which would pair trees ≈ 1 m apart); height: the cluster's highest cell
            idx = np.nonzero(cl == q)[0]
            w = sm[rr[idx], cc[idx]].astype(np.float64)
            cy, cx = (w @ rr[idx]) / w.sum(), (w @ cc[idx]) / w.sum()
            best = idx[np.argmin((rr[idx] - cy) ** 2 + (cc[idx] - cx) ** 2)]  # argmin → first, cells in flat order
            r0, c0 = int(rr[best]), int(cc[best])
            add["row"].append(r0 + off[0]); add["col"].append(c0 + off[1])
            add["g"].append(float(dtm[r0, c0])); add["h"].append(float(hmax[rr[idx], cc[idx]].max()))
            add["r"].append(min(np.sqrt(sizes[q] / np.pi), p.r_cap))
            add["type"].append(t.type[m] | FILL); add["bright"].append(t.bright[m])
    if not add["row"]:
        return t
    cat = {f: np.concatenate([getattr(t, f) if f != "r" else r_new, np.asarray(v, dtype=getattr(t, f).dtype)])
           for f, v in add.items()}
    return Trees(**cat)


# --- ids, ordering, encoding -----------------------------------------------------------------------------------

def tree_ids(e_cell: np.ndarray, n_cell: np.ndarray) -> np.ndarray:
    """Stable u32 id from the integer EPSG:25832 coordinates of the top cell's lower-left corner:
    `(E mod 65536) << 16 | (N mod 65536)` — unique within any 65 km square, independent of the AOI."""
    return ((np.asarray(e_cell, np.uint64) % 65536) << 16 | (np.asarray(n_cell, np.uint64) % 65536)).astype(np.uint32)


def fmix32(x: np.ndarray) -> np.ndarray:
    """MurmurHash3 finalizer (bijective on u32); the renderer uses the same function for LOD ranks."""
    h = np.asarray(x, np.uint32).astype(np.uint64)
    h ^= h >> 16
    h = (h * 0x85EBCA6B) & 0xFFFFFFFF
    h ^= h >> 13
    h = (h * 0xC2B2AE35) & 0xFFFFFFFF
    h ^= h >> 16
    return h.astype(np.uint32)


def encode_chunk(x_dm: np.ndarray, y_dm: np.ndarray, g_m: np.ndarray, h_m: np.ndarray, r_m: np.ndarray,
                 types: np.ndarray, ids: np.ndarray) -> tuple[bytes, float]:
    """Header + records sorted by fmix32(id) ascending. Returns (bytes, gBase)."""
    n = int(np.asarray(x_dm).size)
    g_base = float(np.floor(np.min(g_m) * 100) / 100) if n else 0.0
    rec = np.zeros(n, RECORD)
    rec["x"] = np.asarray(x_dm)
    rec["y"] = np.asarray(y_dm)
    rec["g"] = np.clip(np.round((np.asarray(g_m) - g_base) * 100), 0, 65535)
    rec["h"] = np.clip(np.round(np.asarray(h_m) * 100), 0, 65535)
    rec["r"] = np.clip(np.round(np.asarray(r_m) * 10), 1, 255)
    rec["type"] = np.asarray(types)
    order = np.argsort(fmix32(ids), kind="stable")
    return HEADER.pack(MAGIC, 1, 0, n, np.float32(g_base)) + rec[order].tobytes(), g_base


def decode_chunk(buf: bytes) -> tuple[float, np.ndarray]:
    magic, version, _res, n, g_base = HEADER.unpack_from(buf, 0)
    if magic != MAGIC or version != 1 or len(buf) != HEADER.size + RECORD.itemsize * n:
        raise ValueError("not a sle-trees-v1 chunk")
    return float(g_base), np.frombuffer(buf, RECORD, count=n, offset=HEADER.size)


def chunk_origin(aoi: AOI, i: int, j: int) -> tuple[int, int]:
    """Lower-left (E, N) of level-0 chunk (i, j) (j counts south from the north edge)."""
    cs = aoi.chunk_size
    return aoi.e0 + i * cs, aoi.n0 + aoi.height - (j + 1) * cs


def records_for(aoi: AOI, i: int, j: int, t: Trees) -> tuple[np.ndarray, ...]:
    """Chunk-local decimetre offsets + ids of the trees of chunk (i, j). Tops sit at cell centres."""
    e_ll, n_ll = chunk_origin(aoi, i, j)
    e_cell = aoi.e0 + t.col                    # lower-left corner of the top cell
    n_cell = aoi.n0 + aoi.height - t.row - 1
    x_dm = (e_cell - e_ll) * 10 + 5
    y_dm = (n_cell - n_ll) * 10 + 5
    return x_dm, y_dm, tree_ids(e_cell, n_cell)


# --- I/O ---------------------------------------------------------------------------------------------------------

def read_covering(aoi: AOI, name: str, bands=None) -> tuple[np.ndarray | None, str | None]:
    """Work raster `name.tif` of this AOI, else window-read from another AOI's work raster that covers it."""
    own = WORK_DIR / aoi.key / f"{name}.tif"
    paths = [own] + sorted(p for p in WORK_DIR.glob(f"*/{name}.tif") if p != own)
    for path in paths:
        if not path.exists():
            continue
        with rasterio.open(path) as ds:
            b = ds.bounds
            if b.left > aoi.e0 or b.bottom > aoi.n0 or b.right < aoi.e1 or b.top < aoi.n1 or ds.res != (1.0, 1.0):
                continue
            win = from_bounds(aoi.e0, aoi.n0, aoi.e1, aoi.n1, ds.transform).round_offsets().round_lengths()
            arr = ds.read(bands, window=win) if bands else ds.read(1, window=win)
            return arr, path.parent.name
    return None, None


def read_ortho(aoi: AOI) -> tuple[np.ndarray | None, str | None, bool]:
    """RGB (3, H, W) u8 of the AOI from the `ortho_1m.tif` work rasters, plus the source names and whether cells are
    missing. A 4-band raster (v3 places: band 4 = alpha, 0 = tile not present in that place, RGB black there)
    contributes only its alpha > 0 cells; the remaining cells are filled from the next covering raster (own AOI
    first, then the others as in `read_covering`). Cells no raster fills stay (0, 0, 0) and the third value is
    True, so `chunk_trees` must treat black as no data (`zero_ortho_nodata`). A 3-band own raster gives exactly the
    old result."""
    own = WORK_DIR / aoi.key / "ortho_1m.tif"
    paths = [own] + sorted(p for p in WORK_DIR.glob("*/ortho_1m.tif") if p != own)
    out, need, srcs = None, None, []
    for path in paths:
        if not path.exists():
            continue
        with rasterio.open(path) as ds:
            b = ds.bounds
            if b.left > aoi.e0 or b.bottom > aoi.n0 or b.right < aoi.e1 or b.top < aoi.n1 or ds.res != (1.0, 1.0) \
                    or ds.count < 3:
                continue
            win = from_bounds(aoi.e0, aoi.n0, aoi.e1, aoi.n1, ds.transform).round_offsets().round_lengths()
            rgb = ds.read([1, 2, 3], window=win)
            valid = ds.read(4, window=win) > 0 if ds.count >= 4 else np.ones(rgb.shape[1:], bool)
        if out is None:
            if valid.all():
                return rgb, path.parent.name, False
            out, need = np.zeros_like(rgb), np.ones(rgb.shape[1:], bool)
        take = need & valid
        if take.any():
            out[:, take] = rgb[:, take]
            need &= ~take
            srcs.append(path.parent.name)
        if not need.any():
            break
    if not srcs:
        return None, None, False
    return out, "+".join(srcs), bool(need.any())


def _take(t: Trees, m) -> Trees:
    return Trees(*(getattr(t, f)[m] for f in Trees.__dataclass_fields__))


def detect(dsm: np.ndarray, dtm: np.ndarray, bldg: np.ndarray | None, ortho: np.ndarray | None, aoi: AOI,
           p: Params, workers: int = 4, timings: dict | None = None, zero_ortho_nodata: bool = False
           ) -> dict[tuple[int, int], Trees]:
    """Pure core: AOI rasters (row 0 = north) → trees per level-0 chunk (i, j), binned by the top cell.
    Every chunk of the rectangle is processed (a v3 place filters afterwards with `own_chunks`, so fill trees of a
    top in an absent tile that land in a present one are kept, see `fill_conifers`)."""
    timings = {} if timings is None else timings
    t1 = time.time()
    chm, sm = smooth_chm(dsm, dtm, bldg, p)
    tops_r, tops_c = find_tops(sm, p)
    timings["tops"] = round(time.time() - t1, 1)

    t1 = time.time()
    cs = aoi.chunk_size
    nx, ny = aoi.width // cs, aoi.height // cs
    jobs = [(i, j) for j in range(ny) for i in range(nx)]

    def one(ij):
        i, j = ij
        return chunk_trees(chm, sm, dtm, ortho, tops_r, tops_c, (j * cs, (j + 1) * cs, i * cs, (i + 1) * cs), p,
                           zero_ortho_nodata)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        parts = list(ex.map(one, jobs))
    alltr = Trees(*(np.concatenate([getattr(t, f) for t in parts]) for f in Trees.__dataclass_fields__))
    # one tree per cell: chunk windows overlap, so two fill trees (never a measured top) can share a cell
    cell = alltr.row.astype(np.int64) * aoi.width + alltr.col
    pref = np.lexsort(((alltr.type & FILL) > 0, cell))
    keep = np.sort(pref[np.r_[True, cell[pref][1:] != cell[pref][:-1]]])
    keep = keep[(alltr.h[keep] >= p.min_height) & (alltr.h[keep] <= p.max_height)]
    alltr = _take(alltr, keep)
    # re-bin by the tree cell's chunk (fill trees may lie in a neighbouring chunk of their measured top)
    key = (alltr.row // cs) * nx + alltr.col // cs
    results = {(int(kk % nx), int(kk // nx)): _take(alltr, key == kk) for kk in np.unique(key)}
    timings["crowns"] = round(time.time() - t1, 1)
    return results


def own_chunks(aoi: AOI, results: dict[tuple[int, int], Trees]) -> dict[tuple[int, int], Trees]:
    """Contract rule 6 (v3): a place keeps the trees whose top cell centre lies in a present tile. Trees are binned
    by the chunk of their cell and a level-0 chunk lies in exactly one tile, so this keeps the present chunks.
    v1/v2 rectangle AOIs keep everything."""
    if not aoi.is_place:
        return results
    return {k: t for k, t in results.items() if aoi.chunk_present(*k)}


def published_area_ha(aoi: AOI) -> float:
    """Area the trees are published for: the rectangle, or the present tiles of a v3 place (1 km² = 100 ha each)."""
    return len(aoi.owned) * 100.0 if aoi.is_place else aoi.width * aoi.height / 1e4


def encode_all(aoi: AOI, results: dict[tuple[int, int], Trees]) -> dict[tuple[int, int], bytes]:
    """Chunk files in (j, i) order; empty chunks are left out."""
    out = {}
    for (i, j), t in sorted(results.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        if t.row.size:
            x_dm, y_dm, ids = records_for(aoi, i, j, t)
            out[(i, j)] = encode_chunk(x_dm, y_dm, t.g, t.h, t.r, t.type, ids)[0]
    return out


def run(aoi: AOI, p: Params, workers: int = 4) -> dict:
    t0 = time.time()
    work = WORK_DIR / aoi.key
    with rasterio.open(work / "dtm.tif") as ds:
        dtm = ds.read(1)
    with rasterio.open(work / "dsm.tif") as ds:
        dsm = ds.read(1)
    assert dtm.shape == (aoi.height, aoi.width), dtm.shape
    bldg, bldg_src = read_covering(aoi, "bldg")
    ortho, ortho_src, ortho_gaps = read_ortho(aoi)
    timings = {"read": round(time.time() - t0, 1)}

    results = detect(dsm, dtm, bldg, ortho, aoi, p, workers, timings, zero_ortho_nodata=aoi.is_place or ortho_gaps)
    del dsm
    n_all = sum(int(t.row.size) for t in results.values())
    results = own_chunks(aoi, results)
    if aoi.is_place:
        n_own = sum(int(t.row.size) for t in results.values())
        print(f"v3 place: {n_own} of {n_all} trees have the top cell in one of the {len(aoi.owned)} present tiles")

    aoi_dir = aoi.data_dir
    staging = aoi_dir / ".trees.staging"
    if staging.exists():
        shutil.rmtree(staging)
    (staging / "trees").mkdir(parents=True)
    chunks, nbytes = [], 0
    for (i, j), buf in encode_all(aoi, results).items():
        (staging / "trees" / f"{i}_{j}.bin").write_bytes(buf)
        nbytes += len(buf)
        chunks.append([i, j, int(results[(i, j)].row.size)])
    all_t = [results[(i, j)] for i, j, _ in chunks]
    swap_dir(staging / "trees", aoi_dir / "trees")
    shutil.rmtree(staging, ignore_errors=True)

    h = np.concatenate([t.h for t in all_t]) if all_t else np.zeros(0)
    r = np.concatenate([t.r for t in all_t]) if all_t else np.zeros(0)
    ty = np.concatenate([t.type for t in all_t]) if all_t else np.zeros(0, np.uint8)
    rows = np.concatenate([t.row for t in all_t]) if all_t else np.zeros(0, int)
    cols = np.concatenate([t.col for t in all_t]) if all_t else np.zeros(0, int)
    count = int(h.size)
    counts = {k: int(((ty & 0x7F) == c).sum()) for k, c in TYPE_CODES.items()}
    n_fill = int(((ty & FILL) > 0).sum())
    bounds = ([int(aoi.e0 + cols.min()), int(aoi.n0 + aoi.height - rows.max() - 1),
               int(aoi.e0 + cols.max() + 1), int(aoi.n0 + aoi.height - rows.min())] if count else None)
    entry = {
        "format": FORMAT,
        "path": "trees/{i}_{j}.bin",
        "crs": "EPSG:25832",
        "chunks": chunks,
        "count": count,
        "counts": counts,
        "fill": n_fill,
        "bounds": bounds,
        "heightRange": {"min": round(float(h.min()), 2), "max": round(float(h.max()), 2)} if count else None,
        "crownRadiusRange": {"min": round(float(r.min()), 1), "max": round(float(r.max()), 1)} if count else None,
        "types": TYPE_LABELS_DE,
        "fillFlag": FILL,
        "method": METHOD,
        "version": METHOD_VERSION,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "params": {k: v for k, v in asdict(p).items() if k != "extra"},
        "inputs": {"chm": "DOM1 − DGM1 (ALS 2025, leaf-off)", "bldg": bldg_src, "ortho": ortho_src},
        "label_de": "Bäume (aus Kronenhöhenmodell)",
    }
    attribution = [ATTRIBUTION_DOP_SL] if ortho is not None else []
    update_manifest(aoi_dir, {"trees": entry}, attribution=attribution)
    timings["total"] = round(time.time() - t0, 1)
    area_ha = published_area_ha(aoi)
    report = {"aoi": aoi.key, "count": count, "counts": counts, "fill": n_fill, "chunks": len(chunks), "bytes": nbytes,
              "size": fmt_bytes(nbytes), "per_ha": round(count / area_ha, 1),
              "height_pct": {q: round(float(np.percentile(h, q)), 1) for q in (5, 50, 95)} if count else {},
              "radius_pct": {q: round(float(np.percentile(r, q)), 1) for q in (5, 50, 95)} if count else {},
              "inputs": entry["inputs"], "params": entry["params"], "timingsS": timings}
    (work / "trees.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("aoi")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()
    report = run(load_aoi(args.aoi), Params(), workers=args.workers)
    print(json.dumps({k: report[k] for k in ("count", "counts", "fill", "chunks", "size", "per_ha", "timingsS")}, indent=1))


if __name__ == "__main__":
    main()
