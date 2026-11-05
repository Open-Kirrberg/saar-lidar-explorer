#!/usr/bin/env python3
"""Check the Bäckerei Heusser object catalogue (`bh-catalogue-v1`) and its product slots (`bh-slots-v1`, see
README.md). Stdlib only.

    python3 -I zones/baeckerei-heusser/catalogue/check.py [objects.json [slots.json]]

Exit 1 with one line per problem. `check(doc)` and `check_slots(doc, known_ids)` are the tested pure functions
(test_check.py). slots.json is checked when it exists next to objects.json (or is named).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

FORMAT = "bh-catalogue-v1"
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$")
TYPES = {"structure", "fixture", "appliance", "container", "product", "sign", "decor"}
AREAS = {"aussen", "verkaufsraum", "backstube", "lager"}
SOURCES = {"plan", "photo", "mesh", "tape"}
STATUSES = {"planned", "blockout", "built", "verified", "retired"}
REQUIRED = ("id", "type", "area", "name_de", "source", "sigma_m", "status", "clickable")
# privacy: refs name sources, never private files or paths (CLAUDE.md rule 7)
PRIVATE_REF = re.compile(r"(^[/~])|(\.(jpe?g|png|heic|webp|mp4|mov)\b)|(/Users/)|(privat/)", re.I)
PRICE_KEY = re.compile(r"(price|preis)", re.I)
SLOTS_FORMAT = "bh-slots-v1"
SLOT_CATEGORIES = ("brot", "broetchen", "laugengebaeck", "suesses", "kuchen", "glas", "dose", "flasche", "tuete")
SLOT_ID = re.compile(r"^(?P<fixture>[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*)/platz-(?P<k>\d{2})$")


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _keys(obj, path=""):
    """All dict keys in a nested structure, with their path."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield f"{path}.{k}" if path else k, k
            yield from _keys(v, f"{path}.{k}" if path else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _keys(v, f"{path}[{i}]")


def check(doc: dict) -> list[str]:
    errs: list[str] = []
    if not isinstance(doc, dict) or doc.get("format") != FORMAT:
        return [f"format must be {FORMAT!r}"]
    consent = doc.get("consent") or {}
    scope = set(consent.get("scope") or [])
    prices_ok = consent.get("prices") is True
    objs = doc.get("objects")
    if not isinstance(objs, list):
        return ["objects must be a list"]
    ids = [o.get("id") for o in objs if isinstance(o, dict)]
    known = set(ids)
    seen: set[str] = set()
    for o in objs:
        if not isinstance(o, dict):
            errs.append("object is not a dict")
            continue
        oid = o.get("id", "?")
        e = lambda msg: errs.append(f"{oid}: {msg}")  # noqa: E731
        for k in REQUIRED:
            if k not in o:
                e(f"missing {k}")
        if not isinstance(oid, str) or not ID_RE.match(oid):
            e("id must be lower-case segments a-z0-9- joined by '/'")
            continue
        if oid in seen:
            e("duplicate id")
        seen.add(oid)
        if "/" in oid and oid.rsplit("/", 1)[0] not in known:
            e(f"parent {oid.rsplit('/', 1)[0]!r} missing")
        if o.get("type") not in TYPES:
            e(f"type must be one of {sorted(TYPES)}")
        if o.get("area") not in AREAS:
            e(f"area must be one of {sorted(AREAS)}")
        if o.get("source") not in SOURCES:
            e(f"source must be one of {sorted(SOURCES)}")
        if o.get("status") not in STATUSES:
            e(f"status must be one of {sorted(STATUSES)}")
        s = o.get("sigma_m")
        if not _num(s) or not 0 <= s <= 5:
            e("sigma_m must be a number in 0..5 (metres, 1 sigma)")
        if not isinstance(o.get("clickable"), bool):
            e("clickable must be true or false")
        name = o.get("name_de")
        if not isinstance(name, str) or not name.strip() or len(name) > 60:
            e("name_de must be 1..60 chars")
        info = o.get("info_de", "")
        if not isinstance(info, str) or len(info) > 300:
            e("info_de must be a string <= 300 chars")
        elif o.get("clickable") and o.get("status") in ("built", "verified") and not info.strip():
            e("a built clickable object needs info_de (the info card)")
        dims = o.get("dims")
        if dims is not None and not (isinstance(dims, dict) and all(_num(dims.get(k)) and dims[k] > 0 for k in ("w", "d", "h"))):
            e("dims must be null or {w, d, h} > 0 (metres)")
        pl = o.get("placement")
        if pl is not None:
            if not isinstance(pl, dict) or len([k for k in ("plan", "rel") if k in pl]) != 1:
                e("placement must be null, {plan: {...}} or {rel: {...}}")
            elif "plan" in pl:
                p = pl["plan"]
                if not (isinstance(p, dict) and _num(p.get("x")) and _num(p.get("z")) and _num(p.get("rot_deg", 0)) and _num(p.get("base_m", 0))):
                    e("placement.plan needs numbers x, z (zone frame), optional base_m, rot_deg")
            else:
                r = pl["rel"]
                if not (isinstance(r, dict) and r.get("to") in known and r.get("to") != oid):
                    e("placement.rel.to must name another catalogue object")
                elif not (isinstance(r.get("offset"), list) and len(r["offset"]) == 3 and all(_num(v) for v in r["offset"])):
                    e("placement.rel.offset must be [right, up, forward] in metres")
        if o.get("status") not in ("planned", "retired", None) and (dims is None or pl is None):
            e("dims and placement are required once an object leaves 'planned'")
        for ref in o.get("refs", []):
            if not isinstance(ref, str) or PRIVATE_REF.search(ref):
                e(f"ref {ref!r} looks like a private file or path (describe the source instead)")
        if scope and o.get("area") not in scope and o.get("public", True):
            e(f"area {o.get('area')!r} is outside the consent scope {sorted(scope)}: set public false")
        if not prices_ok:
            for path, k in _keys(o):
                if PRICE_KEY.search(k):
                    e(f"{path}: prices need the owners' consent (consent.prices)")
    # rel placements must not form cycles
    rel = {o["id"]: o["placement"]["rel"]["to"] for o in objs if isinstance(o, dict) and isinstance(o.get("placement"), dict)
           and isinstance(o["placement"].get("rel"), dict) and isinstance(o["placement"]["rel"].get("to"), str)}
    for start in rel:
        cur, hops = start, 0
        while cur in rel and hops <= len(rel):
            cur, hops = rel[cur], hops + 1
        if hops > len(rel):
            errs.append(f"{start}: placement.rel forms a cycle")
    return errs


def check_slots(doc: dict, known_ids: set[str] | None = None) -> list[str]:
    """Product slots (`bh-slots-v1`): ids `<fixture id>/platz-NN`, the fixture a catalogue id, pose in the zone frame,
    usable size, capacity hint, allowed categories; never prices."""
    errs: list[str] = []
    if not isinstance(doc, dict) or doc.get("format") != SLOTS_FORMAT:
        return [f"slots: format must be {SLOTS_FORMAT!r}"]
    if list(doc.get("categories") or []) != list(SLOT_CATEGORIES):
        errs.append(f"slots: categories must be {list(SLOT_CATEGORIES)}")
    slots = doc.get("slots")
    if not isinstance(slots, list) or not slots:
        return errs + ["slots: slots must be a non-empty list"]
    seen: set[str] = set()
    for s in slots:
        if not isinstance(s, dict):
            errs.append("slots: slot is not a dict")
            continue
        sid = s.get("id", "?")
        e = lambda msg: errs.append(f"slot {sid}: {msg}")  # noqa: E731
        m = SLOT_ID.match(sid) if isinstance(sid, str) else None
        if not m:
            e("id must be '<fixture id>/platz-NN'")
        elif m["fixture"] != s.get("fixture"):
            e("id must start with its fixture id")
        if sid in seen:
            e("duplicate id")
        seen.add(sid)
        fx = s.get("fixture")
        if known_ids is not None and fx not in known_ids:
            e(f"fixture {fx!r} is not a catalogue id")
        pose = s.get("pose")
        if not (isinstance(pose, dict) and all(_num(pose.get(k)) for k in ("x", "y", "z", "heading_deg"))):
            e("pose needs numbers x, y, z (zone frame) and heading_deg")
        elif not 0 <= pose["heading_deg"] < 360:
            e("pose.heading_deg must be in 0..360")
        t = s.get("tilt_deg", 0)
        if not _num(t) or not -60 <= t <= 60:
            e("tilt_deg must be a number in -60..60")
        size = s.get("size")
        if not (isinstance(size, dict) and all(_num(size.get(k)) and 0 < size[k] <= 5 for k in ("w", "d", "h"))):
            e("size must be {w, d, h} in 0..5 m")
        cap = s.get("capacity")
        if not (isinstance(cap, int) and not isinstance(cap, bool) and 1 <= cap <= 500):
            e("capacity must be an integer 1..500 (pieces, a hint)")
        hint = s.get("capacity_de", "")
        if not isinstance(hint, str) or len(hint) > 120:
            e("capacity_de must be a string <= 120 chars")
        cats = s.get("categories")
        if not (isinstance(cats, list) and cats and len(set(cats)) == len(cats) and all(c in SLOT_CATEGORIES for c in cats)):
            e(f"categories must be a non-empty list from {list(SLOT_CATEGORIES)}")
    for path, k in _keys(doc):
        if PRICE_KEY.search(k):
            errs.append(f"slots: {path}: no prices in the slots")
    return errs


def main(argv: list[str]) -> int:
    path = Path(argv[0]) if argv else Path(__file__).resolve().parent / "objects.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    errs = check(doc)
    for msg in errs:
        print("  ✗", msg)
    n = len(doc.get("objects", []))
    print(f"{path.name}: {n} objects, {'OK' if not errs else f'{len(errs)} problem(s)'}")
    spath = Path(argv[1]) if len(argv) > 1 else path.parent / "slots.json"
    serrs: list[str] = []
    if spath.is_file():
        sdoc = json.loads(spath.read_text(encoding="utf-8"))
        known = {o.get("id") for o in doc.get("objects", []) if isinstance(o, dict)}
        serrs = check_slots(sdoc, known)
        for msg in serrs:
            print("  ✗", msg)
        print(f"{spath.name}: {len(sdoc.get('slots') or [])} slots, {'OK' if not serrs else f'{len(serrs)} problem(s)'}")
    return 1 if errs or serrs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
