"""F11 / R0.7: LoD2 geometry (triangulation, plane projection, local frame), glb writer, bldg mask alignment."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest
from shapely.geometry import Point, Polygon, box

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from buildings import (  # noqa: E402
    SURF_OTHER, SURF_ROOF, SURF_WALL, WALL_SKIRT_MARGIN, WALL_SKIRT_MAX, Building, MeshBuilder, densify_path,
    skirt_walls, chunk_of, clean_ring, footprint_of, glb_bytes, iter_buildings,
    newell_normal, parse_coords, plane_basis, project_to_plane, rasterize_mask, read_glb, rlp_tiles_for, srs_ok,
    to_local, triangulate_polygon,
)
from common import AOI  # noqa: E402

E0, N0 = 381000, 5465000


def tri_areas(verts, tris):
    a, b, c = verts[tris[:, 0]], verts[tris[:, 1]], verts[tris[:, 2]]
    return np.linalg.norm(np.cross(b - a, c - a), axis=1) / 2


def tilted(p2: np.ndarray, h0=300.0) -> np.ndarray:
    """Embed 2D points in a tilted plane (roof-like: 30° pitch about the E axis, plus some yaw)."""
    yaw = np.radians(25)
    R = np.array([[np.cos(yaw), -np.sin(yaw)], [np.sin(yaw), np.cos(yaw)]])
    q = p2 @ R.T
    return np.column_stack([q[:, 0] + E0 + 100, q[:, 1] * np.cos(np.radians(30)) + N0 + 200,
                            h0 + q[:, 1] * np.sin(np.radians(30))])


# L-shaped (non-convex) outer ring, CCW seen from above, with a square hole (CW)
L_OUTER = np.array([[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10], [0, 0]], float)
HOLE = np.array([[1, 1], [1, 3], [3, 3], [3, 1], [1, 1]], float)


def test_triangulate_nonconvex_with_hole_flat():
    rings = [np.column_stack([L_OUTER, np.full(len(L_OUTER), 300.0)]),
             np.column_stack([HOLE, np.full(len(HOLE), 300.0)])]
    verts, tris, n = triangulate_polygon(rings)
    ref = Polygon(L_OUTER, [HOLE])
    assert np.isclose(tri_areas(verts, tris).sum(), ref.area)  # 64 − 4 = 60 m²
    assert np.allclose(n, [0, 0, 1])  # CCW from above → up
    # every triangle centroid lies inside the polygon (not in the hole, not in the L's notch)
    cent = verts[tris].mean(axis=1)
    assert all(ref.contains(Point(c[0], c[1])) for c in cent)
    # all triangles oriented like the polygon normal
    a, b, c = verts[tris[:, 0]], verts[tris[:, 1]], verts[tris[:, 2]]
    assert (np.cross(b - a, c - a) @ n > 0).all()


def test_triangulate_tilted_plane_preserves_area_and_orientation():
    rings = [tilted(L_OUTER), tilted(HOLE)]
    verts, tris, n = triangulate_polygon(rings)
    assert np.isclose(tri_areas(verts, tris).sum(), 60.0, atol=1e-6)
    assert np.isclose(np.linalg.norm(n), 1) and n[2] > 0.8  # pitched 30° → nz = cos 30°
    assert np.isclose(n[2], np.cos(np.radians(30)), atol=1e-9)
    a, b, c = verts[tris[:, 0]], verts[tris[:, 1]], verts[tris[:, 2]]
    assert (np.cross(b - a, c - a) @ n > 0).all()
    # reversed ring order (clockwise from outside) → opposite normal, still consistent triangles
    verts2, tris2, n2 = triangulate_polygon([r[::-1] for r in rings])
    assert np.allclose(n2, -n)
    a, b, c = verts2[tris2[:, 0]], verts2[tris2[:, 1]], verts2[tris2[:, 2]]
    assert (np.cross(b - a, c - a) @ n2 > 0).all()


def test_vertical_wall_triangulates():
    wall = np.array([[0, 0, 300], [5, 0, 300], [5, 0, 306], [0, 0, 306], [0, 0, 300]], float) + [E0, N0, 0]
    verts, tris, n = triangulate_polygon([wall])
    assert np.isclose(tri_areas(verts, tris).sum(), 30.0)
    assert np.allclose(n, [0, -1, 0])  # CCW seen from the south → faces south (−N)


def test_degenerate_polygons_are_skipped():
    line = np.array([[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 0, 0]], float)
    assert triangulate_polygon([line]) is None
    assert triangulate_polygon([np.array([[0, 0, 0], [1, 0, 0], [0, 0, 0]], float)]) is None


def test_plane_projection_is_isometric():
    rng = np.random.default_rng(1)
    n = rng.normal(size=3)
    n /= np.linalg.norm(n)
    u, v = plane_basis(n)
    assert np.isclose(u @ v, 0) and np.isclose(u @ n, 0) and np.allclose(np.cross(u, v), n)
    origin = np.array([E0 + 5.0, N0 + 7.0, 280.0])
    p2 = rng.uniform(-20, 20, (12, 2))
    pts = origin + p2[:, :1] * u + p2[:, 1:] * v
    q = project_to_plane(pts, n, origin)
    assert np.allclose(q, p2, atol=1e-9)
    nn = newell_normal(pts[[0, 1, 2]])
    assert np.isclose(abs(nn @ n) / np.linalg.norm(nn), 1)


def test_clean_ring_and_poslist():
    r = parse_coords("0 0 1  1 0 1  1 0 1  1 1 1  0 0 1")
    assert r.shape == (5, 3)
    assert len(clean_ring(r)) == 3
    assert parse_coords("1 2 3 4", dim=2).tolist() == [[1, 2, 0], [3, 4, 0]]
    with pytest.raises(ValueError):
        parse_coords("1 2 3 4", dim=3)


def test_local_frame_transform():
    p = np.array([[E0 + 10.0, N0 + 20.0, 300.5]])
    assert to_local(p, E0, N0).tolist() == [[10.0, 300.5, -20.0]]
    # proper rotation: (E, N, h) → (x, y, z) keeps handedness, so normals map with the same formula
    M = to_local(np.eye(3), 0, 0)  # images of the unit vectors E, N, up
    assert np.isclose(np.linalg.det(M), 1.0)
    assert to_local(np.array([[0, 0, 1.0]]), 0, 0).tolist() == [[0, 1, 0]]  # up stays up (+y)
    assert to_local(np.array([[0, 1.0, 0]]), 0, 0).tolist() == [[0, 0, -1]]  # north → −z


def test_chunk_of_counts_rows_from_north():
    n_top = N0 + 3000
    assert chunk_of(E0 + 0.1, n_top - 0.1, E0, n_top, 6, 6) == (0, 0)
    assert chunk_of(E0 + 501, n_top - 499, E0, n_top, 6, 6) == (1, 0)
    assert chunk_of(E0 + 501, n_top - 501, E0, n_top, 6, 6) == (1, 1)
    assert chunk_of(E0 + 2999, N0 + 1, E0, n_top, 6, 6) == (5, 5)
    assert chunk_of(E0 - 10, N0 - 10, E0, n_top, 6, 6) == (0, 5)  # clamped


def test_mask_cell_centre_rule_half_pixel():
    W, H = 10, 8
    n_top = N0 + H
    # x from E0+2.6 to E0+5.4 covers centres 3.5, 4.5 → cols 3, 4; y from n_top−1.4 to n_top−4.6
    # covers row centres n_top−1.5 … n_top−4.5 → rows 1..4
    m = rasterize_mask([box(E0 + 2.6, n_top - 4.6, E0 + 5.4, n_top - 1.4)], E0, n_top, W, H, dilate=False)
    rows, cols = np.nonzero(m)
    assert sorted(set(cols)) == [3, 4] and sorted(set(rows)) == [1, 2, 3, 4]
    # widen by 0.2 m past the next centres → cols 2..5
    m2 = rasterize_mask([box(E0 + 2.4, n_top - 4.6, E0 + 5.6, n_top - 1.4)], E0, n_top, W, H, dilate=False)
    assert sorted(set(np.nonzero(m2)[1])) == [2, 3, 4, 5]
    # dilation adds exactly one cell all round
    md = rasterize_mask([box(E0 + 2.6, n_top - 4.6, E0 + 5.4, n_top - 1.4)], E0, n_top, W, H)
    r, c = np.nonzero(md)
    assert (r.min(), r.max(), c.min(), c.max()) == (0, 5, 2, 5)
    assert md.sum() == 6 * 4


def test_mask_matches_point_in_polygon_everywhere():
    W, H = 40, 30
    n_top = N0 + H
    poly = Polygon([(E0 + 3.3, n_top - 2.2), (E0 + 31.7, n_top - 5.1), (E0 + 25.2, n_top - 27.6),
                    (E0 + 14.1, n_top - 12.9), (E0 + 5.05, n_top - 24.3)])
    m = rasterize_mask([poly], E0, n_top, W, H, dilate=False)
    for r in range(H):
        for c in range(W):
            p = Point(E0 + c + 0.5, n_top - r - 0.5)
            if poly.exterior.distance(p) < 1e-6:
                continue  # ties on the boundary are implementation-defined
            assert m[r, c] == int(poly.contains(p)), (r, c)


def test_mask_footprint_outside_aoi_dilates_in():
    W, H = 5, 5
    n_top = N0 + H
    m = rasterize_mask([box(E0 - 0.9, n_top - 3.0, E0 - 0.1, n_top - 2.0)], E0, n_top, W, H)
    assert m[:, 0].tolist() == [0, 1, 1, 1, 0] and m[:, 1:].sum() == 0


def test_glb_roundtrip_and_alignment():
    rings = [tilted(L_OUTER), tilted(HOLE)]
    verts, tris, n = triangulate_polygon(rings)
    pos = to_local(verts, E0, N0)
    nrm = np.repeat(to_local(n[None], 0, 0), len(pos), axis=0)
    surf = np.full(len(pos), SURF_ROOF, np.uint8)
    data = glb_bytes(pos, nrm, surf, tris)
    assert len(data) % 4 == 0
    gltf, arr = read_glb(data)
    assert gltf["asset"]["version"] == "2.0" and len(gltf["meshes"]) == 1
    prim = gltf["meshes"][0]["primitives"][0]
    assert set(prim["attributes"]) == {"POSITION", "NORMAL", "_SURFACE"} and prim["mode"] == 4
    assert "images" not in gltf and "textures" not in gltf
    acc = gltf["accessors"][prim["attributes"]["_SURFACE"]]
    assert acc["componentType"] == 5121 and acc["type"] == "SCALAR"
    for v in gltf["bufferViews"]:
        assert v["byteOffset"] % 4 == 0 and v.get("byteStride", 4) % 4 == 0
    assert np.allclose(arr["POSITION"], pos.astype(np.float32))
    assert np.allclose(arr["NORMAL"], nrm.astype(np.float32))
    assert arr["_SURFACE"].tolist() == surf.tolist()
    assert arr["indices"].reshape(-1, 3).tolist() == tris.tolist()
    pa = gltf["accessors"][prim["attributes"]["POSITION"]]
    assert np.allclose(pa["min"], pos.min(axis=0), atol=1e-3) and np.allclose(pa["max"], pos.max(axis=0), atol=1e-3)


CITYGML = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<core:CityModel xmlns:core="http://www.opengis.net/citygml/1.0" xmlns:bldg="http://www.opengis.net/citygml/building/1.0"
  xmlns:gml="http://www.opengis.net/gml">
 <gml:boundedBy><gml:Envelope srsName="urn:adv:crs:ETRS89_UTM32*DE_DHHN2016_NH"/></gml:boundedBy>
 <core:cityObjectMember><bldg:Building gml:id="B1"><gml:name>&xxe;</gml:name>
  <bldg:boundedBy><bldg:GroundSurface><bldg:lod2MultiSurface><gml:MultiSurface><gml:surfaceMember><gml:Polygon>
   <gml:exterior><gml:LinearRing><gml:posList srsDimension="3">{g}</gml:posList></gml:LinearRing></gml:exterior>
   <gml:interior><gml:LinearRing><gml:posList srsDimension="3">{h}</gml:posList></gml:LinearRing></gml:interior>
  </gml:Polygon></gml:surfaceMember></gml:MultiSurface></bldg:lod2MultiSurface></bldg:GroundSurface></bldg:boundedBy>
  <bldg:boundedBy><bldg:WallSurface><bldg:lod2MultiSurface><gml:MultiSurface><gml:surfaceMember><gml:Polygon>
   <gml:exterior><gml:LinearRing><gml:posList srsDimension="3">{w}</gml:posList></gml:LinearRing></gml:exterior>
  </gml:Polygon></gml:surfaceMember></gml:MultiSurface></bldg:lod2MultiSurface></bldg:WallSurface></bldg:boundedBy>
  <bldg:consistsOfBuildingPart><bldg:BuildingPart gml:id="B1p">
   <bldg:boundedBy><bldg:RoofSurface><bldg:lod2MultiSurface><gml:MultiSurface><gml:surfaceMember><gml:Polygon>
    <gml:exterior><gml:LinearRing><gml:pos>{r0}</gml:pos><gml:pos>{r1}</gml:pos><gml:pos>{r2}</gml:pos><gml:pos>{r0}</gml:pos></gml:LinearRing></gml:exterior>
   </gml:Polygon></gml:surfaceMember></gml:MultiSurface></bldg:lod2MultiSurface></bldg:RoofSurface></bldg:boundedBy>
  </bldg:BuildingPart></bldg:consistsOfBuildingPart>
 </bldg:Building></core:cityObjectMember>
 <core:cityObjectMember><bldg:Building gml:id="B2"><bldg:lod2Solid><gml:Solid><gml:exterior><gml:CompositeSurface>
  <gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>{g2}</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember>
 </gml:CompositeSurface></gml:exterior></gml:Solid></bldg:lod2Solid></bldg:Building></core:cityObjectMember>
</core:CityModel>
"""


