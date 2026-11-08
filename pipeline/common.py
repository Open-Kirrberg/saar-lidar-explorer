"""Shared helpers: paths, AOI config, tile naming, HTTP with retries."""
from __future__ import annotations

import json
import math
import os
import ssl
import sys
import time
import tomllib
import urllib.error
import urllib.request
from dataclasses import dataclass
from collections.abc import Iterable, Mapping
import shutil
from pathlib import Path
from typing import Any

import certifi

PIPELINE_DIR = Path(__file__).resolve().parent
ROOT = PIPELINE_DIR.parent


def _dir_env(name: str, default: Path) -> Path:
    """A directory from the environment (absolute path), else `default`. S3 place builds (`place.py`, GitHub Actions
    and the local dry run) point raw caches, work files and the output somewhere else without touching the checkout."""
    v = os.environ.get(name, "").strip()
    if not v:
        return default
    p = Path(v)
    if not p.is_absolute():
        sys.exit(f"{name} must be an absolute path, got {v!r}")
    return p


RAW_DIR = _dir_env("SLE_RAW_DIR", ROOT / "data" / "raw")
SL_RAW = RAW_DIR / "lvgl-sl"
RLP_RAW = RAW_DIR / "rlp"
WORK_DIR = _dir_env("SLE_WORK_DIR", ROOT / "data" / "work")
APP_DATA = _dir_env("SLE_APP_DATA", ROOT / "app" / "public" / "data")
PREVIEW_DIR = _dir_env("SLE_PREVIEW_DIR", ROOT / "docs" / "previews")
# Extra AOI tables merged over aois.toml (absolute path of a TOML file; `place.py` writes one per ort.toml build).
AOIS_EXTRA_ENV = "SLE_AOIS_EXTRA"

# Pipeline version written to `build.pipeline` of v3 manifests (the catalog CI compares neighbours). Bump it when
# a change alters published bytes of a v3 place (encoders, relief parameters, fill rules).
PIPELINE_VERSION = "0.9.1"

SSL_CTX = ssl.create_default_context(cafile=certifi.where())


def user_agent(context: str | None = None) -> str:
    """Descriptive User-Agent (R8): pipeline name + version, the public project URL, the download policy, and an
    optional build context from `SLE_UA_CONTEXT` (e.g. "ci Open-Kirrberg/ort-homburg"). No personal data: the context
    is restricted to a repository-like token set, anything else is dropped."""
    import re
    ctx = os.environ.get("SLE_UA_CONTEXT", "") if context is None else context
    ctx = ctx.strip()
    if ctx and not re.fullmatch(r"[A-Za-z0-9 ._:/-]{1,80}", ctx):
        ctx = ""
    return (f"saar-lidar-explorer-pipeline/{PIPELINE_VERSION} (+https://github.com/Open-Kirrberg/saar-lidar-explorer; "
            f"open-data relief maps; polite sequential downloads{'; ' + ctx if ctx else ''})")


USER_AGENT = user_agent()

# proj4 string from docs/data-contract.md (identical to EPSG:25832 for our purposes)
UTM32_PROJ4 = "+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs"

ATTRIBUTION_SL = "© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet"
# LVermGeoRP asks for the year of retrieval („Jahr des Datenbezugs“, ADR 0026): 2026, not the tile year.
ATTRIBUTION_RLP = "© GeoBasis-DE/LVermGeoRP (2026), dl-de/by-2-0, www.lvermgeo.rlp.de, Daten bearbeitet"
# Superseded attribution entries → their replacement. `merge_attribution` rewrites them in place, so old
# manifests heal on any step's next write (or via `./run.sh <aoi> attribution`, which touches nothing else).
LEGACY_ATTRIBUTION = {
    "© GeoBasis-DE/LVermGeoRP (2022), dl-de/by-2-0, www.lvermgeo.rlp.de, Daten bearbeitet": ATTRIBUTION_RLP,
}


