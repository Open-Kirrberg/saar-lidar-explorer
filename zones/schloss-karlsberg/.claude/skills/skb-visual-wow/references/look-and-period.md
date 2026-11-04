# Target look and period rules

Read this before changing anything that affects how the scene *looks*. It sets the art direction. The values come
from the project research and are tagged: **D** documented, **D->** documented elsewhere and transferred,
**I** inferred, **N** period norm, **U** unknown/assumption, **HMS** from the HMS 2022 reconstruction (reference
only). Where a source section already has the detail, this file points to it instead of copying it.

## 1. The look in one paragraph

A bright, young residence on an open, cultivated ridge on a July day in 1789. White-grey limewashed render with
grey painted members and red sandstone plinths, under blue-grey slate. A red-tiled service town lies beyond. Young
avenues and shrub clumps stand in hay meadows, with forest only as belts and on the east plateau. Late-afternoon sun
rakes the west court front, soft blue haze layers the surrounding hills, and at night everything is dark blue except
warm candle points. It should feel like a calm, well-lit documentary film, not a fantasy game and not a CAD model.

Closest period colour reference for sky, haze and render: the Le Clerc gouache of 1790 (research/07 §1.2), which
shows pale render, grey or pinkish dressings, a bare gravel or sand forecourt and young round trees. The HMS film is
a reference for the overall impression, never a source of pixels (research/06).

## 2. Two looks

| | **Dokumentation** (default, proposed) | **Kino** (Rundflug, photo mode) |
|---|---|---|
| Tone mapping | Khronos PBR Neutral: base colours stay 1:1 up to the highlight shoulder | AgX + a 32³ grade LUT |
| Grade | none | subtle warm, low-contrast "gouache" LUT echoing Le Clerc 1790 [I], light vignette, optional grain |
| Exposure | EV curve over sun elevation (light-sky-post.md §3) | same curve, ±0.3 EV artistic offset per shot |
| Post | AO + SMAA, bloom only above HDR 1.0 (candles, sun glints) | + DOF in photo mode, stronger bloom at night |
| Purpose | Compare against sources and plans; colours as catalogued | Wow, video capture, stills |

