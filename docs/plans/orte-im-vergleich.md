# 🌳 Orte im Vergleich: trees, parcels and green balance (living plan)

- **Status:** 🚧 Phase 0 built and reviewed (stats pipeline, *Orte im Vergleich* panel, *Baum-Steckbrief*, historic forest mask); Phase 1 built, reviewed and committed (2026-11-08); the public release waits for the user's go. SL land use (Q9) still pending; PV detection in the orthophoto deferred (user).
- **Last updated:** 2026-11-08
- **Origin:** user idea, 2026-11-07: make the LiDAR data more visible, add gamification and leaderboards between places, and later collect more data with the community.
- **How to keep this alive:** update the status boxes in §8 and the open questions in §9. Add a dated line to §10 for every decision and to §11 for every change to this file. Once an item ships, its decisions move into an ADR and its format into `docs/data-contract.md` (contract first, [ADR 0004](../adr/0004-contract-first.md)); this file then links to them instead of repeating them.

---

## 1. Idea and goals

1. **Make the data visible.** Show per place how many parcels (Flurstücke) and how much area it has, how many trees, its canopy share and a rough biomass. Every tree gets a profile card (*Baum-Steckbrief*).
2. **Leaderboards between places** (*Orte im Vergleich*): Kirrberg, Homburg, Bruchhof-Sanddorf, Mörsbach and so on compete in several disciplines, for example the greenest built-up area or the least sealed surface.
3. **Goals for more biodiversity:** shared targets per place, for example "+2 percentage points of canopy in the village by 2030".
4. **Later, the community collects data:** species, trunk girth and photos for single trees, so the measured trees gain attributes that LiDAR can't give.

## 2. Guardrails (decided)

| # | Rule | Why |
|---|---|---|
| G1 | **Leaderboards rank places only:** Gemarkungen or districts (Ortsteile), later teams or clubs. Never single parcels, persons or households. | A parcel can be linked to its owner. A public "greyest gardens" list would be a pillory and a GDPR problem (user, 2026-11-07: leaderboards are meant for places). |
| G2 | **Parcel figures are shown for private plots only as aggregates.** Anyone may look at their own parcel privately, on their own device. | Same as G1. |
| G3 | **No owner data, ever.** | It is not in the open ALKIS anyway and must stay out. |
| G4 | **Reward diversity, not only tree count:** hedges, old trees, flower strips, unsealing. | A species-rich meadow or orchard can be worth more than a new plantation. |
| G5 | **Quests stay virtual** (no "go there" prompts) until a heritage or forest partner agrees, [ADR 0021](../adr/0021-quests-virtual-only.md). Planting means digging, so planting actions exclude monuments and relict candidate areas. Keep "Schauen, nicht graben", [ADR 0008](../adr/0008-hypotheses-schauen-nicht-graben.md). | Heritage law, nature protection. |
| G6 | **Phases 0 and 1 need no server and no accounts**, [ADR 0022](../adr/0022-local-first-no-accounts.md). A community backend (Phase 2) needs a new ADR that replaces or extends 0022. | GDPR, static hosting. |
| G7 | **Estimates are labelled as estimates** (biomass, species, age) and shown with a range or a probability. | The app shows hypotheses, not facts. |

## 3. What the data gives today (baseline)

Inputs already in the pipeline:
- ALKIS parcel polygons (`vectors/flurstuecke_polygons.geojson`) with the official area, Gemarkung, Flur and address.
- The trees from the canopy height model (`trees`, `sle-trees-v1`, [ADR 0017](../adr/0017-real-trees-from-chm.md)): position, height and crown radius.
- LoD2 buildings, OSM ways, the DOP20 RGB orthophoto, and the historic maps of 1840 and 1935.

**Prototype run, 2026-11-07,** over the AOI `overall` (6 × 8 km). The script is outside the repo; it becomes `pipeline/stats.py` in Phase 0. Every tree is assigned to the parcel it stands in.

