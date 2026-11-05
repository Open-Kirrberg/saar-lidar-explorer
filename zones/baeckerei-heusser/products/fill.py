#!/usr/bin/env python3
"""Product fills (`bh-fill-v1`): which product, or which generic shelf good, stands in which slot of the twin, and
how many. Stdlib only.

    python3 -I zones/baeckerei-heusser/products/fill.py                 # check every fill in fill/
    python3 -I zones/baeckerei-heusser/products/fill.py morgens          # one fill (name or path)

A fill maps slot ids (catalogue/slots.json) to `{"product": <products.json id>, "count": n}` or, for the shop's
other goods that are not on the bakery's product list (jars, cans, drinks, cups, paper bags), to
`{"ware": <WAREN id>, "count": n}`: generic shapes without brands. `layout()` turns a slot + item size + count into
piece positions; the checker and the generator (build/bh_twin/auslage.py) both use it, so a fill that passes the
check is exactly what gets built: every piece inside its slot, none overlapping, none taller than the clear height.

`check_fill(fill, slots, products)` is the tested pure function (tests/test_fill.py).
"""
from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ZONE = HERE.parent
FILLS = HERE / "fill"
PRODUCTS = HERE / "products.json"
SLOTS = ZONE / "catalogue" / "slots.json"
FORMAT = "bh-fill-v1"
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

# products.json category -> slot category (catalogue/slots.json `categories`)
CATEGORY_SLOT = {"brot": "brot", "baguette": "brot", "broetchen": "broetchen", "snacks": "laugengebaeck",
                 "teilchen": "suesses", "kuchen": "kuchen", "torten": "kuchen"}

# Generic goods on the shop's other shelves (inventory from the walkthrough video; no brands, no labels, no prices).
# size_m = [w, d, h] like products.json (w = longest horizontal extent); shapes in waren.py.
WAREN = {
    "glas-honig": {"name_de": "Honigglas", "category": "glas", "size_m": [0.075, 0.075, 0.10], "shape": "glas"},
    "glas-marmelade": {"name_de": "Marmeladenglas", "category": "glas", "size_m": [0.068, 0.068, 0.09], "shape": "glas"},
    "glas-hoch": {"name_de": "Hohes Glas", "category": "glas", "size_m": [0.065, 0.065, 0.16], "shape": "glas"},
    "glas-klein": {"name_de": "Kleines Glas", "category": "glas", "size_m": [0.055, 0.055, 0.07], "shape": "glas"},
    "dose": {"name_de": "Dose", "category": "dose", "size_m": [0.095, 0.095, 0.06], "shape": "dose"},
    "kaffee": {"name_de": "Kaffeepackung", "category": "tuete", "size_m": [0.095, 0.065, 0.20], "shape": "packung"},
    "flasche": {"name_de": "Getränkeflasche", "category": "flasche", "size_m": [0.064, 0.064, 0.225], "shape": "flasche"},
    "flasche-sirup": {"name_de": "Sirupflasche", "category": "flasche", "size_m": [0.07, 0.07, 0.25], "shape": "flasche"},
    "becher": {"name_de": "Kaffeebecher", "category": "glas", "size_m": [0.11, 0.085, 0.10], "shape": "becher"},
    "brottuete": {"name_de": "Brot in der Papiertüte", "category": "tuete", "size_m": [0.15, 0.10, 0.30], "shape": "tuete"},
    "gebaecktueten": {"name_de": "Gebäcktüte", "category": "tuete", "size_m": [0.12, 0.08, 0.20], "shape": "gebaecktuete"},
}

GAP = 0.006          # between pieces (m)
TOL = 0.02           # a single piece may overhang its slot this much (loaf ends over a rod tier's edge)
HEAP_RISE = 0.55     # heaped baskets: a layer rests this share of a piece's height above the one below
HEAP_SQUEEZE = 0.9   # heaped rolls may be up to 10 % smaller than their product size (the generator shrinks them)
MAX_PER_CAPACITY = 3  # sanity: never more than 3 × the slot's capacity hint


def slot_mode(slot: dict, item: dict) -> str:
    """How pieces sit in a slot: `hang` (pretzel stand: on an arm), `heap` (rolls in a basket: a nested pyramid),
    `stack` (cans: two high), `rows` (everything else: one layer, front row first)."""
    fx = slot.get("fixture", "")
    if fx == "theke/brezelstaender":
        return "hang"
    if "/koerbe/" in fx + "/":
        return "heap"
    if item.get("category") == "dose":
        return "stack"
    return "rows"


