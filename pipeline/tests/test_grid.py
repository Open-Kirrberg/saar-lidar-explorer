"""Global grid + presence bitmap (contract "Many places (v3, S2)": Global grid, Presence bitmap)."""
import base64
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import grid as G  # noqa: E402


def test_contract_bitmap_example():
    # w = 3, h = 2, cells (0,0), (2,0), (1,1) → bits 0, 2, 4 → byte 0x15 → "FQ=="
    bm = G.encode_bitmap(3, 2, [(0, 0), (2, 0), (1, 1)])
    assert bm == {"w": 3, "h": 2, "bits": "FQ==", "count": 3}
    assert G.decode_bitmap(bm) == {(0, 0), (2, 0), (1, 1)}


def test_bitmap_roundtrip_and_size():
    cells = {(c, r) for r in range(18) for c in range(22) if (c * 7 + r * 3) % 5}
    bm = G.encode_bitmap(22, 18, cells)
    assert len(base64.b64decode(bm["bits"])) == 50     # contract: Saarbrücken 22 × 18 = 50 bytes
    assert len(bm["bits"]) == 68
    assert G.decode_bitmap(bm) == cells


@pytest.mark.parametrize("bad", [
    {"w": 3, "h": 2, "bits": "FQ==", "count": 2},          # count mismatch
    {"w": 3, "h": 2, "bits": "FQ", "count": 3},            # missing padding
    {"w": 3, "h": 2, "bits": "FRU=", "count": 3},          # wrong length
    {"w": 3, "h": 2, "bits": "/w==", "count": 8},          # trailing bits set
    {"w": 0, "h": 2, "bits": "", "count": 0},
    {"w": 3, "h": 2, "bits": "F!==", "count": 3},
])
def test_bitmap_invalid(bad):
    with pytest.raises(ValueError):
        G.decode_bitmap(bad)


def test_encode_rejects_outside():
    with pytest.raises(ValueError):
        G.encode_bitmap(2, 2, [(2, 0)])


def test_tile_ids():
    assert G.tile_id((382, 5466)) == "382_5466"
    assert G.parse_tile_id("382_5466") == (382, 5466)
    with pytest.raises(ValueError):
        G.parse_tile_id("382_05466")
    assert G.valid_tile((300, 5400)) and G.valid_tile((555, 5655))
    assert not G.valid_tile((299, 5466)) and not G.valid_tile((556, 5466)) and not G.valid_tile((382, 5656))
    assert G.tile_of_point(382999.9, 5466000.0) == (382, 5466)


def test_alignment_existing_aois():
    assert G.is_aligned(381000, 5465000, 3000, 3000, 1000)       # karlsberg
    assert G.is_aligned(374000, 5456000, 11000, 16000, 1000)     # homburg-gemeinde
    assert not G.is_aligned(380000, 5460000, 3000, 3500, 1000)   # kirrberg (500 m north edge)
    assert G.is_aligned(380000, 5460000, 3000, 3500, 500)


def test_global_address_roundtrip():
    # karlsberg rectangle 381000–384000 × 5465000–5468000: level-0 chunk (0,0) has west edge 381000, north 5468000
    e0, n0, h = 381000, 5465000, 3000
    I, J = G.global_address(0, 0, 0, e0, n0, h)
    assert (I, J) == ((381000 - 300000) // 500, (5656000 - 5468000) // 500)
    assert G.chunk_bounds(0, I, J) == (381000, 5467500, 381500, 5468000)
    assert G.local_index(0, I, J, e0, n0, h) == (0, 0)
    I1, J1 = G.global_address(1, 2, 1, e0, n0, h)
    assert G.chunk_bounds(1, I1, J1) == (383000, 5466000, 384000, 5467000)
    with pytest.raises(ValueError):
        G.global_address(1, 0, 0, 380000, 5460000, 3500)          # kirrberg: level 1 not aligned
    # alignment from the south equals alignment from the north for every level ≤ 9
    for k in range(10):
        assert G.EXTENT_M % G.chunk_side(k) == 0


def test_tile_chunks_and_presence():
    e0, n0, w, h = 374000, 5456000, 3000, 2000
    n1 = n0 + h
    assert G.tile_chunks((374, 5457), e0, n1) == [(0, 0), (1, 0), (0, 1), (1, 1)]
    assert G.tile_chunks((376, 5456), e0, n1) == [(4, 2), (5, 2), (4, 3), (5, 3)]
    tiles = {(374, 5457), (376, 5456)}
    p = G.presence_bitmap(e0, n0, w, h, tiles)
    assert (p["w"], p["h"], p["count"]) == (3, 2, 2)
    assert G.decode_bitmap(p) == {(0, 0), (2, 1)}
    assert G.presence_tiles(p, e0, n1) == tiles


def test_neighbours_and_bbox():
    assert len(G.neighbours8([(380, 5460)])) == 9
    assert len(G.neighbours8([(380, 5460), (381, 5460)])) == 12
    assert G.tiles_bbox([(380, 5460), (382, 5461)]) == (380000, 5460000, 383000, 5462000)
