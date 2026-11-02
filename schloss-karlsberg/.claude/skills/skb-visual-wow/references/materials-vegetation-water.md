# Materials, colour management, glass, night windows, vegetation, ground, water

Implementation rules for audit items P1, P8–P12, P15 and P16. The background is in `docs/visual-audit.md` §4.2–4.4
and §5.6–5.9. Colour *values* are history: change them only through the evidence chain (`look-and-period.md` §4).

## 1. Colour management (three r187)

- `THREE.ColorManagement` is on by default. Hex strings and CSS colours (`'#ECE8DF'`) are **sRGB** and converted to
  the linear working space. Never pre-linearise them by hand.
- Textures:
  - colour (`diff`) maps → `SRGBColorSpace`;
  - normal, ARM, data and weight textures → `NoColorSpace`;
  - this is already right in `model/src/materials/index.ts` and `viewer/src/terrain.ts`. Keep it for every new
    texture (leaf atlas = sRGB, leaf normal/opacity = NoColorSpace).
- **Vertex colours are linear.** The explorer light layer bakes `COLOR_0` in linear RGB from `MATERIAL_BASE`
  (`docs/explorer-integration.md` §2.2). Any new baked colour or AO attribute must follow that.
- Output: `renderer.outputColorSpace = SRGBColorSpace` (default). With a post chain, sRGB conversion happens once at
  the end (`light-sky-post.md` §7).
- **Albedo sanity [I]:** compute the linear luminance (`0.2126 R + 0.7152 G + 0.0722 B` after sRGB→linear) before
  accepting a colour. For example, `#ECE8DF` ≈ 0.81, which suits fresh limewash. Avoid albedos above about 0.85: with
  calibrated light they clip in the sun, and Neutral tone mapping would flatten them. If a documented colour clips,
  fix the exposure, not the colour.
- Use `materials.tinted(name, colour)` for catalogue colours (`docs/architecture.md` §3.6). Don't create ad-hoc
  materials with new names: `MATERIAL_NAMES` is the contract, and glb exports keep the names.

## 2. Shader patches

- `lumaPatch` (`model/src/materials/index.ts`) keeps the albedo at the material colour and lets the texture modulate
  luminance only. That keeps documented colours exact while adding texture. Keep that principle for any new
  texture.
- Patches use `onBeforeCompile` + `customProgramCacheKey`. When you add a second patch (weathering, vertex AO,
  glass jitter), **compose** it: keep the previous callback, call it, then edit `shader.fragmentShader`. Include
  every patch flag in the cache key, otherwise three reuses the wrong program.
- Prefer global `ShaderChunk` overrides only for truly global behaviour (height fog). Everything else stays per
  material.

## 3. Façades: vertex AO and weathering (P9, P16)

**Vertex AO** (high impact, 0 ms, survives glb):
- In `GeoBuilder` (`model/src/exterior/builder.ts`), add a per-vertex `ao` attribute (audit §5.8):
  - 1.0 on open wall;
  - 0.55–0.7 on reveal jambs and soffits;
  - about 0.7 under cornices and sills;
  - about 0.8 at the wall foot.
- Large wall quads need one extra vertex row near the ground and under cornices to carry the gradient.
- Feed it through an `aomap_fragment` patch (`ambientOcclusion = vAo`), so it affects indirect light only, not the
  sun.
- Export: either fold it into `COLOR_0` at export time (no contract change) or add `_AO` (contract change in
  `docs/explorer-integration.md` §2.2, plus a note for the explorer agent). Test it in
  `model/tests/explorer-export.test.ts`.
- Generator helpers that compute AO per opening/storey are pure and belong in `model/src/layout` with tests.

**Weathering** (subtle: at most 15 years old in 1793, research/02 §3.3):
- splash-back grime 0.3–0.5 m above the terrain (world-space gradient);
- faint vertical streaks under sills and cornice ends (noise stretched in v);
- ±2–3 % low-frequency albedo variation per building, seeded by its id. Warm for 1778–82 work and cool for 1785–88
  once the catalogue carries a build year (research/09 §6.2 M3);
- moss only on the north slopes of farm roofs;
- all of it inside `lumaPatch` or a sibling patch, with no decal geometry.

