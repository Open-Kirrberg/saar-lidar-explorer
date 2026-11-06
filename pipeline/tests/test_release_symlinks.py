"""Release export with symlinked inputs and the delete guard (scripts/release/export_data.py, RELEASING.md §2).

A checkout whose data dir links its AOI folders from another checkout used to be walked without following the
links (os.walk), so the linked files were planned as absent and a full sync deleted them from the staging repos.
Now links are followed inside the allowed link roots (anything else aborts), and a sync that would delete more
than --max-deletes staged files refuses before writing anything unless --allow-deletes is given.
Synthetic trees in tmp dirs only; nothing is exported for real.
"""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("export_data", ROOT / "scripts" / "release" / "export_data.py")
export_data = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(export_data)


def _write(p: Path, data: bytes | str = b"x") -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data.encode() if isinstance(data, str) else data)
    return p


def _old_and_new(tmp_path: Path, n_tiles: int = 3):
    """`old/data` = real AOI data; `new/data` = a checkout whose overall/ links most subdirs from `old`."""
    old = tmp_path / "old" / "data"
    for i in range(n_tiles):
        _write(old / "overall" / "dtm" / f"0_{i}.png", f"h{i}")
        _write(old / "overall" / "xyz" / "relief" / "15" / "1" / f"{i}.png", f"t{i}")
    _write(old / "shared" / "index.json", json.dumps({"attribution": "Test"}))
    _write(old / "pois.geojson", json.dumps({"type": "FeatureCollection", "features": []}))
    new = tmp_path / "new" / "data"
    manifest = {"name": "Test", "attribution": "Testdaten", "xyz": {"relief": {"url": "xyz/relief/{z}/{x}/{y}.png", "maxZoom": 17}}}
    _write(new / "overall" / "manifest.json", json.dumps(manifest))
    _write(new / "overall" / "trees" / "a.bin")
    (new / "overall" / "dtm").symlink_to(old / "overall" / "dtm")
    (new / "overall" / "xyz").symlink_to(old / "overall" / "xyz")
    (new / "shared").symlink_to(old / "shared")
    (new / "pois.geojson").symlink_to(old / "pois.geojson")
    return old, new


@pytest.fixture
def link_roots():
    saved = list(export_data.LINK_ROOTS)
    yield export_data.LINK_ROOTS
    export_data.LINK_ROOTS[:] = saved


def test_walk_follows_links_inside_the_roots(tmp_path: Path):
    old, new = _old_and_new(tmp_path)
    got = [p.relative_to(new / "overall").as_posix() for p in export_data.walk_files(new / "overall", [new, old])]
    assert "dtm/0_0.png" in got and "xyz/relief/15/1/2.png" in got and "trees/a.bin" in got
    assert all(p.startswith(("dtm/", "xyz/", "trees/", "manifest")) for p in got)
    assert got == [p.relative_to(new / "overall").as_posix() for p in export_data.walk_files(new / "overall", [new, old])]


def test_walk_refuses_links_outside_the_roots(tmp_path: Path):
    old, new = _old_and_new(tmp_path)
    with pytest.raises(SystemExit, match="outside the allowed link roots"):
        list(export_data.walk_files(new / "overall", [new]))


def test_walk_refuses_dangling_links_and_loops(tmp_path: Path):
    root = tmp_path / "d"
    _write(root / "a.txt")
    (root / "gone").symlink_to(tmp_path / "nowhere")
    with pytest.raises(SystemExit, match="dangling"):
        list(export_data.walk_files(root, [tmp_path]))
    (root / "gone").unlink()
    (root / "sub").mkdir()
    (root / "sub" / "up").symlink_to(root)
    with pytest.raises(SystemExit, match="loop"):
        list(export_data.walk_files(root, [tmp_path]))


def test_plan_aoi_includes_linked_dirs(tmp_path: Path, link_roots):
    old, new = _old_and_new(tmp_path)
    link_roots[:] = [new, old]
    plan1, plan2 = {}, {}
    export_data.plan_aoi(new, "overall", 17, "https://example.invalid/d2/", plan1, plan2)
    assert {"overall/dtm/0_0.png", "overall/dtm/0_2.png", "overall/trees/a.bin", "overall/manifest.json"} <= set(plan1)
    assert {f"overall/xyz/relief/15/1/{i}.png" for i in range(3)} == set(plan2)


def test_pending_deletes_and_guard(tmp_path: Path):
    out = tmp_path / "out"
    for i in range(5):
        _write(out / "overall" / "dtm" / f"{i}.png")
    _write(out / ".git" / "HEAD")
    _write(out / "zones" / "z" / "zone.json")
    plan = {"overall/dtm/0.png": b"x"}
    assert export_data.pending_deletes(plan, out) == [f"overall/dtm/{i}.png" for i in range(1, 5)] + ["zones/z/zone.json"]
    assert export_data.pending_deletes(plan, out, "zones/") == ["zones/z/zone.json"]
    assert export_data.delete_guard([("repo", plan, out, None)], 5) == []
    lines = export_data.delete_guard([("repo", plan, out, None)], 4)
    assert "would lose 5 already-staged file(s) (limit 4)" in lines[0]
    assert any("overall/dtm" in line for line in lines)


