# 09 — Building practice 1770s–1790s: how a princely residence was built and finished

> Research date: 2026-11-02. Scope: how princely residences in south-west Germany (Pfalz-Zweibrücken, Kurpfalz,
> Nassau-Saarbrücken, with French/Lorraine influence) were **built and finished** around 1775–1795, and what that means
> for the Karlsberg 1789 model: construction, facade vocabulary, interiors, site works, and the Karlsberg building
> process itself. The doc ends with concrete parameter rules and the files they map to (§6).
>
> **What this adds.** 01 §2.2–2.4 and §3 hold the Karlsberg facts; 02 §2.3–2.12 hold the design grammar, mostly as
> unchecked period norms [N]; 06 §3.2 and 07 §1 hold what the HMS film and the period views show. This doc
> (a) documents the **people and process** behind the Karlsberg site (Schäfer, Krutthofen, Hautt's 1785 report),
> (b) replaces several [N] colour/material defaults with **documented comparables** (Koblenz 1998 finish, Ludwigskirche,
> Herzogvorstadt, Mannheim, Benrath, Schwetzingen, Hemmer lightning rods), and (c) turns this into rules for the
> generator. It does not repeat 02's dimension tables; it points to them.
>
> **Method and limits.** WebSearch/WebFetch only; nothing downloaded into the repo. Blocked again in this session:
> schloss-carlsberg.de (HTTP 401), the Heidelberg journals (Anubis bot protection; *Burgen und Schlösser* 4/2012,
> *Denkmalpflege in Baden-Württemberg*), HathiTrust (403, Mannlich's memoirs). The key print sources (Schwan 2010,
> Weber 1987, Lohmeyer 1957, Lietz 1982, Langer 1995, Güse 1989) were **not** read; they are listed in §7 with what
> each should settle. Many "how it was done" points are therefore still period norms.
>
> **Evidence tags** (as in 02/05): **D** documented (URL given) · **D→** documented elsewhere and transferred, or
> derived arithmetically · **I** inferred (reasoning stated) · **N** period norm, not checked against a primary
> source · **U** unknown · **HMS** read from the HMS 2022 film (© Matzerath / Historisches Museum Saar,
> reference only).
>
> Heritage note: the site is a protected monument (SDschG Saarland). Nothing here is excavation or find-spot
> guidance; all locations named are the published ones from 01/03/07.

---

## 0. Key findings (short)

1. **Karlsberg was run as a fast, under-supervised building site, and a contemporary said so.** Building was
   entrusted to a **Polier and store-keeper, Franz Georg Schäfer**. In **1785** the recalled Baudirektor
   **Christian Ludwig Hautt** wrote a **"vernichtendes Gutachten über die Bau-Zustände auf dem Karlsberg"** (a damning
   report on the building conditions), blaming Schäfer and Kammerpräsident von Creutzer. **Johann Leonhard Krutthofen**
   (b. 1752) took over the site management from Schäfer in 1785. In **1788** Hautt became Hofbaudirektor again and
   Mannlich had to give up the building department. [D NDB, Medding 1969](https://www.deutsche-biographie.de/sfz28384.html).
   de.wikipedia says Hautt's main task at Karlsberg was **fixing defects** ([D](https://de.wikipedia.org/wiki/Christian_Ludwig_Hautt)).
2. **The designer was a painter.** Mannlich trained as a painter (Mannheim academy, Paris) and ran the Bauwesen as
   Generalbaudirektor ([D](https://de.wikipedia.org/wiki/Johann_Christian_von_Mannlich)). Execution lay with a foreman.
   **[I]** This is the strongest documented argument for the **plain, repetitive facades** that en.wikipedia
   (Schneider 1988) and the HMS model show: standard bays, render over rubble or Fachwerk, few carved stone parts.
3. **Timber framing is documented, not just assumed.** The 1793 fire hit "die Gebäude, die aus Holz (Fachwerk) waren"
   ([D de.wikipedia](https://de.wikipedia.org/wiki/Schloss_Karlsberg)). The buildings at the foot of the hill survived.
4. **Material was recycled at scale.** Building material, panelling, furniture and "a complete stable" came from
   **Jägersburg** ([D schloss-karlsberg.de](https://schloss-karlsberg.de/schloss-karlsberg/)). The 1782 plan to move all of
   Jägersburg was dropped **for cost** ([D](https://de.wikipedia.org/wiki/Schloss_J%C3%A4gersburg_(Homburg))). "The first
   conversions proved too small", so more material followed (schloss-karlsberg.de). The duke went into debt for it.
5. **Facade colour of the closest exact contemporary is documented.** The Koblenz Kurfürstliches Schloss (1777–93,
   French early classicism) was returned in **1998** to its 18th-century finish: **"Weißgrau für die Wandflächen und
   Grau für die Architekturglieder"** ([D](https://de.wikipedia.org/wiki/Kurf%C3%BCrstliches_Schloss_Koblenz)). Stengel's
   Ludwigskirche in Saarbrücken (1762–75) lost its render and **"weiße Außenfarbe"** after 1793 ([D](https://de.wikipedia.org/wiki/Ludwigsplatz_(Saarbr%C3%BCcken))).
   Le Clerc 1790 shows pale render with grey/pinkish dressings (07 §1.1). → **White-grey walls, grey members** is now
   [D→], not [N].
6. **What not to copy.** Kurpfalz Baroque **Mannheim** today has **dark-red members on yellow walls** (2005–07
   restoration) ([D](https://de.wikipedia.org/wiki/Schloss_Mannheim)); **Benrath** gleamed in **"Altrosa"** ([D](https://de.wikipedia.org/wiki/Schloss_Benrath)).
   Both are Baroque/Rococo schemes. They are not evidence for a Louis-seize residence of the 1780s.
7. **Hautt's own Zweibrücken idiom is documented:** the Herzogvorstadt (1760–75) has "**vornehm schlichte Häuser mit
   Lisenengliederung, Balkonen und Mansarddächern**", Putzbauten ([D](https://de.wikipedia.org/wiki/Liste_der_Kulturdenkm%C3%A4ler_in_Zweibr%C3%BCcken-Stadtmitte)).
   Mannlich's own house there (Herzogstraße 8) is a "fünfachsiger Putzbau". This is the local vocabulary the Karlsberg
   crew knew: render, Lisenen, iron balconies, mansards.
8. **Lightning rods were a Kurpfalz/Pfalz speciality.** Elector Carl Theodor ordered in **February 1776** that all
   palaces and powder towers get rods. **Hemmer's "Fünfstern"** went onto Schwetzingen on **17 July 1776** and survives.
   Over **150** south-German buildings had Hemmer rods ([D SSG press release 2026](https://www.schloesser-und-gaerten.de/fileadmin/Presse/pressemeldungen/37_schwetzingen_2026/ssg_schloss-schwetzingen_pm_blitzableiter_260717.pdf)).
   Hemmer was born in Horbach near Waldfischbach, 30 km from Karlsberg. Karlsberg "sämtliche Schlossgebäude" had rods
   ([D](https://schloss-karlsberg.de/schloss-karlsberg/)).
9. **Shutters: blue-grey is the period colour.** In Klassizismus, shutters were "**meist weiße, hellgraue oder
   blaugraue**" ([D→ Baunetz](https://www.baunetzwissen.de/fenster-und-tueren/fachwissen/zubehoer/fensterlaeden-7415947)),
   and HMS shows blue-grey to navy (06 §3.2). The current model default `#5E665B` (dark grey-green) is weaker evidence.
10. **Windows: French croisée, not Galgenfenster.** Two-leaf casements closing on a meeting stile with an espagnolette
    are 18th-century practice ([D Baunetz](https://www.baunetzwissen.de/glossar/e/espagnolette-9852611)). The T-shaped
    Galgenfenster only spread at the end of the 19th century ([D Baunetz](https://www.baunetzwissen.de/fenster-und-tueren/fachwissen/fensterarten/galgenfenster-10401550)).
    Window joinery in Klassizismus is predominantly **grey and white** ([D→ Uni Bamberg](https://www.uni-bamberg.de/restaurierungswissenschaft/forschung/forschungsprojekte/architekturfarbigkeit/)).
11. **Interiors: Paris and Lyon, dated.** Georges Jacob delivered a carved giltwood seating suite on **5 March 1782**;
    two bergères stood in **antechamber no. 8**, before the "**Apparat du Souverain**"; 14 seats survive in the Bavarian
    palace administration ([D Redding, citing Langer 1995](https://www.richardreddingantiques.com/artworks/9831-georges-jacob-an-louis-xvi-grand-canape-by-georges-jacob-paris-date-circa-1781-82/)).
    Jacob also supplied **Vertäfelungen, Tapetenleisten, Türblätter**; wall hangings and covers were **Lyon silk or
    multicoloured damask** ([D](https://de.wikipedia.org/wiki/Schloss_Karlsberg)). Dugourc, Mannlich's co-designer,
    drew for **Camille Pernon's Lyon silk manufactory 1774–1790** ([D](https://fr.wikipedia.org/wiki/Jean-D%C3%A9mosth%C3%A8ne_Dugourc)).
    A **Gelber Salon** is documented (01 §3.1); the model has no yellow silk.
12. **Model consequences (detail in §6):** keep the exteriors plain but make them *read* as 1780s:
    - blue-grey shutters;
    - class-aware glazing grids;
    - white-grey render that varies slightly by building age;
    - grey painted members on the Fachwerk/upper parts, real sandstone only at plinths, corners and portals;
    - Hemmer five-point rods;
    - slate (blue-grey) on the palace and red Biberschwanz on the service town;
    - Ehrenhof grille with gilt tips;
    - Wittelsbach-striped sentry boxes;
    - Tapetenleisten frames around silk panels, a yellow salon, and parquet de Versailles in the state rooms.

---

## 1. The Karlsberg building process (task 5)

### 1.1 People

| Person | Role at Karlsberg | Dates | Evidence |
|---|---|---|---|
| **Karl II. August** | Builder; "extravagant wishes"; went into debt | r. 1775–95 | [D schloss-karlsberg.de](https://schloss-karlsberg.de/schloss-karlsberg/) |
| **Johann Christian (von) Mannlich** | Generalbaudirektor and lead architect; a **painter** by training (Mannheim drawing academy, Paris); designed much of the furniture himself | Director from 1776 (NDB) until 1788 | [D de.wikipedia](https://de.wikipedia.org/wiki/Johann_Christian_von_Mannlich); [D NDB Hautt](https://www.deutsche-biographie.de/sfz28384.html) |
| **Jean-Démosthène Dugourc** | Interior designs with Mannlich; arabesque and "goût étrusque"; drew for Pernon's Lyon silks 1774–90 | 1780s | [D de.wikipedia Karlsberg](https://de.wikipedia.org/wiki/Schloss_Karlsberg); [D fr.wikipedia](https://fr.wikipedia.org/wiki/Jean-D%C3%A9mosth%C3%A8ne_Dugourc) |
| **Franz Georg Schäfer** | "Polier und Magazinverwalter" (foreman and store-keeper), entrusted with the Bauwesen on the Karlsberg | until 1785 | [D NDB](https://www.deutsche-biographie.de/sfz28384.html) |
| **Johann Leonhard Krutthofen** | Baumeister; site management (Bauleitung) after Schäfer | b. 1752; from 1785 | [D NDB](https://www.deutsche-biographie.de/sfz28384.html); [D NDB index](https://www.deutsche-biographie.de/sfz46473.html). Detail in Lohmeyer 1957, pp. 241 ff. [U, not read] |
| **Christian Ludwig Hautt** | Baudirektor of Christian IV (Jägersburg, Herzogvorstadt). Dismissed 1775/76, worked in Blieskastel, recalled 1780. **1782 new plans for Schloss Karlsberg; 1785 damning report; 1788 Hofbaudirektor again** and completion of Karlsberg, mainly fixing defects | 1726–1806 | [D NDB](https://www.deutsche-biographie.de/sfz28384.html); [D de.wikipedia](https://de.wikipedia.org/wiki/Christian_Ludwig_Hautt). Conflict: dismissal 1775 (de.wp) vs 1776 (NDB) |
| **von Creutzer** | Kammerpräsident; blamed with Schäfer for mismanagement "zum Schaden des Staates" | 1785 | [D NDB](https://www.deutsche-biographie.de/sfz28384.html) |
| **Johann Ludwig Petri** | Court gardener (Hofgärtnerei 1780–82) | | 01 §1.2; Schwan 2014 (§7) |

### 1.2 Process, speed, money and quality

- **Parallel building.** "Several buildings were constructed at the same time" (en.wikipedia/Schneider 1988). The
  timetable in 01 §1.2 shows 6–10 sites open at once in 1779–1785. [D]
- **Incremental growth.** "Da die ersten Umbauten sich als zu klein erwiesen, wurden in den Folgejahren weitere
  Baumaterialien … gebracht" ([D schloss-karlsberg.de](https://schloss-karlsberg.de/schloss-karlsberg/)). The palace
  was never finished. [D]
- **Recycled fabric.** Building parts, panelling and furniture came from Jägersburg ([D](https://de.wikipedia.org/wiki/Schloss_J%C3%A4gersburg_(Homburg))),
  plus "a complete stable" (schloss-karlsberg.de). Hohenburg fortress stone was quarried for Karlsberg (02 K10). [D]
- **Logistics.** The **Baumagazin** (today the Karlsberger Hof) at the foot of the hill was the "Baumagazin und
  Materiallager mit Wohnungen" ([D](https://schloss-karlsberg.de/schloss-karlsberg/)). PV 1791 lists it as "Le grand
  magasin avec ses logemens" (07 Appendix B). [D]
- **Labour cost scale.** "A journeyman had to work two days to earn one Gulden" ([D en.wikipedia](https://en.wikipedia.org/wiki/Karlsberg_Castle)). [D]
- **Quality.** Hautt's 1785 report and his 1788 task of fixing defects (above) are the only documented quality
  judgement found. [D] Its content (which defects) is **[U]**. It should be in the Landesarchiv Speyer Zweibrücken holdings
  or in Drumm 1953 / Lohmeyer 1957 [U].
- **Afterlife.** After 1793 the ruin became a "preisgünstige Baustoffhandlung" for Homburg ([D rosalux](https://www.rosalux.de/news/id/692/der-karlsberg-von-barocker-pracht-zur-baustoffhandlung)).
  That is why so little dressed stone survives. **[I]** This also means the surviving ruin walls (Orangerie, cellars) are
  biased toward rubble cores, so they understate how much Haustein there once was.

### 1.3 What the process implies visually [I unless tagged]

1. **Standard bays, repeated.** A foreman-run site that grows by additions repeats one bay type. The HMS counts (21, 19 and
   12 identical axes, 08 §1) fit this. **Rule:** one window/surround/shutter type per building class. Richness only at the
   CdL centre, the B02 head pavilion (LC portico) and the junction portico (HMS).
2. **Render, not stone.** Rubble walls and Fachwerk parts were rendered and limewashed. Lisenen, cornices and window
   bands were partly **run in render and painted** grey or stone colour instead of cut in Haustein. This is cheap and
   fast, and it matches "continuous cornices and architrave blocks" (Schneider 1988).
   - Monochrome stone-coloured finishes over all members were normal for important Herrschaftsbauten ([D→ Uni Bamberg](https://www.uni-bamberg.de/restaurierungswissenschaft/forschung/forschungsprojekte/architekturfarbigkeit/)).
3. **Fachwerk where speed mattered.** The candidates are upper storeys and roofs of the long wings, the gallery wing
   (1788, the last and most rushed), Dachreiter and lanterns, the Wachhäuser, and much of the service town.
   - Masonry is likelier for the cellared parts (B02 cellars, Kavaliersbau "Räuberhöhle", Orangerie basement),
     because those remains survive.
   - Model rule: no visible Fachwerk on court buildings (fully rendered); exposed, limewashed Fachwerk only as an
     option on farm and service buildings below the plateau.
4. **Unrendered rubble panels at gates (HMS).** HMS shows Durchfahrten set in panels of exposed rubble (06 §3.2).
   **[I]** Read these as deliberate rustic portal panels (a cheap stand-in for rustication) or as unfinished work. Either way
   they are documented in HMS only. Keep them as an HMS variant.
5. **Mixed stone colours.** Recycled Jägersburg and Hohenburg stone plus local quarries give a mix of red, yellow-grey
   and white-grey sandstone. Where stone shows (plinths, corner quoins, portal surrounds), vary the hue per block.
   Do not use one uniform red.
6. **Uneven finish quality.** Some walls would be fresh limewash (1785–88 work), others weathered 10 years (1778–82 work),
   so the renders should vary by building date. Dated per building in the catalogue (01 §1.2).

---

## 2. Construction (task 1)

### 2.1 Foundations and cellars

| Item | Practice | Tag |
|---|---|---|
| Foundations | Strip foundations of Buntsandstein rubble in lime mortar, ≈ 1.0–1.5 m wide under main walls; footings stepped 10–15 cm per side | [N] (02 §2.5) |
| Cellars | Barrel vaults of rubble or roughly squared sandstone; brick or flagged floors; cellar windows one per axis in the plinth (HMS) | Jägersberg vaults survive [D 02 §1B]; B02/Kavaliersbau cellars [D 01/03]; HMS 06 §3.2 |
| Damp | Sandstone plinth course, slightly projecting; drained gravel against cellar walls | [N] |

### 2.2 Masonry: Bruchstein and Haustein

- **Local stone.** The Homburg Schlossberg caves are cut in Middle Buntsandstein with **yellow, red and yellow-red**
  colouring ([D Saarpfalz tourism/geocache summaries](https://www.ich-geh-wandern.de/schlossberghöhlen-homburg)).
  The Orangerie ruin shows reddish sandstone masonry (01 §2.4). [D]
- **Split.** Rubble (Bruchstein) cores, rendered. Dressed Haustein only for plinth courses, corner quoins (Eckquader /
  Ecklisenen), door and gate surrounds, cornice blocks on the CdL, steps and copings. [N; Karlsberg I]
- **Bond in quoins.** Alternating long and short blocks (Läufer/Binder) ≈ 0.30–0.40 m course height. [N] At Karlsberg,
  HMS shows "stone corner strips (Ecklisenen)" at wing ends (06 §3.2): a flat ashlar strip rather than projecting quoins.

### 2.3 Fachwerk behind render

- **Documented at Karlsberg:** the fire hit the Fachwerk buildings ([D](https://de.wikipedia.org/wiki/Schloss_Karlsberg)).
  How many buildings, and which, is **[U]** (Schwan 2010).
- **Period practice.** Rendered Fachwerk dwellings of the 18th century are common in the Pfalz (example: a "nun verputztes
  Fachwerk-Wohnhaus wohl des 18. Jh." in Schifferstadt, [museum-digital RLP](https://rlp.museum-digital.de/pdf/object/13632.pdf?lang=de),
  seen as a search summary) [D, weak].
  - On exposed Fachwerk, **monochrome** finishes (timbers and infill in one colour) are documented from the early 18th
    century ([D Uni Bamberg](https://www.uni-bamberg.de/restaurierungswissenschaft/forschung/forschungsprojekte/architekturfarbigkeit/)).
- **Construction.**
  - Oak sills on a sandstone plinth, oak or softwood posts at ≈ 0.9–1.2 m.
  - Infill of clay-straw on staves, or brick.
  - Lath and lime render over the whole face, 20–30 mm. [N]
  - A rendered Fachwerk storey is **thinner** (0.25–0.35 m) than a rubble one (0.6–0.8 m). From outside, the only tell
    is shallower window reveals. [N]
- **Model rule:** where a building or storey is flagged `fachwerk`, use a 0.30 m wall and 0.12–0.15 m reveals, and the
  same render. [I]

### 2.4 Lime render and limewash

| Item | Practice | Tag |
|---|---|---|
| Render | Lime render (Kalkputz), 2 coats ≈ 15–25 mm, smoothed with a float (Glattputz). **Not** scratched or patterned; the surface follows the rubble slightly (gentle undulation) | [N] |
| Finish | Limewash (Kalkanstrich, Kalktünche), several thin coats, renewed every few years. Slightly translucent, chalky-matt, streaky; patches of a fresher coat; green-grey algae and dirt streaks below sills and cornices after a few winters | [N] |
| Pigment | Lime white with earth pigments (ochre, umber, lamp black) for off-whites, greys and "stone colour" | [N] |
| Members | Lisenen, bands and cornices **in render**, painted grey or stone colour; or exposed sandstone, limewashed over with the member colour | [D→ Koblenz 1998; Bamberg "monochrom, zumeist steinfarben"]; Karlsberg [I] |

### 2.5 Colour evidence from comparable buildings

| Building | Date | Finding | Use for Karlsberg | Tag |
|---|---|---|---|---|
| **Koblenz, Kurfürstliches Schloss** (Peyre, d'Ixnard; French early classicism) | 1777–93 | 1998 back to the 18th-c. scheme: **white-grey walls, grey members**; before that ochre and blue-red (Prussian) | **Primary model**: exact contemporary, French designers | [D](https://de.wikipedia.org/wiki/Kurf%C3%BCrstliches_Schloss_Koblenz) |
| **Saarbrücken, Ludwigskirche** (Stengel) | 1762–75 | Lost "Verputz und weiße Außenfarbe" after 1793; lead gutter lining behind the parapet stolen | White exterior in the neighbouring principality; lead gutters | [D](https://de.wikipedia.org/wiki/Ludwigsplatz_(Saarbr%C3%BCcken)) |
| Saarbrücken, Ludwigsplatz palais (Stengel) | from 1762 | "white palais" in a Saarbrücken city text, seen only as a search summary; not verified | Same | [U, unverified] |
| **Zweibrücken, Herzogvorstadt** (Hautt) | 1760–75 | Putzbauten; "vornehm schlichte Häuser mit Lisenengliederung, Balkonen und Mansarddächern"; Mannlich-Haus a 5-axis Putzbau | Local house style of the Karlsberg builders | [D](https://de.wikipedia.org/wiki/Liste_der_Kulturdenkm%C3%A4ler_in_Zweibr%C3%BCcken-Stadtmitte) |
| Zweibrücken, Schloss (Sundahl; rebuilt 1962–64) | 1720–25 | Today a white window front between sandstone-coloured corner risalits | Colour logic "white field + stone-coloured risalits"; modern state | [D modern, 02 §1A] |
| Blieskastel, Orangerie | built by 1670, 12 axes (5 survive), 2 storeys | No colour evidence found (a search summary repeated the ADAC text for Zweibrücken; discarded) | Not usable yet | [U] |
| **Mannheim, Schloss** | 1720–60 | 2005–07: dark-red members, yellow walls; "Farbgebend ist … der Buntsandstein" | **Do not use** (Baroque Kurpfalz) | [D](https://de.wikipedia.org/wiki/Schloss_Mannheim) |
| **Benrath** (Pigage) | 1755–73 | "Altrosa"; slate mansard; "Dachbullaugen" | **Do not use** the pink. Slate mansard: yes | [D](https://de.wikipedia.org/wiki/Schloss_Benrath) |
| Schwetzingen | 1748–95 | Zirkelbauten are Werksteinbauten; Tempel der Botanik with "Rauputz nach Art von Eichenrinde"; wrought-iron gate partly gilded | Rustic garden render; gilt gate tips | [D](https://de.wikipedia.org/wiki/Schloss_Schwetzingen) |
| Wilhelmshöhe | 1786–98 | White finish, glazing bars, shutters | Already in 02 §1E | [D 02] |
| **Karlsberg, Le Clerc 1790** | 1790 | Pale render (cream to light grey), grey/pinkish stone dressings, dark slate roofs, dark iron grille | **Direct evidence** | [D 07 §1.1] |
| **Karlsberg, Pleine vue 1791** | 1791 | White-grey walls; **blue (slate) roofs on the palace group, red (tile) on service buildings** | Direct evidence for the roof split | [D 07 §1.1] |

**Result.** Walls are off-white to white-grey limewash, and members are grey, either painted or grey/yellow-grey
sandstone. Exposed red Buntsandstein shows only where it was not painted: plinths, and where LC's "pinkish" dressings
suggest it, portals and corners. [D→ Koblenz, LC, PV; I for the split]

### 2.6 Roof structures

| Roof | Structure | Tag |
|---|---|---|
| **Mansard** (CdL and Ehrenhof wings, 07 C1) | Mansard truss with a **liegender Stuhl** (raked queen-post frame) in the lower storey and a collar-beam rafter roof (Kehlbalkendach) above. Tie beam = attic floor. Spans 16–19 m for double-pile wings need the liegender Stuhl plus collar beams; the attic floor is usable (dormers per axis) | [N]; mansards in Germany from c. 1670, standard in Hautt's Herzogvorstadt [D→] |
| Walm / Satteldach (service ranges, Orangerie) | Rafter roof with collar beams; liegender Stuhl for spans > 10 m | [N] |
| Reithalle | Hängewerk (king-post or queen-post truss) for ≈ 15–20 m clear span | [N] (02 §2.13) |
| Dachreiter, lanterns | Timber, clad in lead or sheet metal (or slate), painted | [N]; Dachreiter [D LC, HMS] |
| Flat top of the mansard (HMS "flat light deck") | Lead or sheet-iron flat (Plattform) where the Terrasson is cut flat; Jägersburg and Zweibrücken had flat roofs | [HMS]; flat roofs [D Jägersburg](https://de.wikipedia.org/wiki/Schloss_J%C3%A4gersburg_(Homburg)) |

### 2.7 Roof covering

| Item | Value | Tag |
|---|---|---|
| Palace group | **Slate**, blue-grey (PV "blue", LC "dark slate"). Source most likely Moselschiefer: the name dates from 1588 and covered slate from Mayen, Polch, Müllenbach and Trier shipped on the Mosel ([D Baunetz/Rathscheck](https://www.baunetzwissen.de/schiefer/fachwissen/schieferarten/moselschiefer-1131909)). Laid as **altdeutsche Deckung** (stones of varying size in descending courses; standard for German castles and palaces) or as French rectangular slates on the mansard [N/U] | Roof colour [D 07]; origin [I]; pattern [N] |
| Service town, farm and valley buildings | **Red clay Biberschwanz**, south-German format ≈ **38 × 18 cm**, double cover, laid **unmortared** ([D dewiki Biberschwanz](https://dewiki.de/Lexikon/Biberschwanz)). Visible course at batten gauge ≈ **15 cm** [D→ modern gauge 14.5–16.5 cm]. Rounded tails | Red roofs [D PV, HMS]; format [D] |
| Ridges and hips | Slate: lead or slate ridge rolls. Tile: mortar-bedded ridge tiles (Firstziegel) | [N] |
| Flats, gutters, valleys | Lead sheet (the Ludwigskirche parapet gutter was lead-lined) | [D Ludwigskirche] |

### 2.8 Gutters, downpipes, chimneys, lightning rods

- **Gutters.** Two types:
  - Court buildings: a box gutter behind or on top of the main cornice, lead-lined, discharging through a few
    downpipes at the corners and next to risalits.
  - Farm buildings: half-round hanging gutters of sheet iron, or none (drip eaves). [N; lead lining D Ludwigskirche]
  - **Model:** cast-iron/lead-grey downpipes, Ø 0.10–0.12 m, one per 15–20 m of eaves, with a hopper head under the
    cornice. [N]
- **Chimneys.** These are covered by 02 §2.8 and `CHIMNEY` in grammar.ts. HMS shows plain rendered stacks with caps,
  ≈ every 2 axes. [HMS]
- **Lightning rods.**
  - Elector Carl Theodor ordered rods for **all palaces and powder towers** in Feb 1776, after lightning destroyed the
    Schwetzingen Marstall and (1764) hit Heidelberg castle.
  - The Schwetzingen rod was fitted **17 July 1776**; Mannheim followed in 1783 ([D SSG](https://www.schloesser-und-gaerten.de/fileadmin/Presse/pressemeldungen/37_schwetzingen_2026/ssg_schloss-schwetzingen_pm_blitzableiter_260717.pdf)).
  - The head is Hemmer's **"Fünfstern"/"Fünfspitz"**: five points. Originals survive on Schwetzingen palace, the Untere
    Wasserwerk tower and the two Moschee minarets (the minaret ones carry crescents). [D]
  - Hemmer published installation rules in 1786 (*Anleitung, Wetterleiter an allen Gattungen von Gebäuden … anzulegen*)
    ([D Wikipedia](https://de.wikipedia.org/wiki/Johann_Jakob_Hemmer)).
  - Karlsberg: every palace building had rods ([D](https://schloss-karlsberg.de/schloss-karlsberg/)); HMS caption names
    "Hemmer'sche Fünfspitzen" (06 §3.2).
  - Geometry **[N/U]**: an iron mast ≈ 2–4 m above the ridge or chimney; a head of one vertical point plus four points
    in a cross, gilded or copper tips; an iron down-conductor bar (≈ 15–20 mm square) on brackets, down a corner to the
    ground. Check the form against Schwetzingen photos before modelling the head in detail.

---

## 3. Facade vocabulary (task 2)

### 3.1 Windows and joinery

| Item | Practice 1775–1790 | Tag |
|---|---|---|
| Type | **French casement (croisée à la française)**: two inward-opening leaves, no fixed central mullion. The leaves close on a moulded meeting stile, held by an **espagnolette** (turning rod with hooks) | Espagnolette in France by the late 17th c., in use "mindestens seit dem 18. Jahrhundert" [D Baunetz](https://www.baunetzwissen.de/glossar/e/espagnolette-9852611); BABS window guide (rod locks from the 18th c.) [D, search summary] |
| Transom | A transom (Kämpfer) with a fixed or opening top light (Oberlicht) on tall windows (≥ 2.6 m), at ≈ ¾ height. Older stone **Kreuzstock** windows survived on re-used Louisenhof/Jägersburg parts [I] | [N] (02 §2.3) |
| Not | **Galgenfenster** (T-mullion): "Ende des 19. Jahrhunderts" ([D Baunetz](https://www.baunetzwissen.de/fenster-und-tueren/fachwissen/fensterarten/galgenfenster-10401550)). The LOD1 "one mullion + transom" in facade.ts reads as a Kreuzstock or Galgenfenster from afar | [D] |
| Glass | Blown flat glass: in German lands mostly **cylinder (Walzen-) glass**, with crown glass in the West/England. Slight green-grey tint, faint waviness, seeds/bubbles; each pane reflects at a slightly different angle. Glass was made regionally (Warndt glassworks; Karlsbrunn "Spiegelhütten und Glasmanufactur", chartered 1717, ran 1717–1809) | Regional glassworks [D en.wikipedia Warndt](https://en.wikipedia.org/wiki/Warndt); Karlsbrunn [D, single source: G. Krebs, memotransfront Uni Saarland, via search]; glass type [N] |
| Pane size | Crown panes were limited (≈ 22 in./0.56 m in an 1835 guide, i.e. under the disc radius); hence glazing bars [D, UK conservation guides, later than 1780]. **Default panes 0.25–0.45 m wide × 0.32–0.55 m tall, upright (h/w 1.1–1.4)**. Larger panes (≈ 0.45–0.55 m wide, 1 per leaf) on the CdL state floor [N]. HMS reads ≈ **2 panes wide per leaf × 4 high** on the wing windows (06 §3.2) | [N]; [HMS] |
| Glazing bars | Wood, 25–35 mm, ovolo or lamb's-tongue moulded. Bars became slimmer toward 1800 | [N]; slimming [D, UK] |
| Frame colour | **White or pale grey** oil paint; "im Klassizismus … scheinen grau und weiß zu dominieren" (windows) | [D→ Uni Bamberg](https://www.uni-bamberg.de/restaurierungswissenschaft/forschung/forschungsprojekte/architekturfarbigkeit/); HMS white frames |
| Reference | Lietz, *Das Fenster des Barock* (1982) covers windows of princely buildings 1680–1780 | [D bibliographic, not read] |

### 3.2 Shutters (Klappläden)

- **Type.** Two-leaf louvred **Jalousieläden** on court buildings; plank (Brett-) shutters on farm buildings. Fixed open
  against the pier with iron shutter dogs (Ladenhalter). [N; HMS shutters on every window]
- **Colour.** Klassizismus preferred "**weiße, hellgraue oder blaugraue**" shutters ([D→ Baunetz](https://www.baunetzwissen.de/fenster-und-tueren/fachwissen/zubehoer/fensterlaeden-7415947)).
  - HMS shows blue-grey to dark navy (06 §3.2).
  - Green is the generic "classic", and red/green are common in vernacular buildings ([D Aargau Fachblatt](https://www.ag.ch/media/kanton-aargau/bks/kultur/denkmalpflege/bksdp-fachblatt-5a.pdf)).
  - → **Blue-grey on court buildings, green or oxblood on farm buildings.** [D→ + HMS]

### 3.3 Doors and portals

- **Main doors.** Wooden double leaves with raised-and-fielded panels and a **fanlight with radiating bars** above the
  transom (HMS). Doors painted stone grey or pale grey to match the joinery on court buildings. [HMS; colour N]
- **Durchfahrten.** Round-arched (HMS) carriage passages with plank leaves (dark green or oxblood on service buildings
  [N]) and **Prellsteine** (bollards) at the jambs (HMS). Plastered passages with flat ceilings (HMS 06 §3.3).
- **Freitreppen.** Sandstone, 5 steps (CdL) and ≈ 10–12 steps (B02 head, LC), with iron railings. [D LC/HMS]

### 3.4 Members: Gesimse, Lisenen, Eckquaderung, Verdachungen

| Element | Karlsberg rule | Tag |
|---|---|---|
| Hauptgesims | One continuous main cornice at one height across the palace group (HMS ≈ 11.2 m above the court) | [D Schneider 1988 "continuous cornices"]; [HMS 08] |
| "Architrave blocks" | Read as a plain architrave fascia under the cornice (Architravband), continuous. Possibly also plain block-like window lintels | [D en.wp wording]; reading [I] |
| Lisenen / Eckquaderung | **Corner strips only** on the wings (HMS); Lisenen articulating the risalits on the CdL and the B02 head. Hautt's Herzogvorstadt houses use Lisenengliederung | [HMS]; [D Herzogvorstadt] |
| Gurtgesims | **None** on the wings (HMS); optional on the CdL centre | [HMS] |
| Window surrounds | Plain flat band 0.18–0.22 m, painted grey or of grey sandstone, flat or slightly segmental head, **no Verdachungen** on the wings. Pediments and Verdachungen only on CdL centre axes, if at all | [HMS]; [N 02 §2.3] |
| Pediments | Orangerie centre risalit (HMS); CdL centre [U] | [HMS] |

### 3.5 Balconies and ironwork

- **Where.** Balconies on the B02 head (LC portico balcony), the D/C junction portico (HMS), the wing-centre balconies
  (porcelain plate, 07 §1.1) and, in Hautt's Zweibrücken, as a standard element. [D]
- **Design.** Wrought iron, Louis-seize: straight bars, simple rings or ovals, a Greek-key or guilloche frieze, and a flat
  top rail ≈ 1.0 m. [N]
- **Colour.** Wrought iron painted dark (black-grey, blue-grey or dark green). On state gates, partial gilding: the
  Schwetzingen gate is "schmiedeeisern, teilvergoldet" ([D](https://de.wikipedia.org/wiki/Schloss_Schwetzingen)). The LC
  grille is dark (07). → Dark blue-grey iron, with gilt tips and crests on the Ehrenhof gate only. [D→]

### 3.6 Dormers, oculi, weather vanes

Covered by 06 §3.2, 08 and `DORMER` in grammar.ts. HMS: white-framed dormers with shutters, segmental or straight heads,
one per axis; oculi every 2nd axis; **weather vanes** with N/O/S/W letters and a pennant. [HMS]

### 3.7 Paint schedule (exterior)

| Surface | Colour | Tag |
|---|---|---|
| Wall render, court buildings | White-grey limewash `#E9E7E0` (range `#EDE6D8` warm, older → `#E6E6E2` cool, newer) | [D→ Koblenz, LC, PV]; per-age split [I] |
| Members (painted render or limewashed stone) | Grey `#B9B8B2`; LC variant grey-pink `#BFAEA5` for portal and corner dressings | [D→ Koblenz]; [D LC hue] |
| Exposed sandstone (plinth, steps, quoins) | Mixed red `#A65E4A`, yellow-grey `#C8B38C`, grey-white `#CFC8BA`, varied per block | [D local stone]; [I mix] |
| Window frames, glazing bars, dormer frames | White / pale grey `#E9E6DE` | [D→ Bamberg; HMS] |
| Shutters, court buildings | Blue-grey `#5F6F7A` (light variant `#8796A0`) | [D→ Baunetz; HMS] |
| Shutters and gates, farm and service buildings | Green `#3F5A3A` or oxblood `#6E2E26` | [N] |
| Doors, court buildings | Pale grey `#CFCBC2` | [N] |
| Ironwork | Dark blue-grey `#2E3439`; gilt `#C9A24A` on the Ehrenhof gate tips only | [D→ Schwetzingen, LC] |
| Roof, palace group | Blue-grey slate `#4A525C` | [D PV "blue"] |
| Roof, service town | Red Biberschwanz `#A8573A` with ±8 % per-tile variation | [D PV/HMS] |

---

## 4. Interiors (task 3)

### 4.1 What is documented for Karlsberg

| Item | Content | Tag |
|---|---|---|
| Designers | Mannlich and Dugourc (Dugourc: arabesques and goût étrusque; designs for Pernon's Lyon silks 1774–90) | [D de.wp; fr.wp] |
| Joinery | Jacob: carved and gilded seating, plus **Vertäfelungen, Tapetenleisten, Türblätter** | [D de.wp](https://de.wikipedia.org/wiki/Schloss_Karlsberg) |
| Textiles | "Stofftapeten und Möbelbezüge aus Seide oder mehrfarbigen Damasten … in Lyon gefertigt" | [D de.wp] |
| Dated suite | Jacob suite delivered **5 March 1782**; 14 seats now in the Bayerische Schlösserverwaltung; 2 bergères stood in **antechamber no. 8**, before the "**Apparat du Souverain**". (The canapé's red velvet is a later cover [U]) | [D Redding, citing Langer 1995 no. 46](https://www.richardreddingantiques.com/artworks/9831-georges-jacob-an-louis-xvi-grand-canape-by-georges-jacob-paris-date-circa-1781-82/) |
| Rooms | Schlafzimmer + Schreibkabinett, **Gelber Salon** + Schreibkabinett (EG), furniture "Paris c. 1781" | [D 01 §3.1, room-guide snippets] |
| State bed | Lit à la romaine in the Paradeschlafzimmer | [D 01 §3.1] |
| Effect | "Reichthum der … Vergoldungen, Spiegel, Kronleuchter" (Knigge) | [D schloss-karlsberg.de] |
| Rescue | Mannlich and Deurer saved panelling, furniture, paintings and the library in 1793 | [D de.wp Mannlich] |
| Catalogue | Güse (ed.), *Kunstschätze aus Schloss Carlsberg*, 1989 | [D bibliographic, not read] |

### 4.2 Louis-seize state-room finish (period practice)

| Element | Practice | Tag |
|---|---|---|
| Wall system | Either **(a) boiserie**: painted panelling (white, pearl or "gris" grey) with gilt mouldings, rectangular panels with straight frames, rosettes, laurel, Greek fret, oval medallions. Or **(b) silk or damask** stretched in panels framed by gilt **Tapetenleisten** above a painted wooden dado (lambris d'appui ≈ 0.8–1.0 m). Karlsberg had both (Vertäfelungen *and* Tapetenleisten) | [D Karlsberg items]; forms [N] |
| Doors | Double doors with painted and gilt panels; **Supraporte** above (painting in a gilt frame or a carved relief) | [N] |
| Chimneypiece | Marble cheminée à la française, opening ≈ 1.1–1.3 × 0.9 m, mantel ≈ 1.1 m, with a **trumeau mirror** above. Neoclassical marble surrounds were in Kurpfalz palaces by 1767 (Mannheim, Pozzi) | [D Mannheim](https://de.wikipedia.org/wiki/Schloss_Mannheim); Benrath marble [D]; dims [N] |
| Stoves | Kachelöfen of white faience in antechambers and service-side rooms, stoked from the service corridor. Regional faience works existed (Niderviller, founded 1735/1754, near Lorraine; Strasbourg) | Manufactories [D, search summaries]; stove use [N] |
| Ceiling | Flat, with a **cove (voussure)** and a stucco cornice, frieze and centre rosette; few painted ceilings in Louis-seize. Koblenz employed a court stuccoist (Henckel) | [D Koblenz]; [N] |
| Floor | **Parquet de Versailles / à compartiments**: square panels of waxed oak, laid diagonally, ≈ 1 m (≈ 3 pieds) square. Benrath, Mannheim (Franz Zeller) and Schwetzingen (three-wood inlaid parquet in the Badhaus) are regional examples. Fischgrat or straight boards in secondary rooms | Pattern and oak [D marcmaison](https://www.marcmaison.com/architectural-antiques-resources/versailles-parquet-floor); regional [D]; size [N] |
| Mirrors | Pier-glasses between windows, trumeaux over chimneypieces, mirrored panels in cabinets | [D Knigge]; [N] |
| Lighting | Crystal chandeliers, gilt-bronze wall lights (bras de lumière), girandoles; candlelight only | [D Knigge]; [N] |
| Colours | White and gold boiserie; silks in **crimson, blue, green and yellow** (the Gelber Salon); "goût étrusque" accents (terracotta and black) in cabinets [I from Dugourc] | [D yellow]; others [N] |

### 4.3 Service and private interiors

Lime-washed plaster, plank floors, plain moulded doors painted grey, and tiled stoves. The kitchen (Küchenbau): sandstone
flags, a vaulted or open roof, a large hearth hood. This is already in `FIN` (scripts/catalogue-v2/programme.ts). [N]

---

## 5. Site works (task 4)

| Item | Practice / evidence | Tag |
|---|---|---|
| Ehrenhof surface | Level, gravelled or cobbled (HMS: no parterre, fountain or statue). Period norm: rolled sandstone gravel over the field, with **cobbled carriage lanes** (Katzenkopf) to the portals and sandstone **gutters (Rinnen)** along the walls | [HMS 06 §3.4]; [N] |
| Grille | Wrought-iron **grille with gate piers and a central gate** across the court (LC 1790, porcelain plate). Line [U] | [D 07 §1.1] |
| Retaining walls | The plate shows a retaining wall in front of the court; the B10 basement front is a retaining wall (fix round 1). Sandstone rubble or ashlar, batter ≈ 1:10, copings 0.3 m | [D 07]; [N 02 §2.14] |
| Ramps | The Marstall ramp survives ([D Commons](https://commons.wikimedia.org/wiki/File:Karlsberg_Reithalle_01.jpg)); ramps at ≤ 1:10 for carriages | [D]; [N] |
| Guard | "Grand corps de garde devant le Château" (PV); LP06 28 Wachhäuser at the court mouth; **sentry boxes with blue-white diagonal stripes** and domed caps at the portals (HMS) | [D 07]; [HMS] |
| Lanterns | Oil lanterns on wall brackets at portals and on posts along the approach [N/U]. Not shown in LC/HMS. Optional night layer | [N/U] |
| Water | Water conduit 1778–80; Lambsborn aqueduct of **1600 toises (≈ 3.1 km)** into a **basin at the great stables**; a "fontaine par machine" feeding the kitchen and barracks (PV legend) | [D 07 §1.1] |
| Garden walls, fences | White-plastered walls with coping; **iron hoop fence (Bogenzaun)** with arched trellises around the terrace garden; low white fences on the W front of D | [HMS 06 §3.7] |
| Orangerie forecourt | Citrus in square tubs (Kübel) on gravel | [HMS 06 §3.5] |
| Bollards | Prellsteine at gate jambs | [HMS] |

---

## 6. Implications for the model

Each rule names the file it maps to. "Change" means it changes an existing value; "add" means new. Values are defaults;
the tag says how firm they are.

### 6.1 `model/src/layout/grammar.ts` (period norms only)

| # | Rule | Value | Tag | Kind |
|---|---|---|---|---|
| G1 | **Glazing grid per class** (new table `GLAZING`, read by `exterior/cut.ts glazingGrid`): panes per leaf and target pane height | CDL upper: 1 per leaf, pane h ≈ 0.55 m. CDL ground, WING2, RANGE1, ORANG: **2 per leaf**, h/w ≈ 1.3 (pane ≈ 0.25 × 0.33 m on a 1.2 m window). STABLE/FARM: 2 per leaf, 3–4 rows | [HMS 2 × 4]; [N] | add (today: one rule, ≈ 0.42 × 0.48 m, i.e. 1 pane per leaf everywhere) |
| G2 | Glazing bar width | 0.03 m (court), 0.035 m (farm) | [N] | add |
| G3 | Transom (Kämpfer) only on windows ≥ 2.6 m, at 0.75 h; **no fixed central mullion** (meeting stile 0.06 m instead) | | [D Baunetz espagnolette / Galgenfenster] | change (LOD1 mullion should read as a meeting stile) |
| G4 | Fachwerk wall | thickness 0.30 m, reveal 0.12–0.15 m, used where a storey/building is flagged `fachwerk` | [D Fachwerk at Karlsberg]; [N] | add |
| G5 | Downpipes | Ø 0.11 m, one per ≤ 18 m of eaves, at corners and risalit edges, hopper under the cornice | [N] | add |
| G6 | Lightning rod | mast 3.0 m above ridge or chimney, Ø 0.03 m; head of 1 + 4 points (0.4 m arms); down-conductor 0.02 m at one corner per building | Rods [D]; Fünfstern [D name]; geometry [N/U] | add/adjust (facade.ts draws rods at LOD2 today) |
| G7 | Surround on wings | flat band 0.20 m, projection 0.03 m, **no Verdachung**; Verdachung only on CDL centre axes | [HMS]; [N] | change (tighten) |
| G8 | Ecklisene on wings | 0.6 m, projection 0.02 m (flat strip, not quoins) | [HMS] | change (0.75/0.04 now) |
| G9 | Gurtgesims | none on WING2/RANGE1; optional on CDL | [HMS] | confirm |
| G10 | Biberschwanz course | 0.15 m visible; tile 0.18 × 0.38 m | [D format] | add (for roof UV/texture scale) |
| G11 | Sentry box | 1.0 × 1.0 m, 2.4 m high + domed cap 0.5 m | [HMS]; [N] | add |
| G12 | Parquet panel | 0.97 m (3 pieds) square, diagonal | [N]; pattern [D] | add (interior) |

### 6.2 `model/src/materials/index.ts` (and `interior/materials.ts` fallback)

| # | Material | Change | Tag |
|---|---|---|---|
| M1 | `wood.shutter` | `#7D8A78` → **blue-grey `#5F6F7A`**. The catalogue default `#5E665B` changes too (C3) | [D→ Baunetz; HMS] |
| M2 | `roof.slate` | `#4B5057` → bluer **`#4A525C`** | [D PV "blue"] |
| M3 | `render.lime` | keep `#ECE8DF`, add a per-building **limewash variation** (luminance ±3 %, warm/cool by building date). Add a subtle vertical streak/dirt mask under sills and cornices (detail map or vertex AO) | [N]; [I] |
| M4 | new `render.member` | painted render for Lisenen, bands and surrounds: `#B9B8B2`, roughness 0.9, render normal (not ashlar) | [D→ Koblenz]; [I] |
| M5 | `stone.*` | per-block hue jitter between red, yellow-grey and grey-white for exposed quoins and plinths (vertex colour) | [I] (recycled stone) |
| M6 | `glass.crown` | tint toward green-grey (`#22302C`); a per-pane normal/rotation jitter (≈ 0.5–1.5°) so the panes catch light differently ("wow" at low sun) | [N] |
| M7 | `metal.iron` | `#2B2D30` → `#2E3439` (blue-grey black) | [N]; LC dark |
| M8 | new `wall.silk.yellow` | `#C9A94E`, for the Gelber Salon | [D room name]; hue [I] |
| M9 | new `textile.stripe` (or vertex colour) | blue/white for sentry boxes | [HMS] |

### 6.3 `model/src/exterior` (facade.ts, roof.ts, index.ts)

| # | Rule | Tag |
|---|---|---|
| E1 | Window frames as croisée: two leaves + meeting stile; transom only on tall windows; glazing from `GLAZING` (G1–G3) | [D] |
| E2 | Shutters louvred on court buildings, plank on farm buildings; shutter dogs (small iron S-hooks) at LOD2 | [N]; HMS |
| E3 | Downpipes + hopper heads (G5), lead/iron grey | [N] |
| E4 | Hemmer rods with five-point heads at LOD2 (G6); on ridges, Dachreiter and kitchen stacks | [D] |
| E5 | Weather vanes (N/O/S/W letters + pennant) on the CdL Dachreiter and pavilion roofs | [HMS] |
| E6 | Exposed rubble panels around Durchfahrten as an HMS variant (`facade.portal_panel: 'rubble'`) | [HMS] |
| E7 | Members drawn with `render.member` on wings; `stone.*` only for plinth, corner strips (optional), portals and steps | [I] |
| E8 | Roof covering split: slate on the palace group (CdL, B02–B06, Orangerie); red Biberschwanz on service and valley buildings. Check catalogue `roof.covering` per building against this | [D PV/HMS] |
| E9 | Mansard top as a flat lead deck (light grey `roof.lead`) where `upper pitch < 10°` | [HMS] |

### 6.4 `model/src/interior` (programme.ts, fixtures.ts, furniture.ts)

| # | Rule | Tag |
|---|---|---|
| I1 | Silk/damask walls get **gilt Tapetenleisten** (0.05 m gilt fillet) around each panel, above a painted dado 0.9 m high | [D Tapetenleisten]; [N dado] |
| I2 | Boiserie rooms: white/pearl-grey panels with gilt mouldings (gilt only on the innermost moulding) | [N]; [D gilding] |
| I3 | Supraporte over every enfilade double door in state rooms: a framed painting field ≈ door width × 0.8–1.0 m | [N] |
| I4 | Floors: state rooms parquet de Versailles (G12, diagonal); secondary rooms Fischgrat; service planks; halls diagonal sandstone flags | [D pattern]; [N] |
| I5 | Fireplace + trumeau in salons and bedrooms; white faience Kachelofen in antechambers (already in fixtures.ts; keep) | [N]; [D regional faience] |
| I6 | Antechamber no. 8 → "Apparat du Souverain": tag the room before the Herzog's state apartment as Antichambre with 2 bergères + a seating set (Jacob 1782) | [D Redding/Langer] |
| I7 | Chandelier + 2–4 wall lights per state room; candle emissive only (no electric look) | [D Knigge]; [N] |

### 6.5 Catalogue builder (`scripts/catalogue-v2/`: buildings.ts, programme.ts, pipeline.ts)

| # | Change | Tag |
|---|---|---|
| C1 | Add `facade.fachwerk` flags (G4). Candidates: gallery wing (1788), Wachhäuser, Dachreiter, upper storeys of service ranges. Keep B02/B04 cellared parts and the Orangerie masonry | [D Fachwerk exists]; selection [I] |
| C2 | Add `facade.build_year` (from 01 §1.2) to drive the limewash age (M3) | [D dates] |
| C3 | Palace defaults: `shutter_colour` `#5E665B` → `#5F6F7A`; tag "D→ Baunetz Klassizismus blaugrau; HMS blue-grey" | [D→] |
| C4 | Palace defaults: `members_colour` `#BDBAB2` → `#B9B8B2` as **painted render** (`members_material: 'render.member'`). LC grey-pink `#BFAEA5` for portals and the B02 head | [D→ Koblenz; D LC] |
| C5 | Programme: add a `yellow` finish (`wall.silk.yellow`) and give it to the Gelber Salon (EG). Name the antechamber before the duke's state apartment "Antichambre (Nr. 8)" with a `D` tag | [D] |
| C6 | Site: Ehrenhof gravel with cobbled lanes to the CdL and both Durchfahrten; sandstone gutters; Prellsteine at portals; 2 sentry boxes per portal (CdL + arms) plus LP06 28 Wachhäuser | [HMS]; [D 07] |
| C7 | Site: basin at the Marstall (Lambsborn aqueduct end) and a pump fountain in the Küchenhof | [D PV legend] |
| C8 | Sources: add the NDB Hautt entry, Koblenz, Herzogvorstadt, SSG Hemmer and Redding/Langer to `SRC` so the viewer can show them | — |

### 6.6 "Wow" without inventing

The following raise the visual quality **and** are period-correct:
- low sun on the varied crown glass (M6) and blue-grey slate;
- a limewash that is subtly patchy, with streaks under sills (M3);
- blue-grey shutters against white-grey walls;
- gilt gate tips and five-point rods catching light;
- striped sentry boxes;
- the red-roofed service town beyond the blue-roofed palace (the PV colour code);
- inside: gilt Tapetenleisten, a yellow salon, diagonal parquet reflecting chandeliers.

None of these needs new evidence, only the rules above.

---

## 7. Open questions and sources to get

| Question | Where it should be answered |
|---|---|
| Which Karlsberg buildings/storeys were Fachwerk; wall build-ups; quarries | Schwan 2010 (*Studien zur Baugeschichte von Schloss Carlsberg*); Weber 1987 |
| Content of Hautt's 1785 Gutachten (which defects) | Drumm, *Pfälz. Heimatbll.* 1 (1953) 12, p. 92; Lohmeyer in Dahl/Lohmeyer, *Das barocke Zweibrücken*, ²1957, pp. 187 ff. (Krutthofen pp. 241 ff.); Rübel 1914; Medding, *Mitt. Hist. Ver. Pfalz* 53 (1955) — all via the NDB entry |
| Render and member colours at Karlsberg; slate vs. tile per building | Le Clerc 1790 at full resolution; Schwan 2010; any Befund on the Orangerie ruin |
| Window pane sizes and shutter type in the 1780s Pfalz | Lietz, *Das Fenster des Barock* (1982); surviving Herzogvorstadt windows (Zweibrücken) |
| Hemmer Fünfstern geometry | Hemmer 1786 *Anleitung*; photos of the Schwetzingen originals |
| Room colours and panelling now in Munich/Bamberg | Langer 1995 (*Die Möbel der Residenz München*); Güse (ed.) 1989; Bayerische Schlösserverwaltung inventory |
| Mannlich's own account of the building campaign | Mannlich, *Rokoko und Revolution*, ed. Stollreither 1913 (HathiTrust, blocked here); *Histoire de ma vie* 1989–93 |

---

## 8. Sources consulted (2026-11-02)

**Karlsberg and its builders**
- Medding, W.: "Hautt, Christian Ludwig", *NDB* 8 (1969), pp. 133 f. — https://www.deutsche-biographie.de/sfz28384.html
- Deutsche Biographie index "Krutthofen, Johann Leonhard" — https://www.deutsche-biographie.de/sfz46473.html
- de.wikipedia "Christian Ludwig Hautt" — https://de.wikipedia.org/wiki/Christian_Ludwig_Hautt
- de.wikipedia "Johann Christian von Mannlich" — https://de.wikipedia.org/wiki/Johann_Christian_von_Mannlich
- de.wikipedia "Schloss Karlsberg" (incl. literature list) — https://de.wikipedia.org/wiki/Schloss_Karlsberg
- en.wikipedia "Karlsberg Castle" (citing Schneider 1988) — https://en.wikipedia.org/wiki/Karlsberg_Castle
- schloss-karlsberg.de "Schloss Karlsberg" — https://schloss-karlsberg.de/schloss-karlsberg/
- de.wikipedia "Schloss Jägersburg (Homburg)" — https://de.wikipedia.org/wiki/Schloss_J%C3%A4gersburg_(Homburg)
- Rosa-Luxemburg-Stiftung 2015 — https://www.rosalux.de/news/id/692/der-karlsberg-von-barocker-pracht-zur-baustoffhandlung
- Richard Redding Antiques, Jacob canapé c. 1781–82 (citing Langer 1995) — https://www.richardreddingantiques.com/artworks/9831-georges-jacob-an-louis-xvi-grand-canape-by-georges-jacob-paris-date-circa-1781-82/
- fr.wikipedia "Jean-Démosthène Dugourc" — https://fr.wikipedia.org/wiki/Jean-D%C3%A9mosth%C3%A8ne_Dugourc
- Online Books Page, Mannlich editions — https://onlinebooks.library.upenn.edu/webbin/who/Mannlich%2c%20Johann%20Christian%20von%2c%201741%2d1822

**Comparables**
- de.wikipedia "Kurfürstliches Schloss Koblenz" — https://de.wikipedia.org/wiki/Kurf%C3%BCrstliches_Schloss_Koblenz
- de.wikipedia "Ludwigsplatz (Saarbrücken)" — https://de.wikipedia.org/wiki/Ludwigsplatz_(Saarbr%C3%BCcken)
- de.wikipedia "Liste der Kulturdenkmäler in Zweibrücken-Stadtmitte" — https://de.wikipedia.org/wiki/Liste_der_Kulturdenkm%C3%A4ler_in_Zweibr%C3%BCcken-Stadtmitte
- de.wikipedia "Schloss Mannheim" — https://de.wikipedia.org/wiki/Schloss_Mannheim
- de.wikipedia "Schloss Benrath" — https://de.wikipedia.org/wiki/Schloss_Benrath
- de.wikipedia "Schloss Schwetzingen" — https://de.wikipedia.org/wiki/Schloss_Schwetzingen
- Staatliche Schlösser und Gärten BW, press release "Vom Blitzschlag zur Erfindung" (13 Jul 2026) — https://www.schloesser-und-gaerten.de/fileadmin/Presse/pressemeldungen/37_schwetzingen_2026/ssg_schloss-schwetzingen_pm_blitzableiter_260717.pdf
- de.wikipedia "Johann Jakob Hemmer" — https://de.wikipedia.org/wiki/Johann_Jakob_Hemmer

**Building practice**
- Universität Bamberg, research project "Architekturfarbigkeit" — https://www.uni-bamberg.de/restaurierungswissenschaft/forschung/forschungsprojekte/architekturfarbigkeit/
- Baunetz Wissen: Fensterläden — https://www.baunetzwissen.de/fenster-und-tueren/fachwissen/zubehoer/fensterlaeden-7415947 ; Galgenfenster — https://www.baunetzwissen.de/fenster-und-tueren/fachwissen/fensterarten/galgenfenster-10401550 ; Espagnolette — https://www.baunetzwissen.de/glossar/e/espagnolette-9852611 ; Moselschiefer — https://www.baunetzwissen.de/schiefer/fachwissen/schieferarten/moselschiefer-1131909 ; Mansarddach — https://www.baunetzwissen.de/glossar/m/mansarddach-46285
- Kanton Aargau Denkmalpflege, Fachblatt Fensterläden — https://www.ag.ch/media/kanton-aargau/bks/kultur/denkmalpflege/bksdp-fachblatt-5a.pdf
- dewiki "Biberschwanz" — https://dewiki.de/Lexikon/Biberschwanz
- Marc Maison, "Versailles parquet floor" — https://www.marcmaison.com/architectural-antiques-resources/versailles-parquet-floor
- en.wikipedia "Warndt" — https://en.wikipedia.org/wiki/Warndt

**Bibliography (not read; for follow-up)**
- Schwan, J.: *Studien zur Baugeschichte von Schloss Carlsberg*, 2010. Weber, W.: *Schloss Karlsberg – Legende und Wirklichkeit*, 1987.
- Dahl, J. / Lohmeyer, K. (eds.): *Das barocke Zweibrücken und seine Meister*, ²1957.
- Rübel, R.: *Die Bautätigkeit im Herzogtum Pfalz-Zweibrücken und in Blieskastel im 18. Jh.*, 1914.
- Lietz, S.: *Das Fenster des Barock. Fenster und Fensterzubehör in der fürstlichen Profanarchitektur 1680–1780*, 1982.
- Langer, B.: *Die Möbel der Residenz München. Die französischen Möbel des 18. Jahrhunderts*, 1995.
- Güse, E.-G. (ed.): *Kunstschätze aus Schloss Carlsberg. Die Sammlungen der Herzöge von Pfalz-Zweibrücken*, 1989.
- Hemmer, J. J.: *Anleitung, Wetterleiter an allen Gattungen von Gebäuden auf die sicherste Art anzulegen*, Mannheim 1786.
