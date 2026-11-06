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
  "clickable": true,                   // gets hover/tap highlight, info card
  "discover": true,                    // optional: one of the ≈ 20 curated objects that count for „entdeckt x / y“
                                       // (needs clickable + info_de; products always count once placed)
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
| Privacy | Price fields (`preis*`, `price*`) only while `consent.prices` is true (it is since 2026-11-05, ADR 0044; `consent.lettering` and `consent.history` likewise). `refs` describe sources and never contain private file names or paths. Objects in an area outside `consent.scope` need `public: false`. |

**3D naming:** a built object is one glTF node named by its id (`brotregal/ebene-2/brot-03`, same convention as the zone contract's node names). Picking uses that name to open the card.

## Guided tour (`bh-tour-v1`)

[`tour.json`](tour.json) is the visitor's *Kleine Führung*: 2–12 stops (6 today), each with an `id`, a `title_de` (≤ 60), a `text_de` (1–3 sentences in the *du* form, ≤ 300; facts only from this catalogue, the README and the products, no health claims, no people), an optional `target` (a clickable object with a card), `eye` and `look` (`[x, y, z]` in the zone frame: where the camera stands, eye height included, and what it looks at) and optional `via` (`[x, z]` waypoints of the glide in from the previous stop, e.g. around the house corner). The generator checks it (`build/build.py` `tour_block`, `build/test_tour.py`) and packs it as the catalogue's `tour` (docs/zone-contract.md „Tour“). To find a good `eye`, walk there in the app and read `sle.zones.flow.handle().debug().pose` (convert E/N to x/z).

## Product slots (`bh-slots-v1`)

[`slots.json`](slots.json) lists the places where products can go (round 4). The generator writes it from the same fixture parameters it builds the geometry from (`build/run.sh --update-catalogue`; every build also writes `build/out/slots.json`). Do not edit it by hand. `check.py` validates it next to `objects.json`.

```jsonc
{
  "format": "bh-slots-v1",
  "zone": "baeckerei-heusser",
  "frame": "zone (x = E − E0, y = height above sea level, z = −(N − N0)) …",
  "units": "m",
  "plan": { "version": "v0", "scale_factor": 1.0 },
  "catalogue": "bh-catalogue-v1",
  "categories": ["brot", "broetchen", "laugengebaeck", "suesses", "kuchen", "glas", "dose", "flasche", "tuete"],
  "slots": [
    {
      "id": "brotregal/ebene-2/platz-03",     // <fixture id>/platz-NN
      "fixture": "brotregal/ebene-2",         // a catalogue id: the shelf, tier, basket or display level
      "pose": { "x": 2.596, "y": 245.858, "z": -0.036, "heading_deg": 70.7 },
                                              // slot centre on its standing surface (zone frame); heading = grid heading of the slot's front
      "tilt_deg": 25.0,                       // slope of the standing surface, + = back edge up (sloped rod tiers, baskets)
      "size": { "w": 0.223, "d": 0.36, "h": 0.26 },   // usable size: across the front, front to back, clear height
      "capacity": 1,                          // pieces in one layer; a fill may put up to 3 × capacity (heaps, stacks)
      "capacity_de": "1 Brot (rund Ø ≈ 0,22 oder Kastenbrot quer)",
      "categories": ["brot"]                  // what may stand there (from the list above)
    }
  ]
}
```

| Field | Rule |
|---|---|
| `id` | `<fixture>/platz-NN`, NN = 01, 02 … from the left of the slot row as seen from its front. Unique. |
| `fixture` | Must be a catalogue id (the most specific part the slot sits on). |
| `pose`, `tilt_deg` | Zone frame (`y` = absolute height, the shop floor ±0.00 is at 244.25 m), metres and degrees; `heading_deg` in 0..360, `tilt_deg` in −60..60. |
| `size` | `w`, `d`, `h` > 0 and ≤ 5 m. |
| `capacity` | Integer 1..500; `capacity_de` ≤ 120 chars. |
| `categories` | Non-empty, from the fixed list. |
| Privacy | No price fields, ever (prices are not part of the slots). |

Fills (`../products/fill/*.json`, `bh-fill-v1`) are checked against the slots by `../products/fill.py` (category allowed, count ≤ 3 × capacity, the layout fits the slot). Counts (round 3): display deck 6, glass shelf 6, glass top 8 (bags), pretzel stand 10, bread shelf tiers 14 / 15 / 14, 6 baskets, grid shelf 5, jar shelf 5 + 8, fridge 5, cube shelf 8 = 110 slots. `build.py --debug-slots` draws magenta plates for them (debug only, never a release).

## State (2026-11-05)

24 objects, all `planned`, from the reference photos and the capture: facade (shop window, glass blocks, steps, pickup locker, mural), shop shell (tiles, panel ceiling, wood soffit with red edge), counter (glass display, granite ledge, dark-red base), bread shelf (brass rod tiers, price rails, wicker baskets with pink cloths), grid shelf with bread bags, pretzel basket, two pendant lamps, newspaper stand, drinks fridge. Products (breads, cans) come with the *Raumplan* and closer photos.

Round 3 (Verkaufsraum): the shop shell and all placed fixtures, appliances and decor are styled models (`built`); the old grid-shelf bread bags went back to `planned` (products come in round 4), as did the pretzel basket, the baker figures, the radiator and the fourth picture frame (not placed yet). 110 product slots in `slots.json`.

Round 4b: the morning fill puts ≈ 490 products and generic goods into 105 slots (`produkt/<slot id>` nodes); display slots hold a tray of pieces (capacity 4 / 12), basket slots sit on a raised cloth insert (heaped rolls). Short du-form `info_de` for the facade and shop objects (no mushrooms in the window decoration, granite wording on the counter, history only as the owners approved it, ADR 0044); 19 rows marked `discover` (not `theke/vitrine`: its products take nearly every pick). The build writes the visitor catalogue `built/catalogue.json` from these rows; `clickable: false` rows (`fassade`, `verkaufsraum`) are left out, so facade details and the door are their own tap targets from the street.
