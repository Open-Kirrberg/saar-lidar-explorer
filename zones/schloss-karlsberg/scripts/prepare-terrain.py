"""Terrain for the Schloss Karlsberg viewer: crop the explorer's 1 m DTM and derive a "1789" terrain.

Inputs (read-only, untrusted data; this script only READS rasters):
  ../../data/work/karlsberg/dtm.tif  DGM1 LVGL-SL 2025 (dl-de/by-2-0), E 381000-384000, N 5465000-5468000
  ../../data/work/overall/dtm.tif    same source, larger AOI; used only for cells outside the karlsberg
                                  raster (the Karlslust lies south of N 5465000)
  ../../data/work/{karlsberg,overall}/chm.tif  canopy height (today) -> forest proxy for the ground mask
  model/catalogue.json            building footprints / base_h, terrain features (levels, ponds)

Outputs (git-ignored) in viewer/public/terrain/:
  dtm2025.f32   float32 LE, rows north -> south, cols west -> east, 1 m cells (PixelIsArea)
  dtm1789.f32   same grid, "1789 terrain" (see below)
  ground.u8     uint8 ground classes of summer 1789 on a 2 m grid (same origin), see CLASSES
  ground2025.u8 same grid, today's state: forest = today's canopy (CHM > 8 m) away from the residence features
  meta.json     grid origin, cell size, cell-centre convention, files, class legend, attribution

"1789 terrain" [I, generator rule, not a survey]:
  - courts, terraces and rondells with a catalogue level are set to that level inside their polygon
    (hard edge: the step is covered by the retaining walls the site builder draws)
  - parterres and walled gardens: DTM smoothed (gaussian sigma 3 m) to remove later pits / spoil
  - ponds: basin floor at least 0.5 m below the water level
  - parterres with a catalogue level (TF-09, TF-15) are levelled like terraces; the cut / fill is taken up by a
    talus blended over 8 m outside the polygon (fix round 1: TF-09 at 345.9 below the CdL EG floor)
  - terraces without a retaining wall (no `wall_height`: TF-07 grass bench, TF-09 kerbed garden terrace) get a grass
    bank outside, blended over TALUS_RATIO x the drop (3-10 m), so the lawn meets the kerb and the bench foot is a
    smooth slope instead of a 1 m stair-stepped cliff (wave-3 review fix)
  - building aprons (fix round 1): a 3 m apron around every footprint is flattened to the adjacent terrace /
    court level (a levelled feature within 2.5 m) or else to base_h, then blended back over 3 m; this removes
    the ruin hummocks at the wall feet (Orangerie W front). A building on a slope with an exposed basement (lowest
    storey kind 'basement', KB-B10 "nur im W frei") keeps the natural ground where no levelled feature is near,
    so its S end stands on the slope instead of in a trench at base_h (wave-6 review fix)
  - menagerie buildings (facade.menagerie: KL-B40/41/41a/43) get no pad: their houses and the island stand on their
    own plinths; the KL-B43 terraces (and any terrace feature without a level, TF-38) keep the LiDAR relief, the
    ≈ 1 m steps of the Herzogsterrassen (D KL-02), instead of being smoothed (wave-6 review fix, KB-I67)
  - building footprints: inside, the terrain takes the value of the nearest cell outside the building (so the
    step between a low court and higher ground lies under the building, hidden by its walls, instead of
    cutting the plinth in a saw-tooth), clamped to <= the lowest floor - 0.05 m (Galerie over the Küchenhof)
  - open land (lawn, meadow, hay, fields, vineyard, kitchen gardens; wave-2 review): today's micro-relief (forestry
    tracks and ruts, ditches, wind-throw lumps) is removed by a grey closing / opening limited to features < 1.6 m
    deep and a gaussian low-pass (lawn sigma 8 m, the rest 3.5 m), faded in 4-12 m away from buildings, water, dams
    and scarps and 2-6 m away from levelled courts, terraces and parterres (open_land_relief)

"1789 ground classes" (KB-I09, research/11 S1): the catalogue's top-level `landcover` polygons (built by
scripts/catalogue-v2/landcover.ts) are painted in array order (fields, hay meadows, the steep-slope forest rule,
explicit forest belts, lawn, vineyard, kitchen gardens); the forest edge gets a seeded 6-10 m noise (irregular
Waldrand) and clearings around buildings; then the terrain features (paths, courts, ponds, buildings) on top.
Today's canopy is used only for ground2025.u8.

Run (explorer pipeline env, isolated mode):
  cd pipeline && uv run python -I ../zones/schloss-karlsberg/scripts/prepare-terrain.py
"""

import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.windows import from_bounds
from scipy import ndimage

HERE = Path(__file__).resolve().parent
SK = HERE.parent
REPO = SK.parents[1]  # zones/schloss-karlsberg → repo root
DTM_KB = REPO / "data" / "work" / "karlsberg" / "dtm.tif"
DTM_OV = REPO / "data" / "work" / "overall" / "dtm.tif"
CHM_KB = REPO / "data" / "work" / "karlsberg" / "chm.tif"
CHM_OV = REPO / "data" / "work" / "overall" / "chm.tif"
CATALOGUE = SK / "model" / "catalogue.json"
# SKB_TERRAIN_OUT: write to another directory (A/B against the shipped terrain); default the viewer's public folder
OUT = Path(os.environ["SKB_TERRAIN_OUT"]) if os.environ.get("SKB_TERRAIN_OUT") else SK / "viewer" / "public" / "terrain"

# Crop (cell edges, EPSG:25832): palace, Orangerie, north terrace, Baumagazin / Carlsdorf in the
# valley (W), Schaeferei (N) and the Karlslust (S, from the overall raster).
WEST, EAST = 381150.0, 383300.0
SOUTH, NORTH = 5464500.0, 5467150.0
CELL = 1.0
GROUND_CELL = 2.0

CLASSES = {
    0: ("meadow", "Wiese / Feld (Annahme)"),
    1: ("lawn", "Rasen (Parterre, Terrasse)"),
    2: ("gravel", "Kies / Sandsteingrus"),
    3: ("cobbles", "Pflaster"),
    4: ("sand", "Sand (Reitplatz)"),
    5: ("water", "Wasser"),
    6: ("forest", "Wald (1789: Landbedeckung nach research/11 S1; 2025: heutiger Bestand)"),
    7: ("building", "Gebäudegrund"),
    8: ("field", "Acker (Getreide, Juli)"),
    9: ("vineyard", "Weinberg"),
    10: ("kitchen_garden", "Küchen- und Baumschulgarten"),
    11: ("hay", "Heuwiese (Juli, teils gemäht)"),
    12: ("parterre_sand", "Feiner Parterresand"),
}

