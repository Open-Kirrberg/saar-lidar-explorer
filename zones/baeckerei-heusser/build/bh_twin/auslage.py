"""Products in the shop (round 4b): a fill (`products/fill/<name>.json`, `bh-fill-v1`) placed into the product slots
(`catalogue/slots.json`).

One node per filled slot, named `produkt/<slot id>`, extras `{id: <slot id>, product: <product id>, count: n}` (or
`ware: <good id>` for the generic goods on the other shelves: they have no product card, their slot's fixture is the
clickable object). Piece positions come from `products/fill.layout` (the checker uses the same function): every piece
stands on its slot's surface (tilted with sloped rod tiers and baskets), inside its cell, below the clear height.
After the deterministic variation of `shapes.build` a piece that would leave its cell is rebuilt without the turn,
then scaled down to fit. Heaped baskets use the low-triangle rolls (`products/waren.low`), pretzels hang on the arms
of the pretzel stand through one of their loops, multi-piece rows in the display stand on a black tray. A product
in a slot with a price rail (`Scene.price_cards`, the two lower bread tiers) also gets its white price card with the
name and the price from products.json (ADR 0044) in the same node: the card comes and goes with the product.
"""
from __future__ import annotations

import hashlib
import math
import random

import numpy as np

from . import geom
from .scene import Scene

TRAY_H = 0.008          # black display trays under rows of pieces in the counter's display
HANG_GAP = 0.004        # between neighbouring pretzels on one arm
CARD_W, CARD_H = 0.10, 0.065   # white price card clipped into a bread tier's price rail (2026 photo: ≈ 0.10 × 0.06)
CARD_MAT, CARD_INK = "preiskarte", "preisschrift"   # own tokens: the card is not part of the product's slot box


def _mods():
    import fill as FL  # noqa: PLC0415  (products/, on sys.path via build.py)
    import shapes as S  # noqa: PLC0415
    import waren as W  # noqa: PLC0415
    return FL, S, W


def slot_basis(slot: dict) -> np.ndarray:
    """Columns = the slot's right (customer's view), the surface normal (tilt: + = back edge up), its front, in the
    zone frame (x = E, y = up, z = −N). Product parts (x = width, y = up, +z = towards the visitor) map onto it."""
    h = math.radians(slot["pose"]["heading_deg"])
    t = math.radians(slot.get("tilt_deg", 0.0))
    f = np.array([math.sin(h), 0.0, -math.cos(h)])
    up = np.array([0.0, 1.0, 0.0])
    n = up * math.cos(t) + f * math.sin(t)
    ft = f * math.cos(t) - up * math.sin(t)
    return np.column_stack([np.cross(n, ft), n, ft])


def add_parts(node: geom.Node, parts, M: np.ndarray, origin, S) -> int:
    """shapes.add_to_node with a full rotation M (columns = where local x, y, z go) instead of a heading."""
    lo, hi = S.bbox(parts)
    h = float(hi[1] - lo[1])
    tri = 0
    for q in parts:
        q = S.compact(q)
        v = q.v @ M.T + np.asarray(origin, np.float64)
        ao = S.contact_ao(q.v[:, 1] - lo[1], h) * (1.0 if q.ao is None else q.ao)
        if q.nrm is None:
            fn = np.repeat(S.face_normals(q), 3, axis=0) @ M.T
            node.add(q.mat, v[q.t].reshape(-1, 3), np.arange(3 * len(q.t)).reshape(-1, 3), fn, ao[q.t].reshape(-1))
        else:
            nrm = np.where((np.linalg.norm(q.nrm, axis=1) < 1e-9)[:, None], S.Y, q.nrm)
            node.add(q.mat, v, q.t, nrm @ M.T, ao)
        tri += len(q.t)
    return tri


def _slot_seed(sid: str) -> int:
    return int.from_bytes(hashlib.sha256(sid.encode()).digest()[:4], "big") % 997


