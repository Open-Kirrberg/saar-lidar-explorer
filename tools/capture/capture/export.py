"""Stage `export`: georeferenced GLB per level of detail, in the zone-local EPSG:25832 frame.

  x = E - E0,  y = h (DHHN2016, metres),  z = -(N - N0)      (E0/N0 = rounded zone anchor, in <zone>.glb.json)

Faces farther than `crop_radius_m` from the anchor (stray far-field reconstruction through windows/streets) are
cut. Diffuse texture only, downsized to `texture_px`. Outputs <work>/export/<zone>_<detail>.glb + one sidecar JSON
with the transform, residual summary and stats, plus preview renders in docs/shots/v2.8/ (git-ignored).
"""
from __future__ import annotations

import json
import math

import numpy as np

from .common import REPO, Zone, save_json


def crop_mask(centroids: np.ndarray, radius: float, y_range: tuple[float, float] | None = None) -> np.ndarray:
    """Keep faces whose centroid lies within `radius` (horizontal, local x/z) and inside y_range."""
    keep = np.hypot(centroids[:, 0], centroids[:, 2]) <= radius
    if y_range is not None:
        keep &= (centroids[:, 1] >= y_range[0]) & (centroids[:, 1] <= y_range[1])
    return keep


def run(zone: Zone) -> dict:
    import trimesh
    from PIL import Image

    cfg = zone.cfg.get("export", {})
    geo = json.loads((zone.work / "georef.json").read_text())
    M = np.array(geo["mesh_to_local"])
    out = zone.dir("export")
    for p in out.glob("*.glb"):
        p.unlink()
    stats = {}
    for d in sorted((zone.work / "mesh").glob("model_*")):
        detail = d.name.removeprefix("model_")
        obj = next(d.glob("*.obj"))
        mesh = trimesh.load(obj, force="mesh", process=False)
        mesh.apply_transform(M)
        cen = mesh.triangles_center
        y0 = geo["residuals"]["ground_ref_h"] if "ground_ref_h" in geo["residuals"] else float(np.median(cen[:, 1]))
        keep = crop_mask(cen, cfg.get("crop_radius_m", 40.0),
                         (y0 + cfg.get("crop_below_m", -6.0), y0 + cfg.get("crop_above_m", 25.0)))
        mesh.update_faces(keep)
        mesh.remove_unreferenced_vertices()
        tex = None
        mat = getattr(mesh.visual, "material", None)
        if mat is not None:
            img = getattr(mat, "image", None) or getattr(mat, "baseColorTexture", None)
            if img is not None:
                side = cfg.get("texture_px", {}).get(detail, 2048)
                if max(img.size) > side:
                    img = img.resize((side, side), Image.Resampling.LANCZOS)
                img = img.convert("RGB")
                img.format = "JPEG"  # trimesh embeds JPEG-tagged images as JPEG (PIL quality 75), else PNG (~4x)
                mesh.visual.material = trimesh.visual.material.PBRMaterial(
                    baseColorTexture=img, metallicFactor=0.0, roughnessFactor=1.0, doubleSided=False)
                tex = list(img.size)
        glb = out / f"{zone.id}_{detail}.glb"
        glb.write_bytes(trimesh.exchange.gltf.export_glb(trimesh.Scene(mesh), include_normals=True))
        b = mesh.bounds
        stats[detail] = {"file": glb.name, "triangles": int(len(mesh.faces)), "vertices": int(len(mesh.vertices)),
                         "cropped_faces": int((~keep).sum()), "texture_px": tex,
                         "glb_mb": round(glb.stat().st_size / 1e6, 2),
                         "bounds_local": [[round(float(x), 2) for x in b[0]], [round(float(x), 2) for x in b[1]]]}
        if detail == cfg.get("preview_detail", "medium"):
            render_previews(zone, mesh)
    side = {"zone": zone.id, "crs": geo["crs"], "height": geo["height"], "anchor": geo["anchor"],
            "local_frame": geo["local_frame"], "lods": stats,
            "georef": {k: geo["residuals"][k] for k in ("scale", "cameras", "plan", "corners_summary", "ground_vs_dtm")
                       if k in geo["residuals"]},
            "privacy": "plates + people blurred before reconstruction (PRD H13), see tools/capture/README.md",
            "sources": ["own footage (consented business, PRD H6)",
                        "© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (LoD2, DGM1 for georeferencing)"]}
    side["georef"].get("plan", {}).pop("candidates", None)
    save_json(out / f"{zone.id}.glb.json", side)
    print("   export:", json.dumps(stats), flush=True)
    return stats


