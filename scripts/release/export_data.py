#!/usr/bin/env python3
"""Stage the public data repositories for GitHub Pages (stdlib only, Python >= 3.9).

Run through export-data.sh (it sources release.env). Two outputs, both plain static sites:

  <out1> = saar-lidar-data     AOI dataset without the Leaflet tiles (manifest rewritten), pois.geojson,
                               shared/ (F19 reconstruction), castle-viewer/terrain/ (fetched by the Pages
                               workflow to build the castle viewer), zones/ (cleared zone packages)
  <out2> = saar-lidar-data-2   Leaflet XYZ tiles up to --xyz-max-zoom, 3D-print series (3MF + previews,
                               no tile STL)

UXO candidate classes (`crater`, `crater_field`, F22, from saar-lidar-detect) are private and never
exported: `strip_private_candidates` removes them from candidates.geojson, the manifest and the
class8 masks (codes 6/7 -> 0) before anything is staged. Of `candidates/` only the manifest's
GeoJSON and mask chunks are staged; saar-lidar-detect side files in the AOI dir (run.json, report.html,
eval.*, fachbericht/, manifest backups, staging dirs) never are, and the export aborts when a staged
AOI text file still names a UXO class.

Zone packages (`<src>/zones/`, docs/zone-contract.md) go to <out1>/zones/ only when listed in --zones
AND cleared in PUBLIC_ZONE_POLICY (`plan_zones`): per zone only zone.json plus the files its manifest
references under the cleared prefixes (bakery: `built/`) or, for a module zone, the exact files its module
fetches (castle: terrain/ + the CC0 texture JPEGs, metadata checked); assets with role "reference" (the capture,
ADR 0043) are dropped from zone.json, `scene/` and every other file stay local; a staged file that names
a local path, the private material folder or an e-mail address, or a GLB with embedded images where the
policy forbids them, aborts the export. zones/index.json lists only the staged zones.

Orte im Vergleich (ADR 0049), the historic forest mask and the tree species layer: of `<aoi>/stats/` only the
files the manifest key `stats` names (`places.json`, `places.geojson`), of `<aoi>/forest_hist/` only the PNG of
`forest_hist` and of `<aoi>/species/` only the PNG of `species` are staged (`keyed_layer_files`); review reports,
previews and work files there never are. A key whose file is missing or
whose JSON names a local path aborts; a key with another `format` is dropped with its folder.

Stats-only AOIs (ADR 0051, `--stats-aois`, e.g. `saarland`: manifest `kind: 'stats-only'`, no terrain): only
manifest.json + the files of its `stats` key are staged to <out1>/<aoi>/; a manifest with tile keys, a stats file above
STATS_FILE_HARD_KB or one failing the privacy guard (parcel / owner / address keys or values, outline properties other
than id + name_de, tree positions or GBIF records on the Gemeinde level) aborts. `stats_levels` (in any manifest) may
only point at staged AOIs holding that level; other entries are dropped. --stats-only stages just those AOIs and adds
only `stats_levels` to the manifest already staged in <out1> (the published one), so no other local key leaks.

Idempotent: files are copied only when size/mtime differ, generated files only when their content
changes, and files no longer planned are deleted (a `.git/` directory is never touched).
--zones-only stages just <out1>/zones/ (nothing else in either repo is read, written or deleted);
--dry-run lists what would change and writes nothing.
Exit code 2 when a GitHub Pages hard limit is exceeded.

Symlinks in the inputs (files and directories) are followed when they resolve inside the link roots: the
code repository, the resolved --src and --castle-terrain, and every --link-root. A link outside them, a
dangling link or a loop aborts the export. Delete guard: when a sync would remove more than
--max-deletes (default 20) already-staged files from one repo, nothing is written and the exit code is 3
(a source dir was probably skipped or is missing); --allow-deletes lifts it. --dry-run reports the same.
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
from typing import Dict, List, Optional, Sequence, Tuple, Union

Source = Union[Path, bytes]
Plan = Dict[str, Source]

HERE = Path(__file__).resolve().parent
TEMPLATES = HERE / "templates"
ZONE_VALIDATOR = HERE.parents[1] / "pipeline" / "zones.py"  # stdlib-only producer validator (docs/zone-contract.md)

# Symlinks in the inputs are followed only when they resolve inside one of these (resolved) roots: the code
# repository, the resolved --src / --castle-terrain, and every --link-root (main() fills the rest).
LINK_ROOTS: List[Path] = [HERE.parents[1]]
# Refuse a sync that would delete more already-staged files than this from one repo (--allow-deletes).
DEFAULT_MAX_DELETES = 20
EXIT_DELETE_GUARD = 3

# Zone packages cleared for the public data repo, and what of each may be staged (RELEASING.md §2).
# `prefixes`: package paths that may be published; `images`: may the package carry images (embedded in a
# GLB or as image files); `moduleFiles` (module runtime only): the exact files the zone module fetches by
# convention below its base URL (zone.json lists no assets for them); every one must exist.
# A zone not listed here is never staged, whatever --zones says. Everything else of a package
# (`scene/` = the photogrammetry capture, `reference` assets, work files) stays local (ADR 0043).
# Castle texture sets (zones/schloss-karlsberg/viewer/textures.json, all Poly Haven CC0; a test pins the match).
CASTLE_TEXTURE_SETS = ("lime_plaster", "slate_roof", "clay_tile_roof", "sandstone_ashlar", "sandstone_flags",
                       "parquet", "gravel", "grass")
PUBLIC_ZONE_POLICY: Dict[str, dict] = {
    # Bäckerei Heusser built twin: zone.json + built/ (twin, nav floor, visitor catalogue), no textures
    # (ADR 0042/0043); bh-datenschutz checklist before every release (ADR 0044 consent scope).
    "baeckerei-heusser": {"prefixes": ("built/",), "images": False},
    # Schloss Karlsberg 1789 module zone (ADR 0033, 0048): the 1789 terrain (dl-de/by-2-0, processed) and the
    # downscaled Poly Haven CC0 texture sets; images = these JPEGs only (no GLBs in the package).
    "schloss-karlsberg": {
        "prefixes": ("terrain/", "textures/"),
        "images": True,
        "moduleFiles": ("terrain/meta.json", "terrain/dtm1789.u16.deflate", "terrain/ground.u8.deflate",
                        *(f"textures/{s}/{m}.jpg" for s in CASTLE_TEXTURE_SETS for m in ("diff", "nor_gl", "arm"))),
    },
}
IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp", ".ktx2", ".avif", ".gif")
# Opaque binary grids (deflated numeric rasters): no text to scan.
BINARY_ZONE_SUFFIXES = (".deflate",)
ZONE_INDEX_FORMAT = "sle-zones-v1"
# Staged zone files must not name local paths, the private material folder or an e-mail address.
ZONE_LEAK_MARKERS = re.compile(
    r"(?i)/Users/|/home/|/private/(?:tmp|var)/|[A-Z]:\\\\|heusser-privat|\bprivat/|[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}"
)

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
# Orte im Vergleich + historic forest + tree species (ADR 0049, data-contract „Place statistics“ / „Historic forest
# mask“ / „Tree species“):
# manifest key -> (folder, required format, path fields). Only the files the key names are public; the
# pipeline's review reports and work files (stats_report.json etc. stay in data/work) are never staged.
KEYED_LAYERS: Dict[str, Tuple[str, str, Tuple[str, ...]]] = {
    "stats": ("stats/", "sle-stats-v1", ("url", "geometry")),
    "forest_hist": ("forest_hist/", "sle-forest-hist-v1", ("path",)),
    "species": ("species/", "sle-species-v1", ("path",)),   # DLR tree species 2022 (CC BY 4.0), contract „Tree species“
}
# Stats-only AOIs (ADR 0051, contract „Place statistics“ → „Gemeinde level“, e.g. `saarland`): manifest
# `kind: 'stats-only'`, no terrain. Only manifest.json + the files its `stats` key names are staged; a manifest with any
# other top-level key (tiles, layers, work data) aborts, every other file in the AOI dir stays local.
STATS_ONLY_KIND = "stats-only"
STATS_ONLY_KEYS = frozenset({"version", "kind", "aoi", "name", "crs", "stats", "stats_levels", "attribution"})
STATS_LEVELS_FORMAT = "sle-stats-levels-v1"
STATS_LEVEL_IDS = ("gemeinde", "ortsteil")
# The only key `--stats-only` adds to the staged (= published) manifest of the tile AOI, and the only `attribution`
# entries it may add there: the BKG VG25 credit (gemeinden_stats.py writes it next to `stats_levels`, so the app's
# „© Quellen“, built from the tile AOI's attribution, names the source of the Gemeinde outlines).
STATS_ONLY_MERGE_KEYS = ("stats_levels",)
STATS_ONLY_ATTRIBUTION = re.compile(r"^© BKG \(\d{4}\) CC BY 4\.0\b.*\(VG25\)$")
# Size guard per staged stats file (contract targets: Gemeinde places.json < 160 KB, outlines < 200 KB): above the
# aim warns, above the hard limit aborts (a stats file that big holds more than aggregates).
STATS_FILE_AIM_KB = {"places.json": 160, "places.geojson": 200}
STATS_FILE_HARD_KB = 1024
# Privacy guard (cheap stdlib mirror of pipeline/stats.py `check_privacy`, which the pipeline already runs): no parcel,
# owner, address or person keys and no parcel-id- or address-like values; outlines carry {id, name_de} only; on the
# Gemeinde level no tree positions (`riesen`, `tallest`, ADR 0051) and `biodiversity` as numbers only (GBIF counts,
# never records or species names).
STATS_FORBIDDEN_KEY_PARTS = ("flst", "flurst", "kennz", "eigent", "owner", "besitz", "buchung", "adress", "address",
                             "addr", "strasse", "straße", "hausn", "housenumber", "lagebez", "person", "anschrift", "plz")
STATS_FORBIDDEN_VALUE = re.compile(
    r"^(?:DE[A-Z]{2})?\d{6}[\d_]{8,}$|\b\w*(?:straße|strasse|str\.?|weg|gasse|platz)\s+\d+\w?\b", re.IGNORECASE)
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


def _inside(real: Path, roots: Sequence[Path]) -> bool:
    return any(real == r or r in real.parents for r in roots)


def allowed_source(p: Path, roots: Optional[Sequence[Path]] = None) -> Path:
    """`p` itself; exits (no export) when it goes through a symlink and resolves outside the link roots,
    or dangles. A path without links is the caller's explicit input and is not restricted."""
    roots = [Path(os.path.realpath(r)) for r in (LINK_ROOTS if roots is None else roots)]
    real = Path(os.path.realpath(p))
    if real == Path(os.path.abspath(p)) and real.exists():
        return p
    if not real.exists():
        sys.exit(f"[export-data] refusing to export: {p} is a dangling symlink (-> {real})")
    if not _inside(real, roots):
        sys.exit(f"[export-data] refusing to follow {p} -> {real}: outside the allowed link roots "
                 f"({', '.join(map(str, roots)) or 'none'}); add one with --link-root / RELEASE_LINK_ROOTS")
    return p


