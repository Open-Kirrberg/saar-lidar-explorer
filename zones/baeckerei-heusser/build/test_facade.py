"""Tests for the facade helpers (bh_twin/facade.py, bh_twin/lettering.py): pure geometry, no local data needed.

    cd pipeline && uv run python -I -m pytest -q -p no:cacheprovider ../zones/baeckerei-heusser/build
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from shapely.geometry import Polygon, box

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parents[2] / "pipeline")]

from bh_twin import facade as fc  # noqa: E402
from bh_twin import geom  # noqa: E402
from bh_twin.lettering import text_polys  # noqa: E402


def test_ashlar_covers_the_band_inside_the_shape_and_is_deterministic():
    shape = box(0, -1.0, 6.0, 0.05)
    a = fc.ashlar(shape, [0.15, 0.19], (0.26, 0.34, 0.42), 0.012, "t")
    b = fc.ashlar(shape, [0.15, 0.19], (0.26, 0.34, 0.42), 0.012, "t")
    assert [(q.wkb, k) for q, k in a] == [(q.wkb, k) for q, k in b]
    area = sum(q.area for q, _ in a)
    assert 0.85 * shape.area < area < shape.area
    assert all(shape.buffer(1e-9).contains(q) for q, _ in a)
    light = sum(k for _, k in a) / len(a)
    assert 0.2 < light < 0.6


def test_basket_weave_blocks_stay_in_the_panel_without_overlap():
    blocks = fc.basket_weave(0.0, 0.0, 3.0, 2.5, 0.25, 0.014, "g")
    polys = [box(*r) for r, _ in blocks]
    panel = box(0, 0, 3.0, 2.5)
    assert all(panel.contains(p) for p in polys)
    for i, p in enumerate(polys[:200]):
        for q in polys[i + 1:i + 40]:
            assert p.intersection(q).area < 1e-9
    kinds = [k for _, k in blocks]
    assert kinds.count(2) + kinds.count(3) < 0.08 * len(kinds)


def test_pretzel_is_a_valid_relief_inside_its_circle():
    p = fc.pretzel(0.17)
    assert p.is_valid and not p.is_empty
    x0, y0, x1, y1 = p.bounds
    assert max(abs(x0), abs(y0), x1, y1) <= 0.171
    holes = sum(len(q.interiors) for q in geom.polys(p))
    assert holes >= 3            # the two loops + the space inside the ring


def test_wallframe_put_keeps_solids_outward_on_both_walls():
    street = fc.street_frame()
    gable = fc.WallFrame(np.array([0.0, 0.0]), np.array([0.0, -1.0]), np.array([-1.0, 0.0]))
    for wf in (street, gable):
        V, T = geom.rounded_box_local(0.3, 0.05, 0.2, 0.01, 1)
        col = {"s": V[:, 0], "e": V[:, 1], "z": V[:, 2]}
        B = wf.to_b(col["s"], col["e"], col["z"])
        basis = np.array([[*wf.u, 0], [*wf.n, 0], [0, 0, 1.0]])
        T2 = T[:, [0, 2, 1]] if np.linalg.det(basis) < 0 else T
        a, b, c = B[T2[:, 0]], B[T2[:, 1]], B[T2[:, 2]]
        vol = np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6
        assert vol > 0                                      # outward winding survives the mapping
        assert np.allclose(np.cross([*wf.u, 0], [0, 0, 1])[:2], wf.n)


def _hip_house(L=10.0, D=6.0, eave=6.0, ridge=9.0, hip=3.0):
    """Box house along x with a hip at x = 0 and a gable at x = L (frame-B rings, ground at 0)."""
    y_r = D / 2
    walls = [np.array([[0, 0, 0], [L, 0, 0], [L, 0, eave], [0, 0, eave]], float),          # street
             np.array([[L, 0, 0], [L, D, 0], [L, D, eave], [L, y_r, ridge], [L, 0, eave]], float),
             np.array([[L, D, 0], [0, D, 0], [0, D, eave], [L, D, eave]], float),
             np.array([[0, D, 0], [0, 0, 0], [0, 0, eave], [0, D, eave]], float)]           # hip end wall
    roofs = [np.array([[0, 0, eave], [L, 0, eave], [L, y_r, ridge], [hip, y_r, ridge]], float),
             np.array([[L, D, eave], [0, D, eave], [hip, y_r, ridge], [L, y_r, ridge]], float),
             np.array([[0, D, eave], [0, 0, eave], [hip, y_r, ridge]], float)]
    return walls, roofs


def test_make_gable_turns_the_hip_into_a_gable():
    walls, roofs = _hip_house()
    walls2, roofs2, g = fc.make_gable(walls, roofs)
    assert abs(g.x_cut - 3.0) < 1e-9 and abs(g.eave - 6.0) < 1e-9
    assert all(r[:, 0].min() >= g.x_cut - 1e-9 for r in roofs2)          # hip face gone, planes cut at the hip
    end = next(w for w in walls2 if np.allclose(w[:, 0], 0.0))
    assert abs(end[:, 2].max() - 9.0) < 1e-6                              # the end wall reaches the ridge
    assert abs(g.ridge_y(0.0) - 3.0) < 1e-6
    assert abs(g.z(np.array([[0.0, 0.0]]))[0] - 6.0) < 1e-6
    front, back = fc.gable_roof_regions(box(0, 0, 10, 6), g)
    assert abs(front.area - 9.0) < 1e-6 and abs(back.area - 9.0) < 1e-6


def test_make_gable_keeps_the_eaves_level_at_a_chamfered_corner():
    """Back corner of the end wall chamfered with its own LoD2 hip (like L8): the gable's back slope ends at eave
    height on the chamfer's corner, the chamfer wall keeps a level top, the hip face stays."""
    L, eave, ridge = 10.0, 6.0, 9.0
    walls = [np.array([[0, 0, 0], [L, 0, 0], [L, 0, eave], [0, 0, eave]], float),
             np.array([[0, 4, 0], [0, 0, 0], [0, 0, eave], [0, 4, eave]], float),               # end wall
             np.array([[2, 6, 0], [0, 4, 0], [0, 4, eave], [2, 6, eave]], float)]               # chamfer wall
    roofs = [np.array([[0, 0, eave], [L, 0, eave], [L, 3, ridge], [3, 3, ridge]], float),
             np.array([[L, 6, eave], [2, 6, eave], [3, 3, ridge], [L, 3, ridge]], float),
             np.array([[0, 4, eave], [0, 0, eave], [3, 3, ridge]], float),
             np.array([[2, 6, eave], [0, 4, eave], [3, 3, ridge]], float)]
    walls2, roofs2, g = fc.make_gable(walls, roofs)
    assert g.corner is not None and g.hip is not None
    assert any(len(r) == 3 and np.allclose(sorted(r[:, 0]), [0, 2, 3]) for r in roofs2)       # hip face kept
    end = next(w for w in walls2 if np.allclose(w[:, 0], 0.0))
    top = end[end[:, 2] > 1.0]
    assert abs(top[:, 2].max() - ridge) < 1e-6                           # ridge on the wall
    assert abs(top[np.argmax(top[:, 1]), 2] - eave) < 1e-6               # back corner at eave height
    cham = next(w for w in walls2 if np.allclose(sorted(set(np.round(w[:, 0], 6))), [0, 2]))
    assert np.allclose(cham[cham[:, 2] > 1.0][:, 2], eave)
    assert abs(g.z(np.array([[0.0, 4.0]]))[0] - eave) < 1e-6
    front, back = fc.gable_roof_regions(Polygon([(0, 0), (L, 0), (L, 6), (2, 6), (0, 4)]), g)
    assert back.intersection(g.corner).area < 1e-6 and back.intersection(g.hip).area < 1e-6


