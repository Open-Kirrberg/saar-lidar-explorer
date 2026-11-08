"""Historic forest mask `forest_hist` (contract "Historic forest mask"): where the historic maps show forest.

Usage:  uv run python historic_forest.py <aoi> [--sample N] [--no-manifest]

Input: the 1 m RGBA mosaics that historic.py keeps in data/work/<aoi>/hist_<year>.tif (WMS SL Historische Karten,
LVGL-SL). Output: one u8 PNG on a 5 m grid over the AOI, `forest_hist/forest_hist.png`, plus the manifest key
`forest_hist` and a local review report data/work/<aoi>/forest_hist.json (+ forest_hist_preview.png).

Value per 5 m cell (u8): bit 0 = forest on the 1836–41 map, bit 1 = forest on the TK25 1935–40, bit 2 = the 1836–41
map has no image here, bit 3 = the TK25 1935–40 has no image here; 255 = outside the AOI. Bits of an epoch whose
manifest entry says `classified: false` are always 0 and mean "unknown", never "no forest".

Method `hist-forest-symbols-v1`:
- TK25 1935–40 (layer 5): forest is drawn with tree symbols, broadleaf as a small open ring on two feet ("Ω",
  ≈ 20–28 m across at 1 m/px), conifer as "Λ". The ring is found by normalised cross-correlation (scikit-image
  match_template) of the paper-normalised grey image with a synthetic Ω at three sizes; peaks ≥ NCC_MIN that stand on
  textured paper (local std ≥ STD_MIN, NCC is meaningless on blank paper) and ≥ PEAK_SEP_PX apart count as symbols.
  Symbol density (Gaussian, σ = SIGMA_M) ≥ DENSITY_MIN per ha → forest; parts < MIN_PART_HA dropped, holes
  < MIN_HOLE_HA closed. Conifer Λ, orchards, text and dense hatching are not modelled: Λ-only stands are missed and
  ring-like glyphs elsewhere add noise (accuracy in forest_hist.json and the manifest).
- Bayerische Originalpositionsblätter 1836–41 (layer 1): the scan shows relief hachures, water, roads, buildings,
  boundaries and names, but **no area signature for forest** (checked on crops of named forests such as the
  Vierherrenwald and of today's old forests; the paper tint separates today's forest from open land only with
  AUC 0.55–0.74, confounded by sheet edges and hachure density). So 1840 is `classified: false` and bit 0 stays 0.

Licence: the maps are dl-de/by-2-0 (LVGL-SL, WMS id 2597); this derived mask carries the same Quellenvermerk.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import sys
import time
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import numpy as np

from common import APP_DATA, WORK_DIR, fmt_bytes, load_aoi, update_manifest

FORMAT = "sle-forest-hist-v1"
METHOD = "hist-forest-symbols-v1"
CELL_M = 5
NODATA = 255
BIT_FOREST = {1840: 1, 1935: 2}
BIT_NOMAP = {1840: 4, 1935: 8}
PATH = "forest_hist/forest_hist.png"
ATTRIBUTION_HIST = "© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet (Historische Karten)"
EPOCHS: dict[int, dict[str, Any]] = {
    1840: {"key": "hist_1840", "label_de": "Wald 1836–41", "map_de": "Bayer. Positionsblätter 1:25 000 (1836–41)",
           "wms_layer": "1", "classified": False,
           "note": "Karte ohne Waldsignatur (nur Schraffen, Grenzen, Namen): nicht auswertbar"},
    1935: {"key": "hist_1935", "label_de": "Wald 1935–40", "map_de": "TK25, Ausgaben 1935–40",
           "wms_layer": "5", "classified": True,
           "note": "Baumsignaturen automatisch erkannt (Schätzung)"},
}

# --- detector parameters (1 m/px input) ------------------------------------------------------------------------
PAPER_PCT, PAPER_WIN_PX, PAPER_STRIDE = 90, 15, 4   # local paper brightness: 90th pct in 60 m windows
RING_R_PX, RING_W_PX, RING_GAP_DEG = 10.5, 3.5, 25.0  # synthetic Ω: ring radius, stroke, bottom gap half-angle
SCALES = (0.85, 1.0, 1.15)
NCC_MIN = 0.45
STD_MIN = 0.12            # local std of the paper-normalised grey (template window); blank paper ≈ 0.02
PEAK_SEP_PX = 10
SIGMA_M = 50.0
DENSITY_MIN = 0.7         # symbols per ha: forest ≈ 1–2 rings per ha, ≈ 1 in 2 found; one lone ring peaks at 0.64
MIN_PART_HA = 1.0
MIN_HOLE_HA = 0.5
LAMBDA_H_PX, LAMBDA_HALF_W_PX, LAMBDA_W_PX = 17.0, 3.5, 2.6   # synthetic conifer Λ: height, half base, stroke
NCC_MIN_LAMBDA = 0.6      # stricter: a narrow Λ also resembles bits of contour lines


# =================================================================================================== pure
def omega_template(scale: float = 1.0) -> np.ndarray:
    """Synthetic TK25 broadleaf symbol on paper (1 = paper, 0 = ink), lightly blurred like the scan."""
    from scipy import ndimage as ndi
    r, w = RING_R_PX * scale, RING_W_PX * scale
    k = int(math.ceil(r + w + 3))
    yy, xx = np.mgrid[-k:k + 1, -k:k + 1].astype(np.float64)
    d = np.hypot(yy, xx)
    ang = np.degrees(np.arctan2(xx, yy))          # 0° = straight down
    ink = (np.abs(d - r) <= w / 2) & (np.abs(ang) > RING_GAP_DEG)
    foot_y = r * math.cos(math.radians(RING_GAP_DEG))
    gx = r * math.sin(math.radians(RING_GAP_DEG))
    feet = (np.abs(yy - foot_y) <= w / 2) & (np.abs(xx) >= gx - w / 2) & (np.abs(xx) <= gx + 1.2 * w)
    t = 1.0 - (ink | feet).astype(np.float64)
    return ndi.gaussian_filter(t, 0.8)


def lambda_template(scale: float = 1.0) -> np.ndarray:
    """Synthetic TK25 conifer symbol: a narrow Λ with a short foot to the right (1 = paper, 0 = ink), blurred."""
    from scipy import ndimage as ndi
    h, b, w = LAMBDA_H_PX * scale, LAMBDA_HALF_W_PX * scale, LAMBDA_W_PX * scale
    k = int(math.ceil(h / 2 + w + 3))
    yy, xx = np.mgrid[-k:k + 1, -k:k + 1].astype(np.float64)
    top, bot = -h / 2, h / 2
    ink = np.zeros(yy.shape, bool)
    for sgn in (-1.0, 1.0):   # stroke from the apex (0, top) to (sgn·b, bot): distance to the segment
        ax, ay, bx, by = 0.0, top, sgn * b, bot
        tt = np.clip(((xx - ax) * (bx - ax) + (yy - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2), 0, 1)
        ink |= np.hypot(xx - (ax + tt * (bx - ax)), yy - (ay + tt * (by - ay))) <= w / 2
    ink |= (np.abs(yy - bot) <= w / 2) & (xx >= b - w / 2) & (xx <= b + 2.2 * w)
    return ndi.gaussian_filter(1.0 - ink.astype(np.float64), 0.8)


def paper_normalised(lum: np.ndarray) -> np.ndarray:
    """Grey value ÷ local paper brightness (sheet tints differ: yellow, orange, white), clipped to 0…1.2."""
    from scipy import ndimage as ndi
    small = lum[::PAPER_STRIDE, ::PAPER_STRIDE]
    paper = ndi.percentile_filter(small, PAPER_PCT, size=PAPER_WIN_PX)
    paper = ndi.zoom(paper, PAPER_STRIDE, order=1)[:lum.shape[0], :lum.shape[1]]
    if paper.shape != lum.shape:   # zoom rounding: pad by edge values
        paper = np.pad(paper, [(0, lum.shape[0] - paper.shape[0]), (0, lum.shape[1] - paper.shape[1])], mode="edge")
    return np.clip(lum / np.maximum(paper, 1.0), 0.0, 1.2).astype(np.float32)


def detect_symbols(g: np.ndarray, valid: np.ndarray | None = None) -> np.ndarray:
    """Tree-symbol positions (row, col) in a paper-normalised grey image (pure): broadleaf Ω (NCC ≥ NCC_MIN) and
    conifer Λ (NCC ≥ NCC_MIN_LAMBDA), both on textured paper; the score is NCC − its class threshold."""
    from scipy import ndimage as ndi
    from skimage.feature import match_template, peak_local_max
    best = np.full(g.shape, -1.0, np.float32)
    for make, thr in ((omega_template, NCC_MIN), (lambda_template, NCC_MIN_LAMBDA)):
        for s in SCALES:
            t = make(s).astype(np.float32)
            if min(g.shape) <= max(t.shape):
                continue
            best = np.maximum(best, match_template(g, t, pad_input=True).astype(np.float32) - thr)
    k = omega_template(1.0).shape[0]
    mean = ndi.uniform_filter(g, k)
    std = np.sqrt(np.maximum(ndi.uniform_filter(g * g, k) - mean * mean, 0.0))
    best[std < STD_MIN] = -1.0
    if valid is not None:
        best[~valid] = -1.0
    pk = peak_local_max(best, min_distance=PEAK_SEP_PX, threshold_abs=0.0, exclude_border=False)
    return pk.astype(np.int64).reshape(-1, 2)


def density_per_ha(points: np.ndarray, shape_px: tuple[int, int], cell_px: int = CELL_M,
                   sigma_m: float = SIGMA_M) -> np.ndarray:
    """Gaussian-smoothed point density (points per ha) on the cell grid (1 px = 1 m). Pure."""
    from scipy import ndimage as ndi
    h, w = math.ceil(shape_px[0] / cell_px), math.ceil(shape_px[1] / cell_px)
    cnt = np.zeros((h, w), np.float64)
    if len(points):
        np.add.at(cnt, (points[:, 0] // cell_px, points[:, 1] // cell_px), 1.0)
    return ndi.gaussian_filter(cnt, sigma_m / cell_px, mode="constant") * (1e4 / cell_px ** 2)


def clean_mask(m: np.ndarray, cell_m: int = CELL_M, min_part_ha: float = MIN_PART_HA,
               min_hole_ha: float = MIN_HOLE_HA) -> np.ndarray:
    """Drop forest parts below min_part_ha and close holes below min_hole_ha (8-connected parts). Pure."""
    from scipy import ndimage as ndi
    cell_ha = cell_m * cell_m / 1e4
    out = m.astype(bool).copy()
    lab, n = ndi.label(out, structure=np.ones((3, 3)))
    if n:
        size = ndi.sum(out, lab, index=np.arange(1, n + 1)) * cell_ha
        out = np.isin(lab, np.flatnonzero(size >= min_part_ha) + 1)
    lab, n = ndi.label(~out)
    if n:
        size = ndi.sum(~out, lab, index=np.arange(1, n + 1)) * cell_ha
        border = set(np.unique(np.r_[lab[0], lab[-1], lab[:, 0], lab[:, -1]]).tolist())
        small = [i + 1 for i in np.flatnonzero(size < min_hole_ha) if i + 1 not in border]
        out |= np.isin(lab, small)
    return out


def cell_fraction(mask_px: np.ndarray, cell_px: int = CELL_M) -> np.ndarray:
    """Share of 1 m pixels set per cell (cells at the edge average over their pixels). Pure."""
    h, w = mask_px.shape
    H, W = math.ceil(h / cell_px), math.ceil(w / cell_px)
    pad = np.zeros((H * cell_px, W * cell_px), np.float64)
    cnt = np.zeros_like(pad)
    pad[:h, :w] = mask_px
    cnt[:h, :w] = 1.0
    s = pad.reshape(H, cell_px, W, cell_px).sum((1, 3))
    c = cnt.reshape(H, cell_px, W, cell_px).sum((1, 3))
    return s / np.maximum(c, 1.0)


def encode(forest: Mapping[int, np.ndarray | None], nomap: Mapping[int, np.ndarray | None],
           shape: tuple[int, int]) -> np.ndarray:
    """Pack the per-epoch cell masks into the contract's u8 (bits 0/1 forest 1840/1935, 2/3 no map). Pure."""
    v = np.zeros(shape, np.uint8)
    for year in BIT_FOREST:
        f, nm = forest.get(year), nomap.get(year)
        if nm is not None:
            v |= np.where(nm, BIT_NOMAP[year], 0).astype(np.uint8)
        if f is not None:
            v |= np.where(f & ~(nm if nm is not None else False), BIT_FOREST[year], 0).astype(np.uint8)
    return v


