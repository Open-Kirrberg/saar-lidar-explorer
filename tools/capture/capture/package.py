"""Stage `package`: export GLBs + georef -> zone package (docs/zone-contract.md, sle-zone-v1, runtime "gltf").

  <out>/<zone>/zone.json            manifest: footprint, portal, spawn, assets (LOD chain), evidence, capture, budget
  <out>/<zone>/scene/<detail>.glb   meshopt + quantized + KTX2 (ETC1S) + unlit, finest LOD first in the manifest
  <out>/index.json                  merged: other zones' entries kept

Steps: privacy crop (faces inside a `[[package.privacy_crop]]` plan polygon are removed and their texels inpainted:
areas without consent) + privacy mask (texels of faces inside `[[package.privacy_mask]]` spheres are inpainted) per LOD ->
`pack/pack.mjs` per LOD (Node, pinned glTF Transform + Basis encoder) -> manifest from the georef, the camera poses
(spawn + portal = first street frame) and the mesh hull -> strict validation (pipeline/zones.py) -> index merge.

**Scale:** geometry carries the georef scale (camera-height prior, +-11 %). `capture.scale.factor` (TOML
`package.scale_factor`, default 1) is a later correction the runtime applies about `pivotLocal`; one tape
measurement fixes it by editing that one number (zone.json, or the TOML + this stage), no mesh or georef rerun.
"""
from __future__ import annotations

import importlib.util
import json
import math
import re
import shutil
import subprocess
import time
from pathlib import Path

import numpy as np

from .common import REPO, TOOL, Zone, save_json

PACK = TOOL / "pack"
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


# --------------------------------------------------------------------------------------------- pure helpers

def quat_to_R(q) -> np.ndarray:
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def frame_no(name: str) -> int:
    """Video frame number from a keyframe file name (`f_00046.jpg` -> 46)."""
    m = re.search(r"(\d+)", name)
    return int(m.group(1)) if m else -1


def heading_pitch(d_local) -> tuple[float, float]:
    """Grid heading (clockwise from north) and pitch of a zone-frame direction (x = E, y = up, z = -N)."""
    dx, dy, dz = (float(c) for c in d_local)
    heading = math.degrees(math.atan2(dx, -dz)) % 360.0
    pitch = math.degrees(math.atan2(dy, math.hypot(dx, dz)))
    return heading, pitch


def camera_poses_local(poses: list[dict], M: np.ndarray) -> list[dict]:
    """Object Capture poses (camera-to-mesh, looks along -Z, up +Y) -> zone frame, in video order.

    Each: frame, x/y/z (local), heading_deg, pitch_deg."""
    out = []
    A = np.asarray(M, float)[:3, :3]
    for p in sorted(poses, key=lambda p: frame_no(p["file"])):
        R = quat_to_R(p["q_xyzw"])
        c = (np.asarray(M, float) @ np.r_[np.asarray(p["t"], float), 1.0])[:3]
        fwd = A @ -R[:, 2]
        h, pt = heading_pitch(fwd / np.linalg.norm(fwd))
        out.append({"frame": frame_no(p["file"]), "x": float(c[0]), "y": float(c[1]), "z": float(c[2]),
                    "heading_deg": h, "pitch_deg": pt})
    return out


def path_waypoints(cams: list[dict], step_m: float = 1.5) -> list[list[float]]:
    """Camera route (video order) thinned to points >= `step_m` apart in x/z: [x, y, z, heading_deg], zone frame.

    Where the camera went and looked (street -> shop -> courtyard): targets and view headings for the U3 walkthrough.
    The route itself is not body-walkable everywhere (the handheld camera reached over counters)."""
    pt = lambda c: [round(c["x"], 2), round(c["y"], 2), round(c["z"], 2), round(c["heading_deg"], 1)]
    out: list[list[float]] = []
    for c in cams:
        p = pt(c)
        if not out or math.hypot(p[0] - out[-1][0], p[2] - out[-1][2]) >= step_m:
            out.append(p)
    if cams and out[-1] != pt(cams[-1]):
        out.append(pt(cams[-1]))
    return out


