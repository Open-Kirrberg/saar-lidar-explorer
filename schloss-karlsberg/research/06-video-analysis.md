# 06 — Reference video: shot analysis, architectural reading, reconstruction suitability

> Analysis date: 2026-11-01. Source: "3D-Rekonstruktion und Animation: Schloss Karlsberg 1789",
> © Architekturvisualisierung Matzerath + Historisches Museum Saar (realisation: Andreas Matzerath, Simon Matzerath,
> Dr. Jutta Schwan; upload 2022-11-16). Local copy `video2world/input/karlsberg_1789_hms_2160p.webm`
> (3840×2160, 60 fps container, 124.2 s, VP9, no audio). Background and the Video2World question: see
> [04-video-and-video2world.md](04-video-and-video2world.md). This file supersedes its §1.2 shot list (finer cuts).
>
> **Copyright.** The video and every frame are copyrighted and for private analysis only. This document describes
> the video; it embeds no frames. Frames and crops are local and git-ignored (`video2world/frames/`), listed in §7.
>
> **Evidence tags** (as in the other research files): **[D]** directly seen in the frame(s) cited · **[I]** inferred
> from what is seen · **[U]** uncertain/unresolved · **[T]** tool measurement. Every observation cites source
> times `t=` in seconds.
>
> **What the video is, as evidence.** A modern, research-based CG model (Schwan). It is a strong *secondary* source,
> not a record. The description says it is "more precise than the idealising historic views". Where it disagrees
> with the history notes ([01](01-history-and-sources.md)) or the LiDAR ([03](03-lidar-site-analysis.md)), §5 lists it.

---

## 1. Key findings (short)

1. **Layout of the main palace [D/I].** A **three-wing Ehrenhof (U-plan)**. The corps de logis is at the closed end,
   two long arms frame the court, and the court is open on the fourth side toward the Schlossallee. Attached to the
   open-side end of one arm is a long **Sammlungsflügel**. It runs parallel to the corps de logis. Together with a
   free-standing **Küchenbau** and a one-storey **Bildergalerie** ending in a domed **Rotunde**, it closes a second
   court (**Küchenhof**). Beyond that court lie walled gardens with the **Treibhäuser**. Next comes a long row of
   **red-roofed Nutzbauten / Marstall** along a straight avenue. A separate **Orangerie** stands on the other side
   of the palace [D: t=34.3–36.9, 40.5, 42.6, 113.5].
2. **Orientation (model frame) [D/I].** The weather vanes on the roofs carry legible **N/O/S/W letters**.
   Two independent shots read consistently: the court view looks east (t=16.5) and the south-arm view looks north
   (t=71.5, t=76.5). The model frame is therefore: **Ehrenhof open to the W, corps de logis on the E, Küchenhof +
   Sammlungsflügel + gardens + Nutzbauten to the N, Orangerie to the S/SW, Englischer Garten to the E.** This matches
   the LiDAR footprints in [03](03-lidar-site-analysis.md) closely (§4). The real grid is rotated: walls run at
   ≈ 79° true, so "W" means ≈ WSW. The sun direction in the video is **not** evidence (§4).
3. **Counts [D] and sizes [I], assuming a window-axis spacing of 3.2 m (range 3.0–3.5 m):**
   - Corps de logis court front: **15 axes (4 + 7 + 4)**, ≈ 48 m (45–52 m).
   - South arm outer front: **21 axes**, ≈ 67 m (63–74 m).
   - Sammlungsflügel: **≈ 19 + 4 axes**, ≈ 74 m (69–80 m).
   - Küchenbau: **12 axes**, ≈ 38 m (36–42 m).
   - Orangerie: **≈ 23 axes** (3-axis risalit, partly hidden), ≈ 74 m (69–80 m).
   - All palace wings: **2 full storeys over a low stone plinth (Sockel) with cellar windows, plus a mansard roof
     with a flat top and two rows of openings** (dormers below, oculi above).
4. **Surprises.**
   - (a) **Every palace wing has a mansard roof.** [01](01-history-and-sources.md) says only the corps de logis had one.
   - (b) The palace is **extremely plain**: no pilasters, no string courses, plaster with stone plinths, and
     **rubble-masonry portal surrounds**. The only show pieces are a columned portico with an iron balcony, the
     corps de logis Dachreiter with a needle spire, and blue-white (Wittelsbach) striped sentry boxes.
   - (c) **Nutzbauten have red tile roofs**, while the palace has dark slate.
   - (d) Many ground-level shots were **rendered at 30 fps and frame-doubled** (§2.2).
   - (e) The labelled "Herzoglicher Wohnflügel" is an Ehrenhof arm, probably the **north** arm (§3.3).
5. **Best shots for SfM / Gaussian splatting:**
   - **S04 (18.15–28.9 s)**: crane over the Ehrenhof.
   - **S06 + S08 + S09 (34.1–47.6 s)**: near-nadir and high obliques of the whole site.
   - **S23 (100.7–116.6 s)**: 16 s golden-hour arc. Use it as a separate lighting set.
   - Selection with fps and masks: `video2world/frame_selection.json`.

