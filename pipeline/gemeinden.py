"""S1 Saarland leaderboard (plan docs/plans/orte-skalieren.md §6, §9 S1): municipality outlines + cheap disciplines.

    uv run python gemeinden.py outlines          # BKG VG25 Gemeinden (WFS, cached) → checks → work geojson + tiles
    uv run python gemeinden.py zensus            # official Zensus 2022 totals per AGS (Regionaltabelle, cached)
    uv run python gemeinden.py mastr             # MaStR solar units per AGS (paged, cached, sequential)
    uv run python gemeinden.py dlr               # DLR tree species 10 m → forest share + species mix per Gemeinde
    uv run python gemeinden.py gbif              # GBIF facet counts per Gemeinde outline (cached, sequential)
    uv run python gemeinden.py lod2              # LVGL LoD2 county ZIPs + RLP LoD2 tiles (cached, sequential)
    uv run python gemeinden.py roofs             # roof PV potential + per-tile footprints (for gemeinde_trees.py)
    uv run python gemeinden.py s1a               # all of the above except lod2/roofs

Unit = **Gemeinde** (decision D3 of the plan: Gemeinden and Ortsteile are separate tables). Set: the 52 Saarland
municipalities (VG25 `sn_l = '10'`, the German-Luxembourgish condominium on the Moselle, ibz 69, is not a
municipality and is dropped) plus the RLP neighbours in `RLP_NEIGHBOURS` (Zweibrücken and Bechhofen: the two RLP
municipalities that already own places in the Ortsteile board; ADR 0051).

Outline source: BKG *Verwaltungsgebiete 1:25 000* (VG25, Stand 31.12., geometry aligned to the ATKIS Basis-DLM),
WFS https://sgx.geodatenzentrum.de/wfs_vg25, layer vg25_gem, CC BY 4.0 (WFS capabilities `Fees`, checked 2026-11-08; Quellenvermerk below).
Chosen over VG250 (1:250 000, too coarse for a 1 m LiDAR assignment) and over dissolving ALKIS Gemarkungen (the SL
ALKIS WFS answers 503 and the INSPIRE fallback is paged per parcel: hours for the whole state).

Everything is written to data/work/gemeinden/ (work files, never published as such); gemeinden_stats.py publishes the
aggregates. Downloads are untrusted data: read as JSON / raster / XML (hardened parser) only.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import sys
import time
import urllib.parse
from collections import Counter
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np

from common import RAW_DIR, WORK_DIR, http_open

GEMEINDE_DIR = WORK_DIR / "gemeinden"
OUTLINES = GEMEINDE_DIR / "gemeinden.geojson"
VG25_RAW = RAW_DIR / "vg25"
VG25_WFS = "https://sgx.geodatenzentrum.de/wfs_vg25"
VG25_LAYER = "vg25:vg25_gem"
ATTRIBUTION_VG25 = ("© BKG (2026) CC BY 4.0, Datenquellen: "
                    "https://sg.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg25.pdf (VG25)")
SL_PREFIX = "10"
RLP_NEIGHBOURS = {"07320000": "Zweibrücken", "07340203": "Bechhofen"}
NON_MUNICIPALITY_IBZ = {69}          # VG25 ibz 69 = Kondominium (Moselle condominium near Perl): no municipality
SL_COUNT = 52
SL_AREA_KM2 = 2570.0                 # Statistisches Amt Saarland: 2,569.7 km²
CHECK_AREA_TOL = 0.01                # ± 1 % for the state sum
CHECK_HOMBURG = ("10045114", 82.7, 0.6)   # AGS, official km² (Stadt Homburg), tolerance km²
TILE_M = 1000
RLP_OTHER_FLIGHT = 2022


# =================================================================================================== pure
def slugify(name: str) -> str:
    from stats import slugify as s
    return s(name)


def parse_vg25(features: Sequence[Mapping[str, Any]], *, keep_ags: set[str] | None = None,
               sl_prefix: str = SL_PREFIX) -> list[dict[str, Any]]:
    """VG25 vg25_gem features → one record per municipality (AGS), parts with the same AGS dissolved. Saarland
    municipalities (AGS prefix 10) and the AGS in `keep_ags` are kept; the condominium (ibz 69) is dropped. Pure."""
    import shapely
    from shapely.geometry import shape
    parts: dict[str, list] = {}
    props: dict[str, dict] = {}
    for f in features:
        p = f.get("properties") or {}
        ags = str(p.get("ags") or "")
        if len(ags) != 8 or not ags.isdigit() or p.get("ibz") in NON_MUNICIPALITY_IBZ:
            continue
        if not (ags.startswith(sl_prefix) or (keep_ags and ags in keep_ags)):
            continue
        parts.setdefault(ags, []).append(shapely.make_valid(shape(f["geometry"])))
        props.setdefault(ags, p)
    out = []
    for ags in sorted(parts):
        p = props[ags]
        g = shapely.union_all(parts[ags]) if len(parts[ags]) > 1 else parts[ags][0]
        name = str(p.get("gen") or ags)
        state = "SL" if ags.startswith(sl_prefix) else "RLP"
        out.append({"ags": ags, "id": slugify(name), "name_de": name, "bez": str(p.get("bez") or ""),
                    "state": state, "category": "stadt" if "stadt" in str(p.get("bez") or "").lower() else "gemeinde",
                    "geom": g})
    ids = Counter(r["id"] for r in out)
    for r in out:   # name clash (does not happen in SL, but keep ids unique)
        if ids[r["id"]] > 1:
            r["id"] = f"{r['id']}-{r['ags']}"
    return out


def check_outlines(gems: Sequence[Mapping[str, Any]], *, sl_count: int = SL_COUNT, sl_area_km2: float = SL_AREA_KM2,
                   tol: float = CHECK_AREA_TOL, homburg: tuple[str, float, float] | None = CHECK_HOMBURG
                   ) -> dict[str, Any]:
    """Plausibility of the municipality set. Raises ValueError on a failed check; returns the measured values. Pure."""
    import shapely
    sl = [g for g in gems if g["state"] == "SL"]
    errs = []
    if len(sl) != sl_count:
        errs.append(f"{len(sl)} SL municipalities, expected {sl_count}")
    ags = [g["ags"] for g in gems]
    if len(set(ags)) != len(ags) or any(len(a) != 8 or not a.isdigit() for a in ags):
        errs.append("AGS not unique 8-digit keys")
    ids = [g["id"] for g in gems]
    if len(set(ids)) != len(ids):
        errs.append("ids not unique")
    area = sum(g["geom"].area for g in sl) / 1e6
    if abs(area - sl_area_km2) > tol * sl_area_km2:
        errs.append(f"SL area {area:.1f} km², expected ≈ {sl_area_km2}")
    hb = None
    if homburg:
        h = next((g for g in gems if g["ags"] == homburg[0]), None)
        hb = round(h["geom"].area / 1e6, 2) if h else None
        if hb is None or abs(hb - homburg[1]) > homburg[2]:
            errs.append(f"Homburg {hb} km², expected {homburg[1]} ± {homburg[2]}")
    # coverage: neighbours may touch, not overlap (VG25 is a clean coverage)
    geoms = [g["geom"] for g in gems]
    tree = shapely.STRtree(geoms)
    a_idx, b_idx = tree.query(geoms, predicate="intersects")
    overlap = 0.0
    for i, j in zip(a_idx.tolist(), b_idx.tolist()):
        if i < j:
            overlap += geoms[i].intersection(geoms[j]).area
    if overlap > 1000.0:
        errs.append(f"outlines overlap by {overlap:.0f} m²")
    for g in gems:
        if not g["geom"].is_valid or g["geom"].is_empty:
            errs.append(f"{g['name_de']}: invalid or empty outline")
    res = {"sl_municipalities": len(sl), "rlp_municipalities": len(gems) - len(sl), "sl_area_km2": round(area, 2),
           "homburg_km2": hb, "overlap_m2": round(overlap, 1)}
    if errs:
        raise ValueError("; ".join(errs))
    return res


def tiles_of(geom, step: int = TILE_M) -> list[tuple[int, int]]:
    """1 km tiles (lower-left km) whose square intersects the outline's interior. Pure."""
    import shapely
    from shapely.geometry import box
    e0, n0, e1, n1 = geom.bounds
    shapely.prepare(geom)
    out = []
    for n in range(math.floor(n0 / step), math.ceil(n1 / step)):
        for e in range(math.floor(e0 / step), math.ceil(e1 / step)):
            b = box(e * step, n * step, (e + 1) * step, (n + 1) * step)
            if geom.intersects(b) and geom.intersection(b).area > 0:
                out.append((e, n))
    return out


