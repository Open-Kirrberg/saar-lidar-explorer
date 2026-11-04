# 05 — Synthesis: reconciled site layout and building catalogue (draft v1)

> Date: 2026-11-01. This document reconciles the four research reports. It is the evidence-annotated companion of the
> machine-readable spec **[`../model/catalogue.json`](../model/catalogue.json)**. The 3D generator and the plan drawings
> are built from that spec.
> - Inputs: [01 history & sources](01-history-and-sources.md), [02 comparables & design grammar](02-comparable-palaces-design-grammar.md),
>   [03 LiDAR site analysis](03-lidar-site-analysis.md) with [`lidar_features.geojson`](lidar_features.geojson), and
>   [04 video & Video2World](04-video-and-video2world.md).
> - I also inspected the HMS reference frames that another session extracted into the git-ignored
>   `../video2world/frames/` folder.
> - Two local checks were added: today's LoD2 building at the Karlsberger Hof, and DTM statistics under every footprint.
>
> **Tags** (as in 01–04):
> - **[D]** documented (source named)
> - **[D→]** derived arithmetically
> - **[I]** inferred (reasoning given)
> - **[N]** period norm (02 §2)
> - **[U]** unknown
> - **[HMS]** read from the 2022 Historisches Museum Saar / Matzerath reconstruction (video kfnE6HdXmVo). This is a
>   *secondary, copyrighted* interpretation that Jutta Schwan supervised. We use it only to identify buildings and to
>   check massing; its geometry and textures are never copied (04 §5).
>
> Images made for this synthesis, from our own LiDAR plus the catalogue only (no HMS content):
> [`img/21_synthesis_core.jpg`](img/21_synthesis_core.jpg) (palace core) and
> [`img/22_synthesis_site.jpg`](img/22_synthesis_site.jpg) (whole residence).

---

## 0. Result in one paragraph

**The LiDAR foundations, the documented building timetable and the HMS layout tell one consistent story.**
- **The Ehrenhof.** It is a three-wing cour d'honneur, **64 × 41 m clear**, and **opens to the west** onto the
  straight N–S road along the plateau brow. The **Corps de logis closes it on the east**. Its centre line continues
  as the 588 m east avenue KB-12.
- **The Küchenhof.** North of the north arm lies a second court, closed by four buildings:
  - the **Sammlungsflügel** on the west (= the documented "west wing from 1782" and the "collection wing to the north");
  - the detached **Küchenbau** on the east;
  - the north arm on the south;
  - a one-storey **gallery** on the north, along the KB-07 scarp.
- **Size.** Together the two courts make the 82 × 135 m foundation field seen in the DTM.
- **The utility town.** Marstall, Reithaus, Hundezwinger, Kasernen, Lazarett and Brauerei stood **north** along the
  N–S road (the north terrace KB-20 and the 1836 "Forsthaus" platforms). The **Orangerie** stood **south**, on its
  standing 5.5 m basement wall. The **Apfelallee** (KB-14) ran SSE from there to the **Karlslust**.
- **Confidence.**
  - High: the positions of the wings, the Orangerie and the Karlslust features.
  - Medium: the elevations (storeys, roofs).
  - Low: everything north of the palace and all interiors.

---

## (a) Reconciled site layout — documented building ↔ LiDAR feature

### a.1 Palace core (`img/21_synthesis_core.jpg`)

**How the identification works.**
1. The HMS aerial shots show a U-shaped Ehrenhof whose open side faces the camera in the west-looking shots.
   - Its south arm is the one nearest the Orangerie.
   - A second court with a detached block captioned "KÜCHENBAU" lies north of the north arm.
   - The Orangerie ruin (KB-30) is a fixed, standing anchor south of the palace, so HMS south = LiDAR south.
   - In the golden-hour shots the shadows fall towards the camera, so the sun is behind the palace. A west-looking
     view into an evening sun is consistent with a court open to the west.
2. Laid over the DTM with the court on the KB-02/KB-03 gap, every major HMS block falls on a LiDAR foundation, and the
   court sizes agree within about 20 % (rough oblique-image scaling).

| Catalogue id | Documented building | LiDAR | Match confidence | Reasoning |
|---|---|---|---|---|
| KB-B02 | **South wing** (Südflügel, 1780–85) [D date]; HMS caption "herzoglicher Wohnflügel mit Speisesälen und Silberkammer" probably refers to this arm [HMS, I] | **KB-02**: 64 × 17 m, vaulted cellars 2 m below court | **high** (position), med (function) | Strongest wall traces. Its outer face overlooks the terrace garden that HMS shows on the south side. Cellars fit a Silberkammer or stores. *Alternative:* the cellar is the "Keller des Kavaliersgebäudes" ("Räuberhöhle", Commons) |
| KB-B03 | **North wing** (from 1779) [D] | **KB-03** (78 × 20 m robbed-wall band) + **KB-04** | **high** | Parallel to KB-02 at a 41 m clear distance. The east 16 m belong to the CdL corner |
| KB-B01 | **Corps de logis** = refurbished **Louisenhof** manor (7 × 4 axes, 2 storeys) [D hib] + mansard [D enwp] | East ends of KB-02/03, KB-04, and the N–S wall traces at E 382255–382275 | **med** | (1) It closes the court on the east. (2) The court's clear width of 40.9 m = 7 axes of 4.1–4.4 m plus two corner bays, which matches the 7-axis Louisenhof core [D→]. (3) The KB-12 axis passes through its centre. (4) HMS shows a 7-axis raised centre with a Dachreiter |
| KB-B04 | **West wing** (from 1782) [D] = **Sammlungsflügel** (Bibliothek, Naturalienkabinett, Waffensammlung) [HMS] = "collection wing extending the palace to the north" [D BuS 2012 snippet] | **KB-05** (50 × 13 m, rooms) | **med** | Three names, one building. It is the westernmost N–S range and lies north of the north arm. Snapped from LiDAR 174° to the palace grid 170.5° [I] |
| KB-B05 | **Küchenbau** (1779/80–84) [D date] | **KB-06** (28 × 13 m closed rectangle) | **med** | The HMS caption points at a detached block in exactly this spot. A detached kitchen is a period habit (Wörlitz [D]) |
| KB-B06 | **Galerieflügel / Bildergalerie** (1788) [D date] | **KB-07** north scarp (robbed back wall?) | **low** | HMS shows a one-storey range closing the Küchenhof on the north, captioned "Bildergalerie mit anschließender Rotunde". BuS 2012 places the gallery north of the palace [D]. Length [U] |
| KB-B07 | Rotunda at the gallery's end [HMS only] | none (upper plateau) | **low** | Conflicts with the documented Orangerie rotunda; see a.3 |
| — | Today's "almost square clearing = Ehrenhof" [D brochure] | CHM clearing ≈ 382190–382240 / 5466120–5466150 | high | This is the forest gap *inside* our 64 × 41 m court. The brochure's "a few metres from the Orangerie" is in fact about 150 m [I] |