# landcover `cover` -> ground class (research/11 S1; 0 meadow stays the generic pasture / meadow)
COVER_CLASS = {"meadow": 0, "lawn": 1, "forest": 6, "field": 8, "vineyard": 9, "kitchen_garden": 10, "nursery": 10, "hay": 11}
SCENE_YEAR = 1789
# KB-I96 (wave-11 review fix): land-cover areas painted over the open land after the seeded tree planners were frozen
# (wave 11 Gewann fill, mirrors scripts/catalogue-v2/landcover.ts GEWANN_FILL_IDS). The ground is also painted without
# them; meta.json ground.plannerBase lists the cells where that base differs as runs [row, col0, length, class]. The
# viewer's tree planners take their seeded order from the base (viewer/src/forest.ts), so painting a fill area hides
# trees (ghosts) but never re-rolls the looks of the others. Add later land-cover edits of the open land here too.
PLANNER_BASE_SKIP = ("LC-06", "LC-07", "LC-08")
FOREST_EDGE_NOISE_M = 7.0  # amplitude of the irregular forest edge (research/11 S1: noise 6-10 m) [N]
FOREST_CLEAR_BUILDING_M = 14.0  # clearing around buildings inside the forest (KB-B28: clearing D 40-50 m, D Schneider)
FOREST_CLEAR_WAY_M = 3.0  # verge beside paths and avenues through the forest
SLOPE_RULE_MIN_AREA_M2 = 2500.0  # slope-rule woods smaller than this are dropped (speckle)
# 1789 open-land relief (wave-2 review; I, generator rule): today's tracks, ruts and lumps off the lawn and meadows
OPEN_MORPH_R = 5  # radius (m) of the grey closing: fills depressions up to ~10 m wide (tracks, ruts, ditches)
OPEN_FILL_KEEP_M = 1.6  # deeper depressions / higher lumps (gullies, hollow ways, valleys) are kept
OPEN_SIGMA_LAWN_M = 8.0  # scythed court lawn: strong low-pass
OPEN_SIGMA_FIELD_M = 3.5  # meadow, hay, fields, vineyard, kitchen gardens: mild low-pass
# grass bank (Böschung) outside terraces without a retaining wall (wave-3 review fix: TF-07 foot, TF-09 kerb) [N banks
# 1:1.5-1:2; I]: width = TALUS_RATIO x the 90th-percentile drop in the 3 m ring outside, clamped
TALUS_RATIO = 2.5
TALUS_MIN_M = 3.0
TALUS_MAX_M = 10.0
TALUS_CREST_SIGMA_M = 1.5
# wave 5 (KB-I61 residual, GARDEN_DETAIL.pavilionPad in model/src/layout/grammar.ts): free-standing garden pavilions get
# a long blend from their 3 m apron to the natural lawn, so the pad reads as a gentle mound or dish, not a pit beside
# the portico or a plinth on stilts above a falling slope [I generator rule]
PAVILION_PAD_IDS = ("KB-B07", "KB-B06a", "KB-B87", "KB-B88")
PAVILION_PAD_BLEND_M = 12.0
# KB-I52 (wave 8): the foot of a retaining wall on the 1 m terrain mesh. A hard step at the polygon edge interpolates
# across the 0.8 m wall body and pokes out of its faces as saw teeth up to ~60 % of the drop (TF-08 S of KB-B02, pose 49).
# Within +-WALL_FOOT_RAMP_M of the edge the terrain is a straight ramp in the distance to the edge (linear functions
# survive the mesh interpolation), so both faces see a straight line: on the outside an earth toe ~0.27 x the drop
# high, on the inside a shallow uniform gutter along the parapet; beyond, a flat foot to WALL_FOOT_FLAT_M [I generator rule].
WALL_FOOT_IDS = ("TF-08",)
WALL_FOOT_RAMP_M = 0.8
WALL_FOOT_FLAT_M = 1.6
# KB-I52 (wave 8): forecourt pad in front of a portico Freitreppe on falling ground (KB-B02 W end: floor 346.2, the
# 11-step stair lands at base_h 344.8 while today's ground is 341.6). The generic 3 m apron + 3 m blend read as a
# mound; instead a level landing PORTICO_PAD_DEPTH_M deep at base_h along the whole end, then a long grass bank.
# The 1789 forecourt level there is U [I generator rule]. id -> footprint edge chosen by its outward direction (E, N).
PORTICO_PADS = {"KB-B02": (-1.0, 0.0)}
PORTICO_PAD_DEPTH_M = 7.0
PORTICO_PAD_BLEND_M = 9.0
# wave 9 (garden, audit #1): natural pond shores. The water plane is the catalogue polygon, so the shore was the polygon
# edge cutting the terrain: ruler-straight lines, and a cut cliff where the bank stood above the lowered floor (39, 45,
# 48). Ponds with a natural bank (kind pond, no stone coping, not a formal "Bassin"; site/shore.ts naturalShore) get
# a smoothed, irregular shoreline: the polygon's signed distance is low-passed (sigma SHORE_SIGMA x sqrt(area),
# clamped) and moved by seeded smooth noise (SHORE_WANDER m, + = into the water), so corners round off and the long
# edges wander; this continuous field F (shore_field) is the distance to the shore, so the contour runs between the
# raster cells. Inside, a shallow shelf (SHORE_SHELF: depth at the waterline, per metre, the shelf's last depth) over
# SHORE_SHELF_M, then the floor at least that deep; outside, a grass bank to the water (research/11 S12, §4.5: grass to
# the water on the gentle side), its rise per metre clamped to SHORE_BANK_SLOPE (gentle, at most 1:2) and blended back
# to the ground over SHORE_BANK_M, its creases softened; islands rise SHORE_ISLAND (per metre, top) above the water. Buildings, levelled features and the
# 3 m building aprons keep their levels. The viewer draws the water over a terrain-aligned grid out to the wander's
# outer limit and lets the terrain contour be the shore (site/shore.ts) [I generator rule; N natural banks].
SHORE_SIGMA = 0.06
SHORE_SIGMA_CLAMP = (2.0, 6.0)
SHORE_WANDER = (-1.5, 3.0)
SHORE_SHELF = (0.0, 0.16, 1.0)
SHORE_SHELF_M = 4.0
SHORE_BANK_SLOPE = (0.05, 0.5)
SHORE_BANK_M = 8.0
SHORE_ISLAND = (0.3, 0.6)  # superseded by SHORE_ISLAND_* (wave-9 review fix), kept for the record
# wave-9 review fix (39: the TF-21 island read as a flat raised lens with a hard dark under-lip): the island's own bank
# runs through the waterline at SHORE_ISLAND_SLOPE (1:4) on its smoothed signed distance G: under water it rises from
# the pond floor over up to SHORE_ISLAND_UNDER_M (wl + slope · G, never below the shelf bed), above it eases toward the
# catalogue `level` (wl + top · (1 − exp(−slope · G / top)), slope 1:4 at the waterline), so the terrain, not a lip
# of the water mesh, meets the water and the bank is 3-5 m wide [I generator rule]
SHORE_ISLAND_SLOPE = 0.25
SHORE_ISLAND_UNDER_M = 5.0
SHORE_ISLAND_TOP_M = 0.6  # fallback top above the water when the island has no `level`
# wave 9 (garden, audit #1): bare forecourts (path features whose surface names a forecourt, KB-V1 between the
# Ehrenhof grille and the guard houses): today's lumps read as sand humps at eye level (47). The pad takes a low-pass
# (sigma FORECOURT_SIGMA_M, normalised over the free ground, so the terrace wall and the plinths do not pull it), then
# blends back over FORECOURT_BLEND_M; the building aprons within FORECOURT_KEEP_M of a footprint, the buildings and
# levelled features keep their levels [I generator rule]
FORECOURT_SIGMA_M = 4.0  # wave 9 (superseded by the plane below; kept for the record)
FORECOURT_KEEP_M = 2.0
FORECOURT_BLEND_M = 3.0
# wave-9 review fix: the low-pass left two rubble humps at the court-mouth wall (47). A forecourt pad is now one plane,
# fitted by least squares over its free ground with cells more than FORECOURT_PLANE_TOL_M above the fit dropped (the
# humps), FORECOURT_PLANE_ITER rounds [I generator rule: a levelled forecourt, Le Clerc's "bare forecourt"]
FORECOURT_PLANE_TOL_M = 0.2
FORECOURT_PLANE_ITER = 4
FORECOURT_PLANE_BLEND_M = 6.0
FORECOURT_MAX_SLOPE = 0.04  # N courts and forecourts laid to a fall of 1-4 % [I]
# wave-9 review fix (47, 26: the carriage approach ended at a 2.0-2.3 m wall across the court mouth): a drive is a path
# with `top` (at its first vertex) and `foot` (at its last); its surface is a straight grade between them across the
# full width, then runs out into the ground over DRIVE_END_BLEND_M. With `wall_height` it is a walled ramp: flanking
# walls DRIVE_WALL_THICK_M thick on both edges (model/src/site/drive.ts draws them; the terrace wall is cut across
# it in access.ts) and only a short earth toe (DRIVE_TOE_M) outside them where the fill is small [I generator rule;
# N carriage ramps <= 1:10, research/09]
DRIVE_WALL_THICK_M = 0.8  # = DRIVE.wallThick in model/src/layout/grammar.ts
DRIVE_WALL_RUNOUT_M = 0.8
DRIVE_WALL_MIN_FILL_M = 0.9  # = DRIVE.wallMinFill
DRIVE_TOE_M = 2.0
DRIVE_END_BLEND_M = 4.0


def is_forecourt(f):
    """A bare forecourt pad: a path LineString whose surface names a forecourt and that is no drive."""
    return f["kind"] == "path" and f["geometry"]["type"] == "LineString" and "forecourt" in (f.get("surface") or "").lower() and not is_drive(f)


def is_drive(f):
    """A graded drive (model/src/site/drive.ts isDrive): a path LineString with `top`, `foot`, `width` and `wall_height`
    (0 = unwalled). The terrace stair TF-35 has top/foot/width but no wall_height and keeps its own treatment."""
    return f["kind"] == "path" and f["geometry"]["type"] == "LineString" and f.get("top") is not None and f.get("foot") is not None and bool(f.get("width")) and f.get("wall_height") is not None


def on_meadow(b):
    """Staffage standing on the meadow itself (KB-I71, wave-7 review: the hay wagon KL-B52 sat on a building pad): no
    levelled apron and no building ground class under it."""
    return ((b.get("facade") or {}).get("folly") or {}).get("kind") == "hay_wagon"