def tile_owners(gems: Sequence[Mapping[str, Any]], step: int = TILE_M) -> dict[str, dict[str, Any]]:
    """Plan §4.2 ownership rule: a 1 km tile belongs to the municipality with the largest area share in it
    (ties → lower AGS). Returns 'E_N' → {owner: id, shares: {id: m²}}. Pure."""
    from shapely.geometry import box
    acc: dict[tuple[int, int], dict[str, float]] = {}
    for g in gems:
        for t in tiles_of(g["geom"], step):
            b = box(t[0] * step, t[1] * step, (t[0] + 1) * step, (t[1] + 1) * step)
            acc.setdefault(t, {})[g["id"]] = g["geom"].intersection(b).area
    ags = {g["id"]: g["ags"] for g in gems}
    out = {}
    for t, sh in sorted(acc.items()):
        owner = sorted(sh, key=lambda i: (-round(sh[i], 3), ags[i]))[0]
        out[f"{t[0]}_{t[1]}"] = {"owner": owner, "shares": {k: round(v) for k, v in sorted(sh.items())}}
    return out


def gem_index(gems: Sequence[Mapping[str, Any]]) -> dict[str, int]:
    """Stable small integer per municipality for id rasters (1-based, by AGS; 0 = none). Pure."""
    return {g["id"]: i + 1 for i, g in enumerate(sorted(gems, key=lambda g: g["ags"]))}


