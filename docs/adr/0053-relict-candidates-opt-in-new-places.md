# 0053 · 🔍 Relict candidates are off by default in new places

- **Status:** Accepted · 2026-11-08 (plan D4, proposed in the plan and not contradicted; accepted under the autonomous-roadmap rule)
- **Origin:** [plan „Orte skalieren“](../plans/orte-skalieren.md) §7, §10 D4 · refines [0009](0009-candidates-public-user-data-private.md) for place repos

## Context
[0009](0009-candidates-public-user-data-private.md) made the automatic detection candidates public for the Homburg area, where the maintainers know the sites and the heritage context. At Saarland scale, candidates would appear in places whose Ortspate has not looked at them, next to protected monuments the project does not know. Heritage law (SDschG Saarland, DSchG RLP) and [0008](0008-hypotheses-schauen-nicht-graben.md) ask for care, and crater/UXO indicators are never public ([0010](0010-craters-never-public.md)).

## Decision
- A new place repo publishes **no `candidates`** until its Ortspate sets `relict_candidates = true` in `ort.toml` deliberately (template default `false`; the catalog mirrors the flag).
- Where candidates are switched on, [0009](0009-candidates-public-user-data-private.md) applies unchanged (hypotheses, „Schauen, nicht graben“, crater classes never exported).
- Homburg keeps its candidates when `overall` moves into `ort-homburg` (S3), with the flag set explicitly.

## Consequences
- ✅ No unreviewed hypotheses across the whole state; switching on is a visible, reviewable pull request.
- ⚠️ Places without the flag show no relict layer; the UI explains that the Ortspate can switch it on.
