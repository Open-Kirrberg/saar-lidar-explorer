"""F21 3D-Druck (print3d.py): grid, sampling, z formula, seamless edges, watertight mesh, bowtie keys, files,
index schema — synthetic data only (no network). Generated print data is checked when present."""
from __future__ import annotations

import json
import sys
import zipfile
from dataclasses import replace
from pathlib import Path
from xml.etree import ElementTree as ET

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from print3d import (  # noqa: E402
    BAMBU_PROFILES, FRONT_EXCLUDE_MM, PLACEMENT_MM, PLATE_MM, PRESET_FILE, PRINT_DIR, STOCK_EXCLUDE_MM,
    STOCK_LOAD_LINE_GCODE_MAX_Y, STOCK_PRINTER, Connectors, Series, axis_weights, bowtie_key, build_tile_mesh,
    check_series, check_text_clearance, filament_g, keys_needed, key_mesh, label_lines, layout_blocks,
    list_series, load_line_extent, load_line_plate_max_y, load_series, merge_index, mesh_check, mesh_stats,
    parse_tile_id, patch_start_gcode, plate_placement, printer_meta, printer_preset, read_stl, recess_polygons,
    resample, resolve_datums, set_datum, source_box, stock_profile_problems, stock_window, text_geometry, tile_id,
    tiles_in_bbox, validate_index, vertex_coords, write_3mf, write_catalog, write_stl, z_from_h,
)

S8 = load_series("saarpfalz-8500")      # main series (name kept short: "the 2 km series")
S2 = load_series("detail-2125")
# the optional 250 mm series (commented out in print3d.toml) — same maths, user printer preset
SC = replace(S8, key="saarpfalz-8000-custom-preset", scale=8000, tile_mm=250.0, printer="sle-250", sets={})


def small_series(tile_m=20, vertices=11, **kw) -> Series:
    """Same maths as a real series, tiny grid (cell = tile_m / (vertices − 1))."""
    return replace(S8, key="test", scale=tile_m * 4, tile_m=tile_m, tile_mm=250.0, vertices=vertices, **kw)


def sample(dem, dem_e0, dem_n1, s: Series, e0, n0):
    """Resample a tile from a synthetic DGM given by its west edge and north edge (row 0 = north)."""
    cx, wx = axis_weights(vertex_coords(e0, s.tile_m, s.vertices), s.cell_m)
    cy, wy = axis_weights(vertex_coords(n0, s.tile_m, s.vertices), s.cell_m)
    box = source_box(cx, wx, cy, wy)
    r0, c0 = dem_n1 - box[3], box[0] - dem_e0
    sub = dem[r0:r0 + box[3] - box[1], c0:c0 + box[2] - box[0]]
    assert sub.shape == (box[3] - box[1], box[2] - box[0])
    return resample(sub, box, cx, wx, cy, wy)


# ------------------------------------------------------------------------------------- config / ids
def test_series_config():
    assert (S8.scale, S8.tile_m, S8.vertices, S8.cell_m, S8.exag, S8.datum_m, S8.base_mm, S8.printer) == \
        (8500, 2000, 1001, 2.0, 2.0, 180.0, 4.0, "stock")
    assert S8.tile_mm == pytest.approx(2000 / 8500 * 1000) and S8.datum_mode == "series" and S8.role == "main"
    assert (S2.scale, S2.tile_m, S2.cell_m, S2.datum_m, S2.exag, S2.datum_mode, S2.datum_margin_m, S2.role) == \
        (2125, 500, 0.5, None, 1.5, "set", 5.0, "detail")
    assert S2.tile_mm == pytest.approx(S8.tile_mm) and S2.placement_mm == S8.placement_mm   # 4 × the main scale
    assert set(list_series()) == {"saarpfalz-8500", "detail-2125"}     # 8000 custom preset only commented out
    check_series(SC)
    with pytest.raises(ValueError):
        check_series(replace(S8, tile_m=2100))                      # 247.06 mm ≠ tile_mm
    with pytest.raises(ValueError):
        check_series(replace(S8, base_mm=3.5))                      # < 2 mm above a 2 mm recess
    check_series(replace(S8, base_mm=3.5, connectors=Connectors(enabled=False)))
    with pytest.raises(ValueError):
        check_series(replace(S8, datum_m=None))                     # "series" datum needs datum_m
    with pytest.raises(ValueError):
        check_series(replace(S2, datum_m=200.0))                    # "set" datum must not have one
    with pytest.raises(ValueError):
        check_series(replace(S8, printer="x1c"))