def walk_files(root: Path, link_roots: Optional[Sequence[Path]] = None):
    """Files under `root` (sorted; dot files, *.part, *.tmp skipped), yielded by their path below `root`.
    Symlinked files and directories are followed when they resolve inside `link_roots` (default:
    LINK_ROOTS); a link outside them, a dangling link or a loop aborts the export instead of silently
    planning the files as absent (which a full sync would then delete from the staging repos)."""
    roots = [Path(os.path.realpath(r)) for r in (LINK_ROOTS if link_roots is None else link_roots)]

    def walk(d: Path, stack: frozenset):
        real = Path(os.path.realpath(d))
        if real in stack:
            sys.exit(f"[export-data] refusing to export: symlink loop at {d} (-> {real})")
        stack = stack | {real}
        with os.scandir(d) as it:
            entries = sorted(it, key=lambda e: e.name)
        subdirs = []
        for e in entries:
            p = d / e.name
            if e.is_symlink():
                allowed_source(p, roots)
            if e.is_dir():  # follows the (checked) link
                subdirs.append(p)
            elif e.is_file() and not (e.name.startswith(".") or e.name.endswith((".part", ".tmp"))):
                yield p
        for p in subdirs:
            yield from walk(p, stack)

    if root.is_symlink():
        allowed_source(root, roots)
    if root.is_dir():
        yield from walk(root, frozenset())


def tile_zoom_dir(template: str) -> Tuple[str, bool]:
    """'xyz/vat/{z}/{x}/{y}.png' -> ('xyz/vat', True); non-template -> ('', False)."""
    if "{z}" not in template:
        return "", False
    prefix = template.split("{z}", 1)[0].rstrip("/")
    return prefix, True


def plan_aoi(src: Path, aoi: str, xyz_max_zoom: int, data2_url: str, plan1: Plan, plan2: Plan,
             level_aois: Optional[Dict[str, Optional[str]]] = None) -> dict:
    """Plan a tile AOI. `level_aois`: the other AOIs this export stages -> their stats level (`stats_levels` may
    only point at those; see `check_stats_levels`)."""
    aoi_dir = src / aoi
    mpath = aoi_dir / "manifest.json"
    if not mpath.is_file():
        sys.exit(f"[export-data] no manifest: {mpath}")
    allowed_source(mpath)
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
    keyed = keyed_layer_files(aoi_dir, manifest)
    skipped_private: List[str] = []
    for f in walk_files(aoi_dir):
        rel = f.relative_to(aoi_dir).as_posix()
        if rel == "manifest.json":
            continue
        if PRIVATE_AOI_FILES.match(rel) or (rel.startswith("candidates/") and not cand_ok(rel)):
            skipped_private.append(rel)
            continue
        folder = next((d for d in keyed if rel.startswith(d)), None)
        if folder is not None and rel not in keyed[folder]:
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
    stats_guard = stats_file_guard(aoi_dir, sorted(keyed.get("stats/", ())), stats_level(manifest))
    for line in check_stats_levels(manifest, {**(level_aois or {}), aoi: stats_level(manifest)}):
        print(line)
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
            "skippedPrivate": skipped_private, "statsWarnings": stats_guard["warnings"]}


