# 0018 · 🎮 Game look by default, relief as the *Relikt-Blick* lens

- **Status:** Accepted · 2026-11-04
- **Origin:** v2 workshop · screenshot review

## Context
The explorer looks like a GIS (analytic relief everywhere); the castle looks like a game. The public needs the game.

## Decision
- **Default:** game look. Aerial-photo ground, CHM trees, houses, sky.
- 🔍 **Relikt-Blick lens:** fades the trees and shows the relief. Candidates **glow** inside the lens.
- 🟡 Entdecker adds 3 lens variants (Gräben, Mauern, Schummerung) and the *Zeitreise* lens (1840 / 1935).
- 🔴 Labor keeps the full relief lab: 10 modes, 6 combinations, tuning.

## Consequences
- ✅ Relict finding becomes an action ("put on the lens"), not a settings panel.
- ⚠️ Shader work to blend the lens over the game look.
