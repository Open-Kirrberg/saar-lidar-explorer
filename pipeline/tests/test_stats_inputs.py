"""Pure parts of stats_inputs.py (Orte im Vergleich, Phase 0 inputs): NDVI maths and band order, grid slicing,
RLP/SL metadata parsing, Zensus cell parsing and EPSG:3035 → 25832 transform, MaStR aggregation (no network)."""
import io
import json
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import stats_inputs as S  # noqa: E402


# --- NDVI maths ------------------------------------------------------------------------------------

def test_ndvi_formula_and_zero_denominator():
    nir = np.array([200, 100, 50, 0], np.uint8)
    red = np.array([50, 100, 150, 0], np.uint8)
    out = S.ndvi(nir, red)
    assert out[:3] == pytest.approx([0.6, 0.0, -0.5])
    assert np.isnan(out[3])
    assert out.dtype == np.float32


def test_ndvi_no_uint8_overflow():
    out = S.ndvi(np.array([255], np.uint8), np.array([255], np.uint8))
    assert out[0] == 0.0  # 255 + 255 must not wrap around in uint8


def test_cir_band_order_nir_red_green():
    # A vegetation pixel in a CIR image is bright in channel 0 (NIR), dark in channel 1 (red): NDVI > 0.5.
    veg = np.array([[[200, 40, 60, 255]]], np.uint8)
    roof = np.array([[[110, 120, 115, 255]]], np.uint8)
    for px, lo, hi in ((veg, 0.5, 1.0), (roof, -0.2, 0.15)):
        nir, red = S.cir_nir_red(px)
        assert lo < S.ndvi(nir, red)[0, 0] < hi


def test_rgbi_band_order_red_is_first_nir_is_fourth():
    bands = np.zeros((4, 1, 1), np.uint8)
    bands[:, 0, 0] = (30, 80, 40, 210)  # R, G, B, NIR of a leaf
    nir, red = S.rgbi_nir_red(bands)
    assert nir[0, 0] == 210 and red[0, 0] == 30
    assert S.ndvi(nir, red)[0, 0] == pytest.approx(0.75)


def test_encode_decode_round_trip_and_nodata():
    nd = np.array([0.734, -0.2, 1.0, -1.0, np.nan, 0.5], np.float32)
    valid = np.array([True, True, True, True, True, False])
    enc = S.encode_ndvi(nd, valid)
    assert enc.dtype == np.int8
    assert enc.tolist() == [73, -20, 100, -100, S.NDVI_NODATA, S.NDVI_NODATA]
    dec = S.decode_ndvi(enc)
    assert dec[:4] == pytest.approx([0.73, -0.2, 1.0, -1.0])
    assert np.isnan(dec[4:]).all()


def test_block_mean_exact_and_rejects_bad_shape():
    a = np.arange(100, dtype=np.uint8).reshape(10, 10)
    m = S.block_mean(a, 5)
    assert m.shape == (2, 2)
    assert m[0, 0] == pytest.approx(a[:5, :5].mean())
    assert m[1, 1] == pytest.approx(a[5:, 5:].mean())
    with pytest.raises(ValueError):
        S.block_mean(np.zeros((7, 10)), 5)


def test_reduce_rgbi_masks_cells_with_fill_pixels():
    b = np.full((4, 10, 10), 100, np.uint8)
    b[:, 0, 0] = 0          # one black fill pixel in the top-left 5 × 5 block
    b[:, 9, 9] = 255        # one white fill pixel in the bottom-right block
    b[3, 5:, :5] = 200      # NIR brighter in the bottom-left block
    mean, ok = S.reduce_rgbi(b)
    assert mean.shape == (4, 2, 2)
    assert ok.tolist() == [[False, True], [True, False]]
    assert (mean[:, 0, 0] == 0).all()
    assert mean[3, 1, 0] == 200 and mean[0, 1, 0] == 100


def test_rgbi_valid_requires_all_bands_fill():
    b = np.zeros((4, 1, 3), np.uint8)
    b[:, 0, 1] = (0, 0, 0, 5)  # dark but NIR > 0 → imagery
    b[:, 0, 2] = 255
    assert S.rgbi_valid(b).tolist() == [[False, True, False]]


# --- grid ------------------------------------------------------------------------------------------

def test_tile_slices_north_up():
    bbox = (375000, 5453000, 387000, 5471000)
    rs, cs = S.tile_slices(bbox, 375, 5470)  # top-left tile
    assert (rs.start, rs.stop, cs.start, cs.stop) == (0, 1000, 0, 1000)
    rs, cs = S.tile_slices(bbox, 386, 5453)  # bottom-right tile
    assert (rs.start, rs.stop, cs.start, cs.stop) == (17000, 18000, 11000, 12000)
    rs, cs = S.tile_slices(bbox, 380, 5462, 2000)
    assert (rs.start, cs.start) == (5471000 - 5464000, 5000)


