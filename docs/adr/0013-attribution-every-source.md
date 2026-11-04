# 0013 · ©️ Attribution for every source

- **Status:** Accepted · 2026-11-01 · footer rule superseded by [0026](0026-collapsed-attribution.md)
- **Origin:** [PRD v1 §9](../history/prd-v1.md#9-decisions-log)

## Decision
- Each pipeline step adds its exact attribution string to `manifest.attribution`. The app shows it together with OSM and the Flurstücke strings.
- Every new data or asset source adds its entry **before** it ships, and every new asset gets a licence audit before export.
- The footer stays visible full-width text (v1.0.1).

## Consequences
- ✅ Satisfies dl-de/by-2-0 and ODbL.
- ⚠️ The footer costs screen space. The v2 "© Quellen" collapse is proposed in [0026](0026-collapsed-attribution.md).