def test_stock_p1s_placement():
    """Stock P1S: the tile must sit right of the 18 × 28 mm front-left exclusion area and behind the load line."""
    x0, x1, y0, y1 = stock_window(S8.tile_mm)
    assert (x0, y0) == (18.0, 13.5) and x1 == pytest.approx(256 - 235.2941, abs=1e-4)
    x, y = S8.placement_mm
    assert (x, y) == (19.4, 17.1)
    assert STOCK_EXCLUDE_MM[0] <= x and x + S8.tile_mm <= PLATE_MM[0]
    assert y >= load_line_plate_max_y(STOCK_LOAD_LINE_GCODE_MAX_Y) and y + S8.tile_mm <= PLATE_MM[1]
    assert plate_placement(238.0)[0] == 18.0                        # widest square: exactly X 18–256
    for mm in (2000 / 8400 * 1000, 500 / 2100 * 1000, 250.0):      # 238.095 mm: refused by the slicer everywhere
        with pytest.raises(ValueError, match="stock P1S"):
            plate_placement(mm, "stock")
    with pytest.raises(ValueError):
        check_series(replace(S8, scale=8400, tile_mm=2000 / 8400 * 1000))
    assert plate_placement(250.0, "sle-250") == PLACEMENT_MM
    pm = printer_meta(False, "", "stock", S8.placement_mm, S8.tile_mm)
    assert pm["mode"] == "stock" and pm["file"] is None and pm["bedExcludeArea"] == ["0x0", "18x0", "18x28", "0x28"]
    assert printer_meta(True, "v", "sle-250")["file"] == PRESET_FILE


def test_tile_ids():
    assert parse_tile_id("E380_N5460", S8) == (380000, 5460000)
    assert parse_tile_id("E382.5_N5465.5", S2) == (382500, 5465500)
    assert tile_id(382500, 5465500) == "E382.5_N5465.5" and tile_id(380000, 5460000) == "E380_N5460"
    for e, n in [(376000, 5462000), (381500, 5463000), (0, 0)]:
        assert parse_tile_id(tile_id(e, n)) == (e, n)
    with pytest.raises(ValueError, match="E380_N5460"):
        parse_tile_id("E381_N5461", S8)                             # off the 2 km grid → names the right tile
    with pytest.raises(ValueError):
        parse_tile_id("E382.5_N5466", S8)
    for bad in ["380_5460", "E380N5460", "E380_N5460.0001", "e380_n5460", "E380_N5460 x"]:
        with pytest.raises(ValueError):
            parse_tile_id(bad)


def test_tiles_in_bbox_overall_is_3x4():
    t = tiles_in_bbox(S8, 378000, 5460000, 384000, 5468000)
    assert len(t) == 12 and t[0] == (378000, 5460000) and t[-1] == (382000, 5466000)
    assert tiles_in_bbox(S2, 382195, 5466095, 382196, 5466096) == [(382000, 5466000)]
    assert tiles_in_bbox(S8, 377999, 5462000, 378001, 5462001) == [(376000, 5462000), (378000, 5462000)]


# ------------------------------------------------------------------------------------- sampling
def test_vertex_positions_on_tile_edges():
    x = vertex_coords(380000, 2000, 1001)
    assert x[0] == 380000 and x[-1] == 382000 and len(x) == 1001
    assert np.all(np.diff(x) == 2.0)
    y = vertex_coords(5465500, 500, 1001)
    assert y[-1] == 5466000 and np.all(np.diff(y) == 0.5)


def test_axis_weights_pixel_is_area():
    # 2 m: vertex on integer E → the two cells [E−1, E) and [E, E+1), half each
    cells, w = axis_weights(np.array([380000.0, 380002.0]), 2.0)
    assert cells[0].tolist() == [379999, 380000, 380001] and w[0].tolist() == [0.5, 0.5, 0.0]
    # 0.5 m: vertex on a cell centre → that cell only; vertex on a cell edge → both neighbours
    cells, w = axis_weights(np.array([100.5, 101.0]), 0.5)
    assert cells[0, 0] == 100 and w[0].tolist() == [1.0, 0.0]
    assert cells[1].tolist() == [100, 101] and w[1].tolist() == [0.5, 0.5]
    # odd width 3 m → fractional overlaps
    _, w = axis_weights(np.array([10.0]), 3.0)
    assert np.allclose(w[0], [0.5 / 3, 1 / 3, 1 / 3, 0.5 / 3])


