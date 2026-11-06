# Products

The bakery's product range as data (`products.json`) and as stylised low-poly meshes (`shapes.py`), with a
labelled gallery (`gallery.py` → `out/gallery.glb`) to check how they read. The twin places these meshes in its
shelves and counter. The products are not catalogue objects themselves: the catalogue entry is the shelf slot or
basket, and its `product` reference names an id from this file.

| File | What |
|---|---|
| `import_products.py` | hq product folder (`*.md`) → `products.json`. Stdlib only, parses text, never executes |
| `products.json` | Generated, committed. 103 products, sorted by `numeric_id` |
| `shapes.py` | Parametric recipes: `build(product, idx)` → parts, `add_to_node(node, parts, origin, rot)` |
| `gallery.py` | Every product on a tray per category, true sizes, baked light → `out/gallery.glb` + `out/gallery.json` |
| `fill.py` | Fills (`bh-fill-v1`): which product or generic good lies in which slot, how many. `layout()` (shared with the generator) and `check_fill()` (category allowed, count ≤ 3 × slot capacity, the pieces fit the slot); `python3 -I products/fill.py` checks all fills. Stdlib only |
| `fill/morgens.json`, `fill/feierabend.json` | Morning (shortly after opening: ≈ 570 pieces in 118 slots, every category; wave B: breads dense on the four tiers, the two lower ones with price cards) and closing time (empty, like the walkthrough video). Both are packed; visitors switch with the *Morgens* / *Feierabend* toggle (`name_de` = its label, `info_de` = its tooltip) |
| `waren.py` | Generic shop goods without a product card (jar, can, bottle, cup, coffee pack, bread in a paper bag, pastry bag; no brands, no text, 56–126 triangles) and low-triangle rolls for heaped baskets (`low()`, ≤ 120 triangles, same silhouette, colours and painted signature detail) |
| `tests/` | pytest on a **synthetic** fixture folder (the real hq files are never read by tests); `test_fill.py` checks the committed fills, the shared layout, budgets and determinism |
| `out/` | Generated, git-ignored |

## Re-import and build

```bash
# 1. products.json from the hq folder (only that folder; the importer reads *.md there, skips _template.md)
python3 -I zones/baeckerei-heusser/products/import_products.py <hq>/products
# 2. gallery (needs numpy and the generator: run from pipeline/)
cd pipeline && uv run python -I ../zones/baeckerei-heusser/products/gallery.py      # --instances 3 shows variation
# 3. tests
cd pipeline && uv run python -I -m pytest -q -p no:cacheprovider ../zones/baeckerei-heusser/products
```

The importer prints its counts: products, name fixes, and shape guesses. A **shape guess** means a product id that
no rule in `RULES` matches. It falls back to its category's shape (`FALLBACK`). Add a rule, then re-run. Rerunning
on the same folder gives a byte-identical file.

## `products.json` (schema `bh-products-v1`)

Top level: `schema`, `source` (`"hq-products"`), `count`, `categories`, `name_fix` (list of `{id, from, to, why}`),
`products`.

