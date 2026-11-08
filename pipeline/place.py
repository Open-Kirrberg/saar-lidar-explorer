"""S3 place build from a place repo's `ort.toml` (plan „Orte skalieren“ §4.4, §9 S3; ADR 0052, 0053).

The reusable workflow `.github/workflows/build-place.yml` and the local dry run
(`scripts/release/dry-run-orte.sh`) run exactly these commands:

    uv run python place.py plan  --ort ../ort/ort.toml --catalog <url|path> --app-data DIR --work DIR
    uv run python place.py build --ort ../ort/ort.toml --catalog <url|path> --app-data DIR --work DIR
    uv run python place.py stage --ort ../ort/ort.toml --site DIR/ort-<id> --repo ../ort
    uv run python place.py check --ort ../ort/ort.toml --site DIR/ort-<id> --catalog <url|path> --work DIR

- `plan` validates `ort.toml` (schema `sle-ort-v1`, below), reads the place's owned tiles from the published catalog
  (`sle-catalog-v1`, ownership is never computed by a place), writes the AOI table `<work>/place/aois.ort.toml`
  (key `ort-<id>`, read by every step through `$SLE_AOIS_EXTRA`) and prints the cache keys
  (`raw_key` = fetch set + source versions, `build_key` = pipeline version + ref + owned tiles + build options).
- `build` runs the v3 place steps with `SLE_APP_DATA`, `SLE_WORK_DIR`, `SLE_AOIS_EXTRA` set. Required steps fail
  the build; the Geoportal steps (`cadastre`, `historic`) are optional: on a service outage the site ships without
  parcels / historic maps and the report says so. Steps whose only source covers one state (`STATE_ONLY_STEPS`:
  historic maps = Saarland) are reported "not applicable" for a place in another state (S4, Zweibrücken).
- `stage` adds the community content (`inhalte/`, `aktionen/`, unchanged; not read by the app before S5), `.nojekyll`,
  `ATTRIBUTION.txt` and a small German landing page.
- `check` enforces the hosting limits (file < 100 MB, site ≤ 1 GB), the contract identity (v3, place id / AGS, presence
  ⊆ owned tiles), ADR 0053 (candidates only on opt-in) and ADR 0010 (no UXO terms), and no local paths.

`ort.toml` (`sle-ort-v1`): `schema`, `id`, `name_de`, `ags`, `state` ("SL" | "RP"), `maintainers` (GitHub handles),
`[options]` `relict_candidates` (bool, default false) and `pointclouds` (ids of the explorer's focus areas,
aois.toml `[[defaults.pointclouds]]`), optional `[[pointcloud_area]]` tables (`id`, `name_de`, `bbox` in EPSG:25832,
multiples of 100 m, ≤ 1 km² each); at most 5 areas in total. Unknown keys are errors (typos must not pass silently).
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import time
import tomllib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from common import PIPELINE_DIR, PIPELINE_VERSION, ROOT

SCHEMA = "sle-ort-v1"
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
AGS_RE = re.compile(r"^\d{8}$")
HANDLE_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")
AREA_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
MAX_AREAS = 5
MAX_AREA_M2 = 1_000_000
DEFAULT_CATALOG_URL = "https://open-kirrberg.github.io/orte-katalog/catalog.json"
# Versions of the official sources behind the raw cache. Bump an entry when a source publishes a new edition
# (e.g. a new LiDAR flight): the raw cache key changes and every place refetches once (R8: no blind rebuilds).
SOURCE_VERSIONS = {
    "lvgl-sl dgm1/dom1/laz": "ALS 2025",
    "geobasis-rlp dgm1/dom1": "current (2022 flight)",
    "dop20 wms": "TrueDOP20 SL + RP DOP20",
    "lod2": "SL county ZIP + RP current",
    "osm": "Overpass, cached per query",
}
RAW_LAYOUT = "raw-v1"   # bump when the raw cache layout under data/raw changes
# Steps whose only source covers one state (S4): historic maps come from the WMS "SL Historische Karten" (Geoportal
# Saarland); a place in another state skips the step instead of requesting empty images.
STATE_ONLY_STEPS = {"historic": "SL"}

# Hosting limits (GitHub Pages): one file < 100 MB, published site ≤ 1 GB; warn above WARN_SITE_BYTES.
MAX_FILE_BYTES = 100 * 1000 * 1000
MAX_SITE_BYTES = 1000 * 1000 * 1000
WARN_SITE_BYTES = 900 * 1000 * 1000
UXO_TERMS = ("crater", "bombentrichter", "trichterfeld")
TEXT_EXT = {".json", ".geojson", ".md", ".html", ".txt", ".yml", ".yaml", ".csv", ".toml"}
CONTENT_DIRS = ("inhalte", "aktionen")
CONTENT_EXT = {".geojson", ".json", ".md", ".yml", ".yaml", ".jpg", ".jpeg", ".png", ".webp", ".avif"}
LOCAL_PATH_RE = re.compile(r"(/Users/[A-Za-z]|/home/runner/|[A-Za-z]:\\Users\\)")

# (step, script, required); `pois` only with candidates, `pointcloud` only with areas.
STEPS: tuple[tuple[str, str, bool], ...] = (
    ("fetch", "fetch.py", True),
    ("build", "build.py", True),
    ("xyz", "xyz.py", True),
    ("osm", "osm.py", True),
    ("cadastre", "cadastre.py", False),
    ("buildings", "buildings.py", True),
    ("ortho", "ortho.py", True),
    ("historic", "historic.py", False),
    ("pois", "pois.py", True),
    ("detect", "detect.py", True),
    ("pointcloud", "pointcloud.py", True),
    ("trees", "trees.py", True),
)


class OrtError(ValueError):
    """ort.toml does not follow `sle-ort-v1`; `.problems` lists every finding."""

    def __init__(self, problems: Sequence[str]):
        super().__init__("; ".join(problems))
        self.problems = list(problems)


@dataclass(frozen=True)
class Area:
    id: str
    name_de: str
    bbox: tuple[int, int, int, int]


@dataclass(frozen=True)
class Ort:
    id: str
    name_de: str
    ags: str
    state: str
    maintainers: tuple[str, ...]
    relict_candidates: bool = False
    pointclouds: tuple[str, ...] = ()
    own_areas: tuple[Area, ...] = field(default_factory=tuple)

    @property
    def key(self) -> str:
        return f"ort-{self.id}"


# ============================================================================================ pure
def parse_area(raw: Any, where: str, problems: list[str]) -> Area | None:
    if not isinstance(raw, dict):
        problems.append(f"{where}: must be a table")
        return None
    extra = set(raw) - {"id", "name_de", "bbox"}
    if extra:
        problems.append(f"{where}: unknown keys {sorted(extra)}")
    aid, name, bbox = raw.get("id"), raw.get("name_de"), raw.get("bbox")
    if not isinstance(aid, str) or not AREA_ID_RE.match(aid):
        problems.append(f"{where}: id must match {AREA_ID_RE.pattern}")
        return None
    if not isinstance(name, str) or not name.strip() or len(name) > 80:
        problems.append(f"{where}: name_de must be 1–80 characters")
    if (not isinstance(bbox, list) or len(bbox) != 4 or not all(isinstance(v, int) for v in bbox)):
        problems.append(f"{where}: bbox must be [E_min, N_min, E_max, N_max] (integers, EPSG:25832)")
        return None
    e0, n0, e1, n1 = bbox
    if any(v % 100 for v in bbox) or e1 <= e0 or n1 <= n0:
        problems.append(f"{where}: bbox must be ordered multiples of 100 m")
        return None
    if (e1 - e0) * (n1 - n0) > MAX_AREA_M2:
        problems.append(f"{where}: area {(e1 - e0) * (n1 - n0) / 1e6:.2f} km² > 1 km²")
    return Area(aid, str(name or aid), (e0, n0, e1, n1))


def parse_ort(doc: Mapping[str, Any]) -> Ort:
    """Validate an `ort.toml` document (already parsed). Raises OrtError with every problem found. Pure."""
    p: list[str] = []
    allowed = {"schema", "id", "name_de", "ags", "state", "maintainers", "options", "pointcloud_area"}
    extra = set(doc) - allowed
    if extra:
        p.append(f"unknown keys {sorted(extra)} (allowed: {sorted(allowed)})")
    if doc.get("schema") != SCHEMA:
        p.append(f"schema must be {SCHEMA!r}")
    pid = doc.get("id")
    if not isinstance(pid, str) or not ID_RE.match(pid):
        p.append(f"id must match {ID_RE.pattern} (the catalog place id, e.g. 'homburg')")
    name = doc.get("name_de")
    if not isinstance(name, str) or not name.strip() or len(name) > 60:
        p.append("name_de must be 1–60 characters")
    ags = doc.get("ags")
    if not isinstance(ags, str) or not AGS_RE.match(ags):
        p.append("ags must be the 8-digit Amtlicher Gemeindeschlüssel as a string, e.g. \"10045114\"")
    state = doc.get("state")
    if state not in ("SL", "RP"):
        p.append("state must be \"SL\" or \"RP\"")
    m = doc.get("maintainers", [])
    if not isinstance(m, list) or not m or not all(isinstance(h, str) and HANDLE_RE.match(h) for h in m):
        p.append("maintainers must list at least one GitHub handle (no names, no e-mail addresses: R7)")
        m = []
    opts = doc.get("options", {})
    if not isinstance(opts, dict):
        p.append("[options] must be a table")
        opts = {}
    extra = set(opts) - {"relict_candidates", "pointclouds"}
    if extra:
        p.append(f"[options]: unknown keys {sorted(extra)}")
    rc = opts.get("relict_candidates", False)
    if not isinstance(rc, bool):
        p.append("options.relict_candidates must be true or false (ADR 0053, default false)")
        rc = False
    pcs = opts.get("pointclouds", [])
    if not isinstance(pcs, list) or not all(isinstance(x, str) and AREA_ID_RE.match(x) for x in pcs):
        p.append("options.pointclouds must be a list of focus-area ids")
        pcs = []
    raw_areas = doc.get("pointcloud_area", [])
    if not isinstance(raw_areas, list):
        p.append("[[pointcloud_area]] must be an array of tables")
        raw_areas = []
    own = [a for n, r in enumerate(raw_areas) if (a := parse_area(r, f"pointcloud_area[{n}]", p))]
    ids = list(pcs) + [a.id for a in own]
    if len(ids) != len(set(ids)):
        p.append("point-cloud area ids must be unique")
    if len(ids) > MAX_AREAS:
        p.append(f"at most {MAX_AREAS} point-cloud areas (≈ 40 MB each)")
    if p:
        raise OrtError(p)
    return Ort(pid, name.strip(), ags, state, tuple(m), rc, tuple(pcs), tuple(own))


def resolve_areas(ort: Ort, defaults: Sequence[Mapping[str, Any]]) -> list[Area]:
    """The ort's point-cloud areas: referenced explorer focus areas (by id) + its own. Raises OrtError on an unknown
    id. Pure."""
    known = {str(a["id"]): a for a in defaults}
    out, bad = [], []
    for aid in ort.pointclouds:
        a = known.get(aid)
        if a is None:
            bad.append(f"options.pointclouds: unknown focus area {aid!r} (known: {sorted(known)})")
            continue
        out.append(Area(aid, str(a.get("name_de", aid)), tuple(int(v) for v in a["bbox"])))
    if bad:
        raise OrtError(bad)
    return out + list(ort.own_areas)


def check_against_catalog(ort: Ort, places_meta: Mapping[str, Mapping[str, Any]]) -> list[str]:
    """Identity check against the catalog entry: errors (list) when the place is unknown or the AGS differs; a
    different name is only reported by the caller as a warning. Pure."""
    e = places_meta.get(ort.id)
    if e is None:
        return [f"place {ort.id!r} is not in the catalog (ids are the catalog's, e.g. 'homburg')"]
    if e.get("ags") != ort.ags:
        return [f"ags {ort.ags} ≠ catalog ags {e.get('ags')} for {ort.id!r}"]
    return []


def _toml_str(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)   # a JSON string is a valid TOML basic string for these values


def aoi_table(ort: Ort, areas: Sequence[Area], catalog_path: Path, cache_from: str | None = None) -> str:
    """The `[ort-<id>]` AOI table for `$SLE_AOIS_EXTRA`. Pure."""
    lines = [f"[{ort.key}]", f"name = {_toml_str(ort.name_de)}", f"place = {_toml_str(ort.id)}",
             f"catalog = {_toml_str(str(catalog_path))}",
             f"relict_candidates = {'true' if ort.relict_candidates else 'false'}", 'phase = "S3"']
    if cache_from:
        lines.append(f"cache_from = {_toml_str(cache_from)}")
    pcs = ", ".join(f"{{ id = {_toml_str(a.id)}, name_de = {_toml_str(a.name_de)}, bbox = [{', '.join(map(str, a.bbox))}] }}"
                    for a in areas)
    lines.append(f"pointclouds = [{pcs}]")
    return "\n".join(lines) + "\n"


def _sha(parts: Sequence[str]) -> str:
    return hashlib.sha256("\n".join(parts).encode()).hexdigest()[:20]


def raw_key(ort: Ort, fetch_tiles: Sequence[str], areas: Sequence[Area]) -> str:
    """actions/cache key of the raw downloads: fetch set + source versions + LAZ areas. Pure."""
    parts = [RAW_LAYOUT, *sorted(fetch_tiles), *(f"{k}={v}" for k, v in sorted(SOURCE_VERSIONS.items())),
             *(f"area {a.id} {a.bbox}" for a in sorted(areas, key=lambda a: a.id))]
    return f"sle-raw-{ort.id}-{_sha(parts)}"


def build_key(ort: Ort, owned_tiles: Sequence[str], areas: Sequence[Area], pipeline_ref: str) -> str:
    """actions/cache key of a finished data build: changes with the pipeline (version + ref), the owned tiles and the
    build options, never with community content. Pure."""
    parts = [PIPELINE_VERSION, pipeline_ref, ort.id, ort.ags, ort.name_de, f"candidates={ort.relict_candidates}",
             *sorted(owned_tiles), *(f"area {a.id} {a.bbox}" for a in sorted(areas, key=lambda a: a.id)),
             *(f"{k}={v}" for k, v in sorted(SOURCE_VERSIONS.items()))]
    return f"sle-site-{ort.id}-{PIPELINE_VERSION}-{_sha(parts)}"


def scan_text(name: str, text: str) -> list[str]:
    """ADR 0010 + privacy: UXO terms and local paths in a published text file → problems. Pure."""
    low = text.lower()
    out = [f"{name}: contains the UXO term {t!r} (ADR 0010)" for t in UXO_TERMS if t in low]
    if LOCAL_PATH_RE.search(text):
        out.append(f"{name}: contains a local path")
    return out


def check_manifest(m: Mapping[str, Any], ort: Ort, owned: set[tuple[int, int]], areas: Sequence[Area]) -> list[str]:
    """Contract identity of a built place manifest (v3, grid, place, presence ⊆ owned, ADR 0053). Pure."""
    from grid import GRID, presence_tiles
    p = []
    if m.get("version") != 3:
        p.append(f"manifest version {m.get('version')} (a place publishes version 3)")
    if m.get("grid") != GRID:
        p.append("manifest grid is not sle-grid-25832-v1")
    if (m.get("place") or {}).get("id") != ort.id or (m.get("place") or {}).get("ags") != ort.ags:
        p.append(f"manifest place {m.get('place')} ≠ ort.toml {ort.id}/{ort.ags}")
    try:
        e0, h = m["origin"]["E0"], m["size"]["height"] * m.get("cellSize", 1)
        n1 = m["origin"]["N0"] + h
        pres = presence_tiles(m["presence"], e0, n1) if "presence" in m else None
        if pres is not None and not pres <= owned:
            p.append(f"presence names {len(pres - owned)} tiles the catalog does not give to {ort.id}")
    except (KeyError, TypeError, ValueError) as e:
        p.append(f"manifest presence/origin invalid ({e})")
    if "candidates" in m and not ort.relict_candidates:
        p.append("manifest has candidates but options.relict_candidates is false (ADR 0053)")
    pc = (m.get("pointclouds") or {}).get("areas") or []
    allowed = {a.id for a in areas}
    extra = sorted({a.get("id") for a in pc if isinstance(a, dict)} - allowed)
    if extra:
        p.append(f"point-cloud areas {extra} are not opted in by ort.toml")
    return p


# ============================================================================================ I/O
def load_ort(path: Path) -> Ort:
    try:
        doc = tomllib.loads(Path(path).read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as e:
        raise OrtError([f"{path}: not valid TOML ({e})"]) from None
    return parse_ort(doc)


def fetch_catalog(src: str, dest: Path) -> dict[str, Any]:
    """Catalog from an https URL (one GET, descriptive User-Agent) or a local path; saved to `dest`."""
    if re.match(r"^https?://", src):
        if not (src.startswith("https://") or re.match(r"^http://(localhost|127\.0\.0\.1)(:\d+)?/", src)):
            sys.exit(f"catalog URL must be https: {src}")
        from common import http_open
        with http_open(src, timeout=60) as r:
            raw = r.read(5_000_000)
    else:
        raw = Path(src).read_bytes()
    doc = json.loads(raw)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw)
    return doc


def git_ref() -> str:
    try:
        r = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"], capture_output=True, text=True, check=True)
        return r.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "nogit"


@dataclass
class Plan:
    ort: Ort
    areas: list[Area]
    owned: set[tuple[int, int]]
    fetch: set[tuple[int, int]]
    aoi_file: Path
    catalog_file: Path
    app_data: Path
    work: Path
    status: str
    warnings: list[str]

    @property
    def site(self) -> Path:
        return self.app_data / self.ort.key

    def outputs(self, pipeline_ref: str) -> dict[str, str]:
        from grid import tile_id
        owned = [tile_id(t) for t in sorted(self.owned)]
        return {"key": self.ort.key, "place_id": self.ort.id, "site": str(self.site),
                "owned_tiles": str(len(self.owned)), "fetch_tiles": str(len(self.fetch)),
                "raw_key": raw_key(self.ort, [tile_id(t) for t in self.fetch], self.areas),
                "build_key": build_key(self.ort, owned, self.areas, pipeline_ref),
                "pipeline_version": PIPELINE_VERSION, "pipeline_ref": pipeline_ref,
                "catalog_status": self.status}


def make_plan(ort_path: Path, catalog_src: str, app_data: Path, work: Path) -> Plan:
    from catalog import owners_from_catalog, owned_tiles
    from common import load_aois
    from grid import neighbours8
    ort = load_ort(ort_path)
    pdir = work / "place"
    cat_file = pdir / "catalog.json"
    doc = fetch_catalog(catalog_src, cat_file)
    owners, meta = owners_from_catalog(doc)
    errs = check_against_catalog(ort, meta["places"])
    if errs:
        raise OrtError(errs)
    warnings = []
    entry = meta["places"][ort.id]
    if entry.get("name_de") != ort.name_de:
        warnings.append(f"name_de {ort.name_de!r} differs from the catalog's {entry.get('name_de')!r}")
    if entry.get("status") == "stats":
        warnings.append(f"the catalog lists {ort.id!r} as 'stats' (no data_url yet): the app will not load this "
                        "site until orte-katalog/orte.toml sets status '3d' and the data_url")
    owned = owned_tiles(owners, ort.id)
    if not owned:
        raise OrtError([f"the catalog gives no tile to {ort.id!r}"])
    areas = resolve_areas(ort, load_aois().get("defaults", {}).get("pointclouds", []))
    cache_from = os.environ.get("SLE_CACHE_FROM", "").strip() or None
    pdir.mkdir(parents=True, exist_ok=True)
    aoi_file = pdir / "aois.ort.toml"
    aoi_file.write_text(aoi_table(ort, areas, cat_file.resolve(), cache_from))
    return Plan(ort, areas, owned, neighbours8(owned), aoi_file, cat_file, app_data, work,
                str(entry.get("status")), warnings)


def skip_reason(step: str, ort: Ort, has_areas: bool) -> str | None:
    """Why `step` does not run for this place (None = it runs). Pure."""
    if step == "pois" and not ort.relict_candidates:
        return "no relict candidates (ADR 0053)"
    if step == "pointcloud" and not has_areas:
        return "no point-cloud areas"
    only = STATE_ONLY_STEPS.get(step)
    if only and ort.state != only:
        return f"source covers {only} only, place is in {ort.state}"
    return None


def step_env(plan: Plan) -> dict[str, str]:
    env = dict(os.environ)
    env.update({"SLE_AOIS_EXTRA": str(plan.aoi_file.resolve()), "SLE_APP_DATA": str(plan.app_data.resolve()),
                "SLE_WORK_DIR": str(plan.work.resolve()),
                "SLE_PREVIEW_DIR": str((plan.work / "previews").resolve()), "PYTHONUNBUFFERED": "1"})
    return env


def run_build(plan: Plan, workers: int, only: Sequence[str] | None = None) -> dict[str, Any]:
    env = step_env(plan)
    report: dict[str, Any] = {"place": plan.ort.id, "pipeline": PIPELINE_VERSION, "steps": []}
    t_all = time.time()
    for name, script, required in STEPS:
        if only and name not in only:
            continue
        why = skip_reason(name, plan.ort, bool(plan.areas))
        if why:
            if name == "pointcloud":
                shutil.rmtree(plan.site / "pointclouds", ignore_errors=True)   # never a stale opt-out area
            if name in STATE_ONLY_STEPS:
                report["steps"].append({"step": name, "status": f"not applicable ({why})", "seconds": 0, "exit": 0})
                print(f"=== {name}: not applicable ({why})", flush=True)
            continue
        args = [sys.executable, script, plan.ort.key] if name != "pois" else [sys.executable, script]
        if name == "build":
            args += ["--workers", str(workers)]
        print(f"=== {name} {plan.ort.key}", flush=True)
        t0 = time.time()
        rc = subprocess.run(args, cwd=PIPELINE_DIR, env=env).returncode
        dt_s = round(time.time() - t0, 1)
        status = "ok" if rc == 0 else ("failed" if required else "skipped (optional service failed)")
        report["steps"].append({"step": name, "status": status, "seconds": dt_s, "exit": rc})
        print(f"=== {name}: {status} in {dt_s}s", flush=True)
        if rc != 0 and required:
            report["result"] = f"failed at {name}"
            break
    else:
        report["result"] = "ok"
    report["seconds"] = round(time.time() - t_all, 1)
    report["site_bytes"] = site_bytes(plan.site)
    (plan.work / "place").mkdir(parents=True, exist_ok=True)
    (plan.work / "place" / "build-report.json").write_text(json.dumps(report, indent=1) + "\n")
    return report


def site_bytes(site: Path) -> int:
    return sum(p.stat().st_size for p in site.rglob("*") if p.is_file()) if site.exists() else 0


def landing_page(ort: Ort, attribution: str) -> str:
    e = html.escape
    items = "".join(f"<li>{e(a)}</li>" for a in attribution.split("; ") if a)
    return f"""<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(ort.name_de)} – Saar LiDAR Explorer (Daten)</title>
