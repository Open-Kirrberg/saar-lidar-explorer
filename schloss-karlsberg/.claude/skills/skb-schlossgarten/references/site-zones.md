# Garden zones: what is there, what it should be, where to put new things

Positions use the **palace grid** (`gridFrame(spec.palace_grid)`): the origin is E 382226 / N 5466120 (the Ehrenhof
centre), **u** runs along the CdL axis toward the E (grid az 80.5°), and **v** runs toward the N (az 350.5°). From the
catalogue note: `E = E0 + u·0.98629 − v·0.16505`, `N = N0 + u·0.16505 + v·0.98629`. The CdL garden front lies at about
u ≈ +46. Levels are m DHHN2016 (research/03 §6). Catalogue ids are as of 2026-11-02. Check `model/catalogue.json` before
you rely on them.

**Heritage note.** Positions of archaeological traces are already in `research/03` and `lidar_features.geojson`. Don't
add new, more precise find-spot information to docs or UI, for example from your own DTM inspection.

## Palace core and Herzogsgarten (E of the CdL)

| Id | Today in the model | 1789 reading | Action |
|---|---|---|---|
| TF-01 Ehrenhof (344.8) | gravel court | bare light sand/gravel [D LC] | colour (S15); wear lanes are visual-audit §5.7 |
| TF-02 Küchenhof (344.8) | cobbles + gutter | OK; pump fountain [D, research/09] | building-side detail: `skb-historic-architecture` |
| TF-03 Schlossterrasse (344.8) | gravel platform | OK | — |
| TF-09 "Gartenparterre" (345.9, u 46.2–110, v ±30) | 4 hedged compartments, levelled up to 3.2 m into the slope | **Herzogsgarten**: open lawn on the natural slope (345.3 → 349.8 m) [D Petri; I] | S2: kind → lawn/landcover, drop the levelling, keep a 6–8 m gravel terrace at 345.9 along the front with a 2-step perron |
| — belt walk | missing | 3.0 m gravel loop from the CdL door: E toward the gallery tip, NE, E about 400–500 m, back S of the axis; a serpentine branch (3–4 bends, r 15–25 m) to the Hirschwürzloch Brunnenhaus KB-B80 | S2 (b); geometry ±30 m [I] |
| — clumps | missing | 12–20 clumps, D 8–25 m: shrubs 2–4 m 60 %, small trees 5–8 m 30 %, a conifer or poplar accent 10 %; 30–60 single trees; keep the CdL axis open | S2 (c) [D plan; I placement] |
| — stag basin | missing | on the axis v = 0, u ≈ +90…+130 (60–80 m E of the front), D ≈ 14 m, jet, two stag heads; epoch 1783–1790 | S3 [D presence/axis; I distance; N/U size] |
| — forest belts | the forest is everywhere | belts N and S of the lawn and E beyond u ≈ +450 | S1, S2 (d) |
| TF-11 / TF-12 Ostachse (588 m at 80.0° grid), TF-13 Wegestern | 2 rows of limes | in no period plan (LP06, K05, Petri) | trees `hypothetical`, keep an open vista [I] |
| TF-40 "Wall-Einfriedung" | enclosure, low confidence | probably the forest parcel behind the palace (1797/98 parcel plan) | S16: rename, [I med] |
| KB-B28 "Eiskeller" | building | Schneider: "Pavillon zu Carlsberg" (square, E apse, circular clearing D 40–50 m, about 250 m E of the Küchenflügel) | S16 alias + low confidence; the building is architecture work |

**Pavilions (S5)** are catalogue *buildings* (class PAV, `placement: 'hypothetical'` or `map`, confidence low). This skill
fixes their siting, clearing, paths and epoch, and `skb-historic-architecture` builds them:
- the round double-domed pavilion SE of the CdL at u ≈ +65…75, v ≈ −50…−60 (±20 m), epoch 1785–1792 (later the Eremitage);
- the round pavilion above the Hirschwürzloch near today's Forst-Bauhof;
- the octagon point de vue at the E end of the path from the Marstall;
- the 1789 Rotunde with a colonnade at the gallery's E end (see research/10 b.1 KB-B07 for its form).

## South: terrace garden and Orangerie

| Id | Today | 1789 reading | Action |
|---|---|---|---|
| TF-08 Schloßterrasse (LP06 44), u −30…36, v −62…−37.8, level from DTM (fallback 341.0), 2 m wall | lawn + walks | raised parterre on a rubble wall, treillage (Le Clerc), hoop fence, arched trellises, roses, sunflowers (HMS). Candidate "Lustgarten der Herzogin" (UP-10) [I low] | S7 parterre à l'angloise + treillage |
| TF-06 Orangerie-Parterre (340.8) | terrace | court opens to the garden "zugunsten einer großen Fernwirkung" [D research/10 b.2] | — |
| TF-15 Orangerie-Parterre (340.8), u 2–30, v −178…−128 | box hedges + tubs | parterre à l'angloise; tubs in rows | S8 |
| TF-07 lower terrace (335.2) | grass bench | the high W basement front is the show front seen from below [I] | keep the slope open (meadow), no forest |

