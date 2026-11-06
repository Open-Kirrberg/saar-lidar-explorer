"""Release export of zone packages (scripts/release/export_data.py, RELEASING.md §2, ADR 0043).

Only cleared zones are staged, only zone.json + the files its manifest references under the cleared
prefixes (bakery: built/) or, for the castle module zone, exactly the files its module fetches (terrain/ +
the Poly Haven CC0 texture JPEGs, ADR 0048); `reference` assets (the capture) are dropped, scene/ never
staged, and the public zones/index.json lists only staged zones. Synthetic packages in tmp dirs; nothing
is exported.
"""
from __future__ import annotations

import copy
import importlib.util
import json
import struct
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("export_data", ROOT / "scripts" / "release" / "export_data.py")
export_data = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(export_data)

ZID = "baeckerei-heusser"  # the policy entry under test; geometry below is synthetic
E0, N0 = 381000, 5462000


def _glb(doc: dict | None = None) -> bytes:
    j = json.dumps(doc or {"asset": {"version": "2.0"}, "nodes": [{"name": "theke", "extras": {"id": "theke"}}]}).encode()
    j += b" " * (-len(j) % 4)
    return b"glTF" + struct.pack("<II", 2, 20 + len(j)) + struct.pack("<I4s", len(j), b"JSON") + j


def _lod(path: str, data: bytes) -> dict:
    return {"path": path, "until_m": None, "bytes": len(data), "triangles": 12}


def _manifest(files: dict, reference: bool = True) -> dict:
    assets = [
        {"id": "twin", "role": "scene", "lods": [_lod("built/twin.glb", files["built/twin.glb"])]},
        {"id": "nav", "role": "collider", "lods": [_lod("built/nav.glb", files["built/nav.glb"])]},
    ]
    if reference:
        assets.append({"id": "referenz", "role": "reference", "lods": [_lod("scene/lod0.glb", files["scene/lod0.glb"])]})
    twin = {"method": "built-from-plan", "plan": "sle-raumplan/0.1", "planVersion": "v0", "catalogue": "built/catalogue.json",
            "scaleFactor": 1.0, "nav": "nav"}
    if reference:
        twin["referenceScale"] = {"factor": 1.1, "pivotLocal": [1.0, 2.0, 3.0]}
    return {
        "format": "sle-zone-v1", "id": ZID, "kind": "captured", "name_de": "Testladen", "summary_de": "Synthetisch.",
        "crs": "EPSG:25832", "heightDatum": "DHHN2016", "origin": {"E0": E0, "N0": N0},
        "footprint": [[E0 - 20, N0 - 20], [E0 + 20, N0 - 20], [E0 + 20, N0 + 20], [E0 - 20, N0 + 20]],
        "portals": [{"id": "strasse", "label_de": "Betreten", "E": E0 + 5, "N": N0, "h": None, "radius_m": 40,
                     "facing_deg": 90, "spawn": "strasse"}],
        "spawns": {"strasse": {"E": E0 + 5, "N": N0, "h": 245.0, "heading_deg": 270, "pitch_deg": -4, "mode": "gehen"}},
        "exit": {"rule": "restore"}, "runtime": {"kind": "gltf"}, "assets": assets,
        "preset": {"look": "natur", "sky": "shared", "trees": "none", "timeOfDay": "now"},
        "attribution": ["Synthetischer Testladen, eigenes Werk"],
        "evidence": {"kind": "capture", "confidence": "med", "perPart": "extras", "sources_de": ["Test"], "disclaimer_de": "Test."},
        "capture": {"date": "2026-11-04", "method": "photogrammetry-mesh",
                    "georef": {"method": "lod2-walls+dgm1", "controlPoints": 1, "rmsError_m": 0.2}, "privacy": "Test",
                    "scale": {"factor": 1.0, "pivotLocal": [0.0, 0.0, 0.0]}},
        "budget": {"downloadBytes": 999_999, "totalBytes": 9_999_999, "triangles": 24, "textureBytesGpu": 0},
        "twin": twin,
    }


CATALOGUE = {"schema": "sle-zone-catalogue-v1", "consent": {"prices": True},
             "objects": {"theke": {"name_de": "Theke", "info_de": "Die Theke."}},
             "products": {"brot": {"name_de": "Brot", "price_eur": 2.5}}, "discoverable": ["theke", "brot"]}