def _pl(pts) -> str:
    return " ".join(f"{x} {y} {z}" for x, y, z in pts)


def test_parse_citygml(tmp_path):
    g = [(E0 + x, N0 + y, 300.0) for x, y in L_OUTER]
    h = [(E0 + x, N0 + y, 300.0) for x, y in HOLE[::-1]]
    w = [(E0, N0, 300), (E0 + 10, N0, 300), (E0 + 10, N0, 306), (E0, N0, 306), (E0, N0, 300)]
    r = [(E0, N0, 306), (E0 + 10, N0, 306), (E0, N0 + 10, 306)]
    g2 = [(E0 + 50 + x, N0 + y, 301.0) for x, y in [(0, 0), (5, 0), (5, 5), (0, 5), (0, 0)]]
    xml = CITYGML.format(g=_pl(g), h=_pl(h), w=_pl(w), r0="%s %s %s" % r[0], r1="%s %s %s" % r[1],
                         r2="%s %s %s" % r[2], g2=_pl(g2))
    p = tmp_path / "t.gml"
    p.write_text(xml)
    bs = list(iter_buildings(p, "sl"))
    assert [b.id for b in bs] == ["B1", "B2"]
    b1, b2 = bs
    assert len(b1.ground) == 1 and len(b1.ground[0]) == 2  # exterior + interior ring
    assert sorted(c for _, c in b1.surfaces) == [SURF_WALL, SURF_ROOF]  # BuildingPart roof included
    fp = footprint_of(b1)
    assert np.isclose(fp.area, 60.0)
    # B2 has no thematic surfaces → solid polygons are used as 'other' and as the footprint fallback
    assert [c for _, c in b2.surfaces] == [SURF_OTHER] and not b2.ground
    assert np.isclose(footprint_of(b2).area, 25.0)
    mb = MeshBuilder()
    assert mb.add_building(b1, E0, N0) == 2 + 1  # wall quad (2) + roof triangle (1); ground not meshed
    # the entity was not expanded (hardened parser) – nothing from /etc/passwd ends up anywhere
    assert "root:" not in json.dumps([b.id for b in bs])


