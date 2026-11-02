"""ALKIS Flurstücke (parcels) + Flurnummern for one AOI -> vectors/flurstuecke*.geojson (data contract F12).

Sources: "WFS SL ALKIS Vereinfacht" (Geoportal Saarland, registry/wfs/414, dl-de/by-2-0, no owner data),
feature types `Flurstueck` (MultiPolygon) and `FlurstueckPunkt` (MultiPoint label positions).

Service gotchas (research/04-cadastre-historic-maps.md):
- only EPSG:25832 returns features: BBOX *and* SRSNAME must be `urn:ogc:def:crs:EPSG::25832`
  (WGS84/3857 give an empty FeatureCollection, not an error); axis order of BBOX and output is E,N
- <= 10 000 features per request -> page with COUNT/STARTINDEX; RESULTTYPE=hits gives numberMatched
- errors come back as XML ExceptionReport with HTTP 200, so every page is validated before caching
- the first request on a cold service can take ~70 s

Raw pages are cached in data/raw/cadastre/<aoi>/ (never deleted); outputs are overwritten.
The Rheinland-Pfalz part of an AOI comes from "WFS RP ALKIS Vereinfacht" (Geoportal RLP registry/wfs/519,
dl-de/by-2-0, GML 3.2 only, no label points -> representative point). Shared edges along the Land border
come from two independent datasets and may appear twice where their vertices differ by > 1 cm.

Every line/label coordinate gets a baked z (bilinear from data/work/<aoi>/dtm.tif, `heights: "baked"`).
vectors/flurstuecke_polygons.geojson (POLISH) holds the whole parcel polygons (2D, original vertices, deduped by
FLSTKENNZ, `flaeche_m2` from FLAECHE) for the app's point-in-polygon parcel lookup.

Usage:  uv run python cadastre.py <aoi>
"""
from __future__ import annotations

import json
import math
import re
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET
from collections.abc import Callable, Iterable, Mapping
from datetime import date
from pathlib import Path
from typing import Any

import shapely
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Point, Polygon, box, shape

from common import APP_DATA, RAW_DIR, WORK_DIR, fmt_bytes, http_open, load_aoi, update_manifest
from heights import DtmSampler, bake_collection

WFS_URL = "https://geoportal.saarland.de/registry/wfs/414"
TYPE_PREFIX = "ALKIS_ALKIS_WFS_ohne_Eig:"
# Rheinland-Pfalz (PRD Q-6): "WFS RP ALKIS Vereinfacht" (Geoportal RLP registry/wfs/519, deegree, dl-de/by-2-0,
# CORS *). Same AdV "ALKIS vereinfacht" attributes (lower-case), GML 3.2 only, EPSG:25832 E,N, paging,
# no label-point feature type (labels fall back to the parcel's representative point).
RLP_WFS_URL = "https://www.geoportal.rlp.de/registry/wfs/519"
RLP_TYPE_PREFIX = "ave:"
CRS_URN = "urn:ogc:def:crs:EPSG::25832"
PAGE_SIZE = 10_000
MAX_SEGMENT_M = 2.0
# segmentize slightly below the contract limit so rounding to 0.01 m can never push a segment over 2 m
SEGMENTIZE_M = 1.98
GRID_M = 0.01
MIN_CLIP_AREA_M2 = 1.0  # parcels that only touch the AOI edge (bbox intersect) get no label

CADASTRE_RAW = RAW_DIR / "cadastre"
ATTRIBUTION_ALKIS_SL = "© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (ALKIS)"
ATTRIBUTION_ALKIS_RLP = "© GeoBasis-DE/LVermGeoRP (2026), dl-de/by-2-0, www.lvermgeo.rlp.de, Daten bearbeitet (ALKIS)"

Bbox = tuple[float, float, float, float]


# --- WFS requests (pure helpers) ------------------------------------------------------------------

def _num(v: float) -> str:
    """Plain decimal (never scientific notation like 5.465e+06, which f'{v:g}' produces for UTM northings)."""
    return str(int(v)) if float(v).is_integer() else repr(float(v))


