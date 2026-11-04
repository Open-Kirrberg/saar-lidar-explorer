# Performance budget, measuring, quality presets, and the before/after review

## 1. Budget

| Target | Value | Why |
|---|---|---|
| Worst realistic pose, 3024×1964 (MacBook retina at DPR 2), M5 Pro | ≤ 16.7 ms GPU now | 60 fps where the user actually looks at it. The audit measured 13–21 ms for aerial and golden-hour poses (§3), so this is **not met today** |
| Same, after pass 2 (post chain added) | ≤ 12 ms GPU for aerials | Leaves room for weaker M-series chips on the "Mittel" preset |
| 1920×1080, DPR 1 | ≤ 8 ms GPU | Same aim as the explorer (`../../.claude/skills/sle-renderer/SKILL.md`, read-only) |
| CPU per frame (`frame()` + submission) | ≤ 4 ms | 2–4.3 ms today at 800–1260 draw calls. Every extra scene render (reflector, normal pre-pass, CSM cascade) adds 1–4 ms CPU |
| Base M1/M2 GPU | about ¼–⅓ of an M5 Pro [I] | Budget presets for it. The user's lowest Mac is unknown (audit §8 Q5) |

Baseline numbers (audit §3, measured, one run, ±50 %):
- view-west at 1080p: 7.0 ms, 820 calls, 4.36 M triangles.
- Forest hidden: 4.1 ms and 1.41 M triangles.
- Shadows off: −1.95 M triangles.
- Scene: 2,938 geometries, 30 textures, 50 programs, JS heap about 381 MB.

## 2. Measuring

- **`skb.gpuBench(n = 20, size?)`** (`viewer/src/main.ts`):
  - GPU time per frame from `EXT_disjoint_timer_query_webgl2`, plus the CPU time of `frame()`, draw calls and
    triangles;
  - `size = [w, h]` renders at DPR 1 at that size, then restores it;
  - returns `null` without the extension;
  - use `[1920, 1080]` and `[3024, 1964]`.
- `skb.bench(n)` is a readPixels-synced wall time. It is vsync-capped in visible tabs, so prefer `gpuBench`.
- `skb.triangles()` gives buildings, terrain and rendered triangles. `skb.renderer.info.memory` gives geometries and
  textures, `renderer.info.programs.length` the programs.
- **Noise:** headless GPU clocks vary. Four repeats of one frame gave 4.2 / 7.1 / 5.5 / 5.3 ms (audit §2). So:
  - compare before and after **in one run** (or interleaved runs) on the same machine;
  - take the median of 3 `gpuBench(20)` calls when a decision depends on it;
  - never compare numbers across days or machines without a fresh baseline.
- `gpuBench` renders a *static* camera. Shadow caching and LOD streaming only pay off in motion. For those, also
  measure a short scripted move: N × (`camera.position.x += 2; skb.step(1)`) inside a timer query, or the GPU
  average over a `skb.tour` segment once the tour exists.
- Not measurable headless: real frame pacing, vsync judder, pointer-lock feel, thermal throttling. Say so in the
  report and ask the user to fly it.

## 3. Quality presets (P7)

Add `viewer/src/quality.ts` (pure controller logic, tested) and a German UI select "Qualität: Hoch / Mittel / Mobil":

| Preset | DPR cap | Shadows | Post | Forest | Interiors |
|---|---|---|---|---|---|
| Hoch | 1.5 on retina (2 only in photo mode) | 4096², cached | full chain | near cards + impostors | 45 m |
| Mittel | 1.25 | 2048², cached | AO half-res + SMAA, no bloom | impostors only | 30 m |
| Mobil | 1.0 | 2048², near only | SMAA only | impostors, half density | 20 m |

- **Adaptive resolution:** a moving average of the frame time. If it stays above 14 ms for about 1 s, lower the
  render scale in steps of 0.1 (floor 0.6 of the preset). Raise it again after about 3 s below 10 ms. Make it a pure
  function with tests (hysteresis, no oscillation).
- `preserveDrawingBuffer` off except in photo mode.
- Hook: `skb.quality(preset)`. The shot script can then compare presets with `--eval "skb.quality('Mittel')"`.

## 4. Fixed-pose before/after review

### 4.1 Take the shots

Acceptance shots for a backlog item come from the canonical driver in `skb-improve` (one pose namespace for the
whole backlog; poses 01–11 reproduce the audit cameras exactly):

```bash
lsof -nP -iTCP:5260 -sTCP:LISTEN || pnpm run dev       # viewer dev server (never 5240/5250: explorer)
node .claude/skills/skb-improve/scripts/shots.mjs --list
node .claude/skills/skb-improve/scripts/shots.mjs --out <scratchpad>/KB-Ixx-before --poses 01,04,08,14,15 --bench
# … implement …
node .claude/skills/skb-improve/scripts/shots.mjs --out <scratchpad>/KB-Ixx-after --poses 01,04,08,14,15 --bench
```

- It launches its own headless Chrome (`--headless=new --use-angle=metal`) over CDP on the real GPU, with no npm
  dependency and no extension (`$CHROME_BIN` or the macOS app). It always hides the panel, infobox and crosshair.
- Per pose it sets the hour, goes to the camera, steps frames so LOD2 and interiors are built, and writes
  `<pose>.jpg`. `--bench` adds `bench.json` (GPU ms at 1920×1080 **and** 3024×1964, CPU ms, calls, triangles) and
  prints a markdown table; console warnings and errors are printed at the end of stdout, so keep the log.
- `--poses 03,08` for a quick loop while iterating; run the item's full pose list once before and once after.
- `--eval '<js>'` runs once after load, for runtime A/B without code changes, e.g.
  `--eval "skb.scene.getObjectByName('forest').visible = false"` or `--eval "skb.renderer.toneMapping = 7"`
  (7 = `NeutralToneMapping`).
