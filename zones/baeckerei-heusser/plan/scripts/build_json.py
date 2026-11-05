"""Write raumplan-v0.json from model.py (+ LoD2, DGM1, ALKIS parcel)."""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I: own scripts only
import paths  # noqa: E402
import numpy as np
import rasterio
from shapely.geometry import Point, shape

from model import *

PF = private_facts().get("plan", {})   # beyond the shop's passage door: private folder only (bh-datenschutz)

OUT = SP + "raumplan-v0.json"
DTM = str(paths.DTM)


def r2(x):
    return round(float(x), 2)


def r3(x):
    return round(float(x), 3)


def val(v, sigma, source, **kw):
    d = {"v": r2(v), "sigma_m": r2(sigma), "source": source}
    d.update(kw)
    return d


def pt(xy, source, sigma=None, **kw):
    s = sig_pos(xy) if sigma is None else sigma
    d = {"xy": [r3(xy[0]), r3(xy[1])], "sigma_m": r2(s), "source": source}
    d.update(kw)
    return d


# ------------------------------------------------------------------ exterior (survey)
b, ring, roofs, walls = lod2_building(BAKERY)
z_ground = float(np.array(b["ground"][0])[:, 2].min())
eaves = min(float(r[:, 2].min()) for r in roofs)
ridge_front = max(float(r[:, 2].max()) for r in roofs if to_b(r)[:, 0].max() > 20.0)
ridge_max = max(float(r[:, 2].max()) for r in roofs)

edges = []
names = {5: "Straßenfassade (Eckstraße)", 3: "Nordwand (zum Durchgang)", 4: "Eckpfeiler/Fassade Nordende", 1: "Rückwand Vorderhaus"}
for i in range(len(ring) - 1):
    a_, c_ = ring[i], ring[i + 1]
    edges.append({"id": f"L{i}", "from": [r3(a_[0]), r3(a_[1])], "to": [r3(c_[0]), r3(c_[1])],
                  "length": val(np.linalg.norm(c_ - a_), 0.1, "lod2"), "name_de": names.get(i)})

with rasterio.open(DTM) as r:
    def dgm(xy):
        E, N = to_en(np.array(xy))
        return float(list(r.sample([(E, N)]))[0][0])
    dgm_pts = {"strasse_eingang": (23.0, -0.5), "fassade_sued": (0.0, -0.5), "fassade_mitte": (12.0, -0.5),
               "strassenmitte": (20.0, -4.0)}
    dgm_pts.update({k: tuple(v) for k, v in PF.get("dgm_points", {}).items()})   # private sample points (full plan only)
    dgm_vals = {k: {"xy": list(v), "h_nhn": val(dgm(v), 0.15, "dgm1")} for k, v in dgm_pts.items()}

parcels = json.load(open(SP + "work/parcels_near.json"))["features"]
pc = None
for f in parcels:
    if shape(f["geometry"]).contains(Point(*to_en(np.array([20.0, 4.0])))):
        pc = f
parcel = None
if pc:
    ring_p = to_b(np.array(pc["geometry"]["coordinates"][0]))
    parcel = {"kennzeichen": pc["properties"]["flstkennz"], "gemarkung": pc["properties"]["gemarkung"],
              "flur": pc["properties"]["flur"], "nummer": pc["properties"]["text"], "lage": pc["properties"]["lage"],
              "flaeche_amtlich_m2": pc["properties"]["flaeche_m2"],
              "ring": [[r2(x), r2(y)] for x, y in ring_p], "source": "alkis", "sigma_m": 0.1}

nb = []
for x in lod2():
    if x["id"] == BAKERY:
        continue
    rg = to_b(np.array(x["ground"][0]))
    if np.min(np.linalg.norm(rg - np.array([20, 4]), axis=1)) < 25:
        nb.append({"id": x["id"], "funktion_alkis": x["attrs"].get("function"), "measuredHeight": x["attrs"].get("measuredHeight"),
                   "ring": [[r2(p[0]), r2(p[1])] for p in rg], "source": "lod2",
                   "note_de": "überbaut den Durchgang (lt. LoD2 und Video)" if x["id"] == NEIGHBOUR_N else None})

# Kreisel (OSM ring of Ortsstraße ways) -> centre
kreisel_en = np.array([381446.4, 5462198.7])
kreisel_b = to_b(kreisel_en)

