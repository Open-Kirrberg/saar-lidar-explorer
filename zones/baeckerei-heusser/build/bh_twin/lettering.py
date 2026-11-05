"""Shop lettering as flat outlines (matplotlib's bundled DejaVu font -> shapely polygons with holes).

Only used behind the build flag `--lettering` (off by default): the gable mural text, the keystone inscription and the
projecting sign's name wait for the owners' OK in the repo's privacy process. The default build shows neutral graphics.
Deterministic: the font ships with the pinned matplotlib, the outlines are rounded to 0.1 mm.
"""
from __future__ import annotations

from shapely import affinity
from shapely.geometry import Polygon
from shapely.ops import unary_union

DEFAULT_FONT = {"family": "DejaVu Sans", "weight": "bold"}


def text_polys(text: str, height: float, font: dict | None = None, tol: float = 0.0004):
    """Outline of `text` as one shapely geometry in metres: baseline on y = 0, centred on x = 0, cap height ≈ `height`
    (the em size is scaled so that a capital 'H' is `height` tall). Holes (A, B, O, 9 …) come out as interiors."""
    from matplotlib.font_manager import FontProperties
    from matplotlib.textpath import TextPath

    prop = FontProperties(**(font or DEFAULT_FONT))
    cap = TextPath((0, 0), "H", size=1.0, prop=prop).get_extents().height
    path = TextPath((0, 0), text, size=height / cap, prop=prop)
    shape = Polygon()
    for ring in path.to_polygons(closed_only=True):
        if len(ring) < 3:
            continue
        p = Polygon(ring)
        if not p.is_valid:
            p = p.buffer(0)
        shape = shape.symmetric_difference(p)          # even-odd: inner rings become holes
    shape = unary_union([shape]).simplify(tol, preserve_topology=True)
    if shape.is_empty:
        return shape
    x0, _, x1, _ = shape.bounds
    shape = affinity.translate(shape, -(x0 + x1) / 2, 0)
    from shapely import set_precision
    return set_precision(shape, 1e-4)