### a.2 North: the utility "town on the hill" (low confidence)

| Catalogue id | Documented | LiDAR / map | Confidence | Reasoning |
|---|---|---|---|---|
| TF-10 | **Paradestraße** "along the palace front" [D Commons caption] | **KB-10/KB-11** N–S hollow way + avenue (717 m, az 0–1.7° grid) | **med** | It runs 20 m in front of the open (west) court mouth, the documented "front". HMS shows a tree-lined avenue W of the palace leading N to the utility row |
| KB-B20/21/22 | **Marstall** 1778–85 with **Reithaus** [D]; HMS group "Marstall mit Reithaus und Hundezwinger" in the northern utility row | **KB-20** north terrace (90 × 190 m at 344.1 m, cut 3–4.4 m) | **low** | It is the only large artificial platform on the row. A riding hall and stable court need flat ground. The plan is pure hypothesis: two 170 m ranges with a 54 × 18 m Reithaus between them |
| KB-B23 | **Hundezwinger** 1780–83 (?) [D, ambiguous "Zwinger"] | none | low | HMS shows a walled square with a central house in the row. Placed N of KB-20 |
| KB-B24 | **Jägerhaus / Jägermeisterei** 1780–84 → **Kaserne** 1791 [D] | **KB-52** platforms under the red masonry marks of the 1836–41 "Forsthaus" group (map corrected −50 m E) | low–med | Service buildings largely survived 1793 [D enwp]. Hunt administration → forester's house is a natural continuity [I] |
| KB-B25/26 | **Lazarett**, **Brauerei** (1778–82) [D date; HMS caption "Lazarett, Kasernen und Brauerei"] | along KB-11 | low | Order along the road [U] |
| KB-B27 | **Hofgärtnerei / Dutch garden & greenhouses** 1779–83 [D]; HMS "Treibhäuser des Hofgärtners Ludwig Reichard" | **KB-23** upper block 139 × 83 m at 347.6 m | low | HMS shows a walled garden NE of the Küchenhof, with greenhouses on its far side |
| KB-B28 | **Eiskeller** [D OSM] | **KB-50** collapsed pit D 10 m | high | — |
| TF-41 | Forsthaus well [D OSM] | KB-51 | med | Post-1793 |

**The "1,250 m frontage" [D enwp]** is consistent with this linear N–S arrangement [I]: Orangerie S end (N 5465925) →
palace → utility row → KB-11 N end (N 5466848) ≈ 0.93 km. The rest may be the Karlsberger Hof approach or simply
rounding.

### a.3 South: Orangerie (`img/14_orangerie_features.jpg`)

| Catalogue id | Documented | LiDAR | Confidence | Reasoning |
|---|---|---|---|---|
| KB-B10 + KB-B14 | **Orangerie** (Schweizerei converted 1780). Documented features [D skb]: three wings, "hohes Kellergeschoss", Pfeilersaal, floor-length windows, "hell verputzt" | **KB-30/31**: 81 m wall, 5.3–5.6 m drop; building 84 × 8–10 m | **high** (main wing) | **The documented high basement *is* the LiDAR step.** The hall floor is on the parterre (340.8 m); the basement storey is exposed only towards the west bench (335.1 m) |
| KB-B11/B12 | The two other wings [D "three-winged"]; Komödienhaus / theatre 1783 [D], location in the complex [U] | SLRM rectangle turning E at the S end; curved structure at the N end | low | Wings run east, framing the parterre KB-33 |
| KB-B13 | **Rotunde / Rundbau an der Orangerie** (1785; plan, section and elevations in Weber) [D Weber ToC; brochure "Orangerie Rotunde"] | **KB-34**: two concentric rings, D 28/34 m, touching the hall's east face (gap ≈ 3 m) | low–med | Position "attached" fits. 03 also allows a basin or a modern feature. **Conflict with HMS**, which places a rotunda at the gallery's end. Resolution: the documented one wins. B07 stays as an optional toggle |
| TF-14 | **Apfelallee** to the Karlslust [D Commons] | **KB-14**: 624 m, az 150.8° grid, from the Orangerie parterre's NE corner | med | It is the only straight feature heading to the Karlslust |

### a.4 Valley entrance

| Catalogue id | Documented | Evidence | Confidence |
|---|---|---|---|
| KB-B29 | **Baumagazin = today's Karlsberger Hof**: the only surviving building, altered (shorter, roof changed, one end raised by a storey) [D dewp/skb] | **LoD2 buildings DESLT9866A103F47 + A104DD3**: 40 × 11 m, az ≈ 162°, 13.4 m / 9.6 m high (= one raised end), 15–40 m from the Commons photo GPS, at the end of the street "Karlsberger Hof" | **med–high** (identity), low (1793 form) |
| KB-B30 | "Carlsbergerhof" label on the 1836–41 map [D 03] | KB-60 envelope of today's building group | low. Possibly the Wirtshaus or the farm at the "main entrance in the valley" [D enwp]. A placeholder envelope only |

