"""V2.6: producer-side validator for zone packages (docs/zone-contract.md, sle-zone-v1).

Strict: every deviation is a problem (the app's TS parser, app/src/zones/contract.ts, is the
tolerant twin). Used by zone producers (castle export, tools/capture) before writing a package.

    uv run python -I zones.py <zone dir or zone.json> [...]   # exit 1 on problems
"""
from __future__ import annotations

import json
import math
import re
import struct
import sys
from pathlib import Path

ZONE_FORMAT = "sle-zone-v1"
ZONE_INDEX_FORMAT = "sle-zones-v1"
BUDGET_LIMITS = {
    "downloadBytes": 30_000_000,
    "totalBytes": 120_000_000,
    "triangles": 1_500_000,
    "textureBytesGpu": 128_000_000,
}
ALLOWED_GLTF_EXTENSIONS = {
    "EXT_meshopt_compression",
    "KHR_mesh_quantization",
    "KHR_texture_basisu",
    "KHR_materials_unlit",
    "KHR_texture_transform",
    "KHR_materials_emissive_strength",
}
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
ASSET_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
PATH_RE = re.compile(r"^[A-Za-z0-9_./-]+$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _utm(e, n) -> bool:
    return _num(e) and _num(n) and 100_000 < e < 900_000 and 1_000_000 < n < 9_500_000


def safe_path(p) -> bool:
    return (
        isinstance(p, str)
        and 0 < len(p) <= 200
        and bool(PATH_RE.match(p))
        and not p.startswith("/")
        and all(seg not in ("", ".", "..") for seg in p.split("/"))
    )


def _ring(points) -> list[tuple[float, float]] | None:
    ring: list[tuple[float, float]] = []
    for p in points:
        t = (p[0], p[1])
        if not ring or ring[-1] != t:
            ring.append(t)
    while len(ring) > 1 and ring[0] == ring[-1]:
        ring.pop()
    if len(ring) < 3:
        return None
    area = sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring))) / 2
    return ring if abs(area) >= 1e-6 else None


def _orient(a, b, c) -> int:
    v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    return (v > 0) - (v < 0)


def _on_seg(a, b, p) -> bool:
    return min(a[0], b[0]) <= p[0] <= max(a[0], b[0]) and min(a[1], b[1]) <= p[1] <= max(a[1], b[1])


def _cross(p1, p2, q1, q2) -> bool:
    o1, o2, o3, o4 = _orient(p1, p2, q1), _orient(p1, p2, q2), _orient(q1, q2, p1), _orient(q1, q2, p2)
    if o1 != o2 and o3 != o4:
        return True
    return (o1 == 0 and _on_seg(p1, p2, q1)) or (o2 == 0 and _on_seg(p1, p2, q2)) or (o3 == 0 and _on_seg(q1, q2, p1)) or (o4 == 0 and _on_seg(q1, q2, p2))


def ring_is_simple(ring) -> bool:
    n = len(ring)
    for i in range(n):
        for j in range(i + 1, n):
            if j == i + 1 or (i == 0 and j == n - 1):
                continue
            if _cross(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n]):
                return False
    return True


def _pose(p) -> bool:
    return (
        isinstance(p, dict)
        and _utm(p.get("E"), p.get("N"))
        and _num(p.get("h"))
        and _num(p.get("heading_deg"))
        and _num(p.get("pitch_deg"))
        and -90 <= p["pitch_deg"] <= 90
        and p.get("mode") in ("gehen", "fliegen")
    )


