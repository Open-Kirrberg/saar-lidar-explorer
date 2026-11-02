#!/usr/bin/env python3
"""Stage the public data repositories for GitHub Pages (stdlib only, Python >= 3.9).

Run through export-data.sh (it sources release.env). Two outputs, both plain static sites:

  <out1> = saar-lidar-data     AOI dataset without the Leaflet tiles (manifest rewritten), pois.geojson,
                               shared/ (F19 reconstruction), castle-viewer/terrain/ (fetched by the Pages
                               workflow to build the castle viewer)
  <out2> = saar-lidar-data-2   Leaflet XYZ tiles up to --xyz-max-zoom, 3D-print series (3MF + previews,
                               no tile STL)

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
import shutil
import sys
from pathlib import Path
from typing import Dict, List, Tuple, Union

Source = Union[Path, bytes]
Plan = Dict[str, Source]

HERE = Path(__file__).resolve().parent
TEMPLATES = HERE / "templates"


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
    for f in walk_files(aoi_dir):
        rel = f.relative_to(aoi_dir).as_posix()
        if rel == "manifest.json":
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
    manifest["release"] = {
        "note": "Public GitHub Pages export (scripts/release/export_data.py): xyz tiles live in a second data repository; maxZoom trimmed, the app overzooms.",
        "xyzMaxZoom": xyz_max_zoom,
    }
    plan1[f"{aoi}/manifest.json"] = (json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    return {"manifest": manifest, "skippedTiles": skipped_tiles, "xyz": stats}


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