def test_srs_and_rlp_tile_selection():
    assert srs_ok({"urn:adv:crs:ETRS89_UTM32*DE_DHHN2016_NH"}) and srs_ok({"EPSG:25832"})
    assert not srs_ok(set()) and not srs_ok({"EPSG:4326"})
    aoi = AOI("t", "t", 378000, 5460000, 384000, 5468000, 200, "SPK", 500)
    avail = {(376, 5460), (378, 5460), (382, 5466), (384, 5466), (382, 5468), (382, 5458)}
    assert rlp_tiles_for(aoi, avail) == [(378, 5460), (382, 5466)]


# --------------------------------------------------------------------------- generated data
from common import APP_DATA, WORK_DIR, load_aoi  # noqa: E402
import tomllib  # noqa: E402

_KNOWN = [k for k in tomllib.loads((Path(__file__).resolve().parents[1] / "aois.toml").read_text()) if k != "defaults"]
BUILT = [k for k in _KNOWN if (APP_DATA / k / "manifest.json").exists()
         and "buildings" in json.loads((APP_DATA / k / "manifest.json").read_text()).get("models", {})]


@pytest.mark.skipif(not BUILT, reason="no AOI with models.buildings")
@pytest.mark.parametrize("aoi", BUILT)
def test_generated_buildings(aoi):
    from PIL import Image
    a = load_aoi(aoi)
    m = json.loads((APP_DATA / aoi / "manifest.json").read_text())
    B = m["models"]["buildings"]
    assert B["frame"] == "local" and B["path"] == "models/buildings/{i}_{j}.glb" and B["featureCount"] > 0
    assert "(LoD2)" in m["attribution"] and B["label_de"] == "Gebäude (LoD2)"
    nx, ny = m["chunks"]["nx"], m["chunks"]["ny"]
    files = sorted((APP_DATA / aoi / "models" / "buildings").glob("*.glb"))
    assert {f.stem for f in files} == {f"{i}_{j}" for i, j in B["chunks"]}
    lo, hi = m["heightRange"]["min"] - 30, m["heightRange"]["max"] + 120
    for i, j in B["chunks"]:
        assert 0 <= i < nx and 0 <= j < ny
        gltf, arr = read_glb((APP_DATA / aoi / "models" / "buildings" / f"{i}_{j}.glb").read_bytes())
        P = arr["POSITION"]
        # whole buildings poke over the chunk edge (industrial halls ≈ 300 m, ALKIS walls 51009_1700 up to ≈ 490 m
        # long), so only check they stay within one chunk of their own
        M = 500
        assert (P[:, 0] > i * 500 - M).all() and (P[:, 0] < (i + 1) * 500 + M).all()
        assert (-P[:, 2] < a.height - j * 500 + M).all() and (-P[:, 2] > a.height - (j + 1) * 500 - M).all()
        assert (P[:, 1] > lo).all() and (P[:, 1] < hi).all()
        assert np.allclose(np.linalg.norm(arr["NORMAL"], axis=1), 1, atol=1e-4)
        assert set(np.unique(arr["_SURFACE"]).tolist()) <= {0, 1, 2}
        assert arr["indices"].max() < len(P)
    L = m["layers"]["bldg"]
    assert L == {**L, "path": "relief/bldg/{i}_{j}.png", "encoding": "u8", "min": 0, "max": 1}
    if "levels" in m:
        assert m["levels"][0]["layers"].get("bldg") == L
    import rasterio
    with rasterio.open(WORK_DIR / aoi / "bldg.tif") as ds:
        work = ds.read(1)
        assert ds.transform.c == a.e0 and ds.transform.f == a.n1
    for j in range(ny):
        for i in range(nx):
            with Image.open(APP_DATA / aoi / "relief" / "bldg" / f"{i}_{j}.png") as im:
                v = np.asarray(im)
            assert im.size == (500, 500) and im.mode == "L"
            assert np.array_equal(v, work[j * 500:(j + 1) * 500, i * 500:(i + 1) * 500] * 255)


