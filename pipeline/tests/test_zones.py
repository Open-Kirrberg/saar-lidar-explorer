"""V2.6: producer validator for zone packages (docs/zone-contract.md). Shares the fixture with app/tests/zones.test.ts."""
from __future__ import annotations

import copy
import json
import struct
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import zones as Z  # noqa: E402

FIXTURE = Path(__file__).resolve().parents[2] / "app/tests/fixtures/zones/fixture/zone.json"


def fixture() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def write_glb(path: Path, required: list[str]) -> None:
    doc = json.dumps({"asset": {"version": "2.0"}, "extensionsRequired": required}).encode()
    doc += b" " * (-len(doc) % 4)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(doc)) + struct.pack("<I4s", len(doc), b"JSON") + doc)


def test_fixture_is_valid():
    assert Z.validate_manifest(fixture()) == []


@pytest.mark.parametrize(
    "mutate, expected",
    [
        (lambda m: m.update(format="sle-zone-v2"), "format must be sle-zone-v1"),
        (lambda m: m.update(crs="EPSG:4326"), "crs must be EPSG:25832"),
        (lambda m: m.update(id="Bad Id"), "invalid id"),
        (lambda m: m.update(footprint=[[382580, 5466580], [382640, 5466620], [382640, 5466580], [382580, 5466600]]), "footprint: self-intersecting"),
        (lambda m: m["portals"][0].update(spawn="nirgends"), "portals[0]: unknown spawn"),
        (lambda m: m["portals"][0].update(radius_m=5000), "portals[0]: radius_m must be 1-2000"),
        (lambda m: m["portals"][0].update(facing_deg=360), "portals[0]: facing_deg must be in [0, 360)"),
        (lambda m: m.update(runtime={"kind": "iframe"}), "invalid runtime"),
        (lambda m: m["assets"][0]["lods"][0].update(path="../escape.glb"), "assets[0].lods[0]: invalid path"),
        (lambda m: m["assets"][0]["lods"][1].update(until_m=99), "assets[0].lods[1]: until_m must increase and be null on the last level"),
        (lambda m: m.update(attribution=["A; B"]), 'attribution: >= 1 entry, strings without ";"'),
        (lambda m: m["evidence"].update(kind="capture"), "evidence.kind must be hypothesis for kind reconstructed"),
        (lambda m: m.update(kind="captured", evidence={**m["evidence"], "kind": "capture"}), "capture: invalid (date, method, georef{method, controlPoints, rmsError_m}, privacy)"),
        (lambda m: m["budget"].update(triangles=2_000_000), "budget.triangles 2000000 > 1500000"),
        (lambda m: m["budget"].update(downloadBytes=10), "coarsest LODs (20000 B) exceed budget.downloadBytes"),
    ],
)
def test_violations(mutate, expected):
    m = copy.deepcopy(fixture())
    mutate(m)
    assert expected in Z.validate_manifest(m)


def test_module_registry():
    m = fixture()
    m["runtime"] = {"kind": "module", "module": "schloss-karlsberg"}
    assert Z.validate_manifest(m) == []
    assert Z.validate_manifest(m, modules={"other-module"}) == ["zone module schloss-karlsberg not registered"]


def test_package_files(tmp_path: Path):
    d = tmp_path / "fixture"
    d.mkdir()
    m = fixture()
    for a in m["assets"]:
        for lod in a["lods"]:
            write_glb(d / lod["path"], ["EXT_meshopt_compression", "KHR_mesh_quantization"])
            lod["bytes"] = (d / lod["path"]).stat().st_size
    m["budget"]["downloadBytes"] = 10_000
    (d / "zone.json").write_text(json.dumps(m), encoding="utf-8")
    assert Z.validate_package(d) == []

    write_glb(d / "huette/lod1.glb", ["KHR_draco_mesh_compression"])
    (d / "huette/collider.glb").unlink()
    errs = Z.validate_package(d)
    assert "huette/lod1.glb: extensions not allowed: KHR_draco_mesh_compression" in errs
    assert "huette/collider.glb: missing" in errs
    assert any(e.startswith("huette/lod1.glb: bytes ") for e in errs)

    other = tmp_path / "other"
    other.mkdir()
    (other / "zone.json").write_text(json.dumps(m), encoding="utf-8")
    assert "folder name other != id fixture" in Z.validate_package(other)


