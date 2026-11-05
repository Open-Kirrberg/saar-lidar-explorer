"""Mesh building blocks for the built twin: nodes with per-material primitives, planar polygons (earcut, holes),
vertical faces from (s, z) shapes, prisms, chamfered boxes, cylinders, tile partitions. Pure numpy/shapely.

Every primitive is flat-shaded (one normal per polygon) and carries a baked light colour (COLOR_0, linear): the
twin is rendered unlit (style.md: soft Lambert + vertex AO, warm key light, no textures), see shade.py.
Coordinates handed to `Node.add*` are already in the zone frame (x = E − E0, y = h, z = −(N − N0)).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable, Iterable

import mapbox_earcut
import numpy as np
from shapely import make_valid
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, box as sbox
from shapely.geometry.polygon import orient

Shade = Callable[[np.ndarray, np.ndarray], np.ndarray]  # (normals (n,3), points (n,3)) -> rgb (n,3)


@dataclass
class Prim:
    pos: list = field(default_factory=list)   # (m,3) arrays
    nrm: list = field(default_factory=list)
    col: list = field(default_factory=list)
    idx: list = field(default_factory=list)    # (k,3) arrays, local to the vertex block
    nv: int = 0

    def append(self, p: np.ndarray, n: np.ndarray, c: np.ndarray, i: np.ndarray) -> None:
        self.pos.append(p.astype(np.float64))
        self.nrm.append(n.astype(np.float64))
        self.col.append(c.astype(np.float64))
        self.idx.append(i.astype(np.int64) + self.nv)
        self.nv += len(p)

    def arrays(self) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        if not self.pos:
            z = np.zeros((0, 3))
            return z, z, z, np.zeros((0, 3), np.int64)
        return np.concatenate(self.pos), np.concatenate(self.nrm), np.concatenate(self.col), np.concatenate(self.idx)

    @property
    def triangles(self) -> int:
        return int(sum(len(i) for i in self.idx))


class Node:
    """One glTF node (`<assetId>/<part>[/<detail>]`) with one primitive per material."""

    def __init__(self, name: str, shade: Shade, extras: dict | None = None):
        self.name = name
        self.shade = shade
        self.extras = dict(extras or {})
        self.prims: dict[str, Prim] = {}

    @property
    def triangles(self) -> int:
        return sum(p.triangles for p in self.prims.values())

    def add(self, mat: str, verts: np.ndarray, tris: np.ndarray, normal: np.ndarray, ao: np.ndarray | None = None) -> None:
        """Flat polygon soup: one normal for all vertices (or per vertex), baked light from the node's rig."""
        verts = np.asarray(verts, np.float64).reshape(-1, 3)
        tris = np.asarray(tris, np.int64).reshape(-1, 3)
        if len(tris) == 0:
            return
        n = np.asarray(normal, np.float64)
        n = np.broadcast_to(n / np.linalg.norm(n, axis=-1, keepdims=True), verts.shape).copy()
        c = self.shade(n, verts)
        if ao is not None:
            c = c * np.asarray(ao, np.float64).reshape(-1, 1)
        self.prims.setdefault(mat, Prim()).append(verts, n, np.clip(c, 0.0, 1.0), tris)

    def add_planar(self, mat: str, poly, to3d: Callable[[np.ndarray], np.ndarray], normal, ao_fn=None) -> None:
        """2-D polygon(s) (shapely, any orientation) mapped by `to3d` ((n,2) -> (n,3)) onto a plane; triangles are
        wound counter-clockwise seen from `normal` (glTF front face). `ao_fn` gets the 2-D vertices."""
        normal = np.asarray(normal, np.float64)
        for v2, t in triangulate(poly):
            v3 = to3d(v2)
            t = wind(v3, t, normal)
            self.add(mat, v3, t, normal, None if ao_fn is None else ao_fn(v2))

    def add_mesh(self, mat: str, verts: np.ndarray, tris: np.ndarray, ao_fn=None) -> None:
        """Arbitrary triangles, flat-shaded per triangle (vertices are split)."""
        verts = np.asarray(verts, np.float64)
        tris = np.asarray(tris, np.int64).reshape(-1, 3)
        if len(tris) == 0:
            return
        v = verts[tris].reshape(-1, 3)
        a, b, c = v[0::3], v[1::3], v[2::3]
        fn = np.cross(b - a, c - a)
        ln = np.linalg.norm(fn, axis=1)
        ok = ln > 1e-12
        if not ok.any():
            return
        fn = fn[ok] / ln[ok, None]
        v = np.stack([a[ok], b[ok], c[ok]], 1).reshape(-1, 3)
        n = np.repeat(fn, 3, axis=0)
        t = np.arange(len(v)).reshape(-1, 3)
        col = self.shade(n, v)
        if ao_fn is not None:
            col = col * np.asarray(ao_fn(v)).reshape(-1, 1)
        self.prims.setdefault(mat, Prim()).append(v, n, np.clip(col, 0, 1), t)


