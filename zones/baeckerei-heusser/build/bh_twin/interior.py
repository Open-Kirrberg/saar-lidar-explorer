"""Verkaufsraum shell: tiled floor, tiled walls (real thickness through the window reveals), panel ceiling with the
bulkhead over the shop windows, wood soffit with red edge over the counter, glazed side wall, glass front with the
open double door, the rear corridor with its closed door. All from the Raumplan (frame B, scaled by plan.f).
"""
from __future__ import annotations

import numpy as np
import shapely
from shapely.geometry import Point, Polygon

from . import geom
from .plan import (BACKDOOR_HEAD, DOOR_HEAD, DOOR_LEAF, GLASS_WALL, Plan)
from .scene import Scene, smooth

FLOOR_TILE = 0.30
WALL_TILE = (0.30, 0.60)
PANEL = 0.625
FRAME = 0.05  # glazing bar width


def room_polygons(p: Plan) -> tuple[Polygon, Polygon, Polygon]:
    """(sales room, rear corridor stub, floor = both)."""
    R = Polygon([p.room[k] for k in p.room_order])
    G, H = p.room["G"], p.room["H"]
    ye = p.corridor_end_y
    C = Polygon([H, G, (G[0], ye), (H[0], ye)])
    return R, C, R.union(C)


def wall_loop(p: Plan) -> list[tuple[str, np.ndarray, np.ndarray]]:
    """Tiled inner wall faces, counter-clockwise (room on the left): (wall id, from, to). W2/W3 are glass."""
    r = p.room
    ye = p.corridor_end_y
    G2, H2 = np.array([r["G"][0], ye]), np.array([r["H"][0], ye])
    return [("W1", r["A"], r["B"]), ("W4", r["D"], r["E"]), ("W5", r["E"], r["F"]), ("W6", r["F"], r["G"]),
            ("K-O", r["G"], G2), ("K-T", G2, H2), ("K-W", H2, r["H"]), ("W6", r["H"], r["I"]),
            ("W7", r["I"], r["K"]), ("W8", r["K"], r["A"])]


def soffit_polygon(p: Plan, room: Polygon) -> Polygon:
    f10 = p.fixtures["F10"]
    return Polygon(f10.footprint()).intersection(room)


def build(sc: Scene, p: Plan) -> None:
    R, Cor, floor = room_polygons(p)
    edge = floor.boundary
    ceil = p.ceiling
    src, sig = "mesh", p.sigma["room"]

    def floor_ao(v2):
        d = shapely.distance(shapely.points(v2), edge)
        return 0.80 + 0.20 * smooth(0.0, 0.5, d)

    def wall_ao(v2):
        z = v2[:, 1]
        return (0.84 + 0.16 * smooth(0.0, 0.45, z)) * (1 - 0.05 * smooth(ceil - 0.25, ceil, z))

    # ---- floor
    n = sc.node("verkaufsraum/boden", "int", source=src, sigma=sig)
    t, g = geom.tiles(floor, FLOOR_TILE, FLOOR_TILE, 0.008, origin=tuple(p.room["A"]))
    sc.hface(n, "fliese", _multi(t), 0.0, True, floor_ao)
    sc.hface(n, "fliese-fuge", _multi(g), 0.0, True, floor_ao)

    # ---- tiled walls (openings: shop windows in W1, the closed back door at the corridor end)
    n = sc.node("verkaufsraum/wandfliesen", "int", source=src, sigma=sig)
    o1, o2 = p.openings["O1"], p.openings["O2"]
    for wid, a, b in wall_loop(p):
        L = float(np.linalg.norm(b - a))
        shape = geom.rect(0, 0, L, ceil)
        if wid == "W1":
            for o in (o1, o2):
                s0, s1 = sorted([float(o["from"][0] - a[0]), float(o["to"][0] - a[0])])
                shape = shape.difference(geom.rect(s0, o["sill"], s1, o["head"]))
        if wid == "K-T":
            shape = shape.difference(geom.rect(FRAME, 0, L - FRAME, p.H(BACKDOOR_HEAD)))
        tl, gr = geom.tiles(shape, WALL_TILE[0], WALL_TILE[1], 0.006)
        sc.vface(n, "fliese", a, b, _multi(tl), True, wall_ao)
        sc.vface(n, "fliese-fuge", a, b, _multi(gr), True, wall_ao)

    # ---- ceiling: panels, bulkhead over the shop windows, wood soffit with red edge over the counter
    S = soffit_polygon(p, R)
    A, B = p.room["A"], p.room["B"]
    bulk = geom.rect(A[0], A[1], B[0], p.bulkhead_y).difference(S)
    n = sc.node("verkaufsraum/rasterdecke", "int", source=src, sigma=p.sigma["ceiling"])
    panel_area = floor.difference(S).difference(bulk)
    t, g = geom.tiles(panel_area, PANEL, PANEL, 0.02, origin=tuple(A))
    sc.hface(n, "decke", _multi(t), ceil, False)
    sc.hface(n, "decke-raster", _multi(g), ceil, False)
    sc.hface(n, "decke", bulk, p.bulkhead_h, False)
    for seg in _free_edges(bulk, R):
        a, b = seg
        # the bulkhead's room-side face looks away from the window (+y)
        sc.vrect(n, "decke", a, b, p.bulkhead_h, ceil, left=_left_points_out(a, b, bulk))
    n = sc.node("verkaufsraum/deckenblende", "int", source="photo", sigma=p.fixtures["F10"].sigma)
    zs = p.H(p.fixtures["F10"].raw["underside"]["v"])
    sc.hface(n, "holz", S, zs, False)
    for a, b in _free_edges(S, R):
        sc.vrect(n, "heusser-rot", a, b, zs, ceil, left=_left_points_out(a, b, S))

    # ---- glazed side wall (W2) and glass front with the double door (W3)
    _glass_side_wall(sc, p)
    _glass_front(sc, p)
    _back_door(sc, p)


