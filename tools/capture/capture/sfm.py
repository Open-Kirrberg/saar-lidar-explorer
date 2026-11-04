"""Stage `sfm`: structure from motion on the privacy-cleaned keyframes with a fisheye camera (pycolmap / COLMAP).

One shared camera, model OPENCV_FISHEYE (equidistant + k1..k4, identical to cv2.fisheye), SIFT on a downscaled copy
(keypoints are scaled back, so the camera lives at full resolution), sequential matching (video order), then GLOMAP
global mapping (falls back to incremental mapping). The SfM serves two purposes: it *calibrates* the wide-angle lens
for the `undistort` stage. Its poses are NOT used downstream: on the bakery walk the global model's trajectory
disagrees with Object Capture's (median 1.5 m after a similarity fit), so a splat run should start from
mesh/poses.json + mesh/points.ply on the undistorted frames.
Output: <work>/sfm/sparse/ (COLMAP binary), sfm/summary.json.
"""
from __future__ import annotations

import shutil

import numpy as np

from .common import Zone, save_json


def run(zone: Zone) -> dict:
    import pycolmap

    cfg = zone.cfg["sfm"]
    images = zone.work / "frames" / "clean"
    root = zone.dir("sfm")
    db = root / "database.db"
    if db.exists():
        db.unlink()
    for d in ("sparse", "models"):
        shutil.rmtree(root / d, ignore_errors=True)

    reader = pycolmap.ImageReaderOptions()
    reader.camera_model = cfg.get("camera_model", "OPENCV_FISHEYE")
    f0 = cfg.get("focal_guess_px")
    if f0:
        import PIL.Image
        first = sorted(images.glob("*.jpg"))[0]
        w, h = PIL.Image.open(first).size
        n_extra = {"OPENCV_FISHEYE": 4, "OPENCV": 4, "RADIAL_FISHEYE": 2, "SIMPLE_RADIAL_FISHEYE": 1}[reader.camera_model]
        if reader.camera_model.startswith("SIMPLE") or reader.camera_model == "RADIAL_FISHEYE":
            params = [f0, w / 2, h / 2] + [0.0] * n_extra
        else:
            params = [f0, f0, w / 2, h / 2] + [0.0] * n_extra
        reader.camera_params = ",".join(f"{p:g}" for p in params)
    ext = pycolmap.FeatureExtractionOptions()
    ext.max_image_size = cfg.get("max_image_size", 2000)
    ext.sift.max_num_features = cfg.get("max_num_features", 8192)
    pycolmap.extract_features(db, images, camera_mode=pycolmap.CameraMode.SINGLE, reader_options=reader,
                              extraction_options=ext, device=pycolmap.Device.cpu)

    pairing = pycolmap.SequentialPairingOptions()
    pairing.overlap = cfg.get("overlap", 12)
    pairing.quadratic_overlap = True
    pycolmap.match_sequential(db, pairing_options=pairing, device=pycolmap.Device.cpu)

    out = root / "models"
    out.mkdir()
    mapper = cfg.get("mapper", "global")
    recs = {}
    if mapper == "global":
        opts = pycolmap.GlobalPipelineOptions()
        try:
            recs = pycolmap.global_mapping(db, images, out, opts)
        except Exception as e:  # noqa: BLE001 - fall back to the incremental mapper
            print("   global mapping failed:", e)
    if not recs:
        mapper = "incremental"
        opts = pycolmap.IncrementalPipelineOptions()
        opts.ba_refine_principal_point = False
        recs = pycolmap.incremental_mapping(db, images, out, opts)
    if not recs:
        raise RuntimeError("SfM produced no model")
    sizes = {k: r.num_reg_images() for k, r in recs.items()}
    best = max(sizes, key=sizes.get)
    rec = recs[best]
    sparse = root / "sparse"
    sparse.mkdir()
    rec.write(sparse)
    cam = next(iter(rec.cameras.values()))
    n_total = len(list(images.glob("*.jpg")))
    reg = sorted(img.name for img in rec.images.values())
    summary = {
        "mapper": mapper, "models": {str(k): v for k, v in sizes.items()}, "best": int(best),
        "registered": rec.num_reg_images(), "of_images": n_total, "points3D": rec.num_points3D(),
        "mean_reprojection_error_px": float(rec.compute_mean_reprojection_error()),
        "camera": {"model": cam.model.name, "width": cam.width, "height": cam.height,
                   "params": [float(p) for p in cam.params]},
        "first_registered": reg[:1], "last_registered": reg[-1:],
    }
    # gaps: runs of unregistered frames in video order (where the walk lost tracking)
    names = sorted(p.name for p in images.glob("*.jpg"))
    ok = np.array([n in set(reg) for n in names])
    gaps, i = [], 0
    while i < len(ok):
        if not ok[i]:
            j = i
            while j < len(ok) and not ok[j]:
                j += 1
            gaps.append([names[i], names[j - 1], j - i])
            i = j
        else:
            i += 1
    summary["unregistered_runs"] = gaps
    save_json(root / "summary.json", summary)
    print("   sfm:", {k: summary[k] for k in ("mapper", "models", "registered", "of_images", "points3D",
                                            "mean_reprojection_error_px")}, flush=True)
    print("   camera:", summary["camera"], flush=True)
    return summary
