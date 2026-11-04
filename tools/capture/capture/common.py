"""Paths, zone config and the per-stage timing log shared by all capture stages."""
from __future__ import annotations

import json
import os
import time
import tomllib
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

TOOL = Path(__file__).resolve().parent.parent  # tools/capture/
REPO = TOOL.parent.parent
DATA = REPO / "data"


@dataclass
class Zone:
    id: str
    cfg: dict
    video: Path
    work: Path

    def sub(self, *parts: str) -> Path:
        p = self.work.joinpath(*parts)
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    def dir(self, *parts: str) -> Path:
        p = self.work.joinpath(*parts)
        p.mkdir(parents=True, exist_ok=True)
        return p


def load_zone(zone_id: str) -> Zone:
    path = TOOL / "zones" / f"{zone_id}.toml"
    with open(path, "rb") as f:
        cfg = tomllib.load(f)
    video = REPO / cfg["zone"]["video"]
    work = REPO / cfg["zone"]["work"]
    work.mkdir(parents=True, exist_ok=True)
    return Zone(zone_id, cfg, video, work)


def load_json(p: Path):
    with open(p) as f:
        return json.load(f)


def save_json(p: Path, obj, indent: int | None = 1) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=indent)
    os.replace(tmp, p)


@contextmanager
def timed(zone: Zone, stage: str, **extra):
    """Append wall-clock seconds for a stage to <work>/timings.json (the 'hours per zone' metric)."""
    t0 = time.time()
    print(f"== {zone.id}: {stage}", flush=True)
    yield
    dt = time.time() - t0
    p = zone.work / "timings.json"
    log = load_json(p) if p.exists() else {"zone": zone.id, "stages": {}}
    log["stages"][stage] = {"seconds": round(dt, 1), "finished": time.strftime("%Y-%m-%dT%H:%M:%S"), **extra}
    log["total_seconds"] = round(sum(s["seconds"] for s in log["stages"].values()), 1)
    save_json(p, log)
    print(f"   {stage}: {dt:.1f} s", flush=True)
