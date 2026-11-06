"""Exterior pieces of wave A (2026-11-06, ADR 0047): the Backstube entrance (recessed niche with terrazzo steps at the
SSW end of the street facade, closed door), the pickup cabinet (Abholschrank, plan site fixture X1) in the public part
of the covered passage, and the passage paving (herringbone) with its plinth band.

Frame B, survey values (the facade is anchored to the LoD2 walls, not scaled). Sources: the plan's
`site.facade.backstube_eingang`, `site.facade.durchgang` and `site.fixtures` (X1). Exterior only: the niche ends at a
closed door and nothing behind it is modelled; the passage ends at the privacy line (`Plan.passage_public_y`).
Pure helpers (`niche`, `niche_treads`, `niche_nav_polys`, `herringbone`, `cabinet`) are unit-tested.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable

import numpy as np
from shapely import affinity
from shapely.geometry import Point, Polygon, box as sbox

from . import geom
from .facade import WallFrame, basket_weave, v
from .scene import Scene

NICHE_BOTTOM = -1.4        # niche walls and step blocks reach this far down (below the street)
GLASS_MATS = ("glasbaustein", "glasbaustein-hell", "glasbaustein-gruen", "glasbaustein-blau")


# ----------------------------------------------------------------------------------------------- Backstube entrance

@dataclass
class Niche:
    x0: float              # left side wall (render, rounded street edge)
    x1: float              # right side wall (slip cheek + glass blocks)
    depth: float           # back wall (door) at y = depth
    head: float            # soffit
    street: float          # foot of the first riser (−total rise)
    risers: int
    tread: float
    landing_z: float
    r_left: float          # rounded street edge of the left wall
    string_b: float        # sandstone string along the stair on the left wall: width / height above the pitch
    string_h: float
    cap_top: float         # cheek cap (right wall) top, projection
    cap_proj: float
    post_b: float          # metal corner post at the glass-block corner
    door_w: float
    door_h: float
    door_frame: float
    door_bars: int
    door_kick: float
    rail_h: float
    rail_d: float
    rail_y_top: float
    sigma: float


def niche(fac: dict | None) -> Niche | None:
    """The plan's `backstube_eingang` block as numbers (None for older plans). Pure."""
    b = (fac or {}).get("backstube_eingang")
    if not b:
        return None
    t = b["tuer"]
    return Niche(x0=v(b["x0"]), x1=v(b["x1"]), depth=v(b["depth"]), head=v(b["head"]), street=-v(b["total_rise"]),
                 risers=int(b["risers"]), tread=v(b["tread"]), landing_z=v(b["landing_z"]), r_left=v(b["kante_links_r"]),
                 string_b=v(b["wange_links"]["b"]), string_h=v(b["wange_links"]["h"]),
                 cap_top=v(b["wange_rechts"]["cap_top"]), cap_proj=v(b["wange_rechts"]["cap_proj"]),
                 post_b=v(b["eckpfosten"]["b"]), door_w=v(t["w"]), door_h=v(t["h"]), door_frame=v(t["rahmen"]),
                 door_bars=int(t["staebe"]), door_kick=v(t["tritt"]), rail_h=v(b["handlauf"]["h"]),
                 rail_d=v(b["handlauf"]["d"]), rail_y_top=v(b["handlauf"]["y_top"]),
                 sigma=max(b["x0"]["sigma_m"], b["depth"]["sigma_m"]))


def niche_treads(n: Niche) -> list[tuple[float, float, float]]:
    """(y0, y1, top z) of every tread from the street inwards, the landing last (up to the door). Pure."""
    rise = (n.landing_z - n.street) / n.risers
    out = [(i * n.tread, (i + 1) * n.tread, n.street + rise * (i + 1)) for i in range(n.risers - 1)]
    out.append(((n.risers - 1) * n.tread, n.depth, n.landing_z))
    return out


def niche_pitch(n: Niche) -> Callable[[float], float]:
    """Stair pitch line through the nosings (y -> z). Pure."""
    rise = (n.landing_z - n.street) / n.risers
    return lambda y: n.street + rise * (y / n.tread + 1.0)


