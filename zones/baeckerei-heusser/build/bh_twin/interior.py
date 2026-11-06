"""Verkaufsraum shell: tiled floor (laid diagonally, parallel to the counter), tall white marble-look wall panels
(window wall: white render), near-white plank ceiling with the bulkhead over the shop windows, red ceiling trim under
a white cove, the soffit over the counter (wood fascia between two red lines, white plank underside), glazed side wall
and glass front with the automatic sliding door (standing open) in white aluminium frames, the rear corridor with its
closed door. All from the Raumplan (frame B, scaled by plan.f); look from the walkthrough video (round 3) and the 2026
photo of the counter (wave B).
"""
from __future__ import annotations

import numpy as np
import shapely
from shapely.geometry import Point, Polygon

from . import geom
from .plan import (BACKDOOR_HEAD, DOOR_HEAD, GLASS_WALL, Plan)
from .scene import Scene, smooth

FLOOR_TILE = 0.30
FLOOR_ROT = 45.0           # tiles laid diagonally to the facade, parallel to the counter and the bread wall (video)
WALL_PANEL = 0.75          # tall marble-look wall panels ≈ 0.6–0.9 wide, room high (video)
PLANK_W = 0.28             # ceiling planks ≈ 0.25–0.30 wide, staggered joints (video)
PLANK_L = (2.4, 1.8, 3.0)
AO_GRID = 0.45             # extra vertices on big faces so the vertex AO / baked light has resolution
COVE = 0.14                # white cove (sloped frieze) at the wall top ...
TRIM_H = 0.04              # ... with the red trim line under it
FASCIA_RED = 0.015         # soffit over the counter: wood fascia (plan F10 h) between two red lines, white underside
FRAME = 0.05  # glazing bar width
GLAZING = "alu-weiss"      # white aluminium frames of the glass front and the glazed side wall (video, inside view)
LEAF_FRAME = 0.04          # narrow white frame round each sliding leaf
# Downward faces (ceiling planks, bulkhead and soffit undersides) only see the rig's warm floor bounce, which turned the
# near-white ceiling peach. The real ceiling is lit by the white floor, walls and lamps: lift those faces to a warm
# white (≈ 0.88 / 0.85 / 0.80 light instead of 0.70 × the bounce tint). Per channel, scaled by how far a face looks down.
CEILING_LIFT = (1.26, 1.43, 1.67)
SLIDE_LEAF = 0.60          # automatic sliding door: 4 equal fields in the 2.48 glass front (2 fixed side panes, 2 leaves,
                           # video); clear opening 2 × 0.60 (the plan leaves the clear width open: O4 note)


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

    # concave room corners (vertical edges) for the vertex AO
    sc.ao.corner([p.room[k] for k in ("A", "D", "E", "I", "K")], 0.14, 0.45)

    # ---- floor (light grey-white tiles, laid at 45° to the facade)
    n = sc.node("verkaufsraum/boden", "int", source=src, sigma=sig)
    t, g = rotated_tiles(floor, FLOOR_TILE, 0.008, tuple(p.room["A"]), FLOOR_ROT)
    sc.hface(n, "boden-fliese", _multi(t), 0.0, True, floor_ao)
    sc.hface(n, "boden-fuge", _multi(g), 0.0, True, floor_ao)

    # ---- walls: tall marble-look panels (openings: the closed back door at the corridor end); the window wall W1
    # (piers, reveals, lintel) is white render
    n = sc.node("verkaufsraum/wandfliesen", "int", source=src, sigma=sig)
    o1, o2 = p.openings["O1"], p.openings["O2"]
    for wid, a, b in wall_loop(p):
        L = float(np.linalg.norm(b - a))
        shape = geom.rect(0, 0, L, ceil)
        if wid == "W1":
            for o in (o1, o2):
                s0, s1 = sorted([float(o["from"][0] - a[0]), float(o["to"][0] - a[0])])
                shape = shape.difference(geom.rect(s0, o["sill"], s1, o["head"]))
            sc.vface(n, "putz-weiss", a, b, geom.grid_split(shape, AO_GRID, AO_GRID), True, wall_ao)
            continue
        if wid == "K-T":
            shape = shape.difference(geom.rect(FRAME, 0, L - FRAME, p.H(BACKDOOR_HEAD)))
        tl, gr = geom.tiles(shape, WALL_PANEL, ceil + 0.01, 0.004)
        parts = [q for pl in _multi(tl) for q in geom.grid_split(pl, WALL_PANEL, AO_GRID)]
        sc.vface(n, "fliese", a, b, parts, True, wall_ao)
        sc.vface(n, "fliese-fuge", a, b, _multi(gr), True, wall_ao)

    # ---- ceiling: near-white planks, bulkhead over the shop windows, the soffit over the counter
    S = soffit_polygon(p, R)
    A, B = p.room["A"], p.room["B"]
    bulk = geom.rect(A[0], A[1], B[0], p.bulkhead_y)
    n = sc.node("verkaufsraum/rasterdecke", "int", source=src, sigma=p.sigma["ceiling"])
    panel_area = floor.difference(bulk)
    t, g = geom.planks(panel_area, PLANK_W, PLANK_L, 0.006, origin=tuple(A))
    sc.hface(n, "decke", _multi(t), ceil, False)
    sc.hface(n, "decke-raster", _multi(g), ceil, False)
    sc.hface(n, "decke", geom.grid_split(bulk, AO_GRID * 2, AO_GRID), p.bulkhead_h, False)
    for seg in _free_edges(bulk, R):
        a, b = seg
        # the bulkhead's room-side face looks away from the window (+y)
        sc.vrect(n, "decke", a, b, p.bulkhead_h, ceil, left=_left_points_out(a, b, bulk))
    n = sc.node("verkaufsraum/deckenblende", "int", source="photo", sigma=p.fixtures["F10"].sigma)
    f10 = p.fixtures["F10"]
    zs = p.H(f10.raw["underside"]["v"])
    zt = zs + soffit_height(p)
    # hanging beam (2026 photo, video): white plank underside (the pendants hang from it), the wood only on the
    # vertical fascia between two red lines, white cover on top, thin white hangers to the ceiling
    under, joints = soffit_underside(p, S)
    sc.hface(n, "decke", under, zs, False)
    sc.hface(n, "decke-raster", joints, zs - 0.0005, False)
    for a, b in _free_edges(S, R):
        out = _left_points_out(a, b, S)
        for mat, z0, z1 in fascia_bands(zs, zt):
            sc.vrect(n, mat, a, b, z0, z1, left=out)
    sc.prism(n, "regal-weiss", S.buffer(0.015, join_style="mitre"), zt, zt + 0.02, top=True, bottom=True)
    for t in (0.08, 0.5, 0.92):
        c = f10.xy + t * f10.l * f10.ux + 0.5 * f10.d * f10.uy
        sc.cylinder(n, "regal-weiss", c, 0.008, zt + 0.02, ceil, 6)

    for name in ("verkaufsraum/rasterdecke", "verkaufsraum/deckenblende"):
        lift_downward(sc.nodes[name], CEILING_LIFT)

    _ceiling_trim(sc, p, bulk)

    # ---- glazed side wall (W2) and glass front with the sliding door (W3)
    _glass_side_wall(sc, p)
    _glass_front(sc, p)
    _back_door(sc, p)