def test_resample_is_mean_of_surrounding_cells():
    rng = np.random.default_rng(0)
    s = small_series()                                 # cell 2 m
    dem = (300 + rng.random((40, 40)) * 50).astype(np.float32)   # cells E 0…39, N 0…39 (row 0 = N 39)
    h, miss = sample(dem, 0, 40, s, 10, 10)
    assert not miss.any() and h.shape == (11, 11)
    # vertex (i=2, j=3) at E 14, N 16 → cells E 13, 14 × N 15, 16 → rows 40−1−16 = 23 and 24
    want = dem[23:25, 13:15].astype(np.float64).mean()
    assert h[3, 2] == pytest.approx(want, abs=1e-9)
    # 0.5 m detail: vertex at a cell centre = the cell value, at a corner = mean of 4 (bilinear)
    s2 = small_series(tile_m=5, vertices=11)
    h2, _ = sample(dem, 0, 40, s2, 10, 10)            # vertex (1, 1) at 10.5/10.5 = centre of cell (10, 10)
    assert h2[1, 1] == pytest.approx(float(dem[29, 10]), abs=1e-9)
    assert h2[0, 0] == pytest.approx(dem[29:31, 9:11].astype(np.float64).mean(), abs=1e-9)


def test_missing_data_is_reported():
    s = small_series()
    dem = np.full((40, 40), 300.0)
    dem[25, 14] = np.nan
    _, miss = sample(dem, 0, 40, s, 10, 10)
    # cell [14, 15) × [14, 15) lies only in the 2 × 2 m window of the vertex at E 14, N 14 (i = j = 2)
    assert miss.sum() == 1 and miss[2, 2]
    dem[25, 15] = np.nan                                # cell E 15 is in the windows of E 14 and E 16
    _, miss = sample(dem, 0, 40, s, 10, 10)
    assert miss.sum() == 2 and miss[2, 2:4].all()


@pytest.mark.parametrize("tile_m,vertices", [(20, 11), (5, 11), (14, 8), (2000, 1001)])
def test_shared_edges_are_bit_identical(tile_m, vertices):
    """Neighbours computed from differently cropped source windows give identical edge rows (E and N)."""
    rng = np.random.default_rng(1)
    s = small_series(tile_m=tile_m, vertices=vertices)
    n = 3 * tile_m + 8
    dem = (250 + rng.random((n, n)) * 150).astype(np.float32)   # E −4 … , N top = n − 4
    e0 = n0 = 0
    A, _ = sample(dem, -4, n - 4, s, e0, n0)
    B, _ = sample(dem, -4, n - 4, s, e0 + tile_m, n0)            # east neighbour
    C, _ = sample(dem, -4, n - 4, s, e0, n0 + tile_m)            # north neighbour
    assert np.array_equal(A[:, -1], B[:, 0])
    assert np.array_equal(A[-1, :], C[0, :])
    za, _ = z_from_h(A, s)
    zb, _ = z_from_h(B, s)
    assert np.array_equal(za[:, -1], zb[:, 0])


def test_z_formula_and_datum_clamp():
    h = np.array([180.0, 188.5, 300.0, 170.0])
    z, clamped = z_from_h(h, S8)
    assert z.tolist() == pytest.approx([4.0, 6.0, 4.0 + 120 / 8500 * 1000 * 2, 4.0])   # 1:8500 × 2 → 0.235 mm/m
    assert clamped == 1
    z2, c2 = z_from_h(np.array([380.0, 270.0]), S2, 274.0)
    assert z2[0] == pytest.approx(4.0 + 106 * 1000 / 2125 * 1.5) and z2[1] == 4.0 and c2 == 1
    with pytest.raises(ValueError):
        z_from_h(h, S2)                                         # per-set series: the tile datum is required
    assert set_datum(279.99, 5.0) == 274.0 and set_datum(280.0, 5.0) == 275.0 and set_datum(-0.5, 0) == -1.0


def _datum_series(**sets):
    return replace(S2, sets=sets)