def in_epoch(o, year=SCENE_YEAR):
    e = o.get("epoch") or {}
    return not ((e.get("from") is not None and year < e["from"]) or (e.get("to") is not None and year > e["to"]))


def smooth_noise(shape, sigma, seed):
    """Seeded smooth noise with unit standard deviation (gaussian-filtered white noise)."""
    n = ndimage.gaussian_filter(np.random.default_rng(seed).standard_normal(shape).astype(np.float32), sigma)
    return n / max(float(n.std()), 1e-6)


def read_crop(path_main, path_fill, bounds):
    """Read `bounds` from the main raster, filling cells outside it from the fill raster."""
    w, s, e, n = bounds
    cols = int(round((e - w) / CELL))
    rows = int(round((n - s) / CELL))
    out = np.full((rows, cols), np.nan, dtype=np.float32)
    report = {}
    for path in (path_main, path_fill):
        if not path.exists():
            continue
        with rasterio.open(path) as ds:
            if abs(ds.res[0] - CELL) > 1e-9 or abs(ds.res[1] - CELL) > 1e-9:
                raise SystemExit(f"{path}: expected 1 m cells, got {ds.res}")
            b = ds.bounds
            iw, ie = max(w, b.left), min(e, b.right)
            is_, in_ = max(s, b.bottom), min(n, b.top)
            if iw >= ie or is_ >= in_:
                continue
            win = from_bounds(iw, is_, ie, in_, ds.transform).round_offsets().round_lengths()
            a = ds.read(1, window=win).astype(np.float32)
            if ds.nodata is not None and np.isfinite(ds.nodata):
                a[a == ds.nodata] = np.nan
            r0 = int(round((n - in_) / CELL))
            c0 = int(round((iw - w) / CELL))
            sub = out[r0 : r0 + a.shape[0], c0 : c0 + a.shape[1]]
            if path == path_fill:
                both = np.isfinite(sub) & np.isfinite(a)
                if both.any():
                    d = np.abs(sub[both] - a[both])
                    report["overlap_cells"] = int(both.sum())
                    report["overlap_max_abs_diff_m"] = round(float(d.max()), 4)
                    report["overlap_mean_abs_diff_m"] = round(float(d.mean()), 4)
                fill = ~np.isfinite(sub) & np.isfinite(a)
                sub[fill] = a[fill]
                report["filled_from_overall"] = int(fill.sum())
            else:
                sub[:] = a
                report["from_karlsberg"] = int(np.isfinite(a).sum())
    return out, report


def fill_nan(a):
    bad = ~np.isfinite(a)
    if not bad.any():
        return a, 0
    idx = ndimage.distance_transform_edt(bad, return_distances=False, return_indices=True)
    return a[tuple(idx)], int(bad.sum())


def buffer_line(line, half):
    (x0, y0), (x1, y1) = line[0], line[-1]
    L = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5
    nx, ny = -(y1 - y0) / L * half, (x1 - x0) / L * half
    return [[x0 - nx, y0 - ny], [x1 - nx, y1 - ny], [x1 + nx, y1 + ny], [x0 + nx, y0 + ny], [x0 - nx, y0 - ny]]


def buffer_polyline(line, half):
    """Union of per-segment rectangles (good enough for rasterising an avenue band)."""
    return [{"type": "Polygon", "coordinates": [buffer_line([line[i], line[i + 1]], half)]} for i in range(len(line) - 1)]


def mask_of(geoms, shape, transform):
    if not geoms:
        return np.zeros(shape, dtype=bool)
    return rasterize([(g, 1) for g in geoms], out_shape=shape, transform=transform, fill=0, dtype="uint8", all_touched=False).astype(bool)


def poly(ring):
    return {"type": "Polygon", "coordinates": [ring]}


def rotunda_pads(b):
    """KB-I61: the portico (podium + steps + 0.6 m) and the colonnade of a round temple pavilion (`facade.rotunda`,
    model/src/layout/rotunda.ts) count as footprint, so the 3 m apron levels the ground round them at base_h (the
    rotunda's grade below the bottom step) instead of leaving the old square pad and a hollow [I generator rule]."""
    spec = (b.get("facade") or {}).get("rotunda")
    ring = b.get("footprint")
    if not spec or not ring:
        return []
    pts = np.array(ring[:-1] if ring[0] == ring[-1] else ring, dtype=float)
    c = pts.mean(axis=0)
    radius = float(np.hypot(*(pts - c).T).max())
    az = np.radians(float(spec["axis_azimuth"]))
    ax = np.array([np.sin(az), np.cos(az)])
    nm = np.array([-ax[1], ax[0]])
    floors = [s for s in (b.get("storeys") or []) if s.get("kind") == "floor"]
    D = (floors[0]["height"] / 1.25) / 9.0 if floors else 0.6  # Vignola Ionic: column 9 D, entablature 1/4 (grammar ROTUNDA)

    def band(direction, d0, d1, hw):
        q = [c + direction * d0 - nm * hw, c + direction * d1 - nm * hw, c + direction * d1 + nm * hw, c + direction * d0 + nm * hw]
        q.append(q[0])
        return poly([[float(x), float(y)] for x, y in q])

    out = []
    p = spec.get("portico")
    if p:
        reach = radius + p["depth"] + 0.75 * D + p["steps"] * 0.38 + 0.6
        out.append(band(ax, radius - 1.0, reach, p["width"] / 2 + 0.3 + 0.4))
    col = spec.get("colonnade")
    if col:
        out.append(band(-ax, radius - 1.0, radius + col["length"], col["width"] / 2 + 0.3))
    return out


def smoothstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def disk(r):
    y, x = np.mgrid[-r : r + 1, -r : r + 1]
    return (x * x + y * y) <= r * r + 0.5


def capped(delta, keep, fade):
    """Morphological fill / cut limited to shallow features: each connected depression (or lump) is kept whole when
    its deepest point is <= `keep` m, faded out by `keep + fade` m (so a deep gully is not half-filled on its sides)."""
    lab, n = ndimage.label(delta > 0.15)
    if not n:
        return delta
    deepest = np.concatenate([[0.0], ndimage.maximum(delta, lab, index=np.arange(1, n + 1))]).astype(np.float32)
    w = np.clip((keep + fade - deepest) / fade, 0.0, 1.0)[lab]
    # the shallow rim (< 0.15 m) of a kept deep feature stays too, so its banks are not reshaped
    rim = ndimage.binary_dilation(lab > 0, iterations=2) & (lab == 0)
    w[(lab == 0) & ~rim] = 1.0
    w[rim] = np.clip(w[tuple(ndimage.distance_transform_edt(~(lab > 0), return_distances=False, return_indices=True))][rim], 0.0, 1.0)
    return delta * w


def natural_pond(f):
    """Pond with a natural bank (mirrors model/src/site/shore.ts naturalShore)."""
    return (
        f["kind"] == "pond"
        and f.get("water_level") is not None
        and not f.get("coping")
        and f["geometry"]["type"] == "Polygon"
        and "bassin" not in (f.get("name") or "").lower()
    )


def shore_field(f, shape, tr):
    """Window (r0, r1, c0, c1), the polygon mask P and the shore field F of a natural pond: a smooth, approximately
    metric signed distance to the graded shoreline (> 0 in the water). Continuous, so the terrain contour at the water
    level runs between the raster cells instead of along their edges (no 1 m staircase)."""
    import zlib

    ring = f["geometry"]["coordinates"][0]
    es = [p[0] for p in ring]
    ns = [p[1] for p in ring]
    m = 16
    rows, cols = shape
    c0 = max(0, int((min(es) - WEST) / CELL) - m)
    c1 = min(cols, int((max(es) - WEST) / CELL) + m + 1)
    r0 = max(0, int((NORTH - max(ns)) / CELL) - m)
    r1 = min(rows, int((NORTH - min(ns)) / CELL) + m + 1)
    P = mask_of([poly(ring)], shape, tr)[r0:r1, c0:c1]
    sigma = float(np.clip(SHORE_SIGMA * np.sqrt(P.sum() * CELL * CELL), *SHORE_SIGMA_CLAMP))
    sd = (ndimage.distance_transform_edt(P) - ndimage.distance_transform_edt(~P)) * CELL
    sds = ndimage.gaussian_filter(sd, sigma / CELL)
    lo, hi = SHORE_WANDER
    noise = smooth_noise(P.shape, max(3.0, 1.5 * sigma) / CELL, zlib.crc32(f["id"].encode()))
    off = np.clip((lo + hi) / 2 + noise * (hi - lo) / 3, lo, hi)
    F = sds - off
    # drop stray puddles: water parts that do not reach the polygon's core become land
    lab, n = ndimage.label(F > 0)
    if n > 1:
        core = sd > 2.0
        for k in range(1, n + 1):
            part = lab == k
            if not (core & part).any():
                F[part] = -0.05
    return (r0, r1, c0, c1), P, F


