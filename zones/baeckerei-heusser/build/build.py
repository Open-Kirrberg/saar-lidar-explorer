"""Bäckerei Heusser built twin: Raumplan (public, ../plan/raumplan-v0.json) + LoD2 + DGM1 + OSM -> stylised GLBs.

    cd pipeline && uv run python -I ../zones/baeckerei-heusser/build/build.py [--fill morgens|feierabend] [--update-catalogue]
                                                                              [--debug-slots] [--out DIR]

Writes (git-ignored) build/out/:
    twin.glb       raw glTF (float32, unlit, COLOR_0 = baked light), one node per `<catalogue id>/<part>`
    nav.glb        walkable floor `nav/floor` + edge fences `nav/edge` (the zone's collider, never drawn)
    report.json    node list, triangles per node and class, budgets, bbox, privacy checks
    package.json   manifest fragment for tools/capture/capture/built.py (assets, spawn, portal, footprint, twin)
    slots.json     product slots on the fixtures (zone frame); the CLI also writes it to catalogue/slots.json
    catalogue.json the visitor's catalogue (`sle-zone-catalogue-v1`): info cards of the clickable objects, the products
                   with prices, the „entdeckt x / y“ list; packed as built/catalogue.json (docs/zone-contract.md)

Deterministic: same inputs -> byte-identical GLBs. Raw downloads are untrusted data: parsed, never executed (-I).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path[:0] = [str(HERE), str(REPO / "pipeline"), str(HERE.parent / "products")]  # -I drops the script dir; our own code only

import numpy as np  # noqa: E402
from shapely.geometry import Point, Polygon  # noqa: E402

from bh_twin import auslage, exterior, fixtures, ground, interior  # noqa: E402
from bh_twin.context import Dgm, circle, lod2_buildings, osm_ways  # noqa: E402
from bh_twin.glb import write_glb  # noqa: E402
from bh_twin.plan import E0, N0, Plan, load_plan, toml_scale_factor  # noqa: E402
from bh_twin.scene import Scene  # noqa: E402
from bh_twin.shade import daylight_falloff, exterior_rig, flat_rig, interior_rig  # noqa: E402

ZONE = HERE.parent
PLAN = ZONE / "plan" / "raumplan-v0.json"
PLAN_VERSION = PLAN.stem.split("-")[-1]   # raumplan-v0 -> v0
CATALOGUE = ZONE / "catalogue" / "objects.json"
SLOTS = ZONE / "catalogue" / "slots.json"
PRODUCTS = ZONE / "products" / "products.json"
FILLS = ZONE / "products" / "fill"
DEFAULT_FILL = "morgens"
CATALOGUE_FORMAT = "sle-zone-catalogue-v1"
PRODUCT_NODE = "produkt/"     # one node per filled slot: produkt/<slot id>, extras {id: slot id, product|ware, count}
PRODUCT_BUDGET = {"small": 300, "large": 800, "low": 120, "ware": 160}   # per instance (style.md, products/README.md)
SLOTS_FORMAT = "bh-slots-v1"
SLOT_CATEGORIES = ("brot", "broetchen", "laugengebaeck", "suesses", "kuchen", "glas", "dose", "flasche", "tuete")
TOML = REPO / "tools" / "capture" / "zones" / "baeckerei-heusser.toml"
DTM = REPO / "data" / "work" / "overall" / "dtm.tif"
LOD2 = REPO / "data" / "raw" / "lod2"
OSM = REPO / "data" / "raw" / "osm" / "overall.json"

SPAWN_B = (23.0, -7.0)        # on the street, the whole shop front (windows, porch) in view (frame B)
SPAWN_PITCH = -4              # degrees: a little down, the shop windows and the porch fill the view (not the bare upper wall)
EYE = 1.6
FOOTPRINT_SEGS = 32
TRI_BUDGET = 300_000          # style.md: aim for < 300 k triangles
CLASS_BUDGET = {"structure": None, "fixture": 5000, "appliance": 2000, "container": 1000, "sign": 1000, "decor": 1000}
STRUCTURE_ELEMENT = 60_000    # a "structure" node may be big (tiles, ground), but stays under this


def catalogue_ids(doc: dict) -> dict[str, dict]:
    return {o["id"]: o for o in doc["objects"]}


def resolve_id(name: str, cat: dict[str, dict]) -> str | None:
    """Longest catalogue id that is a path prefix of the node name (`theke/vitrine` for `theke/vitrine`,
    `brotregal` for `brotregal/korpus`)."""
    parts = name.split("/")
    for k in range(len(parts), 0, -1):
        cid = "/".join(parts[:k])
        if cid in cat:
            return cid
    return None


def pick_bakery(p: Plan, blds: list[dict]) -> dict:
    inside = p.frame.en(np.array([20.0, 3.0]))
    for b in blds:
        for fp in b["footprint"]:
            if Polygon(np.asarray(fp)[:, :2]).contains(Point(inside)):
                return b
    raise SystemExit("build: no LoD2 building contains the shop (frame B 20, 3)")


def build(out: Path, update_catalogue: bool = False, factor: float | None = None, debug_slots: bool = False,
          lettering: bool = True, fill: str = DEFAULT_FILL) -> dict:
    """`factor` overrides the one scale factor (tests only: skips the plan == TOML check). `debug_slots` adds magenta
    slot markers (`verkaufsraum/slot-marker`, never for a release). `lettering` adds the shop's own lettering on the
    facade (gable mural text, keystone inscription, sign name): on by default since the owners agreed (2026-11-05,
    ADR 0044); `lettering=False` shows the neutral graphics only. `fill` = a fill in products/fill/ (`morgens`: the
    shop in the morning; `feierabend`: empty like the walkthrough video)."""
    f = toml_scale_factor(TOML) if factor is None else float(factor)
    raw = json.loads(PLAN.read_text(encoding="utf-8"))
    if factor is None and abs(float(raw["scale"]["factor"]) - f) > 1e-9:
        raise SystemExit(f"build: plan scale.factor {raw['scale']['factor']} != TOML package.scale_factor {f} (one factor)")
    p = load_plan(PLAN, f)
    F = p.frame
    cat_doc = json.loads(CATALOGUE.read_text(encoding="utf-8"))
    cat = catalogue_ids(cat_doc)
    cache = out / "cache"

    centre = F.en(np.array([21.0, 1.0]))
    R = ground.PATCH_R
    bounds = (centre[0] - R - 5, centre[1] - R - 5, centre[0] + R + 5, centre[1] + R + 5)
    dgm = Dgm.read(DTM, bounds)
    blds_all = lod2_buildings(LOD2, float(centre[0]), float(centre[1]), R + 10, cache)
    ways = osm_ways(OSM, bounds, cache)
    bakery = pick_bakery(p, blds_all)
    # context buildings: only those that stand wholly on the round patch (no walls hanging over its edge)
    ctr = Point(centre)
    blds = [b for b in blds_all if b is bakery or all(ctr.distance(Point(v[:2])) < R - 0.5 for fp in b["footprint"] for v in fp)]

    window_heading = F.heading((0.0, -1.0))   # the street facade looks along frame-B −y
    room, _, floor_poly = interior.room_polygons(p)
    soffit = interior.soffit_polygon(p, room)
    soffit_z = p.H(p.fixtures["F10"].raw["underside"]["v"])
    y_glass = float(p.room["A"][1])

    def day(pz):   # daylight through the shop windows fades with the depth into the room
        return daylight_falloff(F.zone_to_b(pz)[:, 1] - y_glass)

    rig_int = interior_rig(window_heading, lamps=fixtures.lamp_lights(p, soffit, soffit_z), day=day)
    sc = Scene(F, {"ext": exterior_rig(), "int": rig_int, "flat": flat_rig()})

    # ---- the shop
    interior.build(sc, p)
    fixtures.build(sc, p, soffit, soffit_z)
    import fill as FL  # noqa: PLC0415  (products/fill.py, stdlib)
    import shapes as S  # noqa: PLC0415
    products_doc = json.loads(PRODUCTS.read_text(encoding="utf-8"))
    fill_doc = json.loads((FILLS / f"{fill}.json").read_text(encoding="utf-8"))
    slots_doc = json.loads(slots_json(sc, p, cat_doc))       # this build's slots (the fill must fit them)
    ferr = FL.check_fill(fill_doc, slots_doc, products_doc)
    if ferr:
        raise SystemExit(f"build: fill {fill!r} does not fit the slots:\n  - " + "\n  - ".join(ferr))
    placed = auslage.place(sc, fill_doc, slots_doc, products_doc, sc.anchors)
    sc.bake_ao("int")
    if debug_slots:
        fixtures.slot_markers(sc, p)
    exterior.build_bakery(sc, p, bakery, lettering)

    def ground_h_b(xy_b):
        en = F.en(np.asarray(xy_b, np.float64))
        return dgm(en[:, 0], en[:, 1]) - F.z0

    exterior.build_passage(sc, p, ground_h_b)
    exterior.build_neighbours(sc, p, blds, {bakery["id"]})
    cls = ground.classes(p, blds, ways)
    ground.build_ground(sc, p, cls, dgm)

    twin_nodes = [n for k, n in sc.nodes.items() if not k.startswith("nav/")]
    # ---- nav (separate asset)
    nav_sc = Scene(F, {"flat": flat_rig()})
    door = interior.door_geometry(p)
    pieces = ground.nav_pieces(p, cls, dgm, fixtures.obstacles(p) + interior.door_leaf_obstacles(p), exterior.step_height, door, exterior.porch_frame(p))
    nav_union = ground.build_nav(nav_sc, pieces, dgm)
    nav_nodes = list(nav_sc.nodes.values())

    # ---- catalogue: every visible node belongs to a catalogue row ("no catalogue entry, no geometry")
    missing = []
    slot_ids = {s["id"] for s in sc.slots}
    for n in twin_nodes:
        if n.name.startswith(PRODUCT_NODE):
            if n.name[len(PRODUCT_NODE):] not in slot_ids or n.extras["id"] != n.name[len(PRODUCT_NODE):]:
                missing.append(n.name)
            continue
        cid = resolve_id(n.name, cat)
        if cid is None or n.name.split("/")[0] not in cat:
            missing.append(n.name)
            continue
        n.extras["id"] = cid
    if missing:
        raise SystemExit("build: nodes without a catalogue row: " + ", ".join(missing))

    mats = S.materials()
    out.mkdir(parents=True, exist_ok=True)
    twin_glb = write_glb(twin_nodes, mats)
    nav_glb = write_glb(nav_nodes, mats)
    (out / "twin.glb").write_bytes(twin_glb)
    (out / "nav.glb").write_bytes(nav_glb)

    # ---- report + manifest fragment
    def bbox(nodes):
        lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
        for n in nodes:
            for pr in n.prims.values():
                v, _, _, _ = pr.arrays()
                if len(v):
                    lo, hi = np.minimum(lo, v.min(0)), np.maximum(hi, v.max(0))
        return [[round(float(x), 2) for x in lo], [round(float(x), 2) for x in hi]]

    tris = {n.name: n.triangles for n in twin_nodes}
    by_class: dict[str, int] = {}
    per_object: dict[str, int] = {}
    product_tris = 0
    for n in twin_nodes:
        if n.name.startswith(PRODUCT_NODE):
            product_tris += n.triangles
            continue
        cid = n.extras["id"]
        top = cid.split("/")[0]
        typ = cat[top]["type"]
        by_class[typ] = by_class.get(typ, 0) + n.triangles
        per_object[top] = per_object.get(top, 0) + n.triangles
    over = []
    for obj, t in per_object.items():
        lim = CLASS_BUDGET.get(cat[obj]["type"])
        if lim is not None and t > lim:
            over.append(f"{obj}: {t} > {lim} ({cat[obj]['type']})")
    for sid, st in placed.items():
        kind = "ware" if st["kind"] == "ware" else "low" if st["low"] else \
            "large" if st["shape"] in S.LARGE else "small"
        if st["max_piece"] > PRODUCT_BUDGET[kind]:
            over.append(f"produkt/{sid}: {st['max_piece']} > {PRODUCT_BUDGET[kind]} per piece ({kind})")
    by_class["product"] = product_tris
    for name, t in tris.items():
        if name.startswith(PRODUCT_NODE):
            continue
        if cat[name.split('/')[0]]["type"] == "structure" and t > STRUCTURE_ELEMENT:
            over.append(f"{name}: {t} > {STRUCTURE_ELEMENT} (structure element)")
    total = sum(tris.values())
    if total > TRI_BUDGET:
        over.append(f"twin: {total} > {TRI_BUDGET}")

    sp = F.en(np.array(SPAWN_B))
    spawn_h = float(dgm(sp[0:1], sp[1:2])[0]) + EYE
    heading = F.heading((0.0, 1.0))
    spawn = {"E": round(float(sp[0]), 2), "N": round(float(sp[1]), 2), "h": round(spawn_h, 2),
             "heading_deg": round(heading, 1), "pitch_deg": SPAWN_PITCH, "mode": "gehen"}
    portal = {"E": spawn["E"], "N": spawn["N"], "facing_deg": round((heading + 180.0) % 360.0, 1)}
    fp = [[round(float(e), 1), round(float(n), 1)] for e, n in circle(centre[0], centre[1], R, FOOTPRINT_SEGS)]
    report = {
        "plan": {"file": str(PLAN.relative_to(REPO)), "version": PLAN_VERSION, "format": raw.get("schema"),
                 "scale_factor": f},
        "triangles": {"total": total, "by_class": dict(sorted(by_class.items())), "by_object": dict(sorted(per_object.items())),
                      "by_node": dict(sorted(tris.items())), "nav": sum(n.triangles for n in nav_nodes)},
        "budget_problems": over,
        "lettering": bool(lettering),
        "fill": {"id": fill, "slots": len(placed), "pieces": sum(v["count"] for v in placed.values()),
                 "products": sorted({v["item"] for v in placed.values() if v["kind"] == "product"}),
                 "triangles": product_tris},
        "bbox_twin": bbox(twin_nodes),
        "bbox_nav": bbox(nav_nodes),
        "nav_area_m2": round(float(nav_union.area), 1),
        "lod2": {"bakery": bakery["id"], "context": sorted(b["id"] for b in blds if b is not bakery)},
        "osm_ways": [w["id"] for w in ways],
        "sha256": {"twin.glb": hashlib.sha256(twin_glb).hexdigest(), "nav.glb": hashlib.sha256(nav_glb).hexdigest()},
    }
    frag = {
        "format": "bh-built-fragment-1",
        "assets": [{"id": "twin", "role": "scene", "raw": "twin.glb", "bboxLocal": report["bbox_twin"], "triangles": total},
                   {"id": "nav", "role": "collider", "raw": "nav.glb", "bboxLocal": report["bbox_nav"],
                    "triangles": report["triangles"]["nav"]}],
        "spawn": spawn,
        "portal": portal,
        "footprint": fp,
        "twin": {"method": "built-from-plan", "plan": raw.get("schema", "sle-raumplan/0.1"), "planVersion": PLAN_VERSION,
                 "catalogue": CATALOGUE_PATH, "scaleFactor": f, "nav": "nav"},
        "files": [{"raw": "catalogue.json", "path": CATALOGUE_PATH}],
        "pivotLocal": [round(float(p.frame.zone(np.array([*p.pivot, 0.0]))[k]), 2) for k in range(3)],
    }
    (out / "report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    (out / "slots.json").write_text(slots_json(sc, p, cat_doc), encoding="utf-8")
    (out / "package.json").write_text(json.dumps(frag, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    (out / "catalogue.json").write_text(json.dumps(catalogue_json(cat_doc, products_doc, placed), indent=1,
                                                   ensure_ascii=False) + "\n", encoding="utf-8")
    if update_catalogue:
        update_catalogue_rows(cat_doc, [n for n in twin_nodes if not n.name.startswith(PRODUCT_NODE)], p, sc.styled)
        CATALOGUE.write_text(json.dumps(cat_doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        SLOTS.write_text((out / "slots.json").read_text(encoding="utf-8"), encoding="utf-8")
    print(json.dumps({"out": str(out), "triangles": total, "nav": report["triangles"]["nav"], "budget_problems": over,
                      "nodes": len(twin_nodes)}, ensure_ascii=False))
    if over:
        raise SystemExit("build: over budget: " + "; ".join(over))
    return report


# ----------------------------------------------------------------------------------------------- catalogue

CATALOGUE_PATH = "built/catalogue.json"
PRODUCT_KEYS = ("name_de", "short_de", "info_de", "category", "price_eur", "sale_unit")


def catalogue_json(cat_doc: dict, products_doc: dict, placed: dict) -> dict:
    """The visitor's catalogue (`sle-zone-catalogue-v1`, docs/zone-contract.md): objects = built clickable rows with a
    card text (group = the nearest ancestor that has a card too), all products (prices only with the owners' consent),
    discoverable = every placed product + the rows marked `discover` in catalogue/objects.json."""
    prices = (cat_doc.get("consent") or {}).get("prices") is True
    # rows with `clickable: false` (the facade, the room shell: enclosing boxes, docs/zone-contract.md) never get a
    # card; grouping a facade detail under them made it unreachable from the floor (the group wins beyond 2.5 m)
    rows = [o for o in cat_doc["objects"] if o.get("status") in ("built", "verified") and (o.get("info_de") or "").strip()
            and o.get("public", True) and o.get("clickable", True) is not False]
    ids = {o["id"] for o in rows}
    objects = {}
    for o in rows:
        e = {"name_de": o["name_de"], "info_de": o["info_de"].strip()}
        parts = o["id"].split("/")
        for k in range(len(parts) - 1, 0, -1):
            if "/".join(parts[:k]) in ids:
                e["group"] = "/".join(parts[:k])
                break
        objects[o["id"]] = e
    products = {}
    for q in products_doc["products"]:
        e = {k: q.get(k) for k in PRODUCT_KEYS}
        if not prices:
            e["price_eur"] = None
        products[q["id"]] = e
    seen: list[str] = []
    for sid in sorted(placed):
        v = placed[sid]
        if v["kind"] == "product" and v["item"] not in seen:
            seen.append(v["item"])
    disc = seen + [o["id"] for o in rows if o.get("discover")]
    return {"schema": CATALOGUE_FORMAT, "consent": {"prices": prices}, "objects": objects, "products": products,
            "discoverable": disc}


FIXTURE_OF = {"theke": "F1", "brotregal": "F2", "gitterregal": "F3", "zeitungsaufsteller": "F4", "bistrotisch-1": "F5",
              "bistrotisch-2": "F6", "dosenregal": "F7", "haengelampe-1": "F8", "haengelampe-2": "F9",
              "verkaufsraum/deckenblende": "F10", "haengelampe-3": "F11", "haengelampe-4": "F12",
              "getraenkekuehlschrank": "F13", "wuerfelregal": "F14", "wuerfelregal/wandboards": "F15", "kaffeemaschine": "F16",
              "brotschneidemaschine": "F17", "arbeitstisch": "F18", "waermevitrine": "F19", "hocker": "F20",
              "prospektstaender": "F21", "wandbild-kaffee": "F22", "schirmstaender": "F23", "zimmerpflanze": "F24",
              "bleiglasbild": "F25", "bilderwand": "F26", "wanduhr": "F27", "fussmatte-eingang": "F28", "laeufer-theke": "F29",
              "tuetenhalter": "F30", "strahlerschiene-1": "F31", "strahlerschiene-2": "F32", "strahlerschiene-3": "F33",
              "schaufensterdeko-2": "F35", "schaufensterdeko-1": "F36"}


def slots_json(sc: Scene, p: Plan, cat_doc: dict) -> str:
    """catalogue/slots.json: product slots generated from the same fixture parameters as the geometry."""
    doc = {
        "format": SLOTS_FORMAT,
        "zone": "baeckerei-heusser",
        "frame": "zone (x = E − E0, y = height above sea level, z = −(N − N0)); pose = slot centre on its "
                 "standing surface, heading_deg = grid heading of the slot's front (where a customer looks from), "
                 "tilt_deg = slope of the standing surface (+ = back edge up)",
        "units": "m",
        "plan": {"version": PLAN_VERSION, "scale_factor": p.f},
        "catalogue": cat_doc["format"],
        "categories": list(SLOT_CATEGORIES),
        "note_de": "Produktplätze für Runde 4 (Produkte). Die Theke bleibt leer wie im Video. Kapazität = grobe Anzahl "
                   "Stück je Platz (Hinweis, keine Regel).",
        "slots": sorted(sc.slots, key=lambda s: s["id"]),
    }
    return json.dumps(doc, indent=1, ensure_ascii=False) + "\n"


def _node_points_b(nodes, F) -> np.ndarray:
    pts = [F.zone_to_b(pr.arrays()[0]) for n in nodes for pr in n.prims.values() if pr.nv]
    return np.concatenate(pts) if pts else np.zeros((0, 3))


def update_catalogue_rows(doc: dict, nodes, p: Plan, styled_nodes: set[str] = frozenset()) -> None:
    """status / dims / placement of every row that has geometry now (rows and their descendants' nodes). Rows with a
    styled model (round 3: `Scene.styled`) or of type structure become `built`, other geometry `blockout`; a
    blockout row without geometry any more falls back to `planned`."""
    F = p.frame
    for o in doc["objects"]:
        oid = o["id"]
        mine = [n for n in nodes if n.extras["id"] == oid or n.extras["id"].startswith(oid + "/")]
        if not mine:
            if o["status"] == "blockout":
                o["status"] = "planned"
            continue
        pts = _node_points_b(mine, F)
        fid = FIXTURE_OF.get(oid) or (FIXTURE_OF.get(oid.split("/")[0]) if o["type"] != "structure" else None)
        if fid:
            fx = p.fixtures[fid]
            ux, uy = fx.ux, fx.uy
            front = -uy
        else:
            ux, uy = np.array([1.0, 0.0]), np.array([0.0, 1.0])
            front = np.array([0.0, -1.0])
        lx, ly = pts[:, :2] @ ux, pts[:, :2] @ uy
        c = ux * (lx.min() + lx.max()) / 2 + uy * (ly.min() + ly.max()) / 2
        cz = F.zone(np.array([c[0], c[1], 0.0]))
        size = (lx.max() - lx.min(), ly.max() - ly.min(), pts[:, 2].max() - pts[:, 2].min())
        o["dims"] = dict(zip("wdh", (max(0.01, round(float(v), 2)) for v in size)))  # flat parts (floor): 1 cm
        o["placement"] = {"plan": {"x": round(float(cz[0]), 2), "z": round(float(cz[2]), 2),
                                   "base_m": round(float(pts[:, 2].min()), 2), "rot_deg": round(F.heading(front), 1)}}
        if o["status"] in ("planned", "blockout", "built"):
            styled = any(n.name in styled_nodes for n in mine)
            o["status"] = "built" if o["type"] == "structure" or styled else "blockout"


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=HERE / "out")
    ap.add_argument("--update-catalogue", action="store_true",
                    help="write status/dims/placement into catalogue/objects.json and the slots into catalogue/slots.json")
    ap.add_argument("--debug-slots", action="store_true", help="draw magenta slot markers (debug only, never release)")
    ap.add_argument("--no-lettering", dest="lettering", action="store_false",
                    help="leave out the shop's lettering on the facade (gable text, keystone inscription, sign name)")
    ap.add_argument("--fill", default=DEFAULT_FILL, choices=sorted(q.stem for q in FILLS.glob("*.json")),
                    help="products in the slots: morgens (default) or feierabend (empty, like the video)")
    a = ap.parse_args(argv)
    build(a.out.resolve(), a.update_catalogue, debug_slots=a.debug_slots, lettering=a.lettering, fill=a.fill)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