| Gemarkung | Parcels | Official area | Trees detected | Crown area | Above-ground biomass (rough) |
|---|---|---|---|---|---|
| Homburg | 6,944 | 1,742 ha | 119,362 | 845 ha | ≈ 250,000 t |
| Kirrberg | 5,001 | 798 ha | 50,700 | 374 ha | ≈ 115,000 t |
| Bruchhof-Sanddorf | 2,901 | 843 ha | 66,439 | 458 ha | ≈ 160,000 t |
| Erbach-Reiskirchen | 5,849 | 557 ha | 16,704 | 91 ha | ≈ 9,000 t |
| Mörsbach (RLP) | 1,427 | 538 ha | 24,192 | 160 ha | ≈ 49,000 t |
| Einöd | 354 | 245 ha | 14,352 | 100 ha | ≈ 33,000 t |
| Käshofen (RLP) | 303 | 248 ha | 21,482 | 155 ha | ≈ 60,000 t |
| Beeden-Schwarzenbach | 458 | 80 ha | 4,666 | 33 ha | ≈ 9,000 t |

Overall: 23,725 parcels; 13,188 of them have at least one tree; 326,010 trees.

**How far the numbers go:**
- **Incomplete places.** Every Gemarkung is cut by the AOI edge. The table covers only the parcels that touch the AOI, so these are not totals for a place yet. Phase 0 fixes this.
- **Only dominant crowns.** About 140 crowns per hectare of canopy are detected; real forest has 300–800 stems per hectare. The understorey is missing, but the large trees that carry most of the biomass are in.
- **Biomass method.** Trunk diameter from the crown, `D ≈ 0.557 · (H · CD)^0.809` (cm). Weight from the Chave-2014 form, `AGB ≈ 0.0673 · (ρ · D² · H)^0.976` (kg), with wood density ρ = 0.60 for broadleaf or unknown and 0.42 for conifer. That gives ≈ 310 t per hectare of crown: plausible for old beech forest, but it can be wrong by a factor of 2. The app therefore shows a labelled range (Q3). CO₂ ≈ 1.8 × the dry biomass.
- **Not available yet:** actual land use (forest, garden, field) from ALKIS (Q9), a district (Stadtteil) boundary layer, population (Zensus 2022, Q7).

## 4. Single trees: what can be known

| Attribute | Source | Quality |
|---|---|---|
| Position, height, crown radius | LiDAR CHM (exists) | ±0.5 m, 1 cm, 1 dm |
| Broadleaf or conifer | DOP colour (exists) | weak, often wrong in shade |
| **Species** | DLR *Tree Species Germany* (10 m COG, CC BY 4.0), cross-checked with the Thünen map (CC BY 4.0); Q6 | probability per 10 m cell, e.g. "probably beech (70 %)". Certain only through people on site. |
| **Age** | (a) height plus yield table → ±20 years; (b) historic maps → „laut Karte 1935–40 wahrscheinlich Wald“ (built; the 1836–41 sheets have no forest signature, so „since 1840“ needs another map, §10); (c) true age only from SaarForst forest inventory (not open) or a known planting year | class, not years |
| **Trunk girth / DBH** | community tape measurement at 1.3 m | the most valuable contribution: it calibrates the biomass model |
| Understorey | LAZ point clouds (exist for 3 areas) | pilot |

**Identity over time.** Today the tree id is derived from the position of the crown top. In a new LiDAR flight the tree grows and its top can move one cell, which changes the id. Community data therefore needs epoch matching: a new top is the same tree when it lies within the old crown radius and the height change is plausible (0–1 m per year).

## 5. Leaderboard „Orte im Vergleich“

**Unit (decided, Q4):** Gemarkung, named as such. Gemarkungen mostly match a place, but not always: Erbach-Reiskirchen is one Gemarkung but two districts and stays one entry for now. Districts (Ortsteile) from OSM boundaries may come later as a second view.

**Built-up area (Ortslage):** without ALKIS land use, the built-up area is the buildings plus a buffer of about 50 m, checked against OSM residential areas. "Green" and "grey" disciplines count inside this area only. Otherwise the place with the most forest always wins.

**Disciplines.** Several, so that different places can win something:

