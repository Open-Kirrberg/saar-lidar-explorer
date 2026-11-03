# 0008 · ⚖️ Hypotheses only — „Schauen, nicht graben“

- **Status:** Accepted · 2026-11-01
- **Origin:** [PRD v1 §9, §10](../history/prd-v1.md#9-decisions-log) · `research/03`

## Context
Ground monuments are protected (SDschG Saarland §§ 3, 8, 16, 18, 28; DSchG RLP). Searching or digging needs a permit, and finds must be reported. Bunker sites can hold UXO.

## Decision
- Everything the app shows is a **hypothesis** (hedged texts: „vermutlich“, „Hypothese“).
- No digging or metal-detector guidance, anywhere.
- The disclaimer „Schauen, nicht graben“ is always reachable. The report flow points to the Landesdenkmalamt (LDA Saarland, GDKE RLP).

## Consequences
- ✅ A legally defensible stance for a public app.
- ➡️ v2 shrinks the disclaimer to a one-line banner plus a link. It does not remove it ([0019](0019-feature-tiers.md)).
- ➡️ Gamification is constrained by [0021](0021-quests-virtual-only.md).
