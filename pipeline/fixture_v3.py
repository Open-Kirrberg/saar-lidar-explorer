"""Shared S2 fixture: two v3 places + catalog + overview in app/public/data/fixture-v3/ (git-ignored).

    uv run python fixture_v3.py              # overview + catalog + README (place AOIs must be built already)
    ./run.sh fixture-v3                      # = build both places with run.sh steps, then this script

Area: the Homburg/Kirkel border west of Limbach (tiles 375–377 × 5462–5463). Two interlocking L-shaped places of
three tiles each (aois.toml [fixture-v3-homburg], [fixture-v3-kirkel]) and one 'stats' place (Blieskastel, tile
375_5461) that has overview terrain only. The catalog restricts each place to these tiles (real owners from
catalog.py ownership, rule largest-share-v1).
"""
from __future__ import annotations

import json
import sys

from catalog import write_catalog
from common import APP_DATA, load_aoi
from grid import parse_tile_id
from overview import build_overview

OUT = APP_DATA / "fixture-v3"
PLACES = {"homburg": "fixture-v3-homburg", "kirkel": "fixture-v3-kirkel"}
STATS_TILES = ["375_5461"]   # owned by Blieskastel
KMAX = 3

README = """# fixture-v3 — shared S2 test data (generated, git-ignored)

Written by `pipeline/fixture_v3.py` (`cd pipeline && ./run.sh fixture-v3`). Real LiDAR data (LVGL-SL 2025 DGM1/DOM1)
at the Homburg/Kirkel border west of Limbach, in the formats of data contract revision 3.0 ("Many places (v3, S2)").

```
fixture-v3/
  catalog.json                 sle-catalog-v1: homburg ('3d', data_url "homburg/"), kirkel ('3d', "kirkel/"),
                               blieskastel ('stats', no data_url); height_ref_m {href}
  overview/overview.json       sle-overview-v1: bbox {obbox}, levels 2 (4 m, 2 km chunks) and 3 (8 m, 4 km chunks)
  overview/levels/{{k}}/dtm/{{i}}_{{j}}.webp   only present chunks (presence bitmap per level), quant_m 0.05
  homburg/manifest.json        v3 place, rectangle {hrect}, presence {hpres}
  kirkel/manifest.json         v3 place, rectangle {krect}, presence {kpres}
  <place>/dtm/{{i}}_{{j}}.webp                 terrarium, WebP lossless, 502² with apron from real terrain
  <place>/relief/{{svf,opns_pos,opns_neg}}/{{i}}_{{j}}.avif   u8 AVIF q90 (lossy: true), fixed ranges
  <place>/relief/{{chm,mask}}/{{i}}_{{j}}.webp  u8 WebP lossless
  <place>/levels/1/dtm/{{i}}_{{j}}.webp, levels/1/vat/{{i}}_{{j}}.avif   level 1 = one 1 km tile per chunk
  <place>/…                    further keys as written by the later steps (see each manifest)
```

Tiles (1 km, id = SW corner in km; rows north → south):

```
            E 375        E 376        E 377
N 5463      kirkel       kirkel       homburg
N 5462      kirkel       homburg      homburg
N 5461      blieskastel  (no owner in this fixture)
```

What it exercises:
- **Presence:** each place rectangle is 2 × 2 km with one absent tile (homburg: 376_5463, kirkel: 376_5462).
  Absent chunks have no files; the other place publishes them.
- **Seams:** the apron of a chunk equals the edge row of its neighbour in the other place (bit-identical
  heights; each tile is computed from its own source window tile ± 200 m).
- **Status 'stats':** blieskastel owns tile 375_5461 in the catalog but has no data_url: overview terrain only.
- **Overview:** level-2 chunks are present only where they intersect a catalog tile; level 3 is the root set.
- **derived** relief modes (hillshade, slope, slrm, vat from svf + opns_pos); no dsm (canopy = dtm + chm).

Catalog mode: point `VITE_CATALOG_URL` at `data/fixture-v3/catalog.json` (paths resolve relative to it).
Single-AOI mode cannot load these places by `?aoi=` (ids with `/` are rejected by the app); load them via the catalog.

Sources: © GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet; outlines © BKG (2026) CC BY 4.0 (VG25).
"""


def main() -> None:
    places = {}
    tiles = set()
    for pid, key in PLACES.items():
        aoi = load_aoi(key, step="build")
        m = aoi.data_dir / "manifest.json"
        if not m.exists():
            sys.exit(f"{m} missing – run ./run.sh {key} build first")
        places[pid] = (aoi, json.loads(m.read_text()))
        tiles |= set(aoi.owned)
    tiles |= {parse_tile_id(t) for t in STATS_TILES}
    ov = build_overview(OUT / "overview", tiles, KMAX, label="fixture-v3")
    cfg = {pid: {"status": "3d", "data_url": f"{pid}/", "relict_candidates": aoi.relict_candidates,
                 "manifest_version": 3, "pipeline": m["build"]["pipeline"], "built": m["build"]["generated"]}
           for pid, (aoi, m) in places.items()}
    doc = write_catalog(OUT, overview="overview/overview.json", only_tiles=tiles, cfg=cfg)
    fmt = {"href": doc["height_ref_m"], "obbox": ov["bbox"]}
    for pid, short in (("homburg", "h"), ("kirkel", "k")):
        aoi, m = places[pid]
        fmt[f"{short}rect"] = f"{aoi.e0}–{aoi.e1} × {aoi.n0}–{aoi.n1}"
        fmt[f"{short}pres"] = json.dumps(m["presence"])
    (OUT / "README.md").write_text(README.format(**fmt))
    print(f"fixture-v3: {len(doc['places'])} catalog places, {len(tiles)} tiles → {OUT}")


if __name__ == "__main__":
    main()
