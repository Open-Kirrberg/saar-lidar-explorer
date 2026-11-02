"""List OSM features (historic/ruins/water/named paths) around Schloss Karlsberg in EPSG:25832."""
import json, sys
from pathlib import Path
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else None
tr = Transformer.from_crs(4326, 25832, always_xy=True)
els = json.loads((ROOT / "data/raw/osm/karlsberg.json").read_text())["elements"]
keep = []
for e in els:
    t = e.get("tags", {})
    interesting = any(k in t for k in ("historic", "ruins", "water", "natural", "name", "tourism", "archaeological_site", "building", "amenity", "waterway", "leisure", "man_made"))
    if not interesting:
        continue
    if e["type"] == "node":
        pts = [(e["lon"], e["lat"])]
    else:
        g = e.get("geometry") or []
        pts = [(p["lon"], p["lat"]) for p in g if p]
    if not pts:
        continue
    xy = [tr.transform(*p) for p in pts]
    keep.append({"type": e["type"], "id": e["id"], "tags": t, "xy": [[round(x, 1), round(y, 1)] for x, y in xy]})
print(len(keep), "features")
for k in keep:
    t = k["tags"]
    xs = [p[0] for p in k["xy"]]; ys = [p[1] for p in k["xy"]]
    if not (380500 < sum(xs)/len(xs) < 384500 and 5463000 < sum(ys)/len(ys) < 5468000):
        continue
    if t.get("highway") and not t.get("name") and not t.get("historic"):
        continue
    label = {kk: vv for kk, vv in t.items() if kk in ("name", "historic", "ruins", "water", "natural", "tourism", "building", "highway", "waterway", "man_made", "description", "note", "amenity", "leisure", "heritage", "archaeological_site")}
    print(k["type"][0], k["id"], f"E{min(xs):.0f}-{max(xs):.0f} N{min(ys):.0f}-{max(ys):.0f} n={len(xs)}", label)
if OUT:
    OUT.write_text(json.dumps(keep))
