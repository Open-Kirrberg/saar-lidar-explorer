# 0039 · 🎥 Shared capture tool in `tools/capture/`; the castle's `video2world/` stays

- **Status:** Accepted · 2026-11-04
- **Origin:** V2.8 · replaces the `video2world/` line of [0029](0029-zones-same-bundle-folder-layout.md) · method in [0027](0027-captured-zone-method.md)

## Context
[0029](0029-zones-same-bundle-folder-layout.md) planned to move `zones/schloss-karlsberg/video2world/` to `tools/capture/` in V2.8. V2.8 built `tools/capture/` new instead: video → frames → privacy blur → SfM → mesh → georeference → zone package, driven by one config file per zone. `video2world/` does a different job. It measures buildings on meshes from the HMS 2022 reconstruction video, and the castle's research cites its committed numbers (`measurements.json`, research 06 and 08, `NOTICE.md`).

## Decision
| # | Rule |
|---|---|
| 1 | **`tools/capture/`** is the shared pipeline for every captured zone. The bakery is the first, and new zones add a file in `tools/capture/zones/`. |
| 2 | **`zones/schloss-karlsberg/video2world/`** stays in the castle as the tool behind its HMS evidence. It gets no new captured zones. |
| 3 | Code both need (fisheye undistortion, Object Capture wrapper) lives in `tools/capture/`. `video2world/` keeps its copy until it is touched again. |

## Consequences
- ✅ The castle's HMS numbers stay reproducible, and their copyright notes stay where they are.
- ✅ The capture tool has no castle or HMS assumptions.
- ⚠️ Two copies of `pgtool.swift` exist for now. Fix them when `video2world/` is next changed.
