"""raumplan-v0.svg: A3 landscape, Grundriss EG 1:50 (frame B, street at the bottom) + Lageplan 1:1000 + legend + title block.

    python -I build_svg.py            # full sheet from the private plan -> <private>/plan/raumplan-v0.svg
    python -I build_svg.py --public   # public sheet from plan/raumplan-v0.json (redact.py) -> plan/raumplan-v0.svg

Both sheets draw only the shop and its exterior, the covered passage up to the privacy line (redact.PASSAGE_PUBLIC_Y,
ADR 0047: with the pickup cabinet, bh-datenschutz); beyond it the public sheet shows a neutral "privat" hatch. The full sheet adds the drawing ops listed under `sheet` in the private facts
file (model.private_facts(), private folder only), so no private detail lives in this script.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I: own scripts only
import paths  # noqa: E402
import numpy as np

from model import *
from redact import PASSAGE_PUBLIC_Y  # noqa: E402

PUBLIC = "--public" in sys.argv[1:]
SRC = (paths.PLAN if PUBLIC else paths.PRIV) / "raumplan-v0.json"
J = json.load(open(SRC))
OUT = str((paths.PLAN if PUBLIC else paths.PRIV) / "raumplan-v0.svg")
OV = [] if PUBLIC else private_facts().get("sheet", [])   # private sheet: extra drawing ops (data, not code)
PV = PASSAGE_PUBLIC_Y  # the passage is drawn only up to the privacy line (frame B y, ADR 0047)

# ----------------------------------------------------------------------------- sheet + view transform
W, H = 420, 297
S = 20.0                                     # 1:50 -> 20 mm per m
VX0, VY0, VW, VH = 22.0, 14.0, 270.0, 252.0  # main viewport (mm)
U0, V1 = 14.65, 9.75                         # view: u from U0, v down from V1
BLUE, BLK, ORA, GREY = "#1f5fbf", "#111", "#c2620a", "#8a8a8a"
FONT = "Helvetica, Arial, sans-serif"


def X(u):
    return VX0 + (u - U0) * S


def Y(v):
    return VY0 + (V1 - v) * S


def P(p):
    return f"{X(p[0]):.2f},{Y(p[1]):.2f}"


def num(x, d=2):
    return f"{x:.{d}f}".replace(".", ",").replace("-", "−")


out = []


def add(s):
    out.append(s)


def poly(pts, **a):
    attrs = " ".join(f'{k.replace("_", "-")}="{v}"' for k, v in a.items())
    add(f'<polygon points="{" ".join(P(p) for p in pts)}" {attrs}/>')


def pline(pts, **a):
    attrs = " ".join(f'{k.replace("_", "-")}="{v}"' for k, v in a.items())
    add(f'<polyline points="{" ".join(P(p) for p in pts)}" fill="none" {attrs}/>')


def line(p, q, **a):
    pline([p, q], **a)


def text(xmm, ymm, s, size=2.5, anchor="start", rot=0, fill=BLK, weight="normal", style="normal", halo=True):
    tr = f' transform="rotate({rot:.1f} {xmm:.2f} {ymm:.2f})"' if rot else ""
    h = ' stroke="#fff" stroke-width="0.5" stroke-linejoin="round" paint-order="stroke"' if halo else ""
    add(f'<text x="{xmm:.2f}" y="{ymm:.2f}" font-size="{size}" text-anchor="{anchor}" fill="{fill}" font-weight="{weight}" font-style="{style}"{h}{tr}>{s}</text>')


def ptext(p, s, **kw):
    text(X(p[0]), Y(p[1]), s, **kw)


def circle_letter(xmm, ymm, ch, r=2.1):
    add(f'<circle cx="{xmm:.2f}" cy="{ymm:.2f}" r="{r}" fill="#fff" stroke="#d1006f" stroke-width="0.3"/>')
    text(xmm, ymm + 1.0, ch, size=2.8, anchor="middle", fill="#d1006f", weight="bold")


def dim(p, q, off, label, color=BLUE, size=1.9, letter=None, ext=True, tick=True, text_side=1):
    """Aligned dimension p->q (frame B), dimension line offset `off` metres to the left of p->q."""
    p, q = np.array(p, float), np.array(q, float)
    d = q - p
    L = np.linalg.norm(d)
    if L < 1e-6:
        return
    t = d / L
    n = np.array([-t[1], t[0]])
    a, b = p + n * off, q + n * off
    sw = 0.13
    if ext:
        for s_, e_ in ((p, a), (q, b)):
            ee = e_ + n * 0.15 * np.sign(off)
            line(s_ + n * 0.08 * np.sign(off), ee, stroke=color, stroke_width=sw)
    line(a, b, stroke=color, stroke_width=sw)
    if tick:
        for c in (a, b):
            k = (t + n) / R2 * 0.12
            line(c - k, c + k, stroke=color, stroke_width=0.35)
    # text: on the dimension line, reading upright
    ang = math.degrees(math.atan2(-(b[1] - a[1]) * S, (b[0] - a[0]) * S))   # screen angle
    if ang > 90.1:
        ang -= 180
    if ang <= -90.1:
        ang += 180
    m = (a + b) / 2
    # place text above the line on screen
    sn = np.array([math.sin(math.radians(ang)), -math.cos(math.radians(ang))])  # screen normal "up" for the rotated text
    tx, ty = X(m[0]) + sn[0] * 0.6 * text_side, Y(m[1]) + sn[1] * 0.6 * text_side
    if text_side < 0:
        tx, ty = X(m[0]) - sn[0] * 2.2, Y(m[1]) - sn[1] * 2.2
    text(tx, ty, label, size=size, anchor="middle", rot=ang, fill=color)
    if letter:
        lx, ly = X(m[0]) + sn[0] * 4.6 * (1 if text_side > 0 else -1), Y(m[1]) + sn[1] * 4.6 * (1 if text_side > 0 else -1)
        circle_letter(lx, ly, letter)


def overlay(layer):
    """Draw the private sheet's ops of one layer (poly | pline | path | text | dim | letter, frame B metres)."""
    for o in OV:
        if o.get("layer") != layer:
            continue
        a = o.get("attrs", {})
        if o["op"] == "poly":
            poly(o["pts"], **a)
        elif o["op"] == "pline":
            pline(o["pts"], **a)
        elif o["op"] == "path":
            d = []
            for c in o["d"]:
                if c[0] == "A":
                    d.append(f"A{c[1] * S:.2f},{c[2] * S:.2f} {c[3]} {c[4]} {c[5]} {X(c[6]):.2f},{Y(c[7]):.2f}")
                else:
                    d.append(f"{c[0]}{X(c[1]):.2f},{Y(c[2]):.2f}")
            attrs = " ".join(f'{k.replace("_", "-")}="{v}"' for k, v in a.items())
            add(f'<path d="{" ".join(d)}" {attrs}/>')
        elif o["op"] == "text":
            ptext(o["p"], o["s"], **o.get("kw", {}))
        elif o["op"] == "dim":
            dim(o["p"], o["q"], o["off"], o["label"], **o.get("kw", {}))
        elif o["op"] == "letter":
            circle_letter(X(o["at"][0]) + o.get("dx_mm", 0.0), Y(o["at"][1]) + o.get("dy_mm", 0.0), o["ch"])
        else:
            raise ValueError(f"unknown sheet op {o['op']!r}")


