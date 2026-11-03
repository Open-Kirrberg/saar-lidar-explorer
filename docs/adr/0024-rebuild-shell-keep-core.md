# 0024 · 🔨 Rebuild the shell, keep the core

- **Status:** Accepted · 2026-11-04
- **Origin:** v2 workshop

## Decision
| Keep (core) | Rebuild (shell) |
|---|---|
| Terrain engine, shaders, streaming ([0005](0005-custom-terrain-engine.md)) | HUD, panels, toolbar, mobile layout |
| Pipeline, data contract ([0004](0004-contract-first.md)) | Minimap presentation |
| Detection (F15), markers store, state and hash | Onboarding, tutorial, keybind dialog |
| Castle generator | Castle viewer UI (as a zone) |

The new shell is built against [0019](0019-feature-tiers.md) from scratch. It is not incrementally hidden.

## Consequences
- ✅ No refactoring of tested core logic.
- ⚠️ `app/src/ui/` and `main.ts` wiring get replaced. Browser checks start over.