| Field | Meaning |
|---|---|
| `id`, `numeric_id` | From the source front matter (kebab-case id, the shop's number) |
| `name_de` | Display name, with obvious typos fixed (see `name_fix`) |
| `name_src` | The source name, unchanged |
| `category` | `brot`, `baguette`, `broetchen`, `snacks`, `teilchen`, `kuchen`, `torten` |
| `price_eur` | Price from the source (owners approved showing prices; see Privacy) |
| `sale_unit` | `Laib`, `Stück`, `1/4`, `Blech`, `ganzer Kuchen`, `ganze Torte`, `ganze Rolle`, or `null` when the source does not say (*Sahnerollen*: how many rolls the row holds) |
| `weight_g` | From the name (`500g`), else `null` |
| `short_de` | `short_description` from the source |
| `info_de` | First body paragraph, at most 300 characters (cut at a sentence end, else at a word with `…`) |
| `available`, `seasonal` | From the source |
| `shape`, `shape_params` | Recipe name in `shapes.RECIPES` and its parameters (chosen by the id rules) |
| `size_m`, `sigma_m` | True size `[w, d, h]` in metres (w = longest horizontal extent) and its 1-σ |
| `size_basis` | `type` (typical size of that product type) or `weight` (scaled by ∛(weight / reference weight)) |
| `piece_of` | On a `…-1-stueck` / `…-1-4-stueck` row: the id of the product it is one piece of (a whole cake or ring, or the multi-piece *Sahnerollen* row) |
| `shape_guess` | Only when no rule matched (category fallback) |
| `source`, `source_file` | `"hq-products"` and the source file stem |

**Not imported, on purpose:** allergen fields (they stay out until the owners confirm the data is complete) and
image paths (the twin uses its own meshes, not the website's images). The tests check that neither appears.

**Name fixes in the current import (6):** `Schwabenkornt 500g` → `Schwabenkorn 500g`, `Sckokobrötchen` →
`Schokobrötchen`, `Pain Chocolate` → `Pain au Chocolat`, `Taschen Schleifen` → `Taschen & Schleifen`, and a closing
`)` added to both `Kranzkuchen gefüllt (Nuss, Schoko, Quark oder Pudding …` names. Known typos inside the source
*texts* are left as they are, because texts are the owners' copy, for example "Lieblingsfüchte" and "Sahnenrolle".
These should be fixed in the hq folder.

## Sizes

Sizes are estimates of typical German bakery goods, set per type in `SIZES` (with overrides per rule), and
weight-scaled for breads (`500g`/`750g`/`1000g`). `sigma_m = max(0.01, 0.08 × largest dimension)`. None of them
is measured yet. A tape measurement in the shop (rule 5: `tape` beats estimates) should replace the values in
`SIZES` / `RULES` and lower `sigma_m`.

Assumptions you may want to check in the shop:

- Rahm-, Käse-, Apfel- and Kirschkuchen are round Springform cakes (28 cm), sold in pieces of 1/10. Streuselkuchen
  groß is sold in quarters.
- *Sahnerollen* are cream-filled waffle rolls (the shop's own text: "mit frischer Sahne gefüllte Waffelrollen").
  One roll (`sahnerolle`) is 12 cm long including the cream at both ends and 3.4 cm across. The 20 € row
  (`sahnerollen`) is shown as five stacked rolls. The price ratio (2 € each) suggests about ten, so its `sale_unit`
  is `null` until the shop says how many it holds. Only the *Buttercreme-Rolle* is a Biskuitrolle (`rolle`).
- The Kranzkuchen design (two twisted strands, icing) and the Zopf (four-strand look) are generic, not from the
  shop. Photos of the shop's own pieces would improve them.
- Sizes of Blechkuchen pieces, Plunder and the Granatsplitter are typical values.

## Recipes (`shapes.py`)

Local frame: x = width, y = up, z = depth, base at y = 0, centred. `build` fits every recipe exactly to `size_m`
(tests: ±2 %), then applies the seeded variation: scale ±6 %, x/z stretch ±2 %, rotation ±15°, crust tone −6…+4 %,
all from `sha256(id#instance)`, so the same instance always looks the same. The look is the twin's: unlit
base colour plus light baked into `COLOR_0` (`bh_twin.geom.Node.add`, rig `shade.interior_rig`), smooth normals,
round-overs instead of hard edges (bevels 3–8 mm), and a contact shadow at the foot.

| Shape | Products | Params | Signature detail | Max tris |
|---|---|---|---|---|
| `laib-rund`, `laib-oval` | Brot | `crust`, `cuts` (kreuz, gitter, raute, schraeg, laengs, riss), `flour`, `topping` | Domed lathe loaf, flour cap with scoring or a seed/sesame cap | 288 |
| `kastenbrot` | Kastenbrote, Kastenweißbrot | `crust`, `topping`, `flour`, `dome`, `cuts` | Tin loaf as one smooth body (`loaf`): pale tin walls, a rounded muffin top ≤ 3 mm over the tin, crust or seeded crown | 272 |
| `rosinenbrot` | Rosinenbrot | – | Domed tin loaf with raisins | 278 |
| `baguette` | Baguette, Roggenflit | `crust`, `cuts` (count), `flour` | Tapered tube with diagonal cuts | 298 |
| `broetchen-rund` | most Brötchen | `crust`, `topping`, `cuts`, `flour`, `salt`, `oval` | Dome roll; mohn / sesam / körner / käse cap, Laugen cross + salt | 262 |
| `broetchen-stern` | Sternweck | `crust` | Kaiser pinwheel: five curved grooves | 226 |
| `broetchen-schlitz` | Samstags-, Flit-, Elsässer-, Knusperweck | `crust`, `flour`, `pointed` | Oval roll with one long split | 206 |
| `doppelweck` | Doppelweck, Einback | `crust`, `lobes` | 2 or 3 fused lobes | 270 |
| `hoernchen` | Hörnchen, Plunder-Hörnchen | `crust`, `topping`, `glaze` | Crescent tube, cap or glaze drizzle | 258 |
| `croissant` | Croissant | – | Rolled crescent with segment ridges | 238 |
| `brezel` | Brezel | – | Catmull-Rom pretzel path: thick belly with the light split, thin arms, salt | 297 |
| `laugenstange` | Laugen-, Käsestange (± Schinken) | `crust`, `salt`, `topping`, `ham` | Stick with salt or cheese crust | 210 |
| `laugenecke` | Laugenecke | – | Rounded triangle with salt | 217 |
| `schnecke` | Gefüllte Schnecken | `fillings` | Low dome with filling spiral + icing | 238 |
| `tasche` | Taschen, Puddingstückchen, Quarktasche | `form` (umschlag, quadrat, dreieck), `filling` | Folded pastry with filling showing | 167 |
| `pain-au-chocolat` | Pain au Chocolat | – | Layered block, chocolate ends | 196 |
| `muffin` | Muffin | `topping` | Paper cup + domed top with chips | 184 |
| `granatsplitter` | Granatsplitter | – | Chocolate cone on a biscuit base | 168 |
| `blechkuchen-stueck` | Plotzer, Butter-, Streusel-, Blechkuchen-Stück | `topping` / `toppings` | Slab with baked golden sides and topping | 224 |
| `blechkuchen` | Blechkuchen (whole) | `toppings` | Tray with four topping bands | 572 |
| `rundkuchen` | Rahm-, Käse-, Apfel-, Kirsch-, Streuselkuchen | `topping` | Springform cake with slice lines | 373 |
| `kuchen-stueck` | their pieces | `topping`, `pieces` | Wedge, tip towards the visitor | 92 |
| `kastenkuchen`, `kastenkuchen-scheibe` | Marmor-, Zitronen-, Nusskuchen | `kind` | Loaf cake as one body in a tapered tin with a cracked top (lemon glaze and drips, chocolate coat) / slice with marble swirl | 332 / 59 |
| `kranzkuchen`, `kranzkuchen-viertel` | Kranzkuchen (± filled), quarters | `filled`, `fillings` | Two-strand twisted ring, icing wave, sugar or almonds; filled: a filling core peeks out along the grooves | 752 / 248 |
| `zopf` | Zopf (± filled) | `filled`, `fillings` | Overlapping braid lobes over a continuous tapered core (no gaps from above); pearl sugar, or filling core + one continuous icing zig-zag | 719 |
| `tortenboden` | Obstboden, Tortenboden | `kind` | Flan base with rim / three sponge layers | 360 |
| `rolle` | Buttercreme-Rolle | `cream` | Combed cream log (long ridges) with spiral end faces, chocolate zig-zag, rosettes | 316 |
| `sahnerolle`, `sahnerollen` | Sahnerollen (1 Stück), Sahnerollen | – | Golden rolled waffle tube with whipped cream puffing out of both ends / five of them stacked | 144 / 720 |
| `torte` | Schwarzwälder, Sahne-, Buttercreme-Torte | `kind` | Cream torte with rosettes; Schwarzwälder: chocolate sides, cherries; Buttercreme: almond foot band, centre rosette with chocolate shavings | 744 |

`Max tris` is the largest instance in the current gallery. There are 33 recipes, and the 103 products come to 27,074
triangles in total.

### Triangle budget

`docs/style.md` sets **≤ 300 triangles per product instance**. All small items keep to it. **Exception:**
whole cakes, tortes, rolls and the Blech (`LARGE` in `shapes.py`: blechkuchen, rundkuchen, kastenkuchen,
kranzkuchen, zopf, torte, tortenboden, rolle, sahnerollen) may use **≤ 800**. There are few of them (one per display), they are
the counter's showpieces, and a readable twist or rosette needs the extra rows. `gallery.py` exits non-zero and the
tests fail when an instance goes over its budget. Heaped basket rolls (`waren.low`) keep to **≤ 120**, generic goods to
**≤ 160**. On phones, products should still be instanced and grouped into
one tap target per basket (style.md).

## Palette

`kruste-hell`, `kruste` and `kruste-dunkel` are style.md's. The other tokens are new and listed here until the lead
merges them into `docs/style.md`. All are sRGB, with moderate saturation.

| Token | Hex | Use |
|---|---|---|
| `kruste-hell` | `#E3B776` | light crust (style.md) |
| `kruste` | `#C68642` | crust (style.md) |
| `kruste-dunkel` | `#8A5228` | dark crust (style.md) |
| `schwarzbrot` | `#6B4129` | rye/wholemeal tin crust |
| `lauge` | `#8C4A22` | lye crust |
| `ausbund` | `#F0CF96` | opened score / split |
| `ausbund-lauge` | `#C99062` | Brezel belly split |
| `krume` | `#F0E0BC` | crumb (cut faces) |
| `krume-dunkel` | `#A57B57` | dark crumb, crumble shadow |
| `mehl` | `#EFE9DE` | flour dusting |
| `salz` | `#FAF9F5` | pretzel salt |
| `mohn` | `#4A4C53` | poppy-seed cap (neutral dark grey, not navy) |
| `mohn-hell` | `#73757B` | poppy-seed speckles on the cap |
| `sesam` | `#EBD8A6` | sesame cap |
| `kuemmel` | `#6A5034` | caraway |
| `koerner` | `#C29A5E` | seed / grain cap |
| `hafer` | `#E6D7B2` | oat flakes |
| `kaese` | `#EAB84A` | baked cheese |
| `schinken` | `#D9898A` | ham |
| `schoko` | `#4E2E20` | chocolate |
| `nuss` | `#8C5E3B` | nut filling |
| `rosine` | `#553131` | raisins |
| `pudding` | `#F3D063` | custard |
| `quark` | `#F7F1E1` | quark filling |
| `kirsche` | `#9E2335` | cherries |
| `apfel` | `#EBDA9E` | apple |
| `streusel` | `#DFB06A` | crumble |
| `butter` | `#E2AE52` | butter / sugar top |
| `mandel` | `#E5C996` | almond flakes |
| `sahne` | `#FCF8F0` | whipped cream |
| `buttercreme` | `#F4E2AE` | butter cream |
| `zuckerguss` | `#FAF7F0` | icing, pearl sugar |
| `biskuit` | `#F0CF86` | sponge |
| `schoko-biskuit` | `#6B4330` | chocolate sponge |
| `kaesemasse` | `#F3DD9C` | cheesecake filling |
| `rahm` | `#F2E3B6` | Rahmkuchen top |
| `zitrone` | `#F3DE8E` | lemon glaze |
| `papier` | `#EFE6D6` | muffin paper |
| `waffel` | `#D9A45C` | waffle tube (Sahnerolle) |
| `tablett` | `#D9CFC0` | gallery tray |

## Privacy

- Owners approved showing names, prices and texts (ADR 0044, `consent.prices`). The visitor catalogue
  (`built/catalogue.json`) carries `price_eur` because of that consent; without it the generator writes `null`.
- No allergens and no image paths are imported. The importer reads only the product folder it is given, and only
  its `*.md` files, as text. It skips symlinks and anything that resolves outside that folder.
- `info_de` is the shop's own copy (it addresses readers as *ihr*/*unser*), so it does not follow the twin's *du*
  style. Shorten or rewrite it in the twin only with the owners.