def _wall(e0, e1, n, z0, z1):
    return np.array([[e0, n, z0], [e1, n, z0], [e1, n, z1], [e0, n, z1]], np.float64)


def test_densify_path_closed_ring_max_step():
    ring = np.array([[0, 0], [10, 0], [10, 3]], np.float64)
    d = densify_path(ring, 1.0)
    seg = np.linalg.norm(np.diff(np.vstack([d, d[:1]]), axis=0), axis=1)
    assert seg.max() <= 1.0 + 1e-9 and len(d) == 10 + 3 + 11
    assert all(any(np.allclose(p, q) for q in d) for p in ring)


def test_skirt_lowers_floating_wall_bottom_only():
    """Terrain falls from 300 m to 298 m along the wall; floor at 300 → bottom goes to 298 − margin, top stays."""
    w = _wall(0, 10, 0, 300.0, 306.0)
    z_at = lambda E, N: 300.0 - 0.2 * np.asarray(E)  # noqa: E731
    out, gap = skirt_walls(w, np.array([300.0]), z_at)
    assert gap == 0.0
    np.testing.assert_allclose(out[:2, 2], 298.0 - WALL_SKIRT_MARGIN)
    np.testing.assert_allclose(out[2:], w[2:])          # top edge (roof line) unchanged
    np.testing.assert_allclose(out[:, :2], w[:, :2])    # plane kept: x/y untouched
    assert (w[:, 2] == [300, 300, 306, 306]).all()      # input not mutated


