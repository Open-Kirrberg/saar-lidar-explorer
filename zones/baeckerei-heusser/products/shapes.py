"""Parametric, stylised low-poly product meshes for the Bäckerei Heusser twin (docs/style.md: comic / mobile-game look,
true sizes, bevels and round-overs, unlit + baked light in COLOR_0, no textures).

    parts = build(product, idx)            # product = one row of products.json, idx = instance index
    add_to_node(node, parts, origin, rot_deg)   # bake into a bh_twin geom.Node (its rig = the light)

Local frame (same axes as the zone frame): x = the product's width (longest horizontal extent), y = up, z = depth;
base at y = 0, centred on x/z. `build` fits every recipe exactly to the product's `size_m` [w, d, h] and then applies
the deterministic variation (± 6 % scale, ± 15° rotation, crust tone) seeded from the product id + instance index.

A recipe returns `Part`s: one palette token (material), vertices, triangles, optional smooth vertex normals and a
vertex AO factor. Mesh conventions are the generator's (build/bh_twin, imported read-only): triangles wound
counter-clockwise seen from outside, flat parts are split per triangle when baked, Node.add bakes the rig.
Bottoms that sit on a tray are left open (never visible) to save triangles.
"""
from __future__ import annotations

import hashlib
import math
import random
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np

HERE = Path(__file__).resolve().parent
_BUILD = str(HERE.parent / "build")
if _BUILD not in sys.path:
    sys.path.insert(0, _BUILD)

from bh_twin import geom, shade  # noqa: E402  (read-only reuse)

# ----------------------------------------------------------------------------------------------- palette

# Product colour tokens (sRGB). kruste-hell / kruste / kruste-dunkel are style.md's; the rest are new (moderate
# saturation, listed in products/README.md until the lead merges them into docs/style.md).
PALETTE = {
    "kruste-hell": "#E3B776",
    "kruste": "#C68642",
    "kruste-dunkel": "#8A5228",
    "schwarzbrot": "#6B4129",
    "lauge": "#8C4A22",
    "ausbund": "#F0CF96",
    "ausbund-lauge": "#C99062",
    "krume": "#F0E0BC",
    "krume-dunkel": "#A57B57",
    "mehl": "#EFE9DE",
    "salz": "#FAF9F5",
    "mohn": "#4A4C53",
    "mohn-hell": "#73757B",
    "sesam": "#EBD8A6",
    "kuemmel": "#6A5034",
    "koerner": "#C29A5E",
    "hafer": "#E6D7B2",
    "kaese": "#EAB84A",
    "schinken": "#D9898A",
    "schoko": "#4E2E20",
    "nuss": "#8C5E3B",
    "rosine": "#553131",
    "pudding": "#F3D063",
    "quark": "#F7F1E1",
    "kirsche": "#9E2335",
    "apfel": "#EBDA9E",
    "streusel": "#DFB06A",
    "butter": "#E2AE52",
    "mandel": "#E5C996",
    "sahne": "#FCF8F0",
    "buttercreme": "#F4E2AE",
    "zuckerguss": "#FAF7F0",
    "biskuit": "#F0CF86",
    "schoko-biskuit": "#6B4330",
    "kaesemasse": "#F3DD9C",
    "rahm": "#F2E3B6",
    "zitrone": "#F3DE8E",
    "papier": "#EFE6D6",
    "waffel": "#D9A45C",
    "tablett": "#D9CFC0",
}
BUDGET_SMALL = 300   # style.md: products ≤ 300 triangles per instance
BUDGET_LARGE = 800   # exception for whole cakes / tortes / trays (documented in products/README.md)
LARGE = {"blechkuchen", "rundkuchen", "kastenkuchen", "kranzkuchen", "zopf", "torte", "tortenboden", "rolle",
         "sahnerollen"}
CRUSTS = {"kruste-hell", "kruste", "kruste-dunkel", "schwarzbrot", "lauge", "biskuit", "streusel", "butter", "waffel"}
Y = np.array([0.0, 1.0, 0.0])


def budget(shape: str) -> int:
    return BUDGET_LARGE if shape in LARGE else BUDGET_SMALL


def materials() -> dict[str, dict]:
    """The twin's materials plus the product tokens (unlit base colour, linear)."""
    out = shade.materials()
    for k, v in PALETTE.items():
        out[k] = {"rgba": shade.hex_linear(v) + [1.0]}
    return out


# ----------------------------------------------------------------------------------------------- parts


@dataclass
class Part:
    mat: str
    v: np.ndarray                    # (n, 3) local frame
    t: np.ndarray                    # (k, 3) int, CCW seen from outside
    nrm: np.ndarray | None = None    # (n, 3) smooth vertex normals; None = flat per triangle
    ao: np.ndarray | None = None     # (n,) vertex light factor (grooves, creases)
    pairs: int = 0                   # the first `pairs` triangles form quads two by two (lathe / tube bands)

    @property
    def triangles(self) -> int:
        return int(len(self.t))


def smooth_normals(v: np.ndarray, t: np.ndarray) -> np.ndarray:
    a, b, c = v[t[:, 0]], v[t[:, 1]], v[t[:, 2]]
    fn = np.cross(b - a, c - a)
    n = np.zeros_like(v)
    for k in range(3):
        np.add.at(n, t[:, k], fn)
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    return n / np.where(ln < 1e-15, 1.0, ln)


def part(mat: str, v, t, smooth: bool = True, ao=None) -> Part:
    v = np.asarray(v, np.float64).reshape(-1, 3)
    t = np.asarray(t, np.int64).reshape(-1, 3)
    return Part(mat, v, t, smooth_normals(v, t) if smooth else None, None if ao is None else np.asarray(ao, np.float64))


def compact(p: Part) -> Part:
    used = np.unique(p.t)
    remap = -np.ones(len(p.v), np.int64)
    remap[used] = np.arange(len(used))
    return Part(p.mat, p.v[used], remap[p.t], None if p.nrm is None else p.nrm[used], None if p.ao is None else p.ao[used])


def split(p: Part, mask: np.ndarray, mat: str) -> list[Part]:
    """Triangles where `mask` is true get material `mat` (same vertices and normals: shading stays continuous).
    Quads of lathe / tube bands switch as a whole, so the border follows the bands (no saw-tooth)."""
    mask = np.asarray(mask, bool).copy()
    if p.pairs:
        q = mask[:p.pairs].reshape(-1, 2).any(axis=1)
        mask[:p.pairs] = np.repeat(q, 2)
    out = []
    for m, sel in ((p.mat, ~mask), (mat, mask)):
        if sel.any():
            out.append(compact(Part(m, p.v, p.t[sel], p.nrm, p.ao)))
    return out


def paint(p: Part, layers) -> list[Part]:
    """Several material layers on one part in one go: layers = [(mask, mat), …], later layers win. Every mask is
    merged per quad of the part's lathe / tube bands (clean band borders); `split` twice would lose the quad pairing
    after the first call and give a saw-tooth border."""
    lab = np.zeros(len(p.t), np.int64)
    mats = [p.mat]
    for mask, mat in layers:
        m = np.asarray(mask, bool).copy()
        if p.pairs:
            q = m[:p.pairs].reshape(-1, 2).any(axis=1)
            m[:p.pairs] = np.repeat(q, 2)
        mats.append(mat)
        lab[m] = len(mats) - 1
    return [compact(Part(mat, p.v, p.t[lab == k], p.nrm, p.ao)) for k, mat in enumerate(mats) if (lab == k).any()]


def tri_centroids(p: Part) -> np.ndarray:
    return p.v[p.t].mean(axis=1)


def face_normals(p: Part) -> np.ndarray:
    a, b, c = p.v[p.t[:, 0]], p.v[p.t[:, 1]], p.v[p.t[:, 2]]
    fn = np.cross(b - a, c - a)
    return fn / np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-15)


def fix_winding(v: np.ndarray, t: np.ndarray, center) -> np.ndarray:
    """Wind every triangle of a small convex piece outwards (away from `center`)."""
    t = np.asarray(t, np.int64).copy()
    a, b, c = v[t[:, 0]], v[t[:, 1]], v[t[:, 2]]
    d = np.einsum("ij,ij->i", np.cross(b - a, c - a), (a + b + c) / 3 - np.asarray(center))
    t[d < 0] = t[d < 0][:, [0, 2, 1]]
    return t


def transform(parts: list[Part], m: np.ndarray, off=(0.0, 0.0, 0.0)) -> list[Part]:
    m = np.asarray(m, np.float64)
    nm = np.linalg.inv(m).T
    flip = np.linalg.det(m) < 0
    out = []
    for p in parts:
        v = p.v @ m.T + np.asarray(off)
        t = p.t[:, [0, 2, 1]] if flip else p.t
        n = None
        if p.nrm is not None:
            n = p.nrm @ nm.T
            n = n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-15)
        out.append(Part(p.mat, v, t, n, p.ao))
    return out


def rot_y(deg: float) -> np.ndarray:
    """Heading rotation (clockwise seen from above, the zone's convention): local +x turns towards +z."""
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, -s], [0, 1, 0], [s, 0, c]])


def bbox(parts: list[Part]) -> tuple[np.ndarray, np.ndarray]:
    v = np.concatenate([p.v for p in parts])
    return v.min(0), v.max(0)


def fit(parts: list[Part], size) -> list[Part]:
    """Scale each axis so the bbox is exactly size [w, d, h]; base on y = 0, centred on x/z."""
    lo, hi = bbox(parts)
    ext = np.maximum(hi - lo, 1e-9)
    s = np.array([size[0], size[2], size[1]]) / ext
    parts = transform(parts, np.diag(s))
    lo, hi = bbox(parts)
    return transform(parts, np.eye(3), (-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2))


def triangles(parts: list[Part]) -> int:
    return sum(p.triangles for p in parts)


# ----------------------------------------------------------------------------------------------- primitives


def lathe(prof, segs: int, sx: float = 1.0, sz: float = 1.0, phase: float = 0.0, rmod=None, mat: str = "kruste",
          cap_bottom: bool = False) -> Part:
    """Surface of revolution of prof [(r, y), …] (bottom → top; r = 0 at the end = pole), radii scaled by sx (x) and
    sz (z); rmod(theta (segs,), ring index) -> radius factors. Open at the bottom unless cap_bottom."""
    th = phase + 2 * math.pi * np.arange(segs) / segs
    V, rows = [], []
    for i, (r, y) in enumerate(prof):
        if r <= 1e-12:
            rows.append(len(V))
            V.append([0.0, y, 0.0])
            continue
        f = np.ones(segs) if rmod is None else rmod(th, i)
        idx = list(range(len(V), len(V) + segs))
        V += np.column_stack([r * f * np.cos(th) * sx, np.full(segs, y), r * f * np.sin(th) * sz]).tolist()
        rows.append(idx)
    T = []
    for i in range(len(rows) - 1):
        lo, hi = rows[i], rows[i + 1]
        for j in range(segs):
            k = (j + 1) % segs
            if isinstance(lo, list) and isinstance(hi, list):
                T += [[lo[j], hi[k], lo[k]], [lo[j], hi[j], hi[k]]]
            elif isinstance(lo, list):  # pole on top
                T.append([lo[j], hi, lo[k]])
            elif isinstance(hi, list):  # pole at the bottom
                T.append([lo, hi[k], hi[j]])
    pairs = sum(2 * segs for i in range(len(rows) - 1) if isinstance(rows[i], list) and isinstance(rows[i + 1], list))
    if cap_bottom and isinstance(rows[0], list):
        c = len(V)
        V.append([0.0, prof[0][1], 0.0])
        for j in range(segs):
            T.append([c, rows[0][j], rows[0][(j + 1) % segs]])
    p = part(mat, V, T)
    p.pairs = pairs if _quads_lead(rows) else 0
    return p


def loaf(W: float, D: float, rings, segs: int, mat: str, top_y: float) -> Part:
    """Tin loaf / loaf cake as ONE smooth body (no separate lid): rings [(ax, az, y, n, ao), …] bottom → top are
    superellipses (exponent n; 2 = ellipse, 6–8 = rounded box) with half axes ax·W/2, az·D/2; closed at the top
    with a pole at (0, top_y, 0); open at the bottom. Quad bands lead (`pairs`), so `paint` gives clean borders."""
    th = math.pi / segs + 2 * math.pi * np.arange(segs) / segs
    c, s = np.cos(th), np.sin(th)
    V, A = [], []
    for ax, az, y, n, ao in rings:
        e = 2.0 / n
        V += np.column_stack([ax * W / 2 * np.sign(c) * np.abs(c) ** e, np.full(segs, y),
                              az * D / 2 * np.sign(s) * np.abs(s) ** e]).tolist()
        A += [ao] * segs
    pole = len(V)
    V.append([0.0, top_y, 0.0])
    A.append(1.0)
    T = []
    for i in range(len(rings) - 1):
        a0, b0 = i * segs, (i + 1) * segs
        for j in range(segs):
            k = (j + 1) % segs
            T += [[a0 + j, b0 + k, a0 + k], [a0 + j, b0 + j, b0 + k]]
    top = (len(rings) - 1) * segs
    for j in range(segs):
        T.append([top + j, pole, top + (j + 1) % segs])
    p = part(mat, V, T)
    p.pairs = 2 * segs * (len(rings) - 1)
    p.ao = np.asarray(A, np.float64)
    return p


