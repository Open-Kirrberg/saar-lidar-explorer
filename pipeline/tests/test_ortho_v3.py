"""v3 places (contract "Many places (v3, S2)", rules 2 + 3, "Slim formats"): ortho present-chunk selection, cache
index mapping, level-1 cells, AVIF writer, manifest entry shapes (no network), plus checks of generated v3 output
(skipped where ortho.py has not run on a v3 fixture)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import AOI, APP_DATA  # noqa: E402
from grid import tile_chunks  # noqa: E402
from ortho import (  # noqa: E402
    SL_DOP_LAYER, cache_name, chunk_bbox, image_layer_patch, map_chunk_index, present_chunk_list,
    present_tile_cells, presence_raster, save_image, write_level1_cells,
)

# fixture-v3-homburg: rectangle 376000–378000 × 5462000–5464000, tile 376_5463 (north-west) absent
OWNED = frozenset({(376, 5462), (377, 5462), (377, 5463)})


def place(owned=OWNED, e0=376000, n0=5462000, e1=378000, n1=5464000) -> AOI:
    return AOI("t-place", "T", e0, n0, e1, n1, 200, "x", 500, fmt=3, place="t", owned=owned)


def test_present_chunks_only_for_present_tiles():
    a = place()
    got = present_chunk_list(a)
    assert len(got) == 12 and got == sorted(got, key=lambda c: (c[1], c[0]))      # row-major
    assert not {(0, 0), (1, 0), (0, 1), (1, 1)} & set(got)                         # NW tile absent
    want = {c for t in OWNED for c in tile_chunks(t, a.e0, a.n1)}
    assert set(got) == want
    rect = AOI("t-rect", "T", 376000, 5462000, 378000, 5464000, 200, "x", 500)   # v2 rectangle: every chunk
    assert len(present_chunk_list(rect)) == 16


def test_present_tile_cells_are_level1_chunks():
    assert present_tile_cells(place()) == [(1, 0), (0, 1), (1, 1)]


def test_presence_raster():
    r = presence_raster(place())
    assert r.shape == (2000, 2000) and r.dtype == bool
    assert not r[:1000, :1000].any() and r[1000:, :].all() and r[:1000, 1000:].all()
    assert presence_raster(place(), 0.5).shape == (1000, 1000)


def test_map_chunk_index_to_cache_aoi():
    # place chunk (2, 0) = E 377000, N top 5464000 = chunk (6, 16) of homburg-gemeinde (374000 / 5472000)
    assert map_chunk_index(2, 0, 376000, 5464000, 374000, 5472000) == (6, 16)
    assert map_chunk_index(6, 16, 374000, 5472000, 376000, 5464000) == (2, 0)
    # the bbox-based cache name of the place chunk is the cache AOI's name of the mapped chunk
    for i, j in present_chunk_list(place()):
        ci, cj = map_chunk_index(i, j, 376000, 5464000, 374000, 5472000)
        assert (cache_name(SL_DOP_LAYER, chunk_bbox(376000, 5464000, i, j), 1000)
                == cache_name(SL_DOP_LAYER, chunk_bbox(374000, 5472000, ci, cj), 1000))
    with pytest.raises(ValueError):
        map_chunk_index(0, 0, 376250, 5464000, 374000, 5472000)


def test_avif_rgb_writer_round_trip(tmp_path):
    rng = np.random.default_rng(3)
    base = rng.integers(40, 200, (8, 8, 3), dtype=np.uint8)
    rgb = np.kron(base, np.ones((64, 64, 1), np.uint8))           # smooth-ish 512² picture
    n = save_image(tmp_path / "a.avif", rgb, "avif", 65)
    assert n == (tmp_path / "a.avif").stat().st_size > 0
    with Image.open(tmp_path / "a.avif") as im:
        assert im.format == "AVIF" and im.mode == "RGB" and im.size == (512, 512)
        back = np.asarray(im)
    assert np.abs(back.astype(int) - rgb).mean() < 6


def test_level1_cells_written_only_for_present_tiles(tmp_path):
    mosaic = np.zeros((2000, 2000, 3), np.uint8)
    mosaic[1000:, :1000] = (200, 10, 10)                           # SW tile red
    base = {"path": "ortho/{i}_{j}.avif", "encoding": "rgb", "format": "avif", "pixelsPerChunk": 1000,
            "kind": "image", "label_de": "Luftbild (DOP20)"}
    coarse = write_level1_cells(tmp_path, "ortho", mosaic, present_tile_cells(place()), base, "avif", 65)
    assert coarse == {1: {**base, "path": "ortho/levels/1/{i}_{j}.avif", "pixelsPerChunk": 500}}
    files = sorted(p.name for p in (tmp_path / "ortho" / "levels" / "1").iterdir())
    assert files == ["0_1.avif", "1_0.avif", "1_1.avif"]
    with Image.open(tmp_path / "ortho/levels/1/0_1.avif") as im:
        assert im.size == (500, 500) and np.asarray(im)[250, 250, 0] > 150
    assert write_level1_cells(tmp_path / "x", "ortho", mosaic, [], base, "avif", 65) == {}


def test_v3_manifest_patch_level0_and_level1_only():
    man = {"layers": {"svf": {"path": "relief/svf/{i}_{j}.avif"}},
           "levels": [{"level": 0, "cellSize": 1, "layers": {"svf": {"path": "relief/svf/{i}_{j}.avif"}}},
                      {"level": 1, "cellSize": 2, "layers": {"vat": {"path": "levels/1/vat/{i}_{j}.avif"}}}]}
    e0 = {"path": "ortho/{i}_{j}.avif", "encoding": "rgb", "format": "avif", "pixelsPerChunk": 1000,
          "kind": "image", "label_de": "Luftbild (DOP20)"}
    e1 = {**e0, "path": "ortho/levels/1/{i}_{j}.avif", "pixelsPerChunk": 500}
    p = image_layer_patch(man, "ortho", e0, {1: e1})
    assert p["layers"] == {"ortho": e0}
    assert p["levels"][0]["layers"] == {"svf": {"path": "relief/svf/{i}_{j}.avif"}, "ortho": e0}
    assert p["levels"][1]["layers"] == {"vat": {"path": "levels/1/vat/{i}_{j}.avif"}, "ortho": e1}
    assert len(p["levels"]) == 2


# ------------------------------------------------------------------------------------------- generated v3 output
def _v3_dirs():
    root = APP_DATA / "fixture-v3"
    out = []
    for d in sorted(root.iterdir()) if root.is_dir() else []:
        mf = d / "manifest.json"
        if mf.exists():
            m = json.loads(mf.read_text())
            if m.get("version") == 3 and "ortho" in (m.get("layers") or {}):
                out.append(d)
    return out


V3_DIRS = _v3_dirs()


def _present_from_dtm(d: Path, level_path: str) -> set[tuple[int, int]]:
    return {tuple(int(v) for v in p.stem.split("_")) for p in (d / level_path).glob("*.webp")}


@pytest.mark.skipif(not V3_DIRS, reason="no v3 fixture with layers.ortho")
@pytest.mark.parametrize("d", V3_DIRS, ids=lambda d: d.name)
def test_generated_v3_ortho(d):
    m = json.loads((d / "manifest.json").read_text())
    e = m["layers"]["ortho"]
    assert (e["format"], e["pixelsPerChunk"], e["encoding"], e["kind"]) == ("avif", 1000, "rgb", "image")
    assert e["path"] == "ortho/{i}_{j}.avif"
    l0 = {tuple(int(v) for v in p.stem.split("_")) for p in (d / "ortho").glob("*.avif")}
    assert l0 == _present_from_dtm(d, "dtm")                        # exactly the present chunks (rule 2)
    levels = {lv["level"]: lv for lv in m["levels"]}
    assert set(levels) <= {0, 1} and levels[0]["layers"]["ortho"] == e
    e1 = levels[1]["layers"]["ortho"]
    assert e1["path"] == "ortho/levels/1/{i}_{j}.avif" and e1["pixelsPerChunk"] == 500 and e1["format"] == "avif"
    l1 = {tuple(int(v) for v in p.stem.split("_")) for p in (d / "ortho" / "levels" / "1").glob("*.avif")}
    assert l1 == _present_from_dtm(d, "levels/1/dtm")
    assert not [p for p in (d / "ortho" / "levels").iterdir() if p.name != "1"]
    i, j = sorted(l0)[0]
    with Image.open(d / e["path"].format(i=i, j=j)) as im:
        assert im.size == (1000, 1000) and im.mode == "RGB"
