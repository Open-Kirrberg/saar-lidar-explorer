"""gbif.py (Orte im Vergleich, 🦋 Artenvielfalt): rarefaction maths, WKT orientation, facet parsing, caching (offline)."""
import itertools
import json
import math
import sys
from pathlib import Path

import pytest
import shapely
from shapely.geometry import Polygon, box

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import gbif as G  # noqa: E402


def _brute_rarefy(counts, n):
    """Exact expectation by enumerating every n-subset of the individual records."""
    recs = [i for i, c in enumerate(counts) for _ in range(c)]
    subs = list(itertools.combinations(range(len(recs)), n))
    vals = [len({recs[k] for k in s}) for s in subs]
    mean = sum(vals) / len(vals)
    var = sum((v - mean) ** 2 for v in vals) / len(vals)
    return mean, var


@pytest.mark.parametrize("counts,n", [([3, 2, 1], 2), ([4, 1, 1, 1], 3), ([2, 2, 2, 1], 4), ([5, 1], 1)])
def test_rarefy_and_variance_match_enumeration(counts, n):
    mean, var = _brute_rarefy(counts, n)
    assert G.rarefy(counts, n) == pytest.approx(mean, rel=1e-9)
    assert G.rarefy_var(counts, n) == pytest.approx(var, rel=1e-7, abs=1e-9)


def test_rarefy_edges():
    assert G.rarefy([5, 3, 1], 9) == pytest.approx(3.0)       # the whole sample: every species seen
    assert G.rarefy([5, 3, 1], 1) == pytest.approx(1.0)
    assert G.rarefy([5, 3, 1], 10) is None                    # fewer records than n: not comparable
    assert G.rarefy([0, 0, 4], 2) == pytest.approx(1.0)       # zero counts are ignored
    big = [1] * 400 + [50] * 10                               # 900 records, many singletons
    assert 0 < G.rarefy(big, 500) < 410
    assert G.rarefy_var(big, 500) >= 0


def test_effort_normalisation_ranks_evenness_not_volume():
    # place A: 2000 records of 40 equally common species; place B: 600 records of 120 species
    a, b = [50] * 40, [5] * 120
    assert len(a) < len(b)
    assert G.rarefy(a, 500) < G.rarefy(b, 500)
    # doubling effort (same community) leaves the rarefied value nearly unchanged
    assert G.rarefy([10] * 120, 500) == pytest.approx(G.rarefy([5] * 120, 500), rel=0.05)


def test_chao1_coverage_and_richness_record():
    c = [1, 1, 1, 2, 2, 5]
    assert G.chao1(c) == pytest.approx(6 + 3 * 2 / (2 * 3))
    assert G.goods_coverage(c) == pytest.approx(1 - 3 / 12)
    r = G.richness(c, n=5)
    assert r["species"] == 6 and r["occurrences_species"] == 12 and r["singletons"] == 3 and r["doubletons"] == 2
    lo, mid, hi = r["rarefied"]
    assert lo <= mid <= hi <= 6
    assert G.richness(c, n=50)["rarefied"] is None
    assert G.richness([], n=5)["species_per_100"] is None


def test_year_stats():
    y = G.year_stats({1990: 2, 2014: 3, 2015: 4, 2026: 1})
    assert (y["first"], y["last"], y["years"], y["with_year"]) == (1990, 2026, 4, 10)
    assert y["share_since_2015_pct"] == 50.0
    assert y["by_decade"] == {"1990s": 2, "2010s": 7, "2020s": 1}
    assert G.year_stats({})["first"] is None


