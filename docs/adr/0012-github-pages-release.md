# 0012 · 🚀 Public hosting: GitHub Pages via `scripts/release/`

- **Status:** Accepted · 2026-11-02 (reverses the v1 non-goal "local only")
- **Origin:** [PRD v1 §9](../history/prd-v1.md#9-decisions-log) · [RELEASING.md](../../scripts/release/RELEASING.md)

## Decision
- Org **Open-Kirrberg**: the code repo (MIT) has a fresh history; data lives in `saar-lidar-data` and sibling data repos. All are served by GitHub Pages.
- Every release goes through `scripts/release/` (export, secret scan, licence audit) and a review. Updates are one fast-forward commit; `--fresh` is used only on purpose.
- The local repo keeps the full history. Raw and generated data never enter this repo.

## Consequences
- ✅ Free and static, with no server and no tracking.
- ⚠️ Size limits on Pages. v5 (the whole Saarland + RLP, ≈ 650 GB) does not fit (PRD open question Q-34).
- ⚠️ `docs/` ships publicly, so ADRs must not contain private locations (craters, user finds).
