# Light, sky, atmosphere, tone mapping, post-processing, shadows

Implementation notes for audit items P2–P6, P11 (lighting part), P18 and P19. The background and the cost
estimates are in `docs/visual-audit.md` §4.1, §5.1–5.5 and §5.9. This file is the *how*: the order of operations,
concrete values and the checks. Code lives in `viewer/src/` (new `atmosphere.ts`, `post.ts`) plus
`model/src/interior/materials.ts` for the interior environment. Pure maths (EV curve, Kelvin→RGB, fog colour, twilight
floor) goes in a three-free module such as `viewer/src/light.ts` with tests in `viewer/tests/`, like `sun.ts`.

## 1. Order of operations (don't skip ahead)

1. **Shadows cheap and soft** (P2). This is independent of the rest and it frees time.
2. **One sky radiance** for the background and the IBL. Remove the ×0.3 string patch.
3. **Sun:sky ratio and exposure curve.** Turn the hemisphere light off.
4. **Interior environment**, so step 3 doesn't light rooms with sky.
5. **Height fog** coloured from the sky (P4).
6. **Twilight and night floor.**
7. **Tone mapping looks**, then the **post chain** (P5).

Take before/after shots after each of steps 1, 3, 5 and 7 (`performance-and-review.md` §3). A wrong step 2 or 3 makes
every later step look wrong.

## 2. Shadows (P2): cache, soften, keep the bias

The current code (`viewer/src/main.ts`) redraws a 4096² map every frame, and the shadow pass re-draws about 1.95 M
triangles at view-west (measured, audit §3).

- **Remove** `renderer.shadowMap.type = THREE.PCFSoftShadowMap`. r187 removed it, warns on the console and falls
  back to PCF (`node_modules/three/src/renderers/webgl/WebGLShadowMap.js`).
- **Softness:** `sun.shadow.radius = 3` (2–4 at 4096²). In r187 PCF is a 5-tap Vogel-disk filter scaled by `radius`.
- **Cache:** set `sun.shadow.autoUpdate = false` (r187 has per-light `shadow.autoUpdate` and `needsUpdate`, see
  `WebGLShadowMap.js`; `renderer.shadowMap.autoUpdate` also works). Set `sun.shadow.needsUpdate = true` only when:
  - the hour changes (`updateSun`);
  - the fitted frustum centre has moved by more than about `ext / 8`. Snap the centre to an `ext / 8` grid instead
    of the texel grid, so small moves don't trigger a redraw;
  - `ext` changes by more than about 10 %;
  - display toggles change casters (`applyDisplay`, LOD2 build, interiors shown).
- Keep `normalBias` as now (walk 0.03, fly up to 1.0). After caching, check the reveals in walk mode for acne or
  light leaks (pose 03 and a close façade).
- **Later (P19):** a static far map for the whole residence (2 km, rendered once per hour change) sampled beyond the
  near map gives palace shadows in aerial views. Prefer it to CSM, because CSM means 3 renders and clashes with the
  `onBeforeCompile` patches (audit §5.5).
- Forest trees beyond the near box should not cast (P1, `materials-vegetation-water.md` §5).

## 3. Light budget (P3)

### 3.1 One sky radiance

- Delete the `gl_FragColor = vec4( texColor * 0.3, 1.0 )` string patch on `sky.material`.
- Apply one `uSkyScale` uniform to **both** `sky` and `envSky`. Patch both the same way, or render the env scene
  from the same `Sky` instance. Then the reflections and the visible sky agree.
- Rebuild the PMREM only when the hour changes (this already happens), and dispose the old target (it does).

### 3.2 Sun versus sky

