"""Verkaufsraum fixtures (round 3): stylised models at plan size, true to the walkthrough video.

Counter (white base, pink-grey granite ledge, red band, two display modules with curved front glass, chilled deck,
glass shelf, glass top, staff-side work top over open compartments, till, pretzel stand, cake cover, blank table
cards), bread shelf (3 bays, 3 sloped champagne rod tiers, basket level with 6 wicker baskets and raspberry cloths, low
board, curved white side cheeks), chrome grid shelf, dark jar/can shelf, white cube shelf with wall boards and coffee
machine, drinks fridge, bread slicer, work table with warming display and stool, café corner (round + square bistro
table, chairs with cushions, coffee picture, leaflet stand, umbrella stand, plant, leaded-glass picture), old picture
frames (neutral sepia fill), clock, 4 pendant lamps with warm glow, track lights, downlights, mats, window-sill
decoration with garlands. No products (round 4): the counter is empty like in the video.

Sizes and poses come from the Raumplan (`R1.fixtures`, scaled by plan.f). Fixture frame: origin = `pose.xy` (front
corner at the start of the length; tables and round objects: the centre), x along `rot_deg`, y = +90° into the depth,
z up from `pose.z`; the front (customer or aisle side) is local −y. Every builder also registers its vertex-AO
occluders (`sc.ao`), its product slots (`sc.slots`, catalogue/slots.json) and the nodes it styled (`sc.styled`).
"""
from __future__ import annotations

import math

import numpy as np
from shapely import affinity
from shapely.geometry import Point

from . import geom
from .plan import Fixture, Plan
from .scene import Scene, smooth

BEVEL = geom.BEVEL_FIXTURE      # 12 mm (style.md: fixtures 10–20 mm)
ROD_R = 0.0125                  # bread-shelf tier tubes, Ø 25 mm (video)
RAIL_R = 0.022                  # rounded front rail of each tier
SMALL = 0.006                   # thin boards, frames, rails


def _floor_ao(vb: np.ndarray) -> np.ndarray:
    return 0.84 + 0.16 * smooth(0.0, 0.35, vb[:, 2])


def _rx(a: float) -> np.ndarray:
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], np.float64)


def _rz(a: float) -> np.ndarray:
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], np.float64)


def _newell(p: np.ndarray) -> np.ndarray:
    n = np.zeros(3)
    for a, b in zip(p, np.roll(p, -1, 0)):
        n += np.array([(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])])
    return n


class Local:
    """A local frame in frame B (origin (3,), basis R (3×3, columns = local x, y, z)). Drawing helpers take local
    coordinates; `sub` nests frames (chairs, baskets, tilted tiers)."""

    def __init__(self, sc: Scene, origin, R):
        self.sc = sc
        self.o = np.asarray(origin, np.float64)
        self.R = np.asarray(R, np.float64)

    @classmethod
    def of(cls, sc: Scene, fx: Fixture) -> "Local":
        return cls(sc, [fx.xy[0], fx.xy[1], fx.z], _rz(math.radians(fx.rot)))

    @classmethod
    def at(cls, sc: Scene, xy, rot_deg: float, z: float = 0.0) -> "Local":
        return cls(sc, [xy[0], xy[1], z], _rz(math.radians(rot_deg)))

    def sub(self, x=0.0, y=0.0, z=0.0, rot_deg=0.0, tilt_deg=0.0) -> "Local":
        """Child frame at local (x, y, z), turned about z by rot_deg, then tilted about its x axis (+ = back up)."""
        return Local(self.sc, self.b(np.array([[x, y, z]]))[0], self.R @ _rz(math.radians(rot_deg)) @ _rx(math.radians(tilt_deg)))

    # ---- transforms
    def b(self, pl) -> np.ndarray:
        return self.o + np.asarray(pl, np.float64).reshape(-1, 3) @ self.R.T

    def dir_b(self, v) -> np.ndarray:
        return np.asarray(v, np.float64) @ self.R.T

    def poly_b(self, poly):
        """Horizontal 2-D polygon (local x/y) -> frame-B footprint (ignores tilt)."""
        R = self.R
        return affinity.affine_transform(poly, [R[0, 0], R[0, 1], R[1, 0], R[1, 1], self.o[0], self.o[1]])

    # ---- drawing
    def mesh(self, n, mat, v, t, ao="floor") -> None:
        if len(t) == 0:
            return
        F = self.sc.F
        fn = None
        if ao == "floor":
            fn = lambda vz: _floor_ao(F.zone_to_b(vz))  # noqa: E731
        elif ao is not None:
            k = float(ao)
            fn = lambda vz: np.full(len(vz), k)  # noqa: E731
        n.add_mesh(mat, F.zone(self.b(v)), t, fn)

    def box(self, n, mat, x, y, z, l, d, h, r=BEVEL, segs=2, ao="floor") -> None:
        if l <= 0 or d <= 0 or h <= 0:
            return
        v, t = geom.rounded_box_local(l, d, h, r, segs) if r > 0 else geom.convex_solid(geom.chamfer_box_local(l, d, h, 0.0))
        self.mesh(n, mat, v + np.array([x, y, z]), t, ao)

    def prism(self, n, mat, poly, z0, z1, r=BEVEL, top=True, bottom=False, ao="floor") -> None:
        v, t = geom.bevel_prism(poly, z0, z1, r, top, bottom)
        self.mesh(n, mat, v, t, ao)

    def sweep(self, n, mat, profile_yz, x0, x1, segs=1, ao="floor") -> None:
        v, t = geom.sweep_x(profile_yz, x0, x1, segs)
        self.mesh(n, mat, v, t, ao)

    def rod(self, n, mat, p0, p1, r, sides=6, ao="floor") -> None:
        v, t = geom.rod(p0, p1, r, sides)
        self.mesh(n, mat, v, t, ao)

    def lathe(self, n, mat, cx, cy, cz, profile, segs=12, cap_bottom=False, cap_top=False, ao="floor") -> None:
        v, t = geom.lathe(profile, segs, cap_bottom, cap_top)
        self.mesh(n, mat, v + np.array([cx, cy, cz]), t, ao)

    def hull(self, n, mat, pts, ao="floor") -> None:
        v, t = geom.convex_solid(np.asarray(pts, np.float64))
        self.mesh(n, mat, v, t, ao)

    def poly(self, n, mat, pts, ao=None, both=False) -> None:
        """Planar polygon (local 3-D points, counter-clockwise seen from the side it faces)."""
        pb = self.b(pts)
        nb = _newell(pb)
        if np.linalg.norm(nb) < 1e-12:
            return
        fn = None if ao is None else (lambda vb, k=float(ao): np.full(len(vb), k))
        self.sc.quad(n, mat, pb, nb, fn)
        if both:
            self.sc.quad(n, mat, pb[::-1].copy(), -nb, fn)

    def flat(self, n, mat, poly2d, y: float, ao=None) -> None:
        """2-D shape (x, z) on the plane local y = const, facing −y (a picture's front, a pane)."""
        F = self.sc.F
        nz = F.zone_dir(self.dir_b([0.0, -1.0, 0.0]))
        for v2, t in geom.triangulate(poly2d):
            v3 = np.column_stack([v2[:, 0], np.full(len(v2), y), v2[:, 1]])
            vz = F.zone(self.b(v3))
            n.add(mat, vz, geom.wind(vz, t, nz), nz, None if ao is None else np.full(len(vz), float(ao)))

    # ---- AO and slots
    def slab(self, poly, z, k=0.3, reach=0.5) -> None:
        self.sc.ao.slab(self.poly_b(poly), self.o[2] + z, k, reach)

    def contact(self, poly, k=0.3, reach=0.25) -> None:
        self.sc.ao.contact(self.poly_b(poly), k, reach)

    def slot(self, fixture_id: str, k: int, x, y, z, w, d, h, cap: int, cats: list[str], hint_de: str, tilt_deg: float = 0.0) -> None:
        sc = self.sc
        pz = sc.F.zone(self.b([[x, y, z]])[0])
        front = -self.R[:2, 1]
        T = self.sub(x, y, z, tilt_deg=tilt_deg)
        sc.slot_geo.append(T.b([[-w / 2, -d / 2, 0.0], [w / 2, -d / 2, 0.0], [w / 2, d / 2, 0.0], [-w / 2, d / 2, 0.0]]))
        sc.slots.append({
            "id": f"{fixture_id}/platz-{k:02d}", "fixture": fixture_id,
            "pose": {"x": round(float(pz[0]), 3), "y": round(float(pz[1]), 3), "z": round(float(pz[2]), 3),
                     "heading_deg": round(sc.F.heading(front), 1) % 360.0},
            "tilt_deg": round(float(tilt_deg), 1),
            "size": {"w": round(float(w), 3), "d": round(float(d), 3), "h": round(float(h), 3)},
            "capacity": int(cap), "capacity_de": hint_de, "categories": list(cats)})


def _node(sc: Scene, name: str, fx: Fixture | None, source: str | None = None, sigma: float | None = None):
    src = source or _src(fx.source if fx else "photo")
    sig = sigma if sigma is not None else (fx.sigma if fx else 0.4)
    n = sc.node(name, "int", source=src, sigma=sig)
    sc.styled.add(name)
    return n


def _src(s: str) -> str:
    """Plan source (`mesh+video`, `video`, …) -> catalogue node source (plan | photo | mesh | tape)."""
    if "tape" in s:
        return "tape"
    if "mesh" in s:
        return "mesh"
    return "photo"


def to_b_poly(fx: Fixture, poly_local):
    ux, uy = fx.ux, fx.uy
    return affinity.affine_transform(poly_local, [ux[0], uy[0], ux[1], uy[1], fx.xy[0], fx.xy[1]])


