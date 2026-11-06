"""Facade details (round 3b) from the plan's `site.facade` block: stone-slip plinth with cap, glass-block panel, sandstone
window surrounds with keystones (pretzel relief), pilaster and corner quoins, roller-shutter window, upper-floor and
gable windows, the gable (LoD2 has a hip there) with the mural panel, slate on the front roof, gutter and downpipes,
cellar grilles, the projecting sign, the porch handrail.

All features hang on `WallFrame`s (a wall line in frame B: `s` along the wall to the viewer's right, `e` outwards, `z`
above ±0.00), so the same code places them on the street face (L5) and on the gable (L7). Shop lettering (gable text,
keystone inscription, sign name) with `lettering=True` (the build default since the owners' OK, ADR 0044; `--no-lettering` switches it off):
without it, neutral graphics only (oven arch and loaf). Pure numpy/shapely; deterministic (seeds are hashes of fixed strings).
"""
from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass

import numpy as np
from shapely import affinity
from shapely.geometry import LineString, Point, Polygon, box as sbox

from . import geom
from .scene import Scene

PLINTH_FLOOR = -1.35     # the slip pattern stops here (below: plain plinth, under the pavement anyway)


def h01(*key) -> float:
    """Deterministic pseudo-random number in [0, 1) from a key (no Python hash randomisation)."""
    d = hashlib.sha256("|".join(map(str, key)).encode()).digest()
    return int.from_bytes(d[:8], "big") / 2 ** 64


def v(d, default=None):
    """Plan value: {v, sigma_m, source} -> v; plain numbers pass through."""
    if isinstance(d, dict):
        return float(d["v"])
    return default if d is None else float(d)


# ----------------------------------------------------------------------------------------------- wall frames

@dataclass
class WallFrame:
    """A wall line in frame B: p0 (xy at s = 0), u (unit along the wall, the viewer's right when facing it), n (unit
    outward normal, = u × up). Local coordinates (s, e, z): s along u, e outwards, z above ±0.00."""
    p0: np.ndarray
    u: np.ndarray
    n: np.ndarray

    @classmethod
    def of_line(cls, a, b, s0_at=None) -> "WallFrame":
        """Wall through a -> b (frame B) with u = unit(b − a) and n = u × up (right of a -> b seen from above)."""
        a, b = np.asarray(a, np.float64), np.asarray(b, np.float64)
        u = (b - a) / np.linalg.norm(b - a)
        p0 = a if s0_at is None else np.asarray(s0_at, np.float64)
        return cls(p0, u, np.array([u[1], -u[0]]))

    def s_of(self, xy) -> float:
        return float((np.asarray(xy, np.float64) - self.p0) @ self.u)

    def to_b(self, s, e, z) -> np.ndarray:
        s, e, z = (np.atleast_1d(np.asarray(a, np.float64)) for a in (s, e, z))
        s, e, z = np.broadcast_arrays(s, e, z)
        xy = self.p0 + s[:, None] * self.u + e[:, None] * self.n
        return np.column_stack([xy, z])

    def xy(self, s, e) -> np.ndarray:
        return self.to_b(s, e, 0.0)[:, :2]

    def put(self, sc: Scene, node: geom.Node, mat: str, V: np.ndarray, T: np.ndarray, order: str = "sez") -> None:
        """Solid given in local columns `order` (e.g. 's','e','z'); triangles keep facing outwards."""
        V = np.asarray(V, np.float64)
        T = np.asarray(T, np.int64).reshape(-1, 3)
        if not len(T):
            return
        col = {c: V[:, i] for i, c in enumerate(order)}
        B = self.to_b(col["s"], col["e"], col["z"])
        basis = {"s": (self.u[0], self.u[1], 0.0), "e": (self.n[0], self.n[1], 0.0), "z": (0.0, 0.0, 1.0)}
        if np.linalg.det(np.array([basis[c] for c in order])) < 0:
            T = T[:, [0, 2, 1]]
        node.add_mesh(mat, sc.F.zone(B), T)

    def face(self, sc: Scene, node: geom.Node, mat: str, poly_sz, e: float) -> None:
        """Flat polygon(s) in (s, z) at offset e, facing outwards."""
        node.add_planar(mat, poly_sz, lambda v2: sc.F.zone(self.to_b(v2[:, 0], e, v2[:, 1])),
                        sc.F.zone_dir(np.array([self.n[0], self.n[1], 0.0])))

    def block(self, sc, node, mat, s0, s1, z0, z1, e0, e1, r=0.006) -> None:
        V, T = geom.rounded_box_local(s1 - s0, e1 - e0, z1 - z0, r, segs=1)
        self.put(sc, node, mat, V + np.array([s0, e0, z0]), T, "sez")

    def relief(self, sc, node, mat, poly_sz, e0: float, depth: float) -> None:
        """Extrude (s, z) polygon(s) (holes allowed) outwards from e0 by depth (front + sides)."""
        for kind, vv, t, _ in geom.prism_parts(poly_sz, e0, e0 + depth):
            if kind != "bottom":
                self.put(sc, node, mat, vv, t, "sze")

    def reveal(self, sc: Scene, node: geom.Node, mat: str, s0, s1, z0, z1, depth) -> None:
        """Window/panel reveal into the wall (e from 0 to −depth): sill, head, both jambs."""
        q = Polygon(self.xy([s0, s1, s1, s0], [0.0, 0.0, -depth, -depth]))
        sc.hface(node, mat, q, z0, True)
        sc.hface(node, mat, q, z1, False)
        a, b = self.xy([s0, s0], [0.0, -depth])
        sc.vrect(node, mat, a, b, z0, z1, left=False)          # jamb at s0 faces +u
        a, b = self.xy([s1, s1], [0.0, -depth])
        sc.vrect(node, mat, a, b, z0, z1, left=True)           # jamb at s1 faces −u


def street_frame() -> WallFrame:
    """L5 (y = 0): s = frame-B x, outward = −y."""
    return WallFrame(np.array([0.0, 0.0]), np.array([1.0, 0.0]), np.array([0.0, -1.0]))


def gable_frame(p) -> WallFrame:
    """L6/L7 (SSW gable): s = 0 at the street corner, s < 0 towards the back, outward ≈ −x."""
    e = next(e for e in p.raw["site"]["building"]["edges"] if e["id"] == "L7")
    a, b = np.asarray(e["to"], np.float64), np.asarray(e["from"], np.float64)       # back -> street
    u = (b - a) / np.linalg.norm(b - a)
    t = -a[1] / u[1]
    return WallFrame(a + t * u, u, np.array([u[1], -u[0]]))


