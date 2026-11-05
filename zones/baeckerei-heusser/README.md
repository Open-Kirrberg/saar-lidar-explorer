# 🥖 Bäckerei Heusser — digital twin

Zone #2 of the Saar LiDAR Explorer: Bäckerei Heusser, Eckstr. 3, Homburg-Kirrberg, shown with the owners' consent. It is becoming a **built digital twin** ([ADR 0042](../../docs/adr/0042-baeckerei-heusser-built-twin.md)): modelled, clickable objects (counter, shelves, breads, cans …) on a dimensioned floor plan, in a light, friendly, stylised look. Visitors **discover the bakery and its products**. Later rounds add the Backstube and the Lager, plus *Umbau* variants to try out renovations.

## 🧭 Status

| | |
|---|---|
| ✅ Live (V2.8) | Captured zone behind the portal *Bäckerei betreten*: photogrammetry mesh from one walk-through video ([`tools/capture/`](../../tools/capture/README.md), [ADR 0041](../../docs/adr/0041-gltf-zone-runtime-walk-on-mesh.md)). Since 2026-11-05 the private part of the passage is cropped. From now on this mesh is **reference only** (alignment, measuring), not the twin's look. |
| 🚧 Round 1 (2026-11-05) | Foundation: this folder, object catalogue + schema, style rules, privacy rules, zone skills, rename `bakery` → `baeckerei-heusser`. No 3D built yet. |
| ⏳ Next | *Raumplan* v0 (`plan/`, parallel task) → blockout of exterior + *Verkaufsraum* → styled objects, click/tap highlight, info cards, *entdeckt x / y* |
| ⏳ Later | Backstube, Lager, *Umbau* variants (`variants/`) |

## 🗂️ Layout

| Path | What |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Rules for working on the twin (read first) |
| [`docs/style.md`](docs/style.md) | Look: palette, edges, light, detail per object class, interaction |
| [`catalogue/`](catalogue/README.md) | Object catalogue: schema, `objects.json`, `check.py` |
| [`plan/`](plan/README.md) | *Raumplan*: the dimensional backbone (v0 arrives from a parallel task) |
| [`variants/`](variants/README.md) | *Umbau* variants against the current state (*Ist-Stand*) |
| `.claude/skills/` | `bh-twin-objekte`, `bh-aktualisieren`, `bh-umbau`, `bh-datenschutz` |

Generated packages go to the git-ignored `app/public/data/zones/baeckerei-heusser/`. Capture config: [`tools/capture/zones/baeckerei-heusser.toml`](../../tools/capture/zones/baeckerei-heusser.toml).

```bash
python3 -I zones/baeckerei-heusser/catalogue/check.py          # catalogue check (stdlib only)
tools/capture/run.sh baeckerei-heusser package                 # re-package the reference capture (≈ 30 s)
.claude/skills/sle-roadmap/scripts/verify.sh twin              # catalogue gate (also part of `verify.sh` all)
```

## ⚖️ Principles

- **Plan first.** The *Raumplan* fixes the dimensions. Every object has a catalogue id, a source (`plan`, `photo`, `mesh`, `tape`) and an uncertainty `sigma_m`.
- **Built, not scanned.** Modelled geometry is what visitors see. The capture is for measuring.
- **Stylised, true proportions.** Simplified shapes and real shop colours. Sizes are never stylised.
- **Consent scope = shop + exterior.** No people, plates, private entrances or health details. Prices only if the owners agree. Third-party photos are reference only, never textures. Raw material stays in a private folder outside the repo. Details: [`bh-datenschutz`](.claude/skills/bh-datenschutz/SKILL.md).
- **Frames.** Zone frame from the [zone contract](../../docs/zone-contract.md): EPSG:25832, `x = E − E0`, `y = h` (DHHN2016, true heights), `z = −(N − N0)`, `E0/N0 = 381467/5462254`.
