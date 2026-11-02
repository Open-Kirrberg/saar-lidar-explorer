"""F21 3D-Druck: printable terrain tiles (3MF, optional STL) on a global UTM grid, from the 1 m DGM.

Usage:
  uv run python print3d.py --series saarpfalz-8500 --tiles E380_N5460 E382_N5460
  uv run python print3d.py --series saarpfalz-8500 --bbox 378000 5460000 384000 5468000
  uv run python print3d.py --series saarpfalz-8500 --aoi overall          # bbox of an AOI in aois.toml
  uv run python print3d.py --series detail-2125 --set karlsberg --set merburg   # named sets in print3d.toml
  uv run python print3d.py --series detail-2125 --tiles E383_N5466 --datum 290   # ad-hoc tile, per-set datum
  uv run python print3d.py --series saarpfalz-8500 --layout-only          # rebuild index summary + layout.png
  options: --no-fetch (cached tiles only) --stl (also write STL, ≈ 100 MB per tile) --out DIR --list

Series are defined in print3d.toml. Every tile of a series lies on the series' global grid (lower-left E, N ≡
origin mod tile_m) and is computed only from the raw 1 km DGM tiles (LVGL-SL 2025, RLP 2022 fill with a constant
offset) — never from an AOI mosaic — so two tiles of one series join seamlessly no matter when or where they were
generated. Missing source tiles are fetched with fetch.py's helpers (SL county ZIP range requests, RLP downloads);
missing data fails loudly instead of being invented.

Height sampling (docs/data-contract.md "3D print tiles"): the DGM is PixelIsArea, cell (k, l) covers
[k, k+1) × [l, l+1) m with its centre at +0.5 m. Vertex (i, j) of a tile sits at E0 + i·tile_m/(V−1),
N0 + j·tile_m/(V−1) — exactly on the tile boundary at i, j ∈ {0, V−1} — and its height is the area-weighted mean
of the DGM over the axis-aligned square of side `cell` = tile_m/(V−1) centred on the vertex. For cell = 2 m that is
the plain mean of the 2 × 2 cells around the integer vertex position; for cell = 0.5 m it equals bilinear
interpolation of the cell centres. The weights depend only on global coordinates and are summed in a fixed order,
so a shared edge is bit-identical in both neighbours.

Datum: a series either has one datum_m for all tiles (datum_mode "series", e.g. the 2 km main series) or a local
datum per named set (datum_mode "set": floor(min h of the set) − datum_margin_m, frozen in index.json
`setDatum_m` once written, so regenerated / extended / nested sets keep it). Tiles only join with tiles of the same
series AND the same datum (`datum_m` per tile entry).

Printer: by default (printer = "stock") the tile must slice with the STOCK Bambu Lab P1S 0.4 profile: square
≤ 238 mm (plate 256 mm minus the 18 mm wide front-left exclusion area), placed right of that area and behind the
start-G-code load line. printer = "sle-250" (250 mm tiles) needs the user preset print3d.py writes.

Mesh (mm, X = east, Y = north, Z up, origin = tile lower-left corner at z = 0): triangulated top surface
(no decimation), four vertical walls, flat bottom with bowtie key recesses (2 per edge) and an engraved,
mirrored label; watertight, 2-manifold, outward normals (checked for every tile).
"""
from __future__ import annotations

import argparse
import io
import json
import math
import os
import re
import sys
import time
import tomllib
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from common import APP_DATA, ATTRIBUTION_RLP, ATTRIBUTION_SL, PIPELINE_DIR, SL_RAW, load_aoi, sl_name

CONFIG_PATH = PIPELINE_DIR / "print3d.toml"
PRINT_DIR = APP_DATA / "print"
FORMAT = "sle-print3d-v1"
SL_COUNTIES = ("SPK", "NK", "SB", "WND", "SLS", "MZG")  # research/01: LVGL open-data ZIP per Landkreis
PREVIEW_H_M = (220.0, 420.0)   # fixed colour range for previews (same colours on every tile)
PREVIEW_PX = 512
DISCLAIMER_DE = "Geländemodell zum Anschauen (Hypothesen, keine Befunde). Schauen, nicht graben."
FILAMENT_FORMULA = ("solid = V·ρ; typical = ρ·(S + infill·(V − S)) with S = min(V, A·shell_mm) "
                    "(A = mesh surface, shell ≈ 3 walls × 0.4 mm, also standing in for top/bottom skins); ±25 %")


# ============================================================================ config
@dataclass(frozen=True)
class Connectors:
    enabled: bool = True
    positions: tuple[float, ...] = (0.25, 0.75)
    depth_mm: float = 2.0
    length_mm: float = 10.0
    waist_mm: float = 8.0
    end_mm: float = 14.0
    clearance_mm: float = 0.15
    min_base_mm: float = 2.0


@dataclass(frozen=True)
class Series:
    key: str
    name_de: str
    scale: int
    tile_m: int
    tile_mm: float = 250.0
    vertices: int = 1001
    exag: float = 2.0
    datum_m: float | None = 180.0     # None ⇔ datum_mode "set"
    base_mm: float = 4.0
    datum_mode: str = "series"        # "series": datum_m for every tile; "set": local datum per named set
    datum_margin_m: float = 5.0       # set datum = floor(min h of the set) − margin
    printer: str = "stock"            # "stock" (Bambu P1S stock profile) | "sle-250" (user preset, 250 mm tiles)
    role: str = "main"                # "main" | "detail" (catalog hint for the app)
    origin: tuple[int, int] = (0, 0)
    rlp_offset_m: float = -0.07
    counties: tuple[str, ...] = ("SPK",)
    max_height_mm: float = 250.0
    text: bool = True
    engrave_mm: float = 0.6
    material_density_g_cm3: float = 1.24
    shell_mm: float = 1.2
    infill: float = 0.15
    connectors: Connectors = field(default_factory=Connectors)
    sets: dict = field(default_factory=dict, compare=False, hash=False)

    @property
    def cell_m(self) -> float:
        return self.tile_m / (self.vertices - 1)

    @property
    def cell_mm(self) -> float:
        return self.tile_mm / (self.vertices - 1)

    @property
    def placement_mm(self) -> tuple[float, float]:
        return plate_placement(self.tile_mm, self.printer)


def check_series(s: Series) -> None:
    """Raise ValueError for inconsistent series parameters."""
    if abs(s.tile_m * 1000.0 / s.scale - s.tile_mm) > 1e-6:
        raise ValueError(f"{s.key}: tile_m/scale·1000 = {s.tile_m * 1000 / s.scale} mm ≠ tile_mm {s.tile_mm}")
    if s.datum_mode not in ("series", "set"):
        raise ValueError(f"{s.key}: datum_mode must be 'series' or 'set'")
    if (s.datum_mode == "series") != (s.datum_m is not None):
        raise ValueError(f"{s.key}: datum_m must be set for datum_mode 'series' and None for 'set'")
    if s.datum_margin_m < 0:
        raise ValueError(f"{s.key}: datum_margin_m must be ≥ 0")
    if s.vertices < 3:
        raise ValueError(f"{s.key}: vertices must be ≥ 3")
    if s.exag <= 0 or s.base_mm <= 0:
        raise ValueError(f"{s.key}: exag and base_mm must be > 0")
    c = s.connectors
    if c.enabled:
        if s.base_mm - c.depth_mm < c.min_base_mm - 1e-9:
            raise ValueError(f"{s.key}: base_mm {s.base_mm} − recess depth {c.depth_mm} < min_base_mm {c.min_base_mm}")
        if not (c.waist_mm < c.end_mm and c.clearance_mm * 2 < c.waist_mm and c.clearance_mm < c.depth_mm):
            raise ValueError(f"{s.key}: bowtie needs waist < end, clearance < waist/2 and < depth")
        # positions are measured from the global west (S/N sides) or south (W/E sides) corner on every side, so
        # neighbours match for any list; a recess must stay clear of the adjacent side's recesses (corner) and of
        # the other recesses on its own side
        corner = c.end_mm / 2 + c.length_mm + 1.0
        us = sorted(p * s.tile_mm for p in c.positions)
        for p in c.positions:
            if not (corner < p * s.tile_mm < s.tile_mm - corner):
                raise ValueError(f"{s.key}: connector position {p} too close to a corner")
        if any(b - a < c.end_mm + 2.0 for a, b in zip(us, us[1:])):
            raise ValueError(f"{s.key}: connector positions {list(c.positions)} too close to each other")
    plate_placement(s.tile_mm, s.printer, s.key)        # raises if the tile does not fit that printer setup
    if s.max_height_mm > PRINTABLE_HEIGHT_MM:
        raise ValueError(f"{s.key}: max_height_mm {s.max_height_mm} > printable height {PRINTABLE_HEIGHT_MM} mm")
    if s.text and not (0 < s.engrave_mm < s.base_mm):
        raise ValueError(f"{s.key}: engrave_mm must be in (0, base_mm)")


def load_series(key: str, path: Path = CONFIG_PATH) -> Series:
    cfg = tomllib.loads(path.read_text())
    allser = cfg.get("series", {})
    if key not in allser:
        raise SystemExit(f"unknown series {key!r}; known: {', '.join(allser)}")
    d = {**cfg.get("defaults", {}), **allser[key]}
    conn = {**cfg.get("defaults", {}).get("connectors", {}), **allser[key].get("connectors", {})}
    scale, tile_m = int(d["scale"]), int(d["tile_m"])
    mode = str(d.get("datum_mode", "series"))
    s = Series(
        key=key, name_de=d.get("name_de", key), scale=scale, tile_m=tile_m,
        tile_mm=float(d.get("tile_mm", tile_m * 1000.0 / scale)),       # derived; optional explicit check value
        vertices=int(d.get("vertices", 1001)), exag=float(d.get("exag", 2.0)),
        datum_m=float(d.get("datum_m", 180.0)) if mode == "series" else None, base_mm=float(d.get("base_mm", 4.0)),
        datum_mode=mode, datum_margin_m=float(d.get("datum_margin_m", 5.0)),
        printer=str(d.get("printer", "stock")), role=str(d.get("role", "main")),
        origin=tuple(int(v) for v in d.get("origin", (0, 0))), rlp_offset_m=float(d.get("rlp_offset_m", -0.07)),
        counties=tuple(d.get("counties", ("SPK",))), max_height_mm=float(d.get("max_height_mm", 250.0)),
        text=bool(d.get("text", True)), engrave_mm=float(d.get("engrave_mm", 0.6)),
        material_density_g_cm3=float(d.get("material_density_g_cm3", 1.24)), shell_mm=float(d.get("shell_mm", 1.2)),
        infill=float(d.get("infill", 0.15)),
        connectors=Connectors(enabled=bool(conn.get("enabled", True)),
                              positions=tuple(float(p) for p in conn.get("positions", (0.25, 0.75))),
                              **{k: float(conn[k]) for k in ("depth_mm", "length_mm", "waist_mm", "end_mm",
                                                             "clearance_mm", "min_base_mm") if k in conn}),
        sets=dict(allser[key].get("sets", {})),
    )
    try:
        check_series(s)
    except ValueError as e:
        raise SystemExit(str(e))
    return s


def list_series(path: Path = CONFIG_PATH) -> list[str]:
    return list(tomllib.loads(path.read_text()).get("series", {}))


# ============================================================================ tile ids / grid
def km_str(m: int) -> str:
    s = f"{Decimal(m) / 1000:f}"
    return s.rstrip("0").rstrip(".") if "." in s else s