### a.5 Karlslust (`img/15_karlslust_features.jpg`)

| Catalogue id | Documented | LiDAR | Confidence |
|---|---|---|---|
| TF-30/31 | **Große Kaskade**: 10 steps × 1.5 m, step area 10 × 10–15 m, ending in the plunge basin [D dewp] | **KL-03** stepped channel on axis E 382815 → **KL-04** Tosbecken (271.7 m) | med (identity); **height conflict**, see (b) |
| TF-32–34 | **Schwanenweiher** (3 ponds; restored from 2007) [D] | **KL-05/06/07** (270.1 / 266.8 / 268.3 m) | high |
| KL-B40/41, TF-37 | **Menagerie "Bärenzwinger"**: ring of 19 half-round cages plus a loge; moat; square island with a pavilion [D dewp/skb] | **KL-01**: round moat D ≈ 44 m around a ~10 m square | high (position); the cage ring is not obvious in the DTM, but standing ring walls are photographed (Commons) |
| KL-B43, TF-38 | **Herzogsterrassen with iron "Bären-Kästen"** 1786, "near the Bärenzwinger, above the Schwanenweiher" [D urlaub.saarland] | **KL-02** terraced parallelogram, 7–9 cross-banks with ~1 m steps | med (place matches the text) |
| KL-B42 | **Tschifflik pavilion** 1779–80 ("Turkish", the largest of four pavilions) [D] | **KL-10** mound D 20 m with a cellar pit (OSM ruin "Tschifflik") | low. Per the 1950s excavation, the ruin called "Tschifflik"/"Kapelle" is a *different* building "on a terrace opposite the cascade" [D dewp]. Alternative site: **KL-09 rondell** (287.5 m, exactly opposite the cascade on its axis) [I] |
| KL-B45 | Tumulus with sham ruin and shell niche at the end of the Schwanenweiher [D dewp] | mound E of KL-06 | low |
| KL-B44 | Eremitage (OSM name only) | KL-12 ring mound | low |
| TF-35/36 | — | **KL-08** stepped double-lined axis S of the Tosbecken → **KL-09** rondell | med (geometry), function [U] |

### a.6 Contradictions and how this draft resolves them

| # | Contradiction | Resolution in catalogue v1 |
|---|---|---|
| C1 | "Only the Corps de logis had a mansard" [D enwp, after Schneider 1988] vs HMS 2022: mansards on all three Ehrenhof wings, the Sammlungsflügel and the Küchenbau | **Mansard on the whole Ehrenhof + Küchenhof group** (HMS is newer and Schwan-supervised; "Corps de logis buildings" can mean the main complex). The **gable alternative is kept** in `alternatives` and must be a generator switch. Utility buildings: hip/mansard in red tile [HMS], gable for farm buildings [N] |
| C2 | Rotunde "an der Orangerie" 1785 [D] vs HMS "Bildergalerie mit anschließender Rotunde" (NE) | Documented position wins: **KB-B13 on KB-34**. The HMS rotunda is KB-B07, low, toggle |
| C3 | Cascade 10 × 1.5 m = 15 m of drop [D] vs LiDAR 26 m (KL-03 polyline) to 39 m (P5 profile top → Tosbecken) | Keep the **10 masonry steps with 1.5 m falls [D]**. The rest of the drop is taken by sloping basin floors and the upper "Großes Bassin"/"Startbassin" [D Commons titles] on the DTM. Verify with the 1780s views |
| C4 | Tschifflik ruin identity (OSM/tradition vs 1950s excavation) | Pavilion modelled at KL-10 (low). KL-09 recorded as the alternative |
| C5 | "North wing 1779–1794" [enwp] | Typo. The north wing is pre-1793 (1779–c.1784) |
| C6 | "Zwinger 1780–83" = kennel [enwp] or bear enclosure [hib] | Both exist as separate entries: Hundezwinger (KB-B23) and menagerie (KL-B40) |
| C7 | Baumagazin vs Karlsberger Hof | Same building. Located on the LoD2 footprint (a.4). The 1836 "Carlsbergerhof" farm group KB-60 is a different, neighbouring group |
| C8 | "42 m staircase" [enwp] | Unit confusion is likely: **42 Pariser Fuß = 13.6 m** stair hall [I]. The catalogue uses a 13.6 m Treppenhaus. A 42 m stair would exceed the CdL depth and nearly half its length |
| C9 | KB-05 at 174° vs palace grid 170.5° | Snapped to the grid (the LiDAR value is a minimum-rectangle fit around diffuse trenches) [I] |
| C10 | Ehrenhof "almost square clearing" vs a 64 × 41 m court | Today's clearing is only the open part of the former court [I] |
| C11 | "Stable for 1000 horses" | Legend level: 1000 stalls ≈ 850 m of double-row stable [D→]. The model uses ~2 × 100 stalls [I] |
| C12 | Schwanenweiher 3 water level (268.3 m) above pond 2 (266.8 m) though downstream | Flagged. Probably a DTM water-surface artefact or a mislabel; check the ortho |
| C13 | 1836–41 map +50 m E offset | Use maps only for identification, never coordinates (03 §3) |

---

## (b) Axis, orientation and design levels

**Palace grid** (all Ehrenhof and Küchenhof buildings): long walls at **az 80.5° grid = 79.3° true**, cross walls at
170.5° [D LiDAR]. The catalogue defines a local frame: **u** along the axis and **v** towards N.
- Origin: **E 382226.0 / N 5466120.0** (Ehrenhof centre on the axis).
- Coordinates: `E = 382226 + 0.98629·u − 0.16505·v`, `N = 5466120 + 0.16505·u + 0.98629·v`.

