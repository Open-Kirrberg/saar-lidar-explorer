# 0010 · 💣 Crater / UXO indicators are never public

- **Status:** Accepted · 2026-11-02
- **Origin:** [PRD v1 §9 (F22, Q-29)](../history/prd-v1.md#9-decisions-log)

## Context
`crater` / `crater_field` from the sister project `saar-lidar-detect` are UXO indicators for professionals. Publishing them would be dangerous and misleading.

## Decision
- **Never public.** Two independent guards: the public build (`SLE_PUBLIC=1`) drops UXO classes while parsing, and the release export strips them from the data, the manifest and the masks.
- The public build hides the crater sentence of the disclaimer too. Crater UI strings (no coordinates) may stay in the bundle.
- Every UI that shows craters adds „Hinweis, keine Aussage über Kampfmittel/Blindgänger“.

## Consequences
- ✅ No leak path through either the build or the export.
- ➡️ v2 moves the F22 code to a private repo ([0020](0020-remove-move-out-freeze.md)).