# ----------------------------------------------------------------------------------------------- polygons

def polys(geom) -> list[Polygon]:
    """Flatten any shapely geometry (or a list of them) to valid polygons with area > 1e-6. A list is flattened item by
    item: tile partitions touch along edges, and a MultiPolygon of touching parts is invalid (make_valid would merge
    them and lose the holes)."""
    if isinstance(geom, (list, tuple)):
        return [q for g in geom for q in polys(g)]
    if geom is None or geom.is_empty:
        return []
    if not geom.is_valid:
        geom = make_valid(geom)
    if isinstance(geom, Polygon):
        return [geom] if geom.area > 1e-6 else []
    if isinstance(geom, (MultiPolygon, GeometryCollection)):
        out = []
        for g in geom.geoms:
            out += polys(g)
        return out
    return []


def triangulate(geom) -> Iterable[tuple[np.ndarray, np.ndarray]]:
    """Earcut per polygon (holes supported): yields (vertices (n,2), triangles (k,3))."""
    for p in polys(geom):
        p = orient(p, 1.0)
        rings = [np.asarray(p.exterior.coords)[:-1]] + [np.asarray(r.coords)[:-1] for r in p.interiors]
        rings = [r for r in rings if len(r) >= 3]
        if not rings or len(rings[0]) < 3:
            continue
        v = np.concatenate(rings)
        ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
        t = np.asarray(mapbox_earcut.triangulate_float64(v, ends), np.int64).reshape(-1, 3)
        if len(t):
            yield v, t


def wind(v3: np.ndarray, t: np.ndarray, normal: np.ndarray) -> np.ndarray:
    """Flip triangles whose geometric normal disagrees with `normal`; drop degenerate ones."""
    a, b, c = v3[t[:, 0]], v3[t[:, 1]], v3[t[:, 2]]
    d = np.cross(b - a, c - a) @ np.asarray(normal, np.float64)
    t = t[np.abs(d) > 1e-12].copy()
    d = d[np.abs(d) > 1e-12]
    t[d < 0] = t[d < 0][:, [0, 2, 1]]
    return t


def rect(x0, y0, x1, y1) -> Polygon:
    return sbox(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))


def tiles(poly, gu: float, gv: float, grout: float, origin=(0.0, 0.0)) -> tuple[list[Polygon], list[Polygon]]:
    """Partition `poly` into tiles (gu × gv grid from `origin`, shrunk by grout/2 per side) and the grout between
    them. Coplanar, non-overlapping: no z-fighting, and the extra vertices carry the vertex AO."""
    out_t, out_g = [], []
    for p in polys(poly):
        x0, y0, x1, y1 = p.bounds
        i0, i1 = math.floor((x0 - origin[0]) / gu), math.ceil((x1 - origin[0]) / gu)
        j0, j1 = math.floor((y0 - origin[1]) / gv), math.ceil((y1 - origin[1]) / gv)
        h = grout / 2
        for i in range(i0, i1):
            for j in range(j0, j1):
                cx0, cy0 = origin[0] + i * gu, origin[1] + j * gv
                cell = rect(cx0, cy0, cx0 + gu, cy0 + gv)
                part = p.intersection(cell)
                if part.is_empty or part.area < 1e-6:
                    continue
                tile = part.intersection(rect(cx0 + h, cy0 + h, cx0 + gu - h, cy0 + gv - h))
                out_t += polys(tile)
                out_g += polys(part.difference(tile))
    return out_t, out_g