def niche_cutter_box(n: Niche) -> tuple[float, float, float, float, float, float]:
    """(x0, x1, y0, y1, z0, z1) hole in the street wall: the niche plus the rounded left edge."""
    return (n.x0 - n.r_left, n.x1, -0.3, 0.3, -5.0, n.head)


def niche_nav_polys(n: Niche) -> list[tuple[Polygon, float]]:
    """Walkable treads (frame B polygon, height above ±0.00): between the left string and the right cheek cap, up to
    5 cm before the closed door. Pure."""
    xa, xb = n.x0 + n.string_b, n.x1 - n.cap_proj
    out = []
    for y0, y1, z in niche_treads(n):
        out.append((sbox(xa, y0, xb, min(y1, n.depth - 0.05)), z))
    return out


def build_backstube_entrance(sc: Scene, fac: dict, sigma_default: float = 0.25) -> Niche | None:
    nb = niche(fac)
    if nb is None:
        return None
    n = sc.node("fassade/backstube-eingang", "ext", source="photo", sigma=nb.sigma)
    sc.styled.add(n.name)
    x0, x1, D, head, bot = nb.x0, nb.x1, nb.depth, nb.head, NICHE_BOTTOM
    r = nb.r_left
    # steps: terrazzo blocks down below the street
    for y0, y1, z in niche_treads(nb):
        sc.box(n, "terrazzo", (x0, y0), 0, x1 - x0, y1 - y0, z - bot, bot, 0.008)
    # left wall (faces +x) and its rounded street edge
    sc.vrect(n, "fassade", (x0, D), (x0, r), bot, head, left=True)
    c = np.array([x0 - r, r])
    arc = geom.arc_points(c, r, -math.pi / 2, 0.0, 5)
    for a, b in zip(arc[:-1], arc[1:]):
        mid = (a + b) / 2 - c
        q = np.array([[a[0], a[1], bot], [b[0], b[1], bot], [b[0], b[1], head], [a[0], a[1], head]])
        sc.quad(n, "fassade", q, np.array([mid[0], mid[1], 0.0]))
    # soffit (niche + the corner wedge outside the rounding)
    wedge = sbox(x0 - r, 0.0, x0, r).difference(Point(c).buffer(r, 16))
    sc.hface(n, "fassade", sbox(x0, 0.0, x1, D).union(wedge).buffer(0), head, False)
    sc.hface(n, "terrazzo", wedge, nb.street + (niche_treads(nb)[0][2] - nb.street) * 0.5, True)   # floor of the rounding
    # back wall (faces −y) with the door hole on the right
    fw, dw = nb.door_frame, nb.door_w
    xd0 = x1 - dw - 2 * fw
    back = sbox(0.0, nb.landing_z, x1 - x0, head).difference(sbox(-0.01, nb.landing_z - 0.01, x1 - xd0, nb.landing_z + nb.door_h + fw))
    sc.vface(n, "fassade", (x1, D), (x0, D), back, True)
    # right wall (faces −x): slip cheek with cap, glass blocks above
    cap_h = 0.08
    sc.vrect(n, "sockel", (x1, 0.0), (x1, D), bot, nb.cap_top - cap_h, left=True)
    sc.box(n, "abdeckplatte", (x1 - nb.cap_proj, 0.0), 0, nb.cap_proj + 0.002, D, cap_h, nb.cap_top - cap_h, 0.006)
    _niche_string(sc, n, nb)
    _niche_glass(sc, nb)
    _niche_door(sc, nb, xd0)
    _niche_rail(sc, nb)
    return nb


def _niche_string(sc: Scene, n, nb: Niche) -> None:
    """Sandstone string along the stair on the left wall: stepped foot on the treads, top parallel to the pitch."""
    wf = WallFrame.of_line((nb.x0, 0.0), (nb.x0, nb.depth))           # s = y, outward = +x (into the niche)
    pitch = niche_pitch(nb)
    y_land = (nb.risers - 1) * nb.tread
    pts = []
    for y0, y1, z in niche_treads(nb):
        pts += [(max(y0, nb.r_left), z), (y1, z)]
    pts += [(nb.depth, nb.landing_z + nb.string_h), (y_land, nb.landing_z + nb.string_h),
            (nb.r_left, pitch(nb.r_left) + nb.string_h)]
    wf.relief(sc, n, "sandstein-rot", Polygon(pts).buffer(0), 0.0, nb.string_b)