def test_resolve_datums_per_set():
    s = _datum_series(a=["E382_N5465.5", "E382_N5466"], b=["E381.5_N5463", "E382_N5463"],
                      big=["E382_N5465.5", "E382_N5466", "E382.5_N5466"])
    hmin = {(382000, 5465500): 281.7, (382000, 5466000): 300.0, (381500, 5463000): 250.2,
            (382000, 5463000): 262.0, (382500, 5466000): 270.4}
    calls = []

    def h_min(e, n):
        calls.append((e, n))
        return hmin[(e, n)]
    # fresh: each set gets floor(min over ALL its tiles) − 5, also when only one tile is requested; a tile that is
    # in two sets (a ⊂ big) must not get two datums
    d, sd = resolve_datums(s, [(381500, 5463000)], None, h_min)
    assert d == {(381500, 5463000): 245.0} and sd == {"b": 245.0} and set(calls) == {(381500, 5463000), (382000, 5463000)}
    with pytest.raises(ValueError, match="conflicting"):
        resolve_datums(s, [(382000, 5465500)], None, h_min)           # a: 276, big: 265
    # recorded set datums are frozen; generated tiles of a set are adopted by an overlapping / nested set
    old = {"series": {"datum_m": None}, "setDatum_m": {"a": 276.0},
           "tiles": [{"bboxUTM": [382000, 5465500, 382500, 5466000], "datum_m": 276.0}]}
    calls.clear()
    d, sd = resolve_datums(s, [(382000, 5466000), (382500, 5466000)], old, h_min)
    assert d == {(382000, 5466000): 276.0, (382500, 5466000): 276.0} and sd == {"a": 276.0, "big": 276.0}
    assert calls == []                                               # nothing sampled for the datum
    d, sd = resolve_datums(s, [], old, h_min, requested_sets=["b"])
    assert d == {} and sd == {"b": 245.0}
    # a tile in no set needs --datum (or an existing entry); --datum must agree with sets
    with pytest.raises(ValueError, match="--datum"):
        resolve_datums(s, [(390000, 5400000)], None, h_min)
    assert resolve_datums(s, [(390000, 5400000)], None, h_min, explicit=300.0)[0] == {(390000, 5400000): 300.0}
    with pytest.raises(ValueError, match="conflicting"):
        resolve_datums(s, [(382000, 5466000)], old, h_min, explicit=280.0)
    # fixed-datum series: the series datum, --datum rejected unless equal
    assert resolve_datums(S8, [(380000, 5460000)], None, h_min) == ({(380000, 5460000): 180.0}, {})
    with pytest.raises(ValueError):
        resolve_datums(S8, [(380000, 5460000)], None, h_min, explicit=200.0)


# ------------------------------------------------------------------------------------- mesh
def heightfield_volume(z, W):
    """Volume under the triangulated top surface (same diagonal as the mesh)."""
    n = z.shape[0]
    a = (W / (n - 1)) ** 2 / 2
    t1 = z[:-1, :-1] + z[:-1, 1:] + z[1:, 1:]
    t2 = z[:-1, :-1] + z[1:, 1:] + z[1:, :-1]
    return float(a * (t1.sum() + t2.sum()) / 3)


@pytest.mark.parametrize("conn,with_text", [(True, True), (True, False), (False, True), (False, False)])
def test_tile_mesh_watertight_and_volume(conn, with_text):
    rng = np.random.default_rng(2)
    n, W = 31, 250.0
    z = 4 + rng.random((n, n)) * 40
    z[5:9, 5:9] = 4.0                                              # flat (clamped) patch → collinear wall points
    z[0, :] = 4.0
    c = S8.connectors if conn else Connectors(enabled=False)
    text = text_geometry(label_lines(S8, "E380_N5460"), W) if with_text else None
    check_text_clearance(text, W, c)
    V, F = build_tile_mesh(z, W, c, text, 0.6)
    chk = mesh_check(F)
    assert chk["watertight"], chk
    vol, area = mesh_stats(V, F)
    want = heightfield_volume(z, W)
    if conn:
        trap = c.length_mm * (c.waist_mm + c.end_mm) / 2
        want -= 4 * len(c.positions) * trap * c.depth_mm
    if with_text:
        want -= text.area * 0.6
    assert vol == pytest.approx(want, rel=1e-9)
    assert V[:, :2].min() == 0 and V[:, :2].max() == W and V[:, 2].min() == 0
    assert np.isclose(V[:, 2].max(), z.max())
    # top grid untouched: first n² vertices are the grid with the heights given
    assert np.array_equal(V[: n * n, 2], z.ravel())


def test_text_is_mirrored_and_inside():
    t = text_geometry([("E", 10.0)], 250.0, mirror=True)
    u = text_geometry([("E", 10.0)], 250.0, mirror=False)
    # 'E' has its spine on the left; mirrored, the spine is on the right (reads correctly from below)
    assert t.centroid.x > 125 > u.centroid.x
    assert t.centroid.y == pytest.approx(u.centroid.y)
    check_text_clearance(text_geometry(label_lines(S2, "E382.5_N5465.5", 276.0), S2.tile_mm), S2.tile_mm,
                         S2.connectors)
    assert label_lines(S2, "E382_N5466", 276.0)[-1][0] == "BASIS 276 M = 4 MM"
    with pytest.raises(TypeError):
        label_lines(S2, "E382_N5466")                              # per-set datum series: datum required


