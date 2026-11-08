"""Orte im Vergleich, Phase 0: place statistics `sle-stats-v1` (docs/data-contract.md, "Place statistics").

    uv run python stats.py [overall] [--refresh-osm] [--no-manifest]

Reads the stats-area work files in data/work/orte/ (places.py, stats_trees.py, stats_inputs.py) plus the LoD2
footprints (buildings.py cache), one Overpass query for the stats bbox (roads, parking, squares, residential
land use, water, pylons/masts; cached in data/raw/osm-orte/) and the Zensus 2022 regional table (official
municipality totals; cached in data/raw/zensus2022-regional/), and writes for the output AOI:

- app/public/data/<aoi>/stats/places.json     aggregates per place (Gemarkung) and per municipality
- app/public/data/<aoi>/stats/places.geojson  one simplified outline per place ({id, name_de} only)
- manifest key `stats` (owned by this step, replaced on each run) + attribution entries
- data/work/orte/stats_table.md                review table (local)
- data/work/orte/stats_report.json            diagnostics: NDVI class checks, OSM check, tallest-tree rejects

Privacy (plan G1–G3, ADR 0049): only aggregates per place or municipality are written under app/public/data;
no parcel ids, no per-parcel / per-building values, no owner data. Minimum-size rule: an aggregate over fewer
than MIN_COUNT buildings (Ortslage) is published as null and listed in `suppressed`; a place with fewer than
MIN_COUNT parcels is dropped.

Methods (ids are versioned; the parameters are written into places.json `method[*].params`):
- assign `parcel-pip-v1`: a tree belongs to the place whose ALKIS parcel contains its top (first match).
- crown `crown-disc-v1`: crown area = Σ π r²; crown_pct = crown area / official place area (capped at 100).
- biomass `crown-allometry-v2`: D = 0.557·(H·2r)^0.809 cm, AGB = 0.0673·(ρ·D²·H)^0.976 kg, ρ 0.42 conifer /
  0.60 otherwise, the group by species.tree_group (tree-group-v1: a „wahrscheinlich“ DLR class wins over the DOP
  colour type, which reads most conifers as broadleaf; v1 used the colour type only); published as [mid/2, mid, 2·mid] t (the plan's "can be wrong by a factor of 2", G7);
  CO₂ = 1.8 × AGB (carbon share ≈ 0.5 × 44/12).
- ortslage `ortslage-bldg-buffer-50m-v1`: union of LoD2 footprints buffered 50 m, holes < 1 ha closed, parts
  holding fewer than 3 buildings dropped (lone barns, huts), clipped to the place. Checked against OSM
  landuse=residential (overlap per place in params.osm_check).
- green `ndvi-cir-v1`: an Ortslage cell is green when CHM ≥ 3 m or NDVI ≥ T_GREEN (on the SL scale; RLP DOP
  pixels are mapped onto the SL scale with the quantile table of ndvi.json first). canopy_pct = CHM part only.
- sealed `sealed-v1`: not green, not OSM water, and (LoD2 building cell or OSM paved road/parking/square area
  or NDVI < T_BARE). Copernicus imperviousness is not used in v1.
- inhabitants `zensus-grid-area-v1`: Σ Zensus 2022 100 m cells × share of the cell inside the place.
- tallest `tallest-checked-v4`: highest non-fill tree that passes the plausibility checks (crown radius, CHM
  support against spikes, unclipped CHM ≤ 75 m for tops at the detector's 60 m clip, no line-shaped top (crane,
  rotor blade), terrain (gully / bank foot / valley bottom), building and pylon / mast / wind-turbine clearance;
  TALLEST), stands
  outside the Ortslage (no garden tree is published by position, G1/G2) and ≥ edge_clear_m inside the place
  outline (a top on the Gemarkung line may belong to the neighbour; it also stays inside the 10 m-simplified
  published outline). Tops above the app's 45 m detector cap are kept by stats_trees.py and counted everywhere
  (trees, crown, biomass) only when they pass the same plausibility checks. `in_trees` says whether the AOI's
  Trees layer holds that tree (False outside the 3D tiles or above the Trees max_height): the app then draws its
  own marker at E/N.
- category `category-inhabitants-v1`: 'stadt' when the place has ≥ 5,000 inhabitants (Zensus grid), else 'dorf'.
- lidar_epoch: the flight year of the majority of the place's LiDAR cells; `lidar_epochs` lists the shares.
- pv_mastr `mastr-municipality-v1`: MaStR PV units in operation per municipality; kWp per inhabitant uses the
  official Zensus 2022 municipality total (Regionaltabelle Bevölkerung), never the grid sum.

Phase 1 (plan §4/§5/§8; every input optional, a missing work file leaves its block null and its source unlisted):
- riesen `riesen-checked-v1`: up to 10 trees per place that pass the tallest-checked-v4 checks, picked by height,
  each ≥ 20 m from the ones before (riesen[0] = tallest); DLR species {key, p} at the top (species.py arrays).
- species `species-dlr-crown-mix-v1`: crown-weighted DLR class mix (species.py per-tree arrays, filtered with T).
- biodiversity `gbif-rarefied-v1`: gbif_by_place.json counts; discipline 'artenvielfalt' ranks rarefied_500.
- forest_age `tree-age-height-v2` + forest_continuity `hist-forest-crown-share-v1`: forest_age_by_place.json.
- nutzung `alkis-nutzung-groups-v1`: nutzung_summary.json (places.py; SL pending while WFS 414 is down).
- roof_potential `roof-pv-potential-v2`: roofs_by_place.json, per place and municipality (+ pv.used_pct).
- goals `goals-examples-v1`: the plan's example goals with the published baseline, progress null.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import math
import re
import sys
import time
import urllib.parse
import zipfile
from collections.abc import Callable, Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

import numpy as np

from common import (APP_DATA, ATTRIBUTION_RLP, ATTRIBUTION_SL, RAW_DIR, WORK_DIR, fmt_bytes, http_open,
                    merge_attribution, update_manifest)

ORTE_DIR = WORK_DIR / "orte"
RASTER_DIR = ORTE_DIR / "rasters"
OSM_RAW = RAW_DIR / "osm-orte"
ZENSUS_REGIONAL = RAW_DIR / "zensus2022-regional" / "Regionaltabelle_Bevoelkerung.xlsx"
ZENSUS_REGIONAL_URL = "https://www.destatis.de/static/DE/zensus/gitterdaten/Regionaltabelle_Bevoelkerung.xlsx"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
ATTRIBUTION_OSM = "© OpenStreetMap-Mitwirkende, ODbL"

FORMAT = "sle-stats-v1"
VERSION = 1
MIN_COUNT = 5
LABEL_DE = "Orte im Vergleich"
DISCLAIMER_DE = ("Schätzungen aus Luftdaten (LiDAR, Luftbild) und offenen Statistiken, keine amtlichen Zahlen. "
                 "Verglichen werden ganze Gemarkungen, nie einzelne Grundstücke, Gebäude oder Personen. "
                 "Gemarkungen sind Katasterbezirke, keine Stadtteile: Grenzen und Einwohner weichen von "
                 "Stadtteilangaben ab. Baumhöhen sind LiDAR-Messungen, nicht vor Ort geprüft. "
                 "Biomasse und CO₂ sind grobe Spannen.")
SIMPLIFY_M = 10.0
PLACES_JSON_MAX = 80 * 1024     # contract size target of places.json (compact JSON, Phase 1 blocks included)
HOLE_MIN_M2 = 10_000.0          # outlines and Ortslage: holes below 1 ha are closed
SLIVER_M2 = 500.0               # outline parts below this left over after removing overlaps are dropped
SNAP_M = 2.0                    # outlines are snapped to their neighbours within this (SL/RLP parcel mismatch)

# --- method parameters -----------------------------------------------------------------------------------------
RHO_CONIFER, RHO_OTHER = 0.42, 0.60
BIOMASS_LO, BIOMASS_HI = 0.5, 2.0
CO2_PER_AGB = 1.8
ORTSLAGE_BUFFER_M = 50.0
ORTSLAGE_MIN_BUILDINGS = 3      # a part of the buffered union needs ≥ 3 buildings to count as settlement
CANOPY_M = 3.0
# NDVI thresholds on the SL pseudo-NDVI scale (8-bit CIR display values; see ndvi.json). Chosen from the classes
# measured inside the Ortslage of all nine places on 2026-11-07 (stats_report.json `ndvi_classes`): LoD2 roofs
# median 0.01 (p90 0.11), OSM paved roads median 0.00 (p90 0.07, p95 0.15), canopy CHM ≥ 3 m median 0.36
# (p5 0.16). T_GREEN = paved p95 / canopy p5; T_BARE ≈ paved p90: below it a cell is treated as non-vegetated
# (unmapped driveways, yards; also bare soil, which NDVI alone cannot tell from asphalt).
T_GREEN = 0.15
T_BARE = 0.08
TALLEST = {"min_crown_r_m": 2.0, "ring_r_m": (1.5, 2.5), "ring_median_frac": 0.75, "disc_r_m": 4.0,
           "disc_frac_min": 0.5, "disc_level_frac": 0.6, "bldg_clear_m": 5, "hazard_clear_m": 30.0,
           "clip_m": 59.9, "max_tree_m": 75.0, "linear_r_m": 8.0, "linear_level_frac": 0.8,
           "linear_ratio_max": 3.0, "ground_r_m": 4.0, "ground_rise_max_m": 3.0, "valley_r_m": 15.0,
           "valley_depth_max_m": 3.0, "edge_clear_m": 10.0,
           "max_candidates": 2000}
# Terrain check: in a gully or at the foot of a steep bank the canopy of the trees on the slope spans the low ground,
# so DSM − DTM there is inflated (Einöd, Beeden, Bechhofen candidates of 2026-11-07: rise 3.2–4.1 m within 4 m,
# flat DSM, no crown apex). Max DTM rise within ground_r_m above the top's ground ≤ ground_rise_max_m (≈ 37° mean
# slope); exceeded by 1.3 % of measured 30–45 m tops and 7 % of the tops above 45 m (stats area, review round 2).
# Valley check (v3): in a wider V-shaped valley the 4 m rise stays below 3 m, yet the canopy of both slopes still
# spans the bottom (Bechhofen candidate 46.9 m of 2026-11-07: flat DSM over a 13 m deep ravine). Mean DTM within
# valley_r_m minus the top's ground ≤ valley_depth_max_m. Measured (stats area): ordinary 30–45 m tops p1 2.7 m,
# p5 1.1 m; tall tops rejected by the 4 m rise median 2.6 m; the ravine candidate 3.9 m; the 8 other winners ≤ 0.6 m.
# Place edge (v3): the top must lie ≥ edge_clear_m inside the full place outline. ALKIS borders are exact to
# ≈ 1 m and the published outline is coverage-simplified by SIMPLIFY_M (10 m), so a top on the line (Bechhofen's
# v2 pick: 0.24 m from the Gemarkung border at a clearing edge) may belong to the neighbour or plot outside it.
# v4 (2026-11-07, review): trees.smooth_chm clips the CHM at 60 m, so a 60.9 m top in Bruchhof-Sanddorf read as
# 60.0 and was rejected as "chm-clip". Tops at the clip (h ≥ clip_m) are now re-measured on the unclipped CHM
# (DSM − DTM from the raw LiDAR tiles, build.py mosaic rules, buildings 0) and kept up to max_tree_m (75 m; the
# tallest trees in Germany are ≈ 67 m). Without a usable unclipped window (raw tiles missing, window cut at the
# data edge) the true height is unknown and the v3 rule stays: "chm-clip" (remeasure_at_clip). Above it they are masts, wind turbines or cranes ("too-tall": 55 tops at the
# clip in the stats area, 50 of them 70–181 m in two wind farms and at a mast). Hazards now include OSM wind
# turbines (power=generator + generator:source=wind) and the clearance is 30 m. Linear test: the cells ≥
# linear_level_frac · h connected to the top within linear_r_m must not form a line (principal-axis ratio ≤
# linear_ratio_max): a crane jib, a rotor blade or a power line is long and thin, a crown top is round (two 60 m
# cranes in Zweibrücken: ratio 5.5 and 6.8; 45–60 m tree tops: median 1.3, p95 2.0).
TALLEST_ID = "tallest-checked-v4"
APP_MAX_HEIGHT = 45.0           # trees.Params.max_height: the app drops taller tops; stats checks them instead
LIDAR_EPOCH = {0: 2025, 1: 2022}   # src.tif code → flight year (0 LVGL-SL ALS 2025, 1 LVermGeoRP 2022)

# Fairness size class (plan §5: town vs village). By inhabitants, not by legal status: Erbach-Reiskirchen (a
# Homburg district of ≈ 12,600) competes with the towns, not with villages of 900–3,600.
STADT_MIN_INHABITANTS = 5000

ROAD_WIDTH_M = {  # total carriageway width when OSM has no usable `width` tag
    "motorway": 11.0, "trunk": 9.0, "primary": 8.0, "secondary": 7.0, "tertiary": 6.5, "unclassified": 5.0,
    "residential": 5.5, "living_street": 5.0, "service": 4.0, "pedestrian": 5.0, "road": 5.0, "busway": 4.0,
    "motorway_link": 6.0, "trunk_link": 6.0, "primary_link": 6.0, "secondary_link": 6.0, "tertiary_link": 6.0,
}
MINOR_WIDTH_M = {"track": 3.0, "footway": 2.0, "cycleway": 2.0, "path": 1.5, "steps": 2.0, "bridleway": 2.0}
UNPAVED = {"unpaved", "gravel", "fine_gravel", "compacted", "dirt", "earth", "ground", "grass", "grass_paver",
           "mud", "sand", "woodchips", "pebblestone", "rock", "soil", "wood"}
PAVED = {"paved", "asphalt", "concrete", "concrete:plates", "concrete:lanes", "paving_stones", "sett",
         "cobblestone", "unhewn_cobblestone", "metal", "bricks"}
HAZARD_MAN_MADE = {"mast", "tower", "chimney", "communications_tower"}

# --- Phase 1 (plan §4/§5/§8): species, Riesen, biodiversity, forest age/continuity, land use, roofs, goals --------
# Work files of the Phase 1 steps (all optional: a missing file leaves its block null / its input unlisted).
PHASE1_FILES = {"species": "species_by_place.json", "gbif": "gbif_by_place.json", "roofs": "roofs_by_place.json",
                "forest_age": "forest_age_by_place.json", "nutzung": "nutzung_summary.json"}
RIESEN = {"n": 10, "min_spacing_m": 20.0, "max_checks": 2000}   # = TALLEST max_candidates: the first pick is the v4 winner
RIESEN_ID = "riesen-checked-v1"
# The weakest DLR classes in the stats area (contract "Tree species", cross-check: alder 7 %, other 6 % agreement
# with Thünen): the app must not single out such a tree, so a Riese never carries them.
RIESEN_NO_SPECIES = ("alder", "other_broadleaf")
SPECIES_MIX_ID = "species-dlr-crown-mix-v1"
BIOMASS_ID = "crown-allometry-v2"
# DLR classes the Thünen cross-check agrees with for < 10 % of their cells here: flagged `weak` in the mix.
SPECIES_WEAK = RIESEN_NO_SPECIES
BIODIV_ID = "gbif-rarefied-v1"
BIODIV_N = 500
FOREST_AGE_ID = "tree-age-height-v2"
CONTINUITY_ID = "hist-forest-crown-share-v1"
CONTINUITY_MIN_COVER_PCT = 50.0   # below this share of the crown area inside the historic mask → no value
NUTZUNG_ID = "alkis-nutzung-groups-v1"
NUTZUNG_GROUPS = ("forest", "agriculture", "garden_green", "settlement", "traffic", "water", "other")
ROOF_ID = "roof-pv-potential-v2"
GOALS_ID = "goals-examples-v1"
GOAL_YEAR = 2030
AGE_CLASSES = ("young", "middle", "old", "very_old", "beyond")   # beyond: taller than the yield table


# =============================================================================================== pure helpers
def slugify(name: str) -> str:
    """Contract slug: lowercase, ä→ae ö→oe ü→ue ß→ss, other non [a-z0-9] runs → '-'."""
    s = name.lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        s = s.replace(a, b)
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def sort_key_de(name: str) -> str:
    """German dictionary order (umlauts sort as their base letter)."""
    s = name.lower()
    for a, b in (("ä", "a"), ("ö", "o"), ("ü", "u"), ("ß", "ss")):
        s = s.replace(a, b)
    return s


def _num(v: float) -> int | float:
    v = float(v)
    return int(v) if v.is_integer() and abs(v) < 2 ** 53 else v


def round_sig(x: float | None, n: int = 2) -> int | float | None:
    """Round to n significant digits (integers come out as int)."""
    if x is None or not math.isfinite(x):
        return None
    if x == 0:
        return 0
    return _num(float(f"{x:.{n}g}"))


def round_to(x: float | None, step: float) -> int | float | None:
    if x is None or not math.isfinite(x):
        return None
    if step >= 1:
        return int(round(x / step) * step)
    nd = max(0, -int(math.floor(math.log10(step) + 1e-9)))
    return _num(round(round(x / step) * step, nd))


def round_range(r: Sequence[float]) -> list:
    """Range [lo, mid, hi], each bound to 2 significant digits (monotone rounding keeps lo ≤ mid ≤ hi)."""
    lo, mid, hi = (float(v) for v in r)
    if not lo <= mid <= hi:
        raise ValueError(f"range not ordered: {r}")
    return [round_sig(lo), round_sig(mid), round_sig(hi)]


def agb_kg(h: np.ndarray, r: np.ndarray, conifer: np.ndarray) -> np.ndarray:
    """Above-ground dry biomass per tree (kg), crown-allometry-v1."""
    h = np.asarray(h, np.float64)
    d_cm = 0.557 * (h * 2.0 * np.asarray(r, np.float64)) ** 0.809
    rho = np.where(np.asarray(conifer, bool), RHO_CONIFER, RHO_OTHER)
    return 0.0673 * (rho * d_cm ** 2 * h) ** 0.976


def biomass_range_t(total_kg: float) -> tuple[list[float], list[float]]:
    """(agb_t, co2_t) as unrounded [lo, mid, hi] in tonnes."""
    mid = total_kg / 1000.0
    agb = [mid * BIOMASS_LO, mid, mid * BIOMASS_HI]
    return agb, [v * CO2_PER_AGB for v in agb]


def share_pct(part: float, whole: float, cap: float = 100.0) -> float | None:
    if not whole or whole <= 0:
        return None
    return min(cap, 100.0 * part / whole)


def assign_points(x: np.ndarray, y: np.ndarray, geoms: Sequence[Any]) -> np.ndarray:
    """Index of the first polygon (lowest index) that covers each point, −1 if none (parcel-pip-v1)."""
    import shapely
    from shapely import STRtree
    out = np.full(len(x), -1, np.int64)
    if not len(x) or not len(geoms):
        return out
    tree = STRtree(list(geoms))
    pi, gi = tree.query(shapely.points(np.asarray(x, float), np.asarray(y, float)), predicate="intersects")
    if len(pi):
        order = np.lexsort((gi, pi))
        pi, gi = pi[order], gi[order]
        first = np.ones(len(pi), bool)
        first[1:] = pi[1:] != pi[:-1]
        out[pi[first]] = gi[first]
    return out


def fill_small_holes(geom, min_area: float = HOLE_MIN_M2):
    """Drop interior rings smaller than min_area (m²) from a Polygon / MultiPolygon."""
    import shapely
    from shapely.geometry import MultiPolygon, Polygon
    if geom is None or geom.is_empty:
        return geom
    polys = []
    for p in shapely.get_parts(geom):
        if not isinstance(p, Polygon):
            continue
        keep = [r for r in p.interiors if Polygon(r).area >= min_area]
        polys.append(Polygon(p.exterior, keep))
    if not polys:
        return geom
    return polys[0] if len(polys) == 1 else shapely.union_all(MultiPolygon(polys))


def ortslage_geometry(footprints: Sequence[Any], buffer_m: float = ORTSLAGE_BUFFER_M,
                      min_hole_m2: float = HOLE_MIN_M2, min_buildings: int = ORTSLAGE_MIN_BUILDINGS):
    """ortslage-bldg-buffer-50m-v1 (before clipping to a place): union of footprints buffered `buffer_m`,
    holes < min_hole_m2 closed, parts with fewer than `min_buildings` buildings dropped. Returns
    (geometry | None, info)."""
    import shapely
    from shapely import STRtree
    fps = [f for f in footprints if f is not None and not f.is_empty]
    if not fps:
        return None, {"parts": 0, "parts_dropped": 0, "buildings_dropped": 0}
    arr = np.array(fps, dtype=object)
    union = shapely.union_all(shapely.buffer(arr, buffer_m, quad_segs=4))
    parts = [fill_small_holes(p, min_hole_m2) for p in shapely.get_parts(union)]
    reps = shapely.points([f.representative_point().coords[0] for f in fps])
    tree = STRtree(parts)
    pi, gi = tree.query(reps, predicate="intersects")
    count = np.bincount(gi, minlength=len(parts)) if len(gi) else np.zeros(len(parts), int)
    keep = [p for p, c in zip(parts, count) if c >= min_buildings]
    info = {"parts": len(keep), "parts_dropped": len(parts) - len(keep),
            "buildings_dropped": int(count[count < min_buildings].sum())}
    return (shapely.union_all(keep) if keep else None), info


def cover_counts(inside: np.ndarray, chm: np.ndarray, ndvi_sl: np.ndarray, bldg: np.ndarray, paved: np.ndarray,
                 water: np.ndarray, t_green: float = T_GREEN, t_bare: float = T_BARE) -> dict[str, int]:
    """Cell counts for ndvi-cir-v1 / sealed-v1 inside a mask. `ndvi_sl` is NDVI on the SL scale (NaN = none)."""
    inside = np.asarray(inside, bool)
    finite = np.isfinite(chm) & np.isfinite(ndvi_sl)
    valid = inside & finite
    canopy = valid & (np.nan_to_num(chm) >= CANOPY_M)
    nd = np.nan_to_num(ndvi_sl, nan=-9.0)
    green = valid & (canopy | (nd >= t_green))
    sealed = valid & ~green & ~np.asarray(water, bool) & (np.asarray(bldg, bool) | np.asarray(paved, bool)
                                                           | (nd < t_bare))
    return {"inside": int(inside.sum()), "valid": int(valid.sum()), "canopy": int(canopy.sum()),
            "green": int(green.sum()), "sealed": int(sealed.sum())}


def cover_shares(c: Mapping[str, int]) -> dict[str, float | None]:
    v = c["valid"]
    return {"canopy_pct": share_pct(c["canopy"], v), "green_pct": share_pct(c["green"], v),
            "sealed_pct": share_pct(c["sealed"], v)}


def zensus_cell_polygons(x3035: np.ndarray, y3035: np.ndarray, size: float = 100.0):
    """INSPIRE grid cells (centre in EPSG:3035) as polygons in EPSG:25832 (corners transformed)."""
    import shapely
    from pyproj import Transformer
    tr = Transformer.from_crs("EPSG:3035", "EPSG:25832", always_xy=True)
    h = size / 2
    x, y = np.asarray(x3035, float), np.asarray(y3035, float)
    cx = np.stack([x - h, x + h, x + h, x - h, x - h], 1)
    cy = np.stack([y - h, y - h, y + h, y + h, y - h], 1)
    e, n = tr.transform(cx.ravel(), cy.ravel())
    coords = np.stack([np.asarray(e).reshape(cx.shape), np.asarray(n).reshape(cy.shape)], 2)
    return shapely.polygons(coords)


def apportion(cells: Sequence[Any], values: np.ndarray, geom) -> float:
    """Σ value × (cell area inside geom / cell area)  (zensus-grid-area-v1)."""
    import shapely
    if geom is None or geom.is_empty or not len(cells):
        return 0.0
    cells = np.asarray(cells, dtype=object)
    shapely.prepare(geom)
    hit = shapely.intersects(geom, cells)
    if not hit.any():
        return 0.0
    c = cells[hit]
    frac = shapely.area(shapely.intersection(c, geom)) / shapely.area(c)
    return float((np.asarray(values, float)[hit] * frac).sum())


def spike_reason(win: np.ndarray, h: float, r: float, p: Mapping[str, Any] = TALLEST) -> str | None:
    """CHM support test for a tree top at the window centre (1 m cells). None = plausible tree crown."""
    if r < p["min_crown_r_m"]:
        return "crown"
    k = win.shape[0] // 2
    yy, xx = np.mgrid[-k:k + 1, -k:k + 1]
    d = np.hypot(yy, xx)
    w = np.nan_to_num(win, nan=0.0)
    ring = w[(d > p["ring_r_m"][0]) & (d <= p["ring_r_m"][1])]
    if ring.size == 0 or np.median(ring) < p["ring_median_frac"] * h:
        return "spike"
    disc = w[d <= p["disc_r_m"]]
    if (disc >= p["disc_level_frac"] * h).mean() < p["disc_frac_min"]:
        return "narrow"
    return None


def ground_rise(dtm_win: np.ndarray, radius: float) -> float:
    """Max DTM rise (m) within `radius` of the window centre above the centre cell (NaN cells ignored)."""
    k = dtm_win.shape[0] // 2
    yy, xx = np.mgrid[-k:k + 1, -k:k + 1]
    v = dtm_win[(np.hypot(yy, xx) <= radius) & np.isfinite(dtm_win)]
    c = dtm_win[k, k]
    return float(v.max() - c) if v.size and np.isfinite(c) else math.inf


def valley_depth(dtm_win: np.ndarray, radius: float) -> float:
    """Mean DTM within `radius` of the window centre minus the centre (m; > 0 = the top stands in a hollow)."""
    k = dtm_win.shape[0] // 2
    yy, xx = np.mgrid[-k:k + 1, -k:k + 1]
    v = dtm_win[(np.hypot(yy, xx) <= radius) & np.isfinite(dtm_win)]
    c = dtm_win[k, k]
    return float(v.mean() - c) if v.size and np.isfinite(c) else math.inf


def chm_pad(p: Mapping[str, Any] = TALLEST) -> int:
    """Half side (cells) of the CHM window `tree_reason` expects: covers the disc and the linear test."""
    return max(int(math.ceil(p["disc_r_m"])), int(math.ceil(p["linear_r_m"])))


def linear_ratio(win: np.ndarray, h: float, p: Mapping[str, Any] = TALLEST) -> float:
    """Elongation of the top's high part (pure): the cells ≥ linear_level_frac · h within linear_r_m that are
    8-connected to the window centre, as the ratio of their principal axes (√ of the covariance eigenvalues, each
    cell counted as a unit square). ≈ 1 for a round crown top, ≫ 1 for a crane jib, rotor blade or cable."""
    from scipy import ndimage
    k = win.shape[0] // 2
    yy, xx = np.mgrid[-k:k + 1, -k:k + 1]
    m = (np.nan_to_num(win, nan=0.0) >= p["linear_level_frac"] * h) & (np.hypot(yy, xx) <= p["linear_r_m"])
    lab, _ = ndimage.label(m, structure=np.ones((3, 3), bool))
    if lab[k, k] == 0:
        return 1.0
    sel = lab == lab[k, k]
    if sel.sum() < 2:
        return 1.0
    cov = np.cov(np.c_[xx[sel], yy[sel]].T.astype(np.float64)) + np.eye(2) / 12.0
    lo, hi = np.linalg.eigvalsh(cov)
    return float(math.sqrt(hi / lo))


def remeasure_at_clip(h: float, chm_win: np.ndarray, raw_win: np.ndarray | None,
                      p: Mapping[str, Any] = TALLEST) -> tuple[float, np.ndarray, str | None]:
    """Height of a top at the detector's 60 m CHM clip (pure). Below clip_m: (h, chm_win, None) unchanged. At the
    clip: re-measured on the unclipped CHM window `raw_win` (side 2·chm_pad+1, same shape as `chm_win`) →
    (unclipped h, raw_win, None). Without a usable unclipped window (None from `unclipped_chm`, a shape mismatch,
    no finite value at the top) the true height is unknown and the v3 rejection holds: (h, chm_win, "chm-clip")."""
    if h < p["clip_m"]:
        return h, chm_win, None
    k = chm_pad(p)
    if raw_win is None or chm_win.shape != (2 * k + 1, 2 * k + 1) or raw_win.shape != chm_win.shape \
            or not np.isfinite(raw_win[k, k]):
        return h, chm_win, "chm-clip"
    return float(raw_win[k, k]), raw_win, None


def tree_reason(h: float, r: float, hazard_dist_m: float, chm_win: np.ndarray, bldg_win: np.ndarray | None,
                dtm_win: np.ndarray | None = None, p: Mapping[str, Any] = TALLEST) -> str | None:
    """Plausibility of one tree top (pure). `h`: CHM at the top (the unclipped CHM for tops at the detector clip);
    `chm_win`: CHM (1 m) of side 2·chm_pad+1 centred on the top (unclipped for tops at the clip);
    `dtm_win`: DTM (1 m) of side 2·ceil(valley_r_m)+1 centred on the top; `bldg_win`: building mask within
    bldg_clear_m; `hazard_dist_m`: distance to the nearest OSM pylon / mast / tower / chimney / wind turbine.
    None = plausible tree; else the reason."""
    if hazard_dist_m < p["hazard_clear_m"]:
        return "pylon-or-mast"
    if h > p["max_tree_m"]:
        return "too-tall"
    k, kv = chm_pad(p), int(math.ceil(p["valley_r_m"]))
    kd = int(math.ceil(p["disc_r_m"]))
    if chm_win.shape != (2 * k + 1, 2 * k + 1) or (dtm_win is not None and dtm_win.shape != (2 * kv + 1, 2 * kv + 1)):
        return "edge"
    if bldg_win is not None and np.asarray(bldg_win).any():
        return "building"
    if dtm_win is not None:
        if ground_rise(dtm_win[kv - kd:kv + kd + 1, kv - kd:kv + kd + 1], p["ground_r_m"]) > p["ground_rise_max_m"]:
            return "terrain"
        if valley_depth(dtm_win, p["valley_r_m"]) > p["valley_depth_max_m"]:
            return "valley"
    why = spike_reason(chm_win, h, r, p)
    if why is None and linear_ratio(chm_win, h, p) > p["linear_ratio_max"]:
        return "linear"
    return why


def size_category(inhabitants: float | None, min_inh: int = STADT_MIN_INHABITANTS) -> str:
    """Fairness group: 'stadt' from min_inh inhabitants on (grid estimate), else 'dorf'."""
    return "stadt" if inhabitants is not None and inhabitants >= min_inh else "dorf"


def lidar_epochs(src_values: np.ndarray) -> tuple[int | None, list[list[float]]]:
    """src.tif codes inside a place → (majority flight year, [[year, share % of LiDAR cells], …] by share desc)."""
    v = np.asarray(src_values)
    n = {y: int((v == c).sum()) for c, y in LIDAR_EPOCH.items()}
    tot = sum(n.values())
    if not tot:
        return None, []
    rows = sorted(([y, 100.0 * k / tot] for y, k in n.items() if k), key=lambda r: (-r[1], -r[0]))
    return rows[0][0], rows


def pick_tallest(h: np.ndarray, fill: np.ndarray, ids: np.ndarray, check: Callable[[int], str | None],
                 max_candidates: int = TALLEST["max_candidates"]) -> tuple[int, dict[str, int]]:
    """Highest non-fill tree whose `check(i)` returns None. Ties → lower id. Returns (index | −1, rejects)."""
    idx = np.flatnonzero(~np.asarray(fill, bool))
    order = idx[np.lexsort((np.asarray(ids)[idx], -np.round(np.asarray(h, float)[idx], 2)))]
    rejects: dict[str, int] = {}
    for i in order[:max_candidates]:
        why = check(int(i))
        if why is None:
            return int(i), rejects
        rejects[why] = rejects.get(why, 0) + 1
    return -1, rejects


def edge_reason(outline_boundary, e: float, n: float, p: Mapping[str, Any] = TALLEST) -> str | None:
    """'place-edge' when the top (e, n) lies closer than edge_clear_m to the place outline's boundary."""
    import shapely
    return "place-edge" if shapely.distance(outline_boundary, shapely.Point(e, n)) < p["edge_clear_m"] else None


