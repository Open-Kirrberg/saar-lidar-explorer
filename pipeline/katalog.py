"""S3 catalog site for `Open-Kirrberg/orte-katalog` (plan „Orte skalieren“ §4.1, §4.3, §6, §9 S3; ADR 0052, 0055).

The statewide products are too heavy for a GitHub runner (overview: ≈ 2 800 DGM1 tiles ≈ 11 GB raw; leaderboard
trees: DGM1 + DOM1 ≈ 22 GB, ≈ 90 min download) and for actions/cache (10 GB per repo, evicted after 7 days
unused). They are therefore computed centrally by a maintainer with the explorer pipeline and shipped as one
**data bundle** (a release asset of orte-katalog, pinned by SHA-256 in its `daten.toml`). The catalog workflow only
recomputes the tile ownership from the bundled VG25 outlines, builds `catalog.json` from `orte.toml`, and deploys.
Leaderboard numbers are never taken from place repos (R3).

    uv run python katalog.py bundle --out DIR                                   # maintainer, local
    uv run python katalog.py site  --bundle B.tar --sha256 HEX --config orte.toml --out SITE --work DIR
    uv run python katalog.py check --site SITE

Bundle `sle-katalog-bundle-v1` (uncompressed tar, sorted, no links):
    bundle.json                     format, pipeline version, created, file list with sizes and SHA-256
    vg25/vg25_gem_{sl,rlp}.json     cached BKG VG25 WFS answers (CC BY 4.0) – the ownership input
    tile_owners.json                ownership as computed when the overview was built (consistency check)
    overview/                       sle-overview-v1 (overview.json + levels/{k}/dtm/*.webp)
    saarland/                       stats-only manifest + stats/places.{json,geojson} (Gemeinde level)
    ortsteile/                      stats-only manifest + stats/places.{json,geojson} (Ortsteile level, from `overall`)

Site layout (contract "Catalog site (S3)"): catalog.json, overview/, saarland/, ortsteile/, ATTRIBUTION.txt,
index.html, .nojekyll. `catalog.leaderboard` = "saarland/manifest.json"; `stats_levels` name `saarland` and
`ortsteile`, which resolve as sibling directories of the leaderboard (app: `levelBaseUrl`).
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
import json
import math
import os
import shutil
import sys
import tarfile
import tomllib
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from common import APP_DATA, PIPELINE_VERSION, RAW_DIR, WORK_DIR

BUNDLE_FORMAT = "sle-katalog-bundle-v1"
STATS_LEVELS = {"format": "sle-stats-levels-v1", "levels": [
    {"level": "gemeinde", "aoi": "saarland", "label_de": "Gemeinden"},
    {"level": "ortsteil", "aoi": "ortsteile", "label_de": "Ortsteile"}]}
STATS_FILES = ("stats/places.json", "stats/places.geojson")
MAX_FILE_BYTES = 100 * 1000 * 1000
MAX_SITE_BYTES = 1000 * 1000 * 1000
UXO_TERMS = ("crater", "bombentrichter", "trichterfeld")


# ============================================================================================ pure
def ortsteile_manifest(overall: Mapping[str, Any], places_attribution: str | None) -> dict[str, Any]:
    """Stats-only manifest of the Ortsteile level from `overall`'s `stats` key (contract „Gemeinde level“: a level AOI
    may be a stats-only manifest; only `stats` is read). Pure."""
    st = overall.get("stats")
    if not isinstance(st, dict) or st.get("format") != "sle-stats-v1":
        raise ValueError("overall manifest has no sle-stats-v1 `stats` key")
    return {"version": 1, "kind": "stats-only", "aoi": "ortsteile", "name": "Ortsteile im Vergleich",
            "crs": "EPSG:25832", "stats": dict(st), "stats_levels": STATS_LEVELS,
            "attribution": places_attribution or overall.get("attribution", "")}


def with_levels(manifest: Mapping[str, Any]) -> dict[str, Any]:
    """The Gemeinde-level stats-only manifest with `stats_levels` pointing at this site's level dirs. Pure."""
    if manifest.get("kind") != "stats-only":
        raise ValueError("leaderboard manifest is not kind 'stats-only'")
    out = dict(manifest)
    out["stats_levels"] = STATS_LEVELS
    return out


