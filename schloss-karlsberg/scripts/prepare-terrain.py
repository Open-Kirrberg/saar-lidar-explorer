"""Terrain for the Schloss Karlsberg viewer: crop the explorer's 1 m DTM and derive a "1789" terrain.

Inputs (read-only, untrusted data; this script only READS rasters):
  ../data/work/karlsberg/dtm.tif  DGM1 LVGL-SL 2025 (dl-de/by-2-0), E 381000-384000, N 5465000-5468000
  ../data/work/overall/dtm.tif    same source, larger AOI; used only for cells outside the karlsberg
                                  raster (the Karlslust lies south of N 5465000)
  ../data/work/{karlsberg,overall}/chm.tif  canopy height (today) -> forest proxy for the ground mask
  model/catalogue.json            building footprints / base_h, terrain features (levels, ponds)

Outputs (git-ignored) in viewer/public/terrain/:
  dtm2025.f32   float32 LE, rows north -> south, cols west -> east, 1 m cells (PixelIsArea)
  dtm1789.f32   same grid, "1789 terrain" (see below)
  ground.u8     uint8 ground classes on a 2 m grid (same origin), see CLASSES
  meta.json     grid origin, cell size, cell-centre convention, files, class legend, attribution

"1789 terrain" [I, generator rule, not a survey]:
  - courts, terraces and rondells with a catalogue level are set to that level inside their polygon
    (hard edge: the step is covered by the retaining walls the site builder draws)
  - parterres and walled gardens: DTM smoothed (gaussian sigma 3 m) to remove later pits / spoil
  - ponds: basin floor at least 0.5 m below the water level
  - parterres with a catalogue level (TF-09, TF-15) are levelled like terraces; the cut / fill is taken up by a
    talus blended over 8 m outside the polygon (fix round 1: TF-09 at 345.9 below the CdL EG floor)
  - building aprons (fix round 1): a 3 m apron around every footprint is flattened to the adjacent terrace /
    court level (a levelled feature within 2.5 m) or else to base_h, then blended back over 3 m; this removes
    the ruin hummocks at the wall feet (Orangerie W front)
  - building footprints: inside, the terrain takes the value of the nearest cell outside the building (so the
    step between a low court and higher ground lies under the building, hidden by its walls, instead of
    cutting the plinth in a saw-tooth), clamped to <= the lowest floor - 0.05 m (Galerie over the Küchenhof)

Run (explorer pipeline env, isolated mode):
  cd pipeline && uv run python -I ../schloss-karlsberg/scripts/prepare-terrain.py
"""

import json
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
REPO = SK.parent
DTM_KB = REPO / "data" / "work" / "karlsberg" / "dtm.tif"
DTM_OV = REPO / "data" / "work" / "overall" / "dtm.tif"
CHM_KB = REPO / "data" / "work" / "karlsberg" / "chm.tif"
CHM_OV = REPO / "data" / "work" / "overall" / "chm.tif"
CATALOGUE = SK / "model" / "catalogue.json"
OUT = SK / "viewer" / "public" / "terrain"

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
    6: ("forest", "Wald (heutiger Bestand als Annahme)"),
    7: ("building", "Gebäudegrund"),
}


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


def smoothstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


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
    soft_geoms += [poly(b["footprint"]) for b in blds if b["cls"] == "GARD" and b["footprint"] and (b["roof"] or {}).get("type") in (None, "none")]
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

    # 4. buildings: apron at the adjacent level, then the footprint from its surroundings (see docstring)
    solid = [b for b in blds if b["cls"] != "WALL" and b.get("footprint") and not (b["cls"] == "GARD" and (b["roof"] or {}).get("type") in (None, "none"))]
    fp = {b["id"]: mask_of([poly(b["footprint"])], shape, tr) for b in solid}
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
        tgt[near_lvl] = lvl_at[near_lvl]
        h[apron] = tgt[apron]
        n_apron += int(apron.sum())
        # blend back to the natural ground between 3 and 6 m
        ring = (d > 3.0) & (d <= 6.0) & ~hard & ~any_fp
        w = smoothstep(1.0 - (d - 3.0) / 3.0)
        h[ring] = (h[ring] * (1 - w[ring]) + np.float32(b["base_h"]) * w[ring]).astype(np.float32)
    applied.append(f"building aprons (3 m flat at the adjacent level or base_h + 3 m blend): {n_apron} cells")
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
    g = np.zeros(gshape, dtype=np.uint8)
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
    g[(chm2 > 8.0) & ~near] = 6

    def put(geoms, cls):
        mm = mask_of(geoms, gshape, gtr)
        g[mm] = cls

    for f in feats:
        gt = f["geometry"]["type"]
        surf = (f.get("surface") or "").lower()
        if f["kind"] == "avenue" and gt == "LineString":
            put(buffer_polyline(f["geometry"]["coordinates"], (f.get("width") or 8) / 2), 2)
        elif f["kind"] == "path" and gt == "LineString":
            put(buffer_polyline(f["geometry"]["coordinates"], (f.get("width") or 4) / 2), 2)
    for kind in ("terrace", "parterre", "rondell", "court"):
        for f in feats:
            if f["kind"] != kind or f["geometry"]["type"] != "Polygon":
                continue
            surf = (f.get("surface") or "").lower()
            if "cobble" in surf:
                c = 3
            elif "sand" in surf and "riding" in surf:
                c = 4
            elif "grass" in surf or kind == "parterre":
                c = 1
            else:
                c = 2
            put([poly(f["geometry"]["coordinates"][0])], c)
    for f in feats:
        if f["kind"] in ("pond", "moat") and f["geometry"]["type"] == "Polygon":
            put([poly(f["geometry"]["coordinates"][0])], 5)
    for f in feats:
        if f["kind"] == "island" and f["geometry"]["type"] == "Polygon":
            put([poly(f["geometry"]["coordinates"][0])], 1)
    put([poly(b["footprint"]) for b in blds if b.get("footprint") and b["cls"] not in ("GARD", "WALL")], 7)

    # ---- write ---------------------------------------------------------------------------------
    OUT.mkdir(parents=True, exist_ok=True)
    h2025.astype("<f4").tofile(OUT / "dtm2025.f32")
    h.astype("<f4").tofile(OUT / "dtm1789.f32")
    g.tofile(OUT / "ground.u8")
    counts = {CLASSES[k][0]: int((g == k).sum()) for k in CLASSES}
    meta = {
        "version": 1,
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
        "files": {"dtm2025": "dtm2025.f32", "dtm1789": "dtm1789.f32", "ground": "ground.u8"},
        "ground": {
            "cell": GROUND_CELL,
            "cols": gcols,
            "rows": grows,
            "dtype": "uint8",
            "classes": {str(k): {"name": v[0], "label_de": v[1]} for k, v in CLASSES.items()},
            "counts": counts,
            "tag": "I: classes from catalogue features; forest = today's canopy > 8 m more than 40 m from any residence feature (proxy, U for 1789)",
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
