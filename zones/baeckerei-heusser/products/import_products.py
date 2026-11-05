"""Import the bakery's product list (hq `products/*.md`) into `products.json` for the twin.

    python3 -I zones/baeckerei-heusser/products/import_products.py <products-dir> [--out FILE]

The source folder holds one Markdown file per product: a YAML-ish front matter (id, numeric_id, name, category,
price, available, seasonal, short_description, …) and a body (`# Name` + paragraphs). The files are parsed as text,
never executed; stdlib only. Allergen fields and image paths are deliberately NOT imported (allergen data stays out
until the owners confirm it is complete). Output is deterministic: sorted by numeric_id, byte-identical on rerun, no
absolute paths or timestamps.

Per product the importer also picks the shape recipe (`shapes.py`) with its parameters and a true-size estimate
(`size_m` = [w, d, h] in metres, `sigma_m` = 1-σ), from the product id (rule table below) with a per-category
fallback for products it does not know yet (`shape_guess: true`).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

SCHEMA = "bh-products-v1"
SOURCE = "hq-products"
CATEGORIES = ("brot", "baguette", "broetchen", "snacks", "teilchen", "kuchen", "torten")
INFO_MAX = 300
HERE = Path(__file__).resolve().parent

# Obvious typos in the source names: source name -> (fixed name, reason). The source name is kept in `name_src`.
NAME_FIXES = {
    "Schwabenkornt 500g": ("Schwabenkorn 500g", "Tippfehler (vgl. Schwabenkorn 1000g)"),
    "Sckokobrötchen": ("Schokobrötchen", "Tippfehler (eigener Text: Schokobrötchen)"),
    "Pain Chocolate": ("Pain au Chocolat", "eigener Text nennt es Pain au Chocolat"),
    "Taschen Schleifen": ("Taschen & Schleifen", "eigener Text: Taschen & Schleifen"),
}

# ------------------------------------------------------------------------------------------- front matter


def _scalar(raw: str):
    v = raw.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    if v in ("true", "false"):
        return v == "true"
    if v.startswith("[") and v.endswith("]"):
        return [_scalar(x) for x in v[1:-1].split(",") if x.strip()]
    if re.fullmatch(r"-?\d+", v):
        return int(v)
    if re.fullmatch(r"-?\d+\.\d*", v):
        return float(v)
    return v


def parse_markdown(text: str) -> tuple[dict, str]:
    """Front matter between the first two `---` lines (flat `key: value` pairs only) and the body after it."""
    lines = text.replace("\r\n", "\n").split("\n")
    if not lines or lines[0].strip() != "---":
        raise ValueError("no front matter")
    meta: dict = {}
    for i in range(1, len(lines)):
        line = lines[i]
        if line.strip() == "---":
            return meta, "\n".join(lines[i + 1:])
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$", line)
        if m and not line.startswith(" "):
            meta[m.group(1)] = _scalar(m.group(2))
    raise ValueError("front matter not closed")


def first_paragraph(body: str) -> str:
    """First paragraph of the body that is not a heading, list or quote; whitespace collapsed."""
    para: list[str] = []
    for line in body.split("\n"):
        s = line.strip()
        if not s:
            if para:
                break
            continue
        if not para and (s.startswith(("#", "-", "*", ">", "|")) or re.match(r"^\d+\.\s", s)):
            continue
        para.append(s)
    return re.sub(r"\s+", " ", " ".join(para)).strip()


def clip(text: str, n: int = INFO_MAX) -> str:
    """≤ n chars: cut after the last full sentence that fits, else at a word boundary with an ellipsis."""
    if len(text) <= n:
        return text
    head = text[:n]
    ends = [m.end() for m in re.finditer(r"[.!?](?=\s|$)", head)]
    if ends and ends[-1] >= n // 2:
        return head[:ends[-1]].strip()
    cut = head[:n - 1].rsplit(" ", 1)[0].rstrip(" ,;:—–-")
    return cut + "…"


def fix_name(name: str) -> tuple[str, list[str]]:
    reasons = []
    if name in NAME_FIXES:
        name, why = NAME_FIXES[name]
        reasons.append(why)
    # an opened parenthesis that is never closed before the next one opens (or the end): close it
    out, depth = [], 0
    for ch in name:
        if ch == "(" and depth:
            while out and out[-1] == " ":
                out.pop()
            out.append(") ")
            depth -= 1
            reasons.append("fehlende Klammer ergänzt")
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        out.append(ch)
    if depth:
        out.append(")" * depth)
        reasons.append("fehlende Klammer ergänzt")
    return "".join(out), sorted(set(reasons))


def weight_g(name: str) -> int | None:
    m = re.search(r"(\d{2,5})\s*g\b", name)
    return int(m.group(1)) if m else None


# ------------------------------------------------------------------------------------------- shape recipes

# (id regex, shape, params). First match wins. Params are passed to shapes.build(); `size` overrides the
# recipe's default true size [w, d, h] (m) at `ref_g` weight (scaled by (weight/ref_g)^(1/3) when the name has one).
RULES: list[tuple[str, str, dict]] = [
    # --- brot
    (r"^kornbrot-", "laib-oval", {"crust": "kruste", "topping": "koerner"}),
    (r"^mischbrot-", "laib-oval", {"crust": "kruste", "cuts": "schraeg", "flour": True}),
    (r"^holzluken-", "laib-rund", {"crust": "kruste-dunkel", "cuts": "riss", "flour": True}),
    (r"^bergsteiger-", "laib-rund", {"crust": "kruste-dunkel", "topping": "koerner"}),
    (r"^sommerkorn-", "laib-rund", {"crust": "kruste", "topping": "sesam"}),
    (r"^biker-", "laib-rund", {"crust": "kruste-dunkel", "cuts": "kreuz"}),
    (r"^kerbricher-", "laib-rund", {"crust": "kruste", "cuts": "gitter", "flour": True}),
    (r"^haferflocken-", "kastenbrot", {"crust": "kruste", "topping": "hafer"}),
    (r"^voll-gut-", "kastenbrot", {"crust": "kruste-dunkel", "topping": "koerner"}),
    (r"^schwabenkorn", "kastenbrot", {"crust": "schwarzbrot", "flour": True}),
    (r"^feel-happy-", "kastenbrot", {"crust": "kruste", "topping": "saaten"}),
    (r"^hildegard-", "laib-oval", {"crust": "kruste", "cuts": "laengs", "flour": True}),
    (r"^koenig-ludwig-", "laib-rund", {"crust": "kruste", "cuts": "raute", "flour": True}),
    # --- baguette
    (r"^kasten-weissbrot$", "kastenbrot", {"crust": "kruste", "dome": True, "cuts": "laengs",
                                           "size": [0.26, 0.11, 0.12]}),
    (r"^baguette-klein$", "baguette", {"crust": "kruste-hell", "cuts": 4, "size": [0.36, 0.065, 0.05]}),
    (r"^baguette-gross$", "baguette", {"crust": "kruste-hell", "cuts": 6, "size": [0.58, 0.07, 0.055]}),
    (r"^roggenflit-klein$", "baguette", {"crust": "kruste", "cuts": 3, "flour": True, "size": [0.30, 0.075, 0.06]}),
    (r"^roggenflit-gross$", "baguette", {"crust": "kruste", "cuts": 5, "flour": True, "size": [0.46, 0.09, 0.07]}),
    # --- broetchen
    (r"^doppelweck$", "doppelweck", {"crust": "kruste-hell", "lobes": 2}),
    (r"^samstagsweck$", "broetchen-schlitz", {"crust": "kruste", "flour": True, "size": [0.12, 0.08, 0.06]}),
    (r"^sternweck$", "broetchen-stern", {"crust": "kruste-hell"}),
    (r"^flitweck$", "broetchen-schlitz", {"crust": "kruste-hell", "pointed": True, "size": [0.17, 0.065, 0.05]}),
    (r"^elsaesser$", "broetchen-schlitz", {"crust": "kruste-hell", "flour": True}),
    (r"^knusperweck$", "broetchen-schlitz", {"crust": "kruste"}),
    (r"^roggenweck$", "broetchen-rund", {"crust": "kruste-dunkel", "cuts": "riss", "flour": True}),
    (r"^koernerweck$", "broetchen-rund", {"crust": "kruste", "topping": "koerner"}),
    (r"^mohn-broetchen$", "broetchen-rund", {"crust": "kruste-hell", "topping": "mohn"}),
    (r"^sesam-broetchen$", "broetchen-rund", {"crust": "kruste-hell", "topping": "sesam"}),
    (r"^kuemmel-broetchen$", "broetchen-rund", {"crust": "kruste", "topping": "kuemmel"}),
    (r"^dinkel-broetchen$", "broetchen-rund", {"crust": "kruste", "cuts": "schraeg", "oval": True,
                                             "size": [0.115, 0.08, 0.055]}),
    (r"^mohn-hoernchen$", "hoernchen", {"crust": "kruste-hell", "topping": "mohn"}),
    (r"^sesam-hoernchen$", "hoernchen", {"crust": "kruste-hell", "topping": "sesam"}),
    (r"^kaese-broetchen$", "broetchen-rund", {"crust": "kruste-hell", "topping": "kaese"}),
    # --- snacks
    (r"^brezel$", "brezel", {}),
    (r"^laugenstange$", "laugenstange", {"crust": "lauge", "salt": True}),
    (r"^laugenbroetchen$", "broetchen-rund", {"crust": "lauge", "cuts": "kreuz", "salt": True,
                                              "size": [0.09, 0.09, 0.05]}),
    (r"^laugenecke$", "laugenecke", {}),
    (r"^laugencroquette$", "broetchen-rund", {"crust": "lauge", "cuts": "quer", "salt": True, "oval": True,
                                              "size": [0.12, 0.075, 0.05]}),
    (r"^keimkraft-hoernchen$", "hoernchen", {"crust": "kruste", "topping": "koerner"}),
    (r"^kaesestange$", "laugenstange", {"crust": "kruste-hell", "topping": "kaese", "size": [0.24, 0.06, 0.045]}),
    (r"^kaesestange-mit-schinken$", "laugenstange", {"crust": "kruste-hell", "topping": "kaese", "ham": True,
                                                     "size": [0.24, 0.06, 0.045]}),
    # --- teilchen
    (r"^gefuellte-schnecken", "schnecke", {"fillings": ["schoko", "pudding", "rosinen", "nuss", "mohn"]}),
    (r"^plunder-hoernchen$", "hoernchen", {"crust": "kruste-hell", "glaze": "zuckerguss", "size": [0.15, 0.09, 0.045]}),
    (r"^taschen-schleifen$", "tasche", {"form": "umschlag", "filling": "pudding"}),
    (r"^kirsch-plotzer$", "blechkuchen-stueck", {"topping": "kirsch", "size": [0.10, 0.09, 0.045]}),
    (r"^puddingstueckchen$", "tasche", {"form": "quadrat", "filling": "pudding"}),
    (r"^butterkuchen$", "blechkuchen-stueck", {"topping": "butter", "size": [0.10, 0.08, 0.03]}),
    (r"^streusel$", "blechkuchen-stueck", {"topping": "streusel", "size": [0.10, 0.09, 0.04]}),
    (r"^schoko-vanille-hoernchen$", "hoernchen", {"crust": "kruste-hell", "glaze": "schoko", "size": [0.15, 0.09, 0.045]}),
    (r"^quarktasche$", "tasche", {"form": "dreieck", "filling": "quark"}),
    (r"^einback$", "doppelweck", {"crust": "kruste", "lobes": 3, "size": [0.13, 0.065, 0.055]}),
    (r"^(sckoko|schoko)broetchen$", "broetchen-rund", {"crust": "kruste-hell", "topping": "schoko",
                                                                     "size": [0.09, 0.09, 0.05]}),
    (r"^rosinenbroetchen$", "broetchen-rund", {"crust": "kruste-hell", "topping": "rosinen", "size": [0.09, 0.09, 0.05]}),
    (r"^croissant$", "croissant", {}),
    (r"^pain-", "pain-au-chocolat", {}),
    (r"^muffin$", "muffin", {"topping": "schoko"}),
    (r"^granatsplitter$", "granatsplitter", {}),
    # --- kuchen (pieces first: "(1 Stück)" / "(1/4 Stück)")
    (r"^blechkuchen-1-stueck$", "blechkuchen-stueck", {"toppings": ["streusel", "apfel", "kirsch", "butter"]}),
    (r"^blechkuchen$", "blechkuchen", {"toppings": ["streusel", "apfel", "kirsch", "butter"]}),
    (r"^(rahm|kaese|apfel|kirsch)kuchen-1-stueck$", "kuchen-stueck", {"pieces": 10}),
    (r"^(rahm|kaese|apfel|kirsch)kuchen$", "rundkuchen", {}),
    (r"^(marmor|zitronen|nuss)kuchen-1-stueck$", "kastenkuchen-scheibe", {}),
    (r"^(marmor|zitronen|nuss)kuchen$", "kastenkuchen", {}),
    (r"^kranzkuchen-ungefuellt-1-4-stueck$", "kranzkuchen-viertel", {"filled": False}),
    (r"^kranzkuchen-gefuellt.*-1-4-stueck$", "kranzkuchen-viertel",
     {"filled": True, "fillings": ["nuss", "schoko", "quark", "pudding"]}),
    (r"^kranzkuchen-ungefuellt$", "kranzkuchen", {"filled": False}),
    (r"^kranzkuchen-gefuellt", "kranzkuchen", {"filled": True, "fillings": ["nuss", "schoko", "quark", "pudding"]}),
    (r"^streuselkuchen-gross-1-4-stueck$", "kuchen-stueck", {"topping": "streusel", "pieces": 4, "size": [0.20, 0.14, 0.045]}),
    (r"^streuselkuchen-gross$", "rundkuchen", {"topping": "streusel", "size": [0.28, 0.28, 0.045]}),
    (r"^streuselkuchen-klein$", "rundkuchen", {"topping": "streusel", "size": [0.20, 0.20, 0.04]}),
    (r"^zopf-ungefuellt$", "zopf", {"filled": False}),
    (r"^zopf-gefuellt", "zopf", {"filled": True, "fillings": ["nuss", "schoko", "quark", "pudding"],
                                 "size": [0.34, 0.13, 0.08]}),
    (r"^rosinenbrot$", "rosinenbrot", {}),
    # --- torten
    (r"^obstboden$", "tortenboden", {"kind": "obstboden"}),
    (r"^tortenboden$", "tortenboden", {"kind": "biskuit"}),
    # Sahnerollen are cream-filled waffle tubes (the shop's own text), sold singly or as several
    (r"^sahnerollen-1-stueck$", "sahnerolle", {}),
    (r"^sahnerollen$", "sahnerollen", {}),
    (r"^buttercreme-rolle$", "rolle", {"cream": "buttercreme", "size": [0.30, 0.10, 0.09]}),
    (r"^schwarzwaelder", "torte", {"kind": "schwarzwaelder", "size": [0.26, 0.26, 0.10]}),
    (r"^sahne-torte$", "torte", {"kind": "sahne"}),
    (r"^buttercreme-torte$", "torte", {"kind": "buttercreme"}),
]

FALLBACK = {"brot": "laib-rund", "baguette": "baguette", "broetchen": "broetchen-rund", "snacks": "brezel",
            "teilchen": "schnecke", "kuchen": "rundkuchen", "torten": "torte"}

# Default true size [w, d, h] (m) per shape at the reference weight ref_g (None = not weight-scaled).
# w = longest horizontal extent (the product's x), d = across, h = height. Estimates from typical German bakery
# goods of the type; sigma follows from the size (see size_for).
SIZES: dict[str, tuple[list[float], int | None]] = {
    "laib-rund": ([0.18, 0.18, 0.085], 500),
    "laib-oval": ([0.22, 0.14, 0.085], 500),
    "kastenbrot": ([0.20, 0.10, 0.09], 500),
    "baguette": ([0.50, 0.07, 0.055], None),
    "broetchen-rund": ([0.10, 0.10, 0.055], None),
    "broetchen-stern": ([0.10, 0.10, 0.06], None),
    "broetchen-schlitz": ([0.12, 0.075, 0.055], None),
    "doppelweck": ([0.15, 0.08, 0.06], None),
    "hoernchen": ([0.14, 0.08, 0.045], None),
    "croissant": ([0.16, 0.10, 0.05], None),
    "brezel": ([0.17, 0.13, 0.045], None),
    "laugenstange": ([0.22, 0.045, 0.04], None),
    "laugenecke": ([0.11, 0.10, 0.05], None),
    "schnecke": ([0.11, 0.11, 0.035], None),
    "tasche": ([0.11, 0.11, 0.035], None),
    "pain-au-chocolat": ([0.11, 0.07, 0.04], None),
    "muffin": ([0.08, 0.08, 0.075], None),
    "granatsplitter": ([0.065, 0.065, 0.06], None),
    "blechkuchen-stueck": ([0.12, 0.10, 0.045], None),
    "blechkuchen": ([0.60, 0.40, 0.05], None),
    "rundkuchen": ([0.28, 0.28, 0.05], None),
    "kuchen-stueck": ([0.087, 0.14, 0.05], None),
    "kastenkuchen": ([0.30, 0.11, 0.09], None),
    "kastenkuchen-scheibe": ([0.11, 0.09, 0.02], None),
    "kranzkuchen": ([0.26, 0.26, 0.07], None),
    "kranzkuchen-viertel": ([0.19, 0.10, 0.07], None),
    "zopf": ([0.32, 0.12, 0.08], None),
    "rosinenbrot": ([0.25, 0.11, 0.10], None),
    "tortenboden": ([0.26, 0.26, 0.04], None),
    "rolle": ([0.30, 0.09, 0.08], None),
    "sahnerolle": ([0.12, 0.034, 0.034], None),
    "sahnerollen": ([0.12, 0.103, 0.064], None),
    "torte": ([0.26, 0.26, 0.09], None),
}
# the per-product size of a few shapes depends on params
_KIND_SIZE = {("tortenboden", "obstboden"): [0.26, 0.26, 0.025], ("rundkuchen", "kaese"): [0.26, 0.26, 0.06],
              ("kuchen-stueck", "kaese"): [0.08, 0.13, 0.06]}

TOPPING_FROM_ID = (("rahm", "rahm"), ("kaese", "kaese"), ("apfel", "apfel"), ("kirsch", "kirsch"),
                   ("marmor", "marmor"), ("zitronen", "zitrone"), ("nuss", "nuss"))


def recipe_for(pid: str, category: str) -> tuple[str, dict, bool]:
    for rx, shape, params in RULES:
        if re.search(rx, pid):
            p = dict(params)
            if shape in ("rundkuchen", "kuchen-stueck", "kastenkuchen", "kastenkuchen-scheibe") and "topping" not in p:
                for key, top in TOPPING_FROM_ID:
                    if pid.startswith(key):
                        p["topping" if shape in ("rundkuchen", "kuchen-stueck") else "kind"] = top
                        break
            return shape, p, False
    return FALLBACK[category], {}, True


def size_for(shape: str, params: dict, weight: int | None) -> tuple[list[float], float, str]:
    base, ref = SIZES[shape]
    basis = "type"
    if "size" in params:
        base = params["size"]
    else:
        for (s, k), sz in _KIND_SIZE.items():
            if s == shape and k in (params.get("kind"), params.get("topping")):
                base = sz
    if ref and weight:
        f = (weight / ref) ** (1 / 3)
        base = [b * f for b in base]
        basis = "weight"
    size = [round(float(b), 3) for b in base]
    sigma = round(max(0.01, 0.08 * max(size)), 3)
    return size, sigma, basis


def sale_unit(name: str, category: str, shape: str) -> str | None:
    """How the row is sold. None = the source does not say (Sahnerollen: how many rolls the 20 € row holds)."""
    if re.search(r"\(\s*1\s*/\s*4\s*Stück\s*\)", name):
        return "1/4"
    if re.search(r"\(\s*1\s*Stück\s*\)", name):
        return "Stück"
    if shape == "blechkuchen":
        return "Blech"
    if shape == "torte":
        return "ganze Torte"
    if shape == "rolle":
        return "ganze Rolle"
    if shape == "sahnerollen":
        return None
    if shape in ("rundkuchen", "kastenkuchen", "kranzkuchen"):
        return "ganzer Kuchen"
    if category == "brot" or shape in ("rosinenbrot",) or (shape == "kastenbrot" and "brot" in name.lower()):
        return "Laib"
    return "Stück"


# ------------------------------------------------------------------------------------------- import


def build_product(path: Path) -> tuple[dict, list[dict]]:
    meta, body = parse_markdown(path.read_text(encoding="utf-8"))
    for key in ("id", "numeric_id", "name", "category", "price"):
        if key not in meta:
            raise ValueError(f"{path.name}: missing '{key}'")
    pid = str(meta["id"])
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", pid):
        raise ValueError(f"{path.name}: id '{pid}' is not kebab-case")
    cat = str(meta["category"])
    if cat not in CATEGORIES:
        raise ValueError(f"{path.name}: unknown category '{cat}'")
    src_name = str(meta["name"]).strip()
    name, reasons = fix_name(src_name)
    shape, params, guess = recipe_for(pid, cat)
    w = weight_g(src_name)
    size, sigma, basis = size_for(shape, params, w)
    params = {k: v for k, v in params.items() if k != "size"}
    short = str(meta.get("short_description", "")).strip()
    rec = {
        "id": pid,
        "numeric_id": int(meta["numeric_id"]),
        "name_de": name,
        "name_src": src_name,
        "category": cat,
        "price_eur": round(float(meta["price"]), 2),
        "sale_unit": sale_unit(src_name, cat, shape),
        "weight_g": w,
        "short_de": short,
        "info_de": clip(first_paragraph(body)),
        "available": bool(meta.get("available", True)),
        "seasonal": bool(meta.get("seasonal", False)),
        "shape": shape,
        "shape_params": dict(sorted(params.items())),
        "size_m": size,
        "sigma_m": sigma,
        "size_basis": basis,
        "source": SOURCE,
        "source_file": path.stem,
    }
    if guess:
        rec["shape_guess"] = True
    fixes = [{"id": pid, "from": src_name, "to": name, "why": "; ".join(reasons)}] if name != src_name else []
    return rec, fixes


def source_files(src: Path) -> list[Path]:
    """The folder's own *.md files: no templates or hidden files, no symlinks and nothing that resolves outside
    `src` (a link must never make the importer read a file elsewhere)."""
    root = src.resolve()
    out = []
    for p in sorted(src.glob("*.md")):
        if p.name.startswith(("_", ".")) or p.is_symlink() or not p.is_file():
            continue
        if p.resolve().parent != root:
            continue
        out.append(p)
    return out


def import_dir(src: Path) -> dict:
    files = source_files(src)
    products, fixes = [], []
    for f in files:
        rec, fx = build_product(f)
        products.append(rec)
        fixes += fx
    products.sort(key=lambda r: (r["numeric_id"], r["id"]))
    ids = [r["id"] for r in products]
    dup = sorted({i for i in ids if ids.count(i) > 1})
    if dup:
        raise ValueError(f"duplicate ids: {dup}")
    nums = [r["numeric_id"] for r in products]
    if len(set(nums)) != len(nums):
        raise ValueError("duplicate numeric_id")
    known = set(ids)
    for r in products:   # one piece of a whole product (cake, ring) or of a multi-piece row (Sahnerollen)
        m = re.match(r"^(.*?)-1(?:-4)?-stueck$", r["id"])
        if m and r["sale_unit"] in ("Stück", "1/4") and m.group(1) in known:
            r["piece_of"] = m.group(1)
    fixes.sort(key=lambda f: next(r["numeric_id"] for r in products if r["id"] == f["id"]))
    return {"schema": SCHEMA, "source": SOURCE, "count": len(products), "categories": list(CATEGORIES),
            "name_fix": fixes, "products": products}


def dumps(doc: dict) -> str:
    return json.dumps(doc, ensure_ascii=False, indent=1) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("src", type=Path, help="folder with the product .md files")
    ap.add_argument("--out", type=Path, default=HERE / "products.json")
    a = ap.parse_args(argv)
    if not a.src.is_dir():
        ap.error(f"not a folder: {a.src}")
    doc = import_dir(a.src)
    a.out.write_text(dumps(doc), encoding="utf-8")
    print(f"{a.out.name}: {doc['count']} products, {len(doc['name_fix'])} name fixes, "
          f"{sum(1 for p in doc['products'] if p.get('shape_guess'))} shape guesses")
    return 0


if __name__ == "__main__":
    sys.exit(main())
