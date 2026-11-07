"""Orte im Vergleich, Phase 0: new stats inputs (NDVI, Zensus 2022 grid, MaStR PV totals).

Plan: docs/plans/orte-im-vergleich.md (§5 disciplines, §8 Phase 0 "New inputs", Q2/Q7/Q10). Area: the `[orte]`
stats bbox in aois.toml (written by places.py). Only the 1 km tiles listed in
data/work/orte/gemarkungen.geojson `meta.tiles_needed_list` (place outlines + 200 m) get NDVI.

Usage:  uv run python stats_inputs.py {ndvi|zensus|mastr|all} [--workers 2] [--keep-jp2] [--overlap-tiles 2]
                                      [--refresh-mastr]

1. `ndvi` (method `ndvi-cir-v1`): NDVI = (NIR − R) / (NIR + R) on the 1 m grid of the stats bbox.
   - Saarland: WMS `sl_dop20_cir` (https://geoportal.saarland.de/freewms/truedop, DOP20 2025, dl-de/by-2-0),
     GetMap 1.3.0 in EPSG:25832, one 1000 × 1000 px PNG per 1 km tile (1 m/px), TRANSPARENT so alpha 0 marks
     "no SL imagery" (the service is clipped at the state border). CIR channel order is NIR, R, G (capabilities
     abstract; checked numerically: vegetation > roofs). The flight date per 2 km DOP tile comes from
     GetFeatureInfo on `sl_dop_info` ("Aktualisierung").
   - Rheinland-Pfalz (only where the SL alpha is not 255): open DOP20 RGBI tiles
     https://geobasis-rlp.de/data/dop20rgbi/current/jp2/dop20rgbi_32_<E_km>_<N_km>_2_rp_<year>.jp2 (2 × 2 km,
     20 cm, 4 bands R, G, B, NIR, lossless JPEG 2000, ≈ 170 MB). Each tile is downloaded once (sequentially),
     reduced to a 1 m RGBI GeoTIFF (exact 5 × 5 area mean on the 20 cm grid, ≈ 10 MB) under
     data/raw/ndvi/rlp/rgbi_1m/, and the JP2 is deleted unless --keep-jp2 (range reads of a coarse JP2 level
     were tried: 400+ scattered requests per tile, less polite than one sequential GET). The flight date is the
     `creation` date in the tile's .met (ISO 19139) file.
   - SL coverage comes in whole 2 km DOP tiles and reaches well into RLP (tiles "Mörsbach-Süd", "Bechhofen",
     "Eichelscheid" …), so most of Mörsbach and Bechhofen is imaged by the SL 2025 flight. For a cross-check,
     `--overlap-tiles` (default 2) extra RLP tiles under SL coverage in RLP places are reduced too and the
     NDVI of both products is compared on the same pixels (ndvi.json `checks.sl_rlp_overlap`).
   - Per pixel: SL over RLP. Output data/work/orte/ndvi.tif (int8, NDVI × 100, nodata −128, scale 0.01) and
     ndvi_src.tif (uint8: 0 none, 1 SL WMS, 2 RLP DOP), plus ndvi.json (dates, tiles, sanity checks, the SL/RLP
     offset in the overlap). Both DOPs are 8-bit display products, so this is a relative "pseudo-NDVI", not the
     0.7–0.9 of calibrated reflectance. Measured 2026-11-07 over the overall AOI (SL): LoD2 roof cores median
     0.00, canopy ≥ 15 m median 0.37 (p10–p90 0.26–0.52). RLP spreads wider (5–95 %: −0.05…0.58 vs SL
     0.01…0.51 on 8 M shared pixels), so ndvi.json carries an RLP → SL quantile map for cross-source comparisons.
2. `zensus`: Zensus 2022 100 m grid (Destatis "Gitterdaten", dl-de/by-2-0): population, dwellings
   (Insgesamt_Wohnungen) and buildings with living space by number of dwellings. ZIPs cached in
   data/raw/zensus2022/; CSVs are read straight from the ZIP. Cells whose centre lies in the stats bbox + 1 km
   are written with their EPSG:3035 centre and the transformed EPSG:25832 centre to
   data/work/orte/zensus_100m.csv (+ zensus.json with the licence text quoted from the bundled description).
3. `mastr`: Marktstammdatenregister (Bundesnetzagentur, dl-de/by-2-0), solar units of Homburg (10045114),
   Zweibrücken (07320000) and Bechhofen (07340203) from the public web UI JSON endpoint
   (`GetErweiterteOeffentlicheEinheitStromerzeugung`, filter Gemeindeschlüssel + Energieträger 2495), paged,
   sequential, cached in data/raw/mastr/solar_<AGS>/ with a field whitelist (no operator names, no street or
   parcel). Output data/work/orte/mastr_pv.json: per municipality totals (operating units, kWp, < 30 kW vs
   ≥ 30 kW, balcony plants, per commissioning year, per installation type) and the ≥ 30 kW units with
   coordinates aggregated per place outline (counts and kWp only, never points; G1/G2).

Every source's attribution string is merged into data/work/orte/inputs.json (`attribution`, `sources.<key>`),
which stats.py reads.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import os
import re
import sys
import time
import urllib.parse
import zipfile
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from common import RAW_DIR, WORK_DIR, USER_AGENT, fmt_bytes, http_open, load_aoi

AOI_KEY = "orte"
ORTE_WORK = WORK_DIR / "orte"
INPUTS_JSON = ORTE_WORK / "inputs.json"
PLACES_GEOJSON = ORTE_WORK / "gemarkungen.geojson"
OVERALL_WORK = WORK_DIR / "overall"

# ------------------------------------------------------------------------------------------------ NDVI constants
NDVI_METHOD = "ndvi-cir-v1"
NDVI_RAW = RAW_DIR / "ndvi"
SL_WMS = "https://geoportal.saarland.de/freewms/truedop"
SL_CIR_LAYER = "sl_dop20_cir"
SL_INFO_LAYER = "sl_dop_info"
RLP_JP2_BASE = "https://geobasis-rlp.de/data/dop20rgbi/current/jp2/"
NDVI_SCALE = 100          # stored value = round(NDVI × 100)
NDVI_NODATA = -128
SRC_NONE, SRC_SL, SRC_RLP = 0, 1, 2
TILE_M = 1000             # stats tiles (1 km)
RLP_TILE_M = 2000         # RLP DOP tiles (2 km)
RLP_FACTOR = 5            # 20 cm → 1 m
ATTRIBUTION_DOP_SL = "© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (DOP20 CIR)"
ATTRIBUTION_DOP_RLP = ("© GeoBasis-DE/LVermGeoRP (2026), dl-de/by-2-0, www.lvermgeo.rlp.de, "
                       "Daten bearbeitet (DOP20 RGBI)")

# ------------------------------------------------------------------------------------------------ Zensus constants
ZENSUS_RAW = RAW_DIR / "zensus2022"
ZENSUS_BASE = "https://www.destatis.de/static/DE/zensus/gitterdaten/"
ZENSUS_PAGE = "https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Bevoelkerung/Zensus2022/_inhalt.html"
# table key → (zip name, csv name suffix, {output column: csv column})
ZENSUS_TABLES: dict[str, tuple[str, str, dict[str, str]]] = {
    "population": ("Zensus2022_Bevoelkerungszahl.zip", "_100m-Gitter.csv", {"einwohner": "Einwohner"}),
    "dwellings": ("Wohnungen_nach_Gebaeudetyp_Groesse.zip", "_100m-Gitter.csv",
                  {"wohnungen": "Insgesamt_Wohnungen"}),
    "buildings": ("Gebaeude_nach_Anzahl_der_Wohnungen_im_Gebaeude.zip", "_100m-Gitter.csv",
                  {"wohngebaeude": "Insgesamt_Gebaeude", "wohngebaeude_1whg": "1_Wohnung",
                   "wohngebaeude_2whg": "2_Wohnungen", "wohngebaeude_3bis6whg": "3bis6_Wohnungen",
                   "wohngebaeude_7bis12whg": "7bis12_Wohnungen", "wohngebaeude_13whg_plus": "13undmehr_Wohnungen"}),
}
ZENSUS_MARGIN_M = 1000
ZENSUS_CELL_M = 100
ATTRIBUTION_ZENSUS = "Zensus 2022, © Statistische Ämter des Bundes und der Länder, dl-de/by-2-0, Daten bearbeitet"

# ------------------------------------------------------------------------------------------------ MaStR constants
MASTR_RAW = RAW_DIR / "mastr"
MASTR_URL = ("https://www.marktstammdatenregister.de/MaStR/Einheit/EinheitJson/"
             "GetErweiterteOeffentlicheEinheitStromerzeugung")
MASTR_SOLAR = 2495            # EnergietraegerId "Solare Strahlungsenergie"
MASTR_IN_OPERATION = 35       # BetriebsStatusId "In Betrieb"
MASTR_PAGE_SIZE = 1000
MASTR_SPLIT_KW = 30.0
MASTR_MIN_UNITS = 3            # per-place aggregates below this get small_n = true (stats.py may suppress)
MUNICIPALITIES = (  # AGS (Gemeindeschlüssel) as in places.py / gemarkungen.geojson
    {"ags": "10045114", "name_de": "Homburg", "state": "SL",
     "places": ["kirrberg", "homburg", "bruchhof-sanddorf", "beeden-schwarzenbach", "erbach-reiskirchen", "einoed"]},
    {"ags": "07320000", "name_de": "Zweibrücken", "state": "RLP", "places": ["moersbach", "zweibruecken"]},
    {"ags": "07340203", "name_de": "Bechhofen", "state": "RLP", "places": ["bechhofen"]},
)
# Fields kept in the raw cache and used for aggregation. Deliberately absent: Anlagenbetreiber* names and
# numbers, EinheitName, Strasse, Hausnummer, Flurstueck, Netzbetreiber (G3; never store operator names).
MASTR_FIELDS = (
    "Id", "MaStRNummer", "BetriebsStatusId", "BetriebsStatusName", "Gemeinde", "Gemeindeschluessel", "Plz", "Ort",
    "Gemarkung", "Bundesland", "Landkreis", "Breitengrad", "Laengengrad", "InbetriebnahmeDatum",
    "EndgueltigeStilllegungDatum", "DatumLetzteAktualisierung", "EinheitRegistrierungsdatum", "Bruttoleistung",
    "Nettonennleistung", "EegInstallierteLeistung", "AnzahlSolarModule", "ArtDerSolaranlageId",
    "ArtDerSolaranlageBezeichnung", "NutzungsbereichGebSA", "HauptausrichtungSolarModuleBezeichnung",
    "HauptneigungswinkelSolarmoduleBezeichnung", "VollTeilEinspeisungBezeichnung", "SpannungsebenenNamen",
    "IsAnonymisiert", "AnlagenbetreiberPersonenArt", "EnergietraegerId",
)
ATTRIBUTION_MASTR = ("Marktstammdatenregister – © Bundesnetzagentur für Elektrizität, Gas, Telekommunikation, Post "
                     "und Eisenbahnen, dl-de/by-2-0, Daten bearbeitet")


# ================================================================================================ shared helpers
def _write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def write_json(path: Path, obj: Any) -> int:
    data = (json.dumps(obj, ensure_ascii=False, indent=1) + "\n").encode()
    _write_atomic(path, data)
    return len(data)


def merge_inputs(existing: Mapping[str, Any] | None, key: str, entry: Mapping[str, Any]) -> dict[str, Any]:
    """Pure read–modify–write of inputs.json: `sources[key]` is replaced, `attribution` is the ordered union of
    every source's `attribution` list (so stats.py can copy it verbatim)."""
    out = {"format": "sle-orte-inputs-v1", **(dict(existing) if existing else {})}
    sources = dict(out.get("sources") or {})
    sources[key] = dict(entry)
    out["sources"] = sources
    attr: list[str] = []
    for src in sources.values():
        for a in src.get("attribution", []):
            if a not in attr:
                attr.append(a)
    out["attribution"] = attr
    out["updated"] = date.today().isoformat()
    return out


