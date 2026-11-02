"""F9: overview levels (contract v2 "Levels") — block-mean pyramid of the 1 m DTM + VAT/hillshade.

Called from build.py (`write_levels`); the pure helpers are unit-tested in tests/test_levels.py.

Level k (k ≥ 1) has cellSize 2^k m, raster size ceil(size₀ / 2^k), chunks ceil(size_k / 500), and is anchored
at the AOI's north-west corner like level 0. Each level-k cell is the mean of its 2^k × 2^k block of 1 m cells;
partial blocks at the east/south edge are padded by edge clamp (numpy.pad mode="edge"). Every chunk image has
the full 502² (heights, 1-cell apron) / 500² (layers) size; cells beyond the level raster are edge-clamped.
"""
from __future__ import annotations

import math
import shutil
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from encode import height_chunk, terrarium_encode, u8_encode

N_LEVELS = 4                       # coarse levels 1 … 4 (2, 4, 8, 16 m)
LEVEL_LAYERS = ("vat", "hillshade")  # contract: coarse levels carry only these


def level_size(size0: int, k: int) -> int:
    """Cells of the level-k raster along one axis: ceil(size₀ / 2^k)."""
    return -(-size0 // (1 << k))


def level_grid(width0: int, height0: int, k: int, chunk: int = 500) -> dict[str, Any]:
    """cellSize, size and chunk counts of level k (matches app `levelGrid`)."""
    w, h = level_size(width0, k), level_size(height0, k)
    return {"cellSize": 1 << k, "size": {"width": w, "height": h},
            "chunks": {"nx": math.ceil(w / chunk), "ny": math.ceil(h / chunk)}}


def block_mean(a: np.ndarray, f: int) -> np.ndarray:
    """Mean of f × f blocks (float64); partial blocks at the east/south edge are edge-clamp padded."""
    a = np.asarray(a, dtype=np.float64)
    if f == 1:
        return a.copy()
    rows, cols = a.shape
    pr, pc = (-rows) % f, (-cols) % f
    if pr or pc:
        a = np.pad(a, ((0, pr), (0, pc)), mode="edge")
    R, C = a.shape
    return a.reshape(R // f, f, C // f, f).mean(axis=(1, 3))


def cell_centre(e0: float, n_top: float, c: int, r: int, cell_size: float) -> tuple[float, float]:
    """EPSG:25832 centre of level cell (c, r); n_top = N0 + AOI height."""
    return e0 + (c + 0.5) * cell_size, n_top - (r + 0.5) * cell_size


def layer_chunk_clamped(arr: np.ndarray, i: int, j: int, cs: int = 500) -> np.ndarray:
    """Full cs × cs window of chunk (i, j); cells beyond the raster are edge-clamped."""
    return height_chunk(arr, i, j, cs, apron=0)


def _save_png(path: Path, arr: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr).save(path, compress_level=9)


def write_levels(out: Path, dtm: np.ndarray, layer_arrays: dict[str, np.ndarray], top_layers: dict[str, dict],
                 n_levels: int = N_LEVELS, cs: int = 500) -> list[dict[str, Any]]:
    """Write `out/levels/{k}/…` chunk PNGs for k = 1 … n_levels and return the coarse level entries
    (without level 0). `dtm` is the filled 1 m AOI DTM, `layer_arrays` the unquantised 1 m layers,
    `top_layers` the manifest's top-level layer entries (min/max/label/unit are copied)."""
    shutil.rmtree(out / "levels", ignore_errors=True)
    rows, cols = dtm.shape
    entries = []
    for k in range(1, n_levels + 1):
        f = 1 << k
        g = level_grid(cols, rows, k, cs)
        d = block_mean(dtm, f)
        assert d.shape == (g["size"]["height"], g["size"]["width"])
        nx, ny = g["chunks"]["nx"], g["chunks"]["ny"]
        base = out / "levels" / str(k)
        lays = {}
        for key in LEVEL_LAYERS:
            if key not in layer_arrays or key not in top_layers:
                continue
            L = top_layers[key]
            a = block_mean(layer_arrays[key], f)
            for j in range(ny):
                for i in range(nx):
                    _save_png(base / key / f"{i}_{j}.png", u8_encode(layer_chunk_clamped(a, i, j, cs), L["min"], L["max"]))
            entry = {kk: vv for kk, vv in L.items() if kk != "path"}
            lays[key] = {"path": f"levels/{k}/{key}/{{i}}_{{j}}.png", **entry}
        for j in range(ny):
            for i in range(nx):
                _save_png(base / "dtm" / f"{i}_{j}.png", terrarium_encode(height_chunk(d, i, j, cs)))
        entries.append({"level": k, "cellSize": g["cellSize"], "chunkSize": cs, "size": g["size"], "chunks": g["chunks"],
                        "height": {"dtm": {"path": f"levels/{k}/dtm/{{i}}_{{j}}.png", "encoding": "terrarium",
                                           "apron": 1}},
                        "layers": lays})
    return entries


def level0_entry(manifest: dict[str, Any]) -> dict[str, Any]:
    """Informative level-0 entry repeating the top-level grid, height and layers (same paths)."""
    return {"level": 0, "cellSize": manifest["cellSize"], "chunkSize": manifest["chunkSize"],
            "size": manifest["size"], "chunks": manifest["chunks"], "height": manifest["height"],
            "layers": manifest["layers"]}
