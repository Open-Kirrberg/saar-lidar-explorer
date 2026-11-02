"""Convert the POI seed tables of the research notes into app/public/data/pois.geojson (data contract).

Sources:
  research/03-archaeology-visualization.md  Part B, table "B2–B3. POI table" (primary)
  research/01-data-sources.md               §5 focus points (merged when within DEDUPE_M of a primary POI)

Usage:  uv run python pois.py
"""
from __future__ import annotations

import json
import math
import re

from pyproj import Transformer

from common import APP_DATA, ROOT

DEDUPE_M = 80
R03 = ROOT / "research" / "03-archaeology-visualization.md"
R01 = ROOT / "research" / "01-data-sources.md"

# German display names + contract types per row number of the research/03 table.
DE = {
    1: ("Schloss Karlsberg – Hauptschloss (Ruinen)", "palace"),
    2: ("Orangerie (Ruine)", "palace"),
    3: ("Ruine westlich des Schlosses (am Karlsbergweiher)", "palace"),
    4: ("Karlsbergweiher (mit Insel)", "garden"),
    5: ("Eiskeller", "palace"),
    6: ("Brunnen am alten Forsthaus", "other"),
    7: ("Karlsberg-Gipfelplateau (383 m)", "other"),
    8: ("Bärenzwinger (Karlslust)", "garden"),
    9: ("Herzogsterrassen (Bärenkäfige, 1786)", "garden"),
    10: ("Schwanenweiher (3 Weiher)", "garden"),
    11: ("Tosbecken / Kaskade (Karlslust)", "garden"),
    12: ("Tschifflik-Pavillon (Ruine)", "palace"),
    13: ("Eremitage (Karlslust)", "garden"),
    14: ("„Räuberhöhle“ (Keller des Kavaliersbaus)", "palace"),
    15: ("Karlsberger Hof", "palace"),
    16: ("Grenzstein „D/S“", "boundary_stone"),
    17: ("Burgruine Merburg", "castle"),
    18: ("Fischweiher Kirrberg", "other"),
    19: ("Kirrberg – Wallfahrtskirche Mariä Himmelfahrt", "other"),
    22: ("Keltische Grabhügel „Rabenhorst“ (9 Hügel)", "burial_mound"),
    23: ("Keltischer Grabhügel (beim Schwanenweiher)", "burial_mound"),
    24: ("Pyramidenstein / Totenstein (Menhir)", "other"),
    25: ("Hallstatt-Grabhügel am Stumpfen Gipfel", "burial_mound"),
    26: ("Burgruine Hohenburg + Vauban-Festung (Schlossberg)", "castle"),
    27: ("Schlossberghöhlen", "cave"),
    28: ("Ruine östlich des Schlossbergs", "other"),
    29: ("Römermuseum Schwarzenacker (gallo-römischer Vicus)", "other"),
    30: ("Hügel „Gloria Romanorum“ (Wörschweiler)", "burial_mound"),
    31: ("Klosterruine Wörschweiler", "other"),
    32: ("Turmruine Beeden", "castle"),
    33: ("Bunker (gesprengt), südlich Homburg", "bunker"),
    34: ("Bunker (Ruine), südlich Kirrberg", "bunker"),
    35: ("Bunker (Kampfstand), Rothenbergerhof", "bunker"),
    36: ("Bunker bei Oberauerbach (3 Anlagen)", "bunker"),
    37: ("Bunker (Ruine), Rosenkopf / Bechhofen", "bunker"),
    38: ("Alter Stolleneingang", "mine"),
    39: (["Felsenkeller (Schwarzenacker–Einöd)", "Schlangenhöhle (Schwarzenacker–Einöd)"], "cave"),
    40: ("Sandgrube", "mine"),
    41: ("Homburg Innenstadt (Luftangriffe 1944/45 – Bombentrichter?)", "other"),
    42: ("Königsbrucherhof (1766)", "other"),
    43: ("Napoleon-Stein (Schelmenkopf)", "other"),
    44: ("Jägersburg „Kulturwald“: Grabhügel + Gustavsburg", "burial_mound"),
}

# Candidate hilltops named in row 20 ("early Celtic hilltop fortifications … still visible", location unknown).
EXTRA = [
    ("hill-zimmermannsberg", "Zimmermannsberg (mögliche Höhenbefestigung?)", 49.3122, 7.3859),
    ("hill-tobisberg", "Tobisberg (mögliche Höhenbefestigung?)", 49.3080, 7.3933),
    ("hill-kastenbuehl", "Kastenbühl (mögliche Höhenbefestigung?)", 49.3127, 7.3990),
]
EXTRA_NOTE = ("research/03 #20: frühkeltische Höhenbefestigungen (1000–800 v. Chr.) auf den Höhen nördlich "
              "Kirrberg laut de.wikipedia „noch sichtbar“, Lage unbekannt – Kandidat für die LiDAR-Suche.")
EXTRA_SRC = "https://de.wikipedia.org/wiki/Kirrberg_(Homburg)"

FOCUS_DE = {
    "Kirrberg village centre": "Kirrberg Ortsmitte",
    "Burgruine Merburg": "Burgruine Merburg",
    "Schloss Karlsberg": "Schloss Karlsberg",
    "Karlsberg Orangerie ruin": "Orangerie (Ruine)",
    "Karlsberg Eiskeller": "Eiskeller",
    "Karlsberg ruins": "Karlsberg-Ruinen",
    "Tschifflik pavilion ruin": "Tschifflik-Pavillon (Ruine)",
    "Celtic burial mounds": "Keltischer Grabhügel",
    "Homburg Marktplatz": "Homburg Marktplatz",
    "Schlossberg / Burgruine Hohenburg": "Burgruine Hohenburg",
    "Schlossberghöhlen": "Schlossberghöhlen",
}

