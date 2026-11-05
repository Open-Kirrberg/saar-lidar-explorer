"""Palette (docs/style.md) and the baked light rigs.

Unlit rendering: final colour = palette colour (baseColorFactor, linear) × COLOR_0 (baked light, linear). The bake
is a soft Lambert from one warm key light plus a hemisphere fill (cool sky above, warm bounce below), as style.md
asks: daytime, open shop, lifted shadows, no specular. Interior faces use a rig whose key light comes in through the
shop windows and from the ceiling lamps; exterior faces a high afternoon sun from the south-south-east.
"""
from __future__ import annotations

import math
from typing import Callable

import numpy as np

# sRGB hex, from docs/style.md (shop palette + context colours sampled from the orthophoto, simplified)
PALETTE = {
    "heusser-rot": "#8E2B2B",
    "messing": "#C29A4B",
    "granit": "#7E7F80",
    "granit-dunkel": "#6A6B6C",
    "fliese": "#F1EEE8",
    "fliese-fuge": "#DCD6CC",
    "holz": "#B07A4A",
    "decke": "#EDE4D2",           # cream plank ceiling (video #E8D6BA, lifted: the warm light tints it; was #E9E6DF)
    "decke-raster": "#D2C4AC",    # plank joints
    "kruste-hell": "#E3B776",
    "korb": "#C9A063",
    "tuch-rosa": "#C0587E",       # raspberry pink basket cloth (video, white-referenced; was #E9A9B6)
    "lack-schwarz": "#2B2B2D",
    "glas": "#CFE6EA",
    "fassade": "#E6D6CB",         # rosy-beige render (video + Street View, white-referenced; was #E7DFD2)
    "sockel": "#A27468",          # plinth slips: muted pinkish red (round 4: tone-on-tone with sockel-grau/-hell)
    "lampe": "#FFE2BF",
    # shop interior, sampled from the walkthrough video (white-referenced, simplified; style.md "Palette")
    "champagner": "#D2C08E",      # rod tiers, rails, display trim (the shop's "brass" is a pale champagne)
    "granit-rosa": "#B4A9A4",     # counter ledge and work top (grey granite with a pink cast)
    "granit-rosa-dunkel": "#8A7F7A",
    "marmor": "#ECEBE6",          # counter base, display deck, white fixtures
    "thekenrot": "#A0222E",       # red band under the display glass
    "chrom": "#C6C8CA",
    "edelstahl": "#B8BCC0",
    "holz-dunkel": "#3A2A1E",     # café tables, chairs, jar shelf
    "holz-hell": "#C49A6C",       # work table, pretzel stand
    "kissen": "#504C53",
    "regal-weiss": "#F3F3F0",
    "putz-weiss": "#EEEAE2",      # white render: window piers, reveals, lintel
    "boden-fliese": "#E6D6C6",    # warm cream floor tiles ...
    "boden-fuge": "#BDB1A4",      # ... grey grout
    "sepia": "#A38D6E",           # neutral fill of the old photo frames (no faces)
    "bild-rot": "#792E35",        # coffee picture background
    "filz-gruen": "#9DB35E",      # window-sill felt
    "terrakotta": "#B5653F",
    "blatt": "#4F7A3A",
    "blume": "#E08A3A",           # garland flowers / sunflowers (simplified)
    "glow": "#FFD9A0",            # pendant lamp halo (blended)
    # facade (round 3b: street frames of the video + Street View, white-referenced, simplified; style.md "Facade")
    "sockel-hell": "#BCA890",     # buff slips in the plinth
    "sockel-grau": "#A68C86",     # grey-pink slips in the plinth
    "sockel-fuge": "#9C8C84",     # plinth joints
    "abdeckplatte": "#7E5A4C",    # plinth cap stone (= shop-window sill)
    "sandstein-rot": "#A0705F",   # window surrounds, quoins, pilaster, upper window frames
    "sandstein-hell": "#CBBBA6",
    "sandstein-relief": "#C99A88",  # the carved pretzel (lighter than the keystone, so it reads)
    "glasbaustein": "#C9D6C8",    # pale green glass blocks ...
    "glasbaustein-hell": "#DCE6DA",
    "glasbaustein-gruen": "#86B391",  # ... with a few green and blue accent blocks
    "glasbaustein-blau": "#93B1C9",
    "glas-fuge": "#D8D4CC",       # glass-block joints
    "fensterglas": "#56636C",     # upper-floor window glass (opaque, nothing behind it)
    "rollladen": "#C8CCCF",       # closed roller shutter ...
    "rollladen-fuge": "#A9AEB2",  # ... slat joints
    "fallrohr": "#3A3636",        # anthracite gutter and downpipes
    "verzinkt": "#9A9E9C",        # galvanised handrail
    "schiefer": "#6B7178",        # slate diamonds on the front roof ...
    "schiefer-fuge": "#50555B",   # ... and their joints
    "wandbild-grund": "#EDE5D5",  # gable mural ground (weathered cream)
    "ziegel": "#A5503A",          # oven-arch bricks in the mural / sign graphic
    "ofen": "#3A2A22",            # oven mouth
    "kruste": "#C68642",
    "kruste-dunkel": "#8A5228",
    "schrift": "#4A4644",         # shop lettering (only with the build flag --lettering)
    # context (orthophoto samples, simplified; style.md "Context")
    "dach": "#A0675A",
    "asphalt": "#8E8C8D",
    "gehweg": "#C8C2B8",
    "gelaende": "#9FAA80",
    "erde": "#8C7A66",
    "nachbar-1": "#E9E3D8",
    "nachbar-2": "#E2D6C2",
    "nachbar-3": "#D9D4CB",
    "schatten": "#4A4440",
    "nav": "#FF00FF",
}
GLASS_ALPHA = 0.3
GLOW_ALPHA = 0.28


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_linear(h: str) -> list[float]:
    h = h.lstrip("#")
    return [srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4)]