def local_to_en(x: float, z: float, E0: int, N0: int) -> tuple[float, float]:
    return x + E0, N0 - z


def convex_hull_en(points_en: np.ndarray, pad_m: float = 1.0, nd: int = 1) -> list[list[float]]:
    """Convex hull ring (CCW, no closing vertex) of E/N points, pushed out by `pad_m`, rounded to `nd` decimals."""
    from scipy.spatial import ConvexHull

    pts = np.asarray(points_en, float)
    hull = pts[ConvexHull(pts).vertices]  # CCW for 2-D input
    c = hull.mean(0)
    d = hull - c
    n = np.linalg.norm(d, axis=1, keepdims=True)
    hull = c + d * (1 + pad_m / np.maximum(n, 1e-9))
    ring, last = [], None
    for E, N in hull:
        p = [round(float(E), nd), round(float(N), nd)]
        if p != last:
            ring.append(p)
        last = p
    return ring


def bbox_en(rings: list[list[list[float]]], pad_m: float = 0.0) -> list[list[float]]:
    pts = np.array([p for r in rings for p in r], float)
    lo, hi = pts.min(0) - pad_m, pts.max(0) + pad_m
    return [[math.floor(lo[0]), math.floor(lo[1])], [math.ceil(hi[0]), math.ceil(hi[1])]]


def merge_index(index: dict | None, entry: dict, drop: tuple[str, ...] | list[str] = ()) -> dict:
    """zones/index.json with `entry` inserted or replaced by id; entries of `drop` (former ids of this zone) removed;
    other zones kept in order."""
    gone = {entry["id"], *drop}
    zones = [z for z in (index or {}).get("zones", []) if isinstance(z, dict) and z.get("id") not in gone]
    return {"format": "sle-zones-v1", "zones": zones + [entry]}


def in_polygons(xz: np.ndarray, polygons: list[dict]) -> np.ndarray:
    """Points (local x/z) inside any crop polygon ({xz: [[x, z], ...]}, ring, either orientation; even-odd rule)."""
    pts = np.asarray(xz, float).reshape(-1, 2)
    inside_any = np.zeros(len(pts), bool)
    for poly in polygons:
        ring = np.asarray(poly["xz"], float)
        inside = np.zeros(len(pts), bool)
        x, z = pts[:, 0], pts[:, 1]
        for (x1, z1), (x2, z2) in zip(ring, np.roll(ring, -1, axis=0)):
            crosses = (z1 > z) != (z2 > z)
            with np.errstate(divide="ignore", invalid="ignore"):
                xc = x1 + (z - z1) * (x2 - x1) / (z2 - z1)
            inside ^= crosses & (x < xc)
        inside_any |= inside
    return inside_any


def walk_cameras(cams: list[dict], polygons: list[dict], end_heading_deg: float | None = None) -> list[dict]:
    """Camera route without the poses inside crop polygons (the walk ends before a cropped area).

    `end_heading_deg` turns the last pose (the end of the walk / U3 target) to look somewhere harmless."""
    kept = [c for c in cams if not polygons or not in_polygons([[c["x"], c["z"]]], polygons)[0]]
    if kept and end_heading_deg is not None:
        kept[-1] = {**kept[-1], "heading_deg": float(end_heading_deg) % 360.0}
    return kept


def faces_in_spheres(centroids: np.ndarray, spheres: list[dict]) -> np.ndarray:
    """Faces whose centroid lies inside any privacy sphere ({center: [x, y, z], radius})."""
    keep = np.zeros(len(centroids), bool)
    for s in spheres:
        keep |= np.linalg.norm(centroids - np.asarray(s["center"], float), axis=1) <= float(s["radius"])
    return keep


def gpu_texture_bytes(w: int, h: int, bpp: float = 8.0) -> int:
    """Transcoded size incl. the mip chain: ETC1S -> BC7 / ASTC 4x4 (8 bpp) is the worst compressed target."""
    return int(w * h * bpp / 8 * 4 / 3)