def test_bowtie_recess_and_key_clearance():
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    c = S8.connectors
    W = 250.0
    rec = recess_polygons(W, c)
    assert [len(side) for side in rec] == [2, 2, 2, 2]
    # tile A at x 0…W and its east neighbour B at x W…2W: east recess of A + west recess of B form the bowtie
    east = Polygon(rec[1][0])
    west_b = [Polygon([(x + W, y) for x, y in r]) for r in rec[3]]
    west = next(p for p in west_b if abs(p.centroid.y - east.centroid.y) < 1e-9)
    pocket = unary_union([east, west])
    key = bowtie_key(c)
    cx, cy = W, east.centroid.y
    from shapely.affinity import translate
    k = translate(key, cx, cy - key.centroid.y)
    assert pocket.contains(k.buffer(c.clearance_mm - 1e-6, join_style="mitre"))
    assert k.exterior.distance(pocket.exterior) == pytest.approx(c.clearance_mm, abs=1e-6)
    # dovetail: wider inside than at the joint → the key locks the tiles together
    assert east.bounds[3] - east.bounds[1] == pytest.approx(c.end_mm)
    V, F = key_mesh(c)
    assert mesh_check(F)["watertight"] and mesh_stats(V, F)[0] > 0
    assert V[:, 2].max() == pytest.approx(c.depth_mm - c.clearance_mm)   # flush below the tile bottom
    assert S8.base_mm - c.depth_mm >= c.min_base_mm


@pytest.mark.parametrize("positions", [(0.25, 0.75), (0.3, 0.8), (0.5,), (0.2, 0.45, 0.7)])
def test_recesses_face_each_other_for_any_positions(positions):
    """Positions count from the global W (S/N sides) or S (W/E sides) corner, so neighbours always match."""
    c = replace(S8.connectors, positions=positions)
    check_series(replace(S8, connectors=c))
    W = 250.0
    S, E, N, Wst = recess_polygons(W, c)

    def centres(side, axis):
        return sorted(round(sum(p[axis] for p in r) / 4, 9) for r in side)
    want = sorted(round(f * W, 9) for f in positions)
    assert centres(S, 0) == centres(N, 0) == want          # tile below's N side meets this tile's S side
    assert centres(E, 1) == centres(Wst, 1) == want        # east neighbour's W side meets this tile's E side
    for side, axis in ((S, 0), (E, 1), (N, 0), (Wst, 1)):  # order of increasing u along the CCW walk
        u = [sum(p[axis] for p in r) / 4 for r in side]
        assert u == (sorted(u) if side in (S, E) else sorted(u, reverse=True))
    V, F = build_tile_mesh(np.full((11, 11), 9.0), W, c, None)
    assert mesh_check(F)["watertight"]


def test_connector_positions_checked():
    with pytest.raises(ValueError):
        check_series(replace(S8, connectors=replace(S8.connectors, positions=(0.05, 0.5))))   # corner clash
    with pytest.raises(ValueError):
        check_series(replace(S8, connectors=replace(S8.connectors, positions=(0.5, 0.52))))   # overlapping


def test_keys_needed():
    tiles = [{"bboxUTM": [e, n, e + 2000, n + 2000]} for e, n in tiles_in_bbox(S8, 378000, 5460000, 384000, 5468000)]
    # 3 × 4 grid: 2·4 vertical + 3·3 horizontal shared edges = 17, × 2 keys
    assert keys_needed(S8, tiles) == 34


def test_filament_estimate():
    solid, typical = filament_g(1_000_000.0, 100_000.0, S8)        # 1 l, 10 dm²
    assert solid == pytest.approx(1240.0)
    shell = 100_000.0 * 1.2
    assert typical == pytest.approx((shell + 0.15 * (1_000_000 - shell)) * 1.24e-3)