---

## 2. Shot list

### 2.1 Method [T]
- Scene cuts: `ffmpeg -vf "scale=640:-2,select='gt(scene,0.12)',metadata=print"`. The scores were read for isolated
  spikes; gradual rises are dissolves or fast moves. Log: `video2world/frames/scene/scores.txt`.
- Regular sampling: 1 fps at 1920 px (`frames/1fps/f_NNNN.jpg`, where f_k ≈ t = k−1 s). Contact sheets:
  `frames/sheets/sheet_1fps_0[1-8].jpg` (4×4, 16 s each) and `frames/sheets/q[A-F].jpg` (2×2).
- Full-resolution PNGs at key times (`frames/full/full_t*.png`) and crops for counting (`frames/crops/`).
- Duplicate-frame detection: `mpdecimate`, unique frames per second (`frames/scene/mpdecimate.txt`).

### 2.2 Shots

Abbreviations: **G** = ground/eye level, **A** = aerial. "eff. fps" = unique frames per second (mpdecimate).
Lighting is the same daytime setup from 0 to ≈ 96 s, unless noted.

| ID | t start–end (s) | Camera move | What is visible | Overlays / effects | eff. fps | Recon. value |
|---|---|---|---|---|---|---|
| S01 | 0.00–3.78 | G, slow dolly forward over a meadow, slightly uphill | Palace from the W/NW through a tree clump; Sammlungsflügel front and the junction pavilion far away | Wind in grass and trees; strong grass motion blur; fade at 3.8–4.8 | 30 | Low (occlusion, small parallax) |
| S02 | 4.78–8.62 | G, dolly forward through trees; ends *inside foliage* (t≈8) | Junction pavilion with portico and balcony; arms receding | Fade in from dark; foliage blur | 30 | Low |
| S03 | 8.62–18.08 | G, truck past the portico columns (t≈9–12), then turns into and pushes across the Ehrenhof | Portico pavilion (rubble wall, white columns, iron balcony, striped awning, sentry box) (t=10.5); S arm court front (t=12–13); full Ehrenhof looking E: corps de logis with spire, both arms (t=14–18) | Title "SCHLOSS KARLSBERG IN HOMBURG / ERBAUT AB 1777" t≈13.8–18.1, lower centre; shallow DOF on near columns | 60 | Medium (façade detail) |
| S04 | 18.08–28.95 | A, crane up from the court pavement (blurred at t≈18) to high oblique, pulling back and drifting sideways | Ehrenhof from above, corps de logis, both arms, Küchenbau, garden with octagonal pavilion (t=23.4); later U + Küchenhof | "ZERSTÖRT DURCH FRANZÖSISCHE REVOLUTIONSTRUPPEN 1793" t≈19–22.5 centre; label "KÜCHENBAU" + leader line t≈25.5–29 | 60 | **High** |
| S05 | 28.95–34.07 | G, slow dolly beside a white building; possible dissolve at 31.45 | Orangerie N end (ashlar plinth, potted trees), looking N to the palace S arm and the terrace wall | Dense animated fog/dust cards | 30 | Low |
| S06 | 34.07–36.97 | A, near-nadir oblique, slow drift | **Plan-like view**: U, Sammlungsflügel, Küchenhof, Küchenbau, Bildergalerie, Rotunde, walled garden beds, Englischer Garten, terrace, Orangerie edge | Label "SAMMLUNGSFLÜGEL MIT BIBLIOTHEK, NATURALIENKABINETT UND WAFFENSAMMLUNG", bottom third, whole shot | 60 | **High** (layout) |
| S07 | 36.97–39.53 | G, push from inside foliage along the gravel Schlossallee toward the court | Ehrenhof opening from the W; corps de logis with spire in the axis; tree rows | "BLICK VON DER SCHLOSSALLEE IN DEN INNENHOF", top right | 51–60 | Low–medium |
| S08 | 39.53–42.22 | A, high oblique from the W, slow move | **Whole residence**: U, Sammlungsflügel, walled garden with greenhouses, Rotunde + wall, Orangerie, tree-lined N–S avenue, diagonal paths, Nutzbauten far left (t=40.5) | none | 60 | **High** |
| S09 | 42.22–47.57 | A, oblique from the SW over the Orangerie looking N along the avenue; slow push and rotation | Orangerie roof and W front with pedimented risalit + Dachreiter; palace S arm with the terrace; Nutzbauten row; distant town on a hill at the top right | Label "ORANGERIE: EIN FESTSAAL FÜR EXOTISCHE PFLANZEN" + leader line + circle t≈42.3–47.5; puffs of smoke | 60 | **High** |
| S10 | 47.57–50.25 | A, nadir pan | Nutzbauten / Marstall row along the straight road; field parcels; forest | none | 60 | Medium (footprints only) |
| S11 | 50.25–52.83 | A, nadir pan (continuation, hard cut) | Same row further along, walled garden squares, palace wings at the frame edge | none | 55–60 | Medium |
| S12 | 52.83–60.98 | G→low A, fast flight up a meadow slope toward the red-roofed buildings; possible dissolve ≈ 58.3 | Nutzbauten: large 2-storey blocks with red mansard/hipped roofs along a tree-lined avenue on a ridge | Label "NUTZBAUTEN FÜR DAS SCHLOSS: LAZARETT, KASERNEN UND BRAUEREI" t≈55.5–61; fog; grass blur | 30 → 60 | Low–medium |
| S13 | 60.98–63.50 | A, nadir | N end of the palace zone, walled gardens, small dark-roofed buildings, path network | Label "„APPELALLEE": FÜHRT IN DEN PARK KARLSLUST" + leader line | 60 | Low |
| S14 | 63.50–68.78 | G, truck along a façade | Orangerie W front: high ashlar basement, two storeys of tall windows, pedimented risalit, octagonal Dachreiter, potted orange trees (t=64.5) | Label "MODERNE BLITZABLEITER „HEMMER'SCHE FÜNFSPITZEN"" t≈65.5–68.8; DOF | 30 → 53 | Medium |
| S15 | 68.78–71.43 | A, rising past the Orangerie Dachreiter and lightning rod, then tilting to the palace | Orangerie roof detail; then the palace from the S: S arm outer front, terrace garden, N arm and corps de logis behind, Rotunde, garden pavilion (t=70.8) | Label (lightning rod) at the start; haze | 28 | Medium–high |
| S16 | 71.43–79.50 | A→G, push to the S arm portal through the terrace garden (t=71.5) → **through the gate passage** (t≈73.6–75.4) → across the Ehrenhof → toward the N arm portal and **into its passage** (t≈78.6–79.5) | S arm outer front, 21 axes countable (t=70.8–71.5); N arm court front with portal and sentry boxes (t=75.9, 76.5) | Label "HERZOGLICHER WOHNFLÜGEL MIT SPEISESÄLEN UND SILBERKAMMER" t≈75.9–79.4, lower centre; some frame stutter t≈74–76 | 28–57 | Medium (elevations); drop the passages |
| S17 | 79.50–84.90 | G→A, exit into the Küchenhof (t=80.3), then crane up over the Bildergalerie roof looking N | Küchenhof: Sammlungsflügel (W), Küchenbau end (E), low Bildergalerie (N); then the walled Hofgärtnerei with long greenhouse(s), white walls, Nutzbauten beyond | Label "DIE TREIBHÄUSER DES HOFGÄRTNERS LUDWIG REICHARD" t≈81.5–84.9; fog | 33–60 | Medium |
| S18 | 84.90–87.57 | G, fast low flight over grass and under trees | Englischer Garten ground; palace far away through trees | Heavy motion blur | 30 | None |
| S19 | 87.57–90.18 | G, slow truck behind a tree | Sammlungsflügel W front: plastered, arched rubble-framed gate with sentry boxes, junction pavilion with balcony, S arm beyond | Foreground tree occlusion | 30 | Low |
| S20 | 90.18–92.92 | G, flight over a meadow | Terrace retaining wall (left), Orangerie (right), **animated deer/goats** running | Animals, dust | 30 | Low |
| S21 | 92.92–95.38 | G, slow push across a meadow | Orangerie W front, frontal (t=93.5): basement, two storeys, 3-axis pediment, Dachreiter | Trees in front; dissolve 94.5–94.85 | 30 | Low–medium |
| S22 | 95.38–100.63 | A, nadir / steep oblique | Marstall group: Reithaus, courtyard blocks, Hundezwinger, walled garden, avenue (t=95–96) | Label "BLICK AUF DEN MARSTALL MIT REITHAUS UND HUNDEZWINGER"; **from ≈ 96.3 the grade bleaches to near-white** (transition to golden hour) | 37–60 | Low (only ≈ 1 s is clean) |
| S23 | 100.63–116.63 | A, long slow arc from the garden (E) side, against the low sun at first (t=101–103), rising to near-nadir (t=113–116) | Whole palace from the E: corps de logis garden front, both arms, Küchenbau, Bildergalerie + Rotunde, walled gardens, Nutzbauten, octagonal garden pavilion; foggy valley and hills beyond (W) | "BILDERGALERIE MIT ANSCHLIESSENDER ROTUNDE" t≈103.8–108 (top); "BLICK IN DEN ENGLISCHEN GARTEN VON BERNHARD PETRI" t≈108.5–113.3 (fades); bloom, haze, flare | 60 | **High** (geometry) but separate lighting |
| S24 | 116.63–124.22 | static | Black credits: HMS + Matzerath logos, "Schloss Karlsberg, 1789, Saarpfalz-Kreis, Saarland" | — | ≈ 0 | — |

