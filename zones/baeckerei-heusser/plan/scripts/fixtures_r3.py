"""Round 3 (Verkaufsraum) fixture values for the Raumplan: corrections and new fixtures from the walkthrough video.

One source of truth for both ways the public plan is written:
  * `build_json.py` (regen from the private work files) calls `apply(fixtures, room)` on its fixture list;
  * `python3 -I fixtures_r3.py [raumplan-v0.json]` applies the same to an existing plan file in place (idempotent).

Values from the video are `source: "video"` with σ ≈ 0.1 m for heights read off fixtures and 0.3–0.6 m for positions
(frame B, see the plan's `fixture_frame`). Wall-mounted fixtures are placed by wall and running distance, so they move
with the room outline. Nothing here lies beyond the shop's passage door (bh-datenschutz).
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path


def val(v, sigma, source="video", **kw):
    d = {"v": round(float(v), 2), "sigma_m": round(float(sigma), 2), "source": source}
    d.update(kw)
    return d


def _fx(id_, typ, name, origin, rot, size, sigma, source="video", z=0.0, **kw):
    d = {"id": id_, "type": typ, "name_de": name,
         "pose": {"xy": [round(float(origin[0]), 3), round(float(origin[1]), 3)], "z": round(float(z), 2), "rot_deg": round(float(rot), 1)},
         "size": {k: (round(float(v), 2) if v is not None else None) for k, v in size.items()},
         "source": source, "sigma_m": round(float(sigma), 2), "status": "geschaetzt"}
    d.update(kw)
    return d


def _wall(room, a, b, s0, l, d):
    """Fixture against the wall a -> b (room polygon order, room on the left): its extent starts `s0` metres from a,
    runs `l` along the wall, front `d` off the wall facing into the room. Returns (origin = front corner at the start
    of the fixture's length, rot_deg) in the plan's fixture frame (front = local −y)."""
    ax, ay = room[a]
    bx, by = room[b]
    L = math.hypot(bx - ax, by - ay)
    ux, uy = (bx - ax) / L, (by - ay) / L
    nx, ny = -uy, ux                                   # into the room
    ox = ax + (s0 + l) * ux + d * nx
    oy = ay + (s0 + l) * uy + d * ny
    return (ox, oy), math.degrees(math.atan2(-uy, -ux))


def _local(f1, x, y):
    a = math.radians(f1["pose"]["rot_deg"])
    ox, oy = f1["pose"]["xy"]
    return (ox + x * math.cos(a) - y * math.sin(a), oy + x * math.sin(a) + y * math.cos(a))


def _dist(room, a, b):
    return math.dist(room[a], room[b])


def apply(fixtures: list[dict], room: dict) -> list[dict]:
    """Return the fixture list with the round-3 corrections merged into F1–F9 and the new fixtures F11+ appended."""
    room = {k: (tuple(v["xy"]) if isinstance(v, dict) else (float(v[0]), float(v[1]))) for k, v in room.items()}
    by = {f["id"]: dict(f) for f in fixtures}
    order = [f["id"] for f in fixtures]
    f1 = by["F1"]
    L1 = f1["size"]["l"]

    # ---- F1 counter: heights and display layout (video: 2 modules ≈ 2.6 + 1.5 m, white base, red band, pink-grey granite)
    f1.update({
        "parts": [
            {"id": "sockel", "h": val(0.62, 0.05), "note_de": "weißer Sockel (Marmoroptik); im Video nicht dunkelrot"},
            {"id": "granitablage", "h": val(0.65, 0.05), "overhang": val(0.20, 0.05), "note_de": "rosa-grauer Granit, kundenseitig vorstehend"},
            {"id": "zierband", "h": val(0.80, 0.05), "note_de": "rotes Band zwischen Granitablage und Vitrinenglas"},
            {"id": "vitrine", "h": val(1.27, 0.05), "note_de": "2 Module, Auslageboden, Glasboden, Glasabdeckung"},
            {"id": "arbeitsplatte", "h": val(0.90, 0.05), "depth": val(0.43, 0.05), "note_de": "Arbeitsseite: Granit, darunter offene Fächer"},
        ],
        "modules": [{"id": "links", "share": val(2.6 / 4.1, 0.05), "front": "schraeg"},
                    {"id": "rechts", "share": val(1.5 / 4.1, 0.05), "front": "senkrecht"}],
        "slots": [
            {"id": "ebene-1", "z": 0.80, "d": 0.62, "setback": 0.04, "sigma_m": 0.1, "source": "video", "note_de": "Auslageboden (gekühlt)"},
            {"id": "ebene-2", "z": 1.05, "d": 0.40, "setback": 0.12, "sigma_m": 0.1, "source": "video", "note_de": "Glasboden"},
            {"id": "ebene-3", "z": 1.27, "d": 0.55, "setback": 0.0, "sigma_m": 0.1, "source": "video", "note_de": "Glasabdeckung"},
        ],
    })

    # ---- F2 bread shelf: 3 bays, 3 rod tiers + basket level + low board (video); length from the 6 baskets
    f2 = by["F2"]
    l2 = 3.60
    f2["size"] = dict(f2["size"], l=l2)
    f2["length"] = val(l2, 0.40, note="6 Körbe à 0,58 + Wangen; Plan v0 (Mesh) 4,25 ± 0,55 → Messliste F")
    f2["source"] = "mesh+video"
    f2["bays"] = 3
    f2["koerbe"] = {"n": 6, "w": val(0.55, 0.05), "d": val(0.38, 0.05), "h": val(0.20, 0.03), "pitch": val(0.58, 0.05)}
    f2["slots"] = [
        {"id": "unterboden", "z": 0.15, "d": 0.40, "neigung_deg": 0, "sigma_m": 0.1, "source": "video", "note_de": "Vorrat, keine Verkaufsware"},
        {"id": "koerbe", "z": 0.80, "d": 0.40, "neigung_deg": 10, "sigma_m": 0.1, "source": "video", "note_de": "6 Körbe mit rosa Tüchern"},
        {"id": "ebene-1", "z": 1.20, "d": 0.40, "neigung_deg": 25, "stangen": 7, "sigma_m": 0.1, "source": "video", "note_de": "Stangenboden mit Preisschiene"},
        {"id": "ebene-2", "z": 1.50, "d": 0.40, "neigung_deg": 25, "stangen": 7, "sigma_m": 0.1, "source": "video", "note_de": "Stangenboden mit Preisschiene"},
        {"id": "ebene-3", "z": 1.80, "d": 0.50, "neigung_deg": 25, "stangen": 11, "sigma_m": 0.1, "source": "video", "note_de": "oben, rote Vorderkante"},
    ]
    f2["note_de"] = "Wandseitig, gegenüber der Theke; 3 Felder à ≈ 1,2 m, Vorderkante der Böden = z"

    # ---- F3 grid shelf: chrome, ≈ 0.90 wide, 5 wire shelves (video)
    f3 = by["F3"]
    o3, r3 = _wall(room, "K", "A", _dist(room, "K", "A") - 0.02 - 0.90, 0.90, 0.45)
    f3.update({"pose": {"xy": [round(o3[0], 3), round(o3[1], 3)], "z": 0.0, "rot_deg": round(r3, 1)},
               "size": {"l": 0.90, "d": 0.45, "h": 1.80}, "source": "video", "sigma_m": 0.4,
               "name_de": "Gitterregal (Chrom)", "boeden": [0.15, 0.55, 0.95, 1.35, 1.75],
               "note_de": "Chrom, 5 Drahtböden; SW-Ecke am Schaufenster 1 (Video)"})

    # ---- F4 news stand: off the granite ledge (it stood in the ledge's overhang)
    f4 = by["F4"]
    o4 = _local(f1, L1 - 0.30, -0.48)
    f4["pose"] = {"xy": [round(o4[0], 3), round(o4[1], 3)], "z": 0.0, "rot_deg": f1["pose"]["rot_deg"]}

    # ---- F5/F6 café tables: Ø / edge ≈ 0.70, h 0.76; F6 is square (video); two chairs each
    def chairs(c, sides):
        out = []
        for k, (dx, dy, rot) in enumerate(sides, 1):
            out.append({"id": f"stuhl-{k}", "xy": [round(c[0] + dx, 3), round(c[1] + dy, 3)], "rot_deg": rot,
                        "size": {"l": 0.42, "d": 0.45, "h": 0.85}, "sitz": 0.46, "sigma_m": 0.4, "source": "video"})
        return out
    f5, f6 = by["F5"], by["F6"]
    f5.update({"size": {"l": 0.70, "d": 0.70, "h": 0.76}, "source": "mesh+video", "form": "rund",
               "stuehle": chairs(f5["pose"]["xy"], [(-0.62, -0.02, 90.0), (0.57, 0.12, 270.0)])})
    # F6 stands in front of the jar shelf (video t022): 0.20 further from the door than the mesh blob (σ 0.4), so the
    # way in from the sliding door stays free
    f6["pose"] = {"xy": [23.0, 2.95], "z": 0.0, "rot_deg": 0.0}
    f6.update({"size": {"l": 0.70, "d": 0.70, "h": 0.76}, "source": "mesh+video", "form": "quadratisch",
               "name_de": "Bistrotisch (Café, quadratisch)",
               "stuehle": chairs(f6["pose"]["xy"], [(-0.62, 0.0, 90.0), (0.70, 0.0, 270.0)])})

    # ---- F7 = jar/can shelf (2 units); the fridge is its own fixture now (F13)
    o7, r7 = _wall(room, "E", "F", 0.62, 1.37, 0.35)
    by["F7"] = _fx("F7", "regal", "Regal mit Gläsern und Dosen", o7, r7, {"l": 1.37, "d": 0.35, "h": 1.55}, 0.4,
                   source="mesh+video", note_de="an der Café-Rückwand (W5), dunkles Holz, Stahl, Gitterseiten",
                   einheiten=[{"id": "links", "l": val(0.82, 0.05), "boeden": [0.15, 0.50, 0.85, 1.20, 1.55]},
                              {"id": "rechts", "l": val(0.55, 0.05), "h": val(1.45, 0.05), "spalten": 2, "faecher": 4}])

    # ---- pendant lamps: 4 on the soffit over the counter, ≈ 1.1 m apart, centred on the display (video)
    lamps = {}
    xc = (0.30 + L1 - 0.02) / 2
    for k, fid in enumerate(("F11", "F8", "F9", "F12")):
        lamps[fid] = _local(f1, xc + (k - 1.5) * 1.10, 0.57)
    for fid in ("F8", "F9"):
        by[fid]["pose"] = {"xy": [round(lamps[fid][0], 3), round(lamps[fid][1], 3)], "z": 0.0, "rot_deg": 0.0}
        by[fid].update({"size": {"l": 0.18, "d": 0.18, "h": 0.18}, "source": "video", "sigma_m": 0.4,
                        "form": "kugel", "pendel": val(0.25, 0.1)})

    # ---- F10 soffit: a narrow hanging wood beam along the counter (red edges, white cover on top) that carries the
    # pendants (video t024/t026/t038); the mesh blob (4.5 × 2.48) was the beam plus the ceiling around it
    o10 = _local(f1, 0.05, 0.30)
    by["F10"].update({"pose": {"xy": [round(o10[0], 3), round(o10[1], 3)], "z": 0.0, "rot_deg": f1["pose"]["rot_deg"]},
                      "size": {"l": 4.45, "d": 0.55, "h": 0.12}, "source": "video", "sigma_m": 0.3,
                      "name_de": "Holzblende über der Theke (rote Kanten, weiße Abdeckung)",
                      "note_de": "abgehängter Balken, Pendel hängen daran; Breite aus dem Video geschätzt"})

    new = []
    for fid in ("F11", "F12"):
        new.append(_fx(fid, "leuchte", "Pendelleuchte", lamps[fid], 0.0, {"l": 0.18, "d": 0.18, "h": 0.18}, 0.4,
                       z_mount="Decke", form="kugel", pendel=val(0.25, 0.1)))

    # ---- café back wall (W5) and north wall (W4)
    new.append(_fx("F13", "kuehlschrank", "Getränkekühlschrank", *_wall(room, "E", "F", 0.02, 0.60, 0.60),
                   {"l": 0.60, "d": 0.60, "h": 1.90}, 0.4, faecher=5, note_de="rechts vom Dosenregal (Video)"))
    new.append(_fx("F21", "staender", "Prospektständer", *_wall(room, "D", "E", 1.53, 0.35, 0.30),
                   {"l": 0.35, "d": 0.30, "h": 1.25}, 0.4, faecher=4))
    new.append(_fx("F22", "wandbild", "Wandbild Kaffee", *_wall(room, "D", "E", 0.75, 1.00, 0.03),
                   {"l": 1.00, "d": 0.03, "h": 0.75}, 0.4, z=1.00, note_de="eigene einfache Grafik (Tasse + Bohnen)"))
    new.append(_fx("F23", "staender", "Schirmständer", (room["D"][0] - 0.16, room["D"][1] + 0.98), 0.0,
                   {"l": 0.22, "d": 0.22, "h": 0.50}, 0.5, form="rund"))
    new.append(_fx("F24", "pflanze", "Zimmerpflanze", (room["D"][0] - 0.29, room["D"][1] + 0.33), 0.0,
                   {"l": 0.50, "d": 0.50, "h": 1.40}, 0.4, form="rund", topf=val(0.40, 0.05)))
    gl = _dist(room, "C", "D")
    new.append(_fx("F25", "bild", "Bleiglasbild", *_wall(room, "C", "D", gl - 0.37, 0.35, 0.03),
                   {"l": 0.35, "d": 0.01, "h": 0.50}, 0.5, z=1.30, note_de="hängt vor der rechten Seitenscheibe; nur Farbfelder"))
    # ---- wall F–G (customer side of the counter's NE end): old pictures + clock
    o26, r26 = _wall(room, "F", "G", 0.02, 0.70, 0.02)
    new.append(_fx("F26", "bilder", "Alte Bilder (Rahmen)", o26, r26, {"l": 0.70, "d": 0.02, "h": 0.95}, 0.4, z=0.95,
                   rahmen=[{"id": "rahmen-1", "x": 0.02, "z": 1.50, "w": 0.30, "h": 0.38},
                           {"id": "rahmen-2", "x": 0.37, "z": 1.43, "w": 0.30, "h": 0.45},
                           {"id": "rahmen-3", "x": 0.075, "z": 0.95, "w": 0.55, "h": 0.40}],
                   note_de="nur Rahmen mit neutraler Sepiafläche (keine Gesichter)"))
    new.append(_fx("F27", "uhr", "Wanduhr", *_wall(room, "F", "G", 0.245, 0.25, 0.04), {"l": 0.25, "d": 0.04, "h": 0.18}, 0.4, z=1.93))
    # ---- behind the counter, NE end: cube shelf in the corner I (wall W6 H–I), wall boards with the coffee machine (W7)
    h_i = _dist(room, "H", "I")
    o14, r14 = _wall(room, "H", "I", h_i - 0.77, 0.77, 0.39)
    new.append(_fx("F14", "regal", "Würfelregal", o14, r14, {"l": 0.77, "d": 0.39, "h": 1.67}, 0.5, sockel=val(0.20, 0.05),
                   faecher={"spalten": 2, "reihen": 4},
                   note_de="Nische neben dem Durchgang O6; im Mesh ist sie nicht erfasst (Lage geschätzt, ragt ≈ 0,2 vor O6)"))
    o15, r15 = _wall(room, "I", "K", 0.40, 0.43, 0.35)
    new.append(_fx("F15", "regal", "Wandboards", o15, r15, {"l": 0.43, "d": 0.35, "h": 1.65}, 0.5, boeden=[0.75, 0.95, 1.65]))
    a15 = math.radians(r15)
    ux, uy = (math.cos(a15), math.sin(a15)), (-math.sin(a15), math.cos(a15))
    o16 = (o15[0] + 0.055 * ux[0] - 0.23 * uy[0], o15[1] + 0.055 * ux[1] - 0.23 * uy[1])
    new.append(_fx("F16", "geraet", "Kaffeevollautomat", o16, r15, {"l": 0.32, "d": 0.58, "h": 0.60}, 0.5, z=0.97,
                   steht_auf="F15 (mittleres Board)"))
    new.append(_fx("F30", "halter", "Tütenhalter", *_wall(room, "I", "K", 0.45, 0.35, 0.20), {"l": 0.35, "d": 0.20, "h": 0.25}, 0.5, z=1.72))
    # ---- behind the counter, SW end: work table with the warming display, stool, bread slicer (video)
    new.append(_fx("F18", "tisch", "Holztisch (Arbeitstisch)", (room["A"][0] + 1.28, room["A"][1] + 0.54), 180.0,
                   {"l": 0.80, "d": 0.50, "h": 0.78}, 0.5))
    c18 = (room["A"][0] + 0.88, room["A"][1] + 0.29)
    a19 = math.radians(135.0)
    o19 = (c18[0] - 0.225 * math.cos(a19) + 0.20 * math.sin(a19), c18[1] - 0.225 * math.sin(a19) - 0.20 * math.cos(a19))
    new.append(_fx("F19", "geraet", "Wärmevitrine", o19, 135.0, {"l": 0.45, "d": 0.40, "h": 0.55}, 0.5, z=0.78, steht_auf="F18"))
    new.append(_fx("F20", "hocker", "Rollhocker", (room["A"][0] + 0.95, room["A"][1] + 0.80), 0.0, {"l": 0.40, "d": 0.40, "h": 0.60}, 0.6, form="rund"))
    new.append(_fx("F17", "geraet", "Brotschneidemaschine", (room["A"][0] + 1.105, room["A"][1] + 1.03), 90.0,
                   {"l": 0.60, "d": 0.65, "h": 1.30}, 0.5, note_de="auf Rollen, Arbeitsseite zum Gang"))
    # ---- ceiling: track lights over the shop windows (on the bulkhead) and in the café, downlights
    o1w, o2w = (16.85, 18.55), (19.12, 21.23)
    new.append(_fx("F31", "strahler", "Strahlerschiene", (o1w[0] + 0.10, 0.80), 0.0, {"l": 1.50, "d": 0.06, "h": 0.15}, 0.4, z_mount="Sturz", spots=2))
    new.append(_fx("F32", "strahler", "Strahlerschiene", (o2w[0] + 0.15, 0.80), 0.0, {"l": 1.80, "d": 0.06, "h": 0.15}, 0.4, z_mount="Sturz", spots=3))
    new.append(_fx("F33", "strahler", "Strahlerschiene", (room["D"][0] - 1.21, room["D"][1] + 0.55), 90.0, {"l": 1.80, "d": 0.06, "h": 0.15}, 0.4,
                   z_mount="Decke", spots=3))
    new.append(_fx("F34", "einbauleuchten", "Einbauleuchten", (room["D"][0] - 1.64, room["D"][1] + 0.58), 0.0, {"l": 0.08, "d": 0.08, "h": 0.01}, 0.5,
                   z_mount="Decke", punkte=[[22.6, 2.1], [23.6, 2.1], [22.6, 3.3], [23.6, 3.3], [20.2, 1.7], [21.0, 2.4]]))
    # ---- floor mats and window-sill decoration
    new.append(_fx("F28", "matte", "Fußmatte (Eingang)", (room["C"][0] + 0.49, room["C"][1] + 0.04), 0.0, {"l": 1.50, "d": 0.60, "h": 0.012}, 0.4))
    new.append(_fx("F29", "matte", "Läufer vor der Theke", _local(f1, 1.20, -1.05), f1["pose"]["rot_deg"], {"l": 3.00, "d": 0.80, "h": 0.012}, 0.4))
    new.append(_fx("F35", "deko", "Schaufensterbank mit Deko (Schaufenster 2)", (o2w[1] - 0.08, room["A"][1] + 0.30), 180.0,
                   {"l": 1.95, "d": 0.30, "h": 0.40}, 0.4, note_de="Filz, Kürbisse, Sonnenblumen; Girlande am Sturz"))
    new.append(_fx("F36", "deko", "Schaufenster-Deko (Schaufenster 1)", (o1w[1] - 0.05, room["A"][1] + 0.28), 180.0,
                   {"l": 0.42, "d": 0.28, "h": 0.30}, 0.4, note_de="zwischen Arbeitstisch und Pfeiler; Girlande am Sturz"))

    out = [by[i] for i in order]
    have = {f["id"] for f in out}
    for f in sorted(new, key=lambda f: int(f["id"][1:])):
        if f["id"] not in have:
            out.append(f)
        else:
            out[[g["id"] for g in out].index(f["id"])] = f
    return out


def main(argv: list[str]) -> int:
    path = Path(argv[0]) if argv else Path(__file__).resolve().parents[1] / "raumplan-v0.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    r1 = next(r for r in doc["levels"][0]["rooms"] if r["id"] == "R1")
    r1["fixtures"] = apply(r1["fixtures"], r1["points"])
    doc["fixture_frame"] = ("Fixture-Ursprung = vordere Ecke am Anfang der Länge (Zugangsseite: Kunde bzw. Gang), x entlang l, "
                            "y von der Vorderkante in die Tiefe d, z nach oben ab pose.z; rot_deg = Winkel von x_fixture gegen x_B "
                            "(gegen den Uhrzeigersinn). Tische und runde Objekte (form): Ursprung = Mitte.")
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("fixtures_r3: applied to", path.name, len(r1["fixtures"]), "fixtures")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
