# 🛠️ Improvement backlog — Schloss Karlsberg 1789

Open items only, driven by the `skb-improve` skill. The full text of every item (goal, approach, acceptance, measured numbers, "Discovered" notes) for waves 0–11 is frozen in [history/improvement-backlog-waves0-11.md](history/improvement-backlog-waves0-11.md). Look up an id there before working on it.

**Rules.** Ids are never renumbered; new items get the next free id (**KB-I101+**). Each item is one row here, with detail in the item's commit. A done item leaves this table and gets one line in [CHANGELOG.md](../CHANGELOG.md). Decisions become [ADRs](../../../docs/adr/README.md).

Status: `[ ]` open · `[~]` partial · `[?]` needs a user decision · ⏳ blocked · 🧊 frozen

## 🚧 v2: castle as zone #1 (first)

The explorer v2 drives these items. Order and acceptance: explorer backlog **V2.7** ([roadmap](../../../.claude/skills/sle-roadmap/references/roadmap.md)).

| Id | Item | Status | Why |
|---|---|---|---|
| KB-I102 | Trees without popping: stable id per tree, LOD by cross-fade (no reseeding between mid / close / hero tiers), lower wind sway | `[~]` CHM trees outside the footprint done (V2.7) | [ADR 0017](../../../docs/adr/0017-real-trees-from-chm.md) |
| KB-I107 | First Rundflug frame still compiles ≈ 9 programs (shadow depth, post chain, two leaf and terrain variants): ≈ 0.4 s on the phone proxy. Add them to the loading-screen warm-up (`viewer/src/precompile.ts`) | `[ ]` | [ADR 0028](../../../docs/adr/0028-phone-proxy-headroom.md) |
| KB-I108 | Draw calls: 580–615 per frame on the phone (Rundflug, Festsaal walk). The proxy holds 60 fps, but real phones pay per call; merge static interior parts and garden instances | `[ ]` | [ADR 0028](../../../docs/adr/0028-phone-proxy-headroom.md) |
| KB-I109 | Landscape desktop views see ≈ 2.1 M triangles in the Rundflug (phone viewport 1.36 M). Fine for desktop; push the crown hull distance down on Hoch only if a desktop struggles | `[ ]` | [ADR 0040](../../../docs/adr/0040-castle-triangles-phone-viewport.md) |

## 📋 Open from waves 0–11

| Id | Item | Status |
|---|---|---|
| KB-I03 · I13 · I15 · I24 | Epoch field, axial basin, exterior palette, gallery rotunda: done in the model; only the light-layer re-export into `../../app` is pending | `[~]` waits for the user's go |
| KB-I23 | Court furniture: Marstall basin, Küchenhof pump | ⏳ located sources |
| KB-I33 | Benches, sculpture, aviaries (aviaries U) | `[~]` |
| KB-I35 | Vineyard: 3D stakes over the +1 ms budget at pose 40 | `[~]` |
| KB-I37 | Water: Schwanenweiher jet and Findlinge | `[~]` |
| KB-I40 | Park boundary: Wildzaun and gatehouses | ⏳ no located line |
| KB-I58 | Roadside avenues (chaussée to Homburg, Homburg–Erbach) | ⏳ located source |
| KB-I48 | Festbeleuchtung: the „Dezember 1785“ scene | 🧊 festivals return as v3 events ([ADR 0020](../../../docs/adr/0020-remove-move-out-freeze.md)) |
| KB-I49 | Physically based atmosphere | `[ ]` |
| KB-I54 | Source acquisition (requests from research/09–11) | `[?]` |
| KB-I65 | Sky and post cost at retina, CPU per frame | `[~]` (phone part done with KB-I103; retina still open) |
| KB-I78 | Lawn and meadow blades: retina cost | `[~]` (→ KB-I94) |
| KB-I79 | End-side orientation audit for rotated `axisRect` buildings | `[ ]` |
| KB-I83 | Ehrenhof sand: ruts, camber, lane end, staffage | `[~]` |
| KB-I90 | Non-mirror glass for hotbed and glasshouse lights (`glass.frame` key) | `[ ]` |
| KB-I91 | Foliage back-light rim under cloud and moon shadow | `[ ]` |
| KB-I92 | Interior reveal gradation, TF-08 coping | `[~]` |
| KB-I94 | Retina headroom: idle bench owed | `[~]` (phone part done with KB-I103; retina still open) |
| KB-I98 | Shaded window reveals (laibung to the glass or baked AO) | `[ ]` |
| KB-I100 | Plan elevations draw the KB-B01 garden-front relief | `[ ]` |

Unpromoted notes: [history § Discovered](history/improvement-backlog-waves0-11.md#discovered-append-here-give-each-a-new-id-when-promoted). The waves 0–11 decisions log is also there ([§ Decisions log](history/improvement-backlog-waves0-11.md#decisions-log)); new decisions go into ADRs.