Across the whole video [D]:
- **No people** were seen in any sampled frame.
- The sentry boxes are empty.
- Animated elements: wind in grass and trees, clouds, flags on the weather vanes, fog/dust cards, and the
  deer/goats in S20.
- There are no burnt-in logos or watermarks during the film; logos appear only in the S24 credits.
- A mild vignette is likely [I].

---

## 3. Architectural reading

Wing names used below. The video names only some wings; the others are named by position in the model frame
of §4.
- **A** — Corps de logis (E side of the Ehrenhof).
- **B** — South arm (Orangerie side).
- **C** — North arm.
- **D** — Sammlungsflügel. The caption names it [D: t=34–37]. It runs N–S on the W and is joined to the W end of C.
- **E** — Küchenbau. The caption names it [D: t=25.5–29].
- **G** — Bildergalerie with Rotunde. The caption names it [D: t=103.8–108].

### 3.1 Overall layout [D unless tagged]
- **Ehrenhof (U).**
  - A closes the E end. B and C run E–W. The W side is **open**: no closing wing, grille or gate is visible
    (t=16.5, 37–39, 40.5).
  - The court is cobbled or gravelled (t=16.5, 76.5). Sentry boxes stand at the corps de logis entrance and
    at the arm portals.
  - Size [I]: about **48 m wide (N–S, between the arms) × ≈ 50 m deep (E–W)**. That is A's 15 axes, and arm length
    minus A's depth.