| Discipline | Measure | Data | Ready |
|---|---|---|---|
| 🌳 *Grünste Ortslage* | share of canopy plus green below 3 m in the built-up area | CHM, DOP CIR → NDVI (SL WMS layer `sl_dop20_cir`; RLP from the open DOP20 RGBI tiles, Q2), buildings | Phase 0 |
| 🧱 *Wenigsten Beton* | sealed share in the built-up area (roofs, roads, squares) | LoD2, OSM roads and parking, Copernicus imperviousness (10 m) | Phase 0 |
| 👥 *Bäume pro Einwohner* | trees ÷ inhabitants | Zensus 2022 100 m grid (open, licence to check, Q7) | Phase 0 |
| 🌲 *Waldreichste Gemarkung* | crown share of the whole Gemarkung | CHM | Phase 0 |
| 🏔️ *Riesenbaum* | tallest tree in the place | CHM (check single outliers) | Phase 0 |
| ☀️ *Sonnenstärkster Ort* | PV systems, kWp per inhabitant, share of residential buildings with PV, share of the roof potential used | Marktstammdatenregister (MaStR) plus detection in the DOP plus LoD2 roofs, see "PV" below | MaStR totals per municipality: Phase 0 · per Gemarkung: Phase 1 |
| 📈 *Größter Fortschritt* | change between two flights | SL 2016 → 2025 if the 2016 DOM is open (Q13), otherwise the next LiDAR or DOP epoch | later (the fairest discipline) |
| 🦋 *Artenvielfalt* | species observed | iNaturalist / GBIF counts (no own system) | Phase 1 |

**PV (user idea, 2026-11-07): number of systems, households with PV, estimated power.**
- **Source 1: Marktstammdatenregister (MaStR, Bundesnetzagentur, open data).** Every PV system is registered with its power (kWp) and commissioning date.
  - Small systems (≤ 30 kW, i.e. almost every house) are published only with postcode, place and municipality key, not with an address or coordinates. That is deliberate privacy.
  - Exact totals per municipality are therefore possible: count, kWp, growth per year, balcony plants included.
  - **Not per district (Q10):** all of Homburg, Kirrberg and Bruchhof included, shares the postcode 66424, so small systems cannot be split below the municipality. Systems ≥ 30 kW have coordinates and can be placed.
  - MaStR therefore gives one figure per municipality: Homburg, Zweibrücken (with Mörsbach) and Bechhofen. That is a municipality view and a calibration target, not a Gemarkung ranking.
- **Source 2: detection in the orthophoto.** Panels are clearly visible in the DOP20 (20 cm). A segmentation model on the roofs gives, per building, PV yes or no and the panel area. Estimated power ≈ panel area × 0.2 kWp/m² (1 kWp ≈ 5–6 m², range for older modules 0.15–0.2).
  - This gives per-place figures, including the share of residential buildings with PV. LoD2 tells residential from other buildings only roughly, through the building function; to check.
  - Needs the full 20 cm DOP for roof areas only (today we fetch 0.5 m/px) and a model: *3D-PV-Locator* (MIT, trained on German 10 cm orthophotos) is the candidate; it must be validated on 20 cm against MaStR ≥ 30 kW points and OSM `generator:source=solar` (Q11).
- **Calibration.** The sum of detected kWp per municipality is checked against the MaStR total. The difference is the detection error and is shown with the result.
- **Potential.** LoD2 roof planes (orientation, tilt, area) give the roof area suitable for PV, which turns *share used* into a discipline. We compute it ourselves: neither Saarland nor RLP has an open, downloadable solar roof register (Q12).
- **Privacy (G1/G2).** MaStR hides the location of small systems on purpose. Per-building detections are therefore **never published or shown**; they are only aggregated per place, with a minimum number of buildings per unit.
- "Households" means residential buildings. Flats per building are unknown (Zensus 2022 has dwellings per 100 m cell; Q7).

**Fairness.**
- Inside a built-up area, compare shares, not absolute numbers.
- Show categories (town vs village) or rank by change.
- Flag places whose LiDAR comes from another flight: the RLP places Mörsbach, Käshofen, Bechhofen and Niederauerbach have a different year and possibly a different season (Q5).

**First places (decided, Q1):** Kirrberg, Homburg, Bruchhof-Sanddorf, Beeden-Schwarzenbach, Erbach-Reiskirchen, Einöd and Mörsbach, plus Bechhofen and Zweibrücken (RLP). Later additions possible: Jägersburg, Wörschweiler, Käshofen.
- Zweibrücken is a town Gemarkung of its own size class. It is compared through shares and the town/village category, not through absolute numbers (see Fairness).
- Three of the nine places are in RLP and carry the `other-flight` flag (Q5).

**Two speeds.** Aerial measurements change every few years (LiDAR about every 5 years, DOP every 2–3), but a game needs weekly movement. So later (Phase 2) the leaderboard has two parts:
- **Deeds** (fast, community): tree identified, girth measured, hedge reported, planting registered. Confirmed by a photo or a second person.
- **Impact** (slow, measured): the next flight checks whether it really got greener. That earns a "confirmed from the air" badge and also protects against fake reports.

