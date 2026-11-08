"""S3: ort.toml-driven place builds (place.py), catalog ownership for place repos, catalog site (katalog.py)."""
from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tarfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import catalog  # noqa: E402
import common  # noqa: E402
import katalog  # noqa: E402
import place  # noqa: E402
from grid import GRID, encode_bitmap  # noqa: E402

PIPE = Path(__file__).resolve().parents[1]
ORT = {"schema": "sle-ort-v1", "id": "homburg", "name_de": "Homburg", "ags": "10045114", "state": "SL",
       "maintainers": ["huhn511"], "options": {"relict_candidates": False, "pointclouds": []}}
DEFAULT_AREAS = [{"id": "merburg", "name_de": "Burgruine Merburg", "bbox": [381500, 5463000, 382500, 5464000]}]


def cat_doc(places):
    return {"format": "sle-catalog-v1", "grid": GRID, "ownership": {"rule": "largest-share-v1", "outlines": "x"},
            "places": places}


def entry(pid, ags, tiles, status="3d"):
    e0 = min(t[0] for t in tiles) * 1000
    n0 = min(t[1] for t in tiles) * 1000
    e1 = (max(t[0] for t in tiles) + 1) * 1000
    n1 = (max(t[1] for t in tiles) + 1) * 1000
    bm = encode_bitmap((e1 - e0) // 1000, (n1 - n0) // 1000, ((t[0] - e0 // 1000, n1 // 1000 - 1 - t[1]) for t in tiles))
    return {"id": pid, "name_de": pid.title(), "ags": ags, "state": "SL", "status": status, "bbox": [e0, n0, e1, n1],
            "tiles": bm}


# ------------------------------------------------------------------------------------------------ ort.toml
def test_parse_ort_minimal_defaults():
    o = place.parse_ort({k: v for k, v in ORT.items() if k != "options"})
    assert o.key == "ort-homburg" and o.relict_candidates is False and o.pointclouds == ()


def test_parse_ort_collects_every_problem():
    bad = {**ORT, "id": "Homburg!", "ags": 10045114, "state": "BW", "maintainers": ["a@b.de"], "typo": 1,
           "options": {"relict_candidates": "yes", "extra": 1}}
    with pytest.raises(place.OrtError) as e:
        place.parse_ort(bad)
    text = " ".join(e.value.problems)
    for frag in ("unknown keys", "id must", "ags must", "state must", "maintainers", "relict_candidates", "[options]"):
        assert frag in text, frag


def test_parse_ort_own_areas_limits():
    big = {**ORT, "pointcloud_area": [{"id": "gross", "name_de": "Groß", "bbox": [380000, 5460000, 381500, 5461000]}]}
    with pytest.raises(place.OrtError, match="1 km"):
        place.parse_ort(big)
    odd = {**ORT, "pointcloud_area": [{"id": "x", "name_de": "X", "bbox": [380050, 5460000, 380500, 5460500]}]}
    with pytest.raises(place.OrtError, match="multiples of 100"):
        place.parse_ort(odd)
    many = {**ORT, "options": {"pointclouds": ["a", "b", "c", "d"]},
            "pointcloud_area": [{"id": f"o{i}", "name_de": "O", "bbox": [380000, 5460000, 380100, 5460100]} for i in range(2)]}
    with pytest.raises(place.OrtError, match="at most 5"):
        place.parse_ort(many)


def test_resolve_areas_known_and_unknown():
    o = place.parse_ort({**ORT, "options": {"pointclouds": ["merburg"]}})
    assert [a.id for a in place.resolve_areas(o, DEFAULT_AREAS)] == ["merburg"]
    o2 = place.parse_ort({**ORT, "options": {"pointclouds": ["nirgendwo"]}})
    with pytest.raises(place.OrtError, match="unknown focus area"):
        place.resolve_areas(o2, DEFAULT_AREAS)


def test_template_and_homburg_ort_files_parse():
    """The ort.toml files of the sibling repos (if checked out next to the explorer) follow sle-ort-v1."""
    root = PIPE.parents[1]
    found = 0
    for repo in ("ort-vorlage", "ort-homburg", "ort-zweibruecken"):
        f = root / repo / "ort.toml"
        if f.exists():
            o = place.load_ort(f)
            found += 1
            if repo == "ort-vorlage":
                assert o.relict_candidates is False and o.pointclouds == ()   # ADR 0053 default
    if not found:
        pytest.skip("sibling place repos not checked out")


# ------------------------------------------------------------------------------------------------ catalog
def test_owners_from_catalog_roundtrip_with_place_entry():
    tiles = {(376, 5462), (377, 5462), (377, 5463)}
    e = catalog.place_entry({"id": "homburg", "name_de": "Homburg", "ags": "10045114", "state": "SL"}, tiles,
                            {"status": "3d", "data_url": "https://x/"})
    owners, meta = catalog.owners_from_catalog(cat_doc([e]))
    assert set(owners) == tiles and meta["places"]["homburg"]["ags"] == "10045114"


def test_owners_from_catalog_rejects_double_claim_and_bad_format():
    a, b = entry("a", "10000001", [(380, 5460)]), entry("b", "10000002", [(380, 5460), (381, 5460)])
    with pytest.raises(ValueError, match="claimed"):
        catalog.owners_from_catalog(cat_doc([a, b]))
    with pytest.raises(ValueError, match="sle-catalog-v1"):
        catalog.owners_from_catalog({"format": "x"})


def test_check_against_catalog():
    o = place.parse_ort(ORT)
    assert place.check_against_catalog(o, {"homburg": {"ags": "10045114"}}) == []
    assert "not in the catalog" in place.check_against_catalog(o, {})[0]
    assert "ags" in place.check_against_catalog(o, {"homburg": {"ags": "10045115"}})[0]


def test_aoi_table_loads_through_sle_aois_extra(tmp_path, monkeypatch):
    tiles = [(376, 5462), (377, 5462), (377, 5463)]
    cat = tmp_path / "catalog.json"
    cat.write_text(json.dumps(cat_doc([entry("homburg", "10045114", tiles)])))
    o = place.parse_ort({**ORT, "options": {"relict_candidates": True, "pointclouds": []}})
    extra = tmp_path / "aois.ort.toml"
    extra.write_text(place.aoi_table(o, [place.Area("merburg", "Merburg", (381500, 5463000, 382500, 5464000))], cat))
    monkeypatch.setenv(common.AOIS_EXTRA_ENV, str(extra))
    aoi = common.load_aoi("ort-homburg", step="build")
    assert aoi.is_place and aoi.owned == frozenset(tiles) and aoi.relict_candidates and aoi.ags == "10045114"
    assert (aoi.e0, aoi.n0, aoi.e1, aoi.n1) == (376000, 5462000, 378000, 5464000)
    assert common.aoi_config("ort-homburg")["pointclouds"][0]["id"] == "merburg"
    assert common.aoi_config("karlsberg")["bbox"] == [381000, 5465000, 384000, 5468000]   # aois.toml untouched


def test_extra_aois_must_not_redefine_defaults(tmp_path, monkeypatch):
    extra = tmp_path / "x.toml"
    extra.write_text("[defaults]\nbuffer_m = 300\n")
    monkeypatch.setenv(common.AOIS_EXTRA_ENV, str(extra))
    with pytest.raises(SystemExit):
        common.aoi_config("karlsberg")


def test_cache_keys_stable_and_sensitive():
    o = place.parse_ort(ORT)
    k1 = place.raw_key(o, ["376_5462", "377_5462"], [])
    assert k1 == place.raw_key(o, ["377_5462", "376_5462"], []) and k1.startswith("sle-raw-homburg-")
    assert k1 != place.raw_key(o, ["376_5462"], [])
    b1 = place.build_key(o, ["376_5462"], [], "abc")
    assert b1 != place.build_key(o, ["376_5462"], [], "abd")
    o2 = place.parse_ort({**ORT, "options": {"relict_candidates": True}})
    assert b1 != place.build_key(o2, ["376_5462"], [], "abc")


def test_user_agent_has_no_personal_data_and_filters_context():
    ua = common.user_agent("ci Open-Kirrberg/ort-homburg")
    assert "Open-Kirrberg/ort-homburg" in ua and common.PIPELINE_VERSION in ua and "@" not in ua
    assert "\n" not in common.user_agent("x\nInjected: 1") and "Injected" not in common.user_agent("x\nInjected: 1")


def test_dir_env_requires_absolute_paths():
    code = "import common"
    env = {**os.environ, "SLE_WORK_DIR": "relative/dir"}
    r = subprocess.run([sys.executable, "-c", code], cwd=PIPE, env=env, capture_output=True, text=True)
    assert r.returncode != 0 and "absolute" in r.stderr


# ------------------------------------------------------------------------------------------------ site checks
def test_scan_text_finds_uxo_terms_and_local_paths():
    assert place.scan_text("a.json", '{"class": "Crater_field"}')
    assert place.scan_text("a.json", "/Users/someone/x")
    assert place.scan_text("a.json", '{"class": "pit"}') == []


def test_check_manifest_rules():
    o = place.parse_ort(ORT)
    m = {"version": 3, "grid": GRID, "place": {"id": "homburg", "ags": "10045114"},
         "origin": {"E0": 376000, "N0": 5462000}, "size": {"width": 2000, "height": 2000}, "cellSize": 1,
         "presence": encode_bitmap(2, 2, [(0, 1), (1, 1)])}
    owned = {(376, 5462), (377, 5462)}
    assert place.check_manifest(m, o, owned, []) == []
    assert any("does not give" in p for p in place.check_manifest(m, o, {(376, 5462)}, []))
    assert any("ADR 0053" in p for p in place.check_manifest({**m, "candidates": {}}, o, owned, []))
    pc = {"pointclouds": {"areas": [{"id": "merburg"}]}}
    assert any("not opted in" in p for p in place.check_manifest({**m, **pc}, o, owned, []))


def test_stage_and_check_site(tmp_path):
    o = place.parse_ort(ORT)
    site, repo = tmp_path / "site", tmp_path / "repo"
    site.mkdir()
    (site / "manifest.json").write_text(json.dumps({"version": 3, "grid": GRID, "attribution": "A; B",
                                                    "place": {"id": "homburg", "ags": "10045114"},
                                                    "origin": {"E0": 376000, "N0": 5462000},
                                                    "size": {"width": 1000, "height": 1000}, "cellSize": 1}))
    (repo / "inhalte" / "orte").mkdir(parents=True)
    (repo / "inhalte" / "orte" / "a.geojson").write_text('{"type": "FeatureCollection", "features": []}')
    (repo / "inhalte" / "notiz.exe").write_text("x")
    counts = place.stage_site(o, site, repo)
    assert counts == {"inhalte": 1, "aktionen": 0}
    assert (site / "index.html").read_text().count("Schauen, nicht graben") == 1
    assert not (site / "inhalte" / "notiz.exe").exists()
    errors, _ = place.check_site(site, o, {(376, 5462)}, [])
    assert errors == []
    (site / "big.bin").write_bytes(b"\0" * 10)
    (site / "x.json").write_text('{"c": "Bombentrichter"}')
    errors, _ = place.check_site(site, o, {(376, 5462)}, [])
    assert any("UXO" in e for e in errors)


# ------------------------------------------------------------------------------------------------ katalog
def test_place_config_validation():
    ok = katalog.place_config({"places": {"homburg": {"status": "3d", "data_url": "https://open-kirrberg.github.io/ort-homburg/",
                                                      "maintainers": ["huhn511"], "relict_candidates": True}}})
    assert ok["homburg"]["status"] == "3d"
    for bad in ({"status": "3d"}, {"status": "3d", "data_url": "http://x/"}, {"status": "stats", "data_url": "https://x/"},
                {"status": "weird"}, {"status": "stats", "maintainers": ["a b"]}, {"status": "stats", "x": 1}):
        with pytest.raises(ValueError):
            katalog.place_config({"places": {"p": bad}})


def test_ortsteile_manifest_and_levels():
    ov = {"stats": {"format": "sle-stats-v1", "url": "stats/places.json", "geometry": "stats/places.geojson"},
          "attribution": "X"}
    m = katalog.ortsteile_manifest(ov, None)
    assert m["kind"] == "stats-only" and m["aoi"] == "ortsteile" and m["stats"]["url"] == "stats/places.json"
    assert [lv["aoi"] for lv in m["stats_levels"]["levels"]] == ["saarland", "ortsteile"]
    with pytest.raises(ValueError):
        katalog.with_levels({"kind": "tiles"})
    with pytest.raises(ValueError):
        katalog.ortsteile_manifest({}, None)


def test_same_ownership_and_safe_members():
    a = {(380, 5460): {"owner": "a"}, (381, 5460): {"owner": "b"}}
    b = {"380_5460": {"owner": "a"}, "381_5460": {"owner": "a"}}
    assert katalog.same_ownership(a, b) == ["381_5460"]
    assert katalog.safe_member("overview/overview.json")
    assert not katalog.safe_member("../x") and not katalog.safe_member("/etc/passwd")


def test_extract_bundle_rejects_links_and_bad_hash(tmp_path):
    tar = tmp_path / "b.tar"
    with tarfile.open(tar, "w") as tf:
        ti = tarfile.TarInfo("evil")
        ti.type = tarfile.SYMTYPE
        ti.linkname = "/etc/passwd"
        tf.addfile(ti)
    with pytest.raises(SystemExit, match="rejected"):
        katalog.extract_bundle(tar, tmp_path / "x", None)
    with pytest.raises(SystemExit, match="sha256"):
        katalog.extract_bundle(tar, tmp_path / "x", "0" * 64)
    good = tmp_path / "g.tar"
    data = json.dumps({"format": katalog.BUNDLE_FORMAT, "files": [{"path": "a.txt", "bytes": 1, "sha256": "0" * 64}]}).encode()
    with tarfile.open(good, "w") as tf:
        for name, payload in (("bundle.json", data), ("a.txt", b"x")):
            ti = tarfile.TarInfo(name)
            ti.size = len(payload)
            tf.addfile(ti, io.BytesIO(payload))
    with pytest.raises(SystemExit, match="does not match"):
        katalog.extract_bundle(good, tmp_path / "y", None)