def materials() -> dict[str, dict]:
    out = {}
    for k, v in PALETTE.items():
        rgb = hex_linear(v)
        if k == "glas":
            out[k] = {"rgba": rgb + [GLASS_ALPHA], "blend": True, "double": True}
        elif k == "glow":
            out[k] = {"rgba": rgb + [GLOW_ALPHA], "blend": True, "double": False}
        else:
            out[k] = {"rgba": rgb + [1.0]}
    return out


def _tint(h: str) -> np.ndarray:
    c = np.array(hex_linear(h))
    return c / c.max()


SKY = _tint("#DDE6F0")
BOUNCE = _tint("#E8D8C4")
KEY = 0.55 * _tint("#FFE2BF") + 0.45  # warm, not orange


def _dir(heading_deg: float, elev_deg: float) -> np.ndarray:
    """Zone-frame unit vector towards a light at grid heading / elevation (x = E, y = up, z = −N)."""
    h, e = math.radians(heading_deg), math.radians(elev_deg)
    return np.array([math.sin(h) * math.cos(e), math.sin(e), -math.cos(h) * math.cos(e)])


GLOW = _tint("#FFD2A0")  # pendant lamps: warmer than the key


class Rig:
    """Soft Lambert: hemisphere fill + one directional key (+ optional fill) + optional warm point lights (pendant
    lamps, downward cone with a soft 1/(1 + (d/r0)²) falloff) + optional `day(p)` factor on the key (daylight
    through the shop windows fades with the distance from the facade)."""

    def __init__(self, key_dir: np.ndarray, ambient: float, key: float, fill_dir: np.ndarray | None = None, fill: float = 0.0,
                 lamps: list[tuple[np.ndarray, float, float]] | None = None, day: Callable[[np.ndarray], np.ndarray] | None = None):
        self.key_dir = key_dir / np.linalg.norm(key_dir)
        self.ambient, self.key = ambient, key
        self.fill_dir = None if fill_dir is None else fill_dir / np.linalg.norm(fill_dir)
        self.fill = fill
        self.lamps = list(lamps or [])      # (position (3,), strength, r0 in m)
        self.day = day

    def __call__(self, n: np.ndarray, p: np.ndarray) -> np.ndarray:
        n = np.asarray(n, np.float64).reshape(-1, 3)
        p = np.asarray(p, np.float64).reshape(-1, 3)
        t = (0.5 + 0.5 * n[:, 1])[:, None]
        hemi = BOUNCE * (1 - t) + SKY * t
        key = self.key * np.clip(n @ self.key_dir, 0, None)
        if self.day is not None:
            key = key * self.day(p)
        c = self.ambient * hemi + key[:, None] * KEY
        if self.fill_dir is not None:
            c = c + self.fill * np.clip(n @ self.fill_dir, 0, None)[:, None] * KEY
        for pos, k, r0 in self.lamps:
            v = np.asarray(pos, np.float64) - p
            d = np.linalg.norm(v, axis=1)
            ok = d > 1e-6
            l = np.where(ok[:, None], v / np.maximum(d, 1e-6)[:, None], 0.0)
            lam = np.clip(np.einsum("ij,ij->i", n, l), 0, None)
            cone = np.clip((-l[:, 1] - 0.15) / 0.55, 0, 1)        # light leaves the shade downwards
            c = c + (k * lam * cone / (1 + (d / r0) ** 2))[:, None] * GLOW
        return np.clip(c, 0, 1)