def lift_downward(node, lift) -> None:
    """Multiply the baked light of `node`'s downward-facing vertices by `lift` (per channel, weighted by −n_y)."""
    k = np.asarray(lift, np.float64) - 1.0
    for pr in node.prims.values():
        for i, (c, nrm) in enumerate(zip(pr.col, pr.nrm)):
            down = np.clip(-nrm[:, 1], 0.0, 1.0)[:, None]
            pr.col[i] = np.clip(c * (1.0 + k * down), 0.0, 1.0)


def rotated_tiles(poly, tile: float, grout: float, origin, rot_deg: float) -> tuple[list, list]:
    """`geom.tiles` on a grid turned by `rot_deg` about `origin` (tiles, grout; coplanar, non-overlapping). Pure."""
    from shapely import affinity
    flat = affinity.rotate(poly, -rot_deg, origin=origin)
    t, g = geom.tiles(flat, tile, tile, grout, origin=origin)
    back = lambda q: affinity.rotate(q, rot_deg, origin=origin)  # noqa: E731
    return [back(q) for q in t], [back(q) for q in g]


def soffit_height(p: Plan) -> float:
    """Height of the soffit's fascia (plan F10 `h`, scaled)."""
    return float(p.fixtures["F10"].h)


def fascia_bands(zs: float, zt: float) -> list[tuple[str, float, float]]:
    """The soffit fascia from its lower edge `zs` to `zt`: red line, wood, red line (2026 photo). Pure."""
    r = min(FASCIA_RED, (zt - zs) / 4)
    return [("heusser-rot", zs, zs + r), ("holz", zs + r, zt - r), ("heusser-rot", zt - r, zt)]