**Roofs:**
- Slate: per-tile albedo jitter of ±6 % from a hashed tile id in UV space.
- Lead on ridges and hips as thin geometry with `roof.lead` (`model/src/exterior/roof.ts`).
- Keep slate matt (roughness 0.88, review-1 #5), but let calibrated IBL give it a grazing sky sheen.

## 4. Glass, lit windows, candles (P8, P11)

**Glass from outside** (B2: today white frames around empty holes):
- Beyond about 40 m: opaque (`transparent: false`), a near-black green-grey base, and Fresnel reflection of the
  calibrated sky.
- Within the interior radius (45 m, `INTERIOR_DIST` in `viewer/src/main.ts`): keep transparent glass, so the
  generated rooms show.
- Crown glass: a per-pane normal/rotation jitter of 0.5–1.5° [N, research/09 §6.2 M6], seeded per pane, so low sun
  breaks up across the façade.
- Buildings or LODs without interiors: **interior mapping**, a fake room box ray-cast from the window UV (van
  Dongen, "Interior Mapping", CGI 2008), tinted per building class. Zero geometry.
- Material name stays `glass.crown`. A distance switch can be a uniform, not a second material name.

**Lit windows at night:**
- An emissive pane state seeded per room: `mulberry32(hashString(roomId) ^ seed)`. About 10–20 % in the Corps de
  logis, fewer in the Nutzbauten [U].
- 1850 K colour, dimmed by the shutter state. A pure chooser function with a test (same seed → same set; the share
  stays in range).
- Only active below about −2° sun. Rooms without generated interiors still get panes.

**Candles** (I2: today white dots, black chandelier):
- Flames emissive ≥ 5× the bloom threshold, so they bloom.
- One shadowless `PointLight` per cluster, physically correct decay 2, at the 1850 K colour.
- Flicker `intensity *= 1 + 0.06·noise(t·8)`, deterministic under `skb.step`.
- Normal evening: candelabra only. Fest: chandeliers and sconces (`look-and-period.md` §5).
- Keep the cap of a few lights per building (`updateInteriorBudget`).
- Mirrors (`interior.mirror`, roughness 0.35, room env) gain the most from bloom of the reflected flames.
- Give the chandelier body `metal.gilt`, or crystal with emissive pick-up, not black.

## 5. Vegetation (P1, P10)

**First cost, then look.** The forest is about 1.48 M triangles per pass and never culled (audit §3).
- **Culling (done, KB-I10):** `Forest` (`viewer/src/forest.ts`) tiles the instances into 320 m cells, each its own `InstancedMesh` with a
  correct bounding sphere. Or use `@three.ez/instanced-mesh` 0.3.16 (`InstancedMesh2`: per-instance BVH culling,
  `addLOD`, `addShadowLOD`; [repo](https://github.com/three-ez/instanced-mesh)). Prefer the dependency-free tiling; a new dependency is pinned exactly and its choice recorded in the backlog's
  Decisions log (KB-I10).
- **Far LOD:** octahedral impostors beyond about 400 m (Brucks, ["Octahedral Impostors"](https://shaderbits.com/blog/octahedral-impostors), 2018).
  Orient billboards in the vertex shader, not per instance on the CPU. Watch the overdraw.
- **Shadows:** only trees inside the near shadow box cast.
- After **landcover S1** (research/11, skill `skb-schlossgarten`) the forest shrinks to belts and the east plateau.
  Re-measure then; don't optimise trees that are about to disappear beyond the cheap tiling.

**Look** (V1, V2):
- Near and mid trees get **leaf-card crowns**: alpha-tested quads with a CC0 leaf atlas around the lobed volume,
  with normals pointing out from the crown centre so the crown shades as one mass.
  - Generate 6–10 variants per species once (e.g. `@dgreenheck/ez-tree` 1.1.0, MIT,
    [repo](https://github.com/dgreenheck/ez-tree)), seeded with `mulberry32`. Then instance them.
  - Cap the alpha-tested area near the camera. Overdraw is the cost.
- **Shading** in the `vegetation.leaf` material patch (`model/src/site/trees.ts`), cheap at any LOD:
  - per-instance hue jitter (exists);
  - crown AO toward the inside and bottom;
  - wrap diffuse `max(0, (N·L + w)/(1 + w))`;
  - a back-light term `pow(saturate(dot(V, −L)), 4)·thickness` for the golden-hour glow;
  - lighter, warmer bark (beech is light grey, about `#8A8580` [I]) instead of near-black `#4B4238`.
- **Wind:** vertex sway (main bend by height) plus leaf flutter by a phase attribute, gentle, deterministic under
  `skb.step` (Sousa, *GPU Gems 3* ch. 16, [NVIDIA](https://developer.nvidia.com/gpugems/gpugems3/part-iii-rendering/chapter-16-vegetation-procedural-animation-and-shading-crysis)).
- **Species and ages** are content (research/11 §3.1–3.2, S4: castanea, populus_italica, conifer, shrub_flowering,
  taxus_cone, beech_old; and the `speciesFor()` 'kastanie' fix). Coordinate with `skb-schlossgarten`. Here you make
  each species *read*: a columnar poplar silhouette, dark domed horse chestnut, near-black yew cones, cream sweet
  chestnut catkins in July.
- **Forest edge (Waldmantel):** a band of lower trees and shrubs at the forest boundary. It hides the hard edge and
  reads natural [I].

## 6. Hedges, lawns, ground (P12)

- **Hedges:** keep the boxes, but add a leaf-noise normal map, a darker foot, and a 0.05 m bevel so the top edge
  catches light. Today's 0.45 m boxes read as kerbs; the parterre redesign itself (research/11 S7/S8, d'Argenville
  plates-bandes, yew cones every 3.9 m) is content for `skb-schlossgarten`.
- **Lawns and meadows** (`viewer/src/terrain.ts` splat):
  - a macro colour variation at 20–40 m from the existing `vnoise`;
  - scythed lawn (lighter, fine) versus July hay meadow (warmer, yellower, mown strips, research/11 §3.1);
  - golden grain fields where landcover says field;
  - slight darkening of slopes facing away from the sun;
  - aerial perspective desaturates the distance.
- **Gravel** (V4):
  - Buntsandstein tones (`#B79A84` ways, `#D3BE8A` parterre sand, a light sand court, research/11 S15 [N/I]);
  - a wear mask: lighter, compacted ruts on the gate → Freitreppe line, and a darker, looser band 1–2 m along the
    plinths. Both analytic from the spec (court polygon, portal positions) [I];
  - a detail normal map at 0.5 m.
- **Terrain facets** (V6): sample normals from a full-resolution 1 m normal texture at every LOD, instead of the
  decimated mesh. That removes lumpy facets at 0 ms per frame.
- Grass blades only in walk mode within about 30 m, and later.

## 7. Water (P15)

- With calibrated IBL (light-sky-post.md §3) the existing `water` material (`MeshPhysicalMaterial`, clearcoat)
  already reflects the sky. Do that first.
- Still ponds (Weiher, basins): a static cube capture per pond at load or hour change (`CubeCamera` →
  `PMREMGenerator.fromCubemap`). Free per frame.
- Hero reflections near the camera: `three/addons/objects/Reflector.js` / `Water.js` / `Water2.js`. That is one extra
  scene render per reflector, so use ¼ resolution, a layer mask (sky + buildings, no forest), and only within about
  300 m and in view.
- Animated normals: very gentle. These are still garden ponds, not the sea.
- Edges (grass banks, boulders on the Schwanenweiher dams) and the fountain jet (research/11 S3, S12) are content for
  `skb-schlossgarten`. Render the jet as an instanced particle column with low-cost alpha.

## 8. Textures and licences

- Only CC0 sets (Poly Haven, ambientCG), fetched by a script into a git-ignored folder (`viewer/public/textures/`,
  `pnpm run textures`). Record the source URL, author, licence, real-world size and MD5 in `viewer/textures.json`,
  and the attribution in the footer.
- Use 2K JPG unless a measured close-up needs more. Set anisotropy from `renderer.capabilities.getMaxAnisotropy()`
  (the material library already does).
- No HMS frames, no screenshots of the HMS film and no copyrighted photos as textures. Link to references instead.
