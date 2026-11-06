"""Tests for the built twin generator (build.py, bh_twin/). Needs the local data (DGM1, LoD2, OSM); skips without it.

    cd pipeline && uv run python -I -m pytest -q -p no:cacheprovider ../zones/baeckerei-heusser/build
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np
import pytest

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parents[2] / "pipeline")]

import build as B  # noqa: E402
from bh_twin import geom  # noqa: E402
from bh_twin.glb import node_geometry, read_glb  # noqa: E402
from bh_twin.plan import load_plan  # noqa: E402

pytestmark = pytest.mark.skipif(not (B.DTM.is_file() and B.OSM.is_file() and B.LOD2.is_dir()),
                                reason="local data (data/work/overall/dtm.tif, data/raw/lod2, data/raw/osm) missing")
NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*){1,2}$")


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    out = tmp_path_factory.mktemp("twin")
    report = B.build(out)
    twin = node_geometry(*read_glb((out / "twin.glb").read_bytes()))
    nav = node_geometry(*read_glb((out / "nav.glb").read_bytes()))
    doc, _ = read_glb((out / "twin.glb").read_bytes())
    plan = load_plan(B.PLAN, report["plan"]["scale_factor"])
    return {"out": out, "report": report, "twin": twin, "nav": nav, "doc": doc, "plan": plan}


def _tris(geo: dict, skip=()) -> np.ndarray:
    t = [p[i] for name, items in geo.items() if not name.startswith(tuple(skip)) for _, p, i in items]
    return np.concatenate(t) if t else np.zeros((0, 3, 3))


def _pts(geo: dict, names) -> np.ndarray:
    return np.concatenate([p for n, items in geo.items() if n.startswith(tuple(names)) for _, p, _ in items])


def _first_hit(orig: np.ndarray, dirs: np.ndarray, tri: np.ndarray) -> np.ndarray:
    """Möller–Trumbore, both faces: distance to the nearest triangle per ray (inf = escapes)."""
    v0, e1, e2 = tri[:, 0], tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]
    best = np.full(len(dirs), np.inf)
    for k, d in enumerate(dirs):
        h = np.cross(d, e2)
        a = np.einsum("ij,ij->i", e1, h)
        ok = np.abs(a) > 1e-12
        f = np.where(ok, 1.0 / np.where(ok, a, 1.0), 0.0)
        s = orig - v0
        u = f * np.einsum("ij,ij->i", s, h)
        q = np.cross(s, e1)
        v = f * (q @ d)
        t = f * np.einsum("ij,ij->i", e2, q)
        hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-4)
        if hit.any():
            best[k] = t[hit].min()
    return best


def _sphere(n: int) -> np.ndarray:
    i = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * i / n)
    th = np.pi * (1 + 5 ** 0.5) * i
    return np.column_stack([np.cos(th) * np.sin(phi), np.cos(phi), np.sin(th) * np.sin(phi)])


# ----------------------------------------------------------------------------------------------- tests

def test_room_closed_except_the_door(built):
    """Rays from inside the sales room hit geometry (tiles, glass, ceiling, doors) - only the open shop door leaks."""
    p = built["plan"]
    F = p.frame
    tri = _tris(built["twin"])
    door = B.interior.door_geometry(p)
    for xy in ((22.3, 2.2), (18.2, 2.0), (20.9, 4.9)):  # café, staff aisle, rear corridor mouth
        o = F.zone(np.array([xy[0], xy[1], 1.5]))
        dirs = _sphere(240)
        t = _first_hit(o, dirs, tri)
        leak = dirs[~np.isfinite(t) | (t > 40)]
        for d in leak:  # must leave through the door opening (frame B plane y = C.y)
            db = F.zone_to_b(o + d) - F.zone_to_b(o)
            ob = F.zone_to_b(o)
            assert db[1] > 1e-6, f"ray {d} from {xy} escapes away from the door"
            s = (door["y"] - ob[1]) / db[1]
            hx, hz = ob[0] + s * db[0], ob[2] + s * db[2]
            assert door["xl"] - 0.05 <= hx <= door["xr"] + 0.05 and -0.05 <= hz <= door["head"] + 0.05, \
                f"ray from {xy} escapes through ({hx:.2f}, {hz:.2f}), not the door"


def test_node_names_and_catalogue(built):
    cat = B.catalogue_ids(json.loads(B.CATALOGUE.read_text(encoding="utf-8")))
    names = [n["name"] for n in built["doc"]["nodes"]]
    assert len(names) == len(set(names))
    for n in built["doc"]["nodes"]:
        if n["name"].startswith(B.PRODUCT_NODE):
            continue                                                       # test_products_in_the_shop
        assert NAME_RE.match(n["name"]), n["name"]
        ex = n["extras"]
        assert n["name"].split("/")[0] in cat, n["name"]
        assert ex["id"] in cat and (n["name"] == ex["id"] or n["name"].startswith(ex["id"] + "/")), n["name"]
        assert ex["confidence"] in ("high", "med", "low") and ex["source"] in ("plan", "photo", "mesh", "tape")
        assert 0 <= ex["sigma_m"] <= 5
    assert sorted(built["nav"]) == ["nav/edge", "nav/floor"]
    for must in ("verkaufsraum/boden", "verkaufsraum/wandfliesen", "verkaufsraum/rasterdecke", "verkaufsraum/deckenblende",
                 "verkaufsraum/ladentuer", "fassade/aussenwand", "fassade/dach", "fassade/schaufenster", "fassade/vorbau",
                 "fassade/eingangsstufen", "umgebung/gelaende", "umgebung/strasse", "umgebung/nachbarhaeuser"):
        assert must in names, must


def test_triangle_budget(built):
    r = built["report"]
    assert r["budget_problems"] == []
    assert r["triangles"]["total"] < B.TRI_BUDGET
    cat = B.catalogue_ids(json.loads(B.CATALOGUE.read_text(encoding="utf-8")))
    for obj, t in r["triangles"]["by_object"].items():
        lim = B.CLASS_BUDGET.get(cat[obj]["type"])
        assert lim is None or t <= lim, (obj, t, lim)
    assert r["triangles"]["nav"] < 20_000


def test_nothing_detailed_beyond_the_privacy_line(built):
    """Consent: shop + exterior. In the passage (beyond the shop's north wall) nothing past y = public_until_y, no
    courtyard detail; only open survey context (LoD2 roofs/walls, DGM ground) may extend there."""
    p = built["plan"]
    F = p.frame
    context = ("umgebung/nachbarhaeuser", "fassade/dach", "fassade/aussenwand", "umgebung/gelaende", "umgebung/strasse")
    for geo, skip in ((built["twin"], context), (built["nav"], ())):
        pts = np.concatenate([pp for n, items in geo.items() if not n.startswith(skip) for _, pp, _ in items])
        b = F.zone_to_b(pts)
        xo = np.array([p.north_outer_x(y) for y in b[:, 1]])
        in_passage = (b[:, 0] > xo + 0.05) & (b[:, 0] < p.passage_far_x + 0.3)
        beyond = in_passage & (b[:, 1] > p.passage_public_y + 0.02)
        assert not beyond.any(), f"{beyond.sum()} vertices in the private passage, e.g. {b[beyond][:3]}"
    # the walkable floor stays on the customer side of the counter inside the shop
    nb = F.zone_to_b(_pts(built["nav"], ["nav/floor"]))
    f1 = p.fixtures["F1"]
    from shapely.geometry import Point, Polygon
    room = Polygon([p.room[k] for k in p.room_order]).buffer(-0.05)
    inside = np.array([room.contains(Point(x, y)) for x, y in nb[:, :2]])
    side = (nb[inside, :2] - f1.xy) @ f1.uy
    assert (side <= 0.02).all(), "nav reaches behind the counter"


def test_nav_connects_street_porch_and_shop(built):
    from shapely import union_all
    from shapely.geometry import Point, Polygon
    p = built["plan"]
    F = p.frame
    tri = np.concatenate([pp[i] for _, pp, i in built["nav"]["nav/floor"]])
    U = union_all([Polygon(t[:, [0, 2]]) for t in tri if Polygon(t[:, [0, 2]]).area > 1e-8]).buffer(0.01)
    parts = geom.polys(U)
    # gable: the street in front of the south gable mural (a discoverable object), seen face-on from the floor
    spots = {"spawn": B.SPAWN_B, "porch": (23.1, 0.7), "shop": (22.6, 2.3), "gable": (-10.3, 0.7)}
    homes = []
    for name, xy in spots.items():
        z = F.zone(np.array([xy[0], xy[1], 0.0]))
        k = [i for i, q in enumerate(parts) if q.contains(Point(z[0], z[2]))]
        assert k, f"{name} not on the walkable floor"
        homes.append(k[0])
    assert len(set(homes)) == 1, "street, gable view, porch and shop are not one walkable area"
    # the floor height steps up the porch: 5 risers between street and shop floor
    assert max(np.ptp(tri[:, :, 1], axis=1)) < 1.0


def test_no_wall_or_fixture_stands_on_the_walkable_shop_floor(built):
    """The walker collides with nav.glb only: every vertical twin surface in the body band (0.6–1.5 m above the shop
    floor) must stay clear of the walkable floor shrunk by the body radius (0.18 m), the open door leaves included."""
    import shapely
    from shapely.geometry import Polygon
    p = built["plan"]
    F = p.frame
    tri = np.concatenate([pp[i] for _, pp, i in built["nav"]["nav/floor"]])
    floor = shapely.union_all([Polygon(t[:, [0, 2]]) for t in tri if Polygon(t[:, [0, 2]]).area > 1e-8])
    room = Polygon(F.zone(np.array([[*p.room[k], 0.0] for k in p.room_order]))[:, [0, 2]])
    free = floor.buffer(-0.18).intersection(room)
    assert free.area > 2.0
    skip = ("umgebung/", "fassade/dach")
    t = _tris(built["twin"], skip)
    n = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
    vert = np.abs(n[:, 1]) < 0.3 * np.linalg.norm(n, axis=1) + 1e-12
    lo, hi = F.z0 + 0.6, F.z0 + 1.5
    band = vert & (t[:, :, 1].max(1) > lo) & (t[:, :, 1].min(1) < hi)
    segs = shapely.linestrings(t[band][:, :, [0, 2]])
    hits = shapely.intersects(segs, free)
    assert not hits.any(), f"{hits.sum()} vertical triangles stand on the walkable floor, e.g. {t[band][hits][:1].round(2).tolist()}"


def test_deterministic(built, tmp_path):
    B.build(tmp_path)
    for f in ("twin.glb", "nav.glb"):
        assert (tmp_path / f).read_bytes() == (built["out"] / f).read_bytes(), f


def test_scale_factor_moves_interior_not_survey(built, tmp_path):
    f = 1.1
    B.build(tmp_path, factor=f)
    g = node_geometry(*read_glb((tmp_path / "twin.glb").read_bytes()))
    F = built["plan"].frame
    piv = built["plan"].pivot
    for node in ("verkaufsraum/boden", "verkaufsraum/rasterdecke", "theke/sockel"):
        a = F.zone_to_b(_pts(built["twin"], [node]))
        b = F.zone_to_b(_pts(g, [node]))
        for agg in (np.min, np.max):  # extent scales about the pivot (xy) and about ±0.00 (z)
            want = np.r_[piv + f * (agg(a[:, :2], 0) - piv), f * agg(a[:, 2])]
            assert np.allclose(want, np.r_[agg(b[:, :2], 0), agg(b[:, 2])], atol=2e-3), node
    for survey in ("fassade/dach",):
        assert np.array_equal(np.sort(_pts(built["twin"], [survey]), 0), np.sort(_pts(g, [survey]), 0)), survey


def test_product_slots(built):
    """Slots come from the same fixture parameters as the geometry, pass the catalogue check, and the committed
    catalogue/slots.json is the current build's (run.sh --update-catalogue)."""
    sys.path.insert(0, str(B.ZONE / "catalogue"))
    from check import check_slots
    doc = json.loads((built["out"] / "slots.json").read_text(encoding="utf-8"))
    cat = B.catalogue_ids(json.loads(B.CATALOGUE.read_text(encoding="utf-8")))
    assert check_slots(doc, set(cat)) == []
    count: dict[str, int] = {}
    for s in doc["slots"]:
        count[s["fixture"]] = count.get(s["fixture"], 0) + 1
    want = {"theke/vitrine/ebene-1": 6, "theke/vitrine/ebene-2": 6, "theke/vitrine/ebene-3": 8, "theke/brezelstaender": 10,
            "brotregal/ebene-1": 14, "brotregal/ebene-2": 15, "brotregal/ebene-3": 14, "gitterregal": 5, "dosenregal": 13,
            "getraenkekuehlschrank": 5, "wuerfelregal": 8}
    want.update({f"brotregal/koerbe/korb-{k}": 1 for k in range(1, 7)})
    assert count == want
    # every slot lies inside its fixture's catalogue footprint (zone frame, generous: σ of the parts)
    F = built["plan"].frame
    for s in doc["slots"]:
        b = F.zone_to_b(np.array([[s["pose"]["x"], s["pose"]["y"], s["pose"]["z"]]]))[0]
        assert 0.0 <= b[2] <= 2.0, s["id"]
    assert not any(n.startswith("verkaufsraum/slot-marker") for n in built["twin"]), "debug slot markers in a normal build"
    committed = B.SLOTS
    if committed.is_file():
        assert committed.read_text(encoding="utf-8") == (built["out"] / "slots.json").read_text(encoding="utf-8"), \
            "catalogue/slots.json is stale: run build/run.sh --update-catalogue"


def test_facade_round_3b(built):
    """Facade details are built; the shop lettering is on by default (owners' OK, ADR 0044); nothing of the pickup cabinet (its place is
    in the private part of the passage)."""
    names = set(built["twin"])
    for must in ("fassade/glasbausteine", "fassade/fenstergewaende", "fassade/schlussstein-1", "fassade/schlussstein-2",
                 "fassade/wandmalerei", "fassade/obergeschoss-fenster", "fassade/fenster-rollladen", "fassade/fallrohr",
                 "fassade/ausleger-schild", "fassade/handlauf", "fassade/dach/schiefer"):
        assert must in names, must
    assert [n for n in names if n.endswith("/schrift")], "lettering is on by default (ADR 0044)"
    assert built["report"]["lettering"] is True
    assert not [n for n in names if n.startswith("fassade/abholschrank")]
    # the SSW end is a gable now: the end wall reaches the ridge
    p = built["plan"]
    b = p.frame.zone_to_b(_pts(built["twin"], ["fassade/aussenwand"]))
    end = b[b[:, 0] < 0.1]
    assert end[:, 2].max() > p.raw["site"]["building"]["eaves"]["v"] + 3.0


# ----------------------------------------------------------------------------------------------- products (round 4b)

def _slots(built) -> dict:
    return {s["id"]: s for s in json.loads((built["out"] / "slots.json").read_text(encoding="utf-8"))["slots"]}


def test_products_in_the_shop(built):
    """The default fill (morgens) is placed: one node `produkt/<slot id>` per filled slot with extras {id: slot id,
    product|ware, count}, every piece within the per-instance budgets, the whole twin under the budget."""
    fill = json.loads((B.FILLS / f"{B.DEFAULT_FILL}.json").read_text(encoding="utf-8"))
    prods = {p["id"] for p in json.loads(B.PRODUCTS.read_text(encoding="utf-8"))["products"]}
    nodes = {n["name"]: n for n in built["doc"]["nodes"] if n["name"].startswith(B.PRODUCT_NODE)}
    assert sorted(nodes) == sorted(B.PRODUCT_NODE + k for k in fill["slots"])
    for name, n in nodes.items():
        sid = name[len(B.PRODUCT_NODE):]
        e, ex = fill["slots"][sid], n["extras"]
        assert ex["id"] == sid and ex["count"] == e["count"]
        assert ex["fills"] == [B.DEFAULT_FILL]                       # feierabend is empty: morning nodes only
        assert ("product" in ex) != ("ware" in ex)
        assert ex.get("product", ex.get("ware")) == e.get("product", e.get("ware"))
        if "product" in ex:
            assert ex["product"] in prods
    r = built["report"]
    assert r["fill"]["id"] == B.DEFAULT_FILL and r["fill"]["slots"] == len(fill["slots"])
    assert r["triangles"]["total"] < 250_000


def test_products_rest_on_their_slots(built):
    """Each product node's geometry stays inside its slot box (slot frame, small tolerance for tilt and jitter):
    nothing floats above the surface or sinks through it; pretzels hang below the stand's arms."""
    import math
    slots = _slots(built)
    for name, items in built["twin"].items():
        if not name.startswith(B.PRODUCT_NODE):
            continue
        s = slots[B.product_slot(name)]
        pts = np.concatenate([p.reshape(-1, 3) for _, p, _ in items])
        h, t = math.radians(s["pose"]["heading_deg"]), math.radians(s.get("tilt_deg", 0.0))
        f = np.array([math.sin(h), 0.0, -math.cos(h)])
        up = np.array([0.0, 1.0, 0.0])
        n = up * math.cos(t) + f * math.sin(t)
        ft = f * math.cos(t) - up * math.sin(t)
        M = np.column_stack([np.cross(n, ft), n, ft])
        loc = (pts - np.array([s["pose"]["x"], s["pose"]["y"], s["pose"]["z"]])) @ M
        W, D, H = s["size"]["w"], s["size"]["d"], s["size"]["h"]
        tol = 0.012
        if s["fixture"] == "theke/brezelstaender":
            assert loc[:, 1].max() <= H + 0.05 and loc[:, 1].min() >= -0.05, name
            continue
        assert loc[:, 1].min() >= -tol, (name, loc[:, 1].min())                 # not below the surface
        assert loc[:, 1].min() <= 0.03, (name, loc[:, 1].min())                 # standing on it, not floating
        assert loc[:, 1].max() <= H + tol, (name, loc[:, 1].max())
        assert np.abs(loc[:, 0]).max() <= W / 2 + tol, (name, np.abs(loc[:, 0]).max())
        assert np.abs(loc[:, 2]).max() <= D / 2 + tol, (name, np.abs(loc[:, 2]).max())


def test_visitor_catalogue_file(built):
    """built/catalogue.json (sle-zone-catalogue-v1): objects = built rows with info_de, products with prices
    (consent), discoverable = placed products + curated objects; the fragment references it."""
    sys.path.insert(0, str(HERE.parents[2] / "pipeline"))
    import zones as Z
    doc = json.loads((built["out"] / "catalogue.json").read_text(encoding="utf-8"))
    assert Z.validate_catalogue(doc) == []
    assert doc["schema"] == B.CATALOGUE_FORMAT and doc["consent"] == {"prices": True}
    fill = json.loads((B.FILLS / f"{B.DEFAULT_FILL}.json").read_text(encoding="utf-8"))
    placed = {e["product"] for e in fill["slots"].values() if "product" in e}
    assert placed <= set(doc["discoverable"]) and placed <= set(doc["products"])
    curated = [d for d in doc["discoverable"] if d in doc["objects"]]
    assert 12 <= len(curated) <= 24
    assert all(o["info_de"] for o in doc["objects"].values())
    # enclosing rows (facade, room shell: clickable false) are never cards and never groups — a facade detail
    # grouped under `fassade` resolved to the facade from everywhere on the floor (group wins beyond 2.5 m)
    rows = {o["id"]: o for o in json.loads(B.CATALOGUE.read_text(encoding="utf-8"))["objects"]}
    assert "fassade" not in doc["objects"] and "verkaufsraum" not in doc["objects"]
    assert all(rows[oid].get("clickable") is not False for oid in doc["objects"])
    assert all(o["group"] in doc["objects"] and rows[o["group"]].get("clickable") is not False
               for o in doc["objects"].values() if "group" in o)
    for oid in ("fassade/wandmalerei", "fassade/glasbausteine", "fassade/schlussstein-1", "fassade/ausleger-schild"):
        assert oid in doc["discoverable"] and "group" not in doc["objects"][oid]
    names ={n["name"] for n in built["doc"]["nodes"]}
    assert all(any(n == oid or n.startswith(oid + "/") for n in names) for oid in doc["objects"]), "object not built"
    frag = json.loads((built["out"] / "package.json").read_text(encoding="utf-8"))
    assert frag["twin"]["catalogue"] == B.CATALOGUE_PATH
    assert {"raw": "catalogue.json", "path": B.CATALOGUE_PATH} in frag["files"]


def test_catalogue_fills(built):
    """Both fills are packed: the catalogue names the states (morgens first and default), each with its products;
    discoverable stays the union (apps without the toggle)."""
    cat = json.loads((built["out"] / "catalogue.json").read_text(encoding="utf-8"))
    fills = cat["fills"]
    assert fills["default"] == B.DEFAULT_FILL
    states = {s["id"]: s for s in fills["states"]}
    assert [s["id"] for s in fills["states"]][0] == B.DEFAULT_FILL and set(states) == {"morgens", "feierabend"}
    assert states["morgens"]["name_de"] == "Morgens" and states["feierabend"]["name_de"] == "Feierabend"
    assert states["feierabend"]["products"] == [] and all(s["info_de"] for s in states.values())
    disc_products = [d for d in cat["discoverable"] if d in cat["products"]]
    assert states["morgens"]["products"] == disc_products
    assert built["report"]["fills"]["feierabend"] == {"slots": 0, "pieces": 0}


def test_fill_feierabend_first(tmp_path):
    """`--fill feierabend` starts the visit in the empty shop; the morning products are still packed (toggle)."""
    B.build(tmp_path, fill="feierabend")
    doc, _ = read_glb((tmp_path / "twin.glb").read_bytes())
    prods = [n for n in doc["nodes"] if n["name"].startswith(B.PRODUCT_NODE)]
    assert prods and all(n["extras"]["fills"] == ["morgens"] for n in prods)
    cat = json.loads((tmp_path / "catalogue.json").read_text(encoding="utf-8"))
    assert cat["fills"]["default"] == "feierabend" and [s["id"] for s in cat["fills"]["states"]] == ["feierabend", "morgens"]
