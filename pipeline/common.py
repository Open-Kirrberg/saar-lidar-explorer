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
RAW_DIR = ROOT / "data" / "raw"
SL_RAW = RAW_DIR / "lvgl-sl"
RLP_RAW = RAW_DIR / "rlp"
WORK_DIR = ROOT / "data" / "work"
APP_DATA = ROOT / "app" / "public" / "data"
PREVIEW_DIR = ROOT / "docs" / "previews"

SSL_CTX = ssl.create_default_context(cafile=certifi.where())
USER_AGENT = "saar-lidar-explorer-pipeline/0.1 (personal research; polite sequential downloads)"

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
        """1 km tiles (E_km, N_km, lower-left corner) touching the (buffered) AOI."""
        e0, n0, e1, n1 = self.buffered if buffered else (self.e0, self.n0, self.e1, self.n1)
        return [
            (e, n)
            for n in range(math.floor(n0 / 1000), math.ceil(n1 / 1000))
            for e in range(math.floor(e0 / 1000), math.ceil(e1 / 1000))
        ]


def load_aoi(key: str, path: Path = PIPELINE_DIR / "aois.toml") -> AOI:
    cfg = tomllib.loads(path.read_text())
    defaults = cfg.get("defaults", {})
    if key not in cfg or key == "defaults":
        names = [k for k in cfg if k != "defaults"]
        sys.exit(f"unknown AOI {key!r}; known: {', '.join(names)}")
    a = {**defaults, **cfg[key]}
    e0, n0, e1, n1 = (int(v) for v in a["bbox"])
    aoi = AOI(key, a["name"], e0, n0, e1, n1, int(a["buffer_m"]), a["county"], int(a["chunk_size"]))
    if aoi.width % aoi.chunk_size or aoi.height % aoi.chunk_size:
        sys.exit(f"AOI {key}: size {aoi.width}x{aoi.height} is not a multiple of chunk_size {aoi.chunk_size}")
    if aoi.buffer_m < 100:
        sys.exit(f"AOI {key}: buffer_m must be >= 100")
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
