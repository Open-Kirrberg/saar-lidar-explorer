"""S1 Saarland leaderboard, tree disciplines (S1b): LiDAR canopy aggregates per Gemeinde, streamed tile by tile.

    uv run python gemeinde_trees.py fetch [--counties SB,NK,SLS,MZG,WND,SPK]   # SL DGM1/DOM1 county ZIPs (cached)
    uv run python gemeinde_trees.py fetch-rlp                                  # RLP DGM1/DOM1 of the RLP neighbours
    uv run python gemeinde_trees.py run [--workers 3] [--limit N]              # per-tile aggregates (resumable)
    uv run python gemeinde_trees.py status                                     # progress → data/work/gemeinden/trees_status.json
    uv run python gemeinde_trees.py all                                        # fetch-rlp + run + status

Why a new module: stats_trees.py writes whole-area rasters (CHM, DTM, state, building mask) and one trees.npz for the
Ortsteile area (≈ 200 km²); for the state (≈ 2,650 km²) that is ≈ 30 GB of rasters and ≈ 4 M trees in memory. Here
every 1 km tile (with a MARGIN apron) is read, detected and reduced to **sums per Gemeinde** right away; only those
sums and the 10 highest measured tops per Gemeinde and tile (for later Riesen checks, never published) are kept in
data/work/gemeinden/tiles/<E_km>_<N_km>.json. A tile file is written atomically when the tile is done, so the run
is resumable: `run` skips tiles that have a file (delete a file to redo a tile).

Method `chm-lmf-watershed-dlrtype-v1` (contract "Gemeinde level"): trees.py detection with the stats_trees rules
(stats_trees.lidar_window mosaic: SL 2025 first, RLP 2022 fill + the constant RLP height offset; tops ≤ 60 m;
measured top beats fill per cell), except the crown **type comes from the DLR Tree Species 2022 map** instead of
the DOP colour (no statewide orthophoto download): each 1 m cell gets a pseudo-brightness DLR_DARK for a conifer
class, DLR_LIGHT for a broadleaf class, NaN otherwise, and trees.classify's thresholds (62 / 74) on the crown mean
then mean: conifer when > 63 % of the crown lies on conifer cells, broadleaf when < 43 %, unknown with any NaN cell.
Conifer crowns get the ADR 0030 fill as before. Building mask: LoD2 footprints (gemeinden.py roofs pass), cell centre
inside, 3 × 3 dilation (buildings.rasterize_mask). Ortslage (`ortslage-bldg-edt-50m-v1`): cells within 50 m of an
undilated building cell. A tree belongs to the Gemeinde whose outline contains its top cell centre.

Downloads (R8): sequential, cached in data/raw/lvgl-sl (shared with fetch.py; pid-suffixed part files so two
processes never write the same file), descriptive User-Agent (common.http_open), waits and retries on outages.
"""
from __future__ import annotations

import argparse
import io
import json
import math
import os
import sys
import time
import urllib.parse
import zipfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np

from common import SL_RAW, WORK_DIR, fmt_bytes, sl_name

GEMEINDE_DIR = WORK_DIR / "gemeinden"
COUNTIES = ("SB", "NK", "SLS", "MZG", "WND", "SPK")   # SPK last: another fetch (Homburg) may run on it
PRODUCTS = ("dgm1", "dom1")


def _tile_of_member(name: str) -> tuple[int, int] | None:
    """'dgm1_32_375_5457_1_SL_2025.tif' → (375, 5457)."""
    parts = Path(name).name.split("_")
    if len(parts) < 4 or not parts[2].isdigit() or not parts[3].isdigit():
        return None
    return int(parts[2]), int(parts[3])


def _extract(zf: zipfile.ZipFile, info: zipfile.ZipInfo, dst: Path) -> None:
    """Extract one member to dst via a pid-suffixed part file (another process may fetch the same cache)."""
    from fetch import valid_tif
    part = dst.with_name(f"{dst.stem}.{os.getpid()}.part")
    for attempt in range(3):
        try:
            with zf.open(info) as src, open(part, "wb") as out:
                while chunk := src.read(4 << 20):
                    out.write(chunk)
            break
        except Exception as e:  # CRC / network errors → retry the member
            print(f"  ! {dst.name}: {e} (attempt {attempt + 1})", file=sys.stderr, flush=True)
            time.sleep(5 * (attempt + 1))
    else:
        part.unlink(missing_ok=True)
        raise IOError(f"failed to extract {dst.name}")
    if not valid_tif(part):
        part.unlink(missing_ok=True)
        raise IOError(f"{dst.name}: extracted file is not a valid GeoTIFF")
    if dst.exists():   # someone else finished it meanwhile
        part.unlink(missing_ok=True)
    else:
        part.rename(dst)