_geod = Transformer.from_crs("EPSG:4326", "EPSG:25832", always_xy=True)


def dist_m(a, b) -> float:
    ea, na = _geod.transform(a[1], a[0])
    eb, nb = _geod.transform(b[1], b[0])
    return math.hypot(ea - eb, na - nb)


def osm_url(lat, lon) -> str:
    return f"https://www.openstreetmap.org/?mlat={lat:.5f}&mlon={lon:.5f}#map=18/{lat:.5f}/{lon:.5f}"


def md_text(s: str) -> str:
    s = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r"\1", s)
    return re.sub(r"\*\*|`", "", s).strip()


def parse_coords(lat_s: str, lon_s: str):
    """→ list of (lat, lon, approx). Handles '~', 'a / b' (several points) and 'a–b' (range → midpoint)."""
    lat_s, lon_s = lat_s.strip(), lon_s.strip()
    if "?" in lat_s or "?" in lon_s or not re.search(r"\d", lat_s):
        return []
    approx = "~" in lat_s or "~" in lon_s
    lats = [p.strip(" ~") for p in lat_s.split("/")]
    lons = [p.strip(" ~") for p in lon_s.split("/")]
    if len(lons) == 1 and len(lats) > 1:
        lons = lons * len(lats)
    out = []
    for la, lo in zip(lats, lons):
        def val(x):
            parts = [float(v) for v in re.split(r"[–-]", x) if v]
            return sum(parts) / len(parts), len(parts) > 1
        (lat, r1), (lon, r2) = val(la), val(lo)
        decimals = min(len(la.split(".")[-1].split("–")[0]), len(lo.split(".")[-1].split("–")[0]))
        out.append((lat, lon, approx or r1 or r2, decimals))
    return out


def confidence(s: str) -> str:
    s = s.strip().lower()
    for word, val in (("high", "high"), ("med", "med"), ("low", "low")):
        if s.startswith(word):
            return val
    return "low"


def read_table(path, header_start: str) -> list[list[str]]:
    lines = path.read_text().splitlines()
    i = next(k for k, l in enumerate(lines) if l.startswith(header_start))
    rows = []
    for l in lines[i + 2:]:
        if not l.startswith("|"):
            break
        rows.append([c.strip() for c in l.strip().strip("|").split("|")])
    return rows


def main():
    feats, skipped = [], []
    for row in read_table(R03, "| # | Name | Type | Lat"):
        num, name_en, typ_en, lat_s, lon_s, conf_s, src = row[:7]
        n = int(num)
        coords = parse_coords(lat_s, lon_s)
        if not coords or min(c[3] for c in coords) < 3:  # missing or only ~1 km precise
            skipped.append(f"#{n} {name_en} ({lat_s}, {lon_s})")
            continue
        name_de, typ = DE.get(n, (name_en, "other"))
        urls = re.findall(r"\((https?://[^)\s]+)\)", src)
        for k, (lat, lon, approx, _) in enumerate(coords):
            nm = name_de[k] if isinstance(name_de, list) else name_de
            src_urls = list(urls)
            if "OSM" in src or not src_urls:
                src_urls.append(osm_url(lat, lon))
            note = f"{md_text(typ_en)}. {md_text(src)}"
            if approx:
                note += " (Lage ungefähr)"
            feats.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
                "properties": {
                    "id": f"r03-{n:02d}" + (chr(ord("a") + k) if len(coords) > 1 else ""),
                    "name": nm,
                    "name_en": md_text(name_en),
                    "type": typ,
                    "confidence": "low" if approx and confidence(conf_s) == "high" else confidence(conf_s),
                    "source": src_urls[0],
                    "sources": src_urls,
                    "note": note,
                },
            })
    for pid, nm, lat, lon in EXTRA:
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
                      "properties": {"id": pid, "name": nm, "name_en": nm, "type": "other", "confidence": "low",
                                     "source": EXTRA_SRC, "sources": [EXTRA_SRC, osm_url(lat, lon)],
                                     "note": EXTRA_NOTE}})

    merged = 0
    for row in read_table(R01, "| Focus point |"):
        name_en = md_text(row[0])
        coords = [tuple(float(v) for v in p.split(",")) for p in row[1].split("/")]
        base = re.sub(r"\s*\(.*\)$", "", name_en).strip()
        for lat, lon in coords:
            near = [f for f in feats if dist_m((lat, lon), f["geometry"]["coordinates"][::-1]) < DEDUPE_M]
            if near:
                p = near[0]["properties"]
                p["note"] += f" | Fokuspunkt research/01 §5: {name_en} ({lat:.5f}, {lon:.5f})"
                merged += 1
                continue
            feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
                          "properties": {"id": f"r01-{len(feats):02d}", "name": FOCUS_DE.get(base, base),
                                         "name_en": name_en, "type": "other", "confidence": "med",
                                         "source": osm_url(lat, lon), "sources": [osm_url(lat, lon)],
                                         "note": "OSM/Nominatim, research/01 §5"}})
    ids = [f["properties"]["id"] for f in feats]
    assert len(ids) == len(set(ids)), "duplicate ids"
    fc = {"type": "FeatureCollection",
          "name": "Saar LiDAR Explorer – bekannte Orte (Seed)",
          "attribution": "Koordinaten überwiegend © OpenStreetMap-Mitwirkende (ODbL); siehe source je Objekt",
          "features": feats}
    APP_DATA.mkdir(parents=True, exist_ok=True)
    out = APP_DATA / "pois.geojson"
    out.write_text(json.dumps(fc, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {out}: {len(feats)} POIs ({merged} research/01 focus points merged as duplicates)")
    for s in skipped:
        print(f"  skipped (no/too vague coordinates): {s}")


if __name__ == "__main__":
    main()
