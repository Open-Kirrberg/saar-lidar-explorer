"""Orte im Vergleich (ADR 0049) + historic forest mask + tree species layer in the public release export.

Tests `scripts/release/export_data.py` (stdlib-only release script, loaded by path) on a synthetic AOI dir:
`plan_aoi` stages `stats/places.json`, `stats/places.geojson`, `forest_hist/forest_hist.png` and
`species/species.png` with the manifest keys `stats`, `forest_hist` and `species`, and nothing else from those
folders. Nothing is exported or pushed.
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

SPECIES_ATTR = ("Baumarten: DLR, Tree Species Germany 2022 (Wegler et al. 2025), CC BY 4.0, doi:10.15489/smh8w3j8i962, "
                "Daten bearbeitet (umprojiziert)")
ATTR = ("© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet; "
        "Zensus 2022, © Statistische Ämter des Bundes und der Länder, dl-de/by-2-0, Daten bearbeitet; "
        "Marktstammdatenregister – © Bundesnetzagentur, dl-de/by-2-0, Daten bearbeitet; "
        "GBIF.org (2026-11-08) GBIF Occurrence Search, https://www.gbif.org; " + SPECIES_ATTR)
STATS = {"format": "sle-stats-v1", "url": "stats/places.json", "geometry": "stats/places.geojson",
         "generated": "2026-11-07T22:55:08Z", "places": 1, "label_de": "Orte im Vergleich"}
FOREST = {"format": "sle-forest-hist-v1", "path": "forest_hist/forest_hist.png", "encoding": "u8-bits", "cellSize": 5,
          "size": {"width": 2, "height": 2}, "nodata": 255, "epochs": [],
          "attribution": "© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet (Historische Karten)"}
SPECIES = {"format": "sle-species-v1", "path": "species/species.png", "encoding": "u8-class", "cellSize": 10,
           "size": {"width": 2, "height": 2}, "nodata": 255, "year": 2022, "classes": [], "attribution": SPECIES_ATTR}


def _aoi(tmp_path: Path, **keys) -> tuple[Path, dict]:
    aoi_dir = tmp_path / "overall"
    (aoi_dir / "stats").mkdir(parents=True)
    (aoi_dir / "forest_hist").mkdir()
    (aoi_dir / "species").mkdir()
    (aoi_dir / "dtm").mkdir()
    (aoi_dir / "dtm" / "0_0.png").write_bytes(b"png")
    (aoi_dir / "stats" / "places.json").write_text(json.dumps(
        {"format": "sle-stats-v1", "places": [{"id": "kirrberg", "name_de": "Kirrberg"}], "attribution": ATTR}))
    (aoi_dir / "stats" / "places.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": []}))
    (aoi_dir / "stats" / "stats_report.json").write_text('{"tall_trees": {"at_clip_kept": []}}')  # local review file
    (aoi_dir / "stats" / "parcels_work.csv").write_text("fsk;trees\n")                            # never public
    (aoi_dir / "forest_hist" / "forest_hist.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    (aoi_dir / "forest_hist" / "debug_density.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    (aoi_dir / "species" / "species.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    (aoi_dir / "species" / "species_preview.png").write_bytes(b"\x89PNG\r\n\x1a\n")   # local colour preview
    manifest = {"version": 2, "name": "Overall", "attribution": ATTR, **keys}
    (aoi_dir / "manifest.json").write_text(json.dumps(manifest))
    return aoi_dir, manifest


def _plan(tmp_path: Path):
    plan1, plan2 = {}, {}
    info = export_data.plan_aoi(tmp_path, "overall", 17, "https://example.invalid/", plan1, plan2)
    return plan1, info


def test_stats_and_forest_hist_are_staged_with_their_keys(tmp_path: Path):
    _aoi(tmp_path, stats=STATS, forest_hist=FOREST, species=SPECIES)
    plan1, info = _plan(tmp_path)
    staged = {k.split("/", 1)[1] for k in plan1}
    assert staged == {"manifest.json", "dtm/0_0.png", "stats/places.json", "stats/places.geojson",
                      "forest_hist/forest_hist.png", "species/species.png"}
    m = json.loads(plan1["overall/manifest.json"])
    assert m["stats"] == STATS and m["forest_hist"] == FOREST and m["species"] == SPECIES
    # attribution of the new sources survives into the public manifest (ATTRIBUTION / README are built from it)
    entries = export_data.attribution_entries(m["attribution"])
    assert any(e.startswith("Zensus 2022") for e in entries) and any(e.startswith("Marktstammdatenregister") for e in entries)
    assert SPECIES_ATTR in entries and any(e.startswith("GBIF.org") for e in entries)
    assert sorted(info["skippedPrivate"]) == ["forest_hist/debug_density.png", "species/species_preview.png",
                                              "stats/parcels_work.csv", "stats/stats_report.json"]


def test_species_key_with_wrong_format_or_bad_path(tmp_path: Path):
    _aoi(tmp_path, species={**SPECIES, "format": "sle-species-v0"})
    plan1, _ = _plan(tmp_path)
    assert not [k for k in plan1 if "/species/" in k]
    assert "species" not in json.loads(plan1["overall/manifest.json"])
    for bad in ("species/missing.png", "../species.png", "forest_hist/forest_hist.png"):
        _aoi(tmp_path / bad.replace("/", "_").replace(".", "_"), species={**SPECIES, "path": bad})
        with pytest.raises(SystemExit):
            export_data.plan_aoi(tmp_path / bad.replace("/", "_").replace(".", "_"), "overall", 17,
                                 "https://example.invalid/", {}, {})


def test_without_keys_nothing_from_those_folders_is_staged(tmp_path: Path):
    _aoi(tmp_path)
    plan1, _ = _plan(tmp_path)
    assert not [k for k in plan1 if "/stats/" in k or "/forest_hist/" in k or "/species/" in k]


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
    if m.get("species"):
        assert files["species/"] == {"species/species.png"}


# ---- S1: stats-only AOI `saarland` (ADR 0051, contract „Place statistics“ → „Gemeinde level“) ----------------------

VG25_ATTR = ("© BKG (2026) CC BY 4.0 (Daten verändert), Datenquellen: "
             "https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg25.pdf (VG25)")
LEVELS = {"format": "sle-stats-levels-v1", "levels": [
    {"level": "gemeinde", "aoi": "saarland", "label_de": "Gemeinden"},
    {"level": "ortsteil", "aoi": "overall", "label_de": "Ortsteile"}]}
G_STATS = {"format": "sle-stats-v1", "url": "stats/places.json", "geometry": "stats/places.geojson",
           "generated": "2026-11-08T17:27:42Z", "places": 1, "label_de": "Gemeinden im Vergleich", "level": "gemeinde"}
G_PLACE = {"id": "homburg", "name_de": "Homburg", "kind": "gemeinde", "ags": "10045114", "status": "building",
           "riesen": None, "tallest": None, "label": [383000, 5464000],
           "biodiversity": {"species": 900, "occurrences": 12000, "rarefied_500": 210, "rarefied_500_range": [200, 210, 220],
                            "few_records": False, "years": [2000, 2026]}}


def _saarland(src: Path, places=None, features=None, **extra) -> Path:
    d = src / "saarland"
    (d / "stats").mkdir(parents=True, exist_ok=True)
    doc = {"format": "sle-stats-v1", "version": 1, "level": "gemeinde", "attribution": VG25_ATTR,
           "inputs": {"vg25": {"name_de": "VG25, Gemeindegrenzen", "provider": "BKG", "licence": "CC-BY-4.0",
                               "attribution": VG25_ATTR}},
           "places": [G_PLACE] if places is None else places}
    (d / "stats" / "places.json").write_text(json.dumps(doc, ensure_ascii=False))
    fc = {"type": "FeatureCollection", "features": features if features is not None else [
        {"type": "Feature", "properties": {"id": "homburg", "name_de": "Homburg"}, "geometry": None}]}
    (d / "stats" / "places.geojson").write_text(json.dumps(fc))
    (d / "stats" / "gemeinden_report.json").write_text("{}")          # review file: never public
    (d / "work").mkdir(exist_ok=True)
    (d / "work" / "tile_sums.csv").write_text("tile;trees\n")          # work file: never public
    m = {"version": 1, "kind": "stats-only", "aoi": "saarland", "name": "Saarland – Gemeinden im Vergleich",
         "crs": "EPSG:25832", "stats": G_STATS, "stats_levels": LEVELS, "attribution": VG25_ATTR + "; " + ATTR, **extra}
    (d / "manifest.json").write_text(json.dumps(m, ensure_ascii=False, indent=2) + "\n")
    return d


def test_stats_only_aoi_stages_manifest_and_stats_files_only(tmp_path: Path):
    d = _saarland(tmp_path)
    plan1: dict = {}
    info = export_data.plan_stats_aoi(tmp_path, "saarland", plan1, {"overall": "ortsteil"})
    assert set(plan1) == {"saarland/manifest.json", "saarland/stats/places.json", "saarland/stats/places.geojson"}
    assert plan1["saarland/manifest.json"] == d / "manifest.json"          # unchanged: byte-identical
    assert sorted(info["skipped"]) == ["stats/gemeinden_report.json", "work/tile_sums.csv"]
    assert info["level"] == "gemeinde" and "vg25" in info["inputs"]


def test_stats_only_level_not_staged_drops_stats_levels(tmp_path: Path):
    _saarland(tmp_path)
    plan1: dict = {}
    export_data.plan_stats_aoi(tmp_path, "saarland", plan1, {})            # overall not staged
    m = json.loads(plan1["saarland/manifest.json"])
    assert "stats_levels" not in m and m["stats"] == G_STATS


@pytest.mark.parametrize("extra", [{"chunks": {"nx": 1, "ny": 1}}, {"layers": {}}, {"xyz": {}}, {"candidates": {}}])
def test_stats_only_manifest_with_tile_keys_aborts(tmp_path: Path, extra: dict):
    _saarland(tmp_path, **extra)
    with pytest.raises(SystemExit):
        export_data.plan_stats_aoi(tmp_path, "saarland", {}, {})


def test_stats_only_wrong_kind_or_missing_stats_aborts(tmp_path: Path):
    d = _saarland(tmp_path)
    m = json.loads((d / "manifest.json").read_text())
    for bad in ({**m, "kind": "tiles"}, {k: v for k, v in m.items() if k != "stats"}, {**m, "aoi": "overall"}):
        (d / "manifest.json").write_text(json.dumps(bad))
        with pytest.raises(SystemExit):
            export_data.plan_stats_aoi(tmp_path, "saarland", {}, {})
    with pytest.raises(SystemExit):
        export_data.plan_stats_aoi(tmp_path, "nowhere", {}, {})


@pytest.mark.parametrize("places,features", [
    ([{**G_PLACE, "flurstueck": "x"}], None),                                       # parcel key
    ([{**G_PLACE, "note_de": "Hauptstraße 12"}], None),                              # address-like value
    ([{**G_PLACE, "riesen": [{"E": 383001, "N": 5464001, "h": 51}]}], None),         # tree positions on the Gemeinde level
    ([{**G_PLACE, "tallest": {"E": 383001, "N": 5464001, "h": 51}}], None),
    ([{**G_PLACE, "biodiversity": {"species": 3, "names": ["Lucanus cervus"]}}], None),  # GBIF: counts only
    (None, [{"type": "Feature", "properties": {"id": "homburg", "name_de": "Homburg", "ags": "1"}, "geometry": None}]),
])
def test_stats_privacy_guard_aborts(tmp_path: Path, places, features):
    _saarland(tmp_path, places=places, features=features)
    with pytest.raises(SystemExit):
        export_data.plan_stats_aoi(tmp_path, "saarland", {}, {})


def test_stats_size_guard(tmp_path: Path, monkeypatch):
    d = _saarland(tmp_path)
    monkeypatch.setitem(export_data.STATS_FILE_AIM_KB, "places.json", 0)
    info = export_data.plan_stats_aoi(tmp_path, "saarland", {}, {})
    assert any("places.json" in w for w in info["warnings"])
    monkeypatch.setattr(export_data, "STATS_FILE_HARD_KB", 0)
    with pytest.raises(SystemExit):
        export_data.plan_stats_aoi(tmp_path, "saarland", {}, {})
    assert (d / "manifest.json").is_file()


def test_tile_aoi_stats_levels_kept_only_when_level_aoi_is_staged(tmp_path: Path):
    _aoi(tmp_path, stats=STATS, stats_levels=LEVELS)
    plan1, _ = _plan(tmp_path)                                                       # no saarland staged
    assert "stats_levels" not in json.loads(plan1["overall/manifest.json"])
    plan1, plan2 = {}, {}
    export_data.plan_aoi(tmp_path, "overall", 17, "https://example.invalid/", plan1, plan2, level_aois={"saarland": "gemeinde"})
    assert json.loads(plan1["overall/manifest.json"])["stats_levels"] == LEVELS
    plan1, plan2 = {}, {}
    export_data.plan_aoi(tmp_path, "overall", 17, "https://example.invalid/", plan1, plan2, level_aois={"saarland": "ortsteil"})
    assert "stats_levels" not in json.loads(plan1["overall/manifest.json"])           # level mismatch -> dropped
    m = {"stats_levels": {**LEVELS, "format": "x"}}
    assert export_data.check_stats_levels(m, {"overall": "ortsteil", "saarland": "gemeinde"}) and "stats_levels" not in m


def _main_args(src: Path, out: Path, *extra: str) -> list:
    return ["--src", str(src), "--castle-terrain", str(src / "no-terrain"), "--out1", str(out / "d1"), "--out2", str(out / "d2"),
            "--app-url", "https://example.invalid/app/", "--data-url", "https://example.invalid/d1/",
            "--data2-url", "https://example.invalid/d2/", "--stats-aois", "saarland", *extra]


def test_full_export_stages_saarland_with_credits(tmp_path: Path):
    src, out = tmp_path / "src", tmp_path / "out"
    _aoi(src, stats=STATS, stats_levels=LEVELS)
    _saarland(src)
    assert export_data.main(_main_args(src, out)) == 0
    d1 = out / "d1"
    assert sorted(p.relative_to(d1 / "saarland").as_posix() for p in (d1 / "saarland").rglob("*") if p.is_file()) == \
        ["manifest.json", "stats/places.geojson", "stats/places.json"]
    assert json.loads((d1 / "overall" / "manifest.json").read_text())["stats_levels"] == LEVELS
    assert VG25_ATTR in (d1 / "ATTRIBUTION").read_text().splitlines()
    readme = (d1 / "README.md").read_text()
    assert "| `saarland/` |" in readme and "**BKG VG25**" in readme and "{{" not in readme
    index = (d1 / "index.html").read_text()
    assert 'href="https://www.bkg.bund.de">BKG</a>' in index and "{{" not in index


def test_full_export_without_stats_aois_has_no_empty_template_lines(tmp_path: Path):
    src, out = tmp_path / "src", tmp_path / "out"
    _aoi(src, stats=STATS, stats_levels=LEVELS)
    args = _main_args(src, out)
    args[args.index("--stats-aois") + 1] = ""
    assert export_data.main(args) == 0
    readme = (out / "d1" / "README.md").read_text()
    assert "{{" not in readme and "|\n\n|" not in readme and "saarland" not in readme
    assert "stats_levels" not in json.loads((out / "d1" / "overall" / "manifest.json").read_text())


def test_stats_only_mode_adds_only_stats_levels_to_the_staged_manifest(tmp_path: Path):
    src, out = tmp_path / "src", tmp_path / "out"
    aoi_dir, local = _aoi(src, stats=STATS, stats_levels=LEVELS, candidates={"path": "candidates/c.geojson", "featureCount": 99})
    # local attribution: the VG25 credit (gemeinden_stats.py) and an unpublished other new entry
    local["attribution"] = ATTR + "; © Neue Quelle (2026), dl-de/by-2-0; " + VG25_ATTR
    (aoi_dir / "manifest.json").write_text(json.dumps(local))
    _saarland(src)
    d1 = out / "d1"
    (d1 / "overall" / "dtm").mkdir(parents=True)
    (d1 / "overall" / "dtm" / "0_0.png").write_bytes(b"published tile")
    (d1 / "zones").mkdir()
    (d1 / "zones" / "index.json").write_text("{}")
    published = {"version": 2, "name": "Overall", "attribution": ATTR, "stats": STATS,
                 "candidates": {"path": "candidates/c.geojson", "featureCount": 7}, "release": {"note": "x"}}
    base_text = json.dumps(published, ensure_ascii=False) + "\n"                  # default separators, like the live file
    (d1 / "overall" / "manifest.json").write_text(base_text)
    before = {p: p.read_bytes() for p in d1.rglob("*") if p.is_file()}
    assert export_data.main(_main_args(src, out, "--stats-only", "--dry-run")) == 0
    assert {p: p.read_bytes() for p in d1.rglob("*") if p.is_file()} == before     # dry run writes nothing
    assert export_data.main(_main_args(src, out, "--stats-only")) == 0
    m = json.loads((d1 / "overall" / "manifest.json").read_text())
    assert m == {**published, "stats_levels": LEVELS,                              # local candidates (99) did not leak
                 "attribution": ATTR + "; " + VG25_ATTR}                           # only the VG25 line was added
    assert (d1 / "overall" / "manifest.json").read_text() == json.dumps(m, ensure_ascii=False) + "\n"
    assert (d1 / "overall" / "dtm" / "0_0.png").read_bytes() == b"published tile"  # nothing else touched
    assert (d1 / "zones" / "index.json").is_file() and not (out / "d2").exists()
    assert (d1 / "saarland" / "stats" / "places.json").is_file()
    assert not (d1 / "saarland" / "work").exists()
    assert VG25_ATTR in (d1 / "ATTRIBUTION").read_text()


def test_stats_only_mode_needs_a_staged_manifest(tmp_path: Path):
    src, out = tmp_path / "src", tmp_path / "out"
    _aoi(src, stats=STATS, stats_levels=LEVELS)
    _saarland(src)
    with pytest.raises(SystemExit):
        export_data.main(_main_args(src, out, "--stats-only"))


def test_real_saarland_stats_stage_when_present():
    """Local real data (git-ignored): the stats-only AOI `saarland` passes the stats-only, size and privacy guards."""
    src = ROOT / "app" / "public" / "data"
    if not (src / "saarland" / "manifest.json").is_file():
        pytest.skip("no local saarland AOI")
    plan1: dict = {}
    info = export_data.plan_stats_aoi(src, "saarland", plan1, {"overall": export_data.read_stats_level(src, "overall")})
    assert set(plan1) == {"saarland/manifest.json", "saarland/stats/places.json", "saarland/stats/places.geojson"}
    assert info["level"] == "gemeinde"
    # every input credit of places.json is in the manifest attribution (README / ATTRIBUTION are built from it)
    entries = export_data.attribution_entries(info["manifest"]["attribution"])
    for k, v in info["inputs"].items():
        assert v["attribution"] in entries, k


def test_stats_only_attribution_pattern_matches_the_pipeline_credit():
    import gemeinden as G
    assert export_data.STATS_ONLY_ATTRIBUTION.match(G.ATTRIBUTION_VG25)
    assert G.ATTRIBUTION_VG25 == VG25_ATTR
    assert not export_data.STATS_ONLY_ATTRIBUTION.match("© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (VG25)")