@dataclass(frozen=True)
class AOI:
    key: str
    name: str
    e0: int
    n0: int
    e1: int
    n1: int
    buffer_m: int
    county: str
    chunk_size: int
    # v3 places (contract "Many places (v3, S2)"); None/2 for the v1/v2 rectangle AOIs
    fmt: int = 2
    place: str | None = None                       # catalog place id (= manifest `aoi` and `place.id`)
    ags: str | None = None
    owned: frozenset[tuple[int, int]] | None = None  # published (present) 1 km tiles, ⊆ the catalog's owned tiles
    out: str | None = None                          # output dir below app/public/data (default: key)
    relict_candidates: bool = True                  # ADR 0053: v3 places publish candidates only on opt-in
    cache_from: str | None = None                   # aois.toml `cache_from`: a rectangle AOI whose raw download
                                                    # caches cover this one (reuse them instead of fetching again)

    def cache_aoi(self) -> "AOI | None":
        """The covering rectangle AOI named by `cache_from` (None if unset). Its raw caches (OSM, ortho, WMS,
        WFS answers) may be read for this AOI; chunk-indexed caches are relative to *its* origin."""
        if not self.cache_from:
            return None
        c = load_aoi(self.cache_from, step="build")
        b = self.buffered
        if not (c.e0 - c.buffer_m <= b[0] and c.n0 - c.buffer_m <= b[1] and b[2] <= c.e1 + c.buffer_m
                and b[3] <= c.n1 + c.buffer_m):
            sys.exit(f"AOI {self.key}: cache_from {self.cache_from!r} does not cover it")
        return c

    @property
    def data_dir(self) -> Path:
        """app/public/data/<out or key>/ — where the app-facing files of this AOI go."""
        return APP_DATA / (self.out or self.key)

    @property
    def is_place(self) -> bool:
        return self.owned is not None

    def present(self, e_km: int, n_km: int) -> bool:
        """True when the tile is published by this AOI (always True for rectangle AOIs inside the rectangle)."""
        if self.owned is not None:
            return (e_km, n_km) in self.owned
        return self.e0 <= e_km * 1000 < self.e1 and self.n0 <= n_km * 1000 < self.n1

    def chunk_present(self, i: int, j: int) -> bool:
        """Level-0 chunk (i, j) of the rectangle is published (presence rule 2)."""
        e = self.e0 + i * self.chunk_size
        n = self.n1 - (j + 1) * self.chunk_size
        return self.present(e // 1000, n // 1000)

    @property
    def width(self) -> int:
        return self.e1 - self.e0

    @property
    def height(self) -> int:
        return self.n1 - self.n0

    @property
    def buffered(self) -> tuple[int, int, int, int]:
        b = self.buffer_m
        return self.e0 - b, self.n0 - b, self.e1 + b, self.n1 + b

    def tiles(self, buffered: bool = True) -> list[tuple[int, int]]:
        """1 km tiles (E_km, N_km, lower-left corner) touching the (buffered) AOI. v3 place: the owned tiles,
        buffered = owned tiles + all their 8-neighbours (the relief buffer fetch set)."""
        if self.owned is not None:
            from grid import neighbours8
            ts = neighbours8(self.owned) if buffered else set(self.owned)
            return sorted(ts, key=lambda t: (t[1], t[0]))
        e0, n0, e1, n1 = self.buffered if buffered else (self.e0, self.n0, self.e1, self.n1)
        return [
            (e, n)
            for n in range(math.floor(n0 / 1000), math.ceil(n1 / 1000))
            for e in range(math.floor(e0 / 1000), math.ceil(e1 / 1000))
        ]


# --- stats-only AOIs (aois.toml `stats_only = true`, e.g. [orte]) ---------------------------------------------
# A stats-only AOI is a statistics area: no 3D tiles are built or published for it. The steps below write tiles,
# layers or manifests under app/public/data/<aoi>/ (or fetch the inputs for them) and are refused for it, both by
# run.sh (`plan_steps`) and by `load_aoi` when one of these scripts is the entry point.
TILE_STEPS = ("fetch", "build", "xyz", "osm", "cadastre", "buildings", "ortho", "historic", "detect", "pointcloud",
              "trees", "forest")
# script stem → run.sh step name
TILE_STEP_SCRIPTS = {**{s: s for s in TILE_STEPS if s != "forest"}, "historic_forest": "forest"}
# `./run.sh <stats-only aoi>` without steps: place outlines, stats-area trees + inputs, then the place statistics,
# written into the output AOI (aois.toml `stats_output`, default STATS_OUTPUT_AOI).
STATS_ONLY_DEFAULT_STEPS = ("places", "stats-trees", "stats-inputs", "stats")
STATS_OUTPUT_AOI = "overall"
DEFAULT_STEPS = ("fetch", "build", "xyz", "osm", "cadastre", "buildings", "ortho", "historic", "pois", "detect",
                 "pointcloud", "trees", "test")


def load_aois(path: Path = PIPELINE_DIR / "aois.toml") -> dict[str, Any]:
    """aois.toml plus the tables of `$SLE_AOIS_EXTRA` (if set): an extra table replaces a same-named one entirely
    (S3: `place.py` writes the AOI of an ort.toml build there instead of editing aois.toml)."""
    cfg = tomllib.loads(path.read_text())
    extra = os.environ.get(AOIS_EXTRA_ENV, "").strip()
    if extra:
        for k, v in tomllib.loads(Path(extra).read_text()).items():
            if k == "defaults":
                sys.exit(f"{extra}: an extra AOI file must not redefine [defaults]")
            cfg[k] = v
    return cfg


def aoi_config(key: str, path: Path = PIPELINE_DIR / "aois.toml") -> dict[str, Any]:
    """Raw aois.toml entry of `key` merged over [defaults]; exits with the known names when `key` is unknown."""
    cfg = load_aois(path)
    if key not in cfg or key == "defaults":
        names = [k for k in cfg if k != "defaults"]
        sys.exit(f"unknown AOI {key!r}; known: {', '.join(names)}")
    return {**cfg.get("defaults", {}), **cfg[key]}


def stats_only_message(key: str, step: str) -> str:
    return (f"AOI {key!r} is stats_only (aois.toml): a statistics area, no 3D tiles are built for it, so step "
            f"{step!r} is refused. Tile steps ({' '.join(TILE_STEPS)}) need a tile AOI such as 'overall'. "
            f"For the statistics run './run.sh {key}' (= {' '.join(STATS_ONLY_DEFAULT_STEPS)}).")


def entry_step(argv0: str | None = None) -> str | None:
    """run.sh step name of the running entry script (`fetch.py` → 'fetch'), None for anything else."""
    a = sys.argv[0] if argv0 is None else argv0
    return TILE_STEP_SCRIPTS.get(Path(a).stem) if a else None


def plan_steps(key: str, steps: Iterable[str] = (), path: Path = PIPELINE_DIR / "aois.toml"
               ) -> list[tuple[str, str]]:
    """run.sh step plan: [(step, AOI the step runs for)]. Empty `steps` → the default chain (stats-only AOIs:
    STATS_ONLY_DEFAULT_STEPS). Exits with `stats_only_message` when a tile step is asked for a stats-only AOI,
    before any step runs. For a stats-only AOI the `stats` step writes into its output AOI (`stats_output`,
    default 'overall')."""
    a = aoi_config(key, path)
    steps = list(steps)
    if a.get("group"):   # e.g. [fixture-v3]: run the tile steps for every member AOI, then the group's own steps
        own = list(a.get("after", []))
        member_steps = [s for s in steps if s not in own] if steps else \
            [s for s in DEFAULT_STEPS if s not in ("pois", "test")]
        plan = [p for m in a["group"] for p in plan_steps(str(m), member_steps, path)] if member_steps else []
        plan += [(s, key) for s in own if not steps or s in steps]
        if not steps:
            plan.append(("test", key))
        return plan
    stats_only = bool(a.get("stats_only", False))
    if not steps:
        steps = list(a.get("stats_steps", STATS_ONLY_DEFAULT_STEPS) if stats_only else DEFAULT_STEPS)
    if stats_only:
        bad = [s for s in steps if s in TILE_STEPS]
        if bad:
            sys.exit(stats_only_message(key, bad[0]))
        out = str(a.get("stats_output", STATS_OUTPUT_AOI))
        return [(s, out if s == "stats" else key) for s in steps]
    return [(s, key) for s in steps]


def load_aoi(key: str, path: Path = PIPELINE_DIR / "aois.toml", *, step: str | None = None) -> AOI:
    """AOI config of `key`. A stats-only AOI (`stats_only = true`) is refused for tile steps: `step` names the
    calling step (run.sh name); when omitted it is derived from the entry script (`build.py` → 'build'), so every
    tile script refuses it without a check of its own. Stats scripts (places, stats_*) are no tile steps."""
    a = aoi_config(key, path)
    step = step or entry_step()
    if a.get("stats_only") and step in TILE_STEPS:
        sys.exit(stats_only_message(key, step))
    if a.get("place"):
        return _load_place(key, a)
    e0, n0, e1, n1 = (int(v) for v in a["bbox"])
    aoi = AOI(key, a["name"], e0, n0, e1, n1, int(a["buffer_m"]), a["county"], int(a["chunk_size"]))
    if aoi.width % aoi.chunk_size or aoi.height % aoi.chunk_size:
        sys.exit(f"AOI {key}: size {aoi.width}x{aoi.height} is not a multiple of chunk_size {aoi.chunk_size}")
    if aoi.buffer_m < 100:
        sys.exit(f"AOI {key}: buffer_m must be >= 100")
    return aoi


def _load_place(key: str, a: Mapping[str, Any]) -> AOI:
    """v3 place AOI (aois.toml `place = "<catalog id>"`): the rectangle is the bounding box of the owned tiles
    (catalog ownership, data/work/catalog/tile_owners.json); an optional `tiles = ["E_N", …]` publishes only a
    subset (fixtures, status 'building'). Always manifest version 3, chunk size 500."""
    from catalog import load_owners, owned_tiles, owners_from_catalog
    from grid import parse_tile_id, tiles_bbox, valid_tile
    if a.get("catalog"):   # S3 ort.toml builds: ownership from a published sle-catalog-v1 file (place.py)
        owners, meta = owners_from_catalog(json.loads(Path(str(a["catalog"])).read_text()))
    else:
        owners, meta = load_owners()
    place = str(a["place"])
    if place not in meta.get("places", {}):
        sys.exit(f"AOI {key}: unknown catalog place {place!r}")
    own = owned_tiles(owners, place)
    tiles = {parse_tile_id(t) for t in a["tiles"]} if a.get("tiles") else own
    if not tiles or not tiles <= own or not all(valid_tile(t) for t in tiles):
        sys.exit(f"AOI {key}: tiles must be a non-empty subset of the tiles owned by {place!r}")
    e0, n0, e1, n1 = tiles_bbox(tiles)
    aoi = AOI(key, a.get("name", meta["places"][place]["name_de"]), e0, n0, e1, n1, int(a["buffer_m"]),
              a["county"], 500, fmt=3, place=place, ags=meta["places"][place]["ags"], owned=frozenset(tiles),
              out=a.get("out"), relict_candidates=bool(a.get("relict_candidates", False)),
              cache_from=a.get("cache_from"))
    if not 100 <= aoi.buffer_m <= 1000:
        sys.exit(f"AOI {key}: v3 places need 100 <= buffer_m <= 1000")
    return aoi


def sl_name(product: str, e: int, n: int) -> str:
    """LVGL tile file name, product in {'dgm1','dom1'}."""
    return f"{product}_32_{e}_{n}_1_SL_2025.tif"


def http_open(url: str, *, method: str = "GET", headers: dict | None = None, retries: int = 5, timeout: int = 60):
    """urlopen with a User-Agent and exponential back-off retries on network/5xx errors."""
    hdrs = {"User-Agent": USER_AGENT, **(headers or {})}
    delay = 2.0
    for attempt in range(1, retries + 1):
        try:
            return urllib.request.urlopen(
                urllib.request.Request(url, method=method, headers=hdrs), timeout=timeout, context=SSL_CTX
            )
        except urllib.error.HTTPError as e:
            if e.code < 500 and e.code != 429:
                raise
            err = e
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            err = e
        if attempt == retries:
            raise err
        print(f"  ! {err} – retry {attempt}/{retries - 1} in {delay:.0f}s", file=sys.stderr)
        time.sleep(delay)
        delay *= 2
    raise RuntimeError("unreachable")


def fmt_bytes(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024
    return str(n)


# --- manifest read–modify–write ------------------------------------------------------------------

ATTRIBUTION_SEP = "; "


def merge_attribution(existing: str | None, add: Iterable[str] = (), drop: Iterable[str] = ()) -> str:
    """Merge attribution entries into the manifest's `"; "`-joined attribution string.

    Order is stable: existing entries keep their position, new entries from `add` are appended; duplicates
    (after whitespace stripping) are removed. `drop` lets a step retract entries it owns but no longer
    uses (e.g. build.py drops the RLP string when no RLP pixel was filled); an entry in both `add` and
    `drop` is kept. Superseded entries (`LEGACY_ATTRIBUTION`) are replaced in place. Entries must not contain ";"."""
    add = [a.strip() for a in add]
    dropped = {d.strip() for d in drop} - set(add)  # an entry in both keeps its position
    out: list[str] = []
    for part in (existing or "").split(ATTRIBUTION_SEP.strip()):
        part = part.strip()
        part = LEGACY_ATTRIBUTION.get(part, part)
        if part and part not in out and part not in dropped:
            out.append(part)
    for part in add:
        if part and part not in out:
            out.append(part)
    return ATTRIBUTION_SEP.join(out)


def carry_foreign_layers(existing: Mapping[str, Any], patch: Mapping[str, Any],
                         own_layers: Iterable[str]) -> dict[str, Any]:
    """Return a copy of `patch` whose `layers` and `levels[k].layers` also hold the existing entries of keys
    not in `own_layers`. Level entries are matched by `level` (fallback: list position) and only when the
    `cellSize` agrees, so foreign coarse images never attach to a level with a different grid."""
    own = set(own_layers)
    out = dict(patch)

    def foreign(lays: Any) -> dict[str, Any]:
        return {k: v for k, v in lays.items() if k not in own} if isinstance(lays, dict) else {}

    if isinstance(out.get("layers"), dict):
        out["layers"] = {**out["layers"], **{k: v for k, v in foreign(existing.get("layers")).items()
                                             if k not in out["layers"]}}
    old_levels, new_levels = existing.get("levels"), out.get("levels")
    if isinstance(old_levels, list) and isinstance(new_levels, list):
        by_level = {lv.get("level", n): lv for n, lv in enumerate(old_levels) if isinstance(lv, dict)}
        merged = []
        for n, lv in enumerate(new_levels):
            old = by_level.get(lv.get("level", n)) if isinstance(lv, dict) else None
            if old is not None and old.get("cellSize") == lv.get("cellSize") and isinstance(lv.get("layers"), dict):
                extra = {k: v for k, v in foreign(old.get("layers")).items() if k not in lv["layers"]}
                lv = {**lv, "layers": {**lv["layers"], **extra}}
            merged.append(lv)
        out["levels"] = merged
    return out


def merge_manifest(
    existing: Mapping[str, Any] | None,
    patch: Mapping[str, Any],
    *,
    attribution: Iterable[str] = (),
    drop_attribution: Iterable[str] = (),
    remove: Iterable[str] = (),
    merge: Iterable[str] = (),
    own_layers: Iterable[str] | None = None,
) -> dict[str, Any]:
    """Pure merge used by `update_manifest`.

    - top-level keys in `patch` replace the existing value in place (key order kept); new keys are appended
    - keys not in `patch` (owned by other steps: `xyz`, `vectors`, `models`, …) are kept untouched
    - keys in `remove` are deleted (a step retracting output it owns)
    - keys in `merge` are shared sections (e.g. `vectors`, written by osm.py and cadastre.py): their dict
      value is shallow-merged into the existing dict instead of replacing it
    - `attribution` is merged as a set with stable order (see `merge_attribution`); a step should pass its
      entries via `attribution=` rather than an `"attribution"` key in `patch`
    - `own_layers` (build.py): the layer keys the patching step owns. When given, entries of the existing
      `layers` and `levels[k].layers` whose key is *not* owned (foreign: `bldg`, `ortho`, `hist_*`, …) are
      carried into the patched `layers` / `levels[k].layers` (same `level` index and `cellSize`) unless the
      patch already sets them — the per-sub-key merge the data contract requires for `layers`/`levels`"""
    if "attribution" in patch:
        raise ValueError("pass attribution entries via attribution=[...], not in patch")
    if own_layers is not None and existing:
        patch = carry_foreign_layers(existing, patch, own_layers)
    out: dict[str, Any] = dict(existing or {})
    for k in remove:
        out.pop(k, None)
    shared = set(merge)
    for k, v in patch.items():
        old = out.get(k)
        out[k] = {**old, **v} if k in shared and isinstance(old, dict) and isinstance(v, dict) else v
    add, drop = list(attribution), list(drop_attribution)
    if add or drop or "attribution" in out:
        out["attribution"] = merge_attribution(out.get("attribution"), add, drop)
    return out


def update_manifest(
    aoi_dir: Path,
    patch: Mapping[str, Any],
    *,
    attribution: Iterable[str] = (),
    drop_attribution: Iterable[str] = (),
    remove: Iterable[str] = (),
    merge: Iterable[str] = (),
    own_layers: Iterable[str] | None = None,
) -> dict[str, Any]:
    """Read–modify–write `<aoi_dir>/manifest.json` so pipeline steps can run independently.

    Each step patches only the top-level keys it owns (build: version…layers, sources, build; xyz: xyz;
    osm: vectors; …), merges its attribution entries, and leaves every other key alone. The file is
    written atomically (temp file + rename). Returns the written manifest."""
    path = Path(aoi_dir) / "manifest.json"
    existing = json.loads(path.read_text()) if path.exists() else None
    manifest = merge_manifest(existing, patch, attribution=attribution, drop_attribution=drop_attribution,
                              remove=remove, merge=merge, own_layers=own_layers)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    os.replace(tmp, path)
    return manifest


def refresh_attribution(aoi_key: str) -> str:
    """Manifest-only fix: rewrite superseded attribution entries (`LEGACY_ATTRIBUTION`) of one AOI without
    rebuilding or downloading anything. Returns the new attribution string."""
    aoi_dir = APP_DATA / aoi_key
    if not (aoi_dir / "manifest.json").exists():
        sys.exit(f"no manifest for {aoi_key!r} in {aoi_dir}")
    return update_manifest(aoi_dir, {})["attribution"]


def swap_dir(staging: Path, out_dir: Path) -> None:
    """Replace `out_dir` by the completely written `staging` dir (the old output is removed only now, after the
    new one exists, so a crash or an empty run never leaves the manifest pointing at deleted tiles)."""
    old = out_dir.with_name(out_dir.name + ".old")
    if old.exists():
        shutil.rmtree(old)
    if out_dir.exists():
        out_dir.rename(old)
    staging.rename(out_dir)
    if old.exists():
        shutil.rmtree(old)


def _main(argv: list[str]) -> None:
    """`python common.py plan <aoi> [steps…]`: the step plan for run.sh, one `<step> <aoi>` line per step."""
    if len(argv) < 2 or argv[0] != "plan":
        sys.exit("usage: python common.py plan <aoi> [steps…]")
    for s, k in plan_steps(argv[1], argv[2:]):
        print(f"{s} {k}")


if __name__ == "__main__":
    _main(sys.argv[1:])
