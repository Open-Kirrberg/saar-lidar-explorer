"""Extract per-shot frames from the HMS video for Object Capture, with caption masks.

Usage (from video2world/):  python3 -I scripts/extract_frames.py [S04 S06 ...]   (default: all shots)
Writes work/frames/<shot>/f_XXXX.jpg (3840x2160, q=2) and work/frames/<combo>/ (symlinks) for combined runs.
Masks (captions, leader-line labels, sky) are painted mid-grey with ffmpeg drawbox, active only in the
given source-time window (-copyts keeps source PTS so `t` in the filter = time in the video).
Outputs are git-ignored (video2world/work/); the video is (c) Matzerath/HMS - never commit frames.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # video2world/
cfg = json.load(open(os.path.join(HERE, "shots.json")))
video = os.path.join(ROOT, cfg["video"])
want = sys.argv[1:] or list(cfg["shots"])

for sid in want:
    s = cfg["shots"][sid]
    out = os.path.join(ROOT, "work", "frames", sid)
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        os.remove(os.path.join(out, f))
    t0, t1 = s["t"]
    filt = [f"fps={s['fps']}"]
    for m in s["masks"]:
        x0, y0, x1, y1 = m["box"]
        a, b = m["t"]
        filt.append(
            f"drawbox=x=iw*{x0}:y=ih*{y0}:w=iw*{x1 - x0}:h=ih*{y1 - y0}:color=0x808080:t=fill"
            f":enable='between(t,{a},{b})'"
        )
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-copyts", "-ss", str(t0), "-to", str(t1),
           "-i", video, "-vf", ",".join(filt), "-q:v", "2", os.path.join(out, "f_%04d.jpg")]
    subprocess.run(cmd, check=True)
    print(sid, len(os.listdir(out)), "frames")

for combo, members in cfg.get("combined", {}).items():
    if not all(os.path.isdir(os.path.join(ROOT, "work", "frames", m)) for m in members):
        continue
    out = os.path.join(ROOT, "work", "frames", combo)
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        os.remove(os.path.join(out, f))
    n = 0
    for m in members:
        src = os.path.join(ROOT, "work", "frames", m)
        for f in sorted(os.listdir(src)):
            os.symlink(os.path.join(src, f), os.path.join(out, f"{m}_{f}"))
            n += 1
    print(combo, n, "frames (symlinks)")