def wfs_url(typename: str, bbox: Bbox, *, start: int = 0, count: int = PAGE_SIZE, hits: bool = False,
            base: str = WFS_URL, prefix: str = TYPE_PREFIX, output_format: str | None = "GEOJSON") -> str:
    """GetFeature URL (default: SL WFS 414). BBOX and SRSNAME both carry the EPSG:25832 URN (E,N axis order).
    `output_format=None` leaves the service default (GML 3.2 for the RLP deegree WFS)."""
    e0, n0, e1, n1 = bbox
    params = {
        "SERVICE": "WFS",
        "VERSION": "2.0.0",
        "REQUEST": "GetFeature",
        "TYPENAMES": prefix + typename,
        "BBOX": f"{_num(e0)},{_num(n0)},{_num(e1)},{_num(n1)},{CRS_URN}",
        "SRSNAME": CRS_URN,
    }
    if hits:
        params["RESULTTYPE"] = "hits"
    else:
        if output_format:
            params["OUTPUTFORMAT"] = output_format
        params.update({"COUNT": str(count), "STARTINDEX": str(start)})
    return base + "?" + urllib.parse.urlencode(params, safe=":,")


def rlp_wfs_url(typename: str, bbox: Bbox, **kw) -> str:
    return wfs_url(typename, bbox, base=RLP_WFS_URL, prefix=RLP_TYPE_PREFIX, output_format=None, **kw)


def parse_number_matched(body: bytes) -> int:
    """`numberMatched` of a WFS 2.0 RESULTTYPE=hits response (XML)."""
    m = re.search(rb'numberMatched="(\d+)"', body[:16384])
    if not m:
        raise ValueError(f"no numberMatched in WFS hits response: {body[:300]!r}")
    return int(m.group(1))


def parse_page(body: bytes) -> list[dict[str, Any]]:
    """Validate one GeoJSON GetFeature page and return its features (raises on ExceptionReports/garbage)."""
    try:
        doc = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise ValueError(f"WFS page is not JSON ({e}): {body[:300]!r}") from None
    if not isinstance(doc, dict) or doc.get("type") != "FeatureCollection" or not isinstance(doc.get("features"), list):
        raise ValueError(f"WFS page is not a GeoJSON FeatureCollection: {body[:300]!r}")
    crs = ((doc.get("crs") or {}).get("properties") or {}).get("name")
    if crs is not None and "25832" not in str(crs):
        raise ValueError(f"WFS page has unexpected CRS {crs!r} (expected EPSG:25832)")
    return doc["features"]


def fetch_type(
    typename: str,
    bbox: Bbox,
    cache_dir: Path,
    *,
    get: Callable[[str], bytes],
    page_size: int = PAGE_SIZE,
    url: Callable[..., str] = wfs_url,
    parse: Callable[[bytes], list[dict[str, Any]]] | None = None,
    suffix: str = ".geojson",
    cache_prefix: str = "",
) -> list[dict[str, Any]]:
    """All features of `typename` intersecting `bbox`, paged and cached (GeoJSON-like dicts).

    Pages are cached as `<cache_dir>/<cache_prefix><typename>_<bbox>/page_<start><suffix>` together with
    `hits.json` (numberMatched). A complete cache is reused without any request. `get(url) -> bytes` is
    injected so the paging logic is testable without network; `url`/`parse` select the service (default:
    SL WFS 414 GeoJSON). Raises if the paged total disagrees with numberMatched."""
    parse = parse or parse_page
    d = cache_subdir(cache_dir, cache_prefix + typename, bbox)
    d.mkdir(parents=True, exist_ok=True)
    hits_file = d / "hits.json"
    if hits_file.exists():
        matched = int(json.loads(hits_file.read_text())["numberMatched"])
    else:
        matched = parse_number_matched(get(url(typename, bbox, hits=True)))
        _write_atomic(hits_file, json.dumps({"numberMatched": matched, "fetched": date.today().isoformat()}).encode())
    features: list[dict[str, Any]] = []
    start = 0
    while start < matched or start == 0:
        page_file = d / f"page_{start}{suffix}"
        if page_file.exists():
            page = parse(page_file.read_bytes())
        else:
            body = get(url(typename, bbox, start=start, count=page_size))
            page = parse(body)
            _write_atomic(page_file, body)
        features.extend(page)
        if len(page) < page_size:
            break
        start += page_size
    if len(features) != matched:
        raise RuntimeError(f"{typename}: paged {len(features)} features but WFS reports numberMatched={matched}"
                           f" (stale cache? delete {d})")
    return features


GML = "{http://www.opengis.net/gml/3.2}"
WFS2 = "{http://www.opengis.net/wfs/2.0}"


