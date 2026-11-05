# 🔧 Umbau variants

A variant is a **proposed change against the current state** (*Ist-Stand*): another counter, a moved shelf, a new lamp, an opened wall to the Backstube. The owners can look at it in 3D, compare it before and after, and measure it before anything is built. Workflow: [`bh-umbau`](../.claude/skills/bh-umbau/SKILL.md).

## Concept

- The **Ist-Stand** is `../plan/` + `../catalogue/objects.json`. A variant never edits them.
- One variant = one folder `variants/<variant-id>/` (id like `theke-l-form`) with:
  - `variant.json`: `id`, `name_de`, `summary_de`, `status` (`idee` | `entwurf` | `abgestimmt` | `verworfen`), `base` (the plan/catalogue version it was drawn against), and the operations:
    - `add`: new catalogue objects (same schema as `../catalogue/`, ids may be new),
    - `move`: `{ id, placement }`,
    - `replace`: `{ id, with }` (the old object is hidden, the new one shown),
    - `remove`: `[id, …]`,
    - `plan`: changes to walls and openings (format follows Raumplan v0).
  - `README.md`: why, open points, the measurements that matter (passage widths, distances to the counter).
- The app shows *Ist* and *Variante* with a switch and the same camera, so before/after shots line up.
- Variants show **planned** changes. Label them clearly (*Umbau-Idee, nicht gebaut*) and never mix them into the Ist-Stand.

## Privacy

Variants may involve areas outside today's consent scope (Backstube, Lager) or business plans. Every variant is **private by default** and stays out of public exports until the owners release it (checklist: [`bh-datenschutz`](../.claude/skills/bh-datenschutz/SKILL.md)). If a variant itself is confidential, keep it in the *privater Materialordner (lokal, nicht im Repo)* and not here.

No variants yet.
