"""Stage `frames`: analyse every video frame (sharpness, motion), pick keyframes, extract them at full resolution.

Analysis decodes the video once at low resolution through an ffmpeg pipe (grey, `analysis_width` px wide):
  sharpness  variance of the Laplacian on the central 70 % (fisheye corners are soft anyway)
  flow       median optical-flow displacement to the previous frame (Lucas-Kanade on Shi-Tomasi corners), in
             fractions of the frame width -- a scale-free proxy for how much the view changed (overlap)
Selection (`select_frames`, pure, tested) walks the cumulative flow: the next keyframe is the sharpest frame whose
accumulated flow since the last keyframe lies in [lo, hi] x step; a hard `max_gap` bounds gaps in slow passages.
"""
from __future__ import annotations

import subprocess
import sys

import numpy as np

from .common import Zone, save_json, load_json


def probe(video) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries",
         "stream=width,height,r_frame_rate,nb_read_packets", "-of", "json", str(video)],
        check=True, capture_output=True, text=True).stdout
    import json
    s = json.loads(out)["streams"][0]
    num, den = (int(x) for x in s["r_frame_rate"].split("/"))
    return {"width": int(s["width"]), "height": int(s["height"]), "fps": num / den, "frames": int(s["nb_read_packets"])}


def analyse(video, width: int = 960) -> dict:
    import cv2

    info = probe(video)
    w = width
    h = int(round(info["height"] * w / info["width"] / 2) * 2)
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(video), "-an", "-vf", f"scale={w}:{h}:flags=area",
           "-pix_fmt", "gray", "-f", "rawvideo", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, bufsize=w * h * 4)
    sharp, flow, bright = [], [], []
    prev, prev_pts = None, None
    y0, y1, x0, x1 = int(h * 0.15), int(h * 0.85), int(w * 0.15), int(w * 0.85)
    lk = dict(winSize=(21, 21), maxLevel=3, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 20, 0.03))
    n = 0
    while True:
        buf = proc.stdout.read(w * h)
        if len(buf) < w * h:
            break
        g = np.frombuffer(buf, np.uint8).reshape(h, w)
        sharp.append(float(cv2.Laplacian(g[y0:y1, x0:x1], cv2.CV_32F).var()))
        bright.append(float(g.mean()))
        small = cv2.resize(g, (w // 2, h // 2), interpolation=cv2.INTER_AREA)
        if prev is None or prev_pts is None or len(prev_pts) < 20:
            flow.append(np.nan if prev is None else 0.0)
            if prev is not None and prev_pts is None:
                pass
        else:
            nxt, st, _ = cv2.calcOpticalFlowPyrLK(prev, small, prev_pts, None, **lk)
            ok = st.ravel() == 1
            d = np.linalg.norm((nxt - prev_pts).reshape(-1, 2)[ok], axis=1)
            flow.append(float(np.median(d)) / (w / 2) if ok.sum() >= 10 else np.nan)
        prev = small
        prev_pts = cv2.goodFeaturesToTrack(small, maxCorners=400, qualityLevel=0.01, minDistance=8)
        n += 1
        if n % 500 == 0:
            print(f"   analysed {n}/{info['frames']}", flush=True)
    proc.wait()
    flow_a = np.array(flow, float)
    # frames without a flow estimate (first frame, texture-less) get the local median
    bad = ~np.isfinite(flow_a)
    if bad.any():
        flow_a[bad] = np.nanmedian(flow_a) if np.isfinite(flow_a).any() else 0.0
    return {**info, "analysis_width": w, "sharpness": sharp, "flow": flow_a.tolist(), "brightness": bright}


def relative_sharpness(sharp: np.ndarray, window: int) -> np.ndarray:
    """Sharpness divided by its rolling median (scene content changes absolute Laplacian variance a lot)."""
    s = np.asarray(sharp, float)
    n = len(s)
    half = max(1, window // 2)
    med = np.empty(n)
    for i in range(n):
        med[i] = np.median(s[max(0, i - half): min(n, i + half + 1)])
    return s / np.maximum(med, 1e-9)


def select_frames(sharp, flow, step: float, lo: float = 0.6, hi: float = 1.0, max_gap: int = 30,
                  min_rel_sharp: float = 0.0, window: int = 31) -> list[int]:
    """Pick keyframe indices.

    sharp   per-frame sharpness (any positive scale; made relative to a rolling median of `window` frames)
    flow    per-frame displacement to the previous frame (flow[0] ignored), same unit as `step`
    step    target accumulated displacement between keyframes (smaller = more overlap, more frames)
    Rule: after keyframe s, candidates are frames j > s with cumulative flow C[j] - C[s] in [lo*step, hi*step] and
    j - s <= max_gap; the sharpest candidate (relative) wins. If no frame falls into the band (fast motion), the next
    frame s+1 is taken; candidates below `min_rel_sharp` are skipped unless nothing else qualifies.
    The first frame is the sharpest within the first band; the last frame is always covered (gap <= max_gap).
    """
    sharp = np.asarray(sharp, float)
    flow = np.asarray(flow, float).copy()
    n = len(sharp)
    if n == 0:
        return []
    if len(flow) != n:
        raise ValueError("sharp and flow must have the same length")
    if step <= 0:
        raise ValueError("step must be > 0")
    flow[0] = 0.0
    flow = np.nan_to_num(np.clip(flow, 0, None))
    rel = relative_sharpness(sharp, window)
    cum = np.cumsum(flow)

    def best(cands: np.ndarray) -> int:
        good = cands[rel[cands] >= min_rel_sharp]
        pool = good if len(good) else cands
        return int(pool[np.argmax(rel[pool])])

    # first keyframe: sharpest frame within the first band
    first = np.nonzero((cum <= hi * step) & (np.arange(n) < max_gap))[0]
    sel = [best(first if len(first) else np.array([0]))]
    while True:
        s = sel[-1]
        if s >= n - 1:
            break
        j = np.arange(s + 1, min(n, s + max_gap + 1))
        acc = cum[j] - cum[s]
        eps = 1e-9 * step
        band = j[(acc >= lo * step - eps) & (acc <= hi * step + eps)]
        if len(band):
            nxt = best(band)
        elif acc[0] > hi * step:  # moving fast: take the very next frame
            nxt = int(j[0])
        elif acc[-1] >= lo * step:  # the band falls between two frames: the one closest to the target step
            nxt = int(j[np.argmin(np.abs(acc - step))])
        elif j[-1] == n - 1:  # tail end without enough motion
            if n - 1 - s >= max_gap // 2:
                nxt = best(j[len(j) // 2:])
            else:
                break
        else:  # slow motion: no frame reaches the band within max_gap -> sharpest among the later half
            nxt = best(j[len(j) // 2:])
        if nxt <= s:
            nxt = s + 1
        sel.append(nxt)
    return sel


def select_expr(idx: list[int]) -> str:
    """ffmpeg `select` expression for frame numbers, as a balanced sum tree (a flat a+b+c... chain of a few hundred
    terms fails to parse with ENOMEM in ffmpeg 9)."""
    if len(idx) == 1:
        return f"eq(n,{idx[0]})"
    m = len(idx) // 2
    return f"({select_expr(idx[:m])}+{select_expr(idx[m:])})"


def extract(video, idx: list[int], out_dir, quality: int = 2) -> None:
    """Write the selected frames as JPEG f_<frameno>.jpg (one ffmpeg decode; `select` by frame number)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    for f in out_dir.glob("*.jpg"):
        f.unlink()
    # one decode pass; the select expression is read from a file (ffmpeg >= 7: `-/vf <file>`)
    expr = select_expr(sorted(idx))
    script = out_dir.parent / f"{out_dir.name}_select.txt"
    script.write_text(f"select='{expr}'")
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(video), "-an",
           "-/vf", str(script), "-fps_mode", "passthrough", "-q:v", str(quality),
           str(out_dir / "seq_%05d.jpg")]
    subprocess.run(cmd, check=True)
    got = sorted(out_dir.glob("seq_*.jpg"))
    if len(got) != len(idx):
        raise RuntimeError(f"extracted {len(got)} frames, expected {len(idx)}")
    for p, i in zip(got, sorted(idx)):  # select keeps decode order -> k-th output = k-th selected frame number
        p.rename(out_dir / f"f_{i:05d}.jpg")
    script.unlink()


def run(zone: Zone) -> dict:
    cfg = zone.cfg["frames"]
    ana_p = zone.work / "frames_analysis.json"
    if ana_p.exists():
        ana = load_json(ana_p)
    else:
        ana = analyse(zone.video, cfg.get("analysis_width", 960))
        save_json(ana_p, ana, indent=None)
    sharp = np.array(ana["sharpness"])
    flow = np.array(ana["flow"])
    t0, t1 = cfg.get("time_range", [0, ana["frames"] / ana["fps"]])
    f0, f1 = int(t0 * ana["fps"]), min(len(sharp), int(np.ceil(t1 * ana["fps"])))
    sel = select_frames(sharp[f0:f1], flow[f0:f1], step=cfg["step"], lo=cfg.get("lo", 0.6), hi=cfg.get("hi", 1.0),
                        max_gap=cfg.get("max_gap", 30), min_rel_sharp=cfg.get("min_rel_sharp", 0.7))
    sel = [f0 + i for i in sel]
    rel = relative_sharpness(sharp, 31)
    stats = {"selected": len(sel), "of_frames": len(sharp), "median_gap": float(np.median(np.diff(sel))),
             "max_gap": int(np.max(np.diff(sel))), "median_rel_sharpness": float(np.median(rel[sel])),
             "all_median_rel_sharpness": float(np.median(rel))}
    print("   selection:", stats, flush=True)
    save_json(zone.work / "frames_selected.json", {"frames": sel, "fps": ana["fps"], "stats": stats})
    extract(zone.video, sel, zone.work / "frames" / "raw")
    return stats
