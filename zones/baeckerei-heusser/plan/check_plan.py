#!/usr/bin/env python3
"""Check the Raumplan (`sle-raumplan/0.1`, see README.md). Stdlib only.

    python3 -I zones/baeckerei-heusser/plan/check_plan.py [raumplan.json] [--private]

Rules: every measured value is `{v, sigma_m, source}`, every point `{xy, sigma_m, source}`, every fixture and
opening carries a source and a sigma, references (wall points, opening walls, polygon) resolve, the plan's
`scale.factor` equals the one scale factor in tools/capture/zones/baeckerei-heusser.toml, and (public file, the
default) nothing beyond the shop's passage door and no courtyard is in it (bh-datenschutz). `--private` skips the
privacy rules for the full plan in the private folder. `check(doc, public=True)` is the tested pure function.

The public *sources* are checked too (`scan_sources`): the generator scripts (plan/scripts, build/) must not name
private places, and no public file under the zone's plan/ and build/ may contain a private coordinate pair. Those
pairs are listed as `fingerprints` in the private facts file (private folder only); without it the word scan runs alone.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
TOML = REPO / "tools" / "capture" / "zones" / "baeckerei-heusser.toml"
SCHEMA = "sle-raumplan/0.1"
SOURCES = {"lod2", "dgm1", "alkis", "osm", "mesh", "photo", "tape", "video", "nutzerangabe"}
PASSAGE_X = 24.6          # frame B: the covered passage lies at x > 24.6 (outside the bakery's north wall)
PASSAGE_PUBLIC_Y = 1.60   # ... and is public only up to the shop's passage door
PRIVATE_WORDS = re.compile(r"\b(Hof|Hauseingang|Briefkasten|Zähler\w*|Klingel\w*)\b", re.I)
PRIVATE_FACTS = Path(os.environ.get("BH_PRIVAT", REPO.parent / "baeckerei-heusser-privat")) / "plan" / "work" / "private_facts.json"
ZONE = HERE.parent
PRIVATE_PATH = re.compile(r"(/Users/|baeckerei-heusser-privat|\.(jpe?g|png|heic|mov|mp4)\b)", re.I)


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _source_ok(s) -> bool:
    return isinstance(s, str) and bool(s) and all(p in SOURCES for p in s.split("+"))


def _walk(obj, path=""):
    if isinstance(obj, dict):
        yield path, obj
        for k, v in obj.items():
            yield from _walk(v, f"{path}.{k}" if path else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _walk(v, f"{path}[{i}]")


def _strings(obj, path=""):
    if isinstance(obj, str):
        yield path, obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from _strings(v, f"{path}.{k}" if path else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _strings(v, f"{path}[{i}]")


def _sigma_source(errs, at, d, need_sigma=True):
    if not _source_ok(d.get("source")):
        errs.append(f"{at}: source {d.get('source')!r} must be one of {sorted(SOURCES)} (joined with '+')")
    s = d.get("sigma_m")
    if need_sigma and not (_num(s) and 0 <= s <= 10):
        errs.append(f"{at}: sigma_m must be a number 0..10 (metres, 1 sigma)")


def check(doc, public: bool = True, toml_factor: float | None = None) -> list[str]:
    errs: list[str] = []
    if not isinstance(doc, dict) or doc.get("schema") != SCHEMA:
        return [f"schema must be {SCHEMA!r}"]
    for k in ("frame", "scale", "site", "levels", "sources"):
        if k not in doc:
            errs.append(f"missing {k}")
    # every measured value: {v, sigma_m, source}
    for at, d in _walk(doc):
        if "v" in d:
            if not (_num(d["v"]) or d["v"] is None):
                errs.append(f"{at}: v must be a number")
            _sigma_source(errs, at, d)
    levels = doc.get("levels") or []
    for li, lvl in enumerate(levels):
        for ri, room in enumerate(lvl.get("rooms", [])):
            rat = f"levels[{li}].rooms[{ri}]({room.get('id')})"
            pts = room.get("points") or {}
            for pid, p in pts.items():
                if not (isinstance(p, dict) and isinstance(p.get("xy"), list) and len(p["xy"]) == 2 and all(_num(v) for v in p["xy"])):
                    errs.append(f"{rat}.points.{pid}: xy must be [x, y]")
                    continue
                _sigma_source(errs, f"{rat}.points.{pid}", p)
            for pid in room.get("polygon", []):
                if pid not in pts:
                    errs.append(f"{rat}.polygon: unknown point {pid}")
            walls = {w.get("id"): w for w in room.get("walls", [])}
            for w in walls.values():
                for k in ("from", "to"):
                    if w.get(k) not in pts:
                        errs.append(f"{rat}.walls.{w.get('id')}: {k} {w.get(k)!r} is not a room point")
                if not isinstance(w.get("length"), dict):
                    errs.append(f"{rat}.walls.{w.get('id')}: length {{v, sigma_m, source}} missing")
            for o in room.get("openings", []):
                oat = f"{rat}.openings.{o.get('id')}"
                if o.get("wall") is not None and o["wall"] not in walls:
                    errs.append(f"{oat}: unknown wall {o['wall']!r}")
                if not isinstance(o.get("width"), dict):
                    errs.append(f"{oat}: width {{v, sigma_m, source}} missing")
                for k in ("from", "to"):
                    if not (isinstance(o.get(k), list) and len(o[k]) == 2 and all(_num(v) for v in o[k])):
                        errs.append(f"{oat}: {k} must be [x, y]")
            for f in room.get("fixtures", []):
                fat = f"{rat}.fixtures.{f.get('id')}"
                _sigma_source(errs, fat, f)
                pose = f.get("pose")
                if not (isinstance(pose, dict) and isinstance(pose.get("xy"), list) and _num(pose.get("rot_deg"))):
                    errs.append(f"{fat}: pose {{xy, z, rot_deg}} missing")
                size = f.get("size") or {}
                if not all(_num(size.get(k)) for k in ("l", "d")):
                    errs.append(f"{fat}: size {{l, d, h}} missing")
    for f in (doc.get("site") or {}).get("fixtures", []):
        if f.get("pose") is not None:
            _sigma_source(errs, f"site.fixtures.{f.get('id')}", f)
    # one scale factor for plan and zone
    sc = doc.get("scale") or {}
    if not (_num(sc.get("factor")) and 0.5 <= sc["factor"] <= 2):
        errs.append("scale.factor must be a number 0.5..2")
    elif toml_factor is not None and abs(sc["factor"] - toml_factor) > 1e-9:
        errs.append(f"scale.factor {sc['factor']} != package.scale_factor {toml_factor} in {TOML.name} (one factor drives plan and zone)")
    if public:
        errs += privacy(doc)
    return errs


def privacy(doc) -> list[str]:
    """Public file: nothing beyond the shop's passage door, no courtyard, no private paths."""
    errs = []
    for at, s in _strings(doc):
        if PRIVATE_WORDS.search(s):
            errs.append(f"{at}: {s!r} names something outside the consent scope")
        if PRIVATE_PATH.search(s):
            errs.append(f"{at}: {s!r} looks like a private file or path")
    for at, d in _walk(doc):
        for key in ("xy", "from", "to"):
            p = d.get(key)
            if isinstance(p, list) and len(p) == 2 and all(_num(v) for v in p) and p[0] > PASSAGE_X and p[1] > PASSAGE_PUBLIC_Y:
                if at.startswith("site.building") or at.startswith("site.neighbours") or at.startswith("site.parcel"):
                    continue  # survey outlines (LoD2/ALKIS) are public geodata, not details of the passage
                errs.append(f"{at}.{key}: {p} lies in the private part of the passage (x > {PASSAGE_X}, y > {PASSAGE_PUBLIC_Y})")
    return errs