# ------------------------------------------------------------------------------------- files / index
def test_stl_and_3mf_roundtrip(tmp_path):
    rng = np.random.default_rng(3)
    z = 5 + rng.random((9, 9)) * 10
    V, F = build_tile_mesh(z, 250.0, S8.connectors, None)
    write_stl(tmp_path / "t.stl", V, F, "t")
    tri = read_stl(tmp_path / "t.stl")
    assert tri.shape == (len(F), 3, 3) and np.allclose(tri, V[F], atol=1e-4)
    assert not (tmp_path / "t.stl").read_bytes().startswith(b"solid")
    write_3mf(tmp_path / "t.3mf", V, F, "E380_N5460", {"Title": "t & <x>"})
    with zipfile.ZipFile(tmp_path / "t.3mf") as zf:
        assert {"[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"} <= set(zf.namelist())
        root = ET.fromstring(zf.read("3D/3dmodel.model"))
    ns = {"m": "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"}
    assert root.get("unit") == "millimeter"
    verts = root.findall(".//m:vertex", ns)
    tris = root.findall(".//m:triangle", ns)
    assert len(verts) == len(V) and len(tris) == len(F)
    assert int(tris[-1].get("v3")) == F[-1, 2]
    assert root.find(".//m:build/m:item", ns).get("objectid") == "1"
    for place in (PLACEMENT_MM, S8.placement_mm):
        write_3mf(tmp_path / "p.3mf", V, F, "E380_N5460", {}, place_mm=place)
        with zipfile.ZipFile(tmp_path / "p.3mf") as zf:
            item = ET.fromstring(zf.read("3D/3dmodel.model")).find(".//m:build/m:item", ns)
        t = [float(v) for v in item.get("transform").split()]
        assert t[9:] == [pytest.approx(place[0]), pytest.approx(place[1]), 0.0]
    assert all(PLACEMENT_MM[k] + 250.0 <= PLATE_MM[k] for k in (0, 1)) and PLACEMENT_MM[1] > FRONT_EXCLUDE_MM


# stock P1S load line excerpt (Bambu Studio 02.08, "Bambu Lab P1S 0.4 nozzle template machine_start_gcode")
STOCK_LOAD = """;===== nozzle load line ===============================
M975 S1
G90
M83
T1000
G1 X18.0 Y1.0 Z0.8 F18000;Move to start position
M109 S{nozzle_temperature_initial_layer[initial_extruder]}
G1 Z0.2
G0 E2 F300
G0 X240 E15 F{outer_wall_volumetric_speed/(0.3*0.5)     * 60}
G0 Y11 E0.700 F{outer_wall_volumetric_speed/(0.3*0.5)/ 4 * 60}
G0 X239.5
G0 E0.2
G0 Y1.5 E0.700
G0 X18 E15 F{outer_wall_volumetric_speed/(0.3*0.5)     * 60}
M400
"""


def test_printer_preset_load_line_clear_of_tile():
    ext = load_line_extent(STOCK_LOAD)
    assert ext == (18.0, 1.0, 240.0, 11.0) and load_line_plate_max_y(ext[3]) > PLACEMENT_MM[1]   # stock: hits tile
    g = patch_start_gcode("G28\n" + STOCK_LOAD + "M106 S0\n")
    x0, y0, x1, y1 = load_line_extent(g)
    assert (x0, y0, x1, y1) == (18.0, 1.0, 240.0, 1.5)
    assert load_line_plate_max_y(y1) <= FRONT_EXCLUDE_MM < PLACEMENT_MM[1]       # inside the strip, tile behind it
    assert g.startswith("G28\n") and g.endswith("M106 S0\n") and "Y11" not in g
    with pytest.raises(ValueError):
        patch_start_gcode(g)                                                   # already patched / template changed
    d = printer_preset(STOCK_LOAD, "02.08.00.05")
    assert d["inherits"] == STOCK_PRINTER and d["from"] == "User"
    assert d["bed_exclude_area"] == ["0x0", "256x0", "256x5", "0x5"]             # full-width front strip only


STOCK_TPL = BAMBU_PROFILES / "machine" / f"{STOCK_PRINTER} template machine_start_gcode.json"


@pytest.mark.skipif(not STOCK_TPL.exists(), reason="Bambu Studio not installed")
def test_printer_preset_from_installed_bambu_studio():
    g = json.loads(STOCK_TPL.read_text())["machine_start_gcode"]
    g = g if isinstance(g, str) else g[0]
    assert load_line_extent(g)[3] > PLACEMENT_MM[1]
    assert load_line_plate_max_y(load_line_extent(g)[3]) > PLACEMENT_MM[1]
    assert load_line_plate_max_y(load_line_extent(patch_start_gcode(g))[3]) <= FRONT_EXCLUDE_MM
    stock = json.loads((BAMBU_PROFILES / "machine" / f"{STOCK_PRINTER}.json").read_text())
    assert stock["extruder_offset"] == ["0x2"]                                    # plate Y = G-code Y + 2
    # the stock placement relies on exactly this exclusion corner and load line
    assert stock_profile_problems() == []
    assert load_line_extent(g)[3] == STOCK_LOAD_LINE_GCODE_MAX_Y


