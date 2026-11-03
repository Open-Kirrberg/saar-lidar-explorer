"""F15: rule-based relict candidate detection on the 1 m DTM (pits, mounds, linear features, rectangles, platforms).

Usage:  uv run python detect.py <aoi> [--min-score 0.3] [--mask-min-score 0.4] [--no-mask]

Reads   data/work/<aoi>/{dtm,chm,bldg,mask}.tif   (from build.py / buildings.py; chm/bldg/mask optional)
        app/public/data/<aoi>/vectors/osm.geojson (optional, osm.py) and app/public/data/pois.geojson (evaluation)
Writes  app/public/data/<aoi>/candidates/candidates.geojson (+ candidates/mask/{i}_{j}.png)
        manifest `candidates` (docs/data-contract.md "Candidates"), data/work/<aoi>/detect.json (evaluation)

Output = HYPOTHESES, not findings (SDschG Saarland, DSchG RLP). Never commit candidate data to this repo; relict
classes are published only via scripts/release/ (docs/adr/0009). No digging/detector guidance anywhere.

Method (transparent rules; PARAMS/WEIGHTS/PENALTIES are authoritative, the numbers below are their defaults;
everything is pure numpy/scipy/skimage on arrays so it is unit-testable on synthetic DTMs):
  1. DTM smoothed with a σ = 1 m Gaussian; local relief (LRM) = smoothed DTM − box mean at r = 7 / 10 / 25 m.
  2. pit       LRM10 < −0.3 m (hysteresis down to −0.15 m), 3–400 m², scored by depth, roundness, size, rim.
  3. mound     LRM25 > +0.3 m (hysteresis +0.15 m), Ø 4–45 m, scored by height, roundness, size, ring ditch.
  4. rect      a pit/mound region (holes filled) or a closed wall ring with rectangularity ≥ 0.88 and
               circularity ≤ 0.88, 25–2500 m², sides ≥ 4 m.
  5. platform  flat (< 6°) disc, Ø ≈ 7–20 m, inside a slope of ≥ 10° (charcoal-kiln platform / terrace).
  6. linear    LRM7 < −0.3 m (ditch/hollow way) or > +0.3 m (bank/wall) regions (hysteresis ±0.12 m) → skeleton
               → longest path ≥ 30 m, narrow (≤ 10 m) and elongated (≥ 4:1); scored by length, straightness,
               relief, ditch+bank pair.
  7. filters   buildings (bldg mask + 2 m) and OSM water/roads/rails (buffers) exclude; settlements, interpolated
               cells, uprooted-tree pits (small pit with a one-sided spoil mound) and known paths down-weight
               (`along_path`: linear running ≥ 50 % within 5 m of an OSM road/track/path → × 0.7).
  8. coarse    (rule set 2, Q-15) on 2 m block means, after the fine pass — fine candidates and their ids are
               unchanged, coarse ids continue the collision counter; every coarse candidate carries `metrics.scale_m`:
               large regions LRM40 ≥ 0.4/0.8/1.5/3 m (1200–40 000 m², lowest qualifying threshold wins) →
               rect (rectangular, straight steep edges), mound (round, steep flanks, closed, flat top or sharp foot),
               platform (flat top, steep scarped edge); moat = LRM20 ≤ −0.3 m ditch around a raised one
               (≥ 25 % of the directions; score bounded by the enclosed structure); scarp = straight (≥ 0.9) steep
               (≥ 15°) band ≤ 10 m wide, ≥ 30 m long, ≥ 1 m step, flatter ground on both sides (terrace edges);
               edges in an OSM road/rail corridor (buffer + 16 m: embankments, cuttings) are dropped.
Defaults: candidates written from score 0.3 (--min-score), mask raster from 0.4 (--mask-min-score).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import shutil
import sys
import time
import warnings
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from scipy import ndimage
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra

from common import APP_DATA, WORK_DIR, load_aoi, update_manifest

METHOD = "lrm-rules"
RULESET_VERSION = 2   # 2: coarse pass for large structures (Q-15); fine rules = version 1
CLASSES = ("pit", "mound", "linear", "rect", "platform")
CLASS_CODE = {"pit": 1, "mound": 2, "linear": 3, "rect": 4, "platform": 5}
LABELS_DE = {"pit": "Grube/Trichter", "mound": "Hügel", "linear": "Graben/Wall/Weg", "rect": "Rechteckstruktur",
             "platform": "Plattform"}
LABEL_DE = "Verdachtsflächen"
MAX_SEG_M = 2.0
_DENSIFY_STEP = MAX_SEG_M - 0.02  # stays ≤ 2 m after 0.01 m rounding (as osm.py)

PARAMS: dict[str, Any] = {
    "smooth_sigma_m": 1.0,
    "lrm_radius_m": {"linear": 7, "pit": 10, "mound": 25},
    "threshold_m": 0.3,               # pit/mound seed: |LRM| ≥ 0.3 m
    "hysteresis_low_m": 0.15,         # region grows while |LRM| ≥ 0.15 m
    "pit_area_m2": [3, 400],
    "pit_min_closed_m": 0.15,         # pit must be a closed depression ≥ 0.15 m below its local spill point
    "mound_min_circularity": 0.55,
    "uprooted_max_pit_m": 6, "uprooted_max_mound_m": 8, "uprooted_gap_m": 3,
    "mound_diameter_m": [4, 45],
    "rect_min_rectangularity": 0.88,  # A / min-area rectangle (a digitised small disc reaches ≈ 0.86)
    "rect_max_circularity": 0.88,     # squares ≈ 0.79, rounded squares ≤ 0.88, discs ≥ 0.9
    "rect_min_area_m2": 25,
    "rect_min_side_m": 4,
    "rect_max_area_m2": 2500,
    "platform_max_slope_deg": 6,
    "platform_context_slope_deg": 10,
    "platform_context_radius_m": 15,
    "platform_area_m2": [40, 320],
    "platform_ring_higher": [0.2, 0.85],  # fraction of the 3–10 m ring above the platform (hillside, not valley)
    "linear_threshold_m": 0.3,
    "linear_hysteresis_low_m": 0.12,
    "linear_min_length_m": 30,
    "linear_max_width_m": 10,
    "linear_min_elongation": 4,
    "linear_min_two_sided_m": 0.1,    # ditch/bank must be lower/higher than BOTH sides (else: slope step)
    "linear_valley_lrm_m": 1.0,       # |LRM25| along the line above this → valley floor / crest (natural?)
    "exclude_bldg_buffer_m": 2,
    "exclude_road_buffer_m": 6,       # OSM road/rail
    "exclude_water_buffer_m": 5,      # OSM waterway
    "near_path_m": 5,
    "along_path_fraction": 0.5,       # linear ≥ 50 % along an OSM road/track/path → known path ("Weg (bekannt)")
    "near_known_m": 50,
    "settlement_bldg_fraction": 0.03,  # building cover within ±50 m
    "forest_chm_m": 3,
    # coarse pass (Q-15, rule set 2): large structures on 2 m block means of the 1 m DTM
    "large_enabled": True,
    "large_cell_m": 2,
    "large_lrm_radius_m": 40,         # local relief for terraces, castle mounds, big platforms
    "large_thresholds_m": [0.4, 0.8, 1.5, 3.0],   # component tree: lowest threshold that qualifies wins
    "large_area_m2": [1200, 40000],   # Ø ≈ 40–225 m (the fine mound pass ends at Ø 45 m)
    "large_flat_deg": 6,
    "large_road_corridor_m": 16,      # OSM road/rail buffer (6 m) widened by 16 m: embankments and cuttings
    "large_max_road_edge_fraction": 0.3,   # large region dropped when ≥ 30 % of its edge lies in that corridor
    "large_min_break_deg": 0,         # flank slope − slope 6–16 m outside (artificial edges are a slope break)
    "large_rect_min_rectangularity": 0.85,
    "large_rect_min_side_m": 15,
    "large_rect_min_flank_deg": 8,
    "large_mound_min_circularity": 0.6,
    "large_mound_min_flank_deg": 15,
    "large_mound_min_closed_m": 0.5,
    "large_mound_min_flat": 0.25,     # … and a flattened top (≥ 25 % < large_flat_deg) …
    "large_mound_sharp_break_deg": 6,  # … or a sharp foot (flank − outer slope ≥ 6°)
    "large_platform_min_flat": 0.5,   # fraction of the (eroded) top with slope < large_flat_deg
    "large_platform_min_flank_deg": 15,
    "large_scarped_flank_deg": 20,    # platform with very steep, sharply broken edges may be irregular (spur cut)
    "large_scarped_break_deg": 8,
    "moat_lrm_radius_m": 20,
    "moat_ring_m": 20,                # ditch searched up to 20 m outside a raised region
    "moat_threshold_m": 0.3,
    "moat_min_area_m2": 100,
    "moat_min_coverage": 0.25,        # fraction of 36 direction sectors with ditch cells
    "moat_min_length_m": 30,
    "moat_parent_base": 0.6,          # moat score = parent score × (0.6 + 0.4 × own evidence)
    "scarp_min_slope_deg": 15,        # steep band on the 2 m DTM (20° missed the Karlsbergweiher dam edges)
    "scarp_min_length_m": 30,
    "scarp_max_width_m": 10,
    "scarp_min_straightness": 0.9,
    "scarp_min_step_m": 1.0,
    "scarp_max_side_slope_deg": 10,   # ground above and below the edge flatter than this (median)
    "scarp_corner_m": 10,
    "min_score": 0.3,                 # candidates below are not written
    "mask_min_score": 0.4,
}

# score = Σ weight · sub-score (each 0..1), then × penalty factors (see PENALTIES); informative in the manifest
WEIGHTS: dict[str, float] = {
    "pit.depth": 0.25, "pit.closed": 0.2, "pit.shape": 0.25, "pit.size": 0.15, "pit.rim": 0.15,
    "mound.height": 0.25, "mound.closed": 0.1, "mound.shape": 0.4, "mound.size": 0.15, "mound.ditch": 0.1,
    "rect.rectangularity": 0.5, "rect.relief": 0.25, "rect.size": 0.25,
    "platform.flat": 0.25, "platform.slope_around": 0.25, "platform.shape": 0.25, "platform.size": 0.25,
    "linear.length": 0.3, "linear.straightness": 0.3, "linear.relief": 0.25, "linear.pair": 0.15,
    # coarse pass
    "large.rect.rectangularity": 0.4, "large.rect.flank": 0.3, "large.rect.relief": 0.3,
    "large.mound.flank": 0.3, "large.mound.shape": 0.25, "large.mound.closed": 0.25, "large.mound.break": 0.2,
    "large.platform.flat": 0.3, "large.platform.flank": 0.3, "large.platform.break": 0.2, "large.platform.shape": 0.2,
    "large.moat": 0.15,
    "large.moat.coverage": 0.4, "large.moat.depth": 0.3, "large.moat.length": 0.3,
    "large.scarp.length": 0.25, "large.scarp.straightness": 0.25, "large.scarp.step": 0.3,
    "large.scarp.flat_sides": 0.2, "large.scarp.right_angle": 0.1,
}
PATH_KINDS = ("road", "track", "path")   # OSM kinds that make a linear candidate a known path (not water/barrier)
PENALTIES: dict[str, float] = {
    "uprooted_tree": 0.5, "interpolated": 0.5, "settlement": 0.6, "near_path": 0.7, "platform_near_path": 0.5,
    "edge": 0.8, "one_sided_edge": 0.4, "valley": 0.6,
}


# ----------------------------------------------------------------------------- small helpers
def clamp01(x: float) -> float:
    return float(min(1.0, max(0.0, x)))


def ramp(x: float, lo: float, hi: float) -> float:
    """0 at lo, 1 at hi (linear)."""
    return clamp01((x - lo) / (hi - lo))


def trapezoid(x: float, a: float, b: float, c: float, d: float, tail: float = 0.0) -> float:
    """0 below a, rising to 1 at b, 1 until c, falling to `tail` at d and beyond."""
    if x < a:
        return 0.0
    if x < b:
        return (x - a) / (b - a)
    if x <= c:
        return 1.0
    if x < d:
        return 1.0 - (1.0 - tail) * (x - c) / (d - c)
    return tail


def de_num(x: float, nd: int = 1) -> str:
    """German decimal comma."""
    return f"{x:.{nd}f}".replace(".", ",")


def circularity(area: float, perimeter: float) -> float:
    """4πA/P², 1 for a circle, clipped to 0..1."""
    return clamp01(4 * math.pi * area / perimeter ** 2) if perimeter > 0 else 0.0


def rectangularity(poly) -> float:
    """A / area of the minimum rotated rectangle (1 = rectangle, π/4 ≈ 0.785 = circle)."""
    r = poly.minimum_rotated_rectangle
    return clamp01(poly.area / r.area) if r.area > 0 else 0.0


def orientation_deg(dE: float, dN: float) -> float:
    """Axis direction clockwise from grid north, 0..180."""
    return math.degrees(math.atan2(dE, dN)) % 180.0


def rect_dims(poly) -> tuple[float, float, float]:
    """(long side, short side, long-axis orientation°) of the minimum rotated rectangle."""
    r = poly.minimum_rotated_rectangle
    c = list(r.exterior.coords)
    if len(c) < 4:
        return 0.0, 0.0, 0.0
    s1 = (c[1][0] - c[0][0], c[1][1] - c[0][1])
    s2 = (c[2][0] - c[1][0], c[2][1] - c[1][1])
    l1, l2 = math.hypot(*s1), math.hypot(*s2)
    if l1 >= l2:
        return l1, l2, orientation_deg(*s1)
    return l2, l1, orientation_deg(*s2)


def odd_pad(a: np.ndarray, n: int) -> np.ndarray:
    """Point-symmetric (odd) reflection about the edge cells: continues planes, so local relief stays ≈ 0 at the
    AOI edge instead of the V-shaped artefact plain mirroring produces on slopes."""
    n = min(n, a.shape[0] - 1, a.shape[1] - 1)
    return np.pad(a, n, mode="reflect", reflect_type="odd")


def box_mean(a: np.ndarray, r: int) -> np.ndarray:
    n = min(r + 1, a.shape[0] - 1, a.shape[1] - 1)
    out = ndimage.uniform_filter(odd_pad(a, n), size=2 * r + 1, mode="nearest")
    return out[n:-n, n:-n] if n > 0 else out


def inside_mean(a: np.ndarray, r: int) -> np.ndarray:
    """Box mean over the cells of the (2r+1)² window that lie inside the raster (no padding): for masks and
    slope context, where odd reflection would let a single edge row/column dominate (audit pipeline-3).
    Keep `box_mean` (odd padding) for the height LRM."""
    a = a.astype(np.float64)
    size = 2 * r + 1
    num = ndimage.uniform_filter(a, size=size, mode="constant", cval=0.0)
    den = ndimage.uniform_filter(np.ones_like(a), size=size, mode="constant", cval=0.0)
    return (num / np.maximum(den, 1e-12)).astype(np.float32)


def gauss(a: np.ndarray, sigma: float) -> np.ndarray:
    n = min(int(4 * sigma + 1), a.shape[0] - 1, a.shape[1] - 1)
    out = ndimage.gaussian_filter(odd_pad(a, n), sigma, mode="nearest")
    return out[n:-n, n:-n] if n > 0 else out


def disk(r: float) -> np.ndarray:
    n = int(math.ceil(r))
    y, x = np.mgrid[-n:n + 1, -n:n + 1]
    return (x * x + y * y) <= r * r + 1e-9


def hysteresis(a: np.ndarray, low: float, high: float) -> np.ndarray:
    """Cells ≥ low that are 8-connected to a cell ≥ high."""
    lo = a >= low
    lab, n = ndimage.label(lo, structure=np.ones((3, 3)))
    if n == 0:
        return lo
    keep = np.zeros(n + 1, bool)
    keep[np.unique(lab[a >= high])] = True
    keep[0] = False
    return keep[lab]


def densify(pts: Sequence[Sequence[float]], max_seg: float = _DENSIFY_STEP) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = [tuple(pts[0][:2])] if pts else []
    for p, q in zip(pts, pts[1:]):
        d = math.hypot(q[0] - p[0], q[1] - p[1])
        n = max(1, math.ceil(d / max_seg - 1e-9))
        for k in range(1, n):
            t = k / n
            out.append((p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])))
        out.append((q[0], q[1]))
    return out


# ----------------------------------------------------------------------------- context
@dataclass
class Grid:
    """AOI raster frame (PixelIsArea): cell (r, c) centre = (e0 + (c + 0.5)·cell, n_top − (r + 0.5)·cell).
    `cell` = 1 m for the AOI DTM, 2 m for the coarse pass."""
    e0: float
    n_top: float
    shape: tuple[int, int]
    cell: float = 1.0

    def en(self, r, c):
        return (self.e0 + (np.asarray(c, float) + 0.5) * self.cell,
                self.n_top - (np.asarray(r, float) + 0.5) * self.cell)

    def rc(self, E, N):
        return ((self.n_top - np.asarray(N, float)) / self.cell - 0.5,
                (np.asarray(E, float) - self.e0) / self.cell - 0.5)

    @property
    def transform(self):
        from rasterio.transform import from_origin
        return from_origin(self.e0, self.n_top, self.cell, self.cell)


@dataclass
class Context:
    """Optional rasters/vectors used for filters and flags (all AOI-shaped, row 0 = north)."""
    chm: np.ndarray | None = None
    bldg: np.ndarray | None = None          # bool/u8 building footprints
    fillmask: np.ndarray | None = None      # build `mask`: 0 SL, 0.5 RLP, 1 interpolated
    osm: list[tuple[str, Any]] = field(default_factory=list)   # (kind, shapely LineString 2D)


@dataclass
class Candidate:
    cls: str
    score: float
    E: float
    N: float
    metrics: dict[str, float]
    reasons: list[str]
    outline: Any = None            # shapely Polygon / LineString (EPSG:25832, 2D)
    cells: np.ndarray | None = None   # flat indices of footprint cells (for forest/mask stats)
    forest: bool = False
    near_path: bool = False        # any OSM feature (incl. water/barrier) within near_path_m — informative
    along_path: bool = False       # linear only: ≥ along_path_fraction of it within near_path_m of a road/track/path
    near_known: str | None = None
    id: str = ""


def rasterize_buffer(geoms: Iterable[Any], dist: float, grid: Grid) -> np.ndarray:
    from rasterio.features import rasterize
    shapes = [(g.buffer(dist, 8), 1) for g in geoms if not g.is_empty]
    if not shapes:
        return np.zeros(grid.shape, bool)
    return rasterize(shapes, out_shape=grid.shape, transform=grid.transform, fill=0, dtype="uint8").astype(bool)


# ----------------------------------------------------------------------------- region geometry
def region_polygon(sub: np.ndarray, r0: int, c0: int, grid: Grid):
    """Outline polygon (EPSG:25832) of a boolean region crop whose [0, 0] is AOI cell (r0, c0)."""
    from shapely.geometry import Polygon
    from skimage.measure import find_contours
    pad = np.pad(sub.astype(np.float32), 1)
    cs = find_contours(pad, 0.5, fully_connected="high")
    if not cs:
        return None
    ring = max(cs, key=len)
    rr = ring[:, 0] - 1 + r0
    cc = ring[:, 1] - 1 + c0
    E, N = grid.en(rr, cc)
    if len(E) < 4:
        return None
    poly = Polygon(np.column_stack([E, N]))
    if not poly.is_valid:
        poly = poly.buffer(0)
        if poly.geom_type == "MultiPolygon":
            poly = max(poly.geoms, key=lambda g: g.area)
    return poly if poly.area > 0 else None


def centre_cell(sub: np.ndarray, r0: int, c0: int) -> tuple[int, int]:
    """Centroid cell of a region; moved to the nearest inside cell when the centroid lies outside."""
    rr, cc = np.nonzero(sub)
    rm, cm = rr.mean(), cc.mean()
    ri, ci = int(round(rm)), int(round(cm))
    if not (0 <= ri < sub.shape[0] and 0 <= ci < sub.shape[1] and sub[ri, ci]):
        k = int(np.argmin((rr - rm) ** 2 + (cc - cm) ** 2))
        ri, ci = int(rr[k]), int(cc[k])
    return r0 + ri, c0 + ci


def closed_depth(dtm: np.ndarray, sub: np.ndarray, r0: int, c0: int, margin: int = 3, dome: bool = False) -> float:
    """Depth (m) of a region below the lowest spill point on a ring `margin` cells around it (local priority
    fill by morphological reconstruction). `dome=True`: height of the region above the highest point on the
    ring that it must exceed (inverse). 0 when the region is open (drains/merges into the surroundings)."""
    from skimage.morphology import reconstruction
    H, W = dtm.shape
    a0, b0 = max(0, r0 - margin), max(0, c0 - margin)
    a1, b1 = min(H, r0 + sub.shape[0] + margin), min(W, c0 + sub.shape[1] + margin)
    z = dtm[a0:a1, b0:b1].astype(np.float64)
    if dome:
        z = -z
    seed = np.full_like(z, z.max())
    seed[0, :], seed[-1, :], seed[:, 0], seed[:, -1] = z[0, :], z[-1, :], z[:, 0], z[:, -1]
    with warnings.catch_warnings():   # skimage 0.26 sets ndarray.shape (NumPy 2.5 DeprecationWarning)
        warnings.simplefilter("ignore", DeprecationWarning)
        filled = reconstruction(seed, z, method="erosion")
    depth = filled - z
    inner = depth[r0 - a0:r0 - a0 + sub.shape[0], c0 - b0:c0 - b0 + sub.shape[1]][sub]
    return float(inner.max()) if inner.size else 0.0


def ring_stats(z: np.ndarray, sub: np.ndarray, r0: int, c0: int, width: int = 3, bands: int = 8,
               far: tuple[int, int] = (10, 16)) -> tuple[float, float, float, float, float]:
    """Rim/ditch around a region, measured on the (smoothed) DTM against a plane fitted to a far ring (`far`
    cells from the region edge), so neither the slope nor the region itself biases it (an LRM box mean would
    include the pit/mound and fake a rim/ditch). Residuals are averaged in 1 m distance bands 1…`bands` m from
    the region edge. Returns
      rim    max band mean (m; > 0 = raised rim, e.g. crater ejecta),
      frac   fraction of cells 1…`width` m out that are ≥ 0.1 m above the plane,
      one    one-sidedness 0…1 of the positive residuals 1…`width` m out (0 = all around, 1 = one side:
             uprooted tree = pit + root-plate mound),
      dip    −min band mean (m; > 0 = a surrounding ditch/depression, e.g. a barrow's ring ditch),
      peak   90th percentile of the residuals 1…`width` m out (m; a local spoil heap / root plate)."""
    H, W = z.shape
    m = far[1]
    a0, b0 = max(0, r0 - m), max(0, c0 - m)
    a1, b1 = min(H, r0 + sub.shape[0] + m), min(W, c0 + sub.shape[1] + m)
    big = np.zeros((a1 - a0, b1 - b0), bool)
    big[r0 - a0:r0 - a0 + sub.shape[0], c0 - b0:c0 - b0 + sub.shape[1]] = sub
    dist = ndimage.distance_transform_edt(~big)
    ring_o = (dist >= far[0]) & (dist <= far[1])
    if ring_o.sum() < 6:
        return 0.0, 0.0, 0.0, 0.0, 0.0
    zz = z[a0:a1, b0:b1].astype(np.float64)
    ro, co = np.nonzero(ring_o)
    A = np.column_stack([np.ones(len(ro)), ro, co])
    coef, *_ = np.linalg.lstsq(A, zz[ro, co], rcond=None)
    rr, cc = np.mgrid[0:zz.shape[0], 0:zz.shape[1]]
    res = zz - (coef[0] + coef[1] * rr + coef[2] * cc)
    means = [float(res[(dist > k - 1) & (dist <= k)].mean()) for k in range(1, bands + 1)
             if ((dist > k - 1) & (dist <= k)).any()]
    inner = (dist > 0) & (dist <= width)
    ri, ci = np.nonzero(inner)
    pos = np.clip(res[ri, ci], 0, None)
    one_sided = 0.0
    if pos.sum() > 1e-6:
        cr, cc0 = np.nonzero(big)
        dy, dx = ri - cr.mean(), ci - cc0.mean()
        d = np.hypot(dy, dx) + 1e-9
        one_sided = float(math.hypot((pos * dy / d).sum(), (pos * dx / d).sum()) / pos.sum())
    if not means or not len(ri):
        return 0.0, 0.0, 0.0, 0.0, 0.0
    return (max(means), float((res[ri, ci] >= 0.1).mean()), one_sided, max(0.0, -min(means)),
            float(np.percentile(res[ri, ci], 90)))


# ----------------------------------------------------------------------------- detector
@dataclass
class Rasters:
    dtm: np.ndarray
    smooth: np.ndarray
    lrm_lin: np.ndarray
    lrm_pit: np.ndarray
    lrm_mound: np.ndarray
    slope: np.ndarray


def compute_rasters(dtm: np.ndarray, params: dict = PARAMS) -> Rasters:
    d = dtm.astype(np.float32)
    s = gauss(d, params["smooth_sigma_m"])
    rad = params["lrm_radius_m"]
    gy, gx = np.gradient(gauss(d, 1.5))
    slope = np.degrees(np.arctan(np.hypot(gx, gy))).astype(np.float32)
    return Rasters(d, s, s - box_mean(d, rad["linear"]), s - box_mean(d, rad["pit"]), s - box_mean(d, rad["mound"]),
                   slope)


@dataclass
class Exclusion:
    blocked: np.ndarray        # building / road / rail / water: regions overlapping ≥ 25 % are dropped
    water: np.ndarray
    road: np.ndarray
    settlement: np.ndarray     # down-weight
    interpolated: np.ndarray   # down-weight
    embank: np.ndarray | None = None   # coarse pass: OSM road/rail corridor incl. embankments/cuttings (drop)


def build_exclusion(grid: Grid, ctx: Context, params: dict = PARAMS) -> Exclusion:
    H, W = grid.shape
    bl = np.zeros((H, W), bool)
    settle = np.zeros((H, W), bool)
    if ctx.bldg is not None:
        b = ctx.bldg > 0
        settle = inside_mean(b.astype(np.float32), 50) > params["settlement_bldg_fraction"]
        bl |= ndimage.binary_dilation(b, structure=disk(params["exclude_bldg_buffer_m"]))
    roads = [g for k, g in ctx.osm if k in ("road", "rail")]
    waters = [g for k, g in ctx.osm if k == "water"]
    road = rasterize_buffer(roads, params["exclude_road_buffer_m"], grid)
    water = rasterize_buffer(waters, params["exclude_water_buffer_m"], grid)
    interp = (ctx.fillmask >= 0.99) if ctx.fillmask is not None else np.zeros((H, W), bool)
    return Exclusion(bl | road | water, water, road, settle, interp)


def _blob_regions(mask: np.ndarray, min_area: int, max_area: int):
    lab, n = ndimage.label(mask, structure=np.ones((3, 3)))
    if n == 0:
        return lab, []
    areas = np.bincount(lab.ravel(), minlength=n + 1)
    slices = ndimage.find_objects(lab)
    out = []
    for k, sl in enumerate(slices, start=1):
        if sl is None or not (min_area <= areas[k] <= max_area):
            continue
        out.append((k, sl))
    return lab, out


def _overlap(sub: np.ndarray, layer: np.ndarray, sl) -> float:
    return float(layer[sl][sub].mean()) if sub.any() else 0.0


def _touches_edge(sl, shape) -> bool:
    return sl[0].start == 0 or sl[1].start == 0 or sl[0].stop == shape[0] or sl[1].stop == shape[1]


def _common_penalties(sub, sl, ex: Exclusion, reasons: list[str]) -> float:
    f = 1.0
    if _overlap(sub, ex.interpolated, sl) > 0.3:
        f *= PENALTIES["interpolated"]
        reasons.append("teilweise interpolierte Daten (abgewertet)")
    if _overlap(sub, ex.settlement, sl) > 0.5:
        f *= PENALTIES["settlement"]
        reasons.append("Siedlungsbereich (abgewertet)")
    return f


def detect_blobs(R: Rasters, grid: Grid, ex: Exclusion, params: dict = PARAMS) -> list[Candidate]:
    """Pits (LRM10 negative), mounds (LRM25 positive) and their rectangular variants."""
    out: list[Candidate] = []
    t, lo = params["threshold_m"], params["hysteresis_low_m"]
    H, W = grid.shape
    dmin, dmax = params["mound_diameter_m"]
    specs = [
        ("pit", -R.lrm_pit, params["pit_area_m2"]),
        ("mound", R.lrm_mound, [math.pi * (dmin / 2) ** 2, math.pi * (dmax / 2) ** 2]),
    ]
    for kind, rel, (amin, amax) in specs:
        lab, regs = _blob_regions(hysteresis(rel, lo, t), int(amin), int(max(amax, params["rect_max_area_m2"])))
        for k, sl in regs:
            sub = lab[sl] == k
            if _overlap(sub, ex.blocked, sl) >= 0.25:
                continue
            big_region = sub.sum() > amax   # only kept if it turns out rectangular (cellar, foundation pit)
            filled = ndimage.binary_fill_holes(sub)
            r0, c0 = sl[0].start, sl[1].start
            poly = region_polygon(filled, r0, c0, grid)
            if poly is None:
                continue
            area = float(filled.sum())
            relief = float(rel[sl][sub].max())       # depth (pit) or height (mound), m
            circ = circularity(poly.area, poly.length)
            rect = rectangularity(poly)
            L, Wd, ori = rect_dims(poly)
            diam = 2 * math.sqrt(area / math.pi)
            slope_in = float(R.slope[sl][sub].mean())
            reasons: list[str] = []
            m: dict[str, float] = {"area_m2": area, "diameter_m": diam, "circularity": circ, "rectangularity": rect,
                                   "slope_in_deg": slope_in}
            is_rect = (rect >= params["rect_min_rectangularity"] and circ <= params["rect_max_circularity"]
                       and area >= params["rect_min_area_m2"]
                       and Wd >= params["rect_min_side_m"])
            if big_region and not is_rect:
                continue
            if is_rect:
                cls = "rect"
                m.update(length_m=L, width_m=Wd, orientation_deg=ori)
                m["depth_m" if kind == "pit" else "height_m"] = relief
                s = (WEIGHTS["rect.rectangularity"] * ramp(rect, 0.8, 0.95)
                     + WEIGHTS["rect.relief"] * ramp(relief, 0.2, 1.0)
                     + WEIGHTS["rect.size"] * trapezoid(area, 15, 25, 600, 2000, 0.3))
                reasons.append(f"rechteckig ({de_num(L, 0)} × {de_num(Wd, 0)} m, Rechteckigkeit {de_num(rect, 2)})")
                reasons.append(f"{de_num(relief)} m {'tief' if kind == 'pit' else 'hoch'}")
            elif kind == "pit":
                cls = "pit"
                closed = closed_depth(R.smooth, sub, r0, c0)
                if closed < params["pit_min_closed_m"]:
                    continue  # open hollow (slope concavity, gully head), not a pit
                rim, rim_frac, one_sided, _, peak = ring_stats(R.smooth, sub, r0, c0)
                m.update(depth_m=relief, rim_m=max(0.0, rim), closed_depth_m=closed)
                s_rim = ramp(rim, 0.0, 0.3) * ramp(rim_frac, 0.3, 0.8) * (1 - one_sided)
                s = (WEIGHTS["pit.depth"] * ramp(relief, 0.3, 1.2)
                     + WEIGHTS["pit.closed"] * ramp(closed, 0.1, 0.5)
                     + WEIGHTS["pit.shape"] * ramp(circ, 0.5, 0.85)
                     + WEIGHTS["pit.size"] * trapezoid(diam, 2, 5, 15, 25, 0.3)
                     + WEIGHTS["pit.rim"] * s_rim)
                reasons.append(f"{'rund' if circ >= 0.75 else 'unregelmäßig'}, {de_num(relief)} m tief, "
                               f"Ø {de_num(diam, 0)} m")
                if s_rim > 0.3:
                    reasons.append(f"mit Randwall ({de_num(rim, 2)} m)")
                if diam < 6 and one_sided > 0.5 and peak >= 0.15:
                    s *= PENALTIES["uprooted_tree"]
                    reasons.append("einseitiger Aufwurf – evtl. Wurzelteller (abgewertet)")
            else:
                cls = "mound"
                if circ < params["mound_min_circularity"]:
                    continue  # ridge/crest segment
                closed = closed_depth(R.smooth, sub, r0, c0, dome=True)
                _, _, _, dip, _ = ring_stats(R.smooth, sub, r0, c0)
                m.update(height_m=relief, closed_height_m=closed)
                s_ditch = ramp(dip, 0.05, 0.25)
                s = (WEIGHTS["mound.height"] * ramp(relief, 0.3, 1.5)
                     + WEIGHTS["mound.closed"] * ramp(closed, 0.1, 0.6)
                     + WEIGHTS["mound.shape"] * ramp(circ, 0.6, 0.85)
                     + WEIGHTS["mound.size"] * trapezoid(diam, 4, 8, 30, 45, 0.2)
                     + WEIGHTS["mound.ditch"] * s_ditch)
                reasons.append(f"{'rund' if circ >= 0.75 else 'unregelmäßig'}, {de_num(relief)} m hoch, "
                               f"Ø {de_num(diam, 0)} m")
                if s_ditch > 0.3:
                    reasons.append("mit umlaufender Senke (Kreisgraben?)")
            s *= _common_penalties(sub, sl, ex, reasons)
            if _touches_edge(sl, (H, W)):
                s *= PENALTIES["edge"]
                reasons.append("am Gebietsrand angeschnitten")
            r, c = centre_cell(filled, r0, c0)
            E, N = grid.en(r, c)
            rr, cc = np.nonzero(filled)
            out.append(Candidate(cls, clamp01(s), float(E), float(N), m, reasons, poly,
                                 cells=(rr + r0) * W + (cc + c0)))
    return out


def detect_platforms(R: Rasters, grid: Grid, ex: Exclusion, params: dict = PARAMS) -> list[Candidate]:
    """Flat discs on slopes (charcoal-kiln platforms, small terraces)."""
    H, W = grid.shape
    flat = R.slope < params["platform_max_slope_deg"]
    around = inside_mean(R.slope, params["platform_context_radius_m"])
    cand = ndimage.binary_opening(flat, structure=disk(2.5)) & (around >= params["platform_context_slope_deg"])
    amin, amax = params["platform_area_m2"]
    lab, regs = _blob_regions(cand, int(amin), int(amax))
    out: list[Candidate] = []
    for k, sl in regs:
        sub = lab[sl] == k
        if _overlap(sub, ex.blocked, sl) >= 0.25:
            continue
        r0, c0 = sl[0].start, sl[1].start
        filled = ndimage.binary_fill_holes(sub)
        poly = region_polygon(filled, r0, c0, grid)
        if poly is None:
            continue
        area = float(filled.sum())
        circ = circularity(poly.area, poly.length)
        L, Wd, ori = rect_dims(poly)
        if Wd <= 0 or L / Wd > 2.0:
            continue  # elongated flat strip = track/terrace, not a platform
        diam = 2 * math.sqrt(area / math.pi)
        slope_in = float(R.slope[sl][sub].mean())
        # slope in a 3–10 m ring around the platform
        a0, b0 = max(0, r0 - 10), max(0, c0 - 10)
        a1, b1 = min(H, sl[0].stop + 10), min(W, sl[1].stop + 10)
        big = np.zeros((a1 - a0, b1 - b0), bool)
        big[r0 - a0:r0 - a0 + sub.shape[0], c0 - b0:c0 - b0 + sub.shape[1]] = filled
        ring = ndimage.binary_dilation(big, structure=disk(10)) & ~ndimage.binary_dilation(big, structure=disk(3))
        sa = float(R.slope[a0:a1, b0:b1][ring].mean()) if ring.any() else 0.0
        if sa < params["platform_context_slope_deg"]:
            continue
        # a kiln platform is cut into a hillside: part of the ring above, part below the platform level.
        # Ring almost entirely higher = valley floor; almost entirely lower = summit/spur → not a platform.
        zr = R.smooth[a0:a1, b0:b1][ring]
        zp = float(R.smooth[sl][sub].mean())
        higher = float((zr > zp).mean()) if zr.size else 0.0
        if not (params["platform_ring_higher"][0] <= higher <= params["platform_ring_higher"][1]):
            continue
        # terrace step: platform height vs the surrounding plane (positive downhill part, LRM25)
        height = float(np.clip(R.lrm_mound[sl][sub], 0, None).max())
        reasons = [f"ebene Fläche Ø {de_num(diam, 0)} m ({de_num(slope_in)}° geneigt)",
                   f"im Hang ({de_num(sa, 0)}° ringsum)"]
        if 7 <= diam <= 16:
            reasons.append("Größe passt zu Meilerplatz")
        s = (WEIGHTS["platform.flat"] * ramp(8 - slope_in, 0, 6)
             + WEIGHTS["platform.slope_around"] * ramp(sa, 10, 25)
             + WEIGHTS["platform.shape"] * ramp(circ, 0.5, 0.9)
             + WEIGHTS["platform.size"] * trapezoid(diam, 5, 8, 15, 25, 0.0))
        s *= _common_penalties(sub, sl, ex, reasons)
        if _touches_edge(sl, (H, W)):
            s *= PENALTIES["edge"]
            reasons.append("am Gebietsrand angeschnitten")
        r, c = centre_cell(filled, r0, c0)
        E, N = grid.en(r, c)
        rr, cc = np.nonzero(filled)
        m = {"area_m2": area, "diameter_m": diam, "circularity": circ, "slope_in_deg": slope_in,
             "slope_around_deg": sa, "orientation_deg": ori}
        if height > 0.05:
            m["height_m"] = height
        out.append(Candidate("platform", clamp01(s), float(E), float(N), m, reasons, poly,
                             cells=(rr + r0) * W + (cc + c0)))
    return out


def longest_path(sk: np.ndarray) -> np.ndarray:
    """Pixel path (k × 2, row/col in the crop) of the longest geodesic path through a skeleton crop."""
    rr, cc = np.nonzero(sk)
    n = len(rr)
    if n == 1:
        return np.column_stack([rr, cc])
    idx = -np.ones(sk.shape, np.int64)
    idx[rr, cc] = np.arange(n)
    src, dst, w = [], [], []
    for dr, dc in ((0, 1), (1, -1), (1, 0), (1, 1)):
        r2, c2 = rr + dr, cc + dc
        ok = (r2 >= 0) & (r2 < sk.shape[0]) & (c2 >= 0) & (c2 < sk.shape[1])
        j = np.full(n, -1)
        j[ok] = idx[r2[ok], c2[ok]]
        has = j >= 0
        src.append(np.nonzero(has)[0])
        dst.append(j[has])
        w.append(np.full(has.sum(), math.hypot(dr, dc)))
    s, d, ww = np.concatenate(src), np.concatenate(dst), np.concatenate(w)
    g = coo_matrix((ww, (s, d)), shape=(n, n)).tocsr()
    d0 = dijkstra(g, directed=False, indices=0)
    a = int(np.nanargmax(np.where(np.isfinite(d0), d0, -1)))
    da, pred = dijkstra(g, directed=False, indices=a, return_predecessors=True)
    b = int(np.nanargmax(np.where(np.isfinite(da), da, -1)))
    path = [b]
    while path[-1] != a and pred[path[-1]] >= 0:
        path.append(int(pred[path[-1]]))
    p = np.array(path[::-1])
    return np.column_stack([rr[p], cc[p]])


def cross_profile(z: np.ndarray, pr: np.ndarray, pc: np.ndarray, width: float, sign: int,
                  step: int = 2) -> tuple[float, float]:
    """Cross-section check along a centreline (pixel path pr/pc): samples the smoothed DTM on both sides at
    width/2 + 2.5 m perpendicular to the local direction. Returns (two-sided relief, one-sided step), medians in m:
    ditch (sign −1): min(left, right) − centre; bank (sign +1): centre − max(left, right); step: |left − right|.
    A ditch/bank has two-sided relief > 0; a terrace edge / slope break has ~0 two-sided relief and a large step."""
    H, W = z.shape
    n = len(pr)
    if n < 5:
        return 0.0, 0.0
    off = width / 2 + 2.5
    k = 3
    two, stp = [], []
    for i in range(0, n, step):
        a, b = max(0, i - k), min(n - 1, i + k)
        dr, dc = float(pr[b] - pr[a]), float(pc[b] - pc[a])
        L = math.hypot(dr, dc)
        if L == 0:
            continue
        nr, nc = -dc / L, dr / L
        r1, c1 = int(round(pr[i] + nr * off)), int(round(pc[i] + nc * off))
        r2, c2 = int(round(pr[i] - nr * off)), int(round(pc[i] - nc * off))
        if not (0 <= r1 < H and 0 <= c1 < W and 0 <= r2 < H and 0 <= c2 < W):
            continue
        zc, zl, zr = float(z[pr[i], pc[i]]), float(z[r1, c1]), float(z[r2, c2])
        two.append(min(zl, zr) - zc if sign < 0 else zc - max(zl, zr))
        stp.append(abs(zl - zr))
    if not two:
        return 0.0, 0.0
    return float(np.median(two)), float(np.median(stp))


def detect_linear(R: Rasters, grid: Grid, ex: Exclusion, ctx: Context, params: dict = PARAMS) -> list[Candidate]:
    """Ditches/hollow ways (LRM7 negative) and banks/walls/terrace edges (LRM7 positive) + closed wall rings."""
    from shapely.geometry import LineString
    from skimage.morphology import skeletonize
    H, W = grid.shape
    t, lo = params["linear_threshold_m"], params["linear_hysteresis_low_m"]
    minlen, maxw = params["linear_min_length_m"], params["linear_max_width_m"]
    out: list[Candidate] = []
    accepted: dict[str, np.ndarray] = {}
    raw: list[tuple[str, Candidate, np.ndarray]] = []
    for sign, kind in ((-1, "ditch"), (1, "bank")):
        rel = sign * R.lrm_lin
        lab, regs = _blob_regions(hysteresis(rel, lo, t), int(minlen * 1.5), 20000)
        acc = np.zeros((H, W), bool)
        for k, sl in regs:
            sub = lab[sl] == k
            r0, c0 = sl[0].start, sl[1].start
            if kind == "bank":
                rc = _wall_ring(sub, r0, c0, rel, sl, grid, ex, params)
                if rc is not None:
                    out.append(rc)
            sk = skeletonize(sub)
            if sk.sum() < minlen * 0.7:
                continue
            path = longest_path(sk)
            seg = np.hypot(*np.diff(path, axis=0).T)
            length = float(seg.sum())
            area = float(sub.sum())
            width = area / max(length, 1.0)
            if length < minlen or width > maxw or length / max(width, 1.0) < params["linear_min_elongation"]:
                continue
            E, N = grid.en(path[:, 0] + r0, path[:, 1] + c0)
            line = LineString(np.column_stack([E, N])).simplify(0.75)
            if line.length < minlen:
                continue
            # exclusions along the centreline
            pr, pc = path[:, 0] + r0, path[:, 1] + c0
            if ex.water[pr, pc].mean() >= 0.5 or ex.road[pr, pc].mean() >= 0.6 or ex.blocked[pr, pc].mean() >= 0.6:
                continue
            chord = math.hypot(E[-1] - E[0], N[-1] - N[0])
            straight = chord / max(line.length, 1e-6)
            relief = float(rel[sl][sub].max())
            two_sided, step = cross_profile(R.smooth, pr, pc, width, sign)
            sym = two_sided >= params["linear_min_two_sided_m"]
            if sym:
                what = "Rinne/Graben/Hohlweg" if kind == "ditch" else "Wall/Mauer/Damm"
            else:
                what = "Geländekante/Hangstufe"
            reasons = [f"{what} {de_num(line.length, 0)} m lang, {de_num(width, 0)} m breit",
                       f"{de_num(relief)} m {'tief' if kind == 'ditch' else 'hoch'}"]
            if straight >= 0.9:
                reasons.append("geradlinig")
            m = {"length_m": float(line.length), "width_m": width, "orientation_deg": orientation_deg(
                E[-1] - E[0], N[-1] - N[0]), "straightness": straight,
                ("depth_m" if kind == "ditch" else "height_m"): relief, "two_sided_m": max(0.0, two_sided),
                "step_m": step}
            s = (WEIGHTS["linear.length"] * ramp(line.length, minlen, 100)
                 + WEIGHTS["linear.straightness"] * ramp(straight, 0.6, 0.95)
                 + WEIGHTS["linear.relief"] * ramp(two_sided, 0.1, 0.8))
            if not sym:
                s *= PENALTIES["one_sided_edge"]
                reasons.append("einseitige Stufe, evtl. natürlich (abgewertet)")
            big = float(np.median(R.lrm_mound[pr, pc])) * sign
            if big > params["linear_valley_lrm_m"]:
                s *= PENALTIES["valley"]
                reasons.append(("in einer Talsohle – evtl. natürliche Rinne" if kind == "ditch"
                                else "auf einem Geländerücken – evtl. natürlich") + " (abgewertet)")
            s *= _common_penalties(sub, sl, ex, reasons)
            mid = line.interpolate(0.5, normalized=True)
            cells = (pr * W + pc)
            cand = Candidate("linear", s, float(mid.x), float(mid.y), m, reasons, line, cells=cells)
            raw.append((kind, cand, cells))
            acc[pr, pc] = True
        accepted[kind] = acc
    # ditch + bank pair bonus (parallel companion within 6 m along ≥ 30 % of the line)
    near = {k: ndimage.binary_dilation(v, structure=disk(6)) for k, v in accepted.items()}
    for kind, cand, cells in raw:
        other = near["bank" if kind == "ditch" else "ditch"].ravel()[cells]
        frac = float(other.mean()) if len(cells) else 0.0
        s_pair = ramp(frac, 0.1, 0.5)
        if s_pair > 0.3:
            cand.reasons.append("mit begleitendem " + ("Wall" if kind == "ditch" else "Graben"))
        cand.score = clamp01(cand.score + WEIGHTS["linear.pair"] * s_pair)
        out.append(cand)
    return out


def _wall_ring(sub, r0, c0, rel, sl, grid, ex, params) -> Candidate | None:
    """A positive-relief region enclosing a rectangular hole (foundation walls) → `rect` candidate."""
    filled = ndimage.binary_fill_holes(sub)
    holes = filled.sum() - sub.sum()
    if holes < 0.25 * filled.sum() or filled.sum() < params["rect_min_area_m2"] or filled.sum() > 5000:
        return None
    if _overlap(filled, ex.blocked, sl) >= 0.25:
        return None
    poly = region_polygon(filled, r0, c0, grid)
    if poly is None:
        return None
    rect = rectangularity(poly)
    L, Wd, ori = rect_dims(poly)
    if (rect < params["rect_min_rectangularity"] or Wd < params["rect_min_side_m"]
            or circularity(poly.area, poly.length) > params["rect_max_circularity"]):
        return None
    area = float(filled.sum())
    height = float(rel[sl][sub].max())
    reasons = [f"rechteckige Umfassung ({de_num(L, 0)} × {de_num(Wd, 0)} m, Rechteckigkeit {de_num(rect, 2)})",
               f"Mauer-/Wallrücken {de_num(height)} m hoch"]
    s = (WEIGHTS["rect.rectangularity"] * ramp(rect, 0.8, 0.95) + WEIGHTS["rect.relief"] * ramp(height, 0.2, 1.0)
         + WEIGHTS["rect.size"] * trapezoid(area, 15, 25, 600, 2000, 0.3))
    s *= _common_penalties(filled, sl, ex, reasons)
    r, c = centre_cell(filled, r0, c0)
    E, N = grid.en(r, c)
    rr, cc = np.nonzero(filled)
    W = grid.shape[1]
    return Candidate("rect", clamp01(s), float(E), float(N),
                     {"area_m2": area, "rectangularity": rect, "length_m": L, "width_m": Wd, "orientation_deg": ori,
                      "height_m": height, "circularity": circularity(poly.area, poly.length)},
                     reasons, poly, cells=(rr + r0) * W + (cc + c0))


def uprooted_pairs(cands: list[Candidate], params: dict = PARAMS) -> int:
    """Uprooted trees leave a small pit with the root-plate mound right next to it: a small pit and a small mound
    whose outlines are ≤ `uprooted_gap_m` apart are both down-weighted. Returns the number of pairs."""
    pits = [c for c in cands if c.cls == "pit" and c.metrics.get("diameter_m", 99) < params["uprooted_max_pit_m"]]
    mounds = [c for c in cands if c.cls == "mound" and c.metrics.get("diameter_m", 99) < params["uprooted_max_mound_m"]]
    n = 0
    hit: set[int] = set()
    for p in pits:
        for m in mounds:
            gap = math.hypot(p.E - m.E, p.N - m.N) - (p.metrics["diameter_m"] + m.metrics["diameter_m"]) / 2
            if gap <= params["uprooted_gap_m"]:
                n += 1
                for c in (p, m):
                    if id(c) not in hit:
                        hit.add(id(c))
                        c.score *= PENALTIES["uprooted_tree"]
                        c.reasons.append("Grube + Hügel dicht nebeneinander – evtl. Wurzelteller (abgewertet)")
    return n


def dedupe(cands: list[Candidate], dist: float = 5.0) -> list[Candidate]:
    """Drop lower-scored non-linear candidates whose centre lies within `dist` m of a better one whose outline
    contains it (same object found by two rules, e.g. mound + platform + rect)."""
    from shapely import STRtree
    from shapely.geometry import Point
    blobs = sorted([c for c in cands if c.cls != "linear"], key=lambda c: -c.score)
    kept: list[Candidate] = []
    pts: list[Any] = []
    for c in blobs:
        if pts:
            tree = STRtree(pts)
            hit = tree.query(Point(c.E, c.N), predicate="dwithin", distance=dist)
            if any(kept[i].outline is not None and kept[i].outline.buffer(1).contains(Point(c.E, c.N))
                   and kept[i].cls != c.cls for i in hit):
                continue
        kept.append(c)
        pts.append(Point(c.E, c.N))
    return kept + [c for c in cands if c.cls == "linear"]


def along_fraction(line, ways: Sequence[Any], dist: float, step: float = 2.0) -> float:
    """Fraction of a line (sampled every `step` m) lying within `dist` m of any of `ways`."""
    from shapely import distance, points
    if line is None or line.length == 0 or not ways:
        return 0.0
    n = max(2, int(line.length / step) + 1)
    pts = points([line.interpolate(i / (n - 1), normalized=True).coords[0] for i in range(n)])
    dmin = np.full(n, np.inf)
    for w in ways:
        dmin = np.minimum(dmin, distance(pts, w))
    return float((dmin <= dist).mean())


def flag(cands: list[Candidate], grid: Grid, ctx: Context, pois: list[tuple[str, float, float]],
         params: dict = PARAMS) -> None:
    from shapely import STRtree
    from shapely.geometry import Point
    chm = ctx.chm.ravel() if ctx.chm is not None else None
    tree = STRtree([g for _, g in ctx.osm]) if ctx.osm else None
    for c in cands:
        if chm is not None and c.cells is not None and len(c.cells):
            c.forest = bool((chm[c.cells] >= params["forest_chm_m"]).mean() >= 0.5)
        if c.forest:
            c.reasons.append("unter Wald")
        along = 0.0
        if tree is not None:
            geom = c.outline if c.outline is not None else Point(c.E, c.N)
            hits = tree.query(geom, predicate="dwithin", distance=params["near_path_m"])
            c.near_path = len(hits) > 0   # contract: any OSM way within 5 m
            if c.near_path and c.cls == "linear":
                ways = [tree.geometries[i] for i in hits if ctx.osm[i][0] in PATH_KINDS]
                along = along_fraction(c.outline, ways, params["near_path_m"])
                c.along_path = along >= params["along_path_fraction"]
        if c.near_path:
            if c.along_path:
                c.score *= PENALTIES["near_path"]
                c.reasons.append(f"verläuft zu {round(along * 100)} % entlang eines OSM-Wegs (Weg bekannt)")
            elif c.cls == "linear":
                c.reasons.append("kreuzt/berührt einen OSM-Weg/ein Gewässer")
            elif c.cls == "platform":
                c.score *= PENALTIES["platform_near_path"]
                c.reasons.append("an einem OSM-Weg (abgewertet)")
            else:
                c.reasons.append("nahe OSM-Weg/Gewässer")
        best, bd = None, params["near_known_m"]
        for pid, pe, pn in pois:
            d = math.hypot(pe - c.E, pn - c.N)
            if d <= bd:
                best, bd = pid, d
        c.near_known = best
        if best:
            c.reasons.append(f"nahe bekannter Stelle ({best})")
        c.score = clamp01(c.score)


# ----------------------------------------------------------------------------- coarse pass (large structures)
@dataclass
class CoarseRasters:
    """2 m block means of the 1 m DTM and their relief at large radii (palace terraces, castle mounds, moats)."""
    grid: Grid
    z: np.ndarray
    smooth: np.ndarray
    lrm_big: np.ndarray       # smoothed − box mean r = large_lrm_radius_m (40 m)
    lrm_mid: np.ndarray       # smoothed − box mean r = moat_lrm_radius_m (20 m)
    slope: np.ndarray         # degrees, from the σ = 1.5 m (0.75 cell) smoothed 2 m DTM


def block_mean(a: np.ndarray, f: int) -> np.ndarray:
    """f×f block means (edge-padded to a multiple of f), e.g. level-1-like 2 m cells from the 1 m DTM."""
    H, W = a.shape
    ph, pw = (-H) % f, (-W) % f
    if ph or pw:
        a = np.pad(a, ((0, ph), (0, pw)), mode="edge")
    return a.reshape(a.shape[0] // f, f, a.shape[1] // f, f).mean(axis=(1, 3))


def block_any(mask: np.ndarray, f: int, frac: float = 0.5) -> np.ndarray:
    return block_mean(mask.astype(np.float32), f) >= frac


def compute_coarse(dtm: np.ndarray, grid: Grid, params: dict = PARAMS) -> CoarseRasters:
    f = int(params["large_cell_m"])
    z = block_mean(dtm.astype(np.float32), f).astype(np.float32)
    g = Grid(grid.e0, grid.n_top, z.shape, float(f))
    s = gauss(z, params["smooth_sigma_m"] / f)
    gy, gx = np.gradient(gauss(z, 1.5 / f))
    slope = np.degrees(np.arctan(np.hypot(gx, gy) / f)).astype(np.float32)
    big = s - box_mean(z, int(round(params["large_lrm_radius_m"] / f)))
    mid = s - box_mean(z, int(round(params["moat_lrm_radius_m"] / f)))
    return CoarseRasters(g, z, s, big.astype(np.float32), mid.astype(np.float32), slope)


def coarse_exclusion(ex: Exclusion, f: int, params: dict = PARAMS) -> Exclusion:
    road = block_any(ex.road, f)
    n = int(round(params["large_road_corridor_m"] / f))
    embank = ndimage.binary_dilation(road, iterations=n) if n > 0 and road.any() else road
    return Exclusion(block_any(ex.blocked, f), block_any(ex.water, f), road,
                     block_any(ex.settlement, f), block_any(ex.interpolated, f), embank)


def fine_cells(rr: np.ndarray, cc: np.ndarray, f: int, shape: tuple[int, int]) -> np.ndarray:
    """Flat 1 m cell indices covered by coarse cells (rr, cc) (for the forest flag)."""
    H, W = shape
    dr, dc = np.mgrid[0:f, 0:f]
    r = (np.asarray(rr)[:, None] * f + dr.ravel()[None, :]).ravel()
    c = (np.asarray(cc)[:, None] * f + dc.ravel()[None, :]).ravel()
    ok = (r < H) & (c < W)
    return r[ok] * W + c[ok]


def _crop(shape, sl, m: int):
    a0, b0 = max(0, sl[0].start - m), max(0, sl[1].start - m)
    a1, b1 = min(shape[0], sl[0].stop + m), min(shape[1], sl[1].stop + m)
    return a0, b0, a1, b1


def angular_coverage(rr: np.ndarray, cc: np.ndarray, r0: float, c0: float, bins: int = 36) -> float:
    """Fraction of `bins` direction sectors (seen from (r0, c0)) that contain at least one of the cells."""
    if len(rr) == 0:
        return 0.0
    ang = np.arctan2(np.asarray(rr, float) - r0, np.asarray(cc, float) - c0)
    k = np.floor((ang + math.pi) / (2 * math.pi) * bins).astype(int) % bins
    return float(len(np.unique(k))) / bins


def detect_large_blobs(C: CoarseRasters, ex: Exclusion, fine_shape: tuple[int, int],
                       params: dict = PARAMS) -> list[Candidate]:
    """Large raised/sunken structures on the 2 m grid: castle mounds (`mound`), terraces with a flat top and steep
    scarps (`platform`), rectangular platforms/sunken rectangles (`rect`), with a moat check around raised ones.
    Thresholds rise step by step (component tree); the lowest threshold at which a region qualifies wins."""
    f = C.grid.cell
    H, W = C.grid.shape
    amin, amax = (int(a / f ** 2) for a in params["large_area_m2"])
    accepted = np.zeros((H, W), bool)
    out: list[Candidate] = []
    for t in params["large_thresholds_m"]:
        for sign in (1, -1):
            rel = sign * C.lrm_big
            lab, regs = _blob_regions(rel >= t, amin, amax)
            for k, sl in regs:
                sub = lab[sl] == k
                if (accepted[sl] & sub).sum() > 0.2 * sub.sum() or _overlap(sub, ex.blocked, sl) >= 0.25:
                    continue
                cand = _large_region(C, ex, lab, k, sl, sign, fine_shape, params)
                if cand is None:
                    continue
                accepted[sl] |= ndimage.binary_fill_holes(sub)
                out.append(cand)
    return out


def _large_region(C: CoarseRasters, ex: Exclusion, lab, k, sl, sign, fine_shape, params) -> Candidate | None:
    f = C.grid.cell
    H, W = C.grid.shape
    sub = lab[sl] == k
    filled = ndimage.binary_fill_holes(sub)
    r0, c0 = sl[0].start, sl[1].start
    poly = region_polygon(filled, r0, c0, C.grid)
    if poly is None:
        return None
    area = float(filled.sum()) * f * f
    circ, rect = circularity(poly.area, poly.length), rectangularity(poly)
    L, Wd, ori = rect_dims(poly)
    elong = L / max(Wd, 1.0)
    relief = float((sign * C.lrm_big[sl])[sub].max())
    # flank = slope on the region boundary (±1 cell), outer = slope 6–16 m outside (break of slope = artificial)
    m_out = int(math.ceil(16 / f)) + 1
    a0, b0, a1, b1 = _crop((H, W), sl, m_out)
    big = np.zeros((a1 - a0, b1 - b0), bool)
    big[r0 - a0:r0 - a0 + sub.shape[0], c0 - b0:c0 - b0 + sub.shape[1]] = filled
    sw = C.slope[a0:a1, b0:b1]
    band = ndimage.binary_dilation(big) & ~ndimage.binary_erosion(big)
    dist = ndimage.distance_transform_edt(~big) * f
    outer_ring = (dist >= 6) & (dist <= 16)
    if ex.embank is not None and band.any() and \
            ex.embank[a0:a1, b0:b1][band].mean() >= params["large_max_road_edge_fraction"]:
        return None   # edge runs along a modern road/rail: embankment or cutting
    flank = float(np.median(sw[band])) if band.any() else 0.0
    outer = float(np.median(sw[outer_ring])) if outer_ring.any() else flank
    inner = ndimage.binary_erosion(big, iterations=max(1, int(round(4 / f))))
    top_flat = float((sw[inner] < params["large_flat_deg"]).mean()) if inner.any() else 0.0
    brk = flank - outer
    closed = closed_depth(C.smooth, sub, r0, c0, margin=3, dome=sign > 0)
    reasons: list[str] = []
    m: dict[str, float] = {"area_m2": area, "diameter_m": 2 * math.sqrt(area / math.pi), "circularity": circ,
                           "rectangularity": rect, "flank_slope_deg": flank, "slope_break_deg": brk,
                           "top_flat": top_flat, "scale_m": params["large_lrm_radius_m"]}
    m["height_m" if sign > 0 else "depth_m"] = relief
    is_rect = (rect >= params["large_rect_min_rectangularity"] and circ <= params["rect_max_circularity"]
               and Wd >= params["large_rect_min_side_m"] and flank >= params["large_rect_min_flank_deg"]
               and brk >= params["large_min_break_deg"])
    # natural knolls/spur ends are rounded: a large mound needs a flattened top or a sharp foot (break of slope)
    is_mound = (sign > 0 and circ >= params["large_mound_min_circularity"] and elong <= 2.0
                and flank >= params["large_mound_min_flank_deg"] and closed >= params["large_mound_min_closed_m"]
                and brk >= params["large_min_break_deg"]
                and (top_flat >= params["large_mound_min_flat"] or brk >= params["large_mound_sharp_break_deg"]))
    is_platform = (sign > 0 and top_flat >= params["large_platform_min_flat"] and elong <= 3.0
                   and flank >= params["large_platform_min_flank_deg"] and brk >= params["large_min_break_deg"]
                   and (circ >= 0.35 or (flank >= params["large_scarped_flank_deg"]
                                         and brk >= params["large_scarped_break_deg"] and circ >= 0.25)))
    word = "erhöht" if sign > 0 else "eingetieft"
    if is_rect:
        cls = "rect"
        m.update(length_m=L, width_m=Wd, orientation_deg=ori)
        s = (WEIGHTS["large.rect.rectangularity"] * ramp(rect, 0.82, 0.95)
             + WEIGHTS["large.rect.flank"] * ramp(flank, 8, 25)
             + WEIGHTS["large.rect.relief"] * ramp(relief, 0.4, 2.0))
        reasons.append(f"große rechteckige Fläche {de_num(L, 0)} × {de_num(Wd, 0)} m, {de_num(relief)} m {word} "
                       f"(Terrasse/Fundament/Becken?)")
    elif is_mound:
        cls = "mound"
        s = (WEIGHTS["large.mound.flank"] * ramp(flank, 12, 30)
             + WEIGHTS["large.mound.shape"] * ramp(circ, 0.6, 0.85)
             + WEIGHTS["large.mound.closed"] * ramp(closed, 0.5, 3.0)
             + WEIGHTS["large.mound.break"] * ramp(brk, 0, 12))
        m["closed_height_m"] = closed
        reasons.append(f"großer steilflankiger Hügel Ø {de_num(m['diameter_m'], 0)} m, {de_num(relief)} m hoch "
                       f"({de_num(flank, 0)}° Flanke)")
    elif is_platform:
        cls = "platform"
        m["slope_in_deg"] = float(np.median(sw[inner])) if inner.any() else 0.0
        s = (WEIGHTS["large.platform.flat"] * ramp(top_flat, 0.5, 0.9)
             + WEIGHTS["large.platform.flank"] * ramp(flank, 15, 30)
             + WEIGHTS["large.platform.break"] * ramp(brk, 0, 12)
             + WEIGHTS["large.platform.shape"] * ramp(circ, 0.4, 0.8))
        reasons.append(f"ebene Fläche {de_num(L, 0)} × {de_num(Wd, 0)} m mit steilem Rand ({de_num(flank, 0)}°), "
                       f"{de_num(relief)} m {word} (Terrasse/Plateau?)")
    else:
        return None
    if brk >= 5:
        reasons.append("scharfer Hangknick am Rand")
    if sign > 0:
        s = _moat(C, big, a0, b0, m, reasons, s, params)
    reasons.append("großräumige Struktur (Grobanalyse 2 m)")
    s *= _common_penalties(sub, sl, ex, reasons)
    if _touches_edge(sl, (H, W)):
        s *= PENALTIES["edge"]
        reasons.append("am Gebietsrand angeschnitten")
    r, c = centre_cell(filled, r0, c0)
    E, N = C.grid.en(r, c)
    rr, cc = np.nonzero(filled)
    return Candidate(cls, clamp01(s), float(E), float(N), m, reasons, poly,
                     cells=fine_cells(rr + r0, cc + c0, int(f), fine_shape))


def _moat(C: CoarseRasters, big: np.ndarray, a0: int, b0: int, m: dict, reasons: list[str], s: float,
          params: dict) -> float:
    """Ditch around a raised region (LRM20 ≤ −moat_threshold within moat_ring_m): records the angular coverage
    and adds a bonus; the ditch itself is emitted by detect_moats."""
    f = C.grid.cell
    dist = ndimage.distance_transform_edt(~big) * f
    ring = (dist > 0) & (dist <= params["moat_ring_m"])
    lm = C.lrm_mid[a0:a0 + big.shape[0], b0:b0 + big.shape[1]]
    dep = ring & (lm <= -params["moat_threshold_m"])
    if dep.sum() * f * f < params["moat_min_area_m2"]:
        return s
    rr, cc = np.nonzero(big)
    dr, dc = np.nonzero(dep)
    cov = angular_coverage(dr, dc, rr.mean(), cc.mean())
    if cov < params["moat_min_coverage"]:
        return s
    m["moat_coverage"] = cov
    m["moat_depth_m"] = float(-lm[dep].min())
    reasons.append(f"mit umlaufendem Graben ({round(cov * 100)} % des Umfangs, {de_num(m['moat_depth_m'])} m tief)")
    return s + WEIGHTS["large.moat"] * ramp(cov, params["moat_min_coverage"], 0.7)


def detect_moats(C: CoarseRasters, ex: Exclusion, raised: Sequence[Candidate], fine_shape, params: dict = PARAMS
                 ) -> list[Candidate]:
    """Moat/ring ditch around each large raised candidate with `moat_coverage`: centreline of the largest
    ditch component in the ring → `linear`."""
    from shapely.geometry import LineString
    from skimage.morphology import skeletonize
    f = C.grid.cell
    H, W = C.grid.shape
    out: list[Candidate] = []
    for p in raised:
        if "moat_coverage" not in p.metrics or p.outline is None:
            continue
        minx, miny, maxx, maxy = p.outline.bounds
        m_c = int(math.ceil(params["moat_ring_m"] / f)) + 2
        ra, ca = C.grid.rc(minx, maxy)
        rb, cb = C.grid.rc(maxx, miny)
        a0, b0 = max(0, int(ra) - m_c), max(0, int(ca) - m_c)
        a1, b1 = min(H, int(rb) + m_c + 2), min(W, int(cb) + m_c + 2)
        from rasterio.features import rasterize
        from rasterio.transform import from_origin
        tr = from_origin(C.grid.e0 + b0 * f, C.grid.n_top - a0 * f, f, f)
        big = rasterize([(p.outline, 1)], out_shape=(a1 - a0, b1 - b0), transform=tr, fill=0, dtype="uint8") > 0
        dist = ndimage.distance_transform_edt(~big) * f
        dep = (dist > 0) & (dist <= params["moat_ring_m"]) & (C.lrm_mid[a0:a1, b0:b1] <= -params["moat_threshold_m"])
        lab, n = ndimage.label(dep, structure=np.ones((3, 3)))
        if n == 0:
            continue
        sizes = np.bincount(lab.ravel())[1:]
        comp = lab == (int(np.argmax(sizes)) + 1)
        sk = skeletonize(comp)
        if sk.sum() < 3:
            continue
        path = longest_path(sk)
        pr, pc = path[:, 0] + a0, path[:, 1] + b0
        if ex.water[pr, pc].mean() >= 0.5 or (ex.embank if ex.embank is not None else ex.road)[pr, pc].mean() >= 0.6:
            continue
        E, N = C.grid.en(pr, pc)
        line = LineString(np.column_stack([E, N])).simplify(1.0)
        if line.length < params["moat_min_length_m"]:
            continue
        depth = float(-C.lrm_mid[a0:a1, b0:b1][comp].min())
        width = float(comp.sum()) * f * f / max(line.length, 1.0)
        rr, cc = np.nonzero(comp)
        cov = angular_coverage(rr, cc, *[float(v.mean()) for v in np.nonzero(big)])
        reasons = [f"Graben um eine Erhebung, {de_num(line.length, 0)} m lang, {de_num(depth)} m tief "
                   f"(Burg-/Ringgraben?)", f"umschließt {round(cov * 100)} % des Umfangs",
                   "großräumige Struktur (Grobanalyse 2 m)"]
        own = (WEIGHTS["large.moat.coverage"] * ramp(cov, params["moat_min_coverage"], 0.7)
               + WEIGHTS["large.moat.depth"] * ramp(depth, params["moat_threshold_m"], 2.0)
               + WEIGHTS["large.moat.length"] * ramp(line.length, params["moat_min_length_m"], 120))
        # a ditch around a natural knoll is just the surrounding valley: the moat is only as plausible as the
        # raised structure it encloses (parent score before flags), scaled by its own evidence
        s = p.score * (params["moat_parent_base"] + (1 - params["moat_parent_base"]) * own)
        sl = (slice(a0, a1), slice(b0, b1))
        s *= _common_penalties(comp, sl, ex, reasons)
        mid = line.interpolate(0.5, normalized=True)
        metrics = {"length_m": float(line.length), "width_m": width, "depth_m": depth, "moat_coverage": cov,
                   "orientation_deg": orientation_deg(E[-1] - E[0], N[-1] - N[0]),
                   "scale_m": params["moat_lrm_radius_m"]}
        out.append(Candidate("linear", clamp01(s), float(mid.x), float(mid.y), metrics, reasons, line,
                             cells=fine_cells(pr, pc, int(f), fine_shape)))
    return out


def detect_scarps(C: CoarseRasters, ex: Exclusion, fine_shape, params: dict = PARAMS) -> list[Candidate]:
    """Straight terrace edges / scarps: narrow steep bands (slope ≥ scarp_min_slope_deg on the 2 m DTM) with
    flatter ground on both sides and a height step ≥ scarp_min_step_m; rectilinear pairs get a bonus."""
    from shapely.geometry import LineString
    from skimage.morphology import skeletonize
    f = C.grid.cell
    H, W = C.grid.shape
    minlen = params["scarp_min_length_m"]
    steep = C.slope >= params["scarp_min_slope_deg"]
    lab, regs = _blob_regions(steep, int(minlen / f), 10 ** 7)
    out: list[Candidate] = []
    for k, sl in regs:
        sub = lab[sl] == k
        sk = skeletonize(sub)
        if sk.sum() * f < minlen * 0.7:
            continue
        path = longest_path(sk)
        length = float(np.hypot(*np.diff(path, axis=0).T).sum()) * f
        width = float(sub.sum()) * f * f / max(length, 1.0)
        if length < minlen or width > params["scarp_max_width_m"]:
            continue
        r0, c0 = sl[0].start, sl[1].start
        pr, pc = path[:, 0] + r0, path[:, 1] + c0
        if ex.water[pr, pc].mean() >= 0.5 or ex.blocked[pr, pc].mean() >= 0.5 or (
                ex.embank if ex.embank is not None else ex.road)[pr, pc].mean() >= 0.5:
            continue   # road/rail embankments and cuttings run in the corridor
        E, N = C.grid.en(pr, pc)
        line = LineString(np.column_stack([E, N])).simplify(1.0)
        chord = math.hypot(E[-1] - E[0], N[-1] - N[0])
        straight = chord / max(line.length, 1e-6)
        if line.length < minlen or straight < params["scarp_min_straightness"]:
            continue
        step, side_slope = _scarp_profile(C, pr, pc, width)
        if step < params["scarp_min_step_m"] or side_slope > params["scarp_max_side_slope_deg"]:
            continue
        reasons = [f"gerade Geländekante {de_num(line.length, 0)} m lang, {de_num(step)} m Stufe "
                   f"(Terrassenrand/Mauerzug?)", f"oben und unten flacher ({de_num(side_slope, 0)}°)",
                   "großräumige Struktur (Grobanalyse 2 m)"]
        s = (WEIGHTS["large.scarp.length"] * ramp(line.length, minlen, 120)
             + WEIGHTS["large.scarp.straightness"] * ramp(straight, params["scarp_min_straightness"], 0.98)
             + WEIGHTS["large.scarp.step"] * ramp(step, params["scarp_min_step_m"], 3.0)
             + WEIGHTS["large.scarp.flat_sides"] * ramp(params["scarp_max_side_slope_deg"] - side_slope, 0, 6))
        s *= _common_penalties(sub, sl, ex, reasons)
        mid = line.interpolate(0.5, normalized=True)
        metrics = {"length_m": float(line.length), "width_m": width, "height_m": step, "straightness": straight,
                   "orientation_deg": orientation_deg(E[-1] - E[0], N[-1] - N[0]), "side_slope_deg": side_slope,
                   "scale_m": f}
        out.append(Candidate("linear", s, float(mid.x), float(mid.y), metrics, reasons, line,
                             cells=fine_cells(pr, pc, int(f), fine_shape)))
    _right_angles(out, params)
    for c in out:
        c.score = clamp01(c.score)
    return out


def _scarp_profile(C: CoarseRasters, pr, pc, width: float, step: int = 2) -> tuple[float, float]:
    """(median |height step| across the line, median of the steeper side's slope) sampled at ±(w/2 + 4 m)."""
    f = C.grid.cell
    H, W = C.grid.shape
    off = (width / 2 + 4.0) / f
    steps, sides = [], []
    n = len(pr)
    for i in range(0, n, step):
        a, b = max(0, i - 3), min(n - 1, i + 3)
        dr, dc = float(pr[b] - pr[a]), float(pc[b] - pc[a])
        L = math.hypot(dr, dc)
        if L == 0:
            continue
        nr, nc = -dc / L, dr / L
        r1, c1 = int(round(pr[i] + nr * off)), int(round(pc[i] + nc * off))
        r2, c2 = int(round(pr[i] - nr * off)), int(round(pc[i] - nc * off))
        if not (0 <= r1 < H and 0 <= c1 < W and 0 <= r2 < H and 0 <= c2 < W):
            continue
        steps.append(abs(float(C.smooth[r1, c1]) - float(C.smooth[r2, c2])))
        sides.append(max(float(C.slope[r1, c1]), float(C.slope[r2, c2])))
    if not steps:
        return 0.0, 90.0
    return float(np.median(steps)), float(np.median(sides))


def _right_angles(scarps: list[Candidate], params: dict) -> None:
    """Rectilinear outlines: two scarps whose ends meet within scarp_corner_m at 90° ± 12° → bonus."""
    from shapely.geometry import Point
    for i, a in enumerate(scarps):
        for b in scarps[i + 1:]:
            d = abs(a.metrics["orientation_deg"] - b.metrics["orientation_deg"]) % 180
            if not (78 <= d <= 102):
                continue
            ends_a = [Point(a.outline.coords[0]), Point(a.outline.coords[-1])]
            if min(e.distance(b.outline) for e in ends_a) > params["scarp_corner_m"] and min(
                    Point(b.outline.coords[k]).distance(a.outline) for k in (0, -1)) > params["scarp_corner_m"]:
                continue
            for c in (a, b):
                if "rechtwinklig" not in " ".join(c.reasons):
                    c.reasons.insert(1, "rechtwinklig an eine weitere Kante anschließend")
                    c.score += WEIGHTS["large.scarp.right_angle"]


def drop_fine_duplicates(coarse: list[Candidate], fine: list[Candidate], params: dict = PARAMS) -> list[Candidate]:
    """Coarse candidates that only repeat a written fine one are dropped (fine ids stay untouched):
    blobs — a fine candidate of the same class lies inside and covers ≥ 50 % of the area;
    linear — ≥ 50 % of the line within 4 m of a fine linear outline."""
    from shapely import STRtree
    from shapely.geometry import Point
    fl = [c.outline for c in fine if c.cls == "linear" and c.outline is not None]
    ltree = STRtree(fl) if fl else None
    keep = []
    for c in coarse:
        if c.cls == "linear":
            if ltree is not None:
                hits = [fl[i] for i in ltree.query(c.outline, predicate="dwithin", distance=4.0)]
                if hits and along_fraction(c.outline, hits, 4.0) >= 0.5:
                    continue
            keep.append(c)
            continue
        dup = any(x.cls == c.cls and c.outline is not None and c.outline.contains(Point(x.E, x.N))
                  and x.metrics.get("area_m2", 0) >= 0.5 * c.metrics.get("area_m2", 1e9) for x in fine)
        if not dup:
            keep.append(c)
    return keep


def detect_large(dtm: np.ndarray, grid: Grid, ex: Exclusion, params: dict = PARAMS, log=lambda *a: None
                 ) -> list[Candidate]:
    """Coarse pass (Q-15): 2 m cells, local relief at r = 40 m / 20 m → large mounds, platforms, rectangles,
    moats and straight terrace edges. Penalties/flags are applied by the caller like for the fine pass."""
    t = time.time()
    C = compute_coarse(dtm, grid, params)
    exc = coarse_exclusion(ex, int(params["large_cell_m"]), params)
    blobs = detect_large_blobs(C, exc, grid.shape, params)
    moats = detect_moats(C, exc, [b for b in blobs if b.metrics.get("height_m") is not None], grid.shape, params)
    scarps = detect_scarps(C, exc, grid.shape, params)
    log(f"  coarse pass: {len(blobs)} large blobs, {len(moats)} moats, {len(scarps)} scarps  [{time.time() - t:.1f}s]")
    return blobs + moats + scarps


def detect(dtm: np.ndarray, e0: float, n_top: float, ctx: Context | None = None,
           pois: Sequence[tuple[str, float, float]] = (), params: dict = PARAMS, log=lambda *a: None
           ) -> list[Candidate]:
    """Run all detectors on an AOI DTM (row 0 = north, 1 m, PixelIsArea). Returns candidates ≥ min_score,
    sorted by score (desc), with ids assigned."""
    ctx = ctx or Context()
    grid = Grid(e0, n_top, dtm.shape)
    t = time.time()
    R = compute_rasters(dtm, params)
    ex = build_exclusion(grid, ctx, params)
    log(f"  rasters + exclusion masks  [{time.time() - t:.1f}s]")
    t = time.time()
    cands = detect_blobs(R, grid, ex, params)
    log(f"  pits/mounds/rects: {len(cands)}  [{time.time() - t:.1f}s]")
    t = time.time()
    pl = detect_platforms(R, grid, ex, params)
    log(f"  platforms: {len(pl)}  [{time.time() - t:.1f}s]")
    t = time.time()
    li = detect_linear(R, grid, ex, ctx, params)
    log(f"  linear (+ wall rings): {len(li)}  [{time.time() - t:.1f}s]")
    cands = dedupe(cands + pl + li)
    uprooted_pairs(cands, params)
    flag(cands, grid, ctx, list(pois), params)
    cands = [c for c in cands if c.score >= params["min_score"]]
    cands.sort(key=lambda c: (-round(c.score, 2), c.cls, c.E, c.N))
    seen = assign_ids(cands)
    if params.get("large_enabled", True):
        # coarse pass: added after the fine pass so fine candidates (and their ids, which users' review decisions
        # reference) are exactly those of rule set 1; coarse ids continue the collision counter
        large = detect_large(dtm, grid, ex, params, log)
        flag(large, grid, ctx, list(pois), params)
        large = [c for c in large if c.score >= params["min_score"]]
        large = drop_fine_duplicates(large, cands, params)
        large.sort(key=lambda c: (-round(c.score, 2), c.cls, c.E, c.N))
        assign_ids(large, seen)
        log(f"  coarse candidates written: {len(large)}")
        cands = sorted(cands + large, key=lambda c: (-round(c.score, 2), c.cls, c.E, c.N))
    return cands


def assign_ids(cands: list[Candidate], seen: dict[str, int] | None = None) -> dict[str, int]:
    """`${class}-${round(E)}-${round(N)}`, collisions get -2, -3 … in descending score order. Pass the returned
    `seen` counter to a later call to continue numbering (coarse pass after the fine pass)."""
    seen = {} if seen is None else seen
    for c in cands:
        # from the written (0.01 m) coordinates, rounded half-up like JS Math.round
        base = f"{c.cls}-{math.floor(round(c.E, 2) + 0.5)}-{math.floor(round(c.N, 2) + 0.5)}"
        n = seen.get(base, 0) + 1
        seen[base] = n
        c.id = base if n == 1 else f"{base}-{n}"
    return seen


# ----------------------------------------------------------------------------- output
def outline_coords(geom) -> tuple[str, list[tuple[float, float]]]:
    from shapely.geometry.polygon import orient
    if geom.geom_type == "Polygon":
        p = orient(geom.simplify(0.5, preserve_topology=True), 1.0)
        pts = densify(list(p.exterior.coords))
        if pts[0] != pts[-1]:
            pts.append(pts[0])
        return "Polygon", pts
    return "LineString", densify(list(geom.coords))


def _r2(x: float) -> float:
    return round(float(x), 2)


def to_feature(c: Candidate, z_at=None) -> dict[str, Any]:
    def pos(e, n):
        p = [_r2(e), _r2(n)]
        if z_at is not None:
            p.append(_r2(z_at(p[0], p[1])))
        return p

    props: dict[str, Any] = {
        "id": c.id, "class": c.cls, "score": _r2(c.score),
        "metrics": {k: _r2(v) for k, v in c.metrics.items() if v is not None and math.isfinite(v)},
        "reasons": c.reasons or [LABELS_DE[c.cls]], "forest": c.forest, "near_path": c.near_path,
        "along_path": c.along_path,
        "near_known": c.near_known,
    }
    if c.outline is not None:
        typ, pts = outline_coords(c.outline)
        coords = []
        for e, n in pts:
            p = pos(e, n)
            if not coords or p[:2] != coords[-1][:2]:
                coords.append(p)
        if typ == "Polygon":
            if coords[0][:2] != coords[-1][:2]:
                coords.append(list(coords[0]))
            if len(coords) >= 4:
                props["outline"] = {"type": "Polygon", "coordinates": [coords]}
        elif len(coords) >= 2:
            props["outline"] = {"type": "LineString", "coordinates": coords}
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": pos(c.E, c.N)}, "properties": props}


def feature_collection(cands: Sequence[Candidate], z_at=None) -> dict[str, Any]:
    return {"type": "FeatureCollection",
            "name": "Relikt-Kandidaten (Hypothesen, privat – nicht veröffentlichen)",
            "features": [to_feature(c, z_at) for c in cands]}


def class_mask(cands: Sequence[Candidate], grid: Grid, min_score: float) -> np.ndarray:
    """u8 class-code raster (contract `class8`): cell centre inside the outline (linear: ≤ 1 m from the centreline;
    no outline: within diameter/2); higher score wins on overlap."""
    from rasterio.features import rasterize
    from shapely.geometry import Point
    shapes = []
    for c in sorted((c for c in cands if c.score >= min_score), key=lambda c: c.score):
        if c.outline is None:
            g = Point(c.E, c.N).buffer(c.metrics.get("diameter_m", 5.0) / 2)
        elif c.outline.geom_type == "Polygon":
            g = c.outline.simplify(0.5, preserve_topology=True)
        else:
            g = c.outline.buffer(1.0)
        shapes.append((g, CLASS_CODE[c.cls]))
    if not shapes:
        return np.zeros(grid.shape, np.uint8)
    return rasterize(shapes, out_shape=grid.shape, transform=grid.transform, fill=0, dtype="uint8")


# ----------------------------------------------------------------------------- evaluation
# POI types whose remains should show in a 1 m DTM, and the candidate classes that count as a plausible hit
EXPECTED_CLASSES = {
    "burial_mound": {"mound"},
    "bunker": {"pit", "mound", "rect"},
    "castle": {"linear", "rect", "pit", "mound", "platform"},
    "palace": {"rect", "linear", "platform", "mound", "pit"},
    "garden": {"linear", "platform", "rect", "pit", "mound"},
}


def coverage_fraction(points: Sequence[tuple[float, float]], grid: Grid, radius: float, cell: float = 2.0) -> float:
    """Fraction of the AOI area within `radius` m of any point (the chance that a random site gets a hit at this
    candidate layout; unlike a Poisson estimate it accounts for clustering). Rasterised at `cell` m."""
    H, W = grid.shape
    h, w = max(1, int(math.ceil(H * grid.cell / cell))), max(1, int(math.ceil(W * grid.cell / cell)))
    occ = np.zeros((h, w), bool)
    for E, N in points:
        r = int((grid.n_top - N) / cell)
        c = int((E - grid.e0) / cell)
        if 0 <= r < h and 0 <= c < w:
            occ[r, c] = True
    if not occ.any():
        return 0.0
    d = ndimage.distance_transform_edt(~occ) * cell
    return float((d <= radius).mean())


def evaluate(cands: Sequence[Candidate], pois: Sequence[dict], grid: Grid, forest_km2: float, open_km2: float,
             radius: float = 30.0, min_score: float = 0.0) -> dict[str, Any]:
    """Known-site recall (any candidate within `radius` m) + density per km² per class (forest/open)."""
    cs = [c for c in cands if c.score >= min_score]
    per_poi = []
    for p in pois:
        hits = [c for c in cs if math.hypot(c.E - p["E"], c.N - p["N"]) <= radius]
        exp = EXPECTED_CLASSES.get(p["type"])
        good = [c for c in hits if exp and c.cls in exp]
        per_poi.append({"id": p["id"], "name": p["name"], "type": p["type"], "dtm_visible": exp is not None,
                        "hits": len(hits), "classes": sorted({c.cls for c in hits}),
                        "hit_expected_class": bool(good),
                        "best_score": round(max((c.score for c in hits), default=0.0), 2)})
    vis = [p for p in per_poi if p["dtm_visible"]]
    total_km2 = forest_km2 + open_km2
    density = {}
    for cls in CLASSES:
        f = sum(1 for c in cs if c.cls == cls and c.forest)
        o = sum(1 for c in cs if c.cls == cls and not c.forest)
        density[cls] = {"forest_per_km2": round(f / forest_km2, 1) if forest_km2 > 0 else None,
                        "open_per_km2": round(o / open_km2, 1) if open_km2 > 0 else None,
                        "n": f + o}
    dens_all = len(cs) / total_km2 if total_km2 > 0 else 0.0
    return {
        "radius_m": radius, "min_score": min_score, "candidates": len(cs),
        "area_km2": {"forest": round(forest_km2, 2), "open": round(open_km2, 2)},
        "density_per_km2": density,
        "known_sites": len(per_poi), "known_sites_dtm_visible": len(vis),
        "recall_any": f"{sum(p['hits'] > 0 for p in vis)}/{len(vis)}",
        "recall_expected_class": f"{sum(p['hit_expected_class'] for p in vis)}/{len(vis)}",
        # baseline: fraction of the AOI within `radius` of any candidate (= hit rate of a random site)
        "chance_hit_rate": round(coverage_fraction([(c.E, c.N) for c in cs], grid, radius), 3),
        "chance_hit_rate_poisson": round(1 - math.exp(-dens_all * math.pi * radius ** 2 / 1e6), 3),
        "sites": per_poi,
    }


# ----------------------------------------------------------------------------- I/O
def read_tif(path: Path, grid: Grid | None = None) -> np.ndarray | None:
    import rasterio
    if not path.exists():
        return None
    with rasterio.open(path) as ds:
        t = ds.transform
        if (t.a, t.b, t.d, t.e) != (1.0, 0.0, 0.0, -1.0):
            sys.exit(f"{path}: expected a north-up 1 m grid, got {t}")
        if grid is not None and ((t.c, t.f) != (grid.e0, grid.n_top) or ds.shape != grid.shape):
            sys.exit(f"{path}: grid {t.c, t.f, ds.shape} ≠ AOI {grid.e0, grid.n_top, grid.shape}")
        return ds.read(1)


def load_osm(path: Path) -> list[tuple[str, Any]]:
    from shapely.geometry import LineString
    if not path.exists():
        return []
    fc = json.loads(path.read_text())
    out = []
    for f in fc.get("features", []):
        g = f.get("geometry") or {}
        kind = (f.get("properties") or {}).get("kind", "")
        lines = [g["coordinates"]] if g.get("type") == "LineString" else (
            g["coordinates"] if g.get("type") == "MultiLineString" else [])
        for ln in lines:
            if len(ln) >= 2:
                out.append((kind, LineString([p[:2] for p in ln])))
    return out


def load_pois(path: Path, grid: Grid) -> list[dict]:
    from pyproj import Transformer
    if not path.exists():
        return []
    tr = Transformer.from_crs("EPSG:4326", "EPSG:25832", always_xy=True)
    H, W = grid.shape
    out = []
    for f in json.loads(path.read_text()).get("features", []):
        g, p = f.get("geometry") or {}, f.get("properties") or {}
        if g.get("type") != "Point":
            continue
        E, N = tr.transform(*g["coordinates"][:2])
        if grid.e0 <= E <= grid.e0 + W and grid.n_top - H <= N <= grid.n_top:
            out.append({"id": p.get("id"), "name": p.get("name", ""), "type": p.get("type", "other"), "E": E, "N": N})
    return out


def write_mask_chunks(mask: np.ndarray, out_dir: Path, cs: int) -> list[list[int]]:
    from PIL import Image
    H, W = mask.shape
    chunks = []
    for j in range(H // cs):
        for i in range(W // cs):
            m = mask[j * cs:(j + 1) * cs, i * cs:(i + 1) * cs]
            if m.any():
                out_dir.mkdir(parents=True, exist_ok=True)
                Image.fromarray(np.ascontiguousarray(m), mode="L").save(out_dir / f"{i}_{j}.png", compress_level=9)
                chunks.append([i, j])
    return chunks


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("aoi")
    ap.add_argument("--min-score", type=float, default=PARAMS["min_score"])
    ap.add_argument("--mask-min-score", type=float, default=PARAMS["mask_min_score"])
    ap.add_argument("--no-mask", action="store_true")
    args = ap.parse_args(argv)
    aoi = load_aoi(args.aoi)
    params = {**PARAMS, "min_score": args.min_score, "mask_min_score": args.mask_min_score}
    T0 = time.time()
    work = WORK_DIR / aoi.key
    out = APP_DATA / aoi.key
    grid = Grid(aoi.e0, aoi.n1, (aoi.height, aoi.width))
    dtm = read_tif(work / "dtm.tif", grid)
    if dtm is None:
        sys.exit(f"{work / 'dtm.tif'} missing – run build first")
    if not (out / "manifest.json").exists():
        sys.exit(f"{out / 'manifest.json'} missing – run build first")
    ctx = Context(chm=read_tif(work / "chm.tif", grid), bldg=read_tif(work / "bldg.tif", grid),
                  fillmask=read_tif(work / "mask.tif", grid), osm=load_osm(out / "vectors" / "osm.geojson"))
    pois = load_pois(APP_DATA / "pois.geojson", grid)
    print(f"AOI {aoi.key}: {aoi.width}×{aoi.height} cells; chm={'yes' if ctx.chm is not None else 'no'}, "
          f"bldg={'yes' if ctx.bldg is not None else 'no'}, osm ways={len(ctx.osm)}, known sites={len(pois)}",
          flush=True)
    cands = detect(dtm, aoi.e0, aoi.n1, ctx, [(p["id"], p["E"], p["N"]) for p in pois], params,
                   log=lambda m: print(m, flush=True))

    from heights import DtmSampler
    sampler = DtmSampler(dtm.astype(np.float64), aoi.e0, aoi.n1)
    fc = feature_collection(cands, z_at=lambda e, n: float(sampler.z(e, n)))
    cdir = out / "candidates"
    shutil.rmtree(cdir, ignore_errors=True)
    cdir.mkdir(parents=True)
    (cdir / "candidates.geojson").write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")))

    entry: dict[str, Any] = {
        "path": "candidates/candidates.geojson", "crs": "EPSG:25832", "featureCount": len(cands), "heights": "baked",
        "counts": {cls: sum(1 for c in cands if c.cls == cls) for cls in CLASSES},
        "classes": dict(LABELS_DE), "method": METHOD, "version": RULESET_VERSION,
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "params": params, "weights": {**WEIGHTS, **{f"penalty.{k}": v for k, v in PENALTIES.items()}},
    }
    if not args.no_mask:
        m = class_mask(cands, grid, params["mask_min_score"])
        chunks = write_mask_chunks(m, cdir / "mask", aoi.chunk_size)
        entry["mask"] = {"path": "candidates/mask/{i}_{j}.png", "encoding": "class8",
                         "minScore": params["mask_min_score"], "chunks": chunks}
    entry["label_de"] = LABEL_DE

    chm = ctx.chm
    forest_km2 = float((chm >= params["forest_chm_m"]).sum()) / 1e6 if chm is not None else 0.0
    open_km2 = aoi.width * aoi.height / 1e6 - forest_km2
    ms = params["min_score"]
    ev = {"all": evaluate(cands, pois, grid, forest_km2, open_km2, min_score=ms),
          "score_ge_0.5": evaluate(cands, pois, grid, forest_km2, open_km2, min_score=0.5),
          # POI coordinates are partly only ~10–40 m precise (4 decimals, complex centroids): 50 m as a second view
          "all_r50m": evaluate(cands, pois, grid, forest_km2, open_km2, radius=50.0, min_score=ms)}
    entry["evaluation"] = {k: {kk: vv for kk, vv in v.items() if kk != "sites"} for k, v in ev.items()}
    update_manifest(out, {"candidates": entry})
    (work / "detect.json").write_text(json.dumps({"counts": entry["counts"], "evaluation": ev,
                                                  "runtime_s": round(time.time() - T0, 1)},
                                                 indent=2, ensure_ascii=False))
    size = (cdir / "candidates.geojson").stat().st_size
    print(f"wrote {len(cands)} candidates {entry['counts']} ({size / 1e6:.2f} MB)  [{time.time() - T0:.1f}s]")
    for k, v in ev.items():
        print(f"  {k}: recall {v['recall_any']} (expected class {v['recall_expected_class']}), "
              f"chance {v['chance_hit_rate']}, density " +
              ", ".join(f"{c} {d['forest_per_km2']}/{d['open_per_km2']}" for c, d in v["density_per_km2"].items()))


if __name__ == "__main__":
    main()
