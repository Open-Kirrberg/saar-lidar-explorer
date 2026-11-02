# video2world — reference meshes from the HMS 2022 video

This folder turns aerial shots of the HMS 2022 reconstruction video into scaled meshes, registers them to the
LiDAR, and measures the buildings on them.

- Results: [`measurements.json`](measurements.json)
- Report: [`../research/08-reference-mesh-measurements.md`](../research/08-reference-mesh-measurements.md)
- Shot analysis: [`../research/06-video-analysis.md`](../research/06-video-analysis.md)

**Copyright.** The video is © Architekturvisualisierung Matzerath + Historisches Museum Saar. It is used only as an
interpretive reference. The input, frames, meshes, textures and renders never leave the git-ignored folders
(`input/`, `frames/`, `work/`). Do not commit them, and do not put HMS textures or geometry into the model or the
explorer. Only derived numbers are committed, tagged **HMS**.

## Layout

| Path | Git | What |
|---|---|---|
| `input/` | ignored | the video (`karlsberg_1789_hms_2160p.webm`) |
| `frames/` | ignored | contact sheets / reference crops (research/06) |
| `frame_selection.json` | committed | shot list with usable time ranges |
| `scripts/` | committed | everything needed to reproduce (below) |
| `measurements.json` | committed | measured numbers (HMS), uncertainties, catalogue/LiDAR comparison |
| `work/` | ignored | frames per shot, Object Capture runs, registrations, renders, profile fits |

## Requirements

- macOS 14+ on Apple silicon with Xcode command-line tools (`swiftc`), for RealityKit Object Capture. No NVIDIA needed.
- `ffmpeg` on the PATH.
- The explorer's `pipeline/` uv environment: numpy, scipy, rasterio, matplotlib, Pillow.
- The LiDAR rasters under `../../data/` (read-only).

## Reproduce

```bash
cd schloss-karlsberg/video2world
python3 -I scripts/extract_frames.py                 # all shots in scripts/shots.json -> work/frames/<shot>/ (+ CORE_DAY symlinks)
scripts/run_oc.sh full sequential S04 S08 S09 S23    # builds work/bin/pgtool on first use; ~1.5-2.5 min per shot
scripts/run_oc.sh full unordered CORE_DAY            # combined palace run, ~13 min (S06 alone fails: processError)

cd ../../pipeline                                    # Python runs from the pipeline env, isolated (-I)
PY="uv run python -I ../schloss-karlsberg/video2world/scripts"
for r in CORE_DAY_full:0.12 S09_full:0.2 S23_full:0.12; do $PY/level.py ${r%%:*} --zclip ${r##*:}; done
for r in CORE_DAY_full S09_full S23_full; do
  $PY/register.py ../schloss-karlsberg/video2world/scripts/picks/$r.json   # -> work/reg/$r/registration.json, registered_local.{obj,glb}
  $PY/render_check.py $r                                                  # -> work/renders/${r}_top_over_lidar.png, _side_views.png
  $PY/ground_check.py $r
done
$PY/measure.py CORE_DAY_full S09_full S23_full       # profile fits -> work/measure/*.json, work/renders/*_profiles.png
$PY/elevation.py CORE_DAY_full                       # textured elevations (0.1 m/px) -> work/renders/*_elev_*.png
$PY/uv_view.py CORE_DAY_full -50 60 -45 110 ../schloss-karlsberg/video2world/scripts/measure_spec.json
$PY/lidar_context.py                                 # hillshade + features + catalogue context
```

The heights and axes in `measurements.json` were read by eye from the elevation and uv renders (0.1 m/px and 1 m
grids). They are not written by a script.

## Scripts

| Script | Purpose |
|---|---|
| `pgtool.swift` | CLI for `PhotogrammetrySession`: `pgtool <images> <out> [preview\|reduced\|medium\|full\|raw] [sequential\|unordered] [normal\|high]` → `model/*.obj` (+ baked textures), `poses.json`, `points.ply` |
| `shots.json`, `extract_frames.py` | shot time ranges, fps and caption/sky masks; ffmpeg `-copyts` + `drawbox` (mid-grey) |
| `run_oc.sh` | runs Object Capture per shot, sequentially |
| `level.py` | "up" from the PCA + face-normal mean shift, heading from wall normals, `--zclip` removes the sky sheet; camera-roll QA |
| `view.py` | zoomed levelled DSM for picking segments |
| `picks/<run>.json` | façade segments in the levelled frame ↔ LiDAR edges (`research/lidar_features.geojson`), control/check roles, variants, ridge boxes |
| `register.py` | edge snap → 2D similarity (soft-L1) → court datum 344.8 → tilt from horizontal ridges → composite 7-parameter similarity; exports registered OBJ/GLB in x = E−381000, y = h, z = −(N−5465000) |
| `render_check.py`, `lidar_context.py`, `uv_view.py` | top and side views over the LiDAR hillshade, palace-grid top views |
| `measure.py`, `measure_spec.json` | median cross/long profiles fitted with a mansard/hip model per building |
| `elevation.py` | textured orthographic elevations (numpy z-buffer) for reading the cornice, storeys and axes |
| `ground_check.py` | mesh vs DTM at reference spots |
| `v2w_common.py` | frames (palace grid u/v, explorer local), OBJ/PLY I/O, raster reads |

## Notes

- Object Capture has no gravity for these frames. "Up" is solved twice: first from normals, then from the roofs
  (wing ridges horizontal, twin arms equal). Total tilt fixes were 3–8°.
- Scale depends on which LiDAR edges are controls; the variants differ by up to ±5 %. Read every HMS length and
  height with ±5 %.
- `work/` is about 1.6 GB with all runs. Delete it freely; everything is reproducible from `input/` and `scripts/`.
