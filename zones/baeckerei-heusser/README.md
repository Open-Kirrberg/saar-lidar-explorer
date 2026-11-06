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
| ✅ Morgens / Feierabend (2026-11-06) | Both fills in one package: the product nodes carry `extras.fills`, `built/catalogue.json` names the states (`fills`, [zone contract](../../docs/zone-contract.md) „Fills“). A small toggle *Morgens* / *Feierabend* under the counter switches the shelves and the display without reloading; *entdeckt x / y* counts the objects plus the products of the current state (67 / 19). +2 KB on `twin.glb`, +2 KB catalogue |
| ✅ Tour + tap targets (2026-11-06) | *Kleine Führung*: 6 stops (gable mural → shop windows and keystones → counter → bread wall → café corner → old pictures) from [`catalogue/tour.json`](catalogue/tour.json), packed as the catalogue's `tour` ([zone contract](../../docs/zone-contract.md) „Tour“). *Führung* button next to the fill toggle; the camera glides to each stop (walking: onto the floor), the stop's object is highlighted; *Zurück* / *Weiter* / *Tour beenden*, Esc. Small products get ≈ 44 px pick proxies on touch (bread wall: ≈ 2.7× the tappable area on a 390 px phone); the gable mural and other flat wall pieces get a warm picture frame instead of the faint outline |
| 🌐 Released (2026-11-06) | Public on GitHub Pages: rounds 3–5 in the code repo; the zone package (`zone.json` + `built/`, no reference assets) in the data repo `saar-lidar-data/zones/`. Bakery content is not MIT ([`NOTICE.md`](../../NOTICE.md)) |
| ✅ Wave A (2026-11-06) | Facade and passage ([ADR 0047](../../docs/adr/0047-baeckerei-heusser-abholschrank-backstube-entrance.md)): both shop windows the same width (1.905 m), trapezoid keystones, „H.H.“ in Fraktur over „AD 1933“; the **Backstube entrance** (niche with terrazzo steps, rail, glass blocks, closed aluminium door; outside only, walkable to the door); the **Abholschrank** at its true place in the passage (sign „Abholstation“ only); the passage public up to y 4.35 with herringbone paving and a brown plinth band; the lowest porch steps run under the corner pillar. 69 discoverable (21 objects) |
| ✅ Wave B (2026-11-06) | Verkaufsraum from the 2026 photo and the video: glass front and side wall in **white** aluminium frames; the soffit's wood only on its fascia between two red lines, white underside; near-white ceiling; floor tiles laid **diagonally** (45°, parallel to the counter); the **bread wall with 4 tiers** (plan F2) packed dense in the *Morgens* fill, the two lower tiers with white price rails and **price cards** (name + price from the product list); old pictures as simple drawn vignettes (wheat, the old house, a brick oven; no faces); egg-shaped pendants. ≈ 152 k triangles, 3.2 MB packed |
| ⏳ Next | See [Next up](#-next-up) |
| ⏳ Later | Backstube, Lager, *Umbau* variants (`variants/`) |

## 🛠️ Next up

Open items after the 2026-11-06 release, roughly by value. Each is one round: plan → subagents → gates → screenshots → one commit.

1. ~~**Short guided tour**~~: done (2026-11-06), see the status table.
2. ~~**Morgens / Feierabend toggle**~~: done (2026-11-06), see the status table.
3. **Tape measurement A** (`plan/messliste.md`): one *Bandmaß* fixes the capture scale (± 11 % today); then rebuild from the plan.
4. ~~**Tap targets and highlights**~~: done (2026-11-06): pick proxies for small products, a picture frame for the mural. Still unverified on real hardware: pointer lock, a phone, the toast timing, the tour glide's feel.
5. **Product data** (fix it at the source, then re-import with `products/import_products.py`): a *Snacks* category for Brezel / Laugenbrötchen. Show allergens only once the owners confirm the list is complete (52 of 103 have them today).
6. **Copy review**: some product texts make health claims (*gesund*, *reich an Ballaststoffen*; the bakery's own copy). The `capture.privacy` note in `zone.json` describes what was removed from the scan; reword it if wanted.
7. ✅ **Release tooling** (2026-11-06): `export-data.sh` follows the v2 checkout's data symlinks (inside the allowed roots only) and refuses to delete more than 20 staged files without `--allow-deletes`. Open: a full run from v2 would still drop `print/` from `saar-lidar-data-2` (no print series here); decide at the next full release, `--zones-only` stays the bakery path.

Not planned: anything beyond the passage privacy line (y 4.35, ADR 0047): the residents' door, the mailboxes, the courtyard. The Backstube stays closed (outside only) until a later round.

## 🗂️ Layout

| Path | What |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Rules for working on the twin (read first) |
| [`docs/style.md`](docs/style.md) | Look: palette, edges, light, detail per object class, interaction |
| [`catalogue/`](catalogue/README.md) | Object catalogue: schema, `objects.json`, `check.py`; the guided tour `tour.json` |
| [`plan/`](plan/README.md) | *Raumplan*: the dimensional backbone (v0, public version; the full plan stays private) |
| [`build/`](build/README.md) | Generator: plan + open survey data → `twin.glb` + `nav.glb` → zone package |
| [`variants/`](variants/README.md) | *Umbau* variants against the current state (*Ist-Stand*) |
| `.claude/skills/` | `bh-twin-objekte`, `bh-aktualisieren`, `bh-umbau`, `bh-datenschutz` |

Generated packages go to the git-ignored `app/public/data/zones/baeckerei-heusser/`. Capture config: [`tools/capture/zones/baeckerei-heusser.toml`](../../tools/capture/zones/baeckerei-heusser.toml).

```bash
python3 -I zones/baeckerei-heusser/catalogue/check.py          # catalogue check (stdlib only)
zones/baeckerei-heusser/build/run.sh                           # build the twin + pack it into the zone package
tools/capture/run.sh baeckerei-heusser package                 # re-package the reference capture (≈ 30 s, runs `twin` too)
zones/baeckerei-heusser/build/run.sh --fill feierabend         # same, but a visit starts in the empty shop (both fills are packed)
scripts/release/export-data.sh --zones-only --dry-run         # release: show what would be staged (zones/ only)
scripts/release/export-data.sh --zones-only                   # then `git add zones/` in ../_release/saar-lidar-data (never -A)
.claude/skills/sle-roadmap/scripts/verify.sh twin              # catalogue, plan, generator, capture tool (also part of `verify.sh` all)
```

## ⚖️ Principles

- **Plan first.** The *Raumplan* fixes the dimensions. Every object has a catalogue id, a source (`plan`, `photo`, `mesh`, `tape`) and an uncertainty `sigma_m`.
- **Built, not scanned.** Modelled geometry is what visitors see. The capture is for measuring.
- **Stylised, true proportions.** Simplified shapes and real shop colours. Sizes are never stylised.
- **Consent scope = shop + exterior.** No people, plates, private entrances or health details. Prices only if the owners agree. Third-party photos are reference only, never textures. Raw material stays in a private folder outside the repo. Details: [`bh-datenschutz`](.claude/skills/bh-datenschutz/SKILL.md).
- **Frames.** Zone frame from the [zone contract](../../docs/zone-contract.md): EPSG:25832, `x = E − E0`, `y = h` (DHHN2016, true heights), `z = −(N − N0)`, `E0/N0 = 381467/5462254`.
