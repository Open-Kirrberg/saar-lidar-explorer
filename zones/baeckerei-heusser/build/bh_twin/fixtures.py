"""Fixture blockouts (round 2): counter with granite ledge and display, bread shelf with sloped brass tiers, baskets
and price rails, grid shelf with paper bags, drinks fridge, news stand, two bistro tables, two pendant lamps.

Sizes and poses come from the Raumplan (`R1.fixtures`, scaled by plan.f); the shapes are stylised (style.md:
bevels, simplified silhouettes). Fixture frame: origin = `pose.xy`, x along `rot_deg`, y = +90°, z up. The customer
side of the counter and of the bread shelf is local −y (the plan's front note is ambiguous; the geometry decides:
the café tables, the door and the news stand all lie on −y of the counter, the shelf stands behind it at the wall).
Products are round 3.
"""
from __future__ import annotations

import math

import numpy as np
from shapely import affinity
from shapely.geometry import Point

from . import geom
from .plan import Fixture, Plan
from .scene import Scene, smooth

BEVEL = 0.012


def _floor_ao(vb: np.ndarray) -> np.ndarray:
    return 0.82 + 0.18 * smooth(0.0, 0.35, vb[:, 2])


def to_b_poly(fx: Fixture, poly_local):
    ux, uy = fx.ux, fx.uy
    return affinity.affine_transform(poly_local, [ux[0], uy[0], ux[1], uy[1], fx.xy[0], fx.xy[1]])


def to_b_pts(fx: Fixture, pl: np.ndarray, z0: float = 0.0) -> np.ndarray:
    pl = np.asarray(pl, np.float64)
    xy = fx.xy + pl[:, :1] * fx.ux + pl[:, 1:2] * fx.uy
    return np.column_stack([xy, pl[:, 2] + z0])


def fbox(sc: Scene, n, mat: str, fx: Fixture, x, y, z, l, d, h, bevel=BEVEL, tilt_deg: float = 0.0, ao=_floor_ao) -> None:
    """Box [x, x+l]×[y, y+d]×[z, z+h] in the fixture frame, optionally tilted about its front-bottom edge (x axis)."""
    pts = geom.chamfer_box_local(l, d, h, bevel)
    if tilt_deg:
        a = math.radians(tilt_deg)
        yy, zz = pts[:, 1].copy(), pts[:, 2].copy()
        pts = np.column_stack([pts[:, 0], yy * math.cos(a) - zz * math.sin(a), yy * math.sin(a) + zz * math.cos(a)])
    pts = pts + np.array([x, y, z])
    sc.convex(n, mat, to_b_pts(fx, pts), ao)


def fquad(sc: Scene, n, mat: str, fx: Fixture, pl: np.ndarray, normal_local) -> None:
    nl = np.asarray(normal_local, np.float64)
    nb = np.array([nl[0] * fx.ux[0] + nl[1] * fx.uy[0], nl[0] * fx.ux[1] + nl[1] * fx.uy[1], nl[2]])
    sc.quad(n, mat, to_b_pts(fx, pl), nb)


# ----------------------------------------------------------------------------------------------- counter (F1)

