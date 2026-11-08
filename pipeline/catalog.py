"""S2 catalog build (contract "Many places (v3, S2)": Tile ownership, Catalog `sle-catalog-v1`).

    uv run python catalog.py ownership               # VG25 outlines → data/work/catalog/tile_owners.json
    uv run python catalog.py build [--out DIR]       # → <DIR>/catalog.json (default app/public/data/orte-katalog)

Ownership rule `largest-share-v1`: for every 1 km tile T of the global grid and every catalog place p (all statuses)
a_p = round(area(T ∩ outline_p)) in integer m² from the **unsimplified** BKG VG25 outline (float64 shapely, Python
`round`). Owner = largest a_p ≥ 1; ties → smaller AGS (8-digit string), then smaller id. Only the catalog computes
this; place builds (aois.toml `place = "<id>"`) read the owned tiles from the work file.

Outlines: the cached VG25 WFS answers in data/raw/vg25/ (written by gemeinden.py, read-only here) dissolved per AGS
by `gemeinden.parse_vg25` (no simplification). Place status, data_url, repo and options come from catalog.toml.
`height_ref_m` comes from the overview (overview.py: floor of the lowest 1 m DTM height over all owned tiles).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import sys
import tomllib
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

from common import APP_DATA, ATTRIBUTION_RLP, ATTRIBUTION_SL, PIPELINE_DIR, RAW_DIR, WORK_DIR
from grid import GRID, TILE_M, Tile, encode_bitmap, tile_id, tiles_bbox, valid_tile

CATALOG_WORK = WORK_DIR / "catalog"
OWNERS_FILE = CATALOG_WORK / "tile_owners.json"
CATALOG_TOML = PIPELINE_DIR / "catalog.toml"
CATALOG_OUT = APP_DATA / "orte-katalog"
VG25_RAW = RAW_DIR / "vg25"
RULE = "largest-share-v1"
ID_RE = r"^[a-z0-9][a-z0-9-]{0,39}$"
STATUSES = ("3d", "building", "stats")


# =================================================================================================== pure
def tile_shares(geom, step: int = TILE_M) -> dict[Tile, int]:
    """Integer m² share of `geom` in every 1 km tile it touches (only shares ≥ 1 are returned). Pure."""
    import numpy as np
    import shapely
    e0, n0, e1, n1 = geom.bounds
    es = range(math.floor(e0 / step), math.ceil(e1 / step))
    ns = range(math.floor(n0 / step), math.ceil(n1 / step))
    tiles = [(e, n) for n in ns for e in es]
    if not tiles:
        return {}
    boxes = shapely.box(np.array([t[0] * step for t in tiles], float), np.array([t[1] * step for t in tiles], float),
                        np.array([(t[0] + 1) * step for t in tiles], float),
                        np.array([(t[1] + 1) * step for t in tiles], float))
    shapely.prepare(geom)
    hit = shapely.intersects(geom, boxes)
    areas = np.zeros(len(tiles))
    areas[hit] = shapely.area(shapely.intersection(geom, boxes[hit]))
    out = {}
    for t, a in zip(tiles, areas.tolist()):
        r = round(a)
        if r >= 1:
            out[t] = r
    return out


def owner_of(shares: Mapping[str, int], ags: Mapping[str, str]) -> str | None:
    """Owner among {place id: integer m²}: largest share ≥ 1, ties → smaller AGS, then smaller id. Pure."""
    cand = [p for p, a in shares.items() if a >= 1]
    if not cand:
        return None
    return min(cand, key=lambda p: (-shares[p], ags[p], p))


def ownership(places: Sequence[Mapping[str, Any]], step: int = TILE_M) -> dict[Tile, dict[str, Any]]:
    """`largest-share-v1` over places [{id, ags, geom}] → {tile: {owner, shares: {id: m²}}}. Pure."""
    acc: dict[Tile, dict[str, int]] = {}
    for p in places:
        for t, a in tile_shares(p["geom"], step).items():
            acc.setdefault(t, {})[p["id"]] = a
    ags = {p["id"]: p["ags"] for p in places}
    out = {}
    for t in sorted(acc):
        o = owner_of(acc[t], ags)
        if o is not None:
            out[t] = {"owner": o, "shares": dict(sorted(acc[t].items()))}
    return out


def owned_tiles(owners: Mapping[Tile, Mapping[str, Any]], place_id: str) -> set[Tile]:
    return {t for t, v in owners.items() if v["owner"] == place_id}


def place_entry(p: Mapping[str, Any], tiles: Iterable[Tile], cfg: Mapping[str, Any]) -> dict[str, Any]:
    """One `CatalogPlace` (contract). `cfg` = its catalog.toml table (status, data_url, repo, maintainers, options)."""
    import re
    tiles = set(tiles)
    if not re.match(ID_RE, p["id"]) or not re.match(r"^\d{8}$", p["ags"]):
        raise ValueError(f"invalid place id/ags {p['id']!r} {p['ags']!r}")
    if not tiles or not all(valid_tile(t) for t in tiles):
        raise ValueError(f"{p['id']}: no tiles or tiles outside the global grid")
    status = cfg.get("status", "stats")
    if status not in STATUSES:
        raise ValueError(f"{p['id']}: unknown status {status!r}")
    bbox = tiles_bbox(tiles)
    w, h = (bbox[2] - bbox[0]) // TILE_M, (bbox[3] - bbox[1]) // TILE_M
    n_top_km = bbox[3] // TILE_M
    e = {"id": p["id"], "name_de": p["name_de"], "ags": p["ags"], "state": "SL" if p["state"] == "SL" else "RP",
         "status": status}
    if cfg.get("repo"):
        e["repo"] = cfg["repo"]
    if status in ("3d", "building"):
        if not cfg.get("data_url"):
            raise ValueError(f"{p['id']}: status {status} needs data_url")
        e["data_url"] = cfg["data_url"]
    if cfg.get("maintainers"):
        e["maintainers"] = list(cfg["maintainers"])
    e["bbox"] = list(bbox)
    e["tiles"] = encode_bitmap(w, h, ((t[0] - bbox[0] // TILE_M, n_top_km - 1 - t[1]) for t in tiles))
    for k in ("manifest_version", "pipeline", "built"):
        if k in cfg:
            e[k] = cfg[k]
    if "relict_candidates" in cfg:
        e["options"] = {"relict_candidates": bool(cfg["relict_candidates"])}
    return e


def build_catalog(places: Sequence[Mapping[str, Any]], owners: Mapping[Tile, Mapping[str, Any]],
                  cfg: Mapping[str, Mapping[str, Any]], *, height_ref_m: int, outlines: str, outline_attribution: str,
                  overview: str | None = None, leaderboard: str | None = None, generated: str | None = None,
                  only_tiles: Iterable[Tile] | None = None) -> dict[str, Any]:
    """`sle-catalog-v1` document. `only_tiles` restricts every place to a tile subset (fixtures); places without
    a tile in it are left out. File order = AGS order. Pure."""
    keep = set(only_tiles) if only_tiles is not None else None
    entries = []
    attribution = [ATTRIBUTION_SL, ATTRIBUTION_RLP, outline_attribution]
    for p in sorted(places, key=lambda p: p["ags"]):
        tiles = owned_tiles(owners, p["id"])
        if keep is not None:
            tiles &= keep
        if not tiles:
            continue
        entries.append(place_entry(p, tiles, cfg.get(p["id"], {})))
    doc: dict[str, Any] = {
        "format": "sle-catalog-v1",
        "generated": generated or dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "crs": "EPSG:25832", "grid": GRID, "height_ref_m": int(height_ref_m),
        "ownership": {"rule": RULE, "outlines": outlines, "attribution": outline_attribution},
    }
    if overview:
        doc["overview"] = overview
    if leaderboard:
        doc["leaderboard"] = leaderboard
    doc["attribution"] = "; ".join(attribution)
    doc["places"] = entries
    claimed: dict[str, str] = {}
    for e in entries:   # partition check (a tile claimed twice would be an invalid catalog)
        for t in owned_tiles(owners, e["id"]) & (keep if keep is not None else set(owners)):
            assert claimed.setdefault(tile_id(t), e["id"]) == e["id"]
    return doc


# =================================================================================================== I/O
def load_places() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Catalog candidates from the cached VG25 answers (unsimplified, dissolved per AGS) + edition info."""
    from gemeinden import RLP_NEIGHBOURS, parse_vg25
    feats = []
    for key in ("sl", "rlp"):
        f = VG25_RAW / f"vg25_gem_{key}.json"
        if not f.exists():
            sys.exit(f"{f} missing – run `uv run python gemeinden.py outlines` first")
        feats += json.loads(f.read_text())["features"]
    places = parse_vg25(feats, keep_ags=set(RLP_NEIGHBOURS))
    beginn = sorted({str((x.get("properties") or {}).get("beginn") or "")[:10] for x in feats} - {""})
    fetched = dt.date.fromtimestamp((VG25_RAW / "vg25_gem_sl.json").stat().st_mtime).isoformat()
    meta = {"outlines": f"BKG VG25 vg25_gem (WFS, abgerufen {fetched}, Objektbeginn bis "
                        f"{beginn[-1] if beginn else '?'}), unvereinfacht"}
    return places, meta