def lab(L, sig):
    return f"{num(L)} ±{num(sig)}"


def chain(pts, off, color=BLUE, sig_edges=None, letters=None, size=1.9, survey=False, text_side=1):
    for i in range(len(pts) - 1):
        L = math.dist(pts[i], pts[i + 1])
        if survey:
            s_ = f"{num(L)}"
        else:
            e1, e2 = (sig_edges[i], sig_edges[i + 1]) if sig_edges else (0.03, 0.03)
            s_ = lab(L, sig_len(L, e1, e2))
        dim(pts[i], pts[i + 1], off, s_, color=color, size=size, letter=(letters or {}).get(i), text_side=text_side)


# ----------------------------------------------------------------------------- header / defs
add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}mm" height="{H}mm" viewBox="0 0 {W} {H}" font-family="{FONT}">')
add("""<defs>
<pattern id="hatchGrey" patternUnits="userSpaceOnUse" width="2.2" height="2.2" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="2.2" stroke="#9a9a9a" stroke-width="0.18"/></pattern>
<pattern id="hatchBlue" patternUnits="userSpaceOnUse" width="0.9" height="0.9" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="0.9" stroke="#1f5fbf" stroke-width="0.15"/></pattern>
<pattern id="hatchWall" patternUnits="userSpaceOnUse" width="1.2" height="1.2" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="1.2" stroke="#555" stroke-width="0.2"/></pattern>
<clipPath id="vp"><rect x="%.2f" y="%.2f" width="%.2f" height="%.2f"/></clipPath>
<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#111"/></marker>
</defs>""" % (VX0, VY0, VW, VH))
add(f'<rect x="0" y="0" width="{W}" height="{H}" fill="#fff"/>')
add(f'<rect x="20" y="10" width="{W - 30}" height="{H - 20}" fill="none" stroke="{BLK}" stroke-width="0.5"/>')

# ----------------------------------------------------------------------------- main view
add('<g clip-path="url(#vp)">')
# street
poly([(U0 - 1, -0.02), (U0 + 15, -0.02), (U0 + 15, V1 - VH / S - 1), (U0 - 1, V1 - VH / S - 1)], fill="#f4f1ea", stroke="none")
# parcel 24/2 (ALKIS)
par = J["site"]["parcel"]
if par:
    pline(par["ring"], stroke=BLK, stroke_width=0.25, stroke_dasharray="4 1 0.8 1")
# neighbours
for nb in J["site"]["neighbours"]:
    poly(nb["ring"], fill="#ececec", stroke=BLK, stroke_width=0.35)
# bakery footprint: not captured hatch
ring = J["site"]["building"]["footprint"]["ring"]
poly(ring, fill="url(#hatchGrey)", stroke="none")
# room, porch, corridor in white
room = [ROOM[k] for k in ROOM_ORDER]
poly(room, fill="#fff", stroke="none")
porch = J["levels"][0]["rooms"][1]["polygon_xy"]
poly(porch, fill="#fff", stroke="none")
cw, ce, cend = M["corridor_w_u"], M["corridor_e_u"], M["corridor_end_v"]
corr = [ROOM["H"], ROOM["G"], (ce, cend), (cw, cend)]
poly(corr, fill="#fff", stroke="none")
# passage (covered) light tone
pf = M["passage_far_u"]
poly([(north_outer_u(0), 0.0), (pf, 0.27), (pf, PV), (north_outer_u(PV), PV)], fill="#f7f5f0", stroke="none")
line((pf, 0.27), (pf, PV), stroke=BLUE, stroke_width=0.35)
if not OV:
    poly([(north_outer_u(PV), PV), (pf + 0.6, PV), (pf + 0.6, 9.8), (north_outer_u(8.873), 9.8)], fill="url(#hatchGrey)", stroke="none")
overlay("passage")

# ---- walls (survey outer + mesh inner)
fv = M["facade_inner_v"]
piers = [(M["sw_wall_u"] - 0.12, M["win1_sw_u"]), (M["pier1_sw_u"], M["pier1_ne_u"]), (M["pier2_sw_u"], M["pier2_ne_u"])]
for a_, b_ in piers:
    poly([(a_, 0), (b_, 0), (b_, fv), (a_, fv)], fill="#4a4a4a", stroke="none")
# windows (Schaufenster): wall faces + 2 glass lines + inner sill
for a_, b_ in ((M["win1_sw_u"], M["pier1_sw_u"]), (M["pier1_ne_u"], M["pier2_sw_u"])):
    for vv, sw_ in ((0.0, 0.25), (fv, 0.25)):
        line((a_, vv), (b_, vv), stroke=BLK if vv == 0 else BLUE, stroke_width=sw_)
    for vv in (0.20, 0.26):
        line((a_, vv), (b_, vv), stroke=BLUE, stroke_width=0.18)
