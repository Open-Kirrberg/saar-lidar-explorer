"""Context ground (DGM1 draped, round diorama patch with a skirt), streets from OSM, and the walkable floor (nav).

Everything here works in EPSG:25832 (E, N) and drapes onto the DGM1 by bilinear interpolation between cell
centres. The patch is partitioned per 1 m cell into road / pavement / ground pieces (coplanar, no overlap, so no
z-fighting); buildings are cut out (they stand on their own LoD2 walls), except the public mouth of the passage.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable

import numpy as np
import shapely
from shapely import affinity, union_all
from shapely.geometry import LineString, Point, Polygon

from . import geom
from .context import ROAD_WIDTH, Dgm, circle
from .plan import E0, N0, Plan
from .scene import Scene, smooth

PATCH_R = 38.0        # ground patch radius around the shop (m)
NAV_R = 24.0          # walkable street area around the shop entrance (m)
PAVEMENT = 2.5        # paved strip beside the carriageway (m)
SKIRT = 3.0           # skirt depth below the lowest patch height (m)
FOOT = {"footway", "path", "steps", "pedestrian"}


def to_zone(en: np.ndarray, h: np.ndarray) -> np.ndarray:
    return np.column_stack([en[:, 0] - E0, h, -(en[:, 1] - N0)])


def b_to_en(p: Plan, geom_b):
    """Shapely geometry frame B -> E/N (affine)."""
    F = p.frame
    a, b = F.xa[0], F.ya[0]
    d, e = F.xa[1], F.ya[1]
    return affinity.affine_transform(geom_b, [a, b, d, e, F.oE, F.oN])


def passage_mouth_b(p: Plan) -> Polygon:
    yp, xf = p.passage_public_y, p.passage_far_x
    return Polygon([(p.north_outer_x(-0.6), -0.6), (xf, -0.6), (xf, yp), (p.north_outer_x(yp), yp)])


@dataclass
class Classes:
    circle: Polygon
    road: object
    pavement: object
    ground: object
    buildings: object
    centre: np.ndarray


def classes(p: Plan, blds: list[dict], ways: list[dict]) -> Classes:
    c = p.frame.en(np.array([21.0, 1.0]))
    circ = Polygon(circle(c[0], c[1], PATCH_R, 256))
    roads, sides, foot = [], [], []
    for w in ways:
        line = LineString(w["coords"])
        wd = ROAD_WIDTH[w["highway"]]
        if w["highway"] in FOOT:
            foot.append(line.buffer(wd / 2, cap_style="flat"))
        else:
            roads.append(line.buffer(wd / 2))
            sides.append(line.buffer(wd / 2 + PAVEMENT))
    mouth = b_to_en(p, passage_mouth_b(p))
    bfp = union_all([Polygon(np.asarray(f)[:, :2]) for b in blds for f in b["footprint"]]).buffer(0)
    bfp = bfp.difference(mouth)
    road = union_all(roads).intersection(circ).difference(bfp) if roads else Polygon()
    pav = union_all(sides + foot + [mouth]).intersection(circ).difference(road).difference(bfp)
    ground = circ.difference(bfp).difference(road).difference(pav)
    return Classes(circ, road, pav, ground, bfp, c)


def drape_parts(geom_en, dgm: Dgm, offset: float = 0.0) -> tuple[np.ndarray, np.ndarray]:
    """Partition by DGM cells (corners at cell centres), triangulate, heights bilinear: (zone verts, tris)."""
    gs = geom.polys(geom_en)
    if not gs:
        return np.zeros((0, 3)), np.zeros((0, 3), np.int64)
    x0, y0, x1, y1 = shapely.bounds(union_all(gs))
    res = dgm.res
    i0, i1 = math.floor((x0 - dgm.e0) / res), math.ceil((x1 - dgm.e0) / res)
    j0, j1 = math.floor((y0 - dgm.n0) / res), math.ceil((y1 - dgm.n0) / res)
    ii, jj = np.meshgrid(np.arange(i0, i1), np.arange(j0, j1), indexing="ij")
    ex, ny = dgm.e0 + ii.ravel() * res, dgm.n0 + jj.ravel() * res
    cells = shapely.box(ex, ny, ex + res, ny + res)
    target = union_all(gs)
    shapely.prepare(target)
    hit = shapely.intersects(target, cells)
    parts = shapely.intersection(cells[hit], target)
    V, T, nv = [], [], 0
    for part in parts:
        for v2, t in geom.triangulate(part):
            h = dgm(v2[:, 0], v2[:, 1]) + offset
            V.append(to_zone(v2, h))
            T.append(t + nv)
            nv += len(v2)
    if not V:
        return np.zeros((0, 3)), np.zeros((0, 3), np.int64)
    V, T = np.concatenate(V), np.concatenate(T)
    # upward winding (zone y up)
    a, b, cc = V[T[:, 0]], V[T[:, 1]], V[T[:, 2]]
    up = np.cross(b - a, cc - a)[:, 1]
    T[up < 0] = T[up < 0][:, [0, 2, 1]]
    return V, T


def build_ground(sc: Scene, p: Plan, cls: Classes, dgm: Dgm) -> None:
    bnd = cls.buildings.boundary if not cls.buildings.is_empty else None

    def ao(vz):
        if bnd is None:
            return np.ones(len(vz))
        en = np.column_stack([vz[:, 0] + E0, N0 - vz[:, 2]])
        d = shapely.distance(shapely.points(en), bnd)
        return 0.80 + 0.20 * smooth(0.0, 1.8, d)

    n = sc.node("umgebung/gelaende", "ext", source="plan", sigma=0.15)
    V, T = drape_parts(cls.ground, dgm)
    n.add_mesh("gelaende", V, T, ao)
    # skirt around the round patch
    ring = np.asarray(cls.circle.exterior.coords)[:-1]
    h = dgm(ring[:, 0], ring[:, 1])
    base = float(h.min()) - SKIRT
    for k in range(len(ring)):
        a, b = ring[k], ring[(k + 1) % len(ring)]
        ha, hb = h[k], h[(k + 1) % len(ring)]
        q = to_zone(np.array([a, b, b, a]), np.array([ha, hb, base, base]))
        mid = (a + b) / 2 - cls.centre
        nrm = np.array([mid[0], 0.0, -mid[1]])
        n.add("erde", q, geom.wind(q, np.array([[0, 1, 2], [0, 2, 3]]), nrm), nrm)
    s = sc.node("umgebung/strasse", "ext", source="plan", sigma=0.5)
    V, T = drape_parts(cls.road, dgm)
    s.add_mesh("asphalt", V, T, ao)
    V, T = drape_parts(cls.pavement, dgm)
    s.add_mesh("gehweg", V, T, ao)


# ----------------------------------------------------------------------------------------------- nav

@dataclass
class NavPiece:
    poly: object                      # E/N
    height: Callable[[np.ndarray], np.ndarray] | float   # const (m NHN) or dgm


def nav_pieces(p: Plan, cls: Classes, dgm: Dgm, obstacles_b: list, step_height: Callable[[Plan, float], float],
               door: dict, porch: dict) -> list[NavPiece]:
    F = p.frame
    z0 = F.z0
    R = Polygon([p.room[k] for k in p.room_order])
    f1 = p.fixtures["F1"]
    # customer side of the counter's front line (the counter body and the staff aisle lie on +uy)
    far = 50.0
    o, ux, uy = f1.xy, f1.ux, f1.uy
    half = Polygon([o - far * ux, o + far * ux, o + far * ux - far * uy, o - far * ux - far * uy])
    cust = R.intersection(half).difference(union_all(obstacles_b)) if obstacles_b else R.intersection(half)
    gw = 0.07  # glass front thickness (porch side of y = C.y)
    C = p.room["C"]
    doorway = geom.rect(door["xl"] + 0.02, C[1] - gw - 0.01, door["xr"] - 0.02, C[1] + 0.01)
    pieces = [NavPiece(b_to_en(p, cust.union(doorway).intersection(cust.union(doorway))), z0)]
    # porch treads (+ the strip through the side opening to the passage)
    st = p.stairs
    k = int(st["risers"])
    edges = [st["tread_v"] * i for i in range(k)] + [float(C[1]) - gw]
    x0, x1 = porch["x0"], porch["x1"]
    for i in range(k):
        ya, yb = edges[i], edges[i + 1]
        hz = z0 + step_height(p, (ya + yb) / 2)
        poly = geom.rect(x0, ya, x1, yb)
        sa, sb = max(ya, porch["y5a"]), min(yb, porch["y5b"])
        if sb - sa > 0.01:
            poly = poly.union(Polygon([(x1 - 0.01, sa), (p.north_outer_x(sa) + 0.02, sa), (p.north_outer_x(sb) + 0.02, sb), (x1 - 0.01, sb)]))
        if i == k - 1:
            poly = poly.union(doorway.intersection(geom.rect(x0, ya, x1, yb + 0.02)))
        pieces.append(NavPiece(b_to_en(p, poly), hz))
    # street + pavement + passage mouth around the entrance
    ent = F.en(np.array([(x0 + x1) / 2, -1.0]))
    area = Point(ent).buffer(NAV_R, 64)
    street = cls.road.union(cls.pavement).intersection(area)
    porch_en = b_to_en(p, geom.rect(x0, 0.0, x1 + 0.3, float(C[1])))
    pieces.append(NavPiece(street.difference(porch_en), dgm))
    return pieces


def nav_height(pieces: list[NavPiece], en: np.ndarray, dgm: Dgm) -> np.ndarray:
    out = dgm(en[:, 0], en[:, 1])
    pts = shapely.points(en)
    for pc in pieces:
        if callable(pc.height):
            continue
        inside = shapely.contains(pc.poly, pts) | (shapely.distance(pc.poly, pts) < 1e-6)
        out = np.where(inside, pc.height, out)
    return out


def build_nav(sc: Scene, pieces: list[NavPiece], dgm: Dgm) -> object:
    floor = sc.node("nav/floor", "flat", cid="nav", source="plan", sigma=0.1)
    for pc in pieces:
        if callable(pc.height):
            V, T = drape_parts(pc.poly, dgm)
            floor.add_mesh("nav", V, T)
        else:
            for v2, t in geom.triangulate(pc.poly):
                v = to_zone(v2, np.full(len(v2), pc.height))
                floor.add("nav", v, geom.wind(v, t, np.array([0, 1.0, 0])), np.array([0, 1.0, 0]))
    # closing (+2 cm / −2 cm) merges pieces that meet along a shared edge despite rounding: no fence inside the path
    U = union_all([pc.poly for pc in pieces]).buffer(0.02, join_style="mitre").buffer(-0.02, join_style="mitre")
    edge = sc.node("nav/edge", "flat", cid="nav", source="plan", sigma=0.1)
    for poly in geom.polys(U):
        poly = shapely.geometry.polygon.orient(poly, 1.0)
        for ring in [poly.exterior, *poly.interiors]:
            c = np.asarray(ring.coords)
            for a, b in zip(c[:-1], c[1:]):
                L = float(np.linalg.norm(b - a))
                if L < 1e-4:
                    continue
                k = max(1, int(math.ceil(L / 0.5)))
                d = (b - a) / L
                left = np.array([-d[1], d[0]])
                for j in range(k):
                    pa, pb = a + (b - a) * j / k, a + (b - a) * (j + 1) / k
                    m = (pa + pb) / 2 + 0.05 * left
                    h = float(nav_height(pieces, m[None], dgm)[0])
                    q = to_zone(np.array([pa, pb, pb, pa]), np.array([h - 0.3, h - 0.3, h + 2.0, h + 2.0]))
                    nrm = np.array([left[0], 0.0, -left[1]])  # faces the walkable side
                    edge.add("nav", q, geom.wind(q, np.array([[0, 1, 2], [0, 2, 3]]), nrm), nrm)
    return U