def test_skirt_ignores_dormers_buried_walls_and_caps_outliers():
    z_flat = lambda E, N: np.full_like(np.asarray(E, np.float64), 300.0)  # noqa: E731
    dormer = _wall(0, 2, 0, 308.0, 309.5)  # stands on the roof, not on a GroundSurface
    assert skirt_walls(dormer, np.array([300.0]), lambda E, N: z_flat(E, N) - 20)[0] is dormer
    buried = _wall(0, 10, 0, 299.5, 306.0)  # floor already below the DTM (upslope side) → nothing to do
    assert skirt_walls(buried, np.array([299.5]), z_flat)[0] is buried
    assert skirt_walls(buried, np.array([]), lambda E, N: z_flat(E, N) - 3)[0] is buried  # no ground info
    cliff = _wall(0, 10, 0, 300.0, 306.0)
    out, gap = skirt_walls(cliff, np.array([300.0]), lambda E, N: z_flat(E, N) - 20)
    np.testing.assert_allclose(out[:2, 2], 300.0 - WALL_SKIRT_MAX)
    assert gap == pytest.approx(20 - WALL_SKIRT_MAX)


def test_mesh_builder_skirts_walls_not_roofs():
    b = Building("b1", "sl")
    b.ground = [[np.array([[0, 0, 300], [10, 0, 300], [10, 0.01, 300], [0, 0.01, 300]], np.float64)]]
    b.surfaces = [([_wall(0, 10, 0, 300.0, 306.0)], SURF_WALL),
                  ([np.array([[0, 0, 306], [10, 0, 306], [10, 5, 308], [0, 5, 308]], np.float64)], SURF_ROOF)]
    mb = MeshBuilder()
    assert mb.add_building(b, 0, 0, z_at=lambda E, N: np.full(np.shape(E), 299.0)) == 4
    ys = np.concatenate([p[:, 1] for p in mb.positions])
    assert ys.min() == pytest.approx(299.0 - WALL_SKIRT_MARGIN) and mb.skirted_walls == 1
    np.testing.assert_allclose(mb.positions[1][:, 1], [306, 306, 308, 308])