def natural_shores(h, feats, hard, any_fp, shape, tr):
    """Grade the natural pond shores (see SHORE_*); returns the new heights and report lines."""
    out = h.copy()
    rep = []
    islands = [f for f in feats if f["kind"] == "island" and f["geometry"]["type"] == "Polygon"]
    for f in feats:
        if not natural_pond(f):
            continue
        wl = float(f["water_level"])
        (r0, r1, c0, c1), P, F = shore_field(f, shape, tr)
        hw = out[r0:r1, c0:c1].copy()
        isl_top = SHORE_ISLAND_TOP_M
        if islands:
            isl = mask_of([poly(i["geometry"]["coordinates"][0]) for i in islands], shape, tr)[r0:r1, c0:c1] & P
            # islands: a smoothed signed distance as well, so their shore is round too (> 0 on the island)
            G = ndimage.gaussian_filter((ndimage.distance_transform_edt(isl) - ndimage.distance_transform_edt(~isl)) * CELL, 1.5)
            F = np.minimum(F, -G)
            lv = [float(i["level"]) - wl for i in islands if i.get("level") is not None and isl.any()]
            if lv and max(lv) > 0.1:
                isl_top = max(lv)
        else:
            G = np.full(P.shape, -1e3)
        fixed = (hard | any_fp)[r0:r1, c0:c1]
        prot = fixed | (ndimage.distance_transform_edt(~any_fp[r0:r1, c0:c1]) * CELL <= 3.0)
        water = F > 0
        din = np.maximum(F, 0.0)
        dout = np.maximum(-F, 0.0)
        k, dmax = SHORE_SHELF[1], SHORE_SHELF[2]
        # the shelf runs through the water level at F = 0 (continuous with the bank), so the contour is F = 0
        depth = np.minimum(k * din, dmax)
        bed = np.where(din < SHORE_SHELF_M, wl - depth, np.minimum(hw, wl - depth))
        new = hw.copy()
        sel = water & ~fixed
        new[sel] = bed[sel]
        lo = wl + SHORE_BANK_SLOPE[0] * dout
        hi = wl + 0.1 + SHORE_BANK_SLOPE[1] * dout
        land = ~water & (G <= 0)
        band = land & (dout <= SHORE_BANK_M) & ~prot
        w = smoothstep(1.0 - dout / SHORE_BANK_M)
        graded = hw * (1.0 - w) + np.clip(hw, lo, hi) * w
        new[band] = graded[band]
        # soften the creases where the clamps meet the natural bank (outside the first metre, which stays on the profile)
        soft = ndimage.gaussian_filter(new, 1.2)
        crease = band & (dout > 1.0)
        new[crease] = soft[crease]
        near = band & (dout <= 3.0)
        new[near] = np.maximum(new[near], lo[near])
        ia = G > 0
        if ia.any():
            # the island bank (SHORE_ISLAND_*): under water from the floor up to the waterline at 1:4, above it easing
            # toward the island's level with the same slope at the waterline
            k_i = SHORE_ISLAND_SLOPE
            iu = water & ~fixed & (G > -SHORE_ISLAND_UNDER_M) & (G <= 0)
            new[iu] = np.maximum(new[iu], wl + k_i * G[iu])
            new[ia] = np.maximum(new[ia], wl + isl_top * (1.0 - np.exp(-k_i * G[ia] / isl_top)))
        out[r0:r1, c0:c1] = new.astype(np.float32)
        dz = new - hw
        rep.append(
            f"{f['id']} natural shore: water {int(water.sum())} cells (polygon {int(P.sum())}), bank {int(band.sum())} cells, "
            f"max fill {float(dz.max()):.2f} m, max cut {float(dz.min()):.2f} m"
        )
    return out, rep


def open_land_relief(h, g, hard, any_fp, feats, shape, tr):
    """1789 relief of open land [I, generator rule; wave-2 review]: today's DTM micro-relief (forestry tracks and
    ruts, ditches, wind-throw lumps) does not belong on a scythed court lawn or hay meadows of 1789.

    - shallow linear depressions (< OPEN_FILL_KEEP_M deep, < 2 r wide) are filled by a grey closing, shallow lumps cut
      by a grey opening; deeper ones (gullies, hollow ways, real valleys) are kept;
    - then a gaussian low-pass: lawn sigma OPEN_SIGMA_LAWN_M, meadow / hay / field / vineyard / kitchen garden (and
      the paths through them) sigma OPEN_SIGMA_FIELD_M;
    - not on forest (graded over ~6 m), water, buildings, levelled courts / terraces / parterres, dams, scarps and
      cascades: the rule fades in from 4 m to 12 m away from them (from 2 m to 6 m beside levelled courts, terraces
      and parterres), so plinths, steps, terrace edges and pond banks keep their levels.
    """
    rows, cols = shape
    g1 = np.repeat(np.repeat(g, 2, axis=0), 2, axis=1)[:rows, :cols]
    lawn = g1 == 1
    open_ = np.isin(g1, (0, 1, 2, 8, 9, 10, 11, 12))
    water = mask_of(
        [poly(f["geometry"]["coordinates"][0]) for f in feats if f["kind"] in ("pond", "moat", "basin", "island", "well") and f["geometry"]["type"] == "Polygon"],
        shape,
        tr,
    )
    lines = []
    for f in feats:
        if f["kind"] in ("dam", "scarp", "cascade") and f["geometry"]["type"] == "LineString":
            lines += buffer_polyline(f["geometry"]["coordinates"], 4.0)
    # terraces without a level (TF-38 Menagerie-Terrassen) keep the LiDAR relief: their ≈ 1 m steps are D (KL-02)
    keep = mask_of([poly(f["geometry"]["coordinates"][0]) for f in feats if f["kind"] == "terrace" and f.get("level") is None and f["geometry"]["type"] == "Polygon"], shape, tr)
    protect = hard | any_fp | water | mask_of(lines, shape, tr) | (g1 == 7) | (g1 == 5) | keep
    # buildings, water, dams, scarps: the rule fades in from 4 m to 12 m; levelled courts / terraces / parterres
    # (wave-3 ground review): from 2 m to 6 m, so the banks below the terraces (Orangerie W front) lose today's
    # rubble lumps while the terrace edge and the wall foot keep their levels
    firm = protect & ~(hard & ~any_fp)
    d_firm = ndimage.distance_transform_edt(~firm) * CELL
    d_lvl = ndimage.distance_transform_edt(~(hard & ~any_fp)) * CELL
    ramp = np.minimum(smoothstep((d_firm - 4.0) / 8.0), smoothstep((d_lvl - 2.0) / 4.0))
    h_fill = ndimage.grey_closing(h, footprint=disk(OPEN_MORPH_R))
    h1 = h + capped(h_fill - h, OPEN_FILL_KEEP_M, 0.8)
    h_cut = ndimage.grey_opening(h1, footprint=disk(OPEN_MORPH_R - 1))
    h1 = h1 - capped(h1 - h_cut, OPEN_FILL_KEEP_M, 0.8)
    g_field = ndimage.gaussian_filter(h1, OPEN_SIGMA_FIELD_M / CELL)
    g_lawn = ndimage.gaussian_filter(h1, OPEN_SIGMA_LAWN_M / CELL)
    a_lawn = np.clip(ndimage.gaussian_filter(lawn.astype(np.float32), 4.0), 0.0, 1.0)
    a_open = np.clip(ndimage.gaussian_filter(open_.astype(np.float32), 3.0), 0.0, 1.0) * ramp
    a_open[protect] = 0.0
    target = g_field * (1.0 - a_lawn) + g_lawn * a_lawn
    out = (h * (1.0 - a_open) + target * a_open).astype(np.float32)
    dz = out - h
    # residual micro-relief (h minus its 6 m low-pass), before and after, on the open cells away from protected ones
    core = open_ & (ramp > 0.99)
    rough = lambda a: float(np.sqrt(np.mean((a - ndimage.gaussian_filter(a, 6.0))[core] ** 2))) if core.any() else 0.0
    rep = (
        f"open-land relief 1789 (fill/cut < {OPEN_FILL_KEEP_M} m, r {OPEN_MORPH_R} m; sigma lawn {OPEN_SIGMA_LAWN_M} m, "
        f"fields {OPEN_SIGMA_FIELD_M} m): {int((np.abs(dz) > 0.05).sum())} cells changed, max fill {dz.max():.2f} m, "
        f"max cut {dz.min():.2f} m, micro-relief rms {rough(h):.3f} -> {rough(out):.3f} m"
    )
    return out, rep


