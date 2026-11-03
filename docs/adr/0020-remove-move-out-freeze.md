# 0020 · 🗑️ Remove, move out, freeze

- **Status:** Accepted · 2026-11-04
- **Origin:** v2 workshop · feature review

## Decision
| Action | What | Why |
|---|---|---|
| 🧊 Freeze (code stays, off the UI, unmaintained) | *Mein Standort* (F20) | Waits for a heritage partner ([0021](0021-quests-virtual-only.md)) |
| 🧊 | F16 point cloud + *Röntgen* | Later inside zones |
| 🧊 | Castle festivals (*Kronleuchter*, *Festbeleuchtung*) | Return as v3 events |
| 🧊 | Castle plan sheets, glTF export | Research outputs |
| 🗑️ Remove | AOI switcher (F9) | One area; `karlsberg` / `fixture` stay for dev |
| 🗑️ | 23-line HUD shortcut list | Replaced by the keybind dialog |
| 🗑️ | LOD/Debug panel in production | **Dev builds only** |
| 🗑️ | *Kollision mit Baumkronen* | Walking collides, flying does not |
| 🗑️ | Flurstücke 3D lines + labels (F12) | 2D overlay suffices; data kept for lookups |
| 🗑️ | Castle 1789/2025 terrain switch | The zone is 1789 ([0015](0015-overworld-zones-portals.md)); "2025" showed the 1789 palace |
| 🗑️ | *Vollmondnacht*; shadow, haze, cloud, resolution, interior toggles | Folded into the quality setting |
| 📦 Move out | F21 3D-print planner | Its own tool or repo |
| 📦 | F22 craters | Private repo ([0010](0010-craters-never-public.md)) |

## Consequences
- ✅ Smaller UI and a smaller public bundle.
- ⚠️ Moving out F21/F22 needs its own plan (shared pipeline code, tests, release-strip guards).
