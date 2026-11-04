from pathlib import Path

from capture import clean
from capture.common import Zone


def test_clean_drops_unblurred_frames_and_colmap_db_keeps_splat_inputs(tmp_path):
    for rel in ("frames/raw/f_00001.jpg", "frames/clean/f_00001.jpg", "frames/undistorted/f_00001.jpg",
                "sfm/database.db", "sfm/models/0/images.bin", "sfm/sparse/images.bin", "mesh/poses.json"):
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"x" * 10)
    clean.run(Zone("t", {}, Path("v.mp4"), tmp_path))
    left = sorted(str(p.relative_to(tmp_path)) for p in tmp_path.rglob("*") if p.is_file())
    assert left == ["frames/clean/f_00001.jpg", "frames/undistorted/f_00001.jpg", "mesh/poses.json",
                    "sfm/sparse/images.bin"]
    clean.run(Zone("t", {}, Path("v.mp4"), tmp_path))  # idempotent