def paint_1789(cat, gshape, gtr, slope, blds_g, feats_g, paint_features, skip):
    """1789 ground classes: land cover polygons (KB-I09) in array order except the ids in `skip`, irregular forest edge,
    clearings, then the features. Returns (ground, report)."""
    g = np.zeros(gshape, dtype=np.uint8)
    lc_report = []
    for a in cat.get("landcover", []):
        if not in_epoch(a) or a["cover"] not in COVER_CLASS or a["id"] in skip:
            continue
        m = mask_of([poly(a["geometry"]["coordinates"][0])], gshape, gtr)
        if a.get("min_slope") is not None:
            m &= slope >= float(a["min_slope"])
            m = ndimage.binary_opening(ndimage.binary_closing(m, iterations=3), iterations=2)
            lab, n = ndimage.label(m)
            if n:
                sizes = ndimage.sum(m, lab, index=np.arange(1, n + 1)) * GROUND_CELL**2
                m &= np.isin(lab, 1 + np.nonzero(sizes >= SLOPE_RULE_MIN_AREA_M2)[0])
        g[m] = COVER_CLASS[a["cover"]]
        lc_report.append(f"{a['id']} {a['cover']}: {int(m.sum()) * GROUND_CELL**2 / 1e4:.1f} ha painted")
    # irregular forest edge: move the boundary by smooth seeded noise (two scales), only into open land
    forest = g == 6
    sd = (ndimage.distance_transform_edt(forest) - ndimage.distance_transform_edt(~forest)) * GROUND_CELL
    noise = (0.75 * smooth_noise(gshape, 7.0, 1789) + 0.25 * smooth_noise(gshape, 2.0, 1790)) * FOREST_EDGE_NOISE_M
    grown = (sd + noise > 0) & ~forest & np.isin(g, (0, 8, 11))
    shrunk = forest & (sd + noise <= 0)
    _, idx_open = ndimage.distance_transform_edt(forest, return_distances=True, return_indices=True)
    g[shrunk] = g[tuple(idx_open)][shrunk]
    g[grown] = 6
    # clearings: around buildings (and the path verges) inside the forest
    bmask = mask_of([poly(b["footprint"]) for b in blds_g if b.get("footprint")], gshape, gtr)
    wmask = np.zeros(gshape, dtype=bool)
    for f in feats_g:
        if f["geometry"]["type"] == "LineString" and f["kind"] in ("avenue", "path", "walk"):
            wmask |= mask_of(buffer_polyline(f["geometry"]["coordinates"], (f.get("width") or 4) / 2 + FOREST_CLEAR_WAY_M), gshape, gtr)
    clear = (ndimage.distance_transform_edt(~bmask) * GROUND_CELL < FOREST_CLEAR_BUILDING_M) | wmask
    g[(g == 6) & clear] = 0
    paint_features(g, feats_g, blds_g)
    lc_report.append(f"forest edge noise +-{FOREST_EDGE_NOISE_M} m: {int(grown.sum())} cells grown, {int(shrunk.sum())} shrunk")
    return g, lc_report


