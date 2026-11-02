# 04 — Reference video & the Video2World question

> Research date: 2026-11-01. Scope: (1) identify the video showing a 3D model of Schloss Karlsberg,
> (2) assess https://github.com/AetherLabsAI/Video2World, (3) pick a working "CG video → 3D" pipeline for an
> Apple-Silicon Mac, (4) legal limits. Evidence tags: **[D]** documented (source given), **[I]** inferred
> (reasoning given), **[U]** unknown / to verify, **[T]** tested on this machine today.

## TL;DR

1. **The video is "3D-Rekonstruktion und Animation: Schloss Karlsberg 1789"** by the *Historisches Museum Saar*
   on YouTube, https://www.youtube.com/watch?v=kfnE6HdXmVo, uploaded 2022-11-16, 2:04 min, up to 3840×2160 at 60 fps.
   It is a photoreal CG fly-through by *Architekturvisualisierung Matzerath* and the Historisches Museum Saar
   (realisation: Andreas Matzerath, Simon Matzerath, Dr. Jutta Schwan). It shows the exteriors of the whole
   residence, with 11 labelled buildings or areas. There are **no room interiors**, only gate passages.
   A copy is already in `video2world/input/`, fetched earlier today by another session (I downloaded nothing).
2. **Video2World is the wrong tool.** It is not a video→mesh or video→splat reconstructor. It is a
   *benchmark* (Apache-2.0, v1.0.0, repo created 2026-10-05) that scores how well coding agents such as Claude Code turn
   **robot-manipulation videos** into physics simulations (ManiSkill/SAPIEN, MuJoCo, Isaac Sim). It has no
   reconstruction model and no weights, and it does nothing with a palace fly-through. A cloud GPU would not change
   that. Its useful *idea* is the agent loop ("look at frames → write the scene as code → render → compare"). We can
   run that loop ourselves (§4, step 6).
3. **What works locally: Apple Object Capture** (RealityKit `PhotogrammetrySession`). **[T]** It ran with only the
   Command Line Tools (no Xcode, no download). On 41 frames of one 5-second aerial shot it made a coherent textured
   mesh of the Orangerie, the main wings, the avenue and the utility buildings. Run time was **2 min 18 s**. All 41
   camera poses were recovered (focal 2789 px at 3840 px width ≈ 69° HFOV, no lens distortion). A second shot
   (54 frames, `medium`, 2 min 54 s, 50k triangles) gave a readable plan of the main complex. Optional second track:
   COLMAP (sparse, CPU) + Brush/OpenSplat (Gaussian splats on Metal) for a fly-through-quality splat.
4. **Legal:** the video and everything derived from it are © Architekturvisualisierung Matzerath / Historisches
   Museum Saar. Keep it private and local, keep it out of git, and never publish it or ship it in the explorer.
   Use derived meshes only as a *proportion/massing reference* for our own model, built from our own sources.
   Best long-term route: **ask the museum or Matzerath for permission or for the model itself** (§5).

---

## 1. Candidate videos