# =================================================================================================== outlines (I/O)
def _wfs_url(cql: str) -> str:
    q = {"service": "WFS", "version": "2.0.0", "request": "GetFeature", "typeNames": VG25_LAYER,
         "srsName": "EPSG:25832", "outputFormat": "application/json", "CQL_FILTER": cql}
    return VG25_WFS + "?" + urllib.parse.urlencode(q)


def fetch_vg25(refresh: bool = False) -> tuple[list[dict], dict]:
    VG25_RAW.mkdir(parents=True, exist_ok=True)
    feats, meta = [], {"wfs": VG25_WFS, "layer": VG25_LAYER, "queries": []}
    rlp_list = ",".join(f"'{a}'" for a in sorted(RLP_NEIGHBOURS))
    for key, cql in (("sl", f"sn_l='{SL_PREFIX}'"), ("rlp", f"ags IN ({rlp_list})")):
        f = VG25_RAW / f"vg25_gem_{key}.json"
        if refresh or not f.exists():
            with http_open(_wfs_url(cql), timeout=180) as r:
                body = r.read()
            d = json.loads(body)
            if d.get("type") != "FeatureCollection":
                raise SystemExit(f"VG25 WFS: unexpected answer for {key}")
            tmp = f.with_suffix(".tmp")
            tmp.write_bytes(body)
            tmp.replace(f)
            time.sleep(1.0)
        d = json.loads(f.read_text())
        feats += d["features"]
        meta["queries"].append({"key": key, "cql": cql, "features": len(d["features"]),
                                "fetched": dt.date.fromtimestamp(f.stat().st_mtime).isoformat()})
    stand = sorted({str((x.get("properties") or {}).get("beginn") or "") for x in feats})
    meta["beginn"] = [s for s in stand if s][-3:]
    return feats, meta