def _src(tmp_path: Path, reference: bool = True, catalogue: dict | None = None, twin_doc: dict | None = None) -> Path:
    zsrc = tmp_path / "zones"
    zdir = zsrc / ZID
    files = {
        "built/twin.glb": _glb(twin_doc),
        "built/nav.glb": _glb({"asset": {"version": "2.0"}, "nodes": [{"name": "nav/floor"}]}),
        "built/catalogue.json": json.dumps(catalogue or CATALOGUE, ensure_ascii=False).encode(),
        "built/stray-notes.txt": b"not referenced by zone.json",
        "scene/lod0.glb": _glb({"asset": {"version": "2.0"}, "images": [{"uri": "atlas.jpg"}]}),
        "scene/atlas.ktx2": b"capture texture",
    }
    for rel, data in files.items():
        (zdir / rel).parent.mkdir(parents=True, exist_ok=True)
        (zdir / rel).write_bytes(data)
    (zdir / "zone.json").write_text(json.dumps(_manifest(files, reference), indent=1), encoding="utf-8")
    castle = zsrc / "schloss-karlsberg"
    castle.mkdir(parents=True)
    (castle / "zone.json").write_text("{}", encoding="utf-8")
    (zsrc / "index.json").write_text(json.dumps({"format": "sle-zones-v1", "zones": [
        {"id": "schloss-karlsberg", "bboxEN": [[381240, 5464575], [383295, 5467070]]},
        {"id": ZID, "bboxEN": [[E0 - 20, N0 - 20], [E0 + 20, N0 + 20]]},
    ]}), encoding="utf-8")
    return zsrc


def test_validator_accepts_the_synthetic_manifest(tmp_path):
    zsrc = _src(tmp_path)
    zv = export_data._load_zone_validator()
    assert zv.validate_manifest(json.loads((zsrc / ZID / "zone.json").read_text())) == []


def test_stages_zone_json_and_built_only_and_drops_reference(tmp_path):
    zsrc = _src(tmp_path)
    plan: dict = {}
    staged = export_data.plan_zones(zsrc, [ZID], plan)
    assert sorted(plan) == [f"zones/{ZID}/built/catalogue.json", f"zones/{ZID}/built/nav.glb", f"zones/{ZID}/built/twin.glb",
                            f"zones/{ZID}/zone.json", "zones/index.json"]
    m = json.loads(plan[f"zones/{ZID}/zone.json"])
    assert [a["role"] for a in m["assets"]] == ["scene", "collider"]
    assert "referenceScale" not in m["twin"]
    assert "reference" not in plan[f"zones/{ZID}/zone.json"].decode() and "scene/" not in plan[f"zones/{ZID}/zone.json"].decode()
    built = sum((zsrc / ZID / p).stat().st_size for p in ("built/twin.glb", "built/nav.glb", "built/catalogue.json"))
    assert m["budget"]["totalBytes"] == built
    assert export_data._load_zone_validator().validate_manifest(m) == []
    # the public index lists only staged zones (the castle package is not published as a zone)
    idx = json.loads(plan["zones/index.json"])
    assert idx == {"format": "sle-zones-v1", "zones": [{"id": ZID, "bboxEN": [[E0 - 20, N0 - 20], [E0 + 20, N0 + 20]]}]}
    assert staged[0]["referenceDropped"] == 1
    assert set(staged[0]["skipped"]) == {"built/stray-notes.txt", "scene/atlas.ktx2", "scene/lod0.glb"}


def test_package_without_reference_is_staged_byte_identical(tmp_path):
    zsrc = _src(tmp_path, reference=False)
    plan: dict = {}
    export_data.plan_zones(zsrc, [ZID], plan)
    assert plan[f"zones/{ZID}/zone.json"] == zsrc / ZID / "zone.json"


def test_no_zones_plans_nothing(tmp_path):
    plan: dict = {}
    assert export_data.plan_zones(_src(tmp_path), [], plan) == [] and plan == {}


def test_refuses_uncleared_zone(tmp_path):
    with pytest.raises(SystemExit, match="not cleared"):
        export_data.plan_zones(_src(tmp_path), ["testraum"], {})


def test_refuses_public_asset_outside_built(tmp_path):
    zsrc = _src(tmp_path)
    zf = zsrc / ZID / "zone.json"
    m = json.loads(zf.read_text())
    m["assets"][0]["lods"][0]["path"] = "scene/lod0.glb"  # the capture as the visible scene
    m["assets"][0]["lods"][0]["bytes"] = (zsrc / ZID / "scene/lod0.glb").stat().st_size
    zf.write_text(json.dumps(m))
    with pytest.raises(SystemExit, match="outside the public prefixes"):
        export_data.plan_zones(zsrc, [ZID], {})


