# 0032 · 🧹 Shell layout and tier-gated feature registry

- **Status:** Accepted · 2026-11-04
- **Origin:** V2.2 (builds [0019](0019-feature-tiers.md), [0024](0024-rebuild-shell-keep-core.md), [0026](0026-collapsed-attribution.md))

## Context
[0019](0019-feature-tiers.md) fixes *which* features belong to which tier and forbids hiding by CSS. [0024](0024-rebuild-shell-keep-core.md) rebuilds the shell. Still open: the layout, how features plug in without editing the shell, and how v1 modules leave a lower tier when they bind global keys and have no teardown.

## Decision
| # | Rule |
|---|---|
| 1 | **One layout, two widths.** HUD top-left, minimap top-right, action bar bottom-centre, „© Quellen“ bottom-right, drawers *Orte* / *Werkzeuge* on the left. ≤ 600 px: the same components, bar icon-only (with `aria-label`s), drawers as bottom sheets, dialogs full-screen. No separate phone UI. |
| 2 | **Registry:** a feature is `{ id, tier, panelTier?, available?, shortcuts?, replaces?, mount(host) → teardown? }`. The shell mounts it from `tier` on and unmounts it below; siblings call `shell.registerFeature` instead of editing `src/shell/`. |
| 3 | **Unmount = DOM gone.** Every feature gets its own wrapper elements, which are removed on unmount. `panelTier` lets a Standard 3D layer (OSM paths, LoD2 houses, markers) keep its settings card in Labor; the card is detached below it, not hidden. |
| 4 | **Reload on downgrade** when a feature has no teardown (v1 modules). The URL hash keeps the view. Upgrades mount live. |
| 5 | **Tier** is stored locally (`sle.tier.v1`, default Standard, cleared by *Einstellungen zurücksetzen*). `?tier=` overrides it for one visit and is not saved. |
| 6 | **Splash = attribution + disclaimer.** The [0026](0026-collapsed-attribution.md) splash also carries „Schauen, nicht graben“ ([0008](0008-hypotheses-schauen-nicht-graben.md)). The v1 intro overlay is dropped; the *Steuerung* dialog lists the shortcuts of mounted features, and V2.9 adds a tutorial. |
| 7 | **Gehen** (walk) is a shell mode on top of the drone controller: eye 1.7 m over the DTM, ×1 speed. It is not a new controller. |

## Consequences
- ✅ V2.3 / V2.5 / V2.6 / V2.9 plug in through slots and the registry. API: `app/README.md` → *Shell*.
- ✅ Standard shows ≈ 8 controls. Labor reaches every v1 tool still in the app.
- ⚠️ A downgrade from Labor reloads the page until the v1 modules get teardowns.
- ⚠️ Labor stays usable on phones, but it is cramped there.