def scale_about(p, pivot, factor: float) -> list[float]:
    """The runtime's scale correction: pivot + factor * (p - pivot) (tested twin of app/src/zones/runtime)."""
    p, c = np.asarray(p, float), np.asarray(pivot, float)
    return [float(v) for v in c + factor * (p - c)]


# --------------------------------------------------------------------------------------------- privacy mask

def mask_texture(mesh, spheres: list[dict], dilate_px: int = 6, extra: np.ndarray | None = None):
    """Inpaint the texels of faces inside the privacy spheres (and of the faces flagged in `extra`, e.g. cropped ones).
    Returns (PIL image, masked texel count)."""
    import cv2
    from PIL import Image

    img = mesh.visual.material.baseColorTexture.convert("RGB")
    sel = faces_in_spheres(mesh.triangles_center, spheres) if spheres else np.zeros(len(mesh.faces), bool)
    if extra is not None:
        sel |= extra
    if not sel.any():
        return img, 0
    a = np.asarray(img).copy()
    h, w = a.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    uv = np.asarray(mesh.visual.uv)[mesh.faces[sel]]
    px = np.stack([uv[..., 0] % 1.0 * (w - 1), (1 - uv[..., 1] % 1.0) * (h - 1)], -1)
    cv2.fillPoly(mask, [np.round(t * 4).astype(np.int32) for t in px], 255, lineType=cv2.LINE_8, shift=2)
    if dilate_px:
        mask = cv2.dilate(mask, np.ones((2 * dilate_px + 1,) * 2, np.uint8))
    bgr = cv2.inpaint(a[..., ::-1].copy(), mask, 12, cv2.INPAINT_TELEA)
    blur = cv2.GaussianBlur(bgr, (0, 0), 6)
    bgr[mask > 0] = blur[mask > 0]
    return Image.fromarray(bgr[..., ::-1].copy()), int((mask > 0).sum())


# --------------------------------------------------------------------------------------------- stage