# ----------------------------------------------------------------------------------------------- plinth cap

def plinth_cap_spans(fac: dict, x_end: float) -> list[tuple[float, float]]:
    """Street-face spans of the plinth cap from the SSW corner to the porch, open over the Backstube entrance niche
    (from its rounded left edge to the corner post right of it). Pure."""
    b = fac.get("backstube_eingang")
    if not b:
        return [(0.0, x_end)]
    a = v(b["x0"]) - v(b["kante_links_r"])
    c = v(b["x1"]) + v(b["eckpfosten"]["b"]) / 2
    return [(0.0, a), (c, x_end)]


# ----------------------------------------------------------------------------------------------- keystones

def keystone_half_width(k: dict, z0: float, z1: float):
    """Half width of a keystone at height z: a trapezoid from `w_bottom` (at z0) to `w_top` (at z1); a plain `w` (older
    plans) gives a rectangle. Pure."""
    wb = v(k.get("w_bottom"), v(k["w"]))
    wt = v(k.get("w_top"), v(k["w"]))
    return lambda z: (wb + (wt - wb) * min(max((z - z0) / (z1 - z0), 0.0), 1.0)) / 2


KEYSTONE_MARGIN = 0.025  # free stone between the inscription and the slanted sides


def inscription_polys(k: dict, z0: float, z1: float, half_w) -> list:
    """The keystone's inscription lines (plan `inschrift`, top line first; old plans: „H.H.“ over „1933“) as outlines
    centred on s = 0: the lines stacked from the bottom up with a gap of 0.3 × their height, each shrunk to fit the
    stone at its height (KEYSTONE_MARGIN from the slanted sides). Pure (fonts from the pinned matplotlib)."""
    from .lettering import text_polys
    lines = k.get("inschrift") or [{"text": "H.H.", "h": 0.10}, {"text": "1933", "h": 0.07}]
    out, base = [], z0 + 0.06
    for ln in reversed(lines):
        t = text_polys(ln["text"], v(ln["h"]), fraktur=ln.get("schrift") == "fraktur")
        bx0, by0, bx1, by1 = t.bounds
        t = affinity.translate(t, 0.0, base - by0)                        # descenders stay inside the stone
        lim = 2 * (half_w(base) - KEYSTONE_MARGIN)
        if bx1 - bx0 > lim:
            t = affinity.scale(t, lim / (bx1 - bx0), lim / (bx1 - bx0), origin=(0.0, base))
        out.insert(0, t)
        base = t.bounds[3] + 0.3 * v(ln["h"])
    if out and out[0].bounds[3] > z1 - 0.03:
        raise ValueError(f"inscription of {k.get('id')} does not fit the keystone ({out[0].bounds[3]:.3f} > {z1 - 0.03:.3f})")
    return out


# ----------------------------------------------------------------------------------------------- pure patterns

def ashlar(shape, rows: list[float], lengths: tuple[float, ...], joint: float, seed: str, light_share: float = 0.4,
           top: float | None = None) -> list[tuple[Polygon, int]]:
    """Stone slips in running bond covering `shape` ((s, z) polygon): rows of the given heights (cycled) from `top`
    downwards, stone lengths picked from `lengths` per stone (seeded), each stone shrunk by joint/2 and clipped to the
    shape. Returns (stone polygon, kind) with kind 1 = light, 0 = red."""
    out = []
    x0, z0, x1, z1 = shape.bounds
    z = z1 if top is None else top
    r = 0
    hj = joint / 2
    while z > z0 + 1e-6:
        h = rows[r % len(rows)]
        s = x0 - h01(seed, "row", r) * max(lengths)
        k = 0
        while s < x1:
            L = lengths[int(h01(seed, r, k) * len(lengths)) % len(lengths)]
            if s + L > x0:
                cell = sbox(s + hj, z - h + hj, s + L - hj, z - hj)
                part = shape.intersection(cell)
                for q in geom.polys(part):
                    if q.area > 0.002:
                        out.append((q, 1 if h01(seed, "c", r, k) < light_share else 0))
            s += L
            k += 1
        z -= h
        r += 1
    return out


def basket_weave(s0, z0, s1, z1, cell: float, joint: float, seed: str) -> list[tuple[tuple[float, float, float, float], int]]:
    """Glass blocks in basket weave (pairs of 2:1 blocks, horizontal and vertical alternating per cell), clipped to the
    panel. kind: 0 plain, 1 light, 2 green, 3 blue (a few accent blocks like the real wall)."""
    out = []
    hj = joint / 2
    nx, nz = int(math.ceil((s1 - s0) / cell - 1e-9)), int(math.ceil((z1 - z0) / cell - 1e-9))
    for i in range(nx):
        for j in range(nz):
            cs, cz = s0 + i * cell, z0 + j * cell
            halves = ([(cs, cz, cs + cell, cz + cell / 2), (cs, cz + cell / 2, cs + cell, cz + cell)] if (i + j) % 2 == 0 else
                      [(cs, cz, cs + cell / 2, cz + cell), (cs + cell / 2, cz, cs + cell, cz + cell)])
            for k, (a, b, c, d) in enumerate(halves):
                a, b, c, d = a + hj, b + hj, min(c, s1) - hj, min(d, z1) - hj
                if c - a < 0.03 or d - b < 0.03:
                    continue
                r = h01(seed, i, j, k)
                kind = 2 if r < 0.025 else 3 if r < 0.04 else 1 if r < 0.30 else 0
                out.append(((a, b, c, d), kind))
    return out


def chaikin(pts: np.ndarray, n: int = 3) -> np.ndarray:
    p = np.asarray(pts, np.float64)
    for _ in range(n):
        q = [p[0]]
        for a, b in zip(p[:-1], p[1:]):
            q += [0.75 * a + 0.25 * b, 0.25 * a + 0.75 * b]
        q.append(p[-1])
        p = np.array(q)
    return p


def pretzel(radius: float, ring: bool = True):
    """Pretzel outline (belly at the bottom, two loops on top, crossed arms) inside a ring, as one polygon (holes)
    centred on (0, 0) and fitting a circle of `radius`."""
    P = np.array([(0.45, -0.74), (0.15, -0.22), (-0.25, 0.36), (-0.58, 0.60), (-0.88, 0.45), (-0.93, 0.0),
                  (-0.74, -0.48), (-0.30, -0.78), (0.0, -0.84), (0.30, -0.78), (0.74, -0.48), (0.93, 0.0),
                  (0.88, 0.45), (0.58, 0.60), (0.25, 0.36), (-0.15, -0.22), (-0.45, -0.74)])
    k = 0.72 if ring else 0.95
    line = LineString(chaikin(P, 3) * k)
    shape = line.buffer(0.10 * k, quad_segs=2, cap_style="round")
    if ring:
        shape = shape.union(Point(0, 0).buffer(1.0, quad_segs=6).difference(Point(0, 0).buffer(0.90, quad_segs=6)))
    shape = shape.simplify(0.012)
    return affinity.scale(shape, radius, radius, origin=(0, 0))