- New poses are appended with the next free number (16, …) in that script; never renumber or change one.

| Pose | Hour | What to judge there |
|---|---|---|
| 01-aerial-west | 10:30 | Overall composition, haze and horizon, forest share and cost, roof colours |
| 02-aerial-east | 10:30 | Garden side, landscape read (open vs forest), parterre from above |
| 03-ehrenhof-eye | 10:30 | Façade shading in shade vs sun (L2), gravel (V4), glass (B2), AO at the plinth (B1) |
| 04-garden-front | 10:30 | Hedges/lawn (V3, V5), window reveals, slate sheen |
| 05-orangerie-slope | 10:30 | Terrain facets (V6), meadow colour, sandstone basement |
| 06-festsaal-day | 10:30 | Interior light: window gradient, gilding reads gold, no sky-cyan (I1) |
| 07-festsaal-night | 22:00 | Candle warmth, bloom, chandelier body, mirrors (I2) |
| 08-golden-hour-aerial | 19:12 | Warm haze toward the sun, no navy zenith, no muddy meadows (L4) |
| 09-golden-hour-ehrenhof | 19:12 | Warm façades, long shadows, glinting glass |
| 10-dusk-exterior | 21:00 | Twilight not black, first lit windows (L5, B5) |
| 11-low-flight-forest | 10:30 | Tree look (V1), forest edge, culling cost |
| 12-karlslust | 10:30 | Valley landscape, follies, land cover read |
| 13-galerie-garden | 17:30 | Galerie and east end from above, garden-side light |
| 14-ehrenhof-hero | 17:30 | The hero shot: raking light on the west court front |
| 15-garden-hero | 07:00 | Morning garden front (pose 04's camera), morning mist if implemented |

This skill's own `scripts/shots.mjs` (`--only`, `--setup`, `--retina`, `--ui`, `report.json`) stays for ad-hoc
looks and UI shots. Its ids overlap but its 04, 05 and 11 only approximate the audit and its 12/13 are the hero
hours, so never cite its shots as backlog poses. Use one script for both sides of a comparison.

### 4.2 Review checklist (look at every image yourself)

Read each before/after pair as images. Don't judge from file sizes or numbers. For every pose:

- [ ] **No regression** anywhere in the frame (edges, far buildings, sky, UI-free corners).
- [ ] **Colour truth:** render warm-neutral in sun, cooler in shade, never grey-green or mint. Sandstone red, not
  orange. Slate blue-grey, tiles red (Dokumentation look).
- [ ] **Light:** a believable sun:sky contrast; shadows soft but defined; cavities darker (reveals, under cornices,
  wall foot).
- [ ] **Atmosphere:** distance hazed toward the sky colour; no hard green-on-white horizon; warm toward the sun at
  low elevation.
- [ ] **Materials:** gilding gold, glass reflective from afar and transparent near, water reflects the sky.
- [ ] **Vegetation:** crowns read as foliage masses, not facets; trunks not black; the forest is not the subject.
- [ ] **Night:** dark blue, warm points, nothing electric-looking, no black screen.
- [ ] **Artefacts:** shadow acne, peter-panning, light leaks at reveals, z-fighting, alpha fringes on leaf cards,
  bloom on white walls, banding in the sky (if so, the half-float buffer is missing).
- [ ] **Honesty:** hypothesis labels and attribution still present (take one UI shot with this skill's
  `scripts/shots.mjs --ui`; the canonical driver hides the UI).
- [ ] **Numbers:** GPU ms 1080p and retina, calls and triangles per pose, compared within the run; no new console
  warnings in the driver's stdout log.

### 4.3 Record

- Keep before/after sets in the git-ignored `docs/shots/KB-Ixx/` (JPEG q85); commit an image only if a doc links it.
- Remove the backlog row and add one `CHANGELOG.md` line; the commit message carries what changed, which
  backlog/audit items it closes, worst-pose GPU ms before → after (1080p and retina), and what was **not** verified.
- If a technique claim or a period claim went into docs or UI, it carries a URL/paper or an evidence tag.

## 5. Rundflug and photo mode (P13, P14): verification angle

- **Rundflug** (`viewer/src/tour.ts`):
  - keyframes as `CatmullRomCurve3(points, false, 'centripetal')` for the position, plus a second curve for the
    look-at;
  - arc-length parameterised (`getPointAt`), ease in/out on the time→u map, roll 0;
  - the hour animates with the path;
  - shots per audit §5.11: dawn approach up the Karlslust valley → low pass over the Ehrenhof gate at 17:30 → orbit
    of the CdL → slide along the Orangerie → rise over the garden at golden hour → dusk with lit windows.
  - Expose `skb.tour(id, t)` so a script can render any frame deterministically. A video is then CDP frame capture
    → ffmpeg (outside the repo; the frames stay git-ignored).
  - Check that each shot stays inside the terrain bounds and above the ground (assert in a test: the sampled path
    height minus terrain height > 2 m).
- **Photo mode** (`viewer/src/photo.ts`, key P, shown in the HUD help):
  - hide the UI and freeze the controls;
  - render at 2–3× scale with TAA accumulation (32 jittered frames);
  - optional DOF, vignette and grain;
  - `canvas.toBlob` → download with "Rekonstruktion = Hypothese", the attribution and "Schauen, nicht graben"
    burned in;
  - `preserveDrawingBuffer` only here.
  - Check that the key ignores text fields (`isTyping` in `viewer/src/controls.ts`) and doesn't clash with existing
    keys (WASD, Q/E, Space, Shift, F, G, M).