def _multi(ps) -> list:
    """Tile/grout pieces as a plain list (they touch: never merge them into one MultiPolygon)."""
    return [q for q in ps if not q.is_empty]


def _free_edges(poly: Polygon, room: Polygon, tol: float = 0.03) -> list[tuple[np.ndarray, np.ndarray]]:
    """Edges of `poly` that do not lie on the room boundary (where a fascia is visible)."""
    out = []
    rb = room.boundary
    for q in geom.polys(poly):
        c = np.asarray(q.exterior.coords)
        for a, b in zip(c[:-1], c[1:]):
            if np.linalg.norm(b - a) < 0.02:
                continue
            m = (a + b) / 2
            if rb.distance(Point(m)) > tol:
                out.append((a, b))
    return out


def _left_points_out(a, b, poly: Polygon) -> bool:
    d = (b - a) / np.linalg.norm(b - a)
    m = (a + b) / 2 + np.array([-d[1], d[0]]) * 0.01
    return not poly.contains(Point(m))


def _glass_side_wall(sc: Scene, p: Plan) -> None:
    n = sc.node("verkaufsraum/glaswand", "int", source="mesh", sigma=p.sigma["room"])
    B, C = p.room["B"], p.room["C"]
    x0, x1 = B[0], B[0] + GLASS_WALL
    ceil = p.ceiling
    # frame: posts at both ends, bottom + top rails (black), pane in the middle plane
    for y0, y1 in ((B[1], B[1] + FRAME), (C[1] - FRAME, C[1])):
        sc.box(n, "lack-schwarz", (x0, y0), 0, x1 - x0, y1 - y0, ceil, 0.0, 0.004)
    sc.box(n, "lack-schwarz", (x0, B[1]), 0, x1 - x0, C[1] - B[1], 0.06, 0.0, 0.004)
    sc.box(n, "lack-schwarz", (x0, B[1]), 0, x1 - x0, C[1] - B[1], 0.05, ceil - 0.05, 0.004)
    xm = (x0 + x1) / 2
    sc.vrect(n, "glas", (xm, B[1] + FRAME), (xm, C[1] - FRAME), 0.06, ceil - 0.05, left=False)


def door_geometry(p: Plan) -> dict:
    C, D = p.room["C"], p.room["D"]
    dm = (C[0] + D[0]) / 2
    leaf = p.f * DOOR_LEAF
    return {"y": C[1], "x0": C[0], "x1": D[0], "xl": dm - leaf, "xr": dm + leaf, "leaf": leaf, "head": p.H(DOOR_HEAD)}


LEAF_T = 0.045   # door leaf thickness (stiles)


