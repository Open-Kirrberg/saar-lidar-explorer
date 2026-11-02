"""F22: the public release export never ships the private UXO candidate classes (crater, crater_field).

Tests `scripts/release/export_data.py` (stdlib-only release script, loaded by path): the class8 PNG
codec and `strip_private_candidates` on a synthetic AOI dir. Nothing is exported or pushed.
"""
from __future__ import annotations

import importlib.util
import io
import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("export_data", ROOT / "scripts" / "release" / "export_data.py")
export_data = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(export_data)


def _png(arr: np.ndarray, optimize: bool = True) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr.astype(np.uint8), mode="L").save(buf, format="PNG", optimize=optimize)
    return buf.getvalue()


def _mask() -> np.ndarray:
    rng = np.random.default_rng(7)
    a = np.zeros((500, 500), np.uint8)
    a[10:40, 10:40] = 7  # crater field underlay
    a[20:25, 20:25] = 6  # crater
    a[100:110, 200:260] = 3  # linear
    a[300:320, 300:320] = 1  # pit
    noise = rng.integers(0, 8, size=(60, 500))  # every code, varied rows → Pillow picks mixed filters
    a[400:460] = noise
    return a


def test_png_codec_roundtrip_all_filters():
    a = _mask()
    for optimize in (True, False):
        w, h, px = export_data.png_gray8_decode(_png(a, optimize))
        assert (w, h) == (500, 500)
        assert np.array_equal(np.frombuffer(bytes(px), np.uint8).reshape(500, 500), a)
    enc = export_data.png_gray8_encode(500, 500, a.tobytes())
    back = np.asarray(Image.open(io.BytesIO(enc)))
    assert back.dtype == np.uint8 and np.array_equal(back, a)


def test_png_decode_rejects_other_formats():
    rgb = io.BytesIO()
    Image.new("RGB", (4, 4)).save(rgb, format="PNG")
    with pytest.raises(ValueError):
        export_data.png_gray8_decode(rgb.getvalue())
    with pytest.raises(ValueError):
        export_data.png_gray8_decode(b"not a png")


def _feature(cls: str, fid: str, score: float = 0.8) -> dict:
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [300000.5, 5500000.5]},
            "properties": {"id": fid, "class": cls, "score": score, "reasons": ["x"], "metrics": {}}}


