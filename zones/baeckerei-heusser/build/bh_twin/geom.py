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


# ----------------------------------------------------------------------------------------------- bevels (style.md)
# Fixtures get a 10–20 mm bevel or round-over, buildings 5–10 mm, products 3–8 mm. All helpers return (verts (n,3),
# outward triangles (k,3)) in a local frame (x, y, z up); `Node.add_mesh` flat-shades them per facet, so a 2-step
# round-over reads as two soft highlights along every edge (the comic/mobile-game look) at a few extra triangles.

BEVEL_FIXTURE = 0.012
BEVEL_BUILDING = 0.006
BEVEL_PRODUCT = 0.005


def rounded_box_local(l: float, d: float, h: float, r: float, segs: int = 2) -> tuple[np.ndarray, np.ndarray]:
    """Box [0,l]×[0,d]×[0,h] with every edge and corner rounded over by radius `r` (`segs` facets per quarter; 1 =
    chamfer). Convex: the hull of the 8 corner octants (≈ 44 triangles at segs=1, ≈ 108 at segs=2)."""
    r = max(0.0, min(r, l / 2.01, d / 2.01, h / 2.01))
    if r <= 1e-6:
        return convex_solid(chamfer_box_local(l, d, h, 0.0))
    pts = []
    angs = [0.5 * math.pi * k / segs for k in range(segs + 1)]
    for cx, sx in ((r, -1.0), (l - r, 1.0)):
        for cy, sy in ((r, -1.0), (d - r, 1.0)):
            for cz, sz in ((r, -1.0), (h - r, 1.0)):
                for th in angs:          # polar angle from the z axis
                    for ph in (angs if th > 0 else [0.0]):
                        u = (math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th))
                        pts.append((cx + sx * r * u[0], cy + sy * r * u[1], cz + sz * r * u[2]))
    return convex_solid(np.unique(np.round(np.array(pts, np.float64), 9), axis=0))


def _ring_ccw(poly: Polygon) -> np.ndarray:
    return np.asarray(orient(poly, 1.0).exterior.coords)[:-1]


def offset_ring(ring: np.ndarray, dist: float) -> np.ndarray:
    """Mitred offset of a CCW ring keeping the vertex correspondence (dist < 0 = inwards). Valid for offsets small
    against the edges (bevels); the mitre is clamped at 3·|dist| on sharp corners."""
    p = np.asarray(ring, np.float64)
    e_in = p - np.roll(p, 1, 0)
    e_out = np.roll(p, -1, 0) - p
    n_in = np.column_stack([e_in[:, 1], -e_in[:, 0]]) / np.maximum(np.linalg.norm(e_in, axis=1), 1e-12)[:, None]
    n_out = np.column_stack([e_out[:, 1], -e_out[:, 0]]) / np.maximum(np.linalg.norm(e_out, axis=1), 1e-12)[:, None]
    m = n_in + n_out
    ml = np.linalg.norm(m, axis=1)
    m = np.where(ml[:, None] > 1e-9, m / np.maximum(ml, 1e-12)[:, None], n_out)
    cos = np.clip(np.einsum("ij,ij->i", m, n_out), 1 / 3, 1.0)
    return p + m * (dist / cos)[:, None]   # outward normal (right of a CCW edge) times dist


