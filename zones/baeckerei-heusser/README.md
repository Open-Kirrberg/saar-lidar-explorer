# 🥖 Bäckerei Heusser — digital twin

Zone #2 of the Saar LiDAR Explorer: Bäckerei Heusser, Eckstr. 3, Homburg-Kirrberg, shown with the owners' consent. It is becoming a **built digital twin** ([ADR 0042](../../docs/adr/0042-baeckerei-heusser-built-twin.md)): modelled, clickable objects (counter, shelves, breads, cans …) on a dimensioned floor plan, in a light, friendly, stylised look. Visitors **discover the bakery and its products**. Later rounds add the Backstube and the Lager, plus *Umbau* variants to try out renovations.

## 🧭 Status

| | |
|---|---|
| ✅ Round 2 (2026-11-05) | *Raumplan* v0 ([`plan/`](plan/README.md): public, redacted plan + A3 sheet, `check_plan.py`). Built, stylised twin from the plan ([`build/`](build/README.md)): shop shell (tiles, panel ceiling, soffit, glass front with open door leaves), facade with shop windows, porch and 5 steps, fixture blockouts, DGM1 ground patch, road, neighbour blocks, the passage mouth up to the shop's door. Visitors walk on an exact nav floor from the street into the shop. The capture is a hidden `reference` asset (`?referenz`, local only). [ADR 0043](../../docs/adr/0043-built-twin-package-reference-nav.md) |
| ✅ Round 1 (2026-11-05) | Foundation: this folder, object catalogue + schema, style rules, privacy rules, zone skills, rename `bakery` → `baeckerei-heusser`. The V2.8 capture (photogrammetry mesh, private passage end cropped) is reference only since then. |
| ✅ Round 4a (2026-11-05) | [`products/`](products/README.md): 103 products imported from the bakery's own list (name, category, price, unit, short text; no allergens yet), 33 parametric product shapes in the twin's look at true size, product gallery |
| ✅ Round 3 (2026-11-05) | Inventory from the walkthrough video (103 catalogue rows). Stylised fixtures instead of blockouts: counter with 2 display modules, bread wall (3 tiers + 6 baskets), shelves, fridge, café corner, lamps, decor. `catalogue/slots.json`: 110 product slots. Facade: plinth, glass blocks, sandstone surrounds with pretzel keystone, upper windows, gable with the mural, sign; the shop's lettering since the owners' OK ([ADR 0044](../../docs/adr/0044-baeckerei-heusser-owner-consent.md)) |
| ✅ Round 4b (2026-11-05) | Shop filled: *Morgens* fill (≈ 490 pieces in 105 slots, every category; `--fill feierabend` = empty like the video), `produkt/<slot>` nodes, visitor catalogue `built/catalogue.json` in the package (ADR 0045); facade polish (muted plinth, solid red quoins, no wall cracks, level gable eaves), smaller pendants, du-form info texts |
| ✅ Round 5 (2026-11-05) | Clickable twin in the app: hover / tap highlight, info cards with price and unit, *entdeckt x / y* (67 discoverable: 48 placed products + 19 objects), stored on the device only (`app/src/zones/runtime/twin*.ts`, [zone contract](../../docs/zone-contract.md)) |
| ⏳ Next | Short tour; one tape measurement (`plan/messliste.md`, A) fixes the scale |
| ⏳ Later | Backstube, Lager, *Umbau* variants (`variants/`) |

## 🗂️ Layout

| Path | What |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Rules for working on the twin (read first) |
| [`docs/style.md`](docs/style.md) | Look: palette, edges, light, detail per object class, interaction |
| [`catalogue/`](catalogue/README.md) | Object catalogue: schema, `objects.json`, `check.py` |
| [`plan/`](plan/README.md) | *Raumplan*: the dimensional backbone (v0, public version; the full plan stays private) |
| [`build/`](build/README.md) | Generator: plan + open survey data → `twin.glb` + `nav.glb` → zone package |
| [`variants/`](variants/README.md) | *Umbau* variants against the current state (*Ist-Stand*) |
| `.claude/skills/` | `bh-twin-objekte`, `bh-aktualisieren`, `bh-umbau`, `bh-datenschutz` |

Generated packages go to the git-ignored `app/public/data/zones/baeckerei-heusser/`. Capture config: [`tools/capture/zones/baeckerei-heusser.toml`](../../tools/capture/zones/baeckerei-heusser.toml).

```bash
python3 -I zones/baeckerei-heusser/catalogue/check.py          # catalogue check (stdlib only)
zones/baeckerei-heusser/build/run.sh                           # build the twin + pack it into the zone package
tools/capture/run.sh baeckerei-heusser package                 # re-package the reference capture (≈ 30 s, runs `twin` too)
.claude/skills/sle-roadmap/scripts/verify.sh twin              # catalogue, plan, generator, capture tool (also part of `verify.sh` all)
```

## ⚖️ Principles

- **Plan first.** The *Raumplan* fixes the dimensions. Every object has a catalogue id, a source (`plan`, `photo`, `mesh`, `tape`) and an uncertainty `sigma_m`.
- **Built, not scanned.** Modelled geometry is what visitors see. The capture is for measuring.
- **Stylised, true proportions.** Simplified shapes and real shop colours. Sizes are never stylised.
- **Consent scope = shop + exterior.** No people, plates, private entrances or health details. Prices only if the owners agree. Third-party photos are reference only, never textures. Raw material stays in a private folder outside the repo. Details: [`bh-datenschutz`](.claude/skills/bh-datenschutz/SKILL.md).
- **Frames.** Zone frame from the [zone contract](../../docs/zone-contract.md): EPSG:25832, `x = E − E0`, `y = h` (DHHN2016, true heights), `z = −(N − N0)`, `E0/N0 = 381467/5462254`.