- **Sammlungsflügel D + Küchenhof.**
  - D starts at the W end of C and runs N, parallel to A (t=34.3, 35.5 crop, 40.5).
  - At the D/C corner is a **junction pavilion with a columned portico** facing W (t=10.5, 35.5).
  - The Küchenhof (t=35.5, 80.3) is enclosed by:
    - D on the W side;
    - C on the S side;
    - the **free-standing Küchenbau E** on the E side, with a gap to C;
    - the **one-storey Bildergalerie G** on the N side, ending at the **domed Rotunde** in the NE corner
      (t=35.5, 80.3, 104–108).
  - The Küchenhof is ≈ 55–60 m N–S × ≈ 35–40 m E–W [I].
- **Walled gardens.**
  - From the Rotunde a long white **garden wall** runs N. Further walls enclose the **Hofgärtnerei**: quartered
    beds with cross paths and long, low greenhouses with sloped glazed fronts (t=35.5, 40.5, 82–84, 105).
  - Further W, next to D, there are kitchen-garden quarters with beds (t=35.5).
- **Avenues and paths.**
  - The **Schlossallee** arrives from the W into the court opening as a gravel road with trees (t=37–39).
  - A straight **N–S tree-lined avenue** runs along the W front of D, past the gardens, to the Nutzbauten in the N
    (t=40.5, 42.6, 70.8).
  - Several **diagonal gravel paths** fan out in front of the court and the Orangerie (t=40.5). This could be a
    patte d'oie [I].
  - The **"Appelallee"** leads toward Park Karlslust (t=61–63). Its direction cannot be read reliably in the
    nadir shot [U].
- **Englischer Garten (Bernhard Petri)** E of A (t=23.4, 35.5, 70.8, 109–113):
  - open meadows and loose tree clumps;
  - serpentine gravel paths;
  - a small **octagonal garden pavilion** with a dark roof (t=23.4, 35.5, 70.8);
  - grazing deer (t=90–92, possibly further W).
- **Orangerie** S/SW of the palace, long axis N–S (t=40.5, 42.6, 64.5, 93.5). See §3.5.
- **Nutzbauten / Marstall** N of the gardens. They form a 300–500 m row along a straight road, with field
  parcels on both sides (t=47–52, 56–60, 95–96). See §3.6.
- **Small outbuilding** at the SW end of D, behind a white fence line along the W front (t=35.5): a 1–2 storey block
  with a hipped roof (guard house?) [U].

### 3.2 Common façade system of the palace wings (A, B, C, D, E) [D]
- **Storeys:** two full storeys (Erdgeschoss + Obergeschoss), each with tall windows, over a **low stone plinth**
  of rubble or rough ashlar. The plinth has small, square, shuttered cellar windows, one per axis
  (t=16.5, 71.5, 76.5). There is **no mezzanine**.
- **Roof: mansard (Mansarddach) on every wing.**
  - Steep lower slope with **one dormer per axis**. The dormers are white-framed with segmental or straight heads
    (Stichbogengauben) and have shutters.
  - Shallow upper slope with **round oculi (Ochsenaugen) on every second axis** (t=70.8 crop: 21 dormers,
    10 oculi).
  - The ridge is a **flat, light-coloured deck**, probably sheet metal or a terrace (t=113.5 crop) [D/I].
  - Hipped (walmed) ends.
  - The covering is dark grey-brown slate (Schiefer) with visible courses.
- **Chimneys:** plain rectangular stacks with caps, in two rows along the flat top, about every 2 axes
  (t=76.5: 9 stacks over ≈ 17 axes).
- **Walls:** off-white to light grey **lime plaster (Putz)** with a mottled, weathered texture.
  - **No pilasters, no string courses, no window pediments.**
  - There is only a simple eaves cornice and, at the wing ends, stone corner strips (Ecklisenen) (t=71.5, 76.5).