def tile_id(e0: int, n0: int) -> str:
    """'E380_N5460' (lower-left corner in km; decimals only when needed: 'E382.5_N5465.5')."""
    return f"E{km_str(e0)}_N{km_str(n0)}"


ID_RE = re.compile(r"^E(\d{1,4}(?:\.\d{1,3})?)_N(\d{1,5}(?:\.\d{1,3})?)$")


def parse_tile_id(tid: str, series: Series | None = None) -> tuple[int, int]:
    """'E380_N5460' → (380000, 5460000); checks the series grid when given."""
    m = ID_RE.match(tid.strip())
    if not m:
        raise ValueError(f"bad tile id {tid!r} (expected e.g. E380_N5460 or E382.5_N5466)")
    try:
        e0, n0 = (Decimal(g) * 1000 for g in m.groups())
    except InvalidOperation as ex:
        raise ValueError(f"bad tile id {tid!r}") from ex
    if e0 != int(e0) or n0 != int(n0):
        raise ValueError(f"bad tile id {tid!r}: not whole metres")
    e0, n0 = int(e0), int(n0)
    if series is not None:
        oe, on = series.origin
        if (e0 - oe) % series.tile_m or (n0 - on) % series.tile_m:
            ge = oe + (e0 - oe) // series.tile_m * series.tile_m
            gn = on + (n0 - on) // series.tile_m * series.tile_m
            raise ValueError(f"{tid} is not on the {series.key} grid ({series.tile_m} m); "
                             f"the tile containing that corner is {tile_id(ge, gn)}")
    return e0, n0


def tiles_in_bbox(series: Series, e0: float, n0: float, e1: float, n1: float) -> list[tuple[int, int]]:
    """Grid tiles (lower-left corners) overlapping the open box, row-major from south-west."""
    t, (oe, on) = series.tile_m, series.origin
    return [(oe + i * t, on + j * t)
            for j in range(math.floor((n0 - on) / t), math.ceil((n1 - on) / t))
            for i in range(math.floor((e0 - oe) / t), math.ceil((e1 - oe) / t))]


# ============================================================================ sampling
def vertex_coords(start: int, tile_m: int, n: int) -> np.ndarray:
    """n vertex positions incl. both edges; exact at start and start + tile_m."""
    return start + (np.arange(n, dtype=np.float64) * tile_m) / (n - 1)


def axis_weights(coords: np.ndarray, w: float) -> tuple[np.ndarray, np.ndarray]:
    """1-D box-filter weights of width w centred on each coordinate over 1 m cells [k, k+1).

    Returns (cells, weights), both (n, K) with K = ceil(w) + 1; cells are global integer cell edges. The weights
    depend only on the global coordinate, so neighbouring tiles get identical weights for shared vertices."""
    lo, hi = coords - w / 2, coords + w / 2
    cells = np.floor(lo).astype(np.int64)[:, None] + np.arange(int(math.ceil(w)) + 1)
    wts = np.clip(np.minimum(cells + 1, hi[:, None]) - np.maximum(cells, lo[:, None]), 0.0, None) / w
    return cells, wts


def source_box(cx, wx, cy, wy) -> tuple[int, int, int, int]:
    """(E0, N0, E1, N1) integer box of all 1 m cells with a non-zero weight."""
    ux, uy = cx[wx > 0], cy[wy > 0]
    return int(ux.min()), int(uy.min()), int(ux.max()) + 1, int(uy.max()) + 1


def resample(dem: np.ndarray, box, cx, wx, cy, wy) -> tuple[np.ndarray, np.ndarray]:
    """Area-weighted vertex heights. dem: (N1−N0, E1−E0) row 0 = north over `box`, NaN = no data.

    Returns (h, missing) with shape (ny, nx), row 0 = SOUTH (vertex j), missing = a used cell had no data."""
    be0, bn0, be1, bn1 = box
    H, W = dem.shape
    assert (H, W) == (bn1 - bn0, be1 - be0), (dem.shape, box)
    nanm = ~np.isfinite(dem)
    d = np.where(nanm, 0.0, dem.astype(np.float64))
    m = nanm.astype(np.float64)
    cols = np.clip(cx - be0, 0, W - 1)          # zero-weight cells may lie outside the box → any finite value
    rows = np.clip(bn1 - 1 - cy, 0, H - 1)
    h = np.zeros((cy.shape[0], cx.shape[0]))
    miss = np.zeros_like(h)
    for a in range(cy.shape[1]):                # fixed summation order → bit-identical shared edges
        ra, ma = d[rows[:, a]], m[rows[:, a]]
        for b in range(cx.shape[1]):
            wab = wy[:, a, None] * wx[None, :, b]
            h += wab * ra[:, cols[:, b]]
            miss += wab * ma[:, cols[:, b]]
    return h, miss > 0


def z_from_h(h: np.ndarray, s: Series, datum_m: float | None = None) -> tuple[np.ndarray, int]:
    """z_mm = base + (max(h, datum) − datum) / scale · 1000 · exag; returns (z, number of clamped vertices).

    datum_m: the tile's datum (required for datum_mode "set"; defaults to the series datum)."""
    d = s.datum_m if datum_m is None else datum_m
    if d is None:
        raise ValueError(f"{s.key}: datum_mode 'set' needs the tile's datum")
    clamped = int(np.count_nonzero(h < d))
    return s.base_mm + (np.maximum(h, d) - d) / s.scale * 1000.0 * s.exag, clamped


def set_datum(h_min: float, margin_m: float) -> float:
    """Local datum of a set: whole metres below the lowest vertex of the set, minus the margin."""
    return float(math.floor(h_min) - margin_m)


# ============================================================================ source DGM
class _TileSet:
    """Duck-typed AOI for fetch.fetch_sl / fetch.fetch_rlp (they only use .tiles() and .county)."""

    def __init__(self, tiles, county: str = "SPK"):
        self._tiles, self.county, self.key = sorted(set(tiles)), county, "print3d"

    def tiles(self, buffered: bool = True):
        return list(self._tiles)


def _known_missing(county: str) -> set[str]:
    f = SL_RAW / f"_not_in_zip_{county}.json"
    return set(json.loads(f.read_text())) if f.exists() else set()


