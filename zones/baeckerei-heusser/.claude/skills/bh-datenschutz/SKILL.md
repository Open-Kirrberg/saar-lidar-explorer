---
name: bh-datenschutz
description: Privacy and consent rules for the Bäckerei Heusser digital twin and its capture (zones/baeckerei-heusser/, tools/capture/zones/baeckerei-heusser.toml) - what may be public (consent scope shop + exterior only), no people, licence plates, health details, private entrances, courtyards or flats, prices only if the owners agree, third-party photos (social media, website, Street View) as reference only, private material outside the repo - plus the review checklist before any commit, export, zone package or public release. Use it before publishing or exporting anything of the bakery, when new photos or footage come in, when something private appears in the mesh or texture (a person, a mobility aid, a door, a plate, a name), or when the user asks "may we show this", "is this ok to publish", "Datenschutz", "consent", "Einwilligung".
---

# Bäckerei Heusser: privacy and consent

The repo and the explorer are **public**. The owners agreed to show **the shop (*Verkaufsraum*) and its exterior**, and nothing else. When in doubt, leave it out and ask the user. Paths are relative to the repo root.

## What may be public

| ✅ Yes | ❌ No (unless the owners and the people concerned explicitly agree) |
|---|---|
| Shop interior, counter, shelves, products as stylised models | People (staff, customers, passers-by, reflections), faces, voices |
| Street facade, shop window, steps, pickup locker, mural as a simplified graphic | Licence plates, house numbers other than the shop's own |
| The shop's name and address (public business) | Private entrances, the end of the passage, courtyards, flats, mailboxes and name plates, meter boxes |
| Product names and short descriptions the owners gave | Health details of any kind, anything about residents |
| | Prices, opening hours, staff names, internal notes, business plans and *Umbau* variants not released |
| | Third-party photos and texts (social media, the bakery's website, Street View) as files or textures |

**Third-party photos** are modelling reference only: look, measure, sample a colour, then model. Never commit them, never use them as a texture, and never name their file names in committed docs.

**Private material** (raw photos, video, notes, measurements, sketches) lives in the *privater Materialordner (lokal, nicht im Repo)*, the folder `baeckerei-heusser-privat/` next to the repo checkout, listed in `referenz/quellen.md`. Footage for the capture tool sits in the git-ignored `data/raw/zones/baeckerei-heusser/`.

## Capture safeguards (already in place)

- Plates and people are blurred before reconstruction, and close-ups of people are dropped (`tools/capture/` privacy stage, human review of `privacy/qa_*`).
- `[[package.privacy_crop]]` in `tools/capture/zones/baeckerei-heusser.toml` cuts everything beyond the shop's passage door (private house entrance, meter box, mailbox, residents' belongings), geometry and texels. `[[package.privacy_mask]]` spheres inpaint single spots (a leg on the shop floor, the passage end).
- The built twin uses **no photo textures** (ADR 0042), which removes most of the risk.

## Review checklist (before any commit, export or release)

1. `git status` / `git diff --stat`: no images, video, `data/` files or private-folder files staged. Commit an image only if a doc links it and it shows nothing from the "No" column.
2. Catalogue: `python3 -I zones/baeckerei-heusser/catalogue/check.py`. It finds price fields without consent, private file names or paths in `refs`, and objects outside the consent scope that are not `public: false`.
3. Texts (`name_de`, `info_de`, docs, commit messages): no people, no prices, no private details, nothing the owners didn't say.
4. Zone package (if re-packaged): in the app, look at the spawn, the shop, the passage door and the walk end, plus a top view (headless, screenshots in the git-ignored `docs/shots/baeckerei-heusser/`). Check that nothing beyond the passage door shows, and no person, plate or name is readable. After every `mesh` or `export` run, also look at the texture atlas (all tiles).
5. Variants: only those the owners released (`variants/README.md`).
6. Public release (GitHub Pages / data repo): only through `scripts/release/` and its review (`scripts/release/RELEASING.md`), with this checklist ticked in the release notes.

If something private turns up in a published artifact: remove it from the package (crop or mask, then re-package), tell the user right away, and note it in the commit message. Don't wait for the next round.