def test_safe_path():
    assert Z.safe_path("a/b.glb")
    for p in ("../a.glb", "/a.glb", "a//b.glb", "https://x/a.glb", "./a.glb", ""):
        assert not Z.safe_path(p)


def _captured(scale) -> dict:
    m = copy.deepcopy(fixture())
    m["kind"] = "captured"
    m["evidence"]["kind"] = "capture"
    m["capture"] = {"date": "2026-11-04", "method": "photogrammetry-mesh",
                    "georef": {"method": "lod2-walls+dgm1", "controlPoints": 1, "rmsError_m": 0.16}, "privacy": "blurred"}
    if scale is not None:
        m["capture"]["scale"] = scale
    return m


def test_capture_scale():
    assert Z.validate_manifest(_captured(None)) == []
    assert Z.validate_manifest(_captured({"factor": 1.04, "pivotLocal": [8.4, 243.5, -5.0], "source": "measured"})) == []
    bad = "capture.scale: invalid (factor 0.5-2, pivotLocal [x, y, z])"
    assert bad in Z.validate_manifest(_captured({"factor": 3, "pivotLocal": [0, 0, 0]}))
    assert bad in Z.validate_manifest(_captured({"factor": 1, "pivotLocal": [0, 0]}))


def _twin(**over) -> dict:
    """A built twin (ADR 0042): twin scene + nav collider + the capture as hidden reference, `twin` block."""
    m = _captured({"factor": 1.0, "pivotLocal": [8.39, 243.51, -4.97]})
    scene = m["assets"][0]
    m["assets"] = [
        {**scene, "id": "twin"},
        {"id": "nav", "role": "collider", "lods": [{"path": "built/nav.glb", "until_m": None, "bytes": 10, "triangles": 2}]},
        {**scene, "id": "referenz", "role": "reference"},
    ]
    m["evidence"]["perPart"] = "extras"
    m["twin"] = {"method": "built-from-plan", "plan": "sle-raumplan/0.1", "planVersion": "v0", "catalogue": "bh-catalogue-v1",
                 "scaleFactor": 1.0, "nav": "nav", "referenceScale": {"factor": 1.04, "pivotLocal": [8.39, 243.51, -4.97]}}
    m["twin"].update(over)
    return m


def test_built_twin():
    assert Z.validate_manifest(_twin()) == []
    m = _twin()
    del m["twin"]  # a reference asset is valid without the twin block too (forward compatible)
    assert Z.validate_manifest(m) == []
    assert "twin.nav must name a collider asset" in Z.validate_manifest(_twin(nav="referenz"))
    assert any(e.startswith("twin: invalid") for e in Z.validate_manifest(_twin(scaleFactor=3)))
    assert any(e.startswith("twin.referenceScale") for e in Z.validate_manifest(_twin(referenceScale={"factor": 1})))
    m = _twin()
    m["capture"]["scale"]["factor"] = 1.04  # the twin is true scale: the reference factor lives in twin.referenceScale
    assert any("capture.scale.factor must be 1" in e for e in Z.validate_manifest(m))
    m = _twin()
    m["kind"], m["evidence"]["kind"] = "reconstructed", "hypothesis"
    del m["capture"]
    assert "twin: an object, only for captured zones" in Z.validate_manifest(m)
    m = _twin()
    m["assets"][1]["role"] = "splat"
    assert any(e.endswith("unknown role") for e in Z.validate_manifest(m))


def _catalogue() -> dict:
    return {"schema": "sle-zone-catalogue-v1", "consent": {"prices": True},
            "objects": {"theke": {"name_de": "Verkaufstheke", "info_de": "Hier wird bedient."},
                        "theke/kasse": {"name_de": "Kasse", "info_de": "Hier bezahlst du.", "group": "theke"}},
            "products": {"brezel": {"name_de": "Brezel", "short_de": "", "info_de": "", "category": "snacks", "price_eur": 1.0,
                                    "sale_unit": "Stück"}},
            "discoverable": ["brezel", "theke"]}