# ----------------------------------------------------------------------------------------------- solids

def convex_solid(points: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Convex hull triangles, wound outwards."""
    from scipy.spatial import ConvexHull
    pts = np.asarray(points, np.float64)
    hull = ConvexHull(pts)
    t = hull.simplices.copy()
    c = pts.mean(0)
    a, b, cc = pts[t[:, 0]], pts[t[:, 1]], pts[t[:, 2]]
    out = np.einsum("ij,ij->i", np.cross(b - a, cc - a), (a + b + cc) / 3 - c) < 0
    t[out] = t[out][:, [0, 2, 1]]
    return pts, t


def chamfer_box_local(l: float, d: float, h: float, bevel: float) -> np.ndarray:
    """Corner points of a box [0,l]×[0,d]×[0,h] with all edges chamfered by `bevel` (24 points, convex)."""
    b = min(bevel, l / 3, d / 3, h / 3)
    pts = []
    for x in (0.0, l):
        for y in (0.0, d):
            for z in (0.0, h):
                sx, sy, sz = (1 if x == 0 else -1), (1 if y == 0 else -1), (1 if z == 0 else -1)
                pts += [(x + sx * b, y, z + sz * b if b else z), (x, y + sy * b, z + sz * b if b else z), (x + sx * b, y + sy * b, z)]
    return np.unique(np.round(np.array(pts, np.float64), 9), axis=0)


def prism_parts(poly: Polygon, z0: float, z1: float) -> list[tuple[str, np.ndarray, np.ndarray, np.ndarray]]:
    """Vertical prism of a 2-D polygon (local x/y, z up): ('top'|'bottom'|'side', verts (n,3), tris, normal)."""
    out = []
    for v2, t in triangulate(poly):
        top = np.column_stack([v2, np.full(len(v2), z1)])
        out.append(("top", top, wind(top, t, np.array([0, 0, 1.0])), np.array([0, 0, 1.0])))
        bot = np.column_stack([v2, np.full(len(v2), z0)])
        out.append(("bottom", bot, wind(bot, t, np.array([0, 0, -1.0])), np.array([0, 0, -1.0])))
    for p in polys(poly):
        p = orient(p, 1.0)
        for ring, sign in [(p.exterior, 1)] + [(r, 1) for r in p.interiors]:
            c = np.asarray(ring.coords)
            for a, b in zip(c[:-1], c[1:]):
                e = b - a
                L = float(np.hypot(*e))
                if L < 1e-9:
                    continue
                n = np.array([e[1], -e[0], 0.0]) / L * sign  # right of the edge = outside for a CCW exterior
                v = np.array([[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]])
                out.append(("side", v, wind(v, np.array([[0, 1, 2], [0, 2, 3]]), n), n))
    return out


def cylinder_local(r: float, z0: float, z1: float, n: int = 16, r1: float | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Closed (frustum) cylinder around the z axis, r at z0 and r1 (default r) at z1: (verts, outward tris)."""
    r1 = r if r1 is None else r1
    a = np.linspace(0, 2 * math.pi, n, endpoint=False)
    lo = np.column_stack([r * np.cos(a), r * np.sin(a), np.full(n, z0)])
    hi = np.column_stack([r1 * np.cos(a), r1 * np.sin(a), np.full(n, z1)])
    v = np.vstack([lo, hi, [[0, 0, z0], [0, 0, z1]]])
    t = []
    for i in range(n):
        j = (i + 1) % n
        t += [[i, j, n + j], [i, n + j, n + i], [2 * n, j, i], [2 * n + 1, n + i, n + j]]
    return v, np.array(t)


def arc_points(c, r: float, a0: float, a1: float, n: int) -> np.ndarray:
    a = np.linspace(a0, a1, n + 1)
    return np.column_stack([c[0] + r * np.cos(a), c[1] + r * np.sin(a)])
