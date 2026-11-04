"""Downscale texture JPEGs for the castle zone package (deterministic: Pillow LANCZOS, fixed JPEG settings, no metadata).

Reads a JSON job list on stdin, writes the outputs, prints a JSON result list on stdout. Inputs are downloaded images
(untrusted data): run with `python -I`, they are only decoded, never executed.

    [{"src": ".../diff.jpg", "dst": ".../diff.jpg", "size": 1024, "quality": 85, "subsampling": "4:2:0"}, ...]
    -> [{"dst": ..., "w": 1024, "h": 1024, "bytes": 412345}, ...]

Usage: cd pipeline && uv run python -I ../zones/schloss-karlsberg/scripts/zone/resize-textures.py < jobs.json
"""

import json
import sys
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = 64 * 1024 * 1024  # 8k² at most; Poly Haven 2k sets are 4 MP
SUBSAMPLING = {"4:4:4": 0, "4:2:2": 1, "4:2:0": 2}


def resize(job: dict) -> dict:
    src, dst, size = Path(job["src"]), Path(job["dst"]), int(job["size"])
    quality, sub = int(job.get("quality", 85)), SUBSAMPLING[job.get("subsampling", "4:2:0")]
    if not (16 <= size <= 4096 and 1 <= quality <= 95):
        raise ValueError(f"{src}: bad size {size} or quality {quality}")
    with Image.open(src) as im:
        if im.format != "JPEG":
            raise ValueError(f"{src}: not a JPEG ({im.format})")
        rgb = im.convert("RGB")
    out = rgb if rgb.size == (size, size) else rgb.resize((size, size), Image.Resampling.LANCZOS)
    dst.parent.mkdir(parents=True, exist_ok=True)
    out.save(dst, "JPEG", quality=quality, subsampling=sub, optimize=True, progressive=False)
    return {"dst": str(dst), "w": out.width, "h": out.height, "bytes": dst.stat().st_size}


def main() -> int:
    jobs = json.load(sys.stdin)
    if not isinstance(jobs, list):
        print("expected a JSON list of jobs on stdin", file=sys.stderr)
        return 2
    json.dump([resize(j) for j in jobs], sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