@pytest.mark.parametrize("leak", ["/Users/someone/x.jpg", "../baeckerei-heusser-privat/fotos", "kontakt@example.org"])
def test_refuses_private_paths_and_emails(tmp_path, leak):
    cat = copy.deepcopy(CATALOGUE)
    cat["objects"]["theke"]["info_de"] = f"Die Theke {leak}"
    with pytest.raises(SystemExit, match="refusing to stage"):
        export_data.plan_zones(_src(tmp_path, catalogue=cat), [ZID], {})


def test_refuses_private_path_in_glb_extras(tmp_path):
    doc = {"asset": {"version": "2.0"}, "nodes": [{"name": "theke", "extras": {"refs": ["C:\\Users\\x\\IMG_1.jpg"]}}]}
    with pytest.raises(SystemExit, match="refusing to stage"):
        export_data.plan_zones(_src(tmp_path, twin_doc=doc), [ZID], {})


def test_refuses_embedded_images_in_the_twin(tmp_path):
    doc = {"asset": {"version": "2.0"}, "images": [{"mimeType": "image/jpeg", "bufferView": 0}], "nodes": []}
    with pytest.raises(SystemExit, match="embedded image"):
        export_data.plan_zones(_src(tmp_path, twin_doc=doc), [ZID], {})


def test_scoped_sync_touches_only_zones(tmp_path):
    out = tmp_path / "out"
    (out / "overall").mkdir(parents=True)
    (out / "overall" / "manifest.json").write_text("pending")
    (out / "zones" / "old-zone").mkdir(parents=True)
    (out / "zones" / "old-zone" / "zone.json").write_text("{}")
    plan: dict = {}
    export_data.plan_zones(_src(tmp_path), [ZID], plan)
    plan["README.md"] = b"would be outside the scope"
    changes: list = []
    c, u, d = export_data.sync(plan, out, scope="zones/", dry_run=True, changes=changes)
    assert (c, d) == (5, 1) and not (out / "zones" / ZID).exists()  # dry run writes nothing
    assert all(line.split(" ", 1)[1].startswith("zones/") for line in changes)
    c, u, d = export_data.sync(plan, out, scope="zones/")
    assert (c, u, d) == (5, 0, 1)
    assert (out / "overall" / "manifest.json").read_text() == "pending" and not (out / "README.md").exists()
    assert not (out / "zones" / "old-zone").exists()
    assert sorted(p.relative_to(out).as_posix() for p in (out / "zones").rglob("*") if p.is_file()) == [
        f"zones/{ZID}/built/catalogue.json", f"zones/{ZID}/built/nav.glb", f"zones/{ZID}/built/twin.glb",
        f"zones/{ZID}/zone.json", "zones/index.json"]
    assert export_data.sync(plan, out, scope="zones/") == (0, 5, 0)  # idempotent


# ---------------------------------------------------------------- castle module zone (ADR 0033, 0048)
CID = "schloss-karlsberg"
CASTLE_SOURCE = ROOT / "zones" / CID / "zone.json"  # committed source of the package's zone.json
CASTLE_FILES = export_data.PUBLIC_ZONE_POLICY[CID]["moduleFiles"]


def _jpeg(comment: bytes = b"") -> bytes:
    app0 = b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    out = b"\xff\xd8" + b"\xff\xe0" + struct.pack(">H", len(app0) + 2) + app0
    if comment:
        out += b"\xff\xfe" + struct.pack(">H", len(comment) + 2) + comment
    return out + b"\xff\xda" + struct.pack(">H", 2) + b"\x12\x34/Users/x@y.de random scan bytes\xff\xd9"


def _castle(tmp_path: Path, drop: str | None = None, comment: bytes = b"", manifest: dict | None = None) -> Path:
    zsrc = _src(tmp_path)
    cdir = zsrc / CID
    for rel in (*CASTLE_FILES, "terrain/dtm2025.f32.deflate", "textures/extra/diff.png", "notes.md"):
        if rel == drop:
            continue
        f = cdir / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        if rel.endswith(".jpg"):
            f.write_bytes(_jpeg(comment))
        elif rel.endswith(".json"):
            f.write_text(json.dumps({"files": {"dtm1789": "dtm1789.u16.deflate"}, "attribution": "Gelände: dl-de/by-2-0"}))
        else:
            f.write_bytes(b"x\x9c" + bytes(range(256)) * 4)  # opaque binary (may contain anything)
    m = manifest or json.loads(CASTLE_SOURCE.read_text(encoding="utf-8"))
    (cdir / "zone.json").write_text(json.dumps(m, ensure_ascii=False, indent=1), encoding="utf-8")
    return zsrc