def stats_level(manifest: dict) -> Optional[str]:
    """Level of the AOI's own `stats` key ('gemeinde' / 'ortsteil'; no `level` = 'ortsteil'), None without a valid key."""
    s = manifest.get("stats")
    if not isinstance(s, dict) or s.get("format") != KEYED_LAYERS["stats"][1]:
        return None
    return s.get("level") or "ortsteil"


def read_stats_level(src: Path, aoi: str) -> Optional[str]:
    """`stats_level` of <src>/<aoi>/manifest.json (None when missing or unreadable)."""
    try:
        return stats_level(json.loads((src / aoi / "manifest.json").read_text(encoding="utf-8")))
    except (OSError, ValueError, AttributeError):
        return None


def check_stats_levels(manifest: dict, staged: Dict[str, Optional[str]]) -> List[str]:
    """Validate `manifest['stats_levels']` (sle-stats-levels-v1) in place against the AOIs this export stages
    (`staged`: aoi -> the level of its stats). A level whose AOI is not staged or whose stats are another level is
    dropped (the public manifest must not point at data that are not public); with a wrong format or fewer than two
    levels left (no switch) the whole key is dropped. Returns log lines."""
    sl = manifest.get("stats_levels")
    if sl is None:
        return []
    if not isinstance(sl, dict) or sl.get("format") != STATS_LEVELS_FORMAT or not isinstance(sl.get("levels"), list):
        manifest.pop("stats_levels", None)
        return [f"[export-data] manifest key 'stats_levels' is not {STATS_LEVELS_FORMAT}: dropped"]
    keep, out = [], []
    for lv in sl["levels"]:
        if not isinstance(lv, dict) or lv.get("level") not in STATS_LEVEL_IDS:
            out.append(f"[export-data] stats_levels: unknown level entry {lv!r} dropped")
        elif lv.get("aoi") not in staged:
            out.append(f"[export-data] stats_levels: level {lv['level']!r} -> AOI {lv.get('aoi')!r} is not staged: dropped")
        elif staged[lv["aoi"]] != lv["level"]:
            out.append(f"[export-data] stats_levels: AOI {lv['aoi']!r} holds level {staged[lv['aoi']]!r}, not {lv['level']!r}: dropped")
        else:
            keep.append(lv)
    if len(keep) < 2:
        manifest.pop("stats_levels", None)
        out.append("[export-data] stats_levels: fewer than two staged levels left: key dropped")
    elif len(keep) != len(sl["levels"]):
        sl["levels"] = keep
    return out


def stats_privacy_problems(rel: str, doc, level: Optional[str]) -> List[str]:
    """Privacy guard for one staged stats file (see STATS_FORBIDDEN_*): aggregates only."""
    out: List[str] = []

    def scan(v, path: str) -> None:
        if len(out) >= 10:
            return
        if isinstance(v, dict):
            for k, x in v.items():
                if any(f in str(k).lower() for f in STATS_FORBIDDEN_KEY_PARTS):
                    out.append(f"{rel}: forbidden key {path}.{k}")
                scan(x, f"{path}.{k}")
        elif isinstance(v, list):
            for i, x in enumerate(v):
                scan(x, f"{path}[{i}]")
        elif isinstance(v, str) and STATS_FORBIDDEN_VALUE.search(v.strip()):
            out.append(f"{rel}: parcel-id- or address-like value at {path}")

    if rel.endswith(".geojson"):
        for i, f in enumerate((doc or {}).get("features") or []):
            props = (f or {}).get("properties") or {}
            if set(props) != {"id", "name_de"}:
                out.append(f"{rel}: feature {i} has properties {sorted(props)} (contract: id, name_de only)")
            scan(props, f"features[{i}].properties")
        return out
    scan(doc, "")
    if level == "gemeinde":
        for p in (doc or {}).get("places") or []:
            if not isinstance(p, dict):
                continue
            pid = p.get("id")
            if p.get("riesen"):
                out.append(f"{rel}: place {pid}: tree positions (riesen) on the Gemeinde level (ADR 0051)")
            if p.get("tallest") is not None:
                out.append(f"{rel}: place {pid}: tallest tree on the Gemeinde level (ADR 0051)")
            bio = p.get("biodiversity")
            flat = list(bio.values()) if isinstance(bio, dict) else []
            flat += [x for v in flat if isinstance(v, list) for x in v]
            if any(isinstance(x, (str, dict)) for x in flat):
                out.append(f"{rel}: place {pid}: biodiversity carries more than counts (records / species names?)")
    return out


def stats_file_guard(aoi_dir: Path, rels: Sequence[str], level: Optional[str]) -> dict:
    """Size + privacy guard for the stats files about to be staged (AOI-relative paths). Exits (no export) on a
    file above STATS_FILE_HARD_KB or a privacy problem; returns {'bytes': {rel: n}, 'warnings': [...]}."""
    sizes: Dict[str, int] = {}
    warnings: List[str] = []
    problems: List[str] = []
    for rel in rels:
        f = aoi_dir / rel
        n = f.stat().st_size
        sizes[rel] = n
        name = rel.rsplit("/", 1)[-1]
        if n > STATS_FILE_HARD_KB * 1024:
            problems.append(f"{rel} is {n / 1024:.0f} KB (hard limit {STATS_FILE_HARD_KB} KB for a stats file)")
            continue
        if name in STATS_FILE_AIM_KB and n > STATS_FILE_AIM_KB[name] * 1024:
            warnings.append(f"{rel} is {n / 1024:.0f} KB (contract target < {STATS_FILE_AIM_KB[name]} KB)")
        if rel.endswith((".json", ".geojson")):
            try:
                doc = json.loads(f.read_text(encoding="utf-8"))
            except ValueError as e:
                problems.append(f"{rel}: not JSON ({e})")
                continue
            problems += stats_privacy_problems(rel, doc, level)
    if problems:
        sys.exit("[export-data] refusing to export stats: " + "; ".join(problems[:10]))
    for w in warnings:
        print(f"[export-data] WARNING: {w}")
    return {"bytes": sizes, "warnings": warnings}


