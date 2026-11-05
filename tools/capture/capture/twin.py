"""Stage `twin`: a built twin (ADR 0042) becomes the zone's visible scene; the capture stays as a hidden reference.

Input: `[package.twin]` in the zone TOML names the generator output (`build = "zones/<zone>/build/out"`), made by the
zone's own generator (for the bakery `zones/baeckerei-heusser/build/run.sh`): raw `twin.glb` + `nav.glb` and the
manifest fragment `package.json`. Steps: `pack/pack-built.mjs` per asset (meshopt + quantization, NORMAL and COLOR_0
kept) -> `<out>/<zone>/built/<asset>.glb` -> the package's zone.json rewritten (`merge_manifest`, pure + tested) ->
strict validation (pipeline/zones.py) -> index merge.

Runs at the end of stage `package` when `[package.twin]` exists (package rebuilds the folder), or alone
(`run.sh <zone> twin`) after a new generator run. Idempotent.

Manifest rules (docs/zone-contract.md, "Built twins"):
- assets: `twin` (role scene) + `nav` (role collider) first; the capture LODs become role `reference` (never drawn by
  default, never collide, outside the first-view budget). Apps without `reference` skip them (unknown role).
  `serve_reference = false` in `[package.twin]` drops them from the package entirely (zone.json and the `scene/`
  files); the capture then stays only in the zone's private work folder (alignment, measuring).
- `capture.scale.factor` = 1: the twin is built at true scale (the one factor is applied by the generator). The
  factor for the reference mesh moves to `twin.referenceScale`.
- texts (name, summary, disclaimer, sources, attribution) come from `[package.twin]`; spawn, portal, footprint from
  the generator.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from .common import REPO, TOOL, Zone, save_json

PACK = TOOL / "pack"
REFERENCE_ID = "referenz"


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def reference_assets(assets: list[dict]) -> list[dict]:
    """The capture's assets as `reference` (idempotent: already-built twin assets are dropped, references kept)."""
    out = []
    for a in assets:
        if any(str(l.get("path", "")).startswith("built/") for l in a.get("lods", [])):
            continue
        if a.get("role") == "scene":
            out.append({**a, "id": REFERENCE_ID if a.get("id") == "scene" else a["id"], "role": "reference"})
        elif a.get("role") == "reference":
            out.append(a)
    return out


def merge_manifest(m: dict, frag: dict, pkg: dict, packed: dict[str, dict]) -> dict:
    """zone.json of the capture package + generator fragment + TOML `[package]` (with `twin`) -> twin zone.json.

    `packed`: asset id -> {path, bytes, triangles} of the packed GLBs. Budget totalBytes is left for the caller."""
    tw = pkg["twin"]
    cap = dict(m.get("capture") or {})
    old_scale = dict(cap.get("scale") or {})
    ref_factor = float(pkg.get("scale_factor", old_scale.get("factor", 1.0)))
    cap["scale"] = {**old_scale, "factor": 1.0} if old_scale else {"factor": 1.0, "pivotLocal": frag["pivotLocal"]}
    assets = []
    for a in frag["assets"]:
        p = packed[a["id"]]
        assets.append({"id": a["id"], "role": a["role"], "bboxLocal": a["bboxLocal"],
                       "lods": [{"path": p["path"], "until_m": None, "bytes": int(p["bytes"]), "triangles": int(p["triangles"])}]})
    serve_ref = bool(tw.get("serve_reference", True))
    refs = reference_assets(m.get("assets", [])) if serve_ref else []
    sp = frag["spawn"]
    portal = {"id": "strasse", "label_de": pkg.get("portal_label_de", "Betreten"), "E": frag["portal"]["E"], "N": frag["portal"]["N"],
              "h": None, "radius_m": float(pkg.get("portal_radius_m", 40)), "facing_deg": frag["portal"]["facing_deg"], "spawn": "strasse"}
    twin = {**frag["twin"]}
    if refs:
        twin["referenceScale"] = {"factor": ref_factor, "pivotLocal": old_scale.get("pivotLocal", frag["pivotLocal"])}
    else:
        twin.pop("referenceScale", None)
    out = {k: v for k, v in m.items()}
    out.update({
        "name_de": tw.get("name_de", m.get("name_de")),
        "summary_de": tw.get("summary_de", m.get("summary_de", "")),
        "footprint": frag["footprint"],
        "portals": [portal],
        "spawns": {"strasse": sp},
        "assets": assets + refs,
        "attribution": list(tw["attribution"]),
        "evidence": {"kind": "capture", "confidence": tw.get("confidence", "med"), "perPart": "extras",
                     "sources_de": list(tw.get("sources_de", []))[:10], "disclaimer_de": tw["disclaimer_de"]},
        "capture": cap,
        "twin": twin,
        "generator": "tools/capture package + twin",
    })
    scene = [a for a in assets if a["role"] == "scene"]
    first = [a for a in assets if a["role"] in ("scene", "collider")]
    out["budget"] = {"downloadBytes": sum(a["lods"][-1]["bytes"] for a in first), "totalBytes": 0,
                     "triangles": sum(max(l["triangles"] for l in a["lods"]) for a in scene), "textureBytesGpu": 0}
    return out