def km_tiles(box) -> list[tuple[int, int]]:
    be0, bn0, be1, bn1 = box
    return [(e, n) for n in range(bn0 // 1000, (bn1 - 1) // 1000 + 1) for e in range(be0 // 1000, (be1 - 1) // 1000 + 1)]


def _tiles_with_nan(a: np.ndarray, box, tiles) -> list[tuple[int, int]]:
    be0, bn0, be1, bn1 = box
    out = []
    for e, n in tiles:
        r0, r1 = max(0, bn1 - (n + 1) * 1000), min(a.shape[0], bn1 - n * 1000)
        c0, c1 = max(0, e * 1000 - be0), min(a.shape[1], (e + 1) * 1000 - be0)
        if r0 < r1 and c0 < c1 and not np.isfinite(a[r0:r1, c0:c1]).all():
            out.append((e, n))
    return out


def load_dgm(box, s: Series, fetch: bool = True) -> tuple[np.ndarray, dict]:
    """1 m DGM over `box` from the raw 1 km tiles: SL 2025 first, RLP 2022 + rlp_offset_m where SL has no data.

    Fetches missing tiles when allowed; exits with a clear message if any cell still has no data."""
    import build                 # heavy imports (rvt) only when real data is read
    import fetch as fetch_mod

    tiles = km_tiles(box)
    tried: list[str] = []

    def try_sl(todo, counties):
        for c in counties:
            if c in tried:
                continue
            tried.append(c)
            km = _known_missing(c)
            need = [t for t in todo if not (SL_RAW / sl_name("dgm1", *t)).exists() and sl_name("dgm1", *t) not in km]
            if need and fetch:
                print(f"  fetch SL dgm1 {c}: {len(need)} tile(s)", flush=True)
                fetch_mod.fetch_sl(_TileSet(need, c), ["dgm1"])

    try_sl(tiles, s.counties)
    rlp_fetched: set = set()
    for attempt in range(2):
        sl_p, _ = build.tile_paths("dgm1", tiles)
        dem, _ = build.read_mosaic(sl_p, box) if sl_p else (np.full((box[3] - box[1], box[2] - box[0]), np.nan,
                                                                      np.float32), [])
        dem = dem.astype(np.float64)
        gaps = _tiles_with_nan(dem, box, tiles)
        info = {"sl": [f"{e}_{n}" for e, n in sorted(sl_p)], "rlp": [], "rlpCells": 0, "rlpBiasMeasured_m": None}
        if gaps:
            _, rlp_p = build.tile_paths("dgm1", gaps)
            need = [t for t in gaps if t not in rlp_p and t not in rlp_fetched]
            if need and fetch:
                print(f"  fetch RLP dgm1: {len(need)} tile(s)", flush=True)
                fetch_mod.fetch_rlp(_TileSet(need), ["dgm1"])
                rlp_fetched.update(need)
                _, rlp_p = build.tile_paths("dgm1", gaps)
            if rlp_p:
                rlp, _ = build.read_mosaic(rlp_p, box)
                rlp = rlp.astype(np.float64)
                bias = build.rlp_offset(dem, rlp)
                use = ~np.isfinite(dem) & np.isfinite(rlp)
                dem = np.where(use, rlp + s.rlp_offset_m, dem)
                info.update(rlp=[f"{e}_{n}" for e, n in sorted(rlp_p)], rlpCells=int(use.sum()),
                            rlpBiasMeasured_m=bias.get("median_sl_minus_rlp_m"))
        still = _tiles_with_nan(dem, box, tiles)
        if not still:
            return dem, info
        if attempt == 0 and fetch:
            before = {t for t in still if (SL_RAW / sl_name("dgm1", *t)).exists()}
            try_sl(still, [c for c in SL_COUNTIES if c not in tried])     # county lookup for non-SPK tiles
            if {t for t in still if (SL_RAW / sl_name("dgm1", *t)).exists()} != before:
                continue
        break
    nan_cells = int((~np.isfinite(dem)).sum())
    names = ", ".join(f"{e}_{n}" for e, n in still)
    raise SystemExit(
        f"no DGM data for {nan_cells} cells of box {box} in 1 km tile(s) {names}.\n"
        f"  SL counties tried: {', '.join(tried) or '-'}; RLP {'listing checked' if fetch else 'cache only (--no-fetch)'}.\n"
        "  The tile probably lies outside Saarland + RLP open data (e.g. France), or a download failed. "
        "Nothing is invented — pick another tile or add a source.")


# ============================================================================ stroke font (engraving)
_G = {  # 4 × 6 unit box, y up; each glyph = list of polylines
    "0": [[(0, 0), (4, 0), (4, 6), (0, 6), (0, 0), (4, 6)]],
    "1": [[(1, 5), (2, 6), (2, 0)], [(1, 0), (3, 0)]],
    "2": [[(0, 6), (4, 6), (4, 3), (0, 3), (0, 0), (4, 0)]],
    "3": [[(0, 6), (4, 6), (4, 0), (0, 0)], [(1, 3), (4, 3)]],
    "4": [[(0, 6), (0, 3), (4, 3)], [(4, 6), (4, 0)]],
    "5": [[(4, 6), (0, 6), (0, 4), (3, 4), (4, 3), (4, 1), (3, 0), (0, 0)]],
    "6": [[(4, 6), (0, 6), (0, 0), (4, 0), (4, 3), (0, 3)]],
    "7": [[(0, 6), (4, 6), (1, 0)]],
    "8": [[(0, 0), (4, 0), (4, 3), (0, 3), (0, 0)], [(0.5, 3), (0.5, 6), (3.5, 6), (3.5, 3)]],
    "9": [[(4, 3), (0, 3), (0, 6), (4, 6), (4, 0), (0, 0)]],
    "A": [[(0, 0), (0, 4), (2, 6), (4, 4), (4, 0)], [(0, 3), (4, 3)]],
    "B": [[(0, 0), (0, 6), (3, 6), (4, 5), (4, 4), (3, 3), (0, 3)], [(3, 3), (4, 2), (4, 1), (3, 0), (0, 0)]],
    "C": [[(4, 6), (0, 6), (0, 0), (4, 0)]],
    "D": [[(0, 0), (0, 6), (2, 6), (4, 4), (4, 2), (2, 0), (0, 0)]],
    "E": [[(4, 6), (0, 6), (0, 0), (4, 0)], [(0, 3), (3, 3)]],
    "F": [[(4, 6), (0, 6), (0, 0)], [(0, 3), (3, 3)]],
    "G": [[(4, 6), (0, 6), (0, 0), (4, 0), (4, 3), (2, 3)]],
    "H": [[(0, 0), (0, 6)], [(4, 0), (4, 6)], [(0, 3), (4, 3)]],
    "I": [[(1, 6), (3, 6)], [(2, 6), (2, 0)], [(1, 0), (3, 0)]],
    "J": [[(4, 6), (4, 0), (0, 0), (0, 2)]],
    "K": [[(0, 0), (0, 6)], [(4, 6), (0, 3), (4, 0)]],
    "L": [[(0, 6), (0, 0), (4, 0)]],
    "M": [[(0, 0), (0, 6), (2, 3), (4, 6), (4, 0)]],
    "N": [[(0, 0), (0, 6), (4, 0), (4, 6)]],
    "O": [[(0, 0), (4, 0), (4, 6), (0, 6), (0, 0)]],
    "P": [[(0, 0), (0, 6), (4, 6), (4, 3), (0, 3)]],
    "Q": [[(0, 0), (4, 0), (4, 6), (0, 6), (0, 0)], [(2, 2), (4, 0)]],
    "R": [[(0, 0), (0, 6), (4, 6), (4, 3), (0, 3), (4, 0)]],
    "S": [[(4, 6), (0, 6), (0, 3), (4, 3), (4, 0), (0, 0)]],
    "T": [[(0, 6), (4, 6)], [(2, 6), (2, 0)]],
    "U": [[(0, 6), (0, 0), (4, 0), (4, 6)]],
    "V": [[(0, 6), (2, 0), (4, 6)]],
    "W": [[(0, 6), (1, 0), (2, 3), (3, 0), (4, 6)]],
    "X": [[(0, 0), (4, 6)], [(0, 6), (4, 0)]],
    "Y": [[(0, 6), (2, 3), (4, 6)], [(2, 3), (2, 0)]],
    "Z": [[(0, 6), (4, 6), (0, 0), (4, 0)]],
    "-": [[(1, 3), (3, 3)]],
    "_": [[(0, 0), (4, 0)]],
    ".": [[(1.9, 0), (2.1, 0)]],
    ":": [[(1.9, 1), (2.1, 1)], [(1.9, 5), (2.1, 5)]],
    "/": [[(0, 0), (4, 6)]],
    "=": [[(0, 2), (4, 2)], [(0, 4), (4, 4)]],
    "↑": [[(2, 0), (2, 6)], [(0, 4), (2, 6), (4, 4)]],
    " ": [],
}


def text_geometry(lines: list[tuple[str, float]], size_mm: float, mirror: bool = True):
    """Engraving outline (shapely, oriented) for centred text lines [(text, cap height mm)].

    mirror=True lays the text out mirrored in X, so it reads correctly after turning the tile over about its
    north–south axis (X → −X); north stays up, so the '↑' still points north."""
    from shapely.geometry import LineString, MultiPolygon, Polygon
    from shapely.geometry.polygon import orient
    from shapely.ops import unary_union

    f = size_mm / 250.0
    gaps = [0.55 * h * f for _, h in lines]
    total = sum(h * f for _, h in lines) + sum(gaps[:-1])
    y = size_mm / 2 + total / 2
    strokes = []
    for (txt, h), gap in zip(lines, gaps):
        h *= f
        u = h / 6.0
        width = max(0.0, len(txt) * 6 * u - 2 * u)
        x0 = size_mm / 2 - width / 2
        y -= h
        sw = max(0.8, 0.13 * h)
        for k, ch in enumerate(txt.upper()):
            for pl in _G.get(ch, []):
                pts = [(x0 + (k * 6 + px) * u, y + py * u) for px, py in pl]
                if mirror:
                    pts = [(size_mm - px, py) for px, py in pts]
                strokes.append(LineString(pts).buffer(sw / 2, quad_segs=2))
        y -= gap
    # clean union artefacts that would break the mesh: sliver/narrow holes, holes touching the outline,
    # duplicate and (near-)collinear ring points (would give T-junctions or slivers)
    g = unary_union(strokes).simplify(0.005, preserve_topology=True)
    polys = [g] if g.geom_type == "Polygon" else list(getattr(g, "geoms", []))
    out = []
    for p in polys:
        if p.is_empty or p.area < 0.05:
            continue
        holes = [_clean_ring(r.coords) for r in p.interiors
                 if not Polygon(r).buffer(-0.15).is_empty and r.distance(p.exterior) > 0.1]
        q = Polygon(_clean_ring(p.exterior.coords), [h for h in holes if len(h) >= 3])
        if not q.is_valid:
            q = Polygon(_clean_ring(p.exterior.coords))
        out.append(orient(q, 1.0))
    return MultiPolygon(out)


def _clean_ring(coords, eps: float = 1e-6) -> list[tuple[float, float]]:
    """Ring without closing point, consecutive duplicates or points with |cross| < eps (mm²)."""
    pts = [(float(x), float(y)) for x, y in list(coords)[:-1]]
    changed = True
    while changed and len(pts) > 3:
        changed = False
        k = 0
        while k < len(pts) and len(pts) > 3:
            (ax, ay), (bx, by), (cx, cy) = pts[k - 1], pts[k], pts[(k + 1) % len(pts)]
            if abs((bx - ax) * (cy - by) - (by - ay) * (cx - bx)) < eps or (ax, ay) == (bx, by):
                pts.pop(k)
                changed = True
            else:
                k += 1
    return pts


def label_lines(s: Series, tid: str, datum_m: float | None = None) -> list[tuple[str, float]]:
    d = s.datum_m if datum_m is None else datum_m
    return [("N↑", 16.0), (tid.replace("_", " "), 13.0), (s.key, 6.5),
            (f"1:{s.scale}  Z {s.exag:g}X", 6.0), (f"BASIS {d:g} M = {s.base_mm:g} MM", 5.0)]


# ============================================================================ mesh
def _signed_area(ring) -> float:
    r = np.asarray(ring, np.float64)
    x, y = r[:, 0], r[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y))


def triangulate(rings: list) -> tuple[np.ndarray, np.ndarray]:
    """Triangulate a polygon (exterior + holes, rings without closing point) → (pts (m, 2), tris (k, 3)).

    GEOS constrained Delaunay: unlike earcut it keeps every ring vertex (collinear ones included) and copes with
    hole edges collinear with the outline, so neighbouring faces share their edges exactly (no T-junctions)."""
    import shapely
    pts = np.vstack([np.asarray(r, np.float64) for r in rings])
    lookup = {(float(x), float(y)): k for k, (x, y) in enumerate(pts)}
    if len(lookup) != len(pts):
        raise RuntimeError("duplicate ring vertices")
    tr = shapely.constrained_delaunay_triangles(shapely.Polygon(rings[0], rings[1:]))
    c = shapely.get_coordinates(shapely.get_parts(tr)).reshape(-1, 4, 2)[:, :3]
    try:
        tri = np.array([[lookup[(float(x), float(y))] for x, y in t] for t in c], np.int64).reshape(-1, 3)
    except KeyError as e:
        raise RuntimeError(f"triangulation introduced a new vertex {e}") from None
    a, b = pts[tri[:, 1]] - pts[tri[:, 0]], pts[tri[:, 2]] - pts[tri[:, 0]]
    got = 0.5 * np.abs(a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0]).sum()
    want = abs(_signed_area(rings[0])) - sum(abs(_signed_area(r)) for r in rings[1:])
    if abs(got - want) > 1e-6 * max(1.0, want) or len(np.unique(tri)) != len(pts):
        raise RuntimeError(f"triangulation failed (area {got:.6f} vs {want:.6f})")
    return pts, tri


class MeshBuilder:
    """Collects triangles; vertices beyond the base grid are welded by exact coordinates."""

    def __init__(self, base: np.ndarray | None = None):
        self.base = np.zeros((0, 3)) if base is None else base
        self.reg: dict = {}
        self.extra: list = []
        self.parts: list = []

    def vid(self, x, y, z) -> int:
        key = (float(x), float(y), float(z))
        i = self.reg.get(key)
        if i is None:
            i = self.reg[key] = len(self.base) + len(self.extra)
            self.extra.append(key)
        return i

    def add(self, tris, desired=None):
        """desired: normal direction (3,) or (k, 3) the faces must point to; None = already correct."""
        self.parts.append((np.asarray(tris, np.int64).reshape(-1, 3), desired))

    def hpoly(self, rings, z, desired):
        pts, tri = triangulate(rings)
        ids = np.array([self.vid(x, y, z) for x, y in pts], np.int64)
        self.add(ids[tri], desired)

    def vwalls(self, ring, z0, z1, closed=True, skip=(), sign=1.0):
        """Vertical quads along ring segments; normal = sign · left of the segment direction."""
        tris, des = [], []
        nseg = len(ring) if closed else len(ring) - 1
        for k in range(nseg):
            if k in skip:
                continue
            (px, py), (qx, qy) = ring[k], ring[(k + 1) % len(ring)]
            a, b = self.vid(px, py, z0), self.vid(qx, qy, z0)
            c, d = self.vid(qx, qy, z1), self.vid(px, py, z1)
            tris += [(a, b, c), (a, c, d)]
            n = (-(qy - py) * sign, (qx - px) * sign, 0.0)
            des += [n, n]
        if tris:
            self.add(tris, np.array(des))

    def finish(self) -> tuple[np.ndarray, np.ndarray]:
        V = np.vstack([self.base, np.array(self.extra, np.float64).reshape(-1, 3)])
        out = []
        for t, d in self.parts:
            if d is not None:
                p = V[t]
                nrm = np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0])
                flip = (nrm * np.asarray(d, np.float64)).sum(-1) < 0
                t = t.copy()
                t[flip] = t[flip][:, [0, 2, 1]]
            out.append(t)
        return V, np.vstack(out)


def _sides(W: float):
    """(P0, tangent t, inward normal) per side, walked counter-clockwise from the south-west corner."""
    return [((0.0, 0.0), (1.0, 0.0), (0.0, 1.0)), ((W, 0.0), (0.0, 1.0), (-1.0, 0.0)),
            ((W, W), (-1.0, 0.0), (0.0, -1.0)), ((0.0, W), (0.0, -1.0), (1.0, 0.0))]