def validate_manifest(m, modules: set[str] | None = None) -> list[str]:
    """All contract violations of a parsed zone.json (empty list = valid)."""
    errs: list[str] = []
    e = errs.append
    if not isinstance(m, dict):
        return ["zone.json: not an object"]
    if m.get("format") != ZONE_FORMAT:
        e(f"format must be {ZONE_FORMAT}")
    if m.get("crs") != "EPSG:25832":
        e("crs must be EPSG:25832")
    if not isinstance(m.get("id"), str) or not ID_RE.match(m["id"]):
        e("invalid id")
    kind = m.get("kind")
    if kind not in ("reconstructed", "captured"):
        e("invalid kind")
    o = m.get("origin")
    if not (isinstance(o, dict) and isinstance(o.get("E0"), int) and isinstance(o.get("N0"), int) and _utm(o["E0"], o["N0"])):
        e("invalid origin")
    fp = m.get("footprint")
    if not (isinstance(fp, list) and all(isinstance(p, list) and len(p) == 2 and _utm(p[0], p[1]) for p in fp)):
        e("invalid footprint")
    else:
        ring = _ring(fp)
        if ring is None:
            e("footprint: < 3 distinct vertices or zero area")
        elif not ring_is_simple(ring):
            e("footprint: self-intersecting")

    spawns = m.get("spawns") if isinstance(m.get("spawns"), dict) else {}
    if not spawns:
        e("no spawn")
    for k, v in spawns.items():
        if not ID_RE.match(k) or not _pose(v):
            e(f"spawns.{k}: invalid pose")

    portals = m.get("portals") if isinstance(m.get("portals"), list) else []
    if not portals:
        e("no portal")
    seen: set[str] = set()
    for i, p in enumerate(portals):
        at = f"portals[{i}]"
        if not isinstance(p, dict):
            e(f"{at}: not an object")
            continue
        pid = p.get("id")
        if not isinstance(pid, str) or not ID_RE.match(pid) or pid in seen:
            e(f"{at}: invalid or duplicate id")
        seen.add(str(pid))
        if not _utm(p.get("E"), p.get("N")):
            e(f"{at}: invalid E/N")
        if p.get("h") is not None and not _num(p.get("h")):
            e(f"{at}: invalid h")
        if not (_num(p.get("radius_m")) and 1 <= p["radius_m"] <= 2000):
            e(f"{at}: radius_m must be 1-2000")
        if not (_num(p.get("facing_deg")) and 0 <= p["facing_deg"] < 360):
            e(f"{at}: facing_deg must be in [0, 360)")
        if not (isinstance(p.get("label_de"), str) and 0 < len(p["label_de"].strip()) <= 40):
            e(f"{at}: label_de must be 1-40 chars")
        if p.get("spawn") not in spawns:
            e(f"{at}: unknown spawn")

    if m.get("exit", {"rule": "restore"}) != {"rule": "restore"}:
        e('exit: only {"rule": "restore"}')

    rt = m.get("runtime")
    if rt == {"kind": "gltf"}:
        runtime = "gltf"
    elif isinstance(rt, dict) and rt.get("kind") == "module" and isinstance(rt.get("module"), str) and ID_RE.match(rt["module"]):
        runtime = "module"
        if modules is not None and rt["module"] not in modules:
            e(f"zone module {rt['module']} not registered")
    else:
        runtime = None
        e("invalid runtime")

    assets = m.get("assets", [])
    seen = set()
    roles: dict[str, str] = {}
    scene = False
    first_view = 0
    if not isinstance(assets, list):
        e("assets: not a list")
        assets = []
    for i, a in enumerate(assets):
        at = f"assets[{i}]"
        if not isinstance(a, dict) or not isinstance(a.get("id"), str) or not ASSET_ID_RE.match(a["id"]) or a["id"] in seen:
            e(f"{at}: invalid or duplicate id")
            continue
        seen.add(a["id"])
        if a.get("role") not in ("scene", "collider", "reference"):
            e(f"{at}: unknown role")
            continue
        roles[a["id"]] = a["role"]
        lods = a.get("lods")
        if not isinstance(lods, list) or not lods:
            e(f"{at}: no lods")
            continue
        prev = -math.inf
        for k, lod in enumerate(lods):
            last = k == len(lods) - 1
            if not isinstance(lod, dict) or not safe_path(lod.get("path")) or not lod["path"].endswith(".glb"):
                e(f"{at}.lods[{k}]: invalid path")
                continue
            u = lod.get("until_m")
            if (last and u is not None) or (not last and not (_num(u) and u > prev)):
                e(f"{at}.lods[{k}]: until_m must increase and be null on the last level")
            elif not last:
                prev = u
            for key in ("bytes", "triangles"):
                if key in lod and not (_num(lod[key]) and lod[key] >= 0):
                    e(f"{at}.lods[{k}].{key}: invalid")
        b = a.get("bboxLocal")
        if b is not None and not (
            isinstance(b, list) and len(b) == 2 and all(isinstance(v, list) and len(v) == 3 and all(_num(x) for x in v) for v in b) and all(b[0][j] < b[1][j] for j in range(3))
        ):
            e(f"{at}: invalid bboxLocal")
        if a["role"] == "scene":
            scene = True
            last_lod = lods[-1] if isinstance(lods[-1], dict) else {}
            first_view += last_lod.get("bytes", 0) if _num(last_lod.get("bytes", 0)) else 0
    if runtime == "gltf" and not scene:
        e("gltf runtime needs a scene asset")

    tw = m.get("twin")  # built twin (ADR 0042): optional, captured zones only
    if tw is not None:
        rs = tw.get("referenceScale") if isinstance(tw, dict) else None
        piv = rs.get("pivotLocal") if isinstance(rs, dict) else None
        if not isinstance(tw, dict) or kind != "captured":
            e("twin: an object, only for captured zones")
        elif not (tw.get("method") == "built-from-plan" and isinstance(tw.get("plan"), str) and isinstance(tw.get("planVersion"), str)
                  and _num(tw.get("scaleFactor")) and 0.5 <= tw["scaleFactor"] <= 2):
            e("twin: invalid (method built-from-plan, plan, planVersion, scaleFactor 0.5-2)")
        elif "nav" in tw and roles.get(tw["nav"]) != "collider":
            e("twin.nav must name a collider asset")
        elif rs is not None and not (isinstance(rs, dict) and _num(rs.get("factor")) and 0.5 <= rs["factor"] <= 2
                                     and isinstance(piv, list) and len(piv) == 3 and all(_num(v) for v in piv)):
            e("twin.referenceScale: invalid (factor 0.5-2, pivotLocal [x, y, z])")
        elif isinstance(m.get("capture"), dict) and isinstance(m["capture"].get("scale"), dict) and m["capture"]["scale"].get("factor") != 1:
            e("twin: capture.scale.factor must be 1 (the twin is built at true scale, see twin.referenceScale)")
        elif "catalogue" in tw and not (isinstance(tw["catalogue"], str) and 0 < len(tw["catalogue"]) <= 80
                                        and (not tw["catalogue"].endswith(".json") or safe_path(tw["catalogue"]))):
            e("twin.catalogue: a format name (old packages) or the package path of the catalogue file (built/catalogue.json)")

    pr = m.get("preset")
    if pr is not None:
        if not isinstance(pr, dict):
            e("preset: not an object")
        else:
            if pr.get("look") not in ("kino", "dokumentation", "natur"):
                e("preset.look invalid")
            if pr.get("sky") not in ("shared", "none"):
                e("preset.sky invalid")
            if pr.get("trees") not in ("shared", "none"):
                e("preset.trees invalid")
            t = pr.get("timeOfDay", "now")
            if t != "now" and not (isinstance(t, dict) and DATE_RE.match(str(t.get("date", ""))) and TIME_RE.match(str(t.get("time", "")))):
                e("preset.timeOfDay invalid")
            if "exposure" in pr and not (_num(pr["exposure"]) and 0.25 <= pr["exposure"] <= 4):
                e("preset.exposure out of 0.25-4")

    att = m.get("attribution")
    if not (isinstance(att, list) and att and all(isinstance(s, str) and s.strip() and ";" not in s for s in att)):
        e('attribution: >= 1 entry, strings without ";"')

    ev = m.get("evidence")
    if not isinstance(ev, dict):
        e("evidence: missing")
    else:
        want = "capture" if kind == "captured" else "hypothesis"
        if ev.get("kind") != want:
            e(f"evidence.kind must be {want} for kind {kind}")
        if ev.get("confidence") not in ("high", "med", "low"):
            e("evidence.confidence invalid")
        if ev.get("perPart", "none") not in ("_CONF", "extras", "none"):
            e("evidence.perPart invalid")
        src = ev.get("sources_de", [])
        if not (isinstance(src, list) and len(src) <= 10 and all(isinstance(s, str) for s in src)):
            e("evidence.sources_de: <= 10 strings")

    cap = m.get("capture")
    if kind == "captured":
        g = cap.get("georef") if isinstance(cap, dict) else None
        ok = (
            isinstance(cap, dict)
            and DATE_RE.match(str(cap.get("date", "")))
            and cap.get("method") == "photogrammetry-mesh"
            and isinstance(g, dict)
            and isinstance(g.get("method"), str)
            and _num(g.get("controlPoints"))
            and _num(g.get("rmsError_m"))
            and isinstance(cap.get("privacy"), str)
            and cap["privacy"].strip()
        )
        if not ok:
            e("capture: invalid (date, method, georef{method, controlPoints, rmsError_m}, privacy)")
        sc = cap.get("scale") if isinstance(cap, dict) else None
        if sc is not None:
            piv = sc.get("pivotLocal") if isinstance(sc, dict) else None
            if not (isinstance(sc, dict) and _num(sc.get("factor")) and 0.5 <= sc["factor"] <= 2
                    and isinstance(piv, list) and len(piv) == 3 and all(_num(v) for v in piv)):
                e("capture.scale: invalid (factor 0.5-2, pivotLocal [x, y, z])")
    elif cap is not None:
        e("capture: only for captured zones")

    bud = m.get("budget")
    if not (isinstance(bud, dict) and all(_num(bud.get(k)) and bud[k] >= 0 for k in BUDGET_LIMITS)):
        e("budget: missing or invalid")
    else:
        for k, lim in BUDGET_LIMITS.items():
            if bud[k] > lim:
                e(f"budget.{k} {bud[k]} > {lim}")
        if first_view > bud["downloadBytes"]:
            e(f"coarsest LODs ({first_view} B) exceed budget.downloadBytes")
    return errs


