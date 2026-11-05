"""Generic shelf goods and low-triangle roll variants for the twin's fills (docs/style.md look: unlit + baked light,
round-overs, no textures, no brands, no labels with text).

    parts = ware(ware_id, idx)        # jar, can, bottle, cup, coffee pack, paper bag, pastry bag, stack of bags
    parts = low(product, idx)         # rolls for heaped baskets: 60–120 triangles instead of 200–300

Same local frame and conventions as shapes.py (x = width, y = up, z = depth, +z = towards the visitor, base at
y = 0, centred). Both are deterministic: colours and variation come from sha256(id#idx) like shapes.build.
"""
from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import fill as FL  # noqa: E402
import shapes as S  # noqa: E402

LOW_BUDGET = 120     # task budget for bulk rolls (heaped baskets)
WARE_BUDGET = 160    # a jar or bottle stays well under the 300 of a product instance

# shop goods: content / lid colours from the twin's palette (no new tokens, moderate saturation)
JAR_FILL = {"glas-honig": ("butter", "kruste"), "glas-marmelade": ("kirsche", "bild-rot", "blume"),
            "glas-klein": ("kirsche", "blume", "schoko", "butter"), "glas-hoch": ("blatt", "kirsche", "kruste")}
LIDS = ("messing", "messing", "thekenrot", "lack-schwarz", "chrom")
CAN_BODY = ("thekenrot", "filz-gruen", "bild-rot", "glasbaustein-blau", "blume")
BOTTLE_BODY = ("glasbaustein-gruen", "glasbaustein-gruen", "kruste-dunkel", "glasbaustein-hell", "blume")
SYRUP_BODY = ("bild-rot", "kruste-dunkel", "butter", "filz-gruen")
CUP_BODY = ("regal-weiss", "regal-weiss", "regal-weiss", "thekenrot", "kissen")
PACK_BODY = ("holz-dunkel", "bild-rot", "kissen", "schoko")


def _rng(key: str, idx: int) -> random.Random:
    return random.Random(S.seed(key, idx))


def _band(body: S.Part, layers) -> list[S.Part]:
    c = S.tri_centroids(body)
    return S.paint(body, [(f(c), mat) for f, mat in layers])


def _jar(wid: str, size, rng) -> list[S.Part]:
    w, d, h = size
    r = w / 2
    body = S.lathe([(r * 0.94, 0.0), (r, 0.12 * h), (r, 0.30 * h), (r, 0.54 * h), (r, 0.70 * h), (0.84 * r, 0.80 * h),
                    (0.86 * r, h), (0.0, h)], 8,
                   mat=rng.choice(JAR_FILL[wid]))
    lid = rng.choice(LIDS)
    return _band(body, [(lambda c: (c[:, 1] > 0.30 * h) & (c[:, 1] < 0.52 * h), "papier"), (lambda c: c[:, 1] > 0.80 * h, lid)])


def _can(size, rng) -> list[S.Part]:
    w, d, h = size
    r = w / 2
    body = S.lathe([(r * 0.97, 0.0), (r, 0.08 * h), (r, 0.92 * h), (0.96 * r, h), (0.0, h)], 8, mat=rng.choice(CAN_BODY))
    return _band(body, [(lambda c: (c[:, 1] < 0.1 * h) | (c[:, 1] > 0.9 * h), "chrom")])


def _bottle(size, rng, syrup: bool) -> list[S.Part]:
    w, d, h = size
    r = w / 2
    prof = [(0.96 * r, 0.0), (r, 0.05 * h), (r, 0.58 * h), (0.5 * r, 0.76 * h), (0.32 * r, 0.86 * h), (0.32 * r, h), (0.0, h)]
    body = S.lathe(prof, 7, mat=rng.choice(SYRUP_BODY if syrup else BOTTLE_BODY))
    cap = rng.choice(("thekenrot", "chrom", "lack-schwarz", "filz-gruen"))
    return _band(body, [(lambda c: (c[:, 1] > 0.16 * h) & (c[:, 1] < 0.44 * h), "papier"), (lambda c: c[:, 1] > 0.88 * h, cap)])