def update_inputs(key: str, entry: Mapping[str, Any]) -> None:
    old = json.loads(INPUTS_JSON.read_text()) if INPUTS_JSON.exists() else None
    write_json(INPUTS_JSON, merge_inputs(old, key, entry))


def stats_bbox() -> tuple[int, int, int, int]:
    aoi = load_aoi(AOI_KEY)
    return aoi.e0, aoi.n0, aoi.e1, aoi.n1


def load_places() -> dict[str, Any] | None:
    return json.loads(PLACES_GEOJSON.read_text()) if PLACES_GEOJSON.exists() else None


def needed_tiles(places: Mapping[str, Any] | None, bbox: Sequence[int]) -> list[tuple[int, int]]:
    """1 km tiles (E_km, N_km) to process: union of meta.tiles_needed_list (all states); all bbox tiles without it."""
    lists = ((places or {}).get("meta") or {}).get("tiles_needed_list") or {}
    tiles = {(int(e), int(n)) for lst in lists.values() for e, n in lst}
    if not tiles:
        e0, n0, e1, n1 = bbox
        tiles = {(e, n) for e in range(e0 // 1000, e1 // 1000) for n in range(n0 // 1000, n1 // 1000)}
    return sorted(tiles, key=lambda t: (-t[1], t[0]))


# ================================================================================================ NDVI (pure)
def cir_nir_red(rgba: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """SL `sl_dop20_cir` image (H×W×3|4, channels NIR, R, G) → (NIR, R)."""
    return rgba[..., 0], rgba[..., 1]


def rgbi_nir_red(bands: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """RLP DOP20 RGBI raster, band-first (4×H×W, bands R, G, B, NIR) → (NIR, R)."""
    return bands[3], bands[0]


def ndvi(nir: np.ndarray, red: np.ndarray) -> np.ndarray:
    """(NIR − R) / (NIR + R) as float32; NaN where NIR + R == 0."""
    nir = np.asarray(nir, np.float32)
    red = np.asarray(red, np.float32)
    den = nir + red
    with np.errstate(divide="ignore", invalid="ignore"):
        out = (nir - red) / den
    out[den == 0] = np.nan
    return out


def encode_ndvi(nd: np.ndarray, valid: np.ndarray | None = None) -> np.ndarray:
    """float NDVI → int8 round(NDVI × 100) in [−100, 100]; NaN or ~valid → NDVI_NODATA."""
    v = np.clip(np.rint(np.nan_to_num(nd, nan=0.0) * NDVI_SCALE), -NDVI_SCALE, NDVI_SCALE).astype(np.int8)
    bad = np.isnan(nd)
    if valid is not None:
        bad |= ~valid
    v[bad] = NDVI_NODATA
    return v


def decode_ndvi(v: np.ndarray) -> np.ndarray:
    """int8 → float32 NDVI, NaN for nodata."""
    out = v.astype(np.float32) / NDVI_SCALE
    out[v == NDVI_NODATA] = np.nan
    return out


def block_mean(a: np.ndarray, f: int) -> np.ndarray:
    """Exact f × f area mean over the last two axes (sizes must be multiples of f) → float32."""
    *lead, h, w = a.shape
    if h % f or w % f:
        raise ValueError(f"shape {a.shape} not divisible by {f}")
    return a.reshape(*lead, h // f, f, w // f, f).astype(np.float32).mean(axis=(-3, -1))


def rgbi_valid(bands: np.ndarray) -> np.ndarray:
    """RLP DOP pixels with imagery: not all four bands 0 (black fill) and not all 255 (white fill)."""
    return ~(np.all(bands == 0, axis=0) | np.all(bands == 255, axis=0))


def reduce_rgbi(bands: np.ndarray, f: int = RLP_FACTOR) -> tuple[np.ndarray, np.ndarray]:
    """20 cm RGBI (4×H×W uint8) → 1 m (4×H/f×W/f uint8 area mean, valid mask). A 1 m cell is valid only when all
    f × f source pixels are imagery, so no fill colour leaks into the mean."""
    valid = rgbi_valid(bands)
    full = block_mean(valid.astype(np.uint8), f) == 1.0
    mean = np.clip(np.rint(block_mean(bands, f)), 0, 255).astype(np.uint8)
    mean[:, ~full] = 0
    return mean, full


def tile_slices(bbox: Sequence[int], e_km: int, n_km: int, size_m: int = TILE_M) -> tuple[slice, slice]:
    """(row slice, col slice) of the 1 m stats grid (north-up, origin top-left) covering the square tile with
    lower-left corner (e_km, n_km) km and side size_m."""
    e0, _, _, n1 = bbox
    c0 = e_km * 1000 - e0
    r0 = n1 - (n_km * 1000 + size_m)
    return slice(r0, r0 + size_m), slice(c0, c0 + size_m)


def rlp_tile_of(e_km: int, n_km: int) -> tuple[int, int]:
    """2 km RLP DOP tile (even lower-left km) containing the 1 km tile (e_km, n_km)."""
    return e_km - e_km % 2, n_km - n_km % 2


def overlap_candidates(sl_full: Iterable[tuple[int, int]], rlp_place_tiles: Iterable[tuple[int, int]],
                       n: int) -> list[tuple[int, int]]:
    """2 km RLP DOP tiles for the SL/RLP cross-check: those with the most 1 km tiles that are fully SL-covered
    *and* belong to an RLP place (where the SL-over-RLP choice matters); ties → lowest (E, N). Returns ≤ n."""
    rl = set(rlp_place_tiles)
    counts = Counter(rlp_tile_of(*t) for t in sl_full if tuple(t) in rl)
    return [t for t, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:max(0, n)]]


RLP_JP2_RE = re.compile(r"(dop20rgbi_32_(\d+)_(\d+)_2_rp_(\d{4})\.jp2)")


def parse_rlp_index(html: str) -> dict[tuple[int, int], str]:
    """Directory listing → {(E_km, N_km): jp2 file name}; if a tile appears with several years the newest wins."""
    out: dict[tuple[int, int], tuple[int, str]] = {}
    for name, e, n, year in RLP_JP2_RE.findall(html):
        k = (int(e), int(n))
        if k not in out or int(year) > out[k][0]:
            out[k] = (int(year), name)
    return {k: v[1] for k, v in out.items()}


def parse_rlp_met(xml: str) -> dict[str, Any]:
    """ISO 19139 tile metadata → {creation, edition}: the first CI_Date with dateType `creation` and editionDate."""
    m = re.search(r"<gco:Date>([0-9-]+)</gco:Date>\s*</gmd:date>\s*<gmd:dateType>\s*<gmd:CI_DateTypeCode[^>]*"
                  r"codeListValue=\"creation\"", xml)
    ed = re.search(r"<gmd:editionDate>\s*<gco:Date>([0-9-]+)</gco:Date>", xml)
    return {"creation": m.group(1) if m else None, "edition": ed.group(1) if ed else None}


def parse_sl_dop_info(html: str) -> dict[str, Any]:
    """GetFeatureInfo text/html of `sl_dop_info` → {name, title, updated (ISO date)}."""
    def cell(label: str) -> str | None:
        m = re.search(rf"<td>\s*{label}\s*</td>\s*<td>([^<]*)</td>", html)
        return m.group(1).strip() if m else None

    upd = cell("Aktualisierung")
    iso = None
    if upd and re.fullmatch(r"\d{2}\.\d{2}\.\d{4}", upd):
        d, mth, y = upd.split(".")
        iso = f"{y}-{mth}-{d}"
    return {"name": cell("Name"), "title": cell("Titel"), "updated": iso}


def class_medians(nd: np.ndarray, masks: Mapping[str, np.ndarray]) -> dict[str, dict[str, float | int]]:
    """Median / p10 / p90 NDVI per class mask (NaN ignored)."""
    out: dict[str, dict[str, float | int]] = {}
    for k, m in masks.items():
        v = nd[m & ~np.isnan(nd)]
        out[k] = ({"n": int(v.size), "median": round(float(np.median(v)), 3),
                   "p10": round(float(np.percentile(v, 10)), 3), "p90": round(float(np.percentile(v, 90)), 3)}
                  if v.size else {"n": 0})
    return out


def quantile_table(src_vals: np.ndarray, ref_vals: np.ndarray, step: float = 5.0) -> dict[str, list[float]]:
    """Distribution match src → ref (e.g. RLP NDVI → SL NDVI) from co-located samples: matching percentiles.
    Robust to the ≈ 1 m misregistration that hurts a per-pixel regression."""
    q = np.arange(0.0, 100.0 + step / 2, step)
    return {"q": [round(float(v), 1) for v in q],
            "src": [round(float(v), 4) for v in np.percentile(src_vals, q)],
            "ref": [round(float(v), 4) for v in np.percentile(ref_vals, q)]}


def apply_quantile_table(x: np.ndarray, table: Mapping[str, Sequence[float]]) -> np.ndarray:
    """Map values through a quantile_table (piecewise linear, clamped at the ends); NaN stays NaN."""
    src = np.asarray(table["src"], float)
    ref = np.asarray(table["ref"], float)
    src = np.maximum.accumulate(src + np.arange(src.size) * 1e-9)  # strictly increasing for np.interp
    out = np.interp(np.asarray(x, float), src, ref)
    return np.where(np.isnan(x), np.nan, out)


# ================================================================================================ NDVI (I/O)
def _sl_client():
    from ortho import WmsClient  # local import: keeps the pure parts importable without PIL side effects
    return WmsClient(NDVI_RAW / "sl" / "cir", retries=5)


def fetch_sl_tile(client, e_km: int, n_km: int) -> np.ndarray:
    from ortho import wms_getmap_url
    bbox = (e_km * 1000, n_km * 1000, e_km * 1000 + TILE_M, n_km * 1000 + TILE_M)
    url = wms_getmap_url(SL_WMS, SL_CIR_LAYER, bbox, TILE_M, TILE_M)
    return client.image(url, f"{SL_CIR_LAYER}_{e_km}_{n_km}_1000m_1000px.png", (TILE_M, TILE_M))


def sl_dop_info(e2: int, n2: int) -> dict[str, Any]:
    """Cached GetFeatureInfo at the centre of the 2 km SL DOP tile (e2, n2)."""
    path = NDVI_RAW / "sl" / "info" / f"dop_info_{e2}_{n2}.html"
    if not path.exists():
        e, n = e2 * 1000, n2 * 1000
        q = {"SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetFeatureInfo", "LAYERS": SL_INFO_LAYER,
             "QUERY_LAYERS": SL_INFO_LAYER, "STYLES": "", "CRS": "EPSG:25832",
             "BBOX": f"{e},{n},{e + RLP_TILE_M},{n + RLP_TILE_M}", "WIDTH": "100", "HEIGHT": "100",
             "I": "50", "J": "50", "INFO_FORMAT": "text/html", "FEATURE_COUNT": "1"}
        url = SL_WMS + "?" + urllib.parse.urlencode(q, safe=",:")
        with http_open(url) as r:
            _write_atomic(path, r.read())
        time.sleep(0.3)
    return {"tile": [e2, n2], **parse_sl_dop_info(path.read_text("utf-8", "replace"))}


def rlp_index() -> dict[tuple[int, int], str]:
    path = NDVI_RAW / "rlp" / "jp2_index.html"
    if not path.exists() or path.stat().st_size < 100_000:
        with http_open(RLP_JP2_BASE, timeout=120) as r:
            _write_atomic(path, r.read())
    return parse_rlp_index(path.read_text("utf-8", "replace"))


def rlp_met(name: str) -> dict[str, Any]:
    met = name.replace(".jp2", ".met")
    path = NDVI_RAW / "rlp" / "met" / met
    if not path.exists():
        with http_open(RLP_JP2_BASE + met) as r:
            _write_atomic(path, r.read())
    return parse_rlp_met(path.read_text("utf-8", "replace"))


def _download(url: str, path: Path) -> int:
    """Sequential streaming GET into path (atomic), size checked against Content-Length."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".part")
    for attempt in range(1, 4):
        try:
            with http_open(url, timeout=300) as r, open(tmp, "wb") as f:
                want = int(r.headers.get("Content-Length") or 0)
                got = 0
                while chunk := r.read(1 << 20):
                    f.write(chunk)
                    got += len(chunk)
            if want and got != want:
                raise OSError(f"short read {got}/{want}")
            os.replace(tmp, path)
            return got
        except OSError as e:
            if attempt == 3:
                raise
            print(f"  ! {e} – retry {attempt}/2", file=sys.stderr)
            time.sleep(5 * attempt)
    raise RuntimeError("unreachable")


def rlp_rgbi_1m(name: str, *, keep_jp2: bool = False) -> Path:
    """Cached 1 m RGBI GeoTIFF of one RLP DOP tile (download + 5 × 5 area mean + delete JP2)."""
    import rasterio
    from rasterio.windows import Window

    out = NDVI_RAW / "rlp" / "rgbi_1m" / name.replace(".jp2", "_1m.tif")
    if out.exists():
        return out
    jp2 = NDVI_RAW / "rlp" / "jp2" / name
    if not jp2.exists():
        t0 = time.time()
        n = _download(RLP_JP2_BASE + name, jp2)
        print(f"    downloaded {name} {fmt_bytes(n)} in {time.time() - t0:.0f}s", flush=True)
    with rasterio.open(jp2) as src:
        if src.count != 4 or src.res != (0.2, 0.2) or src.width % RLP_FACTOR or src.height % RLP_FACTOR:
            raise RuntimeError(f"{name}: unexpected raster {src.count} bands, res {src.res}, {src.width}×{src.height}")
        if src.transform.c % 1 or src.transform.f % 1:
            raise RuntimeError(f"{name}: origin not on whole metres: {src.transform}")
        w, h = src.width // RLP_FACTOR, src.height // RLP_FACTOR
        rgbi = np.zeros((4, h, w), np.uint8)
        strip = 200 * RLP_FACTOR  # 200 m strips (4 × 1000 × 10000 bytes)
        for r0 in range(0, src.height, strip):
            rows = min(strip, src.height - r0)
            bands = src.read(window=Window(0, r0, src.width, rows))
            mean, _ = reduce_rgbi(bands)
            rgbi[:, r0 // RLP_FACTOR:(r0 + rows) // RLP_FACTOR] = mean
        transform = rasterio.Affine(1.0, 0, src.transform.c, 0, -1.0, src.transform.f)
        crs = src.crs
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".part.tif")
    with rasterio.open(tmp, "w", driver="GTiff", width=w, height=h, count=4, dtype="uint8", crs=crs,
                       transform=transform, nodata=0, tiled=True, blockxsize=512, blockysize=512,
                       compress="deflate", predictor=2) as dst:
        dst.write(rgbi)
        dst.descriptions = ("R", "G", "B", "NIR")
        dst.update_tags(source=RLP_JP2_BASE + name, method="5x5 area mean of DOP20 (valid only if all 25 px valid)")
    os.replace(tmp, out)
    if not keep_jp2:
        jp2.unlink()
    return out


def _read_rgbi_window(path: Path, e_km: int, n_km: int) -> np.ndarray:
    import rasterio
    from rasterio.windows import from_bounds
    with rasterio.open(path) as src:
        win = from_bounds(e_km * 1000, n_km * 1000, e_km * 1000 + TILE_M, n_km * 1000 + TILE_M, src.transform)
        return src.read(window=win.round_offsets().round_lengths(), boundless=True, fill_value=0)


def _overall_masks(bbox: Sequence[int]) -> tuple[tuple[slice, slice], dict[str, np.ndarray]] | None:
    """Class masks from the overall AOI work rasters (bldg = LoD2 footprint raster, chm) for the sanity check."""
    import rasterio
    from scipy.ndimage import binary_dilation, binary_erosion
    bp, cp = OVERALL_WORK / "bldg.tif", OVERALL_WORK / "chm.tif"
    if not (bp.exists() and cp.exists()):
        return None
    with rasterio.open(bp) as b, rasterio.open(cp) as c:
        if b.res != (1.0, 1.0) or b.bounds != c.bounds:
            return None
        bl, bb, br, bt = (int(v) for v in b.bounds)
        bldg = b.read(1) > 0
        chm = c.read(1).astype(np.float32)
    e0, _, _, n1 = bbox
    win = (slice(n1 - bt, n1 - bb), slice(bl - e0, br - e0))
    roof_core = binary_erosion(bldg, iterations=2)
    masks = {
        "roof_core (LoD2 footprint, 2 m inset)": roof_core,
        "tall_canopy (CHM >= 15 m, no building)": (chm >= 15) & ~bldg,
        "low_open (CHM < 0.5 m, >= 2 m from buildings)": (chm < 0.5) & ~binary_dilation(bldg, iterations=2),
    }
    return win, masks


def run_ndvi(*, workers: int = 2, keep_jp2: bool = False, overlap_tiles: int = 2) -> dict[str, Any]:
    import rasterio
    from concurrent.futures import ThreadPoolExecutor

    bbox = stats_bbox()
    e0, n0, e1, n1 = bbox
    W, H = e1 - e0, n1 - n0
    places = load_places()
    tiles = needed_tiles(places, bbox)
    print(f"ndvi: {len(tiles)} 1 km tiles in stats bbox {bbox} ({W}×{H} px at 1 m)", flush=True)
    nd = np.full((H, W), NDVI_NODATA, np.int8)
    src = np.zeros((H, W), np.uint8)

    # --- SL WMS (≤ 3 parallel, cached)
    client = _sl_client()
    t0 = time.time()
    sl_alpha: dict[tuple[int, int], np.ndarray] = {}

    def sl_one(t):
        return t, fetch_sl_tile(client, *t)

    with ThreadPoolExecutor(max_workers=max(1, min(workers, 3))) as ex:
        for k, (t, rgba) in enumerate(ex.map(sl_one, tiles), 1):
            rs, cs = tile_slices(bbox, *t)
            ok = rgba[..., 3] == 255
            nir, red = cir_nir_red(rgba)
            enc = encode_ndvi(ndvi(nir, red), ok)
            nd[rs, cs] = np.where(ok, enc, nd[rs, cs])
            src[rs, cs] = np.where(ok, SRC_SL, src[rs, cs])
            sl_alpha[t] = ok
            if k % 20 == 0 or k == len(tiles):
                print(f"  SL {k}/{len(tiles)} ({client.requests} requests, {fmt_bytes(client.bytes)}, "
                      f"{client.cached} cached) {time.time() - t0:.0f}s", flush=True)

    # --- SL flight dates per 2 km DOP tile that has SL imagery
    sl_dates = []
    for t2 in sorted({rlp_tile_of(*t) for t, ok in sl_alpha.items() if ok.any()}):
        try:
            sl_dates.append(sl_dop_info(*t2))
        except Exception as e:  # noqa: BLE001 - metadata only
            sl_dates.append({"tile": list(t2), "error": f"{type(e).__name__}: {e}"})

    # --- RLP fill for tiles with SL gaps
    gap_tiles = [t for t, ok in sl_alpha.items() if not ok.all()]
    rlp_place_tiles = {(int(e), int(n)) for e, n in
                       (((places or {}).get("meta") or {}).get("tiles_needed_list") or {}).get("RLP", [])}
    sl_full = [t for t, ok in sl_alpha.items() if ok.all()]
    xcheck = overlap_candidates(sl_full, rlp_place_tiles, overlap_tiles)
    index = rlp_index() if (gap_tiles or xcheck) else {}
    rlp_needed = sorted({rlp_tile_of(*t) for t in gap_tiles})
    missing = [t2 for t2 in rlp_needed if t2 not in index]
    print(f"  RLP: {len(gap_tiles)} tiles with SL gaps → {len(rlp_needed)} DOP tiles "
          f"({len(missing)} not in the RLP index); cross-check tiles {xcheck}", flush=True)
    rlp_tiles_meta = []
    overlap_sl: list[np.ndarray] = []
    overlap_rlp: list[np.ndarray] = []
    jobs = [(t2, "fill") for t2 in rlp_needed] + [(t2, "cross-check") for t2 in xcheck if t2 not in rlp_needed]
    for k, (t2, role) in enumerate(jobs, 1):
        name = index.get(t2)
        if not name:
            continue
        print(f"  RLP {k}/{len(jobs)} {name} ({role})", flush=True)
        path = rlp_rgbi_1m(name, keep_jp2=keep_jp2)
        rlp_tiles_meta.append({"tile": list(t2), "file": name, "role": role, **rlp_met(name)})
        for q in ((t2[0] + dx, t2[1] + dy) for dx in (0, 1) for dy in (0, 1)):
            ok_sl = sl_alpha.get(q)
            if ok_sl is None:   # not a needed tile
                continue
            bands = _read_rgbi_window(path, *q)
            valid = rgbi_valid(bands) & (bands[3].astype(np.int32) + bands[0] > 0)
            nir, red = rgbi_nir_red(bands)
            r_nd = ndvi(nir, red)
            rs, cs = tile_slices(bbox, *q)
            fill = valid & ~ok_sl
            nd[rs, cs] = np.where(fill, encode_ndvi(r_nd, valid), nd[rs, cs])
            src[rs, cs] = np.where(fill, SRC_RLP, src[rs, cs])
            both = valid & ok_sl   # cross-check: SL WMS (kept) vs RLP DOP on the same pixels
            if both.any():
                overlap_sl.append(decode_ndvi(nd[rs, cs][both]))
                overlap_rlp.append(r_nd[both])

    # --- outputs
    ORTE_WORK.mkdir(parents=True, exist_ok=True)
    transform = rasterio.Affine(1.0, 0, e0, 0, -1.0, n1)
    prof = dict(driver="GTiff", width=W, height=H, count=1, crs="EPSG:25832", transform=transform, tiled=True,
                blockxsize=512, blockysize=512, compress="deflate", BIGTIFF="IF_SAFER")
    out_nd, out_src = ORTE_WORK / "ndvi.tif", ORTE_WORK / "ndvi_src.tif"
    for path, arr, dtype, nodata, desc in ((out_nd, nd, "int8", NDVI_NODATA, "NDVI x 100"),
                                           (out_src, src, "uint8", SRC_NONE, "0 none, 1 SL WMS, 2 RLP DOP")):
        tmp = path.with_suffix(".part.tif")
        with rasterio.open(tmp, "w", dtype=dtype, nodata=nodata, **prof) as dst:
            dst.write(arr, 1)
            dst.set_band_description(1, desc)
            if path is out_nd:
                dst.scales, dst.offsets = (1 / NDVI_SCALE,), (0.0,)
            dst.update_tags(method=NDVI_METHOD, generated=date.today().isoformat())
        os.replace(tmp, path)

    # --- sanity checks
    checks: dict[str, Any] = {}
    om = _overall_masks(bbox)
    if om is not None:
        (rs, cs), masks = om
        sub_nd, sub_src = decode_ndvi(nd[rs, cs]), src[rs, cs]
        for code, label in ((SRC_SL, "SL"), (SRC_RLP, "RLP")):
            checks[f"overall_classes_{label}"] = class_medians(
                sub_nd, {k: m & (sub_src == code) for k, m in masks.items()})
    if overlap_sl:
        a, b = np.concatenate(overlap_sl), np.concatenate(overlap_rlp)
        ok = ~np.isnan(a) & ~np.isnan(b)
        a, b = a[ok], b[ok]
        veg, bare = a > 0.3, a < 0.1
        med = lambda x: round(float(np.median(x)), 3) if x.size else None  # noqa: E731
        checks["sl_rlp_overlap"] = {
            "pixels": int(a.size), "median_rlp_minus_sl": med(b - a),
            "median_rlp_minus_sl_veg": med(b[veg] - a[veg]), "median_rlp_minus_sl_bare": med(b[bare] - a[bare]),
            "median_sl": {"veg": med(a[veg]), "bare": med(a[bare])},
            "median_rlp": {"where_sl_veg": med(b[veg]), "where_sl_bare": med(b[bare])},
            "corr": round(float(np.corrcoef(a, b)[0, 1]), 3) if a.size > 10 else None,
            "quantile_map_rlp_to_sl": quantile_table(b, a) if a.size else None,
            "quantile_map_note": "fitted on the cross-check tiles only (RLP flight 2023-06 vs SL 2025-05); not "
                                 "applied to ndvi.tif. stats.py may map RLP-source pixels (ndvi_src = 2) through "
                                 "it with apply_quantile_table before comparing places across sources",
            "note": "pixels with both SL WMS (2025) and RLP DOP (2023/2025) imagery; different flights and "
                    "radiometry, so the offset is a cross-check, not a correction"}
    valid = nd != NDVI_NODATA
    tile_px = len(tiles) * TILE_M * TILE_M
    sl_upd = sorted(d["updated"] for d in sl_dates if d.get("updated"))
    rlp_cre = sorted(m["creation"] for m in rlp_tiles_meta if m.get("creation"))
    meta = {
        "format": "sle-orte-ndvi-v1", "method": NDVI_METHOD, "generated": date.today().isoformat(),
        "crs": "EPSG:25832", "bbox": list(bbox), "cell_m": 1,
        "files": {"ndvi": "ndvi.tif", "source": "ndvi_src.tif"},
        "encoding": {"dtype": "int8", "scale": 1 / NDVI_SCALE, "nodata": NDVI_NODATA,
                     "source_codes": {"0": "none", "1": "SL WMS sl_dop20_cir", "2": "RLP DOP20 RGBI"}},
        "formula": "(NIR - R) / (NIR + R) on 8-bit display values (pseudo-NDVI, relative)",
        "tiles": len(tiles), "tiles_rule": "gemarkungen.geojson meta.tiles_needed_list (places + 200 m)",
        "coverage": {"valid_px": int(valid.sum()), "tile_px": tile_px,
                     "valid_share_of_tiles": round(float(valid.sum()) / tile_px, 4) if tile_px else None,
                     "sl_px": int((src == SRC_SL).sum()), "rlp_px": int((src == SRC_RLP).sum())},
        "sources": {
            "SL": {"service": SL_WMS, "layer": SL_CIR_LAYER, "product": "DOP20 2025 (WMS, 1 m/px requests)",
                   "band_order": "NIR, R, G", "flight_dates": {"min": sl_upd[0] if sl_upd else None,
                                                               "max": sl_upd[-1] if sl_upd else None},
                   "dop_tiles": sl_dates, "attribution": ATTRIBUTION_DOP_SL},
            "RLP": {"base": RLP_JP2_BASE, "product": "DOP20 RGBI tiles (5 × 5 area mean to 1 m)",
                    "band_order": "R, G, B, NIR", "flight_dates": {"min": rlp_cre[0] if rlp_cre else None,
                                                                    "max": rlp_cre[-1] if rlp_cre else None},
                    "dop_tiles": rlp_tiles_meta, "missing_tiles": [list(t) for t in missing],
                    "attribution": ATTRIBUTION_DOP_RLP},
        },
        "checks": checks,
    }
    write_json(ORTE_WORK / "ndvi.json", meta)
    used = [ATTRIBUTION_DOP_SL] + ([ATTRIBUTION_DOP_RLP] if (src == SRC_RLP).any() else [])
    update_inputs("ndvi", {"file": "ndvi.tif", "meta": "ndvi.json", "method": NDVI_METHOD, "attribution": used,
                           "flight_dates": {"SL": meta["sources"]["SL"]["flight_dates"],
                                            "RLP": meta["sources"]["RLP"]["flight_dates"]}})
    print(f"  wrote {out_nd} ({fmt_bytes(out_nd.stat().st_size)}), {out_src.name}; valid "
          f"{meta['coverage']['valid_share_of_tiles']} of needed tiles; checks {json.dumps(checks)[:800]}")
    return meta


# ================================================================================================ Zensus (pure)
def parse_zensus_value(s: str) -> int | None:
    """Zensus CSV value → int. '–' / '-' (exactly zero or set to zero) → 0; empty or unparsable → None."""
    s = (s or "").strip()
    if s in ("–", "-", "—"):
        return 0
    try:
        return int(s.replace(".", "")) if re.fullmatch(r"[0-9.]+", s) else int(float(s.replace(",", ".")))
    except ValueError:
        return None


_GRID_ID = re.compile(r"CRS3035RES100mN(\d+)E(\d+)")


def grid_id_centre(gid: str, cell: int = ZENSUS_CELL_M) -> tuple[float, float]:
    """INSPIRE grid id (lower-left corner in EPSG:3035) → cell centre (x=E, y=N) in EPSG:3035."""
    m = _GRID_ID.fullmatch(gid.strip())
    if not m:
        raise ValueError(f"bad grid id {gid!r}")
    n, e = int(m.group(1)), int(m.group(2))
    return e + cell / 2, n + cell / 2


def laea_to_utm():
    from pyproj import Transformer
    return Transformer.from_crs("EPSG:3035", "EPSG:25832", always_xy=True)


def utm_to_laea():
    from pyproj import Transformer
    return Transformer.from_crs("EPSG:25832", "EPSG:3035", always_xy=True)


def laea_filter_box(bbox: Sequence[float], margin: float, cell: float = ZENSUS_CELL_M) -> tuple[float, ...]:
    """Conservative EPSG:3035 box around the EPSG:25832 bbox + margin (densified edges + one cell)."""
    e0, n0, e1, n1 = bbox[0] - margin, bbox[1] - margin, bbox[2] + margin, bbox[3] + margin
    tr = utm_to_laea()
    t = np.linspace(0, 1, 21)
    es = np.concatenate([e0 + (e1 - e0) * t, np.full(21, e1), e1 - (e1 - e0) * t, np.full(21, e0)])
    ns = np.concatenate([np.full(21, n0), n0 + (n1 - n0) * t, np.full(21, n1), n1 - (n1 - n0) * t])
    x, y = tr.transform(es, ns)
    return float(x.min()) - cell, float(y.min()) - cell, float(x.max()) + cell, float(y.max()) + cell


def cells_to_utm(xs: Sequence[float], ys: Sequence[float]) -> tuple[np.ndarray, np.ndarray]:
    e, n = laea_to_utm().transform(np.asarray(xs, float), np.asarray(ys, float))
    return np.asarray(e), np.asarray(n)


def read_zensus_csv(fh: Iterable[str], columns: Mapping[str, str], box3035: Sequence[float]
                    ) -> dict[str, dict[str, Any]]:
    """Semicolon CSV (GITTER_ID_100m;x_mp_100m;y_mp_100m;…) → {grid id: {x, y, <out col>: int}} for cells whose
    centre lies in box3035 (EPSG:3035 x0, y0, x1, y1)."""
    rd = csv.reader(fh, delimiter=";")
    head = [h.strip().lstrip("﻿") for h in next(rd)]
    ix = {h: i for i, h in enumerate(head)}
    gid_i = next(i for h, i in ix.items() if h.upper().startswith("GITTER_ID"))
    xi, yi = ix["x_mp_100m"], ix["y_mp_100m"]
    missing = [c for c in columns.values() if c not in ix]
    if missing:
        raise KeyError(f"columns {missing} not in header {head}")
    x0, y0, x1, y1 = box3035
    out: dict[str, dict[str, Any]] = {}
    for row in rd:
        if not row:
            continue
        x, y = float(row[xi]), float(row[yi])
        if not (x0 <= x <= x1 and y0 <= y <= y1):
            continue
        rec: dict[str, Any] = {"x": x, "y": y}
        for k, c in columns.items():
            rec[k] = parse_zensus_value(row[ix[c]])
        out[row[gid_i].strip()] = rec
    return out


def merge_zensus(tables: Mapping[str, Mapping[str, Mapping[str, Any]]], bbox: Sequence[float], margin: float,
                 cols: Sequence[str]) -> list[dict[str, Any]]:
    """Join tables on grid id, transform centres to EPSG:25832, keep centres inside bbox + margin, sort N→S, W→E."""
    ids = sorted({g for t in tables.values() for g in t})
    if not ids:
        return []
    xs, ys = [], []
    for g in ids:
        x, y = grid_id_centre(g)
        xs.append(x)
        ys.append(y)
    es, ns = cells_to_utm(xs, ys)
    e0, n0, e1, n1 = bbox[0] - margin, bbox[1] - margin, bbox[2] + margin, bbox[3] + margin
    rows = []
    for g, x, y, e, n in zip(ids, xs, ys, es, ns):
        if not (e0 <= e <= e1 and n0 <= n <= n1):
            continue
        rec = {"gitter_id": g, "x3035": x, "y3035": y, "e": round(float(e), 2), "n": round(float(n), 2)}
        for c in cols:
            v = None
            for t in tables.values():
                if g in t and c in t[g]:
                    v = t[g][c]
                    break
            rec[c] = v
        rows.append(rec)
    rows.sort(key=lambda r: (-r["n"], r["e"]))
    return rows


def xlsx_strings(data: bytes) -> list[str]:
    """Shared strings of an .xlsx (no openpyxl): used to quote the licence text of the bundled description."""
    with zipfile.ZipFile(io.BytesIO(data)) as x:
        ss = x.read("xl/sharedStrings.xml").decode("utf-8")
    import html as _html
    return [_html.unescape(re.sub(r"<[^>]+>", "", s)) for s in re.findall(r"<si>(.*?)</si>", ss, re.S)]


# ================================================================================================ Zensus (I/O)
def zensus_zip(name: str) -> Path:
    path = ZENSUS_RAW / name
    if not path.exists():
        t0 = time.time()
        n = _download(ZENSUS_BASE + name, path)
        print(f"  downloaded {name} {fmt_bytes(n)} in {time.time() - t0:.0f}s", flush=True)
        time.sleep(1)
    return path


def run_zensus() -> dict[str, Any]:
    bbox = stats_bbox()
    box = laea_filter_box(bbox, ZENSUS_MARGIN_M)
    tables: dict[str, dict[str, dict[str, Any]]] = {}
    desc: dict[str, Any] = {}
    cols: list[str] = []
    for key, (zname, suffix, columns) in ZENSUS_TABLES.items():
        path = zensus_zip(zname)
        with zipfile.ZipFile(path) as z:
            csv_name = next(i.filename for i in z.infolist() if i.filename.endswith(suffix))
            with z.open(csv_name) as f:
                tables[key] = read_zensus_csv(io.TextIOWrapper(f, encoding="utf-8", newline=""), columns, box)
            xl = next((i.filename for i in z.infolist() if i.filename.endswith(".xlsx")), None)
            strs = xlsx_strings(z.read(xl)) if xl else []
        desc[key] = {
            "zip": zname, "url": ZENSUS_BASE + zname, "csv": csv_name, "description": xl,
            "licence_text": next((s for s in strs if "lizenziert unter" in s), None),
            "copyright": next((s for s in strs if s.startswith("©")), None),
            "edition": next((s for s in strs if s.startswith("Erscheinungsfolge")), None),
            "columns": columns, "cells_in_box": len(tables[key]),
        }
        cols += list(columns)
        print(f"  {key}: {len(tables[key])} cells in the EPSG:3035 filter box", flush=True)
    rows = merge_zensus(tables, bbox, ZENSUS_MARGIN_M, cols)
    ORTE_WORK.mkdir(parents=True, exist_ok=True)
    out = ORTE_WORK / "zensus_100m.csv"
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=["gitter_id", "x3035", "y3035", "e", "n", *cols], lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow({k: ("" if v is None else v) for k, v in r.items()})
    _write_atomic(out, buf.getvalue().encode())
    totals = {c: int(sum(r[c] or 0 for r in rows)) for c in cols}
    meta = {
        "format": "sle-orte-zensus-v1", "generated": date.today().isoformat(), "file": out.name,
        "stichtag": "2022-05-15", "crs": {"cell": "EPSG:3035 (100 m INSPIRE cells)", "e_n": "EPSG:25832"},
        "rule": f"cell centre (transformed to EPSG:25832) inside stats bbox + {ZENSUS_MARGIN_M} m",
        "bbox": list(bbox), "cells": len(rows), "totals": totals,
        "columns": {"einwohner": "Einwohner (population)", "wohnungen": "Insgesamt_Wohnungen (all dwellings)",
                    "wohngebaeude": "Insgesamt_Gebaeude (buildings with living space)",
                    "wohngebaeude_*whg*": "buildings with living space by number of dwellings"},
        "notes": ["Cells are 100 m squares in EPSG:3035; e/n are the transformed centres (assign by centre or "
                  "intersect the reprojected square)",
                  "'–' (exactly zero or set to zero) is stored as 0; cells without population and without "
                  "dwellings are absent",
                  "values are altered by the cell-key method (CKM, § 16 BStatG): sums of cells differ from "
                  "official municipality totals"],
        "tables": desc, "page": ZENSUS_PAGE, "attribution": ATTRIBUTION_ZENSUS,
    }
    write_json(ORTE_WORK / "zensus.json", meta)
    update_inputs("zensus", {"file": out.name, "meta": "zensus.json", "attribution": [ATTRIBUTION_ZENSUS],
                             "licence_text": desc["population"]["licence_text"],
                             "copyright": [d["copyright"] for d in desc.values()]})
    print(f"  wrote {out} ({len(rows)} cells, {fmt_bytes(out.stat().st_size)}), totals {totals}")
    return meta


# ================================================================================================ MaStR (pure)
def mastr_filter(ags: str, energietraeger: int = MASTR_SOLAR) -> str:
    return f"Gemeindeschlüssel~eq~'{ags}'~and~Energieträger~eq~'{energietraeger}'"


def mastr_url(ags: str, page: int, page_size: int = MASTR_PAGE_SIZE) -> str:
    q = {"sort": "MaStRNummer-asc", "page": str(page), "pageSize": str(page_size), "group": "",
         "filter": mastr_filter(ags)}
    return MASTR_URL + "?" + urllib.parse.urlencode(q)


def mastr_date(v: Any) -> date | None:
    """'/Date(1541376000000)/' (ms since epoch, UTC) → date."""
    if not v:
        return None
    m = re.fullmatch(r"/Date\((-?\d+)\)/", str(v))
    if not m:
        return None
    return datetime.fromtimestamp(int(m.group(1)) / 1000, tz=timezone.utc).date()


def slim_row(row: Mapping[str, Any]) -> dict[str, Any]:
    return {k: row.get(k) for k in MASTR_FIELDS}


def is_balcony(row: Mapping[str, Any]) -> bool:
    return "steckerfertig" in str(row.get("ArtDerSolaranlageBezeichnung") or "").lower()


def kw(row: Mapping[str, Any]) -> float:
    v = row.get("Bruttoleistung")
    return float(v) if isinstance(v, (int, float)) else 0.0


def aggregate_pv(rows: Iterable[Mapping[str, Any]], *, split_kw: float = MASTR_SPLIT_KW,
                 assign=None) -> dict[str, Any]:
    """Aggregate MaStR solar rows of one municipality. Only units with BetriebsStatusId 35 (in operation) count
    towards the totals; all statuses are counted in `status`. `assign(lat, lon) -> place id | None` places
    ≥ split_kw units that carry coordinates; only counts and kWp per place are returned (never points)."""
    rows = list(rows)
    status = Counter(str(r.get("BetriebsStatusName") or r.get("BetriebsStatusId")) for r in rows)
    op = [r for r in rows if r.get("BetriebsStatusId") == MASTR_IN_OPERATION]

    def tot(rs) -> dict[str, Any]:
        return {"units": len(rs), "kwp": round(sum(kw(r) for r in rs), 2)}

    small = [r for r in op if kw(r) < split_kw]
    large = [r for r in op if kw(r) >= split_kw]
    balcony = [r for r in op if is_balcony(r)]
    by_year: dict[str, dict[str, Any]] = {}
    for r in sorted(op, key=lambda r: mastr_date(r.get("InbetriebnahmeDatum")) or date.min):
        d = mastr_date(r.get("InbetriebnahmeDatum"))
        y = str(d.year) if d else "unknown"
        e = by_year.setdefault(y, {"units": 0, "kwp": 0.0, "balcony": 0})
        e["units"] += 1
        e["kwp"] = round(e["kwp"] + kw(r), 2)
        e["balcony"] += int(is_balcony(r))
    by_type: dict[str, dict[str, Any]] = {}
    for r in op:
        e = by_type.setdefault(str(r.get("ArtDerSolaranlageBezeichnung") or "unbekannt"), {"units": 0, "kwp": 0.0})
        e["units"] += 1
        e["kwp"] = round(e["kwp"] + kw(r), 2)
    with_xy = [r for r in large if r.get("Breitengrad") is not None and r.get("Laengengrad") is not None]
    per_place: dict[str, dict[str, Any]] = {}
    if assign is not None:
        for r in with_xy:
            pid = assign(float(r["Breitengrad"]), float(r["Laengengrad"])) or "outside_places"
            e = per_place.setdefault(pid, {"units": 0, "kwp": 0.0})
            e["units"] += 1
            e["kwp"] = round(e["kwp"] + kw(r), 2)
        for e in per_place.values():
            e["small_n"] = e["units"] < MASTR_MIN_UNITS
    implausible = sum(1 for r in op if (d := mastr_date(r.get("InbetriebnahmeDatum"))) and d.year < 1990)
    upd = [d for d in (mastr_date(r.get("DatumLetzteAktualisierung")) for r in rows) if d]
    return {
        "status": dict(status),
        "in_operation": {**tot(op), "net_kw": round(sum(float(r.get("Nettonennleistung") or 0) for r in op), 2)},
        f"lt_{int(split_kw)}kw": tot(small), f"ge_{int(split_kw)}kw": tot(large),
        "balcony": tot(balcony),
        "by_commissioning_year": dict(sorted(by_year.items())),
        "by_type": dict(sorted(by_type.items(), key=lambda kv: -kv[1]["kwp"])),
        f"ge_{int(split_kw)}kw_with_coordinates": tot(with_xy),
        f"ge_{int(split_kw)}kw_per_place": dict(sorted(per_place.items())),
        "commissioned_before_1990": implausible,  # PV before 1990 is almost surely a data-entry error in MaStR
        "last_update_in_data": max(upd).isoformat() if upd else None,
    }


def place_assigner(places: Mapping[str, Any] | None):
    """(lat, lon) WGS84/ETRS89 → place id whose outline contains the point (EPSG:25832), else None."""
    if not places:
        return None
    from pyproj import Transformer
    from shapely import prepared
    from shapely.geometry import Point, shape
    tr = Transformer.from_crs("EPSG:4326", "EPSG:25832", always_xy=True)
    polys = [(f["properties"]["id"], prepared.prep(shape(f["geometry"]))) for f in places.get("features", [])]

    def assign(lat: float, lon: float) -> str | None:
        e, n = tr.transform(lon, lat)
        p = Point(e, n)
        for pid, poly in polys:
            if poly.contains(p):
                return pid
        return None
    return assign


# ================================================================================================ MaStR (I/O)
def mastr_rows(ags: str, *, refresh: bool = False) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """All solar units of one municipality, paged and cached (whitelisted fields only)."""
    cache = MASTR_RAW / f"solar_{ags}"
    meta_p = cache / "meta.json"
    if refresh and cache.exists():
        for p in cache.glob("page_*.json"):
            p.unlink()
    rows: list[dict[str, Any]] = []
    total = None
    page = 1
    while True:
        p = cache / f"page_{page:03d}.json"
        if p.exists():
            d = json.loads(p.read_text())
        else:
            with http_open(mastr_url(ags, page), headers={"Accept": "application/json"}, timeout=120) as r:
                raw = json.loads(r.read())
            if raw.get("Errors"):
                raise RuntimeError(f"MaStR error for {ags}: {raw['Errors']}")
            d = {"Total": raw.get("Total"), "Data": [slim_row(x) for x in raw.get("Data") or []]}
            _write_atomic(p, json.dumps(d, ensure_ascii=False).encode())
            time.sleep(1.0)
        total = d["Total"]
        rows += d["Data"]
        if not d["Data"] or len(rows) >= total:
            break
        page += 1
    old = json.loads(meta_p.read_text()) if meta_p.exists() else {}
    meta = {"ags": ags, "total": total, "pages": page, "page_size": MASTR_PAGE_SIZE,
            "fetched": old.get("fetched") if (old and not refresh) else date.today().isoformat(),
            "filter": mastr_filter(ags), "fields": list(MASTR_FIELDS)}
    _write_atomic(meta_p, json.dumps(meta, ensure_ascii=False, indent=1).encode())
    ids = {r["MaStRNummer"] for r in rows}
    if len(ids) != len(rows) or len(rows) != total:
        print(f"  ! {ags}: {len(rows)} rows, {len(ids)} unique, Total {total}", file=sys.stderr)
    return rows, meta


def run_mastr(*, refresh: bool = False) -> dict[str, Any]:
    places = load_places()
    assign = place_assigner(places)
    out: dict[str, Any] = {
        "format": "sle-orte-mastr-pv-v1", "generated": date.today().isoformat(),
        "source": {"name": "Marktstammdatenregister (MaStR), Bundesnetzagentur",
                   "endpoint": MASTR_URL, "filter": "Gemeindeschlüssel + Energieträger 2495 (Solare Strahlungsenergie)",
                   "licence": "dl-de/by-2-0 (Datenlizenz Deutschland – Namensnennung – Version 2.0)",
                   "attribution": ATTRIBUTION_MASTR},
        "rules": {"totals": "units with BetriebsStatus 'In Betrieb' (35); power = Bruttoleistung (kWp)",
                  "split_kw": MASTR_SPLIT_KW,
                  "balcony": "ArtDerSolaranlage contains 'Steckerfertig'",
                  "small_n": f"per-place aggregates with < {MASTR_MIN_UNITS} units are flagged small_n",
                  "privacy": "aggregates only; no operator names, addresses or unit points are stored (G1–G3). "
                             "Units < 30 kW carry no coordinates in MaStR, so they cannot be split below the "
                             "municipality."},
        "municipalities": [],
    }
    for m in MUNICIPALITIES:
        rows, meta = mastr_rows(m["ags"], refresh=refresh)
        names = Counter(r.get("Gemeinde") for r in rows)
        agg = aggregate_pv(rows, assign=assign)
        out["municipalities"].append({**m, "gemeinde_in_data": dict(names), "fetched": meta["fetched"],
                                      "rows": len(rows), **agg})
        op = agg["in_operation"]
        print(f"  {m['name_de']} ({m['ags']}): {len(rows)} rows, {op['units']} in operation, {op['kwp']} kWp, "
              f"balcony {agg['balcony']['units']}, ≥30 kW {agg['ge_30kw']['units']} "
              f"({agg['ge_30kw_with_coordinates']['units']} with coordinates)", flush=True)
    out["export_date"] = max(x["fetched"] for x in out["municipalities"])
    ORTE_WORK.mkdir(parents=True, exist_ok=True)
    write_json(ORTE_WORK / "mastr_pv.json", out)
    update_inputs("mastr", {"file": "mastr_pv.json", "attribution": [ATTRIBUTION_MASTR],
                            "export_date": out["export_date"]})
    print(f"  wrote {ORTE_WORK / 'mastr_pv.json'}")
    return out


# ================================================================================================ CLI
def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("step", choices=("ndvi", "zensus", "mastr", "all"))
    ap.add_argument("--workers", type=int, default=2, help="parallel SL WMS requests (1–3)")
    ap.add_argument("--keep-jp2", action="store_true", help="keep the ≈ 170 MB RLP DOP20 JP2 tiles")
    ap.add_argument("--overlap-tiles", type=int, default=2,
                    help="extra RLP DOP tiles (≈ 170 MB each) under SL coverage for the SL/RLP NDVI cross-check")
    ap.add_argument("--refresh-mastr", action="store_true", help="re-fetch the MaStR pages (new snapshot)")
    a = ap.parse_args(argv)
    t0 = time.time()
    if a.step in ("zensus", "all"):
        run_zensus()
    if a.step in ("mastr", "all"):
        run_mastr(refresh=a.refresh_mastr)
    if a.step in ("ndvi", "all"):
        run_ndvi(workers=a.workers, keep_jp2=a.keep_jp2, overlap_tiles=a.overlap_tiles)
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
