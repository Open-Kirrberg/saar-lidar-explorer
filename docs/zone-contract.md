# 🚪 Zone Contract v1 — zone package → app

**Binding** for everything that produces a zone (the castle generator in `zones/<id>/`, the capture tool in `tools/capture/`) and for the app's zone runtime (`app/src/zones/`). It sits next to the [data contract](data-contract.md) (frames, proj4, attribution rules apply unchanged) and follows the same rules ([ADR 0004](adr/0004-contract-first.md)): change this file **before** a producer or the loader, changes are additive, old packages stay loadable. Why zones exist: [ADR 0015](adr/0015-overworld-zones-portals.md), [0016](adr/0016-zone-kinds-zone-contract.md). Same bundle + folder layout: [ADR 0029](adr/0029-zones-same-bundle-folder-layout.md).

Reference implementation: `app/src/zones/contract.ts` (TS loader/validator), `pipeline/zones.py` (Python validator for producers). Fixture: [`app/tests/fixtures/zones/fixture/zone.json`](../app/tests/fixtures/zones/fixture/zone.json); both validators are tested against it.

**Versions.** `format: "sle-zone-v1"`. A new major format string is a new contract version; the app keeps loading v1.

## 🗂️ Where packages live

```
<dataRoot>zones/index.json            zone index (which zones exist, where to look)
<dataRoot>zones/<id>/zone.json        zone manifest (this file's schema)
<dataRoot>zones/<id>/<assets…>        glTF, textures, extras — paths relative to zone.json
```

`<dataRoot>` = `dataRootUrl()` (local: `app/public/data/`, git-ignored; public: the data repo). Packages are **generated, never committed**. `vite build` does not copy them into `dist/` (like AOI data).

### `zones/index.json`

```jsonc
{
  "format": "sle-zones-v1",
  "zones": [
    { "id": "schloss-karlsberg", "bboxEN": [[381255, 5464643], [383159, 5467054]] },  // bbox of footprint + portals
    { "id": "bakery",            "bboxEN": [[Emin, Nmin], [Emax, Nmax]] }
  ]
}
```

The overworld fetches the index once, then only the `zone.json` of zones whose `bboxEN` intersects the AOI. Missing index → no zones (not fatal).

## 📄 `zone.json`

Castle values are illustrative (V2.7 sets the real ones).