def _prof(points, dz, z0):
    return [(y, z0 + t * dz) for y, t in points]


SLANT = [(0.03, 0.0), (0.135, 0.45), (0.24, 0.86), (0.285, 0.95), (0.33, 1.0)]
UPRIGHT = [(0.03, 0.0), (0.03, 0.50), (0.05, 0.72), (0.10, 0.87), (0.18, 0.96), (0.33, 1.0)]


def _y_at(prof, z) -> float:
    for (y0, z0), (y1, z1) in zip(prof[:-1], prof[1:]):
        if z0 <= z <= z1 and z1 > z0:
            return y0 + (y1 - y0) * (z - z0) / (z1 - z0)
    return prof[-1][0]


# ----------------------------------------------------------------------------------------------- counter (F1)

def theke(sc: Scene, p: Plan) -> None:
    fx = p.fixtures["F1"]
    f = p.f
    l, d, H = fx.l, fx.d, fx.h
    raw = fx.raw
    parts = {q["id"]: q for q in raw.get("parts", [])}

    def pv(pid, key="h", dflt=0.0):
        q = parts.get(pid, {}).get(key)
        return f * float(q["v"]) if isinstance(q, dict) else f * dflt

    base_h, ledge_top, overhang = pv("sockel", dflt=0.62), pv("granitablage", dflt=0.65), pv("granitablage", "overhang", 0.20)
    work_h, work_d = pv("arbeitsplatte", dflt=0.90), pv("arbeitsplatte", "depth", 0.43)
    sl = {s["id"]: s for s in raw.get("slots", [])}
    deck_z = f * sl["ebene-1"]["z"]
    shelf_z, shelf_d = f * sl["ebene-2"]["z"], f * sl["ebene-2"]["d"]
    top_d = f * sl["ebene-3"]["d"]
    r = d / 2
    yb = d - work_d                       # back of the display deck = front of the staff work zone
    x0, x1 = 0.30, l - 0.02               # display from the end of the rounded SW end to the NE end
    mods = raw.get("modules") or [{"share": {"v": 0.63}, "front": "schraeg"}, {"share": {"v": 0.37}, "front": "senkrecht"}]
    sh = [float(m["share"]["v"]) for m in mods]
    xs = x0 + (x1 - x0) * sh[0] / sum(sh)
    profs = [_prof(SLANT if m.get("front") == "schraeg" else UPRIGHT, H - deck_z, deck_z) for m in mods]
    ranges = [(x0, xs), (xs, x1)]
    yt0, yt1 = 0.33, 0.33 + top_d
    L = Local.of(sc, fx)

    # ---- base (white, marble look) with the open compartments on the staff side
    xc0 = r + 0.06
    body = Point(r, r).buffer(r, quad_segs=6).union(geom.rect(r, 0, l, yb)).union(geom.rect(r, 0, xc0, d))
    n = _node(sc, "theke/sockel", fx)
    L.prism(n, "marmor", body, 0.0, base_h, BEVEL, top=True)
    L.contact(body, 0.35, 0.28)
    n = _node(sc, "theke/faecher", fx)
    L.box(n, "marmor", xc0, yb, 0.0, l - xc0, work_d, 0.07, SMALL, 1)
    ndiv = max(2, round((l - xc0) / 0.62))
    for k in range(1, ndiv + 1):
        xk = xc0 + k * (l - xc0) / ndiv - (0.02 if k == ndiv else 0.01)
        L.box(n, "marmor", xk, yb, 0.07, 0.02, work_d - 0.01, work_h - 0.03 - 0.07, 0.004, 1)
    L.box(n, "marmor", xc0, yb, 0.42, l - xc0, work_d - 0.03, 0.02, 0.004, 1)
    L.slab(geom.rect(xc0, yb, l, d), work_h - 0.03, 0.45, 0.9)
    L.slab(geom.rect(xc0, yb, l, d), 0.42, 0.25, 0.35)

    # ---- granite ledge (customer side, overhanging)
    n = _node(sc, "theke/granitablage", fx)
    ledge = body.buffer(overhang, quad_segs=6).intersection(geom.rect(-5, -5, l + 0.05, 0.30))
    L.prism(n, "granit-rosa", ledge, ledge_top - 0.035, ledge_top, 0.008, top=True, bottom=True)
    L.slab(ledge.difference(body), ledge_top - 0.035, 0.38, 0.45)

    # ---- red band + champagne trim, display body behind it
    n = _node(sc, "theke/zierband", fx)
    L.sweep(n, "thekenrot", geom.rounded_rect_profile(0.03, deck_z - ledge_top, 0.012, 2, 0.0, ledge_top), x0, x1, 8)
    L.sweep(n, "champagner", geom.rounded_rect_profile(0.035, 0.014, 0.005, 1, -0.004, deck_z - 0.014), x0, x1, 8)
    nv = _node(sc, "theke/vitrine", fx)
    L.box(nv, "marmor", x0, 0.03, ledge_top, x1 - x0, yb - 0.03, deck_z - ledge_top - 0.02, 0.004, 1)
    L.poly(nv, "marmor", [(x1, yb, deck_z), (x0, yb, deck_z), (x0, yb, work_h - 0.03), (x1, yb, work_h - 0.03)])

    # ---- deck (ebene-1), glass shelf (ebene-2), glass top (ebene-3), front glass, end panes, frame
    n1 = _node(sc, "theke/vitrine/ebene-1", fx)
    n2 = _node(sc, "theke/vitrine/ebene-2", fx)
    for (xa, xb), prof in zip(ranges, profs):
        L.box(n1, "marmor", xa + 0.01, 0.04, deck_z - 0.02, xb - xa - 0.02, yb - 0.05, 0.02, 0.005, 1)
        L.box(n1, "lack-schwarz", xa + 0.04, 0.06, deck_z, xb - xa - 0.08, 0.05, 0.004, 0.0)        # vent grille
        ys0 = _y_at(prof, shelf_z) + 0.05
        ys1 = min(ys0 + shelf_d, yt1 - 0.02)
        L.poly(n2, "glas", [(xa + 0.02, ys0, shelf_z), (xb - 0.02, ys0, shelf_z), (xb - 0.02, ys1, shelf_z), (xa + 0.02, ys1, shelf_z)])
        L.sweep(n2, "champagner", geom.rounded_rect_profile(0.012, 0.02, 0.004, 1, ys0 - 0.012, shelf_z - 0.012), xa + 0.02, xb - 0.02, 3)
        for xe in (xa + 0.03, xb - 0.05):
            L.box(n2, "champagner", xe, ys0, shelf_z - 0.03, 0.02, ys1 - ys0, 0.02, 0.003, 1)
        for (ya, za), (yb2, zb) in zip(prof[:-1], prof[1:]):
            L.poly(nv, "glas", [(xa, ya, za), (xb, ya, za), (xb, yb2, zb), (xa, yb2, zb)])
    n3 = _node(sc, "theke/vitrine/ebene-3", fx)
    L.poly(n3, "glas", [(x0, yt0, H), (x1, yt0, H), (x1, yt1, H), (x0, yt1, H)])
    L.rod(n3, "champagner", (x0, yt0, H - 0.006), (x1, yt0, H - 0.006), 0.009, 6)
    L.rod(n3, "champagner", (x0, yt1, H - 0.006), (x1, yt1, H - 0.006), 0.009, 6)
    for xe, prof in ((x0, profs[0]), (xs, profs[1]), (x1, profs[1])):
        pane = [(xe, y, z) for y, z in prof] + [(xe, yt1, H), (xe, yt1, work_h), (xe, yb, work_h), (xe, yb, deck_z)]
        L.poly(nv, "glas", pane[::-1] if xe == x0 else pane)
        for (ya, za), (yb2, zb) in zip(prof[:-1], prof[1:]):
            L.rod(nv, "champagner", (xe, ya, za), (xe, yb2, zb), 0.011, 4)
        L.rod(nv, "champagner", (xe, yt1, work_h), (xe, yt1, H), 0.011, 4)
    L.slab(geom.rect(x0, 0.04, x1, yb), deck_z - 0.02, 0.2, 0.25)

    # ---- work top (staff side)
    n = _node(sc, "theke/arbeitsplatte", fx)
    L.box(n, "granit-rosa", r, yb, work_h - 0.03, l - r, work_d + 0.02, 0.03, 0.008, 2)

    # ---- till, pretzel stand, cake cover, blank table cards
    # till ≈ 1.8 from the SW end (video t049, t062): the drawer fits under the glass top (0.37 clear), the screen
    # stands behind the glass top's back edge (local +y = towards the customer, the till faces the staff)
    n = _node(sc, "theke/kasse", fx, "photo", 0.4)
    yk = min(d - 0.17, yt1 + 0.04)
    T = L.sub(1.80 * f, yk, work_h, rot_deg=180)
    T.box(n, "lack-schwarz", -0.19, -0.17, 0.0, 0.38, 0.34, 0.11, 0.015, 2)
    T.box(n, "kissen", -0.17, -0.175, 0.02, 0.34, 0.01, 0.05, 0.0)                                     # drawer line
    ys = -(yt1 + 0.07 - yk)                                                                            # behind the top
    T.rod(n, "lack-schwarz", (0.0, ys + 0.02, 0.11), (0.0, ys, 0.25), 0.015, 6)
    S = T.sub(0.0, ys, 0.25, tilt_deg=-12)
    S.box(n, "lack-schwarz", -0.15, -0.03, 0.0, 0.30, 0.03, 0.21, 0.01, 2)
    S.box(n, "kissen", -0.13, -0.035, 0.02, 0.26, 0.006, 0.17, 0.0)                                    # dark screen

    n = _node(sc, "theke/brezelstaender", fx, "photo", 0.3)
    B = L.sub(1.15 * f, (yt0 + yt1) / 2, H + 0.002)
    sc.anchors["theke/brezelstaender"] = sc.F.zone(B.b([[0.0, 0.0, 0.0]])[0])
    half = 0.17                                                         # arms ≈ 0.34 (video estimate 0.30 ± 0.05)
    B.lathe(n, "holz-hell", 0, 0, 0, [(0.0, 0.0), (0.14, 0.0), (0.14, 0.018), (0.125, 0.032), (0.03, 0.036), (0.0, 0.036)], 16)
    B.rod(n, "holz-hell", (0, 0, 0.03), (0, 0, 0.58), 0.016, 8)
    arms = []
    for za, a in ((0.25, 0.0), (0.45, 90.0)):
        ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        e0, e1 = (-half * ca, -half * sa, za), (half * ca, half * sa, za)
        B.rod(n, "holz-hell", e0, e1, 0.011, 6)
        for e in (e0, e1):
            B.lathe(n, "holz-hell", e[0], e[1], e[2] - 0.016, [(0.0, 0.0), (0.016, 0.008), (0.016, 0.024), (0.0, 0.032)], 6)
            arms.append(e)
    B.lathe(n, "holz-hell", 0, 0, 0.575, [(0.0, 0.0), (0.022, 0.01), (0.018, 0.03), (0.0, 0.04)], 8)
    k = 0
    for (ex, ey, ez), m in zip(arms, (3, 2, 3, 2)):
        r0, r1 = 0.045, 0.135 if m == 3 else 0.12                     # clear of the pole and of the end knob
        for j in range(m):
            k += 1
            r = (r0 + (r1 - r0) * j / (m - 1)) / half
            B.slot("theke/brezelstaender", k, ex * r, ey * r, ez - 0.14, 0.13, (r1 - r0) / (m - 1), 0.12, 1,
                   ["laugengebaeck"], "1 Brezel (hängend, die Stange durch eine Schlaufe)")

    n = _node(sc, "theke/kuchenhaube", fx, "photo", 0.3)
    ys0 = _y_at(profs[1], shelf_z) + 0.05
    xh = xs + 0.02 + 1.5 * (x1 - xs - 0.04) / 2                       # centre of the last glass-shelf slot (platz-06)
    yh = ys0 + min(shelf_d, yt1 - 0.02 - ys0) / 2
    hd = min(0.18, H - shelf_z - 0.045)                                 # dome + knob stay below the glass top
    L.lathe(n, "glas", xh, yh, shelf_z + 0.003,
            [(0.175, 0.0), (0.175, 0.5 * hd), (0.155, 0.8 * hd), (0.10, 0.95 * hd), (0.0, hd)], 14, ao=None)
    L.lathe(n, "chrom", xh, yh, shelf_z + 0.001 + hd, [(0.0, 0.0), (0.016, 0.004), (0.016, 0.016), (0.0, 0.02)], 8)

    n = _node(sc, "theke/aufsteller", fx, "photo", 0.4)
    for xa in (1.72 * f, 2.02 * f):                                     # small A-frame cards (≈ 0.11 × 0.15), blank
        cw, ch = 0.11, 0.15
        L.hull(n, "putz-weiss", [(xa, yt0 + 0.06, H), (xa + cw, yt0 + 0.06, H), (xa, yt0 + 0.13, H), (xa + cw, yt0 + 0.13, H),
                                 (xa, yt0 + 0.093, H + ch), (xa + cw, yt0 + 0.093, H + ch),
                                 (xa, yt0 + 0.097, H + ch), (xa + cw, yt0 + 0.097, H + ch)])

    # ---- slots: trays on the deck and the glass shelf (left module 4, right 2), bags on the right half of the top
    k1 = k2 = 0
    for (xa, xb), prof, m in zip(ranges, profs, (4, 2)):
        w = (xb - xa - 0.04) / m
        ys0 = _y_at(prof, shelf_z) + 0.05
        ys1 = min(ys0 + shelf_d, yt1 - 0.02)
        for j in range(m):
            xc = xa + 0.02 + (j + 0.5) * w
            k1 += 1
            L.slot("theke/vitrine/ebene-1", k1, xc, 0.06 + (yb - 0.08) / 2, deck_z, w - 0.02, yb - 0.10, shelf_z - deck_z - 0.03, 4,
                   ["kuchen", "suesses"], "1 Blech 60×40 oder 2–4 Kuchen (≈ 12 Stücke)")
            k2 += 1
            L.slot("theke/vitrine/ebene-2", k2, xc, (ys0 + ys1) / 2, shelf_z + 0.004, w - 0.02, ys1 - ys0 - 0.02, H - shelf_z - 0.03, 12,
                   ["suesses", "kuchen", "laugengebaeck", "broetchen"], "1 Blech 60×40 (≈ 12 Teilchen)")
    xm = (x0 + x1) / 2 + 0.10
    w = (x1 - 0.04 - xm) / 8
    for j in range(8):
        L.slot("theke/vitrine/ebene-3", j + 1, xm + (j + 0.5) * w, yt0 + 0.12, H + 0.002, w - 0.02, 0.20, 0.35, 1,
               ["tuete", "suesses"], "1 Gebäcktüte")