def _pretzel_hole(parts, S) -> tuple[float, float, float]:
    """(x, z of the top of the largest loop, half its width) in the pretzel's local frame (from its silhouette)."""
    from shapely import union_all
    from shapely.geometry import Polygon
    tri = np.concatenate([q.v[q.t] for q in parts])
    sil = union_all([Polygon(t[:, [0, 2]]) for t in tri if Polygon(t[:, [0, 2]]).area > 1e-10]).buffer(0.0005)
    holes = [Polygon(r) for g in getattr(sil, "geoms", [sil]) for r in g.interiors]
    if not holes:
        lo, hi = S.bbox(parts)
        return 0.0, float(lo[2] + 0.25 * (hi[2] - lo[2])), 0.01
    hole = max(holes, key=lambda p: p.area)
    c = hole.representative_point()
    x0, z0, x1, z1 = hole.bounds
    return float(c.x), float(z0), float(x1 - x0) / 2


def place(sc: Scene, fill: dict, slots_doc: dict, products_doc: dict, anchors: dict | None = None,
          names: dict[str, str] | None = None) -> dict:
    """Build every filled slot as a node `produkt/<slot id>` (or `names[slot id]`: a fill variant of the same slot,
    `produkt/<slot id>@<fill>`); returns {slot id: {item, count, triangles, max_piece}}."""
    FL, S, W = _mods()
    F = sc.F
    anchors = anchors or {}
    by_slot = {s["id"]: s for s in slots_doc["slots"]}
    prods = {p["id"]: p for p in products_doc["products"]}
    out: dict[str, dict] = {}
    for sid, e in sorted(fill.get("slots", {}).items()):
        s = by_slot[sid]
        it = FL.item_of(e, prods)
        n = int(e["count"])
        mode = FL.slot_mode(s, it)
        tray = s["fixture"].startswith("theke/vitrine/ebene-") and s["fixture"] != "theke/vitrine/ebene-3" and n >= 4
        sl = dict(s, size=dict(s["size"], h=s["size"]["h"] - (TRAY_H if tray else 0.0)))
        pos, cell = FL.layout(sl, it["size_m"], n, mode)
        M = slot_basis(s)
        pose = np.array([s["pose"]["x"], s["pose"]["y"], s["pose"]["z"]])
        node = sc.node((names or {}).get(sid, f"produkt/{sid}"), "int", sid, source="plan", sigma=0.1)
        node.extras.update({"product": it["id"]} if it["kind"] == "product" else {"ware": it["id"]})
        node.extras["count"] = n
        rng = random.Random(_slot_seed(sid) * 7919 + 17)
        tris, worst = 0, 0
        lift = 0.0
        if tray:
            W_, D_ = s["size"]["w"] - 0.01, s["size"]["d"] - 0.01
            tris += add_parts(node, S.box(-W_ / 2, W_ / 2, 0.0, TRAY_H, -D_ / 2, D_ / 2, 0.003, "lack-schwarz"), M, pose, S)
            lift = TRAY_H
        base_idx = _slot_seed(sid) * 100
        for k, (u, v, base, turned) in enumerate(pos):
            idx = base_idx + k

            def make(vary: bool):
                if it["kind"] == "ware":
                    return W.ware(it["id"], idx)
                return W.low(prods[it["id"]], idx, vary) if mode == "heap" else S.build(prods[it["id"]], idx, vary)

            parts = make(True)
            if turned:
                parts = S.transform(parts, S.rot_y(90.0))
            if mode == "hang":
                tris_k = _hang(node, parts, s, anchors, k, S)
                tris += tris_k
                worst = max(worst, tris_k)
                continue
            avail_h = sl["size"]["h"] - base
            cw, cd = cell

            def ext(ps):
                lo, hi = S.bbox(ps)
                return hi - lo

            e3 = ext(parts)
            if e3[0] > cw or e3[2] > cd or e3[1] > avail_h:
                parts = make(False)
                if turned:
                    parts = S.transform(parts, S.rot_y(90.0))
                e3 = ext(parts)
            sc_ = min(1.0, cw / e3[0], cd / e3[2], avail_h / e3[1])
            if sc_ < 1.0:
                parts = S.transform(parts, np.eye(3) * sc_)
                e3 = e3 * sc_
            lo, hi = S.bbox(parts)
            ju = rng.uniform(-1, 1) * max(0.0, cw - e3[0]) * 0.3
            jv = rng.uniform(-1, 1) * max(0.0, cd - e3[2]) * 0.3
            if mode == "rows" and n == 1 and s.get("tilt_deg", 0.0) > 5.0:
                v, jv = -sl["size"]["d"] / 2 + 0.004 + e3[2] / 2, 0.0     # slid down against the front rail
            ctr = np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])
            local = np.array([u + ju, base + lift, -(v + jv)]) - ctr
            tk = add_parts(node, S.transform(parts, np.eye(3), local), M, pose, S)
            tris += tk
            worst = max(worst, tk)
        card = getattr(sc, "price_cards", {}).get(sid)
        price = prods[it["id"]].get("price_eur") if it["kind"] == "product" else None
        if card is not None and price is not None:
            tris += price_card(node, card, prods[it["id"]]["name_de"], float(price))
        out[sid] = {"item": it["id"], "kind": it["kind"], "count": n, "triangles": tris, "max_piece": worst,
                    "shape": it["shape"], "low": mode == "heap"}
    return out


