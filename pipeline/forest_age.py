"""Orte im Vergleich, Phase 1: forest age class per tree (from height) and per place (plan §4 „Age“, §8 Phase 1).

Usage:  uv run python forest_age.py

Two independent, labelled estimates (G7, „Schätzung“):

1. **Height → age class per tree** (`tree-age-height-v2`, pure `tree_age`): the LiDAR height of a tree is read
   against the height-over-age curves of the German yield tables (Ertragstafeln, mäßige Durchforstung):
   beech after Schober 1967, oak after Jüttner 1955, spruce after Wiedemann 1936/42 (plus pine, Wiedemann 1943, and
   Douglas fir, Bergel 1985, because the DLR map has many of both here). `YIELD` holds rounded mean
   heights (Mittelhöhe) of the site classes I (good), II and III (poor) every 10–20 years; the age range is
   [age on class I, age on class II, age on class III] at the tree's height: a tall tree on a good site is young, on a
   poor site old. The LiDAR top is a dominant tree, about DOMINANT_OFFSET_M taller than the stand mean height the
   tables list, so that offset is subtracted first. Results are rounded to 5 years. Above the last tabulated height
   of class III the upper bound is open (`open_hi`, „…+ Jahre“). **Above the last tabulated height of class II** (of
   any table of the group) the middle estimate would only repeat the table's last age, so the tree gets **no age**:
   `beyond: true`, class `beyond` („höher als die Ertragstafel“), lo/mid/hi None (v1 reported the clamped last age,
   which made 14 % of the trees ≥ 8 m „sehr alt“ by construction; review 2026-11-08). Groups without an own table:
   fir and larch → spruce, conifer of unknown species → spruce ∪ pine, birch, alder, other broadleaf → beech ∪ oak,
   unknown → beech ∪ oak ∪ spruce (union = widest range). Below MIN_HEIGHT_M no age is given. Yield
   tables describe trees in a closed forest stand; a solitary tree in a garden or field grows wide rather than tall,
   so there the true age is usually higher than the estimate (the app says so).
   Age classes (`AGE_CLASSES`, by the middle value): jung < 40, mittelalt 40–80, alt 80–120, sehr alt ≥ 120 years;
   per place the trees beyond the tables form their own share `beyond` (by crown area), and the median age is taken
   over the trees with an estimate only.

2. **Forest continuity from the historic maps** (`forest_hist`, historic_forest.py): the share of a place's crown
   area that is forest on **every classified** map epoch (today: only the TK25 1935–40 is classified; „seit 1840“
   needs a second classified map, see historic_forest.py). Only where a forest_hist mask exists (the AOI `overall`
   now; the stats bbox `orte` once `historic_forest.py orte` has run), with the covered share reported.

Species per tree for (1): the DLR *Tree Species Germany* 2022 raster (10 m, CC BY 4.0) when its stats-bbox crop
(data/raw/dlr-tree-species/, fetched by the species step) is present, else the tree's broadleaf/conifer type.

Output: data/work/orte/forest_age_by_place.json (aggregates per place only; work file, stats.py publishes later).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import sys
import time
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np

from common import APP_DATA, RAW_DIR, WORK_DIR

ORTE_WORK = WORK_DIR / "orte"
OUT = ORTE_WORK / "forest_age_by_place.json"
FORMAT = "sle-orte-forest-age-v1"
METHOD = "tree-age-height-v2"

DOMINANT_OFFSET_M = 2.0
MIN_HEIGHT_M = 8.0
ROUND_Y = 5

# Rounded mean heights (m) of the yield tables, site classes I / II / III (mäßige Durchforstung). Read off the
# printed tables approximately; good to about ±1 m, which is far inside the ±20 y the method claims.
YIELD: dict[str, dict[str, Any]] = {
    "beech": {"source": "Schober 1967 (Buche, mäßige Durchforstung)",
              "ages": [30, 40, 60, 80, 100, 120, 140, 160],
              "I": [11.0, 15.0, 22.0, 27.0, 30.5, 33.0, 34.5, 35.5],
              "II": [8.5, 12.0, 18.5, 23.5, 27.0, 29.5, 31.0, 32.0],
              "III": [6.0, 9.0, 15.0, 19.5, 23.0, 25.5, 27.0, 28.0]},
    "oak": {"source": "Jüttner 1955 (Eiche, mäßige Durchforstung)",
            "ages": [30, 40, 60, 80, 100, 120, 140, 160, 180, 200],
            "I": [10.5, 13.5, 18.5, 22.5, 25.5, 28.0, 30.0, 31.5, 32.5, 33.5],
            "II": [8.0, 11.0, 15.5, 19.5, 22.5, 25.0, 27.0, 28.5, 29.5, 30.5],
            "III": [6.0, 8.5, 12.5, 16.0, 19.0, 21.5, 23.5, 25.0, 26.0, 27.0]},
    "spruce": {"source": "Wiedemann 1936/42 (Fichte, mäßige Durchforstung)",
               "ages": [20, 30, 40, 60, 80, 100, 120],
               "I": [6.5, 12.0, 17.0, 24.5, 29.5, 33.0, 35.0],
               "II": [5.0, 9.5, 14.0, 21.0, 26.0, 29.5, 31.5],
               "III": [3.5, 7.5, 11.0, 17.5, 22.0, 25.5, 28.0]},
    # not asked for by the plan, but the DLR map has 10–25 % pine and 5–10 % Douglas fir here, whose height growth
    # differs strongly from spruce (Douglas fir much faster, pine slower)
    "pine": {"source": "Wiedemann 1943 (Kiefer, mäßige Durchforstung)",
             "ages": [20, 40, 60, 80, 100, 120, 140],
             "I": [7.0, 15.0, 20.5, 24.5, 27.5, 29.5, 31.0],
             "II": [5.0, 12.0, 17.0, 21.0, 23.5, 25.5, 27.0],
             "III": [3.5, 9.5, 13.5, 17.0, 19.5, 21.5, 23.0]},
    "douglas": {"source": "Bergel 1985 (Douglasie, mäßige Durchforstung)",
                "ages": [20, 40, 60, 80, 100],
                "I": [10.0, 23.0, 32.0, 38.0, 42.0],
                "II": [8.0, 19.0, 27.0, 33.0, 37.0],
                "III": [6.0, 15.0, 22.0, 27.0, 31.0]},
}
# species group → yield tables used (union when several)
GROUP_TABLES: dict[str, tuple[str, ...]] = {
    "beech": ("beech",), "oak": ("oak",), "spruce": ("spruce",), "fir": ("spruce",), "douglas": ("douglas",),
    "pine": ("pine",), "larch": ("spruce",), "conifer": ("spruce", "pine"),
    "birch": ("beech", "oak"), "alder": ("beech", "oak"), "other": ("beech", "oak"), "broadleaf": ("beech", "oak"),
    "unknown": ("beech", "oak", "spruce"),
}
AGE_CLASSES: tuple[tuple[str, float, float, str], ...] = (
    ("young", 0, 40, "jung (unter 40 Jahre)"),
    ("middle", 40, 80, "mittelalt (40–80 Jahre)"),
    ("old", 80, 120, "alt (80–120 Jahre)"),
    ("very_old", 120, math.inf, "sehr alt (über 120 Jahre)"),
)
BEYOND = ("beyond", "höher als die Ertragstafel (ohne Alter)")
# DLR Tree Species Germany pixel values → group
DLR_GROUPS = {0: "pine", 1: "spruce", 2: "douglas", 3: "larch", 4: "fir", 5: "beech", 6: "oak", 7: "birch",
              8: "alder", 9: "other"}
DLR_LOSS = 666
TYPE_GROUPS = {0: "unknown", 1: "conifer", 2: "broadleaf"}


# =================================================================================================== pure
def _age_at(height: float, ages: Sequence[float], heights: Sequence[float]) -> tuple[float, bool]:
    """Age at which a curve reaches `height` (linear between table points, from (0 y, 0 m)); (last age, True) when
    the curve never gets there (open)."""
    a = [0.0, *ages]
    h = [0.0, *heights]
    if height >= h[-1]:
        return float(a[-1]), height > h[-1]
    return float(np.interp(height, h, a)), False


def _round(v: float, step: int = ROUND_Y) -> int:
    return int(step * round(v / step))


def age_class(age: float) -> str:
    for key, lo, hi, _ in AGE_CLASSES:
        if lo <= age < hi:
            return key
    return AGE_CLASSES[-1][0]


def tree_age(height_m: float, group: str = "unknown", *, offset_m: float = DOMINANT_OFFSET_M,
             min_height_m: float = MIN_HEIGHT_M) -> dict[str, Any] | None:
    """Age estimate of one tree from its LiDAR height (pure; module docstring). None below `min_height_m` or for a
    non-finite height. Returns {lo, mid, hi, open_hi, beyond, class, label_de, tables}: years, rounded to 5; for a
    tree above the class-II curve end of any of its tables lo/mid/hi are None and class is 'beyond'."""
    if not math.isfinite(height_m) or height_m < min_height_m:
        return None
    tables = GROUP_TABLES.get(group, GROUP_TABLES["unknown"])
    h = height_m - offset_m
    los, mids, his, open_hi, beyond = [], [], [], False, False
    for t in tables:
        y = YIELD[t]
        lo, _ = _age_at(h, y["ages"], y["I"])
        mid, mid_open = _age_at(h, y["ages"], y["II"])
        hi, op = _age_at(h, y["ages"], y["III"])
        los.append(lo)
        mids.append(mid)
        his.append(hi)
        open_hi |= op
        beyond |= mid_open
    if beyond:
        return {"lo": None, "mid": None, "hi": None, "open_hi": True, "beyond": True, "class": BEYOND[0],
                "label_de": "nicht schätzbar: höher als die Ertragstafel", "tables": list(tables)}
    lo, mid, hi = _round(min(los)), _round(float(np.median(mids))), _round(max(his))
    mid = min(max(mid, lo), hi)
    cls = age_class(mid)
    label = f"etwa {lo}–{hi}+ Jahre" if open_hi else f"etwa {lo}–{hi} Jahre"
    return {"lo": lo, "mid": mid, "hi": hi, "open_hi": bool(open_hi), "beyond": False, "class": cls,
            "label_de": label, "tables": list(tables)}


def age_mid_vectorised(h: np.ndarray, groups: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(middle age in years, not rounded, NaN = none; beyond mask) per tree for arrays of heights and group names.
    NaN below MIN_HEIGHT_M and for trees above the class-II table end (`beyond` True there, see tree_age)."""
    out = np.full(h.shape, np.nan)
    beyond = np.zeros(h.shape, bool)
    hh = h.astype(np.float64) - DOMINANT_OFFSET_M
    for g in np.unique(groups):
        sel = (groups == g) & (h >= MIN_HEIGHT_M)
        if not sel.any():
            continue
        mids = []
        over = np.zeros(int(sel.sum()), bool)
        for t in GROUP_TABLES.get(str(g), GROUP_TABLES["unknown"]):
            y = YIELD[t]
            mids.append(np.interp(hh[sel], [0.0, *y["II"]], [0.0, *y["ages"]]))
            over |= hh[sel] > y["II"][-1]
        m = np.median(np.vstack(mids), axis=0)
        m[over] = np.nan
        out[sel] = m
        beyond[np.flatnonzero(sel)[over]] = True
    return out, beyond