def _ring_coords(ring: ET.Element) -> list[list[float]]:
    """Coordinates of a GML ring (LinearRing posList/pos, or Ring of curve segments) in document order."""
    vals: list[float] = []
    out: list[list[float]] = []
    for el in ring.iter():
        if el.tag in (GML + "posList", GML + "pos"):
            dim = int(el.get("srsDimension") or 2)
            vals = [float(v) for v in (el.text or "").split()]
            for i in range(0, len(vals) - dim + 1, dim):
                p = [vals[i], vals[i + 1]]
                if not out or out[-1] != p:
                    out.append(p)
        elif el.tag in (GML + "coordinates",):
            for tup in (el.text or "").split():
                x, y, *_ = (float(v) for v in tup.split(","))
                if not out or out[-1] != [x, y]:
                    out.append([x, y])
    return out


def _gml_polygons(geom_el: ET.Element) -> list[list[list[list[float]]]]:
    polys = []
    for poly in geom_el.iter():
        if poly.tag not in (GML + "Polygon", GML + "PolygonPatch"):
            continue
        rings = [_ring_coords(r) for r in poly if r.tag in (GML + "exterior", GML + "interior")]
        rings = [r for r in rings if len(r) >= 4]
        if rings:
            polys.append(rings)
    return polys


def parse_gml_page(body: bytes) -> list[dict[str, Any]]:
    """WFS 2.0 GML 3.2 FeatureCollection of AdV "ALKIS vereinfacht" Flurstueck features (RLP WFS 519) ->
    GeoJSON-like features with upper-case property names like the SL service (FLSTKENNZ, FLSTNRZAE, …).
    Raises on ExceptionReports. Arcs in curve rings are kept as their control points (polyline)."""
    try:
        root = ET.fromstring(body)
    except ET.ParseError as e:
        raise ValueError(f"WFS page is not XML ({e}): {body[:300]!r}") from None
    if root.tag != WFS2 + "FeatureCollection":
        raise ValueError(f"WFS page is not a wfs:FeatureCollection: {body[:300]!r}")
    for env in root.iter(GML + "Envelope"):
        srs = env.get("srsName") or ""
        if srs and "25832" not in srs:
            raise ValueError(f"WFS page has unexpected CRS {srs!r} (expected EPSG:25832)")
    feats = []
    for member in root.iter(WFS2 + "member"):
        for feat in member:
            props: dict[str, Any] = {}
            polys: list = []
            for child in feat:
                local = child.tag.rsplit("}", 1)[-1]
                if local == "geometrie":
                    polys = _gml_polygons(child)
                elif local != "boundedBy" and len(child) == 0:
                    props[local.upper()] = (child.text or "").strip()
            geom = {"type": "MultiPolygon", "coordinates": polys} if polys else None
            feats.append({"type": "Feature", "geometry": geom, "properties": props})
    return feats


def cache_subdir(cache_dir: Path, typename: str, bbox: Bbox) -> Path:
    return cache_dir / (typename + "_" + "_".join(_num(v) for v in bbox))


def _write_atomic(path: Path, data: bytes) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


def http_get(url: str) -> bytes:
    t0 = time.time()
    with http_open(url, timeout=180) as r:
        body = r.read()
    print(f"  GET {url[:140]}… {fmt_bytes(len(body))} in {time.time() - t0:.1f}s")
    return body


# --- attributes ------------------------------------------------------------------------------------

def clean(value: Any) -> str | None:
    """ALKIS attribute -> stripped string, or None for missing/'null' (the WFS writes a literal 'null')."""
    if value is None:
        return None
    s = str(value).strip()
    return None if s == "" or s.lower() == "null" else s


def label_text(zae: Any, nen: Any) -> str | None:
    """Flurnummer as displayed: 'ZAE' or 'ZAE/NEN'."""
    z, n = clean(zae), clean(nen)
    if z is None:
        return None
    return f"{z}/{n}" if n else z


def dedupe(features: Iterable[Mapping[str, Any]], keys: tuple[str, ...] = ("OID", "IDFLURST", "FLSTKENNZ")) -> list:
    """Drop duplicate features (same first available key), keeping the first occurrence."""
    seen: set[str] = set()
    out = []
    for f in features:
        p = f.get("properties") or {}
        k = next((f"{key}={p[key]}" for key in keys if clean(p.get(key))), None)
        if k is not None:
            if k in seen:
                continue
            seen.add(k)
        out.append(f)
    return out