def _niche_glass(sc: Scene, nb: Niche) -> None:
    """Glass blocks on the right wall above the cheek cap (the facade's panel turns the corner), light corner post."""
    g = sc.node("fassade/backstube-eingang/glasbausteine", "ext", "fassade/backstube-eingang", source="photo", sigma=0.25)
    wf = WallFrame.of_line((nb.x1, nb.depth), (nb.x1, 0.0))           # s from the back wall, outward = −x
    s0, s1, z0, z1 = 0.0, nb.depth - nb.post_b + 0.02, nb.cap_top, nb.head
    wf.face(sc, g, "glas-fuge", sbox(s0, z0, s1, z1), 0.0)
    e0, e1, ins = 0.0, 0.028, 0.012
    for (a, b, c, d), kind in basket_weave(s0, z0, s1, z1, 0.25, 0.014, "backstube-glas"):
        pts = np.array([[a, e0, b], [c, e0, b], [c, e0, d], [a, e0, d],
                        [a + ins, e1, b + ins], [c - ins, e1, b + ins], [c - ins, e1, d - ins], [a + ins, e1, d - ins]])
        V, T = geom.convex_solid(pts)
        wf.put(sc, g, GLASS_MATS[kind], V, T, "sez")
    sc.box(g, "edelstahl", (nb.x1 - nb.post_b / 2, -0.02), 0, nb.post_b, nb.post_b, nb.head - nb.cap_top, nb.cap_top, 0.006)


def _niche_door(sc: Scene, nb: Niche, xd0: float) -> None:
    """Closed aluminium door: frame, leaf with kick plate, ribbed glass and vertical bars, lever handle on the right."""
    t = sc.node("fassade/backstube-eingang/tuer", "ext", "fassade/backstube-eingang", source="photo", sigma=0.15)
    D, fw, z0 = nb.depth, nb.door_frame, nb.landing_z
    x1, dw, dh = nb.x1, nb.door_w, nb.door_h
    yb = D - 0.07
    for bx, bl, bz, bh in ((xd0, fw, z0, dh + fw), (x1 - fw, fw, z0, dh + fw), (xd0, x1 - xd0, z0 + dh, fw)):
        sc.box(t, "alu", (bx, yb), 0, bl, 0.07, bh, bz, 0.004)
    lx0, lx1 = xd0 + fw, x1 - fw
    yl = D - 0.05
    sc.box(t, "alu", (lx0, yl), 0, lx1 - lx0, 0.05, dh, z0, 0.004)                  # leaf
    m = 0.09
    gx0, gx1, gz0, gz1 = lx0 + m, lx1 - m, z0 + nb.door_kick + 0.06, z0 + dh - m
    sc.vrect(t, "riffelglas", (gx1, yl - 0.001), (gx0, yl - 0.001), gz0, gz1, left=True)
    k = max(2, int((gx1 - gx0) / 0.03))
    for i in range(0, k, 2):                                                       # ribs of the figured glass
        a = gx0 + (gx1 - gx0) * i / k
        sc.vrect(t, "rollladen-fuge", (a + (gx1 - gx0) / k, yl - 0.002), (a, yl - 0.002), gz0, gz1, left=True)
    sc.box(t, "alu", (lx0 + 0.01, yl - 0.004), 0, lx1 - lx0 - 0.02, 0.004, nb.door_kick, z0 + 0.01, 0.0)  # kick plate
    for i in range(nb.door_bars):                                                  # bars in front of the glass
        bx = gx0 + (gx1 - gx0) * (i + 1) / (nb.door_bars + 1)
        V, T = geom.rod((bx, yl - 0.03, gz0 - 0.02), (bx, yl - 0.03, gz1 + 0.02), 0.009, 6)
        t.add_mesh("alu", sc.F.zone(V), T)
    hx, hz = lx1 - 0.07, z0 + 1.05
    for p_, q_ in (((hx, yl, hz), (hx, yl - 0.06, hz)), ((hx, yl - 0.06, hz), (hx - 0.13, yl - 0.06, hz))):
        V, T = geom.rod(p_, q_, 0.011, 6)
        t.add_mesh("lack-schwarz", sc.F.zone(V), T)