**Example goals:** "Kirrberg 2030: +2 percentage points of canopy in the village", "all 50 giant trees identified", "500 m of new hedge", "1,000 m² unsealed".

## 6. Data model (draft; becomes contract text before implementation)

Three layers, kept apart:

```
1 Measurement (pipeline, rebuilt per LiDAR epoch)  → as today: sle-trees-v1, 10 bytes per tree, binary chunks
2 Observation (community, append-only, Phase 2)
     { tree_ref: { id, epoch, E, N }, by: pseudonym, at: ISO-8601,
       kind: 'species' | 'girth_cm' | 'photo' | 'health' | 'not_a_tree' | 'confirm',
       value, evidence?, confidence }
3 Consensus (derived)                               → per tree: species = beech (3 of 3 confirmed), girth 182 cm …
  + Aggregates                                      → per parcel (private view only, G2), Gemarkung, 100 m hex
```

**Stats file (Phase 0), draft `sle-stats-v1`:** `stats/places.json`, a few KB, small enough to publish.

```ts
{
  format: 'sle-stats-v1', generated, inputs: { lidar: { SL: 2025, RLP: '?' }, alkis, osm, zensus? },
  method: { biomass: 'crown-allometry-v2', ortslage: 'bldg-buffer-50m-v1', ... },
  places: Array<{
    id, name_de, kind: 'gemarkung' | 'ortsteil', state: 'SL' | 'RLP', complete: boolean,
    area_ha, parcels, trees, crown_ha, agb_t: [lo, mid, hi],
    ortslage_ha, ortslage: { canopy_pct, green_pct, sealed_pct },
    inhabitants?, trees_per_inhabitant?, tallest: { h, E, N },
    pv?: { source: 'mastr' | 'dop-detect', systems, kwp: [lo, mid, hi],
           residential_with_pv_pct?, roof_potential_used_pct? },  // aggregates only, never per building

    lidar_epoch, flags: string[]          // e.g. 'other-flight', 'cut-by-aoi'
  }>
}
```

The 3D tiles stay as they are. Statistics can be computed over a much bigger area (all of Homburg plus its neighbours) without publishing its tiles, so the GitHub Pages 1 GB limit is no problem.

## 7. Scaling

| Area | Trees (≈ 6,800 per km² as here) | Hosting |
|---|---|---|
| Homburg and neighbours, stats only | ≈ 0.6–1 M | a few KB of JSON |
| Saarland (2,570 km²) | ≈ 17 M ≈ 170 MB of tree chunks | static tiles plus an aggregate pyramid (Gemarkung → Flur → parcel → tree); computing takes hours |
| Germany | ≈ 2–3 billion | not on Pages: vector tiles (PMTiles) on object storage; LiDAR DOM availability differs by state |

The real hurdle is the community (Phase 2), not the data volume: accounts, GDPR, moderation, photos (no people, gardens or plates), legal notice.

**Options for Phase 2:**
- **OSM:** species as tags on single `natural=tree` nodes; no own server; ODbL. A mass import of LiDAR trees is not welcome there, and points or badges can't live in OSM.
- **Own backend** (Postgres/PostGIS, EU region): allows gamification, but operation and data protection become our job.
- **Local-first plus export:** like the markers today. No sync, but no server either.

## 8. Phases

### Phase 0: numbers and the first leaderboard (no server)
- [x] Open questions settled (Q1–Q12, 2026-11-07); Q13 stays open and does not block Phase 0
- [x] Re-check the SL ALKIS WFS for land use (`Nutzung`, Q9) and measure the RLP 2022 border effect (Q5). SL WFS 414 still answers 503, so land use stays pending (building-buffer Ortslage); border effect measured (Q5)
- [x] Stats bbox covering the nine places completely, including all of Zweibrücken (stats only, no new 3D tiles)
- [x] New inputs for stats: DOP CIR (SL WMS, RLP RGBI tiles), Zensus 2022 population grid, MaStR municipality totals (open-mastr bulk, cached once)
- [x] `pipeline/stats.py` with tests: parcels, trees, crown, biomass range, built-up area, green / grey, tallest tree; output `sle-stats-v1`
- [x] Contract section in `docs/data-contract.md` and an ADR (leaderboards for places only, G1–G7): „Place statistics“, „Historic forest mask“, [ADR 0049](../adr/0049-orte-im-vergleich-places-only.md)
- [x] Review: table plus map image per place, checked for plausibility **before** any app work (four rounds, incl. the CHM clip, §10)
- [x] App panel *Orte im Vergleich* (one leaderboard per discipline, tap → fly to the place, place card): `app/src/places/`
- [x] *Baum-Steckbrief* on tree tap: height, crown, biomass range, historic forest („laut Karte 1935–40 wahrscheinlich Wald“; 1840 not classifiable, §10): `app/src/trees/TreeCard.ts`
- [ ] Release through `scripts/release/` after review: export staging ready (`stats/`, `forest_hist/` + manifest keys, licence audit note in RELEASING.md); waits for the user's go