- **Windows:** tall casements with glazing bars, about 2 panes wide × 4 high per sash. They sit in light stone or
  stucco frames with flat or slightly segmental heads. The ground-floor and upper-floor windows are about the same
  size (t=76.5).
- **Klappläden (shutters)** on every window. They are blue-grey to dark navy; the colour reads lighter in sun and
  darker in shade, so the exact colour is [U] (t=16.5, 71.5, 76.5).
- **Portals:**
  - round- or segmental-arched gateways (Durchfahrten) set in **unplastered rubble masonry** panels about two axes
    wide;
  - wooden double doors, and fanlights with radiating bars;
  - pairs of **sentry boxes (Schilderhäuser) with blue-white diagonal stripes** (Wittelsbach colours) and dark
    domed caps;
  - stone bollards (Prellsteine) beside the gates (t=71.5, 76.5, 88–89).
- **Weather vanes:** cross arms with **N/O/S/W letters** and a pennant (t=16.5, 71.5, 76.5).
  - **Lightning rods** of the "Hemmer'sche Fünfspitze" type (five points) are on the roofs, per the caption
    (t=65–69).

### 3.3 Individual wings

| Wing | Seen at (t) | Storeys / roof | **Axes counted [D]** | Size estimate [I] (3.2 m/axis; range 3.0–3.5) | Notes |
|---|---|---|---|---|---|
| **A Corps de logis** | 16.5, 23.4, 35.5 crop, 113.5 crop | 2 + mansard. The **central 7-axis section has a higher hipped pavilion roof** with a small open lantern and a **tall needle spire** (Dachreiter) | Court front **15 = 4 + 7 + 4**. Dormers counted on both levels (t=35.5 crop) | Court front ≈ 48 m (45–52.5). Depth ≈ 16–18 m [I]. Spire tip roughly 12–15 m above the roof [I, low] | Central section probably a **shallow Mittelrisalit**: its roof edge steps forward (t=16.5, 35.5) [I, med]. Central door with a short straight **Freitreppe** of ≈ 5 steps between sentry boxes (t=16.5, 23.4). Garden (E) front: 2 + mansard, ≈ 14–15 axes, plain. The arm ends seem to project slightly past it on the E [D/I, t=113.5]. On the garden side the central part seems to show an extra window row (t=23.4); the ground may fall away there [U] |
| **B South arm** | 12, 70.8 crop, 71.5, 113.5 | 2 + mansard | Outer (S) front **21 axes**. Gate passage replaces two ground-floor axes, with 10 axes W of it and 9 E | ≈ 67 m (63–73.5). Depth ≈ 16–18 m [I] | W end pavilion with a small corner balcony (t=12) [D/U]. A raised **terrace garden** lies against the outer S front at the W end (§3.7) |
| **C North arm** | 16.5 (left), 75.9, 76.5 | 2 + mansard | Court (S) front: ≥ 17 axes visible (frame cut). Gate centred on one axis, with 8 axes E of it [D]. Assumed equal to B [I] | ≈ 67 m [I] | Caption **"Herzoglicher Wohnflügel mit Speisesälen und Silberkammer"** is shown while C's court front fills the frame (t=75.9–79.4), after the camera has crossed B. So C is probably the Wohnflügel [I, med]. It could also mean the whole ducal wing system [U] |
| **D Sammlungsflügel** | 10.5, 34.3, 35.5 crop, 40.5, 88–89 | 2 + mansard | W front: **≈ 19 axes** (main body) + **4-axis junction pavilion** at the S end. Dormer row read in the t=35.5 crop: 19 + 4, ± 1 | ≈ 74 m in total (69–80). N of C ≈ 61 m [I] | W front has an **arched rubble-framed gate with sentry boxes**, off-centre toward the S (t=35.5, 88). Part of the roof carries a **dark flat raised box**, which might be a skylight/lantern over the library or a roof terrace [U] (t=35.5 crop) |
| Junction pavilion D/C | 6, 9–12, 88 | 2 + mansard | 4 axes (W front) | ≈ 13 m | **Portico on white unfluted Tuscan columns** set in groups (≥ 2 × 3) carrying an entablature and a **wrought-iron balcony**, with a **blue-white striped awning** over the balcony door. Walls in **exposed rubble masonry** with dressed corners. Short side steps (t=10.5) |
| **E Küchenbau** | 23.4, 25.5–29 (label), 35.5 crop, 80.3 | 2 + mansard, hipped ends | **12 axes** on its long (W) front; oculi row 5 | ≈ 38 m (36–42) | Free-standing, parallel to D, N of C's E part. Light grey-blue shutters |
| **G Bildergalerie + Rotunde** | 35.5, 80.3, 82, 104–108 | **One storey**, low dark hipped roof | ≥ 12 axes visible from the court (t=80.3) | ≈ 50–60 m [I, low] | Closes the N side of the Küchenhof. **Rotunde**: round pavilion with a **dark dome**, at the NE corner. The garden wall continues from it to the N (t=35.5, 105) |