def run_outlines(refresh: bool = False) -> dict[str, Any]:
    from shapely.geometry import mapping
    feats, meta = fetch_vg25(refresh)
    gems = parse_vg25(feats, keep_ags=set(RLP_NEIGHBOURS))
    checks = check_outlines(gems)
    owners = tile_owners(gems)
    idx = gem_index(gems)
    out_feats = []
    for g in gems:
        tiles = tiles_of(g["geom"])
        out_feats.append({"type": "Feature", "properties": {
            "id": g["id"], "ags": g["ags"], "name_de": g["name_de"], "bez": g["bez"], "state": g["state"],
            "category": g["category"], "index": idx[g["id"]], "area_ha": round(g["geom"].area / 1e4, 1),
            "tiles": [f"{e}_{n}" for e, n in tiles]}, "geometry": mapping(g["geom"])})
    meta.update({"generated": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
                 "source": "BKG VG25 vg25_gem (WFS)", "licence": "CC-BY-4.0", "attribution": ATTRIBUTION_VG25,
                 "rlp_neighbours": RLP_NEIGHBOURS, "checks": checks, "tile_owner_rule": "largest area share, "
                 "ties → lower AGS (plan §4.2)", "tiles": len(owners),
                 "bbox": [int(math.floor(min(g["geom"].bounds[0] for g in gems))),
                          int(math.floor(min(g["geom"].bounds[1] for g in gems))),
                          int(math.ceil(max(g["geom"].bounds[2] for g in gems))),
                          int(math.ceil(max(g["geom"].bounds[3] for g in gems)))]})
    GEMEINDE_DIR.mkdir(parents=True, exist_ok=True)
    write_json(OUTLINES, {"type": "FeatureCollection", "meta": meta, "features": out_feats})
    write_json(GEMEINDE_DIR / "tile_owners.json", owners)
    print(f"  {checks['sl_municipalities']} SL + {checks['rlp_municipalities']} RLP municipalities, "
          f"SL {checks['sl_area_km2']} km², Homburg {checks['homburg_km2']} km², {len(owners)} tiles")
    return meta


def load_gemeinden(path: Path = OUTLINES) -> list[dict[str, Any]]:
    from shapely.geometry import shape
    d = json.loads(path.read_text())
    return [{**f["properties"], "geom": shape(f["geometry"])} for f in d["features"]]


def outline_meta(path: Path = OUTLINES) -> dict[str, Any]:
    return json.loads(path.read_text())["meta"]


def write_json(path: Path, obj: Any) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode()
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)
    return len(data)


def update_inputs(key: str, entry: Mapping[str, Any]) -> None:
    f = GEMEINDE_DIR / "inputs.json"
    d = json.loads(f.read_text()) if f.exists() else {}
    d[key] = dict(entry)
    write_json(f, d)


# =================================================================================================== Zensus
def run_zensus() -> dict[str, Any]:
    from stats import fetch_regional_table, official_population, xlsx_rows
    gems = load_gemeinden()
    reg = fetch_regional_table()
    rows = xlsx_rows(reg, "Bevölkerung")
    out = {}
    for g in gems:
        pop, name = official_population(rows, g["ags"])
        out[g["id"]] = {"ags": g["ags"], "inhabitants": pop, "name_in_table": name}
        if pop is None:
            print(f"  ! {g['name_de']} ({g['ags']}): no Zensus total", file=sys.stderr)
    write_json(GEMEINDE_DIR / "zensus.json", {"source": str(reg.name), "date": dt.date.fromtimestamp(
        reg.stat().st_mtime).isoformat(), "gemeinden": out})
    update_inputs("zensus_gemeinden", {"file": "zensus.json",
                                       "retrieved": dt.date.fromtimestamp(reg.stat().st_mtime).isoformat()})
    tot = sum(v["inhabitants"] or 0 for k, v in out.items() if k and v["ags"].startswith(SL_PREFIX))
    print(f"  Zensus 2022: {len(out)} municipalities, Saarland total {tot:,}")
    return out


# =================================================================================================== MaStR
def run_mastr(refresh: bool = False) -> dict[str, Any]:
    import stats_inputs as SI
    gems = load_gemeinden()
    res = {}
    for g in gems:
        t0 = time.time()
        rows, meta = SI.mastr_rows(g["ags"], refresh=refresh)
        agg = SI.aggregate_pv(rows)
        res[g["id"]] = {"ags": g["ags"], "name_de": g["name_de"], "state": g["state"], "fetched": meta["fetched"],
                        "rows": len(rows), "gemeinde_in_data": dict(Counter(r.get("Gemeinde") for r in rows)), **agg}
        op = agg["in_operation"]
        print(f"  {g['name_de']:28s} {len(rows):6d} rows, {op['units']:6d} in operation, {op['kwp']:10.0f} kWp "
              f"[{time.time() - t0:.1f}s]", flush=True)
    export = max(v["fetched"] for v in res.values())
    write_json(GEMEINDE_DIR / "mastr_pv.json", {"format": "sle-orte-mastr-pv-v1", "export_date": export,
                                                "attribution": SI.ATTRIBUTION_MASTR, "municipalities": res})
    update_inputs("mastr", {"file": "mastr_pv.json", "export_date": export})
    return res