def test_text_polys_height_and_holes():
    t = text_polys("H.H. 1933", 0.10)
    x0, y0, x1, y1 = t.bounds
    assert abs(x0 + x1) < 1e-3                                            # centred
    assert 0.09 < y1 - max(y0, 0.0) < 0.12                               # cap height ≈ 0.10
    assert sum(len(q.interiors) for q in geom.polys(t)) == 1              # the 9 has a counter
    assert sum(len(q.interiors) for q in geom.polys(text_polys("BÄCKEREI", 0.1))) == 4      # B: 2, Ä: 1, R: 1
    assert text_polys("H", 0.1).equals(text_polys("H", 0.1))


def test_cdt_wall_with_collinear_sills_has_no_t_junction():
    """Three windows on one sill line: the CDT keeps every triangle (earcut joined collinear corners into a dropped
    zero-area triangle, a hairline crack on the street wall); no vertex lies inside another triangle's edge."""
    w = box(0, -1, 24, 6)
    for x in (16.0, 19.0, 21.0):
        w = w.difference(box(x, 3.3, x + 1.0, 4.95))
    (v, t), = list(geom.triangulate(w, cdt=True))
    a = v[t]
    e1, e2 = a[:, 1] - a[:, 0], a[:, 2] - a[:, 0]
    area = 0.5 * np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]).sum()
    assert abs(area - w.area) < 1e-9 and len(t) == len(v) + 2 * 3 - 2
    for tri in t:
        for i in range(3):
            p, q = v[tri[i]], v[tri[(i + 1) % 3]]
            d = q - p
            s = ((v - p) @ d) / (d @ d)
            off = np.abs(d[0] * (v - p)[:, 1] - d[1] * (v - p)[:, 0]) / np.linalg.norm(d)
            assert not np.any((s > 1e-9) & (s < 1 - 1e-9) & (off < 1e-9)), (p, q)
