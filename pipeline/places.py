"""Orte im Vergleich, Phase 0: place outlines (Gemarkungen), their parcels, land use and the stats area.

Plan: docs/plans/orte-im-vergleich.md (§5 places and unit, §6 stats file, §8 Phase 0). The unit is the
Gemarkung (Q4); the nine places are fixed in `PLACES` (Q1). For every place this step

1. lists the Gemarkungen of its municipality from the ALKIS WFS (name, key, parcel count; only the
   `GEMARKUNG`/`GEMASCHL` properties are requested) so the place → Gemarkung key mapping is checked
   against the service and the town's other Gemarkungen can be reported as *excluded*;
2. fetches all parcels (Flurstücke) of the place's Gemarkung(en) with a property filter on the Gemarkung key
   (paged with COUNT/STARTINDEX, every page cached under data/raw/alkis-orte/);
3. dissolves them into one outline per place (make_valid, union on a 1 cm grid, sliver holes < 10 m² dropped).

Sources: SL "WFS SL ALKIS Vereinfacht" (Geoportal Saarland registry/wfs/414, GeoJSON) and RLP "WFS RP ALKIS
Vereinfacht" (Geoportal RLP registry/wfs/519, GML 3.2), both dl-de/by-2-0 and without owner data (G3).
If WFS 414 is down (HTTP 5xx after retries; it was on 2026-11-07), SL falls back to the INSPIRE
CadastralParcels WFS (same ALKIS data and licence; EPSG:4258 reprojected, ≈ 5 cm vertex rounding, no land use,
no municipality key) and cross-checks each dissolved outline against the official INSPIRE Gemarkung zoning.
`--sl-source wfs414` forces 414. Land use: both ALKIS-vereinfacht services carry the actual land use per parcel
in `TNTXT` ("Klasse;m²|Klasse;m²…"); RLP additionally offers the land-use polygons `ave:Nutzung` (fetched for
the RLP places' boxes).

Outputs (data/work/orte/, work files, never published as is; G1/G2: only per-place aggregates leave here):
- gemarkungen.geojson   one outline per place + `meta` (stats bbox, tiles, excluded Gemarkungen, attribution)
- flurstuecke.geojson.gz  parcels of the nine places (flstkennz, gemarkung, gemaschl, place, flaeche_m2, nutzung)
- nutzung.geojson       RLP ALKIS land-use polygons clipped to the RLP places (nutzart, bez, place, area_m2)
and the `[orte]` stats bbox in aois.toml (outlines + 200 m, snapped outward to 1 km).

Usage:  uv run python places.py [--no-nutzung] [--no-toml]
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import re
import sys
import unicodedata
import urllib.parse
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import shapely
from shapely.geometry import MultiPolygon, Polygon, box, shape

from cadastre import (ATTRIBUTION_ALKIS_RLP, ATTRIBUTION_ALKIS_SL, CRS_URN, PAGE_SIZE, RLP_TYPE_PREFIX, RLP_WFS_URL,
                      TYPE_PREFIX, WFS_URL, _write_atomic, clean, fetch_type, http_get, parse_area, parse_gml_page,
                      parse_number_matched, parse_page, polygon_geometry, rlp_wfs_url)
from common import PIPELINE_DIR, RAW_DIR, WORK_DIR, fmt_bytes

ORTE_RAW = RAW_DIR / "alkis-orte"
ORTE_WORK = WORK_DIR / "orte"
AOIS_TOML = PIPELINE_DIR / "aois.toml"
AOI_KEY = "orte"

STATS_MARGIN_M = 200   # outlines + 200 m (CHM neighbourhood ops need a ring, like an AOI buffer)
SNAP_M = 1000          # stats bbox snapped outward to the 1 km LiDAR tile grid
GRID_M = 0.01          # union grid for the dissolve (ALKIS coordinates are cm)
MIN_HOLE_M2 = 10.0     # holes smaller than this are slivers between neighbouring parcels, not enclaves
MIN_PART_M2 = 1.0

LIDAR_EPOCH = {"SL": 2025, "RLP": 2022}
ATTRIBUTION = {"SL": ATTRIBUTION_ALKIS_SL, "RLP": ATTRIBUTION_ALKIS_RLP}

Bbox = tuple[float, float, float, float]


# --- places (Q1, Q4) -------------------------------------------------------------------------------

@dataclass(frozen=True)
class Place:
    name_de: str
    state: str                       # 'SL' | 'RLP'
    municipality: str
    municipality_key: str            # Amtlicher Gemeindeschlüssel (ALKIS GMDSCHL)
    gemarkungen: tuple[str, ...]     # Gemarkung names; resolved to keys via the WFS
    county: str = ""
    note: str = ""

    @property
    def id(self) -> str:
        return slug(self.name_de)

    @property
    def flags(self) -> list[str]:
        # Q5: RLP LiDAR is the 2022 flight (SL 2025, leaf-off), possibly another season
        return ["other-flight"] if self.state == "RLP" else []


HOMBURG = ("Homburg", "10045114")
PLACES: tuple[Place, ...] = (
    Place("Kirrberg", "SL", *HOMBURG, ("Kirrberg",), "Saarpfalz-Kreis"),
    Place("Homburg", "SL", *HOMBURG, ("Homburg",), "Saarpfalz-Kreis",
          note="Gemarkung Homburg only (core town), not the municipality; its other Gemarkungen are separate "
               "places or listed as excluded"),
    Place("Bruchhof-Sanddorf", "SL", *HOMBURG, ("Bruchhof-Sanddorf",), "Saarpfalz-Kreis"),
    Place("Beeden-Schwarzenbach", "SL", *HOMBURG, ("Beeden-Schwarzenbach",), "Saarpfalz-Kreis"),
    Place("Erbach-Reiskirchen", "SL", *HOMBURG, ("Erbach-Reiskirchen",), "Saarpfalz-Kreis",
          note="one Gemarkung, two districts (Erbach, Reiskirchen); one entry for now (plan §5)"),
    Place("Einöd", "SL", *HOMBURG, ("Einöd",), "Saarpfalz-Kreis"),
    Place("Mörsbach", "RLP", "Zweibrücken", "07320000", ("Mörsbach",), "kreisfreie Stadt Zweibrücken",
          note="district of the town Zweibrücken with its own Gemarkung"),
    Place("Bechhofen", "RLP", "Bechhofen", "07340203", ("Bechhofen",), "Landkreis Südwestpfalz"),
    Place("Zweibrücken", "RLP", "Zweibrücken", "07320000", ("Zweibrücken",), "kreisfreie Stadt Zweibrücken",
          note="Gemarkung Zweibrücken only (core town); the town's other Gemarkungen (Mörsbach is its own "
               "place) are listed as excluded"),
)


_TRANSLIT = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", "Ä": "ae", "Ö": "oe", "Ü": "ue"})


def slug(name: str) -> str:
    """Stable ASCII id: 'Einöd' -> 'einoed', 'Bruchhof-Sanddorf' -> 'bruchhof-sanddorf', 'Zweibrücken (Stadt)'
    -> 'zweibruecken-stadt'. German umlauts are transliterated (not stripped) so ids stay readable."""
    s = name.translate(_TRANSLIT).lower()
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    if not s:
        raise ValueError(f"empty slug for {name!r}")
    return s


# --- WFS with a property filter (pure URL helpers) -------------------------------------------------

@dataclass(frozen=True)
class Service:
    state: str
    base: str
    prefix: str
    upper: bool                      # property names upper-case (SL) or lower-case (RLP)
    output_format: str | None
    parse: Callable[[bytes], list[dict[str, Any]]]
    suffix: str
    namespaces: Mapping[str, str] = field(default_factory=dict)

    def prop(self, name: str) -> str:
        return name.upper() if self.upper else name.lower()


SERVICES: dict[str, Service] = {
    "SL": Service("SL", WFS_URL, TYPE_PREFIX, True, "GEOJSON", parse_page, ".geojson"),
    "RLP": Service("RLP", RLP_WFS_URL, RLP_TYPE_PREFIX, False, None, parse_gml_page, ".gml",
                   {"ave": "http://repository.gdi-de.org/schemas/adv/produkt/alkis-vereinfacht/2.0"}),
}


def _xml_escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def filter_xml(svc: Service, prop: str, value: str) -> str:
    """FES 2.0 PropertyIsEqualTo filter on one ALKIS property (namespaced for services that need it)."""
    ns = "".join(f' xmlns:{k}="{v}"' for k, v in svc.namespaces.items())
    ref = svc.prop(prop)
    if svc.namespaces:
        ref = f"{next(iter(svc.namespaces))}:{ref}"
    return (f'<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0"{ns}><fes:PropertyIsEqualTo>'
            f"<fes:ValueReference>{ref}</fes:ValueReference><fes:Literal>{_xml_escape(value)}</fes:Literal>"
            "</fes:PropertyIsEqualTo></fes:Filter>")


def filter_url(svc: Service, typename: str, prop: str, value: str, *, start: int = 0, count: int = PAGE_SIZE,
               hits: bool = False, properties: Sequence[str] = ()) -> str:
    """GetFeature URL for all `typename` features with `prop == value` (no BBOX), EPSG:25832 output.
    `properties` restricts the returned properties (PROPERTYNAME), e.g. for listing Gemarkungen cheaply."""
    params = {"SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "TYPENAMES": svc.prefix + typename,
              "SRSNAME": CRS_URN, "FILTER": filter_xml(svc, prop, value)}
    if hits:
        params["RESULTTYPE"] = "hits"
    else:
        if svc.output_format:
            params["OUTPUTFORMAT"] = svc.output_format
        params.update({"COUNT": str(count), "STARTINDEX": str(start)})
        if properties:
            params["PROPERTYNAME"] = ",".join(svc.prefix + svc.prop(p) for p in properties)
    return svc.base + "?" + urllib.parse.urlencode(params, safe=":,")


def fetch_pages(make_url: Callable[..., str], cache: Path, *, get: Callable[[str], bytes],
                parse: Callable[[bytes], list[dict[str, Any]]], suffix: str,
                page_size: int = PAGE_SIZE) -> list[dict[str, Any]]:
    """All features of one filtered query, paged and cached as `<cache>/page_<start><suffix>` + `hits.json`.
    `make_url(start=, count=, hits=)` builds the request; `get(url) -> bytes` is injected (tests run offline).
    A complete cache is reused without any request. Raises if the paged total disagrees with numberMatched."""
    cache.mkdir(parents=True, exist_ok=True)
    hits_file = cache / "hits.json"
    if hits_file.exists():
        matched = int(json.loads(hits_file.read_text())["numberMatched"])
    else:
        matched = parse_number_matched(get(make_url(hits=True)))
        _write_atomic(hits_file, json.dumps({"numberMatched": matched, "fetched": date.today().isoformat()}).encode())
    features: list[dict[str, Any]] = []
    start = 0
    while start < matched:
        page_file = cache / f"page_{start}{suffix}"
        if page_file.exists():
            page = parse(page_file.read_bytes())
        else:
            body = get(make_url(start=start, count=page_size))
            page = parse(body)
            _write_atomic(page_file, body)
        features.extend(page)
        if len(page) < page_size:
            break
        start += page_size
    if len(features) != matched:
        raise RuntimeError(f"paged {len(features)} features but WFS reports numberMatched={matched}"
                           f" (stale cache? delete {cache})")
    return features


def fetched_date(cache: Path) -> str:
    try:
        return json.loads((cache / "hits.json").read_text()).get("fetched", "")
    except (OSError, ValueError):
        return ""


# --- attributes -----------------------------------------------------------------------------------

def prop(feature: Mapping[str, Any], name: str) -> str | None:
    """Property by upper-case name (both services are normalised to upper case by the cadastre parsers)."""
    p = feature.get("properties") or {}
    return clean(p.get(name, p.get(name.lower())))


def parse_tntxt(value: Any) -> list[tuple[str, float]]:
    """ALKIS-vereinfacht `TNTXT` (tatsächliche Nutzung of one parcel) -> [(class, m²), …].

    Format "Klasse;m²|Klasse;m²", e.g. "Wohnbaufläche;741|Landwirtschaft / Ackerland;421". Entries without a
    parseable positive area are dropped; a class appearing twice is summed (first position kept)."""
    s = clean(value)
    if s is None:
        return []
    out: dict[str, float] = {}
    for part in s.split("|"):
        if ";" not in part:
            continue
        cls, area = part.rsplit(";", 1)
        cls, a = cls.strip(), parse_area(area)
        if cls and a is not None:
            out[cls] = out.get(cls, 0) + a
    return list(out.items())


def gemarkung_census(features: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """[{name, key, parcels}] of the Gemarkungen in a projected parcel listing, sorted by key."""
    c: Counter[tuple[str, str]] = Counter()
    for f in features:
        name, key = prop(f, "GEMARKUNG"), prop(f, "GEMASCHL")
        if name and key:
            c[(name, key)] += 1
    return [{"name": n, "key": k, "parcels": v} for (n, k), v in sorted(c.items(), key=lambda kv: kv[0][1])]


def resolve_keys(place: Place, census: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Gemarkung names of `place` -> census entries (name, key, parcels). Raises if a name is missing or
    ambiguous, so a renamed Gemarkung or a wrong municipality key fails loudly."""
    out = []
    for name in place.gemarkungen:
        hits = [c for c in census if c["name"] == name]
        if len(hits) != 1:
            raise RuntimeError(f"{place.name_de}: Gemarkung {name!r} found {len(hits)}x in municipality "
                               f"{place.municipality_key} ({[c['name'] for c in census]})")
        out.append(dict(hits[0]))
    return out