### Phase 1: richer attributes, still no server
- [x] Species probability from the DLR map (Q6, cross-check Thünen) per tree and per place: manifest key `species` (contract „Tree species“), card row, `species` mix per place
- [x] Forest-age class: from height + yield tables (`tree-age-height-v2`, no age above the table) and the 1935 forest share from the TK25 (1840 not classifiable, §10)
- [x] *Riesen von …*: the top trees per place (`riesen-checked-v1`, species only when „wahrscheinlich“)
- [x] iNaturalist / GBIF species counts per place: fetched at pipeline time (counts only, rarefied), so no third-party call and no privacy dialog in the app (ADR 0022)
- [x] Local collecting ("discovered x/y") and goals (baseline → target; progress bars wait for a second epoch or community data)
- [~] PV per place: roof potential from LoD2 (`roof-pv-potential-v2`) per place and municipality, used share against MaStR where the Gemeinde is complete (Bechhofen); **detection on the 20 cm DOP deferred** (user decision 2026-11-08)
- [x] Review rounds 2–3 of the Phase 1 fixes (0 blockers/majors), committed 2026-11-08
- [ ] Release with the user's go

### Phase 2: community pilot in Kirrberg (needs decisions)
- [ ] Choose a backend (Q8) and write the ADR that replaces or extends 0022
- [ ] Heritage or forest partner for anything on site (Q-32, ADR 0021)
- [ ] Identify species, measure girth, photo; consensus from two independent observations
- [ ] Deeds leaderboard with teams per place; impact check at the next flight

### Phase 3: Saarland-wide
- [ ] Tiled pipeline run, aggregate pyramid, tile hosting decision

## 9. Open questions