def _validator():
    spec = importlib.util.spec_from_file_location("sle_zones_validator", REPO / "pipeline" / "zones.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # our own repo code (stdlib only), not data
    return mod


def _node_pack(src: Path, dst: Path, tex: Path, quality: int, double_sided: bool) -> dict:
    node, pnpm = shutil.which("node"), shutil.which("pnpm")
    if not node:
        raise SystemExit("package: node not found (Node >= 22 needed for pack/pack.mjs)")
    if not (PACK / "node_modules").is_dir():
        if not pnpm:
            raise SystemExit("package: pnpm not found (cd tools/capture/pack && pnpm install --frozen-lockfile)")
        subprocess.run([pnpm, "install", "--frozen-lockfile"], cwd=PACK, check=True)
    cmd = [node, str(PACK / "pack.mjs"), "--in", str(src), "--out", str(dst), "--texture", str(tex), "--quality", str(quality)]
    if double_sided:
        cmd.append("--double-sided")
    res = subprocess.run(cmd, cwd=PACK, check=True, capture_output=True, text=True)
    return json.loads(res.stdout.strip().splitlines()[-1])


def run(zone: Zone) -> dict:
    import trimesh

    if not ID_RE.match(zone.id):
        raise SystemExit(f"package: zone id {zone.id!r} is not a valid zone id")
    cfg = zone.cfg.get("package", {})
    geo = json.loads((zone.work / "georef.json").read_text())
    side = json.loads((zone.work / "export" / f"{zone.id}.glb.json").read_text())
    poses = json.loads((zone.work / "mesh" / "poses.json").read_text())["poses"]
    E0, N0 = int(geo["anchor"]["E0"]), int(geo["anchor"]["N0"])
    res = geo["residuals"]
    out_root = REPO / cfg.get("out", "app/public/data/zones")
    out = out_root / zone.id
    tmp = zone.dir("package")
    if out.exists():
        shutil.rmtree(out)
    (out / "scene").mkdir(parents=True)

    # ---- assets: privacy mask + pack per LOD, finest first
    order = cfg.get("lods", ["medium", "reduced"])
    until = cfg.get("until_m", [60])
    spheres = cfg.get("privacy_mask", [])
    crops = cfg.get("privacy_crop", [])
    lods, tex_gpu, masked, cropped, hull_pts, bb = [], 0, {}, {}, None, None
    for k, detail in enumerate(order):
        src = zone.work / "export" / side["lods"][detail]["file"]
        mesh = trimesh.load(src, force="mesh", process=False)
        cut = in_polygons(mesh.triangles_center[:, [0, 2]], crops) if crops else None
        img, n_masked = mask_texture(mesh, spheres, extra=cut)
        masked[detail] = n_masked
        cropped[detail] = int(cut.sum()) if cut is not None else 0
        if cropped[detail]:  # drop the geometry too: no consent for that area (the atlas texels are inpainted above)
            mesh.update_faces(~cut)
            mesh.remove_unreferenced_vertices()
            src = tmp / f"{detail}_cropped.glb"
            src.write_bytes(trimesh.exchange.gltf.export_glb(trimesh.Scene(mesh), include_normals=True))
        side_px = int(cfg.get("texture_px", {}).get(detail, max(img.size)))
        if max(img.size) > side_px:  # the wasm Basis encoder stops at ~12 Mpix (3072² ok, 4096² not)
            from PIL import Image
            img = img.resize((side_px, side_px), Image.Resampling.LANCZOS)
        tex = tmp / f"{detail}_tex.jpg"
        img.save(tex, quality=95)
        dst = out / "scene" / f"{detail}.glb"
        st = _node_pack(src, dst, tex, int(cfg.get("ktx2_quality", 160)), bool(cfg.get("double_sided", False)))
        lods.append({"path": f"scene/{detail}.glb", "until_m": until[k] if k < len(order) - 1 else None,
                     "bytes": dst.stat().st_size, "triangles": int(st["triangles"])})
        for w, h in st["textures"]:
            tex_gpu += gpu_texture_bytes(w, h)
        b = np.asarray(mesh.bounds, float)
        bb = b if bb is None else np.stack([np.minimum(bb[0], b[0]), np.maximum(bb[1], b[1])])
        if k == len(order) - 1:  # coarsest = fewest vertices for the hull
            hull_pts = np.asarray(mesh.vertices)[:, [0, 2]]
        print(f"   {detail}: {st['bytes'] / 1e6:.2f} MB, {st['triangles']} tris, cropped {cropped[detail]} faces, "
              f"masked {n_masked} texels, {st['seconds']:.1f} s", flush=True)

    # ---- spawn + portal: first street frame of the walk (video order)
    cams = walk_cameras(camera_poses_local(poses, np.array(geo["mesh_to_local"])), crops, cfg.get("walk_end_heading_deg"))
    c0 = cams[int(cfg.get("spawn_index", 0))]
    if "spawn_heading_deg" in cfg:
        c0 = {**c0, "heading_deg": float(cfg["spawn_heading_deg"]) % 360.0}
    eye = float(cfg.get("eye_m", 1.6))
    ground = float(res.get("ground_ref_h", c0["y"] - res["scale"]["camera_height_m"]))
    sE, sN = local_to_en(c0["x"], c0["z"], E0, N0)
    spawn = {"E": round(sE, 2), "N": round(sN, 2), "h": round(ground + eye, 2), "heading_deg": round(c0["heading_deg"], 1),
             "pitch_deg": -5, "mode": "gehen"}
    portal = {"id": "strasse", "label_de": cfg.get("portal_label_de", "Bäckerei betreten"), "E": spawn["E"], "N": spawn["N"],
              "h": None, "radius_m": float(cfg.get("portal_radius_m", 40)),
              "facing_deg": round((c0["heading_deg"] + 180.0) % 360.0, 1), "spawn": "strasse"}

    fp = convex_hull_en(np.array([local_to_en(x, z, E0, N0) for x, z in hull_pts]), pad_m=float(cfg.get("footprint_pad_m", 1.0)))
    corner = (res.get("corners") or [None])[0]
    pivot = [round(corner["E"] - E0, 2), round(ground, 2), round(N0 - corner["N"], 2)] if corner else [0.0, round(ground, 2), 0.0]
    sc = res["scale"]
    rel = float(sc.get("rel_uncertainty", 0.11))
    factor = float(cfg.get("scale_factor", 1.0))

    manifest = {
        "format": "sle-zone-v1",
        "id": zone.id,
        "kind": "captured",
        "name_de": cfg["name_de"],
        "summary_de": cfg.get("summary_de", ""),
        "crs": "EPSG:25832",
        "heightDatum": "DHHN2016",
        "origin": {"E0": E0, "N0": N0},
        "footprint": fp,
        "portals": [portal],
        "spawns": {"strasse": spawn},
        "exit": {"rule": "restore"},
        "runtime": {"kind": "gltf"},
        "assets": [{"id": "scene", "role": "scene",
                    "bboxLocal": [[round(float(v), 2) for v in bb[0]], [round(float(v), 2) for v in bb[1]]], "lods": lods}],
        "preset": {"look": cfg.get("look", "natur"), "sky": "shared", "trees": "none", "timeOfDay": "now"},
        "attribution": cfg["attribution"],
        "evidence": {
            "kind": "capture",
            "confidence": cfg.get("confidence", "med"),
            "perPart": "none",
            "sources_de": [
                *cfg.get("sources_de", []),
                f"Lage an LoD2-Wänden: Median {res['plan']['median_abs_m']:.2f} m, Boden an DGM1: Median {res['ground_vs_dtm']['median_abs_m']:.2f} m",
                f"Maßstab aus angenommener Kamerahöhe {sc['camera_height_m']:.2f} m (± {rel * 100:.0f} %), nicht gemessen",
            ][:10],
            "disclaimer_de": cfg["disclaimer_de"],
        },
        "capture": {
            "date": cfg["footage_date"],
            "method": "photogrammetry-mesh",
            "georef": {"method": "lod2-walls+dgm1", "controlPoints": int(res.get("corners_summary", {}).get("n", 0)),
                       "rmsError_m": round(float(res["plan"]["rms_m"]), 2)},
            "privacy": cfg["privacy_de"],
            "scale": {"factor": factor, "pivotLocal": pivot, "metresPerUnit": round(float(sc["mesh_units_to_m"]), 4),
                      "source": "camera-height", "relUncertainty": round(rel, 3)},
        },
        "budget": None,
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "generator": "tools/capture package",
    }
    first_view = lods[-1]["bytes"]
    manifest["budget"] = {"downloadBytes": first_view, "totalBytes": 0, "triangles": max(l["triangles"] for l in lods),
                          "textureBytesGpu": tex_gpu}
    mf = out / "zone.json"
    save_json(mf, manifest)
    files = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    manifest["budget"]["totalBytes"] = files + 64  # the number itself grows the file by a few bytes
    save_json(mf, manifest)

    errs = _validator().validate_package(out)
    if errs:
        raise SystemExit("package: zone package invalid:\n  - " + "\n  - ".join(errs))

    idx_path = out_root / "index.json"
    idx = json.loads(idx_path.read_text()) if idx_path.exists() else None
    entry = {"id": zone.id, "bboxEN": bbox_en([fp, [[portal["E"], portal["N"]]]], pad_m=1.0)}
    save_json(idx_path, merge_index(idx, entry, drop=cfg.get("former_ids", [])), indent=2)
    summary = {"out": str(out.relative_to(REPO)), "lods": lods, "masked_texels": masked, "cropped_faces": cropped,
               "budget": manifest["budget"],
               "spawn": spawn, "portal": portal, "footprint_vertices": len(fp),
               "walkPath": path_waypoints(cams, float(cfg.get("walk_path_step_m", 1.5)))}
    save_json(tmp / "package.json", summary)
    print("   package:", json.dumps({k: summary[k] for k in ("out", "budget", "masked_texels", "cropped_faces")}), flush=True)
    if cfg.get("twin"):  # built twin (ADR 0042): the capture just packaged becomes its hidden reference
        from . import twin
        summary["twin"] = twin.run(zone)
    return summary