# ============================================================================================ Phase 1 helpers
def pick_top(h: np.ndarray, fill: np.ndarray, ids: np.ndarray, e: np.ndarray, n: np.ndarray,
             check: Callable[[int], str | None], count: int = RIESEN["n"],
             min_spacing_m: float = RIESEN["min_spacing_m"], max_checks: int = RIESEN["max_checks"]
             ) -> tuple[list[int], dict[str, int]]:
    """riesen-checked-v1 (pure): up to `count` highest non-fill trees whose `check(i)` is None, each at least
    `min_spacing_m` from every tree picked before it (greedy by height, so one tall stand does not fill the list).
    Order as pick_tallest: h (0.01 m) descending, ties → lower id; so the first pick is the tallest-checked-v4
    winner. A candidate too close to an earlier pick is skipped without running `check` ('spacing'); at most
    `max_checks` candidates are checked. Returns (indices in pick order, rejects)."""
    h, e, n = (np.asarray(v, np.float64) for v in (h, e, n))
    ids = np.asarray(ids)
    idx = np.flatnonzero(~np.asarray(fill, bool))
    order = idx[np.lexsort((ids[idx], -np.round(h[idx], 2)))]
    picked: list[int] = []
    rejects: dict[str, int] = {}
    checks = 0
    for i in order:
        if len(picked) >= count or checks >= max_checks:
            break
        i = int(i)
        if picked and float(np.min(np.hypot(e[picked] - e[i], n[picked] - n[i]))) < min_spacing_m:
            rejects["spacing"] = rejects.get("spacing", 0) + 1
            continue
        checks += 1
        why = check(i)
        if why is None:
            picked.append(i)
        else:
            rejects[why] = rejects.get(why, 0) + 1
    return picked, rejects