# ----------------------------------------------------------------------------------------------- bread shelf (F2)

BASKET_FILL_DEPTH = 0.09     # rolls lie on a cloth-covered insert this far below the basket rim


def _basket(L: Local, n_basket, x0: float, y0: float, w: float, dd: float, hh: float) -> None:
    """Wicker basket (tapered, 4 woven bands) lined with a raspberry cloth that folds over the rim and stands up at
    the corners. ≈ 70 triangles."""
    c, t = 0.035, 0.012

    def rect_at(z, inset):
        return [(x0 + inset, y0 + inset, z), (x0 + w - inset, y0 + inset, z), (x0 + w - inset, y0 + dd - inset, z), (x0 + inset, y0 + dd - inset, z)]

    bands = 4
    for b in range(bands):
        za, zb = hh * b / bands, hh * (b + 1) / bands
        lo, hi = rect_at(za, c * (1 - za / hh)), rect_at(zb, c * (1 - zb / hh))
        for i in range(4):
            j = (i + 1) % 4
            L.poly(n_basket, "korb", [lo[i], lo[j], hi[j], hi[i]], ao=(1.0 if b % 2 == 0 else 0.84))
    L.poly(n_basket, "korb", rect_at(0.0, c)[::-1], ao=0.8)
    out_lo, out_hi = rect_at(hh - 0.05, c * 0.05 / hh - 0.004), rect_at(hh + 0.004, -0.004)
    top_in = rect_at(hh + 0.004, t)
    for i in range(4):
        j = (i + 1) % 4
        L.poly(n_basket, "tuch-rosa", [out_lo[i], out_lo[j], out_hi[j], out_hi[i]])                       # cloth over the rim
        L.poly(n_basket, "tuch-rosa", [out_hi[i], out_hi[j], top_in[j], top_in[i]])                       # rim
    bot_in = rect_at(0.03, c + t)
    for i in range(4):
        j = (i + 1) % 4
        L.poly(n_basket, "tuch-rosa", [bot_in[j], bot_in[i], top_in[i], top_in[j]], ao=0.9)               # lining
    L.poly(n_basket, "tuch-rosa", bot_in, ao=0.78)
    for i in range(4):                                                                                    # corner peaks
        cx, cy, _ = out_hi[i]
        a, b = out_hi[(i + 1) % 4], out_hi[(i - 1) % 4]
        e1 = np.array([a[0] - cx, a[1] - cy])
        e1 /= np.linalg.norm(e1)
        e2 = np.array([b[0] - cx, b[1] - cy])
        e2 /= np.linalg.norm(e2)
        p1 = (cx + 0.08 * e1[0], cy + 0.08 * e1[1], hh + 0.004)
        p2 = (cx + 0.08 * e2[0], cy + 0.08 * e2[1], hh + 0.004)
        tip = (cx - 0.012 * (e1[0] + e2[0]), cy - 0.012 * (e1[1] + e2[1]), hh + 0.07)
        L.poly(n_basket, "tuch-rosa", [p1, tip, p2], both=True)