# corner pillar
pil = [(M["pillar_sw_u"], 0), (north_outer_u(0), 0), (north_outer_u(M["pillar_v"]), M["pillar_v"]), (M["pillar_sw_u"], M["pillar_v"])]
poly(pil, fill="#4a4a4a", stroke=BLUE, stroke_width=0.25)
# north wall: measured part (glass front .. cafe back wall), assumed beyond
nu = M["north_inner_u"]
v_a, v_b = 1.60, M["cafe_back_v"]
poly([(nu, v_a), (north_outer_u(v_a), v_a), (north_outer_u(v_b), v_b), (nu, v_b)], fill="#4a4a4a", stroke="none")
poly([(nu, v_b), (north_outer_u(v_b), v_b), (north_outer_u(8.873), 8.873), (nu, 8.873)], fill="url(#hatchWall)", stroke="none")
overlay("walls")
line((nu, v_b), (nu, 8.873), stroke=BLUE, stroke_width=0.18, stroke_dasharray="1.5 1")
line((nu, v_a), (nu, v_b), stroke=BLUE, stroke_width=0.35)
# facade inner face line (measured)
line((M["sw_wall_u"], fv), (M["glass_side_u"], fv), stroke=BLUE, stroke_width=0.18)

# interior walls: measured face (solid blue) + 0.12 m band with unknown back (hatch + dashed)
def iwall(p, q, side=-1, t=0.12, gaps=()):
    p, q = np.array(p), np.array(q)
    d = (q - p) / np.linalg.norm(q - p)
    n = np.array([-d[1], d[0]]) * side
    segs = [(0.0, 1.0)]
    L = np.linalg.norm(q - p)
    for g0, g1 in gaps:
        new = []
        for s0, s1 in segs:
            a0, a1 = g0 / L, g1 / L
            if a1 <= s0 or a0 >= s1:
                new.append((s0, s1)); continue
            if a0 > s0: new.append((s0, a0))
            if a1 < s1: new.append((a1, s1))
        segs = new
    for s0, s1 in segs:
        a, b = p + (q - p) * s0, p + (q - p) * s1
        poly([a, b, b + n * t, a + n * t], fill="url(#hatchBlue)", stroke="none")
        line(a, b, stroke=BLUE, stroke_width=0.35)
        line(a + n * t, b + n * t, stroke=BLUE, stroke_width=0.13, stroke_dasharray="0.8 0.6")


iwall(ROOM["E"], ROOM["F"], side=-1)             # cafe back wall, band towards +v
iwall(ROOM["F"], ROOM["G"], side=-1)
iwall(ROOM["H"], ROOM["I"], side=-1)
iwall(ROOM["I"], ROOM["K"], side=-1)              # back diagonal (Brotregal)
K, A = ROOM["K"], ROOM["A"]
bk0, bk1 = M["bkst_door_v"]
iwall(K, A, side=-1, gaps=[(K[1] - bk1, K[1] - bk0)])   # SW wall with Backstube opening
iwall(ROOM["G"], (ce, cend), side=-1)            # corridor E wall
iwall((cw, cend), ROOM["H"], side=-1)            # corridor W wall
# corridor end door (Lager) – thin line + leaf
line((cw, cend), (ce, cend), stroke=BLUE, stroke_width=0.25)
add(f'<path d="M{X(cw):.2f},{Y(cend):.2f} A{0.94 * S:.2f},{0.94 * S:.2f} 0 0 1 {X(cw + 0.94 * math.cos(math.radians(60))):.2f},{Y(cend + 0.94 * math.sin(math.radians(60))):.2f}" fill="none" stroke="{BLUE}" stroke-width="0.15" stroke-dasharray="0.6 0.5"/>')
# Backstube opening symbol (estimated, photo)
line((M["sw_wall_u"], bk0), (M["sw_wall_u"] - 0.6, bk0 + 0.35), stroke=ORA, stroke_width=0.2, stroke_dasharray="0.6 0.5")
line((M["sw_wall_u"], bk1), (M["sw_wall_u"] - 0.6, bk1 - 0.1), stroke=ORA, stroke_width=0.2, stroke_dasharray="0.6 0.5")
# glass side wall + glass front with door
gs = M["glass_side_u"]
gf = M["glass_front_v"]
for uu in (gs, M["pier2_ne_u"]):
    line((uu, fv), (uu, gf + 0.04), stroke=BLUE, stroke_width=0.18)
for vv in (gf - 0.03, gf + 0.03):
    line((gs, vv), (nu, vv), stroke=BLUE, stroke_width=0.18)
dm = (gs + nu) / 2
for a_, b_ in ((dm - 0.85, dm), (dm, dm + 0.85)):
    line((a_, gf), (b_, gf), stroke=BLUE, stroke_width=0.5)
line((dm, gf - 0.15), (dm, gf + 0.15), stroke=BLUE, stroke_width=0.18)
ptext((dm, gf + 0.12), "Ladentür (Glas, 2-flg., Lichtmaß offen)", size=1.6, anchor="middle", fill=BLUE)

# steps
for i in range(1, M["steps"]):
    vv = i * M["step_tread"]
    line((M["pier2_ne_u"], vv), (M["pillar_sw_u"] if vv < M["pillar_v"] else north_outer_u(vv) - 0.25, vv), stroke=BLK, stroke_width=0.18)
line((M["pier2_ne_u"], M["landing_v"]), (north_outer_u(M["landing_v"]) - 0.25, M["landing_v"]), stroke=BLK, stroke_width=0.18)
add(f'<line x1="{X(23.1):.2f}" y1="{Y(0.08):.2f}" x2="{X(23.1):.2f}" y2="{Y(1.45):.2f}" stroke="{BLK}" stroke-width="0.2" marker-end="url(#arr)"/>')
ptext((23.25, 0.55), "5 Stg. ≈ 14,4/31", size=1.6)
ptext((23.25, 0.33), "(Mesh, geschätzt)", size=1.4, fill=GREY)