def competition_ranks(values: Sequence[float]) -> list[int]:
    """1-based standard competition ranks of `values` already sorted descending: equal values share a rank and
    the next rank skips (45.1, 44.0, 44.0, 43.2 → 1, 2, 2, 4). Pure."""
    out: list[int] = []
    for k, v in enumerate(values):
        out.append(out[-1] if k and v == values[k - 1] else k + 1)
    return out


def round_riesen(rows: Sequence[Mapping[str, Any]]) -> list[dict]:
    """Contract rounding of the Riesen list (pick order = h descending): h 0.1 m, E/N exact cell centres, rank by
    competition ranking on the published h, species p as whole %."""
    out = []
    hs = [round_to(r["h"], 0.1) for r in rows]
    for r, h, rank in zip(rows, hs, competition_ranks(hs)):
        q = {"rank": rank, "h": h, "E": float(r["E"]), "N": float(r["N"]), "id": int(r["id"]),
             "in_trees": bool(r.get("in_trees", False))}
        if r.get("species"):
            q["species"] = {"key": str(r["species"]["key"]), "p": int(r["species"]["p"])}
        out.append(q)
    return out


def tree_species_entry(code: int, p: int, tree_type: int | None = None) -> dict | None:
    """{key, p} of one Riese from species.py's per-tree arrays, only when the class is „wahrscheinlich“ (contract
    "Tree species": p ≥ LIKELY_PCT and no conifer-in-broadleaf contradiction for `tree_type`). None for code 255 /
    canopy loss / p 0, for the weak classes RIESEN_NO_SPECIES and for „unsicher“ classes: a 10–40 % class (a lone
    centre cell) on the most-viewed trees was noise, e.g. a 56 m „Lärche? (40 %)“ (review 2026-11-08). Pure."""
    import species as SP
    c = int(code)
    if c not in SP.F1_PCT or int(p) < SP.LIKELY_PCT:
        return None
    if tree_type is not None and SP.contradicts(c, int(tree_type)):
        return None
    key = SP.CLASS_BY_CODE[c][1]
    return None if key in RIESEN_NO_SPECIES else {"key": key, "p": int(p)}


def species_block(code: np.ndarray, r: np.ndarray, min_count: int = MIN_COUNT) -> dict | None:
    """species-dlr-crown-mix-v1 (pure): crown-area-weighted (π r²) mix of the DLR classes of a place's trees
    (code per tree as species.py writes it: 0–9 species, 255 none). `mix` sorted by share descending (ties → lower
    class code), shares of the crown area **with** a species, 0.1 pp, entries that round to 0 dropped; `dominant`
    = first entry; `coverage_pct` = crown area with a species ÷ all crown area; `conifer_pct` = DLR conifer
    classes in the mix; entries of the SPECIES_WEAK classes carry `weak: True` (review 2026-11-08). None when fewer
    than `min_count` trees have a species."""
    import species as SP
    code = np.asarray(code)
    crown = math.pi * np.asarray(r, np.float64) ** 2
    has = np.isin(code, list(SP.F1_PCT))
    if int(has.sum()) < min_count:
        return None
    total, with_sp = float(crown.sum()), float(crown[has].sum())
    if with_sp <= 0:
        return None
    raw = [(c, 100.0 * float(crown[code == c].sum()) / with_sp) for c in sorted(SP.F1_PCT)]
    raw = sorted((x for x in raw if x[1] > 0), key=lambda x: (-x[1], x[0]))
    mix = [{"key": SP.CLASS_BY_CODE[c][1], "share_pct": round_to(v, 0.1)} for c, v in raw]
    mix = [{**m, "weak": True} if m["key"] in SPECIES_WEAK else m for m in mix if m["share_pct"]]
    conifer = np.isin(code, [c[0] for c in SP.CLASSES if c[3] == "conifer"])
    return {"mix": mix, "dominant": mix[0]["key"] if mix else None, "method": SPECIES_MIX_ID,
            "coverage_pct": round_to(100.0 * with_sp / total, 0.1) if total else None,
            "conifer_pct": round_to(100.0 * float(crown[conifer].sum()) / with_sp, 0.1),
            "trees": int(has.sum())}


def biodiversity_block(g: Mapping[str, Any] | None) -> dict | None:
    """gbif-rarefied-v1 (pure): the published aggregate of one gbif_by_place.json place. `rarefied_500` = expected
    species in BIODIV_N random species-level records (Hurlbert; null below BIODIV_N records → `few_records`), whole
    species; ranges [lo, mid, hi] whole species; years [first, last]."""
    if not g or g.get("occurrences") is None or g.get("species") is None:
        return None

    def rng(v):
        return [round_to(float(x), 1) for x in v] if isinstance(v, (list, tuple)) and len(v) == 3 else None
    r5 = rng(g.get("rarefied") if int(g.get("rarefy_n") or BIODIV_N) == BIODIV_N else None)
    y = g.get("years") or {}
    years = [int(y["first"]), int(y["last"])] if y.get("first") is not None and y.get("last") is not None else None
    inat = (g.get("inaturalist") or {}).get("share_pct")
    return {"species": int(g["species"]), "occurrences": int(g["occurrences"]),
            "inat_share_pct": round_to(float(inat), 0.1) if inat is not None else None,
            "rarefied_500": r5[1] if r5 else None, "rarefied_500_range": r5,
            "rarefied_150_range": rng(g.get("rarefied_150")),
            "few_records": r5 is None or "few-records" in (g.get("flags") or []), "years": years}


def forest_blocks(fa: Mapping[str, Any] | None, epochs: Sequence[int] = (1935,),
                  min_cover_pct: float = CONTINUITY_MIN_COVER_PCT, min_count: int = MIN_COUNT
                  ) -> tuple[float | None, dict | None, dict | None]:
    """(forest_continuity_pct, forest_continuity, forest_age) of one forest_age_by_place.json place (pure).
    hist-forest-crown-share-v1: share of the crown area (inside the historic mask) that stood on forest on every
    classified map; null when the mask covers < min_cover_pct of the crown area. One classified map is a snapshot
    (`snapshot: true`), not continuity. tree-age-height-v2: age classes by crown area of the trees ≥ 8 m, with
    `beyond` = trees taller than the class-II table end (no age); median of the middle estimates of the trees with an
    age (5 years); `trees_beyond` counted apart. A v1 work file (no 'beyond' key) omits `beyond`."""
    if not fa:
        return None, None, None
    fc = fa.get("forest_continuity") or {}
    cont, cpct = None, None
    if fc.get("covered_crown_pct") is not None:
        cov = float(fc["covered_crown_pct"])
        cont = {"covered_pct": round_to(cov, 0.1), "epochs": [int(e) for e in epochs], "snapshot": len(epochs) < 2}
        if cov >= min_cover_pct and fc.get("forest_all_classified_pct") is not None:
            cpct = round_to(float(fc["forest_all_classified_pct"]), 0.1)
    age = None
    cls = fa.get("age_class_share_pct_by_crown") or {}
    if int(fa.get("trees_with_age") or 0) >= min_count and cls:
        age = {"trees": int(fa["trees_with_age"]),
               "trees_beyond": int(fa["trees_beyond_tables"]) if fa.get("trees_beyond_tables") is not None else None,
               "median_y": int(round_to(float(fa["age_mid_median"]), 5)) if fa.get("age_mid_median") is not None else None,
               "classes_pct": {k: round_to(float(cls.get(k, 0.0)), 0.1) for k in AGE_CLASSES
                               if k in cls or k != "beyond"}}
    return cpct, cont, age


def nutzung_block(n: Mapping[str, Any] | None) -> dict | None:
    """alkis-nutzung-groups-v1 (pure): land-use shares of the official area per group, 0.1 pp; None unless the
    place's land use is known (`status: 'ok'`; the SL WFS 414 is pending)."""
    if not n or n.get("status") != "ok" or not isinstance(n.get("share_pct"), Mapping):
        return None
    s = n["share_pct"]
    return {"source": "alkis", "shares_pct": {k: round_to(float(s.get(k, 0.0)), 0.1) for k in NUTZUNG_GROUPS}}


def roof_block(rp: Mapping[str, Any] | None, min_count: int = MIN_COUNT) -> tuple[dict | None, bool]:
    """roof-pv-potential-v2 per place (pure): (block | None, suppressed). Suppressed (minimum-size rule) when the
    place has fewer than `min_count` buildings or roofs.py suppressed it. suitable_m2 (before the usable factors) and
    usable_m2 (the kWp base; only when the work file has it) to 100 m², kwp 2 sig. digits."""
    if not rp:
        return None, False
    if int(rp.get("buildings") or 0) < min_count or rp.get("suppressed"):
        return None, True
    out = {"buildings": int(rp["buildings"]), "suitable_m2": round_to(float(rp["suitable_area_m2"]), 100)}
    if rp.get("usable_area_m2") is not None:
        out["usable_m2"] = round_to(float(rp["usable_area_m2"]), 100)
    out["kwp"] = round_range(rp["kwp"])
    return out, False


def used_reason_de(rm: Mapping[str, Any]) -> str:
    """German one-liner why a municipality's used roof share is not computable (pure)."""
    tail = "Kleine PV-Anlagen meldet das Marktstammdatenregister nur je Gemeinde, daher kein genutzter Anteil."
    miss = list(rm.get("missing_gemarkungen") or [])
    if miss:
        return (f"Dachflächen fehlen für {len(miss)} weitere Gemarkungen der Gemeinde ({', '.join(miss)}). " + tail)
    return "Nicht alle Gemarkungen der Gemeinde sind erfasst. " + tail


def municipality_roofs(rm: Mapping[str, Any] | None, kept: set[str]) -> tuple[dict | None, list | None, str | None]:
    """(roof_potential, used_pct, used_pct_reason_de) of one roofs_by_place.json municipality (pure). used_pct is
    a Range in 0.1 pp only when roofs.py could compute it (all Gemarkungen of the municipality processed)."""
    if not rm or not rm.get("potential_places_kwp"):
        return None, None, None
    pot = {"places": [p for p in rm.get("places", []) if p in kept],
           "suitable_m2": round_to(float(rm["suitable_area_places_m2"]), 100),
           "kwp": round_range(rm["potential_places_kwp"]), "complete": bool(rm.get("complete"))}
    u = rm.get("used_share_pct")
    if isinstance(u, (list, tuple)) and len(u) == 3:
        return pot, [round_to(float(v), 0.1) for v in u], None
    return pot, None, used_reason_de(rm)


def _goal(gid: str, title: str, metric: str | None, unit: str, baseline, baseline_year: int, delta: float,
          measured_by: str, step: float, note_de: str | None = None) -> dict:
    target = None if baseline is None else round_to(baseline + delta, step)
    g = {"id": gid, "title_de": title, "metric": metric, "unit": unit, "baseline": baseline,
         "baseline_year": int(baseline_year), "target": target, "target_delta": _num(delta),
         "target_year": GOAL_YEAR, "measured_by": measured_by, "progress": None}
    if note_de:
        g["note_de"] = note_de
    return g


def _de_int(v: float) -> str:
    return f"{int(round(v)):,}".replace(",", ".")


def goals_for(p: Mapping[str, Any], generated_year: int) -> list[dict]:
    """goals-examples-v1 (pure, on a rounded place): the plan's §5 example goals with the place's published
    baseline. `progress` stays null until a second LiDAR epoch (measured_by 'lidar') or community data
    (measured_by 'community', Phase 2) exists. Goals without a measurable baseline carry baseline/target null."""
    out = []
    o = p.get("ortslage") or {}
    epoch = int(p.get("lidar_epoch") or generated_year)
    if o.get("canopy_pct") is not None:
        out.append(_goal("kronen-ortslage", f"+2 Prozentpunkte Kronenanteil in der Ortslage bis {GOAL_YEAR}",
                         "ortslage.canopy_pct", "%", o["canopy_pct"], epoch, 2.0, "lidar", 0.1))
    if o.get("sealed_pct") is not None and o.get("area_ha") is not None:
        # A deed counter (m² unsealed since the baseline year, 0 → 1,000), not the sealed total: 1,000 m² of
        # several km² would be an invisible 0.03 % step and is below what aerial data resolve (review 2026-11-08).
        sealed_m2 = round_to(o["area_ha"] * 1e4 * o["sealed_pct"] / 100.0, 100)
        out.append(_goal("entsiegeln", f"1.000 m² Fläche in der Ortslage entsiegeln bis {GOAL_YEAR}",
                         None, "m²", 0, epoch, 1000.0, "community", 100,
                         note_de=f"Zum Vergleich: heute etwa {_de_int(sealed_m2)} m² versiegelt "
                                 f"({str(o['sealed_pct']).replace('.', ',')} % der Ortslage)"))
    n_riesen = len(p.get("riesen") or [])
    if n_riesen:
        out.append(_goal("riesen-bestimmt", f"Alle {n_riesen} Riesen der Gemarkung bestimmt (Art, Stammumfang)",
                         None, "Bäume", 0, generated_year, float(n_riesen), "community", 1))
    out.append(_goal("hecke", f"500 m neue Hecke bis {GOAL_YEAR}", None, "m", None, generated_year, 500.0,
                     "community", 1))
    return out


def chunk_tree_ids(buf: bytes, e_ll: float, n_ll: float) -> np.ndarray:
    """Stable ids (Trees rule) of the records of one sle-trees-v1 chunk whose lower-left corner is (e_ll, n_ll)."""
    from trees import decode_chunk, tree_ids
    _g, rec = decode_chunk(buf)
    e_cell = np.round(e_ll + rec["x"].astype(np.float64) / 10 - 0.5)
    n_cell = np.round(n_ll + rec["y"].astype(np.float64) / 10 - 0.5)
    return tree_ids(e_cell.astype(np.int64), n_cell.astype(np.int64))