**Heights [I, medium-low]**, from the frontal t=76.5 view and the axis spacing:
- eaves ≈ **11–12 m** above the court: plinth ≈ 1 m, ground floor ≈ 4.5–5 m, upper floor ≈ 4.5 m, cornice;
- mansard ≈ 5–7 m, so the flat roof top is ≈ **17–19 m**;
- window heights ≈ 2.7–3.0 m.

**Interiors:** only the two **gate passages** are shown (t≈73.6–75.4 and 78.6–79.4). They have plastered walls and
a flat ceiling, with wooden double doors folded back. **No room interiors** [D].

### 3.4 Ehrenhof surface and approach [D]
- The court is cobbled or gravelled and level, with no parterre, fountain or statue (t=16.5, 23.4, 76.5).
- The forecourt W of the opening is a gravel area where the diagonal paths and the avenue meet (t=37–39, 40.5).

### 3.5 Orangerie [D/I]
- **Plan:** a long main block, long axis N–S, with **short transverse wings at both ends projecting E**. That makes a
  **U-plan open to the E** (t=42.6 crop, 44.5) [D/I, med]. The end wings have darker roofs.
- **W front:**
  - **High ashlar basement storey** (Sockelgeschoss) with small rectangular windows and a door in the risalit.
    The terrain falls to the W (t=64.5, 93.5).
  - Above it, **two storeys of tall windows** with segmental or round heads and white plaster.
  - **Ashlar corner strips.**
  - A **3-axis Mittelrisalit with a plain triangular pediment** (no relief visible).
- **Roof:** a plain **hipped roof (Walmdach, no mansard)** in grey slate, with **sparse oculi** and a small
  **octagonal Dachreiter (lantern) with a conical cap** behind the pediment (t=64.5, 68–69, 93.5).
- **Axes:** about 10 + 3 + 10 ≈ **23** (trees hide part of the front at t=93.5) → ≈ 74 m (69–80) [I].
- **Setting:** potted citrus trees in square tubs (Kübel) stand on the gravel forecourt (t=29–33, 42.6, 64.5).
  Five-point lightning rods stand on the roof (t=65–69).

### 3.6 Nutzbauten, Marstall [D/I]
- Captions: "Lazarett, Kasernen und Brauerei" (t≈55.5–61) and "Marstall mit Reithaus und Hundezwinger" (t≈95–96).
- **Building groups** along one straight road (t=47–52, 95–96):
  - **white walls**;
  - **red tile roofs (Ziegel)**, hipped or mansard, with dormers;
  - 2 storeys + roof (t=56–60);
  - mostly 3- and 4-wing courtyard groups (Höfe) and long blocks.
- **Reithaus** [I]: a large rectangular hall with a hipped roof.
- **Square, dark-roofed courtyard building** [I]: possibly the Hundezwinger.
- **Walled garden squares** sit between the groups. Checkerboard fields lie on both sides of the road.
- A tree row runs along the road (t=42.6, 70.8).
- These buildings stand on a gentle **ridge** N of the palace (t=53–55, 70.8).

### 3.7 Terraces, fences, terrain [D/I]
- **Terrace garden** at the W end of the S arm, on its outer (S) side (t=40.5, 70.8, 71.5, 90):
  - a raised rectangular parterre on a **rubble retaining wall**, ≈ 1.5–2.5 m high [I];
  - a gravel walk to the S-arm portal;
  - shrubs, roses and sunflowers;
  - edged by an **iron hoop fence (Bogenzaun)** with arched trellises.
- **Garden walls:** long, white-plastered, with coping (t=35.5, 40.5, 82). Low white fences run along the W front of
  D (t=35.5).
- **Terrain:**
  - The palace stands on a **level platform**. The ground falls to the W and SW, with meadows rising toward the
    palace in S01 and S20.
  - The **Orangerie stands lower**, with its basement exposed on the W (t=64.5, 93.5).
  - A wide fog-filled valley with distant hill ranges lies W of the plateau (t=101–103).
  - A distant town on a hillside appears at the top right in S09 (t=42.6). Treat it as backdrop; it is not
    evidence for orientation [U].
- **Water:** none of the ponds (Karlsbergweiher etc.) is clearly visible [D].

---

## 4. Orientation

1. **Weather-vane letters (model-internal) [D/I].**
   - At t=16.5 the camera is in the court looking at A. Both vanes show N to the left and S to the right. W is the
     near (higher-drawn) arm and O the far arm. The camera therefore looks **E**.
   - At t=71.5 and 76.5 the camera faces B's and C's S-facing fronts. W is left, O right, S near, N far. The camera
     looks **N**.
   - Both readings agree. Model frame: **A east, court opens west, B south, C north**.
   - Rule used: for an object above eye level, the nearer arm is drawn higher.
   - Crops: `frames/crops/c16_vanes.png`, `c71_vanes.png`.
