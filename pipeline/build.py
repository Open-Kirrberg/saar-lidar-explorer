"""Build app data for an AOI: mosaic → RLP/nodata fill → relief layers → Terrarium + u8 PNG chunks → manifest.

Usage:  uv run python build.py <aoi> [--no-dsm] [--no-previews] [--levels N]

--levels N: coarse overview levels 1…N (contract v2, default 4); 0 writes a v1 manifest without `levels`.

Reads data/raw/{lvgl-sl,rlp}/ (see fetch.py), writes
  data/work/<aoi>/*.tif               float32 AOI rasters (EPSG:25832) for xyz.py / tests / QGIS
  app/public/data/<aoi>/…             chunks + manifest.json (docs/data-contract.md)
  docs/previews/<aoi>_{vat,slrm,chm}.jpg
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
import time
import warnings
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import matplotlib.cm
import numpy as np
import rasterio
from PIL import Image
from pyproj import Transformer
from rasterio.transform import from_origin
from scipy import ndimage

# rvt.blend_func imports matplotlib.cm.get_cmap, removed in matplotlib 3.9 → shim before import.
if not hasattr(matplotlib.cm, "get_cmap"):
    matplotlib.cm.get_cmap = matplotlib.colormaps.get_cmap
import rvt.blend_func as rbf  # noqa: E402
import rvt.vis  # noqa: E402

from common import (  # noqa: E402
    APP_DATA, ATTRIBUTION_RLP, ATTRIBUTION_SL, PREVIEW_DIR, RLP_RAW, SL_RAW, UTM32_PROJ4, WORK_DIR, load_aoi, sl_name,
    update_manifest,
)
from encode import height_chunk, layer_chunk, terrarium_encode, u8_encode  # noqa: E402
from levels import N_LEVELS, level0_entry, write_levels  # noqa: E402
from render import CMAPS, cmap_rgba, downsample_mean  # noqa: E402

# ----------------------------------------------------------------------------- parameters
PARAMS = {
    "hillshade": {"method": "multi-directional, MDOW-weighted (Mark 1992)", "azimuths": [225, 270, 315, 360],
                  "sun_elevation": 35,
                  "stretch_percentiles": [0.5, 99.5], "note": "display image: linearly stretched to 0–1"},
    "slope": {"units": "degree"},
    "slrm": {"radius_m": 20},
    "svf": {"n_dir": 16, "r_max_m": 10, "noise": 0},
    "openness": {"n_dir": 16, "r_max_m": 10},
    "vat": {"method": "RVT 'VAT combined' = VAT general (50 %) over VAT flat, rvt.blend_func",
            "note": "flat variant uses the same r=10 m SVF/openness as general (RVT uses larger radii for flat)"},
    "chm": {"formula": "clip(DSM − DTM, 0, 40)"},
}
# RVT blender presets (top → bottom layer): (vis name, min, max, blend mode, opacity %)
VAT_GENERAL = [("Sky-View Factor", 0.7, 1.0, "multiply", 25), ("Openness - Positive", 68, 93, "overlay", 50),
               ("Slope gradient", 0, 50, "luminosity", 50), ("Hillshade", 0, 1, "normal", 100)]
VAT_FLAT = [("Sky-View Factor", 0.9, 1.0, "multiply", 25), ("Openness - Positive", 85, 91, "overlay", 50),
            ("Slope gradient", 0, 15, "luminosity", 50), ("Hillshade", 0, 1, "normal", 100)]

LAYER_META = {
    "hillshade": ("Schummerung (multidirektional)", None, "Multidirektionale Schummerung (Sonnenhöhe 35°)"),
    "slope": ("Hangneigung", "deg", "Hangneigung in Grad"),
    "slrm": ("Lokales Relief", "m", "Simple Local Relief Model: DGM minus 20-m-Mittelwert (positiv = Erhebung)"),
    "svf": ("Himmelssicht (SVF)", None, "Sky-View Factor, 16 Richtungen, Radius 10 m"),
    "opns_pos": ("Offenheit positiv", "deg", "Positive Offenheit (konvexe Formen hell), 16 Richtungen, 10 m"),
    "opns_neg": ("Offenheit negativ", "deg", "Negative Offenheit (hohe Werte = Senken/Gräben), 16 Richtungen, 10 m"),
    "vat": ("VAT (Kombination)", None, "Visualisation for Archaeological Topography (RVT, kombiniert allgemein+flach)"),
    "chm": ("Vegetationshöhe", "m", "Vegetations-/Objekthöhe = DOM − DGM, auf 0–40 m begrenzt"),
    "mask": ("Ergänzte Daten (RLP/Lücke)", None, "0 = LVGL-SL 2025, 0.5 = aus RLP 2022 ergänzt, 1 = interpoliert"),
}


def clear_build_outputs(out: Path) -> None:
    """Delete only the chunk dirs this step owns: dtm/, dsm/ and relief/<k> for k in LAYER_META.

    Other relief/ subdirs belong to later steps (relief/bldg from buildings.py) and must survive a
    rebuild — the manifest merge keeps their layer entries (audit pipeline-1)."""
    for sub in ("dtm", "dsm"):
        shutil.rmtree(out / sub, ignore_errors=True)
    for k in LAYER_META:
        shutil.rmtree(out / "relief" / k, ignore_errors=True)


def log(msg: str, t0: float = None):
    print(f"{msg}" + (f"  [{time.time() - t0:.1f}s]" if t0 else ""), flush=True)


# ----------------------------------------------------------------------------- mosaic
def read_mosaic(paths: dict, box: tuple[int, int, int, int]) -> tuple[np.ndarray, list]:
    """paths: {(e_km, n_km): Path}. Returns float32 array over box (row 0 = north), NaN where no data."""
    bx0, by0, bx1, by1 = box
    out = np.full((by1 - by0, bx1 - bx0), np.nan, np.float32)
    used = []
    for (e, n), p in sorted(paths.items()):
        te0, tn0 = e * 1000, n * 1000
        ex0, ex1 = max(bx0, te0), min(bx1, te0 + 1000)
        ny0, ny1 = max(by0, tn0), min(by1, tn0 + 1000)
        if ex0 >= ex1 or ny0 >= ny1:
            continue
        with rasterio.open(p) as ds:
            t = ds.transform
            if (t.a, t.b, t.c, t.d, t.e, t.f) != (1.0, 0.0, te0, 0.0, -1.0, tn0 + 1000) or ds.shape != (1000, 1000):
                sys.exit(f"{p.name}: unexpected grid {t} {ds.shape} – would need resampling")
            if ds.crs is not None and ds.crs.to_epsg() not in (25832, None) and "25832" not in ds.crs.to_wkt():
                sys.exit(f"{p.name}: unexpected CRS {ds.crs}")
            win = rasterio.windows.Window(ex0 - te0, tn0 + 1000 - ny1, ex1 - ex0, ny1 - ny0)
            a = ds.read(1, window=win).astype(np.float32)
            if ds.nodata is not None:
                a[a == ds.nodata] = np.nan
            a[(a < -1000) | (a > 5000)] = np.nan
        out[by1 - ny1: by1 - ny0, ex0 - bx0: ex1 - bx0] = a
        used.append((e, n))
    return out, used


def tile_paths(product: str, tiles: list) -> tuple[dict, dict]:
    sl = {t: SL_RAW / sl_name(product, *t) for t in tiles if (SL_RAW / sl_name(product, *t)).exists()}
    rlp = {}
    for t in tiles:
        hits = sorted(RLP_RAW.glob(f"{product}_32_{t[0]}_{t[1]}_1_rp_*.tif"))
        if hits:
            rlp[t] = hits[-1]  # newest year
    return sl, rlp


def rlp_offset(sl: np.ndarray, rlp: np.ndarray) -> dict:
    both = np.isfinite(sl) & np.isfinite(rlp)
    if both.sum() < 10_000:
        return {"overlap_px": int(both.sum()), "applied": 0.0, "constant_bias": False}
    d = (sl - rlp)[both].astype(np.float64)
    med = float(np.median(d))
    d = d[np.abs(d - med) < 1.0]  # drop real terrain change (construction, quarries)
    med = float(np.median(d))
    p10, p90 = (float(v) for v in np.percentile(d, [10, 90]))
    constant = (p90 - p10) < 0.3 and abs(med) >= 0.01
    return {"overlap_px": int(both.sum()), "median_sl_minus_rlp_m": round(med, 3), "p10": round(p10, 3),
            "p90": round(p90, 3), "constant_bias": constant, "applied": round(med, 3) if constant else 0.0}


def tiles_used(paths: dict, used: np.ndarray, box) -> list:
    """[((e, n), path, n_pixels)] for tiles that contributed at least one pixel of `used`."""
    out = []
    for (e, n), p in sorted(paths.items()):
        r0, r1 = max(0, box[3] - (n + 1) * 1000), min(used.shape[0], box[3] - n * 1000)
        c0, c1 = max(0, e * 1000 - box[0]), min(used.shape[1], (e + 1) * 1000 - box[0])
        if r0 < r1 and c0 < c1 and used[r0:r1, c0:c1].any():
            out.append(((e, n), p, int(used[r0:r1, c0:c1].sum())))
    return out


def fill_nearest(a: np.ndarray) -> np.ndarray:
    bad = ~np.isfinite(a)
    if not bad.any():
        return a
    idx = ndimage.distance_transform_edt(bad, return_distances=False, return_indices=True)
    return a[tuple(idx)]


# ----------------------------------------------------------------------------- relief
def mdow_hillshade(slope_rad, aspect_rad, azimuths, elev_deg):
    """Multi-directional oblique-weighted hillshade: weight each azimuth by sin²(aspect − az)."""
    zen = math.radians(90 - elev_deg)
    acc = np.zeros_like(slope_rad)
    wsum = np.zeros_like(slope_rad)
    for az in azimuths:
        a = math.radians(az)
        hs = np.cos(zen) * np.cos(slope_rad) + np.sin(zen) * np.sin(slope_rad) * np.cos(a - aspect_rad)
        w = np.sin(aspect_rad - a) ** 2 + 1e-3
        acc += w * np.clip(hs, 0, 1)
        wsum += w
    return (acc / wsum).astype(np.float32)


def rvt_blend(layers, imgs: dict) -> np.ndarray:
    """Replicates rvt.blend.BlenderCombination.render_all_images for precomputed grayscale layers."""
    rendered = None
    for vis, vmin, vmax, mode, opacity in reversed(layers):
        norm = rbf.normalize_image(vis, imgs[vis].astype(np.float32).copy(), vmin, vmax, "value")
        if rendered is None:
            rendered = norm
            continue
        top = rbf.blend_images(mode, norm, rendered)
        rendered = rbf.render_images(top, rendered, opacity)
    return rendered.astype(np.float32)


def compute_relief(dtm: np.ndarray) -> dict:
    out = {}
    t = time.time()
    sa = rvt.vis.slope_aspect(dtm, resolution_x=1, resolution_y=1, output_units="radian")
    slope_rad, aspect_rad = sa["slope"].astype(np.float32), sa["aspect"].astype(np.float32)
    out["slope"] = np.degrees(slope_rad).astype(np.float32)
    p = PARAMS["hillshade"]
    hs = mdow_hillshade(slope_rad, aspect_rad, p["azimuths"], p["sun_elevation"])
    lo, hi = np.percentile(hs[::4, ::4], p["stretch_percentiles"])  # raw MDOW is low-contrast (≈0.37–0.67)
    p["stretch_applied"] = [round(float(lo), 4), round(float(hi), 4)]
    out["hillshade"] = np.clip((hs - lo) / (hi - lo), 0, 1).astype(np.float32)
    # (rvt.vis.hillshade crops 1 px when slope/aspect are passed in, so let it recompute them)
    hs315 = rvt.vis.hillshade(dtm, 1, 1, sun_azimuth=315, sun_elevation=35).astype(np.float32)
    log("  slope + hillshade", t)
    t = time.time()
    out["slrm"] = rvt.vis.slrm(dtm, radius_cell=PARAMS["slrm"]["radius_m"]).astype(np.float32)
    log("  slrm", t)
    t = time.time()
    s = PARAMS["svf"]
    r = rvt.vis.sky_view_factor(dtm, resolution=1, compute_svf=True, compute_opns=True,
                                svf_n_dir=s["n_dir"], svf_r_max=s["r_max_m"], svf_noise=s["noise"])
    out["svf"], out["opns_pos"] = r["svf"].astype(np.float32), r["opns"].astype(np.float32)
    log("  svf + positive openness", t)
    t = time.time()
    r = rvt.vis.sky_view_factor(-dtm, resolution=1, compute_svf=False, compute_opns=True,
                                svf_n_dir=s["n_dir"], svf_r_max=s["r_max_m"], svf_noise=s["noise"])
    out["opns_neg"] = r["opns"].astype(np.float32)
    log("  negative openness", t)
    t = time.time()
    out["vat"] = vat_combined(out["svf"], out["opns_pos"], out["slope"], hs315)
    log("  VAT blend", t)
    return out


def vat_combined(svf: np.ndarray, opns_pos: np.ndarray, slope_deg: np.ndarray, hs315: np.ndarray) -> np.ndarray:
    """RVT „VAT combined“ = 50 % VAT general over VAT flat (rvt.blend_func, incl. its in-place overlay quirk)."""
    imgs = {"Sky-View Factor": svf, "Openness - Positive": opns_pos, "Slope gradient": slope_deg, "Hillshade": hs315}
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        general = rvt_blend(VAT_GENERAL, imgs)
        flat = rvt_blend(VAT_FLAT, imgs)
    return rbf.render_images(general, flat, 50).astype(np.float32)


VAT_PRESETS_V1 = ((50.0, 68.0, 93.0, 0.7), (15.0, 85.0, 91.0, 0.9))   # (s_max, o_min, o_max, v_min): general, flat


def vat_formula_v1(svf: np.ndarray, opns_pos_deg: np.ndarray, dtm: np.ndarray) -> np.ndarray:
    """Contract method `rvt-vat-combined-v1` in numpy (what the app computes live): VAT from svf, positive openness
    (degrees) and the gradient of the 1 m DTM (row 0 = north). Used by the tests to bound the live-vs-baked error."""
    dh_drow, dh_dcol = np.gradient(dtm.astype(np.float64))
    gx, gy = dh_dcol, -dh_drow            # ∂h/∂E, ∂h/∂N
    a, e = math.radians(315.0), math.radians(35.0)
    L = (math.cos(e) * math.sin(a), math.cos(e) * math.cos(a), math.sin(e))
    norm = np.sqrt(gx * gx + gy * gy + 1.0)
    hs = np.clip((-gx * L[0] - gy * L[1] + L[2]) / norm, 0, 1)
    s = np.degrees(np.arctan(np.hypot(gx, gy)))
    out = np.zeros(dtm.shape)
    for s_max, o_min, o_max, v_min in VAT_PRESETS_V1:
        r1 = 0.5 * (1 - np.clip(s / s_max, 0, 1)) + 0.5 * hs
        o = np.clip((opns_pos_deg - o_min) / (o_max - o_min), 0, 1)
        r2 = np.where(r1 > 0.5, 1 - (1 - 2 * (r1 - 0.5)) * (1 - o), 2 * r1 * o)
        v = np.clip((svf - v_min) / (1 - v_min), 0, 1)
        out += 0.5 * (0.75 * r2 + 0.25 * v * r2)
    return out


def compute_relief_v3(dtm: np.ndarray) -> dict:
    """v3 relief of one tile window: svf, opns_pos, opns_neg (r = 10 m, 16 directions) and the internal 1 m VAT
    (only its level-1 block mean is published). Every value depends on heights within 11 m (locality rule)."""
    s = PARAMS["svf"]
    slope = np.degrees(rvt.vis.slope_aspect(dtm, resolution_x=1, resolution_y=1, output_units="radian")["slope"])
    hs315 = rvt.vis.hillshade(dtm, 1, 1, sun_azimuth=315, sun_elevation=35).astype(np.float32)
    r = rvt.vis.sky_view_factor(dtm, resolution=1, compute_svf=True, compute_opns=True,
                                svf_n_dir=s["n_dir"], svf_r_max=s["r_max_m"], svf_noise=s["noise"])
    out = {"svf": r["svf"].astype(np.float32), "opns_pos": r["opns"].astype(np.float32)}
    r = rvt.vis.sky_view_factor(-dtm, resolution=1, compute_svf=False, compute_opns=True,
                                svf_n_dir=s["n_dir"], svf_r_max=s["r_max_m"], svf_noise=s["noise"])
    out["opns_neg"] = r["opns"].astype(np.float32)
    out["vat"] = vat_combined(out["svf"], out["opns_pos"], slope.astype(np.float32), hs315)
    return out


# ----------------------------------------------------------------------------- ranges
def pct(a, qs):
    return [float(v) for v in np.percentile(a[::3, ::3], qs)]


def choose_range(key: str, a: np.ndarray) -> tuple[float, float, dict]:
    p = dict(zip(["p0.5", "p1", "p50", "p99", "p99.5"], pct(a, [0.5, 1, 50, 99, 99.5])))
    stats = {k: round(v, 4) for k, v in p.items()}
    if key in ("hillshade", "vat", "mask"):
        return 0.0, 1.0, stats
    if key == "slope":
        return 0.0, float(math.ceil(p["p99.5"] / 5) * 5), stats
    if key == "slrm":
        m = max(abs(p["p0.5"]), abs(p["p99.5"]))
        m = math.ceil(m * 10) / 10
        return -m, m, stats
    if key == "svf":
        return math.floor(p["p0.5"] * 100) / 100, 1.0, stats
    if key in ("opns_pos", "opns_neg"):
        return float(math.floor(p["p0.5"])), float(math.ceil(p["p99.5"])), stats
    if key == "chm":
        return 0.0, 40.0, stats
    raise KeyError(key)


# ----------------------------------------------------------------------------- output
def save_png(path: Path, arr: np.ndarray):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr).save(path, compress_level=9)


def write_geotiff(path: Path, arr: np.ndarray, e0: int, n_top: int):
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path, "w", driver="GTiff", width=arr.shape[1], height=arr.shape[0], count=1,
                       dtype="float32", crs="EPSG:25832", transform=from_origin(e0, n_top, 1, 1),
                       compress="deflate", predictor=3, tiled=True, nodata=np.nan) as ds:
        ds.write(arr.astype(np.float32), 1)


def save_previews(aoi, layers: dict, ranges: dict):
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    f = max(1, round(max(aoi.width, aoi.height) / 1500))
    vat = downsample_mean(layers["vat"], f)
    Image.fromarray(np.rint(np.clip(vat, 0, 1) * 255).astype(np.uint8)).save(
        PREVIEW_DIR / f"{aoi.key}_vat.jpg", quality=72, optimize=True)
    lo, hi = ranges["slrm_display"]
    rgba = cmap_rgba(downsample_mean(layers["slrm"], f), CMAPS["slrm"], lo, hi)
    Image.fromarray(rgba[..., :3]).save(PREVIEW_DIR / f"{aoi.key}_slrm.jpg", quality=72, optimize=True)
    rgba = cmap_rgba(downsample_mean(layers["chm"], f), CMAPS["chm"], 0, 35)
    Image.fromarray(rgba[..., :3]).save(PREVIEW_DIR / f"{aoi.key}_chm.jpg", quality=72, optimize=True)


# ============================================================================= v3 place build (contract "Many places")
# Fixed SL − RLP height offset applied to every RLP fill pixel in v3. v1/v2 measure it per AOI (median over the
# overlap), which makes heights depend on the AOI extent; v3 needs a constant (locality rule). Value: the median
# measured over homburg-gemeinde (58 M overlap px) and overall (23 M px), both −0.06 m (karlsberg −0.07).
RLP_OFFSET_V3_M = -0.06
V3_LAYERS = {  # key → file format (contract "Slim formats"): data layers lossless, visual layers AVIF q90
    "svf": "avif", "opns_pos": "avif", "opns_neg": "avif", "chm": "webp", "mask": "webp"}
V3_LAYER_ORDER = ["svf", "opns_pos", "opns_neg", "chm", "mask"]
V3_DERIVED = {
    "hillshade": {"method": "live-hillshade", "label_de": "Schummerung"},
    "slope": {"method": "live-slope", "unit": "deg", "label_de": "Hangneigung"},
    "slrm": {"method": "live-lrm", "params": {"radius_m": 20}, "unit": "m", "label_de": "Lokales Relief"},
    "vat": {"method": "rvt-vat-combined-v1", "inputs": ["svf", "opns_pos"], "label_de": "VAT (Kombination)"},
}


def v3_layer_entry(key: str, path: str) -> dict:
    from grid import FIXED_RANGES
    label, unit, desc = LAYER_META[key]
    lo, hi = FIXED_RANGES[key]
    e = {"path": path, "encoding": "u8", "min": lo, "max": hi}
    if unit:
        e["unit"] = unit
    if path.endswith(".avif"):
        e["lossy"] = True
    e["label_de"] = label
    e["description"] = desc
    return e


# v3: heights below this are source errors, not terrain (SL 2025 tiles 343_5457 and 327_5485 hold ≈ 100–200
# pixels between −0.26 and 100 m, holes of a few hundred px; the lowest real terrain of the catalog area is ≈ 137 m
# at the Moselle). Treated as no data (nearest fill, mask 1).
MIN_VALID_HEIGHT_M = 100.0


def fill_heights(sl: np.ndarray, rlp: np.ndarray, off: float) -> tuple[np.ndarray, np.ndarray]:
    """SL first, RLP + offset where SL has no data, nearest fill for the rest (within the given array only).
    Returns (dtm float32, mask: 0 = SL, 0.5 = RLP, 1 = interpolated)."""
    sl = np.where(sl < MIN_VALID_HEIGHT_M, np.nan, sl)
    rlp = np.where(rlp < MIN_VALID_HEIGHT_M, np.nan, rlp)
    use_rlp = ~np.isfinite(sl) & np.isfinite(rlp)
    dtm = np.where(use_rlp, rlp + np.float32(off), sl).astype(np.float32)
    mask = np.zeros(sl.shape, np.float32)
    mask[use_rlp] = 0.5
    gap = ~np.isfinite(dtm)
    mask[gap] = 1.0
    if gap.all():
        raise ValueError("no height data in window")
    return fill_nearest(dtm), mask


def fill_surface(dsl: np.ndarray, drlp: np.ndarray, dtm: np.ndarray, off: float) -> np.ndarray:
    dsl = np.where(dsl < MIN_VALID_HEIGHT_M, np.nan, dsl)
    drlp = np.where(drlp < MIN_VALID_HEIGHT_M, np.nan, drlp)
    use = ~np.isfinite(dsl) & np.isfinite(drlp)
    dsm = np.where(use, drlp + np.float32(off), dsl)
    dsm = np.where(np.isfinite(dsm), dsm, dtm)
    return np.maximum(dsm, dtm - 0.5).astype(np.float32)


def tile_window(t: tuple[int, int], b: int) -> tuple[int, int, int, int]:
    """[E0, N0, E1, N1] of tile t dilated by the relief buffer b."""
    return t[0] * 1000 - b, t[1] * 1000 - b, (t[0] + 1) * 1000 + b, (t[1] + 1) * 1000 + b


def process_tile_v3(win: dict, b: int) -> dict:
    """All published rasters of one tile from its raw source window (tile ± b m, row 0 = north): `win` holds
    dgm_sl, dgm_rlp and optionally dom_sl, dom_rlp (float32, NaN = no data). Pure function of the window, so a
    tile gives the same values whichever tile set it is built with (locality test, tests/test_place_v3.py).

    Returns 1 m window arrays dtm, mask, (chm, dsm), svf, opns_pos, opns_neg, vat."""
    dtm, mask = fill_heights(win["dgm_sl"], win["dgm_rlp"], RLP_OFFSET_V3_M)
    out = {"dtm": dtm, "mask": mask, **compute_relief_v3(dtm)}
    if win.get("dom_sl") is not None:
        dsm = fill_surface(win["dom_sl"], win["dom_rlp"], dtm, RLP_OFFSET_V3_M)
        out["dsm"] = dsm
        out["chm"] = np.clip(dsm - dtm, 0, 40).astype(np.float32)
    return out


def tile_files_v3(w: dict, b: int, t: tuple[int, int], e0: int, n1: int) -> dict[str, tuple[str, np.ndarray]]:
    """Encoder inputs of every file of tile t: {relative path: (format, uint8 array)}. `w` = process_tile_v3 output.
    Level 0: 4 chunks (dtm 502² apron 1 from the real neighbouring terrain, u8 layers 500²); level 1: the tile itself
    (dtm 502² of 2 m block means incl. a 2 m apron, vat 500² block mean of the 1 m VAT)."""
    from grid import FIXED_RANGES, tile_cell, tile_chunks
    from levels import block_mean
    files: dict[str, tuple[str, np.ndarray]] = {}
    for n, (i, j) in enumerate(tile_chunks(t, e0, n1)):
        ox, oy = b + (n % 2) * 500, b + (n // 2) * 500
        files[f"dtm/{i}_{j}.webp"] = ("webp", terrarium_encode(w["dtm"][oy - 1:oy + 501, ox - 1:ox + 501]))
        for k in V3_LAYER_ORDER:
            if k not in w:
                continue
            lo, hi = FIXED_RANGES[k]
            files[f"relief/{k}/{i}_{j}.{V3_LAYERS[k]}"] = (V3_LAYERS[k],
                                                          u8_encode(w[k][oy:oy + 500, ox:ox + 500], lo, hi))
    I, J = tile_cell(t, e0, n1)
    d1 = block_mean(w["dtm"][b - 2:b + 1002, b - 2:b + 1002], 2)
    files[f"levels/1/dtm/{I}_{J}.webp"] = ("webp", terrarium_encode(d1))
    files[f"levels/1/vat/{I}_{J}.avif"] = ("avif", u8_encode(block_mean(w["vat"][b:b + 1000, b:b + 1000], 2), 0, 1))
    return files


def write_files_v3(out: Path, files: dict[str, tuple[str, np.ndarray]]) -> dict:
    from encode import save_avif_u8, save_webp_lossless
    st = {"bytes": 0, "avif_max_err": 0, "avif_requality": 0}
    for rel, (fmt, arr) in files.items():
        if fmt == "webp":
            st["bytes"] += save_webp_lossless(out / rel, arr)
        else:
            r = save_avif_u8(out / rel, arr)
            st["bytes"] += r["bytes"]
            st["avif_max_err"] = max(st["avif_max_err"], r["max_err"])
            st["avif_requality"] += r["quality"] != 90
    return st


def read_sources(tiles: list, box: tuple[int, int, int, int], with_dsm: bool) -> dict:
    """Raw (unfilled) SL / RLP mosaics of DGM1 (+ DOM1) over `box`, reading only `tiles`."""
    sl_p, rlp_p = tile_paths("dgm1", tiles)
    if not sl_p and not rlp_p:
        sys.exit("no DGM1 tiles found – run fetch.py first")
    src = {"paths": {"dgm1": (sl_p, rlp_p)}}
    src["dgm_sl"], src["sl_used"] = read_mosaic(sl_p, box)
    src["dgm_rlp"] = read_mosaic(rlp_p, box)[0] if rlp_p else np.full_like(src["dgm_sl"], np.nan)
    if with_dsm:
        dsl_p, drlp_p = tile_paths("dom1", tiles)
        if dsl_p or drlp_p:
            src["paths"]["dom1"] = (dsl_p, drlp_p)
            src["dom_sl"] = read_mosaic(dsl_p, box)[0] if dsl_p else np.full_like(src["dgm_sl"], np.nan)
            src["dom_rlp"] = read_mosaic(drlp_p, box)[0] if drlp_p else np.full_like(src["dgm_sl"], np.nan)
    return src


def window_of(src: dict, box: tuple[int, int, int, int], wbox: tuple[int, int, int, int]) -> dict:
    r0, c0 = box[3] - wbox[3], wbox[0] - box[0]
    h, w = wbox[3] - wbox[1], wbox[2] - wbox[0]
    return {k: src[k][r0:r0 + h, c0:c0 + w] for k in ("dgm_sl", "dgm_rlp", "dom_sl", "dom_rlp") if k in src}


def _tile_job_v3(tile, win, b, e0, n1, out):
    """Worker: compute + write one tile; returns its 1 m core rasters for the work GeoTIFFs."""
    w = process_tile_v3(win, b)
    st = write_files_v3(Path(out), tile_files_v3(w, b, tile, e0, n1))
    core = {k: w[k][b:b + 1000, b:b + 1000].copy() for k in ("dtm", "mask", "vat", "dsm") if k in w}
    return tile, core, st


def build_v3(aoi, no_dsm: bool = False, no_previews: bool = False, workers: int = 4) -> dict:
    """v3 place build: only the present (owned) tiles, each computed from its own source window (tile ± buffer_m),
    WebP lossless / AVIF chunks, fixed u8 ranges, presence bitmap, level 0 + 1, `derived` relief modes, no dsm."""
    from common import PIPELINE_VERSION
    from grid import GRID, presence_bitmap
    from levels import level0_entry
    T0 = time.time()
    b = aoi.buffer_m
    tiles = sorted(aoi.owned, key=lambda t: (-t[1], t[0]))
    fetch = aoi.tiles(buffered=True)
    box = aoi.buffered
    cs = aoi.chunk_size
    nx, ny = aoi.width // cs, aoi.height // cs
    log(f"v3 place {aoi.place} ({aoi.key}): {len(tiles)} tiles in {aoi.width // 1000}×{aoi.height // 1000} km "
        f"rectangle {aoi.e0},{aoi.n0}; fetch set {len(fetch)} tiles")
    t = time.time()
    src = read_sources(fetch, box, with_dsm=not no_dsm)
    log("read sources", t)
    out = aoi.data_dir
    for sub in ("dtm", "dsm", "levels"):
        shutil.rmtree(out / sub, ignore_errors=True)
    for k in LAYER_META:
        shutil.rmtree(out / "relief" / k, ignore_errors=True)

    # whole-rectangle work rasters (for osm/buildings/trees/detect/xyz): global fill, present tiles overwritten
    # with their window values (identical except in gap-filled cells)
    work = WORK_DIR / aoi.key
    work.mkdir(parents=True, exist_ok=True)
    dtm_all, mask_all = fill_heights(src["dgm_sl"], src["dgm_rlp"], RLP_OFFSET_V3_M)
    has_dsm = "dom_sl" in src
    dsm_all = fill_surface(src["dom_sl"], src["dom_rlp"], dtm_all, RLP_OFFSET_V3_M) if has_dsm else None
    vat_all = np.full(dtm_all.shape, np.nan, np.float32)

    t = time.time()
    lo_h, hi_h = math.inf, -math.inf
    stats = {"bytes": 0, "avif_max_err": 0, "avif_requality": 0}
    jobs = ((tile, window_of(src, box, tile_window(tile, b)), b, aoi.e0, aoi.n1, str(out)) for tile in tiles)
    with ProcessPoolExecutor(max_workers=max(1, workers)) as ex:
        for n, (tile, core, st) in enumerate(ex.map(_tile_job_v3, *zip(*jobs))):
            for k, v in st.items():
                stats[k] = max(stats[k], v) if k == "avif_max_err" else stats[k] + v
            lo_h, hi_h = min(lo_h, float(core["dtm"].min())), max(hi_h, float(core["dtm"].max()))
            r0, c0 = box[3] - (tile[1] + 1) * 1000, tile[0] * 1000 - box[0]
            dst = (slice(r0, r0 + 1000), slice(c0, c0 + 1000))
            dtm_all[dst], mask_all[dst], vat_all[dst] = core["dtm"], core["mask"], core["vat"]
            if has_dsm:
                dsm_all[dst] = core["dsm"]
            if n % 10 == 9 or n == len(tiles) - 1:
                log(f"  {n + 1}/{len(tiles)} tiles, {stats['bytes'] / 1e6:.1f} MB", t)
    crop = (slice(b, b + aoi.height), slice(b, b + aoi.width))
    work_rasters = {"dtm": dtm_all[crop], "mask": mask_all[crop], "vat": vat_all[crop]}
    if has_dsm:
        work_rasters["dsm"] = dsm_all[crop]
        work_rasters["chm"] = np.clip(dsm_all[crop] - dtm_all[crop], 0, 40).astype(np.float32)
    for k, v in work_rasters.items():
        write_geotiff(work / f"{k}.tif", v, aoi.e0, aoi.n1)

    # --- manifest -----------------------------------------------------------------------------------------
    tr = Transformer.from_crs("EPSG:25832", "EPSG:4326", always_xy=True)
    corners = [tr.transform(e, n) for e in (aoi.e0, aoi.e1) for n in (aoi.n0, aoi.n1)]
    lons, lats = [c[0] for c in corners], [c[1] for c in corners]
    own = set(tiles)
    sources = []
    for product, (sl_p, rlp_p) in src["paths"].items():
        for (e, n) in sorted(sl_p):
            sources.append({"tile": f"{e}_{n}", "provider": "LVGL-SL", "year": 2025, "product": product.upper(),
                            "role": "aoi" if (e, n) in own else "buffer"})
        for (e, n), p in sorted(rlp_p.items()):
            sources.append({"tile": f"{e}_{n}", "provider": "LVermGeo-RP", "year": int(p.stem.rsplit("_", 1)[-1]),
                            "product": product.upper(), "role": "aoi" if (e, n) in own else "buffer"})
    rlp_used = bool((mask_all == 0.5).any())
    attribution = [ATTRIBUTION_SL] + ([ATTRIBUTION_RLP] if rlp_used else [])
    layers = {k: v3_layer_entry(k, f"relief/{k}/{{i}}_{{j}}.{V3_LAYERS[k]}") for k in V3_LAYER_ORDER
              if k != "chm" or has_dsm}
    manifest = {
        "version": 3, "aoi": aoi.place, "name": aoi.name, "place": {"id": aoi.place, "ags": aoi.ags},
        "crs": "EPSG:25832", "grid": GRID,
        "origin": {"E0": aoi.e0, "N0": aoi.n0}, "size": {"width": aoi.width, "height": aoi.height},
        "cellSize": 1, "chunkSize": cs, "chunks": {"nx": nx, "ny": ny},
        "presence": presence_bitmap(aoi.e0, aoi.n0, aoi.width, aoi.height, tiles),
        "heightRange": {"min": round(lo_h, 2), "max": round(hi_h, 2)},
        "wgs84Bounds": [[round(min(lats), 6), round(min(lons), 6)], [round(max(lats), 6), round(max(lons), 6)]],
        "height": {"dtm": {"path": "dtm/{i}_{j}.webp", "encoding": "terrarium", "apron": 1}},
        "layers": layers,
        "derived": V3_DERIVED,
    }
    vat1 = {**{k: v for k, v in v3_layer_entry("vat", "levels/1/vat/{i}_{j}.avif").items() if k != "description"},
            "description": "Blockmittel (2 m) der 1-m-VAT (RVT, kombiniert allgemein+flach)"}
    level1 = {"level": 1, "cellSize": 2, "chunkSize": cs, "size": {"width": aoi.width // 2, "height": aoi.height // 2},
              "chunks": {"nx": aoi.width // 1000, "ny": aoi.height // 1000},
              "height": {"dtm": {"path": "levels/1/dtm/{i}_{j}.webp", "encoding": "terrarium", "apron": 1}},
              "layers": {"vat": vat1}}
    manifest["levels"] = [level0_entry(manifest), level1]
    manifest["sources"] = sources
    manifest["build"] = {
        "pipeline": PIPELINE_VERSION, "generated": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "proj4": UTM32_PROJ4,
        "verticalDatum": "DHHN2016 (EPSG:7837)", "bufferM": b, "tiles": len(tiles),
        "params": {k: PARAMS[k] for k in ("svf", "openness", "vat", "chm")},
        "rlpOffset": {"applied": RLP_OFFSET_V3_M, "note": "fixed constant in v3 (locality)"},
        "encoding": {"webp": "lossless exact method 6", "avif_u8_quality": 90,
                     "avif_max_err": stats["avif_max_err"], "avif_requality_files": stats["avif_requality"]},
        "timingsS": {"total": round(time.time() - T0, 1)},
    }
    # foreign layers (bldg, ortho, hist_*) and keys of later steps survive a rebuild (per-sub-key merge)
    manifest = update_manifest(out, manifest, attribution=attribution,
                               drop_attribution=[ATTRIBUTION_SL, ATTRIBUTION_RLP], own_layers=list(LAYER_META))
    (work / "build.json").write_text(json.dumps(manifest["build"], indent=2, ensure_ascii=False))
    if not no_previews:
        PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
        v = work_rasters["vat"]
        f = max(1, round(max(v.shape) / 1500))
        img = downsample_mean(np.where(np.isfinite(v), v, 0.5), f)
        Image.fromarray(np.rint(np.clip(img, 0, 1) * 255).astype(np.uint8)).save(
            PREVIEW_DIR / f"{aoi.key}_vat.jpg", quality=72, optimize=True)
    size = sum(f.stat().st_size for f in out.rglob("*") if f.is_file() and "xyz" not in f.parts)
    log(f"wrote {out} ({size / 1e6:.1f} MB excl. xyz, {size / 1e6 / len(tiles):.2f} MB/km² so far), "
        f"{len(tiles)} tiles", T0)
    return manifest


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("aoi")
    ap.add_argument("--no-dsm", action="store_true")
    ap.add_argument("--no-previews", action="store_true")
    ap.add_argument("--levels", type=int, default=N_LEVELS, help="coarse overview levels (0 = v1 manifest)")
    ap.add_argument("--workers", type=int, default=4, help="v3 places: parallel tile processes")
    args = ap.parse_args()
    aoi = load_aoi(args.aoi)
    if aoi.fmt == 3:
        build_v3(aoi, no_dsm=args.no_dsm, no_previews=args.no_previews, workers=args.workers)
        return
    T0 = time.time()
    timings = {}
    b = aoi.buffer_m
    box = aoi.buffered
    tiles = aoi.tiles(buffered=True)
    log(f"AOI {aoi.key}: {aoi.width}×{aoi.height} cells, buffered box {box}, {len(tiles)} tiles")

    # --- mosaic + fill -------------------------------------------------------------------
    t = time.time()
    sl_p, rlp_p = tile_paths("dgm1", tiles)
    if not sl_p:
        sys.exit("no LVGL DGM1 tiles found – run fetch.py first")
    dtm_sl, sl_used = read_mosaic(sl_p, box)
    dtm_rlp, _ = read_mosaic(rlp_p, box) if rlp_p else (np.full_like(dtm_sl, np.nan), [])
    off = rlp_offset(dtm_sl, dtm_rlp)
    log(f"DTM: SL nodata {np.isnan(dtm_sl).mean():.2%} of buffered box; RLP overlap {off}")
    mask = np.zeros_like(dtm_sl)
    use_rlp = ~np.isfinite(dtm_sl) & np.isfinite(dtm_rlp)
    dtm = np.where(use_rlp, dtm_rlp + off["applied"], dtm_sl)
    mask[use_rlp] = 0.5
    gap = ~np.isfinite(dtm)
    mask[gap] = 1.0
    dtm = fill_nearest(dtm)
    rlp_used = [("DGM1",) + u for u in tiles_used(rlp_p, use_rlp, box)]
    fill_stats = {
        "buffered": {"rlp_px": int(use_rlp.sum()), "interpolated_px": int(gap.sum())},
        "aoi": {"rlp_px": int(use_rlp[b:b + aoi.height, b:b + aoi.width].sum()),
                "interpolated_px": int(gap[b:b + aoi.height, b:b + aoi.width].sum())},
    }
    log(f"DTM fill: {fill_stats}")

    dsm = None
    dsm_info = None
    if not args.no_dsm:
        dsl_p, drlp_p = tile_paths("dom1", tiles)
        if dsl_p:
            dsm_sl, _ = read_mosaic(dsl_p, box)
            dsm_rlp, _ = read_mosaic(drlp_p, box) if drlp_p else (np.full_like(dsm_sl, np.nan), [])
            use = ~np.isfinite(dsm_sl) & np.isfinite(dsm_rlp)
            dsm = np.where(use, dsm_rlp + off["applied"], dsm_sl)
            dsm = np.where(np.isfinite(dsm), dsm, dtm)  # remaining gaps: bare earth
            dsm = np.maximum(dsm, dtm - 0.5)  # guard against negative CHM from mixed sources
            dsm_info = {"rlp_px": int(use.sum())}
            rlp_used += [("DOM1",) + u for u in tiles_used(drlp_p, use, box)]
    timings["mosaic_fill"] = round(time.time() - t, 1)

    # --- relief -------------------------------------------------------------------------
    t = time.time()
    log("relief (buffered):")
    rel = compute_relief(dtm)
    timings["relief"] = round(time.time() - t, 1)

    # buffered VAT for checking seams/fill in the buffer ring (not shipped)
    WORK_DIR.joinpath(aoi.key).mkdir(parents=True, exist_ok=True)
    fb = max(1, round(max(rel["vat"].shape) / 1700))
    Image.fromarray(np.rint(np.clip(downsample_mean(rel["vat"], fb), 0, 1) * 255).astype(np.uint8)).save(
        WORK_DIR / aoi.key / "vat_buffered.jpg", quality=80)

    crop = (slice(b, b + aoi.height), slice(b, b + aoi.width))
    A = {k: v[crop] for k, v in rel.items()}
    A["dtm"] = dtm[crop]
    A["mask"] = mask[crop]
    if dsm is not None:
        A["dsm"] = dsm[crop]
        A["chm"] = np.clip(A["dsm"] - A["dtm"], 0, 40).astype(np.float32)
    assert A["dtm"].shape == (aoi.height, aoi.width)

    # --- work rasters ---------------------------------------------------------------------
    t = time.time()
    work = WORK_DIR / aoi.key
    for k, v in A.items():
        write_geotiff(work / f"{k}.tif", v, aoi.e0, aoi.n1)
    timings["work_tifs"] = round(time.time() - t, 1)

    # --- ranges -----------------------------------------------------------------------------
    layer_keys = ["hillshade", "slope", "slrm", "svf", "opns_pos", "opns_neg", "vat"] + \
                 (["chm"] if "chm" in A else []) + ["mask"]
    ranges, stats = {}, {}
    for k in layer_keys:
        lo, hi, st = choose_range(k, A[k])
        ranges[k] = (lo, hi)
        stats[k] = st
        log(f"  {k:9s} range [{lo}, {hi}]   pct {st}")
    s98 = max(abs(v) for v in pct(A["slrm"], [2, 98]))
    ranges["slrm_display"] = (-round(max(0.3, s98), 1), round(max(0.3, s98), 1))

    # --- chunks -----------------------------------------------------------------------------
    t = time.time()
    out = APP_DATA / aoi.key
    clear_build_outputs(out)
    cs = aoi.chunk_size
    nx, ny = aoi.width // cs, aoi.height // cs
    for j in range(ny):
        for i in range(nx):
            save_png(out / "dtm" / f"{i}_{j}.png", terrarium_encode(height_chunk(A["dtm"], i, j, cs)))
            if "dsm" in A:
                save_png(out / "dsm" / f"{i}_{j}.png", terrarium_encode(height_chunk(A["dsm"], i, j, cs)))
            for k in layer_keys:
                lo, hi = ranges[k]
                save_png(out / "relief" / k / f"{i}_{j}.png", u8_encode(layer_chunk(A[k], i, j, cs), lo, hi))
    timings["chunks"] = round(time.time() - t, 1)

    # --- manifest ---------------------------------------------------------------------------
    tr = Transformer.from_crs("EPSG:25832", "EPSG:4326", always_xy=True)
    corners = [tr.transform(e, n) for e in (aoi.e0, aoi.e1) for n in (aoi.n0, aoi.n1)]
    lons, lats = [c[0] for c in corners], [c[1] for c in corners]
    aoi_tiles = set(aoi.tiles(buffered=False))
    sources = [{"tile": f"{e}_{n}", "provider": "LVGL-SL", "year": 2025, "product": "DGM1",
                "role": "aoi" if (e, n) in aoi_tiles else "buffer"} for e, n in sl_used]
    if dsm is not None:
        sources += [{"tile": f"{e}_{n}", "provider": "LVGL-SL", "year": 2025, "product": "DOM1",
                     "role": "aoi" if (e, n) in aoi_tiles else "buffer"} for e, n in sorted(dsl_p)]
    for product, (e, n), p, px in rlp_used:
        year = int(p.stem.rsplit("_", 1)[-1])
        sources.append({"tile": f"{e}_{n}", "provider": "LVermGeo-RP", "year": year, "product": product,
                        "role": "aoi" if (e, n) in aoi_tiles else "buffer", "filled_px": px})
    attribution = [ATTRIBUTION_SL] + ([ATTRIBUTION_RLP] if rlp_used else [])

    layers = {}
    for k in layer_keys:
        label, unit, desc = LAYER_META[k]
        lo, hi = ranges[k]
        entry = {"path": f"relief/{k}/{{i}}_{{j}}.png", "encoding": "u8", "min": lo, "max": hi}
        if unit:
            entry["unit"] = unit
        entry["label_de"] = label
        entry["description"] = desc
        layers[k] = entry
    height = {"dtm": {"path": "dtm/{i}_{j}.png", "encoding": "terrarium", "apron": 1}}
    if "dsm" in A:
        height["dsm"] = {"path": "dsm/{i}_{j}.png", "encoding": "terrarium", "apron": 1}
    manifest = {
        "version": 2 if args.levels > 0 else 1,
        "aoi": aoi.key,
        "name": aoi.name,
        "crs": "EPSG:25832",
        "origin": {"E0": aoi.e0, "N0": aoi.n0},
        "size": {"width": aoi.width, "height": aoi.height},
        "cellSize": 1,
        "chunkSize": cs,
        "chunks": {"nx": nx, "ny": ny},
        "heightRange": {"min": round(float(A["dtm"].min()), 2), "max": round(float(A["dtm"].max()), 2)},
        "wgs84Bounds": [[round(min(lats), 6), round(min(lons), 6)], [round(max(lats), 6), round(max(lons), 6)]],
        "height": height,
        "layers": layers,
    }
    # --- overview levels (contract v2) -----------------------------------------------------
    if args.levels > 0:
        t = time.time()
        coarse = write_levels(out, A["dtm"], {k: A[k] for k in ("vat", "hillshade")}, layers, n_levels=args.levels,
                              cs=cs)
        manifest["levels"] = [level0_entry(manifest)] + coarse
        timings["levels"] = round(time.time() - t, 1)
        log(f"levels 1…{args.levels}: " + ", ".join(f"{e['cellSize']} m {e['chunks']['nx']}×{e['chunks']['ny']}"
                                                   for e in coarse), t)
    else:
        shutil.rmtree(out / "levels", ignore_errors=True)
    manifest["sources"] = sources
    manifest["build"] = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "proj4": UTM32_PROJ4,
        "verticalDatum": "DHHN2016 (EPSG:7837)",
        "bufferM": b,
        "params": PARAMS,
        "layerStats": stats,
        "slrmDisplayRange": list(ranges["slrm_display"]),
        "rlpOffset": off,
        "fill": fill_stats,
        "dsmFill": dsm_info,
        "dsmRange": {"min": round(float(A["dsm"].min()), 2), "max": round(float(A["dsm"].max()), 2)}
        if "dsm" in A else None,
        "timingsS": timings,
    }
    # read–modify–write: keys owned by other steps (xyz, vectors, models, candidates, …) survive a rebuild;
    # `xyz` is dropped only when its tiles are gone. Attribution entries of other steps are kept.
    manifest = update_manifest(out, manifest, attribution=attribution,
                               drop_attribution=[ATTRIBUTION_SL, ATTRIBUTION_RLP],
                               remove=([] if (out / "xyz").exists() else ["xyz"])
                               + ([] if args.levels > 0 else ["levels"]),
                               # per-sub-key merge (contract): keep foreign `layers`/`levels[k].layers` entries
                               # (bldg, ortho, hist_*, …) written by buildings/ortho/historic
                               own_layers=LAYER_META)
    (work / "build.json").write_text(json.dumps(manifest["build"], indent=2, ensure_ascii=False))

    if not args.no_previews:
        t = time.time()
        save_previews(aoi, A, ranges)
        timings["previews"] = round(time.time() - t, 1)
    size = sum(f.stat().st_size for f in out.rglob("*") if f.is_file() and "xyz" not in f.parts)
    log(f"wrote {out} ({size / 1e6:.1f} MB excl. xyz), {nx}×{ny} chunks", T0)


if __name__ == "__main__":
    main()