def trees_layer_has(aoi_dir: Path, e: float, n: float, tree_id: int) -> bool:
    """True when the AOI's Trees layer (manifest `trees`, sle-trees-v1) holds a record with this id at (e, n)."""
    m = json.loads((aoi_dir / "manifest.json").read_text())
    t = m.get("trees")
    if not isinstance(t, dict) or t.get("format") != "sle-trees-v1":
        return False
    o, s = m["origin"], m["size"]
    e0, n0 = (o["E0"], o["N0"]) if isinstance(o, dict) else o
    w, h = (s["width"], s["height"]) if isinstance(s, dict) else s
    cs = int(m.get("chunkSize") or 500)
    if not (e0 <= e < e0 + w and n0 <= n < n0 + h):
        return False
    i, j = int((e - e0) // cs), int((n0 + h - n) // cs)
    if not any(c[0] == i and c[1] == j for c in t.get("chunks", [])):
        return False
    f = aoi_dir / t["path"].replace("{i}", str(i)).replace("{j}", str(j))
    if not f.exists():
        return False
    return bool((chunk_tree_ids(f.read_bytes(), e0 + i * cs, n0 + h - (j + 1) * cs) == tree_id).any())


def tallest_context(chm_win: np.ndarray, dtm_win: np.ndarray, h: float, stand_r_m: float = 20.0,
                    slope_r_m: float = 4.0) -> dict:
    """Review diagnostics of a tallest pick (pure; 1 m windows centred on the top): mean ground slope (plane fit
    within slope_r_m), CHM p95 of the canopy (≥ 3 m) within stand_r_m, and how far the top stands above it."""
    k = chm_win.shape[0] // 2
    yy, xx = np.mgrid[-k:k + 1, -k:k + 1]
    d = np.hypot(yy, xx)
    sel = (d <= slope_r_m) & np.isfinite(dtm_win)
    slope = None
    if sel.sum() >= 3:
        a = np.c_[xx[sel], yy[sel], np.ones(int(sel.sum()))]
        (gx, gy, _c), *_ = np.linalg.lstsq(a, dtm_win[sel], rcond=None)
        slope = round(math.degrees(math.atan(math.hypot(gx, gy))), 1)
    stand = chm_win[(d <= stand_r_m) & np.isfinite(chm_win) & (chm_win >= CANOPY_M)]
    p95 = float(np.percentile(stand, 95)) if stand.size else None
    return {"slope_deg": slope, "stand_p95_m": None if p95 is None else round(p95, 1),
            "above_stand_p95_m": None if p95 is None else round(h - p95, 1)}


def road_width(tags: Mapping[str, str]) -> float | None:
    """Paved width (m) of an OSM highway line, None when it is not a sealed surface (sealed-v1)."""
    hw = tags.get("highway")
    if not hw or tags.get("area") == "yes" or tags.get("tunnel") in ("yes", "building_passage", "culvert"):
        return None
    surface = tags.get("surface", "")
    if hw in ROAD_WIDTH_M:
        if surface in UNPAVED:
            return None
        default = ROAD_WIDTH_M[hw]
    elif hw in MINOR_WIDTH_M:
        if surface not in PAVED and not (hw == "track" and tags.get("tracktype") == "grade1"):
            return None
        default = MINOR_WIDTH_M[hw]
    else:
        return None
    m = re.match(r"^\s*(\d+(?:[.,]\d+)?)\s*(m)?\s*$", tags.get("width", ""))
    if m:
        w = float(m.group(1).replace(",", "."))
        if 1.0 <= w <= 40.0:
            return w
    return default


def _is_paved_area(tags: Mapping[str, str]) -> bool:
    if tags.get("surface", "") in UNPAVED:
        return False
    if tags.get("amenity") == "parking":
        return tags.get("parking") not in ("street_side", "lane", "underground", "multi-storey", "rooftop")
    if tags.get("place") == "square" or "area:highway" in tags:
        return True
    return bool(tags.get("highway")) and tags.get("area") == "yes"


def _is_water(tags: Mapping[str, str]) -> bool:
    return tags.get("natural") == "water" or tags.get("landuse") == "reservoir" or tags.get("waterway") == "riverbank"


def _is_wind_turbine(tags: Mapping[str, str]) -> bool:
    return tags.get("power") == "generator" and (tags.get("generator:source") == "wind"
                                                 or tags.get("generator:method") == "wind_turbine")


def _is_hazard(tags: Mapping[str, str]) -> bool:
    return tags.get("power") == "tower" or tags.get("man_made") in HAZARD_MAN_MADE or _is_wind_turbine(tags)


def _relation_polygon(members: list[dict], project):
    import shapely
    from shapely.geometry import LineString
    from shapely.ops import polygonize

    def rings(role_ok):
        lines = []
        for m in members:
            if m.get("type") != "way" or not role_ok(m.get("role", "")) or len(m.get("geometry") or []) < 2:
                continue
            lines.append(LineString(project(m["geometry"])))
        if not lines:
            return None
        polys = list(polygonize(shapely.union_all(lines)))
        return shapely.union_all(polys) if polys else None

    outer = rings(lambda r: r in ("outer", ""))
    if outer is None:
        return None
    inner = rings(lambda r: r == "inner")
    return outer.difference(inner) if inner is not None else outer


def osm_features(data: Mapping[str, Any], project: Callable[[list[dict]], list[tuple[float, float]]]) -> dict:
    """Overpass `out tags geom` JSON → {'paved': [polys], 'water': [...], 'residential': [...], 'hazards': [(E, N)]}.
    `project` maps a list of {lat, lon} to [(E, N), …] in EPSG:25832."""
    import shapely
    from shapely.geometry import LineString, Polygon
    out: dict[str, list] = {"paved": [], "water": [], "residential": [], "hazards": [], "wind": []}
    for el in data.get("elements", []):
        tags = el.get("tags") or {}
        typ = el.get("type")
        if typ == "node":
            if _is_hazard(tags) and "lat" in el:
                out["hazards"].append(project([el])[0])
                if _is_wind_turbine(tags):
                    out["wind"].append(out["hazards"][-1])
            continue
        geom = None
        if typ == "way" and len(el.get("geometry") or []) >= 2:
            pts = project(el["geometry"])
            closed = len(pts) >= 4 and pts[0] == pts[-1]
            if _is_hazard(tags):
                out["hazards"].append(tuple(LineString(pts).centroid.coords[0]))
                if _is_wind_turbine(tags):
                    out["wind"].append(out["hazards"][-1])
                continue
            w = road_width(tags)
            if w is not None:
                out["paved"].append(LineString(pts).buffer(w / 2, quad_segs=2, cap_style="flat"))
                continue
            if closed:
                geom = Polygon(pts)
        elif typ == "relation" and tags.get("type") in ("multipolygon", None):
            geom = _relation_polygon(el.get("members") or [], project)
        if geom is None or geom.is_empty:
            continue
        geom = shapely.make_valid(geom)
        if _is_paved_area(tags):
            out["paved"].append(geom)
        elif _is_water(tags):
            out["water"].append(geom)
        elif tags.get("landuse") == "residential":
            out["residential"].append(geom)
    return out


def xlsx_rows(path: Path, sheet: str) -> list[list[str | None]]:
    """Minimal .xlsx reader (shared strings + inline values), hardened lxml parser; no openpyxl needed."""
    from lxml import etree
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
          "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
    parser = etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=True)
    with zipfile.ZipFile(path) as z:
        wb = etree.fromstring(z.read("xl/workbook.xml"), parser)
        rels = etree.fromstring(z.read("xl/_rels/workbook.xml.rels"), parser)
        target = {r.get("Id"): r.get("Target") for r in rels}
        rid = next((s.get(f"{{{ns['r']}}}id") for s in wb.findall(".//m:sheet", ns) if s.get("name") == sheet), None)
        if rid is None:
            raise KeyError(f"sheet {sheet!r} not in {path.name}")
        t = target[rid].lstrip("/")
        t = t if t.startswith("xl/") else "xl/" + t
        ss = []
        if "xl/sharedStrings.xml" in z.namelist():
            ss = ["".join(si.itertext()) for si in etree.fromstring(z.read("xl/sharedStrings.xml"), parser)
                  .findall("m:si", ns)]
        root = etree.fromstring(z.read(t), parser)
    rows = []
    for row in root.findall(".//m:sheetData/m:row", ns):
        vals: list[str | None] = []
        for c in row.findall("m:c", ns):
            col = re.match(r"[A-Z]+", c.get("r", "A"))
            ci = 0
            for ch in col.group(0) if col else "A":
                ci = ci * 26 + ord(ch) - 64
            while len(vals) < ci - 1:
                vals.append(None)
            v = c.find("m:v", ns)
            if v is None:
                tnode = c.find(".//m:t", ns)
                vals.append(tnode.text if tnode is not None else None)
            else:
                vals.append(ss[int(v.text)] if c.get("t") == "s" else v.text)
        rows.append(vals)
    return rows


def official_population(rows: Iterable[Sequence[str | None]], ags: str) -> tuple[int | None, str | None]:
    """Zensus 2022 municipality total from the Regionaltabelle rows (ARS, Name, Regionalebene, Bevölkerung …).
    AGS (8 digits) ↔ ARS (12 digits): same Land/Kreis prefix (5) and municipality suffix (3)."""
    for r in rows:
        if len(r) < 3 or not r[0] or r[2] != "Gemeinde":
            continue
        ars = r[0].strip()
        if len(ars) == 12 and ars[:5] == ags[:5] and ars[-3:] == ags[-3:]:
            try:
                return int(float(r[3] if len(r) > 3 else "")), r[1]
            except (TypeError, ValueError):
                return None, r[1]
    return None, None


def bucket_years(rows: Iterable[Sequence[float]], min_count: int = MIN_COUNT) -> list[list[int]]:
    """MaStR commissioning years [(year, systems, kwp)] → buckets of ≥ min_count systems: a year with fewer
    systems is carried into the next year (the bucket keeps the later year); a short tail is merged into the
    last full bucket. kWp rounded to whole kWp after summing. Totals are preserved."""
    out: list[list[float]] = []
    carry_n, carry_k = 0, 0.0
    for y, n, k in sorted((int(a), int(b), float(c)) for a, b, c in rows):
        carry_n += n
        carry_k += k
        if carry_n >= min_count:
            out.append([y, carry_n, carry_k])
            carry_n, carry_k = 0, 0.0
    if carry_n:
        if out:
            out[-1][1] += carry_n
            out[-1][2] += carry_k
        else:
            return []  # fewer than min_count systems in total: no breakdown
    return [[int(y), int(n), int(round(k))] for y, n, k in out]


def apply_min_count(place: dict, min_count: int = MIN_COUNT) -> dict:
    """Minimum-size rule on an (unrounded) place: Ortslage on < min_count buildings → null + suppressed."""
    sup = list(place.get("suppressed", []))
    o = place.get("ortslage")
    if o is not None and o.get("buildings", 0) < min_count:
        place["ortslage"] = None
        sup.append("ortslage")
    place["suppressed"] = sorted(set(sup))
    return place


def round_place(p: Mapping[str, Any]) -> dict:
    """Contract rounding, applied last (shares and per-inhabitant values come in unrounded)."""
    q = dict(p)
    for k in ("parcels", "trees"):
        q[k] = int(p[k])
    for k in ("area_ha", "crown_ha"):
        q[k] = round_to(p[k], 0.1)
    q["crown_pct"] = round_to(p["crown_pct"], 0.1)
    q["aoi_share_pct"] = round_to(p["aoi_share_pct"], 0.1)
    q["agb_t"] = round_range(p["agb_t"])
    q["co2_t"] = round_range(p["co2_t"])
    q["inhabitants"] = round_to(p["inhabitants"], 10) if p.get("inhabitants") is not None else None
    q["trees_per_inhabitant"] = round_sig(p.get("trees_per_inhabitant"))
    q["label"] = [int(round(v)) for v in p["label"]]
    if "lidar_epochs" in p:
        q["lidar_epochs"] = [[int(y), round_to(v, 0.1)] for y, v in p["lidar_epochs"]]
    q["bbox"] = [int(math.floor(p["bbox"][0])), int(math.floor(p["bbox"][1])),
                 int(math.ceil(p["bbox"][2])), int(math.ceil(p["bbox"][3]))]
    if p.get("ortslage") is not None:
        o = p["ortslage"]
        canopy, green = round_to(o["canopy_pct"], 0.1), round_to(o["green_pct"], 0.1)
        sealed = round_to(o["sealed_pct"], 0.1)
        if canopy is not None and green is not None and green < canopy:
            green = canopy
        if green is not None and sealed is not None and green + sealed > 100:
            sealed = round_to(100 - green, 0.1)
        q["ortslage"] = {"area_ha": round_to(o["area_ha"], 0.1), "buildings": int(o["buildings"]),
                         "canopy_pct": canopy, "green_pct": green, "sealed_pct": sealed}
    if p.get("tallest") is not None:
        t = p["tallest"]
        q["tallest"] = {"h": round_to(t["h"], 0.1), "E": float(t["E"]), "N": float(t["N"]), "id": int(t["id"])}
        if "in_trees" in t:
            q["tallest"]["in_trees"] = bool(t["in_trees"])
    if "riesen" in p:
        q["riesen"] = round_riesen(p["riesen"] or [])
    # Phase 1 blocks come in already rounded (species_block, biodiversity_block, forest_blocks, nutzung_block,
    # roof_block); goals are derived from the rounded place afterwards (goals_for).
    return q


def disciplines(biodiversity_ready: bool = True) -> list[dict]:
    def d(id_, name, emoji, desc, measure, unit, hib, method, ready=True, scope="place", note=None):
        out = {"id": id_, "name_de": name, "emoji": emoji, "description_de": desc, "scope": scope,
               "measure": measure, "unit": unit, "higher_is_better": hib, "method": method, "ready": ready}
        if note:
            out["note_de"] = note
        return out
    return [
        d("gruenste-ortslage", "Grünste Ortslage", "🌳",
          "Anteil von Baumkronen und Grün (Luftbild, Nahinfrarot) in der bebauten Ortslage "
          "(Gebäude plus 50 m, auch Gewerbe- und Industrieflächen)",
          "ortslage.green_pct", "%", True, "ndvi-cir-v1"),
        d("wenigsten-beton", "Wenigsten Beton", "🧱",
          "Anteil versiegelter Fläche (Dächer, Straßen, Plätze) in der bebauten Ortslage "
          "(Gebäude plus 50 m, auch Gewerbe- und Industrieflächen)",
          "ortslage.sealed_pct", "%", False, "sealed-v1"),
        d("baeume-pro-einwohner", "Bäume pro Einwohner", "👥",
          "Aus LiDAR erkannte Bäume je Einwohner der Gemarkung (Zensus-2022-Gitter, keine Stadtteilzahlen)",
          "trees_per_inhabitant", "Bäume/Einw.", True,
          "zensus-grid-area-v1"),
        d("waldreichste-gemarkung", "Waldreichste Gemarkung", "🌲",
          "Kronenfläche im Verhältnis zur Fläche der ganzen Gemarkung", "crown_pct", "%", True, "crown-disc-v1"),
        d("riesenbaum", "Riesenbaum", "🏔️",
          "Höchster geprüfter Baum der Gemarkung außerhalb der Ortslage (LiDAR-Höhe, nicht vor Ort gemessen)",
          "tallest.h", "m", True, TALLEST_ID),
        d("sonnenstaerkster-ort", "Sonnenstärkster Ort", "☀️",
          "Installierte Photovoltaik-Leistung je Einwohner der Gemeinde (Marktstammdatenregister)",
          "pv.kwp_per_inhabitant", "kWp/Einw.", True, "mastr-municipality-v1", scope="municipality"),
        d("groesster-fortschritt", "Größter Fortschritt", "📈",
          "Veränderung zwischen zwei Befliegungen (kommt, sobald eine zweite Befliegung vorliegt)", "", "", True, "",
          ready=False),
        d("artenvielfalt", "Artenvielfalt", "🦋",
          "Erwartete Artenzahl in 500 zufällig gezogenen Fundmeldungen (GBIF, u. a. iNaturalist): misst, was "
          "beobachtet und gemeldet wurde, nicht die Qualität der Natur",
          "biodiversity.rarefied_500", "Arten", True, BIODIV_ID, ready=biodiversity_ready,
          note=("Grober Hinweis, keine Messung: hängt stark davon ab, wer wo beobachtet (Vogellisten senken den "
                "Wert, Insektenfotos heben ihn). Orte mit weniger als 500 Meldungen: keine Daten."))
        if biodiversity_ready else
        d("artenvielfalt", "Artenvielfalt", "🦋", "Beobachtete Arten je Ort (kommt in Phase 1)", "", "", True, "",
          ready=False),
    ]


def phase1_methods(src: Mapping[str, Any] | None = None) -> dict:
    """Method entries of the Phase 1 topics; `src` = the loaded Phase 1 work files (params copied from them)."""
    src = src or {}
    gb, rf, fa, nu = (src.get(k) or {} for k in ("gbif", "roofs", "forest_age", "nutzung"))
    gp = gb.get("params") or {}
    fh = fa.get("forest_hist") or {}
    rule = fa.get("tree_age_rule") or {}
    return {
        "species": {"id": SPECIES_MIX_ID, "label_de": "Baumartenmischung nach Kronenfläche (DLR-Karte 2022, Schätzung)",
                    "params": {"source": "DLR Tree Species Germany 2022, 10 m (contract 'Tree species')",
                               "per_tree": "class of the 10 m cell under the tree top (dlr-nearest-25832-v1)",
                               "weight": "crown area π r² (crown-disc-v1)", "assign": "parcel-pip-v1",
                               "share_of": "crown area with a species class", "rounding_pct": 0.1,
                               "coverage": "crown area with a species ÷ all crown area of the place",
                               "no_class": "outside the DLR forest mask (village and garden trees) or canopy loss",
                               "weak": {"classes": list(SPECIES_WEAK),
                                        "why": "Thünen cross-check agrees with < 10 % of their cells here; shares unsure"},
                               "min_trees": MIN_COUNT}},
        "riesen": {"id": RIESEN_ID, "label_de": "Die höchsten geprüften Bäume je Gemarkung",
                   "params": {"n": RIESEN["n"], "min_spacing_m": RIESEN["min_spacing_m"], "checks": TALLEST_ID,
                              "order": "h desc (0.01 m), then id asc; greedy, each ≥ min_spacing_m from the earlier "
                                       "picks", "rank": "competition ranking on the published h (0.1 m)",
                              "species": "species-dlr-neighbourhood-v1 at the top (key, p %), only when "
                                         "„wahrscheinlich“ (p ≥ 50 %, no contradiction); omitted for "
                                         + ", ".join(RIESEN_NO_SPECIES) + ", „unsicher“ classes and trees without a "
                                         "class",
                              "max_checks": RIESEN["max_checks"]}},
        "biodiversity": {"id": BIODIV_ID, "label_de": "Erwartete Artenzahl in 500 Fundmeldungen (GBIF, Rarefaction)",
                         "params": {"source_method": gb.get("method", "gbif-facets-v1"),
                                    "query_date": gb.get("query_date"), "rarefy_n": gp.get("rarefy_n", BIODIV_N),
                                    "rarefy_n_small": gp.get("rarefy_n_small"),
                                    "interval": "± 1.96 SD (Heck 1975, sampling noise only)",
                                    "filters": (gb.get("source") or {}).get("filters"),
                                    "geometry": (gb.get("source") or {}).get("geometry"),
                                    "few_records": "fewer than rarefy_n species-level records → rarefied_500 null",
                                    "caveats": gb.get("caveats"), "stored": "counts only, no record, coordinate "
                                                                            "or species name"}},
        "forest_age": {"id": FOREST_AGE_ID, "label_de": "Alter aus Baumhöhe und Ertragstafel (Schätzung)",
                       "params": {"weight": "crown area π r² of the trees ≥ 8 m", "min_height_m": 8.0,
                                  "median": "median of the middle estimates of the trees with an age, 5 years",
                                  "beyond": "trees taller than the class-II end of their yield table get no age "
                                            "(class 'beyond'; v1 reported the clamped last table age)",
                                  "classes": (fa.get("params") or {}).get("age_classes"),
                                  "species_source": fa.get("species_source"),
                                  "tables": {k: v.get("source") for k, v in (rule.get("yield_tables") or {}).items()},
                                  "tables_note": "rounded table values, not yet checked against the printed tables"}},
        "forest_continuity": {"id": CONTINUITY_ID, "label_de": "Kronenfläche auf Wald der historischen Karten",
                              "params": {"mask": fh.get("mask"), "mask_method": fh.get("method"),
                                         "classified_epochs": [e.get("year") for e in fh.get("epochs", [])
                                                               if e.get("classified")],
                                         "min_cover_pct": CONTINUITY_MIN_COVER_PCT,
                                         "snapshot": "one classified map is a snapshot („laut Karte 1935–40“), "
                                                     "not continuity"}},
        "nutzung": {"id": NUTZUNG_ID, "label_de": "Tatsächliche Nutzung (ALKIS), Anteile der amtlichen Fläche",
                    "params": {"groups": list(NUTZUNG_GROUPS), "rule": nu.get("rule"),
                               "status": {p.get("id"): p.get("status") for p in nu.get("places", [])}}},
        "roof_potential": {"id": ROOF_ID, "label_de": "Für PV geeignete Dachflächen aus LoD2 (Schätzung)",
                           "params": {**(rf.get("params") or {}), "suitable_m2_rounding": 100,
                                      "suitable_m2": "suitable planes before the usable factors",
                                      "usable_m2": "pitched suitable × setback + flat suitable × flat_usable (the kWp base)",
                                      "used_pct": "MaStR Gebäude-PV kWp ÷ potential, only when all Gemarkungen of "
                                                  "the municipality are processed"}},
        "goals": {"id": GOALS_ID, "label_de": "Beispielziele je Gemarkung (Plan §5)",
                  "params": {"target_year": GOAL_YEAR, "progress": "null until a second LiDAR epoch "
                                                                  "(measured_by 'lidar') or community data exists"}},
    }


