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
    STOCK_LOAD_LINE_GCODE_MAX_Y, STOCK_MARGIN_MM, STOCK_PRINTER, Connectors, Series, axis_weights,
    bambu_import_position, bowtie_key, build_tile_mesh, check_series, check_text_clearance, compact, filament_g,
    keys_needed, key_mesh, label_lines, layout_blocks, list_series, load_line_extent, load_line_plate_max_y,
    load_series, merge_index, mesh_check, mesh_stats, parse_tile_id, patch_start_gcode, plate_placement,
    printer_meta, printer_preset, read_stl, recess_polygons, resample, resolve_datums, set_datum,
    simplify_heightfield, slicer_from_config, slicer_meta, slicer_note_de, source_box, stock_clearance,
    stock_max_tile_mm, stock_profile_problems, text_geometry, tile_filament, tile_id, tiles_in_bbox, validate_index,
    vertex_coords, write_3mf, write_catalog, write_stl, z_from_h, STOCK_PROCESS, Slicer,
    Lod2, building_surface, building_triangles, disk_offsets, feature_cells, grid_coords, lod2_attribution,
    lod2_file_buildings, open_mask, grey_open, rasterize_roofs, ATTRIBUTION_SL, ROLES, title_problem,
)

S8 = load_series("saarpfalz-9200")      # main series (name kept short: "the 2 km series")
S2 = load_series("detail-2300")
SK = load_series("kirrberg-11050")     # single showpiece: the village of Kirrberg on one tile
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
        (9200, 2000, 1001, 2.0, 2.0, 180.0, 4.0, "stock")
    assert S8.tile_mm == pytest.approx(2000 / 9200 * 1000) and S8.datum_mode == "series" and S8.role == "main"
    assert (S2.scale, S2.tile_m, S2.cell_m, S2.datum_m, S2.exag, S2.datum_mode, S2.datum_margin_m, S2.role) == \
        (2300, 500, 0.5, None, 1.5, "set", 5.0, "detail")
    assert S2.tile_mm == pytest.approx(S8.tile_mm) and S2.placement_mm == S8.placement_mm   # 4 × the main scale
    assert (S8.max_error_mm, S8.max_triangles) == (S2.max_error_mm, S2.max_triangles) == (0.03, 900_000)
    assert set(list_series()) == {"saarpfalz-9200", "detail-2300", "kirrberg-11050"}   # 8000 preset commented out
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
    with pytest.raises(ValueError):
        check_series(replace(S8, max_error_mm=-0.01))


def test_stock_p1s_placement():
    """Stock P1S: where the Bambu Studio GUI puts the tile (centred) it must clear the 18 × 28 mm front-left
    exclusion area (with our 1 mm margin) and lie behind the load line."""
    x, y = S8.placement_mm
    assert (x, y) == pytest.approx(bambu_import_position(S8.tile_mm), abs=1e-4) == (19.3043, 19.3043)
    assert stock_clearance(x, y, S8.tile_mm, margin=STOCK_MARGIN_MM) == []
    assert STOCK_EXCLUDE_MM[0] + STOCK_MARGIN_MM <= x and x + S8.tile_mm <= PLATE_MM[0]
    assert y >= load_line_plate_max_y(STOCK_LOAD_LINE_GCODE_MAX_Y) and y + S8.tile_mm <= PLATE_MM[1]
    assert stock_max_tile_mm() == 218.0 and plate_placement(217.99) == (19.005, 19.005)
    for mm in (218.0, 2000 / 8500 * 1000, 2000 / 8400 * 1000, 500 / 2125 * 1000, 250.0):
        with pytest.raises(ValueError, match="stock P1S"):
            plate_placement(mm, "stock")
    with pytest.raises(ValueError):
        check_series(replace(S8, scale=8500, tile_mm=2000 / 8500 * 1000))     # the former main series
    assert plate_placement(250.0, "sle-250") == PLACEMENT_MM
    pm = printer_meta(False, "", "stock", S8.placement_mm, S8.tile_mm)
    assert pm["mode"] == "stock" and pm["file"] is None and pm["bedExcludeArea"] == ["0x0", "18x0", "18x28", "0x28"]
    assert "Plattenmitte" in pm["note_de"] and "19.3–236.7" in pm["note_de"]
    assert printer_meta(True, "v", "sle-250")["file"] == PRESET_FILE


