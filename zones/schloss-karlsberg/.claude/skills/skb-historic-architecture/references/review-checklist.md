# "Does it match history?" review checklist

Use this list to review a building, a view or a change. Do it with the viewer open (`skb.goto(id)`, the info panel on
click) and the catalogue entry (`node -e` or `python3 -c` over `model/catalogue.json`) side by side. Give every
finding a tag and a source. If you can't source a finding, it is a question, not a finding.

Start with `node .claude/skills/skb-historic-architecture/scripts/history-check.mjs`. It already covers integrity and
20 tracked research deltas, so the manual list below focuses on what a script can't judge.

## A. Time slice (summer 1789)

- [ ] Does the building stand in 1789? Watch for ephemeral 1785 buildings (KB-B13 fair rotunda, KL-B49 Hymen
      temple), things moved or built after 1789 (the Eremitage moved to the Karlslust in 1792; the barracks
      conversion of 1791), and modern consolidation (Cor-Ten).
- [ ] Is it finished in 1789? The S wing stood long as a carcass (T5), and the gallery dates from 1788 with the
      Langer Gang date U. An unfinished interior is a valid, tagged state.
- [ ] Does the planting around it look young (avenues planted 1778–88, 5–8 m)? Details are in research/11.

## B. Massing and roof

- [ ] Storeys: one or two plus a mansard on the Ehrenhof wings and the CdL; one cornice at 356.0 across the palace
      group (D enwp, HMS).
- [ ] Roof form per class: mansard (palace group, D LC/PL), hip or gable (service), dome or cone (rotunda),
      pavilion (guard houses).
- [ ] Cover: slate on the palace group (D PV; D T1 for the main house), red tile on the service town (D PV/HMS). The
      Amphitheater houses have slate (T20).
- [ ] Dormers one per axis, oculi every 2nd axis, flat light deck; chimneys about every 2 axes; Dachreiter only where
      documented (CdL centre, LC).
- [ ] Does the footprint follow the catalogue's conflict rule (documented period sources > LP06 research plan >
      LiDAR positions > HMS heights/massing > comparables/norms; research/07 §3)? Is the alternative recorded?

## C. Facade system

- [ ] Plain wings: identical bays, corner strips only, no string course, no window hoods, no pilasters (HMS 06 §3.2).
- [ ] Richness only where documented: the CdL 7-axis centre, the B02 head portico and balcony (LC), the junction
      portico (HMS), the Orangerie centre pediment, and the gallery's Ionic rotunda (T5).
- [ ] Axis count and spacing match the catalogue `axis_tags` (HMS counts ±2; LC).
- [ ] Portals: round-arched Durchfahrten with Prellsteine; the Freitreppe step counts (CdL 5, B02 head 10–12).

## D. Openings and joinery

- [ ] The windows read as French two-leaf casements: a meeting stile, no fixed mullion, a transom only on tall
      windows. **Not** a T-window or Kreuzstock.
- [ ] Small upright panes: about 2 × 4 per leaf on the wings, larger on the CdL state floor.
- [ ] Joinery white or pale grey; the Orangerie's tall windows and doors white (T5).
- [ ] Shutters: louvred and blue-grey on court buildings, plank and green or oxblood on farm buildings; none on the
      Orangerie hall tier (I).
- [ ] The glass reads as glass: dark and reflective from afar, with slight pane variation at low sun. It must not
      look like empty holes or mirrors.

## E. Colours and materials

- [ ] Walls white-grey limewash, not cream-yellow, pink or pure white. Slightly uneven, with streaks under sills
      (research/09 §2.4).
- [ ] Members grey painted render. Exposed sandstone only at plinths, steps, portals and corners, in mixed hues.
- [ ] Iron dark blue-grey; gilt only on the Ehrenhof gate tips.
- [ ] Nothing from the do-not-copy list: Benrath pink, Mannheim red on yellow, Prussian ochre.
- [ ] Look at it at 17:30 and 07:00 as well as 10:30 (skb-improve `shots.mjs` poses 14 and 15), because a palette
      that only works at noon is wrong somewhere.

## F. Roof hardware and site furniture

- [ ] Lightning rods on **every** building (D): Hemmer five-point heads with a down-conductor. Weather vanes on the
      CdL Dachreiter (HMS).
- [ ] Ehrenhof: level gravel, grille with central gate (line U), Wachhäuser at the mouth, striped sentry boxes at the
      portals. No parterre, fountain or statue in the court (HMS).
- [ ] Retaining walls battered with copings; carriage ramps no steeper than 1:10.

## G. Interiors

- [ ] Room names come from the documented lists (R12, T5, the room guide). Their **positions** are tagged I or U
      unless T5 places them (§b of research/10).
- [ ] The current wing assignments follow research/10:
  - N wing: Duke, Bildersäle, Silberkammer;
  - S wing: Duchess, Max Joseph, guest rooms, Altan;
  - kitchen wing OG: Großer Speisesaal;
  - Sammlungsflügel: library on the EG, Naturalien and Waffen on the OG.
- [ ] State rooms have:
  - boiserie, or silk in gilt Tapetenleisten above a 0.9 m dado;
  - diagonal parquet de Versailles;
  - a cove ceiling with a rosette;
  - a marble chimneypiece with a trumeau, or a faience stove in antechambers;
  - Supraporten;
  - a chandelier and wall lights, with a candle-only look.
- [ ] Colours by room name (research/10 §c.2), with the hexes tagged N. Special rooms follow §c.3 (green arabesque
      damask gallery with 20 chandeliers; paper marble in the Tempelzimmer; white cabinets in the Naturalienkabinett).
- [ ] Service rooms plain: limewash, planks or flags, grey doors.
- [ ] Furniture scale and style are Louis-seize (Jacob). No Rococo curves or Empire forms.

## H. Evidence display and honesty

- [ ] The info panel shows confidence, sources and tags for the building, and room tags for rooms.
- [ ] Low-confidence buildings respond to the "Hypothesen (niedrige Konfidenz)" select (zeigen, transluzent,
      ausblenden). `placement: 'hypothetical'` alone does not hide anything: `showHypothetical` defaults to true.
- [ ] "Schauen, nicht graben" is still in the footer. No find-spot or digging hints have been added.
- [ ] No HMS frames or textures, no copyrighted images in the repo. Darmstadt V19–V21 are CC0 but still need the
      user's approval to download.

## I. Plans parity

- [ ] The GR, AN, SC and LP sheets you touched were re-rendered (`pnpm run plans --only …`), and the PNGs in
      `docs/plans-preview/` show the same rooms, openings and roofs as the 3D model.
- [ ] `plans/tests` pass. Labels are German. The legend and the "Hypothese – Stand" stamp are present.

## Report format

```
Building / view: <id or pose>, hour <h>, screenshots <paths>
Matches (tag, source):
- ...
Deviations (severity H/M/L, tag, source, fix location):
- ...
Unknown (what would settle it):
- ... → Schwan 2010 pp. … / Darmstadt V20 / LC 1790 full-res …
Not verified: ...
```

Severity: **H** contradicts a D source or the time slice; **M** contradicts a D-> comparable or the HMS facade
system; **L** departs from a period norm (N) or is a matter of taste.
