"""S2 global grid `sle-grid-25832-v1` and the presence bitmap (docs/data-contract.md "Many places (v3, S2)").

Pure helpers shared by build.py (v3 place builds), catalog.py, overview.py and the per-tile filters of the other
steps. Everything here is unit-tested in tests/test_grid.py (contract test vectors).

- Tiles are 1 km squares named "{E_km}_{N_km}" after their south-west corner (= LVGL / GeoBasis RLP file names).
- Level-k chunks are S_k = 500 · 2^k m squares; global address (k, I, J) counts I east and J south from the grid's
  north-west corner (300 000, 5 656 000). Paths keep (i, j) relative to a rectangle's NW corner.
- A presence bitmap {w, h, bits, count}: row-major, row 0 = north, LSB-first, RFC 4648 base64 with padding.
"""
from __future__ import annotations

import base64
from collections.abc import Iterable, Mapping
from typing import Any

GRID_ID = "sle-grid-25832-v1"
GRID_E = 300_000            # Eg, south-west corner
GRID_N = 5_400_000          # Ng
EXTENT_M = 256_000          # Wg = Hg
GRID_N_TOP = GRID_N + EXTENT_M   # 5 656 000
TILE_M = 1000
CHUNK_M = 500
MAX_LEVEL = 9

GRID: dict[str, Any] = {"id": GRID_ID, "origin": {"E": GRID_E, "N": GRID_N}, "extent_m": EXTENT_M,
                        "tile_m": TILE_M, "chunk_m": CHUNK_M}

# Contract rule 5 (v3): fixed u8 value ranges, identical in every place.
FIXED_RANGES: dict[str, tuple[float, float]] = {
    "svf": (0.6, 1.0), "opns_pos": (60.0, 95.0), "opns_neg": (60.0, 95.0), "chm": (0.0, 40.0),
    "mask": (0.0, 1.0), "bldg": (0.0, 1.0), "vat": (0.0, 1.0),
}

Tile = tuple[int, int]   # (E_km, N_km) of the south-west corner


# ------------------------------------------------------------------------------------------------ tiles
def tile_id(t: Tile) -> str:
    return f"{t[0]}_{t[1]}"


def parse_tile_id(s: str) -> Tile:
    e, n = s.split("_")
    t = (int(e), int(n))
    if tile_id(t) != s:
        raise ValueError(f"not a canonical tile id: {s!r}")
    return t


def valid_tile(t: Tile) -> bool:
    return GRID_E // TILE_M <= t[0] < (GRID_E + EXTENT_M) // TILE_M and \
        GRID_N // TILE_M <= t[1] < (GRID_N + EXTENT_M) // TILE_M