def _args(src: Path, out1: Path, out2: Path, *extra: str) -> list:
    return ["--src", str(src), "--castle-terrain", str(src.parent / "no-terrain"), "--out1", str(out1), "--out2", str(out2),
            "--app-url", "https://example.invalid/app/", "--data-url", "https://example.invalid/d1/",
            "--data2-url", "https://example.invalid/d2/", *extra]


def _stage(out1: Path, out2: Path, n: int) -> None:
    """A previous release: n AOI files in repo 1, n tiles in repo 2."""
    for i in range(n):
        _write(out1 / "overall" / "dtm" / f"0_{i}.png", f"h{i}")
        _write(out2 / "overall" / "xyz" / "relief" / "15" / "1" / f"{i}.png", f"t{i}")
    _write(out1 / ".git" / "HEAD", "ref: refs/heads/main\n")


def _snapshot(*dirs: Path) -> dict:
    return {p: p.read_bytes() for d in dirs for p in sorted(d.rglob("*")) if p.is_file()}


def test_full_export_from_linked_checkout_keeps_staged_files(tmp_path: Path, link_roots, capsys):
    old, new = _old_and_new(tmp_path, n_tiles=60)
    out1, out2 = tmp_path / "rel" / "d1", tmp_path / "rel" / "d2"
    _stage(out1, out2, 60)
    rc = export_data.main(_args(new, out1, out2, "--link-root", str(old)))
    assert rc == 0, capsys.readouterr()
    assert all((out1 / "overall" / "dtm" / f"0_{i}.png").read_text() == f"h{i}" for i in range(60))
    assert len(list((out2 / "overall" / "xyz" / "relief" / "15" / "1").iterdir())) == 60
    assert (out1 / "pois.geojson").is_file() and (out1 / "shared" / "index.json").is_file()
    assert not (out1 / "overall" / "dtm").is_symlink()  # copies, not links
    assert (out1 / ".git" / "HEAD").is_file()


def test_full_export_refuses_mass_delete_without_writing(tmp_path: Path, link_roots, capsys):
    old, new = _old_and_new(tmp_path, n_tiles=60)
    out1, out2 = tmp_path / "rel" / "d1", tmp_path / "rel" / "d2"
    _stage(out1, out2, 60)
    (new / "overall" / "dtm").unlink()  # source dir missing -> 60 staged files would go
    before = _snapshot(out1, out2)
    rc = export_data.main(_args(new, out1, out2, "--link-root", str(old)))
    err = capsys.readouterr().err
    assert rc == export_data.EXIT_DELETE_GUARD
    assert "saar-lidar-data would lose 60 already-staged file(s) (limit 20)" in err and "overall/dtm" in err
    assert "--allow-deletes" in err
    assert _snapshot(out1, out2) == before  # nothing written in either repo
    # dry run reports the same and still writes nothing
    assert export_data.main(_args(new, out1, out2, "--link-root", str(old), "--dry-run")) == export_data.EXIT_DELETE_GUARD
    assert _snapshot(out1, out2) == before
    # explicit opt-in deletes
    assert export_data.main(_args(new, out1, out2, "--link-root", str(old), "--allow-deletes")) == 0
    assert not (out1 / "overall" / "dtm").exists()
    assert len(list((out2 / "overall" / "xyz" / "relief" / "15" / "1").iterdir())) == 60


def test_full_export_aborts_on_link_outside_roots(tmp_path: Path, link_roots, capsys):
    old, new = _old_and_new(tmp_path)
    out1, out2 = tmp_path / "rel" / "d1", tmp_path / "rel" / "d2"
    _stage(out1, out2, 3)
    before = _snapshot(out1, out2)
    with pytest.raises(SystemExit, match="outside the allowed link roots"):
        export_data.main(_args(new, out1, out2))  # old/ not a link root
    assert _snapshot(out1, out2) == before


def test_zones_only_guard(tmp_path: Path, link_roots, capsys):
    out1 = tmp_path / "rel" / "d1"
    for i in range(3):
        _write(out1 / "zones" / "old-zone" / f"{i}.glb")
    src = tmp_path / "src"
    (src / "zones").mkdir(parents=True)
    args = _args(src, out1, tmp_path / "rel" / "d2", "--zones-only", "--max-deletes", "2")
    before = _snapshot(out1)
    assert export_data.main(args) == export_data.EXIT_DELETE_GUARD
    assert _snapshot(out1) == before
    assert export_data.main(args + ["--allow-deletes"]) == 0
    assert not (out1 / "zones" / "old-zone").exists()


def test_symlink_roots_are_resolved(tmp_path: Path):
    """A link root given through a symlink still matches (macOS /tmp -> /private/tmp style)."""
    real = tmp_path / "real"
    _write(real / "f.txt")
    alias = tmp_path / "alias"
    alias.symlink_to(real)
    root = tmp_path / "walk"
    root.mkdir()
    (root / "l").symlink_to(alias)
    assert [p.name for p in export_data.walk_files(root, [alias, root])] == ["f.txt"]
    assert os.path.realpath(root / "l") == str(real.resolve())