def soffit_underside(p: Plan, S: Polygon) -> tuple[list, list]:
    """White plank underside of the soffit: planks ≈ PLANK_W wide along the beam, thin joints between them."""
    f10 = p.fixtures["F10"]
    n = max(1, round(f10.d / PLANK_W))
    joints = []
    for k in range(1, n):
        y = f10.d * k / n
        c = [f10.xy + t * f10.l * f10.ux + (y + e) * f10.uy for t, e in ((0, -0.003), (1, -0.003), (1, 0.003), (0, 0.003))]
        j = Polygon(c).intersection(S)
        if not j.is_empty:
            joints += geom.polys(j)
    under = S.difference(shapely.union_all(joints)) if joints else S
    return geom.grid_split(under, AO_GRID * 2, AO_GRID), joints


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
    # frame: posts at both ends, bottom + top rails (white aluminium), pane in the middle plane
    for y0, y1 in ((B[1], B[1] + FRAME), (C[1] - FRAME, C[1])):
        sc.box(n, GLAZING, (x0, y0), 0, x1 - x0, y1 - y0, ceil, 0.0, 0.004)
    sc.box(n, GLAZING, (x0, B[1]), 0, x1 - x0, C[1] - B[1], 0.06, 0.0, 0.004)
    sc.box(n, GLAZING, (x0, B[1]), 0, x1 - x0, C[1] - B[1], 0.05, ceil - 0.05, 0.004)
    xm = (x0 + x1) / 2
    sc.vrect(n, "glas", (xm, B[1] + FRAME), (xm, C[1] - FRAME), 0.06, ceil - 0.05, left=False)


def door_geometry(p: Plan) -> dict:
    C, D = p.room["C"], p.room["D"]
    dm = (C[0] + D[0]) / 2
    leaf = p.f * SLIDE_LEAF
    return {"y": C[1], "x0": C[0], "x1": D[0], "xl": dm - leaf, "xr": dm + leaf, "leaf": leaf, "head": p.H(DOOR_HEAD)}


LEAF_T = 0.03    # sliding leaf thickness


def _parked_leaves(p: Plan) -> list:
    """Footprints (frame B) of the two sliding leaves, standing open: slid sideways behind the fixed side panes,
    on the shop side of the glass front (video: automatic sliding door, no hinged leaves)."""
    g = door_geometry(p)
    y = g["y"] + 0.015
    leaf = g["leaf"] + 0.02
    return [geom.rect(g["xl"] - leaf + 0.03, y, g["xl"] + 0.03, y + LEAF_T),
            geom.rect(g["xr"] - 0.03, y, g["xr"] + leaf - 0.03, y + LEAF_T)]


def door_leaf_obstacles(p: Plan, margin: float = 0.05) -> list:
    """The parked sliding leaves, buffered a little: the walker collides with nav.glb only."""
    return [q.buffer(margin, join_style="mitre") for q in _parked_leaves(p)]


