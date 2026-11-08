"""Tree species (`species`, contract "Tree species"): DLR *Tree Species Germany 2022* on the AOI grid, a per-tree
probability (`species-dlr-neighbourhood-v1`) and species mixes per place for *Orte im Vergleich* (plan Q6).

    uv run python species.py fetch            # DLR window (COG range requests) + Thünen window (WCS), cached
    uv run python species.py compare          # DLR 2022 vs Thünen 2017/18 confusion table (cross-check)
    uv run python species.py build [overall]  # app layer species/species.png + manifest key `species`
    uv run python species.py stats            # data/work/orte/species_by_place.json + per-tree arrays
    uv run python species.py all [overall]

Sources (both CC BY 4.0; only DLR-derived data is published):
- DLR *Tree Species Germany* 2022 (Wegler et al. 2025, doi:10.15489/smh8w3j8i962): 10 m Cloud-Optimized GeoTIFF,
  EPSG:3035, u16, values 0 Pine, 1 Spruce, 2 Douglas Fir, 3 Larch, 4 Fir, 5 Beech, 6 Oak, 7 Birch, 8 Alder,
  9 Other (deciduous), 666 Canopy Cover Loss, 999 nodata (not forest). Only the window over the stats bbox
  `[orte]` (+ BUFFER_M) is read with HTTP range requests (GDAL /vsicurl/) and cached under data/raw/dlr-tree-species/.
- Thünen *Dominant Tree Species for Germany (2017/2018)* (Blickensdörfer et al. 2024, doi:10.3220/DATA20221214084846):
  10 m, EPSG:32632, via the Thünen-Atlas WCS (one GetCoverage for the same window), cached under
  data/raw/thuenen-tree-species/. Cross-check only: agreement numbers go into a local report and, as informative
  summary, into the manifest; no Thünen pixel is published.

Grid (`dlr-nearest-25832-v1`): the output raster is EPSG:25832, 10 m cells, row 0 north, origin = the AOI's
west/north edge (like forest_hist). Every output cell takes the DLR pixel that contains the cell centre (exact
pyproj ETRS89 → LAEA, no datum shift; nearest neighbour, no GDAL approximation), so any two AOIs whose edges lie on
the 10 m lattice get identical values for the cells they share (overall ⊂ orte).
Values: 0–9 = DLR class, 10 = canopy cover loss (DLR 666), 255 = no data / not forest.

Per-tree probability `species-dlr-neighbourhood-v1` (pure: `probability_pct`, `tree_species`; contract text is the
reference for the app's TS port): the DLR map has one class per 10 m cell and no probabilities, so the value is a
transparent heuristic, not a calibrated probability: share of the 3 × 3 cells (inside the raster) with the same
class × the class F1 of Wegler et al. 2025 (Table 4, XGBoost S2-S1-DEM), halved when the tree's own DOP colour type says
conifer (dark crown) but the class is a broadleaf one (a "broadleaf" colour type never contradicts: in pure pine
stands of the stats area 93 % of the trees read "broadleaf", so that type carries no species information),
rounded half-up to 10 % and clamped to 10–90 % (a 10 m stand class is never certain for one crown).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import sys
import time
import urllib.parse
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import numpy as np

from common import APP_DATA, RAW_DIR, USER_AGENT, WORK_DIR, aoi_config, fmt_bytes, http_open, load_aoi, update_manifest

FORMAT = "sle-species-v1"
METHOD_GRID = "dlr-nearest-25832-v1"
METHOD_PROB = "species-dlr-neighbourhood-v1"
CELL_M = 10
NODATA = 255
LOSS = 10                      # DLR 666 "Canopy Cover Loss" → 10 (u8)
DLR_NODATA = 999
PATH = "species/species.png"
STATS_AOI = "orte"
BUFFER_M = 200                 # window margin around the stats bbox (neighbourhood + reprojection safety)
ORTE_DIR = WORK_DIR / "orte"

DLR_URL = "https://download.geoservice.dlr.de/TREE_SPECIES_DE/files/treespecies_de_2022.tif"
DLR_README = "https://download.geoservice.dlr.de/TREE_SPECIES_DE/files/treespecies_de_2022_readme.txt"
DLR_RAW = RAW_DIR / "dlr-tree-species"
THUENEN_WCS = "https://atlas.thuenen.de/geoserver/ows"
THUENEN_COVERAGE = "geonode__Dominant_Species_Class"
THUENEN_RAW = RAW_DIR / "thuenen-tree-species"

ATTRIBUTION_DLR = ("Baumarten: DLR, Tree Species Germany 2022 (Wegler et al. 2025), CC BY 4.0, "
                   "doi:10.15489/smh8w3j8i962, Daten bearbeitet (umprojiziert)")
ATTRIBUTION_THUENEN = ("Thünen-Institut, Dominant Tree Species for Germany 2017/2018 (Blickensdörfer et al. 2024), "
                       "CC BY 4.0, doi:10.3220/DATA20221214084846")
ATTRIBUTION_THUENEN_CROSS = ("Abgleich Baumarten: Thünen-Institut, Dominant Tree Species for Germany 2017/2018 "
                             "(Blickensdörfer et al. 2024), CC BY 4.0")
SOURCE_DLR = ("DLR EOC Geoservice, Tree Species Germany 2022, 10 m COG (treespecies_de_2022.tif, EPSG:3035); "
              "Wegler, M., Kacic, P., Thonfeld, F., Holzwarth, S., Jaggy, N., Gessner, U., Kuenzer, C. (2025): "
              "Tree species from space: a new product for Germany based on Sentinel-1 and -2 time series. "
              "International Journal of Remote Sensing, doi:10.1080/01431161.2025.2530236")

# code, key, label_de, group, F1 (Wegler et al. 2025, Table 4, XGBoost S2-S1-DEM, test samples of pure stands)
CLASSES: tuple[tuple[int, str, str, str, float | None], ...] = (
    (0, "pine", "Kiefer", "conifer", 0.98),
    (1, "spruce", "Fichte", "conifer", 0.94),
    (2, "douglas_fir", "Douglasie", "conifer", 0.91),
    (3, "larch", "Lärche", "conifer", 0.96),
    (4, "fir", "Tanne", "conifer", 0.88),
    (5, "beech", "Buche", "broadleaf", 0.95),
    (6, "oak", "Eiche", "broadleaf", 0.76),
    (7, "birch", "Birke", "broadleaf", 0.90),
    (8, "alder", "Erle", "broadleaf", 0.89),
    (9, "other_broadleaf", "andere Laubbäume", "broadleaf", 0.76),
    (LOSS, "canopy_loss", "Kronendachverlust (keine Art)", "none", None),
)
OVERALL_F1 = 0.89
CONTRA_DIV = 2                 # probability ÷ 2 when a conifer-typed (dark) crown stands in a broadleaf class cell
MIN_PCT, MAX_PCT = 10, 90
LIKELY_PCT = 50                # ≥ this and no contradiction → „wahrscheinlich“, else „unsicher“

# Thünen raster value → DLR code (Thünen legend, GetLegendGraphic JSON, 2026-11-08); 0 = nodata.
# ODH (other deciduous, high life expectancy) and ODL (low life expectancy) both → DLR 9 "Other".
THUENEN_TO_DLR = {9: 0, 8: 1, 4: 2, 10: 3, 14: 4, 3: 5, 5: 6, 2: 7, 6: 8, 16: 9, 17: 9}

CLASS_BY_CODE = {c[0]: c for c in CLASSES}
F1_PCT = {c[0]: round(c[4] * 100) for c in CLASSES if c[4] is not None}


# =================================================================================================== pure
def encode_dlr(raw: np.ndarray) -> np.ndarray:
    """DLR u16 values → contract u8: 0–9 kept, 666 → 10, everything else (999 nodata, unknown) → 255. Pure."""
    raw = np.asarray(raw)
    out = np.full(raw.shape, NODATA, np.uint8)
    sp = (raw >= 0) & (raw <= 9)
    out[sp] = raw[sp].astype(np.uint8)
    out[raw == 666] = LOSS
    return out


def thuenen_to_dlr(raw: np.ndarray) -> np.ndarray:
    """Thünen class values → DLR codes (u8, 255 = nodata / unknown). Pure."""
    raw = np.asarray(raw)
    out = np.full(raw.shape, NODATA, np.uint8)
    for t, d in THUENEN_TO_DLR.items():
        out[raw == t] = d
    return out


def cell_centres(e0: float, n1: float, width: int, height: int, cell: float = CELL_M) -> tuple[np.ndarray, np.ndarray]:
    """E, N (2-D, row 0 = north) of the centres of a width × height grid with west edge e0, north edge n1. Pure."""
    e = e0 + (np.arange(width) + 0.5) * cell
    n = n1 - (np.arange(height) + 0.5) * cell
    return np.meshgrid(e, n)


def sample_containing(src: np.ndarray, x0: float, y1: float, res: float, x: np.ndarray, y: np.ndarray,
                      fill: int) -> np.ndarray:
    """Value of the source pixel that contains each point (x, y) in source CRS metres; the source grid has west edge
    x0, north edge y1, square pixels `res`, row 0 north. Points outside → `fill`. Pure."""
    col = np.floor((np.asarray(x, np.float64) - x0) / res).astype(np.int64)
    row = np.floor((y1 - np.asarray(y, np.float64)) / res).astype(np.int64)
    ok = (col >= 0) & (row >= 0) & (col < src.shape[1]) & (row < src.shape[0])
    out = np.full(np.shape(x), fill, dtype=src.dtype)
    out[ok] = src[row[ok], col[ok]]
    return out


def to_grid(src: np.ndarray, src_crs: str, x0: float, y1: float, res: float, *, e0: float, n1: float,
            width: int, height: int, fill: int, cell: float = CELL_M) -> np.ndarray:
    """Nearest-neighbour (containing pixel) resampling of a north-up source raster onto the EPSG:25832 grid."""
    from pyproj import Transformer
    E, N = cell_centres(e0, n1, width, height, cell)
    if src_crs.upper() in ("EPSG:25832",):
        x, y = E, N
    else:
        x, y = Transformer.from_crs("EPSG:25832", src_crs, always_xy=True).transform(E, N)
    return sample_containing(src, x0, y1, res, np.asarray(x), np.asarray(y), fill)


def cell_index(E: np.ndarray, N: np.ndarray, e0: float, n1: float, width: int, height: int,
               cell: float = CELL_M) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(px, py, inside) of points on the grid: px = floor((E − e0)/cell), py = floor((n1 − N)/cell). Pure."""
    px = np.floor((np.asarray(E, np.float64) - e0) / cell).astype(np.int64)
    py = np.floor((n1 - np.asarray(N, np.float64)) / cell).astype(np.int64)
    inside = (px >= 0) & (py >= 0) & (px < width) & (py < height)
    return px, py, inside