def tin_rings(W: float, D: float, H: float, yb: float, foot: float, over: float = 0.003, crown=(35, 62, 82)):
    """Rings for `loaf`: tin walls up to yb (slightly narrower foot), a rounded 'muffin top' bulging `over` metres past
    the tin, then a crown that arches across the short axis and stays long along x."""
    ox, oz = 1 + over / (W / 2), 1 + over / (D / 2)
    ym = yb + 0.12 * (H - yb)
    rings = [(foot, foot * 0.99, 0.0, 8, 1.0), (0.5 + 0.5 * foot + 0.01, 0.99, 0.5 * yb, 8, 1.0),
             (1.0, 1.0, yb, 8, 0.86), (ox, oz, ym, 6, 0.97)]
    for deg in crown:
        f = math.radians(deg)
        rings.append((ox * (1 - 0.24 * (1 - math.cos(f))), oz * math.cos(f) ** 0.9,
                      ym + (H - ym) * math.sin(f) ** 0.8, 4, 1.0))
    return rings


def _quads_lead(rows) -> bool:
    """True when every quad band comes before the (top) pole fan, i.e. the leading triangles pair up."""
    kinds = [isinstance(r, list) for r in rows]
    return kinds[0] and all(kinds[:-1])


class Dome:
    """A lathe body (bread, roll) that can grow caps: flour, seed crust, poppy, cheese. A cap is an offset shell on
    the body's own ring/column grid (so it never intersects the faceted body) with a wobbly lower rim; the body bands
    it covers are dropped."""

    def __init__(self, prof, segs: int, sx: float, sz: float, mat: str, phase: float = 0.0, pinch: float = 0.0):
        self.prof = np.asarray(prof, np.float64)
        self.segs, self.sx, self.sz, self.phase, self.pinch = segs, sx, sz, phase, pinch
        self.body = lathe(prof, segs, sx, sz, phase=phase, mat=mat)
        if pinch:
            self.body.v[:, 2] *= 1 - pinch * (self.body.v[:, 0] / sx) ** 4
            self.body.nrm = smooth_normals(self.body.v, self.body.t)

    def _xyz(self, r, y, th):
        x = r * np.cos(th) * self.sx
        z = r * np.sin(th) * self.sz
        if self.pinch:
            z = z * (1 - self.pinch * (x / self.sx) ** 4)
        return np.column_stack([x, y, z])

    def _at(self, f, off):
        """Profile point at float ring index f, pushed `off` metres outwards along the profile normal."""
        P = self.prof
        R = 0.5 * (self.sx + self.sz)
        i = np.clip(np.floor(f).astype(int), 0, len(P) - 2)
        u = f - i
        r = P[i, 0] * (1 - u) + P[i + 1, 0] * u
        y = P[i, 1] * (1 - u) + P[i + 1, 1] * u
        dr, dy = (P[i + 1, 0] - P[i, 0]) * R, P[i + 1, 1] - P[i, 1]
        ln = np.maximum(np.hypot(dr, dy), 1e-12)
        return r + off * (dy / ln) / R, y + off * (-dr / ln)

    def capped(self, parts: list[Part], mat: str, e0: float, amp: float, off: float, rng: random.Random) -> list[Part]:
        segs, P = self.segs, self.prof
        th = self.phase + 2 * math.pi * np.arange(segs) / segs
        ph = [rng.uniform(0, 2 * math.pi) for _ in range(3)]
        e = e0 + amp * (0.55 * np.sin(2 * th + ph[0]) + 0.30 * np.sin(3 * th + ph[1]) + 0.25 * np.sin(5 * th + ph[2]))
        e = np.clip(e, 1.0, len(P) - 2.2)
        top = int(math.ceil(e.max()))
        V, rows = [], []
        r, y = self._at(e, off)
        rows.append(list(range(len(V), len(V) + segs)))
        V += self._xyz(r, y, th).tolist()
        for i in range(top, len(P) - 1):
            r, y = self._at(np.full(segs, float(i)), off)
            rows.append(list(range(len(V), len(V) + segs)))
            V += self._xyz(r, y, th).tolist()
        pole = len(V)
        V.append([0.0, P[-1, 1] + off, 0.0])
        T = []
        for a, b in zip(rows[:-1], rows[1:]):
            for j in range(segs):
                k = (j + 1) % segs
                T += [[a[j], b[k], a[k]], [a[j], b[j], b[k]]]
        for j in range(segs):
            T.append([rows[-1][j], pole, rows[-1][(j + 1) % segs]])
        cap = part(mat, V, T)
        cap.pairs = 2 * segs * (len(rows) - 1)
        cap.ao = np.concatenate([np.full(segs, 0.88), np.ones(len(V) - segs)])
        # drop the body bands under the cap (ring `top` and above)
        b = self.body
        keep = 2 * segs * top
        trimmed = compact(Part(b.mat, b.v, b.t[:keep], b.nrm, b.ao, min(b.pairs, keep)))
        out = [trimmed if q is b else q for q in parts]
        self.body = trimmed
        return out + [cap]


def tube(path, rx, ry=None, sides: int = 6, mat: str = "kruste", closed: bool = False, tip: float = 0.7,
         phase: float | None = None, floor: float | None = None) -> Part:
    """Tube along `path` (n, 3) with radii rx (sideways) / ry (up) per sample; rounded pole tips unless closed.
    `floor`: clamp y ≥ floor (a flat underside where the tube rests on the tray)."""
    P = np.asarray(path, np.float64)
    n = len(P)
    rx = np.broadcast_to(np.asarray(rx, np.float64), (n,))
    ry = rx if ry is None else np.broadcast_to(np.asarray(ry, np.float64), (n,))
    if closed:
        T = np.roll(P, -1, 0) - np.roll(P, 1, 0)
    else:
        T = np.gradient(P, axis=0)
    T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-12)
    S = np.cross(T, Y)
    bad = np.linalg.norm(S, axis=1) < 1e-6
    S[bad] = np.array([0.0, 0.0, 1.0])
    S /= np.linalg.norm(S, axis=1, keepdims=True)
    U = np.cross(S, T)
    ph = (-math.pi / 2 + math.pi / sides) if phase is None else phase
    a = ph + 2 * math.pi * np.arange(sides) / sides
    ca, sa = np.cos(a), np.sin(a)
    V = (P[:, None, :] + rx[:, None, None] * ca[None, :, None] * S[:, None, :]
         + ry[:, None, None] * sa[None, :, None] * U[:, None, :]).reshape(-1, 3)
    V = list(V)
    tri = []
    m = n if closed else n - 1
    for i in range(m):
        i1 = (i + 1) % n
        for j in range(sides):
            k = (j + 1) % sides
            A, B, C, D = i * sides + j, i1 * sides + j, i1 * sides + k, i * sides + k
            tri += [[A, B, C], [A, C, D]]
    if not closed:
        p0 = len(V)
        V.append(P[0] - T[0] * tip * rx[0])
        for j in range(sides):
            tri.append([p0, j, (j + 1) % sides])
        p1 = len(V)
        V.append(P[-1] + T[-1] * tip * rx[-1])
        b = (n - 1) * sides
        for j in range(sides):
            tri.append([p1, b + (j + 1) % sides, b + j])
    V = np.array(V)
    if floor is not None:
        V[:, 1] = np.maximum(V[:, 1], floor)
    p = part(mat, V, tri)
    p.pairs = 2 * m * sides
    return p


def box(x0, x1, y0, y1, z0, z1, bevel: float, mat: str, top: str | None = None, open_bottom: bool = True) -> list[Part]:
    """Chamfered box (style.md bevel), flat shaded; optional own material for the top face."""
    pts = geom.chamfer_box_local(x1 - x0, z1 - z0, y1 - y0, bevel)        # local x, y(=depth), z(=up)
    v, t = geom.convex_solid(pts)
    v = np.column_stack([v[:, 0] + x0, v[:, 2] + y0, -(v[:, 1]) + z1])  # (x, up, depth) proper rotation
    t = fix_winding(v, t, v.mean(0))
    p = part(mat, v, t, smooth=False)
    fn = face_normals(p)
    if open_bottom:
        p = compact(Part(p.mat, p.v, p.t[fn[:, 1] > -0.99], None))
        fn = face_normals(p)
    if top:
        return split(p, fn[:, 1] > 0.95, top)
    return [p]


def prism(poly_xz, y0: float, y1: float, side: str, top: str, bottom: bool = False) -> list[Part]:
    """Vertical prism of a shapely polygon given in (x, z); flat shaded; top / side materials."""
    from shapely import affinity
    poly = affinity.scale(poly_xz, 1.0, -1.0, origin=(0, 0))   # (x, z) -> (x, b = -z)
    out = []
    for kind, v, t, nrm in geom.prism_parts(poly, y0, y1):
        if kind == "bottom" and not bottom:
            continue
        v3 = np.column_stack([v[:, 0], v[:, 2], -v[:, 1]])       # (a, b, up) -> (x, y, z): proper rotation
        out.append(part(top if kind == "top" else side, v3, t, smooth=False))
    return out


def icosphere(c, r: float, mat: str) -> Part:
    g = (1 + 5 ** 0.5) / 2
    v = np.array([[-1, g, 0], [1, g, 0], [-1, -g, 0], [1, -g, 0], [0, -1, g], [0, 1, g], [0, -1, -g], [0, 1, -g],
                  [g, 0, -1], [g, 0, 1], [-g, 0, -1], [-g, 0, 1]], np.float64)
    v = v / np.linalg.norm(v, axis=1, keepdims=True)
    t = np.array([[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2],
                  [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11],
                  [6, 2, 10], [8, 6, 7], [9, 8, 1]])
    vv = np.asarray(c) + v * r
    return Part(mat, vv, fix_winding(vv, t, c), v.copy(), None)


def octa(c, r: float, mat: str) -> Part:
    """Low ball (8 triangles, smooth normals): cherries and chocolate beans on whole cakes."""
    v = np.array([[1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1], [0, 1, 0], [0, -1, 0]], np.float64)
    t = np.array([[0, 4, 1], [1, 4, 2], [2, 4, 3], [3, 4, 0], [0, 1, 5], [1, 2, 5], [2, 3, 5], [3, 0, 5]])
    vv = np.asarray(c) + v * r
    return Part(mat, vv, fix_winding(vv, t, c), v.copy(), None)


def disc(cx, cz, r, y, segs, mat, sx=1.0, sz=1.0, wobble=None) -> Part:
    """Flat horizontal disc (fan), normal up; wobble: per-vertex radius factors."""
    a = 2 * math.pi * np.arange(segs) / segs
    f = np.ones(segs) if wobble is None else np.asarray(wobble)
    v = np.vstack([[cx, y, cz], np.column_stack([cx + r * f * np.cos(a) * sx, np.full(segs, y), cz + r * f * np.sin(a) * sz])])
    t = [[0, 1 + (j + 1) % segs, 1 + j] for j in range(segs)]
    return Part(mat, v, np.array(t), np.tile(Y, (segs + 1, 1)), None)


# ----------------------------------------------------------------------------------------------- surface draping


class Surface:
    """Top-down ray casts onto the parts built so far: y and face normal at (x, z)."""

    def __init__(self, parts: list[Part]):
        tri = [p.v[p.t] for p in parts if len(p.t)]
        self.tri = np.concatenate(tri) if tri else np.zeros((0, 3, 3))
        a, b, c = self.tri[:, 0], self.tri[:, 1], self.tri[:, 2]
        fn = np.cross(b - a, c - a)
        self.fn = fn / np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-15)
        self.up = self.fn[:, 1] > 1e-4

    def hit(self, xz) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        q = np.atleast_2d(np.asarray(xz, np.float64))
        tri = self.tri[self.up]
        fn = self.fn[self.up]
        a, b, c = tri[:, 0][:, [0, 2]], tri[:, 1][:, [0, 2]], tri[:, 2][:, [0, 2]]
        e1, e2 = b - a, c - a
        det = e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]
        ok = np.abs(det) > 1e-14
        d = q[:, None, :] - a[None]
        u = (d[..., 0] * e2[None, :, 1] - d[..., 1] * e2[None, :, 0]) / np.where(ok, det, 1)[None]
        w = (e1[None, :, 0] * d[..., 1] - e1[None, :, 1] * d[..., 0]) / np.where(ok, det, 1)[None]
        inside = ok[None] & (u >= -1e-9) & (w >= -1e-9) & (u + w <= 1 + 1e-9)
        yy = tri[None, :, 0, 1] + u * (tri[None, :, 1, 1] - tri[None, :, 0, 1]) + w * (tri[None, :, 2, 1] - tri[None, :, 0, 1])
        yy = np.where(inside, yy, -np.inf)
        k = yy.argmax(axis=1)
        y = yy[np.arange(len(q)), k]
        return y, fn[k], np.isfinite(y)


def _frame(n: np.ndarray, ang: float) -> tuple[np.ndarray, np.ndarray]:
    a = np.array([1.0, 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 0, 1.0])
    t1 = np.cross(n, a)
    t1 /= np.linalg.norm(t1)
    t2 = np.cross(n, t1)
    c, s = math.cos(ang), math.sin(ang)
    return c * t1 + s * t2, -s * t1 + c * t2


