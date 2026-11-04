"""LoD2 (CityGML) walls around a zone anchor, for georeferencing captured meshes.

Reads the cached tiles under data/raw/lod2/{sl,rlp}/ (same files as pipeline/buildings.py; untrusted GML, parsed
with a hardened lxml parser). Each WallSurface polygon is vertical, so it projects to a 2D segment; we keep
  a, b      segment end points (E, N)
  z0, z1    lowest / highest wall vertex (ground line, eaves or gable top; DHHN2016)
  building  gml:id
and the 2D footprint corners where two walls of one building meet.
"""
from __future__ import annotations

import gzip
import math
import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .common import DATA


@dataclass
class Wall:
    building: str
    a: np.ndarray  # (2,) E, N
    b: np.ndarray
    z0: float
    z1: float

    @property
    def length(self) -> float:
        return float(np.linalg.norm(self.b - self.a))


def _hardened():
    return dict(resolve_entities=False, load_dtd=False, no_network=True, huge_tree=True, remove_comments=True)


def tiles_near(e: float, n: float, r: float) -> list[Path]:
    out = []
    for p in sorted((DATA / "raw" / "lod2").glob("*/*.gml.gz")):
        m = re.match(r"LoD2_32_(\d+)_(\d+)_(\d)_", p.name)
        if not m:
            continue
        e0, n0, km = int(m[1]) * 1000, int(m[2]) * 1000, int(m[3])
        if e0 - r <= e <= e0 + km * 1000 + r and n0 - r <= n <= n0 + km * 1000 + r:
            out.append(p)
    return out


def _coords(poly) -> np.ndarray:
    for pl in poly.iter("{*}posList"):
        v = np.array((pl.text or "").split(), float)
        dim = int(pl.get("srsDimension") or 3)
        return v.reshape(-1, dim)[:, :3] if dim == 3 else np.zeros((0, 3))
    pos = [np.array((p.text or "").split(), float) for p in poly.iter("{*}pos")]
    return np.vstack(pos) if pos else np.zeros((0, 3))


def wall_segment(ring: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
    """2D extent of a vertical polygon: the two extreme vertices along its principal horizontal direction."""
    xy = ring[:, :2]
    c = xy.mean(0)
    d = xy - c
    if np.abs(d).max() < 1e-6:
        return None
    _, _, vt = np.linalg.svd(d, full_matrices=False)
    t = d @ vt[0]
    return xy[np.argmin(t)].copy(), xy[np.argmax(t)].copy()


def newell_normal(ring: np.ndarray) -> np.ndarray:
    """Polygon normal by Newell's method; CityGML rings run counter-clockwise seen from outside -> outward."""
    p = ring - ring.mean(axis=0)
    q = np.roll(p, -1, axis=0)
    return np.array([np.sum((p[:, 1] - q[:, 1]) * (p[:, 2] + q[:, 2])),
                     np.sum((p[:, 2] - q[:, 2]) * (p[:, 0] + q[:, 0])),
                     np.sum((p[:, 0] - q[:, 0]) * (p[:, 1] + q[:, 1]))])


def oriented(seg, n3: np.ndarray):
    """Order a wall segment so that the right-hand normal of a->b (d_y, -d_x) agrees with the outward normal."""
    a, b = seg
    d = b - a
    if d[1] * n3[0] - d[0] * n3[1] < 0:
        a, b = b, a
    return a, b


def load_walls(e: float, n: float, r: float) -> list[Wall]:
    from lxml import etree

    walls: list[Wall] = []
    seen: set[str] = set()
    for path in tiles_near(e, n, r):
        with gzip.open(path, "rb") as f:
            for _, el in etree.iterparse(f, events=("end",), tag="{*}Building", **_hardened()):
                bid = el.get("{http://www.opengis.net/gml}id") or ""
                if bid in seen:
                    el.clear()
                    continue
                for ws in el.iter("{*}WallSurface"):
                    for poly in ws.iter("{*}Polygon"):
                        ring = _coords(poly)
                        if len(ring) < 3:
                            continue
                        c = ring[:, :2].mean(0)
                        if math.hypot(c[0] - e, c[1] - n) > r:
                            continue
                        seg = wall_segment(ring)
                        if seg is None or np.linalg.norm(seg[1] - seg[0]) < 0.3:
                            continue
                        a, b = oriented(seg, newell_normal(ring))
                        walls.append(Wall(bid, a, b, float(ring[:, 2].min()), float(ring[:, 2].max())))
                        seen.add(bid)
                el.clear()
    return walls


def corners(walls: list[Wall], tol: float = 0.05, min_angle_deg: float = 45) -> list[dict]:
    """Footprint corners: end points shared by two walls of the same building meeting at >= min_angle."""
    out = []
    by_b: dict[str, list[Wall]] = {}
    for w in walls:
        by_b.setdefault(w.building, []).append(w)
    for bid, ws in by_b.items():
        for i in range(len(ws)):
            for j in range(i + 1, len(ws)):
                for p in (ws[i].a, ws[i].b):
                    for q in (ws[j].a, ws[j].b):
                        if np.linalg.norm(p - q) <= tol:
                            u = (ws[i].b - ws[i].a) / ws[i].length
                            v = (ws[j].b - ws[j].a) / ws[j].length
                            ang = math.degrees(math.acos(min(1.0, abs(float(u @ v)))))
                            if ang >= min_angle_deg:
                                out.append({"building": bid, "p": ((p + q) / 2).tolist(), "walls": [i, j],
                                            "w1": ws[i], "w2": ws[j],
                                            "z0": min(ws[i].z0, ws[j].z0)})
    # one corner per location
    uniq: list[dict] = []
    for c in out:
        if all(np.linalg.norm(np.array(c["p"]) - np.array(u["p"])) > tol for u in uniq):
            uniq.append(c)
    return uniq