Why Neutral for the default: the catalogue and `MATERIAL_BASE` colours are documented or tagged values. ACES shifts
hue and saturation (it pushes yellows to white and reds to orange), so the viewer would show a different colour than
the source says ([Khronos PBR Neutral](https://github.com/KhronosGroup/ToneMapping);
[three.js forum: Tone Mapping Overview](https://discourse.threejs.org/t/tone-mapping-overview/75204)). The choice
was an open question (audit §8 Q2); backlog KB-I41 decides it by this recommendation (Neutral default, AgX for
"Kino") unless the user objects, and records new choices as ADRs in `../../docs/adr/`. Switching costs nothing:
put both behind `skb.look('doku' | 'kino')` and a German UI toggle ("Darstellung: Dokumentation / Kino").

## 3. Time-of-day presets (15 Jul 1789, `viewer/src/sun.ts`, azimuth from true north)

| Preset (UI label) | Hour | Sun | What it shows | Tag |
|---|---|---|---|---|
| Morgen | 07:00 | 25° / 85° | Garden (east) front lit, long shadows over the parterre and lawn; morning mist over the Weiher | computed; mist [I] |
| Vormittag | 10:30 | 56.5° | Today's default: flat light, good for reading plans, poor for wow | computed |
| **Nachmittag (Heldenstunde)** | **17:30** | **22° / 278°** | Court (west) front raked by sun from the west; cornices, reveals, risalits read | computed; research/02 §3.3 [N] recommends late afternoon |
| Goldene Stunde | 19:00 | 7.9° / 294° | Warm façades, long shadows across the Ehrenhof, glowing crown glass | computed |
| Dämmerung | 20:30 | −4.4° | Civil twilight: blue sky, no sun, first lit windows | computed; twilight bands per [Wikipedia: Twilight](https://en.wikipedia.org/wiki/Twilight) |
| Nacht | 22:00 | −13.7° | Dark blue night, few lit windows, candle-lit rooms | computed; lit share [U] |
| Fest | 22:00 | −13.7° | Chandeliers and illuminations lit (§5) | event [D], arrangement [I] |

Other computed hours (sun.ts, local mean time; refraction-corrected rise/set at −0.833°): sunrise 04:10, sunset
20:02, civil twilight ends (−6°) 20:44, nautical twilight ends (−12°) 21:40; morning civil twilight begins 03:28.
The UI slider covers 4.5–21 h (`viewer/src/ui.ts`); `skb.set('hour', 22)` works beyond it. Full table: audit §2.

- **Change the default** start from `view-west` at 10:30 to a hero shot: `view-west` or `view-ehrenhof` at 17:30
  (audit P6, L7). Each POI view may carry a preferred hour.
- The Ehrenhof faces west because the palace axis lies at 80.5° grid (research/03 §5). Garden-side shots want
  morning light, court-side shots want afternoon light.
- Weather: clear to lightly clouded. A July high-pressure day is plausible [I]; the weather of 15 Jul 1789 is U.
  three's streak clouds are off (`cloudCoverage` 0); wave 10 draws fair-weather cumulus and their shadows from one
  coverage field (`viewer/src/clouds.ts`, "Wolken": `air` default = only from the air and in the Rundflug's aerial
  shots, `on`, `off`). No rain, snow or storm presets without a reason.

## 4. Palette and materials: what the look may and may not change

The colours are history, not art direction. Change them only through the evidence chain (skill
`skb-historic-architecture`, research/09 §6.2 M1–M9, research/02 §2.9). Pending documented proposals that also
help the look:

| Material | Now | Proposed | Why it looks better | Tag (research/09 §6.2) |
|---|---|---|---|---|
| `wood.shutter` | `#7D8A78` (catalogue default `#5E665B`) | blue-grey `#5F6F7A` | Cools the façade rhythm against warm render; less "army green" | D-> Baunetz; HMS |
| `roof.slate` | `#4B5057` | `#4A525C` | Bluer slate separates from the red tiles (Pleine vue colour code) | D PV |
| new `render.member` | members in `stone.*` | `#B9B8B2` painted render | Grey members on white-grey walls (Koblenz 1777–93 scheme) | D-> Koblenz; I |
| `glass.crown` | `#1d2a30` | green-grey `#22302C` + 0.5–1.5° per-pane jitter | Low sun breaks up across the panes | N |
| `metal.iron` | `#2B2D30` | `#2E3439` | Blue-black ironwork | N |
| `render.lime` | uniform `#ECE8DF` | ±3 % per-building limewash variation (warm 1778–82, cool 1785–88), streaks under sills | Breaks "CG white" honestly: a rushed, additive site (research/09 §1.2–1.3) | N; I |

Do **not**:
- shift hues in a shader or a LUT in Dokumentation mode;
- copy pink (Benrath) or red-and-yellow (Mannheim) schemes (research/09 §0 item 6);
- add dirt beyond what a building at most 15 years old would show (research/02 §3.3, D->);
- add ornament, statues or fountains that the research doesn't support. Garden objects come from research/11
  S1–S16 through `skb-schlossgarten`.

## 5. Light sources that are period-correct

- **No electric light anywhere.** Light sources are the sun, the sky, candles, hearths, oil or candle lanterns,
  torches and illumination lamps.
- **Candles:** 1800–1930 K and about 13 lm each
  ([hypertextbook](https://hypertextbook.com/facts/1999/JaneFishler.shtml)). Use 1850 K ≈ `#FF8A2A` sRGB
  ([vendian blackbody table](http://www.vendian.org/mncharity/dir3/blackbody/)).
- **Everyday evening:** table candelabra only. Chandeliers and wall sconces were lit with bleached beeswax for large
  celebrations (D-> SPSG, [Chandeliers and Luminaria](https://spsg.de/en/research-collections/collections/chandeliers-and-luminaria)).
  So "Nacht" lights a few candelabra; "Fest" lights the chandeliers.
- **Lit windows at night:** seeded per room, about 10–20 % in the Corps de logis and fewer in the Nutzbauten [U].
  Most rooms were dark. Colour 1850 K, dimmed by shutters or curtains.
- **Exterior:** lanterns at the main portals and the Ehrenhof gate are a period norm [N]; their positions are [U],
  so label them as hypothesis.
- **"Festbeleuchtung 1785":** the 1785 wedding festivities had illuminations (Fürstenwärther 1786) and fireworks
  (Mannlich), research/01 §4.2 [D for the event]. Period garden fêtes used thousands of small coloured glass lamps
  (SPSG keeps 280) [D->]. Draw them as instanced emissive points along cornices, parterre borders and the gallery
  rotunda, warm 1850 K with small hue jitter. The arrangement is [I]. Label: "Festbeleuchtung (wie 1785
  beschrieben, Anordnung Hypothese)". Note the 1785 rotunda and Hymen temple were temporary and are *not* in the
  1789 state (research/10 §b.2 KB-B13, §b.4 KL-B49). A "December 1785" scene would be a separate, optional state.
- Fireworks are documented for 1785 [D]; their look is [I]. Keep them short and optional.

## 6. Landscape look (rendering side; content via `skb-schlossgarten`)

- **Open ridge, not a forest clearing.** The 1791 Pleine vue, Le Clerc 1790, the Petri plan and HMS all show
  meadows, fields, a vineyard and avenues, with forest only as belts and on the east plateau (research/11 §1.5, S1).
  Today's "canopy > 8 m = forest" rule (`viewer/src/forest.ts` header, tag U) is the biggest visual *and* historical
  error. Until S1 lands, don't polish the forest carpet. Make it cheap (P1) and visually quiet: darker,
  desaturated with distance, a forest-edge band.
- **July palette** (research/11 §3.1):
  - hay meadows as a patchwork of mown light-green and straw strips;
  - golden grain fields;
  - lime avenues mid/yellow-green (`T. × europaea` in flower early July);
  - horse chestnut dark green (no leaf-miner browning in 1789);
  - sweet chestnut with cream catkins;
  - yew cones near-black green;
  - box edgings dark green;
  - orange trees in tubs.
- **Young plantings:** avenues and clumps 1–11 years old (crowns 4–8 m), mixed with retained mature trees
  (research/11 §3.2). Small young trees against big old ones read as "a new garden": a good honest wow cue.
- **Ground colours** (research/11 S15, [N]/[I]): pinkish-ochre Buntsandstein gravel about `#B79A84`, yellow parterre
  sand `#D3BE8A`, a light sand court as in Le Clerc. They replace today's uniform grey-ochre gravel.

## 7. Wow levers that need no new evidence

Ranked by impact per effort (research/09 §6.6, audit §5.10):

1. 17:30 raking light on the west court front, with long shadows across the Ehrenhof.
2. Calibrated sky light: shaded walls go cool blue, sunlit walls warm. Gilding reads gold and glass reflects the sky.
3. Aerial perspective: blue layered hills in the distance, warm haze toward the sun.
4. Low sun glinting on hand-made crown glass (per-pane jitter).
5. Blue-grey slate palace against the red-roofed service town.
6. Gilt gate tips and five-point lightning rods catching the light.
7. Dusk: deep blue sky, the first warm windows, candle-lit Festsaal with bloom mirrored in the Spiegel.
8. Fest mode with illuminations, on a night Rundflug.
9. Young landscape garden: open lawns, clumps, serpentine paths, a fountain jet on the axis (research/11 S2, S3).

## 8. Labels and honesty in the image

- German UI labels; the confidence colours and "Schauen, nicht graben" stay available in every mode.
- Photo-mode exports burn in: "Rekonstruktion = Hypothese · Schloss Karlsberg 1789 · <data attribution> ·
  Schauen, nicht graben".
- The Rundflug shows a small caption per shot with the hypothesis level of what is in view (e.g. "Galerieflügel –
  Konfidenz mittel").
