# 02 — Comparable palaces & design grammar for the Karlsberg reconstruction

Research date: 2026-11-01. Part of the Schloss Karlsberg sub-project (`../README.md`).
This document has two jobs:

1. Collect **contemporary and regional comparables** (c. 1715–1800, focus 1760–1795) that can fill the
   gaps in the Karlsberg record, and say exactly what we borrow from each.
2. Turn that into a **parameterised design grammar** (tables with numbers) for the procedural
   generator in `../model/`, plus **rendering hints** (PBR materials, vegetation, light).

History, sources on Karlsberg itself (plans, views, archives) and the LiDAR site analysis are in the
sibling research files. This file only restates the Karlsberg facts the grammar depends on (§0).

## Evidence legend (used on every line that matters)

| Tag | Meaning |
|---|---|
| **[D]** | Documented: stated in the cited source (URL inline). Web summaries were read on 2026-11-01; numbers were quoted by the source. |
| **[D→]** | Derived arithmetically from documented numbers (e.g. facade length ÷ axes). |
| **[I]** | Inferred by reasoning from comparables or from Karlsberg evidence. Reasoning is given. |
| **[N]** | Period norm: typical value for French-influenced German court architecture of 1760–1795, from general architectural-historical knowledge (Blondel, *Cours d'architecture* 1771–77; Neufforge; Penther; surviving buildings). **Not checked against a primary source in this session.** Use it as a default and replace it when Karlsberg-specific evidence appears. |
| **[U]** | Unknown. Needs Karlsberg-specific evidence (Schwan 2010 thesis, Weber 1987, the 1790/91 views, excavation reports). |

> Bottom line for the model: every building parameter in §2 is a **default with a range**. The
> generator should store the tag with each value so that the viewer can show "documented vs.
> reconstructed" (see README principle "Evidence first").

---

## 0. Karlsberg facts the grammar must respect

| # | Fact | Tag / source | Consequence for the model |
|---|---|---|---|
| K1 | The buildings are **one and two storeys** high. They share a "uniform design" with **continuous cornices, architrave blocks and gabled roofs**. **Only the Corps de logis buildings have a mansard roof.** | [D] [en.wikipedia Karlsberg Castle](https://en.wikipedia.org/wiki/Karlsberg_Castle), citing Ralf Schneider, *Burgen und Schlösser an der Saar*, 1988, pp. 448–453 | Default roof for every building except the Corps de logis = **Satteldach / Walmdach**. Mansard only on the Corps de logis. Cornice heights are shared across ranges, so one eave line runs along the whole frontage. |
| K2 | The right side of the main complex was **1,250 m** long ("largest country palace of Europe"). Other sources say "more than one kilometre". | [D] en.wikipedia (above); [lapinvoyageur.de 2020](https://lapinvoyageur.de/2020/06/18/schloss-karlsberg/) | Long, low, additive ranges, not a compact block. This drives LOD and instancing. |
| K3 | The **staircase was 42 m** long ("one of the biggest of the Baroque period"). | [D] en.wikipedia (above). It is unclear whether this is the stair hall or the run of the flights. **[U]** | Reserve a stair hall of about 42 m in one dimension in the Corps de logis. Flag it as a high-uncertainty element. |
| K4 | Classicist (Louis-seize) style. It is "among the earliest Classicist buildings in Germany", contemporary with Wörlitz. Mannlich (Generalbaudirektor) designed the buildings; **Mannlich and Jean-Démosthène Dugourc** designed the interiors. Furniture was largely by **Georges Jacob**, sculpture by Duret and Monot, and silver by Kirstein (Strasbourg). | [D] [de.wikipedia Schloss Karlsberg](https://de.wikipedia.org/wiki/Schloss_Karlsberg) | Parisian Louis-seize interiors: boiserie, straight lines, Greek fret, garlands. The exteriors were sober. |
| K5 | Built from c. 1777/78 **around the Louisenhof**, which was a modest **Dreiflügelanlage** with a dwelling house, stables and an outbuilding. Growth was additive: Corps de logis, Wirtshaus and Brauerei 1778–82; Marstall 1778–85; Kavaliersbau 1779–85; north wing 1779–94; south wing 1780–85; kitchen wings; west wing from 1782; **gallery wing 1788**; Menagerie 1779–86; Hundezwinger 1780–83; Jägerhaus → Kaserne 1791; **Molkerei → Orangerie 1780**; Fasanerie, Ananashaus, Bienenhaus, Komödienhaus, Amphitheater, Torhaus… | [D] [schloss-karlsberg.de](https://schloss-karlsberg.de/schloss-karlsberg/), en.wikipedia timetable (31 entries) | "Residenz aus Gutshof" type (§1G). Plan grammar = **pavilion/range system along an axis**, not one symmetrical block. |
| K6 | **Orangerie**: three-winged, over a **high basement (hohes Kellergeschoss)**, with a large **pillared hall** and **floor-length windows**, "**hell verputzt**" (light-coloured render), visible from far away. | [D] [schloss-karlsberg.de](https://schloss-karlsberg.de/schloss-karlsberg/) | Orangerie template (§2.14). Its colour anchors the facade palette: light render. |
| K7 | **All palace buildings had lightning conductors (Blitzableiter).** | [D] schloss-karlsberg.de (above) | Add iron rods with ground wires on ridges and chimneys. Cheap detail, documented. |
| K8 | Große Kaskade in the Karlslust: **10 steps, each 1.5 m high, step areas 10 × 10–15 m**. Bärenzwinger: a ring of **19 half-round cages** plus a loge around a moat with a square island (used as aviaries). Three Schwanenweiher end in a tumulus with a niche and a ruin. Tschifflik pavilion in "Turkish" style. | [D] de.wikipedia (above) | Garden grammar (§2.15). Schwetzingen is the cited parallel (§1C). |
| K9 | Parts of **Schloss Jägersburg** (building parts and interior fittings) were reused at Karlsberg after the 1782 plan to transfer it. Panelling and furniture came from Jägersburg. | [D] [de.wikipedia Schloss Jägersburg (Homburg)](https://de.wikipedia.org/wiki/Schloss_J%C3%A4gersburg_(Homburg)); schloss-karlsberg.de | Jägersburg is a **direct material ancestor** (§1A). |
| K10 | Stone of the demolished **Hohenburg / Vauban fortress** on the Homburg Schlossberg was used as a quarry for Karlsberg. Local stone = **Buntsandstein**. | [D] [wikiwand Hohenburg Castle](https://www.wikiwand.com/en/Hohenburg_Castle_(Homburg)) (says the fortress "served as a quarry for the construction of Karlsberg Castle"); [I] geology (the Homburg Schlossberghöhlen are in Buntsandstein) | Dressings and plinths in **red and yellow-grey Buntsandstein**; rubble walls rendered. |
| K11 | Picture gallery so long that the duke and court painter reportedly raced in wheelchairs through it. | [D, anecdote] TV documentary summary via search ([fernsehserien.de](https://www.fernsehserien.de/filme/schloss-karlsberg-das-versunkene-versailles-des-suedwestens)) | Gallery wing: long and narrow (§2.12). Length **[U]**. |
| K12 | Main contemporary views: a **1790 watercolour by Philipp LeClerc** and the **"Vue de Carlsberg" (1791) on Friedrich Herdegen's map**. A painting by Heinrich Lau (1978) and a physical model exist. | [D] search summary of Schwan, *Burgen und Schlösser* 4/2012 ([Heidelberg OJS](https://journals.ub.uni-heidelberg.de/index.php/bus/article/download/53625/47240/166406); full text blocked by bot protection in this session) | **Every grammar default below must be checked against these two views** before the first model freeze. |

**Unknown for Karlsberg [U]:** absolute dimensions of any building, axis counts, storey heights,
roof covering (slate vs. tile), render colour other than the Orangerie, window and shutter types,
and the share of masonry vs. rendered Fachwerk. It is a hypothesis to check with Schwan 2010
that the rapid, additive building campaign (and how thoroughly fire destroyed it in 1793)
points to **many rendered half-timbered or light upper storeys on service ranges**. The
sources do not support it yet.

---

## 1. Comparable palaces

### 1.0 Overview — what each comparable is used for

| Comparable | Region | Date | Type | Main use for us |
|---|---|---|---|---|
| Schloss Zweibrücken | Pfalz-Zweibrücken | 1720–25 | Stadtresidenz | Ducal facade vocabulary; light render + sandstone risalits; flattened roof |
| Jagdschloss Jägersburg | Pfalz-Zweibrücken | 1752–56 | Lustschloss (Trianon type) | **Direct ancestor** (parts reused); 2 storeys / 15 axes; flat roofs |
| Schloss Pettersheim | Pfalz-Zweibrücken | 1759–68 | Jagdschloss + Wirtschaftshof | Surviving regional farm/service buildings, as a field reference |
| Tschifflik Zweibrücken | Pfalz-Zweibrücken | 1715–16 | Lustschloss / "farm" | Name and type origin of the Karlsberg Tschifflik pavilion; Petri gardens |
| Saarbrücker Schloss | Nassau-Saarbrücken | 1739–48 | Residenz | **Hard numbers**: 65.45 m / 15 axes → axis ≈ 4.36 m |
| Jägersberg (Neunkirchen), Ludwigsberg, Monplaisir | Nassau-Saarbrücken | 1709–93 | Jagd-/Lustschlösser | Regional Lustschloss network; the Ludwigsberg garden is an exact contemporary |
| Mannheim | Kurpfalz | 1720–60 | Residenz | Upper bound of scale (450 m front) |
| Schwetzingen | Kurpfalz | 1748–95 | Sommerresidenz + garden | **Garden buildings**: Moschee ↔ Tschifflik, Wasserkastell ↔ Schwanenweiher ruin, aviaries ↔ Bärenzwinger |
| Benrath | Kurpfalz/Berg | 1755–70 | Maison de plaisance | Hidden storeys, room programme, slate mansard, parquet, silk |
| Solitude | Württemberg | 1763–69 | Hilltop Lustschloss + Kavaliersbauten | Closest **siting** analogue (forest hilltop, long outbuilding ranges, avenue) |
| Hohenheim | Württemberg | 1772–93 | Residenz grown from Gutshof | **Same genesis** (estate → residence), same dates, English village |
| Wilhelmsthal | Hessen-Kassel | 1743–61 | Lustschloss, loose 3-wing | Loosely joined pavilions; cascade; estate origin |
| Wilhelmshöhe | Hessen-Kassel | 1786–98 | Classicist residence | Exact contemporary: **white finish, glazing bars, shutters** |
| Wörlitz | Anhalt-Dessau | 1769–73 | Classicist Landhaus | The comparison Karlsberg is measured against; storey stack; detached kitchen |
| Koblenz Kurfürstliches Schloss | Kurtrier | 1777–93 | Classicist residence | Exact contemporary, French architects: **whitish-grey walls, grey members** |
| Hameau de la Reine | France | 1783–86 | Ferme ornée | Rustic and farm idiom for Karlsberg's farm-derived parts |

### 1A. Pfalz-Zweibrücken (the duke's own building culture)

**Schloss Zweibrücken** (Residenzschloss): Jonas Erikson Sundahl for Duke Gustav Samuel Leopold,
1720–25, Baroque [D] ([de.wikipedia](https://de.wikipedia.org/wiki/Schloss_Zweibr%C3%BCcken)).
It was looted on 3 May 1793. Rebuilt 1962–64 from Sundahl's plans found in Nancy, including the
"abgeflachte Bedachung" (flattened roof) [D]. Today's square front has a **white window front
between two two-axis, sandstone-coloured corner risalits with triangular pediments; a segmental
pediment with arms in the middle** [D, modern state] ([ADAC POI text](https://maps.adac.de/poi/schloss-zweibruecken-zweibruecken)).
The roof is low, with a balustrade [D, via search summary of the
[Rheinpfalz 300-year article](https://www.rheinpfalz.de/lokal/zweibruecken_artikel,-das-zweibr%C3%BCcker-schloss-wird-300-jahre-alt-_arid,5793875.html)].
- *Why comparable:* the duke's own city residence and the local "house style" Mannlich worked against.
- *Borrow:* the colour logic of a **light render field with sandstone-toned risalits and dressings** [I].
  The low or flattened roof idea is shown in Zweibrücken and Jägersburg, but K1 says Karlsberg used
  gabled roofs, so we do **not** borrow the roof.

**Jagdschloss Jägersburg** (Homburg-Jägersburg): 1752–56 for Christian IV, probably by Jacques
Hardouin-Mansart de Sagonne; Pierre Patte also claimed it. **Modelled on the Grand Trianon.** The
main block had **2 storeys and 15 window axes** with central and side risalits, and single-storey
rectangular wings. **Main block and wings had flat roofs.** Facade: **pilasters, engaged columns,
balustrades**. Garden by Johann Ludwig Petri. Burnt 1793, demolished after 1800. Its parts and
fittings were reused at Karlsberg [D] ([de.wikipedia](https://de.wikipedia.org/wiki/Schloss_J%C3%A4gersburg_(Homburg))).
- *Why comparable:* the nearest ducal Lustschloss (≈ 5 km), French-designed, and a physical source of Karlsberg fabric.
- *Borrow:* **2 storeys + 15 axes** as the pattern for a principal pavilion. Pilaster order and
  balustrade vocabulary for the Corps de logis risalit [I]. The Jägersburg interiors (panelling
  reused at Karlsberg) are the best proxy for the **older parts of Karlsberg interiors** [I].
- Also nearby: **Gustavsburg** (Jägersburg). Do not confuse the two [D, same article].

**Schloss Pettersheim** (Herschweiler-Pettersheim): a medieval water castle, new building by
Sundahl 1723, then a **new hunting lodge 1759–68**, park by Petri, destroyed 1793. **The
Wirtschaftshof buildings survive** [D] ([de.wikipedia](https://de.wikipedia.org/wiki/Schloss_Pettersheim)).
- *Borrow:* a **surviving regional ducal farm-service building** to photograph and measure
  (field trip or photos) for the Karlsberger Hof, Louisenhof and Remisen templates [I].

**Tschifflik (Zweibrücken)**: Lustschloss for the exiled King Stanislaus Leszczyński, by Sundahl
1715–16. It had a main house, two residences, a terrace with apartments and two service buildings.
It was enclosed by a wall about **4 km long and 2.5 m high**. The name derives from a Turkish word
for "farm/estate". It was later expanded by Petri in an English-influenced manner, with a
pheasantry 1757–69 [D] ([de.wikipedia](https://de.wikipedia.org/wiki/Tschifflik)). The article links
plans of the Tschifflik on **schloss-carlsberg.de** [D]. That site returned 401 in this session [U].
- *Borrow:* the "Tschifflik" idea of a **Lustschloss as a farm** is already present in the duchy, and
  the Karlsberg Tschifflik pavilion repeats the name [I]. Use a **2.5 m enclosure wall** as the
  default Wildpark/Tiergarten wall height [D→ by analogy].

**Mannlich's own works**: none of his buildings survive [D] ([de.wikipedia Mannlich](https://de.wikipedia.org/wiki/Johann_Christian_von_Mannlich)).
He trained at the Mannheim academy and in Paris among French artists [D]. The interiors went to
Munich: **Residenz München, Nymphenburg, Würzburg, Bamberg Neue Residenz, Bayerisches
Nationalmuseum** [D] (de.wikipedia Karlsberg; schloss-karlsberg.de).
- *Borrow:* **interior detailing must come from the surviving Karlsberg furniture and fittings in
  the Munich and Bamberg collections**. They are the only physical Karlsberg interiors [I]. This is
  a follow-up research task: museum-digital or Bavarian palace administration object records.

**Schloss Gutenbrunnen** (ducal spa residence) is mentioned on schloss-karlsberg.de without detail [U].

### 1B. Nassau-Saarbrücken

**Saarbrücker Schloss** (Friedrich Joachim Stengel, 1739–48, burnt 1793; rebuilt 1981–89 by
Böhm) [D] ([de.wikipedia](https://de.wikipedia.org/wiki/Saarbr%C3%BCcker_Schloss)):
- Three-wing plan inside a **65.45 × 61.34 m** rectangle. Corps de logis **65.45 m long with 15
  window axes**, **18.26 m deep with 4 windows** across the depth. Side wings 43.08 m, 10 axes.
  Corner pavilions 14.98 m (3 windows) × 15.84 m (4 windows). Levels: **Souterrain,
  Rez-de-chaussée, Beletage, Mezzanin**. Corner pavilions had **mansard roofs** in the Baroque state [D].
- Derived: **axis spacing ≈ 4.36 m** on the long front (65.45/15). It is ≈ 4.5 m on the depth
  (18.26/4) and ≈ 4.3 m on the wings (43.08/10) [D→]. These are the **best hard numbers for a
  regional princely axis module**.
- *Borrow:* the axis module 4.2–4.5 m for the Corps de logis. The storey stack Souterrain + EG +
  Beletage + Mezzanine. A building depth of ≈ 18 m for a double-pile (zweibündig) main block [I].

**Schloss Jägersberg** (Neunkirchen): Stengel, 1752/53, Jagdschloss. Looted 1793, used as a quarry
until 1822. The Mittelrisalit and cellar vaults survive (Schlossstraße 22) [D]
([de.wikipedia](https://de.wikipedia.org/wiki/Schloss_J%C3%A4gersberg)).
- *Borrow:* the same fate as Karlsberg (loot → quarry). Its **surviving cellar vaults** are a
  model for the Karlsberg "Räuberhöhle" (Kavaliersbau cellar): barrel vault in Buntsandstein [I].

**Ludwigsberg** (Saarbrücken; Fürst Ludwig, 1769–93): Lustschloss on an artificial platform
between Rodenhof and Rußhütte. Designed by the elder Stengel, with **sightlines to the other
princely buildings**. Gardens by J. F. C. Koellner and H. L. Koellner. Destroyed 1793. The
Ludwigsparkstadion is on part of the site. Main study: Minoti Paul, *Der Ludwigsberg*, 2009
[D, search summaries; [geocaching](https://www.geocaching.com/geocache/GCAJFTG), CCA library record].
- *Why comparable:* an **exact contemporary** of Karlsberg in the neighbouring principality, also
  burnt in 1793, also a garden-dominated Lustschloss with rustic and exotic follies [I].
- *Borrow:* the garden-folly repertoire and the platform/terrace siting [I]. Details **[U]**
  until Paul 2009 is read.

**Monplaisir** (Halberg): small Baroque Lustschloss of Count Ludwig Crato, **1709–11** [D, search
summary of en.wikipedia/Halberg]. Too early; it shows the regional habit of satellite pleasure houses only.

### 1C. Kurpfalz (Karl August's Wittelsbach relatives; his heir was Karl Theodor)

**Mannheim Schloss**: front about **450 m**, encloses about 6 ha, 1720–60 [D]
([en.wikipedia](https://en.wikipedia.org/wiki/Mannheim_Palace)).
- *Borrow:* only as a scale check. Karlsberg's 1,250 m frontage is 2.8× longer but **made of low,
  one- and two-storey ranges** (K1). It is an extended Lustschloss, not a Mannheim-type block [I].

**Schwetzingen** (Karl Theodor's summer residence; Pigage, Sckell) [D]
([de.wikipedia Schloss Schwetzingen](https://de.wikipedia.org/wiki/Schloss_Schwetzingen)):
- **Zirkelbauten**: **single-storey** quadrant ranges (1748/49 and 1753) for dining, games,
  concerts and balls [D] → the template for **long one-storey Karlsberg ranges** (galleries,
  Remisen, connecting wings) [I].
- **Badhaus** (Pigage): a small villa-like pleasure house with an oval hall, bedroom, Chinese room,
  and a marble pool about **1.2 m deep** [D] → the room-programme template for the small
  "private" Karlsberg pavilions and the Tschifflik [I].
- **Moschee**, **1778–85**: a Turkish garden folly with no religious function [D] → an exact-date
  parallel to the **Turkish-style Tschifflik pavilion** at the Karlsberg cascade [I].
- **Römisches Wasserkastell**, artificial ruin from 1779 [D] → parallel to the **ruin on the
  tumulus at the end of the Schwanenweiher**. de.wikipedia Karlsberg names the "Kastell" in
  Schwetzingen as the parallel [D].
- **Aviaries** with live birds next to the Vogelbad [D]. de.wikipedia Karlsberg says a structure
  similar to the Bärenzwinger survives at Schwetzingen [D].
- **Tempel der Botanik** (1777–80) has a **rough, bark-like render** [D] → a material option for
  rustic garden buildings [I].
- *Borrow:* the whole **Karlslust garden-building family** (scale, materials, render types).

**Benrath** (Pigage, 1755–70, maison de plaisance for Karl Theodor) [D]
([de.wikipedia](https://de.wikipedia.org/wiki/Schloss_Benrath); [en.wikipedia](https://en.wikipedia.org/wiki/Benrath_Palace)):
- Corps de logis **42 × 27 m**. It *looks* single/two-storeyed but holds **4 storeys (5 with the
  cellar)**, **80 rooms**, two light courts, **7 staircases**. **Service rooms are half the height
  of the state rooms.** A low mansard storey has small dormer "Bullaugen". **Slate-covered
  mansard roof.** Facade colour **"Altrosa"**. Oval standing windows in the upper floor.
  **Original wooden parquet**, marble fireplaces, painted panelling, **silk and chintz wall
  coverings**, stucco after Verschaffelt. Flanked by two curved **Kavaliersflügel** [D].
- *Borrow:* the **"hidden mezzanine" section**: state rooms of 1 tall storey (EG) flanked by
  stacked service rooms of half height (entresols). This lets a "one-storey" Karlsberg range
  hold living space [I]. The finish catalogue for interiors (parquet, silk, marble fireplace,
  painted panelling) [D→I]. **Do not borrow the pink**. It is a Rococo palette, and Karlsberg is
  documented as light-rendered (K6) [I].

**Oggersheim** (Kurpfalz Lustschloss): the de.wikipedia page was not found under
"Schloss_Oggersheim" (404) [U]. Re-search later. Low priority.

### 1D. Württemberg (Carl Eugen, the duke's contemporary and rival builder)

**Schloss Solitude** (1763–69; Philippe de La Guêpière, J. F. Weyhing, the duke himself): a
Lustschloss on a forest height with **Offizien- und Kavaliersgebäude** and a straight avenue to
Ludwigsburg of **13,032 m** (40,118.718 Pariser Fuß) [D] ([de.wikipedia](https://de.wikipedia.org/wiki/Schloss_Solitude)).
Its exterior is Baroque and its interior early Neoclassical in room and wall proportions [D].
- *Why comparable:* the **same siting idea**: a court on a forested hill far from the capital, a
  representative main building with long low service and cavalier ranges [I].
- *Borrow:* the arrangement of low outbuilding ranges in a curve or line around the main building.
  **Pariser Fuß as the planning unit** of the time: the avenue's own length is given in it [D].

**Schloss Hohenheim** (1772–93; R. F. H. Fischer): built on the site of the **Gutsgebäude der
Herren von Hohenheim**. First a small moated castle (1772), a summer residence from 1776, a large
residence begun 1782 and unfinished at the duke's death in 1793. Side wings from 1772,
**Kavaliersbau 1773**. **"Englisches Dörfle"**: from 1776, **more than 60 small buildings at a
scale of 1:4** [D] ([de.wikipedia](https://de.wikipedia.org/wiki/Schloss_Hohenheim)).
- *Why comparable:* the **closest genetic twin**: estate → residence, the same years, a duke who
  kept adding buildings until 1793 [I].
- *Borrow:* the logic of **phased additive growth** (keeping farm buildings in use while adding
  wings), and the reduced-scale fabrique buildings for the Karlslust [I].

**Monrepos** (Ludwigsburg): La Guêpière's palace begun 1760, abandoned after 4 years, finished by
Thouret 1804 [D] ([de.wikipedia](https://de.wikipedia.org/wiki/Seeschloss_Monrepos)). Useful only as
a lake-pavilion reference for the Karlsbergweiher island [I].

### 1E. Hessen-Kassel

**Schloss Wilhelmsthal** (Calden; Cuvilliés design, built 1743–61; du Ry from 1756): a
**"locker gefügte Dreiflügelanlage"** (loosely joined three-wing complex) grown from the estate of
Amelgotzen (bought 1643). Garden on a **fan of three axes**. The central axis was planned as a
**cascade into a basin** (only partly built; filled in c. 1800). A **shell-and-glass grotto** and an
**ice cellar in a hill** [D] ([de.wikipedia](https://de.wikipedia.org/wiki/Schloss_Wilhelmsthal_(Calden))).
- *Borrow:* **detached pavilions joined only visually** (gaps between wings), estate origin,
  cascade + grotto + ice cellar. All three occur at Karlsberg (Kaskade, Eiskeller in the POI list
  of `../../research/03-archaeology-visualization.md`) [I].

**Schloss Wilhelmshöhe** (1786–98; S. L. du Ry, H. C. Jussow): classicist three-wing complex with
originally **free-standing wings**. Eight-column risalits with **vase-crowned attics**. Domed
centre. The post-war rebuild was criticised for lacking the **dome, the glazing bars
(Sprossenfenster) and the shutters (Fensterläden)** and for the loss of the **original white
finish** [D] ([de.wikipedia](https://de.wikipedia.org/wiki/Schloss_Wilhelmsh%C3%B6he)).
- *Borrow:* **documented Sprossen + Fensterläden + white finish on a German court building of
  exactly the Karlsberg years.** This is our best evidence for the default window and colour
  scheme [D→I].

### 1F. Early classicism / Louis-seize reference set

**Schloss Wörlitz** (Erdmannsdorff, 1769–73): **≈ 36 × 24 m**. **Two main storeys + Souterrain +
Mezzanin**. Portico with **4 Corinthian columns** and a Freitreppe. Windows differ in size and
surround per floor. Ten rooms and two halls around a light court. Belvedere. **Cast-iron
stoves**. **Detached kitchen building ≈ 50 m away, linked by an underground passage** [D]
([de.wikipedia](https://de.wikipedia.org/wiki/Schloss_W%C3%B6rlitz)).
- *Borrow:* the storey hierarchy (window size decreasing upward), the Mezzanine. The **separate
  kitchen wing linked by a passage** matches Karlsberg's documented "kitchen wings" (K5) [I].

**Kurfürstliches Schloss Koblenz** (d'Ixnard, then A.-F. Peyre the Younger; 1777–86/93): Corps de
logis of **39 axes**. City-side **eight-column portico** across the full height. Horizontal
articulation dominates. Semicircular wings. The 1998 restoration returned the **18th-century
colours: whitish-grey wall surfaces, grey architectural members** [D]
([de.wikipedia](https://de.wikipedia.org/wiki/Kurf%C3%BCrstliches_Schloss_Koblenz)).
- *Why comparable:* **the same years, French classicist architects, a Rhineland prince**.
- *Borrow:* the **colour scheme (whitish-grey render + grey or stone-coloured members)** as the
  default for the Karlsberg Corps de logis. **Strong horizontal articulation** with continuous
  cornices matches K1 [D→I].

**Hameau de la Reine** (Versailles; Richard Mique with Hubert Robert, 1783–86): **12 cottages**
(5 for the queen, 7 agricultural). Mill, dairy, farm, dovecote, guardhouse, barn-ballroom.
Half-timber with reed roofs, plastered facades, dormer roofs. Boudoir 4.6 × 5.2 m [D]
([en.wikipedia](https://en.wikipedia.org/wiki/Hameau_de_la_Reine)).
- *Borrow:* the **ferme ornée** idea, i.e. farm buildings as part of the court display. Karlsberg's
  Molkerei, Taubenhaus, Bienenhaus, Fasanerie and Ananashaus (K5) belong to this family. Their
  grammar is **rustic, not palatial** [I].

### 1G. The two building types that define Karlsberg

**Lustschloss / maison de plaisance** (Blondel's *De la distribution des maisons de plaisance*,
1737–38, is the canonical treatise [N]). Features: residence away from the capital, near hunting
grounds; **compact main building with few storeys**, state rooms on the garden side, private
apartments in **appartements doubles** (enfilade + back corridor or garderobe); dependencies
(Kavaliersbauten, Offizien, Marstall) in **separate low buildings** framing a cour d'honneur
(Benrath, Solitude, Wilhelmsthal, Jägersburg) [D for the examples, N for the type].

**Residenz aus Gutshof** (residence grown from an estate): Karlsberg (Louisenhof), Hohenheim
(Gutsgebäude), Wilhelmsthal (Amelgotzen), with Tschifflik (named "farm") and the Hameau as the
idealised version [D for the examples]. Grammar consequences [I]:
1. The **original farm courtyard survives inside the plan** as a functional core (Marstall, Molkerei
   → Orangerie). Expect irregular angles and older building lines there.
2. New ranges **align on one main axis and one cross-axis**, but grow **one wing at a time**, so
   symmetry is local (per court), not global.
3. A **uniform eaves and cornice height** knits the additive pieces together. This is documented
   for Karlsberg ("continuous cornices", K1).
4. Service and farm buildings stay **rustic** (Satteldach, tile, sandstone door frames). The
   display buildings get the classical order.

---

## 2. Design grammar (parameter tables)

### 2.0 Units, module, coordinate convention

| Parameter | Value | Tag | Note |
|---|---|---|---|
| Planning unit | **Pied du roi (Pariser Fuß) = 0.3248 m**; 1 pied = 12 pouces (2.707 cm) | [N]; the use of the Pariser Fuß at a German court of the time is [D] for Solitude | Mannlich was trained in Paris and the designers were French. Snap dimensions to whole or half pieds. |
| Alternative unit | Rheinländischer Fuß = 0.3139 m | [N] | A local Zweibrücken Werkschuh value is **[U]**. Make the unit a generator parameter. |
| Axis module (Corps de logis) | **13.5 pieds ≈ 4.38 m** (range 4.0–4.6 m) | [D→] Saarbrücken 4.36 m | |
| Axis module (two-storey wings, Kavaliersbau) | 11–12 pieds ≈ **3.6–3.9 m** | [N] | |
| Axis module (one-storey ranges, galleries) | 10–12 pieds ≈ **3.3–3.9 m** | [N] | |
| Axis module (Marstall, Remise) | 1 window per 1–2 horse stalls ≈ **3.2–3.6 m** | [N] | |
| Building depth, double-pile main block | **16–19 m** | [D→] Saarbrücken 18.26 m; Benrath 27 m (with light courts); Wörlitz 24 m | |
| Building depth, single-pile wing / gallery | **8–11 m** | [N] | |
| Generator frame | Local frame of `../../docs/data-contract.md`: x = E − 381000, y = h (DHHN2016), z = −(N − 5465000) | [D] README | |

### 2.1 Building classes (template keys)

| Key | Class | Karlsberg members (K5) | Storeys | Roof | Order / rank |
|---|---|---|---|---|---|
| `CDL` | Corps de logis | main palace blocks | EG + Beletage + Mezzanine (+ Souterrain) | **Mansard** [D K1] | Highest: pilasters or engaged columns on risalit, pediment |
| `WING2` | Two-storey wing | north, south, west wings; Kavaliersbau | 2 | Walm/Satteldach [D K1] | Lisenen, Gurtgesims, Hauptgesims |
| `RANGE1` | One-storey range | gallery wing (1788), connecting wings, kitchen wings, Remisen | 1 (+ attic / hidden entresol) | Satteldach/Walm [D K1] | Lisenen, continuous cornice |
| `PAV` | Pavilion / corner block | Torhaus, Wirtshaus, Ananashaus, Tschifflik | 1–2 | Walm / Zeltdach; Tschifflik: oriental roof [U] | Varies |
| `STABLE` | Marstall, Remise, Hundezwinger | Marstall 1778–85; Hundezwinger 1780–83 | 1 + Heuboden | Satteldach, often half-hipped [N] | Plain; portal accents |
| `RIDE` | Reithalle | Reithalle (de.wikipedia photo caption) | 1 tall | Satteldach, wide-span truss [N] | Plain; end-gable portal |
| `ORANG` | Orangerie | Molkerei → Orangerie 1780 | 1 tall over high basement [D K6] | Walm/Satteldach [I] | Pillared hall [D K6] |
| `FARM` | Farm building (Westrich type) | Louisenhof, Karlsberger Hof, Baumagazin, Brauerei, Molkerei | 1–2 | Satteldach 45–52° [N] | Rustic |
| `GARD` | Garden structure | Kaskade, Bärenzwinger, grottos, terraces, Eremitage | — | — | Rustic or antique |

### 2.2 Storey heights (floor-to-floor unless noted)

| Level | `CDL` | `WING2` | `RANGE1` | `STABLE` / `FARM` | Tag |
|---|---|---|---|---|---|
| Plinth / Souterrain above ground | 1.2–2.0 m (Souterrain windows in plinth); Orangerie "hohes Kellergeschoss" 2.0–3.0 m | 0.6–1.0 m | 0.4–0.8 m | 0.2–0.4 m | [D] Saarbrücken has a Souterrain; Orangerie K6 [D]; values [N] |
| Erdgeschoss (rez-de-chaussée) | **5.0 m** (4.5–5.5) | **4.2 m** (3.8–4.5) | **5.0–6.0 m** (gallery: tall single storey) | 4.0–5.0 m stable (high for air); 3.0–3.5 m farmhouse | [N] |
| Beletage | **6.0 m** (5.5–6.5); Festsaal through Mezzanine: 8–10 m | 3.8 m (3.5–4.2) | — | Heuboden in roof | [N] |
| Mezzanine / entresol | **3.0 m** (2.6–3.3); windows square or lying | — | hidden entresol behind service rooms: ≈ ½ EG height | — | [D] Benrath: service rooms ½ height of state rooms; [D] Wörlitz & Saarbrücken have a Mezzanin; values [N] |
| Floor build-up (joists + pugging + parquet) | 0.45–0.6 m | 0.35–0.5 m | 0.35 m | 0.3 m | [N] |
| Eaves height above ground (resulting) | ≈ 15–17 m | ≈ 9–10 m | ≈ 6–7.5 m | ≈ 5–6 m | [D→] from rows above. **Check against the 1790/91 views** [U] |

### 2.3 Window grammar

| Parameter | `CDL` EG | `CDL` Beletage | `CDL` Mezz. | `WING2` | `RANGE1` / gallery | `STABLE` | `FARM` | Tag |
|---|---|---|---|---|---|---|---|---|
| Clear width | 1.30 m (4 pieds) | 1.40 m (1.3–1.5) | 1.30 m | 1.15–1.25 m | 1.30–1.50 m | 0.9–1.2 m | 0.8–1.0 m | [N] |
| Clear height | 2.6–2.9 m | **2.9–3.3 m** (≈ 2.2 × w); garden side: **porte-fenêtre to floor 3.6–4.0 m** | 1.1–1.4 m (square to lying) | 2.3–2.5 m | 3.0–3.8 m; gallery may use **tall arched windows** | 1.0–1.4 m, often lunettes / segmental | 1.2–1.5 m | [N]; "window size decreasing upward" [D] Wörlitz |
| Height : width | 2.0–2.2 | 2.1–2.4 | ≈ 1.0 | 2.0 | 2.2–2.6 | 1.0–1.3 | 1.4–1.6 | [N] ("stehende Fenster") |
| Sill above floor | 0.85–0.95 m | 0.55–0.8 m with **iron balconet or baluster panel**; 0 m for portes-fenêtres | 0.6–0.8 m | 0.85–0.95 m | 0.7–0.9 m | 1.6–2.0 m (high, for horses) | 0.8–0.9 m | [N] |
| Lintel to ceiling | 0.6–1.0 m | 0.8–1.2 m (cove above) | 0.3 m | 0.6–0.8 m | 1.0–1.5 m | 0.5–1.0 m | 0.3 m | [N] |
| Pier (wall between windows) | axis − w ≈ 3.0 m | ≈ 3.0 m | ≈ 3.0 m | 2.4–2.7 m | 2.0–2.5 m | 2.2–2.5 m | — | [D→] axis module − width |
| Head form | straight, keystone | straight + **Verdachung** (straight cornice on centre axes, triangular / segmental pediment on risalit) | straight | straight, ears (Ohren) optional | straight or round-arched | segmental (Stichbogen) | straight / segmental | [N]; pediments on risalits [D] Zweibrücken |
| Surround (Gewände) | Buntsandstein, 0.18–0.25 m face, 0.05–0.08 m proud of render, profiled Faszie | same, richer profile | plain | plain band | plain band | plain sandstone | sandstone, chamfered | [N]; [I] material K10 |
| Window count rule | 1 per axis; risalit 3 or 5 axes | | | | | | | [D] Jägersburg 15 axes with centre and side risalits; Saarbrücken 15 |

**Glazing pattern (Sprossen).** Documented on a contemporary German court building (Wilhelmshöhe) [D]; Karlsberg [U].
| Parameter | Value | Tag |
|---|---|---|
| Casement type | Two-leaf wooden **French casement (croisée)**, inward-opening, with a **Kämpfer** (transom) at ≈ ¾ height and an **Oberlicht** above | [N] |
| Pane grid, Beletage window 1.4 × 3.2 m | Below transom: 2 leaves × **4 rows** × 1 pane per leaf width (or 2 per leaf) → panes ≈ 0.55–0.6 × 0.55–0.6 m. Oberlicht: 2 × 1 or 2 × 2 | [N] |
| Pane size range | 0.30–0.60 m wide, 0.40–0.65 m tall; **standing or square, never wide** | [N] |
| Glazing-bar width | 25–35 mm (wood), profiled | [N] |
| Frame colour | white / pale grey (oil paint), matching the classicist scheme | [N]; Koblenz grey [D] as option |
| Glass | Hand-made crown or cylinder glass: slight **green tint, waviness, bubbles**; pane-to-pane reflection variation | [N] |

**Shutters (Fensterläden).**
| Parameter | Value | Tag |
|---|---|---|
| Presence | Default **on** for `WING2`, `RANGE1`, `PAV`, `FARM`; **off** (or inside shutters only) on `CDL` state fronts | [D] Wilhelmshöhe had shutters; split by rank [I] |
| Type | Louvred **Jalousieläden** (2 leaves, folding to the pier) for court buildings; plank Brettläden for farm buildings | [N] |
| Colour | Grey-green or pale grey; farm: dark green or oxblood | [N] |

### 2.4 Doors and portals

| Type | Clear w × h | Form | Tag |
|---|---|---|---|
| `CDL` main portal (vestibule) | 2.0–2.6 × 4.0–4.8 m | Round-arched or straight with Supraporte/relief; reached by a Freitreppe of 5–9 steps | [N]; Freitreppe [D] Wörlitz |
| Garden-side portes-fenêtres | = window width × 3.6–4.0 m | Glazed, two leaves | [N] |
| Interior double door (enfilade) | 1.3–1.6 × 2.8–3.4 m (Beletage) | Paneled, painted + gilt mouldings, Supraporte painting | [N] |
| Interior single door | 0.9–1.0 × 2.2–2.5 m | Paneled; jib doors (Tapetentür) to service | [N] |
| Carriage gate (Remise, Marstall, Torhaus) | 3.0–3.6 × 3.6–4.2 m | Segmental or round-arched, sandstone voussoirs, plank leaves | [N] |
| Barn / farm gate | 3.0–3.6 × 3.5–4.0 m | Segmental arch with keystone carrying a date/monogram | [N]; regional Westrich habit [I] |
| Reithalle end portal | 3.5–4.0 × 4.0–4.5 m | Round-arched, with rider-sized clearance | [N] |

### 2.5 Walls

| Wall | Thickness | Construction | Tag |
|---|---|---|---|
| Cellar / foundation | 1.0–1.5 m | Buntsandstein rubble, barrel vaults (cf. Jägersberg vaults) | [N]; [D] Jägersberg vaults survive |
| `CDL` outer wall, EG | 0.9–1.2 m | Sandstone rubble + lime mortar, **rendered**; ashlar dressings | [N]; K10 |
| `CDL` outer wall, Beletage / Mezz. | 0.75–0.9 m / 0.6–0.75 m | step-back inside | [N] |
| `WING2` outer wall | 0.6–0.8 m | same; upper storey possibly rendered Fachwerk | [N]; Fachwerk [U] |
| `RANGE1` outer wall | 0.55–0.75 m | rubble, rendered | [N] |
| Interior bearing wall | 0.45–0.7 m | rubble or brick | [N] |
| Partitions | 0.12–0.2 m | Fachwerk with clay/brick infill, plastered | [N] |
| Reithalle outer wall | 0.8–1.0 m + pilaster buttresses | to carry the wide roof | [N] |
| Orangerie north wall | 0.9–1.2 m (thermal mass); south: piers only | | [N]; "Pfeilerhalle" + floor-length windows [D K6] |

### 2.6 Facade articulation (profiles and their proportions)

| Element | Dimension | Rule | Tag |
|---|---|---|---|
| Sockel (plinth) | 0.6–1.2 m high (`CDL` up to Souterrain sill), 0.05–0.10 m proud | Buntsandstein ashlar; chamfered or with torus at top | [N] |
| Rustication | `CDL` EG only (often risalit only): **Bandrustika** in render or stone, course height 0.35–0.45 m, joint groove 30–40 mm, horizontal joints only | Louis-seize practice: banded EG, smooth Beletage | [N] |
| Ecklisenen / Lisenen | width 0.6–0.9 m, projection 30–60 mm | At corners and at risalit edges; on long ranges every 3–5 axes | [N]; "continuous cornices and architrave blocks" [D K1] |
| Pilasters (giant order) | width ≈ 1/9–1/10 of their height (Ionic/Corinthian); ≈ 0.9–1.1 m for 9–10 m | `CDL` centre risalit only (cf. Jägersburg pilasters + engaged columns [D]) | [N] |
| Portico / engaged columns | Corinthian or Ionic, 4 (Wörlitz) to 8 (Koblenz, Wilhelmshöhe) columns | Use **4 engaged or free columns** on the `CDL` centre [I]. **[U]** whether Karlsberg had any portico | [D] examples; [U] Karlsberg |
| Gurtgesims (string course) | height 0.25–0.4 m, projection 0.15–0.25 m | At Beletage floor level; continuous across ranges (K1) | [N]; continuity [D K1] |
| Fensterbankgesims (sill band) | 0.15–0.2 m | Beletage | [N] |
| Hauptgesims (main cornice) | height ≈ **1/14–1/18 of eaves height**: `CDL` 0.9–1.1 m; `WING2` 0.6–0.7 m; `RANGE1` 0.45–0.55 m. Projection ≈ 0.8–1.0 × its height | Profile from bottom: architrave fascia (≈ 0.25 h), frieze (≈ 0.3 h, may be plain), cornice with cyma + corona + cyma recta (≈ 0.45 h). "Architrave blocks" = continuous architrave band [D K1] | [N]; [D K1] |
| Attic / balustrade | 0.9–1.1 m; balusters at 0.25–0.3 m centres | `CDL` risalit or roof edge (cf. Jägersburg, Zweibrücken, Wilhelmshöhe vase attics [D]) | [N]; [U] Karlsberg |
| Risalit projection | 0.3–0.8 m | Centre risalit 3 or 5 axes; corner risalits 1–3 axes | [N]; [D] Zweibrücken 2-axis corner risalits |
| Pediment | Rise ≈ 1/5–1/4 of the base width (≈ 20–25°); tympanum with arms or relief | `CDL` centre | [N] |

### 2.7 Roofs

| Parameter | `CDL` (mansard) | `WING2` / `RANGE1` | `STABLE` / `RIDE` / `FARM` | Tag |
|---|---|---|---|---|
| Form | **Mansard** (gebrochenes Dach), hipped at the ends | **Walmdach** or Satteldach with hipped ends at pavilions; "gabled roofs" [D K1] | Satteldach; Krüppelwalm (half-hip) common regionally | [D K1]; others [N] |
| Pitch | Lower slope (Brisis) **70°** (60–75°); upper slope (Terrasson) **30°** (20–35°); break at ≈ 55–65 % of roof height | **40–48°** | Farm 45–52°; Reithalle 35–45° (wide span) | [N] |
| Roof height | Break height ≈ 0.4 × depth/2; total ≈ 0.45–0.55 × depth | ≈ 0.45 × depth | ≈ 0.5 × depth | [D→] from pitch |
| Eaves overhang | Cornice-defined (no rafter overhang) | Cornice-defined | Farm: 0.3–0.5 m rafter overhang | [N] |
| Dormers | `CDL`: one per axis in the Brisis, **segmental or triangular pediment** alternating; w 1.0–1.2, h 1.8–2.2 m; **oeil-de-boeuf** 0.6–0.8 m Ø in the Terrasson (cf. Benrath "Dachbullaugen" [D]) | every axis or every second axis, plain Schleppgaube or small Walmgaube, w 0.8–1.0 | Hay hatches (Ladeluken) 1.2 × 1.5 m; few or no dormers | [N]; Benrath [D] |
| Covering | **Slate** (default) | **[U]**: slate (default for court ranges) vs. **Biberschwanz** tile | **Biberschwanz** red clay tile (double cover) | Benrath slate [D]; Karlsberg [U] |
| Ridge / hips | Lead or zinc ridge; ridge ornaments (vases, finials) at pavilions | Mortar-bedded ridge tiles (Firstziegel) or slate ridge | Firstziegel | [N] |
| Lightning conductors | Iron rods 1.5–3 m on ridges, chimneys, pavilions; down-conductors on corners | **all buildings** | **all buildings** | [D K7] |
| Gutters | Lead/sheet-iron box gutters behind the cornice on `CDL`; half-round iron gutters + downpipes elsewhere; farm: often none | | | [N] |

### 2.8 Chimneys

| Parameter | Value | Tag |
|---|---|---|
| Spacing | 1 stack per 2 heated rooms ≈ every 2–3 axes, on inner walls → just off the ridge line | [N] |
| Section | 0.6 × 1.0–1.6 m (several flues gathered), rendered brick or sandstone | [N] |
| Height above ridge | 1.0–1.5 m (Mansard: above the Terrasson) | [N] |
| Cap | Projecting sandstone cornice cap, 0.15–0.25 m | [N] |
| Kitchens / brewery | Larger stacks 1.2 × 1.6 m+, 2–3 m above roof | [N]; Brauerei, kitchen wings [D K5] |

### 2.9 Materials and colours (exterior)

| Surface | Default | Alternatives / range | Tag |
|---|---|---|---|
| Wall render (court buildings) | **Lime render, white to whitish-grey** (≈ `#ECE8DF`) | pale stone-yellow `#E6D9B8`; pale grey `#D9D9D2` | Orangerie "hell verputzt" [D K6]; Koblenz whitish-grey [D]; Wilhelmshöhe white [D]; Zweibrücken white front [D, modern] |
| Architectural members (Lisenen, Gesimse, surrounds) | **Grey or stone-coloured**, either exposed Buntsandstein or render painted to match: light grey `#BDBAB2` | Exposed **red Buntsandstein** `#A65E4A`–`#B87562`; **yellow-grey Buntsandstein** `#C8B38C` | Koblenz grey members [D]; Zweibrücken sandstone risalits [D]; local stone K10. **Red vs. grey vs. painted [U]** |
| Plinth | Exposed red Buntsandstein | yellow-grey sandstone | [N] + K10 |
| Farm buildings | Lime-washed render, off-white / slightly ochre `#E8DFC8`; sandstone frames | Unrendered rubble on barns | [N] |
| Rustic garden buildings | Rough "bark" render (cf. Schwetzingen Tempel der Botanik [D]), rockwork, tuff | | [D] example |
| Window frames | White / pale grey oil paint | | [N] |
| Shutters | Grey-green `#7D8A78` or pale grey | Farm: dark green `#3F5A3A` | [N] |
| Doors | Oak natural or painted grey / green; state doors painted + gilt | | [N] |
| Metal (balconets, railings, gates) | Wrought iron, painted dark grey-green or black, gilt tips on state railings | | [N] |
| **Do not use** | Strong ochre/yellow + white (19th-c. Prussian/Bavarian taste; Koblenz was later "ochre and blue-red" [D]), Rococo pink (Benrath) | | [D]/[I] |

### 2.10 Stairs

| Parameter | Prunktreppe (`CDL`) | Secondary stair | Service / spiral | Tag |
|---|---|---|---|---|
| Rule | **2R + T ≈ 24 pouces ≈ 65 cm** (Blondel) | same | modern 63 cm | Formula: F. Blondel, 1670s/1683 [D, via [baunetzwissen/search summaries](https://www.baunetzwissen.de/treppen/fachwissen/planungsgrundlagen/steigungsverhaeltnis-167510)]; 24-pouce form [N] |
| Riser R | **13–15 cm** | 15–17 cm | 17–20 cm | [N] |
| Tread T | **36–40 cm** | 31–35 cm | 24–28 cm | [D→] from the rule |
| Flight width | 3.0–4.5 m | 1.5–2.0 m | 0.9–1.2 m | [N] |
| Stair-hall length | **42 m** recorded (dimension meaning [U]) | — | — | [D K3] |
| Configuration | Imperial (one central flight splitting into two) or two-flight "à l'impériale"; landings every 10–14 steps | dog-leg | newel or spiral | [N] |
| Material | Sandstone steps; wrought-iron balustrade with gilt details (Louis-seize) or stone balusters | wood or stone | wood / stone | [N] |
| Freitreppe (exterior) | 5–9 steps, R 14–15 cm, T 38–42 cm, wing walls with balustrade | | | [N] |

### 2.11 Interior rooms (Corps de logis programme)

The state apartments were **on the upper floor of the Corps de logis** [D] (en.wikipedia).
Dimensions are clear interior sizes [N] unless tagged.

| Room | Plan (w × l) | Clear height | Notes | Tag |
|---|---|---|---|---|
| Vestibül | 10–14 × 8–12 m | EG height (4.4–5.0 m) | Column- or pilaster-divided; sandstone flags; leads to the Treppenhaus | [N] |
| Treppenhaus | ≈ 14 × 20 m (stair length per K3 up to 42 m) | through EG + Beletage, 10–12 m | Toplight or high windows | [N]; [D K3] |
| Garde- / Vorsaal | 8–10 × 10–14 m | Beletage 5.0–5.5 m | | [N] |
| Salon / Festsaal | 10–14 × 16–22 m | 7–9 m (through Mezzanine) | Centre of the garden side, portes-fenêtres; Benrath Kuppelsaal [D] as type | [N]; [D] type |
| Enfilade rooms (Antichambre, Audienz, Paradeschlafzimmer) | 7–9 × 8–10 m | 5.0–5.5 m | **Doors in one line, ≈ 1.0–1.5 m from the window wall**; the Paradebett "à la Romaine" [D K4] | [N]; bed [D] |
| Kabinett | 3.5–5 × 4–6 m | 3.5–5.5 m (often with an entresol above) | Private; boiserie | [N]; entresol idea [D] Benrath |
| Garderobe / Dienerraum | 2.5–3.5 × 3–5 m | ½ of the state height | Behind state rooms, jib doors | [D] Benrath ½-height rule |
| Galerie (gallery wing 1788) | **width 6–9 m**, length **[U]** (long; K11); 60–120 m plausible [I] | 6–8 m | Side-lit (high windows one side, wall space for paintings the other) or toplit; parquet | [D K5, K11]; dims [N]/[I] |
| Bibliothek | 8–10 × 15–25 m | 5–7 m, possibly with gallery at 2.5–3 m | Wall-height cases; the library was rescued in 1793 [D Mannlich article] | [N]; location [U] |
| Naturalienkabinett | room sequence of Kabinett size | | documented collection [D schloss-karlsberg.de] | [D]/[N] |
| Kapelle | 8–10 × 12–16 m | 2 storeys with gallery | Wilhelmsthal north wing; Benrath upper floor [D] | [D] examples; Karlsberg [U] |
| Komödienhaus / theatre | 12–15 × 25–30 m | 10–12 m | documented 1783 [D K5]; Schwetzingen Hoftheater as type [D] | [D]/[N] |
| Kitchen (wing) | 10–12 × 15–20 m | 5–6 m, vaulted or open roof, big hearth stack | Detached kitchen + passage (Wörlitz [D]) | [N] |

### 2.12 Interior finishes

| Element | Default (state rooms) | Secondary | Service | Tag |
|---|---|---|---|---|
| Floor | **Tafelparkett** (oak, panels ≈ 1.0–1.1 m square, diagonal "Versailles" pattern) | Fischgrät / straight-board oak | Sandstone flags (Vestibül, Treppenhaus: **0.4–0.6 m squares, diagonally laid, red and grey Buntsandstein alternating**), brick, planks | Benrath parquet [D]; others [N] |
| Walls | **Boiserie** painted white/pearl-grey with gilt mouldings (Louis-seize: rectangular panels, rosettes, laurel, Greek fret) or **silk damask / lampas** panels in frames (crimson, blue, green) | Painted canvas, Chinese papers (cf. Schwetzingen Badhaus [D]) | Lime wash | Benrath silk & panelling [D]; Karlsberg panelling rescued in 1793 [D Mannlich]; Dugourc / Jacob style [D K4] |
| Ceiling | Flat with **stucco cove (Voute) 0.6–1.2 m**, frieze, centre rosette; few painted ceilings in Louis-seize | Flat plastered, simple cornice | Exposed joists / plain | Benrath, Wörlitz stucco [D]; Louis-seize sobriety [N] |
| Heating | **Marble chimneypieces** (cheminée à la française: opening ≈ 1.1–1.3 × 0.9–1.0 m, mantel 1.1 m high) + **mirror (trumeau) above** | **Kachelöfen** (white faience, 1.0 × 0.7 × 2.5–3 m, stoked from the corridor), cast-iron stoves | Hearths | Benrath marble fireplaces [D]; Wörlitz cast-iron stoves [D] |
| Mirrors / lighting | Pier-glasses between windows, crystal chandeliers, girandoles; **gilding** (Knigge, via schloss-karlsberg.de [D]) | | | [D] gilding/mirrors/chandeliers |
| Doors | Double doors, painted + gilt, Supraporte paintings | | | [N] |

### 2.13 Outbuildings

| Template | Plan rules | Section | Facade | Tag |
|---|---|---|---|---|
| `STABLE` Marstall | Double row of stalls along a central aisle: **stall 1.6–1.8 m wide** (box stalls 2.4–3.0 m), **2.8–3.2 m deep**; aisle 2.5–3.5 m → **depth 9–11 m (double row), 6–7 m (single row)**. Tack rooms and grooms' rooms at the ends; feed/hay above | EG 4.0–5.0 m clear (often **vaulted on sandstone piers** in princely stables); Heuboden in the roof with Ladeluken | High stall windows (sill 1.8–2.0 m), lunette or segmental; centre and end portals with pediments | [N]. Scale check: "a stable for **1000 horses**" [D, homburg.de via search]. With a double row at 1.7 m per stall that is ≈ 850 m of stable range [D→]. Treat as several buildings or an exaggeration [I] |
| `RIDE` Reithalle | Ratio ≈ 1 : 2.5–3; clear **15–20 × 40–55 m** | Eaves 8–12 m; wide-span trussed roof (Hängewerk) | High windows (sill > 3 m), end portal, spectators' loge on one end | Vienna Winter Riding School **55 × 18 m, 17 m high** (1729–35) as the upper-bound type [D] ([en.wikipedia](https://en.wikipedia.org/wiki/Spanish_Riding_School)); others [N] |
| `STABLE` Remise | Bays 3.2–3.6 m wide, 6–8 m deep, each with a carriage gate | 4.0–4.5 m | Arcade of segmental arches | [N]; Remisen [D, de.wikipedia caption] |
| `ORANG` Orangerie | **Three-winged** [D]; plant hall 8–12 m deep; **south front ≥ 60 % glazed, floor-length windows** [D]; north wall solid | Over a **high basement** [D]; hall 6–8 m clear; "großer Pfeilersaal" [D] | Light render [D]; piers in the rhythm of the windows (axis ≈ 3.5–4.0 m) | [D K6]; numbers [N] |
| `WING2` Kavaliersbau | 2 storeys, 9–15 axes, double-pile 12–14 m, central corridor; apartments of 2–3 rooms | EG 4.0, OG 3.8 | Lisenen, Gurtgesims, Walmdach | Solitude, Hohenheim (1773), Benrath Kavaliersflügel [D]; numbers [N]. Cellar "Räuberhöhle" [D] |
| Kaserne (from Jägerhaus 1791) | 2 storeys, single- or double-pile, rooms for 8–12 men | 3.2–3.5 m | Plain | [D K5]; [N] |
| `FARM` Karlsberger Hof / Louisenhof / Baumagazin | Dreiflügelhof (dwelling + stable + barn) around a yard [D Louisenhof]; dwelling 10–12 m deep; barn 12–15 m deep with Tenne (threshing floor) and a central gate | Dwelling 2 storeys (3.0–3.3 m); barn eaves 5–6 m | Rendered rubble, sandstone frames, Satteldach 45–52°, Biberschwanz | [D] Louisenhof 3 wings; Baumagazin survives, shortened, with altered roof and a later added storey [D de.wikipedia] → **the 1793 Baumagazin was lower and longer than today** [D→] |
| Menagerie / Fasanerie / Taubenhaus / Bienenhaus / Ananashaus | Small pavilions 4–10 m; Taubenhaus as a tower 4–6 m square, 8–10 m high; Ananashaus = low glasshouse with a sloping glazed south roof and heated flues | | Rustic or neat rendered | [D] these existed (K5); forms [N] |
| Torhaus / Wache | Pair of small pavilions 6–8 m square flanking the entrance | 1 storey | Hipped roof | [D] Torhaus 1782; Wilhelmsthal Wachhäuser by du Ry [D] |
| Eiskeller | Vaulted pit or chamber in a mound, 4–6 m Ø, entrance passage with 2 doors | | Earth-covered | [D] POI 5 in `03-…`; Wilhelmsthal ice cellar [D] |

### 2.14 Garden elements (Schlosspark, Karlslust, Hirschwürzloch)

| Element | Parameters | Tag |
|---|---|---|
| Große Kaskade | **10 steps × 1.5 m high, steps 10 × 10–15 m**; Tosbecken at the foot; Tschifflik pavilion beside it | [D K8] |
| Schwanenweiher | 3 ponds in sequence, fed by the cascade, ending in a tumulus with a niche and a ruin on top | [D K8]; geometry from LiDAR / OSM |
| Bärenzwinger | Ring of **19 half-round cages + loge** around a moat with a square island; from 1778 | [D K8]; dims from LiDAR / OSM way |
| Terraces | Retaining walls of Buntsandstein ashlar 1.5–4 m high, batter 1:10, coping 0.3 m, balustrade or hedge on top; ramps or stairs at 2R+T 65 cm | [N]; Herzogsterrassen 1786 [D, urlaub.saarland via `03-…`] |
| Avenues (Alleen) | **Lime** (*Tilia × europaea / platyphyllos*) default; **horse chestnut** (*Aesculus hippocastanum*) on the Herzogskastanien site (species of "Kastanie" **[U]**: sweet chestnut is possible); spacing **6–8 m in the row**, rows **12–16 m apart** (single carriageway) or 4 rows for main avenues; trees planted at 3–4 m and pleached or clipped in formal parts. **Age in 1793: 5–15 years** (planted after 1778) → crowns 4–8 m high, not mature | [N]; Herzogskastanien [D]; age [D→] from dates |
| Bosquets / hedges | Hornbeam (*Carpinus betulus*) Charmille hedges 2–4 m, clipped; yew (*Taxus*) cones 1.5–3 m | [N] |
| Paths | Gravel (sandstone grit), 3–6 m (park), 8–12 m (avenues); edged with sandstone or turf | [N] |
| Landscape garden (Karlslust) | "English" garden in the former Teufelsloch valley [D]; irregular groves of native beech/oak with exotics (plane, tulip tree, Weymouth pine, larch) [N]; meadows mown | [D] type; species [N] |
| Wildpark / enclosure walls | 2.0–2.5 m rendered rubble walls with coping | [D→] Tschifflik wall 2.5 m [D] |
| Sculptures / vases | Sandstone, painted white or stone-coloured; on pedestals 1.0–1.4 m | [N] |

### 2.15 Example parameter block (for `../model/`)

```yaml
# illustrative defaults; every value carries its evidence tag
unit: { name: pied_du_roi, m: 0.3248, tag: N }
templates:
  CDL:
    storeys: [{name: souterrain, h: 1.6}, {name: eg, h: 5.0}, {name: beletage, h: 6.0}, {name: mezz, h: 3.0}]
    axis: { m: 4.38, tag: "D-> Saarbruecken 65.45/15" }
    depth: { m: 18.0, tag: "D-> Saarbruecken 18.26" }
    window: { eg: [1.30, 2.75], beletage: [1.40, 3.10], mezz: [1.30, 1.25], tag: N }
    roof: { type: mansard, brisis_deg: 70, terrasson_deg: 30, cover: slate, tag: "D K1 (form); N (pitch); U (cover)" }
    render: { color: "#ECE8DF", members: "#BDBAB2", tag: "D Koblenz/Orangerie; U Karlsberg" }
  WING2:
    storeys: [{name: plinth, h: 0.8}, {name: eg, h: 4.2}, {name: og, h: 3.8}]
    axis: { m: 3.75, tag: N }
    roof: { type: hip, pitch_deg: 45, cover: slate_or_tile, tag: "D K1 (gabled); U (cover)" }
    shutters: { type: jalousie, color: "#7D8A78", tag: "D Wilhelmshoehe; I" }
  RANGE1:
    storeys: [{name: plinth, h: 0.6}, {name: eg, h: 5.5}]
    axis: { m: 3.6, tag: N }
    roof: { type: gable_hip_ends, pitch_deg: 42, tag: "D K1; N" }
global:
  eaves_continuous: { value: true, tag: "D K1" }
  lightning_rods: { value: true, tag: "D K7" }
  stair_rule_m: { value: 0.65, tag: "N Blondel 24 pouces" }
```

---

## 3. Realistic rendering hints

### 3.1 PBR material list (metal/roughness workflow, three.js `MeshStandardMaterial` / `MeshPhysicalMaterial`)

Albedo values are suggested linear-safe sRGB starting points. Tune them against photos of the comparables
and of local Buntsandstein. Texture sources: CC0 sets from Poly Haven / ambientCG (see download requests).

| Material | Albedo (sRGB) | Roughness | Normal / height | Other | Use |
|---|---|---|---|---|---|
| Lime render, fresh | `#ECE8DF` ± 3 % noise | 0.90–0.95 | low-freq trowel bumps, 0.5 mm | grime gradient at plinth and under sills; AO | `CDL`, `WING2`, Orangerie |
| Lime render, weathered (farm) | `#E3D9C4` | 0.92 | coarser | algae streaks below cornices | `FARM` |
| Red Buntsandstein ashlar | `#A65E4A`–`#B87562` (bedding streaks, Liesegang bands) | 0.80–0.88 | tooled surface (Scharrierung, parallel 2–3 mm grooves) | joint mask 5–8 mm, lime mortar `#D8D0C0` | plinths, surrounds, steps, terraces |
| Yellow-grey Buntsandstein | `#C8B38C` | 0.82 | same | | alternative dressings |
| Sandstone flags (interior) | red / grey alternate | 0.6 (worn, polished paths) – 0.8 | wear dips | | Vestibül, Treppenhaus |
| Slate, rectangular French cover | `#4B5057` with per-tile variation ± 8 % | 0.55–0.70 (wet: 0.25) | tile edges, 4–6 mm | slight anisotropy optional | mansards, court roofs |
| Biberschwanz clay tile | `#9C4A30`–`#B5653F`, per-tile variation, moss on the north slope | 0.75–0.85 | rounded tails, 12 mm | | farm, stables, Reithalle |
| Lead / zinc flashing | `#7E848A` | 0.45–0.55 | — | metallic 1.0 (lead dull: 0.8) | ridges, gutters, dormer cheeks |
| Wrought iron, painted | `#2F3A33` | 0.5 | — | metallic 0 (paint) | balconets, railings, gates, lightning rods (bare iron: metallic 1, roughness 0.6, rust tint) |
| Window glass (crown) | transmission tint `#E9F2EA` | 0.03–0.08 | **per-pane slight normal distortion** (waviness) | IOR 1.52; env-map reflections dominate from outside; interiors dark | all windows |
| Window frames / Sprossen | `#EFECE6` | 0.45 (oil paint) | — | | |
| Shutters (painted wood) | `#7D8A78` | 0.6 | louvre geometry or normal map | | `WING2`, `RANGE1`, `FARM` |
| Gilding | `#D4AF37` | 0.25–0.35 | — | metallic 1.0 | interior mouldings, railing tips, finials |
| Oak parquet, waxed | `#9B7448` | 0.30–0.40 (clearcoat 0.3) | board joints | | state floors |
| Boiserie, painted | `#F1EFE8` / pearl grey `#DCDDD8` | 0.5 | panel mouldings (geometry for LOD0) | gilt line mask | state rooms |
| Silk damask | crimson `#8E1F2A`, blue `#3E5A7E`, green `#4F6B48` | 0.55 | woven pattern normal | `sheen` 0.5–0.8 (MeshPhysicalMaterial) | wall panels, curtains |
| White marble | `#F2F0EC` | 0.15–0.25 | — | slight subsurface (fake via `transmission` off, `sheen` off) | chimneypieces |
| Stucco | `#F4F2EC` | 0.85 | relief normal | | ceilings |
| Gravel path | `#C8BFAE` (sandstone grit, warm) | 0.95 | pebble height | | paths, courts |
| Water (ponds, basins) | deep `#2A3A35` | 0.02–0.1 | animated normal | planar reflection, Fresnel; shallow edge tint | Weiher, Kaskade |

### 3.2 Vegetation and forest context

- **Two time slices.** (a) **1790 state**: the park is young (avenues 5–15 years old), the hill is
  partly cleared, meadows and gardens are open, and a beech forest frames the site (the hill was
  called **Buchenberg** [D]). (b) **Today**: mixed beech/oak forest with conifers over the ruins,
  which can be taken from the LiDAR canopy (`../../research/03-…`). The viewer should switch
  between them [I].
- **Species palette (1790)** [N]: *Fagus sylvatica* (forest), *Quercus robur/petraea*, *Tilia*
  (avenues), *Aesculus hippocastanum*, *Carpinus betulus* (hedges, bosquets), *Taxus baccata*
  (clipped), *Pinus sylvestris* on the sandy Binnendünen around the Karlsbergweiher (a "Binnendünen"
  walk exists today [D, ich-geh-wandern.de title]), plus exotics in the Karlslust (*Platanus*,
  *Liriodendron*, *Pinus strobus*, *Larix*).
- **Rendering:** instanced impostors/billboards for the far forest, low-poly crowns with alpha cards
  near the camera, wind sway in the vertex shader, and clipped hedges as true geometry (box/cone
  with leaf-noise normal map). Tree positions for the 1790 avenues are procedural along the axis
  polylines at 6–8 m spacing, with ±0.3 m jitter.

### 3.3 Lighting

- **Sky and sun:** physical sky (three.js `Sky` / Preetham) with the sun from the real date and time at
  49.336 N, 7.378 E. Default: **late afternoon in June 1790**, sun ≈ 25–30° high from the WSW, which
  rakes the long fronts and shows the cornices.
- **Tonemapping:** ACES Filmic or AgX, exposure ≈ 1.0, sRGB output. **IBL** from a CC0 overcast/clear HDRI
  of the same sun angle, with a blurred environment for render and slate.
- **Shadows:** cascaded shadow maps (CSM) for the 1.25 km frontage. Bake AO and lightmaps for the static
  buildings, because cornice and window-reveal AO is what makes plain render read as architecture.
- **Atmosphere:** distance fog / aerial perspective (blue-grey haze beyond 1 km). Light morning-mist
  option over the Weiher.
- **Interiors:** daylight through the windows (bake or light probes); a **candle / chandelier mode at
  1800–2000 K** with flicker for "walk in at night". Mirrors with planar or cube reflections in
  the Spiegel rooms.
- **Wear:** rain-streak and soot decals under cornices, splash-back grime 0.3–0.5 m at the plinth,
  moss on north roof slopes. Keep it subtle: the residence was **at most 15 years old** in 1793 [D→].

### 3.4 Level of detail (practical)

| LOD | Distance | Content |
|---|---|---|
| LOD3 | > 800 m | Extruded massing + roof shape, baked facade colour, no openings |
| LOD2 | 200–800 m | Window/door openings as texture (atlas), cornice as one profile sweep |
| LOD1 | 30–200 m | Real window reveals (depth 0.3–0.6 m = wall thickness − frame), profiled cornices, dormers, chimneys, shutters |
| LOD0 | < 30 m / interior | Sprossen geometry, surrounds, balustrades, interior rooms, furniture proxies |

---

## 4. Open points and verification list

1. **Check every grammar default against the LeClerc watercolour (1790) and the Herdegen "Vue de
   Carlsberg" (1791)**: axis counts, number of storeys per range, roof forms, dormers, colour.
2. **Read Schwan 2010** (*Studien zur Baugeschichte von Schloss Carlsberg*, Neustadt/Wstr.; it
   draws on the "Bericht den dermaligen Zustand des sämtlichen Carlsberger Bauwesens betreffend")
   and **Schwan 2012** (*Burgen und Schlösser* 4/2012). They will contain Bauakten with real
   dimensions in Fuß, materials (slate or tile, Fachwerk or masonry) and colours.
3. **Weber 1987** (*Schloss Karlsberg. Legende und Wirklichkeit*, 607 pp., 428 ill.) and
   **R. Schneider 1988** (pp. 448–453) for the building descriptions K1–K3.
4. **schloss-carlsberg.de** (the site with Tschifflik plans; 401 in this session). Find out who runs it
   and what plan material it has.
5. Karlsberg furniture and boiserie now in **Munich / Bamberg / Würzburg** collections: an interior
   style source.
6. Field photos of the **Pettersheim Wirtschaftshof**, the **Karlsberger Hof / Baumagazin** and the
   Orangerie ruin. They give real Buntsandstein colour, tooling and opening sizes.
7. Read **Minoti Paul 2009** (Ludwigsberg) for the regional garden-building repertoire.
8. Local length unit (Zweibrücker Werkschuh?) and its value.

## 5. Sources consulted (2026-11-01)

Wikipedia texts are CC BY-SA 4.0. Images on these pages carry their own Commons licences.
- de.wikipedia: [Schloss Karlsberg](https://de.wikipedia.org/wiki/Schloss_Karlsberg) · [Schloss Zweibrücken](https://de.wikipedia.org/wiki/Schloss_Zweibr%C3%BCcken) · [Schloss Jägersburg (Homburg)](https://de.wikipedia.org/wiki/Schloss_J%C3%A4gersburg_(Homburg)) · [Schloss Pettersheim](https://de.wikipedia.org/wiki/Schloss_Pettersheim) · [Tschifflik](https://de.wikipedia.org/wiki/Tschifflik) · [J. C. von Mannlich](https://de.wikipedia.org/wiki/Johann_Christian_von_Mannlich) · [Saarbrücker Schloss](https://de.wikipedia.org/wiki/Saarbr%C3%BCcker_Schloss) · [Schloss Jägersberg](https://de.wikipedia.org/wiki/Schloss_J%C3%A4gersberg) · [Schloss Schwetzingen](https://de.wikipedia.org/wiki/Schloss_Schwetzingen) · [Schloss Benrath](https://de.wikipedia.org/wiki/Schloss_Benrath) · [Schloss Solitude](https://de.wikipedia.org/wiki/Schloss_Solitude) · [Schloss Hohenheim](https://de.wikipedia.org/wiki/Schloss_Hohenheim) · [Seeschloss Monrepos](https://de.wikipedia.org/wiki/Seeschloss_Monrepos) · [Schloss Wilhelmsthal (Calden)](https://de.wikipedia.org/wiki/Schloss_Wilhelmsthal_(Calden)) · [Schloss Wilhelmshöhe](https://de.wikipedia.org/wiki/Schloss_Wilhelmsh%C3%B6he) · [Schloss Wörlitz](https://de.wikipedia.org/wiki/Schloss_W%C3%B6rlitz) · [Kurfürstliches Schloss Koblenz](https://de.wikipedia.org/wiki/Kurf%C3%BCrstliches_Schloss_Koblenz)
- en.wikipedia: [Karlsberg Castle](https://en.wikipedia.org/wiki/Karlsberg_Castle) · [Mannheim Palace](https://en.wikipedia.org/wiki/Mannheim_Palace) · [Benrath Palace](https://en.wikipedia.org/wiki/Benrath_Palace) · [Hameau de la Reine](https://en.wikipedia.org/wiki/Hameau_de_la_Reine) · [Spanish Riding School](https://en.wikipedia.org/wiki/Spanish_Riding_School) · [Hohenburg Castle (wikiwand)](https://www.wikiwand.com/en/Hohenburg_Castle_(Homburg))
- Karlsberg web: [schloss-karlsberg.de](https://schloss-karlsberg.de/schloss-karlsberg/) (KB-Stiftung Karlsberger Hof; images by H. Lau and of a model, no licence stated) · [lapinvoyageur.de](https://lapinvoyageur.de/2020/06/18/schloss-karlsberg/) · [rosalux.de](https://www.rosalux.de/news/id/692/der-karlsberg-von-barocker-pracht-zur-baustoffhandlung) · [Rheinpfalz 2019](https://www.rheinpfalz.de/startseite_artikel,-eulengezwitscher-verr%C3%A4t-geheimnisse-von-schloss-karlsberg-_arid,1382324.html)
- Literature (not read, cited by the sources above): J. Schwan, *Studien zur Baugeschichte von Schloss Carlsberg*, Neustadt/Wstr. 2010 · J. Schwan, "Schloss Carlsberg bei Homburg-Saar – die Wiederentdeckung eines Wittelsbacherschlosses", *Burgen und Schlösser* 4/2012 · W. Weber, *Schloss Karlsberg. Legende und Wirklichkeit*, Homburg 1987 · R. Schneider, *Burgen und Schlösser an der Saar*, 1988 · M. Paul, *Der Ludwigsberg*, Saarbrücken 2009 · J. C. von Mannlich, *Rokoko und Revolution* (memoirs) · S. Lietz, *Das Fenster des Barock*, 1982 · J.-F. Blondel, *Cours d'architecture*, 1771–77.