def theke(sc: Scene, p: Plan) -> None:
    fx = p.fixtures["F1"]
    l, d, h = fx.l, fx.d, fx.h
    f = p.f
    r = d / 2
    base_h = f * 0.62
    top_h = f * 0.65
    body = geom.rect(r, 0, l, d).union(Point(r, r).buffer(r, 12))
    sig = fx.sigma
    n = sc.node("theke/sockel", "int", source="mesh", sigma=sig)
    kick = to_b_poly(fx, body.buffer(-0.05, join_style="mitre"))
    sc.prism(n, "lack-schwarz", kick, 0.0, 0.08, top=False, ao=_floor_ao)
    sc.prism(n, "heusser-rot", to_b_poly(fx, body), 0.08, base_h, top=False, ao=_floor_ao)
    n = sc.node("theke/granitablage", "int", source="mesh", sigma=sig)
    ledge = body.union(geom.rect(r, -0.04, l, d / 2)).buffer(0.02, join_style="mitre")
    sc.prism(n, "granit", to_b_poly(fx, ledge), base_h, top_h, bottom=True)
    # display: slanted front glass on the customer side, flat top glass, end panes, two glass shelves, black frame
    n = sc.node("theke/vitrine", "int", source="photo", sigma=sig)
    slots = {s["id"]: s for s in fx.raw.get("slots", [])}
    sl = f * float(slots.get("vitrine-unten", {}).get("l", l - 0.3))
    x0, x1 = l - sl, l - 0.02
    yf0, yf1, yb = 0.06, 0.40 * f, d - 0.22 * f      # front glass foot / top edge, top glass back edge
    zt = h
    front = np.array([[x0, yf0, top_h], [x1, yf0, top_h], [x1, yf1, zt], [x0, yf1, zt]])
    a = math.atan2(zt - top_h, yf1 - yf0)
    fquad(sc, n, "glas", fx, front, [0, -math.sin(a), math.cos(a)])
    fquad(sc, n, "glas", fx, np.array([[x0, yf1, zt], [x1, yf1, zt], [x1, yb, zt], [x0, yb, zt]]), [0, 0, 1])
    for xe, s in ((x0, -1), (x1, 1)):
        fquad(sc, n, "glas", fx, np.array([[xe, yf0, top_h], [xe, yb, top_h], [xe, yb, zt], [xe, yf1, zt]]), [s, 0, 0])
    for sid in ("vitrine-unten", "vitrine-oben"):
        s = slots.get(sid)
        if not s:
            continue
        zs = f * float(s["z"])
        t = (zs - top_h) / (zt - top_h)
        yfs = yf0 + t * (yf1 - yf0) + 0.02
        fquad(sc, n, "glas", fx, np.array([[x0 + 0.01, yfs, zs], [x1 - 0.01, yfs, zs], [x1 - 0.01, yb, zs], [x0 + 0.01, yb, zs]]), [0, 0, 1])
    bar = 0.025
    fbox(sc, n, "lack-schwarz", fx, x0, yf0 - bar / 2, top_h, x1 - x0, bar, bar, 0.004)           # foot rail
    fbox(sc, n, "lack-schwarz", fx, x0, yf1 - bar / 2, zt - bar, x1 - x0, bar, bar, 0.004)        # front top edge
    fbox(sc, n, "lack-schwarz", fx, x0, yb - bar, zt - bar, x1 - x0, bar, bar, 0.004)             # back top edge
    for xe in (x0, x1 - bar):
        fbox(sc, n, "lack-schwarz", fx, xe, yb - bar, top_h, bar, bar, zt - top_h, 0.004)          # back posts
        L = math.hypot(yf1 - yf0, zt - top_h)
        fbox(sc, n, "lack-schwarz", fx, xe, yf0 - bar / 2, top_h, bar, bar, L, 0.004, tilt_deg=-math.degrees(math.pi / 2 - a))


# ----------------------------------------------------------------------------------------------- bread shelf (F2)

def brotregal(sc: Scene, p: Plan) -> None:
    fx = p.fixtures["F2"]
    l, d, h = fx.l, fx.d, fx.h
    f = p.f
    n = sc.node("brotregal/korpus", "int", source="mesh", sigma=fx.sigma)
    post = 0.035
    fbox(sc, n, "holz", fx, 0, d - 0.025, 0, l, 0.025, h, 0.008)                                 # back panel
    for xp in (0.0, l / 2 - post / 2, l - post):
        fbox(sc, n, "messing", fx, xp, d - 0.06, 0, post, 0.035, h, 0.006)                         # posts
    fbox(sc, n, "holz", fx, 0, 0.02, 0, l, d - 0.045, f * 0.12, 0.01)                             # plinth
    slots = [s for s in fx.raw.get("slots", []) if s["id"].startswith("ebene-")]
    rails = sc.node("brotregal/preisschienen", "int", source="photo", sigma=fx.sigma)
    baskets = sc.node("brotregal/koerbe", "int", source="photo", sigma=fx.sigma)
    for s in slots:
        zc = f * float(s["z"])
        sd = f * float(s.get("d", 0.4))
        tilt = float(s.get("neigung_deg", 25))
        a = math.radians(tilt)
        yf = d - 0.05 - sd * math.cos(a)
        zf = zc - 0.5 * sd * math.sin(a)
        # tier: five brass rods running the full length, rising to the back
        for k in range(5):
            t = (k + 0.5) / 5
            fbox(sc, n, "messing", fx, 0.02, yf + t * sd * math.cos(a) - 0.008, zf + t * sd * math.sin(a), l - 0.04, 0.016, 0.016, 0.003)
        for xb in (0.02, l / 2 - 0.01, l - 0.04):                                                   # brackets
            fbox(sc, n, "messing", fx, xb, yf, zf - 0.02, 0.02, sd, 0.02, 0.003, tilt_deg=tilt)
        fbox(sc, rails, "lack-schwarz", fx, 0.02, yf - 0.012, zf - 0.035, l - 0.04, 0.012, 0.04, 0.003)
        if s["id"] == "ebene-0":
            nb = 6
            gap = 0.04
            bw = (l - 0.06 - gap * (nb - 1)) / nb
            for k in range(nb):
                xk = 0.03 + k * (bw + gap)
                fbox(sc, baskets, "korb", fx, xk, yf + 0.02, zf + 0.012, bw, sd * math.cos(a) - 0.04, 0.10, 0.02, tilt_deg=tilt)
                fbox(sc, baskets, "tuch-rosa", fx, xk + 0.03, yf + 0.05, zf + 0.10, bw - 0.06, sd * math.cos(a) - 0.10, 0.02, 0.008, tilt_deg=tilt)


