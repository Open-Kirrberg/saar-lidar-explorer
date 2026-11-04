# 0027 · 🎥 Captured zones: photogrammetry mesh first, splats later

- **Status:** Accepted · 2026-11-04
- **Origin:** v2 workshop · PRD open question Q-36 · decided on the first real footage (V2.8)

## Context
The bakery is the first captured zone, inside and outside, from one handheld wide-angle walk-through video. Zones must be cheap to make ([0016](0016-zone-kinds-zone-contract.md)), run on the reference phone at 30 fps, and contain no people or plates (H13).

## Options
| | 🧱 Mesh (photogrammetry) | ✨ Gaussian splats |
|---|---|---|
| Look | Clean surfaces, weaker on glass and fine detail | Photoreal, strong interiors |
| Pipeline | Runs end to end on the Mac: `tools/capture/` (SfM + Apple Object Capture) | New trainer (no Metal one in the toolchain) + three.js splat renderer |
| Phone (30 fps) | One GLB per LOD, standard LOD | ~1–3 M splats sorted per frame |
| Collision, lighting | Easy | Needs a proxy mesh anyway |
| Georeference | Wall fit against LoD2 on the mesh, scale from camera height | Same, on the SfM points |
| Privacy | Blur in the frames, texture inherits it | Same |

## Decision
🧱 **Mesh.** Video → keyframes → privacy blur → fisheye SfM (lens calibration) → undistort → Apple Object Capture → LoD2/DGM1 georeference → GLB per LOD, one command per zone ([`tools/capture/`](../../tools/capture/README.md)).

- The mesh already serves the zone contract (footprint, LOD, collision) and the phone budget.
- ✨ Splats were not tried: no Metal trainer in the toolchain, and a renderer would be new work. Undistorted frames, Object Capture poses and points are kept so a splat run can start from them.

## Consequences
- ✅ A captured zone is a pipeline run (≈ 1.2 h machine time on one Mac + a human privacy review), not a project.
- ⚠️ Glass, the reflective counter and thin plants come out weak or missing; an interior can look flat.
- ⏳ Splats for interiors stay an experiment. If the bakery interior looks too flat in the game, a new ADR compares a splat run on the same SfM.