def class_shares(mid: np.ndarray, weight: np.ndarray, beyond: np.ndarray | None = None) -> dict[str, float | None]:
    """Weighted share (%) per age class of the trees with an age (NaN = none) and, when `beyond` is given, of the
    trees above the tables (`beyond` key; then the shares are of all trees with an age or beyond). Pure."""
    ok = np.isfinite(mid)
    bey = np.zeros(mid.shape, bool) if beyond is None else (np.asarray(beyond, bool) & ~ok)
    tot = float(weight[ok].sum()) + float(weight[bey].sum())
    out: dict[str, float | None] = {}
    for key, lo, hi, _ in AGE_CLASSES:
        s = ok & (mid >= lo) & (mid < hi)
        out[key] = round(100 * float(weight[s].sum()) / tot, 1) if tot else None
    if beyond is not None:
        out[BEYOND[0]] = round(100 * float(weight[bey].sum()) / tot, 1) if tot else None
    return out


def continuity(values: np.ndarray, epochs: Sequence[Mapping[str, Any]]) -> dict[str, np.ndarray]:
    """forest_hist cell values → boolean arrays: `covered` (in the mask and every classified epoch has a map),
    `forest_all` (forest on every classified epoch), `forest_any`; per classified epoch `forest_<year>`. Pure.
    Unclassified epochs are ignored (their bits mean "unknown")."""
    v = np.asarray(values)
    inside = v != 255
    cl = [e for e in epochs if e.get("classified") and isinstance(e.get("bit"), int)
          and isinstance(e.get("noMapBit"), int)]
    covered = inside.copy()
    f_all = inside.copy()
    f_any = np.zeros(v.shape, bool)
    out: dict[str, np.ndarray] = {}
    for e in cl:
        has = inside & ((v & (1 << e["noMapBit"])) == 0)
        f = has & ((v & (1 << e["bit"])) != 0)
        covered &= has
        f_all &= f
        f_any |= f
        out[f"forest_{e['year']}"] = f
    if not cl:
        covered[:] = False
        f_all[:] = False
    out.update(covered=covered, forest_all=f_all & covered, forest_any=f_any)
    return out


