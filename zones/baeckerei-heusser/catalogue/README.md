# 📋 Object catalogue (`bh-catalogue-v1`)

Every object in the twin is a row in [`objects.json`](objects.json). No row, no geometry. The structure is [`schema.json`](schema.json) (JSON Schema 2020-12). [`check.py`](check.py) adds the rules a schema can't express, and [`test_check.py`](test_check.py) tests it.

```bash
python3 -I zones/baeckerei-heusser/catalogue/check.py                                  # from the repo root
cd pipeline && uv run python -I -m pytest -q ../zones/baeckerei-heusser/catalogue      # tests
```

## Object

```jsonc
{
  "id": "brotregal/ebene-2/brot-03",   // path id; the parent (prefix) must exist: brotregal → brotregal/ebene-2 → …
  "type": "product",                   // structure | fixture | appliance | container | product | sign | decor (detail per class: docs/style.md)
  "area": "verkaufsraum",              // aussen | verkaufsraum | backstube | lager
  "name_de": "Bauernbrot",             // card title, ≤ 60 chars
  "info_de": "Kräftiges Brot …",       // card text, ≤ 300 chars; required once a clickable object is built
  "where_de": "…",                     // optional placement hint while still planned
  "dims": { "w": 0.30, "d": 0.14, "h": 0.12 },          // metres: width (object's right), depth (front–back), height; null while planned
  "placement": { "rel": { "to": "brotregal/ebene-2", "offset": [-0.6, 0.0, 0.05], "rot_deg": 0 } },
                                       // or { "plan": { "x": 4.2, "z": -2.0, "base_m": 0, "rot_deg": 180 } } in the zone frame; null while planned
  "source": "tape",                    // plan | photo | mesh | tape: where position and size come from (the best one)
  "sigma_m": 0.02,                     // 1-σ uncertainty of position and size, metres
  "refs": ["Aufmaß 2026-11-12"],       // what the source is; never private file names or paths
  "status": "built",                   // planned → blockout → built → verified; retired = removed from the shop
  "clickable": true,                   // gets hover/tap highlight, info card, counts for „entdeckt x / y“
  "public": true                       // default true; false = never exported (outside the consent scope)
}
```

| Field | Rule |
|---|---|
| `id` | Lower-case segments `a-z0-9-` joined by `/`. A segment names a thing, not a place in a list, except numbered siblings (`ebene-2`, `brot-03`). Ids never change once an object is `built`. A moved object keeps its id, and a replaced one gets `retired` plus a new id. |
| `placement.plan` | `x`, `z` = footprint centre in the zone frame (`x = E − 381467`, `z = −(N − 5462254)`). `base_m` = base height above the room floor (the floor level comes from the *Raumplan*). `rot_deg` = grid heading the object's front faces. |
| `placement.rel` | `offset` = `[right, up, forward]` in metres in the reference object's frame (origin at its base centre, front = `rot_deg`). Use it for anything that sits on or in a fixture. No cycles. |
| `source` + `sigma_m` | Ladder `tape` (≈ 0.01–0.02 m) > `plan` (≈ 0.02–0.05 m) > `mesh` (≈ 0.1–0.3 m, the scale prior ± 11 %) > `photo` (≈ 0.2–1 m). Keep the best source and its sigma. |
| `status` | `planned` (listed, no geometry) → `blockout` (grey box at true size) → `built` (styled, named node) → `verified` (checked against tape or photo on site). Leaving `planned` requires `dims` and `placement`. |
| Privacy | No price fields (`preis*`, `price*`) until `consent.prices` is true. `refs` describe sources and never contain private file names or paths. Objects in an area outside `consent.scope` need `public: false`. |

**3D naming:** a built object is one glTF node named by its id (`brotregal/ebene-2/brot-03`, same convention as the zone contract's node names). Picking uses that name to open the card.

## State (2026-11-05)

24 objects, all `planned`, from the reference photos and the capture: facade (shop window, glass blocks, steps, pickup locker, mural), shop shell (tiles, panel ceiling, wood soffit with red edge), counter (glass display, granite ledge, dark-red base), bread shelf (brass rod tiers, price rails, wicker baskets with pink cloths), grid shelf with bread bags, pretzel basket, two pendant lamps, newspaper stand, drinks fridge. Products (breads, cans) come with the *Raumplan* and closer photos.