@pytest.mark.parametrize("t,expected", [((381, 5463), (380, 5462)), ((380, 5462), (380, 5462)),
                                        ((375, 5453), (374, 5452))])
def test_rlp_tile_of(t, expected):
    assert S.rlp_tile_of(*t) == expected


def test_overlap_candidates_prefers_most_rlp_place_quadrants():
    sl_full = [(382, 5460), (383, 5460), (383, 5461), (380, 5458), (381, 5458), (378, 5456)]
    rlp_place = {(382, 5460), (383, 5460), (383, 5461), (380, 5458), (381, 5458)}
    assert S.overlap_candidates(sl_full, rlp_place, 2) == [(382, 5460), (380, 5458)]
    assert S.overlap_candidates(sl_full, rlp_place, 0) == []
    assert S.overlap_candidates(sl_full, set(), 3) == []


def test_needed_tiles_union_and_fallback():
    places = {"meta": {"tiles_needed_list": {"SL": [[380, 5462], [381, 5462]], "RLP": [[381, 5462], [385, 5460]]}}}
    tiles = S.needed_tiles(places, (375000, 5453000, 387000, 5471000))
    assert set(tiles) == {(380, 5462), (381, 5462), (385, 5460)}
    assert tiles[0][1] == 5462  # north first
    assert len(S.needed_tiles(None, (380000, 5460000, 382000, 5463000))) == 6


# --- metadata parsing --------------------------------------------------------------------------------

def test_parse_rlp_index_prefers_newest_year():
    html = ('<a href="dop20rgbi_32_384_5462_2_rp_2023.jp2">dop20rgbi_32_384_5462_2_rp_2023.jp2</a>'
            '<a href="dop20rgbi_32_384_5462_2_rp_2025.jp2">x</a><a href="dop20rgbi_32_386_5462_2_rp_2023.j2w">w</a>'
            '<a href="dop20rgbi_32_386_5464_2_rp_2023.jp2">y</a>')
    idx = S.parse_rlp_index(html)
    assert idx == {(384, 5462): "dop20rgbi_32_384_5462_2_rp_2025.jp2",
                   (386, 5464): "dop20rgbi_32_386_5464_2_rp_2023.jp2"}


def test_parse_rlp_met_creation_date():
    xml = """<gmd:date><gmd:CI_Date><gmd:date>
        <gco:Date>2023-06-25</gco:Date>
      </gmd:date>
      <gmd:dateType>
        <gmd:CI_DateTypeCode codeList="http://x#CI_DateTypeCode" codeListValue="creation">creation</gmd:CI_DateTypeCode>
      </gmd:dateType></gmd:CI_Date></gmd:date>
      <gmd:editionDate>
        <gco:Date>2023</gco:Date></gmd:editionDate>"""
    assert S.parse_rlp_met(xml) == {"creation": "2023-06-25", "edition": "2023"}


def test_parse_sl_dop_info():
    html = ("<tr><td>Name</td><td>dop20rgbi_32_380_5462_2_sl_2025</td></tr>\n<tr><td>Titel</td><td>Kirrberg</td></tr>"
            "<tr><td>Aktualisierung</td><td>10.05.2025</td></tr>")
    assert S.parse_sl_dop_info(html) == {"name": "dop20rgbi_32_380_5462_2_sl_2025", "title": "Kirrberg",
                                         "updated": "2025-05-10"}
    assert S.parse_sl_dop_info("<p>nothing</p>")["updated"] is None


def test_class_medians():
    nd = np.array([[0.1, 0.2, np.nan], [0.7, 0.8, 0.9]], np.float32)
    m = S.class_medians(nd, {"a": np.array([[1, 1, 1], [0, 0, 0]], bool), "b": np.zeros((2, 3), bool)})
    assert m["a"]["n"] == 2 and m["a"]["median"] == pytest.approx(0.15)
    assert m["b"] == {"n": 0}


def test_quantile_table_maps_shifted_distribution():
    rng = np.random.default_rng(0)
    ref = rng.normal(0.38, 0.1, 20000)
    src = ref * 1.2 + 0.05                      # brighter, stretched product
    tab = S.quantile_table(src, ref, step=5)
    assert tab["q"][0] == 0 and tab["q"][-1] == 100 and len(tab["src"]) == 21
    mapped = S.apply_quantile_table(src, tab)
    assert np.median(mapped) == pytest.approx(np.median(ref), abs=0.005)
    assert np.std(mapped) == pytest.approx(np.std(ref), abs=0.01)
    x = np.array([np.nan, -5.0, 5.0])
    out = S.apply_quantile_table(x, tab)
    assert np.isnan(out[0]) and out[1] == pytest.approx(tab["ref"][0]) and out[2] == pytest.approx(tab["ref"][-1])