# --- geometry (pure) ------------------------------------------------------------------------------

def _polygons(g) -> list[Polygon]:
    if g is None or g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    if hasattr(g, "geoms"):
        return [p for sub in g.geoms for p in _polygons(sub)]
    return []


def dissolve(geoms: Iterable, *, grid: float = GRID_M, min_hole_m2: float = MIN_HOLE_M2,
             min_part_m2: float = MIN_PART_M2) -> tuple[Polygon | MultiPolygon, dict[str, float]]:
    """Union of parcel geometries into one outline. Each input is made valid; only polygonal parts count.
    The union runs on a `grid` (1 cm) so vertices that differ by float noise merge; holes < `min_hole_m2`
    (slivers between neighbours) and parts < `min_part_m2` are dropped, larger holes (enclaves) stay.
    Returns (outline, info) with info = {parts, holes, dropped_holes_m2, dropped_parts_m2}."""
    parts = [p for g in geoms if g is not None for p in _polygons(shapely.make_valid(g))]
    if not parts:
        raise ValueError("dissolve: no polygonal input")
    u = shapely.union_all(parts, grid_size=grid)
    info = {"parts": 0, "holes": 0, "dropped_holes_m2": 0.0, "dropped_parts_m2": 0.0}
    kept = []
    for poly in _polygons(u):
        if poly.area < min_part_m2:
            info["dropped_parts_m2"] += poly.area
            continue
        holes = []
        for ring in poly.interiors:
            a = Polygon(ring).area
            if a < min_hole_m2:
                info["dropped_holes_m2"] += a
            else:
                holes.append(ring)
        kept.append(Polygon(poly.exterior, holes))
        info["holes"] += len(holes)
    if not kept:
        raise ValueError("dissolve: nothing left after dropping slivers")
    info["parts"] = len(kept)
    info["dropped_holes_m2"] = round(info["dropped_holes_m2"], 2)
    info["dropped_parts_m2"] = round(info["dropped_parts_m2"], 2)
    out = kept[0] if len(kept) == 1 else MultiPolygon(kept)
    return out, info


