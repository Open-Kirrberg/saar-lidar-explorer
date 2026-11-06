"""Round 3b (facade + exterior) values for the Raumplan: `site.facade`, read from the street frames of the walkthrough
video and the Street View screenshots (reference only, nothing copied), anchored where possible to the LoD2 facade
and the capture mesh.

One source of truth for both ways the public plan is written:
  * `build_json.py` (regen from the private work files) calls `facade()` for `site["facade"]`;
  * `python3 -I exterior_r3.py [raumplan-v0.json]` writes the same block into an existing plan file (idempotent).

Frame B: x along the street facade (y = 0 is the LoD2 outer face, the street is y < 0), z above ±0.00. Positions read
off perspective photos (`source: "photo"`) carry σ ≈ 0.3–0.6 m; features also seen in the capture mesh (`mesh+video`)
≈ 0.15 m. These values are survey-anchored (LoD2 facade, DGM1 pavement) and are NOT scaled by the plan's scale factor;
the shop windows O1/O2 (mesh) are, and the window surrounds follow them.

2026-11-06 (wave A, ADR 0047): the Backstube entrance (recessed niche with terrazzo steps at the SSW end of the street
facade, exterior only, door closed), trapezoid keystones with the Fraktur inscription, the passage paving and plinth
band, and the pickup cabinet X1 (`site_fixtures`, now public: it stands in front of the passage privacy line, frame B
y = 4.35). Nothing here lies beyond that line (bh-datenschutz).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def val(v, sigma, source="photo", **kw):
    d = {"v": round(float(v), 2), "sigma_m": round(float(sigma), 2), "source": source}
    d.update(kw)
    return d


def span(x0, x1, sigma, source="photo", **kw):
    """A feature on the street facade from x0 to x1 (frame B, y = 0)."""
    d = {"from": [round(float(x0), 2), 0.0], "to": [round(float(x1), 2), 0.0], "width": val(x1 - x0, sigma, source)}
    d.update(kw)
    return d


def facade() -> dict:
    return {
        "note_de": ("Fassade und Außenansicht (Runde 3b) aus Standbildern des Handvideos und Street-View-Ansichten "
                    "(nur Referenz). Lagen aus Fotos σ ≈ 0,3–0,6 m; nicht mit dem Maßstabsfaktor skaliert (an der "
                    "LoD2-Fassade verankert)."),
        "putz": {"note_de": "rosa-beiger Rauputz (Video, auf Weiß normiert)"},
        # ---- plinth: sandstone slips (red/light), cap stone; top = sill of the shop windows
        "sockel": {"top": val(0.05, 0.05, "mesh+video", ref="FFB"), "cap_h": val(0.08, 0.02, "video"),
                   "cap_proj": val(0.06, 0.02, "video"), "rows": [0.15, 0.19, 0.13, 0.17],
                   "note_de": "Sandstein-Riemchen, rote und helle im Wechsel, mit Abdeckplatte (= Fensterbank der Schaufenster)"},
        # ---- glass-block panel at the SSW end of the street facade (stairwell light), lifted off the plinth cap
        "glasbausteine": span(2.70, 6.30, 0.6, sill=val(0.13, 0.1, "video"), head=val(3.30, 0.4),
                              raster=0.25, recess=val(0.06, 0.03, "video"),
                              note_de="Glasbausteine im Flechtverband, blassgrün; die Eckseite im Rücksprung gehört zum Backstube-Eingang"),
        # ---- wide window with a closed roller shutter between the glass blocks and the pilaster
        "fenster_rollladen": span(8.30, 11.40, 0.6, sill=val(1.15, 0.3), head=val(2.95, 0.3), recess=val(0.14, 0.05, "video"),
                                  note_de="Rollladen geschlossen, nichts dahinter"),
        # ---- sandstone pilaster (with a downpipe beside it) and the corner quoins at the SSW corner
        "lisene": {"x": val(15.22, 0.15, "mesh+video"), "width": val(0.42, 0.08, "video"), "course": val(0.30, 0.05, "video"),
                   "note_de": "Sandstein-Lisene vom Sockel bis zur Traufe"},
        "eckquader": {"corner": [0.0, 0.0], "long": val(0.46, 0.08), "short": val(0.28, 0.08), "course": val(0.32, 0.05),
                      "note_de": "rote Eckquader an der SSW-Ecke (Straße/Giebel), lang und kurz im Wechsel"},
        "fallrohre": [{"x": val(0.32, 0.3), "note_de": "an der SSW-Ecke"},
                      {"x": val(15.62, 0.15, "mesh+video"), "note_de": "neben der Lisene, Sockelknie"}],
        "dachrinne": {"note_de": "halbrunde Rinne an der Traufe der Straßenseite (Traufe = LoD2)"},
        # ---- shop-window surrounds (O1/O2 from the mesh, so these follow the plan's scale)
        "gewaende": {"band": val(0.27, 0.05), "course": val(0.29, 0.05), "head_h": val(0.34, 0.05), "proj": val(0.035, 0.01, "video"),
                     "note_de": "Sandstein-Gewände: Eckquader abwechselnd lang/kurz, Sturz aus Quadern mit Schlussstein"},
        # keystones are trapezoids (Street View 2026-11-06: wider at the top), rising ≈ 0.08 above the head row
        "schlusssteine": [
            {"id": "schlussstein-1", "opening": "O1", "w": val(0.44, 0.06), "w_top": val(0.48, 0.06), "w_bottom": val(0.40, 0.06),
             "h": val(0.44, 0.06), "motiv": "brezel", "note_de": "Trapez; Brezel im Kreis als Relief"},
            {"id": "schlussstein-2", "opening": "O2", "w": val(0.44, 0.06), "w_top": val(0.48, 0.06), "w_bottom": val(0.40, 0.06),
             "h": val(0.44, 0.06), "motiv": "inschrift",
             "inschrift": [{"text": "H.H.", "schrift": "fraktur", "h": val(0.18, 0.03)},
                           {"text": "AD 1933", "schrift": "fraktur", "h": val(0.065, 0.015)}],
             "note_de": "Trapez; Inschrift „H.H.“ in Frakturschrift über „AD 1933“, Relief im selben Stein (Schriftzug der Bäckerei, ADR 0044)"},
        ],
        "kellergitter": [{"x": val(16.25, 0.15, "mesh+video")}, {"x": val(17.95, 0.15, "mesh+video")}, {"x": val(20.05, 0.15, "mesh+video")}],
        "kellergitter_z": val(-0.45, 0.1, "mesh"), "kellergitter_size": {"w": 0.45, "h": 0.25},
        # ---- projecting sign on the pier between shop window 2 and the porch
        "ausleger_schild": {"x": val(21.53, 0.2, "video"), "z0": val(2.40, 0.2, "video"), "w": val(0.45, 0.05, "video"),
                            "h": val(0.70, 0.05, "video"), "d": 0.12, "arm": val(0.62, 0.1, "video"),
                            "note_de": "neutrale Grafik (Ofenbogen und Brot); Name nur mit Build-Flag `--lettering`"},
        # ---- upper floor windows above the shop (Street View; position by a perspective fit, σ 0.5)
        "obergeschoss_fenster": [{"x": val(c, 0.5)} for c in (16.6, 19.5, 21.3, 23.3)],
        "obergeschoss_fenster_size": {"w": val(0.95, 0.2), "sill": val(3.30, 0.4), "head": val(4.95, 0.4)},
        # ---- the SSW end is a gable (LoD2 models a hip there) with a window per floor and the mural
        "giebel": {"wall": "L6/L7", "form": "giebel", "source": "photo", "sigma_m": 0.3,
                   "note_de": "Street View zeigt einen Giebel mit Wandbild; das LoD2-Modell hat dort einen Walm"},
        "giebel_fenster": [{"y": val(2.35, 0.5), "w": val(0.85, 0.2), "sill": val(2.30, 0.4), "head": val(3.45, 0.4)},
                           {"y": val(4.00, 0.5), "w": val(0.75, 0.2), "sill": val(4.75, 0.4), "head": val(6.10, 0.4)}],
        "wandmalerei": {"y": val(2.30, 0.5), "w": val(1.85, 0.4), "z0": val(3.90, 0.4), "z1": val(6.55, 0.4),
                        "note_de": "Wandbild Ofenbogen mit Brot und Brotschiebern; Schriftzug nur mit Build-Flag `--lettering`"},
        # ---- porch: flat lintel (video), the arch in v0 came from the mesh
        "vorbau": {"sturz": "flach", "source": "video", "sigma_m": 0.2, "stufen_unter_pfeiler": 2,
                   "note_de": ("gerader Sturz, Untersicht = Vorbaudecke; Eckpfeiler mit Sandsteinquadern rot/hell; die zwei "
                               "untersten Stufen laufen unter dem Eckpfeiler bis zur Gebäudekante durch (Video)")},
        "handlauf": {"h": val(0.90, 0.1, "video"), "y0": val(0.10, 0.1, "video"), "y1": val(1.05, 0.15, "video"),
                     "note_de": "verzinkter Handlauf an der linken Vorbauwand, eingerolltes Ende"},
        "dach_schiefer": {"x_to": val(15.22, 0.15, "mesh+video"),
                          "note_de": "vordere Dachfläche links der Lisene mit Schiefer in Rautendeckung (Street View)"},
        # ---- Backstube entrance (user 2026-11-06): recessed niche right of the SSW corner quoins, terrazzo steps, black
        # round-bar rail on the glass-block side, closed aluminium door with ribbed glass. Exterior only (ADR 0047).
        "backstube_eingang": backstube_eingang(),
        # ---- covered passage beside the shop (public up to the privacy line, ADR 0047): paving and plinth band
        "durchgang": {
            "belag": {"verband": "fischgraet", "stein_l": val(0.20, 0.03, "video"), "stein_b": val(0.10, 0.02, "video"),
                      "note_de": "rotbraunes Betonpflaster im Fischgrätverband (Video, Foto)"},
            "sockelband": {"top": val(-0.07, 0.15, "photo", ref="FFB"),
                           "note_de": "braun gestrichener Sockel an beiden Wänden des Durchgangs (Foto, Video)"},
            "note_de": "Schlitzrinnen im Pflaster sind nicht dargestellt (Lage nicht bestimmt)",
        },
    }


def backstube_eingang() -> dict:
    """The Backstube entrance at the SSW end of the street facade (video frames at 0–2 s, Street View; σ 0.15–0.3).

    Niche x0..x1 along the facade, `depth` into the building (y), soffit at `head`. Steps: `risers` risers from the
    pavement (street = −total_rise, DGM1 243.28 m NHN at the niche) up to the landing at `landing_z` (≈ FFB): treads
    of `tread`, then the landing to the door. Right side: sandstone-slip cheek wall (cap = facade plinth cap), glass
    blocks above up to the head, a light metal corner post. Left side: render with a rounded street edge and a low
    sandstone string along the stair. Door closed, nothing behind it is modelled."""
    return {
        "x0": val(1.35, 0.25), "x1": val(2.65, 0.25), "depth": val(1.40, 0.25), "head": val(3.30, 0.4),
        "risers": 5, "total_rise": val(0.97, 0.15, "dgm1+photo"), "tread": val(0.27, 0.04), "landing": val(0.32, 0.10),
        "landing_z": val(0.0, 0.10, "photo", ref="FFB"), "belag": "terrazzo",
        "kante_links_r": val(0.12, 0.04),
        "wange_links": {"b": val(0.12, 0.04), "h": val(0.12, 0.04), "note_de": "Sandstein-Wange entlang der Treppe an der linken Wand"},
        "wange_rechts": {"cap_top": val(0.05, 0.05, "photo", ref="FFB"), "cap_proj": val(0.06, 0.02),
                         "note_de": "Sandstein-Riemchen mit Abdeckplatte wie der Fassadensockel, darüber Glasbausteine bis zum Sturz"},
        "eckpfosten": {"b": val(0.08, 0.02), "note_de": "hellgrauer Metallpfosten an der Ecke zur Glasbausteinwand"},
        "tuer": {"w": val(1.00, 0.10), "h": val(2.10, 0.15), "rahmen": val(0.06, 0.02), "anschlag": "links", "griff": "rechts",
                 "staebe": 4, "tritt": val(0.30, 0.05),
                 "note_de": "geschlossene Aluminiumtür mit Riffelglas, 4 senkrechten Stäben und Trittblech; nichts dahinter dargestellt"},
        "handlauf": {"seite": "rechts", "h": val(0.90, 0.10), "d": val(0.033, 0.005), "y_top": val(1.30, 0.15),
                     "note_de": "schwarzer Rundstahl, oben Wandhalter am Türrahmen, unten kurz senkrecht auf die Abdeckplatte"},
        "note_de": ("Eingang zur Backstube (Nutzerangabe 2026-11-06), Nische mit Terrazzostufen rechts neben den Eckquadern; "
                    "nur außen dargestellt, die Tür bleibt zu"),
    }


def site_fixtures(north_outer) -> list[dict]:
    """Public site fixtures (frame B). X1 = the pickup cabinet in the covered passage, back against the shop's north
    wall (LoD2 edge L3, `north_outer(y)` = its outer face), doors towards the passage (+x). Size from the photo of the
    pickup station, the 2019 video and the mesh; position from the mesh + video. Fixture frame: origin = front corner at
    the start of the length (street side), x_fixture along +y_B (rot 90°), depth towards the wall."""
    y0, w, d, h = 3.225, 0.90, 0.42, 1.75
    xw = north_outer(y0 + w / 2)
    return [{
        "id": "X1", "type": "schrank", "name_de": "Abholschrank",
        "pose": {"xy": [round(xw + d, 3), y0], "z": -0.65, "rot_deg": 90.0},
        "size": {"l": w, "d": d, "h": h},
        "dims": {"w": val(w, 0.10), "d": val(d, 0.05), "h": val(h, 0.10, ref="Durchgangsboden")},
        "source": "mesh+video+photo", "sigma_m": 0.3, "status": "geschaetzt", "z_ref": -0.65,
        "front": "+x (Türen zum Durchgang)",
        "note_de": ("im überdachten Durchgang an der Nordwand der Bäckerei, gleich um die Ecke vom Eingang; grauer "
                    "Kunststoffschrank mit 2 × 2 Lamellentüren und schwarzem Griffband; Schild nur „Abholstation“"),
    }]


def _north_outer(doc: dict):
    e = next(e for e in doc["site"]["building"]["edges"] if e["id"] == "L3")
    (x1, y1), (x2, y2) = e["to"], e["from"]
    return lambda y: x1 + (x2 - x1) * (y - y1) / (y2 - y1)


def main(argv: list[str]) -> int:
    path = Path(argv[0]) if argv else Path(__file__).resolve().parents[1] / "raumplan-v0.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    doc["site"]["facade"] = facade()
    pub = {f["id"]: f for f in site_fixtures(_north_outer(doc))}
    doc["site"]["fixtures"] = list(pub.values()) + [f for f in doc["site"].get("fixtures", []) if f.get("id") not in pub]
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("exterior_r3: applied to", path.name)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
