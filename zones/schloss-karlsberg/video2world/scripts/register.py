"""Georegister a levelled Object Capture mesh to the LiDAR foundations (similarity transform) and export it.

Usage (from pipeline/): uv run python -I ../zones/schloss-karlsberg/video2world/scripts/register.py <picks.json> [--no-export]

picks.json (committed, in scripts/picks/) lists, in the levelled mesh frame of level.py:
  ground : boxes [x0,x1,y0,y1] on the Ehrenhof pavement  -> mapped to the court level 344.8 m (LiDAR KB-01)
  lines  : sharp wall faces seen in the mesh, each as an approximate segment [[x,y],[x,y]] plus the matching LiDAR
           edge ["KB-02", i, j] = line through vertices i, j of that lidar_features.geojson polygon/line.
           role "control" -> used in the fit; "check" -> only reported (independent check / HMS-vs-LiDAR conflict).
Method:
  1. each mesh segment is snapped to the strongest height edge of the DSM (median over stations along the segment);
  2. a 2D similarity (scale s, rotation theta, tE, tN) minimises point-to-line distances of the segment points
     (25/50/75 %) to the LiDAR edges (scipy least_squares, soft-L1 loss); 1-sigma from the Jacobian;
  3. 'up' comes from level.py (normal mean shift, checked by zero camera roll) and is then refined so that the ridges
     of the long wings (ridge_boxes, palace grid u/v) are horizontal (rotation about the court centre); the vertical
     datum maps the median court pavement to 344.8 m (LiDAR KB-01); vertical scale = horizontal scale (similarity).
  4. the composite 7-parameter transform raw-mesh -> (E, N, h) is written to work/reg/<run>/registration.json together
     with residuals, and an equivalent Umeyama fit on 3D point pairs as a cross-check.
Exports (git-ignored): work/reg/<run>/registered_local.obj and .glb in the explorer frame
  x = E - 381000, y = h, z = -(N - 5465000).
"""
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from scipy.optimize import least_squares

import v2w_common as C


