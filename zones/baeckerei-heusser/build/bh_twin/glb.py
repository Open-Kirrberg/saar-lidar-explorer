"""Deterministic glTF 2.0 binary writer/reader for the built twin (raw: float32 attributes, no compression).

The packer (`tools/capture/pack/pack-built.mjs`) turns the raw GLB into the contract form (KHR_mesh_quantization +
EXT_meshopt_compression). Materials are unlit (`KHR_materials_unlit`): base colour = palette token (linear), COLOR_0 =
baked light (linear, 0..1). Node `extras` reach three.js as `userData` (picking: `userData.id` = catalogue id).
"""
from __future__ import annotations

import json
import struct

import numpy as np

from .geom import Node

GENERATOR = "zones/baeckerei-heusser/build (sle built twin)"


def _pad(b: bytes, fill: bytes = b"\x00") -> bytes:
    return b + fill * ((4 - len(b) % 4) % 4)


def write_glb(nodes: list[Node], materials: dict[str, dict]) -> bytes:
    """nodes in output order; materials: token -> {rgba: [r, g, b, a] linear, blend: bool, double: bool}."""
    used = sorted({m for n in nodes for m in n.prims})
    mat_index = {m: i for i, m in enumerate(used)}
    gl_mats = []
    for m in used:
        spec = materials[m]
        gm = {"name": m, "pbrMetallicRoughness": {"baseColorFactor": [round(float(c), 6) for c in spec["rgba"]],
                                                   "metallicFactor": 0.0, "roughnessFactor": 1.0},
              "extensions": {"KHR_materials_unlit": {}}}
        if spec.get("blend"):
            gm["alphaMode"] = "BLEND"
        if spec.get("double"):
            gm["doubleSided"] = True
        gl_mats.append(gm)

    bin_parts: list[bytes] = []
    offset = 0
    views, accessors, meshes, gl_nodes = [], [], [], []

    def add_view(data: bytes, target: int) -> int:
        nonlocal offset
        data = _pad(data)
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(data), "target": target})
        bin_parts.append(data)
        offset += len(data)
        return len(views) - 1

    def add_acc(arr: np.ndarray, comp: int, typ: str, target: int, minmax: bool = False) -> int:
        v = add_view(arr.tobytes(), target)
        acc = {"bufferView": v, "componentType": comp, "count": int(arr.shape[0]), "type": typ}
        if minmax:
            acc["min"] = [float(x) for x in arr.min(0)]
            acc["max"] = [float(x) for x in arr.max(0)]
        accessors.append(acc)
        return len(accessors) - 1

    for node in nodes:
        prims = []
        for m in sorted(node.prims):
            p, n, c, i = node.prims[m].arrays()
            if len(i) == 0:
                continue
            pos = p.astype(np.float32)
            nrm = (n / np.linalg.norm(n, axis=1, keepdims=True)).astype(np.float32)
            col = np.clip(c, 0, 1).astype(np.float32)
            idx = i.reshape(-1)
            if pos.shape[0] < 65536:
                ia = add_acc(idx.astype(np.uint16), 5123, "SCALAR", 34963)
            else:
                ia = add_acc(idx.astype(np.uint32), 5125, "SCALAR", 34963)
            attrs = {"POSITION": add_acc(pos, 5126, "VEC3", 34962, minmax=True),
                     "NORMAL": add_acc(nrm, 5126, "VEC3", 34962),
                     "COLOR_0": add_acc(col, 5126, "VEC3", 34962)}
            prims.append({"attributes": attrs, "indices": ia, "material": mat_index[m], "mode": 4})
        if not prims:
            continue
        meshes.append({"name": node.name, "primitives": prims})
        gn = {"name": node.name, "mesh": len(meshes) - 1}
        if node.extras:
            gn["extras"] = node.extras
        gl_nodes.append(gn)

    binary = b"".join(bin_parts)
    doc = {
        "asset": {"version": "2.0", "generator": GENERATOR},
        "extensionsUsed": ["KHR_materials_unlit"],
        "scene": 0,
        "scenes": [{"name": "twin", "nodes": list(range(len(gl_nodes)))}],
        "nodes": gl_nodes,
        "meshes": meshes,
        "materials": gl_mats,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(binary)}],
    }
    js = _pad(json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), b" ")
    total = 12 + 8 + len(js) + 8 + len(binary)
    return (struct.pack("<III", 0x46546C67, 2, total) + struct.pack("<II", len(js), 0x4E4F534A) + js
            + struct.pack("<II", len(binary), 0x004E4942) + binary)


def read_glb(data: bytes) -> tuple[dict, bytes]:
    magic, version, total = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67 or version != 2:
        raise ValueError("not a glTF 2 binary")
    jl, jt = struct.unpack_from("<II", data, 12)
    doc = json.loads(data[20:20 + jl].decode("utf-8"))
    off = 20 + jl
    binary = b""
    if off < len(data):
        bl, bt = struct.unpack_from("<II", data, off)
        binary = data[off + 8:off + 8 + bl]
    return doc, binary


_COMP = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}
_N = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def accessor(doc: dict, binary: bytes, i: int) -> np.ndarray:
    a = doc["accessors"][i]
    v = doc["bufferViews"][a["bufferView"]]
    dt = _COMP[a["componentType"]]
    n = _N[a["type"]]
    arr = np.frombuffer(binary, dt, a["count"] * n, v.get("byteOffset", 0) + a.get("byteOffset", 0))
    return arr.reshape(-1, n) if n > 1 else arr


def node_geometry(doc: dict, binary: bytes) -> dict[str, list[tuple[str, np.ndarray, np.ndarray]]]:
    """Raw GLB -> {node name: [(material name, positions (n,3), triangles (k,3))]} (tests, reports)."""
    out = {}
    for nd in doc["nodes"]:
        if "mesh" not in nd:
            continue
        items = []
        for pr in doc["meshes"][nd["mesh"]]["primitives"]:
            pos = accessor(doc, binary, pr["attributes"]["POSITION"]).astype(np.float64)
            idx = accessor(doc, binary, pr["indices"]).astype(np.int64).reshape(-1, 3)
            items.append((doc["materials"][pr["material"]]["name"], pos, idx))
        out[nd["name"]] = items
    return out
