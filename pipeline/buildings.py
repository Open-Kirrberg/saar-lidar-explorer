"""F11 + R0.7: LoD2 buildings (CityGML) → per-chunk glb meshes + `bldg` footprint mask.

    uv run python buildings.py <aoi> [--refresh]

Sources (dl-de/by-2-0):
- Saarland: `LoD2_32_{E}_{N}_1_SL.gml` (1 km tiles) range-extracted from the county ZIP
  `OD_Gebäudemodelle_LoD2_gml_LK/<county>_LOD2BWK_gml.zip` on the LVGL Nextcloud share (same HTTP-Range
  machinery as the DGM tiles in fetch.py). All tiles touching AOI + buffer are fetched (≈ 0.1–4 MB zipped each),
  because a building straddling the AOI edge lives in exactly one tile file.
- Rheinland-Pfalz: `https://geobasis-rlp.de/data/geb3dlo/current/gml/LoD2_32_{E}_{N}_2_RP.gml` (2 km tiles,
  plain GML, up to ~25 MB). Only the RLP tiles intersecting the AOI itself are fetched (not the buffer ring).
Raw tiles are cached gzip-compressed under `data/raw/lod2/{sl,rlp}/` (untrusted: parsed with a hardened lxml parser,
no entities, no network). SL and RLP do not overlap in practice (each state models its own buildings); an RLP
building whose footprint point lies inside an SL footprint is dropped as a duplicate anyway.

Outputs (docs/data-contract.md "Models" + "Building mask"):
- `models/buildings/{i}_{j}.glb`: one mesh per level-0 chunk, local frame x = E − E0, y = h, z = −(N − N0),
  attributes POSITION, NORMAL (flat), _SURFACE (u8: 0 other/closure, 1 wall, 2 roof). GroundSurface polygons are
  not meshed (they sit on the terrain). Each building goes whole into the chunk of its footprint centroid.
  Walls standing on a GroundSurface are extended down to min(DTM along the wall) − 0.3 m (≤ 5 m, `skirt_walls`),
  so the flat LoD2 floor never leaves a visible gap where the terrain falls away; roofs are not moved.
- `relief/bldg/{i}_{j}.png`: u8 0/255, cell centre inside a GroundSurface footprint, dilated 1 cell (3 × 3).
- manifest: `models.buildings`, `layers.bldg` (+ mirrored into the informative `levels[0].layers`) and the LoD2
  attribution entries. Report: `data/work/<aoi>/buildings.json` (counts, sizes, ground height vs DTM).

v3 places (contract "Many places (v3, S2)", rules 2 + 6): only buildings whose footprint centroid lies in a present
tile are meshed (so neighbouring places never draw one twice), glb files and `models.buildings.chunks` exist only
for present chunks, and the `bldg` layer is `relief/bldg/{i}_{j}.webp` (WebP lossless, fixed range 0–1) for the
present chunks only. The work raster `bldg.tif` still covers the whole rectangle (trees/detect/pointcloud read it).
"""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import gzip
import io
import json
import math
import re
import shutil
import sys
import time
import urllib.parse
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Iterator

import mapbox_earcut
import numpy as np
from lxml import etree
from scipy import ndimage

from common import AOI, RAW_DIR, WORK_DIR, fmt_bytes, http_open, load_aoi, update_manifest

LOD2_RAW = RAW_DIR / "lod2"
SL_FOLDER = "OD_Gebäudemodelle_LoD2_gml_LK"
RLP_BASE = "https://geobasis-rlp.de/data/geb3dlo/current/gml/"
RLP_TILE_KM = 2

ATTRIBUTION_LOD2_SL = "© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet (LoD2)"
ATTRIBUTION_LOD2_RLP = "© GeoBasis-DE/LVermGeoRP (2026), dl-de/by-2-0, www.lvermgeo.rlp.de, Daten bearbeitet (LoD2)"
LABEL_DE = "Gebäude (LoD2)"
MODEL_PATH = "models/buildings/{i}_{j}.glb"
MASK_PATH = "relief/bldg/{i}_{j}.png"
MASK_PATH_V3 = "relief/bldg/{i}_{j}.webp"   # v3 places: WebP lossless (contract "Slim formats (v3)")

SURF_OTHER, SURF_WALL, SURF_ROOF = 0, 1, 2
# CityGML boundary surface (local name) → _SURFACE class; GroundSurface is handled separately (footprint, not meshed)
SURFACE_CLASS = {"WallSurface": SURF_WALL, "RoofSurface": SURF_ROOF, "ClosureSurface": SURF_OTHER,
                 "OuterCeilingSurface": SURF_OTHER, "OuterFloorSurface": SURF_OTHER, "GroundSurface": SURF_OTHER}
GROUND = "GroundSurface"


# =========================================================================== geometry (pure)

def parse_coords(text: str, dim: int = 3) -> np.ndarray:
    """gml:posList / gml:pos text → (n, 3) float64 (2D input gets z = 0)."""
    v = np.array(text.split(), dtype=np.float64)
    if dim not in (2, 3) or v.size % dim:
        raise ValueError(f"posList with {v.size} values is not a multiple of srsDimension {dim}")
    v = v.reshape(-1, dim)
    return v if dim == 3 else np.column_stack([v, np.zeros(len(v))])


def clean_ring(ring: np.ndarray, eps: float = 1e-6) -> np.ndarray:
    """Drop the closing duplicate and consecutive duplicate vertices of a GML ring."""
    if len(ring) == 0:
        return ring
    keep = np.ones(len(ring), bool)
    keep[1:] = np.abs(np.diff(ring, axis=0)).max(axis=1) > eps
    r = ring[keep]
    if len(r) > 1 and np.abs(r[0] - r[-1]).max() <= eps:
        r = r[:-1]
    return r


def newell_normal(ring: np.ndarray) -> np.ndarray:
    """Newell's method: robust (unnormalised) polygon normal; direction follows the ring order (right-hand rule)."""
    p = ring - ring.mean(axis=0)
    q = np.roll(p, -1, axis=0)
    return np.array([np.sum((p[:, 1] - q[:, 1]) * (p[:, 2] + q[:, 2])),
                     np.sum((p[:, 2] - q[:, 2]) * (p[:, 0] + q[:, 0])),
                     np.sum((p[:, 0] - q[:, 0]) * (p[:, 1] + q[:, 1]))])