def _pack(src: Path, dst: Path) -> dict:
    node, pnpm = shutil.which("node"), shutil.which("pnpm")
    if not node:
        raise SystemExit("twin: node not found (Node >= 22 needed for pack/pack-built.mjs)")
    if not (PACK / "node_modules").is_dir():
        if not pnpm:
            raise SystemExit("twin: pnpm not found (cd tools/capture/pack && pnpm install --frozen-lockfile)")
        subprocess.run([pnpm, "install", "--frozen-lockfile"], cwd=PACK, check=True)
    res = subprocess.run([node, str(PACK / "pack-built.mjs"), "--in", str(src), "--out", str(dst)], cwd=PACK, check=True,
                         capture_output=True, text=True)
    return json.loads(res.stdout.strip().splitlines()[-1])


def run(zone: Zone) -> dict:
    from .package import _validator, bbox_en, merge_index

    pkg = zone.cfg.get("package", {})
    tw = pkg.get("twin")
    if not tw:
        raise SystemExit(f"twin: no [package.twin] in tools/capture/zones/{zone.id}.toml")
    src = REPO / tw["build"]
    frag_path = src / "package.json"
    if not frag_path.is_file():
        raise SystemExit(f"twin: {frag_path.relative_to(REPO)} missing: run the zone's generator first")
    frag = json.loads(frag_path.read_text(encoding="utf-8"))
    out_root = REPO / pkg.get("out", "app/public/data/zones")
    out = out_root / zone.id
    mf = out / "zone.json"
    if not mf.is_file():
        raise SystemExit(f"twin: {mf.relative_to(REPO)} missing: run stage `package` first (the capture is the reference)")
    m = json.loads(mf.read_text(encoding="utf-8"))
    if abs(float(frag["twin"]["scaleFactor"]) - float(pkg.get("scale_factor", 1.0))) > 1e-9:
        raise SystemExit("twin: generator output was built with another scale factor than the TOML: rerun the generator")

    built = out / "built"
    if built.exists():
        shutil.rmtree(built)
    built.mkdir(parents=True)
    packed = {}
    for a in frag["assets"]:
        dst = built / f"{a['id']}.glb"
        st = _pack(src / a["raw"], dst)
        packed[a["id"]] = {"path": f"built/{a['id']}.glb", "bytes": dst.stat().st_size, "triangles": int(st["triangles"])}
        print(f"   {a['id']}: {dst.stat().st_size / 1e6:.2f} MB, {int(st['triangles'])} tris", flush=True)

    new = merge_manifest(m, frag, pkg, packed)
    if not any(a["role"] == "reference" for a in new["assets"]):
        # serve_reference = false: no capture file may stay in the served package
        kept = {l["path"].split("/")[0] for a in new["assets"] for l in a["lods"]}
        for d in out.iterdir():
            if d.is_dir() and d.name not in kept:
                shutil.rmtree(d)
    save_json(mf, new)
    files = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    new["budget"]["totalBytes"] = files + 64
    save_json(mf, new)
    errs = _validator().validate_package(out)
    if errs:
        raise SystemExit("twin: zone package invalid:\n  - " + "\n  - ".join(errs))

    idx_path = out_root / "index.json"
    idx = json.loads(idx_path.read_text()) if idx_path.exists() else None
    portal = new["portals"][0]
    entry = {"id": zone.id, "bboxEN": bbox_en([new["footprint"], [[portal["E"], portal["N"]]]], pad_m=1.0)}
    save_json(idx_path, merge_index(idx, entry, drop=pkg.get("former_ids", [])), indent=2)
    summary = {"out": str(out.relative_to(REPO)), "assets": packed, "budget": new["budget"], "spawn": new["spawns"]["strasse"]}
    save_json(zone.dir("package") / "twin.json", summary)
    print("   twin:", json.dumps(summary), flush=True)
    return summary