def place_config(doc: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    """`orte.toml` → the per-place table of `catalog.build_catalog` (status, data_url, repo, maintainers,
    relict_candidates). Validates hosting: '3d'/'building' need an https data_url ending in '/'. Pure."""
    import re
    places = doc.get("places", {})
    if not isinstance(places, dict):
        raise ValueError("orte.toml: [places.<id>] tables expected")
    out = {}
    for pid, cfg in places.items():
        extra = set(cfg) - {"status", "data_url", "repo", "maintainers", "relict_candidates"}
        if extra:
            raise ValueError(f"orte.toml places.{pid}: unknown keys {sorted(extra)}")
        st = cfg.get("status", "stats")
        if st not in ("3d", "building", "stats"):
            raise ValueError(f"orte.toml places.{pid}: unknown status {st!r}")
        url = cfg.get("data_url")
        if st in ("3d", "building") and not (isinstance(url, str) and url.startswith("https://") and url.endswith("/")):
            raise ValueError(f"orte.toml places.{pid}: status {st} needs an https data_url ending in '/'")
        if st == "stats" and url:
            raise ValueError(f"orte.toml places.{pid}: a 'stats' place has no data_url")
        for h in cfg.get("maintainers", []):
            if not re.match(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$", str(h)):
                raise ValueError(f"orte.toml places.{pid}: maintainer {h!r} is not a GitHub handle")
        out[pid] = dict(cfg)
    return out


def same_ownership(a: Mapping[Any, Mapping[str, Any]], b: Mapping[Any, Mapping[str, Any]]) -> list[str]:
    """Tiles whose owner differs between two ownership maps (ids as 'E_N'). Pure."""
    def norm(d):
        return {(k if isinstance(k, str) else f"{k[0]}_{k[1]}"): v["owner"] for k, v in d.items()}
    x, y = norm(a), norm(b)
    return sorted(t for t in set(x) | set(y) if x.get(t) != y.get(t))


def safe_member(name: str) -> bool:
    p = Path(name)
    return not p.is_absolute() and ".." not in p.parts and name.strip() != ""


# ============================================================================================ I/O
def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def write_json(p: Path, obj: Any, indent: int | None = 1) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=indent) + "\n")


