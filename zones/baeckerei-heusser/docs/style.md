# 🎨 Style: Bäckerei Heusser twin

The twin should look **light, friendly and stylised**, between a cosy comic and a clean mobile game. It should not be too cartoony and it should never be photo-real (the castle zone is the photo-real one). Visitors recognise Bäckerei Heusser by its **layout, proportions and colours**, not by photo textures. Everything must stay readable on a phone at 390 px. Decision: [ADR 0042](../../../docs/adr/0042-baeckerei-heusser-built-twin.md).

**Stylise shapes and materials, never sizes.** Dimensions come from the plan (`../plan/`). A shelf that is 1.92 m tall stays 1.92 m tall.

## Palette

Colours are taken from the real shop and then simplified. Values are sRGB, and the renderer works in linear space.

| Token | Hex | Used for |
|---|---|---|
| `heusser-rot` | `#8E2B2B` | Soffit edge, top bread tier edge, accents (the counter base is white marble, see below) |
| `messing` | `#C29A4B` | Brass door handles (the shop's rod tiers and rails are the paler `champagner`) |
| `granit` | `#7E7F80` | Counter ledge, steps (one darker speckle tone `#6A6B6C`, no texture) |
| `fliese` | `#F1EEE8` | Tall marble-look wall panels ≈ 0.75 wide (joints `#DCD6CC`, a faint grey vein at most) |
| `holz` | `#B07A4A` | Wood-faced ceiling soffit, crates |
| `decke` | `#E8D6BA` | Cream plank ceiling, ≈ 0.28 wide planks with staggered joints (`decke-raster` `#CDBB9F`) |
| `kruste-hell` / `kruste` / `kruste-dunkel` | `#E3B776` / `#C68642` / `#8A5228` | Rolls, light bread / mixed bread / dark rye and crust shadows |
| `korb` | `#C9A063` | Wicker baskets, pretzel basket |
| `tuch-rosa` | `#C0587E` | Basket cloths (raspberry pink in the video; was `#E9A9B6`) |
| `lack-schwarz` | `#2B2B2D` | Pendant lamps, grid shelf, price rails |
| `glas` | `#CFE6EA` at 25–35 % opacity | Display glass, fridge door, shop window (no reflections) |
| `fassade` / `sockel` | `#E6D6CB` / `#8C5A4A` | Exterior render (rosy beige, was `#E7DFD2`) / red sandstone slips of the plinth |

Generator-only tokens (same family): `granit-dunkel` `#6A6B6C`, `fliese-fuge` `#DCD6CC`, `decke-raster` `#CDBB9F`, `lampe` `#FFE2BF` (the lit diffuser of the pendant lamps).

Shop interior tokens (round 3, sampled from the walkthrough video, white-referenced and simplified):

| Token | Hex | Used for |
|---|---|---|
| `champagner` | `#D2C08E` | Rod tiers, rails, display frame and trim |
| `granit-rosa` / `granit-rosa-dunkel` | `#B4A9A4` / `#8A7F7A` | Counter ledge and work top (grey granite with a pink cast) |
| `marmor` | `#ECEBE6` | Counter base, display deck |
| `thekenrot` | `#A0222E` | Red band under the display glass, red ceiling trim |
| `chrom` / `edelstahl` | `#C6C8CA` / `#B8BCC0` | Grid shelf, frames, door rails / slicer, warming display |
| `holz-dunkel` / `holz-hell` | `#3A2A1E` / `#C49A6C` | Café tables, chairs, jar shelf / work table, pretzel stand |
| `kissen` | `#504C53` | Chair cushions, mats, stool seat |
| `regal-weiss` / `putz-weiss` | `#F3F3F0` / `#EEEAE2` | White shelves, fridge, cove / window wall render (piers, reveals, lintel) |
| `boden-fliese` / `boden-fuge` | `#E6D6C6` / `#BDB1A4` | Warm cream floor tiles / grout |
| `sepia` | `#A38D6E` | Neutral fill of the old photo frames (no faces, no content) |
| `bild-rot`, `filz-gruen`, `terrakotta`, `blatt`, `blume` | `#792E35`, `#9DB35E`, `#B5653F`, `#4F7A3A`, `#E08A3A` | Coffee picture, window-sill felt, plant pot, leaves, garland flowers and pumpkins |
| `glow` | `#FFD9A0` at 28 % | Soft halo under the pendant lamps |

**Facade** (round 3b, from the street frames of the video and Street View, white-referenced and simplified; `../build/bh_twin/facade.py`):

| Token | Hex | Used for |
|---|---|---|
| `sockel-hell` / `sockel-fuge` / `abdeckplatte` | `#B9A48E` / `#A2938A` / `#7E5A4C` | Light plinth slips / plinth joints / plinth cap (= shop-window sill) |
| `sandstein-rot` / `sandstein-hell` / `sandstein-relief` | `#A0705F` / `#CBBBA6` / `#C99A88` | Window surrounds, quoins, pilaster, upper window frames / light stones / the carved pretzel |
| `glasbaustein`, `-hell`, `-gruen`, `-blau`, `glas-fuge` | `#C9D6C8`, `#DCE6DA`, `#86B391`, `#93B1C9`, `#D8D4CC` | Pale green glass blocks in basket weave with a few accent blocks, joints (opaque: nothing behind them) |
| `fensterglas` / `rollladen` / `rollladen-fuge` | `#56636C` / `#C8CCCF` / `#A9AEB2` | Upper-floor glass (opaque) / closed roller shutter and its slats |
| `fallrohr` / `verzinkt` | `#3A3636` / `#9A9E9C` | Gutter and downpipes / porch handrail |
| `schiefer` / `schiefer-fuge` | `#6B7178` / `#50555B` | Slate diamonds on the front roof left of the pilaster |
| `wandbild-grund`, `ziegel`, `ofen`, `kruste`, `kruste-dunkel`, `schrift` | `#EDE5D5`, `#A5503A`, `#3A2A22`, `#C68642`, `#8A5228`, `#4A4644` | Gable mural and sign graphic (oven arch, mouth, loaf); `schrift` = the shop's lettering (default on, `--no-lettering` leaves it out) |

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

- **Bevels everywhere.** Fixtures get a 10–20 mm bevel or round-over (generator: `geom.rounded_box_local`, `bevel_prism`, `BEVEL_FIXTURE` 12 mm). Products get 3–8 mm. Building edges (walls, ledges, steps) get 5–10 mm. Hard 90° edges look like a CAD model, and bevels catch the light.
- **Simplify, keep the silhouette.** Model what defines the outline (the slope of the bread tiers, the curved glass of the display, the basket rims) and drop small clutter.
- **Optional outlines:** a 1–1.5 px ink line (`#3A2A22`, ≈ 40 % opacity) on object silhouettes only, never on every triangle edge. If it costs too much on the phone, use it only on the hovered object.
- **Subtle variation, deterministic.** Breads in one basket vary in scale (± 6 %), rotation and crust tone. Seed it from the catalogue id so the result is the same in every build.

## Light and shading

- **Warm and inviting.** The key light is warm white (≈ 3200 K, `#FFE2BF`). Add a soft sky or hemisphere fill (cool `#DDE6F0` above, warm `#E8D8C4` below), and give the pendant lamps a small warm glow.
- **Shading:** flat or soft Lambert, or a 3-step toon ramp. *Round 2 (generator):* unlit materials (`KHR_materials_unlit`, base colour = token) × baked light in `COLOR_0` (soft Lambert from the warm key + hemisphere fill, times vertex AO); `NORMAL` stays in the file so a later renderer can relight. Use no PBR texture maps and no glossy specular (keep at most a small, soft highlight on glass and brass). Baked or vertex AO grounds objects in corners and under the shelves. *Round 3:* warm light pools under the four pendant lamps (downward cone, soft falloff), daylight from the shop windows fading with the depth into the room, analytic vertex AO under boards and ledges, around feet and bases and in room corners (`shade.AO`).
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
- **Info card:** title (`name_de`), 1–3 short sentences (`info_de`) and an optional small icon. The price, since the owners agreed (ADR 0044). The card is a light panel with rounded corners in the app's German UI.
- **Discovery:** *entdeckt x / y* counts clickable objects opened at least once. It is stored locally on the device only (ADR 0022) and gets a small, friendly confirmation, not a score screen.
- **Readable on phones:** tap targets of at least 44 px on screen at the spawn distance, so group small products (a whole basket is one target until you get close).