# ----------------------------------------------------------------------------------------------- grid shelf (F3)

def gitterregal(sc: Scene, p: Plan) -> None:
    fx = p.fixtures["F3"]
    l, d, h = fx.l, fx.d, fx.h
    f = p.f
    n = sc.node("gitterregal/korpus", "int", source="photo", sigma=fx.sigma)
    w = 0.02
    for xp in (0.0, l - w):
        for yp in (0.0, d - w):
            fbox(sc, n, "lack-schwarz", fx, xp, yp, 0, w, w, h, 0.004)
    shelves = [f * z for z in (0.25, 0.65, 1.05, 1.45)]
    bags = sc.node("gitterregal/brottueten", "int", source="photo", sigma=fx.sigma)
    for zs in shelves:
        for yk in np.linspace(0.02, d - 0.03, 5):
            fbox(sc, n, "lack-schwarz", fx, 0.0, float(yk), zs, l, 0.01, 0.01, 0.0)                # wires
        fbox(sc, n, "lack-schwarz", fx, 0.0, 0.0, zs - 0.02, l, w, 0.03, 0.004)                    # front rail
        for k, xk in enumerate((0.05, 0.05 + (l - 0.1) / 2)):
            hk = 0.08 + 0.03 * ((k + int(zs * 10)) % 3)
            fbox(sc, bags, "korb", fx, xk, 0.05, zs + 0.01, (l - 0.14) / 2, d - 0.1, hk, 0.006)
    for zb in (f * 0.6, f * 1.2):                                                                   # back grid bars
        fbox(sc, n, "lack-schwarz", fx, 0.0, d - w, zb, l, w, 0.012, 0.0)


# ----------------------------------------------------------------------------------------------- fridge (F7)

def kuehlschrank(sc: Scene, p: Plan) -> None:
    fx = p.fixtures["F7"]
    l, d, h = fx.l, fx.d, fx.h
    n = sc.node("getraenkekuehlschrank/korpus", "int", source="mesh", sigma=fx.sigma)
    t = 0.04
    # front faces local −y (into the café); shell: sides, top, bottom, back
    fbox(sc, n, "lack-schwarz", fx, 0, 0, 0, l, d, 0.10, 0.008)
    fbox(sc, n, "lack-schwarz", fx, 0, 0, h - 0.14, l, d, 0.14, 0.008)
    for xs in (0.0, l / 2 - t / 2, l - t):
        fbox(sc, n, "lack-schwarz", fx, xs, 0, 0.10, t, d, h - 0.24, 0.006)
    fbox(sc, n, "decke", fx, 0, d - 0.02, 0.10, l, 0.02, h - 0.24, 0.0)
    for zs in np.linspace(0.45, h - 0.4, 4):
        fbox(sc, n, "decke-raster", fx, t, 0.06, float(zs), l - 2 * t, d - 0.09, 0.012, 0.0)
    for xa, xb in ((t, l / 2 - t / 2), (l / 2 + t / 2, l - t)):
        fquad(sc, n, "glas", fx, np.array([[xa, 0.01, 0.10], [xb, 0.01, 0.10], [xb, 0.01, h - 0.14], [xa, 0.01, h - 0.14]]), [0, -1, 0])
        fbox(sc, n, "messing", fx, xb - 0.05, -0.02, 0.8, 0.02, 0.02, 0.45, 0.004)