def strip(surf: Surface, path_xz, half_w, mat: str, off: float, sink: float = 0.4, ao_edge: float = 0.9,
          ribbon: bool = False) -> Part | None:
    """A draped band (cut, glaze line, icing drizzle) along path_xz with half widths half_w; the centre line sits a
    bit lower than the edges (sink × off) so it shades like a shallow groove."""
    P = np.asarray(path_xz, np.float64)
    hw = np.broadcast_to(np.asarray(half_w, np.float64), (len(P),))
    d = np.gradient(P, axis=0)
    d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-12)
    nrm = np.column_stack([-d[:, 1], d[:, 0]])
    L, R = P + nrm * hw[:, None], P - nrm * hw[:, None]
    pts = np.concatenate([L, P, R])
    y, _, ok = surf.hit(pts)
    n = len(P)
    yl, yc, yr = y[:n], y[n:2 * n], y[2 * n:]
    okl, okc, okr = ok[:n], ok[n:2 * n], ok[2 * n:]
    # an edge point beyond the silhouette takes the centre's height; a centre miss drops its segments
    yl = np.where(okl, yl, np.where(okc, yc, 0.0))
    yr = np.where(okr, yr, np.where(okc, yc, 0.0))
    if ribbon:
        yl = yr = np.maximum(np.maximum(yl, yr), yc)
        yc = yl
    y = np.concatenate([yl, np.where(okc, yc, 0.0), yr])
    if okc.sum() < 2:
        return None
    lift = np.concatenate([np.full(n, off), np.full(n, off * (1 - sink)), np.full(n, off)])
    v = np.column_stack([pts[:, 0], y + lift, pts[:, 1]])
    t = []
    for i in range(n - 1):
        if not (okc[i] and okc[i + 1]):
            continue
        for r0, r1 in (((0, 2 * n),) if ribbon else ((0, n), (n, 2 * n))):
            a, b, c, e = r0 + i, r0 + i + 1, r1 + i + 1, r1 + i
            t += [[a, e, c], [a, c, b]]
    t = np.array(t).reshape(-1, 3)
    if not len(t):
        return None
    p = part(mat, v, t)
    fnn = face_normals(p)
    t[fnn[:, 1] < 0] = t[fnn[:, 1] < 0][:, [0, 2, 1]]
    p = part(mat, v, t)
    p.ao = np.concatenate([np.full(n, ao_edge), np.ones(n), np.full(n, ao_edge)])
    return p


def patch(surf: Surface, rx: float, rz: float, mat: str, off: float, rng: random.Random, cx: float = 0.0,
          cz: float = 0.0, segs: int = 14, rings=(0.55, 1.0), wobble: float = 0.12, power: float = 2.0,
          dome: float = 0.0) -> Part | None:
    """A draped cap (flour, seed crust, poppy, cheese …): polar grid on the surface below, raised by `off`, with an
    organic wobbly rim (smooth noise, deterministic). power > 2 = squarer (superellipse) for loaf tops."""
    a = 2 * math.pi * np.arange(segs) / segs
    ph = [rng.uniform(0, 2 * math.pi) for _ in range(3)]
    f = 1 + wobble * (0.55 * np.sin(2 * a + ph[0]) + 0.3 * np.sin(3 * a + ph[1]) + 0.25 * np.sin(5 * a + ph[2]))
    ca, sa = np.cos(a), np.sin(a)
    e = 2.0 / power
    ux, uz = np.sign(ca) * np.abs(ca) ** e, np.sign(sa) * np.abs(sa) ** e
    pts = [(cx, cz)]
    for r in rings:
        rr = r * (1 + (f - 1) * r ** 2)
        pts += list(zip(cx + rx * rr * ux, cz + rz * rr * uz))
    pts = np.array(pts)
    y, _, ok = surf.hit(pts)
    if not ok.all():
        y = np.where(ok, y, np.min(y[ok]) if ok.any() else 0.0)
    lift = np.concatenate([[off * (1 + dome)], np.concatenate([np.full(segs, off * (1 + dome * (1 - r))) for r in rings])])
    v = np.column_stack([pts[:, 0], y + lift, pts[:, 1]])
    T = [[0, 1 + (j + 1) % segs, 1 + j] for j in range(segs)]
    for k in range(len(rings) - 1):
        b0, b1 = 1 + k * segs, 1 + (k + 1) * segs
        for j in range(segs):
            jn = (j + 1) % segs
            T += [[b0 + j, b0 + jn, b1 + jn], [b0 + j, b1 + jn, b1 + j]]
    T = np.array(T)
    pp = part(mat, v, T)
    fn = face_normals(pp)
    T[fn[:, 1] < 0] = T[fn[:, 1] < 0][:, [0, 2, 1]]
    pp = part(mat, v, T)
    pp.ao = np.concatenate([[1.0], np.concatenate([np.full(segs, 1.0 - 0.06 * r) for r in rings])])
    return pp


def drizzle(surf: Surface, pts_xz, width: float, mat: str, off: float, sub: int = 3) -> Part | None:
    """Icing / chocolate drizzle: a flat ribbon along a zig-zag (each leg subdivided so it follows the shape)."""
    P = np.asarray(pts_xz, np.float64)
    Q = [P[0]]
    for a, b in zip(P[:-1], P[1:]):
        for k in range(1, sub + 1):
            Q.append(a + (b - a) * k / sub)
    return strip(surf, np.array(Q), width / 2, mat, off, sink=0.0, ao_edge=1.0, ribbon=True)


def cut(surf: Surface, p0, p1, width: float, mat: str, off: float, n: int = 5, bend: float = 0.0) -> Part | None:
    """Scoring cut: a lens-shaped band from p0 to p1 (xz); `bend` bows it sideways (fraction of the length)."""
    p0, p1 = np.asarray(p0, np.float64), np.asarray(p1, np.float64)
    t = np.linspace(0, 1, n)
    d = p1 - p0
    side = np.array([-d[1], d[0]])
    P = p0 + t[:, None] * d + (bend * np.sin(math.pi * t))[:, None] * side
    hw = 0.5 * width * np.sin(math.pi * t) ** 0.7
    return strip(surf, P, hw, mat, off)


def dots(surf: Surface, pts_xz, size: float, mat: str, rng: random.Random, kind: str = "pyr", lift: float = 0.0,
         aspect: float = 2.0, height: float = 0.6) -> list[Part]:
    """Small pieces on the surface: 'pyr' (3-sided grain, 3 tris), 'seed' (flat lozenge, 4 tris), 'blob' (lump,
    5 tris), 'ball' (icosphere, 20 tris)."""
    pts = np.atleast_2d(np.asarray(pts_xz, np.float64))
    if len(pts) == 0:
        return []
    y, nrm, ok = surf.hit(pts)
    V, T, N = [], [], []
    for (x, z), yy, n, good in zip(pts, y, nrm, ok):
        if not good:
            continue
        s = size * rng.uniform(0.8, 1.2)
        n = n / np.linalg.norm(n)
        c = np.array([x, yy + lift, z])
        t1, t2 = _frame(n, rng.uniform(0, 2 * math.pi))
        b = len(V)
        if kind in ("ball", "oct"):
            sp = (icosphere if kind == "ball" else octa)(c + n * s * 0.6, s, mat)
            V += sp.v.tolist()
            T += (sp.t + b).tolist()
            N += sp.nrm.tolist()
            continue
        if kind == "pyr":
            ring = [c - n * 0.25 * s + s * (math.cos(a) * t1 + math.sin(a) * t2) for a in (0, 2.094, 4.189)]
            apex = c + n * s * height * 1.6
            v = np.array(ring + [apex])
            t = np.array([[0, 1, 3], [1, 2, 3], [2, 0, 3]])
        elif kind == "seed":
            ring = [c + t1 * s * aspect, c + t2 * s, c - t1 * s * aspect, c - t2 * s]
            v = np.array(ring + [c + n * s * height])
            t = np.array([[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]])
        else:  # blob
            ring = [c - n * 0.2 * s + s * rng.uniform(0.8, 1.15) * (math.cos(a) * t1 + math.sin(a) * t2)
                    for a in np.linspace(0, 2 * math.pi, 5, endpoint=False)]
            v = np.array(ring + [c + n * s * height * 1.4])
            t = np.array([[0, 1, 5], [1, 2, 5], [2, 3, 5], [3, 4, 5], [4, 0, 5]])
        t = fix_winding(v, t, c - n * s)
        V += v.tolist()
        T += (t + b).tolist()
        N += [None]
    if not T:
        return []
    V = np.array(V)
    T = np.array(T)
    smooth = kind in ("ball", "oct", "blob")
    return [part(mat, V, T, smooth=smooth)]


