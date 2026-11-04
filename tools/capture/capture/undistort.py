"""Stage `undistort`: fisheye keyframes -> pinhole images with the lens calibrated by the `sfm` stage.

COLMAP's OPENCV_FISHEYE model is the cv2.fisheye model (equidistant + k1..k4), so the SfM camera maps directly to
cv2.fisheye.initUndistortRectifyMap. The output pinhole keeps the centre scale (focal = `focal_scale` x fisheye focal,
no up-sampling in the middle) and crops the extreme periphery, whose pinhole projection would explode.
The 35 mm-equivalent focal length is written to EXIF so Object Capture starts from the right intrinsics.
Output: <work>/frames/undistorted/*.jpg + undistort.json (K, size, horizontal/vertical FOV).
"""
from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from .common import Zone, load_json, save_json


def pinhole_for(fx: float, fy: float, w: int, h: int, focal_scale: float, out_w: int, out_h: int) -> np.ndarray:
    f = focal_scale * 0.5 * (fx + fy)
    return np.array([[f, 0, out_w / 2], [0, f, out_h / 2], [0, 0, 1]], float)


def fov_deg(f: float, size: int) -> float:
    return math.degrees(2 * math.atan(size / 2 / f))


def exif_35mm(f_px: float, w: int, h: int) -> int:
    """35 mm-equivalent focal length (diagonal convention: 43.27 mm full-frame diagonal)."""
    return int(round(f_px * 43.27 / math.hypot(w, h)))


def run(zone: Zone) -> dict:
    import cv2
    from PIL import Image

    cfg = zone.cfg.get("undistort", {})
    summ = load_json(zone.work / "sfm" / "summary.json")
    cam = summ["camera"]
    if cam["model"] != "OPENCV_FISHEYE":
        raise RuntimeError(f"undistort expects OPENCV_FISHEYE, got {cam['model']}")
    fx, fy, cx, cy, k1, k2, k3, k4 = cam["params"]
    w, h = cam["width"], cam["height"]
    out_w = cfg.get("width", w)
    out_h = cfg.get("height", h)
    K = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]], float)
    D = np.array([k1, k2, k3, k4], float)
    P = pinhole_for(fx, fy, w, h, cfg.get("focal_scale", 1.0), out_w, out_h)
    m1, m2 = cv2.fisheye.initUndistortRectifyMap(K, D, np.eye(3), P, (out_w, out_h), cv2.CV_16SC2)
    src = zone.work / "frames" / "clean"
    dst = zone.dir("frames", "undistorted")
    for p in dst.glob("*.jpg"):
        p.unlink()
    f35 = exif_35mm(P[0, 0], out_w, out_h)
    quality = cfg.get("jpeg_quality", 92)

    def one(p):
        img = cv2.imread(str(p), cv2.IMREAD_COLOR)
        und = cv2.remap(img, m1, m2, interpolation=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
        rgb = Image.fromarray(cv2.cvtColor(und, cv2.COLOR_BGR2RGB))
        exif = Image.Exif()
        exif[0xA405] = f35  # FocalLengthIn35mmFilm (in the Exif IFD; Pillow places it there on save)
        rgb.save(dst / p.name, quality=quality, exif=exif)

    files = sorted(src.glob("*.jpg"))
    with ThreadPoolExecutor(8) as ex:
        list(ex.map(one, files))
    info = {"K": P.tolist(), "width": out_w, "height": out_h, "hfov_deg": fov_deg(P[0, 0], out_w),
            "vfov_deg": fov_deg(P[1, 1], out_h), "focal_35mm": f35, "images": len(files),
            "fisheye": cam}
    save_json(zone.work / "undistort.json", info)
    print(f"   undistorted {len(files)} frames, hfov {info['hfov_deg']:.1f} deg, f35 {f35} mm", flush=True)
    return info