# ----------------------------------------------------------------------------------------------- news stand (F4)

def zeitungsaufsteller(sc: Scene, p: Plan) -> None:
    fx = p.fixtures["F4"]
    l, d, h = fx.l, fx.d, fx.h
    n = sc.node("zeitungsaufsteller/korpus", "int", source="photo", sigma=fx.sigma)
    fbox(sc, n, "lack-schwarz", fx, 0, 0, 0, l, d, 0.04, 0.006)
    for xp in (0.0, l - 0.03):
        fbox(sc, n, "lack-schwarz", fx, xp, d / 2 - 0.015, 0, 0.03, 0.03, h, 0.004)
    fbox(sc, n, "lack-schwarz", fx, 0, d / 2 - 0.02, h * 0.45, l, 0.04, h * 0.55, 0.008)
    fbox(sc, n, "fliese", fx, 0.03, d / 2 - 0.03, h * 0.45 + 0.03, l - 0.06, 0.012, h * 0.55 - 0.06, 0.0)


# ----------------------------------------------------------------------------------------------- tables, lamps

def bistrotisch(sc: Scene, p: Plan, fid: str, cid: str) -> None:
    fx = p.fixtures[fid]
    r = fx.l / 2
    h = fx.h
    n = sc.node(f"{cid}/korpus", "int", source="mesh", sigma=fx.sigma)
    c = fx.xy
    sc.cylinder(n, "lack-schwarz", c, 0.22 * p.f, 0.0, 0.03, 20, 0.20 * p.f)
    sc.cylinder(n, "lack-schwarz", c, 0.03, 0.03, h - 0.03, 10)
    sc.cylinder(n, "holz", c, r, h - 0.03, h, 28)


def haengelampe(sc: Scene, p: Plan, fid: str, cid: str, mount_z: float) -> None:
    fx = p.fixtures[fid]
    r = fx.l / 2
    bottom = p.H(1.62)
    n = sc.node(f"{cid}/leuchte", "int", source="photo", sigma=fx.sigma)
    c = fx.xy
    sc.cylinder(n, "lack-schwarz", c, 0.045, mount_z - 0.02, mount_z, 12)                         # canopy
    sc.cylinder(n, "lack-schwarz", c, 0.004, bottom + 0.22, mount_z - 0.02, 6)                     # cord
    sc.cylinder(n, "lack-schwarz", c, r, bottom, bottom + 0.22, 20, 0.045)                         # shade
    sc.cylinder(n, "lampe", c, r - 0.012, bottom - 0.002, bottom + 0.004, 20)                      # glowing diffuser


def lamp_mount(p: Plan, soffit_poly, soffit_z: float) -> dict[str, float]:
    out = {}
    for fid in ("F8", "F9"):
        out[fid] = soffit_z if soffit_poly.contains(Point(p.fixtures[fid].xy)) else p.ceiling
    return out


def build(sc: Scene, p: Plan, soffit_poly, soffit_z: float) -> None:
    theke(sc, p)
    brotregal(sc, p)
    gitterregal(sc, p)
    kuehlschrank(sc, p)
    zeitungsaufsteller(sc, p)
    bistrotisch(sc, p, "F5", "bistrotisch-1")
    bistrotisch(sc, p, "F6", "bistrotisch-2")
    m = lamp_mount(p, soffit_poly, soffit_z)
    haengelampe(sc, p, "F8", "haengelampe-1", m["F8"])
    haengelampe(sc, p, "F9", "haengelampe-2", m["F9"])


# fixtures that block the walkable floor (frame-B footprints): id -> polygon
def obstacles(p: Plan, margin: float = 0.15) -> list:
    out = []
    for fid in ("F1", "F2", "F3", "F4", "F7"):
        fx = p.fixtures[fid]
        out.append(to_b_poly(fx, geom.rect(0, 0, fx.l, fx.d)).buffer(margin, join_style="mitre"))
    for fid in ("F5", "F6"):
        fx = p.fixtures[fid]
        out.append(Point(fx.xy).buffer(fx.l / 2 + margin, 16))
    return out