Footprints in the palace frame:

| Element | u (m) | v (m) |
|---|---|---|
| Ehrenhof clear | −36.0 … 28.2 | −20.3 … 20.6 |
| Corps de logis | 28.2 … 46.2 | −37.3 … 40.6 |
| South arm | −36.0 … 28.2 | −37.3 … −20.3 |
| North arm | −33.9 … 28.2 | 20.6 … 40.6 |
| Sammlungsflügel | −33.9 … −20.9 | 40.6 … 98.0 |
| Küchenbau | 20.8 … 33.9 | 58.4 … 86.5 |
| Gallery | −20.9 … 41.0 | 87.0 … 98.5 |

**Orientation of the main front.**
- The cour d'honneur opens **west**, onto the Paradestraße and the brow of the plateau facing the valley. This answers
  03 Q2 [I, med; HMS + no west closing wall in the DTM].
- The **garden side of the CdL faces east** to the KB-12 avenue (az 80.0°, on the court centre line within 1° over
  588 m [D]).
- A second alignment family (N–S within 5°) governs the Paradestraße, the north terrace and the Karlslust cascade axis
  [D]. **[I]** It may be older (Louisenhof roads) or simply follow the plateau edge.

**Design levels (DHHN2016)** [D LiDAR profiles; use as `base_h`]:

| Level | m | Used for |
|---|---|---|
| Plateau E of palace (natural) | 352–353 | garden beyond the CdL |
| Upper block KB-23 | 347.6 | walled garden, gallery rotunda |
| **Ehrenhof / Küchenhof / palace terrace** | **344.8** | all palace wings (floor = 344.8 + plinth) |
| Cellar floor (KB-02) | 342.4 | S-arm cellars |
| **North terrace KB-20** | **344.1** | Marstall / Reithaus |
| **Orangerie parterre** | **340.8** | Orangerie hall floor, side wings, rotunda |
| **Orangerie lower bench** | **335.2** | foot of the basement storey (W) |
| Karlsbergweiher water | 276.2 | pond |
| Cascade top → Tosbecken | 310.5 → 271.7 | cascade |
| Schwanenweiher 1/2/3 | 270.1 / 266.8 / 268.3 | ponds |
| Karlslust rondell | 287.5 | rondell / pavilion alternative |
| Baumagazin ground | 256.3 | valley |

**Resulting heights** (catalogue, inferred from [N] storeys, checked against the HMS massing; see the CdL storey row in
(d)):

| Building | Eaves (m) | Ridge (m) |
|---|---|---|
| Ehrenhof wings | 355.0 | 360.8–363.9 |
| Corps de logis | 356.4 | ≈ 364.4 |
| Orangerie | 347.8 (12.5 m above the lower bench, 7 m above the parterre) | — |

**Explorer AOI:** the Karlslust lies **south of N 5465000**, outside the `karlsberg` AOI. Its DTM exists only in the
03 scratch mosaic. Extending the AOI to N ≈ 5464550 is a pipeline task for the other session.

---

## (c) Modelling priority

| Prio | Ids | Why |
|---|---|---|
| 1 | KB-B01 Corps de logis, TF-01/03 Ehrenhof & terrace | Centre of "discover the castle"; the walk-in interior lives here |
| 2 | KB-B02 south wing, KB-B03 north wing, KB-B10 + KB-B14 Orangerie main wing + wall, TF-10/11 avenues | High-confidence footprints; define the silhouette |
| 3 | KB-B04 Sammlungsflügel, KB-B05 Küchenbau, KB-B06 gallery, KB-B29 Baumagazin, KL-B40 menagerie ring, TF-30–34 cascade + ponds | Med confidence; complete the core and the Karlslust highlights |
| 4 | KB-B11/12/13 Orangerie wings + rotunda, KB-B20/22 Marstall W + Reithaus, KB-B24 Jägerhaus/Kaserne, KL-B42 Tschifflik, TF-14 Apfelallee | Low confidence, but needed for the "town on the hill" impression |
| 5 | KB-B21, B23, B25, B26, B27, B28, KL-B41, KL-B43 | Hypothetical fillers. Render with a "Hypothese" style toggle |
| 6 | KB-B07, KB-B30, KL-B44, KL-B45 | Optional toggles |
| 9 | UP-01 … UP-18 (unplaced) | Documented but unlocated. **No geometry** until a plan locates them |

---

## (d) Reconstruction parameters per building (what is documented vs. borrowed)

Template classes and default values come from 02 §2. Only deviations and their evidence are listed here. The full
numbers are in the catalogue.

**Global defaults.**
- Continuous cornice and eaves line across the palace group [D enwp K1].
- Lightning rods on all buildings [D skb] (HMS caption: "Hemmer'sche Fünfspitzen").
- Lime render `#ECE8DF`: Orangerie "hell verputzt" [D]; whitish-grey borrowed from Koblenz 1777–86 [D→]; HMS white-grey.
- Members light grey or yellow-grey sandstone `#BDBAB2`/`#C8B38C` [D→ Koblenz, N].
- Plinths red Buntsandstein [I geology/ruins].
- Louvred shutters on wings: Wilhelmshöhe [D→]; HMS shows grey-blue / pale grey.
- Axis module 4.1–4.4 m on the CdL: Saarbrücken 65.45 m / 15 axes [D→]. 3.65–3.9 m on the wings [N].
- Unit: Pariser Fuß 0.3248 m [N].

