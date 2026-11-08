"""F16: classified ALS 2025 point clouds for focus areas → `sle-pts-v1` tiles (contract "Point clouds").

Focus areas are defined once in aois.toml (`[[defaults.pointclouds]]`); a v1/v2 AOI writes every area whose bbox lies
fully inside it, a v3 place every area whose bbox centre lies in one of its present tiles (contract rule 6, so
exactly one place owns an area; its bbox may reach beyond the place's rectangle). Per area:
  1. the 1 km LVGL LAZ tiles `3dm_32_{E}_{N}_1_SL_2025_050.laz` touching the bbox are range-extracted from the
     county ZIP on the LVGL Nextcloud share (like fetch.py does for the DGM) and cached in data/raw/laz/;
  2. read with laspy + lazrs (the LAZ carry no CRS: EPSG:25832, heights DHHN2016), clipped to the half-open bbox,
     `withheld` points dropped;
  3. split into 100 m tiles, each stored as a random permutation (seed crc32("<id>/<tx>_<ty>")) with cm
     quantisation, `agl` = Z − bilinear 1 m work DTM, class code and intensity scaled to the area's p99.5;
  4. manifest key `pointclouds` (owned by this step, replaced on each run) + SL attribution;
     report (density per class, ground vs DTM) → data/work/<aoi>/pointcloud.json.

Usage:  uv run python pointcloud.py <aoi> [--no-fetch]

LAZ downloads are untrusted data: they are only ever parsed by laspy as point data.
"""
from __future__ import annotations

import argparse
import io
import json
import shutil
import struct
import sys
import time
import urllib.parse
import zipfile
import zlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from common import (ATTRIBUTION_SL, RAW_DIR, SL_RAW, WORK_DIR, AOI, fmt_bytes, load_aoi, swap_dir,
                    update_manifest)

FORMAT = "sle-pts-v1"
TILE_SIZE = 100  # m
MAGIC = b"SLEP"
VERSION = 1
HEADER = struct.Struct("<4sHHIf")  # magic, version, reserved, count, hBase
assert HEADER.size == 16
RECORD = np.dtype([("x", "<u2"), ("y", "<u2"), ("h", "<u2"), ("agl", "<i2"), ("cls", "u1"), ("intensity", "u1")])
assert RECORD.itemsize == 10
H_MAX_CM = 65535
AGL_MAX_CM = 32767
INTENSITY_PERCENTILE = 99.5

LAZ_RAW = RAW_DIR / "laz"
LAZ_FOLDER = "OD_LIDAR_Punktwolke_2025_laz_LK"
CLASS_LABELS_DE = {
    1: "Unklassifiziert", 2: "Boden", 6: "Gebäude", 8: "Wasser (synthetisch)", 9: "Wasser", 14: "Leitungen",
    17: "Brücke", 20: "Sonstige", 24: "Keller", 30: "Füllpunkte (synthetisch)",
}
FOREST_CHM_M = 3.0  # "forest" = CHM ≥ 3 m outside LoD2 footprints (evaluation only)