def snap_bbox(bounds: Bbox, *, margin: float = STATS_MARGIN_M, step: float = SNAP_M) -> tuple[int, int, int, int]:
    """(minx, miny, maxx, maxy) grown by `margin` and snapped outward to multiples of `step`."""
    x0, y0, x1, y1 = bounds
    if x1 < x0 or y1 < y0:
        raise ValueError(f"bad bounds {bounds}")
    return (int(math.floor((x0 - margin) / step) * step), int(math.floor((y0 - margin) / step) * step),
            int(math.ceil((x1 + margin) / step) * step), int(math.ceil((y1 + margin) / step) * step))


def tiles_in(bbox: Bbox, step: int = 1000) -> list[tuple[int, int]]:
    """1 km tiles (E_km, N_km of the lower-left corner) covering a bbox that lies on the km grid."""
    e0, n0, e1, n1 = bbox
    return [(e, n) for n in range(math.floor(n0 / step), math.ceil(n1 / step))
            for e in range(math.floor(e0 / step), math.ceil(e1 / step))]


def tiles_touching(geom, bbox: Bbox, *, margin: float = STATS_MARGIN_M) -> list[tuple[int, int]]:
    """Tiles of `bbox` that intersect `geom` grown by `margin` (the tiles a stats run over `geom` needs)."""
    g = geom.buffer(margin) if margin else geom
    return [t for t in tiles_in(bbox) if g.intersects(box(t[0] * 1000, t[1] * 1000, t[0] * 1000 + 1000,
                                                          t[1] * 1000 + 1000))]