# LoD2 outlines last (survey, solid black)
pline(ring, stroke=BLK, stroke_width=0.6)
for nb in J["site"]["neighbours"]:
    over = nb["id"] == NEIGHBOUR_N
    pline(nb["ring"] + [nb["ring"][0]], stroke=BLK, stroke_width=0.35, **({"stroke_dasharray": "3 1.2"} if over else {}))
line((north_outer_u(M["pillar_v"]), M["pillar_v"] + 0.03), (north_outer_u(1.58), 1.58), stroke="#fff", stroke_width=0.9)
line((north_outer_u(M["pillar_v"]), M["pillar_v"] + 0.03), (north_outer_u(1.58), 1.58), stroke=BLK, stroke_width=0.35, stroke_dasharray="2.5 1")

# ---- fixtures (estimated, orange dotted)
FX = {f["id"]: f for f in J["levels"][0]["rooms"][0]["fixtures"]}
ct0, ct1 = M["counter_t"]; cc0, cc1 = M["counter_c"]
r_end = (cc1 - cc0) / 2
pts = [td(ct1, cc0), td(ct1, cc1), td(ct0 + r_end, cc1)]
for k in range(1, 12):
    a = math.pi / 2 + math.pi * k / 12
    pts.append(td(ct0 + r_end + r_end * math.cos(a), (cc0 + cc1) / 2 + r_end * math.sin(a)))
pts.append(td(ct0 + r_end, cc0))
poly(pts, fill="#fbe9d9", stroke=ORA, stroke_width=0.35, stroke_dasharray="1 0.5")
# Vitrine glass (inner line) + granite ledge (customer side)
pline([td(ct0 + r_end, cc0 + 0.35), td(ct1 - 0.08, cc0 + 0.35)], stroke=ORA, stroke_width=0.15)
pline([td(ct0 + r_end, cc1 - 0.22), td(ct1, cc1 - 0.22)], stroke=ORA, stroke_width=0.15, stroke_dasharray="0.4 0.4")
mid = td((ct0 + ct1) / 2 + 0.2, (cc0 + cc1) / 2 - 0.06)
ptext(mid, "Theke mit Vitrine", size=2.2, anchor="middle", rot=-45, fill=ORA, weight="bold")
ptext(td((ct0 + ct1) / 2 + 0.2, (cc0 + cc1) / 2 + 0.3), "Granitablage OK ≈ 0,65 · Vitrine OK ≈ 1,27", size=1.35, anchor="middle", rot=-45, fill=ORA)
# Brotregal
st0, st1 = M["shelf_t"]
poly([td(st0, M["back_wall_c"]), td(st1, M["back_wall_c"]), td(st1, M["shelf_front_c"]), td(st0, M["shelf_front_c"])],
     fill="#fbe9d9", stroke=ORA, stroke_width=0.3, stroke_dasharray="1 0.5")
for k in range(1, 9):
    tt = st0 + (st1 - st0) * k / 9
    line(td(tt, M["back_wall_c"]), td(tt, M["shelf_front_c"]), stroke=ORA, stroke_width=0.1)
ptext(td((st0 + st1) / 2, (M["back_wall_c"] + M["shelf_front_c"]) / 2 + 0.05), "Brotregal (4 Böden + Körbe)", size=1.7, anchor="middle", rot=-45, fill=ORA, weight="bold")
# aisle label
ptext(td(15.2, (M["shelf_front_c"] + cc0) / 2 + 0.07), "Gang", size=1.8, anchor="middle", rot=-45, fill=GREY)
# Gitterregal
r0, r1 = M["rack_v"]
poly([(M["sw_wall_u"], r0), (M["sw_wall_u"] + 0.45, r0), (M["sw_wall_u"] + 0.45, r1), (M["sw_wall_u"], r1)],
     fill="#fbe9d9", stroke=ORA, stroke_width=0.3, stroke_dasharray="0.5 0.5")
for k in range(1, 4):
    vv = r0 + (r1 - r0) * k / 4
    line((M["sw_wall_u"], vv), (M["sw_wall_u"] + 0.45, vv), stroke=ORA, stroke_width=0.1)
ptext((M["sw_wall_u"] + 0.55, r0 + 0.05), "Gitterregal", size=1.6, fill=ORA)
ptext((M["sw_wall_u"] + 0.55, r0 - 0.17), "(Brottüten)", size=1.4, fill=ORA)
# Backstube opening label
ptext((M["sw_wall_u"] - 0.25, bk1 + 0.75), "Durchgang Backstube", size=1.7, anchor="end", fill=ORA, weight="bold")
ptext((M["sw_wall_u"] - 0.25, bk1 + 0.52), "(nicht erfasst; Foto, Lage geschätzt)", size=1.4, anchor="end", fill=ORA)
# Werbetafel
f4 = FX["F4"]["pose"]["xy"]
poly([td(17.55, 12.55), td(17.9, 12.55), td(17.9, 12.8), td(17.55, 12.8)], fill="#fbe9d9", stroke=ORA, stroke_width=0.25, stroke_dasharray="0.5 0.4")
ptext(td(18.0, 12.62), "Werbetafel", size=1.4, anchor="start", rot=-45, fill=ORA)
# tables
for fid in ("F5", "F6"):
    c = FX[fid]["pose"]["xy"]
    add(f'<circle cx="{X(c[0]):.2f}" cy="{Y(c[1]):.2f}" r="{0.3 * S:.2f}" fill="#fbe9d9" stroke="{ORA}" stroke-width="0.25" stroke-dasharray="0.6 0.4"/>')