def test_apply_quantile_table_handles_flat_segments():
    tab = {"q": [0, 50, 100], "src": [0.0, 0.0, 1.0], "ref": [0.1, 0.2, 0.9]}
    out = S.apply_quantile_table(np.array([0.0, 0.5, 1.0]), tab)
    assert np.all(np.diff(out) >= 0) and out[-1] == pytest.approx(0.9)


def test_merge_inputs_unions_attribution():
    a = S.merge_inputs(None, "ndvi", {"attribution": ["A", "B"]})
    b = S.merge_inputs(a, "mastr", {"attribution": ["B", "C"]})
    c = S.merge_inputs(b, "ndvi", {"attribution": ["A"]})
    assert b["attribution"] == ["A", "B", "C"]
    assert c["attribution"] == ["A", "B", "C"]  # B still used by mastr
    assert c["format"] == "sle-orte-inputs-v1" and set(c["sources"]) == {"ndvi", "mastr"}


# --- Zensus ------------------------------------------------------------------------------------------

@pytest.mark.parametrize("s,v", [("12", 12), ("–", 0), ("-", 0), ("", None), ("x", None), ("1.234", 1234)])
def test_parse_zensus_value(s, v):
    assert S.parse_zensus_value(s) == v


def test_grid_id_centre():
    assert S.grid_id_centre("CRS3035RES100mN2923000E4123200") == (4123250.0, 2923050.0)
    with pytest.raises(ValueError):
        S.grid_id_centre("CRS3035RES1000mN2923000E4123200")


def test_laea_to_utm_known_point_round_trip():
    # Homburg area: EPSG:25832 (381000, 5462000) → EPSG:3035 and back within 1 mm.
    x, y = S.utm_to_laea().transform(381000.0, 5462000.0)
    assert 4.1e6 < x < 4.2e6 and 2.9e6 < y < 2.95e6
    e, n = S.cells_to_utm([x], [y])
    assert e[0] == pytest.approx(381000.0, abs=1e-3) and n[0] == pytest.approx(5462000.0, abs=1e-3)


def test_laea_filter_box_contains_bbox_corners():
    bbox = (375000, 5453000, 387000, 5471000)
    x0, y0, x1, y1 = S.laea_filter_box(bbox, 1000)
    tr = S.utm_to_laea()
    for e in (374000, 388000):
        for n in (5452000, 5472000):
            x, y = tr.transform(e, n)
            assert x0 <= x <= x1 and y0 <= y <= y1