def plane_basis(n: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Orthonormal (u, v) spanning the plane with unit normal n, with u × v = n."""
    a = np.array([1.0, 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 1.0, 0])
    u = np.cross(n, a)
    u /= np.linalg.norm(u)
    return u, np.cross(n, u)


def project_to_plane(pts: np.ndarray, n: np.ndarray, origin: np.ndarray) -> np.ndarray:
    """3D points → 2D coordinates in the best-fit plane (normal n through origin)."""
    u, v = plane_basis(n)
    d = pts - origin
    return np.column_stack([d @ u, d @ v])


def triangulate_polygon(rings: list[np.ndarray], min_area: float = 1e-4
                        ) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """Planar polygon (exterior + interior rings, 3D) → (vertices (m,3), triangles (k,3) int, unit normal).

    The polygon is projected into its best-fit plane (Newell normal of the exterior ring), triangulated with earcut
    (holes supported) and every triangle is oriented so that its normal agrees with the polygon normal, i.e. the
    CityGML ring orientation (counter-clockwise seen from outside) decides the outward side. Returns None for
    degenerate polygons (area < min_area m² or < 3 vertices)."""
    rings = [clean_ring(np.asarray(r, np.float64)) for r in rings]
    rings = [rings[0]] + [r for r in rings[1:] if len(r) >= 3]
    if len(rings[0]) < 3:
        return None
    nn = newell_normal(rings[0])
    area2 = float(np.linalg.norm(nn))  # = 2 × area of the exterior ring
    if area2 / 2 < min_area:
        return None
    n = nn / area2
    verts = np.concatenate(rings)
    p2 = project_to_plane(verts, n, rings[0].mean(axis=0))
    ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
    idx = np.asarray(mapbox_earcut.triangulate_float64(p2, ends), dtype=np.int64).reshape(-1, 3)
    if len(idx) == 0:
        return None
    a, b, c = verts[idx[:, 0]], verts[idx[:, 1]], verts[idx[:, 2]]
    tn = np.cross(b - a, c - a)
    dots = tn @ n
    ok = np.abs(dots) > 1e-10  # drop zero-area slivers
    idx, dots = idx[ok], dots[ok]
    idx[dots < 0] = idx[dots < 0][:, [0, 2, 1]]
    if len(idx) == 0:
        return None
    return verts, idx, n


def to_local(pts: np.ndarray, e0: float, n0: float) -> np.ndarray:
    """EPSG:25832 (E, N, h) → three.js local frame (x = E − E0, y = h, z = −(N − N0)). A proper rotation, so
    normals transform the same way without the translation (use e0 = n0 = 0)."""
    pts = np.asarray(pts, np.float64)
    return np.column_stack([pts[:, 0] - e0, pts[:, 2], -(pts[:, 1] - n0)])


def chunk_of(e: float, n: float, e0: float, n_top: float, nx: int, ny: int, cs: int = 500) -> tuple[int, int]:
    """Level-0 chunk (i, j) containing point (E, N); j counts from the north (row 0 = north), clamped to the grid."""
    i = min(max(int(math.floor((e - e0) / cs)), 0), nx - 1)
    j = min(max(int(math.floor((n_top - n) / cs)), 0), ny - 1)
    return i, j


def rasterize_mask(geoms: Iterable[Any], e0: float, n_top: float, width: int, height: int,
                   dilate: bool = True) -> np.ndarray:
    """Footprints (shapely, EPSG:25832) → uint8 0/1 on the AOI's 1 m PixelIsArea grid (row 0 = north).

    A cell is set when its centre (E0 + c + 0.5, N_top − r − 0.5) lies inside a footprint (GDAL's default
    non-all-touched rule), then dilated by one cell (3 × 3). Rasterised with a 1-cell margin so footprints just
    outside the AOI still dilate into it."""
    from rasterio.features import rasterize
    from rasterio.transform import from_origin
    shapes = [(g, 1) for g in geoms if g is not None and not g.is_empty]
    if not shapes:
        return np.zeros((height, width), np.uint8)
    m = rasterize(shapes, out_shape=(height + 2, width + 2), transform=from_origin(e0 - 1, n_top + 1, 1, 1),
                  fill=0, dtype="uint8", all_touched=False)
    if dilate:
        m = ndimage.binary_dilation(m.astype(bool), structure=np.ones((3, 3), bool)).astype(np.uint8)
    return m[1:-1, 1:-1]


def in_present_tile(aoi: AOI, e: float, n: float) -> bool:
    """Contract rule 6 (v3): the point lies in a tile the place publishes. Always True for v1/v2 rectangle AOIs
    (their selection rule is "footprint intersects the AOI", see `select_buildings`)."""
    if not aoi.is_place:
        return True
    from grid import tile_of_point
    return aoi.present(*tile_of_point(e, n))


def select_buildings(buildings: Iterable[Building], aoi: AOI) -> list[Building]:
    """Buildings this AOI meshes: v3 place → footprint centroid in a present tile (rule 6); v1/v2 → footprint
    intersects the AOI rectangle (the building then goes whole into the chunk of its centroid, clamped)."""
    if aoi.is_place:
        out = []
        for b in buildings:
            c = b.footprint.centroid
            if in_present_tile(aoi, c.x, c.y):
                out.append(b)
        return out
    from shapely.geometry import box
    aoi_box = box(aoi.e0, aoi.n0, aoi.e1, aoi.n1)
    return [b for b in buildings if b.footprint.intersects(aoi_box)]


def mask_chunks(aoi: AOI) -> list[tuple[int, int]]:
    """Level-0 chunks (i, j) that get a `bldg` image, row-major from the north: every chunk of a v1/v2 rectangle,
    only the present chunks of a v3 place (rule 2)."""
    cs = aoi.chunk_size
    nx, ny = aoi.width // cs, aoi.height // cs
    return [(i, j) for j in range(ny) for i in range(nx) if not aoi.is_place or aoi.chunk_present(i, j)]


# =========================================================================== CityGML parsing

@dataclass
class Building:
    id: str
    source: str  # 'sl' | 'rlp'
    surfaces: list[tuple[list[np.ndarray], int]] = field(default_factory=list)  # (rings, _SURFACE class), meshed
    ground: list[list[np.ndarray]] = field(default_factory=list)  # GroundSurface polygons (rings)
    footprint: Any = None  # shapely geometry, EPSG:25832


def _local(tag: Any) -> str:
    return etree.QName(tag).localname if isinstance(tag, str) else ""


def _ring_coords(ring_el) -> np.ndarray:
    pos_list = None
    poses, coords = [], None
    for ch in ring_el:
        ln = _local(ch.tag)
        if ln == "posList":
            pos_list = ch
        elif ln == "pos":
            poses.append(ch)
        elif ln == "coordinates":
            coords = ch
    if pos_list is not None:
        dim = int(pos_list.get("srsDimension") or ring_el.get("srsDimension") or 3)
        return parse_coords(pos_list.text or "", dim)
    if poses:
        return np.vstack([parse_coords(p.text or "", int(p.get("srsDimension") or 3)) for p in poses])
    if coords is not None:  # GML 2 style "x,y,z x,y,z"
        return parse_coords((coords.text or "").replace(",", " "), 3)
    return np.zeros((0, 3))


def polygon_rings(poly_el) -> list[np.ndarray]:
    """gml:Polygon → [exterior, *interiors] as (n,3) arrays (closing vertex kept; see clean_ring)."""
    ext, ints = None, []
    for ch in poly_el:
        ln = _local(ch.tag)
        if ln in ("exterior", "outerBoundaryIs", "interior", "innerBoundaryIs"):
            for ring in ch:
                if _local(ring.tag) == "LinearRing":
                    r = _ring_coords(ring)
                    if ln in ("exterior", "outerBoundaryIs"):
                        ext = r
                    else:
                        ints.append(r)
    return [] if ext is None else [ext, *ints]


def _surface_type(poly_el, stop) -> str | None:
    for anc in poly_el.iterancestors():
        if anc is stop:
            return None
        ln = _local(anc.tag)
        if ln in SURFACE_CLASS:
            return ln
    return None


def parse_building(el, source: str) -> Building:
    """bldg:Building (incl. its BuildingParts) → surfaces by class + ground polygons.

    Polygons inside a thematic boundary surface (Wall/Roof/Ground/Closure/…) are used; geometry outside those
    (lod0/lod1 footprints, inline lod2Solid polygons) only when the building has no thematic surfaces at all."""
    bid = el.get("{http://www.opengis.net/gml}id") or el.get("{http://www.opengis.net/gml/3.2}id") or ""
    b = Building(bid, source)
    loose: list[list[np.ndarray]] = []
    for poly in el.iter("{*}Polygon"):
        rings = polygon_rings(poly)
        if not rings or len(rings[0]) < 4:
            continue
        st = _surface_type(poly, el)
        if st is None:
            loose.append(rings)
        elif st == GROUND:
            b.ground.append(rings)
        else:
            b.surfaces.append((rings, SURFACE_CLASS[st]))
    if not b.surfaces and not b.ground:
        b.surfaces = [(r, SURF_OTHER) for r in loose]
    return b


def footprint_of(b: Building):
    """2D footprint: union of GroundSurface polygons; without ground, union of the 2D projections of all surfaces."""
    from shapely import make_valid, union_all
    from shapely.geometry import Polygon
    polys = []
    src = b.ground or [r for r, _ in b.surfaces]
    for rings in src:
        rr = [clean_ring(r) for r in rings]
        if len(rr[0]) < 3:
            continue
        p = Polygon(rr[0][:, :2], [r[:, :2] for r in rr[1:] if len(r) >= 3])
        if not p.is_valid:
            p = make_valid(p)
        if p.area > 0.01:
            polys.append(p)
    if not polys:
        return None
    g = union_all(polys)
    return g if not g.is_empty else None


def hardened_parser_kwargs() -> dict:
    """Downloaded GML is untrusted: no entity expansion, no DTD loading, no network access."""
    return dict(resolve_entities=False, load_dtd=False, no_network=True, huge_tree=True, remove_comments=True)


def iter_buildings(path: Path, source: str) -> Iterator[Building]:
    """Stream bldg:Building elements from a (gzip-compressed) CityGML file."""
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rb") as f:
        for _, el in etree.iterparse(f, events=("end",), tag="{*}Building", **hardened_parser_kwargs()):
            yield parse_building(el, source)
            el.clear(keep_tail=True)
            # free already-processed siblings (Building → cityObjectMember → CityModel) to keep memory flat
            node = el
            while node.getparent() is not None and _local(node.getparent().tag) != "CityModel":
                node = node.getparent()
            root = node.getparent()
            if root is not None:
                while node.getprevious() is not None:
                    del root[0]


def gml_srs_names(path: Path, nbytes: int = 1 << 16) -> set[str]:
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rb") as f:
        head = f.read(nbytes).decode("utf-8", "replace")
    return set(re.findall(r'srsName="([^"]+)"', head))


def srs_ok(names: set[str]) -> bool:
    """Accept ETRS89 / UTM 32N (EPSG:25832, AdV 'ETRS89_UTM32*DE_DHHN2016_NH' or compound 25832+7837)."""
    return bool(names) and all(("UTM32" in s) or ("25832" in s) for s in names)


# =========================================================================== glb

GLB_MAGIC, GLB_JSON, GLB_BIN = 0x46546C67, 0x4E4F534A, 0x004E4942
ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER = 34962, 34963
FLOAT, UNSIGNED_BYTE, UNSIGNED_SHORT, UNSIGNED_INT = 5126, 5121, 5123, 5125
_COMPONENT_DTYPE = {FLOAT: np.float32, UNSIGNED_BYTE: np.uint8, UNSIGNED_SHORT: np.uint16, UNSIGNED_INT: np.uint32}
_TYPE_SIZE = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def glb_bytes(positions: np.ndarray, normals: np.ndarray, surface: np.ndarray, indices: np.ndarray,
              name: str = "buildings") -> bytes:
    """glTF 2.0 binary: one scene/node/mesh/primitive (TRIANGLES, indexed), no materials/textures.

    Attributes POSITION + NORMAL (FLOAT VEC3) and `_SURFACE` (UNSIGNED_BYTE SCALAR, byteStride 4 because glTF
    requires every vertex-attribute element to start on a 4-byte boundary). Written by hand (≈ 40 lines) instead of
    pulling in pygltflib (its 1.16.5 `Attributes` failed to serialise a custom `_SURFACE` attribute)."""
    pos = np.ascontiguousarray(positions, np.float32).reshape(-1, 3)
    nrm = np.ascontiguousarray(normals, np.float32).reshape(-1, 3)
    n = len(pos)
    surf = np.zeros((n, 4), np.uint8)
    surf[:, 0] = np.asarray(surface, np.uint8)
    idx_t, idx_c = (np.uint16, UNSIGNED_SHORT) if n < 65536 else (np.uint32, UNSIGNED_INT)
    idx = np.ascontiguousarray(indices, idx_t).reshape(-1)
    blobs = [pos.tobytes(), nrm.tobytes(), surf.tobytes(), idx.tobytes()]
    views, bin_parts, off = [], [], 0
    for k, bl in enumerate(blobs):
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(bl),
             "target": ELEMENT_ARRAY_BUFFER if k == 3 else ARRAY_BUFFER}
        if k == 2:
            v["byteStride"] = 4
        views.append(v)
        pad = (-len(bl)) % 4
        bin_parts.append(bl + b"\0" * pad)
        off += len(bl) + pad
    bin_chunk = b"".join(bin_parts)
    gltf = {
        "asset": {"version": "2.0", "generator": "saar-lidar-explorer pipeline/buildings.py"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": name}],
        "meshes": [{"name": name, "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "_SURFACE": 2},
                                                  "indices": 3, "mode": 4}]}],
        "accessors": [
            {"bufferView": 0, "componentType": FLOAT, "count": n, "type": "VEC3",
             "min": pos.min(axis=0).tolist(), "max": pos.max(axis=0).tolist()},
            {"bufferView": 1, "componentType": FLOAT, "count": n, "type": "VEC3"},
            {"bufferView": 2, "componentType": UNSIGNED_BYTE, "count": n, "type": "SCALAR"},
            {"bufferView": 3, "componentType": idx_c, "count": len(idx), "type": "SCALAR"}],
        "bufferViews": views, "buffers": [{"byteLength": len(bin_chunk)}],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    total = 12 + 8 + len(js) + 8 + len(bin_chunk)
    head = np.array([GLB_MAGIC, 2, total, len(js), GLB_JSON], "<u4").tobytes()
    return head + js + np.array([len(bin_chunk), GLB_BIN], "<u4").tobytes() + bin_chunk


def read_glb(data: bytes) -> tuple[dict, dict[str, np.ndarray]]:
    """Minimal reader for our own glb files (tests/checks): (json, {attribute/'indices': array})."""
    magic, version, total, jlen, jtype = np.frombuffer(data[:20], "<u4")
    if magic != GLB_MAGIC or version != 2 or total != len(data) or jtype != GLB_JSON:
        raise ValueError("not a glTF 2.0 binary")
    gltf = json.loads(data[20:20 + jlen])
    blen, btype = np.frombuffer(data[20 + jlen:28 + jlen], "<u4")
    if btype != GLB_BIN:
        raise ValueError("missing BIN chunk")
    binary = data[28 + jlen:28 + jlen + blen]

    def accessor(i: int) -> np.ndarray:
        a = gltf["accessors"][i]
        v = gltf["bufferViews"][a["bufferView"]]
        dtype = np.dtype(_COMPONENT_DTYPE[a["componentType"]]).newbyteorder("<")
        comps = _TYPE_SIZE[a["type"]]
        stride = v.get("byteStride", dtype.itemsize * comps)
        raw = np.frombuffer(binary, np.uint8, count=v["byteLength"], offset=v["byteOffset"] + a.get("byteOffset", 0))
        rows = np.lib.stride_tricks.as_strided(raw, shape=(a["count"], dtype.itemsize * comps), strides=(stride, 1))
        out = np.ascontiguousarray(rows).view(dtype).reshape(a["count"], comps)
        return out[:, 0] if comps == 1 else out

    prim = gltf["meshes"][0]["primitives"][0]
    arrays = {k: accessor(i) for k, i in prim["attributes"].items()}
    if "indices" in prim:
        arrays["indices"] = accessor(prim["indices"])
    return gltf, arrays


def write_glb(path: Path, positions: np.ndarray, normals: np.ndarray, surface: np.ndarray, indices: np.ndarray) -> int:
    """Atomic write of `glb_bytes`; returns the file size."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".glb.tmp")
    tmp.write_bytes(glb_bytes(positions, normals, surface, indices, name=path.stem))
    tmp.replace(path)
    return path.stat().st_size


WALL_BASE_TOL = 0.05     # m: a wall's bottom counts as "on the ground" when within this of a GroundSurface height
WALL_SKIRT_MARGIN = 0.3  # m: wall bottoms are lowered to min(DTM along the wall) minus this margin
WALL_SKIRT_MAX = 5.0     # m: never lower a wall bottom by more than this (guards against DTM outliers)
SKIRT_STEP = 1.0         # m: DTM sampling step along a wall's footprint


def densify_path(pts2: np.ndarray, step: float = SKIRT_STEP) -> np.ndarray:
    """Closed 2D ring (n,2) → points every ≤ step metres along all edges (vertices included)."""
    pts2 = np.asarray(pts2, np.float64)
    out = []
    for a, b in zip(pts2, np.roll(pts2, -1, axis=0)):
        k = max(1, int(math.ceil(float(np.linalg.norm(b - a)) / step)))
        t = np.arange(k)[:, None] / k
        out.append(a + (b - a) * t)
    return np.concatenate(out) if out else pts2


def skirt_walls(verts: np.ndarray, ground_z: np.ndarray, z_at, tol: float = WALL_BASE_TOL,
                margin: float = WALL_SKIRT_MARGIN, max_drop: float = WALL_SKIRT_MAX) -> tuple[np.ndarray, float]:
    """Close gaps under a wall that stands on a GroundSurface (F11: no floating buildings).

    LoD2 floors are flat at about the lowest outline point, so where the DTM falls away below the floor (or the DTM
    dips along the wall) the wall bottom would hover. The wall's bottom vertices (z within `tol` of the wall's
    lowest z, which must itself be within `tol` of a GroundSurface height in `ground_z`) are lowered to
    min(DTM sampled every metre along the wall's footprint) − margin, by at most `max_drop`. Roofs and walls of
    dormers/upper parts are untouched; a vertical wall stays in its plane, so normals stay valid. Returns the new
    vertices (EPSG:25832, copy) and the remaining gap (> 0 only when `max_drop` capped the drop)."""
    zmin = float(verts[:, 2].min())
    if ground_z.size == 0 or float(np.min(np.abs(ground_z - zmin))) > tol:
        return verts, 0.0
    d = densify_path(verts[:, :2])
    dtm = np.asarray(z_at(d[:, 0], d[:, 1]), np.float64)
    target = max(float(dtm.min()) - margin, zmin - max_drop)
    if target >= zmin:
        return verts, 0.0
    out = verts.copy()
    out[out[:, 2] <= zmin + tol, 2] = target
    return out, max(0.0, target - float(dtm.min()))


@dataclass
class MeshBuilder:
    positions: list[np.ndarray] = field(default_factory=list)
    normals: list[np.ndarray] = field(default_factory=list)
    surface: list[np.ndarray] = field(default_factory=list)
    indices: list[np.ndarray] = field(default_factory=list)
    nverts: int = 0
    ntris: int = 0
    skirted_walls: int = 0
    capped_walls: int = 0
    capped_buildings: list[str] = field(default_factory=list)  # ids with a wall gap > 0.5 m left after skirting

    def add_building(self, b: Building, e0: float, n0: float, z_at=None) -> int:
        """Append all meshed surfaces of b (local frame). Returns the number of triangles added.

        With `z_at(E, N) → DTM height`, walls standing on the ground are extended down to the DTM (`skirt_walls`)."""
        added, capped = 0, False
        ground_z = np.asarray([float(r[0][:, 2].min()) for r in b.ground if len(r[0])], np.float64)
        for rings, cls in b.surfaces:
            t = triangulate_polygon(rings)
            if t is None:
                continue
            verts, tris, nrm = t
            if z_at is not None and cls == SURF_WALL:
                new, gap = skirt_walls(verts, ground_z, z_at)
                if new is not verts:
                    self.skirted_walls += 1
                    self.capped_walls += gap > 0.5
                    capped |= gap > 0.5
                verts = new
            self.positions.append(to_local(verts, e0, n0))
            self.normals.append(np.repeat(to_local(nrm[None, :], 0, 0), len(verts), axis=0))
            self.surface.append(np.full(len(verts), cls, np.uint8))
            self.indices.append(tris + self.nverts)
            self.nverts += len(verts)
            added += len(tris)
        self.ntris += added
        if capped and added:
            self.capped_buildings.append(b.id)
        return added

    def write(self, path: Path) -> int:
        return write_glb(path, np.concatenate(self.positions), np.concatenate(self.normals),
                         np.concatenate(self.surface), np.concatenate(self.indices))


# =========================================================================== fetch

def _gz_write(dst: Path, src) -> None:
    part = dst.with_name(dst.name + ".part")
    with gzip.open(part, "wb", compresslevel=6) as out:
        while chunk := src.read(4 << 20):
            out.write(chunk)
    _validate_gml(part)
    part.rename(dst)


def _validate_gml(path: Path) -> None:
    """Root must be a CityGML CityModel; the whole file must be well-formed (parsed with the hardened parser)."""
    with gzip.open(path, "rb") as f:
        it = etree.iterparse(f, events=("start",), **hardened_parser_kwargs())
        _, root = next(it)
        if _local(root.tag) != "CityModel":
            path.unlink()
            raise ValueError(f"{path.name}: root is {root.tag}, not a CityGML CityModel")
    with gzip.open(path, "rb") as f:
        for _, el in etree.iterparse(f, events=("end",), **hardened_parser_kwargs()):
            el.clear()


def sl_tile_name(e: int, n: int) -> str:
    return f"LoD2_32_{e}_{n}_1_SL.gml"


def fetch_sl(aoi: AOI, refresh: bool = False) -> list[Path]:
    """Range-extract the SL LoD2 tiles of AOI + buffer ring from the county ZIP (cached, gzip)."""
    from fetch import CLOUD_BASE, HttpRangeFile, dav_list, resolve_share_token
    d = LOD2_RAW / "sl"
    d.mkdir(parents=True, exist_ok=True)
    tiles = aoi.tiles(buffered=True)
    miss_f = d / f"_not_in_zip_{aoi.county}.json"
    known_missing = set() if refresh or not miss_f.exists() else set(json.loads(miss_f.read_text()))
    todo = [t for t in tiles if not (d / (sl_tile_name(*t) + ".gz")).exists() and sl_tile_name(*t) not in known_missing]
    if todo:
        token = resolve_share_token()
        dav = f"{CLOUD_BASE}/public.php/dav/files/{token}/{urllib.parse.quote(SL_FOLDER)}/"
        zips = [z for z in dav_list(dav) if z.endswith(".zip") and z.startswith(f"{aoi.county}_")]
        if len(zips) != 1:
            sys.exit(f"expected one {aoi.county} LoD2 ZIP in {dav}, found {zips}")
        rf = HttpRangeFile(dav + urllib.parse.quote(zips[0]))
        zf = zipfile.ZipFile(io.BufferedReader(rf, buffer_size=4 << 20))
        members = {Path(i.filename).name: i for i in zf.infolist()}
        print(f"LVGL LoD2: {zips[0]} ({fmt_bytes(rf.size)}, {len(members)} members, central dir in {rf.requests} requests)")
        for t in todo:
            name = sl_tile_name(*t)
            info = members.get(name)
            if info is None:
                known_missing.add(name)
                print(f"  - {name}: not in ZIP")
                continue
            t0, r0 = time.time(), rf.requests
            for attempt in range(3):
                try:
                    with zf.open(info) as src:
                        _gz_write(d / (name + ".gz"), src)
                    break
                except (OSError, zipfile.BadZipFile, etree.XMLSyntaxError) as e:
                    print(f"  ! {name}: {e} (attempt {attempt + 1})", file=sys.stderr)
                    time.sleep(3)
            else:
                sys.exit(f"failed to extract {name}")
            print(f"  + {name}: {fmt_bytes(info.compress_size)} zipped / {fmt_bytes(info.file_size)}, "
                  f"{rf.requests - r0} requests, {time.time() - t0:.1f}s")
        miss_f.write_text(json.dumps(sorted(known_missing), indent=0))
    else:
        print(f"LVGL LoD2: all {len(tiles)} tiles cached or known missing")
    return [d / (sl_tile_name(*t) + ".gz") for t in tiles if (d / (sl_tile_name(*t) + ".gz")).exists()]


def rlp_tiles_for(aoi: AOI, available: set[tuple[int, int]]) -> list[tuple[int, int]]:
    """2 km RLP tiles (lower-left km corner, even) whose square intersects the AOI (open intervals)."""
    out = []
    for (e, n) in sorted(available):
        if e * 1000 < aoi.e1 and (e + RLP_TILE_KM) * 1000 > aoi.e0 and n * 1000 < aoi.n1 and (n + RLP_TILE_KM) * 1000 > aoi.n0:
            out.append((e, n))
    return out


def parse_rlp_listing(html: str) -> dict[tuple[int, int], str]:
    return {(int(m.group(2)), int(m.group(3))): m.group(1)
            for m in re.finditer(r'href="(LoD2_32_(\d+)_(\d+)_2_RP\.gml)"', html)}


def fetch_rlp(aoi: AOI, refresh: bool = False) -> list[Path]:
    d = LOD2_RAW / "rlp"
    d.mkdir(parents=True, exist_ok=True)
    listing_f = d / "_listing.json"
    if refresh or not listing_f.exists():
        with http_open(RLP_BASE, timeout=120) as r:
            avail = parse_rlp_listing(r.read().decode("utf-8", "replace"))
        if not avail:
            sys.exit(f"no LoD2 tiles found in {RLP_BASE} listing")
        listing_f.write_text(json.dumps({f"{e}_{n}": v for (e, n), v in sorted(avail.items())}, indent=0))
    avail = {tuple(int(x) for x in k.split("_")): v for k, v in json.loads(listing_f.read_text()).items()}
    out = []
    for t in rlp_tiles_for(aoi, set(avail)):
        name = avail[t]
        dst = d / (name + ".gz")
        if not dst.exists():
            t0 = time.time()
            with http_open(RLP_BASE + name, timeout=300) as r:
                _gz_write(dst, r)
            print(f"  + RLP {name}: {fmt_bytes(dst.stat().st_size)} gz, {time.time() - t0:.1f}s")
            time.sleep(0.3)
        out.append(dst)
    print(f"RLP LoD2: {len(out)} 2-km tiles intersect the AOI")
    return out


# =========================================================================== build

def load_buildings(paths: list[Path], source: str, seen: set[str]) -> tuple[list[Building], dict]:
    out, stats = [], {"files": 0, "buildings": 0, "duplicates": 0, "srs": set()}
    for p in paths:
        srs = gml_srs_names(p)
        if not srs_ok(srs):
            sys.exit(f"{p.name}: unexpected CRS {srs} (expected ETRS89/UTM32 + DHHN2016)")
        stats["srs"] |= srs
        stats["files"] += 1
        for b in iter_buildings(p, source):
            if b.id and b.id in seen:
                stats["duplicates"] += 1
                continue
            seen.add(b.id)
            b.footprint = footprint_of(b)
            if b.footprint is None:
                continue
            out.append(b)
            stats["buildings"] += 1
    stats["srs"] = sorted(stats["srs"])
    return out, stats


def drop_rlp_duplicates(sl: list[Building], rlp: list[Building]) -> tuple[list[Building], int]:
    """Drop RLP buildings whose footprint representative point lies inside an SL footprint."""
    if not sl or not rlp:
        return rlp, 0
    from shapely import STRtree
    tree = STRtree([b.footprint for b in sl])
    keep = []
    for b in rlp:
        pt = b.footprint.representative_point()
        if len(tree.query(pt, predicate="within")):
            continue
        keep.append(b)
    return keep, len(rlp) - len(keep)


FLAT_DTM_RANGE = 0.3  # m: DTM range along a footprint outline below which a building counts as "on flat ground"


def _outline(b: Building) -> np.ndarray:
    return np.concatenate([clean_ring(rings[0]) for rings in b.ground])


def ground_offsets(buildings: list[Building], dtm_path: Path, aoi: AOI) -> dict:
    """GroundSurface heights vs the 1 m DTM (bilinear) at the footprint outline vertices, buildings fully in the AOI.

    LoD2 GroundSurfaces are horizontal and sit at about the *lowest* terrain point of the outline, so on slopes the
    per-building median offset is negative by construction (the building is sunk into the upslope side, which looks
    right). Reported: median(g − DTM) on all and on flat buildings (vertical datum check), g − min(DTM) (the LoD2
    convention), and the share of buildings with an outline vertex floating > 0.5 m above the DTM. These are the raw
    LoD2 numbers: the meshes close such gaps by lowering wall bottoms to the DTM (`skirt_walls`, see `wall_skirts`)."""
    from heights import DtmSampler
    s = DtmSampler.from_geotiff(dtm_path, aoi.e0, aoi.n1)
    med, low, flo, flat = [], [], [], []
    for b in buildings:
        if not b.ground:
            continue
        pts = _outline(b)
        if not ((pts[:, 0] > aoi.e0) & (pts[:, 0] < aoi.e1) & (pts[:, 1] > aoi.n0) & (pts[:, 1] < aoi.n1)).all():
            continue
        d = s.z(pts[:, 0], pts[:, 1])
        dz = pts[:, 2] - d
        med.append(float(np.median(dz)))
        low.append(float(pts[:, 2].min() - d.min()))
        flo.append(float(dz.max()))
        if float(d.max() - d.min()) < FLAT_DTM_RANGE:
            flat.append(float(np.median(dz)))
    if not med:
        return {}

    def pct(v):
        v = np.asarray(v)
        return {"n": int(v.size), "median": round(float(np.median(v)), 3),
                "p05": round(float(np.percentile(v, 5)), 3), "p95": round(float(np.percentile(v, 95)), 3)}

    return {"median_ground_minus_dtm": pct(med), "flat_buildings_median_ground_minus_dtm": pct(flat),
            "ground_minus_lowest_dtm": pct(low),
            "share_floating_gt_0_5m": round(float(np.mean(np.asarray(flo) > 0.5)), 4),
            "share_floating_gt_0_2m": round(float(np.mean(np.asarray(flo) > 0.2)), 4)}


def spot_check(buildings: list[Building], dtm_path: Path, aoi: AOI, e: float, n: float) -> dict | None:
    """The building on flat ground (DTM range along the outline < 0.3 m) nearest to (e, n): ground vs DTM."""
    from heights import DtmSampler
    from shapely.geometry import Point
    s = DtmSampler.from_geotiff(dtm_path, aoi.e0, aoi.n1)
    p = Point(e, n)
    best = None
    for b in sorted((b for b in buildings if b.ground), key=lambda b: b.footprint.distance(p))[:200]:
        pts = _outline(b)
        dtm = s.z(pts[:, 0], pts[:, 1])
        if float(dtm.max() - dtm.min()) < FLAT_DTM_RANGE:
            best = (b, pts, dtm)
            break
    if best is None:
        return None
    b, pts, dtm = best
    c = b.footprint.centroid
    return {"id": b.id, "source": b.source, "centroid": [round(c.x, 2), round(c.y, 2)],
            "distance_m": round(b.footprint.distance(p), 1), "outline_vertices": len(pts),
            "ground_h": round(float(np.median(pts[:, 2])), 3), "dtm_median": round(float(np.median(dtm)), 3),
            "dtm_range": round(float(dtm.max() - dtm.min()), 3),
            "offset_median": round(float(np.median(pts[:, 2] - dtm)), 3)}


def save_png(path: Path, arr: np.ndarray) -> None:
    from PIL import Image
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr).save(path, compress_level=9)


