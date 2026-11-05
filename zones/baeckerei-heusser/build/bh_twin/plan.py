"""Raumplan (sle-raumplan/0.1, public version in ../../plan/) -> the numbers the generator builds from.

Frame B: origin = SSW end of the LoD2 street facade, x along the facade (NNE), y into the building (WNW), z above
the shop floor (±0.00 = 244.25 m NHN). `FrameB` maps it to the zone frame (x = E − E0, y = h, z = −(N − N0)).

**One scale factor** (tools/capture/zones/baeckerei-heusser.toml `package.scale_factor`, = the plan's `scale.factor`)
is applied here to every interior value (sources mesh/photo/video; plan rule `xy' = pivot + f·(xy − pivot)`,
heights above ±0.00 `L' = f·L`). Survey values (LoD2, DGM1, ALKIS) are never scaled. Plan values stay unscaled on
disk (the mesh scale), so a tape measurement changes one number and a rebuild.
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

E0, N0 = 381467, 5462254  # zone origin (zone.json / catalogue frame)

# Values the v0 plan states only in notes (source: the plan's notes and its SVG generator, mesh-derived):
GLASS_WALL = 0.07          # glazed side wall frame u = 21.76 .. 21.83 (W2 note)
BULKHEAD_H = 2.05          # "Sturz über Schaufenstern ≈ 2,05" (R1.ceiling note) ...
BULKHEAD_Y = 1.00          # ... over the shop windows, y < 1.0 (plan generator)
CORRIDOR_END_Y = 7.14      # O6 note: corridor 0.94 wide up to y = 7.14, door there
PORCH_REVEAL = 0.30        # depth of the arch over the porch opening (estimate: drawn, not measured)
ARCH_SPRING = 1.80         # porch arch springing height (estimate; crown = O3 head)
PASSAGE_HEAD = 2.00        # covered passage soffit above ±0.00 (estimate: = O5 head)
DOOR_LEAF = 0.85           # shop door leaves (two, plan sheet: 2 × 0.85 centred in the glass front)
DOOR_HEAD = 2.10           # door head / transom (estimate)
BACKDOOR_HEAD = 2.00       # closed door at the end of the rear corridor (estimate)


@dataclass
class FrameB:
    oE: float
    oN: float
    xa: tuple[float, float]
    ya: tuple[float, float]
    z0: float

    def en(self, xy) -> np.ndarray:
        xy = np.asarray(xy, np.float64)
        E = self.oE + xy[..., 0] * self.xa[0] + xy[..., 1] * self.ya[0]
        N = self.oN + xy[..., 0] * self.xa[1] + xy[..., 1] * self.ya[1]
        return np.stack([E, N], -1)

    def from_en(self, en) -> np.ndarray:
        en = np.asarray(en, np.float64)
        d = en - np.array([self.oE, self.oN])
        return np.stack([d @ np.array(self.xa), d @ np.array(self.ya)], -1)

    def zone(self, xyz) -> np.ndarray:
        """frame B (x, y, z above ±0.00) -> zone frame (x = E − E0, y = h, z = −(N − N0))."""
        p = np.asarray(xyz, np.float64)
        en = self.en(p[..., :2])
        return np.stack([en[..., 0] - E0, self.z0 + p[..., 2], -(en[..., 1] - N0)], -1)

    def zone_dir(self, v) -> np.ndarray:
        v = np.asarray(v, np.float64)
        dE = v[..., 0] * self.xa[0] + v[..., 1] * self.ya[0]
        dN = v[..., 0] * self.xa[1] + v[..., 1] * self.ya[1]
        return np.stack([dE, v[..., 2], -dN], -1)

    def zone_to_b(self, pz) -> np.ndarray:
        pz = np.asarray(pz, np.float64)
        en = np.stack([pz[..., 0] + E0, N0 - pz[..., 2]], -1)
        xy = self.from_en(en)
        return np.concatenate([xy, (pz[..., 1] - self.z0)[..., None]], -1)

    def heading(self, v_xy) -> float:
        """Grid heading (deg, clockwise from north) of a frame-B horizontal direction."""
        d = self.zone_dir(np.array([v_xy[0], v_xy[1], 0.0]))
        return math.degrees(math.atan2(d[0], -d[2])) % 360.0


@dataclass
class Fixture:
    id: str
    type: str
    name_de: str
    xy: np.ndarray       # fixture origin (front corner at the start of the length; round tables: centre)
    rot: float           # deg, x_fixture against x_B, counter-clockwise
    l: float
    d: float
    h: float | None
    source: str
    sigma: float
    raw: dict = field(default_factory=dict)
    z: float = 0.0       # pose.z (base above ±0.00, scaled): wall-mounted and stacked fixtures

    @property
    def centred(self) -> bool:
        """Tables and round objects: the pose is the centre (plan `fixture_frame`)."""
        return self.raw.get("form") in ("rund", "quadratisch", "kugel")

    @property
    def ux(self) -> np.ndarray:
        a = math.radians(self.rot)
        return np.array([math.cos(a), math.sin(a)])

    @property
    def uy(self) -> np.ndarray:
        a = math.radians(self.rot + 90)
        return np.array([math.cos(a), math.sin(a)])

    def local(self, x, y) -> np.ndarray:
        return self.xy + x * self.ux + y * self.uy

    def footprint(self) -> np.ndarray:
        return np.array([self.local(0, 0), self.local(self.l, 0), self.local(self.l, self.d), self.local(0, self.d)])

    @property
    def centre(self) -> np.ndarray:
        return self.xy if self.centred else self.local(self.l / 2, self.d / 2)


@dataclass
class Plan:
    raw: dict
    f: float
    frame: FrameB
    pivot: np.ndarray
    room: dict[str, np.ndarray]
    room_order: list[str]
    openings: dict[str, dict]
    fixtures: dict[str, Fixture]
    ceiling: float
    floor_nhn: float
    stairs: dict
    porch_poly: np.ndarray
    passage_far_x: float
    passage_public_y: float
    footprint: np.ndarray            # LoD2 ring (survey, unscaled)
    sigma: dict = field(default_factory=dict)

    # ---- scale helpers (interior values) ----
    def S(self, xy) -> np.ndarray:
        return self.pivot + self.f * (np.asarray(xy, np.float64) - self.pivot)

    def H(self, z: float) -> float:
        return self.f * float(z)

    # ---- derived ----
    @property
    def bulkhead_h(self) -> float:
        return self.H(BULKHEAD_H)

    @property
    def bulkhead_y(self) -> float:
        return float(self.S((0.0, BULKHEAD_Y))[1])

    @property
    def corridor_end_y(self) -> float:
        return float(self.S((0.0, CORRIDOR_END_Y))[1])

    def north_outer_x(self, y: float) -> float:
        """LoD2 north wall outer face (edge L3), frame B x at y (survey)."""
        e = next(e for e in self.raw["site"]["building"]["edges"] if e["id"] == "L3")
        (x1, y1), (x2, y2) = e["to"], e["from"]
        return x1 + (x2 - x1) * (y - y1) / (y2 - y1)


def load_plan(path: Path, f: float) -> Plan:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    fr = raw["frame"]
    frame = FrameB(fr["origin"]["E"], fr["origin"]["N"], tuple(fr["x_axis_EN"]), tuple(fr["y_axis_EN"]), fr["z0_m_nhn"]["v"])
    pivot = np.array(raw["scale"]["pivot_xy"], np.float64)
    S = lambda xy: pivot + f * (np.asarray(xy, np.float64) - pivot)  # noqa: E731
    r1 = next(r for r in raw["levels"][0]["rooms"] if r["id"] == "R1")
    rv = next(r for r in raw["levels"][0]["rooms"] if r["id"] == "R-vorbau")
    room = {k: S(p["xy"]) for k, p in r1["points"].items()}
    ops = {}
    for o in r1["openings"]:
        oo = dict(o)
        oo["from"], oo["to"] = S(o["from"]), S(o["to"])
        for k in ("sill", "head"):
            if isinstance(o.get(k), dict):
                oo[k] = f * o[k]["v"]
        ops[o["id"]] = oo
    fx = {}
    for x in r1["fixtures"]:
        sz = x["size"]
        fx[x["id"]] = Fixture(x["id"], x["type"], x["name_de"], S(x["pose"]["xy"]), float(x["pose"]["rot_deg"]),
                              f * sz["l"], f * sz["d"], None if sz.get("h") is None else f * sz["h"],
                              x.get("source", "mesh"), float(x.get("sigma_m") or 0.5), x, f * float(x["pose"].get("z") or 0.0))
    st = dict(rv["stairs"][0])
    st["x_range"] = [float(S((x, 0))[0]) for x in st["x_range"]]
    st["tread_v"] = f * st["tread"]["v"]
    st["landing_y"] = f * (st["risers"] - 1) * st["tread"]["v"]
    porch = np.array([S(p) for p in rv["polygon_xy"]])
    pas = raw["site"]["passage"]
    far = float(S((pas["x_range"][1], 0))[0])
    sigma = {"room": max(p["sigma_m"] for p in r1["points"].values()), "ceiling": r1["ceiling"]["sigma_m"]}
    return Plan(raw=raw, f=f, frame=frame, pivot=pivot, room=room, room_order=list(r1["polygon"]), openings=ops,
                fixtures=fx, ceiling=f * r1["ceiling"]["v"], floor_nhn=r1["floor"]["h_nhn"], stairs=st, porch_poly=porch,
                passage_far_x=far, passage_public_y=float(pas.get("public_until_y", 1.6)),
                footprint=np.array(raw["site"]["building"]["footprint"]["ring"], np.float64), sigma=sigma)


def toml_scale_factor(toml_path: Path) -> float:
    """`package.scale_factor` of the capture TOML (the one factor for plan and zone); missing -> 1."""
    import tomllib
    with open(toml_path, "rb") as fh:
        cfg = tomllib.load(fh)
    return float(cfg.get("package", {}).get("scale_factor", 1.0))


def parse_note_number(text: str, key: str) -> float | None:
    m = re.search(rf"{re.escape(key)}\s*([0-9]+[.,][0-9]+)", text or "")
    return float(m.group(1).replace(",", ".")) if m else None