| # | Question | Who | Status |
|---|---|---|---|
| Q1 | Which places go into the first leaderboard? | user | ✅ 2026-11-07: the 7 core places plus Bechhofen and Zweibrücken (§5) |
| Q2 | Does Saarland offer an open CIR (near-infrared) DOP WMS? | Claude | ✅ SL: yes, `sl_dop20_cir` and `sl_dop20_ir` in the open truedop WMS (no fees, dl-de/by-2-0 as RGB). RLP: no CIR in the WMS, but open DOP20 RGBI tiles in the geoshop (dl-de/by-2-0). → NDVI for *Grünste Ortslage* |
| Q3 | Show biomass in the app as a range ("100–250 t") or not at all until the tape calibration exists? | user | ✅ 2026-11-07: as a labelled range (biomass and CO₂); not a leaderboard discipline until calibrated |
| Q4 | Gemarkung or district (Ortsteil) as the unit? | user | ✅ 2026-11-07: Gemarkung first; Ortsteile later as a second view |
| Q5 | Year and season of the RLP LiDAR, and how it compares with SL 2025 | Claude | ✅ RLP tiles are DOM1/DGM1 **2022** (SL 2025, leaf-off per ADR 0030); RLP season unknown. → `other-flight` flag on Mörsbach, Bechhofen, Zweibrücken. **Border effect measured (Phase 0):** in similar forest on both sides RLP 2022 finds ≈ 20 % more trees per ha of canopy (ratio 1.20; canopy cover −3.3 pp). Not harmonised: the app shows the raw values with the *andere Befliegung* badge and names the offset |
| Q6 | Licence and access of the Thünen tree species map | Claude | ✅ DLR *Tree Species Germany* (10 m COG, EPSG:3035, CC BY 4.0, 10 classes + canopy loss, F1 0.89) preferred; Thünen *Dominant Tree Species 2017/18* (CC BY 4.0, 11 classes, 75–87 %) as cross-check. A 10 m forest context, not a per-tree truth |
| Q7 | Licence and attribution of the Zensus 2022 100 m grid | Claude | ✅ Destatis „Gitterdaten“ ZIPs (population ≈ 18 MB, 100 m CSV). Credit „Zensus 2022, © Statistische Ämter des Bundes und der Länder, dl-de/by-2-0“; confirm in the bundled description before release. Small cells are altered for confidentiality |
| Q8 | Community backend: OSM, own server or local-first? | user | ⏸ 2026-11-07: decided later, with a pilot partner, before Phase 2 |
| Q9 | Does the ALKIS WFS offer actual land use (*tatsächliche Nutzung*) openly? | Claude | ◐ RLP: yes, `ave:Nutzung` in the open ALKIS-vereinfacht WFS 519. SL: WFS 414 returned 503 on 2026-11-07 and **still 503 at the Phase 0 re-check**; land use stays pending, Phase 0 uses the building-buffer Ortslage. Re-check before Phase 1 |
| Q10 | MaStR: how reliable is the "Ort" field for districts (Kirrberg, Bruchhof …) within Homburg? Which postcodes cover which places? | Claude | ✅ Small PV (< 30 kW) only per municipality: all Homburg districts share PLZ 66424, „Ort“ is the postal town. ≥ 30 kW units have coordinates. Access: `open-mastr` bulk export (dl-de/by-2-0, ≈ 2–3 GB, once) |
| Q11 | PV detection: which model (licence, accuracy on German DOP20), and is a full-resolution DOP fetch for roof areas polite enough? | Claude | ✅ Candidate *3D-PV-Locator* (MIT, German orthophotos, weights in a requester-pays S3 bucket). Fine-tune or validate on 20 cm Homburg tiles; full-res fetch only for roof boxes, sequential and cached. Phase 1 |
| Q12 | Is there an open Saarland solar roof register (*Solardachkataster*) we may use instead of our own LoD2 potential? | Claude | ✅ No open register: SL has only partial municipal viewers (a 2024 state law may bring one), RLP's Solarkataster is a viewer only. → compute roof potential from LoD2 ourselves |
| Q13 | Which older LiDAR epochs exist, and are they open? (for 📈 *Größter Fortschritt* without waiting for the next flight) | Claude | partly: SL flew 2006 (2–3 pts/m²), spring 2016 (DGM1 2016, dl-de/by-2-0 per GDI-DE metadata) and 2025; open since 2024 is only the current state, a 2016 **DOM** is unconfirmed. RLP: 2002 onwards, statewide 2019–2024 (our tiles: 2022); older epochs only on request for a fee (≈ 75 €/h, per a third-party overview). Next: ask LVGL whether DGM1/DOM1 2016 can be downloaded openly. |

## 10. Decision log