<style>body{{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1d2a22;background:#f7f7f2}}
a{{color:#1f6f43}}code{{background:#e9ecdf;padding:0 .2em}}</style></head><body>
<h1>{e(ort.name_de)}</h1>
<p>Dies ist die Datenseite von <strong>{e(ort.name_de)}</strong> für den
<a href="https://open-kirrberg.github.io/saar-lidar-explorer/">Saar LiDAR Explorer</a>: Geländedaten (Laserscanning),
Reliefansichten, Gebäude, Bäume und die Inhalte der Ortspaten. Die App lädt sie über
<code>manifest.json</code>; hier gibt es nichts zu bedienen.</p>
<p><strong>Schauen, nicht graben.</strong> Auffälligkeiten im Relief sind Hypothesen, keine Funde. Bodendenkmäler sind
geschützt (SDschG Saarland, DSchG Rheinland-Pfalz): nicht graben, nicht sondeln, Funde der Denkmalpflege melden.</p>
<h2>Quellen und Lizenzen</h2><ul>{items}</ul>
<p>Beiträge der Ortspaten (<code>inhalte/</code>, <code>aktionen/</code>): Texte und Bilder CC BY 4.0 (oder CC BY-SA 4.0
je Beitrag), Datenpunkte CC0 1.0 bzw. ODbL bei OpenStreetMap-Ableitungen – Urheber und Lizenz stehen an jedem Beitrag.</p>
</body></html>
"""


def stage_site(ort: Ort, site: Path, repo: Path) -> dict[str, int]:
    """Copy the community content (allowed file types only, no symlinks) and write the landing files."""
    m = json.loads((site / "manifest.json").read_text())
    counts = {}
    for d in CONTENT_DIRS:
        src, dst = repo / d, site / d
        shutil.rmtree(dst, ignore_errors=True)
        n = 0
        if src.is_dir():
            for f in sorted(src.rglob("*")):
                if f.is_symlink():
                    sys.exit(f"{f}: symlinks are not published")
                if not f.is_file() or f.name.startswith(".") or f.suffix.lower() not in CONTENT_EXT:
                    continue
                out = dst / f.relative_to(src)
                out.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(f, out)
                n += 1
        counts[d] = n
    (site / ".nojekyll").write_text("")
    (site / "ATTRIBUTION.txt").write_text("\n".join(a for a in m.get("attribution", "").split("; ") if a) + "\n")
    (site / "index.html").write_text(landing_page(ort, m.get("attribution", "")))
    return counts


def check_site(site: Path, ort: Ort, owned: set[tuple[int, int]], areas: Sequence[Area]) -> tuple[list[str], list[str]]:
    """(errors, warnings) for a staged site."""
    errors, warnings = [], []
    mf = site / "manifest.json"
    if not mf.exists():
        return [f"{mf} missing"], []
    errors += check_manifest(json.loads(mf.read_text()), ort, owned, areas)
    total, files = 0, 0
    for p in sorted(site.rglob("*")):
        rel = p.relative_to(site).as_posix()
        if p.is_symlink():
            errors.append(f"{rel}: symlink")
            continue
        if not p.is_file():
            continue
        size = p.stat().st_size
        total += size
        files += 1
        if size >= MAX_FILE_BYTES:
            errors.append(f"{rel}: {size / 1e6:.1f} MB ≥ 100 MB (GitHub file limit)")
        if p.suffix.lower() in TEXT_EXT and size < 50_000_000:
            errors += scan_text(rel, p.read_text(encoding="utf-8", errors="replace"))
    if total > MAX_SITE_BYTES:
        errors.append(f"site {total / 1e6:.0f} MB > 1 GB (GitHub Pages limit)")
    elif total > WARN_SITE_BYTES:
        warnings.append(f"site {total / 1e6:.0f} MB is close to the 1 GB Pages limit")
    print(f"site {site}: {files} files, {total / 1e6:.1f} MB")
    return errors, warnings


def write_outputs(outputs: Mapping[str, str]) -> None:
    for k, v in outputs.items():
        print(f"{k}={v}")
    gh = os.environ.get("GITHUB_OUTPUT")
    if gh:
        with open(gh, "a", encoding="utf-8") as f:
            for k, v in outputs.items():
                f.write(f"{k}={v}\n")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["validate", "plan", "build", "stage", "check"])
    ap.add_argument("--ort", type=Path, required=True, help="path of the place repo's ort.toml")
    ap.add_argument("--catalog", default=DEFAULT_CATALOG_URL, help="sle-catalog-v1 URL or local path")
    ap.add_argument("--app-data", type=Path, help="output root; the site is <app-data>/ort-<id>/")
    ap.add_argument("--work", type=Path, help="work dir (rasters, reports, the generated AOI table)")
    ap.add_argument("--site", type=Path, help="stage/check: the site dir")
    ap.add_argument("--repo", type=Path, help="stage: the place repo checkout (inhalte/, aktionen/)")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--steps", default=None, help="build: comma list (default: all)")
    ap.add_argument("--expect-pipeline", default=None, help="fail unless the pipeline version equals this")
    a = ap.parse_args(argv)
    try:
        if a.expect_pipeline and a.expect_pipeline.removeprefix("v") != PIPELINE_VERSION:
            sys.exit(f"pipeline version {PIPELINE_VERSION} ≠ expected {a.expect_pipeline} (workflow pin and "
                     "pipeline_ref disagree)")
        if a.cmd == "validate":
            o = load_ort(a.ort)
            print(f"ok: {o.key} ({o.name_de}, {o.ags}), candidates {o.relict_candidates}")
            return
        if a.cmd in ("plan", "build", "check") and a.work is None:
            sys.exit("--work is required")
        if a.cmd in ("plan", "build"):
            if a.app_data is None:
                sys.exit("--app-data is required")
            plan = make_plan(a.ort, a.catalog, a.app_data.resolve(), a.work.resolve())
            for w in plan.warnings:
                print(f"::warning::{w}")
            if a.cmd == "plan":
                write_outputs(plan.outputs(git_ref()))
                return
            rep = run_build(plan, a.workers, a.steps.split(",") if a.steps else None)
            for s in rep["steps"]:
                if s["status"].startswith("skipped"):
                    print(f"::warning::optional step {s['step']} failed (service outage?): the site ships without it")
            print(json.dumps({k: v for k, v in rep.items() if k != "steps"}))
            if rep["result"] != "ok":
                sys.exit(1)
            return
        ort = load_ort(a.ort)
        if a.site is None:
            sys.exit("--site is required")
        if a.cmd == "stage":
            print(json.dumps(stage_site(ort, a.site, a.repo or a.ort.parent)))
            return
        plan = make_plan(a.ort, a.catalog, a.site.parent.resolve(), a.work.resolve())
        errors, warnings = check_site(a.site, ort, plan.owned, plan.areas)
        for w in warnings:
            print(f"::warning::{w}")
        for e in errors:
            print(f"::error::{e}")
        if errors:
            sys.exit(1)
        print("check ok")
    except OrtError as e:
        for p in e.problems:
            print(f"::error::ort.toml: {p}")
        sys.exit(1)


if __name__ == "__main__":
    main()
