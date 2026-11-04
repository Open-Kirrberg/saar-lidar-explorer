# 01 — Schloss Karlsberg: history, building inventory and sources

> Research date: 2026-11-01. Scope: chronology 1760–today, inventory of every known building and park structure of the residence, visual and written primary sources, literature, and existing reconstructions. This is the evidence base for the 3D model and for the plan documents in `../plans/`.
>
> **Method and limits.** Web pages were read with WebFetch/WebSearch only; nothing was downloaded. Three key sources could **not** be read in this session:
> 1. **schloss-carlsberg.de** (Jutta Schwan's research portal, which has a room guide and a floor-plan reconstruction). The site answers bots with HTTP 401, so only search-engine snippets were seen.
> 2. **Heidelberg University journals** (the *Burgen und Schlösser* 4/2012 article). Anubis bot protection blocked access.
> 3. **The DNB catalogue** (also behind Anubis).
>
> The DNB table-of-contents scan of Weber 1987 **was** readable (OCR'd locally from the tool cache). It is the best map we have of what the literature covers.
>
> The two standard monographs, **Schwan 2010** (747 pp.) and **Weber 1987** (607 pp.), are print-only. **Most hard numbers (dimensions, window axes, storeys) are in those books and have not been verified here.** Treat this file as a finding aid plus a first evidence layer, not as the final word.
>
> **Evidence markers** (used throughout):
> - **[D]** documented: a source is named and linked. Where the source is secondary (a Wikipedia summary or a tourism page), that is said.
> - **[I]** inferred: our own reasoning, which is stated.
> - **[U]** unknown or not found.
> - **[U-bk]** background knowledge from before this session that was not re-verified. Treat it as unknown until checked.

---

## 0. Key facts at a glance

| Item | Value | Evidence |
|---|---|---|
| Builder | Duke **Karl II. August** of Pfalz-Zweibrücken (r. 1775–1795) | [D] [de.wikipedia](https://de.wikipedia.org/wiki/Schloss_Karlsberg) |
| Predecessor | **Louisenhof** (also "Luisenhof"), a manor estate founded 1760/61 by Freiherr von Closen on the then **unforested** Buchenberg | [D] [homburg-im-bild chronology](http://nhp-2000.de/homburg-im-bild/html/body_-_chronologie_schloss_karlsber.html), [outdooractive/Saarpfalz-Touristik](https://www.outdooractive.com/de/poi/saarpfalz-kreis/waldpark-schloss-karlsberg/61542782/) |
| Purchase | **27 July 1777** | [D] de/en.wikipedia |
| Price | **35,000 Gulden** + 60 new Louis d'or (de.wikipedia, homburg-im-bild); en.wikipedia says **23,000 Gulden** | **Conflict.** Check Schwan 2010 |
| Main building period | **1778–1788** (some sources say "from 1776" or "1776–1786") | [D] de.wikipedia; [homburg.de](https://www.homburg.de/index.php/tourismus-neu/sehenswertes/schloss-karlsberg) (1776–1786); [rosalux 2015](https://www.rosalux.de/news/id/692/der-karlsberg-von-barocker-pracht-zur-baustoffhandlung) ("ab 1776") |
| Residence | Court moves to Karlsberg in **1779** | [D] de.wikipedia |
| Architect / Baudirektor | **Johann Christian (von) Mannlich** (1741 Strasbourg – 1822 Munich), court painter and Generalbaudirektor | [D] de/en.wikipedia |
| Interior designs | Mannlich and **Jean-Démosthène Dugourc** | [D] de.wikipedia |
| Duke's flight | Night of **9 Feb 1793** | [D] de.wikipedia |
| Destruction | Released for plunder and set on fire on the evening of **28 July 1793** by French revolutionary troops | [D] de.wikipedia; en.wikipedia; [Saarpfalz-Kreis 2025](https://www.saarpfalz-kreis.de/:translation/en/saarpfalz-kreis/de/aktuelles/pressemitteilungen/2025/juni/kurzfilm-zu-schloss-karlsberg-begeistert) |
| Scale | "Main buildings stretched over **1,000 m**"; "more than a kilometre long"; site "at least **4 km²**"; "right side of main complex about **1,250 m** long" | [D] homburg-im-bild; Saarpfalz-Touristik; en.wikipedia (secondary sources) |
| Fame | "Largest country residence in Europe" (attributed to **Dehio**); "Feenschloss" (fairy palace, attributed to **Knigge**, 1792) | [D] homburg-im-bild; en.wikipedia; title of Marx 2010. Original passages not seen |
| Surviving building | **Only one**, the former **Baumagazin**, today the **Karlsberger Hof**. See §2.5 for the naming confusion | [D] de.wikipedia; [schloss-karlsberg.de](https://schloss-karlsberg.de/schloss-karlsberg-3/) |
| Today | **WaldPark Schloss Karlsberg**, a cooperation founded in **2008** | [D] Saarpfalz-Kreis 2025 |

**Coordinates** (EPSG:25832, converted from WGS84 with pyproj). These are approximate pointers, not surveyed positions:

| Place | Lat / Lon | E / N (UTM32N) | Source |
|---|---|---|---|
| Palace main site / Ehrenhof clearing | 49.3362 / 7.3784 | 382195 / 5466095 | OSM (see `../../../docs/research/03-archaeology-visualization.md`) |
| Palace (de.wikipedia point) | 49.3347 / 7.3789 | 382228 / 5465928 | de.wikipedia |
| Orangerie ruin | 49.3352 / 7.3789 | 382229 / 5465983 | OSM |
| Karlsberger Hof (= ex-Baumagazin?) | 49.333827 / 7.368753 | 381488 / 5465847 | GPS of [Commons photo](https://commons.wikimedia.org/wiki/File:Karlsberger_Hof.jpg) |
| Karlsbergweiher | 49.3341 / 7.3741 | 381877 / 5465869 | OSM |
| Bärenzwinger (menagerie) | 49.32572 / 7.38886 | 382930 / 5464914 | [Commons category](https://commons.wikimedia.org/wiki/Category:B%C3%A4renzwinger_(Karlsberg)) ([Wikidata Q71704593](https://www.wikidata.org/wiki/Q71704593)) |
| Schwanenweiher | 49.3242 / 7.3881 | 382871 / 5464746 | OSM |
| Eiskeller | 49.3384 / 7.3828 | 382520 / 5466333 | OSM |
| Well at the former Forsthaus | 49.3397 / 7.3806 | 382363 / 5466481 | OSM |

---

## 1. Chronology

### 1.1 Before the palace: the Louisenhof (1755–1777)

| Year | Event | Evidence |
|---|---|---|
| 1755 | The Buchenberg passes from Nassau-Saarbrücken to Pfalz-Zweibrücken | [D] homburg-im-bild |
| 1760/61 | Freiherr **von Closen** founds the **"Großer Louisenhof"**, named after his wife Louise, née von Esebeck. It is a **four-wing farm layout**. The **manor house has 7 × 4 window axes, two full storeys and probably a hipped roof (Walmdach)**. Outbuildings are **single-storey with gabled roofs**. A "Kleiner Louisenhof" near Kehrberg houses the sheepfold | [D] homburg-im-bild. It reads like a summary of Weber or Schwan; the primary source is not named |
| 1762 | Christian IV makes the estate a "freiadliges Gut" | [D] homburg-im-bild |
| 1764 | Closen dies. His widow fails to sell | [D] homburg-im-bild |
| 1766 | The widow remarries (Strahlenheim-Wasaburg) and moves to Forbach. The estate is neglected | [D] homburg-im-bild |
| 1775 | Christian IV dies. Karl II. August succeeds | [D] de.wikipedia |
| 1776 | Karl August moves the residence to **Jägersburg** | [D] search snippet of schloss-carlsberg.de (Jägersburg history). Not read directly |
| 27 Jul 1777 | Karl August buys the Louisenhof. Mannlich says the influence of his mistress **Caroline von Esebeck**, a cousin of the owner, was behind it | [D] de.wikipedia, citing Mannlich, *Rokoko und Revolution*, p. 202 f. |

**[I] Modelling consequence.** The Corps de logis grew out of the Louisenhof manor house, which was "refurbished" from 1778 to 1782 and later given a mansard roof. So the **core of the main palace was probably a 7-axis, two-storey block**, with the rest added around it. This fits the "grown by additions" character. schloss-karlsberg.de describes the original **three-wing** layout (residence, stable, outbuilding) as being "greatly expanded" ([schloss-karlsberg.de/schloss-karlsberg](https://schloss-karlsberg.de/schloss-karlsberg/)).

### 1.2 Construction, 1778–1788 (–1793)

The building timetable below appears almost identically in [en.wikipedia](https://en.wikipedia.org/wiki/Karlsberg_Castle) and in the [homburg-im-bild chronology](http://nhp-2000.de/homburg-im-bild/html/body_-_chronologie_schloss_karlsber.html). Both probably derive from Weber 1987 or Schwan, so they are **one source, not two**. [D, secondary]

| Dates | Building / work | Notes |
|---|---|---|
| 1778–1780 | Well and water conduit (Wasserleitung) to the Karlsberg | |
| 1778–1782 | **Corps de logis** (refurbishment of the Louisenhof main building); **Wirtshaus** (inn); **Brauerei** (brewery) | |
| 1778–1785 | **Marstall** (stables) | |
| 1779–1785 | **Kavaliersbau** (cavaliers' house) | |
| 1779–1783 | Dutch garden and greenhouses | |
| 1779–(1784?) | **North wing** of the palace | en.wikipedia says "1779–1794", which is impossible after the 1793 fire; probably a typo. [U] |
| 1779–1782 | Taubenhaus (dovecote) | |
| 1779–1786 | **Menagerie** | schloss-karlsberg.de: "from 1778" |
| 1779–1780 | **Tschifflik pavilion** (Karlslust) | |
| 1779/80–1784 | Kitchen wing (Küchenbau) | listed twice: 1779–84 / 1780–83 / 1781–82. [U] |
| 1780–1785 | **South wing** of the palace | |
| 1780–1783 | Chinoiserie (Chinese pavilion/temple?) | |
| 1780 | **Schweizerei (dairy) converted into the Orangerie** | |
| 1780–1783 | "Zwinger": en.wikipedia says "kennel", homburg-im-bild says "Zwinger for bears" | **Conflict:** Hundezwinger or Bärenzwinger? The original German probably just says "Zwinger". [U] |
| 1780–1784 | **Jägerhaus / Jägermeisterei** (hunting lodge); **used as Kaserne (barracks) from 1791** | |
| 1780–1782 | Court nursery (Hofgärtnerei, Petri) | |
| 1780–1781 | Pheasant house (Fasanerie, Karlslust) | |
| 1780–1784 | **Große Kaskade** and upper basin | |
| 1781 | Pineapple hothouse (Ananashaus) | |
| 1782 | Amphitheatre; **start of the west wing**; Karlslust gatehouse (Torhaus) | |
| 1782–1785 | **Remisen** (coach houses), depots | |
| 1783 | **Komödienhaus** (theatre) at the Orangerie; Hirschwürzloch fountain house; Bienenhaus (apiary) | |
| 1783–1784 | Prince's pleasure house (Lusthaus des Prinzen); Lambsbach water conduit | |
| 1784 | Duchess's pleasure garden | |
| 1785 | **Rotunde** at the Orangerie, for the wedding of Pfalzgraf **Maximilian Joseph** (later King Max I of Bavaria) | Festivities described by Fürstenwärther 1786 and the *Zweibrücker Zeitung*, 1 Jan 1786 (see §3.4) |
| 19 Dec 1785 | A fireworks explosion in the Tschifflik area kills several people | [D] de.wikipedia, citing Mannlich pp. 226 ff. |
| 1786 | **Herzogsterrassen** with iron bear cages ("Bären-Kästen") | [D] [urlaub.saarland](https://www.urlaub.saarland/attraktion/baerenzwinger-1986e52928), schloss-karlsberg.de |
| 1788 | **Galerieflügel** (picture-gallery wing) | |
| 1791 | Jägerhaus converted to barracks | |

**Other context:**
- Material, panelling, furniture and "even an entire stable" were brought over from **Jägersburg** ([schloss-karlsberg.de](https://schloss-karlsberg.de/schloss-karlsberg/)). [D]
- Large parts of Jägersburg were demolished to supply building material ([search snippet of schloss-carlsberg.de](https://www.schloss-carlsberg.de/index.php/oberamt-homburg/jagdschloss-jaegersburg/geschichte/67-geplante-versetzung-auf-den-carlsberg)). [D, snippet]
- Weber 1987 has a chapter on "**Projekte der Übertragung von Schloss Jägersburg auf den Karlsberg**" (projects to move Schloss Jägersburg to the Karlsberg). [D, Weber's table of contents]
- **All buildings had lightning rods** (schloss-karlsberg.de). [D]
- The palace was **never completed** (schloss-karlsberg.de). [D]

### 1.3 Destruction (1793)

All rows below are [D], sourced from de.wikipedia, en.wikipedia and homburg-im-bild.

- **9 Feb 1793.** Warned by a farmer from Rohrbach, the duke flees at night via Kaiserslautern to Mannheim. A revolutionary tribunal sought him after the execution of Louis XVI.
- **Feb–Jul 1793.** Prussian and French troops alternate in control, with looting and fires. Under Prussian protection the furnishings are evacuated via Kaiserslautern to Mannheim. **Mannlich saves the painting collection, library, arms collection, furniture and wall panelling.** The paintings later go to Munich and become a core of the Alte Pinakothek. There is a story of a hidden trapdoor in the picture gallery used to hide treasures ([schloss-karlsberg.de](https://schloss-karlsberg.de/schloss-karlsberg/)).
- **28 Jul 1793.** After the capitulation of Mainz, the retreating French release the palace for general plunder. Nearby villagers are allowed to loot. In the evening it is set on fire. About **100 wagons of straw** (or hay) are used, reportedly brought from as far as Metz over about three days.
- **Extent of the fire.** The main damage was to the **ducal residence and the timber-framed (Fachwerk) buildings** (de.wikipedia). en.wikipedia says the mansion burned but **most service and farm buildings survived**.
  - **[I]** So a significant share of the residence was **Fachwerk** (probably plastered). This matters for the model's materials (§2.4).
- **Nov 1793.** Births are still recorded at Karlsberg. Court accounts continue until 1797.

### 1.4 Afterlife (1796 – today)

| Date | Event | Evidence |
|---|---|---|
| 1796 | 14 Homburg citizens lease the right to sell the remaining wood and stone. By the early 19th century the ruins are cleared to the foundations. The palace becomes a "cheap building-materials store" for houses in Homburg and the area | [D] homburg-im-bild; [rosalux 2015](https://www.rosalux.de/news/id/692/der-karlsberg-von-barocker-pracht-zur-baustoffhandlung) |
| Napoleonic period | The ruins are returned to the duke's widow on condition that they be demolished to ground level | [D] de/en.wikipedia (no date given) |
| after 1793 | The hill is reforested "soon after" | [D] en.wikipedia |
| **1804, 1805, 1825** | Site plans of the ruins: Lagepläne of 1804 and 1825 plus later copies (Weber's table of contents); a "map of the ruins of 1805" ([Commons](https://commons.wikimedia.org/wiki/File:Karlsberg_karte_II.jpg)) | [D] |
| 19th c. | Baumagazin used as brewery/sugar factory, then as forester's house | [D] de/en.wikipedia (the two disagree on details) |
| 1931 | "Rekonstruktionsversuch von 1931" (reconstruction attempt) for the **Orangerie** | [D] Weber's table of contents. Author unknown [U] |
| **1950s** | **Excavations** on the Karlsberg. They show that the ruin long called "Kapelle" was not the original Tschifflik but a building on a terrace opposite the cascade | [D] de.wikipedia. Excavator and report unknown [U] |
| 1975 | The Weber brewing family (Karlsberg Brauerei) owns the Karlsberger Hof | [D] schloss-karlsberg.de |
| 1978 | Heinrich Lau paints "Schloß Karlsberg", an imaginative reconstruction painting, now at the Karlsberger Hof | [D] [schloss-karlsberg.de](https://schloss-karlsberg.de/schloss-karlsberg/) |
| 1987 | W. Weber, *Schloss Karlsberg – Legende und Wirklichkeit*. It has a chapter "**Ausgrabungen auf dem Karlsberg**" (excavations on the Karlsberg) | [D] Weber's table of contents |
| 1989 | Saarland-Museum exhibition and catalogue *Kunstschätze aus Schloss Carlsberg* (ISBN 3-925303-42-1) | [D] Commons source field of the [Le Clerc file](https://commons.wikimedia.org/wiki/File:Schloss_Karlsberg_Leclerc.jpeg) |
| 1990 | Storm "Wiebke" fells the "Herzogskastanien" | [D] de.wikipedia. **Conflict:** the [Homburg Schlossbergtour brochure](https://www.homburg.de/media/scllyew0/schlossbergtour.pdf) still names "over 200-year-old Herzogskastanien" as a natural monument, so some may survive [U] |
| 2003 | schloss-carlsberg.de goes online, with a CAD reconstruction project (§4.3) | [D] search snippets |
| 2006 | The Landesdenkmalamt Saarland annual report says a structure in the **first forecourt, on the axis of the "new palace"**, is to be investigated in **2007** | [D] search snippet of [LDA Jahresbericht 2006](https://www.saarland.de/SharedDocs/Downloads/DE/LDA/Jahresbericht/Denkmalpflege_im_Saarland_Jahresbericht_2006.pdf?__blob=publicationFile&v=5) (HTTP 403 to the tool; download manually) |
| from 2007 | Restoration of the three **Schwanenweiher**. A student competition creates the **Hörpfad** (audio trail, about 5.5 km, Uni Karlsruhe team) for their reopening | [D] [Hörpfad page](https://schloss-karlsberg.de/hoerpfad-schloss-karlsberg/); search snippet |
| **2008** | **WaldPark Schloss Karlsberg** founded. Partners: Saarpfalz-Kreis, Stadt Homburg, Verbandsgemeinde Zweibrücken-Land, the Pfalz and Saarland forestry authorities, the Landesdenkmalamt, Stiftung Karlsberger Hof, and the Saarland environment ministry | [D] Saarpfalz-Kreis 2025 |
| 2009–2013 | Ruins "elaborately secured" (Sicherung, i.e. consolidation). Reinhard Schneider, "Über den denkmalpflegerischen Umgang mit Ruinen", *Denkmalpflege im Saarland, Jahresbericht 2013*, pp. 127–133 | [D] de.wikipedia literature list; search snippet |
| 2010 | Jutta Schwan's dissertation is published (§4.1) | [D] |
| 2015 | SWR/SR documentary (§4.3) | [D] |
| 2018–19 | Exhibition *Steinerne Macht* at the Historisches Museum Saar, with a photorealistic Karlsberg reconstruction (§4.3) | [D] |
| 2019 | Children's booklet *Mit Gusti zum Karlsberg* (Schwan with HS Kaiserslautern students) | [D] [Rheinpfalz 2019](https://www.rheinpfalz.de/startseite_artikel,-eulengezwitscher-verr%C3%A4t-geheimnisse-von-schloss-karlsberg-_arid,1382324.html) |
| Jun 2025 | Student short film published; maintenance of the menagerie ("Bärenzwinger") discussed | [D] Saarpfalz-Kreis 2025 |

**Map labels.** The Saarland topographic web map labels the area "**Ausgrabungen Schloß Karlsberg**" (`../../../docs/research/04-cadastre-historic-maps.md`, line 136). [D]

**Excavations: what we do not know.** No excavation report, plan of trenches or geophysics study was found online. [U]
- The 2026 publication list of Simon Matzerath (director of the Historisches Museum Saar) mentions a volume whose description names Karlsberg among sites studied with methods "such as ground-penetrating radar and 3D laser scanning". The search summary attributes this to the *Steinerne Macht* catalogue. This is **unclear** and needs checking against the catalogue ([academia.edu](https://www.academia.edu/44478294/)).

---

## 2. Building and structure inventory

### 2.1 Overall layout: what is documented

- **Approach.** The **main entrance was in the valley**, where the **Karlsberger Hof** stood. A **winding road** led up to the palace ([en.wikipedia](https://en.wikipedia.org/wiki/Karlsberg_Castle)). A straight **avenue came from Homburg** ([Commons: "Ehemalige Zufahrtsallee von Homburg"](https://commons.wikimedia.org/wiki/File:Karlsberg_Zufahrt_von_Homburg.jpg)). [D]
- **Main palace.** A **three-wing building around a cour d'honneur (Ehrenhof)** ([en.wikipedia](https://en.wikipedia.org/wiki/Karlsberg_Castle)). The *Burgen und Schlösser* 2012 snippet says it was "**extended to the north by a collection wing and a picture gallery**". [D]
- **Linear arrangement.** The main buildings **lined the edge of the hill** with views over the countryside. The main buildings stretched for more than 1 km (sources in §0). [D]
- **Paradestraße.** A parade road ran "along the palace front" ([Commons](https://commons.wikimedia.org/wiki/File:Karlsberg_Parade%C3%9Fstra%C3%9Fe.jpg), [de.wikipedia caption](https://de.wikipedia.org/wiki/Schloss_Karlsberg)). [D]
  - **[I]** Because it runs "along the front", the long building line was probably laid out parallel to the plateau edge, with the Paradestraße in front of it.
- **Ehrenhof today.** It is an "**almost square clearing**" a few metres from the Orangerie ruin. "**Here stood the original main building of the palace**" ([Homburg Schlossbergtour brochure](https://www.homburg.de/media/scllyew0/schlossbergtour.pdf), text extracted locally). [D]
- **Forecourts.** There was a "**first forecourt** axially aligned with the new palace" (LDA 2006 snippet), so there were several forecourts in sequence. The Kavaliersbau had its own forecourt ([outdooractive](https://www.outdooractive.com/de/poi/saarpfalz-kreis/waldpark-schloss-karlsberg/61542782/)). [D]
- **Garden parts.** There were three, all [D] (de.wikipedia):
  1. the formal **palace garden** (baroque) by the palace;
  2. the **Karlslust**, an English landscape garden in the valley formerly called "Teufelsloch", south/south-east of the palace;
  3. the **Hirschwürzloch**.
- **Avenues.** An **Apfelallee** (apple avenue) led to the Karlslust ([Commons file](https://commons.wikimedia.org/wiki/File:Karlsberg_Karlslust_Apfelallee.jpg)). [D]
- **A town on the hill.** The site included barracks, farms, nurseries, kennels and stables (en.wikipedia). Weber's chapter title is "**Eine Stadt auf dem Berg**" (a town on the hill). [D]
- **LiDAR cross-check.** The parallel LiDAR analysis (`lidar_features.geojson`, KB-01) finds a levelled terrace at about **344.5–344.9 m**, about 128 × 72 m, centred near E 382225 / N 5466150. It is long in the N–S direction, which is consistent with a N–S building line. This is our own LiDAR reading, not a historical source. [I]

### 2.2 Exterior appearance: the "plain, grown" palace

These items are documented, but only through [en.wikipedia](https://en.wikipedia.org/wiki/Karlsberg_Castle), which appears to translate an older de.wikipedia text that was probably based on Weber or Schwan:
- The style is **early classicism**, among the first classicist buildings in Germany, contemporary with Wörlitz.
- **Plain exterior.** It was made of **one- and two-storey buildings** with **continuous cornices** ("durchlaufende Gesimse"), plus "architrave blocks" (meaning unclear, perhaps Architravgesims or plain window surrounds), under **gabled roofs (Satteldächer)**.
- **Only the Corps de logis had a mansard roof.**
- State rooms were **on the upper floor** (piano nobile).
- A **staircase "42 m"**, "one of the largest of the Baroque". The figure is suspicious: 42 m could be a length of the stair hall or an error. [U] Verify in Schwan 2010.

**Contemporary views to check this against:** the Le Clerc 1790 gouache, the Ruppenthal leporello 1788, the "Pleine vue" 1791, the Herdegen map cartouche 1791, and the Meissen plate. See §3.2. They have not been inspected in this session, beyond thumbnails being listed. [U]

**[I] Working model of the exterior** (to be tested against those views):
- A long, low, fairly uniform row of one- and two-storey blocks along the plateau edge.
- Uniform cornice lines.
- Pale plaster render; the Orangerie is documented with pale plaster, see §2.3.
- Grey slate or red tile gabled roofs.
- Only the central Corps de logis is raised by a mansard roof.
- Little sculpture.

This matches the user's brief ("ländlich", grown by additions, barrack-like) and the documented contrast with the luxurious interiors. **Roof covering and render colour remain [U].**

### 2.3 Inventory table

Columns: what it was, its date (from §1.2 unless stated otherwise), its documented form, its position, and its evidence. Dimensions are **[U]** unless given; the numbers are expected in Schwan 2010 and Weber 1987.

| # | Structure | Function | Date | Documented form / dimensions | Position (relative to the Corps de logis) | Remains today | Evidence |
|---|---|---|---|---|---|---|---|
| 1 | **Corps de logis / Hauptpalais** (old Louisenhof manor house, enlarged) | Ducal residence, state rooms upstairs | 1778–82 (refurbishment); later additions | Louisenhof core: **7 × 4 axes, 2 storeys, probably hipped roof** (before 1777). Later the **only mansard roof** of the complex. Weber has a chapter on "**Ausmaße des Hauptgebäudes**" (dimensions of the main building; figures not seen) and compares it with **Schlösschen Forbach** (Zweibrücken) | Head of the Ehrenhof (today's square clearing near E 382195 / N 5466095) | Foundations; clearing | [D] homburg-im-bild; en.wikipedia; Weber's table of contents; brochure |
| 2 | **North wing** (Ehrenhof wing) | Apartments / service rooms | 1779– | [U] | North side of the Ehrenhof | Foundations? | [D, date only] |
| 3 | **South wing** (Ehrenhof wing) | Apartments | 1780–85 | [U] LiDAR KB-02 shows a "southern wing with cellars" | South side of the Ehrenhof | Cellars? | [D, date]; [I, LiDAR] |
| 4 | **West wing** | [U] | from 1782 | [U] | West of the Ehrenhof. **[I]** It may close the court or face the valley | [U] | [D, date only] |
| 5 | **Küchenbau** (kitchen wing) | Court kitchen | 1779/80–84 | [U] The room guide has a "Küche" page | [U] | [U] | [D] |
| 6 | **Sammlungsflügel** (collection wing) | Naturalienkabinett, physikalisches Kabinett, armoury? | [U] | [U] | **North extension** of the main palace | [U] | [D] BuS 2012 snippet |
| 7 | **Galerieflügel / Gemäldegalerie** | Picture gallery (later moved to Munich) | 1788 | Weber's chapter covers "Vermutlicher Standort der Galerie – Beschreibung der Galerie – Ergänzung des Galeriebaues" (likely site, description, extension of the gallery building) | North of the main palace | [U] | [D] Weber's table of contents; BuS snippet |
| 8 | **Bibliothek** | Library (later moved to Staatsbibliothek Bamberg) | [U] | Weber has a chapter on its "Beschaffenheit" (character); location in the palace [U] | [U] | — | [D] |
| 9 | **Kavaliersbau** (Kavaliershaus) with **forecourt** | Lodging for courtiers | 1779–85 | Has a **cellar** (Commons photo "Keller des Kavaliersgebäude"); the prior research calls it the "**Räuberhöhle**" | [U] Probably on the approach from the forecourts | Cellar | [D] [Commons](https://commons.wikimedia.org/wiki/File:Karlsberg_Kavaliersgebaeude_01.jpg); outdooractive |
| 10 | **Marstall** with **Reithalle** (riding hall) | Stables | 1778–85 | "Stable for **1,000 horses**" (homburg-im-bild; homburg.de says "Reithalle für tausend Pferde"). This is a legend-level number; Weber has a chapter "**Pferdebestand des Marstalles**" (the horse stock). A **ramp** survives ([Commons "Rampe am ehem. Marstall"](https://commons.wikimedia.org/wiki/File:Karlsberg_Reithalle_01.jpg)). Weber discusses "**Der Typus des Karlsberg-Marstalles**" (the type of the Karlsberg stable) | [U] | Ramp | [D] |
| 11 | **Remisen** (coach houses) and **depots** | Carriages, stores | 1782–85 | [U] | "Standort der Remisen" on [Commons](https://commons.wikimedia.org/wiki/File:Karlsberg_Remsie_01.jpg) | Site only | [D] |
| 12 | **Jägerhaus / Jägermeisterei → Kaserne** | Hunt administration; **barracks from 1791** | 1780–84 | Weber: chapters "Die Jägermeisterei", "**Die Kasernen**" (plural) | [U] | [U] | [D] |
| 13 | **Hundezwinger** (kennels) | Hunting dogs. The duke's nickname "Hundskarl" was popularised in 1923 | 1780–83 (?) | [U] See the "Zwinger" conflict in §1.2 | [U] | [U] | [D] rosalux; en.wikipedia ("kennel") |
| 14 | **Wirtshaus** and **Brauerei** | Inn, brewery | 1778–82 | [U] | [U] | — | [D] |
| 15 | **Baumagazin** = today's **Karlsberger Hof**(?) | Builders' store | [U] | Today **shorter than the original**; roof form changed; one end raised by a later storey (forester's house period) | **In the valley at the main entrance**, Sanddorf (E 381488 / N 5465847) | **Standing**, inhabited | [D] de.wikipedia; schloss-karlsberg.de; [Commons photo 2023](https://commons.wikimedia.org/wiki/File:Karlsberger_Hof.jpg); [Commons 2006](https://commons.wikimedia.org/wiki/File:Karlsberg_Baumagazin_01.jpg) |
| 16 | **Ökonomiegebäude** (farm buildings), **"Le Petit Hameau"**, **Fasanerie der Herzogin** | Farm; a rustic hamlet (cf. Chantilly/Versailles); the duchess's pheasantry | [U] | Weber chapter: "**Gebäude unterhalb des Bergplateaus**" (buildings below the plateau) | **Below the plateau** | [U] | [D] Weber's table of contents |
| 17 | **Orangerie** (converted from the **Schweizerei**/dairy) | Overwintering citrus; **summer festival hall**; with **Komödienhaus/Theatersaal** (1783) | 1780; theatre 1783 | **Three wings, pale plaster walls, high basement; a pillared hall with tall windows** ([schloss-karlsberg.de](https://schloss-karlsberg.de/schloss-karlsberg/)). Weber: "Baugestalt", "Rekonstruktionsversuch von 1931", comparison with the Orangerie in **Zweibrücken**, and a "stylistic difference from the Hauptpalais" (**[I]** so the Orangerie was richer or more classical than the palace) | A few metres from the Ehrenhof clearing; above the Karlsbergquelle and Karlsbergweiher (E 382229 / N 5465983) | **Standing ruin** (walls); [13 Commons photos](https://commons.wikimedia.org/wiki/Category:Orangerie_(Karlsberg)) | [D] |
| 18 | **Rotunde / Rundbau an der Orangerie** | Festival building for the 1785 wedding | 1785 | Weber: "Der Grundriß – Schnitt und Ansichten" (**a plan, section and elevations exist** in Weber!), compared with Furttenbach's four-stage project and the Stupinigi/Malgrange plans, "Théâtre de la foire". The brochure speaks of the "Orangerie **Rotunde**" ruin | Attached to the Orangerie | Ruin | [D] Weber's table of contents; [schloss-carlsberg.de article "Rotunde der Orangerie, 1785"](https://www.schloss-carlsberg.de/index.php/oberamt-homburg/schloss-carlsberg/weitere-artikel/68-rotunde-der-orangerie-1785) (401) |
| 19 | **Großes Treib- und Gewächshaus**; **Ananashaus**; Dutch garden greenhouses | Hothouses | 1779–83, 1781 | [U] | Near the Orangerie? [U] | [U] | [D] |
| 20 | **Hofgärtnerei** (Petri) | Court nursery | 1780–82 | [U] | [U] | [U] | [D] |
| 21 | **Taubenhaus** (dovecote) | | 1779–82 | [U] | [U] | [U] | [D] |
| 22 | **Bienenhaus** (apiary) | | 1783 | [U] | [U] | [U] | [D] |
| 23 | **Komödienhaus** | Theatre (part of the Orangerie) | 1783 | see #17 | | | [D] |
| 24 | **Amphitheater** | Garden theatre? | 1782 | [U] | [U] | [U] | [D] |
| 25 | **Chinoiserie** / "Pavillon und chinesischer Tempel" | Garden pavilion | 1780–83 | [U] | Garden (Weber's garden chapter) | [U] | [D] |
| 26 | **Lusthaus des Prinzen** | Pleasure pavilion | 1783–84 | [U] | [U] | [U] | [D] |
| 27 | **Lustgarten der Herzogin** | Garden | 1784 | — | [U] | [U] | [D] |
| 28 | **Schlösschen Monbijou** | Small pleasure house | [U] | Weber chapter | [U] | [U] | [D] |
| 29 | **Kirchturm aus der Karlsbergzeit** | Church tower (a palace chapel or the parish church?) | [U] | Weber chapter | [U] | [U] | [D] |
| 30 | **Eiskeller** | Ice cellar | [U] | — | NE of the palace (E 382520 / N 5466333) | Archaeological site | [D] OSM |
| 31 | **Forsthaus** (later) and its well | | post-1793? | — | N (E 382363 / N 5466481) | Well | [D] [Commons](https://commons.wikimedia.org/wiki/File:Karlsberg_ehemaliges_Forsthaus.jpg); OSM |
| 32 | **Wells / Brunnen** and **water conduits** (1778–80; Lambsbach conduit 1783–84) | Water supply | 1778–84 | [U] | [U] | Several wells | [D] |
| **Karlslust** (landscape garden in the valley, S/SE) | | | | | | | |
| 33 | **Tschifflik-Pavillon** | Turkish-style pavilion, "the largest of four pavilions" | 1779–80 | The original form is unknown. Weber: "**Mutmaßliche Baugestalt**" (presumed form). The name comes from the Polish king Stanisław Leszczyński's Tschifflik near Zweibrücken | Karlslust valley. The ruin traditionally called "Tschifflik" (once "Kapelle") **may belong to another building on a terrace opposite the cascade** (1950s excavation) | Ruin ([Commons category](https://commons.wikimedia.org/wiki/Category:Tschifflik_Pavillon)) | [D] de.wikipedia; [ich-geh-wandern](https://www.ich-geh-wandern.de/herzog-karl-ii-august-pfad-saarpfalz) |
| 34 | **Große Kaskade** with **upper basin (Großes Bassin)** and start basin | Water staircase | 1780–84 | **10 steps, each 1.5 m high; each step area 10 × 10–15 m**. It drops into the uppermost (round) Schwanenweiher (the plunge basin, "Tosbecken") | Karlslust, above the Schwanenweiher | Basins, steps ([Commons](https://commons.wikimedia.org/wiki/File:Karlsberg_Karlslust_Kaskade_01.jpg)) | [D] de.wikipedia |
| 35 | **Schwanenweiher** (3 ponds) with a tumulus, ruin and **shell-lined niche (grotto)** | Ponds | [U] | Edged with boulders; the top pond is round | Centre of the Karlslust valley (E 382871 / N 5464746) | **Restored from 2007** | [D] de.wikipedia; search snippets |
| 36 | **Menagerie, the so-called "Bärenzwinger"** | Not for bears: an **aviary ring** | 1778/79–86 | **Circular ring of 19 half-round "cages" plus a loge; central moat with a square island that held a pavilion**. Modelled on ancient amphitheatres. Compare the aviaries at Schwetzingen | Karlslust (E 382930 / N 5464914) | Ring walls, island | [D] de.wikipedia; schloss-karlsberg.de; Commons |
| 37 | **Herzogsterrassen** with iron "**Bären-Kästen**" (bear boxes) | The real bear enclosures | 1786 | [U] | Near the Bärenzwinger, above the Schwanenweiher | Terraces | [D] [urlaub.saarland](https://www.urlaub.saarland/attraktion/baerenzwinger-1986e52928) |
| 38 | **Trilagen-Pavillon** and terraces | Garden pavilion | [U] | — | Karlslust | Terraces ([Commons](https://commons.wikimedia.org/wiki/File:Karlsberg_Karlslust_Trilagenpavillon.jpg)) | [D] |
| 39 | **Fasanerie** (Karlslust) | Pheasantry | 1780–81 | [U] | Karlslust | [U] | [D] |
| 40 | **Karlsluster Torhaus** | Gatehouse | 1782 | [U] | Karlslust entrance; a "fountain at the entrance" survives ([Commons](https://commons.wikimedia.org/wiki/File:Karlsberg_Karlslust_Brunnen_am_Eingang.jpg)) | Fountain | [D] |
| 41 | **Hirschwürzloch Brunnenhaus**; **Hirschbrunnen** | Fountain house | 1783 | [U] | Hirschwürzloch; [Commons category Hirschbrunnen](https://commons.wikimedia.org/wiki/Category:Hirschbrunnen_(Karlsberg)) | Fountain | [D] |
| 42 | **Herzogskastanien** | Chestnut grove | under Karl II. August | — | Above the Hirschwürzloch | Felled 1990 (?) | [D] de.wikipedia (but see the brochure conflict) |
| 43 | **Karlsbergweiher** (with island) | Park basin | [U] | — | W of the Orangerie, below the Karlsbergquelle (E 381877 / N 5465869) | Pond | [D] en.wikipedia; OSM |
| 44 | **Avenues**: Homburg approach avenue; Apfelallee to the Karlslust; Paradestraße | | [U] | — | see §2.1 | Tracks in the forest | [D] Commons |

**Not found anywhere (all [U]):** Reithalle dimensions, a palace chapel, a guard house (Hauptwache), a Ballhaus, a separate library building, the court apothecary, and staff housing.
- **[I]** These typical residence functions probably existed somewhere in the "town on the hill".
- **[I]** Weber's chapter "Bekannte und unbekannte Bewohner" (known and unknown residents) may list them.

### 2.4 Materials

| Aspect | Status |
|---|---|
| Local stone | **Buntsandstein** (the brochure stresses the Buntsandstein geology; the Orangerie ruin photos show reddish sandstone masonry). **[I]** Foundations, cellars, plinths and dressings were sandstone |
| Fachwerk | **[D]** de.wikipedia says the fire hit "timber-framed buildings" in particular. **[I]** Many secondary and later buildings were plastered Fachwerk, a fast, cheap way to build, which fits "grown by additions" |
| Render colour | **[D]** Orangerie: pale plaster ("hell verputzt", schloss-karlsberg.de). Everything else **[U]**. **[I]** Pale (white/ochre/light grey) render with sandstone dressings is typical of Pfalz-Zweibrücken buildings of the 1770s–80s (Zweibrücken Residenz, Jägersburg). Check against the Le Clerc colours |
| Roofs | **[D]** Gabled (Satteldach); mansard on the Corps de logis only. Covering (slate or tile) **[U]** |
| Spolia | **[D]** Building material from Jägersburg; en.wikipedia claims stone from the Homburg fortress was reused, but its "1714" date predates the palace, so it is dubious |
| Lightning rods | **[D]** On all buildings |

### 2.5 The "Karlsberger Hof" versus "Baumagazin" question

The three sources disagree:
- **de.wikipedia:** the only surviving building is the **Baumagazin**. It was used as a brewery and forester's house, then bought by Karlsberg Brauerei as a director's villa.
- **en.wikipedia:** the only surviving building is the **Karlsberger Hof**, a "farm building near the main entrance". It was used as a sugar factory and forester's house and is owned by the brewery.
- **schloss-karlsberg.de:** "the **Karlsberger Hof, a former Baumagazin**, is the only surviving structure".

**[I]** These are one and the same building: the former Baumagazin, today called Karlsberger Hof, at the WaldPark car park in Sanddorf. Its present form is altered (shorter, new roof, an added storey), so it is **not** a reliable template for the 1790 appearance without Schwan's description.

---

## 3. Interior: rooms, decoration and collections

### 3.1 Room sequence

- **Room guide.** schloss-carlsberg.de has a **room guide (Raumführer)**. It covers the Corps de logis ground floor and upper floor, the Herzog and Herzogin apartments, the kitchen and the collections. It also has a "**Rekonstruktion der Raumanordnung**" (reconstruction of the room layout, research status 2003, flagged by the site itself as partly outdated). It was seen only as search snippets. [D, snippet]
- **Ground floor (EG) pages seen:**
  - r011-012: **Schlafzimmer + Schreibkabinett** (bedroom and writing cabinet), with furniture "Paris c. 1781", destroyed 1793;
  - r017_019: **Gelber Salon + Schreibkabinett** (yellow salon and writing cabinet), "Paris c. 1781".

  The full room list is **[U]**, but these pages are the most direct evidence there is for the room sequence. URLs:
  - [r011-012](http://www.schloss-carlsberg.de/Unterseiten/_Raumfuehrer/Carlsberg/html/r011-012.html)
  - [r017_019](http://www.schloss-carlsberg.de/Unterseiten/_Raumfuehrer/Carlsberg/html/r017_019.html)
  - [Raumanordnung](https://www.schloss-carlsberg.de/index.php/oberamt-homburg/schloss-carlsberg/raumanordnung/55-rekonstruktion-der-raumanordnung4)

  All return HTTP 401 to bots; **open them in a browser**.
- **State rooms** were on the upper floor (en.wikipedia). [D]
- **Paradeschlafzimmer** (state bedroom) with a **lit à la romaine**, said to have influenced furniture for the French king. [D] de/en.wikipedia
- Weber's chapters cover the **Raumeinteilung des Hauptpalais** (room division of the main palace), a **Wintergarten** (winter garden) and the "**Tempelzimmer**" (temple room). [D, table of contents]
- **Staircase.** "42 m" (en.wikipedia) [U]. No description of the staircase was found.

### 3.2 Decoration and furnishing

- **Style.** Mostly **Louis-Seize**. Many pieces were designed by Mannlich and made by suppliers to the French court ([schloss-karlsberg.de](https://schloss-karlsberg.de/schloss-karlsberg/)). [D]
- **Makers** (de.wikipedia). [D]
  - **Georges Jacob**: carved and gilded seating, tables and **panelling (boiseries)**.
  - Sculptors **François-Joseph Duret** and **Martin-Claude Monot**.
  - **Jean-Jacques Kirstein** (Strasbourg): silver.
  - **Lyon** silks and damasks.
  - Further pieces came from older Zweibrücken palaces.
- **Contemporary impression.** "Dazzling" gilding and mirrors, chandeliers (Knigge, via schloss-karlsberg.de). [D, secondary]
- **Surviving furniture and objects.** They are in **Nymphenburg**, the **Munich Residenz**, the **Bamberg** and **Würzburg** Residenzen, **Königliches Schloss Berchtesgaden**, the **Historisches Museum der Pfalz** (Speyer), the **Deutsches Jagd- und Fischereimuseum** (arms), the **Bayerisches Nationalmuseum**, the Munich Silberkammer, the Staatliche Münzsammlung and the Staatliche Graphische Sammlung. [D] de/en.wikipedia; schloss-karlsberg.de
  - Photos of a **secretary** and a **seating group** are on Commons ([SekretärSchlossKarlsberg](https://commons.wikimedia.org/wiki/File:Sekret%C3%A4rSchlossKarlsbergL1000769_(2).JPG), [SitzgruppeSchlossKarlsberg](https://commons.wikimedia.org/wiki/File:SitzgruppeSchlossKarlsbergL1000786_(2).JPG)).
  - **[I]** These, plus the surviving pieces in Munich and Bamberg, are our best reference for **interior textures and furniture models**.

### 3.3 Collections (each a chapter in Weber 1987)

All entries below are [D] unless marked otherwise.
- **Gemäldegalerie.**
  - Weber's chapter covers losses at a Paris auction in 178x and the acquisition of the **Mannlich** and **Pigage** collections. It also discusses Italian, German, Flemish/Dutch and French works.
  - The gallery became a core of the **Alte Pinakothek / Bavarian State Painting Collections**.
  - Commons has a category, "[Former Gallery Zweibrücken – Schloss Karlsberg](https://commons.wikimedia.org/wiki/Category:Former_Gallery_Zweibr%C3%BCcken_-_Schloss_Karlsberg)" (dissolved 1799). Example: Berchem, *Italienische Landschaft*, inv. 377.
  - The number of paintings is **[U]**: a figure of about 2,000 circulates but was not verified.
- **Kupferstichkabinett** (prints), **Bibliothek** (now in **Staatsbibliothek Bamberg**), **Antikensammlung** and **Münzkabinett**.
- **Naturalienkabinett** and **physikalisches Kabinett**. The Rheinpfalz mentions "petrified seashells, scientific instruments, pipes".
- **Waffensammlung** with its own **Büchsenmacherei** (gunsmith's workshop).
- **Preziosen and silver**, and **Gutenbrunn porcelain**.
- A **gilded clock with alabaster**, a **ducat showing the palace**, a pistol, a hunting knife and a **door handle** were shown in *Steinerne Macht* 2018 ([Rheinpfalz 2018](https://www.rheinpfalz.de/lokal/kreis-suedwestpfalz_artikel,-zerst%C3%B6rte-pracht-jetzt-wieder-sichtbar-_arid,1312894.html)).
  - **[I]** The **ducat** is a further contemporary depiction of the palace worth finding (Staatliche Münzsammlung München?).

---

## 4. Primary and visual sources

### 4.1 Historic plans, maps and views

| # | Source | Date / maker | Holder | Online copy / licence | Notes |
|---|---|---|---|---|---|
| V1 | **"Vue du Château de Carlsberg"**, watercolour pen drawing | **1790, Philipp Adolf Le Clerc** | **Stiftung Karlsberger Hof**, Homburg-Sanddorf | [Commons (550 × 339 px only)](https://commons.wikimedia.org/wiki/File:Schloss_Karlsberg_Leclerc.jpeg), **PD**; a detail at 747 × 253 px: [Karlsberg_III.jpg](https://commons.wikimedia.org/wiki/File:Karlsberg_III.jpg), PD | **The** key view (Weber discusses it). A high-resolution copy is needed. The catalogue *Kunstschätze aus Schloss Carlsberg* (1989) reproduces it |
| V2 | **"Pleine vue du Carlsberg"** (full view) | **1791**; Commons credits "Friedrich and Wilhelm von Lüder" | [U] | [Commons Karlsberg_II.jpg (1300 × 857)](https://commons.wikimedia.org/wiki/File:Karlsberg_II.jpg), PD; source [heinz-wember.de](https://heinz-wember.de/gen/wittelsbacher/pics/SchlossCarlsberg.htm) | de.wikipedia captions it "Die Gesamtanlage 1791". The artist attribution is unverified |
| V3 | **"Vue du Carlsberg"**, cartouche on Friedrich **Herdegen**'s *Carte von den beiden Ober-Aemtern Zweybrücken und Homburg*, hand-coloured engraving | **1791** | **Bayerische Staatsbibliothek**, shelfmark **Mapp. XI,245 l** | [U] online; to locate in BSB digital collections | Cited in the BuS 2012 figure caption (snippet) |
| V4 | **Leporello "Ansichten der Schlösser und Burgen im Herzogtum Zweibrücken"**, 6 strips of watercolour pen drawings, 1000 × 485 mm; **first view: Schloss Carlsberg** | **1788**, Ernst Ruppenthal (aged 12) under his father **Philipp Ruppenthal**; dedicated to the duke on 29 Apr 1788 | **Historisches Museum der Pfalz, Speyer**, inv. **BS_2777** | [museum-digital 1774719](https://global.museum-digital.org/object/1774719); **image CC BY-NC-ND** (HMP / P. Haag-Kirchner) | An independent contemporary view. **High priority** |
| V5 | **Meissen porcelain tray/plate** showing the **Hauptpalais** | 2nd half of the 18th c., ducal possession | Returned to Zweibrücken (Langeloh Porcelain report) | [Commons 341 × 231 px](https://commons.wikimedia.org/wiki/File:Le_Ch%C3%A2teau_de_Carlsberg.jpg), PD-Art | "One of the few authentic depictions"; Weber discusses it |
| V6 | **"Plan perspectif" Nr. I and Nr. II** (+ two variants of Nr. II) | 1780s? | **"Speyerer"** (Speyer: Landesarchiv or Historisches Museum der Pfalz?) | [U] | Bird's-eye perspective plans. **Probably the most important layout sources.** Weber |
| V7 | **"Plan perspectif" Nr. III**, drawing | [U] | **Munich** (BayHStA / Staatliche Graphische Sammlung?) | [U] | Weber |
| V8 | **"Plan perspective de la ville de Hombourg"** | **1785** | [U] | [Commons Karlsberg_I.jpg (632 × 121)](https://commons.wikimedia.org/wiki/File:Karlsberg_I.jpg), PD; via schloss-carlsberg.de | Panorama strip; may show the Karlsberg on the skyline [U] |
| V9 | **Map of the Oberamt Homburg** | **1782, P. Schäfer** | [U] | [Commons Karlsberg_Karte.jpg (1075 × 967)](https://commons.wikimedia.org/wiki/File:Karlsberg_Karte.jpg), PD | Early stage of the site |
| V10 | **"Geometrische Karte über das Ober Amt Zweybrücken nebst dem … Amt Homburg"** | **1774, Johann Theobald Fritsch** | Hungarian archive collection | [Hungaricana B IV a 489](https://maps.hungaricana.hu/en/HTITerkeptar/23016) | Pre-palace (Louisenhof) state. Licence [U] |
| V11 | **Map of the ruins** | **1805** | [U] | [Commons Karlsberg_karte_II.jpg (642 × 531)](https://commons.wikimedia.org/wiki/File:Karlsberg_karte_II.jpg), PD | **Footprints of the ruins.** Key for georeferencing |
| V12 | **Lagepläne 1804 and 1825** (+ 19th-c. copies of 1825) | 1804, 1825 | [U] (Speyer or Munich archives?) | [U] | Weber reproduces them. **Key for footprints** |
| V13 | "Ein verlorenes Monumentaltableau des 19. Jh." | 19th c. | lost | — | Weber |
| V14 | **"Einfall der Franzosen auf Schloss Karlsberg 1793"** | [U], date not given | [U] | [Commons 653 × 449](https://commons.wikimedia.org/wiki/File:Schloss_Karlsberg_Franzosen.jpg), PD-marked (source: uni-regensburg.de) | Probably a 19th-c. image [U] |
| V15 | **Modern Lageplan** (hand-drawn), 2050 × 1477 px | **2006**, Commons user "Mannlich" = **schloss-carlsberg.de** (Schwan's portal) | — | [Commons Karlsberg_Lageplan.gif](https://commons.wikimedia.org/wiki/File:Karlsberg_Lageplan.gif), **CC BY-SA 2.0 DE** | A research-based site plan. **Best available layout drawing online** |
| V16 | **Modern "Ansicht Karlsberg"** (elevation strip), 3023 × 750 px | **2006**, same author | — | [Commons Ansicht_Karlsberg.png](https://commons.wikimedia.org/wiki/File:Ansicht_Karlsberg.png), **CC BY-SA 2.0 DE** | **A reconstructed elevation of the building line.** Key for the "Ansichten" |
| V17 | Lau painting "Schloß Karlsberg" | 1978, Heinrich Lau (1899–1998) | Karlsberger Hof | ©, not free | An imaginative reconstruction; low evidential value |
| V18 | 2006 site photos (Ehrenhof, Paradestraße, Marstall ramp, Remisen site, Kavaliersbau cellar, Baumagazin, Forsthaus site, Karlslust items) | 2006, schloss-carlsberg.de | — | Commons, **CC BY 2.5** (see §2.3 links) | Ground truth for remains |

**Archive leads not verified (all [U]):**
- **Bayerisches Hauptstaatsarchiv** (Plansammlung of about 14,200 units; Pfalz-Zweibrücken files; "Bericht den dermaligen Zustand des sämtlichen Carlsberger Bauwesens betreffend", see 4.2).
- **Landesarchiv Speyer** (Bestand B2, Pfalz-Zweibrücken).
- Staatliche Graphische Sammlung München (Mannlich drawings).
- Historisches Museum der Pfalz.
- Stiftung Karlsberger Hof.
- The Saarland-Museum 1989 catalogue.

### 4.2 Written primary sources

| Source | Content | Availability |
|---|---|---|
| **"Bericht den dermaligen Zustand des sämtlichen Carlsberger Bauwesens betreffend"** | A report on the state of all Carlsberg building works, edited or analysed as the subtitle of Schwan 2010. **[I]** Probably an official building inventory, likely from 1793 or around the duke's death (1795). Author and date [U] | Inside Schwan 2010; the archive original is [U] |
| **Craftsmen's invoices** (Handwerkerrechnungen) | Rediscovered by Schwan; used to date and reconstruct the buildings | Archives [U]; summarised in Schwan 2010 ([SWR 2015 film synopsis](https://www.fernsehserien.de/filme/schloss-karlsberg-das-versunkene-versailles-des-suedwestens)) |
| **Court accounts up to 1797** | | [U] |
| **Mannlich's memoirs** | Building director's account: the purchase (pp. 202 f.), the 1785 fireworks (pp. 226 ff.), garden scenes, the rescue of the collections | **Several editions:** German by **Eugen Stollreither**, first as *Ein deutscher Maler und Hofmann* (Berlin: Mittler), then ***Rokoko und Revolution***, 3rd edn 1923 ([DDB](https://www.deutsche-digitale-bibliothek.de/item/SSAEQRURW57ZPKKYGC4H6FBS32Y7MIOL)), reissued 1966. French original ***Histoire de ma vie***, ed. K.-H. Bender & H. Kleber, Trier: Spee 1989– ([review](https://journals.ub.uni-heidelberg.de/index.php/fr/article/download/56872/48360/169201)). **[I]** The 1910/1913 Stollreither edition should be public domain (editor d. 1956? [U]) and may be digitised. Not found online in this session |
| **Fürstenwärther, "Gedächtnis der Maximilian und Wilhelminen geheiligten Abende", 1786** | The 1785 wedding festivities (Rotunde, illuminations) | *Mitt. Hist. Verein der Pfalz* 7 (1878) 63–70, [dilibri](https://www.dilibri.de/rlb/periodical/pageview/1165160), **PD** |
| **Zweibrücker Zeitung, 1 Jan 1786, no. 1** | Festivities report | [Google Books](https://books.google.de/books?id=DDNEAAAAcAAJ&hl=de&pg=PT4), **PD** |
| **Knigge 1792** | Visitor's account ("Feenschloss", gilding, mirrors) | **[I]** Probably in his *Briefe, auf einer Reise aus Lothringen nach Niedersachsen geschrieben* (1793); the passage was not seen [U] |
| **G. C. Crollius, 1785 visit** | Visitor's account | Mentioned in BuS 2012 (snippet); [U] |

### 4.3 Existing reconstructions, models and films

| # | What | Who / when | What it shows | Link / status |
|---|---|---|---|---|
| R1 | **"3D-Rekonstruktion und Animation: Schloss Karlsberg 1789"** (YouTube) | Channel **Historisches Museum Saar** | Animated 3D reconstruction, state of 1789. **[I] Very probably the "video with a 3D object" the user means**, derived from R2 | [youtube.com/watch?v=kfnE6HdXmVo](https://www.youtube.com/watch?v=kfnE6HdXmVo). Licence: standard YouTube [U]. Linked from the [WaldPark tourism page](https://www.outdooractive.com/de/poi/saarpfalz-kreis/waldpark-schloss-karlsberg/61542782/) |
| R2 | **Photorealistic computer reconstruction**, large format, of the palace with its gardens and outbuildings in the landscape, before 1793 | Exhibition *Steinerne Macht*, **Historisches Museum Saar, 17 Nov 2018 – 23 Jun 2019**. Credits: **Historisches Museum Saar, Andreas Matzerath, Jutta Schwan, with Marc Engel and Simon Matzerath** ([museum page](https://www.historisches-museum.org/steinerne-macht)). The Rheinpfalz names Amsterdam graphic artist **Mikko Kriek** as the maker, "photorealistic down to the single brick" ([Rheinpfalz 16 Nov 2018](https://www.rheinpfalz.de/lokal/kreis-suedwestpfalz_artikel,-zerst%C3%B6rte-pracht-jetzt-wieder-sichtbar-_arid,1312894.html)) | One of 4–6 lost sites reconstructed. The image was also used in Homburg tour adverts ([homburg1.de](https://homburg1.de/homburg-wanderung-fuehrt-zum-versunkenen-schloss-karlsberg-266248/)) | **Scientifically supervised by Schwan**, so it is the **best existing visual hypothesis**. Probably in the catalogue *Steinerne Macht* (Matzerath/von Büren eds., Schnell & Steiner 2020, 2nd edn 2021, 680 pp., ISBN 978-3-7954-3387-1). © |
| R3 | **schloss-carlsberg.de CAD reconstruction** | From about 2003–2006; software **ViCADo** donated by **mb AEC Software** (Kaiserslautern); viewer "mb-player" | Seven planned stages (shell → façade elements → roof → windows → textures/colours → terrain → vegetation); "first interim results" online | [rekonstruktion page](https://www.schloss-carlsberg.de/index.php/oberamt-homburg/schloss-carlsberg/84-rekonstruktion/92-erste-zwischenergebnisse-der-rekonstruktion) (401 to bots). Status [U] |
| R4 | **Physical model "Modellnachbau von Schloss Karlsberg"** | Maker and place [U]. Shown on the Stiftung Karlsberger Hof site (images Modell_2, Modell_3) | Scale model of the palace | [schloss-karlsberg.de/schloss-karlsberg](https://schloss-karlsberg.de/schloss-karlsberg/). **[I]** Possibly on display at the Karlsberger Hof. **Ask the Stiftung** |
| R5 | "Nachbildung einer Kaskade" | [U] | Cascade replica (photo) | same page |
| R6 | 1931 Orangerie reconstruction attempt; reconstruction attempt for the Orangerie theatre | [U] / Weber | Drawings | Weber 1987 |
| R7 | **Modern Lageplan + Ansicht** (Commons V15/V16) | schloss-carlsberg.de, 2006 | 2D plan and elevation | CC BY-SA 2.0 DE |
| R8 | Heinrich Lau painting | 1978 | Artistic view | © |
| R9 | **"Schloss Karlsberg – das versunkene Versailles des Südwestens"**, TV documentary, 45 min | **SWR/SR, first broadcast 13 Sep 2015**, author **Sven Rech** | Myths versus the evidence; Schwan's invoices; Mannlich's memoirs; Munich. 3D content [U] | [fernsehserien.de](https://www.fernsehserien.de/filme/schloss-karlsberg-das-versunkene-versailles-des-suedwestens); [SR-Mediathek id 142850](https://www.sr-mediathek.de/index.php?seite=7&id=142850) |
| R10 | **Short film "Schloss Karlsberg. Ein bisschen mehr als 'nur Gemäuer'"**, about 4 min | **Saarpfalz-Kreis**, 2025; students **Nina Heinrich, Fabian Schreiner, Daria Schwan** (HS Kaiserslautern, Zweibrücken campus, Digital Media Marketing; supervised by Prof. Barbara Christin); contact Dr. Jutta Schwan | History plus today's remains; **drone footage** and editing. **No 3D reconstruction mentioned** | [youtube.com/watch?v=Z4uGahSjIRI](https://www.youtube.com/watch?v=Z4uGahSjIRI) (channel Saarpfalz-Kreis) |
| R11 | Model of **Schloss Jägersburg** (not Karlsberg) | Museum in the Gustavsburg (Jägersburg) | Related palace of the same duke | search snippet; useful as a comparison |

---

## 5. Literature

### 5.1 Core monographs

1. **Jutta Schwan, *Studien zur Baugeschichte von Schloss Carlsberg. "Bericht den dermaligen Zustand des sämtlichen Carlsberger Bauwesens betreffend"*.**
   - Neustadt/Weinstr.: Stiftung zur Förderung der pfälzischen Geschichtsforschung, 2010 (Reihe B, vol. 9). XXXI + 747 pp., 140 illustrations. ISBN 978-3-9810865-6-0. €80.
   - Dissertation, Saarbrücken 2009.
   - Sources: [Heidelberg catalogue](https://katalog.ub.uni-heidelberg.de/cgi-bin/titel.cgi?katkey=66839549), [geschichtlicher-buechertisch](https://www.geschichtlicher-buechertisch.de/Neuheit/Studien-zur-Baugeschichte-von-Schloss-Carlsberg.html), [publisher](http://stiftung-pfalz.de/vertrieb.php).
   - **This is the authoritative source for every building.** Buy or borrow it.
2. **Wilhelm Weber, *Schloss Karlsberg. Legende und Wirklichkeit. Die Wittelsbacher Schlossbauten im Herzogtum Pfalz-Zweibrücken*.**
   - Homburg-Saarpfalz: Ermer, 1987. 607 pp. ISBN 978-3-924653-02-6.
   - Sources: [DDB](https://www.deutsche-digitale-bibliothek.de/item/BAGTTOBT7G5JJGN2ZSX46WW7OQ4FVBNO); [table of contents (DNB scan)](https://d-nb.info/871317184/04).
   - Our OCR of the table of contents (relevant pages):
     - pp. 139–209: Baugeschichte (building history), Zerstörung (destruction), Bildnerische Darstellungen (depictions), Frühere Grundrisse (earlier plans), Ausgrabungen (excavations), Hauptpalais (main palace);
     - pp. 209–271: Orangerie with Theatersaal and Rundbau;
     - p. 271: Marstall;
     - pp. 285–319: Jägermeisterei, Kasernen, buildings below the plateau, Tschifflik, Monbijou, Kirchturm, Baumeisterfrage (the question of the architect);
     - p. 319 ff.: gardens, menagerie, residents, collections;
     - p. 401: Gemäldegalerie;
     - p. 475: Kupferstichkabinett;
     - p. 489 ff.: Mannlich.
   - Older and partly superseded by Schwan, but rich in plans and pictures.
3. W. Weber, *Schloß Karlsberg. Die vergessene Residenz des Herzogs Karl II. August*. München 1984, 64 pp. ([ÖAW catalogue](https://oeaw.ac.at/resources/Record/990002876020504498/UserComments)).

### 5.2 Articles and other works

- **Jutta Schwan, "Schloss Carlsberg bei Homburg-Saar – die Wiederentdeckung eines Wittelsbacherschlosses",** *Burgen und Schlösser* 53 (4/2012), pp. 241 ff.
  - [PDF on Heidelberg journals](https://journals.ub.uni-heidelberg.de/index.php/bus/article/download/53625/47240/166406). Bot-blocked; **open in a browser**. Open access [U].
  - From the snippets: it uses archive research that "for the first time allows a reconstruction of the chronological and structural sequence and decoration of the buildings". It describes the three-wing layout around the Ehrenhof, extended northwards by a collection wing and picture gallery. Figures include the Herdegen "Vue de Carlsberg" 1791, Weber p. 190, and Schwan 2010 p. XXXI (**[I]** probably a plan in the front matter).
- J. Schwan & S. Ulrich, *Schlossruine und Waldpark Karlsberg Homburg*, 2009. Publisher [U]. Likely a short guide.
- J. Schwan, *Feuerwerk und Festkultur* (2007); *Ein Gärtner von Welt* (2014, probably on Petri or Sckell); *"Diener zweier Herren"* (2014). Bibliographic details are in the de.wikipedia literature list.
- Reiner Marx, *"dies Feenschloß mit seinen Schätzen"* (2010). Contemporary accounts; details [U].
- Ralf Schneider, "Carlsberg – Carlslust", *Die Gartenkunst* 11 (2/1999), pp. 339–376. Garden history.
- Ralf Schneider, *Schlösser und Landsitze der Herzöge von Pfalz-Zweibrücken* (2003).
- Reinhard Schneider, "Über den denkmalpflegerischen Umgang mit Ruinen", *Denkmalpflege im Saarland, Jahresbericht 2013*, pp. 127–133. Conservation of the ruins.
- Landesdenkmalamt Saarland, *Jahresbericht 2006* (planned 2007 investigation in the first forecourt). There is also a [publication list](https://www.saarland.de/SharedDocs/Downloads/DE/LDA/Publikationsliste_Landesdenkmalamt.pdf?__blob=publicationFile&v=1) (not read).
- L. Dahl / K. Lohmeyer, *Das barocke Zweibrücken und seine Meister* (1957).
- J. Conrad & S. Flesch (eds.), *Burgen und Schlösser an der Saar* (Saarbrücken 1988), pp. 448–453. en.wikipedia reference; it credits "Ralf Schneider", confusingly.
- Saarland-Museum (ed.), ***Kunstschätze aus Schloss Carlsberg. Die Sammlungen der Herzöge von Pfalz-Zweibrücken*** (Saarbrücken 1989), ISBN 3-925303-42-1. Exhibition catalogue with the Le Clerc view. The subtitle is [U-bk].
- S. Matzerath & G. von Büren (eds.), ***Steinerne Macht. Burgen, Festungen, Schlösser in Lothringen, Luxemburg und im Saarland*** (Regensburg 2020; 2nd edn 2021), 680 pp. Contains the Karlsberg chapter and reconstruction (R2) [I].
- Mannlich, memoirs: see §4.2.
- Children's booklet: J. Schwan et al., *Mit Gusti zum Karlsberg* (2019), €2 from the Saarpfalz-Kreis.

### 5.3 Institutions and people to contact

- **Dr. Jutta Schwan**, art historian at the Saarpfalz-Kreis, the leading expert on the palace (Saarpfalz-Kreis 2025).
- **Stiftung Karlsberger Hof**, which owns the Le Clerc view and the model: info@schloss-karlsberg.de, +49 6841 101168 ([outdooractive](https://www.outdooractive.com/de/poi/saarpfalz-kreis/waldpark-schloss-karlsberg/61542782/)).
- **Historisches Museum Saar** (Dr. Simon Matzerath), for the 3D reconstruction R1/R2.
- **Landesdenkmalamt Saarland**, for excavation records (1950s; 2007).
- **Historisches Museum der Pfalz Speyer**, for the Ruppenthal leporello and possibly the "Speyerer Plan perspectif".

---

## 6. What this means for the reconstruction

**Confidence by element:**

| Element | Basis | Confidence |
|---|---|---|
| Site layout (positions of the palace, Orangerie, Karlslust features, ponds, avenues) | Documented sources + 1805 map + LiDAR | **Medium–high** |
| Footprints of the main palace and wings | 1804/1825/1805 plans + LiDAR + modern Lageplan V15 | **Medium**, once the plans are obtained |
| Elevations (storeys, roof forms, overall silhouette) | Le Clerc, Ruppenthal, 1791 view, Meissen plate, modern Ansicht V16 | **Medium**: storeys and roof types are known, exact axis counts are not |
| Materials and colours | Documented only for the Orangerie | **Low–medium** |
| Interiors (room sequence) | Schwan's room guide (2003 state) + Weber chapters | **Low** until those are read; the decoration *style* is well documented (Louis-Seize, Jacob furniture) |
| Karlslust structures | Cascade dimensions documented; Bärenzwinger geometry documented and still visible; Tschifflik form unknown | **Mixed** |

**Top source priorities** (for the orchestrator to request from the user):
1. High-resolution scans of the **Le Clerc 1790** view and the **Ruppenthal 1788** leporello.
2. The **1804/1805/1825 Lagepläne**.
3. The full PDF of **Schwan, BuS 4/2012**.
4. **Schwan 2010**, especially the plan section (p. XXXI and the plates).
5. The **HMS 3D video** (R1) as visual reference and Video2World input. This needs permission from the Historisches Museum Saar to reuse.

---

## 7. Open questions

1. What are the exact dimensions and window-axis counts of the Corps de logis, the wings, the Galerieflügel, the Marstall and the Reithalle, the Kavaliersbau and the Orangerie? These are in Schwan 2010 and Weber 1987, not online.
2. Which way did the Ehrenhof face? Where was the main façade, given that the Paradestraße ran "along the palace front"?
3. Was the roof covering slate or tile? What was the render colour of the main buildings?
4. Where are the "Speyerer Plan perspectif" I/II and the Munich Plan III held, and are they digitised?
5. Who excavated in the 1950s, and is there a plan? What did the 2007 forecourt investigation find?
6. What is the "42 m staircase" claim based on?
7. Is "Zwinger 1780–83" the Hundezwinger or the menagerie?
8. Do the Herzogskastanien survive?
9. Who made the "Modellnachbau" (physical model), and where is it?
10. Was Mikko Kriek the maker of the HMS reconstruction, or were Andreas Matzerath and Marc Engel (or both)? Can the model or video be licensed?
11. Purchase price: 23,000 or 35,000 Gulden?
