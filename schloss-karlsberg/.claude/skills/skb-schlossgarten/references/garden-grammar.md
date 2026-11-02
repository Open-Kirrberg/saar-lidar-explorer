# Garden design grammar, 1780s (numbers for the model)

This is a condensed working copy of research/11 §4, research/02 §2.14 and the relevant S specs in research/11 §6.2. Those
files hold the full argument and the source links. Cite them, not this file, in catalogue tags. Every number here belongs in
`model/src/layout/grammar.ts`, in a new tagged `GARDEN` block (draft at the end). Consumers read the constants and never
hard-code them.

Units: 1 toise = 1.949 m, 1 pied du roi = 0.3248 m (`PIED_DU_ROI` in grammar.ts), and 1 Bavarian Fuß = 0.2919 m (Sckell).
The two main norms are A.-J. Dezallier d'Argenville, *La théorie et la pratique du jardinage* (1747 edn, Part I ch. V,
[archive.org](https://archive.org/details/latheorieetlapra00deza_0)), and F. L. von Sckell, *Beiträge zur bildenden
Gartenkunst* (2nd edn 1825, [archive.org](https://archive.org/details/beitragezurbilde00scke)).

## Which type goes where (the most important rule)

| Zone | Type in 1789 | Why |
|---|---|---|
| Behind the CdL (TF-09, the Herzogsgarten) | **English lawn garden**: open lawn, belt walk, clumps, single trees, benches, pavilions. Only a narrow gravel garden terrace at the door | [D] the Petri plan c. 1788 shows no parterre (Schneider: "Hinweise auf ein … Rasenparterre finden sich nicht"). research/10 b.7 allows a *small* parterre at the garden door [I]. A 6–8 m gravel terrace satisfies both |
| Orangerie court (TF-15), terrace garden S of the S wing (TF-08) | **Parterre à l'angloise** (gazon coupé): lawn panels, a flower plate-bande and a sanded sentier | [N] d'Argenville. It is the duchy's own Rasenparterre tradition (Jägersburg, Amalienlust) [D->]. Broderie is out of fashion and undocumented [I] |
| Courts (TF-01 to TF-03, TF-05) | Bare gravel or sand. Cobbles in the Küchenhof | [D] Le Clerc 1790: a bare, light forecourt. Catalogue surfaces |
| Roads, approaches | Two-row avenues | [D] Paradestraße "zweihüftige Allee" (Petri plan via Schneider) |
| Kitchen and forcing gardens | Beds, hotbed frames, S-facing greenhouses, espaliers on walls | [D] Petri plan, BSB 25r type [D->] |
| Karlslust | Picturesque episodes: cascade, ponds with boulder edges, follies, arboretum | [D] research/01 §2.3, research/11 §1.4 |

## Avenues (Alleen)

| Parameter | Value | Tag |
|---|---|---|
| Spacing in the row | 6–8 m (`AVENUE.spacing = 7`). Sckell: 20–30 Fuß (5.8–9.7 m) | [N] |
| Row distance (2 rows) | 12–16 m (`AVENUE.rowDistance = 14`). Sckell's side avenues are 40 Fuß (11.7–13.0 m) | [N] |
| Lombardy poplar spacing | 10–12 Fuß (2.9–3.9 m) | [N] Sckell |
| Width vs length (d'Argenville, single allée) | 195 m → 9.7–11.7 m; 390 m → 13.6–15.6 m; 585 m → 17.5–19.5 m; 780 m → 19.5–23.4 m | [N] |
| Double allée | Centre half, each contre-allée a quarter (e.g. 8 t = 4 + 2 + 2) | [N] |
| Tree height in 1789 | 5–8 m (`AVENUE.height1789 = 6`), clear stem 2–2.5 m | [D->] planted 1778–88 |
| Stakes | 1–2 per young tree (Baumpfähle), often a lath guard against deer. LOD0 near only | [N] |
| Jitter | ±0.3 m (`AVENUE.jitter`) | [N] |

The modelled avenues are TF-10 (2 rows, 7 m, 14 m), TF-11 (16 m apart) and TF-14 Apfelallee (8 m, 10 m). They are
consistent with Sckell. TF-11 (588 m) is narrow by d'Argenville's grand manner, which suits a modest, young German avenue [I].

## Hedges, clipped work, enclosures

| Element | Height | Thickness | Tag |
|---|---|---|---|
| Box edging (bordure de buis) | 0.15–0.25 m | 0.15–0.20 m | [N] |
| Banquette ("à hauteur d'appui") | 1.0–1.3 m | 0.5–0.7 m [I] | [N] |
| Palissade (hornbeam wall) | up to 5.8 m (arcade walls); arches of 4.9 m over an 8-pied clear stem | 0.6–1.0 m [I] | [N] |
| Yew cones in plates-bandes | 0.65–1.0 m, every 3.9 m (12 pieds), with a flowering shrub between | — | [N] |
| Charmille / bosquet hedges (other zones) | 2–4 m | — | [N] research/02 §2.14 |
| Treillage (green lattice) | 1.8–2.5 m, arched portals 2.8–3.5 m, laths 25–40 mm, mesh 150–200 mm | — | [D] presence (Le Clerc via Schneider fn 27, HMS); dims [I] |
| Iron hoop fence (Bogenzaun) | low, with arched trellises | — | [HMS] research/06 §3.7 |
| Tiergarten / Fasanerie wall | 2.5 m rendered rubble with coping | 0.5–0.6 m | [D->] Tschifflik |
| Terrace retaining wall | 1.5–4 m Buntsandstein, batter 1:10, coping 0.3 m, balustrade or hedge on top | — | [N] research/02 §2.14 |

**Why the current hedges fail:** `features.ts` draws 0.45 × 0.44 m boxes in 3 m segments. That is no period type (too
tall for box edging, too low for a banquette), so they read as kerbs (G3, visual-audit V5). Pick a type from the table.
Give clipped geometry a 0.05 m top bevel, a darker foot and a leaf-noise normal (visual-audit §5.6 item 6).

## Parterre à l'angloise (module)

d'Argenville: "grands tapis de gazon … entourés d'une plate-bande de fleurs, avec un sentier ratissé de deux ou trois pieds
… que l'on sable" [N].

| Part | Value | Tag |
|---|---|---|
| Lawn panel | 8–20 m long, ratio 1:1.5 to 1:3, corners cut or rounded | [N] |
| Sanded sentier (between lawn and plate-bande) | 0.65–1.0 m | [N] |
| Plate-bande | 1.0–2.0 m, raised 0.1–0.2 m, box-edged, flowers plus yew/box cones every 3.9 m, standard roses between | [N] |
| Cross walks | 2.5–5 m (9.7 m only for a grand parterre) | [N] |
| Surface colours | sentiers red-sanded, parterre ground yellow sand, the rest river sand; locally pinkish-ochre Buntsandstein grit | [N] d'Argenville; [I] local |
| Orangerie tubs | rows on the walk edges every 5 m; tub 0.8 × 0.8 × 0.75 m, oak painted green with dark iron corner bands; citrus clear stem 1.2 m, crown D 1.4–1.8 m; outside May–October | [N]/[I]; [D] tubs research/01 row 17 |
| TF-08 extras | perimeter treillage 2.2 m with an arched portal of 3.2 m; centre walk 3 m to the S-wing portal; roses, sunflowers, hollyhocks | [D LC, HMS]; dims [N/I] |

A pure `parterreAnglaise(polygon, axis)` in `layout/site.ts` should return panels, sentiers, plates-bandes and cone points
in palace-grid (u, v). Test it (research/11 §6.5). The existing parterre code already shows how to work in (u, v) and clip
to the polygon (`features.ts`, case `'parterre'`).

## Paths in the landscape parts (Sckell)

| Path | Width | Tag |
|---|---|---|
| Drive (Fahrweg) | 4.4–7.8 m (15/20/24 Fuß) | [N] |
| Walk (Spaziergang) | 2.3–3.9 m (8/10/12 Fuß). The Herzogsgarten belt walk is 3.0 m | [N] |
| Footpath | 0.9–1.6 m (3–5 Schuh) | [N] |
| Curvature | long continuous arcs (1000–3000 Fuß) before reversing; S-waves only on footpaths. Serpentines on slopes have a radius of 15–25 m [I] | [N] |
| Camber | about 3 Zoll at the centre of a 10 Fuß walk | [N] |
| Edges | turf straight to the gravel, no plant edging on long walks | [N] |

A pure `walkRibbon(line, width)` should return a non-self-intersecting ribbon, so a path can be a splat class (2 m
ground cells are too coarse for a 1 m footpath: draw footpaths as thin draped meshes or a finer mask instead).

## Water

| Element | Spec | Tag |
|---|---|---|
| Formal basin coping | Buntsandstein kerb 0.3–0.45 m wide, top 0.15–0.3 m above water, vertical inner face; round or quatrefoil | [N]; stone [D->] |
| Stag basin (S3) | round, D ≈ 14 m, coping 0.4 × 0.25 m `stone.grey`, single jet ≈ 5 m, two stag heads on the rim facing the CdL | presence and axial siting [D]; size [N/U]; distance [I] |
| Fountain jet | single, 3–8 m (gravity head from the Lambsborn / Großes Bassin) | [N]; presence [D] (stag basin, Schwanenweiher) |
| Landscape pond edge | 1.5–3 m grass bank on the gentle side; Findlinge 0.6–1.4 m on the dams and the tumulus | [D] Schwanenweiher (de.wikipedia) |
| Canal (Amalienlust type) | straight, walks on both sides, a round basin at the crossing | [D->] |
| Cascade | Große Kaskade: 10 steps × 1.5 m, 310.5 → 271.6 m over 150 m, 8–12 m wide | [D] research/02 §2.14, research/03 §4.5 |
| Stables basin | at the end of the Lambsborn aqueduct (PV S), rectangular ≈ 12 × 8 m | presence [D]; size [U] |

A jet is a tapered translucent cone or a few crossed alpha cards at LOD1. Its animation is viewer-side. Water material is
`water` (`ctx.materials.get('water')`). Reflections are `skb-visual-wow` work (visual-audit P15).

## Sculpture, benches, aviaries

| Item | Spec | Tag |
|---|---|---|
| Benches | green paint ≈ `#3F5A3A`, 2.0 × 0.55 m, back 0.9 m; 12–20 along the belt walk, at view ends and clump fronts; on slopes on a 3 × 2 m levelled platform | colour and count (52 in the Orangerie cellar) [D]; form [N] |
| Sculpture | sandstone, lime-washed or stone-coloured, on 1.0–1.4 m pedestals; Bacchus group, Flora herm (yellowish sandstone, 40.5 cm, HMP Speyer, research/10 O1) | [D]/[N] |
| Aviaries | wire-mesh pavilions 2–4 m on the lawn behind the palace | presence [D]; form [N] |

## Draft `GARDEN` block for `layout/grammar.ts`

This is a proposal. Check every value against the tables above when you add it, and keep the tag comments.

```ts
export const GARDEN = {
  boxEdging: { height: 0.2, thickness: 0.18 },          // [N] d'Argenville 0.15-0.25 m
  banquette: { height: 1.1, thickness: 0.6 },           // [N] 1.0-1.3 m; thickness [I]
  palissade: { maxHeight: 5.8, thickness: 0.8 },        // [N] 18 pieds; thickness [I]
  yewCone: { height: 0.9, spacing: 3.9 },               // [N] 2-3 pieds, 12 pieds apart
  parterre: { sentier: 0.8, plateBande: 1.3, plateBandeRaise: 0.15, crossWalk: 3.0, panelMin: 8, panelMax: 20 }, // [N]
  treillage: { height: 2.2, portalHeight: 3.2 },        // [D presence LC/HMS; dims I]
  path: { drive: [4.4, 7.8], walk: [2.3, 3.9], footpath: [0.9, 1.6], beltWalk: 3.0 }, // [N] Sckell 1825
  basin: { copingWidth: 0.4, copingHeight: 0.25, jet: 5 }, // [N]; jet height [U]
  bench: { length: 2.0, depth: 0.55, back: 0.9, colour: '#3F5A3A' }, // colour [D], form [N]
  tub: { size: 0.8, height: 0.75, spacing: 5, citrusStem: 1.2, citrusCrown: 1.6 }, // [N/I]
  vineyard: { rowDistance: 1.1, stakeHeight: 1.6, stakeSpacing: 1.0 }, // [N/I]
  poplarSpacing: 3.4,                                   // [N] Sckell 10-12 Fuß
} as const;
```