def scatter(rng: random.Random, n: int, rx: float, rz: float, cx: float = 0.0, cz: float = 0.0, inner: float = 0.0,
            mind: float = 0.0) -> np.ndarray:
    """n points in an ellipse (rx, rz), optionally outside `inner` (fraction), spaced ≥ mind (best effort)."""
    out = []
    tries = 0
    while len(out) < n and tries < n * 60:
        tries += 1
        a = rng.uniform(0, 2 * math.pi)
        r = math.sqrt(rng.uniform(inner ** 2, 1.0))
        p = (cx + rx * r * math.cos(a), cz + rz * r * math.sin(a))
        if mind and any((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 < mind ** 2 for q in out):
            continue
        out.append(p)
    return np.array(out).reshape(-1, 2)


def scatter_rect(rng, n, x0, x1, z0, z1, mind=0.0) -> np.ndarray:
    out, tries = [], 0
    while len(out) < n and tries < n * 60:
        tries += 1
        p = (rng.uniform(x0, x1), rng.uniform(z0, z1))
        if mind and any((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 < mind ** 2 for q in out):
            continue
        out.append(p)
    return np.array(out).reshape(-1, 2)


def ragged_cap(p: Part, y_thr: float, amp: float, rng: random.Random, mat: str, bins: int = 9) -> list[Part]:
    """Material cap above a ragged height threshold (toppings, flour, cheese)."""
    noise = [rng.uniform(-1, 1) for _ in range(bins)]
    c = tri_centroids(p)
    ang = (np.arctan2(c[:, 2], c[:, 0]) + math.pi) / (2 * math.pi) * bins
    i0 = np.floor(ang).astype(int) % bins
    f = ang - np.floor(ang)
    nz = np.array(noise)[i0] * (1 - f) + np.array(noise)[(i0 + 1) % bins] * f
    return split(p, c[:, 1] > y_thr + amp * nz, mat)


def ellipse_xz(rx, rz, n, cx=0.0, cz=0.0, wobble=0.0, rng=None):
    a = np.linspace(0, 2 * math.pi, n, endpoint=False)
    f = np.ones(n) if not wobble else np.array([1 + wobble * rng.uniform(-1, 1) for _ in range(n)])
    return np.column_stack([cx + rx * f * np.cos(a), cz + rz * f * np.sin(a)])


# ----------------------------------------------------------------------------------------------- shared builders


def dome_prof(H: float, foot: float = 0.86, belly: float = 0.32, flat: float = 0.85, angles=(28, 52, 74)) -> list:
    """Bread / roll profile at unit belly radius: flat-ish base, belly at belly·H, rounded top."""
    P = [(foot, 0.0), (0.975, belly * 0.45 * H), (1.0, belly * H)]
    for a in angles:
        f = math.radians(a)
        P.append((math.cos(f), belly * H + (1 - belly) * H * math.sin(f) ** flat))
    P.append((0.0, H))
    return P


def offset_for(H: float) -> float:
    return max(0.0012, 0.022 * H)


def cut_mat(crust: str, flour: bool) -> str:
    if crust == "lauge":
        return "ausbund-lauge"
    if flour:
        return "kruste-dunkel" if crust in ("kruste-dunkel", "schwarzbrot") else "kruste"
    return "ausbund"


def score(parts: list[Part], kind, W: float, D: float, H: float, crust: str, flour: bool, rng: random.Random) -> list[Part]:
    """Scoring patterns on a loaf / roll top."""
    if not kind:
        return []
    s = Surface(parts)
    m = cut_mat(crust, flour)
    off = offset_for(H)
    out = []
    w = 0.075 * min(W, D) if isinstance(kind, str) else 0.0

    def c(p0, p1, width=None, bend=0.0, n=5):
        p = cut(s, p0, p1, width or w, m, off, n=n, bend=bend)
        if p is not None:
            out.append(p)

    if kind == "kreuz":
        c((-0.30 * W, 0), (0.30 * W, 0))
        c((0, -0.30 * D), (0, 0.30 * D))
    elif kind == "gitter":
        for f in (-0.14, 0.14):
            c((-0.28 * W, f * D), (0.28 * W, f * D), w * 0.7)
            c((f * W, -0.28 * D), (f * W, 0.28 * D), w * 0.7)
    elif kind == "raute":
        q = [(0, -0.27 * D), (0.27 * W, 0), (0, 0.27 * D), (-0.27 * W, 0)]
        for i in range(4):
            c(q[i], q[(i + 1) % 4], w * 0.75)
    elif kind == "schraeg":
        for f in (-0.27, 0.0, 0.27):
            dx, dz = 0.16 * W, 0.30 * D
            c((f * W - dx, -dz), (f * W + dx, dz), w * 0.9, bend=0.05)
    elif kind == "quer":
        for f in (-0.24, 0.0, 0.24):
            c((f * W, -0.28 * D), (f * W, 0.28 * D), w * 0.8)
    elif kind == "laengs":
        c((-0.36 * W, 0), (0.36 * W, 0), 0.13 * D, bend=0.02, n=7)
    elif kind == "riss":
        for _ in range(5):
            a = rng.uniform(0, 2 * math.pi)
            r = rng.uniform(0.0, 0.28)
            cx, cz = r * W * math.cos(a), r * D * math.sin(a)
            b = rng.uniform(0, math.pi)
            L = rng.uniform(0.12, 0.2)
            c((cx - L * W * math.cos(b), cz - L * D * math.sin(b)), (cx + L * W * math.cos(b), cz + L * D * math.sin(b)),
              w * 0.55, bend=rng.uniform(-0.12, 0.12))
    return out


TOPPING_CAP = {"mohn": "mohn", "sesam": "sesam", "koerner": "koerner", "hafer": "hafer", "kaese": "kaese",
               "saaten": "koerner"}


def topping(parts: list[Part], kind, W: float, D: float, H: float, rng: random.Random, cap=(0.40, 0.40),
            power: float = 2.0, dome: Dome | None = None, e0: float = 3.0, nocap: bool = False) -> list[Part]:
    """Seed / cheese / chocolate toppings: a cap (offset shell on a Dome, or a draped patch with half extents
    cap × (W, D) on other tops) plus a few pieces on it."""
    if not kind:
        return parts
    rx, rz = cap[0] * W, cap[1] * D
    cap_mat = None if nocap else TOPPING_CAP.get(kind)
    off = 0.03 * H
    if cap_mat and dome is not None:
        ee = e0 - (0.25 if kind == "kaese" else 0.0)
        parts = dome.capped(parts, cap_mat, ee, 0.5 if kind == "kaese" else 0.3, 0.045 * H, rng)
        rx, rz = 0.40 * W, 0.40 * D
    elif cap_mat:
        wob = 0.22 if kind == "kaese" else 0.10
        pt = patch(Surface(parts), rx, rz, cap_mat, off, rng, wobble=wob, power=power,
                   dome=1.2 if kind == "kaese" else 0.3)
        if pt is not None:
            parts = parts + [pt]
    s = Surface(parts)
    sz = 0.035 * min(W, D)
    ir, iz = 0.85 * rx, 0.85 * rz
    out = []
    if kind == "mohn":
        out = dots(s, scatter(rng, 10, ir, iz, mind=sz), sz * 0.4, "mohn-hell", rng, "pyr")
    elif kind == "sesam":
        out = dots(s, scatter(rng, 14, ir, iz, mind=sz * 1.4), sz * 0.45, "zuckerguss", rng, "seed", aspect=1.8,
                   height=0.3)
    elif kind == "kuemmel":
        out = dots(s, scatter(rng, 16, rx, rz, mind=sz * 1.2), sz * 0.35, "kuemmel", rng, "seed", aspect=2.6)
    elif kind in ("koerner", "saaten"):
        out = dots(s, scatter(rng, 9, ir, iz, mind=sz * 1.8), sz * 0.8, "hafer", rng, "seed", aspect=1.8, height=0.4)
        out += dots(s, scatter(rng, 7, ir, iz, mind=sz), sz * 0.45, "sesam" if kind == "saaten" else "kruste-dunkel",
                    rng, "seed", aspect=1.6)
    elif kind == "hafer":
        out = dots(s, scatter(rng, 12, ir, iz, mind=sz * 1.6), sz * 0.85, "zuckerguss", rng, "seed", aspect=1.2,
                   height=0.25)
    elif kind == "kaese":
        out = dots(s, scatter(rng, 4, ir * 0.7, iz * 0.7, mind=sz * 3), sz * 1.0, "kruste-hell", rng, "seed",
                   aspect=1.3, height=0.1)
    elif kind == "schoko":
        out = dots(s, scatter(rng, 9, 0.38 * W, 0.38 * D, mind=sz * 2), sz * 1.1, "schoko", rng, "blob", height=0.6)
    elif kind == "rosinen":
        out = dots(s, scatter(rng, 9, 0.38 * W, 0.38 * D, mind=sz * 2), sz * 0.9, "rosine", rng, "blob", height=0.5)
    return parts + out


def flour(parts: list[Part], W, D, H, rng, cap=(0.36, 0.36), power: float = 2.0) -> list[Part]:
    pt = patch(Surface(parts), cap[0] * W, cap[1] * D, "mehl", 0.025 * H, rng, wobble=0.16, power=power)
    return parts + ([pt] if pt is not None else [])


def salt(parts: list[Part], W, D, H, rng, n=12, rx=0.34, rz=0.34) -> list[Part]:
    s = Surface(parts)
    return dots(s, scatter(rng, n, rx * W, rz * D, mind=0.05 * min(W, D)), 0.045 * min(W, D) * 0.5, "salz", rng, "pyr",
                height=0.8)


# ----------------------------------------------------------------------------------------------- recipes: bread


def r_laib(size, p, rng, idx, oval=False):
    W, D, H = size
    crust = p.get("crust", "kruste")
    segs = 16
    dm = Dome(dome_prof(H, foot=0.88, belly=0.30, flat=0.8), segs, W / 2, D / 2, crust, pinch=0.18 if oval else 0.0)
    parts = [dm.body]
    if p.get("flour"):
        parts = dm.capped(parts, "mehl", 3.55, 0.35, 0.035 * H, rng)
    parts += score(parts, p.get("cuts"), W, D, H, crust, bool(p.get("flour")), rng)
    parts = topping(parts, p.get("topping"), W, D, H, rng, dome=dm, e0=3.25)
    return parts


def r_laib_rund(size, p, rng, idx):
    return r_laib(size, p, rng, idx)


def r_laib_oval(size, p, rng, idx):
    return r_laib(size, p, rng, idx, oval=True)


def r_kastenbrot(size, p, rng, idx):
    """Tin loaf: one smooth body (pale tin walls, a rounded 'muffin top' ≤ 3 mm over the tin, darker crown)."""
    W, D, H = size
    crust = p.get("crust", "kruste")
    side = {"kruste-dunkel": "kruste", "schwarzbrot": "kruste-dunkel", "kruste": "kruste-hell"}.get(crust, "kruste-hell")
    dome = bool(p.get("dome"))
    yb = H * (0.66 if dome else 0.78)
    body = loaf(W, D, tin_rings(W, D, H, yb, 0.965), 16, side, H)
    c = tri_centroids(body)
    layers = [(c[:, 1] > yb, crust)]
    kind = p.get("topping")
    cap = TOPPING_CAP.get(kind) if kind and kind != "rosinen" else None
    if cap:   # seeded top: the whole crown above the muffin-top ring (one clean rounded border)
        layers.append((c[:, 1] > yb + 0.13 * (H - yb), cap))
    parts = paint(body, layers)
    if p.get("flour"):
        parts = flour(parts, W, D, H, rng, cap=(0.42, 0.34), power=4.0)
    if p.get("cuts") == "laengs":
        s = Surface(parts)
        parts.append(cut(s, (-0.38 * W, 0), (0.38 * W, 0), 0.24 * D, cut_mat(crust, bool(p.get("flour"))),
                         offset_for(H), n=7, bend=0.02))
    if kind == "rosinen":
        s = Surface(parts)
        sz = 0.035 * D
        parts += dots(s, scatter_rect(rng, 14, -0.42 * W, 0.42 * W, -0.32 * D, 0.32 * D, sz * 2), sz * 0.9, "rosine",
                      rng, "blob", height=0.45)
    elif kind:
        parts = topping(parts, kind, W, D, H, rng, cap=(0.40, 0.26), power=4.0, nocap=bool(cap))
    return parts


def r_rosinenbrot(size, p, rng, idx):
    return r_kastenbrot(size, dict(p, crust="kruste", topping="rosinen", dome=True), rng, idx)


def r_baguette(size, p, rng, idx):
    W, D, H = size
    crust = p.get("crust", "kruste-hell")
    n = 11
    t = np.linspace(0, 1, n)
    x = (t - 0.5) * W * 0.9
    taper = 0.40 + 0.60 * np.sin(math.pi * t) ** 0.45
    rx, ry = D / 2 * taper, H / 2 * taper
    path = np.column_stack([x, ry * 0.92, np.zeros(n)])
    body = tube(path, rx, ry, sides=8, mat=crust, tip=0.9, floor=0.0)
    parts = [body]
    floury = bool(p.get("flour"))
    if floury:
        parts = flour(parts, W, D, H, rng, cap=(0.42, 0.30), power=3.0)
    s = Surface(parts)
    k = int(p.get("cuts", 5))
    span = 0.78 * W
    step = span / k
    m = cut_mat(crust, floury)
    for i in range(k):
        cx = -span / 2 + step * (i + 0.5)
        dx = step * 0.62
        parts.append(cut(s, (cx - dx, -0.14 * D), (cx + dx, 0.14 * D), 0.34 * D, m, offset_for(H) * 1.3, n=5, bend=0.04))
    return parts


# ----------------------------------------------------------------------------------------------- recipes: rolls


def r_broetchen_rund(size, p, rng, idx):
    W, D, H = size
    crust = p.get("crust", "kruste-hell")
    segs = 14
    dm = Dome(dome_prof(H, foot=0.84, belly=0.34, flat=0.75), segs, W / 2, D / 2, crust, phase=rng.uniform(0, 1))
    parts = [dm.body]
    if p.get("flour"):
        parts = dm.capped(parts, "mehl", 3.55, 0.35, 0.035 * H, rng)
    parts += score(parts, p.get("cuts"), W, D, H, crust, bool(p.get("flour")), rng)
    parts = topping(parts, p.get("topping"), W, D, H, rng, dome=dm, e0=2.95)
    if p.get("salt"):
        parts += salt(parts, W, D, H, rng)
    return parts


def r_broetchen_stern(size, p, rng, idx):
    """Kaiser / Sternweck: five curved pinwheel grooves into the dome."""
    W, D, H = size
    crust = p.get("crust", "kruste-hell")
    segs = 20
    prof = dome_prof(H, foot=0.84, belly=0.36, flat=0.7, angles=(26, 50, 72))
    body = lathe(prof, segs, W / 2, D / 2, mat=crust)
    v = body.v
    th = np.arctan2(v[:, 2] / (D / 2), v[:, 0] / (W / 2))
    rho = np.hypot(v[:, 0] / (W / 2), v[:, 2] / (D / 2))
    # rows above the belly get grooves; offset grows inwards by one vertex step per ring (pinwheel)
    step = 2 * math.pi / segs
    G = np.zeros(len(v))
    ring = np.zeros(len(v))
    ring[segs * 3:segs * 4] = 1
    ring[segs * 4:segs * 5] = 2
    ring[segs * 5:segs * 6] = 3
    for k in range(5):
        c = 2 * math.pi * k / 5 + ring * step
        dth = np.angle(np.exp(1j * (th - c)))
        G = np.maximum(G, np.exp(-(dth / 0.22) ** 2))
    G *= (ring > 0)
    v[:, 1] -= G * 0.13 * H * np.clip(rho * 1.4, 0.3, 1.0)
    v[:, 0] *= 1 - 0.05 * G
    v[:, 2] *= 1 - 0.05 * G
    body.nrm = smooth_normals(v, body.t)
    body.ao = 1 - 0.38 * G
    parts = [body]
    s = Surface(parts)
    parts.append(disc(0, 0, 0.09 * min(W, D), s.hit([(0, 0)])[0][0] + 0.0008, 6, "ausbund"))
    return parts


def r_broetchen_schlitz(size, p, rng, idx):
    W, D, H = size
    crust = p.get("crust", "kruste-hell")
    if p.get("pointed"):
        n = 9
        t = np.linspace(0, 1, n)
        taper = 0.30 + 0.70 * np.sin(math.pi * t) ** 0.6
        rx, ry = D / 2 * taper, H / 2 * taper
        body = tube(np.column_stack([(t - 0.5) * W * 0.86, ry * 0.95, np.zeros(n)]), rx, ry, sides=8, mat=crust,
                    tip=1.2, floor=0.0)
    else:
        dm = Dome(dome_prof(H, foot=0.84, belly=0.36, flat=0.8), 14, W / 2, D / 2, crust, pinch=0.20)
        body = dm.body
    parts = [body]
    floury = bool(p.get("flour"))
    if floury:
        parts = dm.capped(parts, "mehl", 3.55, 0.35, 0.04 * H, rng) if not p.get("pointed") else \
            flour(parts, W, D, H, rng, cap=(0.36, 0.30))
    s = Surface(parts)
    m = "ausbund"
    parts.append(cut(s, (-0.36 * W, 0), (0.36 * W, 0), 0.36 * D, m, offset_for(H) * 1.2, n=7, bend=0.03))
    return parts


def r_doppelweck(size, p, rng, idx):
    W, D, H = size
    crust = p.get("crust", "kruste-hell")
    n = int(p.get("lobes", 2))
    ov = 0.22
    lw = W / (n - (n - 1) * ov)
    segs = 12 if n == 2 else 10
    parts = []
    for i in range(n):
        cx = -W / 2 + lw / 2 + i * lw * (1 - ov)
        hh = H * (1.0 if n == 2 else (0.96 if i in (0, n - 1) else 1.0))
        b = lathe(dome_prof(hh, foot=0.84, belly=0.34, flat=0.8, angles=(35, 65)), segs, lw / 2, D / 2, mat=crust,
                  phase=math.pi / segs)
        b.v[:, 0] += cx
        # crease AO where the lobes meet
        dj = np.full(len(b.v), 1e9)
        for j in range(n - 1):
            xj = -W / 2 + lw / 2 + (j + 0.5) * lw * (1 - ov)
            dj = np.minimum(dj, np.abs(b.v[:, 0] - xj))
        b.ao = 1 - 0.32 * np.exp(-(dj / (0.18 * lw)) ** 2)
        parts.append(b)
    if n == 2:
        s = Surface(parts)
        for i in range(n):
            cx = -W / 2 + lw / 2 + i * lw * (1 - ov)
            parts.append(cut(s, (cx - 0.05 * lw, -0.28 * D), (cx + 0.05 * lw, 0.28 * D), 0.12 * lw, "ausbund",
                             offset_for(H), n=5))
    return parts


def fit_xf(parts: list[Part], size) -> tuple[np.ndarray, np.ndarray]:
    """Per-axis scale and offset that `fit` would apply (to map construction paths along)."""
    lo, hi = bbox(parts)
    sc = np.array([size[0], size[2], size[1]]) / np.maximum(hi - lo, 1e-9)
    lo2, hi2 = lo * sc, hi * sc
    return sc, np.array([-(lo2[0] + hi2[0]) / 2, -lo2[1], -(lo2[2] + hi2[2]) / 2])


def side_points(path: np.ndarray, half: np.ndarray, k: int, i0: int, i1: int) -> np.ndarray:
    """Zig-zag across a horizontal path (xz) between samples i0..i1: alternately ± half width (icing drizzle)."""
    i = np.linspace(i0, i1, k)
    idx = np.arange(len(path))
    x = np.interp(i, idx, path[:, 0])
    z = np.interp(i, idx, path[:, 1])
    d = np.gradient(path, axis=0)
    d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-12)
    nx = np.interp(i, idx, -d[:, 1])
    nz = np.interp(i, idx, d[:, 0])
    h = np.interp(i, idx, half) * np.where(np.arange(k) % 2 == 0, 1, -1)
    return np.column_stack([x + nx * h, z + nz * h])


def r_hoernchen(size, p, rng, idx, croissant=False):
    """Crescent (Hörnchen / croissant): a tapered tube along a > 180° arc, ends curling back."""
    W, D, H = size
    crust = p.get("crust", "kruste-hell")
    n = 17 if croissant else 15
    sides = 7
    t = np.linspace(0, 1, n)
    a = -0.32 + (math.pi + 0.64) * t
    x, z = -np.cos(a), -np.sin(a)
    r = (0.12 + 0.36 * np.sin(math.pi * t) ** 0.85) if not croissant else (0.10 + 0.42 * np.sin(math.pi * t) ** 0.9)
    bulge = np.abs(np.cos(math.pi * 3.5 * (2 * t - 1)))
    if croissant:
        r = r * (0.84 + 0.16 * bulge)
    else:
        r = r * (0.93 + 0.07 * bulge)
    ry = 0.82 * r
    body = tube(np.column_stack([x, ry * 0.95, z]), r, ry, sides=sides, mat=crust, tip=0.9, floor=0.0)
    body.ao = np.concatenate([np.repeat((0.80 if croissant else 0.90) + (0.20 if croissant else 0.10) * bulge, sides),
                              [1.0, 1.0]])
    sc, off = fit_xf([body], size)
    parts = transform([body], np.diag(sc), off)
    path = np.column_stack([x * sc[0] + off[0], z * sc[2] + off[2]])
    half = r * sc[2]
    tp = p.get("topping")
    if tp:
        cap = {"mohn": "mohn", "sesam": "sesam", "koerner": "koerner"}[tp]
        b = parts[0]
        parts = split(b, face_normals(b)[:, 1] > 0.45, cap)
        cand = np.concatenate([tri_centroids(q)[face_normals(q)[:, 1] > 0.6] for q in parts if q.mat == cap])
        pick = sorted(rng.sample(range(len(cand)), min(12, len(cand))))
        kind, f, m = {"mohn": ("pyr", 0.010, "mohn-hell"), "sesam": ("seed", 0.012, "zuckerguss"),
                      "koerner": ("seed", 0.020, "hafer")}[tp]
        parts += dots(Surface(parts), cand[pick][:, [0, 2]], f * W * 0.6, m, rng, kind, height=0.35)
    gl = p.get("glaze")
    if gl:
        m = "zuckerguss" if gl == "zuckerguss" else "schoko"
        pts = side_points(path, half * 0.75, 11, 2, n - 3)
        st = drizzle(Surface(parts), pts, 0.0065, m, 0.0025, sub=2)
        if st is not None:
            parts.append(st)
    return parts


def r_croissant(size, p, rng, idx):
    return r_hoernchen(size, dict(p, crust=p.get("crust", "kruste")), rng, idx, croissant=True)


def r_hoernchen_plain(size, p, rng, idx):  # noqa: D103
    return r_hoernchen(size, p, rng, idx)


# ----------------------------------------------------------------------------------------------- recipes: Laugengebäck


PRETZEL = np.array([
    (-0.30, -0.36), (-0.20, -0.16), (0.0, 0.03), (0.20, 0.20), (0.42, 0.38), (0.64, 0.46), (0.84, 0.36), (0.94, 0.12),
    (0.88, -0.14), (0.72, -0.38), (0.46, -0.54), (0.16, -0.62), (-0.16, -0.62), (-0.46, -0.54), (-0.72, -0.38),
    (-0.88, -0.14), (-0.94, 0.12), (-0.84, 0.36), (-0.64, 0.46), (-0.42, 0.38), (-0.20, 0.20), (0.0, 0.03),
    (0.20, -0.16), (0.30, -0.36)])


def catmull(P: np.ndarray, n: int) -> np.ndarray:
    """Centripetal-free uniform Catmull-Rom through P, resampled to n points by arc length."""
    Q = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    out = []
    for i in range(1, len(Q) - 2):
        p0, p1, p2, p3 = Q[i - 1], Q[i], Q[i + 1], Q[i + 2]
        for s in np.linspace(0, 1, 12, endpoint=False):
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s ** 2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * s ** 3))
    out.append(P[-1])
    out = np.array(out)
    d = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(out, axis=0), axis=1))])
    u = np.linspace(0, d[-1], n)
    return np.column_stack([np.interp(u, d, out[:, k]) for k in range(out.shape[1])])