def _niche_rail(sc: Scene, nb: Niche) -> None:
    """Black round-bar rail over the right cheek: short post onto the cap, along the pitch, level to the door frame."""
    h = sc.node("fassade/backstube-eingang/handlauf", "ext", "fassade/backstube-eingang", source="photo", sigma=0.15)
    x = nb.x1 - nb.cap_proj / 2 - 0.01
    pitch = niche_pitch(nb)
    y0, y_land = 0.10, (nb.risers - 1) * nb.tread
    pts = [(x, y0, nb.cap_top), (x, y0, pitch(y0) + nb.rail_h), (x, y_land, nb.landing_z + nb.rail_h),
           (x, nb.rail_y_top, nb.landing_z + nb.rail_h), (x, nb.depth - 0.07, nb.landing_z + nb.rail_h)]
    for p_, q_ in zip(pts[:-1], pts[1:]):
        V, T = geom.rod(p_, q_, nb.rail_d / 2, 8)
        h.add_mesh("lack-schwarz", sc.F.zone(V), T)


# ----------------------------------------------------------------------------------------------- pickup cabinet

@dataclass
class Cabinet:
    front_x: float        # door face (frame B x), the doors look along +x into the passage
    y0: float             # street-side edge
    w: float              # along +y
    d: float              # towards the shop wall (−x)
    h: float              # from the passage floor
    sigma: float


def cabinet(raw: dict) -> Cabinet | None:
    """Plan site fixture X1 (public since ADR 0047) as numbers; None if absent or without a pose. Pure."""
    fx = next((f for f in (raw.get("site", {}).get("fixtures") or []) if f.get("id") == "X1"), None)
    if not fx or not fx.get("pose"):
        return None
    if abs(float(fx["pose"].get("rot_deg", 90.0)) - 90.0) > 1e-6:
        raise ValueError("X1: only rot 90° (doors towards +x) is supported")
    (x, y), s = fx["pose"]["xy"], fx["size"]
    return Cabinet(float(x), float(y), float(s["l"]), float(s["d"]), float(s["h"]), float(fx["sigma_m"]))


def cabinet_footprint(c: Cabinet) -> Polygon:
    return sbox(c.front_x - c.d, c.y0, c.front_x, c.y0 + c.w)


FEET = 0.04
BAND = (0.80, 0.88)       # black handle band, above the passage floor (photo, ±0.08)