def decode(v: int) -> dict[str, Any]:
    """App-side reading of one cell value (reference for the contract text). Pure."""
    if v == NODATA:
        return {"nodata": True}
    out: dict[str, Any] = {"nodata": False}
    for year in BIT_FOREST:
        out[year] = None if v & BIT_NOMAP[year] else bool(v & BIT_FOREST[year])
    return out


def cell_center(aoi_e0: int, aoi_n1: int, px: int, py: int, cell: int = CELL_M) -> tuple[float, float]:
    """Centre (E, N) of mask pixel (px, py): row 0 = north edge of the AOI. Pure."""
    return aoi_e0 + (px + 0.5) * cell, aoi_n1 - (py + 0.5) * cell


def precision_recall(pred: Sequence[bool], truth: Sequence[bool | None]) -> dict[str, Any]:
    """Precision / recall / accuracy of `pred` against labels (None = unsure, skipped). Pure."""
    pairs = [(bool(p), bool(t)) for p, t in zip(pred, truth) if t is not None]
    tp = sum(p and t for p, t in pairs)
    fp = sum(p and not t for p, t in pairs)
    fn = sum((not p) and t for p, t in pairs)
    tn = sum((not p) and not t for p, t in pairs)
    n = len(pairs)
    return {"n": n, "tp": tp, "fp": fp, "fn": fn, "tn": tn,
            "precision": round(tp / (tp + fp), 3) if tp + fp else None,
            "recall": round(tp / (tp + fn), 3) if tp + fn else None,
            "accuracy": round((tp + tn) / n, 3) if n else None,
            "unsure": sum(t is None for t in truth)}