PLINTH_TONES = ("sockel", "sockel-grau", "sockel-hell")


def plinth_tone(q: Polygon, kind: int, seed: str) -> str:
    """Three muted plinth tones (Street View: pinkish red, grey-pink, buff, low contrast): light stones stay buff,
    the others split about evenly into pinkish red and grey-pink by a hash of the stone's position."""
    if kind == 1:
        return "sockel-hell"
    c = q.centroid
    return "sockel-grau" if h01(seed, "ton", round(c.x, 2), round(c.y, 2)) < 0.45 else "sockel"


# ----------------------------------------------------------------------------------------------- the build

@dataclass
class Gable:
    """The SSW end as a gable: roof heights z(x, y) = min(front, back plane), ridge from x = 0 to x_cut.

    `corner`: the back corner of the gable wall is chamfered (L8) and LoD2 puts a hip over the chamfer that starts at
    eave height. The gable's back slope then runs from the ridge down to that hip's eave corner (`corner` = the
    triangle ridge end / hip top / hip eave corner on `corner_plane`), so both gable eaves sit at the same height as in
    the Street View photo (the ridge stays where LoD2 has it, off-centre towards the back; the back slope is steeper).
    `hip` / `hip_plane`: the kept LoD2 hip face over the chamfer."""
    front: np.ndarray       # (a, b, c): z = a + b x + c y
    back: np.ndarray
    x_cut: float
    eave: float
    corner: Polygon | None = None
    corner_plane: np.ndarray | None = None
    hip: Polygon | None = None
    hip_plane: np.ndarray | None = None

    def z(self, xy) -> np.ndarray:
        xy = np.atleast_2d(np.asarray(xy, np.float64))
        f = self.front[0] + self.front[1] * xy[:, 0] + self.front[2] * xy[:, 1]
        b = self.back[0] + self.back[1] * xy[:, 0] + self.back[2] * xy[:, 1]
        out = np.minimum(f, b)
        for poly, pl in ((self.hip, self.hip_plane), (self.corner, self.corner_plane)):
            if poly is None:
                continue
            inside = np.array([poly.buffer(1e-3).contains(Point(q)) for q in xy])
            out = np.where(inside, pl[0] + pl[1] * xy[:, 0] + pl[2] * xy[:, 1], out)
        return out

    def ridge_y(self, x: float) -> float:
        a = self.front - self.back
        return float(-(a[0] + a[1] * x) / a[2])


def _fit_plane(pts: np.ndarray) -> np.ndarray:
    A = np.column_stack([np.ones(len(pts)), pts[:, 0], pts[:, 1]])
    return np.linalg.lstsq(A, pts[:, 2], rcond=None)[0]


def _clip_x(ring: np.ndarray, x_min: float) -> np.ndarray:
    """Sutherland–Hodgman: keep the part of a planar 3-D polygon with x ≥ x_min."""
    out = []
    n = len(ring)
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        ia, ib = a[0] >= x_min, b[0] >= x_min
        if ia:
            out.append(a)
        if ia != ib:
            t = (x_min - a[0]) / (b[0] - a[0])
            out.append(a + t * (b - a))
    return np.array(out) if len(out) >= 3 else np.zeros((0, 3))


def _normal(ring: np.ndarray) -> np.ndarray:
    from .context import newell
    nn = newell(ring)
    return nn if nn[2] >= 0 else -nn


def make_gable(walls_b: list[np.ndarray], roofs_b: list[np.ndarray]) -> tuple[list[np.ndarray], list[np.ndarray], Gable] | None:
    """Turn the LoD2 hip at the SSW end (x ≈ 0) into a gable: the hip faces go, the front and back roof planes run
    on to the end wall, and the end walls (L6/L7, the diagonal L8) get raking tops. Returns (walls, roofs, gable)."""
    hips = [r for r in roofs_b if abs(_normal(r)[0]) > 0.5 and r[:, 0].min() < 6.0]
    if not hips:
        return None
    x_cut = float(max(r[:, 0].max() for r in hips))
    planes = []
    for sgn in (-1, 1):
        faces = [r for r in roofs_b if (n := _normal(r))[1] * sgn > 0.5 and abs(n[0]) < 0.3 and r[:, 0].min() < x_cut + 0.5]
        if not faces:
            return None
        planes.append(_fit_plane(np.concatenate(faces)))
    eave = float(min(w[:, 2].max() for w in walls_b if abs(_normal(w)[2]) < 0.25))      # gable walls reach higher
    g = Gable(planes[0], planes[1], x_cut, eave)
    roofs = []
    for r in roofs_b:                                          # the hip over a chamfered back corner stays (Gable doc)
        nn = _normal(r) / np.linalg.norm(_normal(r))
        if len(r) == 3 and nn[0] < -0.3 and nn[1] > 0.3 and r[:, 0].max() <= x_cut + 1e-6:
            top = r[np.argmax(r[:, 2])]
            low = r[r[:, 2] < top[2] - 0.5]
            if len(low) != 2:
                continue
            c = low[np.argmin(low[:, 0])]                      # eave corner on the gable wall line
            y_r = g.ridge_y(float(c[0]))
            r0 = np.array([c[0], y_r, float(g.z(np.array([[c[0], y_r]]))[0])])
            A = np.column_stack([np.ones(3), [r0[0], top[0], c[0]], [r0[1], top[1], c[1]]])
            if abs(np.linalg.det(A)) < 1e-6:
                continue
            g.corner_plane = np.linalg.solve(A, np.array([r0[2], top[2], c[2]]))
            g.corner = Polygon([r0[:2], top[:2], c[:2]])
            g.hip, g.hip_plane = Polygon(r[:, :2]), _fit_plane(r)
            roofs.append(r)
            break
    for r in roofs_b:
        if r[:, 0].max() <= x_cut + 1e-6:
            continue                                           # hip faces and everything left of the cut
        c = _clip_x(r, x_cut) if r[:, 0].min() < x_cut else r
        if len(c):
            roofs.append(c)
    walls = []
    for w in walls_b:
        nn = _normal(w)
        if abs(nn[2]) > 0.25 or w[:, 0].max() > x_cut - 0.01:
            walls.append(w)
            continue
        lo = w[:, 2].min()
        bot = w[w[:, 2] <= lo + 0.05]
        if len(bot) < 2:
            walls.append(w)
            continue
        p0, p1 = bot[0, :2], bot[-1, :2]
        top = [p1, p0]
        d0, d1 = (g.front - g.back) @ [1, p0[0], p0[1]], (g.front - g.back) @ [1, p1[0], p1[1]]
        if d0 * d1 < 0:                                        # the ridge crosses this wall
            t = d0 / (d0 - d1)
            top = [p1, p0 + t * (p1 - p0), p0]
        ring = [np.array([*p0, lo]), np.array([*p1, lo])] + [np.array([*q, float(g.z(q)[0])]) for q in top]
        walls.append(np.array(ring))
    return walls, roofs, g