def _cup(size, rng) -> list[S.Part]:
    w, d, h = size
    r = d / 2
    mat = rng.choice(CUP_BODY)
    body = S.lathe([(0.78 * r, 0.0), (r, h), (0.9 * r, h), (0.7 * r, 0.14 * h), (0.0, 0.14 * h)], 10, mat=mat)
    body.v[:, 0] -= (w - d) / 2                            # the handle sits on +x; keep the whole cup centred later
    hx = body.v[:, 0].max()
    path = np.array([[hx - 0.006, 0.78 * h, 0.0], [hx + 0.016, 0.74 * h, 0.0], [hx + 0.022, 0.50 * h, 0.0],
                     [hx + 0.014, 0.28 * h, 0.0], [hx - 0.006, 0.24 * h, 0.0]])
    handle = S.tube(path, 0.006, 0.006, sides=4, mat=mat, tip=0.2)
    return [body, handle]


def _pack(size, rng) -> list[S.Part]:
    w, d, h = size
    mat = rng.choice(PACK_BODY)
    parts = S.box(-w / 2, w / 2, 0.0, 0.86 * h, -d / 2, d / 2, 0.004, mat)
    parts += S.box(-w / 2 * 0.96, w / 2 * 0.96, 0.86 * h, h, -d / 2 * 0.35, d / 2 * 0.35, 0.002, mat)   # folded top
    body = parts[0]
    c = S.tri_centroids(body)
    return S.paint(body, [((c[:, 1] > 0.35 * h) & (c[:, 1] < 0.6 * h), "papier")]) + parts[1:]


def _bag(size, rng) -> list[S.Part]:
    """Bread in a paper bag: the bag (open, a little narrower at the top) with the loaf's crown showing."""
    w, d, h = size
    yb = 0.80 * h
    bag = S.box(-w / 2, w / 2, 0.0, yb, -d / 2, d / 2, 0.004, "papier", top=None)
    crust = rng.choice(("kruste", "kruste-hell", "kruste-dunkel"))
    loaf = S.lathe([(1.0, 0.0), (0.92, 0.45), (0.6, 0.85), (0.0, 1.0)], 8, mat=crust)
    loaf = S.transform([loaf], np.diag([0.46 * w, h - yb + 0.02, 0.42 * d]), (0.0, yb - 0.02, 0.0))
    return bag + loaf


def _pastry_bag(size, rng) -> list[S.Part]:
    """A filled pastry bag standing on the display's glass top: white paper, a little fuller at the belly, the top
    folded over once (video inventory: ≈ 0.15 × 0.10 × 0.25)."""
    w, d, h = size
    yf = 0.82 * h
    body = S.box(-w / 2, w / 2, 0.0, yf, -d / 2, d / 2, 0.006, "papier")
    flap = S.box(-w / 2 * 0.98, w / 2 * 0.98, yf, h, -d / 2 * 0.25, d / 2 * 0.25, 0.003, "papier")
    return body + flap


def _bag_stack(size, rng) -> list[S.Part]:
    w, d, h = size
    out = []
    k = 3
    for i in range(k):
        a = rng.uniform(-6, 6)
        q = S.box(-w / 2 * 0.96, w / 2 * 0.96, i * h / k, (i + 1) * h / k - 0.001, -d / 2 * 0.96, d / 2 * 0.96, 0.002,
                  "papier" if i % 2 == 0 else "kruste-hell")
        out += S.transform(q, S.rot_y(a))
    return out


def ware(wid: str, idx: int = 0) -> list[S.Part]:
    """Mesh parts of one generic good (fill.WAREN id), true size, deterministic colour and a small turn."""
    g = FL.WAREN[wid]
    size = [float(x) for x in g["size_m"]]
    rng = _rng(wid, idx)
    shape = g["shape"]
    if shape == "glas":
        parts = _jar(wid, size, rng)
    elif shape == "dose":
        parts = _can(size, rng)
    elif shape == "flasche":
        parts = _bottle(size, rng, wid == "flasche-sirup")
    elif shape == "becher":
        parts = _cup(size, rng)
    elif shape == "packung":
        parts = _pack(size, rng)
    elif shape == "tuete":
        parts = _bag(size, rng)
    elif shape == "tueten-stapel":
        parts = _bag_stack(size, rng)
    elif shape == "gebaecktuete":
        parts = _pastry_bag(size, rng)
    else:
        raise KeyError(f"no shape for ware {wid!r}")
    parts = S.fit([q for q in parts if len(q.t)], size)
    if shape in ("glas", "dose", "flasche"):
        parts = S.transform(parts, S.rot_y(rng.uniform(0, 360)))
    else:
        parts = S.transform(parts, S.rot_y(rng.uniform(-10, 10)))
    return parts