```jsonc
{
  "format": "sle-zone-v1",                  // required, exact
  "id": "schloss-karlsberg",                // [a-z0-9][a-z0-9-]{0,63}; = folder name
  "kind": "reconstructed",                  // "reconstructed" | "captured"   (ADR 0016)
  "name_de": "Schloss Karlsberg 1789",      // loading screen title
  "summary_de": "Zeitreise in den Sommer 1789 …",  // loading screen text, ≤ 300 chars
  "crs": "EPSG:25832",                      // required, exact
  "heightDatum": "DHHN2016",
  "origin": { "E0": 381000, "N0": 5465000 },// zone frame: x = E − E0, y = h (true), z = −(N − N0)

  "footprint": [[381255.3, 5464643.2], [383159.4, 5464643.2], [383159.4, 5467054.1], [381255.3, 5467054.1]],
                                            // EPSG:25832 ring, ≥ 3 vertices, simple, area > 0; closing vertex optional;
                                            // either orientation (the app normalises to CCW). Minimap outline + "inside" test.

  "portals": [{                             // ≥ 1
    "id": "ehrenhof",                       // unique in the zone, same pattern as zone id
    "label_de": "Schloss betreten",         // button / marker label, ≤ 40 chars
    "E": 382262.7, "N": 5466126.3,          // portal position (EPSG:25832)
    "h": null,                              // true height, or null = on the overworld terrain
    "radius_m": 300,                        // offer *Betreten* within this horizontal distance (1–2000)
    "facing_deg": 260.5,                    // grid heading the portal faces (outward, towards the visitor), [0, 360)
    "spawn": "ehrenhof"                     // key into `spawns`
  }],

  "spawns": {                               // ≥ 1; pose conventions = the explorer URL hash / camera handover:
    "ehrenhof": { "E": 382240.0, "N": 5466120.0, "h": 352.0,   // true height (no exaggeration)
                  "heading_deg": 80.5, "pitch_deg": -5,        // grid north, clockwise; pitch negative = down
                  "mode": "gehen" }                            // "gehen" | "fliegen"
  },

  "exit": { "rule": "restore" },            // v1 knows only "restore" (see "Enter and exit")

  "runtime": { "kind": "module", "module": "schloss-karlsberg" },
                                            // "gltf": the app's generic zone runtime renders `assets` (captured zones)
                                            // "module": a lazy-loaded zone module in the same bundle (ADR 0029),
                                            //           registered in the app under this name

  "assets": [{                              // "gltf" runtime: ≥ 1 scene asset. "module" runtime: optional
    "id": "shop",                           // unique in the zone
    "role": "scene",                        // "scene" (rendered) | "collider" (walk collision only, never drawn)
    "bboxLocal": [[-12, 230, -18], [12, 245, 18]],  // zone frame, used for LOD distances before loading
    "lods": [                               // finest first; the last level has "until_m": null
      { "path": "shop/lod0.glb", "until_m": 25,   "bytes": 9100000, "triangles": 400000 },
      { "path": "shop/lod1.glb", "until_m": null, "bytes": 1800000, "triangles": 60000 }
    ]
  }],

  "preset": {                               // renderer preset; sky + trees are the shared overworld modules (ADR 0015)
    "look": "kino",                         // "kino" | "dokumentation" | "natur"
    "sky": "shared",                        // "shared" (overworld sky at `timeOfDay`) | "none" (interior-only zone)
    "trees": "shared",                      // "shared" (CHM trees around the footprint) | "none"
    "timeOfDay": { "date": "1789-07-15", "time": "19:30" },   // local time Europe/Berlin; or "now"
    "exposure": 1.0                         // optional, 0.25–4
  },

  "attribution": [                          // ≥ 1 entry, each one source, no ';' (joined with "; " for display)
    "Rekonstruktion Schloss Karlsberg 1789 (Hypothese), eigenes Werk",
    "Grundrisse teils nach Lageplan 2006, schloss-carlsberg.de (CC BY-SA 2.0 DE)",
    "Gelände: © GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0"
  ],

  "evidence": {                             // ADR 0008 / 0011: every zone is a hypothesis or a capture, never a finding
    "kind": "hypothesis",                   // "hypothesis" (reconstructed) | "capture" (captured)
    "confidence": "med",                    // zone default: "high" | "med" | "low"
    "perPart": "_CONF",                     // "_CONF" (vertex attribute as in sle-recon-v1) | "extras" | "none"
    "sources_de": ["Katalog v2, research/01–11"],   // ≤ 10 short strings
    "disclaimer_de": "Hypothetische Rekonstruktion, kein Befund. Schauen, nicht graben."
  },

  "capture": null,                          // captured zones only, see below

  "budget": {                               // declared by the producer, checked by the validators (limits below)
    "downloadBytes": 24000000,              // sum of the first-view set (every asset's coarsest LOD + module chunk)
    "totalBytes": 60000000,                 // all files of the package
    "triangles": 900000,                    // max drawn at once (finest LOD of everything in view)
    "textureBytesGpu": 64000000             // GPU memory of all textures at the finest LOD
  },

  "generated": "2026-11-04T12:00:00Z",      // optional
  "generator": "zones/schloss-karlsberg export-zone"   // optional, free text
}
```

### 🎥 `capture` (captured zones)

```jsonc
"capture": {
  "date": "2026-10-30",                     // footage date (ISO)
  "method": "photogrammetry-mesh",          // v1: "photogrammetry-mesh" (ADR 0027); "splats" is reserved
  "georef": { "method": "lod2+ortho", "controlPoints": 8, "rmsError_m": 0.15 },
  "privacy": "no people; plates blurred"    // free text, required: what was removed (H13)
}
```

## 🧱 Assets