# ------------------------------------------------------------------ sales room (mesh)
room_pts = {k: pt(ROOM[k], "mesh") for k in ROOM_ORDER}
area = poly_area([ROOM[k] for k in ROOM_ORDER])


def wall(id_, a, c, kind, face, **kw):
    L = math.dist(ROOM[a] if isinstance(a, str) else a, ROOM[c] if isinstance(c, str) else c)
    d = {"id": id_, "from": a, "to": c, "kind": kind, "face": face, "length": val(L, sig_len(L), "mesh")}
    d.update(kw)
    return d


fv, nu = M["facade_inner_v"], M["north_inner_u"]
walls_out = [
    wall("W1", "A", "B", "aussen", "innen", name_de="Fassade (Schaufensterseite)", lod2_edge="L5",
         thickness=val(fv, sig_len(fv, 0.05, 0.05), "mesh", note="Außenfläche = LoD2 (survey-fest), Innenfläche aus Mesh"),
         survey_fixed=True),
    wall("W2", "B", "C", "glaswand", "innen", name_de="Glas-Seitenwand zum Eingangsvorbau", note="Rahmen u = 21,76..21,83"),
    wall("W3", "C", "D", "glasfront", "innen", name_de="Ladenfront Glas mit Tür"),
    wall("W4", "D", "E", "aussen", "innen", name_de="Nordwand (zum Durchgang)", lod2_edge="L3",
         thickness=val(north_outer_u(2.8) - nu, sig_len(0.47, 0.05, 0.05), "mesh", note="LoD2-Außenfläche minus Mesh-Innenfläche"),
         survey_fixed=True),
    wall("W5", "E", "F", "innen", "innen", name_de="Rückwand Café", thickness=None, note="Rückseite nicht erfasst"),
    wall("W6", "F", "I", "innen", "innen", name_de="Diagonalwand rechts (45°)", thickness=None, note="enthält Öffnung O6"),
    wall("W7", "I", "K", "innen", "innen", name_de="Diagonalwand hinter Theke (Brotregal, 45°)", thickness=None),
    wall("W8", "K", "A", "innen", "innen", name_de="Seitenwand SW", thickness=None, note="enthält Öffnung O7 (geschätzt)"),
]


def opening(id_, typ, wall_id, a, c, name, source, edge=0.05, **kw):
    w = math.dist(a, c)
    d = {"id": id_, "type": typ, "wall": wall_id, "from": [r3(a[0]), r3(a[1])], "to": [r3(c[0]), r3(c[1])],
         "width": val(w, sig_len(w, edge, edge), source), "name_de": name}
    d.update(kw)
    return d


openings = [
    opening("O1", "fenster", "W1", (M["win1_sw_u"], 0), (M["pier1_sw_u"], 0), "Schaufenster 1", "mesh", edge=0.15,
            sill=val(0.05, 0.10, "mesh", ref="FFB"), head=val(1.90, 0.25, "mesh", ref="FFB"),
            note="SW-Laibung unscharf (Glas/Spiegelung)"),
    opening("O2", "fenster", "W1", (M["pier1_ne_u"], 0), (M["pier2_sw_u"], 0), "Schaufenster 2", "mesh",
            sill=val(0.05, 0.10, "mesh", ref="FFB"), head=val(1.90, 0.25, "mesh", ref="FFB")),
    opening("O3", "eingang_vorbau", None, (M["pier2_ne_u"], 0), (M["pillar_sw_u"], 0), "Eingang (offener Vorbau, Straßenseite)", "mesh",
            head=val(2.00, 0.25, "mesh", ref="FFB", note="Bogen, Scheitel ≈ 2,0")),
    opening("O4", "tuer", "W3", ROOM["C"], ROOM["D"], "Ladentür (Glasfront, zweiflüglig)", "mesh",
            note="Breite = ganze Glasfront; lichte Türbreite und Flügel nicht bestimmt"),
    opening("O5", "durchgang", None, (M["north_inner_u"] + 0.2, M["pillar_v"]), (M["north_inner_u"] + 0.2, M["glass_front_v"]),
            "Vorbau seitlich offen zum Durchgang", "mesh", edge=0.1),
    opening("O6", "durchgang", "W6", ROOM["G"], ROOM["H"], "Durchgang hinten (Lager/Backstube, nicht erfasst)", "mesh", edge=0.08,
            clear_width=val(M["corridor_e_u"] - M["corridor_w_u"], sig_len(0.94, 0.1, 0.05), "mesh"),
            leads_to="R-nicht-erfasst", note="Flur 0,94 breit bis y = 7,14, dort Tür (Türblatt im Video)"),
    opening("O7", "durchgang", "W8", (M["sw_wall_u"], M["bkst_door_v"][0]), (M["sw_wall_u"], M["bkst_door_v"][1]),
            "Durchgang Backstube (nicht erfasst)", "photo+mesh", edge=0.3, status="geschaetzt", leads_to="R-nicht-erfasst",
            note="Foto zeigt Öffnung links hinter dem Gitterregal; im Mesh ist die Wand geschlossen (Türblatt?)"),
] + PF.get("openings", [])