def mask_lookup(E: np.ndarray, N: np.ndarray, img: np.ndarray, e0: float, n_top: float, cell: float) -> np.ndarray:
    """forest_hist pixel value at points (contract lookup: px = floor((E − E0)/cell), py = floor((N_top − N)/cell));
    255 outside. Pure."""
    px = np.floor((E - e0) / cell).astype(np.int64)
    py = np.floor((n_top - N) / cell).astype(np.int64)
    h, w = img.shape
    ok = (px >= 0) & (px < w) & (py >= 0) & (py < h)
    out = np.full(E.shape, 255, np.uint8)
    out[ok] = img[py[ok], px[ok]]
    return out


# =================================================================================================== I/O
def species_groups(E: np.ndarray, N: np.ndarray, types: np.ndarray) -> tuple[np.ndarray, str]:
    """Group name per tree: DLR species raster when present (pixel at the tree, EPSG:3035), else the type."""
    lut = np.array([TYPE_GROUPS.get(t & 0x7F, "unknown") for t in range(256)], dtype=object)
    groups = lut[np.asarray(types, np.int64) & 0xFF]
    tifs = sorted((RAW_DIR / "dlr-tree-species").glob("treespecies_de_2022_*.tif"))
    if not tifs:
        return groups.astype(str), "trees.type (broadleaf/conifer heuristic)"
    import rasterio
    from pyproj import Transformer
    with rasterio.open(tifs[0]) as ds:
        if ds.crs is None or ds.crs.to_epsg() != 3035:
            return groups.astype(str), f"trees.type (DLR raster has CRS {ds.crs}, expected EPSG:3035)"
        a = ds.read(1)
        nod = ds.nodata
        x, y = Transformer.from_crs("EPSG:25832", "EPSG:3035", always_xy=True).transform(E, N)
        r, c = rasterio.transform.rowcol(ds.transform, x, y)
    r, c = np.asarray(r), np.asarray(c)
    ok = (r >= 0) & (r < a.shape[0]) & (c >= 0) & (c < a.shape[1])
    v = np.full(E.shape, -1, np.int64)
    v[ok] = a[r[ok], c[ok]]
    if nod is not None:
        v[v == nod] = -1
    dl = np.array([DLR_GROUPS.get(int(k), "") for k in range(10)], dtype=object)
    use = (v >= 0) & (v <= 9)
    groups[use] = dl[v[use]]
    return groups.astype(str), (f"DLR Tree Species Germany 2022 ({tifs[0].name}, {100 * use.mean():.0f} % of trees); "
                                "else trees.type")


