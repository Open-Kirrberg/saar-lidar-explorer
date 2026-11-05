# 0016 · 🏭 Two zone kinds, one zone contract

- **Status:** Accepted · 2026-11-04
- **Origin:** v2 workshop

## Context
"A lot more zones will come", so production cost per zone scales everything. Zones come either from research or from video.

## Decision
| Kind | Made by | First zone |
|---|---|---|
| 🏛️ **Reconstructed** | Procedural generator from sources (`schloss-karlsberg/`) | Schloss Karlsberg 1789 |
| 🎥 **Captured** | Video → photogrammetry or Gaussian splats → georeferenced (`schloss-karlsberg/video2world/`) | Bäckerei Heusser in Kirrberg, inside + outside, no people |

- One **zone contract**, written before the code (as in [0004](0004-contract-first.md)): georeferenced footprint, portal and spawn, assets and LOD, renderer preset, attribution, evidence and confidence.
- The captured pipeline gets automated end to end. **Efficiency per zone is a first-class goal.**

## Consequences
- ✅ New zones become a pipeline run, not a project.
- ⏳ Bakery location and footage pending from Hoon. Mesh vs splats is proposed in [0027](0027-captured-zone-method.md).