def exterior_rig() -> Rig:
    # afternoon sun from SSE (heading 160°, 48° up): lights the street facade (faces ESE) and the roofs
    return Rig(_dir(160, 48), ambient=0.68, key=0.42, fill_dir=_dir(250, 30), fill=0.08)


def interior_rig(window_heading_deg: float, lamps=None, day=None) -> Rig:
    # daylight through the shop windows (outward facade heading, fading into the room) + the ceiling light from above
    # + warm pools under the pendant lamps
    return Rig(_dir(window_heading_deg, 35), ambient=0.70, key=0.30, fill_dir=np.array([0.0, 1.0, 0.0]), fill=0.14,
               lamps=lamps, day=day)


def daylight_falloff(depth: np.ndarray, near: float = 1.0, far: float = 0.35, scale: float = 2.2) -> np.ndarray:
    """Key-light factor by distance from the window plane (m): `near` at the glass, easing to `far` deep inside."""
    d = np.clip(np.asarray(depth, np.float64), 0, None)
    return far + (near - far) * np.exp(-d / scale)


# ----------------------------------------------------------------------------------------------- vertex AO

class AO:
    """Soft vertex AO baked on top of the light (frame-B points, z above ±0.00), deterministic and analytic:

    * `slab(poly, z, k, reach)`: an overhang (shelf board, ledge, table top) darkens what lies below it inside its
      footprint, strongest right under it (k) and fading over `reach` metres downwards and 0.12 m past its edge;
    * `contact(poly, k, reach, z_max)`: a fixture standing on the floor darkens the floor around its footprint;
    * `corner(points, k, reach)`: concave room corners (vertical edges) darken walls and floor near them.
    """

    def __init__(self):
        self.slabs: list = []
        self.contacts: list = []
        self.corners: list = []

    def slab(self, poly, z: float, k: float = 0.35, reach: float = 0.6) -> None:
        self.slabs.append((poly, float(z), float(k), float(reach)))

    def contact(self, poly, k: float = 0.35, reach: float = 0.3, z_max: float = 0.03) -> None:
        self.contacts.append((poly, float(k), float(reach), float(z_max)))

    def corner(self, pts, k: float = 0.15, reach: float = 0.45) -> None:
        self.corners.append((np.asarray(pts, np.float64).reshape(-1, 2), float(k), float(reach)))

    def __call__(self, pb: np.ndarray) -> np.ndarray:
        import shapely
        pb = np.asarray(pb, np.float64).reshape(-1, 3)
        out = np.ones(len(pb))
        if not len(pb):
            return out
        P = shapely.points(pb[:, :2])
        for poly, z, k, reach in self.slabs:
            below = (pb[:, 2] < z - 0.004) & (pb[:, 2] > z - reach - 0.05)
            if not below.any():
                continue
            idx = np.nonzero(below)[0]
            dist = shapely.distance(P[idx], poly)          # 0 inside
            inside = 1 - _smooth(0.0, 0.12, dist)
            gap = z - pb[idx, 2]
            out[idx] *= 1 - k * inside * (1 - _smooth(0.0, reach, gap))
        for poly, k, reach, z_max in self.contacts:
            low = pb[:, 2] < z_max
            if not low.any():
                continue
            idx = np.nonzero(low)[0]
            dist = shapely.distance(P[idx], poly)
            out[idx] *= 1 - k * (1 - _smooth(0.0, reach, dist))
        for pts, k, reach in self.corners:
            d = np.min(np.linalg.norm(pb[:, None, :2] - pts[None, :, :], axis=2), axis=1)
            out *= 1 - k * (1 - _smooth(0.0, reach, d))
        return out


def _smooth(e0: float, e1: float, x) -> np.ndarray:
    t = np.clip((np.asarray(x, np.float64) - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def flat_rig() -> Rig:
    return Rig(np.array([0.0, 1.0, 0.0]), ambient=1.0, key=0.0)