def load_forest_hist(aoi: str) -> tuple[np.ndarray, dict[str, Any], float, float] | None:
    """(u8 image, manifest entry, E0, N_top) of an AOI's forest_hist mask, or None."""
    d = APP_DATA / aoi
    mpath = d / "manifest.json"
    if not mpath.exists():
        return None
    m = json.loads(mpath.read_text())
    fh = m.get("forest_hist")
    if not isinstance(fh, dict) or fh.get("format") != "sle-forest-hist-v1" or not (d / fh["path"]).exists():
        return None
    from PIL import Image
    img = np.asarray(Image.open(d / fh["path"]))
    e0, n0 = m["origin"]["E0"], m["origin"]["N0"]
    return img, fh, float(e0), float(n0 + m["size"]["height"] * m.get("cellSize", 1))


def load_forest_hist_work(name: str = "orte") -> tuple[np.ndarray, dict[str, Any], float, float] | None:
    """Stats-only mask written by `historic_forest.py --stats` (data/work/orte/forest_hist.png + .json), or None."""
    png, js = ORTE_WORK / "forest_hist.png", ORTE_WORK / "forest_hist.json"
    if not (png.exists() and js.exists()):
        return None
    from PIL import Image
    meta = json.loads(js.read_text())
    return np.asarray(Image.open(png)), meta["entry"], float(meta["E0"]), float(meta["N_top"])


