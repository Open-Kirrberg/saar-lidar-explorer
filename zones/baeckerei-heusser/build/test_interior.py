"""Wave B (Verkaufsraum): pure helpers of the shell, the fixtures and the price cards. No local data needed."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest
from shapely.geometry import Polygon

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE)]

from bh_twin import auslage, fixtures, geom, interior  # noqa: E402


def test_price_label():
    assert auslage.price_label(4.4) == "4,40 €"
    assert auslage.price_label(0.85) == "0,85 €"
    assert auslage.price_label(12) == "12,00 €"
    for bad in (-1.0, float("nan"), "4,40"):
        with pytest.raises(ValueError):
            auslage.price_label(bad)


def test_price_card_geometry():
    """A card faces its frame's front, hangs below the origin within CARD_W × CARD_H, the text sits on it."""
    node = geom.Node("t", lambda n, p: np.ones((len(n), 3)))
    frame = np.array([[1.0, 2.0, 3.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]])
    tris = auslage.price_card(node, frame, "Hildegard von Bingen 750g", 4.6)
    assert 0 < tris < 800
    card = np.concatenate(node.prims[auslage.CARD_MAT].pos)
    ink = np.concatenate(node.prims[auslage.CARD_INK].pos)
    assert np.allclose(card[:, 2], 3.0) and np.all(ink[:, 2] > 3.0)            # text just in front of the card
    assert card[:, 0].min() >= 1 - auslage.CARD_W / 2 - 1e-9 and card[:, 0].max() <= 1 + auslage.CARD_W / 2 + 1e-9
    assert card[:, 1].max() <= 2.0 + 1e-9 and card[:, 1].min() >= 2.0 - auslage.CARD_H - 1e-9
    assert ink[:, 0].min() > card[:, 0].min() and ink[:, 0].max() < card[:, 0].max()
    assert ink[:, 1].min() > card[:, 1].min() and ink[:, 1].max() < card[:, 1].max()
    assert np.allclose(np.concatenate(node.prims[auslage.CARD_MAT].nrm), [0, 0, 1])


def test_rotated_tiles_cover_the_floor_diagonally():
    floor = Polygon([(0, 0), (3, 0), (3, 2), (0, 2)])
    t, g = interior.rotated_tiles(floor, 0.30, 0.008, (0.0, 0.0), 45.0)
    area = sum(q.area for q in t) + sum(q.area for q in g)
    assert area == pytest.approx(floor.area, rel=1e-6)
    full = [q for q in t if q.area > 0.29 ** 2 - 1e-6]                        # whole tiles inside the room
    assert full
    c = np.asarray(full[0].exterior.coords)
    d = np.diff(c, axis=0)
    ang = np.degrees(np.arctan2(d[:, 1], d[:, 0])) % 90.0
    assert np.allclose(ang[np.linalg.norm(d, axis=1) > 0.1], 45.0, atol=0.5)


def test_fascia_bands():
    b = interior.fascia_bands(2.0, 2.12)
    assert [m for m, _, _ in b] == ["heusser-rot", "holz", "heusser-rot"]
    assert b[0][1] == 2.0 and b[-1][2] == 2.12
    assert all(abs(b[k][2] - b[k + 1][1]) < 1e-12 for k in range(2))
    assert b[1][2] - b[1][1] > 0.08                                            # mostly wood


def test_lift_downward_only_touches_downward_faces():
    node = geom.Node("t", lambda n, p: np.full((len(n), 3), 0.5))
    v = np.array([[0, 0, 0], [1, 0, 0], [0, 0, 1]], float)
    node.add("a", v, np.array([[0, 1, 2]]), np.array([0.0, -1.0, 0.0]))
    node.add("b", v, np.array([[0, 1, 2]]), np.array([1.0, 0.0, 0.0]))
    interior.lift_downward(node, (1.2, 1.4, 1.6))
    assert np.allclose(node.prims["a"].col[0], [0.6, 0.7, 0.8])
    assert np.allclose(node.prims["b"].col[0], 0.5)


def test_egg_profile():
    p = np.array(fixtures.egg_profile(0.075, 0.15, 1.8))
    assert p[0, 1] == pytest.approx(1.8) and p[-1, 1] == pytest.approx(1.95)
    assert np.all(np.diff(p[:, 1]) > 0) and p[0, 0] > 0 and p[-1, 0] == 0         # open rim, closed tip
    widest = p[np.argmax(p[:, 0])]
    assert widest[0] == pytest.approx(0.075) and widest[1] < 1.8 + 0.5 * 0.15     # an egg: widest low down


@pytest.mark.parametrize("kind", ["weizen", "haus", "ofen"])
def test_vignettes_stay_on_the_paper(kind):
    paper = (0.1, 0.2, 0.4, 0.6)
    out = fixtures.vignette(kind, *paper)
    assert out == fixtures.vignette(kind, *paper)                              # deterministic
    mats = {m for m, _ in out}
    assert mats == {"sepia", "sepia-dunkel"}
    box = Polygon([(0.1, 0.2), (0.4, 0.2), (0.4, 0.6), (0.1, 0.6)]).buffer(1e-9)
    for _, g in out:
        assert not g.is_empty and g.is_valid and box.contains(g)
    assert set(fixtures.VIGNETTES.values()) == {"weizen", "haus", "ofen"}
