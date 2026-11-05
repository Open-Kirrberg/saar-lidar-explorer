import importlib.util
from pathlib import Path

from capture.common import REPO
from capture.twin import REFERENCE_ID, merge_manifest, reference_assets

CAPTURE = {
    "format": "sle-zone-v1", "id": "baeckerei-heusser", "kind": "captured", "name_de": "Alt", "summary_de": "alt",
    "crs": "EPSG:25832", "heightDatum": "DHHN2016", "origin": {"E0": 381467, "N0": 5462254},
    "footprint": [[381466.3, 5462258.6], [381465.6, 5462242.1], [381486.2, 5462259.0]],
    "portals": [{"id": "strasse", "label_de": "Bäckerei betreten", "E": 381467.78, "N": 5462241.81, "h": None, "radius_m": 40.0,
                 "facing_deg": 161.2, "spawn": "strasse"}],
    "spawns": {"strasse": {"E": 381467.78, "N": 5462241.81, "h": 245.11, "heading_deg": 341.2, "pitch_deg": -5, "mode": "gehen"}},
    "exit": {"rule": "restore"}, "runtime": {"kind": "gltf"},
    "assets": [{"id": "scene", "role": "scene", "bboxLocal": [[-1, 242, -12], [18, 247, 12]],
                "lods": [{"path": "scene/medium.glb", "until_m": 60, "bytes": 2000, "triangles": 90000},
                         {"path": "scene/reduced.glb", "until_m": None, "bytes": 1000, "triangles": 45000}]}],
    "preset": {"look": "natur", "sky": "shared", "trees": "none", "timeOfDay": "now"},
    "attribution": ["Aufnahme"], "evidence": {"kind": "capture", "confidence": "med", "perPart": "none", "sources_de": [], "disclaimer_de": "x"},
    "capture": {"date": "2026-11-04", "method": "photogrammetry-mesh", "georef": {"method": "lod2-walls+dgm1", "controlPoints": 1, "rmsError_m": 0.16},
                "privacy": "blurred", "scale": {"factor": 1.04, "pivotLocal": [8.39, 243.51, -4.97], "metresPerUnit": 1.4595}},
    "budget": {"downloadBytes": 1000, "totalBytes": 3000, "triangles": 90000, "textureBytesGpu": 18000000},
}
FRAG = {
    "assets": [{"id": "twin", "role": "scene", "raw": "twin.glb", "bboxLocal": [[-32, 239, -40], [44, 260, 36]], "triangles": 24000},
               {"id": "nav", "role": "collider", "raw": "nav.glb", "bboxLocal": [[-4, 242, -26], [24, 246, 21]], "triangles": 2000}],
    # as shipped by zones/baeckerei-heusser/build (SPAWN_B = frame B (23.0, -7.0), SPAWN_PITCH = -4)
    "spawn": {"E": 381480.98, "N": 5462254.44, "h": 245.25, "heading_deg": 295.7, "pitch_deg": -4, "mode": "gehen"},
    "portal": {"E": 381480.98, "N": 5462254.44, "facing_deg": 115.7},
    "footprint": [[381500.0, 5462250.0], [381460.0, 5462290.0], [381430.0, 5462230.0]],
    "twin": {"method": "built-from-plan", "plan": "sle-raumplan/0.1", "planVersion": "v0", "catalogue": "bh-catalogue-v1",
             "scaleFactor": 1.04, "nav": "nav"},
    "pivotLocal": [8.39, 244.25, -4.97],
}
PKG = {"scale_factor": 1.04, "portal_label_de": "Bäckerei betreten", "portal_radius_m": 40,
       "twin": {"name_de": "Bäckerei Heusser", "summary_de": "Nachbau", "disclaimer_de": "Nachbau, kein Foto", "confidence": "med",
                "sources_de": ["Raumplan v0"], "attribution": ["Nachbau, eigenes Werk", "LoD2 © GeoBasis-DE/LVGL-SL"]}}
