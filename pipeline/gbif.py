"""Orte im Vergleich, Phase 1: biodiversity counts per place from GBIF (discipline 🦋 *Artenvielfalt*).

Usage:  uv run python gbif.py [--refresh]

Plan: docs/plans/orte-im-vergleich.md §5 (🦋 *Artenvielfalt*), §8 Phase 1. One query family per place against the
GBIF occurrence search API (https://api.gbif.org/v1/occurrence/search, no account, no download): the place outline
(data/work/orte/gemarkungen.geojson, places.py) is simplified (SIMPLIFY_M), holes and parts < 1 ha are dropped and
the result is sent as a counter-clockwise WGS84 WKT `geometry`. Every request is `limit=0` (no records, only the
total `count` and facets), so **no occurrence record, coordinate or name of a sensitive taxon is ever stored**: only
counts per species key (to compute richness), per year, dataset, basis of record and licence.

Filters (all queries): hasCoordinate=true, hasGeospatialIssue=false, occurrenceStatus=PRESENT. iNaturalist
research-grade observations reach GBIF as dataset 50c9509d-22c7-4a22-a47d-8c48425ef4a7 (CC BY-NC per record set).

Measures per place (method `gbif-facets-v1`):
- `occurrences` (all records), `occurrences_species` (records identified to species: the base of every richness
  figure), `species` = distinct GBIF backbone species keys.
- **Effort-normalised richness.** Raw species counts mostly measure how often people looked (observer effort), so the
  comparable figure is the **rarefied richness at n = 500 records** (Hurlbert 1971: the expected number of species in
  a random draw of 500 of the place's species-level records, `rarefy`), with a ±1.96 SD band from Heck et al. 1975
  (`rarefy_var`; sampling noise only, not observer bias). A place with < 500 species-level records gets `null` and
  the flag `few-records`. `species_per_100` (= 100 · species / records) is given for orientation only: it falls as
  effort grows, so it must not be ranked across places of very different effort. Chao1 (bias-corrected) and Good's
  coverage (1 − singletons / records) say how complete the inventory is.
- `years` (first, last, share since 2015), `inaturalist` share, `basis_of_record`, `licence` breakdown,
  `top_datasets` (title + record count, informative) and `groups`: species and records for fixed taxa (`GROUPS`).

Caveats (in the output `meta.caveats`): occurrence records are not individuals; many records are generalised to a
grid or to a place centroid (coordinate uncertainty of km), so near a border they can fall into the neighbour; GBIF
obscures sensitive taxa (e.g. some orchids, birds of prey) to coarse grids. These are biases of a hypothesis, labelled
„Schätzung“ (G7). ADR 0022: the app never calls GBIF; this file is baked at pipeline time.

Cache: every response under data/raw/gbif/<sha1(url)[:20]>.json (+ the URL inside); `--refresh` refetches.
Sequential requests with REQUEST_PAUSE_S between live calls, common.http_open retries, repo User-Agent.

Licence: GBIF occurrence data are CC0 / CC BY 4.0 / CC BY-NC 4.0 per dataset; we publish only aggregate counts and
credit GBIF as „GBIF.org (<date>) GBIF Occurrence Search, https://www.gbif.org“ plus the iNaturalist note.
Output: data/work/orte/gbif_by_place.json (work file; stats.py publishes it later).
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import sys
import time
import urllib.parse
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

import numpy as np

from common import RAW_DIR, WORK_DIR, http_open

API = "https://api.gbif.org/v1"
GBIF_RAW = RAW_DIR / "gbif"
ORTE_WORK = WORK_DIR / "orte"
OUT = ORTE_WORK / "gbif_by_place.json"
FORMAT = "sle-orte-gbif-v1"
METHOD = "gbif-facets-v1"

INAT_DATASET = "50c9509d-22c7-4a22-a47d-8c48425ef4a7"   # iNaturalist Research-grade Observations
BASE_FILTER = {"hasCoordinate": "true", "hasGeospatialIssue": "false", "occurrenceStatus": "PRESENT"}
RAREFY_N = 500
RAREFY_N_SMALL = 150       # secondary depth so the small places (< 500 records) get a comparable value too
PRECISE_UNCERTAINTY = "0,1000"   # robustness variant: only records with coordinateUncertaintyInMeters ≤ 1 km
SIMPLIFY_M = 20.0          # first outline simplification before WKT (the place is km wide)
MAX_WKT_CHARS = 2000       # the API front end answers 400 to URLs of ≈ 4 KB: simplify further until the WKT fits
SIMPLIFY_STEPS_M = (20.0, 30.0, 40.0, 60.0, 80.0, 120.0, 160.0, 200.0)   # > 80 m only for whole Gemeinden (S1)
MIN_RING_HA = 1.0          # holes and parts below this are dropped from the query polygon
WKT_DECIMALS = 5           # ≈ 1 m in WGS84 at 49° N
FACET_PAGE = 1000
REQUEST_PAUSE_S = 0.4
RECENT_YEAR = 2015

# Fixed taxa (GBIF backbone keys, checked 2026-11-08 via /v1/species/<key>: all ACCEPTED). Reptilia is a pro-parte
# synonym in the backbone and is left out. Lepidoptera is a subgroup of Insecta (not exclusive).
GROUPS: tuple[dict[str, Any], ...] = (
    {"id": "plantae", "key": 6, "rank": "kingdom", "name": "Plantae", "label_de": "Pflanzen"},
    {"id": "fungi", "key": 5, "rank": "kingdom", "name": "Fungi", "label_de": "Pilze und Flechten"},
    {"id": "aves", "key": 212, "rank": "class", "name": "Aves", "label_de": "Vögel"},
    {"id": "insecta", "key": 216, "rank": "class", "name": "Insecta", "label_de": "Insekten"},
    {"id": "lepidoptera", "key": 797, "rank": "order", "name": "Lepidoptera", "label_de": "Schmetterlinge",
     "parent": "insecta"},
    {"id": "coleoptera", "key": 1470, "rank": "order", "name": "Coleoptera", "label_de": "Käfer", "parent": "insecta"},
    {"id": "mammalia", "key": 359, "rank": "class", "name": "Mammalia", "label_de": "Säugetiere"},
    {"id": "amphibia", "key": 131, "rank": "class", "name": "Amphibia", "label_de": "Amphibien"},
    {"id": "arachnida", "key": 367, "rank": "class", "name": "Arachnida", "label_de": "Spinnentiere"},
    {"id": "gastropoda", "key": 225, "rank": "class", "name": "Gastropoda", "label_de": "Schnecken"},
)


def attribution(date: str) -> str:
    return f"GBIF.org ({date}) GBIF Occurrence Search, https://www.gbif.org"


INAT_NOTE = ("enthält iNaturalist-Beobachtungen in Forschungsqualität (iNaturalist Research-grade Observations, "
             "über GBIF, CC BY-NC 4.0)")


# =================================================================================================== pure
def query_polygon(geom, *, simplify_m: float = SIMPLIFY_M, min_ring_ha: float = MIN_RING_HA):
    """EPSG:25832 outline → simplified (Multi)Polygon without holes/parts < min_ring_ha (still EPSG:25832)."""
    import shapely
    from shapely.geometry import MultiPolygon, Polygon
    g = shapely.make_valid(geom).simplify(simplify_m, preserve_topology=True)
    parts = []
    for p in shapely.get_parts(g):
        if p.geom_type != "Polygon" or p.area < min_ring_ha * 1e4:
            continue
        holes = [r for r in p.interiors if Polygon(r).area >= min_ring_ha * 1e4]
        parts.append(Polygon(p.exterior, holes))
    if not parts:
        raise ValueError("query_polygon: nothing left after dropping small parts")
    return parts[0] if len(parts) == 1 else MultiPolygon(parts)


def to_wkt_wgs84(geom_25832, decimals: int = WKT_DECIMALS) -> str:
    """EPSG:25832 (Multi)Polygon → WGS84 WKT (lon lat), exterior rings counter-clockwise, holes clockwise, as GBIF
    requires („anticlockwise ordering of points“)."""
    import shapely
    from pyproj import Transformer
    from shapely.geometry import MultiPolygon
    from shapely.geometry.polygon import orient
    t = Transformer.from_crs("EPSG:25832", "EPSG:4326", always_xy=True)
    g = shapely.transform(geom_25832, lambda x, y: t.transform(x, y), interleaved=False)
    g = shapely.set_precision(g, 10 ** -decimals)
    polys = [orient(p, sign=1.0) for p in shapely.get_parts(g) if p.geom_type == "Polygon" and not p.is_empty]
    if not polys:
        raise ValueError("to_wkt_wgs84: empty geometry")
    out = polys[0] if len(polys) == 1 else MultiPolygon(polys)
    return shapely.to_wkt(out, rounding_precision=decimals, trim=True)


def place_wkt(geom, max_chars: int = MAX_WKT_CHARS) -> tuple[str, Any, float]:
    """(WKT, query polygon in EPSG:25832, tolerance used): the least simplification whose WKT ≤ max_chars."""
    for tol in SIMPLIFY_STEPS_M:
        qp = query_polygon(geom, simplify_m=tol)
        w = to_wkt_wgs84(qp)
        if len(w) <= max_chars:
            return w, qp, tol
    raise ValueError(f"outline WKT still {len(w)} chars at {SIMPLIFY_STEPS_M[-1]} m simplification")


def _log_comb(n: np.ndarray | float, k: int) -> np.ndarray:
    """log C(n, k) for n ≥ k (array-safe via lgamma); −inf where n < k."""
    from scipy.special import gammaln
    n = np.asarray(n, np.float64)
    out = np.full(n.shape, -np.inf)
    ok = n >= k
    out[ok] = gammaln(n[ok] + 1) - gammaln(k + 1) - gammaln(n[ok] - k + 1)
    return out


def rarefy(counts: Sequence[int], n: int = RAREFY_N) -> float | None:
    """Hurlbert (1971) expected species in a random subsample of n records: Σ_i 1 − C(N − N_i, n) / C(N, n).
    None when the place has fewer than n records (not comparable). Pure."""
    c = np.asarray([x for x in counts if x > 0], np.float64)
    N = float(c.sum())
    if n <= 0 or N < n:
        return None
    q = np.exp(_log_comb(N - c, n) - _log_comb(np.array([N]), n)[0])
    return float(np.sum(1.0 - q))


def rarefy_var(counts: Sequence[int], n: int = RAREFY_N) -> float | None:
    """Heck et al. (1975) variance of the rarefied richness: Σ q_i (1 − q_i) + 2 Σ_{i<j} (q_ij − q_i q_j) with
    q_i = C(N − N_i, n) / C(N, n), q_ij = C(N − N_i − N_j, n) / C(N, n). Pure (O(S²) memory, S ≤ a few 1000)."""
    c = np.asarray([x for x in counts if x > 0], np.float64)
    N = float(c.sum())
    if n <= 0 or N < n:
        return None
    lc = _log_comb(np.array([N]), n)[0]
    q = np.exp(_log_comb(N - c, n) - lc)
    pair = N - c[:, None] - c[None, :]
    qij = np.exp(_log_comb(pair, n) - lc)
    iu = np.triu_indices(len(c), 1)
    v = float(np.sum(q * (1 - q)) + 2 * np.sum(qij[iu] - (q[:, None] * q[None, :])[iu]))
    return max(v, 0.0)


def chao1(counts: Sequence[int]) -> float:
    """Bias-corrected Chao1: S_obs + f1 (f1 − 1) / (2 (f2 + 1)). Pure."""
    c = [x for x in counts if x > 0]
    f1 = sum(1 for x in c if x == 1)
    f2 = sum(1 for x in c if x == 2)
    return len(c) + f1 * (f1 - 1) / (2 * (f2 + 1))


def goods_coverage(counts: Sequence[int]) -> float | None:
    """1 − singletons / records: the probability that the next record is a species already seen. Pure."""
    c = [x for x in counts if x > 0]
    N = sum(c)
    return None if N == 0 else 1.0 - sum(1 for x in c if x == 1) / N


def year_stats(year_counts: Mapping[int, int], recent: int = RECENT_YEAR) -> dict[str, Any]:
    """First/last year, number of years and the share of records since `recent` (records without a year are not in
    the facet). Pure."""
    yc = {int(y): int(c) for y, c in year_counts.items() if c > 0}
    tot = sum(yc.values())
    if not tot:
        return {"first": None, "last": None, "years": 0, "with_year": 0, f"share_since_{recent}_pct": None,
                "by_decade": {}}
    dec: dict[str, int] = {}
    for y, c in sorted(yc.items()):
        k = f"{y // 10 * 10}s"
        dec[k] = dec.get(k, 0) + c
    return {"first": min(yc), "last": max(yc), "years": len(yc), "with_year": tot,
            f"share_since_{recent}_pct": round(100 * sum(c for y, c in yc.items() if y >= recent) / tot, 1),
            "by_decade": dec}


def richness(counts: Sequence[int], n: int = RAREFY_N) -> dict[str, Any]:
    """All richness figures of one species-count vector (pure). `rarefied` = [lo, mid, hi] (± 1.96 SD) or None."""
    c = [int(x) for x in counts if x > 0]
    N = sum(c)
    r = rarefy(c, n)
    v = rarefy_var(c, n) if r is not None else None
    rare = None
    if r is not None:
        sd = math.sqrt(v or 0.0)
        rare = [round(max(r - 1.96 * sd, 0.0), 1), round(r, 1), round(min(r + 1.96 * sd, len(c)), 1)]
    cov = goods_coverage(c)
    return {"species": len(c), "occurrences_species": N, "rarefied": rare, "rarefy_n": n,
            "species_per_100": round(100 * len(c) / N, 1) if N else None,
            "chao1": round(chao1(c), 0) if c else 0, "coverage": round(cov, 3) if cov is not None else None,
            "singletons": sum(1 for x in c if x == 1), "doubletons": sum(1 for x in c if x == 2)}


def facet_counts(resp: Mapping[str, Any], field: str) -> dict[str, int]:
    """{name: count} of one facet in an occurrence search response (field as GBIF writes it, e.g. 'YEAR')."""
    for f in resp.get("facets") or []:
        if f.get("field") == field:
            return {str(c["name"]): int(c["count"]) for c in f.get("counts") or []}
    return {}


def search_url(params: Mapping[str, Any]) -> str:
    """Occurrence search URL with `limit=0`, the base filter and `params` (list values → repeated keys)."""
    items: list[tuple[str, str]] = [("limit", "0"), *BASE_FILTER.items()]
    for k, v in params.items():
        for x in (v if isinstance(v, (list, tuple)) else [v]):
            items.append((k, str(x)))
    return f"{API}/occurrence/search?" + urllib.parse.urlencode(items, safe=",()")


def place_record(pid: str, name: str, main: Mapping[str, Any], species_counts: Sequence[int],
                 groups: Sequence[Mapping[str, Any]], datasets: Sequence[Mapping[str, Any]],
                 n: int = RAREFY_N, n_small: int = RAREFY_N_SMALL,
                 precise: tuple[int, Sequence[int]] | None = None) -> dict[str, Any]:
    """Assemble one place's aggregate record from the facet responses (pure; no names of species, no points).
    `precise` = (total, species counts) of the ≤ 1 km coordinate-uncertainty variant."""
    total = int(main.get("count") or 0)
    rich = richness(species_counts, n)
    rich[f"rarefied_{n_small}"] = richness(species_counts, n_small)["rarefied"]
    ds = facet_counts(main, "DATASET_KEY")
    inat = ds.get(INAT_DATASET, 0)
    flags = []
    if rich["rarefied"] is None:
        flags.append("few-records")
    return {
        "id": pid, "name_de": name, "occurrences": total, **rich,
        "years": year_stats({int(k): v for k, v in facet_counts(main, "YEAR").items()}),
        "inaturalist": {"occurrences": inat, "share_pct": round(100 * inat / total, 1) if total else None},
        "basis_of_record": facet_counts(main, "BASIS_OF_RECORD"),
        "licence": facet_counts(main, "LICENSE"),
        "top_datasets": list(datasets),
        "groups": list(groups),
        **({"precise": {"occurrences": int(precise[0]),
                        **{k: v for k, v in richness(precise[1], n).items()
                           if k in ("species", "occurrences_species", "rarefied", "species_per_100")},
                        f"rarefied_{n_small}": richness(precise[1], n_small)["rarefied"]}} if precise else {}),
        "flags": flags,
    }


# =================================================================================================== I/O
class Gbif:
    """Cached, sequential GET of GBIF API JSON (one file per URL under data/raw/gbif/)."""

    def __init__(self, cache: Path = GBIF_RAW, refresh: bool = False, get: Callable[[str], bytes] | None = None):
        self.cache, self.refresh = cache, refresh
        self.get = get or self._http
        self.live = self.cached = 0
        self.dates: set[str] = set()

    @staticmethod
    def _http(url: str) -> bytes:
        with http_open(url, headers={"Accept": "application/json"}, timeout=120) as r:
            return r.read()

    def json(self, url: str) -> dict[str, Any]:
        self.cache.mkdir(parents=True, exist_ok=True)
        f = self.cache / (hashlib.sha1(url.encode()).hexdigest()[:20] + ".json")
        if f.exists() and not self.refresh:
            d = json.loads(f.read_text())
            self.cached += 1
        else:
            if self.live:
                time.sleep(REQUEST_PAUSE_S)
            body = json.loads(self.get(url))
            d = {"url": url, "fetched": dt.date.today().isoformat(), "body": body}
            tmp = f.with_suffix(".tmp")
            tmp.write_text(json.dumps(d, separators=(",", ":")))
            tmp.replace(f)
            self.live += 1
        self.dates.add(d["fetched"])
        return d["body"]

    def species_counts(self, params: Mapping[str, Any]) -> list[int]:
        """Records per species key (all of them, paged with facetOffset)."""
        out: list[int] = []
        off = 0
        while True:
            r = self.json(search_url({**params, "facet": "speciesKey", "facetLimit": FACET_PAGE,
                                      "facetOffset": off}))
            page = list(facet_counts(r, "SPECIES_KEY").values())
            out += page
            if len(page) < FACET_PAGE:
                return out
            off += FACET_PAGE

    def dataset_title(self, key: str) -> str:
        try:
            return str(self.json(f"{API}/dataset/{key}").get("title") or key)
        except Exception:  # noqa: BLE001 – a title is informative only
            return key


def place_query(pid: str, name: str, wkt: str, api: Gbif, n: int = RAREFY_N) -> dict[str, Any]:
    base = {"geometry": wkt}
    main = api.json(search_url({**base, "facet": ["year", "datasetKey", "basisOfRecord", "license"],
                                "facetLimit": 300}))
    counts = api.species_counts(base)
    groups = []
    for g in GROUPS:
        gp = {**base, "taxonKey": g["key"]}
        tot = api.json(search_url(gp))
        sc = api.species_counts(gp)
        groups.append({"id": g["id"], "label_de": g["label_de"], "taxon": g["name"], "rank": g["rank"],
                       "gbif_key": g["key"], **({"parent": g["parent"]} if "parent" in g else {}),
                       "occurrences": int(tot.get("count") or 0), "species": len([c for c in sc if c > 0]),
                       "occurrences_species": int(sum(sc))})
    ds = sorted(facet_counts(main, "DATASET_KEY").items(), key=lambda kv: -kv[1])[:5]
    datasets = [{"key": k, "title": api.dataset_title(k), "occurrences": c} for k, c in ds]
    pp = {**base, "coordinateUncertaintyInMeters": PRECISE_UNCERTAINTY}
    precise = (int(api.json(search_url(pp)).get("count") or 0), api.species_counts(pp))
    return place_record(pid, name, main, counts, groups, datasets, n, precise=precise)


def load_places(path: Path = ORTE_WORK / "gemarkungen.geojson") -> list[tuple[str, str, Any]]:
    from shapely.geometry import shape
    d = json.loads(path.read_text())
    return [(f["properties"]["id"], f["properties"]["name_de"], shape(f["geometry"])) for f in d["features"]]


def run(refresh: bool = False, places_path: Path | None = None, out: Path | None = None) -> dict[str, Any]:
    """`places_path` / `out` default to the Ortsteile set (gemarkungen.geojson → gbif_by_place.json); the S1
    Gemeinde level passes its outlines (gemeinden.py)."""
    api = Gbif(refresh=refresh)
    places = []
    OUT_ = out or OUT
    for pid, name, geom in load_places(places_path or ORTE_WORK / "gemarkungen.geojson"):
        wkt, qp, tol = place_wkt(geom)
        t0 = time.time()
        rec = place_query(pid, name, wkt, api)
        rec["query"] = {"vertices": int(sum(len(p.exterior.coords) + sum(len(r.coords) for r in p.interiors)
                                            for p in getattr(qp, "geoms", [qp]))),
                        "wkt_chars": len(wkt), "simplify_m": tol, "area_ha": round(qp.area / 1e4, 1),
                        "area_change_pct": round(100 * (qp.area - geom.area) / geom.area, 2),
                        "symdiff_pct": round(100 * qp.symmetric_difference(geom).area / geom.area, 2)}
        rec["occurrences_per_km2"] = round(rec["occurrences"] / (geom.area / 1e6), 1)
        places.append(rec)
        print(f"  {pid:22s} {rec['occurrences']:7d} rec, {rec['species']:5d} spp, rarefied@{RAREFY_N} "
              f"{rec['rarefied']}, iNat {rec['inaturalist']['share_pct']} %, {rec['years']['first']}–"
              f"{rec['years']['last']} [{time.time() - t0:.1f}s]", flush=True)
    date = max(api.dates) if api.dates else dt.date.today().isoformat()
    doc = {
        "format": FORMAT, "generated": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
        .replace("+00:00", "Z"), "method": METHOD, "query_date": date,
        "source": {"api": f"{API}/occurrence/search", "filters": BASE_FILTER,
                   "geometry": f"place outline (places.py) simplified {SIMPLIFY_M:g}–{SIMPLIFY_STEPS_M[-1]:g} m (least that "
                               f"keeps the WKT ≤ {MAX_WKT_CHARS} chars), holes/parts < "
                               f"{MIN_RING_HA:g} ha dropped, WGS84 WKT counter-clockwise, {WKT_DECIMALS} decimals",
                   "inaturalist_dataset": INAT_DATASET, "requests": {"live": api.live, "cached": api.cached}},
        "params": {"rarefy_n": RAREFY_N, "rarefy_n_small": RAREFY_N_SMALL,
                   "precise_uncertainty_m": PRECISE_UNCERTAINTY, "recent_year": RECENT_YEAR, "groups": [g["id"] for g in GROUPS]},
        "definitions": {
            "species": "distinct GBIF backbone speciesKey among records identified to species (or below)",
            "rarefied": f"[lo, mid, hi]: Hurlbert expected species in {RAREFY_N} random species-level records; "
                        "± 1.96 SD (Heck 1975, sampling noise only). null when the place has fewer records. "
                        "The comparable figure across places (effort-normalised).",
            f"rarefied_{RAREFY_N_SMALL}": f"as rarefied at {RAREFY_N_SMALL} records: secondary, covers the small "
                                          "places too (wider relative noise, less discriminating)",
            "precise": "robustness variant: only records with coordinateUncertaintyInMeters 0–1000 (drops eBird "
                       "and other records without an uncertainty, and grid-generalised records)",
            "species_per_100": "species per 100 species-level records; falls with effort, orientation only",
            "chao1": "bias-corrected Chao1 estimate of total richness (records as abundance; Schätzung)",
            "coverage": "Good's coverage 1 − singletons/records",
            "groups": "species and records per fixed taxon (taxonKey incl. descendants); Lepidoptera and "
                      "Coleoptera are subgroups of Insecta",
        },
        "caveats": [
            "records are observations, not individuals; observer effort differs strongly between places",
            "many records are generalised to a grid or place centroid (km uncertainty) and may fall into a "
            "neighbouring place",
            "GBIF obscures sensitive taxa to coarse grids; only counts are kept here, never coordinates or names",
            "rarefied richness still depends on what was recorded: bird-list datasets (eBird, Birda) add many "
            "records of few species and lower it; insect- and plant-rich iNaturalist samples raise it",
            "the ≤ 1 km variant (`precise`) changes ranks (e.g. Homburg 242 → 173 at n = 500): read the board as a "
            "rough hint, not a measurement (G7)",
        ],
        "licence": "GBIF records are CC0 1.0, CC BY 4.0 or CC BY-NC 4.0 per dataset (breakdown per place in "
                   "`licence`); only aggregate counts are published",
        "attribution": [attribution(date)], "attribution_note_de": INAT_NOTE,
        "places": places,
    }
    OUT_.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT_.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    tmp.replace(OUT_)
    print(f"wrote {OUT_} ({OUT_.stat().st_size / 1024:.1f} KB); requests live {api.live}, cached {api.cached}")
    return doc


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--refresh", action="store_true", help="refetch every GBIF response (ignore the cache)")
    a = ap.parse_args(argv)
    run(refresh=a.refresh)


if __name__ == "__main__":
    main(sys.argv[1:])