def fetch_counties(counties=COUNTIES, pause_s: float = 0.2) -> dict:
    """All DGM1 + DOM1 members of the LVGL county ZIPs, tile by tile (both products of a tile before the next),
    sequential, cached in SL_RAW. Writes the tile index `sl_tiles.json` (tile → county) as it goes."""
    import fetch
    GEMEINDE_DIR.mkdir(parents=True, exist_ok=True)
    SL_RAW.mkdir(parents=True, exist_ok=True)
    index_f = GEMEINDE_DIR / "sl_tiles.json"
    index = json.loads(index_f.read_text()) if index_f.exists() else {}
    token = fetch.resolve_share_token()
    rep = {}
    for county in counties:
        zfs, members = {}, {}
        for p in PRODUCTS:
            dav = f"{fetch.CLOUD_BASE}/public.php/dav/files/{token}/{fetch.SL_FOLDERS[p]}/"
            zips = [n for n in fetch.dav_list(dav) if n.endswith(".zip") and f"_{county}_" in n]
            if len(zips) != 1:
                raise SystemExit(f"expected one {county} {p} ZIP, found {zips}")
            rf = fetch.HttpRangeFile(dav + urllib.parse.quote(zips[0]))
            zfs[p] = zipfile.ZipFile(io.BufferedReader(rf, buffer_size=4 << 20))
            members[p] = {Path(i.filename).name: i for i in zfs[p].infolist() if i.filename.endswith(".tif")}
            print(f"{county} {p}: {zips[0]} {fmt_bytes(rf.size)}, {len(members[p])} tiles", flush=True)
        tiles = sorted({t for p in PRODUCTS for n in members[p] if (t := _tile_of_member(n))},
                       key=lambda t: (-t[1], t[0]))
        got = cached = 0
        failed: list[str] = []
        t0 = time.time()
        for k, t in enumerate(tiles):
            index.setdefault(f"{t[0]}_{t[1]}", county)
            for p in PRODUCTS:
                name = sl_name(p, *t)
                dst = SL_RAW / name
                if dst.exists():
                    cached += 1
                    continue
                info = members[p].get(name)
                if info is None:
                    print(f"  - {name}: not in the {county} ZIP", flush=True)
                    continue
                for wait in (60, 300, 900, 1800):   # network / DNS outage: wait, then go on with the same tile
                    try:
                        _extract(zfs[p], info, dst)
                        break
                    except (IOError, OSError) as e:
                        print(f"  ! {name}: {e}; waiting {wait}s", file=sys.stderr, flush=True)
                        time.sleep(wait)
                else:
                    failed.append(name)
                    continue
                got += 1
                time.sleep(pause_s)
            if k % 25 == 0 or k == len(tiles) - 1:
                index_f.write_text(json.dumps(index, sort_keys=True))
                el = time.time() - t0
                print(f"  {county} {k + 1}/{len(tiles)} tiles, fetched {got}, cached {cached}, {el:.0f}s",
                      flush=True)
        rep[county] = {"tiles": len(tiles), "fetched": got, "cached": cached, "failed": failed}
    index_f.write_text(json.dumps(index, sort_keys=True))
    return rep


# =================================================================================================== compute (pure)
TILE = 1000
MARGIN = 64                 # m, as stats_trees.MARGIN (≥ trees.APRON + top window + 3 × 3 + Gaussian)
ORTSLAGE_M = 50.0           # m, building distance of the Ortslage
CANOPY_M = 3.0              # m, CHM threshold of a canopy cell
TOP_K = 10                  # highest measured tops kept per Gemeinde and tile (work file only)
DLR_DARK, DLR_LIGHT = 40.0, 100.0
METHOD = "chm-lmf-watershed-dlrtype-v2"   # v2: `trees` counts measured tops only (no conifer fill)
FORMAT = "sle-gemeinde-trees-tile-v1"