# --------------------------------------------------------------------------- focus areas
@dataclass(frozen=True)
class FocusArea:
    id: str
    name_de: str
    bbox: tuple[int, int, int, int]

    @property
    def nx(self) -> int:
        return (self.bbox[2] - self.bbox[0]) // TILE_SIZE

    @property
    def ny(self) -> int:
        return (self.bbox[3] - self.bbox[1]) // TILE_SIZE

    @property
    def area_m2(self) -> int:
        return (self.bbox[2] - self.bbox[0]) * (self.bbox[3] - self.bbox[1])

    def laz_tiles(self) -> list[tuple[int, int]]:
        """1 km source tiles (E_km, N_km) overlapping the half-open bbox."""
        e0, n0, e1, n1 = self.bbox
        return [(e, n) for n in range(n0 // 1000, (n1 - 1) // 1000 + 1) for e in range(e0 // 1000, (e1 - 1) // 1000 + 1)]


def parse_areas(raw: list[dict]) -> list[FocusArea]:
    out, seen = [], set()
    for a in raw:
        fa = FocusArea(str(a["id"]), str(a.get("name_de", a["id"])), tuple(int(v) for v in a["bbox"]))
        e0, n0, e1, n1 = fa.bbox
        if not fa.id.replace("-", "").replace("_", "").isalnum() or fa.id in seen:
            raise ValueError(f"bad/duplicate area id {fa.id!r}")
        if not (e0 < e1 and n0 < n1) or any(v % TILE_SIZE for v in fa.bbox):
            raise ValueError(f"{fa.id}: bbox {fa.bbox} must be ordered multiples of {TILE_SIZE} m")
        seen.add(fa.id)
        out.append(fa)
    return out


def area_belongs(aoi: AOI, area: FocusArea) -> bool:
    """v3 place: the bbox centre lies in a present tile (rule 6; tiles are half-open, so a centre on a tile edge
    belongs to the tile east/north of it). v1/v2 rectangle: the bbox lies fully inside the AOI."""
    e0, n0, e1, n1 = area.bbox
    if aoi.is_place:
        from grid import tile_of_point
        return aoi.present(*tile_of_point((e0 + e1) / 2, (n0 + n1) / 2))
    return e0 >= aoi.e0 and n0 >= aoi.n0 and e1 <= aoi.e1 and n1 <= aoi.n1


def areas_for_aoi(aoi: AOI, path: Path = Path(__file__).resolve().parent / "aois.toml") -> list[FocusArea]:
    from common import load_aois
    cfg = load_aois(path)   # includes $SLE_AOIS_EXTRA (S3 ort.toml builds: the opted-in areas only)
    raw = cfg.get(aoi.key, {}).get("pointclouds", cfg.get("defaults", {}).get("pointclouds", []))
    return [a for a in parse_areas(raw) if area_belongs(aoi, a)]


def covering_window(aoi: AOI, name: str, bbox, margin: int = 2) -> tuple[np.ndarray, int, int] | None:
    """(array, E_west, N_top) of the 1 m work raster `name.tif` over bbox ± margin metres: from this AOI's own work
    raster when it covers the window, else from the `cache_from` AOI's or any other AOI's work raster that does
    (same sources and fill, so the heights agree). None when no work raster covers it. Used by v3 places, whose
    focus areas may reach beyond the place rectangle."""
    import rasterio
    from rasterio.windows import from_bounds
    e0, n0, e1, n1 = bbox[0] - margin, bbox[1] - margin, bbox[2] + margin, bbox[3] + margin
    own = WORK_DIR / aoi.key / f"{name}.tif"
    pref = [own]
    if aoi.cache_from:
        pref.append(WORK_DIR / aoi.cache_from / f"{name}.tif")
    paths = pref + sorted(p for p in WORK_DIR.glob(f"*/{name}.tif") if p not in pref)
    for path in paths:
        if not path.exists():
            continue
        with rasterio.open(path) as ds:
            b, t = ds.bounds, ds.transform
            if (t.a, t.b, t.d, t.e) != (1.0, 0.0, 0.0, -1.0) or b.left > e0 or b.bottom > n0 or b.right < e1 \
                    or b.top < n1 or (t.c % 1) or (t.f % 1):
                continue
            win = from_bounds(e0, n0, e1, n1, t).round_offsets().round_lengths()
            arr = ds.read(1, window=win)
            if name == "dtm" and not np.isfinite(arr).all():
                continue
            return arr, int(e0), int(n1)
    return None


def laz_name(e: int, n: int) -> str:
    return f"3dm_32_{e}_{n}_1_SL_2025_050.laz"


# --------------------------------------------------------------------------- pure encoding
def tile_seed(area_id: str, tx: int, ty: int) -> int:
    return zlib.crc32(f"{area_id}/{tx}_{ty}".encode())


def tile_permutation(n: int, area_id: str, tx: int, ty: int) -> np.ndarray:
    return np.random.default_rng(tile_seed(area_id, tx, ty)).permutation(n)


def clip_mask(e_cm: np.ndarray, n_cm: np.ndarray, bbox) -> np.ndarray:
    """Half-open bbox [Emin, Emax) × [Nmin, Nmax) on integer-centimetre coordinates."""
    e0, n0, e1, n1 = (int(v) * 100 for v in bbox)
    return (e_cm >= e0) & (e_cm < e1) & (n_cm >= n0) & (n_cm < n1)


def tile_index(e_cm: np.ndarray, n_cm: np.ndarray, bbox) -> tuple[np.ndarray, np.ndarray]:
    ts = TILE_SIZE * 100
    return (e_cm - int(bbox[0]) * 100) // ts, (n_cm - int(bbox[1]) * 100) // ts


def encode_tile(x_cm, y_cm, z_cm, agl_cm, cls, intensity_u8, perm: np.ndarray | None = None) -> tuple[bytes, float]:
    """Records for one tile (x/y in cm from the tile's lower-left corner, z in true cm) → (.bin bytes, hBase m).

    Points above hBase + 655.35 m are dropped. `perm` reorders the kept points (None = keep order)."""
    z_cm = np.asarray(z_cm, dtype=np.int64)
    h_base_cm = int(z_cm.min())
    keep = (z_cm - h_base_cm) <= H_MAX_CM
    x_cm, y_cm, z_cm = np.asarray(x_cm)[keep], np.asarray(y_cm)[keep], z_cm[keep]
    agl_cm, cls, intensity_u8 = np.asarray(agl_cm)[keep], np.asarray(cls)[keep], np.asarray(intensity_u8)[keep]
    n = len(z_cm)
    if (x_cm < 0).any() or (x_cm > TILE_SIZE * 100).any() or (y_cm < 0).any() or (y_cm > TILE_SIZE * 100).any():
        raise ValueError("x/y outside the tile")
    rec = np.empty(n, dtype=RECORD)
    rec["x"], rec["y"] = x_cm, y_cm
    rec["h"] = z_cm - h_base_cm
    rec["agl"] = np.clip(agl_cm, -AGL_MAX_CM, AGL_MAX_CM)
    rec["cls"], rec["intensity"] = cls, intensity_u8
    if perm is not None:
        if len(perm) != n:
            raise ValueError(f"permutation of {len(perm)} for {n} kept points")
        rec = rec[perm]
    h_base = h_base_cm / 100.0
    return HEADER.pack(MAGIC, VERSION, 0, n, h_base) + rec.tobytes(), h_base


def decode_tile(buf: bytes) -> tuple[float, np.ndarray]:
    magic, version, _res, count, h_base = HEADER.unpack_from(buf, 0)
    if magic != MAGIC or version != VERSION or len(buf) != HEADER.size + RECORD.itemsize * count:
        raise ValueError("not a sle-pts-v1 tile")
    return float(h_base), np.frombuffer(buf, dtype=RECORD, offset=HEADER.size, count=count)


def intensity_u8(raw: np.ndarray, intensity_max: float) -> np.ndarray:
    return np.clip(np.rint(np.asarray(raw, dtype=np.float64) * 255.0 / intensity_max), 0, 255).astype(np.uint8)


# --------------------------------------------------------------------------- fetch
def fetch_laz(tiles: list[tuple[int, int]], county: str) -> dict:
    """Cache the 1 km LAZ tiles in data/raw/laz/ (range-extracted from the county ZIP). Returns a report."""
    LAZ_RAW.mkdir(parents=True, exist_ok=True)
    rep: dict = {"cached": [], "fetched": [], "missing": []}
    todo = []
    for t in tiles:
        name, dst = laz_name(*t), LAZ_RAW / laz_name(*t)
        legacy = SL_RAW / "laz" / name  # research/01 download of 382_5466
        if not dst.exists() and legacy.exists() and valid_laz(legacy, t):
            try:
                dst.hardlink_to(legacy)
            except OSError:
                shutil.copy2(legacy, dst)
        (rep["cached"] if dst.exists() else todo).append(t)
    if not todo:
        return rep
    from fetch import CLOUD_BASE, HttpRangeFile, dav_list, resolve_share_token  # network only when needed
    token = resolve_share_token()
    dav = f"{CLOUD_BASE}/public.php/dav/files/{token}/{LAZ_FOLDER}/"
    zips = [n for n in dav_list(dav) if n.endswith(".zip") and f"_{county}_" in n]
    if len(zips) != 1:
        sys.exit(f"expected one {county} ZIP in {dav}, found {zips}")
    rf = HttpRangeFile(dav + urllib.parse.quote(zips[0]))
    zf = zipfile.ZipFile(io.BufferedReader(rf, buffer_size=4 << 20))
    members = {Path(i.filename).name: i for i in zf.infolist()}
    print(f"LVGL LAZ: {zips[0]} ({fmt_bytes(rf.size)}, {len(members)} members, central dir in {rf.requests} requests)")
    for t in todo:
        name = laz_name(*t)
        info = members.get(name)
        if info is None:
            print(f"  - {name}: not in ZIP (outside Saarland?)")
            rep["missing"].append(t)
            continue
        dst = LAZ_RAW / name
        part = dst.with_suffix(".part")
        t0, r0 = time.time(), rf.requests
        for attempt in range(3):
            try:
                with zf.open(info) as src, open(part, "wb") as out:
                    while chunk := src.read(4 << 20):
                        out.write(chunk)
                break
            except Exception as e:  # CRC / network errors → retry the member
                print(f"  ! {name}: {e} (attempt {attempt + 1})", file=sys.stderr)
                time.sleep(3)
        else:
            sys.exit(f"failed to extract {name}")
        if not valid_laz(part, t):
            part.unlink()
            sys.exit(f"{name}: extracted file is not a valid LAZ for tile {t}")
        part.rename(dst)
        rep["fetched"].append(t)
        print(f"  + {name}: {fmt_bytes(info.compress_size)}, {rf.requests - r0} requests, {time.time() - t0:.1f}s")
    return rep


def valid_laz(path: Path, tile: tuple[int, int]) -> bool:
    import laspy
    try:
        with laspy.open(path) as f:
            h = f.header
            e, n = tile[0] * 1000, tile[1] * 1000
            return (h.point_count > 0 and e - 1 <= h.mins[0] and h.maxs[0] <= e + 1001
                    and n - 1 <= h.mins[1] and h.maxs[1] <= n + 1001)
    except Exception:
        return False


# --------------------------------------------------------------------------- read + write
def read_area_points(area: FocusArea, files: list[Path]) -> dict[str, np.ndarray]:
    """Integer-cm E/N/Z, class, raw intensity of all non-withheld points inside the area bbox."""
    import laspy
    parts: dict[str, list] = {k: [] for k in ("e", "n", "z", "cls", "i", "synthetic")}
    for f in files:
        las = laspy.read(f)  # no CRS VLR in the file: EPSG:25832, heights DHHN2016 (assigned here)
        e = np.rint(np.asarray(las.x) * 100).astype(np.int64)
        n = np.rint(np.asarray(las.y) * 100).astype(np.int64)
        m = clip_mask(e, n, area.bbox) & ~np.asarray(las.withheld, dtype=bool)
        parts["e"].append(e[m])
        parts["n"].append(n[m])
        parts["z"].append(np.rint(np.asarray(las.z) * 100).astype(np.int64)[m])
        parts["cls"].append(np.asarray(las.classification, dtype=np.uint8)[m])
        parts["i"].append(np.asarray(las.intensity, dtype=np.uint16)[m])
        parts["synthetic"].append(np.asarray(las.synthetic, dtype=bool)[m])
        del las
    return {k: np.concatenate(v) if v else np.empty(0) for k, v in parts.items()}


def previous_entry(prev_section: dict | None, area_id: str, aoi_dir: Path) -> dict | None:
    """The area's entry from the previous manifest `pointclouds` section if every tile file it lists still
    exists – reused when this run has no LAZ/points for the area (failed download, `--no-fetch` with an
    empty cache), so a failed run never leaves the manifest pointing at deleted tiles."""
    for a in (prev_section or {}).get("areas", []):
        if a.get("id") != area_id:
            continue
        try:
            ok = all((aoi_dir / a["path"].format(tx=t[0], ty=t[1])).is_file() for t in a["tiles"])
        except (KeyError, IndexError, TypeError, ValueError):
            return None
        return a if ok and a["tiles"] else None
    return None


def write_area(aoi: AOI, area: FocusArea, pts: dict[str, np.ndarray], sampler, chm=None,
               root: Path | None = None) -> tuple[dict, dict] | None:
    """Write the area's tiles into a staging dir and swap it in; returns (manifest entry, report), or None
    (previous output untouched) when there are no points or no tile survives the height filter."""
    if len(pts["e"]) == 0:
        return None
    out_dir = (root or aoi.data_dir / "pointclouds") / area.id
    staging = out_dir.with_name(area.id + ".tmp")
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    e, n, z, cls = pts["e"], pts["n"], pts["z"], pts["cls"]
    dtm = sampler.z(e / 100.0, n / 100.0)
    agl = np.rint(z - dtm * 100.0).astype(np.int64)
    i_max = float(max(1, round(float(np.percentile(pts["i"], INTENSITY_PERCENTILE))))) if len(e) else 1.0
    inten = intensity_u8(pts["i"], i_max)
    tx, ty = tile_index(e, n, area.bbox)
    key = ty * area.nx + tx
    order = np.argsort(key, kind="stable")
    bounds = np.searchsorted(key[order], np.arange(area.nx * area.ny + 1))
    tiles, total, nbytes, hmin, hmax, dropped = [], 0, 0, np.inf, -np.inf, 0
    class_counts: dict[str, int] = {}
    for k in range(area.nx * area.ny):
        idx = order[bounds[k]:bounds[k + 1]]
        if len(idx) == 0:
            continue
        ttx, tty = k % area.nx, k // area.nx
        x0 = (area.bbox[0] + ttx * TILE_SIZE) * 100
        y0 = (area.bbox[1] + tty * TILE_SIZE) * 100
        h_base_cm = z[idx].min()
        idx = idx[(z[idx] - h_base_cm) <= H_MAX_CM]
        dropped += bounds[k + 1] - bounds[k] - len(idx)
        perm = tile_permutation(len(idx), area.id, ttx, tty)
        buf, _ = encode_tile(e[idx] - x0, n[idx] - y0, z[idx], agl[idx], cls[idx], inten[idx], perm)
        (staging / f"{ttx}_{tty}.bin").write_bytes(buf)
        tiles.append([int(ttx), int(tty), int(len(idx))])
        total += len(idx)
        nbytes += len(buf)
        hmin, hmax = min(hmin, z[idx].min() / 100), max(hmax, z[idx].max() / 100)
        for c, cnt in zip(*np.unique(cls[idx], return_counts=True)):
            class_counts[str(int(c))] = class_counts.get(str(int(c)), 0) + int(cnt)
    if not tiles:
        shutil.rmtree(staging)
        return None
    swap_dir(staging, out_dir)
    class_counts = dict(sorted(class_counts.items(), key=lambda kv: int(kv[0])))
    entry = {
        "id": area.id, "name_de": area.name_de, "bbox": list(area.bbox), "tiles": tiles,
        "path": f"pointclouds/{area.id}/{{tx}}_{{ty}}.bin", "pointCount": total,
        "density_per_m2": round(total / area.area_m2, 3), "classCounts": class_counts,
        "heightRange": {"min": round(float(hmin), 2), "max": round(float(hmax), 2)} if total else {"min": 0, "max": 0},
        "intensityMax": i_max,
    }
    report = evaluate(area, pts, agl, chm)
    report.update(tiles=len(tiles), points=total, bytes=nbytes, dropped_height=int(dropped), intensityMax=i_max)
    return entry, report


def evaluate(area: FocusArea, pts: dict[str, np.ndarray], agl_cm: np.ndarray, chm) -> dict:
    """Q-5: density per class group and ground points vs the 1 m DTM (bilinear)."""
    a = area.area_m2
    cls = pts["cls"]
    groups = {"ground": cls == 2, "building": cls == 6, "other": ~np.isin(cls, [2, 6])}
    rep: dict = {"area_m2": a, "density_per_m2": {k: round(float(m.sum()) / a, 3) for k, m in groups.items()}}
    rep["density_per_m2"]["all"] = round(len(cls) / a, 3)
    g = groups["ground"]
    dz = np.abs(agl_cm[g]) / 100.0
    if len(dz):
        rep["ground_vs_dtm_m"] = {"n": int(len(dz)), "median_abs": round(float(np.median(dz)), 3),
                                  "p95_abs": round(float(np.percentile(dz, 95)), 3),
                                  "median_signed": round(float(np.median(-agl_cm[g] / 100.0)), 3)}
    if chm is not None:
        arr, e0, n_top = chm
        col = (pts["e"] // 100 - e0).astype(np.int64)
        row = (n_top - 1 - pts["n"] // 100).astype(np.int64)
        forest_pt = arr[row, col] >= FOREST_CHM_M
        b = area.bbox
        sub = arr[n_top - b[3]: n_top - b[1], b[0] - e0: b[2] - e0]
        f_area, o_area = float((sub >= FOREST_CHM_M).sum()), float((sub < FOREST_CHM_M).sum())
        rep["forest_fraction"] = round(f_area / a, 3)
        rep["ground_density_forest_per_m2"] = round(float((g & forest_pt).sum()) / f_area, 3) if f_area else None
        rep["ground_density_open_per_m2"] = round(float((g & ~forest_pt).sum()) / o_area, 3) if o_area else None
        # share of 1 m forest cells without any ground point (how much the DTM is interpolated there)
        cells = np.zeros(sub.shape, dtype=bool)
        gr = row[g] - (n_top - b[3])
        gc = col[g] - (b[0] - e0)
        cells[gr, gc] = True
        rep["forest_cells_without_ground_pt"] = round(float((~cells & (sub >= FOREST_CHM_M)).sum()) / f_area, 3) if f_area else None
    return rep


def place_area_inputs(aoi: AOI, area: FocusArea):
    """DTM sampler and (bldg-masked) CHM window for an area of a v3 place: window-read around the area bbox, which
    may reach beyond the place rectangle (`covering_window`). Without a covering DTM the place's own DTM is used
    edge-clamped (agl near the outside edge degrades; warned); without a covering CHM the forest stats are skipped."""
    from heights import DtmSampler
    w = covering_window(aoi, "dtm", area.bbox)
    if w is None:
        print(f"  ! {area.id}: no work DTM covers the area – agl from the place DTM, edge-clamped", file=sys.stderr)
        sampler = DtmSampler.from_geotiff(WORK_DIR / aoi.key / "dtm.tif", aoi.e0, aoi.n1)
    else:
        sampler = DtmSampler(w[0].astype(np.float64), w[1], w[2])
    c = covering_window(aoi, "chm", area.bbox, margin=0)
    chm = None
    if c is not None:
        arr = np.nan_to_num(c[0].astype(np.float32), nan=0.0)
        b = covering_window(aoi, "bldg", area.bbox, margin=0)
        if b is not None and b[0].shape == arr.shape:  # LoD2 footprints: CHM ≥ 3 m there is a roof, not canopy
            arr = np.where(b[0] > 0, 0.0, arr)
        chm = (arr, c[1], c[2])
    return sampler, chm


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("aoi")
    ap.add_argument("--no-fetch", action="store_true", help="use cached LAZ only")
    args = ap.parse_args()
    aoi = load_aoi(args.aoi)
    t0 = time.time()
    aoi_dir = aoi.data_dir
    areas = areas_for_aoi(aoi)
    if not (aoi_dir / "manifest.json").exists():
        sys.exit(f"{aoi_dir}/manifest.json missing – run build first")
    if not areas:
        print(f"AOI {aoi.key}: no point-cloud focus area " +
              ("has its bbox centre in a present tile" if aoi.is_place else "lies inside it"))
        if (aoi_dir / "pointclouds").exists():
            shutil.rmtree(aoi_dir / "pointclouds")
        update_manifest(aoi_dir, {}, remove=["pointclouds"])
        return
    from heights import DtmSampler
    import rasterio
    sampler = DtmSampler.from_geotiff(WORK_DIR / aoi.key / "dtm.tif", aoi.e0, aoi.n1)
    chm = None
    if (WORK_DIR / aoi.key / "chm.tif").exists():
        with rasterio.open(WORK_DIR / aoi.key / "chm.tif") as ds:
            arr = ds.read(1)
            chm = (arr, int(ds.transform.c), int(ds.transform.f))
        if (WORK_DIR / aoi.key / "bldg.tif").exists():  # LoD2 footprints: CHM ≥ 3 m there is a roof, not canopy
            with rasterio.open(WORK_DIR / aoi.key / "bldg.tif") as ds:
                if ds.shape == arr.shape:
                    chm = (np.where(ds.read(1) > 0, 0.0, arr), chm[1], chm[2])
    needed = sorted({t for a in areas for t in a.laz_tiles()})
    print(f"AOI {aoi.key}: {len(areas)} focus areas, {len(needed)} LAZ tiles")
    if args.no_fetch:
        fetch_rep = {"cached": [t for t in needed if (LAZ_RAW / laz_name(*t)).exists()]}
    else:
        fetch_rep = fetch_laz(needed, aoi.county)
    prev_section = json.loads((aoi_dir / "manifest.json").read_text()).get("pointclouds")
    # drop areas of a removed id
    pc_root = aoi_dir / "pointclouds"
    if pc_root.exists():
        for d in pc_root.iterdir():
            if d.is_dir() and d.name not in {a.id for a in areas}:
                shutil.rmtree(d)
    entries, report, present = [], {"aoi": aoi.key, "fetch": fetch_rep, "areas": {}}, set()
    for area in areas:
        ta = time.time()
        files = [LAZ_RAW / laz_name(*t) for t in area.laz_tiles() if (LAZ_RAW / laz_name(*t)).exists()]
        missing = [laz_name(*t) for t in area.laz_tiles() if not (LAZ_RAW / laz_name(*t)).exists()]
        if missing:
            print(f"  ! {area.id}: LAZ missing {missing} – area left incomplete", file=sys.stderr)
        pts = read_area_points(area, files) if files else {"e": np.empty(0)}
        a_sampler, a_chm = sampler, chm
        if aoi.is_place and len(pts["e"]):
            a_sampler, a_chm = place_area_inputs(aoi, area)
        # write_area only replaces the area's previous tiles once the new ones are complete
        written = write_area(aoi, area, pts, a_sampler, a_chm) if len(pts["e"]) else None
        if written is None:
            prev = previous_entry(prev_section, area.id, aoi_dir)
            if prev is None:
                print(f"  ! {area.id}: no points – skipped", file=sys.stderr)
                if (pc_root / area.id).exists():  # unreferenced partial output of an older run
                    shutil.rmtree(pc_root / area.id)
                continue
            print(f"  ! {area.id}: no points this run – keeping previous output", file=sys.stderr)
            entries.append(prev)
            report["areas"][area.id] = {"kept_previous": True, "missing_laz": missing}
            present |= {int(c) for c in prev.get("classCounts", {})}
            continue
        entry, rep = written
        entry["source"] = [f.name for f in files]
        rep["missing_laz"] = missing
        rep["seconds"] = round(time.time() - ta, 1)
        entries.append(entry)
        report["areas"][area.id] = rep
        present |= {int(c) for c in entry["classCounts"]}
        g = rep.get("ground_vs_dtm_m", {})
        print(f"  {area.id}: {entry['pointCount']:,} pts ({entry['density_per_m2']}/m²), {len(entry['tiles'])} tiles, "
              f"{fmt_bytes(rep['bytes'])}; density ground/building/other {rep['density_per_m2']['ground']}/"
              f"{rep['density_per_m2']['building']}/{rep['density_per_m2']['other']}; ground−DTM |dz| median "
              f"{g.get('median_abs')} p95 {g.get('p95_abs')} m; {rep['seconds']}s")
    if not entries:
        # nothing written and nothing reusable: drop the key instead of leaving dangling tile paths
        update_manifest(aoi_dir, {}, remove=["pointclouds"])
        if pc_root.exists() and not any(pc_root.iterdir()):
            pc_root.rmdir()
        sys.exit("no point-cloud area written (manifest key `pointclouds` removed)")
    classes = {str(c): CLASS_LABELS_DE.get(c, f"Klasse {c}") for c in sorted(present)}
    section = {"format": FORMAT, "tileSize": TILE_SIZE, "crs": "EPSG:25832", "areas": entries, "classes": classes,
               "attribution": ATTRIBUTION_SL}
    update_manifest(aoi_dir, {"pointclouds": section}, attribution=[ATTRIBUTION_SL])
    report["seconds"] = round(time.time() - t0, 1)
    (WORK_DIR / aoi.key / "pointcloud.json").write_text(json.dumps(report, indent=1))
    print(f"done in {report['seconds']}s")


if __name__ == "__main__":
    main()
