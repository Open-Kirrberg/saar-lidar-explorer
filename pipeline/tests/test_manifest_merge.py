"""Unit tests for the manifest read–modify–write helpers in common.py (roadmap R0.8)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import (  # noqa: E402
    ATTRIBUTION_RLP, ATTRIBUTION_SL, merge_attribution, merge_manifest, update_manifest,
)

OSM = "© OpenStreetMap-Mitwirkende (ODbL)"


def test_merge_attribution_dedupes_and_keeps_order():
    assert merge_attribution(None, [ATTRIBUTION_SL]) == ATTRIBUTION_SL
    assert merge_attribution(f"{ATTRIBUTION_SL}; {OSM}", [ATTRIBUTION_SL, ATTRIBUTION_RLP]) == \
        f"{ATTRIBUTION_SL}; {OSM}; {ATTRIBUTION_RLP}"
    assert merge_attribution(f" {OSM} ;; {OSM}", [f" {OSM}"]) == OSM


def test_merge_attribution_drop_retracts_owned_entries_but_add_wins():
    existing = f"{ATTRIBUTION_SL}; {OSM}; {ATTRIBUTION_RLP}"
    drop = [ATTRIBUTION_SL, ATTRIBUTION_RLP]
    assert merge_attribution(existing, [ATTRIBUTION_SL], drop) == f"{ATTRIBUTION_SL}; {OSM}"
    assert merge_attribution(existing, [], drop) == OSM


def test_merge_manifest_keeps_unknown_keys_and_order():
    existing = {"version": 1, "layers": {"vat": 1}, "xyz": {"vat": {}}, "vectors": {"osm": {"path": "x"}},
                "attribution": f"{ATTRIBUTION_SL}; {OSM}", "build": {"old": True}, "candidates": {"path": "c"}}
    out = merge_manifest(existing, {"version": 1, "layers": {"vat": 2}, "build": {"new": True}, "levels": []},
                         attribution=[ATTRIBUTION_SL], drop_attribution=[ATTRIBUTION_SL, ATTRIBUTION_RLP])
    assert list(out) == ["version", "layers", "xyz", "vectors", "attribution", "build", "candidates", "levels"]
    assert out["layers"] == {"vat": 2} and out["build"] == {"new": True}
    assert out["xyz"] == {"vat": {}} and out["vectors"] == existing["vectors"] and out["candidates"] == {"path": "c"}
    assert out["attribution"] == f"{ATTRIBUTION_SL}; {OSM}"
    assert existing["layers"] == {"vat": 1}, "input must not be mutated"


def test_merge_manifest_remove_and_no_attribution_patch():
    out = merge_manifest({"xyz": {}, "a": 1}, {"b": 2}, remove=["xyz"])
    assert out == {"a": 1, "b": 2}
    with pytest.raises(ValueError):
        merge_manifest({}, {"attribution": "x"})


def test_merge_manifest_shared_section_shallow_merge():
    existing = {"vectors": {"osm": {"path": "vectors/osm.geojson"}}}
    patch = {"vectors": {"flurstuecke": {"path": "vectors/flurstuecke.geojson"}}}
    out = merge_manifest(existing, patch, merge=["vectors"])
    assert list(out["vectors"]) == ["osm", "flurstuecke"]
    assert merge_manifest(existing, patch)["vectors"] == patch["vectors"], "without merge= the section is replaced"
    assert merge_manifest({}, patch, merge=["vectors"])["vectors"] == patch["vectors"]


def test_update_manifest_round_trip(tmp_path: Path):
    """build → osm-like step → rebuild must keep the other step's key and attribution."""
    build_patch = {"version": 1, "aoi": "t", "layers": {}, "build": {"run": 1}}
    update_manifest(tmp_path, build_patch, attribution=[ATTRIBUTION_SL], drop_attribution=[ATTRIBUTION_RLP])
    update_manifest(tmp_path, {"vectors": {"osm": {"path": "vectors/osm.geojson"}}}, attribution=[OSM])
    update_manifest(tmp_path, {**build_patch, "build": {"run": 2}}, attribution=[ATTRIBUTION_SL, ATTRIBUTION_RLP],
                    drop_attribution=[ATTRIBUTION_SL, ATTRIBUTION_RLP])
    m = json.loads((tmp_path / "manifest.json").read_text())
    assert m["vectors"] == {"osm": {"path": "vectors/osm.geojson"}}
    assert m["build"] == {"run": 2}
    assert m["attribution"] == f"{ATTRIBUTION_SL}; {OSM}; {ATTRIBUTION_RLP}"
    assert not (tmp_path / "manifest.json.tmp").exists()