def dlr_pseudo_brightness(codes: np.ndarray) -> np.ndarray:
    """DLR contract codes (u8: 0–4 conifer, 5–9 broadleaf, 10 canopy loss, 255 none) → float32 pseudo-brightness
    for trees.classify: conifer DLR_DARK, broadleaf DLR_LIGHT, else NaN. Pure."""
    out = np.full(codes.shape, np.nan, np.float32)
    out[codes <= 4] = DLR_DARK
    out[(codes >= 5) & (codes <= 9)] = DLR_LIGHT
    return out


def tile_aggregates(dtm: np.ndarray, dsm: np.ndarray, state: np.ndarray, bldg: np.ndarray | None,
                    bright: np.ndarray | None, gem: np.ndarray, window: Sequence[int], core: Sequence[int],
                    *, max_height: float = 60.0, top_k: int = TOP_K, chunk: int = 500) -> dict[str, Any]:
    """One window (row 0 = north, 1 m cells; window/core = (e0, n0, e1, n1) on the global grid) → sums per
    Gemeinde index for the core: cells, LiDAR cells (SL / RLP), canopy cells, Ortslage cells and their canopy,
    trees (all / fill / conifer), crown m², biomass kg, and the top_k highest measured tops. Trees come from
    stats_trees.detect_window (trees.py rules), are merged one per cell and height-filtered like
    stats_trees.merge_trees, and are kept when their measured top lies in the core (their fill trees may lie
    outside it). `gem` = u16 municipality index per window cell (0 = none). Pure (no I/O)."""
    from scipy import ndimage
    import stats_trees as ST
    from stats import agb_kg
    from trees import FILL, TYPE_CODES, Params
    p = Params()
    m = core[0] - window[0]
    rs = (window[3] - core[3], window[3] - core[1])
    cs = (m, m + core[2] - core[0])
    ortho = bright[None] if bright is not None else None
    t, chm = ST.detect_window(dsm, dtm, bldg, ortho, rs, cs, p, chunk=chunk)
    a = ST.merge_trees([ST.to_global(t, tuple(window), state)], p.min_height, max_height)
    # window cell of each tree
    row = window[3] - 1 - a.n
    col = a.e - window[0]
    g_of = gem[row, col].astype(np.int64) if a.e.size else np.zeros(0, np.int64)
    fill = (a.type & FILL) > 0
    conifer = (a.type & 0x7F) == TYPE_CODES["conifer"]
    crown = np.pi * a.r ** 2
    agb = agb_kg(a.h, a.r, conifer) if a.e.size else np.zeros(0)
    sl_ = (slice(*rs), slice(*cs))
    gc = gem[sl_].astype(np.int64)
    st = state[sl_]
    can = chm[sl_] >= CANOPY_M
    if bldg is not None:
        raw_b = bldg > 0
        # distance (m) to the nearest building cell; the window apron (64 m) covers the 50 m radius
        dist = ndimage.distance_transform_edt(~raw_b) if raw_b.any() else np.full(raw_b.shape, np.inf)
        orts = (dist <= ORTSLAGE_M)[sl_]
    else:
        orts = np.zeros(gc.shape, bool)
    n = int(max(gc.max(initial=0), g_of.max(initial=0))) + 1

    def bc(mask=None, w=None, idx=gc):
        x = idx if mask is None else idx[mask]
        ww = None if w is None else (w if mask is None else w[mask])
        return np.bincount(x.ravel(), weights=None if ww is None else ww.ravel(), minlength=n)

    cells = bc()
    lid = bc(st != ST.STATE_NONE)
    rlp = bc(st == ST.STATE_RLP)
    canopy = bc(can)
    o_cells = bc(orts)
    o_can = bc(orts & can)
    tr = bc(idx=g_of)
    tr_fill = bc(fill, idx=g_of)
    tr_con = bc(conifer, idx=g_of)
    cr = bc(w=crown, idx=g_of)
    bio = bc(w=agb, idx=g_of)
    out: dict[str, Any] = {}
    for gi in range(1, n):
        if cells[gi] == 0 and tr[gi] == 0:
            continue
        sel = np.nonzero((g_of == gi) & ~fill)[0]
        top = sel[np.lexsort((a.e[sel], -a.h[sel]))][:top_k] if sel.size else sel
        out[str(gi)] = {"cells": int(cells[gi]), "lidar_cells": int(lid[gi]), "rlp_cells": int(rlp[gi]),
                        "canopy_cells": int(canopy[gi]), "ortslage_cells": int(o_cells[gi]),
                        "ortslage_canopy_cells": int(o_can[gi]), "trees": int(tr[gi]), "fill": int(tr_fill[gi]),
                        "conifer": int(tr_con[gi]), "crown_m2": float(cr[gi]), "agb_kg": float(bio[gi]),
                        "top": [[round(float(a.h[k]), 2), int(a.e[k]), int(a.n[k]), round(float(a.r[k]), 1)]
                                for k in top]}
    return out