def gable_roof_regions(footprint: Polygon, g: Gable) -> tuple[Polygon, Polygon]:
    """Frame-B xy regions of the new front and back roof planes left of the cut."""
    left = footprint.intersection(sbox(-50, -50, g.x_cut, 50))
    y0, y1 = g.ridge_y(-50), g.ridge_y(g.x_cut + 50)
    front_hp = Polygon([(-50, -50), (g.x_cut + 50, -50), (g.x_cut + 50, y1), (-50, y0)])
    back = left.difference(front_hp)
    for poly in (g.corner, g.hip):                             # drawn on their own planes (Gable doc)
        if poly is not None:
            back = back.difference(poly)
    return left.intersection(front_hp), back


class Facade:
    """Builds the facade details onto the scene (call after the LoD2 walls; `cutters()` before them)."""

    def __init__(self, p, fac: dict, lettering: bool = False):
        self.p, self.f, self.lettering = p, fac, lettering
        self.st = street_frame()
        self.gb = gable_frame(p)
        self.sockel_top = v(fac["sockel"]["top"])

    # ---- holes in the LoD2 walls (frame-B boxes, see exterior.Cutter)
    def openings(self) -> list[tuple[float, float, float, float, float, float, float]]:
        """(x0, x1, y0, y1, z0, z1, depth) boxes for every hole the facade needs."""
        f, out = self.f, []
        for key in ("glasbausteine", "fenster_rollladen"):
            o = f[key]
            out.append((o["from"][0], o["to"][0], -0.3, 0.3, v(o["sill"]), v(o["head"]), v(o["recess"])))
        sz = f["obergeschoss_fenster_size"]
        for w in f["obergeschoss_fenster"]:
            c, half = v(w["x"]), v(sz["w"]) / 2
            out.append((c - half, c + half, -0.3, 0.3, v(sz["sill"]), v(sz["head"]), 0.12))
        for w in f["giebel_fenster"]:
            c, half = v(w["y"]), v(w["w"]) / 2
            out.append((-0.3, 0.4, c - half, c + half, v(w["sill"]), v(w["head"]), 0.12))
        return out

    def build(self, sc: Scene, g: Gable | None, porch: dict) -> None:
        self._plinth_cap(sc)
        self._glass_blocks(sc)
        self._roller_window(sc)
        self._surrounds(sc)
        self._pilaster_and_quoins(sc)
        self._upper_windows(sc)
        self._cellar_grilles(sc)
        self._gutter_and_pipes(sc)
        self._sign(sc)
        self._handrail(sc, porch)
        self._pillar_cladding(sc, porch)
        if g is not None:
            self._gable(sc, g)

    # ---- plinth slips (called by exterior.lod2_wall for the street wall)
    def plinth(self, sc: Scene, node: geom.Node, p0, p1, lo_shape) -> None:
        """Stone slips on the street wall's plinth band: joint colour as the base, stones 8 mm proud."""
        p0, p1 = np.asarray(p0, np.float64), np.asarray(p1, np.float64)
        d = (p1 - p0) / np.linalg.norm(p1 - p0)
        nl = np.array([-d[1], d[0]])
        sc.vface(node, "sockel-fuge", p0, p1, lo_shape, True)
        band = lo_shape.intersection(sbox(-1e4, PLINTH_FLOOR, 1e4, self.sockel_top))
        stones = ashlar(band, self.f["sockel"]["rows"], (0.26, 0.34, 0.42, 0.30, 0.38), 0.012, "sockel", 0.3,
                        top=self.sockel_top)
        for mat in PLINTH_TONES:
            sc.vface(node, mat, p0 + 0.008 * nl, p1 + 0.008 * nl, [q for q, k in stones if plinth_tone(q, k, "sockel") == mat], True)

    def _plinth_cap(self, sc: Scene) -> None:
        n = sc.node("fassade/aussenwand/abdeckplatte", "ext", "fassade/aussenwand", source="photo", sigma=0.1)
        top, h, pr = self.sockel_top, v(self.f["sockel"]["cap_h"]), v(self.f["sockel"]["cap_proj"])
        x_end = float(self.p.openings["O3"]["from"][0])
        for a, b in plinth_cap_spans(self.f, x_end):           # interrupted by the Backstube entrance niche
            self.st.block(sc, n, "abdeckplatte", a, b, top - h, top, 0.0, pr, 0.008)

    # ---- glass-block panel
    def _glass_blocks(self, sc: Scene) -> None:
        o = self.f["glasbausteine"]
        n = sc.node("fassade/glasbausteine", "ext", source="photo", sigma=o["width"]["sigma_m"])
        sc.styled.add(n.name)
        s0, s1, z0, z1, rec = o["from"][0], o["to"][0], v(o["sill"]), v(o["head"]), v(o["recess"])
        st = self.st
        st.reveal(sc, n, "fassade", s0, s1, z0, z1, rec)
        fr = 0.035                                             # light metal frame inside the reveal
        for a, b, c, d in ((s0, z0, s0 + fr, z1), (s1 - fr, z0, s1, z1), (s0, z0, s1, z0 + fr), (s0, z1 - fr, s1, z1)):
            st.block(sc, n, "chrom", a, c, b, d, -rec, -rec + 0.03, 0.004)
        a0, a1, b0, b1 = s0 + fr, s1 - fr, z0 + fr, z1 - fr
        st.face(sc, n, "glas-fuge", sbox(a0, b0, a1, b1), -rec)
        mats = ("glasbaustein", "glasbaustein-hell", "glasbaustein-gruen", "glasbaustein-blau")
        e0, e1, ins = -rec, -rec + 0.028, 0.012
        for (a, b, c, d), kind in basket_weave(a0, b0, a1, b1, v(o["raster"]), 0.014, "glasbausteine"):
            pts = np.array([[a, e0, b], [c, e0, b], [c, e0, d], [a, e0, d],
                            [a + ins, e1, b + ins], [c - ins, e1, b + ins], [c - ins, e1, d - ins], [a + ins, e1, d - ins]])
            V, T = geom.convex_solid(pts)
            st.put(sc, n, mats[kind], V, T, "sez")

    # ---- wide window with a closed roller shutter
    def _roller_window(self, sc: Scene) -> None:
        o = self.f["fenster_rollladen"]
        n = sc.node("fassade/fenster-rollladen", "ext", source="photo", sigma=o["width"]["sigma_m"])
        sc.styled.add(n.name)
        s0, s1, z0, z1, rec = o["from"][0], o["to"][0], v(o["sill"]), v(o["head"]), v(o["recess"])
        st = self.st
        st.reveal(sc, n, "fassade", s0, s1, z0, z1, rec)
        st.face(sc, n, "rollladen", sbox(s0, z0, s1, z1), -rec)
        k, z = 0, z0 + 0.06
        while z < z1 - 0.02:                                   # slat joints
            st.face(sc, n, "rollladen-fuge", sbox(s0, z, s1, z + 0.008), -rec + 0.002)
            z += 0.055
            k += 1
        st.block(sc, n, "putz-weiss", s0 - 0.04, s1 + 0.04, z0 - 0.05, z0, -0.02, 0.05, 0.006)    # sill

    # ---- sandstone surrounds + keystones of the shop windows
    def _surrounds(self, sc: Scene) -> None:
        f, st = self.f, self.st
        gw = f["gewaende"]
        band, course, head_h, pr = v(gw["band"]), v(gw["course"]), v(gw["head_h"]), v(gw["proj"])
        n = sc.node("fassade/fenstergewaende", "ext", source="photo", sigma=gw["band"]["sigma_m"])
        keys = {k["opening"]: k for k in f["schlusssteine"]}
        spans = {oid: sorted([float(self.p.openings[oid]["from"][0]), float(self.p.openings[oid]["to"][0])]) for oid in ("O1", "O2")}
        half_pier = (spans["O2"][0] - spans["O1"][1]) / 2 - 0.012      # the two surrounds share the pier: no overlap
        for oid in ("O1", "O2"):
            o = self.p.openings[oid]
            x0, x1 = spans[oid]
            z0, z1 = o["sill"], o["head"]
            lim = {-1: half_pier if oid == "O2" else 9.0, 1: half_pier if oid == "O1" else 9.0}
            m = max(1, round((z1 - z0) / course))
            hc = (z1 - z0) / m
            for side, edge in ((-1, x0), (1, x1)):
                for i in range(m):
                    w = min(band + (0.06 if (i + (side > 0)) % 2 == 0 else -0.05), lim[side])
                    a, b = (edge - w, edge) if side < 0 else (edge, edge + w)
                    mat = "sandstein-hell" if h01(oid, side, i) < 0.25 else "sandstein-rot"
                    st.block(sc, n, mat, a, b, z0 + i * hc + 0.004, z0 + (i + 1) * hc - 0.004, 0.0, pr)
            k = keys[oid]
            kw, kh = v(k["w"]), v(k["h"])
            kz0, kz1 = z1 - 0.02, z1 - 0.02 + kh
            half_w = keystone_half_width(k, kz0, kz1)       # trapezoid (Street View 2026-11-06: wider at the top)
            cx = (x0 + x1) / 2
            left, right = x0 - min(band + 0.06, lim[-1]), x1 + min(band + 0.06, lim[1])
            # head row: 3 stones each side of the keystone, the ones next to it light (as on the real facade); the
            # stone next to the keystone follows its slanted side
            za, zb = z1 + 0.004, z1 + head_h
            for a_, b_, sgn in ((left, cx - kw / 2, -1), (cx + kw / 2, right, 1)):
                xs = np.linspace(a_, b_, 4)
                for j in range(3):
                    near = (j == 2) if sgn < 0 else (j == 0)
                    mat = "sandstein-hell" if near else "sandstein-rot"
                    if near:
                        ea, eb = cx + sgn * (half_w(za) + 0.004), cx + sgn * (half_w(zb) + 0.004)
                        outer = xs[j] + 0.004 if sgn < 0 else xs[j + 1] - 0.004
                        st.relief(sc, n, mat, Polygon([(outer, za), (ea, za), (eb, zb), (outer, zb)]), 0.0, pr)
                    else:
                        st.block(sc, n, mat, xs[j] + 0.004, xs[j + 1] - 0.004, za, zb, 0.0, pr)
            kn = sc.node(f"fassade/{k['id']}", "ext", source="photo", sigma=k["w"]["sigma_m"])
            sc.styled.add(kn.name)
            front = pr + 0.015
            st.relief(sc, kn, "sandstein-rot", Polygon([(cx - half_w(kz0), kz0), (cx + half_w(kz0), kz0),
                                                       (cx + half_w(kz1), kz1), (cx - half_w(kz1), kz1)]), 0.0, front)
            if k.get("motiv") == "brezel":
                shape = affinity.translate(pretzel(min(kw, kh) * 0.40), cx, (kz0 + kz1) / 2)
                st.relief(sc, kn, "sandstein-relief", shape, front, 0.018)
            elif self.lettering:
                tn = sc.node(f"fassade/{k['id']}/schrift", "ext", f"fassade/{k['id']}", source="photo", sigma=0.1)
                for t in inscription_polys(k, kz0, kz1, half_w):
                    st.relief(sc, tn, "sandstein-relief", affinity.translate(t, cx, 0.0), front, 0.010)

    # ---- pilaster beside window 1 and quoins at the SSW corner
    def _pilaster_and_quoins(self, sc: Scene) -> None:
        f, st, gb = self.f, self.st, self.gb
        n = sc.node("fassade/fenstergewaende/quader", "ext", "fassade/fenstergewaende", source="photo", sigma=0.15)
        top = self._eave() - 0.14
        z0 = self.sockel_top
        L = f["lisene"]
        c, w, course = v(L["x"]), v(L["width"]), v(L["course"])
        m = max(1, round((top - z0) / course))
        hc = (top - z0) / m
        for i in range(m):
            mat = "sandstein-rot"                                        # round 4: solid red sandstone
            st.block(sc, n, mat, c - w / 2, c + w / 2, z0 + i * hc + 0.004, z0 + (i + 1) * hc - 0.004, 0.0, 0.03)
        q = f["eckquader"]
        lo, sh, course = v(q["long"]), v(q["short"]), v(q["course"])
        m = max(1, round((top - z0) / course))
        hc = (top - z0) / m
        for i in range(m):
            za, zb = z0 + i * hc + 0.004, z0 + (i + 1) * hc - 0.004
            a, b = (lo, sh) if i % 2 == 0 else (sh, lo)
            mat = "sandstein-rot"
            st.block(sc, n, mat, -0.03, a, za, zb, 0.0, 0.03)              # street face, wraps the corner
            gb.block(sc, n, mat, -b, 0.0, za, zb, 0.0, 0.03)               # gable face

    def _eave(self) -> float:
        return float(self.p.raw["site"]["building"]["eaves"]["v"])

    # ---- windows with reveal, white frame, dark glass, sandstone frame and sill
    def _window(self, sc, node, wf: WallFrame, s0, s1, z0, z1, depth=0.12, cornice=False) -> None:
        wf.reveal(sc, node, "fassade", s0, s1, z0, z1, depth)
        fr = 0.06
        e0, e1 = -depth, -depth + 0.06
        for a, b, c, d in ((s0, s0 + fr, z0, z1), (s1 - fr, s1, z0, z1), (s0, s1, z0, z0 + fr), (s0, s1, z1 - fr, z1)):
            wf.block(sc, node, "regal-weiss", a, b, c, d, e0, e1, 0.004)
        sm = (s0 + s1) / 2
        wf.block(sc, node, "regal-weiss", sm - 0.03, sm + 0.03, z0 + fr, z1 - fr, e0, e1 - 0.01, 0.004)
        wf.face(sc, node, "fensterglas", sbox(s0, z0, s1, z1), e0 + 0.02)
        bw = 0.13                                               # sandstone frame + sill
        for a, b, c, d in ((s0 - bw, s0, z0, z1 + bw), (s1, s1 + bw, z0, z1 + bw), (s0, s1, z1, z1 + bw)):
            wf.block(sc, node, "sandstein-rot", a, b, c, d, 0.0, 0.03)
        wf.block(sc, node, "sandstein-rot", s0 - bw - 0.05, s1 + bw + 0.05, z0 - 0.07, z0, 0.0, 0.07)
        if cornice:
            wf.block(sc, node, "sandstein-rot", s0 - bw - 0.06, s1 + bw + 0.06, z1 + bw, z1 + bw + 0.09, 0.0, 0.08)

    def _upper_windows(self, sc: Scene) -> None:
        f = self.f
        sz = f["obergeschoss_fenster_size"]
        n = sc.node("fassade/obergeschoss-fenster", "ext", source="photo", sigma=sz["w"]["sigma_m"])
        sc.styled.add(n.name)
        for w in f["obergeschoss_fenster"]:
            c, half = v(w["x"]), v(sz["w"]) / 2
            self._window(sc, n, self.st, c - half, c + half, v(sz["sill"]), v(sz["head"]))
        for w in f["giebel_fenster"]:
            c, half = -v(w["y"]), v(w["w"]) / 2                 # gable frame: s = −y
            self._window(sc, n, self.gb, c - half, c + half, v(w["sill"]), v(w["head"]), cornice=True)

    # ---- cellar grilles in the plinth
    def _cellar_grilles(self, sc: Scene) -> None:
        f, st = self.f, self.st
        n = sc.node("fassade/kellergitter", "ext", source="mesh", sigma=0.15)
        sc.styled.add(n.name)
        zc = v(f["kellergitter_z"])
        w, h = f["kellergitter_size"]["w"], f["kellergitter_size"]["h"]
        for g in f["kellergitter"]:
            c = v(g["x"])
            a, b, z0, z1 = c - w / 2, c + w / 2, zc - h / 2, zc + h / 2
            st.face(sc, n, "schatten", sbox(a, z0, b, z1), 0.010)
            for aa, bb, cc, dd in ((a, a + 0.025, z0, z1), (b - 0.025, b, z0, z1), (a, b, z0, z0 + 0.025), (a, b, z1 - 0.025, z1)):
                st.block(sc, n, "lack-schwarz", aa, bb, cc, dd, 0.010, 0.025, 0.003)
            for k in range(2):                                   # two mirrored scrolls as a flat ornament: )(
                cx = a + w * (0.3 + 0.4 * k)
                t0 = -2.6 if k == 0 else math.pi - 2.6
                arc = LineString([(cx + 0.06 * math.cos(t), zc + 0.07 * math.sin(t)) for t in np.linspace(t0, t0 + 5.2, 9)])
                st.relief(sc, n, "lack-schwarz", arc.buffer(0.009, quad_segs=1), 0.010, 0.012)

    # ---- gutter (street eave) and downpipes
    def _gutter_and_pipes(self, sc: Scene) -> None:
        f, st = self.f, self.st
        n = sc.node("fassade/fallrohr", "ext", source="photo", sigma=0.3)
        eave = self._eave()
        x1 = float(self.p.north_outer_x(0.0))
        prof = np.array([(0.085 + 0.065 * math.cos(a), 0.065 * math.sin(a)) for a in np.linspace(0, -math.pi, 7)])
        V, T = geom.sweep_x(prof, -0.15, x1 + 0.10, 6)      # columns (s, e, z): profile y = outwards
        st.put(sc, n, "fallrohr", V + np.array([0.0, 0.0, eave - 0.02]), T, "sez")
        for pp in f["fallrohre"]:
            x = v(pp["x"])
            e = 0.10
            for (za, zb, r) in ((-1.4, -0.35, 0.062), (-0.35, eave - 0.06, 0.05)):
                V, T = geom.rod((x, e, za), (x, e, zb), r, 8)
                st.put(sc, n, "fallrohr", V, T, "sez")
            V, T = geom.rod((x, e, eave - 0.07), (x, 0.085, eave - 0.01), 0.05, 8)
            st.put(sc, n, "fallrohr", V, T, "sez")
            for zz in np.arange(0.6, eave - 0.3, 1.6):               # pipe clips
                st.block(sc, n, "fallrohr", x - 0.012, x + 0.012, zz, zz + 0.03, 0.0, e, 0.002)

    # ---- projecting sign
    def _sign(self, sc: Scene) -> None:
        s = self.f["ausleger_schild"]
        n = sc.node("fassade/ausleger-schild", "ext", source="photo", sigma=s["x"]["sigma_m"])
        sc.styled.add(n.name)
        x, z0, w, h, d, arm = v(s["x"]), v(s["z0"]), v(s["w"]), v(s["h"]), float(s["d"]), v(s["arm"])
        st = self.st
        st.block(sc, n, "lack-schwarz", x - 0.06, x + 0.06, z0 + h + 0.02, z0 + h + 0.20, 0.0, 0.02, 0.003)   # wall plate
        V, T = geom.rod((x, 0.02, z0 + h + 0.10), (x, arm, z0 + h + 0.10), 0.014, 6)
        st.put(sc, n, "lack-schwarz", V, T, "sez")
        V, T = geom.rod((x, 0.02, z0 + h - 0.15), (x, arm * 0.55, z0 + h + 0.10), 0.010, 6)
        st.put(sc, n, "lack-schwarz", V, T, "sez")
        e0, e1 = arm - 0.06 - w, arm - 0.06
        for k in (0.25, 0.75):
            V, T = geom.rod((x, e0 + w * k, z0 + h), (x, e0 + w * k, z0 + h + 0.10), 0.006, 5)
            st.put(sc, n, "lack-schwarz", V, T, "sez")
        # the box: thickness d across x, from e0 to e1 outwards, z0..z0+h
        V, T = geom.rounded_box_local(d, e1 - e0, h, 0.012, 1)
        st.put(sc, n, "regal-weiss", V + np.array([x - d / 2, e0, z0]), T, "sez")
        for side in (-1, 1):                                     # the graphic on both faces
            xf = x + side * (d / 2 + 0.001)
            if side < 0:
                wf = WallFrame(np.array([xf, 0.0]), np.array([0.0, -1.0]), np.array([-1.0, 0.0]))
            else:
                wf = WallFrame(np.array([xf, 0.0]), np.array([0.0, 1.0]), np.array([1.0, 0.0]))
            cs_ = (e0 + e1) / 2 if side < 0 else -(e0 + e1) / 2      # s of the box centre (box at frame-B y = −(e0+e1)/2)
            self._oven_graphic(sc, n, wf, cs_, z0 + h * 0.62, 0.15, 0.0)
            if self.lettering:
                from .lettering import text_polys
                tn = sc.node("fassade/ausleger-schild/schrift", "ext", "fassade/ausleger-schild", source="photo", sigma=0.1)
                for txt, zz, hh in (("Bäckerei", z0 + h * 0.30, 0.045), ("Heusser", z0 + h * 0.18, 0.045)):
                    t = affinity.translate(text_polys(txt, hh, {"family": "DejaVu Serif", "weight": "bold"}), cs_, zz)
                    wf.face(sc, tn, "schrift", t, 0.002)

    def _oven_graphic(self, sc, node, wf: WallFrame, cs, cz, r, e, peels=False) -> None:
        """Neutral oven-and-bread graphic: brick arch, dark mouth, a scored loaf (centre cs, cz; arch radius r)."""
        ri = r * 0.72
        e1, e2, e3 = e + 0.002, e + 0.004, e + 0.006
        if peels:
            for sgn in (-1, 1):
                stick = LineString([(cs + sgn * r * 1.25, cz + r * 1.25), (cs - sgn * r * 0.15, cz - r * 0.05)]).buffer(r * 0.035, quad_segs=1)
                paddle = affinity.rotate(Point(cs + sgn * r * 1.30, cz + r * 1.38).buffer(1.0, quad_segs=4), 0)
                paddle = affinity.scale(paddle, r * 0.14, r * 0.22)
                paddle = affinity.rotate(paddle, -sgn * 35)
                wf.face(sc, node, "holz-hell", stick.union(paddle), e1)
        ang = np.linspace(0, math.pi, 10)
        for k in range(9):
            a0, a1 = ang[k] + 0.012, ang[k + 1] - 0.012
            t = np.linspace(a0, a1, 3)
            ring = [(cs + r * math.cos(a), cz + r * math.sin(a)) for a in t] + [(cs + ri * math.cos(a), cz + ri * math.sin(a)) for a in t[::-1]]
            wf.face(sc, node, "ziegel" if k % 2 == 0 else "terrakotta", Polygon(ring), e2)
        for sgn in (-1, 1):                                       # jambs
            a, b = (cs + sgn * ri, cs + sgn * r)
            wf.face(sc, node, "ziegel", sbox(min(a, b), cz - r * 0.55, max(a, b), cz - 0.004), e2)
        mouth = Point(cs, cz).buffer(ri, quad_segs=6).intersection(sbox(cs - ri, cz, cs + ri, cz + ri)).union(sbox(cs - ri, cz - r * 0.55, cs + ri, cz))
        wf.face(sc, node, "ofen", mouth, e1)
        wf.face(sc, node, "sandstein-hell", sbox(cs - r * 1.15, cz - r * 0.66, cs + r * 1.15, cz - r * 0.55), e2)
        loaf = affinity.scale(Point(cs, cz - r * 0.22).buffer(1.0, quad_segs=6), ri * 0.78, r * 0.27)
        wf.face(sc, node, "kruste", loaf, e3)
        for k in (-1, 0, 1):
            cut = affinity.rotate(sbox(-r * 0.10, -r * 0.018, r * 0.10, r * 0.018), 60, origin=(0, 0))
            wf.face(sc, node, "kruste-dunkel", affinity.translate(cut, cs + k * ri * 0.38, cz - r * 0.18), e3 + 0.002)

    # ---- handrail on the left porch wall
    def _handrail(self, sc: Scene, porch: dict) -> None:
        f = self.f["handlauf"]
        n = sc.node("fassade/handlauf", "ext", source="photo", sigma=f["y0"]["sigma_m"])
        sc.styled.add(n.name)
        st = self.p.stairs
        x = porch["x0"] + 0.07
        street = -st["total_rise"]["v"]
        rise = -street / int(st["risers"])

        def nose(y):                                              # stair pitch line through the nosings
            return street + rise * (y / st["tread_v"] + 1.0)
        h, y0, y1 = v(f["h"]), v(f["y0"]), v(f["y1"])
        a = np.array([x, y0, nose(y0) + h])
        b = np.array([x, y1, nose(y1) + h])
        pts = [a, b]
        for t in np.linspace(0.4, 2 * math.pi * 0.85, 7):        # rolled end at the bottom
            rr = 0.055 * (1 - t / (2 * math.pi) * 0.6)
            pts.insert(0, np.array([x, y0 - rr * math.sin(t), a[2] - 0.055 + rr * math.cos(t)]))
        for p_, q_ in zip(pts[:-1], pts[1:]):
            V, T = geom.rod(p_, q_, 0.016, 6)
            n.add_mesh("verzinkt", sc.F.zone(V), T)
        for t in (0.25, 0.85):                                    # brackets to the wall
            q_ = a + t * (b - a)
            V, T = geom.rod(q_, (porch["x0"] + 0.002, q_[1], q_[2] - 0.05), 0.010, 5)
            n.add_mesh("verzinkt", sc.F.zone(V), T)

    # ---- sandstone cladding of the free-standing corner pillar of the porch
    def _pillar_cladding(self, sc: Scene, porch: dict) -> None:
        n = sc.node("fassade/vorbau/eckpfeiler", "ext", "fassade/vorbau", source="photo", sigma=0.2)
        x0, x1 = porch["x1"], float(self.p.north_outer_x(0.0))
        y0, y1 = 0.0, porch["y5a"]
        ztop = self.p.ceiling
        zb = -float(self.p.stairs["total_rise"]["v"]) - 0.3
        e = 0.012
        faces = ((np.array([x0, y0]), np.array([x1, y0])), (np.array([x1, y0]), np.array([x1, y1])),
                 (np.array([x1, y1]), np.array([x0, y1])), (np.array([x0, y1]), np.array([x0, y0])))
        treads = porch.get("pillar_treads") or []              # E3: the pillar stands on the lowest treads
        for i, (a, b) in enumerate(faces):
            wf = WallFrame.of_line(a, b)
            if np.dot(wf.n, (a + b) / 2 - np.array([(x0 + x1) / 2, (y0 + y1) / 2])) < 0:
                wf = WallFrame.of_line(b, a)
            s_lo, s_hi = sorted([wf.s_of(a), wf.s_of(b)])
            shape = sbox(s_lo - e, zb, s_hi + e, ztop)
            for ya, yb, _, zt in treads:
                g = e + 0.002                                        # the cladding stands e proud of the pillar
                foot = sbox(x0 - g, ya - (g if ya <= y0 + 1e-6 else 0.0), x1 + g, yb + (g if yb >= y1 - 1e-6 else 0.0))
                seg = LineString([a, b]).intersection(foot)
                if seg.is_empty or seg.length < 1e-4:
                    continue
                ss = sorted(wf.s_of(q) for q in np.asarray(seg.coords))
                shape = shape.difference(sbox(ss[0] - e - 0.001, zb - 1.0, ss[-1] + e + 0.001, zt))
            wf.face(sc, n, "sockel-fuge", shape, e)
            for q, k in ashlar(shape, [0.24, 0.20], (0.20, 0.26, 0.32), 0.012, f"pfeiler{i}", 0.4, top=ztop):
                wf.face(sc, n, plinth_tone(q, k, f"pfeiler{i}"), q, e + 0.006)

    # ---- the gable: verge boards, mural panel
    def _gable(self, sc: Scene, g: Gable) -> None:
        gb = self.gb
        n = sc.node("fassade/dach/ortgang", "ext", "fassade/dach", source="photo", sigma=0.3)
        back = np.array(next(e for e in self.p.raw["site"]["building"]["edges"] if e["id"] == "L7")["to"], np.float64)
        line = []
        for y in (0.0, g.ridge_y(0.0), float(back[1])):          # eave corner, ridge, back corner on the gable line
            q = gb.p0 + ((y - gb.p0[1]) / gb.u[1]) * gb.u
            line.append((gb.s_of(q), float(g.z(q[None])[0])))
        for (sa, za), (sb, zb) in zip(line[:-1], line[1:]):
            board = Polygon([(sa, za + 0.04), (sb, zb + 0.04), (sb, zb - 0.20), (sa, za - 0.20)])
            gb.relief(sc, n, "holz-dunkel", board, 0.0, 0.05)
        m = self.f["wandmalerei"]
        mn = sc.node("fassade/wandmalerei", "ext", source="photo", sigma=m["w"]["sigma_m"])
        sc.styled.add(mn.name)
        cs, w, z0, z1 = -v(m["y"]), v(m["w"]), v(m["z0"]), v(m["z1"])
        gb.block(sc, mn, "wandbild-grund", cs - w / 2, cs + w / 2, z0, z1, 0.0, 0.025, 0.008)
        e = 0.026
        border = sbox(cs - w / 2 + 0.05, z0 + 0.05, cs + w / 2 - 0.05, z1 - 0.05)
        gb.face(sc, mn, "holz-hell", border.difference(border.buffer(-0.025, join_style="mitre")), e)
        hgt = z1 - z0
        if self.lettering:
            self._oven_graphic(sc, mn, gb, cs, z0 + hgt * 0.60, w * 0.30, e, peels=True)
            from .lettering import text_polys
            tn = sc.node("fassade/wandmalerei/schrift", "ext", "fassade/wandmalerei", source="photo", sigma=0.3)
            for txt, zz, hh in (("BÄCKEREI", z0 + hgt * 0.27, 0.08), ("HEINRICH HEUSSER", z0 + hgt * 0.16, 0.14),
                                ("seit 1933", z0 + hgt * 0.08, 0.07)):
                t = text_polys(txt, hh, {"family": "DejaVu Serif", "weight": "bold"})
                bx = t.bounds
                k = min(1.0, (w - 0.24) / max(bx[2] - bx[0], 1e-6))
                t = affinity.translate(affinity.scale(t, k, k, origin=(0, 0)), cs, zz)
                gb.face(sc, tn, "schrift", t, e + 0.002)
        else:                                                    # neutral graphic: the oven fills the panel
            self._oven_graphic(sc, mn, gb, cs, z0 + hgt * 0.50, w * 0.34, e, peels=True)
            for zz in (z0 + hgt * 0.12, z0 + hgt * 0.16):
                gb.face(sc, mn, "holz-hell", sbox(cs - w * 0.32, zz, cs + w * 0.32, zz + 0.018), e + 0.002)


def slate_roof(sc: Scene, node: geom.Node, region: Polygon, plane: np.ndarray, size: float = 0.32) -> None:
    """Front roof in slate diamonds: the region (frame-B xy) lifted onto `plane`, joints as the base, diamonds 12 mm up."""
    F = sc.F
    nb = np.array([-plane[1], -plane[2], 1.0])
    nb /= np.linalg.norm(nb)

    def lift(off):
        return lambda v2: F.zone(np.column_stack([v2, plane[0] + plane[1] * v2[:, 0] + plane[2] * v2[:, 1]]) + off * nb)
    node.add_planar("schiefer-fuge", region, lift(0.0), F.zone_dir(nb))
    rot = affinity.rotate(region, 45, origin=(0, 0))
    tiles, _ = geom.tiles(rot, size, size, 0.03)
    tiles = [affinity.rotate(t, -45, origin=(0, 0)) for t in tiles]
    node.add_planar("schiefer", tiles, lift(0.012), F.zone_dir(nb))