def save_preview(aoi: AOI, mask: np.ndarray) -> None:
    """docs/previews/<aoi>_bldg.jpg: buildings (red) over the CHM (gray), ≤ 3000 px — check footprints vs canopy."""
    import rasterio
    from PIL import Image
    from common import PREVIEW_DIR
    from render import downsample_mean
    chm_p = WORK_DIR / aoi.key / "chm.tif"
    if not chm_p.exists():
        return
    with rasterio.open(chm_p) as ds:
        chm = ds.read(1)
    f = max(1, math.ceil(max(aoi.width, aoi.height) / 3000))
    g = np.clip(downsample_mean(chm, f) / 25.0, 0, 1)
    b = downsample_mean(mask.astype(np.float32), f)
    rgb = np.stack([g, g, g], axis=-1) * 0.8 + 0.1
    rgb = rgb * (1 - b[..., None]) + np.array([0.9, 0.1, 0.1]) * b[..., None]
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.rint(rgb * 255).astype(np.uint8)).save(PREVIEW_DIR / f"{aoi.key}_bldg.jpg", quality=80,
                                                              optimize=True)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("aoi")
    ap.add_argument("--refresh", action="store_true", help="re-check missing SL tiles and re-read the RLP listing")
    ap.add_argument("--no-rlp", action="store_true")
    args = ap.parse_args(argv)
    aoi = load_aoi(args.aoi)
    aoi_dir = aoi.data_dir
    mpath = aoi_dir / "manifest.json"
    dtm_path = WORK_DIR / aoi.key / "dtm.tif"
    if not mpath.exists() or not dtm_path.exists():
        sys.exit(f"{mpath} / {dtm_path} missing – run build first")
    m = json.loads(mpath.read_text())
    if (m.get("origin", {}).get("E0"), m.get("origin", {}).get("N0")) != (aoi.e0, aoi.n0):
        sys.exit(f"manifest origin {m.get('origin')} does not match aois.toml bbox for {aoi.key}")
    cs = aoi.chunk_size
    nx, ny = aoi.width // cs, aoi.height // cs
    t0 = time.time()
    timings: dict[str, float] = {}

    sl_paths = fetch_sl(aoi, args.refresh)
    rlp_paths = [] if args.no_rlp else fetch_rlp(aoi, args.refresh)
    timings["fetch"] = round(time.time() - t0, 1)

    t = time.time()
    seen: set[str] = set()
    sl, sl_stats = load_buildings(sl_paths, "sl", seen)
    rlp, rlp_stats = load_buildings(rlp_paths, "rlp", seen)
    rlp, rlp_dups = drop_rlp_duplicates(sl, rlp)
    timings["parse"] = round(time.time() - t, 1)
    print(f"parsed SL {sl_stats['buildings']} buildings ({sl_stats['files']} tiles), RLP {len(rlp)} "
          f"({rlp_stats['files']} tiles, {rlp_dups} SL duplicates dropped) in {timings['parse']}s")

    everything = sl + rlp
    in_aoi = select_buildings(everything, aoi)
    if aoi.is_place:
        print(f"v3 place: {len(in_aoi)} buildings with the footprint centroid in the {len(aoi.owned)} present tiles")

    # --- meshes ------------------------------------------------------------------------------------
    t = time.time()
    out_models = aoi_dir / "models" / "buildings"
    if out_models.exists():
        shutil.rmtree(out_models)
    builders: dict[tuple[int, int], MeshBuilder] = {}
    per_chunk_buildings: dict[tuple[int, int], int] = {}
    used = {"sl": 0, "rlp": 0}
    from heights import DtmSampler
    dtm_s = DtmSampler.from_geotiff(dtm_path, aoi.e0, aoi.n1)
    for b in in_aoi:
        c = b.footprint.centroid
        key = chunk_of(c.x, c.y, aoi.e0, aoi.n1, nx, ny, cs)
        assert not aoi.is_place or aoi.chunk_present(*key), (b.id, key)   # rule 2: centroid tile is present
        mb = builders.setdefault(key, MeshBuilder())
        if mb.add_building(b, aoi.e0, aoi.n0, z_at=dtm_s.z):
            per_chunk_buildings[key] = per_chunk_buildings.get(key, 0) + 1
            used[b.source] += 1
    sizes = {}
    for key, mb in sorted(builders.items()):
        if mb.ntris == 0:
            continue
        sizes[key] = mb.write(out_models / f"{key[0]}_{key[1]}.glb")
    timings["meshes"] = round(time.time() - t, 1)
    total_tris = sum(mb.ntris for mb in builders.values())
    total_verts = sum(mb.nverts for mb in builders.values())
    skirted = sum(mb.skirted_walls for mb in builders.values())
    capped = sum(mb.capped_walls for mb in builders.values())
    capped_ids = sorted(i for mb in builders.values() for i in mb.capped_buildings)
    print(f"wall skirts: {skirted} walls lowered to the DTM (−{WALL_SKIRT_MARGIN} m), {capped} capped at "
          f"{WALL_SKIRT_MAX} m with a gap > 0.5 m left ({len(capped_ids)} of {sum(used.values())} buildings)")
    print(f"meshes: {sum(used.values())} buildings in {len(sizes)} chunks, {total_tris} triangles, {total_verts} vertices, "
          f"{fmt_bytes(sum(sizes.values()))} (max chunk {fmt_bytes(max(sizes.values(), default=0))})")

    # --- mask --------------------------------------------------------------------------------------
    t = time.time()
    mask = rasterize_mask([b.footprint for b in everything], aoi.e0, aoi.n1, aoi.width, aoi.height)
    out_mask = aoi_dir / "relief" / "bldg"
    if out_mask.exists():
        shutil.rmtree(out_mask)
    mask_bytes = 0
    for i, j in mask_chunks(aoi):
        tile = (mask[j * cs:(j + 1) * cs, i * cs:(i + 1) * cs] * 255).astype(np.uint8)
        if aoi.is_place:   # fixed range 0–1 (rule 5): u8 255 = 1; bit-exact round trip asserted by the encoder
            from encode import save_webp_lossless
            mask_bytes += save_webp_lossless(out_mask / f"{i}_{j}.webp", tile)
        else:
            save_png(out_mask / f"{i}_{j}.png", tile)
            mask_bytes += (out_mask / f"{i}_{j}.png").stat().st_size
    import rasterio
    from rasterio.transform import from_origin
    (WORK_DIR / aoi.key).mkdir(parents=True, exist_ok=True)
    with rasterio.open(WORK_DIR / aoi.key / "bldg.tif", "w", driver="GTiff", width=aoi.width, height=aoi.height,
                       count=1, dtype="uint8", crs="EPSG:25832", transform=from_origin(aoi.e0, aoi.n1, 1, 1),
                       compress="deflate") as ds:
        ds.write(mask, 1)
    timings["mask"] = round(time.time() - t, 1)
    if not aoi.is_place:   # docs/previews/ holds the curated AOI previews only
        save_preview(aoi, mask)
    print(f"bldg mask: {int(mask.sum())} cells ({mask.mean() * 100:.2f} % of the rectangle), "
          f"{len(mask_chunks(aoi))} chunk images, {fmt_bytes(mask_bytes)}")

    # --- checks + manifest -------------------------------------------------------------------------
    offsets = ground_offsets(in_aoi, dtm_path, aoi)
    print(f"ground vs DTM (per-building median of GroundSurface vertices): {offsets}")
    spots = {name: spot_check(in_aoi, dtm_path, aoi, e, n) for name, (e, n) in {
        "Schloss Karlsberg": (382198, 5466099), "Homburg Schlossberg": (379680, 5464414),
        "Kirrberg": (381412, 5462164), "AOI centre": ((aoi.e0 + aoi.e1) / 2, (aoi.n0 + aoi.n1) / 2)}.items()
        if aoi.e0 <= e <= aoi.e1 and aoi.n0 <= n <= aoi.n1}
    for k, v in spots.items():
        print(f"  spot {k}: {v}")

    chunks = [list(k) for k in sorted(sizes, key=lambda k: (k[1], k[0]))]
    today = dt.date.today().isoformat()
    src = [f"LVGL-SL {aoi.county}_LOD2BWK_gml.zip ({sl_stats['files']} Kacheln)"]
    attribution = [ATTRIBUTION_LOD2_SL] if used["sl"] else []
    drop = [] if used["sl"] else [ATTRIBUTION_LOD2_SL]
    if used["rlp"]:
        attribution.append(ATTRIBUTION_LOD2_RLP)
        src.append(f"GeoBasis-RLP geb3dlo ({rlp_stats['files']} Kacheln)")
    else:
        drop.append(ATTRIBUTION_LOD2_RLP)
    models_entry = {"path": MODEL_PATH, "chunks": chunks, "frame": "local", "featureCount": sum(used.values()),
                    "label_de": LABEL_DE, "attribution": "; ".join(attribution),
                    "source": " + ".join(src) + f", abgerufen {today}"}
    bldg_entry = {"path": MASK_PATH_V3 if aoi.is_place else MASK_PATH, "encoding": "u8", "min": 0, "max": 1, "label_de": "Gebäudemaske",
                  "description": "Zellmitte in LoD2-Grundfläche, um 1 m erweitert (Kronen über Gebäuden ausblenden)"}
    patch: dict[str, Any] = {"layers": {"bldg": bldg_entry}, "models": {"buildings": models_entry}}
    cur = json.loads(mpath.read_text())  # re-read right before the write (other steps may run concurrently)
    levels = copy.deepcopy(cur.get("levels"))
    if isinstance(levels, list) and levels and isinstance(levels[0], dict) and levels[0].get("level") == 0 \
            and isinstance(levels[0].get("layers"), dict):
        levels[0]["layers"]["bldg"] = bldg_entry  # level 0 is informative and repeats the top-level layers
        patch["levels"] = levels
    update_manifest(aoi_dir, patch, merge=["layers", "models"], attribution=attribution, drop_attribution=drop)

    report = {"aoi": aoi.key, "date": today, "sl": sl_stats, "rlp": {**rlp_stats, "sl_duplicates_dropped": rlp_dups},
              "buildings_in_aoi": len(in_aoi), "meshed": used, "chunks": len(sizes), "triangles": total_tris,
              "vertices": total_verts, "glb_bytes": sum(sizes.values()), "glb_max_bytes": max(sizes.values(), default=0),
              "mask_cells": int(mask.sum()), "mask_bytes": mask_bytes, "ground_vs_dtm": offsets,
              "wall_skirts": {"lowered_walls": skirted, "capped_gap_gt_0_5m": capped,
                              "buildings_with_gap_gt_0_5m": len(capped_ids), "gap_building_ids": capped_ids[:50], "margin_m": WALL_SKIRT_MARGIN,
                              "max_drop_m": WALL_SKIRT_MAX}, "spot_checks": spots, "timings": timings}
    (WORK_DIR / aoi.key / "buildings.json").write_text(json.dumps(report, indent=1, ensure_ascii=False))
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