def test_read_and_merge_zensus():
    bbox = (380000, 5460000, 382000, 5462000)
    # a cell id near (381000, 5461000) and one far away
    x, y = S.utm_to_laea().transform(381000.0, 5461000.0)
    cx, cy = int(x // 100 * 100), int(y // 100 * 100)
    near = f"CRS3035RES100mN{cy}E{cx}"
    far = "CRS3035RES100mN2800000E4000000"
    pop = (f"GITTER_ID_100m;x_mp_100m;y_mp_100m;Einwohner\n{near};{cx + 50};{cy + 50};42\n"
           f"{far};4000050;2800050;7\n")
    dw = f"﻿GITTER_ID_100m;x_mp_100m;y_mp_100m;Insgesamt_Wohnungen;FreiEFH\n{near};{cx + 50};{cy + 50};–;3\n"
    box = S.laea_filter_box(bbox, 0)
    t1 = S.read_zensus_csv(io.StringIO(pop), {"einwohner": "Einwohner"}, box)
    t2 = S.read_zensus_csv(io.StringIO(dw), {"wohnungen": "Insgesamt_Wohnungen"}, box)
    assert set(t1) == {near} and t1[near]["einwohner"] == 42
    rows = S.merge_zensus({"p": t1, "d": t2}, bbox, 0, ["einwohner", "wohnungen"])
    assert len(rows) == 1
    r = rows[0]
    assert r["gitter_id"] == near and r["einwohner"] == 42 and r["wohnungen"] == 0
    assert abs(r["e"] - 381000) < 100 and abs(r["n"] - 5461000) < 100
    with pytest.raises(KeyError):
        S.read_zensus_csv(io.StringIO(pop), {"x": "Missing"}, box)


# --- MaStR -------------------------------------------------------------------------------------------

def _row(i, kw, *, status=35, year=2024, art="Gebäudesolaranlage", lat=None, lon=None):
    ms = int(np.datetime64(f"{year}-06-01", "ms").astype(np.int64))
    return {"MaStRNummer": f"SEE{i}", "BetriebsStatusId": status,
            "BetriebsStatusName": "In Betrieb" if status == 35 else "In Planung",
            "Bruttoleistung": kw, "Nettonennleistung": kw * 0.9, "InbetriebnahmeDatum": f"/Date({ms})/",
            "DatumLetzteAktualisierung": f"/Date({ms})/", "ArtDerSolaranlageBezeichnung": art,
            "Breitengrad": lat, "Laengengrad": lon, "AnlagenbetreiberName": "Erika Mustermann"}


def test_mastr_date():
    assert str(S.mastr_date("/Date(1541376000000)/")) == "2018-11-05"
    assert S.mastr_date(None) is None and S.mastr_date("2020-01-01") is None


def test_mastr_url_filter_is_encoded():
    u = S.mastr_url("10045114", 2)
    assert "page=2" in u and "pageSize=1000" in u
    assert "Gemeindeschl%C3%BCssel~eq~%2710045114%27~and~Energietr%C3%A4ger~eq~%272495%27" in u


def test_slim_row_drops_operator_names():
    r = S.slim_row(_row(1, 5.0) | {"Strasse": "Hauptstr.", "AnlagenbetreiberMaskedName": "x"})
    assert "AnlagenbetreiberName" not in r and "Strasse" not in r and "AnlagenbetreiberMaskedName" not in r
    assert r["Bruttoleistung"] == 5.0


def test_aggregate_pv_totals_split_balcony_years_places():
    rows = [
        _row(1, 9.9, year=2022),
        _row(2, 0.8, year=2024, art="Steckerfertige Solaranlage (sog. Balkonkraftwerk)"),
        _row(3, 29.99, year=2024),
        _row(4, 30.0, year=2023, lat=49.3, lon=7.3),
        _row(5, 750.0, year=2023, art="Freiflächensolaranlage", lat=49.2, lon=7.4),
        _row(6, 100.0, year=2023),                       # ≥ 30 kW without coordinates
        _row(7, 50.0, status=31, year=2025),              # in planning: not in totals
        _row(8, 5.0, year=1939),                          # implausible commissioning year
    ]
    agg = S.aggregate_pv(rows, assign=lambda lat, lon: "a" if lat > 49.25 else None)
    assert agg["status"] == {"In Betrieb": 7, "In Planung": 1}
    assert agg["in_operation"] == {"units": 7, "kwp": 925.69, "net_kw": pytest.approx(833.12, abs=0.01)}
    assert agg["lt_30kw"] == {"units": 4, "kwp": 45.69}
    assert agg["ge_30kw"] == {"units": 3, "kwp": 880.0}
    assert agg["balcony"] == {"units": 1, "kwp": 0.8}
    assert agg["ge_30kw_with_coordinates"] == {"units": 2, "kwp": 780.0}
    assert agg["ge_30kw_per_place"] == {"a": {"units": 1, "kwp": 30.0, "small_n": True},
                                        "outside_places": {"units": 1, "kwp": 750.0, "small_n": True}}
    years = agg["by_commissioning_year"]
    assert list(years) == ["1939", "2022", "2023", "2024"]
    assert years["2024"] == {"units": 2, "kwp": 30.79, "balcony": 1}
    assert agg["commissioned_before_1990"] == 1
    assert agg["by_type"]["Freiflächensolaranlage"] == {"units": 1, "kwp": 750.0}
    assert "Erika" not in json.dumps(agg)  # never operator names


def test_aggregate_pv_without_assigner_and_empty():
    agg = S.aggregate_pv([_row(1, 40.0, lat=49.3, lon=7.3)])
    assert agg["ge_30kw_per_place"] == {} and agg["ge_30kw_with_coordinates"]["units"] == 1
    empty = S.aggregate_pv([])
    assert empty["in_operation"]["units"] == 0 and empty["last_update_in_data"] is None


def test_place_assigner_point_in_outline():
    from pyproj import Transformer
    from shapely.geometry import box, mapping
    places = {"features": [{"properties": {"id": "p"}, "geometry": mapping(box(380000, 5460000, 382000, 5462000))}]}
    lon, lat = Transformer.from_crs("EPSG:25832", "EPSG:4326", always_xy=True).transform(381000, 5461000)
    assign = S.place_assigner(places)
    assert assign(lat, lon) == "p"
    assert assign(lat + 0.1, lon) is None
    assert S.place_assigner(None) is None
