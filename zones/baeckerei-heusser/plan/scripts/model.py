"""Raumplan v0 model: one source of truth for raumplan-v0.json and raumplan-v0.svg.

Frame "B" (Bauwerk): origin = SSW end of the LoD2 street facade of building DESLA0AKQYG11262,
x along the street facade towards NNE, y perpendicular into the building (WNW), z up from +-0.00.
Every mesh value below was measured in scripts/measure.py, diagwall.py, vsection.py (see README).
"""
from __future__ import annotations

import json
import math

import numpy as np

import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I: own scripts only
from paths import SP, WORK  # noqa: E402
E0z, N0z = 381467.0, 5462254.0           # zone-local origin (zone.json)
BAKERY = "DESLA0AKQYG11262"
NEIGHBOUR_N = "DESLA0AKQWW27B86"
H0 = 244.25                               # +-0.00 = FFB Verkaufsraum, m NHN (mesh floor on DGM1-levelled street)
REL = 0.111                               # relative scale uncertainty of mesh values (camera-height prior)
FIT = 0.16                                # plan-fit rms of the georeference (m)
R2 = math.sqrt(2)


PRIVATE_FACTS = WORK / "private_facts.json"


def private_facts() -> dict:
    """Facts beyond the shop's passage door (bh-datenschutz): they live only in the private folder, never in the repo.

    Keys: plan.passage (name/note overrides), plan.dgm_points, plan.openings, plan.site_fixtures (final plan entries),
    sheet (drawing ops for the private sheet), fingerprints (coordinates check_plan.py must not find in public files).
    Missing file -> {} and the generators produce the public content only.
    """
    try:
        with open(PRIVATE_FACTS, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def lod2(path=SP + "work/lod2_wide.json"):
    return json.load(open(path))


def frame():
    b = [x for x in lod2() if x["id"] == BAKERY][0]
    g = np.array(b["ground"][0])[:, :2]
    L = [np.linalg.norm(g[i + 1] - g[i]) for i in range(len(g) - 1)]
    i = int(np.argmax(L)); a, c = g[i], g[i + 1]
    if a[1] > c[1]:
        a, c = c, a
    ux = (c - a) / np.linalg.norm(c - a)
    vx = np.array([-ux[1], ux[0]])
    return a, ux, vx


ORIGIN, UX, VX = frame()
BEARING_X = math.degrees(math.atan2(UX[0], UX[1])) % 360


def to_b(EN):
    d = np.asarray(EN, float)[..., :2] - ORIGIN
    return np.stack([d @ UX, d @ VX], -1)


def to_en(xy):
    xy = np.asarray(xy, float)
    return ORIGIN + xy[..., :1] * UX + xy[..., 1:2] * VX


PIVOT = to_b(np.array([E0z + 8.39, N0z + 4.97]))   # capture.scale.pivotLocal = fitted LoD2 NE corner


def td(t, c):
    """diagonal coordinates (t along the counter wall, c across it) -> frame B."""
    return ((t + c) / R2, (t - c) / R2)


# ------------------------------------------------------------------------------------------ uncertainty
def sig_pos(p, edge=0.03):
    d = np.linalg.norm(np.asarray(p) - PIVOT)
    return round(math.sqrt(FIT ** 2 + edge ** 2 + (REL * d) ** 2), 2)


def sig_len(L, e1=0.03, e2=0.03):
    return round(math.sqrt(e1 ** 2 + e2 ** 2 + (REL * L) ** 2), 2)


# ------------------------------------------------------------------------------------------ mesh measurements (frame B, m)
M = dict(
    facade_inner_v=0.62,      # pier 2 inner face (measure.py, spread 0.05); pier 1 gave 0.84 (20 faces only)
    sw_wall_u=16.77,          # SW room wall face (307 faces, spread 0.03)
    back_wall_c=10.12,        # diagonal back wall (u - v)/rt2, diagwall.py p10 over t 14..18.5
    shelf_front_c=10.56,      # Brotregal front
    right_diag_s=26.22,       # right diagonal wall u + v (287 faces, spread 0.01)
    cafe_back_v=4.11,         # cafe back wall (302 faces)
    north_inner_u=24.24,      # north wall inner face (218 faces)
    glass_front_v=1.52,       # Ladenfront (both sides 1.51 / 1.53)
    pier2_ne_u=21.83,         # entrance reveal (450 faces, spread 0.02)
    glass_side_u=21.76,       # glazed side wall shop|porch, room face (25 faces, spread 0.02; frames 3105-3147 show glass)
    pier2_sw_u=21.23,
    # pier 1 between the shop windows: equal widths per SV, user 2026-11-06. Street View shows both windows the same
    # width (glass ratio 691 : 192 : 715 after perspective, +-5 %); the mesh gave O1 1.70 / O2 2.11 because the O1 SW
    # reveal is soft. Outer reveals (16.85 / 21.23) and the 0.57 pier stay, the pier moves: O1 = O2 = 1.905 +-0.15.
    # Mesh faces of the pier were at 18.55 / 19.12 (measure.py); the photo ratio wins over them here.
    pier1_ne_u=19.325,
    pier1_sw_u=18.755,
    win1_sw_u=16.85,          # soft: glass reflections, +-0.15
    pillar_sw_u=24.40,        # corner pillar inner face (185 faces)
    pillar_v=0.45,            # pillar depth (slice), soft
    corridor_w_u=20.65,       # NE corridor (8 faces only) -> soft
    corridor_e_u=21.59,       # (117 faces)
    corridor_end_v=7.14,      # door / back of the corridor
    counter_t=(13.60, 17.85), # counter along t (SW end rounded, soft)
    counter_c=(11.43, 12.52), # counter body across
    counter_base_h=0.65,      # opaque base / ledge top
    counter_glass_h=1.27,     # glass display top (sparse mesh traces)
    shelf_t=(14.05, 18.30),
    ceiling_h=2.28,           # suspended ceiling (sections 2.26..2.32)
    soffit_h=2.05,            # bulkhead over the shop windows (v < 1.0)
    street_h=-0.72,           # street at the entrance (mesh) == DGM1 243.54 - 244.25 = -0.71
    passage_h=-0.65,          # covered passage floor
    passage_far_u=27.62,      # opposite wall of the covered passage (mesh)
    north_outer_mesh_u=24.75, # bakery north wall outer face seen from the passage (mesh) vs LoD2 24.66..24.71
    steps=5, step_rise=0.144, step_tread=0.31, landing_v=1.24,
    bkst_door_v=(1.50, 2.35),                  # Durchgang Backstube (photo + mesh hint), soft
    rack_v=(0.80, 1.45),                       # Gitterregal (photo), soft
)

# room polygon (inner faces), CCW
K_v = M["sw_wall_u"] - M["back_wall_c"] * R2
I_u = (M["right_diag_s"] + M["back_wall_c"] * R2) / 2
ROOM = {
    "A": (M["sw_wall_u"], M["facade_inner_v"]),
    "B": (M["glass_side_u"], M["facade_inner_v"]),
    "C": (M["glass_side_u"], M["glass_front_v"]),
    "D": (M["north_inner_u"], M["glass_front_v"]),
    "E": (M["north_inner_u"], M["cafe_back_v"]),
    "F": (M["right_diag_s"] - M["cafe_back_v"], M["cafe_back_v"]),
    "G": (M["corridor_e_u"], M["right_diag_s"] - M["corridor_e_u"]),
    "H": (M["corridor_w_u"], M["right_diag_s"] - M["corridor_w_u"]),
    "I": (I_u, M["right_diag_s"] - I_u),
    "K": (M["sw_wall_u"], K_v),
}
ROOM = {k: (round(v[0], 3), round(v[1], 3)) for k, v in ROOM.items()}
ROOM_ORDER = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "K"]


def poly_area(pts):
    p = np.asarray(pts)
    return 0.5 * abs(np.dot(p[:, 0], np.roll(p[:, 1], -1)) - np.dot(p[:, 1], np.roll(p[:, 0], -1)))


def lod2_building(bid):
    b = [x for x in lod2() if x["id"] == bid][0]
    ring = to_b(np.array(b["ground"][0]))
    roofs = [np.array(r) for r in b["roof"]]
    walls = [np.array(r) for r in b["wall"]]
    return b, ring, roofs, walls


def north_outer_u(v):
    """LoD2 north wall outer face (edge (24.656,0) -> (24.843,8.873))."""
    return 24.656 + (24.843 - 24.656) * v / 8.873