2. **Agreement with the LiDAR footprints [I, medium-high]** ([03](03-lidar-site-analysis.md) §4.1).

   | LiDAR feature | Measured | Video counterpart (§3.3) |
   |---|---|---|
   | KB-02, S wing | 64 × 17 m, E–W | B: 21 axes ≈ 67 m |
   | KB-03, central E–W band | 78 × 20 m, ≈ 60 m N of KB-02 | C, at a court width ≈ 48 m + wing depth |
   | KB-05, W block | 50 × 13 m, N–S, at the NW | D N of C, ≈ 61 m |
   | KB-06, NE block | 28 × 13 m, N–S | E: 12 axes ≈ 38 m |
   | KB-07, N scarp | — | the N side (G) |
   | Orangerie front KB-30 | 81 m, N–S | ≈ 23 axes ≈ 74 m; the 5 m terrace step matches the high W basement |
   | N–S road KB-10/11 W of the palace | — | the N–S tree avenue along D |

   The overall extent fits as well: the outer U from the S face of B to the N face of C is ≈ 80 m in the video,
   against ≈ 79 m in the LiDAR from KB-02 S to KB-03 N.
3. **Consequence.** The model gives a clear answer to LiDAR open question 2 ([03](03-lidar-site-analysis.md) §11):
   the **Ehrenhof opens W(SW)**, toward the valley, over the terrace edge. The **garden front faces E(NE)**, toward
   the KB-12 avenue and the Englischer Garten. In true terms, the arms run ≈ 79°/259°, so "W" ≈ 259° true.
4. **Sun direction: not reliable.**
   - Daytime shots have shadows falling toward the W/NW, i.e. a morning-like sun from the E/SE (t=35.5, 40.5).
   - S23 shows the sun low behind the palace when seen from the garden side, i.e. setting in the W (t=101–103).
   - Both fit the frame above, but CG suns are set for looks, so they are **not** evidence.

---

## 5. Contradictions and open points against other research

| Topic | Video (HMS/Matzerath) | Other source | Status |
|---|---|---|---|
| Roofs | **Mansard roofs on every palace wing** (A–E) (t=16.5, 70.8, 76.5) | [01](01-history-and-sources.md): "only the corps de logis had a mansard roof"; other roofs gabled | **Conflict [U]**. The video claims to be research-based, but Le Clerc 1790 / Ruppenthal 1788 must decide |
| Main front | Ehrenhof opens W; garden front E (§4) | LiDAR open question 2 | The video supports W; to be checked against plans |
| West wing (1782) | D (Sammlungsflügel) is the N–S wing on the W | [01] lists a "west wing" from 1782 and a Sammlungsflügel as a "north extension" | D may be both. D lies NW of the court and extends it to the N [I] |
| Galerieflügel (1788) | One-storey Bildergalerie with Rotunde on the N side of the Küchenhof | [01]: picture gallery N of the main palace | Consistent [I] |
| Orangerie | U-plan, high basement, 2 storeys, pediment, Dachreiter | [01]: "three wings, pale plaster walls, high basement, pillared hall with tall windows"; LiDAR depth 8–10 m | Consistent in kind. The building depth in the video looks larger than 10 m [U] |
| Corps de logis origin | 15 axes; central 7-axis section with a higher roof | [01]: Louisenhof manor house **7 × 4 axes, 2 storeys** became the corps de logis | The **7-axis central section may be the old Louisenhof house** [I, attractive but unproven] |
| Facade richness | Very plain; rubble portals | [01]: "grown by additions" character | Consistent |

---

## 6. Reconstruction suitability (SfM / Gaussian splatting / photogrammetry)

**Best material** (details and masks in `video2world/frame_selection.json`):
- **S04** 18.15–28.9 s at 4 fps (≈ 43 frames): the crane gives the best parallax on the U.
- **S06 + S08 + S09** 34.1–47.6 s at 3–4 fps (≈ 37 frames): plan-like view and high obliques; they overlap each
  other and S04.
- **S23** 100.7–116.6 s at 3 fps (≈ 48 frames): the longest arc, under **golden-hour lighting**. Reconstruct it
  separately, or use it for geometry only.
- Optional add-ons in daylight:
  - S03 (Ehrenhof at eye level);
  - S15/S16 (S arm, N arm court front);
  - S17 (Küchenhof);
  - S14 (Orangerie front);
  - S10/S11 (nadir of the Nutzbauten, orthophoto-like).
- The whole selection is ≈ 270 frames.

**Sampling.**
- 3–4 fps on aerial shots, which gives ≈ 2–6° of view change per frame.
- 2–3 fps on ground shots.
- **Never sample above 30 fps** in the frame-doubled shots: S01, S02, S05, S12, S14, S15, S16 (in part),
  S18–S21.
- Extract at 1920 px or 2560 px: the 4K VP9 detail is softened anyway.
- Skip ±0.3 s around cuts and dissolves (3.8–4.8, 31.45, 58.3, 94.5–94.85, 96.3–100.6).

**Masks.**
- Captions and leader lines: these are static per shot, so a fixed rectangle per time range is enough
  (the ranges are in the JSON).
- Sky, including animated clouds: for all shots.
- Fog cards: S05, S12, S15, S17.
- Animals: S20.
- Foliage near the camera: S01, S02, S07.

