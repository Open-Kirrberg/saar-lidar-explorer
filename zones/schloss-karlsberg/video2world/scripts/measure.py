"""Measure wing dimensions, eaves/break/ridge heights and roof pitches from a registered HMS reference mesh.

Usage (from pipeline/): uv run python -I ../zones/schloss-karlsberg/video2world/scripts/measure.py <RUN> [<RUN2> ...]
Input : work/reg/<RUN>/registered_enh.npz (+ registration.json for the scale uncertainty), scripts/measure_spec.json
Output: work/measure/<RUN>.json and work/renders/<RUN>_profiles.png (HMS-derived: work/ only).

Per building (palace grid u/v boxes):
  - a median DSM cross-profile (0.5 m cells, max-z of 16 pts/m^2 surface samples) over the 'cross' band;
  - each half-profile is fitted with a blurred piecewise model: ground g | vertical wall at x_w up to eaves e |
    lower roof slope (inset d1) up to break b | upper slope (inset d2) up to top r | flat deck. Hip roofs: d1 = 0.
    -> eaves, break, top above ground, pitches atan((b-e)/d1), atan((r-b)/d2), wall position;
  - face sharpness: horizontal distance between the g+3 m and e-1 m crossings (< 1.5 m = face seen by the camera,
    larger = 'skirt' on an unseen side, dimension there is an upper bound);
  - length from the long profile (e-1 m crossings);
  - spire/Dachreiter: max and 99.5th percentile of surface points in the box.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.optimize import least_squares

import v2w_common as C

RES = 0.5


def model(params, x, roof):
    """Half profile; x = inward distance coordinate (grid), params in that frame."""
    if roof == "hip":
        xw, g, e, d2, r, sig = params
        d1, b = 1e-3, e
    else:
        xw, g, e, d1, b, d2, r, sig = params
    t = x - xw
    h = np.where(t < 0, g, r)
    m1 = (t >= 0) & (t < d1)
    h = np.where(m1, e + (b - e) * t / max(d1, 1e-3), h)
    m2 = (t >= d1) & (t < d1 + d2)
    h = np.where(m2, b + (r - b) * (t - d1) / max(d2, 1e-3), h)
    fine = RES / 5
    xf = np.arange(x.min() - 3, x.max() + 3, fine)
    tf = xf - xw
    hf = np.where(tf < 0, g, r)
    hf = np.where((tf >= 0) & (tf < d1), e + (b - e) * tf / max(d1, 1e-3), hf)
    hf = np.where((tf >= d1) & (tf < d1 + d2), b + (r - b) * (tf - d1) / max(d2, 1e-3), hf)
    hf = gaussian_filter1d(hf, max(sig, 0.05) / fine, mode="nearest")
    return np.interp(x, xf, hf)


def fit_half(x, h, roof, g0):
    """x: inward coordinate (0 = outside start, increasing towards the centre)."""
    ok = np.isfinite(h)
    x, h = x[ok], h[ok]
    if len(x) < 10:
        return None
    top = np.nanpercentile(h, 97)
    jump = x[np.argmax(h > g0 + 0.5 * (top - g0))] if np.any(h > g0 + 0.5 * (top - g0)) else x[len(x) // 3]
    span = x.max() - jump
    if roof == "hip":
        p0 = [jump, g0, g0 + 0.55 * (top - g0), min(5, span * 0.6), top, 0.5]
        lo = [jump - 4, g0 - 3, g0 + 3, 0.5, g0 + 4, 0.05]
        hi = [jump + 4, g0 + 3, top + 1, span + 1, top + 3, 3]
    else:
        p0 = [jump, g0, g0 + 0.6 * (top - g0), 1.5, g0 + 0.85 * (top - g0), 3.0, top, 0.5]
        lo = [jump - 4, g0 - 3, g0 + 3, 0.2, g0 + 4, 0.3, g0 + 5, 0.05]
        hi = [jump + 4, g0 + 3, top + 1, 5.0, top + 1, span + 1, top + 3, 3]
    p0 = np.clip(p0, np.array(lo) + 1e-6, np.array(hi) - 1e-6)

    def res(p):
        pen = []
        if roof != "hip":
            pen = [max(0, p[2] - p[4]) * 10, max(0, p[4] - p[6]) * 10]  # e <= b <= r
        else:
            pen = [max(0, p[2] - p[4]) * 10]
        return np.concatenate([model(p, x, roof) - h, pen])

    best = None
    for d1s in ([1.0, 2.0, 3.0] if roof != "hip" else [None]):
        q0 = list(p0)
        if d1s is not None:
            q0[3] = d1s
        s = least_squares(res, q0, bounds=(lo, hi), loss="soft_l1", f_scale=0.5)
        if best is None or s.cost < best.cost:
            best = s
    p = best.x
    rms = float(np.sqrt(np.mean((model(p, x, roof) - h) ** 2)))
    if roof == "hip":
        xw, g, e, d2, r, sig = p
        d1, b = 0.0, e
    else:
        xw, g, e, d1, b, d2, r, sig = p
    return {"wall_x": float(xw), "ground": float(g), "eaves": float(e), "break": float(b), "top": float(r),
            "inset_lower": float(d1), "inset_upper": float(d2), "blur_sigma": float(sig), "rms": rms,
            "pitch_lower_deg": float(np.degrees(np.arctan2(b - e, d1))) if d1 > 0.05 else None,
            "pitch_upper_deg": float(np.degrees(np.arctan2(r - b, d2))) if d2 > 0.05 else None}


def crossing(x, h, level, from_left=True):
    idx = np.where(np.isfinite(h) & (h >= level))[0]
    if len(idx) == 0:
        return None
    i = idx[0] if from_left else idx[-1]
    j = i - 1 if from_left else i + 1
    if j < 0 or j >= len(h) or not np.isfinite(h[j]):
        return float(x[i])
    return float(x[j] + (level - h[j]) * (x[i] - x[j]) / (h[i] - h[j]))


def measure_building(name, b, U, V, H):
    u0, u1, v0, v1 = b["box"]
    sel = (U >= u0) & (U <= u1) & (V >= v0) & (V <= v1)
    nu, nv = int(round((u1 - u0) / RES)), int(round((v1 - v0) / RES))
    dsm = C.grid_max(np.column_stack([U[sel], V[sel], H[sel]]), u0, v1, RES, nu, nv)  # rows: v1 -> v0
    uc = u0 + (np.arange(nu) + 0.5) * RES
    vc = v1 - (np.arange(nv) + 0.5) * RES
    ax = b["axis"]
    out = {"catalogue": b["catalogue"], "box_uv": b["box"], "axis": ax, "roof_model": b["roof"]}

    def cross_profile(band):
        if ax == "u":  # building runs along u: cross profile along v (rows)
            cols = (uc >= band[0]) & (uc <= band[1])
            return vc[::-1], np.nanmedian(dsm[:, cols], axis=1)[::-1]
        rows = (vc >= band[0]) & (vc <= band[1])
        return uc, np.nanmedian(dsm[rows, :], axis=0)

    bands = [b["cross"]] + ([b["cross2"]] if "cross2" in b else [])
    x, h = cross_profile(bands[0])
    if len(bands) > 1:
        x2, h2 = cross_profile(bands[1])
        h = np.nanmean(np.vstack([h, h2]), axis=0)
    if b["ground"] == "court":
        g0 = C.COURT_H
    elif b["ground"] == "fit":
        g0 = float(np.nanpercentile(h, 5))
    else:
        g0 = float(b["ground"])
    mid = np.nanargmax(gaussian_filter1d(np.nan_to_num(h, nan=g0), 4))
    halves = {}
    for side, (xs, hs) in {"low": (x[: mid + 1], h[: mid + 1]), "high": (x[mid:][::-1], h[mid:][::-1])}.items():
        inward = np.abs(xs - xs[0])
        fr = fit_half(inward, hs, b["roof"], g0)
        if fr is None:
            continue
        sign = 1 if side == "low" else -1
        fr["wall_pos"] = float(xs[0] + sign * fr["wall_x"])
        e = fr["eaves"]
        p_lo = crossing(inward, hs, g0 + 3.0)
        p_hi = crossing(inward, hs, e - 1.0)
        fr["face_g3_pos"] = float(xs[0] + sign * p_lo) if p_lo is not None else None
        fr["face_eaves_minus1_pos"] = float(xs[0] + sign * p_hi) if p_hi is not None else None
        fr["sharpness_m"] = float(abs(p_hi - p_lo)) if (p_lo is not None and p_hi is not None) else None
        fr["sharp"] = bool(fr["sharpness_m"] is not None and fr["sharpness_m"] < 1.5)
        halves[side] = fr
    out["cross_axis"] = "v" if ax == "u" else "u"
    out["halves"] = halves
    out["profile"] = {"x": x.round(2).tolist(), "h": [None if not np.isfinite(t) else round(float(t), 2) for t in h]}
    if "low" in halves and "high" in halves:
        lo_, hi_ = halves["low"], halves["high"]
        out["width_walls_fit_m"] = abs(hi_["wall_pos"] - lo_["wall_pos"])
        if lo_["face_eaves_minus1_pos"] is not None and hi_["face_eaves_minus1_pos"] is not None:
            out["width_upper_wall_m"] = abs(hi_["face_eaves_minus1_pos"] - lo_["face_eaves_minus1_pos"])
        sharp = [hh for hh in (lo_, hi_) if hh["sharp"]] or [lo_, hi_]
        best = min(sharp, key=lambda q: q["rms"])
        out["best_side"] = "low" if best is lo_ else "high"
        out["heights_above_ground"] = {k: best[k] - best["ground"] for k in ("eaves", "break", "top")}
        out["heights_abs"] = {k: best[k] for k in ("ground", "eaves", "break", "top")}
        out["pitch_lower_deg"] = best["pitch_lower_deg"]
        out["pitch_upper_deg"] = best["pitch_upper_deg"]
        # flat deck width between the two upper-slope ends
        out["deck_width_m"] = max(0.0, out["width_walls_fit_m"] - sum(q["inset_lower"] + q["inset_upper"] for q in (lo_, hi_)))
    # long profile
    if ax == "u":
        rows = (vc >= b["long"][0]) & (vc <= b["long"][1])
        lx, lh = uc, np.nanmedian(dsm[rows, :], axis=0)
    else:
        cols = (uc >= b["long"][0]) & (uc <= b["long"][1])
        lx, lh = vc[::-1], np.nanmedian(dsm[:, cols], axis=1)[::-1]
    if "heights_abs" in out:
        lev = out["heights_abs"]["eaves"] - 1.0
        a_ = crossing(lx, lh, lev, True)
        b_ = crossing(lx, lh, lev, False)
        a3 = crossing(lx, lh, out["heights_abs"]["ground"] + 3.0, True)
        b3 = crossing(lx, lh, out["heights_abs"]["ground"] + 3.0, False)
        out["long_ends_eaves_minus1"] = [a_, b_]
        out["long_ends_g3"] = [a3, b3]
        if a_ is not None and b_ is not None:
            out["length_m"] = b_ - a_
    out["long_profile"] = {"x": lx.round(2).tolist(), "h": [None if not np.isfinite(t) else round(float(t), 2) for t in lh]}
    if b.get("spire"):
        hh = H[sel]
        out["spire_max_h"] = float(hh.max())
        out["spire_p995_h"] = float(np.percentile(hh, 99.5))
        k = np.argmax(hh)
        out["spire_max_uv"] = [float(U[sel][k]), float(V[sel][k])]
    return out


def main():
    spec = json.load(open(os.path.join(C.V2W, "scripts", "measure_spec.json")))
    for run in sys.argv[1:]:
        d = os.path.join(C.WORK, "reg", run)
        m = np.load(os.path.join(d, "registered_enh.npz"))
        reg = json.load(open(os.path.join(d, "registration.json")))
        p, _ = C.sample_surface(m["v"], m["f"], density=16.0, rng=np.random.default_rng(1))
        U, V = C.en_to_uv(p[:, 0], p[:, 1])
        H = p[:, 2]
        res = {"run": run, "scale_m_per_unit": reg["scale_m_per_unit"], "scale_rel_sd_pct": reg["scale_rel_sd_pct"],
               "control_rms_m": reg["control_rms_m"], "buildings": {}}
        n = len(spec["buildings"])
        fig, axs = plt.subplots(n, 2, figsize=(16, 3.0 * n), dpi=80)
        for i, (name, b) in enumerate(spec["buildings"].items()):
            r = measure_building(name, b, U, V, H)
            res["buildings"][name] = r
            ax = axs[i, 0]
            x = np.array(r["profile"]["x"])
            h = np.array([np.nan if t is None else t for t in r["profile"]["h"]])
            ax.plot(x, h, "k.", ms=2)
            for side, hh in r["halves"].items():
                xs = x if side == "low" else x[::-1]
                mid_ok = True
                ax.axvline(hh["wall_pos"], color="r" if hh["sharp"] else "orange", lw=0.8)
                ax.axhline(hh["eaves"], color="b", lw=0.5, ls="--")
                ax.axhline(hh["break"], color="g", lw=0.5, ls="--")
                ax.axhline(hh["top"], color="m", lw=0.5, ls="--")
            ax.set_title(f"{name}: cross-profile along {r['cross_axis']}", fontsize=8)
            ax.set_aspect("equal", adjustable="datalim")
            ax.grid(alpha=0.3)
            ax2 = axs[i, 1]
            lx = np.array(r["long_profile"]["x"])
            lh = np.array([np.nan if t is None else t for t in r["long_profile"]["h"]])
            ax2.plot(lx, lh, "k.", ms=2)
            for e_ in r.get("long_ends_eaves_minus1", []):
                if e_ is not None:
                    ax2.axvline(e_, color="r", lw=0.8)
            ax2.set_title(f"{name}: long profile along {r['axis']}", fontsize=8)
            ax2.grid(alpha=0.3)
            hs = r.get("heights_above_ground", {})
            print(f"{run} {name:30s} W={r.get('width_walls_fit_m', float('nan')):5.1f} (upper {r.get('width_upper_wall_m', float('nan')):5.1f}) "
                  f"L={r.get('length_m', float('nan')):5.1f}  eaves {hs.get('eaves', float('nan')):5.1f} break {hs.get('break', float('nan')):5.1f} "
                  f"top {hs.get('top', float('nan')):5.1f}  pitch {r.get('pitch_lower_deg')} / {r.get('pitch_upper_deg')}  "
                  f"sharp {[ (k, round(v['sharpness_m'] or -1, 1), round(v['rms'], 2)) for k, v in r['halves'].items()]}"
                  + (f" spire {r['spire_max_h']:.1f} p99.5 {r['spire_p995_h']:.1f}" if 'spire_max_h' in r else ""))
        fig.tight_layout()
        fig.savefig(os.path.join(C.WORK, "renders", f"{run}_profiles.png"))
        os.makedirs(os.path.join(C.WORK, "measure"), exist_ok=True)
        json.dump(res, open(os.path.join(C.WORK, "measure", f"{run}.json"), "w"), indent=1)


main()