# =================================================================================================== I/O
def read_hist(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """1 m RGBA mosaic → (grey lum float32, alpha>0 bool)."""
    import rasterio
    with rasterio.open(path) as ds:
        a = ds.read()
    lum = a[:3].astype(np.float32).mean(0)
    return lum, a[3] > 0


def classify_1935(path: Path) -> dict[str, Any]:
    t0 = time.time()
    lum, valid = read_hist(path)
    g = paper_normalised(lum)
    pts = detect_symbols(g, valid)
    dens = density_per_ha(pts, lum.shape)
    forest = clean_mask(dens >= DENSITY_MIN)
    nomap = cell_fraction(~valid) > 0.5
    return {"forest": forest, "nomap": nomap, "density": dens, "symbols": pts,
            "seconds": round(time.time() - t0, 1)}


def write_png(path: Path, v: np.ndarray) -> int:
    from PIL import Image
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp.png")
    Image.fromarray(v, "L").save(tmp, optimize=True)
    tmp.replace(path)
    return path.stat().st_size


def sample_points(forest: np.ndarray, nomap: np.ndarray, n: int, seed: int = 7) -> list[tuple[int, int]]:
    """Random cells (py, px) with a map, stratified half predicted forest / half not (review sample)."""
    rng = np.random.default_rng(seed)
    ok = ~nomap
    out: list[tuple[int, int]] = []
    for want in (True, False):
        idx = np.argwhere(ok & (forest == want))
        if len(idx):
            take = rng.choice(len(idx), size=min(n // 2, len(idx)), replace=False)
            out += [tuple(int(v) for v in idx[i]) for i in take]
    rng.shuffle(out)
    return out


def run(aoi_key: str, write_manifest: bool = True) -> dict[str, Any]:
    aoi = load_aoi(aoi_key)
    out_dir = APP_DATA / aoi.key
    if not (out_dir / "manifest.json").exists():
        sys.exit(f"{out_dir}/manifest.json missing – run build first")
    shape = (math.ceil(aoi.height / CELL_M), math.ceil(aoi.width / CELL_M))
    forest: dict[int, np.ndarray | None] = {}
    nomap: dict[int, np.ndarray | None] = {}
    report: dict[str, Any] = {"aoi": aoi.key, "cell_m": CELL_M, "epochs": {}}
    epochs_used = []
    for year, ep in EPOCHS.items():
        tif = WORK_DIR / aoi.key / f"{ep['key']}.tif"
        if not tif.exists():
            print(f"  {ep['key']}: no data/work/{aoi.key}/{ep['key']}.tif (run historic first) → no map")
            forest[year], nomap[year] = None, np.ones(shape, bool)
            continue
        epochs_used.append(year)
        if not ep["classified"]:
            _lum, valid = read_hist(tif)
            forest[year], nomap[year] = None, cell_fraction(~valid) > 0.5
            report["epochs"][year] = {"classified": False, "no_map_pct": round(100 * float(nomap[year].mean()), 2)}
            continue
        r = classify_1935(tif)
        forest[year], nomap[year] = r["forest"], r["nomap"]
        report["epochs"][year] = {"classified": True, "symbols": int(len(r["symbols"])), "seconds": r["seconds"],
                                  "forest_pct": round(100 * float(r["forest"][~r["nomap"]].mean()), 1),
                                  "no_map_pct": round(100 * float(r["nomap"].mean()), 2)}
        np.save(WORK_DIR / aoi.key / f"forest_{year}_density.npy", r["density"].astype(np.float32))
        print(f"  {ep['key']}: {len(r['symbols'])} symbols, forest {report['epochs'][year]['forest_pct']} % "
              f"[{r['seconds']}s]")
    v = encode(forest, nomap, shape)
    nbytes = write_png(out_dir / PATH, v)
    generated = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    acc_path = WORK_DIR / aoi.key / "forest_hist_accuracy.json"
    accuracy = json.loads(acc_path.read_text()) if acc_path.exists() else {}
    entry = {
        "format": FORMAT, "path": PATH, "encoding": "u8-bits", "cellSize": CELL_M,
        "size": {"width": shape[1], "height": shape[0]}, "nodata": NODATA,
        "epochs": [{"year": y, "bit": int(math.log2(BIT_FOREST[y])), "noMapBit": int(math.log2(BIT_NOMAP[y])),
                    "key": EPOCHS[y]["key"], "label_de": EPOCHS[y]["label_de"], "map_de": EPOCHS[y]["map_de"],
                    "classified": bool(EPOCHS[y]["classified"] and y in epochs_used), "note_de": EPOCHS[y]["note"],
                    **({"accuracy": accuracy[str(y)]} if str(y) in accuracy else {})}
                   for y in EPOCHS],
        "method": METHOD, "params": {"ncc_min": NCC_MIN, "ncc_min_lambda": NCC_MIN_LAMBDA, "std_min": STD_MIN,
                                     "sigma_m": SIGMA_M,
                                     "density_min_per_ha": DENSITY_MIN, "min_part_ha": MIN_PART_HA,
                                     "min_hole_ha": MIN_HOLE_HA, "scales": list(SCALES)},
        "generated": generated, "label_de": "Historischer Wald (Schätzung)", "attribution": ATTRIBUTION_HIST,
        "source": "WMS SL Historische Karten (Geoportal Saarland, WMS-ID 2597), Layer 1 und 5",
    }
    report.update({"bytes": nbytes, "generated": generated, "value_counts": {int(k): int(c) for k, c in
                                                                              zip(*np.unique(v, return_counts=True))}})
    if write_manifest:
        update_manifest(out_dir, {"forest_hist": entry}, attribution=[ATTRIBUTION_HIST])
    (WORK_DIR / aoi.key / "forest_hist.json").write_text(json.dumps(report, indent=1) + "\n")
    print(f"wrote {PATH} ({fmt_bytes(nbytes)}), {shape[1]}×{shape[0]} cells of {CELL_M} m")
    return {"entry": entry, "report": report, "forest": forest, "nomap": nomap, "value": v}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("aoi")
    ap.add_argument("--no-manifest", action="store_true")
    args = ap.parse_args()
    run(args.aoi, write_manifest=not args.no_manifest)


if __name__ == "__main__":
    main()
