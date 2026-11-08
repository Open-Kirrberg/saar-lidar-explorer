"""Historic forest mask `forest_hist` (contract "Historic forest mask"): where the historic maps show forest.

Usage:  uv run python historic_forest.py <aoi> [--no-manifest]
        uv run python historic_forest.py --stats [--workers 2]     # stats area `orte` (no app tiles, work files only)

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

Stats area (`--stats`, Orte im Vergleich Phase 1): the nine places reach far beyond the AOI `overall`, so the TK25
1935–40 is fetched for the stats bbox (data/work/orte/gemarkungen.geojson meta.stats_bbox) as 2 km GetMap blocks on
the global 2 km grid (1 m/px, cached under data/raw/historic/orte/ with AOI-independent names, so the blocks the AOI
`overall` already has are linked, not refetched); only blocks touching a place outline + 300 m are requested. Symbols
are detected per block on a window with STATS_MARGIN_M of the neighbouring blocks (no seams: only peaks in the core
are kept), the density and mask are then computed once on the whole 5 m grid with the same parameters. Output: a
work mask data/work/orte/forest_hist.png + forest_hist.json (`entry` in the manifest format, plus E0 / N_top of the
grid), read by forest_age.py; nothing is published under app/public/data/.

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


# =================================================================================================== stats area
STATS_BLOCK_M = 2000
STATS_MARGIN_M = 250
STATS_OUTLINE_BUFFER_M = 300


def stats_blocks(bbox: Sequence[float], block: int = STATS_BLOCK_M) -> list[tuple[int, int]]:
    """Lower-left corners (E, N) of the global `block` grid cells covering `bbox` (minE, minN, maxE, maxN). Pure."""
    e0, n0, e1, n1 = bbox
    return [(e, n) for n in range(int(math.floor(n0 / block) * block), int(math.ceil(n1 / block) * block), block)
            for e in range(int(math.floor(e0 / block) * block), int(math.ceil(e1 / block) * block), block)]


def block_window(e: int, n: int, block: int = STATS_BLOCK_M, margin: int = STATS_MARGIN_M
                 ) -> tuple[list[tuple[int, int]], tuple[int, int, int, int]]:
    """Neighbour blocks needed for the window of block (e, n) and the window (minE, minN, maxE, maxN). Pure."""
    win = (e - margin, n - margin, e + block + margin, n + block + margin)
    nb = [(e + dx * block, n + dy * block) for dy in (1, 0, -1) for dx in (-1, 0, 1)]
    return nb, win


def assemble_window(blocks: Mapping[tuple[int, int], np.ndarray | None], win: Sequence[int],
                    block: int = STATS_BLOCK_M) -> np.ndarray:
    """RGBA window (1 m/px, row 0 = north) cut from a 3 × 3 neighbourhood of block images; missing blocks are
    transparent. Pure."""
    w0, s0, w1, n1 = (int(v) for v in win)
    out = np.zeros((n1 - s0, w1 - w0, 4), np.uint8)
    for (be, bn), img in blocks.items():
        if img is None:
            continue
        # block covers E be…be+block, N bn…bn+block; row 0 of the image = N bn+block
        e_lo, e_hi = max(be, w0), min(be + block, w1)
        n_lo, n_hi = max(bn, s0), min(bn + block, n1)
        if e_lo >= e_hi or n_lo >= n_hi:
            continue
        out[n1 - n_hi:n1 - n_lo, e_lo - w0:e_hi - w0] = img[bn + block - n_hi:bn + block - n_lo, e_lo - be:e_hi - be]
    return out


def classify_blocks(blocks: Sequence[tuple[int, int]], get, bbox: Sequence[int]) -> dict[str, Any]:
    """TK25 symbol detection over 2 km blocks (`get(block) -> RGBA`), stitched into one 5 m mask over `bbox`
    (row 0 = north edge bbox[3]). Blocks not in `blocks` count as no data. Returns value (u8 contract bits, 255
    outside the fetched blocks), symbols (global px rows/cols), forest, nomap, covered, density."""
    wanted = set(blocks)
    e0, n_top = int(bbox[0]), int(bbox[3])
    shape_c = (math.ceil((bbox[3] - bbox[1]) / CELL_M), math.ceil((bbox[2] - bbox[0]) / CELL_M))
    pts_all = []
    valid_cells = np.zeros(shape_c, np.float64)
    count_cells = np.zeros(shape_c, np.float64)
    cache: dict[tuple[int, int], np.ndarray | None] = {}
    for b in sorted(blocks, key=lambda t: (t[1], t[0])):
        nb, win = block_window(*b)
        imgs = {}
        for k in nb:
            if k not in cache:
                cache[k] = get(k) if k in wanted else None
            imgs[k] = cache[k]
        rgba = assemble_window(imgs, win)
        lum = rgba[..., :3].astype(np.float32).mean(-1)
        valid = rgba[..., 3] > 0
        pk = detect_symbols(paper_normalised(lum), valid)
        m = STATS_MARGIN_M
        core = (pk[:, 0] >= m) & (pk[:, 0] < m + STATS_BLOCK_M) & (pk[:, 1] >= m) & (pk[:, 1] < m + STATS_BLOCK_M)
        # window px (row, col) → global grid px (row from n_top, col from e0)
        pts_all.append(np.c_[pk[core, 0] + (n_top - win[3]), pk[core, 1] + (win[0] - e0)])
        cv = valid[m:m + STATS_BLOCK_M, m:m + STATS_BLOCK_M]
        r0, c0 = (n_top - (b[1] + STATS_BLOCK_M)) // CELL_M, (b[0] - e0) // CELL_M
        frac = cell_fraction(cv)
        r1, c1 = r0 + frac.shape[0], c0 + frac.shape[1]
        rr0, cc0 = max(r0, 0), max(c0, 0)
        rr1, cc1 = min(r1, shape_c[0]), min(c1, shape_c[1])
        if rr0 < rr1 and cc0 < cc1:
            valid_cells[rr0:rr1, cc0:cc1] += frac[rr0 - r0:rr1 - r0, cc0 - c0:cc1 - c0]
            count_cells[rr0:rr1, cc0:cc1] += 1
        for k in [k for k in cache if k[1] < b[1] - STATS_BLOCK_M]:   # blocks run S → N: rows two below are done
            cache.pop(k, None)
    pts = np.vstack(pts_all) if pts_all else np.zeros((0, 2), np.int64)
    inside = (pts[:, 0] >= 0) & (pts[:, 0] < shape_c[0] * CELL_M) & (pts[:, 1] >= 0) & (pts[:, 1] < shape_c[1] * CELL_M)
    pts = pts[inside]
    dens = density_per_ha(pts, (shape_c[0] * CELL_M, shape_c[1] * CELL_M))
    covered = count_cells > 0
    nomap = ~covered | (valid_cells < 0.5)
    forest = clean_mask((dens >= DENSITY_MIN) & ~nomap)
    v = encode({1935: forest, 1840: None}, {1935: nomap, 1840: None}, shape_c)
    v[~covered] = NODATA
    return {"value": v, "symbols": pts, "forest": forest, "nomap": nomap, "covered": covered, "density": dens}


def run_stats(workers: int = 2) -> dict[str, Any]:
    """TK25 1935–40 forest mask over the stats bbox (module docstring, „Stats area“)."""
    import shapely
    from shapely.geometry import box as sbox, shape

    from common import RAW_DIR
    from historic import HIST_LAYERS, HIST_WMS
    from ortho import WmsClient, cache_name, run_pool, wms_getmap_url
    orte = WORK_DIR / "orte"
    gj = json.loads((orte / "gemarkungen.geojson").read_text())
    bbox = [int(v) for v in gj["meta"]["stats_bbox"]]
    area = shapely.union_all([shape(f["geometry"]) for f in gj["features"]]).buffer(STATS_OUTLINE_BUFFER_M)
    blocks = [b for b in stats_blocks(bbox) if area.intersects(sbox(b[0], b[1], b[0] + STATS_BLOCK_M,
                                                                     b[1] + STATS_BLOCK_M))]
    layer = HIST_LAYERS["hist_1935"]["layer"]
    raw = RAW_DIR / "historic" / "orte"
    prime = wms_getmap_url(HIST_WMS, layer, (bbox[0], bbox[1], bbox[0] + 500, bbox[1] + 500), 16, 16,
                           version="1.1.1")
    client = WmsClient(raw, cookies=True, share_glob="historic/*", prime_url=prime)
    t0 = time.time()

    def get(b: tuple[int, int]) -> np.ndarray:
        bb = (b[0], b[1], b[0] + STATS_BLOCK_M, b[1] + STATS_BLOCK_M)
        url = wms_getmap_url(HIST_WMS, layer, bb, STATS_BLOCK_M, STATS_BLOCK_M, version="1.1.1")
        return client.image(url, cache_name(f"L{layer}", bb, STATS_BLOCK_M), (STATS_BLOCK_M, STATS_BLOCK_M))

    run_pool(get, blocks, min(workers, 3))   # download (or link) every block once; images re-read from the cache
    print(f"  TK25 1935–40: {len(blocks)} blocks, {client.requests} requests, cached {client.cached}, "
          f"linked {client.linked} [{time.time() - t0:.0f}s]", flush=True)
    e0, n_top = bbox[0], bbox[3]
    res = classify_blocks(blocks, get, bbox)
    v, pts, forest, nomap, covered = res["value"], res["symbols"], res["forest"], res["nomap"], res["covered"]
    nbytes = write_png(orte / "forest_hist.png", v)
    generated = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    acc_path = WORK_DIR / "overall" / "forest_hist_accuracy.json"
    accuracy = json.loads(acc_path.read_text()) if acc_path.exists() else {}
    entry = {
        "format": FORMAT, "path": "forest_hist.png", "encoding": "u8-bits", "cellSize": CELL_M,
        "size": {"width": int(v.shape[1]), "height": int(v.shape[0])}, "nodata": NODATA,
        "epochs": [{"year": 1840, "bit": 0, "noMapBit": 2, "key": "hist_1840", "label_de": EPOCHS[1840]["label_de"],
                    "map_de": EPOCHS[1840]["map_de"], "classified": False,
                    "note_de": EPOCHS[1840]["note"] + "; für das Statistikgebiet nicht abgerufen"},
                   {"year": 1935, "bit": 1, "noMapBit": 3, "key": "hist_1935", "label_de": EPOCHS[1935]["label_de"],
                    "map_de": EPOCHS[1935]["map_de"], "classified": True, "note_de": EPOCHS[1935]["note"],
                    **({"accuracy": {**accuracy["1935"], "sample": accuracy["1935"].get("sample", "") +
                                     " (measured on the AOI overall)"}} if "1935" in accuracy else {})}],
        "method": METHOD, "generated": generated, "label_de": "Historischer Wald (Schätzung)",
        "attribution": ATTRIBUTION_HIST,
        "source": "WMS SL Historische Karten (Geoportal Saarland, WMS-ID 2597), Layer 5",
    }
    report = {"entry": entry, "E0": e0, "N_top": n_top, "bbox": bbox, "blocks": len(blocks),
              "symbols": int(len(pts)), "requests": client.requests, "cached": client.cached,
              "linked": client.linked, "bytes": nbytes,
              "forest_pct": round(100 * float(forest[covered & ~nomap].mean()), 1) if (covered & ~nomap).any()
              else None, "covered_pct": round(100 * float(covered.mean()), 1),
              "seconds": round(time.time() - t0, 1)}
    (orte / "forest_hist.json").write_text(json.dumps(report, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote data/work/orte/forest_hist.png ({fmt_bytes(nbytes)}), {len(pts)} symbols, forest "
          f"{report['forest_pct']} % of the covered map area [{report['seconds']}s]")
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("aoi", nargs="?")
    ap.add_argument("--no-manifest", action="store_true")
    ap.add_argument("--stats", action="store_true", help="TK25 1935–40 mask over the stats bbox (work files)")
    ap.add_argument("--workers", type=int, default=2, help="parallel WMS requests in --stats (max 3)")
    args = ap.parse_args()
    if args.stats:
        run_stats(args.workers)
    elif args.aoi:
        run(args.aoi, write_manifest=not args.no_manifest)
    else:
        ap.error("give an AOI or --stats")


if __name__ == "__main__":
    main()
