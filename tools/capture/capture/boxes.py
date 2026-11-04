"""Pure box logic for the privacy stage: IoU, NMS-style merging, tracks across keyframes, gap filling, plate zones.

Boxes are [x0, y0, x1, y1] in pixels (origin top-left). Frames are identified by their video frame number; the
keyframes of a zone are a sorted list of those numbers, and "gap" counts keyframes, not video frames.
"""
from __future__ import annotations

import math
import re

Box = list[float]

PLATE_RE = re.compile(r"^[A-ZÄÖÜ]{1,3}[\s\-:·.]*[A-Z]{1,2}[\s\-.]*\d{1,4}[EH]?$")


def looks_like_plate(text: str) -> bool:
    """German licence plate text as OCR returns it ("HOM-AB 123", "HOM AB123E"); case-insensitive."""
    return bool(PLATE_RE.match(text.strip().upper()))


def area(b: Box) -> float:
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def iou(a: Box, b: Box) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    u = area(a) + area(b) - inter
    return inter / u if u > 0 else 0.0


def overlap_min(a: Box, b: Box) -> float:
    """Intersection over the smaller box (catches a box split at a tile border or nested in another)."""
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    m = min(area(a), area(b))
    return ix * iy / m if m > 0 else 0.0


def union(a: Box, b: Box) -> Box:
    return [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]


def merge_boxes(boxes: list[Box], thr: float = 0.5) -> list[Box]:
    """Repeatedly union boxes whose overlap_min >= thr (tile-split or duplicate detections of one object)."""
    out = [list(b) for b in boxes]
    changed = True
    while changed:
        changed = False
        for i in range(len(out)):
            for j in range(i + 1, len(out)):
                if overlap_min(out[i], out[j]) >= thr:
                    out[i] = union(out[i], out[j])
                    del out[j]
                    changed = True
                    break
            if changed:
                break
    return out


def pad_box(b: Box, frac: float, px: float, w: int, h: int) -> Box:
    """Grow a box by `frac` of its size plus `px` on every side, clipped to the image."""
    dx = (b[2] - b[0]) * frac + px
    dy = (b[3] - b[1]) * frac + px
    return [max(0.0, b[0] - dx), max(0.0, b[1] - dy), min(float(w), b[2] + dx), min(float(h), b[3] + dy)]


def plate_zone(car: Box, small_px: float = 120, lower: float = 0.6) -> Box:
    """Where a vehicle's plates can be: the lower `lower` part of its box (bumpers, any view angle).
    Small (far) vehicles are blurred whole -- the box is too coarse to localise the plate."""
    h = car[3] - car[1]
    if h < small_px:
        return list(car)
    return [car[0], car[3] - lower * h, car[2], car[3]]


def similar(a: Box, b: Box, iou_min: float = 0.1, dist_frac: float = 0.75) -> bool:
    """Same object in two nearby keyframes: overlapping, or centres closer than dist_frac x the larger diagonal."""
    if iou(a, b) >= iou_min:
        return True
    ca = ((a[0] + a[2]) / 2, (a[1] + a[3]) / 2)
    cb = ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
    diag = max(math.hypot(a[2] - a[0], a[3] - a[1]), math.hypot(b[2] - b[0], b[3] - b[1]))
    ratio = math.sqrt(max(area(a), 1e-9) / max(area(b), 1e-9))
    return math.dist(ca, cb) < dist_frac * diag and 0.33 < ratio < 3.0


def link_tracks(dets: dict[int, list[Box]], frames: list[int], max_gap: int = 3) -> list[dict[int, Box]]:
    """Greedy tracking through keyframes in order. dets maps frame -> boxes; returns tracks {frame: box}.
    A detection joins the track whose last box (at most max_gap keyframes back) is most similar (by IoU, then
    distance); otherwise it starts a new track."""
    pos = {f: i for i, f in enumerate(frames)}
    tracks: list[dict[int, Box]] = []
    last: list[tuple[int, Box]] = []  # per track: (keyframe index, box)
    for f in frames:
        used: set[int] = set()
        for b in sorted(dets.get(f, []), key=area, reverse=True):
            best, best_score = None, -1.0
            for t, (li, lb) in enumerate(last):
                if t in used or pos[f] - li > max_gap or pos[f] == li:
                    continue
                if similar(lb, b):
                    s = iou(lb, b) + 1e-3 / (1 + pos[f] - li)
                    if s > best_score:
                        best, best_score = t, s
            if best is None:
                tracks.append({f: list(b)})
                last.append((pos[f], list(b)))
                used.add(len(tracks) - 1)
            else:
                tracks[best][f] = list(b)
                last[best] = (pos[f], list(b))
                used.add(best)
    return tracks


def fill_track(track: dict[int, Box], frames: list[int], extend: int = 1) -> dict[int, Box]:
    """Interpolate a track's box linearly (by video frame number) in keyframes between its detections, and extend
    it `extend` keyframes past both ends with the end box (detectors flicker; a missed plate is the costly error)."""
    if not track:
        return {}
    pos = {f: i for i, f in enumerate(frames)}
    keys = sorted(track, key=lambda f: pos[f])
    out = {f: list(track[f]) for f in keys}
    for a, b in zip(keys, keys[1:]):
        for i in range(pos[a] + 1, pos[b]):
            f = frames[i]
            t = (f - a) / (b - a)
            out[f] = [(1 - t) * u + t * v for u, v in zip(track[a], track[b])]
    i0, i1 = pos[keys[0]], pos[keys[-1]]
    for k in range(1, extend + 1):
        if i0 - k >= 0:
            out.setdefault(frames[i0 - k], list(track[keys[0]]))
        if i1 + k < len(frames):
            out.setdefault(frames[i1 + k], list(track[keys[-1]]))
    return out


def frame_no(name: str) -> int:
    """f_01234.jpg -> 1234"""
    return int(re.sub(r"\D", "", name.rsplit(".", 1)[0]))
