"""Orte im Vergleich (ADR 0049) + historic forest mask in the public release export.

Tests `scripts/release/export_data.py` (stdlib-only release script, loaded by path) on a synthetic AOI dir:
`plan_aoi` stages `stats/places.json`, `stats/places.geojson` and `forest_hist/forest_hist.png` with the
manifest keys `stats` and `forest_hist`, and nothing else from those folders. Nothing is exported or pushed.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("export_data", ROOT / "scripts" / "release" / "export_data.py")
export_data = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(export_data)

ATTR = ("© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet; "
        "Zensus 2022, © Statistische Ämter des Bundes und der Länder, dl-de/by-2-0, Daten bearbeitet; "
        "Marktstammdatenregister – © Bundesnetzagentur, dl-de/by-2-0, Daten bearbeitet")
STATS = {"format": "sle-stats-v1", "url": "stats/places.json", "geometry": "stats/places.geojson",
         "generated": "2026-11-07T22:55:08Z", "places": 1, "label_de": "Orte im Vergleich"}
FOREST = {"format": "sle-forest-hist-v1", "path": "forest_hist/forest_hist.png", "encoding": "u8-bits", "cellSize": 5,
          "size": {"width": 2, "height": 2}, "nodata": 255, "epochs": [],
          "attribution": "© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet (Historische Karten)"}


def _aoi(tmp_path: Path, **keys) -> tuple[Path, dict]:
    aoi_dir = tmp_path / "overall"
    (aoi_dir / "stats").mkdir(parents=True)
    (aoi_dir / "forest_hist").mkdir()
    (aoi_dir / "dtm").mkdir()
    (aoi_dir / "dtm" / "0_0.png").write_bytes(b"png")
    (aoi_dir / "stats" / "places.json").write_text(json.dumps(
        {"format": "sle-stats-v1", "places": [{"id": "kirrberg", "name_de": "Kirrberg"}], "attribution": ATTR}))
    (aoi_dir / "stats" / "places.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": []}))
    (aoi_dir / "stats" / "stats_report.json").write_text('{"tall_trees": {"at_clip_kept": []}}')  # local review file
    (aoi_dir / "stats" / "parcels_work.csv").write_text("fsk;trees\n")                            # never public
    (aoi_dir / "forest_hist" / "forest_hist.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    (aoi_dir / "forest_hist" / "debug_density.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    manifest = {"version": 2, "name": "Overall", "attribution": ATTR, **keys}
    (aoi_dir / "manifest.json").write_text(json.dumps(manifest))
    return aoi_dir, manifest


def _plan(tmp_path: Path):
    plan1, plan2 = {}, {}
    info = export_data.plan_aoi(tmp_path, "overall", 17, "https://example.invalid/", plan1, plan2)
    return plan1, info


def test_stats_and_forest_hist_are_staged_with_their_keys(tmp_path: Path):
    _aoi(tmp_path, stats=STATS, forest_hist=FOREST)
    plan1, info = _plan(tmp_path)
    staged = {k.split("/", 1)[1] for k in plan1}
    assert staged == {"manifest.json", "dtm/0_0.png", "stats/places.json", "stats/places.geojson",
                      "forest_hist/forest_hist.png"}
    m = json.loads(plan1["overall/manifest.json"])
    assert m["stats"] == STATS and m["forest_hist"] == FOREST
    # attribution of the new sources survives into the public manifest (ATTRIBUTION / README are built from it)
    entries = export_data.attribution_entries(m["attribution"])
    assert any(e.startswith("Zensus 2022") for e in entries) and any(e.startswith("Marktstammdatenregister") for e in entries)
    assert sorted(info["skippedPrivate"]) == ["forest_hist/debug_density.png", "stats/parcels_work.csv", "stats/stats_report.json"]


def test_without_keys_nothing_from_those_folders_is_staged(tmp_path: Path):
    _aoi(tmp_path)
    plan1, _ = _plan(tmp_path)
    assert not [k for k in plan1 if "/stats/" in k or "/forest_hist/" in k]


def test_stats_without_geometry_and_wrong_format_key(tmp_path: Path):
    _aoi(tmp_path, stats={k: v for k, v in STATS.items() if k != "geometry"}, forest_hist={**FOREST, "format": "x"})
    plan1, _ = _plan(tmp_path)
    staged = {k.split("/", 1)[1] for k in plan1}
    assert "stats/places.json" in staged and "stats/places.geojson" not in staged
    assert "forest_hist/forest_hist.png" not in staged
    assert "forest_hist" not in json.loads(plan1["overall/manifest.json"])  # dropped: the app would ignore it anyway


@pytest.mark.parametrize("bad", [
    {"url": "stats/missing.json"},              # file not there: the public manifest would point at nothing
    {"url": "../manifest.json"},                # outside the folder
    {"url": "places.json"},
])
def test_bad_stats_paths_abort(tmp_path: Path, bad: dict):
    _aoi(tmp_path, stats={**STATS, **bad})
    with pytest.raises(SystemExit):
        _plan(tmp_path)


def test_stats_naming_a_local_path_aborts(tmp_path: Path):
    aoi_dir, _ = _aoi(tmp_path, stats=STATS)
    (aoi_dir / "stats" / "places.json").write_text('{"format": "sle-stats-v1", "inputs": {"zensus": "/Users/x/data/zensus.csv"}}')
    with pytest.raises(SystemExit):
        _plan(tmp_path)


def test_real_overall_stats_stage_when_present():
    """Local real data (git-ignored): the overall AOI's stats + forest files pass the guard."""
    src = ROOT / "app" / "public" / "data" / "overall"
    m = json.loads((src / "manifest.json").read_text()) if (src / "manifest.json").is_file() else {}
    if not (m.get("stats") and m.get("forest_hist")):
        pytest.skip("no local overall stats / forest_hist")
    files = export_data.keyed_layer_files(src, dict(m))
    assert files["stats/"] == {"stats/places.json", "stats/places.geojson"}
    assert files["forest_hist/"] == {"forest_hist/forest_hist.png"}
