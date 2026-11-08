"""Orte im Vergleich, Phase 1: roof PV potential per place from the LoD2 roof planes (discipline ☀️, plan §5 Q12).

Usage:  uv run python roofs.py

Plan: docs/plans/orte-im-vergleich.md §5 („Potential“), Q12 (no open solar roof register in SL or RLP, so we compute it
ourselves). Input: the LoD2 CityGML tiles of the stats area that buildings.py / stats_trees.py cached under
data/raw/lod2/{sl,rlp}/ (the same tile list as stats.py; no download here), and the place outlines
data/work/orte/gemarkungen.geojson (places.py). The AdV LoD2 model has real roof planes: every bldg:RoofSurface is a
planar 3D polygon (or a few coplanar ones), so tilt, orientation and the true inclined area are measured per plane.

Method `roof-pv-potential-v2` (a **Schätzung**, G7):
- per RoofSurface: area = Σ 3D polygon areas (holes subtracted), normal = Σ Newell vectors oriented upward;
  tilt = angle to the horizontal, azimuth = compass direction the plane faces (0 N, 90 E, 180 S, 270 W).
- suitable plane: area ≥ MIN_PLANE_M2 and tilt ≤ MAX_TILT_DEG and (tilt < FLAT_DEG, i.e. a flat roof, any
  orientation, or azimuth within AZ_MIN…AZ_MAX = E, SE, S, SW, W). North-ish planes (NW, N, NE) are excluded.
- usable area = pitched suitable area × SETBACK (0.7: edge distances, chimneys, dormers, windows, shading) + flat
  suitable area × FLAT_USABLE (0.4: tilted module rows need spacing against self-shading, plus parapet setbacks,
  skylights, plant rooms; rule of thumb ≈ 10–15 m² of flat roof per kWp); potential kWp = usable area × [0.15, 0.18,
  0.20] kWp/m² (older … current modules). v1 used 0.7 for flat roofs too, which put industrial places at
  9–11 kWp per inhabitant (Homburg: 69 % of the suitable area is flat roof; review 2026-11-08).
- a building belongs to a place when the area-weighted centroid of its roof planes lies inside the outline. SL places
  count only SL LoD2 buildings and RLP places only RLP ones (each state models its own buildings; this also removes
  the few duplicates along the border). Building classes from bldg:function (ALKIS Gebäudefunktion):
  residential = 31001_1xxx (Wohnen, gemischt mit Wohnen), garage = 31001_2463 / 51009_1611 (Garage, Carport),
  other = everything else.

Municipality view: MaStR (stats_inputs.py, data/work/orte/mastr_pv.json) has small PV only per municipality (Q10). The
*used share* = MaStR building-mounted kWp (Gebäudesolaranlage, in operation) ÷ roof potential is computed only for a
municipality whose Gemarkungen are all places here (Bechhofen). Homburg and Zweibrücken have further Gemarkungen
(gemarkungen.geojson meta.excluded_gemarkungen) whose outlines/LoD2 are not processed, so their used share is
`null` with the reason; the sum over their places in our set is given as a partial potential.

Privacy (G1/G2, ADR 0049): aggregates per place and municipality only, never a value per building or plane; an
aggregate over fewer than MIN_BUILDINGS buildings is suppressed. Output: data/work/orte/roofs_by_place.json (work
file; stats.py publishes it later). Attribution: the LoD2 credits of buildings.py.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import math
import sys
import time
from collections.abc import Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from common import WORK_DIR

ORTE_WORK = WORK_DIR / "orte"
OUT = ORTE_WORK / "roofs_by_place.json"
FORMAT = "sle-orte-roofs-v1"
METHOD = "roof-pv-potential-v2"

MIN_PLANE_M2 = 10.0
MAX_TILT_DEG = 60.0
FLAT_DEG = 10.0
AZ_MIN, AZ_MAX = 67.5, 292.5          # E (90 ± 22.5) … S … W (270 ± 22.5)
SETBACK = 0.7                         # pitched roofs
FLAT_USABLE = 0.4                     # flat roofs (row spacing, parapets, skylights)
KWP_PER_M2 = (0.15, 0.18, 0.20)       # lo, mid, hi
MIN_BUILDINGS = 5

ORIENT_CLASSES = ("flat", "S", "SE_SW", "E_W", "N")


@dataclass(frozen=True)
class Plane:
    area: float          # m², inclined (true) area
    tilt: float          # degrees from horizontal
    azimuth: float       # degrees, compass direction the plane faces; nan for horizontal planes


@dataclass
class RoofBuilding:
    id: str
    source: str          # 'sl' | 'rlp'
    function: str | None
    planes: list[Plane]
    x: float             # area-weighted centroid of the roof polygons (EPSG:25832)
    y: float


# =================================================================================================== pure
def newell(ring: np.ndarray) -> np.ndarray:
    """Newell vector of a closed or open 3D ring: direction = normal (right-hand rule), length = 2 × area. Pure."""
    p = np.asarray(ring, np.float64)
    if len(p) > 1 and np.allclose(p[0], p[-1]):
        p = p[:-1]
    if len(p) < 3:
        return np.zeros(3)
    p = p - p.mean(axis=0)
    q = np.roll(p, -1, axis=0)
    return np.array([np.sum((p[:, 1] - q[:, 1]) * (p[:, 2] + q[:, 2])),
                     np.sum((p[:, 2] - q[:, 2]) * (p[:, 0] + q[:, 0])),
                     np.sum((p[:, 0] - q[:, 0]) * (p[:, 1] + q[:, 1]))])


def polygon_vector(rings: Sequence[np.ndarray]) -> np.ndarray:
    """Area vector of one polygon (exterior minus holes), oriented upward (z ≥ 0). |v| = area. Pure."""
    def up(v: np.ndarray) -> np.ndarray:
        return -v if v[2] < 0 else v
    if not rings:
        return np.zeros(3)
    v = up(newell(rings[0]))
    for h in rings[1:]:
        v = v - up(newell(h))
    return v / 2.0


def plane_from_polygons(polys: Sequence[Sequence[np.ndarray]]) -> Plane | None:
    """One RoofSurface (≥ 1 polygons) → Plane(area, tilt, azimuth). Area = Σ polygon areas; orientation from the
    summed upward area vectors. None for degenerate input. Pure."""
    vs = [polygon_vector(r) for r in polys]
    area = float(sum(np.linalg.norm(v) for v in vs))
    n = np.sum(vs, axis=0) if vs else np.zeros(3)
    ln = float(np.linalg.norm(n))
    if area <= 0 or ln <= 0:
        return None
    n = n / ln
    tilt = math.degrees(math.acos(min(1.0, max(-1.0, float(n[2])))))
    horiz = math.hypot(n[0], n[1])
    az = math.degrees(math.atan2(n[0], n[1])) % 360.0 if horiz > 1e-9 else float("nan")
    return Plane(area, tilt, az)


def orient_class(p: Plane, flat_deg: float = FLAT_DEG) -> str:
    """flat | S (157.5–202.5) | SE_SW (112.5–157.5, 202.5–247.5) | E_W (67.5–112.5, 247.5–292.5) | N (rest). Pure."""
    if p.tilt < flat_deg or math.isnan(p.azimuth):
        return "flat"
    d = abs(((p.azimuth - 180.0) + 180.0) % 360.0 - 180.0)    # angular distance from south, 0…180
    if d <= 22.5:
        return "S"
    if d <= 67.5:
        return "SE_SW"
    if d <= 112.5:
        return "E_W"
    return "N"


def suitable(p: Plane, *, min_area: float = MIN_PLANE_M2, max_tilt: float = MAX_TILT_DEG,
             flat_deg: float = FLAT_DEG) -> bool:
    """Rule set of roof-pv-potential-v1 (module docstring). Pure."""
    if p.area < min_area or p.tilt > max_tilt:
        return False
    return orient_class(p, flat_deg) != "N"


def building_class(function: str | None) -> str:
    """ALKIS Gebäudefunktion code → 'residential' | 'garage' | 'other'. Pure."""
    f = (function or "").strip()
    if f.startswith("31001_1"):
        return "residential"
    if f in ("31001_2463", "51009_1611"):
        return "garage"
    return "other"


def kwp_range(usable_m2: float, density: Sequence[float] = KWP_PER_M2) -> list[float]:
    return [round(usable_m2 * d, 1) for d in density]


def aggregate(buildings: Iterable[RoofBuilding], *, setback: float = SETBACK, flat_usable: float = FLAT_USABLE,
              min_buildings: int = MIN_BUILDINGS) -> dict[str, Any]:
    """Aggregate roof figures over a set of buildings (one place). Pure. Values over < min_buildings buildings are
    suppressed (None + listed in `suppressed`). Usable area = pitched suitable × setback + flat suitable ×
    flat_usable."""
    n_b = n_roof = n_suit = 0
    planes = planes_suit = 0
    area = area_suit = usable = 0.0
    by_orient = {k: 0.0 for k in ORIENT_CLASSES}
    by_cls: dict[str, dict[str, float]] = {c: {"buildings": 0, "buildings_suitable": 0, "suitable_m2": 0.0,
                                               "usable_m2": 0.0} for c in ("residential", "garage", "other")}
    for b in buildings:
        n_b += 1
        cls = by_cls[building_class(b.function)]
        cls["buildings"] += 1
        if b.planes:
            n_roof += 1
        s_here = u_here = 0.0
        for p in b.planes:
            planes += 1
            area += p.area
            if suitable(p):
                o = orient_class(p)
                planes_suit += 1
                area_suit += p.area
                s_here += p.area
                u_here += p.area * (flat_usable if o == "flat" else setback)
                by_orient[o] += p.area
        usable += u_here
        if s_here > 0:
            n_suit += 1
            cls["buildings_suitable"] += 1
            cls["suitable_m2"] += s_here
            cls["usable_m2"] += u_here
    out: dict[str, Any] = {
        "buildings": n_b, "buildings_with_roof_planes": n_roof, "buildings_suitable": n_suit,
        "roof_planes": planes, "roof_planes_suitable": planes_suit,
        "roof_area_m2": round(area), "suitable_area_m2": round(area_suit), "usable_area_m2": round(usable),
        "suitable_share_pct": round(100 * area_suit / area, 1) if area else None,
        "usable_share_pct": round(100 * usable / area, 1) if area else None,
        "kwp": kwp_range(usable),
        "suitable_by_orientation_m2": {k: round(v) for k, v in by_orient.items()},
        "by_building_class": {c: {"buildings": int(v["buildings"]), "buildings_suitable": int(v["buildings_suitable"]),
                                  "suitable_area_m2": round(v["suitable_m2"]),
                                  "kwp": kwp_range(v["usable_m2"])} for c, v in by_cls.items()},
        "suppressed": [],
    }
    if n_b < min_buildings:
        for k in ("roof_area_m2", "suitable_area_m2", "usable_area_m2", "suitable_share_pct", "usable_share_pct",
                  "kwp", "suitable_by_orientation_m2"):
            out[k] = None
            out["suppressed"].append(k)
    for c, v in out["by_building_class"].items():
        if v["buildings"] < min_buildings:
            out["by_building_class"][c] = {"buildings": v["buildings"], "suppressed": True}
    return out


def used_share(mastr_kwp: float, potential: Sequence[float]) -> list[float] | None:
    """MaStR building-mounted kWp ÷ potential [lo, mid, hi] → used share in % as [lo, mid, hi] (lo uses the high
    potential). Pure."""
    lo_p, mid_p, hi_p = potential
    if not mid_p or not lo_p or not hi_p:
        return None
    return [round(100 * mastr_kwp / hi_p, 1), round(100 * mastr_kwp / mid_p, 1), round(100 * mastr_kwp / lo_p, 1)]


def assign(buildings: Sequence[RoofBuilding], outlines: Mapping[str, tuple[str, Any]], *,
           same_state: bool = True) -> dict[str, list[RoofBuilding]]:
    """place id → buildings whose roof centroid lies inside its outline (only those of the place's state when
    `same_state`). `outlines` maps id → (state 'SL'|'RLP', shapely geometry). Pure."""
    import shapely
    from shapely import STRtree
    ids = list(outlines)
    geoms = [outlines[i][1] for i in ids]
    for g in geoms:
        shapely.prepare(g)
    tree = STRtree(geoms)
    out: dict[str, list[RoofBuilding]] = {i: [] for i in ids}
    if not buildings:
        return out
    pts = shapely.points([b.x for b in buildings], [b.y for b in buildings])
    bi, gi = tree.query(pts, predicate="within")
    for b_idx, g_idx in zip(bi.tolist(), gi.tolist()):
        b, pid = buildings[b_idx], ids[g_idx]
        if not same_state or b.source == outlines[pid][0].lower():
            out[pid].append(b)
    return out


# =================================================================================================== I/O
def _function_of(el) -> str | None:
    from buildings import _local
    for ch in el:
        if _local(ch.tag) == "function" and (ch.text or "").strip():
            return ch.text.strip()
    for part in el.iter("{*}BuildingPart"):
        for ch in part:
            if _local(ch.tag) == "function" and (ch.text or "").strip():
                return ch.text.strip()
    return None


def parse_roof_building(el, source: str) -> RoofBuilding:
    """bldg:Building element → roof planes (one per bldg:RoofSurface, BuildingParts included) + roof centroid."""
    from buildings import clean_ring, polygon_rings
    bid = el.get("{http://www.opengis.net/gml}id") or el.get("{http://www.opengis.net/gml/3.2}id") or ""
    planes: list[Plane] = []
    cx = cy = wsum = 0.0
    for rs in el.iter("{*}RoofSurface"):
        polys = []
        for poly in rs.iter("{*}Polygon"):
            rings = [clean_ring(r) for r in polygon_rings(poly)]
            if not rings or len(rings[0]) < 3:
                continue
            polys.append(rings)
            a = float(np.linalg.norm(polygon_vector(rings)))
            c = rings[0][:, :2].mean(axis=0)
            cx, cy, wsum = cx + a * c[0], cy + a * c[1], wsum + a
        pl = plane_from_polygons(polys) if polys else None
        if pl is not None:
            planes.append(pl)
    if wsum <= 0:   # no roof: use the mean of all vertices (still a location for the place count)
        pts = [r[:, :2] for poly in el.iter("{*}Polygon") for r in polygon_rings(poly)[:1]]
        if pts:
            c = np.vstack(pts).mean(axis=0)
            cx, cy, wsum = float(c[0]), float(c[1]), 1.0
    return RoofBuilding(bid, source, _function_of(el), planes, cx / wsum if wsum else float("nan"),
                        cy / wsum if wsum else float("nan"))


def iter_roof_buildings(path: Path, source: str) -> Iterator[RoofBuilding]:
    """Stream bldg:Building elements of one (gzip) CityGML tile with the hardened parser of buildings.py."""
    from lxml import etree

    from buildings import _local, hardened_parser_kwargs
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rb") as f:
        for _, el in etree.iterparse(f, events=("end",), tag="{*}Building", **hardened_parser_kwargs()):
            yield parse_roof_building(el, source)
            el.clear(keep_tail=True)
            node = el
            while node.getparent() is not None and _local(node.getparent().tag) != "CityModel":
                node = node.getparent()
            root = node.getparent()
            if root is not None:
                while node.getprevious() is not None:
                    del root[0]


def load_all() -> tuple[list[RoofBuilding], dict[str, Any]]:
    import buildings as B
    import stats_trees as ST
    ts = ST.load_tileset()
    sl_paths, rlp_paths = ST.lod2_paths(ts)
    seen: set[str] = set()
    out: list[RoofBuilding] = []
    info = {"sl_tiles": len(sl_paths), "rlp_tiles": len(rlp_paths), "duplicates": 0, "srs": set()}
    for paths, src in ((sl_paths, "sl"), (rlp_paths, "rlp")):
        for p in paths:
            srs = B.gml_srs_names(p)
            if not B.srs_ok(srs):
                sys.exit(f"{p.name}: unexpected CRS {srs} (expected ETRS89/UTM32 + DHHN2016)")
            info["srs"] |= srs
            for b in iter_roof_buildings(p, src):
                if b.id and b.id in seen:
                    info["duplicates"] += 1
                    continue
                seen.add(b.id)
                if not math.isnan(b.x):
                    out.append(b)
    info["srs"] = sorted(info["srs"])
    return out, info


def municipalities(places: Mapping[str, Mapping[str, Any]], per_place: Mapping[str, Mapping[str, Any]],
                   excluded: Sequence[Mapping[str, Any]], mastr: Mapping[str, Any] | None) -> list[dict[str, Any]]:
    """Municipality view: potential summed over our places; used share only when no Gemarkung is missing. Pure."""
    by_ags: dict[str, list[str]] = {}
    for pid, p in places.items():
        by_ags.setdefault(p["municipality_key"], []).append(pid)
    mastr_by = {m["ags"]: m for m in (mastr or {}).get("municipalities", [])}
    out = []
    for ags, pids in by_ags.items():
        name = places[pids[0]]["municipality"]
        state = places[pids[0]]["state"]
        missing = [e["name"] for e in excluded if e.get("municipality_key") == ags]
        unknown = state == "SL" and any(e.get("municipality_key") is None and e.get("state") == "SL"
                                        for e in excluded)
        kwp = [round(sum(per_place[p]["kwp"][i] for p in pids if per_place[p]["kwp"]), 1) for i in range(3)]
        m = mastr_by.get(ags)
        bt = (m or {}).get("by_type", {}).get("Gebäudesolaranlage", {})
        rec: dict[str, Any] = {
            "ags": ags, "name_de": name, "state": state, "places": pids,
            "potential_places_kwp": kwp,
            "suitable_area_places_m2": sum(per_place[p]["suitable_area_m2"] or 0 for p in pids),
            "missing_gemarkungen": missing,
            "mastr_building_kwp": bt.get("kwp"), "mastr_building_units": bt.get("units"),
        }
        complete = not missing and not unknown and m is not None
        if complete:
            rec["complete"] = True
            rec["used_share_pct"] = used_share(float(bt.get("kwp") or 0.0), kwp)
        else:
            rec["complete"] = False
            rec["used_share_pct"] = None
            if missing:
                why = (f"the municipality has {len(missing)} more Gemarkungen ({', '.join(missing)}) whose roofs are "
                       "not processed; MaStR small PV exists only per municipality, so a used share is not computable")
            elif unknown:
                why = ("SL Gemarkung membership of the municipality is unknown (WFS 414 down, INSPIRE has no "
                       "municipality key); Homburg has further Gemarkungen (e.g. Jägersburg, Wörschweiler) that are "
                       "not processed, so a used share is not computable")
            else:
                why = "no MaStR totals for this municipality"
            rec["used_share_note"] = why
        out.append(rec)
    return out


def run() -> dict[str, Any]:
    from shapely.geometry import shape
    t0 = time.time()
    gj = json.loads((ORTE_WORK / "gemarkungen.geojson").read_text())
    places = {f["properties"]["id"]: f["properties"] for f in gj["features"]}
    outlines = {f["properties"]["id"]: (f["properties"]["state"], shape(f["geometry"])) for f in gj["features"]}
    blds, info = load_all()
    print(f"LoD2: {len(blds)} buildings from SL {info['sl_tiles']} + RLP {info['rlp_tiles']} tiles "
          f"[{time.time() - t0:.0f}s]", flush=True)
    by_place = assign(blds, outlines)
    # cross-check: buildings of the other state inside a place (dropped by the state rule)
    alls = assign(blds, outlines, same_state=False)
    other = {pid: len(alls[pid]) - len(by_place[pid]) for pid in outlines}
    per_place = {}
    for pid, bl in by_place.items():
        agg = aggregate(bl)
        agg["other_state_buildings_dropped"] = other[pid]
        per_place[pid] = agg
        print(f"  {pid:22s} {agg['buildings']:6d} bldg, roof {agg['roof_area_m2']} m², suitable "
              f"{agg['suitable_area_m2']} m² ({agg['suitable_share_pct']} %), kWp {agg['kwp']}", flush=True)
    mastr_path = ORTE_WORK / "mastr_pv.json"
    mastr = json.loads(mastr_path.read_text()) if mastr_path.exists() else None
    munis = municipalities(places, per_place, gj["meta"].get("excluded_gemarkungen", []), mastr)
    import buildings as B
    out = {
        "format": FORMAT, "method": METHOD,
        "generated": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "params": {"min_plane_m2": MIN_PLANE_M2, "max_tilt_deg": MAX_TILT_DEG, "flat_deg": FLAT_DEG,
                   "azimuth_ok_deg": [AZ_MIN, AZ_MAX], "setback": SETBACK, "flat_usable": FLAT_USABLE,
                   "kwp_per_m2": list(KWP_PER_M2),
                   "min_buildings": MIN_BUILDINGS},
        "definitions": {
            "roof_area_m2": "Σ inclined area of all LoD2 RoofSurfaces of the place's buildings",
            "suitable_area_m2": "Σ area of suitable planes: ≥ 10 m², tilt ≤ 60°, flat (< 10°) or facing E…S…W",
            "usable_area_m2": "pitched suitable × setback 0.7 (edges, chimneys, dormers, shading) + flat suitable × "
                              "0.4 (row spacing, parapets, skylights)",
            "usable_share_pct": "usable area ÷ all roof area",
            "kwp": "[lo, mid, hi] = usable × 0.15 / 0.18 / 0.20 kWp/m² (Schätzung; no shading or statics check)",
            "suitable_by_orientation_m2": "suitable area by the direction the plane faces (flat, S ±22.5°, SE/SW, "
                                          "E/W); N is never suitable",
            "by_building_class": "ALKIS Gebäudefunktion: residential 31001_1xxx, garage 31001_2463 / 51009_1611, "
                                 "other",
            "used_share_pct": "MaStR Gebäudesolaranlage kWp (in operation) ÷ potential [lo uses hi potential …]; "
                              "only for a municipality whose Gemarkungen are all processed",
        },
        "inputs": {"lod2": info, "outlines": "data/work/orte/gemarkungen.geojson (places.py)",
                   "mastr": "data/work/orte/mastr_pv.json (stats_inputs.py)" if mastr else None},
        "privacy": "aggregates per place / municipality only; nothing per building or plane (G1/G2, ADR 0049)",
        "attribution": [B.ATTRIBUTION_LOD2_SL, B.ATTRIBUTION_LOD2_RLP]
        + ([mastr["source"]["attribution"]] if mastr else []),
        "places": [{"id": pid, "name_de": places[pid]["name_de"], "state": places[pid]["state"], **per_place[pid]}
                   for pid in places],
        "municipalities": munis,
    }
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    tmp.replace(OUT)
    for m in munis:
        print(f"  municipality {m['name_de']}: potential (our places) {m['potential_places_kwp']} kWp, MaStR "
              f"buildings {m['mastr_building_kwp']} kWp, used share {m['used_share_pct']}")
    print(f"wrote {OUT} [{time.time() - t0:.0f}s]")
    return out


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.parse_args(argv)
    run()


if __name__ == "__main__":
    main(sys.argv[1:])
