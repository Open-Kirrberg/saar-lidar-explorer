# 0004 · 📜 Contract first: `docs/data-contract.md` is binding

- **Status:** Accepted · 2026-11-01
- **Origin:** [PRD v1 §9](../history/prd-v1.md#9-decisions-log)

## Context
The pipeline and the app are built in parallel, often by different agents.

## Decision
- [`docs/data-contract.md`](../data-contract.md) defines frames, chunks, encodings and the manifest. It changes **before** the pipeline or the loaders.
- Changes are additive. Old manifests stay loadable.
- The manifest is read–modify–write: each pipeline step owns its keys and keeps all others.
- v2 adds a **zone contract** alongside it ([0016](0016-zone-kinds-zone-contract.md)).

## Consequences
- ✅ Parallel work without integration surprises.
- ⚠️ The contract must not assume one small AOI ([0014](0014-audience-scope-devices.md), v5 scale).