def plan_stats_aoi(src: Path, aoi: str, plan1: Plan, level_aois: Optional[Dict[str, Optional[str]]] = None) -> dict:
    """Plan a stats-only AOI (ADR 0051): <aoi>/manifest.json + the files of its `stats` key, nothing else.
    Exits (no export) when the manifest is not `kind: 'stats-only'`, names another AOI, carries a key outside
    STATS_ONLY_KEYS (tiles, layers, work data), has no valid `stats` key, or a stats file fails the size / privacy
    guard. `stats_levels` is checked against `level_aois` (plus this AOI) like in a tile AOI."""
    aoi_dir = src / aoi
    mpath = aoi_dir / "manifest.json"
    if not mpath.is_file():
        sys.exit(f"[export-data] no stats-only manifest: {mpath} (run the pipeline, or drop {aoi} from RELEASE_STATS_AOIS)")
    allowed_source(mpath)
    raw = mpath.read_bytes()
    manifest = json.loads(raw)
    if not isinstance(manifest, dict) or manifest.get("kind") != STATS_ONLY_KIND:
        sys.exit(f"[export-data] refusing: {aoi}/manifest.json is not kind {STATS_ONLY_KIND!r} (tile AOIs go through --aoi)")
    if manifest.get("aoi") != aoi:
        sys.exit(f"[export-data] refusing: {aoi}/manifest.json names AOI {manifest.get('aoi')!r}")
    extra = sorted(set(manifest) - STATS_ONLY_KEYS)
    if extra:
        sys.exit(f"[export-data] refusing: stats-only manifest {aoi} carries keys a stats-only AOI must not have: {', '.join(extra)}")
    before = json.dumps(manifest, sort_keys=True)
    keyed = keyed_layer_files(aoi_dir, manifest)
    files = sorted(keyed.get("stats/", ()))
    if not files:
        sys.exit(f"[export-data] refusing: stats-only AOI {aoi} has no valid 'stats' key")
    level = stats_level(manifest)
    guard = stats_file_guard(aoi_dir, files, level)
    for line in check_stats_levels(manifest, {**(level_aois or {}), aoi: level}):
        print(line)
    for rel in files:
        plan1[f"{aoi}/{rel}"] = aoi_dir / rel
    # unchanged: staged byte-identical; else re-serialised (a dropped stats_levels entry)
    plan1[f"{aoi}/manifest.json"] = mpath if json.dumps(manifest, sort_keys=True) == before else (
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    skipped = [f.relative_to(aoi_dir).as_posix() for f in walk_files(aoi_dir)]
    skipped = [r for r in skipped if r != "manifest.json" and r not in files]
    leaks = uxo_text_leaks(aoi, plan1)
    if leaks:
        sys.exit(f"[export-data] refusing to export: staged files still name a UXO class: {', '.join(leaks[:10])}")
    print(f"[export-data] stats-only AOI {aoi} (level {level}): manifest.json + {len(files)} file(s) staged, "
          f"{len(skipped)} local file(s) not staged{' (' + ', '.join(skipped[:5]) + ')' if skipped else ''}")
    places = json.loads((aoi_dir / manifest["stats"]["url"]).read_text(encoding="utf-8"))
    inputs = places.get("inputs") if isinstance(places, dict) and isinstance(places.get("inputs"), dict) else {}
    return {"aoi": aoi, "level": level, "manifest": manifest, "files": guard["bytes"], "inputs": inputs,
            "bytes": sum(guard["bytes"].values()) + len(raw), "skipped": skipped, "warnings": guard["warnings"]}


def keyed_layer_files(aoi_dir: Path, manifest: dict) -> Dict[str, set]:
    """KEYED_LAYERS folders -> the AOI-relative files their manifest key names (the only files staged there).
    A key with another `format` (or not an object) is removed from `manifest` (the app would ignore it) and its
    folder stages nothing; a named file that is missing, outside the folder or a JSON file naming a local path
    aborts the export. Without the key nothing in the folder is staged."""
    out: Dict[str, set] = {}
    for key, (folder, fmt, fields) in KEYED_LAYERS.items():
        entry = manifest.get(key)
        out[folder] = set()
        if entry is None:
            continue
        if not isinstance(entry, dict) or entry.get("format") != fmt:
            print(f"[export-data] manifest key {key!r} is not {fmt}: dropped, {folder} not staged")
            manifest.pop(key, None)
            continue
        for field in fields:
            rel = entry.get(field)
            if rel is None and field != fields[0]:
                continue  # optional (stats.geometry)
            if not isinstance(rel, str) or not rel.startswith(folder) or ".." in rel.split("/"):
                sys.exit(f"[export-data] refusing to export: {key}.{field} = {rel!r} is not a file under {folder}")
            f = aoi_dir / rel
            if not f.is_file():
                sys.exit(f"[export-data] refusing to export: {key}.{field} names a missing file {rel}")
            allowed_source(f)
            if rel.endswith((".json", ".geojson")) and ZONE_LEAK_MARKERS.search(f.read_text(encoding="utf-8", errors="replace")):
                sys.exit(f"[export-data] refusing to export: {rel} names a local path or an e-mail address")
            out[folder].add(rel)
    return out


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
        plan2[f"print/{f.name}"] = allowed_source(f)
    for series in sorted(p for p in pdir.iterdir() if p.is_dir()):
        idx_path = series / "index.json"
        if not idx_path.is_file():
            print(f"[export-data] print/{series.name}: no index.json, skipped")
            continue
        idx = json.loads(allowed_source(idx_path).read_text(encoding="utf-8"))
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


def _load_zone_validator():
    """pipeline/zones.py (stdlib only), loaded by path; the export refuses to stage zones without it."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("sle_zone_validator", ZONE_VALIDATOR)
    if spec is None or spec.loader is None or not ZONE_VALIDATOR.is_file():
        sys.exit(f"[export-data] zone validator missing: {ZONE_VALIDATOR}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def glb_json(data: bytes) -> dict:
    """The JSON chunk of a glTF 2.0 binary (ValueError otherwise)."""
    if len(data) < 20 or data[:4] != b"glTF" or struct.unpack("<I", data[4:8])[0] != 2:
        raise ValueError("not a glTF 2.0 binary")
    n, kind = struct.unpack("<I4s", data[12:20])
    if kind != b"JSON":
        raise ValueError("first chunk is not JSON")
    return json.loads(data[20 : 20 + n])


def jpeg_metadata(data: bytes) -> bytes:
    """The metadata segments (APPn, COM) of a baseline/progressive JPEG up to the scan (ValueError otherwise)."""
    if data[:2] != b"\xff\xd8":
        raise ValueError("not a JPEG")
    i, out = 2, []
    while i + 4 <= len(data):
        if data[i] != 0xFF:
            raise ValueError(f"bad JPEG marker at {i}")
        m = data[i + 1]
        if m == 0xDA:  # start of scan: entropy-coded data follows
            return b"".join(out)
        n = struct.unpack(">H", data[i + 2 : i + 4])[0]
        if 0xE0 <= m <= 0xEF or m == 0xFE:
            out.append(data[i + 4 : i + 2 + n])
        i += 2 + n
    raise ValueError("JPEG without a scan")


def zone_file_problems(rel: str, data: bytes, allow_images: bool) -> List[str]:
    """Privacy guard for one staged zone file: no local paths / private folder / e-mail addresses in its
    text (for a GLB: its JSON chunk incl. names and extras; for a JPEG: its metadata segments), no images
    (embedded or as files) unless allowed. Deflated binary grids carry no text and are not scanned."""
    low = rel.lower()
    if low.endswith(BINARY_ZONE_SUFFIXES):
        return []
    if low.endswith(IMAGE_SUFFIXES):
        if not allow_images:
            return [f"{rel}: image file where the zone policy allows no images"]
        if not low.endswith((".jpg", ".jpeg")):
            return [f"{rel}: only JPEG images can be checked for metadata"]
        try:
            text = jpeg_metadata(data).decode("latin-1")
        except (ValueError, struct.error) as e:
            return [f"{rel}: {e}"]
        m = ZONE_LEAK_MARKERS.search(text)
        return [f"{rel}: JPEG metadata names a local path, the private folder or an e-mail address ({m.group(0)!r})"] if m else []
    if rel.endswith(".glb"):
        try:
            doc = glb_json(data)
        except (ValueError, struct.error) as e:
            return [f"{rel}: {e}"]
        text = json.dumps(doc, ensure_ascii=False)
        out = [] if allow_images or not (doc.get("images") or doc.get("textures")) else [
            f"{rel}: {len(doc.get('images') or [])} embedded image(s) / {len(doc.get('textures') or [])} texture(s)"]
    else:
        try:
            text = json.dumps(json.loads(data), ensure_ascii=False)  # decoded: \u escapes cannot hide a marker
        except ValueError:
            text = data.decode("utf-8", "replace")
        out = []
    m = ZONE_LEAK_MARKERS.search(text)
    if m:
        out.append(f"{rel}: names a local path, the private folder or an e-mail address ({m.group(0)!r})")
    return out


def plan_zones(zsrc: Path, ids: List[str], plan1: Plan) -> List[dict]:
    """Stage the cleared zone packages under `zones/` of repo 1 (see PUBLIC_ZONE_POLICY): zone.json with
    every `reference` asset dropped (+ `twin.referenceScale`, `budget.totalBytes` recounted), the files its
    remaining assets and `twin.catalogue` reference (only under the policy's prefixes), and a
    zones/index.json with just these zones. Exits (no export) on anything it cannot publish safely."""
    if not ids:
        return []
    zv = _load_zone_validator()
    try:
        src_index = json.loads((zsrc / "index.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        sys.exit(f"[export-data] zones/index.json not readable: {e}")
    entries = {z.get("id"): z for z in src_index.get("zones") or [] if isinstance(z, dict)}
    staged: List[dict] = []
    for zid in ids:
        policy = PUBLIC_ZONE_POLICY.get(zid)
        if policy is None:
            sys.exit(f"[export-data] zone {zid} is not cleared for publishing (PUBLIC_ZONE_POLICY in export_data.py)")
        if zid not in entries:
            sys.exit(f"[export-data] zone {zid} is not in {zsrc / 'index.json'}")
        zdir = zsrc / zid
        try:
            m = json.loads((zdir / "zone.json").read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            sys.exit(f"[export-data] zone {zid}: zone.json not readable: {e}")
        if not isinstance(m, dict) or m.get("id") != zid:
            sys.exit(f"[export-data] zone {zid}: zone.json id does not match its folder")
        assets = m.get("assets") if isinstance(m.get("assets"), list) else []
        kept = [a for a in assets if not (isinstance(a, dict) and a.get("role") == "reference")]
        dropped = len(assets) - len(kept)
        files: Dict[str, Path] = {}

        def take(path, what: str) -> None:
            if not (zv.safe_path(path) and path.startswith(tuple(policy["prefixes"]))):
                sys.exit(f"[export-data] zone {zid}: {what} {path!r} is outside the public prefixes {policy['prefixes']}")
            f = zdir / path
            if not f.is_file():
                sys.exit(f"[export-data] zone {zid}: {what} {path} is missing")
            files[path] = allowed_source(f)

        for a in kept:
            for lod in (a.get("lods") if isinstance(a, dict) and isinstance(a.get("lods"), list) else []):
                take(lod.get("path") if isinstance(lod, dict) else None, f"asset {a.get('id')}")
                if isinstance(lod.get("bytes"), int) and lod["bytes"] != files[lod["path"]].stat().st_size:
                    sys.exit(f"[export-data] zone {zid}: {lod['path']} size differs from zone.json (re-package the zone)")
        tw = m.get("twin")
        if isinstance(tw, dict) and isinstance(tw.get("catalogue"), str) and tw["catalogue"].endswith(".json"):
            take(tw["catalogue"], "twin.catalogue")
        module_files = tuple(policy.get("moduleFiles") or ())
        if module_files:
            rt = m.get("runtime") if isinstance(m.get("runtime"), dict) else {}
            if rt.get("kind") != "module" or rt.get("module") != zid:
                sys.exit(f"[export-data] zone {zid}: moduleFiles are cleared for runtime module {zid!r} only")
            for path in module_files:
                take(path, "module file")
        if dropped:
            m["assets"] = kept
            if isinstance(tw, dict):
                tw.pop("referenceScale", None)
            if isinstance(m.get("budget"), dict):
                m["budget"]["totalBytes"] = sum(f.stat().st_size for f in files.values())
            zone_src: Source = (json.dumps(m, ensure_ascii=False, indent=1) + "\n").encode("utf-8")
        else:
            zone_src = zdir / "zone.json"  # unchanged: staged byte-identical
        errs = zv.validate_manifest(m)
        if isinstance(tw, dict) and "catalogue" in tw and tw["catalogue"] in files:
            errs += zv.validate_catalogue(json.loads(files[tw["catalogue"]].read_text(encoding="utf-8")))
        problems = zone_file_problems("zone.json", zone_src if isinstance(zone_src, bytes) else zone_src.read_bytes(), True)
        for rel, f in files.items():
            problems += zone_file_problems(rel, f.read_bytes(), bool(policy.get("images")))
        if errs or problems:
            sys.exit(f"[export-data] refusing to stage zone {zid}: " + "; ".join(errs + problems))
        plan1[f"zones/{zid}/zone.json"] = zone_src
        for rel, f in files.items():
            plan1[f"zones/{zid}/{rel}"] = f
        local = sorted(f.relative_to(zdir).as_posix() for f in walk_files(zdir)) if zdir.is_dir() else []
        skipped = [r for r in local if r != "zone.json" and r not in files]
        staged.append({"id": zid, "files": 1 + len(files), "referenceDropped": dropped, "skipped": skipped,
                       "bytes": sum(f.stat().st_size for f in files.values())})
        print(f"[export-data] zone {zid}: zone.json + {len(files)} file(s) staged, {dropped} reference asset(s) dropped, "
              f"{len(skipped)} local file(s) not staged{' (' + ', '.join(skipped[:5]) + ')' if skipped else ''}")
    order = [z.get("id") for z in src_index.get("zones") or [] if isinstance(z, dict)]
    index = {"format": ZONE_INDEX_FORMAT,
             "zones": [{"id": zid, "bboxEN": entries[zid]["bboxEN"]} for zid in order if zid in ids]}
    plan1["zones/index.json"] = (json.dumps(index, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    return staged


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
        if not v:  # an empty placeholder on a line of its own leaves no blank line (it would split a Markdown table)
            text = re.sub(r"(?m)^\{\{" + re.escape(k) + r"\}\}\n", "", text)
        text = text.replace("{{" + k + "}}", v)
    return text.encode("utf-8")


Scope = Optional[Union[str, Tuple[str, ...]]]


def in_scope(rel: str, scope: Scope) -> bool:
    """`scope` None = everything; else one entry or a tuple: an entry ending in "/" is a prefix, any other names one
    file exactly (`--stats-only`: "saarland/", "overall/manifest.json", "README.md", …)."""
    if not scope:
        return True
    items = (scope,) if isinstance(scope, str) else scope
    return any(rel.startswith(s) if s.endswith("/") else rel == s for s in items)


def pending_deletes(plan: Plan, out: Path, scope: Scope = None) -> List[str]:
    """Files in `out` (relative, sorted; `.git/` excluded, only inside `scope` if given, see `in_scope`) that are not
    in `plan`, i.e. what `sync` would delete. Reads only."""
    planned = set(plan)
    out_list: List[str] = []
    for dirpath, dirnames, filenames in os.walk(out, topdown=True):
        if ".git" in dirnames:
            dirnames.remove(".git")
        dirnames.sort()
        for f in sorted(filenames):
            rel = (Path(dirpath) / f).relative_to(out).as_posix()
            if rel not in planned and in_scope(rel, scope):
                out_list.append(rel)
    return out_list


def delete_guard(targets: Sequence[Tuple[str, Plan, Path, Scope]], max_deletes: int) -> List[str]:
    """Refusal lines when a sync would delete more than `max_deletes` already-staged files from one repo
    (a source dir that was skipped or is missing, e.g. a symlink not followed, wipes the public site);
    empty when every target is within the limit. Reads only."""
    lines: List[str] = []
    for name, plan, out, scope in targets:
        dels = pending_deletes(plan, out, scope)
        if len(dels) <= max_deletes:
            continue
        per_top: Dict[str, int] = {}
        for rel in dels:
            top = "/".join(rel.split("/")[:2]) if "/" in rel else rel
            per_top[top] = per_top.get(top, 0) + 1
        lines.append(f"[export-data] refusing: {name} would lose {len(dels)} already-staged file(s) (limit {max_deletes}):")
        lines += [f"  {n:7d}  {top}" for top, n in sorted(per_top.items(), key=lambda kv: -kv[1])[:12]]
    if lines:
        lines.append("[export-data] A source dir is probably missing or was not read (unlinked data, a print/ dir that lives "
                     "elsewhere). Check with --dry-run; if the deletions are intended, re-run with --allow-deletes. Nothing was written.")
    return lines


def sync(plan: Plan, out: Path, scope: Scope = None, dry_run: bool = False,
         changes: Optional[List[str]] = None) -> Tuple[int, int, int]:
    """Make `out` contain exactly `plan` (except .git/). Returns (copied, unchanged, deleted).
    `scope` (e.g. "zones/", or a tuple, see `in_scope`): only plan entries and files inside it are written or
    deleted, the rest of `out` is not touched. `dry_run`: write nothing, only count. `changes` collects
    "W <path>" / "D <path>" lines."""
    inside = lambda rel: in_scope(rel, scope)  # noqa: E731
    log = changes.append if changes is not None else (lambda _l: None)
    if not dry_run:
        out.mkdir(parents=True, exist_ok=True)
    copied = unchanged = deleted = 0
    for rel, srcv in plan.items():
        if not inside(rel):
            continue
        dst = out / rel
        if isinstance(srcv, bytes):
            if dst.is_file() and dst.read_bytes() == srcv:
                unchanged += 1
                continue
            if not dry_run:
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_bytes(srcv)
            copied += 1
            log(f"W {rel}")
            continue
        st = srcv.stat()
        if dst.is_file():
            dt = dst.stat()
            if dt.st_size == st.st_size and int(dt.st_mtime) == int(st.st_mtime):
                unchanged += 1
                continue
        if not dry_run:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(srcv, dst)
        copied += 1
        log(f"W {rel}")
    for rel in pending_deletes(plan, out, scope):
        if not dry_run:
            (out / rel).unlink()
        deleted += 1
        log(f"D {rel}")
    if not dry_run and out.is_dir():
        for dirpath, dirnames, filenames in os.walk(out, topdown=False):
            p = Path(dirpath)
            rel = p.relative_to(out).as_posix() + "/"
            if p != out and ".git" not in p.parts and inside(rel) and not any(p.iterdir()):
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


def plan_shared(src: Path, app_url: str, plan1: Plan) -> List[str]:
    """Stage `shared/**` (index.json viewer URL rewritten to the public castle viewer); returns their attributions."""
    shared_attr: List[str] = []
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
                    viewer["url"] = app_url.rstrip("/") + "/castle/"
                    plan1[rel] = (json.dumps(idx, ensure_ascii=False, indent=1) + "\n").encode("utf-8")
    return shared_attr


def pois_attribution(src: Path) -> str:
    if (src / "pois.geojson").is_file():
        return json.loads(allowed_source(src / "pois.geojson").read_text(encoding="utf-8")).get("attribution", "")
    return ""


CASTLE_TERRAIN_ATTRIBUTION = ("castle-viewer/terrain: DGM1 GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet; "
                              "1789-Gelände = Hypothese (eigene Arbeit)")


def landing_entries1(m: dict, shared_attr: Sequence[str], pois_attr: str, stats_infos: Sequence[dict],
                     has_castle: bool) -> List[str]:
    """Credit list of repo 1 (ATTRIBUTION, README, index.html): the AOI manifest, shared/, pois, the stats-only
    AOIs (e.g. BKG VG25 for `saarland`), the castle terrain."""
    entries = attribution_entries(m.get("attribution", ""), *shared_attr, pois_attr,
                                  *[i["manifest"].get("attribution", "") for i in stats_infos])
    vg25 = [e for e in entries if STATS_ONLY_ATTRIBUTION.match(e)]
    if len(vg25) > 1:  # a stats-only AOI built before the credit changed (re-run gemeinden_stats.py)
        print(f"[export-data] WARNING: {len(vg25)} different BKG VG25 credits in the landing credits: {vg25}")
    if has_castle:
        entries.append(CASTLE_TERRAIN_ATTRIBUTION)
    return entries


def stats_aoi_texts(stats_infos: Sequence[dict]) -> Dict[str, str]:
    """README / index.html snippets for the staged stats-only AOIs (empty when none)."""
    rows, lic, html_items = [], [], []
    for i in stats_infos:
        aoi, man = i["aoi"], i["manifest"]
        files = ", ".join(f"`{r}`" for r in sorted(i["files"]))
        unit = "Gemeinde" if i["level"] == "gemeinde" else "place"
        rows.append(f"| `{aoi}/` | Stats-only AOI „{man.get('name', aoi)}“ (no terrain, `kind: 'stats-only'`): `manifest.json`, "
                    f"{files} — level `{i['level']}` of the leaderboard *Orte im Vergleich*, aggregates per {unit}, "
                    f"estimates as ranges. |")
        ins = "; ".join(f"{v.get('name_de', k)} ({v.get('provider', '?')}, {v.get('licence', '?')})"
                        for k, v in (i.get("inputs") or {}).items() if isinstance(v, dict))
        line = f"- Leaderboard level `{aoi}/stats/`: aggregates per {unit} only, never per parcel, building, tree or person. Inputs: {ins or '–'}."
        if "vg25" in (i.get("inputs") or {}):
            line += (" Outlines: **BKG VG25** (© BKG, https://www.bkg.bund.de, **CC BY 4.0**, "
                     "https://creativecommons.org/licenses/by/4.0/), Daten verändert: parts dissolved per AGS, simplified to 50 m.")
        lic.append(line)
        item = f"<code>{html.escape(aoi)}/</code> – {html.escape(man.get('name', aoi))}"
        if "vg25" in (i.get("inputs") or {}):
            # BKG Quellenvermerk on a web page: „BKG“ and „CC BY 4.0“ linked (gdz.bkg.bund.de, VG25 Nutzungsbedingungen)
            item += (' (Gemeindegrenzen: © <a href="https://www.bkg.bund.de">BKG</a> VG25, '
                     '<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>, Daten verändert)')
        html_items.append(item)
    return {"STATS_AOI_ROWS": "\n".join(rows), "STATS_AOI_LICENCE": "\n".join(lic),
            "STATS_AOI_HTML": (" Bestenliste ohne Gelände: " + ", ".join(html_items) + ".") if html_items else ""}


def landing_files(a: argparse.Namespace, m: dict, entries1: Sequence[str], entries2: Sequence[str],
                  prints: Sequence[dict], stats_infos: Sequence[dict]) -> Tuple[Plan, Plan]:
    """`.nojekyll`, README.md, ATTRIBUTION, index.html of both repos."""
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
        **stats_aoi_texts(stats_infos),
    }
    out: Tuple[Plan, Plan] = ({}, {})
    for plan, which, entries in ((out[0], "1", entries1), (out[1], "2", entries2)):
        plan[".nojekyll"] = b""
        plan["README.md"] = render(f"data{which}-README.md", vals)
        plan["ATTRIBUTION"] = ("\n".join(entries) + "\n").encode("utf-8")
        plan["index.html"] = render(f"data{which}-index.html", vals)
    return out


def stats_report_lines(stats_infos: Sequence[dict]) -> List[str]:
    lines = []
    for i in stats_infos:
        lines.append(f"  {i['aoi']} (level {i['level']}): {i['bytes'] / 1e3:.1f} KB incl. manifest.json, "
                     f"{len(i['skipped'])} local file(s) not staged")
        lines += [f"    {n / 1e3:8.1f} KB  {i['aoi']}/{r}" for r, n in sorted(i["files"].items())]
        lines += [f"    WARN: {w}" for w in i["warnings"]]
    return lines


def dump_like(base_text: str, doc: dict) -> bytes:
    """Serialise `doc` in the style of `base_text` (compact or json.dumps default), so a merged manifest diffs by
    the added key only."""
    base = json.loads(base_text)
    if json.dumps(base, ensure_ascii=False, separators=(",", ":")) + "\n" == base_text:
        return (json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    return (json.dumps(doc, ensure_ascii=False) + "\n").encode("utf-8")


def stats_only_export(a: argparse.Namespace, src: Path, stats_ids: List[str], level_aois: Dict[str, Optional[str]],
                      max_deletes: Optional[int]) -> int:
    """`--stats-only`: stage the stats-only AOIs into repo 1 and add only STATS_ONLY_MERGE_KEYS from the local
    <aoi>/manifest.json to the manifest already staged in repo 1 (= the published one when the staging clone is
    clean); README.md / ATTRIBUTION / index.html of repo 1 are regenerated. Nothing else in either repo is read,
    written or deleted (no tiles, no pending candidate changes, no other manifest key)."""
    out1 = a.out1.resolve()
    if not stats_ids:
        sys.exit("[export-data] --stats-only needs --stats-aois (RELEASE_STATS_AOIS)")
    base_path = out1 / a.aoi / "manifest.json"
    if not base_path.is_file():
        sys.exit(f"[export-data] --stats-only: no staged {base_path} to add the keys to (check out the published data repo first)")
    base_text = base_path.read_text(encoding="utf-8")
    base = json.loads(base_text)
    local = json.loads(allowed_source(src / a.aoi / "manifest.json").read_text(encoding="utf-8"))
    staged_levels = {**level_aois, a.aoi: stats_level(base)}
    plan: Plan = {}
    infos = [plan_stats_aoi(src, s, plan, staged_levels) for s in stats_ids]
    merged = json.loads(base_text)
    for k in STATS_ONLY_MERGE_KEYS:
        if k in local:
            merged[k] = json.loads(json.dumps(local[k]))
        else:
            merged.pop(k, None)
    for line in check_stats_levels(merged, staged_levels):
        print(line)
    if "stats_levels" in merged:
        have = attribution_entries(merged.get("attribution", ""))
        new = [e for e in attribution_entries(local.get("attribution", "")) if STATS_ONLY_ATTRIBUTION.match(e) and e not in have]
        if new:
            merged["attribution"] = "; ".join([s for s in [merged.get("attribution") or ""] if s] + new)  # appended, nothing else
            print(f"[export-data] {a.aoi}/manifest.json attribution: added {new}")
    added, removed = sorted(set(merged) - set(base)), sorted(set(base) - set(merged))
    changed = sorted(k for k in set(merged) & set(base) if merged[k] != base[k])
    print(f"[export-data] {a.aoi}/manifest.json keys: added {added or '-'}, removed {removed or '-'}, changed {changed or '-'} "
          f"(local keys not published: {sorted(set(local) - set(merged) - {'release'}) or '-'}; "
          f"local values that differ but stay unpublished: {sorted(k for k in set(local) & set(merged) if local[k] != merged[k] and k not in STATS_ONLY_MERGE_KEYS) or '-'})")
    plan[f"{a.aoi}/manifest.json"] = base_text.encode("utf-8") if merged == base else dump_like(base_text, merged)
    has_castle = (out1 / "castle-viewer" / "terrain" / "meta.json").is_file()
    entries1 = landing_entries1(merged, plan_shared(src, a.app_url, {}), pois_attribution(src), infos, has_castle)
    land1, _ = landing_files(a, merged, entries1, [], [], infos)
    plan.update(land1)
    scope = (*(f"{s}/" for s in stats_ids), f"{a.aoi}/manifest.json", *land1)
    refusal = [] if max_deletes is None else delete_guard([("saar-lidar-data (stats only)", plan, out1, scope)], max_deletes)
    if refusal and not a.dry_run:
        print("\n".join(refusal), file=sys.stderr)
        return EXIT_DELETE_GUARD
    changes: List[str] = []
    c, u, d = sync(plan, out1, scope=scope, dry_run=a.dry_run, changes=changes)
    print(f"[export-data] saar-lidar-data stats only{' (dry run)' if a.dry_run else ''}: {c} written, {u} unchanged, {d} deleted")
    for line in changes:
        print(f"  {line}")
    lines = ["## stats-only AOIs (saar-lidar-data, --stats-only)", *stats_report_lines(infos)]
    lines += [f"    {len(plan[r]) / 1e3:8.1f} KB  {r}" for r in sorted(plan) if isinstance(plan[r], bytes) and not r.startswith(tuple(f"{s}/" for s in stats_ids))]
    print("\n".join(lines))
    if refusal:
        print("\n".join(refusal), file=sys.stderr)
        return EXIT_DELETE_GUARD
    return 0


def main(argv: Optional[List[str]] = None) -> int:
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
    ap.add_argument("--zones", default="", help="comma list of zone packages to publish (each must be in PUBLIC_ZONE_POLICY)")
    ap.add_argument("--zones-only", action="store_true", help="stage only <out1>/zones/; nothing else is read, written or deleted")
    ap.add_argument("--stats-aois", default="", help="comma list of stats-only AOIs (kind 'stats-only', e.g. saarland) staged to repo 1")
    ap.add_argument("--stats-only", action="store_true",
                    help="stage only the --stats-aois and add their manifest key stats_levels to the already staged "
                         "<out1>/<aoi>/manifest.json (+ README/ATTRIBUTION/index.html); nothing else is touched")
    ap.add_argument("--dry-run", action="store_true", help="list what would be written/deleted, change nothing")
    ap.add_argument("--link-root", action="append", type=Path, default=[],
                    help="also follow input symlinks that resolve inside this dir (repeatable; the repo, --src and "
                         "--castle-terrain always count)")
    ap.add_argument("--max-deletes", type=int, default=DEFAULT_MAX_DELETES,
                    help=f"refuse (exit {EXIT_DELETE_GUARD}, nothing written) when a repo would lose more staged files than this "
                         f"(default {DEFAULT_MAX_DELETES})")
    ap.add_argument("--allow-deletes", action="store_true", help="lift the --max-deletes guard (intended removals)")
    a = ap.parse_args(argv)
    src = a.src.resolve()
    LINK_ROOTS[:] = [HERE.parents[1], src, a.castle_terrain.resolve(), *(r.resolve() for r in a.link_root)]
    max_deletes = None if a.allow_deletes else max(0, a.max_deletes)
    for o in (a.out1, a.out2):
        if str(o.resolve()).startswith(str(Path(__file__).resolve().parents[2]) + os.sep):
            sys.exit(f"[export-data] refusing to write inside the code repository: {o}")
    zone_ids = [z.strip() for z in a.zones.split(",") if z.strip()]
    stats_ids = [s.strip() for s in a.stats_aois.split(",") if s.strip()]
    if a.zones_only and a.stats_only:
        sys.exit("[export-data] --zones-only and --stats-only exclude each other")
    for s in stats_ids:
        if s == a.aoi or "/" in s or s.startswith("."):
            sys.exit(f"[export-data] bad stats-only AOI name {s!r}")

    if a.zones_only:
        plan_z: Plan = {}
        zones = plan_zones(src / "zones", zone_ids, plan_z)
        refusal = [] if max_deletes is None else delete_guard([("saar-lidar-data zones/", plan_z, a.out1.resolve(), "zones/")], max_deletes)
        if refusal and not a.dry_run:
            print("\n".join(refusal), file=sys.stderr)
            return EXIT_DELETE_GUARD
        changes: List[str] = []
        c, u, d = sync(plan_z, a.out1.resolve(), scope="zones/", dry_run=a.dry_run, changes=changes)
        print(f"[export-data] saar-lidar-data zones/ only{' (dry run)' if a.dry_run else ''}: "
              f"{c} written, {u} unchanged, {d} deleted; zones: {', '.join(z['id'] for z in zones) or '(none)'}")
        for line in changes:
            print(f"  {line}")
        if a.dry_run:
            if refusal:
                print("\n".join(refusal), file=sys.stderr)
            return EXIT_DELETE_GUARD if refusal else 0
        limits = {"site_hard": a.site_hard_mb, "site_aim": a.site_aim_mb, "file_hard": a.file_hard_mb, "file_aim": a.file_aim_mb}
        lines, ok = size_report("saar-lidar-data", a.out1.resolve(), limits)
        print("\n".join(lines))
        return 0 if ok else 2

    level_aois = {s: read_stats_level(src, s) for s in stats_ids}
    if a.stats_only:
        return stats_only_export(a, src, stats_ids, level_aois, max_deletes)
    plan1: Plan = {}
    plan2: Plan = {}
    stats_infos = [plan_stats_aoi(src, s, plan1, {**level_aois, a.aoi: read_stats_level(src, a.aoi)}) for s in stats_ids]
    aoi_info = plan_aoi(src, a.aoi, a.xyz_max_zoom, a.data2_url, plan1, plan2, level_aois=level_aois)
    m = aoi_info["manifest"]
    if (src / "pois.geojson").is_file():
        plan1["pois.geojson"] = allowed_source(src / "pois.geojson")
    shared_attr = plan_shared(src, a.app_url, plan1)
    has_castle = plan_castle_terrain(a.castle_terrain.resolve(), plan1)
    zones = plan_zones(src / "zones", zone_ids, plan1)
    prints = plan_print(src, plan2)

    entries1 = landing_entries1(m, shared_attr, pois_attribution(src), stats_infos, has_castle)
    hist_attr = [e.get("attribution", "") for e in (m.get("xyz") or {}).values()]
    # relief tiles: the terrain entries of the manifest (those without a "(product)" suffix)
    terrain_attr = [e for e in attribution_entries(m.get("attribution", "")) if "(" not in e and "OpenStreetMap" not in e]
    entries2 = attribution_entries(*terrain_attr, *hist_attr, *[p["attribution"] for p in prints])
    land1, land2 = landing_files(a, m, entries1, entries2, prints, stats_infos)
    plan1.update(land1)
    plan2.update(land2)

    limits = {"site_hard": a.site_hard_mb, "site_aim": a.site_aim_mb, "file_hard": a.file_hard_mb, "file_aim": a.file_aim_mb}
    report: List[str] = []
    ok_all = True
    targets = [("saar-lidar-data", plan1, a.out1.resolve(), None), ("saar-lidar-data-2", plan2, a.out2.resolve(), None)]
    refusal = [] if max_deletes is None else delete_guard(targets, max_deletes)
    if refusal and not a.dry_run:
        print("\n".join(refusal), file=sys.stderr)
        return EXIT_DELETE_GUARD
    if a.dry_run:
        for name, plan, out in (("saar-lidar-data", plan1, a.out1), ("saar-lidar-data-2", plan2, a.out2)):
            changes = []
            c, u, d = sync(plan, out.resolve(), dry_run=True, changes=changes)
            print(f"[export-data] {name} (dry run): {c} would be written, {u} unchanged, {d} would be deleted")
            for line in changes:
                print(f"  {line}")
        if refusal:
            print("\n".join(refusal), file=sys.stderr)
        return EXIT_DELETE_GUARD if refusal else 0
    for name, plan, out in (("saar-lidar-data", plan1, a.out1), ("saar-lidar-data-2", plan2, a.out2)):
        c, u, d = sync(plan, out.resolve())
        print(f"[export-data] {name}: {c} written, {u} unchanged, {d} deleted")
        lines, ok = size_report(name, out.resolve(), limits)
        report += lines + [""]
        ok_all &= ok
    xyz_lines = [f"  xyz.{k}: {v['tiles']} tiles, {v['bytes'] / 1e6:.1f} MB (<= z{a.xyz_max_zoom})" for k, v in aoi_info["xyz"].items()]
    report += ["## xyz (moved to saar-lidar-data-2)", *xyz_lines, f"  tiles above z{a.xyz_max_zoom} dropped: {aoi_info['skippedTiles']}", ""]
    report += ["## print", *[f"  {p['series']}: {p['files3mf']} 3MF, {p['tiles']} tiles in index" for p in prints], ""]
    zone_lines = [f"  {z['id']}: {z['files']} files, {z['bytes'] / 1e6:.1f} MB + zone.json, {z['referenceDropped']} reference "
                  f"asset(s) dropped, {len(z['skipped'])} local file(s) not staged" for z in zones]
    report += ["## zones (saar-lidar-data/zones/)", *(zone_lines or ["  (none)"]), ""]
    report += ["## stats-only AOIs (saar-lidar-data)", *(stats_report_lines(stats_infos) or ["  (none)"]), ""]
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