def set_section_bbox(toml_text: str, key: str, bbox: Sequence[int], comment: str = "") -> str:
    """Rewrite the `bbox = [...]` line inside the `[key]` table of an aois.toml text (other lines untouched).
    Raises if the table or its bbox line is missing."""
    lines = toml_text.splitlines(keepends=True)
    try:
        start = next(i for i, ln in enumerate(lines) if ln.strip() == f"[{key}]")
    except StopIteration:
        raise ValueError(f"no [{key}] table") from None
    for i in range(start + 1, len(lines)):
        s = lines[i].strip()
        if s.startswith("["):
            break
        if re.match(r"bbox\s*=", s):
            tail = f"   # {comment}" if comment else ""
            lines[i] = f"bbox = [{', '.join(str(int(v)) for v in bbox)}]{tail}\n"
            return "".join(lines)
    raise ValueError(f"[{key}] has no bbox line")


# --- assembly -------------------------------------------------------------------------------------

def parcel_feature(f: Mapping[str, Any], place_id: str, state: str) -> dict[str, Any] | None:
    """Raw WFS parcel -> slim work feature (no address, no owner: G3). None without geometry."""
    g = f.get("geometry")
    if not g:
        return None
    geom = shapely.make_valid(shape(g))
    gj = polygon_geometry(geom)
    if gj is None:
        return None
    props: dict[str, Any] = {"flstkennz": prop(f, "FLSTKENNZ"), "gemarkung": prop(f, "GEMARKUNG"),
                             "gemaschl": prop(f, "GEMASCHL"), "place": place_id, "state": state,
                             "flaeche_m2": parse_area(prop(f, "FLAECHE")),
                             "nutzung": [[c, a] for c, a in parse_tntxt(prop(f, "TNTXT"))]}
    return {"type": "Feature", "properties": props, "geometry": gj}