| | Rule | Why |
|---|---|---|
| Format | **glTF 2.0 binary (`.glb`)**, one scene, geometry in the **zone frame** (true heights, no exaggeration) | three's `GLTFLoader`, already used for LoD2 + sle-recon-v1 |
| Geometry | **`EXT_meshopt_compression` + `KHR_mesh_quantization`**; **no Draco** | meshopt is already in the app (`three/examples/jsm/libs/meshopt_decoder.module.js`, ≈ 20 kB, no worker pool), decodes faster than Draco, keeps custom attributes like `_CONF`, compresses well under the host's gzip/brotli; Draco's ≈ 300 kB wasm + lossy positions buy little on meshes this size |
| Textures | **KTX2 (`KHR_texture_basisu`)**: ETC1S for baked photo colour, UASTC for normal/detail maps; ≤ 4096² per image | photogrammetry atlases are the GPU-memory risk on the phone: 4096² RGBA = 64 MB uncompressed vs ≈ 8–16 MB as GPU-compressed KTX2. The Basis transcoder (≈ 500 kB wasm) loads lazily, only for zones that need it. WebP/PNG are allowed only for images ≤ 1024² |
| Materials | Captured: `KHR_materials_unlit` (light is baked into the photos). Reconstructed: PBR, named `<surface>.<variant>` | baked + relit = double shading |
| Allowed extensions | the four above + `KHR_texture_transform`, `KHR_materials_emissive_strength` | anything else in `extensionsRequired` → asset rejected |
| Per-part evidence | `evidence.perPart = "_CONF"`: SCALAR `UNSIGNED_BYTE` vertex attribute, 0 low · 1 med · 2 high (as sle-recon-v1). `"extras"`: node `extras: { "confidence": "high"|"med"|"low", "evidence": "D"|"I"|"HMS"… }` | the *Gewissheit* control ([0011](adr/0011-castle-evidence-no-hms.md), [0019](adr/0019-feature-tiers.md)) |
| Node names | `<assetId>/<part>[/<detail>]`, read from the glTF JSON (three sanitises `Object3D.name`) | picking, *Gehe zu* |
| Colliders | `role: "collider"`: one low-poly mesh, never drawn; missing → walk mode collides with `scene` LOD1 | phone budget |
| Privacy | **No people, no readable licence plates**, no house numbers other than the zone's own | H13, ADR 0009 |

**LOD.** The runtime picks per asset the first level whose `until_m` ≥ the camera's distance to `bboxLocal` (null = ∞) and keeps the previous level drawn until the next one has loaded (no hole, no pop to nothing). Coarse first: the first-view set is every asset's last LOD.

## 📏 Budgets (phone proxy, [ADR 0014](adr/0014-audience-scope-devices.md))

| Key | Limit | Note |
|---|---|---|
| `downloadBytes` | ≤ 30 MB | first view, before the loading screen closes |
| `totalBytes` | ≤ 120 MB | whole package incl. finest LODs |
| `triangles` | ≤ 1.5 M | drawn at once |
| `textureBytesGpu` | ≤ 128 MB | after KTX2 transcode |
| module chunk (`runtime: module`) | ≤ 1.5 MB gzip | counted in `downloadBytes` |

Over budget → the validators fail (producers), the app logs a warning and still loads (the shell may refuse on low-memory devices).

## 🔁 Enter and exit

```
overworld ──Betreten (portal in range)──▶ loading ──assets ready──▶ zone ──Verlassen──▶ overworld
   │  save overworld pose                    │ fail / Abbrechen          restore saved pose
   └──────────────────────────────────────── ◀┘ (pose restored, message)
```

- A portal is **offered, never auto-entered**: within `radius_m` (horizontal, EPSG:25832) the shell shows `label_de`; it hides again beyond `radius_m · 1.1` (hysteresis).
- **Enter** saves the overworld camera pose (E, N, true h, heading, pitch, mode) and the active layers, pauses overworld streaming and may free its GPU caches; the zone starts at the portal's `spawn`.
- **Exit rule `restore`**: back in the overworld the camera returns **exactly to the saved pose**. Without a saved pose (deep link into a zone) the fallback is the portal: `radius_m / 3` (≥ 20 m) in front of it along `facing_deg`, looking back at it, pitch −15°, mode `fliegen`, 30 m above the portal ground (overworld terrain, else portal `h`, else spawn `h`).
- Load failure or cancel during loading → overworld with the saved pose, one German message.
- Inside a zone the **exaggeration is 1** (the zone is its own world); the portal marker in the overworld follows the exaggeration rule like everything else.

## 🛡️ App tolerance