| # | Video | Publisher / creator | Date · length · resolution | What it shows | Fit for "video with a 3D object" |
|---|---|---|---|---|---|
| **1** | **"3D-Rekonstruktion und Animation: Schloss Karlsberg 1789"** — https://www.youtube.com/watch?v=kfnE6HdXmVo | YouTube channel *Historisches Museum Saar* (@historischesmuseumsaar6124, channel UCq3nm6dmvq67zM94MvDfCew). Description: "© Architekturvisualisierung Matzerath und Historisches Museum Saar · Realisierung: Andreas Matzerath, Simon Matzerath, Dr. Jutta Schwan" **[D]** (local `info.json` / `.description` written by yt-dlp) | Upload 2022-11-16; 124.2 s; best format 2160p60 VP9 (fmt 315, 20.3 Mbit/s, 316 MB). AV1 2160p60 (fmt 401, 350 MB), 1440p60 and 1080p60 also listed **[D]** | Photoreal CG fly-through of the **whole residence**: ground-level walks, aerial obliques, top-down views, about 22 shots, German captions (shot list below) | **Best match** — the only CG animation of the complex we found; linked as "3D-Rekonstruktion und Animation des Schloss Karlsberg" on [urlaub.saarland](https://www.urlaub.saarland/attraktion/waldpark-schloss-karlsberg-b3b4fdbdf1) and [Saarpfalz-Touristik](https://www.saarpfalz-touristik.de/en/poi/detail/waldpark-karlsberg-castle-94eeef2466) **[D]** |
| 2 | "Kurzfilm „Schloss Karlsberg. Ein bisschen mehr als ‚nur Gemäuer'" — https://www.youtube.com/watch?v=Z4uGahSjIRI | Channel *Saarpfalz-Kreis*; students N. Heinrich, F. Schreiner, D. Schwan (Hochschule Kaiserslautern, Campus Zweibrücken) **[D]** ([Saarpfalz-Kreis PM 2025-06-27](https://www.saarpfalz-kreis.de/saarpfalz-kreis/de/aktuelles/pressemitteilungen/2025/juni/kurzfilm-zu-schloss-karlsberg-begeistert)) | Presented June 2025; about 4 min **[D]**; resolution **[U]** | Ruins today, drone shots, history. Voice-over by Jutta Schwan; **reuses parts of #1** **[D]** ([Rheinpfalz](https://www.rheinpfalz.de/lokal/zweibruecken_artikel,-zweibr%C3%BCcker-studenten-drehen-werbefilm-%C3%BCber-schloss-karlsberg-_arid,5789376.html)). Saarpfalz-Touristik links it at `&t=207s`, so the animation part probably starts around 3:27 **[I]** | Second-hand copy of #1 at lower quality — use only if #1 disappears |
| 3 | "Schloss Karlsberg – Das versunkene Versailles des Südwestens" — https://www.sr-mediathek.de/index.php?seite=7&id=142850 | SR Fernsehen, author Sven Rech **[D]** | Broadcast 2025-12-18, 43:34 **[D]**; one listing says the film dates from 2015 **[U]** | Documentary built on paintings and Mannlich's memoirs; whether it contains CG is **[U]** | Not a 3D-model video, but worth watching for sources |
| 4 | "Schloss Karlsberg wird wieder lebendig – digitale 3d Rekonstruktion" | Named on [homburg.de/…/schloss-karlsberg](https://www.homburg.de/index.php/tourismus-neu/sehenswertes/schloss-karlsberg) ("mit Shockwave 3D rekonstruiert") per search-engine snippet; the page returned HTTP 500/404 to us **[U]** | **[U]** | **[U]**; the page points to "WaldPark Schloss Karlsberg", which links #1, so it is probably the same video **[I]** | Re-check when homburg.de responds |
| — | Still images "Steinerne Macht" (2018/19) | Historisches Museum Saar exhibition (17.11.2018–23.06.2019), "großformatige fotorealistische Computer-Rekonstruktionen", Karlsberg credit "© Historisches Museum Saar, Andreas Matzerath, Jutta Schwan, in Zusammenarbeit mit Marc Engel, Simon Matzerath" **[D]** ([HMS](https://www.historisches-museum.org/steinerne-macht), [Rheinpfalz 2018](https://www.rheinpfalz.de/lokal/kreis-suedwestpfalz_artikel,-zerst%C3%B6rte-pracht-jetzt-wieder-sichtbar-_arid,1312894.html)) | 2018 | Still renders; the 2022 animation is very likely built on the same model **[I]** (same team, same museum) | Good high-res stills (request list §6) |

No Vimeo, Sketchfab or other CG animation of Karlsberg turned up **[D: searches above]**. The Hörpfad
(https://hoerpfad.schloss-karlsberg.de) is an audio trail with no 3D **[D]**.

### 1.1 Video #1 — technical facts (local file, read-only probe) **[D/T]**

`video2world/input/karlsberg_1789_hms_2160p.webm`: VP9, 3840×2160, 60 fps, yuv420p SDR, 124.217 s, 315,887,698 B,
no audio track. YouTube licence field: empty, i.e. standard YouTube licence, **not** Creative Commons **[D]**.
Tags: 3D-Rekonstruktion, 3D-Animation, Schloss Karlsberg, Homburg, Saarland, Historisches Museum.
Description: "Die Darstellung ist präziser als die überlieferten, in vielerlei Hinsicht idealisierenden historischen
Ansichten" ("more precise than the surviving historic views, which idealise in many respects"). The authors claim
the model rests on current research (Schwan), which makes it a strong *secondary* source.

Look **[I]**: a real-time-engine look (dense grass, volumetric fog, depth of field, motion blur), probably Unreal,
Twinmotion or Lumion; the engine is **[U]**. Surfaces are fully textured: rubble masonry, plaster, slate and tile
roofs, shutters. That suits photogrammetry much better than flat shading.

### 1.2 Shot list (cut times from `ffmpeg select='gt(scene,0.25)'` **[T]**; content from 1-fps contact sheets **[T]**; times ±1 s)

| t (s) | Shot | Caption in video (verbatim) | Use for reconstruction **[I]** |
|---|---|---|---|
| 0.3–7.5 | Ground-level glide over lawn towards long wings | — | weak (trees occlude) |
| 8.5–18.1 | Close pass along portico (columns, balcony, striped sentry boxes) → reveal of **Ehrenhof / Corps de logis** with central Dachreiter | "SCHLOSS KARLSBERG IN HOMBURG / ERBAUT AB 1777" | façade details, courtyard elevations |
| 18.1–28.9 | Rise over the courtyard → top-down pull-back over the U/L-shaped main complex | "ZERSTÖRT DURCH FRANZÖSISCHE REVOLUTIONSTRUPPEN 1793", "KÜCHENBAU" | **plan geometry** of the main complex |
| 29–34 | Ground mist, side view of a long building | — | elevation |
| 34–37 | Aerial | "SAMMLUNGSFLÜGEL MIT BIBLIOTHEK, NATURALIENKABINETT UND WAFFENSAMMLUNG" | plan + labels |
| 37–39.5 | Ground view along the avenue into the court | "BLICK VON DER SCHLOSSALLEE IN DEN INNENHOF" | axis / approach |
| 39.5–47.6 | **High oblique flight over the whole site** (wings, Orangerie, avenue, red-roofed utility row) | "ORANGERIE: EIN FESTSAAL FÜR EXOTISCHE PFLANZEN" | **best site-scale shot** (tested, §3.3) |
| 47.6–53 | Top-down over the utility row with walled garden squares | — | plan of utility buildings |
| 53–61 | Ground/low aerial along red-roofed buildings | "NUTZBAUTEN FÜR DAS SCHLOSS: LAZARETT, KASERNEN UND BRAUEREI" | elevations, roof forms |
| 61–63.5 | Top-down | "„APPELALLEE": FÜHRT IN DEN PARK KARLSLUST" | avenue alignment (sic "Appelallee") |
| 63.5–71.4 | Long wing with gable risalit and roof lantern | "MODERNE BLITZABLEITER „HEMMER'SCHE FÜNFSPITZEN"" | details |
| 71.4–84.9 | Frontal approach to a wing with gate, through the Durchfahrt | "HERZOGLICHER WOHNFLÜGEL MIT SPEISESÄLEN UND SILBERKAMMER" | façade rhythm (axes, storeys, mansard) |
| 84.9–90 | Inner court → rise | "DIE TREIBHÄUSER DES HOFGÄRTNERS LUDWIG REICHARD" | greenhouse block |
| 90–95.4 | Low flight over lawn, animals, building with cupola | — | weak |
| 95.4–100.6 | Top-down; **lighting changes** to a pale/hazy state | "BLICK AUF DEN MARSTALL MIT REITHAUS UND HUNDEZWINGER" | plan of Marstall group |
| 100.6–116.6 | Golden-hour aerial obliques | "BILDERGALERIE MIT ANSCHLIESSENDER ROTUNDE", "BLICK IN DEN ENGLISCHEN GARTEN VON BERNHARD PETRI" | massing of gallery + rotunda (different lighting) |
| 116.6–124.2 | Credits (logos HMS + "Architekturvisualisierung Matzerath") | "Schloss Karlsberg, 1789, Saarpfalz-Kreis, Saarland" | — |

**Not shown [D]:** room interiors (only gate passages), Karlslust park structures in detail, Tschifflik,
Menagerie, cascade or ponds (at most in the background **[U]**). So the "walk into it" part of our model needs
other sources: plans, Mannlich's descriptions, comparable palaces (see the other research files).

The captions are themselves **documented claims of the HMS reconstruction** (a secondary source). They should feed
the building catalogue, e.g. Sammlungsflügel = Bibliothek + Naturalienkabinett + Waffensammlung, and Marstall + Reithaus + Hundezwinger as one group.

---

## 2. Video2World (AetherLabsAI) — assessment

Sources: repo README, `pyproject.toml`, `docs/benchmark.md`, `docs/custom_agent.md`, `video2sim/PROTOCOL.md`, commits,
issues and releases via `gh api` (read-only) **[D]**; paper [arXiv 2610.04432](https://arxiv.org/abs/2610.04432);
[project page](https://aetherlabsai.github.io/Video2World/).

| Question | Answer |
|---|---|
| What is it? | *"Video2World: Benchmarking Coding Agents for Interactive World Modeling from Embodied Videos"* (Aether AI + UC San Diego). A **benchmark** in which a coding agent (Claude Code, Codex, OpenCode or a custom one) watches a robot or human manipulation video and writes a simulator scene plus robot actions. An evaluator then scores geometry, dynamics and task success ("V2WScore") **[D]** |
| Does it turn video into a mesh, splats or a world model? | **No.** It ships no reconstruction network and no weights. Geometry is whatever the agent writes, as a "video2sim protocol package" (`protocol.json`, `actions.npy`, URDF/OBJ/STL meshes, `report.md`) **[D]** |
| Inputs | 222 instances / 189 clips of robot or hand manipulation (FurnitureBench, DROID, RoboDojo, HOI4D, HOT3D, DexYCB, OakInk2, …), each with a task brief, hidden ground truth and a fixed simulator target **[D]** |
| Outputs | Scores (`summary.json`, `samples.csv`) and the agents' packages **[D]** |
| Hardware | Scoring core: plain Python (numpy, scipy, trimesh, imageio, OpenCV), runs anywhere. Evaluation: ManiSkill 3.0.1 / SAPIEN 3.0.3 (Vulkan), MuJoCo 3.11, **Isaac Sim 5.1 + Isaac Lab ("needs GPUs with a working Vulkan device")**; the example run uses `--gpus 0,1` **[D]**. Isaac Sim is NVIDIA-only **[I]**. No Apple-Silicon path **[I]** |
| Dependencies / data | `pip install -e .[sim]` / `[twin]`; dataset `AetherLabs-AI/Video2World` on Hugging Face (Apache-2.0, not gated, multi-GB **[U]**) **[D]** |
| Licence | Code Apache-2.0; dataset Apache-2.0; paper CC BY-SA 4.0 **[D]** |
| Maturity | Created 2026-10-05; 9 commits (last 2026-10-19); v1.0.0 in pyproject; no releases; 0 issues; 223 ★, 1 fork **[D]** |
| Results | Best agent V2WScore ≈ 48.5 vs. human-assisted reference 74.2. Leaderboard lists Claude Opus 5.5 at 52.41 **[D]** (project page) |
| **Fit for Karlsberg** | **None as a tool.** No task family for static architecture; the evaluator needs hidden ground truth; the output is a robot-sim package, not a georeferenced building model. A cloud GPU would only let us run *the benchmark*, not reconstruct the palace **[I]** |
| What transfers | The *method*: agent looks at frames → writes scene as code → executes/renders → compares to video → iterates. That is how we should use the video (§4 step 6) **[I]** |

Possible confusion: NVIDIA's Cosmos "Video2World" models are also called "Video2World". They are *video generation*
models (video → future video), and they don't make 3D either **[I]** (not pursued further).

---

## 3. Alternatives for "CG video → 3D" on an Apple M5 Pro (48 GB, macOS 26)

### 3.1 Comparison

| Tool | Runs here? | Output | Licence | Notes |
|---|---|---|---|---|
| **Apple Object Capture** (RealityKit `PhotogrammetrySession`) | **Yes [T]**: `isSupported = true`; limits 1500 images, 16384 px max dimension; builds with Command Line Tools Swift 6.3 | USDZ (or OBJ folder) textured mesh; also `.poses` (camera intrinsics + extrinsics) and `.pointCloud` requests **[D: SDK swiftinterface]** | macOS system framework; our script is our own | Detail `preview`/`reduced`/`medium`/`full`/`raw` and custom (max polygons, 1k–16k textures, diffuse/normal/AO/roughness/displacement) **[D: SDK]**. Reduced = 25k tris and 2048² textures **[T]**. A forum report says the custom polygon count is clamped (250k on an M1 Max) ([Apple forum](https://developer.apple.com/forums/thread/786083)) **[D]** |
| **COLMAP 4.2.1** | Yes, **sparse only** (SIFT and matching on CPU). Dense `patch_match_stereo` needs CUDA ([COLMAP FAQ](https://colmap.github.io/faq.html)) **[D]**. Homebrew formula 4.2.1 available, not installed **[D]** | cameras + sparse points (COLMAP/PLY) | BSD | GLOMAP is merged as `colmap global_mapper` **[D]** ([glomap README](https://github.com/colmap/glomap)) |
| **Brush** (ArthurBrussee/brush) | Yes: macOS arm64 binary v0.3.0, 41 MB, WebGPU/Metal **[D]** | Gaussian-splat `.ply` | Apache-2.0 | Input: COLMAP or nerfstudio dataset; **mask folder supported** ("masks/", black = ignore) **[D]**. Splat only, no mesh |
| **OpenSplat** (WebODM/OpenSplat v1.2.2) | Yes: build from source with libtorch; `GPU_RUNTIME=MPS` on macOS **[D]** | `.ply` / `.splat` / `.spz` | **AGPL-3.0** | Needs COLMAP sparse points |
| VGGT / MapAnything (feed-forward poses + depth) | Probably: MPS PRs merged in VGGT ([#95](https://github.com/facebookresearch/vggt/pull/95), [#112](https://github.com/facebookresearch/vggt/pull/112)) **[D]**; MapAnything falls back to CPU **[D]** | COLMAP export, GLB **[D]** | VGGT original checkpoint non-commercial, VGGT-1B-Commercial gated; MapAnything has an Apache-2.0 model **[D]** | ~1B-parameter models, several GB of weights **[I]**. Fallback when SIFT fails on low-texture views |
| nerfstudio / gsplat | Not practical: gsplat is "CUDA accelerated" **[D]**; last nerfstudio release 2024-11 **[D]** | — | Apache-2.0 | cloud GPU only |
| Meshroom (AliceVision) | Dense steps need CUDA **[I]** | mesh | MPL-2.0 **[U]** | skip |
| Cloud GPU (e.g. COLMAP dense, 2DGS/PGSR mesh extraction) | Possible, not needed for massing | dense mesh | — | Only if Object Capture meshes prove too coarse. Cost and provider not researched **[U]** |
| **fSpy** + Blender (single-frame camera matching) | Yes **[I]** (desktop app) | camera per frame | GPL-3.0 **[U]** | For façades seen in one frame: measure storey heights, axis counts, roof pitch against a known width |

### 3.2 Quality to expect from *this* video **[I unless noted]**

- **Good:** photoreal textures (masonry, roofs) give many features. The CG camera has no lens distortion: Object
  Capture estimated a near-zero radial table **[T]**, so a PINHOLE model is right. 4K/60 fps source with a smooth
  camera path. Aerial obliques show roofs and footprints at once.
- **Bad:** shots last 3–15 s (≈22 cuts), so each shot is a separate reconstruction with its own arbitrary scale and
  frame. Shots join only through manual alignment or shared overlap. Other problems:
  - Repetitive Baroque façades (identical window axes) can produce wrong matches.
  - Moving content: wind in grass and trees, grazing animals, drifting fog, animated caption lines.
  - Depth of field and motion blur in fast moves (around 8 s, 19 s, 86–87 s).
  - **Burned-in captions** (lower third and callout lines).
  - A **lighting change** in the late shots (pale/haze, then golden hour).
  - The flight paths are one-sided, so the far sides of buildings are missing.
- **Result type:** per-shot **2.5D relief meshes** that are accurate *as seen from the flight path*. The top view of
  the test mesh shows vertical smearing where walls were seen at a grazing angle **[T]**. Expected massing error
  after scaling: about ±1–3 m in plan and ±1–2 m in eaves height for large blocks **[I]**, to be checked against
  LiDAR. That is fine for a proportion reference, not for final geometry.

### 3.3 Test run (today) **[T]**

- Frames: shot 42.35–47.5 s (high oblique, Orangerie + main complex), `fps=8` → 41 JPEGs at 3840×2160 (59 MB).
  Extraction took 1.7 s.
- `PhotogrammetrySession`, `sampleOrdering = .sequential`, `featureSensitivity = .high`, detail `reduced` →
  **2 min 18 s**, 11.3 MB USDZ (25,000 triangles, 2048² diffuse + normal + AO). **41/41 poses** recovered.
  Intrinsics: f = 2788.8 px, c = (1907, 1025) px.
- Visual check (renders made with `usdrecord`): the main wings, Orangerie, avenue tree rows and red-roofed utility row
  are clearly recognisable. Edges are soft, the forest is a relief, and the edges of the covered area smear.
  Renders: `<local scratch dir>`,
  `<local scratch dir>`
  (scratchpad, session-local; derived from the copyrighted video, so don't move them into `research/img/`, which is tracked).
- A second run on the courtyard pull-back (18.2–28.9 s, 54 frames, `medium`) is in §3.4.
- The test frames and meshes live only in the scratchpad (`…/scratchpad/oc_test/`). Re-create them under
  `video2world/frames|work` when the modelling phase needs them.

### 3.4 Second test — courtyard pull-back (18.2–28.9 s) **[T]**

- 54 frames at `fps=5` (4K), detail `medium` → **2 min 54 s**, 35.7 MB USDZ (**50,000 triangles**, 4096² textures).
  **54/54 poses** recovered.
- The result is a clean near-orthographic **plan of the main complex**: both courtyards (Küchenbau court + Ehrenhof),
  wing widths, the rhythm of the dormers and the corner/centre pavilions can be read. That makes it the most valuable
  shot for the Grundriss/Lageplan cross-check.
- **Gravity is not reliable.** In this run the mesh's "up" was tilted about 40–60° from true vertical. The
  Orangerie run came out roughly level **[T]**. So orientation must always come from the georeferencing similarity
  (step 5), never from the USDZ axes.
- Renders: `<local scratch dir>`
  (plan-like) and `<local scratch dir>`.
- Conclusion: shots with a top-down or high-oblique pull-back give usable plan geometry in about 3 min each. Ground-level
  shots (trees, depth of field, moving grass) are expected to do much worse **[I, untested]**.

---

## 4. Recommended pipeline (concrete)

Folder convention (inside `schloss-karlsberg/video2world/`). `input/`, `frames/` and `output/` are already git-ignored
by `schloss-karlsberg/.gitignore`. **Add `video2world/work/`** before using it: `.gitignore` is not my file, so this
is flagged as an open item.

```
video2world/input/   karlsberg_1789_hms_2160p.webm (+ .info.json, .description)   [present]
video2world/frames/  shot_XX/ f_0001.jpg …  + masks/shot_XX/…                     [ignored]
video2world/work/    colmap dbs, splats, usdz per shot                             [add to .gitignore]
video2world/output/  georeferenced reference meshes (glb), never committed         [ignored]
```

**Step 0 — source.** The 2160p60 VP9 file is already local. If it ever has to be re-fetched, that is a download
request (§6). `yt-dlp -f 315 --write-info-json --write-description -o 'input/karlsberg_1789_hms_2160p.%(ext)s' https://www.youtube.com/watch?v=kfnE6HdXmVo`.

**Step 1 — cut detection (22 s) [T]:**
```bash
V=video2world/input/karlsberg_1789_hms_2160p.webm
ffmpeg -hide_banner -nostats -i $V -vf "scale=960:-1,select='gt(scene,0.25)',showinfo" -an -f null - 2>&1 \
  | grep -o 'pts_time:[0-9.]*'          # → shot table §1.2; runs of hits = dissolves/fast moves, skip those
```

**Step 2 — frames per shot (seconds) [T].** Use 6–10 fps for aerial shots and 4–6 fps for ground shots. Trim
0.3 s at each cut and skip dissolves.
```bash
mkdir -p video2world/frames/s09 && ffmpeg -hide_banner -loglevel error -ss 42.35 -to 47.5 -i $V \
  -vf "fps=8" -q:v 2 video2world/frames/s09/f_%04d.jpg
# optional: drop near-duplicates / blurred frames
#   -vf "mpdecimate,fps=8" -fps_mode vfr
#   uv run --with opencv-python-headless==4.12.0.88 python -I blur_score.py frames/s09   (Laplacian variance, drop lowest 15 %)
```
Disk: about 1.4 MB per 4K JPEG at q 2 **[T]**. All useful aerial shots at 8 fps (≈60 s → ~500 frames) take about 0.7 GB.

**Step 3 — captions / overlays.** Object Capture takes no per-image masks from a folder, so **crop** the caption
band or blank it out:
```bash
# lower-third captions sit roughly in the bottom 22 % of the frame: crop them away (Object Capture path)
ffmpeg ... -vf "fps=8,crop=iw:ih*0.78:0:0" ...
# COLMAP/Brush path: keep full frames, add masks (white = keep, black = ignore), same file names
ffmpeg -f lavfi -i color=white:s=3840x2160 -vf "drawbox=x=0:y=ih*0.78:w=iw:h=ih*0.22:color=black:t=fill" -frames:v 1 mask.png
for f in video2world/frames/s09/*.jpg; do cp mask.png video2world/frames/masks/s09/$(basename $f).png; done  # COLMAP: <image>.png
```
Callout lines and circles in the upper part of the frame are thin. They usually fail feature matching rather than
causing harm. Mask them by hand only if they cause artefacts **[I]**.

**Step 4a — mesh with Apple Object Capture (primary, no install) [T].** Save as
`video2world/photogrammetry.swift`. It is the exact script I tested; build with `swiftc -O -o pgtool photogrammetry.swift`.
```swift
// Usage: pgtool <imagesDir> <out.usdz|outDir/> [preview|reduced|medium|full|raw] [--check]
import Foundation
import RealityKit
let a = CommandLine.arguments
print("isSupported =", PhotogrammetrySession.isSupported,
      "maxImages =", PhotogrammetrySession.limits.maximumNumberOfInputImages)
if a.contains("--check") || a.count < 3 { exit(0) }
let detail: PhotogrammetrySession.Request.Detail =
  ["preview": .preview, "reduced": .reduced, "medium": .medium, "full": .full, "raw": .raw][a.count > 3 ? a[3] : "medium"] ?? .medium
var cfg = PhotogrammetrySession.Configuration()
cfg.sampleOrdering = .sequential      // frames from a video
cfg.featureSensitivity = .high        // smooth plaster walls
cfg.isObjectMaskingEnabled = false    // a site, not a turntable object
cfg.ignoreBoundingBox = true
let session = try PhotogrammetrySession(input: URL(fileURLWithPath: a[1], isDirectory: true), configuration: cfg)
Task {
  for try await out in session.outputs {
    switch out {
    case .requestProgress(_, let f): print(String(format: "progress %.1f%%", f * 100))
    case .requestComplete(_, let r): print("complete:", r)      // .poses → intrinsics + camera transforms
    case .requestError(_, let e): print("error:", e)
    case .processingComplete: print("done"); exit(0)
    default: break
    }
  }
}
try session.process(requests: [.modelFile(url: URL(fileURLWithPath: a[2]), detail: detail), .poses])
RunLoop.main.run()
```
```bash
./pgtool video2world/frames/s09 video2world/work/s09_medium.usdz medium   # ~2–5 min per 40–60 frames [T/I]
usdcat work/s09_medium.usdz -o work/s09.usda                               # inspect (macOS ships usdcat/usdrecord)
# a directory as 2nd arg → OBJ + textures instead of USDZ [D: Apple docs]; convert to glb with Blender (USD import) or obj2gltf
```
Runtime for all aerial shots, 10 shots × 50 frames at `medium`: about 30–50 min. Output: about 10–40 MB per shot **[I]**.
Try a combined run with `sampleOrdering = .unordered` over several aerial shots under the same lighting (shots
18–63 s). If they register together, we get one larger connected mesh **[I, untested]**.

**Step 4b — splats for a "fly through it" preview (optional).**
```bash
brew install colmap                       # 4.2.1; download request §6
DB=video2world/work/s09/database.db; IMG=video2world/frames/s09
colmap feature_extractor --database_path $DB --image_path $IMG --ImageReader.camera_model PINHOLE \
  --ImageReader.single_camera 1 --ImageReader.mask_path video2world/frames/masks/s09 --FeatureExtraction.use_gpu 0
colmap sequential_matcher --database_path $DB --FeatureMatching.use_gpu 0
colmap global_mapper --database_path $DB --image_path $IMG --output_path video2world/work/s09/sparse   # or: colmap mapper
# Brush (41 MB binary) reads <dir>/images + <dir>/sparse/0 (COLMAP layout); check `brush --help` for export flags
brush video2world/work/s09 --with-viewer
```
Option names changed between COLMAP 3.x and 4.x. Check each with `colmap <cmd> -h`. CPU SIFT on 50 4K frames:
a few minutes. Brush training: 10–30 min per shot on M-series **[I]**. Splats are great for looking, but they are
not geometry for our model.

**Step 5 — scale + georeference (per shot).** The mesh has arbitrary scale and orientation, Y-up **[T]**.
1. Pick ≥ 4 well-spread control points visible in the mesh *and* in our LiDAR products
   (`data/work/karlsberg/{slrm,vat,dtm}.tif`). Candidates: corners of the main-wing foundations visible in SLRM/VAT,
   the ends of the avenue axis, terrace edges. Mark each as [D] (visible in LiDAR) or [I] (assumed from the
   historic plan).
2. Solve a 7-parameter similarity (Umeyama) mesh → (E, N, h); report residuals. Accept RMS ≤ 2 m.
   ```python
   import numpy as np
   def umeyama(src, dst):            # src, dst: (n,3); returns s, R, t with dst ≈ s·R·src + t
       mu_s, mu_d = src.mean(0), dst.mean(0); S, D = src - mu_s, dst - mu_d
       U, sig, Vt = np.linalg.svd(D.T @ S / len(src)); C = np.eye(3)
       C[2, 2] = np.sign(np.linalg.det(U @ Vt)); R = U @ C @ Vt
       s = (sig * np.diag(C)).sum() / (S ** 2).sum(axis=1).mean(); return s, R, mu_d - s * R @ mu_s
   ```
   Use (E, N, h) as a right-handed frame (x = E, y = N, z = h). Then convert to the explorer local frame:
   `x = E − 381000, y = h, z = −(N − 5465000)` (data contract).
3. Optional refinement: ICP of the mesh's *ground* faces against the DTM with scale locked, in CloudCompare
   (manual). The CG terrain is stylised, so trust building corners more than terrain **[I]**.
4. Cross-check: the scaled courtyard width and wing lengths against historic plans and LiDAR footprints. Disagreements
   go into the building catalogue as conflicts, not silently fixed.

**Step 6 — the "Video2World" loop, done our way.** For each shot, keep the recovered camera poses and intrinsics
(Object Capture `.poses`, or COLMAP `images.txt`). Transform them with the same similarity into the local frame.
Then **render our own procedural model from exactly those cameras** and compare with the video frames: silhouette
IoU, edge overlay, roof-ridge heights. Claude (or a script) adjusts parameters such as wing length, storey height,
roof pitch and axis count, and iterates. This uses the video as a measurement instrument without copying its
geometry or textures into our deliverable **[I]**. It is also the cleanest legal position (§5).

**Totals:** extra downloads ≈ 0 for the Object Capture path. Optional: COLMAP via Homebrew (several hundred MB with
dependencies **[I]**) and Brush (41 MB). Disk ≈ 1–3 GB including frames and work files. Time ≈ 1–2 h of compute for
all usable shots, plus manual control-point picking.

---

## 5. Legal note (not legal advice)

- **Rights holder [D]:** "© Architekturvisualisierung Matzerath und Historisches Museum Saar". Standard YouTube
  licence, not CC. The CC BY label on the Saarpfalz-Touristik page covers *its text*, not the embedded video **[I]**.
- **YouTube ToS** forbid downloading content except where YouTube offers it or with permission from YouTube and the
  rights holders (https://www.youtube.com/t/terms) **[D]**. The local copy already exists; treat it as a private
  working copy.
- **German copyright law [I]:**
  - §53 UrhG allows private copies for strictly private use.
  - Under §23 UrhG, *making* an adaptation (frames, a reconstructed mesh) is generally allowed. *Publishing or
    exploiting* it needs consent.
  - §44b UrhG (text and data mining) may also cover analytical copies, but they must be deleted when no longer
    needed.
  - The 1780s palace itself is public domain (Mannlich died 1822). The 2018/2022 *reconstruction* is a new work.
    Its creative choices are protected, especially in the hypothetical parts.
- **Consequences for us:** keep video, frames, meshes, splats and renders in git-ignored folders
  (`video2world/input|frames|work|output`). Never commit them or put them in `research/img/`. Never load them into the
  explorer's `app/public/data/` and never publish them. Our deliverable model and plans are built independently from
  historic sources, LiDAR and comparables. The derived mesh serves only to check proportions and massing. Where we
  adopt one of *their* interpretations (e.g. caption-level facts or a building form only they show), cite it as
  "after HMS/Matzerath 2022".
- **Best route:** write to the Historisches Museum Saar (hms@hismus.de; Schlossplatz 15, 66119 Saarbrücken) and/or
  Dr. Jutta Schwan. Ask for permission to use the animation as a reference and, ideally, for the original model,
  plans or stills. That would replace the whole photogrammetry detour with real geometry.

---

## 6. Download requests (for the user to approve)

| What | URL | Size | Licence | Why |
|---|---|---|---|---|
| (Only if the local copy is lost) Video #1, 2160p60 VP9 | https://www.youtube.com/watch?v=kfnE6HdXmVo (fmt 315) | 316 MB | © HMS/Matzerath, YouTube ToS | massing reference |
| COLMAP 4.2.1 (Homebrew) | `brew install colmap` | several hundred MB with deps **[I]** | BSD | camera poses / sparse model for splats and the camera-matched loop |
| Brush v0.3.0 macOS arm64 | https://github.com/ArthurBrussee/brush/releases/tag/v0.3.0 (`brush-app-aarch64-apple-darwin.tar.xz`) | 41 MB | Apache-2.0 | Gaussian-splat preview on Metal |
| HMS "Steinerne Macht" still | https://www.historisches-museum.org/assets/images/p/Rekonstruktion%20Schloss%20Karlsberg-61e2z7jq198dh55.jpg | **[U]** | © HMS et al. | high-res reference view |
| Student film (fallback) | https://www.youtube.com/watch?v=Z4uGahSjIRI | **[U]** | © Saarpfalz-Kreis / makers | contains parts of #1, plus drone shots of the present-day site |
| Video2World repo / dataset | — | — | Apache-2.0 | **not recommended** (not a reconstruction tool) |

## 7. Open questions

- Will the Historisches Museum Saar / Matzerath share the model or stills, or allow reference use? (User to decide
  whether to ask.)
- Is homburg.de's "Schloss Karlsberg wird wieder lebendig – digitale 3d Rekonstruktion" the same video as #1? The page
  was unreachable.
- Do the aerial shots register together in one Object Capture run (`unordered`)? Untested.
- Exact footprint mapping between the CG site and LiDAR foundations. That depends on the LiDAR site analysis
  (research file on LiDAR) and will show how far the CG model can be trusted in plan.