def methods(osm_check: Mapping[str, Any], ortslage_info: Mapping[str, Any], ndvi_table: bool,
            border: Mapping[str, Any] | None, tall: Mapping[str, Any] | None = None,
            phase1: Mapping[str, Any] | None = None) -> dict:
    crown_params: dict[str, Any] = {"trees": "all trees with their top in the place (fill trees included); tops "
                                             f"above {APP_MAX_HEIGHT:g} m only when they pass the tallest checks",
                                    "cap_pct": 100}
    if border:
        crown_params["rlp_border_effect"] = {
            "trees_per_ha_canopy_rlp_over_sl": border.get("trees_per_ha_canopy_rlp_over_sl"),
            "canopy_cover_diff": border.get("canopy_cover_diff"), "applied": False,
            "note": "RLP 2022 LiDAR finds about +20 % trees per ha of canopy in the same forest; not harmonised"}
    return {
        "assign": {"id": "parcel-pip-v1", "label_de": "Baum gehört zur Gemarkung des Flurstücks unter der Krone",
                   "params": {"predicate": "intersects", "tie": "first parcel"}},
        "crown": {"id": "crown-disc-v1", "label_de": "Kronenfläche als Kreisscheiben", "params": crown_params},
        "biomass": {"id": BIOMASS_ID, "label_de": "Biomasse aus Höhe und Kronendurchmesser (grob)",
                    "params": {"D_cm": "0.557*(H*2r)^0.809", "AGB_kg": "0.0673*(rho*D^2*H)^0.976",
                               "group": "tree-group-v1: a „wahrscheinlich“ DLR class, else the DOP colour type "
                                        "(contract 'Tree species'); v1 used the colour type only",
                               "rho_conifer": RHO_CONIFER, "rho_other": RHO_OTHER, "lo_factor": BIOMASS_LO,
                               "hi_factor": BIOMASS_HI, "co2_per_agb": CO2_PER_AGB}},
        "ortslage": {"id": "ortslage-bldg-buffer-50m-v1", "label_de": "Gebäude (LoD2) plus 50 m Puffer",
                     "params": {"buffer_m": ORTSLAGE_BUFFER_M, "hole_min_ha": HOLE_MIN_M2 / 1e4,
                                "min_buildings_per_part": ORTSLAGE_MIN_BUILDINGS, "quad_segs": 4,
                                "parts": ortslage_info.get("parts"), "osm_check": osm_check}},
        "green": {"id": "ndvi-cir-v1", "label_de": "Baumkronen (CHM ≥ 3 m) oder Grün im Nahinfrarot-Luftbild",
                  "params": {"canopy_min_m": CANOPY_M, "ndvi_green_min": T_GREEN, "ndvi_scale": "SL pseudo-NDVI",
                             "rlp_to_sl_quantile_map": ndvi_table}},
        "sealed": {"id": "sealed-v1", "label_de": "Dächer, Straßen, Parkplätze, Plätze und vegetationsfreie Flächen",
                   "params": {"sources": ["LoD2 building mask", "OSM paved roads (buffered by width)",
                                          "OSM parking / square / area:highway", "NDVI below ndvi_bare_max"],
                              "ndvi_bare_max": T_BARE, "excluded": ["green cells", "OSM water"],
                              "imperviousness": "Copernicus not used in v1",
                              "road_width_m": ROAD_WIDTH_M, "minor_ways_if_paved_m": MINOR_WIDTH_M}},
        "inhabitants": {"id": "zensus-grid-area-v1", "label_de": "Zensus-2022-Gitter, flächenanteilig",
                        "params": {"cell_m": 100, "weight": "area share of the cell inside the place",
                                   "rounding": 10}},
        "tallest": {"id": TALLEST_ID, "label_de": "Höchster plausibler Baum außerhalb der Ortslage",
                    "params": {k: (list(v) if isinstance(v, tuple) else v) for k, v in TALLEST.items()
                               if k != "max_candidates"} | {
                        "detector_clip_m": 60.0, "app_max_height_m": APP_MAX_HEIGHT,
                        "above_app_max": "kept when plausible (same checks), also in trees/crown/biomass",
                        "fill_trees": "excluded", "outside_ortslage": True,
                        "in_trees": "true when the AOI Trees layer holds the tree (by id); else the app draws "
                                    "its own marker (outside the 3D tiles or above the Trees max_height)",
                        "hazards": "OSM power=tower, man_made=mast|tower|chimney|communications_tower, "
                                   "power=generator + generator:source=wind (within hazard_clear_m)",
                        "clip": "tops at the detector clip (h ≥ clip_m) are re-measured on the unclipped CHM "
                                "(DSM − DTM) and kept up to max_tree_m; without unclipped LiDAR they are "
                                "rejected (chm-clip)",
                        **({"tall_trees": dict(tall)} if tall else {})}},
        "category": {"id": "category-inhabitants-v1", "label_de": "Größenklasse nach Einwohnern",
                     "params": {"stadt_min_inhabitants": STADT_MIN_INHABITANTS, "source": "zensus-grid-area-v1"}},
        "pv_mastr": {"id": "mastr-municipality-v1", "label_de": "Marktstammdatenregister, Gemeinde",
                     "params": {"status": "In Betrieb", "power": "Bruttoleistung (kWp)", "balcony": "included",
                                "small_kw": 30, "per_inhabitant": "official Zensus 2022 municipality total",
                                "by_year": f"years with < {MIN_COUNT} systems are carried into the next year"}},
        **phase1_methods(phase1),
    }


# =================================================================================================== I/O
def load_json(name: str) -> dict:
    return json.loads((ORTE_DIR / name).read_text())


def load_phase1(base: Path | None = None) -> dict[str, dict | None]:
    """The Phase 1 work files (PHASE1_FILES) that exist in data/work/orte/, else None per key."""
    base = base or ORTE_DIR
    out: dict[str, dict | None] = {}
    for k, name in PHASE1_FILES.items():
        f = base / name
        out[k] = json.loads(f.read_text()) if f.exists() else None
        if out[k] is None:
            print(f"  (no {name}: {k} left out)")
    return out


def phase1_by_place(ph1: Mapping[str, Any]) -> dict[str, dict]:
    """Per-place lookups {key: {place id: entry}} of the Phase 1 files (+ 'roofs_muni' by AGS). Pure."""
    def by_id(doc, field="places"):
        v = (doc or {}).get(field) or []
        if isinstance(v, Mapping):
            return dict(v)
        return {p["id"]: p for p in v if isinstance(p, Mapping) and "id" in p}
    out = {k: by_id(ph1.get(k)) for k in PHASE1_FILES}
    out["roofs_muni"] = {m["ags"]: m for m in ((ph1.get("roofs") or {}).get("municipalities") or []) if "ags" in m}
    return out


# Place fields filled from each Phase 1 file (an input is listed when at least one place got a value).
PHASE1_FIELDS = {"species": ("species",), "gbif": ("biodiversity",), "roofs": ("roof_potential",),
                 "forest_age": ("forest_age", "forest_continuity"), "nutzung": ("nutzung",)}


def phase1_used(ph1: Mapping[str, Any], places: Sequence[Mapping[str, Any]]) -> dict:
    """The loaded Phase 1 files whose data reached at least one place (→ inputs + attribution). Pure."""
    return {k: v for k, v in ph1.items() if v and any(p.get(f) is not None for p in places
                                                        for f in PHASE1_FIELDS[k])}


def labels_de(ph1: Mapping[str, Any] | None = None) -> dict:
    """German labels for the keys used in places.json (species, age classes, land-use groups)."""
    import species as SP
    nu = ((ph1 or {}).get("nutzung") or {}).get("groups") or {}
    ages = {c["key"]: c["label_de"] for c in (((ph1 or {}).get("forest_age") or {}).get("params") or {})
            .get("age_classes", []) if "key" in c}
    return {
        "species": {c[1]: c[2] for c in SP.CLASSES if c[4] is not None},
        "age_classes": {k: ages.get(k, d) for k, d in zip(AGE_CLASSES, (
            "jung (unter 40 Jahre)", "mittelalt (40–80 Jahre)", "alt (80–120 Jahre)", "sehr alt (über 120 Jahre)",
            "höher als die Ertragstafel (ohne Alter)"))},
        "nutzung": {k: (nu.get(k) or {}).get("label_de", d) for k, d in zip(NUTZUNG_GROUPS, (
            "Wald und Gehölz", "Landwirtschaft", "Gärten, Parks, Friedhöfe", "Siedlung, Gewerbe, Sport", "Verkehr",
            "Gewässer", "Sonstiges"))},
    }


def overpass_query(bbox: tuple[float, float, float, float]) -> str:
    s, w, n, e = bbox
    b = f"{s:.6f},{w:.6f},{n:.6f},{e:.6f}"
    return ("[out:json][timeout:300];\n(\n"
            f'  way["highway"]({b});\n'
            f'  way["area:highway"]({b});\n'
            f'  nwr["amenity"="parking"]({b});\n'
            f'  nwr["place"="square"]({b});\n'
            f'  nwr["landuse"="residential"]({b});\n'
            f'  nwr["natural"="water"]({b});\n'
            f'  nwr["landuse"="reservoir"]({b});\n'
            f'  way["waterway"="riverbank"]({b});\n'
            f'  node["power"="tower"]({b});\n'
            f'  nwr["power"="generator"]["generator:source"="wind"]({b});\n'
            f'  nwr["man_made"~"^(mast|tower|chimney|communications_tower)$"]({b});\n'
            ");\nout tags geom;\n")


def fetch_osm(bbox25832: Sequence[int], refresh: bool = False) -> tuple[dict, dict]:
    """One Overpass query for the stats bbox + 200 m, cached in data/raw/osm-orte/ (reused while the query is
    unchanged)."""
    from pyproj import Transformer
    OSM_RAW.mkdir(parents=True, exist_ok=True)
    e0, n0, e1, n1 = bbox25832
    west, south, east, north = Transformer.from_crs("EPSG:25832", "EPSG:4326", always_xy=True).transform_bounds(
        e0 - 200, n0 - 200, e1 + 200, n1 + 200, densify_pts=21)
    query = overpass_query((south, west, north, east))
    raw, meta_path = OSM_RAW / "orte.json", OSM_RAW / "orte.meta.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    if raw.exists() and not refresh and meta.get("query") == query:
        print(f"  OSM cached ({fmt_bytes(raw.stat().st_size)})")
        return json.loads(raw.read_text()), meta
    print("  Overpass query …", flush=True)
    url = f"{OVERPASS_URL}?{urllib.parse.urlencode({'data': query})}"
    with http_open(url, timeout=360, retries=4) as resp:
        body = resp.read()
    data = json.loads(body)
    remark = data.get("remark") or ""
    if not isinstance(data.get("elements"), list) or "runtime error" in remark or "timed out" in remark:
        sys.exit(f"Overpass error: {remark or body[:200]!r}")
    tmp = raw.with_suffix(".json.tmp")
    tmp.write_bytes(body)
    tmp.replace(raw)
    meta = {"query": query, "endpoint": OVERPASS_URL,
            "fetched": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "osm_base": (data.get("osm3s") or {}).get("timestamp_osm_base"), "bytes": len(body)}
    meta_path.write_text(json.dumps(meta, indent=2) + "\n")
    print(f"  OSM saved {fmt_bytes(len(body))}, {len(data['elements'])} elements")
    return data, meta


def fetch_regional_table() -> Path:
    if not ZENSUS_REGIONAL.exists():
        ZENSUS_REGIONAL.parent.mkdir(parents=True, exist_ok=True)
        with http_open(ZENSUS_REGIONAL_URL, timeout=120) as r:
            body = r.read()
        tmp = ZENSUS_REGIONAL.with_suffix(".tmp")
        tmp.write_bytes(body)
        tmp.replace(ZENSUS_REGIONAL)
    return ZENSUS_REGIONAL


def wgs_projector():
    from pyproj import Transformer
    tr = Transformer.from_crs("EPSG:4326", "EPSG:25832", always_xy=True)

    def project(pts: list[dict]) -> list[tuple[float, float]]:
        e, n = tr.transform([p["lon"] for p in pts], [p["lat"] for p in pts])
        return [(round(float(a), 2), round(float(b), 2)) for a, b in zip(np.atleast_1d(e), np.atleast_1d(n))]
    return project


class Grid:
    """1 m stats-bbox rasters (rasters/chm, bldg, src; ndvi, ndvi_src) read per window."""

    def __init__(self, bbox: Sequence[int]):
        self.e0, self.n0, self.e1, self.n1 = (int(v) for v in bbox)
        self._ds: dict = {}

    def close(self) -> None:
        for ds in self._ds.values():
            ds.close()
        self._ds.clear()

    def window(self, bounds, pad: int = 0) -> tuple[int, int, int, int]:
        c0 = max(0, int(math.floor(bounds[0] - self.e0)) - pad)
        c1 = min(self.e1 - self.e0, int(math.ceil(bounds[2] - self.e0)) + pad)
        r0 = max(0, int(math.floor(self.n1 - bounds[3])) - pad)
        r1 = min(self.n1 - self.n0, int(math.ceil(self.n1 - bounds[1])) + pad)
        return c0, r0, c1, r1

    def read(self, path: Path, win) -> np.ndarray:
        import rasterio
        from rasterio.windows import Window
        c0, r0, c1, r1 = win
        ds = self._ds.get(path)
        if ds is None:
            ds = self._ds[path] = rasterio.open(path)
        return ds.read(1, window=Window(c0, r0, c1 - c0, r1 - r0), boundless=True, fill_value=ds.nodata or 0)

    def rasterize(self, geoms, win) -> np.ndarray:
        from rasterio.features import rasterize
        from rasterio.transform import from_origin
        c0, r0, c1, r1 = win
        geoms = [g for g in (geoms if isinstance(geoms, (list, tuple)) else [geoms]) if g is not None and not g.is_empty]
        if not geoms or c1 <= c0 or r1 <= r0:
            return np.zeros((max(0, r1 - r0), max(0, c1 - c0)), bool)
        return rasterize([(g, 1) for g in geoms], out_shape=(r1 - r0, c1 - c0),
                         transform=from_origin(self.e0 + c0, self.n1 - r0, 1, 1), fill=0, dtype="uint8").astype(bool)


def unclipped_chm(e: float, n: float, pad: int, bldg_win: np.ndarray | None, offset: float) -> np.ndarray | None:
    """CHM without the detector's 60 m clip around the top cell centred (e, n): DSM − DTM from the cached raw
    LiDAR tiles with the build.py mosaic rules (stats_trees.lidar_window, RLP offset), building cells 0 like
    rasters/chm.tif. Side 2·pad+1, row 0 = north; None without LiDAR."""
    from stats_trees import lidar_window
    ec, nc = int(math.floor(e)), int(math.floor(n))
    lw = lidar_window((ec - pad, nc - pad, ec + pad + 1, nc + pad + 1), "mosaic", offset)
    if lw is None:
        return None
    dtm, dsm, _state = lw
    chm = np.maximum(dsm - dtm, 0.0).astype(np.float32)
    if bldg_win is not None and bldg_win.shape == chm.shape:
        chm[np.asarray(bldg_win).astype(bool)] = 0.0
    return chm


def ndvi_sl_scale(ndvi_i8: np.ndarray, src: np.ndarray, table: Mapping[str, Any] | None) -> np.ndarray:
    """int8 NDVI×100 (−128 nodata) → float NDVI on the SL scale (RLP pixels mapped through the quantile table)."""
    v = np.where(ndvi_i8 == -128, np.nan, ndvi_i8.astype(np.float32) / 100.0)
    if table is not None:
        rlp = src == 2
        if rlp.any():
            from stats_inputs import apply_quantile_table
            v[rlp] = apply_quantile_table(v[rlp], table)
    return v