@pytest.mark.parametrize("w,x,y,ok", [
    # Bambu Studio 02.08.02.61 CLI, stock "Bambu Lab P1S 0.4 nozzle", --arrange 0 (box at the given corner)
    (235.294, 10.353, 10.353, False),   # the old 1:8500 tile where the GUI centres it → the user's error
    (220.0, 18.0, 18.0, False),         # centred 220 mm: touching the exclusion edge is refused
    (220.2, 17.9, 17.9, False),
    (219.98, 18.01, 18.01, True),
    (219.9, 18.05, 18.05, True),
    (217.391, 19.3045, 19.3045, True),  # 1:9200 / 1:2300 tile, centred
    (235.294, 19.4, 17.1, True),        # old CLI placement (passed the CLI; the GUI discards it)
    (200.0, 10.0, 28.0, False),         # front edge on the exclusion's back edge (Y 28)
    (200.0, 30.0, 28.0, True),
    (200.0, 18.0, 30.0, True),
    # exactly touching the X 18 edge is inconsistent in Bambu (Clipper): 220 / 200 mm at X 18 refused, 238.0 and
    # 237.9 mm at X 18, Y 17.1 accepted — stock_clearance counts touching as a problem; we keep a 1 mm margin anyway
    (238.095, 17.9, 17.1, False),       # "too close to exclusion area"
    (238.095, 17.95, 17.1, False),      # sticks out of the plate
])
def test_bambu_clearance_rule_matches_slicer(w, x, y, ok):
    """stock_clearance (no margin) reproduces the Bambu Studio checks measured with the CLI. The GUI first moves a
    plain 3MF to bambu_import_position, so only centred squares < 220 mm open without the exclusion error."""
    exclusion = [p for p in stock_clearance(x, y, w) if "exclusion" in p or "printable" in p]
    assert (exclusion == []) == ok, exclusion
    if (x, y) == pytest.approx(bambu_import_position(w), abs=1e-3):
        assert (w < 220.0) == ok


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
    h = np.array([180.0, 189.2, 300.0, 170.0])
    z, clamped = z_from_h(h, S8)
    assert z.tolist() == pytest.approx([4.0, 6.0, 4.0 + 120 / 9200 * 1000 * 2, 4.0])   # 1:9200 × 2 → 0.217 mm/m
    assert clamped == 1
    z2, c2 = z_from_h(np.array([380.0, 270.0]), S2, 274.0)
    assert z2[0] == pytest.approx(4.0 + 106 * 1000 / 2300 * 1.5) and z2[1] == 4.0 and c2 == 1
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