def test_layout_blocks():
    tiles = [fake_entry(t, S2) for t in ("E382_N5465.5", "E382_N5466", "E381.5_N5463", "E382_N5463",
                                          "E381.5_N5463.5", "E382_N5463.5")]
    blocks = layout_blocks(tiles, S2.tile_m, {"karlsberg": ["E382_N5465.5", "E382_N5466"],
                                              "merburg": ["E381.5_N5463", "E382_N5463"], "other": ["E390_N5400"]})
    assert [(b["nx"], b["ny"], len(b["tiles"])) for b in blocks] == [(2, 2, 4), (1, 2, 2)]   # no empty rows
    assert [b["sets"] for b in blocks] == [["merburg"], ["karlsberg"]]
    one = layout_blocks([fake_entry(t) for t in ("E376_N5462", "E378_N5462", "E380_N5466")], S8.tile_m)
    assert [(b["e0"], b["nx"], b["ny"]) for b in one] == [(376000, 2, 1), (380000, 1, 1)]
    # per-set datums: adjacent tiles with different datums are separate pieces (no keys between them)
    two = [fake_entry("E382_N5465.5", S2) | {"datum_m": 276.0}, fake_entry("E382_N5466", S2) | {"datum_m": 276.0},
           fake_entry("E382.5_N5466", S2) | {"datum_m": 290.0}]
    assert [(len(b["tiles"]), b["datum_m"]) for b in layout_blocks(two, S2.tile_m)] == [(2, 276.0), (1, 290.0)]
    assert keys_needed(S2, two) == 2


def test_entries_without_datum_use_series_datum():
    # merge_index keeps older entries (no `datum_m`, written before 2026-11-02) next to new ones with datum_m
    assert S8.datum_m == 180.0
    old = {k: v for k, v in fake_entry("E376_N5462").items() if k != "datum_m"}
    new = fake_entry("E378_N5462") | {"datum_m": 180.0}
    assert keys_needed(S8, [old, new]) == len(S8.connectors.positions)
    blocks = layout_blocks([old, new], S8.tile_m, series_datum=S8.datum_m)
    assert [(len(b["tiles"]), b["datum_m"]) for b in blocks] == [(2, 180.0)]
    # a genuinely different datum still splits
    assert len(layout_blocks([old, fake_entry("E378_N5462") | {"datum_m": 200.0}], S8.tile_m, series_datum=180.0)) == 2