PACKED = {"twin": {"path": "built/twin.glb", "bytes": 500000, "triangles": 24000},
          "nav": {"path": "built/nav.glb", "bytes": 40000, "triangles": 2000}}


def _validator():
    spec = importlib.util.spec_from_file_location("sle_zones_validator", REPO / "pipeline" / "zones.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_merge_manifest_twin_first_capture_as_reference():
    m = merge_manifest(CAPTURE, FRAG, PKG, PACKED)
    assert [(a["id"], a["role"]) for a in m["assets"]] == [("twin", "scene"), ("nav", "collider"), (REFERENCE_ID, "reference")]
    assert m["assets"][0]["lods"] == [{"path": "built/twin.glb", "until_m": None, "bytes": 500000, "triangles": 24000}]
    assert m["assets"][2]["lods"] == CAPTURE["assets"][0]["lods"]
    # true scale: the runtime must not scale the twin; the capture's factor moves to twin.referenceScale
    assert m["capture"]["scale"]["factor"] == 1.0 and m["capture"]["scale"]["metresPerUnit"] == 1.4595
    assert m["twin"]["referenceScale"] == {"factor": 1.04, "pivotLocal": [8.39, 243.51, -4.97]}
    assert m["twin"]["nav"] == "nav" and m["evidence"]["perPart"] == "extras"
    assert m["spawns"]["strasse"] == FRAG["spawn"] and m["footprint"] == FRAG["footprint"]
    assert m["portals"][0]["facing_deg"] == 115.7 and m["portals"][0]["spawn"] == "strasse"
    assert m["name_de"] == "Bäckerei Heusser" and m["attribution"] == PKG["twin"]["attribution"]
    # budget: first view = twin + nav (reference excluded), no textures drawn
    assert m["budget"] == {"downloadBytes": 540000, "totalBytes": 0, "triangles": 24000, "textureBytesGpu": 0}
    assert CAPTURE["assets"][0]["role"] == "scene"  # input untouched
    m["budget"]["totalBytes"] = 3_600_000
    assert _validator().validate_manifest(m) == []


def test_merge_is_idempotent():
    once = merge_manifest(CAPTURE, FRAG, PKG, PACKED)
    twice = merge_manifest(once, FRAG, PKG, PACKED)
    assert [a["id"] for a in twice["assets"]] == ["twin", "nav", REFERENCE_ID]
    assert twice["twin"] == once["twin"] and twice["capture"] == once["capture"]


def test_reference_assets_drops_built_and_keeps_references():
    built = {"id": "twin", "role": "scene", "lods": [{"path": "built/twin.glb"}]}
    ref = {"id": "referenz", "role": "reference", "lods": [{"path": "scene/reduced.glb"}]}
    col = {"id": "c", "role": "collider", "lods": [{"path": "scene/c.glb"}]}
    assert reference_assets([built, ref, col]) == [ref]
    assert reference_assets([{"id": "scene", "role": "scene", "lods": [{"path": "scene/a.glb"}]}])[0]["id"] == REFERENCE_ID


def test_serve_reference_false_drops_the_capture():
    pkg = {**PKG, "twin": {**PKG["twin"], "serve_reference": False}}
    m = merge_manifest(CAPTURE, FRAG, pkg, PACKED)
    assert [a["id"] for a in m["assets"]] == ["twin", "nav"]
    assert "referenceScale" not in m["twin"] and m["capture"]["scale"]["factor"] == 1.0
    assert not any("scene/" in l["path"] for a in m["assets"] for l in a["lods"])
    # also from an earlier package that still carried the reference
    again = merge_manifest(merge_manifest(CAPTURE, FRAG, PKG, PACKED), FRAG, pkg, PACKED)
    assert [a["id"] for a in again["assets"]] == ["twin", "nav"] and "referenceScale" not in again["twin"]
    m["budget"]["totalBytes"] = 600_000
    assert _validator().validate_manifest(m) == []
