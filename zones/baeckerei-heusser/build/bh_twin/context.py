"""Context data around the shop, read from the files the explorer pipeline and the capture tool already use:

    DGM1   data/work/overall/dtm.tif          (GeoBasis-DE/LVGL-SL, dl-de/by-2-0)
    LoD2   data/raw/lod2/sl/LoD2_32_*.gml.gz  (same tiles and hardened parser as pipeline/buildings.py)
    OSM    data/raw/osm/overall.json          (Overpass JSON, ODbL; ways with a highway tag)

Downloaded files are untrusted data: parsed, never executed. Extracts are cached as JSON under build/out/cache/.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass
class Dgm:
    """DGM1 window with bilinear interpolation between cell centres (PixelIsArea: centre = corner + 0.5 m)."""
    h: np.ndarray       # (rows, cols), row 0 = north
    e0: float           # E of the centre of column 0
    n0: float           # N of the centre of row 0
    res: float

    @classmethod
    def read(cls, path: Path, bounds: tuple[float, float, float, float]) -> "Dgm":
        import rasterio
        from rasterio.windows import from_bounds
        E0, N0, E1, N1 = bounds
        with rasterio.open(path) as r:
            w = from_bounds(E0 - 2, N0 - 2, E1 + 2, N1 + 2, r.transform).round_offsets().round_lengths()
            a = r.read(1, window=w).astype(np.float64)
            t = r.window_transform(w)
            nod = r.nodata
        if nod is not None and np.any(a == nod):
            raise SystemExit("context: DGM window has nodata cells")
        return cls(a, t.c + 0.5 * t.a, t.f + 0.5 * t.e, float(t.a))

    def __call__(self, E, N) -> np.ndarray:
        E = np.asarray(E, np.float64)
        N = np.asarray(N, np.float64)
        c = (E - self.e0) / self.res
        r = (self.n0 - N) / self.res
        c0 = np.clip(np.floor(c).astype(int), 0, self.h.shape[1] - 2)
        r0 = np.clip(np.floor(r).astype(int), 0, self.h.shape[0] - 2)
        fc, fr = c - c0, r - r0
        h = self.h
        return ((h[r0, c0] * (1 - fc) + h[r0, c0 + 1] * fc) * (1 - fr)
                + (h[r0 + 1, c0] * (1 - fc) + h[r0 + 1, c0 + 1] * fc) * fr)


# ----------------------------------------------------------------------------------------------- LoD2

def lod2_tiles(lod2_dir: Path, E: float, N: float, r: float) -> list[Path]:
    out = []
    for p in sorted(lod2_dir.glob("*/*.gml.gz")):
        m = re.match(r"LoD2_32_(\d+)_(\d+)_(\d)_", p.name)
        if not m:
            continue
        e0, n0, km = int(m[1]) * 1000, int(m[2]) * 1000, int(m[3])
        if e0 - r <= E <= e0 + km * 1000 + r and n0 - r <= N <= n0 + km * 1000 + r:
            out.append(p)
    return out


def lod2_buildings(lod2_dir: Path, E: float, N: float, r: float, cache_dir: Path) -> list[dict]:
    """Buildings whose footprint comes within `r` of (E, N): {id, walls: [ring], roofs: [ring], ground_z, footprint}.

    Rings are (n, 3) lists in EPSG:25832 + DHHN2016 (exterior rings only; LoD2 walls here have no holes)."""
    tiles = lod2_tiles(lod2_dir, E, N, r)
    key = hashlib.sha256(json.dumps([E, N, r, [(t.name, t.stat().st_size, int(t.stat().st_mtime)) for t in tiles]]).encode()).hexdigest()[:16]
    cache = cache_dir / f"lod2_{key}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    import buildings as pb  # pipeline/buildings.py (hardened lxml parser, ring helpers)
    from shapely.geometry import Point
    out = []
    centre = Point(E, N)
    for t in tiles:
        for b in pb.iter_buildings(t, "sl"):
            fp = pb.footprint_of(b)
            if fp is None or fp.distance(centre) > r:
                continue
            walls, roofs = [], []
            for rings, cls in b.surfaces:
                ring = pb.clean_ring(np.asarray(rings[0], np.float64))
                if len(ring) < 3:
                    continue
                (walls if cls == pb.SURF_WALL else roofs if cls == pb.SURF_ROOF else walls).append(ring.round(3).tolist())
            gz = [float(np.asarray(g[0])[:, 2].min()) for g in b.ground] if b.ground else []
            fps = [list(map(list, np.asarray(p.exterior.coords)[:-1].round(3))) for p in getattr(fp, "geoms", [fp])]
            out.append({"id": b.id, "walls": walls, "roofs": roofs, "ground_z": min(gz) if gz else None, "footprint": fps})
    out.sort(key=lambda b: b["id"])
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(out))
    return out


# ----------------------------------------------------------------------------------------------- OSM

ROAD_WIDTH = {"primary": 7.0, "secondary": 6.5, "tertiary": 6.0, "unclassified": 5.0, "residential": 5.0,
              "living_street": 4.5, "service": 3.5, "pedestrian": 4.0, "footway": 2.0, "path": 1.5, "steps": 2.0}


def osm_ways(path: Path, bounds: tuple[float, float, float, float], cache_dir: Path) -> list[dict]:
    """Highway ways crossing `bounds` (E/N): {id, highway, name, coords [[E, N], ...]}."""
    key = hashlib.sha256(json.dumps([list(bounds), path.stat().st_size, int(path.stat().st_mtime)]).encode()).hexdigest()[:16]
    cache = cache_dir / f"osm_{key}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    from pyproj import Transformer
    tr = Transformer.from_crs("EPSG:4326", "EPSG:25832", always_xy=True)
    doc = json.loads(path.read_text(encoding="utf-8"))
    E0, N0, E1, N1 = bounds
    out = []
    for el in doc.get("elements", []):
        tags = el.get("tags") or {}
        hw = tags.get("highway")
        geo = el.get("geometry")
        if el.get("type") != "way" or not hw or not geo or hw not in ROAD_WIDTH:
            continue
        lon = np.array([g["lon"] for g in geo], np.float64)
        lat = np.array([g["lat"] for g in geo], np.float64)
        e, n = tr.transform(lon, lat)
        if not ((e >= E0) & (e <= E1) & (n >= N0) & (n <= N1)).any():
            if not (e.min() < E1 and e.max() > E0 and n.min() < N1 and n.max() > N0):
                continue
        out.append({"id": int(el["id"]), "highway": hw, "name": tags.get("name"),
                    "coords": np.column_stack([e, n]).round(3).tolist()})
    out.sort(key=lambda w: w["id"])
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(out))
    return out


def newell(ring: np.ndarray) -> np.ndarray:
    p = ring - ring.mean(axis=0)
    q = np.roll(p, -1, axis=0)
    n = np.array([np.sum((p[:, 1] - q[:, 1]) * (p[:, 2] + q[:, 2])),
                  np.sum((p[:, 2] - q[:, 2]) * (p[:, 0] + q[:, 0])),
                  np.sum((p[:, 0] - q[:, 0]) * (p[:, 1] + q[:, 1]))])
    L = np.linalg.norm(n)
    return n / L if L > 0 else n


def stable_pick(key: str, options: list[str]) -> str:
    return options[int(hashlib.sha256(key.encode()).hexdigest(), 16) % len(options)]


def circle(cx: float, cy: float, r: float, n: int) -> np.ndarray:
    a = np.linspace(0, 2 * math.pi, n, endpoint=False)
    return np.column_stack([cx + r * np.cos(a), cy + r * np.sin(a)])