ptext((20.95, 0.86), "Bistrotisch", size=1.4, anchor="middle", fill=ORA)
ptext((23.0, 2.31), "Bistrotisch", size=1.4, anchor="middle", fill=ORA)
# Warenregal at cafe back wall
poly([(22.25, M["cafe_back_v"]), (nu, M["cafe_back_v"]), (nu, M["cafe_back_v"] - 0.4), (22.25 + 0.4, M["cafe_back_v"] - 0.4)],
     fill="#fbe9d9", stroke=ORA, stroke_width=0.3, stroke_dasharray="1 0.5")
ptext((23.3, M["cafe_back_v"] - 0.3), "Regal / Kühlschrank", size=1.5, anchor="middle", fill=ORA)
# pendants + Abhängung (above cut plane: long dashes)
for fid in ("F8", "F9"):
    c = FX[fid]["pose"]["xy"]
    add(f'<circle cx="{X(c[0]):.2f}" cy="{Y(c[1]):.2f}" r="2" fill="none" stroke="{ORA}" stroke-width="0.2" stroke-dasharray="0.6 0.4"/>')
    line((c[0] - 0.1, c[1] - 0.1), (c[0] + 0.1, c[1] + 0.1), stroke=ORA, stroke_width=0.15)
    line((c[0] - 0.1, c[1] + 0.1), (c[0] + 0.1, c[1] - 0.1), stroke=ORA, stroke_width=0.15)
pline([td(13.9, M["back_wall_c"]), td(18.4, M["back_wall_c"]), td(18.4, 12.6), td(13.9, 12.6), td(13.9, M["back_wall_c"])],
      stroke=ORA, stroke_width=0.2, stroke_dasharray="3 1.2")
ptext(td(18.2, (M["shelf_front_c"] + cc0) / 2 + 0.06), "Abhängung Holz, UK ≈ 2,0 (über Schnitt)", size=1.3, anchor="end", rot=-45, fill=ORA)
# Abholschrank in the passage (public, ADR 0047): fixture frame origin = street-side front corner, length along +y
X1 = next((f for f in J["site"].get("fixtures", []) if f["id"] == "X1" and f.get("pose")), None)
if X1:
    (xf, yf), sz = X1["pose"]["xy"], X1["size"]
    xb, y1 = xf - sz["d"], yf + sz["l"]
    poly([(xb, yf), (xf, yf), (xf, y1), (xb, y1)], fill="#fbe9d9", stroke=ORA, stroke_width=0.35, stroke_dasharray="1 0.5")
    line((xb, yf), (xf, y1), stroke=ORA, stroke_width=0.12)
    line((xb, y1), (xf, yf), stroke=ORA, stroke_width=0.12)
    ptext((xf + 0.15, (yf + y1) / 2 + 0.1), "Abholschrank", size=1.8, fill=ORA, weight="bold")
    ptext((xf + 0.15, (yf + y1) / 2 - 0.17), f"{num(sz['l'])} × {num(sz['d'])}, H ≈ {num(sz['h'])} ab Durchgang", size=1.4, fill=ORA)
overlay("fixtures")

# ---- labels
ptext((21.95, 3.55), "Verkaufsraum", size=3.2, anchor="middle", weight="bold")
area = J["levels"][0]["rooms"][0]["area"]
ptext((21.95, 3.33), "Kundenbereich / Café", size=1.7, anchor="middle")
ptext((21.95, 3.12), f"≈ {num(area['v'], 1)} m² ±{num(area['sigma_m'], 1)} · RH ≈ {num(M['ceiling_h'])} ±0,25", size=1.6, anchor="middle", fill=BLUE)
ptext((21.95, 2.93), "±0,00 = 244,25 m ü. NHN (FFB)", size=1.5, anchor="middle")
ptext((23.1, 0.95), "Eingang", size=2.6, anchor="middle", weight="bold")
ptext((ce + 0.2, 6.25), "Durchgang hinten", size=1.8, fill=BLUE, weight="bold")
ptext((ce + 0.2, 6.0), "→ Lager / Backstube", size=1.5, fill=BLUE)
ptext((ce + 0.2, 5.78), "(nicht erfasst)", size=1.5, fill=BLUE)
ptext((26.15, 1.1), "Durchgang", size=2.2, anchor="middle", weight="bold")
ptext((26.15, 0.88), "(überbaut)", size=1.4, anchor="middle")
if not OV:
    ptext((26.3, (PV + 9.8) / 2), "privat – nicht dargestellt", size=2.2, anchor="middle", fill=GREY, style="italic", rot=-90)
overlay("labels")
ptext((18.0, 7.6), "noch nicht erfasst", size=2.4, anchor="middle", fill=GREY, style="italic")
ptext((15.6, 0.9), "noch nicht erfasst", size=2.0, anchor="middle", fill=GREY, style="italic", rot=-90)
ptext((22.0, -2.0), "Straße: Eckstraße", size=3.2, anchor="middle", weight="bold")
add(f'<line x1="{X(17.6):.2f}" y1="{Y(-1.95):.2f}" x2="{X(14.8):.2f}" y2="{Y(-1.95):.2f}" stroke="{BLK}" stroke-width="0.3" marker-end="url(#arr)"/>')
ptext((15.0, -1.85), "Kreisel (Ortsstraße) 42 m in Fassadenflucht", size=1.6)
ptext((27.4, -1.2), "Nachbargebäude", size=1.6, anchor="end")
ptext((27.4, -1.45), "(LoD2)", size=1.4, anchor="end")
if par:
    ptext((15.0, 8.3), f"Flst. {par['nummer']} (ALKIS)", size=1.6)
# heights
for (u, v, s_) in ((22.0, -0.45, "−0,72 (243,53) Straße, DGM1 243,54"), (25.0, 1.35, "−0,65 Durchgang")):
    ptext((u, v), s_, size=1.5)

