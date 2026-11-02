"""F10: OSM ways (roads, tracks, paths, railways, waterways, barriers) → vectors/osm.geojson.

    uv run python osm.py karlsberg [--refresh]

One Overpass query per AOI (AOI + buffer, so the RLP side is covered too), cached as
`data/raw/osm/<aoi>.json` (+ `<aoi>.meta.json` with the query). The cache is reused as long as the
query is unchanged; `--refresh` forces a new download. Ways are projected to EPSG:25832, clipped to
the AOI bbox, densified to segments ≤ 2 m, rounded to 0.01 m and written per docs/data-contract.md
("Vectors"). Every vertex gets a baked z (bilinear from data/work/<aoi>/dtm.tif, `heights: "baked"`).
The manifest gets `vectors.osm` (shared section, merged) and the ODbL attribution.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import sys
import urllib.parse
from collections.abc import Callable, Iterable, Sequence
from pathlib import Path
from typing import Any

from common import APP_DATA, AOI, RAW_DIR, WORK_DIR, fmt_bytes, http_open, load_aoi, update_manifest
from heights import DtmSampler, bake_collection

OSM_RAW = RAW_DIR / "osm"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
# docs/data-contract.md ("Manifest + attribution"): the OSM entry of the manifest attribution string
ATTRIBUTION_OSM = "© OpenStreetMap-Mitwirkende, ODbL"
LABEL_DE = "Wege & Straßen (OSM)"
MAX_SEG_M = 2.0  # contract: no segment longer than 2 m
PRECISION = 2    # contract: coordinates rounded to 0.01 m

# --- classification ------------------------------------------------------------------------------

PATH_HIGHWAYS = {"path", "footway", "bridleway", "cycleway", "steps", "via_ferrata"}
# not physical ways (yet / any more) or not linear
SKIP_HIGHWAYS = {"proposed", "construction", "planned", "razed", "abandoned", "platform", "bus_stop",
                 "elevator", "corridor", "rest_area", "services", "emergency_bay", "traffic_island"}
RAIL_KINDS = {"rail", "light_rail", "narrow_gauge", "tram", "subway", "monorail", "funicular",
              "preserved", "miniature", "disused", "abandoned"}  # old railway beds are relict-relevant
WATER_KINDS = {"river", "stream", "brook", "canal", "ditch", "drain", "tidal_channel", "canoe_pass"}
# only barriers that are landscape features; fences/hedges/gates would be noise for relict search
BARRIER_KINDS = {"wall", "retaining_wall", "city_wall", "ditch"}

KIND_TAGS = ("highway", "railway", "waterway", "barrier")


def classify_kind(tags: dict[str, str]) -> str | None:
    """Contract kind ('road'|'track'|'path'|'rail'|'water'|'barrier') for an OSM way, or None to skip.

    Priority highway > railway > waterway > barrier. Areas (`area=yes`) are skipped."""
    if tags.get("area") == "yes":
        return None
    hw = tags.get("highway")
    if hw:
        if hw in SKIP_HIGHWAYS:
            return None
        if hw == "track":
            return "track"
        if hw in PATH_HIGHWAYS:
            return "path"
        return "road"
    if tags.get("railway") in RAIL_KINDS:
        return "rail"
    if tags.get("waterway") in WATER_KINDS:
        return "water"
    if tags.get("barrier") in BARRIER_KINDS:
        return "barrier"
    return None


def feature_props(osm_id: int, tags: dict[str, str], kind: str) -> dict[str, str]:
    """Contract properties `{kind, name?, highway?, tracktype?, osm_id}`."""
    props: dict[str, str] = {"kind": kind}
    for k in ("name", "highway", "tracktype"):
        v = tags.get(k)
        if isinstance(v, str) and v.strip():
            props[k] = v.strip()
    props["osm_id"] = f"way/{osm_id}"
    return props


# --- geometry (pure) -----------------------------------------------------------------------------

Pt = tuple[float, float]
BBox = tuple[float, float, float, float]  # E_min, N_min, E_max, N_max


def _clip_segment(p: Pt, q: Pt, bbox: BBox) -> tuple[float, float] | None:
    """Liang–Barsky: parameter range [t0, t1] of segment p→q inside bbox (inclusive), or None."""
    x0, y0, x1, y1 = bbox
    dx, dy = q[0] - p[0], q[1] - p[1]
    t0, t1 = 0.0, 1.0
    for pk, qk in ((-dx, p[0] - x0), (dx, x1 - p[0]), (-dy, p[1] - y0), (dy, y1 - p[1])):
        if pk == 0:
            if qk < 0:
                return None
            continue
        t = qk / pk
        if pk < 0:
            t0 = max(t0, t)
        else:
            t1 = min(t1, t)
        if t0 > t1:
            return None
    return t0, t1


def clip_polyline(pts: Sequence[Pt], bbox: BBox) -> list[list[Pt]]:
    """Clip a polyline to an axis-aligned bbox; returns the inside pieces (each ≥ 2 distinct points).

    Points on the boundary count as inside; segments that only touch a corner are dropped."""
    pieces: list[list[Pt]] = []
    cur: list[Pt] = []
    for p, q in zip(pts, pts[1:]):
        r = _clip_segment(p, q, bbox)
        if r is None or r[0] == r[1]:
            if len(cur) >= 2:
                pieces.append(cur)
            cur = []
            continue
        t0, t1 = r
        a = p if t0 == 0.0 else (p[0] + t0 * (q[0] - p[0]), p[1] + t0 * (q[1] - p[1]))
        b = q if t1 == 1.0 else (p[0] + t1 * (q[0] - p[0]), p[1] + t1 * (q[1] - p[1]))
        if cur and t0 == 0.0:
            cur.append(b)
        else:
            if len(cur) >= 2:
                pieces.append(cur)
            cur = [a, b]
        if t1 < 1.0:  # leaves the box
            pieces.append(cur)
            cur = []
    if len(cur) >= 2:
        pieces.append(cur)
    return [pc for pc in pieces if len(pc) >= 2]


def densify(pts: Sequence[Pt], max_seg: float = MAX_SEG_M) -> list[Pt]:
    """Insert evenly spaced points so that no segment is longer than `max_seg`."""
    if not pts:
        return []
    out: list[Pt] = [pts[0]]
    for p, q in zip(pts, pts[1:]):
        d = math.hypot(q[0] - p[0], q[1] - p[1])
        n = max(1, math.ceil(d / max_seg - 1e-9))
        for k in range(1, n):
            t = k / n
            out.append((p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])))
        out.append(q)
    return out


def round_coords(pts: Iterable[Pt], ndigits: int = PRECISION) -> list[list[float]]:
    """Round to `ndigits` and drop consecutive duplicates (after rounding)."""
    out: list[list[float]] = []
    for e, n in pts:
        c = [round(e, ndigits), round(n, ndigits)]
        if not out or c != out[-1]:
            out.append(c)
    return out


def max_segment(coords: Sequence[Sequence[float]]) -> float:
    return max((math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(coords, coords[1:])), default=0.0)


# Densify slightly below 2 m so that 0.01 m rounding can never push a segment above the contract limit
# (worst case +0.01·√2 ≈ 0.0142 m).
_DENSIFY_STEP = MAX_SEG_M - 0.02


def way_to_feature(way: dict[str, Any], project: Callable[[Sequence[float], Sequence[float]], tuple],
                   bbox: BBox) -> dict[str, Any] | None:
    """Overpass `out geom` way → contract GeoJSON feature (EPSG:25832), or None if skipped/outside."""
    tags = way.get("tags") or {}
    if not isinstance(tags, dict):
        return None
    kind = classify_kind(tags)
    geom = way.get("geometry")
    if kind is None or not isinstance(geom, list) or len(geom) < 2 or not isinstance(way.get("id"), int):
        return None
    try:
        lons = [float(g["lon"]) for g in geom]
        lats = [float(g["lat"]) for g in geom]
    except (KeyError, TypeError, ValueError):
        return None  # Overpass emits null for nodes missing from the extract; skip such ways
    es, ns = project(lons, lats)
    pts = [(float(e), float(n)) for e, n in zip(es, ns)]
    if not all(math.isfinite(c) for p in pts for c in p):
        return None
    lines = []
    for piece in clip_polyline(pts, bbox):
        coords = round_coords(densify(piece, _DENSIFY_STEP))
        if len(coords) >= 2:
            lines.append(coords)
    if not lines:
        return None
    geometry = ({"type": "LineString", "coordinates": lines[0]} if len(lines) == 1
                else {"type": "MultiLineString", "coordinates": lines})
    return {"type": "Feature", "properties": feature_props(way["id"], tags, kind), "geometry": geometry}


def build_collection(overpass: dict[str, Any], project, bbox: BBox) -> dict[str, Any]:
    feats = []
    for el in overpass.get("elements", []):
        if isinstance(el, dict) and el.get("type") == "way":
            f = way_to_feature(el, project, bbox)
            if f is not None:
                feats.append(f)
    feats.sort(key=lambda f: int(f["properties"]["osm_id"].split("/")[1]))  # deterministic output
    return {"type": "FeatureCollection", "features": feats}


# --- Overpass ------------------------------------------------------------------------------------

def overpass_query(south: float, west: float, north: float, east: float) -> str:
    b = f"{south:.6f},{west:.6f},{north:.6f},{east:.6f}"
    barrier = "|".join(sorted(BARRIER_KINDS))
    return (
        "[out:json][timeout:180];\n(\n"
        f'  way["highway"]({b});\n'
        f'  way["railway"]({b});\n'
        f'  way["waterway"]({b});\n'
        f'  way["barrier"~"^({barrier})$"]({b});\n'
        ");\nout tags geom;\n"
    )


def wgs84_bbox(aoi: AOI) -> tuple[float, float, float, float]:
    """(south, west, north, east) enclosing the buffered AOI (densified edges)."""
    from pyproj import Transformer
    tr = Transformer.from_crs("EPSG:25832", "EPSG:4326", always_xy=True)
    west, south, east, north = tr.transform_bounds(*aoi.buffered, densify_pts=21)
    return south, west, north, east


def fetch_overpass(aoi: AOI, refresh: bool = False) -> dict[str, Any]:
    OSM_RAW.mkdir(parents=True, exist_ok=True)
    raw, meta_path = OSM_RAW / f"{aoi.key}.json", OSM_RAW / f"{aoi.key}.meta.json"
    query = overpass_query(*wgs84_bbox(aoi))
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    if raw.exists() and not refresh:
        if meta.get("query") == query:
            print(f"  cached {raw.relative_to(RAW_DIR.parent.parent)} ({fmt_bytes(raw.stat().st_size)})")
            return json.loads(raw.read_text())
        print("  cached response was made with a different query – downloading again")
    print(f"  Overpass query ({OVERPASS_URL}) …")
    url = f"{OVERPASS_URL}?{urllib.parse.urlencode({'data': query})}"
    with http_open(url, timeout=240, retries=4) as resp:
        body = resp.read()
    data = json.loads(body)
    if not isinstance(data, dict) or not isinstance(data.get("elements"), list):
        sys.exit(f"unexpected Overpass response (first bytes: {body[:200]!r})")
    remark = data.get("remark")
    if remark and ("runtime error" in remark or "timed out" in remark):
        sys.exit(f"Overpass error: {remark}")  # do not cache partial results
    tmp = raw.with_suffix(".json.tmp")
    tmp.write_bytes(body)
    tmp.replace(raw)
    meta_path.write_text(json.dumps({
        "query": query, "endpoint": OVERPASS_URL,
        "fetched": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "osm_base": (data.get("osm3s") or {}).get("timestamp_osm_base"), "bytes": len(body),
    }, indent=2) + "\n")
    print(f"  saved {fmt_bytes(len(body))}, {len(data['elements'])} ways")
    return data


# --- main ----------------------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("aoi")
    ap.add_argument("--refresh", action="store_true", help="ignore the cached Overpass response")
    args = ap.parse_args(argv)
    aoi = load_aoi(args.aoi)
    aoi_dir = APP_DATA / aoi.key
    manifest_path = aoi_dir / "manifest.json"
    if not manifest_path.exists():
        sys.exit(f"{manifest_path} missing – run build first (osm only adds vectors to an existing manifest)")
    origin = json.loads(manifest_path.read_text()).get("origin", {})
    if (origin.get("E0"), origin.get("N0")) != (aoi.e0, aoi.n0):
        sys.exit(f"manifest origin {origin} does not match aois.toml bbox for {aoi.key}")

    data = fetch_overpass(aoi, refresh=args.refresh)
    from pyproj import Transformer
    tr = Transformer.from_crs("EPSG:4326", "EPSG:25832", always_xy=True)
    bbox: BBox = (aoi.e0, aoi.n0, aoi.e1, aoi.n1)
    fc = build_collection(data, tr.transform, bbox)
    sampler = DtmSampler.from_geotiff(WORK_DIR / aoi.key / "dtm.tif", aoi.e0, aoi.n1)
    fc = bake_collection(fc, sampler)

    out = aoi_dir / "vectors" / "osm.geojson"
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".geojson.tmp")
    tmp.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")) + "\n")
    tmp.replace(out)

    counts: dict[str, int] = {}
    nverts = 0
    for f in fc["features"]:
        counts[f["properties"]["kind"]] = counts.get(f["properties"]["kind"], 0) + 1
        g = f["geometry"]
        nverts += sum(len(l) for l in ([g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]))
    osm_base = ((data.get("osm3s") or {}).get("timestamp_osm_base") or "")[:10]
    source = f"OpenStreetMap (Overpass API{', Stand ' + osm_base if osm_base else ''})"
    update_manifest(aoi_dir, {"vectors": {"osm": {
        "path": "vectors/osm.geojson", "crs": "EPSG:25832", "featureCount": len(fc["features"]),
        "label_de": LABEL_DE, "source": source, "heights": "baked",
    }}}, merge=["vectors"], attribution=[ATTRIBUTION_OSM])
    print(f"  {len(fc['features'])} features ({', '.join(f'{k} {v}' for k, v in sorted(counts.items()))}), "
          f"{nverts} vertices → {out.relative_to(APP_DATA.parent.parent.parent)} ({fmt_bytes(out.stat().st_size)})")


if __name__ == "__main__":
    main()
