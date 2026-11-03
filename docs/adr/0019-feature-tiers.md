# 0019 · 🧹 Feature tiers: Standard · Entdecker · Labor · Freeze · Remove

- **Status:** Accepted · 2026-11-04
- **Origin:** v2 workshop · feature-by-feature review with Hoon

## Context
v1 grew to dozens of panels, labels and switches. "Zero structure."

## Decision
New users see **≈ 8 controls**. *Entdecker* and *Labor* are opt-ins in the settings.

| Tier | Overworld | Relict finding | Castle zone |
|---|---|---|---|
| 🟢 **Standard** | Fly/walk + speed · game minimap · nearest places · OSM paths · LoD2 houses · aerial ground · CHM trees · share + QR · settings, a11y · **keybind button → roomy dialog** | Relikt-Blick · glowing candidates · *Merken* + note · first-flight tutorial · disclaimer banner · „© Quellen“ | Fliegen/Gehen · info card · Rundflug as entry · „Gehe zu“ ≈ 8 highlights · *Kino* look |
| 🟡 **Entdecker** | Exaggeration · quality (auto default) · Flurstücke **2D overlay** | 3 lens variants · *Zeitreise* 1840 / 1935 | Time of day · photo mode · one *Gewissheit* control |
| 🔴 **Labor** (desktop) | Full HUD | Relief lab · F15 review, scores, filters · marker list + GeoJSON · measuring (F17) · F18 report | *Dokumentation* look · *Dächer* |

🧊 Freeze and 🗑️ Remove: [0020](0020-remove-move-out-freeze.md).

## Consequences
- ✅ Each feature has one home. Adding a feature means picking its tier first.
- ⚠️ The phone shows a subset of Standard; Labor is desktop only.