def run() -> dict[str, Any]:
    from shapely import STRtree, points
    from shapely.geometry import shape
    t0 = time.time()
    gj = json.loads((ORTE_WORK / "gemarkungen.geojson").read_text())
    feats = gj["features"]
    tr = np.load(ORTE_WORK / "trees.npz")
    E, N, h, r = tr["E"], tr["N"], tr["h"].astype(np.float64), tr["r"].astype(np.float64)
    crown = np.pi * r * r
    groups, species_src = species_groups(E, N, tr["type"].astype(np.int64) & 0x7F)
    mid, beyond = age_mid_vectorised(h, groups)
    # place of each tree
    geoms = [shape(f["geometry"]) for f in feats]
    tree = STRtree(geoms)
    ti, gi = tree.query(points(E, N), predicate="within")
    place_idx = np.full(E.shape, -1, np.int64)
    place_idx[ti] = gi
    masks = []
    for src, loader in (("orte (stats bbox)", lambda: load_forest_hist_work()),
                        ("overall (AOI)", lambda: load_forest_hist("overall"))):
        got = loader()
        if got is not None:
            masks.append((src, *got))
    hist = None
    hist_src = None
    if masks:   # prefer the stats-bbox mask (covers all places), else the AOI mask
        src, img, entry, e0, ntop = masks[0]
        vals = mask_lookup(E, N, img, e0, ntop, float(entry["cellSize"]))
        hist = continuity(vals, entry["epochs"])
        hist_src = {"mask": src, "epochs": [{"year": e["year"], "classified": bool(e.get("classified")),
                                             "label_de": e.get("label_de")} for e in entry["epochs"]],
                    "method": entry.get("method")}
    places = []
    for k, f in enumerate(feats):
        p = f["properties"]
        sel = place_idx == k
        n = int(sel.sum())
        aged = sel & np.isfinite(mid)
        rec: dict[str, Any] = {
            "id": p["id"], "name_de": p["name_de"], "trees": n, "trees_with_age": int(aged.sum()),
            "trees_beyond_tables": int((sel & beyond).sum()),
            "crown_ha": round(float(crown[sel].sum()) / 1e4, 1),
            "age_class_share_pct_by_trees": class_shares(mid[sel], np.ones(n), beyond[sel]),
            "age_class_share_pct_by_crown": class_shares(mid[sel], crown[sel], beyond[sel]),
            "age_mid_median": _round(float(np.nanmedian(mid[aged]))) if aged.any() else None,
            "age_mid_p90": _round(float(np.nanpercentile(mid[aged], 90))) if aged.any() else None,
            "species_groups_pct": {g: round(100 * float((groups[sel] == g).sum()) / n, 1)
                                   for g in sorted(set(groups[sel].tolist()))} if n else {},
        }
        if hist is not None:
            ca = float(crown[sel].sum())
            cov = sel & hist["covered"]
            cov_a = float(crown[cov].sum())
            rec["forest_continuity"] = {
                "covered_crown_pct": round(100 * cov_a / ca, 1) if ca else None,
                "forest_all_classified_pct": round(100 * float(crown[cov & hist["forest_all"]].sum()) / cov_a, 1)
                if cov_a else None,
                **{f"{k2}_pct": round(100 * float(crown[cov & v2].sum()) / cov_a, 1) if cov_a else None
                   for k2, v2 in hist.items() if k2.startswith("forest_") and k2 not in ("forest_all", "forest_any")},
            }
            if not cov_a:
                rec["forest_continuity"]["note"] = "place outside the forest_hist mask"
        places.append(rec)
        print(f"  {p['id']:22s} {n:7d} trees, aged {rec['trees_with_age']:7d}, median {rec['age_mid_median']} y, "
              f"crown by class {rec['age_class_share_pct_by_crown']}"
              + (f", continuity {rec['forest_continuity']}" if hist is not None else ""), flush=True)
    out = {
        "format": FORMAT, "method": METHOD,
        "generated": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "params": {"dominant_offset_m": DOMINANT_OFFSET_M, "min_height_m": MIN_HEIGHT_M, "round_y": ROUND_Y,
                   "age_classes": [{"key": k, "from": lo, "to": None if math.isinf(hi) else hi, "label_de": lab}
                                   for k, lo, hi, lab in AGE_CLASSES]
                   + [{"key": BEYOND[0], "from": None, "to": None, "label_de": BEYOND[1]}]},
        "tree_age_rule": {"id": METHOD, "yield_tables": YIELD, "group_tables": {k: list(v) for k, v in
                                                                                GROUP_TABLES.items()},
                          "note_de": "Alter aus der Baumhöhe nach Ertragstafeln (Schätzung, etwa ±20 Jahre); gilt "
                                     "für Waldbäume, freistehende Bäume sind meist älter; höher als die Tafel: "
                                     "kein Alter"},
        "species_source": species_src,
        "forest_hist": hist_src or {"mask": None, "note": "no forest_hist mask available"},
        "definitions": {
            "age_class_share_pct_by_trees": "share of trees ≥ 8 m per age class (by the middle estimate); 'beyond' = "
                                            "taller than the class-II end of the yield table (no age)",
            "age_class_share_pct_by_crown": "same, weighted by crown area π r²",
            "trees_with_age": "trees ≥ 8 m with an estimate (not beyond the tables)",
            "age_mid_median": "median middle estimate (years) of the trees with an estimate (beyond excluded)",
            "forest_continuity.covered_crown_pct": "share of the place's crown area inside the mask with a map on "
                                                   "every classified epoch",
            "forest_continuity.forest_all_classified_pct": "of the covered crown area: forest on every classified "
                                                           "map (one classified map = a snapshot, not continuity)",
        },
        "attribution": ["Ertragstafeln: Schober 1967 (Buche), Jüttner 1955 (Eiche), Wiedemann 1936/42 (Fichte), "
                        "Wiedemann 1943 (Kiefer), Bergel 1985 (Douglasie)",
                        "© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet (Historische Karten)"]
        + (["Tree Species Germany 2022, DLR, CC BY 4.0 (doi:10.15489/smh8w3j8i962)"]
           if species_src.startswith("DLR") else []),
        "places": places,
    }
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    tmp.replace(OUT)
    print(f"wrote {OUT} [{time.time() - t0:.0f}s]")
    return out


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.parse_args(argv)
    run()


if __name__ == "__main__":
    main(sys.argv[1:])