def glb_extensions_required(path: Path) -> list[str]:
    """`extensionsRequired` of a GLB (reads only the JSON chunk)."""
    with path.open("rb") as f:
        magic, version, _length = struct.unpack("<4sII", f.read(12))
        if magic != b"glTF" or version != 2:
            raise ValueError("not a glTF 2.0 binary")
        chunk_len, chunk_type = struct.unpack("<I4s", f.read(8))
        if chunk_type != b"JSON":
            raise ValueError("first chunk is not JSON")
        doc = json.loads(f.read(chunk_len))
    return list(doc.get("extensionsRequired", []))


CATALOGUE_SCHEMA = "sle-zone-catalogue-v1"


def validate_catalogue(doc) -> list[str]:
    """The visitor's catalogue of a built twin (`twin.catalogue` = its package path, docs/zone-contract.md)."""
    if not isinstance(doc, dict) or doc.get("schema") != CATALOGUE_SCHEMA:
        return [f"catalogue: schema must be {CATALOGUE_SCHEMA!r}"]
    errs = []
    prices = isinstance(doc.get("consent"), dict) and doc["consent"].get("prices") is True
    objs, prods, disc = doc.get("objects"), doc.get("products"), doc.get("discoverable")
    if not isinstance(objs, dict) or not isinstance(prods, dict) or not isinstance(disc, list):
        return errs + ["catalogue: needs objects {}, products {}, discoverable []"]
    for k, o in objs.items():
        if not (isinstance(o, dict) and isinstance(o.get("name_de"), str) and o["name_de"].strip()
                and isinstance(o.get("info_de"), str) and o["info_de"].strip() and len(o["info_de"]) <= 300):
            errs.append(f"catalogue: object {k}: name_de and info_de (≤ 300 chars) required")
        elif "group" in o and (o["group"] not in objs or not k.startswith(o["group"] + "/")):
            errs.append(f"catalogue: object {k}: group must be an ancestor id in objects")
    for k, q in prods.items():
        if not (isinstance(q, dict) and isinstance(q.get("name_de"), str) and q["name_de"].strip()):
            errs.append(f"catalogue: product {k}: name_de required")
            continue
        pr = q.get("price_eur")
        if pr is not None and not (prices and _num(pr) and pr >= 0):
            errs.append(f"catalogue: product {k}: price_eur only with consent.prices (a number ≥ 0) or null")
    if len(set(map(str, disc))) != len(disc) or not all(isinstance(d, str) and (d in objs or d in prods) for d in disc):
        errs.append("catalogue: discoverable must list unique ids from objects or products")
    return errs


