# 0011 · 🏰 Castle: evidence tags, confidence, no HMS material

- **Status:** Accepted · 2026-11-01
- **Origin:** [`schloss-karlsberg/CLAUDE.md`](../../schloss-karlsberg/CLAUDE.md) · [PRD v1 §9 (F19)](../history/prd-v1.md#9-decisions-log)

## Context
Schloss Karlsberg (destroyed 1793) is reconstructed from sources of uneven quality. The Historisches Museum Saar (HMS) film is © Matzerath / HMS.

## Decision
- Every generated element carries an **evidence tag** and a **confidence level**. Derived values get `I`, HMS-derived numbers get `HMS`. Sources are never invented.
- **No HMS video frames or textures** go into the model.
- Period norms live only in `layout/grammar.ts`.

## Consequences
- ✅ The reconstruction is honest and shows the same hypothesis stance as [0008](0008-hypotheses-schauen-nicht-graben.md).
- ➡️ v2 folds the confidence display into one *Gewissheit* control ([0019](0019-feature-tiers.md)).
