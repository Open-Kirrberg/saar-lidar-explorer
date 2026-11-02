"""Baked vector heights (contract "Vectors" → `heights: "baked"`): bilinear DTM sampling at EPSG:25832 points.

The 1 m DTM is PixelIsArea: cell (c, r) covers [E0 + c, E0 + c + 1] × [N_top − r − 1, N_top − r] and its value
belongs to the cell centre (E0 + c + 0.5, N_top − r − 0.5). Fractional cell coordinates are therefore
    u = E − E0 − 0.5,   v = N_top − N − 0.5        (N_top = N0 + AOI height, row 0 = north)
and z is the bilinear mix of the four surrounding cells, indices edge-clamped to the raster.
"""
from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any

import numpy as np

Z_DIGITS = 2  # contract: z rounded to 0.01 m


def bilinear(dtm: np.ndarray, e0: float, n_top: float, E, N) -> np.ndarray:
    """Bilinear DTM height at EPSG:25832 points (arrays or scalars), float64."""
    E = np.asarray(E, dtype=np.float64)
    N = np.asarray(N, dtype=np.float64)
    rows, cols = dtm.shape
    u = E - e0 - 0.5
    v = n_top - N - 0.5
    c0 = np.floor(u)
    r0 = np.floor(v)
    fx = u - c0
    fy = v - r0
    c0 = c0.astype(np.int64)
    r0 = r0.astype(np.int64)
    ca, cb = np.clip(c0, 0, cols - 1), np.clip(c0 + 1, 0, cols - 1)
    ra, rb = np.clip(r0, 0, rows - 1), np.clip(r0 + 1, 0, rows - 1)
    d = dtm.astype(np.float64, copy=False)
    top = d[ra, ca] * (1 - fx) + d[ra, cb] * fx
    bot = d[rb, ca] * (1 - fx) + d[rb, cb] * fx
    return top * (1 - fy) + bot * fy


class DtmSampler:
    """Bilinear sampler over an AOI DTM GeoTIFF (data/work/<aoi>/dtm.tif, filled, 1 m, north-up)."""

    def __init__(self, dtm: np.ndarray, e0: float, n_top: float):
        if not np.isfinite(dtm).all():
            raise ValueError("DTM contains NaN – bake from the filled work DTM")
        self.dtm, self.e0, self.n_top = dtm, float(e0), float(n_top)

    @classmethod
    def from_geotiff(cls, path: Path, e0: float | None = None, n_top: float | None = None) -> "DtmSampler":
        import rasterio
        with rasterio.open(path) as ds:
            t = ds.transform
            if (t.a, t.b, t.d, t.e) != (1.0, 0.0, 0.0, -1.0):
                raise ValueError(f"{path}: expected a north-up 1 m grid, got {t}")
            if e0 is not None and (t.c, t.f) != (e0, n_top):
                raise ValueError(f"{path}: origin {(t.c, t.f)} ≠ AOI NW corner {(e0, n_top)}")
            return cls(ds.read(1).astype(np.float64), t.c, t.f)

    def z(self, E, N) -> np.ndarray:
        return bilinear(self.dtm, self.e0, self.n_top, E, N)

    def bake_line(self, coords: Sequence[Sequence[float]]) -> list[list[float]]:
        """[[E, N], …] → [[E, N, z], …] with z rounded to 0.01 m."""
        if not coords:
            return []
        a = np.asarray([c[:2] for c in coords], dtype=np.float64)
        zs = self.z(a[:, 0], a[:, 1])
        return [[c[0], c[1], round(float(z), Z_DIGITS)] for c, z in zip(coords, zs)]


def bake_geometry(geom: dict[str, Any], sampler: DtmSampler) -> dict[str, Any]:
    """Add z to every coordinate of a GeoJSON Point/LineString/MultiLineString/Polygon/MultiPolygon."""
    t, c = geom["type"], geom["coordinates"]
    if t == "Point":
        coords = sampler.bake_line([c])[0]
    elif t in ("LineString", "MultiPoint"):
        coords = sampler.bake_line(c)
    elif t in ("MultiLineString", "Polygon"):
        coords = [sampler.bake_line(line) for line in c]
    elif t == "MultiPolygon":
        coords = [[sampler.bake_line(r) for r in poly] for poly in c]
    else:
        raise ValueError(f"cannot bake geometry type {t}")
    return {**geom, "coordinates": coords}


def bake_collection(fc: dict[str, Any], sampler: DtmSampler) -> dict[str, Any]:
    return {**fc, "features": [{**f, "geometry": bake_geometry(f["geometry"], sampler)} for f in fc["features"]]}


def iter_coords(geom: dict[str, Any]) -> Iterable[Sequence[float]]:
    """All positions of a GeoJSON geometry (for tests/stats)."""
    t, c = geom["type"], geom["coordinates"]
    if t == "Point":
        yield c
    elif t in ("LineString", "MultiPoint"):
        yield from c
    elif t in ("MultiLineString", "Polygon"):
        for line in c:
            yield from line
    elif t == "MultiPolygon":
        for poly in c:
            for r in poly:
                yield from r


def all_baked(fc: dict[str, Any]) -> bool:
    return all(len(p) == 3 and math.isfinite(p[2]) for f in fc["features"] for p in iter_coords(f["geometry"]))
