# 🎨 Style: Bäckerei Heusser twin

The twin should look **light, friendly and stylised**, between a cosy comic and a clean mobile game. It should not be too cartoony and it should never be photo-real (the castle zone is the photo-real one). Visitors recognise Bäckerei Heusser by its **layout, proportions and colours**, not by photo textures. Everything must stay readable on a phone at 390 px. Decision: [ADR 0042](../../../docs/adr/0042-baeckerei-heusser-built-twin.md).

**Stylise shapes and materials, never sizes.** Dimensions come from the plan (`../plan/`). A shelf that is 1.92 m tall stays 1.92 m tall.

## Palette

Colours are taken from the real shop and then simplified. Values are sRGB, and the renderer works in linear space.

| Token | Hex | Used for |
|---|---|---|
| `heusser-rot` | `#8E2B2B` | Counter base, soffit edge, accents |
| `messing` | `#C29A4B` | Brass rod tiers, rails, lamp details |
| `granit` | `#7E7F80` | Counter ledge, steps (one darker speckle tone `#6A6B6C`, no texture) |
| `fliese` | `#F1EEE8` | Marble-look wall tiles (grout lines `#DCD6CC`, a faint grey vein at most) |
| `holz` | `#B07A4A` | Wood-faced ceiling soffit, crates |
| `decke` | `#E9E6DF` | Suspended panel ceiling (grid lines `#CFCAC0`) |
| `kruste-hell` / `kruste` / `kruste-dunkel` | `#E3B776` / `#C68642` / `#8A5228` | Rolls, light bread / mixed bread / dark rye and crust shadows |
| `korb` | `#C9A063` | Wicker baskets, pretzel basket |
| `tuch-rosa` | `#E9A9B6` | Basket cloths |
| `lack-schwarz` | `#2B2B2D` | Pendant lamps, grid shelf, price rails |
| `glas` | `#CFE6EA` at 25–35 % opacity | Display glass, fridge door, shop window (no reflections) |
| `fassade` / `sockel` | `#E7DFD2` / `#8C5A4A` | Exterior render / sandstone plinth |

Generator-only tokens (same family): `granit-dunkel` `#6A6B6C`, `fliese-fuge` `#DCD6CC`, `decke-raster` `#CFCAC0`, `lampe` `#FFE2BF` (the lit diffuser of the pendant lamps).

**Context** (around the shop, sampled from the orthophoto and then simplified; `../build/bh_twin/shade.py`):

| Token | Hex | Used for |
|---|---|---|
| `dach` | `#A0675A` | LoD2 roofs (neighbours ± 10 % brightness, seeded by the building id) |
| `nachbar-1` / `nachbar-2` / `nachbar-3` | `#E9E3D8` / `#E2D6C2` / `#D9D4CB` | Neighbour walls (picked per LoD2 id) |
| `asphalt` / `gehweg` | `#8E8C8D` / `#C8C2B8` | Carriageway (OSM buffers) / pavement and the passage mouth |
| `gelaende` / `erde` | `#9FAA80` / `#8C7A66` | DGM1 ground patch / its skirt |
| `schatten` | `#4A4440` | Reserved for deep shade. The plain end wall where the public part of the passage ends (privacy line) is `nachbar-2` with a baked shade gradient (darker at the floor): a flat dark slab there read as a hole or a garage door |

Use a new colour only after sampling it from a reference photo, then add it here. Keep saturation moderate (the comic look comes from shapes, not from neon colours).

## Shapes and edges

- **Bevels everywhere.** Fixtures get a 10–20 mm bevel or round-over. Products get 3–8 mm. Building edges (walls, ledges, steps) get 5–10 mm. Hard 90° edges look like a CAD model, and bevels catch the light.
- **Simplify, keep the silhouette.** Model what defines the outline (the slope of the bread tiers, the curved glass of the display, the basket rims) and drop small clutter.
- **Optional outlines:** a 1–1.5 px ink line (`#3A2A22`, ≈ 40 % opacity) on object silhouettes only, never on every triangle edge. If it costs too much on the phone, use it only on the hovered object.
- **Subtle variation, deterministic.** Breads in one basket vary in scale (± 6 %), rotation and crust tone. Seed it from the catalogue id so the result is the same in every build.

## Light and shading

- **Warm and inviting.** The key light is warm white (≈ 3200 K, `#FFE2BF`). Add a soft sky or hemisphere fill (cool `#DDE6F0` above, warm `#E8D8C4` below), and give the pendant lamps a small warm glow.
- **Shading:** flat or soft Lambert, or a 3-step toon ramp. *Round 2 (generator):* unlit materials (`KHR_materials_unlit`, base colour = token) × baked light in `COLOR_0` (soft Lambert from the warm key + hemisphere fill, times vertex AO); `NORMAL` stays in the file so a later renderer can relight. Use no PBR texture maps and no glossy specular (keep at most a small, soft highlight on glass and brass). Baked or vertex AO grounds objects in corners and under the shelves.
- **Shadows:** soft and short. One shadow-casting light at most on the phone. Use blob or baked contact shadows for products.
- **Tone mapping:** neutral, slightly lifted shadows. The scene should read as daytime, open shop.
- **No photo textures** in the visible scene. Allowed are small procedural or hand-made patterns: tile grout, panel grid, wicker weave as a normal-free colour pattern, crust scoring as geometry or a decal.

## Detail per object class

| Class (`type`) | Detail | Budget guide |
|---|---|---|
| `structure` (walls, ceiling, floor, steps, facade) | Planes with bevelled edges, openings, tile or panel grid as a pattern | Few hundred triangles per element |
| `fixture` (counter, shelves, display) | Main parts as separate named nodes (base, ledge, glass, tiers, rails), bevelled | ≤ 5 k triangles per fixture |
| `appliance` (fridge, lamps) | Body, door or glass, one recognisable detail (handle, lamp shade) | ≤ 2 k |
| `container` (baskets, trays, bags) | Rim and weave hint, cloth as one soft shape | ≤ 1 k |
| `product` (bread, rolls, pretzels, cans) | Primitive with one signature detail (scoring, twist, label band), instanced | ≤ 300 per instance, instanced |
| `sign` / `decor` (news stand, mural, signage) | Shape plus a flat graphic. Text only if it is the shop's own and approved | ≤ 1 k |

Leave out what nobody looks at, such as the backs of fixtures that sit against walls, the insides of closed drawers, and cables. Phone budget: the whole twin should stay well under the zone contract limits (≤ 1.5 M triangles, ≤ 128 MB textures). Aim for < 300 k triangles and almost no texture memory.

## Interaction look

- **Hover / tap:** clickable objects get a warm outline or rim glow (`messing`, lighter by 30 %) and a slight 2 % lift or scale. The cursor becomes a pointer. On touch, the first tap highlights and opens the card.
- **Info card:** title (`name_de`), 1–3 short sentences (`info_de`) and an optional small icon. No price unless the owners agree. The card is a light panel with rounded corners in the app's German UI.
- **Discovery:** *entdeckt x / y* counts clickable objects opened at least once. It is stored locally on the device only (ADR 0022) and gets a small, friendly confirmation, not a score screen.
- **Readable on phones:** tap targets of at least 44 px on screen at the spawn distance, so group small products (a whole basket is one target until you get close).