def save_owners(owners: Mapping[Tile, Mapping[str, Any]], meta: Mapping[str, Any], path: Path = OWNERS_FILE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = {"rule": RULE, **meta, "tiles": {tile_id(t): v for t, v in owners.items()}}
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    tmp.replace(path)


def load_owners(path: Path = OWNERS_FILE) -> tuple[dict[Tile, dict[str, Any]], dict[str, Any]]:
    if not path.exists():
        sys.exit(f"{path} missing – run `uv run python catalog.py ownership` first")
    d = json.loads(path.read_text())
    owners = {tuple(int(x) for x in k.split("_")): v for k, v in d.pop("tiles").items()}
    return owners, d


def place_tiles(place_id: str, path: Path = OWNERS_FILE) -> set[Tile]:
    """Owned tiles of a catalog place (for aois.toml `place = "<id>"`)."""
    owners, _ = load_owners(path)
    t = owned_tiles(owners, place_id)
    if not t:
        sys.exit(f"catalog place {place_id!r} owns no tile ({path})")
    return t


def load_config(path: Path = CATALOG_TOML) -> dict[str, Any]:
    return tomllib.loads(path.read_text()) if path.exists() else {}


def run_ownership() -> dict[str, Any]:
    places, meta = load_places()
    owners = ownership(places)
    meta = {**meta,
            "places": {p["id"]: {"ags": p["ags"], "name_de": p["name_de"], "state": p["state"]} for p in places}}
    save_owners(owners, meta)
    per = {}
    for v in owners.values():
        per[v["owner"]] = per.get(v["owner"], 0) + 1
    print(f"{len(places)} places, {len(owners)} owned tiles → {OWNERS_FILE}; homburg {per.get('homburg')} tiles")
    return {"places": len(places), "tiles": len(owners), "per_place": per}


def write_catalog(out_dir: Path, *, overview: str | None = None, leaderboard: str | None = None,
                  height_ref_m: int | None = None, only_tiles: Iterable[Tile] | None = None,
                  cfg: Mapping[str, Any] | None = None, places_filter: Iterable[str] | None = None) -> dict[str, Any]:
    """Build and write `<out_dir>/catalog.json`. `height_ref_m` defaults to the overview's value."""
    from gemeinden import ATTRIBUTION_VG25   # the current VG25 credit (gemeinden.py owns it)
    owners, meta = load_owners()
    places = [{"id": k, **v} for k, v in meta["places"].items()]
    if places_filter is not None:
        keep = set(places_filter)
        places = [p for p in places if p["id"] in keep]
    if height_ref_m is None:
        ov = out_dir / (overview or "overview/overview.json")
        if not ov.exists():
            sys.exit(f"height_ref_m: no overview at {ov} (run overview.py first or pass --height-ref)")
        height_ref_m = math.floor(json.loads(ov.read_text())["heightRange"]["min"])
    cfg = load_config().get("places", {}) if cfg is None else cfg
    doc = build_catalog(places, owners, cfg, height_ref_m=height_ref_m, outlines=meta["outlines"],
                        outline_attribution=ATTRIBUTION_VG25, overview=overview, leaderboard=leaderboard,
                        only_tiles=only_tiles)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "catalog.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    return doc


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["ownership", "build"])
    ap.add_argument("--out", type=Path, default=CATALOG_OUT)
    ap.add_argument("--height-ref", type=int)
    ap.add_argument("--overview", default="overview/overview.json")
    ap.add_argument("--leaderboard", default=None, help="URL of the stats-only manifest, relative to the catalog")
    a = ap.parse_args(argv)
    if a.cmd == "ownership":
        run_ownership()
        return
    lb = a.leaderboard
    if lb is None and (APP_DATA / "saarland" / "manifest.json").exists() and a.out.parent == APP_DATA:
        lb = "../saarland/manifest.json"   # local dev: the S1 stats-only manifest next to the catalog folder
    doc = write_catalog(a.out, overview=a.overview, leaderboard=lb, height_ref_m=a.height_ref)
    n = {s: sum(1 for p in doc["places"] if p["status"] == s) for s in STATUSES}
    size = (a.out / "catalog.json").stat().st_size
    print(f"catalog: {len(doc['places'])} places {n}, height_ref_m {doc['height_ref_m']}, {size / 1e3:.1f} KB "
          f"→ {a.out / 'catalog.json'}")


if __name__ == "__main__":
    main()