# --- geometry -------------------------------------------------------------------------------------

def to_geom(feature: Mapping[str, Any]):
    geom = feature.get("geometry")
    if not geom:
        return None
    g = shape(geom)
    if g.is_empty:
        return None
    if not g.is_valid:
        g = shapely.make_valid(g)
    return g


def _round_line(coords: Iterable[Iterable[float]]) -> list[list[float]]:
    out: list[list[float]] = []
    for x, y, *_ in coords:
        p = [round(float(x), 2), round(float(y), 2)]
        if not out or out[-1] != p:
            out.append(p)
    return out


def _lines(g) -> list[LineString]:
    if g.is_empty:
        return []
    if isinstance(g, LineString):
        return [g]
    if isinstance(g, MultiLineString):
        return list(g.geoms)
    if hasattr(g, "geoms"):  # GeometryCollection from clipping (may contain points)
        return [p for sub in g.geoms for p in _lines(sub)]
    return []


def boundary_lines(polygons: Iterable, bbox: Bbox, *, max_segment: float = SEGMENTIZE_M) -> list[list[list[float]]]:
    """Deduplicated parcel boundaries as coordinate lists [[E, N], …].

    Boundaries of all (Multi)Polygons are unioned on a 1 cm grid (shared edges between neighbours appear once,
    lines are noded at junctions), merged into maximal lines, clipped to the AOI bbox (the AOI edge itself is
    not drawn), densified to <= `max_segment` and rounded to 0.01 m."""
    rings = [p.boundary for p in polygons if p is not None and not p.is_empty]
    if not rings:
        return []
    merged = shapely.line_merge(shapely.union_all(rings, grid_size=GRID_M))
    clipped = shapely.intersection(merged, box(*bbox))
    out = []
    for line in _lines(clipped):
        coords = _round_line(shapely.segmentize(line, max_segment).coords)
        if len(coords) >= 2:
            out.append(coords)
    return out


def label_point(parcel_geom, punkt_geom, bbox: Bbox) -> tuple[Point | None, str]:
    """Label position for one parcel: the ALKIS FlurstueckPunkt if it lies inside the parcel and the AOI,
    else a representative point of the parcel clipped to the AOI. Returns (point, how) with how in
    {'punkt', 'representative', 'none'}; 'none' when the parcel has < MIN_CLIP_AREA_M2 inside the AOI."""
    aoi = box(*bbox)
    clipped = parcel_geom.intersection(aoi) if parcel_geom is not None else None
    if clipped is None or clipped.is_empty or clipped.area < MIN_CLIP_AREA_M2:
        return None, "none"
    if punkt_geom is not None and not punkt_geom.is_empty:
        pts = list(punkt_geom.geoms) if hasattr(punkt_geom, "geoms") else [punkt_geom]
        for p in pts:
            if clipped.covers(p):
                return p, "punkt"
    return clipped.representative_point(), "representative"


# --- assembly -------------------------------------------------------------------------------------

def build_outputs(
    parcels: list[Mapping[str, Any]], punkte: list[Mapping[str, Any]], bbox: Bbox
) -> tuple[dict[str, Any], dict[str, Any], dict[str, int]]:
    """(lines FeatureCollection, labels FeatureCollection, stats) from raw WFS features."""
    parcels = dedupe(parcels)
    punkte = dedupe(punkte)
    punkt_by_kennz: dict[str, Any] = {}
    for f in punkte:
        k = clean((f.get("properties") or {}).get("FLSTKENNZ"))
        if k and k not in punkt_by_kennz:
            punkt_by_kennz[k] = to_geom(f)

    geoms = [to_geom(f) for f in parcels]
    lines = boundary_lines(geoms, bbox)
    line_fc = {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {"kind": "parcel"}, "geometry": {"type": "LineString", "coordinates": c}}
            for c in lines
        ],
    }

    stats = {"parcels": len(parcels), "punkte": len(punkte), "lines": len(lines),
             "vertices": sum(len(c) for c in lines), "label_punkt": 0, "label_representative": 0,
             "label_skipped": 0, "label_no_number": 0}
    labels = []
    for f, g in zip(parcels, geoms):
        p = f.get("properties") or {}
        text = label_text(p.get("FLSTNRZAE"), p.get("FLSTNRNEN"))
        if text is None:
            stats["label_no_number"] += 1
            continue
        kennz = clean(p.get("FLSTKENNZ")) or ""
        pt, how = label_point(g, punkt_by_kennz.get(kennz), bbox)
        if pt is None:
            stats["label_skipped"] += 1
            continue
        stats[f"label_{how}"] += 1
        props = {"text": text, "flstkennz": kennz, "gemarkung": clean(p.get("GEMARKUNG")) or "",
                 "flur": clean(p.get("FLUR")) or ""}
        lage = clean(p.get("LAGEBEZTXT"))
        if lage:
            props["lage"] = lage
        labels.append({"type": "Feature", "properties": props,
                       "geometry": {"type": "Point", "coordinates": [round(pt.x, 2), round(pt.y, 2)]}})
    stats["labels"] = len(labels)
    return line_fc, {"type": "FeatureCollection", "features": labels}, stats