- **2026-11-07:** The idea is captured. Phases 0 and 1 are designed without a server (G6).
- **2026-11-07:** Leaderboards compare places (Kirrberg, Homburg, Mörsbach, Bruchhof …), not people or parcels (user; G1).
- **2026-11-07:** Places (Q1): the 7 core places plus Bechhofen and Zweibrücken. Unit (Q4): Gemarkung. Biomass (Q3): shown as a labelled range, not ranked. Backend (Q8): decided before Phase 2 (user).
- **2026-11-07:** Research answers: NDVI from CIR (Q2), DLR species map (Q6), Zensus grid (Q7), MaStR only per municipality (Q10), 3D-PV-Locator (Q11), own roof potential (Q12).
- **2026-11-07:** PV is a discipline (user). Per-building PV detections are never published, only aggregates per place (G1/G2, in line with MaStR's own privacy rule for small systems).
- **2026-11-08:** Riesenbaum = `tallest-checked-v4`: the detector clips the CHM at 60 m, so tops at the clip are re-measured on the unclipped CHM (DSM − DTM) and kept up to 75 m; wind turbines, masts and line-shaped tops (cranes) are rejected; without a readable unclipped CHM a top at the clip is rejected as in v3. Bruchhof-Sanddorf's winner is a **60.9 m** conifer, most likely a Douglas fir (hypothesis: the only species here that reaches ≈ 60 m; species is not measurable from these data).
- **2026-11-08:** Historic forest: the Bayer. Positionsblätter 1836–41 have no forest signature (`classified: false`), so the card says „laut Karte 1935–40 wahrscheinlich Wald“ (*Schätzung*), never „seit 1840“; „seit …“ only once two classified maps agree at the point.
- **2026-11-08:** A Riesenbaum that is not in the 3D tree layer (above the 45 m cap or outside the tiles, `in_trees: false`) gets its own pin in 3D and on the minimap; phones show the short pin („🌲 60,9 m“).
- **2026-11-08:** RLP places keep their raw counts (no correction factor) with the *andere Befliegung* badge, which names the measured ≈ 20 % offset (Q5).
- **2026-11-08:** The panel is a card in the *Orte* drawer in the 🟢 Standard tier (between the walk-in zones and *Bekannte Orte*): it needs no tools and is the playful entry to the data. Places mostly outside the 3D area fly to their part inside and say so; the whole outline is on the map.
- **2026-11-08:** No PV detection in the orthophoto for now (user). Phase 1 PV = MaStR municipality view + LoD2 roof potential.
- **2026-11-08 (Phase 1 review):** A tree taller than the class-II end of its yield table gets **no age** (`tree-age-height-v2`, class `beyond`, „höher als die Ertragstafel“) instead of the clamped last table age; per place it is its own grey share and is left out of the median. The review found 14 % of all trees ≥ 8 m clamped and 56 % of the „sehr alt“ crown area came from them. We did not stretch the tables or the 2 m offset: the tables were not yet checked against the print.
- **2026-11-08 (Phase 1 review):** Flat roofs count × 0.4 (row spacing, parapets, skylights), pitched roofs × 0.7 (`roof-pv-potential-v2`): v1 counted flat industrial roofs like pitched ones (Homburg 10.5 kWp per inhabitant); now 5.4–8.5.
- **2026-11-08 (Phase 1 review):** A Riese shows a species only when it is „wahrscheinlich“ (p ≥ 50 %, no contradiction); a 10–40 % class on the most-viewed trees was noise (e.g. a 56 m „Lärche?“).
- **2026-11-08 (Phase 1 review round 2):** Conifer / broadleaf of one tree = `tree-group-v1`: a „wahrscheinlich“ DLR class beats the DOP colour type (which read 79 % of the likely conifers as broadleaf); an unsure class that disagrees with the colour gives „Baum“. Used for the card title and ρ in `crown-allometry-v2` (place biomass 2–9 % lower).
- **2026-11-08 (Phase 1 review round 2):** The start pose (and the pose after a reset) is treated like a fly-to arrival: no place counts until the camera moved 100 m. A Riese flown to from the list is **not** discovered by the flight (logged rule: fly-tos do not collect; the framed pose is ≥ 160 m away); the panel says to fly closer or tap the tree.
- **2026-11-08 (Phase 1 review round 2):** Erle and „andere Laubbäume“ stay in the species mix but are flagged `weak` and hatched with „?“ (Thünen agreement 7 % / 6 %); hiding them would distort the other shares. The roof card leads with the usable area (`usable_m2`, ≈ 40 % of the roof area, the kWp base); the larger suitable area is a sub-line.
- **2026-11-08 (Phase 1 review):** *Entsiegeln* is a deed counter (0 → 1,000 m², today's sealed area as a note), not a −0.03 % step on the sealed total. Automatic fly-tos do not collect, and after one no place counts until the camera moved 100 m (the framed arrival pose often hovers over the neighbour).

## 11. Changelog of this document

- **2026-11-07:** First version, from the planning conversation (baseline numbers from the prototype run over `overall`).
- **2026-11-07:** Discipline ☀️ PV added (MaStR, DOP detection, LoD2 potential, privacy rule), with Q10–Q12.
- **2026-11-07:** All open questions settled except Q13 (older LiDAR epochs, added); Phase 0 checklist updated. Ready to start Phase 0.
- **2026-11-08:** Phase 0 built: boxes ticked except the release (waits for the user's go); status line, §4 forest wording, Q5 (border effect measured) and Q9 (SL WFS still 503) updated; five decisions logged in §10.
- **2026-11-08:** Phase 1 review round 2 fixed: four decisions in §10 (tree group, start pose not a visit, weak species classes, usable roof area).
- **2026-11-08:** Phase 1 built and first review fixed: §8 Phase 1 boxes, status line, five decisions in §10 (no DOP PV detection, age beyond the table, flat-roof factor, Riesen species, goals / collecting).
