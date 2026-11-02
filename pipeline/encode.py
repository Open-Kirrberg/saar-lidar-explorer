"""Encodings + chunk cutting from docs/data-contract.md (shared by build.py and tests)."""
from __future__ import annotations

import numpy as np

TERRARIUM_OFFSET = 32768.0


def terrarium_encode(h: np.ndarray) -> np.ndarray:
    """Heights (m) → RGB8, h = (R·256 + G + B/256) − 32768. Rounded to nearest 1/256 m (≤ 2 mm error)."""
    if not np.isfinite(h).all():
        raise ValueError("terrarium_encode: heights must be filled (no NaN)")
    q = np.rint((h.astype(np.float64) + TERRARIUM_OFFSET) * 256.0).astype(np.int64)
    q = np.clip(q, 0, (1 << 24) - 1)
    rgb = np.empty(h.shape + (3,), np.uint8)
    rgb[..., 0] = (q >> 16) & 255
    rgb[..., 1] = (q >> 8) & 255
    rgb[..., 2] = q & 255
    return rgb


def terrarium_decode(rgb: np.ndarray) -> np.ndarray:
    rgb = rgb.astype(np.float64)
    return rgb[..., 0] * 256.0 + rgb[..., 1] + rgb[..., 2] / 256.0 - TERRARIUM_OFFSET


def u8_encode(x: np.ndarray, vmin: float, vmax: float) -> np.ndarray:
    """value = min + (v/255)·(max − min); values outside [min,max] are clipped; NaN → 0."""
    v = (np.nan_to_num(x, nan=vmin) - vmin) / (vmax - vmin)
    return np.rint(np.clip(v, 0.0, 1.0) * 255.0).astype(np.uint8)


def u8_decode(v: np.ndarray, vmin: float, vmax: float) -> np.ndarray:
    return vmin + v.astype(np.float64) / 255.0 * (vmax - vmin)


def height_chunk(aoi_arr: np.ndarray, i: int, j: int, cs: int = 500, apron: int = 1) -> np.ndarray:
    """(cs+2·apron)² window; pixel (px,py) ↔ AOI cell (i·cs − apron + px, j·cs − apron + py), edge-clamped."""
    rows, cols = aoi_arr.shape
    r = np.clip(np.arange(j * cs - apron, j * cs + cs + apron), 0, rows - 1)
    c = np.clip(np.arange(i * cs - apron, i * cs + cs + apron), 0, cols - 1)
    return aoi_arr[np.ix_(r, c)]


def layer_chunk(aoi_arr: np.ndarray, i: int, j: int, cs: int = 500) -> np.ndarray:
    return aoi_arr[j * cs:(j + 1) * cs, i * cs:(i + 1) * cs]