def recess_polygons(W: float, c: Connectors) -> list[list[list[tuple[float, float]]]]:
    """Per side (S, E, N, W): list of half-bowtie recesses [A, B, C, D] in order of increasing u along the side.

    A position `frac` is measured from the west corner on the S and N sides (x = frac·W) and from the south corner
    on the W and E sides (y = frac·W) — never along the counter-clockwise walk — so the recesses of two neighbours
    face each other for any (also asymmetric) position list. A/D lie on the tile edge (neck, width waist_mm),
    B/C inside at length_mm (width end_mm)."""
    out = []
    for k, ((px, py), (tx, ty), (nx, ny)) in enumerate(_sides(W)):
        side = []
        if c.enabled:
            # S, E walk with increasing x / y; N, W walk back towards the west / south corner
            for u in sorted(frac * W if k < 2 else W - frac * W for frac in c.positions):

                def P(du, v):
                    return (px + (u + du) * tx + v * nx, py + (u + du) * ty + v * ny)
                side.append([P(-c.waist_mm / 2, 0.0), P(-c.end_mm / 2, c.length_mm),
                             P(c.end_mm / 2, c.length_mm), P(c.waist_mm / 2, 0.0)])
        out.append(side)
    return out


def build_tile_mesh(z: np.ndarray, size_mm: float, conn: Connectors, text=None, engrave_mm: float = 0.6):
    """Watertight tile mesh. z: (n, n) top heights in mm, z[j, i] with j = north index (row 0 = south).

    text: oriented shapely MultiPolygon of the engraving (bottom-face coordinates), or None."""
    n = z.shape[0]
    assert z.shape == (n, n) and float(z.min()) > (conn.depth_mm if conn.enabled else 0.0) + 1e-9
    W = float(size_mm)
    g = (np.arange(n, dtype=np.float64) * W) / (n - 1)
    X, Y = np.meshgrid(g, g)
    base = np.column_stack([X.ravel(), Y.ravel(), np.asarray(z, np.float64).ravel()])
    mb = MeshBuilder(base)
    # top surface, two triangles per cell, counter-clockwise seen from above → +Z
    idx = np.arange(n * n).reshape(n, n)
    v00, v10, v01, v11 = idx[:-1, :-1], idx[:-1, 1:], idx[1:, :-1], idx[1:, 1:]
    mb.add(np.concatenate([np.stack([v00, v10, v11], -1).reshape(-1, 3),
                           np.stack([v00, v11, v01], -1).reshape(-1, 3)]))
    rec = recess_polygons(W, conn)
    d = conn.depth_mm
    tops = [idx[0, :], idx[:, -1], idx[-1, ::-1], idx[::-1, 0]]   # grid vertices along each side, CCW order
    bottom_ring = []
    for (p0, t, nin), top_ids, side_rec in zip(_sides(W), tops, rec):
        p1 = (p0[0] + W * t[0], p0[1] + W * t[1])
        bottom_ring.append(p0)
        for A, B, C, D in side_rec:
            bottom_ring += [A, B, C, D]
        # wall polygon in (u, z): top profile u = 0 → W, then the bottom back with the notches
        u_top = (base[top_ids, 0] - p0[0]) * t[0] + (base[top_ids, 1] - p0[1]) * t[1]
        ring2 = [(u, zz) for u, zz in zip(u_top, base[top_ids, 2])]
        b3 = [(p1[0], p1[1], 0.0)]
        for A, B, C, D in reversed(side_rec):
            b3 += [(D[0], D[1], 0.0), (D[0], D[1], d), (A[0], A[1], d), (A[0], A[1], 0.0)]
        b3.append((p0[0], p0[1], 0.0))
        ring2 += [((x - p0[0]) * t[0] + (y - p0[1]) * t[1], zz) for x, y, zz in b3]
        _, tri = triangulate([ring2])
        ids = np.concatenate([top_ids, [mb.vid(*p) for p in b3]])
        mb.add(ids[tri], (-nin[0], -nin[1], 0.0))
        for ring in side_rec:  # recess: ceiling at z = depth (faces down into the void) + 3 inner walls
            mb.hpoly([ring], d, (0.0, 0.0, -1.0))
            ccw = ring if _signed_area(ring) > 0 else ring[::-1]
            k_open = next(k for k in range(4) if {ccw[k], ccw[(k + 1) % 4]} == {ring[0], ring[3]})
            mb.vwalls(ccw, 0.0, d, skip=(k_open,), sign=1.0)
    holes = []
    if text is not None and not text.is_empty:
        for poly in text.geoms:
            ext = list(poly.exterior.coords)[:-1]
            ints = [list(r.coords)[:-1] for r in poly.interiors]
            holes.append(ext)
            mb.hpoly([ext] + ints, engrave_mm, (0.0, 0.0, -1.0))   # pocket ceiling
            for r in [ext] + ints:                                  # oriented: pocket is left of every ring
                mb.vwalls(r, 0.0, engrave_mm, sign=1.0)
            for r in ints:                                          # islands (inside O, 8, …) stay bottom face
                mb.hpoly([r], 0.0, (0.0, 0.0, -1.0))
    mb.hpoly([bottom_ring] + holes, 0.0, (0.0, 0.0, -1.0))
    return mb.finish()


def check_text_clearance(text, W: float, conn: Connectors, margin: float = 3.0) -> None:
    from shapely.geometry import Polygon, box
    from shapely.ops import unary_union
    if text is None or text.is_empty:
        return
    inner = box(margin, margin, W - margin, W - margin)
    rec = unary_union([Polygon(r) for side in recess_polygons(W, conn) for r in side])
    if not inner.contains(text) or (not rec.is_empty and text.distance(rec) < margin):
        raise ValueError("engraving collides with the tile border or a key recess")


def bowtie_key(c: Connectors):
    """Key outline (shapely Polygon, centred on the joint, long axis = X) = two recesses shrunk by clearance."""
    from shapely.geometry import Polygon
    L, wn, we = c.length_mm, c.waist_mm / 2, c.end_mm / 2
    full = Polygon([(-L, -we), (0, -wn), (L, -we), (L, we), (0, wn), (-L, we)])
    return full.buffer(-c.clearance_mm, join_style="mitre")


def key_mesh(c: Connectors) -> tuple[np.ndarray, np.ndarray]:
    from shapely.geometry.polygon import orient
    poly = orient(bowtie_key(c), 1.0)
    ring = list(poly.exterior.coords)[:-1]
    t = c.depth_mm - c.clearance_mm
    mb = MeshBuilder()
    mb.hpoly([ring], 0.0, (0.0, 0.0, -1.0))
    mb.hpoly([ring], t, (0.0, 0.0, 1.0))
    mb.vwalls(ring, 0.0, t, sign=-1.0)   # solid inside → outward = right of a CCW ring
    V, F = mb.finish()
    V[:, :2] -= V[:, :2].min(axis=0)     # lower-left at origin
    return V, F


def mesh_check(F: np.ndarray) -> dict:
    """2-manifold + consistently oriented + closed: every directed edge once, its reverse exactly once."""
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]).astype(np.int64)
    N = int(F.max()) + 1
    code, rev = e[:, 0] * N + e[:, 1], e[:, 1] * N + e[:, 0]
    s = np.sort(code)
    dup = int(np.count_nonzero(s[1:] == s[:-1]))
    unmatched = int(np.count_nonzero(~np.isin(rev, s, assume_unique=False)))
    degenerate = int(np.count_nonzero((F[:, 0] == F[:, 1]) | (F[:, 1] == F[:, 2]) | (F[:, 0] == F[:, 2])))
    return {"watertight": dup == 0 and unmatched == 0 and degenerate == 0, "duplicateEdges": dup,
            "openEdges": unmatched, "degenerate": degenerate}


def mesh_stats(V: np.ndarray, F: np.ndarray) -> tuple[float, float]:
    """(signed volume mm³ — positive = outward normals, surface area mm²)."""
    p = V[F]
    cr = np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0])
    vol = float(np.einsum("ij,ij->i", p[:, 0], np.cross(p[:, 1], p[:, 2])).sum() / 6.0)
    return vol, float(0.5 * np.linalg.norm(cr, axis=1).sum())


def filament_g(vol_mm3: float, area_mm2: float, s: Series) -> tuple[float, float]:
    rho = s.material_density_g_cm3 / 1000.0
    shell = min(vol_mm3, area_mm2 * s.shell_mm)
    return vol_mm3 * rho, (shell + s.infill * (vol_mm3 - shell)) * rho


# ============================================================================ writers
def write_stl(path: Path, V: np.ndarray, F: np.ndarray, name: str = "") -> None:
    p = V[F].astype(np.float32)
    nrm = np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0])
    ln = np.linalg.norm(nrm, axis=1, keepdims=True)
    nrm = np.divide(nrm, ln, out=np.zeros_like(nrm), where=ln > 0)
    rec = np.zeros(len(F), dtype=[("n", "<f4", (3,)), ("v", "<f4", (3, 3)), ("a", "<u2")])
    rec["n"], rec["v"] = nrm, p
    head = f"SLE print3d {name} mm".encode("ascii", "replace")[:80].ljust(80, b" ")
    tmp = path.with_suffix(".stl.part")
    with open(tmp, "wb") as f:
        f.write(head)
        f.write(np.uint32(len(F)).tobytes())
        f.write(rec.tobytes())
    os.replace(tmp, path)


def read_stl(path: Path) -> np.ndarray:
    """Binary STL → (k, 3, 3) float32 triangles (tests)."""
    b = path.read_bytes()
    k = int(np.frombuffer(b, "<u4", 1, 80)[0])
    rec = np.frombuffer(b, dtype=[("n", "<f4", (3,)), ("v", "<f4", (3, 3)), ("a", "<u2")], count=k, offset=84)
    return rec["v"]


def _xml(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def write_3mf(path: Path, V: np.ndarray, F: np.ndarray, name: str, meta: dict,
              place_mm: tuple[float, float] | None = None) -> None:
    """Minimal 3MF core package (unit millimeter), one object. Its lower-left corner goes to `place_mm` on the
    plate (tiles: PLACEMENT_MM, clear of the patched load line), else it is centred on the 256 mm plate."""
    buf = io.BytesIO()
    buf.write(b'<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" '
              b'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n')
    for k, v in meta.items():
        buf.write(f' <metadata name="{_xml(k)}">{_xml(str(v))}</metadata>\n'.encode())
    buf.write(f' <resources>\n  <object id="1" type="model" name="{_xml(name)}">\n   <mesh>\n    <vertices>\n'
              .encode())
    np.savetxt(buf, V, fmt='     <vertex x="%.4f" y="%.4f" z="%.4f"/>')
    buf.write(b"    </vertices>\n    <triangles>\n")
    np.savetxt(buf, F, fmt='     <triangle v1="%d" v2="%d" v3="%d"/>')
    ext = V.max(axis=0) - V.min(axis=0)
    px, py = place_mm if place_mm is not None else ((PLATE_MM[0] - ext[0]) / 2, (PLATE_MM[1] - ext[1]) / 2)
    tx, ty = px - V[:, 0].min(), py - V[:, 1].min()
    buf.write(f'    </triangles>\n   </mesh>\n  </object>\n </resources>\n <build>\n'
              f'  <item objectid="1" transform="1 0 0 0 1 0 0 0 1 {tx:.4f} {ty:.4f} 0"/>\n </build>\n</model>\n'
              .encode())
    ctypes = ('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/'
              '2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.'
              'relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.'
              '3dmanufacturing-3dmodel+xml"/></Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/'
            '2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/'
            '3dmanufacturing/2013/01/3dmodel"/></Relationships>')
    tmp = path.with_suffix(".3mf.part")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        z.writestr("[Content_Types].xml", ctypes)
        z.writestr("_rels/.rels", rels)
        z.writestr("3D/3dmodel.model", buf.getvalue())
    os.replace(tmp, path)


def preview_png(path: Path, h: np.ndarray, z: np.ndarray, cell_mm: float, px: int = PREVIEW_PX) -> None:
    """Shaded relief (NW light on the printed exaggeration) × fixed hypsometric tint; north up."""
    from matplotlib import colormaps
    zz = z[::-1]                                    # row 0 = north
    gy, gx = np.gradient(zz, cell_mm)
    gy = -gy                                         # rows run south → d/dN = −d/drow
    az, el = math.radians(315), math.radians(45)
    lx, ly, lz = math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el)
    hs = np.clip((-gx * lx - gy * ly + lz) / np.sqrt(1 + gx ** 2 + gy ** 2), 0, 1)
    v = np.clip((h[::-1] - PREVIEW_H_M[0]) / (PREVIEW_H_M[1] - PREVIEW_H_M[0]), 0, 1)
    col = colormaps["terrain"](0.25 + 0.7 * v)[..., :3]
    rgb = np.clip(col * (0.25 + 0.85 * hs[..., None]), 0, 1)
    Image.fromarray(np.rint(rgb * 255).astype(np.uint8)).resize((px, px), Image.LANCZOS).save(path, optimize=True)


