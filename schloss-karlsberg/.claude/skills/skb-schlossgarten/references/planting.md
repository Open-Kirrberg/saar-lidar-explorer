# Planting palette, tree shapes, landcover and ground colours (summer 1789)

The default season is **July 1789** (viewer `state.doy = dayOfYear(1789, 7, 15)`). The full table with sources is research/11
§3. Tree ages are in research/11 §3.2, and the forest and species context is in research/02 §3.2. Colours here are sRGB
starting points [I]. Tune them against the screenshots under the calibrated light, not under today's near-zero IBL
(visual-audit §4.1).

## Species palette and roles

| Species | Role at the Karlsberg | Tag | July look |
|---|---|---|---|
| *Tilia* (Linde) | default avenue tree (TF-10, approaches) | [N] | mid/yellow-green ovoid crowns; *T. × europaea* flowers early July (pale yellow haze) |
| *Aesculus hippocastanum* (Rosskastanie) | "allée des marronniers sauvages" (PV u., unlocated); TF-10 alternative | [D PV] avenue; species [I med] (research/11 §3.3) | **dark** green, broad domes. **No leaf-miner browning** (*Cameraria* arrived in the 1980s–90s) |
| *Castanea sativa* (Edelkastanie) | **Herzogskastanien** above the Hirschwürzloch (S13) | [D] de.wikipedia "Esskastanien" | glossy long serrated leaves, **cream catkins in late June–July** |
| *Malus domestica* | Apfelallee TF-14 | [D] | low (4–5 m), wide, irregular, trunk leaning ±8°, green fruit |
| *Populus nigra* 'Italica' | columnar accents: the chaussée to Homburg (PV 8), Petri's lawn, the Mühlenweiher island | depiction [D]; species [I]. **Date conflict [U]**: de.wikipedia dates German cultivation to the early 19th century | narrow 3–4 m columns, grey-green shimmer |
| *Carpinus betulus* | clipped hedges, palissades | [N] | fresh mid-green, flat clipped faces |
| *Buxus sempervirens* | bed edgings | [N] | dark green 0.15–0.25 m bands |
| *Taxus baccata* | clipped cones in plates-bandes | [N] | near-black green |
| *Citrus* in tubs | Orangerie parterre, May–October | [D] research/01 row 17; [HMS] tubs | glossy dark standards, a few white flowers, green/orange fruit |
| Flowering shrubs (Syringa, Philadelphus, Rosa, Viburnum, Cornus mas, Laburnum, Spiraea, Rhus) | Petri's multicoloured clumps; terrace borders | clumps [D plan]; species [N] | mixed greens; roses in flower (HMS: roses and sunflowers on the terrace) |
| Conifers (*Pinus strobus*, *Picea*, *Larix*, *Pinus sylvestris*) | dark pointed singles and groups in Petri's lawn; *P. sylvestris* on the sandy ground near the Karlsbergweiher | symbol [D plan]; species [N] | blue-green to dark cones |
| Exotics (*Liriodendron*, *Robinia*, *Platanus*, *Larix*) | specimen trees in the young landscape garden; the Karlslust arboretum (August Petri) | [D] a surviving tulip tree (research/10 b.7 T5); Robinia, larch, plane [D] research/10 b.7 T17; placement [I] | lighter, distinctive leaf textures as single accents |
| *Fagus sylvatica* with *Quercus* | forest belts, the Buchenberg, the E plateau toward the Louisenhof "Buchenwald" | [D] place names, 1768 plan | dense, dark canopy; beech bark light grey (≈ `#8A8580` [I]), not black |
| Hay meadow | W and SW slopes, valley floor | [D PV] | first cut done or under way: mown light-green and straw strips beside tall seeding grass [N] |
| Field crops (rye, spelt, oats) | plateau N/NE of the service row, around the Carlsberger Hof | [I] PV, K05/LP06 parcels, HMS | **golden** at harvest |
| *Vitis vinifera* | LP06 30 Weinberg, W/SW slope strip | [D] | green rows on stakes over bare soil |

## Age and size in 1789

- Avenues and clumps were planted in 1778–1788, so they are **1–11 years old**. Avenue trees are 5–8 m, clump shrubs 2–4 m
  and clump trees 5–8 m [D->].
- Retained older trees from the former "Wald" near the CdL and the pre-1768 Louisenhof beech wood are **18–25 m** [I]. Use
  them as standards in clumps and at forest edges.
- Herzogskastanien (planted after 1777) are ≤ 12 years old, about 5–8 m [I].
- Lombardy poplars grow fast: 8–12 m after 8–10 years [N].

## Proposed `SPECIES` additions (`model/src/site/trees.ts`, research/11 S4)

The current entries are tilia, malus, aesculus, forest and citrus, all with lobed icosahedron crowns. Proposed:

