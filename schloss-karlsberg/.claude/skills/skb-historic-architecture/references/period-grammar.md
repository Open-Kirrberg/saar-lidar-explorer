# Period grammar 1775–1790: construction and ornament, with numbers and code keys

The rules for *how* a south-west German princely residence of the 1780s was built and finished, translated into the
model's vocabulary. Sources: research/02 §2 (dimension tables, mostly N), research/09 §2–§6 (construction, finish,
colour comparables, rules G1–G12, M1–M9, E1–E9, I1–I7, C1–C8), research/06 §3.2 (HMS facade system).

Columns: **Now** is the current code value (checked 2026-11-02; re-read the file before editing). **Rule** is the
period value with its tag. **Key** is where it lives. Change the value there and nowhere else.

## 1. Walls and render

| Item | Now | Rule | Tag | Key |
|---|---|---|---|---|
| Outer wall, EG | CDL 1.0, WING2 0.7, RANGE1 0.65, ORANG 1.0 m | Rubble masonry 0.6–1.2 m by class; step back 0.15 m per storey | N | `WALL_THICKNESS`, `WALL_STEP_PER_STOREY` |
| Fachwerk wall | — | 0.25–0.35 m (use **0.30**); reveal **0.12–0.15 m**; rendered, so from outside only the shallow reveals show | D (Fachwerk existed), N (size) | new `FACHWERK` in grammar.ts + `facade.fachwerk` flag (09 G4, C1) |
| Candidates for Fachwerk | — | Gallery KB-B06 (D: grew from a wooden passage, Mar 1788), Wachhäuser, Dachreiter and lanterns, service upper storeys. Masonry for cellared parts (B02, Kavaliersbau, Orangerie basement) | D / I | catalogue (`EDITS`) |
| Partitions | 0.16 m | Fachwerk partitions 0.12–0.20 m, plastered | N | `PARTITION_WALL` |
| Render | `render.lime` `#ECE8DF`, roughness 0.92 | Two-coat lime render 15–25 mm, float-smoothed, following the rubble slightly; never scratched or patterned | N | `MATERIAL_BASE['render.lime']` |
| Limewash | uniform | Several thin coats, chalky-matt, a little translucent and streaky. Patina by build year: 1778–82 work warm and weathered (`#EDE6D8`), 1785–88 work fresh and cool (`#E6E6E2`). Green-grey streaks under sills and cornices | N; I (age split) | `facade.build_year` (C2) + a per-building tint (M3) |
| Rustic garden render | — | Bark-like "Rauputz nach Art von Eichenrinde" (Schwetzingen Tempel der Botanik) for garden follies only | D (example) | per building |

## 2. Stone

| Item | Rule | Tag | Key |
|---|---|---|---|
| Where stone shows | Plinth course (slightly projecting, 0.05–0.10 m), steps, portal surrounds, corner strips, copings, the CdL cornice blocks. Everything else is rendered | N; I for Karlsberg | `ARTICULATION.plinthProjection` (0.08) |
| Hue | Mixed red `#A65E4A`, yellow-grey `#C8B38C` and grey-white `#CFC8BA`, varied **per block** (recycled Jägersburg and Hohenburg stone plus local Buntsandstein), not one uniform red | D (local stone, reuse); I (mix) | `stone.*` + vertex-colour jitter (M5) |
| Quoins | At Karlsberg a **flat** corner strip (Ecklisene) rather than projecting long-and-short quoins. Course height 0.30–0.40 m | HMS; N | `ARTICULATION.ecklisene` (now 0.75 / 0.04 → rule 0.6 / 0.02, G8) |
| Cellars | Barrel vaults of rubble or roughly squared sandstone; brick or flag floors; one cellar window per axis in the plinth | D (B02 cellars, LiDAR); HMS | `CELLAR_WINDOW` 0.7 × 0.5 |
| Rubble panels | Exposed rubble panels around Durchfahrten (HMS); a deliberate rustic panel or unfinished work | HMS | option `facade.portal_panel: 'rubble'` (E6) |

## 3. Members and articulation