def brotregal(sc: Scene, p: Plan) -> None:
    fx = p.fixtures["F2"]
    f = p.f
    l, d, h = fx.l, fx.d, fx.h
    raw = fx.raw
    sl = {s["id"]: s for s in raw.get("slots", [])}
    bays = int(raw.get("bays", 3))
    tw = 0.035
    L = Local.of(sc, fx)
    L.contact(geom.rect(0, d - 0.42, l, d), 0.2, 0.2)

    # ---- side cheeks (white, curved front edge), wall standards
    n = _node(sc, "brotregal/seitenwangen", fx)
    zs = np.linspace(0.0, h, 10)
    prof = geom._dedupe([(d, 0.0)] + [(d - (0.30 + 0.30 * math.sin(math.pi * z / h) ** 0.7), z) for z in zs] + [(d, h)])
    for xa in (0.0, l - tw):
        L.sweep(n, "regal-weiss", prof, xa, xa + tw, 1)
    nk = _node(sc, "brotregal/korpus", fx)
    xstd = [tw + 0.005] + [l * k / bays - 0.0175 for k in range(1, bays)] + [l - tw - 0.04]
    for xk in xstd:
        L.box(nk, "champagner", xk, d - 0.022, 0.60 * f, 0.035, 0.02, h - 0.65 * f, 0.004, 1)

    # ---- low board, basket level with 6 baskets
    s = sl.get("unterboden")
    if s:
        z, sd = f * s["z"], f * s["d"]
        n = _node(sc, "brotregal/unterboden", fx)
        L.box(n, "regal-weiss", tw, d - sd, z - 0.022, l - 2 * tw, sd, 0.022, SMALL, 1)
        L.slab(geom.rect(tw, d - sd, l - tw, d), z - 0.022, 0.3, 0.3)
    s = sl["koerbe"]
    z, sd, a = f * s["z"], f * s["d"], float(s.get("neigung_deg", 10))
    yf = d - 0.025 - sd * math.cos(math.radians(a))
    C = L.sub(0.0, yf, z, tilt_deg=a)
    n = _node(sc, "brotregal/koerbe", fx, "photo", 0.3)
    C.box(n, "champagner", tw, 0.0, -0.022, l - 2 * tw, sd, 0.022, SMALL, 1)
    C.box(n, "champagner", tw, -0.012, -0.03, l - 2 * tw, 0.014, 0.05, 0.004, 1)
    for xk in xstd:
        C.box(n, "champagner", xk, 0.0, -0.05, 0.02, sd, 0.03, 0.003, 1)
    L.slab(geom.rect(tw, yf, l - tw, d), z - 0.03, 0.35, 0.6)
    kb = raw.get("koerbe") or {}
    bw, bd, bh, pitch = (f * float(kb.get(key, {}).get("v", dv)) for key, dv in (("w", 0.55), ("d", 0.38), ("h", 0.20), ("pitch", 0.58)))
    nb = int(kb.get("n", 6))
    per_bay = max(1, nb // bays)
    k = 0
    for b in range(bays):
        xc_bay = l * (2 * b + 1) / (2 * bays)
        for j in range(per_bay):
            k += 1
            xc = xc_bay + (j - (per_bay - 1) / 2) * pitch
            nbk = _node(sc, f"brotregal/koerbe/korb-{k}", fx, "photo", 0.3)
            _basket(C, nbk, xc - bw / 2, 0.01, bw, bd, bh)
            # raised, cloth-covered insert: the rolls lie heaped up to and over the rim (video), not deep in the basket
            zf = bh - BASKET_FILL_DEPTH
            ins = 0.035 * (1 - zf / bh) + 0.004
            C.poly(nbk, "tuch-rosa", [(xc - bw / 2 + ins, 0.01 + ins, zf), (xc + bw / 2 - ins, 0.01 + ins, zf),
                                      (xc + bw / 2 - ins, 0.01 + bd - ins, zf), (xc - bw / 2 + ins, 0.01 + bd - ins, zf)][::-1], ao=0.85)
            C.slot(f"brotregal/koerbe/korb-{k}", 1, xc, 0.01 + bd / 2, zf + 0.002, bw - 0.08, bd - 0.08, BASKET_FILL_DEPTH + 0.06, 20,
                   ["broetchen", "laugengebaeck"], "≈ 20 Brötchen in einer Lage (gehäuft ≈ 30)", a)

    # ---- rod tiers (front edge = z), price rails on 1–2, red front edge on the top tier
    nr = _node(sc, "brotregal/preisschienen", fx, "photo", 0.3)
    counts = {"ebene-1": 14, "ebene-2": 15, "ebene-3": 14}
    for sid in ("ebene-1", "ebene-2", "ebene-3"):
        s = sl.get(sid)
        if not s:
            continue
        z, sd, a, nrods = f * s["z"], f * s["d"], float(s.get("neigung_deg", 25)), int(s.get("stangen", 7))
        yf = d - 0.025 - sd * math.cos(math.radians(a))
        T = L.sub(0.0, yf, z, tilt_deg=a)
        n = _node(sc, f"brotregal/{sid}", fx, "photo", 0.3)
        xa_, xb_ = tw + 0.01, l - tw - 0.01
        for i in range(nrods):                                          # round champagne tubes Ø 25 mm (video)
            yi = 0.045 + i * (sd - 0.06) / max(nrods - 1, 1)
            T.rod(n, "champagner", (xa_, yi, ROD_R), (xb_, yi, ROD_R), ROD_R, 8)
        for xk in xstd:
            T.box(n, "champagner", xk, 0.02, -0.028, 0.02, sd - 0.02, 0.028, 0.003, 1)
        # rounded front rail: a fat tube that stands a little proud of the rods (the loaves rest against it)
        T.rod(n, "heusser-rot" if sid == "ebene-3" else "champagner", (tw + 0.005, 0.0, ROD_R - 0.004),
              (l - tw - 0.005, 0.0, ROD_R - 0.004), RAIL_R, 12)
        if sid != "ebene-3":                                            # slim price strip with clips below the rail
            T.sweep(nr, "champagner", geom.rounded_rect_profile(0.008, 0.03, 0.003, 1, -0.012, -0.05), tw + 0.02, l - tw - 0.02, 3)
            for c in range(8):
                xc = tw + (c + 0.5) * (l - 2 * tw) / 8
                T.box(nr, "chrom", xc - 0.010, -0.018, -0.048, 0.020, 0.008, 0.026, 0.0)
        L.slab(geom.rect(tw, yf, l - tw, d), z, 0.25, 0.32)
        m = counts.get(sid, 14)
        U = l - 2 * tw - 0.04
        for j in range(m):
            T.slot(f"brotregal/{sid}", j + 1, tw + 0.02 + (j + 0.5) * U / m, sd / 2, 0.026, U / m - 0.01, sd - 0.04,
                   0.30 if sid == "ebene-3" else 0.26, 1, ["brot"], "1 Brot (rund Ø ≈ 0,22 oder Kastenbrot quer)", a)


# ----------------------------------------------------------------------------------------------- grid shelf (F3)

def gitterregal(sc: Scene, p: Plan) -> None:
    fx = p.fixtures["F3"]
    f = p.f
    l, d, h = fx.l, fx.d, fx.h
    L = Local.of(sc, fx)
    n = _node(sc, "gitterregal/korpus", fx)
    for x, y in ((0.012, 0.012), (l - 0.012, 0.012), (l - 0.012, d - 0.012), (0.012, d - 0.012)):
        L.rod(n, "chrom", (x, y, 0.0), (x, y, h), 0.012, 6)
        L.lathe(n, "lack-schwarz", x, y, 0.0, [(0.016, 0.0), (0.016, 0.02), (0.0, 0.02)], 6)
    levels = [f * float(z) for z in fx.raw.get("boeden", [0.15, 0.55, 0.95, 1.35, 1.75])]
    for k, zs in enumerate(levels):
        c = [(0.02, 0.02), (l - 0.02, 0.02), (l - 0.02, d - 0.02), (0.02, d - 0.02)]
        for i in range(4):
            a, b = c[i], c[(i + 1) % 4]
            L.rod(n, "chrom", (a[0], a[1], zs), (b[0], b[1], zs), 0.006, 4)
        nw = int(round((l - 0.04) / 0.075))
        for j in range(1, nw):
            x = 0.02 + j * (l - 0.04) / nw
            L.rod(n, "chrom", (x, 0.02, zs - 0.004), (x, d - 0.02, zs - 0.004), 0.003, 4)
        L.slab(geom.rect(0, 0, l, d), zs, 0.12, 0.3)
        top = levels[k + 1] if k + 1 < len(levels) else zs + 0.35
        L.slot("gitterregal", k + 1, l / 2, d / 2, zs + 0.004, l - 0.06, d - 0.06, top - zs - 0.03, 7,
               ["tuete", "brot"], "6–8 Brottüten (2 Reihen)")
    L.contact(geom.rect(0, 0, l, d), 0.18, 0.2)


# ----------------------------------------------------------------------------------------------- jar / can shelf (F7)

def dosenregal(sc: Scene, p: Plan) -> None:
    fx = p.fixtures["F7"]
    f = p.f
    l, d = fx.l, fx.d
    units = {u["id"]: u for u in fx.raw.get("einheiten", [])}
    left, right = units.get("links", {}), units.get("rechts", {})
    l1 = f * float(left.get("l", {}).get("v", 0.82))
    l2 = f * float(right.get("l", {}).get("v", 0.55))
    h2 = f * float(right.get("h", {}).get("v", 1.45))
    boards = [f * float(z) for z in left.get("boeden", [0.15, 0.50, 0.85, 1.20, 1.55])]
    L = Local.of(sc, fx)
    n = _node(sc, "dosenregal/korpus", fx)
    # left unit: black steel posts, dark wood boards, grid side, X brace at the back
    for x, y in ((0.0, 0.0), (l1 - 0.03, 0.0), (l1 - 0.03, d - 0.03), (0.0, d - 0.03)):
        L.box(n, "lack-schwarz", x, y, 0.0, 0.03, 0.03, boards[-1] + 0.02, 0.004, 1)
    for k, zb in enumerate(boards):
        L.box(n, "holz-dunkel", 0.0, 0.0, zb - 0.025, l1, d, 0.025, SMALL, 1)
        L.slab(geom.rect(0, 0, l1, d), zb - 0.025, 0.3, 0.33)
        top = boards[k + 1] - 0.025 if k + 1 < len(boards) else zb + 0.35
        L.slot("dosenregal", k + 1, l1 / 2, d / 2, zb, l1 - 0.06, d - 0.04, top - zb - 0.02, 16,
               ["glas", "dose"], "≈ 16 Gläser (8 × 2) oder ≈ 30 Dosen (8 × 2 × 2)")
    for y in (d / 3, 2 * d / 3):
        L.rod(n, "lack-schwarz", (0.012, y, 0.0), (0.012, y, boards[-1]), 0.004, 4)
    for z in np.arange(0.25, boards[-1], 0.25):
        L.rod(n, "lack-schwarz", (0.012, 0.02, float(z)), (0.012, d - 0.02, float(z)), 0.004, 4)
    L.rod(n, "lack-schwarz", (0.04, d - 0.012, 0.1), (l1 - 0.04, d - 0.012, boards[-1] - 0.05), 0.005, 4)
    L.rod(n, "lack-schwarz", (l1 - 0.04, d - 0.012, 0.1), (0.04, d - 0.012, boards[-1] - 0.05), 0.005, 4)
    # right unit: dark wood box, 2 columns × 4 compartments
    xa = l1 + 0.01
    xb = min(l, xa + l2)
    for x in (xa, xb - 0.02):
        L.box(n, "holz-dunkel", x, 0.0, 0.0, 0.02, d, h2, SMALL, 1)
    L.box(n, "holz-dunkel", xa, d - 0.012, 0.0, xb - xa, 0.012, h2, 0.0)
    rows = int(right.get("faecher", 4))
    zr = [0.10 * f + k * (h2 - 0.10 * f) / rows for k in range(rows + 1)]
    for zb in zr:
        L.box(n, "holz-dunkel", xa + 0.02, 0.0, zb - 0.02, xb - xa - 0.04, d - 0.012, 0.02, 0.004, 1)
    L.box(n, "holz-dunkel", (xa + xb) / 2 - 0.009, 0.0, zr[0], 0.018, d - 0.012, h2 - zr[0] - 0.02, 0.004, 1)
    cw = (xb - xa - 0.04 - 0.018) / 2
    k = len(boards)
    for r in range(rows):
        L.slab(geom.rect(xa, 0, xb, d), zr[r + 1] - 0.02, 0.35, 0.3)
        for c in range(2):
            k += 1
            xc = xa + 0.02 + c * (cw + 0.018) + cw / 2
            L.slot("dosenregal", k, xc, d / 2, zr[r], cw - 0.02, d - 0.05, zr[r + 1] - zr[r] - 0.04, 6,
                   ["glas", "dose", "tuete"], "2–3 Kaffeepackungen oder ≈ 6 kleine Gläser")
    L.contact(geom.rect(0, 0, xb, d), 0.3, 0.25)


# ----------------------------------------------------------------------------------------------- fridge (F13)

def kuehlschrank(sc: Scene, p: Plan) -> None:
    fx = p.fixtures["F13"]
    l, d, h = fx.l, fx.d, fx.h
    L = Local.of(sc, fx)
    n = _node(sc, "getraenkekuehlschrank/korpus", fx)
    t = 0.035
    L.box(n, "regal-weiss", 0.0, 0.03, 0.0, l, d - 0.03, h, 0.015, 2)                                    # body shell
    L.box(n, "lack-schwarz", 0.03, 0.025, 0.02, l - 0.06, 0.01, 0.10, 0.0)                               # grille
    L.box(n, "chrom", 0.0, 0.0, 0.14, l, 0.035, h - 0.32, 0.01, 2)                                       # door frame (light, video)
    zi0, zi1 = 0.14 + t, h - 0.18 - t
    L.poly(n, "lampe", [(t + 0.02, -0.001, zi0), (t + 0.02, -0.001, zi1), (l - t - 0.02, -0.001, zi1), (l - t - 0.02, -0.001, zi0)][::-1],
           ao=0.82)                                                                                        # lit inside (seen through the glass)
    nsh = int(fx.raw.get("faecher", 5))
    for k in range(nsh):
        z = zi0 + 0.04 + k * (zi1 - zi0 - 0.08) / nsh
        L.box(n, "chrom", t + 0.02, -0.003, z, l - 2 * t - 0.04, 0.002, 0.012, 0.0)
        L.slot("getraenkekuehlschrank", k + 1, l / 2, d / 2 + 0.02, z + 0.012, l - 0.12, d - 0.14, (zi1 - zi0) / nsh - 0.04, 21,
               ["flasche"], "≈ 7 Flaschen nebeneinander × 3 tief")
    L.poly(n, "glas", [(t, -0.006, zi0), (l - t, -0.006, zi0), (l - t, -0.006, zi1), (t, -0.006, zi1)][::-1])
    L.box(n, "chrom", l - t - 0.05, -0.035, 0.75, 0.02, 0.03, 0.40, 0.006, 1)                              # handle
    L.contact(geom.rect(0, 0, l, d), 0.32, 0.25)


# ----------------------------------------------------------------------------------------------- cube shelf, boards, coffee machine, bag holder

def wuerfelregal(sc: Scene, p: Plan) -> None:
    fx = p.fixtures["F14"]
    f = p.f
    l, d, h = fx.l, fx.d, fx.h
    zp = f * float((fx.raw.get("sockel") or {}).get("v", 0.20))
    L = Local.of(sc, fx)
    n = _node(sc, "wuerfelregal/korpus", fx)
    t = 0.022
    L.box(n, "regal-weiss", 0.02, 0.03, 0.0, l - 0.04, d - 0.03, zp, SMALL, 1)
    for x in (0.0, l - t):
        L.box(n, "regal-weiss", x, 0.0, zp, t, d, h - zp, SMALL, 1)
    rows = int((fx.raw.get("faecher") or {}).get("reihen", 4))
    zr = [zp + k * (h - zp - t) / rows for k in range(rows + 1)]
    for z in zr:
        L.box(n, "regal-weiss", t, 0.0, z, l - 2 * t, d, t, 0.004, 1)
    L.box(n, "regal-weiss", l / 2 - t / 2, 0.0, zp + t, t, d, h - zp - 2 * t, 0.004, 1)
    cw = (l - 3 * t) / 2
    k = 0
    for r in range(rows):
        L.slab(geom.rect(0, 0, l, d), zr[r + 1], 0.35, 0.35)
        for c in range(2):
            k += 1
            L.slot("wuerfelregal", k, t + c * (cw + t) + cw / 2, d / 2, zr[r] + t, cw - 0.02, d - 0.04, zr[r + 1] - zr[r] - t - 0.02, 4,
                   ["flasche", "glas"], "Café-Zubehör: Becher, Tassen, Sirupflaschen")
    L.contact(geom.rect(0, 0, l, d), 0.3, 0.25)

    fb = p.fixtures["F15"]
    Lb = Local.of(sc, fb)
    n = _node(sc, "wuerfelregal/wandboards", fb)
    for zb in [f * float(z) for z in fb.raw.get("boeden", [0.75, 0.95, 1.65])]:
        Lb.box(n, "regal-weiss", 0.0, 0.0, zb - 0.022, fb.l, fb.d, 0.022, SMALL, 1)
        for x in (0.04, fb.l - 0.06):
            Lb.box(n, "lack-schwarz", x, fb.d - 0.012, zb - 0.12, 0.02, 0.012, 0.12, 0.0)
        Lb.slab(geom.rect(0, 0, fb.l, fb.d), zb - 0.022, 0.3, 0.3)

    fk = p.fixtures["F16"]
    K = Local.of(sc, fk)
    n = _node(sc, "kaffeemaschine/korpus", fk)
    lk, dk, hk = fk.l, fk.d, fk.h
    K.box(n, "lack-schwarz", 0.0, 0.06, 0.0, lk, dk - 0.06, hk, 0.02, 2)
    K.box(n, "chrom", 0.03, 0.04, 0.12, lk - 0.06, 0.03, hk - 0.17, 0.01, 2)
    K.box(n, "kissen", 0.07, 0.035, hk - 0.24, 0.18, 0.01, 0.15, 0.0)                                      # touch display
    K.box(n, "chrom", 0.04, 0.0, 0.0, lk - 0.08, 0.10, 0.03, 0.006, 1)                                     # drip tray
    K.rod(n, "chrom", (lk / 2, 0.05, 0.16), (lk / 2, 0.05, 0.11), 0.012, 6)                                 # spout

    ft = p.fixtures["F30"]
    Tt = Local.of(sc, ft)
    n = _node(sc, "tuetenhalter/korpus", ft)
    Tt.hull(n, "regal-weiss", [(0.05, 0.04, 0.0), (ft.l - 0.05, 0.04, 0.0), (0.05, ft.d, 0.0), (ft.l - 0.05, ft.d, 0.0),
                               (0.0, 0.0, ft.h), (ft.l, 0.0, ft.h), (0.0, ft.d, ft.h), (ft.l, ft.d, ft.h)])


# ----------------------------------------------------------------------------------------------- SW end: slicer, work table, warming display, stool

def sw_ende(sc: Scene, p: Plan) -> None:
    fs = p.fixtures["F17"]
    S = Local.of(sc, fs)
    l, d, h = fs.l, fs.d, fs.h
    n = _node(sc, "brotschneidemaschine/korpus", fs)
    for x, y in ((0.06, 0.06), (l - 0.06, 0.06), (l - 0.06, d - 0.06), (0.06, d - 0.06)):
        S.lathe(n, "lack-schwarz", x, y, 0.0, [(0.0, 0.0), (0.035, 0.01), (0.035, 0.06), (0.0, 0.07)], 8)
    S.box(n, "edelstahl", 0.0, 0.0, 0.07, l, d, 0.62, 0.015, 2)
    S.hull(n, "edelstahl", [(0.02, 0.02, 0.69), (l - 0.02, 0.02, 0.69), (0.02, d - 0.02, 0.69), (l - 0.02, d - 0.02, 0.69),
                            (0.02, 0.02, h - 0.20), (l - 0.02, 0.02, h - 0.20), (0.05, d - 0.05, h), (l - 0.05, d - 0.05, h)])
    S.poly(n, "lack-schwarz", [(0.10, 0.017, 0.82), (l - 0.10, 0.017, 0.82), (l - 0.10, 0.017, 1.0), (0.10, 0.017, 1.0)][::-1], ao=0.9)
    S.rod(n, "chrom", (0.08, -0.03, 0.62), (l - 0.08, -0.03, 0.62), 0.012, 6)
    S.contact(geom.rect(0, 0, l, d), 0.25, 0.2)

    ft = p.fixtures["F18"]
    T = Local.of(sc, ft)
    l, d, h = ft.l, ft.d, ft.h
    n = _node(sc, "arbeitstisch/korpus", ft)
    T.box(n, "holz-hell", 0.0, 0.0, h - 0.03, l, d, 0.03, 0.008, 2)
    for x, y in ((0.02, 0.02), (l - 0.065, 0.02), (l - 0.065, d - 0.065), (0.02, d - 0.065)):
        T.box(n, "holz-hell", x, y, 0.0, 0.045, 0.045, h - 0.03, 0.006, 1)
    T.box(n, "holz-hell", 0.065, 0.03, h - 0.11, l - 0.13, 0.02, 0.08, 0.004, 1)
    T.box(n, "holz-hell", 0.065, d - 0.05, h - 0.11, l - 0.13, 0.02, 0.08, 0.004, 1)
    T.slab(geom.rect(0, 0, l, d), h - 0.03, 0.3, 0.9)

    fw = p.fixtures["F19"]
    W = Local.of(sc, fw)
    l, d, h = fw.l, fw.d, fw.h
    n = _node(sc, "waermevitrine/korpus", fw)
    W.box(n, "edelstahl", 0.0, 0.0, 0.0, l, d, 0.06, 0.006, 1)
    W.box(n, "edelstahl", 0.0, 0.0, h - 0.08, l, d, 0.08, 0.006, 1)
    W.flat(n, "thekenrot", geom.rect(0.01, h - 0.07, l - 0.01, h - 0.01), -0.002)
    for x, y in ((0.012, d - 0.012), (l - 0.012, d - 0.012), (0.012, 0.012), (l - 0.012, 0.012)):
        W.rod(n, "chrom", (x, y, 0.06), (x, y, h - 0.08), 0.008, 4)
    xs = np.linspace(0.012, l - 0.012, 7)
    bulge = [0.012 - 0.05 * (1 - (2 * (x - 0.012) / (l - 0.024) - 1) ** 2) for x in xs]
    for (xa, ya), (xb, yb) in zip(zip(xs, bulge), zip(xs[1:], bulge[1:])):
        W.poly(n, "glas", [(xa, ya, 0.06), (xb, yb, 0.06), (xb, yb, h - 0.08), (xa, ya, h - 0.08)])
    for x in (0.012, l - 0.012):
        W.poly(n, "glas", [(x, 0.012, 0.06), (x, d - 0.012, 0.06), (x, d - 0.012, h - 0.08), (x, 0.012, h - 0.08)])
    for z in (0.22, 0.40):
        W.box(n, "chrom", 0.02, 0.02, z, l - 0.04, d - 0.04, 0.008, 0.0)

    fh = p.fixtures["F20"]
    Hh = Local.of(sc, fh)
    h = fh.h
    n = _node(sc, "hocker/korpus", fh)
    for k in range(5):
        a = 2 * math.pi * k / 5 + 0.3
        Hh.rod(n, "lack-schwarz", (0, 0, 0.07), (0.24 * math.cos(a), 0.24 * math.sin(a), 0.045), 0.012, 4)
        Hh.lathe(n, "lack-schwarz", 0.24 * math.cos(a), 0.24 * math.sin(a), 0.0, [(0.0, 0.0), (0.022, 0.01), (0.022, 0.035), (0.0, 0.045)], 6)
    Hh.rod(n, "chrom", (0, 0, 0.07), (0, 0, h - 0.07), 0.018, 8)
    Hh.lathe(n, "kissen", 0, 0, 0, [(0.0, h - 0.075), (0.165, h - 0.075), (0.185, h - 0.055), (0.185, h - 0.02), (0.16, h), (0.0, h)], 16)
    Hh.contact(Point(0, 0).buffer(0.2, 8), 0.2, 0.15)


# ----------------------------------------------------------------------------------------------- café: tables and chairs

def chair_centre(p: Plan, fx: Fixture, ch: dict) -> np.ndarray:
    """Chair centre (frame B): its plan offset from the table centre, scaled like every interior value."""
    return fx.xy + (np.asarray(ch["xy"], np.float64) - np.asarray(fx.raw["pose"]["xy"], np.float64)) * p.f


def _chair(sc: Scene, p: Plan, fx: Fixture, ch: dict, name: str) -> None:
    f = p.f
    C = Local.at(sc, chair_centre(p, fx, ch), float(ch["rot_deg"]))
    w, d, h = (f * float(ch["size"][k]) for k in ("l", "d", "h"))
    zs = f * float(ch.get("sitz", 0.46))
    n = _node(sc, name, fx, "photo", float(ch.get("sigma_m", 0.4)))
    x0, y0 = -w / 2, -d / 2
    leg = 0.025
    for x, y, top in ((x0 + 0.01, y0 + 0.01, zs - 0.025), (x0 + w - 0.035, y0 + 0.01, zs - 0.025),
                      (x0 + 0.01, y0 + d - 0.035, h), (x0 + w - 0.035, y0 + d - 0.035, h)):
        C.box(n, "lack-schwarz", x, y, 0.0, leg, leg, top, 0.004, 1)
    for (xa, ya), (xb, yb) in (((x0 + 0.02, y0 + 0.02), (x0 + w - 0.02, y0 + 0.02)), ((x0 + 0.02, y0 + d - 0.02), (x0 + w - 0.02, y0 + d - 0.02)),
                               ((x0 + 0.02, y0 + 0.02), (x0 + 0.02, y0 + d - 0.02)), ((x0 + w - 0.02, y0 + 0.02), (x0 + w - 0.02, y0 + d - 0.02))):
        C.rod(n, "lack-schwarz", (xa, ya, 0.16), (xb, yb, 0.16), 0.006, 4)
    C.box(n, "holz-dunkel", x0, y0, zs - 0.03, w, d, 0.025, 0.006, 1)
    C.box(n, "holz-dunkel", x0 + 0.01, y0 + d - 0.035, h - 0.15, w - 0.02, 0.02, 0.13, 0.006, 2)
    C.box(n, "holz-dunkel", x0 + 0.03, y0 + d - 0.035, zs + 0.12, w - 0.06, 0.018, 0.05, 0.004, 1)
    C.box(n, "kissen", x0 + 0.01, y0 + 0.02, zs - 0.005, w - 0.02, d - 0.06, 0.055, 0.022, 2)
    C.contact(geom.rect(x0, y0, x0 + w, y0 + d), 0.18, 0.15)
    C.slab(geom.rect(x0, y0, x0 + w, y0 + d), zs - 0.03, 0.18, 0.5)


def bistrotisch(sc: Scene, p: Plan, fid: str, cid: str) -> None:
    fx = p.fixtures[fid]
    h = fx.h
    T = Local.of(sc, fx)
    n = _node(sc, f"{cid}/korpus", fx)
    if fx.raw.get("form") == "quadratisch":
        a = fx.l
        T.box(n, "holz-dunkel", -a / 2, -a / 2, h - 0.03, a, a, 0.03, 0.008, 2)
        c = a / 2 - 0.045
        for x, y in ((-c, -c), (c, -c), (c, c), (-c, c)):
            T.box(n, "lack-schwarz", x - 0.0175, y - 0.0175, 0.0, 0.035, 0.035, h - 0.03, 0.005, 1)
        for (xa, ya), (xb, yb) in (((-c, -c), (c, -c)), ((c, -c), (c, c)), ((c, c), (-c, c)), ((-c, c), (-c, -c))):
            T.rod(n, "lack-schwarz", (xa, ya, h - 0.07), (xb, yb, h - 0.07), 0.012, 4)
        top = geom.rect(-a / 2, -a / 2, a / 2, a / 2)
    else:
        R = fx.l / 2
        T.lathe(n, "holz-dunkel", 0, 0, 0, [(0.0, h - 0.03), (R - 0.01, h - 0.03), (R, h - 0.02), (R, h - 0.007), (R - 0.008, h), (0.0, h)], 28)
        legs = []
        for k in range(4):
            a = math.pi / 4 + k * math.pi / 2
            fp = (0.24 * math.cos(a), 0.24 * math.sin(a))
            tp = (0.16 * math.cos(a), 0.16 * math.sin(a))
            T.rod(n, "lack-schwarz", (fp[0], fp[1], 0.0), (tp[0], tp[1], h - 0.03), 0.015, 6)
            legs.append(fp)
        z = 0.20
        s = 1 - (z / (h - 0.03)) * (1 - 0.16 / 0.24)
        for i in (0, 1):
            pa, pb = legs[i], legs[i + 2]
            T.rod(n, "lack-schwarz", (pa[0] * s, pa[1] * s, z), (pb[0] * s, pb[1] * s, z), 0.01, 4)
        top = Point(0, 0).buffer(R, 12)
    T.slab(top, h - 0.03, 0.25, 0.9)
    T.contact(top.buffer(-0.1), 0.15, 0.25)
    for ch in fx.raw.get("stuehle", []):
        _chair(sc, p, fx, ch, f"{cid}/{ch['id']}")


# ----------------------------------------------------------------------------------------------- lamps

LAMPS = (("F11", "haengelampe-3"), ("F8", "haengelampe-1"), ("F9", "haengelampe-2"), ("F12", "haengelampe-4"))


def _mount(p: Plan, fx: Fixture, soffit_poly, soffit_z: float) -> float:
    m = fx.raw.get("z_mount")
    if m == "Sturz":
        return p.bulkhead_h
    if soffit_poly is not None and soffit_poly.contains(Point(fx.xy)):
        return soffit_z
    return p.ceiling


def _lamp_bottom(p: Plan, fx: Fixture, mount: float) -> float:
    pend = p.f * float((fx.raw.get("pendel") or {}).get("v", 0.25))
    return mount - 0.03 - pend - (fx.h or 0.18)


def lamp_lights(p: Plan, soffit_poly, soffit_z: float, strength: float = 0.42, r0: float = 1.0) -> list:
    """Warm point lights for the interior rig (zone frame): just below each pendant's opening."""
    out = []
    for fid, _ in LAMPS:
        if fid not in p.fixtures:
            continue
        fx = p.fixtures[fid]
        zb = _lamp_bottom(p, fx, _mount(p, fx, soffit_poly, soffit_z))
        out.append((p.frame.zone(np.array([fx.xy[0], fx.xy[1], zb - 0.02])), strength, r0))
    return out


def haengelampen(sc: Scene, p: Plan, soffit_poly, soffit_z: float) -> None:
    for fid, cid in LAMPS:
        if fid not in p.fixtures:
            continue
        fx = p.fixtures[fid]
        mount = _mount(p, fx, soffit_poly, soffit_z)
        zb = _lamp_bottom(p, fx, mount)
        R = (fx.l or 0.18) / 2
        L = Local.at(sc, fx.xy, 0.0)
        n = _node(sc, f"{cid}/leuchte", fx)
        L.lathe(n, "lack-schwarz", 0, 0, mount - 0.025, [(0.04, 0.0), (0.04, 0.025), (0.0, 0.025)], 10, cap_bottom=True, ao=None)
        L.rod(n, "lack-schwarz", (0, 0, zb + 2 * R - 0.005), (0, 0, mount - 0.025), 0.003, 4, ao=None)
        prof = [(0.48 * R, zb)] + [(R * math.sin(a), zb + R - R * math.cos(a)) for a in np.linspace(math.radians(45), math.radians(165), 6)] + [(0.0, zb + 2 * R)]
        L.lathe(n, "lack-schwarz", 0, 0, 0, prof, 14, ao=None)
        L.lathe(n, "lampe", 0, 0, zb + 0.012, [(0.47 * R, 0.0), (0.0, 0.0)], 12, ao=None)
        L.lathe(n, "glow", 0, 0, zb + 0.004, [(0.0, -0.045), (0.07, -0.02), (0.085, 0.0), (0.0, 0.0)], 12, ao=None)


def strahler(sc: Scene, p: Plan) -> None:
    for fid, cid in (("F31", "strahlerschiene-1"), ("F32", "strahlerschiene-2"), ("F33", "strahlerschiene-3")):
        if fid not in p.fixtures:
            continue
        fx = p.fixtures[fid]
        mount = _mount(p, fx, None, 0.0)
        L = Local.of(sc, fx)
        n = _node(sc, f"{cid}/leuchte", fx)
        L.box(n, "regal-weiss", 0.0, 0.0, mount - 0.035, fx.l, 0.035, 0.035, 0.005, 1, ao=None)
        ns = int(fx.raw.get("spots", 3))
        for k in range(ns):
            x = fx.l * (k + 0.5) / ns
            L.rod(n, "chrom", (x, 0.0175, mount - 0.035), (x, 0.0175, mount - 0.07), 0.006, 4, ao=None)
            S = L.sub(x, 0.0175, mount - 0.07, tilt_deg=-25)
            S.lathe(n, "chrom", 0, 0, -0.10, [(0.022, 0.0), (0.032, 0.06), (0.032, 0.10), (0.0, 0.10)], 10, ao=None)
            S.lathe(n, "lampe", 0, 0, -0.101, [(0.02, 0.0), (0.0, 0.0)], 10, ao=None)


def einbauleuchten(sc: Scene, p: Plan) -> None:
    fx = p.fixtures.get("F34")
    if fx is None:
        return
    n = _node(sc, "verkaufsraum/einbauleuchten", fx)
    for pt in fx.raw.get("punkte", []):
        L = Local.at(sc, p.S(pt), 0.0)
        L.lathe(n, "regal-weiss", 0, 0, p.ceiling - 0.006, [(0.0, 0.0), (0.055, 0.0), (0.055, 0.006)], 12, ao=None)
        L.lathe(n, "lampe", 0, 0, p.ceiling - 0.007, [(0.04, 0.0), (0.0, 0.0)], 12, ao=None)


# ----------------------------------------------------------------------------------------------- café decor, pictures, mats, windows

def cafe_deko(sc: Scene, p: Plan) -> None:
    f = p.f
    fp = p.fixtures["F21"]
    L = Local.of(sc, fp)
    n = _node(sc, "prospektstaender/korpus", fp)
    for x in (0.01, fp.l - 0.01):
        L.rod(n, "chrom", (x, fp.d - 0.02, 0.0), (x, fp.d - 0.02, fp.h), 0.009, 4)
        L.rod(n, "chrom", (x, 0.02, 0.0), (x, fp.d - 0.06, fp.h * 0.85), 0.009, 4)
    for k in range(int(fp.raw.get("faecher", 4))):
        z = 0.22 + k * (fp.h - 0.35) / 3
        y = 0.02 + (fp.d - 0.08) * (z / (fp.h * 0.85))
        S = L.sub(0.0, y - 0.02, z, tilt_deg=-20)
        S.box(n, "chrom", 0.02, 0.0, 0.0, fp.l - 0.04, 0.012, 0.16, 0.003, 1)
        S.box(n, "chrom", 0.02, -0.06, -0.01, fp.l - 0.04, 0.07, 0.012, 0.003, 1)
    L.contact(geom.rect(0, 0, fp.l, fp.d), 0.15, 0.2)

    fw = p.fixtures["F22"]
    W = Local.of(sc, fw)
    n = _node(sc, "wandbild-kaffee/bild", fw)
    l, h = fw.l, fw.h
    W.box(n, "bild-rot", 0.0, 0.0, 0.0, l, fw.d, h, 0.01, 1, ao=None)
    sx, sz = l / 1.0, h / 0.75
    cup = geom.rect(0.30 * sx, 0.30 * sz, 0.52 * sx, 0.48 * sz).union(affinity.scale(Point(0.41 * sx, 0.30 * sz).buffer(0.11 * sx, 8), 1.0, 0.45))
    hc = Point(0.53 * sx, 0.40 * sz)
    handle = hc.buffer(0.055 * sx, 8).difference(hc.buffer(0.03 * sx, 8)).difference(geom.rect(0, 0, 0.52 * sx, h))
    saucer = affinity.scale(Point(0.41 * sx, 0.24 * sz).buffer(0.17 * sx, 12), 1.0, 0.2)
    W.flat(n, "regal-weiss", saucer, -0.002)
    W.flat(n, "regal-weiss", cup.union(handle), -0.003)
    W.flat(n, "holz-dunkel", affinity.scale(Point(0.41 * sx, 0.48 * sz).buffer(0.10 * sx, 10), 1.0, 0.22), -0.004)
    for bx, bz, rot in ((0.62, 0.20, 20), (0.70, 0.27, -30), (0.78, 0.18, 60), (0.66, 0.12, 10), (0.84, 0.27, -10), (0.74, 0.10, 40), (0.88, 0.15, 80)):
        W.flat(n, "holz-dunkel", affinity.rotate(affinity.scale(Point(bx * sx, bz * sz).buffer(0.028, 6), 1.0, 0.65), rot), -0.003)

    fu = p.fixtures["F23"]
    U = Local.of(sc, fu)
    n = _node(sc, "schirmstaender/korpus", fu)
    r = fu.l / 2
    U.lathe(n, "lack-schwarz", 0, 0, 0, [(0.0, 0.0), (r, 0.0), (r, fu.h), (r - 0.01, fu.h)], 12)
    for k, (mat, tilt, rot) in enumerate((("bild-rot", 8.0, 30.0), ("filz-gruen", -9.0, 200.0))):
        S = U.sub(0.03 * (1 if k else -1), 0.0, 0.05, rot_deg=rot, tilt_deg=tilt)
        S.lathe(n, mat, 0, 0, 0, [(0.0, 0.25), (0.045, 0.45), (0.04, 0.78), (0.0, 0.86)], 6)
        S.rod(n, "lack-schwarz", (0, 0, 0.86), (0, 0, 0.95), 0.008, 4)
    U.contact(Point(0, 0).buffer(r, 8), 0.2, 0.15)

    fz = p.fixtures["F24"]
    Z = Local.of(sc, fz)
    n = _node(sc, "zimmerpflanze/pflanze", fz)
    rp = f * float((fz.raw.get("topf") or {}).get("v", 0.40)) / 2
    Z.lathe(n, "terrakotta", 0, 0, 0, [(0.0, 0.0), (rp * 0.72, 0.0), (rp, 0.33), (rp + 0.015, 0.34), (rp + 0.015, 0.36), (rp - 0.02, 0.36)], 14)
    Z.lathe(n, "erde", 0, 0, 0.33, [(rp - 0.02, 0.0), (0.0, 0.0)], 14)
    ga = math.pi * (3 - math.sqrt(5))
    k = 0
    for sx, sy, sz in ((0.05, 0.02, fz.h * 0.62), (-0.04, 0.05, fz.h * 0.80), (0.0, -0.05, fz.h * 0.97)):
        Z.rod(n, "holz", (sx * 0.3, sy * 0.3, 0.34), (sx, sy, sz), 0.016, 5)
        for j in range(8):
            k += 1
            a = k * ga
            ll = 0.28 + 0.03 * ((k * 7) % 3)
            tip = (sx + ll * math.cos(a), sy + ll * math.sin(a), sz + 0.10 - 0.22 * ((k % 3) / 2))
            mid = (sx + 0.5 * ll * math.cos(a), sy + 0.5 * ll * math.sin(a), sz + 0.10)
            side = (-math.sin(a) * 0.035, math.cos(a) * 0.035)
            Z.poly(n, "blatt", [(sx, sy, sz), (mid[0] + side[0], mid[1] + side[1], mid[2]), tip, (mid[0] - side[0], mid[1] - side[1], mid[2])],
                   ao=(0.9 + 0.1 * (j % 2)), both=True)
    Z.contact(Point(0, 0).buffer(rp, 8), 0.25, 0.2)

    fb = p.fixtures["F25"]
    G = Local.of(sc, fb)
    n = _node(sc, "bleiglasbild/bild", fb)
    G.box(n, "lack-schwarz", 0.0, 0.0, 0.0, fb.l, fb.d, fb.h, 0.003, 1, ao=None)
    cols = ["bild-rot", "blume", "filz-gruen", "sepia", "blume", "bild-rot"]
    for i in range(2):
        for j in range(3):
            xa, xb = 0.02 + i * (fb.l - 0.04) / 2 + 0.006, 0.02 + (i + 1) * (fb.l - 0.04) / 2 - 0.006
            za, zb = 0.02 + j * (fb.h - 0.04) / 3 + 0.006, 0.02 + (j + 1) * (fb.h - 0.04) / 3 - 0.006
            G.flat(n, cols[i * 3 + j], geom.rect(xa, za, xb, zb), -0.002)

    fr = p.fixtures["F26"]
    Rr = Local.of(sc, fr)
    for q in fr.raw.get("rahmen", []):
        n = _node(sc, f"bilderwand/{q['id']}", fr)
        x, z, w, hh = q["x"] * f, q["z"] * f - fr.z, q["w"] * f, q["h"] * f
        Rr.box(n, "chrom", x, 0.0, z, w, fr.d, hh, 0.006, 1, ao=None)
        Rr.flat(n, "sepia", geom.rect(x + 0.035, z + 0.035, x + w - 0.035, z + hh - 0.035), -0.002)

    fc = p.fixtures["F27"]
    Cc = Local.of(sc, fc)
    n = _node(sc, "wanduhr/korpus", fc)
    Cc.box(n, "chrom", 0.0, 0.0, 0.0, fc.l, fc.d, fc.h, 0.01, 2, ao=None)
    Cc.flat(n, "lack-schwarz", geom.rect(0.025, 0.03, fc.l - 0.025, fc.h - 0.03), -0.002)


def matten(sc: Scene, p: Plan) -> None:
    for fid, cid in (("F28", "fussmatte-eingang"), ("F29", "laeufer-theke")):
        fx = p.fixtures.get(fid)
        if fx is None:
            continue
        L = Local.of(sc, fx)
        n = _node(sc, f"{cid}/matte", fx)
        L.box(n, "kissen", 0.0, 0.0, 0.001, fx.l, fx.d, (fx.h or 0.012), 0.004, 1, ao=None)


def _garland(sc: Scene, n, o: dict, y_in: float) -> None:
    xa, xb = sorted([float(o["from"][0]), float(o["to"][0])])
    zh = float(o["head"]) - 0.06
    L = Local.at(sc, (xa, y_in), 0.0)
    m = 16
    for i in range(m + 1):
        t = i / m
        x = 0.05 + t * (xb - xa - 0.10)
        z = zh - 0.10 * math.sin(math.pi * t)
        r = 0.035 if i % 2 == 0 else 0.028
        L.hull(n, "blume" if i % 2 == 0 else "blatt", [(x + r, 0, z), (x - r, 0, z), (x, r, z), (x, -r, z), (x, 0, z + r), (x, 0, z - r)], ao=None)


def _pumpkin(L: Local, n, x, y, z, r) -> None:
    prof = [(0.0, 0.0)] + [(r * math.sin(a), r * 0.75 * (1 - math.cos(a))) for a in np.linspace(0.4, math.pi - 0.4, 5)] + [(0.0, 1.5 * r)]
    L.lathe(n, "blume", x, y, z, prof, 10)
    L.rod(n, "blatt", (x, y, z + 1.45 * r), (x + 0.01, y, z + 1.45 * r + 0.04), 0.008, 4)


def schaufenster(sc: Scene, p: Plan) -> None:
    for fid, cid, oid, items in (("F35", "schaufensterdeko-2", "O2", 3), ("F36", "schaufensterdeko-1", "O1", 2)):
        fx = p.fixtures.get(fid)
        if fx is None:
            continue
        L = Local.of(sc, fx)
        n = _node(sc, f"{cid}/deko", fx)
        L.box(n, "holz-hell", 0.0, 0.0, 0.0, fx.l, fx.d, fx.h - 0.015, 0.008, 1)
        L.box(n, "filz-gruen", -0.01, -0.01, fx.h - 0.02, fx.l + 0.02, fx.d + 0.02, 0.02, 0.006, 1)
        for k in range(items):
            _pumpkin(L, n, fx.l * (k + 0.5) / items, fx.d * (0.4 + 0.2 * (k % 2)), fx.h, 0.07 + 0.02 * (k % 2))
        if items >= 3:
            for k, x in enumerate((fx.l * 0.33, fx.l * 0.70)):
                top = fx.h + 0.25 + 0.06 * k
                L.rod(n, "blatt", (x, fx.d * 0.7, fx.h), (x, fx.d * 0.7, top), 0.006, 4)
                S = L.sub(x, fx.d * 0.7 + 0.01, top, tilt_deg=-80)
                S.lathe(n, "blume", 0, 0, 0, [(0.0, 0.012), (0.06, 0.0), (0.0, 0.0)], 10)
        L.contact(geom.rect(0, 0, fx.l, fx.d), 0.22, 0.2)
        _garland(sc, n, p.openings[oid], float(p.room["A"][1]) + 0.05)


def zeitungsaufsteller(sc: Scene, p: Plan) -> None:
    fx = p.fixtures["F4"]
    l, d, h = fx.l, fx.d, fx.h
    L = Local.of(sc, fx)
    n = _node(sc, "zeitungsaufsteller/korpus", fx)
    L.box(n, "lack-schwarz", 0, 0, 0, l, d, 0.04, 0.008, 1)
    for xp in (0.0, l - 0.03):
        L.box(n, "lack-schwarz", xp, d / 2 - 0.015, 0, 0.03, 0.03, h, 0.006, 1)
    L.box(n, "lack-schwarz", 0, d / 2 - 0.02, h * 0.45, l, 0.04, h * 0.55, 0.01, 2)
    L.flat(n, "regal-weiss", geom.rect(0.03, h * 0.45 + 0.03, l - 0.03, h - 0.03), d / 2 - 0.022)
    L.contact(geom.rect(0, 0, l, d), 0.2, 0.2)


def slot_markers(sc: Scene, p: Plan) -> None:
    """--debug-slots: each slot's standing surface as a magenta plate (2 mm) with a small post at its front edge."""
    n = sc.node("verkaufsraum/slot-marker", "flat", source="plan", sigma=0.1)
    for q in sc.slot_geo:
        top = q + np.array([0.0, 0.0, 0.004])
        n.add_mesh("nav", sc.F.zone(np.vstack([q, top])), _BOX_TRIS)


_BOX_TRIS = np.array([[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
                      [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]])


# ----------------------------------------------------------------------------------------------- build

def build(sc: Scene, p: Plan, soffit_poly, soffit_z: float) -> None:
    theke(sc, p)
    brotregal(sc, p)
    gitterregal(sc, p)
    dosenregal(sc, p)
    kuehlschrank(sc, p)
    wuerfelregal(sc, p)
    sw_ende(sc, p)
    zeitungsaufsteller(sc, p)
    bistrotisch(sc, p, "F5", "bistrotisch-1")
    bistrotisch(sc, p, "F6", "bistrotisch-2")
    haengelampen(sc, p, soffit_poly, soffit_z)
    strahler(sc, p)
    einbauleuchten(sc, p)
    cafe_deko(sc, p)
    matten(sc, p)
    schaufenster(sc, p)


# fixtures standing on the floor: the walker collides with nav.glb only, so they are cut out of the walkable floor
STANDING = ("F1", "F2", "F3", "F4", "F5", "F6", "F7", "F13", "F14", "F15", "F17", "F18", "F20", "F21", "F23", "F24", "F35", "F36")


def footprint(fx: Fixture):
    if fx.centred:
        if fx.raw.get("form") == "quadratisch":
            return to_b_poly(fx, geom.rect(-fx.l / 2, -fx.d / 2, fx.l / 2, fx.d / 2))
        return Point(fx.xy).buffer(fx.l / 2, 16)
    return to_b_poly(fx, geom.rect(0, 0, fx.l, fx.d))


def obstacles(p: Plan, margin: float = 0.15) -> list:
    out = []
    for fid in STANDING:
        fx = p.fixtures.get(fid)
        if fx is None:
            continue
        out.append(footprint(fx).buffer(margin, join_style="mitre"))
        for ch in fx.raw.get("stuehle", []):
            pc = chair_centre(p, fx, ch)
            w, d = p.f * ch["size"]["l"], p.f * ch["size"]["d"]
            poly = affinity.rotate(geom.rect(-w / 2, -d / 2, w / 2, d / 2), float(ch["rot_deg"]), origin=(0, 0))
            out.append(affinity.translate(poly, pc[0], pc[1]).buffer(margin, join_style="mitre"))
    return out