def lidar_edge(feats, fid, i, j):
    g = feats[fid]["geometry"]
    xy = np.array(g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"], float)
    return xy[i], xy[j]


def dsm_sample(dsm, g, x, y):
    c = ((np.asarray(x) - g["x0"]) / g["res"]).astype(int)
    r = ((g["y1"] - np.asarray(y)) / g["res"]).astype(int)
    ok = (c >= 0) & (c < dsm.shape[1]) & (r >= 0) & (r < dsm.shape[0])
    out = np.full(np.shape(x), np.nan)
    out[ok] = dsm[r[ok], c[ok]]
    return out


def refine_segment(dsm, g, p0, p1, search):
    """Shift a segment perpendicular to itself onto the strongest height step (median over 15 stations)."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    d = (p1 - p0) / np.linalg.norm(p1 - p0)
    n = np.array([-d[1], d[0]])
    offs = np.arange(-search, search + 1e-12, g["res"] / 2)
    best = []
    for t in np.linspace(0.15, 0.85, 15):
        q = p0 + t * (p1 - p0)
        pts = q[None, :] + offs[:, None] * n[None, :]
        h = dsm_sample(dsm, g, pts[:, 0], pts[:, 1])
        if np.isnan(h).mean() > 0.3:
            continue
        h = np.nan_to_num(h, nan=np.nanmin(h))
        grad = np.abs(np.gradient(h))
        best.append(offs[np.argmax(grad)])
    if len(best) < 4:
        return p0, p1, np.nan, 0
    shift = float(np.median(best))
    spread = float(np.median(np.abs(np.array(best) - shift)) * 1.4826)
    return p0 + shift * n, p1 + shift * n, spread, len(best)


def sim2(params, xy):
    s, th, te, tn = params
    c, si = np.cos(th), np.sin(th)
    return np.stack([s * (c * xy[:, 0] - si * xy[:, 1]) + te, s * (si * xy[:, 0] + c * xy[:, 1]) + tn], 1)


def line_dist(pts, a, b):
    d = (b - a) / np.linalg.norm(b - a)
    n = np.array([-d[1], d[0]])
    return (pts - a) @ n


def write_glb(path, v, f):
    v = v.astype(np.float32)
    idx = f.astype(np.uint32).ravel()
    vb, ib = v.tobytes(), idx.tobytes()
    pad = lambda b, c=b"\x00": b + c * ((4 - len(b) % 4) % 4)
    gltf = {
        "asset": {"version": "2.0", "generator": "karlsberg video2world register.py"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": "hms_reference_mesh"}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
        "buffers": [{"byteLength": len(pad(vb)) + len(ib)}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(vb), "target": 34962},
                        {"buffer": 0, "byteOffset": len(pad(vb)), "byteLength": len(ib), "target": 34963}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": len(v), "type": "VEC3",
                       "min": v.min(0).tolist(), "max": v.max(0).tolist()},
                      {"bufferView": 1, "componentType": 5125, "count": len(idx), "type": "SCALAR"}],
    }
    js = pad(json.dumps(gltf).encode(), b" ")
    bin_ = pad(vb) + ib
    bin_ = pad(bin_)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)))
        fh.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        fh.write(struct.pack("<II", len(bin_), 0x004E4942) + bin_)


def rot_to_z(n):
    z = np.array([0, 0, 1.0])
    k = np.cross(n, z)
    sk = np.linalg.norm(k)
    if sk < 1e-12:
        return np.eye(3)
    k /= sk
    a = np.arctan2(sk, n @ z)
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + np.sin(a) * K + (1 - np.cos(a)) * K @ K


def theil_sen(x, y):
    i, j = np.triu_indices(len(x), 1)
    dx = x[j] - x[i]
    ok = np.abs(dx) > 1e-6
    return float(np.median((y[j] - y[i])[ok] / dx[ok]))


def ridge_slopes(enh, f, boxes, pairs=()):
    """Slopes (dh/du, dh/dv) of wing ridge lines (98th pct per 3 m bin) inside palace-grid boxes.
    pairs: [[wingA, wingB], ...] of parallel twin wings whose ridges must be equally high (gives the cross slope)."""
    p, _ = C.sample_surface(enh, f, density=4.0)
    u, w = C.en_to_uv(p[:, 0], p[:, 1])
    su, sv, per = [], [], {}
    for name, (axis, u0, u1, v0, v1) in boxes.items():
        sel = (u > u0) & (u < u1) & (w > v0) & (w < v1)
        t = (u if axis == "u" else w)[sel]
        h = p[sel, 2]
        bins = np.arange(t.min(), t.max() + 3, 3.0)
        cx, cy = [], []
        for a, b in zip(bins[:-1], bins[1:]):
            m = (t >= a) & (t < b)
            if m.sum() > 20:
                cx.append((a + b) / 2)
                cy.append(np.percentile(h[m], 98))
        if len(cx) < 5:
            continue
        sl = theil_sen(np.array(cx), np.array(cy))
        per[name] = {"axis": axis, "slope_pct": 100 * sl, "n_bins": len(cx), "ridge_median_h": float(np.median(cy))}
        (su if axis == "u" else sv).append(sl)
        per[name]["centre_uv"] = [float((u0 + u1) / 2), float((v0 + v1) / 2)]
    for a, b in pairs:
        if a in per and b in per and per[a]["axis"] == per[b]["axis"]:
            k = 1 if per[a]["axis"] == "u" else 0  # cross direction
            dist = per[b]["centre_uv"][k] - per[a]["centre_uv"][k]
            sl = (per[b]["ridge_median_h"] - per[a]["ridge_median_h"]) / dist
            per[f"pair {a}/{b}"] = {"axis": "v" if k == 1 else "u", "slope_pct": 100 * sl}
            (sv if k == 1 else su).append(sl)
    return (float(np.median(su)) if su else 0.0), (float(np.median(sv)) if sv else 0.0), per


def court_level(enh, f):
    p, _ = C.sample_surface(enh, f, density=4.0)
    u, w = C.en_to_uv(p[:, 0], p[:, 1])
    sel = (u > -25) & (u < 20) & (w > -14) & (w < 14)
    dsm = C.grid_max(np.column_stack([u[sel], w[sel], p[sel, 2]]), -25, 14, 1.0, 45, 28)
    return float(np.nanmedian(dsm))


def main():
    pk_path = sys.argv[1]
    pk = json.load(open(pk_path))
    run = pk["run"]
    d = os.path.join(C.WORK, "reg", run)
    lv = json.load(open(os.path.join(d, "level.json")))
    dsm = np.load(os.path.join(d, "dsm_top.npy"))[0]
    g = json.load(open(os.path.join(d, "dsm_top.json")))
    feats = {f["properties"]["id"]: f for f in C.load_lidar_features()["features"]}

    # 1. refine segments
    lines = []
    for L in pk["lines"]:
        p0, p1, spread, nst = refine_segment(dsm, g, *L["mesh"], search=L.get("search", pk.get("search", 0.015)))
        a, b = lidar_edge(feats, *L["lidar"])
        lines.append(dict(L, p0=p0, p1=p1, spread=spread, stations=nst, a=a, b=b))
    ctrl = [l for l in lines if l["role"] == "control"]

    def pts_of(l):
        return np.array([l["p0"] + t * (l["p1"] - l["p0"]) for t in (0.25, 0.5, 0.75)])

    def resid(p, ls):
        return np.concatenate([line_dist(sim2(p, pts_of(l)), l["a"], l["b"]) for l in ls])

    # 2. initial guess from two picked anchor pairs (mesh xy -> E,N), then least squares
    A = np.array(pk["init"]["mesh"], float)
    B = np.array(pk["init"]["en"], float)
    va, vb = A[1] - A[0], B[1] - B[0]
    s0 = np.linalg.norm(vb) / np.linalg.norm(va)
    th0 = np.arctan2(vb[1], vb[0]) - np.arctan2(va[1], va[0])
    t0 = B[0] - sim2([s0, th0, 0, 0], A[:1])[0]
    x0 = np.array([s0, th0, *t0])
    sol = least_squares(resid, x0, args=(ctrl,), loss="soft_l1", f_scale=1.5, x_scale=[s0 * 0.05, 0.02, 5, 5])
    p = sol.x
    r = resid(p, ctrl)
    dof = max(1, len(r) - 4)
    sigma2 = (r ** 2).sum() / dof
    J = sol.jac
    cov = np.linalg.pinv(J.T @ J) * sigma2
    sd = np.sqrt(np.diag(cov))

    # scale sensitivity: refit with alternative control sets (systematic HMS-vs-LiDAR proportion differences)
    variants = {}
    for vname, spec in pk.get("variants", {}).items():
        names = set(spec.get("add", []))
        drop = set(spec.get("drop", []))
        ls = [l for l in lines if (l["role"] == "control" and l["name"] not in drop) or l["name"] in names]
        sv = least_squares(resid, p, args=(ls,), loss="soft_l1", f_scale=1.5, x_scale=[s0 * 0.05, 0.02, 5, 5])
        rv = resid(sv.x, ls)
        variants[vname] = {"scale_m_per_unit": float(sv.x[0]), "scale_vs_main_pct": float(100 * (sv.x[0] / p[0] - 1)),
                           "rotation_deg": float(np.degrees(sv.x[1])), "rms_m": float(np.sqrt(np.mean(rv ** 2))),
                           "controls": [l["name"] for l in ls]}
        print(f"  variant {vname}: s {sv.x[0]:.2f} ({variants[vname]['scale_vs_main_pct']:+.1f} %), rms {variants[vname]['rms_m']:.2f} m")

    # 3. vertical datum from the court pavement
    zs = []
    for bx in pk["ground"]:
        sub = dsm[int((g["y1"] - bx[3]) / g["res"]):int((g["y1"] - bx[2]) / g["res"]),
                  int((bx[0] - g["x0"]) / g["res"]):int((bx[1] - g["x0"]) / g["res"])]
        zs.append(np.nanpercentile(sub, 30))
    zg = float(np.median(zs))
    s, th, te, tn = p

    # composite 7-parameter transform: raw mesh -> levelled (R0, centre) -> (E, N, h)
    R0 = np.array(lv["R0"])
    cen = np.array(lv["centre"])
    Rz = np.array([[np.cos(th), -np.sin(th), 0], [np.sin(th), np.cos(th), 0], [0, 0, 1]])
    R_tot = Rz @ R0
    t_tot = np.array([te, tn, C.COURT_H - s * zg]) - s * R_tot @ cen
    # tilt of the levelled 'up' vs camera-roll evidence (reported only)
    out = {
        "run": run, "picks": os.path.relpath(pk_path, C.V2W),
        "scale_m_per_unit": s, "scale_sd": float(sd[0]), "scale_rel_sd_pct": float(100 * sd[0] / s),
        "rotation_deg": float(np.degrees(th)), "rotation_sd_deg": float(np.degrees(sd[1])),
        "translation_EN": [te, tn], "translation_sd_m": [float(sd[2]), float(sd[3])],
        "court_mesh_z": zg, "court_h": C.COURT_H, "ground_box_z_spread_m": float(np.ptp(zs) * s) if len(zs) > 1 else None,
        "camera_roll_deg": lv["camera_roll_deg"],
        "similarity_7p": {"s": s, "R": R_tot.tolist(), "t": t_tot.tolist(),
                          "note": "[E,N,h] = s * R @ p_raw + t  (p_raw = Object Capture OBJ vertex)"},
        "lines": [],
        "variants": variants,
    }
    rms_c = []
    for l in lines:
        rr = line_dist(sim2(p, pts_of(l)), l["a"], l["b"])
        if l["role"] == "control":
            rms_c.extend(rr)
        out["lines"].append({"name": l["name"], "role": l["role"], "lidar": l["lidar"],
                             "residual_m_25_50_75": [round(float(x), 2) for x in rr],
                             "edge_spread_m": round(float(l["spread"] * s), 2) if np.isfinite(l["spread"]) else None,
                             "stations": l["stations"],
                             "mesh_refined": [l["p0"].round(4).tolist(), l["p1"].round(4).tolist()]})
    out["control_rms_m"] = float(np.sqrt(np.mean(np.square(rms_c))))
    chk = [x for l in out["lines"] if l["role"] == "check" for x in l["residual_m_25_50_75"]]
    out["check_rms_m"] = float(np.sqrt(np.mean(np.square(chk)))) if chk else None

    # cross-check: Umeyama on 3D pairs (control points -> their foot points on the LiDAR lines, at court level)
    src, dst = [], []
    for l in ctrl:
        for q in pts_of(l):
            en = sim2(p, q[None])[0]
            dd = (l["b"] - l["a"]) / np.linalg.norm(l["b"] - l["a"])
            foot = l["a"] + ((en - l["a"]) @ dd) * dd
            raw = R0.T @ np.array([q[0], q[1], zg]) + cen
            src.append(raw)
            dst.append([foot[0], foot[1], C.COURT_H])
    su, Ru, tu = C.umeyama(np.array(src), np.array(dst))
    out["umeyama_check"] = {"s": su, "R_angle_to_7p_deg": float(np.degrees(np.arccos(np.clip((np.trace(Ru.T @ R_tot) - 1) / 2, -1, 1)))),
                            "note": "control points are coplanar (court level), so Umeyama's tilt is weakly constrained; up comes from level.py"}
    json.dump(out, open(os.path.join(d, "registration.json"), "w"), indent=1)
    print(f"{run}: s = {s:.2f} +- {sd[0]:.2f} m/unit ({100 * sd[0] / s:.1f} %), rot {np.degrees(th):.2f} deg, "
          f"control RMS {out['control_rms_m']:.2f} m, check RMS {out['check_rms_m']}")
    for l in out["lines"]:
        print(f"  {l['role']:7s} {l['name']:40s} {l['residual_m_25_50_75']} spread {l['edge_spread_m']}")

    if "--no-export" in sys.argv:
        return
    m = np.load(os.path.join(d, "levelled_mesh.npz"))
    vl, f = m["v"], m["f"]
    enh = np.column_stack([sim2(p, vl[:, :2]), C.COURT_H + s * (vl[:, 2] - zg)])
    # 5. solve 'up' finally from the roofs: ridges of long wings are horizontal -> remove residual tilt
    R_tilt = np.eye(3)
    pivot = np.array([C.PG_E, C.PG_N, C.COURT_H])
    tilt_log = []
    for it in range(3):
        bu, bv, per = ridge_slopes(enh, f, pk.get("ridge_boxes", {}), pk.get("ridge_pairs", []))
        gE = bu * C._CU - bv * C._SU
        gN = bu * C._SU + bv * C._CU
        nrm = np.array([-gE, -gN, 1.0])
        nrm /= np.linalg.norm(nrm)
        Rk = rot_to_z(nrm)
        enh = (enh - pivot) @ Rk.T + pivot
        R_tilt = Rk @ R_tilt
        dz = C.COURT_H - court_level(enh, f)
        enh[:, 2] += dz
        tilt_log.append({"iter": it, "slope_u_pct": 100 * bu, "slope_v_pct": 100 * bv, "datum_shift_m": dz, "per_wing": per})
        print(f"  tilt iter {it}: ridge slope u {100 * bu:+.2f} %, v {100 * bv:+.2f} % ({np.degrees(np.arctan(np.hypot(bu, bv))):.2f} deg), datum shift {dz:+.2f} m")
    out["tilt_from_ridges"] = {"iterations": tilt_log,
                               "total_tilt_deg": float(np.degrees(np.arccos(np.clip(R_tilt[2, 2], -1, 1)))),
                               "note": "rotation about the court centre so that wing ridges are horizontal; levelled 'up' from normals had this residual tilt"}
    # final composite similarity raw -> ENh (R_tilt about pivot, then datum shift folded into t)
    R_fin = R_tilt @ R_tot
    probe = np.array(lv["centre"])
    probe_enh = enh_of_raw = None
    t_fin = None
    # derive t from the first vertex: enh[0] = s * R_fin @ raw0 + t
    raw0 = R0.T @ vl[0] + cen
    t_fin = enh[0] - s * R_fin @ raw0
    out["similarity_7p"] = {"s": s, "R": R_fin.tolist(), "t": t_fin.tolist(),
                            "note": "[E,N,h] = s * R @ p_raw + t  (p_raw = Object Capture OBJ vertex); includes ridge tilt fix"}
    chk_v = s * (np.array(R_fin) @ (R0.T @ vl[:200].T + cen[:, None])).T + t_fin
    out["similarity_7p"]["max_check_err_m"] = float(np.abs(chk_v - enh[:200]).max())
    json.dump(out, open(os.path.join(d, "registration.json"), "w"), indent=1)
    np.savez_compressed(os.path.join(d, "registered_enh.npz"), v=enh, f=f)
    loc = C.enh_to_local(enh)
    hdr = (f"HMS 2022 reference mesh ({run}), (c) Matzerath/Historisches Museum Saar - private reference, never publish.\n"
           f"Explorer frame x=E-381000, y=h (DHHN2016), z=-(N-5465000); registration: video2world/work/reg/{run}/registration.json")
    C.write_obj(os.path.join(d, "registered_local.obj"), loc, f, hdr)
    write_glb(os.path.join(d, "registered_local.glb"), loc, f)
    print("exported", len(loc), "vertices")


main()
