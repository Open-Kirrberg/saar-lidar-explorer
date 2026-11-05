"""Palette (docs/style.md) and the baked light rigs.

Unlit rendering: final colour = palette colour (baseColorFactor, linear) × COLOR_0 (baked light, linear). The bake
is a soft Lambert from one warm key light plus a hemisphere fill (cool sky above, warm bounce below), as style.md
asks: daytime, open shop, lifted shadows, no specular. Interior faces use a rig whose key light comes in through the
shop windows and from the ceiling lamps; exterior faces a high afternoon sun from the south-south-east.
"""
from __future__ import annotations

import math

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
    "decke": "#E9E6DF",
    "decke-raster": "#CFCAC0",
    "kruste-hell": "#E3B776",
    "korb": "#C9A063",
    "tuch-rosa": "#E9A9B6",
    "lack-schwarz": "#2B2B2D",
    "glas": "#CFE6EA",
    "fassade": "#E7DFD2",
    "sockel": "#8C5A4A",
    "lampe": "#FFE2BF",
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


class Rig:
    def __init__(self, key_dir: np.ndarray, ambient: float, key: float, fill_dir: np.ndarray | None = None, fill: float = 0.0):
        self.key_dir = key_dir / np.linalg.norm(key_dir)
        self.ambient, self.key = ambient, key
        self.fill_dir = None if fill_dir is None else fill_dir / np.linalg.norm(fill_dir)
        self.fill = fill

    def __call__(self, n: np.ndarray, p: np.ndarray) -> np.ndarray:
        n = np.asarray(n, np.float64).reshape(-1, 3)
        t = (0.5 + 0.5 * n[:, 1])[:, None]
        hemi = BOUNCE * (1 - t) + SKY * t
        c = self.ambient * hemi + self.key * np.clip(n @ self.key_dir, 0, None)[:, None] * KEY
        if self.fill_dir is not None:
            c = c + self.fill * np.clip(n @ self.fill_dir, 0, None)[:, None] * KEY
        return np.clip(c, 0, 1)


def exterior_rig() -> Rig:
    # afternoon sun from SSE (heading 160°, 48° up): lights the street facade (faces ESE) and the roofs
    return Rig(_dir(160, 48), ambient=0.68, key=0.42, fill_dir=_dir(250, 30), fill=0.08)


def interior_rig(window_heading_deg: float) -> Rig:
    # daylight through the shop windows (outward facade heading) + the pendant lamps from above
    return Rig(_dir(window_heading_deg, 35), ambient=0.74, key=0.22, fill_dir=np.array([0.0, 1.0, 0.0]), fill=0.14)


def flat_rig() -> Rig:
    return Rig(np.array([0.0, 1.0, 0.0]), ambient=1.0, key=0.0)