def tile_of_point(e: float, n: float) -> Tile:
    """Tile containing the point (half-open squares [E, E + 1000) × [N, N + 1000))."""
    return int(e // TILE_M), int(n // TILE_M)


def neighbours8(tiles: Iterable[Tile]) -> set[Tile]:
    """The tiles plus all their 8-neighbours (the relief buffer fetch set for 100 m ≤ buffer_m ≤ 1000 m)."""
    out: set[Tile] = set()
    for e, n in tiles:
        for de in (-1, 0, 1):
            for dn in (-1, 0, 1):
                out.add((e + de, n + dn))
    return out


def tiles_bbox(tiles: Iterable[Tile]) -> tuple[int, int, int, int]:
    """[Emin, Nmin, Emax, Nmax] in metres of a tile set (multiples of 1000)."""
    ts = list(tiles)
    if not ts:
        raise ValueError("empty tile set")
    return (min(t[0] for t in ts) * TILE_M, min(t[1] for t in ts) * TILE_M,
            (max(t[0] for t in ts) + 1) * TILE_M, (max(t[1] for t in ts) + 1) * TILE_M)


# ------------------------------------------------------------------------------------------------ chunks
def chunk_side(k: int) -> int:
    """S_k = 500 · 2^k metres."""
    if not 0 <= k <= MAX_LEVEL:
        raise ValueError(f"level {k} outside 0…{MAX_LEVEL}")
    return CHUNK_M << k


def is_aligned(e0: int, n0: int, w: int, h: int, g: int) -> bool:
    """Rectangle [e0, n0, e0 + w, n0 + h] aligned at g metres (contract "Aligned rectangle")."""
    return (e0 - GRID_E) % g == 0 and (n0 - GRID_N) % g == 0 and w % g == 0 and h % g == 0 and w > 0 and h > 0


def global_address(k: int, i: int, j: int, e0: int, n0: int, h_m: int) -> tuple[int, int]:
    """(I, J) of chunk (i, j) of a rectangle with SW corner (e0, n0) and height h_m metres."""
    s = chunk_side(k)
    di, ri = divmod(e0 - GRID_E, s)
    dj, rj = divmod(GRID_N_TOP - (n0 + h_m), s)
    if ri or rj:
        raise ValueError(f"rectangle not aligned at level {k} ({s} m)")
    return i + di, j + dj


def local_index(k: int, I: int, J: int, e0: int, n0: int, h_m: int) -> tuple[int, int]:
    """Inverse of global_address."""
    s = chunk_side(k)
    return I - (e0 - GRID_E) // s, J - (GRID_N_TOP - (n0 + h_m)) // s


def chunk_bounds(k: int, I: int, J: int) -> tuple[int, int, int, int]:
    """[Ew, Ns, Ee, Nn] of global chunk (k, I, J)."""
    s = chunk_side(k)
    ew, nn = GRID_E + I * s, GRID_N_TOP - J * s
    return ew, nn - s, ew + s, nn


def tile_chunks(t: Tile, e0: int, n1: int) -> list[tuple[int, int]]:
    """The four level-0 chunk indices (i, j) of tile t in a rectangle with west edge e0 and north edge n1."""
    i0 = (t[0] * TILE_M - e0) // CHUNK_M
    j0 = (n1 - (t[1] + 1) * TILE_M) // CHUNK_M
    return [(i0 + di, j0 + dj) for dj in (0, 1) for di in (0, 1)]


def tile_cell(t: Tile, e0: int, n1: int) -> tuple[int, int]:
    """(col, row) of tile t in the 1 km tile raster of a rectangle (= level-1 chunk index)."""
    return (t[0] * TILE_M - e0) // TILE_M, (n1 - (t[1] + 1) * TILE_M) // TILE_M


# ------------------------------------------------------------------------------------------------ bitmap
def encode_bitmap(w: int, h: int, cells: Iterable[tuple[int, int]]) -> dict[str, Any]:
    """Presence bitmap of the set cells (col, row); row 0 = north. Raises on cells outside w × h."""
    if w <= 0 or h <= 0:
        raise ValueError("bitmap needs w, h > 0")
    buf = bytearray((w * h + 7) // 8)
    count = 0
    for col, row in set(cells):
        if not (0 <= col < w and 0 <= row < h):
            raise ValueError(f"cell ({col}, {row}) outside {w}×{h}")
        b = row * w + col
        buf[b >> 3] |= 1 << (b & 7)
        count += 1
    return {"w": w, "h": h, "bits": base64.b64encode(bytes(buf)).decode("ascii"), "count": count}


def decode_bitmap(bm: Mapping[str, Any]) -> set[tuple[int, int]]:
    """Set cells (col, row) of a bitmap. Raises ValueError on any contract violation (size, base64, trailing bits,
    count mismatch)."""
    w, h = bm.get("w"), bm.get("h")
    if not isinstance(w, int) or not isinstance(h, int) or w <= 0 or h <= 0:
        raise ValueError("bitmap: w/h")
    try:
        raw = base64.b64decode(str(bm.get("bits", "")), validate=True)
    except (ValueError, TypeError) as e:
        raise ValueError(f"bitmap: bad base64 ({e})") from None
    if len(raw) != (w * h + 7) // 8:
        raise ValueError(f"bitmap: {len(raw)} bytes, expected {(w * h + 7) // 8}")
    out = set()
    for b in range(len(raw) * 8):
        if (raw[b >> 3] >> (b & 7)) & 1:
            if b >= w * h:
                raise ValueError("bitmap: trailing bits set")
            out.add((b % w, b // w))
    if bm.get("count") != len(out):
        raise ValueError(f"bitmap: count {bm.get('count')} ≠ {len(out)} set bits")
    return out


def presence_bitmap(e0: int, n0: int, w_m: int, h_m: int, tiles: Iterable[Tile]) -> dict[str, Any]:
    """Manifest `presence` of a 1 km aligned rectangle: one bit per tile (row 0 = north)."""
    if not is_aligned(e0, n0, w_m, h_m, TILE_M):
        raise ValueError("rectangle not aligned at 1 km")
    n1 = n0 + h_m
    return encode_bitmap(w_m // TILE_M, h_m // TILE_M, (tile_cell(t, e0, n1) for t in tiles))


def presence_tiles(presence: Mapping[str, Any], e0: int, n1: int) -> set[Tile]:
    """Tiles (E_km, N_km) set in a rectangle's presence bitmap (inverse of presence_bitmap)."""
    return {(e0 // TILE_M + c, n1 // TILE_M - r - 1) for c, r in decode_bitmap(presence)}