def bevel_prism(poly: Polygon, z0: float, z1: float, r: float, top: bool = True, bottom: bool = False,
                r_bottom: float | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Vertical prism of a 2-D polygon (exterior only) with chamfered top (and bottom) edges: rings inset by `r` at
    the caps, full size between. Counter bases, ledges, boards, panels with curved outlines."""
    ring = _ring_ccw(poly)
    rb = r if r_bottom is None else r_bottom
    rt = min(r, (z1 - z0) / 2.01)
    rb = min(rb, (z1 - z0) / 2.01) if bottom else 0.0
    rings = []
    if bottom and rb > 0:
        rings.append((offset_ring(ring, -rb), z0))
        rings.append((ring, z0 + rb))
    else:
        rings.append((ring, z0))
    if top and rt > 0:
        rings.append((ring, z1 - rt))
        rings.append((offset_ring(ring, -rt), z1))
    else:
        rings.append((ring, z1))
    n = len(ring)
    verts, tris = [], []
    for k, (rg, z) in enumerate(rings):
        verts.append(np.column_stack([rg, np.full(n, z)]))
    V = np.concatenate(verts)
    for k in range(len(rings) - 1):
        a0, b0 = k * n, (k + 1) * n
        for i in range(n):
            j = (i + 1) % n
            tris += [[a0 + i, a0 + j, b0 + j], [a0 + i, b0 + j, b0 + i]]
    T = [np.array(tris, np.int64)]
    caps = []
    if top:
        caps.append((len(rings) - 1, 1.0))
    if bottom:
        caps.append((0, -1.0))
    for k, s in caps:
        rg = rings[k][0]
        t = np.asarray(mapbox_earcut.triangulate_float64(rg, np.array([n], np.uint32)), np.int64).reshape(-1, 3)
        v3 = V[k * n:(k + 1) * n]
        T.append(wind(v3, t, np.array([0, 0, s])) + k * n)
    return V, np.concatenate(T)


def sweep_x(profile_yz: np.ndarray, x0: float, x1: float, segs: int = 1, caps: bool = True) -> tuple[np.ndarray, np.ndarray]:
    """Closed 2-D profile (local y, z; counter-clockwise seen from +x) swept along x from x0 to x1, in `segs` pieces
    (extra vertices carry the baked light gradients of long parts). Rails, rods, ledges, bands."""
    pr = np.asarray(profile_yz, np.float64)
    if _area2(pr) < 0:
        pr = pr[::-1]
    m = len(pr)
    xs = np.linspace(x0, x1, segs + 1)
    V = np.concatenate([np.column_stack([np.full(m, x), pr]) for x in xs])
    tris = []
    for s in range(segs):
        a0, b0 = s * m, (s + 1) * m
        for i in range(m):
            j = (i + 1) % m
            # profile CCW seen from +x: (b_j - a_i) × (b_i - a_i) = e × x = outward
            tris += [[a0 + i, b0 + j, b0 + i], [a0 + i, a0 + j, b0 + j]]
    T = [np.array(tris, np.int64)]
    if caps:
        t = np.asarray(mapbox_earcut.triangulate_float64(pr, np.array([m], np.uint32)), np.int64).reshape(-1, 3)
        T.append(wind(V[:m], t, np.array([-1.0, 0, 0])))
        T.append(wind(V[segs * m:], t, np.array([1.0, 0, 0])) + segs * m)
    return V, np.concatenate(T)


def _area2(p: np.ndarray) -> float:
    x, y = p[:, 0], p[:, 1]
    return float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))


def rounded_rect_profile(w: float, h: float, r: float, segs: int = 2, y0: float = 0.0, z0: float = 0.0) -> np.ndarray:
    """CCW profile of a w×h rectangle (from y0, z0) with rounded corners (radius r, `segs` facets per quarter)."""
    r = max(0.0, min(r, w / 2.01, h / 2.01))
    pts = []
    for cy, cz, a0 in ((y0 + w - r, z0 + r, -90), (y0 + w - r, z0 + h - r, 0), (y0 + r, z0 + h - r, 90), (y0 + r, z0 + r, 180)):
        for k in range(segs + 1):
            a = math.radians(a0 + 90 * k / segs)
            pts.append((cy + r * math.cos(a), cz + r * math.sin(a)))
    return np.array(_dedupe(pts))


def _dedupe(pts) -> list:
    out = []
    for p in pts:
        if not out or math.dist(out[-1], p) > 1e-9:
            out.append(p)
    if len(out) > 1 and math.dist(out[0], out[-1]) < 1e-9:
        out.pop()
    return out


def circle_profile(r: float, n: int = 8, cy: float = 0.0, cz: float = 0.0) -> np.ndarray:
    a = np.linspace(0, 2 * math.pi, n, endpoint=False) + math.pi / n
    return np.column_stack([cy + r * np.cos(a), cz + r * np.sin(a)])


def rod(p0, p1, r: float, n: int = 6, caps: bool = True) -> tuple[np.ndarray, np.ndarray]:
    """n-gon cylinder between two 3-D points (legs, rods, brackets, cords)."""
    p0, p1 = np.asarray(p0, np.float64), np.asarray(p1, np.float64)
    ax = p1 - p0
    L = float(np.linalg.norm(ax))
    if L < 1e-9:
        return np.zeros((0, 3)), np.zeros((0, 3), np.int64)
    ax /= L
    a = np.array([1.0, 0, 0]) if abs(ax[0]) < 0.9 else np.array([0, 1.0, 0])
    u = np.cross(ax, a)
    u /= np.linalg.norm(u)
    w = np.cross(ax, u)
    v, t = sweep_x(circle_profile(r, n), 0.0, L, 1, caps)
    out = p0 + v[:, :1] * ax + v[:, 1:2] * u + v[:, 2:3] * w
    return out, t


def lathe(profile_rz, segs: int = 16, cap_bottom: bool = False, cap_top: bool = False, a0: float = 0.0) -> tuple[np.ndarray, np.ndarray]:
    """Surface of revolution about z: profile (r, z) ordered so that the outside is on its right going from the
    first to the last point (bottom → top for an outer wall). Lamp shades, pots, stools, domes, table feet."""
    pr = np.asarray(profile_rz, np.float64)
    m = len(pr)
    ang = a0 + np.linspace(0, 2 * math.pi, segs, endpoint=False)
    V = np.concatenate([np.column_stack([pr[:, 0] * math.cos(a), pr[:, 0] * math.sin(a), pr[:, 1]]) for a in ang])
    tris = []
    for j in range(segs):
        jn = (j + 1) % segs
        for i in range(m - 1):
            a, b, c, d = j * m + i, jn * m + i, jn * m + i + 1, j * m + i + 1
            tris += [[a, b, c], [a, c, d]]
    T = [np.array(tris, np.int64)]
    extra = []
    for cap, i, s in ((cap_bottom, 0, -1.0), (cap_top, m - 1, 1.0)):
        if cap and pr[i, 0] > 1e-9:
            k = len(V) + len(extra)
            extra.append([0.0, 0.0, pr[i, 1]])
            ring = [j * m + i for j in range(segs)]
            for j in range(segs):
                tri = [k, ring[j], ring[(j + 1) % segs]] if s > 0 else [k, ring[(j + 1) % segs], ring[j]]
                T.append(np.array([tri], np.int64))
    if extra:
        V = np.vstack([V, np.array(extra)])
    T = np.concatenate(T)
    # degenerate quads at r = 0 (poles) drop out in Node.add_mesh (zero-area facets)
    return V, T


def grid_split(poly, gu: float, gv: float, origin=(0.0, 0.0)) -> list[Polygon]:
    """Partition `poly` along a gu × gv grid without grout (same material): extra vertices for baked light / AO."""
    out = []
    for p in polys(poly):
        x0, y0, x1, y1 = p.bounds
        i0, i1 = math.floor((x0 - origin[0]) / gu), math.ceil((x1 - origin[0]) / gu)
        j0, j1 = math.floor((y0 - origin[1]) / gv), math.ceil((y1 - origin[1]) / gv)
        for i in range(i0, i1):
            for j in range(j0, j1):
                cx0, cy0 = origin[0] + i * gu, origin[1] + j * gv
                part = p.intersection(rect(cx0, cy0, cx0 + gu, cy0 + gv))
                if not part.is_empty and part.area > 1e-6:
                    out += polys(part)
    return out


def planks(poly, width: float, lengths: tuple[float, ...], joint: float, origin=(0.0, 0.0)) -> tuple[list[Polygon], list[Polygon]]:
    """Long panels (along x) of `width` (along y) with staggered end joints: the plank lengths cycle through
    `lengths`, offset per row (deterministic). Returns (planks, joints) like `tiles`."""
    out_p, out_j = [], []
    h = joint / 2
    for p in polys(poly):
        x0, y0, x1, y1 = p.bounds
        j0, j1 = math.floor((y0 - origin[1]) / width), math.ceil((y1 - origin[1]) / width)
        for j in range(j0, j1):
            cy0 = origin[1] + j * width
            Lc = lengths[j % len(lengths)]
            xs = origin[0] - ((j * 0.37 * Lc) % Lc)
            while xs > x0:
                xs -= Lc
            while xs < x1:
                cell = rect(xs, cy0, xs + Lc, cy0 + width)
                part = p.intersection(cell)
                if not part.is_empty and part.area > 1e-6:
                    pl = part.intersection(rect(xs + h, cy0 + h, xs + Lc - h, cy0 + width - h))
                    out_p += polys(pl)
                    out_j += polys(part.difference(pl))
                xs += Lc
    return out_p, out_j
