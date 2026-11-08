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


# ----------------------------------------------------------------------------- v3 slim formats (contract "Slim formats")
AVIF_U8_QUALITY = 90          # visual u8 layers (svf, opns_*, level vat), S0
AVIF_RGB_QUALITY = 65         # ortho, historic maps (D6)
AVIF_U8_BUDGET = (1.5, 16)    # mean |Δ|, max |Δ| in u8 levels, checked on every file
WEBP_LOSSLESS = {"lossless": True, "quality": 80, "method": 6, "exact": True}   # q = effort; q100 is 5× slower for −1 %


def _write_bytes(path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


def webp_lossless_bytes(arr: np.ndarray) -> bytes:
    """VP8L, RGB without alpha (u8 2-D → R = G = B), exact; asserts a bit-exact decode of every channel."""
    import io
    from PIL import Image
    a = np.ascontiguousarray(arr, dtype=np.uint8)
    rgb = np.repeat(a[..., None], 3, axis=2) if a.ndim == 2 else a
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        raise ValueError(f"webp lossless: expected H×W or H×W×3 uint8, got {a.shape}")
    buf = io.BytesIO()
    Image.fromarray(rgb, "RGB").save(buf, "WEBP", **WEBP_LOSSLESS)
    data = buf.getvalue()
    back = np.asarray(Image.open(io.BytesIO(data)).convert("RGB"))
    if back.shape != rgb.shape or not np.array_equal(back, rgb):
        raise AssertionError("webp lossless round trip is not bit-exact")
    return data


def save_webp_lossless(path, arr: np.ndarray) -> int:
    data = webp_lossless_bytes(arr)
    _write_bytes(path, data)
    return len(data)


def avif_u8_bytes(arr: np.ndarray, quality: int = AVIF_U8_QUALITY) -> tuple[bytes, dict]:
    """Monochrome (4:0:0) 8-bit full-range AVIF without ICC profile; checks the error budget against `arr` and
    retries at a higher quality if a file would exceed it (logged in the returned stats)."""
    import io
    from PIL import Image
    a = np.ascontiguousarray(arr, dtype=np.uint8)
    if a.ndim != 2:
        raise ValueError("avif u8: expected a 2-D uint8 array")
    for q in (quality, 95, 100):
        buf = io.BytesIO()
        Image.fromarray(a, "L").save(buf, "AVIF", quality=q, subsampling="4:0:0", range="full")
        data = buf.getvalue()
        d = np.abs(np.asarray(Image.open(io.BytesIO(data)).convert("L")).astype(np.int16) - a)
        mean, mx = float(d.mean()), int(d.max())
        if mean <= AVIF_U8_BUDGET[0] and mx <= AVIF_U8_BUDGET[1]:
            return data, {"quality": q, "mean_err": round(mean, 3), "max_err": mx}
    raise AssertionError(f"avif u8 over budget even at q100 (mean {mean:.2f}, max {mx})")


def save_avif_u8(path, arr: np.ndarray, quality: int = AVIF_U8_QUALITY) -> dict:
    data, st = avif_u8_bytes(arr, quality)
    _write_bytes(path, data)
    return {**st, "bytes": len(data)}


def avif_rgb_bytes(rgb: np.ndarray, quality: int = AVIF_RGB_QUALITY) -> bytes:
    """Colour picture (ortho, historic map): 8-bit 4:2:0 AVIF, no ICC profile."""
    import io
    from PIL import Image
    buf = io.BytesIO()
    Image.fromarray(np.ascontiguousarray(rgb, dtype=np.uint8), "RGB").save(buf, "AVIF", quality=quality,
                                                                           subsampling="4:2:0")
    return buf.getvalue()


def save_avif_rgb(path, rgb: np.ndarray, quality: int = AVIF_RGB_QUALITY) -> int:
    data = avif_rgb_bytes(rgb, quality)
    _write_bytes(path, data)
    return len(data)