def _glass_front(sc: Scene, p: Plan) -> None:
    n = sc.node("verkaufsraum/ladentuer", "int", source="mesh", sigma=p.openings["O4"]["width"]["sigma_m"])
    g = door_geometry(p)
    y1 = g["y"]
    y0 = y1 - GLASS_WALL
    ceil = p.ceiling
    head = g["head"]
    for xc in (g["x0"], g["xl"] - FRAME, g["xr"], g["x1"] - FRAME):
        sc.box(n, GLAZING, (xc, y0), 0, FRAME, GLASS_WALL, ceil, 0.0, 0.004)
    # fixed side panes (with a bottom rail), transom over the door, top rail
    for xa, xb in ((g["x0"] + FRAME, g["xl"] - FRAME), (g["xr"] + FRAME, g["x1"] - FRAME)):
        sc.box(n, GLAZING, (xa, y0), 0, xb - xa, GLASS_WALL, 0.10, 0.0, 0.004)
        sc.vrect(n, "glas", (xa, (y0 + y1) / 2), (xb, (y0 + y1) / 2), 0.10, ceil - 0.05, left=False)
    sc.box(n, GLAZING, (g["xl"] - FRAME, y0), 0, g["xr"] - g["xl"] + 2 * FRAME, GLASS_WALL, 0.06, head, 0.004)
    sc.vrect(n, "glas", (g["xl"], (y0 + y1) / 2), (g["xr"], (y0 + y1) / 2), head + 0.06, ceil - 0.05, left=False)
    sc.box(n, GLAZING, (g["x0"], y0), 0, g["x1"] - g["x0"], GLASS_WALL, 0.05, ceil - 0.05, 0.004)
    # two sliding leaves (glass in a narrow white frame), parked open behind the side panes
    lf = LEAF_FRAME
    for q in _parked_leaves(p):
        x0, ya, x1, yb = q.bounds
        sc.box(n, GLAZING, (x0, ya), 0, x1 - x0, yb - ya, 0.08, 0.005, 0.004)                     # bottom rail
        sc.box(n, GLAZING, (x0, ya), 0, x1 - x0, yb - ya, 0.10, head - 0.11, 0.004)               # top rail
        for xe in (x0, x1 - lf):
            sc.box(n, GLAZING, (xe, ya), 0, lf, yb - ya, head - 0.20, 0.085, 0.003)               # stiles
        ym = (ya + yb) / 2
        sc.vrect(n, "glas", (x0 + lf, ym), (x1 - lf, ym), 0.085, head - 0.11, left=True)
    # door operator over the opening (white box) with the motion sensor
    xa, xb = _parked_leaves(p)[0].bounds[0] - 0.05, _parked_leaves(p)[1].bounds[2] + 0.05
    sc.box(n, GLAZING, (xa, y1 + 0.005), 0, xb - xa, 0.14, ceil - head - 0.02, head, 0.006)
    sc.box(n, "lack-schwarz", ((g["xl"] + g["xr"]) / 2 - 0.08, y1 + 0.14), 0, 0.16, 0.012, 0.05, head + 0.02, 0.004)


def _ceiling_trim(sc: Scene, p: Plan, bulk) -> None:
    """Red trim line under a white cove where the walls meet the ceiling (W4–W8; the window wall has the bulkhead)."""
    n = sc.node("verkaufsraum/zierleiste", "int", source="photo", sigma=0.1)
    ceil = p.ceiling
    yb = p.bulkhead_y
    for wid, a, b in wall_loop(p):
        if wid.startswith("K-") or wid == "W1":
            continue
        a, b = np.asarray(a, np.float64), np.asarray(b, np.float64)
        # clip the part over the bulkhead (y < bulkhead_y: the wall top is lower there)
        if a[1] < yb or b[1] < yb:
            if abs(b[1] - a[1]) < 1e-9:
                continue
            t = (yb - a[1]) / (b[1] - a[1])
            m = a + t * (b - a)
            a, b = (m, b) if a[1] < yb else (a, m)
        L = float(np.linalg.norm(b - a))
        if L < 0.05:
            continue
        d = (b - a) / L
        nl = np.array([-d[1], d[0]])                                  # into the room (room on the left)
        pts = np.array([[*a, ceil - COVE], [*b, ceil - COVE], [*(b + COVE * nl), ceil], [*(a + COVE * nl), ceil]])
        sc.quad(n, "regal-weiss", pts, np.array([nl[0], nl[1], -1.0]) / np.sqrt(2))
        e = 0.006
        a2, b2 = a + e * nl, b + e * nl
        sc.vrect(n, "thekenrot", a2, b2, ceil - COVE - TRIM_H, ceil - COVE, left=True)
        sc.hface(n, "thekenrot", _strip(a, b, nl, e), ceil - COVE - TRIM_H, False)             # underside


def _strip(a, b, nl, e) -> Polygon:
    return Polygon([a, b, b + e * nl, a + e * nl])


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
