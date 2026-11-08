"""S2 central overview levels `sle-overview-v1` (contract "Many places (v3, S2)": Central overview levels).

    uv run python overview.py [--out DIR] [--kmax 6] [--tiles E_N,…]

Levels 2 … K of the catalog area (the union of all owned tiles, data/work/catalog/tile_owners.json, or `--tiles`)
anchored at the global grid: bbox aligned at S_K, level-k cell = mean of its 2^k × 2^k block of the NoData-filled
1 m DTM (same sources and per-tile fill as the v3 place builds: tile ± buffer window, SL first, RLP + fixed offset,
nearest fill), heights quantised to `quant_m` before terrarium, WebP lossless, apron from real data (edge clamp only
at the bbox edge). A chunk is present iff it intersects an owned tile. `coverage` = the 1 km tiles of the bbox with
≥ 1 cell of real source data (after the `h-plausible-v1` rule); cells of the other tiles (France, RLP tiles not in
the raw cache) carry filler heights (push-pull: NaN-ignoring 2 × 2 means down, bilinear back up), which the app must
not show (contract: "Overview no-data"). `heightRange` = min/max of the 1 m DTM over the owned tiles; the catalog's
`height_ref_m` = floor(min).

Output: <DIR>/overview.json + <DIR>/levels/{k}/dtm/{i}_{j}.webp (default app/public/data/orte-katalog/overview).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import shutil
import time
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import numpy as np

from common import ATTRIBUTION_RLP, ATTRIBUTION_SL, PIPELINE_VERSION
from grid import GRID, GRID_E, GRID_N, TILE_M, Tile, chunk_side, encode_bitmap, tiles_bbox

QUANT_M = 0.05
K_MIN = 2
BUFFER_M = 200


def aligned_bbox(tiles: Iterable[Tile], k: int) -> tuple[int, int, int, int]:
    """Bounding box of the tiles, snapped outward to the level-k chunk grid (S_k). Pure."""
    s = chunk_side(k)
    e0, n0, e1, n1 = tiles_bbox(tiles)
    return (GRID_E + (e0 - GRID_E) // s * s, GRID_N + (n0 - GRID_N) // s * s,
            GRID_E + -(-(e1 - GRID_E) // s) * s, GRID_N + -(-(n1 - GRID_N) // s) * s)


def level_presence(bbox: tuple[int, int, int, int], k: int, tiles: set[Tile]) -> dict[str, Any]:
    """Level-k presence bitmap over bbox: a chunk is set iff it intersects ≥ 1 of the tiles. Pure."""
    s = chunk_side(k)
    nx, ny = (bbox[2] - bbox[0]) // s, (bbox[3] - bbox[1]) // s
    cells = set()
    for e, n in tiles:
        # a 1 km tile lies in exactly one chunk for k ≥ 1 (S_k is a multiple of 1000)
        i = (e * TILE_M - bbox[0]) // s
        j = (bbox[3] - (n + 1) * TILE_M) // s
        if 0 <= i < nx and 0 <= j < ny:
            cells.add((i, j))
    return encode_bitmap(nx, ny, cells)


def coverage_bitmap(bbox: tuple[int, int, int, int], tiles: Iterable[Tile]) -> dict[str, Any]:
    """`coverage`: 1 km tiles of the bbox (w = width / 1000, h = height / 1000, row 0 = north) with real source data.
    Tiles outside the bbox are ignored. Pure."""
    w, h = (bbox[2] - bbox[0]) // TILE_M, (bbox[3] - bbox[1]) // TILE_M
    e0, n_top = bbox[0] // TILE_M, bbox[3] // TILE_M
    cells = {(e - e0, n_top - 1 - n) for e, n in tiles}
    return encode_bitmap(w, h, {(c, r) for c, r in cells if 0 <= c < w and 0 <= r < h})


def quantise(h: np.ndarray, q: float = QUANT_M) -> np.ndarray:
    return np.round(h / q) * q


def _near(paths: dict, tile: Tile) -> dict:
    return {t: p for t, p in paths.items() if abs(t[0] - tile[0]) <= 1 and abs(t[1] - tile[1]) <= 1}


def tile_level2(job: tuple) -> tuple:
    """250 × 250 level-2 block means of one tile's filled 1 m DTM (+ its 1 m min/max), None without data.
    job = (tile, SL paths of its 3 × 3 neighbourhood, RLP paths, buffer)."""
    import build as B
    tile, sl, rl, b = job
    wbox = B.tile_window(tile, b)
    if not sl and not rl:
        return tile, None, math.nan, math.nan
    a_sl = B.read_mosaic(sl, wbox)[0] if sl else None
    a_rl = B.read_mosaic(rl, wbox)[0] if rl else None
    if a_sl is None:
        a_sl = np.full_like(a_rl, np.nan)
    if a_rl is None:
        a_rl = np.full_like(a_sl, np.nan)
    try:
        dtm, mask = B.fill_heights(a_sl, a_rl, B.RLP_OFFSET_V3_M)
    except ValueError:
        return tile, None, math.nan, math.nan
    core = dtm[b:b + 1000, b:b + 1000].astype(np.float64)
    if not (mask[b:b + 1000, b:b + 1000] < 1).any():
        return tile, None, math.nan, math.nan   # only fill from the neighbours: no data (not in `coverage`)
    return tile, core.reshape(250, 4, 250, 4).mean(axis=(1, 3)), float(core.min()), float(core.max())


def upsample2(c: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    """Bilinear 2× upsampling with cell-centre alignment (fine cells 2i, 2i + 1 lie at coarse i ∓ 0.25: weights
    0.75 / 0.25, edge clamp), cropped to `shape`. Pure."""
    def axis0(x: np.ndarray) -> np.ndarray:
        prev = np.concatenate([x[:1], x[:-1]], axis=0)
        nxt = np.concatenate([x[1:], x[-1:]], axis=0)
        out = np.empty((2 * x.shape[0],) + x.shape[1:], x.dtype)
        out[0::2] = 0.75 * x + 0.25 * prev
        out[1::2] = 0.75 * x + 0.25 * nxt
        return out
    return axis0(axis0(c).T).T[:shape[0], :shape[1]]


def pyramid_fill(a: np.ndarray) -> np.ndarray:
    """Push-pull fill of NaN cells: NaN-ignoring 2 × 2 block means down to a full coarse grid (recursively), then
    bilinear back up (`upsample2`), so the filler is smooth (no stair steps). Memory-light replacement for a nearest
    fill over a statewide grid; only used outside `coverage` (filler, contract "Overview no-data"). Pure."""
    gap = ~np.isfinite(a)
    if not gap.any():
        return a
    if gap.all():
        raise ValueError("no data")
    r, c = a.shape
    p = np.pad(a, ((0, r % 2), (0, c % 2)), mode="edge")
    blocks = p.reshape(p.shape[0] // 2, 2, p.shape[1] // 2, 2)
    fin = np.isfinite(blocks)
    cnt = fin.sum(axis=(1, 3))
    coarse = np.where(cnt > 0, np.where(fin, blocks, 0).sum(axis=(1, 3)) / np.maximum(cnt, 1), np.nan)
    coarse = pyramid_fill(coarse.astype(a.dtype))
    up = upsample2(coarse, (r, c))
    out = a.copy()
    out[gap] = up[gap]
    return out


def build_overview(out: Path, owned: set[Tile], kmax: int, *, workers: int = 4, quant_m: float = QUANT_M,
                   label: str = "") -> dict[str, Any]:
    from concurrent.futures import ProcessPoolExecutor

    import build as B
    T0 = time.time()
    bbox = aligned_bbox(owned, kmax)
    W, H = bbox[2] - bbox[0], bbox[3] - bbox[1]
    all_tiles = [(e, n) for n in range(bbox[1] // TILE_M, bbox[3] // TILE_M)
                 for e in range(bbox[0] // TILE_M, bbox[2] // TILE_M)]
    print(f"overview {label}: bbox {bbox} ({W // 1000}×{H // 1000} km, aligned at {chunk_side(kmax)} m), "
          f"levels {K_MIN}…{kmax}, {len(owned)} owned tiles, {len(all_tiles)} tiles in bbox", flush=True)
    need = {(e + de, n + dn) for e, n in all_tiles for de in (-1, 0, 1) for dn in (-1, 0, 1)}
    sl_p, rlp_p = B.tile_paths("dgm1", sorted(need))
    l2 = np.full((H // 4, W // 4), np.nan, np.float32)   # statewide 24 000² cells: float32 (≈ 2 GB)
    lo, hi = math.inf, -math.inf
    covered: set[Tile] = set()
    with_data = [t for t in all_tiles if any((t[0] + de, t[1] + dn) in sl_p or (t[0] + de, t[1] + dn) in rlp_p
                                             for de in (-1, 0, 1) for dn in (-1, 0, 1))]
    missing_owned = [t for t in owned if t not in sl_p and t not in rlp_p]
    with ProcessPoolExecutor(max_workers=workers) as ex:
        jobs = ((t, _near(sl_p, t), _near(rlp_p, t), BUFFER_M) for t in with_data)
        for n, (t, a, tmin, tmax) in enumerate(ex.map(tile_level2, jobs, chunksize=4)):
            if a is None:
                continue
            covered.add(t)
            r0, c0 = (bbox[3] - (t[1] + 1) * TILE_M) // 4, (t[0] * TILE_M - bbox[0]) // 4
            l2[r0:r0 + 250, c0:c0 + 250] = a
            if t in owned:
                lo, hi = min(lo, tmin), max(hi, tmax)
            if n % 200 == 199:
                print(f"  {n + 1}/{len(with_data)} tiles  [{time.time() - T0:.0f}s]", flush=True)
    if not np.isfinite(l2).any():
        raise SystemExit("overview: no DTM data at all")
    l2 = pyramid_fill(l2)
    shutil.rmtree(out / "levels", ignore_errors=True)
    levels = []
    arr = l2
    from encode import height_chunk, save_webp_lossless, terrarium_encode
    total = 0
    for k in range(K_MIN, kmax + 1):
        if k > K_MIN:
            arr = arr.reshape(arr.shape[0] // 2, 2, arr.shape[1] // 2, 2).mean(axis=(1, 3), dtype=np.float64)
        s = chunk_side(k)
        pres = level_presence(bbox, k, owned)
        from grid import decode_bitmap
        q = quantise(arr, quant_m)
        for i, j in sorted(decode_bitmap(pres)):
            total += save_webp_lossless(out / "levels" / str(k) / "dtm" / f"{i}_{j}.webp",
                                        terrarium_encode(height_chunk(q, i, j, 500)))
        levels.append({"level": k, "cellSize": 1 << k, "chunkSize": 500,
                       "size": {"width": W >> k, "height": H >> k}, "chunks": {"nx": W // s, "ny": H // s},
                       "presence": pres,
                       "height": {"dtm": {"path": f"levels/{k}/dtm/{{i}}_{{j}}.webp", "encoding": "terrarium",
                                          "apron": 1, "quant_m": quant_m}}})
        assert arr.shape == (H >> k, W >> k)
    doc = {"format": "sle-overview-v1",
           "generated": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
           "crs": "EPSG:25832", "grid": GRID, "bbox": list(bbox),
           "heightRange": {"min": round(lo, 2), "max": round(hi, 2)},
           "coverage": coverage_bitmap(bbox, covered),
           "levels": levels,
           "attribution": "; ".join([ATTRIBUTION_SL] + ([ATTRIBUTION_RLP] if rlp_p else [])),
           "build": {"pipeline": PIPELINE_VERSION, "ownedTiles": len(owned), "tilesWithData": len(with_data),
                     "ownedTilesWithoutSource": sorted(f"{e}_{n}" for e, n in missing_owned),
                     "ownedTilesWithoutCoverage": sorted(f"{e}_{n}" for e, n in owned - covered),
                     "heightRule": B.HEIGHT_RULE,
                     "bufferM": BUFFER_M, "rlpOffset": B.RLP_OFFSET_V3_M, "timingS": round(time.time() - T0, 1)}}
    out.mkdir(parents=True, exist_ok=True)
    (out / "overview.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    print(f"overview: {total / 1e6:.1f} MB, heightRange {doc['heightRange']}, coverage {len(covered)} tiles, "
          f"{len(missing_owned)} owned tiles without source → {out}  [{time.time() - T0:.0f}s]", flush=True)
    return doc


def main(argv: list[str] | None = None) -> None:
    from catalog import CATALOG_OUT, load_owners
    from grid import parse_tile_id
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=CATALOG_OUT / "overview")
    ap.add_argument("--kmax", type=int, default=6)
    ap.add_argument("--tiles", default=None, help="comma-separated tile ids instead of all owned tiles")
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args(argv)
    if a.tiles:
        owned = {parse_tile_id(t.strip()) for t in a.tiles.split(",") if t.strip()}
    else:
        owned = set(load_owners()[0])
    build_overview(a.out, owned, a.kmax, workers=a.workers)


if __name__ == "__main__":
    main()