- `index.json` / `zone.json` 404, invalid JSON, wrong `format` or `crs`, invalid `id`, `kind`, `origin`, `footprint`, no valid portal or spawn, unknown `runtime.kind` or an unregistered module → **zone absent** (logged once, not fatal).
- A portal with an unknown `spawn`, invalid position or radius, or a duplicate `id` is dropped; a spawn with an invalid pose is dropped.
- `gltf` runtime: no `scene` asset with a valid LOD chain → zone absent. An asset with unknown `role` is skipped (forward compatible: e.g. a later `splat` role).
- Paths: plain relative (`[A-Za-z0-9_./-]`, no `..`, no scheme, no leading `/`), like sle-recon-v1.
- Defaults: `summary_de` → "", `heightDatum` → "DHHN2016", `exit` → `restore`, `preset` → `{ look: "kino", sky: "shared", trees: "shared", timeOfDay: "now" }`, `evidence.perPart` → `"none"`, `evidence.disclaimer_de` → "Schauen, nicht graben.", `facing_deg` → 0, `radius_m` clamped to 1–2000.
- `runtime.module` must name a zone module registered in the app build; unknown → zone absent.
- Unknown keys are ignored everywhere. Strings are text, never HTML; nothing from a package is executed (module zones are code from **this** repo, selected by name only).

## 🔌 Runtime API (V2.6b)

Additive; packages are unchanged. How the explorer hosts a `runtime.kind: "module"` zone ([ADR 0037](adr/0037-zone-runtime-host.md)). Types: [`app/src/zones/runtime/api.ts`](../app/src/zones/runtime/api.ts).

```ts
interface ZoneModule {                     // the lazy chunk named by runtime.module (registered in ZONE_MODULES)
  mountZone(ctx: ZoneMountContext): Promise<ZoneHandle>;
  hostChrome?: boolean;                    // default true: host draws title, badge, „Verlassen“, attribution
}
interface ZoneMountContext {
  container: HTMLElement;                  // full-screen zone HUD layer, removed on exit
  renderer: WebGLRenderer;                 // the explorer's — shared, one GL context
  baseUrl: string;                         // "<dataRoot>zones/<id>/", asset paths are relative to it
  manifest: ZoneManifest;                  // parsed zone.json
  tier?: 'standard' | 'entdecker' | 'labor';
  quality?: 'auto' | 'hoch' | 'mittel' | 'niedrig' | 'mobil';
  footprintEN?: [number, number][];
  onExit(): void;                          // ask the host to leave
  onProgress(label_de: string, fraction: number): void;   // 0–1 of the zone's own work
  signal: AbortSignal;                     // aborted on „Abbrechen“; a late handle is disposed
}
interface ZoneHandle {
  enter(spawn: Pose): void;                // once, after mount; host calls resize() first
  frame(dt: number): void;                 // update + render; the overworld renders nothing meanwhile
  resize(width: number, height: number): void;            // CSS px
  exit(): Pose | void;                     // stop input, leave the renderer as found
  setTier?(t): void; setQuality?(q): void;
  dispose(): void;                         // free GPU + DOM; handle dead
}
```

| Rule | |
|---|---|
| Order | `mountZone` → `resize` → `enter(spawn)` → `frame(dt)`… → `exit()` → `dispose()` |
| Errors | rejected `mountZone`, aborted load, throwing `frame()` → host runs `exit()` + `dispose()` (each guarded), restores the overworld, one German toast |
| Frames | zone poses are true heights (exaggeration 1, frame `x = E − E0`, `y = h`, `z = −(N − N0)`) |
| Keys | Esc leaves (host, capture phase). A zone binds its own keys and must remove them in `exit()` |
| Renderer | the host snapshots and restores tone mapping, exposure, clear colour/alpha, colour space, `autoClear`, shadows, pixel ratio |
| `gltf` | no generic gltf runtime yet → such zones are **absent** (tolerance rule) until one is registered (V2.8) |

## 🧪 Examples

| | 🏰 Castle (reconstructed) | 🥖 Bakery (captured) | 🧪 Fixture |
|---|---|---|---|
| `runtime` | `module: "schloss-karlsberg"` (generator + viewer code, lazy chunk) | `gltf` | `gltf` |
| assets | optional (terrain, textures fetched by the module) | `street`, `shop`, `courtyard` (2 LODs each) + `collider` | one 2-LOD box |
| `evidence` | `hypothesis`, `_CONF` | `capture`, `none`, `capture.georef.rmsError_m` | `hypothesis`, `extras` |
| preset | `kino`, sky shared, 1789-07-15 19:30 | `natur`, sky shared, `now` | `dokumentation`, `none` |

The full fixture is [`app/tests/fixtures/zones/fixture/zone.json`](../app/tests/fixtures/zones/fixture/zone.json) (inside the `fixture` AOI).