def test_twin_catalogue_file():
    assert Z.validate_manifest(_twin(catalogue="built/catalogue.json")) == []
    assert Z.validate_manifest(_twin(catalogue="bh-catalogue-v1")) == []          # old packages: a format name
    assert any(e.startswith("twin.catalogue") for e in Z.validate_manifest(_twin(catalogue="../x.json")))
    assert Z.validate_catalogue(_catalogue()) == []
    c = _catalogue()
    c["consent"]["prices"] = False
    assert any("price_eur" in e for e in Z.validate_catalogue(c))
    c = _catalogue()
    c["objects"]["theke/kasse"]["group"] = "brotregal"
    assert any("group" in e for e in Z.validate_catalogue(c))
    c = _catalogue()
    c["discoverable"].append("unbekannt")
    assert any("discoverable" in e for e in Z.validate_catalogue(c))
    assert Z.validate_catalogue({"objects": {}})[0].startswith("catalogue: schema")


def _with_fills_and_tour() -> dict:
    c = _catalogue()
    c["fills"] = {"default": "morgens", "states": [
        {"id": "morgens", "name_de": "Morgens", "info_de": "Kurz nach dem Öffnen.", "products": ["brezel"]},
        {"id": "feierabend", "name_de": "Feierabend", "info_de": "Nach Ladenschluss.", "products": []}]}
    c["tour"] = {"name_de": "Kleine Führung", "stops": [
        {"id": "theke", "title_de": "Die Theke", "text_de": "Hier wird bedient.", "target": "theke",
         "eye": [6.0, 245.9, -0.6], "look": [3.9, 245.0, -1.8], "via": [[8.4, -4.15], [6.1, -4.15]]},
        {"id": "kasse", "title_de": "Die Kasse", "text_de": "Hier bezahlst du.", "eye": [5.6, 245.9, -1.0],
         "look": [2.3, 245.7, -1.1]}]}
    return c


def test_catalogue_fills_and_tour_blocks():
    assert Z.validate_catalogue(_with_fills_and_tour()) == []
    c = _with_fills_and_tour()
    c["tour"]["stops"][1]["target"] = None                                    # no highlight: fine
    assert Z.validate_catalogue(c) == []


@pytest.mark.parametrize("patch, msg", [
    (lambda c: c["fills"]["states"].pop(), "fills needs"),
    (lambda c: c["fills"].update(default="mittags"), "fills.default"),
    (lambda c: c["fills"]["states"][1].update(id="morgens"), "unique"),
    (lambda c: c["fills"]["states"][0].update(id="Morgens!"), "a-z0-9-"),
    (lambda c: c["fills"]["states"][0]["products"].append("unbekannt"), "products = unique ids"),
    (lambda c: c["fills"]["states"][0].update(name_de=""), "name_de 1–40"),
    (lambda c: c.update(fills=[]), "fills needs"),
    (lambda c: c["tour"].update(stops=c["tour"]["stops"][:1]), "tour needs 2–12"),
    (lambda c: c["tour"].update(name_de=""), "tour.name_de"),
    (lambda c: c["tour"]["stops"][1].update(id="theke"), "unique"),
    (lambda c: c["tour"]["stops"][0].update(target="hinterhof"), "target"),
    (lambda c: c["tour"]["stops"][0].update(eye=[381467.0, 245.0, -5462254.0]), "zone frame"),
    (lambda c: c["tour"]["stops"][0].update(look=[6.0, 245.9, -0.6]), "different"),
    (lambda c: c["tour"]["stops"][0].update(via=[[0, 0]] * 5), "via"),
    (lambda c: c["tour"]["stops"][0].update(via=[[0, 0, 0]]), "via"),
    (lambda c: c["tour"]["stops"][0].update(text_de="x" * 301), "text_de"),
])
def test_broken_fills_and_tour_blocks(patch, msg):
    c = _with_fills_and_tour()
    patch(c)
    errs = Z.validate_catalogue(c)
    assert any(msg in e for e in errs), errs