def run_bundle(out: Path, name: str | None = None) -> Path:
    """Pack the locally built statewide products into one tar (maintainer step, after `./run.sh saarland`,
    `./run.sh orte` and `./run.sh orte-katalog`)."""
    from stats import check_outline_privacy, check_privacy
    stage = out / "bundle"
    shutil.rmtree(stage, ignore_errors=True)
    src_ov = APP_DATA / "orte-katalog" / "overview"
    if not (src_ov / "overview.json").exists():
        sys.exit(f"{src_ov}/overview.json missing – run ./run.sh orte-katalog first")
    shutil.copytree(src_ov, stage / "overview")
    for f in ("vg25_gem_sl.json", "vg25_gem_rlp.json"):
        (stage / "vg25").mkdir(parents=True, exist_ok=True)
        shutil.copy2(RAW_DIR / "vg25" / f, stage / "vg25" / f)   # keep mtime: it dates the outline edition
    shutil.copy2(WORK_DIR / "catalog" / "tile_owners.json", stage / "tile_owners.json")
    sl = json.loads((APP_DATA / "saarland" / "manifest.json").read_text())
    write_json(stage / "saarland" / "manifest.json", with_levels(sl))
    ov = json.loads((APP_DATA / "overall" / "manifest.json").read_text())
    ot_places = json.loads((APP_DATA / "overall" / "stats" / "places.json").read_text())
    write_json(stage / "ortsteile" / "manifest.json", ortsteile_manifest(ov, ot_places.get("attribution")))
    for lvl, src in (("saarland", APP_DATA / "saarland"), ("ortsteile", APP_DATA / "overall")):
        for rel in STATS_FILES:
            d = json.loads((src / rel).read_text())
            check_privacy(d)
            if rel.endswith(".geojson"):
                check_outline_privacy(d.get("features", []))
            (stage / lvl / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src / rel, stage / lvl / rel)
    files = sorted(p for p in stage.rglob("*") if p.is_file())
    for p in files:
        if p.suffix in (".json", ".geojson") and any(t in p.read_text(encoding="utf-8").lower() for t in UXO_TERMS):
            sys.exit(f"{p}: contains a UXO term (ADR 0010)")
    meta = {"format": BUNDLE_FORMAT, "pipeline": PIPELINE_VERSION,
            "created": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
            "files": [{"path": p.relative_to(stage).as_posix(), "bytes": p.stat().st_size, "sha256": sha256_file(p)}
                      for p in files]}
    write_json(stage / "bundle.json", meta)
    name = name or f"sle-katalog-daten-{dt.date.today().isoformat()}.tar"
    tar_path = out / name
    with tarfile.open(tar_path, "w", format=tarfile.PAX_FORMAT) as tf:
        for p in sorted(stage.rglob("*")):
            if not p.is_file():
                continue
            ti = tf.gettarinfo(str(p), arcname=p.relative_to(stage).as_posix())
            ti.uid = ti.gid = 0
            ti.uname = ti.gname = ""
            with open(p, "rb") as f:
                tf.addfile(ti, f)
    digest = sha256_file(tar_path)
    (out / (name + ".sha256")).write_text(f"{digest}  {name}\n")
    print(f"bundle {tar_path}: {tar_path.stat().st_size / 1e6:.1f} MB, {len(files)} files, sha256 {digest}")
    return tar_path


def extract_bundle(tar_path: Path, dest: Path, sha256: str | None) -> dict[str, Any]:
    """Verify the pinned SHA-256, extract regular files only (no links, no absolute or '..' paths), verify every file
    against bundle.json."""
    if sha256:
        got = sha256_file(tar_path)
        if got != sha256.lower():
            sys.exit(f"bundle sha256 {got} ≠ pinned {sha256} (daten.toml)")
    shutil.rmtree(dest, ignore_errors=True)
    dest.mkdir(parents=True)
    with tarfile.open(tar_path, "r:") as tf:
        for m in tf.getmembers():
            if not m.isfile() or not safe_member(m.name):
                sys.exit(f"bundle member {m.name!r} rejected (only regular files with relative paths)")
            out = dest / m.name
            out.parent.mkdir(parents=True, exist_ok=True)
            with tf.extractfile(m) as src, open(out, "wb") as f:
                shutil.copyfileobj(src, f)
            os.utime(out, (m.mtime, m.mtime))
    meta = json.loads((dest / "bundle.json").read_text())
    if meta.get("format") != BUNDLE_FORMAT:
        sys.exit(f"bundle format {meta.get('format')!r} ≠ {BUNDLE_FORMAT}")
    for f in meta["files"]:
        p = dest / f["path"]
        if not p.exists() or p.stat().st_size != f["bytes"] or sha256_file(p) != f["sha256"]:
            sys.exit(f"bundle file {f['path']} does not match bundle.json")
    return meta