def r_brezel(size, p, rng, idx):
    """Swabian-style pretzel: thick belly at the front with the light opened "Ausbund", thin arms crossing in a twist
    and resting on the belly, two loops; coarse salt."""
    W, D, H = size
    n = 25
    P2 = catmull(PRETZEL, n)
    sp = np.linspace(0, 1, n)
    belly = np.exp(-((sp - 0.5) / 0.15) ** 2)
    arm = np.exp(-((np.minimum(sp, 1 - sp)) / 0.09) ** 2)
    r = 0.072 + 0.11 * belly - 0.022 * arm
    y = r * 0.80
    y = y + 0.07 * np.exp(-((sp - 0.12) / 0.06) ** 2)        # first pass over the twist lies on top
    y = y + 0.025 * np.exp(-((sp - 0.88) / 0.06) ** 2)
    y = y + 0.05 * (np.exp(-(sp / 0.05) ** 2) + np.exp(-((1 - sp) / 0.05) ** 2))  # arm ends rest on the belly
    path = np.column_stack([P2[:, 0], y, -P2[:, 1]])
    body = tube(path, r * 1.05, r * 0.82, sides=5, mat="lauge", tip=0.7, floor=0.0)
    sc, off = fit_xf([body], size)
    parts = transform([body], np.diag(sc), off)
    bp = np.column_stack([path[:, 0] * sc[0] + off[0], path[:, 2] * sc[2] + off[2]])
    i0, i1 = int(n * 0.38), int(n * 0.38) + 6
    lens = bp[i0:i1].copy()
    lens[:, 1] -= 0.10 * r[i0:i1] * sc[2]                      # a little towards the back of the belly
    hw = 0.55 * r[i0:i1] * sc[2] * np.sin(np.linspace(0, math.pi, i1 - i0)) ** 0.5
    st = strip(Surface(parts), lens, hw, "ausbund-lauge", 0.0012, sink=0.5, ao_edge=0.85)
    if st is not None:
        parts.append(st)
    return parts + salt_on(parts, rng, 9, 0.003)


def salt_on(parts: list[Part], rng: random.Random, n: int, size: float, mats=("lauge",)) -> list[Part]:
    """Coarse salt grains on random upward facets of the given materials."""
    cand = np.concatenate([tri_centroids(q)[face_normals(q)[:, 1] > 0.5] for q in parts if q.mat in mats])
    pick = sorted(rng.sample(range(len(cand)), min(n, len(cand))))
    return dots(Surface(parts), cand[pick][:, [0, 2]], size, "salz", rng, "pyr", height=0.9)


def r_laugenstange(size, p, rng, idx):
    W, D, H = size
    crust = p.get("crust", "lauge")
    n = 9
    t = np.linspace(0, 1, n)
    taper = 0.55 + 0.45 * np.sin(math.pi * t) ** 0.35
    rx, ry = D / 2 * taper, H / 2 * taper
    body = tube(np.column_stack([(t - 0.5) * W * 0.9, ry * 0.9, np.zeros(n)]), rx, ry, sides=7, mat=crust, tip=0.9,
                floor=0.0)
    parts = [body]
    if p.get("topping") == "kaese":
        c = tri_centroids(body)
        parts = split(body, (face_normals(body)[:, 1] > 0.30) & (np.abs(c[:, 0]) < 0.44 * W), "kaese")
        s = Surface(parts)
        parts += dots(s, scatter_rect(rng, 6, -0.38 * W, 0.38 * W, -0.15 * D, 0.15 * D, 0.03 * W), 0.012, "kaese",
                      rng, "blob", height=0.5)
        if p.get("ham"):
            s = Surface(parts)
            parts += dots(s, scatter_rect(rng, 8, -0.4 * W, 0.4 * W, -0.15 * D, 0.15 * D, 0.025 * W), 0.007,
                          "schinken", rng, "blob", height=0.7)
        return parts
    s = Surface(parts)
    for f in (-0.25, 0.0, 0.25):
        parts.append(cut(s, (f * W - 0.04 * W, -0.30 * D), (f * W + 0.04 * W, 0.30 * D), 0.2 * D, "ausbund-lauge",
                         offset_for(H) * 1.2, n=5))
    if p.get("salt"):
        parts += salt(parts, W, D, H, rng, n=12, rx=0.44, rz=0.22)
    return parts


def r_laugenecke(size, p, rng, idx):
    W, D, H = size
    segs = 15

    def tri_mod(th, i):
        k = (th + math.pi / 2) % (2 * math.pi / 3) - math.pi / 3
        return (0.5 / np.cos(k)) ** 0.55 * 1.0

    body = lathe(dome_prof(H, foot=0.84, belly=0.32, flat=0.9), segs, W / 2, D / 2, mat="lauge", rmod=tri_mod,
                 phase=-math.pi / 2)
    parts = [body]
    s = Surface(parts)
    parts.append(cut(s, (-0.2 * W, 0.08 * D), (0.2 * W, 0.08 * D), 0.16 * D, "ausbund-lauge", offset_for(H), n=5))
    parts += salt(parts, W, D, H, rng, n=12, rx=0.3, rz=0.3)
    return parts


# ----------------------------------------------------------------------------------------------- recipes: Teilchen

FILL = {"schoko": "schoko", "pudding": "pudding", "rosinen": "krume", "nuss": "nuss", "mohn": "mohn",
        "quark": "quark", "kirsch": "kirsche"}


def pick_filling(p, idx) -> str:
    f = p.get("fillings")
    return f[idx % len(f)] if f else p.get("filling", "pudding")


def r_schnecke(size, p, rng, idx):
    """Rolled snail: low dough dome with the filling spiral on top (a wide band of the filling colour), icing."""
    W, D, H = size
    fill = pick_filling(p, idx)
    body = lathe(dome_prof(H, foot=0.92, belly=0.45, flat=0.5, angles=(30, 62)), 14, W / 2, D / 2, mat="kruste-hell")
    parts = [body]
    s = Surface(parts)
    turns = 2.4
    k = 26
    th = np.linspace(0.9, 2 * math.pi * turns, k)
    rr = 0.46 * th / th[-1]
    pts = np.column_stack([rr * W * np.cos(th), rr * D * np.sin(th)])
    hw = np.full(k, 0.045 * W) * np.clip(th / 3.0, 0.4, 1.0)
    st = strip(s, pts, hw, FILL[fill], offset_for(H) * 1.2, sink=0.6, ao_edge=0.8)
    if st is not None:
        parts.append(st)
    s = Surface(parts)
    if fill == "rosinen":
        parts += dots(s, pts[4::4], 0.0045, "rosine", rng, "blob", height=0.5)
    ice = np.array([[-0.30 * W, -0.10 * D], [-0.12 * W, 0.12 * D], [0.06 * W, -0.10 * D], [0.24 * W, 0.12 * D]])
    st = strip(Surface(parts), ice, 0.0030, "zuckerguss", offset_for(H) * 2.2, sink=0.0, ao_edge=1.0)
    if st is not None:
        parts.append(st)
    return parts


def r_tasche(size, p, rng, idx):
    W, D, H = size
    form = p.get("form", "umschlag")
    fill = FILL[pick_filling(p, idx)]
    hb = 0.55 * H
    parts = []
    if form == "dreieck":
        def tri_mod(th, i):
            k = (th + math.pi / 2) % (2 * math.pi / 3) - math.pi / 3
            return (0.5 / np.cos(k)) ** 0.75
        body = lathe(dome_prof(H, foot=0.9, belly=0.4, flat=1.0, angles=(30, 60)), 15, W / 2, D / 2,
                     mat="kruste-hell", rmod=tri_mod, phase=-math.pi / 2)
        parts = [body]
        s = Surface(parts)
        parts.append(cut(s, (-0.22 * W, 0.12 * D), (0.22 * W, 0.12 * D), 0.20 * D, fill, offset_for(H) * 1.2, n=6))
        parts.append(strip(Surface(parts), np.array([[-0.25 * W, -0.05 * D], [-0.1 * W, -0.15 * D], [0.05 * W, -0.05 * D],
                                                     [0.2 * W, -0.16 * D]]), 0.003, "zuckerguss", offset_for(H) * 1.5,
                           sink=0.0, ao_edge=1.0))
        return parts
    parts += box(-W / 2, W / 2, 0, hb, -D / 2, D / 2, 0.006, "kruste-hell")
    if form == "umschlag":
        # four corner flaps folded towards the centre (low pyramids), the filling peeks out in the middle
        for sx, sz in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
            c = np.array([sx * W / 2, hb, sz * D / 2]) * np.array([0.97, 1, 0.97])
            e1 = np.array([sx * W / 2 * 0.97, hb, 0.0])
            e2 = np.array([0.0, hb, sz * D / 2 * 0.97])
            tipp = np.array([sx * 0.12 * W, H * 0.98, sz * 0.12 * D])
            mid = (c + e1 + e2 + tipp) / 4 + np.array([0, 0.25 * (H - hb), 0])
            v = np.array([c, e1, tipp, e2, mid])
            t = np.array([[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]])
            v[:, 1] = np.maximum(v[:, 1], hb)
            parts.append(Part("kruste", v, fix_winding(v, t, np.array([sx * W / 4, hb - 0.01, sz * D / 4])), None))
        parts.append(lathe([(1.0, hb), (0.8, H * 0.95), (0.0, H * 1.02)], 8, 0.17 * W, 0.17 * D, mat=fill))
    else:  # quadrat: pudding pool in a raised rim
        parts.append(lathe([(1.0, hb), (0.95, hb + 0.25 * (H - hb)), (0.0, hb + 0.35 * (H - hb))], 10, 0.30 * W,
                           0.30 * D, mat=fill))
        rim = [(1.0, hb), (1.0, H * 0.9), (0.86, H), (0.72, H * 0.9), (0.7, hb)]
        r = lathe(rim, 10, 0.42 * W, 0.42 * D, mat="kruste", phase=math.pi / 10)
        parts.append(r)
    return parts