def terrain(n: int, seed: int = 0) -> np.ndarray:
    """Smooth hills + a sharp ridge + a pit + small noise (mm), like a printed tile."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:n, 0:n] / (n - 1)
    z = 10 + 6 * np.sin(3 * x) * np.cos(2 * y) + 4 * np.exp(-((x - 0.3) ** 2 + (y - 0.6) ** 2) / 0.01)
    z += 2 * np.clip(1 - np.abs(x - y) * 40, 0, None) - 3 * ((x - 0.7) ** 2 + (y - 0.2) ** 2 < 0.002)
    return z + rng.normal(0, 0.005, z.shape)


def interpolate(z: np.ndarray, F: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """Height of the triangulated top surface F (flat grid indices) at grid positions pts (k, 2) = (i, j)."""
    from matplotlib.tri import LinearTriInterpolator, Triangulation
    n = z.shape[0]
    jj, ii = np.divmod(np.arange(n * n), n)
    tri = Triangulation(ii.astype(float), jj.astype(float), F)
    return np.asarray(LinearTriInterpolator(tri, z.ravel())(pts[:, 0], pts[:, 1]))


@pytest.mark.parametrize("tol", [0.01, 0.03, 0.1])
def test_simplify_error_bound_and_boundary(tol):
    n = 121
    z = terrain(n)
    F, err = simplify_heightfield(z, tol, step=10)
    assert err <= tol
    used = np.unique(F)
    jj, ii = np.divmod(used, n)
    border = np.zeros((n, n), bool)
    border[0, :] = border[-1, :] = border[:, 0] = border[:, -1] = True
    assert border.ravel()[used].sum() == 4 * (n - 1)                 # every edge vertex kept
    assert len(F) < 2 * (n - 1) ** 2                                  # actually simplified
    # independent check: every grid vertex within tol of the simplified surface
    jj, ii = np.divmod(np.arange(n * n), n)
    got = interpolate(z, F, np.column_stack([ii, jj]).astype(float))
    assert np.abs(got - z.ravel()).max() <= tol + 1e-9
    # CCW from above, covering the square once
    p = np.column_stack([ii, jj])[F].astype(float)
    a2 = (p[:, 1, 0] - p[:, 0, 0]) * (p[:, 2, 1] - p[:, 0, 1]) - (p[:, 1, 1] - p[:, 0, 1]) * (p[:, 2, 0] - p[:, 0, 0])
    assert (a2 > 0).all() and a2.sum() / 2 == (n - 1) ** 2


def test_simplify_budget_flat_and_deterministic():
    n = 81
    z = terrain(n, 1)
    F, err = simplify_heightfield(z, 1e-6, max_tris=2000, step=10)    # budget wins over the tolerance
    assert len(F) <= 2000 + 4 and err > 1e-6
    F2, err2 = simplify_heightfield(z, 1e-6, max_tris=2000, step=10)
    assert np.array_equal(F, F2) and err == err2
    Ff, ef = simplify_heightfield(np.full((n, n), 7.0), 0.01, step=10)  # flat: boundary + coarse lattice only
    assert ef < 1e-12 and len(np.unique(Ff)) == 4 * (n - 1) + (n // 10 - 1) ** 2
    Fa, ea = simplify_heightfield(z, 0.0, step=10)                     # tol 0 → every vertex kept
    assert ea == 0.0 and len(np.unique(Fa)) == n * n and len(Fa) == 2 * (n - 1) ** 2


@pytest.mark.parametrize("conn,with_text", [(True, True), (False, False)])
def test_simplified_tile_mesh_watertight(conn, with_text):
    n, W = 101, S8.tile_mm
    z = terrain(n, 2) + 2
    z[:, :3] = 4.0                                                     # clamped strip along the west edge
    c = S8.connectors if conn else Connectors(enabled=False)
    text = text_geometry(label_lines(S8, "E380_N5460"), W) if with_text else None
    top, err = simplify_heightfield(z, 0.03, step=10)
    V, F = build_tile_mesh(z, W, c, text, 0.6, top)
    chk = mesh_check(F)
    assert chk["watertight"], chk
    assert len(np.unique(F)) == len(V)                                 # unused grid vertices dropped
    full_V, full_F = build_tile_mesh(z, W, c, text, 0.6)
    assert len(F) < len(full_F) * 0.6
    vol, _ = mesh_stats(V, F)
    vol_full, _ = mesh_stats(full_V, full_F)
    assert vol > 0 and abs(vol - vol_full) <= 0.03 * W * W               # |Δz| ≤ 0.03 mm over the footprint
    # walls / bottom / recesses unchanged: every non-top vertex of the full mesh is in the simplified one
    key = lambda A: {tuple(np.round(v, 9)) for v in A}                # noqa: E731
    assert key(full_V[n * n:]) <= key(V)
    # edges exact: the boundary profile (all 4·(n−1) vertices) is identical
    g = np.arange(n) * W / (n - 1)
    south = {(round(x, 9), round(zz, 9)) for x, y, zz in V if y == 0 and zz > c.depth_mm + 1e-9}
    assert south == {(round(x, 9), round(zz, 9)) for x, zz in zip(g, z[0])}


def test_compact_keeps_order():
    V = np.arange(15, dtype=float).reshape(5, 3)
    V2, F2 = compact(V, np.array([[0, 2, 4]]))
    assert V2.tolist() == V[[0, 2, 4]].tolist() and F2.tolist() == [[0, 1, 2]]
    V3, F3 = compact(V, np.array([[0, 1, 2], [2, 3, 4]]))
    assert V3 is V and F3.tolist() == [[0, 1, 2], [2, 3, 4]]


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
    shell = 100_000.0 * S8.shell_mm
    assert typical == pytest.approx((shell + S8.infill * (1_000_000 - shell)) * 1.24e-3)
    assert (S8.shell_mm, S8.infill) == (0.9, 0.155)                 # fitted to the stock-process slices



def test_slicer_recommendation_config():
    sl = S8.slicer
    assert sl is not None and S2.slicer == sl                                  # [defaults.slicer] for both series
    assert (sl.sparse_infill_pattern, sl.sparse_infill_density, sl.wall_loops, sl.top_shell_layers) == \
        ("lightning", 0.10, 3, 6)
    assert sl.top_shell_thickness_mm >= 1.0                  # ≥ 1 mm skin over lightning (pillowing)
    assert 0 < sl.saving_pct[0] < sl.saving_pct[1] < 100 and 0 <= sl.infill < S8.infill
    assert slicer_from_config({}) is None and slicer_from_config({"enabled": False, "wall_loops": 4}) is None
    assert slicer_from_config({"wall_loops": 4, "saving_pct": [10, 20]}) == Slicer(wall_loops=4, saving_pct=(10, 20))
    check_series(replace(S8, slicer=None))
    for bad in (Slicer(sparse_infill_pattern="honeycomb"), Slicer(sparse_infill_density=0), Slicer(wall_loops=0)):
        with pytest.raises(ValueError):
            check_series(replace(S8, slicer=bad))


def test_slicer_note_de_and_meta():
    sl = Slicer()
    note = slicer_note_de(sl)
    for part in ("Füllmuster „Blitz“", "Fülldichte 10 %", "Wandlinien 3", "Obere Schalenschichten 6",
                 "Dicke der oberen Schale 1,2 mm", f"≈ {sl.saving_pct[0]}–{sl.saving_pct[1]} %", "Prozess → Stärke",
                 "Druckzeit etwa gleich bis ≈ 22 % kürzer"):
        assert part in note, part
    m = slicer_meta(replace(S8, slicer=sl))
    assert m["base"] == STOCK_PROCESS and m["inFile"] is False and m["note_de"] == note
    assert m["settings"] == {"sparse_infill_pattern": "lightning", "sparse_infill_density": "10%", "wall_loops": 3,
                             "top_shell_layers": 6, "top_shell_thickness": 1.2}
    assert slicer_meta(replace(S8, slicer=None)) is None
    assert "≈ 5–20 % weniger Druckzeit" in slicer_note_de(Slicer(time_saving_pct=(5, 20)))
    one = slicer_note_de(Slicer(saving_pct=(12, 12), time_saving_pct=(-9, -9)))   # a single measured tile
    assert "spart ≈ 12 % Filament, ≈ 9 % längere Druckzeit als" in one and "12–12" not in one
    assert "≈ 3–9 % längere Druckzeit" in slicer_note_de(Slicer(time_saving_pct=(-9, -3)))


def test_tile_filament_recommended():
    f = tile_filament(1000.0, 1000.0, S8)                    # 1 l, 10 dm²
    solid, typical = filament_g(1_000_000.0, 100_000.0, S8)
    sl = S8.slicer
    shell = 100_000.0 * sl.shell_mm
    assert f == {"solid": round(solid), "typical": round(typical),
                 "recommended": round((shell + sl.infill * (1_000_000 - shell)) * 1.24e-3)}
    assert f["recommended"] < f["typical"] < f["solid"]
    assert "recommended" not in tile_filament(1000.0, 1000.0, replace(S8, slicer=None))


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
    assert doc2["attribution"] == f"b; {ATTRIBUTION_SL}"     # passed strings + derived from the tiles
    bad = json.loads(json.dumps(doc2))
    bad["tiles"][0]["bboxUTM"][0] += 1
    del bad["tiles"][1]["files"]
    assert len(validate_index(bad)) == 2
    assert doc["printerProfile"]["mode"] == "stock" and doc["series"]["placement_mm"] == [19.3043, 19.3043]
    assert "setDatum_m" not in doc
    # filament_g is recomputed from volume / surface for every entry (old ones too) and the slicer block is written
    assert doc["slicer"] == slicer_meta(S8)
    for t in doc2["tiles"]:
        assert t["filament_g"] == tile_filament(t["volume_cm3"], t["surface_cm2"], S8)
    plain = merge_index(None, replace(S8, slicer=None), [fake_entry("E380_N5460")], ["a"])
    assert "slicer" not in plain and set(plain["tiles"][0]["filament_g"]) == {"solid", "typical"}
    assert validate_index(plain) == []
    odd = json.loads(json.dumps(doc))
    odd["tiles"][0]["filament_g"]["lean"] = 1
    assert validate_index(odd) == [f"{odd['tiles'][0]['id']}: filament_g"]


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
        ("saarpfalz-9200", "main", "saarpfalz-9200/index.json", 1, True),
        ("detail-2300", "detail", "detail-2300/index.json", 1, True)]
    assert cat["series"][1]["datum_m"] is None and cat["series"][1]["datumMode"] == "set"


# ------------------------------------------------------------------------------------- buildings (LoD2)
def box_tris(x0, y0, x1, y1, z) -> np.ndarray:
    """Flat roof over an axis-aligned rectangle as two triangles (E, N, h)."""
    return np.array([[(x0, y0, z), (x1, y0, z), (x1, y1, z)], [(x0, y0, z), (x1, y1, z), (x0, y1, z)]], float)


def lod2_of(*buildings) -> Lod2:
    tris = [np.asarray(t, float) for t in buildings]
    return Lod2(tris=np.concatenate(tris), bidx=np.concatenate([np.full(len(t), i) for i, t in enumerate(tris)]),
                ids=[f"B{i}" for i in range(len(tris))], source=["sl"] * len(tris),
                centroid=np.array([t[:, :, :2].reshape(-1, 2).mean(0) for t in tris]), files={"sl": ["x"]})


def test_grid_coords_global_index():
    for tile_m, n in ((2000, 1001), (500, 1001), (20, 11)):
        assert np.array_equal(grid_coords(380000, 0, tile_m, n, 0, n - 1), vertex_coords(380000, tile_m, n))
        a = grid_coords(380000, 0, tile_m, n, -7, n - 1 + 7)          # tile A extended by 7 vertices
        b = grid_coords(380000 + tile_m, 0, tile_m, n, -7, n - 1 + 7)  # its east neighbour
        assert np.array_equal(a[n - 1:], b[:len(a) - (n - 1)])        # overlapping global vertices: equal bits
    assert grid_coords(10, 4, 6, 4, -1, 1).tolist() == [8.0, 10.0, 12.0]   # origin ≠ 0: g = (10 − 4)·3/6 = 3


def test_feature_cells_and_disk():
    s8 = load_series("saarpfalz-9200")
    assert s8.buildings and s8.building_min_feature_mm == 0.8 and S2.buildings
    assert feature_cells(0.8, s8.cell_mm) == 4 and feature_cells(0.8, S2.cell_mm) == 4   # 0.87 mm: 8 m / 2 m
    assert feature_cells(0.0, 0.2) == 0 and feature_cells(0.6, 0.2) == 3 and feature_cells(0.61, 0.2) == 4
    assert len(disk_offsets(4)) == 12 and len(disk_offsets(3)) == 9 and disk_offsets(1) == [(0, 0)]
    with pytest.raises(ValueError):
        check_series(replace(S8, building_min_feature_mm=-1))


def test_open_mask_drops_narrow_parts():
    m = np.zeros((20, 30), bool)
    m[2:5, 2:28] = True          # 3 cells wide strip → dropped by a 4-cell disk
    m[8:12, 2:28] = True         # 4 cells wide → kept (interior; the disk has no corners: end corners go)
    m[14:18, 2:6] = True         # 4 × 4 block → the disk itself (12 cells) survives
    m[15:16, 6:20] = True        # 1-cell spur attached to the block → dropped
    o = open_mask(m, 4)
    assert not o[2:5].any() and o[8:12, 4:26].all() and not o[15, 7:20].any()
    assert o[14:18, 2:6].sum() == 12 and not (o & ~m).any()     # anti-extensive
    assert np.array_equal(open_mask(o, 4), o)                    # idempotent
    assert np.array_equal(open_mask(m, 1), m) and np.array_equal(open_mask(m, 0), m)


def test_grey_open_cuts_thin_upper_parts():
    g = np.full((16, 16), -np.inf)
    g[2:12, 2:12] = 300.0              # wide low block
    g[5:7, 5:12] = 330.0               # 2-cell wide tall wing on it → cut down to the block
    g[8:12, 8:12] = 320.0              # 4 × 4 tall part → only the 12-cell disk keeps 320
    g[13:15, 2:9] = 310.0              # 2-cell wide building alone → removed
    o = grey_open(g, 4)
    assert (o <= g).all() and np.array_equal(grey_open(o, 4), o)            # anti-extensive, idempotent
    assert (o[5:7, 5:12] == 300.0).all() and not np.isfinite(o[13:15]).any()
    assert (o == 320.0).sum() == 12 and o[8, 8] == 300.0 and o[2, 3] == 300.0      # tall part's corner → block
    assert o[2, 2] == o[11, 11] == -np.inf                                   # the disk has no corner cells
    assert np.array_equal(np.isfinite(o), open_mask(np.isfinite(g), 4))      # support = binary opening


def test_rasterize_roofs_heights_edges_and_max():
    xs = ys = np.arange(0.0, 11.0)                               # 11 × 11 points, 1 m
    flat = box_tris(2, 2, 6, 6, 300.0)                           # edges on grid points: closed → included
    gable = np.array([[(4, 3, 310.0), (8, 3, 310.0), (8, 5, 314.0)], [(4, 3, 310.0), (8, 5, 314.0), (4, 5, 314.0)],
                      [(4, 5, 314.0), (8, 5, 314.0), (8, 7, 310.0)], [(4, 5, 314.0), (8, 7, 310.0), (4, 7, 310.0)]])
    roof, pt, pp = rasterize_roofs(np.concatenate([flat, gable]), xs, ys)
    assert np.isnan(roof[0, 0]) and np.isnan(roof[1, 2]) and roof[2, 2] == 300.0 and roof[6, 6] == 312.0
    assert roof[2, 3] == 300.0                                   # flat roof only (y = 2 < 3)
    assert roof[4, 5] == 312.0 and roof[5, 4] == 314.0 and roof[7, 8] == 310.0   # gable plane heights (row = y)
    assert roof[3, 3] == 300.0 and roof[3, 4] == 310.0           # overlap → maximum
    assert np.isfinite(roof).sum() == 25 + 25 - 12               # 5 × 5 flat + 5 × 5 gable − 3 × 4 shared
    assert set(pp.tolist()) == set(np.flatnonzero(np.isfinite(roof.ravel())).tolist()) and len(pt) == len(pp)
    r2, _, _ = rasterize_roofs(np.concatenate([gable, flat])[::-1], xs, ys)    # order-independent
    assert np.array_equal(np.nan_to_num(r2), np.nan_to_num(roof))
    empty, a, b = rasterize_roofs(np.zeros((0, 3, 3)), xs, ys)
    assert np.isnan(empty).all() and len(a) == len(b) == 0


def test_building_triangles_drop_walls():
    wall = [np.array([(0, 0, 0), (4, 0, 0), (4, 0, 3), (0, 0, 3), (0, 0, 0)], float)]
    roof = [np.array([(0, 0, 3), (4, 0, 3), (4, 4, 5), (0, 4, 5), (0, 0, 3)], float)]
    t = building_triangles([(wall, 1), (roof, 2)])
    assert t.shape == (2, 3, 3) and t[:, :, 2].max() == 5 and building_triangles([(wall, 1)]).shape == (0, 3, 3)


def _bsurface(s, lod2, e0, n0, h0=250.0):
    return building_surface(s, e0, n0, np.full((s.vertices, s.vertices), h0), lod2)


def test_buildings_in_heightfield_seams_and_min_feature():
    """2 m cells, opening disk 3 cells: a 20 m wide hall across the A|B edge, a 4 m narrow shed, a building on the
    datum side; shared edges bit-identical, the cut building identical on both sides, z by the terrain formula."""
    s = small_series(tile_m=40, vertices=21, building_min_feature_mm=37.5)   # cell 2 m = 12.5 mm → k = 3
    assert feature_cells(s.building_min_feature_mm, s.cell_mm) == 3
    hall = box_tris(30.3, 10.2, 51.7, 30.1, 262.0)        # crosses E = 40 (the A | B edge)
    shed = box_tris(5.1, 5.1, 9.0, 20.0, 258.0)           # 3.9 m wide → 2 vertex columns → dropped
    tower = box_tris(10.5, 25.5, 17.5, 33.0, 300.0)       # 7 m → 3–4 vertices → kept
    lod2 = lod2_of(hall, shed, tower)
    hA, stA = _bsurface(s, lod2, 0, 0)
    hB, stB = _bsurface(s, lod2, 40, 0)
    assert np.array_equal(hA[:, -1], hB[:, 0])                  # shared edge bit-identical
    assert (hA[:, -1] == 262.0).sum() == 10                      # N 12 … 30 → 10 vertices of the cut wall
    assert (hA == 262.0).sum() == 10 * 5 and (hB == 262.0).sum() == 10 * 6   # E 32 … 40 | 40 … 50
    assert not (hA == 258.0).any() and (hA == 300.0).sum() == 4 * 3          # shed dropped, tower kept
    assert (stA["count"], stA["kept"], stA["dropped"]) == (2, 1, 1)          # centroids in A: shed, tower
    assert (stB["count"], stB["kept"], stB["usedSources"]) == (1, 1, ["sl"])  # hall centroid E 41 → B
    za, _ = z_from_h(hA, s)
    zb, _ = z_from_h(hB, s)
    assert np.array_equal(za[:, -1], zb[:, 0])
    assert za.max() == s.base_mm + (300.0 - s.datum_m) / s.scale * 1000 * s.exag   # same formula as the terrain
    # without opening (min feature 0) the shed survives; terrain above a roof wins (max)
    h0, st0 = _bsurface(replace(s, building_min_feature_mm=0.0), lod2, 0, 0)
    assert (h0 == 258.0).sum() == 2 * 8 and st0["dropped"] == 0
    hi, _ = _bsurface(s, lod2, 0, 0, h0=280.0)
    assert (hi == 300.0).sum() == 12 and hi.min() == 280.0      # roofs below the terrain leave it unchanged
    # no buildings → unchanged terrain
    h1, st1 = _bsurface(s, Lod2(), 0, 0)
    assert (h1 == 250.0).all() and st1["count"] == 0 and st1["usedSources"] == []


def test_lod2_attribution_in_index():
    from buildings import ATTRIBUTION_LOD2_RLP, ATTRIBUTION_LOD2_SL
    assert lod2_attribution(["sl"]) == [ATTRIBUTION_LOD2_SL] and lod2_attribution([]) == []
    with_b = fake_entry("E380_N5460") | {"buildings": {"enabled": True, "usedSources": ["sl", "rlp"]}}
    doc = merge_index(None, S8, [with_b, fake_entry("E382_N5460")], [])
    assert doc["attribution"].split("; ") == [ATTRIBUTION_SL, ATTRIBUTION_LOD2_SL, ATTRIBUTION_LOD2_RLP]
    bare = merge_index(doc, S8, [fake_entry("E380_N5460") | {"buildings": {"enabled": False}}], [])
    assert bare["attribution"] == ATTRIBUTION_SL                  # a re-generated bare tile drops LoD2
    assert doc["series"]["buildings"]["minFeature_mm"] == 0.8 and doc["series"]["buildings"]["default"] is True
    assert validate_index(doc) == []


def test_lod2_file_buildings(tmp_path):
    import gzip
    from tests.test_buildings import CITYGML, _pl
    e, n = 380000.0, 5460000.0
    g = [(e + x, n + y, 300.0) for x, y in [(0, 0), (10, 0), (10, 10), (0, 10), (0, 0)]]
    w = [(e, n, 300), (e + 10, n, 300), (e + 10, n, 306), (e, n, 306), (e, n, 300)]
    r = [(e, n, 306), (e + 10, n, 306), (e, n + 10, 309)]
    xml = CITYGML.format(g=_pl(g), h=_pl([(e + 2, n + 2, 300), (e + 2, n + 3, 300), (e + 3, n + 3, 300),
                                          (e + 2, n + 2, 300)]), w=_pl(w),
                         r0="%s %s %s" % r[0], r1="%s %s %s" % r[1], r2="%s %s %s" % r[2],
                         g2=_pl([(e - 600 + x, n + y, 301.0) for x, y in [(0, 0), (5, 0), (5, 5), (0, 5), (0, 0)]]))
    p = tmp_path / "LoD2_32_380_5460_1_SL.gml.gz"
    with gzip.open(p, "wt") as f:
        f.write(xml)
    bl = lod2_file_buildings(p, "sl", (e, n, e + 1000, n + 1000))
    assert [b["id"] for b in bl] == ["B1", "B2"]
    assert bl[0]["tris"].shape == (1, 3, 3) and bl[0]["tris"][:, :, 2].max() == 309.0 and bl[0]["overhang"] == 0
    assert bl[1]["overhang"] == pytest.approx(600.0)            # load_lod2 refuses > LOD2_MARGIN_M (seams)


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
        b = t.get("buildings") or {"enabled": False}             # optional: absent = bare earth (older tiles)
        if b["enabled"]:
            assert 0 <= b["kept"] <= b["count"] and b["kept"] + b["dropped"] == b["count"], t["id"]
            assert b["minFeature_mm"] == s.building_min_feature_mm and b["raisedVertices"] <= b["vertices"]
            assert all(a in doc["attribution"] for a in lod2_attribution(b["usedSources"])), t["id"]
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


@pytest.mark.skipif(not generated(), reason="no print tiles generated (run print3d.py)")
@pytest.mark.parametrize("idx", generated(), ids=lambda p: p.parent.name)
def test_generated_tiles_open_in_bambu_studio(idx):
    """Every generated 3MF: footprint clears the stock P1S exclusion area both where the GUI puts it (centred) and
    at its build position; well under Bambu's 1 M triangle warning; top-surface error within the series bound."""
    import re
    doc = json.loads(idx.read_text())
    if doc["series"]["key"] not in list_series():
        pytest.skip(f"{idx.parent.name}: series no longer configured in print3d.toml (obsolete output)")
    s = load_series(doc["series"]["key"])
    for t in doc["tiles"]:
        with zipfile.ZipFile(idx.parent / t["files"]["3mf"]) as zf:
            model, names = zf.read("3D/3dmodel.model"), zf.namelist()
        xy = np.array(re.findall(rb'<vertex x="([-\d.]+)" y="([-\d.]+)"', model), float)
        ntri = model.count(b"<triangle ")
        tr = [float(v) for v in re.search(rb'<item objectid="1" transform="([^"]+)"', model).group(1).split()]
        w, h = xy.max(0) - xy.min(0)
        assert (w, h) == pytest.approx((s.tile_mm, s.tile_mm), abs=1e-3) and xy.min() == 0
        assert ntri == t["triangles"] < 1_000_000 and len(xy) == t["vertices"]
        assert not [n for n in names if n.startswith("Metadata/")], t["id"]   # plain 3MF: no settings (GUI centres)
        assert t["maxError_mm"] <= s.max_error_mm + 1e-9
        if s.printer == "stock":
            assert stock_clearance(*bambu_import_position(w), w, margin=STOCK_MARGIN_MM) == [], t["id"]
            assert stock_clearance(tr[9], tr[10], w, margin=STOCK_MARGIN_MM) == [], t["id"]