def dedupe_parcels(features: Iterable[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    seen: set[str] = set()
    out = []
    for f in features:
        k = prop(f, "FLSTKENNZ") or prop(f, "OID")
        if k is not None and k in seen:
            continue
        if k is not None:
            seen.add(k)
        out.append(f)
    return out


def place_summary(place: Place, gemarkungen: Sequence[Mapping[str, Any]], parcels: Sequence[Mapping[str, Any]],
                  outline, info: Mapping[str, float]) -> dict[str, Any]:
    """Properties of one place outline: ids, keys, official area sum, parcel count, land-use sums (aggregates)."""
    area = sum(p["properties"]["flaeche_m2"] or 0 for p in parcels)
    missing = sum(1 for p in parcels if p["properties"]["flaeche_m2"] is None)
    nutz: dict[str, float] = defaultdict(float)
    for p in parcels:
        for cls, a in p["properties"]["nutzung"]:
            nutz[cls] += a
    return {
        "id": place.id, "name_de": place.name_de, "kind": "gemarkung", "state": place.state,
        "municipality": place.municipality, "municipality_key": place.municipality_key, "county": place.county,
        "gemarkungen": [{"name": g["name"], "key": g["key"]} for g in gemarkungen],
        "area_official_m2": round(area, 2), "area_official_ha": round(area / 1e4, 1),
        "area_outline_m2": round(outline.area, 1), "parcels": len(parcels), "parcels_without_area": missing,
        "nutzung_m2": {k: round(v, 1) for k, v in sorted(nutz.items(), key=lambda kv: -kv[1])},
        "lidar_epoch": LIDAR_EPOCH[place.state], "flags": place.flags, "outline": dict(info),
        **({"note": place.note} if place.note else {}),
    }


def write_json(path: Path, obj: Any, *, gz: bool = False) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode()
    if gz:
        data = gzip.compress(data, compresslevel=6, mtime=0)
    _write_atomic(path, data)
    return len(data)


# --- network steps --------------------------------------------------------------------------------

def census(svc: Service, municipality_key: str, get=http_get) -> list[dict[str, Any]]:
    """Gemarkungen of one municipality (by GMDSCHL) with parcel counts; projected listing, cached."""
    cache = ORTE_RAW / f"{svc.state.lower()}_gmd_{municipality_key}"
    feats = fetch_pages(lambda **kw: filter_url(svc, "Flurstueck", "GMDSCHL", municipality_key,
                                                properties=("GEMARKUNG", "GEMASCHL"), **kw),
                        cache, get=get, parse=svc.parse, suffix=svc.suffix)
    return gemarkung_census(feats)


def parcels_of(svc: Service, gemaschl: str, get=http_get) -> tuple[list[dict[str, Any]], Path]:
    cache = ORTE_RAW / f"{svc.state.lower()}_gemarkung_{gemaschl}"
    feats = fetch_pages(lambda **kw: filter_url(svc, "Flurstueck", "GEMASCHL", gemaschl, **kw),
                        cache, get=get, parse=svc.parse, suffix=svc.suffix)
    return feats, cache


# --- SL fallback: INSPIRE CadastralParcels WFS (deegree) -------------------------------------------
# Used only when WFS 414 is unavailable (it answered 503 for > 10 min on 2026-11-07). Same ALKIS data and
# licence (dl-de/by-2-0, no owners) but EPSG:4258/4326 only (lat,lon; 6 decimals ≈ 0.1 m), GML 3.2 only,
# no paging (≤ 15 000 features per request), no land use (TNTXT), no municipality key. Gemarkung names and
# official Gemarkung outlines come from `cp:CadastralZoning` (2ndOrder, levelName "Gemarkung", 6-digit ref).

INSPIRE_SL_URL = "https://geoportal.saarland.de/gdi-sl/inspirewfs_Flurstuecke_Grundstuecke_ALKIS"
CP = "{http://inspire.ec.europa.eu/schemas/cp/4.0}"
GN = "{http://inspire.ec.europa.eu/schemas/gn/4.0}"
INSPIRE_FNS = ('xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:cp="http://inspire.ec.europa.eu/schemas/cp/4.0" '
               'xmlns:gml="http://www.opengis.net/gml/3.2"')
INSPIRE_LIMIT = 15_000
# Gemarkungen listed for the SL places: every Gemarkung zoning touching the AOI `overall` (all six SL places do)
SL_LISTING_BBOX: Bbox = (378_000, 5_460_000, 384_000, 5_468_000)


def inspire_url(typename: str, flt: str, *, hits: bool = False, count: int = INSPIRE_LIMIT) -> str:
    params = {"SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "TYPENAMES": "cp:" + typename,
              "NAMESPACES": "xmlns(cp,http://inspire.ec.europa.eu/schemas/cp/4.0)", "FILTER": flt}
    if hits:
        params["RESULTTYPE"] = "hits"
    else:
        params["COUNT"] = str(count)
    return INSPIRE_SL_URL + "?" + urllib.parse.urlencode(params, safe=":,()")


def inspire_like(prop_name: str, prefix: str) -> str:
    """Filter `prop_name` starting with `prefix` (digits only, so no escaping is needed)."""
    if not prefix.isdigit():
        raise ValueError(f"prefix must be digits: {prefix!r}")
    return (f'<fes:Filter {INSPIRE_FNS}><fes:PropertyIsLike wildCard="*" singleChar="." escapeChar="!">'
            f"<fes:ValueReference>cp:{prop_name}</fes:ValueReference><fes:Literal>{prefix}*</fes:Literal>"
            "</fes:PropertyIsLike></fes:Filter>")


def inspire_gemarkung_filter(bbox_latlon: Bbox) -> str:
    """Gemarkung-level zonings (6-character reference) intersecting a lat/lon box (EPSG:4258 axis order)."""
    la0, lo0, la1, lo1 = bbox_latlon
    return (f'<fes:Filter {INSPIRE_FNS}><fes:And><fes:BBOX><fes:ValueReference>cp:geometry</fes:ValueReference>'
            f'<gml:Envelope srsName="urn:ogc:def:crs:EPSG::4258"><gml:lowerCorner>{la0:.6f} {lo0:.6f}</gml:lowerCorner>'
            f"<gml:upperCorner>{la1:.6f} {lo1:.6f}</gml:upperCorner></gml:Envelope></fes:BBOX>"
            '<fes:PropertyIsLike wildCard="*" singleChar="." escapeChar="!">'
            "<fes:ValueReference>cp:nationalCadastalZoningReference</fes:ValueReference><fes:Literal>......"
            "</fes:Literal></fes:PropertyIsLike></fes:And></fes:Filter>")


def split_prefixes(prefix: str, count_of: Callable[[str], int], limit: int = INSPIRE_LIMIT,
                   max_len: int = 12) -> list[str]:
    """Kennzeichen prefixes (Gemarkung 'GGGGGG', then Flur digits …) whose match count is ≤ `limit`, found by
    appending one digit at a time where a prefix is too big (the INSPIRE WFS cannot page). Empty prefixes
    are dropped."""
    n = count_of(prefix)
    if n == 0:
        return []
    if n <= limit:
        return [prefix]
    if len(prefix) >= max_len:
        raise RuntimeError(f"prefix {prefix} still matches {n} > {limit} features")
    return [p for d in "0123456789" for p in split_prefixes(prefix + d, count_of, limit, max_len)]


def _latlon_to_utm():
    from pyproj import Transformer
    t = Transformer.from_crs("EPSG:4258", "EPSG:25832")  # authority axis order: (lat, lon) -> (E, N)

    def conv(ring: list[list[float]]) -> list[list[float]]:
        e, n = t.transform([p[0] for p in ring], [p[1] for p in ring])
        return [[round(float(x), 2), round(float(y), 2)] for x, y in zip(e, n)]
    return conv


def _inspire_members(body: bytes, tag: str):
    import xml.etree.ElementTree as ET
    from cadastre import WFS2
    try:
        root = ET.fromstring(body)
    except ET.ParseError as e:
        raise ValueError(f"INSPIRE page is not XML ({e}): {body[:300]!r}") from None
    if root.tag != WFS2 + "FeatureCollection":
        raise ValueError(f"INSPIRE page is not a wfs:FeatureCollection: {body[:300]!r}")
    for member in root.iter(WFS2 + "member"):
        for feat in member:
            if feat.tag == CP + tag:
                yield feat


def _inspire_geometry(feat, conv) -> dict[str, Any] | None:
    from cadastre import _gml_polygons
    geom = feat.find(CP + "geometry")
    if geom is None:
        return None
    for el in geom.iter():
        srs = el.get("srsName")
        if srs and "4258" not in srs:
            raise ValueError(f"INSPIRE geometry in unexpected CRS {srs!r} (expected EPSG:4258)")
    polys = [[conv(r) for r in rings] for rings in _gml_polygons(geom)]
    return {"type": "MultiPolygon", "coordinates": polys} if polys else None


def parse_inspire_parcels(body: bytes, conv=None) -> list[dict[str, Any]]:
    """INSPIRE `cp:CadastralParcel` GML (EPSG:4258) -> GeoJSON-like features in EPSG:25832 with the 414-style
    properties FLSTKENNZ, GEMASCHL (first 6 characters), FLAECHE (cp:areaValue, m²) and LABEL."""
    conv = conv or _latlon_to_utm()
    out = []
    for f in _inspire_members(body, "CadastralParcel"):
        ref = (f.findtext(CP + "nationalCadastralReference") or "").strip()
        props = {"FLSTKENNZ": ref, "GEMASCHL": ref[:6], "FLAECHE": (f.findtext(CP + "areaValue") or "").strip(),
                 "LABEL": (f.findtext(CP + "label") or "").strip()}
        out.append({"type": "Feature", "geometry": _inspire_geometry(f, conv), "properties": props})
    return out


def parse_inspire_zonings(body: bytes, conv=None) -> list[dict[str, Any]]:
    """INSPIRE `cp:CadastralZoning` GML -> features with REF, NAME, LEVEL (levelName) in EPSG:25832."""
    conv = conv or _latlon_to_utm()
    out = []
    for f in _inspire_members(body, "CadastralZoning"):
        name = f.find(f"{CP}name//{GN}text")
        level = f.find(f"{CP}levelName/*")
        props = {"REF": (f.findtext(CP + "nationalCadastalZoningReference") or "").strip(),
                 "NAME": (name.text or "").strip() if name is not None else "",
                 "LEVEL": (level.text or "").strip() if level is not None else ""}
        out.append({"type": "Feature", "geometry": _inspire_geometry(f, conv), "properties": props})
    return out


def _inspire_query(typename: str, flt: str, cache: Path, *, get, parse) -> list[dict[str, Any]]:
    """One unpaged INSPIRE query, cached as `<cache>/hits.json` + `page_0.gml`; checks numberMatched."""
    cache.mkdir(parents=True, exist_ok=True)
    hits_file, page_file = cache / "hits.json", cache / "page_0.gml"
    if hits_file.exists():
        matched = int(json.loads(hits_file.read_text())["numberMatched"])
    else:
        matched = parse_number_matched(get(inspire_url(typename, flt, hits=True)))
        _write_atomic(hits_file, json.dumps({"numberMatched": matched, "fetched": date.today().isoformat()}).encode())
    if matched > INSPIRE_LIMIT:
        raise RuntimeError(f"{cache.name}: {matched} features > {INSPIRE_LIMIT}; split the query")
    if matched == 0:
        return []
    if page_file.exists():
        feats = parse(page_file.read_bytes())
    else:
        body = get(inspire_url(typename, flt))
        feats = parse(body)
        _write_atomic(page_file, body)
    if len(feats) != matched:
        raise RuntimeError(f"{cache.name}: got {len(feats)} features, numberMatched={matched} (delete {cache})")
    return feats


def inspire_hits(typename: str, flt: str, cache: Path, *, get) -> int:
    hits_file = cache / "hits.json"
    if hits_file.exists():
        return int(json.loads(hits_file.read_text())["numberMatched"])
    cache.mkdir(parents=True, exist_ok=True)
    matched = parse_number_matched(get(inspire_url(typename, flt, hits=True)))
    _write_atomic(hits_file, json.dumps({"numberMatched": matched, "fetched": date.today().isoformat()}).encode())
    return matched


def sl_inspire_gemarkungen(bbox: Bbox = SL_LISTING_BBOX, get=http_get) -> list[dict[str, Any]]:
    """Gemarkung zonings (name, key, outline) touching an EPSG:25832 `bbox`, from the INSPIRE WFS (cached)."""
    from pyproj import Transformer
    t = Transformer.from_crs("EPSG:25832", "EPSG:4258")
    e0, n0, e1, n1 = bbox
    lats, lons = t.transform([e0, e1, e0, e1], [n0, n0, n1, n1])
    flt = inspire_gemarkung_filter((min(lats), min(lons), max(lats), max(lons)))
    cache = ORTE_RAW / ("sl_inspire_gemarkungen" + ("" if bbox == SL_LISTING_BBOX else
                                                     "_" + "_".join(str(int(v)) for v in bbox)))
    feats = _inspire_query("CadastralZoning", flt, cache, get=get, parse=parse_inspire_zonings)
    out = []
    for f in feats:
        p = f["properties"]
        if p["LEVEL"] != "Gemarkung" or len(p["REF"]) != 6:
            continue
        out.append({"name": p["NAME"], "key": p["REF"], "parcels": None, "geometry": f["geometry"]})
    return sorted(out, key=lambda c: c["key"])


def sl_inspire_parcels(gemaschl: str, name: str, get=http_get) -> tuple[list[dict[str, Any]], Path]:
    """All INSPIRE parcels of one SL Gemarkung (Kennzeichen prefix query, split until ≤ 15 000 per request)."""
    root = ORTE_RAW / "sl_inspire_parcels"

    def count_of(prefix: str) -> int:
        return inspire_hits("CadastralParcel", inspire_like("nationalCadastralReference", prefix),
                            root / prefix, get=get)

    feats: list[dict[str, Any]] = []
    for prefix in split_prefixes(gemaschl, count_of):
        feats += _inspire_query("CadastralParcel", inspire_like("nationalCadastralReference", prefix), root / prefix,
                                get=get, parse=parse_inspire_parcels)
    for f in feats:
        f["properties"]["GEMARKUNG"] = name
    return feats, root / gemaschl


def is_service_down(e: BaseException) -> bool:
    """Network failures and 5xx/429 answers (after `http_open`'s retries) – the cue to use a fallback."""
    import urllib.error
    if isinstance(e, urllib.error.HTTPError):
        return e.code >= 500 or e.code == 429
    return isinstance(e, (urllib.error.URLError, TimeoutError, ConnectionError))


def clip_landuse(features: Iterable[Mapping[str, Any]], outline, place_id: str, *,
                 min_area_m2: float = 0.01) -> list[dict[str, Any]]:
    """Land-use polygons clipped to one place outline (a polygon spanning two places is split between them).
    Properties: oid, nutzart, bez, name, place, area_m2 (clipped area)."""
    shapely.prepare(outline)
    out = []
    for f in features:
        if not f.get("geometry"):
            continue
        g = shapely.make_valid(shape(f["geometry"]))
        if not outline.intersects(g):
            continue
        c = g if outline.contains(g) else g.intersection(outline)
        polys = _polygons(c)
        area = sum(p.area for p in polys)
        if area < min_area_m2:
            continue
        gj = polygon_geometry(polys[0] if len(polys) == 1 else MultiPolygon(polys))
        if gj is None:
            continue
        out.append({"type": "Feature", "geometry": gj, "properties": {
            "oid": prop(f, "OID"), "nutzart": prop(f, "NUTZART"), "bez": prop(f, "BEZ"), "name": prop(f, "NAME"),
            "place": place_id, "area_m2": round(area, 2)}})
    return out


def fetch_nutzung_rlp(outlines: Mapping[str, Any], get=http_get) -> tuple[dict[str, Any], dict[str, int]]:
    """RLP `ave:Nutzung` polygons clipped to the RLP place outlines (one bbox query per place, cached)."""
    feats, stats = [], {}
    for pid, outline in outlines.items():
        b = tuple(float(v) for v in snap_bbox(outline.bounds, margin=0, step=100))
        raw = fetch_type("Nutzung", b, ORTE_RAW / "rlp_nutzung", get=get, url=rlp_wfs_url, parse=parse_gml_page,
                         suffix=".gml", cache_prefix=f"{pid}_")
        clipped = clip_landuse(raw, outline, pid)
        for f in clipped:
            f["properties"]["state"] = "RLP"
        feats += clipped
        stats[pid] = len(clipped)
    return {"type": "FeatureCollection", "features": feats}, stats


def run(*, nutzung: bool = True, write_toml: bool = True, sl_source: str = "auto") -> dict[str, Any]:
    """sl_source: 'wfs414' (required), 'inspire' (fallback forced) or 'auto' (414, INSPIRE if 414 is down)."""
    ORTE_WORK.mkdir(parents=True, exist_ok=True)
    censuses: dict[tuple[str, str], list[dict[str, Any]]] = {}
    sl_mode = "inspire" if sl_source == "inspire" else "wfs414"
    sl_down: str | None = None
    for p in PLACES:
        k = (p.state, p.municipality_key)
        if k in censuses:
            continue
        if p.state == "SL" and sl_mode == "inspire":
            censuses[k] = sl_inspire_gemarkungen()
        else:
            print(f"census {p.state} municipality {p.municipality} ({p.municipality_key})")
            try:
                censuses[k] = census(SERVICES[p.state], p.municipality_key)
            except Exception as e:  # noqa: BLE001 – only service outages fall back, everything else re-raises
                if p.state != "SL" or sl_source != "auto" or not is_service_down(e):
                    raise
                sl_down = f"{type(e).__name__}: {e}"
                print(f"  ! WFS 414 unavailable ({sl_down}) – falling back to the SL INSPIRE CadastralParcels WFS")
                sl_mode = "inspire"
                censuses[k] = sl_inspire_gemarkungen()
        for c in censuses[k]:
            print(f"    {c['key']} {c['name']}: {c['parcels']} parcels")

    place_feats, parcel_feats, outlines, fetched = [], [], {}, defaultdict(set)
    used_keys: set[tuple[str, str]] = set()
    for p in PLACES:
        svc = SERVICES[p.state]
        cs = censuses[(p.state, p.municipality_key)]
        gems = resolve_keys(p, cs)
        inspire = p.state == "SL" and sl_mode == "inspire"
        raw: list[dict[str, Any]] = []
        for g in gems:
            feats, cache = sl_inspire_parcels(g["key"], g["name"]) if inspire else parcels_of(svc, g["key"])
            bad = {prop(f, "GEMASCHL") for f in feats} - {g["key"]}
            if bad:
                raise RuntimeError(f"{p.name_de}: filter on {g['key']} returned other keys {bad}")
            raw += feats
            fetched[p.state].add(fetched_date(cache if not inspire else ORTE_RAW / "sl_inspire_gemarkungen"))
            used_keys.add((p.state, g["key"]))
        raw = dedupe_parcels(raw)
        slim = [pf for f in raw if (pf := parcel_feature(f, p.id, p.state)) is not None]
        outline, info = dissolve(shape(pf["geometry"]) for pf in slim)
        info["parcels_without_geometry"] = len(raw) - len(slim)   # INSPIRE: 0–1 m² slivers collapsed by rounding
        if inspire:  # cross-check against the official Gemarkung outline (INSPIRE CadastralZoning)
            official = shapely.union_all([shapely.make_valid(shape(c["geometry"])) for c in cs
                                          if (p.state, c["key"]) in {(p.state, g["key"]) for g in gems}])
            info["zoning_symdiff_m2"] = round(outline.symmetric_difference(official).area, 1)
            info["zoning_area_m2"] = round(official.area, 1)
        summary = place_summary(p, gems, slim, outline, info)
        summary["parcel_source"] = "inspire-cp" if inspire else ("wfs414" if p.state == "SL" else "wfs519")
        print(f"  {p.id:22s} {summary['parcels']:6d} parcels {summary['area_official_ha']:8.1f} ha official, "
              f"outline {outline.area / 1e4:8.1f} ha, parts {info['parts']}, holes {info['holes']}"
              + (f", vs zoning Δ {info['zoning_symdiff_m2']:.0f} m²" if inspire else ""))
        outlines[p.id] = outline
        parcel_feats += slim
        place_feats.append({"type": "Feature", "properties": summary, "geometry": polygon_geometry(outline)})

    union = shapely.union_all(list(outlines.values()))
    bbox = snap_bbox(union.bounds)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    by_state = {st: shapely.union_all([outlines[p.id] for p in PLACES if p.state == st]) for st in ("SL", "RLP")}
    tiles = {st: tiles_touching(g, bbox) for st, g in by_state.items()}

    # Gemarkungen of the involved municipalities that are not a place (documented, not counted)
    # With the INSPIRE fallback the municipality is unknown: list every SL Gemarkung touching the stats bbox.
    excluded = []
    listings = dict(censuses)
    if sl_mode == "inspire":
        listings[("SL", HOMBURG[1])] = sl_inspire_gemarkungen(bbox)
    for (st, mk), cs in listings.items():
        inspire = st == "SL" and sl_mode == "inspire"
        for c in cs:
            if (st, c["key"]) in used_keys:
                continue
            e = {"name": c["name"], "key": c["key"], "parcels": c["parcels"], "state": st}
            if inspire:
                e.update(municipality=None, municipality_key=None,
                         note="SL Gemarkung touching the stats bbox (INSPIRE zoning; municipality not available "
                              "there, so it may or may not belong to Homburg)")
            else:
                e.update(municipality_key=mk, municipality=next(p.municipality for p in PLACES
                                                                 if (p.state, p.municipality_key) == (st, mk)))
            excluded.append(e)

    src_name = {"SL": "ALKIS Saarland, WFS SL ALKIS Vereinfacht" if sl_mode == "wfs414"
                else "ALKIS Saarland, INSPIRE-WFS Flurstücke/Grundstücke (CadastralParcels)",
                "RLP": "ALKIS Rheinland-Pfalz, WFS RP ALKIS Vereinfacht"}
    meta = {
        "format": "sle-orte-places-v1", "generated": date.today().isoformat(), "crs": "EPSG:25832",
        "unit": "gemarkung",
        "stats_bbox": list(bbox), "stats_bbox_rule": f"union of outlines + {STATS_MARGIN_M} m, snapped outward to "
                                                     f"{SNAP_M} m",
        "stats_bbox_km2": w * h / 1e6, "tiles_total": len(tiles_in(bbox)),
        "tiles_needed": {st: len(t) for st, t in tiles.items()},
        "tiles_needed_rule": f"1 km tiles of the stats bbox intersecting the state's place outlines + {STATS_MARGIN_M} m",
        "tiles_needed_list": {st: [list(t) for t in ts] for st, ts in tiles.items()},
        "excluded_gemarkungen": excluded,
        "sl_parcel_source": sl_mode, **({"sl_wfs414_error": sl_down} if sl_down else {}),
        "sources": {st: f"{src_name[st]} (abgerufen {', '.join(sorted(d for d in fetched[st] if d))})"
                    for st in fetched},
        "attribution": [ATTRIBUTION[st] for st in ("SL", "RLP") if st in fetched],
        "landuse": {
            "per_parcel": "flurstuecke.geojson.gz properties.nutzung = ALKIS TNTXT (tatsächliche Nutzung, "
                          "[class, m²] pairs); per place sums in properties.nutzung_m2. SL and RLP use different "
                          "class labels (SL 'Wald / Laubholz', RLP 'Laubholz').",
            "SL": ("TNTXT from WFS 414" if sl_mode == "wfs414" else
                   "missing: WFS 414 was unavailable and the INSPIRE fallback has no land use; rerun places.py "
                   "when 414 answers (SL parcels then carry TNTXT)"),
            "RLP": "TNTXT from WFS 519",
        },
    }

    if nutzung:
        rlp = {p.id: outlines[p.id] for p in PLACES if p.state == "RLP"}
        nfc, nstats = fetch_nutzung_rlp(rlp)
        n = write_json(ORTE_WORK / "nutzung.geojson", {**nfc, "meta": {
            "crs": "EPSG:25832", "source": "WFS RP ALKIS Vereinfacht, ave:Nutzung", "attribution": [ATTRIBUTION_ALKIS_RLP],
            "coverage": "RLP places only, clipped to the place outlines (area_m2 = clipped area); "
                        "SL: see gemarkungen.geojson meta.landuse",
            "overlaps": "a few same-class ALKIS objects overlap (≈ 0.3 % of Zweibrücken, 0.05 % of Bechhofen on "
                        "2026-11-07): union per class before summing areas, or use TNTXT"}})
        meta["landuse"]["polygons"] = {"file": "nutzung.geojson", "coverage": "RLP", "features": nstats}
        print(f"  nutzung.geojson {sum(nstats.values())} RLP polygons, {fmt_bytes(n)}")

    n_places = write_json(ORTE_WORK / "gemarkungen.geojson",
                          {"type": "FeatureCollection", "meta": meta, "features": place_feats})
    n_parcels = write_json(ORTE_WORK / "flurstuecke.geojson.gz",
                           {"type": "FeatureCollection", "meta": {"crs": "EPSG:25832", "attribution": meta["attribution"],
                                                                  "note": "work file; per-parcel values are never "
                                                                          "published or ranked (G1/G2)"},
                            "features": parcel_feats}, gz=True)
    print(f"  gemarkungen.geojson {fmt_bytes(n_places)}, flurstuecke.geojson.gz {len(parcel_feats)} parcels "
          f"{fmt_bytes(n_parcels)}")
    print(f"  stats bbox {bbox} = {w / 1000:.0f} x {h / 1000:.0f} km = {w * h / 1e6:.0f} km², "
          f"{meta['tiles_total']} tiles; needed SL {meta['tiles_needed']['SL']}, RLP {meta['tiles_needed']['RLP']}")
    if write_toml:
        AOIS_TOML.write_text(set_section_bbox(AOIS_TOML.read_text(), AOI_KEY, bbox,
                                              "written by places.py: 9 place outlines + 200 m, 1 km grid"))
        print(f"  aois.toml [{AOI_KEY}] bbox updated")
    return meta


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--no-nutzung", action="store_true", help="skip the RLP ave:Nutzung polygons")
    ap.add_argument("--no-toml", action="store_true", help="do not write the stats bbox into aois.toml")
    ap.add_argument("--sl-source", choices=("auto", "wfs414", "inspire"), default="auto",
                    help="SL parcels: WFS 414 (land use included), INSPIRE fallback, or auto (414, else INSPIRE)")
    a = ap.parse_args(argv)
    run(nutzung=not a.no_nutzung, write_toml=not a.no_toml, sl_source=a.sl_source)


if __name__ == "__main__":
    main(sys.argv[1:])
