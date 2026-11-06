"""Shop lettering as flat outlines (matplotlib's bundled DejaVu / STIX fonts -> shapely polygons with holes).

Used for the gable mural text, the keystone inscription and the projecting sign's name (on by default since the owners'
OK, ADR 0044; `--no-lettering` leaves it out). `fraktur=True` sets the text in the bundled STIX Fraktur (mathtext
`\\mathfrak`), as on keystone 2. Deterministic: the fonts ship with the pinned matplotlib, outlines rounded to 0.1 mm.
"""
from __future__ import annotations

from shapely import affinity
from shapely.geometry import Polygon
from shapely.ops import unary_union

DEFAULT_FONT = {"family": "DejaVu Sans", "weight": "bold"}


def fraktur_math(text: str) -> str:
    """mathtext source for `text` in STIX Fraktur (spaces kept, digits fall back to the STIX serif). Pure."""
    if any(c in text for c in "$\\{}^_"):
        raise ValueError(f"fraktur text must be plain: {text!r}")
    return r"$\mathfrak{" + text.replace(" ", r"\ ") + "}$"


def text_polys(text: str, height: float, font: dict | None = None, tol: float = 0.0004, fraktur: bool = False):
    """Outline of `text` as one shapely geometry in metres: baseline on y = 0, centred on x = 0, cap height ≈ `height`
    (the em size is scaled so that a capital 'H' is `height` tall). Holes (A, B, O, 9 …) come out as interiors."""
    import matplotlib
    from matplotlib.font_manager import FontProperties
    from matplotlib.textpath import TextPath

    prop = FontProperties(**(font or DEFAULT_FONT))
    with matplotlib.rc_context({"mathtext.fontset": "stix"}):
        src = fraktur_math(text) if fraktur else text
        cap = TextPath((0, 0), fraktur_math("H") if fraktur else "H", size=1.0, prop=prop).get_extents().height
        path = TextPath((0, 0), src, size=height / cap, prop=prop)
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