def source_files() -> tuple[list[Path], list[Path]]:
    """(generator scripts, all public text files) of the zone's plan/ and build/ folders."""
    gens = sorted((HERE / "scripts").glob("*.py")) + sorted(p for p in (ZONE / "build").rglob("*.py") if "out" not in p.parts)
    texts = set(gens)
    for base in (HERE, ZONE / "build"):
        for p in base.rglob("*"):
            if p.is_file() and p.suffix in (".py", ".md", ".sh", ".json", ".svg", ".toml", ".mjs", ".ts") and "out" not in p.relative_to(base).parts:
                texts.add(p)
    return gens, sorted(texts)


def _fp_pattern(pair) -> re.Pattern:
    def n(x):
        t = f"{float(x):.3f}".rstrip("0")
        t = t + "0" if t.endswith(".") else t
        return re.escape(t) + "0*"
    return re.compile(r"(?<![\d.])" + n(pair[0]) + r"\s*,\s*" + n(pair[1]) + r"(?!\d)")


def scan_sources(gens, texts, fingerprints=()) -> list[str]:
    """Private words in generator scripts (lines defining a regex are exempt: they are the redaction rules) and
    private coordinate pairs anywhere in the public files."""
    errs = []
    for p in gens:
        for i, ln in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            if "re.compile(" not in ln and PRIVATE_WORDS.search(ln):
                errs.append(f"{p.name}:{i}: names something outside the consent scope: {ln.strip()[:80]!r}")
    pats = [(fp, _fp_pattern(fp)) for fp in fingerprints]
    for p in texts:
        text = p.read_text(encoding="utf-8", errors="replace")
        for fp, pat in pats:
            m = pat.search(text)
            if m:
                line = text.count("\n", 0, m.start()) + 1
                errs.append(f"{p.name}:{line}: contains a private coordinate pair (see private facts)")
    return errs


def private_fingerprints() -> list:
    try:
        return json.loads(PRIVATE_FACTS.read_text(encoding="utf-8")).get("fingerprints", [])
    except FileNotFoundError:
        return []


def toml_scale_factor() -> float | None:
    """`package.scale_factor` from the capture TOML (regex: python3 < 3.11 has no tomllib); missing -> 1."""
    try:
        text = TOML.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    m = re.search(r"(?m)^\s*scale_factor\s*=\s*([0-9.]+)", text)
    return float(m.group(1)) if m else 1.0


def main(argv: list[str]) -> int:
    private = "--private" in argv
    args = [a for a in argv if not a.startswith("--")]
    path = Path(args[0]) if args else HERE / "raumplan-v0.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    errs = check(doc, public=not private, toml_factor=toml_scale_factor())
    if not private:
        fps = private_fingerprints()
        errs += scan_sources(*source_files(), fps)
        print(f"sources: scanned plan/ + build/ ({'with' if fps else 'without'} private fingerprints)")
    for msg in errs:
        print("  ✗", msg)
    print(f"{path.name}: {'OK' if not errs else f'{len(errs)} problem(s)'}{' (private: privacy rules skipped)' if private else ''}")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