# ---- dimension chains
# D1: facade openings (outside, mesh)
d1 = [(M["win1_sw_u"], 0), (M["pier1_sw_u"], 0), (M["pier1_ne_u"], 0), (M["pier2_sw_u"], 0), (M["pier2_ne_u"], 0), (M["pillar_sw_u"], 0), (north_outer_u(0), 0)]
chain(d1, -0.75, sig_edges=[0.15, 0.15, 0.15, 0.03, 0.03, 0.03, 0.10], letters={})  # pier 1 from the photo ratio (±0.15)
# A marker over pier1 SW .. pillar
dim((M["pier1_sw_u"], 0), (M["pillar_sw_u"], 0), -1.25, f"A = {lab(M['pillar_sw_u'] - M['pier1_sw_u'], sig_len(M['pillar_sw_u'] - M['pier1_sw_u']))} (Maßstab!)", color="#d1006f", size=1.9)
circle_letter(X(18.1), Y(-1.25), "A")
# D2: interior widths (mesh)
dim((M["sw_wall_u"], 1.0), (gs, 1.0), 0.0, lab(gs - M["sw_wall_u"], sig_len(5.0)), color=BLUE, letter=None, ext=False)
circle_letter(X(16.95 + 0.6), Y(1.0) - 3.2, "B")
# D3: depth along the north wall (LoD2) + mesh chain in the passage
dim((north_outer_u(0) + 3.25, 0), (north_outer_u(8.873) + 3.25 - 0.19, 8.873), 0.0, "8,87 (LoD2)", color=BLK)
chain([(27.05, 0.0), (27.05, gf), (27.05, M["cafe_back_v"]), (27.05, cend)], -0.0,
      sig_edges=[0.1, 0.06, 0.05, 0.1])
circle_letter(X(27.05) - 3.4, Y((gf + M["cafe_back_v"]) / 2 + 0.4), "C")
# passage width
dim((M["north_outer_mesh_u"], 0.5), (pf, 0.5), 0.0, lab(pf - M["north_outer_mesh_u"], sig_len(2.87)), color=BLUE)
if X1:  # J: street end of the passage .. Abholschrank
    dim((X1["pose"]["xy"][0] + 0.05, 0.0), (X1["pose"]["xy"][0] + 0.05, X1["pose"]["xy"][1]), 0.0,
        f"{num(X1['pose']['xy'][1])} ±{num(X1['sigma_m'])}", color=ORA, size=1.6)
    circle_letter(X(X1["pose"]["xy"][0] + 0.05) + 3.0, Y(2.2), "J")
overlay("dims")
# diagonal: back wall K->I
dim(K, ROOM["I"], 0.55, lab(math.dist(K, ROOM["I"]), sig_len(4.95, 0.05, 0.08)), color=BLUE, letter="D")
# counter length (customer side)
dim(td(ct0, cc1), td(ct1, cc1), -0.42, lab(ct1 - ct0, sig_len(4.25, 0.15, 0.05)), color=ORA, letter="E")
# cross chain at the NE end of the counter: wall | shelf front | counter back | counter front
cx = [td(18.15 + 0.0, c) for c in (M["back_wall_c"], M["shelf_front_c"], cc0, cc1)]
for i in range(3):
    L = M["shelf_front_c"] - M["back_wall_c"] if i == 0 else (cc0 - M["shelf_front_c"] if i == 1 else cc1 - cc0)
    dim(cx[i], cx[i + 1], 0.0, num(L) if i != 1 else lab(L, sig_len(L, 0.05, 0.05)), color=ORA if i != 1 else BLUE, size=1.5, ext=False)
circle_letter(X(cx[1][0]) + 5.5, Y(cx[1][1]) - 1.0, "F")
# corridor width
dim((cw, 6.75), (ce, 6.75), 0.0, lab(ce - cw, sig_len(0.94, 0.1, 0.05)), color=BLUE, size=1.6, ext=False)
# cafe back wall + right diagonal
dim(ROOM["F"], ROOM["E"], 0.35, lab(nu - ROOM["F"][0], sig_len(2.13)), color=BLUE, size=1.6, ext=False)
# SW wall chain (with Backstube opening, estimated)
chain([(M["sw_wall_u"], fv), (M["sw_wall_u"], bk0), (M["sw_wall_u"], bk1), K], 0.75, sig_edges=[0.03, 0.3, 0.3, 0.08], size=1.5)
# glass front width
dim((gs, gf), (nu, gf), 0.45, lab(nu - gs, sig_len(2.48, 0.05, 0.03)), color=BLUE, size=1.6)
# wall thickness marks
ptext((M["pier2_sw_u"] + 0.02, 0.28), f"{num(fv)}", size=1.3, fill="#fff")
ptext((nu + 0.03, 2.95), f"{num(north_outer_u(2.8) - nu)}", size=1.3, fill="#fff", rot=-90)
# G, H, I letters
circle_letter(X(21.95) - 20.5, Y(3.33) - 0.6, "G")
circle_letter(X(M["pier2_sw_u"] + 0.3), Y(fv) + 4.0, "H")
circle_letter(X(dm) + 27, Y(gf) - 1.5, "I")
add("</g>")
add(f'<rect x="{VX0}" y="{VY0}" width="{VW}" height="{VH}" fill="none" stroke="{BLK}" stroke-width="0.25"/>')

# ----------------------------------------------------------------------------- north arrow (main view) + scale bar
def north_arrow(cx, cy, rot, r=7, label=True):
    add(f'<g transform="translate({cx:.2f} {cy:.2f}) rotate({rot:.2f})">'
        f'<circle r="{r}" fill="#fff" stroke="{BLK}" stroke-width="0.25"/>'
        f'<path d="M0,{-r + 0.8} L{r * 0.32:.2f},{r * 0.45:.2f} L0,{r * 0.2:.2f} z" fill="{BLK}"/>'
        f'<path d="M0,{-r + 0.8} L{-r * 0.32:.2f},{r * 0.45:.2f} L0,{r * 0.2:.2f} z" fill="#fff" stroke="{BLK}" stroke-width="0.2"/>'
        f'<text x="0" y="{-r - 1.2}" font-size="3" text-anchor="middle" font-weight="bold">N</text></g>')


