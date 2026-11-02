"""Display colouring for previews and Leaflet XYZ overlays (not used for the app's data layers)."""
from __future__ import annotations

import numpy as np
from matplotlib import colormaps

# Display stretches for colourised overlays. SLRM uses a symmetric stretch chosen in build.py.
CMAPS = {"slrm": "RdBu_r", "chm": "YlGn"}


def gray_rgba(x: np.ndarray, vmin: float = 0.0, vmax: float = 1.0) -> np.ndarray:
    """Float array → RGBA8 grayscale, alpha 0 where NaN."""
    v = np.clip((x - vmin) / (vmax - vmin), 0, 1)
    g = np.rint(np.nan_to_num(v) * 255).astype(np.uint8)
    a = np.where(np.isfinite(x), 255, 0).astype(np.uint8)
    return np.dstack([g, g, g, a])


def cmap_rgba(x: np.ndarray, cmap: str, vmin: float, vmax: float) -> np.ndarray:
    v = np.clip((x - vmin) / (vmax - vmin), 0, 1)
    rgba = colormaps[cmap](np.nan_to_num(v), bytes=True)
    rgba[..., 3] = np.where(np.isfinite(x), 255, 0)
    return rgba


def downsample_mean(x: np.ndarray, f: int) -> np.ndarray:
    h, w = (x.shape[0] // f) * f, (x.shape[1] // f) * f
    return x[:h, :w].reshape(h // f, f, w // f, f).mean(axis=(1, 3))