def test_castle_policy_lists_the_cc0_texture_sets_of_the_viewer():
    tex = json.loads((ROOT / "zones" / CID / "viewer" / "textures.json").read_text(encoding="utf-8"))
    assert sorted(s["name"] for s in tex["sets"]) == sorted(export_data.CASTLE_TEXTURE_SETS)
    assert all(s["licence"] == "CC0" for s in tex["sets"]) and tex["licence"].startswith("CC0")
    assert len(CASTLE_FILES) == 3 + 3 * len(export_data.CASTLE_TEXTURE_SETS)
    assert all(f.startswith(export_data.PUBLIC_ZONE_POLICY[CID]["prefixes"]) for f in CASTLE_FILES)


def test_stages_castle_module_files_only(tmp_path):
    zsrc = _castle(tmp_path)
    plan: dict = {}
    staged = export_data.plan_zones(zsrc, [CID, ZID], plan)
    castle = sorted(k for k in plan if k.startswith(f"zones/{CID}/"))
    assert castle == sorted([f"zones/{CID}/zone.json", *(f"zones/{CID}/{f}" for f in CASTLE_FILES)])
    assert plan[f"zones/{CID}/zone.json"] == zsrc / CID / "zone.json"  # no reference assets: byte-identical
    assert set(staged[0]["skipped"]) == {"terrain/dtm2025.f32.deflate", "textures/extra/diff.png", "notes.md"}
    idx = json.loads(plan["zones/index.json"])
    assert [z["id"] for z in idx["zones"]] == [CID, ZID]  # source index order


def test_refuses_castle_with_a_missing_module_file(tmp_path):
    with pytest.raises(SystemExit, match="textures/grass/arm.jpg is missing"):
        export_data.plan_zones(_castle(tmp_path, drop="textures/grass/arm.jpg"), [CID], {})


@pytest.mark.parametrize("comment", [b"/Users/someone/Pictures/raw.jpg", b"shot by kontakt@example.org"])
def test_refuses_castle_texture_with_private_jpeg_metadata(tmp_path, comment):
    with pytest.raises(SystemExit, match="JPEG metadata"):
        export_data.plan_zones(_castle(tmp_path, comment=comment), [CID], {})


def test_jpeg_scan_data_is_not_mistaken_for_metadata(tmp_path):
    assert export_data.zone_file_problems("textures/a/diff.jpg", _jpeg(), True) == []
    assert export_data.zone_file_problems("textures/a/diff.jpg", b"GIF89a", True) == ["textures/a/diff.jpg: not a JPEG"]


def test_refuses_castle_leak_in_zone_json(tmp_path):
    m = json.loads(CASTLE_SOURCE.read_text(encoding="utf-8"))
    m["attribution"].append("Fotos: /Users/someone/karlsberg")
    with pytest.raises(SystemExit, match="refusing to stage"):
        export_data.plan_zones(_castle(tmp_path, manifest=m), [CID], {})


def test_refuses_module_files_for_another_runtime(tmp_path):
    m = json.loads(CASTLE_SOURCE.read_text(encoding="utf-8"))
    m["runtime"] = {"kind": "module", "module": "testraum"}
    with pytest.raises(SystemExit, match="moduleFiles are cleared"):
        export_data.plan_zones(_castle(tmp_path, manifest=m), [CID], {})


def test_image_files_need_an_image_policy():
    assert export_data.zone_file_problems("built/foto.jpg", _jpeg(), False) == [
        "built/foto.jpg: image file where the zone policy allows no images"]
    assert export_data.zone_file_problems("built/atlas.png", b"\x89PNG", True) == [
        "built/atlas.png: only JPEG images can be checked for metadata"]


REAL_ZONES = ROOT / "app" / "public" / "data" / "zones"


@pytest.mark.skipif(not (REAL_ZONES / CID / "zone.json").is_file(), reason="no generated castle zone package")
def test_real_castle_package_stages_cleanly():
    """The generated package (pnpm run export:zone) passes the policy as it is: no leaks, all files present."""
    plan: dict = {}
    staged = export_data.plan_zones(REAL_ZONES, [CID], plan)
    assert len(plan) == 1 + len(CASTLE_FILES) + 1 and staged[0]["files"] == 1 + len(CASTLE_FILES)
