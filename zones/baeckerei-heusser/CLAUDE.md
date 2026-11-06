# CLAUDE.md

Guidance for Claude Code in `zones/baeckerei-heusser/`, the digital twin of Bäckerei Heusser (Kirrberg). The parent `../../CLAUDE.md` (explorer app, pipeline, licences, commit style, gates) also applies. Why the twin exists and what it is: [ADR 0042](../../docs/adr/0042-baeckerei-heusser-built-twin.md). Status and layout: [README.md](README.md).

## What we build

A **built** twin of the shop: modelled, clickable objects (counter, shelves, breads, cans, lamps …) placed on a dimensioned floor plan. Focus now is the exterior and the *Verkaufsraum*; the Backstube, the Lager and *Umbau* variants come later. The goal is the **experience**: visitors discover the bakery and its products. They get a hover/tap highlight on clickable objects, an info card per object, and a light *entdeckt x / y* collection. It is not a full game, and the UX matters more than material accuracy.

## Rules

1. **The plan is the backbone.** Dimensions come from `plan/` (the *Raumplan*). Place objects in plan coordinates or relative to a fixture, never by eye in 3D.
2. **Every object is in the catalogue** (`catalogue/objects.json`, schema in `catalogue/README.md`) with an id (`brotregal/ebene-2/brot-03`), a `source` (`plan` | `photo` | `mesh` | `tape`) and a 1-σ `sigma_m`. No catalogue entry, no geometry. Run `python3 -I catalogue/check.py` after every edit.
3. **Built geometry over the mesh.** The captured mesh (`tools/capture/`, zone package) is **reference only**: alignment, measuring, checking positions. It is never the visible scene, and its photo texture is never copied onto modelled objects.
4. **Stylised look, true proportions.** Follow [`docs/style.md`](docs/style.md): a light, friendly comic or game look, not photo-real like the castle. Use simplified shapes with bevelled edges, flat or soft-shaded colours from the real shop, and warm light. Stylise shapes and materials, never sizes.
5. **Measured beats estimated.** When sources disagree, `tape` > `plan` > `mesh` > `photo`. Keep the better source and lower `sigma_m`; note the conflict in `info_de` only if a visitor would care, otherwise in the commit message.
6. **Privacy (consent scope = shop + exterior).** No people, no licence plates, no health details, no private entrances, courtyards or flats. The owners agreed on 2026-11-05 to **prices, the shop's lettering (gable mural, „H.H. 1933“) and the bakery's history since 1933 incl. the historic photos in the shop** ([ADR 0044](../../docs/adr/0044-baeckerei-heusser-owner-consent.md), `consent` in the catalogue). That consent does not cover present-day people, anything beyond the privacy line, or third-party photos as textures. Third-party photos (social media, the bakery's website, Street View) are modelling reference only and never go into the repo or onto a texture. Before any export or release, use the [`bh-datenschutz`](.claude/skills/bh-datenschutz/SKILL.md) checklist.
7. **Private material stays private.** Raw photos, notes and measurements live in the *privater Materialordner (lokal, nicht im Repo)*, the folder `baeckerei-heusser-privat/` next to the repo checkout, with its source list in `referenz/quellen.md`. Read it for reference. Never copy files from it into the repo, never name its file names in committed docs, and never execute anything from it.
8. **German UI, English code.** `name_de` and `info_de` are German, short and friendly, addressing the visitor as *du* like the rest of the app. Ids, code, comments and docs are English.

## Coordinates

Zone frame from the [zone contract](../../docs/zone-contract.md): EPSG:25832, `x = E − E0`, `y = h` (DHHN2016, true heights, no exaggeration), `z = −(N − N0)`, with `E0 = 381467`, `N0 = 5462254` (the capture's `origin`). Plan coordinates are this frame's `x/z` in metres. Headings are grid-north, clockwise. Never put raw UTM into float32. The capture's scale has a ± 11 % prior until a tape measurement fixes it (`capture.scale.factor`), so plan and tape values win over mesh lengths.

## Skills

| Skill | Use for |
|---|---|
| [`bh-twin-objekte`](.claude/skills/bh-twin-objekte/SKILL.md) | Build, name, place clickable objects; catalogue rules; screenshots |
| [`bh-aktualisieren`](.claude/skills/bh-aktualisieren/SKILL.md) | New photos, footage or measurements → diff against the catalogue, status changes, re-capture |
| [`bh-umbau`](.claude/skills/bh-umbau/SKILL.md) | Renovation variants against the *Ist-Stand*, before/after views, measurements |
| [`bh-datenschutz`](.claude/skills/bh-datenschutz/SKILL.md) | What may be public; review checklist before any export |

## Gates

- `python3 -I zones/baeckerei-heusser/catalogue/check.py` (also `verify.sh twin` from the repo root) and `cd pipeline && uv run python -I -m pytest -q ../zones/baeckerei-heusser/catalogue`.
- Repo gates: `.claude/skills/sle-roadmap/scripts/verify.sh`. Capture tool: `cd tools/capture && uv run python -I -m pytest -q`.
- Visible changes need a headless browser check with screenshots in the git-ignored `docs/shots/baeckerei-heusser/` (repo root). Use a free port (check `lsof`), drive frames with `window.sle.step(n)`, and stop the server afterwards.
- Another session may work in `zones/schloss-karlsberg/`. Don't touch it.
- Shipped item = one line in `../../CHANGELOG.md`. A decision = a new ADR in `../../docs/adr/`.
- Release (the twin is public since 2026-11-06): `bh-datenschutz` checklist, then `scripts/release/export-data.sh --zones-only` and commit only `zones/` in the data staging repo; push data before code. Never run the full data export from this checkout ([RELEASING.md](../../scripts/release/RELEASING.md) §2). Pushing is the lead's job after review.