def r_pain(size, p, rng, idx):
    W, D, H = size
    n = 7
    t = np.linspace(0, 1, n)
    bul = 1 + 0.10 * np.cos(2 * math.pi * 1.5 * t) ** 2
    body = tube(np.column_stack([(t - 0.5) * W * 0.86, H * 0.47 * bul, np.zeros(n)]), D / 2 * bul, H / 2 * bul,
                sides=8, mat="kruste", tip=0.35, floor=0.0, phase=math.pi / 8)
    body.ao = np.concatenate([np.repeat(0.82 + 0.18 * np.cos(2 * math.pi * 1.5 * t) ** 2, 8), [1, 1]])
    parts = [body]
    for sx in (-1, 1):
        x0 = sx * W * 0.49
        parts += box(min(x0, x0 - sx * 0.03), max(x0, x0 - sx * 0.03), H * 0.36, H * 0.56, -0.32 * D, 0.32 * D, 0.002,
                     "schoko")
    return parts


def r_muffin(size, p, rng, idx):
    W, D, H = size
    segs = 16

    def flute(th, i):
        return 1 + 0.035 * np.where(np.arange(len(th)) % 2 == 0, 1, -1)

    cup = lathe([(0.74, 0.0), (0.86, 0.55 * H)], segs, W / 2, D / 2, mat="papier", rmod=flute)
    top = lathe([(0.80, 0.50 * H), (1.0, 0.62 * H), (0.93, 0.80 * H), (0.62, 0.94 * H), (0.0, H)], segs, W / 2, D / 2,
                mat="schoko-biskuit" if p.get("topping") == "schoko" else "biskuit", phase=math.pi / segs)
    parts = [cup, top]
    s = Surface(parts)
    parts += dots(s, scatter(rng, 8, 0.36 * W, 0.36 * D, mind=0.012), 0.0055, "schoko", rng, "blob", height=0.6)
    return parts


def r_granatsplitter(size, p, rng, idx):
    W, D, H = size
    base = lathe([(0.98, 0.0), (1.0, 0.10 * H), (0.96, 0.17 * H), (0.0, 0.17 * H)], 12, W / 2, D / 2, mat="biskuit")
    dome = lathe([(0.9, 0.15 * H), (0.86, 0.40 * H), (0.70, 0.66 * H), (0.42, 0.88 * H), (0.0, H)], 12, W / 2, D / 2,
                 mat="schoko", phase=math.pi / 12)
    parts = [base, dome]
    s = Surface(parts)
    a = np.linspace(0, 2 * math.pi, 7)
    pts = np.column_stack([0.12 * W * np.cos(a * 2), 0.12 * D * np.sin(a * 3)])
    parts.append(strip(s, pts, 0.0022, "zuckerguss", 0.0012, sink=0.0, ao_edge=1.0))
    return parts


# ----------------------------------------------------------------------------------------------- recipes: Kuchen


def cake_top(parts, kind, x0, x1, z0, z1, H, rng, rect=True, density=1.0) -> list[Part]:
    """Topping details over a rectangle (Blech) or an ellipse (round cake) on the current top surface."""
    s = Surface(parts)
    W, D = x1 - x0, z1 - z0
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    area = W * D / 0.01  # in 10 × 10 cm units

    def pts(n, mind):
        n = max(3, int(round(n * density)))
        if rect:
            return scatter_rect(rng, n, x0 + 0.06 * W, x1 - 0.06 * W, z0 + 0.06 * D, z1 - 0.06 * D, mind)
        return scatter(rng, n, 0.43 * W, 0.43 * D, cx, cz, mind=mind)

    off = offset_for(H)
    if kind == "streusel":
        return dots(s, pts(16 * area ** 0.6, 0.011), 0.011, "streusel", rng, "blob", height=0.7)
    if kind == "kirsch":
        return dots(s, pts(7 * area ** 0.6, 0.02), 0.0085, "kirsche", rng, "ball" if area < 3 else "oct")
    if kind == "apfel":
        out = []
        P = pts(6 * area ** 0.6, 0.026)
        for (x, z) in P:
            a = rng.uniform(0, math.pi)
            L, w = 0.026, 0.009
            c, sn = math.cos(a), math.sin(a)
            q = np.array([[-L, 0], [-0.4 * L, w], [0.4 * L, w], [L, 0], [0.4 * L, -0.4 * w], [-0.4 * L, -0.4 * w]])
            q = q @ np.array([[c, sn], [-sn, c]]) + (x, z)
            yy, _, ok = s.hit(q)
            if not ok.all():
                continue
            v = np.column_stack([q[:, 0], yy + off + np.array([0, 0.004, 0.004, 0, 0.002, 0.002]), q[:, 1]])
            t = np.array([[0, 1, 5], [1, 4, 5], [1, 2, 4], [2, 3, 4]])
            fn = np.cross(v[t[:, 1]] - v[t[:, 0]], v[t[:, 2]] - v[t[:, 0]])
            t[fn[:, 1] < 0] = t[fn[:, 1] < 0][:, [0, 2, 1]]
            out.append(part("apfel", v, t, smooth=False))
        return out
    if kind == "rahm":
        return dots(s, pts(9 * area ** 0.6, 0.015), 0.006, "kruste-hell", rng, "seed", aspect=1.3, height=0.08)
    if kind == "kaese":
        return dots(s, pts(5 * area ** 0.6, 0.025), 0.009, "kruste-hell", rng, "seed", aspect=1.4, height=0.06)
    if kind == "butter":
        return (dots(s, pts(9 * area ** 0.6, 0.013), 0.0045, "kruste", rng, "seed", aspect=1.0, height=-0.2)
                + dots(s, pts(7 * area ** 0.6, 0.013), 0.006, "mandel", rng, "seed", aspect=1.6, height=0.15))
    return []


# topping kind -> (top colour, filling colour seen on cut faces)
TOP_MASS = {"streusel": ("biskuit", "krume"), "kirsch": ("biskuit", "biskuit"), "apfel": ("butter", "apfel"),
            "rahm": ("rahm", "rahm"), "kaese": ("kruste-hell", "kaesemasse"), "butter": ("butter", "krume")}


def r_blech_stueck(size, p, rng, idx):
    W, D, H = size
    kind = p.get("topping") or p.get("toppings", ["streusel"])[idx % len(p.get("toppings", ["streusel"]))]
    top_mat, fill_mat = TOP_MASS[kind]
    yb = 0.62 * H if kind != "kaese" else 0.30 * H
    # baked sides (crust tone, the contact shadow darkens the foot); crumb shows only in the thin topping layer
    parts = box(-W / 2, W / 2, 0, yb, -D / 2, D / 2, 0.004, "kruste-hell")
    if kind == "kaese":
        parts += box(-W / 2 + 0.001, W / 2 - 0.001, yb - 0.001, H * 0.9, -D / 2 + 0.001, D / 2 - 0.001, 0.004,
                     "kaesemasse", top="kruste-hell")
    else:
        parts += box(-W / 2 + 0.002, W / 2 - 0.002, yb - 0.001, yb + 0.12 * H, -D / 2 + 0.002, D / 2 - 0.002, 0.003,
                     fill_mat if kind in ("kirsch", "apfel", "rahm") else top_mat, top=top_mat)
    parts += cake_top(parts, kind, -W / 2, W / 2, -D / 2, D / 2, H, rng, density=1.0)
    return parts


def r_blechkuchen(size, p, rng, idx):
    W, D, H = size
    tops = p.get("toppings", ["streusel", "apfel", "kirsch", "butter"])
    yb = 0.62 * H
    parts = box(-W / 2, W / 2, 0, yb, -D / 2, D / 2, 0.006, "kruste-hell")
    k = len(tops)
    for i, kind in enumerate(tops):
        x0 = -W / 2 + W * i / k
        x1 = x0 + W / k
        m, f = TOP_MASS[kind]
        parts += box(x0 + 0.002, x1 - 0.002, yb - 0.001, yb + 0.14 * H, -D / 2 + 0.003, D / 2 - 0.003, 0.003, f, top=m)
        parts += cake_top(parts, kind, x0, x1, -D / 2, D / 2, H, rng, density=0.55)
    return parts


def r_rundkuchen(size, p, rng, idx):
    W, D, H = size
    kind = p.get("topping", "streusel")
    segs = 24
    top_mat, _ = TOP_MASS[kind]
    body = lathe([(1.0, 0.0), (1.0, 0.78 * H), (0.985, 0.86 * H), (0.95, 0.88 * H), (0.0, 0.90 * H)], segs, W / 2, D / 2,
                 mat="kruste-hell")
    c = tri_centroids(body)
    parts = split(body, c[:, 1] > 0.865 * H, top_mat if kind != "kaese" else "kruste-hell")
    if kind == "kaese":   # cheesecake: golden dome inside a light rim
        parts.append(lathe([(0.93, 0.86 * H), (0.7, 0.97 * H), (0.0, H)], segs, W / 2, D / 2, mat="kruste-hell",
                           phase=math.pi / segs))
    parts += cake_top(parts, kind, -W / 2, W / 2, -D / 2, D / 2, H, rng, rect=False, density=0.75)
    if kind in ("rahm", "kaese"):
        s = Surface(parts)
        for i in range(10):
            a = 2 * math.pi * i / 10 + 0.3
            pts = np.array([[0.02 * W * math.cos(a), 0.02 * D * math.sin(a)], [0.46 * W * math.cos(a), 0.46 * D * math.sin(a)]])
            pts = np.vstack([pts[0], (pts[0] + pts[1]) / 2, pts[1]])
            parts.append(strip(s, pts, 0.0011, "kruste", offset_for(H) * 0.6, sink=0.0, ao_edge=1.0))
    return parts


def r_kuchen_stueck(size, p, rng, idx):
    """Wedge of a round cake: tip towards +z (the visitor), cut faces show base, mass and topping."""
    from shapely.geometry import Polygon
    W, D, H = size
    kind = p.get("topping", "rahm")
    n_pieces = int(p.get("pieces", 10))
    ang = 2 * math.pi / n_pieces
    R = D if n_pieces > 4 else D
    k = 4 if n_pieces > 4 else 8
    a = np.linspace(-ang / 2, ang / 2, k + 1) - math.pi / 2
    arc = [(R * math.cos(t), R * math.sin(t)) for t in a]
    poly = Polygon([(0.0, 0.0)] + arc[::-1])         # (x, z) with z negative = away from the visitor
    top_mat, mass = TOP_MASS[kind]
    yb = 0.28 * H
    parts = prism(poly, 0, yb, "kruste-hell", "kruste-hell")
    if kind == "kaese":
        parts += prism(poly, yb, H * 0.92, "kaesemasse", "kruste-hell")
    elif kind == "streusel":
        parts = prism(poly, 0, 0.75 * H, "krume", "biskuit")
    else:
        parts += prism(poly, yb, 0.8 * H, mass, top_mat)
    parts = [Part(q.mat, q.v + np.array([0, 0, R * 0.5]), q.t, q.nrm, q.ao) for q in parts]
    lo, hi = bbox(parts)
    parts += cake_top(parts, kind, lo[0] * 0.5, hi[0] * 0.5, lo[2] + 0.1 * D, hi[2] - 0.35 * D, H, rng, density=0.8)
    return parts


def r_kastenkuchen(size, p, rng, idx):
    """Loaf cake (Marmor, Zitrone, Nuss): one smooth body in a tapered tin, rounded top with the long crack; lemon:
    white glaze with drips, nut: chocolate coat, marble: icing-sugar flecks."""
    W, D, H = size
    kind = p.get("kind", "marmor")
    yb = 0.74 * H
    crust = "kruste" if kind != "zitrone" else "kruste-hell"
    body = loaf(W, D, tin_rings(W, D, H, yb, 0.93, crown=(30, 58, 80)), 16, crust, H)
    c = tri_centroids(body)
    if kind == "zitrone":
        parts = paint(body, [(c[:, 1] > yb + 0.10 * (H - yb), "zuckerguss")])
    elif kind == "nuss":
        parts = paint(body, [(c[:, 1] > 0.80 * yb, "schoko")])
    else:
        parts = [body]
    s = Surface(parts)
    parts.append(cut(s, (-0.36 * W, 0), (0.36 * W, 0), 0.16 * D, "krume" if kind != "nuss" else "nuss",
                     offset_for(H), n=7, bend=0.02))
    if kind == "zitrone":
        for x in np.linspace(-0.4 * W, 0.4 * W, 5):
            for sz in (-1, 1):
                L = rng.uniform(0.25, 0.45) * yb
                z0, z1 = sorted((sz * D / 2 - sz * 0.002, sz * D / 2 + sz * 0.0045))
                parts += box(x - 0.008, x + 0.008, yb - L, yb + 0.004, z0, z1, 0.0, "zuckerguss")
    elif kind == "marmor":
        s = Surface(parts)
        parts += dots(s, scatter_rect(rng, 14, -0.42 * W, 0.42 * W, -0.30 * D, 0.30 * D, 0.02), 0.006, "zuckerguss",
                      rng, "seed", aspect=1.2, height=0.1)
    return parts