| key | height | crown | stretch | trunkFrac | leaf | shape note |
|---|---|---|---|---|---|---|
| `castanea` | 7 | 3.0 | 1.0 | 0.3 | `#55702F` | broad, open; July catkin tint as a per-instance colour share |
| `populus_italica` | 10 | 1.4 | 3.2 | 0.15 | `#6E8A4E` | column; crown starts low |
| `conifer` | 8–14 | — | — | 0.1 | `#2F4A33` | a cone, not lobes |
| `shrub_flowering` | 2.5 | 1.6 | 0.8 | 0.05 | per instance from `#7A8F55`, `#C9A0B8`, `#E8E0C8`, `#D9C060` (about 15 % flower share) | 2-lobe crowns (cheap) |
| `taxus_cone` | 1.0 | — | — | 0 | near-black green | clipped cone |
| `beech_old` | 24 | broad | — | 0.3 | dark | standards at edges; light grey bark |

Fix the crown character per species: Tilia ovoid and dense, Aesculus a broad dark dome, Malus low and wide, Castanea broad
and open. The current `SPECIES.forest` bark `#4B4238` reads as black sticks (visual-audit V1).

## `speciesFor()` rules

The current function maps any "kastanie" to Aesculus, which is wrong for the Herzogskastanien (research/11 §3.3, G5).

| Text contains | Species |
|---|---|
| `edelkastanie`, `castanea`, `esskastanie` | `castanea` |
| `rosskastanie`, `aesculus`, `marronnier` | `aesculus` |
| `kastanie` alone | `aesculus`, with a `console.warn`: the catalogue must say which |
| `pappel`, `populus` | `populus_italica` |
| `malus`, `apfel` | `malus` |
| otherwise | `tilia` |

Add a test: `speciesFor('Castanea sativa (D: Esskastanien)').key === 'castanea'`.

## Forest composition and edge (S1, visual-audit §5.6)

- Beech is dominant on the Buchenberg (about 70 %), with oak (about 20 %) and hornbeam (about 10 %) [I from D place
  names]. Add *Pinus sylvestris* on the sandy ground near the Karlsbergweiher [N].
- **Edge (Waldmantel):** a noisy, irregular boundary (6–10 m noise), one band of 3–5 m shrubs, and about 20 % taller
  standards (Überhälter) near the edge [N]. That turns the carpet into landscape.
- Forest is not uniform: use 2–3 height classes and a few clearings. Keep 1789 forest only where research/11 §6.3 puts it.

## Landcover classes (S1) and ground colours (S15)

`scripts/prepare-terrain.py` `CLASSES` today: 0 meadow, 1 lawn, 2 gravel, 3 cobbles, 4 sand, 5 water, 6 forest, 7 building.
Proposed additions (research/11 S1): **8 field, 9 vineyard, 10 kitchen garden, 11 hay meadow** (0 stays the generic meadow).
Forest class 6 must come from 1789 `landcover` polygons in the catalogue, with today's CHM rule kept only for epoch 2025.
Update the `tag` string in `meta.json` (written by the script) so the viewer's attribution stays truthful.

`viewer/src/terrain.ts` packs the classes into a single RGBA weight texture (R lawn, G gravel/sand/cobbles/building, B
forest, A water, meadow = the rest), so there is no free channel. Use one of these:
- a second RGBA weight texture (field, vineyard, kitchen garden, hay), or
- a class-index texture with a per-class colour and texture lookup (sample with nearest filtering, and blend the edges
  in the shader with a few taps).

Starting colours (sRGB, before the texture multiply) [I unless tagged]:

| Surface | Colour | Note |
|---|---|---|
| Path gravel (Buntsandstein grit) | `#B79A84` | pinkish ochre, albedo 0.40–0.45 [N d'Argenville red sand; I local] |
| Parterre fine sand | `#D3BE8A` | yellow sand [N] |
| Court sand | `#C9B48E` | light, after Le Clerc [D LC] |
| Lawn | brighter and finer than the meadow | mown; Petri's lawn HG-01 only near the house and along the walks, the rest an aftermath meadow (wave 10: `viewer/src/lawnZones.ts`, grammar `PLEASURE_GROUND`) |
| Hay strips | alternate `#8FA060` and `#B9B07A` | cut and uncut bands along the contours |
| Field | `#C8B060` gold, with parcel-wise variation | July harvest; wave 11: Gewann strips along the contour (`landcover.ts` `fieldBlockDirs`) in a three-field rotation per block (rye / spelt / stubble, oats / barley, clover / weedy fallow / ploughed; `FIELD_ROTATION`, `fieldCropOf`), hues `GROUND_COLOURS` `spelt` / `oats` / `clover` / `plough` in `viewer/src/terrain.ts` |
| Vineyard | rows striped down-slope, 1.1 m apart, over soil | derive the stripe direction from the slope |
| Kitchen garden | dark soil with bed rows | beds 1.2–1.5 m, paths 0.5 m |
| Forest floor (under the instanced trees) | keep dark | already class 6 |

Add macro variation at 20–40 m (the splat already has `vnoise`), and distance desaturation through haze
(`skb-visual-wow`).