def price_label(eur: float) -> str:
    """German price text: 4.4 -> '4,40 €'. Pure."""
    if not (isinstance(eur, (int, float)) and math.isfinite(eur) and eur >= 0):
        raise ValueError(f"bad price {eur!r}")
    return f"{eur:.2f}".replace(".", ",") + " €"


def price_card(node: geom.Node, frame: np.ndarray, name_de: str, eur: float) -> int:
    """A white card (CARD_W × CARD_H, hanging down from frame's origin) with the product name and its price in black,
    facing the frame's `front` (rows of `frame`: origin, right, up, front; zone frame). Returns the triangle count."""
    from . import lettering  # noqa: PLC0415  (matplotlib only when a card is drawn)
    o, r, u, f = (np.asarray(x, np.float64) for x in frame)

    def to3d(v2, w):
        return o + v2[:, :1] * r + v2[:, 1:2] * u + w * f

    tris = 0
    card = geom.rect(-CARD_W / 2, -CARD_H, CARD_W / 2, 0.0)
    lines = [(name_de, 0.0075, -0.024, 0.0005, {"family": "DejaVu Sans"}), (price_label(eur), 0.014, -0.053, 0.0006, None)]
    for shape, mat, w in [(card, CARD_MAT, 0.0)] + [(_fit(lettering.text_polys(t, h, font, tol), CARD_W - 0.012, base), CARD_INK, 0.0008)
                                                         for t, h, base, tol, font in lines]:
        for v2, t in geom.triangulate(shape):
            v3 = to3d(v2, w)
            t = geom.wind(v3, t, f)
            node.add(mat, v3, t, f)
            tris += len(t)
    return tris


def _fit(shape, width: float, base: float):
    """Scale a text outline (baseline y = 0, centred) down to `width` if wider, then move its baseline to `base`."""
    from shapely import affinity  # noqa: PLC0415
    x0, _, x1, _ = shape.bounds
    k = min(1.0, width / max(x1 - x0, 1e-9))
    return affinity.translate(affinity.scale(shape, k, k, origin=(0, 0)), 0.0, base)


def _hang(node, parts, s: dict, anchors: dict, k: int, S) -> int:
    """A pretzel on the stand's arm: belly down, thickness along the arm, the arm through the top of its biggest loop."""
    pole = anchors.get(s["fixture"])
    pose = np.array([s["pose"]["x"], s["pose"]["y"], s["pose"]["z"]])
    arm = np.array([pose[0] - pole[0], 0.0, pose[2] - pole[2]]) if pole is not None else np.array([1.0, 0.0, 0.0])
    arm /= max(np.linalg.norm(arm), 1e-9)
    up = np.array([0.0, 1.0, 0.0])
    M = np.column_stack([np.cross(arm, -up), arm, -up])          # local x ⟂ arm, y along the arm, +z (belly) down
    lo, hi = S.bbox(parts)
    th = float(hi[1] - lo[1])
    lim = float(s["size"]["d"]) - HANG_GAP                      # slot d = spacing along the arm (fixtures.py)
    if th > lim:
        parts = S.transform(parts, np.eye(3) * (lim / th))
        lo, hi = S.bbox(parts)
    hx, hz_top, _ = _pretzel_hole(parts, S)
    arm_r = 0.011
    anchor = pose + up * (float(s["size"]["h"]) + 0.02)          # the arm's axis (fixtures.py: slot = 0.14 below it)
    hook = np.array([hx, (lo[1] + hi[1]) / 2, hz_top + arm_r + 0.002])
    origin = anchor - M @ hook
    return add_parts(node, parts, M, origin, S)
