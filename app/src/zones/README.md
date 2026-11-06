# 🚪 `src/zones/` — zone contract runtime (V2.6)

Pure logic for zones behind portals ([zone contract](../../../docs/zone-contract.md), [ADR 0029](../../../docs/adr/0029-zones-same-bundle-folder-layout.md)). No three.js, no DOM; `runtime/` (V2.6b) wires it into the shell.

| File | What |
|---|---|
| `catalogue.ts` | Built twins: `parseZoneCatalogue` (`sle-zone-catalogue-v1`), `resolveTarget` / `groupTarget`, card text (`cardFor`, `formatPriceEur`, `saleUnitDe`), `DiscoveryStore` (localStorage `sle.zones.entdeckt.v1.<zone>`, guarded), fills (`fillShows`, `discoverableIn`: *Morgens* / *Feierabend*), the optional `tour` (via `tour.ts`) |
| `tour.ts` | Built twins, pure: the guided tour (`parseTour`, catalogue `tour`), step sequencing (`tourMove`, `tourNav`), camera glide (`lookAngles`, `glideVia`, `makeGlide`, `glideAt`: eased along the path and its waypoints, heading the short way), routes off the shell (`legClear`: a floor step > 0.45 m or > 3 m without floor is a wall; `planRoute` / `routeGlide`: the authored `via` when clear, else the shortest clear chain over the tour's own points, e.g. out through the shop door), `tourFill` (a product stop in the empty fill switches to the default) |
| `pickProxy.ts` | Built twins, pure: invisible pick proxies for small products (`isSmallBox`, `pickAngle`, `proxyHalf`, `rayBoxEnter`, `chooseProxy`, `proxySlack`): ≈ 44 px on touch, never through walls (0.3 m depth slack only behind a clickable target such as a shelf bar, none behind an occluder) |
| `flatFrame.ts` | Built twins, pure: flat wall-mounted targets (`flatPanel`, `frameRing`, `frameWidth`) get a warm picture frame instead of the hull outline |
| `contract.ts` | `parseZoneManifest` (tolerant, app rule; asset roles `scene` · `collider` · `reference`, optional `twin` block via `parseTwin`), `zoneBadge_de` (*Nachbau* · *Aufnahme* · *Hypothese*), `validateZoneStrict` + `budgetViolations` (producer rule, twin of `pipeline/zones.py`), `parseZoneIndex`, `loadZones(fetchJson, aoiBboxEN)` |
| `geometry.ts` | Footprint rings: normalise (CCW, no closing vertex), simple-polygon check, point-in-ring, bbox |
| `portal.ts` | `updatePortalFocus` (offer *Betreten* within `radius_m`, keep it to `radius_m · 1.1`), `fallbackExitPose`, `pickLod` |
| `session.ts` | `zoneSession(state, event)`: overworld → loading → zone → overworld; saves the overworld pose (+ opaque snapshot) on enter, hands it back as `restorePose` on exit, cancel or load failure |

**Shell wiring (sketch):**
```ts
focus = updatePortalFocus(focus, zones, cam.E, cam.N);          // every frame / on move → show focus.label_de
s = zoneSession(s, { type: 'enter', zone, portalId, pose: cam.pose(), snapshot: layers });
// loading screen: zone.name_de, zone.summary_de, zone.attribution, zone.evidence.disclaimer_de
s = zoneSession(s, { type: 'loaded', zoneId });                 // mount runtime (gltf | module), camera = s.spawn
s = zoneSession(s, { type: 'exit' });                           // unmount, cam.setPose(s.restorePose), then 'restored'
```

## 🎮 `runtime/` — portals, loading screen, enter / leave (V2.6b)

| File | What |
|---|---|
| `api.ts` | **Runtime API** types: `ZoneModule`, `ZoneMountContext`, `ZoneHandle` (contract → *Runtime API*) |
| `modules.ts` | `ZONE_MODULES` registry: name → lazy `import()`; one line per zone module |
| `flow.ts` | `createZoneFlow` (pure, ports injected): enter → loading → mount → zone → exit/cancel/fail → restore; `createPortalPrompter` |
| `overworld.ts` | Pose capture / bit-exact restore of the drone rig (re-derived from E/N/h if the exaggeration changed) |
| `marker.ts` | 3D portal marker: ring + beam + gate, y = displayed ground (exaggeration-safe), scales with distance |
| `feature.ts` | Standard feature `zone-portals`: loads zones, markers + labels, prompt (E), loading screen, *Verlassen* chrome, `zonePortals()` |
| `builtin.ts` · `testRoom.ts` · `collide.ts` | 🧪 built-in *Testraum* (dev, `?aoi=fixture`, `?testraum`): procedural hut, walk collision |
| `zones.css` | Loading info, zone chrome; hides the overworld shell while `#app.sle-zone-active` |
| `gltfZone.ts` | 🥖 generic **glTF runtime** (V2.8b, lazy chunk, `hostChrome: true`): GLTFLoader + meshopt + KTX2 (transcoder bundled via `?url`), LOD switching, sky, walk UI (*Schweben*, touch ▲/▼, hint), `capture.scale`. Built twins (`twin`, ADR 0042): radial context fade into the horizon haze (shader patch after fog, sky below the horizon = haze), walker blocks at the nav floor's edge, `reference` assets only behind `?referenz` (*Referenz* button; `?referenz=an` shows it on enter), lazy coarse → fine, scaled by `twin.referenceScale`, never collide |
| `twinInteract.ts` · `twinPick.ts` · `twinUi.ts` | 🥖 built twins with `twin.catalogue` = `*.json` (round 5): hover / click / pointer-lock crosshair + E / touch tap → warm outline + ink edge + rim glow and a 2 % lift (overlays on the unlit + COLOR_0 meshes), info card (light panel, price `1,20 €`), *entdeckt x / y* with a confirm-twice reset, the fill toggle (catalogue `fills`: hides other states' `extras.fills` nodes, re-indexes, recounts; `twin.setFill(id)` for headless checks), the guided tour (catalogue `tour`: *Führung* button, panel with *Zurück* / *Weiter* / *Tour beenden*, the stop's object highlighted; `gltfZone.glideTo` glides the camera — walking onto the floor, floating to the stop's eye, routed through the door instead of the walls on the walker's floor — while controls and walker pause; a product stop reached in *Feierabend* switches to the default fill first; `twin.tour('start' | 'next' | 'back' | 'end')` for headless checks). Small products have pick proxies (touch 22 px radius, mouse / crosshair 8 px); flat wall-mounted targets (the gable mural) get a picture frame and no lift. One merged BVH per drawn LOD (vertex → target, −1 = occluder, glass left out), picks only when the pointer or camera moved. Esc closes the card first (`ZoneHandle.escape`) |
| `gltfPlan.ts` | pure: `sceneAssets`, `referenceAssets`, `colliderPlan`, `wantedLod`, `LodSwitcher` (load → show → drop, one at a time), `scaleAbout`, `spawnLocal`, `firstViewWeights`; twins: `walkHoles`, `twinFade` / `fadeAt`, `referenceMode` |
| `walk.ts` | `buildCollider` (merged BVH) + `Walker`: ground ray from the knees (up-facing hits only), step ↑ 0.45 / ↓ 0.6 m, hole → keep height (`holes: 'keep'`, captures) or stop and slide along the edge (`'block'`, a twin's exact nav floor), wall capsule r 0.2 in the band 0.6–1.5 m |
| `sharedTrees.ts` | `overworldTreeSource(manifest, baseUrl)` → `ctx.trees.treesIn(bboxEN)`: today's CHM trees (AOI `trees` layer, chunk by chunk, failed chunks skipped) for zones with preset `trees: "shared"` (V2.7) |

**🏰 Castle (V2.7, [ADR 0033](../../../docs/adr/0033-castle-module-zone.md)):** `modules.ts` maps `schloss-karlsberg` to `zones/schloss-karlsberg/viewer/src/zone/entry.ts`. Vite and tsconfig alias `@model` to the castle's `model/src`, dedupe `three` and allow `zones/` in `server.fs.allow`; `three-mesh-bvh` (castle colliders) is an app dependency. The castle has `hostChrome: false` (own HUD, M = Verlassen). `feature.ts` forwards the shell tier (`setTier`) and passes no `quality` (the castle picks `auto`). The castle's hooks are at `sle.zones.flow.handle().hooks` (`goto`, `step`, `inView`, …).

```text
 E / „Betreten“ ─▶ freeze overworld · save pose ─▶ loading (import() 0–10 %, mountZone 10–100 %) ─▶ zone owns frames
                      ▲                               │ Abbrechen / Esc / error                       │ Verlassen / Esc / frame error
                      └──── restore pose exactly ◀────┴───────────────────────────────────────────────┘
```

**Perf:** `pnpm run perf:zone` (`scripts/perf-zone.mjs`, headless, needs a running preview with zone data; `--profile` adds a CPU profile of the goto) runs the phone proxy and desktop through enter → Rundflug → spawn → „Gehe zu“ Festsaal → walk → exit. JSON + shots go to `docs/shots/`.

**🥖 Bakery (V2.8b, [ADR 0041](../../../docs/adr/0041-gltf-zone-runtime-walk-on-mesh.md)):** `pnpm run perf:gltf` (`scripts/perf-gltf-zone.mjs`, headless, needs a preview with the bakery package (zone id `baeckerei-heusser`, was `bakery`) and `data/work/zones/baeckerei-heusser/package/package.json` for the `walkPath`) runs U3 with real input: fly to the portal → E → loading → street → BFS-planned walk (W / touch ▲) to the shop (highest camera point) and the courtyard (last camera point) → *Verlassen* → pose compared. JSON + `u3-<profile>-*.jpg` → `docs/shots/v2.8b/`.

| 2026-11-04, M4 Max | Phone proxy (390 px @3×, 4× CPU, 4G, quality mobil) | Desktop (1440 px @2×) |
|---|---:|---:|
| Cold enter (portal → zone drawn) / fine LOD | 2.2 s / 4.4 s | 0.2 s / 0.2 s |
| Zone bytes (6 requests, incl. 527 kB Basis wasm) | 3.8 MB | 3.8 MB |
| rAF fps shop / courtyard (p95 frame) | 60 / 60 (16.8 ms) | 60 / 60 |
| `Walker.step` + readback | ≈ 1.7 ms | ≈ 2 ms |
| Triangles / draw calls / JS heap | 101 k / 2 / 105–111 MB | 101 k / 2 / 160–195 MB |
| Pose after *Verlassen* | Δ 0 m, 0° | Δ 0 m, 0° |

⚠️ Only the CPU is throttled: the GPU is the M4 Max (fps capped by vsync). Real-phone fill rate is not measured.

Tests: `tests/zones.test.ts` (fixture zone `tests/fixtures/zones/fixture/zone.json`, inside the `fixture` AOI: enter → zone → exit restores the pose). `tests/zoneRuntime.test.ts`: flow round trip, cancel / error paths, prompt hysteresis, rig restore, Testraum walls. `tests/zones-castle.test.ts`: the committed castle `zone.json` against the strict validator (no waiver since ADR 0040). `tests/zones-shared-trees.test.ts`: the tree source. `tests/zonesGltf.test.ts`: LOD plan + switcher, scale, walker on a synthetic room (door, steps, counter, mirror floor, hole). `tests/zonesCatalogue.test.ts` (fixture `tests/fixtures/zones/twin/catalogue.json`): catalogue parse, `twin.catalogue` path, targets + groups, card text and prices, discovery store, merged pick BVH + highlight on a synthetic room. `tests/zonesTour.test.ts`: tour parse, steps, glide, routes on a synthetic shop (door, steps, walls, a house), `tourFill`, pick proxies incl. no slack behind walls (and the bakery's tour and its door route on the real `nav.glb` where its package was built). `tests/zonesFlatFrame.test.ts`: flat-target detection and the frame ring. `tests/zonesTwin.test.ts` (fixture `tests/fixtures/zones/twin/zone.json`): `reference` role, `twin` block, badge, twin plan, blocking walker; where the bakery package was built, also its `zone.json` (strict) and seeded random walks on its `nav.glb` (never off the floor, W from the spawn reaches the shop).