def build_cabinet(sc: Scene, c: Cabinet, ground_h: Callable[[np.ndarray], np.ndarray], lettering: bool = True) -> float:
    """The grey louvred utility cabinet: body on four feet, 2 × 2 doors with louvre ribs and light frames, black
    handle band, one salmon sign „Abholstation“ (nothing else of the paper sheet). Returns its floor height."""
    fp = cabinet_footprint(c)
    corners = np.asarray(fp.exterior.coords)[:-1]
    g = ground_h(np.vstack([corners, [[c.front_x - c.d / 2, c.y0 + c.w / 2]]]))
    floor, zb = float(g[-1]), float(g.min())
    top = floor + c.h
    k = sc.node("fassade/abholschrank/korpus", "ext", "fassade/abholschrank", source="mesh", sigma=c.sigma)
    sc.styled.add(k.name)
    x0 = c.front_x - c.d
    sc.box(k, "abholschrank", (x0, c.y0), 0, c.d - 0.02, c.w, top - (zb + FEET), zb + FEET, 0.012)
    sc.box(k, "abholschrank-rahmen", (x0 - 0.005, c.y0 - 0.01), 0, c.d + 0.005, c.w + 0.02, 0.025, top - 0.01, 0.006)  # lid lip
    for fx_, fy_ in ((x0 + 0.03, c.y0 + 0.03), (x0 + 0.03, c.y0 + c.w - 0.07), (c.front_x - 0.07, c.y0 + 0.03),
                     (c.front_x - 0.07, c.y0 + c.w - 0.07)):
        sc.box(k, "lack-schwarz", (fx_, fy_), 0, 0.04, 0.04, FEET + (floor - zb) + 0.02, zb - 0.02, 0.0)
    # doors on the front (faces +x): wall frame on the door plane, s = y − y0 (viewer's right), outward = +x
    wf = WallFrame.of_line((c.front_x - 0.02, c.y0), (c.front_x - 0.02, c.y0 + c.w))
    t = sc.node("fassade/abholschrank/tueren", "ext", "fassade/abholschrank", source="photo", sigma=c.sigma)
    gap, half = 0.012, c.w / 2
    b0, b1 = floor + BAND[0], floor + BAND[1]
    rows = ((zb + FEET + 0.03, b0 - 0.01), (b1 + 0.01, top - 0.04))
    for s0, s1 in ((0.02, half - gap / 2), (half + gap / 2, c.w - 0.02)):
        for za, zz in rows:
            wf.block(sc, t, "abholschrank-rahmen", s0, s1, za, zz, 0.0, 0.018, 0.008)            # door with frame
            ia, ib, ja, jb = s0 + 0.045, s1 - 0.045, za + 0.05, zz - 0.05
            wf.face(sc, t, "abholschrank", sbox(ia, ja, ib, jb), 0.0185)                       # louvre field
            z = ja + 0.035
            while z < jb - 0.01:                                                                # louvre ribs
                wf.face(sc, t, "abholschrank-fuge", sbox(ia, z, ib, z + 0.012), 0.0195)
                z += 0.045
    bnd = sc.node("fassade/abholschrank/band", "ext", "fassade/abholschrank", source="photo", sigma=0.08)
    wf.block(sc, bnd, "lack-schwarz", 0.0, c.w, b0, b1, 0.0, 0.03, 0.006)
    # the sign: a plain salmon sheet (A4 portrait) on the upper left door, heading „Abholstation“ only
    sg = sc.node("fassade/abholschrank/schild", "ext", "fassade/abholschrank", source="photo", sigma=0.1)
    sa, sz0 = 0.09, floor + 1.18
    wf.block(sc, sg, "schild-lachs", sa, sa + 0.21, sz0, sz0 + 0.297, 0.018, 0.022, 0.0)
    if lettering:
        from .lettering import text_polys
        txt = text_polys("Abholstation", 0.022)
        txt = affinity.translate(txt, sa + 0.105, sz0 + 0.297 - 0.06)
        wf.face(sc, sg, "schrift", txt, 0.0225)
    return floor


# ----------------------------------------------------------------------------------------------- passage paving

def herringbone(poly: Polygon, L: float = 0.20, W: float = 0.10, joint: float = 0.006, origin=(0.0, 0.0)
                ) -> list[tuple[Polygon, int]]:
    """Herringbone bond (L = 2 W) clipped to `poly`: (paver, tone 0/1), pavers shrunk by joint/2 per side. Lattice:
    a horizontal paver at (ox, oy) and a vertical one at (ox, oy + W) per cell, ox = (i + 2j) W, oy = (i − 2j) W.
    Tone from a fixed hash of the cell, so the pattern is deterministic. Pure."""
    if abs(L - 2 * W) > 1e-9:
        raise ValueError("herringbone needs L = 2 W")
    x0, y0, x1, y1 = poly.bounds
    ox0, oy0 = origin
    h = joint / 2
    out = []
    span = int(math.ceil(max(x1 - x0, y1 - y0) / W)) + 6
    for i in range(-span - 2, span + 3):
        for j in range(-span // 2 - 2, span // 2 + 3):
            ox, oy = ox0 + (i + 2 * j) * W, oy0 + (i - 2 * j) * W
            if ox > x1 + L or ox < x0 - 2 * L or oy > y1 + L or oy < y0 - 2 * L:
                continue
            for k, (a, b, c_, d) in enumerate(((ox, oy, ox + L, oy + W), (ox, oy + W, ox + W, oy + W + L))):
                q = sbox(a + h, b + h, c_ - h, d - h)
                if not q.intersects(poly):
                    continue
                q = q.intersection(poly)
                if q.area < 1e-5:
                    continue
                tone = (i * 7 + j * 13 + k * 5) % 5 < 2
                for part in geom.polys(q):
                    out.append((part, int(tone)))
    return out