| Id | Footprint (m) | Storeys (m) | Roof | Facade | Documented | Borrowed / inferred |
|---|---|---|---|---|---|---|
| **KB-B01 CdL** | 78 × 18 | Sockel 1.2 · EG 4.8 · Beletage 5.6 (+ mansard attic) | Mansard 70°/30°, slate; 7-axis centre as a higher hipped mansard with Dachreiter | 19 axes garden side (6 + 7 + 6) at 4.1 m; 9 axes court side; Freitreppe; portes-fenêtres in the centre risalit | Louisenhof core 7 × 4 axes, 2 storeys [D hib]; mansard [D enwp]; state rooms upstairs [D]; refurbishment 1778–82 [D] | Depth 18 m (Saarbrücken 18.26 [D→]); storey heights [N]; slate (Benrath [D]; HMS); Dachreiter, Freitreppe and sentry boxes [HMS]; no portico (Karlsberg "plain" [D enwp]; giant order [U]) |
| **KB-B02 S arm** | 64 × 17 | Sockel 1.2 · EG 4.4 · OG 4.6 | Mansard, slate (alternative: gable 45°) | 17 axes at 3.75 m; central round-arched Durchfahrt with rusticated surround | Dates [D]; footprint + cellars [D LiDAR] | Function "Wohnflügel, Speisesäle, Silberkammer", Durchfahrt and mansard [HMS]; heights [N] |
| **KB-B03 N arm** | 62 (+16 in CdL) × 20 | as B02 | as B02 | 17 axes at 3.65 m; Durchfahrt to the Küchenhof [HMS] | Date [D]; footprint [D LiDAR] | Depth may be 16 m inside the 20 m band [I] |
| **KB-B04 Sammlungsflügel** | 57 × 13 | as B02 | Mansard [HMS] | 15 axes at 3.8 m; west gate | Collections [D Weber ToC: library, Naturalien-, physikal. Kabinett, arms]; "west wing 1782" [D] | Room use per floor [I]; Benrath-type finishes [D→] |
| **KB-B05 Küchenbau** | 28 × 13 | Sockel 0.8 · EG 5.0 (vaulted) · OG 4.0 | Mansard [HMS]; 2–3 large stacks [N] | 7 axes | Date [D]; footprint [D LiDAR] | Detached kitchen (Wörlitz [D]) |
| **KB-B06 Galerie** | 62 × 11.5 | Sockel 0.6 · Saal 6.5 | Low hip 35°, slate | 16 tall windows on the court (S) side, closed N wall | 1788; long [D anecdote] | One storey [HMS]; side-lit gallery 6–9 m wide [N] |
| **KB-B10 Orangerie** | 84 × 10 | Kellergeschoss 5.5 (W only) · Saal 7.0 | Hip 40°, slate [U]; Dachreiter [HMS] | 21 axes at 3.9 m; floor-length windows; red sandstone dressings | Three wings, high basement, Pfeilersaal, floor-length windows, light render [D skb]; basement height [D LiDAR] | Hall height [N]; richer than the palace ("stylistic difference", Weber ToC) [I] |
| KB-B11/12 Orangerie wings | 30 × 12 | Sockel 0.6 · Saal 7.0 | Hip 40° | 7 axes | "three-winged" [D] | Length [I] |
| KB-B13 Rotunde | D 28 | Sockel 0.5 · Rundsaal 9.0 | Flat dome + lantern | 16 bays | Rotunda 1785 [D]; Weber has plan/section/elevations [D, not seen] | Everything else [I/N] |
| KB-B20–22 Marstall, Reithaus | 2 × 170 × 12; 54 × 18 | Stall 4.5 + Kniestock 1.2; hall 9.5 | Red-tile mansard / hip 38° | 45 axes at 3.6 m, high stall windows | Marstall 1778–85, Reithaus [D]; ramp survives [D Commons] | All geometry [N/I]; Vienna 55 × 18 m as the upper bound [D] |
| KB-B24–26 Jägerhaus, Lazarett, Brauerei | 100 × 14; 40 × 14 | EG 3.6 · OG 3.4 | Red tile | rustic render | Functions + dates [D]; red roofs [HMS] | Positions [I] |
| **KB-B29 Baumagazin** | 40 × 11 (today) | EG 3.6 · OG 3.2 | Gable 48°, tile | 12 axes | Survives; altered [D] | 1793 length and roof [U]: "longer, lower, other roof" [D dewp] → optional extension |
| **KL-B40 Menagerie** | ring r 22–27 around the moat | Cage walls 3.0 | Iron grilles / net domes | 19 half-round cages + loge | Count + arrangement [D] | Radii [I from LiDAR]; Schwetzingen aviaries [D→] |
| KL-B42 Tschifflik | 14 × 14 | Cellar 1.0 · Saal 6.0 | Oriental dome/tent [U] | Turkish arcades | "Turkish style", largest of four pavilions [D] | Schwetzingen Moschee 1778–85 [D→] |

---

## (e) Grundriss hypothesis — main palace

Everything below is **[I]** unless tagged. Room sizes follow 02 §2.11 [N]. Floor levels:
- EG floor: **346.0 m** (court 344.8 + 1.2 m Sockel, 5–7 steps).
- Beletage floor: **350.8 m**.
- Mansard floor: **356.4 m**.

### e.1 Corps de logis (78 × 18 m, double-pile)

**Structure.**
- Spine wall at about 7.5 m from the court face.
- Court pile: corridor, garderobes and service stairs, ≈ 6 m clear.
- Garden pile: enfilade, ≈ 9 m clear.
- The 7-axis centre (≈ 29 m, v −14.6 … +14.6) is the **Louisenhof core** [D 7 × 4 axes, 2 storeys].
- The 6-axis side parts (≈ 24 m each) are additions of 1778–82 [I].
- The axis passage on v = 0 links the Ehrenhof with the east avenue KB-12.

**Souterrain / cellars.** Vaulted Buntsandstein cellars under the CdL and the arms. The cellars in KB-02 are documented
in the LiDAR (floor 342.4).

**Erdgeschoss (rez-de-chaussée).**