## West and north: slopes, avenues, service gardens

| Id | Today | 1789 reading | Action |
|---|---|---|---|
| W/SW slopes | forest (today's canopy) | hay meadow, the LP06 30 vineyard strip, small woods only | S1, S10 |
| TF-10 Paradestraße (N–S, 2 rows, 7/14 m, 6 m) | limes | two-row avenue confirmed [D Petri via Schneider]; Aesculus is a catalogue option [I] | stakes at LOD0 near (S9) |
| TF-14 Apfelallee to the Karlslust (8/10 m, 4 m) | apples | OK [D] | lean and fruit (S4) |
| TF-05 Nordterrasse (344.1) | sand riding ground | OK | — |
| Holländische Gärtnerei, Reichard gardens (LP06 11, 34, 45, 47) | 3 greenhouses (KB-B54–56) | Petri: 2 S-facing greenhouses + central passage + bed rows | S11 beds, frames, espaliers. Keep the LP06 positions |
| Plateau N/NE of the service row | forest/meadow | fields | S1 |

## Karlsbergweiher (W valley)

TF-20 pond (water 276.18), TF-21 island (277.3), TF-22 dam. LP06 32 draws a larger, geometric basin (about 170 m) with a rounded
head. Offer it as a `hypothetical` alternative [I low] (S12). Pine on the sandy ground nearby [N].

## Karlslust (S valley)

| Id | What | Level | Notes |
|---|---|---|---|
| TF-30 Große Kaskade | 10 steps × 1.5 m, 8–12 m wide | 310.5 → 271.6 | [D] research/03 §4.5 |
| TF-31 Tosbecken | pond | 271.7 | [D] |
| TF-32/33/34 Schwanenweiher 1–3 | ponds (1 with two islets) | 270.1 / 266.8 / 268.3 | Findlinge on dams and tumulus, a fountain jet in the upper pond, a shell niche [D] (S12) |
| TF-35 terrace stair to the Tschifflik | path | — | — |
| TF-36 rondell | platform | 287.5 | the 1785 Hymen temple is a fireworks set, **not 1789** [D research/10] |
| TF-37 amphitheatre moat, KL-B40 | moat + houses | — | 19 **square, slate-roofed** houses, not half-round cages [D research/10 b.4] (architecture) |
| TF-38 Menagerie-Terrassen, KL-B43 | terraces | — | rows of single-storey houses, grilles, a water channel, a ≈ 3.6 m net [D/I research/10 b.4] |
| TF-43 / TF-44 Großes / Kleines Bassin | ponds | 288 / 296.7 | low confidence |
| Follies (S14) | missing | — | Chinese pavilion, Turkish pavilion and tent, hay-wagon folly, aviary: hypothetical staffage at unattributed LP06 pavilion marks; positions [U]. UP-08 Chinoiserie S of the Schwanenweiher (research/10 b.6) |
| KL-12 ring mound | "Eremitage" site | — | **empty in 1789** (the Eremitage arrived in 1792) |
| Herzogskastanien (S13) | missing | — | 20–40 *Castanea*, loose 8–10 m grid above the Hirschwürzloch, 6–8 m [D species/place; I layout] |

## 1789 landcover first cut (research/11 §6.3)

| Cover | Where |
|---|---|
| Forest (beech 70 / oak 20 / hornbeam 10) | belts N and S of the Herzogsgarten and E of u ≈ +450; the Hirschwürzloch slopes; the E plateau toward the Lambsbach; the steep Karlslust sides outside the garden scenes |
| Lawn | Herzogsgarten, parterres, terrace garden, Orangerie |
| Hay meadow | W and SW slopes down to the Karlsbergweiher, the valley floor, the Karlslust meadows |
| Field | plateau N/NE of the service row, around the Carlsberger Hof |
| Vineyard | LP06 30 |
| Kitchen garden / nursery | LP06 11, 34, 45, 47; the K05 hatched parcels; the "gartentechnische Nutzfläche" E of the Remise |
| Sand | courts, riding ground, forecourt |

The polygons go into the catalogue as `landcover` features with `cover` and a tag. Their edges are ±30 m until the Petri
plan is georeferenced (research/11 Q2). The plan is Public Domain, so a scratch copy for georeferencing may go in the
git-ignored `sources/`.