def _font(size: int):
    """DejaVu Sans from matplotlib (has umlauts and ×), else Pillow's default font."""
    try:
        import matplotlib
        return ImageFont.truetype(str(Path(matplotlib.get_data_path()) / "fonts/ttf/DejaVuSans.ttf"), size)
    except Exception:
        return ImageFont.load_default(size=size)


def layout_blocks(tiles: list[dict], tile_m: int, sets: dict | None = None,
                  series_datum: float | None = None) -> list[dict]:
    """Group tiles into edge-connected blocks (what is physically laid out together), each with its own grid.

    Returns [{e0, n0, nx, ny, tiles, sets, datum_m}] ordered west → east, then north → south; `sets` = names of the
    named sets (id lists) whose generated tiles all lie in the block. Neighbours with a different `datum_m` (per-set
    datum series) do not join and end up in different blocks; entries without `datum_m` (written before
    2026-11-02) use `series_datum`."""
    by = {tuple(t["bboxUTM"][:2]): t for t in tiles}
    dat = {k: t.get("datum_m", series_datum) for k, t in by.items()}
    seen, blocks = set(), []
    for start in sorted(by, key=lambda k: (k[0], -k[1])):
        if start in seen:
            continue
        comp, todo = [], [start]
        seen.add(start)
        while todo:
            e, n = todo.pop()
            comp.append((e, n))
            for nb in ((e + tile_m, n), (e - tile_m, n), (e, n + tile_m), (e, n - tile_m)):
                if nb in by and nb not in seen and dat[nb] == dat[(e, n)]:
                    seen.add(nb)
                    todo.append(nb)
        es, ns = [c[0] for c in comp], [c[1] for c in comp]
        ids = {by[c]["id"] for c in comp}
        names = [k for k, v in (sets or {}).items() if (have := set(v) & set(t["id"] for t in tiles)) and have <= ids]
        blocks.append({"e0": min(es), "n0": min(ns), "nx": (max(es) - min(es)) // tile_m + 1,
                       "ny": (max(ns) - min(ns)) // tile_m + 1, "tiles": [by[c] for c in sorted(comp)],
                       "sets": names, "datum_m": dat[start]})
    return sorted(blocks, key=lambda b: (b["e0"], -b["n0"]))