ct0, ct1 = M["counter_t"]; cc0, cc1 = M["counter_c"]
st0, st1 = M["shelf_t"]


def fixture(id_, typ, name, origin, rot_deg, size, source, sigma, **kw):
    d = {"id": id_, "type": typ, "name_de": name,
         "pose": {"xy": [r3(origin[0]), r3(origin[1])], "z": 0.0, "rot_deg": round(rot_deg, 1)},
         "size": {k: (r2(v) if v is not None else None) for k, v in size.items()},
         "source": source, "sigma_m": r2(sigma), "status": "geschaetzt"}
    d.update(kw)
    return d


fixtures = [
    fixture("F1", "theke", "Theke mit Vitrine", td(ct0, cc1), 45.0,
            {"l": ct1 - ct0, "d": cc1 - cc0, "h": M["counter_glass_h"]}, "mesh", sig_pos(td(ct0, cc1)),
            parts=[{"id": "sockel", "h": val(M["counter_base_h"], 0.10, "mesh"), "note_de": "dunkelroter Sockel, Granitablage kundenseitig"},
                   {"id": "vitrine", "h": val(M["counter_glass_h"], 0.20, "mesh"), "note_de": "Glasaufsatz, 2 Ebenen (Foto); im Mesh kaum vorhanden"}],
            front="kundenseite = +y_lokal gedreht (Seite zur Ladenfront)", note_de="SW-Ende gerundet (Foto/Video)",
            length=val(ct1 - ct0, sig_len(ct1 - ct0, 0.15, 0.05), "mesh"), depth=val(cc1 - cc0, sig_len(1.09, 0.05, 0.05), "mesh"),
            slots=[{"id": "vitrine-oben", "z": 1.05, "l": ct1 - ct0 - 0.3, "d": 0.5}, {"id": "vitrine-unten", "z": 0.75, "l": ct1 - ct0 - 0.3, "d": 0.6}]),
    fixture("F2", "regal", "Brotregal (Messing, schräge Stangenböden)", td(st0, M["shelf_front_c"]), 45.0,
            {"l": st1 - st0, "d": M["shelf_front_c"] - M["back_wall_c"], "h": 2.0}, "mesh+photo", sig_pos(td(st0, M["shelf_front_c"])),
            length=val(st1 - st0, sig_len(st1 - st0, 0.2, 0.2), "mesh"),
            slots=[{"id": f"ebene-{i}", "z": z, "l": r2(st1 - st0), "d": 0.40, "neigung_deg": 25, "note_de": n}
                   for i, (z, n) in enumerate([(0.55, "Körbe mit Brötchen"), (0.95, "Boden 1"), (1.25, "Boden 2"), (1.55, "Boden 3"), (1.85, "Boden 4")])],
            note_de="Wandseitig, gegenüber der Theke; Preisschilder auf Schienen (Foto)"),
    fixture("F3", "regal", "Gitterregal (Brottüten)", (M["sw_wall_u"] + 0.45, M["rack_v"][0]), 90.0,
            {"l": M["rack_v"][1] - M["rack_v"][0], "d": 0.45, "h": 1.8}, "photo", 0.5,
            note_de="laut Foto links, vor dem Durchgang Backstube; Lage geschätzt"),
    fixture("F4", "werbetafel", "Zeitungs-Werbetafel", td(17.55, 12.80), 45.0, {"l": 0.35, "d": 0.25, "h": 1.2}, "photo+mesh", 0.6,
            note_de="am rechten (NO-)Ende der Theke, Kundenseite"),
    fixture("F5", "tisch", "Bistrotisch (Café)", (20.95, 1.30), 0.0, {"l": 0.6, "d": 0.6, "h": 0.75}, "mesh+video", 0.5, form="rund"),
    fixture("F6", "tisch", "Bistrotisch (Café)", (23.00, 2.75), 0.0, {"l": 0.6, "d": 0.6, "h": 0.75}, "mesh+video", 0.5, form="rund"),
    fixture("F7", "regal", "Warenregal / Kühlschrank", (22.25, M["cafe_back_v"] - 0.40), 0.0,
            {"l": M["north_inner_u"] - 22.25, "d": 0.40, "h": 1.9}, "mesh+video", 0.4, note_de="an der Café-Rückwand (Video)"),
    fixture("F8", "leuchte", "Pendelleuchte", td(15.2, 11.95), 0.0, {"l": 0.25, "d": 0.25, "h": None}, "photo", 0.6, z_mount="Decke"),
    fixture("F9", "leuchte", "Pendelleuchte", td(16.7, 11.95), 0.0, {"l": 0.25, "d": 0.25, "h": None}, "photo", 0.6, z_mount="Decke"),
    fixture("F10", "decke", "Abhängung Holz mit roter Kante (über Theke)", td(13.9, 12.6), 45.0,
            {"l": 18.4 - 13.9, "d": 12.6 - M["back_wall_c"], "h": None}, "photo+mesh", 0.6,
            underside=val(2.00, 0.25, "mesh", ref="FFB", note="Abhängung 1,9-2,1 im Mesh, unsicher")),
]

