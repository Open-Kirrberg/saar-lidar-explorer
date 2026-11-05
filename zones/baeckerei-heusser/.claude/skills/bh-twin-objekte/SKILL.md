---
name: bh-twin-objekte
description: Builds, names and places the clickable 3D objects of the Bäckerei Heusser digital twin (zones/baeckerei-heusser/) - counter, glass display, bread shelf and tiers, baskets, breads, rolls, pretzels, cans, fridge, lamps, ceiling, tiles, facade parts - from the floor plan, reference photos and tape measurements, in the twin's stylised comic/game look. Covers the catalogue rules (ids like brotregal/ebene-2/brot-03, source, sigma, status), placement in plan coordinates or relative to a fixture, palette, bevels and lighting, hover/tap highlight, info cards, "entdeckt x/y", and screenshot verification. Use it whenever someone wants to add, model, move, restyle or make clickable anything in the bakery twin, e.g. "build the counter", "put breads on the shelf", "the shelf looks wrong", "make the pretzels clickable", "add an info card", "make the bakery look nicer", even if they don't say "catalogue".
---

# Bäckerei Heusser: build twin objects

You turn catalogue rows into **stylised, clickable 3D objects at true size**. The goal is the experience: visitors discover the bakery and its products. Paths are relative to `zones/baeckerei-heusser/`.

## Read first (every time)

1. `CLAUDE.md` (rules, frames, privacy), `docs/style.md` (palette, bevels, light, detail per class, interaction look).
2. `catalogue/README.md` and the rows you touch in `catalogue/objects.json`.
3. `plan/` (the *Raumplan*). Without plan or tape numbers for an object, build only a `blockout` and say so.

## Workflow

1. **Catalogue first.** Add or update the row: id (parent must exist), `type`, `area`, `name_de`, `info_de` (1–3 short German sentences, *du*, no prices, no invented facts), `dims`, `placement`, `source`, `sigma_m`, `refs` (describe the source, never a private file name), `status`, `clickable`. Run `python3 -I catalogue/check.py`.
2. **Place on the plan.** Fixtures and structure use `placement.plan` (zone frame `x/z`, `base_m`, `rot_deg`). Anything on or in a fixture uses `placement.rel` (`[right, up, forward]` from the fixture's base centre). Never place by eye in 3D, and never copy positions from the capture mesh without noting `source: "mesh"` and its sigma (scale prior ± 11 %).
3. **Model to the class budget** (`docs/style.md` table): silhouette first, then bevels (fixtures 10–20 mm, products 3–8 mm), flat or soft colours from the palette tokens, no photo textures. Vary products deterministically (seed = catalogue id). Instance repeated products.
4. **Name the node by the id** (`brotregal/ebene-2/brot-03`). Picking, the info card and *entdeckt x / y* key off that name. Non-clickable parts may be merged per fixture.
5. **Interaction:** clickable → warm rim/outline highlight on hover or first tap, card with `name_de` + `info_de`, and the counter increments once per object (stored on the device only). Group small products into one tap target until the camera is close (≥ 44 px targets on a 390 px phone).
6. **Advance the status:** `planned` → `blockout` (grey box at true size) → `built` (styled + named) → `verified` (checked against tape/photo). Lower `sigma_m` only when a better source arrives.

## Verify

- `python3 -I catalogue/check.py` plus its tests (`cd ../../pipeline && uv run python -I -m pytest -q ../zones/baeckerei-heusser/catalogue`), then the repo gates (`.claude/skills/sle-roadmap/scripts/verify.sh` from the repo root).
- **Screenshots** (headless, free port, `lsof -i :<port>` first, stop the server afterwards). Take fixed poses: the spawn on the street, the door, behind the counter looking at the shelf, a phone viewport 390×844, and one hover state. Drive frames with `window.sle.step(n)`. Save to the git-ignored `docs/shots/baeckerei-heusser/` (repo root). Compare against the reference photos for **proportions and colour mood**, not texture.
- Check the triangle count and draw calls (`renderer.info`) against the class budgets.
- Report honestly what you didn't check (real phone, touch feel).

## Don'ts

- No people, no third-party logos or brand names on cans and bags (use generic labels), no real newspaper front pages, no prices without the owners' consent.
- Don't make it photo-real or ultra-cartoony. If unsure, go simpler and warmer.
- Don't stylise sizes. Don't edit `zones/schloss-karlsberg/`.
