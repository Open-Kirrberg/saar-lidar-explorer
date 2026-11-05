"""Product gallery: every product of products.json on a labelled tray per category, true sizes, baked light like the
twin -> products/out/gallery.glb (+ gallery.json: layout for labels and camera framing).

    cd pipeline && uv run python -I ../zones/baeckerei-heusser/products/gallery.py [--instances N] [--out DIR]

Raw GLB in the generator's form (float32, unlit, COLOR_0 = baked light; build/bh_twin/glb.py). Node names:
`produkte/<product id>` (extras: id, name_de, category, shape, triangles) and `tablett/<category>`.
Deterministic: same products.json -> byte-identical files.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import numpy as np  # noqa: E402

import shapes as S  # noqa: E402
from bh_twin import geom, glb, shade  # noqa: E402

CAT_DE = {"brot": "Brot", "baguette": "Baguette & Kastenweißbrot", "broetchen": "Brötchen", "snacks": "Laugen & Snacks",
          "teilchen": "Teilchen", "kuchen": "Kuchen", "torten": "Torten & Rollen"}
GAP = 0.05          # between products (m)
ROW_MAX = 2.3       # wrap a category after this width (m)
TRAY_H = 0.012
TRAY_PAD = 0.05
CAT_GAP = 0.16
WINDOW_HEADING = 150.0   # baked key light from the front right (camera looks north from the south)


def rig():
    return shade.interior_rig(WINDOW_HEADING)


def layout(products: list[dict], instances: int = 1) -> list[dict]:
    """Category blocks top to bottom (−z = back); inside a block, rows of products left to right."""
    blocks = []
    z = 0.0
    for cat in ("brot", "baguette", "broetchen", "snacks", "teilchen", "kuchen", "torten"):
        items = [p for p in products if p["category"] == cat]
        if not items:
            continue
        rows, row, w = [], [], 0.0
        for p in items:
            pw = p["size_m"][0] * (1 + 0.6 * (instances - 1)) + GAP
            if row and w + pw > ROW_MAX:
                rows.append(row)
                row, w = [], 0.0
            row.append(p)
            w += pw
        rows.append(row)
        places = []
        z0 = z
        for r in rows:
            depth = max(p["size_m"][1] for p in r) * 1.15 + GAP
            x = 0.0
            for p in r:
                for i in range(instances):
                    places.append({"id": p["id"], "idx": i, "x": x + p["size_m"][0] / 2, "z": z + depth / 2})
                    x += p["size_m"][0] * (0.6 if i < instances - 1 else 1.0)
                x += GAP
            z += depth
        width = max(pl["x"] for pl in places) + max(p["size_m"][0] for p in items) / 2
        blocks.append({"category": cat, "label_de": CAT_DE[cat], "x0": -TRAY_PAD, "x1": width + TRAY_PAD,
                       "z0": z0 - TRAY_PAD, "z1": z + TRAY_PAD, "places": places})
        z += CAT_GAP + 2 * TRAY_PAD
    # centre the whole gallery on x = 0, z = 0
    wmax = max(b["x1"] for b in blocks)
    zmax = z
    for b in blocks:
        b["x0"] -= wmax / 2
        b["x1"] -= wmax / 2
        b["z0"] -= zmax / 2
        b["z1"] -= zmax / 2
        for pl in b["places"]:
            pl["x"] -= wmax / 2
            pl["z"] -= zmax / 2
    return blocks


def build_gallery(products_json: Path, out: Path, instances: int = 1) -> dict:
    doc = json.loads(products_json.read_text(encoding="utf-8"))
    products = {p["id"]: p for p in doc["products"]}
    blocks = layout(doc["products"], instances)
    r = rig()
    nodes = []
    index = {"schema": "bh-products-gallery-v1", "blocks": [], "products": []}
    for b in blocks:
        tray = geom.Node(f"tablett/{b['category']}", r, {"label_de": b["label_de"], "category": b["category"]})
        for q in S.box(b["x0"], b["x1"], -TRAY_H, 0.0, b["z0"], b["z1"], 0.008, "tablett"):
            S.add_to_node(tray, [q])
        nodes.append(tray)
        index["blocks"].append({k: (round(v, 4) if isinstance(v, float) else v) for k, v in b.items() if k != "places"})
        for pl in b["places"]:
            p = products[pl["id"]]
            parts = S.build(p, pl["idx"])
            name = f"produkte/{p['id']}" + (f"/{pl['idx']}" if instances > 1 else "")
            n = geom.Node(name, r, {"id": p["id"], "name_de": p["name_de"], "category": p["category"],
                                    "shape": p["shape"], "size_m": p["size_m"], "instance": pl["idx"]})
            tri = S.add_to_node(n, parts, (pl["x"], 0.0, pl["z"]))
            n.extras["triangles"] = tri
            nodes.append(n)
            lo, hi = S.bbox(parts)
            index["products"].append({"node": name, "id": p["id"], "name_de": p["name_de"], "category": p["category"],
                                      "shape": p["shape"], "triangles": tri, "budget": S.budget(p["shape"]),
                                      "pos": [round(pl["x"], 4), 0.0, round(pl["z"], 4)],
                                      "top_m": round(float(hi[1]), 4)})
    out.mkdir(parents=True, exist_ok=True)
    data = glb.write_glb(nodes, S.materials())
    (out / "gallery.glb").write_bytes(data)
    tris = [p["triangles"] for p in index["products"]]
    index["totals"] = {"products": len(tris), "triangles": int(sum(tris)), "max_triangles": int(max(tris)),
                       "over_budget": [p["id"] for p in index["products"] if p["triangles"] > p["budget"]]}
    (out / "gallery.json").write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return index


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="product gallery GLB")
    ap.add_argument("--products", type=Path, default=HERE / "products.json")
    ap.add_argument("--out", type=Path, default=HERE / "out")
    ap.add_argument("--instances", type=int, default=1, help="instances per product (shows the seeded variation)")
    a = ap.parse_args(argv)
    idx = build_gallery(a.products, a.out, a.instances)
    t = idx["totals"]
    print(f"gallery.glb: {t['products']} products, {t['triangles']} triangles (max {t['max_triangles']}), "
          f"over budget: {t['over_budget'] or 'none'}")
    return 0 if not t["over_budget"] else 1


if __name__ == "__main__":
    sys.exit(main())