def load_buildings_footprints() -> list:
    """LoD2 footprints (SL + RLP) of the stats tiles, buildings.py rules (as stats_trees.prepare)."""
    import buildings as B
    import stats_trees as ST
    ts = ST.load_tileset()
    sl_paths, rlp_paths = ST.lod2_paths(ts)
    seen: set[str] = set()
    sl, _ = B.load_buildings(sl_paths, "sl", seen)
    rlp, _ = B.load_buildings(rlp_paths, "rlp", seen)
    rlp, _ = B.drop_rlp_duplicates(sl, rlp)
    return [b.footprint for b in sl + rlp]


def label_point(geom) -> tuple[float, float]:
    import shapely
    from shapely.ops import polylabel
    parts = sorted(shapely.get_parts(geom), key=lambda p: -p.area)
    p = polylabel(parts[0], tolerance=5.0)
    return p.x, p.y


def disjoint_outlines(geoms: list, snap_m: float = SNAP_M, min_part_m2: float = SLIVER_M2) -> list:
    """Turn the place outlines into a clean coverage before coverage_simplify. The SL and RLP parcel data do not
    line up along the state border (overlaps up to ≈ 1,000 m², sub-metre gaps), which breaks coverage_simplify's
    shared edges. Each outline (list order) is snapped to the union of the earlier ones within snap_m and then
    loses what they already cover; polygon parts below min_part_m2 left over by the cut are dropped. Result: no
    overlaps, no gaps narrower than snap_m, area change ≤ 0.03 % (stats area, 2026-11-07)."""
    import shapely
    out, acc = [], None
    for x in geoms:
        if acc is not None and x.distance(acc) <= snap_m:
            y = shapely.make_valid(shapely.snap(x, acc, snap_m))
            y = shapely.make_valid(y.difference(acc))
            parts = [q for q in shapely.get_parts(y) if q.geom_type == "Polygon" and q.area >= min_part_m2]
            x = shapely.union_all(parts) if parts else y
        out.append(x)
        acc = x if acc is None else shapely.union(acc, x)
    return out


def outline_features(ids: list[str], names: list[str], geoms: list) -> list[dict]:
    """places.geojson features: holes < 1 ha dropped, coverage-simplified 10 m, 1 m grid, {id, name_de}."""
    import shapely
    from shapely.geometry import mapping
    g = disjoint_outlines([fill_small_holes(shapely.make_valid(x)) for x in geoms])
    try:
        simp = list(shapely.coverage_simplify(np.array(g, dtype=object), SIMPLIFY_M))
    except Exception:  # not a clean coverage → per-feature topology-preserving simplification
        simp = [x.simplify(SIMPLIFY_M, preserve_topology=True) for x in g]
    feats = []
    for i, n, x in zip(ids, names, simp):
        x = shapely.make_valid(shapely.set_precision(x, 1.0))
        x = shapely.union_all([p for p in shapely.get_parts(x) if p.geom_type == "Polygon" and p.area > 0])
        gj = mapping(x)

        def ints(c):
            return [ints(v) for v in c] if isinstance(c[0], (list, tuple)) else [int(round(c[0])), int(round(c[1]))]
        feats.append({"type": "Feature", "properties": {"id": i, "name_de": n},
                      "geometry": {"type": gj["type"], "coordinates": ints([list(r) for r in gj["coordinates"]])}})
    return feats


def aoi_box(aoi_dir: Path):
    from shapely.geometry import box
    m = json.loads((aoi_dir / "manifest.json").read_text())
    o, s = m["origin"], m["size"]
    e0, n0 = (o["E0"], o["N0"]) if isinstance(o, dict) else o
    w, h = (s["width"], s["height"]) if isinstance(s, dict) else s
    return box(e0, n0, e0 + w, n0 + h)


def first_attr(entries: Iterable[str], needle: str, default: str) -> str:
    return next((a for a in entries if needle in a), default)


def build_inputs(gem_meta: dict, trees_meta: dict, inputs_json: dict, osm_meta: dict, regional_date: str,
                 phase1: Mapping[str, Any] | None = None) -> dict:
    def day(s: str | None) -> str:
        return (s or "")[:10] or dt.date.today().isoformat()
    t_attr = trees_meta.get("attribution", [])
    alkis = gem_meta.get("attribution", [])
    ndvi_attr = inputs_json["sources"]["ndvi"]["attribution"]
    zensus_attr = inputs_json["sources"]["zensus"]["attribution"][0]
    mastr_attr = inputs_json["sources"]["mastr"]["attribution"][0]
    tg, ng = day(trees_meta.get("generated")), day(inputs_json.get("updated"))
    dl = "dl-de/by-2-0"
    inp = {
        "lidar_sl": {"name_de": "Laserscanning DGM1/DOM1 Saarland (ALS 2025)", "provider": "LVGL-SL", "year": 2025,
                     "retrieved": tg, "licence": dl, "attribution": ATTRIBUTION_SL},
        "lidar_rlp": {"name_de": "DGM1/DOM1 Rheinland-Pfalz", "provider": "LVermGeoRP", "year": 2022,
                      "retrieved": tg, "licence": dl, "attribution": ATTRIBUTION_RLP},
        "alkis_sl": {"name_de": "ALKIS Flurstücke Saarland (INSPIRE)", "provider": "LVGL-SL", "year": None,
                     "retrieved": day(gem_meta.get("generated")), "licence": dl,
                     "attribution": first_attr(alkis, "LVGL-SL", "© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (ALKIS)")},
        "alkis_rlp": {"name_de": "ALKIS vereinfacht Rheinland-Pfalz", "provider": "LVermGeoRP", "year": None,
                      "retrieved": day(gem_meta.get("generated")), "licence": dl,
                      "attribution": first_attr(alkis, "LVermGeoRP", ATTRIBUTION_RLP + " (ALKIS)")},
        "lod2_sl": {"name_de": "3D-Gebäudemodell LoD2 Saarland", "provider": "LVGL-SL", "year": None, "retrieved": tg,
                    "licence": dl, "attribution": first_attr([a for a in t_attr if "(LoD2)" in a], "LVGL-SL",
                                                             ATTRIBUTION_SL + " (LoD2)")},
        "lod2_rlp": {"name_de": "3D-Gebäudemodell LoD2 Rheinland-Pfalz", "provider": "LVermGeoRP", "year": None,
                     "retrieved": tg, "licence": dl, "attribution": first_attr(
                         [a for a in t_attr if "(LoD2)" in a], "LVermGeoRP", ATTRIBUTION_RLP + " (LoD2)")},
        "dop_sl": {"name_de": "Digitale Orthophotos DOP20 Saarland (Baumart Laub/Nadel)", "provider": "LVGL-SL",
                   "year": 2025, "retrieved": tg, "licence": dl, "attribution": first_attr(
                       [a for a in t_attr if "(DOP20)" in a], "LVGL-SL", "© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (DOP20)")},
        "dop_rlp": {"name_de": "Digitale Orthophotos DOP20 Rheinland-Pfalz (Baumart Laub/Nadel)",
                    "provider": "LVermGeoRP", "year": None, "retrieved": tg, "licence": dl, "attribution": first_attr(
                        [a for a in t_attr if "(DOP20)" in a], "LVermGeoRP", ATTRIBUTION_RLP + " (DOP20)")},
        "dop_cir_sl": {"name_de": "DOP20 Color-Infrarot Saarland (WMS)", "provider": "LVGL-SL", "year": 2025,
                       "retrieved": ng, "licence": dl, "attribution": first_attr(ndvi_attr, "LVGL-SL", "")},
        "dop_rgbi_rlp": {"name_de": "DOP20 RGBI Rheinland-Pfalz", "provider": "LVermGeoRP", "year": None,
                         "retrieved": ng, "licence": dl, "attribution": first_attr(ndvi_attr, "LVermGeoRP", "")},
        "osm": {"name_de": "OpenStreetMap (Straßen, Parkplätze, Wohngebiete, Gewässer, Masten)", "provider": "OSM",
                "year": None, "retrieved": day(osm_meta.get("fetched")), "licence": "ODbL-1.0",
                "attribution": ATTRIBUTION_OSM, "url": "https://www.openstreetmap.org/copyright"},
        "zensus": {"name_de": "Zensus 2022, Bevölkerung im 100-m-Gitter", "provider": "Destatis", "year": 2022,
                   "retrieved": ng, "licence": dl, "attribution": zensus_attr,
                   "url": "https://www.destatis.de/static/DE/zensus/gitterdaten/Zensus2022_Bevoelkerungszahl.zip"},
        "zensus_gemeinden": {"name_de": "Zensus 2022, Regionaltabelle Bevölkerung (Gemeinden)",
                             "provider": "Destatis", "year": 2022, "retrieved": regional_date, "licence": dl,
                             "attribution": zensus_attr, "url": ZENSUS_REGIONAL_URL},
        "mastr": {"name_de": "Marktstammdatenregister, Solareinheiten", "provider": "BNetzA", "year": None,
                  "retrieved": day(inputs_json["sources"]["mastr"].get("export_date")), "licence": dl,
                  "attribution": mastr_attr, "url": "https://www.marktstammdatenregister.de/"},
    }
    inp.update(phase1_inputs(phase1 or {}))
    for k, v in inp.items():
        if not v["attribution"] or ";" in v["attribution"]:
            raise ValueError(f"input {k}: attribution missing or contains ';'")
    return inp


def phase1_inputs(used: Mapping[str, Any]) -> dict:
    """Input entries of the Phase 1 sources actually used (`used` = the loaded work files whose data went into
    places.json). Licences checked 2026-11-08: DLR CC BY 4.0; GBIF records CC0 / CC BY 4.0 / CC BY-NC 4.0 per
    dataset (only counts are published); historic maps dl-de/by-2-0."""
    def day(s: str | None) -> str:
        return (s or "")[:10] or dt.date.today().isoformat()
    import species as SP
    out: dict[str, dict] = {}
    sp, fa = used.get("species"), used.get("forest_age")
    if sp or (fa and "DLR" in str(fa.get("species_source", ""))):   # species mix, Riesen species, age species
        out["species_dlr"] = {"name_de": "Baumarten Deutschland 2022 (DLR, Sentinel-1/-2, 10 m)", "provider": "DLR",
                              "year": 2022, "retrieved": day((sp or fa).get("generated")), "licence": "CC-BY-4.0",
                              "attribution": (sp or {}).get("attribution") or SP.ATTRIBUTION_DLR,
                              "url": "https://doi.org/10.15489/smh8w3j8i962"}
    gb = used.get("gbif")
    if gb:
        attr = (gb.get("attribution") or [""])[0]
        out["gbif"] = {"name_de": "GBIF-Fundmeldungen (nur Anzahlen je Gemarkung)", "provider": "GBIF",
                       "year": None, "retrieved": day(gb.get("query_date") or gb.get("generated")),
                       "licence": "CC0-1.0 / CC-BY-4.0 / CC-BY-NC-4.0 (je Datensatz)", "attribution": attr,
                       "url": "https://www.gbif.org"}
        if gb.get("attribution_note_de"):
            out["gbif"]["note_de"] = gb["attribution_note_de"]
    if fa and any((p.get("forest_continuity") or {}).get("covered_crown_pct") for p in fa.get("places", [])):
        hist = next((a for a in fa.get("attribution", []) if "Historische Karten" in a),
                    "© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet (Historische Karten)")
        out["hist_maps_sl"] = {"name_de": "Historische Karten Saarland (TK25, Ausgaben 1935–40)", "provider": "LVGL-SL",
                               "year": None, "retrieved": day(fa.get("generated")), "licence": "dl-de/by-2-0",
                               "attribution": hist}
    return out


def ndvi_class_check(grid: Grid, geoms_ortslage, paved_all, table) -> dict:
    """NDVI (SL scale) distribution of roofs, OSM paved and canopy cells in the Ortslage (threshold report)."""
    out: dict[str, Any] = {}
    acc: dict[str, list[np.ndarray]] = {"roof": [], "paved": [], "canopy": [], "other": []}
    for g in geoms_ortslage:
        if g is None or g.is_empty:
            continue
        win = grid.window(g.bounds)
        inside = grid.rasterize(g, win)
        chm = grid.read(RASTER_DIR / "chm.tif", win)
        nd = ndvi_sl_scale(grid.read(ORTE_DIR / "ndvi.tif", win), grid.read(ORTE_DIR / "ndvi_src.tif", win), table)
        bldg = grid.read(RASTER_DIR / "bldg.tif", win).astype(bool)
        paved = grid.rasterize(paved_all(g), win)
        ok = inside & np.isfinite(nd) & np.isfinite(chm)
        canopy = ok & (chm >= CANOPY_M)
        acc["roof"].append(nd[ok & bldg])
        acc["paved"].append(nd[ok & paved & ~bldg & ~canopy])
        acc["canopy"].append(nd[canopy])
        acc["other"].append(nd[ok & ~bldg & ~paved & ~canopy])
    for k, v in acc.items():
        a = np.concatenate(v) if v else np.zeros(0)
        out[k] = {"n": int(a.size)} | ({f"p{q}": round(float(np.percentile(a, q)), 3) for q in (5, 10, 25, 50, 75, 90, 95)}
                                        if a.size else {})
        if a.size:
            out[k]["share_ge_t_green"] = round(float((a >= T_GREEN).mean()), 3)
            out[k]["share_lt_t_bare"] = round(float((a < T_BARE).mean()), 3)
    return out