ext_fixtures = PF.get("site_fixtures", [])

wandmalerei = {"id": "X2", "type": "wandmalerei", "name_de": "Wandmalerei über Pavillon", "status": "unbestaetigt",
               "source": "nutzerangabe", "pose": None, "sigma_m": None,
               "candidate": {"wall": "L6/L7 (Südgiebel, Blickrichtung 205,7° genau auf den Kreisel)", "xy": [0.0, 3.4]},
               "note_de": "laut Nutzer vom Kreisel sichtbar (Google Maps); nicht im Video, kein Bild vorhanden – Lage am Südgiebel nur vermutet"}

steps = {"id": "S1", "type": "treppe", "name_de": "Eingangsstufen", "from_v": 0.0, "to_v": M["landing_v"],
         "x_range": [M["pier2_ne_u"], M["pillar_sw_u"]], "risers": M["steps"],
         "rise": val(M["step_rise"], 0.02, "mesh"), "tread": val(M["step_tread"], 0.04, "mesh"),
         "total_rise": val(-M["street_h"], 0.08, "mesh+dgm1"), "landing": val(M["glass_front_v"] - M["landing_v"], 0.06, "mesh")}

doc = {
    "schema": "sle-raumplan/0.1",
    "id": "baeckerei-heusser",
    "name_de": "Bäckerei Heusser – Raumplan v0 (Außen + Verkaufsraum)",
    "address": "Eckstraße 3, 66424 Homburg-Kirrberg",
    "status": "entwurf",
    "created": "2026-11-05",
    "statement_de": "Entwurf aus LoD2 + Videoaufnahme, Maße ±11 % bis Aufmaß. Werte mit source=mesh skalieren mit einem einzigen Bandmaß (siehe scale).",
    "crs": {"horizontal": "EPSG:25832", "vertical": "DHHN2016 (m ü. NHN)"},
    "frame": {
        "name": "B",
        "description_de": "Lokales Gebäudesystem: Ursprung = SSW-Ende der LoD2-Straßenfassade, x entlang der Fassade nach NNO, y senkrecht ins Gebäude (WNW), z nach oben ab ±0,00",
        "origin": {"E": r3(ORIGIN[0]), "N": r3(ORIGIN[1]), "source": "lod2", "sigma_m": 0.1},
        "x_axis_bearing_deg": round(BEARING_X, 3),
        "y_axis_bearing_deg": round((BEARING_X - 90) % 360, 3),
        "x_axis_EN": [round(float(UX[0]), 6), round(float(UX[1]), 6)],
        "y_axis_EN": [round(float(VX[0]), 6), round(float(VX[1]), 6)],
        "to_epsg25832": "E = origin.E + x*x_axis_EN[0] + y*y_axis_EN[0];  N = origin.N + x*x_axis_EN[1] + y*y_axis_EN[1]",
        "z0_m_nhn": val(H0, 0.10, "mesh+dgm1", meaning="±0,00 = Fertigfußboden Verkaufsraum"),
        "zone_local": {"E0": E0z, "N0": N0z, "note": "explorer zone frame: x = E - E0, y = h, z = -(N - N0)"},
    },
    "scale": {
        "applies_to": "alle Werte mit source enthält 'mesh'",
        "factor": 1.0, "source": "camera-height", "rel_sigma": REL,
        "pivot_xy": [r3(PIVOT[0]), r3(PIVOT[1])], "pivot_note": "= LoD2-Nordostecke = capture.scale.pivotLocal der Zone",
        "rule": "xy' = pivot + factor*(xy - pivot); Längen und Höhen über ±0,00: L' = factor*L",
        "how_to_fix": "Messliste A messen: factor = Band / Planwert; dann sigma_m aller mesh-Werte neu: sqrt(0.16^2 + (0.01*d)^2)",
    },
    "uncertainty_model": {
        "mesh_point": "sigma = sqrt(0.16^2 + 0.03^2 + (0.111 * Abstand zum pivot)^2)",
        "mesh_length": "sigma = sqrt(e1^2 + e2^2 + (0.111 * L)^2), e = Kantenschärfe 0.03 (Wandfläche) .. 0.3 (Foto)",
        "lod2": "Grundriss ±0.10, Dachhöhen ±0.30", "dgm1": "±0.15", "tape": "±0.01 (Ziel)",
    },
    "sources": [
        {"id": "lod2", "name": "LoD2-Gebäudemodell Saarland", "licence": "dl-de/by-2-0", "attribution": "© GeoBasis-DE/LVGL-SL (2026)"},
        {"id": "dgm1", "name": "DGM1 Saarland (ALS 2025)", "licence": "dl-de/by-2-0", "attribution": "© GeoBasis-DE/LVGL-SL (2026)"},
        {"id": "alkis", "name": "ALKIS-Flurstücke (WFS)", "licence": "dl-de/by-2-0", "attribution": "© GeoBasis-DE/LVGL-SL (2026)"},
        {"id": "osm", "name": "OpenStreetMap (Straßen, Kreisel)", "licence": "ODbL", "attribution": "© OpenStreetMap-Mitwirkende"},
        {"id": "mesh", "name": "Handvideo 2026-11-04 → Apple Object Capture, georef. an LoD2/DGM1", "licence": "eigenes Werk, mit Erlaubnis der Inhaber"},
        {"id": "photo", "name": "private Referenzfotos (Theke, Brotregal)", "licence": "nur Layout-Referenz, nicht veröffentlichen"},
        {"id": "tape", "name": "Bandmaß/Laser vor Ort (Messliste)", "licence": "eigenes Werk"},
    ],
    "site": {
        "parcel": parcel,
        "building": {
            "id": BAKERY, "funktion_alkis": b["attrs"].get("function"), "funktion_de": "Gemischt genutztes Gebäude mit Wohnen",
            "roofType": b["attrs"].get("roofType"), "measuredHeight": val(float(b["attrs"]["measuredHeight"]), 0.3, "lod2"),
            "footprint": {"ring": [[r3(x), r3(y)] for x, y in ring], "area": val(poly_area(ring[:-1]), 1.0, "lod2"), "source": "lod2", "sigma_m": 0.1},
            "edges": edges,
            "ground_lod2": val(z_ground - H0, 0.15, "lod2", h_nhn=r2(z_ground)),
            "eaves": val(eaves - H0, 0.3, "lod2", h_nhn=r2(eaves), note="Traufe Straßenseite"),
            "ridge_front": val(ridge_front - H0, 0.3, "lod2", h_nhn=r2(ridge_front), note="First Vorderhaus, parallel zur Straße bei y ≈ 4,5"),
            "ridge_max": val(ridge_max - H0, 0.3, "lod2", h_nhn=r2(ridge_max)),
            "street_side": "x-Achse (y = 0), Eckstraße", "entrance_side": "Straßenseite am Nordende (offener Eckvorbau, x 21,83..24,40) + seitlich zum überbauten Durchgang",
            "survey_fixed_faces": ["W1 außen (y = 0)", "W4 außen (LoD2-Kante L3)", "Nordostecke = pivot"],
        },
        "neighbours": nb,
        "dgm1": dgm_vals,
        "streets": [{"name": "Eckstraße", "side": "y < 0", "source": "osm"},
                    {"name": "Kreisel Ortsstraße/Mörsbacher Straße/Am Dorfplatz", "centre_xy": [r2(kreisel_b[0]), r2(kreisel_b[1])],
                     "distance_from_origin_m": r2(np.linalg.norm(kreisel_b)), "source": "osm"}],
        "passage": {"id": "P1", "name_de": PF.get("passage", {}).get("name_de", "Durchgang (überbaut)"), "x_range": [r2(north_outer_u(0)), M["passage_far_u"]],
                    "clear_width": val(M["passage_far_u"] - M["north_outer_mesh_u"], sig_len(2.87, 0.05, 0.05), "mesh"),
                    "floor": val(M["passage_h"], 0.08, "mesh+dgm1"), "note_de": PF.get("passage", {}).get("note_de", "hinterer Teil nicht erfasst")},
        "fixtures": ext_fixtures + [wandmalerei],
    },
    "levels": [{
        "id": "EG", "name_de": "Erdgeschoss", "z": 0.0,
        "rooms": [
            {"id": "R1", "name_de": "Verkaufsraum", "status": "erfasst", "source": "mesh",
             "floor": val(0.0, 0.10, "mesh+dgm1", h_nhn=H0), "ceiling": val(M["ceiling_h"], sig_len(M["ceiling_h"], 0.05, 0.05), "mesh", note="abgehängte Platten; Sturz über Schaufenstern ≈ 2,05"),
             "area": val(area, area * 2 * REL, "mesh", unit="m2"),
             "points": room_pts, "polygon": ROOM_ORDER, "walls": walls_out, "openings": openings, "fixtures": fixtures,
             "zones": [{"id": "Z1", "name_de": "Kundenbereich / Café", "note_de": "zwischen Ladenfront, Fenstern und Theke"},
                       {"id": "Z2", "name_de": "Gang hinter der Theke", "width": val(cc0 - M["shelf_front_c"], sig_len(0.87, 0.05, 0.05), "mesh")},
                       {"id": "Z3", "name_de": "Arbeitsplatz am Schaufenster 1 (Brotschneidemaschine)", "status": "geschaetzt"}],
             "notes_de": ["Fußboden hinter der Theke im SW-Teil evtl. +0,15..0,20 (Podest?) – Spiegelboden, unsicher"]},
            {"id": "R-vorbau", "name_de": "Eingangsvorbau (offen)", "status": "erfasst", "source": "mesh",
             "polygon_xy": [[M["pier2_ne_u"], 0.0], [M["pillar_sw_u"], 0.0], [M["pillar_sw_u"], M["pillar_v"]], [north_outer_u(1.0), M["pillar_v"]],
                            [north_outer_u(1.5), M["glass_front_v"]], [M["pier2_ne_u"], M["glass_front_v"]]],
             "stairs": [steps]},
            {"id": "R-nicht-erfasst", "name_de": None, "status": "nicht_erfasst",
             "note_de": "Rest des LoD2-Grundrisses (Backstube, Lager, Wohnteil); Umriss = LoD2 minus R1/R-vorbau"},
        ],
    }],
    "variants": [{"id": "bestand-2026", "name_de": "Bestand Nov. 2026", "base": None, "patches": []}],
    "fixture_frame": "Fixture-Ursprung = vordere Ecke am Anfang der Länge (Zugangsseite: Kunde bzw. Gang), x entlang l, y von der Vorderkante in die Tiefe d, z nach oben ab pose.z; rot_deg = Winkel von x_fixture gegen x_B (gegen den Uhrzeigersinn). Runde Tische: Ursprung = Mitte.",
    "catalogue_placements": [
        {"example": True, "item": "katalog:holzofen-bauernlandbrot", "fixture": "F2", "slot": "ebene-3", "s": 0.40, "count": 6,
         "note": "s = Lage entlang des Fixtures (0..1 von dessen Ursprung); Höhe/Neigung kommt vom Slot"}
    ],
    "measurements": "messliste.md (A–J); Ergebnisse als source=tape-Werte hier eintragen und scale.factor setzen",
}

json.dump(doc, open(OUT, "w"), ensure_ascii=False, indent=1)
print("wrote", OUT, "area", round(area, 2), "eaves", eaves, "ridge", ridge_front, ridge_max, "kreisel", kreisel_b, np.linalg.norm(kreisel_b))
print("parcel", parcel and (parcel["nummer"], parcel["lage"], parcel["flaeche_amtlich_m2"]))
print("dgm", {k: v["h_nhn"]["v"] for k, v in dgm_vals.items()})