def main():
    t0 = time.time()
    if not DTM_KB.exists():
        raise SystemExit(f"missing {DTM_KB}")
    cat = json.loads(CATALOGUE.read_text())
    bounds = (WEST, SOUTH, EAST, NORTH)
    h2025, rep = read_crop(DTM_KB, DTM_OV, bounds)
    h2025, n_nan = fill_nan(h2025)
    rep["nan_filled_nearest"] = n_nan
    rows, cols = h2025.shape
    tr = from_origin(WEST, NORTH, CELL, CELL)
    shape = (rows, cols)
    print(f"[terrain] grid {cols} x {rows} @ {CELL} m, {rep}")

    feats = cat["terrain_features"]
    blds = [b for b in cat["buildings"] if b.get("placement") != "unplaced" and b.get("base_h") is not None]

    h = h2025.copy()
    smooth = ndimage.gaussian_filter(h2025, sigma=3.0)
    applied = []

    def blend_outside(mask, target, width, protect):
        """Blend `target` (array or scalar) into h outside `mask` over `width` m (smoothstep)."""
        nonlocal h
        d = ndimage.distance_transform_edt(~mask) * CELL
        w = smoothstep(1.0 - d / width)
        w[mask] = 0.0
        w[protect] = 0.0
        tgt = target if isinstance(target, np.ndarray) else np.float32(target)
        h = (h * (1 - w) + tgt * w).astype(np.float32)

    hard = np.zeros(shape, dtype=bool)  # cells set by courts / terraces (no blending into them)

    # 1. parterres + walled gardens (GARD without roof): smoothed DTM
    soft_geoms = [poly(f["geometry"]["coordinates"][0]) for f in feats if f["kind"] == "parterre" and f["geometry"]["type"] == "Polygon"]
    soft_geoms += [
        poly(b["footprint"])
        for b in blds
        if b["cls"] == "GARD" and b["footprint"] and (b["roof"] or {}).get("type") in (None, "none") and (b.get("facade") or {}).get("menagerie", {}).get("kind") != "rows"
    ]
    m = mask_of(soft_geoms, shape, tr)
    h[m] = smooth[m]
    blend_outside(m, smooth, 3.0, hard)
    applied.append(f"smoothed parterres/gardens: {int(m.sum())} cells")

    # 2. ponds: basin floor below the water level
    for f in feats:
        if f["kind"] == "pond" and f.get("water_level") is not None and f["geometry"]["type"] == "Polygon":
            m = mask_of([poly(f["geometry"]["coordinates"][0])], shape, tr)
            h[m] = np.minimum(h[m], f["water_level"] - 0.5)
            applied.append(f"{f['id']} pond floor <= {f['water_level'] - 0.5:.2f}: {int(m.sum())} cells")

    # 3. levelled parterres (talus outside), terraces, then rondells / courts at their level (hard edges)
    for f in feats:
        if f["kind"] != "parterre" or f.get("level") is None or f["geometry"]["type"] != "Polygon":
            continue
        m = mask_of([poly(f["geometry"]["coordinates"][0])], shape, tr)
        h[m] = f["level"]
        blend_outside(m, float(f["level"]), 8.0, hard)
        hard |= m
        applied.append(f"{f['id']} parterre level {f['level']} (talus 8 m): {int(m.sum())} cells")
    for kind in ("terrace", "rondell", "court"):
        for f in feats:
            if f["kind"] != kind or f.get("level") is None or f["geometry"]["type"] != "Polygon":
                continue
            m = mask_of([poly(f["geometry"]["coordinates"][0])], shape, tr)
            h[m] = f["level"]
            hard |= m
            applied.append(f"{f['id']} {kind} level {f['level']}: {int(m.sum())} cells")
    for f in feats:
        if f["kind"] != "terrace" or f.get("level") is None or f.get("wall_height") or f["geometry"]["type"] != "Polygon":
            continue
        m = mask_of([poly(f["geometry"]["coordinates"][0])], shape, tr)
        ring = ~m & (ndimage.distance_transform_edt(~m) * CELL <= 3.0) & ~hard
        if not ring.any():
            continue
        drop = float(np.percentile(np.abs(h[ring] - f["level"]), 90))
        width = float(np.clip(TALUS_RATIO * drop, TALUS_MIN_M, TALUS_MAX_M))
        blend_outside(m, float(f["level"]), width, hard)
        # round the crest and the bank (sigma 1.5 m, outside only): the 1 m raster edge of the polygon otherwise shows
        # as a stair-stepped, fold-shaded crest on a steep bank (TF-07 at the Orangerie foot)
        band = ~m & (ndimage.distance_transform_edt(~m) * CELL <= width + 2.0) & ~hard
        h[band] = ndimage.gaussian_filter(h, TALUS_CREST_SIGMA_M / CELL)[band]
        applied.append(f"{f['id']} grass bank (no retaining wall): drop p90 {drop:.2f} m, talus {width:.1f} m, crest rounded")

    # 4. buildings: apron at the adjacent level, then the footprint from its surroundings (see docstring)
    solid = [
        b
        for b in blds
        if b["cls"] != "WALL" and b.get("footprint") and not (b["cls"] == "GARD" and (b["roof"] or {}).get("type") in (None, "none")) and not (b.get("facade") or {}).get("menagerie") and not on_meadow(b)
    ]
    fp = {b["id"]: mask_of([poly(b["footprint"])] + rotunda_pads(b), shape, tr) for b in solid}
    any_fp = np.zeros(shape, dtype=bool)
    for m in fp.values():
        any_fp |= m
    level_cells = hard & ~any_fp  # levelled courts / terraces / parterres outside buildings
    d_lvl, idx_lvl = ndimage.distance_transform_edt(~level_cells, return_distances=True, return_indices=True)
    lvl_at = h[tuple(idx_lvl)]  # value of the nearest levelled cell
    n_apron = 0
    for b in solid:
        m = fp[b["id"]]
        if not m.any():
            continue
        d = ndimage.distance_transform_edt(~m) * CELL
        apron = (d > 0) & (d <= 3.0) & ~hard & ~any_fp
        near_lvl = apron & (d_lvl * CELL <= 2.5)
        tgt = np.full(shape, np.float32(b["base_h"]), dtype=np.float32)
        slope_bldg = any(s.get("kind") == "basement" for s in (b.get("storeys") or []))
        if slope_bldg:
            tgt[:] = h  # exposed basement on a slope: natural ground unless a levelled feature is adjacent
        tgt[near_lvl] = lvl_at[near_lvl]
        h[apron] = tgt[apron]
        n_apron += int(apron.sum())
        if slope_bldg:
            continue
        # blend back to the natural ground between 3 and 6 m
        ring = (d > 3.0) & (d <= 6.0) & ~hard & ~any_fp
        w = smoothstep(1.0 - (d - 3.0) / 3.0)
        h[ring] = (h[ring] * (1 - w[ring]) + np.float32(b["base_h"]) * w[ring]).astype(np.float32)
    applied.append(f"building aprons (3 m flat at the adjacent level or base_h + 3 m blend): {n_apron} cells")
    # garden pavilions: a second, long blend (3 .. 3 + PAVILION_PAD_BLEND_M m) outside the other buildings' aprons and
    # their own 3 m blends (6 m), so a neighbour's plinth (KB-B06 at 347.6 beside KB-B07 at 349.1) is never re-buried
    for b in solid:
        if b["id"] not in PAVILION_PAD_IDS:
            continue
        m = fp[b["id"]]
        if not m.any():
            continue
        d = ndimage.distance_transform_edt(~m) * CELL
        others = any_fp & ~m
        d_other = ndimage.distance_transform_edt(~others) * CELL if others.any() else np.full(shape, np.inf, dtype=np.float32)
        ring = (d > 3.0) & (d <= 3.0 + PAVILION_PAD_BLEND_M) & ~hard & ~any_fp & (d_other > 6.0)
        w = smoothstep(1.0 - (d - 3.0) / PAVILION_PAD_BLEND_M)
        before = h[ring].copy()
        h[ring] = (h[ring] * (1 - w[ring]) + np.float32(b["base_h"]) * w[ring]).astype(np.float32)
        applied.append(f"{b['id']} pavilion pad: long blend {PAVILION_PAD_BLEND_M:.0f} m, {int(ring.sum())} cells, max change {float(np.abs(h[ring] - before).max()) if ring.any() else 0:.2f} m")
    # KB-I52: forecourt pads in front of portico stairs on falling ground (see PORTICO_PADS)
    for b in solid:
        if b["id"] not in PORTICO_PADS:
            continue
        ring = b["footprint"][:-1] if b["footprint"][0] == b["footprint"][-1] else b["footprint"]
        cx = sum(p[0] for p in ring) / len(ring)
        cy = sum(p[1] for p in ring) / len(ring)
        want = PORTICO_PADS[b["id"]]
        best = None
        for i in range(len(ring)):
            (e1, n1), (e2, n2) = ring[i], ring[(i + 1) % len(ring)]
            mx, my = (e1 + e2) / 2 - cx, (n1 + n2) / 2 - cy
            ln = (mx * mx + my * my) ** 0.5 or 1.0
            score = (mx * want[0] + my * want[1]) / ln
            if best is None or score > best[0]:
                best = (score, (e1, n1), (e2, n2), (mx / ln, my / ln))
        _, (e1, n1), (e2, n2), _ = best
        tx, ty = e2 - e1, n2 - n1
        tl = (tx * tx + ty * ty) ** 0.5
        tx, ty = tx / tl, ty / tl
        ox, oy = (want[0], want[1]) if abs(tx * want[0] + ty * want[1]) > 0.9 else (-ty, tx)
        if ox * want[0] + oy * want[1] < 0:
            ox, oy = -ox, -oy
        a0 = (e1 - tx * 1.0, n1 - ty * 1.0)
        a1 = (e2 + tx * 1.0, n2 + ty * 1.0)
        pad_ring = [list(a0), list(a1), [a1[0] + ox * PORTICO_PAD_DEPTH_M, a1[1] + oy * PORTICO_PAD_DEPTH_M], [a0[0] + ox * PORTICO_PAD_DEPTH_M, a0[1] + oy * PORTICO_PAD_DEPTH_M], list(a0)]
        pad = mask_of([poly(pad_ring)], shape, tr) & ~hard & ~any_fp
        if not pad.any():
            continue
        before = h.copy()
        h[pad] = np.float32(b["base_h"])
        blend_outside(pad | fp[b["id"]], float(b["base_h"]), PORTICO_PAD_BLEND_M, hard | any_fp)
        changed = np.abs(h - before) > 0.05
        applied.append(f"{b['id']} portico forecourt pad {PORTICO_PAD_DEPTH_M:.0f} m at {b['base_h']} + bank {PORTICO_PAD_BLEND_M:.0f} m: {int(pad.sum())} pad cells, {int(changed.sum())} changed")
    # wave 9 (review fix): bare forecourt pads as one plane (see FORECOURT_*)
    for f in feats:
        if not is_forecourt(f) or not in_epoch(f):
            continue
        half = (f.get("width") or 8) / 2
        line = f["geometry"]["coordinates"]
        d_fp = ndimage.distance_transform_edt(~any_fp) * CELL
        mod = mask_of(buffer_polyline(line, half), shape, tr) & ~hard & ~any_fp & (d_fp > FORECOURT_KEEP_M)
        # a drive through the pad keeps its own grade (next step): its walled band is left out of the plane
        drives = [g for g in feats if is_drive(g) and in_epoch(g)]
        mod &= ~mask_of([q for g in drives for q in buffer_polyline(g["geometry"]["coordinates"], g["width"] / 2 + DRIVE_WALL_THICK_M + DRIVE_WALL_RUNOUT_M)], shape, tr)
        if mod.sum() < 6:
            continue
        rr, cc = np.nonzero(mod)
        E = WEST + (cc + 0.5) * CELL
        N = NORTH - (rr + 0.5) * CELL
        A = np.stack([np.ones_like(E), E - E.mean(), N - N.mean()], axis=1)
        z = h[mod].astype(np.float64)
        keep = np.ones(z.shape, dtype=bool)
        for _ in range(FORECOURT_PLANE_ITER):  # robust fit: the humps (rubble cones at the wall) are dropped
            coef, *_ = np.linalg.lstsq(A[keep], z[keep], rcond=None)
            keep = (z - A @ coef) <= FORECOURT_PLANE_TOL_M
        # a forecourt falls gently (drainage): limit the plane's slope, keeping its height over the kept cells
        g = float(np.hypot(coef[1], coef[2]))
        if g > FORECOURT_MAX_SLOPE:
            coef[1:] *= FORECOURT_MAX_SLOPE / g
            coef[0] = float(np.median(z[keep] - A[keep, 1:] @ coef[1:]))
        plane = (A @ coef).astype(np.float32)
        before = h.copy()
        h[mod] = plane
        _, idx = ndimage.distance_transform_edt(~mod, return_indices=True)
        blend_outside(mod, h[tuple(idx)], FORECOURT_PLANE_BLEND_M, hard | any_fp | (d_fp <= FORECOURT_KEEP_M))
        hard |= mod
        dz = h - before
        slope = float(np.hypot(coef[1], coef[2]))
        applied.append(f"{f['id']} forecourt plane: {int(mod.sum())} cells ({int((~keep).sum())} hump cells dropped from the fit), slope {slope * 100:.1f} %, max fill {float(dz.max()):.2f} m, max cut {float(dz.min()):.2f} m")
    # wave 9 (review fix): graded carriage drives (see DRIVE_*)
    for f in feats:
        if not is_drive(f) or not in_epoch(f):
            continue
        (e0, n0), (e1, n1) = f["geometry"]["coordinates"][0], f["geometry"]["coordinates"][-1]
        L = float(np.hypot(e1 - e0, n1 - n0))
        ux, uy = (e1 - e0) / L, (n1 - n0) / L
        half = f["width"] / 2
        top, foot = float(f["top"]), float(f["foot"])
        walled = bool(f.get("wall_height"))
        band_w = DRIVE_WALL_THICK_M + DRIVE_WALL_RUNOUT_M
        pad_m = int(half + band_w + DRIVE_TOE_M + DRIVE_END_BLEND_M) + 2
        c0 = max(0, int((min(e0, e1) - WEST) / CELL) - pad_m)
        c1 = min(cols, int((max(e0, e1) - WEST) / CELL) + pad_m + 1)
        r0 = max(0, int((NORTH - max(n0, n1)) / CELL) - pad_m)
        r1 = min(rows, int((NORTH - min(n0, n1)) / CELL) + pad_m + 1)
        cc, rr = np.meshgrid(np.arange(c0, c1), np.arange(r0, r1))
        E = WEST + (cc + 0.5) * CELL
        N = NORTH - (rr + 0.5) * CELL
        sa = (E - e0) * ux + (N - n0) * uy  # along the drive from its top
        pa = np.abs(-(E - e0) * uy + (N - n0) * ux)  # off its centre line
        prof = (top + (foot - top) * np.clip(sa / L, 0.0, 1.0)).astype(np.float32)
        hw = h[r0:r1, c0:c1]
        free = ~hard[r0:r1, c0:c1] & ~any_fp[r0:r1, c0:c1]
        before = hw.copy()
        along = (sa >= -1.0) & (sa <= L)
        on = free & along & (pa <= half)
        new = hw.copy()
        new[on] = prof[on]
        # walled stretch (fill above DRIVE_WALL_MIN_FILL_M, the same rule as drive.ts driveWalls): the ground falls
        # linearly from the drive edge (the wall's inner face) to the ground DRIVE_WALL_RUNOUT_M beyond its outer face,
        # so the 1 m mesh hides inside the wall body except a shallow gutter and an earth toe (cf. KB-I52)
        if walled:
            wl = free & along & (pa > half) & (pa <= half + band_w) & (prof - before > DRIVE_WALL_MIN_FILL_M)
            u = (pa - half) / band_w
            new[wl] = (prof[wl] * (1 - u[wl]) + before[wl] * u[wl]).astype(np.float32)
        else:
            wl = np.zeros_like(on)
        # unwalled edges (and the low end of a walled drive): an earth toe over DRIVE_TOE_M
        toe = free & along & (pa > half) & (pa <= half + DRIVE_TOE_M) & ~wl
        w = smoothstep(1.0 - (pa - half) / DRIVE_TOE_M)
        new[toe] = (hw[toe] * (1 - w[toe]) + prof[toe] * w[toe]).astype(np.float32)
        # the foot runs out into the ground beyond the drive's end
        tail = free & (sa > L) & (sa <= L + DRIVE_END_BLEND_M) & (pa <= half + DRIVE_TOE_M)
        wt = smoothstep(1.0 - (sa - L) / DRIVE_END_BLEND_M) * smoothstep(1.0 - np.maximum(pa - half, 0.0) / DRIVE_TOE_M)
        new[tail] = (hw[tail] * (1 - wt[tail]) + np.float32(foot) * wt[tail]).astype(np.float32)
        h[r0:r1, c0:c1] = new
        hard[r0:r1, c0:c1] |= on | wl
        nat = before[on & (pa <= half)]
        fill = prof[on & (pa <= half)] - nat
        gap_foot = float(np.median(before[(np.abs(sa - L) <= 1.0) & (pa <= half)]) - foot)
        applied.append(f"{f['id']} drive {L:.1f} m at {abs(top - foot) / L * 100:.1f} % ({top} -> {foot}), {f['width']} m wide: {int(on.sum())} cells, fill up to {float(fill.max()):.2f} m, foot vs ground {gap_foot:+.2f} m")
    # KB-I52: straight retaining-wall feet (see WALL_FOOT_IDS)
    for f in feats:
        if f["id"] not in WALL_FOOT_IDS or f.get("level") is None or not f.get("wall_height") or f["geometry"]["type"] != "Polygon":
            continue
        lvl = float(f["level"])
        pring = f["geometry"]["coordinates"][0]
        es = [p[0] for p in pring]
        ns = [p[1] for p in pring]
        pad_m = 6
        c0 = max(0, int((min(es) - WEST) / CELL) - pad_m)
        c1 = min(cols, int((max(es) - WEST) / CELL) + pad_m + 1)
        r0 = max(0, int((NORTH - max(ns)) / CELL) - pad_m)
        r1 = min(rows, int((NORTH - min(ns)) / CELL) + pad_m + 1)
        cc, rr = np.meshgrid(np.arange(c0, c1), np.arange(r0, r1))
        E = WEST + (cc + 0.5) * CELL
        N = NORTH - (rr + 0.5) * CELL
        dist = np.full(E.shape, np.inf)
        for i in range(len(pring) - 1):
            (x1, y1), (x2, y2) = pring[i], pring[i + 1]
            vx, vy = x2 - x1, y2 - y1
            t = np.clip(((E - x1) * vx + (N - y1) * vy) / (vx * vx + vy * vy), 0.0, 1.0)
            dist = np.minimum(dist, np.hypot(E - (x1 + t * vx), N - (y1 + t * vy)))
        inside = mask_of([poly(pring)], shape, tr)[r0:r1, c0:c1]
        d = np.where(inside, -dist, dist)  # signed: negative inside the terrace
        hw = h[r0:r1, c0:c1]
        free = ~any_fp[r0:r1, c0:c1] & (inside | ~hard[r0:r1, c0:c1])
        # foot: the ground 1.6-2.6 m outside, nearest such cell, lightly smoothed along the wall
        src = (d > WALL_FOOT_FLAT_M) & (d <= WALL_FOOT_FLAT_M + 1.0) & free
        if not src.any():
            continue
        _, idx = ndimage.distance_transform_edt(~src, return_indices=True)
        foot = ndimage.gaussian_filter(hw[tuple(idx)], 1.0)
        walled = foot < lvl - 0.6  # the site builder draws a wall only where the outside drops > 0.6 m (access.ts)
        ramp = free & walled & (np.abs(d) <= WALL_FOOT_RAMP_M)
        flat = free & walled & (d > WALL_FOOT_RAMP_M) & (d <= WALL_FOOT_FLAT_M)
        u = (d + WALL_FOOT_RAMP_M) / (2 * WALL_FOOT_RAMP_M)
        new = hw.copy()
        new[ramp] = (lvl - (lvl - foot[ramp]) * u[ramp]).astype(np.float32)
        new[flat] = foot[flat].astype(np.float32)
        h[r0:r1, c0:c1] = new
        applied.append(f"{f['id']} straight wall foot: ramp +-{WALL_FOOT_RAMP_M} m, flat to {WALL_FOOT_FLAT_M} m: {int(ramp.sum())} + {int(flat.sum())} cells")
    # footprints: nearest outside value, clamped below the lowest floor
    # (from the 2nd cell ring outside: the first ring is partly covered by the plinth and rasterisation slivers)
    _, idx_out = ndimage.distance_transform_edt(ndimage.binary_dilation(any_fp, iterations=1), return_distances=True, return_indices=True)
    outside_val = h[tuple(idx_out)]
    for b in solid:
        m = fp[b["id"]]
        if not m.any():
            continue
        st = b.get("storeys") or []
        floor0 = b["base_h"] + (st[0]["height"] if st and st[0].get("kind") == "plinth" else 0.0)
        h[m] = np.minimum(outside_val[m], np.float32(floor0 - 0.05))
    hard |= any_fp
    applied.append(f"building footprints from the nearest outside level, <= lowest floor - 0.05: {len(solid)} buildings")

    dz = h - h2025
    print(f"[terrain] 1789 changes: max fill {dz.max():.2f} m, max cut {dz.min():.2f} m, changed cells {(np.abs(dz) > 0.05).sum()}")

    # ---- ground classes on a 2 m grid ----------------------------------------------------------
    gcols, grows = int(round((EAST - WEST) / GROUND_CELL)), int(round((NORTH - SOUTH) / GROUND_CELL))
    gtr = from_origin(WEST, NORTH, GROUND_CELL, GROUND_CELL)
    gshape = (grows, gcols)
    feats_g = [f for f in feats if in_epoch(f)]
    blds_g = [b for b in blds if in_epoch(b)]

    def put(g, geoms, cls):
        mm = mask_of(geoms, gshape, gtr)
        g[mm] = cls

    def paint_features(g, fs, bs):
        """Residence features over the land cover: ways, courts / terraces / parterres, water, buildings."""
        for f in fs:
            gt = f["geometry"]["type"]
            surf = (f.get("surface") or "").lower()
            if f["kind"] == "avenue" and gt == "LineString":
                put(g, buffer_polyline(f["geometry"]["coordinates"], (f.get("width") or 8) / 2), 2)
            elif f["kind"] in ("path", "walk") and gt == "LineString":
                # wave-8 review fix: a trodden earth footpath (KB-W8 Felsenpfad) is no hard surface; it is drawn only as
                # the soft earth ribbon of site/features.ts, so it never feeds the viewer's tree planners (a new
                # hypothetical walk must not move existing trees, wave-5 rule)
                if "trodden earth" in surf:
                    continue
                # wave-9 review fix: the forecourt strip KB-V1 and the graded drive KB-V2 are the same kind of new
                # hypothetical way: drawn as gravel ribbons (site/features.ts walkMesh) on their graded terrain, not
                # painted, so the ground classes the viewer's seeded planners read (hinterland hedgerows along LC-20)
                # stay exactly as before and no existing tree moves
                if is_drive(f) or is_forecourt(f):
                    continue
                put(g, buffer_polyline(f["geometry"]["coordinates"], (f.get("width") or 4) / 2), 12 if "fine sand" in surf else 2)
        for f in fs:
            if f["kind"] == "lawn" and f["geometry"]["type"] == "Polygon":
                put(g, [poly(f["geometry"]["coordinates"][0])], 1)
        for kind in ("terrace", "parterre", "rondell", "court"):
            for f in fs:
                if f["kind"] != kind or f["geometry"]["type"] != "Polygon":
                    continue
                surf = (f.get("surface") or "").lower()
                if "cobble" in surf:
                    c = 3
                elif "sand" in surf and "riding" in surf:
                    c = 4
                elif "fine sand" in surf or "parterre sand" in surf:
                    c = 12
                elif "meadow" in surf:
                    c = 0
                elif "grass" in surf or kind == "parterre":
                    c = 1
                else:
                    c = 2
                put(g, [poly(f["geometry"]["coordinates"][0])], c)
        for f in fs:
            gm = f["geometry"]
            if f["kind"] in ("pond", "moat", "basin") and gm["type"] == "Polygon":
                put(g, [poly(gm["coordinates"][0])], 5)
            elif f["kind"] == "basin" and gm["type"] == "Point" and f.get("radius"):
                (x, y), r = gm["coordinates"], float(f["radius"])
                put(g, [poly([[x + r * np.cos(a), y + r * np.sin(a)] for a in np.linspace(0, 2 * np.pi, 33)])], 5)
        for f in fs:
            if f["kind"] == "island" and f["geometry"]["type"] == "Polygon":
                put(g, [poly(f["geometry"]["coordinates"][0])], 1)
        put(g, [poly(b["footprint"]) for b in bs if b.get("footprint") and b["cls"] not in ("GARD", "WALL") and not on_meadow(b)], 7)

    # 2025: today's canopy > 8 m more than 40 m from any residence feature (the old proxy, kept for the 2025 terrain)
    g25 = np.zeros(gshape, dtype=np.uint8)
    chm, _ = read_crop(CHM_KB, CHM_OV, bounds)
    chm = np.nan_to_num(chm, nan=0.0)
    chm2 = chm[: grows * 2, : gcols * 2].reshape(grows, 2, gcols, 2).mean(axis=(1, 3))
    residence = []
    for b in blds:
        if b.get("footprint"):
            residence.append(poly(b["footprint"]))
        elif b.get("line"):
            residence.append(poly(buffer_line(b["line"], 2)))
    for f in feats:
        gt = f["geometry"]["type"]
        if gt == "Polygon":
            residence.append(poly(f["geometry"]["coordinates"][0]))
        elif gt == "LineString":
            residence += buffer_polyline(f["geometry"]["coordinates"], max(6.0, (f.get("width") or 8) / 2 + 4))
    res = mask_of(residence, gshape, gtr)
    near = ndimage.distance_transform_edt(~res) * GROUND_CELL < 40.0
    g25[(chm2 > 8.0) & ~near] = 6
    paint_features(g25, feats, blds)

    # 1789: land cover polygons (KB-I09), irregular forest edge, clearings, then the features
    h2 = h[: grows * 2, : gcols * 2].reshape(grows, 2, gcols, 2).mean(axis=(1, 3))
    gy, gx = np.gradient(ndimage.gaussian_filter(h2, 2.0), GROUND_CELL)
    slope = np.hypot(gx, gy)
    g, lc_report = paint_1789(cat, gshape, gtr, slope, blds_g, feats_g, paint_features, ())
    # KB-I96: the planners' base (see PLANNER_BASE_SKIP) as runs of the cells where it differs
    gb, _ = paint_1789(cat, gshape, gtr, slope, blds_g, feats_g, paint_features, PLANNER_BASE_SKIP)
    planner_base = []
    for r in np.nonzero((gb != g).any(axis=1))[0]:
        diff = gb[r] != g[r]
        c = 0
        while c < gcols:
            if not diff[c]:
                c += 1
                continue
            c0, k = c, int(gb[r, c])
            while c < gcols and diff[c] and gb[r, c] == k:
                c += 1
            planner_base.append([int(r), int(c0), int(c - c0), k])
    lc_report.append(f"planner base without {', '.join(PLANNER_BASE_SKIP)}: {int((gb != g).sum())} cells in {len(planner_base)} runs")
    print("[terrain] 1789 land cover: " + "; ".join(lc_report))

    # ---- 1789 open-land relief (wave-2 review) -------------------------------------------------
    h, open_rep = open_land_relief(h, g, hard, any_fp, feats, shape, tr)
    applied.append(open_rep)
    print(f"[terrain] {open_rep}")

    # ---- natural pond shores (wave 9; see SHORE_*) -----------------------------------------------
    h, shore_rep = natural_shores(h, [f for f in feats if in_epoch(f)], hard, any_fp, shape, tr)
    applied += shore_rep
    for line in shore_rep:
        print(f"[terrain] {line}")

    # ---- write ---------------------------------------------------------------------------------
    OUT.mkdir(parents=True, exist_ok=True)
    h2025.astype("<f4").tofile(OUT / "dtm2025.f32")
    h.astype("<f4").tofile(OUT / "dtm1789.f32")
    g.tofile(OUT / "ground.u8")
    g25.tofile(OUT / "ground2025.u8")
    counts = {CLASSES[k][0]: int((g == k).sum()) for k in CLASSES}
    counts2025 = {CLASSES[k][0]: int((g25 == k).sum()) for k in CLASSES}
    meta = {
        "version": 2,
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "crs": "EPSG:25832",
        "height_datum": "DHHN2016",
        "local_frame": {"E0": 381000, "N0": 5465000, "rule": "x = E - E0, y = h, z = -(N - N0)"},
        "grid": {
            "west": WEST,
            "north": NORTH,
            "east": EAST,
            "south": SOUTH,
            "cell": CELL,
            "cols": cols,
            "rows": rows,
            "order": "row-major, row 0 = north edge, col 0 = west edge",
            "pixel_is_area": True,
            "cell_centre": "E = west + (col + 0.5) * cell, N = north - (row + 0.5) * cell",
            "dtype": "float32 little-endian",
        },
        "files": {"dtm2025": "dtm2025.f32", "dtm1789": "dtm1789.f32", "ground": "ground.u8", "ground2025": "ground2025.u8"},
        "ground": {
            "cell": GROUND_CELL,
            "cols": gcols,
            "rows": grows,
            "dtype": "uint8",
            "classes": {str(k): {"name": v[0], "label_de": v[1]} for k, v in CLASSES.items()},
            "counts": counts,
            "counts2025": counts2025,
            "landcover": lc_report,
            "plannerBase": {
                "skip": list(PLANNER_BASE_SKIP),
                "runs": planner_base,
                "rule": "KB-I96: ground.u8 painted without the `skip` land-cover areas differs only in these runs [row, col0, length, class]; the viewer's seeded tree planners take their order from that base",
            },
            "tag": "1789 (ground.u8): catalogue landcover polygons (research/11 S1, scripts/catalogue-v2/landcover.ts; D PV 1791, D Petri plan, D LP06; extents I +-30 m) with a seeded irregular forest edge, then the terrain features; 2025 (ground2025.u8): today's canopy > 8 m more than 40 m from any residence feature",
        },
        "h_range": [float(np.nanmin(h)), float(np.nanmax(h))],
        "sources": {
            "dtm": "DGM1 LVGL-SL 2025 via the explorer pipeline (data/work/karlsberg/dtm.tif, filled from data/work/overall/dtm.tif)",
            "read_report": rep,
        },
        "rules_1789": applied,
        "attribution": "Gelände: GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0; 1789-Gelände = Hypothese (Generator-Regeln)",
    }
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False))
    print(f"[terrain] wrote {OUT} ({(OUT / 'dtm1789.f32').stat().st_size / 1e6:.1f} MB each) in {time.time() - t0:.1f} s; ground {counts}")


if __name__ == "__main__":
    sys.exit(main())