def neighbourhood(raster: np.ndarray, px: np.ndarray, py: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """For cells (px, py) inside `raster`: centre class c, k = cells of the 3 × 3 block (centre included) inside the
    raster whose value equals c, n = cells of the block inside the raster (9, 6 at an edge, 4 at a corner). Pure."""
    h, w = raster.shape
    pad = np.full((h + 2, w + 2), -1, np.int16)
    pad[1:-1, 1:-1] = raster
    px1, py1 = np.asarray(px) + 1, np.asarray(py) + 1
    c = pad[py1, px1]
    k = np.zeros(c.shape, np.int64)
    n = np.zeros(c.shape, np.int64)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            v = pad[py1 + dy, px1 + dx]
            n += v >= 0
            k += v == c
    return c.astype(np.int64), k, n


def contradicts(code: int, tree_type: int) -> bool:
    """True when the tree reads as conifer (type low 7 bits == 1, fill trees included) but the DLR class is a
    broadleaf class (5–9). One-sided on purpose: the colour type "broadleaf" (2) is not evidence against a conifer
    class (pure pine stands: 93 % "broadleaf", pure spruce/Douglas fir: 50–59 %), while "conifer" is rare in pure
    broadleaf stands (≈ 3 %) and common in dark conifer stands (≈ 17 %). Pure."""
    return (int(tree_type) & 0x7F) == 1 and code in CLASS_BY_CODE and CLASS_BY_CODE[code][3] == "broadleaf"


def probability_pct(k: int, n: int, f1_pct: int, contra: bool) -> int:
    """species-dlr-neighbourhood-v1 in integer arithmetic (the app's TS must match exactly):
    num = k·f1, den = n·(2 if contra else 1); pct = 10·floor((num + 5·den) / (10·den)) (= k/n · f1 rounded half-up
    to 10 %), clamped to [MIN_PCT, MAX_PCT]. Pure."""
    if n <= 0 or k <= 0:
        raise ValueError("k and n must be ≥ 1")
    num = k * f1_pct
    den = n * (CONTRA_DIV if contra else 1)
    pct = 10 * ((num + 5 * den) // (10 * den))
    return max(MIN_PCT, min(MAX_PCT, pct))


def certainty(pct: int, contra: bool) -> str:
    """'wahrscheinlich' (pct ≥ LIKELY_PCT, no contradiction) or 'unsicher'. Pure."""
    return "wahrscheinlich" if (not contra and pct >= LIKELY_PCT) else "unsicher"


def tree_group(code: np.ndarray, pct: np.ndarray, tree_type: np.ndarray) -> np.ndarray:
    """tree-group-v1 per tree (contract "Tree species"): 1 conifer, 2 broadleaf, 0 no group. A „wahrscheinlich“ class
    (pct ≥ LIKELY_PCT, no contradiction) gives its group; an „unsicher“ class gives the colour type only when it agrees
    with the class group (else 0); no class (255, canopy loss, pct 0) gives the colour type (type & 0x7F, codes other
    than 0/1/2 → 0). The colour type alone reads most conifers as broadleaf (review 2026-11-08). Pure, vectorised;
    the app's TS `treeGroup` must agree."""
    code = np.asarray(code).astype(np.int64)
    pct = np.asarray(pct).astype(np.int64)
    t = np.asarray(tree_type).astype(np.int64) & 0x7F
    t = np.where((t == 1) | (t == 2), t, 0)
    grp = np.zeros(code.shape, np.int64)              # class group: 1 conifer, 2 broadleaf, 0 none
    for c, _key, _label, group, f1 in CLASSES:
        if f1 is not None and group in ("conifer", "broadleaf"):
            grp[code == c] = 1 if group == "conifer" else 2
    has = (grp > 0) & (pct > 0)
    contra = (t == 1) & (grp == 2)
    likely = has & ~contra & (pct >= LIKELY_PCT)
    out = np.where(likely, grp, np.where(has, np.where(t == grp, t, 0), t))
    return out.astype(np.uint8)


def tree_species(raster: np.ndarray, E: np.ndarray, N: np.ndarray, tree_type: np.ndarray, *, e0: float, n1: float,
                 cell: float = CELL_M) -> dict[str, np.ndarray]:
    """Per tree: code (u8, 255 = none: outside, no data or canopy loss), pct (u8, 0 = none), contra (bool). Pure."""
    h, w = raster.shape
    E, N, tree_type = np.asarray(E), np.asarray(N), np.asarray(tree_type)
    px, py, inside = cell_index(E, N, e0, n1, w, h, cell)
    code = np.full(E.shape, NODATA, np.uint8)
    pct = np.zeros(E.shape, np.uint8)
    contra = np.zeros(E.shape, bool)
    idx = np.flatnonzero(inside)
    if not idx.size:
        return {"code": code, "pct": pct, "contra": contra}
    c, k, n = neighbourhood(raster, px[idx], py[idx])
    for j, i in enumerate(idx):
        cj = int(c[j])
        if cj not in F1_PCT:            # 255 no data, 10 canopy loss: no species
            continue
        con = contradicts(cj, int(tree_type[i]))
        code[i], contra[i] = cj, con
        pct[i] = probability_pct(int(k[j]), int(n[j]), F1_PCT[cj], con)
    return {"code": code, "pct": pct, "contra": contra}


def place_mix(code: np.ndarray, pct: np.ndarray, contra: np.ndarray, r: np.ndarray, tree_type: np.ndarray
              ) -> dict[str, Any]:
    """Species mix of one place's trees, weighted by crown area π r² (crown-disc-v1). Pure."""
    code, r = np.asarray(code), np.asarray(r, np.float64)
    crown = math.pi * r ** 2
    has = code != NODATA
    total = float(crown.sum())
    with_sp = float(crown[has].sum())
    mix: dict[str, float] = {}
    for c in sorted(F1_PCT):
        a = float(crown[code == c].sum())
        if a > 0:
            mix[CLASS_BY_CODE[c][1]] = round(100 * a / with_sp, 1)
    dom = None
    if mix:
        key = max(mix, key=lambda k: (mix[k], k))
        c = next(cc for cc in CLASSES if cc[1] == key)
        dom = {"code": c[0], "key": key, "label_de": c[2], "share_pct": mix[key]}
    conifer = np.isin(code, [c[0] for c in CLASSES if c[3] == "conifer"])
    t = np.asarray(tree_type) & 0x7F
    typed = (t == 1) | (t == 2)
    return {
        "trees": int(code.size), "trees_with_species": int(has.sum()),
        "crown_ha": round(total / 1e4, 2), "crown_with_species_ha": round(with_sp / 1e4, 2),
        "coverage_pct": round(100 * with_sp / total, 1) if total else None,
        "mix_pct": mix, "dominant": dom,
        "conifer_pct": round(100 * float(crown[conifer].sum()) / with_sp, 1) if with_sp else None,
        "dop_conifer_pct": (round(100 * float(crown[typed & (t == 1)].sum()) / float(crown[typed].sum()), 1)
                              if crown[typed].sum() else None),
        "prob_mean_pct": round(float(pct[has].mean()), 1) if has.any() else None,
        "likely_pct": (round(100 * float(((pct >= LIKELY_PCT) & ~contra)[has].mean()), 1) if has.any() else None),
        "contradicts_pct": round(100 * float(contra[has].mean()), 1) if has.any() else None,
    }


def type_by_class(code: np.ndarray, tree_type: np.ndarray) -> dict[str, Any]:
    """Share (%) of colour types (unknown / conifer / broadleaf) among trees of each class (diagnostic for the
    contradiction rule). Pure."""
    code, t = np.asarray(code), np.asarray(tree_type) & 0x7F
    out: dict[str, Any] = {}
    for c in sorted(F1_PCT):
        m = code == c
        if m.any():
            out[CLASS_BY_CODE[c][1]] = {"n": int(m.sum()), **{lab: round(100 * float((t[m] == b).mean()), 1)
                                                               for b, lab in ((0, "unknown"), (1, "conifer"),
                                                                              (2, "broadleaf"))}}
    return out


def confusion(a: np.ndarray, b: np.ndarray, codes: Sequence[int] = tuple(range(10))) -> dict[str, Any]:
    """Confusion table of two class rasters over cells where both have a species code (`codes`). Rows = a (DLR),
    columns = b (Thünen). Per class: n_a, n_b, agree, agreement of a's cells with b (`agree_of_a_pct`, user's-
    accuracy-like), of b's cells with a, and F1-like Dice 2·agree/(n_a + n_b). Pure."""
    a, b = np.asarray(a).ravel(), np.asarray(b).ravel()
    m = np.isin(a, codes) & np.isin(b, codes)
    idx = {c: i for i, c in enumerate(codes)}
    tab = np.zeros((len(codes), len(codes)), np.int64)
    if m.any():
        ai = np.vectorize(idx.get)(a[m])
        bi = np.vectorize(idx.get)(b[m])
        np.add.at(tab, (ai, bi), 1)
    n = int(tab.sum())
    per = {}
    for c, i in idx.items():
        na, nb, ag = int(tab[i].sum()), int(tab[:, i].sum()), int(tab[i, i])
        if na or nb:
            per[CLASS_BY_CODE[c][1]] = {
                "n_dlr": na, "n_thuenen": nb, "agree": ag,
                "agree_of_dlr_pct": round(100 * ag / na, 1) if na else None,
                "agree_of_thuenen_pct": round(100 * ag / nb, 1) if nb else None,
                "dice": round(2 * ag / (na + nb), 3)}
    con = [i for c, i in idx.items() if CLASS_BY_CODE[c][3] == "conifer"]
    grp = np.zeros((2, 2), np.int64)
    for i in range(len(codes)):
        for j in range(len(codes)):
            grp[0 if i in con else 1, 0 if j in con else 1] += tab[i, j]
    return {"n": n, "agree_pct": round(100 * float(np.trace(tab)) / n, 1) if n else None,
            "group_agree_pct": round(100 * float(np.trace(grp)) / n, 1) if n else None,
            "codes": list(codes), "table": tab.tolist(), "per_class": per}


def manifest_entry(width: int, height: int, generated: str, cross: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """The contract's `species` manifest value (pure)."""
    e: dict[str, Any] = {
        "format": FORMAT, "path": PATH, "encoding": "u8-class", "cellSize": CELL_M,
        "size": {"width": width, "height": height}, "nodata": NODATA, "year": 2022,
        "classes": [{"code": c, "key": k, "label_de": lab, "group": g, "species": f1 is not None,
                     **({"f1": f1} if f1 is not None else {})} for c, k, lab, g, f1 in CLASSES],
        "probability": {"method": METHOD_PROB, "contradictionDivisor": CONTRA_DIV, "minPct": MIN_PCT,
                        "maxPct": MAX_PCT, "likelyPct": LIKELY_PCT, "contradiction": "type-conifer-in-broadleaf-class"},
        "accuracy": {"overallF1": OVERALL_F1, "perClass": "classes[].f1",
                     "source": "Wegler et al. 2025, Table 4 (XGBoost S2-S1-DEM), test samples of pure stands",
                     "note_de": "Genauigkeit für Reinbestände; Mischwald, Waldränder und Einzelbäume sind unsicherer"},
        "method": METHOD_GRID, "generated": generated,
        "label_de": "Baumart (Schätzung, 10-m-Raster)",
        "attribution": ATTRIBUTION_DLR, "source": SOURCE_DLR,
    }
    if cross:
        e["crossCheck"] = dict(cross)
    return e


# =================================================================================================== I/O
def stats_bbox() -> tuple[int, int, int, int]:
    e0, n0, e1, n1 = (int(v) for v in aoi_config(STATS_AOI)["bbox"])
    return e0, n0, e1, n1


def window_in(crs: str, bbox: Sequence[float], buffer_m: float = BUFFER_M, steps: int = 40) -> tuple[float, ...]:
    """Bounds in `crs` of the EPSG:25832 bbox + buffer (edges densified, so the curved LAEA edges are covered)."""
    from pyproj import Transformer
    e0, n0, e1, n1 = bbox[0] - buffer_m, bbox[1] - buffer_m, bbox[2] + buffer_m, bbox[3] + buffer_m
    t = np.linspace(0, 1, steps + 1)
    xs = np.r_[e0 + (e1 - e0) * t, np.full_like(t, e1), e1 - (e1 - e0) * t, np.full_like(t, e0)]
    ys = np.r_[np.full_like(t, n0), n0 + (n1 - n0) * t, np.full_like(t, n1), n1 - (n1 - n0) * t]
    x, y = Transformer.from_crs("EPSG:25832", crs, always_xy=True).transform(xs, ys)
    return float(np.min(x)), float(np.min(y)), float(np.max(x)), float(np.max(y))


def _gdal_env():
    import certifi
    from rasterio.env import Env
    return Env(GDAL_HTTP_USERAGENT=USER_AGENT, GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
               CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", CURL_CA_BUNDLE=certifi.where(),
               GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="2", GDAL_HTTP_MULTIRANGE="SERIAL")


def _write_gtiff(path: Path, arr: np.ndarray, crs: str, transform, nodata: float | None) -> None:
    import rasterio
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp.tif")
    with rasterio.open(tmp, "w", driver="GTiff", width=arr.shape[1], height=arr.shape[0], count=1,
                       dtype=arr.dtype, crs=crs, transform=transform, nodata=nodata, compress="deflate") as ds:
        ds.write(arr, 1)
    tmp.replace(path)


def dlr_cache(bbox: Sequence[int]) -> Path:
    return DLR_RAW / f"treespecies_de_2022_{bbox[0]}_{bbox[1]}_{bbox[2]}_{bbox[3]}.tif"


def thuenen_cache(bbox: Sequence[int]) -> Path:
    return THUENEN_RAW / f"dominant_species_2018_{bbox[0]}_{bbox[1]}_{bbox[2]}_{bbox[3]}.tif"


def fetch_dlr(bbox: Sequence[int], refresh: bool = False) -> Path:
    """Read the DLR COG window over bbox + BUFFER_M (range requests) and cache it as a small GeoTIFF."""
    import rasterio
    from rasterio.windows import Window
    out = dlr_cache(bbox)
    if out.exists() and not refresh:
        print(f"  DLR: cached {out.name}")
        return out
    DLR_RAW.mkdir(parents=True, exist_ok=True)
    readme = DLR_RAW / "treespecies_de_2022_readme.txt"
    if not readme.exists():
        readme.write_bytes(http_open(DLR_README).read())
    t0 = time.time()
    with _gdal_env(), rasterio.open(f"/vsicurl/{DLR_URL}") as ds:
        if ds.crs.to_epsg() != 3035 or abs(ds.transform.a - 10) > 1e-9 or abs(ds.transform.e + 10) > 1e-9:
            raise RuntimeError(f"unexpected DLR grid: {ds.crs} {ds.transform}")
        x0, y0, x1, y1 = window_in("EPSG:3035", bbox)
        c0 = math.floor((x0 - ds.transform.c) / 10) - 1
        r0 = math.floor((ds.transform.f - y1) / 10) - 1
        c1 = math.ceil((x1 - ds.transform.c) / 10) + 1
        r1 = math.ceil((ds.transform.f - y0) / 10) + 1
        win = Window(c0, r0, c1 - c0, r1 - r0)
        arr = ds.read(1, window=win)
        tr = ds.window_transform(win)
        nodata = ds.nodata
    _write_gtiff(out, arr, "EPSG:3035", tr, nodata)
    meta = {"url": DLR_URL, "window": [c0, r0, c1 - c0, r1 - r0], "bbox25832": list(bbox), "buffer_m": BUFFER_M,
            "fetched": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
            "seconds": round(time.time() - t0, 1), "licence": "CC BY 4.0", "doi": "10.15489/smh8w3j8i962"}
    out.with_suffix(".json").write_text(json.dumps(meta, indent=1) + "\n")
    print(f"  DLR: window {arr.shape[1]}×{arr.shape[0]} px → {out.name} ({fmt_bytes(out.stat().st_size)}) "
          f"[{meta['seconds']}s]")
    return out


def fetch_thuenen(bbox: Sequence[int], refresh: bool = False) -> Path:
    """One WCS 2.0.1 GetCoverage (native EPSG:32632 10 m grid) over bbox + BUFFER_M, cached as GeoTIFF."""
    out = thuenen_cache(bbox)
    if out.exists() and not refresh:
        print(f"  Thünen: cached {out.name}")
        return out
    THUENEN_RAW.mkdir(parents=True, exist_ok=True)
    x0, y0, x1, y1 = window_in("EPSG:32632", bbox)
    # snap outward to the coverage's 10 m grid (origin 280460 / 6098380 = edges on whole 10 m)
    x0, y0 = math.floor(x0 / 10) * 10 - 10, math.floor(y0 / 10) * 10 - 10
    x1, y1 = math.ceil(x1 / 10) * 10 + 10, math.ceil(y1 / 10) * 10 + 10
    q = [("service", "WCS"), ("version", "2.0.1"), ("request", "GetCoverage"), ("coverageId", THUENEN_COVERAGE),
         ("format", "image/tiff"), ("subset", f"E({x0},{x1})"), ("subset", f"N({y0},{y1})")]
    url = f"{THUENEN_WCS}?{urllib.parse.urlencode(q)}"
    t0 = time.time()
    with http_open(url, timeout=300) as r:
        ctype = r.headers.get("Content-Type", "")
        body = r.read()
    if not body.startswith((b"II*\x00", b"MM\x00*")):
        raise RuntimeError(f"Thünen WCS did not return a GeoTIFF ({ctype}): {body[:300]!r}")
    tmp = out.with_suffix(".tmp.tif")
    tmp.write_bytes(body)
    tmp.replace(out)
    meta = {"url": url, "bbox32632": [x0, y0, x1, y1], "bbox25832": list(bbox), "bytes": len(body),
            "fetched": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
            "seconds": round(time.time() - t0, 1), "licence": "CC BY 4.0", "doi": "10.3220/DATA20221214084846"}
    out.with_suffix(".json").write_text(json.dumps(meta, indent=1) + "\n")
    print(f"  Thünen: {fmt_bytes(len(body))} → {out.name} [{meta['seconds']}s]")
    return out


def read_source(path: Path) -> tuple[np.ndarray, str, float, float, float]:
    """(array, crs, west edge, north edge, pixel size) of a north-up single-band GeoTIFF."""
    import rasterio
    with rasterio.open(path) as ds:
        tr = ds.transform
        if tr.b or tr.d or abs(tr.a + tr.e) > 1e-9:
            raise RuntimeError(f"{path.name}: not a north-up square grid: {tr}")
        return ds.read(1), ds.crs.to_string(), tr.c, tr.f, tr.a


def species_grid(e0: int, n1: int, width: int, height: int, bbox: Sequence[int]) -> np.ndarray:
    """Contract u8 species raster on the EPSG:25832 10 m grid (west e0, north n1) from the cached DLR window."""
    src, crs, x0, y1, res = read_source(dlr_cache(bbox))
    raw = to_grid(src, crs, x0, y1, res, e0=e0, n1=n1, width=width, height=height, fill=DLR_NODATA)
    return encode_dlr(raw)


def orte_grid() -> tuple[np.ndarray, int, int]:
    """Species raster over the whole stats bbox (cached in data/work/orte/species_10m.tif)."""
    bbox = stats_bbox()
    w, h = (bbox[2] - bbox[0]) // CELL_M, (bbox[3] - bbox[1]) // CELL_M
    v = species_grid(bbox[0], bbox[3], w, h, bbox)
    from rasterio.transform import from_origin
    _write_gtiff(ORTE_DIR / "species_10m.tif", v, "EPSG:25832", from_origin(bbox[0], bbox[3], CELL_M, CELL_M),
                 NODATA)
    return v, bbox[0], bbox[3]


def write_png(path: Path, v: np.ndarray) -> int:
    from PIL import Image
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp.png")
    Image.fromarray(v, "L").save(tmp, optimize=True)
    tmp.replace(path)
    return path.stat().st_size


def preview(v: np.ndarray, path: Path) -> None:
    """Colour preview (QML-like colours) for a look; local only."""
    from PIL import Image
    pal = {0: (222, 19, 23), 1: (205, 134, 115), 2: (231, 236, 71), 3: (223, 63, 234), 4: (255, 213, 77),
           5: (73, 202, 69), 6: (26, 118, 28), 7: (209, 239, 226), 8: (103, 132, 77), 9: (37, 160, 237),
           LOSS: (60, 60, 60), NODATA: (250, 250, 245)}
    rgb = np.zeros(v.shape + (3,), np.uint8)
    for c, col in pal.items():
        rgb[v == c] = col
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb, "RGB").save(path)


def run_compare() -> dict[str, Any]:
    bbox = stats_bbox()
    w, h = (bbox[2] - bbox[0]) // CELL_M, (bbox[3] - bbox[1]) // CELL_M
    dlr = species_grid(bbox[0], bbox[3], w, h, bbox)
    src, crs, x0, y1, res = read_source(thuenen_cache(bbox))
    th = thuenen_to_dlr(to_grid(src, crs, x0, y1, res, e0=bbox[0], n1=bbox[3], width=w, height=h, fill=0))
    res_all = confusion(dlr, th)
    forest_dlr = np.isin(dlr, list(range(10)))
    forest_th = th != NODATA
    report = {
        "generated": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "bbox25832": list(bbox), "cell_m": CELL_M,
        "dlr": "Tree Species Germany 2022", "thuenen": "Dominant Tree Species 2017/2018",
        "cells": {"dlr_species": int(forest_dlr.sum()), "dlr_canopy_loss": int((dlr == LOSS).sum()),
                  "thuenen_species": int(forest_th.sum()), "both": int((forest_dlr & forest_th).sum()),
                  "dlr_only": int((forest_dlr & ~forest_th).sum()), "thuenen_only": int((~forest_dlr & forest_th).sum()),
                  "dlr_loss_where_thuenen": {CLASS_BY_CODE[c][1]: int(((dlr == LOSS) & (th == c)).sum())
                                             for c in range(10) if ((dlr == LOSS) & (th == c)).any()}},
        "mapping": {"thuenen_to_dlr": {str(k): v for k, v in THUENEN_TO_DLR.items()},
                    "note": "Thünen ODH + ODL → DLR 9 other_broadleaf"},
        "all_cells": res_all,
    }
    (ORTE_DIR / "species_crosscheck.json").write_text(json.dumps(report, indent=1) + "\n")
    print(f"  cross-check: {res_all['n']} cells in both, agreement {res_all['agree_pct']} % "
          f"(conifer/broadleaf {res_all['group_agree_pct']} %)")
    for k, p in res_all["per_class"].items():
        print(f"    {k:16s} DLR {p['n_dlr']:7d}  Thünen {p['n_thuenen']:7d}  agree {p['agree']:7d}  "
              f"of DLR {p['agree_of_dlr_pct']}%  of Thünen {p['agree_of_thuenen_pct']}%  dice {p['dice']}")
    return report


def cross_summary() -> dict[str, Any] | None:
    p = ORTE_DIR / "species_crosscheck.json"
    if not p.exists():
        return None
    r = json.loads(p.read_text())["all_cells"]
    return {"against": "Thünen Dominant Tree Species 2017/2018", "attribution": ATTRIBUTION_THUENEN,
            "area": "Orte-im-Vergleich-Statistikgebiet (stats bbox)", "n": r["n"], "agreePct": r["agree_pct"],
            "groupAgreePct": r["group_agree_pct"],
            "perClass": {k: {"agreeOfDlrPct": v["agree_of_dlr_pct"], "dice": v["dice"]}
                         for k, v in r["per_class"].items()},
            "note_de": "Unterschiedliche Jahre (2017/18 vs. 2022) und Methoden; Übereinstimmung ist keine Genauigkeit"}


def run_build(aoi_key: str, write_manifest: bool = True) -> dict[str, Any]:
    aoi = load_aoi(aoi_key)
    out_dir = APP_DATA / aoi.key
    if not (out_dir / "manifest.json").exists():
        sys.exit(f"{out_dir}/manifest.json missing – run build first")
    bbox = stats_bbox()
    if not (bbox[0] <= aoi.e0 and aoi.e1 <= bbox[2] and bbox[1] <= aoi.n0 and aoi.n1 <= bbox[3]):
        sys.exit(f"AOI {aoi.key} is not inside the stats bbox {bbox}: the cached DLR window does not cover it")
    w, h = math.ceil(aoi.width / CELL_M), math.ceil(aoi.height / CELL_M)
    v = species_grid(aoi.e0, aoi.n1, w, h, bbox)
    nbytes = write_png(out_dir / PATH, v)
    preview(v, WORK_DIR / aoi.key / "species_preview.png")
    generated = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    entry = manifest_entry(w, h, generated, cross_summary())
    if write_manifest:
        # The crossCheck numbers derive from the Thünen map: credit it too (CC BY 4.0), review 2026-11-08.
        update_manifest(out_dir, {"species": entry},
                        attribution=[ATTRIBUTION_DLR] + ([ATTRIBUTION_THUENEN_CROSS] if entry.get("crossCheck") else []))
    counts = {CLASS_BY_CODE[int(c)][1] if int(c) in CLASS_BY_CODE else "nodata": int(n)
              for c, n in zip(*np.unique(v, return_counts=True))}
    print(f"wrote {PATH} ({fmt_bytes(nbytes)}), {w}×{h} cells of {CELL_M} m; {counts}")
    return {"entry": entry, "value": v, "counts": counts}


def run_stats() -> dict[str, Any]:
    import gzip

    import shapely
    from rasterio.features import rasterize
    from shapely.geometry import shape

    from stats import assign_points
    t0 = time.time()
    v, e0, n1 = orte_grid()
    z = np.load(ORTE_DIR / "trees.npz")
    E, N, r, ttype = z["E"], z["N"], z["r"], z["type"]
    sp = tree_species(v, E, N, ttype, e0=e0, n1=n1)
    np.save(ORTE_DIR / "species_trees.npy", sp["code"])
    np.save(ORTE_DIR / "species_prob_trees.npy", sp["pct"])
    px, py, ins = cell_index(E, N, e0, n1, v.shape[1], v.shape[0])
    _c, k, n = neighbourhood(v, px[ins], py[ins])
    pure = np.zeros(E.size, bool)
    pure[np.flatnonzero(ins)] = k == 9
    type_check = type_by_class(sp["code"][pure], ttype[pure])
    print(f"  trees: {E.size}, with species {int((sp['code'] != NODATA).sum())} [{time.time() - t0:.0f}s]")

    gem = json.loads((ORTE_DIR / "gemarkungen.geojson").read_text())["features"]
    pids = [f["properties"]["id"] for f in gem]
    names = {f["properties"]["id"]: f["properties"]["name_de"] for f in gem}
    with gzip.open(ORTE_DIR / "flurstuecke.geojson.gz", "rt") as fh:
        parcels = json.load(fh)["features"]
    p_geoms, p_place = [], []
    for f in parcels:
        if f.get("geometry"):
            p_geoms.append(shapely.make_valid(shape(f["geometry"])))
            p_place.append(f["properties"]["place"])
    pidx = assign_points(E, N, p_geoms)          # parcel-pip-v1, as stats.py
    t_place = np.where(pidx >= 0, np.array(p_place)[np.maximum(pidx, 0)], "")
    print(f"  assigned to places [{time.time() - t0:.0f}s]")

    from rasterio.transform import from_origin
    tr = from_origin(e0, n1, CELL_M, CELL_M)
    places: dict[str, Any] = {}
    for i, pid in enumerate(pids):
        sel = t_place == pid
        mix = place_mix(sp["code"][sel], sp["pct"][sel], sp["contra"][sel], r[sel], ttype[sel])
        outline = shapely.make_valid(shape(gem[i]["geometry"]))
        inside = rasterize([(outline, 1)], out_shape=v.shape, transform=tr, fill=0, dtype="uint8").astype(bool)
        cell_ha = CELL_M * CELL_M / 1e4
        mix["dlr_cells_ha"] = {CLASS_BY_CODE[c][1]: round(float((inside & (v == c)).sum()) * cell_ha, 1)
                               for c in range(LOSS + 1) if (inside & (v == c)).any()}
        places[pid] = {"name_de": names[pid], **mix}
    out = {"format": "sle-species-by-place-v1", "method": {"grid": METHOD_GRID, "probability": METHOD_PROB,
                                                           "assign": "parcel-pip-v1", "crown": "crown-disc-v1"},
           "generated": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
           "source": SOURCE_DLR, "attribution": ATTRIBUTION_DLR,
           "trees_npz": {"count": int(E.size), "species_trees": "species_trees.npy (u8 code, 255 none)",
                         "species_prob_trees": "species_prob_trees.npy (u8 %, 0 none)"},
           "classes": {c[1]: c[2] for c in CLASSES},
           "type_check": {"note": "DOP colour type of trees in pure 3x3 class blocks (k = n = 9), stats area",
                          "per_class": type_check},
           "places": places}
    (ORTE_DIR / "species_by_place.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    preview(v, ORTE_DIR / "species_preview.png")
    for pid, p in places.items():
        d = p["dominant"] or {}
        print(f"    {pid:22s} trees {p['trees']:7d} with sp {p['trees_with_species']:7d} "
              f"cov {p['coverage_pct']}%  dom {d.get('label_de')} {d.get('share_pct')}%  "
              f"conifer DLR {p['conifer_pct']}% / DOP type {p['dop_conifer_pct']}%  p̄ {p['prob_mean_pct']}%")
    print(f"wrote data/work/orte/species_by_place.json [{time.time() - t0:.0f}s]")
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("cmd", choices=["fetch", "compare", "build", "stats", "all"])
    ap.add_argument("aoi", nargs="?", default="overall")
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--no-manifest", action="store_true")
    a = ap.parse_args()
    bbox = stats_bbox()
    if a.cmd in ("fetch", "all"):
        fetch_dlr(bbox, a.refresh)
        fetch_thuenen(bbox, a.refresh)
    if a.cmd in ("compare", "all"):
        run_compare()
    if a.cmd in ("build", "all"):
        run_build(a.aoi, write_manifest=not a.no_manifest)
    if a.cmd in ("stats", "all"):
        run_stats()


if __name__ == "__main__":
    main()
