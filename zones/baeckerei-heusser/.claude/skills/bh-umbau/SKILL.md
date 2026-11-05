---
name: bh-umbau
description: Plans and visualises renovation (Umbau) variants of Bäckerei Heusser against the current-state twin (Ist-Stand) in zones/baeckerei-heusser/ - new or moved counter, shelves, lighting, seating, opened walls, Backstube or Lager changes - with variant files, before/after views from the same camera, and the measurements that matter (passage widths, clearances, shelf reach, areas). Use it whenever the user or the bakery owners ask "what if we move the counter", "show a renovation", "compare two layouts", "does a bigger fridge fit", "Umbau", "Variante", "before/after", or want to measure a planned change, even if they don't say "variant".
---

# Bäckerei Heusser: Umbau variants

A variant is a **proposal on top of the Ist-Stand**. It never edits the Ist-Stand (`plan/` + `catalogue/objects.json`). Concept and file layout: `variants/README.md`. Paths are relative to `zones/baeckerei-heusser/`.

## Workflow

1. **Brief.** Write down in 3–5 lines what should change and why (more space at the counter, a seating corner, a view into the Backstube), what must stay, and the hard limits (walls, door, fire exit, budget if known). Ask the owners for anything you would otherwise guess.
2. **Check the base.** Note in `variant.json` `base` which plan and catalogue state the variant uses. Values that matter for the variant (wall lengths, door width, fixture sizes) should be `tape` or `plan`. If they are only `mesh`/`photo`, say so and recommend a measurement (`bh-aktualisieren`).
3. **Write the variant.** Create `variants/<variant-id>/variant.json` (`add` / `move` / `replace` / `remove` / `plan`) with new objects in the catalogue schema, plus a `README.md` (why, open points, measurements). `status: idee` → `entwurf` → `abgestimmt` | `verworfen`.
4. **Measure.** Report the numbers that decide a layout:
   - clear passage widths (≥ 0.90 m in the customer area, ≥ 1.20 m for a pram or wheelchair; check local rules before relying on them),
   - counter length and the depth of the area behind it,
   - shelf reach heights (upper tier ≤ ≈ 1.80 m for staff),
   - areas (m²) before/after.
   Give each number with its sigma (from the sources it rests on).
5. **Visualise.** Show *Ist* and *Variante* with a switch, from the **same fixed cameras** (street door, customer view onto the counter, staff view behind the counter, top-down plan view), in the twin style (`docs/style.md`). Mark the variant clearly as *Umbau-Idee, nicht gebaut*. Shots go to the git-ignored `docs/shots/baeckerei-heusser/variants/<variant-id>/` (repo root). Use a free port and stop the server afterwards.
6. **Hand over.** Give the owners a short summary with what changes, the before/after images, key measurements and open questions.

## Rules

- Variants are **private by default**. They don't go into public exports until the owners release them (`bh-datenschutz`). Confidential plans stay in the *privater Materialordner (lokal, nicht im Repo)*.
- No prices or costs in the repo unless the owners agree.
- New objects follow the catalogue rules (`bh-twin-objekte`). True sizes, stylised look.
- A variant that gets built becomes the new Ist-Stand through `bh-aktualisieren` (objects `retired` / added / moved), not by merging the variant file.
