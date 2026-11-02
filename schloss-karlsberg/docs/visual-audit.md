# Visual-quality audit of the castle viewer and "wow-effect" research (2026-11-02)

Scope: the standalone viewer (`viewer/`) and the generator's materials and vegetation (`model/src/materials`,
`model/src/site/trees.ts`, `model/src/exterior`). The aim is a reconstruction that looks cinematic, believable and right
for the period, while holding about 60 fps on an Apple M-series laptop. This is an audit plus research note.
No source code was changed.

Evidence tags as in the project: **D** documented, **D->** documented elsewhere and transferred, **I** inferred,
**N** period norm, **U** unknown/assumption, **HMS** taken from the HMS 2022 reconstruction. Technique claims carry
a URL or bibliographic reference. Claims about the code carry a file path.

Related research that this note does not repeat:
- research/02 §3.1 (PBR material list), §3.2 (vegetation, 1790 species palette), §3.3 (lighting) and §3.4 (LOD).
- research/01 §3.2 (decoration) and §4.2 (written sources, including the 1785 illuminations).
- review-1 issues 5, 9, 13, 16 and 17 (roof sheen, meadow colour, mirrors, façade tint, trees).

---

## 1. Summary

- **The geometry is good; the lighting and atmosphere are what read as "a 2010 game".** Façades, roofs, dormers, the parterre and the interiors hold up at eye level (`03`, `04`, `06`).
- **What makes it look synthetic:**
  1. There is almost no image-based light. `scene.environmentIntensity` is 0.02–0.07, so metals, gilding, glass and water have nothing to reflect.
  2. There is no ambient occlusion and no contact darkening.
  3. Distance haze does not match the sky.
  4. Golden hour and dusk are broken: the sky turns navy at 6° sun, and civil twilight is black (`08`–`10`).
  5. The trees are low-poly blobs with near-black trunks, and the forest dominates the frame (`01`, `11`).
  6. There is no post-processing: no bloom on candles, no AA beyond MSAA, no grading.
- **Cost today** (GPU timer, M5 Pro, headless Chrome on Metal):
  - 1920×1080: 2.7–8.4 ms. Interior and eye-level views run ~3 ms; aerial views 4–13 ms, because the measurements are noisy (§3).
  - 3024×1964 (retina at DPR 2, which is what `setPixelRatio(min(dpr, 2))` gives on a MacBook): 5–21 ms. Aerial and golden-hour views are already **over the 16.7 ms budget**.
- **The forest is the single biggest cost.** It has 28,381 trees in 4 `InstancedMesh`es, each with a ~2.15 km bounding sphere, so it is never frustum-culled. It is drawn in both the main pass and the shadow pass. Hiding it takes view-west from ~13 to ~4 ms and from 4.36 M to 1.41 M triangles.
- **Recommended path:** stay on `WebGLRenderer` and add an HDR post chain. First fix the light budget (calibrated sky IBL, sun/sky ratio, twilight) and cut the forest/shadow cost. With that headroom, add AO + SMAA + bloom + grade, aerial perspective, better trees, glass and night windows, and a "Rundflug" and photo mode. **§6** has the prioritised list; P1–P6 alone change the look the most for the least cost.

## 2. Method

- **Browser setup.** The Chrome extension was not connected (2 tries). Screenshots were taken instead with headless Chrome 
  (`--headless=new --use-angle=metal`) over CDP, on the real GPU: `ANGLE Metal Renderer: Apple M5 Pro`.
  - The viewer's own dev server was already running on :5260. It was started on 1 Nov 18:15, not by this audit, and was used read-only and left running.
  - The tab was driven with `window.skb.goto/set/step`, and the UI panel was hidden for the shots.
  - The driver script lived in the session scratchpad. Nothing was added to the repo except the images and this file.
- **Timing.** Frame cost comes from `skb.gpuBench(20, [w, h])` (`EXT_disjoint_timer_query_webgl2`, DPR 1 at the given size).
  - **Noise:** four repeats of the same view-west frame gave 4.2 / 7.1 / 5.5 / 5.3 ms, and another run gave 4.0–13.1 ms. GPU clocks in a headless, unfocused process vary. Treat single numbers as ±50 % and compare only within one run.
- **A/B test.** One runtime-only experiment turned up IBL, switched to AgX/Neutral and set `shadow.radius` 4. This is §5.2: it shows why a naive "turn the environment up" fails.
- **Not verified:** real windowed frame pacing, pointer-lock feel, and older or smaller M-series chips. An M1/M2 base GPU has roughly a third to a quarter of an M5 Pro's throughput [I], so budget for that.

Screenshots (all 1920×1080, `docs/visual-audit/`):

| File | View | Hour (15 Jul 1789) | Sun elevation |
|---|---|---|---|
| `01-aerial-west.jpg` | view-west | 10:30 | 56.5° |
| `02-aerial-east.jpg` | view-east | 10:30 | 56.5° |
| `03-ehrenhof-eye.jpg` | view-ehrenhof (walk) | 10:30 | 56.5° |
| `04-garden-front.jpg` | eye level in the TF-09 parterre, 95 m E of the CdL | 10:30 | 56.5° |
| `05-orangerie-slope.jpg` | 120 m W of B10, 25 m above ground | 10:30 | 56.5° |
| `06-festsaal-day.jpg` / `07-festsaal-night.jpg` | room POI Festsaal | 10:30 / 22:00 | 56.5° / −13.7° |
| `08-golden-hour-aerial.jpg` / `09-golden-hour-ehrenhof.jpg` | view-west / view-ehrenhof | 19:12 | 6.1° |
| `10-dusk-exterior.jpg` | view-ehrenhof | 21:00 | −7.9° |
| `11-low-flight-forest.jpg` | low flight over the W forest | 10:30 | 56.5° |
| `ab-ehrenhof-neutral-env.jpg`, `ab-festsaal-neutral-env.jpg` | failed naive experiment (§5.2) | 10:30 | 56.5° |