| Zone (v, m) | Court side (W) | Garden side (E) |
|---|---|---|
| −6 … +6 (3 axes) | **Vestibül** 12 × 16.5 m, four pairs of columns, flags of red and grey sandstone | (through-going) garden vestibule / Gartensaal door |
| +6 … +20 | **Prunktreppe**: stair hall 13.6 × 16 m (= "42 [Fuß]" [C8]), imperial stair (one flight splitting into two), R 14 / T 38 cm | (stair hall takes full depth) |
| −6 … −20 | Antichambre, garderobes | **Duke's private apartment** [D: room-guide pages list "Schlafzimmer + Schreibkabinett" and "Gelber Salon + Schreibkabinett" on the EG]: Gelber Salon 9 × 9 m, Schlafzimmer 8 × 9 m, Schreibkabinett 4.5 × 5 m |
| −20 … −37 (S corner) | Service stair; link to the S arm (Speisesäle) | Second cabinet / Bibliothek particulière [U] |
| +20 … +40 (N corner) | Service stair; link to the N arm | Duchess's or guest apartment [U] (room guide lists Herzog and Herzogin apartments [D, snippet]) |

**Beletage (state floor)** [D: state rooms upstairs; Paradeschlafzimmer with a lit à la romaine; Tempelzimmer and
Wintergarten named in Weber's ToC, locations U].

| Zone | Court side | Garden side |
|---|---|---|
| Centre (3 axes) | **Garde-/Vorsaal** 12 × 7 m above the vestibule | **Salon / Festsaal** 12 × 9 m with 3 portes-fenêtres to a balcony. Optionally double-height into the mansard, 8–9 m (Benrath type [D→]) |
| South enfilade | Corridor, garderobes, jib doors | **Antichambre** 8 × 9 → **Audienzzimmer** 8 × 9 → **Paradeschlafzimmer** 9 × 9 (alcove with balustrade, lit à la romaine) → **Kabinett** 4.5 × 5 → **Tempelzimmer** (?) |
| North enfilade | Upper landing of the Prunktreppe | **Herzogin**: Antichambre → Salon → Schlafzimmer → Kabinett; **Wintergarten** (?) at the N end, as a link to the N arm |

Finishes: [D] Louis-Seize boiseries (Georges Jacob), Lyon silks, gilding and mirrors, chandeliers; [N] Tafelparkett,
marble chimneypieces with trumeaux, stucco cove ceilings (02 §2.12).

**Mansard.** Staff rooms on a central corridor, with dormers on every axis.

### e.2 Arms, Sammlungsflügel, Küchenbau, gallery

- **South arm** (64 × 17 m, double-pile).
  - EG: Silberkammer and Silberdiener, plate rooms, officers' rooms. A central **Durchfahrt** 4 m wide [HMS] leads to
    the south terrace garden.
  - OG: **Speisesäle** [HMS] — a large dining room of 10 × 15 m in the middle, plus a smaller dining room and a
    Buffet/Anrichte (serving room). The kitchen is reached via the court [I].
  - Cellars: wine, stores [D cellars].
- **North arm** (62 × ~16–20 m).
  - EG: Durchfahrt to the Küchenhof [HMS], guard and service rooms.
  - OG: apartments of the court (Kavaliere) as 2–3-room units on a corridor [N].
- **Sammlungsflügel** (57 × 13 m, single- or double-pile).
  - EG: **Waffensammlung** and **Büchsenmacherei** [D collections].
  - OG: **Bibliothek** (≈ 10 × 25 m, wall cases, gallery at 2.8 m) [D library → Bamberg], **Naturalienkabinett**,
    **physikalisches Kabinett** [D], and probably the Kupferstichkabinett [U].
- **Küchenbau** (28 × 13 m).
  - EG: Hofküche (12 × 16 m, vaulted, open hearth plus Potager ranges), Bäckerei, Konditorei, Spülküche.
  - OG: cooks' rooms.
- **Galerie** (62 × 11.5 m).
  - One hall, about 60 × 9.5 m clear and 6.5 m high, side-lit from the south. The north wall is for hanging; parquet
    floor.
  - Hidden trapdoor anecdote [D skb].

**Plan drawings to derive from this.**
- Grundriss (plan) EG, OG and mansard of the CdL + arms, at 1:200.
- Lageplan (site plan), 1:2000 and 1:500.
- Ansichten (elevations): court side W, garden side E, south front with terrace garden.
- Schnitt (section) through the axis (court → vestibule → Gartensaal → east avenue). It shows the cut into the rising
  ground east of the CdL: up to +1.2 m inside the footprint, then about 352 m on the plateau.

---

## (f) Gaps and open questions — ranked by impact on the model

1. **Plan of the main complex.**
   - Which open side? Does a west closing range or railing exist? What is the exact CdL depth and position?
   - Source: the 1804/1825 Lagepläne, the 1805 ruin map, the 2006 Lageplan (Commons V15) and Schwan 2010 p. XXXI.
   - Impact: everything in the core.
2. **Elevations.**
   - Storeys, axis counts, roof type per wing (C1 mansard vs gable), Dachreiter, risalits.
   - Source: Le Clerc 1790, Ruppenthal 1788, "Pleine vue" 1791, Herdegen 1791 cartouche, Meissen plate, the 2006
     Ansicht (V16).
   - Impact: the whole silhouette.
3. **Interior room sequence of the CdL.** The schloss-carlsberg.de room guide and "Rekonstruktion der Raumanordnung"
   (HTTP 401; open in a browser), and Weber's "Raumeinteilung des Hauptpalais". Impact: the walk-in experience.
4. **Location of the utility buildings** (Marstall, Reithaus, Kavaliersbau, Remisen, Kasernen, Hundezwinger). They are
   placed now only by HMS and the KB-20/KB-52 platforms. Source: the 1804/1825 plans, Weber chapters, Schwan.
5. **Rotunde 1785 and Orangerie wings / theatre.** Is KB-34 the rotunda? Source: Weber's plan, section and elevations,
   and Fürstenwärther 1786 (PD).
6. **Materials and colours.** Slate or Biberschwanz, render and member colours, Fachwerk share. Source: Schwan's
   invoices, Le Clerc colours.
7. **Cascade geometry** (C3), **Tschifflik** identity and form (C4), menagerie cage radii (Commons photos, field
   visit).
8. **Baumagazin 1793 length and roof.** Source: Schwan, plus a field visit or photos.
9. **Explorer AOI south extension** for the Karlslust (pipeline, other session).
10. **Unplaced buildings** (UP-01…18): Kavaliersbau, Remisen, Wirtshaus, Taubenhaus, Bienenhaus, Amphitheater,
    Chinoiserie, Lusthaus, Monbijou, Kirchturm, Petit Hameau, Karlslust Fasanerie, Torhaus, Trilagen-Pavillon,
    Hirschwürzloch Brunnenhaus.
11. **Effect of the 1950s excavations** and spoil on KB-01…06. Source: LDA Saarland records.

---

## (g) External sources that would most improve accuracy — download requests

Nothing was downloaded in this step. Ranked by value per effort.

| # | What | URL | Licence | Size | Why / which gap |
|---|---|---|---|---|---|
| 1 | **2006 Lageplan by schloss-carlsberg.de** | https://commons.wikimedia.org/wiki/File:Karlsberg_Lageplan.gif | CC BY-SA 2.0 DE | 2050 × 1477 GIF | The research-based site plan by the leading expert's portal → test the whole layout (f1, f4) |
| 2 | **2006 Ansicht (elevation strip)** | https://commons.wikimedia.org/wiki/File:Ansicht_Karlsberg.png | CC BY-SA 2.0 DE | 3023 × 750 PNG | Storeys, roofs, axis rhythm of the building line (f2) |
| 3 | **Map of the ruins 1805** | https://commons.wikimedia.org/wiki/File:Karlsberg_karte_II.jpg | PD | 642 × 531 | Footprints for georeferencing (f1) |
| 4 | **Le Clerc 1790 view** (Commons copy + detail) | https://commons.wikimedia.org/wiki/File:Schloss_Karlsberg_Leclerc.jpeg ; https://commons.wikimedia.org/wiki/File:Karlsberg_III.jpg | PD | 550 × 339 / 747 × 253 | Key contemporary elevation (f2). **A hi-res scan must be requested from the Stiftung Karlsberger Hof** (info@schloss-karlsberg.de) |
| 5 | **"Pleine vue du Carlsberg" 1791** | https://commons.wikimedia.org/wiki/File:Karlsberg_II.jpg | PD | 1300 × 857 | Whole-site bird's-eye (f1, f2, f4) |
| 6 | **Map of the Oberamt Homburg 1782** | https://commons.wikimedia.org/wiki/File:Karlsberg_Karte.jpg | PD | 1075 × 967 | Early state, avenues |
| 7 | **Meissen plate "Le Château de Carlsberg"** | https://commons.wikimedia.org/wiki/File:Le_Ch%C3%A2teau_de_Carlsberg.jpg | PD-Art | 341 × 231 | Hauptpalais elevation (f2) |
| 8 | **Ruppenthal leporello 1788** (first view) | https://global.museum-digital.org/object/1774719 | image CC BY-NC-ND (HMP Speyer) | web image | Independent contemporary view (f2); ask HMP for a hi-res copy |
| 9 | **Schwan, *Burgen und Schlösser* 4/2012** (PDF) | https://journals.ub.uni-heidelberg.de/index.php/bus/article/download/53625/47240/166406 | U (bot-blocked) | U | Plan figures + Herdegen view (f1–f3); open in a browser |
| 10 | **LDA Saarland Jahresbericht 2006** (PDF) | https://www.saarland.de/SharedDocs/Downloads/DE/LDA/Jahresbericht/Denkmalpflege_im_Saarland_Jahresbericht_2006.pdf?__blob=publicationFile&v=5 | U | U | Forecourt investigation (f1, f11) |
| 11 | **schloss-carlsberg.de room guide + Raumanordnung** (read in a browser, save notes) | https://www.schloss-carlsberg.de/index.php/oberamt-homburg/schloss-carlsberg/raumanordnung/55-rekonstruktion-der-raumanordnung4 | © | — | Interior (f3) |
| 12 | **Fürstenwärther 1786** (Rotunde festivities) | https://www.dilibri.de/rlb/periodical/pageview/1165160 | PD | few pages | Rotunde form (f5) |
| 13 | **Herdegen map 1791 with "Vue de Carlsberg"** | BSB Mapp. XI,245 l (locate in https://www.digitale-sammlungen.de) | likely PD / BSB terms | U | Contemporary view (f2) |
| 14 | 2006 site photos (Ehrenhof, Paradestraße, Marstall ramp, Remisen site, Kavaliersbau cellar, Baumagazin, Karlslust) | https://commons.wikimedia.org/wiki/Category:Schloss_Karlsberg | CC BY 2.5 | ~15 × 0.3–1 MB | Ground truth for remains. Note: **no geotags** (checked via the Commons API) |
| 15 | **Print:** Schwan 2010 (ISBN 978-3-9810865-6-0), Weber 1987 (ISBN 978-3-924653-02-6), *Steinerne Macht* catalogue (ISBN 978-3-7954-3387-1) | library / purchase | © | — | Dimensions, axis counts, plans (f1–f6). The single biggest accuracy gain |
| 16 | **Ask HMS / Matzerath** for the 2018/2022 model, plans or stills (hms@hismus.de) | — | © | — | Would replace HMS massing guesses with real geometry (04 §5) |

---

## Changelog
- 2026-11-01: v1 draft. Reconciled 01–04; catalogue v1 (47 entries: 28 with footprints, 1 standing wall as a line
  (KB-B14), 18 unplaced; 27 terrain features); images 21/22.
- 2026-11-01: **catalogue v2** (`model/catalogue.json`, generated by `scripts/catalogue-v2/build.ts` from the frozen
  `model/catalogue.v1.json` + research/07 LP06/LC/PV + research/08 HMS numbers; DTM statistics via `sample_dtm.py`).
  101 entries (92 placed, 9 unplaced), 32 terrain features, 114 rooms, 171 interior openings, 12 stairs. Conflict rule:
  period sources > LP06 > LiDAR positions > HMS heights > norms. What changed and why:
  - **Palace topology (P1/P1b, medium-low).** The CdL is now a 40.9 × 18 m block *between* the arm heads (u 28.2–46.2,
    v −20.3…20.6; LP06 46 × 19 drawn, HMS 44.5 × 18.4). Both arms run along its flanks to u 39 (S 75 × 17, N 72.9 × 20).
    The v1 78 m range is kept as an alternative. §e.1 above (78 m CdL) is superseded where it conflicts.
  - **One cornice at 356.0 m** on CdL, arms, Sammlungs- and Küchenbau [HMS + D enwp "continuous cornice"]. Common floor
    levels: Sockel 344.8–346.2, EG 346.2, Beletage/OG 351.4 (replacing 346.0 / 350.8 / 356.4 above).
  - **Mansard question, per wing.** CdL, S arm, N arm: mansard [D LC 1790 + PL]; the en.wp gable reading is demoted to an
    alternative. Break 4.1 m above the cornice [HMS]. Ridges: arms ≈ 363.8–363.9 (N arm upper pitch 24° on its 20 m
    LiDAR depth reproduces the HMS twin ridge), CdL 362.7 with a raised 7-axis centre pavilion with hip roof + lantern
    to 366.2 [D LC/PL, HMS]. Sammlungsflügel and Küchenbau: mansard too [HMS + PV slate-blue palace roofs + continuous
    cornice; not depicted in LC/PL → med], hip as alternative. Gallery: low hip [I]. Orangerie: 49° hip, ridge 357.75,
    Dachreiter [HMS]. Service town: red tile [D PV].
  - **Other footprints.** Küchenbau extended to the N arm (P9, 45.9 m); gallery = 8 m range on the KB-07 scarp at 347.6
    (P10) with a rectangular end pavilion KB-B07 (P11; rotunda = HMS alternative); Orangerie wings lengthened (P12/P13);
    KB-B13 rotunda kept low (not in LP06). Marstall rebuilt as two courts (W/E ranges, Reithalle, N and two cross ranges;
    P16–P19); Zwinger as walled yard + house (P20); Jägerhaus, Lazarett, Brauerei und Wirtshaus moved to LP06 (P21–P23);
    Baumagazin 85 m in 1789 (P25); Carlsberger Hof = four ranges (P26).
  - **New buildings from LP06** (placement `map`, low): Wachhäuser at the court mouth, Waffenschmiede, Taubenhaus,
    Chevau-leger-Kaserne, Remisen, Torfschuppen, Jägerhof, Cavaliershaus, Kasernen, Treibhäuser, Schäfereien, Scheune,
    Kelterei, Pastorshäuschen, Carlsdorf, Gärtnereien, Brunnenhaus, Hirschwürzloch, Pavillons, Carlsluster Torhaus,
    Fasanerie, Tschifflik (real one, on the KL-03 terrace), Treillagenpavillon, Hymenäostempel site; plus the
    Ehrenhofgitter (D LC/PL, position U). UP-01/02/03/04/07/14/15/16/17 are replaced by placed entries (old id in notes).
  - **Room programmes** for KB-B01/02/03/04/05/06/10 (`scripts/catalogue-v2/programme.ts`): one axis grid per building,
    windows on it from both fronts, partitions on pier midpoints, so no wall meets a window (checked in
    `checks.ts` and a test). CdL: EG through-vestibule, imperial Prunktreppe (5 axes = 42 Pariser Fuß, 38 risers),
    Duke's private rooms on the garden side; Beletage state enfilade with the Festsaal on the axis. S arm: Duchess's
    apartment on the OG (LP06), dining rooms + Silberkammer on the EG (HMS). N arm: Duke's apartment on the OG (LP06)
    on a corridor plan. Sammlungsflügel: armoury/gunsmith EG, library and cabinets OG. Küchenbau: Hofküche on the KB-06
    block. Gallery: one hall. Orangerie: Sommellerie basement, double-height Pfeilersaal, courtiers' rooms over the
    end bays (PV b.). All positions [I], names [D] where documented.
  - **Terrain 1789.** Court surfaces and levels; TF-03 enlarged with a 2.8 m retaining wall [D PL]; new S terrace garden
    (LP06 44), E garden parterre (low) and Orangerie parterre with summer tubs; avenues with species, spacing, row
    distance and 1789 heights (Tilia 6 m [N], Apfelallee 4 m); **Große Kaskade re-identified as KL-08** (rondell 287.5 →
    Tosbecken 271.7 = 10 × 1.58 m, which resolves C3: LP06 58); KL-03 = terrace stair to the Tschifflik; Großes / Kleines
    Bassin added (KL-13 / KL-11, low).
  - **Top-5 remaining uncertainties.** (1) CdL extent and the arm/CdL junction (P1) — needs the 1804/1825 plans or the
    Schwan figures. (2) Room positions and the Duke/Duchess wing assignment (LP06 vs HMS); every room is [I].
    (3) Axis counts and spacings (CdL 2.65 m from the HMS count is tight against the 4.4 m norm) and the HMS-derived
    storey heights. (4) Gallery level/form and the Sammlungs-/Küchenbau lengths (LiDAR 57/46 m vs HMS 62/40.5 m) and
    roofs. (5) The ±15 m "global fit" LP06 buildings (valley, Karlslust approach): positions and forms are templates.
