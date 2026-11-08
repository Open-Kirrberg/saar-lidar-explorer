"""S2 v3 places in detect.py: ADR 0053 opt-in, candidates with the centroid in a present tile, WebP class8 mask."""
from __future__ import annotations

import io
import json
import sys
import tomllib
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import detect as D  # noqa: E402
from common import AOI, APP_DATA, load_aoi  # noqa: E402
from grid import tile_of_point  # noqa: E402

OWNED = frozenset({(376, 5462), (377, 5462), (377, 5463)})
PLACE_IN = AOI("p", "P", 376000, 5462000, 378000, 5464000, 200, "SPK", 500, fmt=3, place="p", ags="10000000",
               owned=OWNED, relict_candidates=True)
PLACE_OUT = AOI("p", "P", 376000, 5462000, 378000, 5464000, 200, "SPK", 500, fmt=3, place="p", ags="10000000",
                owned=OWNED, relict_candidates=False)
RECT = AOI("r", "R", 376000, 5462000, 378000, 5464000, 200, "SPK", 500)


def _cand(cls, e, n, score=0.6):
    return D.Candidate(cls, score, e, n, {"diameter_m": 6.0}, [])


def test_opt_in_rule():
    assert D.publishes_candidates(RECT)                 # v1/v2: unchanged
    assert D.publishes_candidates(PLACE_IN)
    assert not D.publishes_candidates(PLACE_OUT)        # ADR 0053 default for places


def test_own_candidates_by_centroid():
    cs = [_cand("pit", 376500, 5462500), _cand("mound", 376500, 5463500), _cand("linear", 377000.0, 5463000.0),
          _cand("rect", 376999.99, 5463000.0), _cand("pit", 377999.5, 5463999.5)]
    assert [(c.cls, c.E) for c in D.own_candidates(PLACE_IN, cs)] == [("pit", 376500), ("linear", 377000.0),
                                                                      ("pit", 377999.5)]
    assert D.own_candidates(RECT, cs) == cs


def test_present_cells():
    m = D.present_cells(PLACE_IN)
    assert m.shape == (2000, 2000) and m.sum() == 3_000_000
    assert not m[:1000, :1000].any() and m[1000:, :].all() and m[:1000, 1000:].all()
    assert D.present_cells(RECT) is None


def test_mask_webp_present_chunks_only(tmp_path):
    from PIL import Image
    grid = D.Grid(PLACE_IN.e0, PLACE_IN.n1, (PLACE_IN.height, PLACE_IN.width))
    cs = D.own_candidates(PLACE_IN, [_cand("pit", 376250, 5463750),      # absent tile → dropped
                                     _cand("mound", 377250, 5463750),    # chunk (2, 0)
                                     _cand("rect", 376250, 5462250)])    # chunk (0, 3)
    m = D.class_mask(cs, grid, 0.4)
    m[100:110, 100:110] = 1        # a stray value in the absent chunk (0, 0) must not be written either
    chunks = D.write_mask_chunks(m, tmp_path / "mask", 500, keep=PLACE_IN.chunk_present, fmt="webp")
    assert chunks == [[2, 0], [0, 3]]
    assert sorted(p.name for p in (tmp_path / "mask").iterdir()) == ["0_3.webp", "2_0.webp"]
    for i, j in chunks:
        raw = (tmp_path / "mask" / f"{i}_{j}.webp").read_bytes()
        assert raw[12:16] == b"VP8L"
        v = np.asarray(Image.open(io.BytesIO(raw)).convert("RGB"))
        assert np.array_equal(v[..., 0], m[j * 500:(j + 1) * 500, i * 500:(i + 1) * 500])
        assert (v[..., 0] == v[..., 2]).all()
    assert set(np.unique(m[:500, 1000:1500])) == {0, D.CLASS_CODE["mound"]}
    # v1/v2 default: PNG for every non-empty chunk
    png = D.write_mask_chunks(m, tmp_path / "png", 500)
    assert png == [[0, 0], [2, 0], [0, 3]] and (tmp_path / "png" / "0_0.png").exists()


def test_retract_candidates_keeps_other_keys(tmp_path, capsys):
    (tmp_path / "candidates" / "mask").mkdir(parents=True)
    (tmp_path / "candidates" / "candidates.geojson").write_text("{}")
    (tmp_path / "trees").mkdir()
    (tmp_path / "manifest.json").write_text(json.dumps({"version": 3, "candidates": {"path": "x"}, "trees": {"a": 1},
                                                        "attribution": "A"}))
    D.retract_candidates(tmp_path, "not opted in")
    m = json.loads((tmp_path / "manifest.json").read_text())
    assert "candidates" not in m and m["trees"] == {"a": 1} and m["version"] == 3
    assert not (tmp_path / "candidates").exists() and (tmp_path / "trees").exists()
    assert "not opted in" in capsys.readouterr().out
    D.retract_candidates(tmp_path, "again")      # idempotent
    assert "stale" not in capsys.readouterr().out


# --------------------------------------------------------------------------- generated data (v3 places)
_CFG = tomllib.loads((Path(__file__).resolve().parents[1] / "aois.toml").read_text())
PLACES = [k for k, v in _CFG.items() if isinstance(v, dict) and "place" in v
          and (APP_DATA / v.get("out", k) / "manifest.json").exists()]


@pytest.mark.skipif(not PLACES, reason="no v3 place built")
@pytest.mark.parametrize("key", PLACES)
def test_generated_place_candidates(key):
    from PIL import Image
    a = load_aoi(key)
    m = json.loads((a.data_dir / "manifest.json").read_text())
    if not a.relict_candidates:
        assert "candidates" not in m and not (a.data_dir / "candidates").exists()
        return
    if "candidates" not in m:
        pytest.skip("detect not run")
    e = m["candidates"]
    fc = json.loads((a.data_dir / e["path"]).read_text())
    assert len(fc["features"]) == e["featureCount"] == sum(e["counts"].values())
    assert set(e["counts"]) <= set(D.CLASSES)                          # never crater/UXO classes
    for f in fc["features"]:
        E, N = f["geometry"]["coordinates"][:2]
        assert a.present(*tile_of_point(E, N)), f["properties"]["id"]
    mk = e.get("mask")
    if mk:
        assert mk["path"] == "candidates/mask/{i}_{j}.webp" and mk["encoding"] == "class8"
        assert {p.name for p in (a.data_dir / "candidates" / "mask").iterdir()} == \
            {f"{i}_{j}.webp" for i, j in mk["chunks"]}
        for i, j in mk["chunks"]:
            assert a.chunk_present(i, j)
            raw = (a.data_dir / mk["path"].format(i=i, j=j)).read_bytes()
            assert raw[12:16] == b"VP8L"
            v = np.asarray(Image.open(io.BytesIO(raw)).convert("RGB"))
            assert v.shape == (500, 500, 3) and set(np.unique(v)) <= {0, 1, 2, 3, 4, 5} and v.any()