# =================================================================================================== DLR species
DLR_GRID = GEMEINDE_DIR / "dlr_10m.tif"


def state_bbox() -> tuple[int, int, int, int]:
    b = outline_meta()["bbox"]
    s = 1000
    return (b[0] // s * s, b[1] // s * s, -(-b[2] // s) * s, -(-b[3] // s) * s)


def dlr_grid() -> tuple[np.ndarray, int, int]:
    """DLR species (contract u8 codes) on the EPSG:25832 10 m grid over the state bbox (cached work raster)."""
    import rasterio
    import species as S
    bbox = state_bbox()
    if DLR_GRID.exists():
        with rasterio.open(DLR_GRID) as ds:
            return ds.read(1), bbox[0], bbox[3]
    S.fetch_dlr(bbox)
    w, h = (bbox[2] - bbox[0]) // S.CELL_M, (bbox[3] - bbox[1]) // S.CELL_M
    v = S.species_grid(bbox[0], bbox[3], w, h, bbox)
    from rasterio.transform import from_origin
    S._write_gtiff(DLR_GRID, v, "EPSG:25832", from_origin(bbox[0], bbox[3], S.CELL_M, S.CELL_M), S.NODATA)
    return v, bbox[0], bbox[3]


def id_raster(gems: Sequence[Mapping[str, Any]], e0: float, n1: float, width: int, height: int,
              cell: float) -> np.ndarray:
    """u8/u16 municipality index raster (gem 'index', 0 = none), cell centre inside the outline."""
    from rasterio.features import rasterize
    from rasterio.transform import from_origin
    shapes = [(g["geom"], int(g["index"])) for g in gems]
    return rasterize(shapes, out_shape=(height, width), transform=from_origin(e0, n1, cell, cell), fill=0,
                     dtype="uint16")


def species_mix_cells(codes: np.ndarray) -> dict[str, Any]:
    """Cell-area species mix of one municipality's 10 m DLR cells (codes u8: 0–9 classes, 10 canopy loss,
    255 none). Shares of the cells with a class; forest = class or canopy loss. Pure."""
    import species as S
    n_all = int(codes.size)
    cnt = np.bincount(codes[codes <= 10].astype(np.int64), minlength=11)
    cls = cnt[:10]
    n_cls = int(cls.sum())
    mix = []
    for c in np.argsort(-cls, kind="stable"):
        if cls[c] == 0:
            continue
        e = {"key": S.CLASS_BY_CODE[int(c)][1], "share_pct": 100.0 * cls[c] / n_cls}
        if S.CLASS_BY_CODE[int(c)][1] in ("alder", "other_broadleaf"):
            e["weak"] = True
        mix.append(e)
    conifer = sum(int(cls[c]) for c in range(10) if S.CLASS_BY_CODE[c][3] == "conifer")
    return {"cells": n_all, "class_cells": n_cls, "loss_cells": int(cnt[10]),
            "forest_pct": 100.0 * (n_cls + cnt[10]) / n_all if n_all else None,
            "canopy_loss_pct": 100.0 * cnt[10] / n_all if n_all else None,
            "conifer_pct": 100.0 * conifer / n_cls if n_cls else None, "mix": mix}


def run_dlr() -> dict[str, Any]:
    import species as S
    gems = load_gemeinden()
    v, e0, n1 = dlr_grid()
    ids = id_raster(gems, e0, n1, v.shape[1], v.shape[0], S.CELL_M)
    out = {}
    for g in gems:
        m = ids == g["index"]
        out[g["id"]] = species_mix_cells(v[m])
        print(f"  {g['name_de']:28s} forest {out[g['id']]['forest_pct']:.1f} %", flush=True)
    write_json(GEMEINDE_DIR / "dlr_by_gemeinde.json", {"method": "dlr-forest-share-v1 / species-dlr-cell-mix-v1",
                                                        "attribution": S.ATTRIBUTION_DLR, "gemeinden": out})
    update_inputs("species_dlr", {"file": "dlr_by_gemeinde.json"})
    return out


# =================================================================================================== GBIF
def run_gbif(refresh: bool = False) -> dict[str, Any]:
    import gbif
    return gbif.run(refresh=refresh, places_path=OUTLINES, out=GEMEINDE_DIR / "gbif_by_gemeinde.json")


# =================================================================================================== LoD2 + roofs
LOD2_COUNTIES = ("SB", "NK", "SLS", "MZG", "WND", "SPK")


def sl_tiles_index() -> dict[str, str]:
    f = GEMEINDE_DIR / "sl_tiles.json"
    return json.loads(f.read_text()) if f.exists() else {}


def all_tiles() -> list[tuple[int, int]]:
    """Union of the 1 km tiles of every municipality outline."""
    s = set()
    for g in load_gemeinden():
        s |= {tuple(int(v) for v in t.split("_")) for t in g["tiles"]}
    return sorted(s, key=lambda t: (-t[1], t[0]))


def rlp_tiles() -> list[tuple[int, int]]:
    s = set()
    for g in load_gemeinden():
        if g["state"] == "RLP":
            s |= {tuple(int(v) for v in t.split("_")) for t in g["tiles"]}
    return sorted(s)


def run_lod2() -> dict[str, Any]:
    """SL LoD2 for every tile of the state (per county ZIP), RLP LoD2 2 km tiles for the RLP neighbours (+1 km)."""
    import buildings as B
    from stats_trees import TileSet
    idx = sl_tiles_index()
    tiles = all_tiles()
    rep = {}
    for county in LOD2_COUNTIES:
        # every county ZIP is asked for every tile not cached yet (border tiles may sit in the neighbour's ZIP);
        # buildings.fetch_sl skips cached tiles and remembers the ones its ZIP lacks (_not_in_zip_<county>.json)
        mine = tuple(sorted(tiles, key=lambda t: (idx.get(f"{t[0]}_{t[1]}") != county, -t[1], t[0])))
        ts = TileSet(f"gemeinden-{county}", county, mine, (0, 0, 0, 0))
        paths = B.fetch_sl(ts)
        rep[county] = len(paths)
    rt = rlp_tiles()
    grown = sorted({(e + de, n + dn) for e, n in rt for de in (-1, 0, 1) for dn in (-1, 0, 1)})
    bb = (min(e for e, _ in grown) * 1000, min(n for _, n in grown) * 1000,
          (max(e for e, _ in grown) + 1) * 1000, (max(n for _, n in grown) + 1) * 1000)
    rep["rlp"] = len(B.fetch_rlp(_BoxAoi("gemeinden-rlp", bb)))
    write_json(GEMEINDE_DIR / "lod2_fetch.json", {"complete": True, "counties": list(LOD2_COUNTIES), "tiles": rep,
                                                   "date": dt.date.today().isoformat()})
    print(f"  LoD2 tiles: {rep}")
    return rep


class _BoxAoi:
    """Minimal AOI stand-in for buildings.fetch_rlp (uses e0, n0, e1, n1, key)."""

    def __init__(self, key: str, bbox: Sequence[int]):
        self.key = key
        self.e0, self.n0, self.e1, self.n1 = bbox
        self.county = "SPK"
        self.buffer_m = 0

    def tiles(self, buffered: bool = True) -> list[tuple[int, int]]:
        return [(e, n) for n in range(self.n0 // 1000, self.n1 // 1000) for e in range(self.e0 // 1000, self.e1 // 1000)]


def lod2_files() -> tuple[list[Path], list[Path]]:
    import buildings as B
    d = B.LOD2_RAW
    sl = sorted((d / "sl").glob("LoD2_32_*_SL.gml.gz"))
    rlp = sorted((d / "rlp").glob("*.gml*"))
    return sl, rlp


FOOTPRINT_DIR = GEMEINDE_DIR / "footprints"


def run_roofs() -> dict[str, Any]:
    """One pass over every cached LoD2 tile of the state: roof planes → per-municipality roof potential
    (roofs.aggregate, roof-pv-potential-v2), footprints → data/work/gemeinden/footprints/<tile>.npy (WKB, for the
    building mask of gemeinde_trees.py). SL buildings count for SL municipalities, RLP ones for RLP (roofs.assign)."""
    import shapely
    import buildings as B
    import roofs as R
    gems = load_gemeinden()
    outlines = {g["id"]: (g["state"], g["geom"]) for g in gems}
    sl_paths, rlp_paths = lod2_files()
    want = {f"{e}_{n}" for e, n in all_tiles()}
    per: dict[str, list] = {g["id"]: [] for g in gems}
    seen: set[str] = set()
    FOOTPRINT_DIR.mkdir(parents=True, exist_ok=True)
    info = {"sl_tiles": 0, "rlp_tiles": 0, "buildings": 0, "duplicates": 0}
    t0 = time.time()
    for paths, src in ((sl_paths, "sl"), (rlp_paths, "rlp")):
        for k, p in enumerate(paths):
            parts = p.name.split("_")
            key = f"{parts[2]}_{parts[3]}"
            if src == "sl" and key not in want:
                continue
            srs = B.gml_srs_names(p)
            if not B.srs_ok(srs):
                print(f"  ! {p.name}: unexpected CRS {srs}, skipped", file=sys.stderr)
                continue
            bl = []
            for b in R.iter_roof_buildings(p, src):
                if b.id and b.id in seen:
                    info["duplicates"] += 1
                    continue
                seen.add(b.id)
                if not math.isnan(b.x):
                    bl.append(b)
            for gid, lst in R.assign(bl, outlines).items():
                per[gid] += lst
            info["buildings"] += len(bl)
            info[f"{src}_tiles"] += 1
            fp_file = FOOTPRINT_DIR / f"{src}_{p.name.split('.')[0]}.npy"
            if not fp_file.exists():
                fb, _ = B.load_buildings([p], src, set())
                geoms = [b.footprint for b in fb if b.footprint is not None]
                np.save(fp_file, np.array(shapely.to_wkb(geoms) if geoms else [], dtype=object), allow_pickle=True)
            if k % 100 == 0:
                print(f"  {src} {k + 1}/{len(paths)} tiles, {info['buildings']} buildings, {time.time() - t0:.0f}s",
                      flush=True)
    res = {gid: R.aggregate(lst) for gid, lst in per.items()}
    lod2 = GEMEINDE_DIR / "lod2_fetch.json"
    complete = lod2.exists() and json.loads(lod2.read_text()).get("complete") is True
    write_json(GEMEINDE_DIR / "roofs_by_gemeinde.json", {"method": R.METHOD, "info": info, "gemeinden": res,
                                                          "tiles_expected": len(want), "lod2_complete": complete})
    update_inputs("roofs", {"file": "roofs_by_gemeinde.json", "sl_tiles": info["sl_tiles"],
                            "rlp_tiles": info["rlp_tiles"]})
    print(f"  roofs: {info}")
    return res


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["outlines", "zensus", "mastr", "dlr", "gbif", "lod2", "roofs", "s1a", "all"])
    ap.add_argument("--refresh", action="store_true")
    a = ap.parse_args(argv)
    steps = {"outlines": lambda: run_outlines(a.refresh), "zensus": run_zensus, "mastr": lambda: run_mastr(a.refresh),
             "dlr": run_dlr, "gbif": lambda: run_gbif(a.refresh), "lod2": run_lod2, "roofs": run_roofs}
    seq = {"s1a": ["outlines", "zensus", "mastr", "dlr", "gbif"],
           "all": ["outlines", "zensus", "mastr", "dlr", "gbif", "lod2", "roofs"]}
    for s in seq.get(a.cmd, [a.cmd]):
        t0 = time.time()
        print(f"=== {s}", flush=True)
        steps[s]()
        print(f"=== {s} done in {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
