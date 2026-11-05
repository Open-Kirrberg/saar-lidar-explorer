"""Exterior: the bakery's LoD2 envelope (walls with the shop windows, the porch arch and the side opening to the
passage cut out, sandstone plinth, roof), window reveals + glazing, the porch (arch soffit, reveals, ceiling,
corner pillar faces, 5 granite steps), the covered passage up to the shop door, the neighbours as LoD2 blocks. Round 3b: the facade details from the plan's
`site.facade` block (facade.py): slip plinth, glass blocks, window surrounds and keystones, gable (instead of the LoD2
hip) with the mural, slate front roof, windows, gutter, downpipes, sign, handrail; flat porch lintel (video).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable

import numpy as np
from shapely import union_all
from shapely.geometry import Point, Polygon

from . import geom
from .context import newell, stable_pick
from .facade import Facade, gable_roof_regions, make_gable, slate_roof
from .plan import ARCH_SPRING, GLASS_WALL, PASSAGE_HEAD, PORCH_REVEAL, Plan
from .scene import Scene

PLINTH_TOP = 0.05     # sandstone plinth up to the shop-window sill (above ±0.00)
WALL_SINK = 1.0       # LoD2 walls are extended this far below their ground (no gaps on the slope)


@dataclass
class Cutter:
    """Axis-aligned box in frame B; walls whose line passes through it get a hole [z0, top(x, y)]."""
    x0: float
    x1: float
    y0: float
    y1: float
    z0: float
    top: Callable[[np.ndarray], np.ndarray] | float


def porch_flat(p: Plan) -> bool:
    """Round 3b: the video shows a straight porch lintel (soffit = porch ceiling), not the v0 arch."""
    return ((p.raw["site"].get("facade") or {}).get("vorbau") or {}).get("sturz") == "flach"


def porch_spring(p: Plan) -> float:
    return p.ceiling if porch_flat(p) else p.H(ARCH_SPRING)


def arch_top(p: Plan) -> Callable[[np.ndarray], np.ndarray]:
    """Segmental arch over the porch opening O3: springing ARCH_SPRING at both jambs, crown = O3 head; flat at the porch
    ceiling when the plan says so."""
    if porch_flat(p):
        return lambda xy: np.full(np.asarray(xy).shape[:-1], p.ceiling)
    o3 = p.openings["O3"]
    x0, x1 = float(o3["from"][0]), float(o3["to"][0])
    crown, spring = o3["head"], p.H(ARCH_SPRING)
    half = (x1 - x0) / 2
    rise = crown - spring
    R = (half ** 2 + rise ** 2) / (2 * rise)
    xc, zc = (x0 + x1) / 2, crown - R

    def top(xy):
        x = np.clip(np.asarray(xy, np.float64)[..., 0], x0, x1)
        return zc + np.sqrt(np.maximum(R ** 2 - (x - xc) ** 2, 0))
    return top


def porch_frame(p: Plan) -> dict:
    o3, o5 = p.openings["O3"], p.openings["O5"]
    return {"x0": float(o3["from"][0]), "x1": float(o3["to"][0]),       # porch opening (street), pillar from x1
            "y5a": float(o5["from"][1]), "y5b": float(o5["to"][1]),     # side opening to the passage
            "head5": p.H(PASSAGE_HEAD), "reveal": p.f * PORCH_REVEAL}


def bakery_cutters(p: Plan) -> list[Cutter]:
    pf = porch_frame(p)
    cs = []
    for oid in ("O1", "O2"):
        o = p.openings[oid]
        cs.append(Cutter(float(o["from"][0]), float(o["to"][0]), -0.3, 0.3, o["sill"], o["head"]))
    cs.append(Cutter(pf["x0"], pf["x1"], -0.3, 0.3, -5.0, arch_top(p)))
    xo = p.north_outer_x(1.0)
    cs.append(Cutter(xo - 0.4, xo + 0.4, pf["y5a"], pf["y5b"], -5.0, pf["head5"]))
    if p.raw["site"].get("facade"):
        for x0, x1, y0, y1, z0, z1, _ in Facade(p, p.raw["site"]["facade"]).openings():
            cs.append(Cutter(x0, x1, y0, y1, z0, z1))
    return cs


def passage_cutter(p: Plan) -> Cutter:
    return Cutter(p.north_outer_x(0.0) - 0.15, p.passage_far_x, -0.6, p.passage_public_y, -5.0, p.H(PASSAGE_HEAD))


def _line_box(p0, d, c: Cutter) -> tuple[float, float] | None:
    t0, t1 = -1e9, 1e9
    for k, (lo, hi) in enumerate(((c.x0, c.x1), (c.y0, c.y1))):
        if abs(d[k]) < 1e-12:
            if not (lo <= p0[k] <= hi):
                return None
            continue
        a, b = (lo - p0[k]) / d[k], (hi - p0[k]) / d[k]
        t0, t1 = max(t0, min(a, b)), min(t1, max(a, b))
    return (t0, t1) if t1 - t0 > 0.01 else None


def lod2_wall(sc: Scene, node: geom.Node, ring_b: np.ndarray, footprint: Polygon, cutters: list[Cutter],
              sink_to: float | None, plinth: float | None, mat: str, plinth_draw: Callable | None = None) -> None:
    """One LoD2 wall ring, openings cut out, sunk to `sink_to`; below `plinth` drawn as `sockel` or by
    `plinth_draw(node, p0, p1, shape, outward_xy)` (the street wall's slip plinth)."""
    ring_b = np.asarray(ring_b, np.float64)
    nrm = newell(ring_b)
    if abs(nrm[2]) > 0.25 or np.linalg.norm(nrm[:2]) < 1e-6:     # not vertical: draw as is
        sc.quad(node, mat, ring_b, nrm)
        return
    nh = nrm[:2] / np.linalg.norm(nrm[:2])
    mid = ring_b[:, :2].mean(0)
    if footprint.buffer(-0.02).contains(Point(mid + 0.25 * nh)):
        nh = -nh
    d = np.array([nh[1], -nh[0]])
    s = (ring_b[:, :2] - mid) @ d
    z = ring_b[:, 2].copy()
    if sink_to is not None:
        z[z <= z.min() + 0.05] = min(z.min(), sink_to)
    shape = Polygon(np.column_stack([s, z]))
    if not shape.is_valid or shape.area < 1e-4:
        shape = geom.polys(shape)
        if not shape:
            return
        shape = shape[0]
    for c in cutters:
        iv = _line_box(mid, d, c)
        if not iv:
            continue
        ts = np.linspace(iv[0], iv[1], 17)
        xy = mid + ts[:, None] * d
        top = c.top(xy) if callable(c.top) else np.full(len(ts), float(c.top))
        hole = Polygon([(iv[0], c.z0), (iv[1], c.z0)] + list(zip(ts[::-1], top[::-1])))
        shape = shape.difference(hole)
    p0, p1 = mid, mid + d
    if plinth is not None:
        lo = shape.intersection(geom.rect(-1e4, -1e4, 1e4, plinth))
        hi = shape.difference(geom.rect(-1e4, -1e4, 1e4, plinth))
        if plinth_draw is not None and plinth_draw(node, p0, p1, lo, nh):
            pass
        else:
            sc.vface(node, "sockel", p0, p1, lo, True)
        sc.vface(node, mat, p0, p1, hi, True, cdt=True)          # openings on one sill line: no T-junction cracks
    else:
        sc.vface(node, mat, p0, p1, shape, True, cdt=True)


def roof(sc: Scene, node: geom.Node, ring_b: np.ndarray, mat: str = "dach", ao: float = 1.0) -> None:
    ring_b = np.asarray(ring_b, np.float64)
    nrm = newell(ring_b)
    if nrm[2] < 0:
        nrm = -nrm
    sc.quad(node, mat, ring_b, nrm, (lambda v: np.full(len(v), ao)) if ao != 1.0 else None)


def to_b(p: Plan, ring_enh) -> np.ndarray:
    r = np.asarray(ring_enh, np.float64)
    xy = p.frame.from_en(r[:, :2])
    return np.column_stack([xy, r[:, 2] - p.frame.z0])


def build_bakery(sc: Scene, p: Plan, bld: dict, lettering: bool = False) -> None:
    """The bakery's envelope + facade. `lettering` (on in the build, ADR 0044) adds the shop's own lettering."""
    fp = Polygon(p.footprint)
    sink = (bld["ground_z"] - p.frame.z0 - WALL_SINK) if bld["ground_z"] is not None else None
    cut = bakery_cutters(p)
    fac_doc = p.raw["site"].get("facade")
    fac = Facade(p, fac_doc, lettering) if fac_doc else None
    walls_b = [to_b(p, r) for r in bld["walls"]]
    roofs_b = [to_b(p, r) for r in bld["roofs"]]
    gable = None
    if fac_doc and (fac_doc.get("giebel") or {}).get("form") == "giebel":
        made = make_gable(walls_b, roofs_b)
        if made:
            walls_b, roofs_b, gable = made

    def street_plinth(node, p0, p1, lo, nh):
        street = nh[1] < -0.99 and abs(float(np.mean([p0[1], p1[1]]))) < 0.05      # L5 (and the L4 stub)
        gable_end = nh[0] < -0.99 and float(np.mean([p0[0], p1[0]])) < 0.2         # L6/L7 (SSW gable)
        if fac is None or not (street or gable_end):
            return False
        fac.plinth(sc, node, p0, p1, lo)
        return True

    walls = sc.node("fassade/aussenwand", "ext", source="plan", sigma=0.1)
    for ring in walls_b:
        lod2_wall(sc, walls, ring, fp, cut, sink, PLINTH_TOP, "fassade", street_plinth)
    roofs = sc.node("fassade/dach", "ext", source="plan", sigma=0.3)
    x_slate = float(fac_doc["dach_schiefer"]["x_to"]["v"]) if fac_doc and fac_doc.get("dach_schiefer") else None
    slate_parts = []
    for ring in roofs_b:
        nrm = newell(ring)
        nrm = nrm if nrm[2] >= 0 else -nrm
        if x_slate is not None and gable is not None and nrm[1] < -0.5 and abs(nrm[0]) < 0.3 and ring[:, 0].min() < x_slate:
            slate_parts.append(Polygon(ring[:, :2]).intersection(geom.rect(-50, -50, x_slate, 50)))
            rest = _clip_x_min(ring, x_slate)
            if len(rest):
                roof(sc, roofs, rest)
            continue
        roof(sc, roofs, ring)
    if gable is not None:
        front, back = gable_roof_regions(fp, gable)
        regions = [(back, gable.back)] + ([(gable.corner, gable.corner_plane)] if gable.corner is not None else [])
        for poly, plane in regions:
            for q in geom.polys(poly):
                ring = np.asarray(q.exterior.coords)[:-1]
                roof(sc, roofs, np.column_stack([ring, plane[0] + plane[1] * ring[:, 0] + plane[2] * ring[:, 1]]))
        slate_parts.append(front)
        if x_slate is not None:
            sl = sc.node("fassade/dach/schiefer", "ext", "fassade/dach", source="photo", sigma=0.3)
            slate_roof(sc, sl, union_all(slate_parts).buffer(0), gable.front)
    _windows(sc, p)
    _porch(sc, p)
    _steps(sc, p)
    if fac is not None:
        fac.build(sc, gable, porch_frame(p))


def _clip_x_min(ring: np.ndarray, x_min: float) -> np.ndarray:
    from .facade import _clip_x
    return _clip_x(np.asarray(ring, np.float64), x_min)


def _windows(sc: Scene, p: Plan) -> None:
    """Shop windows O1/O2: reveals through the 0.62 m facade, black frames, glass, granite sill outside."""
    n = sc.node("fassade/schaufenster", "ext", source="mesh", sigma=max(p.openings["O1"]["width"]["sigma_m"], p.openings["O2"]["width"]["sigma_m"]))
    yi = float(p.room["A"][1])           # inner face (W1)
    yg = 0.23 * p.f                      # glass plane (two glass lines at 0.20 / 0.26 in the plan sheet)
    for oid in ("O1", "O2"):
        o = p.openings[oid]
        x0, x1 = sorted([float(o["from"][0]), float(o["to"][0])])
        z0, z1 = o["sill"], o["head"]
        for ya, yb, mat in ((0.0, yg, "fassade"), (yg, yi, "fliese")):
            sc.hface(n, mat, geom.rect(x0, ya, x1, yb), z0, True)
            sc.hface(n, mat, geom.rect(x0, ya, x1, yb), z1, False)
            sc.vrect(n, mat, (x0, yb), (x0, ya), z0, z1, left=True)    # jamb at x0 faces +x
            sc.vrect(n, mat, (x1, ya), (x1, yb), z0, z1, left=True)    # jamb at x1 faces -x
        f = 0.05
        for (bx, by, bl, bd, bh, bz) in ((x0, yg - 0.03, f, 0.06, z1 - z0, z0), (x1 - f, yg - 0.03, f, 0.06, z1 - z0, z0),
                                         (x0, yg - 0.03, x1 - x0, 0.06, f, z0), (x0, yg - 0.03, x1 - x0, 0.06, f, z1 - f)):
            sc.box(n, "regal-weiss", (bx, by), 0, bl, bd, bh, bz, 0.004)        # white frames (Street View, video)
        sc.vrect(n, "glas", (x0 + f, yg), (x1 - f, yg), z0 + f, z1 - f, left=False)
        if not p.raw["site"].get("facade"):                     # round 3b: the plinth cap is the sill
            sc.box(n, "granit", (x0 - 0.04, -0.06), 0, x1 - x0 + 0.08, 0.06 + yg - 0.03, 0.06, z0 - 0.05, 0.008)


def _porch(sc: Scene, p: Plan) -> None:
    n = sc.node("fassade/vorbau", "ext", source="mesh", sigma=p.openings["O3"]["width"]["sigma_m"])
    pf = porch_frame(p)
    x0, x1, R = pf["x0"], pf["x1"], pf["reveal"]
    ceil, h5 = p.ceiling, pf["head5"]
    top = arch_top(p)
    C, D = p.room["C"], p.room["D"]
    yb = float(p.room["B"][1])
    bot = -1.2
    xs = np.linspace(x0, x1, 25)
    zs = top(np.column_stack([xs, np.zeros_like(xs)]))
    # arch soffit (faces down) and the arch's inner face at y = R (faces the porch, +y)
    for i in range(len(xs) - 1):
        q = np.array([[xs[i], 0, zs[i]], [xs[i + 1], 0, zs[i + 1]], [xs[i + 1], R, zs[i + 1]], [xs[i], R, zs[i]]])
        dx, dz = xs[i + 1] - xs[i], zs[i + 1] - zs[i]
        sc.quad(n, "fassade", q, np.array([dz, 0, -dx]))
    sc.vface(n, "fassade", (x0, R), (x1, R), Polygon(list(zip(xs - x0, zs)) + [(x1 - x0, ceil), (0.0, ceil)]), True)
    # porch ceiling + lintel of the side opening O5
    xo = lambda y: p.north_outer_x(y)  # noqa: E731
    sc.hface(n, "fassade", geom.rect(x0, R, x1, C[1]), ceil, False)
    sc.hface(n, "fassade", Polygon([(x1, pf["y5a"]), (xo(pf["y5a"]), pf["y5a"]), (xo(pf["y5b"]), pf["y5b"]), (x1, pf["y5b"])]), h5, False)
    sc.vrect(n, "fassade", (x1, pf["y5a"]), (x1, pf["y5b"]), h5, ceil, left=True)
    # left: pier reveal (y 0..B.y) and the plinth under the glazed side wall
    spring = porch_spring(p)
    sc.vface(n, "fassade", (x0, yb), (x0, 0.0),
             Polygon([(0, bot), (yb, bot), (yb, spring), (yb - R, spring), (yb - R, ceil), (0, ceil)]), True)
    sc.vrect(n, "sockel", (x0, C[1]), (x0, yb), bot, 0.0, left=True)
    # right: corner pillar (inner face, back face towards the side opening)
    sc.vface(n, "fassade", (x1, 0.0), (x1, pf["y5a"]),
             Polygon([(0, bot), (pf["y5a"], bot), (pf["y5a"], ceil), (R, ceil), (R, spring), (0, spring)]), True)
    sc.vrect(n, "fassade", (x1, pf["y5a"]), (xo(pf["y5a"]), pf["y5a"]), bot, h5, left=True)
    # back: north-wall section beside the glass front (faces the porch / the side opening)
    sc.vface(n, "fassade", (xo(C[1]), C[1]), (D[0], C[1]),
             Polygon([(0, bot), (xo(C[1]) - D[0], bot), (xo(C[1]) - D[0], ceil), (xo(C[1]) - x1, ceil), (xo(C[1]) - x1, h5), (0, h5)]), True)
    # plinth under the glass front (landing edge) is covered by the landing step


def step_height(p: Plan, y: float) -> float:
    """Floor height of the porch at frame-B y (5 risers from the street up to ±0.00, landing from landing_y)."""
    st = p.stairs
    k = int(st["risers"])
    street = -st["total_rise"]["v"]
    rise = -street / k
    if y >= st["landing_y"]:
        return 0.0
    i = int(math.floor(max(y, 0.0) / st["tread_v"]))
    return street + rise * (min(i, k - 1) + 1)


def _steps(sc: Scene, p: Plan) -> None:
    st = p.stairs
    n = sc.node("fassade/eingangsstufen", "ext", source="mesh", sigma=st["tread"]["sigma_m"])
    pf = porch_frame(p)
    x0, x1 = pf["x0"], pf["x1"]
    C = p.room["C"]
    k = int(st["risers"])
    edges = [st["tread_v"] * i for i in range(k)] + [float(C[1])]
    for i in range(k):
        ya, yb = edges[i], edges[i + 1]
        z = step_height(p, (ya + yb) / 2)
        for sa, sb, xe in ((ya, min(yb, pf["y5a"]), x1), (max(ya, pf["y5a"]), yb, p.north_outer_x(max(ya, pf["y5a"])))):
            if sb - sa < 0.005:
                continue
            sc.box(n, "granit", (x0, sa), 0, xe - x0, sb - sa, z + 1.2, -1.2, 0.008)


def build_passage(sc: Scene, p: Plan, ground_h: Callable[[np.ndarray], np.ndarray]) -> None:
    """Covered passage beside the shop, public up to the shop's side opening; then a plain end wall (privacy)."""
    n = sc.node("umgebung/durchgang", "ext", source="mesh", sigma=0.33)
    head = p.H(PASSAGE_HEAD)
    xw, xf, yp = p.north_outer_x(0.0), p.passage_far_x, p.passage_public_y
    y_front = _neighbour_front_y(p, xf)
    bot = float(np.min(ground_h(np.array([[xw, 0.0], [xf, yp]])))) - 0.6
    sc.vrect(n, "nachbar-1", (xf, y_front), (xf, yp), bot, head, left=True)           # far wall faces -x
    sc.hface(n, "fassade", Polygon([(xw, 0.0), (xf, y_front), (xf, yp), (p.north_outer_x(yp), yp)]), head, False)
    # end wall faces -y: a plain light wall in the passage's shade (darker at the floor), so it reads as a wall, not a hole
    shade = lambda v2: 0.58 + 0.2 * np.clip((v2[:, 1] - bot) / (head - bot), 0, 1)  # noqa: E731
    sc.vrect(n, "nachbar-2", (p.north_outer_x(yp), yp), (xf, yp), bot, head, left=False, ao=shade)
    # the bakery's own north wall face in the passage mouth is the LoD2 wall (with the side opening cut out)


def _neighbour_front_y(p: Plan, x: float) -> float:
    """Street face of the neighbour over the passage (LoD2 ring, frame B) at x."""
    nb = next(b for b in p.raw["site"]["neighbours"] if "Durchgang" in str(b.get("note_de") or ""))
    r = np.array(nb["ring"], np.float64)
    best = None
    for a, b in zip(r[:-1], r[1:]):
        if min(a[0], b[0]) - 1e-6 <= x <= max(a[0], b[0]) + 1e-6 and abs(b[0] - a[0]) > 1e-6 and max(a[1], b[1]) < 2.0:
            y = a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])
            best = y if best is None else min(best, y)
    return 0.0 if best is None else float(best)


def passage_neighbour_id(p: Plan) -> str:
    return next(b["id"] for b in p.raw["site"]["neighbours"] if "Durchgang" in str(b.get("note_de") or ""))


def build_neighbours(sc: Scene, p: Plan, blds: list[dict], skip: set[str]) -> None:
    walls = sc.node("umgebung/nachbarhaeuser", "ext", source="plan", sigma=0.3)
    pas = passage_neighbour_id(p)
    pcut = [passage_cutter(p)]
    for b in blds:
        if b["id"] in skip:
            continue
        fp = union_all([Polygon(p.frame.from_en(np.asarray(f, np.float64)[:, :2])) for f in b["footprint"]])
        sink = (b["ground_z"] - p.frame.z0 - WALL_SINK) if b["ground_z"] is not None else None
        mat = stable_pick(b["id"], ["nachbar-1", "nachbar-2", "nachbar-3"])
        for ring in b["walls"]:
            lod2_wall(sc, walls, to_b(p, ring), fp, pcut if b["id"] == pas else [], sink, None, mat)
        shade = 0.9 + 0.12 * (int(stable_pick(b["id"], list("0123456789"))) / 9)
        for ring in b["roofs"]:
            roof(sc, walls, to_b(p, ring), "dach", shade)
