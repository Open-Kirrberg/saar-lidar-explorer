#!/usr/bin/env python3
"""Stage the public data repositories for GitHub Pages (stdlib only, Python >= 3.9).

Run through export-data.sh (it sources release.env). Two outputs, both plain static sites:

  <out1> = saar-lidar-data     AOI dataset without the Leaflet tiles (manifest rewritten), pois.geojson,
                               shared/ (F19 reconstruction), castle-viewer/terrain/ (fetched by the Pages
                               workflow to build the castle viewer)
  <out2> = saar-lidar-data-2   Leaflet XYZ tiles up to --xyz-max-zoom, 3D-print series (3MF + previews,
                               no tile STL)

UXO candidate classes (`crater`, `crater_field`, F22, from saar-lidar-detect) are private and never
exported: `strip_private_candidates` removes them from candidates.geojson, the manifest and the
class8 masks (codes 6/7 -> 0) before anything is staged. Of `candidates/` only the manifest's
GeoJSON and mask chunks are staged; saar-lidar-detect side files in the AOI dir (run.json, report.html,
eval.*, fachbericht/, manifest backups, staging dirs) never are, and the export aborts when a staged
AOI text file still names a UXO class.

Idempotent: files are copied only when size/mtime differ, generated files only when their content
changes, and files no longer planned are deleted (a `.git/` directory is never touched).
Exit code 2 when a GitHub Pages hard limit is exceeded.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import shutil
import struct
import sys
import zlib
from pathlib import Path
from typing import Dict, List, Tuple, Union

Source = Union[Path, bytes]
Plan = Dict[str, Source]

HERE = Path(__file__).resolve().parent
TEMPLATES = HERE / "templates"

# F22: UXO indicator classes (bomb craters, crater fields) — private, never part of a public export.
PRIVATE_CANDIDATE_CLASSES = ("crater", "crater_field")
PRIVATE_MASK_CODES = (6, 7)
PNG_SIG = b"\x89PNG\r\n\x1a\n"
# Side outputs of saar-lidar-detect (`sld run/report/eval/fachbericht/export-explorer`) that may land in
# an explorer AOI dir; all of them can carry crater coordinates or counts. Matched on the path relative
# to the AOI dir; never staged.
PRIVATE_AOI_FILES = re.compile(
    r"^(?:run\.json|report(?:_[^/]*)?\.html|eval(?:_[^/]*)?\.(?:json|md)|labels\.jsonl|fachbericht(?:_[^/]*)?(?:/.*|\.[a-z]+)?"
    r"|manifest\.json\.bak[^/]*|[^/]*\.sld-new/.*)$"
)
# Last line of defence: no staged AOI text file may still name a UXO class (case-insensitive).
UXO_TEXT_SUFFIXES = (".json", ".geojson", ".html", ".md", ".txt", ".jsonl", ".csv", ".toml")
UXO_TEXT_MARKERS = re.compile(rb"(?i)crater|bombentrichter|trichterfeld")


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def png_gray8_decode(data: bytes) -> Tuple[int, int, bytearray]:
    """Decode an 8-bit greyscale, non-interlaced PNG (the class8 mask format) to raw row-major bytes.
    Raises ValueError for anything else (the caller aborts the export rather than guess)."""
    if not data.startswith(PNG_SIG):
        raise ValueError("not a PNG")
    pos, idat, ihdr = 8, [], None
    while pos + 8 <= len(data):
        n, kind = struct.unpack(">I4s", data[pos : pos + 8])
        body = data[pos + 8 : pos + 8 + n]
        if kind == b"IHDR":
            ihdr = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            idat.append(body)
        elif kind == b"IEND":
            break
        pos += 12 + n
    if ihdr is None:
        raise ValueError("no IHDR")
    w, h, depth, ctype, _comp, _filt, interlace = ihdr
    if depth != 8 or ctype != 0 or interlace != 0:
        raise ValueError(f"unsupported PNG (bit depth {depth}, colour type {ctype}, interlace {interlace}); expected 8-bit grey")
    raw = zlib.decompress(b"".join(idat))
    if len(raw) != h * (w + 1):
        raise ValueError("truncated PNG data")
    out = bytearray(w * h)
    prev = bytearray(w)
    for r in range(h):
        f = raw[r * (w + 1)]
        line = bytearray(raw[r * (w + 1) + 1 : (r + 1) * (w + 1)])
        for x in range(w if f else 0):
            a = line[x - 1] if x else 0
            b = prev[x]
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + ((a + b) >> 1)) & 255
            elif f == 4:
                c = prev[x - 1] if x else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
            elif f != 0:
                raise ValueError(f"bad PNG filter {f}")
        out[r * w : (r + 1) * w] = line
        prev = line
    return w, h, out


def png_gray8_encode(w: int, h: int, pixels: bytes) -> bytes:
    raw = b"".join(b"\x00" + bytes(pixels[r * w : (r + 1) * w]) for r in range(h))
    return (
        PNG_SIG
        + _png_chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
        + _png_chunk(b"IDAT", zlib.compress(raw, 9))
        + _png_chunk(b"IEND", b"")
    )


def strip_private_candidates(aoi_dir: Path, aoi: str, manifest: dict, plan1: Plan) -> dict:
    """Remove the UXO classes from the planned candidates.geojson, the manifest `candidates` key and
    the class8 masks (in place in `plan1`/`manifest`). Files without private content stay plain copies.
    Returns counts for the log. Exits (no export) on a mask it cannot decode."""
    stats = {"features": 0, "masks": 0}
    cand = manifest.get("candidates")
    if not isinstance(cand, dict):
        return stats
    gpath = cand.get("path") if isinstance(cand.get("path"), str) else "candidates/candidates.geojson"
    key = f"{aoi}/{gpath}"
    src = plan1.get(key)
    if isinstance(src, Path) and src.is_file():
        fc = json.loads(src.read_text(encoding="utf-8"))
        feats = fc.get("features") or []
        keep = [f for f in feats if ((f or {}).get("properties") or {}).get("class") not in PRIVATE_CANDIDATE_CLASSES]
        stats["features"] = len(feats) - len(keep)
        if stats["features"]:
            fc["features"] = keep
            plan1[key] = (json.dumps(fc, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
            cand["featureCount"] = len(keep)
    for k in ("counts", "classes"):
        if isinstance(cand.get(k), dict):
            for c in PRIVATE_CANDIDATE_CLASSES:
                cand[k].pop(c, None)
    if isinstance(cand.get("params"), dict):
        cand["params"].pop("crater_threshold", None)
    if isinstance(cand.get("method_versions"), list):
        cand["method_versions"] = [m for m in cand["method_versions"] if not str(m).startswith("crater")]
    if isinstance(cand.get("method_version"), str) and cand["method_version"].startswith("crater"):
        del cand["method_version"]
    if isinstance(cand.get("method"), str) and cand["method"].startswith("crater"):
        # crater-only primary method (e.g. a craters-first sld run): name the remaining detector, if any
        rest = [m for m in cand.get("method_versions") or [] if isinstance(m, str)]
        head = rest[0].split("+", 1)[0].split("/", 1) if rest else ["", "0"]
        cand["method"] = head[0]
        cand["version"] = int(head[1]) if len(head) > 1 and head[1].isdigit() else 0
    if isinstance(cand.get("detectors"), list):
        cand["detectors"] = [d for d in cand["detectors"] if d != "craters"]
    if isinstance(cand.get("tiling"), dict):
        cand["tiling"].pop("crater_buffer_m", None)
    mask = cand.get("mask")
    if isinstance(mask, dict) and isinstance(mask.get("path"), str):
        pat = re.compile("^" + re.escape(f"{aoi}/{mask['path']}").replace(r"\{i\}", r"(?P<i>\d+)").replace(r"\{j\}", r"(?P<j>\d+)") + "$")
        for rel in [r for r in plan1 if pat.match(r)]:
            srcm = plan1[rel]
            data = srcm.read_bytes() if isinstance(srcm, Path) else srcm
            try:
                w, h, px = png_gray8_decode(data)
            except (ValueError, zlib.error) as e:
                sys.exit(f"[export-data] refusing to export candidate mask {rel}: {e}")
            if not any(c in px for c in PRIVATE_MASK_CODES):
                continue
            tr = bytes(0 if v in PRIVATE_MASK_CODES else v for v in range(256))
            clean = bytes(px).translate(tr)
            stats["masks"] += 1
            if isinstance(mask.get("chunks"), list) and not any(clean):
                # only UXO cells in this chunk: drop the file and its `chunks` entry (no 404, no hint)
                del plan1[rel]
                mt = pat.match(rel)
                ij = [int(mt.group("i")), int(mt.group("j"))]
                mask["chunks"] = [c for c in mask["chunks"] if not (isinstance(c, list) and c[:2] == ij)]
                continue
            plan1[rel] = png_gray8_encode(w, h, clean)
    return stats


def walk_files(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for f in sorted(filenames):
            if f.startswith(".") or f.endswith((".part", ".tmp")):
                continue
            yield Path(dirpath) / f


def tile_zoom_dir(template: str) -> Tuple[str, bool]:
    """'xyz/vat/{z}/{x}/{y}.png' -> ('xyz/vat', True); non-template -> ('', False)."""
    if "{z}" not in template:
        return "", False
    prefix = template.split("{z}", 1)[0].rstrip("/")
    return prefix, True


def plan_aoi(src: Path, aoi: str, xyz_max_zoom: int, data2_url: str, plan1: Plan, plan2: Plan) -> dict:
    aoi_dir = src / aoi
    mpath = aoi_dir / "manifest.json"
    if not mpath.is_file():
        sys.exit(f"[export-data] no manifest: {mpath}")
    manifest = json.loads(mpath.read_text(encoding="utf-8"))
    xyz = manifest.get("xyz") or {}
    xyz_dirs: Dict[str, Tuple[str, int]] = {}  # tile dir prefix (relative to aoi) -> (key, maxZoom)
    for key, entry in xyz.items():
        url = entry.get("url", "")
        if url.startswith(("http://", "https://")):
            continue  # already external
        prefix, ok = tile_zoom_dir(url)
        if not ok:
            continue
        zmax = min(int(entry.get("maxZoom", xyz_max_zoom)), xyz_max_zoom)
        xyz_dirs[prefix] = (key, zmax)
    stats = {k: {"tiles": 0, "bytes": 0} for k in xyz}
    skipped_tiles = 0
    cand_ok = candidate_files_filter(manifest)
    skipped_private: List[str] = []
    for f in walk_files(aoi_dir):
        rel = f.relative_to(aoi_dir).as_posix()
        if rel == "manifest.json":
            continue
        if PRIVATE_AOI_FILES.match(rel) or (rel.startswith("candidates/") and not cand_ok(rel)):
            skipped_private.append(rel)
            continue
        hit = next((p for p in xyz_dirs if rel.startswith(p + "/")), None)
        if hit is not None:
            key, zmax = xyz_dirs[hit]
            z_str = rel[len(hit) + 1 :].split("/", 1)[0]
            if z_str.isdigit() and int(z_str) <= zmax:
                plan2[f"{aoi}/{rel}"] = f
                stats[key]["tiles"] += 1
                stats[key]["bytes"] += f.stat().st_size
            else:
                skipped_tiles += 1
            continue
        if rel.startswith("xyz/"):
            skipped_tiles += 1  # tiles of a layer the manifest no longer lists
            continue
        plan1[f"{aoi}/{rel}"] = f
    # manifest: absolute tile URLs in repo 2, trimmed maxZoom, recounted tiles/bytes
    for prefix, (key, zmax) in xyz_dirs.items():
        e = xyz[key]
        e["url"] = f"{data2_url}{aoi}/{e['url']}"
        e["maxZoom"] = zmax
        e["tileCount"] = stats[key]["tiles"]
        e["bytes"] = stats[key]["bytes"]
    uxo = strip_private_candidates(aoi_dir, aoi, manifest, plan1)
    if uxo["features"] or uxo["masks"]:
        print(f"[export-data] private UXO candidates removed: {uxo['features']} features, {uxo['masks']} mask chunks rewritten")
    manifest["release"] = {
        "note": "Public GitHub Pages export (scripts/release/export_data.py): xyz tiles live in a second data repository; maxZoom trimmed, the app overzooms.",
        "xyzMaxZoom": xyz_max_zoom,
    }
    plan1[f"{aoi}/manifest.json"] = (json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    if skipped_private:
        print(f"[export-data] private files not staged: {len(skipped_private)} ({', '.join(skipped_private[:5])}{' …' if len(skipped_private) > 5 else ''})")
    leaks = uxo_text_leaks(aoi, plan1)
    if leaks:
        sys.exit(f"[export-data] refusing to export: staged files still name a UXO class: {', '.join(leaks[:10])}")
    return {"manifest": manifest, "skippedTiles": skipped_tiles, "xyz": stats, "uxoRemoved": uxo,
            "skippedPrivate": skipped_private}


def candidate_files_filter(manifest: dict):
    """Predicate on AOI-relative paths under `candidates/`: only the manifest's GeoJSON and class8 mask
    chunks are public; anything else there (stale files, backups, staging copies) is not staged. Without
    a valid `candidates` key nothing under `candidates/` is staged."""
    cand = manifest.get("candidates")
    if not isinstance(cand, dict) or not isinstance(cand.get("path"), str):
        return lambda rel: False
    gpath = cand["path"]
    mask = cand.get("mask")
    mpat = None
    if isinstance(mask, dict) and isinstance(mask.get("path"), str):
        mpat = re.compile("^" + re.escape(mask["path"]).replace(r"\{i\}", r"\d+").replace(r"\{j\}", r"\d+") + "$")
    return lambda rel: rel == gpath or bool(mpat and mpat.match(rel))


def uxo_text_leaks(aoi: str, plan1: Plan) -> List[str]:
    """Staged text files of the AOI that still mention a UXO class (should be none after stripping)."""
    out = []
    for rel, srcv in plan1.items():
        if not rel.startswith(f"{aoi}/") or not rel.lower().endswith(UXO_TEXT_SUFFIXES):
            continue
        data = srcv if isinstance(srcv, bytes) else srcv.read_bytes()
        if UXO_TEXT_MARKERS.search(data):
            out.append(rel)
    return out


def plan_print(src: Path, plan2: Plan) -> List[dict]:
    """3D-print series: 3MF + PNG + layout + keys + printer preset; tile STLs dropped (index rewritten)."""
    out = []
    pdir = src / "print"
    if not pdir.is_dir():
        return out
    for f in sorted(pdir.glob("*.json")):  # e.g. series.json (list of series for the app)
        plan2[f"print/{f.name}"] = f
    for series in sorted(p for p in pdir.iterdir() if p.is_dir()):
        idx_path = series / "index.json"
        if not idx_path.is_file():
            print(f"[export-data] print/{series.name}: no index.json, skipped")
            continue
        idx = json.loads(idx_path.read_text(encoding="utf-8"))
        n3mf = 0
        for t in idx.get("tiles", []):
            files = t.get("files") or {}
            files.pop("stl", None)
        idx_bytes = (json.dumps(idx, ensure_ascii=False, indent=1) + "\n").encode("utf-8")
        plan2[f"print/{series.name}/index.json"] = idx_bytes
        for f in walk_files(series):
            rel = f.relative_to(series).as_posix()
            if rel == "index.json":
                continue
            top = "/" in rel
            ext = f.suffix.lower()
            if not top and ext == ".stl":
                continue  # tile meshes: 3MF only
            if not top and ext not in (".3mf", ".png", ".json"):
                continue
            plan2[f"print/{series.name}/{rel}"] = f
            n3mf += ext == ".3mf"
        out.append({"series": series.name, "name_de": (idx.get("series") or {}).get("name_de", series.name),
                    "tiles": len(idx.get("tiles", [])), "files3mf": n3mf, "attribution": idx.get("attribution", "")})
    return out


def plan_castle_terrain(terrain: Path, plan1: Plan) -> bool:
    if not (terrain / "meta.json").is_file():
        print(f"[export-data] WARNING: castle viewer terrain missing ({terrain}); the Pages workflow cannot build /castle/")
        return False
    sums = []
    for f in walk_files(terrain):
        rel = f.relative_to(terrain).as_posix()
        plan1[f"castle-viewer/terrain/{rel}"] = f
        h = hashlib.sha256()
        with f.open("rb") as fh:
            for block in iter(lambda: fh.read(1 << 20), b""):
                h.update(block)
        sums.append(f"{h.hexdigest()}  {rel}")
    plan1["castle-viewer/terrain/SHA256SUMS"] = ("\n".join(sums) + "\n").encode()
    return True


def attribution_entries(*strings: str) -> List[str]:
    seen: List[str] = []
    for s in strings:
        for e in (s or "").split(";"):
            e = e.strip()
            if e and e not in seen:
                seen.append(e)
    return seen


def render(name: str, values: dict) -> bytes:
    text = (TEMPLATES / name).read_text(encoding="utf-8")
    for k, v in values.items():
        text = text.replace("{{" + k + "}}", v)
    return text.encode("utf-8")


def sync(plan: Plan, out: Path) -> Tuple[int, int, int]:
    """Make `out` contain exactly `plan` (except .git/). Returns (copied, unchanged, deleted)."""
    out.mkdir(parents=True, exist_ok=True)
    copied = unchanged = deleted = 0
    for rel, srcv in plan.items():
        dst = out / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(srcv, bytes):
            if dst.is_file() and dst.read_bytes() == srcv:
                unchanged += 1
                continue
            dst.write_bytes(srcv)
            copied += 1
            continue
        st = srcv.stat()
        if dst.is_file():
            dt = dst.stat()
            if dt.st_size == st.st_size and int(dt.st_mtime) == int(st.st_mtime):
                unchanged += 1
                continue
        shutil.copy2(srcv, dst)
        copied += 1
    planned = set(plan)
    for dirpath, dirnames, filenames in os.walk(out, topdown=True):
        if ".git" in dirnames:
            dirnames.remove(".git")
        for f in filenames:
            p = Path(dirpath) / f
            rel = p.relative_to(out).as_posix()
            if rel not in planned:
                p.unlink()
                deleted += 1
    for dirpath, dirnames, filenames in os.walk(out, topdown=False):
        p = Path(dirpath)
        if p != out and ".git" not in p.parts and not any(p.iterdir()):
            p.rmdir()
    return copied, unchanged, deleted


def size_report(name: str, out: Path, limits: dict) -> Tuple[List[str], bool]:
    total = count = 0
    largest: List[Tuple[int, str]] = []
    per_top: Dict[str, int] = {}
    for dirpath, dirnames, filenames in os.walk(out):
        if ".git" in dirnames:
            dirnames.remove(".git")
        for f in filenames:
            p = Path(dirpath) / f
            b = p.stat().st_size
            rel = p.relative_to(out).as_posix()
            total += b
            count += 1
            largest.append((b, rel))
            top = "/".join(rel.split("/")[:2]) if "/" in rel else rel
            per_top[top] = per_top.get(top, 0) + b
    largest.sort(reverse=True)
    mb = lambda b: b / 1e6  # noqa: E731
    lines = [f"## {name}  ({out})", f"total {mb(total):.1f} MB in {count} files; largest {mb(largest[0][0]) if largest else 0:.1f} MB "
             f"({largest[0][1] if largest else '-'})"]
    for top, b in sorted(per_top.items(), key=lambda kv: -kv[1])[:14]:
        lines.append(f"  {mb(b):8.1f} MB  {top}")
    ok = True
    if mb(total) > limits["site_hard"]:
        lines.append(f"  FAIL: site {mb(total):.1f} MB > {limits['site_hard']} MB (GitHub Pages limit)")
        ok = False
    elif mb(total) > limits["site_aim"]:
        lines.append(f"  WARN: site {mb(total):.1f} MB > aim {limits['site_aim']} MB")
    big = [(b, r) for b, r in largest if mb(b) >= limits["file_aim"]]
    for b, r in big:
        hard = mb(b) >= limits["file_hard"]
        lines.append(f"  {'FAIL' if hard else 'WARN'}: {r} is {mb(b):.1f} MB (limit {limits['file_hard']} MB, aim {limits['file_aim']} MB)")
        ok = ok and not hard
    return lines, ok


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", required=True, type=Path, help="app data dir (app/public/data)")
    ap.add_argument("--castle-terrain", required=True, type=Path)
    ap.add_argument("--out1", required=True, type=Path)
    ap.add_argument("--out2", required=True, type=Path)
    ap.add_argument("--aoi", default="overall")
    ap.add_argument("--xyz-max-zoom", type=int, default=17)
    ap.add_argument("--app-url", required=True)
    ap.add_argument("--data-url", required=True)
    ap.add_argument("--data2-url", required=True)
    ap.add_argument("--org", default="Open-Kirrberg")
    ap.add_argument("--report", type=Path, help="write the size report here too")
    ap.add_argument("--site-hard-mb", type=float, default=1000)
    ap.add_argument("--site-aim-mb", type=float, default=900)
    ap.add_argument("--file-hard-mb", type=float, default=100)
    ap.add_argument("--file-aim-mb", type=float, default=50)
    a = ap.parse_args()
    src = a.src.resolve()
    for o in (a.out1, a.out2):
        if str(o.resolve()).startswith(str(Path(__file__).resolve().parents[2]) + os.sep):
            sys.exit(f"[export-data] refusing to write inside the code repository: {o}")

    plan1: Plan = {}
    plan2: Plan = {}
    aoi_info = plan_aoi(src, a.aoi, a.xyz_max_zoom, a.data2_url, plan1, plan2)
    m = aoi_info["manifest"]
    if (src / "pois.geojson").is_file():
        plan1["pois.geojson"] = src / "pois.geojson"
    shared_attr = []
    if (src / "shared").is_dir():
        for f in walk_files(src / "shared"):
            rel = f.relative_to(src).as_posix()
            plan1[rel] = f
            if f.name == "index.json":
                idx = json.loads(f.read_text(encoding="utf-8"))
                shared_attr.append(idx.get("attribution", ""))
                viewer = idx.get("viewer")
                if isinstance(viewer, dict) and "url" in viewer:
                    # the local file names the dev castle viewer (localhost:5260); publish the public one
                    viewer["url"] = a.app_url.rstrip("/") + "/castle/"
                    plan1[rel] = (json.dumps(idx, ensure_ascii=False, indent=1) + "\n").encode("utf-8")
    has_castle = plan_castle_terrain(a.castle_terrain.resolve(), plan1)
    prints = plan_print(src, plan2)

    pois_attr = ""
    if (src / "pois.geojson").is_file():
        pois_attr = json.loads((src / "pois.geojson").read_text(encoding="utf-8")).get("attribution", "")
    entries1 = attribution_entries(m.get("attribution", ""), *shared_attr, pois_attr)
    if has_castle:
        entries1.append("castle-viewer/terrain: DGM1 GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet; 1789-Gelände = Hypothese (eigene Arbeit)")
    hist_attr = [e.get("attribution", "") for e in (m.get("xyz") or {}).values()]
    # relief tiles: the terrain entries of the manifest (those without a "(product)" suffix)
    terrain_attr = [e for e in attribution_entries(m.get("attribution", "")) if "(" not in e and "OpenStreetMap" not in e]
    entries2 = attribution_entries(*terrain_attr, *hist_attr, *[p["attribution"] for p in prints])
    cand = m.get("candidates") or {}
    vals = {
        "ORG": a.org, "APP_URL": a.app_url, "DATA_URL": a.data_url, "DATA2_URL": a.data2_url, "AOI": a.aoi,
        "AOI_NAME": html.escape(m.get("name", a.aoi)), "XYZ_MAX_ZOOM": str(a.xyz_max_zoom),
        "CANDIDATE_COUNT": str(cand.get("featureCount", "?")),
        "ATTRIBUTION_LIST_1": "\n".join(f"- {e}" for e in entries1),
        "ATTRIBUTION_LIST_2": "\n".join(f"- {e}" for e in entries2),
        "ATTRIBUTION_HTML_1": "\n".join(f"<li>{html.escape(e)}</li>" for e in entries1),
        "ATTRIBUTION_HTML_2": "\n".join(f"<li>{html.escape(e)}</li>" for e in entries2),
        "PRINT_LIST": "\n".join(f"- `print/{p['series']}/` – {p['name_de']}: {p['files3mf']} 3MF-Kacheln" for p in prints) or "- (keine)",
        "PRINT_HTML": "\n".join(f"<li><a href=\"print/{html.escape(p['series'])}/index.json\">{html.escape(p['name_de'])}</a> – {p['files3mf']} 3MF</li>" for p in prints) or "<li>(keine)</li>",
    }
    for plan, which in ((plan1, "1"), (plan2, "2")):
        plan[".nojekyll"] = b""
        plan["README.md"] = render(f"data{which}-README.md", vals)
        plan["ATTRIBUTION"] = ("\n".join(entries1 if which == "1" else entries2) + "\n").encode("utf-8")
        plan["index.html"] = render(f"data{which}-index.html", vals)

    limits = {"site_hard": a.site_hard_mb, "site_aim": a.site_aim_mb, "file_hard": a.file_hard_mb, "file_aim": a.file_aim_mb}
    report: List[str] = []
    ok_all = True
    for name, plan, out in (("saar-lidar-data", plan1, a.out1), ("saar-lidar-data-2", plan2, a.out2)):
        c, u, d = sync(plan, out.resolve())
        print(f"[export-data] {name}: {c} written, {u} unchanged, {d} deleted")
        lines, ok = size_report(name, out.resolve(), limits)
        report += lines + [""]
        ok_all &= ok
    xyz_lines = [f"  xyz.{k}: {v['tiles']} tiles, {v['bytes'] / 1e6:.1f} MB (<= z{a.xyz_max_zoom})" for k, v in aoi_info["xyz"].items()]
    report += ["## xyz (moved to saar-lidar-data-2)", *xyz_lines, f"  tiles above z{a.xyz_max_zoom} dropped: {aoi_info['skippedTiles']}", ""]
    report += ["## print", *[f"  {p['series']}: {p['files3mf']} 3MF, {p['tiles']} tiles in index" for p in prints], ""]
    text = "\n".join(report)
    print(text)
    if a.report:
        a.report.write_text(text, encoding="utf-8")
    if not ok_all:
        print("[export-data] FAILED: a GitHub Pages hard limit is exceeded (see above)", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