def _rebuild_patch():
    """What build.py patches: its own relief layers, levels 0…2 without foreign layers."""
    vat = {"path": "relief/vat/{i}_{j}.png", "encoding": "u8", "min": 0.0, "max": 1.0}
    lay0 = {"vat": vat, "hillshade": {**vat, "path": "relief/hillshade/{i}_{j}.png"}}
    return {"version": 2, "layers": lay0, "levels": [
        {"level": 0, "cellSize": 1, "layers": lay0},
        {"level": 1, "cellSize": 2, "layers": {"vat": {**vat, "path": "levels/1/vat/{i}_{j}.png"}}},
        {"level": 2, "cellSize": 4, "layers": {"vat": {**vat, "path": "levels/2/vat/{i}_{j}.png"}}},
    ]}


def test_build_rerun_keeps_foreign_layers_and_level_layers(tmp_path):
    """F11/F13/F14: re-running build must keep bldg/ortho/hist_* in `layers` and `levels[k].layers`."""
    bldg = {"path": "relief/bldg/{i}_{j}.png", "encoding": "u8", "min": 0, "max": 1}
    ortho = {"path": "ortho/{i}_{j}.webp", "encoding": "rgb", "kind": "image"}
    hist = {"path": "hist_1840/{i}_{j}.jpg", "encoding": "rgb", "kind": "image"}
    old_vat = {"path": "relief/vat/{i}_{j}.png", "encoding": "u8", "min": 0.0, "max": 0.9}
    existing = {
        "version": 2, "models": {"buildings": {"path": "models/buildings/{i}_{j}.glb"}},
        "layers": {"vat": old_vat, "chm": {"path": "relief/chm/{i}_{j}.png"}, "bldg": bldg, "ortho": ortho,
                   "hist_1840": hist},
        "levels": [
            {"level": 0, "cellSize": 1, "layers": {"vat": old_vat, "bldg": bldg, "ortho": ortho, "hist_1840": hist}},
            {"level": 1, "cellSize": 2, "layers": {"vat": old_vat, "ortho": {**ortho, "path": "ortho/levels/1/{i}_{j}.webp"},
                                                   "hist_1840": {**hist, "path": "hist_1840/levels/1/{i}_{j}.jpg"}}},
            {"level": 2, "cellSize": 8, "layers": {"ortho": {**ortho, "path": "ortho/levels/2/x.webp"}}},  # other grid
            {"level": 3, "cellSize": 8, "layers": {"ortho": ortho}},
        ],
    }
    (tmp_path / "manifest.json").write_text(json.dumps(existing))
    own = ["vat", "hillshade", "chm", "mask"]
    m = update_manifest(tmp_path, _rebuild_patch(), own_layers=own)
    assert m == json.loads((tmp_path / "manifest.json").read_text())
    # own keys come from the patch (new vat range); an own key build no longer produces (chm) is dropped
    assert m["layers"]["vat"]["max"] == 1.0 and "chm" not in m["layers"]
    assert {"bldg", "ortho", "hist_1840", "vat", "hillshade"} == set(m["layers"])
    assert {"bldg", "ortho", "hist_1840", "vat", "hillshade"} == set(m["levels"][0]["layers"])
    assert m["levels"][1]["layers"]["ortho"]["path"] == "ortho/levels/1/{i}_{j}.webp"
    assert m["levels"][1]["layers"]["hist_1840"]["path"] == "hist_1840/levels/1/{i}_{j}.jpg"
    assert m["levels"][1]["layers"]["vat"]["path"] == "levels/1/vat/{i}_{j}.png"
    assert set(m["levels"][2]["layers"]) == {"vat"}  # cellSize changed → foreign coarse image not attached
    assert len(m["levels"]) == 3  # levels the rebuild no longer writes are gone
    assert m["models"] == existing["models"]


def test_without_own_layers_layers_are_replaced_whole():
    existing = {"layers": {"ortho": {"path": "o"}}}
    assert merge_manifest(existing, {"layers": {"vat": {"path": "v"}}})["layers"] == {"vat": {"path": "v"}}


def test_legacy_rlp_year_is_replaced_in_place(tmp_path):
    """ADR 0026: the RLP entry carries the retrieval year 2026; old manifests with (2022) heal on any write."""
    from common import LEGACY_ATTRIBUTION
    old = next(iter(LEGACY_ATTRIBUTION))
    assert "(2022)" in old and "(2026)" in ATTRIBUTION_RLP
    assert merge_attribution(f"{ATTRIBUTION_SL}; {old}; {OSM}") == f"{ATTRIBUTION_SL}; {ATTRIBUTION_RLP}; {OSM}"
    # no duplicate when a step adds the new string while the old one is still there
    assert merge_attribution(f"{old}; {OSM}", [ATTRIBUTION_RLP]) == f"{ATTRIBUTION_RLP}; {OSM}"
    (tmp_path / "manifest.json").write_text(json.dumps({"aoi": "x", "keep": 1, "attribution": f"{ATTRIBUTION_SL}; {old}"}))
    m = update_manifest(tmp_path, {})
    assert m["attribution"] == f"{ATTRIBUTION_SL}; {ATTRIBUTION_RLP}" and m["keep"] == 1