| Element | Rule | Tag | Key |
|---|---|---|---|
| Hauptgesims | **One** continuous cornice at one height across the palace group (356.0); height ≈ 1/14–1/18 of the eaves height, projection ≈ 0.9 × height. CDL 1.0 m, WING2 0.65 m, RANGE1 0.5 m | D Schneider 1988; HMS; N | `CORNICE` |
| Architrave | Plain continuous fascia under the cornice ("architrave blocks") | D wording; I reading | facade.ts mouldings |
| Window surround (wings) | Flat band 0.18–0.22 m (use **0.20**), projection **0.03** m, painted render; flat or slightly segmental head; **no Verdachung** | HMS; N | `ARTICULATION.surround` (now 0.2 / 0.06, G7) |
| Verdachung / pediment | Only on CdL centre axes (if at all), the Orangerie centre risalit, and the gallery rotunda portico. Pediment pitch 20–25° | HMS; D (rotunda); N | `ARTICULATION.pedimentPitch` 22 |
| Gurtgesims | None on WING2/RANGE1; optional on the CdL | HMS | — |
| Lisenen | On the CdL risalits and the B02 head only (Hautt's Herzogvorstadt idiom: "Lisenengliederung, Balkone, Mansarddächer") | D Herzogvorstadt; HMS | `ARTICULATION`, risalits |
| Risalit projection | 0.3–0.8 m (0.5) | N | `ARTICULATION.risalitProjection` |
| Member material | Painted render `#B9B8B2`, roughness 0.9, render normal map (not ashlar) | D-> Koblenz; I | new `render.member` (M4, C4) |
| Orders | Tuscan or Doric porticoes (B02 head, 4 columns, D LC); **Ionic** pilasters on the gallery Tempelzimmer and portico (D T5). No giant order on the wings | D / N | `PORTICO` (column Ø 0.7, entablature 0.9) |

## 4. Openings and joinery

| Item | Now | Rule | Tag | Key |
|---|---|---|---|---|
| Window sizes | `WINDOW[class][row]` (e.g. WING2 1.2 × 2.6, sill 0.9; CDL upper 1.4 × 3.1) | Keep (02 §2.3, HMS EG = OG on the wings) | N; HMS | `WINDOW` |
| Window type | LOD1: "one mullion + transom", which reads as a Kreuzstock or T-window | **Croisée**: two inward-opening leaves, moulded meeting stile ≈ 0.06 m, espagnolette, **no fixed mullion**; transom (Kämpfer) only on windows ≥ 2.6 m, at ≈ 0.75 h | D Baunetz (espagnolette 18th c.; Galgenfenster late 19th c.) | facade.ts `furnishOpening` (E1, G3) |
| Glazing | `glazingGrid()` in exterior/cut.ts: one rule, panes ≈ 0.42 × 0.48 m | Class-aware table: **2 panes per leaf** ≈ 0.25 × 0.33 m (h/w 1.1–1.4) on CDL ground, WING2, RANGE1, ORANG; **1 per leaf** ≈ 0.45–0.55 m wide, h ≈ 0.55 m on the CdL state floor; STABLE/FARM 2 per leaf, 3–4 rows. HMS reads 2 × 4 per leaf on the wings | HMS; N | new `GLAZING` in grammar.ts, read by `glazingGrid` (G1) |
| Glazing bars | — | 0.03 m on court buildings, 0.035 m on farm buildings; wood, ovolo or lamb's tongue | N | `GLAZING` (G2) |
| Glass | `glass.crown` `#1d2a30`, opacity 0.38 | Cylinder (Walzen-) glass, slightly green-grey (`#22302C`), faint waviness; per-pane normal/rotation jitter 0.5–1.5° so the panes catch low sun differently. Regional glassworks in the Warndt | N; D (glassworks) | `MATERIAL_BASE['glass.crown']` (M6) |
| Joinery colour | `wood.frame` `#E9E6DE` | White or pale grey oil paint (keep). Orangerie: white-painted metre-high windows and doors (D T5) | D-> Bamberg; D T5 | `wood.frame` |
| Shutters | `wood.shutter` `#7D8A78`; catalogue `#5E665B` | Two-leaf louvred **Jalousieläden**, blue-grey **`#5F6F7A`** (light `#8796A0`) on court buildings; plank shutters, green `#3F5A3A` / oxblood `#6E2E26`, on farm buildings; iron shutter dogs at LOD2. No louvred shutters on the Orangerie hall tier (I) | D-> Baunetz; HMS | `wood.shutter` (M1), catalogue `shutter_colour` (C3) |
| Portes-fenêtres | 3.8 m | 3.6–4.0 m on the garden side, centre axes | N | `PORTE_FENETRE_HEIGHT` |
| Main doors | — | Raised-and-fielded double leaves, fanlight with radiating bars; pale grey `#CFCBC2` | HMS; N | `wood.door` (now `#6B4A33` brown, the interior fallback `#E9E6DE`) |
| Durchfahrt | 3.4 × 4.0 m, round | Round-arched, plank leaves; Prellsteine at the jambs | HMS; N | `PORTAL.durchfahrt` |
| Freitreppe | R 0.145 / T 0.40 m | Sandstone, 5 steps at the CdL, 10–12 at the B02 head (LC); iron railing | D LC/HMS; N | `STAIR.freitreppe` |
| Interior doors | enfilade 1.45 × 3.1 m, 1.25 m from the window wall | Keep (02 §2.4, §2.11) | N | `INTERIOR_DOOR` |

## 5. Roofs and roof hardware

| Item | Rule | Tag | Key |
|---|---|---|---|
| Mansard | Ehrenhof wings + CdL (LC, PL). Lower pitch 70°, break 4.1 m above the eaves (HMS), upper pitch 21–28° or a **flat lead deck**; hipped ends. Structure: liegender Stuhl below, collar-beam roof above, attic floor usable | D LC/PL; HMS; N | `ROOF`, catalogue `mansard()` in buildings.ts |
| Hip / gable | Gallery (low hip ≈ 35°), Orangerie, service ranges 40–48°; farm 45–52° with a 0.3–0.5 m overhang; court buildings have no overhang (cornice eaves) | N | `ROOF.hipPitch`, `farmPitch`, `eavesOverhang` |
| Riding hall | Hängewerk for 15–20 m span, 35–45° | N | `ROOF.ridePitch` |
| Slate | Palace group (D PV, **D T1 for the main house**). Probably Moselschiefer, laid as altdeutsche Deckung, or as French rectangles on the mansard. Colour `#4A525C` (now `#4B5057`), matte | D colour; I origin; N pattern | `roof.slate` (M2), `defaults.slate` |
| Biberschwanz | Service town, farm and valley buildings. 38 × 18 cm south-German format, double cover, unmortared, ≈ 15 cm visible course, rounded tails; ±8 % per-tile hue | D PV/HMS; D format | `roof.tile`; course for UV scale (G10) |
| Ridges, flats, gutters | Lead or slate ridge rolls on slate roofs; mortar-bedded ridge tiles on tile roofs; lead flats and gutter linings (the Ludwigskirche parapet gutter was lead-lined) | N; D | `roof.lead` |
| Dormers | One per axis in the lower slope, white-framed, segmental or straight, with shutters; oculi every 2nd axis | HMS; LC two rows | `DORMER` |
| Chimneys | Rendered stacks with caps, 0.9 × 0.6 m, every ≈ 2–2.5 axes, 1.2 m above the ridge; kitchen stacks 1.2 × 0.9 m, 2.5 m above | HMS; N | `CHIMNEY` |
| Downpipes | Ø 0.11 m, one per ≤ 18 m of eaves, at corners and risalit edges, hopper head under the cornice; lead-grey | N | new (G5, E3) |
| Lightning rods | **On every building** (D). Hemmer Fünfspitz: iron mast ≈ 3.0 m above the ridge or chimney, Ø 0.03 m, a head of 1 vertical + 4 points (0.4 m arms), gilt or copper tips; down-conductor bar ≈ 0.02 m square on brackets down one corner. Head geometry N/U: check against photos of the Schwetzingen originals | D rods; N/U geometry | facade.ts at LOD2 (G6, E4) |
| Weather vanes | Cross arms with N/O/S/W letters + pennant on the CdL Dachreiter and pavilion roofs | HMS | (E5) |
| Dachreiter | Timber, clad in lead, sheet metal or slate, painted | D LC/HMS; N | `roof.raised[].turret` |

## 6. Site works next to buildings

| Item | Rule | Tag |
|---|---|---|
| Ehrenhof | Level gravel (no parterre, fountain or statue, HMS); cobbled (Katzenkopf) carriage lanes to the portals; sandstone gutters along the walls | HMS; N |
| Grille | Wrought iron with gate piers and a central gate; `#2E3439`, gilt tips on the gate only. Line U (court mouth or nearer the CdL) | D LC/PL; D-> Schwetzingen |
| Guards | Wachhäuser at the court mouth (LP06 28); sentry boxes 1.0 × 1.0 × 2.4 m + a 0.5 m domed cap, blue-white diagonal stripes; 100 guardsmen at the entrances (Molitor) | D; HMS; N |
| Retaining walls | Sandstone rubble or ashlar, batter ≈ 1:10, copings 0.3 m | D; N |
| Ramps | ≤ 1:10 for carriages; the Marstall ramp survives | D; N |
| Lanterns | Oil lanterns on wall brackets at portals (optional night layer) | N/U |
| Water | Basin at the great stables (aqueduct end); pump fountain in the kitchen court | D PV legend |

Gardens, avenues, landcover and planting are covered by research/11 and are not part of this skill.

## 7. Interiors (Louis-seize state rooms, period practice)

| Element | Rule | Tag | Key |
|---|---|---|---|
| Wall system A: boiserie | White or pearl-grey ("gris") panelling; rectangular panels with straight frames, rosettes, laurel, Greek fret, oval medallions; gilt only on the innermost moulding | D (Jacob Vertäfelungen); N forms | `wall.boiserie` (I2) |
| Wall system B: silk | Lyon silk or damask stretched in panels framed by gilt **Tapetenleisten** (≈ 0.05 m fillet) above a painted dado (lambris d'appui) 0.8–1.0 m (use 0.9) | D (Tapetenleisten, Lyon); N dado | `wall.silk.*` + fixtures (I1) |
| Silk colours | Crimson, blue, green, **yellow** (Gelber Salon), red-violet, grey, hazel, laurel (10 §c.2); goût étrusque accents in cabinets (terracotta and black, I from Dugourc) | D names; N hexes | `wall.silk.*` (add `wall.silk.yellow` `#C9A94E`/`#D9B95B`, M8) |
| Floor | Parquet de Versailles: oak, ≈ 0.97 m (3 pieds) square panels laid diagonally, in state rooms; Fischgrat or straight boards in secondary rooms; planks in service rooms; halls with 0.4–0.6 m red and grey sandstone flags laid diagonally | D pattern; N size | `floor.parquet` (G12, I4) |
| Ceiling | Flat with a cove (voussure) 0.6–1.2 m, stucco cornice, frieze, rosette | N | `ceiling.stucco` |
| Chimneypiece | Marble cheminée à la française, opening 1.1–1.3 × 0.9 m, mantel ≈ 1.1 m, trumeau mirror above | D Mannheim/Benrath; N | interior/fixtures.ts |
| Stoves | White faience Kachelofen ≈ 1.0 × 0.7 × 2.5–3 m in antechambers, stoked from the corridor; the dining hall has 2 enamelled-copper altar stoves in niches (O4) | N; D O4 | fixtures.ts |
| Doors | Double doors, painted and gilt; a **Supraporte** (painting field ≈ door width × 0.8–1.0 m) over every enfilade door in state rooms | N | fixtures.ts (I3) |
| Light | Chandelier + 2–4 wall lights per state room; candle-only look (≈ 1800–1930 K). Period practice: candelabra on ordinary evenings, chandeliers lit for feasts | D Knigge; N; D-> SPSG (docs/visual-audit.md) | interior/furniture.ts (I7) |
| Mirrors | Pier-glasses between windows, trumeaux, mirror doors (Waffensammlung, Tempelzimmer) | D; N | `interior.*` mirror material |
| Furniture | Jacob carved giltwood seating; the Duke's Paradebett (O2, walnut, carved, gilt); 2 bergères + a seating set in Antichambre Nr. 8 | D | interior/furniture.ts (I6) |
| Service rooms | Limewash, plank floors, plain grey-painted doors, tiled stoves; kitchens flagged and vaulted with a big hearth hood | N | `FIN.service`, `FIN.kitchen` |

## 8. Class cheat-sheet (what a building of each class should read as)

| Class | Reads as | Key cues |
|---|---|---|
| CDL | The Louisenhof core grown into a palace; modest, not monumental | 7-axis centre with its own roof + Dachreiter; Freitreppe; Lisenen on the risalits; mansard, slate; 1-pane leaves on the state floor |
| WING2 | Long, plain, identical bays | Same window on EG and OG; corner strips only; blue-grey shutters; 2 dormer rows; Durchfahrten with Prellsteine and sentry boxes |
| RANGE1 | Lighter, lower range (the gallery: timber origin) | One tall storey, side-lit; Fachwerk candidate; hip roof |
| ORANG | Light-flooded hall over a massive basement | White joinery, tall round-headed windows, no hall shutters, pedimented centre risalit, courtiers' rooms above the end bays |
| PAV | Garden or end pavilion | Rotunda: Ionic, portico, glass doors, 3 steps |
| STABLE / RIDE | Service town | Red tile, high stall windows (sill 1.8 m), Kniestock, plank shutters |
| FARM | Vernacular | Limewash `#E8DFC8`, red Biberschwanz, plank shutters green/oxblood, exposed limewashed Fachwerk allowed below the plateau |