def _aoi(tmp_path: Path, with_uxo: bool = True):
    aoi_dir = tmp_path / "overall"
    (aoi_dir / "candidates" / "mask").mkdir(parents=True)
    feats = [_feature("pit", "pit-1"), _feature("linear", "linear-2")]
    if with_uxo:
        feats += [_feature("crater", "crater-3"), _feature("crater_field", "crater_field-4")]
    (aoi_dir / "candidates" / "candidates.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    (aoi_dir / "candidates" / "mask" / "0_0.png").write_bytes(_png(_mask() if with_uxo else np.minimum(_mask(), 5)))
    clean = np.zeros((500, 500), np.uint8)
    clean[1:3, 1:3] = 2
    (aoi_dir / "candidates" / "mask" / "1_0.png").write_bytes(_png(clean))
    cand = {
        "path": "candidates/candidates.geojson", "crs": "EPSG:25832", "featureCount": len(feats),
        "counts": {"pit": 1, "linear": 1, **({"crater": 1, "crater_field": 1} if with_uxo else {})},
        "classes": {"pit": "Grube/Trichter", **({"crater": "Bombentrichter (Hypothese)", "crater_field": "Trichterfeld (Hypothese)"} if with_uxo else {})},
        "method": "lrm-rules", "version": 2,
        "params": {"min_score": 0.3, **({"crater_threshold": 0.55} if with_uxo else {})},
        "mask": {"path": "candidates/mask/{i}_{j}.png", "encoding": "class8", "minScore": 0.4},
        "method_version": "lrm-rules/2+sld.0.1.0",
        "method_versions": ["crater-rules/1+sld.0.1.0", "lrm-rules/2+sld.0.1.0"] if with_uxo else ["lrm-rules/2+sld.0.1.0"],
        "detectors": ["relicts", "craters"] if with_uxo else ["relicts"],
        "tiling": {"size_m": 1000, **({"crater_buffer_m": 130} if with_uxo else {})},
    }
    manifest = {"aoi": "overall", "candidates": cand}
    plan1 = {f"overall/{f.relative_to(aoi_dir).as_posix()}": f for f in aoi_dir.rglob("*") if f.is_file()}
    return aoi_dir, manifest, plan1


def test_strip_private_candidates(tmp_path: Path):
    aoi_dir, manifest, plan1 = _aoi(tmp_path)
    stats = export_data.strip_private_candidates(aoi_dir, "overall", manifest, plan1)
    assert stats == {"features": 2, "masks": 1}
    fc = json.loads(plan1["overall/candidates/candidates.geojson"])
    assert [f["properties"]["class"] for f in fc["features"]] == ["pit", "linear"]
    c = manifest["candidates"]
    assert c["featureCount"] == 2
    assert set(c["counts"]) == {"pit", "linear"} and set(c["classes"]) == {"pit"}
    assert "crater_threshold" not in c["params"] and c["params"]["min_score"] == 0.3
    assert c["method_versions"] == ["lrm-rules/2+sld.0.1.0"] and c["detectors"] == ["relicts"]
    assert "crater_buffer_m" not in c["tiling"]
    assert "crater" not in json.dumps(manifest)
    # mask: codes 6/7 → 0, everything else unchanged; the clean chunk stays a plain file copy
    _, _, px = export_data.png_gray8_decode(plan1["overall/candidates/mask/0_0.png"])
    got = np.frombuffer(bytes(px), np.uint8).reshape(500, 500)
    want = _mask()
    want[(want == 6) | (want == 7)] = 0
    assert np.array_equal(got, want)
    assert isinstance(plan1["overall/candidates/mask/1_0.png"], Path)


def test_strip_is_a_no_op_without_uxo(tmp_path: Path):
    aoi_dir, manifest, plan1 = _aoi(tmp_path, with_uxo=False)
    before = json.dumps(manifest, sort_keys=True)
    stats = export_data.strip_private_candidates(aoi_dir, "overall", manifest, plan1)
    assert stats == {"features": 0, "masks": 0}
    assert json.dumps(manifest, sort_keys=True) == before
    assert all(isinstance(v, Path) for v in plan1.values())


def test_plan_aoi_never_stages_uxo(tmp_path: Path):
    aoi_dir, manifest, _ = _aoi(tmp_path)
    (aoi_dir / "manifest.json").write_text(json.dumps(manifest))
    plan1, plan2 = {}, {}
    info = export_data.plan_aoi(tmp_path, "overall", 17, "https://example.invalid/", plan1, plan2)
    assert info["uxoRemoved"] == {"features": 2, "masks": 1}
    staged = json.loads(plan1["overall/manifest.json"])
    assert "crater" not in json.dumps(staged)
    gj = plan1["overall/candidates/candidates.geojson"]
    assert isinstance(gj, bytes) and b"crater" not in gj


def test_plan_aoi_skips_sld_side_files_and_stray_candidate_files(tmp_path: Path):
    """saar-lidar-detect side outputs in the AOI dir (run.json, report, eval, Fachbericht, manifest backups
    from `sld export-explorer`, a leftover staging copy) and stray files under candidates/ are never staged."""
    aoi_dir, manifest, _ = _aoi(tmp_path)
    (aoi_dir / "manifest.json").write_text(json.dumps(manifest))
    side = {
        "run.json": '{"craters": {"largest_fields": [{"E": 300000, "N": 5500000}]}}',
        "report.html": "<p>crater-300000-5500000</p>",
        "eval.json": "{}", "eval.md": "x", "report_overall-trichterfeld.html": "x", "eval_overall.json": "{}",
        "fachbericht_overall.pdf": "%PDF", "fachbericht_overall_shp/a.shp": "shp",
        "fachbericht/fachbericht_overall.pdf": "%PDF", "fachbericht/fachbericht_overall.gpkg": "gpkg",
        "manifest.json.bak-20261102T120000Z": json.dumps(manifest),
        "candidates.sld-new/candidates.geojson": '{"features": [{"properties": {"class": "crater"}}]}',
        "candidates/old_candidates.geojson": '{"features": []}',
        "candidates/mask/notes.txt": "x",
        "dtm/0_0.png": "png",
    }
    for rel, text in side.items():
        (aoi_dir / rel).parent.mkdir(parents=True, exist_ok=True)
        (aoi_dir / rel).write_text(text)
    plan1, plan2 = {}, {}
    info = export_data.plan_aoi(tmp_path, "overall", 17, "https://example.invalid/", plan1, plan2)
    staged = {k.split("/", 1)[1] for k in plan1}
    assert staged == {"manifest.json", "candidates/candidates.geojson", "candidates/mask/0_0.png",
                      "candidates/mask/1_0.png", "dtm/0_0.png"}
    assert len(info["skippedPrivate"]) == len(side) - 1


def test_plan_aoi_without_candidates_key_stages_no_candidate_files(tmp_path: Path):
    aoi_dir, manifest, _ = _aoi(tmp_path)
    del manifest["candidates"]
    (aoi_dir / "manifest.json").write_text(json.dumps(manifest))
    plan1, plan2 = {}, {}
    export_data.plan_aoi(tmp_path, "overall", 17, "https://example.invalid/", plan1, plan2)
    assert not any("/candidates/" in k for k in plan1)


def test_mask_chunk_with_only_uxo_cells_is_dropped_with_its_chunks_entry(tmp_path: Path):
    aoi_dir, manifest, _ = _aoi(tmp_path)
    only = np.zeros((500, 500), np.uint8)
    only[5:9, 5:9] = 6
    (aoi_dir / "candidates" / "mask" / "2_3.png").write_bytes(_png(only))
    manifest["candidates"]["mask"]["chunks"] = [[0, 0], [1, 0], [2, 3]]
    (aoi_dir / "manifest.json").write_text(json.dumps(manifest))
    plan1, plan2 = {}, {}
    info = export_data.plan_aoi(tmp_path, "overall", 17, "https://example.invalid/", plan1, plan2)
    assert info["uxoRemoved"]["masks"] == 2
    assert "overall/candidates/mask/2_3.png" not in plan1 and "overall/candidates/mask/0_0.png" in plan1
    assert json.loads(plan1["overall/manifest.json"])["candidates"]["mask"]["chunks"] == [[0, 0], [1, 0]]


def test_crater_only_primary_method_is_renamed(tmp_path: Path):
    aoi_dir, manifest, plan1 = _aoi(tmp_path)
    c = manifest["candidates"]
    c["method"], c["version"], c["method_version"] = "crater-rules", 1, "crater-rules/1+sld.0.1.0"
    export_data.strip_private_candidates(aoi_dir, "overall", manifest, plan1)
    assert (c["method"], c["version"]) == ("lrm-rules", 2) and "crater" not in json.dumps(manifest)


def test_plan_aoi_aborts_when_a_staged_file_still_names_uxo(tmp_path: Path):
    aoi_dir, manifest, _ = _aoi(tmp_path)
    manifest["candidates"]["evaluation"] = {"crater": {"recall": 0.5}}  # unknown key the strip does not know
    (aoi_dir / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(SystemExit, match="UXO"):
        export_data.plan_aoi(tmp_path, "overall", 17, "https://example.invalid/", {}, {})