# drawing "up" = bearing of +y (295.75 deg); north appears rotated clockwise by (360 - 295.75)
rot_n = (360 - (BEARING_X - 90)) % 360
north_arrow(VX0 + VW - 12, VY0 + 14, rot_n)
text(VX0 + VW - 12, VY0 + 26.5, "Gitternord", size=1.5, anchor="middle")
text(VX0 + VW - 12, VY0 + 28.4, "(γ ≈ −1,2°)", size=1.4, anchor="middle")
# scale bar 0..5 m
sx, sy = VX0 + 6, VY0 + VH - 7
for i in range(5):
    add(f'<rect x="{sx + i * S:.2f}" y="{sy:.2f}" width="{S:.2f}" height="1.5" fill="{BLK if i % 2 == 0 else "#fff"}" stroke="{BLK}" stroke-width="0.2"/>')
    text(sx + i * S, sy - 1, str(i), size=2, anchor="middle")
text(sx + 5 * S, sy - 1, "5 m", size=2, anchor="middle")
text(sx, sy + 4.5, "Grundriss EG · M 1:50 (A3)", size=2.4, weight="bold")

# ----------------------------------------------------------------------------- right column: Lageplan 1:1000 (north up)
LX0, LY0, LW, LH = 296.0, 14.0, 111.0, 96.0
SL = 1.0                                     # 1:1000 -> 1 mm per m
cE, cN = 381462.0, 5462230.0


def LP(EN):
    return f"{LX0 + LW / 2 + (EN[0] - cE) * SL:.2f},{LY0 + LH / 2 - (EN[1] - cN) * SL:.2f}"


add(f'<clipPath id="lp"><rect x="{LX0}" y="{LY0}" width="{LW}" height="{LH}"/></clipPath>')
add(f'<g clip-path="url(#lp)">')
add(f'<rect x="{LX0}" y="{LY0}" width="{LW}" height="{LH}" fill="#fff"/>')
parcels = json.load(open(SP + "work/parcels_near.json"))["features"]
for f in parcels:
    for ringp in ([f["geometry"]["coordinates"][0]] if f["geometry"]["type"] == "Polygon" else [p[0] for p in f["geometry"]["coordinates"]]):
        hl = f["properties"]["text"] == "24/2" and f["properties"]["gemarkung"] == "Kirrberg"
        add(f'<polygon points="{" ".join(LP(p) for p in ringp)}" fill="{"#fff3c4" if hl else "none"}" stroke="#888" stroke-width="{0.3 if hl else 0.12}"/>')
osm = json.load(open(SP + "work/osm_near.json"))["features"]
for f in osm:
    if f["geometry"]["type"] != "LineString":
        continue
    w = 2.2 if f["properties"].get("highway") in ("tertiary",) else (1.6 if f["properties"].get("kind") == "road" else 0.5)
    add(f'<polyline points="{" ".join(LP(p) for p in f["geometry"]["coordinates"])}" fill="none" stroke="#d9d4c7" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>')
for b in lod2():
    rg = b["ground"][0]
    isb = b["id"] == BAKERY
    add(f'<polygon points="{" ".join(LP(p) for p in rg)}" fill="{"#c2620a" if isb else "#bdbdbd"}" stroke="{BLK}" stroke-width="{0.3 if isb else 0.15}"/>')
# main view extent
corners = [to_en(np.array(c)) for c in ((U0, V1), (U0 + VW / S, V1), (U0 + VW / S, V1 - VH / S), (U0, V1 - VH / S))]
add(f'<polygon points="{" ".join(LP(c) for c in corners)}" fill="none" stroke="#d1006f" stroke-width="0.3" stroke-dasharray="1.5 0.8"/>')
kre = np.array([381446.4, 5462198.7])
add(f'<circle cx="{LX0 + LW / 2 + (kre[0] - cE):.2f}" cy="{LY0 + LH / 2 - (kre[1] - cN):.2f}" r="5" fill="none" stroke="#999" stroke-width="0.3"/>')
kx, ky = LX0 + LW / 2 + (kre[0] - cE), LY0 + LH / 2 - (kre[1] - cN)
text(kx + 6, ky + 4, "Kreisel", size=2.0)
gab = to_en(np.array([0.0, 3.4]))
gx, gy = LX0 + LW / 2 + (gab[0] - cE), LY0 + LH / 2 - (gab[1] - cN)
add(f'<line x1="{kx:.2f}" y1="{ky:.2f}" x2="{gx:.2f}" y2="{gy:.2f}" stroke="{ORA}" stroke-width="0.2" stroke-dasharray="0.8 0.6"/>')
add(f'<circle cx="{gx:.2f}" cy="{gy:.2f}" r="1.1" fill="#fff" stroke="{ORA}" stroke-width="0.3"/>')
text(gx - 1.6, gy - 1.3, "Wandmalerei über Pavillon?", size=1.7, anchor="end", fill=ORA)
text(gx - 1.6, gy + 0.9, "(Nutzerangabe, vom Kreisel sichtbar –", size=1.3, anchor="end", fill=ORA)
text(gx - 1.6, gy + 2.6, "Südgiebel vermutet, unbestätigt)", size=1.3, anchor="end", fill=ORA)
bx = to_en(np.array([12.0, 4.5]))
text(LX0 + LW / 2 + (bx[0] - cE) + 9, LY0 + LH / 2 - (bx[1] - cN) - 9, "Eckstraße 3", size=2.0, weight="bold")
text(LX0 + LW / 2 + (bx[0] - cE) + 9, LY0 + LH / 2 - (bx[1] - cN) - 6.8, f"Flst. {par['nummer'] if par else '?'}, {par['flaeche_amtlich_m2'] if par else ''} m²", size=1.6)
for nm, EN, rot in (("Eckstraße", (381488, 5462270), -70), ("Ortsstraße", (381420, 5462202), 0), ("Am Dorfplatz", (381423, 5462230), -88), ("Mörsbacher Str.", (381478, 5462186), -35)):
    text(LX0 + LW / 2 + (EN[0] - cE), LY0 + LH / 2 - (EN[1] - cN), nm, size=1.8, anchor="middle", rot=rot, fill="#6b6253", style="italic")
