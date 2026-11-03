# 0025 · 📚 ADRs + short PRD instead of one living PRD

- **Status:** Accepted · 2026-11-04
- **Origin:** user request · [PRD v1](../history/prd-v1.md) (488 lines, 145 KB, 166 decision rows)

## Context
The living PRD drifted. Superseded decisions sat next to current ones, and every shipped item appended paragraphs. Nobody could read it in one go.

## Decision
| Doc | Rule |
|---|---|
| `docs/adr/NNNN-*.md` | One decision per file: Status · Context · Decision · Consequences, about one screen |
| Accepted ADR | **Never edited**, except its status line (`Superseded by NNNN`) |
| Open decision | Becomes a `Proposed` ADR |
| [`docs/adr/README.md`](README.md) | The only index |
| `PRD.md` | ≤ 150 lines: vision, goals, tiers, roadmap, open questions. Links ADRs and never repeats them |
| `CHANGELOG.md` | One line per shipped item. Details go in commits and module READMEs |
| `docs/history/` | Frozen v1 PRD and v1 roadmap |

`verify.sh` checks the index, the status lines, the supersede targets and the PRD length.

## Consequences
- ✅ Each decision can be read and linked on its own, and drift becomes visible.
- ⚠️ The 166 v1 detail decisions are not ported. They stay in [PRD v1 §9](../history/prd-v1.md#9-decisions-log); implementation details belong in module READMEs.