# --------------------------------------------------------------------------------------------- preview renders

def face_colors(mesh) -> np.ndarray:
    """Texture colour at each face centroid UV (nearest texel), or grey."""
    uv = getattr(mesh.visual, "uv", None)
    mat = getattr(mesh.visual, "material", None)
    img = getattr(mat, "baseColorTexture", None) if mat is not None else None
    if uv is None or img is None:
        return np.full((len(mesh.faces), 3), 180, np.uint8)
    a = np.asarray(img.convert("RGB"))
    fu = uv[mesh.faces].mean(1)
    x = np.clip((fu[:, 0] % 1.0) * (a.shape[1] - 1), 0, a.shape[1] - 1).astype(int)
    y = np.clip((1 - fu[:, 1] % 1.0) * (a.shape[0] - 1), 0, a.shape[0] - 1).astype(int)
    return a[y, x]


def look_at(eye, target, up=(0, 1, 0)):
    f = np.asarray(target, float) - eye
    f /= np.linalg.norm(f)
    r = np.cross(f, up)
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    return np.stack([r, u, -f])


def render(v, f, col, eye, target, size=(1600, 1000), fov_deg=60.0, light=(0.3, 0.8, 0.5), bg=(32, 32, 32)):
    """Painter's-algorithm rasteriser (flat shaded, face colour = texture at centroid). Good enough for QA shots."""
    import cv2

    R = look_at(np.asarray(eye, float), target)
    pc = (v - eye) @ R.T  # camera: x right, y up, -z forward
    z = -pc[:, 2]
    W, H = size
    fpx = 0.5 * W / math.tan(math.radians(fov_deg) / 2)
    with np.errstate(divide="ignore", invalid="ignore"):
        px = np.stack([W / 2 + fpx * pc[:, 0] / z, H / 2 - fpx * pc[:, 1] / z], 1)
    fz = z[f]
    ok = (fz > 0.3).all(1)
    tri = px[f]
    ok &= np.isfinite(tri).all((1, 2)) & (np.abs(tri) < 1e5).all((1, 2))
    n = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    L = np.asarray(light, float) / np.linalg.norm(light)
    shade = 0.55 + 0.45 * np.abs(n @ L)
    c = np.clip(col * shade[:, None], 0, 255).astype(np.uint8)
    img = np.full((H, W, 3), bg, np.uint8)
    order = np.argsort(-fz.mean(1))
    order = order[ok[order]]
    pts = np.round(tri * 16).astype(np.int32)
    for i in order:
        cv2.fillConvexPoly(img, pts[i], tuple(int(x) for x in c[i, ::-1]), lineType=cv2.LINE_8, shift=4)
    return img


def render_previews(zone: Zone, mesh) -> None:
    import cv2

    v, f = np.asarray(mesh.vertices), np.asarray(mesh.faces)
    col = face_colors(mesh).astype(float)
    ctr = v.mean(0)
    span = float(np.ptp(v[:, [0, 2]], axis=0).max())
    out = REPO / "docs" / "shots" / "v2.8"
    out.mkdir(parents=True, exist_ok=True)
    views = {
        "oblique_se": ctr + np.array([0.7, 0.6, 0.7]) * span * 0.8,
        "oblique_nw": ctr + np.array([-0.7, 0.6, -0.7]) * span * 0.8,
        "top": ctr + np.array([0.0, 1.2, 0.01]) * span,
    }
    for name, eye in views.items():
        cv2.imwrite(str(out / f"{zone.id}_mesh_{name}.jpg"), render(v, f, col, eye, ctr), [cv2.IMWRITE_JPEG_QUALITY, 88])