add("</g>")
add(f'<rect x="{LX0}" y="{LY0}" width="{LW}" height="{LH}" fill="none" stroke="{BLK}" stroke-width="0.25"/>')
north_arrow(LX0 + LW - 8, LY0 + 10, 0, r=5)
text(LX0 + 2, LY0 + LH - 2.5, "Lageplan · M 1:1000 · Gitternord oben", size=2.0, weight="bold")
for i in range(3):
    add(f'<rect x="{LX0 + 2 + i * 10:.2f}" y="{LY0 + LH - 9:.2f}" width="10" height="1.2" fill="{BLK if i % 2 == 0 else "#fff"}" stroke="{BLK}" stroke-width="0.15"/>')
text(LX0 + 2, LY0 + LH - 10, "0", size=1.6, anchor="middle"); text(LX0 + 32, LY0 + LH - 10, "30 m", size=1.6, anchor="middle")

# ----------------------------------------------------------------------------- legend
gy0 = LY0 + LH + 5
text(LX0, gy0, "Legende", size=2.8, weight="bold")
items = [
    ("line", BLK, 0.6, None, "vermessen: LoD2-Außenwand / ALKIS (σ ≈ 0,1 m)"),
    ("fill", "#4a4a4a", 0, None, "Außenwand: außen LoD2, innen Mesh (Stärke ±0,08)"),
    ("line", BLUE, 0.35, None, "aus Mesh (Video), Maße blau mit ±σ, Maßstab ±11 %"),
    ("hatchb", BLUE, 0.35, None, "Innenwand: Fläche aus Mesh, Rückseite nicht erfasst"),
    ("line", ORA, 0.35, "1 0.5", "Einrichtung geschätzt (Mesh + Foto/Video)"),
    ("line", ORA, 0.2, "3 1.2", "über der Schnittebene (Abhängung)"),
    ("hatch", GREY, 0, None, "noch nicht erfasst (Backstube, Lager, Wohnteil)"),
    ("line", BLK, 0.25, "4 1 0.8 1", "Flurstücksgrenze (ALKIS)"),
    ("letter", None, 0, None, "Messpunkt der Messliste (A = Maßstab)"),
]
yy = gy0 + 4.5
for kind, col, sw_, da, label in items:
    x0 = LX0
    if kind == "line":
        add(f'<line x1="{x0}" y1="{yy - 0.8}" x2="{x0 + 9}" y2="{yy - 0.8}" stroke="{col}" stroke-width="{sw_}"' + (f' stroke-dasharray="{da}"' if da else "") + "/>")
    elif kind == "fill":
        add(f'<rect x="{x0}" y="{yy - 2}" width="9" height="2.4" fill="{col}"/>')
    elif kind == "hatchb":
        add(f'<rect x="{x0}" y="{yy - 2}" width="9" height="2.4" fill="url(#hatchBlue)"/><line x1="{x0}" y1="{yy + 0.4}" x2="{x0 + 9}" y2="{yy + 0.4}" stroke="{BLUE}" stroke-width="0.35"/>')
    elif kind == "hatch":
        add(f'<rect x="{x0}" y="{yy - 2}" width="9" height="2.4" fill="url(#hatchGrey)" stroke="{GREY}" stroke-width="0.1"/>')
    elif kind == "letter":
        circle_letter(x0 + 4.5, yy - 0.8, "A", r=1.7)
    text(x0 + 11, yy, label, size=1.9)
    yy += 3.6

# ----------------------------------------------------------------------------- title block
ty = 222.0
add(f'<rect x="{LX0}" y="{ty}" width="{LW}" height="{H - 10 - ty}" fill="#fff" stroke="{BLK}" stroke-width="0.35"/>')
text(LX0 + 2.5, ty + 6, "Bäckerei Heusser – Raumplan v0", size=4.4, weight="bold")
text(LX0 + 2.5, ty + 10.5, "(Außen + Verkaufsraum)", size=3.0, weight="bold")
text(LX0 + 2.5, ty + 15.5, "Entwurf aus LoD2 + Videoaufnahme, Maße ±11 % bis Aufmaß", size=2.35, fill="#b00020", weight="bold")
lines = [
    "Eckstraße 3, 66424 Homburg-Kirrberg · Flst. Kirrberg, Flur 1, Nr. 24/2",
    "Grundriss EG M 1:50 · Lageplan M 1:1000 · Blatt A3 quer",
    "±0,00 = FFB Verkaufsraum = 244,25 m ü. NHN (DHHN2016, ±0,10)",
    "Lage: ETRS89/UTM32N (EPSG:25832) · Rahmen B: Ursprung SSW-Ende",
    "LoD2-Straßenfassade E 381464,680 N 5462236,762, x-Achse 25,746°",
    "Traufe +6,13 (250,38) · First +9,64 (253,89) · LoD2-Boden −1,02",
    "Ein Bandmaß (A) fixiert den Maßstab aller blauen Werte (Pivot NO-Ecke)",
    "Messliste A–J: messliste.md · Daten: raumplan-v0.json",
    "Stand 2026-11-05 · Status ENTWURF – kein Aufmaß · Blatt RP-00 v0",
]
for i, s_ in enumerate(lines):
    text(LX0 + 2.5, ty + 20.5 + i * 3.25, s_, size=1.95)
att = ["LoD2-Gebäude, DGM1, ALKIS-Flurstücke: © GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0;",
       "Straßen: © OpenStreetMap-Mitwirkende (ODbL); Innenraum: eigene Videoaufnahme",
       "mit Erlaubnis der Inhaber (Daten bearbeitet)."]
for i, s_ in enumerate(att):
    text(LX0 + 2.5, ty + 53.0 + i * 2.6, s_, size=1.6, fill="#444")
add("</svg>")
open(OUT, "w").write("\n".join(out))
print("wrote", OUT)