def merge_tile_sums(tiles: Sequence[Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    """Sum the per-tile Gemeinde records (tile JSON `gemeinden`) → per Gemeinde index totals; `top` keeps the
    TOP_K highest of all tiles. Pure."""
    keys = ("cells", "lidar_cells", "rlp_cells", "canopy_cells", "ortslage_cells", "ortslage_canopy_cells", "trees",
            "fill", "conifer", "crown_m2", "agb_kg")
    out: dict[str, dict[str, Any]] = {}
    for t in tiles:
        for gi, r in (t.get("gemeinden") or {}).items():
            o = out.setdefault(gi, {**{k: 0 for k in keys}, "top": [], "tiles": 0})
            for k in keys:
                o[k] += r.get(k, 0)
            o["top"] = sorted(o["top"] + list(r.get("top", [])), key=lambda x: (-x[0], x[1], x[2]))[:TOP_K]
            o["tiles"] += 1
    return out


def gemeinde_values(s: Mapping[str, Any]) -> dict[str, Any]:
    """Per-Gemeinde S1b values (unrounded) from the summed tile records. Pure."""
    from stats import biomass_range_t, share_pct
    cells = s["cells"]
    agb, co2 = biomass_range_t(s["agb_kg"])
    # Tree count = measured tops only (decision 2026-11-08, ADR 0051): without a statewide orthophoto the crown type
    # comes from the 10 m DLR map, and its conifer fill doubled counts in conifer tiles. Crowns and biomass keep the
    # fill trees (they partition the measured canopy segments), so crown area is unchanged.
    return {"trees": s["trees"] - s.get("fill", 0), "crown_ha": s["crown_m2"] / 1e4,
            "crown_pct": share_pct(s["crown_m2"], cells), "canopy_pct": share_pct(s["canopy_cells"], cells),
            "agb_t": agb, "co2_t": co2,
            "ortslage_area_ha": s["ortslage_cells"] / 1e4,
            "ortslage_canopy_pct": share_pct(s["ortslage_canopy_cells"], s["ortslage_cells"]),
            "lidar_coverage_pct": share_pct(s["lidar_cells"], cells),
            "rlp_pct": share_pct(s["rlp_cells"], s["lidar_cells"]) or 0.0}


# =================================================================================================== compute (I/O)
TILES_DIR = GEMEINDE_DIR / "tiles"


def rlp_offset() -> float:
    f = WORK_DIR / "orte" / "stats_trees_prepare.json"
    try:
        return float(json.loads(f.read_text())["rlp_offset"]["applied"])
    except Exception:
        return 0.0


class Inputs:
    """Per-process lazy state: outlines, DLR 10 m grid, footprint index."""

    def __init__(self):
        import shapely
        import gemeinden as G
        self.gems = G.load_gemeinden()
        for g in self.gems:
            shapely.prepare(g["geom"])
        self.tree = shapely.STRtree([g["geom"] for g in self.gems])
        self.dlr, self.dlr_e0, self.dlr_n1 = G.dlr_grid()
        self.fp_dir = G.FOOTPRINT_DIR
        self.offset = rlp_offset()

    def gem_raster(self, window) -> np.ndarray:
        from rasterio.features import rasterize
        from rasterio.transform import from_origin
        from shapely.geometry import box
        e0, n0, e1, n1 = window
        hits = self.tree.query(box(e0, n0, e1, n1))
        shapes = [(self.gems[i]["geom"], int(self.gems[i]["index"])) for i in hits]
        shape = (n1 - n0, e1 - e0)
        if not shapes:
            return np.zeros(shape, np.uint16)
        return rasterize(shapes, out_shape=shape, transform=from_origin(e0, n1, 1, 1), fill=0, dtype="uint16")

    def dlr_window(self, window) -> np.ndarray:
        e0, n0, e1, n1 = window
        cols = np.floor((np.arange(e0, e1) + 0.5 - self.dlr_e0) / 10).astype(np.int64)
        rows = np.floor((self.dlr_n1 - (np.arange(n1, n0, -1) - 0.5)) / 10).astype(np.int64)
        ok_c = (cols >= 0) & (cols < self.dlr.shape[1])
        ok_r = (rows >= 0) & (rows < self.dlr.shape[0])
        codes = np.full((rows.size, cols.size), 255, np.uint8)
        sub = self.dlr[np.clip(rows, 0, self.dlr.shape[0] - 1)][:, np.clip(cols, 0, self.dlr.shape[1] - 1)]
        codes[np.ix_(ok_r, ok_c)] = sub[np.ix_(ok_r, ok_c)]
        return codes

    def footprints(self, window) -> list:
        import shapely
        e0, n0, e1, n1 = window
        geoms = []
        for e in range(math.floor(e0 / 1000), math.ceil(e1 / 1000)):
            for n in range(math.floor(n0 / 1000), math.ceil(n1 / 1000)):
                f = self.fp_dir / f"sl_LoD2_32_{e}_{n}_1_SL.npy"
                if f.exists():
                    geoms += list(shapely.from_wkb(np.load(f, allow_pickle=True)))
        for e in range(math.floor(e0 / 2000) * 2, math.ceil(e1 / 2000) * 2, 2):
            for n in range(math.floor(n0 / 2000) * 2, math.ceil(n1 / 2000) * 2, 2):
                f = self.fp_dir / f"rlp_LoD2_32_{e}_{n}_2_RP.npy"
                if f.exists():
                    geoms += list(shapely.from_wkb(np.load(f, allow_pickle=True)))
        return geoms


_INPUTS: Inputs | None = None


def process_tile(t: tuple[int, int]) -> dict[str, Any]:
    """Read one tile + apron, aggregate, write tiles/<E>_<N>.json atomically. Returns a short record."""
    global _INPUTS
    import buildings as B
    import stats_trees as ST
    if _INPUTS is None:
        _INPUTS = Inputs()
    inp = _INPUTS
    t0 = time.time()
    core = (t[0] * TILE, t[1] * TILE, (t[0] + 1) * TILE, (t[1] + 1) * TILE)
    window = (core[0] - MARGIN, core[1] - MARGIN, core[2] + MARGIN, core[3] + MARGIN)
    rec: dict[str, Any] = {"format": FORMAT, "tile": f"{t[0]}_{t[1]}", "method": METHOD, "core": core,
                           "margin": MARGIN}
    lw = ST.lidar_window(window, "mosaic", inp.offset)
    if lw is None:
        rec.update({"status": "no-lidar", "gemeinden": {}})
    else:
        dtm, dsm, state = lw
        W, H = window[2] - window[0], window[3] - window[1]
        fps = inp.footprints(window)
        bldg = B.rasterize_mask(fps, window[0], window[3], W, H) if fps else np.zeros((H, W), np.uint8)
        bright = dlr_pseudo_brightness(inp.dlr_window(window))
        gem = inp.gem_raster(window)
        rec.update({"status": "ok", "footprints": len(fps),
                    "gemeinden": tile_aggregates(dtm, dsm, state, bldg, bright, gem, window, core)})
    rec["seconds"] = round(time.time() - t0, 1)
    TILES_DIR.mkdir(parents=True, exist_ok=True)
    f = TILES_DIR / f"{t[0]}_{t[1]}.json"
    tmp = f.with_name(f"{f.stem}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(rec, separators=(",", ":")))
    tmp.replace(f)
    return {"tile": rec["tile"], "status": rec["status"], "s": rec["seconds"]}


def tile_ready(t: tuple[int, int]) -> bool:
    """Inputs of a tile are on disk: SL DGM1+DOM1 (when the tile is in a county ZIP) or an RLP tile."""
    import gemeinden as G
    idx = G.sl_tiles_index()
    k = f"{t[0]}_{t[1]}"
    if k in idx:
        return all((SL_RAW / sl_name(p, *t)).exists() for p in PRODUCTS)
    from common import RLP_RAW
    if any(RLP_RAW.glob(f"dgm1_32_{t[0]}_{t[1]}_1_rp_*.tif")):
        return True
    # in no county ZIP and no RLP tile (e.g. France / Luxembourg along the border): once every county ZIP has been
    # listed, the tile has no LiDAR source and is processed as 'no-lidar' (its cells count as not covered)
    return set(COUNTIES) <= set(idx.values())


def run(workers: int = 3, limit: int | None = None, force: bool = False) -> dict[str, Any]:
    """Process every tile whose LiDAR is cached and that has no tile file yet. Needs the building footprints of the
    statewide LoD2 (gemeinden.py lod2 + roofs, `lod2_complete`), else roofs would count as trees (--force skips the
    check, e.g. for a timing test)."""
    import gemeinden as G
    rf = GEMEINDE_DIR / "roofs_by_gemeinde.json"
    if not force and not (rf.exists() and json.loads(rf.read_text()).get("lod2_complete") is True):
        raise SystemExit("S1b needs the statewide LoD2 footprints first: gemeinden.py lod2 && gemeinden.py roofs")
    tiles = G.all_tiles()
    todo = [t for t in tiles if not (TILES_DIR / f"{t[0]}_{t[1]}.json").exists()]
    ready = [t for t in todo if tile_ready(t)]
    skipped = len(todo) - len(ready)
    if limit:
        ready = ready[:limit]
    print(f"S1b: {len(tiles)} tiles, {len(tiles) - len(todo)} done, {len(ready)} to run now, "
          f"{skipped} waiting for LiDAR", flush=True)
    t0 = time.time()
    done = 0
    with ProcessPoolExecutor(max_workers=max(1, workers)) as ex:
        for r in ex.map(process_tile, ready, chunksize=1):
            done += 1
            if done % 20 == 0 or done == len(ready):
                el = time.time() - t0
                print(f"  {done}/{len(ready)} tiles ({r['tile']} {r['status']} {r['s']}s), {el:.0f}s, "
                      f"≈ {el / done * (len(ready) - done) / 60:.0f} min left", flush=True)
    return status()


def status() -> dict[str, Any]:
    """Sum the tile files per Gemeinde; a Gemeinde is done when all its tiles are. Writes trees_status.json and
    trees_by_gemeinde.json (work files)."""
    import gemeinden as G
    gems = G.load_gemeinden()
    tiles = G.all_tiles()
    have = {}
    for t in tiles:
        f = TILES_DIR / f"{t[0]}_{t[1]}.json"
        if f.exists():
            have[f"{t[0]}_{t[1]}"] = json.loads(f.read_text())
    sums = merge_tile_sums(list(have.values()))
    per = {}
    for g in gems:
        missing = [k for k in g["tiles"] if k not in have]
        s = sums.get(str(g["index"]))
        rec = {"tiles": len(g["tiles"]), "tiles_done": len(g["tiles"]) - len(missing), "done": not missing}
        if s and not missing:
            rec.update({"sums": s, "values": gemeinde_values(s)})
        per[g["id"]] = rec
    out = {"method": METHOD, "tiles_total": len(tiles), "tiles_done": len(have),
           "places_done": sum(1 for v in per.values() if v["done"]), "places": len(per),
           "rlp_offset_m": rlp_offset(), "gemeinden": per}
    G.write_json(GEMEINDE_DIR / "trees_by_gemeinde.json", out)
    print(f"  S1b status: {out['tiles_done']}/{out['tiles_total']} tiles, {out['places_done']}/{out['places']} "
          f"Gemeinden done", flush=True)
    return out


def fetch_rlp_neighbours() -> dict:
    """RLP DGM1/DOM1 1 km tiles of the RLP municipalities (+ 1 tile ring for the apron), via fetch.fetch_rlp."""
    import fetch
    import gemeinden as G
    from stats_trees import TileSet
    rt = G.rlp_tiles()
    grown = tuple(sorted({(e + de, n + dn) for e, n in rt for de in (-1, 0, 1) for dn in (-1, 0, 1)}))
    return fetch.fetch_rlp(TileSet("gemeinden-rlp", "SPK", grown, (0, 0, 0, 0)), list(PRODUCTS))



def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["fetch", "fetch-rlp", "run", "status", "all"])
    ap.add_argument("--counties", default=",".join(COUNTIES))
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--force", action="store_true", help="run without the statewide LoD2 footprints (tests only)")
    a = ap.parse_args()
    if a.cmd == "fetch":
        print(json.dumps(fetch_counties(a.counties.split(",")), indent=1))
    elif a.cmd == "fetch-rlp":
        fetch_rlp_neighbours()
    elif a.cmd == "run":
        run(a.workers, a.limit, a.force)
    elif a.cmd == "status":
        status()
    else:
        fetch_rlp_neighbours()
        run(a.workers, a.limit, a.force)


if __name__ == "__main__":
    main()
