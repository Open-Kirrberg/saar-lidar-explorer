# 0015 · 🌍🏰 Overworld + zones behind portals

- **Status:** Accepted · 2026-11-04
- **Origin:** v2 workshop

## Context
The explorer (streamed, analytic) and the castle viewer (detailed, cinematic) are two apps that feel unrelated. More detailed places will follow.

## Decision
```
🌍 Overworld (2025, streamed)  ──portal + loading screen──▶  🏰 Zone (rich preset)
   whole overall AOI                                         castle 1789, bakery, …
```
- **Overworld** = the land today: LiDAR terrain, aerial-photo ground, CHM trees, LoD2 houses, OSM paths.
- **Zones** are detailed places, entered through a portal with a loading screen, like a game dungeon. Entering the castle is **time travel to 1789**.
- Zones reuse the overworld's sky and vegetation modules; only the renderer preset differs.

## Consequences
- ✅ Detail is paid for only where it exists. The overworld can stay light on the phone.
- ✅ The castle's 1789/2025 switch becomes obsolete ([0020](0020-remove-move-out-freeze.md)).
- ➡️ How a zone loads (same bundle or separate app) is decided with the zone contract ([0016](0016-zone-kinds-zone-contract.md)).
