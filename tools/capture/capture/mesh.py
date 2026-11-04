"""Stage `mesh`: textured mesh from the undistorted, privacy-cleaned keyframes with Apple Object Capture.

RealityKit PhotogrammetrySession (swift/pgtool.swift, Metal, on-device) does its own alignment, dense
reconstruction, meshing, decimation to the requested detail level and texture baking. Several detail levels share one
alignment, so the LODs come out of one run. Output: <work>/mesh/model_<detail>/ (OBJ + MTL + PNG textures),
mesh/poses.json (camera poses in the mesh frame), mesh/points.ply, mesh/run.log.
"""
from __future__ import annotations

import re
import shutil
import subprocess

from .common import Zone, save_json
from .privacy import ensure_swift


def run(zone: Zone) -> dict:
    cfg = zone.cfg.get("mesh", {})
    images = zone.work / "frames" / "undistorted"
    out = zone.work / "mesh"
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    details = ",".join(cfg.get("details", ["medium", "reduced"]))
    cmd = [str(ensure_swift("pgtool")), str(images), str(out), details, cfg.get("ordering", "sequential"),
           cfg.get("sensitivity", "high")]
    with open(out / "run.log", "w") as log:
        subprocess.run(cmd, check=True, stdout=log, stderr=subprocess.STDOUT)
    text = (out / "run.log").read_text()
    info = {
        "details": details,
        "poses": int(m[1]) if (m := re.search(r"^poses: (\d+)", text, re.M)) else 0,
        "points": int(m[1]) if (m := re.search(r"^points: (\d+)", text, re.M)) else 0,
        "invalid_or_skipped": len(re.findall(r"^(invalid|skipped) sample", text, re.M)),
        "errors": re.findall(r"^error: .*", text, re.M)[:5],
        "seconds_reported": float(m[1]) if (m := re.search(r"done in (\d+) s", text)) else None,
        "images": len(list(images.glob("*.jpg"))),
    }
    save_json(out / "summary.json", info)
    print("   mesh:", info, flush=True)
    if info["errors"] or not list(out.glob("model_*/*.obj")):
        raise RuntimeError(f"Object Capture failed, see {out / 'run.log'}")
    return info