# ------------------------------------------------------------------------------------- single showpiece (Kirrberg)
KIRRBERG_VILLAGE = (380553, 5461407, 382467, 5463480)   # LoD2 building cluster around the church (≈ OSM residential)
KIRRBERG_PLACES = {"Kirche": (381455, 5462119), "Fischweiher": (381863, 5463533), "Merburg": (381964, 5463453),
                   "Bunkerruine": (382118, 5461504)}


def test_kirrberg_single_series():
    """One standalone tile framing the built-up village with a margin: stock P1S (GUI-centred) safe, own origin so
    the global grid of the series has the village tile at col/row 0, datum per set, no keys, name engraved."""
    s = SK
    assert (s.role, s.title, s.scale, s.tile_m, s.exag, s.datum_mode, s.buildings) == \
        ("single", "Kirrberg", 11050, 2400, 1.5, "set", True)
    assert s.tile_mm == pytest.approx(217.195, abs=1e-3) and s.tile_mm < stock_max_tile_mm()
    x, y = s.placement_mm
    assert (x, y) == pytest.approx(bambu_import_position(s.tile_mm), abs=1e-4)
    assert stock_clearance(x, y, s.tile_mm, margin=STOCK_MARGIN_MM) == []
    assert not s.connectors.enabled and keys_needed(s, [{"id": "E380.3_N5461.25", "datum_m": 230.0}]) == 0
    assert s.sets == {"kirrberg": ["E380.3_N5461.25"]}
    e0, n0 = parse_tile_id("E380.3_N5461.25", s)
    assert (e0, n0) == tuple(s.origin) and tiles_in_bbox(s, *KIRRBERG_VILLAGE) == [(e0, n0)]   # one tile only
    e1, n1 = e0 + s.tile_m, n0 + s.tile_m
    v = KIRRBERG_VILLAGE
    margins = (v[0] - e0, v[1] - n0, e1 - v[2], n1 - v[3])
    assert min(margins) >= 150 and max(margins) <= 300, margins          # village + fields/forest around it
    assert abs((v[0] + v[2]) / 2 - (e0 + e1) / 2) <= 25 and abs((v[1] + v[3]) / 2 - (n0 + n1) / 2) <= 25
    for name, (e, n) in KIRRBERG_PLACES.items():
        assert e0 + 100 <= e <= e1 - 100 and n0 + 100 <= n <= n1 - 100, name
    # name engraved large, readable, clear of the border
    lines = label_lines(s, "E380.3_N5461.25", 230.0)
    assert lines[:3] == [("N↑", 16.0), ("Kirrberg", 18.0), ("E380.3 N5461.25", 7.0)]
    check_text_clearance(text_geometry(lines, s.tile_mm), s.tile_mm, s.connectors)
    assert "Kirrberg" not in [t for t, _ in label_lines(S8, "E380_N5460")]
    assert label_lines(S8, "E380_N5460")[1] == ("E380 N5460", 13.0)                     # untitled series unchanged


def test_role_and_title_validation():
    assert ROLES == ("main", "detail", "single") and S8.role == "main" and S2.role == "detail"
    with pytest.raises(ValueError, match="role"):
        check_series(replace(SK, role="showpiece"))
    assert title_problem("Kirrberg") is None and title_problem("E380 N5461 1:11050") is not None   # > 16 chars
    assert "Ö" in title_problem("Mörsbach")                                  # stroke font has no umlauts
    with pytest.raises(ValueError, match="glyph"):
        check_series(replace(SK, title="Mörsbach"))
    check_series(replace(SK, title="Moersbach"))
    check_series(replace(SK, title=""))