# ================================================================================================= main
def run(aoi_key: str, refresh_osm: bool = False, write_manifest: bool = True) -> dict:
    import shapely
    from shapely import STRtree
    from shapely.geometry import shape

    t0 = time.time()
    aoi_dir = APP_DATA / aoi_key
    if not (aoi_dir / "manifest.json").exists():
        sys.exit(f"no manifest for AOI {aoi_key!r} in {aoi_dir}")
    for f in ("gemarkungen.geojson", "flurstuecke.geojson.gz", "trees.npz", "ndvi.tif", "ndvi_src.tif",
              "zensus_100m.csv", "mastr_pv.json", "inputs.json", "rasters/chm.tif", "rasters/bldg.tif",
              "rasters/src.tif", "rasters/dtm.tif"):
        if not (ORTE_DIR / f).exists():
            sys.exit(f"missing input data/work/orte/{f} (run places.py, stats_trees.py, stats_inputs.py first)")

    gem = load_json("gemarkungen.geojson")
    gmeta = gem["meta"]
    extent = [int(v) for v in gmeta["stats_bbox"]]
    grid = Grid(extent)
    feats = [f for f in gem["features"]]
    pids = [f["properties"]["id"] for f in feats]
    outlines = {f["properties"]["id"]: shapely.make_valid(shape(f["geometry"])) for f in feats}
    props = {f["properties"]["id"]: f["properties"] for f in feats}
    print(f"places: {', '.join(pids)}")

    # --- parcels ------------------------------------------------------------------------------------------
    with gzip.open(ORTE_DIR / "flurstuecke.geojson.gz", "rt") as fh:
        parcels = json.load(fh)["features"]
    p_geoms, p_place, p_area = [], [], []
    for f in parcels:
        if not f.get("geometry"):
            continue
        g = shapely.make_valid(shape(f["geometry"]))
        p_geoms.append(g)
        p_place.append(f["properties"]["place"])
        a = f["properties"].get("flaeche_m2")
        p_area.append(float(a) if a else g.area)
    p_place_arr = np.array(p_place)
    p_area_arr = np.array(p_area)
    print(f"parcels: {len(p_geoms)} [{time.time() - t0:.0f}s]", flush=True)

    # --- trees --------------------------------------------------------------------------------------------
    z = np.load(ORTE_DIR / "trees.npz")
    T = {k: z[k] for k in z.files if k != "meta"}
    trees_meta = json.loads(str(z["meta"]))
    app_cap = float(trees_meta.get("params", {}).get("max_height", APP_MAX_HEIGHT))

    # --- Phase 1 work files (optional) + per-tree species (aligned with trees.npz, filtered along with T) -----
    ph1 = load_phase1()
    print(f"Phase 1 inputs: {', '.join(k for k, v in ph1.items() if v) or 'none'}", flush=True)
    sp_code, sp_prob = ORTE_DIR / "species_trees.npy", ORTE_DIR / "species_prob_trees.npy"
    if ph1.get("species") and sp_code.exists() and sp_prob.exists():
        c, pr_ = np.load(sp_code), np.load(sp_prob)
        if c.shape == T["E"].shape and pr_.shape == T["E"].shape:
            T["species"], T["species_p"] = c, pr_
        else:
            print(f"  ! species arrays ({c.shape}) do not match trees.npz ({T['E'].shape}): species.py stats "
                  "must run after stats_trees.py; species left out", file=sys.stderr)
            ph1["species"] = None
    elif ph1.get("species"):
        print("  ! species_by_place.json without per-tree arrays: species left out", file=sys.stderr)
        ph1["species"] = None
    ph1_by = phase1_by_place(ph1)
    hist_epochs = [int(e["year"]) for e in ((ph1.get("forest_age") or {}).get("forest_hist") or {}).get("epochs", [])
                   if e.get("classified")] or [1935]

    # --- buildings, Ortslage --------------------------------------------------------------------------------
    fps = load_buildings_footprints()
    print(f"LoD2 footprints: {len(fps)} [{time.time() - t0:.0f}s]", flush=True)
    orts_all, orts_info = ortslage_geometry(fps)
    reps = shapely.points([f.representative_point().coords[0] for f in fps])
    print(f"Ortslage: {orts_info} [{time.time() - t0:.0f}s]", flush=True)

    report: dict[str, Any] = {"places": {}}

    # --- OSM ------------------------------------------------------------------------------------------------
    osm_data, osm_meta = fetch_osm(extent, refresh=refresh_osm)
    osm = osm_features(osm_data, wgs_projector())
    paved_tree = STRtree(osm["paved"]) if osm["paved"] else None
    water_tree = STRtree(osm["water"]) if osm["water"] else None

    def near(tree, geoms, g):
        if tree is None:
            return []
        return [geoms[i] for i in tree.query(g, predicate="intersects")]
    paved_for = lambda g: near(paved_tree, osm["paved"], g)  # noqa: E731
    residential = shapely.union_all(osm["residential"]) if osm["residential"] else None
    hazards = np.array(osm["hazards"], float).reshape(-1, 2)
    print(f"OSM: paved {len(osm['paved'])}, water {len(osm['water'])}, residential {len(osm['residential'])}, "
          f"hazards {len(hazards)} [{time.time() - t0:.0f}s]", flush=True)

    # --- tree plausibility (TALLEST checks): every top above the app cap, and the tallest candidates -----------
    from scipy.spatial import cKDTree
    hz_tree = cKDTree(hazards) if len(hazards) else None
    wind = np.array(osm["wind"], float).reshape(-1, 2)
    wind_tree = cKDTree(wind) if len(wind) else None
    rlp_offset = float((load_json("stats_trees_prepare.json").get("rlp_offset") or {}).get("applied", 0.0)
                       if (ORTE_DIR / "stats_trees_prepare.json").exists() else 0.0)
    reason_cache: dict[int, str | None] = {}
    h_unclipped: dict[int, float] = {}   # tops at the detector clip: CHM height without the clip
    linear_log: list[dict] = []          # local review list (data/work only)
    kc = chm_pad()

    def plaus(i: int) -> str | None:
        if i not in reason_cache:
            e, n = float(T["E"][i]), float(T["N"][i])
            hd = float(hz_tree.query((e, n))[0]) if hz_tree is not None else math.inf
            cell = (e - 0.5, n - 0.5, e + 0.5, n + 0.5)
            h = float(T["h"][i])
            cw = grid.window(cell, pad=kc)
            chm_w = grid.read(RASTER_DIR / "chm.tif", cw)
            if h >= TALLEST["clip_m"]:
                raw = unclipped_chm(e, n, kc, grid.read(RASTER_DIR / "bldg.tif", cw), rlp_offset)
                h, chm_w, clip_why = remeasure_at_clip(h, chm_w, raw)
                if clip_why is not None:     # true height unknown: v3 rule
                    reason_cache[i] = clip_why
                    return clip_why
                h_unclipped[i] = h
            dtm_w = grid.read(RASTER_DIR / "dtm.tif", grid.window(cell, pad=int(math.ceil(TALLEST["valley_r_m"]))))
            bw = grid.read(RASTER_DIR / "bldg.tif", grid.window(cell, pad=int(TALLEST["bldg_clear_m"])))
            why = tree_reason(h, float(T["r"][i]), hd, chm_w, bw, dtm_w)
            if why == "linear":
                wd = float(wind_tree.query((e, n))[0]) if wind_tree is not None else None
                linear_log.append({"E": e, "N": n, "h": round(h, 1), "ratio": round(linear_ratio(chm_w, h), 2),
                                   "wind_dist_m": None if wd is None else round(wd)})
            reason_cache[i] = why
        return reason_cache[i]
    tall = np.flatnonzero(T["h"] > app_cap + 1e-6)
    tall_bad = np.array([i for i in tall if plaus(int(i)) is not None], np.int64)
    tall_rejects: dict[str, int] = {}
    for i in tall_bad:
        tall_rejects[reason_cache[int(i)]] = tall_rejects.get(reason_cache[int(i)], 0) + 1
    at_clip = [i for i in h_unclipped if reason_cache.get(i) is None]
    report["tall_trees"] = {"app_cap_m": app_cap, "above_cap": int(tall.size), "kept": int(tall.size - tall_bad.size),
                            "rejected": tall_rejects, "at_clip": len(h_unclipped),
                            "at_clip_kept": [{"h": round(h_unclipped[i], 2), "E": float(T["E"][i]),
                                              "N": float(T["N"][i])} for i in at_clip]}
    report["linear_rejects"] = linear_log
    report["wind_turbines_osm"] = int(len(wind))
    if at_clip:   # kept tops at the clip carry their unclipped height (also in crown/biomass)
        T["h"] = T["h"].astype(np.float64)
        for i in at_clip:
            T["h"][i] = h_unclipped[i]
    if tall_bad.size:
        keep_t = np.ones(T["E"].size, bool)
        keep_t[tall_bad] = False
        T = {k: v[keep_t] for k, v in T.items()}
        reason_cache.clear()
    ab = aoi_box(aoi_dir).bounds
    t_hi = (T["h"] > app_cap + 1e-6) & (T["E"] >= ab[0]) & (T["E"] < ab[2]) & (T["N"] >= ab[1]) & (T["N"] < ab[3])
    report["tall_trees"]["kept_in_aoi_not_in_trees_layer"] = int(t_hi.sum())   # the Trees layer drops them (cap)
    print(f"trees above {app_cap:.0f} m: {tall.size}, kept {tall.size - tall_bad.size}, rejected {tall_rejects} "
          f"[{time.time() - t0:.0f}s]", flush=True)
    in_orts = (shapely.contains_xy(orts_all, T["E"], T["N"]) if orts_all is not None
               else np.zeros(T["E"].size, bool))

    pidx = assign_points(T["E"], T["N"], p_geoms)
    t_place = np.where(pidx >= 0, p_place_arr[np.maximum(pidx, 0)], "")
    # crown-allometry-v2: ρ by tree-group-v1 (a „wahrscheinlich“ DLR class wins over the DOP colour type)
    if "species" in T:
        import species as SP
        t_group = SP.tree_group(T["species"], T["species_p"], T["type"])
    else:
        t_group = np.asarray(T["type"]).astype(np.int64) & 0x7F
    report["tree_group"] = {"conifer": int((t_group == 1).sum()), "broadleaf": int((t_group == 2).sum()),
                            "none": int((t_group == 0).sum()),
                            "colour_type_conifer": int(((np.asarray(T["type"]).astype(np.int64) & 0x7F) == 1).sum()),
                            "source": "tree-group-v1" if "species" in T else "colour type (no species arrays)"}
    agb = agb_kg(T["h"], T["r"], t_group == 1)
    crown = math.pi * T["r"].astype(np.float64) ** 2
    print(f"trees: {len(pidx)}, outside places {int((pidx < 0).sum())} [{time.time() - t0:.0f}s]", flush=True)

    ndvi_meta = load_json("ndvi.json")
    qtable = (ndvi_meta.get("checks", {}).get("sl_rlp_overlap") or {}).get("quantile_map_rlp_to_sl")

    # --- Zensus ---------------------------------------------------------------------------------------------
    import csv
    with open(ORTE_DIR / "zensus_100m.csv", newline="") as fh:
        zrows = list(csv.DictReader(fh))
    zcells = zensus_cell_polygons(np.array([float(r["x3035"]) for r in zrows]),
                                  np.array([float(r["y3035"]) for r in zrows]))
    zpop = np.array([float(r["einwohner"] or 0) for r in zrows])

    # --- per place ------------------------------------------------------------------------------------------
    abox = aoi_box(aoi_dir)
    from shapely.geometry import box as sbox
    ext_box = sbox(*extent)
    places_raw: list[dict] = []
    osm_check: dict[str, Any] = {}
    orts_geoms = []
    for pid in pids:
        pr, outline = props[pid], outlines[pid]
        sel_p = p_place_arr == pid
        n_parcels = int(sel_p.sum())
        if n_parcels < MIN_COUNT:
            print(f"  {pid}: {n_parcels} parcels < {MIN_COUNT} → dropped")
            continue
        area_m2 = float(p_area_arr[sel_p].sum())
        sel_t = t_place == pid
        trees_n = int(sel_t.sum())
        crown_m2 = float(crown[sel_t].sum())
        agb_t, co2_t = biomass_range_t(float(agb[sel_t].sum()))
        flags = list(pr.get("flags") or [])

        # LiDAR coverage + source share over the outline
        win = grid.window(outline.bounds)
        inside = grid.rasterize(outline, win)
        src = grid.read(RASTER_DIR / "src.tif", win)
        n_in = int(inside.sum())
        lidar_cov = float(np.isin(src[inside], (0, 1)).sum()) / max(1, n_in)
        rlp_share = float((src[inside] == 1).sum()) / max(1, n_in)
        epoch, epochs = lidar_epochs(src[inside])
        del src, inside
        if rlp_share >= 0.01 and "other-flight" not in flags:
            flags.append("other-flight")
        cut = not ext_box.buffer(0.5).covers(outline)
        if cut or lidar_cov < 0.995:
            flags.append("cut-by-aoi")

        # Ortslage
        o_geom = orts_all.intersection(outline) if orts_all is not None else None
        o_geom = None if o_geom is None or o_geom.is_empty else shapely.make_valid(o_geom)
        ortslage = None
        ndvi_cov = 1.0
        if o_geom is not None:
            orts_geoms.append(o_geom)
            n_bldg = int(shapely.contains_xy(o_geom, *shapely.get_coordinates(reps).T).sum())
            w = grid.window(o_geom.bounds)
            ins = grid.rasterize(o_geom, w)
            chm = grid.read(RASTER_DIR / "chm.tif", w)
            nd = ndvi_sl_scale(grid.read(ORTE_DIR / "ndvi.tif", w), grid.read(ORTE_DIR / "ndvi_src.tif", w), qtable)
            bldg = grid.read(RASTER_DIR / "bldg.tif", w).astype(bool)
            paved = grid.rasterize(paved_for(o_geom), w)
            water = grid.rasterize(near(water_tree, osm["water"], o_geom), w)
            cnt = cover_counts(ins, chm, nd, bldg, paved, water)
            ndvi_cov = cnt["valid"] / max(1, cnt["inside"])
            ortslage = {"area_ha": o_geom.area / 1e4, "buildings": n_bldg, **cover_shares(cnt)}
            report["places"].setdefault(pid, {})["ortslage_counts"] = cnt
            del chm, nd, bldg, paved, water, ins
            if residential is not None:
                res = residential.intersection(outline)
                ra, oa = res.area, o_geom.area
                both = res.intersection(o_geom).area if ra else 0.0
                osm_check[pid] = {"osm_residential_ha": round(ra / 1e4, 1),
                                  "residential_in_ortslage_pct": round(100 * both / ra, 1) if ra else None,
                                  "ortslage_in_residential_pct": round(100 * both / oa, 1) if oa else None}
        if ndvi_cov < 0.995 and "cut-by-aoi" not in flags:
            flags.append("cut-by-aoi")

        inhabitants = apportion(zcells, zpop, outline)
        tpi = trees_n / inhabitants if inhabitants and inhabitants >= 1 else None

        # tallest: plausible (TALLEST checks) and outside the Ortslage (G1/G2: no garden tree by position)
        idx = np.flatnonzero(sel_t)

        bnd = outline.boundary

        def check(k: int, idx=idx, bnd=bnd) -> str | None:
            i = int(idx[k])
            if in_orts[i]:
                return "in-ortslage"
            return edge_reason(bnd, float(T["E"][i]), float(T["N"][i])) or plaus(i)
        # riesen-checked-v1: the tallest-checked-v4 winner plus the next checked trees ≥ 20 m apart
        picks, rejects = pick_top(T["h"][idx], T["fill"][idx], T["id"][idx], T["E"][idx], T["N"][idx], check)
        riesen = []
        for k in picks:
            i = int(idx[k])
            row = {"h": float(T["h"][i]), "E": float(T["E"][i]), "N": float(T["N"][i]), "id": int(T["id"][i])}
            row["in_trees"] = trees_layer_has(aoi_dir, row["E"], row["N"], row["id"])
            if "species" in T:
                sp_e = tree_species_entry(int(T["species"][i]), int(T["species_p"][i]), int(T["type"][i]))
                if sp_e:
                    row["species"] = sp_e
            riesen.append(row)
        tallest = None
        if riesen:
            tallest = {k: riesen[0][k] for k in ("h", "E", "N", "id", "in_trees")}
            cw = grid.window((tallest["E"] - 0.5, tallest["N"] - 0.5, tallest["E"] + 0.5, tallest["N"] + 0.5), pad=20)
            ctx = tallest_context(grid.read(RASTER_DIR / "chm.tif", cw), grid.read(RASTER_DIR / "dtm.tif", cw),
                                  tallest["h"])
            ctx["edge_dist_m"] = round(float(shapely.distance(bnd, shapely.Point(tallest["E"], tallest["N"]))), 1)
            ctx["in_trees"] = tallest["in_trees"]
            report["places"].setdefault(pid, {})["tallest_context"] = ctx
        report["places"].setdefault(pid, {})["tallest_rejects"] = rejects

        aoi_share = 100.0 * outline.intersection(abox).area / outline.area if outline.area else 0.0
        state = pr["state"]
        flags.append("pv-municipality-only")
        place = {
            "id": pid, "name_de": pr["name_de"], "kind": pr.get("kind", "gemarkung"),
            "gemarkungen": [g["name"] for g in pr.get("gemarkungen", [])] or [pr["name_de"]],
            "state": state, "municipality": slugify(pr["municipality"]), "category": size_category(inhabitants),
            "complete": "cut-by-aoi" not in flags, "flags": sorted(set(flags)), "suppressed": [],
            "lidar_epoch": int(epoch or pr.get("lidar_epoch") or (2025 if state == "SL" else 2022)),
            "lidar_epochs": epochs,
            "label": label_point(outline), "bbox": list(outline.bounds), "aoi_share_pct": aoi_share,
            "area_ha": area_m2 / 1e4, "parcels": n_parcels, "trees": trees_n, "crown_ha": crown_m2 / 1e4,
            "crown_pct": share_pct(crown_m2, area_m2), "agb_t": agb_t, "co2_t": co2_t, "ortslage": ortslage,
            "inhabitants": inhabitants if inhabitants >= 1 else None, "trees_per_inhabitant": tpi,
            "tallest": tallest, "pv": None, "riesen": riesen,
        }
        # Phase 1 blocks (null when the work file is missing or has nothing for this place)
        place["species"] = species_block(T["species"][sel_t], T["r"][sel_t]) if "species" in T else None
        place["biodiversity"] = biodiversity_block(ph1_by["gbif"].get(pid))
        (place["forest_continuity_pct"], place["forest_continuity"],
         place["forest_age"]) = forest_blocks(ph1_by["forest_age"].get(pid), epochs=hist_epochs)
        place["nutzung"] = nutzung_block(ph1_by["nutzung"].get(pid))
        place["roof_potential"], roof_sup = roof_block(ph1_by["roofs"].get(pid))
        if roof_sup:
            place["suppressed"].append("roof_potential")
        report["places"][pid]["riesen_rejects"] = rejects
        report["places"][pid]["riesen_n"] = len(riesen)
        report["places"][pid].update({"lidar_coverage": round(lidar_cov, 5), "rlp_lidar_share": round(rlp_share, 4),
                                      "ndvi_coverage_ortslage": round(ndvi_cov, 5),
                                      "area_official_ha_places_py": pr.get("area_official_ha")})
        places_raw.append(apply_min_count(place))
        print(f"  {pid}: {trees_n} trees, crown {place['crown_pct']:.1f} %, Ortslage "
              f"{(ortslage or {}).get('area_ha', 0):.0f} ha, inh {inhabitants:.0f} [{time.time() - t0:.0f}s]", flush=True)

    report["ndvi_classes"] = ndvi_class_check(grid, orts_geoms, paved_for, qtable)
    grid.close()
    report["osm_check"] = osm_check
    report["ortslage"] = orts_info

    # --- municipalities ---------------------------------------------------------------------------------------
    mastr = load_json("mastr_pv.json")
    reg_path = fetch_regional_table()
    reg_rows = xlsx_rows(reg_path, "Bevölkerung")
    regional_date = dt.date.fromtimestamp(reg_path.stat().st_mtime).isoformat()
    kept = {p["id"] for p in places_raw}
    munis = []
    for m in mastr["municipalities"]:
        pop, reg_name = official_population(reg_rows, m["ags"])
        io = m["in_operation"]
        kwp_pi = io["kwp"] / pop if pop else None
        by_year = bucket_years((int(y), v["units"], v["kwp"]) for y, v in
                               (m.get("by_commissioning_year") or {}).items())
        munis.append({
            "id": slugify(m["name_de"]), "name_de": m["name_de"], "state": m["state"], "ags": m["ags"],
            "places": [p for p in m.get("places", []) if p in kept],
            "inhabitants": round_to(pop, 10) if pop else None,
            "pv": {"source": "mastr", "as_of": mastr.get("export_date") or m.get("fetched"),
                   "systems": int(io["units"]), "kwp": int(round(io["kwp"])), "kwp_per_inhabitant": round_sig(kwp_pi),
                   "small_systems": int(m["lt_30kw"]["units"]), "by_year": by_year},
        })
        if ph1.get("roofs"):
            pot, used, why = municipality_roofs(ph1_by["roofs_muni"].get(m["ags"]), kept)
            munis[-1]["roof_potential"] = pot
            munis[-1]["pv"]["used_pct"] = used
            munis[-1]["pv"]["used_pct_reason_de"] = why
        report.setdefault("municipalities", {})[m["ags"]] = {"official_population": pop, "regional_name": reg_name}
    munis.sort(key=lambda x: sort_key_de(x["name_de"]))

    # --- assemble -------------------------------------------------------------------------------------------
    inputs_json = load_json("inputs.json")
    used = phase1_used(ph1, places_raw)
    inputs = build_inputs(gmeta, trees_meta, inputs_json, osm_meta, regional_date, used)
    attribution = merge_attribution("", [v["attribution"] for v in inputs.values()])
    places_raw.sort(key=lambda p: sort_key_de(p["name_de"]))
    border = (load_json("border_effect.json").get("summary") if (ORTE_DIR / "border_effect.json").exists() else None)
    generated = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    feats_out = outline_features([p["id"] for p in places_raw], [p["name_de"] for p in places_raw],
                                 [outlines[p["id"]] for p in places_raw])
    for p, f in zip(places_raw, feats_out):
        t = p.get("tallest")
        if t is not None:
            inside_pub = bool(shape(f["geometry"]).contains(shapely.Point(t["E"], t["N"])))
            report["places"][p["id"]].setdefault("tallest_context", {})["in_published_outline"] = inside_pub
            if not inside_pub:
                print(f"  ! {p['id']}: tallest tree lies outside its published outline", file=sys.stderr)
        out_pub = [r["id"] for r in p.get("riesen") or []
                   if not shape(f["geometry"]).contains(shapely.Point(r["E"], r["N"]))]
        report["places"][p["id"]]["riesen_outside_published_outline"] = out_pub
        if out_pub:
            print(f"  ! {p['id']}: {len(out_pub)} Riesen lie outside the published outline", file=sys.stderr)
    places_out = [round_place(p) for p in places_raw]
    gen_year = int(generated[:4])
    for q in places_out:
        q["goals"] = goals_for(q, gen_year)
    doc = {
        "format": FORMAT, "version": VERSION, "generated": generated, "aoi": aoi_key, "crs": "EPSG:25832",
        "extent": extent, "geometry": {"url": "stats/places.geojson", "simplify_m": int(SIMPLIFY_M),
                                       "featureCount": len(feats_out)},
        "min_count": MIN_COUNT, "label_de": LABEL_DE, "disclaimer_de": DISCLAIMER_DE, "inputs": inputs,
        "method": methods(osm_check, orts_info, qtable is not None, border,
                          {k: v for k, v in report["tall_trees"].items() if k != "at_clip_kept"}, ph1),
        "disciplines": disciplines(biodiversity_ready="gbif" in used and any(
            (q.get("biodiversity") or {}).get("rarefied_500") is not None for q in places_out)),
        "labels_de": labels_de(ph1),
        "places": places_out, "municipalities": munis, "attribution": attribution,
    }
    check_privacy(doc)
    check_outline_privacy(feats_out)
    out_dir = aoi_dir / "stats"
    out_dir.mkdir(parents=True, exist_ok=True)
    pj = json.dumps(doc, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"   # compact (size target)
    gj = json.dumps({"type": "FeatureCollection", "features": feats_out}, ensure_ascii=False, sort_keys=True,
                    separators=(",", ":")) + "\n"
    for name, text in (("places.json", pj), ("places.geojson", gj)):
        tmp = out_dir / (name + ".tmp")
        tmp.write_text(text)
        tmp.replace(out_dir / name)
    print(f"wrote stats/places.json ({fmt_bytes(len(pj.encode()))}), stats/places.geojson "
          f"({fmt_bytes(len(gj.encode()))})")
    for name, text, limit in (("places.json", pj, PLACES_JSON_MAX), ("places.geojson", gj, 150 * 1024)):
        if len(text.encode()) > limit:
            print(f"  ! {name} is above the contract target of {fmt_bytes(limit)}", file=sys.stderr)
    if write_manifest:
        update_manifest(aoi_dir, {"stats": {"format": FORMAT, "url": "stats/places.json",
                                            "geometry": "stats/places.geojson", "generated": generated,
                                            "places": len(doc["places"]), "label_de": LABEL_DE}},
                        attribution=[v["attribution"] for v in inputs.values()])
    report["seconds"] = round(time.time() - t0, 1)
    (ORTE_DIR / "stats_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1, sort_keys=True))
    table = stats_table(doc, report)
    (ORTE_DIR / "stats_table.md").write_text(table)
    print(table)
    return doc


# Key fragments that never appear in a published stats key (G1–G3): parcel ids, owners, addresses, persons.
FORBIDDEN_KEY_PARTS = ("flst", "flurst", "kennz", "eigent", "owner", "besitz", "buchung", "adress", "address",
                       "addr", "strasse", "straße", "hausn", "housenumber", "lagebez", "person", "anschrift", "plz")
# Values that look like an ALKIS parcel id (flstkennz, e.g. '102100004009870002__' / 'DESL…') or a street address.
FORBIDDEN_VALUE = re.compile(r"^(?:DE[A-Z]{2})?\d{6}[\d_]{8,}$|\b\w*(?:straße|strasse|str\.?|weg|gasse|platz)\s+\d+\w?\b",
                             re.IGNORECASE)


def check_privacy(doc: Any, path: str = "") -> None:
    """Guard (G1–G3): no parcel-id, owner, address or person keys and no parcel-id- or address-like string values
    anywhere in the published document (keys matched by fragment, case-insensitive)."""
    if isinstance(doc, dict):
        for k, v in doc.items():
            kl = str(k).lower()
            if any(f in kl for f in FORBIDDEN_KEY_PARTS):
                raise ValueError(f"forbidden key {path}.{k} in published stats")
            check_privacy(v, f"{path}.{k}")
    elif isinstance(doc, list):
        for i, v in enumerate(doc):
            check_privacy(v, f"{path}[{i}]")
    elif isinstance(doc, str) and FORBIDDEN_VALUE.search(doc.strip()):
        raise ValueError(f"parcel-id- or address-like value at {path} in published stats")


def check_outline_privacy(features: Sequence[Mapping[str, Any]]) -> None:
    """places.geojson carries {id, name_de} only (contract)."""
    for f in features:
        if set(f.get("properties", {})) != {"id", "name_de"}:
            raise ValueError(f"places.geojson feature with properties {sorted(f.get('properties', {}))}")
        check_privacy(f["properties"])


def _fmt(v, nd: int = 1) -> str:
    if v is None:
        return "–"
    if isinstance(v, float) and not v.is_integer():
        return f"{v:,.{nd}f}".replace(",", " ")
    return f"{int(v):,}".replace(",", " ")


def _rng(r, nd: int = 0) -> str:
    return "–" if not r else f"{_fmt(r[0], nd)}–{_fmt(r[2], nd)}"


def phase1_table(doc: dict, report: dict) -> list[str]:
    """Review tables of the Phase 1 blocks (stats_table.md)."""
    lab = (doc.get("labels_de") or {}).get("species", {})
    L = ["", "Phase 1 per place: species mix (DLR 2022, crown-weighted; coverage = crown with a class), forest age "
             "(crown-weighted classes young / middle / old / very old / beyond the table), 1935 forest share (null below 50 % mask cover)",
         "", "| Place | Dominant | Top 3 | Coverage % | Conifer % | Age median y | Age classes % | 1935 forest % "
             "(mask cover %) | Land use (forest / agri / settlement / traffic %) |",
         "|---|---|---|---|---|---|---|---|---|"]
    for p in doc["places"]:
        sp = p.get("species") or {}
        top3 = ", ".join(f"{lab.get(m['key'], m['key'])} {m['share_pct']:g}" for m in (sp.get("mix") or [])[:3]) or "–"
        fa = p.get("forest_age") or {}
        cls = fa.get("classes_pct") or {}
        fc = p.get("forest_continuity") or {}
        nu = (p.get("nutzung") or {}).get("shares_pct") or {}
        L.append("| " + " | ".join([
            p["name_de"], lab.get(sp.get("dominant"), "–"), top3, _fmt(sp.get("coverage_pct")),
            _fmt(sp.get("conifer_pct")), _fmt(fa.get("median_y")),
            " / ".join(_fmt(cls.get(k)) for k in AGE_CLASSES) if cls else "–",
            f"{_fmt(p.get('forest_continuity_pct'))} ({_fmt(fc.get('covered_pct'))})",
            " / ".join(_fmt(nu.get(k)) for k in ("forest", "agriculture", "settlement", "traffic")) if nu else "pending",
        ]) + " |")
    L += ["", "Biodiversity (GBIF counts; rarefied = expected species in 500 / 150 records, ± 1.96 SD) and roof PV "
              "potential (LoD2)", "",
          "| Place | Species | Records | iNat % | Rarefied 500 (range) | Rarefied 150 range | Years | Roof bldgs "
          "| Suitable m² | kWp (lo–hi) |", "|---|---|---|---|---|---|---|---|---|---|"]
    for p in doc["places"]:
        b = p.get("biodiversity") or {}
        rp = p.get("roof_potential") or {}
        yrs = "–" if not b.get("years") else f"{b['years'][0]}–{b['years'][1]}"
        L.append("| " + " | ".join([
            p["name_de"], _fmt(b.get("species")), _fmt(b.get("occurrences")), _fmt(b.get("inat_share_pct")),
            (f"{_fmt(b.get('rarefied_500'))} ({_rng(b.get('rarefied_500_range'))})" if b.get("rarefied_500") is not None
             else ("few records" if b else "–")), _rng(b.get("rarefied_150_range")), yrs,
            _fmt(rp.get("buildings")), _fmt(rp.get("suitable_m2")), _rng(rp.get("kwp"))]) + " |")
    L += ["", "| Municipality | Roof potential kWp (lo–hi) | Places | Complete | PV used % (lo–mid–hi) | Reason |",
          "|---|---|---|---|---|---|"]
    for m in doc["municipalities"]:
        rp, pv = m.get("roof_potential") or {}, m.get("pv") or {}
        u = pv.get("used_pct")
        L.append(f"| {m['name_de']} | {_rng(rp.get('kwp'))} | {', '.join(rp.get('places') or []) or '–'} | "
                 f"{'yes' if rp.get('complete') else 'no'} | {'–' if not u else '–'.join(f'{v:g}' for v in u)} | "
                 f"{pv.get('used_pct_reason_de') or ''} |")
    L += ["", f"Riesen (riesen-checked-v1: top {RIESEN['n']} checked trees, ≥ {RIESEN['min_spacing_m']:g} m apart; "
              "species = DLR class at the top, p %)", "",
          "| Place | n | Heights m | Species (rank: key p) | in Trees | Rejects |", "|---|---|---|---|---|---|"]
    for p in doc["places"]:
        rs = p.get("riesen") or []
        rp = report["places"].get(p["id"], {})
        L.append("| " + " | ".join([
            p["name_de"], str(len(rs)), ", ".join(f"{r['h']:g}" for r in rs) or "–",
            ", ".join(f"{r['rank']}: {r['species']['key']} {r['species']['p']}" for r in rs if r.get("species")) or "–",
            str(sum(1 for r in rs if r.get("in_trees"))), str(rp.get("riesen_rejects") or {})]) + " |")
    L += ["", "Goals (goals-examples-v1; progress null until a second epoch / community data)", "",
          "| Place | Goal | Baseline | Target | Unit | Measured by |", "|---|---|---|---|---|---|"]
    for p in doc["places"]:
        for g in p.get("goals") or []:
            L.append(f"| {p['name_de']} | {g['title_de']} | {_fmt(g['baseline'])} ({g['baseline_year']}) | "
                     f"{_fmt(g['target'])} ({g['target_year']}) | {g['unit']} | {g['measured_by']} |")
    return L


def stats_table(doc: dict, report: dict) -> str:
    lines = [f"# Orte im Vergleich: stats table ({doc['generated']}, AOI {doc['aoi']})", "",
             "| Place | State | Category | Area ha | Parcels | Trees | Crown % | AGB t (lo–hi) | Ortslage ha | Bldgs "
             "| Canopy % | Green % | Sealed % | Inhabitants | Trees/inh. | Tallest m (E, N) | LiDAR epochs | Flags |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for p in doc["places"]:
        o = p["ortslage"] or {}
        rp = report["places"].get(p["id"], {})
        t = p["tallest"] or {}
        tall = f"{_fmt(t.get('h'))} ({t['E']:.1f}, {t['N']:.1f})" if t else "–"
        epochs = ", ".join(f"{y}: {v:g} %" for y, v in p.get("lidar_epochs") or []) or "–"
        lines.append("| " + " | ".join([
            p["name_de"], p["state"], p["category"], _fmt(p["area_ha"]), _fmt(p["parcels"]), _fmt(p["trees"]),
            _fmt(p["crown_pct"]), f"{_fmt(p['agb_t'][0])}–{_fmt(p['agb_t'][2])}", _fmt(o.get("area_ha")),
            _fmt(o.get("buildings")), _fmt(o.get("canopy_pct")), _fmt(o.get("green_pct")), _fmt(o.get("sealed_pct")),
            _fmt(p["inhabitants"]), _fmt(p["trees_per_inhabitant"], 2), tall, epochs, ", ".join(p["flags"])]) + " |")
    lines += ["", "| Municipality | AGS | Inhabitants (Zensus 2022) | PV systems | kWp | kWp/inh. | < 30 kWp |",
              "|---|---|---|---|---|---|---|"]
    for m in doc["municipalities"]:
        pv = m["pv"] or {}
        lines.append(f"| {m['name_de']} | {m['ags']} | {_fmt(m['inhabitants'])} | {_fmt(pv.get('systems'))} | "
                     f"{_fmt(pv.get('kwp'))} | {_fmt(pv.get('kwp_per_inhabitant'), 2)} | {_fmt(pv.get('small_systems'))} |")
    lines += phase1_table(doc, report)
    oc = doc["method"]["ortslage"]["params"]["osm_check"]
    lines += ["", "OSM landuse=residential check (per place): residential ha, % of it inside the Ortslage, "
              "% of the Ortslage that is OSM residential", ""]
    for pid, v in oc.items():
        lines.append(f"- {pid}: {v['osm_residential_ha']} ha, {v['residential_in_ortslage_pct']} %, "
                     f"{v['ortslage_in_residential_pct']} %")
    tt = report.get("tall_trees") or {}
    if tt:
        lines += ["", f"Tops above the app cap ({tt['app_cap_m']:g} m): {tt['above_cap']}, kept {tt['kept']} "
                      f"(trees, crown, biomass, tallest), rejected {tt['rejected']}; kept inside the 3D AOI but "
                      f"missing from its Trees layer (cap): {tt.get('kept_in_aoi_not_in_trees_layer', '–')}"]
    lines += ["", "Tallest tree per place (review context, local only): 4 m plane-fit ground slope, CHM p95 of the "
              "canopy within 20 m, distance to the full place outline, in the AOI Trees layer, inside the published "
              "outline", "", "| Place | h m | slope ° | stand p95 m | above p95 m | edge m | in Trees | in outline |",
              "|---|---|---|---|---|---|---|---|"]
    for p in doc["places"]:
        c = report["places"].get(p["id"], {}).get("tallest_context") or {}
        t = p["tallest"] or {}
        lines.append(f"| {p['name_de']} | {_fmt(t.get('h'))} | {_fmt(c.get('slope_deg'))} | "
                     f"{_fmt(c.get('stand_p95_m'))} | {_fmt(c.get('above_stand_p95_m'))} | {_fmt(c.get('edge_dist_m'))} | "
                     f"{'yes' if c.get('in_trees') else 'no'} | {'yes' if c.get('in_published_outline') else 'no'} |")
    lines += ["", "Tallest-tree rejects per place (among the candidates ≤ the app cap or already kept): " + "; ".join(
        f"{pid}: {v.get('tallest_rejects') or {}}" for pid, v in report["places"].items()), ""]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("aoi", nargs="?", default="overall", help="output AOI (default overall)")
    ap.add_argument("--refresh-osm", action="store_true", help="download the Overpass data again")
    ap.add_argument("--no-manifest", action="store_true", help="do not touch manifest.json")
    a = ap.parse_args(argv)
    run(a.aoi, refresh_osm=a.refresh_osm, write_manifest=not a.no_manifest)


if __name__ == "__main__":
    main()