def landing_page(doc: Mapping[str, Any]) -> str:
    e = html.escape
    rows = "".join(
        f"<tr><td>{e(p['name_de'])}</td><td>{e(p['status'])}</td><td>"
        + (f"<a href=\"https://github.com/{e(p['repo'])}\">{e(p['repo'])}</a>" if p.get("repo") else "Ortspate gesucht")
        + "</td></tr>" for p in doc["places"])
    attr = "".join(f"<li>{e(a)}</li>" for a in doc["attribution"].split("; ") if a)
    return f"""<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Orte-Katalog – Saar LiDAR Explorer</title>
<style>body{{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1d2a22;background:#f7f7f2}}
a{{color:#1f6f43}}table{{border-collapse:collapse;width:100%}}td{{border-bottom:1px solid #d8dccb;padding:.2rem .4rem}}</style>
</head><body><h1>Orte-Katalog</h1>
<p>Katalog aller Orte des <a href="https://open-kirrberg.github.io/saar-lidar-explorer/">Saar LiDAR Explorers</a>:
welche Gemeinde welche Kacheln zeigt, die grobe Übersicht für das ganze Land und die Rangliste „Orte im Vergleich“.
Die Zahlen werden zentral aus offenen Daten berechnet. <strong>Schauen, nicht graben.</strong></p>
<table><tr><th>Ort</th><th>Status</th><th>Repository</th></tr>{rows}</table>
<h2>Quellen und Lizenzen</h2><ul>{attr}</ul></body></html>
"""


def probe_places(doc: dict[str, Any]) -> list[str]:
    """Copy `manifest_version` / `pipeline` / `built` from each 3d/building place manifest (informative, contract);
    warnings for unreachable or non-v3 places. One small GET per place."""
    from common import http_open
    warnings = []
    versions = {}
    for p in doc["places"]:
        if p["status"] not in ("3d", "building"):
            continue
        url = p["data_url"] + "manifest.json"
        try:
            with http_open(url, retries=2, timeout=30) as r:
                m = json.loads(r.read(5_000_000))
        except Exception as ex:   # noqa: BLE001 - informative only
            warnings.append(f"{p['id']}: {url} not reachable ({ex}); the app treats it as 'stats' until it is")
            continue
        p["manifest_version"] = m.get("version")
        p["pipeline"] = (m.get("build") or {}).get("pipeline")
        if (m.get("build") or {}).get("built"):
            p["built"] = m["build"]["built"]
        if m.get("version") != 3:
            warnings.append(f"{p['id']}: manifest version {m.get('version')} (catalog mode needs 3)")
        versions[p["id"]] = p["pipeline"]
    if len(set(versions.values())) > 1:
        warnings.append(f"places built with different pipeline versions: {versions}")
    return warnings


def run_site(bundle: Path, sha256: str | None, config: Path, out: Path, work: Path, probe: bool) -> dict[str, Any]:
    from catalog import build_catalog, load_places, ownership
    from gemeinden import ATTRIBUTION_VG25
    src = work / "katalog-bundle"
    meta = extract_bundle(bundle, src, sha256)
    places, pmeta = load_places(src / "vg25")
    owners = ownership(places)
    bundled = json.loads((src / "tile_owners.json").read_text())["tiles"]
    diff = same_ownership(owners, bundled)
    if diff:
        sys.exit(f"ownership from the bundled VG25 differs from the bundle's tile_owners.json on {len(diff)} tiles "
                 f"(e.g. {diff[:5]}): rebuild the bundle")
    ov = json.loads((src / "overview" / "overview.json").read_text())
    if ov.get("build", {}).get("ownedTiles") not in (None, len(owners)):
        sys.exit(f"overview was built for {ov['build']['ownedTiles']} owned tiles, ownership has {len(owners)}")
    cfg = place_config(tomllib.loads(config.read_text(encoding="utf-8")))
    unknown = sorted(set(cfg) - {p["id"] for p in places})
    if unknown:
        sys.exit(f"orte.toml names places that are not in VG25: {unknown}")
    doc = build_catalog(places, owners, cfg, height_ref_m=math.floor(ov["heightRange"]["min"]),
                        outlines=pmeta["outlines"], outline_attribution=ATTRIBUTION_VG25,
                        overview="overview/overview.json", leaderboard="saarland/manifest.json")
    warnings = probe_places(doc) if probe else []
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    for d in ("overview", "saarland", "ortsteile"):
        shutil.copytree(src / d, out / d)
    write_json(out / "catalog.json", doc)
    (out / ".nojekyll").write_text("")
    attrs = []
    for part in [doc["attribution"]] + [json.loads((out / d / "manifest.json").read_text()).get("attribution", "")
                                        for d in ("saarland", "ortsteile")]:
        attrs += [a for a in part.split("; ") if a and a not in attrs]
    (out / "ATTRIBUTION.txt").write_text("\n".join(attrs) + "\n")
    (out / "index.html").write_text(landing_page(doc))
    n = {s: sum(1 for p in doc["places"] if p["status"] == s) for s in ("3d", "building", "stats")}
    print(f"catalog: {len(doc['places'])} places {n}, {len(owners)} owned tiles, height_ref_m {doc['height_ref_m']}, "
          f"bundle pipeline {meta['pipeline']} → {out}")
    for w in warnings:
        print(f"::warning::{w}")
    return doc


