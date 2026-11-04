"""Stage `privacy`: blur licence plates and people in the keyframes *before* any reconstruction (PRD H13).

Detectors (both on-device, both run on every keyframe):
  - YOLOX-s (OpenCV zoo, Apache-2.0, COCO), tiled 3x2 + full frame so far cars stay detectable:
    vehicles (car, motorcycle, bus, truck) -> their plate zone (lower part of the box, small/far ones whole);
    persons -> whole box.
  - Apple Vision (swift/vision_scan.swift): human rectangles, plus OCR lines that look like a German plate.
    Faces alone are *not* blurred: in this footage they are framed portraits on the shop wall (decor).
Detections are linked into tracks over keyframes and gaps are filled (boxes.link_tracks / fill_track), because
detectors flicker and a single missed plate is the costly error. Every box is padded and blurred with a Gaussian of
sigma >= 1/4 of its short side (irreversible). Recall beats precision: every person hit is blurred, also the
false positives (framed portraits, dolls, plants) -- portraits show identifiable people anyway.
Frames where people cover more than `drop_person_frac` of the image are dropped from reconstruction (a big blurred
smear would end up in the texture) -- but only inside the reviewed `people_frames` ranges where live people are in
view; elsewhere the person hits are decor and dropping would only punch holes into the coverage.
Writes frames/clean/*.jpg, privacy/boxes.json and QA sheets privacy/qa_blurred_*.jpg (for a human look).
"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from . import boxes as B
from .common import DATA, TOOL, Zone, save_json

VEHICLES = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}
PERSON = 0
MODEL_URL = "https://huggingface.co/opencv/object_detection_yolox/resolve/main/object_detection_yolox_2022nov.onnx"
MODEL_SHA256 = "c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063"
BIN = DATA / "work" / "capture" / "bin"
MODELS = DATA / "work" / "capture" / "models"


def ensure_model():
    p = MODELS / "yolox_s.onnx"
    if not p.exists():
        MODELS.mkdir(parents=True, exist_ok=True)
        subprocess.run(["curl", "-sSL", "-A", "saar-lidar-explorer-capture/0.1", "-o", str(p), MODEL_URL], check=True)
    h = hashlib.sha256(p.read_bytes()).hexdigest()
    if h != MODEL_SHA256:
        raise RuntimeError(f"YOLOX model hash mismatch: {h}")
    return p


def ensure_swift(name: str):
    exe = BIN / name
    src = TOOL / "swift" / f"{name}.swift"
    if not exe.exists() or exe.stat().st_mtime < src.stat().st_mtime:
        BIN.mkdir(parents=True, exist_ok=True)
        subprocess.run(["swiftc", "-O", "-o", str(exe), str(src)], check=True)
    return exe


class Yolox:
    """YOLOX-s decoder as in the OpenCV zoo demo (letterbox 640, pad 114, no mean/std)."""

    def __init__(self, path, conf=0.3, nms=0.45):
        import cv2

        self.cv2 = cv2
        self.path, self.conf, self.nms = str(path), conf, nms
        grids, strides = [], []
        for s in (8, 16, 32):
            n = 640 // s
            xv, yv = np.meshgrid(np.arange(n), np.arange(n))
            grids.append(np.stack((xv, yv), 2).reshape(-1, 2))
            strides.append(np.full((n * n, 1), s))
        self.grids = np.concatenate(grids).astype(np.float32)
        self.strides = np.concatenate(strides).astype(np.float32)

    def net(self):
        n = self.cv2.dnn.readNet(self.path)
        return n

    def infer(self, net, rgb: np.ndarray) -> np.ndarray:
        cv2 = self.cv2
        h, w = rgb.shape[:2]
        r = min(640 / h, 640 / w)
        pad = np.full((640, 640, 3), 114.0, np.float32)
        pad[: int(h * r), : int(w * r)] = cv2.resize(rgb, (int(w * r), int(h * r)), interpolation=cv2.INTER_LINEAR)
        net.setInput(np.transpose(pad, (2, 0, 1))[None])
        d = net.forward(net.getUnconnectedOutLayersNames())[0][0]
        xy = (d[:, :2] + self.grids) * self.strides
        wh = np.exp(d[:, 2:4]) * self.strides
        bx = np.concatenate([xy - wh / 2, xy + wh / 2], 1) / r
        sc = d[:, 4:5] * d[:, 5:]
        cls = sc.argmax(1)
        s = sc.max(1)
        keep = s >= self.conf
        bx, s, cls = bx[keep], s[keep], cls[keep]
        if not len(s):
            return np.zeros((0, 6), np.float32)
        idx = cv2.dnn.NMSBoxesBatched([[b[0], b[1], b[2] - b[0], b[3] - b[1]] for b in bx], s.tolist(),
                                      cls.tolist(), self.conf, self.nms)
        idx = np.array(idx).reshape(-1)
        return np.concatenate([bx[idx], s[idx, None], cls[idx, None]], 1)

    def detect_tiled(self, net, bgr: np.ndarray, grid=(3, 2), overlap=0.2) -> list[tuple[int, float, list[float]]]:
        cv2 = self.cv2
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        h, w = rgb.shape[:2]
        out = []
        for row in self.infer(net, rgb):
            out.append((int(row[5]), float(row[4]), row[:4].tolist()))
        nx, ny = grid
        tw, th = int(w / nx * (1 + overlap)), int(h / ny * (1 + overlap))
        for iy in range(ny):
            for ix in range(nx):
                x0 = int(round(ix * (w - tw) / max(1, nx - 1)))
                y0 = int(round(iy * (h - th) / max(1, ny - 1)))
                for row in self.infer(net, rgb[y0:y0 + th, x0:x0 + tw]):
                    b = row[:4] + np.array([x0, y0, x0, y0])
                    out.append((int(row[5]), float(row[4]), b.tolist()))
        return out


def blur_regions(img: np.ndarray, regions: list[list[float]]) -> np.ndarray:
    import cv2

    out = img.copy()
    for b in regions:
        x0, y0, x1, y1 = (int(round(v)) for v in b)
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        roi = out[y0:y1, x0:x1]
        sigma = max(6.0, 0.25 * min(x1 - x0, y1 - y0))
        small = cv2.resize(roi, (max(1, (x1 - x0) // 8), max(1, (y1 - y0) // 8)), interpolation=cv2.INTER_AREA)
        roi2 = cv2.resize(small, (x1 - x0, y1 - y0), interpolation=cv2.INTER_LINEAR)
        out[y0:y1, x0:x1] = cv2.GaussianBlur(roi2, (0, 0), sigma / 2)
    return out


def run(zone: Zone) -> dict:
    import cv2

    cfg = zone.cfg.get("privacy", {})
    raw = zone.work / "frames" / "raw"
    pdir = zone.dir("privacy")
    files = sorted(raw.glob("f_*.jpg"))
    if not files:
        raise RuntimeError("no raw keyframes: run the `frames` stage first (`clean` deletes them after a run)")
    frames = [B.frame_no(p.name) for p in files]

    # 1) Apple Vision: humans + plate-like OCR
    scan = pdir / "scan.jsonl"
    if not scan.exists():
        subprocess.run([str(ensure_swift("vision_scan")), str(raw), str(scan), "0.004", "6"], check=True)
    vis = {}
    for line in scan.read_text().splitlines():
        r = json.loads(line)
        vis[B.frame_no(r["file"])] = r

    # 2) YOLOX tiled
    det_p = pdir / "yolox.json"
    if det_p.exists():
        yolo = {int(k): v for k, v in json.loads(det_p.read_text()).items()}
    else:
        y = Yolox(ensure_model(), conf=cfg.get("conf", 0.3))
        cv2.setNumThreads(2)

        def one(p):
            net = y.net()
            return B.frame_no(p.name), y.detect_tiled(net, cv2.imread(str(p)))

        with ThreadPoolExecutor(cfg.get("threads", 8)) as ex:
            yolo = dict(ex.map(one, files))
        save_json(det_p, {str(k): v for k, v in yolo.items()}, indent=None)

    w = h = None
    plates: dict[int, list] = {}
    people: dict[int, list] = {}
    counts = {"vehicle": 0, "person_yolox": 0, "person_vision": 0, "plate_ocr": 0}
    for f in frames:
        r = vis.get(f, {})
        w, h = r.get("w", 4000), r.get("h", 3000)
        pl, pe = [], []
        for cls, s, b in yolo.get(f, []):
            if cls in VEHICLES and s >= cfg.get("vehicle_conf", 0.3):
                pl.append(B.plate_zone(b, cfg.get("small_vehicle_px", 160), cfg.get("plate_zone_lower", 0.6)))
                counts["vehicle"] += 1
            elif cls == PERSON and s >= cfg.get("person_conf", 0.35):
                pe.append(b)
                counts["person_yolox"] += 1
        for hu in r.get("humans", []):
            pe.append(hu["box"])
            counts["person_vision"] += 1
        for t in r.get("text", []):
            if B.looks_like_plate(t["s"]):
                pl.append(t["box"])
                counts["plate_ocr"] += 1
        plates[f] = B.merge_boxes(pl)
        people[f] = B.merge_boxes(pe)

    gap = cfg.get("track_max_gap", 3)
    final: dict[int, list] = {f: [] for f in frames}
    kinds: dict[int, list] = {f: [] for f in frames}
    tracks_n = {}
    for kind, dets in (("plate", plates), ("person", people)):
        tracks = B.link_tracks(dets, frames, max_gap=gap)
        tracks_n[kind] = len(tracks)
        for t in tracks:
            for f, b in B.fill_track(t, frames, extend=cfg.get("track_extend", 1)).items():
                pb = B.pad_box(b, cfg.get("pad_frac", 0.15), cfg.get("pad_px", 12), w, h)
                final[f].append(pb)
                kinds[f].append(kind)

    drop_frac = cfg.get("drop_person_frac", 0.03)
    live = cfg.get("people_frames")  # reviewed [first, last] ranges with live people; None = everywhere
    dropped = []
    for f in frames:
        if live is not None and not any(a <= f <= b for a, b in live):
            continue
        pa = sum(B.area(b) for b, k in zip(final[f], kinds[f]) if k == "person")
        if pa > drop_frac * w * h:
            dropped.append(f)

    clean = zone.dir("frames", "clean")
    for p in clean.glob("*.jpg"):
        p.unlink()

    def write(p):
        f = B.frame_no(p.name)
        if f in dropped:
            return
        if not final[f]:
            shutil.copyfile(p, clean / p.name)
            return
        img = cv2.imread(str(p))
        cv2.imwrite(str(clean / p.name), blur_regions(img, final[f]), [cv2.IMWRITE_JPEG_QUALITY, 95])

    with ThreadPoolExecutor(8) as ex:
        list(ex.map(write, files))

    # QA sheets: every blurred keyframe (after blur), boxes outlined -- for a human look, git-ignored
    blurred = [f for f in frames if final[f] and f not in dropped]
    qa_sheets(zone, blurred, final, kinds)
    summary = {"keyframes": len(frames), "blurred_frames": len(blurred), "dropped_frames": dropped,
               "boxes": sum(len(v) for v in final.values()), "tracks": tracks_n, "detections": counts}
    save_json(pdir / "boxes.json", {"summary": summary,
                                    "frames": {str(f): {"boxes": final[f], "kinds": kinds[f]} for f in frames if final[f]}})
    print("   privacy:", summary, flush=True)
    return summary


def qa_sheets(zone: Zone, fr: list[int], final, kinds, per_sheet: int = 48, cols: int = 8, tw: int = 360):
    import cv2

    pdir = zone.dir("privacy")
    for p in pdir.glob("qa_blurred_*.jpg"):
        p.unlink()
    clean = zone.work / "frames" / "clean"
    th = tw * 3 // 4
    for s in range(0, len(fr), per_sheet):
        tiles = []
        for f in fr[s:s + per_sheet]:
            img = cv2.imread(str(clean / f"f_{f:05d}.jpg"))
            sc = tw / img.shape[1]
            t = cv2.resize(img, (tw, th), interpolation=cv2.INTER_AREA)
            for b, k in zip(final[f], kinds[f]):
                c = (0, 0, 255) if k == "plate" else (255, 0, 255)
                cv2.rectangle(t, (int(b[0] * sc), int(b[1] * sc)), (int(b[2] * sc), int(b[3] * sc)), c, 1)
            cv2.putText(t, str(f), (4, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
            tiles.append(t)
        while len(tiles) % cols:
            tiles.append(np.zeros_like(tiles[0]))
        sheet = np.vstack([np.hstack(tiles[i:i + cols]) for i in range(0, len(tiles), cols)])
        cv2.imwrite(str(pdir / f"qa_blurred_{s // per_sheet:02d}.jpg"), sheet, [cv2.IMWRITE_JPEG_QUALITY, 85])