def door_leaf_obstacles(p: Plan, margin: float = 0.18) -> list:
    """Footprints (frame B) of the two open door leaves, buffered by the walker's body radius: the walker collides
    with nav.glb only, so the leaves must be cut out of the walkable floor."""
    g = door_geometry(p)
    y1, leaf = g["y"], g["leaf"] - 0.02
    out = []
    for xh, sgn in ((g["xl"], 1), (g["xr"], -1)):
        xa = xh if sgn > 0 else xh - LEAF_T
        out.append(geom.rect(xa, y1 + 0.01, xa + LEAF_T, y1 + 0.01 + leaf).buffer(margin, join_style="mitre"))
    return out


def _glass_front(sc: Scene, p: Plan) -> None:
    n = sc.node("verkaufsraum/ladentuer", "int", source="mesh", sigma=p.openings["O4"]["width"]["sigma_m"])
    g = door_geometry(p)
    y1 = g["y"]
    y0 = y1 - GLASS_WALL
    ceil = p.ceiling
    head = g["head"]
    for xc in (g["x0"], g["xl"] - FRAME, g["xr"], g["x1"] - FRAME):
        sc.box(n, "lack-schwarz", (xc, y0), 0, FRAME, GLASS_WALL, ceil, 0.0, 0.004)
    # side panes (with a bottom rail), transom over the door, top rail
    for xa, xb in ((g["x0"] + FRAME, g["xl"] - FRAME), (g["xr"] + FRAME, g["x1"] - FRAME)):
        sc.box(n, "lack-schwarz", (xa, y0), 0, xb - xa, GLASS_WALL, 0.10, 0.0, 0.004)
        sc.vrect(n, "glas", (xa, (y0 + y1) / 2), (xb, (y0 + y1) / 2), 0.10, ceil - 0.05, left=False)
    sc.box(n, "lack-schwarz", (g["xl"] - FRAME, y0), 0, g["xr"] - g["xl"] + 2 * FRAME, GLASS_WALL, 0.06, head, 0.004)
    sc.vrect(n, "glas", (g["xl"], (y0 + y1) / 2), (g["xr"], (y0 + y1) / 2), head + 0.06, ceil - 0.05, left=False)
    sc.box(n, "lack-schwarz", (g["x0"], y0), 0, g["x1"] - g["x0"], GLASS_WALL, 0.05, ceil - 0.05, 0.004)
    # two glass leaves, standing open into the shop (hinges on the door posts)
    leaf, t = g["leaf"] - 0.02, LEAF_T
    for xh, sgn in ((g["xl"], 1), (g["xr"], -1)):
        xa = xh if sgn > 0 else xh - t
        sc.box(n, "lack-schwarz", (xa, y1 + 0.01), 0, t, 0.06, head - 0.02, 0.01, 0.004)          # hinge stile
        sc.box(n, "lack-schwarz", (xa, y1 + leaf - 0.06), 0, t, 0.06, head - 0.02, 0.01, 0.004)   # lock stile
        sc.box(n, "lack-schwarz", (xa, y1 + 0.01), 0, t, leaf, 0.12, 0.01, 0.004)                  # kick rail
        sc.box(n, "lack-schwarz", (xa, y1 + 0.01), 0, t, leaf, 0.06, head - 0.07, 0.004)           # top rail
        xm = xa + t / 2
        sc.vrect(n, "glas", (xm, y1 + 0.07), (xm, y1 + leaf - 0.06), 0.13, head - 0.07, left=sgn < 0)
        sc.box(n, "messing", (xa - 0.02 if sgn > 0 else xa + t, y1 + leaf - 0.10), 0, 0.02, 0.03, 0.35, 0.95, 0.005)  # handle


def _back_door(sc: Scene, p: Plan) -> None:
    n = sc.node("verkaufsraum/hintertuer", "int", source="mesh", sigma=p.openings["O6"]["width"]["sigma_m"])
    G, H = p.room["G"], p.room["H"]
    ye = p.corridor_end_y
    head = p.H(BACKDOOR_HEAD)
    xa, xb = H[0] + FRAME, G[0] - FRAME
    sc.box(n, "holz", (xa, ye - 0.06), 0, xb - xa, 0.04, head - 0.01, 0.0, 0.006)
    for x in (H[0], G[0] - FRAME):
        sc.box(n, "lack-schwarz", (x, ye - 0.07), 0, FRAME, 0.07, head + FRAME, 0.0, 0.004)
    sc.box(n, "lack-schwarz", (H[0], ye - 0.07), 0, G[0] - H[0], 0.07, FRAME, head, 0.004)
    sc.box(n, "messing", (xb - 0.14, ye - 0.09), 0, 0.10, 0.03, 0.025, 1.0, 0.004)