def run_check(site: Path) -> list[str]:
    from catalog import owners_from_catalog
    from stats import check_outline_privacy, check_privacy
    errors = []
    doc = json.loads((site / "catalog.json").read_text())
    try:
        owners_from_catalog(doc)   # format, grid, bitmaps, partition
    except (ValueError, KeyError) as e:
        errors.append(f"catalog.json: {e}")
    for p in doc.get("places", []):
        if p.get("status") in ("3d", "building") and not str(p.get("data_url", "")).startswith("https://"):
            errors.append(f"{p['id']}: data_url must be https")
        if p.get("status") == "stats" and "data_url" in p:
            errors.append(f"{p['id']}: stats place with data_url")
    for rel in ("overview/overview.json", "saarland/manifest.json", "ortsteile/manifest.json"):
        if not (site / rel).exists():
            errors.append(f"{rel} missing")
    for lvl in ("saarland", "ortsteile"):
        for rel in STATS_FILES:
            try:
                d = json.loads((site / lvl / rel).read_text())
                check_privacy(d)
                if rel.endswith(".geojson"):
                    check_outline_privacy(d.get("features", []))
            except (OSError, ValueError) as e:
                errors.append(f"{lvl}/{rel}: {e}")
    total = 0
    for p in site.rglob("*"):
        if p.is_symlink():
            errors.append(f"{p}: symlink")
        elif p.is_file():
            total += p.stat().st_size
            if p.stat().st_size >= MAX_FILE_BYTES:
                errors.append(f"{p}: ≥ 100 MB")
            if p.suffix in (".json", ".geojson", ".html", ".txt"):
                low = p.read_text(encoding="utf-8", errors="replace").lower()
                errors += [f"{p.relative_to(site)}: UXO term {t!r}" for t in UXO_TERMS if t in low]
                if "/users/" in low or "/home/runner/" in low:
                    errors.append(f"{p.relative_to(site)}: local path")
    if total > MAX_SITE_BYTES:
        errors.append(f"site {total / 1e6:.0f} MB > 1 GB")
    print(f"catalog site {site}: {total / 1e6:.1f} MB")
    return errors


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["bundle", "site", "check"])
    ap.add_argument("--out", type=Path)
    ap.add_argument("--name", default=None, help="bundle: file name (default sle-katalog-daten-<date>.tar)")
    ap.add_argument("--bundle", type=Path)
    ap.add_argument("--sha256", default=None)
    ap.add_argument("--config", type=Path, help="orte.toml of the orte-katalog repo")
    ap.add_argument("--work", type=Path)
    ap.add_argument("--site", type=Path)
    ap.add_argument("--no-probe", action="store_true", help="site: do not GET the place manifests")
    a = ap.parse_args(argv)
    if a.cmd == "bundle":
        run_bundle(a.out or (WORK_DIR / "katalog-release"), a.name)
    elif a.cmd == "site":
        if not (a.bundle and a.config and a.out and a.work):
            sys.exit("site needs --bundle --config --out --work")
        run_site(a.bundle, a.sha256, a.config, a.out, a.work, not a.no_probe)
    else:
        errs = run_check(a.site)
        for e in errs:
            print(f"::error::{e}")
        if errs:
            sys.exit(1)
        print("check ok")


if __name__ == "__main__":
    main()