def validate_package(zone_dir: Path, modules: set[str] | None = None) -> list[str]:
    """Manifest + files: every LOD exists, declared bytes match, only allowed glTF extensions, folder = id."""
    zone_dir = Path(zone_dir)
    mf = zone_dir / "zone.json"
    try:
        m = json.loads(mf.read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        return [f"zone.json: {err}"]
    errs = validate_manifest(m, modules)
    if isinstance(m, dict) and m.get("id") != zone_dir.name:
        errs.append(f"folder name {zone_dir.name} != id {m.get('id')}")
    total = 0
    for a in m.get("assets", []) if isinstance(m, dict) and isinstance(m.get("assets"), list) else []:
        for lod in a.get("lods", []) if isinstance(a, dict) and isinstance(a.get("lods"), list) else []:
            if not isinstance(lod, dict) or not safe_path(lod.get("path")):
                continue
            f = zone_dir / lod["path"]
            if not f.is_file():
                errs.append(f"{lod['path']}: missing")
                continue
            size = f.stat().st_size
            total += size
            if _num(lod.get("bytes")) and lod["bytes"] != size:
                errs.append(f"{lod['path']}: bytes {lod['bytes']} != file size {size}")
            try:
                bad = sorted(set(glb_extensions_required(f)) - ALLOWED_GLTF_EXTENSIONS)
            except (OSError, ValueError, struct.error) as err:
                errs.append(f"{lod['path']}: {err}")
                continue
            if bad:
                errs.append(f"{lod['path']}: extensions not allowed: {', '.join(bad)}")
    tw = m.get("twin") if isinstance(m, dict) else None
    cat = tw.get("catalogue") if isinstance(tw, dict) else None
    if isinstance(cat, str) and cat.endswith(".json") and safe_path(cat):
        f = zone_dir / cat
        try:
            errs += validate_catalogue(json.loads(f.read_text(encoding="utf-8")))
            total += f.stat().st_size
        except (OSError, ValueError) as err:
            errs.append(f"{cat}: {err}")
    bud = m.get("budget") if isinstance(m, dict) else None
    if isinstance(bud, dict) and _num(bud.get("totalBytes")) and total > bud["totalBytes"]:
        errs.append(f"assets total {total} B > budget.totalBytes")
    return errs


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__.strip().splitlines()[-1])
        return 2
    rc = 0
    for a in argv:
        p = Path(a)
        errs = validate_package(p.parent if p.name == "zone.json" else p)
        print(f"{a}: {'ok' if not errs else f'{len(errs)} problem(s)'}")
        for err in errs:
            print(f"  - {err}")
        rc |= bool(errs)
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