def r_kastenkuchen_scheibe(size, p, rng, idx):
    """Slice lying on its side: the cut face (crumb) on top, crust along the rim, the cake's top on −z."""
    from shapely.geometry import Polygon
    W, D, H = size
    kind = p.get("kind", "marmor")
    crumb = {"marmor": "krume", "zitrone": "zitrone", "nuss": "nuss"}[kind]
    # cross-section of the loaf in (x, z): bottom edge at +z, domed top towards −z
    xs = np.linspace(-W / 2, W / 2, 9)
    top = [(x, -D * 0.25 - 0.25 * D * (1 - (abs(x) / (W / 2)) ** 3)) for x in xs]
    poly = Polygon([(W / 2 * 0.93, D / 2), (-W / 2 * 0.93, D / 2), (-W / 2, -D * 0.25)] + top[1:-1] + [(W / 2, -D * 0.25)])
    parts = prism(poly, 0, H, "kruste", crumb)
    s = Surface(parts)
    if kind == "marmor":
        for _ in range(4):
            c = (rng.uniform(-0.25, 0.25) * W, rng.uniform(-0.2, 0.3) * D)
            q = ellipse_xz(rng.uniform(0.08, 0.14) * W, rng.uniform(0.05, 0.1) * D, 7, c[0], c[1], 0.3, rng)
            yy, _, ok = s.hit(q)
            if not ok.all():
                continue
            yy = yy + 0.0008
            v = np.vstack([[c[0], yy.max(), c[1]], np.column_stack([q[:, 0], yy, q[:, 1]])])
            t = [[0, 1 + (j + 1) % 7, 1 + j] for j in range(7)]
            parts.append(part("schoko-biskuit", v, t, smooth=False))
    if kind in ("zitrone", "nuss"):
        m = "zuckerguss" if kind == "zitrone" else "schoko"
        edge = np.array(top)
        edge[:, 1] += 0.004
        parts.append(strip(s, edge, 0.005, m, 0.0009, sink=0.0, ao_edge=1.0))
    return parts


def rope(path, r0, ry: float, sides: int, twists: float, mat: str, closed: bool, amp: float = 0.2,
         lobes: int = 2) -> tuple[Part, np.ndarray]:
    """Tube whose cross-section has `lobes` bulges that rotate along the path (a twisted rope / two-strand Kranz).
    Returns the part and the per-vertex groove factor (1 = groove bottom)."""
    P = np.asarray(path, np.float64)
    n = len(P)
    body = tube(P, r0, r0 * ry, sides=sides, mat=mat, closed=closed, tip=0.6, phase=0.0)
    a = 2 * math.pi * np.arange(sides) / sides
    u = np.arange(n) / (n if closed else n - 1)
    ph = lobes * (a[None, :] - 2 * math.pi * twists * u[:, None] / lobes)
    f = np.cos(ph)                                   # +1 = strand crest, −1 = groove between strands
    ring = body.v[:n * sides].reshape(n, sides, 3)
    c = P[:, None, :]
    ring = c + (ring - c) * (1 + amp * f)[..., None]
    body.v[:n * sides] = ring.reshape(-1, 3)
    body.v[:, 1] = np.maximum(body.v[:, 1], 0.0)
    body.nrm = smooth_normals(body.v, body.t)
    g = np.concatenate([np.clip(-f, 0, 1).reshape(-1), np.zeros(len(body.v) - n * sides)])
    body.ao = 1 - 0.40 * g
    return body, g


def r_kranzkuchen(size, p, rng, idx, quarter=False):
    """Hefekranz: a two-strand twisted ring (rope torus), icing drizzle; filled: a filling core inside the rope peeks
    out along the grooves between the strands (the depth test draws a smooth spiral line, not a quad staircase),
    with almond flakes; unfilled: pearl sugar."""
    W, D, H = size
    filled = bool(p.get("filled"))
    fill = FILL[pick_filling(p, idx)] if filled else None
    Rout, a = 0.13, 0.042
    Rc = Rout - a
    if quarter:
        n = 10
        th = np.linspace(-0.75 * math.pi, -0.25 * math.pi, n)
    else:
        n = 30
        th = np.linspace(0, 2 * math.pi, n, endpoint=False)
    path = np.column_stack([Rc * np.cos(th), np.full(n, 0.030), Rc * np.sin(th)])
    twists = 5.0 * (0.25 if quarter else 1.0)
    body, g = rope(path, a * 0.92, 0.72, 8, twists, "kruste", closed=not quarter, amp=0.30)
    parts = [body]
    if filled:
        nc = 6 if quarter else 20
        tc = np.linspace(th[0], th[-1], nc) if quarter else np.linspace(0, 2 * math.pi, nc, endpoint=False)
        cpath = np.column_stack([Rc * np.cos(tc), np.full(nc, 0.030), Rc * np.sin(tc)])
        core = tube(cpath, a * 0.92 * 0.88, a * 0.92 * 0.72 * 0.88, sides=4, mat=fill, closed=not quarter, tip=0.3,
                    phase=0.0, floor=0.0)
        core.ao = np.full(len(core.v), 0.85)
        parts.append(core)
    s = Surface(parts)
    m = 13 if quarter else 37
    t = np.linspace(th[0] + 0.10, th[-1] - 0.10, m) if quarter else np.linspace(0, 2 * math.pi, m)
    rr = Rc + 0.20 * a * np.sin(6 * t)                   # smooth wave along the crown, not a star
    st = drizzle(s, np.column_stack([rr * np.cos(t), rr * np.sin(t)]), 0.007, "zuckerguss", 0.003, sub=1)
    if st is not None:
        parts.append(st)
    tr = (th[0], th[-1])
    if not filled:
        pts = [((Rc + rng.uniform(-0.6, 0.6) * a) * math.cos(t0), (Rc + rng.uniform(-0.6, 0.6) * a) * math.sin(t0))
               for t0 in [rng.uniform(*tr) for _ in range(5 if quarter else 16)]]
        parts += dots(s, np.array(pts), 0.0045, "zuckerguss", rng, "blob", height=0.8)
    else:
        pts = [((Rc + rng.uniform(-0.6, 0.6) * a) * math.cos(t0), (Rc + rng.uniform(-0.6, 0.6) * a) * math.sin(t0))
               for t0 in [rng.uniform(*tr) for _ in range(4 if quarter else 10)]]
        parts += dots(s, np.array(pts), 0.0065, "mandel", rng, "seed", aspect=1.6, height=0.15)
    if quarter:   # chord along x, arc bulging towards the visitor (+z)
        parts = transform(parts, np.diag([1.0, 1.0, -1.0]))
    return parts


def r_kranz_viertel(size, p, rng, idx):
    return r_kranzkuchen(size, p, rng, idx, quarter=True)


def bridge_ribbon(surf: Surface, pts_xz, width: float, mat: str, off: float, sub: int = 4, reach: int = 2) -> Part | None:
    """Icing piped over a bumpy top: ONE continuous flat ribbon along the zig-zag, whose height follows the running
    maximum of the surface below (it spans the gaps between lobes instead of dropping into them)."""
    P = np.asarray(pts_xz, np.float64)
    Q = [P[0]]
    for a, b in zip(P[:-1], P[1:]):
        for k in range(1, sub + 1):
            Q.append(a + (b - a) * k / sub)
    Q = np.array(Q)
    y, _, ok = surf.hit(Q)
    if not ok.any():
        return None
    y = np.where(ok, y, np.min(y[ok]))
    ym = np.array([y[max(0, i - reach):i + reach + 1].max() for i in range(len(y))])
    ym = np.maximum(np.convolve(np.pad(ym, 1, mode="edge"), [0.25, 0.5, 0.25], mode="valid"), y) + off
    d = np.gradient(Q, axis=0)
    d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-12)
    nrm = np.column_stack([-d[:, 1], d[:, 0]]) * width / 2
    L, Rr = Q + nrm, Q - nrm
    n = len(Q)
    v = np.vstack([np.column_stack([L[:, 0], ym, L[:, 1]]), np.column_stack([Rr[:, 0], ym, Rr[:, 1]])])
    t = []
    for i in range(n - 1):
        t += [[i, n + i, n + i + 1], [i, n + i + 1, i + 1]]
    t = np.array(t)
    p = part(mat, v, t)
    fn = face_normals(p)
    t[fn[:, 1] < 0] = t[fn[:, 1] < 0][:, [0, 2, 1]]
    return part(mat, v, t)


def r_zopf(size, p, rng, idx):
    """Hefezopf: a continuous dough core with plump, overlapping braid lobes (the crossings of a three-strand braid)
    in a herringbone, tapering into the core at both ends; egg-glazed. Unfilled: pearl sugar; filled: the filling
    core shows between the lobes, with one continuous icing zig-zag on top."""
    W, D, H = size
    filled = bool(p.get("filled"))
    k = 9
    parts = []
    for i in range(k):
        t = i / (k - 1)
        env = 0.45 + 0.55 * math.sin(math.pi * t) ** 0.6
        x = (-0.37 + 0.74 * t) * W
        side = 1 if i % 2 == 0 else -1
        z = side * 0.09 * D * env
        ang = side * math.radians(48)
        lob = lathe(dome_prof(0.95 * H * env, foot=0.80, belly=0.38, flat=0.8, angles=(35, 65)), 7,
                    0.56 * D * env, 0.24 * D * env, mat="kruste", phase=rng.uniform(0, 1))
        c, sn = math.cos(ang), math.sin(ang)
        lob.v = lob.v @ np.array([[c, 0, sn], [0, 1, 0], [-sn, 0, c]]).T + np.array([x, 0, z])
        lob.nrm = lob.nrm @ np.array([[c, 0, sn], [0, 1, 0], [-sn, 0, c]]).T
        yy = lob.v[:, 1] / max(lob.v[:, 1].max(), 1e-9)
        lob.ao = 0.80 + 0.20 * yy
        parts.append(lob)
    # the core: one tapered tube under the lobes, so nothing shows through between them
    j = np.linspace(0, 1, 6)
    ec = 0.45 + 0.55 * np.sin(math.pi * j) ** 0.6
    core = tube(np.column_stack([(-0.41 + 0.82 * j) * W, 0.26 * H * ec, np.zeros(6)]), 0.30 * D * ec, 0.40 * H * ec,
                sides=6, mat=FILL[pick_filling(p, idx)] if filled else "kruste", tip=0.8, floor=0.0)
    core.ao = np.full(len(core.v), 0.82)
    parts.append(core)
    s = Surface(parts)
    if filled:
        xs = np.linspace(-0.36 * W, 0.36 * W, 9)
        zs = np.where(np.arange(9) % 2 == 0, 1, -1) * 0.16 * D
        st = bridge_ribbon(s, np.column_stack([xs, zs]), 0.008, "zuckerguss", 0.0025, sub=3)
        if st is not None:
            parts.append(st)
    else:
        parts += dots(s, scatter_rect(rng, 16, -0.40 * W, 0.40 * W, -0.20 * D, 0.20 * D, 0.012), 0.0045, "zuckerguss",
                      rng, "blob", height=0.8)
    return parts


# ----------------------------------------------------------------------------------------------- recipes: Torten


def r_tortenboden(size, p, rng, idx):
    W, D, H = size
    segs = 24
    if p.get("kind") == "obstboden":
        def wave(th, i):
            return 1 + (0.025 * np.cos(14 * th) if i in (1, 2) else 0.0)
        prof = [(1.0, 0.0), (1.0, 0.8 * H), (0.95, H), (0.89, 0.85 * H), (0.86, 0.45 * H), (0.0, 0.40 * H)]
        b = lathe(prof, segs, W / 2, D / 2, mat="kruste-hell", rmod=wave)
        c = tri_centroids(b)
        return split(b, np.hypot(c[:, 0] / (W / 2), c[:, 2] / (D / 2)) < 0.87, "biskuit")
    parts = []
    lh = H / 3
    for i in range(3):
        y0 = i * lh
        prof = [(1.0, y0), (1.0, y0 + lh * 0.82), (0.975, y0 + lh * 0.94), (0.0, y0 + lh * 0.94)]
        layer = lathe(prof, segs, W / 2, D / 2, mat="biskuit", phase=i * 0.1)
        if i == 2:
            c = tri_centroids(layer)
            parts += split(layer, c[:, 1] > y0 + lh * 0.9, "kruste-hell")
        else:
            parts.append(layer)
    return parts


def rosette(c, r, h, mat) -> Part:
    """Piped cream rosette: 6-segment star cone with a twist (18 triangles)."""
    def star(th, i):
        return 1 + 0.16 * np.where(np.arange(len(th)) % 2 == 0, 1, -1) * (1 if i == 0 else 0.6)
    p = lathe([(1.0, 0.0), (0.72, 0.5 * h), (0.0, h)], 6, r, r, mat=mat, rmod=star)
    p.v += np.asarray(c)
    return p


