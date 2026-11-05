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
