# 0027 · 🎥 Captured zones: photogrammetry mesh or Gaussian splats

- **Status:** Proposed · 2026-11-04
- **Origin:** v2 workshop · PRD open question Q-36

## Context
The bakery is the first captured zone, inside and outside, from Hoon's video. `schloss-karlsberg/video2world/` already produces meshes with Apple Object Capture.

## Options
| | 🧱 Mesh (photogrammetry) | ✨ Gaussian splats |
|---|---|---|
| Look | Clean surfaces, weaker on glass and fine detail | Photoreal, strong interiors |
| Pipeline | Exists (`video2world`) | New (training + three.js splat renderer) |
| Phone (30 fps) | Cheap, standard LOD | Heavy; needs sorting budget |
| Collision, lighting | Easy | Needs a proxy mesh |

## To decide
Decide on the real footage once it arrives. Lean: mesh first (pipeline exists, phone budget), splats as an experiment for the interior.
