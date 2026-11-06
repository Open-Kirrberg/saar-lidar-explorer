"""Scene registry + frame-B drawing helpers (horizontal faces, vertical faces from (s, z) shapes, boxes, prisms).

Node names follow the zone contract `<assetId>/<part>[/<detail>]`; the asset id and every prefix are catalogue
ids (catalogue/objects.json). `extras.id` = the catalogue row the node belongs to (picking, info card).
"""
from __future__ import annotations

import math

import numpy as np
from shapely.geometry import Polygon

from . import geom
from .plan import FrameB
from .shade import AO, Rig


def smooth(e0: float, e1: float, x) -> np.ndarray:
    t = np.clip((np.asarray(x, np.float64) - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def confidence(sigma: float) -> str:
    return "high" if sigma <= 0.15 else "med" if sigma <= 0.45 else "low"


class Scene:
    def __init__(self, frame: FrameB, rigs: dict[str, Rig]):
        self.F = frame
        self.rigs = rigs
        self.nodes: dict[str, geom.Node] = {}
        self.ao = AO()                 # interior vertex AO, baked once by `bake_ao` after the shop is built
        self.slots: list[dict] = []    # product slots (catalogue/slots.json), filled by the fixture builders
        self.slot_geo: list = []       # (frame-B corner points of each slot's standing surface) for --debug-slots
        self.styled: set[str] = set()  # catalogue ids built as styled models this round (status `built`)
        self.anchors: dict[str, np.ndarray] = {}  # zone-frame points products hang from (pretzel stand pole)
        self.price_cards: dict[str, np.ndarray] = {}  # slot id -> zone-frame card frame (origin, right, up, front)

    # ---- registry ----
    def node(self, name: str, rig: str, cid: str | None = None, source: str = "plan", sigma: float = 0.1) -> geom.Node:
        if name not in self.nodes:
            cid = cid or name
            self.nodes[name] = geom.Node(name, self.rigs[rig], {"id": cid, "source": source, "sigma_m": round(float(sigma), 2),
                                                               "confidence": confidence(sigma)})
        return self.nodes[name]

    # ---- frame B helpers ----
    def hface(self, n: geom.Node, mat: str, poly, z: float, up: bool = True, ao=None) -> None:
        F = self.F
        n.add_planar(mat, poly, lambda v2: F.zone(np.column_stack([v2, np.full(len(v2), z)])),
                     F.zone_dir(np.array([0, 0, 1.0 if up else -1.0])), ao)

    def vface(self, n: geom.Node, mat: str, p0, p1, shape, left: bool = True, ao=None, cdt: bool = False) -> None:
        """Vertical face on the line p0 -> p1 (frame B xy); `shape` in (s, z), s = metres from p0. Normal = left of
        p0 -> p1 (or right)."""
        F = self.F
        p0, p1 = np.asarray(p0, np.float64), np.asarray(p1, np.float64)
        d = (p1 - p0) / np.linalg.norm(p1 - p0)
        nl = np.array([-d[1], d[0]]) * (1 if left else -1)

        def to3d(v2):
            xy = p0 + v2[:, :1] * d
            return F.zone(np.column_stack([xy, v2[:, 1]]))
        n.add_planar(mat, shape, to3d, F.zone_dir(np.array([nl[0], nl[1], 0.0])), ao, cdt)

    def vrect(self, n, mat, p0, p1, z0, z1, left=True, ao=None) -> None:
        L = float(np.linalg.norm(np.asarray(p1) - np.asarray(p0)))
        self.vface(n, mat, p0, p1, geom.rect(0, z0, L, z1), left, ao)

    def quad(self, n, mat, pts_b: np.ndarray, normal_b, ao=None) -> None:
        """Planar 3-D polygon given in frame B (n,3) with its normal (frame B)."""
        F = self.F
        v = F.zone(np.asarray(pts_b, np.float64))
        nb = np.asarray(normal_b, np.float64)
        u, w = _basis(nb)
        p2 = (np.asarray(pts_b) - pts_b[0]) @ np.column_stack([u, w])
        for v2, t in geom.triangulate(Polygon(p2)):
            # map back: v2 are the same points (earcut keeps vertex order of the ring) -> rebuild 3-D
            v3b = pts_b[0] + v2[:, :1] * u + v2[:, 1:2] * w
            v3 = F.zone(v3b)
            n.add(mat, v3, geom.wind(v3, t, F.zone_dir(nb)), F.zone_dir(nb), None if ao is None else ao(v3b))
        del v

    def solid_local(self, n, mat, verts_local: np.ndarray, tris: np.ndarray, origin_xy, rot_deg: float, z0: float = 0.0,
                    ao=None) -> None:
        """Solid in a local frame (x along rot_deg, y = +90°, z up), placed at origin_xy (frame B) and z0."""
        a = math.radians(rot_deg)
        ux, uy = np.array([math.cos(a), math.sin(a)]), np.array([-math.sin(a), math.cos(a)])
        v = np.asarray(verts_local, np.float64)
        xy = np.asarray(origin_xy, np.float64) + v[:, :1] * ux + v[:, 1:2] * uy
        b = np.column_stack([xy, v[:, 2] + z0])
        n.add_mesh(mat, self.F.zone(b), tris, None if ao is None else (lambda vz: ao(self.F.zone_to_b(vz))))

    def box(self, n, mat, origin_xy, rot_deg, l, d, h, z0=0.0, bevel=0.0, ao=None) -> None:
        """Box [0,l]×[0,d]×[0,h] in the local frame at origin_xy / rot_deg, base at z0; chamfered edges."""
        pts = geom.chamfer_box_local(l, d, h, bevel)
        v, t = geom.convex_solid(pts)
        self.solid_local(n, mat, v, t, origin_xy, rot_deg, z0, ao)

    def convex(self, n, mat, pts_b: np.ndarray, ao=None) -> None:
        v, t = geom.convex_solid(np.asarray(pts_b, np.float64))
        n.add_mesh(mat, self.F.zone(v), t, None if ao is None else (lambda vz: ao(self.F.zone_to_b(vz))))

    def prism(self, n, mat_side, poly_b, z0, z1, mat_top=None, top=True, bottom=False, ao=None) -> None:
        F = self.F
        for kind, v, t, nrm in geom.prism_parts(poly_b, z0, z1):
            if kind == "top" and not top or kind == "bottom" and not bottom:
                continue
            mat = mat_top if kind == "top" and mat_top else mat_side
            n.add(mat, F.zone(v), t, F.zone_dir(nrm), None if ao is None else ao(v))

    def cylinder(self, n, mat, c_xy, r, z0, z1, segs=16, r1=None) -> None:
        v, t = geom.cylinder_local(r, z0, z1, segs, r1)
        v = v.copy()
        v[:, :2] += np.asarray(c_xy, np.float64)
        n.add_mesh(mat, self.F.zone(v), t)

    def bake_ao(self, rig: str = "int") -> None:
        """Multiply the baked light of every node lit by `rig` with the registered AO (frame-B occluders)."""
        r = self.rigs[rig]
        for node in self.nodes.values():
            if node.shade is not r:
                continue
            for pr in node.prims.values():
                for k, pos in enumerate(pr.pos):
                    a = self.ao(self.F.zone_to_b(pos))
                    pr.col[k] = np.clip(pr.col[k] * a[:, None], 0.0, 1.0)

    def stats(self) -> dict[str, int]:
        return {k: v.triangles for k, v in self.nodes.items()}


def _basis(n: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    n = n / np.linalg.norm(n)
    a = np.array([1.0, 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 1.0, 0])
    u = np.cross(n, a)
    u /= np.linalg.norm(u)
    return u, np.cross(n, u)