def parse_area(value: Any) -> float | None:
    """ALKIS `FLAECHE` (amtliche Fläche, m²) -> number, or None if missing/unparseable/non-positive."""
    s = clean(value)
    if s is None:
        return None
    try:
        v = float(s.replace(",", "."))
    except ValueError:
        return None
    if not math.isfinite(v) or v <= 0:
        return None
    return int(v) if v.is_integer() else round(v, 2)


def _round_ring(coords: Iterable[Iterable[float]]) -> list[list[float]] | None:
    ring = _round_line(coords)
    if len(ring) >= 2 and ring[0] != ring[-1]:
        ring.append(list(ring[0]))
    return ring if len(ring) >= 4 else None


def polygon_geometry(g) -> dict[str, Any] | None:
    """Shapely (Multi)Polygon / GeometryCollection -> GeoJSON Polygon or MultiPolygon, [E, N] rounded to 0.01 m,
    original vertices (no densify, no z). Non-polygonal parts are dropped; None if nothing is left."""
    if g is None or g.is_empty:
        return None
    if isinstance(g, Polygon):
        parts = [g]
    elif isinstance(g, MultiPolygon):
        parts = list(g.geoms)
    elif hasattr(g, "geoms"):
        parts = [p for sub in g.geoms if isinstance(sub, (Polygon, MultiPolygon))
                 for p in (sub.geoms if isinstance(sub, MultiPolygon) else [sub])]
    else:
        return None
    polys = []
    for poly in parts:
        outer = _round_ring(poly.exterior.coords)
        if outer is None:
            continue
        holes = [r for r in (_round_ring(i.coords) for i in poly.interiors) if r is not None]
        polys.append([outer, *holes])
    if not polys:
        return None
    if len(polys) == 1:
        return {"type": "Polygon", "coordinates": polys[0]}
    return {"type": "MultiPolygon", "coordinates": polys}


def build_polygons(parcels: list[Mapping[str, Any]], bbox: Bbox) -> tuple[dict[str, Any], dict[str, int]]:
    """Parcel polygons for point-in-polygon lookup (contract "vectors.flurstuecke.polygons"): one feature per
    FLSTKENNZ (first occurrence wins), every parcel whose geometry intersects the AOI bbox, whole (not
    clipped), 2D, properties matching the label point plus zae/nen and flaeche_m2 (ALKIS FLAECHE)."""
    aoi = box(*bbox)
    seen: set[str] = set()
    feats = []
    stats = {"polygons": 0, "poly_dup": 0, "poly_outside": 0, "poly_no_number": 0, "poly_no_geom": 0, "poly_area": 0}
    for f in dedupe(parcels):
        p = f.get("properties") or {}
        kennz = clean(p.get("FLSTKENNZ"))
        zae, nen = clean(p.get("FLSTNRZAE")), clean(p.get("FLSTNRNEN"))
        text = label_text(zae, nen)
        if kennz is None or text is None:
            stats["poly_no_number"] += 1
            continue
        if kennz in seen:
            stats["poly_dup"] += 1
            continue
        g = to_geom(f)
        if g is None:
            stats["poly_no_geom"] += 1
            continue
        if not g.intersects(aoi):
            stats["poly_outside"] += 1
            continue
        geom = polygon_geometry(g)
        if geom is None:
            stats["poly_no_geom"] += 1
            continue
        seen.add(kennz)
        props: dict[str, Any] = {"flstkennz": kennz, "gemarkung": clean(p.get("GEMARKUNG")) or "",
                                 "flur": clean(p.get("FLUR")) or "", "zae": zae}
        if nen:
            props["nen"] = nen
        props["text"] = text
        lage = clean(p.get("LAGEBEZTXT"))
        if lage:
            props["lage"] = lage
        area = parse_area(p.get("FLAECHE"))
        if area is not None:
            props["flaeche_m2"] = area
            stats["poly_area"] += 1
        feats.append({"type": "Feature", "properties": props, "geometry": geom})
    stats["polygons"] = len(feats)
    return {"type": "FeatureCollection", "features": feats}, stats