def fake_entry(tid: str, s: Series = S8) -> dict:
    e0, n0 = parse_tile_id(tid, s)
    return {"id": tid, "grid": {"col": e0 // s.tile_m, "row": n0 // s.tile_m},
            "bboxUTM": [e0, n0, e0 + s.tile_m, n0 + s.tile_m], "wgs84": [7, 49, 7.1, 49.1],
            "wgs84Corners": [[7, 49]] * 4, "files": {"3mf": f"{tid}.3mf", "stl": f"{tid}.stl", "png": f"{tid}.png"},
            "z_mm": {"min": 4.0, "max": 30.0, "mean": 12.0}, "h_m": {"min": 230, "max": 380, "mean": 300},
            "clampedVertices": 0, "volume_cm3": 1.0, "surface_cm2": 1.0, "filament_g": {"solid": 1, "typical": 1},
            "triangles": 1, "vertices": 1, "watertight": True, "sources": {}, "created": "2026-11-01T00:00:00Z"}


def test_index_schema_and_merge():
    doc = merge_index(None, S8, [fake_entry("E380_N5460"), fake_entry("E382_N5460")], ["a"])
    assert validate_index(doc) == []
    assert doc["keysNeeded"] == 2 and doc["series"]["connectors"]["key"] == "keys/bowtie_key.stl"
    assert doc["sets"]["explorer"][0] == "E378_N5460" and len(doc["sets"]["explorer"]) == 12
    doc2 = merge_index(doc, S8, [fake_entry("E380_N5460") | {"volume_cm3": 2.0}, fake_entry("E376_N5462")], ["b"])
    assert [t["id"] for t in doc2["tiles"]] == ["E376_N5462", "E380_N5460", "E382_N5460"]   # N desc, E asc
    assert next(t for t in doc2["tiles"] if t["id"] == "E380_N5460")["volume_cm3"] == 2.0
    assert doc2["attribution"] == "a; b"
    bad = json.loads(json.dumps(doc2))
    bad["tiles"][0]["bboxUTM"][0] += 1
    del bad["tiles"][1]["files"]
    assert len(validate_index(bad)) == 2
    assert doc["printerProfile"]["mode"] == "stock" and doc["series"]["placement_mm"] == [19.4, 17.1]
    assert "setDatum_m" not in doc


def test_index_set_datums():
    e1 = fake_entry("E382_N5465.5", S2) | {"datum_m": 276.0}
    doc = merge_index(None, S2, [e1], ["a"], set_datums={"karlsberg": 276.0})
    assert validate_index(doc) == [] and doc["series"]["datum_m"] is None and doc["series"]["datumMode"] == "set"
    assert doc["setDatum_m"] == {"karlsberg": 276.0} and doc["sets"]["karlsberg"] == ["E382_N5465.5", "E382_N5466"]
    doc2 = merge_index(doc, S2, [fake_entry("E381.5_N5463", S2) | {"datum_m": 245.0}], [], set_datums={"merburg": 245.0})
    assert doc2["setDatum_m"] == {"karlsberg": 276.0, "merburg": 245.0}           # earlier sets kept (frozen)
    no = json.loads(json.dumps(doc2))
    del no["tiles"][0]["datum_m"]
    assert any("datum_m" in e for e in validate_index(no))


def test_series_catalog(tmp_path):
    for s, tiles in ((S8, [fake_entry("E380_N5460")]), (S2, [fake_entry("E382_N5466", S2) | {"datum_m": 276.0}])):
        (tmp_path / s.key).mkdir()
        (tmp_path / s.key / "index.json").write_text(json.dumps(merge_index(None, s, tiles, ["a"])))
    (tmp_path / "junk").mkdir()
    (tmp_path / "junk" / "index.json").write_text("{")
    cat = write_catalog(tmp_path)
    assert json.loads((tmp_path / "series.json").read_text()) == cat
    assert [(e["key"], e["role"], e["index"], e["tiles"], e["configured"]) for e in cat["series"]] == [
        ("saarpfalz-8500", "main", "saarpfalz-8500/index.json", 1, True),
        ("detail-2125", "detail", "detail-2125/index.json", 1, True)]
    assert cat["series"][1]["datum_m"] is None and cat["series"][1]["datumMode"] == "set"


# ------------------------------------------------------------------------------------- generated data
def generated():
    return sorted(PRINT_DIR.glob("*/index.json")) if PRINT_DIR.exists() else []


@pytest.mark.skipif(not generated(), reason="no print tiles generated (run print3d.py)")
@pytest.mark.parametrize("idx", generated(), ids=lambda p: p.parent.name)
def test_generated_print_index(idx):
    doc = json.loads(idx.read_text())
    assert validate_index(doc) == []
    if doc["series"]["key"] not in list_series():
        pytest.skip(f"{idx.parent.name}: series no longer configured in print3d.toml (obsolete output)")
    s = load_series(doc["series"]["key"])
    assert doc["series"]["tile_m"] == s.tile_m and doc["series"]["datum_m"] == s.datum_m
    assert doc["series"]["scale"] == s.scale and doc["series"]["tile_mm"] == pytest.approx(s.tile_mm)
    for name, d in doc.get("setDatum_m", {}).items():
        for t in doc["tiles"]:
            if t["id"] in doc["sets"].get(name, []):
                assert t["datum_m"] == d, (name, t["id"])
    for t in doc["tiles"]:
        assert t["watertight"] and t["z_mm"]["min"] >= s.base_mm - 1e-6
        if s.datum_mode == "set":
            assert t["datum_m"] <= t["h_m"]["min"] and t["clampedVertices"] == 0
        for f in t["files"].values():
            assert (idx.parent / f).exists(), f
        if "stl" in t["files"]:
            p = idx.parent / t["files"]["stl"]
            assert p.stat().st_size == 84 + 50 * t["triangles"]
    if s.connectors.enabled:
        assert (idx.parent / "keys" / "bowtie_key.stl").exists()
    pp = doc["printerProfile"]
    assert pp["placement_mm"] == list(s.placement_mm) and pp["printableHeight_mm"] == 250.0
    assert pp.get("mode", "sle-250") == s.printer
    with zipfile.ZipFile(idx.parent / doc["tiles"][0]["files"]["3mf"]) as zf:      # build transform = placement
        root = ET.fromstring(zf.read("3D/3dmodel.model"))
    ns = {"m": "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"}
    t = [float(v) for v in root.find(".//m:build/m:item", ns).get("transform").split()]
    assert t[9:11] == pytest.approx(list(s.placement_mm), abs=1e-3)
    if pp["file"]:
        preset = json.loads((idx.parent / pp["file"]).read_text())
        assert pp["file"] == PRESET_FILE and preset["bed_exclude_area"] == pp["bedExcludeArea"]
        assert load_line_plate_max_y(load_line_extent(preset["machine_start_gcode"])[3]) <= FRONT_EXCLUDE_MM
    for t in doc["tiles"]:
        assert all(z <= pp["printableHeight_mm"] for z in (t["z_mm"]["max"],))