def _grid(W: float, D: float, a: float, b: float) -> tuple[int, int]:
    nx = int(math.floor((W + GAP) / (a + GAP) + 1e-9))
    ny = int(math.floor((D + GAP) / (b + GAP) + 1e-9))
    return nx, ny


def layout(slot: dict, size, count: int, mode: str):
    """Piece positions in the slot's frame: list of (u, v, base, turned) with u = across (customer's right, from the
    slot centre), v = depth (+ = back), base = height of the piece's foot above the standing surface, turned = the
    piece's long side runs front to back. Also returns the cell (cw, cd) every piece must fit. Raises ValueError when
    the pieces do not fit."""
    w, d, h = (float(x) for x in size)
    W, D, Hc = float(slot["size"]["w"]), float(slot["size"]["d"]), float(slot["size"]["h"])
    if count < 1:
        raise ValueError("count must be >= 1")
    if mode == "hang":
        if count != 1:
            raise ValueError("a hanging slot holds one piece")
        if w > W + 0.06:
            raise ValueError(f"piece {w:.3f} m wide, the arm slot takes {W + 0.06:.3f}")
        return [(0.0, 0.0, 0.0, False)], (W + 0.06, d)
    best = None
    sq = HEAP_SQUEEZE if mode == "heap" else 1.0
    for turned, (a, b) in ((False, (w * sq, d * sq)), (True, (d * sq, w * sq))):
        if count == 1 and a <= W + TOL and b <= D + TOL:
            nx, ny = 1, 1
        else:
            nx, ny = _grid(W, D, a, b)
        if nx < 1 or ny < 1:
            continue
        cap = nx * ny
        if mode == "heap":
            cap += sum(max(0, nx - k) * max(0, ny - k) for k in (1, 2) if (1 + k * HEAP_RISE) * h <= Hc + 1e-9)
        elif mode == "stack":
            cap *= max(1, min(2, int((Hc + 1e-9) // h)))
        key = (cap >= count, cap, not turned)
        if best is None or key > best[0]:
            best = (key, turned, a, b, nx, ny, cap)
    if best is None or not best[0][0]:
        raise ValueError(f"{count} pieces of {w:.3f}×{d:.3f} m do not fit {W:.3f}×{D:.3f} m"
                         + (f" (room for {best[6]})" if best else ""))
    _, turned, a, b, nx, ny, _ = best
    if h > Hc + 0.01:
        raise ValueError(f"piece {h:.3f} m tall, clear height {Hc:.3f} m")
    out = []
    if count == 1 and nx == 1 and ny == 1:
        return [(0.0, 0.0, 0.0, turned)], (max(a, W), max(b, D))
    # first layer: rows from the front, items spread evenly across; deeper rows only when needed
    first = min(count, nx * ny)
    rows = int(math.ceil(first / nx))
    per = [first // rows + (1 if r < first % rows else 0) for r in range(rows)]
    cd = (D - (rows - 1) * GAP) / rows if rows == ny else b
    for r, k in enumerate(per):
        v = -D / 2 + cd / 2 + r * (cd + GAP) if rows == ny else -D / 2 + b / 2 + r * (b + GAP)
        cw = W / k
        for i in range(k):
            out.append((-W / 2 + (i + 0.5) * cw, v, 0.0, turned))
    cell = (W / max(per), cd)
    left = count - first
    if left and mode == "heap":
        # the first layer is the full grid; each upper layer sits in the hollows, offset by half a cell
        for layer in (1, 2):
            mx, my = nx - layer, ny - layer
            if mx < 1 or my < 1 or left <= 0 or (1 + layer * HEAP_RISE) * h > Hc + 1e-9:
                break
            k = 0
            for j in range(my):
                for i in range(mx):
                    if k >= left:
                        break
                    u = -W / 2 + (i + 0.5 + layer / 2) * W / nx
                    v = -D / 2 + cd / 2 + (j + layer / 2) * (cd + GAP)
                    out.append((u, v, layer * HEAP_RISE * h, turned))
                    k += 1
            left -= k
    elif left and mode == "stack":
        for p in list(out)[:left]:
            out.append((p[0], p[1], h, turned))
        left = 0
    if left > 0:
        raise ValueError(f"{count} pieces do not fit")
    return out, cell


# ----------------------------------------------------------------------------------------------- data


def load_json(p: Path) -> dict:
    return json.loads(Path(p).read_text(encoding="utf-8"))


def fill_path(name: str) -> Path:
    p = Path(name)
    return p if p.suffix == ".json" else FILLS / f"{name}.json"


def item_of(entry: dict, products: dict[str, dict]) -> dict | None:
    """The product or good of a fill entry as {id, kind, name_de, category (slot category), size_m, shape}."""
    if "product" in entry:
        p = products.get(entry["product"])
        if p is None:
            return None
        return {"id": p["id"], "kind": "product", "name_de": p["name_de"], "category": CATEGORY_SLOT.get(p["category"]),
                "size_m": p["size_m"], "shape": p["shape"]}
    g = WAREN.get(entry.get("ware"))
    if g is None:
        return None
    return {"id": entry["ware"], "kind": "ware", **g}


def check_fill(fill: dict, slots: dict, products: dict) -> list[str]:
    """fill (`bh-fill-v1`), slots (`bh-slots-v1` doc), products (`bh-products-v1` doc) -> problems."""
    errs: list[str] = []
    if not isinstance(fill, dict) or fill.get("format") != FORMAT:
        return [f"format must be {FORMAT!r}"]
    if not (isinstance(fill.get("id"), str) and ID_RE.match(fill["id"])):
        errs.append("id must be lower-case a-z0-9-")
    for k in ("name_de", "info_de"):
        if not isinstance(fill.get(k), str) or not fill[k].strip() or len(fill[k]) > (40 if k == "name_de" else 300):
            errs.append(f"{k} must be a non-empty string ({'≤ 40' if k == 'name_de' else '≤ 300'} chars)")
    by_slot = {s["id"]: s for s in slots.get("slots", [])}
    prods = {p["id"]: p for p in products.get("products", [])}
    entries = fill.get("slots")
    if not isinstance(entries, dict):
        return errs + ["slots must be an object {slot id: {product|ware, count}}"]
    for sid, e in entries.items():
        bad = lambda msg: errs.append(f"{sid}: {msg}")  # noqa: E731
        s = by_slot.get(sid)
        if s is None:
            bad("not a slot in catalogue/slots.json")
            continue
        if not isinstance(e, dict) or len([k for k in ("product", "ware") if k in e]) != 1 or set(e) - {"product", "ware", "count"}:
            bad("entry must be {product: id, count: n} or {ware: id, count: n}")
            continue
        n = e.get("count")
        if not (isinstance(n, int) and not isinstance(n, bool) and n >= 1):
            bad("count must be an integer >= 1")
            continue
        it = item_of(e, prods)
        if it is None:
            bad(f"unknown {'product' if 'product' in e else 'ware'} {e.get('product', e.get('ware'))!r}")
            continue
        if it["category"] not in s["categories"]:
            bad(f"{it['id']} ({it['category']}) is not allowed here ({', '.join(s['categories'])})")
        if n > MAX_PER_CAPACITY * int(s["capacity"]):
            bad(f"count {n} > {MAX_PER_CAPACITY} × capacity {s['capacity']}")
        try:
            pos, _ = layout(s, it["size_m"], n, slot_mode(s, it))
            if len(pos) != n:
                bad(f"layout gave {len(pos)} pieces for count {n}")
        except ValueError as err:
            bad(f"{it['id']} × {n}: {err}")
    for path_key in _price_keys(fill):
        errs.append(f"{path_key}: no prices in a fill (they live in products.json)")
    return errs


def _price_keys(obj, path=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            here = f"{path}.{k}" if path else k
            if re.search(r"(price|preis)", k, re.I):
                yield here
            yield from _price_keys(v, here)


def summary(fill: dict, products: dict) -> dict:
    """Pieces and categories of a fill (for the CLI and the README)."""
    prods = {p["id"]: p for p in products.get("products", [])}
    cats: dict[str, int] = {}
    pieces = 0
    for e in fill.get("slots", {}).values():
        it = item_of(e, prods)
        if it is None:
            continue
        key = prods[it["id"]]["category"] if it["kind"] == "product" else f"ware:{it['category']}"
        cats[key] = cats.get(key, 0) + e["count"]
        pieces += e["count"]
    return {"slots": len(fill.get("slots", {})), "pieces": pieces, "products": len({e["product"] for e in fill.get("slots", {}).values() if "product" in e}),
            "by_category": dict(sorted(cats.items()))}


def main(argv: list[str]) -> int:
    names = argv or sorted(p.stem for p in FILLS.glob("*.json"))
    slots, products = load_json(SLOTS), load_json(PRODUCTS)
    rc = 0
    for name in names:
        path = fill_path(name)
        fill = load_json(path)
        errs = check_fill(fill, slots, products)
        for m in errs:
            print("  ✗", m)
        sm = summary(fill, products)
        print(f"{path.name}: {sm['slots']} slots, {sm['pieces']} pieces, {sm['products']} products, "
              f"{'OK' if not errs else f'{len(errs)} problem(s)'}")
        rc |= bool(errs)
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