def write_geojson(path: Path, fc: Mapping[str, Any]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(fc, ensure_ascii=False, separators=(",", ":")).encode()
    _write_atomic(path, data)
    return len(data)


def main(aoi_key: str) -> None:
    aoi = load_aoi(aoi_key)
    aoi_dir = APP_DATA / aoi.key
    if not (aoi_dir / "manifest.json").exists():
        sys.exit(f"{aoi_dir}/manifest.json missing - run the build step first")
    bbox: Bbox = (aoi.e0, aoi.n0, aoi.e1, aoi.n1)
    cache = CADASTRE_RAW / aoi.key
    print(f"cadastre {aoi.key}: SL WFS 414 + RLP WFS 519, bbox {bbox} (cache {cache})")
    sl_parcels = fetch_type("Flurstueck", bbox, cache, get=http_get)
    punkte = fetch_type("FlurstueckPunkt", bbox, cache, get=http_get)
    rlp_parcels = fetch_type("Flurstueck", bbox, cache, get=http_get, url=rlp_wfs_url, parse=parse_gml_page,
                             suffix=".gml", cache_prefix="rlp_")
    print(f"  SL: {len(sl_parcels)} parcels, {len(punkte)} label points; RLP: {len(rlp_parcels)} parcels")

    line_fc, label_fc, stats = build_outputs(sl_parcels + rlp_parcels, punkte, bbox)
    # contract "Baked heights": z bilinear from the filled 1 m DTM for lines *and* label points
    sampler = DtmSampler.from_geotiff(WORK_DIR / aoi.key / "dtm.tif", aoi.e0, aoi.n1)
    line_fc, label_fc = bake_collection(line_fc, sampler), bake_collection(label_fc, sampler)
    n_lines = write_geojson(aoi_dir / "vectors" / "flurstuecke.geojson", line_fc)
    n_labels = write_geojson(aoi_dir / "vectors" / "flurstuecke_labels.geojson", label_fc)
    # polygons for point-in-polygon lookup: 2D, never baked (contract), not clipped
    poly_fc, poly_stats = build_polygons(sl_parcels + rlp_parcels, bbox)
    n_polys = write_geojson(aoi_dir / "vectors" / "flurstuecke_polygons.geojson", poly_fc)
    stats.update(poly_stats)
    fetched = json.loads((cache_subdir(cache, "Flurstueck", bbox) / "hits.json").read_text()).get("fetched", "")
    source = f"ALKIS Saarland, WFS SL ALKIS Vereinfacht (abgerufen {fetched})"
    rlp_attr = [ATTRIBUTION_ALKIS_RLP] if rlp_parcels else []
    if rlp_parcels:
        rlp_fetched = json.loads((cache_subdir(cache, "rlp_Flurstueck", bbox) / "hits.json").read_text())["fetched"]
        source += f"; ALKIS Rheinland-Pfalz, WFS RP ALKIS Vereinfacht (abgerufen {rlp_fetched})"
    update_manifest(
        aoi_dir,
        {"vectors": {"flurstuecke": {
            "path": "vectors/flurstuecke.geojson",
            "labels": "vectors/flurstuecke_labels.geojson",
            "polygons": "vectors/flurstuecke_polygons.geojson",
            "crs": "EPSG:25832",
            "featureCount": stats["lines"],
            "label_de": "Flurstücke",
            "source": source,
            "heights": "baked",
        }}},
        merge=["vectors"],
        attribution=[ATTRIBUTION_ALKIS_SL, *rlp_attr],
        drop_attribution=[] if rlp_parcels else [ATTRIBUTION_ALKIS_RLP],
    )
    print("  " + ", ".join(f"{k}={v}" for k, v in stats.items()))
    print(f"  flurstuecke.geojson {fmt_bytes(n_lines)}, flurstuecke_labels.geojson {fmt_bytes(n_labels)}, "
          f"flurstuecke_polygons.geojson {fmt_bytes(n_polys)}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "karlsberg")