**Expected problems.**
- **Repetition.** The wings repeat one window module 12–21 times, and all roofs share one slate texture. Wide-baseline
  matching will confuse axes. Use sequential/video matching with loop detection, and add the oblique and nadir views
  as anchors.
- **Lighting.** Daylight and golden hour cannot share one radiance field. The S22 bleach transition is unusable.
- **Camera.** Focal length may change between shots. Use one camera model per shot and let SfM refine intrinsics.
- **Blur and DOF.** Strong motion blur in low, fast shots (S01, S12, S18, S20). Shallow DOF in close-ups (S03 at
  t≈9–12, S14).
- **Renderer effects.** Bloom, flare and haze in S23. Glass reflections change with view, so windows will form
  floaters in splats; mask or accept them.
- **Vegetation.** Wind-animated trees, alpha-card foliage and grass break photo-consistency. Expect noisy ground and
  tree volumes.
- **Compression.** VP9 at ≈ 20 Mbit/s for 2160p60 shows blocking in fast moves on grass and slate. Prefer slow
  aerial shots.
- **Coverage gaps.**
  - Roofs and the court are well covered.
  - The **outer N front of C, the E ends, and the garden front of A** are seen only obliquely (S04, S23).
  - The Nutzbauten appear mainly in nadir views.
  - There are **no interiors**.

**Use of the result.**
- Because of the copyright, a reconstruction from these frames is a **private reference** for checking our own
  procedural model (axis counts, massing, roof forms). It must not be the shipped asset.
- To use the model publicly, ask HMS / Matzerath ([04](04-video-and-video2world.md) §5).

---

## 7. Local files (git-ignored, not committed)

| Path (under `schloss-karlsberg/video2world/`) | Content |
|---|---|
| `frames/1fps/f_0001…f_0125.jpg` | 1 fps, 1920 px (f_k ≈ t = k−1 s) |
| `frames/sheets/sheet_1fps_01…08.jpg`, `q[A-F].jpg`, `reference_sheet.jpg` | Contact sheets |
| `frames/full/full_t*.png` | Full-resolution 3840×2160 key frames (t = 16.5, 23.5, 35.5, 40.5, 44.5, 29.5, 64.5, 70.0, 70.8, 71.5, 76.5, 80.5, 88.5, 91.5, 93.5, 103, 113.5) |
| `frames/crops/*.png` | Counting crops: `c35_sammlung` (D axes), `c35_eastarm` (A 4+7+4), `c35_kuechenbau` (E 12 axes), `c70_southarm` (B 21 axes), `c44_orangerie`, `c93_orangerie`, `c113_cdl_garden`, `c16_vanes` / `c71_vanes` (vane letters) |
| `frames/scene/scores.txt`, `scene_log.txt`, `mpdecimate.txt` | Scene scores; duplicate-frame log |
| `frames/reference/` | 12 reference stills, 1920 px JPG (list below) |
| `frame_selection.json` | Shot selection for reconstruction (this one *is* committed; it holds timestamps only) |

**Reference stills** (`frames/reference/`):

| File | t (s) | Content |
|---|---|---|
| `ref_portico_pavilion_nw_court_corner.jpg` | 10.5 | Portico, balcony, rubble wall, S arm beyond |
| `ref_ehrenhof_corps_de_logis_from_west.jpg` | 16.5 | Ehrenhof looking E (title overlay) |
| `ref_aerial_ehrenhof_from_west_high.jpg` | 23.4 | Ehrenhof from above, A + spire, E, garden pavilion |
| `ref_aerial_plan_oblique_u_and_kuechenhof.jpg` | 34.3 | Plan-like overview (label) |
| `ref_aerial_overview_from_west.jpg` | 40.5 | Whole residence from the W, no overlay |
| `ref_aerial_orangerie_looking_north.jpg` | 42.6 | Orangerie + palace + Nutzbauten row (label) |
| `ref_topdown_nutzbauten_row.jpg` | 49.5 | Nadir of the Nutzbauten |
| `ref_orangerie_west_facade_pediment.jpg` | 64.5 | Orangerie W front, basement, Dachreiter |
| `ref_south_arm_outer_facade_terrace_garden.jpg` | 70.8 | S arm, 21 axes, terrace garden |
| `ref_north_arm_court_facade_portal.jpg` | 75.9 | N arm court front through the S-arm passage |
| `ref_kuechenhof_bildergalerie_from_south.jpg` | 80.3 | Küchenhof: D, E end, Bildergalerie |
| `ref_golden_hour_aerial_from_garden_east.jpg` | 113.5 | Whole palace from the E, golden hour |

Reproduce (ffmpeg 8, `/opt/homebrew/bin/ffmpeg`):
`-vf "fps=1,scale=1920:-2"` for sampling; `-vf "scale=640:-2,select='gt(scene,0.12)',metadata=print:file=…"` for cuts;
`-vf "scale=480:-2,mpdecimate=hi=256:lo=128:frac=0.33" -loglevel debug` for duplicate frames;
`-ss <t> -frames:v 1` for stills.
Use `-nostdin` inside `while read` loops.
