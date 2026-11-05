"""Extract LoD2 buildings near the bakery anchor -> work/lod2_near.json (ground/wall/roof rings, attributes)."""
import gzip, json, math, sys
import numpy as np
from lxml import etree
path, out = sys.argv[1], sys.argv[2]
E, N, R = (float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])) if len(sys.argv) > 5 else (381467.4, 5462253.6, 45.0)
G = "{http://www.opengis.net/gml}id"
def ring(poly):
    for pl in poly.iter("{*}posList"):
        v = np.array((pl.text or "").split(), float)
        return v.reshape(-1, int(pl.get("srsDimension") or 3))[:, :3]
    pos = [np.array((p.text or "").split(), float) for p in poly.iter("{*}pos")]
    return np.vstack(pos) if pos else np.zeros((0, 3))
res = []
with gzip.open(path, "rb") as f:
    for _, el in etree.iterparse(f, events=("end",), tag="{*}Building", resolve_entities=False, load_dtd=False, no_network=True, huge_tree=True):
        if el.getparent() is not None and el.getparent().tag.endswith("consistsOfBuildingPart"):
            continue
        surf = {"ground": [], "wall": [], "roof": [], "other": []}
        for s in el.iter():
            t = etree.QName(s).localname if isinstance(s.tag, str) else ""
            k = {"GroundSurface": "ground", "WallSurface": "wall", "RoofSurface": "roof", "ClosureSurface": "other"}.get(t)
            if not k: continue
            for poly in s.iter("{*}Polygon"):
                r = ring(poly)
                if len(r) >= 3: surf[k].append(r.round(3).tolist())
        allp = np.array([p for k in surf for r in surf[k] for p in r]) if any(surf.values()) else None
        if allp is None: el.clear(); continue
        c = allp[:, :2].mean(0)
        if math.hypot(c[0]-E, c[1]-N) < R:
            attrs = {}
            for sa in el.iter("{*}stringAttribute", "{*}doubleAttribute"):
                v = sa.find("{*}value"); attrs[sa.get("name")] = v.text if v is not None else None
            for tag in ("function", "roofType", "measuredHeight", "storeysAboveGround"):
                x = el.find("{*}" + tag)
                if x is not None: attrs[tag] = x.text
            addr = [a.text for a in el.iter("{*}ThoroughfareName", "{*}BuildingNumber", "{*}ThoroughfareNumber")]
            parts = len(list(el.iter("{*}BuildingPart")))
            res.append({"id": el.get(G), "attrs": attrs, "address": addr, "parts": parts, "centroid": c.round(2).tolist(), **surf})
        el.clear()
json.dump(res, open(out, "w"))
for b in res:
    print(b["id"], b["centroid"], b["attrs"].get("function"), b["attrs"].get("roofType"), b["attrs"].get("measuredHeight"), b["address"], {k: len(v) for k, v in b.items() if k in ("ground","wall","roof","other")})