Physical anchor: direct sun about 32–100 klx, full daylight without direct sun about 10–25 klx
([Wikipedia: Lux](https://en.wikipedia.org/wiki/Lux)). So the sun:sky illuminance ratio at high sun is roughly
3:1–8:1. It falls toward 1:1 and below at low sun, and the sky dominates in twilight.

Calibrate with a **grey-card probe**, not by eye:
- Add a debug hook (e.g. `skb.lightProbe()`) that renders two small Lambert cards (albedo 0.5) at the camera into a
  tiny `HalfFloatType` target with `NoToneMapping`. One faces the sun, one faces away (sky only).
- Read the pixels back and return the ratio.
- Tune `sun.intensity` against `uSkyScale` and `environmentIntensity` (≈ 1 once calibrated) until:
  - at 10:30 (56.5°) the ratio is 3–6;
  - at 17:30 (22°) it is about 2–3;
  - at 19:00 (7.9°) it is about 1–1.5 [I].
- Write the resulting table into a pure function and test that it is monotonic (KB-I06 did this as `sunSkyRatio(elDeg)`
  in `viewer/src/light.ts`).

Then:
- **Remove the `HemisphereLight`** outside, or keep it at ≤ 0.1 as a warm ground bounce (`#8a7a5c` ground colour).
- Check the audit symptoms on poses 03, 04 and 06. Gilding should read gold, not olive. Glass should reflect the
  sky. Shaded render should read cool and blue-ish, not grey-green (L1, L2).

### 3.3 Exposure as a curve over sun elevation

Replace `toneMappingExposure = 0.45 + 0.3·day` with an EV curve over elevation (KB-I06: `evOutdoor(elDeg)` and
`roomIlluminance(elDeg)` in `viewer/src/light.ts`, pre-exposure in `atmosphere.ts`):
- Targets in EV100 [I, approximations after [Wikipedia: Exposure value](https://en.wikipedia.org/wiki/Exposure_value)]:
  - about 15 at high sun;
  - about 12 at golden hour;
  - about 8 at civil dusk;
  - about 3 for candle-lit rooms.
- The scene isn't in physical units, so use a relative curve: `exposure = k · 2^(EV_ref − EV(el))`. Tune `k` so that
  10:30 matches the calibrated look. Clamp it.
- **Adaptation:** ease toward the target with a time constant of 1–2 s (`exp(−dt/τ)`). Snap instantly on `goto`,
  `skb.set('hour')` and in `skb.step` capture runs, so screenshots are deterministic.
- `inside` switches when the camera is inside a building footprint (the interior budget already knows the nearest
  interior). Interiors at day want about +1.5 to +2.5 EV more exposure than outside [I].

### 3.4 Sun colour

- Use a blackbody curve over airmass instead of the HSL ramp [I, approximation]:
  - about 5800 K at high sun;
  - about 3500 K at 5°;
  - about 2500 K at the horizon.
- Kelvin → RGB: use the [vendian blackbody table](http://www.vendian.org/mncharity/dir3/blackbody/), or Tanner
  Helland's fit ([tannerhelland.com, 2012](https://tannerhelland.com/2012/09/18/convert-temperature-rgb-algorithm-code.html)).
  Either way it is a pure function with a test (e.g. 6500 K ≈ white, 1850 K ≈ `#FF8A2A`).
- Better later: take the sun transmittance from the same sky model (P18).

### 3.5 Interiors get their own environment

Raising the IBL lights rooms with outdoor sky. The audit's A/B turned the Festsaal mint (`docs/visual-audit/ab-festsaal-neutral-env.jpg`).
- Give every material under `<id>/interior` a dim, warm `envMap`. `roomEnvironment()` in
  `model/src/interior/materials.ts` already exists and the mirrors use it.
- Alternatively, swap `scene.environment` when the camera is inside. That is simpler, but exterior façades seen
  through a window would then use the room env too.
- Daylight in rooms comes through the windows: sun shadows on, plus optionally one non-shadowed `RectAreaLight` per
  window wall (≤ 4 per room, `RectAreaLightUniformsLib.init()`).
- Check on pose 06 (day) and 07 (night).

## 4. Atmosphere: height fog and sky-matched haze (P4)

The current `FogExp2('#c9d6e0', 0.00016)` reaches about 15 % at 1 km. Its hue is fixed and cool at every hour, which
is the root cause of the navy-and-brown golden hour (L3, L4).

Level 1 (do now, about 0 ms):
- **Exponential height fog** in the fog chunks, after [Quilez, "Better fog"](https://iquilezles.org/articles/fog/):
  density `a·exp(−b·h)`, integrated analytically along the ray from camera height `ro.y` with direction `rd`:
  `fog = (a/b) · exp(−ro.y·b) · (1 − exp(−rd.y·t·b)) / rd.y`. Guard against `rd.y ≈ 0`.
- **Sun in-scatter:** `mix(fogColour, sunColour·k, pow(max(dot(rd, sunDir), 0), 8))`. The haze warms toward the
  sun: that is the golden-hour glow.
- **Fog colour from the sky:** once per hour change, take the mean of the env cube's horizon ring (or evaluate
  Preetham at a few azimuths on the CPU). Optionally keep two colours, toward the sun and away from it, and blend by
  view azimuth.
- How to install it:
  - override `THREE.ShaderChunk.fog_pars_vertex`, `fog_vertex`, `fog_pars_fragment` and `fog_fragment` once,
    before any material compiles;
  - a world-position varying is needed, because three's default only passes `vFogDepth`;
  - this reaches the terrain splat too, because it is a patched `MeshStandardMaterial`;
  - the `Sky` shader has no fog, which is correct.
- Starting values [I, tune with shots 01, 02, 08, 11]:
  - the distant ridges at 5–8 km should be about 50–70 % hazed;
  - the palace from view-west (about 250 m) under 5 %;
  - scale height 300–600 m above the plateau (345 m).
- **Morning mist** (07:00 preset) over the Weiher and valleys: a second, very low layer (scale height 10–20 m above
  the valley floor) that fades out by about 09:00 [I].

Level 2 (later, P18): `@takram/three-atmosphere` 0.19.1, Bruneton precomputed scattering with aerial perspective.
It is pre-1.0 and requires `postprocessing ≥ 6.36.7`. World positions must map to ECEF (local ENU → ECEF at
49.336 N, 7.36 E). Put it behind a flag for the Rundflug and photo mode ([three-geospatial](https://github.com/takram-design-engineering/three-geospatial);
Bruneton & Neyret, CGF 27(4), 2008; Hillaire, CGF 39(4), 2020).

## 5. Twilight and night (L5)

- The sun light goes to 0 below about 0°. The sky IBL must **persist** through civil (to −6°) and nautical (to −12°)
  twilight with a blue-violet tint. Preetham goes black too early, so blend toward a twilight gradient
  (zenith deep blue, horizon toward the sun warm) as elevation falls [I].
- **Night floor:** a cool, low-intensity fill (moonlight stand-in) plus slight desaturation ("day for night") so the
  scene never goes black [I]. Wave 10 computes the moon (`viewer/src/ephemeris.ts`, Meeus): on 15 Jul 1789 it is
  46 % waning and rises only at 23:09; "Vollmondnacht" shows 6 Jul 1789. Moonlight takes over the sun's directional
  light after sunset; stars and the Milky Way are `viewer/src/nightSky.ts`.
- Then the warm points carry the image: lit windows, candles, lanterns, Fest
  (`look-and-period.md` §5, `materials-vegetation-water.md` §4).
- Check on poses 10 (21:00) and 07 (22:00).

## 6. Tone mapping

three r187 offers `ACESFilmicToneMapping`, `AgXToneMapping` and `NeutralToneMapping` (`node_modules/three/src/constants.js`).
- **Dokumentation:** Neutral. **Kino:** AgX + LUT (`look-and-period.md` §2).
- r187 fixed the ACES fit denominator (PR #35110, [r187 notes](https://newreleases.io/project/github/mrdoob/three.js/release/r187)),
  so review-1 screenshots may look slightly different under ACES now.
- With a post chain, tone mapping must run **once, at the end**, and any LUT grade runs *after* it. See §7.

## 7. Post-processing chain (P5)

Two options, both keep `WebGLRenderer`, three-mesh-bvh and the `onBeforeCompile` patches (audit §5.1):

**A. Built-in r187 `renderer.setEffects([...])`** (no new dependency)
- Create the renderer with `outputBufferType: THREE.HalfFloatType`. `setEffects` refuses `UnsignedByteType`
  (`node_modules/three/src/renderers/WebGLRenderer.js`).
- Tone mapping and sRGB output are applied automatically at the end, so don't add an `OutputPass` (it warns).
- Passes come from `three/addons/postprocessing/`: `UnrealBloomPass`, `SMAAPass`, `GTAOPass`, `ShaderPass`,
  `LUTPass`, `BokehPass`, `TAARenderPass`.
- Caveat: `GTAOPass` renders an extra normal pass (it doubles draw calls). Grading after tone mapping needs your own
  final `ShaderPass` with renderer `NoToneMapping`.

**B. pmndrs `postprocessing` 6.39.6 + `n8ao` 2.0.1** (better quality per ms; new dependency, ask first)
- The peer range is `three >= 0.168.0 < 0.188.0`, so it **blocks a three upgrade** until it is bumped. Pin it
  exactly ([pmndrs/postprocessing](https://github.com/pmndrs/postprocessing), [N8AO](https://github.com/N8python/n8ao)).
- Setup:
  - renderer `antialias: false`, `toneMapping = NoToneMapping`;
  - `EffectComposer(renderer, { frameBufferType: HalfFloatType })`;
  - `RenderPass` → `N8AOPostPass` (`halfRes: true`, quality "Medium", `aoRadius` 1.5–3 m outside, about 0.5 m
    inside) → one `EffectPass` with SMAA, Bloom (mipmap blur, luminance threshold 1.0), ToneMapping (Neutral or
    AgX), LUT3D (Kino only) and a light Vignette.
- Check with the grey-card probe (§3.2) whether exposure still comes from `renderer.toneMappingExposure` in the
  chosen chain. Don't assume it.

Budget at 1080p on the M5 Pro [I, to measure]: AO 0.8–1.5 ms, SMAA 0.3–0.6, bloom 0.4–0.8, tone mapping and grade
about 0.1. That is +2 to +3.5 ms in total, which is why P1/P2/P7 come first.

Rules:
- **Bloom threshold above 1.0 in HDR.** Only candle flames (emissive ≥ 5× the threshold), sun glints and the sky near
  the sun should bloom. White render must never bloom; if it does, the exposure is wrong.
- **No TAA while moving** in WebGL. Use `TAARenderPass` accumulation (32 jittered frames) only in photo mode.
- **`preserveDrawingBuffer: false`** in normal mode. It costs bandwidth on tile-based Apple GPUs [I], and CDP
  screenshots don't need it (audit §3). Enable it only for photo-mode capture via `canvas.toBlob`.
- **WebGPU/TSL** (`GTAONode`, `TRAANode`, `SSRNode` …) is a later migration (P20). It needs `lumaPatch` and the
  terrain splat ported to TSL, and the explorer's renderer would differ. Don't start it as part of a "make it
  prettier" task.

## 8. Checks for this area

- Grey-card ratio within the target per hour (§3.2). Store the probe output in the review notes.
- Backlog shots 01–15 before/after (`skb-improve/scripts/shots.mjs`): no cyan or mint cast, no blown gravel, the horizon hazed, the golden hour warm (not
  navy), dusk not black, the night Festsaal warm with blooming flames.
- Console log (driver stdout): the PCFSoftShadowMap warning gone, no new warnings.
- `gpuBench` at 1080p and 3024×1964: the shadow-caching gain is visible in flight (benchmark a moving camera too:
  `skb.step` with small position changes between frames).