def test_wkt_is_wgs84_counter_clockwise_with_holes_dropped():
    outer = Polygon([(380000, 5460000), (380000, 5462000), (382000, 5462000), (382000, 5460000)])  # clockwise
    hole_big = box(380500, 5460500, 380800, 5460800)        # 9 ha → kept
    hole_small = box(381500, 5461500, 381550, 5461550)      # 0.25 ha → dropped
    poly = Polygon(outer.exterior, [hole_big.exterior, hole_small.exterior])
    q = G.query_polygon(poly)
    assert len(q.interiors) == 1
    wkt = G.to_wkt_wgs84(q)
    g = shapely.from_wkt(wkt)
    assert g.exterior.is_ccw and not g.interiors[0].is_ccw
    x0, y0, x1, y1 = g.bounds
    assert 7.0 < x0 < x1 < 7.6 and 49.2 < y0 < y1 < 49.4      # lon lat order, Homburg area
    assert all(len(t.split(".")[1]) <= G.WKT_DECIMALS for t in wkt.replace("(", " ").replace(")", " ")
               .replace(",", " ").split() if "." in t)


def test_place_wkt_simplifies_until_short():
    import numpy as np
    ang = np.linspace(0, 2 * np.pi, 4000, endpoint=False)
    r = 2000 + 30 * np.sin(ang * 97)                          # wiggly outline, many vertices
    poly = Polygon(np.c_[381000 + r * np.cos(ang), 5465000 + r * np.sin(ang)])
    wkt, qp, tol = G.place_wkt(poly, max_chars=1500)
    assert len(wkt) <= 1500 and tol in G.SIMPLIFY_STEPS_M
    assert qp.symmetric_difference(poly).area / poly.area < 0.05


def test_search_url_has_base_filter_limit_zero_and_repeated_facets():
    u = G.search_url({"geometry": "POLYGON((1 2,3 4,1 2))", "facet": ["year", "license"], "facetLimit": 10})
    assert u.startswith(G.API + "/occurrence/search?limit=0&")
    for k, v in G.BASE_FILTER.items():
        assert f"{k}={v}" in u
    assert u.count("facet=") == 2 and "facetLimit=10" in u
    assert "geometry=POLYGON((1+2,3+4,1+2))" in u


def _resp(count, **facets):
    return {"count": count, "facets": [{"field": f, "counts": [{"name": k, "count": v} for k, v in c.items()]}
                                       for f, c in facets.items()]}


def test_place_record_aggregates_only():
    main = _resp(10, YEAR={"2020": 6, "2010": 4}, DATASET_KEY={G.INAT_DATASET: 4, "x": 6},
                 BASIS_OF_RECORD={"HUMAN_OBSERVATION": 10}, LICENSE={"CC_BY_4_0": 10})
    rec = G.place_record("p", "Ort", main, [3, 3, 2, 1], groups=[], datasets=[], n=5, n_small=3,
                         precise=(5, [2, 1]))
    assert rec["occurrences"] == 10 and rec["species"] == 4 and rec["inaturalist"]["share_pct"] == 40.0
    assert rec["years"]["first"] == 2010 and rec["rarefied"] is not None and rec["rarefied_3"] is not None
    assert rec["precise"]["species"] == 2 and rec["precise"]["rarefied"] is None
    assert G.place_record("p", "Ort", main, [1], [], [], n=5)["flags"] == ["few-records"]
    text = json.dumps(rec)
    for bad in ("decimalLatitude", "decimalLongitude", "scientificName", "speciesKey"):
        assert bad not in text


def test_client_caches_and_pages_species_facet(tmp_path, monkeypatch):
    monkeypatch.setattr(G, "FACET_PAGE", 2)
    monkeypatch.setattr(G, "REQUEST_PAUSE_S", 0)
    calls = []
    pages = {0: {"1": 5, "2": 3}, 2: {"3": 2, "4": 1}, 4: {"5": 1}}

    def fake(url):
        calls.append(url)
        off = int(url.split("facetOffset=")[1].split("&")[0])
        return json.dumps(_resp(12, SPECIES_KEY=pages[off])).encode()

    api = G.Gbif(cache=tmp_path, get=fake)
    assert api.species_counts({"geometry": "X"}) == [5, 3, 2, 1, 1]
    assert len(calls) == 3 and api.live == 3
    api2 = G.Gbif(cache=tmp_path, get=lambda u: (_ for _ in ()).throw(AssertionError("network")))
    assert api2.species_counts({"geometry": "X"}) == [5, 3, 2, 1, 1] and api2.cached == 3
    assert math.isclose(sum(api2.species_counts({"geometry": "X"})), 12)