def write_layout(path: Path, s: Series, tiles: list[dict], out_dir: Path, cell_px: int = 220,
                 sets: dict | None = None) -> None:
    """Tiles of the series as laid out on the table (north up): one grid per edge-connected block, blocks side
    by side (separate pieces, e.g. the Karlsberg pair and the Merburg 2 × 2), no empty rows between them."""
    if not tiles:
        return
    blocks = layout_blocks(tiles, s.tile_m, sets, s.datum_m)
    m, top, gap, cap = 30, 74, 40, 26
    ny_max = max(b["ny"] for b in blocks)
    basis = (f"Basis {s.datum_m:g} m NHN" if s.datum_mode == "series"
             else f"Basis je Satz (tiefster Punkt − {s.datum_margin_m:g} m)")
    sub = (f"Überhöhung {s.exag:g}× · {basis} = {s.base_mm:g} mm · Gitter EPSG:25832, {s.tile_m} m · Norden oben · "
           f"Schlüssel: {keys_needed(s, tiles)} Stück")
    f_sub = _font(15)
    W = max(sum(b["nx"] for b in blocks) * cell_px + gap * (len(blocks) - 1) + 2 * m, 960,
            int(f_sub.getlength(sub)) + 2 * m)
    H = ny_max * cell_px + top + cap + m + 30
    img = Image.new("RGB", (W, H), (246, 244, 239))
    dr = ImageDraw.Draw(img)
    f_id, f_t, f_cap = _font(max(11, cell_px // 14)), _font(20), _font(15)
    bx = m
    for b in blocks:
        y0 = top + cap
        names = " + ".join(b["sets"])
        bd = f" · Basis {b['datum_m']:g} m" if s.datum_mode == "set" and b.get("datum_m") is not None else ""
        dr.text((bx, top + 2), f"{names + ': ' if names else ''}{b['nx'] * s.tile_mm / 10:.1f} × "
                f"{b['ny'] * s.tile_mm / 10:.1f} cm{bd}", fill=(60, 60, 60), font=f_cap)
        for i in range(b["nx"]):
            for j in range(b["ny"]):
                x, y = bx + i * cell_px, y0 + (b["ny"] - 1 - j) * cell_px
                dr.rectangle([x, y, x + cell_px, y + cell_px], outline=(200, 196, 188))
        for t in b["tiles"]:
            i, j = (t["bboxUTM"][0] - b["e0"]) // s.tile_m, (t["bboxUTM"][1] - b["n0"]) // s.tile_m
            x, y = bx + i * cell_px, y0 + (b["ny"] - 1 - j) * cell_px
            p = out_dir / t["files"]["png"]
            if p.exists():
                img.paste(Image.open(p).convert("RGB").resize((cell_px, cell_px), Image.LANCZOS), (x, y))
            dr.rectangle([x, y, x + cell_px - 1, y + cell_px - 1], outline=(40, 40, 40), width=2)
            lab = f"{t['id']}\nmax {t['z_mm']['max']:.0f} mm · {t['filament_g']['typical']:.0f} g"
            dr.multiline_text((x + 6, y + 5), lab, fill=(0, 0, 0), font=f_id, stroke_width=3,
                              stroke_fill=(255, 255, 255))
        bx += b["nx"] * cell_px + gap
    nb = len(blocks)
    title = (f"{s.name_de} ({s.key}) · {len(tiles)} Kachel(n) à {s.tile_mm / 10:.1f} cm"
             + (f" in {nb} getrennten Teilen" if nb > 1 else
                f" · Ausdehnung {blocks[0]['nx'] * s.tile_mm / 10:.1f} × {blocks[0]['ny'] * s.tile_mm / 10:.1f} cm"))
    dr.text((m, 14), title, fill=(20, 20, 20), font=f_t)
    dr.text((m, 44), sub, fill=(80, 80, 80), font=f_sub)
    dr.text((m, H - 26), DISCLAIMER_DE, fill=(110, 110, 110), font=_font(13))
    img.save(path, optimize=True)


def keys_needed(s: Series, tiles: list[dict]) -> int:
    """Bowtie keys for all shared edges among the given tiles (positions per edge)."""
    if not s.connectors.enabled:
        return 0
    have = {tuple(t["bboxUTM"][:2]): t.get("datum_m", s.datum_m) for t in tiles}  # older entries: series datum
    pairs = sum(sum(nb in have and have[nb] == d for nb in ((e + s.tile_m, n), (e, n + s.tile_m)))
                for (e, n), d in have.items())
    return pairs * len(s.connectors.positions)

# ============================================================================ printer (Bambu Lab P1S)
# Stock "Bambu Lab P1S 0.4 nozzle" profile (Bambu Studio 02.08.02.61, profiles 02.08.00.05): printable area
# 0–256 × 0–256 mm, bed_exclude_area plate 0–18 × 0–28 mm (front left), start-G-code nozzle load line along the front
# (G-code X 18–240, Y 1.0–1.5) with a stroke to Y 11 at X 240; G-code Y = plate Y − 2 (extruder_offset 0x2), so the
# line reaches plate Y ≈ 13.5 incl. its ≈ 0.8 mm width. Slicer probes (CLI, --arrange 0): a 238.095 mm square
# (2 km at 1:8400) fails at every position — right of the exclusion it sticks out of the plate (18 + 238.095 > 256,
# "no object fully inside"), any further left it is "too close to exclusion area"; the widest square is 238.0 mm.
# printer = "stock" (default) therefore places the tile in the free window X ≥ 18, Y ≥ 13.5 (centred, 0.1 mm grid);
# a 235.29 mm tile (1:8500 / 1:2125) lands at X 19.4, Y 17.1 and slices with the unmodified profile.
# printer = "sle-250" keeps the former 250 mm option: a user printer preset (written to <series>/printer/) that
# inherits the stock profile with two changes — bed_exclude_area = a 5 mm strip along the whole front instead of the
# 18 × 28 mm corner (Bambu does not document why the corner is excluded: risk on the user), load line without the
# Y 11 stroke — and the tile at plate X 3–253, Y 6–256.
PLATE_MM = (256.0, 256.0)            # P1S printable_area 0–256 × 0–256 mm
PRINTABLE_HEIGHT_MM = 250.0          # P1S printable_height (Bambu profile fdm_machine_common)
STOCK_EXCLUDE_MM = (18.0, 28.0)      # stock bed_exclude_area: plate X 0–18, Y 0–28 (front left)
STOCK_LOAD_LINE_GCODE_MAX_Y = 11.0   # stock load line stroke at X 240 (G-code Y; checked against the template)
PLACEMENT_MM = (3.0, 6.0)            # sle-250: tile lower-left on the plate → X 3–253, Y 6–256
FRONT_EXCLUDE_MM = 5.0               # sle-250 preset bed_exclude_area: plate Y 0–5 over the full width
EXTRUDER_OFFSET_Y_MM = 2.0           # stock P1S extruder_offset "0x2": plate Y = G-code Y + 2
LOAD_LINE_HALF_WIDTH_MM = 0.5        # load line ≈ 0.8 mm wide (E15 over 222 mm at 0.2 mm), rounded up
PRINTERS = ("stock", "sle-250")
STOCK_PRINTER = "Bambu Lab P1S 0.4 nozzle"
PRESET_NAME = "Bambu Lab P1S 0.4 nozzle - SLE 250 mm"
PRESET_FILE = "printer/sle-p1s-0.4-250mm.json"     # relative to the series directory
BAMBU_PROFILES = Path(os.environ.get("SLE_BAMBU_PROFILES",
                                     "/Applications/BambuStudio.app/Contents/Resources/profiles/BBL"))
_LOAD_STROKE = ("G0 Y11 E0.700 F{outer_wall_volumetric_speed/(0.3*0.5)/ 4 * 60}", "G0 X239.5", "G0 E0.2",
                "G0 Y1.5 E0.700")
_LOAD_STROKE_NEW = ("G0 Y1.5 E0.035 F{outer_wall_volumetric_speed/(0.3*0.5)/ 4 * 60} "
                    "; SLE 250 mm: stock stroke to Y 11 removed (tile starts at plate Y 6)", "G0 E0.2")


def stock_window(tile_mm: float) -> tuple[float, float, float, float]:
    """(x_lo, x_hi, y_lo, y_hi) range of the tile's lower-left corner on the stock P1S plate: right of the
    front-left exclusion area, behind the load line (incl. its stroke), inside the printable area."""
    return (STOCK_EXCLUDE_MM[0], PLATE_MM[0] - tile_mm,
            load_line_plate_max_y(STOCK_LOAD_LINE_GCODE_MAX_Y), PLATE_MM[1] - tile_mm)


def plate_placement(tile_mm: float, printer: str = "stock", key: str = "") -> tuple[float, float]:
    """Lower-left corner of a tile on the P1S plate (3MF build transform); ValueError if it does not fit."""
    if printer == "stock":
        x0, x1, y0, y1 = stock_window(tile_mm)
        if x1 < x0 - 1e-9 or y1 < y0 - 1e-9:
            raise ValueError(f"{key}: a {tile_mm:.3f} mm tile does not fit the stock P1S profile (max "
                             f"{PLATE_MM[0] - STOCK_EXCLUDE_MM[0]:g} mm wide right of the 18 × 28 mm exclusion area, "
                             f"{PLATE_MM[1] - y0:g} mm deep behind the load line) — use a smaller scale or "
                             "printer = \"sle-250\"")
        return (min(max(round((x0 + x1) / 2, 1), x0), x1), min(max(round((y0 + y1) / 2, 1), y0), y1))
    if printer == "sle-250":
        if any(PLACEMENT_MM[k] + tile_mm > PLATE_MM[k] + 1e-9 for k in (0, 1)) or PLACEMENT_MM[1] <= FRONT_EXCLUDE_MM:
            raise ValueError(f"{key}: tile_mm {tile_mm} at {PLACEMENT_MM} does not fit the {PLATE_MM} mm plate")
        return PLACEMENT_MM
    raise ValueError(f"{key}: printer must be one of {PRINTERS}")


def load_line_plate_max_y(gcode_max_y: float) -> float:
    """Front-most plate Y the load line's extrusion can reach (from its G-code bounding box)."""
    return gcode_max_y + EXTRUDER_OFFSET_Y_MM + LOAD_LINE_HALF_WIDTH_MM


def patch_start_gcode(g: str) -> str:
    """Stock P1S machine_start_gcode → load line confined to G-code Y ≤ 1.5 (the 4-line Y11 stroke at X 240
    replaced), i.e. inside the preset's front exclusion strip.

    Raises ValueError when the stock lines are not found exactly once (Bambu changed the template)."""
    lines = g.split("\n")
    strip = [ln.strip() for ln in lines]
    hits = [i for i in range(len(strip) - 3) if tuple(strip[i:i + 4]) == _LOAD_STROKE]
    if len(hits) != 1:
        raise ValueError(f"stock P1S load line not found ({len(hits)} matches) — Bambu Studio template changed")
    i = hits[0]
    ind = lines[i][:len(lines[i]) - len(lines[i].lstrip())]
    out = "\n".join(lines[:i] + [ind + x for x in _LOAD_STROKE_NEW] + lines[i + 4:])
    ext = load_line_extent(out)
    if ext is None or load_line_plate_max_y(ext[3]) > FRONT_EXCLUDE_MM:
        raise ValueError(f"patched load line extent {ext} leaves the {FRONT_EXCLUDE_MM} mm front strip")
    return out


def load_line_extent(g: str) -> tuple[float, float, float, float] | None:
    """Bounding box (x0, y0, x1, y1) of the extruding XY moves in the ';===== nozzle load line' block (absolute
    G0/G1 coordinates up to the next M400); None if there is no such block."""
    lines = g.split("\n")
    try:
        k = next(i for i, ln in enumerate(lines) if "nozzle load line" in ln)
    except StopIteration:
        return None
    x = y = None
    pts = []
    for ln in lines[k + 1:]:
        cmd = ln.split(";")[0].strip()
        if cmd.startswith("M400"):
            break
        if not re.match(r"G[01]\b", cmd):
            continue
        w = dict((t[0], t[1:]) for t in cmd.split()[1:] if t[0] in "XYE")
        nx = float(w["X"]) if "X" in w else x
        ny = float(w["Y"]) if "Y" in w else y
        e = float(w["E"]) if "E" in w and re.fullmatch(r"-?[\d.]+", w["E"]) else 0.0
        if e > 0 and x is not None and y is not None and (nx, ny) != (x, y):
            pts += [(x, y), (nx, ny)]
        x, y = nx, ny
    if not pts:
        return None
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def printer_preset(stock_start_gcode: str, version: str = "") -> dict:
    """Bambu Studio user printer preset (File → Import → Import Configs…) for 250 mm tiles."""
    d = {"type": "machine", "name": PRESET_NAME, "inherits": STOCK_PRINTER, "from": "User", "instantiation": "true",
         "printer_settings_id": PRESET_NAME, "bed_exclude_area": bed_exclude_area(),
         "machine_start_gcode": patch_start_gcode(stock_start_gcode)}
    if version:
        d["version"] = version
    return d


def bed_exclude_area() -> list[str]:
    w, d = PLATE_MM[0], FRONT_EXCLUDE_MM
    return ["0x0", f"{w:g}x0", f"{w:g}x{d:g}", f"0x{d:g}"]


def stock_exclude_area() -> list[str]:
    w, d = STOCK_EXCLUDE_MM
    return ["0x0", f"{w:g}x0", f"{w:g}x{d:g}", f"0x{d:g}"]


def printer_meta(written: bool, version: str = "", printer: str = "sle-250",
                 placement: tuple[float, float] | None = None, tile_mm: float = 250.0) -> dict:
    """index.json `printerProfile` (contract "3D print tiles")."""
    plc = placement or plate_placement(tile_mm, printer)
    if printer == "stock":
        x0, y0 = plc
        return {
            "mode": "stock", "name": STOCK_PRINTER, "inherits": None, "file": None,
            "bambuProfilesVersion": version or None,
            "plate_mm": list(PLATE_MM), "printableHeight_mm": PRINTABLE_HEIGHT_MM, "placement_mm": list(plc),
            "bedExcludeArea": stock_exclude_area(),
            "loadLine": ("G-code X 18–240, Y 1.0–1.5 plus a stroke to Y 11 at X 240; plate Y = G-code Y + 2 "
                         f"(≤ {load_line_plate_max_y(STOCK_LOAD_LINE_GCODE_MAX_Y):g} mm incl. line width)"),
            "note_de": (f"Standardprofil „{STOCK_PRINTER}“ – kein eigenes Druckerprofil nötig. 3MF öffnen und "
                        f"nicht anordnen/zentrieren: die Kachel liegt bei X {x0:g}–{x0 + tile_mm:.1f}, "
                        f"Y {y0:g}–{y0 + tile_mm:.1f} mm, rechts neben dem Sperrbereich vorne links (18 × 28 mm) "
                        "und hinter der Ladelinie. Zentriert würde sie den Sperrbereich berühren."),
        }
    return {
        "mode": "sle-250", "name": PRESET_NAME, "inherits": STOCK_PRINTER, "file": PRESET_FILE if written else None,
        "bambuProfilesVersion": version or None,
        "plate_mm": list(PLATE_MM), "printableHeight_mm": PRINTABLE_HEIGHT_MM, "placement_mm": list(plc),
        "bedExcludeArea": bed_exclude_area(),
        "loadLine": "G-code X 18–240, Y 1.0–1.5 (stock: plus a stroke to Y 11 at X 240); plate Y = G-code Y + 2",
        "note_de": ("250-mm-Kacheln passen nicht ins Standardprofil (Sperrbereich vorne links 18 × 28 mm, "
                    "Ladelinie bis Y 11). Profil importieren (Datei → Importieren → Konfigurationen importieren), "
                    "Kachel nicht anordnen/zentrieren: Position (Mitte) X 128, Y 131 mm = Ecke X 3, Y 6 mm, "
                    "Hinterkante bündig. Der Sperrstreifen vorne (5 mm) hält die Ladelinie frei; der frühere "
                    "Sperrbereich vorne links ist auf eigene Verantwortung freigegeben — zuerst mit einer kleinen "
                    "Testkachel prüfen."),
    }


def bambu_profiles_version(profiles: Path = BAMBU_PROFILES) -> str:
    try:                                           # e.g. …/profiles/BBL.json next to …/profiles/BBL/
        return json.loads((profiles.parent / f"{profiles.name}.json").read_text()).get("version", "")
    except (OSError, ValueError):
        return ""


def write_printer_preset(out: Path, profiles: Path = BAMBU_PROFILES) -> dict:
    """Write PRESET_FILE from the installed Bambu Studio's stock P1S template; returns `printerProfile`.

    Without a Bambu Studio installation an existing preset file is kept (and reported)."""
    tpl = profiles / "machine" / f"{STOCK_PRINTER} template machine_start_gcode.json"
    target = out / PRESET_FILE
    version = bambu_profiles_version(profiles)
    if not tpl.exists():
        print(f"  ! Bambu Studio profiles not found ({profiles}); set SLE_BAMBU_PROFILES — "
              f"{'keeping existing' if target.exists() else 'no'} {PRESET_FILE}")
        return printer_meta(target.exists(), json.loads(target.read_text()).get("version", "")
                            if target.exists() else "")
    try:
        off = json.loads((profiles / "machine" / f"{STOCK_PRINTER}.json").read_text()).get("extruder_offset")
    except (OSError, ValueError):
        off = None
    if off not in (None, ["0x2"], ["0x2", "0x2"]):   # the plate ↔ G-code shift the load-line check relies on
        raise SystemExit(f"{STOCK_PRINTER}: extruder_offset {off} ≠ 0x2 — re-check the load line clearance")
    g = json.loads(tpl.read_text())["machine_start_gcode"]
    g = g if isinstance(g, str) else "\n".join(g) if len(g) != 1 else g[0]
    target.parent.mkdir(parents=True, exist_ok=True)
    write_json(target, printer_preset(g, version))
    return printer_meta(True, version)


def stock_profile_problems(profiles: Path = BAMBU_PROFILES) -> list[str] | None:
    """Compare the installed stock P1S profile with the assumptions behind plate_placement(…, "stock").

    Returns None when Bambu Studio is not installed, else a list of mismatches (empty = ok)."""
    mdir = profiles / "machine"
    tpl = mdir / f"{STOCK_PRINTER} template machine_start_gcode.json"
    if not (mdir / f"{STOCK_PRINTER}.json").exists() or not tpl.exists():
        return None
    probs = []
    d = json.loads((mdir / f"{STOCK_PRINTER}.json").read_text())
    if d.get("bed_exclude_area") != stock_exclude_area():
        probs.append(f"bed_exclude_area {d.get('bed_exclude_area')} ≠ {stock_exclude_area()}")
    if d.get("extruder_offset") not in (None, ["0x2"], ["0x2", "0x2"]):
        probs.append(f"extruder_offset {d.get('extruder_offset')} ≠ 0x2")
    g = json.loads(tpl.read_text())["machine_start_gcode"]
    g = g if isinstance(g, str) else "\n".join(g) if len(g) != 1 else g[0]
    ext = load_line_extent(g)
    if ext is None or ext[3] > STOCK_LOAD_LINE_GCODE_MAX_Y:
        probs.append(f"load line extent {ext} reaches beyond G-code Y {STOCK_LOAD_LINE_GCODE_MAX_Y}")
    return probs


def printer_setup(s: Series, out: Path, profiles: Path = BAMBU_PROFILES) -> dict:
    """Prepare the printer side of a series run; returns index.json `printerProfile`."""
    if s.printer == "sle-250":
        return write_printer_preset(out, profiles)
    probs = stock_profile_problems(profiles)
    if probs is None:
        print(f"  ! Bambu Studio profiles not found ({profiles}); stock P1S placement not re-checked")
    elif probs:
        raise SystemExit(f"{STOCK_PRINTER} changed in the installed Bambu Studio: {'; '.join(probs)} — re-check the "
                         "stock placement (print3d.py printer section) before printing")
    return printer_meta(False, bambu_profiles_version(profiles), "stock", s.placement_mm, s.tile_mm)


# ============================================================================ index
def series_meta(s: Series) -> dict:
    c = s.connectors
    return {
        "key": s.key, "name_de": s.name_de, "scale": s.scale, "tile_m": s.tile_m, "tile_mm": s.tile_mm,
        "vertices": s.vertices, "cell_m": s.cell_m, "cell_mm": s.cell_mm, "exag": s.exag, "datum_m": s.datum_m,
        "datumMode": s.datum_mode, "datumMargin_m": s.datum_margin_m if s.datum_mode == "set" else None,
        "base_mm": s.base_mm, "origin": list(s.origin), "rlpOffset_m": s.rlp_offset_m, "role": s.role,
        "printer": s.printer, "placement_mm": list(s.placement_mm),
        "zFormula": "z_mm = base_mm + (max(h, datum_m) − datum_m) / scale · 1000 · exag (datum_m of the tile)",
        "sampling": "area mean of the 1 m DGM (PixelIsArea) over a cell_m square centred on each vertex; "
                    "vertices on the tile edges (shared edges bit-identical)",
        "frame": "mm, X = east, Y = north, Z up, origin = tile lower-left corner at z = 0",
        "text": {"engraved": s.text, "depth_mm": s.engrave_mm, "mirrored": True,
                 "note_de": "Unterseite: gespiegelt graviert, lesbar nach Wenden um die Nord-Süd-Achse"},
        "connectors": {"enabled": c.enabled, "type": "bowtie", "positions": list(c.positions),
                       "depth_mm": c.depth_mm, "length_mm": c.length_mm, "waist_mm": c.waist_mm,
                       "end_mm": c.end_mm, "clearance_mm": c.clearance_mm,
                       "keyThickness_mm": round(c.depth_mm - c.clearance_mm, 3),
                       "key": "keys/bowtie_key.stl" if c.enabled else None},
    }


def corners_wgs84(e0, n0, e1, n1) -> list[list[float]]:
    from pyproj import Transformer
    tr = Transformer.from_crs(25832, 4326, always_xy=True)
    return [[round(v, 7) for v in tr.transform(e, n)] for e, n in ((e0, n0), (e1, n0), (e1, n1), (e0, n1))]


TILE_KEYS = ("id", "grid", "bboxUTM", "wgs84", "wgs84Corners", "files", "z_mm", "h_m", "clampedVertices",
             "volume_cm3", "surface_cm2", "filament_g", "triangles", "vertices", "watertight", "sources", "created")


def validate_index(doc: dict) -> list[str]:
    """Return a list of problems (empty = ok) for an index.json document."""
    errs = []
    if doc.get("format") != FORMAT:
        errs.append("format")
    for k in ("series", "crs", "units", "filament", "tiles", "attribution", "updated"):
        if k not in doc:
            errs.append(f"missing {k}")
    if doc.get("crs") != "EPSG:25832" or doc.get("units") != "mm":
        errs.append("crs/units")
    ser = doc.get("series", {})
    for k in ("key", "scale", "tile_m", "tile_mm", "exag", "datum_m", "base_mm", "origin", "connectors"):
        if k not in ser:
            errs.append(f"series.{k}")
    ids = set()
    for t in doc.get("tiles", []):
        miss = [k for k in TILE_KEYS if k not in t]
        if miss:
            errs.append(f"{t.get('id')}: missing {miss}")
            continue
        if t["id"] in ids:
            errs.append(f"duplicate {t['id']}")
        ids.add(t["id"])
        try:
            e0, n0 = parse_tile_id(t["id"])
        except ValueError:
            errs.append(f"bad id {t['id']}")
            continue
        tm = ser.get("tile_m")
        if t["bboxUTM"] != [e0, n0, e0 + tm, n0 + tm]:
            errs.append(f"{t['id']}: bboxUTM")
        if not (0 <= t["z_mm"]["min"] <= t["z_mm"]["mean"] <= t["z_mm"]["max"]):
            errs.append(f"{t['id']}: z_mm")
        if ser.get("datum_m") is None and not isinstance(t.get("datum_m"), (int, float)):
            errs.append(f"{t['id']}: datum_m (per-set datum series)")
        if not all(isinstance(t["files"].get(k), str) for k in ("3mf", "png")):
            errs.append(f"{t['id']}: files")
        if set(t["filament_g"]) != {"solid", "typical"}:
            errs.append(f"{t['id']}: filament_g")
    return errs


def tile_datum(t: dict, ser: dict) -> float | None:
    """Datum of an index tile entry (older entries: the series datum)."""
    return t.get("datum_m", ser.get("datum_m"))


def merge_index(old: dict | None, s: Series, new_tiles: list[dict], attribution: list[str],
                printer: dict | None = None, set_datums: dict | None = None) -> dict:
    tiles = {t["id"]: t for t in (old or {}).get("tiles", [])}
    tiles.update({t["id"]: t for t in new_tiles})
    ordered = sorted(tiles.values(), key=lambda t: (-t["bboxUTM"][1], t["bboxUTM"][0]))
    att = [a for a in (old or {}).get("attribution", "").split("; ") if a]
    for a in attribution:
        if a not in att:
            att.append(a)
    sets = set_tiles(s)
    sd = {**(old or {}).get("setDatum_m", {}), **(set_datums or {})}
    prof = (f"Standarddruckerprofil „{STOCK_PRINTER}“" if s.printer == "stock"
            else f"Druckerprofil „{PRESET_NAME}“")
    doc = {
        "format": FORMAT, "series": series_meta(s), "crs": "EPSG:25832", "heightDatum": "DHHN2016", "units": "mm",
        "printer": (f"Bambu Lab P1S 0.4 (Druckfläche {PLATE_MM[0]:g} × {PLATE_MM[1]:g} mm, Höhe max. "
                    f"{PRINTABLE_HEIGHT_MM:g} mm) mit {prof}"),
        "printerProfile": (printer or (old or {}).get("printerProfile")
                           or printer_meta(False, "", s.printer, s.placement_mm, s.tile_mm)),
        "filament": {"material": "PLA", "density_g_cm3": s.material_density_g_cm3, "shell_mm": s.shell_mm,
                     "infill": s.infill, "formula": FILAMENT_FORMULA},
        "layout": "layout.png", "sets": sets, "keysNeeded": keys_needed(s, ordered),
        "attribution": "; ".join(att), "disclaimer_de": DISCLAIMER_DE,
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "tiles": ordered,
    }
    if s.datum_mode == "set" or sd:
        doc["setDatum_m"] = {k: sd[k] for k in sorted(sd)}
    return doc


def set_tiles(s: Series) -> dict[str, list[str]]:
    """Named sets of the series as tile id lists (bbox sets expanded)."""
    return {name: ([tile_id(e, n) for e, n in tiles_in_bbox(s, *spec["bbox"])] if isinstance(spec, dict)
                   else [tile_id(*parse_tile_id(t, s)) for t in spec]) for name, spec in s.sets.items()}


def write_json(path: Path, doc: dict) -> None:
    tmp = path.with_suffix(".json.part")
    tmp.write_text(json.dumps(doc, indent=1, ensure_ascii=False))
    os.replace(tmp, path)


# ============================================================================ tile generation
def sample_tile(s: Series, e0: int, n0: int, fetch: bool = True) -> tuple[np.ndarray, dict]:
    n = s.vertices
    cx, wx = axis_weights(vertex_coords(e0, s.tile_m, n), s.cell_m)
    cy, wy = axis_weights(vertex_coords(n0, s.tile_m, n), s.cell_m)
    box = source_box(cx, wx, cy, wy)
    dem, src = load_dgm(box, s, fetch)
    h, miss = resample(dem, box, cx, wx, cy, wy)
    if miss.any():  # load_dgm already guarantees full coverage
        raise SystemExit(f"{tile_id(e0, n0)}: {int(miss.sum())} vertices touch cells without data")
    return h, src


def generate_tile(s: Series, e0: int, n0: int, out: Path, fetch: bool = True, stl: bool = False,
                  datum_m: float | None = None, sampled: tuple[np.ndarray, dict] | None = None) -> dict:
    tid = tile_id(e0, n0)
    datum = s.datum_m if datum_m is None else datum_m
    T = {}
    t0 = time.time()
    h, src = sampled if sampled is not None else sample_tile(s, e0, n0, fetch)
    T["sample"] = time.time() - t0
    z, clamped = z_from_h(h, s, datum)
    if clamped:
        print(f"  ! {tid}: {clamped} vertices below datum {datum} m clamped (min h {h.min():.2f} m)")
    t = time.time()
    text = text_geometry(label_lines(s, tid, datum), s.tile_mm) if s.text else None
    check_text_clearance(text, s.tile_mm, s.connectors)
    V, F = build_tile_mesh(z, s.tile_mm, s.connectors, text, s.engrave_mm)
    chk = mesh_check(F)
    vol, area = mesh_stats(V, F)
    if not chk["watertight"] or vol <= 0:
        raise SystemExit(f"{tid}: mesh check failed {chk}, volume {vol}")
    T["mesh"] = time.time() - t
    t = time.time()
    files = {"3mf": f"{tid}.3mf", "png": f"{tid}.png"}
    px, py = s.placement_mm
    prn = (f"stock printer '{STOCK_PRINTER}'" if s.printer == "stock"
           else f"printer preset '{PRESET_NAME}' ({PRESET_FILE})")
    meta = {"Title": f"{tid} {s.key}", "Designer": "Saar LiDAR Explorer (print3d.py)",
            "Description": (f"{s.name_de} ({s.key}), exag {s.exag:g}x, datum {datum:g} m NHN, base {s.base_mm:g} mm; "
                            f"Bambu Studio: {prn}, do not re-arrange or centre "
                            f"(lower-left corner at plate X {px:g} / Y {py:g} mm)"),
            "Copyright": ATTRIBUTION_SL + ("; " + ATTRIBUTION_RLP if src["rlp"] else ""),
            "LicenseTerms": "dl-de/by-2-0", "CreationDate": datetime.now(timezone.utc).strftime("%Y-%m-%d")}
    write_3mf(out / files["3mf"], V, F, tid, meta, place_mm=s.placement_mm)
    stale = out / f"{tid}.stl"
    if stl:
        files["stl"] = f"{tid}.stl"
        write_stl(out / files["stl"], V, F, f"{tid} {s.key}")
    elif stale.exists():
        stale.unlink()                                   # an older STL would no longer match the 3MF
    preview_png(out / files["png"], h, z, s.cell_mm)
    T["write"] = time.time() - t
    solid, typical = filament_g(vol, area, s)
    if z.max() > s.max_height_mm:
        print(f"  ! {tid}: {z.max():.1f} mm exceeds max_height_mm {s.max_height_mm} — consider a separate series "
              f"with a higher datum_m (only tiles of the same series and datum join)")
    c = s.connectors
    base_above = None
    if c.enabled:
        mins = []
        g = (np.arange(s.vertices) * s.tile_mm) / (s.vertices - 1)
        for side in recess_polygons(s.tile_mm, c):
            for r in side:
                xs, ys = [p[0] for p in r], [p[1] for p in r]
                ii = (g >= min(xs) - s.cell_mm) & (g <= max(xs) + s.cell_mm)
                jj = (g >= min(ys) - s.cell_mm) & (g <= max(ys) + s.cell_mm)
                mins.append(float(z[np.ix_(jj, ii)].min()))
        base_above = round(min(mins) - c.depth_mm, 3)
        if base_above < c.min_base_mm:
            raise SystemExit(f"{tid}: only {base_above} mm above a key recess")
    print(f"  {tid}: z {z.min():.2f}–{z.max():.2f} mm, {len(F):,} tris, {vol / 1000:.0f} cm³, "
          f"{solid:.0f} g solid / {typical:.0f} g typical  [sample {T['sample']:.1f}s mesh {T['mesh']:.1f}s "
          f"write {T['write']:.1f}s]", flush=True)
    corners = corners_wgs84(e0, n0, e0 + s.tile_m, n0 + s.tile_m)
    lons, lats = [p[0] for p in corners], [p[1] for p in corners]
    return {
        "id": tid,
        "grid": {"col": (e0 - s.origin[0]) // s.tile_m, "row": (n0 - s.origin[1]) // s.tile_m},
        "bboxUTM": [e0, n0, e0 + s.tile_m, n0 + s.tile_m],
        "wgs84": [min(lons), min(lats), max(lons), max(lats)],
        "wgs84Corners": corners,
        "files": files,
        "datum_m": datum,
        "z_mm": {"min": round(float(z.min()), 3), "max": round(float(z.max()), 3), "mean": round(float(z.mean()), 3)},
        "h_m": {"min": round(float(h.min()), 2), "max": round(float(h.max()), 2), "mean": round(float(h.mean()), 2)},
        "clampedVertices": clamped,
        "baseAboveRecess_mm": base_above,
        "volume_cm3": round(vol / 1000.0, 1),
        "surface_cm2": round(area / 100.0, 1),
        "filament_g": {"solid": round(solid), "typical": round(typical)},
        "triangles": int(len(F)), "vertices": int(len(V)),
        "watertight": True,
        "sources": src,
        "created": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "timings_s": {k: round(v, 1) for k, v in T.items()},
    }


def resolve_datums(s: Series, tiles: list[tuple[int, int]], old: dict | None, h_min, explicit: float | None = None,
                   requested_sets: list[str] | tuple = ()) -> tuple[dict, dict]:
    """Datum per requested tile → ({(e0, n0): datum_m}, {set name: datum_m} to record in index.json).

    datum_mode "series": the series datum. "set": the datum of every named set that contains a requested tile (or
    was requested), resolved in this order — 1. recorded in the existing index (`setDatum_m`, frozen); 2. adopted
    from already generated tiles of the set (all must agree; keeps nested / extended sets consistent);
    3. computed as set_datum(min h over ALL tiles of the set, margin) with h_min(e0, n0) → lowest vertex height.
    A tile in no set needs `explicit` (--datum) or an existing entry. Conflicting datums for one tile → ValueError."""
    if s.datum_mode == "series":
        if explicit is not None and explicit != s.datum_m:
            raise ValueError(f"{s.key} has the fixed datum {s.datum_m} m; --datum only applies to per-set series")
        return {t: s.datum_m for t in tiles}, {}
    old = old or {}
    ser = old.get("series", {})
    old_tiles = {tuple(t["bboxUTM"][:2]): tile_datum(t, ser) for t in old.get("tiles", [])}
    recorded = dict(old.get("setDatum_m", {}))
    members = {name: [parse_tile_id(i) for i in ids] for name, ids in set_tiles(s).items()}
    want = set(tiles)
    names = [n for n in members if n in requested_sets or want & set(members[n])]
    sets: dict[str, float] = {}
    for name in names:
        if name in recorded:
            sets[name] = float(recorded[name])
            continue
        have = {old_tiles[t] for t in members[name] if old_tiles.get(t) is not None}
        if len(have) > 1:
            raise ValueError(f"set {name}: its generated tiles have different datums {sorted(have)}")
        sets[name] = float(have.pop()) if have else set_datum(min(h_min(*t) for t in members[name]),
                                                               s.datum_margin_m)
    out = {}
    for t in tiles:
        cand = {sets[n] for n in names if t in members[n]}
        if old_tiles.get(t) is not None:
            cand.add(float(old_tiles[t]))
        if explicit is not None:
            cand.add(float(explicit))
        if len(cand) > 1:
            raise ValueError(f"{tile_id(*t)}: conflicting datums {sorted(cand)} (sets / existing tile / --datum); "
                             "tiles only join with tiles of the same datum")
        if not cand:
            raise ValueError(f"{tile_id(*t)} is in no named set of {s.key} and not generated yet: give --datum M "
                             "(e.g. the datum of the neighbouring set) or add a set to print3d.toml")
        out[t] = cand.pop()
    return out, sets


def write_catalog(root: Path) -> dict:
    """print/series.json: the generated series (for the app; read–rebuilt from every <series>/index.json)."""
    entries = []
    known = set(list_series())
    for idx in sorted(root.glob("*/index.json")):
        try:
            doc = json.loads(idx.read_text())
        except (OSError, ValueError):
            continue
        ser = doc.get("series", {})
        if doc.get("format") != FORMAT or ser.get("key") != idx.parent.name:
            continue
        entries.append({
            "key": ser["key"], "name_de": ser.get("name_de", ser["key"]), "role": ser.get("role", "main"),
            "scale": ser.get("scale"), "tile_m": ser.get("tile_m"), "tile_mm": ser.get("tile_mm"),
            "exag": ser.get("exag"), "datum_m": ser.get("datum_m"), "datumMode": ser.get("datumMode", "series"),
            "printer": ser.get("printer", (doc.get("printerProfile") or {}).get("mode", "sle-250")),
            "index": f"{ser['key']}/index.json", "tiles": len(doc.get("tiles", [])),
            "configured": ser["key"] in known, "updated": doc.get("updated"),
        })
    entries.sort(key=lambda e: (e["role"] != "main", e["scale"] or 0, e["key"]))
    doc = {"format": "sle-print3d-series-v1", "series": entries,
           "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    root.mkdir(parents=True, exist_ok=True)
    write_json(root / "series.json", doc)
    return doc


def write_key(s: Series, out: Path) -> None:
    if not s.connectors.enabled:
        return
    (out / "keys").mkdir(parents=True, exist_ok=True)
    V, F = key_mesh(s.connectors)
    assert mesh_check(F)["watertight"]
    write_stl(out / "keys" / "bowtie_key.stl", V, F, "bowtie key")


def resolve_tiles(s: Series, args) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for tid in args.tiles or []:
        try:
            out.append(parse_tile_id(tid, s))
        except ValueError as e:
            raise SystemExit(str(e))
    if args.bbox:
        out += tiles_in_bbox(s, *args.bbox)
    if args.aoi:
        a = load_aoi(args.aoi)
        out += tiles_in_bbox(s, a.e0, a.n0, a.e1, a.n1)
    for name in args.set or []:
        if name not in s.sets:
            raise SystemExit(f"unknown set {name!r} for {s.key}; known: {', '.join(s.sets)}")
        spec = s.sets[name]
        if isinstance(spec, dict):
            out += tiles_in_bbox(s, *spec["bbox"])
        else:
            for tid in spec:
                out.append(parse_tile_id(tid, s))
    seen: dict = {}
    for t in out:
        seen.setdefault(t, None)
    return list(seen)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--series")
    ap.add_argument("--tiles", nargs="+", metavar="ID")
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("E0", "N0", "E1", "N1"))
    ap.add_argument("--aoi")
    ap.add_argument("--set", action="append", metavar="NAME", help="named tile set from print3d.toml (repeatable)")
    ap.add_argument("--no-fetch", action="store_true", help="use cached DGM tiles only")
    ap.add_argument("--stl", action="store_true", help="also write binary STL (≈ 100 MB per tile; default 3MF only)")
    ap.add_argument("--datum", type=float, default=None, metavar="M",
                    help="datum (m NHN) for tiles of a per-set datum series that are in no named set")
    ap.add_argument("--layout-only", action="store_true", help="rewrite index summary, key and layout.png")
    ap.add_argument("--out", type=Path, default=None, help=f"output root (default {PRINT_DIR})")
    ap.add_argument("--list", action="store_true", help="list series and sets")
    ap.add_argument("--bambu-profiles", type=Path, default=BAMBU_PROFILES,
                    help="Bambu Studio profiles/BBL directory (source of the stock P1S start G-code; "
                         "env SLE_BAMBU_PROFILES)")
    args = ap.parse_args()
    if args.list or not args.series:
        for k in list_series():
            s = load_series(k)
            dat = f"{s.datum_m:g} m" if s.datum_mode == "series" else f"per set (min − {s.datum_margin_m:g} m)"
            print(f"{k}: 1:{s.scale}, {s.tile_m} m → {s.tile_mm:.2f} mm, exag {s.exag:g}, datum {dat}, "
                  f"printer {s.printer} at {s.placement_mm}, sets: {', '.join(s.sets) or '-'}")
        return
    s = load_series(args.series)
    out = (args.out or PRINT_DIR) / s.key
    out.mkdir(parents=True, exist_ok=True)
    idx_path = out / "index.json"
    old = json.loads(idx_path.read_text()) if idx_path.exists() else None
    tiles = [] if args.layout_only else resolve_tiles(s, args)
    if not tiles and not args.layout_only:
        raise SystemExit("no tiles selected (use --tiles, --bbox, --aoi or --set)")
    T0 = time.time()
    dat = f"datum {s.datum_m:g} m" if s.datum_mode == "series" else "datum per set"
    print(f"series {s.key}: 1:{s.scale}, {s.tile_m} m tiles → {s.tile_mm:.3f} mm, {s.vertices}² vertices "
          f"({s.cell_m:g} m), exag {s.exag:g}, {dat}, base {s.base_mm:g} mm, printer {s.printer} at plate "
          f"{s.placement_mm}; {len(tiles)} tile(s)")
    cache: dict = {}

    def sampled(e0, n0):
        if (e0, n0) not in cache:
            cache[(e0, n0)] = sample_tile(s, e0, n0, not args.no_fetch)
        return cache[(e0, n0)]

    try:
        datums, set_datums = resolve_datums(s, tiles, old, lambda e, n: float(sampled(e, n)[0].min()), args.datum,
                                            args.set or [])
    except ValueError as e:
        raise SystemExit(str(e))
    for name, d in set_datums.items():
        print(f"  set {name}: datum {d:g} m")
    write_key(s, out)
    printer = printer_setup(s, out, args.bambu_profiles)
    new, att = [], [ATTRIBUTION_SL]
    for e0, n0 in tiles:
        ent = generate_tile(s, e0, n0, out, fetch=not args.no_fetch, stl=args.stl, datum_m=datums[(e0, n0)],
                            sampled=cache.pop((e0, n0), None))
        if ent["sources"]["rlp"]:
            att.append(ATTRIBUTION_RLP)
        new.append(ent)
        write_json(idx_path, merge_index(old, s, new, att, printer, set_datums))   # keep progress on failure
    doc = merge_index(old, s, new, att, printer, set_datums)
    errs = validate_index(doc)
    if errs:
        raise SystemExit(f"index invalid: {errs}")
    write_json(idx_path, doc)
    write_layout(out / "layout.png", s, doc["tiles"], out, sets=doc["sets"])
    write_catalog(out.parent)
    tot = sum(t["filament_g"]["typical"] for t in doc["tiles"])
    print(f"done in {time.time() - T0:.0f}s: {len(new)} tile(s) written, index has {len(doc['tiles'])} "
          f"(≈ {tot / 1000:.1f} kg PLA typical), {doc['keysNeeded']} keys → {out}")


if __name__ == "__main__":
    main()