Sun table for 15 Jul 1789, from `viewer/src/sun.ts` (local mean time, azimuth from true north):
- 05:30: 10.7° / 69°
- 07:00: 25° / 85°
- 17:00: 26.8° / 273°
- 17:30: 22° / 278°
- 18:30: 12.5° / 289°
- 19:00: 7.9° / 294°
- 20:00: −0.6° / 305° (sunset)
- 20:30: −4.4°
- 21:00: −7.9° (civil twilight ends at −6°: [Twilight](https://en.wikipedia.org/wiki/Twilight))
- 22:00: −13.7°

## 3. Measured cost

GPU ms from `gpuBench(20)`, with the same run for both columns. Draw calls and triangles are at 1080p, shadows on.

| View | 1920×1080 GPU | 3024×1964 GPU | CPU ms | Calls | Triangles |
|---|---|---|---|---|---|
| 01 aerial west | 7.0 | 13.3 | 2.1 | 820 | 4.36 M |
| 02 aerial east | 5.9 | 14.7 | 2.0 | 764 | 4.25 M |
| 03 Ehrenhof eye | 3.1 | 12.0 | 3.7 | 1218 | 4.56 M |
| 04 garden front | 2.7 | 14.3 | 3.1 | 801 | 4.41 M |
| 05 Orangerie slope | 2.7 | 12.8 | 2.2 | 409 | 4.15 M |
| 06 Festsaal day | 3.1 | 5.2 | 4.3 | 1104 | 4.54 M |
| 07 Festsaal night | 3.2 | 8.3 | 4.3 | 1182 | 4.65 M |
| 08 golden hour aerial | 8.4 | **21.1** | 2.9 | 888 | 4.37 M |
| 09 golden hour Ehrenhof | 3.7 | **17.1** | 3.9 | 1228 | 4.53 M |
| 10 dusk | 3.4 | 15.8 | 3.9 | 1263 | 4.63 M |
| 11 low flight | 2.8 | 9.0 | 2.6 | 599 | 4.06 M |

Breakdown (one run, 1080p):

| View | All on | Shadows off | Forest hidden |
|---|---|---|---|
| view-west | 13.1 ms / 820 calls / 4.36 M tris | 10.8 ms / 512 / 2.41 M | **4.1 ms** / 812 / **1.41 M** |
| view-ehrenhof | 3.3 ms / 1218 / 4.56 M | 4.5 ms (noise) / 1084 / 2.56 M | 2.9 ms / 1210 / 1.61 M |

- **The shadow pass re-draws about 1.95 M triangles,** mostly forest. The forest itself is ~1.48 M triangles per pass:
  - 28,381 trunks × 12 triangles
  - 28,381 crowns × 40 triangles (2 lobes of a detail-0 icosahedron)
- **No culling.** Each forest `InstancedMesh` has a bounding sphere of r ≈ 2.15 km (measured), so three.js can never cull it, in either pass.
- **Scene totals:** 2,938 geometries, 30 textures, 50 programs, JS heap ~381 MB.
- **CPU** is 2–4.3 ms per frame (`frame()` plus command submission). That is fine, but any technique that re-renders the scene adds 1–4 ms of CPU at these 800–1260 draw calls. Examples are a normal pre-pass, a planar reflection, or 3 CSM cascades.
- **Console warning in r187:** `THREE.WebGLShadowMap: PCFSoftShadowMap has been removed. Using PCFShadowMap instead.` The `PCFSoftShadowMap` in `viewer/src/main.ts:37` is a no-op. In r187 PCF is a 5-tap Vogel-disk filter whose softness comes from `light.shadow.radius`, which is left at its default of 1. See `node_modules/three/src/renderers/shaders/ShaderChunk/shadowmap_pars_fragment.glsl.js` and `src/renderers/webgl/WebGLShadowMap.js:99`.
- **`preserveDrawingBuffer: true`** (`main.ts:32`) forces the tile memory to be stored every frame on Apple's tile-based GPUs, which costs bandwidth [I]. Screenshots don't need it: CDP `Page.captureScreenshot` worked here, and `canvas.toBlob` called right after `render()` also works. Enable it only in a capture or photo mode.

**Budget conclusion.** At 1080p there is 8–13 ms of headroom. At full retina the aerial and golden-hour views already miss
60 fps. So the order matters: **reclaim cost first** (forest culling and LOD, shadow caching, render scale), then spend it on
post-processing.

## 4. Current state: what looks weak

### 4.1 Light, sky and atmosphere (biggest gap)

| # | Observation | Shot | Cause in code |
|---|---|---|---|
| L1 | **Almost no image-based light.** Gilding reads olive and brassy, not gold. Glass reads as holes with a white frame. Water and slate never pick up the sky. Shadowed façades look flat grey-green rather than lit by the sky. | `03`, `06`, `04` | `scene.environmentIntensity = 0.02 + 0.05·day` (`main.ts updateSun`). The PMREM comes from an *unscaled* Preetham sky, but the visible sky is scaled ×0.3 by a shader string patch. Fill comes from a `HemisphereLight` (0.2–1.1), which has no directionality and no reflections. |
| L2 | **Façades read cool grey-green in shade** (render `#ECE8DF`). The warm/cool contrast between sunlit and shaded faces is missing. | `03`, `04` | The fill is a flat hemisphere tint plus a desaturated sky env at ~0. Review-1 #16 is only partly fixed. |
| L3 | **The sky is a saturated mid-blue to the horizon with no haze.** The aerial shows a hard green-on-white horizon with no depth layering. | `01`, `02`, `11` | `FogExp2('#c9d6e0', 0.00016)` reaches ~15 % at 1 km. Its colour is set by HSL (hue 0.58) and does not follow the sky. There is no height fog. |
| L4 | **Golden hour is muddy.** At 6° sun the zenith is navy, the horizon band brownish, and the meadows dark olive. The scene reads like night while the façades are lit orange. | `08`, `09` | The ×0.3 sky factor plus exposure `0.45 + 0.3·day` crush a low-sun Preetham sky. The fog colour is cool blue-grey at every hour (`setHSL(0.58, 0.25, …)`). The sun colour comes from an HSL ramp, not a spectral or blackbody curve. |
| L5 | **Dusk and night outside are black** (21:00, sun −7.9°, still civil-to-nautical twilight). There are no lit windows and no exterior light sources. | `10` | `sun.intensity = 0` below −2°, hemi 0.2, env 0.02, exposure 0.45. Interiors only exist within 45 m, and only the nearest has lights (`updateInteriorBudget`). |
| L6 | **Shadows have hard edges with a fixed penumbra,** with no sky occlusion in corners, under cornices or in reveals. Buildings don't sit on the ground. | `03`, `05` | PCF radius 1 (§3). No SSAO and no baked AO: `aoMap` is explicitly null in `materials/index.ts`. |
| L7 | **The default time of 10:30 (56° sun) is flat lighting.** The Ehrenhof court front faces about west (palace axis 80.5° grid, research/03 §5). Raking light on it needs the afternoon: 17:00–18:30, sun 27°–12° from 273°–289°. The garden front wants morning, ~07:00 at 25° from 85°. | `01`, `03` | `state.hour = 10.5` (`main.ts`). research/02 §3.3 already recommends late afternoon. |

### 4.2 Vegetation and ground

| # | Observation | Shot | Cause |
|---|---|---|---|
| V1 | **The trees are faceted low-poly blobs:** flat colour, no leaf texture, no translucency, no self-shadowing inside the crown. The near trunks are black sticks. In aerial views the forest takes ~50 % of the frame and sets the look of the whole image. | `01`, `11`, `05` | `crownGeometry` (2–5 icosahedra, detail 0/1). `MeshStandardMaterial` roughness 0.92, with no map. Bark `#4B4238` (forest) gets almost no fill (L1). |
| V2 | **The forest is a uniform carpet:** one species, one height distribution, no forest edge (Waldmantel), no clearings, no beech/oak/pine mix. | `01`, `02` | `buildForest` puts a jittered 12 m grid on ground class 6 with `SPECIES.forest` only. The 1790 species palette is in research/02 §3.2. |
| V3 | **The lawns and meadows look like a uniformly saturated golf course** from the air, and smeared at eye level (one 2 m texture). There are no mown/unmown edges, no slope or aspect variation, and no distance desaturation. | `01`, `04`, `05` | Terrain splat (`terrain.ts`): `lawn = grass·(0.50, 1.06, 0.40)`, plus the meadow multiplier and two noise octaves. |
| V4 | **The Ehrenhof gravel is a uniform light plane.** It has no carriage tracks, no edge darkening along the plinths, and no scale cue. At the golden hour it turns grey-brown. | `03`, `09` | Gravel `#ABA393` × splat. No AO, no wear mask. |
| V5 | **The parterre hedges are clean extruded boxes,** with a sharp top edge and no leaf breakup. The lawn compartments have no edging (a gravel band or Plate-bande flowers, N). | `04` | `features.ts` `hedgeSeg` uses `orientedBox` with the grass material tinted `#3E5A2A`. |
| V6 | **The DTM facets and hummocks read as lumpy turf** on the Orangerie slope and its W foot. | `05` | 1 m DTM normals, coarse LOD steps beyond 180 m. The 1789 terrain hypothesis keeps today's micro-relief outside the aprons (review-1 #7). |

### 4.3 Buildings

| # | Observation | Shot | Cause |
|---|---|---|---|
| B1 | **The render is clean and uniform on every wing:** no tonal variation between wings or storeys, and no darkening under cornices, sills or at the plinth. It reads as "CG white". The buildings were ≤ 15 years old in 1789 (research/02 §3.3), so the wear must stay subtle, but some AO and splash-back is expected (N). | `03`, `04` | Luminance-modulated plaster map only (`lumaPatch`). No AO, no grime mask. |
| B2 | **The windows read as white frames around transparent holes.** From outside, period crown glass should mostly mirror the sky with Fresnel and show the dark room behind. Interiors are generated only near the camera, so far windows look empty (into grey reveals). | `03`, `04`, `05` | `glass.crown` is `transparent, opacity 0.38`, clearcoat 1, with env ~0 (L1). |
| B3 | **The slate roofs are now correctly matt and dark** (review-1 #5), but they are a single flat tone. There is no per-tile variation, no ridge or hip lead, and no sky sheen at grazing angles. | `03`, `08` | Slate with no ARM map, `envMapIntensity 0.45` × environmentIntensity ~0.05. |
| B4 | **The red sandstone plinth is saturated and uniform** (`#A65E4A`), with no tooling or joint contrast at distance. | `03`, `05` | Material only. Normal 1.0 is fine near and invisible far. |
| B5 | **Nothing glows at night:** no lit windows, no lanterns at the portals, no torches. | `10` | Not modelled. See §5.10 for what is period-correct. |

### 4.4 Interiors

| # | Observation | Shot | Cause |
|---|---|---|---|
| I1 | **The daylight Festsaal is evenly lit and flat:** no window light falling into the room, no light gradient from the window wall, no corner AO. The gilt reads olive. | `06` | Interiors are lit by the hemisphere light plus env ~0. Interior meshes never cast shadows (`updateInteriorBudget`). There is no room-scale ambient. |
| I2 | **The night Festsaal is warm, but the candles don't glow.** No bloom, no flicker. The chandelier body is black. The mirrors don't show the candles. | `07` | No post-processing. Emissive candles (`interior.candle` emissiveIntensity 2.2) without bloom read as white dots. There are ≤ 4 point lights per building. |
| I3 | **The parquet specular hotspot is good** (`07`). Keep it. | `06`, `07` | |

## 5. Techniques for three r187 (research)

The project pins `three` **0.187.0** (published 2026-10-30) and `@types/three` 0.187.0 (`package.json`).

### 5.1 Post-processing stack: options in r187

| Option | What it is | Fit for this viewer |
|---|---|---|
| **A. Built-in `WebGLRenderer.setEffects()`** (new in the r18x line) | `new WebGLRenderer({ outputBufferType: HalfFloatType, antialias: true })`, then `renderer.setEffects([pass, …])`. The scene renders into a 4× MSAA half-float target. Effects ping-pong between two single-sample targets. **Tone mapping and sRGB conversion are applied automatically at the end** (no `OutputPass`). A depth texture is resolved when an effect sets `needsDepthTexture`. Source: `node_modules/three/src/renderers/WebGLRenderer.js:749` and `src/renderers/webgl/WebGLOutput.js` (r187 also fixed `setEffects()` to honour `needsDepthTexture`, PR #34858, [r187 notes](https://newreleases.io/project/github/mrdoob/three.js/release/r187)) | **Lowest friction.** Accepts the classic `examples/jsm/postprocessing` passes (`UnrealBloomPass`, `SMAAPass`, `ShaderPass`, `GTAOPass`). Caveat: the LUT/grade must run *after* tone mapping. Either do the tone mapping in your own last `ShaderPass` (renderer `NoToneMapping`), or grade in linear before it. |
| **B. pmndrs `postprocessing` 6.39.6** | An `EffectComposer` that **merges many effects into one fullscreen pass**: Bloom (mipmap blur), SMAA, ToneMapping (AgX/Neutral), LUT3D, Vignette, DepthOfField. Peer range is **`three >= 0.168.0 < 0.188.0`** (npm, checked 2026-11-02), so it works with 0.187 but **blocks a later three upgrade until postprocessing is bumped**. [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing), [docs](https://pmndrs.github.io/postprocessing/public/docs/) | **Best quality per ms.** It is the host for N8AO (`N8AOPostPass`). Its docs recommend `frameBufferType: HalfFloatType`, renderer tone mapping off and `ToneMappingEffect` last. Pin it exactly (CLAUDE.md). |
| **C. WebGPURenderer + TSL** (`three/tsl`, `examples/jsm/tsl/display/*`) | It has the richest r187 set: `GTAONode`, `TRAANode` (temporal AA), `SSRNode`, `SSGINode`, `BloomNode`, `Lut3DNode`, `DepthOfFieldNode`, `GodraysNode`, plus `CSMShadowNode` and `TileShadowNode` (listed in `node_modules/three/examples/jsm/tsl/display/`). | **Not now.** `lumaPatch` (`materials/index.ts`) and the terrain splat (`terrain.ts`) are `onBeforeCompile` patches. NodeMaterials don't run them, so both would have to be ported to TSL. The explorer app's renderer would then differ from the viewer's. It is a good *later* target once the look is settled. |

**Recommendation:** use B (pmndrs 6.39.6 + N8AO 2.0.1) if the extra dependency is acceptable, otherwise A. Both keep
`WebGLRenderer`, three-mesh-bvh and the material patches. Set `antialias: false` on the renderer with B, and use SMAA
or MSAA on the composer target. Budget for a typical chain is in the next table.

| Effect | Approach | Cost estimate at 1080p on M5 Pro [I, to measure] | Reference |
|---|---|---|---|
| **AO** | N8AO, `halfRes: true`, quality "Medium". `aoRadius` ~1.5–3 m outdoors, ~0.5 m in interiors. It rebuilds normals from depth, so there is **no extra scene pass** (`GTAOPass` renders a normal pass, which doubles the draw calls). | 0.8–1.5 ms. The README says half-res gives "2x–4x" and the depth-aware upsample costs "around 1ms" | [N8AO](https://github.com/N8python/n8ao); GTAO: Jimenez et al., "Practical Real-Time Strategies for Accurate Indirect Occlusion", SIGGRAPH 2016 course |
| **AA** | SMAA (N8AO disables hardware MSAA); MSAA 4× in option A | 0.3–0.6 ms | Jimenez et al., "SMAA: Enhanced Subpixel Morphological Antialiasing", Eurographics 2012, [iryoku.com/smaa](https://www.iryoku.com/smaa/) |
| **Bloom** | Mipmap bloom with a luminance threshold above 1.0 (HDR), so only candles, sun glints and the sky near the sun bloom | 0.4–0.8 ms | pmndrs `BloomEffect`; [three `UnrealBloomPass` example](https://threejs.org/examples/#webgl_postprocessing_unreal_bloom) |
| **Tone mapping** | AgX or Khronos PBR Neutral at the end of the chain | ~0 | §5.3 |
| **Grade** | 3D LUT (32³ `.cube`) plus a light vignette | ~0.1 ms | [three 3D-LUT example](https://threejs.org/examples/#webgl_postprocessing_3dlut); pmndrs `LUT3DEffect` |
| **TAA** | Not in WebGL for a moving camera: `TAARenderPass` only accumulates while the camera is still. Use it only in **photo mode** (accumulate 32 jittered frames → supersampled still). | photo mode only | Karis, "High Quality Temporal Supersampling", SIGGRAPH 2014 Advances course; [three TAA example](https://threejs.org/examples/#webgl_postprocessing_taa) |

### 5.2 Light budget: sun, sky IBL and exposure

**Experiment (§2, `ab-*`).** Raising `environmentIntensity` to 0.6 with AgX or Neutral **blew out and turned everything cyan**. The
Ehrenhof gravel went white, and the Festsaal walls turned mint and the gilding lemon-yellow. This happens for two reasons:
- The PMREM is built from the *unscaled* Preetham sky, so it is several times brighter than the ×0.3 visible sky.
- Interiors receive the *outdoor* sky IBL with no occlusion.

So the fix is a **consistent radiometric model**, not a slider:
1. **One sky radiance for both the background and the IBL.** Drop the shader-string ×0.3 hack (`main.ts`). Scale the sky by a uniform, or render it with a dedicated `skyScale` used by both `sky` and `envSky`, and choose the sun intensity to match.
   - Physical anchor: direct sun ~32–100 klx versus full daylight without direct sun ~10–25 klx ([Lux, illuminance examples](https://en.wikipedia.org/wiki/Lux)). That gives a **sun:sky illuminance ratio of roughly 3:1 to 8:1 at high sun**. It falls toward 1:1 and below at low sun, and the sky dominates in twilight. Tune the sun intensity so that a white card facing the sun is 3–6× brighter than one facing away (in shade, sky only).
2. **Remove the HemisphereLight** outside, or keep it at ≤ 0.1 as a ground bounce. Let the PMREM sky carry the fill, with `environmentIntensity` ≈ 1 once the IBL is calibrated. Re-bake the PMREM only when `hour` changes (this already happens).
3. **Interiors get their own environment.** For every material under `/interior`, either set `envMap` to the warm `roomEnvironment()` already used for mirrors (`interior/materials.ts`), or switch `scene.environment` when the camera is inside a building footprint. Interior IBL should be dim and warm. Daylight comes in through the windows (§5.9).
4. **Exposure as an EV curve over sun elevation,** not `0.45 + 0.3·day`. Example: EV100 ≈ 15 at high sun, ≈ 12 at golden hour, ≈ 8 at civil dusk, ≈ 3 in candle-lit rooms. Ease towards the target over 1–2 s to mimic eye adaptation [I]. An interior/exterior switch can drive it.
5. **Sun colour from a blackbody/airmass curve:** ~5800 K at high sun → ~3500 K at 5° → ~2500 K at the horizon [I, approximation]. Colours from a blackbody table ([vendian.org blackbody colour table](http://www.vendian.org/mncharity/dir3/blackbody/)). Better still, take the sun transmittance from the same sky model (§5.4).
6. **Twilight.** Below 0° the sun light goes to 0, but the sky IBL must persist through civil twilight (to −6°) and nautical twilight (to −12°) ([Twilight](https://en.wikipedia.org/wiki/Twilight)), with a blue-violet tint. Add a moonlight or night "floor" so the scene never goes black.
   - Common practice is a low-intensity, cool-tinted fill plus desaturation (day-for-night) [I].
   - The moon phase of 15 Jul 1789 could be computed later [U].

### 5.3 Tone mapping

- three r187 offers ACES Filmic, AgX and Neutral, all in `WebGLOutput` and in the material tone-mapping chunk.
- r187 also **fixed the ACES fit denominator** (PR #35110, [r187 notes](https://newreleases.io/project/github/mrdoob/three.js/release/r187)). The current ACES look may have shifted slightly against the review-1 screenshots.
- **ACES** shifts hues and saturates: it pushes bright yellows to white and saturated reds toward orange. **AgX** is less saturated "by design" and handles very bright sources more gracefully. **Khronos PBR Neutral** keeps base colours 1:1 up to a threshold and compresses only the highlights ([three.js forum: Tone Mapping Overview](https://discourse.threejs.org/t/tone-mapping-overview/75204); [Khronos PBR Neutral](https://github.com/KhronosGroup/ToneMapping)).
- **For a reconstruction whose albedos come from documented or period colours** (catalogue `#ECE8DF`, `#A65E4A`, `#4B5057`), use **Neutral** for the "documentation" look. The catalogue colour then survives as authored. Use **AgX + a grade LUT** for the "cinematic" look (photo mode, Rundflug).
- Put both behind a quality/look toggle. Switching costs nothing.

### 5.4 Sky, aerial perspective and fog

| Level | Approach | Cost | Notes |
|---|---|---|---|
| 1 (cheap, now) | Keep three's `Sky` (Preetham; in r187 it has built-in procedural clouds: `cloudCoverage`, `cloudDensity`, `cloudElevation`, see `examples/jsm/objects/Sky.js`).<br>1. **Derive the fog colour from the sky**: average the env cube's horizon ring or evaluate the Preetham formula toward the view azimuth on the CPU once per hour change.<br>2. Replace `FogExp2` with **exponential height fog** in `fog_fragment` (`onBeforeCompile` or a `ShaderChunk` override). Density `a·exp(−b·h)` integrated along the ray ([Quilez, "Better fog"](https://iquilezles.org/articles/fog/)), with sun in-scatter `pow(max(dot(viewDir, sunDir), 0), 8)` warming the haze toward the sun. | ~0 (per-fragment ALU) | Fixes L3/L4. Gives the "blue hills" depth layering in aerial views and morning mist over the Weiher and the Karlslust valley, which research/02 §3.3 suggests. |
| 2 (better) | **Physically based sky + aerial perspective:** `@takram/three-atmosphere` 0.19.1, an implementation of Bruneton's precomputed scattering ([three-geospatial](https://github.com/takram-design-engineering/three-geospatial)).<br>- React is an *optional* peer; `postprocessing ≥ 6.36.7` is required.<br>- It provides `SkyMaterial`, `AerialPerspectiveEffect` and sun/sky light.<br>- The reference frame is **ECEF**, so world positions must map to the Earth frame (local ENU → ECEF matrix at 49.336 N, 7.36 E) ([README v0.13.2](https://unpkg.com/@takram/three-atmosphere@0.13.2/README.md)). | ~1–2 ms [I] | Gives physically consistent sun colour, sky IBL and haze at every hour, including twilight. It is pre-1.0, so pin it exactly and expect API churn. Underlying papers: Bruneton & Neyret, "Precomputed Atmospheric Scattering", CGF 27(4), 2008; Hillaire, "A Scalable and Production Ready Sky and Atmosphere Rendering Technique", CGF 39(4), EGSR 2020. Preetham: Preetham, Shirley & Smits, "A Practical Analytic Model for Daylight", SIGGRAPH 1999. |

**Recommendation:** do level 1 now. It fixes most of what looks wrong. Prototype level 2 for photo mode and the Rundflug, behind a flag.

### 5.5 Shadows

- **Caching (biggest cheap win).** Every caster is static and the sun only moves when the slider moves.
  - Set `renderer.shadowMap.autoUpdate = false`, and set `needsUpdate = true` only when (a) the hour changes or (b) the fitted frustum centre has moved by more than ~10 % of `ext`. For (b), snap the centre to a coarse grid of `ext/8` instead of the texel grid.
  - Flying then re-renders the shadow map only every few hundred metres, which saves the ~1.95 M-triangle shadow pass on most frames.
  - r187 changed shadow updates to "render with `needsUpdate` only once" and "update at least once" (PRs #34794, #35093, [r187 notes](https://newreleases.io/project/github/mrdoob/three.js/release/r187)), which fits this pattern.
- **Softness.** Set `sun.shadow.radius` ≈ 2–4 at 4096² and remove the dead `PCFSoftShadowMap`. Real contact-hardening (PCSS, Fernando, "Percentage-Closer Soft Shadows", SIGGRAPH 2005 sketch / [NVIDIA whitepaper](https://developer.download.nvidia.com/shaderlibrary/docs/shadow_PCSS.pdf)) is a shader patch with a blocker search. It is worth it only in walk mode, where the sun's 0.53° angular size gives ~9 cm of penumbra per 10 m of occluder distance [I, geometry].
- **Range.** The current single fitted frustum (120–700 m) is a decent compromise. **CSM** (`three/addons/csm/CSM.js`, WebGLRenderer only, `csm.setupMaterial()` on every material, [docs](https://threejs.org/docs/pages/CSM.html), [example](https://threejs.org/examples/#webgl_shadowmap_csm)) would give crisp near shadows *and* far palace shadows in aerial views. But 3 cascades means 3 shadow renders, and CSM's shader also clashes with the `onBeforeCompile` patches. **Prefer 2 levels:**
  1. a dynamic near map (walk 60 m, fly ≤ 300 m)
  2. a **static far map** of the whole residence (2 km, 4096²), rendered once per hour change and sampled beyond the near map (custom shadow chunk)
- **Forest shadow casting.** Far trees shouldn't cast into the map. `@three.ez/instanced-mesh` has `addShadowLOD`, or use a culled sub-mesh (§5.6).

### 5.6 Vegetation

What is wrong (V1/V2) is shape, shading and culling, more than triangle count.

1. **Culling and LOD first (performance).**
   - Tile the forest into ~256–512 m cells, each with its own `InstancedMesh` and a proper bounding sphere. Alternatively use **`@three.ez/instanced-mesh` 0.3.16** (`InstancedMesh2`: per-instance frustum culling with a BVH, `addLOD`, `addShadowLOD`, radix sort; peer `three >= 0.159`; [repo](https://github.com/three-ez/instanced-mesh)).
   - Beyond ~400 m, use **octahedral impostors**: one quad per tree, sampling a pre-rendered atlas of 8×8 views, with depth and normals for relighting. Reference: Brucks, ["Octahedral Impostors"](https://shaderbits.com/blog/octahedral-impostors) (2018). A three.js forest demo of 200k trees uses InstancedMesh2 + BVH + octahedral impostors beyond 100 units ([forum post](https://discourse.threejs.org/t/a-forest-of-octahedral-impostors/85735), code `agargaro/octahedral-impostor`). Watch the overdraw (same thread).
   - Billboard orientation belongs in the vertex shader, not per-instance CPU lookAt ([cinevva write-up](https://app.cinevva.com/blog/2026-05-04-open-world-browser-part-19-imposters)).
2. **Near and mid trees.** Use **leaf-card crowns:** alpha-tested quads with a CC0 leaf atlas (beech/oak/lime) around the existing lobed volume.
   - Normals should point outward from the crown centre ("spherical normals"), so the crown shades as one soft mass.
   - Generate the trees once, offline or at load, with **EZ-Tree** (`@dgreenheck/ez-tree` 1.1.0, MIT, `createGeometry(detail)` gives the branch and leaf geometry for instancing; built-in LODs at about 40 % and 20 % triangles; [repo](https://github.com/dgreenheck/ez-tree)). Then instance 6–10 variants per species. Keep it deterministic: seed from `mulberry32` as the project rules require.
3. **Shading** (cheap, any LOD, `trees.ts` `leafMaterial()` patch):
   - per-instance hue jitter (exists)
   - **crown AO**: darken toward the inside and bottom using the local position / lobe radius (vertex attribute)
   - **wrap/translucent diffuse** `max(0, (N·L + w)/(1 + w))`, plus a back-light term `pow(saturate(dot(V, −L)), 4)·thickness` for the golden-hour glow
   - lighter, warmer bark (beech bark is light grey, ~`#8A8580` [I])
4. **Wind:** vertex sway with the main bend by height, plus leaf flutter by a vertex-colour phase (Sousa, "Vegetation Procedural Animation and Shading in Crysis", *GPU Gems 3*, ch. 16, 2007, [NVIDIA](https://developer.nvidia.com/gpugems/gpugems3/part-iii-rendering/chapter-16-vegetation-procedural-animation-and-shading-crysis)). Use a gentle amplitude; it costs nothing on the GPU.
5. **Composition (period, research/02 §3.2).**
   - beech dominant on the Buchenberg (D, hill name), with oak
   - *Pinus sylvestris* on the sandy ground near the Karlsbergweiher (N)
   - a **forest edge band** of lower trees and shrubs (Waldmantel, I)
   - avenues of young limes, 5–15 years old in 1789 (I), which the catalogue ages already handle
   - the forest boundary from ground class 6 is today's canopy, U for 1789 (`forest.ts` header). Don't over-detail it.
6. **Hedges and parterre (V5).**
   - Keep the boxes, but give them a leaf-noise normal map and a darker bottom.
   - Bevel the top edges slightly (0.05 m) so a light edge catches the sun.
   - Add a 0.3–0.5 m gravel edging band between the hedge and the lawn [N, research/02 §2.14].
7. **Lawns (V3).**
   - Use a second, macro grass texture at 20–40 m with low-frequency colour noise (the code has `vnoise`).
   - Distinguish scythed lawn (lighter, fine) from meadow (warmer, yellower, coarser): July hay meadows are partly cut [I].
   - Darken slopes facing away from the sun slightly through AO and the terrain normal. Let aerial perspective desaturate the distance.
   - Grass blades are only worth it in walk mode within ~30 m, as instanced blade tufts. Defer this.

### 5.7 Ground, gravel, water

- **Gravel (V4).**
  - In the splat, add a **wear mask**: lighter, compacted ruts along the gate → Freitreppe line, and a darker, looser band 1–2 m along the plinths. Both are analytic from `spec` (court polygon, portal positions) [I].
  - Add a detail normal map at 0.5 m.
  - AO from N8AO darkens the plinth foot.
- **Water** (ponds, Weiher, Kaskade, `features.ts` `waterPlane`):
  - Today it is a `MeshPhysicalMaterial` with clearcoat. With working IBL (§5.2) it already reflects the sky.
  - For the hero ponds near the camera, three's `Water` (`examples/jsm/objects/Water.js`, a reflector with animated normals, [example](https://threejs.org/examples/#webgl_shaders_ocean)) or `Water2` ([example](https://threejs.org/examples/#webgl_water)) gives true reflections of the palace.
  - **Cost: one extra scene render per reflector.** Mitigate by rendering it at ¼ resolution, with a layer mask (sky + buildings LOD0 + no forest), and only when the reflector is within ~300 m and in view.
  - Otherwise, use a static cube capture per pond at load or hour change (one `CubeCamera` render, `PMREMGenerator.fromCubemap`). That is free per frame and fine for still water.
- **Terrain facets (V6):** compute normals from the *full-resolution* DTM for every LOD (a normal texture of 1 m cells, sampled in the shader), not from the decimated mesh. This removes the lumpy facets at 2/4/8 m steps at no per-frame cost.

### 5.8 Façades: AO, decals, weathering

- **Contact and cavity AO without screen-space cost** (B1, L6). The generator already knows where the cavities are.
  - In `GeoBuilder` (`exterior/builder.ts`), add a per-vertex `ao` attribute: 1.0 on open wall, 0.55–0.7 on reveal jambs and soffits, 0.7 on the underside of cornices and sills, 0.8 at the wall foot.
  - Large quads need one extra vertex row near the ground and under cornices for the gradient.
  - Multiply it into the indirect light only, through an `aomap_fragment` patch (`ambientOcclusion = vAo`).
  - This is stable, costs nothing, and exports to glb. The light layer already uses vertex colours plus `_CONF` (README changelog), so use a custom `_AO` attribute or fold it into `COLOR_0` at export time. Contract: `docs/architecture.md` §3.6.
- **SSAO (N8AO) on top** catches what the generator doesn't know: furniture, trees on façades, building-to-terrain contact.
- **Weathering**, kept subtle (research/02 §3.3: at most 15 years old):
  - a world-space grime gradient 0.3–0.5 m above the terrain (splash-back)
  - a faint vertical streak mask below sills and cornice ends (procedural noise stretched in v)
  - ±2 % low-frequency albedo variation per wing (seeded by building id)
  - moss only on the north slopes of the farm roofs
  - all inside `lumaPatch` or a sibling patch, with no decal geometry
- **Slate (B3):** per-tile albedo jitter (±6 %) from a hashed tile id in UV space (tile rows from the 3 m texture repeat), plus lead flashing on ridges and hips as thin geometry (`roof.ts`, material `roof.lead` exists).

### 5.9 Glass, interiors, night

- **Window glass from outside (B2).**
  - Make `glass.crown` mostly opaque, dark and reflective: `transparent: false` beyond ~40 m. Use a near-black base, Fresnel reflection of the calibrated sky IBL, and slight per-pane normal waviness for crown glass (research/02 §3.1 already lists it, N).
  - Within the interior radius, keep the current transparent glass so the generated rooms show.
  - For buildings or LODs without interiors, use **interior mapping**: a fake room box ray-cast in the fragment shader from the window UV (van Dongen, "Interior Mapping: A new technique for rendering realistic buildings", Computer Graphics International 2008). It gives depth and parallax at zero geometry cost, with room tint per building class.
- **Daylight interiors (I1):**
  - Let the sun cast through windows. The exterior walls already cast, and the glass doesn't.
  - In walk mode inside, keep the 60 m shadow box, which already covers the room. Check that `normalBias` 0.03 doesn't leak at the reveals.
  - Add a dim, warm interior IBL (§5.2) and N8AO with a ~0.5 m radius.
  - Optionally, one non-shadowed `RectAreaLight` per window wall (needs `RectAreaLightUniformsLib.init()`) for the soft window gradient. Count the cost: ≤ 4 per room.
- **Candle light (I2), period-correct:**
  - Candle flames correspond to ~1800–1930 K and give ~13 lm (≈ 1 cd) each ([hypertextbook, candle temperature](https://hypertextbook.com/facts/1999/JaneFishler.shtml)). A measured paraffin flame was ~1819 K, and composition barely changes the colour (NTHU study, [scholars.nthu.edu.tw](https://scholars.nthu.edu.tw/esploro/outputs/journalArticle/Unveiling-the-mythical-candles/9957768313706774)).
  - **Practice in German courts (D->):** table candelabra were the everyday light. Chandeliers and wall sconces were lit only for large celebrations, with bleached beeswax candles (Stiftung Preußische Schlösser und Gärten, [Chandeliers and Luminaria](https://spsg.de/en/research-collections/collections/chandeliers-and-luminaria)).
  - So a "normal evening" mode lights **only a few candelabra**, and the full chandelier is a **"Fest" mode**.
  - Rendering:
    - emissive flames ≥ 5× the bloom threshold, with bloom
    - a single shadowless `PointLight` per cluster (physically correct decay 2), plus per-light flicker (`intensity *= 1 + 0.06·noise(t·8)`)
    - the light colour from 1850 K (≈ `#FF8A2A` sRGB; [vendian table](http://www.vendian.org/mncharity/dir3/blackbody/))
    - mirrors (already roughness 0.35) gain the most from the bloom of the reflected flames
- **Night exteriors (B5, L5):**
  - Lit windows are emissive panes on the window geometry. Seed a per-room lit/unlit state from `mulberry32(roomId ^ seed)`: in 1789 most rooms were dark at night [I], so ~10–20 % lit in the CdL and fewer in the Nutzbauten.
  - Emissive colour comes from the 1850 K curve. Intensity drops with the curtains' or shutters' state.
  - Lanterns at the main portals and the Ehrenhof gate (N, typical; position U).
- **"Illumination" festive mode (D for the event, I for the look):**
  - The 1785 wedding festivities at Karlsberg had **illuminations** (Fürstenwärther 1786; research/01 §4.2). Mannlich's memoirs describe **fireworks** in 1785 (research/01 §4.2).
  - Garden festivities of the period used thousands of small coloured glass lamps; SPSG keeps 280 of them ([SPSG](https://spsg.de/en/research-collections/collections/chandeliers-and-luminaria)).
  - Draw it as an instanced mesh of emissive points along cornices, the parterre borders and the Rotunde, with a warm 1850 K colour and small coloured-glass hue jitter.
  - This gives a documented-in-spirit "wow" scene for a night Rundflug. Label it **"Festbeleuchtung (wie 1785 beschrieben, Anordnung Hypothese)"**.

### 5.10 What "period-appropriate" means for the look

- **No electric light anywhere.** Night is dark blue with warm pinpoints. "Fest" is the exception.
- **Colours come from the catalogue and the documented sources** (render, red Buntsandstein, slate vs tile, dark shutters HMS). The grade must not shift them: hence Neutral for the documentation look, and LUTs only as a "cinematic" option.
- The **young park** of 1789 (avenues 5–15 years old) versus the mature forest (research/02 §3.2). The Le Clerc 1790 gouache (research/07 §1.2) is the closest period colour reference for sky and haze. A subtle warm, low-contrast "gouache" LUT for photo mode would echo it (I), but the HMS film's look stays reference only.
- Keep "Schauen, nicht graben" and the hypothesis labelling in the photo-mode overlay or watermark.

### 5.11 Cinematic camera ("Rundflug") and photo mode

- **Rundflug:**
  - keyframes as a `THREE.CatmullRomCurve3(points, false, 'centripetal')` for the position and a second curve for the look-at target
  - parameterise by arc length (`getPointAt`), with ease-in/out on the time-to-u map
  - roll 0, and limit the FOV changes
  - drive it from `skb.step(n, dt)`, so it renders deterministically, which allows **offline frame capture** (CDP screenshots → ffmpeg) for a video
  - **Shots:**
    1. dawn approach up the Karlslust valley
    2. low pass over the Ehrenhof gate at 17:30, sun from the W on the court front
    3. orbit of the CdL
    4. slide along the Orangerie
    5. rise to the aerial over the parterre at golden hour
    6. dusk with lit windows
  - The time of day animates with the path.
- **Photo mode** (key P):
  - hide the UI, freeze controls
  - render at a scale of 2–3× (`setPixelRatio`) with TAA accumulation (32 jittered frames)
  - optional DOF (pmndrs `DepthOfFieldEffect` or three `BokehPass`), vignette and grain
  - `canvas.toBlob` → download, with the attribution and "Rekonstruktion = Hypothese" burned in
  - Enable `preserveDrawingBuffer` only here.

## 6. Prioritised improvement list

Impact and effort are high, med or low. Perf cost is the expected GPU time at 1080p on an M5 Pro [I unless measured].
The "files" column names what each item would touch; `post.ts`, `atmosphere.ts`, `tour.ts` and `photo.ts` are new.

| P | Item | Impact | Effort | Perf | Concrete approach | Files |
|---|---|---|---|---|---|---|
| **P1** | **Forest culling + impostor LOD** | med (look) / **high (perf)** | med | **−3 to −9 ms** aerial (measured: hiding the forest = −9 ms at view-west in one run) | 512 m tiles or InstancedMesh2 + BVH. Impostors beyond 400 m. Shadow-cast only within the near shadow box. | `viewer/src/forest.ts`, `model/src/site/trees.ts` |
| **P2** | **Shadow caching + softness** | med | low | **−1 to −4 ms** in flight; radius ~0 | `shadowMap.autoUpdate = false`, update on hour change or frustum shift. `shadow.radius = 3`. Remove `PCFSoftShadowMap`. | `viewer/src/main.ts` |
| **P3** | **Calibrated light budget**: one sky radiance for background and IBL, env ≈ 1, hemi off, sun/sky ratio, EV curve, blackbody sun colour, twilight floor | **high** | med | ~0 | §5.2 steps 1–6. Interiors use the room env. | `viewer/src/main.ts` (`updateSun`), new `viewer/src/atmosphere.ts`, `model/src/interior/materials.ts` |
| **P4** | **Height fog + sky-matched haze** (level 1) | **high** (aerials) | low | ~0 | §5.4 level 1 via a `fog_fragment` override; fog colour sampled from the sky | new `viewer/src/atmosphere.ts`, `viewer/src/terrain.ts` (splat keeps fog), `model/src/materials/index.ts` |
| **P5** | **Post chain**: N8AO (half-res) + SMAA + bloom + tone mapping (Neutral / AgX) + vignette | **high** | med | +2 to +3.5 ms | pmndrs 6.39.6 + n8ao 2.0.1, or the built-in `setEffects` (§5.1). Renderer `antialias: false`, half-float buffer. | new `viewer/src/post.ts`, `viewer/src/main.ts`, `package.json` (exact pins) |
| **P6** | **Default views and time**: hero hour 17:30 (court front lit from 278°), garden view at 07:00, presets "Morgen / Nachmittag / Goldene Stunde / Dämmerung / Nacht / Fest" | high | low | 0 | `state.hour`, POI `views` with a preferred hour | `viewer/src/main.ts`, `viewer/src/ui.ts` |
| **P7** | **Render scale + quality presets** (Hoch / Mittel / Mobil, like the explorer's F20): DPR cap 1.5 on retina, adaptive resolution when the frame time exceeds 14 ms, and `preserveDrawingBuffer` off | **high (perf)** | low | **−30 to −45 %** at retina | `renderer.setPixelRatio(Math.min(dpr, preset))`, plus a moving-average frame-time controller | `viewer/src/main.ts`, `viewer/src/ui.ts` |
| P8 | **Glass**: reflective opaque far glass, transparent near, crown-glass waviness; interior mapping for buildings without interiors | high | med | +0.2 ms | §5.9 | `model/src/materials/index.ts`, `model/src/exterior/facade.ts` |
| P9 | **Generator vertex AO** (reveals, soffits, cornice undersides, wall foot) | high | med | 0 | §5.8 `_AO` attribute + `aomap_fragment` patch; export mapping | `model/src/exterior/builder.ts`, `facade.ts`, `roof.ts`, `model/src/materials/index.ts`, `model/src/explorer/export.ts`, `docs/architecture.md` §3.6 |
| P10 | **Tree look**: leaf-card crowns near (EZ-Tree variants), crown AO, wrap/back-light, wind, lighter bark, species mix + forest edge | high | med-high | +0.5 to +1.5 ms (alpha-tested cards near only) | §5.6 items 2–5 | `model/src/site/trees.ts`, `viewer/src/forest.ts`, `model/src/site/features.ts` (avenues) |
| P11 | **Night**: lit windows (seeded), portal lanterns, candle flicker + bloom, normal-evening vs "Fest" chandelier | high | med | +0.3 ms | §5.9 | `model/src/exterior/facade.ts`, `model/src/interior/index.ts`, `model/src/interior/fixtures.ts`, `viewer/src/main.ts` |
| P12 | **Ground**: gravel wear mask and plinth band, macro lawn variation, lawn vs meadow, full-res terrain normals, hedge bevel and edging | med | med | ~0 | §5.6 items 6–7, §5.7 | `viewer/src/terrain.ts`, `model/src/site/features.ts` |
| P13 | **Rundflug** (6 shots, deterministic, frame capture) | **high (wow)** | med | 0 | §5.11; `skb.tour(id)` hook for capture | new `viewer/src/tour.ts`, `viewer/src/ui.ts` |
| P14 | **Photo mode** (TAA accumulation, 2–3× scale, DOF, burned-in attribution) | med | low-med | n/a (stills) | §5.11 | new `viewer/src/photo.ts`, `viewer/src/main.ts` |
| P15 | **Water**: calibrated IBL first; then a cube-capture or ¼-res `Water` reflector for the Weiher and the hero basins | med | med | +0.5 to +2 ms when active | §5.7 | `model/src/site/features.ts`, `viewer/src/main.ts` |
| P16 | **Façade weathering + slate jitter + roof lead** | med | med | ~0 | §5.8 | `model/src/materials/index.ts`, `model/src/exterior/roof.ts` |
| P17 | **"Festbeleuchtung 1785"** illumination mode + fireworks | high (wow) | med | +0.3 ms | §5.9; labelled hypothesis | new `viewer/src/festival.ts`, `viewer/src/ui.ts` |
| P18 | **Physically based atmosphere** (takram, level 2) for the Rundflug and photo mode | med-high | high | +1 to +2 ms | §5.4 level 2, behind a flag; pin the pre-1.0 version | new `viewer/src/atmosphere.ts` |
| P19 | **CSM or static far shadow map** for aerial palace shadows | med | med-high | +1 to +3 ms (CSM) | §5.5; prefer the static far map | `viewer/src/main.ts`, a shadow chunk patch |
| P20 | **WebGPU / TSL migration** (TRAA, SSGI, SSR) | high (later) | **high** | unknown | Only after the look is settled; port `lumaPatch` and the splat to TSL | everything rendering-related |

**Suggested order:**

| Pass | Items | Expected result |
|---|---|---|
| **Pass 1: headroom + light** | P1, P2, P7, P3, P4, P6 | Probably the biggest visible jump: golden hour, dusk and aerial depth all fixed, while the frame gets *cheaper* than today. |
| **Pass 2: polish** | P5, P8, P9, P11 | "Cinematic" look and believable night. |
| **Pass 3: nature and show** | P10, P12, P13, P14 | |
| **Later** | P15–P20 | |

Each pass needs a browser check with before/after screenshots at the same 11 poses in this note. The poses are reproducible with the `pose()` helper described in §2. Measure each with `gpuBench` at 1080p and 3024×1964.

**Target budget** at 3024×1964 on M5 Pro: ≤ 12 ms GPU (aerial) after pass 2, which leaves margin for weaker M-series chips with the "Mittel" preset (DPR 1.25).

## 7. Notes for whoever implements this

- **Contract.**
  - Material names (`MATERIAL_NAMES`, `docs/architecture.md` §3.6) and `PartUserData` must not change.
  - New attributes (`_AO`) and the glass behaviour must keep the explorer's light layer (`export:explorer`) working. The explorer applies its own lighting and exaggeration, so viewer-only effects belong in `viewer/`, not in `model/`.
- **Determinism.**
  - All random choices (lit windows, tree variants, weathering) come from `mulberry32(hashString(id) ^ seed)`.
  - Pure helpers go in `model/src/layout`, with tests: window lit state, wear-mask geometry, the EV curve and blackbody colour (as pure functions in `viewer/src/` with vitest).
- **Pins.**
  - `postprocessing` 6.39.6 caps three at < 0.188. Bump both together.
  - `n8ao` 2.0.1, `@three.ez/instanced-mesh` 0.3.16, `@dgreenheck/ez-tree` 1.1.0 and `@takram/three-atmosphere` 0.19.1 are the current versions (npm, 2026-11-02). Pin them exactly.
- **Licences.** Leaf and bark atlases must be CC0 (Poly Haven / ambientCG, like `viewer/textures.json`), and their attribution goes in the footer. No HMS frames or textures.
- **Test hooks.**
  - Extend `skb` with `look(name)` (tone mapping/preset), `quality(preset)` and `tour(id, t)`.
  - Expose the `pose()` helper used here, `skb.pose(x, y, z, lx, ly, lz, mode)`, so reviews can reproduce shots exactly.

## 8. Open questions

1. **Postprocessing dependency.** Is a new runtime dependency (pmndrs `postprocessing` + `n8ao`) acceptable? The alternative is the dependency-free built-in `setEffects` with jsm passes: no N8AO, and GTAO costs an extra normal pass.
2. **Default look.** Should the default be "Dokumentation" (Neutral, catalogue colours exact) or "Kino" (AgX + LUT)? Proposal: documentation by default, cinematic in the Rundflug and photo mode.
3. **Festbeleuchtung.** Is a "Festbeleuchtung 1785" mode welcome, given that its arrangement is a hypothesis? Reading Fürstenwärther 1786 (dilibri, PD) could ground where lamps were placed.
4. **Night window share.** The ~10–20 % share of lit windows at night is U. Is there a source on household lighting at Karlsberg (court accounts, candle consumption)?
5. **Lower-end Macs.** Should the frame budget target the lowest M-series Mac the user owns? These measurements are from an M5 Pro only.