# ----------------------------------------------------------------------------------------------- low rolls

LOW_SHAPES = {"broetchen-rund", "broetchen-stern", "broetchen-schlitz", "doppelweck"}


def low(product: dict, idx: int = 0, vary: bool = True) -> list[S.Part]:
    """A roll with the same silhouette, colours and one painted signature detail (seed cap, flour, split, cross,
    star), ≈ 80–110 triangles. Falls back to shapes.build for other shapes."""
    shape = product["shape"]
    if shape not in LOW_SHAPES:
        return S.build(product, idx, vary)
    p = dict(product.get("shape_params") or {})
    W, D, H = (float(x) for x in product["size_m"])
    rng = random.Random(S.seed(product["id"], idx))
    crust = p.get("crust", "kruste-hell")
    if shape == "doppelweck":
        n = int(p.get("lobes", 2))
        ov = 0.22
        lw = W / (n - (n - 1) * ov)
        parts = []
        sides = 7 if n <= 2 else 5                          # 3-lobe Einback stays under LOW_BUDGET
        for i in range(n):
            b = S.lathe(S.dome_prof(H, foot=0.84, belly=0.34, flat=0.8, angles=(45,)), sides, lw / 2, D / 2, mat=crust,
                        phase=rng.uniform(0, 1))
            b.v[:, 0] += -W / 2 + lw / 2 + i * lw * (1 - ov)
            parts.append(b)
    else:
        segs = 10 if shape == "broetchen-stern" else 9
        body = S.lathe(S.dome_prof(H, foot=0.84, belly=0.34, flat=0.75, angles=(40, 68)), segs, W / 2, D / 2, mat=crust,
                       phase=rng.uniform(0, 1))
        c = S.tri_centroids(body)
        rho = np.hypot(c[:, 0] / (W / 2), c[:, 2] / (D / 2))
        top = c[:, 1] > 0.55 * H
        layers = []
        floury = bool(p.get("flour"))
        if floury:
            layers.append((top & (rho < 0.62), "mehl"))
        cap = S.TOPPING_CAP.get(p.get("topping"))
        if cap:
            layers.append((top & (rho < 0.7), cap))
        elif p.get("topping") in ("schoko", "rosinen", "kuemmel"):
            layers.append((top & (rho < 0.45), {"schoko": "schoko", "rosinen": "rosine", "kuemmel": "kuemmel"}[p["topping"]]))
        cut = S.cut_mat(crust, floury)
        if shape == "broetchen-schlitz":
            layers.append((top & (np.abs(c[:, 2]) < 0.16 * D) & (np.abs(c[:, 0]) < 0.38 * W), "ausbund"))
        elif shape == "broetchen-stern":
            th = np.arctan2(c[:, 2] / (D / 2), c[:, 0] / (W / 2))
            g = np.zeros(len(c), bool)
            for k in range(5):
                g |= np.abs(np.angle(np.exp(1j * (th - 2 * math.pi * k / 5)))) < 0.2
            layers.append((top & g, "ausbund"))
        elif p.get("cuts") == "kreuz":
            layers.append((top & ((np.abs(c[:, 0]) < 0.12 * W) | (np.abs(c[:, 2]) < 0.12 * D)), cut))
        parts = S.paint(body, layers)
        if p.get("salt"):
            for _ in range(3):
                a, rr = rng.uniform(0, 2 * math.pi), rng.uniform(0.15, 0.4)
                parts.append(S.octa((rr * W / 2 * math.cos(a), 0.93 * H, rr * D / 2 * math.sin(a)), 0.0035, "salz"))
    parts = S.fit([q for q in parts if len(q.t)], [W, D, H])
    if vary:
        va = S.variation(product["id"], idx)
        s = va["scale"]
        parts = S.transform(parts, np.diag([s * va["stretch"], s, s / va["stretch"]]))
        parts = S.transform(parts, S.rot_y(va["rot_deg"] * 4))          # loose in a basket: any direction
        for q in parts:
            if q.mat in S.CRUSTS:
                q.ao = (np.ones(len(q.v)) if q.ao is None else q.ao) * va["tone"]
    return parts