def r_torte(size, p, rng, idx):
    W, D, H = size
    kind = p.get("kind", "sahne")
    segs = 24
    side, top, ros, extra = {
        "schwarzwaelder": ("schoko", "sahne", "sahne", "kirsche"),
        "sahne": ("mandel", "sahne", "sahne", "schoko"),
        "buttercreme": ("buttercreme", "buttercreme", "buttercreme", "schoko"),
    }[kind]
    hb = 0.86 * H
    body = lathe([(1.0, 0.0), (1.0, 0.30 * hb), (1.0, 0.85 * hb), (0.97, 0.97 * hb), (0.92, hb), (0.0, hb)], segs,
                 W / 2, D / 2, mat=side)
    c = tri_centroids(body)
    layers = [(c[:, 1] > 0.9 * hb, top)]
    if kind == "buttercreme":   # roasted almond band round the foot (one clean band, no saw-tooth)
        layers.append((c[:, 1] < 0.30 * hb, "mandel"))
    parts = paint(body, layers)
    nr = 12
    rr = 0.09 * W
    Rr = 0.5 * W - rr * 1.05
    for i in range(nr):
        a = 2 * math.pi * i / nr
        cx, cz = Rr * math.cos(a), Rr * D / W * math.sin(a)
        parts.append(rosette((cx, hb - 0.002, cz), rr, H - hb + 0.002 - (0.4 * rr if extra == "kirsche" else 0), ros))
        if extra == "kirsche":
            parts.append(icosphere((cx, H - 0.4 * rr + 0.55 * rr * 0.9, cz), 0.55 * rr, "kirsche"))
        elif kind == "buttercreme":
            parts.append(octa((cx, H + 0.1 * rr, cz), 0.25 * rr, "schoko"))
    s = Surface(parts)
    if kind == "schwarzwaelder":
        parts += dots(s, scatter(rng, 18, 0.22 * W, 0.22 * D, mind=0.012), 0.0075, "schoko", rng, "seed", aspect=1.8,
                      height=0.5)
    elif kind == "sahne":
        parts += dots(s, scatter(rng, 10, 0.2 * W, 0.2 * D, mind=0.02), 0.008, "schoko", rng, "pyr", height=0.5)
    else:   # centre: one big rosette with chocolate shavings round it
        parts.append(rosette((0.0, hb - 0.002, 0.0), 0.11 * W, H - hb + 0.002, ros))
        parts += dots(s, scatter(rng, 10, 0.24 * W, 0.24 * D, inner=0.55, mind=0.014), 0.0065, "schoko", rng, "seed",
                      aspect=2.2, height=0.3)
    return parts


def spiral_face(R, turns, n, x, mat_a, mat_b, sign=1.0, Rz=None):
    """Flat end face of a roll (normal ±x): biscuit disc + a cream spiral band on it."""
    Rz = R if Rz is None else Rz
    segs = 14
    a = 2 * math.pi * np.arange(segs) / segs
    yz = np.column_stack([R * np.cos(a), Rz * np.sin(a)])
    v = np.vstack([[x, Rz, 0.0], np.column_stack([np.full(segs, x), Rz + yz[:, 1], yz[:, 0]])])
    t = np.array([[0, 1 + j, 1 + (j + 1) % segs] for j in range(segs)])
    face = Part(mat_a, v, t, None, None)
    nrm = np.array([sign, 0, 0])
    fn = face_normals(face)
    face.t[fn @ nrm < 0] = face.t[fn @ nrm < 0][:, [0, 2, 1]]
    th = np.linspace(0.5, 2 * math.pi * turns, n)
    rr = R * 0.92 * th / th[-1]
    w = R * 0.07
    inner = np.column_stack([np.full(n, x + sign * 0.0008), Rz + (rr - w) * np.sin(th) * Rz / R, (rr - w) * np.cos(th)])
    outer = np.column_stack([np.full(n, x + sign * 0.0008), Rz + (rr + w) * np.sin(th) * Rz / R, (rr + w) * np.cos(th)])
    vv = np.vstack([inner, outer])
    tt = []
    for i in range(n - 1):
        tt += [[i, n + i, n + i + 1], [i, n + i + 1, i + 1]]
    band = Part(mat_b, vv, np.array(tt), None, None)
    fn = face_normals(band)
    band.t[fn @ nrm < 0] = band.t[fn @ nrm < 0][:, [0, 2, 1]]
    return [face, band]


def r_rolle(size, p, rng, idx):
    """Biskuitrolle coated in cream (Buttercreme-Rolle): a combed log (long ridges, so it does not read as a plain
    cylinder or rolling pin), spiral end faces, chocolate zig-zag and a row of rosettes on top."""
    W, D, H = size
    cream = p.get("cream", "buttercreme")
    R = D / 2
    Rz = H / 2
    sides = 16
    path = np.column_stack([np.array([-W / 2, W / 2]), np.full(2, Rz), np.zeros(2)])
    body = tube(path, R, Rz, sides=sides, mat=cream, phase=0.0, tip=0.0, floor=0.0)
    body = compact(Part(body.mat, body.v[:-2], body.t[:-2 * sides], None, None))
    # comb ridges along the length on the visible upper 3/4 (every other column a little lower and darker)
    a = 2 * math.pi * np.arange(sides) / sides
    valley = (np.arange(sides) % 2 == 1) & (np.sin(a) > -0.6)
    ring = body.v.reshape(2, sides, 3)
    cen = path[:, None, :]
    f = np.where(valley, 0.92, 1.0)[None, :, None]
    ring = cen + (ring - cen) * f
    ring[..., 1] = np.maximum(ring[..., 1], 0.0)
    body.v = ring.reshape(-1, 3)
    body.nrm = smooth_normals(body.v, body.t)
    body.ao = np.tile(np.where(valley, 0.80, 1.0), 2)
    parts = [body]
    parts += spiral_face(R, 2.4, 20, -W / 2, "biskuit", cream, -1.0, Rz)
    parts += spiral_face(R, 2.4, 20, W / 2, "biskuit", cream, 1.0, Rz)
    s = Surface(parts)
    k = 16
    xs = np.linspace(-0.44 * W, 0.44 * W, k)
    zs = np.where(np.arange(k) % 2 == 0, 1, -1) * 0.45 * R
    st = bridge_ribbon(s, np.column_stack([xs, zs]), 0.0035, "schoko", 0.0022, sub=3, reach=0)
    if st is not None:
        parts.append(st)
    for x in np.linspace(-0.36 * W, 0.36 * W, 5):
        parts.append(rosette((x, 2 * Rz - 0.003, 0.0), 0.012, 0.016, cream))
    return parts


_TO_PX = np.array([[0.0, 1.0, 0.0], [-1.0, 0.0, 0.0], [0.0, 0.0, 1.0]])   # local +y -> +x (proper rotation)
_TO_NX = np.array([[0.0, -1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]])   # local +y -> −x


def sahnerolle(L: float, R: float, rng: random.Random, c=(0.0, 0.0, 0.0), floor: float | None = 0.0) -> list[Part]:
    """One Sahnerolle: a golden rolled waffle tube (alternating vertex light reads as the rolled wafer's spiral) along
    x, length L, radius R, centre c; whipped cream puffing out of both open ends as a round star-ribbed dome whose
    foot ring shares the tube's end ring (no slivers). 144 triangles."""
    sides, n = 8, 5
    ce = 0.075 * L                               # cream sticking out at each end
    Lt = L - 2 * ce
    x = np.linspace(-Lt / 2, Lt / 2, n)
    path = np.column_stack([x, np.zeros(n), np.zeros(n)]) + np.asarray(c)
    ph = -math.pi / 2 + math.pi / sides          # tube()'s default phase: a flat facet underneath
    body = tube(path, R, R, sides=sides, mat="waffel", tip=0.5, phase=ph, floor=floor)
    body = compact(Part(body.mat, body.v[:-2], body.t[:-2 * sides], None, None))
    body.nrm = smooth_normals(body.v, body.t)
    i, j = np.divmod(np.arange(n * sides), sides)
    body.ao = np.where((i + j) % 2 == 0, 1.0, 0.82)
    parts = [body]

    def star(th, k):
        return 1 + (0.10 * np.where(np.arange(len(th)) % 2 == 0, 1, -1) if k >= 1 else 0.0)

    prof = [(1.0, 0.0), (1.0, 0.45 * ce), (0.62, 0.88 * ce), (0.0, ce)]
    for m, sgn, phase in ((_TO_PX, 1.0, math.pi / 2 + ph), (_TO_NX, -1.0, math.pi / 2 - ph)):
        cr = lathe(prof, sides, R, R, mat="sahne", rmod=star, phase=phase)
        out = transform([cr], m, (c[0] + sgn * Lt / 2, c[1], c[2]))
        if floor is not None:
            out[0].v[:, 1] = np.maximum(out[0].v[:, 1], floor)
        parts += out
    return parts


def r_sahnerolle(size, p, rng, idx):
    W, D, H = size
    return sahnerolle(W, D / 2, rng, (0.0, D / 2, 0.0))


def r_sahnerollen(size, p, rng, idx):
    """A few Sahnerollen stacked as they are sold over the counter: three below, two on top (5 × 144 triangles)."""
    W, D, H = size
    L, R = W, 0.017
    parts = []
    for k in (-1, 0, 1):
        parts += sahnerolle(L, R, rng, (rng.uniform(-0.003, 0.003), R, k * 2.04 * R))
    for k in (-0.5, 0.5):
        parts += sahnerolle(L, R, rng, (rng.uniform(-0.004, 0.004), R + 1.75 * R, k * 2.04 * R), floor=None)
    return parts


# ----------------------------------------------------------------------------------------------- registry


RECIPES: dict[str, Callable] = {
    "laib-rund": r_laib_rund,
    "laib-oval": r_laib_oval,
    "kastenbrot": r_kastenbrot,
    "rosinenbrot": r_rosinenbrot,
    "baguette": r_baguette,
    "broetchen-rund": r_broetchen_rund,
    "broetchen-stern": r_broetchen_stern,
    "broetchen-schlitz": r_broetchen_schlitz,
    "doppelweck": r_doppelweck,
    "hoernchen": r_hoernchen_plain,
    "croissant": r_croissant,
    "brezel": r_brezel,
    "laugenstange": r_laugenstange,
    "laugenecke": r_laugenecke,
    "schnecke": r_schnecke,
    "tasche": r_tasche,
    "pain-au-chocolat": r_pain,
    "muffin": r_muffin,
    "granatsplitter": r_granatsplitter,
    "blechkuchen-stueck": r_blech_stueck,
    "blechkuchen": r_blechkuchen,
    "rundkuchen": r_rundkuchen,
    "kuchen-stueck": r_kuchen_stueck,
    "kastenkuchen": r_kastenkuchen,
    "kastenkuchen-scheibe": r_kastenkuchen_scheibe,
    "kranzkuchen": r_kranzkuchen,
    "kranzkuchen-viertel": r_kranz_viertel,
    "zopf": r_zopf,
    "tortenboden": r_tortenboden,
    "rolle": r_rolle,
    "sahnerolle": r_sahnerolle,
    "sahnerollen": r_sahnerollen,
    "torte": r_torte,
}


def seed(pid: str, idx: int) -> int:
    return int.from_bytes(hashlib.sha256(f"{pid}#{idx}".encode()).digest()[:8], "big")


def variation(pid: str, idx: int) -> dict:
    """Deterministic per-instance variation (style.md): scale ± 6 %, rotation ± 15°, crust tone ± 6 %."""
    r = random.Random(seed(pid, idx) ^ 0x5EED)
    return {"scale": round(1 + r.uniform(-0.06, 0.06), 4), "stretch": round(1 + r.uniform(-0.02, 0.02), 4),
            "rot_deg": round(r.uniform(-15, 15), 2), "tone": round(1 + r.uniform(-0.06, 0.04), 4)}


def build(product: dict, idx: int = 0, vary: bool = True) -> list[Part]:
    """Mesh parts of one product instance in its local frame (true size × variation)."""
    shape = product["shape"]
    if shape not in RECIPES:
        raise KeyError(f"no recipe for shape '{shape}' ({product.get('id')})")
    size = [float(s) for s in product["size_m"]]
    rng = random.Random(seed(product["id"], idx))
    parts = [q for q in RECIPES[shape](size, dict(product.get("shape_params") or {}), rng, idx) if q is not None]
    parts = [q for q in parts if len(q.t)]
    parts = fit(parts, size)
    if vary:
        va = variation(product["id"], idx)
        s = va["scale"]
        parts = transform(parts, np.diag([s * va["stretch"], s, s / va["stretch"]]))
        parts = transform(parts, rot_y(va["rot_deg"]))
        for q in parts:
            if q.mat in CRUSTS:
                q.ao = (np.ones(len(q.v)) if q.ao is None else q.ao) * va["tone"]
    return parts


def contact_ao(y: np.ndarray, h: float) -> np.ndarray:
    """Baked contact shadow towards the tray (style.md: blob / contact shadows for products)."""
    k = np.clip(y / max(min(0.035, 0.6 * h), 1e-4), 0, 1)
    return 0.70 + 0.30 * (k * k * (3 - 2 * k))


def add_to_node(node: geom.Node, parts: list[Part], origin=(0.0, 0.0, 0.0), rot_deg: float = 0.0) -> int:
    """Bake one instance into `node` (zone frame): rotate by heading, move to origin; returns triangles added."""
    m = rot_y(rot_deg)
    lo, hi = bbox(parts)
    h = float(hi[1] - lo[1])
    tri = 0
    for q in parts:
        q = compact(q)
        if q.nrm is not None:
            bad = np.linalg.norm(q.nrm, axis=1) < 1e-9
            if bad.any():
                q = Part(q.mat, q.v, q.t, np.where(bad[:, None], Y, q.nrm), q.ao, q.pairs)
        v = q.v @ m.T + np.asarray(origin, np.float64)
        ao = contact_ao(q.v[:, 1] - lo[1], h) * (1.0 if q.ao is None else q.ao)
        if q.nrm is None:
            vs = q.v[q.t].reshape(-1, 3)
            fn = np.repeat(face_normals(q), 3, axis=0) @ m.T
            node.add(q.mat, v[q.t].reshape(-1, 3), np.arange(len(vs)).reshape(-1, 3), fn, ao[q.t].reshape(-1))
        else:
            node.add(q.mat, v, q.t, q.nrm @ m.T, ao)
        tri += len(q.t)
    return tri
